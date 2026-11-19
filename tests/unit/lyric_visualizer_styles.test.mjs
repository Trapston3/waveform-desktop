// tests/unit/lyric_visualizer_styles.test.mjs
// Unit & behavioral tests for all 13 LyricVisualizer visual styles, WebGlEffectLayer fallback,
// LyricsMeasurer caching, Ship3DScene, and LyricStageRenderer lock-screen GPU pause & hit-testing.

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

const {
  ALL_VISUAL_STYLE_IDS,
  StyleRegistry,
  LyricsMeasurer,
  WebGlEffectLayer,
  LyricStageRenderer,
} = await import('../../src/lyricVisualizer/rendering/index.ts');

const EXPECTED_13_STYLES = [
  'AppleMusicFlow',
  'NeonKinetic',
  'TypewriterEditorial',
  'MinimalSwiss',
  'LiquidMetal',
  'HoloVaporwave',
  'KaraokeStage',
  'BrutalistZine',
  'GenerativeParticleInk',
  'SpectrumRibbon',
  'Spatial3DDepth',
  'CRTScanline',
  'StarfieldShip3D',
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

describe('LyricVisualizer Rendering & 13 Visual Styles', () => {
  test('StyleRegistry registers all 13 required visual style IDs', () => {
    const registry = new StyleRegistry();
    assert.equal(ALL_VISUAL_STYLE_IDS.length, 13);
    assert.deepEqual([...registry.listIds()], EXPECTED_13_STYLES);

    for (const id of EXPECTED_13_STYLES) {
      assert.equal(registry.has(id), true, `Missing style ID: ${id}`);
      const style = registry.get(id);
      assert.equal(style.id, id);
      assert.equal(typeof style.render, 'function');
    }
  });

  test('All 13 styles render cleanly across empty, unsynced, synced, beat spike, reduceMotion, overlay, and ambient modes', () => {
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
        modes: { reduceMotion: false, isOverlayMode: true, isAmbientMode: false },
      },
      {
        name: 'ambient-mode',
        lyrics: SYNCED_LYRICS,
        sync: { timeSeconds: 10.5, activeLineIndex: 2, activeWordIndex: 3, wordProgress: 0.35 },
        audio: { rmsLevel: 0.6, bassEnergy: 0.65, midEnergy: 0.45, trebleEnergy: 0.55, beatDetected: true },
        modes: { reduceMotion: false, isOverlayMode: false, isAmbientMode: true },
      },
    ];

    let fakeNow = 1000;
    for (const styleId of EXPECTED_13_STYLES) {
      renderer.setStyle(styleId);
      for (const sc of scenarios) {
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

        // Verify overlay mode clears transparently and avoids full-viewport opaque fillRect(0,0,960,540)
        if (sc.modes.isOverlayMode) {
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

  test('LyricStageRenderer findLineAtPoint supports click-to-seek hit-testing', () => {
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

    // Out-of-bounds returns null
    assert.equal(renderer.findLineAtPoint(-10, 276), null);
    assert.equal(renderer.findLineAtPoint(900, 276), null);

    renderer.dispose();
  });

  test('Rendering modules contain zero Apple SF Symbols or Apple system font references', () => {
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
    assert.ok(files.length >= 18, 'Expected all rendering and style modules');

    const forbidden = ['-apple-system', 'SF Pro', 'SF Compact', 'SF Mono', 'BlinkMacSystemFont'];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const token of forbidden) {
        assert.equal(
          content.includes(token),
          false,
          `Forbidden Apple font token "${token}" found in ${path.relative(rootDir, file)}`
        );
      }
    }
  });
});
