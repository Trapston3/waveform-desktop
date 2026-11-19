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

export interface IStorageService {
  getSettings(): Promise<AppSettings>;
  updateSettings(delta: Partial<AppSettings>): Promise<void>;
  getPlaylists(): Promise<Playlist[]>;
  createPlaylist(name: string, description?: string): Promise<Playlist>;
  addTracksToPlaylist(playlistId: string, trackIds: string[]): Promise<void>;
  addSongToPlaylist(playlistId: string, songId: string): Promise<void>;
  deletePlaylist(playlistId: string): Promise<boolean>;
  removeTracksFromPlaylist(playlistId: string, trackIds: string[]): Promise<boolean>;
  getFavorites(): Promise<Song[]>;
  toggleFavorite(song: Song): Promise<boolean>;
  recordListeningHistory(song: Song, durationSec: number): Promise<void>;
  getListeningHistory(): Promise<ListeningHistoryEntry[]>;
  getMonthlyListeningHistory(yearMonth: string): Promise<MonthlyHistory>;
  resetListeningData(): Promise<void>;
}

export class StorageService implements IStorageService {
  private baseDir: string;
  private settingsCache: AppSettings | null = null;
  private playlistsCache: Playlist[] | null = null;
  private favoritesCache: Song[] | null = null;
  private listeningCache: ListeningHistoryEntry[] = [];
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
  async recordListeningHistory(song: Song, durationSec: number): Promise<void> {
    const validation = validateSongContract(song);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    if (typeof durationSec !== 'number' || isNaN(durationSec) || durationSec < 0) {
      throw new RangeError('Duration must be a positive number');
    }

    const now = new Date();
    const entry: ListeningHistoryEntry = {
      videoId: song.videoId,
      title: song.title,
      artist: song.artist,
      timestamp: now.getTime(),
      durationSec,
    };
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const dayKey = now.toISOString().slice(0, 10);

    return this.enqueue(`history:${yearMonth}`, async () => {
      this.listeningCache.push(entry);
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

  async getListeningHistory(): Promise<ListeningHistoryEntry[]> {
    return [...this.listeningCache];
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

  async resetListeningData(): Promise<void> {
    return this.enqueue('history:reset', async () => {
      this.listeningCache = [];
      this.monthlyCache.clear();

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
