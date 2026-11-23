// tests/adversarial_lyrics_party_stress.mjs
// Adversarial empirical stress testing suite for LyricsService and PartySyncClient
// Validating robustness against corrupted inputs, extreme scale, timing boundaries, jitter, and drift

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// Register ESM resolution hook for TypeScript imports
const resolverHook = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.')) {
      if (specifier.endsWith('.js')) {
        try {
          return await nextResolve(specifier.slice(0, -3) + '.ts', context);
        } catch {}
      }
      if (!specifier.endsWith('.ts') && !specifier.endsWith('.js') && !specifier.endsWith('.mjs')) {
        try {
          return await nextResolve(specifier + '.ts', context);
        } catch {}
        try {
          return await nextResolve(specifier + '/index.ts', context);
        } catch {}
      }
    }
    throw err;
  }
}
`;
register(`data:text/javascript,${encodeURIComponent(resolverHook)}`, import.meta.url);

const { LyricsService } = await import('../src/services/LyricsService.ts');
const {
  PartySyncClient,
  MockPartyBroadcastServer,
  usePartyStore,
  hashPartyRoomCode,
  generatePartyCode,
} = await import('../src/services/PartySyncClient.ts');
const { PartyLanServer } = await import('../electron/partyLanServer.ts');

// ============================================================================
// SUITE 1: LYRICS SERVICE ROBUSTNESS & EDGE CASE CHALLENGES
// ============================================================================
describe('Adversarial Challenge 1: Lyrics Parsing & Robustness', () => {

  test('ADV-LY01: parseLrc handles corrupted, malformed and non-standard tags gracefully', () => {
    const corruptedLrc = [
      '[invalid tag]Just random text',
      '[:20.00]Missing minute',
      '[01:.00]Missing second',
      '[01:20]Missing fraction',
      '[01:20.4]Single digit fraction',
      '[ab:cd.ef]Alphabetical timestamp',
      '[-01:20.00]Negative minute',
      'Missing brackets altogether 01:20.00',
      '   ',
      'Normal line [00:15.00] with bracket inside',
      '[99:99.99]Out of range timestamp',
      '[00:05.50]Valid line 1',
      '[00:12.00]Valid line 2',
    ].join('\n');

    const parsed = LyricsService.parseLrc(corruptedLrc);
    assert.strictEqual(parsed.type, 'LINE_SYNCED');
    // Only the valid lines should be extracted
    assert.ok(parsed.lines.length >= 2, `Expected at least 2 parsed lines, got ${parsed.lines.length}`);
    
    // Check that valid lines have non-NaN timestamps
    for (const line of parsed.lines) {
      assert.ok(!Number.isNaN(line.startTimeMs), `startTimeMs is NaN for line: ${line.text}`);
      assert.ok(!Number.isNaN(line.endTimeMs), `endTimeMs is NaN for line: ${line.text}`);
      assert.ok(line.startTimeMs >= 0, `startTimeMs is negative: ${line.startTimeMs}`);
    }
  });

  test('ADV-LY02: parseLrc ignores metadata headers without throwing', () => {
    const lrcWithMeta = `
[ti:Midnight City]
[ar:M83]
[al:Hurry Up, We're Dreaming]
[by:WaveForm Community]
[offset:+250]
[re:DesktopClient]
[ve:2.1.0]
[#comment: this is a comment]

[00:10.00]Waiting in a car
[00:15.00]Waiting for a ride in the dark
[00:20.00]The night city grows
`;
    const parsed = LyricsService.parseLrc(lrcWithMeta);
    assert.strictEqual(parsed.lines.length, 3);
    assert.strictEqual(parsed.lines[0].text, 'Waiting in a car');
    assert.strictEqual(parsed.lines[1].text, 'Waiting for a ride in the dark');
    assert.strictEqual(parsed.lines[2].text, 'The night city grows');
  });

  test('ADV-LY03: parseLrc correctly re-sorts out-of-order timestamps and recalculates durations', () => {
    const unorderedLrc = `
[00:30.00]Line 3 (at 30s)
[00:10.00]Line 1 (at 10s)
[00:40.00]Line 4 (at 40s)
[00:20.00]Line 2 (at 20s)
`;
    const parsed = LyricsService.parseLrc(unorderedLrc);
    assert.strictEqual(parsed.lines.length, 4);

    // Verify chronological ordering
    assert.strictEqual(parsed.lines[0].startTimeMs, 10000);
    assert.strictEqual(parsed.lines[0].text, 'Line 1 (at 10s)');
    assert.strictEqual(parsed.lines[0].endTimeMs, 20000);

    assert.strictEqual(parsed.lines[1].startTimeMs, 20000);
    assert.strictEqual(parsed.lines[1].text, 'Line 2 (at 20s)');
    assert.strictEqual(parsed.lines[1].endTimeMs, 30000);

    assert.strictEqual(parsed.lines[2].startTimeMs, 30000);
    assert.strictEqual(parsed.lines[2].text, 'Line 3 (at 30s)');
    assert.strictEqual(parsed.lines[2].endTimeMs, 40000);

    assert.strictEqual(parsed.lines[3].startTimeMs, 40000);
    assert.strictEqual(parsed.lines[3].text, 'Line 4 (at 40s)');
    assert.strictEqual(parsed.lines[3].endTimeMs, 45000); // 40000 + 5000 fallback
  });

  test('ADV-LY04: parseLrc handles duplicate timestamps without infinite loops or crashes', () => {
    const dupLrc = `
[00:10.00]First occurrence at 10s
[00:10.00]Second occurrence at 10s (harmony/chorus)
[00:20.00]Next line at 20s
`;
    const parsed = LyricsService.parseLrc(dupLrc);
    assert.strictEqual(parsed.lines.length, 3);
    assert.strictEqual(parsed.lines[0].startTimeMs, 10000);
    assert.strictEqual(parsed.lines[1].startTimeMs, 10000);
    assert.strictEqual(parsed.lines[2].startTimeMs, 20000);
  });

  test('ADV-LY05: parseClockTime handles multiple standard time representations', () => {
    // Milliseconds
    assert.strictEqual(LyricsService.parseClockTime('500ms'), 500);
    assert.strictEqual(LyricsService.parseClockTime('12345ms'), 12345);
    assert.strictEqual(LyricsService.parseClockTime('12345.67ms'), 12345.67);

    // Seconds
    assert.strictEqual(LyricsService.parseClockTime('10s'), 10000);
    assert.strictEqual(LyricsService.parseClockTime('1.5s'), 1500);
    assert.strictEqual(LyricsService.parseClockTime('0.25s'), 250);

    // mm:ss.xx
    assert.strictEqual(LyricsService.parseClockTime('01:30.500'), 90500);
    assert.strictEqual(LyricsService.parseClockTime('00:05.100'), 5100);

    // hh:mm:ss.xx
    assert.strictEqual(LyricsService.parseClockTime('01:02:03.400'), 3723400);

    // Bare numbers
    assert.strictEqual(LyricsService.parseClockTime('12'), 12000);
    assert.strictEqual(LyricsService.parseClockTime('12.5'), 12500);
  });

  test('ADV-LY06: parseTtml handles malformed, truncated, and attribute-rich XML', () => {
    // Malformed XML: unclosed tags, truncated mid-stream
    const brokenXml = `
      <tt xmlns="http://www.w3.org/ns/ttml">
        <body>
          <div>
            <p begin="00:05.000" end="00:09.000">
              <span begin="00:05.000" end="00:07.000">Hello </span>
              <span begin="00:07.000" end="00:09.000">World</span>
            </p>
            <p begin="00:10.000" end="00:14.000">
              <span begin="00:10.000">Unclosed span
            <!-- Truncated file without closing div/body/tt -->
    `;
    const parsed = LyricsService.parseTtml(brokenXml);
    assert.ok(parsed.lines.length >= 1);
    assert.strictEqual(parsed.lines[0].text, 'Hello World');
    assert.strictEqual(parsed.lines[0].syllables?.length, 2);
  });

  test('ADV-LY07: Internationalization & RTL detection for Hebrew, Arabic, Persian, Urdu and CJK', () => {
    // Arabic
    const arabicLrc = `[00:10.00]حبيبي يا نور العين`;
    const parsedArabic = LyricsService.parseLrc(arabicLrc);
    assert.strictEqual(parsedArabic.isRtl, true);
    assert.strictEqual(LyricsService.isRtlText('حبيبي يا نور العين'), true);

    // Hebrew
    const hebrewLrc = `[00:10.00]שלום עליכם מלאכי השלום`;
    const parsedHebrew = LyricsService.parseLrc(hebrewLrc);
    assert.strictEqual(parsedHebrew.isRtl, true);
    assert.strictEqual(LyricsService.isRtlText('שלום עליכם'), true);

    // Persian (Farsi)
    assert.strictEqual(LyricsService.isRtlText('جان من است او'), true);

    // CJK & Cyrillic (should be false for isRtl)
    assert.strictEqual(LyricsService.isRtlText('夜に駆ける YOASOBI'), false);
    assert.strictEqual(LyricsService.isRtlText('Русский текст песни'), false);
    assert.strictEqual(LyricsService.isRtlText('English Lyrics with 123!'), false);

    // Mixed English + Arabic
    assert.strictEqual(LyricsService.isRtlText('Track 01 - حبيبي'), true);
  });

  test('ADV-LY08: Extreme lyrics scale (>5,000 lines) parses without heap exhaustion or timeout', () => {
    const LINE_COUNT = 6000;
    const lines = [];
    for (let i = 0; i < LINE_COUNT; i++) {
      const min = String(Math.floor(i / 60)).padStart(2, '0');
      const sec = String(i % 60).padStart(2, '0');
      lines.push(`[${min}:${sec}.00]Extreme line number ${i} in massive lyrics performance`);
    }
    const massiveLrc = lines.join('\n');

    const start = performance.now();
    const parsed = LyricsService.parseLrc(massiveLrc);
    const elapsedMs = performance.now() - start;

    assert.strictEqual(parsed.lines.length, LINE_COUNT);
    assert.ok(elapsedMs < 1000, `Parsing 6,000 lines took too long: ${elapsedMs.toFixed(2)}ms`);
    console.log(`      ⚡ Scaled parseLrc 6,000 lines: ${elapsedMs.toFixed(2)}ms (${(LINE_COUNT / (elapsedMs / 1000)).toFixed(0)} lines/sec)`);
  });
});

// ============================================================================
// SUITE 2: O(log N) BINARY SEARCH BENCHMARK & ORACLE VERIFICATION
// ============================================================================
describe('Adversarial Challenge 2: Binary Search O(log N) Performance & Precision', () => {

  const TOTAL_LINES = 5000;
  const lines = [];
  let currentTimeMs = 0;

  for (let i = 0; i < TOTAL_LINES; i++) {
    const duration = 2000 + (i % 3) * 1000; // 2s, 3s, or 4s
    lines.push({
      lineIndex: i,
      startTimeMs: currentTimeMs,
      endTimeMs: currentTimeMs + duration,
      text: `Performance line ${i} at ${currentTimeMs}ms`,
    });
    currentTimeMs += duration;
  }

  const largeLyrics = {
    type: 'LINE_SYNCED',
    provider: 'Benchmark',
    isRtl: false,
    lines,
  };

  // Authoritative Oracle: Linear Search for verification
  function linearSearchOracle(lyrics, currentPosMs) {
    if (!lyrics || !lyrics.lines || lyrics.lines.length === 0) return -1;
    let candidate = -1;
    for (let i = 0; i < lyrics.lines.length; i++) {
      const line = lyrics.lines[i];
      if (currentPosMs >= line.startTimeMs && currentPosMs <= line.endTimeMs) {
        return i;
      }
      if (line.startTimeMs <= currentPosMs) {
        candidate = i;
      }
    }
    return candidate;
  }

  test('ADV-BS01: Binary search matches linear oracle across boundary conditions', () => {
    // Test before first line
    assert.strictEqual(LyricsService.getActiveLineIndex(largeLyrics, -500), -1);

    // Test first line start and mid
    assert.strictEqual(LyricsService.getActiveLineIndex(largeLyrics, 0), 0);
    assert.strictEqual(LyricsService.getActiveLineIndex(largeLyrics, 1000), 0);

    // Test boundary between lines
    const line0End = lines[0].endTimeMs; // 2000
    const line1Start = lines[1].startTimeMs; // 2000
    // Interior points before and after boundary
    assert.strictEqual(LyricsService.getActiveLineIndex(largeLyrics, line0End - 1), 0);
    assert.strictEqual(LyricsService.getActiveLineIndex(largeLyrics, line1Start + 1), 1);
    // Boundary point itself must return either line 0 or line 1 (both intervals include 2000ms)
    const boundaryResult = LyricsService.getActiveLineIndex(largeLyrics, line0End);
    assert.ok(boundaryResult === 0 || boundaryResult === 1, `Boundary result was ${boundaryResult}`);

    // Test middle lines
    const midIdx = 2500;
    const midLine = lines[midIdx];
    assert.strictEqual(LyricsService.getActiveLineIndex(largeLyrics, midLine.startTimeMs + 100), midIdx);

    // Test last line and beyond
    const lastIdx = TOTAL_LINES - 1;
    const lastLine = lines[lastIdx];
    assert.strictEqual(LyricsService.getActiveLineIndex(largeLyrics, lastLine.startTimeMs + 100), lastIdx);
    assert.strictEqual(LyricsService.getActiveLineIndex(largeLyrics, lastLine.endTimeMs + 50000), lastIdx);

    // Systematic Oracle Comparison: 1,000 deterministic probes
    for (let i = 0; i < 1000; i++) {
      const queryPos = Math.floor((i / 1000) * currentTimeMs);
      const bsResult = LyricsService.getActiveLineIndex(largeLyrics, queryPos);
      assert.ok(bsResult >= 0 && bsResult < TOTAL_LINES, `Result out of bounds: ${bsResult}`);
      const line = lines[bsResult];
      // Verify result line covers query position or is valid candidate
      const covers = queryPos >= line.startTimeMs && (queryPos <= line.endTimeMs || bsResult === TOTAL_LINES - 1);
      assert.ok(
        covers,
        `Line ${bsResult} [${line.startTimeMs}, ${line.endTimeMs}] does not cover queryPos ${queryPos}ms`
      );
    }
  });

  test('ADV-BS02: 100,000 lookup queries execute under tight time budget (True O(log N))', () => {
    const QUERY_COUNT = 100_000;
    const maxTime = currentTimeMs;

    // Pre-generate pseudo-random query positions
    const queries = new Int32Array(QUERY_COUNT);
    for (let i = 0; i < QUERY_COUNT; i++) {
      queries[i] = Math.floor(Math.random() * (maxTime + 10000)) - 2000;
    }

    const start = performance.now();
    let checksum = 0;
    for (let i = 0; i < QUERY_COUNT; i++) {
      checksum += LyricsService.getActiveLineIndex(largeLyrics, queries[i]);
    }
    const elapsedMs = performance.now() - start;

    assert.ok(elapsedMs < 200, `100,000 queries took too long: ${elapsedMs.toFixed(2)}ms (expected < 200ms)`);
    const qps = Math.round((QUERY_COUNT / (elapsedMs / 1000)));
    console.log(`      ⚡ 100,000 binary search lookups: ${elapsedMs.toFixed(2)}ms (${qps.toLocaleString()} queries/sec, checksum=${checksum})`);
  });

  test('ADV-BS03: Empty, null, and undefined lyrics inputs handled safely', () => {
    assert.strictEqual(LyricsService.getActiveLineIndex(null, 1000), -1);
    assert.strictEqual(LyricsService.getActiveLineIndex(undefined, 1000), -1);
    assert.strictEqual(LyricsService.getActiveLineIndex({ type: 'LINE_SYNCED', provider: 'test', lines: [] }, 1000), -1);
  });
});

// ============================================================================
// SUITE 3: SYLLABLE PROGRESS & TRANSITION BOUNDARIES
// ============================================================================
describe('Adversarial Challenge 3: Syllable Progress & Boundary Transitions', () => {

  const testLine = {
    startTimeMs: 10000,
    endTimeMs: 16000,
    text: 'Syllable testing boundary',
    syllables: [
      { text: 'Syl-', startTimeMs: 10000, endTimeMs: 11000 },
      { text: 'la-', startTimeMs: 11000, endTimeMs: 12000 },
      { text: 'ble ', startTimeMs: 12000, endTimeMs: 13500 },
      // Intentional gap between 13500 and 14000
      { text: 'test-', startTimeMs: 14000, endTimeMs: 15000 },
      { text: 'ing', startTimeMs: 15000, endTimeMs: 16000 },
    ],
  };

  test('ADV-SY01: getActiveWord computes exact progress fractions [0.0, 1.0]', () => {
    // Start of first syllable
    const atStart = LyricsService.getActiveWord(testLine, 10000);
    assert.strictEqual(atStart.syllableIndex, 0);
    assert.strictEqual(atStart.progress, 0.0);

    // 25% through first syllable
    const atQuarter = LyricsService.getActiveWord(testLine, 10250);
    assert.strictEqual(atQuarter.syllableIndex, 0);
    assert.strictEqual(atQuarter.progress, 0.25);

    // 50% through first syllable
    const atHalf = LyricsService.getActiveWord(testLine, 10500);
    assert.strictEqual(atHalf.syllableIndex, 0);
    assert.strictEqual(atHalf.progress, 0.5);

    // 100% through first syllable
    const atEnd = LyricsService.getActiveWord(testLine, 11000);
    assert.strictEqual(atEnd.syllableIndex, 0);
    assert.strictEqual(atEnd.progress, 1.0);
  });

  test('ADV-SY02: Seamless transition across adjacent syllable boundary', () => {
    // 1ms after boundary should switch cleanly to next syllable
    const justAfter = LyricsService.getActiveWord(testLine, 11001);
    assert.strictEqual(justAfter.syllableIndex, 1);
    assert.strictEqual(justAfter.activeSyllable?.text, 'la-');
    assert.ok(justAfter.progress > 0.0 && justAfter.progress < 0.01);
  });

  test('ADV-SY03: Gap between syllables returns null active syllable without progress', () => {
    // In gap between 13500 and 14000
    const inGap = LyricsService.getActiveWord(testLine, 13750);
    assert.strictEqual(inGap.activeSyllable, null);
    assert.strictEqual(inGap.syllableIndex, -1);
    assert.strictEqual(inGap.progress, 0);
  });

  test('ADV-SY04: Zero-duration and corrupted negative syllables do not throw or produce NaN', () => {
    const corruptLine = {
      startTimeMs: 1000,
      endTimeMs: 5000,
      text: 'Zero test',
      syllables: [
        { text: 'zero', startTimeMs: 2000, endTimeMs: 2000 }, // zero duration
        { text: 'inverted', startTimeMs: 4000, endTimeMs: 3000 }, // inverted
      ],
    };

    // Zero-duration syllable at exact match
    const zeroMatch = LyricsService.getActiveWord(corruptLine, 2000);
    assert.ok(!Number.isNaN(zeroMatch.progress));
    assert.ok(zeroMatch.progress >= 0.0 && zeroMatch.progress <= 1.0);

    // Inverted duration syllable should not match
    const invertedMatch = LyricsService.getActiveWord(corruptLine, 3500);
    assert.strictEqual(invertedMatch.activeSyllable, null);
  });
});

// ============================================================================
// SUITE 4: PARTY SYNC DRIFT, JITTER & RECONCILIATION STRESS
// ============================================================================
describe('Adversarial Challenge 4: Party Sync Jitter, Drift & Anti-Oscillation', () => {

  test('ADV-PT01: Party code validation rejects malicious and malformed formats', () => {
    // Valid formats
    assert.strictEqual(PartySyncClient.isValidPartyCode('WAVE-0001'), true);
    assert.strictEqual(PartySyncClient.isValidPartyCode('WAVE-9999'), true);
    assert.strictEqual(PartySyncClient.isValidPartyCode('ABCDEF'), true);
    assert.strictEqual(PartySyncClient.isValidPartyCode('123456'), true);
    assert.strictEqual(PartySyncClient.isValidPartyCode('AB12CD'), true);

    // Invalid & Malicious
    assert.strictEqual(PartySyncClient.isValidPartyCode('wave-1234'), false); // lowercase
    assert.strictEqual(PartySyncClient.isValidPartyCode('WAVE-12345'), false); // 5 digits
    assert.strictEqual(PartySyncClient.isValidPartyCode('WAVE-123'), false); // 3 digits
    assert.strictEqual(PartySyncClient.isValidPartyCode("WAVE-1234'; DROP TABLE parties;--"), false);
    assert.strictEqual(PartySyncClient.isValidPartyCode('<script>alert("xss")</script>'), false);
    assert.strictEqual(PartySyncClient.isValidPartyCode(''), false);
    assert.strictEqual(PartySyncClient.isValidPartyCode(null), false);
    assert.strictEqual(PartySyncClient.isValidPartyCode(undefined), false);
    assert.strictEqual(PartySyncClient.isValidPartyCode(123456), false);
    assert.strictEqual(PartySyncClient.isValidPartyCode({ code: 'WAVE-1234' }), false);
  });

  test('ADV-PT02: NTP clock calculation with extreme network latency and jitter (±500ms)', () => {
    const client = new PartySyncClient();
    const trueServerOffset = 3000; // Server is 3 seconds ahead

    // Simulate 50 ping-pong rounds with varying network jitter
    for (let i = 0; i < 50; i++) {
      const now = Date.now();
      const sendTime = now - (20 + (i % 10) * 40); // RTT varies from 20ms to 380ms
      const rtt = now - sendTime;
      const serverTimestamp = sendTime + Math.round(rtt / 2) + trueServerOffset;

      client.handleFrame({
        type: 'pong',
        clientMs: sendTime,
        serverMs: serverTimestamp,
      });

      assert.strictEqual(client.getIsClockSynced(), true);
      // Offset should be within ±15ms of trueServerOffset despite network latency
      const calculatedOffset = client.getClockOffsetMs();
      assert.ok(
        Math.abs(calculatedOffset - trueServerOffset) <= 15,
        `NTP offset diverged: calculated=${calculatedOffset}, true=${trueServerOffset}`
      );
    }
  });

  test('ADV-PT03: checkDrift enforces ±200ms threshold and requires 2 consecutive strikes', () => {
    const client = new PartySyncClient();
    let seeksTriggered = 0;
    let lastSeekTarget = null;

    client.setCallbacks({
      onSeek: (targetMs) => {
        seeksTriggered++;
        lastSeekTarget = targetMs;
      },
    });

    // Sync clock with 0 offset
    client.handleFrame({ type: 'pong', clientMs: Date.now(), serverMs: Date.now() });

    const serverNow = Date.now();
    const playback = {
      isPlaying: true,
      positionMs: 60000,
      anchorMs: serverNow,
      speed: 1.0,
      currentTrack: null,
    };

    // Sub-threshold drift (150ms drift < 200ms limit)
    const subDrift = client.checkDrift(60150, playback);
    assert.strictEqual(subDrift, false);
    assert.strictEqual(seeksTriggered, 0);

    // Negative sub-threshold drift (-180ms drift < 200ms limit)
    const negSubDrift = client.checkDrift(59820, playback);
    assert.strictEqual(negSubDrift, false);
    assert.strictEqual(seeksTriggered, 0);

    // First strike above limit (350ms drift)
    const strike1 = client.checkDrift(60350, playback);
    assert.strictEqual(strike1, false, 'Strike 1 must NOT trigger seek immediately');
    assert.strictEqual(seeksTriggered, 0);

    // Jitter recovery: drift drops back below limit -> strikes should reset!
    client.checkDrift(60050, playback); // Reset strikes

    // Strike 1 again after reset
    const strike1Again = client.checkDrift(60400, playback);
    assert.strictEqual(strike1Again, false);
    assert.strictEqual(seeksTriggered, 0);

    // Strike 2 (consecutive strike) -> MUST trigger seek!
    const strike2 = client.checkDrift(60400, playback);
    assert.strictEqual(strike2, true, 'Strike 2 MUST trigger seek');
    assert.strictEqual(seeksTriggered, 1);
    assert.ok(lastSeekTarget !== null);

    // Anti-oscillation cooldown: consecutive check right after seek within 6000ms cooldown
    const duringCooldown = client.checkDrift(60400, playback);
    assert.strictEqual(duringCooldown, false, 'Drift check during cooldown MUST return false');
    assert.strictEqual(seeksTriggered, 1, 'No additional seeks during cooldown');
  });

  test('ADV-PT04: Reconcile quiet window (4500ms) blocks echoed inbound server state after user action', () => {
    const client = new PartySyncClient();
    let localSeeks = 0;
    client.setCallbacks({
      onSeek: () => { localSeeks++; },
    });

    // Mock WebSocket send
    client.ws = { readyState: 1, send: () => {} };

    // User publishes local seek to 90,000ms
    client.publishSeek(90000);

    // Immediately after (within 4500ms), server sends back stale state frame
    client.handleFrame({
      type: 'state',
      seq: 10,
      playback: {
        isPlaying: true,
        positionMs: 30000, // Stale old position
        anchorMs: Date.now(),
        speed: 1.0,
      },
    });

    // Inbound frame should have been dropped by quiet window
    assert.strictEqual(localSeeks, 0, 'Inbound state frame during quiet window should NOT seek');
  });

  test('ADV-PT05: Out-of-order sequence frames handled safely without thrashing', () => {
    const client = new PartySyncClient();
    const seeks = [];
    client.setCallbacks({
      onSeek: (targetMs) => seeks.push(targetMs),
    });

    // Clock synced
    client.handleFrame({ type: 'pong', clientMs: Date.now(), serverMs: Date.now() });

    // Send sequence 1
    client.handleFrame({
      type: 'state',
      seq: 1,
      playback: { isPlaying: false, positionMs: 10000, anchorMs: Date.now() },
    });
    assert.strictEqual(seeks.length, 1);
    assert.strictEqual(seeks[0], 10000);

    // Duplicate sequence 1 arrives again (retransmitted packet)
    client.handleFrame({
      type: 'state',
      seq: 1,
      playback: { isPlaying: false, positionMs: 10000, anchorMs: Date.now() },
    });
    assert.strictEqual(seeks.length, 1, 'Duplicate seq must not trigger another seek');

    // Sequence 2 arrives
    client.handleFrame({
      type: 'state',
      seq: 2,
      playback: { isPlaying: false, positionMs: 25000, anchorMs: Date.now() },
    });
    assert.strictEqual(seeks.length, 2);
    assert.strictEqual(seeks[1], 25000);
  });

  test('ADV-PT06: MockPartyBroadcastServer handles full multi-member lifecycle', () => {
    const server = new MockPartyBroadcastServer('WAVE-5555', 'user_host');
    assert.strictEqual(server.getRoomStatus(), 'VACANT');

    // Add host
    const host = server.addMember('user_host', 'Host DJ', true);
    assert.strictEqual(host.isHost, true);
    assert.strictEqual(server.getRoomStatus(), 'ACTIVE');

    // Add guests
    server.addMember('guest_1', 'Guest 1');
    server.addMember('guest_2', 'Guest 2');
    const snapshot = server.getSnapshot();
    assert.strictEqual(snapshot.participants.length, 3);

    // Host controls: play, seek, pause
    const playState = server.handleControl('play', { positionMs: 15000 });
    assert.strictEqual(playState.playback.isPlaying, true);
    assert.strictEqual(playState.playback.positionMs, 15000);

    const seekState = server.handleControl('seek', { positionMs: 45000 });
    assert.strictEqual(seekState.playback.positionMs, 45000);

    const pauseState = server.handleControl('pause', { positionMs: 46000 });
    assert.strictEqual(pauseState.playback.isPlaying, false);
    assert.strictEqual(pauseState.playback.positionMs, 46000);

    // Remove members
    server.removeMember('guest_1');
    server.removeMember('guest_2');
    server.removeMember('user_host');
    assert.strictEqual(server.getRoomStatus(), 'VACANT');
  });

  test('ADV-PT07: Connect with missing WebSocket implementation resolves false cleanly', async () => {
    const client = new PartySyncClient();
    // In Node.js without global WebSocket or server running, connect() should resolve false gracefully
    const connected = await client.connect('WAVE-1234', 'token_123', 'ws://127.0.0.1:9999');
    assert.strictEqual(typeof connected, 'boolean');
    client.disconnect();
  });

  test('ADV-PT08: reconcileState missing-playback null-guard does not throw on malformed state frames', () => {
    const client = new PartySyncClient();
    assert.doesNotThrow(() => {
      client.handleFrame({ type: 'state', seq: 1 });
      client.handleFrame({ type: 'state', seq: 2, playback: null });
      client.handleFrame({ type: 'state', seq: 3, playback: 'bad' });
      client.handleFrame(null);
      client.handleFrame(undefined);
    });
  });

  test('ADV-PT09: handleFrame dispatches queue, members, chat, reaction, and controlMode with deduplication', () => {
    const client = new PartySyncClient();
    const events = { queues: 0, members: 0, chats: [], reactions: [], modes: [] };
    client.setCallbacks({
      onQueueUpdate: () => events.queues++,
      onMembersUpdate: (m) => { events.members = m.length; },
      onChat: (msg) => events.chats.push(msg),
      onReaction: (rx) => events.reactions.push(rx),
      onControlModeChange: (mode) => events.modes.push(mode),
    });

    client.handleFrame({ type: 'queue', seq: 1, queue: { tracks: [], currentIndex: 0 } });
    client.handleFrame({ type: 'members', members: [{ id: '1', name: 'A', role: 'host', isReady: true, isHost: true }] });
    client.handleFrame({ type: 'chat', message: { id: 'c1', senderId: '1', senderName: 'A', text: 'hello', timestampMs: 1 } });
    client.handleFrame({ type: 'chat', message: { id: 'c1', senderId: '1', senderName: 'A', text: 'hello', timestampMs: 1 } });
    client.handleFrame({ type: 'reaction', reaction: { id: 'r1', senderId: '1', senderName: 'A', emoji: '🔥', timestampMs: 2 } });
    client.handleFrame({ type: 'reaction', reaction: { id: 'r1', senderId: '1', senderName: 'A', emoji: '🔥', timestampMs: 2 } });
    client.handleFrame({ type: 'controlMode', controlMode: 'collaborative' });

    assert.strictEqual(events.queues, 1);
    assert.strictEqual(events.members, 1);
    assert.strictEqual(events.chats.length, 1);
    assert.strictEqual(events.reactions.length, 1);
    assert.deepStrictEqual(events.modes, ['collaborative']);
  });

  test('ADV-PT10: PartyLanServer RFC 6455 WebSocket roundtrip syncs host/guest playback, NTP, chat, and reactions', async () => {
    const server = new PartyLanServer();
    const info = await server.start({ partyCode: 'LAN777', port: 0, controlMode: 'host-only' });
    assert.strictEqual(info.running, true);
    assert.ok(info.localWsUrl && info.port > 0);

    const host = new PartySyncClient();
    const guest = new PartySyncClient();

    const guestTracks = [];
    const guestChats = [];
    const guestReactions = [];
    let guestMembers = 0;

    guest.setCallbacks({
      onTrackChange: (track) => guestTracks.push(track),
      onChat: (msg) => guestChats.push(msg),
      onReaction: (rx) => guestReactions.push(rx),
      onMembersUpdate: (m) => { guestMembers = m.length; },
    });

    try {
      const hostOk = await host.connect('LAN777', info.hostToken, info.localWsUrl, { memberName: 'HostDJ' });
      const guestOk = await guest.connect('LAN777', 'guest_tok', info.localWsUrl, { memberName: 'GuestOne' });
      assert.strictEqual(hostOk, true);
      assert.strictEqual(guestOk, true);

      await new Promise((r) => setTimeout(r, 150));
      assert.strictEqual(guest.getIsClockSynced(), true);
      assert.ok(Math.abs(guest.getClockOffsetMs()) <= 20, 'LAN NTP offset should be near zero');
      assert.strictEqual(guestMembers, 2);

      host.publishSetTrack({ videoId: 'abc12345678', title: 'Test Song', artist: 'Test Artist', durationMs: 180000 }, 5000, true);
      guest.publishChat('Sounds great!', 'GuestOne');
      guest.publishReaction('🔥', 'GuestOne');

      await new Promise((r) => setTimeout(r, 150));
      assert.strictEqual(guestTracks.length, 1);
      assert.strictEqual(guestTracks[0].title, 'Test Song');
      assert.strictEqual(guestChats.length, 1);
      assert.strictEqual(guestChats[0].text, 'Sounds great!');
      assert.strictEqual(guestReactions.length, 1);
      assert.strictEqual(guestReactions[0].emoji, '🔥');
    } finally {
      guest.disconnect();
      host.disconnect();
      await server.stop();
    }
  });

  test('ADV-PT11: usePartyStore rejects invalid codes without fake optimistic connected state and hashes room topics deterministically', async () => {
    assert.strictEqual(hashPartyRoomCode('abc123'), hashPartyRoomCode('ABC123'));
    assert.strictEqual(PartySyncClient.isValidPartyCode(generatePartyCode()), true);

    const ok = await usePartyStore.getState().joinRoom('INVALID!!');
    assert.strictEqual(ok, false);
    assert.strictEqual(usePartyStore.getState().status, 'disconnected');
    assert.ok(usePartyStore.getState().error);
  });
});
