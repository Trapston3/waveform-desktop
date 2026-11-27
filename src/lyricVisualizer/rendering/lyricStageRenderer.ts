// LyricStageRenderer: 60fps zero-allocation render coordinator owning Canvas2D,
// optional WebGlEffectLayer, Ship3DScene, LyricsMeasurer, StyleRegistry,
// spring-damped manual scroll, and preallocated hit-rect pool for hover/click-to-seek.

import {
  DEFAULT_LYRIC_VISUALIZER_CONFIG,
  getStyleDefinition,
  resolveStyleVariationId,
  SF_PRO_DISPLAY_STACK,
  type AudioFrameMetrics,
  type LyricPalette,
  type Lyrics,
  type LyricsLayout,
  type LyricsScriptMode,
  type LyricTextAlign,
  type MapScenePreference,
  type MapTimePreference,
  type MotionIntensity,
  type StyleFrameContext,
  type StyleTrackMetadata,
  type VisualStyleId,
} from '../core/models';
import { isBlankOrInstrumentalLineText } from '../core/lrcParser';
import { ensurePaletteContrast } from '../core/oklchPalette';
import { LyricsMeasurer } from './lyricsMeasurer';
import { setActiveShip3DScene, setShip3DSceneHint, Ship3DScene } from './ship3dScene';
import { mapLegacyStyleId, StyleRegistry } from './styleRegistry';
import { WebGlEffectLayer, type WebGlEffectParams } from './webGlEffectLayer';

const HIT_RECT_CAP = 256;

const FALLBACK_PALETTE: LyricPalette = {
  bgDeep: '#0a0d16',
  bgMid: '#151b2c',
  accentPrimary: '#5eead4',
  accentSecondary: '#818cf8',
  textActive: '#f8fafc',
  textUpcoming: '#cbd5e1',
  textPassed: '#64748b',
  oklchL: 0.72,
  oklchC: 0.14,
  oklchH: 190,
  isFallback: true,
};

export interface LyricStageFrameInput {
  timeSeconds: number;
  activeLineIndex: number;
  activeWordIndex: number;
  wordProgress: number;
  lineFadeAlpha?: number;
  didSeekThisFrame?: boolean;
  isInstrumentalGap?: boolean;
  gapProgress?: number;
  timeUntilNextLine?: number;
  hasLyrics?: boolean;
  lastActiveLineIndex?: number;
  nextLineIndex?: number;
}

export interface LyricStageRendererOptions {
  canvas: HTMLCanvasElement;
  webGlCanvas?: HTMLCanvasElement | null;
  shipCanvas?: HTMLCanvasElement | null;
  styleId?: VisualStyleId;
  variationId?: string;
  fontFamily?: string;
  fontSizeScale?: number;
  palette?: LyricPalette;
  reduceMotion?: boolean;
  isAmbientMode?: boolean;
  isOverlayMode?: boolean;
  isEmbeddedTransparent?: boolean;
  contentInsetLeft?: number;
  motionIntensity?: MotionIntensity;
  beatCameraThump?: boolean;
  iosKineticZoom?: number;
  audioReactive?: boolean;
  backgroundOpacity?: number;
  vignetteStrength?: number;
  textAlign?: LyricTextAlign;
  scriptMode?: LyricsScriptMode;
  trackMetadata?: StyleTrackMetadata | null;
  onSampleFrame?: (outAudio: AudioFrameMetrics) => LyricStageFrameInput | void;
  onFollowStateChange?: (isFollowing: boolean) => void;
}

// Mutable internal mirror of StyleFrameContext to guarantee zero per-frame allocations
interface MutableStyleFrameContext {
  lyrics: Lyrics | null;
  layout: LyricsLayout | null;
  timeSeconds: number;
  deltaSeconds: number;
  activeLineIndex: number;
  activeWordIndex: number;
  wordProgress: number;
  lineFadeAlpha: number;
  palette: LyricPalette;
  audio: AudioFrameMetrics;
  fontFamily: string;
  fontSizeScale: number;
  dpiScale: number;
  reduceMotion: boolean;
  isAmbientMode: boolean;
  isOverlayMode: boolean;
  isEmbeddedTransparent: boolean;
  hasWebGlBackdrop: boolean;
  contentInsetLeft: number;
  motionIntensity: MotionIntensity;
  beatCameraThump: boolean;
  iosKineticZoom: number;
  wordIconsEnabled: boolean;
  iosKineticPopup: boolean;
  mapScene: MapScenePreference;
  mapTimeOfDay: MapTimePreference;
  didSeekThisFrame: boolean;
  variationId: string;
  manualScrollY: number;
  isFollowingPlayback: boolean;
  hoveredLineIndex: number;
  backgroundOpacity: number;
  vignetteStrength: number;
  textAlign: LyricTextAlign;
  trackMetadata: StyleTrackMetadata | null;
  scriptMode: LyricsScriptMode;
  isInstrumentalGap: boolean;
  gapProgress: number;
  timeUntilNextLine: number;
  hasLyrics: boolean;
  lastActiveLineIndex: number;
  nextLineIndex: number;
  recordHitRect: (
    lineIndex: number,
    x: number,
    y: number,
    width: number,
    height: number
  ) => void;
}

export class LyricStageRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly webGlLayer: WebGlEffectLayer | null;
  private readonly ship3dScene: Ship3DScene;
  private readonly measurer: LyricsMeasurer;
  private readonly registry: StyleRegistry;
  private readonly onSampleFrame?: (outAudio: AudioFrameMetrics) => LyricStageFrameInput | void;
  private readonly onFollowStateChange?: (isFollowing: boolean) => void;

  private styleId: VisualStyleId;
  private variationId: string;
  private hasExplicitVariation = false;
  private audioReactive: boolean;
  private width = 800;
  private height = 600;
  private dpr = 1;
  private targetContentInsetLeft = 0;
  private currentContentInsetLeft = 0;
  private running = false;
  private locked = false;
  private disposed = false;
  private rafId: number | null = null;
  private lastFrameMs = 0;
  private boundFontsLoadingDone: (() => void) | null = null;
  private postRenderHook: (() => void) | null = null;

  // Interactive manual scroll & hover hit-testing state (zero per-frame heap allocations)
  private manualScrollY = 0;
  private targetManualScrollY = 0;
  private manualScrollVel = 0;
  private isFollowingPlayback = true;
  private hoveredLineIndex = -1;
  private pointerX = -1;
  private pointerY = -1;

  // Compositor-level beat-synced camera thump spring physics (zero allocations)
  private beatThumpScale = 0;
  private beatThumpVel = 0;
  private beatThumpRecoilY = 0;
  private beatThumpCooldown = 0;
  private lastThumpBass = 0;

  // Preallocated hit-rect pool (zero per-frame allocations)
  private readonly hitRectLineIndices = new Int32Array(HIT_RECT_CAP);
  private readonly hitRectBounds = new Float32Array(HIT_RECT_CAP * 4);
  private hitRectCount = 0;

  // Pre-allocated reusable objects (zero heap garbage inside 60fps loop)
  private readonly audioMetrics: AudioFrameMetrics = {
    rmsLevel: 0,
    bassEnergy: 0,
    midEnergy: 0,
    trebleEnergy: 0,
    beatDetected: false,
    estimatedBpm: 120,
    beatStrength: 0,
  };

  private readonly frameContext: MutableStyleFrameContext;

  private readonly webGlParams: WebGlEffectParams = {
    timeSeconds: 0,
    rmsLevel: 0,
    bassEnergy: 0,
    midEnergy: 0,
    trebleEnergy: 0,
    beatDetected: false,
    reduceMotion: false,
    isOverlayMode: false,
    bgDeepHex: FALLBACK_PALETTE.bgDeep,
    bgMidHex: FALLBACK_PALETTE.bgMid,
    accentPrimaryHex: FALLBACK_PALETTE.accentPrimary,
    accentSecondaryHex: FALLBACK_PALETTE.accentSecondary,
    variationIndex: 0,
    backgroundOpacity: 0.95,
  };

  private readonly boundTick: (nowMs: number) => void;
  private readonly boundRecordHitRect: (
    lineIndex: number,
    x: number,
    y: number,
    width: number,
    height: number
  ) => void;

  constructor(options: LyricStageRendererOptions) {
    this.canvas = options.canvas;
    this.ctx = options.canvas.getContext('2d');
    this.webGlLayer = options.webGlCanvas ? new WebGlEffectLayer(options.webGlCanvas) : null;
    this.ship3dScene = new Ship3DScene(options.shipCanvas);
    this.measurer = new LyricsMeasurer();
    this.registry = new StyleRegistry();
    this.onSampleFrame = options.onSampleFrame;
    this.onFollowStateChange = options.onFollowStateChange;

    const rawStyleId = options.styleId ?? 'AppleMusicFlow';
    this.styleId = mapLegacyStyleId(rawStyleId);
    this.hasExplicitVariation = typeof options.variationId === 'string' && options.variationId.length > 0;
    this.variationId = this.hasExplicitVariation
      ? options.variationId!
      : resolveStyleVariationId(rawStyleId, undefined);
    this.audioReactive = options.audioReactive ?? true;

    const initialInset = Math.max(
      0,
      typeof options.contentInsetLeft === 'number' && Number.isFinite(options.contentInsetLeft)
        ? options.contentInsetLeft
        : 0
    );
    this.targetContentInsetLeft = initialInset;
    this.currentContentInsetLeft = initialInset;

    this.boundRecordHitRect = (
      lineIndex: number,
      x: number,
      y: number,
      width: number,
      height: number
    ): void => {
      if (this.hitRectCount >= HIT_RECT_CAP) return;
      if (!Number.isFinite(x) || !Number.isFinite(y) || width <= 0 || height <= 0) return;
      const slot = this.hitRectCount;
      this.hitRectLineIndices[slot] = lineIndex | 0;
      const base = slot * 4;
      const inset = this.currentContentInsetLeft;
      const globalX = inset > 2 && x < inset ? x + inset : x;
      this.hitRectBounds[base] = globalX;
      this.hitRectBounds[base + 1] = y;
      this.hitRectBounds[base + 2] = width;
      this.hitRectBounds[base + 3] = height;
      this.hitRectCount = slot + 1;
    };

    this.frameContext = {
      lyrics: null,
      layout: null,
      timeSeconds: 0,
      deltaSeconds: 1 / 60,
      activeLineIndex: -1,
      activeWordIndex: -1,
      wordProgress: 0,
      lineFadeAlpha: 1,
      palette: ensurePaletteContrast(options.palette ?? FALLBACK_PALETTE),
      audio: this.audioMetrics,
      fontFamily: options.fontFamily ?? SF_PRO_DISPLAY_STACK,
      fontSizeScale: options.fontSizeScale ?? 1.0,
      dpiScale: 1,
      reduceMotion: options.reduceMotion ?? false,
      isAmbientMode: options.isAmbientMode ?? false,
      isOverlayMode: options.isOverlayMode ?? false,
      isEmbeddedTransparent: options.isEmbeddedTransparent ?? false,
      hasWebGlBackdrop: false,
      contentInsetLeft: initialInset,
      motionIntensity: options.motionIntensity ?? 'normal',
      beatCameraThump: options.beatCameraThump ?? true,
      iosKineticZoom:
        typeof options.iosKineticZoom === 'number' && Number.isFinite(options.iosKineticZoom)
          ? Math.max(0.75, Math.min(1.85, options.iosKineticZoom))
          : 1.45,
      wordIconsEnabled: DEFAULT_LYRIC_VISUALIZER_CONFIG.wordIconsEnabled,
      iosKineticPopup: DEFAULT_LYRIC_VISUALIZER_CONFIG.iosKineticPopup,
      mapScene: DEFAULT_LYRIC_VISUALIZER_CONFIG.mapScene,
      mapTimeOfDay: DEFAULT_LYRIC_VISUALIZER_CONFIG.mapTimeOfDay,
      didSeekThisFrame: false,
      variationId: this.variationId,
      manualScrollY: 0,
      isFollowingPlayback: true,
      hoveredLineIndex: -1,
      backgroundOpacity:
        typeof options.backgroundOpacity === 'number' && Number.isFinite(options.backgroundOpacity)
          ? Math.max(0.2, Math.min(1.0, options.backgroundOpacity))
          : 0.95,
      vignetteStrength:
        typeof options.vignetteStrength === 'number' && Number.isFinite(options.vignetteStrength)
          ? Math.max(0.0, Math.min(1.0, options.vignetteStrength))
          : 0.55,
      textAlign: options.textAlign === 'left' ? 'left' : 'center',
      trackMetadata: options.trackMetadata ?? null,
      scriptMode: options.scriptMode ?? 'auto',
      isInstrumentalGap: false,
      gapProgress: 0,
      timeUntilNextLine: Number.POSITIVE_INFINITY,
      hasLyrics: false,
      lastActiveLineIndex: -1,
      nextLineIndex: -1,
      recordHitRect: this.boundRecordHitRect,
    };

    this.boundTick = (nowMs: number) => {
      this.rafId = null;
      if (!this.running || this.locked || this.disposed) return;
      this.renderFrame(nowMs);
      if (this.running && !this.locked && !this.disposed) {
        this.scheduleNextFrame();
      }
    };

    if (typeof document !== 'undefined' && document.fonts) {
      const fonts = document.fonts;
      this.boundFontsLoadingDone = () => this.handleFontsLoaded();
      fonts.addEventListener?.('loadingdone', this.boundFontsLoadingDone);
      const weights = ['400', '500', '700', '800'];
      const loads =
        typeof fonts.load === 'function'
          ? weights.map((w) =>
              Promise.resolve(fonts.load(`${w} 32px "SF Pro Display"`)).catch(() => [])
            )
          : [];
      Promise.all([Promise.resolve(fonts.ready).catch(() => undefined), ...loads]).then(() => {
        this.handleFontsLoaded();
      });
    }
  }

  private handleFontsLoaded(): void {
    if (this.disposed) return;
    this.measurer.invalidate();
    this.frameContext.layout = null;
    this.registry.get(this.styleId).reset?.();
    if (this.running && !this.locked) {
      this.renderFrame();
    }
  }

  private updateFollowingState(nextFollowing: boolean): void {
    if (this.isFollowingPlayback === nextFollowing) return;
    this.isFollowingPlayback = nextFollowing;
    this.frameContext.isFollowingPlayback = nextFollowing;
    try {
      this.onFollowStateChange?.(nextFollowing);
    } catch {
      // Ignore callback error
    }
  }

  get isLocked(): boolean {
    return this.locked;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get styleRegistry(): StyleRegistry {
    return this.registry;
  }

  get lyricsMeasurer(): LyricsMeasurer {
    return this.measurer;
  }

  get webGlEffectLayer(): WebGlEffectLayer | null {
    return this.webGlLayer;
  }

  getBeatThumpScale(): number {
    return 1 + this.beatThumpScale;
  }

  isFollowing(): boolean {
    return this.isFollowingPlayback;
  }

  scrollBy(deltaY: number): void {
    if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 0.01) return;
    const layout = this.frameContext.layout;
    let minOffset = -3200;
    let maxOffset = 3200;
    if (layout && layout.lines.length > 0) {
      const activeIdx = Math.max(
        0,
        Math.min(layout.lines.length - 1, this.frameContext.activeLineIndex)
      );
      const activeY = layout.lines[activeIdx].y;
      minOffset = -activeY - 180;
      maxOffset = Math.max(0, layout.totalHeight - activeY) + 180;
    }

    this.targetManualScrollY = Math.max(
      minOffset,
      Math.min(maxOffset, this.targetManualScrollY + deltaY)
    );
    if (this.frameContext.reduceMotion) {
      this.manualScrollY = this.targetManualScrollY;
      this.manualScrollVel = 0;
      this.frameContext.manualScrollY = this.manualScrollY;
    }
    this.updateFollowingState(false);
  }

  resumeFollowPlayback(): void {
    this.targetManualScrollY = 0;
    if (this.frameContext.reduceMotion) {
      this.manualScrollY = 0;
      this.manualScrollVel = 0;
      this.frameContext.manualScrollY = 0;
    }
    this.updateFollowingState(true);
  }

  setPointerPosition(x: number, y: number): number {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
      this.pointerX = -1;
      this.pointerY = -1;
      this.hoveredLineIndex = -1;
      this.frameContext.hoveredLineIndex = -1;
      return -1;
    }
    this.pointerX = x;
    this.pointerY = y;
    const hit = this.findLineAtPoint(x, y);
    const idx = hit !== null ? hit : -1;
    this.hoveredLineIndex = idx;
    this.frameContext.hoveredLineIndex = idx;
    return idx;
  }

  clearPointerPosition(): void {
    this.setPointerPosition(-1, -1);
  }

  setStyle(styleId: VisualStyleId | string, variationId?: string): void {
    const mapped = mapLegacyStyleId(styleId);
    const nextId = this.registry.has(mapped) ? mapped : 'AppleMusicFlow';
    const legacyChanged =
      styleId === 'HoloVaporwave' ||
      styleId === 'SpectrumRibbon' ||
      styleId === 'KaraokeStage' ||
      styleId === 'MinimalSwiss' ||
      styleId === 'TypewriterEditorial';
    if (this.styleId === nextId && !legacyChanged && variationId === undefined) return;
    this.styleId = nextId;
    const def = getStyleDefinition(nextId);
    if (variationId !== undefined) {
      this.setVariation(variationId);
      return;
    }
    const isCurrentVariationValidForNext = def.variations.some((v) => v.id === this.variationId);
    if (!this.hasExplicitVariation || legacyChanged || !isCurrentVariationValidForNext) {
      this.variationId = resolveStyleVariationId(legacyChanged ? styleId : nextId, undefined);
      this.frameContext.variationId = this.variationId;
      if (!legacyChanged && !isCurrentVariationValidForNext) {
        this.hasExplicitVariation = false;
      }
    }
    this.registry.get(this.styleId).reset?.();
  }

  setVariation(variationId: string): void {
    if (typeof variationId !== 'string' || variationId.trim().length === 0) return;
    this.hasExplicitVariation = true;
    const resolved = resolveStyleVariationId(this.styleId, {
      [this.styleId]: variationId.trim(),
    });
    if (this.variationId === resolved) return;
    this.variationId = resolved;
    this.frameContext.variationId = resolved;
  }

  setPostRenderHook(cb: (() => void) | null): void {
    this.postRenderHook = cb;
  }

  setVisualSettings(settings: {
    backgroundOpacity?: number;
    vignetteStrength?: number;
    textAlign?: LyricTextAlign;
    iosKineticZoom?: number;
    wordIconsEnabled?: boolean;
    iosKineticPopup?: boolean;
    mapScene?: MapScenePreference;
    mapTimeOfDay?: MapTimePreference;
  }): void {
    if (
      typeof settings.backgroundOpacity === 'number' &&
      Number.isFinite(settings.backgroundOpacity)
    ) {
      this.frameContext.backgroundOpacity = Math.max(
        0.2,
        Math.min(1.0, settings.backgroundOpacity)
      );
    }
    if (
      typeof settings.vignetteStrength === 'number' &&
      Number.isFinite(settings.vignetteStrength)
    ) {
      this.frameContext.vignetteStrength = Math.max(
        0.0,
        Math.min(1.0, settings.vignetteStrength)
      );
    }
    if (settings.textAlign === 'left' || settings.textAlign === 'center') {
      this.frameContext.textAlign = settings.textAlign;
    }
    if (
      typeof settings.iosKineticZoom === 'number' &&
      Number.isFinite(settings.iosKineticZoom)
    ) {
      this.frameContext.iosKineticZoom = Math.max(
        0.75,
        Math.min(1.85, settings.iosKineticZoom)
      );
    }
    if (typeof settings.wordIconsEnabled === 'boolean') {
      this.frameContext.wordIconsEnabled = settings.wordIconsEnabled;
    }
    if (typeof settings.iosKineticPopup === 'boolean') {
      this.frameContext.iosKineticPopup = settings.iosKineticPopup;
    }
    if (
      settings.mapScene === 'auto' ||
      settings.mapScene === 'cityscape' ||
      settings.mapScene === 'highway' ||
      settings.mapScene === 'countryside'
    ) {
      this.frameContext.mapScene = settings.mapScene;
    }
    if (
      settings.mapTimeOfDay === 'auto' ||
      settings.mapTimeOfDay === 'night' ||
      settings.mapTimeOfDay === 'sunset' ||
      settings.mapTimeOfDay === 'day'
    ) {
      this.frameContext.mapTimeOfDay = settings.mapTimeOfDay;
    }
  }

  setTrackMetadata(meta: StyleTrackMetadata | null): void {
    this.frameContext.trackMetadata = meta;
  }

  setScriptMode(scriptMode: LyricsScriptMode): void {
    const next: LyricsScriptMode = scriptMode ?? 'auto';
    if (this.frameContext.scriptMode === next) return;
    this.frameContext.scriptMode = next;
    this.frameContext.layout = null;
    this.measurer.invalidate();
  }

  setLyrics(lyrics: Lyrics | null): void {
    const changed = this.frameContext.lyrics !== lyrics;
    this.frameContext.lyrics = lyrics;
    if (changed) {
      this.frameContext.layout = null;
      this.measurer.invalidate();
      this.manualScrollY = 0;
      this.targetManualScrollY = 0;
      this.manualScrollVel = 0;
      this.frameContext.manualScrollY = 0;
      this.hoveredLineIndex = -1;
      this.frameContext.hoveredLineIndex = -1;
      this.frameContext.lastActiveLineIndex = -1;
      this.hitRectCount = 0;
      this.updateFollowingState(true);
    }
  }

  setPalette(palette: LyricPalette): void {
    this.frameContext.palette = ensurePaletteContrast(palette);
  }

  setTypography(fontFamily: string, fontSizeScale: number): void {
    this.frameContext.fontFamily = fontFamily;
    this.frameContext.fontSizeScale = Math.max(0.5, Math.min(2.5, fontSizeScale));
  }

  setModes(modes: {
    reduceMotion?: boolean;
    isAmbientMode?: boolean;
    isOverlayMode?: boolean;
    isEmbeddedTransparent?: boolean;
    motionIntensity?: MotionIntensity;
    beatCameraThump?: boolean;
    audioReactive?: boolean;
  }): void {
    if (modes.reduceMotion !== undefined) this.frameContext.reduceMotion = modes.reduceMotion;
    if (modes.isAmbientMode !== undefined) this.frameContext.isAmbientMode = modes.isAmbientMode;
    if (modes.isOverlayMode !== undefined) this.frameContext.isOverlayMode = modes.isOverlayMode;
    if (modes.isEmbeddedTransparent !== undefined) {
      this.frameContext.isEmbeddedTransparent = modes.isEmbeddedTransparent;
    }
    if (modes.motionIntensity !== undefined) {
      this.frameContext.motionIntensity = modes.motionIntensity;
    }
    if (modes.beatCameraThump !== undefined) {
      this.frameContext.beatCameraThump = modes.beatCameraThump;
    }
    if (modes.audioReactive !== undefined) this.audioReactive = modes.audioReactive;
  }

  setContentInsetLeft(px: number): void {
    const next = Math.max(0, Number.isFinite(px) ? px : 0);
    if (this.targetContentInsetLeft === next) return;
    this.targetContentInsetLeft = next;
    if (this.frameContext.reduceMotion || Math.abs(next - this.currentContentInsetLeft) < 0.5) {
      this.currentContentInsetLeft = next;
      this.frameContext.contentInsetLeft = next;
    }
  }

  private applySyncGapTelemetry(state: LyricStageFrameInput): void {
    const fc = this.frameContext;
    if (state.isInstrumentalGap !== undefined) {
      fc.isInstrumentalGap = Boolean(state.isInstrumentalGap);
      fc.gapProgress =
        typeof state.gapProgress === 'number' && Number.isFinite(state.gapProgress)
          ? Math.max(0, Math.min(1, state.gapProgress))
          : 0;
      fc.timeUntilNextLine =
        typeof state.timeUntilNextLine === 'number'
          ? state.timeUntilNextLine
          : Number.POSITIVE_INFINITY;
      fc.hasLyrics =
        state.hasLyrics !== undefined
          ? Boolean(state.hasLyrics)
          : Boolean(fc.lyrics && fc.lyrics.lines.length > 0);
      fc.lastActiveLineIndex =
        typeof state.lastActiveLineIndex === 'number'
          ? state.lastActiveLineIndex
          : state.activeLineIndex >= 0
          ? state.activeLineIndex
          : fc.lastActiveLineIndex;
      fc.nextLineIndex =
        typeof state.nextLineIndex === 'number' ? state.nextLineIndex : -1;
      return;
    }

    const lines = fc.lyrics?.lines;
    let firstNonBlankIdx = -1;
    let lastNonBlankIdx = -1;
    if (lines && lines.length > 0) {
      for (let i = 0; i < lines.length; i++) {
        if (!isBlankOrInstrumentalLineText(lines[i].text)) {
          if (firstNonBlankIdx < 0) firstNonBlankIdx = i;
          lastNonBlankIdx = i;
        }
      }
    }
    if (!lines || lines.length === 0 || firstNonBlankIdx < 0) {
      fc.hasLyrics = false;
      fc.isInstrumentalGap = true;
      fc.gapProgress = 0;
      fc.timeUntilNextLine = Number.POSITIVE_INFINITY;
      fc.lastActiveLineIndex = -1;
      fc.nextLineIndex = -1;
      return;
    }

    fc.hasLyrics = true;
    const t = fc.timeSeconds;
    const rawActiveIdx = fc.activeLineIndex;
    const activeIdx =
      rawActiveIdx >= 0 && rawActiveIdx < lines.length && !isBlankOrInstrumentalLineText(lines[rawActiveIdx].text)
        ? rawActiveIdx
        : -1;
    if (rawActiveIdx !== activeIdx) {
      fc.activeLineIndex = activeIdx;
    }
    let isGap = false;
    let gapProgress = 0;
    let timeUntilNext = Number.POSITIVE_INFINITY;
    let lastActive = fc.lastActiveLineIndex;
    let nextIdx = -1;

    if (activeIdx >= 0 && activeIdx < lines.length) {
      lastActive = activeIdx;
      const line = lines[activeIdx];
      const lastWordEnd =
        line.words.length > 0 ? line.words[line.words.length - 1].endSeconds : line.endSeconds;
      for (let i = activeIdx + 1; i < lines.length; i++) {
        if (!isBlankOrInstrumentalLineText(lines[i].text)) {
          nextIdx = i;
          break;
        }
      }
      if (nextIdx >= 0) {
        const nextStart = lines[nextIdx].startSeconds;
        timeUntilNext = Math.max(0, nextStart - t);
        const tailGap = nextStart - lastWordEnd;
        if (tailGap >= 3.5 && t > lastWordEnd) {
          isGap = true;
          gapProgress = Math.max(0, Math.min(1, (t - lastWordEnd) / Math.max(0.001, tailGap)));
        }
      } else if (line.words.length > 0 && t > lastWordEnd && line.endSeconds - lastWordEnd >= 3.5) {
        isGap = true;
        gapProgress = Math.max(0, Math.min(1, (t - lastWordEnd) / Math.max(0.001, line.endSeconds - lastWordEnd)));
      }
    } else if (t < lines[firstNonBlankIdx].startSeconds) {
      nextIdx = firstNonBlankIdx;
      lastActive = -1;
      const firstStart = lines[firstNonBlankIdx].startSeconds;
      timeUntilNext = Math.max(0, firstStart - t);
      if (firstStart > 3.0) {
        isGap = true;
        gapProgress = Math.max(0, Math.min(1, t / Math.max(0.001, firstStart)));
      }
    } else if (t > lines[lastNonBlankIdx].endSeconds) {
      lastActive = lastNonBlankIdx;
      isGap = true;
      gapProgress = 1;
    } else {
      let prevIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].endSeconds <= t && !isBlankOrInstrumentalLineText(lines[i].text)) {
          prevIdx = i;
        } else if (lines[i].endSeconds > t) {
          break;
        }
      }
      if (prevIdx < 0) {
        nextIdx = firstNonBlankIdx;
        lastActive = -1;
        const firstStart = lines[firstNonBlankIdx].startSeconds;
        timeUntilNext = Math.max(0, firstStart - t);
        if (firstStart > 3.0) {
          isGap = true;
          gapProgress = Math.max(0, Math.min(1, t / Math.max(0.001, firstStart)));
        }
      } else {
        lastActive = prevIdx;
        for (let i = prevIdx + 1; i < lines.length; i++) {
          if (!isBlankOrInstrumentalLineText(lines[i].text)) {
            nextIdx = i;
            break;
          }
        }
        if (nextIdx >= 0) {
          const prevLine = lines[prevIdx];
          const prevEnd =
            prevLine.words.length > 0
              ? Math.min(prevLine.endSeconds, prevLine.words[prevLine.words.length - 1].endSeconds)
              : prevLine.endSeconds;
          const nextStart = lines[nextIdx].startSeconds;
          const gapDur = nextStart - prevEnd;
          timeUntilNext = Math.max(0, nextStart - t);
          if (gapDur >= 3.5) {
            isGap = true;
            gapProgress = Math.max(0, Math.min(1, (t - prevEnd) / Math.max(0.001, gapDur)));
          }
        } else {
          isGap = true;
          gapProgress = 1;
        }
      }
    }

    fc.isInstrumentalGap = isGap;
    fc.gapProgress = gapProgress;
    fc.timeUntilNextLine = timeUntilNext;
    fc.lastActiveLineIndex = lastActive;
    fc.nextLineIndex = nextIdx;
  }

  setSyncState(state: LyricStageFrameInput): void {
    this.frameContext.timeSeconds = state.timeSeconds;
    this.frameContext.activeLineIndex = state.activeLineIndex;
    this.frameContext.activeWordIndex = state.activeWordIndex;
    this.frameContext.wordProgress = state.wordProgress;
    this.frameContext.lineFadeAlpha = state.lineFadeAlpha ?? 1;
    this.frameContext.didSeekThisFrame = Boolean(state.didSeekThisFrame);
    this.applySyncGapTelemetry(state);
    if (this.frameContext.didSeekThisFrame) {
      this.manualScrollY = 0;
      this.targetManualScrollY = 0;
      this.manualScrollVel = 0;
      this.frameContext.manualScrollY = 0;
      this.updateFollowingState(true);
    }
  }

  setAudioMetrics(audio: Partial<AudioFrameMetrics>): void {
    if (audio.rmsLevel !== undefined) this.audioMetrics.rmsLevel = audio.rmsLevel;
    if (audio.bassEnergy !== undefined) this.audioMetrics.bassEnergy = audio.bassEnergy;
    if (audio.midEnergy !== undefined) this.audioMetrics.midEnergy = audio.midEnergy;
    if (audio.trebleEnergy !== undefined) this.audioMetrics.trebleEnergy = audio.trebleEnergy;
    if (audio.beatDetected !== undefined) this.audioMetrics.beatDetected = audio.beatDetected;
    if (audio.estimatedBpm !== undefined) this.audioMetrics.estimatedBpm = audio.estimatedBpm;
    if (audio.beatStrength !== undefined) this.audioMetrics.beatStrength = audio.beatStrength;
  }

  setLocked(locked: boolean): void {
    if (this.locked === locked) return;
    this.locked = locked;
    if (locked) {
      // Immediately halt rAF and skip all WebGL/Canvas work (0% GPU usage on Windows lock screen)
      this.cancelScheduledFrame();
    } else if (this.running && !this.disposed) {
      this.lastFrameMs = 0;
      this.scheduleNextFrame();
    }
  }

  resize(width: number, height: number, dpr = 1): void {
    if (this.disposed) return;
    const clampedDpr = Math.max(1, Math.min(2, Number.isFinite(dpr) ? dpr : 1));
    const safeW = Math.max(1, Math.floor(width));
    const safeH = Math.max(1, Math.floor(height));

    this.width = safeW;
    this.height = safeH;
    this.dpr = clampedDpr;
    this.frameContext.dpiScale = clampedDpr;

    const physW = Math.max(1, Math.floor(safeW * clampedDpr));
    const physH = Math.max(1, Math.floor(safeH * clampedDpr));
    if (this.canvas.width !== physW || this.canvas.height !== physH) {
      this.canvas.width = physW;
      this.canvas.height = physH;
    }

    if (this.ctx && typeof this.ctx.setTransform === 'function') {
      this.ctx.setTransform(clampedDpr, 0, 0, clampedDpr, 0, 0);
    }

    if (this.webGlLayer) {
      this.webGlLayer.resize(safeW, safeH, clampedDpr);
    }
    this.ship3dScene.resize(safeW, safeH, clampedDpr);
  }

  start(): void {
    if (this.disposed || this.running) return;
    this.running = true;
    this.lastFrameMs = 0;
    if (!this.locked) {
      this.renderFrame();
      this.scheduleNextFrame();
    }
  }

  stop(): void {
    this.running = false;
    this.cancelScheduledFrame();
  }

  private scheduleNextFrame(): void {
    if (this.rafId !== null || this.locked || !this.running || this.disposed) return;
    if (typeof globalThis.requestAnimationFrame === 'function') {
      this.rafId = globalThis.requestAnimationFrame(this.boundTick);
    }
  }

  private cancelScheduledFrame(): void {
    if (this.rafId !== null) {
      if (typeof globalThis.cancelAnimationFrame === 'function') {
        globalThis.cancelAnimationFrame(this.rafId);
      }
      this.rafId = null;
    }
  }

  renderFrame(nowMs?: number): boolean {
    // 0% GPU usage guarantee while locked or disposed
    if (this.locked || this.disposed || !this.ctx) {
      return false;
    }

    const timestamp =
      nowMs !== undefined
        ? nowMs
        : typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();

    if (this.lastFrameMs > 0) {
      const rawDt = (timestamp - this.lastFrameMs) / 1000;
      this.frameContext.deltaSeconds = Math.max(0.001, Math.min(0.1, rawDt));
    } else {
      this.frameContext.deltaSeconds = 1 / 60;
    }
    this.lastFrameMs = timestamp;

    const dt = this.frameContext.deltaSeconds;
    const insetDiff = this.targetContentInsetLeft - this.currentContentInsetLeft;
    if (this.frameContext.reduceMotion || Math.abs(insetDiff) < 0.5) {
      this.currentContentInsetLeft = this.targetContentInsetLeft;
    } else {
      this.currentContentInsetLeft += insetDiff * (1 - Math.exp(-dt * 10));
    }
    this.frameContext.contentInsetLeft = this.currentContentInsetLeft;

    // Optional per-frame pull from playback bridge
    if (this.onSampleFrame) {
      const sampled = this.onSampleFrame(this.audioMetrics);
      if (sampled) {
        this.frameContext.timeSeconds = sampled.timeSeconds;
        this.frameContext.activeLineIndex = sampled.activeLineIndex;
        this.frameContext.activeWordIndex = sampled.activeWordIndex;
        this.frameContext.wordProgress = sampled.wordProgress;
        this.frameContext.lineFadeAlpha = sampled.lineFadeAlpha ?? 1;
        this.frameContext.didSeekThisFrame = Boolean(sampled.didSeekThisFrame);
        this.applySyncGapTelemetry(sampled);
      }
    }

    if (this.frameContext.didSeekThisFrame) {
      this.manualScrollY = 0;
      this.targetManualScrollY = 0;
      this.manualScrollVel = 0;
      this.updateFollowingState(true);
    }

    // Spring-damped manual scroll physics
    if (this.frameContext.reduceMotion) {
      this.manualScrollY = this.targetManualScrollY;
      this.manualScrollVel = 0;
    } else {
      const disp = this.targetManualScrollY - this.manualScrollY;
      if (Math.abs(disp) < 0.15 && Math.abs(this.manualScrollVel) < 0.5) {
        this.manualScrollY = this.targetManualScrollY;
        this.manualScrollVel = 0;
      } else {
        const accel = disp * 180 - this.manualScrollVel * 26;
        this.manualScrollVel += accel * dt;
        this.manualScrollY += this.manualScrollVel * dt;
      }
    }
    this.frameContext.manualScrollY = this.manualScrollY;
    this.frameContext.isFollowingPlayback = this.isFollowingPlayback;

    if (!this.audioReactive) {
      this.audioMetrics.rmsLevel = 0;
      this.audioMetrics.bassEnergy = 0;
      this.audioMetrics.midEnergy = 0;
      this.audioMetrics.trebleEnergy = 0;
      this.audioMetrics.beatDetected = false;
      this.audioMetrics.beatStrength = 0;
    }

    const style = this.registry.get(this.styleId);
    const measurementSpec = style.getMeasurementSpec?.(this.frameContext as StyleFrameContext);

    // Cached layout measurement (0 allocations when lyrics/size/font/spec unchanged)
    const measureWidth = Math.max(240, this.width - Math.round(this.targetContentInsetLeft));
    this.frameContext.layout = this.measurer.measure(
      this.ctx,
      this.frameContext.lyrics,
      measureWidth,
      this.height,
      this.frameContext.fontFamily,
      this.frameContext.fontSizeScale,
      undefined,
      measurementSpec,
      this.frameContext.scriptMode,
      this.styleId
    );

    const isTransparent = Boolean(
      this.frameContext.isOverlayMode || this.frameContext.isEmbeddedTransparent
    );

    const activeWebGlEffect = style.getWebGlEffect
      ? style.getWebGlEffect(this.frameContext as StyleFrameContext)
      : style.webGlEffect;
    const variationIndex = style.getVariationIndex
      ? style.getVariationIndex(this.frameContext.variationId)
      : 0;

    // 1. Optional WebGL2 effect layer
    if (this.webGlLayer) {
      if (activeWebGlEffect === 'none' || isTransparent) {
        this.webGlLayer.clear();
      } else {
        this.webGlParams.timeSeconds = this.frameContext.timeSeconds;
        this.webGlParams.rmsLevel = this.audioMetrics.rmsLevel;
        this.webGlParams.bassEnergy = this.audioMetrics.bassEnergy;
        this.webGlParams.midEnergy = this.audioMetrics.midEnergy;
        this.webGlParams.trebleEnergy = this.audioMetrics.trebleEnergy;
        this.webGlParams.beatDetected = this.audioMetrics.beatDetected;
        this.webGlParams.reduceMotion = this.frameContext.reduceMotion;
        this.webGlParams.isOverlayMode = isTransparent;
        this.webGlParams.bgDeepHex = this.frameContext.palette.bgDeep;
        this.webGlParams.bgMidHex = this.frameContext.palette.bgMid;
        this.webGlParams.accentPrimaryHex = this.frameContext.palette.accentPrimary;
        this.webGlParams.accentSecondaryHex = this.frameContext.palette.accentSecondary;
        this.webGlParams.variationIndex = variationIndex;
        this.webGlParams.backgroundOpacity = this.frameContext.backgroundOpacity;
        this.webGlLayer.render(activeWebGlEffect, this.webGlParams);
      }
    }
    const webGlRenderable =
      typeof (this.webGlLayer as any)?.isRenderable === 'boolean'
        ? (this.webGlLayer as any).isRenderable
        : Boolean(this.webGlLayer);
    this.frameContext.hasWebGlBackdrop = Boolean(
      webGlRenderable && activeWebGlEffect !== 'none' && !isTransparent
    );

    // 2. Clear Canvas2D transparently (critical for Overlay/Embedded mode & WebGL2 compositing)
    this.ctx.clearRect(0, 0, this.width, this.height);

    const focalCenterX =
      this.currentContentInsetLeft > 2
        ? this.currentContentInsetLeft + Math.max(220, this.width - this.currentContentInsetLeft) * 0.5
        : this.width * 0.5;

    // 3. Optional 3D Starfield + Ship scene (StarfieldShip3D)
    const intensityMult =
      this.frameContext.motionIntensity === 'subtle'
        ? 0.55
        : this.frameContext.motionIntensity === 'vivid'
        ? 1.35
        : 1.0;

    if (style.usesShip3D) {
      setShip3DSceneHint(
        this.frameContext.variationId,
        this.frameContext.backgroundOpacity,
        this.frameContext.vignetteStrength
      );
      this.ship3dScene.syncLyricsState(
        this.frameContext.lyrics,
        this.frameContext.timeSeconds,
        this.frameContext.activeLineIndex,
        this.frameContext.activeWordIndex,
        this.frameContext.isInstrumentalGap,
        this.frameContext.didSeekThisFrame
      );
      setActiveShip3DScene(this.ship3dScene);
      this.ship3dScene.render(
        this.ctx,
        this.width,
        this.height,
        this.frameContext.timeSeconds,
        this.frameContext.deltaSeconds,
        this.audioMetrics,
        this.frameContext.palette,
        this.frameContext.reduceMotion,
        isTransparent,
        this.frameContext.variationId,
        this.frameContext.backgroundOpacity,
        focalCenterX,
        this.frameContext.hasWebGlBackdrop,
        this.currentContentInsetLeft,
        this.frameContext.beatCameraThump,
        intensityMult
      );
    } else {
      this.ship3dScene.clear();
    }

    // 4. Compositor-level spring-damped Beat Camera Thump (all themes, default ON)
    const thumpEnabled =
      this.frameContext.beatCameraThump &&
      !this.frameContext.reduceMotion &&
      this.audioReactive &&
      !isTransparent;

    if (!thumpEnabled) {
      this.beatThumpScale = 0;
      this.beatThumpVel = 0;
      this.beatThumpRecoilY = 0;
      this.beatThumpCooldown = 0;
      this.lastThumpBass = this.audioMetrics.bassEnergy;
    } else {
      this.beatThumpCooldown = Math.max(0, this.beatThumpCooldown - dt);
      const bass = this.audioMetrics.bassEnergy || 0;
      const bassDelta = bass - this.lastThumpBass;
      this.lastThumpBass = bass;
      const beatStrength =
        this.audioMetrics.beatStrength ?? (this.audioMetrics.beatDetected ? 1.0 : bass);
      const triggerThump =
        this.beatThumpCooldown <= 0 &&
        (Boolean(this.audioMetrics.isDownbeat) ||
          Boolean(this.audioMetrics.beatDetected) ||
          (bassDelta > 0.14 && bass > 0.42) ||
          beatStrength > 0.68);

      if (triggerThump) {
        const isKineticBoost =
          this.styleId === 'IosTextingMotion' &&
          this.frameContext.variationId !== 'navigation-map' &&
          Boolean(this.frameContext.iosKineticPopup);
        const isNativeZDepth = this.styleId === 'Spatial3DDepth';
        const basePeak = isKineticBoost ? 0.055 : isNativeZDepth ? 0.01 : 0.032;
        const downbeatFactor = this.audioMetrics.isDownbeat ? 1.15 : 0.88;
        const peak = basePeak * intensityMult * downbeatFactor;
        this.beatThumpVel += peak * 24;
        this.beatThumpRecoilY = Math.min(9, peak * 110);
        this.beatThumpCooldown = 0.18;
      }

      const springAcc = -280 * this.beatThumpScale - 24 * this.beatThumpVel;
      this.beatThumpVel += springAcc * dt;
      this.beatThumpScale = Math.max(0, Math.min(0.085, this.beatThumpScale + this.beatThumpVel * dt));
      this.beatThumpRecoilY *= Math.exp(-dt * 14);
      if (this.beatThumpScale < 0.0002 && Math.abs(this.beatThumpVel) < 0.001) {
        this.beatThumpScale = 0;
        this.beatThumpVel = 0;
      }
    }

    // 5. Reset hit-rect pool, paint full untransformed dark base (preventing top-edge hairline),
    // and apply strict overscan + viewport clip around Beat Camera Thump
    this.hitRectCount = 0;
    if (!isTransparent && !this.frameContext.hasWebGlBackdrop) {
      this.ctx.fillStyle = this.frameContext.palette.bgDeep || '#05060a';
      this.ctx.fillRect(0, 0, this.width, this.height);
    }
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(0, 0, this.width, this.height);
    this.ctx.clip();
    if (this.beatThumpScale > 0.0004 || this.beatThumpRecoilY > 0.15) {
      const minSafeScale =
        this.height > 0 ? 1.0 + (Math.abs(this.beatThumpRecoilY) * 2 + 4) / this.height : 1.0;
      const thumpScale = Math.max(1 + this.beatThumpScale, minSafeScale);
      const anchorY = this.height * 0.5;
      this.ctx.translate(focalCenterX, anchorY + this.beatThumpRecoilY);
      this.ctx.scale(thumpScale, thumpScale);
      this.ctx.translate(-focalCenterX, -anchorY);
    }
    style.render(
      this.ctx,
      this.frameContext as StyleFrameContext,
      this.width,
      this.height
    );
    this.ctx.restore();
    this.postRenderHook?.();

    // Refresh hover hit-test if pointer is active over canvas
    if (this.pointerX >= 0 && this.pointerY >= 0) {
      const hit = this.findLineAtPoint(this.pointerX, this.pointerY);
      this.hoveredLineIndex = hit !== null ? hit : -1;
      this.frameContext.hoveredLineIndex = this.hoveredLineIndex;
    }

    this.frameContext.didSeekThisFrame = false;
    return true;
  }

  // Click-to-seek and hover hit-testing against recorded style hit-rects and measured layout
  findLineAtPoint(x: number, y: number): number | null {
    const layout = this.frameContext.layout;
    if (!layout || layout.lines.length === 0) return null;
    if (x < 0 || x < this.currentContentInsetLeft || x > this.width || y < 0 || y > this.height) {
      return null;
    }

    // 1. Exact 2D bounding-box hit test against style-recorded hit rects (topmost first)
    for (let i = this.hitRectCount - 1; i >= 0; i--) {
      const base = i * 4;
      const rx = this.hitRectBounds[base];
      const ry = this.hitRectBounds[base + 1];
      const rw = this.hitRectBounds[base + 2];
      const rh = this.hitRectBounds[base + 3];
      if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) {
        const lineIdx = this.hitRectLineIndices[i];
        if (lineIdx >= 0 && lineIdx < layout.lines.length) {
          return lineIdx;
        }
      }
    }

    // 2. Vertical row band hit test against recorded hit rects within the focal column
    for (let i = this.hitRectCount - 1; i >= 0; i--) {
      const base = i * 4;
      const ry = this.hitRectBounds[base + 1];
      const rh = this.hitRectBounds[base + 3];
      if (y >= ry - 4 && y <= ry + rh + 4) {
        const lineIdx = this.hitRectLineIndices[i];
        if (lineIdx >= 0 && lineIdx < layout.lines.length) {
          return lineIdx;
        }
      }
    }

    // 3. Fallback layout-based vertical hit test (incorporating manualScrollY)
    const fallbackActive =
      this.frameContext.activeLineIndex >= 0
        ? this.frameContext.activeLineIndex
        : this.frameContext.lastActiveLineIndex >= 0
        ? this.frameContext.lastActiveLineIndex
        : 0;
    const activeIdx = Math.max(
      0,
      Math.min(layout.lines.length - 1, fallbackActive)
    );
    const activeLine = layout.lines[activeIdx];
    const anchorY = this.height * (this.frameContext.isOverlayMode ? 0.52 : 0.46);
    const scrollY = activeLine.y + activeLine.height * 0.5 + this.manualScrollY;
    const hitPad = 14;

    for (let i = 0; i < layout.lines.length; i++) {
      const line = layout.lines[i];
      const top = anchorY + (line.y - scrollY) - hitPad;
      const bottom = top + line.height + hitPad * 2;
      if (y >= top && y <= bottom) {
        return line.lineIndex;
      }
    }

    return null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    if (this.boundFontsLoadingDone && typeof document !== 'undefined' && document.fonts) {
      document.fonts.removeEventListener?.('loadingdone', this.boundFontsLoadingDone);
      this.boundFontsLoadingDone = null;
    }
    this.registry.disposeAll();
    this.ship3dScene.dispose();
    this.webGlLayer?.dispose();
    this.measurer.invalidate();
  }
}
