// LyricStageRenderer: 60fps zero-allocation render coordinator owning Canvas2D,
// optional WebGlEffectLayer, Ship3DScene, LyricsMeasurer, and StyleRegistry.

import type {
  AudioFrameMetrics,
  LyricPalette,
  Lyrics,
  LyricsLayout,
  StyleFrameContext,
  VisualStyleId,
} from '../core/models';
import { LyricsMeasurer } from './lyricsMeasurer';
import { Ship3DScene } from './ship3dScene';
import { StyleRegistry } from './styleRegistry';
import { WebGlEffectLayer, type WebGlEffectParams } from './webGlEffectLayer';

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
}

export interface LyricStageRendererOptions {
  canvas: HTMLCanvasElement;
  webGlCanvas?: HTMLCanvasElement | null;
  styleId?: VisualStyleId;
  fontFamily?: string;
  fontSizeScale?: number;
  palette?: LyricPalette;
  reduceMotion?: boolean;
  isAmbientMode?: boolean;
  isOverlayMode?: boolean;
  audioReactive?: boolean;
  onSampleFrame?: (outAudio: AudioFrameMetrics) => LyricStageFrameInput | void;
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
  didSeekThisFrame: boolean;
}

export class LyricStageRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly webGlLayer: WebGlEffectLayer | null;
  private readonly ship3dScene: Ship3DScene;
  private readonly measurer: LyricsMeasurer;
  private readonly registry: StyleRegistry;
  private readonly onSampleFrame?: (outAudio: AudioFrameMetrics) => LyricStageFrameInput | void;

  private styleId: VisualStyleId;
  private audioReactive: boolean;
  private width = 800;
  private height = 600;
  private dpr = 1;
  private running = false;
  private locked = false;
  private disposed = false;
  private rafId: number | null = null;
  private lastFrameMs = 0;

  // Pre-allocated reusable objects (zero heap garbage inside 60fps loop)
  private readonly audioMetrics: AudioFrameMetrics = {
    rmsLevel: 0,
    bassEnergy: 0,
    midEnergy: 0,
    trebleEnergy: 0,
    beatDetected: false,
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
  };

  private readonly boundTick: (nowMs: number) => void;

  constructor(options: LyricStageRendererOptions) {
    this.canvas = options.canvas;
    this.ctx = options.canvas.getContext('2d');
    this.webGlLayer = options.webGlCanvas ? new WebGlEffectLayer(options.webGlCanvas) : null;
    this.ship3dScene = new Ship3DScene();
    this.measurer = new LyricsMeasurer();
    this.registry = new StyleRegistry();
    this.onSampleFrame = options.onSampleFrame;

    this.styleId = options.styleId ?? 'AppleMusicFlow';
    this.audioReactive = options.audioReactive ?? true;

    this.frameContext = {
      lyrics: null,
      layout: null,
      timeSeconds: 0,
      deltaSeconds: 1 / 60,
      activeLineIndex: -1,
      activeWordIndex: -1,
      wordProgress: 0,
      lineFadeAlpha: 1,
      palette: options.palette ?? FALLBACK_PALETTE,
      audio: this.audioMetrics,
      fontFamily: options.fontFamily ?? 'Inter, sans-serif',
      fontSizeScale: options.fontSizeScale ?? 1.0,
      dpiScale: 1,
      reduceMotion: options.reduceMotion ?? false,
      isAmbientMode: options.isAmbientMode ?? false,
      isOverlayMode: options.isOverlayMode ?? false,
      didSeekThisFrame: false,
    };

    this.boundTick = (nowMs: number) => {
      this.rafId = null;
      if (!this.running || this.locked || this.disposed) return;
      this.renderFrame(nowMs);
      if (this.running && !this.locked && !this.disposed) {
        this.scheduleNextFrame();
      }
    };
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

  setStyle(styleId: VisualStyleId): void {
    if (this.styleId === styleId) return;
    this.styleId = this.registry.has(styleId) ? styleId : 'AppleMusicFlow';
    this.registry.get(this.styleId).reset?.();
  }

  setLyrics(lyrics: Lyrics | null): void {
    this.frameContext.lyrics = lyrics;
    this.frameContext.layout = null;
    this.measurer.invalidate();
  }

  setPalette(palette: LyricPalette): void {
    this.frameContext.palette = palette;
  }

  setTypography(fontFamily: string, fontSizeScale: number): void {
    this.frameContext.fontFamily = fontFamily;
    this.frameContext.fontSizeScale = Math.max(0.5, Math.min(2.5, fontSizeScale));
  }

  setModes(modes: {
    reduceMotion?: boolean;
    isAmbientMode?: boolean;
    isOverlayMode?: boolean;
    audioReactive?: boolean;
  }): void {
    if (modes.reduceMotion !== undefined) this.frameContext.reduceMotion = modes.reduceMotion;
    if (modes.isAmbientMode !== undefined) this.frameContext.isAmbientMode = modes.isAmbientMode;
    if (modes.isOverlayMode !== undefined) this.frameContext.isOverlayMode = modes.isOverlayMode;
    if (modes.audioReactive !== undefined) this.audioReactive = modes.audioReactive;
  }

  setSyncState(state: LyricStageFrameInput): void {
    this.frameContext.timeSeconds = state.timeSeconds;
    this.frameContext.activeLineIndex = state.activeLineIndex;
    this.frameContext.activeWordIndex = state.activeWordIndex;
    this.frameContext.wordProgress = state.wordProgress;
    this.frameContext.lineFadeAlpha = state.lineFadeAlpha ?? 1;
    this.frameContext.didSeekThisFrame = Boolean(state.didSeekThisFrame);
  }

  setAudioMetrics(audio: Partial<AudioFrameMetrics>): void {
    if (audio.rmsLevel !== undefined) this.audioMetrics.rmsLevel = audio.rmsLevel;
    if (audio.bassEnergy !== undefined) this.audioMetrics.bassEnergy = audio.bassEnergy;
    if (audio.midEnergy !== undefined) this.audioMetrics.midEnergy = audio.midEnergy;
    if (audio.trebleEnergy !== undefined) this.audioMetrics.trebleEnergy = audio.trebleEnergy;
    if (audio.beatDetected !== undefined) this.audioMetrics.beatDetected = audio.beatDetected;
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
  }

  start(): void {
    if (this.disposed || this.running) return;
    this.running = true;
    this.lastFrameMs = 0;
    if (!this.locked) {
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
      }
    }

    if (!this.audioReactive) {
      this.audioMetrics.rmsLevel = 0;
      this.audioMetrics.bassEnergy = 0;
      this.audioMetrics.midEnergy = 0;
      this.audioMetrics.trebleEnergy = 0;
      this.audioMetrics.beatDetected = false;
    }

    // Cached layout measurement (0 allocations when lyrics/size/font unchanged)
    this.frameContext.layout = this.measurer.measure(
      this.ctx,
      this.frameContext.lyrics,
      this.width,
      this.height,
      this.frameContext.fontFamily,
      this.frameContext.fontSizeScale
    );

    const style = this.registry.get(this.styleId);

    // 1. Optional WebGL2 effect layer
    if (this.webGlLayer) {
      if (style.webGlEffect === 'none' || this.frameContext.isOverlayMode) {
        this.webGlLayer.clear();
      } else {
        this.webGlParams.timeSeconds = this.frameContext.timeSeconds;
        this.webGlParams.rmsLevel = this.audioMetrics.rmsLevel;
        this.webGlParams.bassEnergy = this.audioMetrics.bassEnergy;
        this.webGlParams.midEnergy = this.audioMetrics.midEnergy;
        this.webGlParams.trebleEnergy = this.audioMetrics.trebleEnergy;
        this.webGlParams.beatDetected = this.audioMetrics.beatDetected;
        this.webGlParams.reduceMotion = this.frameContext.reduceMotion;
        this.webGlParams.isOverlayMode = this.frameContext.isOverlayMode;
        this.webGlParams.bgDeepHex = this.frameContext.palette.bgDeep;
        this.webGlParams.bgMidHex = this.frameContext.palette.bgMid;
        this.webGlParams.accentPrimaryHex = this.frameContext.palette.accentPrimary;
        this.webGlParams.accentSecondaryHex = this.frameContext.palette.accentSecondary;
        this.webGlLayer.render(style.webGlEffect, this.webGlParams);
      }
    }

    // 2. Clear Canvas2D transparently (critical for Overlay mode & WebGL2 compositing)
    this.ctx.clearRect(0, 0, this.width, this.height);

    // 3. Optional 3D Starfield + Ship scene (StarfieldShip3D)
    if (style.usesShip3D) {
      this.ship3dScene.render(
        this.ctx,
        this.width,
        this.height,
        this.frameContext.timeSeconds,
        this.frameContext.deltaSeconds,
        this.audioMetrics,
        this.frameContext.palette,
        this.frameContext.reduceMotion,
        this.frameContext.isOverlayMode
      );
    }

    // 4. Render active visual style
    style.render(
      this.ctx,
      this.frameContext as StyleFrameContext,
      this.width,
      this.height
    );

    this.frameContext.didSeekThisFrame = false;
    return true;
  }

  // Click-to-seek hit-testing against current measured layout
  findLineAtPoint(x: number, y: number): number | null {
    const layout = this.frameContext.layout;
    if (!layout || layout.lines.length === 0) return null;
    if (x < 0 || x > this.width || y < 0 || y > this.height) return null;

    const activeIdx = Math.max(
      0,
      Math.min(layout.lines.length - 1, this.frameContext.activeLineIndex)
    );
    const activeLine = layout.lines[activeIdx];
    const anchorY = this.height * (this.frameContext.isOverlayMode ? 0.52 : 0.46);
    const scrollY = activeLine.y + activeLine.height * 0.5;
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
    this.registry.disposeAll();
    this.webGlLayer?.dispose();
    this.measurer.invalidate();
  }
}
