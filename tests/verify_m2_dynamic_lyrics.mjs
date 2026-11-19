// tests/verify_m2_dynamic_lyrics.mjs
// Verification script for dynamic lyrics loading of target tracks:
// 1. "The Strokes - Ode to the Mets" (BjC0KUxiMhc)
// 2. "Sweet Taste of India" / "Taste Of India (Audio)" (yl0at21gRrU)

import assert from 'node:assert/strict';
import { register } from 'node:module';

// Register ESM resolution hook for TypeScript imports
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
  console.log('  MILESTONE 2: DYNAMIC LYRICS PIPELINE VERIFICATION');
  console.log('================================================================');

  const { LyricsService } = await import('../src/services/LyricsService.ts');
  const { InnerTubeClient } = await import('../src/services/InnerTubeClient.ts');

  // Test 1: Title Normalization
  console.log('\n[Test 1] Metadata Normalization Pipeline');
  const test1 = LyricsService.cleanTrackMetadata('Ode To The Mets (Official Video)', 'The Strokes - Topic');
  assert.strictEqual(test1.title, 'Ode To The Mets');
  assert.strictEqual(test1.artist, 'The Strokes');
  console.log('  ✔ "Ode To The Mets (Official Video)" ->', test1);

  const test2 = LyricsService.cleanTrackMetadata('Taste Of India (Audio)', 'Aerosmith');
  assert.strictEqual(test2.title, 'Taste Of India');
  assert.strictEqual(test2.artist, 'Aerosmith');
  console.log('  ✔ "Taste Of India (Audio)" ->', test2);

  const test3 = LyricsService.cleanTrackMetadata('The Strokes - Ode to the Mets');
  assert.strictEqual(test3.title, 'Ode to the Mets');
  assert.strictEqual(test3.artist, 'The Strokes');
  console.log('  ✔ "The Strokes - Ode to the Mets" ->', test3);

  // Test 2: Target Track 1 - "The Strokes - Ode to the Mets"
  console.log('\n[Test 2] Dynamic Lyrics Resolution: "The Strokes - Ode to the Mets"');
  const t1Start = performance.now();
  const lyricsMets = await LyricsService.fetchLyrics(
    'BjC0KUxiMhc',
    'Ode To The Mets (Official Video)',
    'The Strokes',
    'The New Abnormal',
    351
  );
  const t1Elapsed = Math.round(performance.now() - t1Start);

  assert.ok(lyricsMets, 'Ode to the Mets lyrics must not be null');
  assert.ok(lyricsMets.lines.length > 30, `Expected > 30 lines, got ${lyricsMets.lines.length}`);
  console.log(`  ✔ Resolved in ${t1Elapsed}ms`);
  console.log(`  ✔ Provider: ${lyricsMets.provider}, Type: ${lyricsMets.type}, Synced: ${lyricsMets.isSynced}`);
  console.log(`  ✔ Total lines: ${lyricsMets.lines.length}`);
  console.log(`  ✔ Sample Line 1: [${lyricsMets.lines[0].startTimeMs}ms] "${lyricsMets.lines[0].text}"`);
  console.log(`  ✔ Sample Line 2: [${lyricsMets.lines[1].startTimeMs}ms] "${lyricsMets.lines[1].text}"`);

  // Test 3: Target Track 2 - "Sweet Taste of India"
  console.log('\n[Test 3] Dynamic Lyrics Resolution: "Sweet Taste of India" (Taste Of India)');
  const t2Start = performance.now();
  const lyricsIndia = await LyricsService.fetchLyrics(
    'yl0at21gRrU',
    'Taste Of India (Audio)',
    'Aerosmith',
    'Nine Lives',
    353
  );
  const t2Elapsed = Math.round(performance.now() - t2Start);

  assert.ok(lyricsIndia, 'Sweet Taste of India lyrics must not be null');
  assert.ok(lyricsIndia.lines.length > 30, `Expected > 30 lines, got ${lyricsIndia.lines.length}`);
  console.log(`  ✔ Resolved in ${t2Elapsed}ms`);
  console.log(`  ✔ Provider: ${lyricsIndia.provider}, Type: ${lyricsIndia.type}, Synced: ${lyricsIndia.isSynced}`);
  console.log(`  ✔ Total lines: ${lyricsIndia.lines.length}`);
  console.log(`  ✔ Sample Line 1: [${lyricsIndia.lines[0].startTimeMs}ms] "${lyricsIndia.lines[0].text}"`);
  console.log(`  ✔ Sample Line 2: [${lyricsIndia.lines[1].startTimeMs}ms] "${lyricsIndia.lines[1].text}"`);

  // Test 4: LRU In-Memory Cache and Request Deduplication
  console.log('\n[Test 4] In-Memory LRU Cache & Instant Recall');
  const cacheStart = performance.now();
  const cachedMets = await LyricsService.fetchLyrics(
    'BjC0KUxiMhc',
    'Ode To The Mets (Official Video)',
    'The Strokes'
  );
  const cacheElapsed = performance.now() - cacheStart;
  assert.strictEqual(cachedMets, lyricsMets, 'Cached lyrics must return identical reference');
  assert.ok(cacheElapsed < 5, `Cache hit must be < 5ms, took ${cacheElapsed.toFixed(3)}ms`);
  console.log(`  ✔ Cache Hit executed in ${cacheElapsed.toFixed(3)}ms (0ms instant return)`);
  console.log(`  ✔ Current Cache Size: ${LyricsService.getCacheSize()} items`);

  // Test 5: InnerTube Native Musixmatch Direct Probe
  console.log('\n[Test 5] InnerTube Native Musixmatch Fallback Direct Probe');
  const innerTube = new InnerTubeClient();
  const directInnerTube = await innerTube.fetchTrackLyrics('yl0at21gRrU');
  assert.ok(directInnerTube, 'Direct InnerTube fetch must return lyrics');
  assert.strictEqual(directInnerTube.provider, 'innertube');
  assert.ok(directInnerTube.lines.length > 30, 'InnerTube lines count must exceed 30');
  console.log(`  ✔ InnerTube returned ${directInnerTube.lines.length} lines, footer: "${directInnerTube.sourceAttribution}"`);

  // Test 6: Whitespace Syllable Interpolation Check
  console.log('\n[Test 6] Whitespace Syllable Non-Pollution Verification');
  const testLine = {
    lineIndex: 0,
    startTimeMs: 1000,
    endTimeMs: 5000,
    text: 'Up on his horse, up on his horse',
  };
  const interpolated = LyricsService.interpolateLineSyllables(testLine);
  assert.ok(interpolated.syllables && interpolated.syllables.length > 0);
  for (const syl of interpolated.syllables) {
    assert.ok(syl.text.trim().length > 0, `Syllable text must not be empty or whitespace: "${syl.text}"`);
    assert.ok(!/^\s+$/.test(syl.text), `Whitespace token detected: "${syl.text}"`);
  }
  console.log(`  ✔ ${interpolated.syllables.length} non-whitespace syllables created cleanly without space pollution.`);

  console.log('\n================================================================');
  console.log('  MILESTONE 2 DYNAMIC LYRICS VERIFICATION: ALL PASS (100%)');
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
