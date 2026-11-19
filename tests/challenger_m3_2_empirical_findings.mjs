// tests/challenger_m3_2_empirical_findings.mjs
// Empirical Vulnerability & Edge Case Harness for Milestone 3 Challenger 2
// Demonstrating and documenting discovered weaknesses in LyricsService and PartySyncClient

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const resolverHook = `
export async function resolve(specifier, context, nextResolve) {
  try { return await nextResolve(specifier, context); } catch (err) {
    if (specifier.startsWith('.') && !specifier.endsWith('.ts') && !specifier.endsWith('.js') && !specifier.endsWith('.mjs')) {
      try { return await nextResolve(specifier + '.ts', context); } catch {}
      try { return await nextResolve(specifier + '/index.ts', context); } catch {}
    }
    throw err;
  }
}
`;
register(`data:text/javascript,${encodeURIComponent(resolverHook)}`, import.meta.url);

const { LyricsService } = await import('../src/services/LyricsService.ts');
const { PartySyncClient, MockPartyBroadcastServer } = await import('../src/services/PartySyncClient.ts');

describe('Empirical Findings & Vulnerabilities: LyricsService & PartySyncClient', () => {

  // --------------------------------------------------------------------------
  // FINDING 1: TTML Parser Rigid Attribute Ordering Failure
  // --------------------------------------------------------------------------
  test('FINDING-01: TTML parser fails to match <p> and <span> when attributes precede begin', () => {
    // Standard TTML from Apple Music / W3C specifications
    const ttmlStandard = `
      <tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling">
        <body>
          <div>
            <p xml:id="line1" region="bottom" begin="00:00:10.000" end="00:00:15.000">
              <span style="s1" begin="00:00:10.000" end="00:00:12.000">Hel-</span>
              <span style="s1" begin="00:00:12.000" end="00:00:15.000">lo</span>
            </p>
            <p end="00:00:20.000" begin="00:00:15.500">
              <span begin="00:00:15.500" end="00:00:20.000">World</span>
            </p>
          </div>
        </body>
      </tt>
    `;

    const parsed = LyricsService.parseTtml(ttmlStandard);
    
    // EMPIRICAL OBSERVATION:
    // Because pRegex uses /<p\s+begin="([^"]+)"/, it fails to match <p xml:id="line1"...>
    // And fails to match <p end="..." begin="...">
    // Result: 0 lines are parsed from valid TTML!
    console.log(`      [EMPIRICAL OBSERVATION] Standard TTML lines parsed: ${parsed.lines.length} (Expected 2, got ${parsed.lines.length})`);
    assert.strictEqual(parsed.lines.length, 0, 'Demonstrates that attribute-preceded <p> fails to parse');
  });

  // --------------------------------------------------------------------------
  // FINDING 2: parseClockTime NaN Propagation
  // --------------------------------------------------------------------------
  test('FINDING-02: parseClockTime returns NaN for non-numeric/empty strings instead of fallback 0', () => {
    const emptyResult = LyricsService.parseClockTime('');
    const invalidResult = LyricsService.parseClockTime('invalid');
    const colonResult = LyricsService.parseClockTime('abc:def');

    console.log(`      [EMPIRICAL OBSERVATION] parseClockTime(''): ${emptyResult}`);
    console.log(`      [EMPIRICAL OBSERVATION] parseClockTime('invalid'): ${invalidResult}`);
    console.log(`      [EMPIRICAL OBSERVATION] parseClockTime('abc:def'): ${colonResult}`);

    assert.ok(Number.isNaN(emptyResult));
    assert.ok(Number.isNaN(invalidResult));
    assert.ok(Number.isNaN(colonResult));
  });

  // --------------------------------------------------------------------------
  // FINDING 3: Boundary Inclusive Overlap Non-Determinism in Binary Search
  // --------------------------------------------------------------------------
  test('FINDING-03: getActiveLineIndex exhibits non-deterministic boundary line selection depending on array length', () => {
    // Line 0 ends at 2000, Line 1 starts at 2000
    const twoLines = {
      type: 'LINE_SYNCED',
      provider: 'Test',
      lines: [
        { startTimeMs: 0, endTimeMs: 2000, text: 'First' },
        { startTimeMs: 2000, endTimeMs: 4000, text: 'Second' },
      ],
    };
    const threeLines = {
      type: 'LINE_SYNCED',
      provider: 'Test',
      lines: [
        { startTimeMs: 0, endTimeMs: 2000, text: 'First' },
        { startTimeMs: 2000, endTimeMs: 4000, text: 'Second' },
        { startTimeMs: 4000, endTimeMs: 6000, text: 'Third' },
      ],
    };

    const res2 = LyricsService.getActiveLineIndex(twoLines, 2000);
    const res3 = LyricsService.getActiveLineIndex(threeLines, 2000);

    console.log(`      [EMPIRICAL OBSERVATION] At exact boundary 2000ms:`);
    console.log(`        - With 2 lines, activeLineIndex is: ${res2} (Line "${twoLines.lines[res2].text}")`);
    console.log(`        - With 3 lines, activeLineIndex is: ${res3} (Line "${threeLines.lines[res3].text}")`);

    // Demonstrates that adding a third line alters the resolution of the 0/1 boundary
    assert.strictEqual(res2, 0);
    assert.strictEqual(res3, 1);
  });

  // --------------------------------------------------------------------------
  // FINDING 4: PartySyncClient Single-Sample Jitter Vulnerability
  // --------------------------------------------------------------------------
  test('FINDING-04: Single asymmetric network delay spike jumps NTP clockOffset without smoothing', () => {
    const client = new PartySyncClient();
    const trueOffset = 0;

    // Normal ping/pong: RTT = 20ms
    const t0 = 100000;
    client.handleFrame({
      type: 'pong',
      clientMs: t0,
      serverMs: t0 + 10, // server at t0 + 10ms
    });
    // Offset should be 0
    // Wait, in handleFrame, Date.now() is used, so let's mock Date.now()
    const origNow = Date.now;
    try {
      let mockTime = 100020;
      Date.now = () => mockTime;

      client.handleFrame({
        type: 'pong',
        clientMs: 100000,
        serverMs: 100010,
      });
      const normalOffset = client.getClockOffsetMs();
      console.log(`      [EMPIRICAL OBSERVATION] Normal ping/pong offset (RTT=20ms): ${normalOffset}ms`);

      // Asymmetric spike: pong delayed by 500ms on return path (now = 100520)
      mockTime = 100520;
      client.handleFrame({
        type: 'pong',
        clientMs: 100000,
        serverMs: 100010, // server replied normally at 100010, but client received late
      });
      const jitterOffset = client.getClockOffsetMs();
      console.log(`      [EMPIRICAL OBSERVATION] Single asymmetric spike offset: ${jitterOffset}ms`);

      // Demonstrates that offset instantly jumps by 250ms due to lack of EMA/median filter
      assert.ok(
        Math.abs(jitterOffset - normalOffset) >= 200,
        `Expected jitter jump >= 200ms, got ${Math.abs(jitterOffset - normalOffset)}ms`
      );
    } finally {
      Date.now = origNow;
    }
  });

  // --------------------------------------------------------------------------
  // FINDING 5: PartySyncClient Malformed Frame Handling
  // --------------------------------------------------------------------------
  test('FINDING-05: handleFrame throws TypeError when state frame has missing playback property', () => {
    const client = new PartySyncClient();
    
    // When ws receives a frame, it calls handleFrame(frame)
    // If server sends a state frame without playback (e.g. malformed or partial), handleFrame throws:
    assert.throws(
      () => client.handleFrame({ type: 'state' }),
      TypeError
    );
  });
});
