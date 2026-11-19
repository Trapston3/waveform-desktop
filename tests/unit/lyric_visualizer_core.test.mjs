import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// Register ESM resolution hook so Node v25 can resolve extensionless relative .ts imports
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

const {
  VISUAL_STYLE_DEFINITIONS,
  BUNDLED_FONTS,
  DEFAULT_LYRIC_VISUALIZER_CONFIG,
  STARLIGHT_HARBOR_TRACK,
  STARLIGHT_HARBOR_LYRICS,
  rgbToOklch,
  oklchToRgb,
  oklchToCss,
  contrastRatio,
  DEMO_FALLBACK_PALETTE,
  extractPaletteFromPixels,
  extractPaletteFromArtworkUrl,
  parseLrc,
  synthesizeLyricsWords,
  SyncEngine,
  clampOffsetMs,
  LyricsPipeline,
  EmbeddedTrackLyricsProvider,
  LrclibLyricsProvider,
} = await import('../../src/lyricVisualizer/core/index.ts');

function parseCssRgb(css) {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(css);
  assert.ok(m, `Expected rgb/rgba string, got: ${css}`);
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
}

function makeSolidRgba(r, g, b, a = 255, width = 8, height = 8) {
  const buf = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    buf[o] = r;
    buf[o + 1] = g;
    buf[o + 2] = b;
    buf[o + 3] = a;
  }
  return { buf, width, height };
}

// ---------------------------------------------------------------------------
// 1. Models & Contracts
// ---------------------------------------------------------------------------

test('models expose 13 visual styles, 7 OFL fonts without Apple assets, and Starlight Harbor demo', () => {
  assert.equal(VISUAL_STYLE_DEFINITIONS.length, 13);
  const styleIds = new Set(VISUAL_STYLE_DEFINITIONS.map((s) => s.id));
  assert.equal(styleIds.size, 13);
  assert.ok(styleIds.has('AppleMusicFlow'));
  assert.ok(styleIds.has('StarfieldShip3D'));

  assert.equal(BUNDLED_FONTS.length, 7);
  for (const font of BUNDLED_FONTS) {
    assert.equal(font.license, 'OFL-1.1');
    assert.doesNotMatch(font.cssFamily, /apple-system|SF Pro|SFMono|BlinkMacSystemFont/i);
  }

  assert.equal(DEFAULT_LYRIC_VISUALIZER_CONFIG.styleId, 'AppleMusicFlow');
  assert.equal(STARLIGHT_HARBOR_TRACK.title, 'Starlight Harbor');
  assert.equal(STARLIGHT_HARBOR_TRACK.artist, 'WaveForm Studio');
  assert.equal(STARLIGHT_HARBOR_LYRICS.sourceKind, 'WordSynced');
  assert.ok(STARLIGHT_HARBOR_LYRICS.lines.length >= 5);
  for (const line of STARLIGHT_HARBOR_LYRICS.lines) {
    assert.ok(line.words.length > 0);
    assert.equal(line.isSynthesizedWords, false);
  }
});

// ---------------------------------------------------------------------------
// 2. OKLCH Math & WCAG AA Contrast Enforcement
// ---------------------------------------------------------------------------

test('OKLCH conversion roundtrips primary and midtone RGB values accurately', () => {
  const samples = [
    { r: 220, g: 50, b: 60 },
    { r: 40, g: 180, b: 120 },
    { r: 65, g: 105, b: 225 },
    { r: 128, g: 128, b: 128 },
  ];

  for (const sample of samples) {
    const oklch = rgbToOklch(sample.r, sample.g, sample.b);
    const back = oklchToRgb(oklch.L, oklch.C, oklch.h);
    assert.ok(Math.abs(back.r - sample.r) <= 2, `Red mismatch for ${JSON.stringify(sample)}`);
    assert.ok(Math.abs(back.g - sample.g) <= 2, `Green mismatch for ${JSON.stringify(sample)}`);
    assert.ok(Math.abs(back.b - sample.b) <= 2, `Blue mismatch for ${JSON.stringify(sample)}`);
  }

  assert.match(oklchToCss(0.7, 0.15, 210), /^rgb\(\d+, \d+, \d+\)$/);
  assert.match(oklchToCss(0.7, 0.15, 210, 0.5), /^rgba\(\d+, \d+, \d+, 0\.5\)$/);
});

test('extractPaletteFromPixels enforces WCAG AA (>= 4.5:1) on extreme white, black, and neon inputs', async () => {
  const extremeColors = [
    [255, 255, 255], // pure white
    [0, 0, 0],       // pure black
    [0, 255, 64],    // neon green
    [255, 255, 0],   // neon yellow
    [255, 0, 255],   // neon magenta
  ];

  for (const [r, g, b] of extremeColors) {
    const { buf, width, height } = makeSolidRgba(r, g, b);
    const palette = extractPaletteFromPixels(buf, width, height);
    assert.equal(palette.isFallback, false);

    const textRgb = parseCssRgb(palette.textActive);
    const deepRgb = parseCssRgb(palette.bgDeep);
    const midRgb = parseCssRgb(palette.bgMid);

    const cDeep = contrastRatio(textRgb, deepRgb);
    const cMid = contrastRatio(textRgb, midRgb);
    assert.ok(cDeep >= 4.5, `Expected >=4.5:1 vs bgDeep for (${r},${g},${b}), got ${cDeep}`);
    assert.ok(cMid >= 4.5, `Expected >=4.5:1 vs bgMid for (${r},${g},${b}), got ${cMid}`);
  }

  // Empty / fully transparent falls back cleanly
  const transparent = makeSolidRgba(255, 0, 0, 0, 4, 4);
  assert.deepEqual(extractPaletteFromPixels(transparent.buf, 4, 4), DEMO_FALLBACK_PALETTE);
  assert.deepEqual(await extractPaletteFromArtworkUrl(''), DEMO_FALLBACK_PALETTE);
});

// ---------------------------------------------------------------------------
// 3. LRC & ELRC Parser
// ---------------------------------------------------------------------------

test('parseLrc supports standard LRC, ELRC word tags, [offset], multi-timestamp, and sorting', () => {
  const elrc = [
    '[ti:Test Song]',
    '[offset:+500]',
    '[00:12.50]<00:12.50>Second <00:13.00>line',
    '[00:05.50][00:20.50]<00:05.50>First <00:06.00>chorus',
  ].join('\n');

  const parsed = parseLrc(elrc, { providerName: 'TestLRC', trackDurationSeconds: 30 });
  assert.ok(parsed);
  assert.equal(parsed.sourceKind, 'WordSynced');
  assert.equal(parsed.lines.length, 3);

  // [offset:+500] shifts 5.50s -> 5.00s, 12.50s -> 12.00s, 20.50s -> 20.00s
  assert.equal(parsed.lines[0].startSeconds, 5.0);
  assert.equal(parsed.lines[0].endSeconds, 12.0);
  assert.equal(parsed.lines[0].words.length, 2);
  assert.equal(parsed.lines[0].words[0].text, 'First');
  assert.equal(parsed.lines[0].words[1].startSeconds, 5.5);

  assert.equal(parsed.lines[1].startSeconds, 12.0);
  assert.equal(parsed.lines[1].endSeconds, 20.0);

  assert.equal(parsed.lines[2].startSeconds, 20.0);
  assert.equal(parsed.lines[2].text, 'First chorus');

  // Standard line-synced LRC with millisecond timestamps
  const stdLrc = '[00:01.250]Hello world\n[00:04.50]Goodbye';
  const stdParsed = parseLrc(stdLrc);
  assert.ok(stdParsed);
  assert.equal(stdParsed.sourceKind, 'LineSynced');
  assert.equal(stdParsed.lines[0].startSeconds, 1.25);
  assert.equal(stdParsed.lines[0].endSeconds, 4.5);
});

// ---------------------------------------------------------------------------
// 4. WordSynthesizer
// ---------------------------------------------------------------------------

test('synthesizeLyricsWords produces monotonic timings summing to line duration with punctuation hold', () => {
  const lineLyrics = {
    providerName: 'Test',
    sourceKind: 'LineSynced',
    lines: [
      {
        startSeconds: 10.0,
        endSeconds: 16.0,
        text: 'Go, extraordinary night!',
        words: [],
        isSynthesizedWords: false,
      },
    ],
  };

  const synth = synthesizeLyricsWords(lineLyrics, { sourceKind: 'FallbackSynthesis' });
  assert.equal(synth.sourceKind, 'FallbackSynthesis');
  const line = synth.lines[0];
  assert.equal(line.isSynthesizedWords, true);
  assert.equal(line.words.length, 3);

  assert.equal(line.words[0].startSeconds, 10.0);
  assert.ok(Math.abs(line.words[2].endSeconds - 16.0) < 1e-9);

  for (let i = 0; i < line.words.length; i++) {
    assert.ok(line.words[i].endSeconds > line.words[i].startSeconds);
    if (i > 0) {
      assert.equal(line.words[i].startSeconds, line.words[i - 1].endSeconds);
    }
  }

  // "extraordinary" (multi-syllable) should receive more time than "Go,"
  const goDur = line.words[0].endSeconds - line.words[0].startSeconds;
  const extraDur = line.words[1].endSeconds - line.words[1].startSeconds;
  assert.ok(extraDur > goDur);
});

// ---------------------------------------------------------------------------
// 5. SyncEngine
// ---------------------------------------------------------------------------

test('SyncEngine handles monotonic extrapolation, offset clamping, seek snaps, and >12s instrumental fade', () => {
  const engine = new SyncEngine();
  assert.equal(clampOffsetMs(5000), 2000);
  assert.equal(clampOffsetMs(-9999), -2000);

  const lyrics = {
    providerName: 'Test',
    sourceKind: 'WordSynced',
    lines: [
      {
        startSeconds: 2.0,
        endSeconds: 5.0,
        text: 'Alpha Beta',
        isSynthesizedWords: false,
        words: [
          { text: 'Alpha', startSeconds: 2.0, endSeconds: 3.5 },
          { text: 'Beta', startSeconds: 3.5, endSeconds: 5.0 },
        ],
      },
      {
        startSeconds: 25.0,
        endSeconds: 28.0,
        text: 'Gamma',
        isSynthesizedWords: false,
        words: [{ text: 'Gamma', startSeconds: 25.0, endSeconds: 28.0 }],
      },
    ],
  };

  const track = { id: 't1', title: 'T1', artist: 'A1', durationSeconds: 40 };

  // Frame 1: track starts at 2.0s
  const f1 = engine.update(
    { track, positionSeconds: 2.0, isPlaying: true, playbackRate: 1, timestampMs: 1000 },
    lyrics,
    1750, // +0.75s elapsed => 2.75s
  );
  assert.equal(f1.didSeekThisFrame, true); // first frame for track
  assert.ok(Math.abs(f1.timeSeconds - 2.75) < 1e-6);
  assert.equal(f1.activeLineIndex, 0);
  assert.equal(f1.activeWordIndex, 0);
  assert.ok(Math.abs(f1.wordProgress - 0.5) < 1e-6);
  assert.equal(f1.lineFadeAlpha, 1);

  // Frame 2: normal progression -> didSeekThisFrame = false
  const f2 = engine.update(
    { track, positionSeconds: 2.0, isPlaying: true, playbackRate: 1, timestampMs: 1000 },
    lyrics,
    2500, // 3.5s
  );
  assert.equal(f2.didSeekThisFrame, false);
  assert.equal(f2.activeWordIndex, 1);

  // Frame 3: seek into >12s instrumental gap (5.0s -> 25.0s, at t = 19.0s -> 14s silence > 12s)
  const f3 = engine.update(
    { track, positionSeconds: 19.0, isPlaying: true, playbackRate: 1, timestampMs: 3000, didSeek: true },
    lyrics,
    3000,
  );
  assert.equal(f3.didSeekThisFrame, true);
  assert.equal(f3.activeLineIndex, -1);
  assert.ok(f3.lineFadeAlpha < 0.5, `Expected instrumental fade < 0.5, got ${f3.lineFadeAlpha}`);

  // Offset nudge (+500ms)
  engine.setOffsetMs(500);
  const f4 = engine.update(
    { track, positionSeconds: 24.6, isPlaying: false, playbackRate: 1, timestampMs: 4000 },
    lyrics,
    5000,
  );
  assert.equal(f4.didSeekThisFrame, true);
  assert.ok(Math.abs(f4.timeSeconds - 25.1) < 1e-6);
  assert.equal(f4.activeLineIndex, 1);
});

// ---------------------------------------------------------------------------
// 6. LyricsPipeline
// ---------------------------------------------------------------------------

test('LyricsPipeline resolves embedded lyrics, caches results, synthesizes words, and respects AbortSignal', async () => {
  const cacheMap = new Map();
  let cacheWrites = 0;
  const pipeline = new LyricsPipeline({
    providers: [new EmbeddedTrackLyricsProvider()],
    cache: {
      getCachedLyrics: (k) => cacheMap.get(k) ?? null,
      setCachedLyrics: (k, v) => {
        cacheWrites++;
        cacheMap.set(k, v);
      },
    },
  });

  const track = {
    id: 'song-123',
    title: 'Line Synced Song',
    artist: 'Tester',
    durationSeconds: 30,
    rawSyncedLyrics: '[00:01.00]Hello bright world\n[00:05.00]Second line',
  };

  const res1 = await pipeline.resolveLyricsAsync(track);
  assert.ok(res1);
  assert.equal(cacheWrites, 1);
  assert.equal(res1.lines[0].isSynthesizedWords, true);
  assert.equal(res1.lines[0].words.length, 3);

  // Second call hits cache without re-writing
  const res2 = await pipeline.resolveLyricsAsync(track);
  assert.ok(res2);
  assert.equal(cacheWrites, 1);

  // AbortSignal returns null cleanly
  const ac = new AbortController();
  ac.abort();
  const abortedRes = await pipeline.resolveLyricsAsync(track, ac.signal);
  assert.equal(abortedRes, null);

  // LrclibLyricsProvider handles fetch errors gracefully without rejecting
  const failingLrclib = new LrclibLyricsProvider({
    fetchFn: async () => {
      throw new Error('Network down');
    },
  });
  const nullRes = await failingLrclib.getLyricsAsync({
    id: 'missing',
    title: 'Missing',
    artist: 'Nobody',
    durationSeconds: 100,
  });
  assert.equal(nullRes, null);
});
