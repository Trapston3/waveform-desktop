// Unit tests for WS5 + WS6 + WS2 lyric semantics, Apple emoji renderer,
// iOS 18+ Tapback library, 15 Magic Word categories, and instrumental gap rendering.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
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
  IOS18_TAPBACK_LIBRARY,
  resolveContextualEmoji,
  scoreContextualEmojis,
  detectMagicWordEffect,
  chooseSmartTapback,
  detectLyricEmbedCard,
} = await import('../../src/lyricVisualizer/rendering/lyricSemantics.ts');

const {
  drawAppleEmoji,
  emojiToUnified,
} = await import('../../src/lyricVisualizer/rendering/iosEmojiRenderer.ts');

const {
  IosTextingMotionStyle,
} = await import('../../src/lyricVisualizer/rendering/styles/iosTextingMotion.ts');

const {
  CodeEditorKineticStyle,
  detectCodeWordEffect,
  transformLyricLineToCodeTokens,
} = await import('../../src/lyricVisualizer/rendering/styles/codeEditorKinetic.ts');

const { LyricsMeasurer } = await import('../../src/lyricVisualizer/rendering/lyricsMeasurer.ts');

function createMockCanvas2D(includeOptional = false) {
  const ops = [];
  const gradientMock = { addColorStop() {} };
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
    translate() { ops.push('translate'); },
    scale() { ops.push('scale'); },
    rotate() { ops.push('rotate'); },
    clearRect(x, y, w, h) { ops.push(['clearRect', x, y, w, h]); },
    fillRect(x, y, w, h) { ops.push(['fillRect', x, y, w, h]); },
    strokeRect(x, y, w, h) { ops.push(['strokeRect', x, y, w, h]); },
    rect(x, y, w, h) { ops.push(['rect', x, y, w, h]); },
    clip() { ops.push('clip'); },
    beginPath() { ops.push('beginPath'); },
    closePath() { ops.push('closePath'); },
    moveTo() { ops.push('moveTo'); },
    lineTo() { ops.push('lineTo'); },
    bezierCurveTo() { ops.push('bezierCurveTo'); },
    quadraticCurveTo() { ops.push('quadraticCurveTo'); },
    arc() { ops.push('arc'); },
    ellipse() { ops.push('ellipse'); },
    fill() { ops.push('fill'); },
    stroke() { ops.push('stroke'); },
    fillText(text, x, y) { ops.push(['fillText', text, x, y]); },
    createLinearGradient() { return gradientMock; },
    createRadialGradient() { return gradientMock; },
    measureText(text) { return { width: String(text).length * 10 }; },
  };
  if (includeOptional) {
    ctx.drawImage = () => ops.push('drawImage');
    ctx.setLineDash = () => ops.push('setLineDash');
  }
  return ctx;
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

describe('WS5: Weighted Phrase-First Lyric Semantics & Apple Emoji Renderer', () => {
  test('phrase-first and concrete-noun specificity resolves ambiguous phrases accurately', () => {
    assert.equal(resolveContextualEmoji('ride a cruise'), '🛳️');
    assert.equal(resolveContextualEmoji('ride a wave'), '🌊');
    assert.equal(resolveContextualEmoji('ride a horse'), '🐎');
    assert.equal(resolveContextualEmoji('ride a bike'), '🏍️');
    assert.equal(resolveContextualEmoji('ride or die'), '🔥');
    assert.equal(resolveContextualEmoji('private jet across the sky'), '✈️');
    assert.equal(resolveContextualEmoji('fold a paper plane'), '✈️');
    assert.equal(resolveContextualEmoji('wish upon a shooting star'), '🌠');
    assert.equal(resolveContextualEmoji('broken heart in the dark'), '💔');
    assert.equal(resolveContextualEmoji('cruising down late night streets'), '🌙');
    assert.equal(resolveContextualEmoji('stop at the red light'), '🚦');
    assert.equal(resolveContextualEmoji('pour the champagne and toast'), '🥂');
    assert.equal(resolveContextualEmoji('Flying on a plane'), '✈️');

    // Verify weighting ranks phrase/noun above generic verb
    const cruiseScores = scoreContextualEmojis('ride a cruise');
    assert.equal(cruiseScores[0].emoji, '🛳️');
    assert.ok(cruiseScores[0].score >= 25);
  });

  test('supports full iOS 18+ 35-emoji Tapback library and smart selection', () => {
    const expectedLibrary = [
      '❤️', '👍', '👎', '😂', '‼️', '❓', '🔥', '😭', '💀', '✨',
      '🥹', '🤯', '🫶', '👀', '💔', '🎵', '🥂', '🥀', '⚡', '🦋',
      '👑', '👻', '🌙', '☀️', '🌊', '🌧️', '✈️', '🛳️', '🚗', '🚀',
      '🏍️', '🚆', '🌹', '💎', '⏰',
    ];
    for (const emoji of expectedLibrary) {
      assert.ok(IOS18_TAPBACK_LIBRARY.includes(emoji), `Missing Tapback ${emoji}`);
    }
    assert.equal(chooseSmartTapback('Where did you go?', 0, 'right', 1), '?');
    assert.equal(chooseSmartTapback('Watch out!', 1, 'left', 1), '‼️');
    assert.equal(chooseSmartTapback('You left me with a broken heart', 2, 'left', 1), '💔');
    assert.equal(chooseSmartTapback('Toast to champagne tonight', 3, 'right', 1), '🥂');
    assert.ok(detectLyricEmbedCard('Walking down Tokyo highway'));
  });

  test('detects all 15 Magic Word categories (+ compatibility aliases)', () => {
    const samples = [
      ['rainbow', 'rainbow'],
      ['sparkle', 'sparkle'],
      ['golden', 'shiny'],
      ['flames', 'fire'],
      ['frozen', 'ice'],
      ['lightning', 'electric'],
      ['heartbeat', 'heartbeat'],
      ['shatter', 'broken'],
      ['glitch', 'glitch'],
      ['floating', 'float'],
      ['falling', 'fall'],
      ['spinning', 'spin'],
      ['neon', 'neon'],
      ['whisper', 'whisper'],
      ['echo', 'whisper'],
      ['midnight', 'time'],
      ['slow', 'time'],
      ['dream', 'float'],
      ['fast', 'impact'],
      ['night', 'neon'],
      // Compatibility aliases
      ['heart', 'love'],
      ['boom', 'impact'],
      ['ocean', 'water'],
      ['shadow', 'ghost'],
    ];
    for (const [word, expected] of samples) {
      assert.equal(detectMagicWordEffect(word), expected, `Expected ${word} -> ${expected}`);
    }
  });

  test('bundled Apple 64px PNG emoji assets exist and vector fallback never uses raw fillText', () => {
    const emojiDir = path.join(rootDir, 'src', 'assets', 'emojis');
    const files = fs.readdirSync(emojiDir).filter((f) => f.endsWith('.png'));
    assert.ok(files.length >= 45, `Expected >=45 bundled emoji PNGs, found ${files.length}`);

    assert.equal(emojiToUnified('❤️'), '2764-fe0f');
    assert.equal(emojiToUnified('✈️'), '2708-fe0f');

    // Mock Canvas2D without drawImage / bezierCurveTo / setLineDash
    const mockCtx = createMockCanvas2D(false);
    for (const emoji of IOS18_TAPBACK_LIBRARY) {
      mockCtx.ops.length = 0;
      drawAppleEmoji(mockCtx, emoji, 24, 24, 18);
      assert.ok(mockCtx.ops.length > 0, `drawAppleEmoji(${emoji}) must emit vector ops`);
      const textOps = mockCtx.ops.filter((op) => Array.isArray(op) && op[0] === 'fillText');
      assert.equal(textOps.length, 0, `drawAppleEmoji(${emoji}) must NOT call raw fillText`);
    }
  });

  test('IosTextingMotionStyle renders Apple glossy Tapbacks, instrumental Voice Note morph, and full-width split-view without focal.left clip', () => {
    const style = new IosTextingMotionStyle();
    const measurer = new LyricsMeasurer();
    const ctx = createMockCanvas2D(false);

    const lyrics = {
      providerName: 'Test',
      sourceKind: 'WordSynced',
      lines: [
        {
          startSeconds: 1.0,
          endSeconds: 3.0,
          text: 'Board the plane now',
          isSynthesizedWords: false,
          words: [
            { text: 'Board', startSeconds: 1.0, endSeconds: 1.5 },
            { text: 'the', startSeconds: 1.5, endSeconds: 2.0 },
            { text: 'plane', startSeconds: 2.0, endSeconds: 2.5 },
            { text: 'now', startSeconds: 2.5, endSeconds: 3.0 },
          ],
        },
        {
          startSeconds: 10.0,
          endSeconds: 12.5,
          text: 'Ride a cruise under moonlight',
          isSynthesizedWords: false,
          words: [
            { text: 'Ride', startSeconds: 10.0, endSeconds: 10.5 },
            { text: 'a', startSeconds: 10.5, endSeconds: 10.8 },
            { text: 'cruise', startSeconds: 10.8, endSeconds: 11.4 },
            { text: 'under', startSeconds: 11.4, endSeconds: 11.9 },
            { text: 'moonlight', startSeconds: 11.9, endSeconds: 12.5 },
          ],
        },
      ],
    };

    const layout = measurer.measure(ctx, lyrics, 600, 620, 'SF Pro Display', 1.0, undefined, style.getMeasurementSpec());

    // 1. Mid-song instrumental gap (t=5.5s): must NOT clamp -1 -> 0, draws voice note indicator, and NO focal.left clip
    ctx.ops.length = 0;
    style.render(
      ctx,
      {
        lyrics,
        layout,
        timeSeconds: 5.5,
        deltaSeconds: 1 / 60,
        activeLineIndex: -1,
        activeWordIndex: -1,
        wordProgress: 0,
        lineFadeAlpha: 1,
        isInstrumentalGap: true,
        gapProgress: 0.35,
        timeUntilNextLine: 4.5,
        hasLyrics: true,
        lastActiveLineIndex: 0,
        nextLineIndex: 1,
        contentInsetLeft: 320,
        palette: SAMPLE_PALETTE,
        audio: { rmsLevel: 0.6, bassEnergy: 0.7, midEnergy: 0.5, trebleEnergy: 0.4, beatDetected: true },
        fontFamily: "'SF Pro Display'",
        fontSizeScale: 1,
        dpiScale: 1,
        reduceMotion: false,
        isAmbientMode: false,
        didSeekThisFrame: false,
        variationId: 'messages',
        iosKineticPopup: true,
        manualScrollY: 0,
        isFollowingPlayback: true,
        hoveredLineIndex: -1,
        backgroundOpacity: 0.95,
        vignetteStrength: 0.5,
        textAlign: 'center',
        trackMetadata: null,
        recordHitRect: () => {},
      },
      920,
      620
    );

    const fillTexts = ctx.ops.filter((op) => Array.isArray(op) && op[0] === 'fillText').map((op) => op[1]);
    assert.ok(fillTexts.includes('♪'), 'Instrumental gap must render musical voice note indicator');
    assert.ok(!fillTexts.includes('✈️'), 'Emoji must render via Apple glossy vector/image, not raw fillText');

    // Split-view full width: ambient backdrop vignette or dark glass washes span full canvas width
    const fullWidthFills = ctx.ops.filter(
      (op) => Array.isArray(op) && op[0] === 'fillRect' && op[1] === 0 && op[3] === 920
    );
    assert.ok(fullWidthFills.length >= 1, 'Background fills must span full canvas width');

    // Hard focal.left clip must NOT exist
    const focalClips = ctx.ops.filter(
      (op) => Array.isArray(op) && op[0] === 'rect' && op[1] === 320 && op[3] === 600
    );
    assert.equal(focalClips.length, 0, 'Must not hard-clip stage at focal.left');

    // 2. Final 1.0s before next line (timeUntilNextLine = 1.0 <= 1.6): morphs into typing indicator
    ctx.ops.length = 0;
    style.render(
      ctx,
      {
        lyrics,
        layout,
        timeSeconds: 9.0,
        deltaSeconds: 1 / 60,
        activeLineIndex: -1,
        activeWordIndex: -1,
        wordProgress: 0,
        lineFadeAlpha: 1,
        isInstrumentalGap: true,
        gapProgress: 0.85,
        timeUntilNextLine: 1.0,
        hasLyrics: true,
        lastActiveLineIndex: 0,
        nextLineIndex: 1,
        palette: SAMPLE_PALETTE,
        audio: { rmsLevel: 0.5, bassEnergy: 0.5, midEnergy: 0.4, trebleEnergy: 0.3, beatDetected: false },
        fontFamily: "'SF Pro Display'",
        fontSizeScale: 1,
        dpiScale: 1,
        reduceMotion: false,
        isAmbientMode: false,
        didSeekThisFrame: false,
        variationId: 'ios-dark',
        manualScrollY: 0,
        isFollowingPlayback: true,
        hoveredLineIndex: -1,
        backgroundOpacity: 0.95,
        vignetteStrength: 0.5,
        textAlign: 'center',
        trackMetadata: null,
        recordHitRect: () => {},
      },
      920,
      620
    );
    const arcCount = ctx.ops.filter((op) => op === 'arc').length;
    assert.ok(arcCount >= 3, 'Typing indicator dots must render during final 1.6s of gap');
  });

  test('CodeEditorKinetic expands code-native effects and renders await audio.solo() during instrumental gaps', () => {
    assert.equal(detectCodeWordEffect('void'), 'nullish');
    assert.equal(detectCodeWordEffect('forever'), 'loop');
    assert.equal(detectCodeWordEffect('waiting'), 'async');
    assert.equal(detectCodeWordEffect('escape'), 'return');

    // Preserve critical contract verbatim
    const tokens = transformLyricLineToCodeTokens("I can't feel the broken sky", 6, 4, 2);
    assert.equal(tokens.formattedCode, 'i.cant.feel(the.broken(sky));');
    assert.equal(tokens.repeatCount, 2);
    assert.equal(tokens.ghostAnnotation, '• repeat');
    assert.equal(tokens.telemetryLabel, '● chorus');

    const style = new CodeEditorKineticStyle();
    const measurer = new LyricsMeasurer();
    const ctx = createMockCanvas2D(false);

    const lyrics = {
      providerName: 'Test',
      sourceKind: 'WordSynced',
      lines: [
        {
          startSeconds: 1.0,
          endSeconds: 4.0,
          text: "I can't wait forever in broken void",
          isSynthesizedWords: false,
          words: [
            { text: 'I', startSeconds: 1.0, endSeconds: 1.3 },
            { text: "can't", startSeconds: 1.3, endSeconds: 1.7 },
            { text: 'wait', startSeconds: 1.7, endSeconds: 2.1 },
            { text: 'forever', startSeconds: 2.1, endSeconds: 2.6 },
            { text: 'in', startSeconds: 2.6, endSeconds: 3.0 },
            { text: 'broken', startSeconds: 3.0, endSeconds: 3.5 },
            { text: 'void', startSeconds: 3.5, endSeconds: 4.0 },
          ],
        },
        {
          startSeconds: 12.0,
          endSeconds: 15.0,
          text: 'Return home',
          isSynthesizedWords: false,
          words: [
            { text: 'Return', startSeconds: 12.0, endSeconds: 13.5 },
            { text: 'home', startSeconds: 13.5, endSeconds: 15.0 },
          ],
        },
      ],
    };

    const layout = measurer.measure(ctx, lyrics, 640, 600, 'JetBrains Mono', 1.0, undefined, style.getMeasurementSpec());
    ctx.ops.length = 0;
    style.render(
      ctx,
      {
        lyrics,
        layout,
        timeSeconds: 7.5,
        deltaSeconds: 1 / 60,
        activeLineIndex: -1,
        activeWordIndex: -1,
        wordProgress: 0,
        lineFadeAlpha: 1,
        isInstrumentalGap: true,
        gapProgress: 0.44,
        timeUntilNextLine: 4.5,
        hasLyrics: true,
        lastActiveLineIndex: 0,
        nextLineIndex: 1,
        contentInsetLeft: 320,
        palette: SAMPLE_PALETTE,
        audio: { rmsLevel: 0.65, bassEnergy: 0.72, midEnergy: 0.5, trebleEnergy: 0.4, beatDetected: true },
        fontFamily: 'JetBrains Mono',
        fontSizeScale: 1,
        dpiScale: 1,
        reduceMotion: false,
        isAmbientMode: false,
        didSeekThisFrame: false,
        variationId: 'led-stage-matrix',
        manualScrollY: 0,
        isFollowingPlayback: true,
        hoveredLineIndex: -1,
        backgroundOpacity: 0.95,
        vignetteStrength: 0.55,
        textAlign: 'left',
        trackMetadata: null,
        recordHitRect: () => {},
      },
      960,
      600
    );

    const texts = ctx.ops.filter((op) => Array.isArray(op) && op[0] === 'fillText').map((op) => op[1]);
    assert.ok(texts.includes('await '), 'Instrumental gap must draw await keyword');
    assert.ok(texts.includes('solo()'), 'Instrumental gap must draw solo() call');
    assert.ok(texts.includes('// ♪ instrumental...'), 'Instrumental gap must draw instrumental comment');
  });
});
