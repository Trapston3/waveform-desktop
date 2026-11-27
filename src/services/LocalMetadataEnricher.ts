// src/services/LocalMetadataEnricher.ts
// Browser/renderer-safe background artwork enricher for local tracks.

import type { Song } from '../models/Song';
import { getPlatformBridge, hasPlatformBridge } from '../platform/index';

const MAX_CONCURRENCY = 3;

export function computeClientMetadataKey(
  artist: string,
  title: string,
  durationSec?: number
): string {
  return `${(artist || '').trim().toLowerCase()}|${(title || '').trim().toLowerCase()}|${Math.round(durationSec || 0)}`;
}

async function fetchItunesArtworkInBrowser(artist: string, title: string): Promise<string | null> {
  const cleanedArtist =
    artist && artist.toLowerCase() !== 'unknown artist'
      ? artist.replace(/\((?:feat\.?|ft\.?|featuring)[^)]*\)/gi, '').replace(/\[[^\]]*\]/g, '').trim()
      : '';
  const cleanedTitle = title
    .replace(/\((?:feat\.?|ft\.?|featuring)[^)]*\)/gi, '')
    .replace(/\[[^\]]*\]/g, '')
    .trim();
  const query = `${cleanedArtist} ${cleanedTitle}`.trim();
  if (!query) return null;

  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=5`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: Array<{ artworkUrl100?: string }> };
    const firstUrl = data?.results?.find((r) => typeof r.artworkUrl100 === 'string')?.artworkUrl100;
    return firstUrl ? firstUrl.replace(/100x100bb/i, '600x600bb') : null;
  } catch {
    return null;
  }
}

export async function enrichLocalTracksInBackground(
  tracks: Song[],
  onTrackUpdated: (videoId: string, patch: Partial<Song>) => void
): Promise<void> {
  const pending = tracks.filter((t) => t && t.videoId && !t.thumbnailUrl);
  if (pending.length === 0) return;

  const api = hasPlatformBridge() ? getPlatformBridge() : undefined;
  const hasElectronEnrich = hasPlatformBridge('enrichLocalArtwork');

  let cursor = 0;
  const workerCount = Math.min(MAX_CONCURRENCY, pending.length);

  const runWorker = async (): Promise<void> => {
    while (cursor < pending.length) {
      const idx = cursor++;
      const track = pending[idx];
      if (!track) continue;

      try {
        const url = api && hasElectronEnrich
          ? await api.enrichLocalArtwork({
              artist: track.artist,
              title: track.title,
              durationSec: track.durationSec,
            })
          : await fetchItunesArtworkInBrowser(track.artist, track.title);

        if (url && typeof url === 'string' && !url.startsWith('data:')) {
          onTrackUpdated(track.videoId, {
            thumbnailUrl: url,
            artworkUrl: url,
          });
        }
      } catch {
        // Non-blocking background enrichment: swallow per-track errors
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
}
