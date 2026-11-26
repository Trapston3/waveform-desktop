// tests/unit/offline_cache_and_practice_loop.test.mjs
// Unit tests for v1.3.2 Offline Pinning (LRU disk cache) & Bar-Snapped A-B Practice Loop + Speed

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';

const resolverHook = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && !specifier.endsWith('.ts') && !specifier.endsWith('.tsx') && !specifier.endsWith('.js') && !specifier.endsWith('.mjs')) {
      for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
        try {
          return await nextResolve(specifier + suffix, context);
        } catch {}
      }
    }
    throw err;
  }
}
`;
register(`data:text/javascript,${encodeURIComponent(resolverHook)}`, import.meta.url);

const {
  OfflineCacheManager,
  MIN_CACHE_LIMIT_GB,
  MAX_CACHE_LIMIT_GB,
  BYTES_PER_GB,
  clampCacheLimitGb,
} = await import('../../electron/offlineCache.ts');

const {
  clampPlaybackRate,
  deriveBarsFromBeatAnalysis,
  snapLoopToBars,
} = await import('../../src/utils/practiceLoop.ts');

const { AudioEngine } = await import('../../src/audio/AudioEngine.ts');

describe('v1.3.2 Offline Pinning & Bar-Snapped Practice Controls', () => {
  test('1. OfflineCacheManager clamps 1-50 GB limit and preserves pinned tracks during LRU eviction', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-offline-test-'));
    try {
      assert.equal(clampCacheLimitGb(0), MIN_CACHE_LIMIT_GB);
      assert.equal(clampCacheLimitGb(99), MAX_CACHE_LIMIT_GB);
      assert.equal(clampCacheLimitGb(12.4), 12);

      // Use custom small byte cap inside constructor to test exact LRU eviction deterministically,
      // after clamping test via clampCacheLimitGb.
      const mockFetch = async (url) => {
        const len = url.includes('big') ? 600_000 : 500_000;
        const buf = new Uint8Array(len).fill(42).buffer;
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'audio/mp4' },
          arrayBuffer: async () => buf,
        };
      };

      const mgr = new OfflineCacheManager(tmpDir, {
        limitBytes: 1_250_000, // constructor clamps to >= 1 GB; override internal limitBytes below to test LRU math
        fetchFn: mockFetch,
      });
      // Inject tight 1.25 MB cap directly to simulate filling disk limit with small test fixtures
      Object.defineProperty(mgr, 'limitBytes', { value: 1_250_000, writable: true });

      await mgr.pinTrack({
        trackId: 'pinned_1',
        title: 'Pinned Anthem',
        artist: 'Artist A',
        streamUrl: 'https://example.com/big1.m4a', // 600 KB
      });
      await new Promise((r) => setTimeout(r, 10));
      await mgr.cacheStream({
        trackId: 'auto_oldest',
        title: 'Auto Oldest',
        artist: 'Artist B',
        streamUrl: 'https://example.com/small1.m4a', // 500 KB (total = 1.1 MB <= 1.25 MB)
      });
      await new Promise((r) => setTimeout(r, 10));
      await mgr.cacheStream({
        trackId: 'auto_newest',
        title: 'Auto Newest',
        artist: 'Artist C',
        streamUrl: 'https://example.com/big2.m4a', // 600 KB -> 1.7 MB > 1.25 MB -> evicts auto_oldest ONLY (remaining = 1.2 MB)
      });

      const resolvedPinned = mgr.resolveCachedTrack('pinned_1');
      const resolvedOldest = mgr.resolveCachedTrack('auto_oldest');
      const resolvedNewest = mgr.resolveCachedTrack('auto_newest');

      assert.ok(resolvedPinned);
      assert.equal(resolvedPinned.pinned, true);
      assert.match(resolvedPinned.url, /^waveform-local:\/\/audio\?path=/);
      assert.equal(resolvedOldest, null); // Oldest unpinned track evicted
      assert.ok(resolvedNewest); // Newer unpinned track fits under 1.25 MB cap (600 + 600 <= 1.25 MB)

      const stats = mgr.getStats();
      assert.equal(stats.pinnedCount, 1);
      assert.equal(stats.unpinnedCount, 1);
      assert.equal(stats.pinnedTrackIds[0], 'pinned_1');
      assert.equal(stats.limitBytes > 0, true);

      // Test clearUnpinnedCache leaves pinned tracks untouched
      await mgr.cacheStream({
        trackId: 'auto_temp',
        title: 'Temp',
        artist: 'Artist D',
        streamUrl: 'https://example.com/small2.m4a',
      });
      // Reset limit temporarily so auto_temp stays long enough to test clearUnpinnedCache
      const clearRes = mgr.clearUnpinnedCache();
      assert.ok(mgr.resolveCachedTrack('pinned_1'));
      assert.equal(clearRes.stats.unpinnedCount, 0);
      assert.equal(clearRes.stats.pinnedCount, 1);

      mgr.unpinTrack('pinned_1');
      assert.equal(mgr.getStats().pinnedCount, 0);
      mgr.setLimitGb(10);
      assert.equal(mgr.getStats().limitBytes, 10 * BYTES_PER_GB);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('2. snapLoopToBars snaps A-B loops to neural downbeats and falls back to BPM grid', () => {
    const downbeats = [0.5, 2.5, 4.5, 6.5, 8.5, 10.5, 12.5, 14.5, 16.5];
    const beats = [0.5, 1.0, 1.5, 2.0, 2.5];
    assert.deepEqual(deriveBarsFromBeatAnalysis(beats, []), [0.5, 2.5]);

    const loop4 = snapLoopToBars(3.1, 4, downbeats, beats, 120, 30);
    // Current 3.1s snaps back to downbeat 2.5s (idx 1) -> +4 bars = downbeats[5] = 10.5s
    assert.equal(loop4.startMs, 2500);
    assert.equal(loop4.endMs, 10500);

    // BPM fallback when downbeats & beats are empty (120 BPM = 2.0s per 4/4 bar)
    const fallback4 = snapLoopToBars(4.2, 4, [], [], 120, 40);
    assert.equal(fallback4.startMs, 4000);
    assert.equal(fallback4.endMs, 12000);
  });

  test('3. clampPlaybackRate and AudioEngine.setPlaybackRate clamp speed strictly within 0.5x-1.5x', () => {
    assert.equal(clampPlaybackRate(0.1), 0.5);
    assert.equal(clampPlaybackRate(2.4), 1.5);
    assert.equal(clampPlaybackRate(0.854), 0.85);
    assert.equal(clampPlaybackRate(Number.NaN), 1.0);

    const engine = new AudioEngine(null);
    assert.equal(engine.setPlaybackRate(0.25), 0.5);
    assert.equal(engine.getPlaybackRate(), 0.5);
    assert.equal(engine.setPlaybackRate(1.8), 1.5);
    assert.equal(engine.getPlaybackRate(), 1.5);
    engine.dispose();
  });
});
