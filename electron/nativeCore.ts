import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

export interface NativeAutoEqFilter {
  type: 'PEAKING' | 'LOW_SHELF' | 'HIGH_SHELF' | 'LOW_PASS' | 'HIGH_PASS' | 'BAND_PASS';
  freq: number;
  q: number;
  gainDb: number;
}

export interface NativeAutoEqStatus {
  ready: boolean;
  count: number;
  totalRows: number;
  parametricRows: number;
  totalCount: number;
  parametricCount: number;
  dbPath: string | null;
  loadTimeMs: number;
  error: string | null;
}

export interface NativeAutoEqSearchResult {
  id: number;
  name: string;
  meta: string;
  parametric: boolean;
  rig: string;
}

export interface NativeAutoEqProfile {
  id: string;
  dbId: number;
  name: string;
  source: string;
  meta: string;
  parametric: boolean;
  preampGainDb: number;
  filters: NativeAutoEqFilter[];
}

export interface NativeCachedTrackInput {
  localFilePath: string;
  mtimeMs: number;
  size: number;
}

export interface NativeIncrementalScanResult {
  folders: string[];
  tracks: any[];
  unchangedPaths: string[];
  added: number;
  updated: number;
  removed: number;
}

export interface NativeBpmState {
  rollingEnergy: number;
  rollingFlux: number;
  lastOnsetMs: number;
  clockMs: number;
  beatStrength: number;
  estimatedBpm: number;
  intervalsMs: number[];
}

export interface NativeAudioFrameAnalysis {
  spectrum32: number[];
  magnitudes: number[];
  rms: number;
  bass: number;
  mid: number;
  treble: number;
  spectralFlux: number;
  isBeat: boolean;
  beatStrength: number;
  estimatedBpm: number;
  bpmState: NativeBpmState;
}

export interface NativeOnnxStatus {
  ortLoaded: boolean;
  ortDylibPath: string | null;
  beatModelLoaded: boolean;
  beatModelPath: string | null;
  beatModelValid: boolean;
  beatModelBytes: number;
  vocalsModelLoaded: boolean;
  vocalsModelPath: string | null;
  vocalsModelValid: boolean;
  vocalsModelBytes: number;
  error: string | null;
}

export interface NativeBeatInferenceResult {
  usedOnnx: boolean;
  beatProbabilities: number[];
  downbeatProbabilities: number[];
  beatTimesSec: number[];
  downbeatTimesSec: number[];
  estimatedBpm: number;
  error: string | null;
}

export interface NativeVocalsMaskResult {
  usedOnnx: boolean;
  targetMagnitude: number[];
  channels: number;
  freqBins: number;
  timeFrames: number;
  error: string | null;
}

export interface NativeCoreBindings {
  nativeCoreVersion(): string;
  autoeqInit(candidatePaths?: string[]): NativeAutoEqStatus;
  autoeqStatus(): NativeAutoEqStatus;
  autoeqSearch(query: string, limit?: number): NativeAutoEqSearchResult[];
  autoeqFindProfile(nameOrId: string | number): NativeAutoEqProfile | null;
  scanFolderMetadata(folderPath: string, userDataPath: string): Promise<any[]>;
  scanLocalFoldersIncremental(
    folders: string[],
    userDataPath: string,
    cachedEntries?: NativeCachedTrackInput[]
  ): Promise<NativeIncrementalScanResult>;
  computeBiquadMagnitudeDb(
    filters: NativeAutoEqFilter[],
    freqs: number[],
    sampleRate?: number,
    preampDb?: number
  ): number[];
  computeSvfEqMagnitudeDb(
    bands10: number[],
    freqs: number[],
    sampleRate?: number,
    toneBassDb?: number,
    toneTrebleDb?: number
  ): number[];
  analyzeAudioFrame(
    pcmSamples: Float32Array,
    sampleRate?: number,
    prevMagnitudes?: Float32Array,
    bpmState?: NativeBpmState
  ): NativeAudioFrameAnalysis;
  onnxInitModels(modelsDir?: string, ortDylibPath?: string): Promise<NativeOnnxStatus>;
  onnxStatus(): NativeOnnxStatus;
  onnxInferBeats(
    spectrogram: Float32Array,
    timeFrames: number,
    sampleRate?: number
  ): NativeBeatInferenceResult;
  onnxInferVocalsMask(
    mixMagnitude: Float32Array,
    frames?: number
  ): NativeVocalsMaskResult;
}

export interface NativeCoreInfo {
  loaded: boolean;
  path: string | null;
  version: string | null;
  error: string | null;
}

const NODE_BINARY_NAME = 'waveform-core.win32-x64-msvc.node';

let cachedCore: NativeCoreBindings | null = null;
let hasAttemptedLoad = false;
let loadedPath: string | null = null;
let loadError: string | null = null;

function resolveCandidatePaths(): string[] {
  const override = process.env.WAVEFORM_NATIVE_CORE_PATH;
  if (override && override.trim().toLowerCase() === 'disabled') {
    return [];
  }

  const candidates: string[] = [];
  if (override && override.trim().length > 0) {
    candidates.push(path.resolve(override.trim()));
  }

  const resourcesPath = (process as any).resourcesPath as string | undefined;
  if (resourcesPath) {
    candidates.push(
      path.resolve(
        resourcesPath,
        'app.asar.unpacked',
        'native',
        'waveform-core',
        NODE_BINARY_NAME
      )
    );
  }

  candidates.push(
    path.resolve(__dirname, '../native/waveform-core', NODE_BINARY_NAME),
    path.resolve(process.cwd(), 'native/waveform-core', NODE_BINARY_NAME)
  );

  return Array.from(new Set(candidates));
}

export function getNativeCore(): NativeCoreBindings | null {
  const override = process.env.WAVEFORM_NATIVE_CORE_PATH;
  if (override && override.trim().toLowerCase() === 'disabled') {
    cachedCore = null;
    loadedPath = null;
    loadError = 'disabled via WAVEFORM_NATIVE_CORE_PATH';
    hasAttemptedLoad = true;
    return null;
  }

  if (hasAttemptedLoad) {
    return cachedCore;
  }
  hasAttemptedLoad = true;

  const candidates = resolveCandidatePaths();
  let lastErr: string | null = null;

  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) {
        continue;
      }
      const mod = require(candidate) as NativeCoreBindings;
      if (mod && typeof mod.nativeCoreVersion === 'function') {
        cachedCore = mod;
        loadedPath = candidate;
        loadError = null;
        return cachedCore;
      }
    } catch (err: any) {
      lastErr = err?.message || String(err);
    }
  }

  cachedCore = null;
  loadedPath = null;
  loadError = lastErr || `Native core binary (${NODE_BINARY_NAME}) not found`;
  return null;
}

export function isNativeCoreLoaded(): boolean {
  return getNativeCore() !== null;
}

export function getNativeCoreInfo(): NativeCoreInfo {
  const core = getNativeCore();
  let version: string | null = null;
  if (core) {
    try {
      version = core.nativeCoreVersion();
    } catch {
      version = null;
    }
  }
  return {
    loaded: core !== null,
    path: loadedPath,
    version,
    error: loadError,
  };
}

export function resetNativeCoreForTests(): void {
  cachedCore = null;
  hasAttemptedLoad = false;
  loadedPath = null;
  loadError = null;
}
