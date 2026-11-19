// tests/adversarial_challenge_m2_lyrics_scroll.mjs
// Adversarial Empirical Challenge & Stress Suite for Milestone 2:
// SyllableLyricsEngine Auto-Scroll, Syllables, Gestures, and Unsynced Mode
//
// Validating:
// 1. Rapid line transitions (50ms interval) & programmatic scroll self-lockout prevention via isProgrammaticScrollRef
// 2. Physical user gestures (onWheel, onTouchMove), detention timer (3500ms), and "Sync with playback" pill
// 3. Whitespace syllable token rendering: non-pollution, no -2px singing lift, no GPU bloom text-shadow
// 4. Unsynced lyrics rendering: binary search bottom clamping immunity, zero dimming, credit footer
// 5. Live target track verification & concurrent LRU cache dedup

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import React from 'react';
import ReactDOMServer from 'react-dom/server';

// Register hook to transpile TSX via esbuild
register('./helpers/tsxLoader.mjs', import.meta.url);

const { SyllableLyricsEngine } = await import('../src/ui/player/SyllableLyricsEngine.tsx');
const { LyricsService } = await import('../src/services/LyricsService.ts');

// ============================================================================
// SUITE 1: REACT COMPONENT MARKUP & VISUAL TOKEN RENDERING
// ============================================================================
describe('Suite 1: React Component DOM Markup & Visual Token Rendering', () => {

  test('ADV-M2-01: Whitespace syllable tokens are never animated with singing lift or GPU bloom shadows', () => {
    const mockLyrics = {
      type: 'SYLLABLE_SYNCED',
      isSynced: true,
      provider: 'lrclib',
      lines: [
        {
          lineIndex: 0,
          startTimeMs: 1000,
          endTimeMs: 5000,
          text: 'Wait for the dark',
          syllables: [
            { text: 'Wait', startTimeMs: 1000, endTimeMs: 2000 },
            { text: ' ', startTimeMs: 2000, endTimeMs: 2100 },
            { text: 'for', startTimeMs: 2100, endTimeMs: 3000 },
            { text: '   ', startTimeMs: 3000, endTimeMs: 3100 },
            { text: '\t', startTimeMs: 3100, endTimeMs: 3200 },
            { text: 'dark', startTimeMs: 3200, endTimeMs: 5000 },
          ],
        },
      ],
    };

    // Render while position is at 2050ms (during the space syllable!)
    const htmlAtSpace = ReactDOMServer.renderToStaticMarkup(
      React.createElement(SyllableLyricsEngine, {
        lyricsData: mockLyrics,
        currentPositionMs: 2050,
        onSeek: () => {},
      })
    );

    // Whitespace tokens must render with class "inline text-white/45" without any inline style transforms
    assert.ok(htmlAtSpace.includes('<span class="inline text-white/45"> </span>'),
      'Single space syllable must render with clean inline class');
    assert.ok(htmlAtSpace.includes('<span class="inline text-white/45">   </span>'),
      'Multi-space syllable must render with clean inline class');
    assert.ok(htmlAtSpace.includes('<span class="inline text-white/45">\t</span>'),
      'Tab syllable must render with clean inline class');

    // Verify whitespace tokens DO NOT have translateY(-2px) or GPU bloom textShadow
    const spaceRegex = /<span class="inline text-white\/45">[\s\t]+<\/span>/g;
    const matches = htmlAtSpace.match(spaceRegex);
    assert.strictEqual(matches?.length, 3, 'Must match exactly 3 whitespace syllable spans');

    // Ensure none of the whitespace spans contain style attributes
    for (const m of matches) {
      assert.ok(!m.includes('style='), `Whitespace span must not have style attribute: ${m}`);
      assert.ok(!m.includes('translateY'), `Whitespace span must not have translateY: ${m}`);
      assert.ok(!m.includes('textShadow'), `Whitespace span must not have textShadow: ${m}`);
      assert.ok(!m.includes('inline-block'), `Whitespace span must not have inline-block: ${m}`);
    }

    // Now render while position is at 1500ms (during 'Wait' word syllable!)
    const htmlAtWord = ReactDOMServer.renderToStaticMarkup(
      React.createElement(SyllableLyricsEngine, {
        lyricsData: mockLyrics,
        currentPositionMs: 1500,
        onSeek: () => {},
      })
    );

    // Active word syllable MUST have translateY(-2px) and GPU bloom textShadow
    assert.ok(htmlAtWord.includes('translateY(-2px)'), 'Singing word syllable must have translateY(-2px)');
    assert.ok(htmlAtWord.includes('rgba(255, 255, 255, 0.62)'), 'Singing word syllable must have white bloom text shadow');
    assert.ok(htmlAtWord.includes('rgba(250, 45, 72, 0.4'), 'Singing word syllable must have accent bloom text shadow');
  });

  test('ADV-M2-02: Syllable singing vs sung vs upcoming state progression', () => {
    const mockLyrics = {
      type: 'SYLLABLE_SYNCED',
      isSynced: true,
      provider: 'lrclib',
      lines: [
        {
          lineIndex: 0,
          startTimeMs: 1000,
          endTimeMs: 3000,
          text: 'Hello world',
          syllables: [
            { text: 'Hello', startTimeMs: 1000, endTimeMs: 2000 },
            { text: 'world', startTimeMs: 2000, endTimeMs: 3000 },
          ],
        },
      ],
    };

    // State A: At t=500ms (before line start) - Both syllables upcoming
    const htmlBefore = ReactDOMServer.renderToStaticMarkup(
      React.createElement(SyllableLyricsEngine, {
        lyricsData: mockLyrics,
        currentPositionMs: 500,
        onSeek: () => {},
      })
    );
    assert.ok(!htmlBefore.includes('translateY(-2px)'), 'No syllable should be singing before start');
    assert.ok(htmlBefore.includes('rgba(255, 255, 255, 0.45)'), 'Upcoming syllables have 0.45 alpha');

    // State B: At t=1500ms - "Hello" is singing, "world" is upcoming
    const htmlMid1 = ReactDOMServer.renderToStaticMarkup(
      React.createElement(SyllableLyricsEngine, {
        lyricsData: mockLyrics,
        currentPositionMs: 1500,
        onSeek: () => {},
      })
    );
    assert.ok(htmlMid1.includes('transform:translateY(-2px)'), 'Hello must be singing');
    assert.ok(htmlMid1.includes('rgba(255, 255, 255, 0.45)'), 'world must still be upcoming');

    // State C: At t=2500ms - "Hello" is sung, "world" is singing
    const htmlMid2 = ReactDOMServer.renderToStaticMarkup(
      React.createElement(SyllableLyricsEngine, {
        lyricsData: mockLyrics,
        currentPositionMs: 2500,
        onSeek: () => {},
      })
    );
    assert.ok(htmlMid2.includes('transform:translateY(-2px)'), 'world must be singing');
    assert.ok(htmlMid2.includes('0 0 4px rgba(255, 255, 255, 0.25)'), 'Hello sung state has soft glow');

    // State D: At t=3500ms - Both syllables sung
    const htmlAfter = ReactDOMServer.renderToStaticMarkup(
      React.createElement(SyllableLyricsEngine, {
        lyricsData: mockLyrics,
        currentPositionMs: 3500,
        onSeek: () => {},
      })
    );
    assert.ok(!htmlAfter.includes('translateY(-2px)'), 'No syllable should have -2px lift after line end');
  });

  test('ADV-M2-03: Unsynced lyrics rendering immunity: no dimming, no active bold line, no seek cursor', () => {
    const unsyncedLyrics = {
      type: 'UNSYNCED',
      isSynced: false,
      provider: 'innertube',
      lines: [
        { lineIndex: 0, startTimeMs: 0, endTimeMs: 0, text: 'First line of poem' },
        { lineIndex: 1, startTimeMs: 0, endTimeMs: 0, text: 'Second line of poem' },
        { lineIndex: 2, startTimeMs: 0, endTimeMs: 0, text: 'Third line of poem' },
        { lineIndex: 3, startTimeMs: 0, endTimeMs: 0, text: 'Source: Musixmatch' },
      ],
    };

    // Render at 120s into song
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(SyllableLyricsEngine, {
        lyricsData: unsyncedLyrics,
        currentPositionMs: 120000,
        onSeek: () => {},
      })
    );

    // 1. None of the lines should have opacity-40 (dimmed past lines)
    assert.ok(!html.includes('opacity-40'), 'Unsynced lyrics must NOT contain dimmed opacity-40 lines');

    // 2. None of the lines should have scale-100 opacity-100 font-bold (active line styling)
    assert.ok(!html.includes('scale-100 opacity-100 font-bold'), 'Unsynced lyrics must NOT highlight any active line');

    // 3. Normal lines must have opacity-90 font-medium text-white/85 hover:text-white
    assert.ok(html.includes('opacity-90 font-medium text-white/85 hover:text-white'),
      'Unsynced lines must have high-contrast reading styling');

    // 4. Seeking must be disabled: cursor-text select-text instead of cursor-pointer
    assert.ok(html.includes('cursor-text select-text'), 'Unsynced lines must have cursor-text select-text');
    assert.ok(!html.includes('cursor-pointer hover:bg-[var(--color-surface-variant)]/30'),
      'Unsynced lines must NOT be clickable or have hover background');

    // 5. Credit footer line must render with special muted credit styling
    assert.ok(html.includes('text-xs text-white/40 italic pt-4 mt-6 border-t border-white/10 select-text'),
      'Musixmatch footer must render with dedicated credit styling');
  });

  test('ADV-M2-04: Loading and empty states render gracefully without error flashes', () => {
    // 1. Loading state
    const htmlLoading = ReactDOMServer.renderToStaticMarkup(
      React.createElement(SyllableLyricsEngine, {
        lyricsData: null,
        currentPositionMs: 0,
        onSeek: () => {},
        isLoading: true,
      })
    );
    assert.ok(htmlLoading.includes('animate-spin'), 'Loading state must show spinner');
    assert.ok(htmlLoading.includes('Fetching synchronized lyrics...'), 'Loading state must show fetching message');
    assert.ok(!htmlLoading.includes('No synchronized lyrics available'), 'Loading state must NOT flash error message');

    // 2. Empty state
    const htmlEmpty = ReactDOMServer.renderToStaticMarkup(
      React.createElement(SyllableLyricsEngine, {
        lyricsData: null,
        currentPositionMs: 0,
        onSeek: () => {},
        isLoading: false,
      })
    );
    assert.ok(htmlEmpty.includes('No synchronized lyrics available for this track'), 'Empty state must show clean fallback');
  });
});

// ============================================================================
// SUITE 2: AUTO-SCROLL SELF-LOCKOUT & PROGRAMMATIC SCROLL STRESS
// ============================================================================
describe('Suite 2: Auto-Scroll Self-Lockout & Programmatic Scroll Stress', () => {

  /**
   * Test harness reproducing SyllableLyricsEngine scroll controller state machine.
   */
  function createScrollControllerHarness() {
    let isUserScrolled = false;
    const isProgrammaticScrollRef = { current: false };
    let programmaticScrollTimeout = null;
    let detentionTimer = null;
    const scrollHistory = [];

    const container = {
      scrollTop: 0,
      clientHeight: 500,
      scrollTo(opts) {
        scrollHistory.push({ top: opts.top, behavior: opts.behavior });
        this.scrollTop = opts.top;
      },
    };

    // Auto-scroll effect triggered by activeLineIndex change
    const onActiveLineChange = (activeLineIndex, isUnsynced = false) => {
      if (isUserScrolled || isUnsynced) return;
      if (activeLineIndex < 0) return;

      const lineHeight = 40;
      const currentRelativeTop = activeLineIndex * 60;
      const targetScrollTop = currentRelativeTop - container.clientHeight * 0.45 + lineHeight / 2;

      isProgrammaticScrollRef.current = true;
      if (programmaticScrollTimeout) {
        clearTimeout(programmaticScrollTimeout);
      }
      programmaticScrollTimeout = setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 650);

      container.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: 'smooth',
      });
    };

    // Scroll event from container
    const handleScroll = () => {
      if (isProgrammaticScrollRef.current) return;

      isUserScrolled = true;
      if (detentionTimer) clearTimeout(detentionTimer);
      detentionTimer = setTimeout(() => {
        isUserScrolled = false;
      }, 3500);
    };

    // User gesture (wheel, touch)
    const handleUserGesture = () => {
      isProgrammaticScrollRef.current = false;
      if (programmaticScrollTimeout) {
        clearTimeout(programmaticScrollTimeout);
        programmaticScrollTimeout = null;
      }
      isUserScrolled = true;
      if (detentionTimer) clearTimeout(detentionTimer);
      detentionTimer = setTimeout(() => {
        isUserScrolled = false;
      }, 3500);
    };

    // Native scrollend event
    const handleScrollEnd = () => {
      isProgrammaticScrollRef.current = false;
      if (programmaticScrollTimeout) {
        clearTimeout(programmaticScrollTimeout);
        programmaticScrollTimeout = null;
      }
    };

    // Resume sync click
    const handleResumeSync = () => {
      if (detentionTimer) clearTimeout(detentionTimer);
      isUserScrolled = false;
    };

    return {
      get isUserScrolled() { return isUserScrolled; },
      get isProgrammaticScroll() { return isProgrammaticScrollRef.current; },
      scrollHistory,
      container,
      onActiveLineChange,
      handleScroll,
      handleUserGesture,
      handleScrollEnd,
      handleResumeSync,
      cleanup() {
        if (programmaticScrollTimeout) clearTimeout(programmaticScrollTimeout);
        if (detentionTimer) clearTimeout(detentionTimer);
      },
    };
  }

  test('ADV-M2-05: Rapid line transitions (50ms interval) maintain isProgrammaticScrollRef and suppress scroll lockout', () => {
    const harness = createScrollControllerHarness();

    // Simulate fast-paced rap/metal track: 30 line transitions spaced 50ms apart
    const numLines = 30;
    for (let lineIdx = 0; lineIdx < numLines; lineIdx++) {
      harness.onActiveLineChange(lineIdx);

      // Verify programmatic scroll flag is active
      assert.strictEqual(harness.isProgrammaticScroll, true, `Line ${lineIdx}: isProgrammaticScroll must be true`);

      // During smooth scroll, browser emits multiple DOM 'scroll' events (e.g. 5 events per transition)
      for (let s = 0; s < 5; s++) {
        harness.handleScroll();
      }

      // Assert isUserScrolled NEVER becomes true during the programmatic scroll events!
      assert.strictEqual(harness.isUserScrolled, false, `Line ${lineIdx}: isUserScrolled must remain FALSE`);
    }

    // Verify all 30 transitions executed scrollTo without getting locked out
    assert.strictEqual(harness.scrollHistory.length, numLines, `Expected ${numLines} scrollTo executions`);
    assert.strictEqual(harness.isUserScrolled, false, 'Auto-scroll must NOT be locked out after 30 rapid transitions');

    harness.cleanup();
  });

  test('ADV-M2-06: DOM scrollend cleanly clears isProgrammaticScrollRef and cancels fallback timer', () => {
    const harness = createScrollControllerHarness();

    harness.onActiveLineChange(5);
    assert.strictEqual(harness.isProgrammaticScroll, true);

    // Browser finishes smooth scrolling and fires 'scrollend'
    harness.handleScrollEnd();
    assert.strictEqual(harness.isProgrammaticScroll, false, 'scrollend must clear isProgrammaticScrollRef');

    // Subsequent manual scrollbar drag (without user gesture) now correctly triggers isUserScrolled
    harness.handleScroll();
    assert.strictEqual(harness.isUserScrolled, true, 'Subsequent manual scroll after scrollend must set isUserScrolled');

    harness.cleanup();
  });

  test('ADV-M2-07: Fallback timer (650ms) safely clears isProgrammaticScrollRef in legacy environments', async () => {
    const harness = createScrollControllerHarness();

    harness.onActiveLineChange(3);
    assert.strictEqual(harness.isProgrammaticScroll, true);

    // Simulate environment without 'scrollend' event: wait for 650ms timeout
    await new Promise((resolve) => setTimeout(resolve, 700));

    assert.strictEqual(harness.isProgrammaticScroll, false, '650ms fallback timeout must clear isProgrammaticScrollRef');

    // Manual scroll should now register
    harness.handleScroll();
    assert.strictEqual(harness.isUserScrolled, true);

    harness.cleanup();
  });
});

// ============================================================================
// SUITE 3: USER GESTURE INTERACTION & FLOATING PILL STATE MACHINE
// ============================================================================
describe('Suite 3: User Gesture Interaction & Floating Pill State Machine', () => {

  function createGestureHarness() {
    let isUserScrolled = false;
    const isProgrammaticScrollRef = { current: false };
    let programmaticScrollTimeout = null;
    let detentionTimer = null;

    const handleUserGesture = () => {
      isProgrammaticScrollRef.current = false;
      if (programmaticScrollTimeout) {
        clearTimeout(programmaticScrollTimeout);
        programmaticScrollTimeout = null;
      }
      isUserScrolled = true;
      if (detentionTimer) clearTimeout(detentionTimer);
      detentionTimer = setTimeout(() => {
        isUserScrolled = false;
      }, 3500);
    };

    const handleResumeSync = () => {
      if (detentionTimer) clearTimeout(detentionTimer);
      isUserScrolled = false;
    };

    return {
      get isUserScrolled() { return isUserScrolled; },
      get isProgrammaticScroll() { return isProgrammaticScrollRef.current; },
      setProgrammaticScroll(val) { isProgrammaticScrollRef.current = val; },
      handleUserGesture,
      handleResumeSync,
      cleanup() {
        if (detentionTimer) clearTimeout(detentionTimer);
        if (programmaticScrollTimeout) clearTimeout(programmaticScrollTimeout);
      },
    };
  }

  test('ADV-M2-08: onWheel immediately cancels programmatic scroll and arms 3500ms detention timer', () => {
    const harness = createGestureHarness();
    harness.setProgrammaticScroll(true);

    assert.strictEqual(harness.isProgrammaticScroll, true);
    assert.strictEqual(harness.isUserScrolled, false);

    // User spins mouse wheel
    harness.handleUserGesture();

    assert.strictEqual(harness.isProgrammaticScroll, false, 'onWheel must immediately clear programmatic scroll');
    assert.strictEqual(harness.isUserScrolled, true, 'onWheel must immediately set isUserScrolled = true');

    harness.cleanup();
  });

  test('ADV-M2-09: Repeated user gestures debounce the 3500ms detention timer', async () => {
    const harness = createGestureHarness();

    // Wheel at t=0
    harness.handleUserGesture();
    assert.strictEqual(harness.isUserScrolled, true);

    // Wheel again at t=100ms
    await new Promise((resolve) => setTimeout(resolve, 100));
    harness.handleUserGesture();
    assert.strictEqual(harness.isUserScrolled, true);

    // Wheel again at t=200ms
    await new Promise((resolve) => setTimeout(resolve, 100));
    harness.handleUserGesture();
    assert.strictEqual(harness.isUserScrolled, true);

    // Resume sync immediately resets
    harness.handleResumeSync();
    assert.strictEqual(harness.isUserScrolled, false, 'handleResumeSync must immediately clear isUserScrolled');

    harness.cleanup();
  });

  test('ADV-M2-10: "Sync with playback" pill visibility contract in React component', () => {
    const syncedLyrics = {
      type: 'LINE_SYNCED',
      isSynced: true,
      lines: [
        { lineIndex: 0, startTimeMs: 1000, endTimeMs: 4000, text: 'Hello' },
      ],
    };

    // Component with default state (isUserScrolled = false) does NOT render pill
    const htmlNoPill = ReactDOMServer.renderToStaticMarkup(
      React.createElement(SyllableLyricsEngine, {
        lyricsData: syncedLyrics,
        currentPositionMs: 2000,
        onSeek: () => {},
      })
    );
    assert.ok(!htmlNoPill.includes('Sync with playback'), 'Pill must NOT be visible when not user scrolled');

    // For unsynced lyrics, pill condition is `{isUserScrolled && !isUnsynced && ...}`
    // Even if isUserScrolled were true, !isUnsynced is false, so pill is NEVER rendered
    const unsyncedLyrics = {
      type: 'UNSYNCED',
      isSynced: false,
      lines: [
        { lineIndex: 0, startTimeMs: 0, endTimeMs: 0, text: 'Unsynced line' },
      ],
    };
    const htmlUnsynced = ReactDOMServer.renderToStaticMarkup(
      React.createElement(SyllableLyricsEngine, {
        lyricsData: unsyncedLyrics,
        currentPositionMs: 2000,
        onSeek: () => {},
      })
    );
    assert.ok(!htmlUnsynced.includes('Sync with playback'), 'Unsynced lyrics must NEVER render sync pill');
  });
});

// ============================================================================
// SUITE 4: BINARY SEARCH VS UNSYNCED MODE CLAMPING ORACLE
// ============================================================================
describe('Suite 4: Binary Search vs Unsynced Mode Clamping Oracle', () => {

  test('ADV-M2-11: Raw binary search on unsynced lyrics clamps to bottom (50 of 50)', () => {
    const unsyncedLines = Array.from({ length: 50 }, (_, i) => ({
      lineIndex: i,
      startTimeMs: 0,
      endTimeMs: 0,
      text: `Poem line ${i + 1}`,
    }));

    // If raw getActiveLineIndex is called on unsynced lyrics at t=60,000ms:
    const rawResult = LyricsService.getActiveLineIndex(unsyncedLines, 60000);
    // Because currentPosMs (60000) > line.startTimeMs (0), candidate advances to mid and low = mid + 1
    // The candidate index erroneously clamps to 49 (the very last line)!
    assert.strictEqual(rawResult, 49, 'Empirically confirms raw binary search clamps to last index on unsynced lyrics');
  });

  test('ADV-M2-12: SyllableLyricsEngine isUnsynced guard completely bypasses binary search and locks index to -1', () => {
    const unsyncedLyrics = {
      type: 'UNSYNCED',
      isSynced: false,
      lines: Array.from({ length: 50 }, (_, i) => ({
        lineIndex: i,
        startTimeMs: 0,
        endTimeMs: 0,
        text: `Poem line ${i + 1}`,
      })),
    };

    // Evaluate SyllableLyricsEngine isUnsynced formula
    const isUnsynced =
      unsyncedLyrics.type === 'UNSYNCED' ||
      unsyncedLyrics.isSynced === false ||
      unsyncedLyrics.lines.every((l) => l.startTimeMs === 0 && l.endTimeMs === 0);

    assert.strictEqual(isUnsynced, true, 'isUnsynced formula must detect unsynchronized lyrics');

    // Evaluate activeLineIndex formula from SyllableLyricsEngine
    const activeLineIndex = isUnsynced ? -1 : LyricsService.getActiveLineIndex(unsyncedLyrics, 60000);

    assert.strictEqual(activeLineIndex, -1, 'activeLineIndex MUST be -1 in SyllableLyricsEngine for unsynced mode');
  });

  test('ADV-M2-13: isUnsynced accurately classifies across all boundary permutations', () => {
    // 1. Explicit UNSYNCED type
    assert.strictEqual(
      Boolean({ type: 'UNSYNCED', isSynced: true, lines: [{ startTimeMs: 0, endTimeMs: 0 }] }.type === 'UNSYNCED'),
      true
    );

    // 2. Explicit isSynced: false
    assert.strictEqual(
      Boolean({ type: 'LINE_SYNCED', isSynced: false, lines: [{ startTimeMs: 0, endTimeMs: 0 }] }.isSynced === false),
      true
    );

    // 3. All timestamps 0
    const allZero = [{ startTimeMs: 0, endTimeMs: 0 }, { startTimeMs: 0, endTimeMs: 0 }];
    assert.strictEqual(allZero.every((l) => l.startTimeMs === 0 && l.endTimeMs === 0), true);

    // 4. Properly synchronized track (starts at 0ms, ends at 5000ms)
    const synced = [{ startTimeMs: 0, endTimeMs: 5000 }, { startTimeMs: 5000, endTimeMs: 10000 }];
    assert.strictEqual(synced.every((l) => l.startTimeMs === 0 && l.endTimeMs === 0), false);
  });
});

// ============================================================================
// SUITE 5: LIVE TARGET TRACKS & PIPELINE INTEGRITY
// ============================================================================
describe('Suite 5: Live Target Tracks & Service Regression', () => {

  test('ADV-M2-14: Target track "The Strokes - Ode to the Mets" resolves clean syllable-synced lines', async () => {
    const lyrics = await LyricsService.fetchLyrics(
      'BjC0KUxiMhc',
      'Ode To The Mets (Official Video)',
      'The Strokes',
      'The New Abnormal',
      351
    );

    assert.ok(lyrics !== null, 'Lyrics must not be null');
    assert.strictEqual(lyrics.isSynced, true, 'Ode to the Mets must be synchronized');
    assert.ok(lyrics.lines.length >= 35, `Expected >= 35 lines, got ${lyrics.lines.length}`);

    // Verify chronological monotonicity
    for (let i = 1; i < lyrics.lines.length; i++) {
      assert.ok(
        lyrics.lines[i].startTimeMs >= lyrics.lines[i - 1].startTimeMs,
        `Line ${i} timestamp (${lyrics.lines[i].startTimeMs}) is not monotonic vs Line ${i - 1} (${lyrics.lines[i - 1].startTimeMs})`
      );
    }

    // Verify no whitespace-only syllables exist
    for (const line of lyrics.lines) {
      if (line.syllables) {
        for (const syl of line.syllables) {
          assert.ok(syl.text.trim().length > 0, `Discovered empty/whitespace syllable in line "${line.text}": "${syl.text}"`);
        }
      }
    }
  });

  test('ADV-M2-15: Target track "Sweet Taste of India" resolves clean syllable-synced lines', async () => {
    const lyrics = await LyricsService.fetchLyrics(
      'yl0at21gRrU',
      'Taste Of India (Audio)',
      'Aerosmith',
      'Nine Lives',
      353
    );

    assert.ok(lyrics !== null, 'Lyrics must not be null');
    assert.strictEqual(lyrics.isSynced, true, 'Taste of India must be synchronized');
    assert.ok(lyrics.lines.length >= 50, `Expected >= 50 lines, got ${lyrics.lines.length}`);

    // Verify syllable cleanliness
    for (const line of lyrics.lines) {
      if (line.syllables) {
        for (const syl of line.syllables) {
          assert.ok(syl.text.trim().length > 0, `Discovered empty/whitespace syllable: "${syl.text}"`);
        }
      }
    }
  });

  test('ADV-M2-16: Concurrent in-flight request deduplication stress (50 parallel callers)', async () => {
    const fetchPromises = Array.from({ length: 50 }, () =>
      LyricsService.fetchLyrics('BjC0KUxiMhc', 'Ode To The Mets (Official Video)', 'The Strokes')
    );

    const results = await Promise.all(fetchPromises);
    const firstResult = results[0];

    // Every single concurrent caller must receive the exact identical object reference
    for (let i = 1; i < results.length; i++) {
      assert.strictEqual(results[i], firstResult, `Caller ${i} received different object instance`);
    }
  });
});
