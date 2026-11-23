// src/state/lyricsStore.ts
// Centralized state store for dynamic lyrics retrieval, caching, romanization, and async translation

import { create } from 'zustand';
import type { Song } from '../models/Song';
import type { ParsedLyrics } from '../services/LyricsService';
import { LyricsService } from '../services/LyricsService';
import { hasNonLatinScript } from '../utils/transliterate';
import { useSettingsStore } from './settingsStore';

export type LyricsStatus = 'idle' | 'loading' | 'found' | 'not_found' | 'empty' | 'error';

export interface LyricsState {
  currentTrackId: string | null;
  lyricsData: ParsedLyrics | null;
  isLoading: boolean;
  status: LyricsStatus;
  error: string | null;

  fetchLyricsForTrack: (track: Song | null) => Promise<void>;
  clearLyrics: () => void;
  setLyricsData: (lyrics: ParsedLyrics | null) => void;
}

function deriveSettledStatus(lyrics: ParsedLyrics | null): LyricsStatus {
  if (!lyrics) return 'not_found';
  return Array.isArray(lyrics.lines) && lyrics.lines.length > 0 ? 'found' : 'empty';
}

function shouldEnrichTranslations(lyrics: ParsedLyrics): boolean {
  if (!lyrics || !Array.isArray(lyrics.lines) || lyrics.lines.length === 0) return false;
  const needsTranslation = lyrics.lines.some(
    (l) => Boolean(l.text?.trim()) && !(l.translatedText || l.translation)?.trim()
  );
  if (!needsTranslation) return false;

  const settings = useSettingsStore.getState()?.settings;
  const scriptMode = settings?.['lyrics.scriptMode'];
  const translationEnabled =
    Boolean(settings?.['lyrics.translationEnabled']) ||
    scriptMode === 'romanized_translation' ||
    scriptMode === 'original_translation';
  const hasNonLatin = lyrics.lines.some((l) => hasNonLatinScript(l.text));

  return translationEnabled || hasNonLatin;
}

function scheduleAsyncTranslation(
  trackId: string,
  enriched: ParsedLyrics,
  get: () => LyricsState,
  set: (partial: Partial<LyricsState>) => void,
  cacheKeyArg?: { artist: string; title: string; durationSec?: number },
  api?: any
): void {
  if (!shouldEnrichTranslations(enriched)) return;

  LyricsService.translateLyricsLines(enriched)
    .then((translated) => {
      if (get().currentTrackId !== trackId) return;
      if (translated && translated !== enriched) {
        set({ lyricsData: translated, status: deriveSettledStatus(translated) });
        if (cacheKeyArg && typeof api?.setMetadataCache === 'function') {
          Promise.resolve(api.setMetadataCache(cacheKeyArg, { lyrics: translated })).catch(() => {});
        }
      }
    })
    .catch(() => {});
}

export const useLyricsStore = create<LyricsState>((set, get) => ({
  currentTrackId: null,
  lyricsData: null,
  isLoading: false,
  status: 'idle',
  error: null,

  fetchLyricsForTrack: async (track: Song | null) => {
    if (!track) {
      set({ currentTrackId: null, lyricsData: null, isLoading: false, status: 'idle', error: null });
      return;
    }

    const trackId = track.videoId || track.id || 'unknown';

    // If already loaded for this track, avoid re-fetching
    const current = get();
    if (current.currentTrackId === trackId && current.lyricsData !== null) {
      const nextStatus = deriveSettledStatus(current.lyricsData);
      if (current.status !== nextStatus) {
        set({ status: nextStatus });
      }
      return;
    }

    // Set loading state (suppresses "No lyrics" flash)
    set({
      currentTrackId: trackId,
      lyricsData: null,
      isLoading: true,
      status: 'loading',
      error: null,
    });

    const api = typeof window !== 'undefined' ? (window as any).electronAPI : undefined;
    const cacheKeyArg = {
      artist: track.artist || '',
      title: track.title || '',
      durationSec: track.durationSec,
    };

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

        const enriched = LyricsService.enrichNonLatinLyrics(parsed);
        if (get().currentTrackId === trackId) {
          set({
            lyricsData: enriched,
            isLoading: false,
            status: deriveSettledStatus(enriched),
            error: null,
          });
          scheduleAsyncTranslation(trackId, enriched, get, set);
        }
        return;
      }

      // Check persistent disk cache before hitting network
      if (typeof api?.getMetadataCache === 'function') {
        try {
          const cached = await api.getMetadataCache(cacheKeyArg);
          if (get().currentTrackId !== trackId) return;
          if (cached?.lyrics) {
            const enriched = LyricsService.enrichNonLatinLyrics(cached.lyrics as ParsedLyrics);
            set({
              lyricsData: enriched,
              isLoading: false,
              status: deriveSettledStatus(enriched),
              error: null,
            });
            scheduleAsyncTranslation(trackId, enriched, get, set, cacheKeyArg, api);
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
        const enriched = LyricsService.enrichNonLatinLyrics(parsed);
        set({
          lyricsData: enriched,
          isLoading: false,
          status: deriveSettledStatus(enriched),
          error: null,
        });
        if (typeof api?.setMetadataCache === 'function') {
          Promise.resolve(api.setMetadataCache(cacheKeyArg, { lyrics: enriched })).catch(() => {});
        }
        scheduleAsyncTranslation(trackId, enriched, get, set, cacheKeyArg, api);
      } else {
        set({
          lyricsData: null,
          isLoading: false,
          status: 'not_found',
          error: 'NO_LYRICS',
        });
      }
    } catch (err: any) {
      if (get().currentTrackId === trackId) {
        set({
          lyricsData: null,
          isLoading: false,
          status: 'error',
          error: err?.message || 'FETCH_FAILED',
        });
      }
    }
  },

  clearLyrics: () => {
    set({ currentTrackId: null, lyricsData: null, isLoading: false, status: 'idle', error: null });
  },

  setLyricsData: (lyrics: ParsedLyrics | null) => {
    const enriched = lyrics ? LyricsService.enrichNonLatinLyrics(lyrics) : null;
    set({
      lyricsData: enriched,
      isLoading: false,
      status: enriched ? deriveSettledStatus(enriched) : 'idle',
      error: null,
    });
  },
}));

// If user turns on translation or switches to a translation scriptMode mid-track, enrich live
useSettingsStore.subscribe((state, prevState) => {
  const prevMode = prevState?.settings?.['lyrics.scriptMode'];
  const nextMode = state?.settings?.['lyrics.scriptMode'];
  const prevEnabled = Boolean(prevState?.settings?.['lyrics.translationEnabled']);
  const nextEnabled = Boolean(state?.settings?.['lyrics.translationEnabled']);

  const wantsTranslation =
    nextEnabled || nextMode === 'romanized_translation' || nextMode === 'original_translation';
  const previouslyWanted =
    prevEnabled || prevMode === 'romanized_translation' || prevMode === 'original_translation';

  if (wantsTranslation && !previouslyWanted) {
    const { currentTrackId, lyricsData } = useLyricsStore.getState();
    if (currentTrackId && lyricsData) {
      scheduleAsyncTranslation(
        currentTrackId,
        lyricsData,
        useLyricsStore.getState,
        useLyricsStore.setState
      );
    }
  }
});
