// electron/localMetadata.ts
// Local audio metadata extraction (music-metadata), embedded & folder cover art extraction,
// persistent disk-backed local library cache, incremental folder scanning, and non-blocking web artwork fallback.

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
  { ext: '.jpeg', mime: 'image/jpeg' },
  { ext: '.png', mime: 'image/png' },
  { ext: '.webp', mime: 'image/webp' },
];

const FOLDER_COVER_NAMES = [
  'cover.jpg',
  'cover.jpeg',
  'cover.png',
  'cover.webp',
  'folder.jpg',
  'folder.jpeg',
  'folder.png',
  'folder.webp',
  'front.jpg',
  'front.jpeg',
  'front.png',
  'front.webp',
  'album.jpg',
  'album.jpeg',
  'album.png',
  'album.webp',
];

const NEGATIVE_CACHE_TTL_MS = 7 * 86400 * 1000;
const LOCAL_LIBRARY_CACHE_FILENAME = 'local-library-cache.json';

export interface LocalLibraryCacheData {
  version: 1;
  folders: string[];
  tracks: any[];
  updatedAt: number;
}

export interface IncrementalScanResult {
  folders: string[];
  tracks: any[];
  added: number;
  updated: number;
  removed: number;
}

function sha1Hex(input: string | Buffer | Uint8Array): string {
  return createHash('sha1').update(input).digest('hex');
}

function normalizeFsPath(filePath: string): string {
  if (!filePath) return '';
  const resolved = path.resolve(filePath).replace(/\\/g, '/');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function extForMime(mime?: string): string {
  const normalized = (mime || '').toLowerCase();
  if (normalized.includes('png')) return '.png';
  if (normalized.includes('webp')) return '.webp';
  return '.jpg';
}

function formatSampleRateKhz(sampleRate: number): string {
  const khz = sampleRate / 1000;
  return Number.isInteger(khz) ? String(khz) : khz.toFixed(1).replace(/\.0$/, '');
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

async function writeJsonAtomicFile(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  const content = JSON.stringify(data, null, 2);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;

  try {
    await fs.promises.writeFile(tmpPath, content, 'utf8');
    let renamed = false;
    let lastErr: unknown = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await fs.promises.rename(tmpPath, filePath);
        renamed = true;
        break;
      } catch (err: any) {
        lastErr = err;
        if (err?.code === 'EPERM' || err?.code === 'EEXIST' || err?.code === 'EBUSY' || err?.code === 'EACCES') {
          try {
            if (fs.existsSync(filePath)) {
              await fs.promises.unlink(filePath);
            }
            await fs.promises.rename(tmpPath, filePath);
            renamed = true;
            break;
          } catch (innerErr) {
            lastErr = innerErr;
            await new Promise((r) => setTimeout(r, 15 * (attempt + 1)));
          }
        } else {
          throw err;
        }
      }
    }

    if (!renamed) {
      try {
        await fs.promises.writeFile(filePath, content, 'utf8');
      } catch {
        throw lastErr;
      }
    }
  } finally {
    try {
      if (fs.existsSync(tmpPath)) {
        await fs.promises.unlink(tmpPath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

async function writeHashedArtworkFile(
  userDataPath: string,
  bytes: Buffer | Uint8Array,
  ext: string
): Promise<{ artworkHash: string; thumbnailUrl: string }> {
  const artworkHash = sha1Hex(bytes);
  const artDir = path.join(userDataPath, 'artwork-cache');
  const safeExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  const outPath = path.join(artDir, `${artworkHash}${safeExt}`);
  if (!fs.existsSync(outPath)) {
    await fs.promises.mkdir(artDir, { recursive: true });
    await fs.promises.writeFile(outPath, bytes);
  }
  return {
    artworkHash,
    thumbnailUrl: 'waveform-local://art?key=' + encodeURIComponent(artworkHash),
  };
}

async function findFolderCoverArt(
  dir: string,
  userDataPath: string,
  cache: Map<string, { artworkHash: string; thumbnailUrl: string } | null>
): Promise<{ artworkHash: string; thumbnailUrl: string } | null> {
  const normDir = normalizeFsPath(dir);
  if (cache.has(normDir)) {
    return cache.get(normDir) ?? null;
  }

  let result: { artworkHash: string; thumbnailUrl: string } | null = null;
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const byLower = new Map<string, string>();
    for (const entry of entries) {
      if (entry.isFile()) {
        byLower.set(entry.name.toLowerCase(), entry.name);
      }
    }
    for (const candidateName of FOLDER_COVER_NAMES) {
      const matchedName = byLower.get(candidateName);
      if (!matchedName) continue;
      const fullCoverPath = path.join(dir, matchedName);
      try {
        const bytes = await fs.promises.readFile(fullCoverPath);
        if (bytes.length > 0) {
          const ext = path.extname(matchedName).toLowerCase() || '.jpg';
          result = await writeHashedArtworkFile(userDataPath, bytes, ext);
          break;
        }
      } catch {
        // Try next candidate
      }
    }
  } catch {
    // Non-fatal
  }

  cache.set(normDir, result);
  return result;
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

async function parseSingleAudioFile(
  full: string,
  dir: string,
  root: string,
  stat: fs.Stats,
  userDataPath: string,
  folderArtCache: Map<string, { artworkHash: string; thumbnailUrl: string } | null>
): Promise<Record<string, any>> {
  const ext = path.extname(full).toLowerCase();
  const baseName = path.basename(full);
  const stem = path.basename(baseName, ext).replace(/^\d{1,3}[\s._-]+/, '');
  const dash = stem.indexOf(' - ');
  const parent = path.basename(dir);
  const fallbackArtist = dash > 0 ? stem.slice(0, dash).trim() : 'Unknown Artist';
  const fallbackTitle = (dash > 0 ? stem.slice(dash + 3) : stem).trim() || stem;
  const fallbackAlbum =
    parent && normalizeFsPath(dir) !== normalizeFsPath(root) ? parent : null;

  let meta: IAudioMetadata | null = null;
  try {
    meta = await parseFile(full, { duration: true, skipCovers: false });
  } catch {
    meta = null;
  }

  const title = (meta?.common?.title || '').trim() || fallbackTitle;
  const artist =
    (meta?.common?.artist || meta?.common?.albumartist || '').trim() || fallbackArtist;
  const albumArtist =
    (meta?.common?.albumartist || meta?.common?.artist || artist || 'Unknown Artist').trim();
  const album = (meta?.common?.album || '').trim() || fallbackAlbum;
  const trackNumber =
    typeof meta?.common?.track?.no === 'number' && meta.common.track.no > 0
      ? meta.common.track.no
      : undefined;
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
  const bitDepth =
    typeof meta?.format?.bitsPerSample === 'number' && meta.format.bitsPerSample > 0
      ? meta.format.bitsPerSample
      : undefined;
  const sampleRate =
    typeof meta?.format?.sampleRate === 'number' && meta.format.sampleRate > 0
      ? meta.format.sampleRate
      : undefined;
  const format = ext.slice(1).toUpperCase();
  const codec = (meta?.format?.codec || format).trim();
  const sourceQuality =
    bitDepth && sampleRate
      ? `${bitDepth}-bit / ${formatSampleRateKhz(sampleRate)}kHz ${format}`
      : bitrate
      ? `${bitrate}kbps ${format}`
      : format;

  const cacheKey = computeMetadataCacheKey(artist, title, durationSec);

  let artworkHash: string | null = null;
  let thumbnailUrl: string | null = null;

  // 1. Embedded cover art
  const pic: IPicture | undefined = meta?.common?.picture?.[0];
  if (pic?.data && pic.data.length > 0) {
    try {
      const artExt = extForMime(pic.format);
      const saved = await writeHashedArtworkFile(userDataPath, pic.data, artExt);
      artworkHash = saved.artworkHash;
      thumbnailUrl = saved.thumbnailUrl;
    } catch {
      // Non-fatal: continue without embedded cover art
    }
  }

  // 2. Folder-level cover.jpg / folder.jpg / front.png fallback
  if (!thumbnailUrl) {
    const folderArt = await findFolderCoverArt(dir, userDataPath, folderArtCache);
    if (folderArt) {
      artworkHash = folderArt.artworkHash;
      thumbnailUrl = folderArt.thumbnailUrl;
    }
  }

  // 3. Cached web artwork fallback
  if (!thumbnailUrl) {
    const cached = await readMetadataDiskCache(userDataPath, cacheKey);
    if (cached?.artworkUrl && typeof cached.artworkUrl === 'string') {
      thumbnailUrl = cached.artworkUrl;
    }
  }

  const lyrics = meta ? extractEmbeddedLyrics(meta) : null;

  const normPath = normalizeFsPath(full);
  const videoId = 'local_' + sha1Hex(normPath).slice(0, 20);
  const normArtist = (artist || 'Unknown Artist').trim().toLowerCase();
  const artistId = 'local_art_' + sha1Hex(normArtist).slice(0, 14);
  const normAlbum = (album || '').trim().toLowerCase();
  const normAlbumArtist = (albumArtist || artist || 'Unknown Artist').trim().toLowerCase();
  const albumId = album
    ? 'local_alb_' + sha1Hex(`${normAlbum}|${normAlbumArtist}`).slice(0, 14)
    : null;

  return {
    id: videoId,
    videoId,
    localFilePath: full,
    folderPath: path.resolve(root),
    mtimeMs: stat.mtimeMs,
    lastModifiedMs: stat.mtimeMs,
    size: stat.size,
    fileSizeBytes: stat.size,
    title,
    artist,
    artists: [{ id: artistId, name: artist }],
    artistId,
    artistIds: [artistId],
    album: album || undefined,
    albumName: album,
    albumArtist,
    albumId,
    trackNumber,
    year,
    durationSec,
    durationText,
    totalPlayTimeMs,
    codec,
    bitDepth,
    sampleRate,
    bitrate,
    sourceQuality,
    audioQuality: sourceQuality,
    artworkHash,
    thumbnailUrl,
    artworkUrl: thumbnailUrl || undefined,
    source: 'local',
    isLocal: true,
    playbackSourceType: 'LOCAL',
    streamUrl: 'waveform-local://file?path=' + encodeURIComponent(full),
    liked: false,
    playCount: 0,
    isExplicit: false,
    hasOriginalAudio: true,
    lyrics: lyrics || null,
    metadataCacheKey: cacheKey,
  };
}

async function collectAudioFiles(
  root: string
): Promise<Array<{ full: string; dir: string; stat: fs.Stats }>> {
  const results: Array<{ full: string; dir: string; stat: fs.Stats }> = [];

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

      try {
        const stat = await fs.promises.stat(full);
        results.push({ full, dir, stat });
      } catch {
        continue;
      }
    }
  };

  await walk(root);
  return results;
}

export async function scanAudioFolderWithMetadata(
  root: string,
  userDataPath: string
): Promise<any[]> {
  const files = await collectAudioFiles(root);
  const folderArtCache = new Map<string, { artworkHash: string; thumbnailUrl: string } | null>();
  const songs: any[] = [];

  for (const { full, dir, stat } of files) {
    const track = await parseSingleAudioFile(full, dir, root, stat, userDataPath, folderArtCache);
    songs.push(track);
  }

  return songs;
}

function dedupeFolders(folders: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of folders) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const resolved = path.resolve(raw.trim());
    const norm = normalizeFsPath(resolved);
    if (!seen.has(norm)) {
      seen.add(norm);
      result.push(resolved);
    }
  }
  return result;
}

function sanitizeTracksForDisk(tracks: any[]): any[] {
  if (!Array.isArray(tracks)) return [];
  return tracks
    .filter((t) => t && typeof t === 'object' && typeof t.videoId === 'string')
    .map((t) => {
      const copy = { ...t };
      // Never persist multi-MB base64 data URIs inside the JSON index
      if (typeof copy.thumbnailUrl === 'string' && copy.thumbnailUrl.startsWith('data:') && copy.thumbnailUrl.length > 2048) {
        copy.thumbnailUrl = copy.artworkHash
          ? 'waveform-local://art?key=' + encodeURIComponent(copy.artworkHash)
          : null;
      }
      if (typeof copy.artworkUrl === 'string' && copy.artworkUrl.startsWith('data:') && copy.artworkUrl.length > 2048) {
        copy.artworkUrl = copy.thumbnailUrl || undefined;
      }
      return copy;
    });
}

export async function loadLocalLibraryCache(
  userDataPath: string
): Promise<LocalLibraryCacheData> {
  const cachePath = path.join(userDataPath, LOCAL_LIBRARY_CACHE_FILENAME);
  try {
    const raw = await fs.promises.readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        version: 1,
        folders: Array.isArray(parsed.folders) ? dedupeFolders(parsed.folders) : [],
        tracks: Array.isArray(parsed.tracks) ? parsed.tracks : [],
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      };
    }
  } catch {
    // Cache absent or unreadable; return empty state
  }
  return {
    version: 1,
    folders: [],
    tracks: [],
    updatedAt: 0,
  };
}

export async function saveLocalLibraryCache(
  userDataPath: string,
  payload: { folders: string[]; tracks: any[] }
): Promise<LocalLibraryCacheData> {
  const cachePath = path.join(userDataPath, LOCAL_LIBRARY_CACHE_FILENAME);
  const data: LocalLibraryCacheData = {
    version: 1,
    folders: dedupeFolders(Array.isArray(payload?.folders) ? payload.folders : []),
    tracks: sanitizeTracksForDisk(Array.isArray(payload?.tracks) ? payload.tracks : []),
    updatedAt: Date.now(),
  };
  await writeJsonAtomicFile(cachePath, data);
  return data;
}

export async function incrementalScanLocalFolders(
  userDataPath: string,
  extraFolders?: string[]
): Promise<IncrementalScanResult> {
  const existing = await loadLocalLibraryCache(userDataPath);
  const folders = dedupeFolders([
    ...existing.folders,
    ...(Array.isArray(extraFolders) ? extraFolders : []),
  ]);

  const cachedByPath = new Map<string, any>();
  for (const track of existing.tracks) {
    if (track && typeof track.localFilePath === 'string' && track.localFilePath) {
      cachedByPath.set(normalizeFsPath(track.localFilePath), track);
    }
  }

  const seenPaths = new Set<string>();
  const nextTracks: any[] = [];
  const folderArtCache = new Map<string, { artworkHash: string; thumbnailUrl: string } | null>();

  let added = 0;
  let updated = 0;

  for (const folder of folders) {
    const files = await collectAudioFiles(folder);
    for (const { full, dir, stat } of files) {
      const normFull = normalizeFsPath(full);
      if (seenPaths.has(normFull)) continue;
      seenPaths.add(normFull);

      const prev = cachedByPath.get(normFull);
      const prevMtime = typeof prev?.mtimeMs === 'number' ? prev.mtimeMs : prev?.lastModifiedMs;
      const prevSize = typeof prev?.size === 'number' ? prev.size : prev?.fileSizeBytes;

      if (prev && prevMtime === stat.mtimeMs && prevSize === stat.size) {
        // Unchanged file: skip expensive music-metadata re-parsing
        nextTracks.push({
          ...prev,
          folderPath: prev.folderPath || path.resolve(folder),
          source: 'local',
          isLocal: true,
          playbackSourceType: 'LOCAL',
        });
        continue;
      }

      const parsed = await parseSingleAudioFile(full, dir, folder, stat, userDataPath, folderArtCache);
      if (prev) {
        // Preserve previously enriched remote artwork if new parse has none
        if (!parsed.thumbnailUrl && prev.thumbnailUrl) {
          parsed.thumbnailUrl = prev.thumbnailUrl;
          parsed.artworkUrl = prev.artworkUrl || prev.thumbnailUrl;
        }
        updated++;
      } else {
        added++;
      }
      nextTracks.push(parsed);
    }
  }

  let removed = 0;
  for (const normPath of cachedByPath.keys()) {
    if (!seenPaths.has(normPath)) {
      removed++;
    }
  }

  const saved = await saveLocalLibraryCache(userDataPath, {
    folders,
    tracks: nextTracks,
  });

  return {
    folders: saved.folders,
    tracks: saved.tracks,
    added,
    updated,
    removed,
  };
}

export async function removeLocalLibraryFolder(
  userDataPath: string,
  folderPath: string
): Promise<LocalLibraryCacheData> {
  const existing = await loadLocalLibraryCache(userDataPath);
  const targetNorm = normalizeFsPath(folderPath);
  const targetPrefix = targetNorm.endsWith('/') ? targetNorm : `${targetNorm}/`;

  const remainingFolders = existing.folders.filter((f) => normalizeFsPath(f) !== targetNorm);
  const remainingNorms = remainingFolders.map((f) => {
    const n = normalizeFsPath(f);
    return { norm: n, prefix: n.endsWith('/') ? n : `${n}/` };
  });

  const remainingTracks = existing.tracks.filter((track) => {
    if (!track || typeof track !== 'object') return false;
    const trackFolderNorm = track.folderPath ? normalizeFsPath(track.folderPath) : '';
    const trackFileNorm = track.localFilePath ? normalizeFsPath(track.localFilePath) : '';

    const belongsToRemoved =
      trackFolderNorm === targetNorm ||
      trackFileNorm === targetNorm ||
      trackFileNorm.startsWith(targetPrefix);

    if (!belongsToRemoved) return true;

    // Keep track only if it also belongs to another remaining configured folder
    return remainingNorms.some(
      ({ norm, prefix }) => trackFileNorm === norm || trackFileNorm.startsWith(prefix)
    );
  });

  return saveLocalLibraryCache(userDataPath, {
    folders: remainingFolders,
    tracks: remainingTracks,
  });
}

export async function resolveArtProtocolResponse(
  url: URL,
  userDataPath: string
): Promise<Response> {
  const key = (url.searchParams.get('key') || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (key) {
    const artDirs = [
      path.join(userDataPath, 'artwork-cache'),
      path.join(userDataPath, 'metadata-cache', 'art'),
    ];
    for (const artDir of artDirs) {
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
          // Try next extension / directory
        }
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
