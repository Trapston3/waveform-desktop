// src/services/OfflineCacheService.ts
// Renderer service & Zustand store managing offline pinned tracks and configurable LRU disk cache stats

import { create } from 'zustand';
import type { Song } from '../models/Song';
import { StreamResolver } from './StreamResolver';
import { getPlatformBridge, hasPlatformBridge } from '../platform/index';

export interface OfflineCacheStatsState {
  limitBytes: number;
  limitGb: number;
  totalBytes: number;
  pinnedBytes: number;
  unpinnedBytes: number;
  pinnedCount: number;
  unpinnedCount: number;
  pinnedTrackIds: string[];
}

interface OfflineCacheStoreState {
  pinnedIds: string[];
  pinningIds: string[];
  stats: OfflineCacheStatsState;
  lastError: string | null;

  refreshStats: () => Promise<OfflineCacheStatsState | null>;
  setLimitGb: (gb: number) => Promise<OfflineCacheStatsState | null>;
  clearUnpinnedCache: () => Promise<{ removedCount: number; freedBytes: number } | null>;
  pinTrack: (track: Song) => Promise<boolean>;
  unpinTrack: (trackId: string) => Promise<boolean>;
  pinTracks: (tracks: Song[]) => Promise<number>;
  unpinTracks: (trackIds: string[]) => Promise<void>;
  isPinned: (trackId?: string | null) => boolean;
}

const DEFAULT_STATS: OfflineCacheStatsState = {
  limitBytes: 5 * 1024 * 1024 * 1024,
  limitGb: 5,
  totalBytes: 0,
  pinnedBytes: 0,
  unpinnedBytes: 0,
  pinnedCount: 0,
  unpinnedCount: 0,
  pinnedTrackIds: [],
};

function getApi(): any {
  return hasPlatformBridge() ? getPlatformBridge() : undefined;
}

function applyStats(
  set: (partial: Partial<OfflineCacheStoreState>) => void,
  stats?: OfflineCacheStatsState | null
): void {
  if (!stats || typeof stats !== 'object') return;
  const pinnedIds = Array.isArray(stats.pinnedTrackIds) ? stats.pinnedTrackIds : [];
  set({ stats, pinnedIds });
}

export const useOfflineCacheStore = create<OfflineCacheStoreState>((set, get) => ({
  pinnedIds: [],
  pinningIds: [],
  stats: DEFAULT_STATS,
  lastError: null,

  refreshStats: async () => {
    if (!hasPlatformBridge('offlineCacheGetStats')) return null;
    try {
      const stats = await getPlatformBridge().offlineCacheGetStats();
      applyStats(set, stats);
      return stats;
    } catch {
      return null;
    }
  },

  setLimitGb: async (gb: number) => {
    if (!hasPlatformBridge('offlineCacheSetLimitGb')) return null;
    try {
      const stats = await getPlatformBridge().offlineCacheSetLimitGb(gb);
      applyStats(set, stats);
      return stats;
    } catch {
      return null;
    }
  },

  clearUnpinnedCache: async () => {
    if (!hasPlatformBridge('offlineCacheClearUnpinned')) return null;
    try {
      const res = await getPlatformBridge().offlineCacheClearUnpinned();
      if (res?.stats) applyStats(set, res.stats);
      return {
        removedCount: Number(res?.removedCount) || 0,
        freedBytes: Number(res?.freedBytes) || 0,
      };
    } catch {
      return null;
    }
  },

  pinTrack: async (track: Song) => {
    const trackId = track?.videoId || track?.id || '';
    if (!trackId || !hasPlatformBridge('offlineCachePin')) return false;
    const api = getApi();

    set((s) => ({
      pinningIds: s.pinningIds.includes(trackId) ? s.pinningIds : [...s.pinningIds, trackId],
      lastError: null,
    }));

    try {
      let streamUrl = track.streamUrl || '';
      const localFilePath = track.localFilePath || '';
      if (!localFilePath && (!streamUrl || streamUrl.includes('sn-audio') || streamUrl.includes('sn-redline'))) {
        const resolver = new StreamResolver();
        const resolved = await resolver.resolve(trackId, track.title, track.artist, track.durationSec);
        if (resolved?.url) streamUrl = resolved.url;
      }

      const stats = await api.offlineCachePin({
        trackId,
        title: track.title,
        artist: track.artist,
        album: track.album || track.albumName,
        streamUrl,
        localFilePath,
      });
      applyStats(set, stats);
      return true;
    } catch (err) {
      set({ lastError: err instanceof Error ? err.message : 'Failed to pin track' });
      return false;
    } finally {
      set((s) => ({
        pinningIds: s.pinningIds.filter((id) => id !== trackId),
      }));
    }
  },

  unpinTrack: async (trackId: string) => {
    if (!trackId || !hasPlatformBridge('offlineCacheUnpin')) return false;
    try {
      const stats = await getPlatformBridge().offlineCacheUnpin(trackId);
      applyStats(set, stats);
      return true;
    } catch {
      return false;
    }
  },

  pinTracks: async (tracks: Song[]) => {
    let okCount = 0;
    for (const t of tracks) {
      const ok = await get().pinTrack(t);
      if (ok) okCount += 1;
    }
    return okCount;
  },

  unpinTracks: async (trackIds: string[]) => {
    for (const id of trackIds) {
      await get().unpinTrack(id);
    }
  },

  isPinned: (trackId?: string | null) => {
    if (!trackId) return false;
    return get().pinnedIds.includes(trackId);
  },
}));

export const OfflineCacheService = {
  async resolveOfflineUrl(trackId?: string | null): Promise<{
    url: string;
    pinned: boolean;
    sizeBytes: number;
    mimeType?: string;
  } | null> {
    if (!trackId || !hasPlatformBridge('offlineCacheResolve')) return null;
    try {
      const res = await getPlatformBridge().offlineCacheResolve(trackId);
      if (res?.url) return res;
    } catch {
      // Cache lookup miss
    }
    return null;
  },
};
