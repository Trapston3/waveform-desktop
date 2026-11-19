// tests/unit/m2_challenger_autoeq_sync_stress.test.mjs
// Adversarial Empirical Challenge & Concurrency Stress Test Suite for Milestone 2 Iteration 2
// Focus: SQLite AutoEQ queries, uncurated models, SQL injection resilience, active deck sync, visualizer memory stability.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createRequire } from 'node:module';

// Register ESM resolution hook for clean extension handling of .ts files
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

const { AudioEngine } = await import('../../src/audio/AudioEngine.ts');
const { AutoEqLoader, CURATED_AUTOEQ_PROFILES } = await import('../../src/audio/AutoEqLoader.ts');
const { LiveVisualizer } = await import('../../src/audio/LiveVisualizer.ts');
const { mockSongs } = await import('../fixtures/mockSongs.mjs');

// ============================================================================
// SUITE 1: UNCURATED HEADPHONE MODEL LOOKUPS FROM auto_eq.db
// ============================================================================
describe('Empirical Challenge 1: Uncurated Headphone Models from auto_eq.db', () => {
  const uncuratedModels = [
    {
      name: 'Audeze LCD-X',
      expectedSourceKeyword: 'Crinacle',
      expectedPreampGainMin: -10,
      expectedPreampGainMax: 0,
    },
    {
      name: 'Beyerdynamic DT 770 Pro (250 Ohm)',
      expectedSourceKeyword: 'Crinacle',
      expectedPreampGainMin: -10,
      expectedPreampGainMax: 0,
    },
    {
      name: 'Bose QuietComfort 35',
      expectedSourceKeyword: 'Rtings',
      expectedPreampGainMin: -10,
      expectedPreampGainMax: 0,
    },
    {
      name: '7Hz Salnotes Zero',
      expectedSourceKeyword: 'Oratory1990',
      expectedPreampGainMin: -10,
      expectedPreampGainMax: 0,
    },
    {
      name: 'DUNU Titan S',
      expectedSourceKeyword: 'Crinacle',
      expectedPreampGainMin: -15,
      expectedPreampGainMax: 0,
    },
    {
      name: 'HiFiMAN Sundara',
      expectedSourceKeyword: 'Crinacle',
      expectedPreampGainMin: -10,
      expectedPreampGainMax: 0,
    },
  ];

  for (const model of uncuratedModels) {
    test(`UNCUR-01: Query uncurated model '${model.name}' returns genuine 10-band profile from SQLite`, async () => {
      const profile = await AutoEqLoader.findProfile(model.name);
      assert.ok(profile !== null, `Profile for '${model.name}' must not be null`);
      assert.ok(profile.id.length > 0, 'Profile ID must be non-empty');
      assert.ok(profile.name.length > 0, 'Profile name must be non-empty');
      assert.ok(
        profile.source?.includes(model.expectedSourceKeyword),
        `Source '${profile.source}' should contain '${model.expectedSourceKeyword}'`
      );
      assert.ok(
        profile.preampGainDb >= model.expectedPreampGainMin && profile.preampGainDb <= model.expectedPreampGainMax,
        `Preamp gain ${profile.preampGainDb} dB must be in [${model.expectedPreampGainMin}, ${model.expectedPreampGainMax}]`
      );
      assert.strictEqual(profile.filters.length, 10, 'Must have exactly 10 parametric biquad filters');

      // Verify each filter's physical parameters conform to audio boundaries
      for (let i = 0; i < profile.filters.length; i++) {
        const f = profile.filters[i];
        assert.ok(['PEAKING', 'LOW_SHELF', 'HIGH_SHELF', 'LOW_PASS', 'HIGH_PASS', 'BAND_PASS'].includes(f.type));
        assert.ok(f.freq >= 10 && f.freq <= 21609, `Filter ${i} freq ${f.freq} out of bounds`);
        assert.ok(f.q >= 0.1 && f.q <= 100, `Filter ${i} Q ${f.q} out of bounds`);
        assert.ok(f.gainDb >= -24 && f.gainDb <= 12, `Filter ${i} gain ${f.gainDb} dB out of bounds`);
      }
    });
  }

  test('UNCUR-02: Load uncurated profile into AudioEngine activates DSP biquad cascade', async () => {
    const engine = new AudioEngine();
    const success = await engine.loadAutoEqProfile('Audeze LCD-X');
    assert.strictEqual(success, true, 'AudioEngine.loadAutoEqProfile must return true for Audeze LCD-X');
    assert.ok(engine.autoEqProfile !== null, 'Engine autoEqProfile must be populated');
    assert.strictEqual(engine.autoEqProfile.name, 'Audeze LCD-X');
    assert.strictEqual(engine.autoEqProfile.filters.length, 10);
    assert.ok(engine.dspChain.autoEq.isShaping, 'DSP chain AutoEQ shaping flag must be active');
  });

  test('UNCUR-03: Additional uncurated models resolve correctly from auto_eq.db', async () => {
    const additionalModels = ['Moondrop Chu', 'Sennheiser HD 800 S', 'Focal Clear', 'Audio-Technica ATH-M50x'];
    for (const name of additionalModels) {
      const p = await AutoEqLoader.findProfile(name);
      assert.ok(p !== null, `Additional model '${name}' should resolve from auto_eq.db`);
      assert.strictEqual(p.filters.length, 10);
      assert.ok(p.preampGainDb <= 0);
    }
  });
});

// ============================================================================
// SUITE 2: SQLITE QUERY CONCURRENCY & PARALLEL THROUGHPUT STRESS
// ============================================================================
describe('Empirical Challenge 2: SQLite Concurrency & Throughput Stress', () => {
  test('CONC-01: 500 concurrent findProfile queries across diverse models complete without errors', async () => {
    const queryPool = [
      'Audeze LCD-X',
      'Beyerdynamic DT 770 Pro (250 Ohm)',
      'Bose QuietComfort 35',
      '7Hz Salnotes Zero',
      'DUNU Titan S',
      'HiFiMAN Sundara',
      'Sony WH-1000XM4',
      'Sennheiser HD 600',
      'Apple AirPods Max',
      'NonExistentHeadphoneXYZ_123',
      'audeze',
      'sennheiser',
      'titan',
      'zero',
    ];

    const tasks = Array.from({ length: 500 }, (_, i) => {
      const query = queryPool[i % queryPool.length];
      return AutoEqLoader.findProfile(query);
    });

    const t0 = performance.now();
    const results = await Promise.all(tasks);
    const durationMs = performance.now() - t0;

    assert.strictEqual(results.length, 500);
    let resolvedCount = 0;
    let nullCount = 0;
    for (const r of results) {
      if (r !== null) resolvedCount++;
      else nullCount++;
    }

    assert.ok(resolvedCount > 0, 'Must have successfully resolved real models under concurrency');
    assert.ok(nullCount > 0, 'Must have safely returned null for non-existent models');
    assert.ok(durationMs < 1000, `500 concurrent queries took ${durationMs.toFixed(1)}ms (expected < 1000ms)`);
  });

  test('CONC-02: 250 concurrent searchHeadphones queries complete with valid result sets', async () => {
    const searchTerms = ['audeze', 'beyer', 'zero', 'sony', 'apple', 'sennheiser', 'dunu', 'hifiman', 'pro', 'max'];

    const tasks = Array.from({ length: 250 }, (_, i) => {
      const term = searchTerms[i % searchTerms.length];
      const limit = 5 + (i % 20);
      return AutoEqLoader.searchHeadphones(term, limit);
    });

    const t0 = performance.now();
    const results = await Promise.all(tasks);
    const durationMs = performance.now() - t0;

    assert.strictEqual(results.length, 250);
    for (let i = 0; i < results.length; i++) {
      const list = results[i];
      assert.ok(Array.isArray(list), 'Search result must be an array');
      assert.ok(list.length > 0, 'Must find matching headphone names');
      for (const item of list) {
        assert.ok(item.name.length > 0);
        assert.strictEqual(typeof item.parametric, 'boolean');
      }
    }
    assert.ok(durationMs < 1000, `250 concurrent searches took ${durationMs.toFixed(1)}ms`);
  });

  test('CONC-03: Interleaved high-concurrency findProfile, searchHeadphones, and loadAutoEqProfile', async () => {
    const engine = new AudioEngine();
    const mixedTasks = [];

    for (let i = 0; i < 150; i++) {
      mixedTasks.push(AutoEqLoader.findProfile('HiFiMAN Sundara'));
      mixedTasks.push(AutoEqLoader.searchHeadphones('sundara', 10));
      mixedTasks.push(engine.loadAutoEqProfile('DUNU Titan S'));
    }

    const t0 = performance.now();
    const results = await Promise.all(mixedTasks);
    const durationMs = performance.now() - t0;

    assert.strictEqual(results.length, 450);
    assert.ok(durationMs < 1500, `Interleaved workload took ${durationMs.toFixed(1)}ms`);
    assert.strictEqual(engine.autoEqProfile?.name, 'DUNU Titan S');
  });
});

// ============================================================================
// SUITE 3: ADVERSARIAL SQL INJECTION, MALFORMED INPUTS & UNICODE STRESS
// ============================================================================
describe('Empirical Challenge 3: SQL Injection, Malformed Inputs & Unicode Stress', () => {
  test('SEC-01: Classical SQL injection attacks return null safely without syntax error or leak', async () => {
    const injections = [
      "' OR '1'='1",
      "' OR 1=1 --",
      "'; DROP TABLE eq_presets; --",
      "' UNION SELECT 1, 'Injected', 'Hack', X'50615001' --",
      "admin' --",
      "1' ORDER BY 1--",
      '" OR ""="',
      "' OR ''='",
      "'; SELECT * FROM sqlite_master; --",
      "1; SELECT * FROM eq_presets WHERE 1=1; --",
      "' OR 'x'='x",
      "')) OR ((('1'='1",
    ];

    for (const payload of injections) {
      const profile = await AutoEqLoader.findProfile(payload);
      assert.strictEqual(profile, null, `Injection payload "${payload}" must return null`);

      const search = await AutoEqLoader.searchHeadphones(payload, 10);
      assert.ok(Array.isArray(search));
      assert.strictEqual(search.length, 0, `Search for "${payload}" must return empty results`);
    }
  });

  test('SEC-02: Null-byte injection is safely rejected', async () => {
    const nullByteQueries = [
      'Audeze\0LCD-X',
      '\0',
      'Sony\0',
      '\0WH-1000XM4',
      'Bose\0QuietComfort 35',
    ];

    for (const q of nullByteQueries) {
      const p = await AutoEqLoader.findProfile(q);
      assert.strictEqual(p, null, `Null byte query "${q}" must return null`);

      const s = await AutoEqLoader.searchHeadphones(q);
      assert.strictEqual(s.length, 0, `Null byte search "${q}" must return empty array`);
    }
  });

  test('SEC-03: Oversized string payloads (>10,000 to 65,536 chars) do not crash or hang', async () => {
    const oversized = [
      'A'.repeat(10_000),
      'Sony '.repeat(2_500),
      "' OR '1'='1".repeat(1_000),
      'X'.repeat(65_536),
    ];

    for (const big of oversized) {
      const t0 = performance.now();
      const p = await AutoEqLoader.findProfile(big);
      const elapsed = performance.now() - t0;

      assert.strictEqual(p, null, 'Oversized string must return null');
      assert.ok(elapsed < 20, `Lookup took ${elapsed.toFixed(1)}ms, must reject rapidly without ReDoS`);

      const s = await AutoEqLoader.searchHeadphones(big);
      assert.strictEqual(s.length, 0);
    }
  });

  test('SEC-04: Non-Latin Unicode, RTL, emojis, and special control characters handle gracefully', async () => {
    // 1. Multilingual partial query with Latin model token: resolves target headphone
    const chineseHd600 = await AutoEqLoader.findProfile('森海塞尔 HD600');
    assert.ok(chineseHd600 !== null, 'Multilingual query containing HD600 should resolve profile');
    assert.ok(chineseHd600.name.includes('HD600'), 'Resolved profile must be HD600');

    // 2. RTL-wrapped Latin brand resolves to valid profile despite invisible BiDi control codes
    const rtoSony = await AutoEqLoader.findProfile('\u202ESONY\u202C');
    assert.ok(rtoSony !== null, 'RTL-wrapped SONY token should normalize and resolve profile');
    assert.ok(rtoSony.name.toLowerCase().includes('sony'));

    // 3. Pure non-Latin Unicode / emoji / control queries without valid headphone names safely return null
    const nonMatchingUnicode = [
      'سماعات رأس', // Arabic generic
      '森海塞尔 虚构耳机', // Chinese non-existent (pure non-Latin)
      'オーディオテクニカ', // Japanese non-matching
      'Наушники', // Russian generic
      '🎧🔊🎵🎶', // Emojis
      '\u202E\u202C', // Pure Right-to-Left Override without alphanumeric
      '\u200B\u200C\uFEFF', // Zero-width spaces & BOM
      '\r\n\t\x1b[31mRed\x1b[0m', // ANSI escapes
      '🔥'.repeat(100),
    ];

    for (const u of nonMatchingUnicode) {
      const p = await AutoEqLoader.findProfile(u);
      assert.strictEqual(p, null, `Non-matching Unicode query "${u.slice(0, 20)}" must return null`);

      const s = await AutoEqLoader.searchHeadphones(u);
      assert.ok(Array.isArray(s));
    }
  });

  test('SEC-05: Wildcard saturation (%, _) handles safely via parameterized prepared statements', async () => {
    const wildcards = [
      '%',
      '%%',
      '%%%%%%%%%%%%%',
      '_',
      '________________',
      '%_%_%_%_%',
    ];

    for (const w of wildcards) {
      const t0 = performance.now();
      const p = await AutoEqLoader.findProfile(w);
      const elapsed = performance.now() - t0;

      // Because % and _ are parameterized SQL LIKE wildcards in Priority 2,
      // verify that queries execute cleanly in < 50ms without syntax error or crash,
      // and return either null or a valid clamped AutoEQ profile.
      assert.ok(elapsed < 50, `Wildcard query took ${elapsed.toFixed(1)}ms`);
      if (p !== null) {
        assert.ok(p.name.length > 0);
        assert.strictEqual(p.filters.length, 10);
        assert.ok(Number.isFinite(p.preampGainDb));
      }
    }
  });

  test('SEC-06: Database table integrity check: eq_presets remains intact with 17,703 rows', () => {
    const require = createRequire(import.meta.url);
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync('src/assets/data/auto_eq.db', { readOnly: true });

    const stats = db.prepare('SELECT count(*) as total, sum(parametric) as parametric_count FROM eq_presets').get();
    assert.strictEqual(stats.total, 17703, 'Total records in eq_presets must remain exactly 17,703');
    assert.strictEqual(stats.parametric_count, 8850, 'Parametric records in eq_presets must remain exactly 8,850');
    db.close();
  });
});

// ============================================================================
// SUITE 4: ACTIVE DECK SYNCHRONIZATION ACROSS CONSECUTIVE CROSSFADES
// ============================================================================
describe('Empirical Challenge 4: Active Deck Sync Across Consecutive Crossfades', () => {
  test('SYNC-01: 50 consecutive crossfades alternate activeDeckName without desync or orphan decks', async () => {
    const engine = new AudioEngine();
    await engine.loadTrack(mockSongs.standardYouTube, 'active'); // Loaded in Deck A
    await engine.loadTrack(mockSongs.localFlac, 'standby'); // Loaded in Deck B
    engine.play();

    assert.strictEqual(engine.activeDeckName, 'active');
    assert.strictEqual(engine.deckA.isPlaying, true);
    assert.strictEqual(engine.deckB.isPlaying, false);

    for (let cycle = 1; cycle <= 50; cycle++) {
      const targetRole = cycle % 2 === 1 ? 'standby' : 'active';
      const expectedPlayingDeck = cycle % 2 === 1 ? engine.deckB : engine.deckA;
      const expectedSilentDeck = cycle % 2 === 1 ? engine.deckA : engine.deckB;

      // Execute crossfade with 10ms simulated ramp
      await engine.crossfade(targetRole, 10);

      // Verify active deck name
      assert.strictEqual(
        engine.activeDeckName,
        targetRole,
        `Cycle ${cycle}: activeDeckName must be '${targetRole}'`
      );

      // Verify physical deck state
      assert.strictEqual(
        expectedPlayingDeck.isPlaying,
        true,
        `Cycle ${cycle}: target deck must be PLAYING`
      );
      assert.strictEqual(
        expectedSilentDeck.isPlaying,
        false,
        `Cycle ${cycle}: previous deck must be PAUSED`
      );
      assert.strictEqual(
        expectedPlayingDeck.gain,
        1.0,
        `Cycle ${cycle}: target deck gain must be 1.0`
      );
      assert.strictEqual(
        expectedSilentDeck.gain,
        0.0,
        `Cycle ${cycle}: previous deck gain must be 0.0`
      );

      // Test PAUSE control at this cycle: pauses the playing deck
      engine.pause();
      assert.strictEqual(engine.playbackState, 'PAUSED');
      assert.strictEqual(expectedPlayingDeck.isPlaying, false, `Cycle ${cycle}: active deck must be paused`);
      assert.strictEqual(expectedSilentDeck.isPlaying, false, `Cycle ${cycle}: standby deck must remain paused`);

      // Test RESUME control: resumes only the active deck
      engine.play();
      assert.strictEqual(engine.playbackState, 'PLAYING');
      assert.strictEqual(expectedPlayingDeck.isPlaying, true, `Cycle ${cycle}: active deck must resume`);
      assert.strictEqual(expectedSilentDeck.isPlaying, false, `Cycle ${cycle}: standby deck must not resume`);

      // Pre-load track into the standby deck for the NEXT crossfade
      const nextStandbySong = cycle % 2 === 1 ? mockSongs.standardYouTube : mockSongs.localFlac;
      await engine.loadTrack(nextStandbySong, 'standby');
    }
  });

  test('SYNC-02: Rapid crossfading interleaved with seek and volume adjustments preserves active deck integrity', async () => {
    const engine = new AudioEngine();
    await engine.loadTrack(mockSongs.standardYouTube, 'active');
    await engine.loadTrack(mockSongs.localFlac, 'standby');
    engine.play();

    for (let i = 0; i < 10; i++) {
      const targetRole = i % 2 === 0 ? 'standby' : 'active';
      const xfadePromise = engine.crossfade(targetRole, 20);

      // Interleave operations during transition
      engine.seek(i * 1000);
      engine.setVolume(0.8 - (i % 3) * 0.1);

      await xfadePromise;

      assert.strictEqual(engine.activeDeckName, targetRole);
      assert.strictEqual(engine.playbackState, 'PLAYING');

      // Preload next standby
      await engine.loadTrack(mockSongs.standardYouTube, 'standby');
    }

    // Final pause silences active deck completely
    engine.pause();
    assert.strictEqual(engine.playbackState, 'PAUSED');
    assert.strictEqual(engine.deckA.isPlaying, false);
    assert.strictEqual(engine.deckB.isPlaying, false);
  });
});

// ============================================================================
// SUITE 5: ZERO-ALLOCATION LIVE VISUALIZER MEMORY STABILITY UNDER LOAD
// ============================================================================
describe('Empirical Challenge 5: Visualizer Zero-Allocation Memory Stability', () => {
  test('MEM-01: 5,000 high-frequency PCM blocks through AudioEngine maintain bounded heap', () => {
    const engine = new AudioEngine();
    const pcmBlock = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      pcmBlock[i] = Math.sin((i / 1024) * 2 * Math.PI);
    }

    let dispatchCount = 0;
    const unsub1 = engine.subscribeLivePcmEnergy((energy) => {
      assert.strictEqual(energy.length, 32);
      dispatchCount++;
    });
    const unsub2 = engine.subscribeLivePcmEnergy((energy) => {
      assert.ok(energy[0] >= 0.0);
    });

    if (global.gc) global.gc();
    const initialHeap = process.memoryUsage().heapUsed;

    for (let i = 0; i < 5000; i++) {
      engine.triggerLivePcmBlock(pcmBlock);
    }

    if (global.gc) global.gc();
    const finalHeap = process.memoryUsage().heapUsed;
    const heapGrowthMb = (finalHeap - initialHeap) / (1024 * 1024);

    assert.strictEqual(dispatchCount, 5000);
    assert.ok(
      heapGrowthMb < 5.0,
      `Heap growth after 5,000 blocks was ${heapGrowthMb.toFixed(2)} MB, should be < 5.0 MB`
    );

    unsub1();
    unsub2();
  });

  test('MEM-02: 10,000 calls to LiveVisualizer.compute32BandPcmEnergy strictly reuse outBuffer with zero allocations', () => {
    const pcmBlock = new Float32Array(512);
    pcmBlock.fill(0.75);

    const reusableBuffer = new Float32Array(32);

    for (let i = 0; i < 10000; i++) {
      const result = LiveVisualizer.compute32BandPcmEnergy(pcmBlock, reusableBuffer);
      assert.strictEqual(
        result,
        reusableBuffer,
        'compute32BandPcmEnergy must strictly return the provided outBuffer instance'
      );
    }

    for (let b = 0; b < 32; b++) {
      assert.ok(Math.abs(reusableBuffer[b] - 0.75) < 1e-4);
    }
  });

  test('MEM-03: Degenerate, NaN, and over-amplified PCM blocks through triggerLivePcmBlock', () => {
    const engine = new AudioEngine();
    let receivedSafeBands = true;

    engine.subscribeLivePcmEnergy((energy) => {
      for (let b = 0; b < 32; b++) {
        if (!Number.isFinite(energy[b]) || energy[b] < 0.0 || energy[b] > 1.0) {
          receivedSafeBands = false;
        }
      }
    });

    // 1. All NaN
    const nanBlock = new Float32Array(256).fill(NaN);
    engine.triggerLivePcmBlock(nanBlock);

    // 2. All Infinity
    const infBlock = new Float32Array(256).fill(Infinity);
    engine.triggerLivePcmBlock(infBlock);

    // 3. Hot signal (+40 dBFS, 100.0)
    const hotBlock = new Float32Array(256).fill(100.0);
    engine.triggerLivePcmBlock(hotBlock);

    // 4. Empty block
    engine.triggerLivePcmBlock(new Float32Array(0));

    assert.strictEqual(receivedSafeBands, true, 'All dispatched energy bands must be finite and clamped in [0.0, 1.0]');
  });
});
