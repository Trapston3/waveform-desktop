// src/lyricVisualizer/state/lyricVisualizerStore.ts
// Zustand store for LyricVisualizer configuration, per-song timing offsets,
// multi-monitor overlay state, ambient mode, OKLCH palette, and Electron IPC sync.

import { create } from 'zustand';
import {
  type AudioFrameMetrics,
  BUNDLED_FONTS,
  type BundledFontId,
  clampOffsetMs,
  DEFAULT_LYRIC_VISUALIZER_CONFIG,
  DEMO_FALLBACK_PALETTE,
  type LyricPalette,
  type Lyrics,
  type LyricVisualizerConfig,
  STARLIGHT_HARBOR_LYRICS,
  STARLIGHT_HARBOR_TRACK,
  type TrackInfo,
  VISUAL_STYLE_DEFINITIONS,
  type VisualStyleId,
} from '../core';
import { getSharedWaveFormPlaybackBridge } from '../bridge/waveFormPlaybackBridge';

const STORAGE_KEY = 'waveform.lyricVisualizer.v1';

export const MIN_FONT_SIZE_SCALE = 0.7;
export const MAX_FONT_SIZE_SCALE = 1.8;
export const MIN_OVERLAY_OPACITY = 0.2;
export const MAX_OVERLAY_OPACITY = 1.0;
export const OFFSET_STEP_MS = 50;
export const IDLE_AMBIENT_OPTIONS = [0, 30, 60, 120, 300] as const;

export interface MonitorDescriptor {
  readonly id: string;
  readonly label: string;
  readonly bounds?: { x: number; y: number; width: number; height: number };
  readonly workArea?: { x: number; y: number; width: number; height: number };
  readonly scaleFactor?: number;
  readonly isPrimary?: boolean;
}

export interface LyricVisualizerBroadcastPayload {
  readonly config: LyricVisualizerConfig;
  readonly track: TrackInfo | null;
  readonly lyrics: Lyrics | null;
  readonly palette: LyricPalette;
  readonly positionSeconds: number;
  readonly isPlaying: boolean;
  readonly songOffsetMs: number;
  readonly audio: AudioFrameMetrics;
  readonly isScreenLocked: boolean;
  readonly timestampMs: number;
}

export interface LyricVisualizerState {
  config: LyricVisualizerConfig;
  nowPlayingLyricsMode: 'classic' | 'visualizer';
  currentSongKey: string | null;
  currentSongOffsetMs: number;
  perSongOffsetsMs: Record<string, number>;
  availableMonitors: MonitorDescriptor[];
  isAmbientOpen: boolean;
  isScreenLocked: boolean;
  isGameSuppressed: boolean;
  activePalette: LyricPalette;
  activeLyrics: Lyrics | null;
  activeTrack: TrackInfo | null;
  lastBroadcastPayload: LyricVisualizerBroadcastPayload | null;

  // Actions
  setStyleId: (styleId: VisualStyleId) => void;
  cycleStyle: (direction?: 1 | -1) => void;
  setFontId: (fontId: BundledFontId) => void;
  setFontSizeScale: (scale: number) => void;
  setAlbumArtColorMatch: (enabled: boolean) => void;
  setAudioReactive: (enabled: boolean) => void;
  setReduceMotion: (enabled: boolean) => void;

  setCurrentSongKey: (songKey: string | null) => Promise<void>;
  setSongOffsetMs: (offsetMs: number, songKey?: string | null) => void;
  nudgeSongOffsetMs: (deltaMs?: number, songKey?: string | null) => void;
  resetSongOffsetMs: (songKey?: string | null) => void;

  setOverlayEnabled: (enabled: boolean) => void;
  toggleOverlayMonitor: (monitorId: string) => void;
  setOverlayMonitorIds: (monitorIds: readonly string[]) => void;
  setOverlayOpacity: (opacity: number) => void;
  setOverlayLocked: (locked: boolean) => void;
  refreshMonitors: () => Promise<MonitorDescriptor[]>;

  openAmbientMode: () => Promise<void>;
  closeAmbientMode: () => Promise<void>;
  setIdleAmbientSeconds: (seconds: number) => void;
  setKeepAwakeInAmbient: (enabled: boolean) => void;
  setGameGuardEnabled: (enabled: boolean) => void;

  setSandboxEnabled: (enabled: boolean) => void;
  setScreenLocked: (locked: boolean) => void;
  setGameSuppressed: (suppressed: boolean) => void;
  setActivePalette: (palette: LyricPalette) => void;
  setActiveLyrics: (lyrics: Lyrics | null) => void;
  setActiveTrack: (track: TrackInfo | null) => void;
  setNowPlayingLyricsMode: (mode: 'classic' | 'visualizer') => void;

  applyBroadcastPayload: (payload: LyricVisualizerBroadcastPayload) => void;
  broadcastSnapshot: (
    partial?: Partial<Omit<LyricVisualizerBroadcastPayload, 'config'>>,
    force?: boolean
  ) => void;
}

function getElectronApi(): any {
  if (typeof window !== 'undefined' && (window as any).electronAPI) {
    return (window as any).electronAPI;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as any).window?.electronAPI) {
    return (globalThis as any).window.electronAPI;
  }
  return undefined;
}

export function clampFontSizeScale(scale: number): number {
  if (!Number.isFinite(scale)) return DEFAULT_LYRIC_VISUALIZER_CONFIG.fontSizeScale;
  return Number(Math.max(MIN_FONT_SIZE_SCALE, Math.min(MAX_FONT_SIZE_SCALE, scale)).toFixed(2));
}

export function clampOverlayOpacity(opacity: number): number {
  if (!Number.isFinite(opacity)) return DEFAULT_LYRIC_VISUALIZER_CONFIG.overlayOpacity;
  return Number(Math.max(MIN_OVERLAY_OPACITY, Math.min(MAX_OVERLAY_OPACITY, opacity)).toFixed(2));
}

function isValidStyleId(id: unknown): id is VisualStyleId {
  return typeof id === 'string' && VISUAL_STYLE_DEFINITIONS.some((s) => s.id === id);
}

function isValidFontId(id: unknown): id is BundledFontId {
  return typeof id === 'string' && BUNDLED_FONTS.some((f) => f.id === id);
}

interface PersistedStorageData {
  config?: Partial<LyricVisualizerConfig>;
  perSongOffsetsMs?: Record<string, number>;
  nowPlayingLyricsMode?: 'classic' | 'visualizer';
}

function loadPersistedState(): {
  config: LyricVisualizerConfig;
  perSongOffsetsMs: Record<string, number>;
  nowPlayingLyricsMode: 'classic' | 'visualizer';
} {
  let raw: PersistedStorageData | null = null;
  try {
    const storage =
      typeof localStorage !== 'undefined'
        ? localStorage
        : (globalThis as any).window?.localStorage;
    if (storage && typeof storage.getItem === 'function') {
      const text = storage.getItem(STORAGE_KEY);
      if (text) {
        raw = JSON.parse(text) as PersistedStorageData;
      }
    }
  } catch {
    raw = null;
  }

  const c = raw?.config ?? {};
  const config: LyricVisualizerConfig = {
    styleId: isValidStyleId(c.styleId) ? c.styleId : DEFAULT_LYRIC_VISUALIZER_CONFIG.styleId,
    fontId: isValidFontId(c.fontId) ? c.fontId : DEFAULT_LYRIC_VISUALIZER_CONFIG.fontId,
    fontSizeScale:
      typeof c.fontSizeScale === 'number'
        ? clampFontSizeScale(c.fontSizeScale)
        : DEFAULT_LYRIC_VISUALIZER_CONFIG.fontSizeScale,
    albumArtColorMatch:
      typeof c.albumArtColorMatch === 'boolean'
        ? c.albumArtColorMatch
        : DEFAULT_LYRIC_VISUALIZER_CONFIG.albumArtColorMatch,
    audioReactive:
      typeof c.audioReactive === 'boolean'
        ? c.audioReactive
        : DEFAULT_LYRIC_VISUALIZER_CONFIG.audioReactive,
    reduceMotion:
      typeof c.reduceMotion === 'boolean'
        ? c.reduceMotion
        : DEFAULT_LYRIC_VISUALIZER_CONFIG.reduceMotion,
    overlayEnabled:
      typeof c.overlayEnabled === 'boolean'
        ? c.overlayEnabled
        : DEFAULT_LYRIC_VISUALIZER_CONFIG.overlayEnabled,
    overlayMonitorIds: Array.isArray(c.overlayMonitorIds)
      ? c.overlayMonitorIds.filter((m): m is string => typeof m === 'string')
      : DEFAULT_LYRIC_VISUALIZER_CONFIG.overlayMonitorIds,
    overlayOpacity:
      typeof c.overlayOpacity === 'number'
        ? clampOverlayOpacity(c.overlayOpacity)
        : DEFAULT_LYRIC_VISUALIZER_CONFIG.overlayOpacity,
    overlayLocked:
      typeof c.overlayLocked === 'boolean'
        ? c.overlayLocked
        : DEFAULT_LYRIC_VISUALIZER_CONFIG.overlayLocked,
    idleAmbientSeconds:
      typeof c.idleAmbientSeconds === 'number' &&
      (IDLE_AMBIENT_OPTIONS as readonly number[]).includes(c.idleAmbientSeconds)
        ? c.idleAmbientSeconds
        : DEFAULT_LYRIC_VISUALIZER_CONFIG.idleAmbientSeconds,
    keepAwakeInAmbient:
      typeof c.keepAwakeInAmbient === 'boolean'
        ? c.keepAwakeInAmbient
        : DEFAULT_LYRIC_VISUALIZER_CONFIG.keepAwakeInAmbient,
    gameGuardEnabled:
      typeof c.gameGuardEnabled === 'boolean'
        ? c.gameGuardEnabled
        : DEFAULT_LYRIC_VISUALIZER_CONFIG.gameGuardEnabled,
    sandboxEnabled:
      typeof c.sandboxEnabled === 'boolean'
        ? c.sandboxEnabled
        : DEFAULT_LYRIC_VISUALIZER_CONFIG.sandboxEnabled,
  };

  const perSongOffsetsMs: Record<string, number> = {};
  if (raw?.perSongOffsetsMs && typeof raw.perSongOffsetsMs === 'object') {
    for (const [k, v] of Object.entries(raw.perSongOffsetsMs)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        perSongOffsetsMs[k] = clampOffsetMs(v);
      }
    }
  }

  const nowPlayingLyricsMode =
    raw?.nowPlayingLyricsMode === 'classic' || raw?.nowPlayingLyricsMode === 'visualizer'
      ? raw.nowPlayingLyricsMode
      : 'visualizer';

  return { config, perSongOffsetsMs, nowPlayingLyricsMode };
}

function savePersistedState(state: {
  config: LyricVisualizerConfig;
  perSongOffsetsMs: Record<string, number>;
  nowPlayingLyricsMode: 'classic' | 'visualizer';
}): void {
  try {
    const storage =
      typeof localStorage !== 'undefined'
        ? localStorage
        : (globalThis as any).window?.localStorage;
    if (storage && typeof storage.setItem === 'function') {
      const payload: PersistedStorageData = {
        config: state.config,
        perSongOffsetsMs: state.perSongOffsetsMs,
        nowPlayingLyricsMode: state.nowPlayingLyricsMode,
      };
      storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    }
  } catch {
    // Ignore storage quota / security errors
  }
}

function syncOverlayConfigToElectron(config: LyricVisualizerConfig): void {
  const api = getElectronApi();
  try {
    api?.lvSetOverlayConfig?.({
      enabled: config.overlayEnabled,
      monitorIds: [...config.overlayMonitorIds],
      opacity: config.overlayOpacity,
      locked: config.overlayLocked,
    });
  } catch {
    // Non-fatal in browser/test mode
  }
}

function syncAmbientSettingsToElectron(config: LyricVisualizerConfig): void {
  const api = getElectronApi();
  try {
    api?.lvSetAmbientSettings?.({
      idleAmbientSeconds: config.idleAmbientSeconds,
      keepAwakeInAmbient: config.keepAwakeInAmbient,
      gameGuardEnabled: config.gameGuardEnabled,
    });
  } catch {
    // Non-fatal in browser/test mode
  }
}

const initialPersisted = loadPersistedState();
let lastBroadcastTimeMs = 0;

export const useLyricVisualizerStore = create<LyricVisualizerState>((set, get) => ({
  config: initialPersisted.config,
  nowPlayingLyricsMode: initialPersisted.nowPlayingLyricsMode,
  currentSongKey: initialPersisted.config.sandboxEnabled ? STARLIGHT_HARBOR_TRACK.id : null,
  currentSongOffsetMs: initialPersisted.config.sandboxEnabled
    ? initialPersisted.perSongOffsetsMs[STARLIGHT_HARBOR_TRACK.id] ?? 0
    : 0,
  perSongOffsetsMs: initialPersisted.perSongOffsetsMs,
  availableMonitors: [{ id: 'primary', label: 'Primary Display', isPrimary: true }],
  isAmbientOpen: false,
  isScreenLocked: false,
  isGameSuppressed: false,
  activePalette: DEMO_FALLBACK_PALETTE,
  activeLyrics: initialPersisted.config.sandboxEnabled ? STARLIGHT_HARBOR_LYRICS : null,
  activeTrack: initialPersisted.config.sandboxEnabled ? STARLIGHT_HARBOR_TRACK : null,
  lastBroadcastPayload: null,

  setStyleId: (styleId: VisualStyleId) => {
    if (!isValidStyleId(styleId)) return;
    set((s) => {
      const nextConfig: LyricVisualizerConfig = { ...s.config, styleId };
      savePersistedState({
        config: nextConfig,
        perSongOffsetsMs: s.perSongOffsetsMs,
        nowPlayingLyricsMode: s.nowPlayingLyricsMode,
      });
      return { config: nextConfig };
    });
    get().broadcastSnapshot(undefined, true);
  },

  cycleStyle: (direction: 1 | -1 = 1) => {
    const currentId = get().config.styleId;
    const idx = VISUAL_STYLE_DEFINITIONS.findIndex((s) => s.id === currentId);
    const len = VISUAL_STYLE_DEFINITIONS.length;
    const nextIdx = idx < 0 ? 0 : (idx + direction + len) % len;
    get().setStyleId(VISUAL_STYLE_DEFINITIONS[nextIdx].id);
  },

  setFontId: (fontId: BundledFontId) => {
    if (!isValidFontId(fontId)) return;
    set((s) => {
      const nextConfig: LyricVisualizerConfig = { ...s.config, fontId };
      savePersistedState({
        config: nextConfig,
        perSongOffsetsMs: s.perSongOffsetsMs,
        nowPlayingLyricsMode: s.nowPlayingLyricsMode,
      });
      return { config: nextConfig };
    });
    get().broadcastSnapshot(undefined, true);
  },

  setFontSizeScale: (scale: number) => {
    const clamped = clampFontSizeScale(scale);
    set((s) => {
      const nextConfig: LyricVisualizerConfig = { ...s.config, fontSizeScale: clamped };
      savePersistedState({
        config: nextConfig,
        perSongOffsetsMs: s.perSongOffsetsMs,
        nowPlayingLyricsMode: s.nowPlayingLyricsMode,
      });
      return { config: nextConfig };
    });
    get().broadcastSnapshot(undefined, true);
  },

  setAlbumArtColorMatch: (enabled: boolean) => {
    const flag = Boolean(enabled);
    set((s) => {
      const nextConfig: LyricVisualizerConfig = { ...s.config, albumArtColorMatch: flag };
      savePersistedState({
        config: nextConfig,
        perSongOffsetsMs: s.perSongOffsetsMs,
        nowPlayingLyricsMode: s.nowPlayingLyricsMode,
      });
      return { config: nextConfig };
    });
    get().broadcastSnapshot(undefined, true);
  },

  setAudioReactive: (enabled: boolean) => {
    const flag = Boolean(enabled);
    set((s) => {
      const nextConfig: LyricVisualizerConfig = { ...s.config, audioReactive: flag };
      savePersistedState({
        config: nextConfig,
        perSongOffsetsMs: s.perSongOffsetsMs,
        nowPlayingLyricsMode: s.nowPlayingLyricsMode,
      });
      return { config: nextConfig };
    });
    get().broadcastSnapshot(undefined, true);
  },

  setReduceMotion: (enabled: boolean) => {
    const flag = Boolean(enabled);
    set((s) => {
      const nextConfig: LyricVisualizerConfig = { ...s.config, reduceMotion: flag };
      savePersistedState({
        config: nextConfig,
        perSongOffsetsMs: s.perSongOffsetsMs,
        nowPlayingLyricsMode: s.nowPlayingLyricsMode,
      });
      return { config: nextConfig };
    });
    get().broadcastSnapshot(undefined, true);
  },

  setCurrentSongKey: async (songKey: string | null) => {
    const key = songKey && songKey.trim().length > 0 ? songKey.trim() : null;
    const localOffset = key ? get().perSongOffsetsMs[key] ?? 0 : 0;
    set({
      currentSongKey: key,
      currentSongOffsetMs: clampOffsetMs(localOffset),
    });

    if (!key) return;
    const api = getElectronApi();
    if (typeof api?.lvGetSongOffset === 'function') {
      try {
        const remoteOffset = await api.lvGetSongOffset(key);
        if (typeof remoteOffset === 'number' && Number.isFinite(remoteOffset)) {
          const clamped = clampOffsetMs(remoteOffset);
          set((s) => {
            const nextOffsets = { ...s.perSongOffsetsMs, [key]: clamped };
            savePersistedState({
              config: s.config,
              perSongOffsetsMs: nextOffsets,
              nowPlayingLyricsMode: s.nowPlayingLyricsMode,
            });
            return {
              perSongOffsetsMs: nextOffsets,
              currentSongOffsetMs: s.currentSongKey === key ? clamped : s.currentSongOffsetMs,
            };
          });
        }
      } catch {
        // Ignore IPC error
      }
    }
  },

  setSongOffsetMs: (offsetMs: number, songKey?: string | null) => {
    const clamped = clampOffsetMs(offsetMs);
    const key = (songKey !== undefined ? songKey : get().currentSongKey) || 'default-track';

    set((s) => {
      const nextOffsets = { ...s.perSongOffsetsMs, [key]: clamped };
      savePersistedState({
        config: s.config,
        perSongOffsetsMs: nextOffsets,
        nowPlayingLyricsMode: s.nowPlayingLyricsMode,
      });
      return {
        currentSongKey: s.currentSongKey ?? key,
        currentSongOffsetMs: clamped,
        perSongOffsetsMs: nextOffsets,
      };
    });

    const api = getElectronApi();
    try {
      api?.lvSetSongOffset?.(key, clamped);
    } catch {
      // Ignore IPC error
    }
    get().broadcastSnapshot({ songOffsetMs: clamped }, true);
  },

  nudgeSongOffsetMs: (deltaMs: number = OFFSET_STEP_MS, songKey?: string | null) => {
    const key = (songKey !== undefined ? songKey : get().currentSongKey) || 'default-track';
    const current = get().perSongOffsetsMs[key] ?? get().currentSongOffsetMs ?? 0;
    get().setSongOffsetMs(current + deltaMs, key);
  },

  resetSongOffsetMs: (songKey?: string | null) => {
    const key = (songKey !== undefined ? songKey : get().currentSongKey) || 'default-track';
    get().setSongOffsetMs(0, key);
  },

  setOverlayEnabled: (enabled: boolean) => {
    const flag = Boolean(enabled);
    set((s) => {
      const monitorIds =
        flag && s.config.overlayMonitorIds.length === 0
          ? [s.availableMonitors[0]?.id || 'primary']
          : s.config.overlayMonitorIds;
      const nextConfig: LyricVisualizerConfig = {
        ...s.config,
        overlayEnabled: flag,
        overlayMonitorIds: monitorIds,
      };
      savePersistedState({
        config: nextConfig,
        perSongOffsetsMs: s.perSongOffsetsMs,
        nowPlayingLyricsMode: s.nowPlayingLyricsMode,
      });
      syncOverlayConfigToElectron(nextConfig);
      return { config: nextConfig };
    });
    get().broadcastSnapshot(undefined, true);
  },

  toggleOverlayMonitor: (monitorId: string) => {
    if (!monitorId) return;
    set((s) => {
      const exists = s.config.overlayMonitorIds.includes(monitorId);
      const nextIds = exists
        ? s.config.overlayMonitorIds.filter((id) => id !== monitorId)
        : [...s.config.overlayMonitorIds, monitorId];
      const nextConfig: LyricVisualizerConfig = {
        ...s.config,
        overlayMonitorIds: nextIds,
      };
      savePersistedState({
        config: nextConfig,
        perSongOffsetsMs: s.perSongOffsetsMs,
        nowPlayingLyricsMode: s.nowPlayingLyricsMode,
      });
      syncOverlayConfigToElectron(nextConfig);
      return { config: nextConfig };
    });
    get().broadcastSnapshot(undefined, true);
  },

  setOverlayMonitorIds: (monitorIds: readonly string[]) => {
    const clean = monitorIds.filter((id) => typeof id === 'string' && id.trim().length > 0);
    set((s) => {
      const nextConfig: LyricVisualizerConfig = {
        ...s.config,
        overlayMonitorIds: clean,
      };
      savePersistedState({
        config: nextConfig,
        perSongOffsetsMs: s.perSongOffsetsMs,
        nowPlayingLyricsMode: s.nowPlayingLyricsMode,
      });
      syncOverlayConfigToElectron(nextConfig);
      return { config: nextConfig };
    });
    get().broadcastSnapshot(undefined, true);
  },

  setOverlayOpacity: (opacity: number) => {
    const clamped = clampOverlayOpacity(opacity);
    set((s) => {
      const nextConfig: LyricVisualizerConfig = {
        ...s.config,
        overlayOpacity: clamped,
      };
      savePersistedState({
        config: nextConfig,
        perSongOffsetsMs: s.perSongOffsetsMs,
        nowPlayingLyricsMode: s.nowPlayingLyricsMode,
      });
      syncOverlayConfigToElectron(nextConfig);
      return { config: nextConfig };
    });
    get().broadcastSnapshot(undefined, true);
  },

  setOverlayLocked: (locked: boolean) => {
    const flag = Boolean(locked);
    set((s) => {
      const nextConfig: LyricVisualizerConfig = {
        ...s.config,
        overlayLocked: flag,
      };
      savePersistedState({
        config: nextConfig,
        perSongOffsetsMs: s.perSongOffsetsMs,
        nowPlayingLyricsMode: s.nowPlayingLyricsMode,
      });
      syncOverlayConfigToElectron(nextConfig);
      return { config: nextConfig };
    });
    get().broadcastSnapshot(undefined, true);
  },

  refreshMonitors: async (): Promise<MonitorDescriptor[]> => {
    const api = getElectronApi();
    if (typeof api?.lvGetMonitors === 'function') {
      try {
        const list = await api.lvGetMonitors();
        if (Array.isArray(list) && list.length > 0) {
          set({ availableMonitors: list });
          return list;
        }
      } catch {
        // Fallback below
      }
    }
    const fallback: MonitorDescriptor[] = [
      { id: 'primary', label: 'Primary Display', isPrimary: true },
    ];
    set({ availableMonitors: fallback });
    return fallback;
  },

  openAmbientMode: async () => {
    const { config } = get();
    set({ isAmbientOpen: true });
    get().broadcastSnapshot(undefined, true);
    const api = getElectronApi();
    try {
      await api?.lvOpenAmbient?.(config.keepAwakeInAmbient);
    } catch {
      // Ignore in browser/test mode
    }
  },

  closeAmbientMode: async () => {
    set({ isAmbientOpen: false });
    const api = getElectronApi();
    try {
      await api?.lvCloseAmbient?.();
    } catch {
      // Ignore in browser/test mode
    }
  },

  setIdleAmbientSeconds: (seconds: number) => {
    const valid = (IDLE_AMBIENT_OPTIONS as readonly number[]).includes(seconds) ? seconds : 0;
    set((s) => {
      const nextConfig: LyricVisualizerConfig = {
        ...s.config,
        idleAmbientSeconds: valid,
      };
      savePersistedState({
        config: nextConfig,
        perSongOffsetsMs: s.perSongOffsetsMs,
        nowPlayingLyricsMode: s.nowPlayingLyricsMode,
      });
      syncAmbientSettingsToElectron(nextConfig);
      return { config: nextConfig };
    });
  },

  setKeepAwakeInAmbient: (enabled: boolean) => {
    const flag = Boolean(enabled);
    set((s) => {
      const nextConfig: LyricVisualizerConfig = {
        ...s.config,
        keepAwakeInAmbient: flag,
      };
      savePersistedState({
        config: nextConfig,
        perSongOffsetsMs: s.perSongOffsetsMs,
        nowPlayingLyricsMode: s.nowPlayingLyricsMode,
      });
      syncAmbientSettingsToElectron(nextConfig);
      return { config: nextConfig };
    });
  },

  setGameGuardEnabled: (enabled: boolean) => {
    const flag = Boolean(enabled);
    set((s) => {
      const nextConfig: LyricVisualizerConfig = {
        ...s.config,
        gameGuardEnabled: flag,
      };
      savePersistedState({
        config: nextConfig,
        perSongOffsetsMs: s.perSongOffsetsMs,
        nowPlayingLyricsMode: s.nowPlayingLyricsMode,
      });
      syncAmbientSettingsToElectron(nextConfig);
      return { config: nextConfig };
    });
  },

  setSandboxEnabled: (enabled: boolean) => {
    const flag = Boolean(enabled);
    const bridge = getSharedWaveFormPlaybackBridge();
    bridge.setSandboxMode(flag);

    set((s) => {
      const nextConfig: LyricVisualizerConfig = {
        ...s.config,
        sandboxEnabled: flag,
      };
      savePersistedState({
        config: nextConfig,
        perSongOffsetsMs: s.perSongOffsetsMs,
        nowPlayingLyricsMode: s.nowPlayingLyricsMode,
      });
      if (flag) {
        const sandboxKey = STARLIGHT_HARBOR_TRACK.id;
        return {
          config: nextConfig,
          currentSongKey: sandboxKey,
          currentSongOffsetMs: s.perSongOffsetsMs[sandboxKey] ?? 0,
          activeTrack: STARLIGHT_HARBOR_TRACK,
          activeLyrics: STARLIGHT_HARBOR_LYRICS,
        };
      }
      return {
        config: nextConfig,
        activeLyrics: bridge.getCurrentLyrics(),
        activeTrack: bridge.currentSnapshot.track,
      };
    });
    get().broadcastSnapshot(undefined, true);
  },

  setScreenLocked: (locked: boolean) => {
    const flag = Boolean(locked);
    if (get().isScreenLocked !== flag) {
      set({ isScreenLocked: flag });
      get().broadcastSnapshot({ isScreenLocked: flag }, true);
    }
  },

  setGameSuppressed: (suppressed: boolean) => {
    set({ isGameSuppressed: Boolean(suppressed) });
  },

  setActivePalette: (palette: LyricPalette) => {
    set({ activePalette: palette });
    get().broadcastSnapshot({ palette }, true);
  },

  setActiveLyrics: (lyrics: Lyrics | null) => {
    set({ activeLyrics: lyrics });
    get().broadcastSnapshot({ lyrics }, true);
  },

  setActiveTrack: (track: TrackInfo | null) => {
    set({ activeTrack: track });
    get().broadcastSnapshot({ track }, true);
  },

  setNowPlayingLyricsMode: (mode: 'classic' | 'visualizer') => {
    if (mode !== 'classic' && mode !== 'visualizer') return;
    set((s) => {
      savePersistedState({
        config: s.config,
        perSongOffsetsMs: s.perSongOffsetsMs,
        nowPlayingLyricsMode: mode,
      });
      return { nowPlayingLyricsMode: mode };
    });
  },

  applyBroadcastPayload: (payload: LyricVisualizerBroadcastPayload) => {
    if (!payload || typeof payload !== 'object') return;
    set((s) => ({
      config: payload.config ? { ...s.config, ...payload.config } : s.config,
      activeTrack: payload.track !== undefined ? payload.track : s.activeTrack,
      activeLyrics: payload.lyrics !== undefined ? payload.lyrics : s.activeLyrics,
      activePalette: payload.palette || s.activePalette,
      currentSongOffsetMs:
        typeof payload.songOffsetMs === 'number'
          ? clampOffsetMs(payload.songOffsetMs)
          : s.currentSongOffsetMs,
      isScreenLocked:
        typeof payload.isScreenLocked === 'boolean' ? payload.isScreenLocked : s.isScreenLocked,
      lastBroadcastPayload: payload,
    }));
  },

  broadcastSnapshot: (partial, force = false) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!force && now - lastBroadcastTimeMs < 50) {
      return;
    }
    lastBroadcastTimeMs = now;

    const state = get();
    const bridge = getSharedWaveFormPlaybackBridge();
    const snap = bridge.currentSnapshot;
    const audio = state.config.audioReactive
      ? bridge.sampleAudioMetrics()
      : { rmsLevel: 0, bassEnergy: 0, midEnergy: 0, trebleEnergy: 0, beatDetected: false };

    const payload: LyricVisualizerBroadcastPayload = {
      config: state.config,
      track: partial?.track !== undefined ? partial.track : state.activeTrack ?? snap.track,
      lyrics:
        partial?.lyrics !== undefined
          ? partial.lyrics
          : state.activeLyrics ?? bridge.getCurrentLyrics(),
      palette:
        partial?.palette !== undefined
          ? partial.palette
          : state.config.albumArtColorMatch
          ? state.activePalette
          : DEMO_FALLBACK_PALETTE,
      positionSeconds:
        partial?.positionSeconds !== undefined ? partial.positionSeconds : snap.positionSeconds,
      isPlaying: partial?.isPlaying !== undefined ? partial.isPlaying : snap.isPlaying,
      songOffsetMs:
        partial?.songOffsetMs !== undefined ? partial.songOffsetMs : state.currentSongOffsetMs,
      audio: partial?.audio !== undefined ? partial.audio : audio,
      isScreenLocked:
        partial?.isScreenLocked !== undefined ? partial.isScreenLocked : state.isScreenLocked,
      timestampMs: partial?.timestampMs !== undefined ? partial.timestampMs : now,
    };

    set({ lastBroadcastPayload: payload });

    const api = getElectronApi();
    try {
      api?.lvBroadcastState?.(payload);
    } catch {
      // Non-fatal in browser/test mode
    }
  },
}));
