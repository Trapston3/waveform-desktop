import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MIN_CACHE_LIMIT_GB = 1;
export const MAX_CACHE_LIMIT_GB = 50;
export const DEFAULT_CACHE_LIMIT_GB = 5;
export const BYTES_PER_GB = 1024 * 1024 * 1024;

export interface OfflineCacheEntry {
  trackId: string;
  title: string;
  artist: string;
  album?: string;
  fileName: string;
  filePath: string;
  ext: string;
  mimeType: string;
  sizeBytes: number;
  pinned: boolean;
  createdAt: number;
  lastAccessedAt: number;
}

export interface OfflineCacheStats {
  limitBytes: number;
  limitGb: number;
  totalBytes: number;
  pinnedBytes: number;
  unpinnedBytes: number;
  pinnedCount: number;
  unpinnedCount: number;
  pinnedTrackIds: string[];
}

export interface OfflineCacheResolveResult {
  trackId: string;
  filePath: string;
  url: string;
  pinned: boolean;
  sizeBytes: number;
  mimeType: string;
}

export interface OfflineCachePinInput {
  trackId: string;
  title?: string;
  artist?: string;
  album?: string;
  streamUrl?: string;
  localFilePath?: string;
  ext?: string;
  mimeType?: string;
}

export interface OfflineFetchResponse {
  ok: boolean;
  status: number;
  headers?: { get?: (name: string) => string | null };
  arrayBuffer: () => Promise<ArrayBuffer>;
}

export type OfflineFetchFn = (url: string) => Promise<OfflineFetchResponse>;

export function clampCacheLimitGb(gb: number): number {
  if (!Number.isFinite(gb)) return DEFAULT_CACHE_LIMIT_GB;
  return Math.max(MIN_CACHE_LIMIT_GB, Math.min(MAX_CACHE_LIMIT_GB, Math.round(gb)));
}

export function clampCacheLimitBytes(bytes: number): number {
  if (!Number.isFinite(bytes)) return DEFAULT_CACHE_LIMIT_GB * BYTES_PER_GB;
  return Math.max(
    MIN_CACHE_LIMIT_GB * BYTES_PER_GB,
    Math.min(MAX_CACHE_LIMIT_GB * BYTES_PER_GB, Math.round(bytes))
  );
}

function inferExtFromMimeOrUrl(mime?: string, url?: string, explicitExt?: string): string {
  const validExts = new Set(['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.opus', '.webm']);
  if (explicitExt) {
    const e = explicitExt.startsWith('.') ? explicitExt.toLowerCase() : `.${explicitExt.toLowerCase()}`;
    if (validExts.has(e)) return e;
  }
  const lowMime = (mime || '').toLowerCase();
  if (lowMime.includes('flac')) return '.flac';
  if (lowMime.includes('wav')) return '.wav';
  if (lowMime.includes('mp4') || lowMime.includes('m4a') || lowMime.includes('aac')) return '.m4a';
  if (lowMime.includes('mpeg') || lowMime.includes('mp3')) return '.mp3';
  if (lowMime.includes('webm')) return '.webm';
  if (lowMime.includes('opus')) return '.opus';
  if (lowMime.includes('ogg')) return '.ogg';
  if (url) {
    try {
      const cleanPath = url.split('?')[0].split('#')[0];
      const ext = path.extname(cleanPath).toLowerCase();
      if (validExts.has(ext)) return ext;
    } catch {}
  }
  return '.m4a';
}

function defaultOfflineFetch(url: string): Promise<OfflineFetchResponse> {
  return fetch(url) as unknown as Promise<OfflineFetchResponse>;
}

export class OfflineCacheManager {
  private readonly cacheDir: string;
  private readonly indexPath: string;
  private readonly fetchFn: OfflineFetchFn;
  private limitBytes: number = DEFAULT_CACHE_LIMIT_GB * BYTES_PER_GB;
  private entries: Record<string, OfflineCacheEntry> = {};

  constructor(
    userDataPath: string,
    options?: {
      limitBytes?: number;
      fetchFn?: OfflineFetchFn;
    }
  ) {
    this.cacheDir = path.join(userDataPath, 'offline-cache');
    this.indexPath = path.join(this.cacheDir, 'cache-index.json');
    this.fetchFn = options?.fetchFn ?? defaultOfflineFetch;
    this.loadIndex();
    if (typeof options?.limitBytes === 'number') {
      this.limitBytes = clampCacheLimitBytes(options.limitBytes);
    }
  }

  private loadIndex(): void {
    try {
      if (!fs.existsSync(this.indexPath)) {
        this.entries = {};
        return;
      }
      const parsed = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.limitBytes === 'number') {
          this.limitBytes = clampCacheLimitBytes(parsed.limitBytes);
        }
        if (parsed.entries && typeof parsed.entries === 'object') {
          const valid: Record<string, OfflineCacheEntry> = {};
          for (const [k, raw] of Object.entries<any>(parsed.entries)) {
            if (!raw || typeof raw !== 'object' || !raw.trackId || !raw.fileName) continue;
            const filePath = path.join(this.cacheDir, path.basename(raw.fileName));
            if (fs.existsSync(filePath)) {
              valid[k] = {
                ...raw,
                filePath,
                sizeBytes: Number(raw.sizeBytes) || fs.statSync(filePath).size,
                pinned: Boolean(raw.pinned),
                createdAt: Number(raw.createdAt) || Date.now(),
                lastAccessedAt: Number(raw.lastAccessedAt) || Date.now(),
              };
            }
          }
          this.entries = valid;
        }
      }
    } catch {
      this.entries = {};
    }
  }

  private saveIndex(): void {
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      const tmp = `${this.indexPath}.${process.pid}.tmp`;
      fs.writeFileSync(
        tmp,
        JSON.stringify(
          {
            version: 1,
            limitBytes: this.limitBytes,
            entries: this.entries,
          },
          null,
          2
        ),
        'utf8'
      );
      fs.renameSync(tmp, this.indexPath);
    } catch {
      // Non-fatal persistence error
    }
  }

  public setLimitBytes(bytes: number): OfflineCacheStats {
    this.limitBytes = clampCacheLimitBytes(bytes);
    this.enforceCacheLimit();
    this.saveIndex();
    return this.getStats();
  }

  public setLimitGb(gb: number): OfflineCacheStats {
    return this.setLimitBytes(clampCacheLimitGb(gb) * BYTES_PER_GB);
  }

  private buildLocalUrl(filePath: string): string {
    return `waveform-local://audio?path=${encodeURIComponent(filePath)}`;
  }

  private resolveSourceFilePath(rawUrlOrPath?: string): string | null {
    if (!rawUrlOrPath || typeof rawUrlOrPath !== 'string') return null;
    const trimmed = rawUrlOrPath.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('waveform-local://')) {
      try {
        const u = new URL(trimmed);
        const p = u.searchParams.get('path') || '';
        return p && fs.existsSync(p) ? p : null;
      } catch {
        return null;
      }
    }
    if (trimmed.startsWith('local://')) {
      const p = trimmed.slice('local://'.length);
      return fs.existsSync(p) ? p : null;
    }
    if (trimmed.startsWith('file://')) {
      try {
        let p = decodeURIComponent(new URL(trimmed).pathname);
        if (process.platform === 'win32' && /^\/[a-zA-Z]:\//.test(p)) p = p.slice(1);
        return fs.existsSync(p) ? p : null;
      } catch {
        return null;
      }
    }
    if (fs.existsSync(trimmed)) return trimmed;
    return null;
  }

  private async writeTrackBytes(
    input: OfflineCachePinInput,
    pinned: boolean
  ): Promise<OfflineCacheEntry> {
    const trackId = String(input.trackId || '').trim();
    if (!trackId) throw new Error('trackId is required');

    const now = Date.now();
    const existing = this.entries[trackId];
    if (existing && fs.existsSync(existing.filePath)) {
      existing.pinned = pinned ? true : existing.pinned;
      existing.lastAccessedAt = now;
      if (input.title) existing.title = input.title;
      if (input.artist) existing.artist = input.artist;
      if (input.album) existing.album = input.album;
      this.enforceCacheLimit();
      this.saveIndex();
      return existing;
    }

    fs.mkdirSync(this.cacheDir, { recursive: true });
    const hash = createHash('sha1').update(trackId).digest('hex').slice(0, 16);

    const localSrc =
      this.resolveSourceFilePath(input.localFilePath) ||
      this.resolveSourceFilePath(input.streamUrl);

    let bufferData: Buffer;
    let detectedMime = input.mimeType || 'audio/mp4';
    let ext = inferExtFromMimeOrUrl(detectedMime, localSrc || input.streamUrl, input.ext);

    if (localSrc) {
      bufferData = await fs.promises.readFile(localSrc);
      ext = inferExtFromMimeOrUrl(detectedMime, localSrc, input.ext);
    } else if (input.streamUrl && /^https?:\/\//i.test(input.streamUrl)) {
      const resp = await this.fetchFn(input.streamUrl);
      if (!resp.ok) {
        throw new Error(`Failed to fetch track stream (HTTP ${resp.status})`);
      }
      const headerMime = resp.headers?.get?.('content-type') || '';
      if (headerMime) detectedMime = headerMime.split(';')[0].trim();
      ext = inferExtFromMimeOrUrl(detectedMime, input.streamUrl, input.ext);
      const ab = await resp.arrayBuffer();
      bufferData = Buffer.from(ab);
      if (bufferData.byteLength === 0) {
        throw new Error('Downloaded empty audio stream');
      }
    } else {
      throw new Error('No playable local file path or HTTP stream URL available to cache');
    }

    const fileName = `${hash}${ext}`;
    const filePath = path.join(this.cacheDir, fileName);
    const tmp = `${filePath}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, bufferData);
    await fs.promises.rename(tmp, filePath);

    const entry: OfflineCacheEntry = {
      trackId,
      title: input.title || 'Untitled',
      artist: input.artist || 'Unknown Artist',
      album: input.album,
      fileName,
      filePath,
      ext,
      mimeType: detectedMime,
      sizeBytes: bufferData.byteLength,
      pinned,
      createdAt: now,
      lastAccessedAt: now,
    };
    this.entries[trackId] = entry;
    this.enforceCacheLimit();
    this.saveIndex();
    return entry;
  }

  public async pinTrack(input: OfflineCachePinInput): Promise<OfflineCacheStats> {
    await this.writeTrackBytes(input, true);
    return this.getStats();
  }

  public async cacheStream(input: OfflineCachePinInput): Promise<OfflineCacheStats> {
    await this.writeTrackBytes(input, false);
    return this.getStats();
  }

  public unpinTrack(trackId: string): OfflineCacheStats {
    const entry = this.entries[trackId];
    if (entry) {
      entry.pinned = false;
      this.enforceCacheLimit();
      this.saveIndex();
    }
    return this.getStats();
  }

  /**
   * LRU eviction over unpinned entries only whenever totalBytes exceeds limitBytes.
   * Pinned tracks are never evicted by limit enforcement.
   */
  public enforceCacheLimit(): { evictedIds: string[]; freedBytes: number } {
    let totalBytes = 0;
    for (const entry of Object.values(this.entries)) {
      totalBytes += Math.max(0, entry.sizeBytes || 0);
    }
    if (totalBytes <= this.limitBytes) {
      return { evictedIds: [], freedBytes: 0 };
    }

    const unpinnedLru = Object.values(this.entries)
      .filter((e) => !e.pinned)
      .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

    const evictedIds: string[] = [];
    let freedBytes = 0;
    for (const candidate of unpinnedLru) {
      if (totalBytes <= this.limitBytes) break;
      try {
        if (fs.existsSync(candidate.filePath)) {
          fs.unlinkSync(candidate.filePath);
        }
      } catch {
        // Ignore unlink errors during eviction
      }
      delete this.entries[candidate.trackId];
      totalBytes -= Math.max(0, candidate.sizeBytes || 0);
      freedBytes += Math.max(0, candidate.sizeBytes || 0);
      evictedIds.push(candidate.trackId);
    }
    if (evictedIds.length > 0) {
      this.saveIndex();
    }
    return { evictedIds, freedBytes };
  }

  public clearUnpinnedCache(): { removedCount: number; freedBytes: number; stats: OfflineCacheStats } {
    let removedCount = 0;
    let freedBytes = 0;
    for (const entry of Object.values(this.entries)) {
      if (entry.pinned) continue;
      try {
        if (fs.existsSync(entry.filePath)) {
          fs.unlinkSync(entry.filePath);
        }
      } catch {}
      freedBytes += Math.max(0, entry.sizeBytes || 0);
      removedCount += 1;
      delete this.entries[entry.trackId];
    }
    this.saveIndex();
    return { removedCount, freedBytes, stats: this.getStats() };
  }

  public resolveCachedTrack(trackId: string): OfflineCacheResolveResult | null {
    const key = String(trackId || '').trim();
    if (!key) return null;
    const entry = this.entries[key];
    if (!entry) return null;
    if (!fs.existsSync(entry.filePath)) {
      delete this.entries[key];
      this.saveIndex();
      return null;
    }
    entry.lastAccessedAt = Date.now();
    this.saveIndex();
    return {
      trackId: entry.trackId,
      filePath: entry.filePath,
      url: this.buildLocalUrl(entry.filePath),
      pinned: entry.pinned,
      sizeBytes: entry.sizeBytes,
      mimeType: entry.mimeType,
    };
  }

  public getStats(): OfflineCacheStats {
    let totalBytes = 0;
    let pinnedBytes = 0;
    let unpinnedBytes = 0;
    let pinnedCount = 0;
    let unpinnedCount = 0;
    const pinnedTrackIds: string[] = [];

    for (const entry of Object.values(this.entries)) {
      const sz = Math.max(0, entry.sizeBytes || 0);
      totalBytes += sz;
      if (entry.pinned) {
        pinnedBytes += sz;
        pinnedCount += 1;
        pinnedTrackIds.push(entry.trackId);
      } else {
        unpinnedBytes += sz;
        unpinnedCount += 1;
      }
    }

    return {
      limitBytes: this.limitBytes,
      limitGb: Math.max(MIN_CACHE_LIMIT_GB, Math.round(this.limitBytes / BYTES_PER_GB)),
      totalBytes,
      pinnedBytes,
      unpinnedBytes,
      pinnedCount,
      unpinnedCount,
      pinnedTrackIds,
    };
  }
}
