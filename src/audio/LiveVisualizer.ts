// src/audio/LiveVisualizer.ts
// Zero-allocation 32-band live PCM energy analyzer and Web Audio visualizer bridge
// Conforming to Feature 10 (PROJECT.md) and Survey 2 §4.7

export type LiveEnergySubscriber = (energy32: Float32Array) => void;

let latestVisualizerInstance: LiveVisualizer | null = null;

export function getEstimatedBpm(): number {
  return latestVisualizerInstance ? latestVisualizerInstance.getEstimatedBpm() : 120;
}

export function getBeatStrength(): number {
  return latestVisualizerInstance ? latestVisualizerInstance.getBeatStrength() : 0;
}

export class LiveVisualizer {
  public static readonly BANDS = 32;

  private subscribers = new Set<LiveEnergySubscriber>();
  private readonly sharedEnergy32 = new Float32Array(LiveVisualizer.BANDS);

  // Zero-GC onset BPM estimator ring buffer (inter-onset intervals in 300ms..1100ms)
  private readonly onsetIntervalRing = new Float32Array(12);
  private onsetRingWriteIdx = 0;
  private onsetRingCount = 0;
  private lastOnsetTimeMs = 0;
  private lastBeatClockMs = 0;
  private lastWallClockMs = 0;
  private rollingBassEnergy = 0;

  public estimatedBpm = 120;
  public beatStrength = 0;

  // State variables for dual 1-pole split filters
  private lp1 = 0;
  private lp2 = 0;

  public rmsLevel = 0;
  public bassLevel = 0;
  public midLevel = 0;
  public highLevel = 0;

  private analyser: AnalyserNode | null = null;
  private fftBuffer: Float32Array<ArrayBuffer> | null = null;

  constructor() {
    latestVisualizerInstance = this;
  }

  public getEstimatedBpm(): number {
    return this.estimatedBpm;
  }

  public getBeatStrength(): number {
    return this.beatStrength;
  }

  /**
   * Zero-GC onset detector and BPM estimator (65..185 BPM, default 120)
   * with exponentially decaying beatStrength (0..1).
   */
  public updateBeatMetrics(bassEnergy: number, explicitNowMs?: number, blockDurationMs = 16.67): boolean {
    latestVisualizerInstance = this;
    const wallNow =
      typeof explicitNowMs === 'number' && Number.isFinite(explicitNowMs)
        ? explicitNowMs
        : typeof performance !== 'undefined'
        ? performance.now()
        : Date.now();

    let dtMs: number;
    if (typeof explicitNowMs === 'number' && Number.isFinite(explicitNowMs)) {
      dtMs = this.lastBeatClockMs > 0 ? Math.max(0, explicitNowMs - this.lastBeatClockMs) : blockDurationMs;
      this.lastBeatClockMs = explicitNowMs;
      this.lastWallClockMs = wallNow;
    } else {
      const wallDelta = this.lastWallClockMs > 0 ? Math.max(0, wallNow - this.lastWallClockMs) : blockDurationMs;
      this.lastWallClockMs = wallNow;
      dtMs = wallDelta < blockDurationMs * 0.5 ? blockDurationMs : wallDelta;
      this.lastBeatClockMs = (this.lastBeatClockMs > 0 ? this.lastBeatClockMs : wallNow) + dtMs;
    }

    const nowMs = this.lastBeatClockMs;
    const clampedDtSec = Math.max(0, Math.min(0.25, dtMs / 1000));

    // Exponentially decay beatStrength (time constant ~160ms)
    if (clampedDtSec > 0) {
      this.beatStrength *= Math.exp(-clampedDtSec / 0.16);
      if (this.beatStrength < 0.001) {
        this.beatStrength = 0;
      }
    }

    const bass = Math.max(0, Math.min(1, Number.isFinite(bassEnergy) ? bassEnergy : 0));
    const prevAvg = this.rollingBassEnergy;
    const ioiMs = this.lastOnsetTimeMs > 0 ? nowMs - this.lastOnsetTimeMs : 0;
    const isOnset =
      bass > 0.18 &&
      bass > Math.max(0.22, prevAvg * 1.28) &&
      (this.lastOnsetTimeMs === 0 || ioiMs > 170);

    if (isOnset) {
      const impulse = Math.max(0.55, Math.min(1.0, 0.45 + (bass - prevAvg * 0.75) * 1.8));
      if (impulse > this.beatStrength) {
        this.beatStrength = impulse;
      }

      if (this.lastOnsetTimeMs > 0 && ioiMs >= 300 && ioiMs <= 1100) {
        this.onsetIntervalRing[this.onsetRingWriteIdx] = ioiMs;
        this.onsetRingWriteIdx = (this.onsetRingWriteIdx + 1) % 12;
        if (this.onsetRingCount < 12) {
          this.onsetRingCount++;
        }

        let sumIoi = 0;
        for (let i = 0; i < this.onsetRingCount; i++) {
          sumIoi += this.onsetIntervalRing[i];
        }
        const meanIoi = sumIoi / this.onsetRingCount;
        if (meanIoi > 0) {
          const candidateBpm = Math.max(65, Math.min(185, 60000 / meanIoi));
          this.estimatedBpm = Math.max(
            65,
            Math.min(185, this.estimatedBpm * 0.65 + candidateBpm * 0.35)
          );
        }
      }

      this.lastOnsetTimeMs = nowMs;
    }

    this.rollingBassEnergy = prevAvg * 0.82 + bass * 0.18;
    return isOnset;
  }

  /**
   * Computes 32-band energy directly from a Float32Array PCM block with zero heap allocations.
   * Conforms to F10-T03, F10-T05, B10-T03, B10-T04.
   */
  public static compute32BandPcmEnergy(
    pcmBlock: Float32Array,
    outBuffer?: Float32Array
  ): Float32Array {
    const out = outBuffer ?? new Float32Array(LiveVisualizer.BANDS);
    const len = pcmBlock.length;
    const blockSize = Math.floor(len / LiveVisualizer.BANDS);

    if (blockSize === 0) {
      out.fill(0);
      return out;
    }

    for (let band = 0; band < LiveVisualizer.BANDS; band++) {
      let sum = 0;
      const start = band * blockSize;
      for (let i = 0; i < blockSize; i++) {
        const val = pcmBlock[start + i];
        sum += Math.abs(Number.isFinite(val) ? val : 0.0);
      }
      out[band] = Math.min(1.0, sum / blockSize);
    }

    return out;
  }

  /**
   * Subscribes a callback to live 32-band PCM energy updates.
   * Returns an unsubscription function. Conforms to F10-T04.
   */
  public subscribe(callback: LiveEnergySubscriber): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Dispatches a raw PCM block to all subscribers using zero-allocation computation.
   */
  public processPcmBlock(pcmBlock: Float32Array): void {
    LiveVisualizer.compute32BandPcmEnergy(pcmBlock, this.sharedEnergy32);
    const bassAvg =
      (this.sharedEnergy32[0] +
        this.sharedEnergy32[1] +
        this.sharedEnergy32[2] +
        this.sharedEnergy32[3]) *
      0.25;
    this.updateBeatMetrics(bassAvg, undefined, Math.max(10, (pcmBlock.length / 44100) * 1000));
    this.emit();
  }

  /**
   * Connects the visualizer to a Web Audio graph via AnalyserNode.
   */
  public attachAnalyser(analyser: AnalyserNode): void {
    this.analyser = analyser;
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.8;
    this.fftBuffer = new Float32Array(this.analyser.frequencyBinCount);
  }

  /**
   * Polls the attached AnalyserNode and broadcasts updates.
   */
  public updateFromAnalyser(): void {
    if (!this.analyser || !this.fftBuffer) return;
    this.analyser.getFloatFrequencyData(this.fftBuffer);

    const binCount = this.fftBuffer.length;
    for (let b = 0; b < LiveVisualizer.BANDS; b++) {
      const startFrac = Math.pow(b / LiveVisualizer.BANDS, 2);
      const endFrac = Math.pow((b + 1) / LiveVisualizer.BANDS, 2);
      const startBin = Math.floor(startFrac * binCount);
      const endBin = Math.max(startBin + 1, Math.floor(endFrac * binCount));

      let sum = 0;
      let count = 0;
      for (let i = startBin; i < endBin && i < binCount; i++) {
        const db = this.fftBuffer[i];
        const norm = Math.max(0, Math.min(1, (db + 100) / 70));
        sum += norm;
        count++;
      }
      this.sharedEnergy32[b] = count > 0 ? sum / count : 0;
    }

    const bassAvg =
      (this.sharedEnergy32[0] +
        this.sharedEnergy32[1] +
        this.sharedEnergy32[2] +
        this.sharedEnergy32[3]) *
      0.25;
    this.updateBeatMetrics(bassAvg);
    this.emit();
  }

  /**
   * Full DSP frame analyzer matching Android LiveWaveformVisualizer parity.
   * Decomposes signal via dual 1-pole split filters (~180Hz bass, ~2400Hz mid/high) with attack/decay ballistics.
   */
  public processPcmFrame(samples: Float32Array, channelCount = 2, sampleRate = 44100): void {
    const totalSamples = samples.length;
    const frameCount = Math.floor(totalSamples / channelCount);
    if (frameCount <= 0) return;

    const sr = sampleRate > 8000 ? sampleRate : 44100;
    const aLow = Math.max(0.005, Math.min(0.25, (2 * Math.PI * 180) / (sr + 2 * Math.PI * 180)));
    const aMid = Math.max(0.05, Math.min(0.65, (2 * Math.PI * 2400) / (sr + 2 * Math.PI * 2400)));

    const blockDt = Math.max(0.005, Math.min(0.05, frameCount / sr));
    const attackCoeff = Math.max(0.35, Math.min(0.65, 1 - Math.exp(-blockDt / 0.02)));
    const decayCoeff = Math.max(0.08, Math.min(0.35, 1 - Math.exp(-blockDt / 0.065)));

    const framesPerBand = Math.max(1, Math.floor(frameCount / LiveVisualizer.BANDS));

    let sumSq = 0;
    let lowSq = 0;
    let midSq = 0;
    let highSq = 0;
    let countedFrames = 0;

    for (let b = 0; b < LiveVisualizer.BANDS; b++) {
      const startFrame = b * framesPerBand;
      const endFrame =
        b === LiveVisualizer.BANDS - 1 ? frameCount : Math.min(frameCount, (b + 1) * framesPerBand);

      let bandSq = 0;
      let bandLowSq = 0;
      let bandMidSq = 0;
      let bandHighSq = 0;
      let bandPeak = 0;
      let bandCount = 0;

      for (let f = startFrame; f < endFrame; f++) {
        const base = f * channelCount;
        const m = channelCount === 1 ? samples[base] : 0.5 * (samples[base] + samples[base + 1]);
        const sample = Number.isFinite(m) ? m : 0.0;

        this.lp1 += aLow * (sample - this.lp1);
        this.lp2 += aMid * (sample - this.lp2);

        const low = this.lp1;
        const mid = this.lp2 - this.lp1;
        const high = sample - this.lp2;

        const absM = Math.abs(sample);
        if (absM > bandPeak) bandPeak = absM;

        bandSq += sample * sample;
        bandLowSq += low * low;
        bandMidSq += mid * mid;
        bandHighSq += high * high;
        bandCount++;
      }

      if (bandCount > 0) {
        sumSq += bandSq;
        lowSq += bandLowSq;
        midSq += bandMidSq;
        highSq += bandHighSq;
        countedFrames += bandCount;

        const inv = 1 / bandCount;
        const segRms = Math.sqrt(bandSq * inv);
        const segLow = Math.sqrt(bandLowSq * inv);
        const segMid = Math.sqrt(bandMidSq * inv);
        const segHigh = Math.sqrt(bandHighSq * inv);

        const bandPos = b / (LiveVisualizer.BANDS - 1);
        const lowWeight = Math.max(0, Math.min(1, 1 - bandPos / 0.45));
        const highWeight = Math.max(0, Math.min(1, (bandPos - 0.55) / 0.45));
        const midWeight = Math.max(0, Math.min(1, 1 - Math.abs(bandPos - 0.5) / 0.35));
        const weightSum = Math.max(0.01, lowWeight + midWeight + highWeight);

        const spectralMix =
          (lowWeight * (segLow * 1.05) + midWeight * (segMid * 1.25) + highWeight * (segHigh * 1.85)) /
          weightSum;

        const peakBoost = segRms > 0.001 ? Math.max(0, Math.min(0.8, (bandPeak - segRms) / segRms)) : 0;
        const target = Math.max(0, Math.min(0.9, spectralMix * (1 + 0.35 * peakBoost)));

        const prev = this.sharedEnergy32[b];
        const coeff = target > prev ? attackCoeff : decayCoeff;
        this.sharedEnergy32[b] = Math.max(0, Math.min(1.0, prev + coeff * (target - prev)));
      }
    }

    if (countedFrames > 0) {
      const invTotal = 1 / countedFrames;
      const rawRms = Math.min(0.85, Math.sqrt(sumSq * invTotal) * 1.1);
      const rawBass = Math.min(0.85, Math.sqrt(lowSq * invTotal) * 1.15);
      const rawMid = Math.min(0.85, Math.sqrt(midSq * invTotal) * 1.2);
      const rawHigh = Math.min(0.85, Math.sqrt(highSq * invTotal) * 1.35);

      this.rmsLevel += (rawRms > this.rmsLevel ? attackCoeff : decayCoeff) * (rawRms - this.rmsLevel);
      this.bassLevel += (rawBass > this.bassLevel ? attackCoeff : decayCoeff) * (rawBass - this.bassLevel);
      this.midLevel += (rawMid > this.midLevel ? attackCoeff : decayCoeff) * (rawMid - this.midLevel);
      this.highLevel += (rawHigh > this.highLevel ? attackCoeff : decayCoeff) * (rawHigh - this.highLevel);

      this.updateBeatMetrics(rawBass, undefined, blockDt * 1000);
    }

    this.emit();
  }

  private emit(): void {
    for (const sub of this.subscribers) {
      try {
        sub(this.sharedEnergy32);
      } catch {
        // Suppress subscriber errors
      }
    }
  }

  public reset(): void {
    this.sharedEnergy32.fill(0);
    this.onsetIntervalRing.fill(0);
    this.onsetRingWriteIdx = 0;
    this.onsetRingCount = 0;
    this.lastOnsetTimeMs = 0;
    this.lastBeatClockMs = 0;
    this.lastWallClockMs = 0;
    this.rollingBassEnergy = 0;
    this.estimatedBpm = 120;
    this.beatStrength = 0;
    this.lp1 = 0;
    this.lp2 = 0;
    this.rmsLevel = 0;
    this.bassLevel = 0;
    this.midLevel = 0;
    this.highLevel = 0;
  }
}
