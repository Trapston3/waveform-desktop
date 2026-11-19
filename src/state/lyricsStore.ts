// src/state/lyricsStore.ts
// Centralized state store for dynamic lyrics retrieval and caching

import { create } from 'zustand';
import type { Song } from '../models/Song';
import type { ParsedLyrics } from '../services/LyricsService';
import { LyricsService } from '../services/LyricsService';

export interface LyricsState {
  currentTrackId: string | null;
  lyricsData: ParsedLyrics | null;
  isLoading: boolean;
  error: string | null;

  fetchLyricsForTrack: (track: Song | null) => Promise<void>;
  clearLyrics: () => void;
  setLyricsData: (lyrics: ParsedLyrics | null) => void;
}

export const useLyricsStore = create<LyricsState>((set, get) => ({
  currentTrackId: null,
  lyricsData: null,
  isLoading: false,
  error: null,

  fetchLyricsForTrack: async (track: Song | null) => {
    if (!track) {
      set({ currentTrackId: null, lyricsData: null, isLoading: false, error: null });
      return;
    }

    const trackId = track.videoId || track.id || 'unknown';

    // If already loaded for this track, avoid re-fetching
    if (get().currentTrackId === trackId && get().lyricsData !== null) {
      return;
    }

    // Set loading state (suppresses "No lyrics" flash)
    set({
      currentTrackId: trackId,
      lyricsData: null,
      isLoading: true,
      error: null,
    });

    try {
      // Check embedded track metadata first
      const rawLyricsValue = (track as any).lyrics;
      let rawLyrics: string | null = null;
      if (typeof rawLyricsValue === 'string' && rawLyricsValue.trim()) {
        rawLyrics = rawLyricsValue.trim();
      } else if (Array.isArray(rawLyricsValue) && rawLyricsValue.length > 0) {
        const joined = rawLyricsValue
          .map((item) => (typeof item === 'string' ? item : item?.text || ''))
          .filter(Boolean)
          .join('\n')
          .trim();
        if (joined) rawLyrics = joined;
      }

      if (rawLyrics) {
        let parsed: ParsedLyrics;
        if (rawLyrics.includes('<tt') || rawLyrics.includes('<span')) {
          parsed = LyricsService.parseTtml(rawLyrics, 'Embedded');
        } else if (/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/.test(rawLyrics)) {
          parsed = LyricsService.parseLrc(rawLyrics, 'Embedded');
        } else {
          parsed = {
            type: 'UNSYNCED',
            provider: 'Embedded',
            isSynced: false,
            isRtl: LyricsService.isRtlText(rawLyrics),
            lines: rawLyrics
              .split(/\r?\n/)
              .map((t, i) => ({ lineIndex: i, startTimeMs: 0, endTimeMs: 0, text: t.trim() }))
              .filter((l) => l.text.length > 0),
          };
        }

        if (get().currentTrackId === trackId) {
          set({ lyricsData: parsed, isLoading: false, error: null });
        }
        return;
      }

      const api = typeof window !== 'undefined' ? (window as any).electronAPI : undefined;
      const cacheKeyArg = {
        artist: track.artist || '',
        title: track.title || '',
        durationSec: track.durationSec,
      };

      // Check persistent disk cache before hitting network
      if (typeof api?.getMetadataCache === 'function') {
        try {
          const cached = await api.getMetadataCache(cacheKeyArg);
          if (get().currentTrackId !== trackId) return;
          if (cached?.lyrics) {
            set({ lyricsData: cached.lyrics as ParsedLyrics, isLoading: false, error: null });
            return;
          }
        } catch {
          // Cache read failure is non-fatal
        }
      }

      const parsed = await LyricsService.fetchLyrics(
        trackId,
        track.title || '',
        track.artist || '',
        track.albumName || track.album || undefined,
        track.durationSec
      );

      // Guard against track changing while fetch was in-flight
      if (get().currentTrackId !== trackId) return;

      if (parsed) {
        set({ lyricsData: parsed, isLoading: false, error: null });
        if (typeof api?.setMetadataCache === 'function') {
          Promise.resolve(api.setMetadataCache(cacheKeyArg, { lyrics: parsed })).catch(() => {});
        }
      } else {
        set({ lyricsData: null, isLoading: false, error: 'NO_LYRICS' });
      }
    } catch (err: any) {
      if (get().currentTrackId === trackId) {
        set({ lyricsData: null, isLoading: false, error: err?.message || 'FETCH_FAILED' });
      }
    }
  },

  clearLyrics: () => {
    set({ currentTrackId: null, lyricsData: null, isLoading: false, error: null });
  },

  setLyricsData: (lyrics: ParsedLyrics | null) => {
    set({ lyricsData: lyrics, isLoading: false, error: null });
  },
}));
