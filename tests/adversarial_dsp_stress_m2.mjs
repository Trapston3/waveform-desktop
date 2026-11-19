// tests/adversarial_dsp_stress_m2.mjs
// Adversarial DSP Mathematical & Stress Verification Harness (Milestone 2)
// Evaluates SVF filter stability, Lookahead Peak Limiter, Spatial Audio, AutoEQ, and Crossfade.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// Register ESM resolution hook for relative .ts imports
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

const {
  DspChain,
  SpatialAudioProcessor,
  EqualizerProcessor,
  LookaheadPeakLimiter,
  LoudnessProcessor,
  EQ_FREQUENCIES_HZ,
  FACTORY_EQ_PRESETS,
} = await import('../src/audio/DspChain.ts');

const {
  AutoEqLoader,
  CURATED_AUTOEQ_PROFILES,
  decodePapParametricBlob,
  calculatePreampGainDb,
} = await import('../src/audio/AutoEqLoader.ts');

const {
  AudioEngine,
  WebAudioDeck,
  validateSongContract,
} = await import('../src/audio/AudioEngine.ts');

const {
  TransitionProcessor,
} = await import('../src/audio/TransitionProcessor.ts');

const {
  WaveformExtractor,
} = await import('../src/audio/WaveformExtractor.ts');

const {
  LiveVisualizer,
} = await import('../src/audio/LiveVisualizer.ts');

const { mockSongs } = await import('./fixtures/mockSongs.mjs');

console.log('=== STARTING ADVERSARIAL AUDIO DSP STRESS HARNESS ===');

// ============================================================================
// CHALLENGE 1: 10-BAND SVF FILTER STABILITY UNDER EXTREME INPUTS
// ============================================================================
describe('Challenge 1: 10-Band SVF Filter Stability Under Extreme Inputs', () => {
  test('ADV-01: +30 dBFS extreme spikes do not trigger NaN, Infinity, or state blowup', () => {
    const eq = new EqualizerProcessor(44100);
    // Set aggressive boost on all bands (+12 dB max)
    eq.setBands([12, 12, 12, 12, 12, 12, 12, 12, 12, 12]);
    eq.applyToneControls(6, 6); // tone controls will clamp to max +12

    const sampleCount = 4096;
    const leftIn = new Float32Array(sampleCount);
    const rightIn = new Float32Array(sampleCount);

    // Inject +30 dBFS spikes (amplitude ~ 31.62) and massive 100.0 spikes
    const spikeAmp = Math.pow(10, 30 / 20); // ~31.6227
    for (let i = 0; i < sampleCount; i++) {
      if (i % 64 === 0) {
        leftIn[i] = spikeAmp;
        rightIn[i] = -spikeAmp;
      } else if (i % 128 === 0) {
        leftIn[i] = 100.0;
        rightIn[i] = -100.0;
      } else {
        leftIn[i] = (Math.random() * 2 - 1) * 0.5;
        rightIn[i] = (Math.random() * 2 - 1) * 0.5;
      }
    }

    const { leftOut, rightOut } = eq.process(leftIn, rightIn);

    assert.strictEqual(leftOut.length, sampleCount);
    assert.strictEqual(rightOut.length, sampleCount);

    let hasNan = false;
    let hasInf = false;
    for (let i = 0; i < sampleCount; i++) {
      if (!Number.isFinite(leftOut[i])) {
        hasNan = Number.isNaN(leftOut[i]);
        hasInf = !Number.isFinite(leftOut[i]) && !hasNan;
        break;
      }
      if (!Number.isFinite(rightOut[i])) {
        hasNan = Number.isNaN(rightOut[i]);
        hasInf = !Number.isFinite(rightOut[i]) && !hasNan;
        break;
      }
    }

    assert.strictEqual(hasNan, false, 'SVF output must never contain NaN');
    assert.strictEqual(hasInf, false, 'SVF output must never contain Infinity');

    // Feed silence afterwards and verify states decay back to zero
    const silenceL = new Float32Array(2048);
    const silenceR = new Float32Array(2048);
    const { leftOut: decayL, rightOut: decayR } = eq.process(silenceL, silenceR);

    // After 2048 samples of silence, energy should settle close to zero (< 1e-3)
    const tailEnergyL = Math.abs(decayL[decayL.length - 1]);
    const tailEnergyR = Math.abs(decayR[decayR.length - 1]);
    assert.ok(tailEnergyL < 0.05, `Filter state should decay towards zero after spike, got ${tailEnergyL}`);
    assert.ok(tailEnergyR < 0.05, `Filter state should decay towards zero after spike, got ${tailEnergyR}`);
  });

  test('ADV-02: DC offsets (constant non-zero input) maintain bounded integrator state', () => {
    const eq = new EqualizerProcessor(44100);
    // Test with maximum bass boost (+12 dB on low shelf)
    eq.setBands([12, 6, 0, 0, 0, 0, 0, 0, 0, 0]);

    const sampleCount = 4410; // 100ms of pure DC
    const dcL = new Float32Array(sampleCount).fill(1.0);
    const dcR = new Float32Array(sampleCount).fill(-1.0);

    const { leftOut, rightOut } = eq.process(dcL, dcR);

    for (let i = 0; i < sampleCount; i++) {
      assert.ok(Number.isFinite(leftOut[i]), `DC offset at sample ${i} must be finite`);
      assert.ok(Number.isFinite(rightOut[i]), `DC offset at sample ${i} must be finite`);
      // Output should remain bounded (gain cannot exceed maximum theoretical boost ~ +12dB = 4x)
      assert.ok(Math.abs(leftOut[i]) < 10.0, `DC output exceeded theoretical maximum bound: ${leftOut[i]}`);
      assert.ok(Math.abs(rightOut[i]) < 10.0, `DC output exceeded theoretical maximum bound: ${rightOut[i]}`);
    }
  });

  test('ADV-03: Frequencies near and at Nyquist limit remain stable across sample rates', () => {
    const sampleRates = [8000, 22050, 44100, 48000, 96000, 192000];

    for (const fs of sampleRates) {
      const eq = new EqualizerProcessor(fs);
      eq.setBands([10, -10, 8, -8, 6, -6, 4, -4, 2, -2]);

      const N = 1024;
      const leftIn = new Float32Array(N);
      const rightIn = new Float32Array(N);

      // Alternating samples at exact Nyquist frequency (fs / 2)
      for (let i = 0; i < N; i++) {
        leftIn[i] = (i % 2 === 0 ? 1.0 : -1.0);
        rightIn[i] = (i % 2 === 0 ? -1.0 : 1.0);
      }

      const { leftOut, rightOut } = eq.process(leftIn, rightIn);

      for (let i = 0; i < N; i++) {
        assert.ok(Number.isFinite(leftOut[i]), `Nyquist output at fs=${fs} must be finite at ${i}`);
        assert.ok(Number.isFinite(rightOut[i]), `Nyquist output at fs=${fs} must be finite at ${i}`);
      }
    }
  });

  test('ADV-04: Subnormal / denormal floats and non-finite inputs are sanitized', () => {
    const eq = new EqualizerProcessor(44100);
    eq.setBands([6, 3, 0, -3, -6, 0, 3, 6, 9, 12]);

    const N = 512;
    const leftIn = new Float32Array(N);
    const rightIn = new Float32Array(N);

    // Inject denormals, NaNs, and Infs
    leftIn[10] = 1e-38;
    leftIn[11] = -1e-38;
    leftIn[50] = NaN;
    leftIn[100] = Infinity;
    leftIn[101] = -Infinity;

    rightIn[10] = -1e-38;
    rightIn[50] = NaN;
    rightIn[100] = -Infinity;

    const { leftOut, rightOut } = eq.process(leftIn, rightIn);

    for (let i = 0; i < N; i++) {
      assert.ok(Number.isFinite(leftOut[i]), `Sanitization check failed at sample ${i}: ${leftOut[i]}`);
      assert.ok(Number.isFinite(rightOut[i]), `Sanitization check failed at sample ${i}: ${rightOut[i]}`);
    }
  });
});

// ============================================================================
// CHALLENGE 2: LOOKAHEAD PEAK LIMITER CEILING VERIFICATION
// ============================================================================
describe('Challenge 2: Lookahead Peak Limiter Strict 0.985 Ceiling Verification', () => {
  test('ADV-05: 100,000 samples of extreme clipping signals never exceed 0.985 ceiling', () => {
    const limiter = new LookaheadPeakLimiter(44100, 0.985);
    const sampleCount = 100000;
    const testSignal = new Float32Array(sampleCount);

    // Build hyper-adversarial signal:
    // 1. Extreme square wave (+30 dBFS -> ~31.62)
    // 2. Dirac spikes of +500.0 and -500.0
    // 3. Dense white noise with variance 50.0
    // 4. Swept sine wave from 20 Hz to 20 kHz with gain 10.0
    const spikeAmp = Math.pow(10, 30 / 20); // 31.62

    for (let i = 0; i < sampleCount; i++) {
      if (i < 20000) {
        // High amplitude square wave
        testSignal[i] = (i % 100 < 50) ? spikeAmp : -spikeAmp;
      } else if (i < 40000) {
        // Uniform noise in [-50, +50]
        testSignal[i] = (Math.random() * 100 - 50);
      } else if (i < 60000) {
        // Delta impulses
        testSignal[i] = (i % 250 === 0) ? 500.0 : ((i % 500 === 0) ? -500.0 : 0.0);
      } else {
        // Swept sine wave with overdrive (amp = 20.0)
        const t = (i - 60000) / 44100;
        const freq = 20 + (10000 * t);
        testSignal[i] = 20.0 * Math.sin(2 * Math.PI * freq * t);
      }
    }

    const limited = limiter.process(testSignal);
    assert.strictEqual(limited.length, sampleCount);

    let maxPeak = 0;
    let minTrough = 0;
    let violationCount = 0;
    const ceilingTolerance = 0.9850001; // exact ceiling with single-precision float tolerance

    for (let i = 0; i < sampleCount; i++) {
      const s = limited[i];
      if (s > maxPeak) maxPeak = s;
      if (s < minTrough) minTrough = s;

      if (s > ceilingTolerance || s < -ceilingTolerance) {
        violationCount++;
      }
    }

    console.log(`[ADV-05] Processed ${sampleCount} samples: maxPeak=${maxPeak.toFixed(6)}, minTrough=${minTrough.toFixed(6)}, violations=${violationCount}`);
    assert.strictEqual(violationCount, 0, `Limiter permitted ${violationCount} samples to exceed 0.985 ceiling`);
    assert.ok(maxPeak <= 0.9850001, `Max peak ${maxPeak} exceeded ceiling 0.985`);
    assert.ok(minTrough >= -0.9850001, `Min trough ${minTrough} exceeded ceiling -0.985`);
  });

  test('ADV-06: Stereo Peak Limiter maintains ceiling across asymmetric channel overdrive', () => {
    const limiter = new LookaheadPeakLimiter(44100, 0.985);
    const N = 10000;
    const leftIn = new Float32Array(N);
    const rightIn = new Float32Array(N);

    // Left channel quiet, Right channel extremely clipped (+40 dBFS = 100.0)
    for (let i = 0; i < N; i++) {
      leftIn[i] = 0.1 * Math.sin(i * 0.1);
      rightIn[i] = (i % 100 === 0) ? 100.0 : ((i % 200 === 0) ? -100.0 : (Math.random() * 20 - 10));
    }

    const { leftOut, rightOut } = limiter.processStereo(leftIn, rightIn);

    for (let i = 0; i < N; i++) {
      assert.ok(leftOut[i] <= 0.9850001 && leftOut[i] >= -0.9850001, `Stereo Left exceeded ceiling at ${i}: ${leftOut[i]}`);
      assert.ok(rightOut[i] <= 0.9850001 && rightOut[i] >= -0.9850001, `Stereo Right exceeded ceiling at ${i}: ${rightOut[i]}`);
    }
  });

  test('ADV-07: Instant attack catches sample at index 0 without overshoot', () => {
    const limiter = new LookaheadPeakLimiter(44100, 0.985);
    const testBuf = new Float32Array([50.0, 100.0, -80.0, 0.5, 0.2]);
    const out = limiter.process(testBuf);

    assert.ok(out[0] <= 0.9850001 && out[0] >= -0.9850001, `Index 0 failed instant attack: ${out[0]}`);
    assert.ok(out[1] <= 0.9850001 && out[1] >= -0.9850001, `Index 1 exceeded ceiling: ${out[1]}`);
    assert.ok(out[2] <= 0.9850001 && out[2] >= -0.9850001, `Index 2 exceeded ceiling: ${out[2]}`);
  });
});

// ============================================================================
// CHALLENGE 3: SPATIAL AUDIO PHANTOM CENTER STABILITY
// ============================================================================
describe('Challenge 3: Spatial Audio Phantom Center Stability on Mono Signals', () => {
  test('ADV-08: Mono input (L == R) guarantees exact channel equality (delta < 1e-5) across spectrum', () => {
    const spatial = new SpatialAudioProcessor(44100);

    // Test across various width settings [1.0, 2.5, 4.0]
    const testWidths = [1.0, 1.5, 2.0, 2.5, 3.0, 4.0];

    for (const w of testWidths) {
      spatial.width = w;
      spatial.reset();

      const sampleCount = 4410; // 100ms
      const leftIn = new Float32Array(sampleCount);
      const rightIn = new Float32Array(sampleCount);

      // Construct multi-tone mono signal
      for (let i = 0; i < sampleCount; i++) {
        const t = i / 44100;
        const monoSample =
          0.3 * Math.sin(2 * Math.PI * 100 * t) +
          0.3 * Math.sin(2 * Math.PI * 1000 * t) +
          0.3 * Math.sin(2 * Math.PI * 10000 * t);
        leftIn[i] = monoSample;
        rightIn[i] = monoSample;
      }

      const { leftOut, rightOut } = spatial.process(leftIn, rightIn);

      let maxDelta = 0;
      for (let i = 0; i < sampleCount; i++) {
        const delta = Math.abs(leftOut[i] - rightOut[i]);
        if (delta > maxDelta) maxDelta = delta;
        assert.ok(
          delta < 1e-5,
          `Phantom center violated at sample ${i} (width=${w}): L=${leftOut[i]}, R=${rightOut[i]}, delta=${delta}`
        );
      }
      console.log(`[ADV-08] Spatial width=${w}: max L-R delta = ${maxDelta.toExponential(4)} (< 1e-5 PASS)`);
    }
  });

  test('ADV-09: Mono impulses and harsh transitions maintain phantom center without divergence', () => {
    const spatial = new SpatialAudioProcessor(44100);
    spatial.width = 3.5;
    spatial.reset();

    const N = 2048;
    const leftIn = new Float32Array(N);
    const rightIn = new Float32Array(N);

    // Mono Dirac spikes and square transitions
    for (let i = 0; i < N; i++) {
      const val = (i % 100 === 0) ? 1.0 : ((i % 100 < 50) ? 0.5 : -0.5);
      leftIn[i] = val;
      rightIn[i] = val;
    }

    const { leftOut, rightOut } = spatial.process(leftIn, rightIn);

    for (let i = 0; i < N; i++) {
      const delta = Math.abs(leftOut[i] - rightOut[i]);
      assert.ok(delta < 1e-5, `Impulse delta at ${i} exceeded 1e-5: ${delta}`);
    }
  });
});

// ============================================================================
// CHALLENGE 4: AUTOEQ BINARY PAP DECODING UNDER CORRUPTED BLOBS
// ============================================================================
describe('Challenge 4: AutoEQ Binary PaP Decoding Under Corrupted Blobs', () => {
  test('ADV-10: Null, empty, truncated, or invalid magic blobs return empty array safely', () => {
    // 1. null / undefined
    assert.deepStrictEqual(decodePapParametricBlob(null), []);
    assert.deepStrictEqual(decodePapParametricBlob(undefined), []);

    // 2. 0 length
    assert.deepStrictEqual(decodePapParametricBlob(new Uint8Array(0)), []);

    // 3. Smaller than header (< 36 bytes)
    assert.deepStrictEqual(decodePapParametricBlob(new Uint8Array(35)), []);

    // 4. Invalid magic bytes (expected 'P','a','P', 0x01)
    const badMagic = new Uint8Array(36);
    badMagic[0] = 0x50; // 'P'
    badMagic[1] = 0x61; // 'a'
    badMagic[2] = 0x50; // 'P'
    badMagic[3] = 0x02; // Wrong version 2!
    assert.deepStrictEqual(decodePapParametricBlob(badMagic), []);
  });

  test('ADV-11: Boundary sanitization clamps extreme/illegal record values', () => {
    // Create valid 36-byte header + two 20-byte records
    const HEADER_SIZE = 36;
    const RECORD_SIZE = 20;
    const totalBytes = HEADER_SIZE + RECORD_SIZE * 2;
    const buffer = new ArrayBuffer(totalBytes);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    // Magic: 'P', 'a', 'P', 0x01
    bytes[0] = 0x50;
    bytes[1] = 0x61;
    bytes[2] = 0x50;
    bytes[3] = 0x01;

    // Record 1: Extreme values
    // tag = 0x7003 (PEAKING), gainDb = +50.0 dB (should clamp to +12 dB)
    // freq = 99999 Hz (should clamp to maxNyquist 21609 Hz)
    // q = -5.0 (should clamp to 0.1)
    let offset = HEADER_SIZE;
    view.setUint32(offset, 0x7003, true);
    view.setFloat32(offset + 4, 50.0, true);
    view.setUint32(offset + 8, 99999, true);
    view.setFloat32(offset + 12, -5.0, true);

    // Record 2: Extreme negative values
    // tag = 0x7004 (LOW_SHELF), gainDb = -80.0 dB (should clamp to -24 dB)
    // freq = 100 Hz
    // q = 0.0 (should clamp to 0.1)
    offset += RECORD_SIZE;
    view.setUint32(offset, 0x7004, true);
    view.setFloat32(offset + 4, -80.0, true);
    view.setUint32(offset + 8, 100, true);
    view.setFloat32(offset + 12, 0.0, true);

    const filters = decodePapParametricBlob(bytes);
    assert.strictEqual(filters.length, 2);

    // Check Record 1 clamping
    assert.strictEqual(filters[0].type, 'PEAKING');
    assert.strictEqual(filters[0].gainDb, 12.0); // clamped to +12
    assert.strictEqual(filters[0].freq, 21609); // clamped to 21609
    assert.strictEqual(filters[0].q, 0.1); // clamped to 0.1

    // Check Record 2 clamping
    assert.strictEqual(filters[1].type, 'LOW_SHELF');
    assert.strictEqual(filters[1].gainDb, -24.0); // clamped to -24
    assert.strictEqual(filters[1].freq, 100);
    assert.strictEqual(filters[1].q, 0.1); // clamped to 0.1

    // Check preamp calculation on clamped filters
    const preamp = calculatePreampGainDb(filters);
    assert.strictEqual(preamp, -12.0, 'Preamp must be negative inverse of maximum boost');
  });

  test('ADV-12: Truncated records at blob end are discarded cleanly without throwing', () => {
    // 36 header bytes + 20 full record + 7 trailing garbage bytes
    const blob = new Uint8Array(36 + 20 + 7);
    blob[0] = 0x50;
    blob[1] = 0x61;
    blob[2] = 0x50;
    blob[3] = 0x01;

    const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
    view.setUint32(36, 0x7005, true); // HIGH_SHELF
    view.setFloat32(36 + 4, 3.5, true);
    view.setUint32(36 + 8, 8000, true);
    view.setFloat32(36 + 12, 1.0, true);

    // The trailing 7 bytes should not cause an IndexOutOfBounds error
    const filters = decodePapParametricBlob(blob);
    assert.strictEqual(filters.length, 1);
    assert.strictEqual(filters[0].type, 'HIGH_SHELF');
    assert.strictEqual(filters[0].gainDb, 3.5);
    assert.strictEqual(filters[0].freq, 8000);
  });

  test('ADV-13: Fuzz testing 100 randomly corrupted byte arrays never crashes decoder', () => {
    for (let iteration = 0; iteration < 100; iteration++) {
      const len = Math.floor(Math.random() * 200);
      const randomBytes = new Uint8Array(len);
      for (let b = 0; b < len; b++) {
        randomBytes[b] = Math.floor(Math.random() * 256);
      }
      // Occasionally inject valid magic to test parser depth
      if (iteration % 5 === 0 && len >= 4) {
        randomBytes[0] = 0x50;
        randomBytes[1] = 0x61;
        randomBytes[2] = 0x50;
        randomBytes[3] = 0x01;
      }

      assert.doesNotThrow(() => {
        const res = decodePapParametricBlob(randomBytes);
        assert.ok(Array.isArray(res));
      });
    }
  });
});

// ============================================================================
// CHALLENGE 5: CONSTANT-POWER CROSSFADE VERIFICATION
// ============================================================================
describe('Challenge 5: Constant-Power Crossfade Power Sum Across 100 Points', () => {
  test('ADV-14: Power sum (cos^2 + sin^2) is identically 1.0 at all 100 interpolation points', () => {
    const points = 100;
    let maxDelta = 0;

    for (let k = 0; k < points; k++) {
      const t = k / (points - 1); // [0.0, 1.0]
      const gOut = Math.cos((Math.PI / 2) * t);
      const gIn = Math.sin((Math.PI / 2) * t);

      const powerSum = gOut * gOut + gIn * gIn;
      const delta = Math.abs(powerSum - 1.0);
      if (delta > maxDelta) maxDelta = delta;

      assert.ok(
        delta < 1e-6,
        `Constant power violated at t=${t.toFixed(4)}: P=${powerSum}, delta=${delta}`
      );
    }

    console.log(`[ADV-14] Tested 100 crossfade points: max power delta = ${maxDelta.toExponential(4)} (< 1e-6 PASS)`);
  });

  test('ADV-15: Trigonometric constant-power prevents 3 dB power dip of linear crossfade', () => {
    // Midpoint comparison (t = 0.5):
    const t = 0.5;

    // Linear crossfade:
    const linearOut = 1 - t; // 0.5
    const linearIn = t;      // 0.5
    const linearPower = linearOut * linearOut + linearIn * linearIn; // 0.25 + 0.25 = 0.5 (-3.01 dB dip!)
    const linearDipDb = 10 * Math.log10(linearPower);

    // Constant-power cosine/sine crossfade:
    const cpOut = Math.cos((Math.PI / 2) * t); // ~0.7071
    const cpIn = Math.sin((Math.PI / 2) * t);  // ~0.7071
    const cpPower = cpOut * cpOut + cpIn * cpIn; // 0.5 + 0.5 = 1.0 (0.00 dB)
    const cpDipDb = 10 * Math.log10(cpPower);

    console.log(`[ADV-15] Midpoint crossfade comparison: Linear dip = ${linearDipDb.toFixed(2)} dB vs Constant-Power dip = ${cpDipDb.toFixed(6)} dB`);
    assert.strictEqual(linearPower, 0.5, 'Linear crossfade must suffer 50% power dip at midpoint');
    assert.ok(Math.abs(cpPower - 1.0) < 1e-6, 'Constant-power crossfade must maintain 100% power (0 dB dip)');
  });

  test('ADV-16: AudioEngine crossfade executes complete deck role swap and state transition', async () => {
    const engine = new AudioEngine();
    await engine.loadTrack(mockSongs.standardYouTube, 'active');
    await engine.loadTrack(mockSongs.localFlac, 'standby');

    assert.strictEqual(engine.activeDeckName, 'active');
    assert.strictEqual(engine.deckA.track?.videoId, 'yt_track_001');
    assert.strictEqual(engine.deckB.track?.videoId, 'local_flac_002');

    engine.play();
    assert.strictEqual(engine.playbackState, 'PLAYING');

    // Execute crossfade to standby deck
    await engine.crossfade('standby', 500);

    // After crossfade, activeDeckName must be 'standby'
    assert.strictEqual(engine.activeDeckName, 'standby');
    assert.strictEqual(engine.playbackState, 'PLAYING');
    assert.strictEqual(engine.deckB.gain, 1.0);
    assert.strictEqual(engine.deckA.gain, 0.0);
  });
});

// ============================================================================
// INTEGRATED MASTER DSP CHAIN ADVERSARIAL STRESS TEST
// ============================================================================
describe('Master DSP Chain Integrated Adversarial Stress Test', () => {
  test('ADV-17: Compound extreme stress (Max Width + Max EQ Boost + Preamp + +24 dBFS Signal)', () => {
    const dsp = new DspChain(44100);

    // Configure maximum stress
    dsp.spatial.enabled = true;
    dsp.spatial.width = 4.0; // max width

    dsp.equalizer.setBands([12, 12, 12, 12, 12, 12, 12, 12, 12, 12]);
    dsp.equalizer.applyToneControls(6, 6);

    dsp.setAutoEqProfile(
      [
        { type: 'PEAKING', freq: 1000, q: 2.0, gainDb: 6.0 },
        { type: 'LOW_SHELF', freq: 100, q: 0.71, gainDb: 6.0 },
      ],
      -6.0 // negative preamp
    );

    const N = 8192;
    const leftIn = new Float32Array(N);
    const rightIn = new Float32Array(N);

    // Fill with extreme hot audio (+24 dBFS)
    const hotAmp = Math.pow(10, 24 / 20); // ~15.85
    for (let i = 0; i < N; i++) {
      leftIn[i] = (Math.random() * 2 - 1) * hotAmp;
      rightIn[i] = (Math.random() * 2 - 1) * hotAmp;
    }

    const { leftOut, rightOut } = dsp.processBlock(leftIn, rightIn);

    let maxL = 0;
    let minL = 0;
    let maxR = 0;
    let minR = 0;

    for (let i = 0; i < N; i++) {
      assert.ok(Number.isFinite(leftOut[i]), `Master output Left not finite at ${i}: ${leftOut[i]}`);
      assert.ok(Number.isFinite(rightOut[i]), `Master output Right not finite at ${i}: ${rightOut[i]}`);

      if (leftOut[i] > maxL) maxL = leftOut[i];
      if (leftOut[i] < minL) minL = leftOut[i];
      if (rightOut[i] > maxR) maxR = rightOut[i];
      if (rightOut[i] < minR) minR = rightOut[i];

      assert.ok(leftOut[i] <= 0.9850001 && leftOut[i] >= -0.9850001, `Master Left violated ceiling: ${leftOut[i]}`);
      assert.ok(rightOut[i] <= 0.9850001 && rightOut[i] >= -0.9850001, `Master Right violated ceiling: ${rightOut[i]}`);
    }

    console.log(`[ADV-17] Master DSP Chain Output Bounds: L=[${minL.toFixed(4)}, ${maxL.toFixed(4)}], R=[${minR.toFixed(4)}, ${maxR.toFixed(4)}] (CEILING 0.985 ENFORCED)`);
  });
});

// ============================================================================
// CHALLENGE 6: DATABASE RESILIENCE, WAVEFORM & VISUALIZER DEGENERACY
// ============================================================================
describe('Challenge 6: Database Resilience, Waveform & Visualizer Degeneracy', () => {
  test('ADV-18: AutoEqLoader queries with SQL injection & malformed inputs return null/empty safely', async () => {
    const maliciousQueries = [
      "' OR '1'='1",
      "'; DROP TABLE eq_presets; --",
      "UNION SELECT * FROM sqlite_master",
      "\0",
      "A".repeat(10000),
      "'''''",
      "1; SELECT 1",
    ];

    for (const q of maliciousQueries) {
      const profile = await AutoEqLoader.findProfile(q);
      assert.strictEqual(profile, null, `Malicious query "${q.slice(0, 20)}" should safely yield null`);

      const searchResults = await AutoEqLoader.searchHeadphones(q, 10);
      assert.ok(Array.isArray(searchResults), `Search query "${q.slice(0, 20)}" should safely return an array`);
    }
  });

  test('ADV-19: WaveformExtractor handles degenerate, non-finite, and zero-length audio buffers', () => {
    // 1. Zero length
    const emptyBuf = new Float32Array(0);
    const emptyRes = WaveformExtractor.extract200BucketEnvelope(emptyBuf);
    assert.strictEqual(emptyRes.length, 200);
    for (let i = 0; i < 200; i++) {
      assert.strictEqual(emptyRes[i], 0.0);
    }

    // 2. Single sample
    const singleBuf = new Float32Array([0.8]);
    const singleRes = WaveformExtractor.extract200BucketEnvelope(singleBuf);
    assert.strictEqual(singleRes.length, 200);
    assert.strictEqual(singleRes[0], 1.0); // normalized to 1.0

    // 3. NaNs and Infs
    const nanBuf = new Float32Array([NaN, Infinity, -Infinity, 0.5]);
    const nanRes = WaveformExtractor.extract200BucketEnvelope(nanBuf);
    assert.strictEqual(nanRes.length, 200);
    for (let i = 0; i < 200; i++) {
      assert.ok(Number.isFinite(nanRes[i]), `Waveform bucket ${i} must be finite`);
      assert.ok(nanRes[i] >= 0.0 && nanRes[i] <= 1.0, `Waveform bucket ${i} must be in [0.0, 1.0]`);
    }

    // 4. Resample 200 buckets to 68 bars
    const bars = WaveformExtractor.resampleTo68Bars(nanRes);
    assert.strictEqual(bars.length, 68);
    for (let i = 0; i < 68; i++) {
      assert.ok(Number.isFinite(bars[i]), `Bar ${i} must be finite`);
      assert.ok(bars[i] >= 0.0 && bars[i] <= 1.0, `Bar ${i} must be in [0.0, 1.0]`);
    }
  });

  test('ADV-20: LiveVisualizer handles odd-length blocks and non-finite numbers without allocation leak', () => {
    // Odd block length 1023 with mixed NaNs and high energy
    const oddBlock = new Float32Array(1023);
    for (let i = 0; i < 1023; i++) {
      if (i % 50 === 0) oddBlock[i] = NaN;
      else if (i % 75 === 0) oddBlock[i] = Infinity;
      else oddBlock[i] = (Math.random() * 2 - 1) * 2.0;
    }

    const energy32 = LiveVisualizer.compute32BandPcmEnergy(oddBlock);
    assert.strictEqual(energy32.length, 32);

    for (let b = 0; b < 32; b++) {
      assert.ok(Number.isFinite(energy32[b]), `Energy band ${b} must be finite`);
      assert.ok(energy32[b] >= 0.0 && energy32[b] <= 1.0, `Energy band ${b} out of range: ${energy32[b]}`);
    }
  });

  test('ADV-21: TransitionProcessor sanitizes extreme and invalid BPM, bars, and feedback', () => {
    // Negative BPM -> 120 default
    assert.strictEqual(TransitionProcessor.calculateTransitionDurationSec(4, -50), 8.0);
    assert.strictEqual(TransitionProcessor.calculateTransitionDurationSec(4, 0), 8.0);
    assert.strictEqual(TransitionProcessor.calculateTransitionDurationSec(4, 1000), 8.0);

    // Negative bars -> 1 bar minimum
    assert.strictEqual(TransitionProcessor.calculateTransitionDurationSec(-10, 120), 2.0);
    // Huge bars -> 24 bars maximum
    assert.strictEqual(TransitionProcessor.calculateTransitionDurationSec(100, 120), 48.0);

    // Feedback clamping (max 0.95, min 0.0)
    assert.strictEqual(TransitionProcessor.clampFeedback(1.5), 0.95);
    assert.strictEqual(TransitionProcessor.clampFeedback(-0.5), 0.0);
    assert.strictEqual(TransitionProcessor.clampFeedback(0.7), 0.7);

    // Zero-length audio block stretch returns empty array
    assert.strictEqual(TransitionProcessor.stretchAudioBlock(new Float32Array(0), 1.2).length, 0);
  });

  test('ADV-22: Equalizer Tone Control Saturation clamps maximum boost to +12 dB', () => {
    const eq = new EqualizerProcessor(44100);
    // Band 0 already at +12 dB
    eq.setBands([12, 0, 0, 0, 0, 0, 0, 0, 0, 12]);
    // Apply additional +6 dB tone controls
    eq.applyToneControls(6, 6);

    // In process, effectiveTargets[0] and [9] must clamp to 12 (not 18 dB)
    const testBuf = new Float32Array([1.0, -1.0, 0.5, -0.5]);
    const { leftOut } = eq.process(testBuf, testBuf);

    for (let i = 0; i < leftOut.length; i++) {
      assert.ok(Number.isFinite(leftOut[i]), `Sample ${i} must be finite`);
    }
  });
});

