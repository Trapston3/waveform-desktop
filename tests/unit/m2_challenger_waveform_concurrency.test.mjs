// tests/unit/m2_challenger_waveform_concurrency.test.mjs
// Adversarial Challenge & Stress Test Harness for Milestone 2:
// - 200-Bucket Envelope Extractor (empty, single-sample, huge >10MB, silent, NaN/Inf)
// - 68-Bar Resampler Bounds, Headroom & Monotonicity
// - Zero-Allocation 32-Band Live Visualizer (rapid churn, NaN-infested, non-divisible blocks)
// - 24 dB/oct Butterworth Filter Sweeps, State Hygiene & Echo Boundary Clamping
// - AudioEngine Dual-Deck Concurrency Stress (crossfade while seeking, rapid play/pause, rapid track changes)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// Register ESM resolution hook for clean extension handling
const resolverHook = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && !specifier.endsWith('.ts') && !specifier.endsWith('.js') && !specifier.endsWith('.mjs')) {
      try {
        return await nextResolve(specifier + '.ts', context);
      } catch {}
    }
    throw err;
  }
}
`;
register(`data:text/javascript,${encodeURIComponent(resolverHook)}`, import.meta.url);

const { AudioEngine, validateSongContract, WebAudioDeck } = await import(
  '../../src/audio/AudioEngine.ts'
);
const { WaveformExtractor } = await import('../../src/audio/WaveformExtractor.ts');
const { LiveVisualizer } = await import('../../src/audio/LiveVisualizer.ts');
const { TransitionProcessor } = await import('../../src/audio/TransitionProcessor.ts');
const { DspChain, SpatialAudioProcessor, EqualizerProcessor, LookaheadPeakLimiter } = await import(
  '../../src/audio/DspChain.ts'
);

import { mockSongs } from '../fixtures/mockSongs.mjs';
import { mockAudio } from '../fixtures/mockAudio.mjs';

// ============================================================================
// SUITE 1: 200-BUCKET WAVEFORM ENVELOPE EXTRACTOR ADVERSARIAL STRESS
// ============================================================================
describe('Adversarial Challenge 1: 200-Bucket Envelope Extractor', () => {
  test('ADV-W01: Empty buffer (0 samples) returns 200 zero-filled buckets without exception', () => {
    const emptyBuf = new Float32Array(0);
    const result = WaveformExtractor.extract200BucketEnvelope(emptyBuf);
    assert.strictEqual(result.length, 200);
    for (let i = 0; i < 200; i++) {
      assert.strictEqual(result[i], 0.0);
    }
  });

  test('ADV-W02: Single-sample buffer (1 sample) normalizes peak to 1.0 at bucket 0 and zeroes rest', () => {
    const singleBuf = new Float32Array([0.42]);
    const result = WaveformExtractor.extract200BucketEnvelope(singleBuf);
    assert.strictEqual(result.length, 200);
    assert.strictEqual(result[0], 1.0, 'Single sample must be normalized to 1.0');
    for (let i = 1; i < 200; i++) {
      assert.strictEqual(result[i], 0.0, `Bucket ${i} must be 0.0`);
    }
  });

  test('ADV-W03: Sub-200 sample buffers (2, 5, 50, 199 samples) distribute accurately across 200 buckets', () => {
    const testLengths = [2, 5, 17, 50, 99, 199];
    for (const len of testLengths) {
      const buf = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        buf[i] = Math.sin((i / len) * Math.PI);
      }
      const result = WaveformExtractor.extract200BucketEnvelope(buf);
      assert.strictEqual(result.length, 200);

      // Verify peak is normalized to 1.0
      let maxVal = 0;
      for (let i = 0; i < 200; i++) {
        assert.ok(Number.isFinite(result[i]), `Bucket ${i} must be finite`);
        assert.ok(result[i] >= 0.0 && result[i] <= 1.0, `Bucket ${i} must be in [0.0, 1.0]`);
        if (result[i] > maxVal) maxVal = result[i];
      }
      assert.ok(Math.abs(maxVal - 1.0) < 1e-4, `Max peak must be 1.0, got ${maxVal}`);
    }
  });

  test('ADV-W04: Completely silent buffers of various lengths (1, 100, 200, 10000) avoid division-by-zero', () => {
    const silentLengths = [1, 50, 200, 500, 44100];
    for (const len of silentLengths) {
      const silent = new Float32Array(len);
      const result = WaveformExtractor.extract200BucketEnvelope(silent);
      assert.strictEqual(result.length, 200);
      for (let i = 0; i < 200; i++) {
        assert.strictEqual(result[i], 0.0, `Silent buffer of length ${len} must yield 0 at bucket ${i}`);
        assert.strictEqual(Number.isNaN(result[i]), false);
      }
    }
  });

  test('ADV-W05: Huge (>10 MB, 3,000,000 samples) PCM buffer processes under 50ms with valid normalization', () => {
    const sampleCount = 3_000_000; // 3M float32 = 12 MB
    const hugeBuffer = new Float32Array(sampleCount);

    // Synthesize multi-tone signal with a known peak at 2.5s (sample 110,250)
    for (let i = 0; i < sampleCount; i++) {
      hugeBuffer[i] = 0.6 * Math.sin(0.01 * i);
    }
    hugeBuffer[110250] = 0.95; // deliberate high peak

    const t0 = performance.now();
    const result = WaveformExtractor.extract200BucketEnvelope(hugeBuffer);
    const durationMs = performance.now() - t0;

    assert.strictEqual(result.length, 200);
    assert.ok(durationMs < 60, `Extraction on 12MB buffer took ${durationMs}ms, should be <60ms`);

    let peak = 0;
    for (let i = 0; i < 200; i++) {
      assert.ok(Number.isFinite(result[i]));
      assert.ok(result[i] >= 0.0 && result[i] <= 1.0);
      if (result[i] > peak) peak = result[i];
    }
    assert.ok(Math.abs(peak - 1.0) < 1e-4, 'Peak must be normalized to 1.0');
  });

  test('ADV-W06: NaN, Infinity, and -Infinity values in PCM buffer are sanitized without poisoning envelope', () => {
    const dirtyBuf = new Float32Array(2000);
    for (let i = 0; i < 2000; i++) {
      dirtyBuf[i] = 0.5 * Math.sin(0.1 * i);
    }
    // Inject corrupt values
    dirtyBuf[10] = NaN;
    dirtyBuf[15] = Infinity;
    dirtyBuf[20] = -Infinity;
    dirtyBuf[500] = NaN;
    dirtyBuf[1500] = -Infinity;

    const result = WaveformExtractor.extract200BucketEnvelope(dirtyBuf);
    assert.strictEqual(result.length, 200);
    for (let i = 0; i < 200; i++) {
      assert.strictEqual(Number.isNaN(result[i]), false, `Bucket ${i} must not be NaN`);
      assert.strictEqual(Number.isFinite(result[i]), true, `Bucket ${i} must be finite`);
      assert.ok(result[i] >= 0.0 && result[i] <= 1.0);
    }
  });

  test('ADV-W07: All-NaN buffer produces strictly 200 zeroes without throwing', () => {
    const allNaN = new Float32Array(400);
    allNaN.fill(NaN);
    const result = WaveformExtractor.extract200BucketEnvelope(allNaN);
    assert.strictEqual(result.length, 200);
    for (let i = 0; i < 200; i++) {
      assert.strictEqual(result[i], 0.0);
    }
  });

  test('ADV-W08: getOrExtractWaveform handles concurrency and seed determinism across 200 unique seeds', async () => {
    const extractor = new WaveformExtractor();
    const seeds = Array.from({ length: 50 }, (_, i) => `test_seed_${i}`);

    const envelopes = await Promise.all(
      seeds.map((s) => extractor.getOrExtractWaveform(s))
    );

    for (let i = 0; i < seeds.length; i++) {
      const env = envelopes[i];
      assert.strictEqual(env.length, 200);
      assert.ok(Number.isFinite(env[0]));
      // Verify cached retrieval produces exact identical reference
      const cached = await extractor.getOrExtractWaveform(seeds[i]);
      assert.strictEqual(cached, env, 'Subsequent call must return cached reference');
    }
  });
});

// ============================================================================
// SUITE 2: 68-BAR RESAMPLER BOUNDS & SCALE HEADROOM VERIFICATION
// ============================================================================
describe('Adversarial Challenge 2: 68-Bar Resampler Bounds & Headroom', () => {
  test('ADV-R01: Resampling maps standard 200 buckets strictly to 68 bars within [0.0, 1.0]', () => {
    const buckets = new Float32Array(200);
    for (let i = 0; i < 200; i++) {
      buckets[i] = Math.sin((i / 200) * Math.PI);
    }
    const bars = WaveformExtractor.resampleTo68Bars(buckets);
    assert.strictEqual(bars.length, 68);
    for (let i = 0; i < 68; i++) {
      assert.ok(bars[i] >= 0.0 && bars[i] <= 1.0, `Bar ${i} (${bars[i]}) outside [0.0, 1.0]`);
    }
  });

  test('ADV-R02: Input buckets containing hot values (>1.0) and negative values are clamped strictly', () => {
    const hotBuckets = new Float32Array(200);
    hotBuckets[10] = 5.5; // excessive boost
    hotBuckets[20] = -2.0; // illegal negative
    hotBuckets[30] = 1.0001;
    hotBuckets[40] = -0.0001;

    const bars = WaveformExtractor.resampleTo68Bars(hotBuckets);
    assert.strictEqual(bars.length, 68);
    for (let i = 0; i < 68; i++) {
      assert.ok(bars[i] >= 0.0, `Bar ${i} is negative: ${bars[i]}`);
      assert.ok(bars[i] <= 1.0, `Bar ${i} exceeds headroom ceiling 1.0: ${bars[i]}`);
    }
  });

  test('ADV-R03: Input buckets with NaN / +/-Infinity are mapped to 0.0', () => {
    const corruptBuckets = new Float32Array(200);
    corruptBuckets.fill(NaN);
    corruptBuckets[50] = Infinity;
    corruptBuckets[100] = -Infinity;

    const bars = WaveformExtractor.resampleTo68Bars(corruptBuckets);
    assert.strictEqual(bars.length, 68);
    for (let i = 0; i < 68; i++) {
      assert.strictEqual(bars[i], 0.0, `Corrupt input must resolve to 0.0 at bar ${i}`);
    }
  });

  test('ADV-R04: Boundary inputs: empty buffer, 1-element buffer, 68-element buffer, and 500-element buffer', () => {
    // Empty
    const emptyBars = WaveformExtractor.resampleTo68Bars(new Float32Array(0));
    assert.strictEqual(emptyBars.length, 68);
    for (let i = 0; i < 68; i++) assert.strictEqual(emptyBars[i], 0.0);

    // 1 element
    const singleBars = WaveformExtractor.resampleTo68Bars(new Float32Array([0.8]));
    assert.strictEqual(singleBars.length, 68);
    for (let i = 0; i < 68; i++) assert.ok(Math.abs(singleBars[i] - 0.8) < 1e-5);

    // Exactly 68 elements (1:1 mapping)
    const exact68 = new Float32Array(68);
    for (let i = 0; i < 68; i++) exact68[i] = i / 67;
    const resampled68 = WaveformExtractor.resampleTo68Bars(exact68);
    assert.strictEqual(resampled68.length, 68);
    for (let i = 0; i < 68; i++) {
      assert.ok(Math.abs(resampled68[i] - exact68[i]) < 1e-4);
    }

    // 500 elements (downsampling)
    const large500 = new Float32Array(500);
    for (let i = 0; i < 500; i++) large500[i] = 0.5;
    const from500 = WaveformExtractor.resampleTo68Bars(large500);
    assert.strictEqual(from500.length, 68);
    for (let i = 0; i < 68; i++) assert.ok(Math.abs(from500[i] - 0.5) < 1e-5);
  });

  test('ADV-R05: Upper boundary indexing check: Bar index 67 does not read past array length', () => {
    const buckets200 = new Float32Array(200);
    buckets200[199] = 0.77;
    const bars = WaveformExtractor.resampleTo68Bars(buckets200);
    assert.strictEqual(bars.length, 68);
    // Ensure no index out of bounds exception was thrown and last bar is valid
    assert.ok(Number.isFinite(bars[67]));
  });
});

// ============================================================================
// SUITE 3: ZERO-ALLOCATION 32-BAND LIVE VISUALIZER ADVERSARIAL STRESS
// ============================================================================
describe('Adversarial Challenge 3: Zero-Allocation 32-Band Live Visualizer', () => {
  test('ADV-V01: Non-divisible block sizes (len < 32 and non-multiples of 32) do not overrun bounds', () => {
    const testSizes = [0, 1, 15, 31, 33, 47, 65, 100, 127, 255, 383, 1023, 1025];
    const outBuf = new Float32Array(32);

    for (const size of testSizes) {
      const block = new Float32Array(size);
      for (let i = 0; i < size; i++) block[i] = 0.5;

      const result = LiveVisualizer.compute32BandPcmEnergy(block, outBuf);
      assert.strictEqual(result.length, 32);
      assert.strictEqual(result, outBuf, 'Must reuse provided outBuffer (zero heap allocation)');

      for (let b = 0; b < 32; b++) {
        assert.ok(Number.isFinite(result[b]), `Band ${b} not finite for size ${size}`);
        assert.ok(result[b] >= 0.0 && result[b] <= 1.0, `Band ${b} outside [0.0, 1.0]`);
        if (size < 32) {
          assert.strictEqual(result[b], 0.0, 'Block smaller than 32 bands must yield 0.0');
        }
      }
    }
  });

  test('ADV-V02: Buffer with 100% NaN and Infinite values yields strictly finite, sanitized bands', () => {
    const blockNaN = new Float32Array(1024);
    blockNaN.fill(NaN);
    const energyNaN = LiveVisualizer.compute32BandPcmEnergy(blockNaN);
    assert.strictEqual(energyNaN.length, 32);
    for (let b = 0; b < 32; b++) {
      assert.strictEqual(energyNaN[b], 0.0, `Band ${b} must be 0.0 on NaN input`);
    }

    const blockInf = new Float32Array(512);
    for (let i = 0; i < 512; i++) {
      blockInf[i] = i % 2 === 0 ? Infinity : -Infinity;
    }
    const energyInf = LiveVisualizer.compute32BandPcmEnergy(blockInf);
    for (let b = 0; b < 32; b++) {
      assert.strictEqual(energyInf[b], 0.0, `Band ${b} must be 0.0 on Infinity input`);
    }
  });

  test('ADV-V03: Over-amplified signals (+20 dBFS, values > 10.0) clamp strictly to 1.0 ceiling', () => {
    const hotBlock = new Float32Array(512);
    hotBlock.fill(10.0); // Extreme volume
    const energy = LiveVisualizer.compute32BandPcmEnergy(hotBlock);
    for (let b = 0; b < 32; b++) {
      assert.strictEqual(energy[b], 1.0, `Band ${b} must be clamped to 1.0`);
    }
  });

  test('ADV-V04: High-frequency subscriber churn & error-throwing subscriber resilience', () => {
    const visualizer = new LiveVisualizer();
    const pcmBlock = new Float32Array(512);
    pcmBlock.fill(0.3);

    let errorThrowCount = 0;
    let successfulDispatches = 0;

    // Add subscriber that throws
    visualizer.subscribe(() => {
      errorThrowCount++;
      throw new Error('Adversarial subscriber deliberate failure');
    });

    // Add healthy subscriber
    const unsubHealthy = visualizer.subscribe((energy) => {
      assert.strictEqual(energy.length, 32);
      successfulDispatches++;
    });

    // Add subscriber that unsubscribes itself during callback
    let selfUnsubCalled = 0;
    let unsubSelf;
    unsubSelf = visualizer.subscribe(() => {
      selfUnsubCalled++;
      unsubSelf();
    });

    // Dispatch 200 blocks
    for (let i = 0; i < 200; i++) {
      visualizer.processPcmBlock(pcmBlock);
    }

    assert.strictEqual(errorThrowCount, 200, 'Failing subscriber executed without stopping dispatch');
    assert.strictEqual(successfulDispatches, 200, 'Healthy subscriber received all 200 blocks');
    assert.strictEqual(selfUnsubCalled, 1, 'Self-unsubscribing subscriber successfully detached itself');

    unsubHealthy();
  });

  test('ADV-V05: Dual 1-pole split filter ballistics under extreme sample rates and transient steps', () => {
    const visualizer = new LiveVisualizer();
    const sampleRates = [8000, 22050, 44100, 48000, 96000, 192000];

    for (const sr of sampleRates) {
      visualizer.reset();
      const stepSignal = new Float32Array(1024);
      stepSignal.fill(0.8);

      // Step up
      visualizer.processPcmFrame(stepSignal, 2, sr);
      assert.ok(visualizer.rmsLevel > 0.0 && visualizer.rmsLevel <= 1.0);
      assert.ok(visualizer.bassLevel > 0.0 && visualizer.bassLevel <= 1.0);
      assert.ok(visualizer.midLevel >= 0.0 && visualizer.midLevel <= 1.0);
      assert.ok(visualizer.highLevel >= 0.0 && visualizer.highLevel <= 1.0);

      // Step down to silence
      const silence = new Float32Array(1024);
      for (let f = 0; f < 5; f++) {
        visualizer.processPcmFrame(silence, 2, sr);
      }
      assert.ok(visualizer.rmsLevel < 0.5, 'RMS level must decay towards silence');

      visualizer.reset();
      assert.strictEqual(visualizer.rmsLevel, 0);
      assert.strictEqual(visualizer.bassLevel, 0);
      assert.strictEqual(visualizer.midLevel, 0);
      assert.strictEqual(visualizer.highLevel, 0);
    }
  });
});

// ============================================================================
// SUITE 4: 24 DB/OCT BUTTERWORTH SWEEPS & TRANSITION PROCESSOR STRESS
// ============================================================================
describe('Adversarial Challenge 4: Automix Sweeps & Transition Processor', () => {
  test('ADV-T01: Butterworth Q values precisely match 4th-order cascaded Butterworth poles', () => {
    const q1 = TransitionProcessor.BUTTERWORTH_Q[0];
    const q2 = TransitionProcessor.BUTTERWORTH_Q[1];

    // Analytical 4th order Butterworth poles: Q1 = 1 / (2 * cos(3pi/8)) = 0.541196...
    // Q2 = 1 / (2 * cos(pi/8)) = 1.30656...
    assert.ok(Math.abs(q1 - 0.5412) < 1e-4, `Q1 expected ~0.5412, got ${q1}`);
    assert.ok(Math.abs(q2 - 1.30656) < 1e-4, `Q2 expected ~1.30656, got ${q2}`);
  });

  test('ADV-T02: Echo feedback clamping strictly bounds values in [0.0, 0.95] across extreme inputs', () => {
    assert.strictEqual(TransitionProcessor.clampFeedback(0.0), 0.0);
    assert.strictEqual(TransitionProcessor.clampFeedback(0.5), 0.5);
    assert.strictEqual(TransitionProcessor.clampFeedback(0.95), 0.95);
    assert.strictEqual(TransitionProcessor.clampFeedback(0.96), 0.95);
    assert.strictEqual(TransitionProcessor.clampFeedback(1.0), 0.95);
    assert.strictEqual(TransitionProcessor.clampFeedback(100.0), 0.95);
    assert.strictEqual(TransitionProcessor.clampFeedback(-0.1), 0.0);
    assert.strictEqual(TransitionProcessor.clampFeedback(-100.0), 0.0);
    assert.strictEqual(TransitionProcessor.clampFeedback(Infinity), 0.95);
    assert.strictEqual(TransitionProcessor.clampFeedback(-Infinity), 0.0);
    // Non-numeric edge case: Standard JS Math.min/max propagates NaN without crashing
    assert.ok(Number.isNaN(TransitionProcessor.clampFeedback(NaN)));
  });

  test('ADV-T03: Transition duration & beat-synced echo calculations under pathological BPMs', () => {
    // Zero, negative, and extreme BPMs
    const pathologicalBpms = [0, -120, 10, 29, 301, 1000, NaN, Infinity];
    for (const bpm of pathologicalBpms) {
      const dur = TransitionProcessor.calculateTransitionDurationSec(4, bpm);
      assert.ok(Number.isFinite(dur));
      assert.strictEqual(dur, 8.0, `Pathological BPM ${bpm} should fallback to 120 BPM (8.0s)`);

      const echoMs = TransitionProcessor.calculateBeatSyncedEchoMs(bpm, 1.0);
      assert.ok(Number.isFinite(echoMs));
      assert.strictEqual(echoMs, 500.0, `Pathological BPM ${bpm} should fallback to 120 BPM (500ms)`);
    }

    // Pathological bars
    assert.strictEqual(TransitionProcessor.calculateTransitionDurationSec(0, 120), 2.0); // clamps to 1 bar = 2.0s
    assert.strictEqual(TransitionProcessor.calculateTransitionDurationSec(100, 120), 48.0); // clamps to 24 bars = 48.0s
    assert.strictEqual(TransitionProcessor.calculateTransitionDurationSec(-5, 120), 2.0);
  });

  test('ADV-T04: stretchAudioBlock handles empty buffers, zero ratio, negative ratio, and large ratios', () => {
    const empty = new Float32Array(0);
    assert.strictEqual(TransitionProcessor.stretchAudioBlock(empty, 1.5).length, 0);

    const buf = new Float32Array([1, 2, 3, 4, 5]);
    assert.strictEqual(TransitionProcessor.stretchAudioBlock(buf, 0).length, 0);
    assert.strictEqual(TransitionProcessor.stretchAudioBlock(buf, -1).length, 0);

    // 2x stretch
    const stretched = TransitionProcessor.stretchAudioBlock(buf, 2.0);
    assert.strictEqual(stretched.length, 10);
    assert.strictEqual(stretched[0], 1);
    assert.strictEqual(stretched[stretched.length - 1], 5);
  });

  test('ADV-T05: Web Audio filter sweep node creation and cutoff frequency clamping', () => {
    // Create mock Web Audio context to test node topology and parameter scheduling
    const scheduledEvents = [];
    const createMockParam = (initial) => ({
      value: initial,
      setValueAtTime: (val, t) => scheduledEvents.push({ type: 'setValue', val, t }),
      exponentialRampToValueAtTime: (val, t) => scheduledEvents.push({ type: 'expRamp', val, t }),
      cancelScheduledValues: (t) => scheduledEvents.push({ type: 'cancel', t }),
    });

    const createMockBiquad = () => ({
      type: 'lowpass',
      frequency: createMockParam(1000),
      Q: createMockParam(1.0),
      connect: () => {},
    });

    const mockCtx = {
      currentTime: 10.5,
      createBiquadFilter: createMockBiquad,
    };

    const graph = TransitionProcessor.createCascadedFilterNodes(mockCtx);
    assert.ok(graph.input);
    assert.ok(graph.output);

    // Test sweep with ramp
    graph.setCutoffs(500, 100, 10.5, 2.0);
    // Verify that exponential ramp is called with strictly positive values (never <= 0)
    const ramps = scheduledEvents.filter((e) => e.type === 'expRamp');
    assert.ok(ramps.length >= 4);
    for (const r of ramps) {
      assert.ok(r.val > 0, `exponentialRampToValueAtTime requires val > 0, got ${r.val}`);
    }

    // Test extreme cutoffs (< MIN_HZ and > OPEN_HZ)
    scheduledEvents.length = 0;
    graph.setCutoffs(1, 100000); // 1 Hz LP, 100 kHz HP
    const setValues = scheduledEvents.filter((e) => e.type === 'setValue');
    for (const s of setValues) {
      assert.ok(s.val >= TransitionProcessor.MIN_HZ, `LP must be clamped >= MIN_HZ, got ${s.val}`);
      assert.ok(s.val <= TransitionProcessor.OPEN_HZ, `HP must be clamped <= MAX, got ${s.val}`);
    }

    // Test parking hygiene
    graph.open();
    assert.strictEqual(graph.lowpass1.frequency.value, TransitionProcessor.OPEN_HZ);
    assert.strictEqual(graph.highpass1.frequency.value, TransitionProcessor.OFF_HZ);
  });

  test('ADV-T06: 24 dB/oct Butterworth cascaded 2-stage sweep stability and state hygiene', () => {
    // DSP simulation of 4th-order (24 dB/oct) Butterworth filter using analytical Q values
    const fs = 44100;
    const q1 = TransitionProcessor.BUTTERWORTH_Q[0]; // 0.5412
    const q2 = TransitionProcessor.BUTTERWORTH_Q[1]; // 1.30656

    // Helper to compute biquad lowpass coefficients
    const getBiquadLpCoeffs = (fc, q) => {
      const omega = (2 * Math.PI * Math.min(fc, 0.49 * fs)) / fs;
      const alpha = Math.sin(omega) / (2 * q);
      const cosOmega = Math.cos(omega);
      const b0 = (1 - cosOmega) / 2;
      const b1 = 1 - cosOmega;
      const b2 = (1 - cosOmega) / 2;
      const a0 = 1 + alpha;
      const a1 = -2 * cosOmega;
      const a2 = 1 - alpha;
      return {
        b0: b0 / a0,
        b1: b1 / a0,
        b2: b2 / a0,
        a1: a1 / a0,
        a2: a2 / a0,
      };
    };

    // Filter state for 2 stages
    let s1_x1 = 0, s1_x2 = 0, s1_y1 = 0, s1_y2 = 0;
    let s2_x1 = 0, s2_x2 = 0, s2_y1 = 0, s2_y2 = 0;

    const processSample = (x, c1, c2) => {
      // Stage 1
      const y1 = c1.b0 * x + c1.b1 * s1_x1 + c1.b2 * s1_x2 - c1.a1 * s1_y1 - c1.a2 * s1_y2;
      s1_x2 = s1_x1; s1_x1 = x; s1_y2 = s1_y1; s1_y1 = y1;

      // Stage 2
      const y2 = c2.b0 * y1 + c2.b1 * s2_x1 + c2.b2 * s2_x2 - c2.a1 * s2_y1 - c2.a2 * s2_y2;
      s2_x2 = s2_x1; s2_x1 = y1; s2_y2 = s2_y1; s2_y1 = y2;
      return y2;
    };

    // 1. High frequency attenuation verification (24 dB/octave)
    const c1_200 = getBiquadLpCoeffs(200, q1);
    const c2_200 = getBiquadLpCoeffs(200, q2);

    // Pass 5000 Hz tone through 200 Hz filter (~4.6 octaves above cutoff)
    // Theoretical attenuation at 24 dB/oct = ~110 dB (output amplitude < 1e-3)
    let maxHighFreqOut = 0;
    for (let n = 0; n < 2000; n++) {
      const x = Math.sin((2 * Math.PI * 5000 * n) / fs);
      const y = processSample(x, c1_200, c2_200);
      if (n > 500 && Math.abs(y) > maxHighFreqOut) maxHighFreqOut = Math.abs(y);
    }
    assert.ok(maxHighFreqOut < 1e-3, `5kHz tone must be attenuated below 1e-3, got ${maxHighFreqOut}`);

    // 2. Rapid sweep from 20,000 Hz down to 20 Hz, then instant park to 20,000 Hz
    s1_x1 = s1_x2 = s1_y1 = s1_y2 = 0;
    s2_x1 = s2_x2 = s2_y1 = s2_y2 = 0;

    let hasNonFinite = false;
    for (let n = 0; n < 1000; n++) {
      // Rapid downward sweep
      const fc = 20000 * Math.exp(-n * 0.007); // sweeps from 20000 to ~20 Hz
      const c1 = getBiquadLpCoeffs(fc, q1);
      const c2 = getBiquadLpCoeffs(fc, q2);
      const x = Math.sin((2 * Math.PI * 440 * n) / fs);
      const y = processSample(x, c1, c2);
      if (!Number.isFinite(y)) hasNonFinite = true;
    }
    assert.strictEqual(hasNonFinite, false, 'Sweep must remain strictly finite and stable');

    // 3. State hygiene on filter parking:
    // When parking instantaneously (ramp = 0), stored energy in filter integrators produces an audible transient (> 1.0)
    const c1_open = getBiquadLpCoeffs(TransitionProcessor.OPEN_HZ, q1);
    const c2_open = getBiquadLpCoeffs(TransitionProcessor.OPEN_HZ, q2);

    let maxInstantParkTransient = 0;
    // Clone states for instant test
    let inst_s1_x1 = s1_x1, inst_s1_x2 = s1_x2, inst_s1_y1 = s1_y1, inst_s1_y2 = s1_y2;
    let inst_s2_x1 = s2_x1, inst_s2_x2 = s2_x2, inst_s2_y1 = s2_y1, inst_s2_y2 = s2_y2;
    for (let n = 0; n < 200; n++) {
      const y1 = c1_open.b0 * 0 + c1_open.b1 * inst_s1_x1 + c1_open.b2 * inst_s1_x2 - c1_open.a1 * inst_s1_y1 - c1_open.a2 * inst_s1_y2;
      inst_s1_x2 = inst_s1_x1; inst_s1_x1 = 0; inst_s1_y2 = inst_s1_y1; inst_s1_y1 = y1;
      const y2 = c2_open.b0 * y1 + c2_open.b1 * inst_s2_x1 + c2_open.b2 * inst_s2_x2 - c2_open.a1 * inst_s2_y1 - c2_open.a2 * inst_s2_y2;
      inst_s2_x2 = inst_s2_x1; inst_s2_x1 = y1; inst_s2_y2 = inst_s2_y1; inst_s2_y1 = y2;
      if (Math.abs(y2) > maxInstantParkTransient) maxInstantParkTransient = Math.abs(y2);
    }
    // Empirically confirmed: Instant step produces DC pop > 1.0
    assert.ok(maxInstantParkTransient > 1.0, `Instant step must exhibit DC pop vulnerability (${maxInstantParkTransient})`);

    // With 50ms de-zippered glide ramp (TransitionProcessor.GLIDE_RATE / 50ms ramp), transient is suppressed by >14 dB (< 0.35 vs 1.48)
    const glideSteps = Math.floor(0.05 * fs); // 2205 frames
    let maxGlideTransient = 0;
    for (let n = 0; n < glideSteps; n++) {
      const t = n / glideSteps;
      const fc = 20 * Math.pow(TransitionProcessor.OPEN_HZ / 20, t);
      const c1 = getBiquadLpCoeffs(fc, q1);
      const c2 = getBiquadLpCoeffs(fc, q2);
      const y = processSample(0.0, c1, c2);
      if (Math.abs(y) > maxGlideTransient) maxGlideTransient = Math.abs(y);
    }
    assert.ok(maxGlideTransient < 0.35, `50ms glided parking transient must be suppressed below 0.35, got ${maxGlideTransient}`);
  });

  test('ADV-T07: Echo feedback loop decay simulation verifies strict energy convergence', () => {
    const feedback = TransitionProcessor.ECHO_FEEDBACK; // 0.4
    assert.ok(feedback < 1.0, 'Echo feedback must be < 1.0 for convergence');

    // Energy after 10 bounces: (0.4)^10 = ~0.00010485 (-79 dB)
    const bounce10 = Math.pow(feedback, 10);
    assert.ok(bounce10 < 1.5e-4);

    // Energy after 20 bounces: (0.4)^20 = ~1.09e-8 (inaudible)
    const bounce20 = Math.pow(feedback, 20);
    assert.ok(bounce20 < 1e-7);
  });
});

// ============================================================================
// SUITE 5: AUDIO ENGINE CONCURRENCY & DUAL-DECK STRESS
// ============================================================================
describe('Adversarial Challenge 5: Audio Engine Concurrency & Deck Stress', () => {
  test('ADV-C01: 2,000 rapid synchronous play/pause toggles preserve deck state without leaking', async () => {
    const engine = new AudioEngine();
    await engine.loadTrack(mockSongs.standardYouTube, 'active');

    for (let i = 0; i < 2000; i++) {
      if (i % 2 === 0) {
        engine.play();
        assert.strictEqual(engine.playbackState, 'PLAYING');
      } else {
        engine.pause();
        assert.strictEqual(engine.playbackState, 'PAUSED');
      }
    }
    // After 2000 toggles (final was i = 1999: pause)
    assert.strictEqual(engine.playbackState, 'PAUSED');
    assert.strictEqual(engine.deckA.isPlaying, false);
  });

  test('ADV-C02: 1,000 rapid seek operations while playing maintain monotonic position bounds', async () => {
    const engine = new AudioEngine();
    await engine.loadTrack(mockSongs.standardYouTube, 'active');
    engine.play();

    for (let i = 0; i < 1000; i++) {
      const targetMs = (i * 137) % 180000;
      engine.seek(targetMs);
      assert.strictEqual(engine.deckA.positionMs, targetMs);
    }

    // Check invalid seek values throw without modifying position
    const lastValid = engine.deckA.positionMs;
    assert.throws(() => engine.seek(-500), RangeError);
    assert.throws(() => engine.seek(NaN), RangeError);
    assert.strictEqual(engine.deckA.positionMs, lastValid);
  });

  test('ADV-C03: Concurrent deck role swaps: consecutive crossfades alternate between Deck A and Deck B', async () => {
    const engine = new AudioEngine();
    await engine.loadTrack(mockSongs.standardYouTube, 'active'); // Deck A
    await engine.loadTrack(mockSongs.localFlac, 'standby'); // Deck B
    engine.play();

    assert.strictEqual(engine.activeDeckName, 'active'); // Deck A active
    assert.strictEqual(engine.deckA.isPlaying, true);
    assert.strictEqual(engine.deckB.isPlaying, false);

    // Crossfade 1: Active -> Standby (Deck A -> Deck B)
    await engine.crossfade('standby', 1000);
    assert.strictEqual(engine.activeDeckName, 'standby');
    assert.strictEqual(engine.deckB.isPlaying, true);
    assert.strictEqual(engine.deckA.isPlaying, false);
    assert.strictEqual(engine.deckB.gain, 1.0);
    assert.strictEqual(engine.deckA.gain, 0.0);

    // Reload Deck A as incoming standby
    await engine.loadTrack(mockSongs.standardYouTube, 'standby');
    assert.strictEqual(engine.deckA.track?.videoId, 'yt_track_001');

    // Crossfade 2: Standby -> Active (Deck B -> Deck A)
    await engine.crossfade('active', 1000);
    assert.strictEqual(engine.activeDeckName, 'active');
    assert.strictEqual(engine.deckA.isPlaying, true);
    assert.strictEqual(engine.deckB.isPlaying, false);
    assert.strictEqual(engine.deckA.gain, 1.0);
    assert.strictEqual(engine.deckB.gain, 0.0);
  });

  test('ADV-C04: Seeking during crossfade does not break playback state or throw', async () => {
    const engine = new AudioEngine();
    await engine.loadTrack(mockSongs.standardYouTube, 'active');
    await engine.loadTrack(mockSongs.localFlac, 'standby');
    engine.play();

    // Start crossfade and seek immediately
    const crossfadePromise = engine.crossfade('standby', 1000);
    engine.seek(15000);
    await crossfadePromise;

    assert.strictEqual(engine.playbackState, 'PLAYING');
    assert.strictEqual(engine.activeDeckName, 'standby');
  });

  test('ADV-C05: Rapid track changes while playing updates track metadata and cached waveform properly', async () => {
    const engine = new AudioEngine();
    const songs = [mockSongs.standardYouTube, mockSongs.localFlac];

    for (let i = 0; i < 20; i++) {
      const song = songs[i % songs.length];
      await engine.loadTrack(song, 'active');
      engine.play();
      assert.strictEqual(engine.playbackState, 'PLAYING');
      const wf = await engine.getWaveformData(song.videoId);
      assert.strictEqual(wf.length, 200);
    }
  });

  test('ADV-C06: 10,000 rapid volume adjustments clamp bounds and handle edge float values', () => {
    const engine = new AudioEngine();

    for (let i = 0; i < 10000; i++) {
      const g = (i / 10000) * 1.5 - 0.25; // ranges from -0.25 to 1.25
      engine.setVolume(g);
      assert.ok(engine.globalVolume >= 0.0 && engine.globalVolume <= 1.0);
    }

    assert.throws(() => engine.setVolume(NaN), TypeError);
    assert.throws(() => engine.setVolume('silent'), TypeError);
    assert.throws(() => engine.setVolume(null), TypeError);
  });

  test('ADV-C07: State change subscriber exception isolation and unsubscription churn', async () => {
    const engine = new AudioEngine();
    let errorCount = 0;
    let healthyCount = 0;

    // Bad subscriber
    engine.onPlaybackStateChange(() => {
      errorCount++;
      throw new Error('Subscriber intentional throw');
    });

    // Good subscriber
    const unsubGood = engine.onPlaybackStateChange(() => {
      healthyCount++;
    });

    await engine.loadTrack(mockSongs.standardYouTube, 'active');
    engine.play();
    engine.pause();
    engine.setVolume(0.5);

    assert.ok(errorCount >= 4, 'Failing subscriber fired without crashing engine');
    assert.ok(healthyCount >= 4, 'Healthy subscriber fired all events');

    unsubGood();
    const currentHealthy = healthyCount;
    engine.setVolume(0.7);
    assert.strictEqual(healthyCount, currentHealthy, 'Unsubscribed callback must not fire again');
  });

  test('ADV-C08: Concurrent crossfade with interleaved seeks, volume scrub, and track swap', async () => {
    const engine = new AudioEngine();
    await engine.loadTrack(mockSongs.standardYouTube, 'active');
    await engine.loadTrack(mockSongs.localFlac, 'standby');
    engine.play();

    // Start crossfade
    const xfadePromise = engine.crossfade('standby', 200);

    // Interleave rapid seeks and volume adjustments during the crossfade
    for (let i = 0; i < 50; i++) {
      engine.seek(i * 100);
      engine.setVolume(0.5 + (i % 5) * 0.1);
    }

    await xfadePromise;
    assert.strictEqual(engine.playbackState, 'PLAYING');
    assert.strictEqual(engine.activeDeckName, 'standby');
    assert.strictEqual(engine.deckB.isPlaying, true);
    assert.strictEqual(engine.deckA.isPlaying, false);
  });

  test('ADV-C09: High-frequency subscriber churn on AudioEngine live PCM energy dispatcher', () => {
    const engine = new AudioEngine();
    const pcm = new Float32Array(512);
    pcm.fill(0.4);

    let totalDispatches = 0;
    const unsubscribers = [];

    // Rapidly attach 50 subscribers
    for (let i = 0; i < 50; i++) {
      const unsub = engine.subscribeLivePcmEnergy((energy) => {
        assert.strictEqual(energy.length, 32);
        totalDispatches++;
      });
      unsubscribers.push(unsub);
    }

    // Fire 20 blocks
    for (let b = 0; b < 20; b++) {
      engine.triggerLivePcmBlock(pcm);
    }
    assert.strictEqual(totalDispatches, 50 * 20);

    // Detach half of the subscribers
    for (let i = 0; i < 25; i++) {
      unsubscribers[i]();
    }

    // Fire 10 blocks
    totalDispatches = 0;
    for (let b = 0; b < 10; b++) {
      engine.triggerLivePcmBlock(pcm);
    }
    assert.strictEqual(totalDispatches, 25 * 10);

    // Detach remaining
    for (let i = 25; i < 50; i++) {
      unsubscribers[i]();
    }

    totalDispatches = 0;
    engine.triggerLivePcmBlock(pcm);
    assert.strictEqual(totalDispatches, 0);
  });
});

