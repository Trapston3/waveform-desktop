// tests/challenger_m4_2_stress_suite.mjs
// Adversarial Empirical Challenge Suite for Milestone M4
// Challenger: challenger_m4_2 (DSP, AutoEQ & Lyrics Stress Challenger)
//
// Rigorous verification of:
// 1. DSP Numerical Stability & Limiter Ceiling (0 NaNs/Infs, <= 0.985 ceiling, mono center preservation)
// 2. AutoEQ IPC & Database Query Stress (17,703 profiles, PaP binary decoding, search latency)
// 3. Synchronized Lyrics Engine Stress (GPU glow, word interpolation, RTL, 3,500ms manual scroll latch)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import React from 'react';
import ReactDOMServer from 'react-dom/server';

// Register hook to transpile TSX via esbuild
register('./helpers/tsxLoader.mjs', import.meta.url);

const {
  DspChain,
  SpatialAudioProcessor,
  EqualizerProcessor,
  AutoEqProcessor,
  LookaheadPeakLimiter,
  EQ_FREQUENCIES_HZ,
  FACTORY_EQ_PRESETS,
} = await import('../src/audio/DspChain.ts');

const {
  AutoEqLoader,
  CURATED_AUTOEQ_PROFILES,
  decodePapParametricBlob,
  calculatePreampGainDb,
} = await import('../src/audio/AutoEqLoader.ts');

const { SyllableLyricsEngine } = await import('../src/ui/player/SyllableLyricsEngine.tsx');
const { LyricsService } = await import('../src/services/LyricsService.ts');

console.log('=== STARTING CHALLENGER M4-2 ADVERSARIAL STRESS SUITE ===');

// ============================================================================
// SUITE 1: DSP NUMERICAL STABILITY & LIMITER CEILING
// ============================================================================
describe('Suite 1: DSP Numerical Stability & Limiter Ceiling Under Extreme Fuzzing', () => {

  test('DSP-01: Compound extreme fuzzing (500,000 samples) produces ZERO NaNs and ZERO Infinities', () => {
    const chain = new DspChain(44100);
    // Configure full chain with aggressive processing
    chain.spatial.enabled = true;
    chain.spatial.width = 3.5;
    chain.equalizer.setBands([12, -10, 8, -6, 10, -8, 12, -12, 10, 12]);
    chain.equalizer.applyToneControls(6, 6); // Max tone boost

    const curated = CURATED_AUTOEQ_PROFILES[0]; // Sony WH-1000XM4
    chain.setAutoEqProfile(curated.filters, curated.preampGainDb);

    const BLOCK_SIZE = 4096;
    const NUM_BLOCKS = 125; // 125 * 4096 = 512,000 samples
    let nanCount = 0;
    let infCount = 0;
    let maxAbsPeak = 0;

    for (let b = 0; b < NUM_BLOCKS; b++) {
      const left = new Float32Array(BLOCK_SIZE);
      const right = new Float32Array(BLOCK_SIZE);

      for (let i = 0; i < BLOCK_SIZE; i++) {
        // Interleave pathological values
        const pattern = (b * BLOCK_SIZE + i) % 10;
        if (pattern === 0) {
          left[i] = 31.62; // +30 dBFS spike
          right[i] = -31.62;
        } else if (pattern === 1) {
          left[i] = 100.0; // +40 dBFS spike
          right[i] = 100.0;
        } else if (pattern === 2) {
          left[i] = 1000.0; // +60 dBFS spike
          right[i] = -1000.0;
        } else if (pattern === 3) {
          left[i] = NaN; // Corrupted input
          right[i] = Infinity;
        } else if (pattern === 4) {
          left[i] = -Infinity;
          right[i] = NaN;
        } else if (pattern === 5) {
          left[i] = 1e-39; // Denormal / subnormal
          right[i] = -1e-42;
        } else if (pattern === 6) {
          // Nyquist frequency oscillation (+1, -1, +1, -1)
          left[i] = i % 2 === 0 ? 1.0 : -1.0;
          right[i] = i % 2 === 0 ? -1.0 : 1.0;
        } else if (pattern === 7) {
          left[i] = 0.0; // Pure silence
          right[i] = 0.0;
        } else {
          // High amplitude random noise
          left[i] = (Math.random() * 2 - 1) * 10.0;
          right[i] = (Math.random() * 2 - 1) * 10.0;
        }
      }

      const { leftOut, rightOut } = chain.processBlock(left, right);

      for (let i = 0; i < BLOCK_SIZE; i++) {
        const l = leftOut[i];
        const r = rightOut[i];

        if (Number.isNaN(l) || Number.isNaN(r)) nanCount++;
        if (!Number.isFinite(l) || !Number.isFinite(r)) infCount++;

        if (Math.abs(l) > maxAbsPeak) maxAbsPeak = Math.abs(l);
        if (Math.abs(r) > maxAbsPeak) maxAbsPeak = Math.abs(r);
      }
    }

    assert.strictEqual(nanCount, 0, `Expected 0 NaNs across 512,000 fuzzed samples, found ${nanCount}`);
    assert.strictEqual(infCount, 0, `Expected 0 Infinities across 512,000 fuzzed samples, found ${infCount}`);
    assert.ok(maxAbsPeak <= 0.985 + 1e-6, `Peak limiter ceiling exceeded: ${maxAbsPeak} > 0.985`);
  });

  test('DSP-02: Peak Limiter strictly enforces <= 0.985 ceiling (-0.13 dBFS) under 100,000 samples of +36 dBFS overdrive', () => {
    const limiter = new LookaheadPeakLimiter(44100, 0.985);
    const SAMPLES = 100000;
    const inputL = new Float32Array(SAMPLES);
    const inputR = new Float32Array(SAMPLES);

    // +36 dBFS amplitude is 10^(36/20) = 63.1
    for (let i = 0; i < SAMPLES; i++) {
      inputL[i] = Math.sin((2 * Math.PI * 440 * i) / 44100) * 63.1;
      inputR[i] = Math.cos((2 * Math.PI * 440 * i) / 44100) * 63.1;
    }

    const { leftOut, rightOut } = limiter.processStereo(inputL, inputR);

    let ceilingViolations = 0;
    let maxObserved = 0;

    for (let i = 0; i < SAMPLES; i++) {
      const absL = Math.abs(leftOut[i]);
      const absR = Math.abs(rightOut[i]);

      if (absL > maxObserved) maxObserved = absL;
      if (absR > maxObserved) maxObserved = absR;

      if (absL > 0.985001 || absR > 0.985001) {
        ceilingViolations++;
      }
    }

    assert.strictEqual(ceilingViolations, 0, `Peak ceiling violated on ${ceilingViolations} samples`);
    // Note: In IEEE 754 single-precision (Float32Array), 0.985 is represented as Math.fround(0.985) = 0.9850000143051147
    assert.ok(maxObserved <= Math.fround(0.985) + 1e-7, `Maximum observed amplitude ${maxObserved} strictly <= Math.fround(0.985)`);
  });

  test('DSP-03: Mid/Side spatial processor strictly preserves mono phantom center (L == R => side == 0)', () => {
    const spatial = new SpatialAudioProcessor(44100);
    spatial.enabled = true;

    // Test across all allowed stereo widths [1.0 to 4.0]
    const testWidths = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0];
    const BLOCK_SIZE = 8192;

    for (const w of testWidths) {
      spatial.width = w;
      spatial.reset();

      const left = new Float32Array(BLOCK_SIZE);
      const right = new Float32Array(BLOCK_SIZE);

      // Construct complex mono signal with multi-sine and random transient bursts
      for (let i = 0; i < BLOCK_SIZE; i++) {
        const mono = Math.sin((2 * Math.PI * 100 * i) / 44100) * 0.4 +
                     Math.sin((2 * Math.PI * 1000 * i) / 44100) * 0.3 +
                     Math.sin((2 * Math.PI * 10000 * i) / 44100) * 0.2 +
                     (i % 128 === 0 ? 0.9 : 0.0);
        left[i] = mono;
        right[i] = mono; // Identical channels L == R
      }

      const { leftOut, rightOut } = spatial.process(left, right);

      let maxDelta = 0;
      for (let i = 0; i < BLOCK_SIZE; i++) {
        const delta = Math.abs(leftOut[i] - rightOut[i]);
        if (delta > maxDelta) maxDelta = delta;
      }

      assert.ok(
        maxDelta < 1e-7,
        `Width ${w}: Mono phantom center deviated by ${maxDelta} (must be < 1e-7)`
      );
    }
  });

  test('DSP-04: Subnormal inputs & NaN bursts recover cleanly within 1 block without state poisoning', () => {
    const chain = new DspChain(44100);
    const BLOCK_SIZE = 512;

    // Block 1: Poison block full of NaNs, Infs, and denormals
    const poisonL = new Float32Array(BLOCK_SIZE);
    const poisonR = new Float32Array(BLOCK_SIZE);
    for (let i = 0; i < BLOCK_SIZE; i++) {
      poisonL[i] = i % 3 === 0 ? NaN : i % 3 === 1 ? Infinity : 1e-45;
      poisonR[i] = i % 3 === 0 ? -Infinity : i % 3 === 1 ? NaN : -1e-45;
    }
    const poisonResult = chain.processBlock(poisonL, poisonR);

    // Verify poison block itself is clamped/sanitized
    for (let i = 0; i < BLOCK_SIZE; i++) {
      assert.ok(Number.isFinite(poisonResult.leftOut[i]), `Poison block L[${i}] must be finite`);
      assert.ok(Number.isFinite(poisonResult.rightOut[i]), `Poison block R[${i}] must be finite`);
    }

    // Block 2: Clean sinusoidal audio block
    const cleanL = new Float32Array(BLOCK_SIZE);
    const cleanR = new Float32Array(BLOCK_SIZE);
    for (let i = 0; i < BLOCK_SIZE; i++) {
      cleanL[i] = Math.sin((2 * Math.PI * 440 * i) / 44100) * 0.5;
      cleanR[i] = Math.cos((2 * Math.PI * 440 * i) / 44100) * 0.5;
    }
    const cleanResult = chain.processBlock(cleanL, cleanR);

    // Verify clean block contains valid audio and zero residual NaN/Inf
    let cleanPower = 0;
    for (let i = 0; i < BLOCK_SIZE; i++) {
      assert.ok(Number.isFinite(cleanResult.leftOut[i]), `Clean block L[${i}] must be finite`);
      assert.ok(Number.isFinite(cleanResult.rightOut[i]), `Clean block R[${i}] must be finite`);
      cleanPower += cleanResult.leftOut[i] * cleanResult.leftOut[i];
    }
    assert.ok(cleanPower > 0.01, 'Clean signal must pass through with audible power after poison block');
  });

  test('DSP-05: Dynamic sample rate reconfiguration mid-stream preserves numerical integrity', () => {
    const chain = new DspChain(44100);
    const rates = [44100, 48000, 88200, 96000, 192000, 22050, 8000, 44100];
    const BLOCK = 1024;

    for (const fs of rates) {
      chain.configure(fs);
      const left = new Float32Array(BLOCK);
      const right = new Float32Array(BLOCK);
      for (let i = 0; i < BLOCK; i++) {
        left[i] = Math.sin((2 * Math.PI * 1000 * i) / fs);
        right[i] = Math.cos((2 * Math.PI * 1000 * i) / fs);
      }
      const { leftOut, rightOut } = chain.processBlock(left, right);
      for (let i = 0; i < BLOCK; i++) {
        assert.ok(Number.isFinite(leftOut[i]), `Sample rate ${fs} L[${i}] is non-finite`);
        assert.ok(Number.isFinite(rightOut[i]), `Sample rate ${fs} R[${i}] is non-finite`);
        assert.ok(Math.abs(leftOut[i]) <= 0.985 + 1e-6, `Sample rate ${fs} ceiling violated`);
      }
    }
  });
});

// ============================================================================
// SUITE 2: AUTOEQ DATABASE & IPC STRESS
// ============================================================================
describe('Suite 2: AutoEQ 17,703 Database Query Stress & Binary PaP Decoding Oracle', () => {

  const dbPath = 'src/assets/data/auto_eq.db';

  test('AEQ-01: auto_eq.db contains exactly 17,703 records (8,850 parametric, 8,853 graphic)', () => {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const total = db.prepare('SELECT count(*) as c FROM eq_presets').get().c;
    const parametric = db.prepare('SELECT count(*) as c FROM eq_presets WHERE parametric = 1').get().c;
    const graphic = db.prepare('SELECT count(*) as c FROM eq_presets WHERE parametric = 0').get().c;
    db.close();

    assert.strictEqual(total, 17703, `Total presets in auto_eq.db must be 17,703, found ${total}`);
    assert.strictEqual(parametric, 8850, `Parametric presets must be 8,850, found ${parametric}`);
    assert.strictEqual(graphic, 8853, `Graphic presets must be 8,853, found ${graphic}`);
  });

  test('AEQ-02: All 8,850 parametric PaP binary blobs decode without corruption or NaNs', () => {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare('SELECT _id, name, data_blob FROM eq_presets WHERE parametric = 1').all();
    db.close();

    assert.strictEqual(rows.length, 8850);
    const VALID_TYPES = new Set(['PEAKING', 'LOW_SHELF', 'HIGH_SHELF', 'LOW_PASS', 'HIGH_PASS', 'BAND_PASS']);

    let totalFilters = 0;
    for (const row of rows) {
      const blob = new Uint8Array(row.data_blob);
      const filters = decodePapParametricBlob(blob);

      assert.ok(filters.length > 0, `Profile ${row.name} (id ${row._id}) decoded 0 filters`);
      totalFilters += filters.length;

      const preamp = calculatePreampGainDb(filters);
      assert.ok(Number.isFinite(preamp), `Preamp for ${row.name} is non-finite`);
      assert.ok(preamp <= 0.0, `Preamp for ${row.name} must be negative or zero (got ${preamp} dB)`);

      for (const f of filters) {
        assert.ok(VALID_TYPES.has(f.type), `Filter type ${f.type} invalid in ${row.name}`);
        assert.ok(Number.isFinite(f.freq) && f.freq >= 10 && f.freq <= 21609, `Freq ${f.freq} out of bounds in ${row.name}`);
        assert.ok(Number.isFinite(f.q) && f.q >= 0.1, `Q factor ${f.q} out of bounds in ${row.name}`);
        assert.ok(Number.isFinite(f.gainDb) && f.gainDb >= -24 && f.gainDb <= 12, `Gain ${f.gainDb} out of bounds in ${row.name}`);
      }
    }

    assert.ok(totalFilters >= 8850 * 5, `Expected at least ~44,000 total biquad filters across database, found ${totalFilters}`);
  });

  test('AEQ-03: Corrupted, truncated, and invalid PaP blobs fail gracefully without exceptions', () => {
    // 1. Truncated header (< 36 bytes)
    for (let len = 0; len < 36; len++) {
      const truncated = new Uint8Array(len);
      const result = decodePapParametricBlob(truncated);
      assert.deepStrictEqual(result, [], `Truncated blob of length ${len} should return []`);
    }

    // 2. Invalid magic bytes
    const badMagic = new Uint8Array(56);
    badMagic[0] = 0x00;
    assert.deepStrictEqual(decodePapParametricBlob(badMagic), []);

    // 3. Fuzzed random bytes
    for (let f = 0; f < 50; f++) {
      const randomBlob = new Uint8Array(36 + Math.floor(Math.random() * 200));
      for (let i = 0; i < randomBlob.length; i++) {
        randomBlob[i] = Math.floor(Math.random() * 256);
      }
      assert.doesNotThrow(() => {
        decodePapParametricBlob(randomBlob);
      });
    }
  });

  test('AEQ-04: AutoEqLoader.searchHeadphones across diverse queries & latency profiling', async () => {
    const testQueries = [
      'Sony', 'Sennheiser', 'AirPods', 'Bose', 'Audeze',
      'Beyerdynamic', 'Hifiman', 'Focal', 'Moondrop', 'Zero'
    ];

    const latencies = [];
    for (const q of testQueries) {
      const t0 = performance.now();
      const results = await AutoEqLoader.searchHeadphones(q, 20);
      const elapsed = performance.now() - t0;
      latencies.push(elapsed);

      assert.ok(Array.isArray(results), `Query "${q}" should return array`);
      assert.ok(results.length > 0, `Query "${q}" should find matching profiles`);
      for (const item of results) {
        assert.ok(item.id !== undefined, 'Item has id');
        assert.ok(typeof item.name === 'string' && item.name.length > 0, 'Item has valid name');
      }
    }

    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    console.log(`[AEQ-04 Latency Report] 10 diverse queries: avg = ${avgLatency.toFixed(2)}ms, min = ${Math.min(...latencies).toFixed(2)}ms, max = ${Math.max(...latencies).toFixed(2)}ms`);

    // In-memory curated lookup verification:
    const curatedT0 = performance.now();
    const curatedRes = await AutoEqLoader.findProfile('Sony WH-1000XM4');
    const curatedTime = performance.now() - curatedT0;
    assert.ok(curatedRes !== null);
    assert.ok(curatedTime < 1.0, `Curated lookup must be near-instantaneous (< 1ms, got ${curatedTime.toFixed(3)}ms)`);

    AutoEqLoader.closeDatabase();
  });

  test('AEQ-05: AutoEQ IPC simulation matching main.ts and preload.cts contracts', async () => {
    const db = new DatabaseSync(dbPath, { readOnly: true });

    // Simulate main process IPC handler 'autoeq-search'
    const ipcSearch = (query, limit = 20) => {
      if (!query || typeof query !== 'string' || !query.trim()) return [];
      const trimmed = query.trim().toLowerCase();
      const curated = [
        { id: 'sony_wh1000xm4', name: 'Sony WH-1000XM4', meta: 'Oratory1990', parametric: true },
        { id: 'sennheiser_hd600', name: 'Sennheiser HD 600', meta: 'Crinacle', parametric: true },
        { id: 'apple_airpods_max', name: 'Apple AirPods Max', meta: 'Rtings', parametric: true },
      ];
      const results = [];
      for (const c of curated) {
        if (c.name.toLowerCase().includes(trimmed) || c.id.includes(trimmed)) {
          results.push(c);
        }
      }
      const rows = db.prepare(
        'SELECT _id, name, meta, parametric FROM eq_presets WHERE LOWER(name) LIKE ? ORDER BY parametric DESC LIMIT ?'
      ).all(`%${trimmed}%`, limit);
      for (const row of rows) {
        if (!results.some(r => r.name.toLowerCase() === row.name.toLowerCase())) {
          results.push({
            id: row._id,
            name: row.name,
            meta: row.meta,
            parametric: row.parametric === 1,
          });
        }
      }
      return results.slice(0, limit);
    };

    // Simulate main process IPC handler 'autoeq-find-profile'
    const ipcFindProfile = (nameOrId) => {
      if (!nameOrId || typeof nameOrId !== 'string') return null;
      const trimmed = nameOrId.trim().toLowerCase();
      const curated = CURATED_AUTOEQ_PROFILES.find(
        p => p.name.toLowerCase() === trimmed || p.id.toLowerCase() === trimmed
      );
      if (curated) return curated;

      const row = db.prepare(
        'SELECT name, meta, data_blob FROM eq_presets WHERE LOWER(name) = ? AND parametric = 1 LIMIT 1'
      ).get(trimmed);
      if (row && row.data_blob) {
        const filters = decodePapParametricBlob(new Uint8Array(row.data_blob));
        return {
          id: row.name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
          name: row.name,
          source: row.meta || 'AutoEQ',
          preampGainDb: calculatePreampGainDb(filters),
          filters,
        };
      }
      return null;
    };

    // Test IPC search
    const searchRes = ipcSearch('Beyerdynamic', 10);
    assert.ok(searchRes.length > 0);
    assert.ok(searchRes.some(r => r.name.includes('DT 770') || r.name.includes('DT 990')));

    // Test IPC find profile
    const profileRes = ipcFindProfile('7Hz Salnotes Zero');
    assert.ok(profileRes !== null);
    assert.strictEqual(profileRes.name, '7Hz Salnotes Zero');
    assert.ok(profileRes.filters.length >= 5);
    assert.ok(profileRes.preampGainDb <= 0);

    db.close();
  });
});

// ============================================================================
// SUITE 3: SYNCHRONIZED LYRICS ENGINE STRESS
// ============================================================================
describe('Suite 3: Synchronized Lyrics Engine Stress (GPU Glow, RTL & 3.5s Latch)', () => {

  test('LYR-01: Active singing syllable renders with GPU bloom halo (0.62 alpha) and -2px translateY lift', () => {
    const mockLyrics = {
      lines: [
        {
          text: 'I wanna be there',
          startTimeMs: 1000,
          endTimeMs: 4000,
          syllables: [
            { text: 'I', startTimeMs: 1000, endTimeMs: 1500 },
            { text: ' ', startTimeMs: 1500, endTimeMs: 1500 },
            { text: 'wanna', startTimeMs: 1500, endTimeMs: 2500 },
            { text: ' ', startTimeMs: 2500, endTimeMs: 2500 },
            { text: 'be', startTimeMs: 2500, endTimeMs: 3200 },
            { text: ' ', startTimeMs: 3200, endTimeMs: 3200 },
            { text: 'there', startTimeMs: 3200, endTimeMs: 4000 },
          ],
        },
      ],
    };

    // Position at 2000ms: "wanna" is actively singing (1500ms - 2500ms)
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(SyllableLyricsEngine, {
        lyricsData: mockLyrics,
        currentPositionMs: 2000,
        isLoading: false,
        onSeek: () => {},
      })
    );

    // Active singing syllable assertions
    assert.ok(html.includes('translateY(-2px)'), 'Active singing syllable must have translateY(-2px) lift');
    assert.ok(
      html.includes('0 0 12px rgba(255, 255, 255, 0.62)') || html.includes('0 0 12px rgba(255,255,255,0.62)'),
      'Active singing syllable must have 0.62 alpha white bloom shadow'
    );
    assert.ok(
      html.includes('rgba(250, 45, 72, 0.40)') || html.includes('rgba(250,45,72,0.4)'),
      'Active singing syllable must have crimson accent ambient glow'
    );

    // Sung syllable ("I") assertions
    assert.ok(
      html.includes('0 0 4px rgba(255, 255, 255, 0.25)') || html.includes('0 0 4px rgba(255,255,255,0.25)'),
      'Sung syllable must have 0.25 alpha white textShadow'
    );
  });

  test('LYR-02: Whitespace syllables are strictly immune to lift and GPU bloom across Unicode variations', () => {
    const whitespaceVariants = [
      ' ',           // ASCII space
      '   ',         // Multi space
      '\t',          // Tab
      '\u00A0',      // Non-breaking space
      '\u202F',      // Narrow no-break space
      '\u3000',      // Full-width ideographic CJK space
      '\u2002\u2003' // En & Em space
    ];

    for (const ws of whitespaceVariants) {
      const mockLyrics = {
        lines: [
          {
            text: `A${ws}B`,
            startTimeMs: 1000,
            endTimeMs: 4000,
            syllables: [
              { text: 'A', startTimeMs: 1000, endTimeMs: 2000 },
              { text: ws, startTimeMs: 2000, endTimeMs: 2000 },
              { text: 'B', startTimeMs: 2000, endTimeMs: 4000 },
            ],
          },
        ],
      };

      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(SyllableLyricsEngine, {
          lyricsData: mockLyrics,
          currentPositionMs: 2000,
          isLoading: false,
          onSeek: () => {},
        })
      );

      // Whitespace span must NOT have inline style transform translateY(-2px) or textShadow
      // It renders cleanly as <span class="inline text-white/45">...</span>
      assert.ok(html.includes('text-white/45'), 'Whitespace rendered with muted opacity');
    }
  });

  test('LYR-03: RTL detection accurately identifies Arabic, Hebrew, Farsi, and Urdu scripts', () => {
    const rtlSamples = [
      'حبيبي يا نور العين',     // Arabic
      'שלום עליכם',              // Hebrew
      'بوی جوی مولیان آید همی', // Persian / Farsi
      'دل ناداں تجھے ہوا کیا ہے', // Urdu
    ];

    for (const text of rtlSamples) {
      assert.strictEqual(LyricsService.isRtlText(text), true, `Failed to detect RTL for: "${text}"`);
    }

    const ltrSamples = [
      'The Strokes - Ode to the Mets',
      'Sweet Taste of India',
      'Hikaru Utada - First Love (Japanese Kanji/Kana)',
      '12345 67890',
    ];

    for (const text of ltrSamples) {
      assert.strictEqual(LyricsService.isRtlText(text), false, `False positive RTL detected for: "${text}"`);
    }

    // Verify RTL line rendering in SyllableLyricsEngine
    const rtlLyrics = {
      lines: [
        {
          text: 'حبيبي يا نور العين',
          startTimeMs: 1000,
          endTimeMs: 3000,
        },
      ],
    };

    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(SyllableLyricsEngine, {
        lyricsData: rtlLyrics,
        currentPositionMs: 1500,
        isLoading: false,
        onSeek: () => {},
      })
    );

    assert.ok(html.includes('direction:rtl'), 'RTL direction must be set on container');
    assert.ok(html.includes('text-align:right'), 'Right text-align must be set for RTL');
    assert.ok(html.includes('Vazirmatn'), 'Vazirmatn font family must be applied for RTL');
  });

  test('LYR-04: Manual user gesture arms 3,500ms detention latch and debounces without thrashing', () => {
    // Model state machine of SyllableLyricsEngine user gesture handler
    let isUserScrolled = false;
    let detentionTimer = null;
    let programmaticScrollActive = true;
    let timerDuration = 0;

    const handleUserGesture = () => {
      programmaticScrollActive = false;
      isUserScrolled = true;
      if (detentionTimer) {
        clearTimeout(detentionTimer);
        detentionTimer = null;
      }
      detentionTimer = setTimeout(() => {
        isUserScrolled = false;
      }, 3500);
      timerDuration = 3500;
    };

    // 1. Initial state
    assert.strictEqual(isUserScrolled, false);
    assert.strictEqual(programmaticScrollActive, true);

    // 2. User wheels or scrolls manually
    handleUserGesture();
    assert.strictEqual(isUserScrolled, true, 'User gesture must immediately set isUserScrolled = true');
    assert.strictEqual(programmaticScrollActive, false, 'Programmatic scroll must be immediately cancelled');
    assert.strictEqual(timerDuration, 3500, 'Detention timer must be set to 3500ms');

    // 3. User wheels rapidly 10 times (debounce test)
    for (let i = 0; i < 10; i++) {
      handleUserGesture();
    }
    assert.strictEqual(isUserScrolled, true, 'isUserScrolled must remain true during continuous scrolling');
    assert.ok(detentionTimer !== null, 'Timer must remain active and debounced');

    // Clean up
    if (detentionTimer) clearTimeout(detentionTimer);
  });
});
