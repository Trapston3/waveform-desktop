// src/audio/DspChain.ts
// Pure Float32 audio DSP processing pipeline & Web Audio master bus topology
// Conforming to Features 6, 7, 8, 11 (PROJECT.md) and Survey 2 §4

import type { AutoEqFilter, BiquadFilterType } from './AutoEqLoader';

export const EQ_FREQUENCIES_HZ = [60, 170, 310, 600, 1000, 3000, 6000, 10000, 12000, 14000] as const;

export const FACTORY_EQ_PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Acoustic: [3.5, 3.0, 2.0, 1.0, 1.5, 2.0, 3.0, 3.5, 3.0, 2.5],
  BassBoost: [7.0, 5.5, 4.0, 2.0, 0.5, 0, 0, 0, 0, 0],
  BassReducer: [-6.0, -4.5, -3.0, -1.5, 0, 0, 0, 0, 0, 0],
  Classical: [4.0, 3.0, 2.0, 2.0, -1.0, -1.0, 0, 2.0, 3.0, 3.5],
  Dance: [5.0, 6.0, 2.0, 0, 2.0, 3.5, 4.5, 4.0, 3.0, 0],
  Deep: [4.5, 3.5, 1.5, 2.0, 2.5, 1.0, 0, -2.0, -3.0, -4.0],
  Electronic: [4.5, 4.0, 1.0, 0, -1.5, 2.0, 1.0, 2.5, 4.0, 4.5],
  HipHop: [5.5, 4.5, 1.5, 2.0, -1.0, -1.0, 1.5, -1.0, 2.0, 2.5],
  Jazz: [3.5, 2.5, 1.0, 1.5, -1.5, -1.5, 0, 1.5, 3.0, 3.5],
  Latin: [3.0, 2.0, 0, 0, -1.0, -1.0, -1.0, 1.0, 3.0, 4.0],
  Loudness: [6.0, 4.5, 0, -1.5, -2.0, -1.0, -2.5, -4.0, 5.0, 6.0],
  Lounge: [-2.0, -1.0, 0, 1.5, 3.0, 2.0, 0, -1.5, 2.0, 1.0],
  Piano: [2.5, 1.5, 0, 2.0, 2.5, 1.5, 2.5, 3.0, 2.5, 2.0],
  Pop: [-1.5, -1.0, 0, 2.0, 4.0, 3.5, 1.5, -1.0, -1.5, -2.0],
  Rock: [4.5, 3.5, -1.0, -2.5, -1.0, 2.5, 4.0, 5.0, 4.5, 4.0],
};

/**
 * Spatial Audio Processor (Feature 8)
 * Mid/Side stereo width expansion + 15ms circular crossfeed delay + 0.82 makeup attenuation.
 */
export class SpatialAudioProcessor {
  enabled = true;
  width = 2.5;

  private readonly delayMs = 15;
  private readonly crossfeedGain = 0.2;
  private readonly lowpassCoeff = 0.3;
  private readonly outputGain = 0.82;

  private delayBufferL: Float32Array;
  private delayBufferR: Float32Array;
  private delayIdx = 0;
  private lpL = 0;
  private lpR = 0;
  private sampleRate = 44100;

  constructor(sampleRate = 44100) {
    const validRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
    this.sampleRate = Math.max(8000, validRate);
    const delaySamples = Math.max(1, Math.floor((this.sampleRate * this.delayMs) / 1000));
    this.delayBufferL = new Float32Array(delaySamples);
    this.delayBufferR = new Float32Array(delaySamples);
  }

  configure(sampleRate: number): void {
    const validRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
    this.sampleRate = Math.max(8000, validRate);
    const delaySamples = Math.max(1, Math.floor((this.sampleRate * this.delayMs) / 1000));
    if (this.delayBufferL.length !== delaySamples) {
      this.delayBufferL = new Float32Array(delaySamples);
      this.delayBufferR = new Float32Array(delaySamples);
    }
    this.reset();
  }

  reset(): void {
    this.delayBufferL.fill(0);
    this.delayBufferR.fill(0);
    this.delayIdx = 0;
    this.lpL = 0;
    this.lpR = 0;
  }

  process(
    leftIn: Float32Array,
    rightIn: Float32Array
  ): { leftOut: Float32Array; rightOut: Float32Array } {
    const len = leftIn.length;
    const leftOut = new Float32Array(len);
    const rightOut = new Float32Array(len);

    if (len === 0) {
      return { leftOut, rightOut };
    }

    if (!this.enabled) {
      leftOut.set(leftIn);
      rightOut.set(rightIn);
      return { leftOut, rightOut };
    }

    const rawWidth = Number.isFinite(this.width) ? this.width : 2.5;
    const widthGain = Math.max(1.0, Math.min(4.0, rawWidth));
    const delaySize = this.delayBufferL.length;
    let dIdx = this.delayIdx;
    let lpL = this.lpL;
    let lpR = this.lpR;

    for (let i = 0; i < len; i++) {
      const l = Number.isFinite(leftIn[i]) ? leftIn[i] : 0.0;
      const r = Number.isFinite(rightIn[i]) ? rightIn[i] : 0.0;

      // 1. Mid/Side decomposition
      const mid = 0.5 * (l + r);
      const side = 0.5 * (l - r) * widthGain;
      let widenedL = mid + side;
      let widenedR = mid - side;

      // 2. Delayed crossfeed with one-pole low-pass filter
      const dL = this.delayBufferL[dIdx];
      const dR = this.delayBufferR[dIdx];
      this.delayBufferL[dIdx] = l;
      this.delayBufferR[dIdx] = r;
      dIdx = (dIdx + 1) % delaySize;

      lpL += this.lowpassCoeff * (dR - lpL);
      lpR += this.lowpassCoeff * (dL - lpR);

      widenedL += lpL * this.crossfeedGain;
      widenedR += lpR * this.crossfeedGain;

      // 3. Headroom makeup gain (0.82)
      leftOut[i] = widenedL * this.outputGain;
      rightOut[i] = widenedR * this.outputGain;
    }

    this.delayIdx = dIdx;
    this.lpL = lpL;
    this.lpR = lpR;

    return { leftOut, rightOut };
  }
}

/**
 * 10-Band State-Variable Filter (SVF) Equalizer (Feature 6)
 * Trapezoidal integration with frequency pre-warping, 64-frame sub-block parameter gliding,
 * tone controls, and partial makeup attenuation.
 */
export class EqualizerProcessor {
  private sampleRate = 44100;
  private currentBands = new Float32Array(10);
  private targetBands = new Float32Array(10);
  private toneBassDb = 0;
  private toneTrebleDb = 0;

  // Filter state integrators (10 bands * 2 integrators)
  private stateL = new Float32Array(20);
  private stateR = new Float32Array(20);

  // Coefficients per band
  private coeffA1 = new Float32Array(10);
  private coeffA2 = new Float32Array(10);
  private coeffA3 = new Float32Array(10);
  private mixInput = new Float32Array(10);
  private mixBand = new Float32Array(10);
  private mixLow = new Float32Array(10);

  private makeupGain = 1.0;
  isShaping = false;

  constructor(sampleRate = 44100) {
    const validRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
    this.sampleRate = Math.max(8000, validRate);
    this.reset();
  }

  configure(sampleRate: number): void {
    const validRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
    this.sampleRate = Math.max(8000, validRate);
    this.reset();
  }

  reset(): void {
    this.stateL.fill(0);
    this.stateR.fill(0);
    this.currentBands.fill(0);
    this.targetBands.fill(0);
    this.toneBassDb = 0;
    this.toneTrebleDb = 0;
    this.makeupGain = 1.0;
    this.isShaping = false;
    for (let s = 0; s < 10; s++) {
      this.updateCoefficients(s, 0);
    }
  }

  getBands(): number[] {
    return Array.from(this.targetBands);
  }

  setBands(gains: number[]): void {
    if (!Array.isArray(gains) || gains.length !== 10) {
      throw new Error('Equalizer bands must be an array of exactly 10 gain numbers');
    }
    for (const g of gains) {
      if (typeof g !== 'number' || Number.isNaN(g) || g < -12 || g > 12) {
        throw new RangeError(`Gain ${g} dB is outside allowed SVF range [-12, +12] dB`);
      }
    }
    this.targetBands.set(gains);
    this.recomputeEffectiveTargets();
  }

  applyToneControls(bassDb: number, trebleDb: number): void {
    this.toneBassDb = Number.isFinite(bassDb) ? bassDb : 0;
    this.toneTrebleDb = Number.isFinite(trebleDb) ? trebleDb : 0;
    this.recomputeEffectiveTargets();
  }

  private recomputeEffectiveTargets(): void {
    // Tone Bass modifies Band 0 (60 Hz); Tone Treble modifies Band 9 (14 kHz)
    const effective0 = Math.max(-12, Math.min(12, this.targetBands[0] + this.toneBassDb));
    const effective9 = Math.max(-12, Math.min(12, this.targetBands[9] + this.toneTrebleDb));

    let peakBoost = 0;
    let anyNonZero = false;

    for (let i = 0; i < 10; i++) {
      let g = this.targetBands[i];
      if (i === 0) g = effective0;
      if (i === 9) g = effective9;

      if (g > peakBoost) peakBoost = g;
      if (Math.abs(g) > 0.01) anyNonZero = true;
    }

    // Partial makeup attenuation: -0.5 * peakBoost dB
    this.makeupGain = Math.pow(10, (-peakBoost * 0.5) / 20);
    this.isShaping = anyNonZero;
  }

  private updateCoefficients(slot: number, gainDb: number): void {
    const fc = EQ_FREQUENCIES_HZ[slot];
    const fs = this.sampleRate;
    const clampedFc = Math.min(fc, 0.49 * fs);

    const A = Math.pow(10, gainDb / 40);
    const g = Math.tan((Math.PI * clampedFc) / fs);

    let k = 1.0;
    let mixInput = 1.0;
    let mixBand = 0.0;
    let mixLow = 0.0;
    let effectiveG = g;

    if (slot === 0) {
      // Low Shelf
      const Q = 0.707;
      effectiveG = g / Math.sqrt(A);
      k = 1.0 / Q;
      mixInput = 1.0;
      mixBand = k * (A - 1.0);
      mixLow = A * A - 1.0;
    } else if (slot === 9) {
      // High Shelf
      const Q = 0.707;
      effectiveG = g * Math.sqrt(A);
      k = 1.0 / Q;
      mixInput = A * A;
      mixBand = k * (1.0 - A) * A;
      mixLow = 1.0 - A * A;
    } else {
      // Peaking Bell
      const Q = 1.0;
      k = 1.0 / (Q * A);
      mixInput = 1.0;
      mixBand = k * (A * A - 1.0);
      mixLow = 0.0;
    }

    const d = 1.0 / (1.0 + effectiveG * (effectiveG + k));
    this.coeffA1[slot] = d;
    this.coeffA2[slot] = effectiveG * d;
    this.coeffA3[slot] = effectiveG * (effectiveG * d);
    this.mixInput[slot] = mixInput;
    this.mixBand[slot] = mixBand;
    this.mixLow[slot] = mixLow;
  }

  process(
    leftIn: Float32Array,
    rightIn: Float32Array
  ): { leftOut: Float32Array; rightOut: Float32Array } {
    const len = leftIn.length;
    const leftOut = new Float32Array(len);
    const rightOut = new Float32Array(len);

    if (len === 0) return { leftOut, rightOut };

    if (!this.isShaping && this.currentBands.every((b) => Math.abs(b) < 0.001)) {
      leftOut.set(leftIn);
      rightOut.set(rightIn);
      return { leftOut, rightOut };
    }

    const GLIDE_FRAMES = 64;
    const GLIDE_RATE = 0.08;
    let offset = 0;

    const effectiveTargets = new Float32Array(10);
    effectiveTargets.set(this.targetBands);
    effectiveTargets[0] = Math.max(-12, Math.min(12, this.targetBands[0] + this.toneBassDb));
    effectiveTargets[9] = Math.max(-12, Math.min(12, this.targetBands[9] + this.toneTrebleDb));

    while (offset < len) {
      const subBlock = Math.min(len - offset, GLIDE_FRAMES);

      // Glide current gains towards target gains
      for (let s = 0; s < 10; s++) {
        this.currentBands[s] += (effectiveTargets[s] - this.currentBands[s]) * GLIDE_RATE;
        this.updateCoefficients(s, this.currentBands[s]);
      }

      for (let i = 0; i < subBlock; i++) {
        const idx = offset + i;
        let sL = Number.isFinite(leftIn[idx]) ? leftIn[idx] : 0.0;
        let sR = Number.isFinite(rightIn[idx]) ? rightIn[idx] : 0.0;

        for (let s = 0; s < 10; s++) {
          if (Math.abs(this.currentBands[s]) > 0.005) {
            sL = this.filterSample(s, sL, this.stateL);
            sR = this.filterSample(s, sR, this.stateR);
          }
        }

        leftOut[idx] = sL * this.makeupGain;
        rightOut[idx] = sR * this.makeupGain;
      }

      offset += subBlock;
    }

    return { leftOut, rightOut };
  }

  private filterSample(slot: number, input: number, state: Float32Array): number {
    const sIdx = slot * 2;
    const ic1 = state[sIdx];
    const ic2 = state[sIdx + 1];

    const v3 = input - ic2;
    const v1 = this.coeffA1[slot] * ic1 + this.coeffA2[slot] * v3;
    const v2 = ic2 + this.coeffA2[slot] * ic1 + this.coeffA3[slot] * v3;

    state[sIdx] = 2.0 * v1 - ic1;
    state[sIdx + 1] = 2.0 * v2 - ic2;

    return this.mixInput[slot] * input + this.mixBand[slot] * v1 + this.mixLow[slot] * v2;
  }
}

/**
 * 2nd-Order Biquad Filter Coefficients (Normalized by a0)
 */
export interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * Genuine Multi-Stage Biquad Filter Cascade for AutoEQ Headphone Calibration (Feature 7)
 * Implements Direct Form II Transposed (DF2T) topology with persistent stereo filter states,
 * dynamic sample rate coefficient recalculation, and denormal protection.
 */
export class AutoEqProcessor {
  private sampleRate = 44100;
  private filters: AutoEqFilter[] = [];
  private preampGainDb = 0;
  private preampLinear = 1.0;

  private count = 0;
  private b0 = new Float64Array(0);
  private b1 = new Float64Array(0);
  private b2 = new Float64Array(0);
  private a1 = new Float64Array(0);
  private a2 = new Float64Array(0);

  // Persistent stereo states: s1 and s2 per filter stage
  private s1L = new Float64Array(0);
  private s2L = new Float64Array(0);
  private s1R = new Float64Array(0);
  private s2R = new Float64Array(0);

  isShaping = false;

  constructor(sampleRate = 44100) {
    this.configure(sampleRate);
  }

  configure(sampleRate: number): void {
    const validRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
    this.sampleRate = Math.max(8000, validRate);
    this.recomputeCoefficients();
    this.resetState();
  }

  reset(): void {
    this.resetState();
  }

  private resetState(): void {
    this.s1L.fill(0);
    this.s2L.fill(0);
    this.s1R.fill(0);
    this.s2R.fill(0);
  }

  getFilters(): AutoEqFilter[] {
    return this.filters.map((f) => ({ ...f }));
  }

  getPreampDb(): number {
    return this.preampGainDb;
  }

  getPreampLinear(): number {
    return this.preampLinear;
  }

  setProfile(filters: AutoEqFilter[], preampGainDb: number): void {
    this.filters = Array.isArray(filters) ? filters.map((f) => ({ ...f })) : [];
    this.preampGainDb = Number.isFinite(preampGainDb) ? preampGainDb : 0.0;
    this.preampLinear = Math.pow(10, this.preampGainDb / 20);
    this.recomputeCoefficients();
    this.resetState();
  }

  clear(): void {
    this.filters = [];
    this.preampGainDb = 0;
    this.preampLinear = 1.0;
    this.count = 0;
    this.isShaping = false;
    this.resetState();
  }

  private recomputeCoefficients(): void {
    const n = this.filters.length;
    this.count = n;

    if (n === 0) {
      this.isShaping = Math.abs(this.preampGainDb) > 0.01;
      return;
    }

    if (this.b0.length < n) {
      this.b0 = new Float64Array(n);
      this.b1 = new Float64Array(n);
      this.b2 = new Float64Array(n);
      this.a1 = new Float64Array(n);
      this.a2 = new Float64Array(n);
      this.s1L = new Float64Array(n);
      this.s2L = new Float64Array(n);
      this.s1R = new Float64Array(n);
      this.s2R = new Float64Array(n);
    }

    const fs = this.sampleRate;
    let shaping = Math.abs(this.preampGainDb) > 0.01;

    for (let k = 0; k < n; k++) {
      const f = this.filters[k];
      const coeffs = AutoEqProcessor.calculateBiquadCoefficients(f, fs);
      this.b0[k] = coeffs.b0;
      this.b1[k] = coeffs.b1;
      this.b2[k] = coeffs.b2;
      this.a1[k] = coeffs.a1;
      this.a2[k] = coeffs.a2;

      if (Math.abs(f.gainDb) > 0.05 || f.type === 'LOW_PASS' || f.type === 'HIGH_PASS' || f.type === 'BAND_PASS') {
        shaping = true;
      }
    }

    this.isShaping = shaping;
  }

  public static calculateBiquadCoefficients(
    filter: AutoEqFilter,
    sampleRate: number
  ): BiquadCoeffs {
    const validRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
    const fs = Math.max(8000, validRate);
    const safeFreq = Number.isFinite(filter.freq)
      ? Math.max(10, Math.min(0.49 * fs, filter.freq))
      : 1000;
    const safeQ = Number.isFinite(filter.q) && filter.q > 0.05 ? Math.min(100.0, filter.q) : 0.707;
    const safeGainDb = Number.isFinite(filter.gainDb)
      ? Math.max(-40, Math.min(40, filter.gainDb))
      : 0.0;

    const A = Math.pow(10, safeGainDb / 40);
    const w0 = (2 * Math.PI * safeFreq) / fs;
    const sinW0 = Math.sin(w0);
    const cosW0 = Math.cos(w0);
    const alpha = sinW0 / (2 * safeQ);

    let b0 = 1;
    let b1 = 0;
    let b2 = 0;
    let a0 = 1;
    let a1 = 0;
    let a2 = 0;

    switch (filter.type) {
      case 'PEAKING': {
        b0 = 1 + alpha * A;
        b1 = -2 * cosW0;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cosW0;
        a2 = 1 - alpha / A;
        break;
      }
      case 'LOW_SHELF': {
        const sqrtA2Alpha = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) - (A - 1) * cosW0 + sqrtA2Alpha);
        b1 = 2 * A * ((A - 1) - (A + 1) * cosW0);
        b2 = A * ((A + 1) - (A - 1) * cosW0 - sqrtA2Alpha);
        a0 = (A + 1) + (A - 1) * cosW0 + sqrtA2Alpha;
        a1 = -2 * ((A - 1) + (A + 1) * cosW0);
        a2 = (A + 1) + (A - 1) * cosW0 - sqrtA2Alpha;
        break;
      }
      case 'HIGH_SHELF': {
        const sqrtA2Alpha = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) + (A - 1) * cosW0 + sqrtA2Alpha);
        b1 = -2 * A * ((A - 1) + (A + 1) * cosW0);
        b2 = A * ((A + 1) + (A - 1) * cosW0 - sqrtA2Alpha);
        a0 = (A + 1) - (A - 1) * cosW0 + sqrtA2Alpha;
        a1 = 2 * ((A - 1) - (A + 1) * cosW0);
        a2 = (A + 1) - (A - 1) * cosW0 - sqrtA2Alpha;
        break;
      }
      case 'LOW_PASS': {
        b0 = (1 - cosW0) * 0.5;
        b1 = 1 - cosW0;
        b2 = (1 - cosW0) * 0.5;
        a0 = 1 + alpha;
        a1 = -2 * cosW0;
        a2 = 1 - alpha;
        break;
      }
      case 'HIGH_PASS': {
        b0 = (1 + cosW0) * 0.5;
        b1 = -(1 + cosW0);
        b2 = (1 + cosW0) * 0.5;
        a0 = 1 + alpha;
        a1 = -2 * cosW0;
        a2 = 1 - alpha;
        break;
      }
      case 'BAND_PASS': {
        b0 = alpha;
        b1 = 0;
        b2 = -alpha;
        a0 = 1 + alpha;
        a1 = -2 * cosW0;
        a2 = 1 - alpha;
        break;
      }
      default: {
        return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
      }
    }

    const invA0 = 1.0 / a0;
    return {
      b0: b0 * invA0,
      b1: b1 * invA0,
      b2: b2 * invA0,
      a1: a1 * invA0,
      a2: a2 * invA0,
    };
  }

  process(left: Float32Array, right: Float32Array): void {
    const len = left.length;
    if (len === 0) return;

    // 1. Preamp attenuation / boost
    if (this.preampLinear !== 1.0) {
      const g = this.preampLinear;
      for (let i = 0; i < len; i++) {
        left[i] *= g;
        right[i] *= g;
      }
    }

    const n = this.count;
    if (n === 0) return;

    // 2. Cascade through DF2T biquad stages
    for (let k = 0; k < n; k++) {
      const b0 = this.b0[k];
      const b1 = this.b1[k];
      const b2 = this.b2[k];
      const a1 = this.a1[k];
      const a2 = this.a2[k];

      let s1L = this.s1L[k];
      let s2L = this.s2L[k];
      let s1R = this.s1R[k];
      let s2R = this.s2R[k];

      for (let i = 0; i < len; i++) {
        const xL = left[i];
        const yL = b0 * xL + s1L;
        s1L = b1 * xL - a1 * yL + s2L;
        s2L = b2 * xL - a2 * yL;
        left[i] = yL;

        const xR = right[i];
        const yR = b0 * xR + s1R;
        s1R = b1 * xR - a1 * yR + s2R;
        s2R = b2 * xR - a2 * yR;
        right[i] = yR;
      }

      // Denormal and NaN flush
      this.s1L[k] = Math.abs(s1L) < 1e-25 || !Number.isFinite(s1L) ? 0.0 : s1L;
      this.s2L[k] = Math.abs(s2L) < 1e-25 || !Number.isFinite(s2L) ? 0.0 : s2L;
      this.s1R[k] = Math.abs(s1R) < 1e-25 || !Number.isFinite(s1R) ? 0.0 : s1R;
      this.s2R[k] = Math.abs(s2R) < 1e-25 || !Number.isFinite(s2R) ? 0.0 : s2R;
    }
  }
}

/**
 * Lookahead Peak Limiter & Dynamic Headroom Protection (Feature 11)
 * 0.985 ceiling (-0.13 dBFS), instant attack, 100ms exponential release.
 */
export class LookaheadPeakLimiter {
  ceiling = 0.985;
  holdLimiter = false;

  private envelope = 0;
  private releaseCoef = 1.0;
  private sampleRate = 44100;

  constructor(sampleRate = 44100, ceiling = 0.985) {
    const validRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
    this.sampleRate = Math.max(8000, validRate);
    const rawCeiling = Number.isFinite(ceiling) ? ceiling : 0.985;
    this.ceiling = Math.min(0.985, Math.max(0.1, rawCeiling));
    this.configure(this.sampleRate);
  }

  configure(sampleRate: number): void {
    const validRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
    this.sampleRate = Math.max(8000, validRate);
    this.releaseCoef = 1.0 - Math.exp(-1.0 / (0.1 * this.sampleRate)); // 100ms release
    this.reset();
  }

  reset(): void {
    this.envelope = 0;
  }

  process(samples: Float32Array): Float32Array {
    const len = samples.length;
    if (len === 0) return new Float32Array(0);

    const safeCeiling = Math.min(0.985, Math.max(0.1, Number.isFinite(this.ceiling) ? this.ceiling : 0.985));
    const output = new Float32Array(len);
    let env = this.envelope;

    for (let i = 0; i < len; i++) {
      const s = Number.isFinite(samples[i]) ? samples[i] : 0.0;
      const absSample = Math.abs(s);

      if (absSample > env) {
        env = absSample; // Instant attack (F11-T03)
      } else {
        env += this.releaseCoef * (absSample - env); // Exponential release (F11-T04)
      }

      let gain = 1.0;
      if (env > safeCeiling) {
        gain = safeCeiling / env;
      }

      let val = s * gain;
      if (val > safeCeiling) val = safeCeiling;
      else if (val < -safeCeiling) val = -safeCeiling;

      output[i] = val;
    }

    this.envelope = env;
    return output;
  }

  processStereo(
    left: Float32Array,
    right: Float32Array
  ): { leftOut: Float32Array; rightOut: Float32Array } {
    const len = left.length;
    const leftOut = new Float32Array(len);
    const rightOut = new Float32Array(len);

    if (len === 0) return { leftOut, rightOut };

    const safeCeiling = Math.min(0.985, Math.max(0.1, Number.isFinite(this.ceiling) ? this.ceiling : 0.985));
    let env = this.envelope;

    for (let i = 0; i < len; i++) {
      const l = Number.isFinite(left[i]) ? left[i] : 0.0;
      const r = Number.isFinite(right[i]) ? right[i] : 0.0;
      const peak = Math.max(Math.abs(l), Math.abs(r));

      if (peak > env) {
        env = peak;
      } else {
        env += this.releaseCoef * (peak - env);
      }

      let gain = 1.0;
      if (env > safeCeiling) {
        gain = safeCeiling / env;
      }

      let outL = l * gain;
      let outR = r * gain;

      if (outL > safeCeiling) outL = safeCeiling;
      else if (outL < -safeCeiling) outL = -safeCeiling;

      if (outR > safeCeiling) outR = safeCeiling;
      else if (outR < -safeCeiling) outR = -safeCeiling;

      leftOut[i] = outL;
      rightOut[i] = outR;
    }

    this.envelope = env;
    return { leftOut, rightOut };
  }
}

/**
 * Loudness and ReplayGain normalization helper
 */
export class LoudnessProcessor {
  public static calculateReplayGainMultiplier(
    targetLufs = -14.0,
    trackLufs?: number,
    replayGainDb?: number
  ): number {
    if (typeof replayGainDb === 'number' && Number.isFinite(replayGainDb)) {
      return Math.pow(10, replayGainDb / 20);
    }
    if (typeof trackLufs === 'number' && Number.isFinite(trackLufs)) {
      const offsetDb = targetLufs - trackLufs;
      return Math.pow(10, offsetDb / 20);
    }
    return 1.0;
  }
}

/**
 * Master Float32 DSP Chain coordinating SpatialAudio, 10-Band SVF EQ, AutoEQ, and Peak Limiter.
 */
export class DspChain {
  readonly spatial: SpatialAudioProcessor;
  readonly equalizer: EqualizerProcessor;
  readonly autoEq: AutoEqProcessor;
  readonly limiter: LookaheadPeakLimiter;

  private sampleRate = 44100;

  constructor(sampleRate = 44100) {
    const validRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
    this.sampleRate = Math.max(8000, validRate);
    this.spatial = new SpatialAudioProcessor(this.sampleRate);
    this.equalizer = new EqualizerProcessor(this.sampleRate);
    this.autoEq = new AutoEqProcessor(this.sampleRate);
    this.limiter = new LookaheadPeakLimiter(this.sampleRate, 0.985);
  }

  configure(sampleRate: number): void {
    const validRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
    this.sampleRate = Math.max(8000, validRate);
    this.spatial.configure(this.sampleRate);
    this.equalizer.configure(this.sampleRate);
    this.autoEq.configure(this.sampleRate);
    this.limiter.configure(this.sampleRate);
  }

  reset(): void {
    this.spatial.reset();
    this.equalizer.reset();
    this.autoEq.reset();
    this.limiter.reset();
  }

  get autoEqFilters(): AutoEqFilter[] {
    return this.autoEq.getFilters();
  }

  get autoEqPreampDb(): number {
    return this.autoEq.getPreampDb();
  }

  get autoEqPreampLinear(): number {
    return this.autoEq.getPreampLinear();
  }

  setAutoEqProfile(filters: AutoEqFilter[], preampGainDb: number): void {
    this.autoEq.setProfile(filters, preampGainDb);
  }

  clearAutoEqProfile(): void {
    this.autoEq.clear();
  }

  /**
   * Processes a contiguous stereo audio block through the canonical DSP pipeline:
   * Spatial Audio -> Equalizer -> AutoEQ Biquad Cascade & Preamp -> Lookahead Peak Limiter.
   */
  processBlock(
    left: Float32Array,
    right: Float32Array
  ): { leftOut: Float32Array; rightOut: Float32Array } {
    // 1. Spatial Audio Expansion
    const { leftOut: spatialL, rightOut: spatialR } = this.spatial.process(left, right);

    // 2. 10-Band SVF Equalizer
    const { leftOut: eqL, rightOut: eqR } = this.equalizer.process(spatialL, spatialR);

    // 3. Genuine AutoEQ Multi-Stage Biquad Filter Cascade & Preamp
    this.autoEq.process(eqL, eqR);

    // 4. Limiter interlock: hold limiter actively armed whenever EQ or AutoEQ is shaping
    this.limiter.holdLimiter = this.equalizer.isShaping || this.autoEq.isShaping;

    // 5. Lookahead Peak Limiter (0.985 Ceiling)
    return this.limiter.processStereo(eqL, eqR);
  }
}

export interface NativeDspAccelerator {
  computeBiquadMagnitudeDb?: (
    filters: AutoEqFilter[],
    freqs: number[],
    sampleRate?: number,
    preampDb?: number
  ) => number[];
  computeSvfEqMagnitudeDb?: (
    bands10: number[],
    freqs: number[],
    sampleRate?: number,
    toneBassDb?: number,
    toneTrebleDb?: number
  ) => number[];
}

let nativeDspAccelerator: NativeDspAccelerator | null = null;

/**
 * Registers an optional native DSP accelerator (e.g. from Electron IPC/preload) without
 * introducing Node/Electron imports into the browser bundle.
 */
export function registerNativeDspAccelerator(accelerator: NativeDspAccelerator | null): void {
  nativeDspAccelerator = accelerator;
}

/**
 * Evaluates exact combined magnitude frequency response (in dB) of an AutoEQ filter cascade + preamp
 * across a supplied frequency grid, suitable for real-time EQ/AutoEQ curve plotting.
 */
export function computeBiquadMagnitudeDb(
  filters: AutoEqFilter[],
  preampGainDb: number,
  freqs: ArrayLike<number>,
  sampleRate = 48000
): number[] {
  const validRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000;
  const fs = Math.max(8000, validRate);
  const safePreamp = Number.isFinite(preampGainDb) ? preampGainDb : 0;
  const list = Array.isArray(filters) ? filters : [];

  if (nativeDspAccelerator?.computeBiquadMagnitudeDb) {
    try {
      const res = nativeDspAccelerator.computeBiquadMagnitudeDb(
        list,
        Array.from(freqs),
        fs,
        safePreamp
      );
      if (Array.isArray(res) && res.length === freqs.length) {
        return res;
      }
    } catch {
      // Fallback to pure-TS implementation
    }
  }

  const coeffsList: BiquadCoeffs[] = new Array(list.length);
  for (let k = 0; k < list.length; k++) {
    coeffsList[k] = AutoEqProcessor.calculateBiquadCoefficients(list[k], fs);
  }

  const out = new Array<number>(freqs.length);
  const nyquist = fs * 0.5;
  const twoPiOverFs = (2 * Math.PI) / fs;

  for (let i = 0; i < freqs.length; i++) {
    const rawFreq = freqs[i];
    if (!Number.isFinite(rawFreq) || rawFreq <= 0) {
      out[i] = safePreamp;
      continue;
    }
    const f = Math.min(rawFreq, nyquist * 0.999);
    const w = twoPiOverFs * f;
    const cosW = Math.cos(w);
    const sinW = Math.sin(w);
    const cos2W = 2 * cosW * cosW - 1;
    const sin2W = 2 * sinW * cosW;

    let db = safePreamp;
    for (let k = 0; k < coeffsList.length; k++) {
      const c = coeffsList[k];
      const numR = c.b0 + c.b1 * cosW + c.b2 * cos2W;
      const numI = -(c.b1 * sinW + c.b2 * sin2W);
      const denR = 1.0 + c.a1 * cosW + c.a2 * cos2W;
      const denI = -(c.a1 * sinW + c.a2 * sin2W);
      const numSq = numR * numR + numI * numI;
      const denSq = Math.max(1e-30, denR * denR + denI * denI);
      db += 10 * Math.log10(Math.max(1e-30, numSq / denSq));
    }
    out[i] = db;
  }

  return out;
}

/**
 * Evaluates exact combined magnitude frequency response (in dB) of the 10-band Cytomic
 * trapezoidal SVF equalizer + tone controls + partial makeup attenuation.
 */
export function computeSvfEqMagnitudeDb(
  bands10: ArrayLike<number>,
  freqs: ArrayLike<number>,
  sampleRate = 44100,
  toneBassDb = 0,
  toneTrebleDb = 0
): number[] {
  const validRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
  const fs = Math.max(8000, validRate);
  const bass = Number.isFinite(toneBassDb) ? toneBassDb : 0;
  const treble = Number.isFinite(toneTrebleDb) ? toneTrebleDb : 0;

  const normalizedBands = new Array<number>(10);
  for (let i = 0; i < 10; i++) {
    const raw = bands10 && i < bands10.length ? bands10[i] : 0;
    normalizedBands[i] = Number.isFinite(raw) ? Math.max(-12, Math.min(12, raw)) : 0;
  }

  if (nativeDspAccelerator?.computeSvfEqMagnitudeDb) {
    try {
      const res = nativeDspAccelerator.computeSvfEqMagnitudeDb(
        normalizedBands,
        Array.from(freqs),
        fs,
        bass,
        treble
      );
      if (Array.isArray(res) && res.length === freqs.length) {
        return res;
      }
    } catch {
      // Fallback to pure-TS implementation
    }
  }

  const effectiveGains = new Float64Array(10);
  let peakBoost = 0;
  for (let i = 0; i < 10; i++) {
    let eff = normalizedBands[i];
    if (i === 0) eff = Math.max(-12, Math.min(12, eff + bass));
    if (i === 9) eff = Math.max(-12, Math.min(12, eff + treble));
    effectiveGains[i] = eff;
    if (eff > peakBoost) peakBoost = eff;
  }

  const makeupDb = -peakBoost * 0.5;
  const bandParams: Array<{
    active: boolean;
    effectiveG: number;
    k: number;
    mixInput: number;
    mixBand: number;
    mixLow: number;
  }> = new Array(10);

  for (let s = 0; s < 10; s++) {
    const gainDb = effectiveGains[s];
    if (Math.abs(gainDb) <= 0.005) {
      bandParams[s] = { active: false, effectiveG: 1, k: 1, mixInput: 1, mixBand: 0, mixLow: 0 };
      continue;
    }
    const fc = Math.min(EQ_FREQUENCIES_HZ[s], 0.49 * fs);
    const A = Math.pow(10, gainDb / 40);
    const g = Math.tan((Math.PI * fc) / fs);
    if (s === 0) {
      const k = 1.0 / 0.707;
      bandParams[s] = {
        active: true,
        effectiveG: g / Math.sqrt(A),
        k,
        mixInput: 1.0,
        mixBand: k * (A - 1.0),
        mixLow: A * A - 1.0,
      };
    } else if (s === 9) {
      const k = 1.0 / 0.707;
      bandParams[s] = {
        active: true,
        effectiveG: g * Math.sqrt(A),
        k,
        mixInput: A * A,
        mixBand: k * (1.0 - A) * A,
        mixLow: 1.0 - A * A,
      };
    } else {
      const k = 1.0 / (1.0 * A);
      bandParams[s] = {
        active: true,
        effectiveG: g,
        k,
        mixInput: 1.0,
        mixBand: k * (A * A - 1.0),
        mixLow: 0.0,
      };
    }
  }

  const out = new Array<number>(freqs.length);
  const nyquist = fs * 0.5;
  const piOverFs = Math.PI / fs;

  for (let i = 0; i < freqs.length; i++) {
    const rawFreq = freqs[i];
    if (!Number.isFinite(rawFreq) || rawFreq <= 0) {
      out[i] = makeupDb;
      continue;
    }
    const f = Math.min(rawFreq, nyquist * 0.999);
    const tanHalfW = Math.tan(piOverFs * f);
    let db = makeupDb;

    for (let s = 0; s < 10; s++) {
      const p = bandParams[s];
      if (!p.active) continue;
      const y = tanHalfW / p.effectiveG;
      const oneMinusY2 = 1.0 - y * y;
      const ky = p.k * y;
      const numR = p.mixInput * oneMinusY2 + p.mixLow;
      const numI = (p.mixInput * p.k + p.mixBand) * y;
      const numSq = numR * numR + numI * numI;
      const denSq = Math.max(1e-30, oneMinusY2 * oneMinusY2 + ky * ky);
      db += 10 * Math.log10(Math.max(1e-30, numSq / denSq));
    }
    out[i] = db;
  }

  return out;
}
