// tests/verify_lyrics_store_concurrency.mjs
// Adversarial test for useLyricsStore concurrency, race conditions, and rapid track switching

import assert from 'node:assert/strict';
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
      try {
        return await nextResolve(specifier + '/index.ts', context);
      } catch {}
    }
    throw err;
  }
}
`;
register(`data:text/javascript,${encodeURIComponent(resolverHook)}`, import.meta.url);

async function main() {
  console.log('================================================================');
  console.log('  ADVERSARIAL STRESS TEST: LYRICS STORE CONCURRENCY & RACE CONDITIONS');
  console.log('================================================================\n');

  const { useLyricsStore } = await import('../src/state/lyricsStore.ts');

  // Test 1: Concurrent identical fetches (RightInspector + NowPlayingScreen mounting together)
  console.log('[Test 1] Concurrent identical fetches across components');
  const store = useLyricsStore.getState();
  const track = { videoId: 'BjC0KUxiMhc', title: 'Ode To The Mets', artist: 'The Strokes', durationSec: 351 };

  const [res1, res2, res3] = await Promise.all([
    store.fetchLyricsForTrack(track),
    store.fetchLyricsForTrack(track),
    store.fetchLyricsForTrack(track),
  ]);

  const state1 = useLyricsStore.getState();
  assert.strictEqual(state1.currentTrackId, 'BjC0KUxiMhc');
  assert.strictEqual(state1.isLoading, false);
  assert.ok(state1.lyricsData);
  assert.ok(state1.lyricsData.lines.length >= 40);
  console.log(`  ✔ Concurrent identical fetches resolved cleanly to track "${state1.lyricsData.lines[0].text}" (${state1.lyricsData.lines.length} lines)`);

  // Test 2: Instant cache re-fetch without network
  console.log('\n[Test 2] Cached track re-fetch avoids clearing or re-fetching');
  let stateWasCleared = false;
  const unsubscribe = useLyricsStore.subscribe((curr) => {
    if (curr.isLoading && curr.currentTrackId === 'BjC0KUxiMhc') {
      stateWasCleared = true;
    }
  });
  await store.fetchLyricsForTrack(track);
  unsubscribe();
  assert.strictEqual(stateWasCleared, false, 'Cached track fetch should not trigger isLoading or wipe state');
  console.log('  ✔ Cache hit returned synchronously without entering loading state');

  // Test 3: Rapid track switching race condition (Track A -> Track B in-flight)
  console.log('\n[Test 3] Rapid track switching race condition');
  const trackA = { videoId: 'songA', title: 'Taste Of India', artist: 'Aerosmith', durationSec: 353 };
  const trackB = { videoId: 'songB', title: 'Ode To The Mets', artist: 'The Strokes', durationSec: 351 };

  // Dispatch track A, and immediately dispatch track B without awaiting A
  const pA = store.fetchLyricsForTrack(trackA);
  const pB = store.fetchLyricsForTrack(trackB);

  await Promise.all([pA, pB]);

  const state3 = useLyricsStore.getState();
  assert.strictEqual(state3.currentTrackId, 'songB', 'Current track ID must be track B');
  assert.strictEqual(state3.isLoading, false);
  assert.ok(state3.lyricsData);
  // Verify track B (Ode to the Mets, 43 lines) is the final stored lyrics, NOT track A (Taste of India, 61 lines)
  assert.strictEqual(state3.lyricsData.lines.length, 43, 'Stored lyrics must correspond to track B');
  console.log('  ✔ Out-of-order resolution discarded stale track A and cleanly retained track B');

  // Test 4: Null track clears store
  console.log('\n[Test 4] Null track resets store state');
  await store.fetchLyricsForTrack(null);
  const state4 = useLyricsStore.getState();
  assert.strictEqual(state4.currentTrackId, null);
  assert.strictEqual(state4.lyricsData, null);
  assert.strictEqual(state4.isLoading, false);
  assert.strictEqual(state4.error, null);
  console.log('  ✔ Null track cleanly reset lyrics store');

  console.log('\n================================================================');
  console.log('  CONCURRENCY & RACE CONDITION TESTS PASSED (100%)');
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('\n❌ Concurrency Test Failed:', err);
  process.exit(1);
});
