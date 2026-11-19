// tests/adversarial_challenge_m1_r2.mjs
// Adversarial Empirical Challenge & Stress Test Suite for Milestone 1 Iteration 2
// Focus: AudioEngine crossfade dynamics & Range header parser hardening + CDN routing

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// ESM loader hook to mock 'electron' module and resolve .ts extensions in pure Node
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return {
      url: 'data:text/javascript,' + encodeURIComponent(\`
        export const app = {
          commandLine: { appendSwitch() {} },
          requestSingleInstanceLock() { return false; },
          quit() {},
          on() {},
          whenReady() { return new Promise(() => {}); }
        };
        export const BrowserWindow = class {
          static getAllWindows() { return []; }
        };
        export const ipcMain = { handle() {}, on() {} };
        export const Menu = { buildFromTemplate() { return {}; }, setApplicationMenu() {} };
        export const Tray = class { setToolTip() {} setContextMenu() {} };
        export const nativeImage = { createEmpty() { return {}; } };
        export const session = {
          defaultSession: {
            webRequest: {
              onBeforeSendHeaders() {},
              onHeadersReceived() {}
            }
          }
        };
      \`),
      format: 'module',
      shortCircuit: true
    };
  }
  if (specifier.startsWith('.') && !specifier.endsWith('.ts') && !specifier.endsWith('.js') && !specifier.endsWith('.mjs')) {
    try {
      return await nextResolve(specifier + '.ts', context);
    } catch {}
  }
  return nextResolve(specifier, context);
}
`;

register('data:text/javascript,' + encodeURIComponent(hook), import.meta.url);

// Import compiled main process functions and TypeScript AudioEngine
const { rewriteRangeHeader } = await import('../dist-electron/main.js');
const { AudioEngine } = await import('../src/audio/AudioEngine.ts');
const { mockSongs } = await import('./fixtures/mockSongs.mjs');

// ---------------------------------------------------------------------------
// SUITE 1: RANGE HEADER PARSER STRESS TESTING (RFC 7233 / RFC 9110)
// ---------------------------------------------------------------------------
describe('Range Header Parser Stress Suite (rewriteRangeHeader in electron/main.ts)', () => {
  const CHUNK_SIZE = 256 * 1024; // 262,144 bytes

  test('R01: Standard byte ranges within max chunk size pass through cleanly', () => {
    assert.strictEqual(rewriteRangeHeader('bytes=0-1000'), 'bytes=0-1000');
    assert.strictEqual(rewriteRangeHeader('bytes=5000-15000'), 'bytes=5000-15000');
    assert.strictEqual(rewriteRangeHeader('bytes=100-262243'), 'bytes=100-262243'); // exactly 256KB
  });

  test('R02: Standard byte ranges exceeding max chunk size are clamped to 256KB', () => {
    // 0 to 1,000,000 exceeds 256KB -> clamped to 0..262143
    assert.strictEqual(rewriteRangeHeader('bytes=0-1000000'), 'bytes=0-262143');
    // 500,000 to 2,000,000 -> clamped to 500,000..(500,000 + 262,144 - 1) = 500000-762143
    assert.strictEqual(rewriteRangeHeader('bytes=500000-2000000'), 'bytes=500000-762143');
  });

  test('R03: Open-ended ranges (bytes=START-) are bounded to 256KB', () => {
    assert.strictEqual(rewriteRangeHeader('bytes=0-'), 'bytes=0-262143');
    assert.strictEqual(rewriteRangeHeader('bytes=100000-'), 'bytes=100000-362143');
  });

  test('R04: Open-ended ranges with knownContentLength > 256KB clamp to 256KB', () => {
    const clen = 5_000_000;
    assert.strictEqual(rewriteRangeHeader('bytes=0-', clen), 'bytes=0-262143');
    assert.strictEqual(rewriteRangeHeader('bytes=1000000-', clen), 'bytes=1000000-1262143');
  });

  test('R05: Open-ended ranges with knownContentLength < 256KB clamp to EOF (prevents 416)', () => {
    const clen = 100_000; // smaller than 256KB
    // Range must not exceed clen - 1
    assert.strictEqual(rewriteRangeHeader('bytes=0-', clen), 'bytes=0-99999');
    assert.strictEqual(rewriteRangeHeader('bytes=50000-', clen), 'bytes=50000-99999');
  });

  test('R06: RFC 7233 Suffix ranges (bytes=-SUFFIX) with knownContentLength compute exact end slice', () => {
    const clen = 1_000_000;
    // Suffix 500 bytes -> 1,000,000 - 500 = 999,500 to 999,999 (500 bytes)
    assert.strictEqual(rewriteRangeHeader('bytes=-500', clen), 'bytes=999500-999999');
    // Suffix when clen is smaller than suffix: e.g. suffix 500 on 200 byte file -> 0..199
    assert.strictEqual(rewriteRangeHeader('bytes=-500', 200), 'bytes=0-199');
  });

  test('R07: RFC 7233 Suffix ranges without knownContentLength clamp to max chunk size', () => {
    assert.strictEqual(rewriteRangeHeader('bytes=-500'), 'bytes=-500');
    assert.strictEqual(rewriteRangeHeader('bytes=-500000'), `bytes=-${CHUNK_SIZE}`);
  });

  test('R08: Suffix range exceeding 256KB with knownContentLength clamps to 256KB from end', () => {
    const clen = 1_000_000;
    // Suffix 500,000 clamped to 262,144: start = 1,000,000 - 262,144 = 737,856; end = 999,999
    assert.strictEqual(rewriteRangeHeader('bytes=-500000', clen), 'bytes=737856-999999');
  });

  test('R09: Missing, null, undefined, or empty Range headers generate valid initial 256KB chunk', () => {
    assert.strictEqual(rewriteRangeHeader(undefined), 'bytes=0-262143');
    assert.strictEqual(rewriteRangeHeader(null), 'bytes=0-262143');
    assert.strictEqual(rewriteRangeHeader(''), 'bytes=0-262143');
    // With knownContentLength < 256KB
    assert.strictEqual(rewriteRangeHeader(undefined, 50000), 'bytes=0-49999');
  });

  test('R10: Malformed/non-numeric range headers return safely without NaN or crash', () => {
    const badRangesWithoutNaN = [
      'bytes=abc-def',
      'bytes=-',
      'bytes=---',
      'bytes=foo',
      'bytes=-abc',
      'bytes=??clen=123',
      'invalid-header-string',
      'bytes=100-50', // inverted: end < start
    ];

    for (const raw of badRangesWithoutNaN) {
      const res = rewriteRangeHeader(raw);
      assert.ok(typeof res === 'string', `Result for ${raw} must be string`);
      assert.ok(!res.includes('NaN'), `Result for ${raw} must not generate NaN, got: ${res}`);
      // Inverted or invalid ranges should return untouched safely so server returns RFC 416
      if (raw === 'bytes=100-50' || raw === 'bytes=abc-def') {
        assert.strictEqual(res, raw);
      }
    }

    // Input with literal NaN is returned as-is without throwing
    assert.strictEqual(rewriteRangeHeader('bytes=0-NaN'), 'bytes=0-NaN');
    assert.strictEqual(rewriteRangeHeader('bytes=NaN-100'), 'bytes=NaN-100');
  });

  test('R11: Suffix length of 0 (bytes=-0) is preserved safely (triggers standard 416)', () => {
    const res = rewriteRangeHeader('bytes=-0');
    assert.strictEqual(res, 'bytes=-0');
  });

  test('R12: Start at or past knownContentLength prevents past-EOF inversion', () => {
    const clen = 100_000;
    // Start at EOF: start = 100,000. Clamping targetEnd must not make targetEnd < start
    const res = rewriteRangeHeader('bytes=100000-', clen);
    assert.ok(res.startsWith('bytes=100000-'));
    assert.ok(!res.includes('NaN'));
    // Start way past EOF: start = 200,000
    const res2 = rewriteRangeHeader('bytes=200000-', clen);
    assert.strictEqual(res2, 'bytes=200000-200000');
  });

  test('R13: Multi-range specs extract first range without corruption', () => {
    const res = rewriteRangeHeader('bytes=0-100, 200-300');
    assert.strictEqual(res, 'bytes=0-100');
  });

  test('R14: Case-insensitivity and whitespace resilience', () => {
    assert.strictEqual(rewriteRangeHeader('BYTES=0-'), 'bytes=0-262143');
    assert.strictEqual(rewriteRangeHeader('  bytes = 0-100  '), 'bytes=0-100');
    assert.strictEqual(rewriteRangeHeader('Bytes=-500', 1000), 'bytes=500-999');
  });

  test('R15: Non-string types (boolean, number, object) do not crash parser', () => {
    assert.strictEqual(rewriteRangeHeader(12345), 12345);
    assert.strictEqual(rewriteRangeHeader(true), true);
    assert.deepStrictEqual(rewriteRangeHeader({}), {});
  });
});

// ---------------------------------------------------------------------------
// SUITE 2: CDN DIFFERENTIATION & JIOSAAVN STREAM BYPASS
// ---------------------------------------------------------------------------
describe('CDN Differentiation & Non-GoogleVideo Stream Bypass', () => {
  // Simulate electron/main.ts onBeforeSendHeaders logic
  function simulateOnBeforeSendHeaders(url, headers) {
    const requestHeaders = { ...headers };

    if (url.includes('googlevideo.com')) {
      delete requestHeaders['Origin'];
      delete requestHeaders['Referer'];
      delete requestHeaders['origin'];
      delete requestHeaders['referer'];
      requestHeaders['User-Agent'] =
        'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)';

      let clen = null;
      try {
        const parsedUrl = new URL(url);
        const clenParam = parsedUrl.searchParams.get('clen');
        if (clenParam) {
          const parsed = parseInt(clenParam, 10);
          if (!isNaN(parsed) && parsed > 0) clen = parsed;
        }
      } catch {}

      const rawRange = requestHeaders['Range'] || requestHeaders['range'];
      const rewritten = rewriteRangeHeader(rawRange, clen);
      if (rewritten) {
        requestHeaders['Range'] = rewritten;
        delete requestHeaders['range'];
      }
    } else if (url.includes('music.youtube.com')) {
      requestHeaders['Origin'] = 'https://music.youtube.com';
      requestHeaders['Referer'] = 'https://music.youtube.com/';
    } else if (url.includes('youtube.com')) {
      requestHeaders['Origin'] = 'https://www.youtube.com';
      requestHeaders['Referer'] = 'https://www.youtube.com/';
    } else if (url.includes('jiosaavn.com') || url.includes('saavncdn.com')) {
      requestHeaders['Origin'] = 'https://www.jiosaavn.com';
      requestHeaders['Referer'] = 'https://www.jiosaavn.com/';
    }

    if (!requestHeaders['User-Agent'] || requestHeaders['User-Agent'].includes('Electron')) {
      requestHeaders['User-Agent'] =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    }

    return requestHeaders;
  }

  test('C01: JioSaavn CDN (aac.saavncdn.com) is unencumbered by 256KB chunking', () => {
    const url = 'https://aac.saavncdn.com/123/ode_to_the_mets_320.mp4';
    const originalRange = 'bytes=0-10485760'; // 10MB range request
    const inHeaders = {
      Range: originalRange,
      'User-Agent': 'Mozilla/5.0 WaveForm',
    };

    const outHeaders = simulateOnBeforeSendHeaders(url, inHeaders);

    // Range must NOT be truncated to 256KB
    assert.strictEqual(outHeaders['Range'], originalRange, 'saavncdn Range must remain untouched');
    assert.strictEqual(outHeaders['Origin'], 'https://www.jiosaavn.com');
    assert.strictEqual(outHeaders['Referer'], 'https://www.jiosaavn.com/');
  });

  test('C02: JioSaavn API (www.jiosaavn.com) sets proper origin and referer', () => {
    const url = 'https://www.jiosaavn.com/api.php?__call=autocomplete.get&query=test';
    const outHeaders = simulateOnBeforeSendHeaders(url, {});

    assert.strictEqual(outHeaders['Origin'], 'https://www.jiosaavn.com');
    assert.strictEqual(outHeaders['Referer'], 'https://www.jiosaavn.com/');
  });

  test('C03: GoogleVideo stream URLs ARE chunked to 256KB and strip Origin/Referer', () => {
    const url = 'https://rr3---sn-4g5edn6s.googlevideo.com/videoplayback?expire=123&clen=5000000';
    const inHeaders = {
      Range: 'bytes=0-',
      Origin: 'https://music.youtube.com',
      Referer: 'https://music.youtube.com/',
      'User-Agent': 'Mozilla/5.0',
    };

    const outHeaders = simulateOnBeforeSendHeaders(url, inHeaders);

    assert.strictEqual(outHeaders['Range'], 'bytes=0-262143', 'GoogleVideo Range must be 256KB chunk');
    assert.strictEqual(outHeaders['Origin'], undefined, 'Origin must be deleted');
    assert.strictEqual(outHeaders['Referer'], undefined, 'Referer must be deleted');
    assert.ok(outHeaders['User-Agent'].includes('com.google.ios.youtube'), 'User-Agent must be iOS profile');
  });
});

// ---------------------------------------------------------------------------
// SUITE 3: AUDIO ENGINE CROSSFADER EMPIRICAL STRESS SUITE
// ---------------------------------------------------------------------------
describe('AudioEngine Crossfade Empirical Verification & Stress Suite', () => {
  test('X01: Mathematical Constant-Power Equal-Energy Curve Verification', () => {
    // Verify cos^2(pi/2 * t) + sin^2(pi/2 * t) == 1.0 across all 64 steps
    const steps = 64;
    let maxPowerDeviation = 0;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const fadeOut = Math.cos((Math.PI / 2) * t);
      const fadeIn = Math.sin((Math.PI / 2) * t);
      const totalPower = fadeOut * fadeOut + fadeIn * fadeIn;
      const deviation = Math.abs(totalPower - 1.0);
      if (deviation > maxPowerDeviation) {
        maxPowerDeviation = deviation;
      }
      assert.ok(fadeOut >= 0 && fadeOut <= 1.0, `fadeOut at step ${i} out of bounds: ${fadeOut}`);
      assert.ok(fadeIn >= 0 && fadeIn <= 1.0, `fadeIn at step ${i} out of bounds: ${fadeIn}`);
    }

    assert.ok(
      maxPowerDeviation < 1e-6,
      `Max constant-power deviation ${maxPowerDeviation} exceeds 1e-6 tolerance`
    );
  });

  test('X02: Full 4-Second Crossfade Execution with Web Audio Mock Topology', async () => {
    // Construct mock Web Audio context tracking setValueCurveAtTime automation
    const scheduledCurves = {
      outgoing: [],
      incoming: [],
      cancelled: [],
    };

    class MockGainNode {
      gain = {
        value: 1.0,
        cancelScheduledValues: (time) => {
          scheduledCurves.cancelled.push(time);
        },
        setValueCurveAtTime: (values, startTime, duration) => {
          if (scheduledCurves.outgoing.length === 0) {
            scheduledCurves.outgoing.push({ values, startTime, duration });
          } else {
            scheduledCurves.incoming.push({ values, startTime, duration });
          }
        },
        setValueAtTime: (val, _t) => {
          this.gain.value = val;
        },
        setTargetAtTime: (val, _t, _c) => {
          this.gain.value = val;
        },
      };
      connect() {}
      disconnect() {}
    }

    class MockAudioContext {
      currentTime = 10.0;
      state = 'running';
      destination = {};
      createGain() {
        return new MockGainNode();
      }
      createBiquadFilter() {
        return {
          type: 'peaking',
          frequency: { setValueAtTime() {}, value: 1000 },
          gain: { setValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {}, value: 0 },
          Q: { setValueAtTime() {}, value: 1 },
          connect() {},
        };
      }
      createAnalyser() {
        return {
          connect() {},
          getFloatTimeDomainData() {},
          frequencyBinCount: 1024,
        };
      }
      resume() {
        return Promise.resolve();
      }
    }

    const mockCtx = new MockAudioContext();
    const engine = new AudioEngine(mockCtx);

    // Manually attach mock fader nodes
    const outGain = new MockGainNode();
    const inGain = new MockGainNode();
    engine.deckA.faderNode = outGain;
    engine.deckB.faderNode = inGain;

    const track1 = { ...mockSongs.standardYouTube, videoId: 'trk_1', title: 'Track 1' };
    const track2 = { ...mockSongs.standardYouTube, videoId: 'trk_2', title: 'Track 2' };

    await engine.loadTrack(track1, 'active');
    await engine.loadTrack(track2, 'standby');
    engine.play();

    assert.strictEqual(engine.activeDeckName, 'active');
    assert.strictEqual(engine.deckA.isPlaying, true);
    assert.strictEqual(engine.deckB.isPlaying, false);

    // Trigger crossfade with 50ms
    const crossfadePromise = engine.crossfade('standby', 50);

    // Immediately after starting crossfade:
    assert.strictEqual(engine.playbackState, 'CROSSFADING');
    // Incoming deck must start playing immediately
    assert.strictEqual(engine.deckB.isPlaying, true);
    // Outgoing deck must NOT be abruptly paused
    assert.strictEqual(engine.deckA.isPlaying, true);

    // Verify scheduled curves
    assert.strictEqual(scheduledCurves.outgoing.length, 1);
    assert.strictEqual(scheduledCurves.incoming.length, 1);
    const outCurve = scheduledCurves.outgoing[0];
    const inCurve = scheduledCurves.incoming[0];

    assert.strictEqual(outCurve.duration, 0.05);
    assert.strictEqual(inCurve.duration, 0.05);
    assert.strictEqual(outCurve.startTime, 10.0);
    assert.strictEqual(inCurve.startTime, 10.0);

    // Check boundary curve points: outCurve goes 1 -> 0, inCurve goes 0 -> 1
    assert.strictEqual(Math.round(outCurve.values[0] * 1000) / 1000, 1.0);
    assert.strictEqual(Math.round(outCurve.values[outCurve.values.length - 1] * 1000) / 1000, 0.0);
    assert.strictEqual(Math.round(inCurve.values[0] * 1000) / 1000, 0.0);
    assert.strictEqual(Math.round(inCurve.values[inCurve.values.length - 1] * 1000) / 1000, 1.0);

    // Await crossfade completion
    await crossfadePromise;

    // After crossfade completes:
    assert.strictEqual(engine.playbackState, 'PLAYING');
    assert.strictEqual(engine.activeDeckName, 'standby'); // Deck B is now active
    assert.strictEqual(engine.deckA.isPlaying, false, 'Outgoing deck must be paused at completion');
    assert.strictEqual(engine.deckB.isPlaying, true, 'Incoming deck must remain playing');
    assert.strictEqual(engine.deckA.gain, 0.0, 'Outgoing deck gain must be zeroed');
    assert.strictEqual(engine.deckB.gain, 1.0, 'Incoming deck gain must be 1.0');
  });

  test('X03: Pause Interruption mid-crossfade supersedes sequence and prevents revival', async () => {
    const engine = new AudioEngine();
    const track1 = { ...mockSongs.standardYouTube, videoId: 'trk_1', title: 'Track 1' };
    const track2 = { ...mockSongs.standardYouTube, videoId: 'trk_2', title: 'Track 2' };

    await engine.loadTrack(track1, 'active');
    await engine.loadTrack(track2, 'standby');
    engine.play();

    // Launch crossfade with 100ms
    const crossfadePromise = engine.crossfade('standby', 100);
    assert.strictEqual(engine.playbackState, 'CROSSFADING');

    // Pause mid-crossfade at 15ms
    await new Promise((r) => setTimeout(r, 15));
    engine.pause();

    assert.strictEqual(engine.playbackState, 'PAUSED');

    // Wait until original crossfade timer expires
    await crossfadePromise;

    // Engine must REMAIN paused and not be resurrected to 'PLAYING'
    assert.strictEqual(engine.playbackState, 'PAUSED', 'Engine must remain PAUSED after crossfade callback expires');
  });

  test('X04: Rapid consecutive crossfades (deck switching race) maintain state consistency', async () => {
    const engine = new AudioEngine();
    const track1 = { ...mockSongs.standardYouTube, videoId: 'trk_1', title: 'Track 1' };
    const track2 = { ...mockSongs.standardYouTube, videoId: 'trk_2', title: 'Track 2' };

    await engine.loadTrack(track1, 'active');
    await engine.loadTrack(track2, 'standby');
    engine.play();

    // Rapid crossfade 1
    const p1 = engine.crossfade('standby', 60);
    // Rapid crossfade 2 immediately after 10ms
    await new Promise((r) => setTimeout(r, 10));
    const p2 = engine.crossfade('standby', 60);

    await Promise.all([p1, p2]);

    assert.strictEqual(engine.playbackState, 'PLAYING');
    // Two crossfades: active -> standby -> active (lands back on deckA)
    assert.strictEqual(engine.activeDeckName, 'active');
    assert.strictEqual(engine.deckA.isPlaying, true);
    assert.strictEqual(engine.deckB.isPlaying, false);
    assert.strictEqual(engine.deckA.gain, 1.0);
    assert.strictEqual(engine.deckB.gain, 0.0);
  });

  test('X05: Crossfade throws descriptive error when standby deck has no track', async () => {
    const engine = new AudioEngine();
    await engine.loadTrack(mockSongs.standardYouTube, 'active');
    await assert.rejects(
      async () => engine.crossfade('standby', 1000),
      /Standby deck has no pre-rolled track for crossfading/
    );
  });

  test('X06: Crossfade throws error when target deck is invalid', async () => {
    const engine = new AudioEngine();
    await assert.rejects(
      async () => engine.crossfade('invalidDeck', 1000),
      /Target deck must be 'active' or 'standby'/
    );
  });
});
