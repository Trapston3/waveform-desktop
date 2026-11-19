// tests/adversarial_dsp_empirical_verification.mjs
// Empirical Challenger Verification Harness for Milestone 2 Iteration 2
// Deep testing of AutoEQ frequency shaping, DF2T biquad multi-block continuity,
// numerical extremes & fuzzing, and limiter interlock headroom.

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
  AutoEqProcessor,
  LookaheadPeakLimiter,
  EqualizerProcessor,
  SpatialAudioProcessor,
} = await import('../src/audio/DspChain.ts');

const {
  AutoEqLoader,
  CURATED_AUTOEQ_PROFILES,
  calculatePreampGainDb,
} = await import('../src/audio/AutoEqLoader.ts');

// Helper: Measure steady-state RMS of a sine wave after passing through processor
function measureSteadyStateGainDb(processor, freqHz, sampleRate = 44100, amp = 0.5) {
  const warmupSamples = 2048;
  const measureSamples = 4096;
  const totalSamples = warmupSamples + measureSamples;

  const leftIn = new Float32Array(totalSamples);
  const rightIn = new Float32Array(totalSamples);

  for (let i = 0; i < totalSamples; i++) {
    const s = amp * Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
    leftIn[i] = s;
    rightIn[i] = s;
  }

  // Copy buffers because AutoEqProcessor processes in-place
  const left = new Float32Array(leftIn);
  const right = new Float32Array(rightIn);
  processor.process(left, right);

  // Compute RMS of input and output over measurement window
  let sumInSq = 0;
  let sumOutSq = 0;
  for (let i = warmupSamples; i < totalSamples; i++) {
    sumInSq += leftIn[i] * leftIn[i];
    sumOutSq += left[i] * left[i];
  }

  const rmsIn = Math.sqrt(sumInSq / measureSamples);
  const rmsOut = Math.sqrt(sumOutSq / measureSamples);

  return 20 * Math.log10(rmsOut / rmsIn);
}

// Theoretical biquad frequency response evaluator H(e^(jw))
function evalBiquadTheoreticalDb(filter, freqHz, sampleRate) {
  const coeffs = AutoEqProcessor.calculateBiquadCoefficients(filter, sampleRate);
  const w = (2 * Math.PI * freqHz) / sampleRate;
  const cosW = Math.cos(w);
  const cos2W = Math.cos(2 * w);
  const sinW = Math.sin(w);
  const sin2W = Math.sin(2 * w);

  // Numerator: b0 + b1*cos(w) + b2*cos(2w) - j*(b1*sin(w) + b2*sin(2w))
  const numR = coeffs.b0 + coeffs.b1 * cosW + coeffs.b2 * cos2W;
  const numI = -(coeffs.b1 * sinW + coeffs.b2 * sin2W);

  // Denominator: 1 + a1*cos(w) + a2*cos(2w) - j*(a1*sin(w) + a2*sin(2w))
  const denR = 1.0 + coeffs.a1 * cosW + coeffs.a2 * cos2W;
  const denI = -(coeffs.a1 * sinW + coeffs.a2 * sin2W);

  const numMagSq = numR * numR + numI * numI;
  const denMagSq = denR * denR + denI * denI;

  return 10 * Math.log10(numMagSq / denMagSq);
}

console.log('=== EMPIRICAL CHALLENGER TEST SUITE: MILESTONE 2 ITERATION 2 ===');

// ============================================================================
// SUITE 1: AUTOEQ FREQUENCY RESPONSE & ACOUSTIC TRANSFER SHAPING
// ============================================================================
describe('Suite 1: AutoEQ Frequency Response & Acoustic Transfer Shaping', () => {
  test('EMP-01: Single-filter empirical frequency response strictly matches theoretical biquad curve', () => {
    const sampleRate = 48000;
    const testCases = [
      { type: 'PEAKING', freq: 1000, q: 2.0, gainDb: 6.0, testFreqs: [200, 1000, 5000] },
      { type: 'PEAKING', freq: 3000, q: 3.5, gainDb: -8.0, testFreqs: [500, 3000, 12000] },
      { type: 'LOW_SHELF', freq: 250, q: 0.707, gainDb: 5.0, testFreqs: [80, 250, 4000] },
      { type: 'HIGH_SHELF', freq: 8000, q: 0.707, gainDb: -6.0, testFreqs: [500, 8000, 16000] },
      { type: 'LOW_PASS', freq: 4000, q: 0.707, gainDb: 0.0, testFreqs: [1000, 4000, 12000] },
      { type: 'HIGH_PASS', freq: 500, q: 0.707, gainDb: 0.0, testFreqs: [100, 500, 2000] },
      { type: 'BAND_PASS', freq: 2000, q: 2.0, gainDb: 0.0, testFreqs: [500, 2000, 8000] },
    ];

    for (const tc of testCases) {
      const filter = { type: tc.type, freq: tc.freq, q: tc.q, gainDb: tc.gainDb };
      const proc = new AutoEqProcessor(sampleRate);
      proc.setProfile([filter], 0.0);

      for (const tf of tc.testFreqs) {
        const measuredDb = measureSteadyStateGainDb(proc, tf, sampleRate);
        const theoreticalDb = evalBiquadTheoreticalDb(filter, tf, sampleRate);
        const diff = Math.abs(measuredDb - theoreticalDb);

        assert.ok(
          diff < 0.25,
          `Filter ${tc.type} at ${tf}Hz: measured=${measuredDb.toFixed(3)}dB, theoretical=${theoreticalDb.toFixed(3)}dB, diff=${diff.toFixed(3)}dB exceeds 0.25dB`
        );
      }
    }
  });

  test('EMP-02: Sony WH-1000XM4 profile acoustic shaping exhibits expected boost/cut separation and preamp attenuation', () => {
    const profile = CURATED_AUTOEQ_PROFILES.find((p) => p.id === 'sony_wh1000xm4');
    assert.ok(profile, 'Sony WH-1000XM4 profile must exist');

    const sampleRate = 44100;
    const proc = new AutoEqProcessor(sampleRate);
    proc.setProfile(profile.filters, profile.preampGainDb);

    // Profile has:
    // Preamp: -5.6 dB
    // 1100 Hz: PEAKING, Q=2.1, gainDb=-3.2
    // 3200 Hz: PEAKING, Q=3.0, gainDb=+4.5
    const gain1100 = measureSteadyStateGainDb(proc, 1100, sampleRate);
    const gain3200 = measureSteadyStateGainDb(proc, 3200, sampleRate);

    // Measured difference between 3200Hz peak and 1100Hz notch
    const separation = gain3200 - gain1100;
    assert.ok(
      separation > 6.0,
      `Acoustic separation between 3200Hz and 1100Hz (${separation.toFixed(2)} dB) should exceed 6.0 dB`
    );

    // Absolute gain at 3200Hz should reflect preamp (-5.6 dB) + peak (+4.5 dB) ~ -1.1 dB (+- 1.5 dB)
    assert.ok(
      gain3200 < 0.5 && gain3200 > -3.0,
      `Gain at 3200Hz (${gain3200.toFixed(2)} dB) should incorporate preamp and boost`
    );

    // Absolute gain at 1100Hz should reflect preamp (-5.6 dB) + notch (-3.2 dB) ~ -8.8 dB (+- 1.5 dB)
    assert.ok(
      gain1100 < -6.5 && gain1100 > -11.0,
      `Gain at 1100Hz (${gain1100.toFixed(2)} dB) should incorporate preamp and notch`
    );
  });

  test('EMP-03: Real uncurated models from auto_eq.db query, decode and shape correctly', async () => {
    const modelsToTest = ['Audeze LCD-X', 'Beyerdynamic DT 770', '7Hz Salnotes Zero'];

    for (const name of modelsToTest) {
      const profile = await AutoEqLoader.findProfile(name);
      assert.ok(profile, `Should find profile for ${name}`);
      assert.ok(profile.filters.length >= 5, `${name} should have at least 5 biquad filters`);
      assert.ok(profile.preampGainDb <= 0, `${name} preamp gain should be <= 0 dB`);

      const proc = new AutoEqProcessor(44100);
      proc.setProfile(profile.filters, profile.preampGainDb);
      assert.strictEqual(proc.isShaping, true);

      // Verify that processing audio changes the energy
      const testSig = new Float32Array(2048);
      for (let i = 0; i < 2048; i++) testSig[i] = Math.sin((2 * Math.PI * 1000 * i) / 44100);

      const l = new Float32Array(testSig);
      const r = new Float32Array(testSig);
      proc.process(l, r);

      let diffSum = 0;
      for (let i = 0; i < 2048; i++) diffSum += Math.abs(l[i] - testSig[i]);
      assert.ok(diffSum > 1.0, `Profile ${name} must actively alter the audio samples`);
    }
  });
});

// ============================================================================
// SUITE 2: DF2T BIQUAD MULTI-BLOCK STATE CONTINUITY & BIT EQUIVALENCE
// ============================================================================
describe('Suite 2: DF2T Biquad Multi-Block State Continuity & Bit Equivalence', () => {
  test('EMP-04: Single-block vs randomized chunked processing guarantees zero-error state continuity across 65536 samples', () => {
    const sampleRate = 48000;
    const totalSamples = 65536;

    // Complex test signal: Sum of 5 sines + noise + transient step
    const inputL = new Float32Array(totalSamples);
    const inputR = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      const s =
        0.2 * Math.sin(2 * Math.PI * 60 * t) +
        0.2 * Math.sin(2 * Math.PI * 440 * t) +
        0.2 * Math.sin(2 * Math.PI * 2500 * t) +
        0.15 * Math.sin(2 * Math.PI * 9000 * t) +
        0.05 * (Math.random() * 2 - 1);
      inputL[i] = s;
      inputR[i] = s * 0.9;
    }

    const testFilters = [
      { type: 'LOW_SHELF', freq: 120, q: 0.71, gainDb: 4.0 },
      { type: 'PEAKING', freq: 500, q: 2.0, gainDb: -3.5 },
      { type: 'PEAKING', freq: 2800, q: 4.0, gainDb: 5.5 },
      { type: 'PEAKING', freq: 7500, q: 1.5, gainDb: -2.0 },
      { type: 'HIGH_SHELF', freq: 11000, q: 0.71, gainDb: 3.0 },
    ];

    // Run A: Single contiguous block
    const procA = new AutoEqProcessor(sampleRate);
    procA.setProfile(testFilters, -5.5);
    const outLA = new Float32Array(inputL);
    const outRA = new Float32Array(inputR);
    procA.process(outLA, outRA);

    // Run B: Randomized chunked blocks (chunk sizes from 1 to 2048)
    const procB = new AutoEqProcessor(sampleRate);
    procB.setProfile(testFilters, -5.5);
    const outLB = new Float32Array(totalSamples);
    const outRB = new Float32Array(totalSamples);

    let offset = 0;
    const chunkSizes = [1, 3, 7, 16, 64, 128, 255, 512, 1024, 73, 1000, 2048, 4096];
    let chunkIdx = 0;

    while (offset < totalSamples) {
      const chunkSize = Math.min(chunkSizes[chunkIdx % chunkSizes.length], totalSamples - offset);
      chunkIdx++;

      const chunkL = inputL.subarray(offset, offset + chunkSize);
      const chunkR = inputR.subarray(offset, offset + chunkSize);

      const bufL = new Float32Array(chunkL);
      const bufR = new Float32Array(chunkR);
      procB.process(bufL, bufR);

      outLB.set(bufL, offset);
      outRB.set(bufR, offset);

      offset += chunkSize;
    }

    // Verify bit-level equivalence: max delta must be <= 1e-6 (Float32 precision)
    let maxDeltaL = 0;
    let maxDeltaR = 0;
    for (let i = 0; i < totalSamples; i++) {
      const dL = Math.abs(outLA[i] - outLB[i]);
      const dR = Math.abs(outRA[i] - outRB[i]);
      if (dL > maxDeltaL) maxDeltaL = dL;
      if (dR > maxDeltaR) maxDeltaR = dR;
    }

    assert.ok(
      maxDeltaL <= 1e-6,
      `Max Left Channel multi-block discontinuity (${maxDeltaL.toExponential(4)}) exceeds 1e-6`
    );
    assert.ok(
      maxDeltaR <= 1e-6,
      `Max Right Channel multi-block discontinuity (${maxDeltaR.toExponential(4)}) exceeds 1e-6`
    );
  });
});

// ============================================================================
// SUITE 3: NUMERICAL EXTREMES, BOUNDARY CONDITIONS & FUZZING
// ============================================================================
describe('Suite 3: Numerical Extremes, Boundary Conditions & Fuzzing', () => {
  test('EMP-05: Fuzzing calculateBiquadCoefficients with extreme frequencies, Q, gains, and sample rates never yields NaN or Infinity', () => {
    const extremeFreqs = [
      -1000, 0, 0.0001, 10, 20, 22050, 24000, 48000, 96000, 1e6,
      NaN, Infinity, -Infinity
    ];
    const extremeQs = [
      -10, 0, 0.0001, 0.05, 0.707, 10, 50, 100, 500, 10000,
      NaN, Infinity, -Infinity
    ];
    const extremeGains = [
      -200, -60, -40, -12, 0, 12, 36, 40, 100, 500,
      NaN, Infinity, -Infinity
    ];
    const extremeRates = [
      -44100, 0, 1, 100, 4000, 8000, 44100, 96000, 192000, 384000,
      NaN, Infinity, -Infinity
    ];
    const filterTypes = ['PEAKING', 'LOW_SHELF', 'HIGH_SHELF', 'LOW_PASS', 'HIGH_PASS', 'BAND_PASS'];

    let combinationsTested = 0;

    for (const type of filterTypes) {
      for (const freq of extremeFreqs) {
        for (const q of extremeQs) {
          for (const gainDb of extremeGains) {
            for (const fs of extremeRates) {
              const filter = { type, freq, q, gainDb };
              const coeffs = AutoEqProcessor.calculateBiquadCoefficients(filter, fs);
              combinationsTested++;

              assert.ok(Number.isFinite(coeffs.b0), `b0 must be finite for f=${freq}, q=${q}, g=${gainDb}, fs=${fs}`);
              assert.ok(Number.isFinite(coeffs.b1), `b1 must be finite for f=${freq}, q=${q}, g=${gainDb}, fs=${fs}`);
              assert.ok(Number.isFinite(coeffs.b2), `b2 must be finite for f=${freq}, q=${q}, g=${gainDb}, fs=${fs}`);
              assert.ok(Number.isFinite(coeffs.a1), `a1 must be finite for f=${freq}, q=${q}, g=${gainDb}, fs=${fs}`);
              assert.ok(Number.isFinite(coeffs.a2), `a2 must be finite for f=${freq}, q=${q}, g=${gainDb}, fs=${fs}`);
            }
          }
        }
      }
    }

    assert.ok(combinationsTested > 10000, `Tested ${combinationsTested} combinations of extreme filter parameters`);
  });

  test('EMP-06: Subnormal inputs and NaN bursts recover cleanly without poisoning subsequent audio blocks', () => {
    const proc = new AutoEqProcessor(44100);
    proc.setProfile([
      { type: 'PEAKING', freq: 1000, q: 2.0, gainDb: 6.0 },
      { type: 'LOW_SHELF', freq: 100, q: 0.707, gainDb: 4.0 },
    ], -3.0);

    const blockSize = 512;

    // Block 1: Subnormals (denormals)
    const block1L = new Float32Array(blockSize);
    const block1R = new Float32Array(blockSize);
    for (let i = 0; i < blockSize; i++) {
      block1L[i] = 1e-39;
      block1R[i] = 1e-42;
    }
    proc.process(block1L, block1R);
    for (let i = 0; i < blockSize; i++) {
      assert.ok(Number.isFinite(block1L[i]), 'Subnormal input must yield finite output');
      assert.ok(Number.isFinite(block1R[i]), 'Subnormal input must yield finite output');
    }

    // Block 2: Injected NaNs and Infinities
    const block2L = new Float32Array(blockSize);
    const block2R = new Float32Array(blockSize);
    for (let i = 0; i < blockSize; i++) {
      block2L[i] = i % 2 === 0 ? NaN : Infinity;
      block2R[i] = i % 2 === 0 ? -Infinity : NaN;
    }
    proc.process(block2L, block2R); // Must not throw

    // Block 3: Clean normal audio block immediately following NaNs
    const block3L = new Float32Array(blockSize);
    const block3R = new Float32Array(blockSize);
    for (let i = 0; i < blockSize; i++) {
      block3L[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 44100);
      block3R[i] = 0.5 * Math.sin((2 * Math.PI * 880 * i) / 44100);
    }
    proc.process(block3L, block3R);

    // Verify recovery: ALL samples in block 3 must be finite and non-NaN
    for (let i = 0; i < blockSize; i++) {
      assert.ok(!Number.isNaN(block3L[i]), `Sample L[${i}] after NaN block must not be NaN`);
      assert.ok(Number.isFinite(block3L[i]), `Sample L[${i}] after NaN block must be finite`);
      assert.ok(!Number.isNaN(block3R[i]), `Sample R[${i}] after NaN block must not be NaN`);
      assert.ok(Number.isFinite(block3R[i]), `Sample R[${i}] after NaN block must be finite`);
    }
  });

  test('EMP-07: Full DspChain.processBlock fuzz testing with extreme inputs, non-finite values and silent blocks', () => {
    const chain = new DspChain(44100);
    chain.equalizer.setBands([12, 10, -6, -12, 8, 4, -8, 12, -4, 6]);
    chain.spatial.width = 3.5;

    const blockSize = 1024;
    const l = new Float32Array(blockSize);
    const r = new Float32Array(blockSize);

    // Random fuzz with mixed NaNs, +/-Infinity, subnormals, and massive values
    for (let i = 0; i < blockSize; i++) {
      const mode = i % 8;
      if (mode === 0) l[i] = NaN;
      else if (mode === 1) l[i] = Infinity;
      else if (mode === 2) l[i] = -Infinity;
      else if (mode === 3) l[i] = 1e-38;
      else if (mode === 4) l[i] = 1000.0;
      else if (mode === 5) l[i] = -1000.0;
      else l[i] = (Math.random() * 2 - 1) * 2.0;

      r[i] = -l[i];
    }

    const { leftOut, rightOut } = chain.processBlock(l, r);

    assert.strictEqual(leftOut.length, blockSize);
    assert.strictEqual(rightOut.length, blockSize);

    for (let i = 0; i < blockSize; i++) {
      assert.ok(Number.isFinite(leftOut[i]), `Output L[${i}] must be finite`);
      assert.ok(Number.isFinite(rightOut[i]), `Output R[${i}] must be finite`);
      assert.ok(leftOut[i] <= 0.985 + 1e-6 && leftOut[i] >= -0.985 - 1e-6, `L[${i}]=${leftOut[i]} must obey ceiling`);
      assert.ok(rightOut[i] <= 0.985 + 1e-6 && rightOut[i] >= -0.985 - 1e-6, `R[${i}]=${rightOut[i]} must obey ceiling`);
    }
  });
});

// ============================================================================
// SUITE 4: LIMITER INTERLOCK, DYNAMIC HEADROOM & ANTI-CLIPPING
// ============================================================================
describe('Suite 4: Limiter Interlock, Dynamic Headroom & Anti-Clipping', () => {
  test('EMP-08: Limiter interlock arms automatically when either Equalizer or AutoEQ is shaping', () => {
    const chain = new DspChain(44100);

    // Initial state: Flat EQ, no AutoEQ
    assert.strictEqual(chain.equalizer.isShaping, false);
    assert.strictEqual(chain.autoEq.isShaping, false);

    const buf = new Float32Array(128);
    chain.processBlock(buf, buf);
    assert.strictEqual(chain.limiter.holdLimiter, false);

    // Activate EQ shaping
    chain.equalizer.setBands([3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.strictEqual(chain.equalizer.isShaping, true);
    chain.processBlock(buf, buf);
    assert.strictEqual(chain.limiter.holdLimiter, true);

    // Reset EQ, activate AutoEQ shaping via profile
    chain.equalizer.setBands([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.strictEqual(chain.equalizer.isShaping, false);
    chain.autoEq.setProfile([{ type: 'PEAKING', freq: 1000, q: 1.0, gainDb: 2.0 }], -2.0);
    assert.strictEqual(chain.autoEq.isShaping, true);
    chain.processBlock(buf, buf);
    assert.strictEqual(chain.limiter.holdLimiter, true);

    // Clear AutoEQ -> interlock releases
    chain.autoEq.clear();
    assert.strictEqual(chain.autoEq.isShaping, false);
    chain.processBlock(buf, buf);
    assert.strictEqual(chain.limiter.holdLimiter, false);
  });

  test('EMP-09: Extreme saturation (100,000 samples of +36 dB overdrive) never exceeds 0.985 peak ceiling', () => {
    const chain = new DspChain(44100);
    // Arm maximum boosts: EQ +12 dB, AutoEQ +12 dB, Spatial width 4.0
    chain.equalizer.setBands([12, 12, 12, 12, 12, 12, 12, 12, 12, 12]);
    chain.spatial.width = 4.0;
    chain.autoEq.setProfile([
      { type: 'PEAKING', freq: 100, q: 1.0, gainDb: 12.0 },
      { type: 'PEAKING', freq: 1000, q: 1.0, gainDb: 12.0 },
      { type: 'PEAKING', freq: 5000, q: 1.0, gainDb: 12.0 },
    ], 0.0);

    const N = 100000;
    const l = new Float32Array(N);
    const r = new Float32Array(N);

    // Input signal at +24 dBFS (amplitude ~ 15.8) with square wave alternating peaks
    for (let i = 0; i < N; i++) {
      l[i] = (i % 64 < 32 ? 15.8 : -15.8) + (Math.random() * 2 - 1) * 2.0;
      r[i] = (i % 96 < 48 ? -15.8 : 15.8) + (Math.random() * 2 - 1) * 2.0;
    }

    const { leftOut, rightOut } = chain.processBlock(l, r);

    let maxL = -Infinity;
    let minL = Infinity;
    let maxR = -Infinity;
    let minR = Infinity;
    let violations = 0;

    for (let i = 0; i < N; i++) {
      if (leftOut[i] > maxL) maxL = leftOut[i];
      if (leftOut[i] < minL) minL = leftOut[i];
      if (rightOut[i] > maxR) maxR = rightOut[i];
      if (rightOut[i] < minR) minR = rightOut[i];

      if (leftOut[i] > 0.985001 || leftOut[i] < -0.985001) violations++;
      if (rightOut[i] > 0.985001 || rightOut[i] < -0.985001) violations++;
    }

    assert.strictEqual(violations, 0, `Detected ${violations} ceiling violations!`);
    assert.ok(maxL <= 0.985001, `Max Left peak ${maxL} exceeded 0.985 ceiling`);
    assert.ok(minL >= -0.985001, `Min Left trough ${minL} exceeded -0.985 ceiling`);
    assert.ok(maxR <= 0.985001, `Max Right peak ${maxR} exceeded 0.985 ceiling`);
    assert.ok(minR >= -0.985001, `Min Right trough ${minR} exceeded -0.985 ceiling`);
  });

  test('EMP-10: AutoEQ calculated negative preamp prevents clipping distortion before biquads', () => {
    // When filters boost by +6.0 dB, calculatePreampGainDb must return -6.0 dB
    const filters = [
      { type: 'PEAKING', freq: 1000, q: 2.0, gainDb: 6.0 },
      { type: 'LOW_SHELF', freq: 100, q: 0.707, gainDb: 3.5 },
    ];
    const preamp = calculatePreampGainDb(filters);
    assert.strictEqual(preamp, -6.0);

    const proc = new AutoEqProcessor(44100);
    proc.setProfile(filters, preamp);

    // Feed a full-scale 0 dBFS sine wave (peak = 1.0)
    const N = 4096;
    const l = new Float32Array(N);
    const r = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const s = Math.sin((2 * Math.PI * 1000 * i) / 44100);
      l[i] = s;
      r[i] = s;
    }

    proc.process(l, r);

    // At 1000 Hz, the filter boosts by +6 dB, but preamp attenuates by -6 dB.
    // The steady-state peak should be near 1.0, not blown up to 2.0!
    let maxPeak = 0;
    for (let i = 1024; i < N; i++) {
      const p = Math.abs(l[i]);
      if (p > maxPeak) maxPeak = p;
    }

    assert.ok(
      maxPeak < 1.05 && maxPeak > 0.95,
      `Steady-state peak (${maxPeak.toFixed(3)}) with balanced preamp must remain near unity`
    );
  });
});

// ============================================================================
// SUITE 5: EXTRA ADVERSARIAL STRESS: CONCURRENCY, DYNAMIC RATES & ODD SIZES
// ============================================================================
describe('Suite 5: Extra Adversarial Stress: Concurrency, Dynamic Rates & Odd Sizes', () => {
  test('EMP-11: Dynamic sample rate re-configuration mid-stream preserves stability without explosion', () => {
    const proc = new AutoEqProcessor(44100);
    proc.setProfile([
      { type: 'PEAKING', freq: 1000, q: 2.0, gainDb: 6.0 },
      { type: 'HIGH_SHELF', freq: 8000, q: 0.71, gainDb: -4.0 },
    ], -6.0);

    const rates = [44100, 48000, 88200, 96000, 192000, 8000, 44100];
    const blockSize = 512;
    const l = new Float32Array(blockSize);
    const r = new Float32Array(blockSize);

    for (const fs of rates) {
      proc.configure(fs);
      for (let i = 0; i < blockSize; i++) {
        l[i] = Math.sin((2 * Math.PI * 1000 * i) / fs);
        r[i] = Math.cos((2 * Math.PI * 1000 * i) / fs);
      }
      proc.process(l, r);

      for (let i = 0; i < blockSize; i++) {
        assert.ok(Number.isFinite(l[i]), `Sample L[${i}] at fs=${fs} must be finite`);
        assert.ok(Number.isFinite(r[i]), `Sample R[${i}] at fs=${fs} must be finite`);
      }
    }
  });

  test('EMP-12: Zero-length, 1-sample, and prime-length buffers process cleanly without exception', () => {
    const chain = new DspChain(44100);
    chain.equalizer.setBands([2, -2, 4, -4, 6, -6, 2, -2, 4, -4]);

    const primeSizes = [0, 1, 2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53];
    for (const size of primeSizes) {
      const l = new Float32Array(size);
      const r = new Float32Array(size);
      for (let i = 0; i < size; i++) {
        l[i] = 0.5;
        r[i] = -0.5;
      }
      const { leftOut, rightOut } = chain.processBlock(l, r);
      assert.strictEqual(leftOut.length, size);
      assert.strictEqual(rightOut.length, size);
    }
  });

  test('EMP-13: 20-stage biquad cascade maintains finite precision and numerical stability', () => {
    const proc = new AutoEqProcessor(44100);
    const filters = [];
    for (let k = 0; k < 20; k++) {
      filters.push({
        type: k % 2 === 0 ? 'PEAKING' : 'LOW_SHELF',
        freq: 100 + k * 800,
        q: 1.0 + (k % 5) * 0.5,
        gainDb: ((k % 7) - 3) * 2.0, // Gains between -6 and +6 dB
      });
    }

    proc.setProfile(filters, -6.0);
    assert.strictEqual(proc.getFilters().length, 20);

    const N = 4096;
    const l = new Float32Array(N);
    const r = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      l[i] = 0.5 * (Math.random() * 2 - 1);
      r[i] = 0.5 * (Math.random() * 2 - 1);
    }

    proc.process(l, r);

    for (let i = 0; i < N; i++) {
      assert.ok(Number.isFinite(l[i]), `20-stage cascade output L[${i}] must be finite`);
      assert.ok(Number.isFinite(r[i]), `20-stage cascade output R[${i}] must be finite`);
    }
  });

  test('EMP-14: High concurrency SQLite lookups (50 parallel queries) resolve reliably without locking errors', async () => {
    const queries = [
      'Sony WH-1000XM4',
      'Sennheiser HD 600',
      'Apple AirPods Max',
      'Audeze LCD-X',
      'Beyerdynamic DT 770',
      '7Hz Salnotes Zero',
      'DUNU Titan S',
      'Focal Clear',
      'Hifiman Sundara',
      'Moondrop Blessing 2',
    ];

    const promises = [];
    for (let i = 0; i < 50; i++) {
      const q = queries[i % queries.length];
      promises.push(AutoEqLoader.findProfile(q));
    }

    const results = await Promise.all(promises);
    assert.strictEqual(results.length, 50);
    for (let i = 0; i < 50; i++) {
      const res = results[i];
      assert.ok(res, `Query ${i} (${queries[i % queries.length]}) should resolve successfully`);
      assert.ok(res.filters.length > 0, `Query ${i} should return biquad filters`);
    }
  });
});

console.log('=== ALL EMPIRICAL CHALLENGER TESTS LOADED ===');
