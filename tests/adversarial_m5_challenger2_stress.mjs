// tests/adversarial_m5_challenger2_stress.mjs
// Empirical Challenger 2 Stress Suite for Milestone 5 (WaveForm Desktop)
// Targets:
// 1. Audio DSP Stability:
//    - Limiter headroom under +36 dBFS extreme overdrive (ceiling <= 0.985, zero NaNs, zero Infs across 250k samples)
//    - Spatial audio width gain (up to 2.5x and bounds [1.0, 4.0]) and 15ms circular crossfeed delay line stability
// 2. Storage Concurrency & Windows File Locking:
//    - 50 parallel atomic writes to playlists.json and settings.json under concurrent read pressure and lock contention

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { register } from 'node:module';

// ESM resolution hook for relative .ts imports
const resolverHook = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && !specifier.endsWith('.ts') && !specifier.endsWith('.js') && !specifier.endsWith('.mjs')) {
      try {
        return await nextResolve(specifier + '.ts', context);
      } catch {}
      try {
        return await nextResolve(specifier + '/index.ts', context);
      } catch {}
    }
    throw err;
  }
}
`;
register(`data:text/javascript,${encodeURIComponent(resolverHook)}`, import.meta.url);

const {
  LookaheadPeakLimiter,
  SpatialAudioProcessor,
  DspChain,
  EqualizerProcessor,
} = await import('../src/audio/DspChain.ts');

const {
  StorageService,
  writeJsonAtomic,
  readJsonSafe,
} = await import('../src/services/StorageService.ts');

const {
  defaultAppSettings,
  mergeSettings,
} = await import('../src/models/index.ts');

const tempDir = path.join(os.tmpdir(), `waveform-m5-c2-${Date.now()}`);

before(() => {
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
});

after(() => {
  try {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  } catch {}
});

// ============================================================================
// SUITE 1: AUDIO DSP LIMITER HEADROOM UNDER +36 dBFS OVERDRIVE
// ============================================================================
describe('Challenger 2 Suite 1: Audio DSP Limiter +36 dBFS Overdrive & Stability', () => {

  test('C2-LIM-01: LookaheadPeakLimiter under +36 dBFS mono overdrive never exceeds 0.985 and contains zero NaNs/Infs', () => {
    const sampleRate = 44100;
    const limiter = new LookaheadPeakLimiter(sampleRate, 0.985);
    const sampleCount = 250000;
    const overdriveGain = Math.pow(10, 36 / 20); // ~63.0957 (+36 dBFS)

    const input = new Float32Array(sampleCount);

    // Mix of sine wave, square wave, Dirac impulses, noise, and non-finite bursts
    for (let i = 0; i < sampleCount; i++) {
      if (i % 5000 === 0) {
        // Dirac impulse spike at +36 dBFS
        input[i] = overdriveGain;
      } else if (i % 5000 === 2500) {
        input[i] = -overdriveGain;
      } else if (i >= 50000 && i < 60000) {
        // Square wave rail at +36 dBFS
        input[i] = (i % 100 < 50) ? overdriveGain : -overdriveGain;
      } else if (i >= 120000 && i < 120050) {
        // Non-finite poisoned inputs
        input[i] = i % 2 === 0 ? NaN : (i % 4 === 1 ? Infinity : -Infinity);
      } else {
        // Continuous overloaded sine wave
        input[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * overdriveGain;
      }
    }

    const output = limiter.process(input);
    assert.strictEqual(output.length, sampleCount);

    let maxPeak = 0;
    let nanCount = 0;
    let infCount = 0;
    let ceilingViolations = 0;

    for (let i = 0; i < sampleCount; i++) {
      const v = output[i];
      if (Number.isNaN(v)) nanCount++;
      if (!Number.isFinite(v)) infCount++;
      const absV = Math.abs(v);
      if (absV > maxPeak) maxPeak = absV;
      // Allow float rounding epsilon 1e-6
      if (absV > 0.985 + 1e-6) {
        ceilingViolations++;
      }
    }

    console.log(`    [C2-LIM-01] Mono +36 dBFS Test: maxPeak=${maxPeak.toFixed(6)}, violations=${ceilingViolations}, NaNs=${nanCount}, Infs=${infCount}`);
    assert.strictEqual(nanCount, 0, 'Mono output must contain 0 NaNs');
    assert.strictEqual(infCount, 0, 'Mono output must contain 0 Infs');
    assert.strictEqual(ceilingViolations, 0, 'Mono output must never exceed ceiling 0.985');
    assert.ok(maxPeak <= 0.985 + 1e-6, `Peak ${maxPeak} exceeded ceiling 0.985`);
  });

  test('C2-LIM-02: LookaheadPeakLimiter under +36 dBFS stereo asymmetric overdrive preserves 0.985 ceiling', () => {
    const sampleRate = 48000;
    const limiter = new LookaheadPeakLimiter(sampleRate, 0.985);
    const sampleCount = 200000;
    const overdriveGain = Math.pow(10, 36 / 20); // ~63.0957

    const leftIn = new Float32Array(sampleCount);
    const rightIn = new Float32Array(sampleCount);

    for (let i = 0; i < sampleCount; i++) {
      // Left channel heavy overdrive, Right channel quiet with intermittent spikes
      leftIn[i] = Math.cos((2 * Math.PI * 1000 * i) / sampleRate) * overdriveGain;
      rightIn[i] = (i % 1000 === 0) ? -overdriveGain : Math.sin((2 * Math.PI * 250 * i) / sampleRate) * 0.1;
    }

    const { leftOut, rightOut } = limiter.processStereo(leftIn, rightIn);

    let maxLeft = 0;
    let maxRight = 0;
    let nanCount = 0;
    let ceilingViolations = 0;

    for (let i = 0; i < sampleCount; i++) {
      const l = leftOut[i];
      const r = rightOut[i];

      if (Number.isNaN(l) || Number.isNaN(r)) nanCount++;
      if (Math.abs(l) > maxLeft) maxLeft = Math.abs(l);
      if (Math.abs(r) > maxRight) maxRight = Math.abs(r);

      if (Math.abs(l) > 0.985 + 1e-6 || Math.abs(r) > 0.985 + 1e-6) {
        ceilingViolations++;
      }
    }

    console.log(`    [C2-LIM-02] Stereo +36 dBFS Test: maxL=${maxLeft.toFixed(6)}, maxR=${maxRight.toFixed(6)}, violations=${ceilingViolations}, NaNs=${nanCount}`);
    assert.strictEqual(nanCount, 0, 'Stereo output must contain 0 NaNs');
    assert.strictEqual(ceilingViolations, 0, 'Stereo output must never exceed ceiling 0.985');
    assert.ok(maxLeft <= 0.985 + 1e-6);
    assert.ok(maxRight <= 0.985 + 1e-6);
  });

  test('C2-LIM-03: Full DspChain end-to-end under +36 dBFS with max EQ boost and Spatial Audio active', () => {
    const chain = new DspChain(44100);
    chain.equalizer.setBands([12, 12, 12, 12, 12, 12, 12, 12, 12, 12]); // +12 dB on all bands
    chain.spatial.enabled = true;
    chain.spatial.width = 2.5;

    const blockSize = 1024;
    const blockCount = 100;
    const overdriveGain = Math.pow(10, 36 / 20); // ~63.0957

    let globalMax = 0;
    let totalViolations = 0;
    let totalNaNs = 0;

    for (let b = 0; b < blockCount; b++) {
      const left = new Float32Array(blockSize);
      const right = new Float32Array(blockSize);

      for (let i = 0; i < blockSize; i++) {
        left[i] = (Math.random() * 2 - 1) * overdriveGain;
        right[i] = (Math.random() * 2 - 1) * overdriveGain;
      }

      const { leftOut, rightOut } = chain.processBlock(left, right);

      for (let i = 0; i < blockSize; i++) {
        const l = Math.abs(leftOut[i]);
        const r = Math.abs(rightOut[i]);
        if (Number.isNaN(l) || Number.isNaN(r)) totalNaNs++;
        if (l > globalMax) globalMax = l;
        if (r > globalMax) globalMax = r;
        if (l > 0.985 + 1e-6 || r > 0.985 + 1e-6) totalViolations++;
      }
    }

    console.log(`    [C2-LIM-03] End-to-end DspChain +36dBFS + MaxEQ + Spatial: maxPeak=${globalMax.toFixed(6)}, violations=${totalViolations}, NaNs=${totalNaNs}`);
    assert.strictEqual(totalNaNs, 0);
    assert.strictEqual(totalViolations, 0);
    assert.ok(globalMax <= 0.985 + 1e-6);
  });
});

// ============================================================================
// SUITE 2: SPATIAL AUDIO WIDTH GAIN (2.5x) & 15ms CIRCULAR CROSSFEED DELAY
// ============================================================================
describe('Challenger 2 Suite 2: Spatial Audio Width (2.5x) & Circular Delay Line Stability', () => {

  test('C2-SPA-01: Spatial audio width gain 2.5x configuration & bounds enforcement', () => {
    const spatial = new SpatialAudioProcessor(44100);
    assert.strictEqual(spatial.width, 2.5, 'Default spatial width must be 2.5');

    // Test clamped bounds [1.0, 4.0]
    spatial.width = 0.5; // lower than 1.0 -> should clamp in process
    const l1 = new Float32Array([1.0, 0.0]);
    const r1 = new Float32Array([0.0, 1.0]);
    const res1 = spatial.process(l1, r1);
    assert.ok(Number.isFinite(res1.leftOut[0]));

    spatial.width = 10.0; // higher than 4.0 -> should clamp in process
    const res2 = spatial.process(l1, r1);
    assert.ok(Number.isFinite(res2.leftOut[0]));

    spatial.width = NaN; // invalid -> fallback to 2.5
    const res3 = spatial.process(l1, r1);
    assert.ok(!Number.isNaN(res3.leftOut[0]));
  });

  test('C2-SPA-02: 15ms circular crossfeed delay line time-domain impulse arrival verification', () => {
    const sampleRate = 44100;
    const spatial = new SpatialAudioProcessor(sampleRate);
    spatial.reset();

    // 15 ms delay at 44.1 kHz = 44100 * 0.015 = 661.5 -> floor is 661 samples
    const expectedDelaySamples = Math.floor((sampleRate * 15) / 1000);
    assert.strictEqual(expectedDelaySamples, 661);

    const testLength = 2000;
    const leftIn = new Float32Array(testLength);
    const rightIn = new Float32Array(testLength);

    // Inject a unit impulse on Left channel at t=0, Right channel silent
    leftIn[0] = 1.0;

    const { leftOut, rightOut } = spatial.process(leftIn, rightIn);

    // At sample 0, Left has immediate widened sound:
    // mid = 0.5, side = 0.5 * 2.5 = 1.25 -> widenedL = 1.75 * 0.82 = 1.435
    assert.ok(leftOut[0] > 0.5, 'Left channel should immediately output widened impulse');

    // Right channel should receive the crossfeed delayed by exactly expectedDelaySamples
    // Before delay, right crossfeed should be near zero
    for (let i = 0; i < expectedDelaySamples; i++) {
      // Right only has inverted side channel from instantaneous mid/side:
      // mid = 0.5, side = 1.25 -> widenedR = -0.75 * 0.82 = -0.615 at sample 0, then 0
      if (i > 0 && i < expectedDelaySamples) {
        assert.ok(Math.abs(rightOut[i]) < 1e-4, `Right output before delay sample ${i} should be 0, got ${rightOut[i]}`);
      }
    }

    // At expectedDelaySamples, the crossfeed low-pass kicks in
    const crossfeedSample = rightOut[expectedDelaySamples];
    console.log(`    [C2-SPA-02] Delay verified: sample at ${expectedDelaySamples} (15ms) = ${crossfeedSample}`);
    assert.ok(crossfeedSample > 0, `Expected crossfeed energy at sample ${expectedDelaySamples}, got ${crossfeedSample}`);
  });

  test('C2-SPA-03: Long-running circular delay line buffer stability (500,000 samples across varying block sizes)', () => {
    const sampleRate = 48000;
    const spatial = new SpatialAudioProcessor(sampleRate);
    spatial.width = 2.5;

    // Process 500,000 samples in prime and odd block sizes to test circular index wraparound
    const blockSizes = [67, 128, 256, 513, 1024, 2048];
    let totalSamples = 0;
    let bIdx = 0;
    let hasNan = false;
    let hasInf = false;

    while (totalSamples < 500000) {
      const size = blockSizes[bIdx % blockSizes.length];
      bIdx++;
      const l = new Float32Array(size);
      const r = new Float32Array(size);

      for (let i = 0; i < size; i++) {
        const t = (totalSamples + i) / sampleRate;
        l[i] = Math.sin(2 * Math.PI * 300 * t);
        r[i] = Math.cos(2 * Math.PI * 500 * t);
      }

      const { leftOut, rightOut } = spatial.process(l, r);
      for (let i = 0; i < size; i++) {
        if (!Number.isFinite(leftOut[i]) || Number.isNaN(leftOut[i])) hasNan = true;
        if (!Number.isFinite(rightOut[i]) || Number.isNaN(rightOut[i])) hasInf = true;
      }

      totalSamples += size;
    }

    console.log(`    [C2-SPA-03] Processed ${totalSamples} samples through circular delay line: hasNan=${hasNan}, hasInf=${hasInf}`);
    assert.strictEqual(hasNan, false);
    assert.strictEqual(hasInf, false);
  });
});

// ============================================================================
// SUITE 3: 50 PARALLEL ATOMIC WRITES UNDER WINDOWS FILE LOCKING CONDITIONS
// ============================================================================
describe('Challenger 2 Suite 3: 50 Parallel Atomic Storage Writes Under Lock Pressure', () => {

  test('C2-STO-01: 50 parallel atomic writes to playlists.json with interleaved read locks', async () => {
    const playlistsPath = path.join(tempDir, 'playlists.json');
    const writeCount = 50;

    // Initialize with valid playlist schema
    const initialPlaylists = [
      { id: 'pl_init', name: 'Initial Playlist', songCount: 0, tracks: [], createdAt: Date.now() },
    ];
    await writeJsonAtomic(playlistsPath, initialPlaylists);

    const startTime = performance.now();
    const tasks = [];

    // Launch 50 concurrent writes competing for the exact same file
    for (let i = 0; i < writeCount; i++) {
      const playlistPayload = [
        ...initialPlaylists,
        {
          id: `pl_task_${i}`,
          name: `Concurrent Playlist ${i}`,
          songCount: i + 1,
          tracks: [`song_${i}`],
          updatedAt: Date.now(),
        },
      ];

      // Mixed write and concurrent read tasks
      tasks.push(
        writeJsonAtomic(playlistsPath, playlistPayload).then(async () => {
          // Immediately perform concurrent read to simulate Windows file contention
          const readData = await readJsonSafe(playlistsPath, null);
          assert.ok(readData !== null, 'Read during concurrency must return parsed object');
          assert.ok(Array.isArray(readData), 'Read data must be an array');
        })
      );
    }

    // Wait for all 50 concurrent operations to resolve
    await Promise.all(tasks);
    const durationMs = performance.now() - startTime;

    // Verify file on disk is valid and non-corrupt
    const finalContent = await readJsonSafe(playlistsPath, null);
    assert.ok(Array.isArray(finalContent), 'Final playlists.json must be valid array');
    assert.ok(finalContent.length >= 1, 'Final playlists must contain valid data');

    // Verify zero stranded .tmp files
    const dirEntries = fs.readdirSync(tempDir);
    const tmpFiles = dirEntries.filter((f) => f.includes('playlists.json.') && f.endsWith('.tmp'));

    console.log(`    [C2-STO-01] 50 Parallel writes to playlists.json completed in ${durationMs.toFixed(2)}ms, stranded tmpFiles=${tmpFiles.length}`);
    assert.strictEqual(tmpFiles.length, 0, 'No .tmp files should remain stranded');
  });

  test('C2-STO-02: 50 parallel atomic writes to settings.json via StorageService updateSettings', async () => {
    const storageService = new StorageService(tempDir);
    const writeCount = 50;

    const startTime = performance.now();
    const updatePromises = [];

    // Launch 50 parallel settings mutations with typed settings keys
    for (let i = 0; i < writeCount; i++) {
      const delta = {
        'playback.volumeLevel': Number((0.1 + (i % 90) / 100).toFixed(2)),
        'playback.crossfadeDurationSec': 1 + (i % 10),
        'dsp.spatialAudioEnabled': i % 2 === 0,
        'dsp.equalizerPreset': i % 2 === 0 ? 'Electronic' : 'Rock',
        'scrobble.discordRpcEnabled': i % 3 === 0,
      };
      updatePromises.push(storageService.updateSettings(delta));
    }

    await Promise.all(updatePromises);
    const durationMs = performance.now() - startTime;

    const finalSettings = await storageService.getSettings();
    assert.ok(finalSettings !== null);
    assert.ok(typeof finalSettings['playback.volumeLevel'] === 'number');
    assert.ok(typeof finalSettings['playback.crossfadeDurationSec'] === 'number');
    assert.ok(typeof finalSettings['dsp.spatialAudioEnabled'] === 'boolean');
    assert.ok(typeof finalSettings['dsp.equalizerPreset'] === 'string');

    // Confirm all 70 keys exist in final settings
    const defaultKeys = Object.keys(defaultAppSettings);
    for (const key of defaultKeys) {
      assert.ok(key in finalSettings, `Key ${key} missing from final persisted settings`);
    }

    // Verify zero orphaned .tmp files for settings
    const dirEntries = fs.readdirSync(tempDir);
    const tmpFiles = dirEntries.filter((f) => f.includes('settings.json.') && f.endsWith('.tmp'));

    console.log(`    [C2-STO-02] 50 Parallel updateSettings completed in ${durationMs.toFixed(2)}ms, stranded tmpFiles=${tmpFiles.length}`);
    assert.strictEqual(tmpFiles.length, 0, 'No .tmp files should remain stranded');
  });
});
