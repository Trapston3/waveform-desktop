// electron/localMetadata.ts
// Local audio metadata extraction (music-metadata), embedded art/lyrics extraction,
// persistent disk cache, and non-blocking web artwork fallback.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseFile } from 'music-metadata';
import type { IAudioMetadata, ILyricsTag, IPicture } from 'music-metadata';

const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.flac',
  '.wav',
  '.m4a',
  '.aac',
  '.ogg',
  '.opus',
  '.mp4',
  '.webm',
]);

const ART_EXT_MIME: Array<{ ext: string; mime: string }> = [
  { ext: '.jpg', mime: 'image/jpeg' },
  { ext: '.png', mime: 'image/png' },
  { ext: '.webp', mime: 'image/webp' },
];

const NEGATIVE_CACHE_TTL_MS = 7 * 86400 * 1000;

function extForMime(mime?: string): string {
  const normalized = (mime || '').toLowerCase();
  if (normalized.includes('png')) return '.png';
  if (normalized.includes('webp')) return '.webp';
  return '.jpg';
}

function formatLrcTimestamp(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms));
  const mins = Math.floor(totalMs / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const centis = Math.floor((totalMs % 1000) / 10);
  return `[${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}]`;
}

function syncTextToLrc(entries: Array<{ timestamp?: number; text?: string }>): string | null {
  const lines = entries
    .filter((entry) => entry && typeof entry.text === 'string' && entry.text.trim().length > 0)
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
    .map((entry) => `${formatLrcTimestamp(entry.timestamp ?? 0)} ${(entry.text || '').trim()}`);
  return lines.length > 0 ? lines.join('\n') : null;
}

function extractEmbeddedLyrics(meta: IAudioMetadata): string | null {
  const commonLyrics = meta.common?.lyrics as Array<string | ILyricsTag> | undefined;
  if (Array.isArray(commonLyrics)) {
    for (const item of commonLyrics) {
      if (typeof item === 'string' && item.trim()) {
        return item.trim();
      }
      if (item && typeof item === 'object') {
        if (Array.isArray(item.syncText) && item.syncText.length > 0) {
          const lrc = syncTextToLrc(item.syncText);
          if (lrc) return lrc;
        }
        if (typeof item.text === 'string' && item.text.trim()) {
          return item.text.trim();
        }
      }
    }
  }

  const native = meta.native || {};
  const targetIds = new Set(['USLT', 'SYLT', '©LYR', 'LYRICS']);
  for (const tagList of Object.values(native)) {
    if (!Array.isArray(tagList)) continue;
    for (const tag of tagList) {
      if (!tag || typeof tag.id !== 'string') continue;
      if (!targetIds.has(tag.id.toUpperCase()) && tag.id !== '©lyr') continue;
      const val = tag.value as any;
      if (typeof val === 'string' && val.trim()) {
        return val.trim();
      }
      if (val && typeof val === 'object') {
        if (Array.isArray(val.syncText) && val.syncText.length > 0) {
          const lrc = syncTextToLrc(val.syncText);
          if (lrc) return lrc;
        }
        if (typeof val.text === 'string' && val.text.trim()) {
          return val.text.trim();
        }
      }
    }
  }

  return null;
}

export function computeMetadataCacheKey(
  artist: string,
  title: string,
  durationSec?: number
): string {
  const normalized = `${(artist || '').trim().toLowerCase()}|${(title || '').trim().toLowerCase()}|${Math.round(durationSec || 0)}`;
  return createHash('sha1').update(normalized).digest('hex');
}

export async function readMetadataDiskCache(
  userDataPath: string,
  key: string
): Promise<Record<string, any> | null> {
  const safeKey = (key || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeKey) return null;
  const filePath = path.join(userDataPath, 'metadata-cache', 'meta', `${safeKey}.json`);
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeMetadataDiskCache(
  userDataPath: string,
  key: string,
  patch: Record<string, any>
): Promise<Record<string, any>> {
  const safeKey = (key || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeKey) return { ...patch };
  const dir = path.join(userDataPath, 'metadata-cache', 'meta');
  await fs.promises.mkdir(dir, { recursive: true });
  const existing = (await readMetadataDiskCache(userDataPath, safeKey)) || {};
  const merged = { ...existing, ...patch };
  await fs.promises.writeFile(
    path.join(dir, `${safeKey}.json`),
    JSON.stringify(merged, null, 2),
    'utf8'
  );
  return merged;
}

export async function scanAudioFolderWithMetadata(
  root: string,
  userDataPath: string
): Promise<any[]> {
  const songs: any[] = [];
  const artDir = path.join(userDataPath, 'metadata-cache', 'art');

  const walk = async (dir: string): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!entry.isFile() || !AUDIO_EXTENSIONS.has(ext)) continue;

      let size = 0;
      try {
        size = (await fs.promises.stat(full)).size;
      } catch {
        continue;
      }

      const stem = path.basename(entry.name, ext).replace(/^\d{1,3}[\s._-]+/, '');
      const dash = stem.indexOf(' - ');
      const parent = path.basename(dir);
      const fallbackArtist = dash > 0 ? stem.slice(0, dash).trim() : 'Unknown Artist';
      const fallbackTitle = (dash > 0 ? stem.slice(dash + 3) : stem).trim() || stem;
      const fallbackAlbum =
        parent && path.resolve(dir) !== path.resolve(root) ? parent : null;

      let meta: IAudioMetadata | null = null;
      try {
        meta = await parseFile(full, { duration: true, skipCovers: false });
      } catch {
        meta = null;
      }

      const title = (meta?.common?.title || '').trim() || fallbackTitle;
      const artist =
        (meta?.common?.artist || meta?.common?.albumartist || '').trim() || fallbackArtist;
      const album = (meta?.common?.album || '').trim() || fallbackAlbum;
      const year = meta?.common?.year ? String(meta.common.year) : null;
      const durationSec = Math.round(meta?.format?.duration || 0);
      const durationText =
        durationSec > 0
          ? `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}`
          : '--:--';
      const totalPlayTimeMs = durationSec * 1000;
      const bitrate = meta?.format?.bitrate
        ? Math.round(meta.format.bitrate / 1000)
        : undefined;
      const format = ext.slice(1).toUpperCase();
      const sourceQuality =
        meta?.format?.bitsPerSample && meta?.format?.sampleRate
          ? `${meta.format.bitsPerSample}-bit / ${Math.round(meta.format.sampleRate / 1000)}kHz ${format}`
          : bitrate
          ? `${bitrate}kbps ${format}`
          : format;

      const cacheKey = computeMetadataCacheKey(artist, title, durationSec);

      let thumbnailUrl: string | null = null;
      const pic: IPicture | undefined = meta?.common?.picture?.[0];
      if (pic?.data && pic.data.length > 0) {
        try {
          const artExt = extForMime(pic.format);
          await fs.promises.mkdir(artDir, { recursive: true });
          await fs.promises.writeFile(path.join(artDir, `${cacheKey}${artExt}`), pic.data);
          thumbnailUrl = 'waveform-local://art?key=' + encodeURIComponent(cacheKey);
        } catch {
          // Non-fatal: continue without embedded cover art
        }
      }

      const lyrics = meta ? extractEmbeddedLyrics(meta) : null;

      if (!thumbnailUrl) {
        const cached = await readMetadataDiskCache(userDataPath, cacheKey);
        if (cached?.artworkUrl && typeof cached.artworkUrl === 'string') {
          thumbnailUrl = cached.artworkUrl;
        }
      }

      const id = 'local_' + Buffer.from(full).toString('base64url').slice(-24);
      songs.push({
        id,
        videoId: id,
        title,
        artist,
        artists: [{ id: null, name: artist }],
        artistIds: [],
        album: album || undefined,
        albumName: album,
        albumId: null,
        year,
        durationSec,
        durationText,
        totalPlayTimeMs,
        bitrate,
        thumbnailUrl,
        artworkUrl: thumbnailUrl || undefined,
        liked: false,
        playCount: 0,
        isExplicit: false,
        streamUrl: 'waveform-local://file?path=' + encodeURIComponent(full),
        localFilePath: full,
        sourceQuality,
        audioQuality: sourceQuality,
        fileSizeBytes: size,
        playbackSourceType: 'LOCAL',
        isLocal: true,
        hasOriginalAudio: true,
        lyrics: lyrics || null,
        metadataCacheKey: cacheKey,
      });
    }
  };

  await walk(root);
  return songs;
}

export async function resolveArtProtocolResponse(
  url: URL,
  userDataPath: string
): Promise<Response> {
  const key = (url.searchParams.get('key') || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (key) {
    const artDir = path.join(userDataPath, 'metadata-cache', 'art');
    for (const { ext, mime } of ART_EXT_MIME) {
      const candidate = path.join(artDir, `${key}${ext}`);
      try {
        const bytes = await fs.promises.readFile(candidate);
        return new Response(new Uint8Array(bytes), {
          status: 200,
          headers: {
            'Content-Type': mime,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=31536000',
          },
        });
      } catch {
        // Try next extension
      }
    }
  }

  return new Response('Not found', {
    status: 404,
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
}

function cleanSearchTerm(value: string): string {
  return (value || '')
    .replace(/\((?:feat\.?|ft\.?|featuring)[^)]*\)/gi, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findYtmSquareThumbnail(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findYtmSquareThumbnail(item);
      if (found) return found;
    }
    return null;
  }

  const obj = node as Record<string, any>;
  if (obj.musicThumbnailRenderer?.thumbnail?.thumbnails) {
    const thumbs = obj.musicThumbnailRenderer.thumbnail.thumbnails as Array<{
      url?: string;
      width?: number;
      height?: number;
    }>;
    if (Array.isArray(thumbs) && thumbs.length > 0) {
      const square = thumbs.filter((t) => t.url && t.width && t.height && t.width === t.height);
      const best = (square.length > 0 ? square : thumbs).at(-1);
      if (best?.url) {
        return best.url.replace(/=w\d+-h\d+[^&]*/i, '=w600-h600-l90-rj');
      }
    }
  }

  for (const val of Object.values(obj)) {
    const found = findYtmSquareThumbnail(val);
    if (found) return found;
  }
  return null;
}

export async function fetchAndCacheArtwork(
  userDataPath: string,
  artist: string,
  title: string,
  durationSec?: number
): Promise<string | null> {
  try {
    const cacheKey = computeMetadataCacheKey(artist, title, durationSec);
    const cached = await readMetadataDiskCache(userDataPath, cacheKey);
    if (cached?.artworkUrl && typeof cached.artworkUrl === 'string') {
      return cached.artworkUrl;
    }
    if (
      cached?.artworkMiss &&
      typeof cached.artworkCheckedAt === 'number' &&
      Date.now() - cached.artworkCheckedAt < NEGATIVE_CACHE_TTL_MS
    ) {
      return null;
    }

    const cleanedArtist =
      artist && artist.toLowerCase() !== 'unknown artist' ? cleanSearchTerm(artist) : '';
    const cleanedTitle = cleanSearchTerm(title);
    const cleanQuery = `${cleanedArtist} ${cleanedTitle}`.trim();
    if (!cleanQuery) return null;

    let artworkUrl: string | null = null;

    // 1. iTunes Search API
    try {
      const res = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(cleanQuery)}&media=music&entity=song&limit=5`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (res.ok) {
        const data = (await res.json()) as { results?: Array<{ artworkUrl100?: string }> };
        const firstUrl = data?.results?.find((r) => typeof r.artworkUrl100 === 'string')
          ?.artworkUrl100;
        if (firstUrl) {
          artworkUrl = firstUrl.replace(/100x100bb/i, '600x600bb');
        }
      }
    } catch {
      // Fall through to YouTube Music search
    }

    // 2. YouTube Music InnerTube Search fallback
    if (!artworkUrl) {
      try {
        const res = await fetch('https://music.youtube.com/youtubei/v1/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            context: {
              client: {
                clientName: 'WEB_REMIX',
                clientVersion: '1.20240101.01.00',
              },
            },
            query: cleanQuery,
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const data = await res.json();
          artworkUrl = findYtmSquareThumbnail(data);
        }
      } catch {
        // Ignore network errors
      }
    }

    if (artworkUrl) {
      await writeMetadataDiskCache(userDataPath, cacheKey, { artworkUrl });
      return artworkUrl;
    }

    await writeMetadataDiskCache(userDataPath, cacheKey, {
      artworkMiss: true,
      artworkCheckedAt: Date.now(),
    });
    return null;
  } catch {
    return null;
  }
}
