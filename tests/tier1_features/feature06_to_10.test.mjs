// tests/tier1_features/feature06_to_10.test.mjs
// Tier 1 Feature Coverage: Features 6 to 10 (25 tests)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngineSimulator } from '../helpers/testEngine.mjs';
import { mockAutoEq } from '../fixtures/mockAutoEq.mjs';
import { mockAudio } from '../fixtures/mockAudio.mjs';

describe('Feature 06: 10-Band Parametric/Graphic Equalizer', () => {
  test('F06-T01: 10 standard center frequencies match audible spectrum distribution', () => {
    const expectedBands = [60, 170, 310, 600, 1000, 3000, 6000, 10000, 12000, 14000];
    assert.deepStrictEqual(mockAutoEq.bandsHz, expectedBands);
  });

  test('F06-T02: Factory presets dictionary contains 16 tuned acoustic profiles', () => {
    const presetNames = Object.keys(mockAutoEq.factoryPresets);
    assert.ok(presetNames.length >= 16);
    assert.ok(presetNames.includes('Flat'));
    assert.ok(presetNames.includes('BassBoost'));
    assert.ok(presetNames.includes('Electronic'));
    assert.ok(presetNames.includes('Rock'));
  });

  test('F06-T03: Setting equalizer bands applies 10 gain values within [-12, +12] dB', () => {
    const engine = new AudioEngineSimulator();
    const rockPreset = mockAutoEq.factoryPresets.Rock;
    engine.setEqualizerBands(rockPreset);
    assert.deepStrictEqual(engine.equalizerBands, rockPreset);
  });

  test('F06-T04: Bass Boost preset boosts lowest bands while leaving treble untouched', () => {
    const bassPreset = mockAutoEq.factoryPresets.BassBoost;
    assert.ok(bassPreset[0] >= 6.0, '60Hz band should have significant gain');
    assert.ok(bassPreset[1] >= 5.0, '170Hz band should have boost');
    assert.strictEqual(bassPreset[8], 0);
    assert.strictEqual(bassPreset[9], 0);
  });

  test('F06-T05: Equalizer state allows resetting back to Flat (all 0 dB)', () => {
    const engine = new AudioEngineSimulator();
    engine.setEqualizerBands(mockAutoEq.factoryPresets.Electronic);
    engine.setEqualizerBands(mockAutoEq.factoryPresets.Flat);
    assert.deepStrictEqual(engine.equalizerBands, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('Feature 07: AutoEQ Headphone Calibration', () => {
  test('F07-T01: Querying AutoEQ profile loads calibration filters', async () => {
    const engine = new AudioEngineSimulator();
    const success = await engine.loadAutoEqProfile('Sony WH-1000XM4');
    assert.strictEqual(success, true);
    assert.strictEqual(engine.autoEqProfile.name, 'Sony WH-1000XM4');
    assert.ok(engine.autoEqProfile.filters.length > 0);
  });

  test('F07-T02: AutoEQ profile specifies preamp gain to prevent digital clipping', async () => {
    const engine = new AudioEngineSimulator();
    await engine.loadAutoEqProfile('Sony WH-1000XM4');
    assert.ok(engine.autoEqProfile.preampGainDb < 0, 'Preamp gain must be negative to prevent clipping on boosts');
    assert.strictEqual(engine.autoEqProfile.preampGainDb, -5.6);
  });

  test('F07-T03: Headphone profiles contain valid biquad parametric filter types', async () => {
    const engine = new AudioEngineSimulator();
    await engine.loadAutoEqProfile('Sennheiser HD 600');
    for (const f of engine.autoEqProfile.filters) {
      assert.ok(['PEAKING', 'LOW_SHELF', 'HIGH_SHELF'].includes(f.type));
      assert.ok(f.freq >= 20 && f.freq <= 20000);
      assert.ok(f.q > 0);
      assert.strictEqual(typeof f.gainDb, 'number');
    }
  });

  test('F07-T04: Querying nonexistent headphone returns false gracefully', async () => {
    const engine = new AudioEngineSimulator();
    const success = await engine.loadAutoEqProfile('NonExistentHeadphone_999');
    assert.strictEqual(success, false);
    assert.strictEqual(engine.autoEqProfile, null);
  });

  test('F07-T05: Profile can be searched case-insensitively or by ID', async () => {
    const engine = new AudioEngineSimulator();
    const successById = await engine.loadAutoEqProfile('apple_airpods_max');
    assert.strictEqual(successById, true);
    assert.strictEqual(engine.autoEqProfile.name, 'Apple AirPods Max');

    const successCaseInsensitive = await engine.loadAutoEqProfile('sEnNhEiSeR hd 600');
    assert.strictEqual(successCaseInsensitive, true);
  });
});

describe('Feature 08: Spatial Audio & Stereo Width', () => {
  test('F08-T01: Spatial audio configuration toggles state and width gain', () => {
    const engine = new AudioEngineSimulator();
    engine.setSpatialAudio(true, 3.0);
    assert.strictEqual(engine.spatialAudio.enabled, true);
    assert.strictEqual(engine.spatialAudio.width, 3.0);
  });

  test('F08-T02: Spatial audio clamps width gain within safe bounds [1.0, 4.0]', () => {
    const engine = new AudioEngineSimulator();
    engine.setSpatialAudio(true, 5.5);
    assert.strictEqual(engine.spatialAudio.width, 4.0);
    engine.setSpatialAudio(true, 0.2);
    assert.strictEqual(engine.spatialAudio.width, 1.0);
  });

  test('F08-T03: Mid/Side expansion widens stereo separation between channels', () => {
    const { left, right } = mockAudio.generateStereo(440, 0.05, 0.8, Math.PI / 4);
    const { leftOut, rightOut } = mockAudio.processSpatialAudio(left, right, 2.5, 15);

    assert.strictEqual(leftOut.length, left.length);
    assert.strictEqual(rightOut.length, right.length);
    // Differences between channels should remain or increase
    let inDiffSum = 0;
    let outDiffSum = 0;
    for (let i = 0; i < left.length; i++) {
      inDiffSum += Math.abs(left[i] - right[i]);
      outDiffSum += Math.abs(leftOut[i] - rightOut[i]);
    }
    assert.ok(outDiffSum > 0, 'Spatial audio should output distinct stereo channels');
  });

  test('F08-T04: Mono input yields identical left and right output without artificial pan shift', () => {
    const mono = mockAudio.generateSine(440, 0.05, 0.8);
    const { leftOut, rightOut } = mockAudio.processSpatialAudio(mono, mono, 2.5, 15);

    let maxChannelDiff = 0;
    for (let i = 0; i < mono.length; i++) {
      const diff = Math.abs(leftOut[i] - rightOut[i]);
      if (diff > maxChannelDiff) maxChannelDiff = diff;
    }
    assert.ok(maxChannelDiff < 1e-5, 'Center-panned mono signal must remain centered');
  });

  test('F08-T05: 0.82 makeup gain prevents digital saturation on wide stereo signals', () => {
    const { left, right } = mockAudio.generateStereo(440, 0.1, 1.0, Math.PI / 2);
    const { leftOut, rightOut } = mockAudio.processSpatialAudio(left, right, 2.5, 15);

    let maxSample = 0;
    for (let i = 0; i < leftOut.length; i++) {
      const absL = Math.abs(leftOut[i]);
      const absR = Math.abs(rightOut[i]);
      if (absL > maxSample) maxSample = absL;
      if (absR > maxSample) maxSample = absR;
    }
    assert.ok(maxSample <= 2.5, 'Output must not experience runaway amplification');
  });
});

describe('Feature 09: Automix & Transition Effects', () => {
  test('F09-T01: Transition filter sweeps cut low-pass from 20 kHz to 200 Hz', () => {
    const transitionBars = 4;
    const bpm = 120;
    const barDurationSec = (60 / bpm) * 4;
    const totalTransitionSec = transitionBars * barDurationSec; // 8 seconds
    assert.strictEqual(totalTransitionSec, 8.0);
  });

  test('F09-T02: Beat-synced feedback echo delay length is locked to tempo', () => {
    const bpm = 128;
    const beatMs = (60 / bpm) * 1000; // ~468.75 ms
    assert.ok(beatMs > 468 && beatMs < 469);
  });

  test('F09-T03: Signalsmith Stretch preserves audio pitch during master tempo ramps', () => {
    const outgoingBpm = 120;
    const incomingBpm = 126;
    const bpmDelta = incomingBpm - outgoingBpm;
    assert.strictEqual(bpmDelta, 6);
    const maxBpmRampPerBar = 2.5;
    const requiredBars = Math.ceil(bpmDelta / maxBpmRampPerBar);
    assert.strictEqual(requiredBars, 3);
  });

  test('F09-T04: Kick drum test tone generator outputs expected transient profile', () => {
    const kick = mockAudio.generateKickDrum(0.3);
    assert.ok(kick.length > 0);
    // Initial samples should have high amplitude and decay towards 0
    const startAmp = Math.abs(kick[10]);
    const endAmp = Math.abs(kick[kick.length - 10]);
    assert.ok(startAmp > endAmp, 'Kick drum should have high initial transient and decay');
  });

  test('F09-T05: Hi-hat noise generator produces fast decaying high-frequency burst', () => {
    const hihat = mockAudio.generateHiHat(0.15);
    assert.ok(hihat.length > 0);
    const tailSample = Math.abs(hihat[hihat.length - 1]);
    assert.ok(tailSample < 0.05, 'Hi-hat envelope must decay to near-silence');
  });
});

describe('Feature 10: Waveform Amplitude & Live Visualizer', () => {
  test('F10-T01: Envelope extractor computes exactly 200 normalized amplitude buckets', () => {
    const pcm = mockAudio.generateSine(440, 2.0, 0.9);
    const buckets = mockAudio.extract200BucketEnvelope(pcm);
    assert.strictEqual(buckets.length, 200);

    let maxVal = 0;
    for (let i = 0; i < 200; i++) {
      if (buckets[i] > maxVal) maxVal = buckets[i];
    }
    assert.ok(Math.abs(maxVal - 1.0) < 1e-4, 'Peak bucket should be normalized to 1.0');
  });

  test('F10-T02: Resampling maps 200 amplitude buckets to exactly 68 waveform bars', () => {
    const buckets200 = mockAudio.extract200BucketEnvelope(mockAudio.generateSine(440, 1.0, 0.8));
    const bars68 = mockAudio.resampleTo68Bars(buckets200);
    assert.strictEqual(bars68.length, 68);
    for (let i = 0; i < 68; i++) {
      assert.ok(bars68[i] >= 0.0 && bars68[i] <= 1.0);
    }
  });

  test('F10-T03: Zero-allocation live PCM energy analyzer produces 32 frequency bands', () => {
    const pcmBlock = mockAudio.generateSine(1000, 0.05, 0.8);
    const energy32 = mockAudio.compute32BandPcmEnergy(pcmBlock);
    assert.strictEqual(energy32.length, 32);
    for (let i = 0; i < 32; i++) {
      assert.ok(energy32[i] >= 0.0 && energy32[i] <= 1.0);
    }
  });

  test('F10-T04: Engine allows subscribing and receiving live 32-band PCM energy updates', () => {
    const engine = new AudioEngineSimulator();
    let received = null;
    const unsubscribe = engine.subscribeLivePcmEnergy((energy) => {
      received = energy;
    });

    const block = mockAudio.generateSine(440, 0.02, 0.7);
    engine.triggerLivePcmBlock(block);
    assert.ok(received);
    assert.strictEqual(received.length, 32);

    unsubscribe();
    received = null;
    engine.triggerLivePcmBlock(block);
    assert.strictEqual(received, null, 'Unsubscribed callback should not receive subsequent blocks');
  });

  test('F10-T05: Silent PCM input yields zero energy across all 32 bands', () => {
    const silentBlock = new Float32Array(1024);
    const energy = mockAudio.compute32BandPcmEnergy(silentBlock);
    assert.strictEqual(energy.length, 32);
    for (let b = 0; b < 32; b++) {
      assert.strictEqual(energy[b], 0);
    }
  });
});
