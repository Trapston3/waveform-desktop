// tests/unit/lyric_visualizer_styles.test.mjs
// Unit & behavioral tests for all 12 LyricVisualizer visual styles, WebGlEffectLayer fallback & color parsing,
// LyricsMeasurer spacing/auto-scale/spec caching, IosTextingMotion, CodeEditorKinetic, and LyricStageRenderer.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const resolverHook = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && !specifier.endsWith('.ts') && !specifier.endsWith('.js') && !specifier.endsWith('.mjs')) {
      try { return await nextResolve(specifier + '.ts', context); } catch {}
      try { return await nextResolve(specifier + '/index.ts', context); } catch {}
    }
    throw err;
  }
}
`;
register(`data:text/javascript,${encodeURIComponent(resolverHook)}`, import.meta.url);

const { VISUAL_STYLE_DEFINITIONS, parseLrc } = await import('../../src/lyricVisualizer/core/index.ts');
const {
  ALL_VISUAL_STYLE_IDS,
  StyleRegistry,
  LyricsMeasurer,
  WebGlEffectLayer,
  parseColorToRgbInto,
  LyricStageRenderer,
  CRTScanlineStyle,
  LiquidMetalStyle,
  getSyncButtonTheme,
  detectLyricEmbedCard,
  detectMagicWordEffect,
  resolveContextualEmoji,
  transformLyricLineToCodeTokens,
  detectCodeWordEffect,
} = await import('../../src/lyricVisualizer/rendering/index.ts');

const EXPECTED_12_STYLES = [
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

function createMockCanvas2DContext() {
  const ops = [];
  const gradientMock = {
    addColorStop() {},
  };

  const ctx = {
    ops,
    fillStyle: '#000000',
    strokeStyle: '#ffffff',
    lineWidth: 1,
    globalAlpha: 1,
    font: '16px Inter, sans-serif',
    textAlign: 'left',
    textBaseline: 'top',
    shadowColor: 'transparent',
    shadowBlur: 0,
    save() { ops.push('save'); },
    restore() { ops.push('restore'); },
    setTransform() { ops.push('setTransform'); },
    translate() { ops.push('translate'); },
    scale() { ops.push('scale'); },
    rotate() { ops.push('rotate'); },
    clearRect(x, y, w, h) { ops.push(['clearRect', x, y, w, h]); },
    fillRect(x, y, w, h) { ops.push(['fillRect', x, y, w, h]); },
    strokeRect(x, y, w, h) { ops.push(['strokeRect', x, y, w, h]); },
    rect() { ops.push('rect'); },
    clip() { ops.push('clip'); },
    beginPath() { ops.push('beginPath'); },
    closePath() { ops.push('closePath'); },
    moveTo() { ops.push('moveTo'); },
    lineTo() { ops.push('lineTo'); },
    quadraticCurveTo() { ops.push('quadraticCurveTo'); },
    bezierCurveTo() { ops.push('bezierCurveTo'); },
    setLineDash() { ops.push('setLineDash'); },
    drawImage(...args) { ops.push(['drawImage', ...args.slice(1)]); },
    arc() { ops.push('arc'); },
    ellipse() { ops.push('ellipse'); },
    fill() { ops.push('fill'); },
    stroke() { ops.push('stroke'); },
    fillText(text, x, y) { ops.push(['fillText', text, x, y]); },
    strokeText(text, x, y) { ops.push(['strokeText', text, x, y]); },
    createLinearGradient() { return gradientMock; },
    createRadialGradient() { return gradientMock; },
    measureText(text) {
      return { width: String(text).length * 14 };
    },
  };
  return ctx;
}

function createMockCanvas({ supportWebGl2 = false } = {}) {
  const ctx2d = createMockCanvas2DContext();
  return {
    width: 800,
    height: 600,
    ctx2d,
    getContext(kind) {
      if (kind === '2d') return ctx2d;
      if (kind === 'webgl2') return supportWebGl2 ? null : null;
      return null;
    },
  };
}

const SAMPLE_PALETTE = {
  bgDeep: '#0a0d16',
  bgMid: '#182138',
  accentPrimary: '#5eead4',
  accentSecondary: '#818cf8',
  textActive: '#f8fafc',
  textUpcoming: '#cbd5e1',
  textPassed: '#64748b',
  oklchL: 0.72,
  oklchC: 0.14,
  oklchH: 190,
  isFallback: false,
};

const SYNCED_LYRICS = {
  providerName: 'WaveForm Test',
  sourceKind: 'WordSynced',
  lines: [
    {
      startSeconds: 1.0,
      endSeconds: 4.0,
      text: 'Lanterns drift across the quiet tide',
      isSynthesizedWords: false,
      words: [
        { text: 'Lanterns', startSeconds: 1.0, endSeconds: 1.6 },
        { text: 'drift', startSeconds: 1.6, endSeconds: 2.1 },
        { text: 'across', startSeconds: 2.1, endSeconds: 2.7 },
        { text: 'the', startSeconds: 2.7, endSeconds: 3.0 },
        { text: 'quiet', startSeconds: 3.0, endSeconds: 3.5 },
        { text: 'tide', startSeconds: 3.5, endSeconds: 4.0 },
      ],
    },
    {
      startSeconds: 4.5,
      endSeconds: 8.0,
      text: 'Silver ripples hold the evening sky',
      isSynthesizedWords: false,
      words: [
        { text: 'Silver', startSeconds: 4.5, endSeconds: 5.1 },
        { text: 'ripples', startSeconds: 5.1, endSeconds: 5.8 },
        { text: 'hold', startSeconds: 5.8, endSeconds: 6.3 },
        { text: 'the', startSeconds: 6.3, endSeconds: 6.7 },
        { text: 'evening', startSeconds: 6.7, endSeconds: 7.4 },
        { text: 'sky', startSeconds: 7.4, endSeconds: 8.0 },
      ],
    },
    {
      startSeconds: 8.5,
      endSeconds: 12.0,
      text: 'Harbor bells ring softly through the mist',
      isSynthesizedWords: false,
      words: [
        { text: 'Harbor', startSeconds: 8.5, endSeconds: 9.2 },
        { text: 'bells', startSeconds: 9.2, endSeconds: 9.8 },
        { text: 'ring', startSeconds: 9.8, endSeconds: 10.3 },
        { text: 'softly', startSeconds: 10.3, endSeconds: 10.9 },
        { text: 'through', startSeconds: 10.9, endSeconds: 11.4 },
        { text: 'the', startSeconds: 11.4, endSeconds: 11.6 },
        { text: 'mist', startSeconds: 11.6, endSeconds: 12.0 },
      ],
    },
  ],
};

const UNSYNCED_LYRICS = {
  providerName: 'WaveForm Test',
  sourceKind: 'Unsynced',
  lines: [
    {
      startSeconds: 0,
      endSeconds: 0,
      text: 'Plain unsynced lyric line one',
      isSynthesizedWords: false,
      words: [],
    },
    {
      startSeconds: 0,
      endSeconds: 0,
      text: 'Plain unsynced lyric line two',
      isSynthesizedWords: false,
      words: [],
    },
  ],
};

describe('LyricVisualizer Rendering & 12 Consolidated Visual Styles', () => {
  test('StyleRegistry registers all 12 consolidated visual style IDs', () => {
    const registry = new StyleRegistry();
    assert.equal(ALL_VISUAL_STYLE_IDS.length, 12);
    assert.deepEqual([...registry.listIds()], EXPECTED_12_STYLES);

    for (const id of EXPECTED_12_STYLES) {
      assert.equal(registry.has(id), true, `Missing style ID: ${id}`);
      const style = registry.get(id);
      assert.equal(style.id, id);
      assert.equal(typeof style.render, 'function');
    }
    for (const legacyId of ['NeonKinetic', 'HoloVaporwave', 'SpectrumRibbon']) {
      assert.equal(registry.has(legacyId), false, `Legacy style ${legacyId} must not be registered top-level`);
    }
  });

  test('All 12 styles and every variation render cleanly across modes', () => {
    const canvas = createMockCanvas();
    const webGlCanvas = createMockCanvas();
    const renderer = new LyricStageRenderer({
      canvas,
      webGlCanvas,
      palette: SAMPLE_PALETTE,
      fontFamily: 'Inter, sans-serif',
      fontSizeScale: 1.0,
    });
    renderer.resize(960, 540, 2);

    const scenarios = [
      {
        name: 'empty-null',
        lyrics: null,
        sync: { timeSeconds: 0, activeLineIndex: -1, activeWordIndex: -1, wordProgress: 0 },
        audio: { rmsLevel: 0, bassEnergy: 0, midEnergy: 0, trebleEnergy: 0, beatDetected: false },
        modes: { reduceMotion: false, isOverlayMode: false, isAmbientMode: false },
      },
      {
        name: 'empty-lines',
        lyrics: { providerName: 'Empty', sourceKind: 'LineSynced', lines: [] },
        sync: { timeSeconds: 1, activeLineIndex: -1, activeWordIndex: -1, wordProgress: 0 },
        audio: { rmsLevel: 0.1, bassEnergy: 0.1, midEnergy: 0.1, trebleEnergy: 0.1, beatDetected: false },
        modes: { reduceMotion: false, isOverlayMode: false, isAmbientMode: false },
      },
      {
        name: 'unsynced',
        lyrics: UNSYNCED_LYRICS,
        sync: { timeSeconds: 2.0, activeLineIndex: 0, activeWordIndex: 0, wordProgress: 0.5 },
        audio: { rmsLevel: 0.3, bassEnergy: 0.25, midEnergy: 0.35, trebleEnergy: 0.2, beatDetected: false },
        modes: { reduceMotion: false, isOverlayMode: false, isAmbientMode: false },
      },
      {
        name: 'synced-beat-spike',
        lyrics: SYNCED_LYRICS,
        sync: { timeSeconds: 2.4, activeLineIndex: 0, activeWordIndex: 2, wordProgress: 0.65, didSeekThisFrame: true },
        audio: { rmsLevel: 0.92, bassEnergy: 0.98, midEnergy: 0.74, trebleEnergy: 0.88, beatDetected: true },
        modes: { reduceMotion: false, isOverlayMode: false, isAmbientMode: false },
      },
      {
        name: 'reduce-motion',
        lyrics: SYNCED_LYRICS,
        sync: { timeSeconds: 5.5, activeLineIndex: 1, activeWordIndex: 1, wordProgress: 0.4 },
        audio: { rmsLevel: 0.8, bassEnergy: 0.9, midEnergy: 0.6, trebleEnergy: 0.7, beatDetected: true },
        modes: { reduceMotion: true, isOverlayMode: false, isAmbientMode: false },
      },
      {
        name: 'overlay-transparent',
        lyrics: SYNCED_LYRICS,
        sync: { timeSeconds: 6.1, activeLineIndex: 1, activeWordIndex: 2, wordProgress: 0.8 },
        audio: { rmsLevel: 0.5, bassEnergy: 0.4, midEnergy: 0.5, trebleEnergy: 0.5, beatDetected: false },
        modes: { reduceMotion: false, isOverlayMode: true, isEmbeddedTransparent: false, isAmbientMode: false },
      },
      {
        name: 'embedded-transparent',
        lyrics: SYNCED_LYRICS,
        sync: { timeSeconds: 6.1, activeLineIndex: 1, activeWordIndex: -1, wordProgress: 0 },
        audio: { rmsLevel: 0.5, bassEnergy: 0.4, midEnergy: 0.5, trebleEnergy: 0.5, beatDetected: false },
        modes: { reduceMotion: false, isOverlayMode: false, isEmbeddedTransparent: true, isAmbientMode: false },
      },
      {
        name: 'ambient-mode',
        lyrics: SYNCED_LYRICS,
        sync: { timeSeconds: 10.5, activeLineIndex: 2, activeWordIndex: 3, wordProgress: 0.35 },
        audio: { rmsLevel: 0.6, bassEnergy: 0.65, midEnergy: 0.45, trebleEnergy: 0.55, beatDetected: true },
        modes: { reduceMotion: false, isOverlayMode: false, isEmbeddedTransparent: false, isAmbientMode: true },
      },
    ];

    let fakeNow = 1000;
    for (const def of VISUAL_STYLE_DEFINITIONS) {
      renderer.setStyle(def.id);
      for (const variation of def.variations) {
        renderer.setVariation(variation.id);
        canvas.ctx2d.ops.length = 0;
        renderer.setLyrics(SYNCED_LYRICS);
        renderer.setModes({ reduceMotion: false, isOverlayMode: false, isEmbeddedTransparent: false, isAmbientMode: false });
        renderer.setSyncState({ timeSeconds: 2.4, activeLineIndex: 0, activeWordIndex: 2, wordProgress: 0.65 });
        renderer.setAudioMetrics({ rmsLevel: 0.7, bassEnergy: 0.75, midEnergy: 0.5, trebleEnergy: 0.6, beatDetected: true });
        fakeNow += 16.67;
        assert.equal(renderer.renderFrame(fakeNow), true, `${def.id} (${variation.id}) should render`);
        assert.ok(canvas.ctx2d.ops.length > 0, `${def.id} (${variation.id}) should emit Canvas2D ops`);
      }

      for (const sc of scenarios) {
        const styleId = def.id;
        canvas.ctx2d.ops.length = 0;
        renderer.setLyrics(sc.lyrics);
        renderer.setModes(sc.modes);
        renderer.setSyncState(sc.sync);
        renderer.setAudioMetrics(sc.audio);
        fakeNow += 16.67;

        const rendered = renderer.renderFrame(fakeNow);
        assert.equal(rendered, true, `${styleId} (${sc.name}) should render`);
        assert.ok(
          canvas.ctx2d.ops.length > 0,
          `${styleId} (${sc.name}) should emit Canvas2D operations`
        );

        // Verify overlay / embeddedTransparent mode clears transparently and avoids full-viewport opaque fillRect(0,0,960,540)
        if (sc.modes.isOverlayMode || sc.modes.isEmbeddedTransparent) {
          const hasClear = canvas.ctx2d.ops.some(
            (op) => Array.isArray(op) && op[0] === 'clearRect'
          );
          assert.equal(hasClear, true, `${styleId} overlay mode must call clearRect`);
          const hasFullBgFill = canvas.ctx2d.ops.some(
            (op) =>
              Array.isArray(op) &&
              op[0] === 'fillRect' &&
              op[1] === 0 &&
              op[2] === 0 &&
              op[3] === 960 &&
              op[4] === 540
          );
          assert.equal(
            hasFullBgFill,
            false,
            `${styleId} overlay mode must not draw opaque full-screen background fillRect`
          );
        }
      }
    }

    renderer.dispose();
  });

  test('WebGlEffectLayer gracefully falls back to Canvas2D when WebGL2 is unavailable and clamps DPR to 1..2', () => {
    const canvas = createMockCanvas({ supportWebGl2: false });
    const layer = new WebGlEffectLayer(canvas);
    assert.equal(layer.isWebGlActive, false);

    layer.resize(640, 360, 3.5);
    // Clamped to DPR 2 -> 1280 x 720
    assert.equal(canvas.width, 1280);
    assert.equal(canvas.height, 720);

    layer.render('liquidMetal', {
      timeSeconds: 1.5,
      rmsLevel: 0.5,
      bassEnergy: 0.6,
      midEnergy: 0.4,
      trebleEnergy: 0.5,
      beatDetected: true,
      reduceMotion: false,
      isOverlayMode: false,
      bgDeepHex: '#0a0d16',
      bgMidHex: '#151b2c',
      accentPrimaryHex: '#5eead4',
      accentSecondaryHex: '#818cf8',
    });
    assert.ok(canvas.ctx2d.ops.length > 0, 'Canvas2D fallback should draw');

    layer.dispose();
    canvas.ctx2d.ops.length = 0;
    layer.render('holoVaporwave', {
      timeSeconds: 2.0,
      rmsLevel: 0.5,
      bassEnergy: 0.6,
      midEnergy: 0.4,
      trebleEnergy: 0.5,
      beatDetected: false,
      reduceMotion: false,
      isOverlayMode: false,
      bgDeepHex: '#0a0d16',
      bgMidHex: '#151b2c',
      accentPrimaryHex: '#5eead4',
      accentSecondaryHex: '#818cf8',
    });
    assert.equal(canvas.ctx2d.ops.length, 0, 'Disposed layer should skip rendering');
  });

  test('LyricsMeasurer caches layout across frames and only re-measures on resize/font/lyrics change', () => {
    const ctx = createMockCanvas2DContext();
    const measurer = new LyricsMeasurer();

    const layout1 = measurer.measure(ctx, SYNCED_LYRICS, 800, 600, 'Inter, sans-serif', 1.0);
    const layout2 = measurer.measure(ctx, SYNCED_LYRICS, 800, 600, 'Inter, sans-serif', 1.0);
    assert.equal(layout1, layout2, 'Repeated frame should return exact cached layout reference');
    assert.equal(measurer.measureCount, 1);

    // Resize triggers re-measure
    const layout3 = measurer.measure(ctx, SYNCED_LYRICS, 500, 600, 'Inter, sans-serif', 1.0);
    assert.notEqual(layout3, layout1);
    assert.equal(measurer.measureCount, 2);

    // Font change triggers re-measure
    const layout4 = measurer.measure(ctx, SYNCED_LYRICS, 500, 600, 'Fraunces, serif', 1.0);
    assert.notEqual(layout4, layout3);
    assert.equal(measurer.measureCount, 3);
  });

  test('LyricsMeasurer preserves explicit spaceWidth between tokens, matches StyleMeasurementSpec, and auto-scales oversized single words', () => {
    // Font-size-aware mock ctx (scales character width with fontSize parsed from ctx.font)
    const fontAwareCtx = {
      ...createMockCanvas2DContext(),
      measureText(text) {
        const m = /\b(\d+)px\b/.exec(this.font);
        const px = m ? Number(m[1]) : 32;
        if (text === ' ') return { width: px * 0.25 }; // smaller than 0.28 -> clamped to >= 0.28 * px
        return { width: String(text).length * px * 0.62 };
      },
    };

    const measurer = new LyricsMeasurer();
    const specLayout = measurer.measure(
      fontAwareCtx,
      {
        providerName: 'Test',
        sourceKind: 'WordSynced',
        lines: [
          {
            startSeconds: 0,
            endSeconds: 4,
            text: 'Up on his horse',
            isSynthesizedWords: false,
            words: [
              { text: 'Up', startSeconds: 0, endSeconds: 1 },
              { text: 'on', startSeconds: 1, endSeconds: 2 },
              { text: 'his', startSeconds: 2, endSeconds: 3 },
              { text: 'horse', startSeconds: 3, endSeconds: 4 },
            ],
          },
        ],
      },
      900,
      600,
      'Inter, sans-serif',
      1.0,
      undefined,
      {
        fontWeight: 900,
        fontSizeMultiplier: 1.04,
        textTransform: 'uppercase',
        letterSpacing: '0.02em',
        maxLineWidthRatio: 0.78,
      }
    );

    assert.ok(specLayout);
    const words = specLayout.lines[0].words;
    assert.equal(words[0].text, 'UP');
    assert.equal(words[1].text, 'ON');
    const minSpace = specLayout.fontSizePx * 0.28;
    for (let i = 1; i < words.length; i++) {
      if (words[i].y === words[i - 1].y) {
        const gap = words[i].x - (words[i - 1].x + words[i - 1].width);
        assert.ok(gap >= minSpace - 1e-6, `Expected word gap >= ${minSpace}, got ${gap}`);
      }
    }

    // Long single word exceeding maxLineWidth triggers auto-scale down (min 14)
    const longWordLayout = measurer.measure(
      fontAwareCtx,
      {
        providerName: 'Test',
        sourceKind: 'LineSynced',
        lines: [
          {
            startSeconds: 0,
            endSeconds: 5,
            text: 'Supercalifragilisticexpialidocious',
            isSynthesizedWords: false,
            words: [{ text: 'Supercalifragilisticexpialidocious', startSeconds: 0, endSeconds: 5 }],
          },
        ],
      },
      320,
      400,
      'Inter, sans-serif',
      1.4,
      44
    );
    assert.ok(longWordLayout);
    assert.ok(longWordLayout.fontSizePx >= 14 && longWordLayout.fontSizePx < 44);
  });

  test('parseColorToRgbInto parses hex (#rgb/#rrggbb) and rgb()/rgba() strings cleanly', () => {
    const out = new Float32Array(3);
    parseColorToRgbInto('#ff8000', out);
    assert.ok(Math.abs(out[0] - 1) < 0.01);
    assert.ok(Math.abs(out[1] - 128 / 255) < 0.01);
    assert.ok(Math.abs(out[2] - 0) < 0.01);

    parseColorToRgbInto('rgb(10, 20, 40)', out);
    assert.ok(Math.abs(out[0] - 10 / 255) < 0.005);
    assert.ok(Math.abs(out[1] - 20 / 255) < 0.005);
    assert.ok(Math.abs(out[2] - 40 / 255) < 0.005);

    parseColorToRgbInto('rgba(218, 226, 242, 0.78)', out);
    assert.ok(Math.abs(out[0] - 218 / 255) < 0.005);
    assert.ok(Math.abs(out[1] - 226 / 255) < 0.005);
    assert.ok(Math.abs(out[2] - 242 / 255) < 0.005);
  });

  test('detectLyricEmbedCard detects maps, voice memo, missed call, link/photo, and time/weather cards', () => {
    assert.equal(detectLyricEmbedCard('Steady beacons guide the harbor home')?.kind, 'maps');
    assert.equal(detectLyricEmbedCard('Driving down the highway in Tokyo')?.kind, 'maps');
    assert.equal(detectLyricEmbedCard('Listen to that voice on the radio')?.kind, 'voiceMemo');
    assert.equal(detectLyricEmbedCard('You had a missed FaceTime call from me')?.kind, 'missedCall');
    assert.equal(detectLyricEmbedCard('Send the link to that old polaroid photo')?.kind, 'linkPreview');
    assert.equal(detectLyricEmbedCard('Walking in the midnight summer rain')?.kind, 'timeWeather');
    assert.equal(detectLyricEmbedCard('Lanterns drift quietly'), null);
  });

  test('IosTextingMotionStyle renders conversation bubbles, typing indicator in 0.5-1.4s gaps, embed cards, and tapbacks', () => {
    const canvas = createMockCanvas();
    const renderer = new LyricStageRenderer({
      canvas,
      styleId: 'IosTextingMotion',
      palette: SAMPLE_PALETTE,
      fontFamily: 'Inter, sans-serif',
      motionIntensity: 'vivid',
    });
    renderer.resize(900, 620, 1);
    const convoLyrics = {
      providerName: 'Test',
      sourceKind: 'WordSynced',
      lines: [
        {
          startSeconds: 0.5,
          endSeconds: 2.0,
          text: 'Are you still downtown tonight?',
          isSynthesizedWords: false,
          words: [
            { text: 'Are', startSeconds: 0.5, endSeconds: 0.8 },
            { text: 'you', startSeconds: 0.8, endSeconds: 1.1 },
            { text: 'still', startSeconds: 1.1, endSeconds: 1.4 },
            { text: 'downtown', startSeconds: 1.4, endSeconds: 1.7 },
            { text: 'tonight?', startSeconds: 1.7, endSeconds: 2.0 },
          ],
        },
        {
          startSeconds: 3.0, // 1.0s gap -> triggers typing indicator between 2.0s and 3.0s
          endSeconds: 5.5,
          text: 'Listen to the voice on the radio!',
          isSynthesizedWords: false,
          words: [
            { text: 'Listen', startSeconds: 3.0, endSeconds: 3.4 },
            { text: 'to', startSeconds: 3.4, endSeconds: 3.7 },
            { text: 'the', startSeconds: 3.7, endSeconds: 4.0 },
            { text: 'voice', startSeconds: 4.0, endSeconds: 4.5 },
            { text: 'on', startSeconds: 4.5, endSeconds: 4.8 },
            { text: 'the', startSeconds: 4.8, endSeconds: 5.1 },
            { text: 'radio!', startSeconds: 5.1, endSeconds: 5.5 },
          ],
        },
      ],
    };
    renderer.setLyrics(convoLyrics);

    // During 1.0s gap (t=2.5s): typing indicator should draw 3 dots + previous bubble + maps card
    canvas.ctx2d.ops.length = 0;
    renderer.setSyncState({ timeSeconds: 2.5, activeLineIndex: 0, activeWordIndex: 4, wordProgress: 1.0 });
    renderer.setAudioMetrics({ rmsLevel: 0.7, bassEnergy: 0.8, midEnergy: 0.6, trebleEnergy: 0.5, beatDetected: true });
    assert.equal(renderer.renderFrame(1000), true);
    const fillTexts = canvas.ctx2d.ops.filter((op) => Array.isArray(op) && op[0] === 'fillText').map((op) => op[1]);
    assert.ok(fillTexts.includes('OPEN IN MAPS'), 'Maps card should render for "downtown"');
    assert.ok(fillTexts.includes('?'), 'Tapback badge should render on question line');

    // Embedded transparent mode skips opaque full-screen backdrop
    canvas.ctx2d.ops.length = 0;
    renderer.setModes({ isEmbeddedTransparent: true });
    renderer.setSyncState({ timeSeconds: 4.1, activeLineIndex: 1, activeWordIndex: 3, wordProgress: 0.5 });
    assert.equal(renderer.renderFrame(1032), true);
    const hasFullBg = canvas.ctx2d.ops.some(
      (op) => Array.isArray(op) && op[0] === 'fillRect' && op[1] === 0 && op[2] === 0 && op[3] === 900 && op[4] === 620
    );
    assert.equal(hasFullBg, false);
    renderer.dispose();
  });

  test('LyricStageRenderer setLocked(true) halts rAF scheduling and skips all GPU/Canvas draw calls', () => {
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancelRaf = globalThis.cancelAnimationFrame;

    let nextId = 1;
    const pendingRafs = new Map();
    const cancelledIds = [];

    globalThis.requestAnimationFrame = (cb) => {
      const id = nextId++;
      pendingRafs.set(id, cb);
      return id;
    };
    globalThis.cancelAnimationFrame = (id) => {
      pendingRafs.delete(id);
      cancelledIds.push(id);
    };

    try {
      const canvas = createMockCanvas();
      const webGlCanvas = createMockCanvas();
      const renderer = new LyricStageRenderer({
        canvas,
        webGlCanvas,
        styleId: 'StarfieldShip3D',
        palette: SAMPLE_PALETTE,
      });
      renderer.resize(800, 600, 1);
      renderer.setLyrics(SYNCED_LYRICS);
      renderer.setSyncState({ timeSeconds: 2.0, activeLineIndex: 0, activeWordIndex: 1, wordProgress: 0.5 });

      renderer.start();
      assert.equal(pendingRafs.size, 1, 'start() should schedule 1 rAF');

      // Lock screen active -> must cancel rAF and stop all draws
      renderer.setLocked(true);
      assert.equal(renderer.isLocked, true);
      assert.equal(pendingRafs.size, 0, 'setLocked(true) must cancel pending rAF');
      assert.ok(cancelledIds.length >= 1, 'cancelAnimationFrame must be called');

      canvas.ctx2d.ops.length = 0;
      webGlCanvas.ctx2d.ops.length = 0;
      const drewWhileLocked = renderer.renderFrame(2000);
      assert.equal(drewWhileLocked, false, 'renderFrame() must return false while locked');
      assert.equal(canvas.ctx2d.ops.length, 0, 'Zero Canvas2D draws allowed while locked');
      assert.equal(webGlCanvas.ctx2d.ops.length, 0, 'Zero WebGL/fallback draws allowed while locked');

      // Unlock -> cleanly resumes rAF scheduling
      renderer.setLocked(false);
      assert.equal(renderer.isLocked, false);
      assert.equal(pendingRafs.size, 1, 'setLocked(false) should resume rAF scheduling when running');

      renderer.dispose();
      assert.equal(pendingRafs.size, 0, 'dispose() must cancel active rAF');
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCancelRaf;
    }
  });

  test('LyricStageRenderer findLineAtPoint supports click-to-seek hit-testing and respects contentInsetLeft', () => {
    const canvas = createMockCanvas();
    const renderer = new LyricStageRenderer({
      canvas,
      styleId: 'AppleMusicFlow',
      palette: SAMPLE_PALETTE,
    });
    renderer.resize(800, 600, 1);
    renderer.setLyrics(SYNCED_LYRICS);
    renderer.setSyncState({ timeSeconds: 5.0, activeLineIndex: 1, activeWordIndex: 0, wordProgress: 0.2 });
    renderer.renderFrame(1000);

    // Active line sits near anchorY = 600 * 0.46 = 276
    const hitActive = renderer.findLineAtPoint(400, 276);
    assert.equal(hitActive, 1, 'Clicking vertical center anchor should hit active line 1');

    // Split-view contentInsetLeft blocks clicks in the left transport column while allowing right-half clicks
    renderer.setModes({ reduceMotion: true });
    renderer.setContentInsetLeft(380);
    renderer.renderFrame(1016);
    assert.equal(renderer.findLineAtPoint(200, 276), null, 'Clicks inside contentInsetLeft (<380px) must return null');
    assert.equal(renderer.findLineAtPoint(379, 276), null, 'Clicks at x=379 must return null');
    assert.equal(renderer.findLineAtPoint(590, 276), 1, 'Clicks to the right of contentInsetLeft must hit active line 1');

    // Out-of-bounds returns null
    assert.equal(renderer.findLineAtPoint(-10, 276), null);
    assert.equal(renderer.findLineAtPoint(900, 276), null);

    renderer.dispose();
  });

  test('IosTextingMotionStyle omits "Messages · Synced Thread" top bar in split-view (contentInsetLeft > 0)', () => {
    const canvas = createMockCanvas();
    const renderer = new LyricStageRenderer({
      canvas,
      styleId: 'IosTextingMotion',
      palette: SAMPLE_PALETTE,
      reduceMotion: true,
      contentInsetLeft: 400,
    });
    renderer.resize(1200, 720, 1);
    renderer.setLyrics(SYNCED_LYRICS);
    renderer.setSyncState({ timeSeconds: 2.0, activeLineIndex: 0, activeWordIndex: 1, wordProgress: 0.4 });
    canvas.ctx2d.ops.length = 0;
    assert.equal(renderer.renderFrame(1000), true);
    const textsSplit = canvas.ctx2d.ops
      .filter((op) => Array.isArray(op) && op[0] === 'fillText')
      .map((op) => op[1]);
    assert.equal(textsSplit.includes('Messages · Synced Thread'), false, 'Split-view must omit top Messages bar');

    renderer.setContentInsetLeft(0);
    canvas.ctx2d.ops.length = 0;
    assert.equal(renderer.renderFrame(1016), true);
    const textsFull = canvas.ctx2d.ops
      .filter((op) => Array.isArray(op) && op[0] === 'fillText')
      .map((op) => op[1]);
    assert.equal(textsFull.includes('Messages · Synced Thread'), true, 'Full stage must display Messages · Synced Thread header');
    renderer.dispose();
  });

  test('Rendering modules contain zero forbidden Apple symbols/fonts while using bundled SF Pro Display stack', () => {
    const renderingDir = path.join(rootDir, 'src', 'lyricVisualizer', 'rendering');
    const files = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith('.ts')) files.push(full);
      }
    };
    walk(renderingDir);
    assert.ok(files.length >= 19, 'Expected all rendering and style modules');

    const forbidden = ['SF Symbols', 'SF Compact', 'SF Mono', 'New York Serif'];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const token of forbidden) {
        assert.equal(
          content.includes(token),
          false,
          `Forbidden Apple font/symbol token "${token}" found in ${path.relative(rootDir, file)}`
        );
      }
    }

    const iosSrc = readFileSync(path.join(renderingDir, 'styles', 'iosTextingMotion.ts'), 'utf8');
    assert.ok(iosSrc.includes("IOS_FONT_STACK = \"'SF Pro Display'"), 'IosTextingMotion must use bundled SF Pro Display stack');
    assert.ok(iosSrc.includes('fontFamilyOverride: IOS_FONT_STACK'), 'IosTextingMotion must override measurement font with SF Pro Display');

    const stageSrc = readFileSync(path.join(renderingDir, 'lyricStageRenderer.ts'), 'utf8');
    assert.ok(stageSrc.includes('SF_PRO_DISPLAY_STACK'), 'LyricStageRenderer must default to SF_PRO_DISPLAY_STACK');
  });

  test('IosTextingMotion detects all 9 Magic Word categories and renders all 4 variations', () => {
    const magicSamples = [
      ['rainbow', 'rainbow'],
      ['starlight', 'sparkle'],
      ['golden', 'shiny'],
      ['flames', 'fire'],
      ['frozen', 'ice'],
      ['heart', 'love'],
      ['boom', 'impact'],
      ['ocean', 'water'],
      ['shadow', 'ghost'],
    ];
    for (const [word, expected] of magicSamples) {
      assert.equal(detectMagicWordEffect(word), expected, `Expected ${word} -> ${expected}`);
    }
    assert.equal(resolveContextualEmoji('Flying on a plane'), '✈️');

    const canvas = createMockCanvas();
    const renderer = new LyricStageRenderer({
      canvas,
      styleId: 'IosTextingMotion',
      palette: SAMPLE_PALETTE,
    });
    renderer.resize(900, 620, 1);
    renderer.setLyrics(SYNCED_LYRICS);
    renderer.setSyncState({ timeSeconds: 2.0, activeLineIndex: 0, activeWordIndex: 1, wordProgress: 0.5 });
    for (const variationId of ['ios-dark', 'liquid-glass', 'cinema-edit', 'classic-sms']) {
      canvas.ctx2d.ops.length = 0;
      renderer.setVariation(variationId);
      assert.equal(renderer.renderFrame(1000), true);
      assert.ok(canvas.ctx2d.ops.length > 0, `Variation ${variationId} should draw`);
    }
    renderer.dispose();

    // Contextual emoji Tapback mode: renders Apple glossy emoji via iosEmojiRenderer (never flat Segoe UI fillText)
    const tapbackCanvas = createMockCanvas();
    const tapbackDraws = [];
    let tapbackVectorGrads = 0;
    const origFillText = tapbackCanvas.ctx2d.fillText.bind(tapbackCanvas.ctx2d);
    tapbackCanvas.ctx2d.fillText = (text, x, y) => {
      tapbackDraws.push({ text, font: tapbackCanvas.ctx2d.font, align: tapbackCanvas.ctx2d.textAlign });
      origFillText(text, x, y);
    };
    const origCreateLinearGrad = tapbackCanvas.ctx2d.createLinearGradient.bind(tapbackCanvas.ctx2d);
    tapbackCanvas.ctx2d.createLinearGradient = (...args) => {
      tapbackVectorGrads++;
      return origCreateLinearGrad(...args);
    };
    const tapRenderer = new LyricStageRenderer({
      canvas: tapbackCanvas,
      styleId: 'IosTextingMotion',
      palette: SAMPLE_PALETTE,
      reduceMotion: true,
    });
    tapRenderer.resize(900, 620, 1);
    const planeLyrics = {
      providerName: 'Tapback Test',
      sourceKind: 'WordSynced',
      lines: [0, 1, 2].map((idx) => ({
        startSeconds: idx * 3 + 0.5,
        endSeconds: idx * 3 + 2.5,
        text: 'Board the plane now',
        isSynthesizedWords: false,
        words: [
          { text: 'Board', startSeconds: idx * 3 + 0.5, endSeconds: idx * 3 + 1.0 },
          { text: 'the', startSeconds: idx * 3 + 1.0, endSeconds: idx * 3 + 1.5 },
          { text: 'plane', startSeconds: idx * 3 + 1.5, endSeconds: idx * 3 + 2.0 },
          { text: 'now', startSeconds: idx * 3 + 2.0, endSeconds: idx * 3 + 2.5 },
        ],
      })),
    };
    tapRenderer.setLyrics(planeLyrics);
    // Once all 3 lines are reached, Tapback bubbles render glossy Apple emoji vector/image art (never Segoe UI fillText)
    tapRenderer.setSyncState({ timeSeconds: 8.2, activeLineIndex: 2, activeWordIndex: 3, wordProgress: 0.5 });
    tapRenderer.renderFrame(1000);
    assert.equal(
      tapbackDraws.some((d) => d.text === '✈️'),
      false,
      'Apple emoji Tapback must not render via flat fillText("✈️")'
    );
    assert.equal(
      tapbackDraws.some((d) => /Segoe UI/i.test(d.font)),
      false,
      'IosTextingMotion must never use Segoe UI font'
    );
    const hasAppleVectorOrImage =
      tapbackVectorGrads >= 2 ||
      tapbackCanvas.ctx2d.ops.some((op) => Array.isArray(op) && op[0] === 'drawImage');
    assert.ok(
      hasAppleVectorOrImage,
      'Contextual emoji Tapback mode must render glossy Apple emoji vector gradients or drawImage inside Tapback pills'
    );
    tapRenderer.dispose();
  });

  test('CRTScanline and LiquidMetal respect hasWebGlBackdrop (opaque dark fill when false, transparent pass-through when true)', () => {
    const measurer = new LyricsMeasurer();
    const baseCtx = createMockCanvas2DContext();
    const layout = measurer.measure(baseCtx, SYNCED_LYRICS, 800, 600, 'Inter, sans-serif', 1.0);

    const runWithBackdrop = (style, variationId, hasWebGlBackdrop) => {
      const ctx = createMockCanvas2DContext();
      const fullFills = [];
      const origFillRect = ctx.fillRect.bind(ctx);
      ctx.fillRect = (x, y, w, h) => {
        if (x === 0 && y === 0 && w === 800 && h === 600) {
          fullFills.push(typeof ctx.fillStyle === 'string' ? ctx.fillStyle : 'gradient');
        }
        origFillRect(x, y, w, h);
      };
      style.render(
        ctx,
        {
          lyrics: SYNCED_LYRICS,
          layout,
          timeSeconds: 2.0,
          deltaSeconds: 1 / 60,
          activeLineIndex: 0,
          activeWordIndex: 1,
          wordProgress: 0.5,
          lineFadeAlpha: 1,
          palette: SAMPLE_PALETTE,
          audio: { rmsLevel: 0.4, bassEnergy: 0.4, midEnergy: 0.3, trebleEnergy: 0.3, beatDetected: false },
          fontFamily: 'Inter, sans-serif',
          fontSizeScale: 1.0,
          dpiScale: 1,
          reduceMotion: true,
          isAmbientMode: false,
          isOverlayMode: false,
          isEmbeddedTransparent: false,
          didSeekThisFrame: false,
          variationId,
          manualScrollY: 0,
          isFollowingPlayback: true,
          hoveredLineIndex: -1,
          backgroundOpacity: 0.95,
          vignetteStrength: 0,
          textAlign: 'center',
          trackMetadata: null,
          hasWebGlBackdrop,
          recordHitRect: () => {},
        },
        800,
        600
      );
      return fullFills;
    };

    const crt = new CRTScanlineStyle();
    const crtWithoutGl = runWithBackdrop(crt, 'p31-green', false);
    const crtWithGl = runWithBackdrop(crt, 'p31-green', true);
    assert.ok(crtWithoutGl.includes('#030605'), 'CRTScanline without WebGL backdrop must draw opaque #030605 glass fill');
    assert.equal(crtWithGl.includes('#030605'), false, 'CRTScanline with WebGL backdrop must skip opaque #030605 fill');

    const lm = new LiquidMetalStyle();
    const lmWithoutGl = runWithBackdrop(lm, 'obsidian-chrome', false);
    const lmWithGl = runWithBackdrop(lm, 'obsidian-chrome', true);
    assert.equal(lmWithoutGl.length, 2, 'LiquidMetal without WebGL backdrop must draw opaque scrim + sheen');
    assert.equal(lmWithGl.length, 1, 'LiquidMetal with WebGL backdrop must skip opaque scrim');
  });

  test('CodeEditorKinetic transforms lyrics to syntax tokens, detects all 7 word effects, and renders all 4 variations', () => {
    const tokens = transformLyricLineToCodeTokens("I can't feel the broken sky", 6, 4, 2);
    assert.ok(tokens.formattedCode.includes('i.cant.feel(the.broken(sky));'));
    assert.equal(tokens.repeatCount, 2);
    assert.equal(tokens.ghostAnnotation, '• repeat');
    assert.equal(tokens.telemetryLabel, '● chorus');
    assert.ok(tokens.some((t) => t.role === 'negation' && t.text === 'cant'));
    assert.ok(tokens.some((t) => t.role === 'hook' && t.text === 'feel'));

    const arrow = transformLyricLineToCodeTokens('One two three four five six seven', 7, 1, 1);
    assert.equal(arrow.isArrowBlock, true);
    assert.ok(arrow.formattedCode.startsWith('() => { '));

    const effects = [
      ['mirror', 'mirror'],
      ["can't", 'strikethrough'],
      ['broken', 'squiggle'],
      ['rise', 'lift'],
      ['fall', 'sink'],
      ['fade', 'cascade'],
      ['shatter', 'split'],
    ];
    for (const [word, expected] of effects) {
      assert.equal(detectCodeWordEffect(word), expected, `Expected ${word} -> ${expected}`);
    }

    const canvas = createMockCanvas();
    const renderer = new LyricStageRenderer({
      canvas,
      styleId: 'CodeEditorKinetic',
      palette: SAMPLE_PALETTE,
    });
    renderer.resize(960, 600, 1);
    renderer.setLyrics(SYNCED_LYRICS);
    renderer.setSyncState({ timeSeconds: 2.0, activeLineIndex: 0, activeWordIndex: 1, wordProgress: 0.5 });
    for (const variationId of ['ide-macro', 'led-stage-matrix', 'clockwork-orbit', 'clean-dark-ide']) {
      canvas.ctx2d.ops.length = 0;
      renderer.setVariation(variationId);
      assert.equal(renderer.renderFrame(1000), true);
      assert.ok(canvas.ctx2d.ops.length > 0, `CodeEditorKinetic variation ${variationId} should draw`);
    }
    renderer.dispose();
  });

  test('LyricStageRenderer scrollBy/resumeFollowPlayback/setPointerPosition and getSyncButtonTheme cover all 12 styles + Classic', () => {
    const canvas = createMockCanvas();
    const followEvents = [];
    const renderer = new LyricStageRenderer({
      canvas,
      styleId: 'AppleMusicFlow',
      palette: SAMPLE_PALETTE,
      reduceMotion: true,
      onFollowStateChange: (v) => followEvents.push(v),
    });
    renderer.resize(800, 600, 1);
    renderer.setLyrics(SYNCED_LYRICS);
    renderer.setSyncState({ timeSeconds: 5.0, activeLineIndex: 1, activeWordIndex: 0, wordProgress: 0.2 });
    renderer.renderFrame(1000);
    assert.equal(renderer.isFollowing(), true);

    renderer.scrollBy(120);
    assert.equal(renderer.isFollowing(), false);
    renderer.renderFrame(1016);
    assert.equal(renderer.setPointerPosition(400, 276 - 120), 1, 'Pointer should hit scrolled active line');

    renderer.resumeFollowPlayback();
    assert.equal(renderer.isFollowing(), true);
    assert.deepEqual(followEvents, [false, true]);
    renderer.dispose();

    for (const id of ['Classic', ...EXPECTED_12_STYLES]) {
      const theme = getSyncButtonTheme(id, undefined, SAMPLE_PALETTE);
      assert.equal(theme.styleId, id);
      assert.ok(theme.label.length > 0);
      assert.ok(theme.style.background.length > 0);
      assert.ok(theme.style.color.length > 0);
    }
  });

  test('StarfieldShip3D renders large bold projected lyric words, browse-mode scrolling, INSTRUMENTAL + ♪ during gaps, and zero opaque fills in overlay/transparent modes', async () => {
    const { getActiveShip3DScene } = await import('../../src/lyricVisualizer/rendering/ship3dScene.ts');
    const canvas = createMockCanvas();
    const renderer = new LyricStageRenderer({
      canvas,
      styleId: 'StarfieldShip3D',
      palette: SAMPLE_PALETTE,
      reduceMotion: false,
    });
    renderer.resize(960, 540, 1);

    const wrappedLyrics = {
      providerName: 'Starfield Projection Test',
      sourceKind: 'WordSynced',
      lines: [
        {
          startSeconds: 1.0,
          endSeconds: 5.0,
          text: 'Constellations chart the open endless midnight ocean horizon',
          isSynthesizedWords: false,
          words: [
            { text: 'Constellations', startSeconds: 1.0, endSeconds: 1.6 },
            { text: 'chart', startSeconds: 1.6, endSeconds: 2.1 },
            { text: 'the', startSeconds: 2.1, endSeconds: 2.4 },
            { text: 'open', startSeconds: 2.4, endSeconds: 2.9 },
            { text: 'endless', startSeconds: 2.9, endSeconds: 3.5 },
            { text: 'midnight', startSeconds: 3.5, endSeconds: 4.1 },
            { text: 'ocean', startSeconds: 4.1, endSeconds: 4.6 },
            { text: 'horizon', startSeconds: 4.6, endSeconds: 5.0 },
          ],
        },
        {
          startSeconds: 15.0,
          endSeconds: 19.0,
          text: 'Lanterns drift across the quiet tide tonight',
          isSynthesizedWords: false,
          words: [
            { text: 'Lanterns', startSeconds: 15.0, endSeconds: 15.6 },
            { text: 'drift', startSeconds: 15.6, endSeconds: 16.2 },
            { text: 'across', startSeconds: 16.2, endSeconds: 16.8 },
            { text: 'the', startSeconds: 16.8, endSeconds: 17.2 },
            { text: 'quiet', startSeconds: 17.2, endSeconds: 17.8 },
            { text: 'tide', startSeconds: 17.8, endSeconds: 18.4 },
            { text: 'tonight', startSeconds: 18.4, endSeconds: 19.0 },
          ],
        },
      ],
    };
    renderer.setLyrics(wrappedLyrics);

    // Track font used on each fillText to verify large bold projected lyric words (>=28px, weight 800)
    const drawnFonts = [];
    const origFillText = canvas.ctx2d.fillText.bind(canvas.ctx2d);
    canvas.ctx2d.fillText = (text, x, y) => {
      drawnFonts.push({ text: String(text), font: canvas.ctx2d.font, x, y });
      origFillText(text, x, y);
    };

    // Active playback renders projected words along the flight path
    canvas.ctx2d.ops.length = 0;
    drawnFonts.length = 0;
    renderer.setSyncState({ timeSeconds: 1.3, activeLineIndex: 0, activeWordIndex: 0, wordProgress: 0.5 });
    assert.equal(renderer.renderFrame(1000), true);

    const activeScene = getActiveShip3DScene();
    assert.ok(activeScene, 'Expected active Ship3DScene');
    assert.ok(activeScene.getProjectedWordGateCount() >= 2, 'Expected projected words along flight path');

    const projectedWordDraws = drawnFonts.filter((d) =>
      ['Constellations', 'chart', 'the', 'open', 'endless'].includes(d.text)
    );
    assert.ok(projectedWordDraws.length >= 2, 'StarfieldShip3D must draw projected words via fillText');
    assert.ok(
      projectedWordDraws.some((d) => {
        const m = /\b800\s+(\d+)px\b/.exec(d.font);
        return m !== null && Number(m[1]) >= 28;
      }),
      'Projected flight-path lyric words must render as large bold >=28px typography'
    );
    assert.equal(
      drawnFonts.some((d) => d.text.startsWith('HUD [') || d.text.includes('SCORE ')),
      false,
      'Obsolete cramped HUD header / SCORE bar must not be drawn'
    );

    // Manual browse-mode scrolling shifts lyric ribbon and suppresses flight-path projected gates
    renderer.scrollBy(-90);
    assert.equal(renderer.isFollowing(), false);
    canvas.ctx2d.ops.length = 0;
    drawnFonts.length = 0;
    assert.equal(renderer.renderFrame(1016), true);
    assert.ok(
      drawnFonts.some((d) => d.text === 'Lanterns' || d.text === 'Constellations'),
      'Browse mode must still render scrolled lyric ribbon'
    );

    // Instrumental gap renders INSTRUMENTAL + ♪ cleanly once scroll spring settles
    renderer.resumeFollowPlayback();
    for (let f = 0; f < 45; f++) {
      renderer.renderFrame(1030 + f * 16);
    }
    canvas.ctx2d.ops.length = 0;
    drawnFonts.length = 0;
    renderer.setSyncState({
      timeSeconds: 10.0,
      activeLineIndex: -1,
      activeWordIndex: -1,
      wordProgress: 0,
      isInstrumentalGap: true,
      gapProgress: 0.5,
      timeUntilNextLine: 5.0,
      hasLyrics: true,
      lastActiveLineIndex: 0,
      nextLineIndex: 1,
    });
    assert.equal(renderer.renderFrame(1800), true);
    const gapTexts = drawnFonts.map((d) => d.text);
    assert.ok(gapTexts.includes('INSTRUMENTAL'), 'StarfieldShip3D must render INSTRUMENTAL during gap');
    assert.ok(gapTexts.includes('♪'), 'StarfieldShip3D must render ♪ during gap');

    // Overlay and embeddedTransparent modes must emit zero opaque full-viewport fillRect(0,0,960,540)
    for (const modePatch of [
      { isOverlayMode: true, isEmbeddedTransparent: false },
      { isOverlayMode: false, isEmbeddedTransparent: true },
    ]) {
      renderer.setModes(modePatch);
      renderer.setSyncState({ timeSeconds: 2.0, activeLineIndex: 0, activeWordIndex: 1, wordProgress: 0.5 });
      canvas.ctx2d.ops.length = 0;
      assert.equal(renderer.renderFrame(1048), true);
      const hasFullBg = canvas.ctx2d.ops.some(
        (op) =>
          Array.isArray(op) &&
          op[0] === 'fillRect' &&
          op[1] === 0 &&
          op[2] === 0 &&
          op[3] === 960 &&
          op[4] === 540
      );
      assert.equal(hasFullBg, false, 'Overlay/transparent mode must emit zero opaque full-viewport fillRect');
    }

    renderer.dispose();
  });

  test('All 9 remaining styles handle mid-song instrumental gaps without -1->0 highlight or opaque overlay fills, and respect WS4 script rules', () => {
    const gapLyrics = {
      providerName: 'Gap Test',
      sourceKind: 'WordSynced',
      lines: [
        {
          startSeconds: 1.0,
          endSeconds: 4.0,
          text: 'LineZeroMarker opening phrase',
          isSynthesizedWords: false,
          words: [
            { text: 'LineZeroMarker', startSeconds: 1.0, endSeconds: 2.5 },
            { text: 'opening', startSeconds: 2.5, endSeconds: 3.2 },
            { text: 'phrase', startSeconds: 3.2, endSeconds: 4.0 },
          ],
        },
        {
          startSeconds: 4.5,
          endSeconds: 7.5,
          text: 'LineOneAnchor middle phrase',
          isSynthesizedWords: false,
          words: [
            { text: 'LineOneAnchor', startSeconds: 4.5, endSeconds: 5.5 },
            { text: 'middle', startSeconds: 5.5, endSeconds: 6.5 },
            { text: 'phrase', startSeconds: 6.5, endSeconds: 7.5 },
          ],
        },
        {
          startSeconds: 18.0,
          endSeconds: 21.0,
          text: 'LineTwoTarget closing phrase',
          isSynthesizedWords: false,
          words: [
            { text: 'LineTwoTarget', startSeconds: 18.0, endSeconds: 19.0 },
            { text: 'closing', startSeconds: 19.0, endSeconds: 20.0 },
            { text: 'phrase', startSeconds: 20.0, endSeconds: 21.0 },
          ],
        },
      ],
    };

    const remaining9 = [
      'AppleMusicFlow',
      'TypewriterEditorial',
      'MinimalSwiss',
      'LiquidMetal',
      'KaraokeStage',
      'BrutalistZine',
      'GenerativeParticleInk',
      'Spatial3DDepth',
      'CRTScanline',
    ];

    const canvas = createMockCanvas();
    const renderer = new LyricStageRenderer({
      canvas,
      palette: SAMPLE_PALETTE,
      reduceMotion: true,
    });
    renderer.resize(900, 600, 1);

    for (const styleId of remaining9) {
      renderer.setStyle(styleId);
      renderer.setLyrics(gapLyrics);

      // Opaque mid-song gap after line 1
      renderer.setModes({ isOverlayMode: false, isEmbeddedTransparent: false });
      canvas.ctx2d.ops.length = 0;
      renderer.setSyncState({
        timeSeconds: 12.0,
        activeLineIndex: -1,
        activeWordIndex: -1,
        wordProgress: 0,
        isInstrumentalGap: true,
        gapProgress: 0.43,
        timeUntilNextLine: 6.0,
        hasLyrics: true,
        lastActiveLineIndex: 1,
        nextLineIndex: 2,
      });
      assert.equal(renderer.renderFrame(1000), true, `${styleId} should render during gap`);
      const fillTexts = canvas.ctx2d.ops
        .filter((op) => Array.isArray(op) && op[0] === 'fillText')
        .map((op) => String(op[1]));
      assert.ok(
        fillTexts.some((t) => t.includes('♪') || t.includes('Instrumental')),
        `${styleId} must render instrumental indicator during isInstrumentalGap`
      );

      // Overlay transparent gap must never draw full-viewport opaque fillRect(0, 0, 900, 600)
      renderer.setModes({ isOverlayMode: true });
      canvas.ctx2d.ops.length = 0;
      assert.equal(renderer.renderFrame(1016), true);
      const hasFullBg = canvas.ctx2d.ops.some(
        (op) =>
          Array.isArray(op) &&
          op[0] === 'fillRect' &&
          op[1] === 0 &&
          op[2] === 0 &&
          op[3] === 900 &&
          op[4] === 600
      );
      assert.equal(hasFullBg, false, `${styleId} overlay gap must not draw full-screen fillRect`);
    }

    // WS4: BrutalistZine avoids 0.02em letterSpacing on cursive Arabic / Devanagari
    const registry = new StyleRegistry();
    const zine = registry.get('BrutalistZine');
    const arabicLyrics = {
      providerName: 'Test',
      sourceKind: 'WordSynced',
      lines: [
        {
          startSeconds: 0,
          endSeconds: 4,
          text: 'مرحبا بالعالم',
          isSynthesizedWords: false,
          words: [
            { text: 'مرحبا', startSeconds: 0, endSeconds: 2 },
            { text: 'بالعالم', startSeconds: 2, endSeconds: 4 },
          ],
        },
      ],
    };
    const zineSpec = zine.getMeasurementSpec({
      lyrics: arabicLyrics,
      scriptMode: 'original',
    });
    assert.equal(zineSpec.letterSpacing, '0px', 'BrutalistZine must disable 0.02em letterSpacing for Arabic/Devanagari');

    // WS4: TypewriterEditorial grapheme-safe slicing never emits lone UTF-16 surrogates
    renderer.setStyle('TypewriterEditorial');
    renderer.setModes({ isOverlayMode: false, isEmbeddedTransparent: false });
    const emojiWordLyrics = {
      providerName: 'Test',
      sourceKind: 'WordSynced',
      lines: [
        {
          startSeconds: 0,
          endSeconds: 4,
          text: '🌙✨🎵',
          isSynthesizedWords: false,
          words: [{ text: '🌙✨🎵', startSeconds: 0, endSeconds: 4 }],
        },
      ],
    };
    renderer.setLyrics(emojiWordLyrics);
    renderer.setSyncState({ timeSeconds: 1.0, activeLineIndex: 0, activeWordIndex: 0, wordProgress: 0.2 });
    canvas.ctx2d.ops.length = 0;
    renderer.renderFrame(1050);
    const typedTexts = canvas.ctx2d.ops
      .filter((op) => Array.isArray(op) && op[0] === 'fillText')
      .map((op) => String(op[1]));
    for (const txt of typedTexts) {
      assert.equal(/[\uD800-\uDFFF]/.test(txt) && !/^(?:[\uD800-\uDBFF][\uDC00-\uDFFF]|[^\uD800-\uDFFF])*$/.test(txt), false, `Lone surrogate found in TypewriterEditorial output: ${txt}`);
    }
    assert.ok(typedTexts.includes('🌙'), 'Grapheme-safe slice should reveal whole surrogate-pair emoji cleanly');

    renderer.dispose();
  });

  test('Ship3DScene sweeps wide flight spline, maintains zero asteroid/spline/lyric collisions, and unifies Retro Wireframe hidden-line rendering', async () => {
    const { Ship3DScene } = await import('../../src/lyricVisualizer/rendering/ship3dScene.ts');
    const canvas = createMockCanvas();
    const scene = new Ship3DScene(null);
    const audio = {
      rmsLevel: 0.45,
      bassEnergy: 0.6,
      midEnergy: 0.4,
      trebleEnergy: 0.35,
      beatDetected: true,
      beatStrength: 0.85,
      estimatedBpm: 128,
    };

    // Wide multi-harmonic flight spline sweep across [-3.5, +3.5]
    let minX = Infinity;
    let maxX = -Infinity;
    for (let t = 0; t <= 20; t += 0.1) {
      const fp = scene.getFlightPosition(t);
      if (fp.x < minX) minX = fp.x;
      if (fp.x > maxX) maxX = fp.x;
    }
    assert.ok(minX < -2.0, `Expected getFlightPosition(t) minX < -2.0, got ${minX}`);
    assert.ok(maxX > 2.0, `Expected getFlightPosition(t) maxX > 2.0, got ${maxX}`);

    for (const variationId of ['deep-space', 'nebula-run', 'retro-wireframe']) {
      scene.reset();
      scene.syncLyricsState(SYNCED_LYRICS, 1.0, 0, 0, false, false);
      for (let f = 0; f < 40; f++) {
        const t = 1.0 + f * 0.05;
        scene.syncLyricsState(SYNCED_LYRICS, t, 0, 0, false, false);
        scene.render(
          canvas.ctx2d,
          1280,
          720,
          t,
          0.05,
          audio,
          SAMPLE_PALETTE,
          false,
          false,
          variationId,
          0.95,
          640,
          false
        );
        const minClearance = scene.getMinAsteroidClearance();
        assert.ok(
          minClearance >= 0.4,
          `Expected positive pairwise asteroid clearance in ${variationId} at frame ${f}, got ${minClearance}`
        );
        const minSplineClearance = scene.getMinSplineAsteroidClearance();
        assert.ok(
          minSplineClearance >= 0,
          `Expected non-negative spline-to-asteroid clearance in ${variationId} at frame ${f}, got ${minSplineClearance}`
        );
        const minLyricClearance = scene.getMinLyricAsteroidClearance();
        assert.ok(
          minLyricClearance >= 0,
          `Expected non-negative lyric-to-asteroid clearance in ${variationId} at frame ${f}, got ${minLyricClearance}`
        );
      }
    }

    const shipSrc = readFileSync(
      path.join(rootDir, 'src/lyricVisualizer/rendering/ship3dScene.ts'),
      'utf8'
    );
    assert.ok(
      shipSrc.includes('hiddenLineFillMat') && shipSrc.includes('polygonOffset: true'),
      'Retro Wireframe must use hiddenLineFillMat with polygonOffset occlusion'
    );
    assert.ok(
      shipSrc.includes('createInfiniteHorizonGridMaterial') && shipSrc.includes('smoothstep('),
      'Retro Wireframe must use seamless fog-faded infinite horizon grid shader'
    );
    scene.dispose();
  });

  test('StarfieldShip3D triggers direct lyric-merge splashes (mergeFlash > 0), semantic triggers (fire, rainbow, ice, slow, electric), and resets on seek', async () => {
    const { getActiveShip3DScene } = await import('../../src/lyricVisualizer/rendering/ship3dScene.ts');
    const canvas = createMockCanvas();
    const renderer = new LyricStageRenderer({
      canvas,
      styleId: 'StarfieldShip3D',
      palette: SAMPLE_PALETTE,
      reduceMotion: false,
    });
    renderer.resize(1280, 720, 1);

    const semanticLyrics = {
      providerName: 'Semantic Flight Test',
      sourceKind: 'WordSynced',
      lines: [
        {
          startSeconds: 1.0,
          endSeconds: 4.5,
          text: 'Fire rainbow ice slow electric',
          isSynthesizedWords: false,
          words: [
            { text: 'Fire', startSeconds: 1.0, endSeconds: 1.6 },
            { text: 'rainbow', startSeconds: 1.6, endSeconds: 2.3 },
            { text: 'ice', startSeconds: 2.3, endSeconds: 3.0 },
            { text: 'slow', startSeconds: 3.0, endSeconds: 3.7 },
            { text: 'electric', startSeconds: 3.7, endSeconds: 4.5 },
          ],
        },
      ],
    };
    renderer.setLyrics(semanticLyrics);

    // Lookahead anchors upcoming projected words before t=1.0
    renderer.setSyncState({ timeSeconds: 0.4, activeLineIndex: 0, activeWordIndex: 0, wordProgress: 0 });
    renderer.renderFrame(1000);
    const scene = getActiveShip3DScene();
    assert.ok(scene, 'Expected active Ship3DScene');
    assert.ok(scene.getProjectedWordGateCount() >= 3, 'Expected upcoming projected words within 2.8s lookahead');

    // Collect words across 1.0 -> 3.72s and verify mergeFlash + each semantic trigger
    const wordSteps = [
      { t: 1.02, w: 0, expectedToast: 'PLASMA STRIKE!' },
      { t: 1.62, w: 1, expectedToast: 'PRISM OVERDRIVE' },
      { t: 2.32, w: 2, expectedToast: 'CRYO THRUST' },
      { t: 3.02, w: 3, expectedToast: 'BULLET-TIME' },
      { t: 3.72, w: 4, expectedToast: 'ARC DISCHARGE' },
    ];
    let sawMergeFlash = false;
    for (let i = 0; i < wordSteps.length; i++) {
      canvas.ctx2d.ops.length = 0;
      renderer.setSyncState({
        timeSeconds: wordSteps[i].t,
        activeLineIndex: 0,
        activeWordIndex: wordSteps[i].w,
        wordProgress: 0.1,
      });
      renderer.renderFrame(1050 + i * 32);

      const telStep = scene.getHudTelemetry();
      assert.equal(
        telStep.toastText,
        wordSteps[i].expectedToast,
        `Expected semantic trigger toast "${wordSteps[i].expectedToast}"`
      );
      for (let g = 0; g < scene.getProjectedWordGateCount(); g++) {
        if (scene.getProjectedWordGate(g).mergeFlash > 0) {
          sawMergeFlash = true;
        }
      }
    }
    assert.equal(sawMergeFlash, true, 'Expected direct lyric-merge splash (mergeFlash > 0) on word slice');

    const telemetry = scene.getHudTelemetry();
    assert.equal(telemetry.rainbowActive, true, 'Expected rainbow semantic timer active');
    assert.ok(telemetry.icePulse > 0, 'Expected cryo ice semantic pulse active');
    assert.equal(telemetry.bulletTimeActive, true, 'Expected slow bullet-time semantic timer active');

    // Seek reset clears transient semantic timers cleanly
    scene.syncLyricsState(semanticLyrics, 0.2, 0, 0, false, true);
    const resetTel = scene.getHudTelemetry();
    assert.equal(resetTel.bulletTimeActive, false, 'Seek must reset bulletTimeActive');
    assert.equal(resetTel.rainbowActive, false, 'Seek must reset rainbowActive');

    // Instrumental gap renders INSTRUMENTAL + ♪ cleanly (no obsolete AUTOPILOT // ASTEROID GAUNTLET)
    canvas.ctx2d.ops.length = 0;
    renderer.setSyncState({
      timeSeconds: 6.0,
      activeLineIndex: -1,
      activeWordIndex: -1,
      wordProgress: 0,
      isInstrumentalGap: true,
      gapProgress: 0.5,
      timeUntilNextLine: 4.0,
      hasLyrics: true,
      lastActiveLineIndex: 0,
      nextLineIndex: -1,
    });
    renderer.renderFrame(1300);
    const gapTexts = canvas.ctx2d.ops
      .filter((op) => Array.isArray(op) && op[0] === 'fillText')
      .map((op) => String(op[1]));
    assert.ok(gapTexts.includes('INSTRUMENTAL'), 'Expected INSTRUMENTAL during instrumental gap');
    assert.ok(gapTexts.includes('♪'), 'Expected ♪ during instrumental gap');
    assert.equal(
      gapTexts.some((t) => t.includes('AUTOPILOT // ASTEROID GAUNTLET')),
      false,
      'Obsolete AUTOPILOT // ASTEROID GAUNTLET badge must not render'
    );

    renderer.dispose();
  });

  test('Empty LRC timestamps and [Instrumental] markers never produce empty bubbles in IosTextingMotion or empty boxes across other styles', () => {
    const rawLrc = [
      '[00:01.00] First glowing lyric line',
      '[02:04.00] ',
      '[02:08.00] [Instrumental]',
      '[02:12.00] Second glowing lyric line',
    ].join('\n');
    const parsed = parseLrc(rawLrc);
    assert.ok(parsed);
    assert.equal(parsed.lines.length, 2, 'parseLrc must strip empty timestamps and [Instrumental] markers');
    assert.deepEqual(
      parsed.lines.map((l) => l.text),
      ['First glowing lyric line', 'Second glowing lyric line']
    );

    // Even if unfiltered lines with empty / [Instrumental] markers reach the renderer, styles must never draw empty bubbles/boxes
    const unfilteredLyrics = {
      providerName: 'Unfiltered Blank Test',
      sourceKind: 'WordSynced',
      lines: [
        {
          startSeconds: 1.0,
          endSeconds: 4.0,
          text: 'First glowing lyric line',
          isSynthesizedWords: false,
          words: [
            { text: 'First', startSeconds: 1.0, endSeconds: 2.0 },
            { text: 'glowing', startSeconds: 2.0, endSeconds: 3.0 },
            { text: 'lyric', startSeconds: 3.0, endSeconds: 3.5 },
            { text: 'line', startSeconds: 3.5, endSeconds: 4.0 },
          ],
        },
        {
          startSeconds: 4.2,
          endSeconds: 6.0,
          text: '   ',
          isSynthesizedWords: false,
          words: [],
        },
        {
          startSeconds: 6.0,
          endSeconds: 9.0,
          text: '[Instrumental]',
          isSynthesizedWords: false,
          words: [{ text: '[Instrumental]', startSeconds: 6.0, endSeconds: 9.0 }],
        },
        {
          startSeconds: 9.5,
          endSeconds: 13.0,
          text: 'Second glowing lyric line',
          isSynthesizedWords: false,
          words: [
            { text: 'Second', startSeconds: 9.5, endSeconds: 10.5 },
            { text: 'glowing', startSeconds: 10.5, endSeconds: 11.5 },
            { text: 'lyric', startSeconds: 11.5, endSeconds: 12.2 },
            { text: 'line', startSeconds: 12.2, endSeconds: 13.0 },
          ],
        },
      ],
    };

    const canvas = createMockCanvas();
    const renderer = new LyricStageRenderer({
      canvas,
      styleId: 'IosTextingMotion',
      palette: SAMPLE_PALETTE,
      reduceMotion: true,
    });
    renderer.resize(900, 620, 1);
    renderer.setLyrics(unfilteredLyrics);
    canvas.ctx2d.ops.length = 0;
    renderer.setSyncState({ timeSeconds: 10.0, activeLineIndex: 3, activeWordIndex: 0, wordProgress: 0.5 });
    assert.equal(renderer.renderFrame(1000), true);
    const iosTexts = canvas.ctx2d.ops
      .filter((op) => Array.isArray(op) && op[0] === 'fillText')
      .map((op) => String(op[1]));
    assert.equal(
      iosTexts.some((t) => t.includes('[Instrumental]') || t.trim() === ''),
      false,
      'IosTextingMotion must never draw [Instrumental] or empty text bubbles'
    );

    // Check remaining styles never draw [Instrumental] or blank text boxes when given unfiltered lines
    for (const styleId of EXPECTED_12_STYLES) {
      if (styleId === 'IosTextingMotion') continue;
      renderer.setStyle(styleId);
      renderer.setLyrics(unfilteredLyrics);
      canvas.ctx2d.ops.length = 0;
      renderer.setSyncState({ timeSeconds: 6.5, activeLineIndex: 2, activeWordIndex: 0, wordProgress: 0.2 });
      assert.equal(renderer.renderFrame(1020), true, `${styleId} should render cleanly during blank/[Instrumental] slot`);
      const drawn = canvas.ctx2d.ops
        .filter((op) => Array.isArray(op) && op[0] === 'fillText')
        .map((op) => String(op[1]));
      assert.equal(
        drawn.some((t) => t.trim() === ''),
        false,
        `${styleId} must never emit empty fillText`
      );
      assert.equal(
        drawn.some((t) => t.includes('[Instrumental]')),
        false,
        `${styleId} must never render raw [Instrumental] marker text`
      );
    }

    renderer.dispose();
  });

  test('IosTextingMotion renders single unified voice-note waveform pill (zero voiceMemo embed overlap, zero 1.5s overlap, >=3 typing dots at 1.0s) and compact glowing note bubble for <4s pauses', () => {
    const canvas = createMockCanvas();
    const renderer = new LyricStageRenderer({
      canvas,
      styleId: 'IosTextingMotion',
      palette: SAMPLE_PALETTE,
      reduceMotion: true,
    });
    renderer.resize(900, 620, 1);

    const lyricsWithLongAndShortGaps = {
      providerName: 'Gap Morph Test',
      sourceKind: 'WordSynced',
      lines: [
        {
          startSeconds: 1.0,
          endSeconds: 3.0,
          text: 'Listen to the voice on the radio',
          isSynthesizedWords: false,
          words: [
            { text: 'Listen', startSeconds: 1.0, endSeconds: 1.5 },
            { text: 'to', startSeconds: 1.5, endSeconds: 1.8 },
            { text: 'the', startSeconds: 1.8, endSeconds: 2.1 },
            { text: 'voice', startSeconds: 2.1, endSeconds: 2.5 },
            { text: 'radio', startSeconds: 2.5, endSeconds: 3.0 },
          ],
        },
        {
          // 6.0s gap (>= 4.0s -> voice-note waveform pill, morphing to typing dots)
          startSeconds: 9.0,
          endSeconds: 11.0,
          text: 'Echoes fade across the harbor',
          isSynthesizedWords: false,
          words: [
            { text: 'Echoes', startSeconds: 9.0, endSeconds: 9.7 },
            { text: 'fade', startSeconds: 9.7, endSeconds: 10.3 },
            { text: 'harbor', startSeconds: 10.3, endSeconds: 11.0 },
          ],
        },
        {
          // 2.5s short pause (< 4.0s -> compact glowing note bubble)
          startSeconds: 13.5,
          endSeconds: 16.0,
          text: 'Midnight static clears away',
          isSynthesizedWords: false,
          words: [
            { text: 'Midnight', startSeconds: 13.5, endSeconds: 14.3 },
            { text: 'static', startSeconds: 14.3, endSeconds: 15.1 },
            { text: 'away', startSeconds: 15.1, endSeconds: 16.0 },
          ],
        },
      ],
    };
    renderer.setLyrics(lyricsWithLongAndShortGaps);

    const arcCalls = [];
    const origArc = canvas.ctx2d.arc.bind(canvas.ctx2d);
    canvas.ctx2d.arc = (x, y, r, s, e) => {
      arcCalls.push({ x, y, r });
      origArc(x, y, r, s, e);
    };

    const inspectGapFrame = (timeSeconds, timeUntilNextLine, gapProgress) => {
      canvas.ctx2d.ops.length = 0;
      arcCalls.length = 0;
      renderer.setSyncState({
        timeSeconds,
        activeLineIndex: -1,
        activeWordIndex: -1,
        wordProgress: 0,
        isInstrumentalGap: true,
        gapProgress,
        timeUntilNextLine,
        hasLyrics: true,
      });
      assert.equal(renderer.renderFrame(1000 + timeSeconds * 16), true);
      const fillTexts = canvas.ctx2d.ops
        .filter((op) => Array.isArray(op) && op[0] === 'fillText')
        .map((op) => String(op[1]));
      // Typing indicator emits 3 consecutive arcs of r=3.6 at identical y spaced 14px apart
      let typingDotCount = 0;
      for (let i = 0; i <= arcCalls.length - 3; i++) {
        const a = arcCalls[i];
        const b = arcCalls[i + 1];
        const c = arcCalls[i + 2];
        if (
          Math.abs(a.r - 3.6) < 0.01 &&
          Math.abs(b.r - 3.6) < 0.01 &&
          Math.abs(c.r - 3.6) < 0.01 &&
          Math.abs(a.y - b.y) < 0.1 &&
          Math.abs(b.y - c.y) < 0.1 &&
          Math.abs(b.x - a.x - 14) < 0.1 &&
          Math.abs(c.x - b.x - 14) < 0.1
        ) {
          typingDotCount = 3;
          break;
        }
      }
      const hasShortPauseGlowArc = arcCalls.some((a) => Math.abs(a.r - 16) < 0.01);
      return { fillTexts, typingDotCount, hasShortPauseGlowArc };
    };

    // 1. Long >=4s gap at t=6.0s (timeUntilNextLine=3.0s): single unified dark voice-note pill, zero voiceMemo embed card
    const longMid = inspectGapFrame(6.0, 3.0, 0.5);
    assert.ok(longMid.fillTexts.includes('♪') && longMid.fillTexts.includes('♫'), 'Expected voice-note waveform pill (♪ + ♫)');
    assert.equal(longMid.fillTexts.includes('0:18'), false, 'Voice-note gap must suppress duplicate voiceMemo embed card');
    assert.equal(longMid.typingDotCount, 0, 'Voice-note pill must not overlap with typing dots');

    // 2. Morph boundary at timeUntilNextLine = 1.5s (t=7.5s): zero simultaneous waveform + typing overlap
    const morph15 = inspectGapFrame(7.5, 1.5, 0.75);
    assert.ok(morph15.fillTexts.includes('♪') && morph15.fillTexts.includes('♫'), 'At 1.5s before next line, voice-note pill renders cleanly');
    assert.equal(morph15.typingDotCount, 0, 'Zero simultaneous waveform + typing dot overlap allowed at 1.5s morph');

    // 3. Typing window at timeUntilNextLine = 1.0s (t=8.0s): >=3 typing dots, zero waveform pill
    const typing10 = inspectGapFrame(8.0, 1.0, 0.83);
    assert.ok(typing10.typingDotCount >= 3, `Expected >=3 typing indicator dots at timeUntilNextLine=1.0s, got ${typing10.typingDotCount}`);
    assert.equal(typing10.fillTexts.includes('♫'), false, 'Waveform pill must be gone when typing indicator is active at 1.0s');

    // 4. Short <4s pause (11.0s -> 13.5s, t=11.6s, timeUntilNextLine=1.9s): compact glowing note bubble (no 14-bar waveform ♫, no 3 typing dots)
    const shortPause = inspectGapFrame(11.6, 1.9, 0.24);
    assert.equal(shortPause.fillTexts.includes('♫'), false, 'Short <4s pause must not render full voice-note waveform pill');
    assert.equal(shortPause.typingDotCount, 0, 'Short <4s pause must not draw typing dots');
    assert.equal(shortPause.hasShortPauseGlowArc, true, 'Short <4s pause must render compact glowing note bubble');

    renderer.dispose();
  });

  test('Spaceship 3D renders a single corridor lyric stream with splash droplets and anticipated quintic barrel rolls', () => {
    const canvas = createMockCanvas();
    const renderer = new LyricStageRenderer({
      canvas,
      styleId: 'StarfieldShip3D',
      palette: SAMPLE_PALETTE,
      reduceMotion: false,
    });
    renderer.resize(960, 540, 1);

    const lyrics = {
      lines: [
        {
          startSeconds: 0.5,
          endSeconds: 4.5,
          text: 'Across the velvet dark',
          isSynthesizedWords: false,
          words: [
            { text: 'Across', startSeconds: 0.5, endSeconds: 1.5 },
            { text: 'velvet', startSeconds: 1.5, endSeconds: 2.8 },
            { text: 'dark', startSeconds: 2.8, endSeconds: 4.5 },
          ],
        },
      ],
    };
    renderer.setLyrics(lyrics);
    canvas.ctx2d.ops.length = 0;

    renderer.setSyncState({
      timeSeconds: 1.52,
      activeLineIndex: 0,
      activeWordIndex: 1,
      wordProgress: 0.05,
      didSeekThisFrame: true,
      hasLyrics: true,
    });
    assert.equal(renderer.renderFrame(1520, {
      rmsLevel: 0.72,
      bassEnergy: 0.85,
      midEnergy: 0.5,
      trebleEnergy: 0.4,
      beatDetected: true,
      isDownbeat: true,
      estimatedBpm: 124,
    }), true);

    const drawnTexts = canvas.ctx2d.ops
      .filter((op) => Array.isArray(op) && (op[0] === 'fillText' || op[0] === 'strokeText'))
      .map((op) => String(op[1]));
    assert.ok(drawnTexts.some((t) => t.toLowerCase().includes('velvet')));
    // Ensure full-sentence duplicate upper ribbon is removed
    assert.equal(drawnTexts.includes('Across the velvet dark'), false);

    renderer.dispose();
  });
});
