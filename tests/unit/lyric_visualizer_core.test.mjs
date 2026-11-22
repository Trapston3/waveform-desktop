import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

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
  getStyleDefinition,
  resolveStyleVariationId,
  BUNDLED_FONTS,
  SF_PRO_DISPLAY_STACK,
  DEFAULT_LYRIC_VISUALIZER_CONFIG,
  STARLIGHT_HARBOR_TRACK,
  STARLIGHT_HARBOR_LYRICS,
  rgbToOklch,
  oklchToRgb,
  oklchToCss,
  contrastRatio,
  ensureContrastRgb,
  ensurePaletteContrast,
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
const { extractArtworkPaletteFromUrl, ensureReadableAccent } = await import('../../src/ui/theme/Theme.ts');
const { default: esbuild } = await import('esbuild');

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

test('models expose 12 consolidated visual styles, variations, legacy mappings, 8 bundled fonts, and Starlight Harbor demo', () => {
  const expectedIds = [
    'AppleMusicFlow',
    'TypewriterEditorial',
    'MinimalSwiss',
    'LiquidMetal',
    'KaraokeStage',
    'BrutalistZine',
    'GenerativeParticleInk',
    'Spatial3DDepth',
    'CRTScanline',
    'StarfieldShip3D',
    'IosTextingMotion',
    'CodeEditorKinetic',
  ];
  assert.equal(VISUAL_STYLE_DEFINITIONS.length, 12);
  const styleIds = new Set(VISUAL_STYLE_DEFINITIONS.map((s) => s.id));
  assert.equal(styleIds.size, 12);
  for (const id of expectedIds) {
    assert.ok(styleIds.has(id), `Missing consolidated style ${id}`);
  }
  for (const legacyId of ['NeonKinetic', 'HoloVaporwave', 'SpectrumRibbon']) {
    assert.equal(styleIds.has(legacyId), false, `${legacyId} must not be a top-level style`);
  }
  for (const style of VISUAL_STYLE_DEFINITIONS) {
    assert.ok(Array.isArray(style.variations) && style.variations.length >= 2, `${style.id} must expose variations`);
    assert.ok(
      style.variations.some((v) => v.id === style.defaultVariationId),
      `${style.id} defaultVariationId must exist in variations`
    );
  }
  assert.equal(getStyleDefinition('HoloVaporwave').id, 'LiquidMetal');
  assert.equal(resolveStyleVariationId('HoloVaporwave'), 'holo-vaporwave');
  assert.equal(getStyleDefinition('SpectrumRibbon').id, 'GenerativeParticleInk');
  assert.equal(resolveStyleVariationId('SpectrumRibbon'), 'spectrum-ribbon');
  assert.equal(getStyleDefinition('NeonKinetic').id, 'AppleMusicFlow');
  assert.equal(resolveStyleVariationId('NeonKinetic'), getStyleDefinition('AppleMusicFlow').defaultVariationId);

  assert.equal(BUNDLED_FONTS.length, 8);
  assert.equal(BUNDLED_FONTS[0].id, 'SFProDisplay');
  assert.equal(BUNDLED_FONTS[0].label, 'SF Pro Display');
  assert.equal(BUNDLED_FONTS[0].cssFamily, SF_PRO_DISPLAY_STACK);
  assert.equal(BUNDLED_FONTS[0].license, 'Bundled');
  for (const font of BUNDLED_FONTS.slice(1)) {
    assert.equal(font.license, 'OFL-1.1');
    assert.doesNotMatch(font.cssFamily, /apple-system|SF Pro|SFMono|BlinkMacSystemFont/i);
  }

  assert.equal(DEFAULT_LYRIC_VISUALIZER_CONFIG.styleId, 'AppleMusicFlow');
  assert.equal(DEFAULT_LYRIC_VISUALIZER_CONFIG.fontId, 'SFProDisplay');
  assert.equal(DEFAULT_LYRIC_VISUALIZER_CONFIG.motionIntensity, 'normal');
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

test('extractPaletteFromPixels and ensurePaletteContrast enforce >=7.0:1 textActive and >=4.5:1 upcoming/accent contrast', async () => {
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
    const upcomingRgb = parseCssRgb(palette.textUpcoming);
    const accentRgb = parseCssRgb(palette.accentPrimary);
    const deepRgb = parseCssRgb(palette.bgDeep);
    const midRgb = parseCssRgb(palette.bgMid);

    assert.ok(contrastRatio(textRgb, deepRgb) >= 7.0, `Expected >=7.0:1 textActive vs bgDeep for (${r},${g},${b})`);
    assert.ok(contrastRatio(textRgb, midRgb) >= 7.0, `Expected >=7.0:1 textActive vs bgMid for (${r},${g},${b})`);
    assert.ok(contrastRatio(upcomingRgb, deepRgb) >= 4.5, `Expected >=4.5:1 textUpcoming vs bgDeep`);
    assert.ok(contrastRatio(upcomingRgb, midRgb) >= 4.5, `Expected >=4.5:1 textUpcoming vs bgMid`);
    assert.ok(contrastRatio(accentRgb, deepRgb) >= 4.5, `Expected >=4.5:1 accentPrimary vs bgDeep`);
    assert.ok(contrastRatio(accentRgb, midRgb) >= 4.5, `Expected >=4.5:1 accentPrimary vs bgMid`);
  }

  // ensureContrastRgb lifts low-contrast foreground to target ratio
  const lifted = ensureContrastRgb({ r: 40, g: 50, b: 90 }, { r: 15, g: 20, b: 36 }, 7.0);
  assert.ok(contrastRatio(lifted, { r: 15, g: 20, b: 36 }) >= 7.0);

  // ensurePaletteContrast fixes an intentionally broken low-contrast palette
  const fixed = ensurePaletteContrast({
    bgDeep: '#e2e8f0',
    bgMid: '#cbd5e1',
    accentPrimary: '#334155',
    accentSecondary: '#1e293b',
    textActive: '#94a3b8',
    textUpcoming: '#64748b',
    textPassed: '#475569',
    oklchL: 0.7,
    oklchC: 0.05,
    oklchH: 220,
    isFallback: false,
  });
  const fixedDeep = parseCssRgb(fixed.bgDeep);
  const fixedMid = parseCssRgb(fixed.bgMid);
  assert.ok(contrastRatio(parseCssRgb(fixed.textActive), fixedDeep) >= 7.0);
  assert.ok(contrastRatio(parseCssRgb(fixed.textActive), fixedMid) >= 7.0);
  assert.ok(contrastRatio(parseCssRgb(fixed.accentPrimary), fixedMid) >= 4.5);

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

// ---------------------------------------------------------------------------
// 7. Multi-Color Album Art Extraction, Theme Palette Mapping, and hsl() Parsing
// ---------------------------------------------------------------------------

function circularHueDelta(a, b) {
  const diff = Math.abs((((a % 360) + 360) % 360) - (((b % 360) + 360) % 360));
  return diff > 180 ? 360 - diff : diff;
}

test('extractPaletteFromPixels preserves multiple distinct hues, builds 4 #rrggbb meshColors, and uses cool slate for monochrome', () => {
  const w = 20;
  const h = 20;
  const total = w * h;
  const rgba = new Uint8ClampedArray(total * 4);
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    if (i < total * 0.4) {
      // Vivid orange peak
      rgba[o] = 245; rgba[o + 1] = 118; rgba[o + 2] = 28; rgba[o + 3] = 255;
    } else if (i < total * 0.75) {
      // Distinct denim blue peak
      rgba[o] = 36; rgba[o + 1] = 98; rgba[o + 2] = 210; rgba[o + 3] = 255;
    } else {
      // Deep shadow (must be filtered from chromatic hue peaks)
      rgba[o] = 18; rgba[o + 1] = 18; rgba[o + 2] = 20; rgba[o + 3] = 255;
    }
  }

  const pal = extractPaletteFromPixels(rgba, w, h);
  assert.equal(pal.isFallback, false);
  assert.ok(Array.isArray(pal.meshColors) && pal.meshColors.length === 4);
  for (const hex of pal.meshColors) {
    assert.match(hex, /^#[0-9a-f]{6}$/i, `Expected #rrggbb mesh color, got ${hex}`);
  }

  const p1 = parseCssRgb(pal.accentPrimary);
  const p2 = parseCssRgb(pal.accentSecondary);
  const h1 = rgbToOklch(p1.r, p1.g, p1.b).h;
  const h2 = rgbToOklch(p2.r, p2.g, p2.b).h;
  assert.ok(circularHueDelta(h1, h2) >= 28, `Expected >=28 deg hue separation between primary (${h1}) and secondary (${h2})`);

  const c0Hex = pal.meshColors[0];
  const c1Hex = pal.meshColors[1];
  const c0H = rgbToOklch(parseInt(c0Hex.slice(1, 3), 16), parseInt(c0Hex.slice(3, 5), 16), parseInt(c0Hex.slice(5, 7), 16)).h;
  const c1H = rgbToOklch(parseInt(c1Hex.slice(1, 3), 16), parseInt(c1Hex.slice(3, 5), 16), parseInt(c1Hex.slice(5, 7), 16)).h;
  assert.ok(circularHueDelta(c0H, c1H) >= 28, `Expected meshColors[0..1] to preserve multi-color peaks (${c0Hex} vs ${c1Hex})`);

  // Grayscale cover -> cool slate-indigo (never red)
  const gray = makeSolidRgba(140, 140, 140, 255, 8, 8);
  const grayPal = extractPaletteFromPixels(gray.buf, 8, 8);
  assert.equal(grayPal.isFallback, false);
  assert.ok(grayPal.oklchH >= 200 && grayPal.oklchH <= 280, `Expected cool slate hue for grayscale, got ${grayPal.oklchH}`);
});

test('Theme extractArtworkPaletteFromUrl delegates to IPC getArtworkPixels and emits hex/rgba (no hsl fallback)', async () => {
  const prevWindow = globalThis.window;
  let ipcCalls = 0;
  const { buf } = makeSolidRgba(30, 175, 195, 255, 12, 12);

  globalThis.window = {
    electronAPI: {
      getArtworkPixels: async () => {
        ipcCalls++;
        return { width: 12, height: 12, rgba: new Uint8Array(buf) };
      },
    },
  };

  try {
    const pal = await extractArtworkPaletteFromUrl('https://cdn.example.com/multi-hue-album.jpg', 'Multi Hue');
    assert.equal(ipcCalls, 1);
    assert.match(pal.vibrantAccent, /^#[0-9a-f]{6}$/i);
    assert.match(pal.ambientBackground, /^#[0-9a-f]{6}$/i);
    assert.match(pal.edgeWash, /^rgba\(/);
    assert.match(pal.playerTint, /^rgba\(/);
    assert.ok(Array.isArray(pal.meshColors) && pal.meshColors.length === 4);
    for (const c of pal.meshColors) {
      assert.match(c, /^#[0-9a-f]{6}$/i);
    }

    // Empty URL deterministic fallback also avoids hsl() strings
    const emptyPal = await extractArtworkPaletteFromUrl('', 'Seeded Fallback Track');
    assert.match(emptyPal.vibrantAccent, /^#[0-9a-f]{6}$/i);
    assert.match(emptyPal.ambientBackground, /^#[0-9a-f]{6}$/i);
    assert.ok(Array.isArray(emptyPal.meshColors) && emptyPal.meshColors.length === 4);

    // ensureReadableAccent still handles hsl() inputs cleanly
    const readable = ensureReadableAccent('hsl(195, 85%, 52%)', false);
    assert.match(readable.subtle, /^rgba\(/);
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
  }
});

test('AppleMusicFluidMeshCanvas parses hsl()/hsla() colors without red fallback and preserves persistent WebGL/2D loop across color changes', () => {
  const src = readFileSync(path.join(rootDir, 'src/ui/player/AppleMusicFluidMeshCanvas.tsx'), 'utf8');
  const transpiled = esbuild.transformSync(src, {
    loader: 'tsx',
    format: 'cjs',
    target: 'es2022',
  }).code;

  const refs = [];
  const effects = [];
  let refCursor = 0;
  let effectCursor = 0;

  const depsChanged = (prevDeps, nextDeps) => {
    if (!prevDeps || !nextDeps || prevDeps.length !== nextDeps.length) return true;
    for (let i = 0; i < prevDeps.length; i++) {
      if (!Object.is(prevDeps[i], nextDeps[i])) return true;
    }
    return false;
  };

  const mockReact = {
    useRef(initial) {
      if (refCursor >= refs.length) {
        refs.push({ current: initial });
      }
      return refs[refCursor++];
    },
    useEffect(fn, deps) {
      const idx = effectCursor++;
      const prev = effects[idx];
      if (!prev || depsChanged(prev.deps, deps)) {
        effects[idx] = { fn, deps, cleanup: prev?.cleanup, needsRun: true };
      } else {
        effects[idx].needsRun = false;
      }
    },
    memo(c) {
      return c;
    },
    createElement(type, props) {
      return { type, props };
    },
  };

  const jsxRuntime = {
    jsx(type, props) {
      return { type, props };
    },
    jsxs(type, props) {
      return { type, props };
    },
  };

  const module = { exports: {} };
  const fn = new Function('require', 'module', 'exports', transpiled);
  fn((id) => {
    if (id === 'react') return mockReact;
    if (id === 'react/jsx-runtime') return jsxRuntime;
    throw new Error(`Unexpected import: ${id}`);
  }, module, module.exports);

  const { AppleMusicFluidMeshCanvas } = module.exports;

  const colorStops = [];
  const fillStyles = [];
  const mockCtx2d = {
    clearRect() {},
    fillRect() {},
    beginPath() {},
    arc() {},
    fill() {},
    set fillStyle(val) {
      fillStyles.push(val);
    },
    createRadialGradient() {
      return {
        addColorStop(stop, color) {
          colorStops.push([stop, color]);
        },
      };
    },
  };

  const mockCanvas = {
    width: 640,
    height: 360,
    getContext(kind) {
      return kind === '2d' ? mockCtx2d : null;
    },
  };

  const prevRaf = globalThis.requestAnimationFrame;
  const prevCancelRaf = globalThis.cancelAnimationFrame;
  const rafQueue = [];
  globalThis.requestAnimationFrame = (cb) => {
    rafQueue.push(cb);
    return rafQueue.length;
  };
  globalThis.cancelAnimationFrame = () => {};

  try {
    // Render 1 with hsl() and hsla() inputs
    refCursor = 0;
    effectCursor = 0;
    AppleMusicFluidMeshCanvas({
      colors: ['hsl(120, 100%, 50%)', 'hsla(240, 100%, 50%, 0.65)', 'hsl(195, 80%, 15%)', 'rgb(20, 40, 60)'],
      isPlaying: true,
      width: 640,
      height: 360,
    });
    // Bind canvasRef (first ref in component)
    refs[0].current = mockCanvas;
    for (const eff of effects) {
      if (eff.needsRun) eff.cleanup = eff.fn();
    }

    assert.ok(rafQueue.length >= 1);
    rafQueue.shift()(performance.now());

    const stop0Colors = colorStops.filter(([stop]) => stop === 0).map(([, col]) => col);
    assert.equal(stop0Colors[0], 'rgb(0, 255, 0)', 'hsl(120, 100%, 50%) must parse to pure green');
    assert.equal(stop0Colors[1], 'rgb(0, 0, 255)', 'hsla(240, 100%, 50%, 0.65) must parse to pure blue');
    assert.notEqual(stop0Colors[0], 'rgb(250, 45, 72)', 'Must never fall back to #FA2D48 red');
    assert.ok(!fillStyles[0].startsWith('rgb(250,'), 'Background must parse hsl(195, 80%, 15%) without red fallback');

    // Render 2 with updated colors: setup effect (effects[1]) MUST NOT re-run
    refCursor = 0;
    effectCursor = 0;
    AppleMusicFluidMeshCanvas({
      colors: ['hsl(30, 100%, 50%)', '#112233', '#05080c', 'rgba(10, 20, 30, 0.5)'],
      isPlaying: true,
      width: 640,
      height: 360,
    });
    assert.equal(effects[0].needsRun, true, 'Lightweight color-ref sync effect should run on color change');
    assert.equal(effects[1].needsRun, false, 'Persistent canvas/WebGL setup effect must NOT tear down on colors change');
  } finally {
    globalThis.requestAnimationFrame = prevRaf;
    globalThis.cancelAnimationFrame = prevCancelRaf;
  }
});
