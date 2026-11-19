// src/audio/TransitionProcessor.ts
// 24 dB/octave Butterworth cascaded filter sweeps, beat-synced echo delay, and tempo ramps
// Conforming to Feature 9 (PROJECT.md) and Survey 2 §4.8

export interface TransitionConfig {
  bars: number;
  bpm: number;
  lowPassEndHz?: number;
  highPassEndHz?: number;
}

export class TransitionProcessor {
  public static readonly OPEN_HZ = 20000;
  public static readonly OFF_HZ = 20;
  public static readonly MAX_HIGH_PASS_HZ = 2000;
  public static readonly MIN_HZ = 10;

  // 4th-order (24 dB/oct) Butterworth Q values for 2 cascaded 2nd-order stages
  public static readonly BUTTERWORTH_Q = [0.5412, 1.30656] as const;
  public static readonly GLIDE_FRAMES = 64;
  public static readonly GLIDE_RATE = 0.05;

  public static readonly ECHO_FEEDBACK = 0.4;
  public static readonly ECHO_WET = 0.5;
  public static readonly ECHO_LOW_PASS_HZ = 3500;
  public static readonly ECHO_HIGH_PASS_HZ = 250;
  public static readonly MAX_ECHO_SECONDS = 1.0;

  /**
   * Calculates total transition duration in seconds from musical bars and tempo.
   * Conforms to F09-T01, B09-T01, B09-T02.
   */
  public static calculateTransitionDurationSec(bars: number, bpm: number): number {
    const safeBpm = bpm && bpm > 30 && bpm < 300 ? bpm : 120; // B09-T01
    const safeBars = Math.max(1, Math.min(24, Math.floor(bars))); // B09-T02
    const barDurationSec = (60 / safeBpm) * 4;
    return safeBars * barDurationSec;
  }

  /**
   * Computes beat-synced feedback echo delay length in milliseconds.
   * Conforms to F09-T02, B09-T01.
   */
  public static calculateBeatSyncedEchoMs(bpm: number, beatFraction = 1.0): number {
    const safeBpm = bpm && bpm > 30 && bpm < 300 ? bpm : 120;
    return (60 / safeBpm) * 1000 * beatFraction;
  }

  /**
   * Calculates required master tempo ramp bars for pitch-neutral time-stretching.
   * Maximum acceleration: 2.5 BPM/bar. Conforms to F09-T03.
   */
  public static calculateTempoRampBars(
    outgoingBpm: number,
    incomingBpm: number,
    maxBpmRampPerBar = 2.5
  ): number {
    const delta = Math.abs(incomingBpm - outgoingBpm);
    if (delta <= 0.1) return 1;
    const required = Math.ceil(delta / maxBpmRampPerBar);
    return Math.max(1, Math.min(24, required));
  }

  /**
   * Clamps feedback coefficient to safe bound (max 0.95 to avoid runaway oscillation).
   * Conforms to B09-T03.
   */
  public static clampFeedback(feedback: number): number {
    return Math.max(0.0, Math.min(0.95, feedback));
  }

  /**
   * Time-stretches an audio block, gracefully returning empty Float32Array on zero-length buffer.
   * Conforms to B09-T04.
   */
  public static stretchAudioBlock(buffer: Float32Array, ratio: number): Float32Array {
    if (!buffer || buffer.length === 0) return new Float32Array(0);
    const targetLength = Math.max(0, Math.floor(buffer.length * ratio));
    if (targetLength === 0) return new Float32Array(0);

    const out = new Float32Array(targetLength);
    const step = buffer.length / targetLength;
    for (let i = 0; i < targetLength; i++) {
      const srcIdx = Math.min(Math.floor(i * step), buffer.length - 1);
      out[i] = buffer[srcIdx];
    }
    return out;
  }

  /**
   * Generates synthetic kick drum test tone matching Survey 2 §4.8:
   * f(t) = 120 * e^(-35t) + 45, env(t) = 0.8 * e^(-30t).
   * Conforms to F09-T04.
   */
  public static generateKickDrum(durationSec = 0.3, sampleRate = 44100): Float32Array {
    const totalSamples = Math.floor(durationSec * sampleRate);
    const buffer = new Float32Array(totalSamples);
    let phase = 0;

    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      const freq = 120 * Math.exp(-35 * t) + 45;
      const env = 0.8 * Math.exp(-30 * t);
      phase += (2 * Math.PI * freq) / sampleRate;
      buffer[i] = env * Math.sin(phase);
    }

    return buffer;
  }

  /**
   * Generates 31-bit LCG white noise hi-hat with exponential decay (tau = 1/120s).
   * Conforms to F09-T05.
   */
  public static generateHiHat(durationSec = 0.15, sampleRate = 44100): Float32Array {
    const totalSamples = Math.floor(durationSec * sampleRate);
    const buffer = new Float32Array(totalSamples);
    let seed = 123456789;
    const tau = 1 / 120;

    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const noise = (seed / 0x7fffffff) * 2 - 1;
      const env = Math.exp(-t / tau);
      buffer[i] = 0.5 * noise * env;
    }

    return buffer;
  }

  /**
   * Configures Web Audio native filter sweep nodes (two cascaded BiquadFilterNodes for 24 dB/oct).
   */
  public static createCascadedFilterNodes(ctx: AudioContext): {
    input: AudioNode;
    output: AudioNode;
    lowpass1: BiquadFilterNode;
    lowpass2: BiquadFilterNode;
    highpass1: BiquadFilterNode;
    highpass2: BiquadFilterNode;
    setCutoffs: (lpHz: number, hpHz: number, ctxTime?: number, rampSec?: number) => void;
    open: () => void;
  } {
    const hp1 = ctx.createBiquadFilter();
    hp1.type = 'highpass';
    hp1.frequency.value = TransitionProcessor.OFF_HZ;
    hp1.Q.value = TransitionProcessor.BUTTERWORTH_Q[0];

    const hp2 = ctx.createBiquadFilter();
    hp2.type = 'highpass';
    hp2.frequency.value = TransitionProcessor.OFF_HZ;
    hp2.Q.value = TransitionProcessor.BUTTERWORTH_Q[1];

    const lp1 = ctx.createBiquadFilter();
    lp1.type = 'lowpass';
    lp1.frequency.value = TransitionProcessor.OPEN_HZ;
    lp1.Q.value = TransitionProcessor.BUTTERWORTH_Q[0];

    const lp2 = ctx.createBiquadFilter();
    lp2.type = 'lowpass';
    lp2.frequency.value = TransitionProcessor.OPEN_HZ;
    lp2.Q.value = TransitionProcessor.BUTTERWORTH_Q[1];

    // Cascade: hp1 -> hp2 -> lp1 -> lp2
    hp1.connect(hp2);
    hp2.connect(lp1);
    lp1.connect(lp2);

    const setCutoffs = (
      lpHz: number,
      hpHz: number,
      ctxTime = ctx.currentTime,
      rampSec = 0
    ) => {
      const clampedLp = Math.max(
        TransitionProcessor.MIN_HZ,
        Math.min(TransitionProcessor.OPEN_HZ, lpHz)
      );
      const clampedHp = Math.max(
        TransitionProcessor.OFF_HZ,
        Math.min(TransitionProcessor.MAX_HIGH_PASS_HZ, hpHz)
      );

      if (rampSec > 0) {
        lp1.frequency.cancelScheduledValues(ctxTime);
        lp2.frequency.cancelScheduledValues(ctxTime);
        hp1.frequency.cancelScheduledValues(ctxTime);
        hp2.frequency.cancelScheduledValues(ctxTime);

        lp1.frequency.setValueAtTime(lp1.frequency.value, ctxTime);
        lp2.frequency.setValueAtTime(lp2.frequency.value, ctxTime);
        hp1.frequency.setValueAtTime(hp1.frequency.value, ctxTime);
        hp2.frequency.setValueAtTime(hp2.frequency.value, ctxTime);

        lp1.frequency.exponentialRampToValueAtTime(clampedLp, ctxTime + rampSec);
        lp2.frequency.exponentialRampToValueAtTime(clampedLp, ctxTime + rampSec);
        hp1.frequency.exponentialRampToValueAtTime(clampedHp, ctxTime + rampSec);
        hp2.frequency.exponentialRampToValueAtTime(clampedHp, ctxTime + rampSec);
      } else {
        lp1.frequency.setValueAtTime(clampedLp, ctxTime);
        lp2.frequency.setValueAtTime(clampedLp, ctxTime);
        hp1.frequency.setValueAtTime(clampedHp, ctxTime);
        hp2.frequency.setValueAtTime(clampedHp, ctxTime);
      }
    };

    const open = () => {
      setCutoffs(TransitionProcessor.OPEN_HZ, TransitionProcessor.OFF_HZ);
    };

    return {
      input: hp1,
      output: lp2,
      lowpass1: lp1,
      lowpass2: lp2,
      highpass1: hp1,
      highpass2: hp2,
      setCutoffs,
      open,
    };
  }

  /**
   * Creates a tempo-synced feedback echo delay graph in Web Audio.
   */
  public static createEchoDelayNodes(ctx: AudioContext): {
    input: AudioNode;
    output: AudioNode;
    setEcho: (bpm: number, sendGain: number, dryGain: number, beatFraction?: number) => void;
    parkEcho: () => void;
  } {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const dry = ctx.createGain();
    const send = ctx.createGain();
    const wet = ctx.createGain();
    wet.gain.value = TransitionProcessor.ECHO_WET;

    const feedback = ctx.createGain();
    feedback.gain.value = TransitionProcessor.ECHO_FEEDBACK;

    const delay = ctx.createDelay(TransitionProcessor.MAX_ECHO_SECONDS);
    delay.delayTime.value = 0.5;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = TransitionProcessor.ECHO_LOW_PASS_HZ;

    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = TransitionProcessor.ECHO_HIGH_PASS_HZ;

    // Dry path
    input.connect(dry);
    dry.connect(output);

    // Wet path
    input.connect(send);
    send.connect(delay);
    delay.connect(wet);
    wet.connect(output);

    // Feedback loop with damping filters
    delay.connect(lowpass);
    lowpass.connect(highpass);
    highpass.connect(feedback);
    feedback.connect(delay);

    const setEcho = (bpm: number, sendGainVal: number, dryGainVal: number, beatFraction = 1.0) => {
      const safeBpm = bpm && bpm > 30 && bpm < 300 ? bpm : 120;
      const delaySec = Math.min(
        TransitionProcessor.MAX_ECHO_SECONDS,
        (60 / safeBpm) * beatFraction
      );
      const now = ctx.currentTime;
      delay.delayTime.setValueAtTime(delaySec, now);
      send.gain.setValueAtTime(Math.max(0, Math.min(1, sendGainVal)), now);
      dry.gain.setValueAtTime(Math.max(0, Math.min(1, dryGainVal)), now);
    };

    const parkEcho = () => {
      const now = ctx.currentTime;
      send.gain.setValueAtTime(0, now);
      dry.gain.setValueAtTime(1, now);
    };

    return { input, output, setEcho, parkEcho };
  }
}
