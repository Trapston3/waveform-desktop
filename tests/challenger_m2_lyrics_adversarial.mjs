// tests/challenger_m2_lyrics_adversarial.mjs
// Adversarial Empirical Challenge Suite for Milestone 2 Iteration 2
// Author: challenger_m2_r3_1
// Focus:
// 1. Dynamic live resolution for target tracks: "The Strokes - Ode to the Mets" & "Sweet Taste of India"
// 2. Fallback to InnerTube Musixmatch when LRCLIB encounters simulated errors or network drops
// 3. Title normalization adversarial boundary conditions
// 4. Concurrency, in-flight dedup, LRU capacity, and store race conditions
// 5. SyllableLyricsEngine DOM effect lifecycle (M2-UI-01 verification)

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// Register hook for TS and TSX loading
register('./helpers/tsxLoader.mjs', import.meta.url);

const { LyricsService } = await import('../src/services/LyricsService.ts');
const { InnerTubeClient } = await import('../src/services/InnerTubeClient.ts');
const { useLyricsStore } = await import('../src/state/lyricsStore.ts');

describe('Empirical Adversarial Challenge Suite: Milestone 2 Lyrics & Normalization', () => {

  // Save original global fetch for restoration
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
    LyricsService.clearCache();
    useLyricsStore.getState().clearLyrics();
  });

  after(() => {
    globalThis.fetch = originalFetch;
    LyricsService.clearCache();
    useLyricsStore.getState().clearLyrics();
  });

  // ==========================================================================
  // SUITE 1: DYNAMIC LIVE RESOLUTION FOR TARGET TRACKS
  // ==========================================================================
  describe('Suite 1: Dynamic Live Resolution for Target Tracks', () => {

    test('TC1.1: Live resolution for "The Strokes - Ode to the Mets" across metadata variants', async () => {
      // Variant A: Canonical YouTube Music format (ID + Title with (Official Video) + Artist)
      const resA = await LyricsService.fetchLyrics(
        'BjC0KUxiMhc',
        'Ode To The Mets (Official Video)',
        'The Strokes',
        'The New Abnormal',
        351
      );

      assert.ok(resA, 'Variant A must resolve lyrics');
      assert.strictEqual(resA.isSynced, true, 'Variant A must be synced');
      assert.ok(resA.lines.length >= 35, `Expected >= 35 lines, got ${resA.lines.length}`);
      assert.ok(resA.lines[0].text.includes('horse') || resA.lines[1].text.includes('horse'),
        'Lyrics text must match Ode To The Mets opening lyrics');

      // Monotonic timestamps check
      for (let i = 1; i < resA.lines.length; i++) {
        assert.ok(
          resA.lines[i].startTimeMs >= resA.lines[i - 1].startTimeMs,
          `Lines must be strictly non-decreasing in time: line ${i} (${resA.lines[i].startTimeMs}) vs ${resA.lines[i - 1].startTimeMs}`
        );
      }

      // Syllable non-pollution check
      for (const line of resA.lines) {
        if (line.syllables) {
          for (const s of line.syllables) {
            assert.ok(s.text.trim().length > 0, `Syllable text must not be empty or whitespace: "${s.text}"`);
          }
        }
      }

      // Variant B: Pure combined title string without songId (1 arg)
      LyricsService.clearCache();
      const resB = await LyricsService.fetchLyrics(
        'The Strokes - Ode to the Mets'
      );
      assert.ok(resB, 'Variant B (1-arg combined string) must resolve lyrics');
      assert.strictEqual(resB.isSynced, true);
      assert.ok(resB.lines.length >= 35);

      // Variant C: Title + Artist without songId (2 args)
      LyricsService.clearCache();
      const resC = await LyricsService.fetchLyrics(
        'Ode to the Mets',
        'The Strokes'
      );
      assert.ok(resC, 'Variant C (2-arg title, artist) must resolve lyrics');
      assert.strictEqual(resC.isSynced, true);
      assert.ok(resC.lines.length >= 35);

      // Variant D: SongId + Combined Title + empty artist (3 args)
      LyricsService.clearCache();
      const resD = await LyricsService.fetchLyrics(
        'BjC0KUxiMhc',
        'The Strokes - Ode to the Mets',
        ''
      );
      assert.ok(resD, 'Variant D (3-arg songId + combined title) must resolve lyrics');
      assert.strictEqual(resD.isSynced, true);
      assert.ok(resD.lines.length >= 35);

      // Variant E: Audio noise suffix + Topic artist channel (3 args)
      LyricsService.clearCache();
      const resE = await LyricsService.fetchLyrics(
        'BjC0KUxiMhc',
        'Ode to the Mets - Official Audio',
        'The Strokes - Topic'
      );
      assert.ok(resE, 'Variant E (Topic channel + audio noise) must resolve lyrics');
      assert.strictEqual(resE.isSynced, true);
      assert.ok(resE.lines.length >= 35);
    });

    test('TC1.2: Live resolution for "Sweet Taste of India" / "Taste Of India" across metadata variants', async () => {
      // Variant A: Canonical YouTube title "Taste Of India (Audio)" by Aerosmith
      const resA = await LyricsService.fetchLyrics(
        'yl0at21gRrU',
        'Taste Of India (Audio)',
        'Aerosmith',
        'Nine Lives',
        353
      );

      assert.ok(resA, 'Variant A (Taste of India) must resolve lyrics');
      assert.strictEqual(resA.isSynced, true, 'Variant A must be synced');
      assert.ok(resA.lines.length >= 50, `Expected >= 50 lines, got ${resA.lines.length}`);
      
      const hasChorus = resA.lines.some(l => l.text.toLowerCase().includes('sweet taste of india'));
      assert.ok(hasChorus, 'Lyrics must contain chorus line "sweet taste of india"');

      // Syllables check
      for (const line of resA.lines) {
        if (line.syllables) {
          for (const s of line.syllables) {
            assert.ok(s.text.trim().length > 0, `Syllable text must not be empty or whitespace: "${s.text}"`);
          }
        }
      }

      // Variant B: Colloquial user title "Sweet Taste of India" with Aerosmith (3 args)
      LyricsService.clearCache();
      const resB = await LyricsService.fetchLyrics(
        'yl0at21gRrU',
        'Sweet Taste of India',
        'Aerosmith'
      );
      assert.ok(resB, 'Variant B (colloquial title) must resolve lyrics via fallback or fuzzy search');
      assert.ok(resB.lines.length >= 30, `Expected >= 30 lines, got ${resB.lines.length}`);

      // Variant C: Pure combined title string without songId (1 arg)
      LyricsService.clearCache();
      const resC = await LyricsService.fetchLyrics(
        'Aerosmith - Taste of India'
      );
      assert.ok(resC, 'Variant C (1-arg combined title) must resolve lyrics');
      assert.ok(resC.lines.length >= 30);

      // Variant D: SongId + Combined Title + empty artist (3 args)
      LyricsService.clearCache();
      const resD = await LyricsService.fetchLyrics(
        'yl0at21gRrU',
        'Aerosmith - Taste of India',
        ''
      );
      assert.ok(resD, 'Variant D (3-arg songId + combined title) must resolve lyrics');
      assert.ok(resD.lines.length >= 30);
    });
  });

  // ==========================================================================
  // SUITE 2: LRCLIB FAILURE & INNERTUBE MUSIXMATCH FALLBACK
  // ==========================================================================
  describe('Suite 2: LRCLIB Failure & InnerTube Musixmatch Fallback', () => {

    test('TC2.1: Simulated LRCLIB HTTP 500 triggers clean fallback to InnerTube Musixmatch', async () => {
      // Mock fetch: lrclib.net returns 500, YouTube Music passes through
      globalThis.fetch = async (url, opts) => {
        const urlStr = String(url);
        if (urlStr.includes('lrclib.net')) {
          return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
            status: 500,
            statusText: 'Internal Server Error',
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return originalFetch(url, opts);
      };

      const result = await LyricsService.fetchLyrics(
        'yl0at21gRrU',
        'Taste Of India',
        'Aerosmith'
      );

      assert.ok(result, 'Must not return null when LRCLIB is 500 and InnerTube is available');
      assert.strictEqual(result.provider, 'innertube', `Provider must be 'innertube', got '${result.provider}'`);
      assert.ok(result.lines.length >= 30, `InnerTube lyrics must have >= 30 lines, got ${result.lines.length}`);
      assert.ok(
        result.sourceAttribution?.toLowerCase().includes('musixmatch'),
        `Source attribution must cite Musixmatch, got "${result.sourceAttribution}"`
      );
      const hasChorus = result.lines.some(l => l.text.toLowerCase().includes('sweet taste of india'));
      assert.ok(hasChorus, 'InnerTube lyrics must contain "sweet taste of india"');
    });

    test('TC2.2: Simulated LRCLIB HTTP 429 Rate Limit triggers fallback to InnerTube Musixmatch', async () => {
      globalThis.fetch = async (url, opts) => {
        const urlStr = String(url);
        if (urlStr.includes('lrclib.net')) {
          return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
            status: 429,
            statusText: 'Too Many Requests',
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return originalFetch(url, opts);
      };

      const result = await LyricsService.fetchLyrics(
        'BjC0KUxiMhc',
        'Ode To The Mets',
        'The Strokes'
      );

      assert.ok(result, 'Must fall back when LRCLIB returns 429');
      assert.strictEqual(result.provider, 'innertube');
      assert.ok(result.lines.length >= 30);
      assert.ok(result.sourceAttribution?.toLowerCase().includes('musixmatch'));
    });

    test('TC2.3: Simulated LRCLIB Network Drop (ECONNREFUSED) throws and falls back safely', async () => {
      globalThis.fetch = async (url, opts) => {
        const urlStr = String(url);
        if (urlStr.includes('lrclib.net')) {
          throw new TypeError('fetch failed: connect ECONNREFUSED 104.21.5.197:443');
        }
        return originalFetch(url, opts);
      };

      const result = await LyricsService.fetchLyrics(
        'yl0at21gRrU',
        'Taste Of India',
        'Aerosmith'
      );

      assert.ok(result, 'Must recover gracefully from network drop');
      assert.strictEqual(result.provider, 'innertube');
      assert.ok(result.lines.length >= 30);
    });

    test('TC2.4: Simulated LRCLIB Timeout / AbortError falls back safely', async () => {
      globalThis.fetch = async (url, opts) => {
        const urlStr = String(url);
        if (urlStr.includes('lrclib.net')) {
          throw new DOMException('The user aborted a request.', 'AbortError');
        }
        return originalFetch(url, opts);
      };

      const result = await LyricsService.fetchLyrics(
        'yl0at21gRrU',
        'Taste Of India',
        'Aerosmith'
      );

      assert.ok(result, 'Must recover gracefully from AbortError');
      assert.strictEqual(result.provider, 'innertube');
      assert.ok(result.lines.length >= 30);
    });

    test('TC2.5: Simulated LRCLIB 404 (Track Not Found on LRCLIB) falls back to InnerTube', async () => {
      globalThis.fetch = async (url, opts) => {
        const urlStr = String(url);
        if (urlStr.includes('lrclib.net/api/get')) {
          return new Response(JSON.stringify({ error: 'Track not found' }), {
            status: 404,
            statusText: 'Not Found',
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (urlStr.includes('lrclib.net/api/search')) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return originalFetch(url, opts);
      };

      const result = await LyricsService.fetchLyrics(
        'yl0at21gRrU',
        'Taste Of India',
        'Aerosmith'
      );

      assert.ok(result, 'Must fallback to InnerTube when track is 404 on LRCLIB');
      assert.strictEqual(result.provider, 'innertube');
      assert.ok(result.lines.length >= 30);
    });

    test('TC2.6: Simulated LRCLIB Malformed JSON (HTML 200 OK) recovers to InnerTube', async () => {
      globalThis.fetch = async (url, opts) => {
        const urlStr = String(url);
        if (urlStr.includes('lrclib.net')) {
          return new Response('<!DOCTYPE html><html><body>Error 502 Bad Gateway</body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          });
        }
        return originalFetch(url, opts);
      };

      const result = await LyricsService.fetchLyrics(
        'yl0at21gRrU',
        'Taste Of India',
        'Aerosmith'
      );

      assert.ok(result, 'Must handle corrupt HTML/JSON from LRCLIB without crash');
      assert.strictEqual(result.provider, 'innertube');
      assert.ok(result.lines.length >= 30);
    });

    test('TC2.7: Total outage (Both LRCLIB and InnerTube fail) returns null without crash', async () => {
      globalThis.fetch = async (url, opts) => {
        throw new TypeError('fetch failed: network completely down');
      };

      const result = await LyricsService.fetchLyrics(
        'yl0at21gRrU',
        'Taste Of India',
        'Aerosmith'
      );

      assert.strictEqual(result, null, 'Must safely return null when all providers fail');
    });

    test('TC2.8: UI Store (useLyricsStore) gracefully stores InnerTube fallback on LRCLIB failure', async () => {
      globalThis.fetch = async (url, opts) => {
        const urlStr = String(url);
        if (urlStr.includes('lrclib.net')) {
          return new Response('{"error": "Simulated LRCLIB Failure"}', { status: 500 });
        }
        return originalFetch(url, opts);
      };

      const store = useLyricsStore.getState();
      const mockSong = {
        id: 'yl0at21gRrU',
        videoId: 'yl0at21gRrU',
        title: 'Taste Of India (Audio)',
        artist: 'Aerosmith',
        durationSec: 353,
      };

      await store.fetchLyricsForTrack(mockSong);

      const state = useLyricsStore.getState();
      assert.strictEqual(state.isLoading, false, 'Loading must be false after completion');
      assert.strictEqual(state.error, null, 'Error must be null when InnerTube fallback succeeds');
      assert.ok(state.lyricsData, 'lyricsData must be populated');
      assert.strictEqual(state.lyricsData.provider, 'innertube', 'Provider must be innertube');
      assert.ok(state.lyricsData.lines.length >= 30);
    });
  });

  // ==========================================================================
  // SUITE 3: ADVERSARIAL TITLE NORMALIZATION & EDGE CASES
  // ==========================================================================
  describe('Suite 3: Adversarial Title Normalization & Boundary Cases', () => {

    test('TC3.1: Heavy stacked noise tags are completely stripped', () => {
      const noisyTitle =
        'Bohemian Rhapsody (Official Music Video) [HD] (Remastered 2021) [4K 60FPS] (Audio) [HQ] (feat. Various Artists)';
      const cleaned = LyricsService.cleanTrackMetadata(noisyTitle, 'Queen - Topic');

      assert.strictEqual(cleaned.title, 'Bohemian Rhapsody');
      assert.strictEqual(cleaned.artist, 'Queen');
    });

    test('TC3.2: Hyphenated suffix patterns handled before artist split', () => {
      const t1 = LyricsService.cleanTrackMetadata('Radioactive - Official Music Video', 'Imagine Dragons');
      assert.strictEqual(t1.title, 'Radioactive');
      assert.strictEqual(t1.artist, 'Imagine Dragons');

      const t2 = LyricsService.cleanTrackMetadata('Comfortably Numb - 2011 Remastered Version', 'Pink Floyd');
      assert.strictEqual(t2.title, 'Comfortably Numb');
      assert.strictEqual(t2.artist, 'Pink Floyd');

      const t3 = LyricsService.cleanTrackMetadata('Hotel California - Live On MTV / 1994', 'Eagles');
      assert.strictEqual(t3.title, 'Hotel California');
      assert.strictEqual(t3.artist, 'Eagles');
    });

    test('TC3.3: Artist - Title splitting with edge case permutations', () => {
      // Split when artist is absent
      const t1 = LyricsService.cleanTrackMetadata('Daft Punk - Get Lucky');
      assert.strictEqual(t1.artist, 'Daft Punk');
      assert.strictEqual(t1.title, 'Get Lucky');

      // Split when artist is "Unknown Artist"
      const t2 = LyricsService.cleanTrackMetadata('Nirvana - Smells Like Teen Spirit', 'Unknown Artist');
      assert.strictEqual(t2.artist, 'Nirvana');
      assert.strictEqual(t2.title, 'Smells Like Teen Spirit');

      // Split when artist is case-insensitively identical to p0
      const t3 = LyricsService.cleanTrackMetadata('coldplay - yellow', 'Coldplay');
      assert.strictEqual(t3.artist, 'coldplay');
      assert.strictEqual(t3.title, 'yellow');

      // Multiple hyphens should NOT break or crash
      const t4 = LyricsService.cleanTrackMetadata('Artist - Title - Part 2 - Extra');
      assert.ok(t4.title.length > 0);
    });

    test('TC3.4: International scripts and RTL titles preserved cleanly', () => {
      // Japanese title with audio tag
      const cjk = LyricsService.cleanTrackMetadata('First Love (Audio)', '宇多田ヒカル - Topic');
      assert.strictEqual(cjk.title, 'First Love');
      assert.strictEqual(cjk.artist, '宇多田ヒカル');

      // Arabic RTL title with clip tag
      const rtl = LyricsService.cleanTrackMetadata('نسّم علينا الهوا (Official Video)', 'فيروز');
      assert.strictEqual(rtl.title, 'نسّم علينا الهوا');
      assert.strictEqual(rtl.artist, 'فيروز');

      // Hebrew title
      const heb = LyricsService.cleanTrackMetadata('שיר השלום (Official Audio)', 'מירי אלוני');
      assert.strictEqual(heb.title, 'שיר השלום');
      assert.strictEqual(heb.artist, 'מירי אלוני');
    });

    test('TC3.5: Null, undefined, empty, and whitespace-only inputs do not crash', () => {
      assert.deepStrictEqual(LyricsService.cleanTrackMetadata(''), { title: '', artist: '' });
      assert.deepStrictEqual(LyricsService.cleanTrackMetadata('   '), { title: '', artist: '' });
      assert.deepStrictEqual(LyricsService.cleanTrackMetadata(null, undefined), { title: '', artist: '' });
      assert.deepStrictEqual(LyricsService.cleanTrackMetadata('Only Title'), { title: 'Only Title', artist: '' });
    });
  });

  // ==========================================================================
  // SUITE 4: CONCURRENCY, DEDUPLICATION, AND LRU CACHE INTEGRITY
  // ==========================================================================
  describe('Suite 4: Concurrency, Deduplication & Cache Integrity', () => {

    test('TC4.1: High-concurrency in-flight deduplication (25 concurrent calls)', async () => {
      let networkFetchCount = 0;
      globalThis.fetch = async (url, opts) => {
        const urlStr = String(url);
        if (urlStr.includes('lrclib.net')) {
          networkFetchCount++;
          // Simulate 50ms network flight time
          await new Promise((r) => setTimeout(r, 50));
        }
        return originalFetch(url, opts);
      };

      const calls = Array.from({ length: 25 }, () =>
        LyricsService.fetchLyrics(
          'BjC0KUxiMhc',
          'Ode To The Mets',
          'The Strokes'
        )
      );

      const results = await Promise.all(calls);

      // Verify all 25 callers received the exact same result object reference
      const first = results[0];
      assert.ok(first !== null);
      for (let i = 1; i < results.length; i++) {
        assert.strictEqual(results[i], first, `Caller ${i} must receive identical instance reference`);
      }

      // Network fetch must have been deduplicated (only 1 exact GET, not 25)
      assert.strictEqual(networkFetchCount, 1, `Expected exactly 1 network fetch, but got ${networkFetchCount}`);
    });

    test('TC4.2: Bounded LRU cache capacity enforcement (MAX_CACHE_SIZE = 100)', async () => {
      LyricsService.clearCache();

      // Preload 105 mock entries into the cache
      for (let i = 0; i < 105; i++) {
        // Mock fetch response for distinct titles
        globalThis.fetch = async () => {
          return new Response(JSON.stringify({
            syncedLyrics: `[00:01.00] Line for song ${i}\n[00:05.00] End line ${i}`,
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        };

        await LyricsService.fetchLyrics(`song_${i}`, `Title ${i}`, `Artist ${i}`);
      }

      // Cache size must NEVER exceed 100
      assert.strictEqual(LyricsService.getCacheSize(), 100, `Cache size must be capped at 100, got ${LyricsService.getCacheSize()}`);
    });

    test('TC4.3: useLyricsStore out-of-order race condition immunity', async () => {
      const store = useLyricsStore.getState();

      let resolveSlowTrack;
      const slowPromise = new Promise((resolve) => {
        resolveSlowTrack = resolve;
      });

      // Track A (Slow: resolves after 150ms)
      const trackA = { id: 'track_A', videoId: 'track_A', title: 'Slow Song A', artist: 'Artist A' };
      // Track B (Fast: resolves instantly)
      const trackB = { id: 'track_B', videoId: 'track_B', title: 'Fast Song B', artist: 'Artist B' };

      // Mock fetch: track_A waits for slowPromise, track_B resolves immediately
      globalThis.fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('Slow%20Song%20A') || urlStr.includes('track_A')) {
          await slowPromise;
          return new Response(JSON.stringify({
            syncedLyrics: '[00:01.00] Lyrics for Track A\n[00:05.00] End Track A',
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({
          syncedLyrics: '[00:01.00] Lyrics for Track B\n[00:05.00] End Track B',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };

      // 1. User starts loading Track A
      const pA = store.fetchLyricsForTrack(trackA);
      assert.strictEqual(useLyricsStore.getState().currentTrackId, 'track_A');
      assert.strictEqual(useLyricsStore.getState().isLoading, true);

      // 2. User quickly switches to Track B before Track A resolves
      const pB = store.fetchLyricsForTrack(trackB);
      assert.strictEqual(useLyricsStore.getState().currentTrackId, 'track_B');

      await pB;
      assert.strictEqual(useLyricsStore.getState().currentTrackId, 'track_B');
      assert.strictEqual(useLyricsStore.getState().lyricsData?.lines[0].text, 'Lyrics for Track B');

      // 3. Now Track A finishes delayed
      resolveSlowTrack(null);
      await pA;

      // Track A must NOT overwrite Track B
      const finalState = useLyricsStore.getState();
      assert.strictEqual(finalState.currentTrackId, 'track_B', 'currentTrackId must remain track_B');
      assert.strictEqual(finalState.lyricsData?.lines[0].text, 'Lyrics for Track B', 'lyricsData must remain Track B');
    });
  });

  // ==========================================================================
  // SUITE 5: SYLLABLE LYRICS ENGINE DOM EFFECT LIFECYCLE (M2-UI-01)
  // ==========================================================================
  describe('Suite 5: SyllableLyricsEngine DOM Effect Lifecycle (M2-UI-01)', () => {

    test('TC5.1: SyllableLyricsEngine attaches scrollend listener upon isLoading transitioning to false', async () => {
      const fs = await import('node:fs');
      const engineCode = fs.readFileSync('src/ui/player/SyllableLyricsEngine.tsx', 'utf8');

      // 1. Verify useEffect dependency array contains [isLoading, lyricsData]
      const effectMatch = engineCode.match(/container\.addEventListener\('scrollend',\s*handleScrollEnd\);[\s\S]*?\}, \[(.*?)\]\);/);
      assert.ok(effectMatch, 'Must find useEffect for scrollend');
      const deps = effectMatch[1].split(',').map((s) => s.trim());
      assert.ok(deps.includes('isLoading'), 'Dependency array must include isLoading');
      assert.ok(deps.includes('lyricsData'), 'Dependency array must include lyricsData');

      // 2. Verify cleanup calls removeEventListener
      assert.ok(
        engineCode.includes("container.removeEventListener('scrollend', handleScrollEnd)"),
        'Cleanup function must remove scrollend event listener'
      );

      // 3. Verify early returns occur before <div ref={containerRef}>
      const containerIdx = engineCode.indexOf('ref={containerRef}');
      const earlyReturnLoadingIdx = engineCode.indexOf('if (isLoading)');
      const earlyReturnEmptyIdx = engineCode.indexOf('if (!lyricsData || !lyricsData.lines');

      assert.ok(earlyReturnLoadingIdx < containerIdx, 'if (isLoading) early return must precede containerRef JSX');
      assert.ok(earlyReturnEmptyIdx < containerIdx, 'if (!lyricsData) early return must precede containerRef JSX');
    });
  });
});
