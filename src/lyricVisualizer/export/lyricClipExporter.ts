// src/lyricVisualizer/export/lyricClipExporter.ts
// Creator Studio Clip Exporter & Style Preset JSON Serializer/Validator.
// Preset & crop helpers are 100% pure TypeScript so Node unit tests run without DOM globals.

import {
  BUNDLED_FONTS,
  DEFAULT_IOS_KINETIC_ZOOM,
  DEFAULT_LYRIC_VISUALIZER_CONFIG,
  mapLegacyStyleIdModel,
  MAX_IOS_KINETIC_ZOOM,
  MIN_IOS_KINETIC_ZOOM,
  resolveStyleVariationId,
  VISUAL_STYLE_DEFINITIONS,
  type BundledFontId,
  type LyricVisualizerConfig,
  type MapScenePreference,
  type MapTimePreference,
  type MotionIntensity,
  type VisualStyleId,
} from '../core/models';

export type ClipAspectRatio = '9:16' | '16:9';
export type ClipDurationSec = 10 | 15 | 30;

export interface ClipCropRect {
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
  readonly outW: number;
  readonly outH: number;
}

export interface StageCanvasSources {
  readonly webGlCanvas?: HTMLCanvasElement | null;
  readonly shipCanvas?: HTMLCanvasElement | null;
  readonly canvas2d?: HTMLCanvasElement | null;
}

export interface ClipExportResult {
  readonly blob: Blob;
  readonly objectUrl: string;
  readonly mimeType: string;
  readonly durationSec: number;
  readonly width: number;
  readonly height: number;
}

export interface LyricClipExporterOptions {
  readonly getStageCanvases: () => StageCanvasSources;
  readonly aspectRatio: ClipAspectRatio;
  readonly durationSec?: ClipDurationSec | number;
  readonly audioStream?: MediaStream | null;
  readonly registerSyncCompositeHook?: (cb: (() => void) | null) => void;
  readonly fps?: number;
  readonly onProgress?: (elapsedSec: number, totalSec: number, percent: number) => void;
}

export interface StylePresetConfigFields {
  readonly styleId: VisualStyleId;
  readonly variationByStyle: Partial<Record<VisualStyleId, string>>;
  readonly fontId: BundledFontId;
  readonly iosKineticPopup: boolean;
  readonly iosKineticZoom: number;
  readonly mapScene: MapScenePreference;
  readonly mapTimeOfDay: MapTimePreference;
  readonly beatCameraThump: boolean;
  readonly motionIntensity: MotionIntensity;
  readonly backgroundOpacity: number;
  readonly vignetteStrength: number;
  readonly wordIconsEnabled: boolean;
}

export interface StylePresetPayload {
  readonly schemaVersion: 1;
  readonly kind: 'waveform-lyric-style-preset';
  readonly exportedAt: string;
  readonly config: StylePresetConfigFields;
}

const VALID_STYLE_VARIATIONS: Readonly<Record<VisualStyleId, readonly string[]>> = {
  AppleMusicFlow: ['classic-flow', 'karaoke-stage'],
  Editorial: ['swiss-minimal', 'typewriter'],
  LiquidMetal: ['obsidian-chrome', 'holo-vaporwave', 'mercury-album-tint'],
  GenerativeParticleInk: ['pure-ink', 'spectrum-ribbon', 'ink-ribbon-hybrid'],
  Spatial3DDepth: ['depth-rings', 'glass-planes', 'horizon-grid'],
  CRTScanline: ['p31-green', 'p3-amber', 'trinitron-rgb'],
  StarfieldShip3D: ['deep-space', 'nebula-run', 'retro-wireframe'],
  IosTextingMotion: ['messages', 'group-chat', 'navigation-map'],
  CodeEditorKinetic: [
    'ide-macro',
    'led-stage-matrix',
    'clockwork-orbit',
    'clean-dark-ide',
    'codestyle-visual',
  ],
  MotionGeometry: ['constellation', 'branches', 'web'],
  SolariSplitFlap: ['departure-matte', 'amber-terminal'],
  StudioDawTimeline: ['ableton-dark', 'logic-glass'],
};

const ALL_VISUAL_STYLE_KEYS = Object.keys(VALID_STYLE_VARIATIONS) as readonly VisualStyleId[];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidVisualStyleId(value: unknown): value is VisualStyleId {
  return typeof value === 'string' && ALL_VISUAL_STYLE_KEYS.some((id) => id === value);
}

function isValidFontId(value: unknown): value is BundledFontId {
  return typeof value === 'string' && BUNDLED_FONTS.some((f) => f.id === value);
}

function isValidMapScene(value: unknown): value is MapScenePreference {
  return value === 'auto' || value === 'cityscape' || value === 'highway' || value === 'countryside';
}

function isValidMapTimeOfDay(value: unknown): value is MapTimePreference {
  return value === 'auto' || value === 'night' || value === 'sunset' || value === 'day';
}

function isValidMotionIntensity(value: unknown): value is MotionIntensity {
  return value === 'subtle' || value === 'normal' || value === 'vivid';
}

function clampFinite(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Number(Math.max(min, Math.min(max, value)).toFixed(3));
}

function sanitizeVariationByStyle(raw: unknown): Partial<Record<VisualStyleId, string>> {
  const clean: Partial<Record<VisualStyleId, string>> = {};
  if (!isPlainObject(raw)) return clean;

  for (let i = 0; i < ALL_VISUAL_STYLE_KEYS.length; i++) {
    const styleId = ALL_VISUAL_STYLE_KEYS[i];
    const candidate = raw[styleId];
    if (typeof candidate !== 'string') continue;
    const def = VISUAL_STYLE_DEFINITIONS.find((d) => d.id === styleId);
    const allowedVariations = def ? def.variations.map((v) => v.id) : VALID_STYLE_VARIATIONS[styleId];
    if (allowedVariations.includes(candidate)) {
      clean[styleId] = candidate;
    } else {
      clean[styleId] = resolveStyleVariationId(styleId, raw as Record<string, string | undefined>);
    }
  }
  return clean;
}

/**
 * Computes exact center-crop ("cover") coordinates from source canvas dimensions
 * into either 720x1280 (9:16 vertical) or 1280x720 (16:9 widescreen).
 */
export function computeClipCropRect(
  srcW: number,
  srcH: number,
  aspect: ClipAspectRatio
): ClipCropRect {
  const outW = aspect === '9:16' ? 720 : 1280;
  const outH = aspect === '9:16' ? 1280 : 720;

  const safeSrcW = Math.max(1, Number.isFinite(srcW) && srcW > 0 ? srcW : outW);
  const safeSrcH = Math.max(1, Number.isFinite(srcH) && srcH > 0 ? srcH : outH);

  const targetAspect = outW / outH;
  const srcAspect = safeSrcW / safeSrcH;

  let sx = 0;
  let sy = 0;
  let sw = safeSrcW;
  let sh = safeSrcH;

  if (srcAspect > targetAspect) {
    sh = safeSrcH;
    sw = safeSrcH * targetAspect;
    sx = (safeSrcW - sw) * 0.5;
    sy = 0;
  } else {
    sw = safeSrcW;
    sh = safeSrcW / targetAspect;
    sx = 0;
    sy = (safeSrcH - sh) * 0.5;
  }

  return { sx, sy, sw, sh, outW, outH };
}

/**
 * Serializes creator style/motion/map/icon config fields into a portable preset JSON string.
 */
export function exportStylePresetJson(config: LyricVisualizerConfig): string {
  const payload: StylePresetPayload = {
    schemaVersion: 1,
    kind: 'waveform-lyric-style-preset',
    exportedAt: new Date().toISOString(),
    config: {
      styleId: isValidVisualStyleId(config.styleId)
        ? config.styleId
        : DEFAULT_LYRIC_VISUALIZER_CONFIG.styleId,
      variationByStyle: sanitizeVariationByStyle(config.variationByStyle),
      fontId: isValidFontId(config.fontId)
        ? config.fontId
        : DEFAULT_LYRIC_VISUALIZER_CONFIG.fontId,
      iosKineticPopup: Boolean(config.iosKineticPopup),
      iosKineticZoom: clampFinite(
        config.iosKineticZoom,
        MIN_IOS_KINETIC_ZOOM,
        MAX_IOS_KINETIC_ZOOM,
        DEFAULT_IOS_KINETIC_ZOOM
      ),
      mapScene: isValidMapScene(config.mapScene)
        ? config.mapScene
        : DEFAULT_LYRIC_VISUALIZER_CONFIG.mapScene,
      mapTimeOfDay: isValidMapTimeOfDay(config.mapTimeOfDay)
        ? config.mapTimeOfDay
        : DEFAULT_LYRIC_VISUALIZER_CONFIG.mapTimeOfDay,
      beatCameraThump: Boolean(config.beatCameraThump),
      motionIntensity: isValidMotionIntensity(config.motionIntensity)
        ? config.motionIntensity
        : 'normal',
      backgroundOpacity: clampFinite(
        config.backgroundOpacity,
        0.2,
        1.0,
        DEFAULT_LYRIC_VISUALIZER_CONFIG.backgroundOpacity
      ),
      vignetteStrength: clampFinite(
        config.vignetteStrength,
        0.0,
        1.0,
        DEFAULT_LYRIC_VISUALIZER_CONFIG.vignetteStrength
      ),
      wordIconsEnabled: Boolean(config.wordIconsEnabled),
    },
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Strictly parses & validates a style preset JSON string into Partial<LyricVisualizerConfig>.
 */
export function parseStylePresetJson(rawJson: string): Partial<LyricVisualizerConfig> {
  if (typeof rawJson !== 'string' || !rawJson.trim()) {
    throw new Error('Preset JSON must be a non-empty string.');
  }

  const parsed: unknown = JSON.parse(rawJson);
  if (!isPlainObject(parsed)) {
    throw new Error('Preset JSON root must be an object.');
  }

  const source: Record<string, unknown> = isPlainObject(parsed.config) ? parsed.config : parsed;
  const out: {
    styleId?: VisualStyleId;
    variationByStyle?: Partial<Record<VisualStyleId, string>>;
    fontId?: BundledFontId;
    iosKineticPopup?: boolean;
    iosKineticZoom?: number;
    mapScene?: MapScenePreference;
    mapTimeOfDay?: MapTimePreference;
    beatCameraThump?: boolean;
    motionIntensity?: MotionIntensity;
    backgroundOpacity?: number;
    vignetteStrength?: number;
    wordIconsEnabled?: boolean;
  } = {};

  if (isValidVisualStyleId(source.styleId)) {
    out.styleId = source.styleId;
  } else if (
    source.styleId === 'FisheyeKinetic' ||
    source.styleId === 'BrutalistZine' ||
    source.styleId === 'KaraokeStage' ||
    source.styleId === 'MinimalSwiss' ||
    source.styleId === 'TypewriterEditorial' ||
    source.styleId === 'NeonKinetic' ||
    source.styleId === 'HoloVaporwave' ||
    source.styleId === 'SpectrumRibbon'
  ) {
    out.styleId = mapLegacyStyleIdModel(source.styleId);
  }
  if ('variationByStyle' in source && isPlainObject(source.variationByStyle)) {
    out.variationByStyle = sanitizeVariationByStyle(source.variationByStyle);
  }
  if (
    typeof source.styleId === 'string' &&
    !isValidVisualStyleId(source.styleId) &&
    out.styleId
  ) {
    out.variationByStyle = {
      ...(out.variationByStyle ?? {}),
      [out.styleId]: resolveStyleVariationId(
        source.styleId,
        isPlainObject(source.variationByStyle)
          ? (source.variationByStyle as Record<string, string | undefined>)
          : undefined
      ),
    };
  }
  if (isValidFontId(source.fontId)) {
    out.fontId = source.fontId;
  }
  if (typeof source.iosKineticPopup === 'boolean') {
    out.iosKineticPopup = source.iosKineticPopup;
  }
  if (typeof source.iosKineticZoom === 'number' && Number.isFinite(source.iosKineticZoom)) {
    out.iosKineticZoom = clampFinite(
      source.iosKineticZoom,
      MIN_IOS_KINETIC_ZOOM,
      MAX_IOS_KINETIC_ZOOM,
      DEFAULT_IOS_KINETIC_ZOOM
    );
  }
  if (isValidMapScene(source.mapScene)) {
    out.mapScene = source.mapScene;
  }
  if (isValidMapTimeOfDay(source.mapTimeOfDay)) {
    out.mapTimeOfDay = source.mapTimeOfDay;
  }
  if (typeof source.beatCameraThump === 'boolean') {
    out.beatCameraThump = source.beatCameraThump;
  }
  if (isValidMotionIntensity(source.motionIntensity)) {
    out.motionIntensity = source.motionIntensity;
  }
  if (typeof source.backgroundOpacity === 'number' && Number.isFinite(source.backgroundOpacity)) {
    out.backgroundOpacity = clampFinite(
      source.backgroundOpacity,
      0.2,
      1.0,
      DEFAULT_LYRIC_VISUALIZER_CONFIG.backgroundOpacity
    );
  }
  if (typeof source.vignetteStrength === 'number' && Number.isFinite(source.vignetteStrength)) {
    out.vignetteStrength = clampFinite(
      source.vignetteStrength,
      0.0,
      1.0,
      DEFAULT_LYRIC_VISUALIZER_CONFIG.vignetteStrength
    );
  }
  if (typeof source.wordIconsEnabled === 'boolean') {
    out.wordIconsEnabled = source.wordIconsEnabled;
  }

  return out;
}

const MIME_TYPE_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
] as const;

function pickSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'video/webm';
  if (typeof MediaRecorder.isTypeSupported !== 'function') return 'video/webm';
  for (let i = 0; i < MIME_TYPE_CANDIDATES.length; i++) {
    const candidate = MIME_TYPE_CANDIDATES[i];
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return 'video/webm';
}

export class LyricClipExporter {
  private readonly options: LyricClipExporterOptions;
  private readonly totalSec: number;
  private readonly fps: number;
  private readonly outW: number;
  private readonly outH: number;

  private captureCanvas: HTMLCanvasElement | null = null;
  private captureCtx: CanvasRenderingContext2D | null = null;
  private recorder: MediaRecorder | null = null;
  private captureStream: MediaStream | null = null;
  private rafId: number | null = null;
  private progressTimerId: ReturnType<typeof setInterval> | null = null;

  private startedAtMs = 0;
  private running = false;
  private cancelled = false;
  private stopRequested = false;
  private rejectPending: ((reason?: unknown) => void) | null = null;

  constructor(options: LyricClipExporterOptions) {
    this.options = options;
    const rawDuration = options.durationSec ?? 15;
    this.totalSec = Math.max(1, Math.min(60, Number.isFinite(rawDuration) ? rawDuration : 15));
    this.fps = Math.max(15, Math.min(60, options.fps ?? 60));
    this.outW = options.aspectRatio === '9:16' ? 720 : 1280;
    this.outH = options.aspectRatio === '9:16' ? 1280 : 720;
  }

  private compositeFrame = (): void => {
    if (!this.running || this.cancelled || !this.captureCtx) return;

    const sources = this.options.getStageCanvases();
    const { webGlCanvas, shipCanvas, canvas2d } = sources;

    const ctx = this.captureCtx;
    ctx.save();
    ctx.fillStyle = '#06070c';
    ctx.fillRect(0, 0, this.outW, this.outH);

    // Draw layers in strict stage Z-order: WebGL backdrop -> 3D Ship -> Canvas2D lyrics
    const layers: (HTMLCanvasElement | null | undefined)[] = [webGlCanvas, shipCanvas, canvas2d];
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (!layer || layer.width <= 0 || layer.height <= 0) continue;
      const crop = computeClipCropRect(layer.width, layer.height, this.options.aspectRatio);
      try {
        ctx.drawImage(
          layer,
          crop.sx,
          crop.sy,
          crop.sw,
          crop.sh,
          0,
          0,
          this.outW,
          this.outH
        );
      } catch {
        // Ignore transient unready canvas frames cleanly
      }
    }
    ctx.restore();
  };

  private cleanup(): void {
    this.running = false;
    this.options.registerSyncCompositeHook?.(null);

    if (this.rafId !== null && typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.progressTimerId !== null) {
      clearInterval(this.progressTimerId);
      this.progressTimerId = null;
    }
    if (this.captureStream) {
      const tracks = this.captureStream.getVideoTracks();
      for (let i = 0; i < tracks.length; i++) {
        try {
          tracks[i].stop();
        } catch {
          // ignore
        }
      }
      this.captureStream = null;
    }
    this.recorder = null;
    this.captureCanvas = null;
    this.captureCtx = null;
    this.rejectPending = null;
  }

  stopEarly(): void {
    if (!this.running || this.stopRequested || this.cancelled) return;
    this.stopRequested = true;
    if (this.recorder && this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop();
      } catch {
        // ignore
      }
    }
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    const rec = this.recorder;
    const rejectPending = this.rejectPending;
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop();
        return;
      } catch {
        // fall through to synchronous cleanup & rejection
      }
    }
    this.cleanup();
    rejectPending?.(new Error('Clip export cancelled.'));
  }

  start(): Promise<ClipExportResult> {
    if (
      typeof document === 'undefined' ||
      typeof MediaRecorder === 'undefined' ||
      typeof MediaStream === 'undefined'
    ) {
      return Promise.reject(
        new Error('Clip recording requires a browser environment with Canvas and MediaRecorder.')
      );
    }

    if (this.running) {
      return Promise.reject(new Error('Clip export is already running.'));
    }

    const canvas = document.createElement('canvas');
    canvas.width = this.outW;
    canvas.height = this.outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return Promise.reject(new Error('Unable to acquire 2D capture context for clip export.'));
    }

    this.captureCanvas = canvas;
    this.captureCtx = ctx;
    this.running = true;
    this.cancelled = false;
    this.stopRequested = false;

    const videoStream = canvas.captureStream(this.fps);
    const combinedStream = new MediaStream();
    for (const vt of videoStream.getVideoTracks()) {
      combinedStream.addTrack(vt);
    }
    const audioTracks = this.options.audioStream?.getAudioTracks() ?? [];
    for (const at of audioTracks) {
      combinedStream.addTrack(at);
    }
    this.captureStream = combinedStream;

    const mimeType = pickSupportedMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: 6_500_000,
        audioBitsPerSecond: 192_000,
      });
    } catch {
      recorder = new MediaRecorder(combinedStream);
    }
    this.recorder = recorder;

    const chunks: BlobPart[] = [];
    this.startedAtMs =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();

    // Perform an immediate initial composite so frame 0 is never black
    this.compositeFrame();

    const useSyncHook = typeof this.options.registerSyncCompositeHook === 'function';
    if (useSyncHook) {
      this.options.registerSyncCompositeHook?.(this.compositeFrame);
    } else if (typeof globalThis.requestAnimationFrame === 'function') {
      const tick = () => {
        if (!this.running || this.cancelled) return;
        this.compositeFrame();
        this.rafId = globalThis.requestAnimationFrame(tick);
      };
      this.rafId = globalThis.requestAnimationFrame(tick);
    }

    return new Promise<ClipExportResult>((resolve, reject) => {
      this.rejectPending = reject;
      recorder.ondataavailable = (evt: BlobEvent) => {
        if (evt.data && evt.data.size > 0) {
          chunks.push(evt.data);
        }
      };

      recorder.onerror = () => {
        const wasCancelled = this.cancelled;
        this.cleanup();
        reject(new Error(wasCancelled ? 'Clip export cancelled.' : 'MediaRecorder error during clip export.'));
      };

      recorder.onstop = () => {
        const nowMs =
          typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
        const actualDurationSec = Math.max(0.1, (nowMs - this.startedAtMs) / 1000);
        const wasCancelled = this.cancelled;
        const resolvedMime = recorder.mimeType || mimeType;
        this.cleanup();

        if (wasCancelled) {
          reject(new Error('Clip export cancelled.'));
          return;
        }

        const blob = new Blob(chunks, { type: resolvedMime });
        const objectUrl =
          typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
            ? URL.createObjectURL(blob)
            : '';

        this.options.onProgress?.(
          Math.min(this.totalSec, actualDurationSec),
          this.totalSec,
          this.stopRequested ? 100 : Math.min(100, Math.round((actualDurationSec / this.totalSec) * 100))
        );

        resolve({
          blob,
          objectUrl,
          mimeType: resolvedMime,
          durationSec: Number(actualDurationSec.toFixed(2)),
          width: this.outW,
          height: this.outH,
        });
      };

      this.progressTimerId = setInterval(() => {
        if (!this.running || this.cancelled) return;
        const nowMs =
          typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
        const elapsedSec = Math.max(0, (nowMs - this.startedAtMs) / 1000);
        const pct = Math.min(100, Math.round((elapsedSec / this.totalSec) * 100));
        this.options.onProgress?.(Math.min(this.totalSec, elapsedSec), this.totalSec, pct);

        if (elapsedSec >= this.totalSec && !this.stopRequested) {
          this.stopEarly();
        }
      }, 60);

      recorder.start(250);
    });
  }
}

export interface SaveClipResult {
  readonly saved: boolean;
  readonly canceled?: boolean;
  readonly filePath?: string;
}

interface ElectronSaveClipWindow {
  electronAPI?: {
    lvSaveClipFile?: (payload: { defaultName: string; bytes: Uint8Array }) => Promise<SaveClipResult | void>;
  };
}

/**
 * Saves an exported video clip via Electron native save dialog when available,
 * falling back to an anchor download in standard browser contexts.
 */
export async function saveClipBlob(
  blob: Blob,
  defaultFileName: string
): Promise<SaveClipResult> {
  const safeName = defaultFileName.trim() || 'waveform-lyric-clip.webm';
  const win = typeof window !== 'undefined' ? (window as unknown as ElectronSaveClipWindow) : undefined;
  const lvSave = win?.electronAPI?.lvSaveClipFile;

  if (typeof lvSave === 'function') {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const res = await lvSave({ defaultName: safeName, bytes });
    if (res && typeof res === 'object' && 'saved' in res) {
      return res;
    }
    return { saved: true };
  }

  if (typeof document !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }, 1500);
    return { saved: true };
  }

  return { saved: false };
}
