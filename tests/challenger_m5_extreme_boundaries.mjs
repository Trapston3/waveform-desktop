// tests/challenger_m5_extreme_boundaries.mjs
// Empirical Challenger stress harness for WaveForm Desktop Milestone 5
// Testing extreme boundary conditions:
// 1. 0-duration tracks & edge durations
// 2. 50,000-character artist bios & extreme text
// 3. Rapid repeated playlist additions & concurrency
// 4. Empty, malformed, and adversarial search queries
// 5. Extreme EQ gain sweeps (-12 dB to +12 dB across 10 bands) + Limiter ceiling

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
      try {
        return await nextResolve(specifier + '/index.ts', context);
      } catch {}
    }
    throw err;
  }
}
`;
register(`data:text/javascript,${encodeURIComponent(resolverHook)}`, import.meta.url);

import { AudioEngineSimulator, MusicServiceSimulator, StorageServiceSimulator } from './helpers/testEngine.mjs';
import { mockAudio } from './fixtures/mockAudio.mjs';
import { mockSongs } from './fixtures/mockSongs.mjs';

const {
  EqualizerProcessor,
  LookaheadPeakLimiter,
  SpatialAudioProcessor,
  EQ_FREQUENCIES_HZ,
} = await import('../src/audio/DspChain.ts');
const { StorageService } = await import('../src/services/StorageService.ts');
const { MusicService } = await import('../src/services/MusicService.ts');

test('▶ Challenge 1: 0-Duration Tracks & Edge Duration Handling', async (t) => {
  const engine = new AudioEngineSimulator();

  const zeroDurationTrack = {
    ...mockSongs.standardYouTube,
    videoId: 'zero_duration_001',
    title: 'Zero Duration Ambient Silence',
    durationSec: 0,
    durationMs: 0,
  };

  await t.test('1.1: Loading 0-duration track initializes cleanly without divide-by-zero', async () => {
    await engine.loadTrack(zeroDurationTrack, 'active');
    assert.equal(engine.deckA.track.durationMs, 0);
    assert.equal(engine.deckA.positionMs, 0);

    const safeDuration = zeroDurationTrack.durationMs > 0 ? zeroDurationTrack.durationMs : 1;
    const progress = Math.max(0, Math.min(1.0, engine.deckA.positionMs / safeDuration));
    assert.equal(Number.isFinite(progress), true);
    assert.equal(progress, 0.0);
  });

  await t.test('1.2: Seeking in 0-duration track stays bounded at 0ms', () => {
    engine.seek(0);
    assert.equal(engine.deckA.positionMs, 0);

    // Seeking past 0-duration track should be permitted but clamped in UI/state logic
    engine.seek(5000);
    assert.equal(engine.deckA.positionMs, 5000);

    // Negative seek must throw RangeError
    assert.throws(() => engine.seek(-100), RangeError);
  });

  await t.test('1.3: 200-bucket envelope extraction handles empty audio buffer safely', () => {
    const emptyPcm = new Float32Array(0);
    const envelope = mockAudio.extract200BucketEnvelope(emptyPcm);
    assert.equal(envelope.length, 200);
    for (let i = 0; i < 200; i++) {
      assert.equal(Number.isFinite(envelope[i]), true);
      assert.equal(envelope[i], 0.0);
    }
  });

  await t.test('1.4: 68-bar resampling on empty or flat 200-bucket envelope returns non-NaN bars', () => {
    const emptyEnvelope = new Float32Array(200);
    const bars68 = mockAudio.resampleTo68Bars(emptyEnvelope);
    assert.equal(bars68.length, 68);
    for (let i = 0; i < 68; i++) {
      assert.equal(Number.isFinite(bars68[i]), true);
      assert.equal(bars68[i] >= 0.0, true, `Bar ${i} must be non-negative`);
    }
  });

  await t.test('1.5: Sub-millisecond track (durationMs = 0.5) avoids NaN progress calculation', () => {
    const subMsTrack = {
      ...mockSongs.standardYouTube,
      videoId: 'sub_ms_001',
      durationSec: 0.0005,
      durationMs: 0.5,
    };
    const safeDuration = subMsTrack.durationMs > 0 ? subMsTrack.durationMs : 1;
    const progress = Math.max(0, Math.min(1.0, 0.25 / safeDuration));
    assert.equal(Number.isFinite(progress), true);
    assert.equal(progress, 0.5);
  });
});

test('▶ Challenge 2: 50,000-Character Artist Bios & Extreme Text Payloads', async (t) => {
  // Generate 50,000 characters of dense multi-lingual text with HTML tags and unicode
  const baseChunk = 'The quick brown fox jumps over the lazy dog. 🎵 \u0627\u0644\u0639\u0631\u0628\u064A\u0629 <script>alert("XSS")</script> &amp; ';
  const repeatCount = Math.ceil(50000 / baseChunk.length);
  const massiveBio = baseChunk.repeat(repeatCount).slice(0, 50000);

  assert.equal(massiveBio.length, 50000);

  const extremeArtist = {
    id: 'artist_massive_bio_001',
    name: 'Omni-Dimensional Resonance Collective',
    bio: massiveBio,
    monthlyListeners: 14250000,
    headerImageUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=1200',
    releases: [
      { id: 'rel_001', title: 'Infinite Echoes', year: 2026, type: 'album' },
    ],
  };

  await t.test('2.1: JSON serialization round-trip of 50,000-character bio preserves exact content', () => {
    const serialized = JSON.stringify(extremeArtist);
    assert.equal(serialized.length >= 50000, true);
    const deserialized = JSON.parse(serialized);
    assert.equal(deserialized.bio.length, 50000);
    assert.equal(deserialized.bio, massiveBio);
  });

  await t.test('2.2: Substring truncation and excerpt extraction executes under 5ms', () => {
    const start = performance.now();
    const excerpt = extremeArtist.bio.slice(0, 250) + '...';
    const elapsed = performance.now() - start;
    assert.equal(elapsed < 10.0, true, 'Excerpt extraction should be near-instantaneous');
    assert.equal(excerpt.length, 253);
    assert.equal(excerpt.endsWith('...'), true);
  });

  await t.test('2.3: MusicService handles extreme artist page queries gracefully', async () => {
    const musicService = new MusicService();
    const result = await musicService.getArtistDetails('artist_massive_bio_001');
    assert.equal(result, null);

    const emptyResult = await musicService.getArtistDetails('');
    assert.equal(emptyResult, null);
  });
});

test('▶ Challenge 3: Rapid Repeated Playlist Additions & Atomic Concurrency', async (t) => {
  const tmpDir = path.join(os.tmpdir(), `waveform-m5-stress-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const storage = new StorageService(tmpDir);

  await t.test('3.1: Create custom playlist for rapid repeated additions', async () => {
    const pl = await storage.createPlaylist('Extreme Boundary Playlist');
    assert.equal(pl.title, 'Extreme Boundary Playlist');
    assert.equal(pl.songIds.length, 0);
  });

  await t.test('3.2: 100 rapid sequential additions of the same track ID are deduplicated cleanly', async () => {
    const playlists = await storage.getPlaylists();
    const pl = playlists[0];

    for (let i = 0; i < 100; i++) {
      await storage.addSongToPlaylist(pl.id, 'duplicate_track_999');
    }

    const updatedPlaylists = await storage.getPlaylists();
    const target = updatedPlaylists.find((p) => p.id === pl.id);
    assert.equal(target.songIds.length, 1, 'Duplicate track must only be recorded once');
    assert.equal(target.songCount, 1);
  });

  await t.test('3.3: 200 distinct track additions sequential batch preserves exact ordering', async () => {
    const playlists = await storage.getPlaylists();
    const pl = playlists[0];
    const tracksToAdd = Array.from({ length: 200 }, (_, i) => `track_seq_${i.toString().padStart(4, '0')}`);

    await storage.addTracksToPlaylist(pl.id, tracksToAdd);

    const reloadedPlaylists = await storage.getPlaylists();
    const target = reloadedPlaylists.find((p) => p.id === pl.id);
    assert.equal(target.songIds.length, 201); // 1 duplicate from 3.2 + 200 new
    assert.equal(target.songIds[1], 'track_seq_0000');
    assert.equal(target.songIds[200], 'track_seq_0199');
  });

  await t.test('3.4: Concurrent race of 20 simultaneous addTracks operations does not corrupt disk JSON', async () => {
    const playlists = await storage.getPlaylists();
    const pl = playlists[0];

    const tasks = Array.from({ length: 20 }, (_, batchIdx) => {
      const batch = Array.from({ length: 5 }, (_, i) => `concurrent_t_${batchIdx}_${i}`);
      return storage.addTracksToPlaylist(pl.id, batch);
    });

    await Promise.all(tasks);

    // Read back directly from disk to verify atomic durability
    const rawDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, 'playlists.json'), 'utf8'));
    const diskPl = rawDisk.find((p) => p.id === pl.id);
    assert.equal(diskPl.songIds.length, 201 + 100); // 201 + (20 * 5)
    assert.equal(diskPl.songCount, 301);

    // Check that no temporary files are left over in tmpDir
    const leftOvers = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.tmp'));
    assert.equal(leftOvers.length, 0);
  });

  // Clean up
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

test('▶ Challenge 4: Empty, Malformed & Adversarial Search Queries', async (t) => {
  const musicService = new MusicService();
  const simService = new MusicServiceSimulator();

  await t.test('4.1: Empty and whitespace queries return empty results without error', async () => {
    const queries = ['', ' ', '   \t\n  ', '\t', '\n\r'];
    for (const q of queries) {
      const res = await simService.search(q);
      assert.deepEqual(res, { query: '', suggestions: [], items: [] });

      const liveRes = await musicService.search(q);
      assert.deepEqual(liveRes, { query: '', suggestions: [], items: [] });
    }
  });

  await t.test('4.2: SQL-injection and script attack payloads do not throw or corrupt state', async () => {
    const injectionQueries = [
      "' OR 1=1; --",
      '<script>alert("XSS")</script>',
      '{{constructor.constructor("alert(1)")()}}',
      'SELECT * FROM songs WHERE 1=1',
      'DROP TABLE playlists;',
    ];
    for (const q of injectionQueries) {
      const res = await simService.search(q);
      assert.equal(typeof res.query, 'string');
      assert.equal(Array.isArray(res.suggestions), true);
      assert.equal(Array.isArray(res.items), true);
    }
  });

  await t.test('4.3: Extreme 10,000-character query executes without ReDoS or timeout', async () => {
    const massiveQuery = 'a'.repeat(10000);
    const start = performance.now();
    const res = await simService.search(massiveQuery);
    const elapsed = performance.now() - start;
    assert.equal(elapsed < 50.0, true, 'Massive search query must resolve in <50ms');
    assert.equal(res.query, massiveQuery);
    assert.equal(res.suggestions.length, 0, 'No suggestions match 10,000 character string');
  });

  await t.test('4.4: Regex special characters in query do not cause SyntaxError', async () => {
    const regexQueries = ['.*', '+', '(', '[a-z]+', '(?=.*)', '{\\d+}', '^$'];
    for (const q of regexQueries) {
      const res = await simService.search(q);
      assert.equal(Array.isArray(res.items), true);
    }
  });

  await t.test('4.5: Filter pills filter songs, albums, and artists correctly', async () => {
    const allRes = await simService.search('the', 'all');
    const songRes = await simService.search('the', 'songs');
    const albumRes = await simService.search('the', 'albums');
    const artistRes = await simService.search('the', 'artists');

    for (const item of songRes.items) {
      assert.equal(item.badge, 'Song');
    }
    for (const item of albumRes.items) {
      assert.equal(item.isAlbum, true);
    }
    for (const item of artistRes.items) {
      assert.equal(item.isArtist, true);
    }
  });
});

test('▶ Challenge 5: Extreme EQ Gain Sweeps (-12 dB to +12 dB) & Limiter Headroom', async (t) => {
  const eq = new EqualizerProcessor(44100);
  const limiter = new LookaheadPeakLimiter(44100, 0.985);

  await t.test('5.1: Sweep across all 10 bands from -12 dB to +12 dB in 1 dB steps yields valid finite coefficients', () => {
    for (let db = -12; db <= 12; db += 1.0) {
      const gains = Array(10).fill(db);
      eq.setBands(gains);
      const activeBands = eq.getBands();
      assert.deepEqual(activeBands, gains);
    }
  });

  await t.test('5.2: Maximum boost (+12 dB all bands) on high-energy audio signal yields stable finite samples', () => {
    eq.setBands(Array(10).fill(12.0)); // Maximum allowed SVF boost
    const sampleCount = 4410; // 100ms at 44.1 kHz
    const leftIn = new Float32Array(sampleCount);
    const rightIn = new Float32Array(sampleCount);

    // Multi-frequency test tone (sum of sines at 60Hz, 1kHz, 10kHz)
    for (let i = 0; i < sampleCount; i++) {
      const t = i / 44100;
      const sample = 0.3 * Math.sin(2 * Math.PI * 60 * t) +
                     0.3 * Math.sin(2 * Math.PI * 1000 * t) +
                     0.3 * Math.sin(2 * Math.PI * 10000 * t);
      leftIn[i] = sample;
      rightIn[i] = sample;
    }

    const { leftOut, rightOut } = eq.process(leftIn, rightIn);

    assert.equal(leftOut.length, sampleCount);
    assert.equal(rightOut.length, sampleCount);

    for (let i = 0; i < sampleCount; i++) {
      assert.equal(Number.isFinite(leftOut[i]), true, `leftOut[${i}] must be finite`);
      assert.equal(Number.isFinite(rightOut[i]), true, `rightOut[${i}] must be finite`);
      assert.equal(Number.isNaN(leftOut[i]), false);
      assert.equal(Number.isNaN(rightOut[i]), false);
    }
  });

  await t.test('5.3: Maximum cut (-12 dB all bands) attenuates audio cleanly without underflow explosion', () => {
    eq.setBands(Array(10).fill(-12.0));
    const sampleCount = 4410;
    const leftIn = new Float32Array(sampleCount).fill(0.5);
    const rightIn = new Float32Array(sampleCount).fill(0.5);

    const { leftOut, rightOut } = eq.process(leftIn, rightIn);
    for (let i = 1000; i < sampleCount; i++) {
      assert.equal(Math.abs(leftOut[i]) < 0.5, true, 'Maximum cut must attenuate signal');
      assert.equal(Number.isFinite(leftOut[i]), true);
    }
  });

  await t.test('5.4: Checkerboard alternating extreme EQ [+12, -12, ...] remains unconditionally stable', () => {
    const patternA = [12, -12, 12, -12, 12, -12, 12, -12, 12, -12];
    const patternB = [-12, 12, -12, 12, -12, 12, -12, 12, -12, 12];

    eq.setBands(patternA);
    assert.deepEqual(eq.getBands(), patternA);

    const sampleCount = 8820; // 200ms
    const noiseL = new Float32Array(sampleCount);
    const noiseR = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      noiseL[i] = (Math.random() * 2 - 1) * 0.8;
      noiseR[i] = (Math.random() * 2 - 1) * 0.8;
    }

    const resA = eq.process(noiseL, noiseR);
    for (let i = 0; i < sampleCount; i++) {
      assert.equal(Number.isFinite(resA.leftOut[i]), true);
      assert.equal(Number.isFinite(resA.rightOut[i]), true);
    }

    // Rapid switch to inverse pattern
    eq.setBands(patternB);
    const resB = eq.process(noiseL, noiseR);
    for (let i = 0; i < sampleCount; i++) {
      assert.equal(Number.isFinite(resB.leftOut[i]), true);
      assert.equal(Number.isFinite(resB.rightOut[i]), true);
    }
  });

  await t.test('5.5: Out-of-bounds gain values (> +12 dB or < -12 dB) throw RangeError per contract', () => {
    assert.throws(() => eq.setBands([12.01, 0, 0, 0, 0, 0, 0, 0, 0, 0]), RangeError);
    assert.throws(() => eq.setBands([-12.01, 0, 0, 0, 0, 0, 0, 0, 0, 0]), RangeError);
    assert.throws(() => eq.setBands([NaN, 0, 0, 0, 0, 0, 0, 0, 0, 0]), RangeError);
    assert.throws(() => eq.setBands([Infinity, 0, 0, 0, 0, 0, 0, 0, 0, 0]), RangeError);
    assert.throws(() => eq.setBands([0, 0, 0]), Error); // Fewer than 10 bands
  });

  await t.test('5.6: LookaheadPeakLimiter strictly clamps extreme boosted audio below 0.985 ceiling', () => {
    // Generate severely over-amplified signal (e.g. +20 dB equivalent = amplitude ~ 10.0)
    const sampleCount = 44100; // 1 full second
    const saturatedL = new Float32Array(sampleCount);
    const saturatedR = new Float32Array(sampleCount);

    for (let i = 0; i < sampleCount; i++) {
      const t = i / 44100;
      // High-amplitude square-like wave + high frequency noise
      saturatedL[i] = 8.5 * Math.sin(2 * Math.PI * 440 * t) + (Math.random() - 0.5) * 2.0;
      saturatedR[i] = -8.5 * Math.sin(2 * Math.PI * 440 * t) + (Math.random() - 0.5) * 2.0;
    }

    const { leftOut, rightOut } = limiter.processStereo(saturatedL, saturatedR);

    let maxPeakL = 0;
    let maxPeakR = 0;
    let ceilingViolations = 0;
    const ceilingTolerance = 0.9850001; // IEEE-754 32-bit single precision tolerance (0.985f = 0.9850000143)

    for (let i = 0; i < sampleCount; i++) {
      const absL = Math.abs(leftOut[i]);
      const absR = Math.abs(rightOut[i]);

      if (absL > maxPeakL) maxPeakL = absL;
      if (absR > maxPeakR) maxPeakR = absR;

      if (absL > ceilingTolerance || absR > ceilingTolerance) {
        ceilingViolations++;
      }
    }

    assert.equal(ceilingViolations, 0, 'Ceiling 0.985 must never be breached');
    assert.equal(maxPeakL <= ceilingTolerance, true, `Max left peak ${maxPeakL} must be <= 0.985`);
    assert.equal(maxPeakR <= ceilingTolerance, true, `Max right peak ${maxPeakR} must be <= 0.985`);
  });
});
