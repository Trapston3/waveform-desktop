// src/state/queueStore.ts
// 3-Tier Queue Priority Engine (USER_QUEUE -> CONTEXT -> AUTOPLAY)

import { create } from 'zustand';
import type { Song } from '../models/Song';
import { normalizeSong } from '../models/Song';
import type { PlaybackContext } from '../models/Queue';
import { usePlayerStore } from './playerStore';
import { loadSyncSession } from '../utils/sessionPersistence';

export interface QueueTiers {
  USER_QUEUE: Song[];
  CONTEXT: Song[];
  AUTOPLAY: Song[];
}

export type QueueTierType = keyof QueueTiers;

export interface QueueState {
  tiers: QueueTiers;
  currentSong: Song | null;
  currentTier: QueueTierType | null;
  currentIndex: number;
  history: Song[];
  context: PlaybackContext | null;
  isAutoplayLoading: boolean;
}

export interface QueueActions {
  // Queue Population
  addToUserQueue: (song: Song) => void;
  playNext: (song: Song) => void;
  setContextQueue: (songs: Song[], startIndex?: number, context?: PlaybackContext) => void;
  setAutoplayQueue: (songs: Song[]) => void;

  // Queue Item Manipulation
  removeFromQueue: (tier: QueueTierType, index: number) => void;
  reorderQueue: (tier: QueueTierType, fromIndex: number, toIndex: number) => void;
  clearQueue: (tier?: QueueTierType) => void;

  // Aliases
  insertNext: (song: Song) => void;
  removeTrack: (tier: QueueTierType, index: number) => void;
  moveTrack: (tier: QueueTierType, fromIndex: number, toIndex: number) => void;

  // Queue Traversal (The Core Dispatch Algorithm)
  advanceQueue: () => Song | null;
  previousTrack: () => Song | null;
  jumpToTrack: (tier: QueueTierType, index: number) => Song | null;
  setCurrentSong: (song: Song | null) => void;
}

export type QueueStore = QueueState & QueueActions;

const initialSession = typeof window !== 'undefined' || typeof globalThis !== 'undefined' ? loadSyncSession() : null;
const initialQueue = initialSession?.queue;

export const useQueueStore = create<QueueStore>((set, get) => ({
  tiers: initialQueue?.tiers || {
    USER_QUEUE: [],
    CONTEXT: [],
    AUTOPLAY: [],
  },
  currentSong: initialQueue?.currentSong || null,
  currentTier: initialQueue?.currentTier || null,
  currentIndex: initialQueue?.currentIndex ?? -1,
  history: initialQueue?.history || [],
  context: initialQueue?.context || null,
  isAutoplayLoading: false,

  addToUserQueue: (rawSong: Song) => {
    const song = normalizeSong(rawSong as any);
    set((state) => ({
      tiers: {
        ...state.tiers,
        USER_QUEUE: [...state.tiers.USER_QUEUE, song],
      },
    }));
  },

  playNext: (rawSong: Song) => {
    const song = normalizeSong(rawSong as any);
    set((state) => ({
      tiers: {
        ...state.tiers,
        USER_QUEUE: [song, ...state.tiers.USER_QUEUE],
      },
    }));
  },

  setContextQueue: (rawSongs: Song[], startIndex = 0, context?: PlaybackContext) => {
    const songs = rawSongs.map((s) => normalizeSong(s as any));
    const validIndex = Math.max(0, Math.min(songs.length - 1, startIndex));
    const current = songs[validIndex] || null;

    set({
      tiers: {
        ...get().tiers,
        CONTEXT: songs,
      },
      currentSong: current,
      currentTier: 'CONTEXT',
      currentIndex: validIndex,
      context: context || null,
    });

    if (current) {
      usePlayerStore.getState().loadTrack(current, 'active', true);
    }
  },

  setAutoplayQueue: (rawSongs: Song[]) => {
    const songs = rawSongs.map((s) => normalizeSong(s as any));
    set((state) => ({
      tiers: {
        ...state.tiers,
        AUTOPLAY: songs,
      },
    }));
  },

  removeFromQueue: (tier: QueueTierType, index: number) => {
    set((state) => {
      const list = [...state.tiers[tier]];
      if (index >= 0 && index < list.length) {
        list.splice(index, 1);
      }
      return {
        tiers: {
          ...state.tiers,
          [tier]: list,
        },
      };
    });
  },

  reorderQueue: (tier: QueueTierType, fromIndex: number, toIndex: number) => {
    set((state) => {
      const list = [...state.tiers[tier]];
      if (
        fromIndex < 0 ||
        fromIndex >= list.length ||
        toIndex < 0 ||
        toIndex >= list.length ||
        fromIndex === toIndex
      ) {
        return state;
      }
      const [moved] = list.splice(fromIndex, 1);
      list.splice(toIndex, 0, moved);
      return {
        tiers: {
          ...state.tiers,
          [tier]: list,
        },
      };
    });
  },

  insertNext: (song: Song) => {
    get().playNext(song);
  },

  removeTrack: (tier: QueueTierType, index: number) => {
    get().removeFromQueue(tier, index);
  },

  moveTrack: (tier: QueueTierType, fromIndex: number, toIndex: number) => {
    get().reorderQueue(tier, fromIndex, toIndex);
  },

  clearQueue: (tier?: QueueTierType) => {
    set((state) => {
      if (tier) {
        return {
          tiers: {
            ...state.tiers,
            [tier]: [],
          },
        };
      }
      return {
        tiers: {
          USER_QUEUE: [],
          CONTEXT: [],
          AUTOPLAY: [],
        },
      };
    });
  },

  advanceQueue: (): Song | null => {
    const { tiers, currentSong, history, currentIndex } = get();
    const { repeatMode } = usePlayerStore.getState();

    // Push previous song to history if valid
    const nextHistory = currentSong ? [currentSong, ...history].slice(0, 50) : history;

    // 1. Check repeatMode 'one'
    if (repeatMode === 'one' && currentSong) {
      usePlayerStore.getState().seek(0);
      usePlayerStore.getState().play();
      return currentSong;
    }

    // 2. Check Tier 1: USER_QUEUE
    if (tiers.USER_QUEUE.length > 0) {
      const [nextSong, ...remainingUserQueue] = tiers.USER_QUEUE;
      set({
        tiers: {
          ...tiers,
          USER_QUEUE: remainingUserQueue,
        },
        currentSong: nextSong,
        currentTier: 'USER_QUEUE',
        history: nextHistory,
      });
      usePlayerStore.getState().loadTrack(nextSong, 'active', true);
      return nextSong;
    }

    // 3. Check Tier 2: CONTEXT
    if (tiers.CONTEXT.length > 0) {
      const nextIndex = currentIndex + 1;
      if (nextIndex < tiers.CONTEXT.length) {
        const nextSong = tiers.CONTEXT[nextIndex];
        set({
          currentSong: nextSong,
          currentTier: 'CONTEXT',
          currentIndex: nextIndex,
          history: nextHistory,
        });
        usePlayerStore.getState().loadTrack(nextSong, 'active', true);
        return nextSong;
      } else if (repeatMode === 'all') {
        // Loop back to beginning of context
        const nextSong = tiers.CONTEXT[0];
        set({
          currentSong: nextSong,
          currentTier: 'CONTEXT',
          currentIndex: 0,
          history: nextHistory,
        });
        usePlayerStore.getState().loadTrack(nextSong, 'active', true);
        return nextSong;
      }
    }

    // 4. Check Tier 3: AUTOPLAY
    if (tiers.AUTOPLAY.length > 0) {
      const [nextSong, ...remainingAutoplay] = tiers.AUTOPLAY;
      set({
        tiers: {
          ...tiers,
          AUTOPLAY: remainingAutoplay,
        },
        currentSong: nextSong,
        currentTier: 'AUTOPLAY',
        history: nextHistory,
      });
      usePlayerStore.getState().loadTrack(nextSong, 'active', true);
      return nextSong;
    }

    // All tiers exhausted
    return null;
  },

  previousTrack: (): Song | null => {
    const { history, currentIndex, tiers } = get();
    const { positionMs, seek } = usePlayerStore.getState();

    // If song played for > 3 seconds, rewind to beginning
    if (positionMs > 3000) {
      seek(0);
      return get().currentSong;
    }

    // Check history first
    if (history.length > 0) {
      const [prevSong, ...remainingHistory] = history;
      set({
        currentSong: prevSong,
        history: remainingHistory,
      });
      usePlayerStore.getState().loadTrack(prevSong, 'active', true);
      return prevSong;
    }

    // Step backward in context if available
    if (tiers.CONTEXT.length > 0 && currentIndex > 0) {
      const prevIndex = currentIndex - 1;
      const prevSong = tiers.CONTEXT[prevIndex];
      set({
        currentSong: prevSong,
        currentIndex: prevIndex,
        currentTier: 'CONTEXT',
      });
      usePlayerStore.getState().loadTrack(prevSong, 'active', true);
      return prevSong;
    }

    seek(0);
    return get().currentSong;
  },

  jumpToTrack: (tier: QueueTierType, index: number): Song | null => {
    const list = get().tiers[tier];
    if (index < 0 || index >= list.length) return null;

    const targetSong = list[index];
    const { currentSong, history } = get();
    const nextHistory = currentSong ? [currentSong, ...history].slice(0, 50) : history;

    if (tier === 'USER_QUEUE') {
      const nextUserQueue = [...list];
      nextUserQueue.splice(index, 1);
      set((state) => ({
        tiers: { ...state.tiers, USER_QUEUE: nextUserQueue },
        currentSong: targetSong,
        currentTier: 'USER_QUEUE',
        history: nextHistory,
      }));
    } else if (tier === 'CONTEXT') {
      set({
        currentSong: targetSong,
        currentTier: 'CONTEXT',
        currentIndex: index,
        history: nextHistory,
      });
    } else if (tier === 'AUTOPLAY') {
      const nextAutoplay = [...list];
      nextAutoplay.splice(index, 1);
      set((state) => ({
        tiers: { ...state.tiers, AUTOPLAY: nextAutoplay },
        currentSong: targetSong,
        currentTier: 'AUTOPLAY',
        history: nextHistory,
      }));
    }

    usePlayerStore.getState().loadTrack(targetSong, 'active', true);
    return targetSong;
  },

  setCurrentSong: (song: Song | null) => {
    set({ currentSong: song ? normalizeSong(song as any) : null });
  },
}));
