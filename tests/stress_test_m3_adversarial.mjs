// tests/stress_test_m3_adversarial.mjs
// Adversarial stress tests for Milestone M3 deliverables

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { register } from 'node:module';

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

const { TrackMatcher } = await import('../src/services/TrackMatcher.ts');
const { loadSyncSession, saveSyncSession, clearSyncSession, persistSessionDebounced } = await import('../src/utils/sessionPersistence.ts');

describe('Adversarial Stress: TrackMatcher Edge Cases & Robustness', () => {
  test('ADV-TM-01: Malformed and dirty inputs do not throw or crash', () => {
    const dirtyInputs = ['', '   ', '???', '---', '()[]{}', 'null', 'undefined', '12345'];
    for (const raw of dirtyInputs) {
      assert.doesNotThrow(() => {
        const parts = TrackMatcher.parseTitle(raw, raw);
        assert.ok(parts && typeof parts.core === 'string');
      }, `parseTitle crashed on input "${raw}"`);
    }
  });

  test('ADV-TM-02: Extreme duration drift values (> 1000s, negative, null, NaN)', () => {
    const target = { title: 'Song A', artist: 'Artist B', durationSec: 200 };
    const candidates = [
      { id: '1', title: 'Song A', artist: 'Artist B', durationSec: -10 },
      { id: '2', title: 'Song A', artist: 'Artist B', durationSec: 999999 },
      { id: '3', title: 'Song A', artist: 'Artist B', durationSec: null },
      { id: '4', title: 'Song A', artist: 'Artist B', durationText: 'invalid:time:format' },
      { id: '5', title: 'Song A', artist: 'Artist B', durationSec: 201 },
    ];

    assert.doesNotThrow(() => {
      const ranked = TrackMatcher.rankCandidates(candidates, target);
      assert.ok(ranked.length >= 1);
      assert.strictEqual(ranked[0].id, '5');
    });
  });

  test('ADV-TM-03: Candidate scalability (1,000 candidates scored in < 50ms)', () => {
    const target = { title: 'Starboy', artist: 'The Weeknd', durationSec: 230 };
    const candidates = [];
    for (let i = 0; i < 1000; i++) {
      candidates.push({
        id: `cand_${i}`,
        title: i === 777 ? 'Starboy' : `Starboy (Remix ${i})`,
        artist: 'The Weeknd',
        channelTitle: i === 777 ? 'The Weeknd - Topic' : `Remixer ${i}`,
        durationSec: i === 777 ? 230 : 200 + (i % 80),
        musicVideoType: i === 777 ? 'MUSIC_VIDEO_TYPE_ATV' : undefined,
      });
    }

    const t0 = performance.now();
    const ranked = TrackMatcher.rankCandidates(candidates, target);
    const elapsed = performance.now() - t0;

    assert.ok(elapsed < 50, `1,000 candidates scored in ${elapsed}ms (expected < 50ms)`);
    assert.strictEqual(ranked.length, 1, 'Only official track should survive strict remix rejection');
    assert.strictEqual(ranked[0].id, 'cand_777');
  });

  test('ADV-TM-04: Non-Latin scripts (Arabic, Cyrillic, Hindi/Devanagari, CJK)', () => {
    const testCases = [
      { title: 'حبيبي', artist: 'عمرو دياب', durationSec: 210 },
      { title: 'Группа крови', artist: 'Кино', durationSec: 285 },
      { title: 'तुझ में रब दिखता है', artist: 'Roop Kumar Rathod', durationSec: 275 },
    ];

    for (const tc of testCases) {
      const cand = {
        id: 'c1',
        title: tc.title,
        artist: tc.artist,
        channelTitle: `${tc.artist} - Topic`,
        durationSec: tc.durationSec,
      };
      const score = TrackMatcher.score(cand, tc);
      assert.ok(score !== null && score >= 140, `Failed non-Latin matching for ${tc.title}`);
    }
  });
});

describe('Adversarial Stress: sessionPersistence Corruption Recovery & Load Safety', () => {
  test('ADV-PERSIST-01: Corrupted JSON in storage gracefully returns null without throwing', () => {
    const originalLs = globalThis.localStorage;
    // Mock corrupted storage
    let stored = '{ invalid json !!%';
    globalThis.localStorage = {
      getItem: () => stored,
      setItem: (k, v) => { stored = v; },
      removeItem: () => { stored = null; },
    };

    assert.doesNotThrow(() => {
      const session = loadSyncSession();
      assert.strictEqual(session, null, 'Corrupted JSON must return null');
    });

    globalThis.localStorage = originalLs;
  });

  test('ADV-PERSIST-02: Outdated schema version gracefully returns null', () => {
    const originalLs = globalThis.localStorage;
    let stored = JSON.stringify({ version: 999, player: {} });
    globalThis.localStorage = {
      getItem: () => stored,
      setItem: (k, v) => { stored = v; },
      removeItem: () => { stored = null; },
    };

    const session = loadSyncSession();
    assert.strictEqual(session, null, 'Outdated version must return null');

    globalThis.localStorage = originalLs;
  });

  test('ADV-PERSIST-03: High-capacity queue serialization (500 tracks in queue)', () => {
    const manySongs = [];
    for (let i = 0; i < 500; i++) {
      manySongs.push({
        videoId: `track_${i}`,
        title: `Track ${i}`,
        artist: 'Artist',
        liked: false,
        totalPlayTimeMs: 180000,
        playCount: 0,
        artistIds: [],
        artists: [],
      });
    }

    const bigSession = {
      version: 1,
      savedAt: Date.now(),
      player: {
        currentTrack: manySongs[0],
        positionMs: 12000,
        durationMs: 180000,
        volume: 0.8,
        isMuted: false,
        preMuteVolume: 0.8,
        isShuffle: false,
        repeatMode: 'off',
        playbackState: 'PAUSED',
      },
      queue: {
        tiers: {
          USER_QUEUE: manySongs.slice(1, 100),
          CONTEXT: manySongs,
          AUTOPLAY: [],
        },
        currentSong: manySongs[0],
        currentTier: 'CONTEXT',
        currentIndex: 0,
        history: [],
        context: null,
      },
    };

    assert.doesNotThrow(() => {
      saveSyncSession(bigSession);
      const restored = loadSyncSession();
      assert.ok(restored !== null);
      assert.strictEqual(restored.queue.tiers.CONTEXT.length, 500);
      assert.strictEqual(restored.queue.tiers.USER_QUEUE.length, 99);
    });

    clearSyncSession();
  });
});
