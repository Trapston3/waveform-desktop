// src/lyricVisualizer/state/lyricVisualizerStore.ts
// Zustand store for LyricVisualizer configuration, per-song timing offsets,
// multi-monitor overlay state, ambient mode, OKLCH palette, and Electron IPC sync.

import { create } from 'zustand';
import {
  type AudioFrameMetrics,
  BUNDLED_FONTS,
  type BundledFontId,
  clampOffsetMs,
  clampAutoSyncOffsetMs,
  DEFAULT_LYRIC_VISUALIZER_CONFIG,
  DEMO_FALLBACK_PALETTE,
  type VocalSilenceInterval,
  getStyleDefinition,
  type LyricPalette,
  type Lyrics,
  type LyricsScriptMode,
  type LyricTextAlign,
  type LyricVisualizerConfig,
  normalizeNowPlayingLayout,
  type NowPlayingLayoutMode,
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
export const MIN_BACKGROUND_OPACITY = 0.2;
export const MAX_BACKGROUND_OPACITY = 1.0;
export const MIN_VIGNETTE_STRENGTH = 0.0;
export const MAX_VIGNETTE_STRENGTH = 1.0;
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

export type MotionIntensity = 'subtle' | 'normal' | 'vivid';

export interface LyricVisualizerBroadcastPayload {
  readonly revisionId?: number;
  readonly trackId?: string | null;
  readonly config: LyricVisualizerConfig;
  readonly track: TrackInfo | null;
  readonly lyrics: Lyrics | null;
  readonly palette: LyricPalette;
  readonly positionSeconds: number;
  readonly isPlaying: boolean;
  readonly songOffsetMs: number;
  readonly autoSyncOffsetMs?: number;
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
  currentAutoSyncOffsetMs: number;
  perSongAutoSyncOffsetsMs: Record<string, number>;
  vocalSilenceRanges: readonly VocalSilenceInterval[];
  availableMonitors: MonitorDescriptor[];
  isAmbientOpen: boolean;
  isScreenLocked: boolean;
  isGameSuppressed: boolean;
  activePalette: LyricPalette;
  activeLyrics: Lyrics | null;
  activeTrack: TrackInfo | null;
  lastAppliedRevisionId: number;
  lastBroadcastPayload: LyricVisualizerBroadcastPayload | null;

  // Actions
  setStyleId: (styleId: VisualStyleId) => void;
  setStyleVariation: (styleIdOrVariationId: VisualStyleId | string, variationId?: string) => void;
  cycleStyle: (direction?: 1 | -1) => void;
  setFontId: (fontId: BundledFontId) => void;
  setFontSizeScale: (scale: number) => void;
  setAlbumArtColorMatch: (enabled: boolean) => void;
  setAudioReactive: (enabled: boolean) => void;
  setReduceMotion: (enabled: boolean) => void;
  setMotionIntensity: (intensity: MotionIntensity) => void;
  setBackgroundOpacity: (opacity: number) => void;
  setVignetteStrength: (strength: number) => void;
  setTextAlign: (align: LyricTextAlign) => void;
  setNowPlayingLayout: (layout: NowPlayingLayoutMode) => void;
  setHideAlbumCover: (hide: boolean) => void;
  setScriptMode: (mode: LyricsScriptMode) => void;

  setCurrentSongKey: (songKey: string | null) => Promise<void>;
  setSongOffsetMs: (offsetMs: number, songKey?: string | null) => void;
  nudgeSongOffsetMs: (deltaMs?: number, songKey?: string | null) => void;
  resetSongOffsetMs: (songKey?: string | null) => void;
  setAutoSyncOffsetMs: (offsetMs: number, songKey?: string | null) => void;
  resetAutoSyncOffsetMs: (songKey?: string | null) => void;
  setVocalSilenceRanges: (ranges: readonly VocalSilenceInterval[]) => void;

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

export function clampBackgroundOpacity(opacity: number): number {
  if (!Number.isFinite(opacity)) return DEFAULT_LYRIC_VISUALIZER_CONFIG.backgroundOpacity;
  return Number(Math.max(MIN_BACKGROUND_OPACITY, Math.min(MAX_BACKGROUND_OPACITY, opacity)).toFixed(2));
}

export function clampVignetteStrength(strength: number): number {
  if (!Number.isFinite(strength)) return DEFAULT_LYRIC_VISUALIZER_CONFIG.vignetteStrength;
  return Number(Math.max(MIN_VIGNETTE_STRENGTH, Math.min(MAX_VIGNETTE_STRENGTH, strength)).toFixed(2));
}

function isValidStyleId(id: unknown): id is VisualStyleId {
  return typeof id === 'string' && VISUAL_STYLE_DEFINITIONS.some((s) => s.id === id);
}

function isValidFontId(id: unknown): id is BundledFontId {
  return typeof id === 'string' && BUNDLED_FONTS.some((f) => f.id === id);
}

function isValidMotionIntensity(val: unknown): val is MotionIntensity {
  return val === 'subtle' || val === 'normal' || val === 'vivid';
}

function isValidTextAlign(val: unknown): val is LyricTextAlign {
  return val === 'center' || val === 'left';
}

function isValidNowPlayingLayout(val: unknown): val is NowPlayingLayoutMode | 'centered' {
  return (
    val === 'split' ||
    val === 'lyrics-focus' ||
    val === 'artwork-focus' ||
    val === 'ambient' ||
    val === 'centered'
  );
}

function isValidScriptMode(val: unknown): val is LyricsScriptMode {
  return (
    val === 'auto' ||
    val === 'original' ||
    val === 'romanized' ||
    val === 'romanized_translation' ||
    val === 'original_translation'
  );
}

function sanitizeVariationMap(
  raw: unknown
): Partial<Record<VisualStyleId, string>> {
  const result: Partial<Record<VisualStyleId, string>> = {};
  if (!raw || typeof raw !== 'object') return result;
  for (const def of VISUAL_STYLE_DEFINITIONS) {
    const val = (raw as Record<string, unknown>)[def.id];
    if (typeof val === 'string' && def.variations.some((v) => v.id === val)) {
      result[def.id] = val;
    }
  }
  return result;
}

export function migrateLegacyStyleSelection(
  rawStyleId: unknown,
  existingVariations: Partial<Record<VisualStyleId, string>>
): {
  styleId: VisualStyleId;
  variationByStyle: Partial<Record<VisualStyleId, string>>;
} {
  const variationByStyle: Partial<Record<VisualStyleId, string>> = { ...existingVariations };
  if (rawStyleId === 'NeonKinetic') {
    return { styleId: 'AppleMusicFlow', variationByStyle };
  }
  if (rawStyleId === 'HoloVaporwave') {
    variationByStyle.LiquidMetal = 'holo-vaporwave';
    return { styleId: 'LiquidMetal', variationByStyle };
  }
  if (rawStyleId === 'SpectrumRibbon') {
    variationByStyle.GenerativeParticleInk = 'spectrum-ribbon';
    return { styleId: 'GenerativeParticleInk', variationByStyle };
  }
  if (isValidStyleId(rawStyleId)) {
    return { styleId: rawStyleId, variationByStyle };
  }
  return { styleId: DEFAULT_LYRIC_VISUALIZER_CONFIG.styleId, variationByStyle };
}

interface PersistedStorageData {
  config?: Partial<LyricVisualizerConfig>;
  perSongOffsetsMs?: Record<string, number>;
  perSongAutoSyncOffsetsMs?: Record<string, number>;
  nowPlayingLyricsMode?: 'classic' | 'visualizer';
}

function loadPersistedState(): {
  config: LyricVisualizerConfig;
  perSongOffsetsMs: Record<string, number>;
  perSongAutoSyncOffsetsMs: Record<string, number>;
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
  const initialVariations = sanitizeVariationMap((c as any).variationByStyle);
  const migrated = migrateLegacyStyleSelection(c.styleId, initialVariations);

  const config: LyricVisualizerConfig = {
    styleId: migrated.styleId,
    variationByStyle: migrated.variationByStyle,
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
    motionIntensity: isValidMotionIntensity((c as any).motionIntensity)
      ? (c as any).motionIntensity
      : ((DEFAULT_LYRIC_VISUALIZER_CONFIG as any).motionIntensity ?? 'normal'),
    backgroundOpacity:
      typeof (c as any).backgroundOpacity === 'number'
        ? clampBackgroundOpacity((c as any).backgroundOpacity)
        : DEFAULT_LYRIC_VISUALIZER_CONFIG.backgroundOpacity,
    vignetteStrength:
      typeof (c as any).vignetteStrength === 'number'
        ? clampVignetteStrength((c as any).vignetteStrength)
        : DEFAULT_LYRIC_VISUALIZER_CONFIG.vignetteStrength,
    textAlign: isValidTextAlign((c as any).textAlign)
      ? (c as any).textAlign
      : DEFAULT_LYRIC_VISUALIZER_CONFIG.textAlign,
    nowPlayingLayout: isValidNowPlayingLayout((c as any).nowPlayingLayout)
      ? normalizeNowPlayingLayout((c as any).nowPlayingLayout)
      : DEFAULT_LYRIC_VISUALIZER_CONFIG.nowPlayingLayout,
    hideAlbumCover:
      typeof (c as any).hideAlbumCover === 'boolean'
        ? (c as any).hideAlbumCover
        : DEFAULT_LYRIC_VISUALIZER_CONFIG.hideAlbumCover,
    scriptMode: isValidScriptMode((c as any).scriptMode)
      ? (c as any).scriptMode
      : DEFAULT_LYRIC_VISUALIZER_CONFIG.scriptMode,
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

  const perSongAutoSyncOffsetsMs: Record<string, number> = {};
  if (raw?.perSongAutoSyncOffsetsMs && typeof raw.perSongAutoSyncOffsetsMs === 'object') {
    for (const [k, v] of Object.entries(raw.perSongAutoSyncOffsetsMs)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        perSongAutoSyncOffsetsMs[k] = clampAutoSyncOffsetMs(v);
      }
    }
  }

  const nowPlayingLyricsMode =
    raw?.nowPlayingLyricsMode === 'classic' || raw?.nowPlayingLyricsMode === 'visualizer'
      ? raw.nowPlayingLyricsMode
      : 'classic';

  return { config, perSongOffsetsMs, perSongAutoSyncOffsetsMs, nowPlayingLyricsMode };
}

function savePersistedState(state: {
  config: LyricVisualizerConfig;
  perSongOffsetsMs: Record<string, number>;
  perSongAutoSyncOffsetsMs?: Record<string, number>;
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
        ...(state.perSongAutoSyncOffsetsMs ? { perSongAutoSyncOffsetsMs: state.perSongAutoSyncOffsetsMs } : {}),
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
let broadcastRevisionCounter = 0;

let lastNonAmbientLayout: NowPlayingLayoutMode =
  initialPersisted.config.nowPlayingLayout !== 'ambient'
    ? initialPersisted.config.nowPlayingLayout
    : 'split';

export const useLyricVisualizerStore = create<LyricVisualizerState>((set, get) => ({
  config: initialPersisted.config,
  nowPlayingLyricsMode: initialPersisted.nowPlayingLyricsMode,
  currentSongKey: initialPersisted.config.sandboxEnabled ? STARLIGHT_HARBOR_TRACK.id : null,
  currentSongOffsetMs: initialPersisted.config.sandboxEnabled
    ? initialPersisted.perSongOffsetsMs[STARLIGHT_HARBOR_TRACK.id] ?? 0
    : 0,
  perSongOffsetsMs: initialPersisted.perSongOffsetsMs,
  currentAutoSyncOffsetMs: initialPersisted.config.sandboxEnabled
    ? initialPersisted.perSongAutoSyncOffsetsMs[STARLIGHT_HARBOR_TRACK.id] ?? 0
    : 0,
  perSongAutoSyncOffsetsMs: initialPersisted.perSongAutoSyncOffsetsMs,
  vocalSilenceRanges: [],
  availableMonitors: [{ id: 'primary', label: 'Primary Display', isPrimary: true }],
  isAmbientOpen: false,
  isScreenLocked: false,
  isGameSuppressed: false,
  activePalette: DEMO_FALLBACK_PALETTE,
  activeLyrics: initialPersisted.config.sandboxEnabled ? STARLIGHT_HARBOR_LYRICS : null,
  activeTrack: initialPersisted.config.sandboxEnabled ? STARLIGHT_HARBOR_TRACK : null,
  lastAppliedRevisionId: 0,
  lastBroadcastPayload: null,

  setStyleId: (styleId: VisualStyleId) => {
    const rawId = styleId as unknown as string;
    const isLegacy =
      rawId === 'NeonKinetic' || rawId === 'HoloVaporwave' || rawId === 'SpectrumRibbon';
    if (!isValidStyleId(styleId) && !isLegacy) return;
    set((s) => {
      const migrated = migrateLegacyStyleSelection(rawId, s.config.variationByStyle ?? {});
      const nextConfig: LyricVisualizerConfig = {
        ...s.config,
        styleId: migrated.styleId,
        variationByStyle: migrated.variationByStyle,
      };
      savePersistedState({
        config: nextConfig,
        perSongOffsetsMs: s.perSongOffsetsMs,
        nowPlayingLyricsMode: s.nowPlayingLyricsMode,
      });
      return { config: nextConfig };
    });
    get().broadcastSnapshot(undefined, true);
  },

  setStyleVariation: (styleIdOrVariationId: VisualStyleId | string, variationId?: string) => {
    set((s) => {
      let targetStyleId: VisualStyleId = s.config.styleId;
      let rawVarId = '';
      if (variationId !== undefined) {
        const migrated = migrateLegacyStyleSelection(styleIdOrVariationId, s.config.variationByStyle ?? {});
        targetStyleId = migrated.styleId;
        rawVarId = variationId;
      } else {
        rawVarId = String(styleIdOrVariationId);
      }

      const def = getStyleDefinition(targetStyleId);
      const validVar = def.variations.some((v) => v.id === rawVarId)
        ? rawVarId
        : def.defaultVariationId;

      const nextVariationByStyle: Partial<Record<VisualStyleId, string>> = {
        ...(s.config.variationByStyle ?? {}),
        [def.id]: validVar,
      };
      const nextConfig: LyricVisualizerConfig = {
        ...s.config,
        variationByStyle: nextVariationByStyle,
      };
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

  setMotionIntensity: (intensity: MotionIntensity) => {
    if (!isValidMotionIntensity(intensity)) return;
    set((s) => {
      const nextConfig = { ...s.config, motionIntensity: intensity } as LyricVisualizerConfig;
      savePersistedState({
        config: nextConfig,
        perSongOffsetsMs: s.perSongOffsetsMs,
        nowPlayingLyricsMode: s.nowPlayingLyricsMode,
      });
      return { config: nextConfig };
    });
    get().broadcastSnapshot(undefined, true);
  },

  setBackgroundOpacity: (opacity: number) => {
    const clamped = clampBackgroundOpacity(opacity);
    set((s) => {
      const nextConfig: LyricVisualizerConfig = { ...s.config, backgroundOpacity: clamped };
      savePersistedState({
        config: nextConfig,
        perSongOffsetsMs: s.perSongOffsetsMs,
        nowPlayingLyricsMode: s.nowPlayingLyricsMode,
      });
      return { config: nextConfig };
    });
    get().broadcastSnapshot(undefined, true);
  },

  setVignetteStrength: (strength: number) => {
    const clamped = clampVignetteStrength(strength);
    set((s) => {
      const nextConfig: LyricVisualizerConfig = { ...s.config, vignetteStrength: clamped };
      savePersistedState({
        config: nextConfig,
        perSongOffsetsMs: s.perSongOffsetsMs,
        nowPlayingLyricsMode: s.nowPlayingLyricsMode,
      });
      return { config: nextConfig };
    });
    get().broadcastSnapshot(undefined, true);
  },

  setTextAlign: (align: LyricTextAlign) => {
    if (!isValidTextAlign(align)) return;
    set((s) => {
      const nextConfig: LyricVisualizerConfig = { ...s.config, textAlign: align };
      savePersistedState({
        config: nextConfig,
        perSongOffsetsMs: s.perSongOffsetsMs,
        nowPlayingLyricsMode: s.nowPlayingLyricsMode,
      });
      return { config: nextConfig };
    });
    get().broadcastSnapshot(undefined, true);
  },

  setNowPlayingLayout: (layout: NowPlayingLayoutMode | 'centered') => {
    if (!isValidNowPlayingLayout(layout)) return;
    const normalized = normalizeNowPlayingLayout(layout);
    if (normalized !== 'ambient') {
      lastNonAmbientLayout = normalized;
    } else if (get().config.nowPlayingLayout !== 'ambient') {
      lastNonAmbientLayout = get().config.nowPlayingLayout;
    }
    set((s) => {
      const nextHideCover = normalized === 'lyrics-focus' || normalized === 'ambient';
      const nextConfig: LyricVisualizerConfig = {
        ...s.config,
        nowPlayingLayout: normalized,
        hideAlbumCover: nextHideCover,
      };
      savePersistedState({
        config: nextConfig,
        perSongOffsetsMs: s.perSongOffsetsMs,
        nowPlayingLyricsMode: s.nowPlayingLyricsMode,
      });
      return { config: nextConfig };
    });
    if (normalized === 'ambient' && !get().isAmbientOpen) {
      void get().openAmbientMode();
    } else if (normalized !== 'ambient' && get().isAmbientOpen) {
      void get().closeAmbientMode();
    }
    get().broadcastSnapshot(undefined, true);
  },

  setHideAlbumCover: (hide: boolean) => {
    const flag = Boolean(hide);
    set((s) => {
      const current = s.config.nowPlayingLayout;
      const nextLayout: NowPlayingLayoutMode = flag
        ? current === 'split' || current === 'artwork-focus'
          ? 'lyrics-focus'
          : current
        : current === 'lyrics-focus'
        ? 'split'
        : current;
      const nextConfig: LyricVisualizerConfig = {
        ...s.config,
        hideAlbumCover: flag,
        nowPlayingLayout: nextLayout,
      };
      savePersistedState({
        config: nextConfig,
        perSongOffsetsMs: s.perSongOffsetsMs,
        nowPlayingLyricsMode: s.nowPlayingLyricsMode,
      });
      return { config: nextConfig };
    });
    get().broadcastSnapshot(undefined, true);
  },

  setScriptMode: (mode: LyricsScriptMode) => {
    if (!isValidScriptMode(mode)) return;
    set((s) => {
      const nextConfig: LyricVisualizerConfig = { ...s.config, scriptMode: mode };
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
    const localAutoOffset = key ? get().perSongAutoSyncOffsetsMs[key] ?? 0 : 0;
    set({
      currentSongKey: key,
      currentSongOffsetMs: clampOffsetMs(localOffset),
      currentAutoSyncOffsetMs: clampAutoSyncOffsetMs(localAutoOffset),
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

  setAutoSyncOffsetMs: (offsetMs: number, songKey?: string | null) => {
    const clamped = clampAutoSyncOffsetMs(offsetMs);
    const key = (songKey !== undefined ? songKey : get().currentSongKey) || 'default-track';
    set((s) => {
      const nextAuto = { ...s.perSongAutoSyncOffsetsMs, [key]: clamped };
      savePersistedState({
        config: s.config,
        perSongOffsetsMs: s.perSongOffsetsMs,
        perSongAutoSyncOffsetsMs: nextAuto,
        nowPlayingLyricsMode: s.nowPlayingLyricsMode,
      });
      return {
        currentSongKey: s.currentSongKey ?? key,
        currentAutoSyncOffsetMs: clamped,
        perSongAutoSyncOffsetsMs: nextAuto,
      };
    });
    get().broadcastSnapshot({ autoSyncOffsetMs: clamped }, true);
  },

  resetAutoSyncOffsetMs: (songKey?: string | null) => {
    const key = (songKey !== undefined ? songKey : get().currentSongKey) || 'default-track';
    get().setAutoSyncOffsetMs(0, key);
  },

  setVocalSilenceRanges: (ranges: readonly VocalSilenceInterval[]) => {
    set({ vocalSilenceRanges: Array.isArray(ranges) ? ranges : [] });
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
    if (config.nowPlayingLayout !== 'ambient') {
      lastNonAmbientLayout = config.nowPlayingLayout;
    }
    set({ isAmbientOpen: true });
    get().broadcastSnapshot(undefined, true);
    const api = getElectronApi();
    try {
      if (typeof api?.setFullscreen === 'function') {
        await api.setFullscreen(true);
        if (typeof api?.lvSetKeepAwake === 'function') {
          await api.lvSetKeepAwake(Boolean(config.keepAwakeInAmbient));
        }
      } else if (typeof api?.lvOpenAmbient === 'function') {
        await api.lvOpenAmbient(config.keepAwakeInAmbient);
      } else if (typeof document !== 'undefined' && typeof document.documentElement?.requestFullscreen === 'function') {
        await document.documentElement.requestFullscreen().catch(() => {});
      }
    } catch {
      // Ignore in browser/test mode
    }
  },

  closeAmbientMode: async () => {
    const restoreLayout = lastNonAmbientLayout !== 'ambient' ? lastNonAmbientLayout : 'split';
    set((s) => {
      const nextConfig =
        s.config.nowPlayingLayout === 'ambient'
          ? { ...s.config, nowPlayingLayout: restoreLayout, hideAlbumCover: restoreLayout === 'lyrics-focus' }
          : s.config;
      if (nextConfig !== s.config) {
        savePersistedState({
          config: nextConfig,
          perSongOffsetsMs: s.perSongOffsetsMs,
          nowPlayingLyricsMode: s.nowPlayingLyricsMode,
        });
      }
      return { isAmbientOpen: false, config: nextConfig };
    });
    const api = getElectronApi();
    try {
      if (typeof api?.setFullscreen === 'function') {
        await api.setFullscreen(false);
        if (typeof api?.lvSetKeepAwake === 'function') {
          await api.lvSetKeepAwake(false);
        }
      } else if (typeof api?.lvCloseAmbient === 'function') {
        await api.lvCloseAmbient();
      } else if (typeof document !== 'undefined' && document.fullscreenElement) {
        await document.exitFullscreen?.().catch(() => {});
      }
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
    const prevTrackId = get().activeTrack?.id ?? null;
    const nextTrackId = track?.id ?? null;
    const trackChanged = nextTrackId !== prevTrackId;
    if (trackChanged) {
      set((s) => ({
        activeTrack: track,
        activeLyrics:
          s.config.sandboxEnabled && nextTrackId === STARLIGHT_HARBOR_TRACK.id
            ? STARLIGHT_HARBOR_LYRICS
            : null,
      }));
      get().broadcastSnapshot(
        {
          track,
          trackId: nextTrackId,
          lyrics:
            get().config.sandboxEnabled && nextTrackId === STARLIGHT_HARBOR_TRACK.id
              ? STARLIGHT_HARBOR_LYRICS
              : null,
        },
        true
      );
    } else {
      set({ activeTrack: track });
      get().broadcastSnapshot({ track, trackId: nextTrackId }, true);
    }
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
    set((s) => {
      // Reject stale out-of-order broadcast revisions
      if (
        typeof payload.revisionId === 'number' &&
        s.lastAppliedRevisionId > 0 &&
        payload.revisionId < s.lastAppliedRevisionId
      ) {
        return s;
      }

      const nextRevisionId =
        typeof payload.revisionId === 'number'
          ? Math.max(s.lastAppliedRevisionId, payload.revisionId)
          : s.lastAppliedRevisionId;

      const prevTrackId = s.activeTrack?.id ?? null;
      const incomingTrackId =
        payload.trackId !== undefined
          ? payload.trackId
          : payload.track !== undefined
          ? payload.track?.id ?? null
          : prevTrackId;
      const trackChanged = incomingTrackId !== prevTrackId;

      // Immediately clear previous song's lyrics when trackId changes
      const nextLyrics = trackChanged
        ? payload.lyrics !== undefined
          ? payload.lyrics
          : null
        : payload.lyrics !== undefined
        ? payload.lyrics
        : s.activeLyrics;

      let nextConfig = s.config;
      if (payload.config) {
        const mergedVars = {
          ...(s.config.variationByStyle ?? {}),
          ...sanitizeVariationMap((payload.config as any).variationByStyle),
        };
        const migrated = migrateLegacyStyleSelection(
          payload.config.styleId ?? s.config.styleId,
          mergedVars
        );
        nextConfig = {
          ...s.config,
          ...payload.config,
          styleId: migrated.styleId,
          variationByStyle: migrated.variationByStyle,
          scriptMode: isValidScriptMode((payload.config as any).scriptMode)
            ? (payload.config as any).scriptMode
            : s.config.scriptMode,
        };
      }

      return {
        config: nextConfig,
        activeTrack: payload.track !== undefined ? payload.track : s.activeTrack,
        activeLyrics: nextLyrics,
        activePalette: payload.palette || s.activePalette,
        currentSongOffsetMs:
          typeof payload.songOffsetMs === 'number'
            ? clampOffsetMs(payload.songOffsetMs)
            : s.currentSongOffsetMs,
        currentAutoSyncOffsetMs:
          typeof payload.autoSyncOffsetMs === 'number'
            ? clampAutoSyncOffsetMs(payload.autoSyncOffsetMs)
            : s.currentAutoSyncOffsetMs,
        isScreenLocked:
          typeof payload.isScreenLocked === 'boolean' ? payload.isScreenLocked : s.isScreenLocked,
        lastAppliedRevisionId: nextRevisionId,
        lastBroadcastPayload: payload,
      };
    });
  },

  broadcastSnapshot: (partial, force = false) => {
    const state = get();
    if (!force && !state.config.overlayEnabled && !state.isAmbientOpen) {
      return;
    }
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!force && now - lastBroadcastTimeMs < 50) {
      return;
    }
    lastBroadcastTimeMs = now;
    broadcastRevisionCounter += 1;

    const bridge = getSharedWaveFormPlaybackBridge();
    const needsSnap =
      partial?.track === undefined ||
      partial?.positionSeconds === undefined ||
      partial?.isPlaying === undefined;
    const snap = needsSnap ? bridge.currentSnapshot : null;
    const audio =
      partial?.audio !== undefined
        ? partial.audio
        : state.config.audioReactive
        ? bridge.sampleAudioMetrics()
        : { rmsLevel: 0, bassEnergy: 0, midEnergy: 0, trebleEnergy: 0, beatDetected: false };

    const resolvedTrack =
      partial?.track !== undefined ? partial.track : state.activeTrack ?? snap?.track ?? null;
    const resolvedTrackId =
      partial?.trackId !== undefined ? partial.trackId : resolvedTrack?.id ?? null;

    const payload: LyricVisualizerBroadcastPayload = {
      revisionId: partial?.revisionId !== undefined ? partial.revisionId : broadcastRevisionCounter,
      trackId: resolvedTrackId,
      config: state.config,
      track: resolvedTrack,
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
        partial?.positionSeconds !== undefined
          ? partial.positionSeconds
          : snap?.positionSeconds ?? 0,
      isPlaying:
        partial?.isPlaying !== undefined ? partial.isPlaying : snap?.isPlaying ?? false,
      songOffsetMs:
        partial?.songOffsetMs !== undefined ? partial.songOffsetMs : state.currentSongOffsetMs,
      autoSyncOffsetMs:
        partial?.autoSyncOffsetMs !== undefined
          ? partial.autoSyncOffsetMs
          : state.currentAutoSyncOffsetMs,
      audio,
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
