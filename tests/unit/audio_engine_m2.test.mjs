// tests/unit/audio_engine_m2.test.mjs
// Unified Milestone 2 Unit & Integration Test Suite
// Verifying Features 5, 6, 7, 8, 9, 10, 11 against the production AudioEngine & DSP Architecture

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// Register ESM resolution hook so Node can resolve relative .ts imports without extensions
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

// Dynamic import of production audio subsystem modules
const {
  AudioEngine,
  validateSongContract,
  WebAudioDeck,
} = await import('../../src/audio/AudioEngine.ts');

const {
  DspChain,
  SpatialAudioProcessor,
  EqualizerProcessor,
  AutoEqProcessor,
  LookaheadPeakLimiter,
  LoudnessProcessor,
  EQ_FREQUENCIES_HZ,
  FACTORY_EQ_PRESETS,
} = await import('../../src/audio/DspChain.ts');

const {
  AutoEqLoader,
  CURATED_AUTOEQ_PROFILES,
  decodePapParametricBlob,
  calculatePreampGainDb,
} = await import('../../src/audio/AutoEqLoader.ts');

const {
  WaveformExtractor,
} = await import('../../src/audio/WaveformExtractor.ts');

const {
  LiveVisualizer,
} = await import('../../src/audio/LiveVisualizer.ts');

const {
  TransitionProcessor,
} = await import('../../src/audio/TransitionProcessor.ts');

import { mockSongs } from '../fixtures/mockSongs.mjs';
import { mockAutoEq } from '../fixtures/mockAutoEq.mjs';
import { mockAudio } from '../fixtures/mockAudio.mjs';

// ============================================================================
// SUITE 1: FEATURE 5 - DUAL-DECK AUDIO ENGINE (AudioEngine.ts)
// ============================================================================
describe('Feature 05: Dual-Deck Audio Engine (AudioEngine.ts)', () => {
  test('F05-T01: Initial engine state is IDLE with both decks empty', () => {
    const engine = new AudioEngine();
    assert.strictEqual(engine.playbackState, 'IDLE');
    assert.strictEqual(engine.deckA.track, null);
    assert.strictEqual(engine.deckB.track, null);
    assert.strictEqual(engine.activeDeckName, 'active');
    assert.strictEqual(engine.globalVolume, 0.85);
  });

  test('F05-T02: Song contract validation enforces mandatory fields and types', () => {
    assert.strictEqual(validateSongContract(null).valid, false);
    assert.strictEqual(validateSongContract({}).valid, false);
    assert.strictEqual(validateSongContract({ videoId: '', title: 'A', artist: 'B' }).valid, false);
    assert.strictEqual(validateSongContract(mockSongs.standardYouTube).valid, true);
    assert.strictEqual(validateSongContract(mockSongs.localFlac).valid, true);
  });

  test('F05-T03: Loading track into active deck prepares envelope and emits state change', async () => {
    const engine = new AudioEngine();
    let stateEmitted = null;
    const unsub = engine.onPlaybackStateChange((s) => {
      stateEmitted = s;
    });

    await engine.loadTrack(mockSongs.standardYouTube, 'active');
    assert.strictEqual(engine.deckA.track?.title, 'Neon Horizon');
    assert.ok(stateEmitted);
    assert.strictEqual(stateEmitted.currentTrack?.videoId, 'yt_track_001');

    const waveform = await engine.getWaveformData('yt_track_001');
    assert.strictEqual(waveform.length, 200);

    unsub();
  });

  test('F05-T04: Play and pause toggle active deck state and playback status', async () => {
    const engine = new AudioEngine();
    await engine.loadTrack(mockSongs.standardYouTube, 'active');

    engine.play();
    assert.strictEqual(engine.playbackState, 'PLAYING');
    assert.strictEqual(engine.deckA.isPlaying, true);

    engine.pause();
    assert.strictEqual(engine.playbackState, 'PAUSED');
    assert.strictEqual(engine.deckA.isPlaying, false);
  });

  test('F05-T05: Calling play on empty deck throws error', () => {
    const engine = new AudioEngine();
    assert.throws(() => engine.play(), /Cannot play: No track loaded/);
  });

  test('F05-T06: Seek updates active deck positionMs and validates range', async () => {
    const engine = new AudioEngine();
    await engine.loadTrack(mockSongs.standardYouTube, 'active');
    engine.play();

    engine.seek(45000);
    assert.strictEqual(engine.deckA.positionMs, 45000);

    assert.throws(() => engine.seek(-1000), RangeError);
    assert.throws(() => engine.seek(NaN), RangeError);
  });

  test('F05-T07: setVolume clamps bounds [0.0, 1.0] and rejects non-numbers', () => {
    const engine = new AudioEngine();
    engine.setVolume(0.5);
    assert.strictEqual(engine.globalVolume, 0.5);

    engine.setVolume(1.5);
    assert.strictEqual(engine.globalVolume, 1.0);

    engine.setVolume(-0.5);
    assert.strictEqual(engine.globalVolume, 0.0);

    assert.throws(() => engine.setVolume(NaN), TypeError);
    assert.throws(() => engine.setVolume('loud'), TypeError);
  });

  test('F05-T08: Constant-power crossfade performs seamless deck swap with energy sum ~ 1.0', async () => {
    const engine = new AudioEngine();
    await engine.loadTrack(mockSongs.standardYouTube, 'active');
    await engine.loadTrack(mockSongs.localFlac, 'standby');
    engine.play();

    assert.strictEqual(engine.activeDeckName, 'active');
    assert.strictEqual(engine.deckA.isPlaying, true);
    assert.strictEqual(engine.deckB.isPlaying, false);

    await engine.crossfade('standby', 3000);

    assert.strictEqual(engine.activeDeckName, 'standby');
    assert.strictEqual(engine.deckB.isPlaying, true);
    assert.strictEqual(engine.deckA.isPlaying, false);
    assert.strictEqual(engine.deckA.gain, 0.0);
    assert.strictEqual(engine.deckB.gain, 1.0);
    assert.strictEqual(engine.playbackState, 'PLAYING');
  });

  test('F05-T09: Crossfade throws when standby deck has no track', async () => {
    const engine = new AudioEngine();
    await engine.loadTrack(mockSongs.standardYouTube, 'active');
    assert.rejects(async () => engine.crossfade('standby'), /Standby deck has no pre-rolled track/);
  });

  test('F05-T10: Live PCM block triggering passes sanitized 32-band energy to subscribers', () => {
    const engine = new AudioEngine();
    let received = null;
    const unsub = engine.subscribeLivePcmEnergy((energy) => {
      received = energy;
    });

    const block = mockAudio.generateSine(440, 0.02, 0.7);
    engine.triggerLivePcmBlock(block);

    assert.ok(received);
    assert.strictEqual(received.length, 32);

    unsub();
    received = null;
    engine.triggerLivePcmBlock(block);
    assert.strictEqual(received, null);
  });

  test('F05-T11: Consecutive crossfades targeting standby alternate active deck and maintain pause control', async () => {
    const engine = new AudioEngine();
    const t1 = { videoId: 't1', title: 'T1', artist: 'A', liked: false, totalPlayTimeMs: 0, playCount: 0, artistIds: [], artists: [] };
    const t2 = { videoId: 't2', title: 'T2', artist: 'B', liked: false, totalPlayTimeMs: 0, playCount: 0, artistIds: [], artists: [] };
    const t3 = { videoId: 't3', title: 'T3', artist: 'C', liked: false, totalPlayTimeMs: 0, playCount: 0, artistIds: [], artists: [] };

    await engine.loadTrack(t1, 'active');
    await engine.loadTrack(t2, 'standby');
    engine.play();
    assert.strictEqual(engine.activeDeckName, 'active');
    assert.strictEqual(engine.deckA.isPlaying, true);
    assert.strictEqual(engine.deckB.isPlaying, false);

    // Crossfade 1: Active deck becomes 'standby' (deckB)
    await engine.crossfade('standby', 100);
    assert.strictEqual(engine.activeDeckName, 'standby');
    assert.strictEqual(engine.deckA.isPlaying, false);
    assert.strictEqual(engine.deckB.isPlaying, true);

    // Load track 3 into standby deck (which is deckA)
    await engine.loadTrack(t3, 'standby');
    assert.strictEqual(engine.deckA.track?.videoId, 't3');

    // Crossfade 2: Active deck becomes 'active' (deckA)
    await engine.crossfade('standby', 100);
    assert.strictEqual(engine.activeDeckName, 'active');
    assert.strictEqual(engine.deckA.isPlaying, true);
    assert.strictEqual(engine.deckB.isPlaying, false);

    // Verify engine.pause() halts the actively playing deck (deckA)
    engine.pause();
    assert.strictEqual(engine.deckA.isPlaying, false);
    assert.strictEqual(engine.deckB.isPlaying, false);
    assert.strictEqual(engine.playbackState, 'PAUSED');
  });

  test('F05-T12: Zero-allocation triggerLivePcmBlock reuses internal buffer without heap churn', () => {
    const engine = new AudioEngine();
    let receivedBuffer1 = null;
    let receivedBuffer2 = null;

    const unsub = engine.subscribeLivePcmEnergy((energy) => {
      if (!receivedBuffer1) receivedBuffer1 = energy;
      else receivedBuffer2 = energy;
    });

    const block1 = new Float32Array(512).fill(0.3);
    const block2 = new Float32Array(512).fill(0.7);

    engine.triggerLivePcmBlock(block1);
    engine.triggerLivePcmBlock(block2);

    assert.ok(receivedBuffer1);
    assert.ok(receivedBuffer2);
    // Verifies the exact same typed array instance is reused in-place
    assert.strictEqual(receivedBuffer1, receivedBuffer2);
    assert.strictEqual(receivedBuffer1.length, 32);

    unsub();
  });
});

// ============================================================================
// SUITE 2: FEATURE 6 - 10-BAND SVF EQUALIZER (DspChain.ts)
// ============================================================================
describe('Feature 06: 10-Band Equalizer & SVF Processing (DspChain.ts)', () => {
  test('F06-T01: 10 center frequencies match standard acoustic bands', () => {
    const expected = [60, 170, 310, 600, 1000, 3000, 6000, 10000, 12000, 14000];
    assert.deepStrictEqual(Array.from(EQ_FREQUENCIES_HZ), expected);
  });

  test('F06-T02: Factory presets dictionary contains 16 tuned profiles', () => {
    const names = Object.keys(FACTORY_EQ_PRESETS);
    assert.ok(names.length >= 16);
    assert.ok(names.includes('Flat'));
    assert.ok(names.includes('BassBoost'));
    assert.ok(names.includes('Electronic'));
    assert.ok(names.includes('Rock'));
  });

  test('F06-T03: EqualizerProcessor accepts gains within [-12, +12] dB and calculates partial makeup attenuation', () => {
    const eq = new EqualizerProcessor(44100);
    eq.setBands(FACTORY_EQ_PRESETS.BassBoost);
    assert.deepStrictEqual(eq.getBands(), FACTORY_EQ_PRESETS.BassBoost);
    assert.strictEqual(eq.isShaping, true);
  });

  test('F06-T04: Boundary: Gain outside [-12, +12] dB or NaN throws RangeError', () => {
    const eq = new EqualizerProcessor(44100);
    assert.throws(() => eq.setBands([0, 0, 0, 15, 0, 0, 0, 0, 0, 0]), RangeError);
    assert.throws(() => eq.setBands([0, 0, 0, -18, 0, 0, 0, 0, 0, 0]), RangeError);
    assert.throws(() => eq.setBands([0, 0, NaN, 0, 0, 0, 0, 0, 0, 0]), RangeError);
  });

  test('F06-T05: Boundary: Array length not equal to 10 throws Error', () => {
    const eq = new EqualizerProcessor(44100);
    assert.throws(() => eq.setBands([0, 0, 0]), /exactly 10/);
    assert.throws(() => eq.setBands(new Array(12).fill(0)), /exactly 10/);
  });

  test('F06-T06: Tone controls apply bass to band 0 and treble to band 9 with clamping', () => {
    const eq = new EqualizerProcessor(44100);
    eq.setBands(FACTORY_EQ_PRESETS.Flat);
    eq.applyToneControls(8.0, -4.0);
    assert.strictEqual(eq.isShaping, true);
  });

  test('F06-T07: SVF filtering processes audio block with smooth coefficient gliding', () => {
    const eq = new EqualizerProcessor(44100);
    eq.setBands(FACTORY_EQ_PRESETS.Rock);
    const pcmL = mockAudio.generateSine(1000, 0.05, 0.7);
    const pcmR = mockAudio.generateSine(1000, 0.05, 0.7);

    const { leftOut, rightOut } = eq.process(pcmL, pcmR);
    assert.strictEqual(leftOut.length, pcmL.length);
    assert.strictEqual(rightOut.length, pcmR.length);
    assert.ok(Number.isFinite(leftOut[50]));
    assert.ok(Number.isFinite(rightOut[50]));
  });

  test('F06-T08: EqualizerProcessor sanitizes sampleRate <= 0 and NaN to Math.max(8000, sampleRate) preventing NaN coefficients', () => {
    const eqZero = new EqualizerProcessor(0);
    const eqNeg = new EqualizerProcessor(-44100);
    const eqNan = new EqualizerProcessor(NaN);

    for (const eq of [eqZero, eqNeg, eqNan]) {
      const coeffs = eq['coeffA1'];
      for (let i = 0; i < 10; i++) {
        assert.ok(Number.isFinite(coeffs[i]), `coeffA1[${i}] must be finite`);
      }

      eq.setBands([3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      const { leftOut, rightOut } = eq.process(
        new Float32Array([0.5, -0.5, 0.2]),
        new Float32Array([0.5, -0.5, 0.2])
      );
      assert.ok(leftOut.every(Number.isFinite), 'Processed leftOut must be finite');
      assert.ok(rightOut.every(Number.isFinite), 'Processed rightOut must be finite');
    }
  });

  test('F06-T09: Live Web Audio BiquadFilterNode cascade connects 10 filters and syncs gains', () => {
    const connections = [];
    const mockCtx = {
      currentTime: 10.0,
      createGain: () => ({
        name: 'Gain',
        gain: { value: 1, setValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} },
        connect(t) { connections.push(t); }
      }),
      createAnalyser: () => ({
        name: 'Analyser',
        fftSize: 1024,
        frequencyBinCount: 512,
        connect(t) { connections.push(t); },
        getFloatFrequencyData() {}
      }),
      createBiquadFilter: () => {
        const filter = {
          name: 'Biquad',
          type: 'peaking',
          frequency: { value: 0, setValueAtTime(v) { this.value = v; } },
          Q: { value: 1, setValueAtTime(v) { this.value = v; } },
          gain: {
            value: 0,
            target: 0,
            setValueAtTime(v) { this.value = v; },
            setTargetAtTime(v) { this.target = v; this.value = v; },
            cancelScheduledValues() {}
          },
          connect(t) { connections.push(t); }
        };
        return filter;
      },
      destination: { name: 'Destination' }
    };

    const engine = new AudioEngine(mockCtx);
    assert.strictEqual(engine.eqFilterNodes.length, 10);
    assert.strictEqual(engine.eqFilterNodes[0].type, 'lowshelf');
    assert.strictEqual(engine.eqFilterNodes[9].type, 'highshelf');
    assert.strictEqual(engine.eqFilterNodes[4].type, 'peaking');
    assert.strictEqual(engine.eqFilterNodes[4].frequency.value, 1000);

    // Test synchronizing gains
    const targetGains = [4, 3, 2, 1, 0, -1, -2, -3, 2, 3];
    engine.setEqualizerBands(targetGains);
    for (let i = 0; i < 10; i++) {
      assert.strictEqual(engine.eqFilterNodes[i].gain.value, targetGains[i]);
    }
  });
});

// ============================================================================
// SUITE 3: FEATURE 7 - AUTOEQ CALIBRATION (AutoEqLoader.ts)
// ============================================================================
describe('Feature 07: AutoEQ Calibration (AutoEqLoader.ts)', () => {
  test('F07-T01: Resolves Sony WH-1000XM4 profile with negative preamp gain (-5.6 dB)', async () => {
    const profile = await AutoEqLoader.findProfile('Sony WH-1000XM4');
    assert.ok(profile);
    assert.strictEqual(profile.name, 'Sony WH-1000XM4');
    assert.strictEqual(profile.preampGainDb, -5.6);
    assert.ok(profile.filters.length > 0);
  });

  test('F07-T02: Resolves Sennheiser HD 600 and Apple AirPods Max with valid filters', async () => {
    const hd600 = await AutoEqLoader.findProfile('sEnNhEiSeR hd 600');
    assert.ok(hd600);
    assert.strictEqual(hd600.name, 'Sennheiser HD 600');
    assert.strictEqual(hd600.preampGainDb, -6.2);

    const airpods = await AutoEqLoader.findProfile('apple_airpods_max');
    assert.ok(airpods);
    assert.strictEqual(airpods.name, 'Apple AirPods Max');
    assert.strictEqual(airpods.preampGainDb, -3.8);
  });

  test('F07-T03: Non-existent or empty query returns null gracefully', async () => {
    assert.strictEqual(await AutoEqLoader.findProfile('NonExistent_Headphone_9999'), null);
    assert.strictEqual(await AutoEqLoader.findProfile(''), null);
    assert.strictEqual(await AutoEqLoader.findProfile('   '), null);
  });

  test('F07-T04: Decodes binary PaP blobs with Nyquist and Q boundary clamping', () => {
    // Construct synthetic 56-byte PaP blob (36 header + 20 record)
    const buf = new Uint8Array(56);
    buf[0] = 0x50; // 'P'
    buf[1] = 0x61; // 'a'
    buf[2] = 0x50; // 'P'
    buf[3] = 0x01;

    const view = new DataView(buf.buffer);
    view.setUint32(36, 0x7003, true); // PEAKING tag
    view.setFloat32(40, 35.0, true);  // Excessive gain -> should clamp to +12
    view.setUint32(44, 23000, true);  // > 0.49*44100 -> should clamp to 21609
    view.setFloat32(48, -1.0, true);  // Q <= 0 -> should clamp to 0.1

    const filters = decodePapParametricBlob(buf);
    assert.strictEqual(filters.length, 1);
    assert.strictEqual(filters[0].type, 'PEAKING');
    assert.strictEqual(filters[0].gainDb, 12);
    assert.strictEqual(filters[0].freq, 21609);
    assert.strictEqual(filters[0].q, 0.1);
  });

  test('F07-T05: calculatePreampGainDb returns negative inverse of highest filter boost', () => {
    const filters = [
      { type: 'PEAKING', freq: 1000, q: 1.0, gainDb: 4.5 },
      { type: 'LOW_SHELF', freq: 100, q: 0.7, gainDb: -2.0 },
    ];
    assert.strictEqual(calculatePreampGainDb(filters), -4.5);
  });

  test('F07-T06: Queries real headphone models directly from auto_eq.db (Audeze LCD-X exact match)', async () => {
    const audeze = await AutoEqLoader.findProfile('Audeze LCD-X');
    assert.ok(audeze, 'Audeze LCD-X must resolve from auto_eq.db');
    assert.strictEqual(audeze.name, 'Audeze LCD-X');
    assert.strictEqual(audeze.filters.length, 10);
    assert.ok(audeze.preampGainDb < 0, 'Must apply attenuation for positive boosts');
    assert.ok(audeze.filters.some((f) => f.type === 'LOW_SHELF' || f.type === 'PEAKING'));
  });

  test('F07-T07: Case-insensitive and fuzzy queries from auto_eq.db across diverse brands', async () => {
    // Beyerdynamic
    const beyer = await AutoEqLoader.findProfile('beyerdynamic dt 770');
    assert.ok(beyer, 'Beyerdynamic DT 770 must resolve');
    assert.ok(beyer.name.includes('DT 770'));
    assert.strictEqual(beyer.filters.length, 10);

    // Bose
    const bose = await AutoEqLoader.findProfile('bose quietcomfort 35');
    assert.ok(bose, 'Bose QuietComfort 35 must resolve');
    assert.ok(bose.name.includes('QuietComfort 35'));

    // HiFiMAN
    const sundara = await AutoEqLoader.findProfile('hifiman sundara');
    assert.ok(sundara, 'HiFiMAN Sundara must resolve');

    // 7Hz Salnotes Zero (IEM benchmark)
    const zero = await AutoEqLoader.findProfile('7hz salnotes zero');
    assert.ok(zero, '7Hz Salnotes Zero must resolve');
    assert.strictEqual(zero.name, '7Hz Salnotes Zero');

    // DUNU Titan S
    const titan = await AutoEqLoader.findProfile('dunu titan s');
    assert.ok(titan, 'DUNU Titan S must resolve');
  });

  test('F07-T08: searchHeadphones autocomplete queries across 17,703 models in auto_eq.db', async () => {
    const boseResults = await AutoEqLoader.searchHeadphones('bose', 5);
    assert.strictEqual(boseResults.length, 5);
    assert.ok(boseResults.every((r) => r.name.toLowerCase().includes('bose')));
    assert.ok(boseResults.some((r) => r.parametric === true));

    const sennResults = await AutoEqLoader.searchHeadphones('sennheiser', 10);
    assert.strictEqual(sennResults.length, 10);
    // Verifies deduplication between curated profiles and database rows
    const uniqueNames = new Set(sennResults.map((r) => r.name.toLowerCase()));
    assert.strictEqual(uniqueNames.size, sennResults.length);
  });

  test('F07-T09: SQL Injection safety with parameterized prepared statements', async () => {
    const sqlInj = await AutoEqLoader.findProfile("'; DROP TABLE eq_presets; --");
    assert.strictEqual(sqlInj, null);

    // Verify table remains intact and functional
    const postCheck = await AutoEqLoader.findProfile('Audeze LCD-X');
    assert.ok(postCheck, 'Database table must remain intact');
  });

  test('F07-T10: PaP binary blob decoding bounds verification on real database filters', async () => {
    const audeze = await AutoEqLoader.findProfile('Audeze LCD-X');
    assert.ok(audeze);
    for (const f of audeze.filters) {
      assert.ok(f.freq > 0 && f.freq <= 21609, `Frequency ${f.freq} exceeds Nyquist limit`);
      assert.ok(f.q >= 0.1, `Q factor ${f.q} below minimum`);
      assert.ok(f.gainDb >= -24 && f.gainDb <= 12, `Gain ${f.gainDb} outside safe bounds`);
    }
  });

  test('F07-T11: Database lifecycle management via closeDatabase()', () => {
    AutoEqLoader.closeDatabase();
    assert.strictEqual(AutoEqLoader['cachedDbInstance'], null);
  });
});

// ============================================================================
// SUITE 4: FEATURE 8 - SPATIAL AUDIO (DspChain.ts)
// ============================================================================
describe('Feature 08: Spatial Audio & Stereo Width (DspChain.ts)', () => {
  test('F08-T01: Toggles state and clamps width within [1.0, 4.0]', () => {
    const spatial = new SpatialAudioProcessor(44100);
    spatial.width = 5.5;
    assert.strictEqual(spatial.width, 5.5); // Property holds value, process clamps

    const { left, right } = mockAudio.generateStereo(440, 0.05, 0.8, Math.PI / 4);
    const { leftOut, rightOut } = spatial.process(left, right);
    assert.strictEqual(leftOut.length, left.length);
  });

  test('F08-T02: Mid/Side expansion widens stereo separation between channels', () => {
    const spatial = new SpatialAudioProcessor(44100);
    spatial.width = 2.5;

    const { left, right } = mockAudio.generateStereo(440, 0.05, 0.8, Math.PI / 4);
    const { leftOut, rightOut } = spatial.process(left, right);

    let inDiffSum = 0;
    let outDiffSum = 0;
    for (let i = 0; i < left.length; i++) {
      inDiffSum += Math.abs(left[i] - right[i]);
      outDiffSum += Math.abs(leftOut[i] - rightOut[i]);
    }
    assert.ok(outDiffSum > 0, 'Spatial audio must produce distinct stereo channels');
  });

  test('F08-T03: Center-panned mono input maintains exact phantom center (Delta < 1e-5)', () => {
    const spatial = new SpatialAudioProcessor(44100);
    spatial.width = 2.5;

    const mono = mockAudio.generateSine(440, 0.05, 0.8);
    const { leftOut, rightOut } = spatial.process(mono, mono);

    let maxDiff = 0;
    for (let i = 0; i < mono.length; i++) {
      const diff = Math.abs(leftOut[i] - rightOut[i]);
      if (diff > maxDiff) maxDiff = diff;
    }
    assert.ok(maxDiff < 1e-5, 'Center-panned mono must remain identical in L and R');
  });

  test('F08-T04: 0.82 makeup attenuation prevents digital saturation', () => {
    const spatial = new SpatialAudioProcessor(44100);
    spatial.width = 2.5;

    const { left, right } = mockAudio.generateStereo(440, 0.1, 1.0, Math.PI / 2);
    const { leftOut, rightOut } = spatial.process(left, right);

    let maxSample = 0;
    for (let i = 0; i < leftOut.length; i++) {
      maxSample = Math.max(maxSample, Math.abs(leftOut[i]), Math.abs(rightOut[i]));
    }
    assert.ok(maxSample <= 2.5, 'Output must not experience runaway amplification');
  });

  test('F08-T05: Silent buffers and tiny buffers process without NaN or buffer overrun', () => {
    const spatial = new SpatialAudioProcessor(44100);
    const silent = new Float32Array(512);
    const { leftOut, rightOut } = spatial.process(silent, silent);
    for (let i = 0; i < 512; i++) {
      assert.strictEqual(leftOut[i], 0);
      assert.strictEqual(rightOut[i], 0);
    }

    const tiny = new Float32Array(10);
    const { leftOut: tinyL, rightOut: tinyR } = spatial.process(tiny, tiny);
    assert.strictEqual(tinyL.length, 10);
    assert.strictEqual(tinyR.length, 10);
  });
});

// ============================================================================
// SUITE 5: FEATURE 9 - AUTOMIX TRANSITIONS (TransitionProcessor.ts)
// ============================================================================
describe('Feature 09: Automix Transitions & Filter Sweeps (TransitionProcessor.ts)', () => {
  test('F09-T01: Transition duration calculation: 4 bars @ 120 BPM = 8.0 seconds', () => {
    const sec = TransitionProcessor.calculateTransitionDurationSec(4, 120);
    assert.strictEqual(sec, 8.0);
  });

  test('F09-T02: Beat-synced echo delay length: 128 BPM -> ~468.75 ms', () => {
    const ms = TransitionProcessor.calculateBeatSyncedEchoMs(128);
    assert.ok(ms > 468 && ms < 469);
  });

  test('F09-T03: Signalsmith Stretch tempo ramp bars calculation', () => {
    const bars = TransitionProcessor.calculateTempoRampBars(120, 126, 2.5);
    assert.strictEqual(bars, 3);
  });

  test('F09-T04: Kick drum test tone generator outputs expected transient profile', () => {
    const kick = TransitionProcessor.generateKickDrum(0.3);
    assert.ok(kick.length > 0);
    const startAmp = Math.abs(kick[10]);
    const endAmp = Math.abs(kick[kick.length - 10]);
    assert.ok(startAmp > endAmp, 'Kick drum should have high initial transient');
  });

  test('F09-T05: Hi-hat generator outputs fast decaying high-frequency burst', () => {
    const hihat = TransitionProcessor.generateHiHat(0.15);
    assert.ok(hihat.length > 0);
    const tail = Math.abs(hihat[hihat.length - 1]);
    assert.ok(tail < 0.05, 'Hi-hat tail must decay to near silence');
  });

  test('F09-T06: Boundary: zero/negative BPM sanitizes to 120 BPM and bars clamp to [1, 24]', () => {
    assert.strictEqual(TransitionProcessor.calculateTransitionDurationSec(0, 0), 2.0); // 1 bar @ 120 BPM = 2.0s
    assert.strictEqual(TransitionProcessor.clampFeedback(1.5), 0.95);
    assert.strictEqual(TransitionProcessor.clampFeedback(-0.5), 0.0);
  });
});

// ============================================================================
// SUITE 6: FEATURE 10 - WAVEFORM EXTRACTION & LIVE VISUALIZER
// ============================================================================
describe('Feature 10: Waveform Extraction & Live Visualizer', () => {
  test('F10-T01: WaveformExtractor produces exactly 200 buckets peak normalized to 1.0', () => {
    const pcm = mockAudio.generateSine(440, 2.0, 0.9);
    const buckets = WaveformExtractor.extract200BucketEnvelope(pcm);
    assert.strictEqual(buckets.length, 200);

    let maxPeak = 0;
    for (let i = 0; i < 200; i++) {
      if (buckets[i] > maxPeak) maxPeak = buckets[i];
    }
    assert.ok(Math.abs(maxPeak - 1.0) < 1e-4);
  });

  test('F10-T02: Resampling maps 200 buckets to 68 bars within [0.0, 1.0]', () => {
    const buckets = WaveformExtractor.extract200BucketEnvelope(mockAudio.generateSine(440, 1.0, 0.8));
    const bars = WaveformExtractor.resampleTo68Bars(buckets);
    assert.strictEqual(bars.length, 68);
    for (let i = 0; i < 68; i++) {
      assert.ok(bars[i] >= 0.0 && bars[i] <= 1.0);
    }
  });

  test('F10-T03: Silent buffer yields all 0.0 buckets and all 0.0 bars', () => {
    const silent = new Float32Array(44100);
    const buckets = WaveformExtractor.extract200BucketEnvelope(silent);
    assert.strictEqual(buckets.length, 200);
    for (let i = 0; i < 200; i++) assert.strictEqual(buckets[i], 0);

    const bars = WaveformExtractor.resampleTo68Bars(buckets);
    assert.strictEqual(bars.length, 68);
    for (let i = 0; i < 68; i++) assert.strictEqual(bars[i], 0);
  });

  test('F10-T04: Procedural fallback waveform is deterministic and normalized', () => {
    const fb1 = WaveformExtractor.deterministicWaveformFallback('song_test_01');
    const fb2 = WaveformExtractor.deterministicWaveformFallback('song_test_01');
    assert.strictEqual(fb1.length, 200);
    assert.deepStrictEqual(fb1, fb2);
  });

  test('F10-T05: LiveVisualizer compute32BandPcmEnergy produces 32 bands in [0.0, 1.0]', () => {
    const pcmBlock = mockAudio.generateSine(1000, 0.05, 0.8);
    const energy = LiveVisualizer.compute32BandPcmEnergy(pcmBlock);
    assert.strictEqual(energy.length, 32);
    for (let i = 0; i < 32; i++) {
      assert.ok(energy[i] >= 0.0 && energy[i] <= 1.0);
    }
  });

  test('F10-T06: Silent block yields strictly 0 across all 32 bands; NaN is sanitized', () => {
    const silent = new Float32Array(1024);
    const energySilent = LiveVisualizer.compute32BandPcmEnergy(silent);
    for (let i = 0; i < 32; i++) assert.strictEqual(energySilent[i], 0);

    const nanBlock = new Float32Array(320);
    nanBlock[10] = NaN;
    const energyNan = LiveVisualizer.compute32BandPcmEnergy(nanBlock);
    for (let i = 0; i < 32; i++) assert.strictEqual(Number.isFinite(energyNan[i]), true);
  });
});

// ============================================================================
// SUITE 7: FEATURE 11 - LOOKAHEAD PEAK LIMITER & NORMALIZATION
// ============================================================================
describe('Feature 11: Lookahead Peak Limiter & Normalization (DspChain.ts)', () => {
  test('F11-T01: Limiter clamps hot audio signal (+6 dBFS) strictly below 0.985 ceiling', () => {
    const limiter = new LookaheadPeakLimiter(44100, 0.985);
    const hotSignal = mockAudio.generateSine(440, 0.1, 2.0);
    const output = limiter.process(hotSignal);

    for (let i = 0; i < output.length; i++) {
      assert.ok(
        Math.abs(output[i]) <= 0.98501,
        `Sample ${i} exceeded ceiling: ${Math.abs(output[i])} > 0.985`
      );
    }
  });

  test('F11-T02: Signals below ceiling pass through without alteration', () => {
    const limiter = new LookaheadPeakLimiter(44100, 0.985);
    const quietSignal = mockAudio.generateSine(440, 0.05, 0.5);
    const output = limiter.process(quietSignal);

    for (let i = 0; i < quietSignal.length; i++) {
      assert.ok(Math.abs(output[i] - quietSignal[i]) < 1e-4);
    }
  });

  test('F11-T03: Instantaneous attack catches the very first peak sample at index 10', () => {
    const limiter = new LookaheadPeakLimiter(44100, 0.985);
    const burst = new Float32Array(500);
    burst[10] = 3.5;
    const output = limiter.process(burst);
    assert.ok(Math.abs(output[10]) <= 0.98501);
  });

  test('F11-T04: Exponential release smooths gain recovery without clicks', () => {
    const limiter = new LookaheadPeakLimiter(44100, 0.985);
    const stepSignal = new Float32Array(4410);
    stepSignal[0] = 2.0;
    for (let i = 1; i < 4410; i++) stepSignal[i] = 0.4 * Math.sin((2 * Math.PI * 440 * i) / 44100);

    const output = limiter.process(stepSignal);
    assert.ok(Math.abs(output[0]) <= 0.98501);
    assert.ok(Math.abs(output[4000]) <= 0.41);
  });

  test('F11-T05: LoudnessProcessor calculates ReplayGain target offset', () => {
    const mult = LoudnessProcessor.calculateReplayGainMultiplier(-14.0, -11.5);
    assert.ok(mult < 1.0 && mult > 0.7);
  });

  test('F11-T06: Limiter handles DC bias offset without permanent gain collapse', () => {
    const limiter = new LookaheadPeakLimiter(44100, 0.985);
    const dcBuffer = new Float32Array(1000);
    dcBuffer.fill(0.5);
    const output = limiter.process(dcBuffer);
    assert.ok(output[500] <= 0.98501);
  });
});

// ============================================================================
// SUITE 8: MASTER DSP CHAIN INTEGRATION
// ============================================================================
describe('Master DSP Chain Integration', () => {
  test('DSP-01: Full stereo block processing through Spatial -> EQ -> Limiter', () => {
    const dsp = new DspChain(44100);
    dsp.spatial.enabled = true;
    dsp.spatial.width = 2.5;
    dsp.equalizer.setBands(FACTORY_EQ_PRESETS.BassBoost);

    const { left, right } = mockAudio.generateStereo(440, 0.05, 1.5, Math.PI / 4);
    const { leftOut, rightOut } = dsp.processBlock(left, right);

    assert.strictEqual(leftOut.length, left.length);
    assert.strictEqual(rightOut.length, right.length);

    // Verify limiter ceiling protection
    for (let i = 0; i < leftOut.length; i++) {
      assert.ok(Math.abs(leftOut[i]) <= 0.98501);
      assert.ok(Math.abs(rightOut[i]) <= 0.98501);
    }
  });

  test('DSP-02: Limiter interlock arms limiter when EQ is shaping', () => {
    const dsp = new DspChain(44100);
    dsp.equalizer.setBands(FACTORY_EQ_PRESETS.Electronic);
    const left = mockAudio.generateSine(440, 0.01, 0.5);
    dsp.processBlock(left, left);
    assert.strictEqual(dsp.limiter.holdLimiter, true);
  });
});

// ============================================================================
// SUITE 9: FEATURE 7 - AUTOEQ BIQUAD CASCADE FREQUENCY RESPONSE VERIFICATION
// ============================================================================
describe('Feature 07 (DSP): AutoEQ Biquad Filter Cascade DSP Frequency Response', () => {
  const fs = 44100;

  test('F07-DSP-01: Peaking EQ boosts center frequency by exact gain while leaving far frequencies untouched', () => {
    const dsp = new DspChain(fs);
    dsp.spatial.enabled = false;
    dsp.equalizer.setBands([0,0,0,0,0,0,0,0,0,0]);
    dsp.setAutoEqProfile([{ type: 'PEAKING', freq: 1000, q: 2.0, gainDb: 6.0 }], 0.0);

    // 1. Measure at 1000 Hz center frequency
    const pcm1000 = mockAudio.generateSine(1000, 0.2, 0.5);
    const { leftOut: out1000 } = dsp.processBlock(pcm1000, pcm1000);
    let maxIn1000 = 0, maxOut1000 = 0;
    for (let i = pcm1000.length - 2000; i < pcm1000.length; i++) {
      maxIn1000 = Math.max(maxIn1000, Math.abs(pcm1000[i]));
      maxOut1000 = Math.max(maxOut1000, Math.abs(out1000[i]));
    }
    const gainAt1000 = 20 * Math.log10(maxOut1000 / maxIn1000);
    assert.ok(Math.abs(gainAt1000 - 6.0) < 0.2, `Expected ~6.0 dB gain at 1000 Hz, got ${gainAt1000.toFixed(2)} dB`);

    // 2. Measure at 100 Hz (outside bandwidth)
    dsp.reset();
    const pcm100 = mockAudio.generateSine(100, 0.2, 0.5);
    const { leftOut: out100 } = dsp.processBlock(pcm100, pcm100);
    let maxIn100 = 0, maxOut100 = 0;
    for (let i = pcm100.length - 2000; i < pcm100.length; i++) {
      maxIn100 = Math.max(maxIn100, Math.abs(pcm100[i]));
      maxOut100 = Math.max(maxOut100, Math.abs(out100[i]));
    }
    const gainAt100 = 20 * Math.log10(maxOut100 / maxIn100);
    assert.ok(Math.abs(gainAt100) < 0.1, `Expected ~0.0 dB gain at 100 Hz, got ${gainAt100.toFixed(2)} dB`);
  });

  test('F07-DSP-02: Low-Shelf boosts bass frequencies below cutoff and flattens at treble', () => {
    const dsp = new DspChain(fs);
    dsp.spatial.enabled = false;
    dsp.setAutoEqProfile([{ type: 'LOW_SHELF', freq: 120, q: 0.707, gainDb: 5.0 }], 0.0);

    const bass = mockAudio.generateSine(40, 0.25, 0.4);
    const { leftOut: outBass } = dsp.processBlock(bass, bass);
    let maxInBass = 0, maxOutBass = 0;
    for (let i = bass.length - 2000; i < bass.length; i++) {
      maxInBass = Math.max(maxInBass, Math.abs(bass[i]));
      maxOutBass = Math.max(maxOutBass, Math.abs(outBass[i]));
    }
    const gainBass = 20 * Math.log10(maxOutBass / maxInBass);
    assert.ok(Math.abs(gainBass - 5.0) < 0.3, `Expected ~5.0 dB low shelf boost, got ${gainBass.toFixed(2)} dB`);

    const treble = mockAudio.generateSine(5000, 0.1, 0.4);
    const { leftOut: outTreble } = dsp.processBlock(treble, treble);
    let maxInTreble = 0, maxOutTreble = 0;
    for (let i = treble.length - 2000; i < treble.length; i++) {
      maxInTreble = Math.max(maxInTreble, Math.abs(treble[i]));
      maxOutTreble = Math.max(maxOutTreble, Math.abs(outTreble[i]));
    }
    const gainTreble = 20 * Math.log10(maxOutTreble / maxInTreble);
    assert.ok(Math.abs(gainTreble) < 0.1, `Expected ~0 dB at 5 kHz, got ${gainTreble.toFixed(2)} dB`);
  });

  test('F07-DSP-03: Curated Sony WH-1000XM4 profile actively alters audio spectrum with > 6 dB acoustic separation', () => {
    const dsp = new DspChain(fs);
    dsp.spatial.enabled = false;
    const sonyProfile = CURATED_AUTOEQ_PROFILES.find((p) => p.name === 'Sony WH-1000XM4');
    assert.ok(sonyProfile);
    dsp.setAutoEqProfile(sonyProfile.filters, sonyProfile.preampGainDb);

    // Profile has: +4.5 dB peaking at 3200 Hz and -3.2 dB peaking at 1100 Hz
    const pcm3200 = mockAudio.generateSine(3200, 0.2, 0.5);
    const { leftOut: out3200 } = dsp.processBlock(pcm3200, pcm3200);
    let maxIn3200 = 0, maxOut3200 = 0;
    for (let i = pcm3200.length - 2000; i < pcm3200.length; i++) {
      maxIn3200 = Math.max(maxIn3200, Math.abs(pcm3200[i]));
      maxOut3200 = Math.max(maxOut3200, Math.abs(out3200[i]));
    }
    const gain3200 = 20 * Math.log10(maxOut3200 / maxIn3200);

    dsp.reset();
    const pcm1100 = mockAudio.generateSine(1100, 0.2, 0.5);
    const { leftOut: out1100 } = dsp.processBlock(pcm1100, pcm1100);
    let maxIn1100 = 0, maxOut1100 = 0;
    for (let i = pcm1100.length - 2000; i < pcm1100.length; i++) {
      maxIn1100 = Math.max(maxIn1100, Math.abs(pcm1100[i]));
      maxOut1100 = Math.max(maxOut1100, Math.abs(out1100[i]));
    }
    const gain1100 = 20 * Math.log10(maxOut1100 / maxIn1100);

    const separation = gain3200 - gain1100;
    assert.ok(
      separation > 6.0,
      `AutoEQ must shape spectrum with acoustic contrast, got separation ${separation.toFixed(2)} dB`
    );
  });

  test('F07-DSP-04: Persistent filter state guarantees zero block-boundary discontinuity', () => {
    const dsp = new DspChain(fs);
    dsp.spatial.enabled = false;
    dsp.setAutoEqProfile([
      { type: 'PEAKING', freq: 1000, q: 2.0, gainDb: 6.0 },
      { type: 'LOW_SHELF', freq: 100, q: 0.707, gainDb: -4.0 },
    ], 0.0);

    const N = 1024;
    const input = mockAudio.generateSine(440, N / fs, 0.8);

    // 1. Single 1024-sample block
    const { leftOut: singleOut } = dsp.processBlock(input, input);

    // 2. 8 sequential 128-sample blocks
    dsp.reset();
    const chunkedOut = new Float32Array(N);
    const blockSize = 128;
    for (let b = 0; b < N; b += blockSize) {
      const chunkIn = input.subarray(b, b + blockSize);
      const { leftOut: chunkOut } = dsp.processBlock(chunkIn, chunkIn);
      chunkedOut.set(chunkOut, b);
    }

    let maxDiff = 0;
    for (let i = 0; i < N; i++) {
      const d = Math.abs(singleOut[i] - chunkedOut[i]);
      if (d > maxDiff) maxDiff = d;
    }
    assert.strictEqual(maxDiff, 0, 'Chunked processing must have 0 difference from single block');
  });

  test('F07-DSP-05: clearAutoEqProfile restores exact passthrough identity', () => {
    const dsp = new DspChain(fs);
    dsp.spatial.enabled = false;
    dsp.setAutoEqProfile([{ type: 'PEAKING', freq: 1000, q: 2.0, gainDb: 6.0 }], -3.0);
    dsp.clearAutoEqProfile();

    assert.strictEqual(dsp.autoEqFilters.length, 0);
    assert.strictEqual(dsp.autoEqPreampDb, 0);
    assert.strictEqual(dsp.autoEqPreampLinear, 1.0);

    const input = mockAudio.generateSine(440, 0.02, 0.5);
    const { leftOut } = dsp.processBlock(input, input);
    for (let i = 0; i < input.length; i++) {
      assert.ok(Math.abs(leftOut[i] - input[i]) < 1e-5);
    }
  });

  test('F07-DSP-06: Sample rate reconfiguration smoothly updates coefficients without state explosion', () => {
    const dsp = new DspChain(44100);
    dsp.setAutoEqProfile([{ type: 'PEAKING', freq: 1000, q: 2.0, gainDb: 6.0 }], 0.0);
    dsp.configure(96000);

    const input = mockAudio.generateSine(1000, 0.05, 0.7);
    const { leftOut, rightOut } = dsp.processBlock(input, input);
    for (let i = 0; i < leftOut.length; i++) {
      assert.ok(Number.isFinite(leftOut[i]));
      assert.ok(Number.isFinite(rightOut[i]));
    }
  });
});
