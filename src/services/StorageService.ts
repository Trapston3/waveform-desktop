// src/services/StorageService.ts
// Local persistence service with atomic JSON writes conforming to Feature 13

import {
  defaultAppSettings,
  mergeSettings,
  validateSongContract,
  normalizeSong,
} from '../models/index';
import type {
  AppSettings,
  Song,
  Playlist,
  MonthlyHistory,
  ListeningHistoryEntry,
} from '../models/index';

const getNodeBuiltin = (id: string): any => {
  try {
    const proc = (globalThis as any).process;
    if (proc && typeof proc.getBuiltinModule === 'function') {
      return proc.getBuiltinModule(id);
    }
  } catch {
    // Ignore in browser/sandboxed renderer
  }
  return null;
};

const nodeFs = getNodeBuiltin('node:fs');
const nodePath = getNodeBuiltin('node:path');
const browserMemoryStore = new Map<string, string>();

function joinPath(...segments: string[]): string {
  if (nodePath && typeof nodePath.join === 'function') {
    return nodePath.join(...segments);
  }
  return segments
    .map((s) => String(s || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

function resolvePath(filePath: string): string {
  if (nodePath && typeof nodePath.resolve === 'function') {
    return nodePath.resolve(filePath);
  }
  return String(filePath || '').replace(/\\/g, '/');
}

const fileWriteQueues = new Map<string, Promise<void>>();

function runWithFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const normPath = resolvePath(filePath);
  const prev = fileWriteQueues.get(normPath) || Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    return await fn();
  });
  fileWriteQueues.set(
    normPath,
    next.then(() => {}, () => {})
  );
  return next;
}

export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  return runWithFileLock(filePath, async () => {
    const content = JSON.stringify(data, null, 2);

    if (!nodeFs || !nodePath) {
      const key = `waveform_storage:${resolvePath(filePath)}`;
      browserMemoryStore.set(key, content);
      try {
        if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
          (globalThis as any).localStorage.setItem(key, content);
        }
      } catch {
        // Ignore quota/storage errors in restricted contexts
      }
      return;
    }

    const dir = nodePath.dirname(filePath);
    if (!nodeFs.existsSync(dir)) {
      await nodeFs.promises.mkdir(dir, { recursive: true });
    }

    const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;

    try {
      await nodeFs.promises.writeFile(tmpPath, content, 'utf-8');

      const maxRetries = 5;
      let renamed = false;
      let lastErr: any = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          await nodeFs.promises.rename(tmpPath, filePath);
          renamed = true;
          break;
        } catch (err: any) {
          lastErr = err;
          if (err.code === 'EPERM' || err.code === 'EEXIST' || err.code === 'EBUSY' || err.code === 'EACCES') {
            try {
              if (nodeFs.existsSync(filePath)) {
                await nodeFs.promises.unlink(filePath);
              }
              await nodeFs.promises.rename(tmpPath, filePath);
              renamed = true;
              break;
            } catch (innerErr: any) {
              lastErr = innerErr;
              if (attempt < maxRetries) {
                const jitter = 15 + Math.floor(Math.random() * 20) * (attempt + 1);
                await new Promise((resolve) => setTimeout(resolve, jitter));
              }
            }
          } else {
            throw err;
          }
        }
      }

      if (!renamed) {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            await nodeFs.promises.writeFile(filePath, content, 'utf-8');
            renamed = true;
            break;
          } catch (writeErr: any) {
            lastErr = writeErr;
            if (attempt < maxRetries) {
              const jitter = 15 + Math.floor(Math.random() * 20) * (attempt + 1);
              await new Promise((resolve) => setTimeout(resolve, jitter));
            }
          }
        }
        if (!renamed) {
          throw lastErr;
        }
      }
    } finally {
      try {
        if (nodeFs.existsSync(tmpPath)) {
          await nodeFs.promises.unlink(tmpPath);
        }
      } catch {}
    }
  });
}

export async function readJsonSafe<T>(filePath: string, fallback: T): Promise<T> {
  try {
    if (!nodeFs || !nodePath) {
      const key = `waveform_storage:${resolvePath(filePath)}`;
      let raw: string | null | undefined = null;
      try {
        if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
          raw = (globalThis as any).localStorage.getItem(key);
        }
      } catch {
        // Ignore storage read error
      }
      if (!raw) {
        raw = browserMemoryStore.get(key) ?? null;
      }
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    }

    if (!nodeFs.existsSync(filePath)) return fallback;
    const raw = await nodeFs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`[Storage] Failed to read ${filePath}, using fallback:`, err);
    return fallback;
  }
}

export interface RichListeningHistoryEntry extends ListeningHistoryEntry {
  sessionId?: string;
  startedAt?: number;
  listenedSeconds?: number;
  trackDurationSec?: number;
  countedPlay?: boolean;
  albumName?: string;
  artworkUrl?: string;
  qualityLabel?: string;
}

export function getListeningEntryKey(entry: Partial<RichListeningHistoryEntry>): string {
  if (entry.sessionId && typeof entry.sessionId === 'string' && entry.sessionId.trim()) {
    return `sid:${entry.sessionId.trim()}`;
  }
  const vid = String(entry.videoId || '').trim();
  const ts =
    typeof entry.startedAt === 'number' && Number.isFinite(entry.startedAt)
      ? Math.round(entry.startedAt)
      : typeof entry.timestamp === 'number' && Number.isFinite(entry.timestamp)
      ? Math.round(entry.timestamp)
      : 0;
  return `vt:${vid}|${ts}`;
}

export function mergeListeningEntries(
  existing: RichListeningHistoryEntry[],
  incoming: RichListeningHistoryEntry[]
): RichListeningHistoryEntry[] {
  const byKey = new Map<string, RichListeningHistoryEntry>();
  const ingest = (raw: RichListeningHistoryEntry) => {
    if (!raw || typeof raw.videoId !== 'string' || !raw.videoId.trim()) return;
    const key = getListeningEntryKey(raw);
    const listened = Math.max(
      0,
      Math.round(
        typeof raw.listenedSeconds === 'number' && Number.isFinite(raw.listenedSeconds)
          ? raw.listenedSeconds
          : Number.isFinite(raw.durationSec)
          ? raw.durationSec
          : 0
      )
    );
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, {
        ...raw,
        durationSec: listened,
        listenedSeconds: listened,
      });
      return;
    }
    const prevSec = Math.max(0, Math.round(prev.listenedSeconds ?? prev.durationSec ?? 0));
    const bestSec = Math.max(prevSec, listened);
    byKey.set(key, {
      ...prev,
      ...raw,
      albumName: raw.albumName || prev.albumName,
      artworkUrl: raw.artworkUrl || prev.artworkUrl,
      qualityLabel: raw.qualityLabel || prev.qualityLabel,
      startedAt: prev.startedAt ?? raw.startedAt,
      timestamp: Math.max(prev.timestamp || 0, raw.timestamp || 0),
      durationSec: bestSec,
      listenedSeconds: bestSec,
      countedPlay: Boolean(prev.countedPlay ?? true) || Boolean(raw.countedPlay),
    });
  };
  for (const e of Array.isArray(existing) ? existing : []) ingest(e);
  for (const e of Array.isArray(incoming) ? incoming : []) ingest(e);
  return Array.from(byKey.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

export class ListeningSessionTracker {
  private sessionSeq = 0;
  private active: {
    sessionId: string;
    song: Song;
    startedAt: number;
    trackDurationSec: number;
    totalSec: number;
    flushedSec: number;
    lastFlushAtMs: number;
    countedPlay: boolean;
    lastEngineTimeSec: number;
    lastTickMs: number;
  } | null = null;

  private startSession(song: Song, trackDurationSec: number, engineTimeSec: number, nowMs: number): void {
    this.sessionSeq += 1;
    this.active = {
      sessionId: `ls_${nowMs}_${this.sessionSeq}_${Math.random().toString(36).slice(2, 7)}`,
      song,
      startedAt: nowMs,
      trackDurationSec: Math.max(0, Number.isFinite(trackDurationSec) ? trackDurationSec : 0),
      totalSec: 0,
      flushedSec: 0,
      lastFlushAtMs: nowMs,
      countedPlay: false,
      lastEngineTimeSec: engineTimeSec,
      lastTickMs: nowMs,
    };
  }

  private buildPayload(): RichListeningHistoryEntry | null {
    const s = this.active;
    if (!s) return null;
    const totalRounded = Math.round(s.totalSec);
    if (totalRounded <= 0) return null;
    const albumName =
      (typeof s.song.albumName === 'string' && s.song.albumName.trim()) ||
      (typeof s.song.album === 'string' && s.song.album.trim()) ||
      undefined;
    const artworkUrl = extractEntryArtwork(s.song);
    const qualityLabel = extractEntryQuality(s.song);
    return {
      sessionId: s.sessionId,
      videoId: s.song.videoId,
      title: s.song.title,
      artist: s.song.artist,
      ...(albumName ? { albumName } : {}),
      ...(artworkUrl ? { artworkUrl } : {}),
      ...(qualityLabel ? { qualityLabel } : {}),
      timestamp: s.startedAt,
      startedAt: s.startedAt,
      durationSec: totalRounded,
      listenedSeconds: totalRounded,
      ...(s.trackDurationSec > 0 ? { trackDurationSec: Math.round(s.trackDurationSec) } : {}),
      countedPlay: s.countedPlay,
    };
  }

  onTick(params: {
    song: Song | null;
    isPlaying: boolean;
    isSeeking: boolean;
    engineTimeSec: number;
    durationSec: number;
    nowMs?: number;
  }): RichListeningHistoryEntry[] {
    const nowMs = params.nowMs ?? Date.now();
    const out: RichListeningHistoryEntry[] = [];

    if (!params.song || !params.song.videoId) {
      const flushed = this.flush(nowMs);
      if (flushed) out.push(flushed);
      this.active = null;
      return out;
    }

    const trackId = params.song.videoId;
    if (!this.active || this.active.song.videoId !== trackId) {
      const flushed = this.flush(nowMs);
      if (flushed) out.push(flushed);
      this.startSession(params.song, params.durationSec, params.engineTimeSec, nowMs);
    } else if (
      this.active.countedPlay &&
      params.engineTimeSec < 3 &&
      this.active.lastEngineTimeSec >= 10 &&
      this.active.totalSec >= 10
    ) {
      // Track looped / restarted after being played -> flush completed play and start fresh session
      const flushed = this.flush(nowMs);
      if (flushed) out.push(flushed);
      this.startSession(params.song, params.durationSec, params.engineTimeSec, nowMs);
    }

    const cur = this.active!;
    cur.song = params.song;
    if (params.durationSec > 0) cur.trackDurationSec = params.durationSec;

    if (params.isPlaying && !params.isSeeking) {
      const dtSec = cur.lastTickMs > 0 ? Math.min(1.0, Math.max(0, (nowMs - cur.lastTickMs) / 1000)) : 0;
      const audioDelta = Math.abs(params.engineTimeSec - cur.lastEngineTimeSec);
      const isAdvancing = dtSec <= 0 || audioDelta > 0.01 || cur.totalSec === 0;
      if (isAdvancing) {
        cur.totalSec += dtSec;
      }
      const playThreshold =
        cur.trackDurationSec > 0 && cur.trackDurationSec < 50
          ? cur.trackDurationSec * 0.5
          : 25;
      if (!cur.countedPlay && cur.totalSec >= playThreshold) {
        cur.countedPlay = true;
      }
      if (
        Math.floor(cur.totalSec) > cur.flushedSec &&
        (nowMs - cur.lastFlushAtMs >= 5000 || (cur.countedPlay && cur.flushedSec === 0))
      ) {
        const payload = this.flush(nowMs);
        if (payload) out.push(payload);
      }
    }

    cur.lastEngineTimeSec = params.engineTimeSec;
    cur.lastTickMs = nowMs;
    return out;
  }

  flush(nowMs: number = Date.now()): RichListeningHistoryEntry | null {
    const cur = this.active;
    if (!cur) return null;
    const rounded = Math.round(cur.totalSec);
    if (rounded <= 0 || (rounded === cur.flushedSec && cur.flushedSec > 0)) {
      return null;
    }
    const payload = this.buildPayload();
    if (payload) {
      cur.flushedSec = rounded;
      cur.lastFlushAtMs = nowMs;
    }
    return payload;
  }

  pause(nowMs: number = Date.now()): RichListeningHistoryEntry | null {
    const payload = this.flush(nowMs);
    if (this.active) {
      this.active.lastTickMs = nowMs;
    }
    return payload;
  }
}

export interface YearlyTopTrack {
  videoId: string;
  title: string;
  artist: string;
  albumName?: string;
  artworkUrl?: string;
  playCount: number;
  totalSec: number;
}

export interface YearlyTopArtist {
  artistName: string;
  playCount: number;
  totalSec: number;
  percentage: number;
  artworkUrl?: string;
}

export interface YearlyTopAlbum {
  albumName: string;
  artist: string;
  artworkUrl?: string;
  playCount: number;
  totalSec: number;
}

export interface YearlyQualityBreakdown {
  lossless: number;
  opus: number;
  other: number;
}

export interface YearlyReplayStats {
  year: number;
  totalListeningTimeSec: number;
  totalPlaysCount: number;
  uniqueTracksCount: number;
  uniqueArtistsCount: number;
  peakHour: number | null;
  longestStreakDays: number;
  topTracks: YearlyTopTrack[];
  topArtists: YearlyTopArtist[];
  topAlbums: YearlyTopAlbum[];
  qualityBreakdown: YearlyQualityBreakdown;
}

export function formatLocalYearMonth(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatLocalDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

function extractEntryArtwork(song: Song): string | undefined {
  const raw =
    (typeof song.thumbnailUrl === 'string' && song.thumbnailUrl.trim()) ||
    (typeof song.artworkUrl === 'string' && song.artworkUrl.trim()) ||
    '';
  if (!raw || raw === 'null' || raw === 'undefined') return undefined;
  if (raw.startsWith('data:') && raw.length > 32768) return undefined;
  return raw;
}

function extractEntryQuality(song: Song): string | undefined {
  const raw =
    (typeof song.sourceQuality === 'string' && song.sourceQuality.trim()) ||
    (typeof song.audioQuality === 'string' && song.audioQuality.trim()) ||
    (typeof song.bitrate === 'string' && song.bitrate.trim()) ||
    (typeof song.codec === 'string' && song.codec.trim()) ||
    '';
  return raw || undefined;
}

function classifyQualityBucket(qualityLabel?: string): keyof YearlyQualityBreakdown {
  const q = (qualityLabel || '').toLowerCase();
  if (/(flac|alac|lossless|wav|aiff|pcm|hi-res|24-bit|16-bit)/.test(q)) {
    return 'lossless';
  }
  if (/(opus|webm)/.test(q)) {
    return 'opus';
  }
  return 'other';
}

function computeLongestStreakDays(dayKeys: Set<string>): number {
  if (dayKeys.size === 0) return 0;
  const epochDays = Array.from(dayKeys)
    .map((key) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
      if (!m) return NaN;
      return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    })
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b);

  if (epochDays.length === 0) return 0;

  let maxStreak = 1;
  let currentStreak = 1;
  const ONE_DAY_MS = 86_400_000;
  for (let i = 1; i < epochDays.length; i++) {
    if (epochDays[i] - epochDays[i - 1] === ONE_DAY_MS) {
      currentStreak += 1;
      if (currentStreak > maxStreak) maxStreak = currentStreak;
    } else if (epochDays[i] > epochDays[i - 1]) {
      currentStreak = 1;
    }
  }
  return maxStreak;
}

export function computeYearlyReplayStats(
  entries: RichListeningHistoryEntry[],
  year = 2026,
  monthlyFallback: MonthlyHistory[] = []
): YearlyReplayStats {
  const trackMap = new Map<string, YearlyTopTrack>();
  const artistMap = new Map<string, { artistName: string; playCount: number; totalSec: number; artworkUrl?: string }>();
  const albumMap = new Map<string, YearlyTopAlbum>();
  const hourCounts = new Array<number>(24).fill(0);
  const activeDays = new Set<string>();
  const seenYearMonths = new Set<string>();
  const qualityBreakdown: YearlyQualityBreakdown = { lossless: 0, opus: 0, other: 0 };

  let totalListeningTimeSec = 0;
  let totalPlaysCount = 0;

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry.timestamp !== 'number' || !Number.isFinite(entry.timestamp)) {
      continue;
    }
    const dt = new Date(entry.timestamp);
    if (dt.getFullYear() !== year) continue;

    seenYearMonths.add(formatLocalYearMonth(dt));
    activeDays.add(formatLocalDayKey(dt));
    hourCounts[dt.getHours()] += 1;

    const rawSec =
      typeof entry.listenedSeconds === 'number' && Number.isFinite(entry.listenedSeconds)
        ? entry.listenedSeconds
        : Number.isFinite(entry.durationSec)
        ? entry.durationSec
        : 0;
    const repairedSec =
      rawSec <= 0 && typeof entry.trackDurationSec === 'number' && entry.trackDurationSec > 0
        ? Math.min(entry.trackDurationSec, rawSec || entry.trackDurationSec)
        : rawSec;
    const dur = Math.max(0, Math.round(repairedSec));
    const isCountedPlay = entry.countedPlay !== false;
    totalListeningTimeSec += dur;
    if (isCountedPlay) {
      totalPlaysCount += 1;
    }

    const title = (entry.title || 'Unknown Track').trim() || 'Unknown Track';
    const artistName = (entry.artist || 'Unknown Artist').trim() || 'Unknown Artist';
    const artworkUrl =
      typeof entry.artworkUrl === 'string' && entry.artworkUrl.trim() ? entry.artworkUrl.trim() : undefined;
    const albumName =
      typeof entry.albumName === 'string' && entry.albumName.trim() ? entry.albumName.trim() : undefined;

    const trackKey = entry.videoId || `${title}::${artistName}`;
    const existingTrack = trackMap.get(trackKey);
    if (existingTrack) {
      if (isCountedPlay) existingTrack.playCount += 1;
      existingTrack.totalSec += dur;
      if (!existingTrack.artworkUrl && artworkUrl) existingTrack.artworkUrl = artworkUrl;
      if (!existingTrack.albumName && albumName) existingTrack.albumName = albumName;
    } else {
      trackMap.set(trackKey, {
        videoId: entry.videoId || trackKey,
        title,
        artist: artistName,
        albumName,
        artworkUrl,
        playCount: isCountedPlay ? 1 : 0,
        totalSec: dur,
      });
    }

    const artistKey = artistName.toLowerCase();
    const existingArtist = artistMap.get(artistKey);
    if (existingArtist) {
      if (isCountedPlay) existingArtist.playCount += 1;
      existingArtist.totalSec += dur;
      if (!existingArtist.artworkUrl && artworkUrl) existingArtist.artworkUrl = artworkUrl;
    } else {
      artistMap.set(artistKey, {
        artistName,
        playCount: isCountedPlay ? 1 : 0,
        totalSec: dur,
        artworkUrl,
      });
    }

    if (albumName) {
      const albumKey = `${albumName.toLowerCase()}::${artistKey}`;
      const existingAlbum = albumMap.get(albumKey);
      if (existingAlbum) {
        if (isCountedPlay) existingAlbum.playCount += 1;
        existingAlbum.totalSec += dur;
        if (!existingAlbum.artworkUrl && artworkUrl) existingAlbum.artworkUrl = artworkUrl;
      } else {
        albumMap.set(albumKey, {
          albumName,
          artist: artistName,
          artworkUrl,
          playCount: isCountedPlay ? 1 : 0,
          totalSec: dur,
        });
      }
    }

    if (isCountedPlay) {
      qualityBreakdown[classifyQualityBucket(entry.qualityLabel)] += 1;
    }
  }

  for (const monthly of Array.isArray(monthlyFallback) ? monthlyFallback : []) {
    if (!monthly || typeof monthly.yearMonth !== 'string' || !monthly.yearMonth.startsWith(`${year}-`)) {
      continue;
    }
    if (seenYearMonths.has(monthly.yearMonth) || (monthly.totalPlaysCount || 0) <= 0) {
      continue;
    }
    totalListeningTimeSec += Math.max(0, Math.round(monthly.totalListeningTimeSec || 0));
    totalPlaysCount += Math.max(0, Math.round(monthly.totalPlaysCount || 0));
    qualityBreakdown.other += Math.max(0, Math.round(monthly.totalPlaysCount || 0));

    for (const [dayKey, count] of Object.entries(monthly.dailyPlays || {})) {
      if (count > 0 && dayKey.startsWith(`${year}-`)) {
        activeDays.add(dayKey);
      }
    }
    for (const t of monthly.topTracks || []) {
      const key = t.videoId || `${t.title}::${t.artist}`;
      const existing = trackMap.get(key);
      if (existing) {
        existing.playCount += t.playCount;
        existing.totalSec += Math.round(t.durationSec || 0);
      } else {
        trackMap.set(key, {
          videoId: t.videoId,
          title: t.title,
          artist: t.artist,
          playCount: t.playCount,
          totalSec: Math.round(t.durationSec || 0),
        });
      }
    }
    for (const a of monthly.topArtists || []) {
      const artistName = (a.artistName || 'Unknown Artist').trim() || 'Unknown Artist';
      const key = artistName.toLowerCase();
      const existing = artistMap.get(key);
      if (existing) {
        existing.playCount += a.playCount;
        existing.totalSec += Math.round(a.durationSec || 0);
      } else {
        artistMap.set(key, {
          artistName,
          playCount: a.playCount,
          totalSec: Math.round(a.durationSec || 0),
        });
      }
    }
  }

  let peakHour: number | null = null;
  let peakHourCount = 0;
  for (let h = 0; h < 24; h++) {
    if (hourCounts[h] > peakHourCount) {
      peakHourCount = hourCounts[h];
      peakHour = h;
    }
  }

  const safePlayDivisor = Math.max(1, totalPlaysCount);
  const topTracks = Array.from(trackMap.values())
    .sort((a, b) => b.playCount - a.playCount || b.totalSec - a.totalSec)
    .slice(0, 10);

  const topArtists: YearlyTopArtist[] = Array.from(artistMap.values())
    .sort((a, b) => b.playCount - a.playCount || b.totalSec - a.totalSec)
    .slice(0, 5)
    .map((a) => ({
      artistName: a.artistName,
      playCount: a.playCount,
      totalSec: a.totalSec,
      percentage: Math.min(100, Math.round((a.playCount / safePlayDivisor) * 100)),
      artworkUrl: a.artworkUrl,
    }));

  const topAlbums = Array.from(albumMap.values())
    .sort((a, b) => b.playCount - a.playCount || b.totalSec - a.totalSec)
    .slice(0, 4);

  return {
    year,
    totalListeningTimeSec,
    totalPlaysCount,
    uniqueTracksCount: trackMap.size,
    uniqueArtistsCount: artistMap.size,
    peakHour,
    longestStreakDays: computeLongestStreakDays(activeDays),
    topTracks,
    topArtists,
    topAlbums,
    qualityBreakdown,
  };
}

export interface IStorageService {
  getSettings(): Promise<AppSettings>;
  updateSettings(delta: Partial<AppSettings>): Promise<void>;
  getPlaylists(): Promise<Playlist[]>;
  createPlaylist(name: string, description?: string): Promise<Playlist>;
  createPlaylistWithSongs(
    name: string,
    songs: Song[],
    options?: { description?: string; thumbnailUrl?: string | null; sourceUrl?: string }
  ): Promise<Playlist>;
  addTracksToPlaylist(playlistId: string, trackIds: string[]): Promise<void>;
  addSongToPlaylist(playlistId: string, songId: string): Promise<void>;
  deletePlaylist(playlistId: string): Promise<boolean>;
  removeTracksFromPlaylist(playlistId: string, trackIds: string[]): Promise<boolean>;
  getFavorites(): Promise<Song[]>;
  toggleFavorite(song: Song): Promise<boolean>;
  recordListeningHistory(song: Song, durationSec: number): Promise<void>;
  getListeningHistory(): Promise<RichListeningHistoryEntry[]>;
  getMonthlyListeningHistory(yearMonth: string): Promise<MonthlyHistory>;
  getYearlyReplayStats(year?: number): Promise<YearlyReplayStats>;
  resetListeningData(): Promise<void>;
}

export class StorageService implements IStorageService {
  private baseDir: string;
  private settingsCache: AppSettings | null = null;
  private playlistsCache: Playlist[] | null = null;
  private favoritesCache: Song[] | null = null;
  private listeningCache: RichListeningHistoryEntry[] | null = null;
  private monthlyCache: Map<string, MonthlyHistory> = new Map();
  private resourceQueues: Map<string, Promise<any>> = new Map();
  private static playlistSeq = 0;

  constructor(baseDir?: string) {
    const proc = (globalThis as any).process;
    if (baseDir) {
      this.baseDir = baseDir;
    } else if (proc?.env?.APPDATA && nodePath) {
      this.baseDir = nodePath.join(proc.env.APPDATA, 'waveform-desktop');
    } else if (proc && typeof proc.cwd === 'function' && nodePath) {
      this.baseDir = nodePath.resolve(proc.cwd(), 'data');
    } else {
      this.baseDir = 'waveform-desktop';
    }
  }

  private enqueue<T>(key: string, op: () => Promise<T>): Promise<T> {
    const prev = this.resourceQueues.get(key) || Promise.resolve();
    const next = prev.catch(() => {}).then(async () => {
      return await op();
    });
    this.resourceQueues.set(
      key,
      next.then(() => {}, () => {})
    );
    return next;
  }

  // --- SETTINGS (Feature 13.1) ---
  async getSettings(): Promise<AppSettings> {
    if (this.settingsCache) return { ...this.settingsCache };
    const filePath = joinPath(this.baseDir, 'settings.json');
    const loaded = await readJsonSafe<Partial<AppSettings>>(filePath, {});
    this.settingsCache = mergeSettings(defaultAppSettings, loaded);
    return { ...this.settingsCache };
  }

  async updateSettings(delta: Partial<AppSettings>): Promise<void> {
    return this.enqueue('settings', async () => {
      const current = await this.getSettings();
      const updated = mergeSettings(current, delta);
      this.settingsCache = updated;
      const filePath = joinPath(this.baseDir, 'settings.json');
      await writeJsonAtomic(filePath, updated);
    });
  }

  // --- PLAYLISTS (Feature 13.2) ---
  async getPlaylists(): Promise<Playlist[]> {
    if (this.playlistsCache) return JSON.parse(JSON.stringify(this.playlistsCache));
    const filePath = joinPath(this.baseDir, 'playlists.json');
    this.playlistsCache = await readJsonSafe<Playlist[]>(filePath, []);
    return JSON.parse(JSON.stringify(this.playlistsCache));
  }

  async createPlaylist(name: string, description = ''): Promise<Playlist> {
    const trimmed = name?.trim();
    if (!trimmed) {
      throw new Error('Playlist title cannot be empty');
    }
    return this.enqueue('playlists', async () => {
      const playlists = await this.getPlaylists();
      const newPlaylist: Playlist = {
        id: `pl_custom_${Date.now()}_${++StorageService.playlistSeq}_${Math.random().toString(36).slice(2, 8)}`,
        title: trimmed,
        description: (description || '').trim(),
        thumbnailUrl: null,
        isCustom: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        songIds: [],
        songCount: 0,
        totalDurationSec: 0,
      };
      playlists.push(newPlaylist);
      this.playlistsCache = playlists;
      const filePath = joinPath(this.baseDir, 'playlists.json');
      await writeJsonAtomic(filePath, playlists);
      return { ...newPlaylist };
    });
  }

  async createPlaylistWithSongs(
    name: string,
    rawSongs: Song[],
    options: { description?: string; thumbnailUrl?: string | null; sourceUrl?: string } = {}
  ): Promise<Playlist> {
    if (!name || name.trim().length === 0) {
      throw new Error('Playlist title cannot be empty');
    }
    const cleanSongs = (Array.isArray(rawSongs) ? rawSongs : [])
      .filter((s) => s && (s.videoId || s.id))
      .map((s) => normalizeSong(s as any));
    const songIds = cleanSongs.map((s) => s.videoId);
    const totalDurationSec = cleanSongs.reduce(
      (acc, s) =>
        acc +
        (typeof s.durationSec === 'number' && s.durationSec > 0
          ? Math.round(s.durationSec)
          : s.totalPlayTimeMs > 0
          ? Math.round(s.totalPlayTimeMs / 1000)
          : 0),
      0
    );
    const firstArt =
      options.thumbnailUrl ||
      cleanSongs.find((s) => s.thumbnailUrl || s.artworkUrl)?.thumbnailUrl ||
      cleanSongs.find((s) => s.artworkUrl)?.artworkUrl ||
      null;

    return this.enqueue('playlists', async () => {
      const playlists = await this.getPlaylists();
      const nowIso = new Date().toISOString();
      const newPlaylist: Playlist = {
        id: `pl_custom_${Date.now()}_${++StorageService.playlistSeq}_${Math.random().toString(36).slice(2, 8)}`,
        title: name.trim().slice(0, 100),
        description: (options.description || '').trim(),
        thumbnailUrl: firstArt,
        ...(options.sourceUrl ? { sourceUrl: options.sourceUrl } : {}),
        isCustom: true,
        createdAt: nowIso,
        updatedAt: nowIso,
        songIds,
        songs: cleanSongs,
        songCount: songIds.length,
        totalDurationSec,
      };
      playlists.push(newPlaylist);
      this.playlistsCache = playlists;
      const filePath = joinPath(this.baseDir, 'playlists.json');
      await writeJsonAtomic(filePath, playlists);
      return { ...newPlaylist };
    });
  }

  async addTracksToPlaylist(playlistId: string, trackIds: string[]): Promise<void> {
    return this.enqueue('playlists', async () => {
      const playlists = await this.getPlaylists();
      const target = playlists.find((p) => p.id === playlistId);
      if (!target) {
        throw new Error(`Playlist ${playlistId} not found`);
      }
      let modified = false;
      for (const trackId of trackIds) {
        if (!target.songIds.includes(trackId)) {
          target.songIds.push(trackId);
          modified = true;
        }
      }
      if (modified) {
        target.songCount = target.songIds.length;
        target.updatedAt = new Date().toISOString();
        this.playlistsCache = playlists;
        const filePath = joinPath(this.baseDir, 'playlists.json');
        await writeJsonAtomic(filePath, playlists);
      }
    });
  }

  async addSongToPlaylist(playlistId: string, songId: string): Promise<void> {
    return this.addTracksToPlaylist(playlistId, [songId]);
  }

  async deletePlaylist(playlistId: string): Promise<boolean> {
    return this.enqueue('playlists', async () => {
      const playlists = await this.getPlaylists();
      const initialLength = playlists.length;
      const filtered = playlists.filter((p) => p.id !== playlistId);
      if (filtered.length === initialLength) {
        return false;
      }
      this.playlistsCache = filtered;
      const filePath = joinPath(this.baseDir, 'playlists.json');
      await writeJsonAtomic(filePath, filtered);
      return true;
    });
  }

  async removeTracksFromPlaylist(playlistId: string, trackIds: string[]): Promise<boolean> {
    return this.enqueue('playlists', async () => {
      const playlists = await this.getPlaylists();
      const target = playlists.find((p) => p.id === playlistId);
      if (!target) {
        return false;
      }
      const trackIdSet = new Set(trackIds);
      const originalLength = target.songIds.length;
      target.songIds = target.songIds.filter((id) => !trackIdSet.has(id));
      if (target.songIds.length !== originalLength) {
        target.songCount = target.songIds.length;
        target.updatedAt = new Date().toISOString();
        this.playlistsCache = playlists;
        const filePath = joinPath(this.baseDir, 'playlists.json');
        await writeJsonAtomic(filePath, playlists);
        return true;
      }
      return false;
    });
  }

  // --- FAVORITES (Feature 13.3) ---
  async getFavorites(): Promise<Song[]> {
    if (this.favoritesCache) return JSON.parse(JSON.stringify(this.favoritesCache));
    const filePath = joinPath(this.baseDir, 'favorites.json');
    this.favoritesCache = await readJsonSafe<Song[]>(filePath, []);
    return JSON.parse(JSON.stringify(this.favoritesCache));
  }

  async toggleFavorite(song: Song): Promise<boolean> {
    const validation = validateSongContract(song);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    return this.enqueue('favorites', async () => {
      const favorites = await this.getFavorites();
      const existingIndex = favorites.findIndex((f) => f.videoId === song.videoId);

      let isFavoriteNow = false;
      if (existingIndex >= 0) {
        favorites.splice(existingIndex, 1);
        isFavoriteNow = false;
      } else {
        favorites.push(normalizeSong({ ...song, liked: true }));
        isFavoriteNow = true;
      }

      this.favoritesCache = favorites;
      const filePath = joinPath(this.baseDir, 'favorites.json');
      await writeJsonAtomic(filePath, favorites);
      return isFavoriteNow;
    });
  }

  // --- LISTENING HISTORY (Feature 13.4) ---
  private getListeningHistoryFilePath(): string {
    return joinPath(this.baseDir, 'listening', 'history.json');
  }

  private async loadListeningHistoryInternal(): Promise<RichListeningHistoryEntry[]> {
    if (this.listeningCache !== null) {
      return this.listeningCache;
    }
    const localLoaded = await readJsonSafe<RichListeningHistoryEntry[]>(
      this.getListeningHistoryFilePath(),
      []
    );
    const cleanLocal = Array.isArray(localLoaded)
      ? localLoaded.filter((item) => item && typeof item.videoId === 'string')
      : [];

    const api =
      typeof window !== 'undefined'
        ? (window as any).electronAPI
        : (globalThis as any).window?.electronAPI;
    if (typeof api?.replayLoad === 'function') {
      try {
        const diskRes = await api.replayLoad();
        const diskEntries = Array.isArray(diskRes?.entries) ? diskRes.entries : [];
        const merged = mergeListeningEntries(diskEntries, cleanLocal);
        if (cleanLocal.length > 0 && merged.length > diskEntries.length && typeof api?.replayFlush === 'function') {
          await api.replayFlush(merged).catch(() => {});
        }
        this.listeningCache = merged;
        return this.listeningCache;
      } catch {
        // Fall back to local cache
      }
    }

    this.listeningCache = cleanLocal;
    return this.listeningCache;
  }

  async upsertListeningSession(entry: RichListeningHistoryEntry): Promise<void> {
    if (!entry || typeof entry.videoId !== 'string' || !entry.videoId.trim()) return;
    const durationSec = Math.max(0, Math.round(entry.listenedSeconds ?? entry.durationSec ?? 0));
    if (durationSec <= 0) return;

    const normalizedEntry: RichListeningHistoryEntry = {
      ...entry,
      durationSec,
      listenedSeconds: durationSec,
    };
    const now = new Date(normalizedEntry.timestamp || Date.now());
    const yearMonth = formatLocalYearMonth(now);
    const dayKey = now.toISOString().slice(0, 10);

    return this.enqueue('history', async () => {
      const history = await this.loadListeningHistoryInternal();
      const key = getListeningEntryKey(normalizedEntry);
      const existingIdx = history.findIndex((h) => getListeningEntryKey(h) === key);
      const prevEntry = existingIdx >= 0 ? history[existingIdx] : null;
      const prevDur = prevEntry ? Math.max(0, Math.round(prevEntry.listenedSeconds ?? prevEntry.durationSec ?? 0)) : 0;
      const prevCounted = prevEntry ? prevEntry.countedPlay !== false : false;
      const nextDur = Math.max(prevDur, durationSec);
      const nextCounted = Boolean(prevCounted || normalizedEntry.countedPlay !== false);

      const finalEntry: RichListeningHistoryEntry = {
        ...(prevEntry || {}),
        ...normalizedEntry,
        durationSec: nextDur,
        listenedSeconds: nextDur,
        countedPlay: nextCounted,
      };

      if (existingIdx >= 0) {
        history[existingIdx] = finalEntry;
      } else {
        history.push(finalEntry);
        if (history.length > 50000) {
          history.splice(0, history.length - 50000);
        }
      }

      this.listeningCache = history;
      await writeJsonAtomic(this.getListeningHistoryFilePath(), history);

      const api =
        typeof window !== 'undefined'
          ? (window as any).electronAPI
          : (globalThis as any).window?.electronAPI;
      if (typeof api?.replayAppend === 'function') {
        void Promise.resolve(api.replayAppend(finalEntry)).catch(() => {});
      }

      const deltaSec = Math.max(0, nextDur - prevDur);
      const deltaPlay = nextCounted && !prevCounted ? 1 : 0;
      if (deltaSec > 0 || deltaPlay > 0) {
        const monthly = await this.getMonthlyListeningHistory(yearMonth);
        monthly.totalListeningTimeSec += deltaSec;
        monthly.totalPlaysCount += deltaPlay;
        if (deltaPlay > 0) {
          monthly.dailyPlays[dayKey] = (monthly.dailyPlays[dayKey] || 0) + 1;
        }

        const existingTrack = monthly.topTracks.find((t) => t.videoId === finalEntry.videoId);
        if (existingTrack) {
          existingTrack.playCount += deltaPlay;
          existingTrack.durationSec += deltaSec;
        } else {
          monthly.topTracks.push({
            videoId: finalEntry.videoId,
            title: finalEntry.title,
            artist: finalEntry.artist,
            playCount: deltaPlay,
            durationSec: deltaSec,
          });
          monthly.uniqueTracksCount = monthly.topTracks.length;
        }

        const existingArtist = monthly.topArtists.find((a) => a.artistName === finalEntry.artist);
        if (existingArtist) {
          existingArtist.playCount += deltaPlay;
          existingArtist.durationSec += deltaSec;
        } else {
          monthly.topArtists.push({
            artistName: finalEntry.artist,
            playCount: deltaPlay,
            durationSec: deltaSec,
          });
          monthly.uniqueArtistsCount = monthly.topArtists.length;
        }

        monthly.topTracks.sort((a, b) => b.playCount - a.playCount || b.durationSec - a.durationSec);
        monthly.topArtists.sort((a, b) => b.playCount - a.playCount || b.durationSec - a.durationSec);

        this.monthlyCache.set(yearMonth, monthly);
        const monthlyFilePath = joinPath(this.baseDir, 'listening', `${yearMonth}.json`);
        await writeJsonAtomic(monthlyFilePath, monthly);
      }
    });
  }

  async recordListeningHistory(song: Song, durationSec: number): Promise<void> {
    const validation = validateSongContract(song);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    if (typeof durationSec !== 'number' || isNaN(durationSec) || durationSec < 0) {
      throw new RangeError('Duration must be a positive number');
    }

    const now = new Date();
    const albumName =
      (typeof song.albumName === 'string' && song.albumName.trim()) ||
      (typeof song.album === 'string' && song.album.trim()) ||
      undefined;
    const artworkUrl = extractEntryArtwork(song);
    const qualityLabel = extractEntryQuality(song);

    const entry: RichListeningHistoryEntry = {
      videoId: song.videoId,
      title: song.title,
      artist: song.artist,
      ...(albumName ? { albumName } : {}),
      ...(artworkUrl ? { artworkUrl } : {}),
      ...(qualityLabel ? { qualityLabel } : {}),
      timestamp: now.getTime(),
      startedAt: now.getTime(),
      durationSec,
      listenedSeconds: Math.round(durationSec),
      countedPlay: true,
    };
    const yearMonth = formatLocalYearMonth(now);
    const dayKey = now.toISOString().slice(0, 10);

    return this.enqueue('history', async () => {
      const history = await this.loadListeningHistoryInternal();
      history.push(entry);
      if (history.length > 50000) {
        history.splice(0, history.length - 50000);
      }
      this.listeningCache = history;
      await writeJsonAtomic(this.getListeningHistoryFilePath(), history);

      const api =
        typeof window !== 'undefined'
          ? (window as any).electronAPI
          : (globalThis as any).window?.electronAPI;
      if (typeof api?.replayAppend === 'function') {
        void Promise.resolve(api.replayAppend(entry)).catch(() => {});
      }

      const monthly = await this.getMonthlyListeningHistory(yearMonth);

      monthly.totalListeningTimeSec += Math.round(durationSec);
      monthly.totalPlaysCount += 1;
      monthly.dailyPlays[dayKey] = (monthly.dailyPlays[dayKey] || 0) + 1;

      // Track aggregation
      const existingTrack = monthly.topTracks.find((t) => t.videoId === song.videoId);
      if (existingTrack) {
        existingTrack.playCount += 1;
        existingTrack.durationSec += Math.round(durationSec);
      } else {
        monthly.topTracks.push({
          videoId: song.videoId,
          title: song.title,
          artist: song.artist,
          playCount: 1,
          durationSec: Math.round(durationSec),
        });
        monthly.uniqueTracksCount = monthly.topTracks.length;
      }

      // Artist aggregation
      const existingArtist = monthly.topArtists.find((a) => a.artistName === song.artist);
      if (existingArtist) {
        existingArtist.playCount += 1;
        existingArtist.durationSec += Math.round(durationSec);
      } else {
        monthly.topArtists.push({
          artistId: song.artistId || undefined,
          artistName: song.artist,
          playCount: 1,
          durationSec: Math.round(durationSec),
        });
        monthly.uniqueArtistsCount = monthly.topArtists.length;
      }

      // Sort descending by play count
      monthly.topTracks.sort((a, b) => b.playCount - a.playCount);
      monthly.topArtists.sort((a, b) => b.playCount - a.playCount);

      this.monthlyCache.set(yearMonth, monthly);
      const monthlyFilePath = joinPath(this.baseDir, 'listening', `${yearMonth}.json`);
      await writeJsonAtomic(monthlyFilePath, monthly);
    });
  }

  async getListeningHistory(): Promise<RichListeningHistoryEntry[]> {
    return this.enqueue('history', async () => {
      const history = await this.loadListeningHistoryInternal();
      return history.map((entry) => ({ ...entry }));
    });
  }

  async getMonthlyListeningHistory(yearMonth: string): Promise<MonthlyHistory> {
    if (this.monthlyCache.has(yearMonth)) {
      return JSON.parse(JSON.stringify(this.monthlyCache.get(yearMonth)!));
    }
    const monthlyFilePath = joinPath(this.baseDir, 'listening', `${yearMonth}.json`);
    const fallback: MonthlyHistory = {
      yearMonth,
      totalListeningTimeSec: 0,
      totalPlaysCount: 0,
      uniqueTracksCount: 0,
      uniqueArtistsCount: 0,
      topTracks: [],
      topArtists: [],
      dailyPlays: {},
    };
    const loaded = await readJsonSafe<MonthlyHistory>(monthlyFilePath, fallback);
    this.monthlyCache.set(yearMonth, loaded);
    return JSON.parse(JSON.stringify(loaded));
  }

  async getYearlyReplayStats(year = 2026): Promise<YearlyReplayStats> {
    return this.enqueue('history', async () => {
      const history = await this.loadListeningHistoryInternal();
      const monthlyFallback: MonthlyHistory[] = [];
      const prefix = `${year}-`;

      for (const [ym, cached] of this.monthlyCache.entries()) {
        if (ym.startsWith(prefix)) {
          monthlyFallback.push(cached);
        }
      }

      if (nodeFs && nodePath) {
        const listeningDir = joinPath(this.baseDir, 'listening');
        try {
          if (nodeFs.existsSync(listeningDir)) {
            const files = await nodeFs.promises.readdir(listeningDir);
            for (const f of files) {
              if (!f.startsWith(prefix) || !f.endsWith('.json')) continue;
              const ym = f.slice(0, -5);
              if (this.monthlyCache.has(ym)) continue;
              const loaded = await readJsonSafe<MonthlyHistory | null>(
                joinPath(listeningDir, f),
                null
              );
              if (loaded) monthlyFallback.push(loaded);
            }
          }
        } catch {
          // Non-fatal fallback scan
        }
      } else {
        for (let m = 1; m <= 12; m++) {
          const ym = `${year}-${String(m).padStart(2, '0')}`;
          if (this.monthlyCache.has(ym)) continue;
          const filePath = joinPath(this.baseDir, 'listening', `${ym}.json`);
          const loaded = await readJsonSafe<MonthlyHistory | null>(filePath, null);
          if (loaded) monthlyFallback.push(loaded);
        }
      }

      return computeYearlyReplayStats(history, year, monthlyFallback);
    });
  }

  async resetListeningData(): Promise<void> {
    return this.enqueue('history', async () => {
      this.listeningCache = [];
      this.monthlyCache.clear();

      const api =
        typeof window !== 'undefined'
          ? (window as any).electronAPI
          : (globalThis as any).window?.electronAPI;
      if (typeof api?.replayReset === 'function') {
        void Promise.resolve(api.replayReset()).catch(() => {});
      }

      if (nodeFs && nodePath) {
        const listeningDir = joinPath(this.baseDir, 'listening');
        try {
          if (nodeFs.existsSync(listeningDir)) {
            const entries = await nodeFs.promises.readdir(listeningDir);
            for (const entry of entries) {
              if (entry.endsWith('.json')) {
                await nodeFs.promises.unlink(joinPath(listeningDir, entry));
              }
            }
          }
        } catch (err) {
          console.warn('[Storage] Failed to clear listening directory:', err);
        }
      } else {
        const prefix = `waveform_storage:${resolvePath(joinPath(this.baseDir, 'listening'))}`;
        for (const key of Array.from(browserMemoryStore.keys())) {
          if (key.startsWith(prefix)) {
            browserMemoryStore.delete(key);
          }
        }
        try {
          if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
            const ls = (globalThis as any).localStorage;
            for (let i = ls.length - 1; i >= 0; i--) {
              const k = ls.key(i);
              if (k && k.startsWith(prefix)) {
                ls.removeItem(k);
              }
            }
          }
        } catch {}
      }
    });
  }

  // --- PLAYBACK SESSION PERSISTENCE (Milestone M3) ---
  async getPlaybackSession(): Promise<PersistedPlaybackSession | null> {
    const filePath = joinPath(this.baseDir, 'playback_session.json');
    return await readJsonSafe<PersistedPlaybackSession | null>(filePath, null);
  }

  async savePlaybackSession(session: PersistedPlaybackSession): Promise<void> {
    return this.enqueue('playback_session', async () => {
      const filePath = joinPath(this.baseDir, 'playback_session.json');
      await writeJsonAtomic(filePath, session);
    });
  }
}

export interface PersistedPlaybackSession {
  version: 1;
  savedAt: number;
  player: {
    currentTrack: Song | null;
    positionMs: number;
    durationMs: number;
    volume: number;
    isMuted: boolean;
    preMuteVolume: number;
    isShuffle: boolean;
    repeatMode: 'off' | 'all' | 'one';
    playbackState: 'PAUSED' | 'IDLE';
  };
  queue: {
    tiers: {
      USER_QUEUE: Song[];
      CONTEXT: Song[];
      AUTOPLAY: Song[];
    };
    currentSong: Song | null;
    currentTier: 'USER_QUEUE' | 'CONTEXT' | 'AUTOPLAY' | null;
    currentIndex: number;
    history: Song[];
    context: any | null;
  };
}
