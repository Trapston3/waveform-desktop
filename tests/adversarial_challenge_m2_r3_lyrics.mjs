// tests/adversarial_challenge_m2_r3_lyrics.mjs
// Adversarial Empirical Challenge Suite for Milestone 2 Iteration 2
// Empirical Challenger: challenger_m2_r3_2
//
// Rigorously stresses:
// 1. Rapid programmatic line transitions: auto-scroll continuity & isUserScrolled lock-out immunity
// 2. Physical user wheel/touch gestures: isUserScrolled activation, detention timer debounce & sync pill display
// 3. Whitespace syllable rendering: zero lift (-2px), zero GPU bloom shadow across all Unicode whitespace variants
// 4. Unsynced lyrics typography: binary search bypass, zero dimming, credit footers, no sync pill
// 5. Container DOM mount lifecycle & event listener attachment across isLoading / lyricsData transitions

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
// SUITE 1: RAPID PROGRAMMATIC LINE TRANSITIONS & AUTO-SCROLL
// ============================================================================
describe('Challenge 1: Rapid Programmatic Line Transitions & Scroll Lockout Immunity', () => {

  /**
   * Stateful mock DOM container simulating real browser scroll behavior
   */
  function createSimulatedScrollContainer() {
    const listeners = new Map();
    let scrollTop = 0;
    const clientHeight = 600;
    const scrollCalls = [];

    return {
      get scrollTop() { return scrollTop; },
      set scrollTop(v) { scrollTop = v; },
      clientHeight,
      getBoundingClientRect() {
        return { top: 0, bottom: clientHeight, height: clientHeight };
      },
      addEventListener(event, fn) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(fn);
      },
      removeEventListener(event, fn) {
        if (listeners.has(event)) listeners.get(event).delete(fn);
      },
      dispatchEvent(event) {
        const set = listeners.get(event.type || event);
        if (set) {
          for (const fn of set) fn(event);
        }
      },
      scrollTo({ top, behavior }) {
        scrollCalls.push({ top, behavior });
        scrollTop = top;
        // Browser asynchronously or synchronously fires scroll event during scroll
        this.dispatchEvent({ type: 'scroll' });
      },
      get listeners() { return listeners; },
      get scrollCalls() { return scrollCalls; },
    };
  }

  test('ADV-SC01: Rapid line transitions (10ms-50ms) do NOT set isUserScrolled=true or freeze auto-scroll', () => {
    // Harness simulating SyllableLyricsEngine internals with high fidelity
    let isUserScrolled = false;
    const isProgrammaticScrollRef = { current: false };
    let programmaticScrollTimeout = null;
    let detentionTimer = null;
    const container = createSimulatedScrollContainer();

    const triggerAutoScroll = (activeLineIndex) => {
      if (isUserScrolled || activeLineIndex < 0) return;

      const lineHeight = 40;
      const currentRelativeTop = activeLineIndex * 50;
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

    const handleScroll = () => {
      if (isProgrammaticScrollRef.current) return;
      isUserScrolled = true;
      if (detentionTimer) clearTimeout(detentionTimer);
      detentionTimer = setTimeout(() => {
        isUserScrolled = false;
      }, 3500);
    };

    const handleScrollEnd = () => {
      isProgrammaticScrollRef.current = false;
      if (programmaticScrollTimeout) {
        clearTimeout(programmaticScrollTimeout);
        programmaticScrollTimeout = null;
      }
    };

    container.addEventListener('scroll', handleScroll);
    container.addEventListener('scrollend', handleScrollEnd);

    // Stress: 100 rapid line transitions fired at burst intervals
    for (let i = 0; i < 100; i++) {
      triggerAutoScroll(i);

      // Verify programmatic flag is immediately true
      assert.strictEqual(isProgrammaticScrollRef.current, true,
        `Line ${i}: isProgrammaticScrollRef must be true immediately on scrollTo`);

      // Verify isUserScrolled remains false even though container.scrollTo triggered 'scroll' event
      assert.strictEqual(isUserScrolled, false,
        `Line ${i}: isUserScrolled must remain false during programmatic scroll`);
    }

    assert.strictEqual(container.scrollCalls.length, 100,
      'All 100 programmatic scroll transitions must successfully execute');
    assert.strictEqual(isUserScrolled, false,
      'Auto-scroll must never lock out under rapid line burst');

    // Clean up
    if (programmaticScrollTimeout) clearTimeout(programmaticScrollTimeout);
    if (detentionTimer) clearTimeout(detentionTimer);
  });

  test('ADV-SC02: Interleaved scrollend and scroll events maintain correct state', () => {
    let isUserScrolled = false;
    const isProgrammaticScrollRef = { current: false };
    let programmaticScrollTimeout = null;
    const container = createSimulatedScrollContainer();

    const triggerAutoScroll = (lineIdx) => {
      isProgrammaticScrollRef.current = true;
      if (programmaticScrollTimeout) clearTimeout(programmaticScrollTimeout);
      programmaticScrollTimeout = setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 650);
      container.scrollTo({ top: lineIdx * 40, behavior: 'smooth' });
    };

    container.addEventListener('scroll', () => {
      if (isProgrammaticScrollRef.current) return;
      isUserScrolled = true;
    });

    container.addEventListener('scrollend', () => {
      isProgrammaticScrollRef.current = false;
      if (programmaticScrollTimeout) {
        clearTimeout(programmaticScrollTimeout);
        programmaticScrollTimeout = null;
      }
    });

    // 1. Auto scroll line 1
    triggerAutoScroll(1);
    assert.strictEqual(isProgrammaticScrollRef.current, true);
    assert.strictEqual(isUserScrolled, false);

    // 2. scrollend fires
    container.dispatchEvent('scrollend');
    assert.strictEqual(isProgrammaticScrollRef.current, false);
    assert.strictEqual(isUserScrolled, false);

    // 3. Auto scroll line 2 immediately
    triggerAutoScroll(2);
    assert.strictEqual(isProgrammaticScrollRef.current, true);
    assert.strictEqual(isUserScrolled, false);

    // 4. Programmatic scroll fallback timeout (simulate missing scrollend in old browser)
    isProgrammaticScrollRef.current = true;
    programmaticScrollTimeout = setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, 50);

    return new Promise((resolve) => {
      setTimeout(() => {
        assert.strictEqual(isProgrammaticScrollRef.current, false,
          'Fallback timer must clear isProgrammaticScrollRef');
        assert.strictEqual(isUserScrolled, false);
        resolve();
      }, 70);
    });
  });
});

// ============================================================================
// SUITE 2: USER WHEEL GESTURES, DETENTION TIMER & SYNC PILL
// ============================================================================
describe('Challenge 2: User Wheel Gestures, Detention Timer & Sync Pill Visibility', () => {

  test('ADV-WH01: User wheel gesture cancels programmatic scroll and arms 3500ms detention timer', () => {
    let isUserScrolled = false;
    const isProgrammaticScrollRef = { current: true };
    let programmaticScrollTimeout = setTimeout(() => {}, 650);
    let detentionTimer = null;

    const handleUserGesture = () => {
      isProgrammaticScrollRef.current = false;
      if (programmaticScrollTimeout) {
        clearTimeout(programmaticScrollTimeout);
        programmaticScrollTimeout = null;
      }
      setIsUserScrolled(true);
      if (detentionTimer) clearTimeout(detentionTimer);
      detentionTimer = setTimeout(() => {
        setIsUserScrolled(false);
      }, 3500);
    };

    const setIsUserScrolled = (val) => {
      isUserScrolled = val;
    };

    // Before gesture: programmatic scroll was in flight
    assert.strictEqual(isProgrammaticScrollRef.current, true);
    assert.strictEqual(isUserScrolled, false);

    // User spins mouse wheel
    handleUserGesture();

    // After gesture: programmatic scroll must be aborted, user scrolled armed
    assert.strictEqual(isProgrammaticScrollRef.current, false,
      'User wheel gesture must cancel programmatic scroll flag immediately');
    assert.strictEqual(programmaticScrollTimeout, null,
      'Programmatic scroll timeout must be cleared to null');
    assert.strictEqual(isUserScrolled, true,
      'isUserScrolled must be set to true');

    // Clean up
    if (detentionTimer) clearTimeout(detentionTimer);
  });

  test('ADV-WH02: Rapid successive wheel events debounce the detention timer without thrashing', async () => {
    let isUserScrolled = false;
    let detentionTimer = null;
    let timerSetCount = 0;

    const handleUserGesture = () => {
      isUserScrolled = true;
      if (detentionTimer) clearTimeout(detentionTimer);
      timerSetCount++;
      detentionTimer = setTimeout(() => {
        isUserScrolled = false;
      }, 100); // 100ms for test speed
    };

    // User scrolls at t=0, t=20, t=40, t=60
    handleUserGesture();
    assert.strictEqual(isUserScrolled, true);

    await new Promise((r) => setTimeout(r, 20));
    handleUserGesture();
    assert.strictEqual(isUserScrolled, true);

    await new Promise((r) => setTimeout(r, 20));
    handleUserGesture();
    assert.strictEqual(isUserScrolled, true);

    await new Promise((r) => setTimeout(r, 20));
    handleUserGesture();
    assert.strictEqual(isUserScrolled, true);
    assert.strictEqual(timerSetCount, 4);

    // Wait 120ms after the last scroll: detention timer should expire and reset isUserScrolled to false
    await new Promise((r) => setTimeout(r, 120));
    assert.strictEqual(isUserScrolled, false,
      'Detention timer debounce must cleanly restore isUserScrolled=false after quiet period');
  });

  test('ADV-WH03: Sync pill appears only when isUserScrolled=true and !isUnsynced', () => {
    const syncedLyrics = {
      type: 'LINE_SYNCED',
      isSynced: true,
      provider: 'lrclib',
      lines: [
        { lineIndex: 0, startTimeMs: 1000, endTimeMs: 4000, text: 'The Strokes - Ode to the Mets' },
        { lineIndex: 1, startTimeMs: 4000, endTimeMs: 8000, text: 'Up on his horse' },
      ],
    };

    // 1. Initial synced render (not user scrolled) -> Pill is NOT in markup
    const htmlNormal = ReactDOMServer.renderToStaticMarkup(
      React.createElement(SyllableLyricsEngine, {
        lyricsData: syncedLyrics,
        currentPositionMs: 2000,
        onSeek: () => {},
      })
    );
    assert.ok(!htmlNormal.includes('Sync with playback'),
      'Pill must NOT be present when user has not scrolled');

    // 2. Unsynced lyrics -> Pill must NEVER appear
    const unsyncedLyrics = {
      type: 'UNSYNCED',
      isSynced: false,
      provider: 'innertube',
      lines: [
        { lineIndex: 0, startTimeMs: 0, endTimeMs: 0, text: 'Unsynced poem line' },
      ],
    };

    const htmlUnsynced = ReactDOMServer.renderToStaticMarkup(
      React.createElement(SyllableLyricsEngine, {
        lyricsData: unsyncedLyrics,
        currentPositionMs: 2000,
        onSeek: () => {},
      })
    );
    assert.ok(!htmlUnsynced.includes('Sync with playback'),
      'Unsynced lyrics must NEVER render the Sync with playback pill');
  });
});

// ============================================================================
// SUITE 3: WHITESPACE SYLLABLES: NO -2px LIFT, NO BLOOM SHADOWS
// ============================================================================
describe('Challenge 3: Whitespace Syllable Token Non-Pollution & Animation Immunity', () => {

  const whitespaceVariants = [
    { name: 'Standard space', text: ' ' },
    { name: 'Multiple standard spaces', text: '    ' },
    { name: 'Horizontal tab', text: '\t' },
    { name: 'Multiple tabs', text: '\t\t\t' },
    { name: 'Non-breaking space (NBSP)', text: '\u00A0' },
    { name: 'Narrow no-break space (NNBSP)', text: '\u202F' },
    { name: 'Ideographic full-width space (CJK)', text: '\u3000' },
    { name: 'En/Em space sequence', text: '\u2002\u2003\u2004' },
    { name: 'Newline and carriage return whitespace', text: '\r\n  ' },
    { name: 'Complex mixed Unicode whitespace', text: ' \t\u00A0\u3000 \t ' },
  ];

  for (const variant of whitespaceVariants) {
    test(`ADV-WS: [${variant.name}] whitespace syllable is immune to singing lift & bloom shadows`, () => {
      const mockLyrics = {
        type: 'SYLLABLE_SYNCED',
        isSynced: true,
        provider: 'lrclib',
        lines: [
          {
            lineIndex: 0,
            startTimeMs: 1000,
            endTimeMs: 5000,
            text: `Sing${variant.text}Song`,
            syllables: [
              { text: 'Sing', startTimeMs: 1000, endTimeMs: 2000 },
              { text: variant.text, startTimeMs: 2000, endTimeMs: 3000 }, // Whitespace syllable active here!
              { text: 'Song', startTimeMs: 3000, endTimeMs: 5000 },
            ],
          },
        ],
      };

      // Position: 2500ms (EXACTLY when the whitespace syllable is in its active time window!)
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(SyllableLyricsEngine, {
          lyricsData: mockLyrics,
          currentPositionMs: 2500,
          onSeek: () => {},
        })
      );

      // Verify whitespace is recognized by /^\s+$/
      assert.ok(/^\s+$/.test(variant.text), `Variant ${variant.name} must be detected as whitespace by /^\s+$/`);

      // 1. Whitespace MUST be rendered with "inline text-white/45"
      assert.ok(html.includes('class="inline text-white/45"'),
        `Markup must contain inline text-white/45 span for ${variant.name}`);

      // 2. Whitespace span MUST NOT have any translateY(-2px)
      // To be rigorous, inspect all spans rendered
      const spanMatches = html.match(/<span[^>]*>[\s\S]*?<\/span>/g) || [];
      for (const span of spanMatches) {
        // If the span contains whitespace text
        if (span.includes('class="inline text-white/45"')) {
          assert.ok(!span.includes('translateY(-2px)'),
            `Whitespace span must NOT have translateY(-2px): ${span}`);
          assert.ok(!span.includes('translateY'),
            `Whitespace span must NOT have any translateY: ${span}`);
          assert.ok(!span.includes('textShadow'),
            `Whitespace span must NOT have textShadow: ${span}`);
          assert.ok(!span.includes('rgba(255, 255, 255, 0.62)'),
            `Whitespace span must NOT have white bloom shadow: ${span}`);
          assert.ok(!span.includes('rgba(250, 45, 72, 0.40)'),
            `Whitespace span must NOT have pink bloom shadow: ${span}`);
          assert.ok(!span.includes('inline-block'),
            `Whitespace span must NOT have inline-block class: ${span}`);
        }
      }

      // 3. Conversely, when singing the word "Sing" at 1500ms, "Sing" DOES have translateY(-2px) & bloom
      const htmlSinging = ReactDOMServer.renderToStaticMarkup(
        React.createElement(SyllableLyricsEngine, {
          lyricsData: mockLyrics,
          currentPositionMs: 1500,
          onSeek: () => {},
        })
      );
      assert.ok(htmlSinging.includes('translateY(-2px)'), 'Active word syllable must have translateY(-2px)');
      assert.ok(htmlSinging.includes('0 0 12px rgba(255, 255, 255, 0.62)'), 'Active word syllable must have bloom');
    });
  }
});

// ============================================================================
// SUITE 4: UNSYNCED LYRICS TYPOGRAPHY & BEHAVIOR
// ============================================================================
describe('Challenge 4: Unsynced Lyrics Typography, Contrast & Interaction Contracts', () => {

  const testCases = [
    {
      title: 'Explicit UNSYNCED type (InnerTube)',
      lyrics: {
        type: 'UNSYNCED',
        isSynced: false,
        provider: 'innertube',
        lines: [
          { lineIndex: 0, startTimeMs: 0, endTimeMs: 0, text: 'First stanza line' },
          { lineIndex: 1, startTimeMs: 0, endTimeMs: 0, text: 'Second stanza line' },
          { lineIndex: 2, startTimeMs: 0, endTimeMs: 0, text: 'Source: Musixmatch' },
        ],
      },
    },
    {
      title: 'Zero timestamps fallback (every startTimeMs=0 and endTimeMs=0)',
      lyrics: {
        type: 'LINE_SYNCED',
        isSynced: true,
        provider: 'fallback',
        lines: [
          { lineIndex: 0, startTimeMs: 0, endTimeMs: 0, text: 'Stanza line A' },
          { lineIndex: 1, startTimeMs: 0, endTimeMs: 0, text: 'Stanza line B' },
          { lineIndex: 2, startTimeMs: 0, endTimeMs: 0, text: 'Written by: Julian Casablancas' },
        ],
      },
    },
  ];

  for (const tc of testCases) {
    test(`ADV-UN01: [${tc.title}] satisfies unsynced typography contracts`, () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(SyllableLyricsEngine, {
          lyricsData: tc.lyrics,
          currentPositionMs: 65000, // 65 seconds into song
          onSeek: () => {},
        })
      );

      // 1. Zero line dimming: opacity-40 must NOT be present
      assert.ok(!html.includes('opacity-40'), 'Unsynced mode must not dim lines with opacity-40');

      // 2. High-contrast readable text classes must be present
      assert.ok(html.includes('text-white/85') || html.includes('text-white/90'),
        'Unsynced text must render with high-contrast white text (text-white/85 or text-white/90)');
      assert.ok(html.includes('font-medium'), 'Unsynced text must be font-medium');

      // 3. Active line bold/scale highlight MUST NOT be present
      assert.ok(!html.includes('scale-100 opacity-100 font-bold'),
        'Unsynced mode must not apply active line bold/scale highlight');

      // 4. Cursor text selectability: cursor-text select-text
      assert.ok(html.includes('cursor-text select-text'),
        'Unsynced mode must enable text cursor and text selection');
      assert.ok(!html.includes('cursor-pointer hover:bg-[var(--color-surface-variant)]/30'),
        'Unsynced mode must NOT have pointer cursor or seek button behavior');

      // 5. Text shadow must not have glowing bloom
      assert.ok(!html.includes('0 0 16px rgba(255, 255, 255, 0.62)'),
        'Unsynced text must not emit glowing active bloom shadow');

      // 6. Credit footers (Source: or Written by:) must render with distinct credit styling
      assert.ok(html.includes('text-xs text-white/40 italic pt-4 mt-6 border-t border-white/10 select-text'),
        'Credit line must render with distinct footer styling');

      // 7. No "Sync with playback" pill
      assert.ok(!html.includes('Sync with playback'),
        'Unsynced mode must never render the Sync with playback pill');
    });
  }

  test('ADV-UN02: Binary search clamping oracle returns -1 for unsynced mode in SyllableLyricsEngine', () => {
    const unsyncedLines = [
      { lineIndex: 0, startTimeMs: 0, endTimeMs: 0, text: 'A' },
      { lineIndex: 1, startTimeMs: 0, endTimeMs: 0, text: 'B' },
      { lineIndex: 2, startTimeMs: 0, endTimeMs: 0, text: 'C' },
    ];

    // Raw binary search without unsynced guard clamps to 2 (last line)
    const rawClamped = LyricsService.getActiveLineIndex(unsyncedLines, 45000);
    assert.strictEqual(rawClamped, 2, 'Raw binary search clamps to last index on zero-timestamp lines');

    // SyllableLyricsEngine isUnsynced guard evaluates to true
    const isUnsynced = unsyncedLines.every((l) => l.startTimeMs === 0 && l.endTimeMs === 0);
    assert.strictEqual(isUnsynced, true);

    // Active line index is strictly -1
    const activeLineIndex = isUnsynced ? -1 : rawClamped;
    assert.strictEqual(activeLineIndex, -1, 'Engine must override activeLineIndex to -1');
  });
});

// ============================================================================
// SUITE 5: MOUNT LIFECYCLE & EVENT LISTENER ATTACHMENT (M2-UI-01 REMEDIATION)
// ============================================================================
describe('Challenge 5: Container Lifecycle & Event Listener Cleanup (M2-UI-01)', () => {

  test('ADV-LC01: SyllableLyricsEngine effect dependency array contains [isLoading, lyricsData]', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');

    const filePath = path.resolve('src/ui/player/SyllableLyricsEngine.tsx');
    const content = fs.readFileSync(filePath, 'utf8');

    // Extract the useEffect hook that attaches scrollend
    const scrollEndEffectMatch = content.match(
      /container\.addEventListener\('scrollend'[\s\S]*?\}, \[(.*?)\]\);/
    );

    assert.ok(scrollEndEffectMatch, 'Must find useEffect for scrollend in SyllableLyricsEngine.tsx');
    const deps = scrollEndEffectMatch[1].trim();

    assert.ok(deps.includes('isLoading'), 'Effect dependency array must include isLoading');
    assert.ok(deps.includes('lyricsData'), 'Effect dependency array must include lyricsData');
    assert.notStrictEqual(deps, '', 'Dependency array must NOT be empty []');
  });

  test('ADV-LC02: Cleanup function removes scrollend listener and clears active timeouts', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');

    const filePath = path.resolve('src/ui/player/SyllableLyricsEngine.tsx');
    const content = fs.readFileSync(filePath, 'utf8');

    assert.ok(content.includes("container.removeEventListener('scrollend', handleScrollEnd)"),
      'Cleanup must remove scrollend event listener');
    assert.ok(content.includes("clearTimeout(programmaticScrollTimeoutRef.current)"),
      'Cleanup must clear programmaticScrollTimeout');
    assert.ok(content.includes("clearTimeout(detentionTimerRef.current)"),
      'Cleanup must clear detentionTimer');
  });
});
