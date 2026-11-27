// src/services/MlAudioService.ts
// Renderer bridge for bundled ONNX ML audio intelligence (Beat This! + Open-Unmix Vocals)
// with deterministic TypeScript fallbacks for tests and browser-only environments.

import { deriveBarsFromBeatAnalysis } from '../utils/practiceLoop';
import { getPlatformBridge, hasPlatformBridge } from '../platform/index';

export interface TimeRange {
  startSec: number;
  endSec: number;
}

export interface TrackBeatAnalysis {
  usedOnnx: boolean;
  bpm: number;
  beats: number[];
  downbeats: number[];
  bars?: number[];
  chorusStartSec: number;
  vocalSilenceRanges: TimeRange[];
  vocalEnvelope: number[];
  envelopeFps: number;
  durationSec: number;
  cached?: boolean;
  error?: string | null;
}

export interface VocalStemData {
  usedOnnx: boolean;
  vocalsLeft: Float32Array;
  vocalsRight: Float32Array;
  sampleRate: number;
  cached?: boolean;
  error?: string | null;
}

export interface LyricAutoSyncResult {
  offsetMs: number;
  confidence: number;
}

function getElectronApi(): any | null {
  return hasPlatformBridge() ? getPlatformBridge() : null;
}

/**
 * Pure TypeScript fallback for lyric timing cross-correlation against vocal activity envelope.
 * Returns offsetMs where positive values delay lyrics (audioTime ~= lyricTime + offsetMs).
 */
export function estimateLyricOffsetMsFallback(
  vocalEnvelope: ArrayLike<number>,
  envelopeFps = 10,
  lineStartTimesSec: readonly number[] = []
): LyricAutoSyncResult {
  const n = vocalEnvelope?.length ?? 0;
  const fps = Number.isFinite(envelopeFps) && envelopeFps > 0 ? envelopeFps : 10;
  if (n < 4 || !Array.isArray(lineStartTimesSec) || lineStartTimesSec.length === 0) {
    return { offsetMs: 0, confidence: 0 };
  }

  const starts = lineStartTimesSec
    .filter((t) => Number.isFinite(t) && t >= 0)
    .slice()
    .sort((a, b) => a - b);
  if (starts.length === 0) {
    return { offsetMs: 0, confidence: 0 };
  }

  const env = new Float64Array(n);
  const onset = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const raw = vocalEnvelope[i];
    const v = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
    env[i] = v;
    if (i >= 2) {
      onset[i] = Math.max(0, v - env[i - 2]);
    }
  }

  const durationSec = n / fps;
  const scoreOffset = (deltaMs: number): number => {
    const deltaSec = deltaMs / 1000;
    let total = 0;
    let weightSum = 0;
    for (let i = 0; i < starts.length; i++) {
      const sSec = starts[i];
      const next = i + 1 < starts.length ? starts[i + 1] : sSec + 2.0;
      const dur = Math.max(0.4, Math.min(4.0, next - sSec));
      const shiftedStart = sSec + deltaSec;
      const shiftedEnd = shiftedStart + dur;
      if (shiftedEnd < 0 || shiftedStart >= durationSec) continue;

      const startF = Math.max(0, Math.min(n - 1, Math.round(shiftedStart * fps)));
      const endF = Math.max(startF + 1, Math.min(n, Math.round(shiftedEnd * fps)));
      let sumE = 0;
      for (let f = startF; f < endF; f++) {
        sumE += env[f] - 0.15;
      }
      const meanPresence = sumE / (endF - startF);

      const oLo = Math.max(0, startF - 2);
      const oHi = Math.min(n, startF + 3);
      let peakOnset = 0;
      for (let f = oLo; f < oHi; f++) {
        if (onset[f] > peakOnset) peakOnset = onset[f];
      }

      total += meanPresence + 0.55 * peakOnset;
      weightSum += 1;
    }
    return weightSum > 0 ? total / weightSum : -1;
  };

  let bestMs = 0;
  let bestScore = -Infinity;
  let scoreSum = 0;
  let count = 0;

  for (let ms = -12000; ms <= 12000; ms += 100) {
    const s = scoreOffset(ms);
    scoreSum += s;
    count++;
    const adjusted = s - Math.abs(ms) * 1e-6;
    if (adjusted > bestScore) {
      bestScore = adjusted;
      bestMs = ms;
    }
  }

  const fineMin = Math.max(-12000, bestMs - 150);
  const fineMax = Math.min(12000, bestMs + 150);
  for (let ms = fineMin; ms <= fineMax; ms += 25) {
    const adjusted = scoreOffset(ms) - Math.abs(ms) * 1e-6;
    if (adjusted > bestScore) {
      bestScore = adjusted;
      bestMs = ms;
    }
  }

  const meanScore = count > 0 ? scoreSum / count : 0;
  const margin = Math.max(0, bestScore - meanScore);
  const confidence = Math.round(Math.max(0, Math.min(1, margin / 0.35)) * 100) / 100;

  return {
    offsetMs: Math.max(-12000, Math.min(12000, bestMs)),
    confidence,
  };
}

async function decodeUrlToStereoPcm(
  audioUrl: string
): Promise<{ left: Float32Array; right: Float32Array; sampleRate: number } | null> {
  if (!audioUrl || typeof window === 'undefined') return null;
  const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtxClass) return null;

  let ctx: AudioContext | null = null;
  try {
    const resp = await fetch(audioUrl);
    if (!resp.ok) return null;
    const arrayBuf = await resp.arrayBuffer();
    if (arrayBuf.byteLength === 0) return null;

    ctx = new AudioCtxClass();
    const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
    const left = new Float32Array(decoded.getChannelData(0));
    const right =
      decoded.numberOfChannels > 1
        ? new Float32Array(decoded.getChannelData(1))
        : new Float32Array(left);
    return {
      left,
      right,
      sampleRate: decoded.sampleRate || 44100,
    };
  } catch {
    return null;
  } finally {
    if (ctx && typeof ctx.close === 'function') {
      void ctx.close().catch(() => {});
    }
  }
}

class MlAudioServiceImpl {
  private readonly beatCache = new Map<string, TrackBeatAnalysis>();
  private readonly inflightBeats = new Map<string, Promise<TrackBeatAnalysis | null>>();
  private readonly stemCache = new Map<string, VocalStemData>();
  private readonly inflightStems = new Map<string, Promise<VocalStemData | null>>();
  private activeStemTrackId: string | null = null;
  private readonly MAX_BEAT_CACHE_ENTRIES = 48;
  private readonly MAX_STEM_CACHE_ENTRIES = 2;

  private setBeatCacheEntry(trackId: string, analysis: TrackBeatAnalysis): void {
    if (this.beatCache.has(trackId)) this.beatCache.delete(trackId);
    this.beatCache.set(trackId, analysis);
    while (this.beatCache.size > this.MAX_BEAT_CACHE_ENTRIES) {
      const oldest = this.beatCache.keys().next().value;
      if (oldest === undefined) break;
      this.beatCache.delete(oldest);
    }
  }

  private setStemCacheEntry(trackId: string, data: VocalStemData): void {
    if (this.stemCache.has(trackId)) this.stemCache.delete(trackId);
    this.stemCache.set(trackId, data);
    while (this.stemCache.size > this.MAX_STEM_CACHE_ENTRIES) {
      const oldest = this.stemCache.keys().next().value;
      if (oldest === undefined) break;
      this.stemCache.delete(oldest);
    }
  }

  cancelPendingVocalSeparation(activeTrackId?: string | null): void {
    this.activeStemTrackId = activeTrackId ?? null;
  }

  getCachedTrackBeatsSync(trackId: string): TrackBeatAnalysis | null {
    return this.beatCache.get(trackId) ?? null;
  }

  getCachedVocalStemSync(trackId: string): VocalStemData | null {
    return this.stemCache.get(trackId) ?? null;
  }

  async getCachedTrackBeats(trackId: string): Promise<TrackBeatAnalysis | null> {
    if (!trackId) return null;
    const mem = this.beatCache.get(trackId);
    if (mem) return mem;

    const api = getElectronApi();
    if (!api?.mlAnalyzeTrackBeats) return null;
    try {
      const res = await api.mlAnalyzeTrackBeats({ trackId });
      if (res?.ok && Array.isArray(res.beats)) {
        const downbeats: number[] = Array.isArray(res.downbeats) ? res.downbeats : [];
        const parsed: TrackBeatAnalysis = {
          usedOnnx: Boolean(res.usedOnnx),
          bpm: Number(res.bpm) || 120,
          beats: res.beats,
          downbeats,
          bars: Array.isArray(res.bars) ? res.bars : deriveBarsFromBeatAnalysis(res.beats, downbeats),
          chorusStartSec: Number(res.chorusStartSec) || 0,
          vocalSilenceRanges: Array.isArray(res.vocalSilenceRanges) ? res.vocalSilenceRanges : [],
          vocalEnvelope: Array.isArray(res.vocalEnvelope) ? res.vocalEnvelope : [],
          envelopeFps: Number(res.envelopeFps) || 10,
          durationSec: Number(res.durationSec) || 0,
          cached: true,
          error: res.error ?? null,
        };
        this.setBeatCacheEntry(trackId, parsed);
        return parsed;
      }
    } catch {
      // Cache lookup miss
    }
    return null;
  }

  async analyzeTrackBeats(
    trackId: string,
    audioUrl?: string | null,
    pcm?: { left: Float32Array; right?: Float32Array; sampleRate: number }
  ): Promise<TrackBeatAnalysis | null> {
    if (!trackId) return null;
    const mem = this.beatCache.get(trackId);
    if (mem) return mem;

    const existing = this.inflightBeats.get(trackId);
    if (existing) return existing;

    const task = (async (): Promise<TrackBeatAnalysis | null> => {
      const diskCached = await this.getCachedTrackBeats(trackId);
      if (diskCached) return diskCached;

      const api = getElectronApi();
      if (!api?.mlAnalyzeTrackBeats) return null;

      let stereo = pcm
        ? { left: pcm.left, right: pcm.right ?? pcm.left, sampleRate: pcm.sampleRate }
        : null;
      if (!stereo && audioUrl) {
        stereo = await decodeUrlToStereoPcm(audioUrl);
      }
      if (!stereo || stereo.left.length === 0) return null;

      const res = await api.mlAnalyzeTrackBeats({
        trackId,
        leftPcm: stereo.left,
        rightPcm: stereo.right,
        sampleRate: stereo.sampleRate,
      });
      if (!res?.ok) return null;

      const freshBeats: number[] = Array.isArray(res.beats) ? res.beats : [];
      const freshDownbeats: number[] = Array.isArray(res.downbeats) ? res.downbeats : [];
      const parsed: TrackBeatAnalysis = {
        usedOnnx: Boolean(res.usedOnnx),
        bpm: Number(res.bpm) || 120,
        beats: freshBeats,
        downbeats: freshDownbeats,
        bars: Array.isArray(res.bars)
          ? res.bars
          : deriveBarsFromBeatAnalysis(freshBeats, freshDownbeats),
        chorusStartSec: Number(res.chorusStartSec) || 0,
        vocalSilenceRanges: Array.isArray(res.vocalSilenceRanges) ? res.vocalSilenceRanges : [],
        vocalEnvelope: Array.isArray(res.vocalEnvelope) ? res.vocalEnvelope : [],
        envelopeFps: Number(res.envelopeFps) || 10,
        durationSec: Number(res.durationSec) || 0,
        cached: Boolean(res.cached),
        error: res.error ?? null,
      };
      this.setBeatCacheEntry(trackId, parsed);
      return parsed;
    })();

    this.inflightBeats.set(trackId, task);
    try {
      return await task;
    } finally {
      this.inflightBeats.delete(trackId);
    }
  }

  async separateTrackVocals(
    trackId: string,
    audioUrl?: string | null,
    pcm?: { left: Float32Array; right: Float32Array; sampleRate: number }
  ): Promise<VocalStemData | null> {
    if (!trackId) return null;
    this.activeStemTrackId = trackId;
    const mem = this.stemCache.get(trackId);
    if (mem) return mem;

    const existing = this.inflightStems.get(trackId);
    if (existing) return existing;

    const task = (async (): Promise<VocalStemData | null> => {
      const api = getElectronApi();
      if (!api?.mlSeparateVocals) return null;

      // Try disk stem cache first
      try {
        const cachedRes = await api.mlSeparateVocals({ trackId });
        if (this.activeStemTrackId && this.activeStemTrackId !== trackId) return null;
        if (cachedRes?.ok && cachedRes.vocalsLeft?.length > 0) {
          const data: VocalStemData = {
            usedOnnx: Boolean(cachedRes.usedOnnx),
            vocalsLeft:
              cachedRes.vocalsLeft instanceof Float32Array
                ? cachedRes.vocalsLeft
                : Float32Array.from(cachedRes.vocalsLeft),
            vocalsRight:
              cachedRes.vocalsRight instanceof Float32Array
                ? cachedRes.vocalsRight
                : Float32Array.from(cachedRes.vocalsRight),
            sampleRate: Number(cachedRes.sampleRate) || 44100,
            cached: true,
          };
          this.setStemCacheEntry(trackId, data);
          return data;
        }
      } catch {
        // Ignore stem cache lookup failure
      }

      let stereo = pcm ?? null;
      if (!stereo && audioUrl) {
        stereo = await decodeUrlToStereoPcm(audioUrl);
      }
      if (this.activeStemTrackId && this.activeStemTrackId !== trackId) return null;
      if (!stereo || stereo.left.length === 0) return null;

      const res = await api.mlSeparateVocals({
        trackId,
        leftPcm: stereo.left,
        rightPcm: stereo.right,
        sampleRate: stereo.sampleRate,
      });
      if (this.activeStemTrackId && this.activeStemTrackId !== trackId) return null;
      if (!res?.ok || !res.vocalsLeft) return null;

      const data: VocalStemData = {
        usedOnnx: Boolean(res.usedOnnx),
        vocalsLeft:
          res.vocalsLeft instanceof Float32Array
            ? res.vocalsLeft
            : Float32Array.from(res.vocalsLeft),
        vocalsRight:
          res.vocalsRight instanceof Float32Array
            ? res.vocalsRight
            : Float32Array.from(res.vocalsRight),
        sampleRate: Number(res.sampleRate) || stereo.sampleRate,
        cached: Boolean(res.cached),
        error: res.error ?? null,
      };
      this.setStemCacheEntry(trackId, data);
      return data;
    })();

    this.inflightStems.set(trackId, task);
    try {
      return await task;
    } finally {
      this.inflightStems.delete(trackId);
    }
  }

  async autoSyncLyrics(
    vocalEnvelope: ArrayLike<number>,
    envelopeFps: number,
    lineStartTimesSec: readonly number[]
  ): Promise<LyricAutoSyncResult> {
    const api = getElectronApi();
    if (api?.mlAutoSyncLyrics) {
      try {
        const res = await api.mlAutoSyncLyrics({
          vocalEnvelope: Array.from(vocalEnvelope),
          envelopeFps,
          lineStartTimesSec: [...lineStartTimesSec],
        });
        if (res && Number.isFinite(res.offsetMs)) {
          return {
            offsetMs: res.offsetMs,
            confidence: Number.isFinite(res.confidence) ? res.confidence : 0,
          };
        }
      } catch {
        // Fallback to pure TypeScript implementation
      }
    }
    return estimateLyricOffsetMsFallback(vocalEnvelope, envelopeFps, lineStartTimesSec);
  }
}

export const MlAudioService = new MlAudioServiceImpl();
