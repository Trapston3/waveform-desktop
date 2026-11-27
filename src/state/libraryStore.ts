// src/state/libraryStore.ts
// Local library management: Playlists, Favorites, Monthly stats, Persistent Local Library & Unified Selectors

import { create } from 'zustand';
import type { Playlist, MonthlyHistory, ListeningHistoryEntry } from '../models/Playlist';
import type { Song } from '../models/Song';
import { normalizeSong } from '../models/Song';
import {
  StorageService,
  formatLocalYearMonth,
  computeYearlyReplayStats,
  type RichListeningHistoryEntry,
  type YearlyReplayStats,
} from '../services/StorageService';
import type { LocalMediaScanner } from '../services/LocalMediaScanner';
import { useSettingsStore } from './settingsStore';
import { getPlatformBridge, hasPlatformBridge } from '../platform/index';

export type { RichListeningHistoryEntry, YearlyReplayStats };
export { formatLocalYearMonth };

export const DEFAULT_LOCAL_ALBUM_ART_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">' +
      '<defs>' +
      '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#1f1f26"/>' +
      '<stop offset="55%" stop-color="#14141a"/>' +
      '<stop offset="100%" stop-color="#2a121b"/>' +
      '</linearGradient>' +
      '</defs>' +
      '<rect width="300" height="300" fill="url(#bg)"/>' +
      '<circle cx="150" cy="150" r="88" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="2"/>' +
      '<circle cx="150" cy="150" r="64" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1.5"/>' +
      '<circle cx="150" cy="150" r="38" fill="rgba(250,45,72,0.16)" stroke="rgba(250,45,72,0.45)" stroke-width="2"/>' +
      '<path d="M140 166V132l28-6v30" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="135" cy="166" r="7" fill="#ffffff"/>' +
      '<circle cx="163" cy="156" r="7" fill="#ffffff"/>' +
      '</svg>'
  );

export interface UnifiedAlbum {
  id: string;
  title: string;
  artist: string;
  albumArtist: string;
  coverUrl: string;
  year?: string;
  dateAdded?: number;
  source: 'local' | 'online' | 'mixed';
  isLocal: boolean;
  songs: Song[];
}

export interface UnifiedArtist {
  id: string;
  name: string;
  trackCount: number;
  avatarUrl?: string;
  source: 'local' | 'online' | 'mixed';
  isLocal: boolean;
}

export interface LocalScanState {
  isScanning: boolean;
  scannedFiles: number;
  totalFiles: number;
  currentFolder: string | null;
  error: string | null;
}

export interface LibraryState {
  playlists: Playlist[];
  favorites: Song[];
  listeningHistory: RichListeningHistoryEntry[];
  monthlyStats: MonthlyHistory | null;
  yearlyReplayStats: YearlyReplayStats | null;
  scanState: LocalScanState;
  isLoaded: boolean;
  storageService: StorageService | null;
  localSongs: Song[];
  localFolders: string[];
}

export interface LibraryActions {
  initLibrary: (storage?: StorageService) => Promise<void>;
  createPlaylist: (title: string, description?: string) => Promise<Playlist>;
  createPlaylistWithSongs: (
    title: string,
    songs: Song[],
    options?: { description?: string; thumbnailUrl?: string | null; sourceUrl?: string }
  ) => Promise<Playlist>;
  addTracksToPlaylist: (playlistId: string, trackIds: string[]) => Promise<void>;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  renamePlaylist: (playlistId: string, newTitle: string) => Promise<Playlist | null>;
  duplicatePlaylist: (playlistId: string) => Promise<Playlist | null>;
  deletePlaylist: (playlistId: string) => Promise<boolean>;
  toggleFavorite: (song: Song) => Promise<boolean>;
  isFavorite: (videoId: string) => boolean;
  recordListeningHistory: (song: Song, durationSec: number) => Promise<void>;
  upsertListeningSession: (entry: RichListeningHistoryEntry) => Promise<void>;
  refreshMonthlyStats: (yearMonth?: string) => Promise<void>;
  refreshYearlyReplayStats: (year?: number) => Promise<void>;
  resetListeningData: () => Promise<void>;
  startLocalMediaScan: (scanner: typeof LocalMediaScanner | { scanDirectory?: (p: string) => Promise<Song[]> } | null, folderPath: string) => Promise<Song[]>;
  removeLocalFolder: (folderPath: string) => Promise<void>;
  upsertLocalTrackPatch: (videoId: string, patch: Partial<Song>) => Promise<void>;
  setLocalSongs: (songs: Song[]) => void;
}

export type LibraryStore = LibraryState & LibraryActions;

let globalStorageInstance: StorageService | null = null;

function getElectronApi(): any {
  return hasPlatformBridge() ? getPlatformBridge() : undefined;
}

function normalizeFolderKey(folderPath: string): string {
  return String(folderPath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function dedupeFolderList(folders: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of folders) {
    if (typeof f !== 'string' || !f.trim()) continue;
    const key = normalizeFolderKey(f);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(f.trim());
    }
  }
  return out;
}

function isLocalSong(song: Partial<Song> | null | undefined): boolean {
  if (!song) return false;
  return Boolean(
    song.source === 'local' ||
      song.isLocal ||
      song.playbackSourceType === 'LOCAL' ||
      (typeof song.videoId === 'string' && song.videoId.startsWith('local_'))
  );
}

function normalizeLocalTrack(raw: any, fallbackFolder?: string): Song {
  const normalized = normalizeSong({
    ...raw,
    source: 'local',
    isLocal: true,
    playbackSourceType: 'LOCAL',
  });
  if (fallbackFolder && !normalized.folderPath) {
    (normalized as any).folderPath = fallbackFolder;
  }
  return normalized;
}

function hashTextShort(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9747b28c;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ch, 0x01000193) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 14);
}

/**
 * Pure selector: merges favorited (online/local) songs and scanned localSongs into one deduplicated song list.
 * Local metadata (localFilePath, streamUrl, artworkHash, codec, etc.) is preserved when a local song is also favorited.
 */
export function selectUnifiedSongs(favorites: Song[], localSongs: Song[]): Song[] {
  const byId = new Map<string, Song>();
  const byLocalPath = new Map<string, string>();

  // Insert local songs first so local file metadata is authoritative
  for (const rawLocal of Array.isArray(localSongs) ? localSongs : []) {
    if (!rawLocal || !rawLocal.videoId) continue;
    const song = normalizeSong({
      ...rawLocal,
      source: 'local',
      isLocal: true,
      playbackSourceType: 'LOCAL',
    });
    byId.set(song.videoId, song);
    const localPath = typeof song.localFilePath === 'string' ? normalizeFolderKey(song.localFilePath) : '';
    if (localPath) {
      byLocalPath.set(localPath, song.videoId);
    }
  }

  for (const rawFav of Array.isArray(favorites) ? favorites : []) {
    if (!rawFav || !rawFav.videoId) continue;
    const favIsLocal = isLocalSong(rawFav);
    const normalizedFav = normalizeSong({
      ...rawFav,
      liked: true,
      source: favIsLocal ? 'local' : 'online',
      isLocal: favIsLocal,
    });

    const favPath =
      typeof normalizedFav.localFilePath === 'string'
        ? normalizeFolderKey(normalizedFav.localFilePath)
        : '';
    const existingId =
      byId.has(normalizedFav.videoId)
        ? normalizedFav.videoId
        : favPath && byLocalPath.has(favPath)
        ? byLocalPath.get(favPath)!
        : null;

    if (existingId) {
      const existing = byId.get(existingId)!;
      byId.set(existingId, {
        ...existing,
        liked: true,
        thumbnailUrl: existing.thumbnailUrl || normalizedFav.thumbnailUrl,
        artworkUrl: existing.artworkUrl || normalizedFav.artworkUrl,
        playCount: Math.max(existing.playCount || 0, normalizedFav.playCount || 0),
        lastPlayedTimeMs: Math.max(
          existing.lastPlayedTimeMs || 0,
          normalizedFav.lastPlayedTimeMs || 0
        ) || null,
      });
    } else {
      byId.set(normalizedFav.videoId, normalizedFav);
    }
  }

  return Array.from(byId.values());
}

/**
 * Pure selector: groups unified songs into albums keyed by normalized (albumTitle | albumArtist),
 * preserving ordered songs[], cover art (with SVG fallback), and local/online provenance.
 */
export function selectUnifiedAlbums(songs: Song[]): UnifiedAlbum[] {
  const groups = new Map<
    string,
    {
      id: string;
      title: string;
      artist: string;
      albumArtist: string;
      coverUrl: string | null;
      year?: string;
      dateAdded: number;
      hasLocal: boolean;
      hasOnline: boolean;
      songs: Song[];
    }
  >();

  for (const song of Array.isArray(songs) ? songs : []) {
    if (!song || !song.videoId) continue;
    const albumTitle = (song.albumName || song.album || 'Single Collection').trim() || 'Single Collection';
    const albumArtist = (song.albumArtist || song.artist || 'Unknown Artist').trim() || 'Unknown Artist';
    const key = `${albumTitle.toLowerCase()}|${albumArtist.toLowerCase()}`;
    const local = isLocalSong(song);
    const cover = song.thumbnailUrl || song.artworkUrl || null;
    const addedAt =
      (typeof song.lastModifiedMs === 'number' && song.lastModifiedMs > 0
        ? song.lastModifiedMs
        : typeof (song as any).mtimeMs === 'number' && (song as any).mtimeMs > 0
        ? (song as any).mtimeMs
        : typeof song.lastPlayedTimeMs === 'number' && song.lastPlayedTimeMs > 0
        ? song.lastPlayedTimeMs
        : 0);

    const existing = groups.get(key);
    if (existing) {
      existing.songs.push(song);
      if (!existing.coverUrl && cover) existing.coverUrl = cover;
      if (!existing.year && song.year) existing.year = song.year;
      if (addedAt > existing.dateAdded) existing.dateAdded = addedAt;
      if (local) existing.hasLocal = true;
      else existing.hasOnline = true;
      // Prefer explicit non-local release ID only when purely online
      if (!existing.id && song.albumId) existing.id = song.albumId;
    } else {
      const id =
        song.albumId ||
        (local ? `local_alb_${hashTextShort(key)}` : `alb_${hashTextShort(key)}`);
      groups.set(key, {
        id,
        title: albumTitle,
        artist: albumArtist,
        albumArtist,
        coverUrl: cover,
        year: song.year || undefined,
        dateAdded: addedAt,
        hasLocal: local,
        hasOnline: !local,
        songs: [song],
      });
    }
  }

  return Array.from(groups.values()).map((g) => {
    const sortedSongs = [...g.songs].sort((a, b) => {
      const ta = typeof a.trackNumber === 'number' && a.trackNumber > 0 ? a.trackNumber : Number.MAX_SAFE_INTEGER;
      const tb = typeof b.trackNumber === 'number' && b.trackNumber > 0 ? b.trackNumber : Number.MAX_SAFE_INTEGER;
      if (ta !== tb) return ta - tb;
      return (a.title || '').localeCompare(b.title || '');
    });

    const source: 'local' | 'online' | 'mixed' =
      g.hasLocal && g.hasOnline ? 'mixed' : g.hasLocal ? 'local' : 'online';

    return {
      id: g.id,
      title: g.title,
      artist: g.artist,
      albumArtist: g.albumArtist,
      coverUrl: g.coverUrl || DEFAULT_LOCAL_ALBUM_ART_SVG,
      year: g.year,
      dateAdded: g.dateAdded || undefined,
      source,
      isLocal: g.hasLocal && !g.hasOnline,
      songs: sortedSongs,
    };
  });
}

/**
 * Pure selector: groups unified songs into artists keyed by normalized artist name.
 */
export function selectUnifiedArtists(songs: Song[]): UnifiedArtist[] {
  const groups = new Map<
    string,
    {
      id: string;
      name: string;
      trackCount: number;
      avatarUrl?: string;
      hasLocal: boolean;
      hasOnline: boolean;
    }
  >();

  for (const song of Array.isArray(songs) ? songs : []) {
    if (!song || !song.videoId) continue;
    const artistName = (song.artist || 'Unknown Artist').trim() || 'Unknown Artist';
    const key = artistName.toLowerCase();
    const local = isLocalSong(song);
    const avatar = song.thumbnailUrl || song.artworkUrl || undefined;

    const existing = groups.get(key);
    if (existing) {
      existing.trackCount += 1;
      if (!existing.avatarUrl && avatar) existing.avatarUrl = avatar;
      if (local) existing.hasLocal = true;
      else existing.hasOnline = true;
    } else {
      const id =
        song.artistIds?.[0] ||
        song.artistId ||
        (local ? `local_art_${hashTextShort(key)}` : `art_${hashTextShort(key)}`);
      groups.set(key, {
        id,
        name: artistName,
        trackCount: 1,
        avatarUrl: avatar,
        hasLocal: local,
        hasOnline: !local,
      });
    }
  }

  return Array.from(groups.values())
    .map((g) => ({
      id: g.id,
      name: g.name,
      trackCount: g.trackCount,
      avatarUrl: g.avatarUrl,
      source: (g.hasLocal && g.hasOnline ? 'mixed' : g.hasLocal ? 'local' : 'online') as
        | 'local'
        | 'online'
        | 'mixed',
      isLocal: g.hasLocal && !g.hasOnline,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Pure selector: resolves ordered playable Song[] for a playlist from unified library tracks
 * or embedded playlist tracks.
 */
export function resolvePlaylistSongs(
  playlist: Playlist | null | undefined,
  unifiedSongs: Song[]
): Song[] {
  if (!playlist) return [];
  const songById = new Map<string, Song>();
  for (const s of Array.isArray(unifiedSongs) ? unifiedSongs : []) {
    if (!s || !s.videoId) continue;
    songById.set(s.videoId, s);
  }
  const embedded: Song[] = Array.isArray((playlist as any).songs) ? (playlist as any).songs : [];
  for (const s of embedded) {
    if (s && s.videoId && !songById.has(s.videoId)) {
      songById.set(s.videoId, s);
    }
  }
  const resolved: Song[] = [];
  const seen = new Set<string>();
  for (const id of Array.isArray(playlist.songIds) ? playlist.songIds : []) {
    const song = songById.get(id);
    if (song && !seen.has(song.videoId)) {
      seen.add(song.videoId);
      resolved.push(song);
    }
  }
  if (resolved.length === 0 && embedded.length > 0) {
    for (const s of embedded) {
      if (s && s.videoId && !seen.has(s.videoId)) {
        seen.add(s.videoId);
        resolved.push(s);
      }
    }
  }
  return resolved;
}

async function persistFoldersSetting(folders: string[], storage?: StorageService | null): Promise<void> {
  try {
    await useSettingsStore.getState().updateSettings({ 'storage.localFolders': folders });
  } catch {
    // Best-effort settings store sync
  }
  if (storage) {
    try {
      await storage.updateSettings({ 'storage.localFolders': folders });
    } catch {
      // Best-effort storage sync
    }
  }
}

export const useLibraryStore = create<LibraryStore>((set, get) => ({
  playlists: [],
  favorites: [],
  listeningHistory: [],
  monthlyStats: null,
  yearlyReplayStats: null,
  scanState: {
    isScanning: false,
    scannedFiles: 0,
    totalFiles: 0,
    currentFolder: null,
    error: null,
  },
  isLoaded: false,
  storageService: null,
  localSongs: [],
  localFolders: [],

  initLibrary: async (storage?: StorageService) => {
    if (get().isLoaded && !storage) return;

    const storageInstance = storage || globalStorageInstance || new StorageService();
    globalStorageInstance = storageInstance;

    set({ storageService: storageInstance });

    const api = getElectronApi();

    try {
      const [playlists, favorites, history, diskCache, settings] = await Promise.all([
        storageInstance.getPlaylists(),
        storageInstance.getFavorites(),
        storageInstance.getListeningHistory(),
        hasPlatformBridge('loadLocalLibraryCache')
          ? Promise.resolve(api.loadLocalLibraryCache()).catch(() => null)
          : Promise.resolve(null),
        storageInstance.getSettings().catch(() => null),
      ]);

      const currentYearMonth = formatLocalYearMonth();
      const currentYear = new Date().getFullYear();
      const monthly = await storageInstance.getMonthlyListeningHistory(currentYearMonth);
      const yearly =
        typeof (storageInstance as any).getYearlyReplayStats === 'function'
          ? await storageInstance.getYearlyReplayStats(currentYear)
          : computeYearlyReplayStats(history, currentYear, monthly ? [monthly] : []);

      const settingsFolders = Array.isArray(settings?.['storage.localFolders'])
        ? (settings['storage.localFolders'] as string[])
        : [];
      const cachedFolders = Array.isArray(diskCache?.folders) ? (diskCache.folders as string[]) : [];
      const hydratedFolders = dedupeFolderList([...cachedFolders, ...settingsFolders]);
      const hydratedLocalSongs = Array.isArray(diskCache?.tracks)
        ? diskCache.tracks.map((t: any) => normalizeLocalTrack(t))
        : get().localSongs;

      set({
        playlists,
        favorites: favorites.map((s) => normalizeSong(s as any)),
        listeningHistory: [...history].reverse().slice(0, 200),
        monthlyStats: monthly,
        yearlyReplayStats: yearly,
        localFolders: hydratedFolders.length > 0 ? hydratedFolders : get().localFolders,
        localSongs: hydratedLocalSongs,
        isLoaded: true,
      });

      // Run non-blocking background incremental scan in Electron so new/modified/deleted files stay in sync
      if (hasPlatformBridge('incrementalScanLocalFolders') && hydratedFolders.length > 0) {
        void Promise.resolve(api.incrementalScanLocalFolders(hydratedFolders))
          .then((result: any) => {
            if (!result || !Array.isArray(result.tracks)) return;
            const syncedSongs = result.tracks.map((t: any) => normalizeLocalTrack(t));
            const syncedFolders = Array.isArray(result.folders)
              ? dedupeFolderList(result.folders)
              : hydratedFolders;
            set({
              localSongs: syncedSongs,
              localFolders: syncedFolders,
            });
          })
          .catch((err: unknown) => {
            console.warn('[libraryStore] background incrementalScanLocalFolders failed:', err);
          });
      }
    } catch (err) {
      console.warn('[libraryStore] initLibrary failed:', err);
      set({ isLoaded: true });
    }
  },

  createPlaylist: async (rawTitle: string, description = ''): Promise<Playlist> => {
    // 100-character clamp per B18-T04
    const sanitizedTitle = (rawTitle || '').trim().slice(0, 100);
    if (!sanitizedTitle) {
      throw new Error('Playlist title cannot be empty');
    }

    const { storageService, playlists } = get();
    const storage = storageService || new StorageService();

    const created = await storage.createPlaylist(sanitizedTitle, description.trim());
    set({ playlists: [...playlists, created] });
    return created;
  },

  createPlaylistWithSongs: async (
    rawTitle: string,
    songs: Song[],
    options: { description?: string; thumbnailUrl?: string | null; sourceUrl?: string } = {}
  ): Promise<Playlist> => {
    const sanitizedTitle = (rawTitle || '').trim().slice(0, 100);
    if (!sanitizedTitle) {
      throw new Error('Playlist title cannot be empty');
    }
    const { storageService, playlists } = get();
    const storage = storageService || globalStorageInstance || new StorageService();
    const created = await storage.createPlaylistWithSongs(sanitizedTitle, songs, options);
    set({ playlists: [...playlists, created] });
    return created;
  },

  addTracksToPlaylist: async (playlistId: string, trackIds: string[]) => {
    const { storageService } = get();
    const storage = storageService || new StorageService();

    await storage.addTracksToPlaylist(playlistId, trackIds);
    // Refresh playlists in state
    const refreshed = await storage.getPlaylists();
    set({ playlists: refreshed });
  },

  removeTrackFromPlaylist: async (playlistId: string, trackId: string) => {
    const { storageService, playlists } = get();
    const target = playlists.find((p) => p.id === playlistId);
    if (!target) return;

    const updatedSongIds = target.songIds.filter((id) => id !== trackId);
    const updatedPlaylists = playlists.map((p) => {
      if (p.id === playlistId) {
        return {
          ...p,
          songIds: updatedSongIds,
          songCount: updatedSongIds.length,
          updatedAt: new Date().toISOString(),
        };
      }
      return p;
    });

    set({ playlists: updatedPlaylists });

    const storage = storageService || new StorageService();
    try {
      await storage.removeTracksFromPlaylist(playlistId, [trackId]);
    } catch (err) {
      console.warn('[libraryStore] removeTrackFromPlaylist persistence error:', err);
    }
  },

  renamePlaylist: async (playlistId: string, rawNewTitle: string): Promise<Playlist | null> => {
    const sanitizedTitle = (rawNewTitle || '').trim().slice(0, 100);
    if (!sanitizedTitle) {
      throw new Error('Playlist title cannot be empty');
    }
    const { storageService, playlists } = get();
    const target = playlists.find((p) => p.id === playlistId);
    if (!target) return null;

    const updatedPlaylist: Playlist = {
      ...target,
      title: sanitizedTitle,
      updatedAt: new Date().toISOString(),
    };
    set({
      playlists: playlists.map((p) => (p.id === playlistId ? updatedPlaylist : p)),
    });

    const storage = storageService || globalStorageInstance || new StorageService();
    try {
      const persisted = await storage.renamePlaylist(playlistId, sanitizedTitle);
      if (persisted) {
        set({
          playlists: get().playlists.map((p) => (p.id === playlistId ? persisted : p)),
        });
        return persisted;
      }
    } catch (err) {
      console.warn('[libraryStore] renamePlaylist persistence error:', err);
    }
    return updatedPlaylist;
  },

  duplicatePlaylist: async (playlistId: string): Promise<Playlist | null> => {
    const { storageService, playlists } = get();
    const source = playlists.find((p) => p.id === playlistId);
    if (!source) return null;

    const storage = storageService || globalStorageInstance || new StorageService();
    try {
      const duplicated = await storage.duplicatePlaylist(playlistId);
      if (duplicated) {
        set({ playlists: [...get().playlists, duplicated] });
        return duplicated;
      }
    } catch (err) {
      console.warn('[libraryStore] duplicatePlaylist persistence error:', err);
    }
    const nowIso = new Date().toISOString();
    const copyTitle = `${(source.title || 'Playlist').replace(/\s*\(Copy\)$/i, '').trim()} (Copy)`.slice(0, 100);
    const fallback: Playlist = {
      ...source,
      id: `pl_custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: copyTitle,
      isCustom: true,
      createdAt: nowIso,
      updatedAt: nowIso,
      songIds: Array.isArray(source.songIds) ? [...source.songIds] : [],
    };
    set({ playlists: [...get().playlists, fallback] });
    return fallback;
  },

  deletePlaylist: async (playlistId: string): Promise<boolean> => {
    const { storageService, playlists } = get();
    const exists = playlists.some((p) => p.id === playlistId);
    if (!exists) {
      // Per B18-T01: Returns false gracefully without throwing
      return false;
    }

    set({ playlists: playlists.filter((p) => p.id !== playlistId) });

    const storage = storageService || new StorageService();
    try {
      return await storage.deletePlaylist(playlistId);
    } catch (err) {
      console.warn('[libraryStore] deletePlaylist persistence error:', err);
      return false;
    }
  },

  toggleFavorite: async (rawSong: Song): Promise<boolean> => {
    const song = normalizeSong(rawSong as any);
    const { storageService, favorites } = get();
    const storage = storageService || new StorageService();

    const result = await storage.toggleFavorite(song as any);
    if (result) {
      // Added to favorites
      set({ favorites: [...favorites, song] });
    } else {
      // Removed from favorites
      set({ favorites: favorites.filter((f) => f.videoId !== song.videoId) });
    }
    return result;
  },

  isFavorite: (videoId: string): boolean => {
    return get().favorites.some((f) => f.videoId === videoId);
  },

  upsertListeningSession: async (entry: RichListeningHistoryEntry) => {
    if (!entry || !entry.videoId) return;
    const { storageService, listeningHistory } = get();
    const storage = storageService || globalStorageInstance || new StorageService();
    if (typeof (storage as any).upsertListeningSession === 'function') {
      await (storage as any).upsertListeningSession(entry);
    } else {
      await storage.recordListeningHistory(entry as any, entry.listenedSeconds ?? entry.durationSec ?? 0);
    }

    const idx = listeningHistory.findIndex(
      (h) => (entry.sessionId && h.sessionId === entry.sessionId) || (h.videoId === entry.videoId && h.timestamp === entry.timestamp)
    );
    const nextHistory =
      idx >= 0
        ? listeningHistory.map((h, i) => (i === idx ? entry : h))
        : [entry, ...listeningHistory].slice(0, 200);

    const now = new Date();
    const targetMonth = formatLocalYearMonth(now);
    const targetYear = now.getFullYear();

    let nextMonthly = get().monthlyStats;
    let nextYearly = get().yearlyReplayStats;
    try {
      const [m, y] = await Promise.all([
        typeof (storage as any).getMonthlyListeningHistory === 'function'
          ? storage.getMonthlyListeningHistory(targetMonth)
          : Promise.resolve(nextMonthly),
        typeof (storage as any).getYearlyReplayStats === 'function'
          ? storage.getYearlyReplayStats(targetYear)
          : Promise.resolve(computeYearlyReplayStats(nextHistory, targetYear)),
      ]);
      nextMonthly = m;
      nextYearly = y;
    } catch (err) {
      console.warn('[libraryStore] Failed to refresh replay stats after session upsert:', err);
    }

    set({
      listeningHistory: nextHistory,
      monthlyStats: nextMonthly,
      yearlyReplayStats: nextYearly,
    });
  },

  recordListeningHistory: async (rawSong: Song, durationSec: number) => {
    const song = normalizeSong(rawSong as any);
    const { storageService, listeningHistory } = get();
    const storage = storageService || globalStorageInstance || new StorageService();

    await storage.recordListeningHistory(song as any, durationSec);

    const albumName =
      (typeof song.albumName === 'string' && song.albumName.trim()) ||
      (typeof song.album === 'string' && song.album.trim()) ||
      undefined;
    const artworkUrl =
      (typeof song.thumbnailUrl === 'string' && song.thumbnailUrl.trim()) ||
      (typeof song.artworkUrl === 'string' && song.artworkUrl.trim()) ||
      undefined;
    const qualityLabel =
      (typeof song.sourceQuality === 'string' && song.sourceQuality.trim()) ||
      (typeof song.audioQuality === 'string' && song.audioQuality.trim()) ||
      (typeof song.codec === 'string' && song.codec.trim()) ||
      undefined;

    const newEntry: RichListeningHistoryEntry = {
      videoId: song.videoId,
      title: song.title,
      artist: song.artist,
      ...(albumName ? { albumName } : {}),
      ...(artworkUrl ? { artworkUrl } : {}),
      ...(qualityLabel ? { qualityLabel } : {}),
      timestamp: Date.now(),
      durationSec,
    };

    const nextHistory = [newEntry, ...listeningHistory].slice(0, 200);
    const now = new Date();
    const targetMonth = formatLocalYearMonth(now);
    const targetYear = now.getFullYear();

    let nextMonthly = get().monthlyStats;
    let nextYearly = get().yearlyReplayStats;
    try {
      const [m, y] = await Promise.all([
        typeof (storage as any).getMonthlyListeningHistory === 'function'
          ? storage.getMonthlyListeningHistory(targetMonth)
          : Promise.resolve(nextMonthly),
        typeof (storage as any).getYearlyReplayStats === 'function'
          ? storage.getYearlyReplayStats(targetYear)
          : Promise.resolve(computeYearlyReplayStats(nextHistory, targetYear)),
      ]);
      nextMonthly = m;
      nextYearly = y;
    } catch (err) {
      console.warn('[libraryStore] Failed to refresh replay stats after recording:', err);
    }

    set({
      listeningHistory: nextHistory,
      monthlyStats: nextMonthly,
      yearlyReplayStats: nextYearly,
    });
  },

  refreshMonthlyStats: async (yearMonth?: string) => {
    const targetMonth = yearMonth || formatLocalYearMonth();
    const { storageService } = get();
    const storage = storageService || globalStorageInstance || new StorageService();

    try {
      const stats = await storage.getMonthlyListeningHistory(targetMonth);
      set({ monthlyStats: stats });
    } catch (err) {
      console.warn('[libraryStore] refreshMonthlyStats failed:', err);
    }
  },

  refreshYearlyReplayStats: async (year = 2026) => {
    const { storageService, listeningHistory, monthlyStats } = get();
    const storage = storageService || globalStorageInstance || new StorageService();

    try {
      const stats =
        typeof (storage as any).getYearlyReplayStats === 'function'
          ? await storage.getYearlyReplayStats(year)
          : computeYearlyReplayStats(listeningHistory, year, monthlyStats ? [monthlyStats] : []);
      set({ yearlyReplayStats: stats });
    } catch (err) {
      console.warn('[libraryStore] refreshYearlyReplayStats failed:', err);
    }
  },

  resetListeningData: async () => {
    const { storageService } = get();
    const storage = storageService || globalStorageInstance || new StorageService();
    try {
      await storage.resetListeningData();
    } catch (err) {
      console.warn('[libraryStore] resetListeningData failed:', err);
    }
    set({
      listeningHistory: [],
      monthlyStats: null,
      yearlyReplayStats: null,
    });
  },

  startLocalMediaScan: async (scanner, folderPath: string): Promise<Song[]> => {
    const cleanFolder = (folderPath || '').trim();
    if (!cleanFolder) return [];

    set({
      scanState: {
        isScanning: true,
        scannedFiles: 0,
        totalFiles: 0,
        currentFolder: cleanFolder,
        error: null,
      },
    });

    try {
      const api = getElectronApi();
      let rawScanned: any[] = [];

      if (scanner && typeof (scanner as any).scanDirectory === 'function') {
        rawScanned = await (scanner as any).scanDirectory(cleanFolder);
      } else if (hasPlatformBridge('scanLocalFolder')) {
        rawScanned = await api.scanLocalFolder(cleanFolder);
      } else {
        // High-resolution local library fallback for browser preview environment
        rawScanned = [
          {
            videoId: `local_${hashTextShort(`${cleanFolder}/Overdrive.flac`)}`,
            title: 'Lazerhawk - Overdrive (Local Master)',
            artist: 'Lazerhawk',
            album: 'Redline',
            albumName: 'Redline',
            albumArtist: 'Lazerhawk',
            totalPlayTimeMs: 271000,
            durationSec: 271,
            liked: false,
            playCount: 1,
            artistIds: [],
            artists: [],
            isExplicit: false,
            sourceQuality: '24-bit / 96kHz FLAC',
            codec: 'FLAC',
            bitDepth: 24,
            sampleRate: 96000,
            source: 'local',
            isLocal: true,
            playbackSourceType: 'LOCAL',
            folderPath: cleanFolder,
            localFilePath: `${cleanFolder}\\Overdrive.flac`,
          },
          {
            videoId: `local_${hashTextShort(`${cleanFolder}/Ode_To_The_Mets.m4a`)}`,
            title: 'The Strokes - Ode to the Mets (Studio Lossless)',
            artist: 'The Strokes',
            album: 'The New Abnormal',
            albumName: 'The New Abnormal',
            albumArtist: 'The Strokes',
            totalPlayTimeMs: 351000,
            durationSec: 351,
            liked: false,
            playCount: 1,
            artistIds: [],
            artists: [],
            isExplicit: false,
            sourceQuality: '24-bit / 48kHz ALAC',
            codec: 'ALAC',
            bitDepth: 24,
            sampleRate: 48000,
            source: 'local',
            isLocal: true,
            playbackSourceType: 'LOCAL',
            folderPath: cleanFolder,
            localFilePath: `${cleanFolder}\\Ode_To_The_Mets.m4a`,
          },
        ];
      }

      const scannedSongs = (Array.isArray(rawScanned) ? rawScanned : []).map((t) =>
        normalizeLocalTrack(t, cleanFolder)
      );

      const targetFolderKey = normalizeFolderKey(cleanFolder);
      const targetPrefix = `${targetFolderKey}/`;
      const prevState = get();

      // Index previous tracks so previously enriched artwork is preserved on rescan
      const prevById = new Map<string, Song>();
      for (const s of prevState.localSongs) {
        if (s?.videoId) prevById.set(s.videoId, s);
      }

      // Preserve ALL tracks from other previously scanned folders; replace only tracks from this folder
      const preservedOtherFolders = prevState.localSongs.filter((track) => {
        const trackFolderKey = normalizeFolderKey(String((track as any).folderPath || ''));
        const trackFileKey = normalizeFolderKey(String(track.localFilePath || ''));
        if (trackFolderKey && trackFolderKey === targetFolderKey) return false;
        if (!trackFolderKey && (trackFileKey === targetFolderKey || trackFileKey.startsWith(targetPrefix))) {
          return false;
        }
        return true;
      });

      const mergedById = new Map<string, Song>();
      for (const s of preservedOtherFolders) {
        mergedById.set(s.videoId, s);
      }
      for (const s of scannedSongs) {
        const old = prevById.get(s.videoId);
        mergedById.set(s.videoId, {
          ...s,
          thumbnailUrl: s.thumbnailUrl || old?.thumbnailUrl || null,
          artworkUrl: s.artworkUrl || old?.artworkUrl || s.thumbnailUrl || undefined,
        });
      }

      const mergedSongs = Array.from(mergedById.values());
      const nextFolders = dedupeFolderList([...prevState.localFolders, cleanFolder]);

      set({
        localSongs: mergedSongs,
        localFolders: nextFolders,
        scanState: {
          isScanning: false,
          scannedFiles: scannedSongs.length,
          totalFiles: scannedSongs.length,
          currentFolder: null,
          error: null,
        },
      });

      // Persist unified local cache to disk via Electron IPC (best-effort)
      if (typeof api?.saveLocalLibraryCache === 'function') {
        try {
          await api.saveLocalLibraryCache({
            folders: nextFolders,
            tracks: mergedSongs,
          });
        } catch (err) {
          console.warn('[libraryStore] saveLocalLibraryCache failed:', err);
        }
      }

      await persistFoldersSetting(nextFolders, prevState.storageService);

      return scannedSongs;
    } catch (err: any) {
      set({
        scanState: {
          isScanning: false,
          scannedFiles: 0,
          totalFiles: 0,
          currentFolder: null,
          error: err?.message || 'Scan failed',
        },
      });
      return [];
    }
  },

  removeLocalFolder: async (folderPath: string): Promise<void> => {
    const cleanFolder = (folderPath || '').trim();
    if (!cleanFolder) return;

    const api = getElectronApi();
    const prevState = get();
    const targetKey = normalizeFolderKey(cleanFolder);
    const targetPrefix = `${targetKey}/`;

    let nextFolders: string[];
    let nextTracks: Song[];

    const removeFolderIpc =
      hasPlatformBridge('removeLocalFolder')
        ? (folder: string) => api.removeLocalFolder(folder)
        : hasPlatformBridge('removeLocalLibraryFolder')
        ? (folder: string) => api.removeLocalLibraryFolder?.(folder)
        : null;

    if (removeFolderIpc) {
      try {
        const updated = await removeFolderIpc(cleanFolder);
        nextFolders = Array.isArray(updated?.folders)
          ? dedupeFolderList(updated.folders)
          : prevState.localFolders.filter((f) => normalizeFolderKey(f) !== targetKey);
        nextTracks = Array.isArray(updated?.tracks)
          ? updated.tracks.map((t: any) => normalizeLocalTrack(t))
          : prevState.localSongs.filter((t) => {
              const tf = normalizeFolderKey(String((t as any).folderPath || ''));
              const tp = normalizeFolderKey(String(t.localFilePath || ''));
              return tf !== targetKey && tp !== targetKey && !tp.startsWith(targetPrefix);
            });
      } catch (err) {
        console.warn('[libraryStore] removeLocalLibraryFolder IPC failed:', err);
        nextFolders = prevState.localFolders.filter((f) => normalizeFolderKey(f) !== targetKey);
        nextTracks = prevState.localSongs.filter((t) => {
          const tf = normalizeFolderKey(String((t as any).folderPath || ''));
          const tp = normalizeFolderKey(String(t.localFilePath || ''));
          return tf !== targetKey && tp !== targetKey && !tp.startsWith(targetPrefix);
        });
      }
    } else {
      nextFolders = prevState.localFolders.filter((f) => normalizeFolderKey(f) !== targetKey);
      nextTracks = prevState.localSongs.filter((t) => {
        const tf = normalizeFolderKey(String((t as any).folderPath || ''));
        const tp = normalizeFolderKey(String(t.localFilePath || ''));
        return tf !== targetKey && tp !== targetKey && !tp.startsWith(targetPrefix);
      });

      if (hasPlatformBridge('saveLocalLibraryCache')) {
        try {
          await getPlatformBridge().saveLocalLibraryCache({ folders: nextFolders, tracks: nextTracks });
        } catch {
          // Non-fatal
        }
      }
    }

    set({
      localFolders: nextFolders,
      localSongs: nextTracks,
    });

    await persistFoldersSetting(nextFolders, prevState.storageService);
  },

  upsertLocalTrackPatch: async (videoId: string, patch: Partial<Song>): Promise<void> => {
    if (!videoId || !patch || typeof patch !== 'object') return;

    const safePatch: Partial<Song> = { ...patch };
    if (
      typeof safePatch.thumbnailUrl === 'string' &&
      safePatch.thumbnailUrl.startsWith('data:') &&
      safePatch.thumbnailUrl.length > 2048
    ) {
      delete safePatch.thumbnailUrl;
    }
    if (
      typeof safePatch.artworkUrl === 'string' &&
      safePatch.artworkUrl.startsWith('data:') &&
      safePatch.artworkUrl.length > 2048
    ) {
      delete safePatch.artworkUrl;
    }

    const prevState = get();
    let changed = false;
    const nextTracks = prevState.localSongs.map((s) => {
      if (s.videoId !== videoId) return s;
      changed = true;
      return normalizeLocalTrack({ ...s, ...safePatch });
    });

    if (!changed) return;

    set({ localSongs: nextTracks });

    if (hasPlatformBridge('saveLocalLibraryCache')) {
      try {
        await getPlatformBridge().saveLocalLibraryCache({
          folders: prevState.localFolders,
          tracks: nextTracks,
        });
      } catch (err) {
        console.warn('[libraryStore] upsertLocalTrackPatch persistence failed:', err);
      }
    }
  },

  setLocalSongs: (songs: Song[]) => {
    set({ localSongs: songs });
  },
}));
