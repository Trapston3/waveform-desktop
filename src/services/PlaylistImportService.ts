// src/services/PlaylistImportService.ts
// Concurrent track matching & playlist import service (Spotify / Apple Music / YouTube Music URLs)

import type { Song } from '../models/Song';
import { normalizeSong } from '../models/Song';
import { MusicService } from './MusicService';
import { TrackMatcher, type MatchCandidate } from './TrackMatcher';
import { getPlatformBridge, hasPlatformBridge } from '../platform/index';

export type ImportedSource = 'spotify' | 'apple' | 'youtube';

export interface ImportedRawTrack {
  title: string;
  artist: string;
  album?: string;
  durationSec: number;
  artworkUrl?: string | null;
  isrc?: string | null;
  videoId?: string | null;
}

export interface ImportedPlaylistData {
  source: ImportedSource;
  kind: 'playlist' | 'album';
  id: string;
  title: string;
  owner?: string;
  description?: string;
  thumbnailUrl?: string | null;
  sourceUrl: string;
  tracks: ImportedRawTrack[];
  preloadedSongs?: Song[];
}

export interface MatchedImportTrack {
  raw: ImportedRawTrack;
  song: Song | null;
  matched: boolean;
}

export interface MatchProgress {
  completed: number;
  total: number;
  matchedCount: number;
}

export function detectImportUrlSource(rawUrl: string): ImportedSource | null {
  const s = (rawUrl || '').trim().toLowerCase();
  if (!s) return null;
  if (s.includes('spotify.com/') || s.startsWith('spotify:')) return 'spotify';
  if (s.includes('music.apple.com/')) return 'apple';
  if ((s.includes('youtube.com/') || s.includes('youtu.be/')) && s.includes('list=')) return 'youtube';
  return null;
}

export const PlaylistImportService = {
  async fetchPreview(url: string): Promise<ImportedPlaylistData> {
    const trimmed = url.trim();

    if (hasPlatformBridge('importPlaylistFromUrl')) {
      const preview = await getPlatformBridge().importPlaylistFromUrl(trimmed);
      if (preview?.source === 'youtube' && preview?.id) {
        const ms = new MusicService();
        const detail = await ms.getReleaseDetails(preview.id, 'playlist');
        if (!detail || detail.songs.length === 0) {
          throw new Error('Could not load tracks from YouTube Music playlist.');
        }
        return {
          source: 'youtube',
          kind: 'playlist',
          id: preview.id,
          title: detail.title || 'YouTube Music Playlist',
          owner: detail.subtitle || undefined,
          description: detail.description || undefined,
          thumbnailUrl: detail.thumbnailUrl || detail.songs[0]?.thumbnailUrl || null,
          sourceUrl: trimmed,
          tracks: detail.songs.map((s) => ({
            title: s.title,
            artist: s.artist,
            album: s.albumName || s.album || undefined,
            durationSec: s.durationSec || 0,
            artworkUrl: s.thumbnailUrl || s.artworkUrl || null,
            videoId: s.videoId,
          })),
          preloadedSongs: detail.songs,
        };
      }
      return preview as ImportedPlaylistData;
    }

    throw new Error('Playlist URL import requires the WaveForm Desktop runtime.');
  },

  async matchTracksConcurrently(
    tracks: ImportedRawTrack[],
    options: {
      concurrency?: number;
      onProgress?: (progress: MatchProgress) => void;
      searchFn?: (query: string) => Promise<any[]>;
    } = {}
  ): Promise<MatchedImportTrack[]> {
    const list = Array.isArray(tracks) ? tracks : [];
    const concurrency = Math.max(1, Math.min(6, options.concurrency ?? 5));
    const musicService = options.searchFn ? null : new MusicService();
    const searchFn =
      options.searchFn ??
      (async (q: string) => {
        const res = await musicService!.search(q, 'songs');
        return Array.isArray(res?.items) ? res.items : [];
      });

    const results: MatchedImportTrack[] = new Array(list.length);
    let nextIdx = 0;
    let completed = 0;
    let matchedCount = 0;

    const searchWithBackoff = async (query: string): Promise<any[]> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await searchFn(query);
        } catch {
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 180));
          }
        }
      }
      return [];
    };

    const worker = async () => {
      while (true) {
        const idx = nextIdx++;
        if (idx >= list.length) break;
        const raw = list[idx];

        let matchedSong: Song | null = null;
        if (raw.videoId && /^[A-Za-z0-9_-]{11}$/.test(raw.videoId)) {
          matchedSong = normalizeSong({
            videoId: raw.videoId,
            title: raw.title,
            artist: raw.artist,
            albumName: raw.album || null,
            durationSec: raw.durationSec || undefined,
            thumbnailUrl: raw.artworkUrl || null,
            playbackSourceType: 'YOUTUBE',
          });
        } else {
          let candidates: any[] = [];
          if (raw.isrc) {
            candidates = await searchWithBackoff(raw.isrc);
          }
          if (candidates.length === 0) {
            candidates = await searchWithBackoff(`${raw.title} ${raw.artist}`.trim());
          }

          const songCandidates = candidates.filter(
            (c: any) => c && !c.isArtist && !c.isAlbum && !c.isPlaylist && (c.videoId || c.id)
          );
          const matchCands: MatchCandidate[] = songCandidates.map((c: any) => ({
            id: c.id,
            videoId: c.videoId || c.id,
            title: c.title || '',
            artist: c.artist || c.subtitle || '',
            durationSec: typeof c.durationSec === 'number' ? c.durationSec : undefined,
            durationText: c.durationText || c.secondaryText || null,
            musicVideoType: c.musicVideoType || null,
          }));

          const ranked = TrackMatcher.rankCandidates(matchCands, {
            title: raw.title,
            artist: raw.artist,
            durationSec: raw.durationSec > 0 ? raw.durationSec : null,
            album: raw.album || null,
          });
          const best = ranked[0] || matchCands[0];
          const rawBest = best
            ? songCandidates.find((c: any) => (c.videoId || c.id) === (best.videoId || best.id)) || best
            : null;

          if (rawBest && (rawBest.videoId || rawBest.id)) {
            matchedSong = normalizeSong({
              videoId: rawBest.videoId || rawBest.id,
              title: raw.title || rawBest.title,
              artist: raw.artist || rawBest.artist || rawBest.subtitle || 'Unknown Artist',
              albumName: raw.album || rawBest.albumName || null,
              durationSec: raw.durationSec || rawBest.durationSec || undefined,
              durationText: rawBest.durationText || rawBest.secondaryText || null,
              thumbnailUrl: raw.artworkUrl || rawBest.thumbnailUrl || rawBest.artworkUrl || null,
              playbackSourceType: 'YOUTUBE',
            });
          }
        }

        if (matchedSong) matchedCount += 1;
        results[idx] = {
          raw,
          song: matchedSong,
          matched: Boolean(matchedSong),
        };
        completed += 1;
        options.onProgress?.({
          completed,
          total: list.length,
          matchedCount,
        });
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, Math.max(1, list.length)) }, () =>
      worker()
    );
    await Promise.all(workers);

    return results;
  },
};
