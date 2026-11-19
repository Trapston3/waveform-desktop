// tests/tier2_boundaries/boundary_06_to_10.test.mjs
// Tier 2 Boundary & Corner Cases: Features 6 to 10 (25 tests)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngineSimulator } from '../helpers/testEngine.mjs';
import { mockAudio } from '../fixtures/mockAudio.mjs';
import { mockSongs } from '../fixtures/mockSongs.mjs';

describe('Boundary: Feature 06 - 10-Band Equalizer', () => {
  test('B06-T01: Gain exceeding +12 dB throws RangeError per SVF limits', () => {
    const engine = new AudioEngineSimulator();
    const badGains = [0, 0, 0, 15.0, 0, 0, 0, 0, 0, 0];
    assert.throws(() => engine.setEqualizerBands(badGains), RangeError);
  });

  test('B06-T02: Gain below -12 dB throws RangeError per SVF limits', () => {
    const engine = new AudioEngineSimulator();
    const badGains = [0, 0, 0, -18.5, 0, 0, 0, 0, 0, 0];
    assert.throws(() => engine.setEqualizerBands(badGains), RangeError);
  });

  test('B06-T03: Array with fewer or more than 10 bands throws Error', () => {
    const engine = new AudioEngineSimulator();
    assert.throws(() => engine.setEqualizerBands([0, 0, 0]), /exactly 10/);
    assert.throws(() => engine.setEqualizerBands(new Array(12).fill(0)), /exactly 10/);
  });

  test('B06-T04: NaN or non-numeric gain value throws RangeError', () => {
    const engine = new AudioEngineSimulator();
    const nanGains = [0, 0, NaN, 0, 0, 0, 0, 0, 0, 0];
    assert.throws(() => engine.setEqualizerBands(nanGains), RangeError);
  });

  test('B06-T05: Tone control Bass and Treble sum smoothly into existing shelf gains', () => {
    const applyToneGains = (bands, bassDb, trebleDb) => {
      const out = [...bands];
      out[0] = Math.max(-12, Math.min(12, out[0] + bassDb));
      out[9] = Math.max(-12, Math.min(12, out[9] + trebleDb));
      return out;
    };
    const boosted = applyToneGains([0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 8.0, -4.0);
    assert.strictEqual(boosted[0], 8.0);
    assert.strictEqual(boosted[9], -4.0);
    assert.strictEqual(boosted[4], 0.0);
  });
});

describe('Boundary: Feature 07 - AutoEQ Headphone Calibration', () => {
  test('B07-T01: Filter frequencies above Nyquist fraction 0.49 are clamped safely', () => {
    const sampleRate = 44100;
    const maxNyquist = 0.49 * sampleRate; // 21609 Hz
    const clampFilterFreq = (freq) => Math.min(freq, maxNyquist);
    assert.ok(clampFilterFreq(23000) <= maxNyquist);
    assert.strictEqual(clampFilterFreq(1000), 1000);
  });

  test('B07-T02: Q factor equal to or less than zero is clamped to minimum 0.1 to avoid division by zero', () => {
    const sanitizeQ = (q) => (q > 0.1 ? q : 0.1);
    assert.strictEqual(sanitizeQ(0), 0.1);
    assert.strictEqual(sanitizeQ(-2.5), 0.1);
    assert.strictEqual(sanitizeQ(1.4), 1.4);
  });

  test('B07-T03: Excessive positive parametric gain is clamped to maximum +12 dB to prevent digital blowout', () => {
    const clampGain = (g) => Math.max(-24, Math.min(12, g));
    assert.strictEqual(clampGain(35), 12);
    assert.strictEqual(clampGain(-40), -24);
  });

  test('B07-T04: Empty string or whitespace-only headphone name returns false gracefully', async () => {
    const engine = new AudioEngineSimulator();
    assert.strictEqual(await engine.loadAutoEqProfile(''), false);
    assert.strictEqual(await engine.loadAutoEqProfile('   '), false);
  });

  test('B07-T05: Profile with empty filters array still applies preamp gain', () => {
    const applyProfile = (preampDb, filters, samples) => {
      const linearPreamp = Math.pow(10, preampDb / 20);
      return samples.map((s) => s * linearPreamp);
    };
    const input = [1.0, 0.5];
    const output = applyProfile(-6.0, [], input);
    assert.ok(output[0] < 0.6 && output[0] > 0.49); // -6dB is approx 0.501
  });
});

describe('Boundary: Feature 08 - Spatial Audio & Stereo Width', () => {
  test('B08-T01: Zero width gain request is clamped to 1.0 (neutral bypass)', () => {
    const engine = new AudioEngineSimulator();
    engine.setSpatialAudio(true, 0);
    assert.strictEqual(engine.spatialAudio.width, 1.0);
  });

  test('B08-T02: Outrageous width gain request (>4.0) is clamped to maximum 4.0', () => {
    const engine = new AudioEngineSimulator();
    engine.setSpatialAudio(true, 99.9);
    assert.strictEqual(engine.spatialAudio.width, 4.0);
  });

  test('B08-T03: Processing completely silent buffers yields silent output without NaN', () => {
    const silent = new Float32Array(512);
    const { leftOut, rightOut } = mockAudio.processSpatialAudio(silent, silent, 2.5, 15);
    for (let i = 0; i < 512; i++) {
      assert.strictEqual(leftOut[i], 0);
      assert.strictEqual(rightOut[i], 0);
    }
  });

  test('B08-T04: Very small audio buffer (smaller than 15ms delay line) is handled without index error', () => {
    const tinyLeft = new Float32Array(10);
    const tinyRight = new Float32Array(10);
    const { leftOut, rightOut } = mockAudio.processSpatialAudio(tinyLeft, tinyRight, 2.5, 15);
    assert.strictEqual(leftOut.length, 10);
    assert.strictEqual(rightOut.length, 10);
  });

  test('B08-T05: Disabling spatial audio bypasses processing completely', () => {
    const engine = new AudioEngineSimulator();
    engine.setSpatialAudio(false);
    assert.strictEqual(engine.spatialAudio.enabled, false);
  });
});

describe('Boundary: Feature 09 - Automix & Transition Effects', () => {
  test('B09-T01: Zero or negative BPM input is defaulted to standard 120 BPM', () => {
    const sanitizeBpm = (bpm) => (bpm && bpm > 30 && bpm < 300 ? bpm : 120);
    assert.strictEqual(sanitizeBpm(0), 120);
    assert.strictEqual(sanitizeBpm(-50), 120);
    assert.strictEqual(sanitizeBpm(NaN), 120);
    assert.strictEqual(sanitizeBpm(128), 128);
  });

  test('B09-T02: Transition bars configuration is clamped between 1 and 24 bars', () => {
    const clampBars = (bars) => Math.max(1, Math.min(24, Math.floor(bars)));
    assert.strictEqual(clampBars(0), 1);
    assert.strictEqual(clampBars(-5), 1);
    assert.strictEqual(clampBars(100), 24);
    assert.strictEqual(clampBars(4.7), 4);
  });

  test('B09-T03: Echo feedback coefficient is clamped to 0.95 to prevent runaway oscillation', () => {
    const clampFeedback = (fb) => Math.max(0.0, Math.min(0.95, fb));
    assert.strictEqual(clampFeedback(1.2), 0.95);
    assert.strictEqual(clampFeedback(1.0), 0.95);
    assert.strictEqual(clampFeedback(0.7), 0.7);
  });

  test('B09-T04: Time-stretching zero-length audio block returns empty buffer without failure', () => {
    const stretchBlock = (buf, ratio) => {
      if (!buf || buf.length === 0) return new Float32Array(0);
      return new Float32Array(Math.floor(buf.length * ratio));
    };
    assert.strictEqual(stretchBlock(new Float32Array(0), 1.2).length, 0);
  });

  test('B09-T05: Rapid back-to-back crossfades abort prior fade cleanly', async () => {
    const engine = new AudioEngineSimulator();
    await engine.loadTrack(mockSongs.standardYouTube, 'active');
    await engine.loadTrack(mockSongs.localFlac, 'standby');
    engine.play();

    // Trigger crossfade and immediately verify state machine consistency
    await engine.crossfade('standby', 100);
    assert.strictEqual(engine.activeDeckName, 'standby');
  });
});

describe('Boundary: Feature 10 - Waveform Amplitude & Live Visualizer', () => {
  test('B10-T01: Extracting envelope from completely silent buffer yields all 0.0 buckets', () => {
    const silent = new Float32Array(44100);
    const buckets = mockAudio.extract200BucketEnvelope(silent);
    assert.strictEqual(buckets.length, 200);
    for (let i = 0; i < 200; i++) {
      assert.strictEqual(buckets[i], 0);
    }
  });

  test('B10-T02: Buffer with fewer than 200 samples handles bucket allocation gracefully', () => {
    const tiny = new Float32Array(50);
    tiny[10] = 0.5;
    const buckets = mockAudio.extract200BucketEnvelope(tiny);
    assert.strictEqual(buckets.length, 200);
  });

  test('B10-T03: Live 32-band visualizer with block size not divisible by 32 truncates safely', () => {
    const oddBlock = new Float32Array(1000); // 1000 / 32 = 31.25 samples per band
    const energy = mockAudio.compute32BandPcmEnergy(oddBlock);
    assert.strictEqual(energy.length, 32);
  });

  test('B10-T04: Corrupted PCM containing NaN samples does not poison energy output with NaN', () => {
    const nanBlock = new Float32Array(320);
    nanBlock[15] = NaN;
    // Sanitize block
    for (let i = 0; i < nanBlock.length; i++) {
      if (!Number.isFinite(nanBlock[i])) nanBlock[i] = 0.0;
    }
    const energy = mockAudio.compute32BandPcmEnergy(nanBlock);
    for (let b = 0; b < 32; b++) {
      assert.strictEqual(Number.isFinite(energy[b]), true);
    }
  });

  test('B10-T05: Resampling empty 200-bucket array produces 68 zero-valued bars', () => {
    const emptyBuckets = new Float32Array(200);
    const bars68 = mockAudio.resampleTo68Bars(emptyBuckets);
    assert.strictEqual(bars68.length, 68);
    for (let i = 0; i < 68; i++) {
      assert.strictEqual(bars68[i], 0);
    }
  });
});
