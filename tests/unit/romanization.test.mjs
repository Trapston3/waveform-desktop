// Unit tests for WS4 + WS6 offline transliteration, proportional romanized word timings,
// SyncEngine instrumental gap telemetry, LyricsPipeline/Bridge/Store/Measurer, and CodeEditorKinetic romanization.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

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
  NON_LATIN_SCRIPT_REGEX,
  hasNonLatinScript,
  transliterateToLatin,
  mapRomanizedWords,
} = await import('../../src/utils/transliterate.ts');

const {
  EmbeddedTrackLyricsProvider,
  LyricsPipeline,
  SyncEngine,
  synthesizeLyricsWords,
} = await import('../../src/lyricVisualizer/core/index.ts');

const {
  convertParsedLyricsToVisualizerLyrics,
} = await import('../../src/lyricVisualizer/bridge/waveFormPlaybackBridge.ts');

const {
  useLyricVisualizerStore,
} = await import('../../src/lyricVisualizer/state/lyricVisualizerStore.ts');

const {
  resolveDisplayLine,
  drawInstrumentalIndicator,
} = await import('../../src/lyricVisualizer/rendering/styleInterface.ts');

const { LyricsMeasurer } = await import('../../src/lyricVisualizer/rendering/lyricsMeasurer.ts');
const { CodeEditorKineticStyle } = await import('../../src/lyricVisualizer/rendering/styles/codeEditorKinetic.ts');

function createMockCtx() {
  const ops = [];
  const grad = { addColorStop() {} };
  return {
    ops,
    fillStyle: '#000',
    strokeStyle: '#fff',
    lineWidth: 1,
    globalAlpha: 1,
    font: '16px Inter',
    textAlign: 'left',
    textBaseline: 'top',
    shadowColor: 'transparent',
    shadowBlur: 0,
    save() { ops.push('save'); },
    restore() { ops.push('restore'); },
    translate() {},
    scale() {},
    rotate() {},
    clearRect() {},
    fillRect(x, y, w, h) { ops.push(['fillRect', x, y, w, h]); },
    strokeRect() {},
    rect() {},
    clip() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    arc() {},
    fill() { ops.push('fill'); },
    stroke() { ops.push('stroke'); },
    fillText(t, x, y) { ops.push(['fillText', t, x, y]); },
    createLinearGradient() { return grad; },
    createRadialGradient() { return grad; },
    measureText(t) { return { width: String(t).length * 10 }; },
  };
}

describe('WS4: Offline Romanization & Multi-Script Pipeline', () => {
  test('hasNonLatinScript and NON_LATIN_SCRIPT_REGEX detect non-Latin scripts accurately without stateful /g bugs', () => {
    assert.equal(NON_LATIN_SCRIPT_REGEX.global, false);
    assert.equal(hasNonLatinScript('Hello world 123'), false);
    assert.equal(hasNonLatinScript('Café naïve'), false);
    assert.equal(hasNonLatinScript('夢を見ていた'), true);
    assert.equal(hasNonLatinScript('사랑해'), true);
    assert.equal(hasNonLatinScript('दिल की बात'), true);
    assert.equal(hasNonLatinScript('Привет мир'), true);
    assert.equal(hasNonLatinScript('Καλημέρα'), true);
    assert.equal(hasNonLatinScript('حبيبي'), true);
    assert.equal(hasNonLatinScript('สวัสดี'), true);
  });

  test('transliterateToLatin produces deterministic phonetic Latin across 7 scripts', () => {
    // Japanese Kana + Kanji
    const jp = transliterateToLatin('夢を見ていた');
    assert.equal(jp, 'yume wo miteita');
    assert.equal(transliterateToLatin('さくら キラキラ'), 'sakura kirakira');
    assert.equal(transliterateToLatin('がっこう'), 'gakkou');

    // Korean Hangul (Revised Romanization)
    assert.equal(transliterateToLatin('사랑해'), 'saranghae');
    assert.equal(transliterateToLatin('안녕하세요'), 'annyeonghaseyo');
    assert.equal(transliterateToLatin('몰라'), 'molla');

    // Hindi / Devanagari
    const hi = transliterateToLatin('दिल प्यार रात');
    assert.match(hi, /dil/i);
    assert.match(hi, /pyaar|pyar/i);
    assert.match(hi, /raat/i);

    // Cyrillic
    assert.equal(transliterateToLatin('Привет мир'), 'Privet mir');

    // Greek
    assert.equal(transliterateToLatin('Καλημέρα κόσμε').toLowerCase(), 'kalimera kosme');

    // Arabic
    const ar = transliterateToLatin('حبيبي الليل');
    assert.ok(ar.length > 0 && !hasNonLatinScript(ar), `Expected Latin Arabic transliteration, got: ${ar}`);

    // Thai RTGS
    const th = transliterateToLatin('สวัสดี รัก');
    assert.ok(!hasNonLatinScript(th), `Expected Latin Thai RTGS, got: ${th}`);
    assert.match(th, /rak/i);
  });

  test('mapRomanizedWords preserves exact bounds and proportional per-word timing', () => {
    // 1-to-1 exact preservation
    const orig3 = [
      { text: '夢', startSeconds: 10.0, endSeconds: 11.2 },
      { text: 'を', startSeconds: 11.2, endSeconds: 11.6 },
      { text: '見ていた', startSeconds: 11.6, endSeconds: 14.0 },
    ];
    const mappedExact = mapRomanizedWords(orig3, 'yume wo miteita', 10.0, 14.0);
    assert.equal(mappedExact.length, 3);
    assert.deepEqual(
      mappedExact.map((w) => w.text),
      ['yume', 'wo', 'miteita']
    );
    assert.equal(mappedExact[0].startSeconds, 10.0);
    assert.equal(mappedExact[0].endSeconds, 11.2);
    assert.equal(mappedExact[2].endSeconds, 14.0);

    // Single unspaced Japanese line split into 3 romanized words proportionally
    const single = [{ text: '夢を見ていた', startSeconds: 20.0, endSeconds: 26.0 }];
    const mappedSplit = mapRomanizedWords(single, 'yume wo miteita', 20.0, 26.0);
    assert.equal(mappedSplit.length, 3);
    assert.equal(mappedSplit[0].startSeconds, 20.0);
    assert.equal(mappedSplit[2].endSeconds, 26.0);
    for (let i = 0; i < mappedSplit.length; i++) {
      assert.ok(mappedSplit[i].endSeconds > mappedSplit[i].startSeconds);
      if (i > 0) {
        assert.equal(mappedSplit[i].startSeconds, mappedSplit[i - 1].endSeconds);
      }
    }
  });

  test('LyricsPipeline, WordSynthesizer, and WaveFormPlaybackBridge auto-populate romanization and pass through translations', async () => {
    const lineSynced = {
      providerName: 'Test',
      sourceKind: 'LineSynced',
      lines: [
        {
          startSeconds: 1,
          endSeconds: 5,
          text: '夢を見ていた',
          words: [],
          isSynthesizedWords: false,
          romanizedText: 'yume wo miteita',
          translatedText: 'I was dreaming',
        },
      ],
    };
    const synth = synthesizeLyricsWords(lineSynced);
    assert.equal(synth.lines[0].romanizedText, 'yume wo miteita');
    assert.equal(synth.lines[0].translatedText, 'I was dreaming');
    assert.equal(synth.lines[0].romanizedWords?.length, 3);

    const pipeline = new LyricsPipeline({ providers: [new EmbeddedTrackLyricsProvider()] });
    const resolved = await pipeline.resolveLyricsAsync({
      id: 'jp-track',
      title: 'Dream',
      artist: 'Artist',
      durationSeconds: 30,
      parsedLyricsLines: [
        {
          startTimeMs: 1000,
          endTimeMs: 4000,
          text: '夢を見ていた',
          translatedText: 'I was dreaming',
        },
      ],
    });
    assert.ok(resolved);
    assert.equal(resolved.lines[0].romanizedText, 'yume wo miteita');
    assert.equal(resolved.lines[0].translatedText, 'I was dreaming');
    assert.equal(resolved.lines[0].romanizedWords?.length, 3);

    const bridged = convertParsedLyricsToVisualizerLyrics({
      type: 'LINE_SYNCED',
      provider: 'LrcLib',
      isSynced: true,
      lines: [
        {
          startTimeMs: 2000,
          endTimeMs: 6000,
          text: '사랑해',
          translation: 'I love you',
        },
      ],
    });
    assert.ok(bridged);
    assert.equal(bridged.lines[0].romanizedText, 'saranghae');
    assert.equal(bridged.lines[0].translatedText, 'I love you');
    assert.equal(bridged.lines[0].romanizedWords?.[0].text, 'saranghae');
  });

  test('lyricVisualizerStore persists and validates scriptMode via setScriptMode', () => {
    const storageMap = new Map();
    const prevStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (k) => storageMap.get(k) ?? null,
        setItem: (k, v) => storageMap.set(k, String(v)),
      },
      configurable: true,
      writable: true,
    });
    try {
      const store = useLyricVisualizerStore.getState();
      assert.equal(store.config.scriptMode, 'auto');
      store.setScriptMode('romanized_translation');
      assert.equal(useLyricVisualizerStore.getState().config.scriptMode, 'romanized_translation');
      store.setScriptMode('invalid-mode');
      assert.equal(useLyricVisualizerStore.getState().config.scriptMode, 'romanized_translation');
      store.setScriptMode('auto');
    } finally {
      if (prevStorage) Object.defineProperty(globalThis, 'localStorage', prevStorage);
      else delete globalThis.localStorage;
    }
  });

  test('SyncEngine computes instrumental gap fields for empty, intro (>3s), mid-song (>=3.5s & word-end tail), and outro', () => {
    const engine = new SyncEngine();
    const track = { id: 'gap-test', title: 'Gap', artist: 'Test', durationSeconds: 60 };

    // Empty lyrics -> instrumental gap
    const emptyFrame = engine.update({ track, positionSeconds: 5, isPlaying: false, playbackRate: 1, timestampMs: 100 }, null, 100);
    assert.equal(emptyFrame.isInstrumentalGap, true);
    assert.equal(emptyFrame.hasLyrics, false);
    assert.equal(emptyFrame.lastActiveLineIndex, -1);

    const lyrics = {
      providerName: 'Test',
      sourceKind: 'WordSynced',
      lines: [
        {
          startSeconds: 5.0,
          endSeconds: 15.0, // clamped to nextLine.startSeconds like LRC!
          text: 'First line',
          isSynthesizedWords: false,
          words: [
            { text: 'First', startSeconds: 5.0, endSeconds: 6.0 },
            { text: 'line', startSeconds: 6.0, endSeconds: 7.5 }, // ends 7.5s before next line!
          ],
        },
        {
          startSeconds: 15.0,
          endSeconds: 18.0,
          text: 'Second line',
          isSynthesizedWords: false,
          words: [{ text: 'Second', startSeconds: 15.0, endSeconds: 18.0 }],
        },
      ],
    };

    // Intro > 3.0s
    const intro = engine.update({ track, positionSeconds: 2.5, isPlaying: false, playbackRate: 1, timestampMs: 200, didSeek: true }, lyrics, 200);
    assert.equal(intro.isInstrumentalGap, true);
    assert.equal(intro.hasLyrics, true);
    assert.equal(intro.nextLineIndex, 0);
    assert.ok(Math.abs(intro.gapProgress - 0.5) < 1e-6);
    assert.ok(Math.abs(intro.timeUntilNextLine - 2.5) < 1e-6);

    // Tail gap when words[last].endSeconds ends 7.5s before next line despite clamped line.endSeconds
    const midTailGap = engine.update({ track, positionSeconds: 11.25, isPlaying: false, playbackRate: 1, timestampMs: 300, didSeek: true }, lyrics, 300);
    assert.equal(midTailGap.isInstrumentalGap, true);
    assert.equal(midTailGap.lastActiveLineIndex, 0);
    assert.equal(midTailGap.nextLineIndex, 1);
    assert.ok(Math.abs(midTailGap.gapProgress - 0.5) < 1e-6);
    assert.ok(Math.abs(midTailGap.timeUntilNextLine - 3.75) < 1e-6);

    // Outro
    const outro = engine.update({ track, positionSeconds: 25.0, isPlaying: false, playbackRate: 1, timestampMs: 400, didSeek: true }, lyrics, 400);
    assert.equal(outro.isInstrumentalGap, true);
    assert.equal(outro.lastActiveLineIndex, 1);
    assert.equal(outro.nextLineIndex, -1);
    assert.equal(outro.timeUntilNextLine, Number.POSITIVE_INFINITY);
  });

  test('resolveDisplayLine, LyricsMeasurer scriptMode cache + CJK segmentation, and CodeEditorKinetic romanized code + comment', () => {
    const jpLine = {
      startSeconds: 1,
      endSeconds: 4,
      text: '夢を見ていた',
      romanizedText: 'yume wo miteita',
      translatedText: 'I was dreaming',
      isSynthesizedWords: false,
      words: [{ text: '夢を見ていた', startSeconds: 1, endSeconds: 4 }],
    };

    const autoStandard = resolveDisplayLine(jpLine, 'auto', 'IosTextingMotion');
    assert.equal(autoStandard.primaryText, '夢を見ていた');
    assert.equal(autoStandard.secondaryText, 'I was dreaming');

    const autoCode = resolveDisplayLine(jpLine, 'auto', 'CodeEditorKinetic');
    assert.equal(autoCode.primaryText, 'yume wo miteita');
    assert.equal(autoCode.secondaryText, 'I was dreaming');

    const romOnly = resolveDisplayLine(jpLine, 'romanized');
    assert.equal(romOnly.primaryText, 'yume wo miteita');
    assert.equal(romOnly.secondaryText, null);

    const ctx = createMockCtx();
    const measurer = new LyricsMeasurer();
    const lyrics = {
      providerName: 'Test',
      sourceKind: 'WordSynced',
      lines: [jpLine],
    };

    const layoutOrig = measurer.measure(ctx, lyrics, 300, 500, 'Inter', 1.0, undefined, { scriptMode: 'original' });
    const layoutRom = measurer.measure(ctx, lyrics, 300, 500, 'Inter', 1.0, undefined, { scriptMode: 'romanized' });
    assert.notEqual(layoutOrig, layoutRom);
    assert.equal(measurer.measureCount, 2);
    assert.equal(layoutRom.lines[0].text, 'yume wo miteita');
    assert.equal(layoutRom.lines[0].words.map((w) => w.text).join(' '), 'yume wo miteita');

    // Unspaced CJK wrapping segments cleanly without shrinking single line to tiny font
    const longCjkLine = {
      startSeconds: 0,
      endSeconds: 5,
      text: 'キラキラ光る夜空の星を見上げていた',
      isSynthesizedWords: false,
      words: [{ text: 'キラキラ光る夜空の星を見上げていた', startSeconds: 0, endSeconds: 5 }],
    };
    const cjkLayout = measurer.measure(ctx, { providerName: 'Test', sourceKind: 'LineSynced', lines: [longCjkLine] }, 140, 400, 'Inter', 1.0, undefined, { scriptMode: 'original' });
    assert.ok(cjkLayout.lines[0].words.length > 1, 'Unspaced CJK line should segment cleanly');

    // CodeEditorKinetic formats Japanese line as yume.wo(miteita); (NEVER w0.w1(w2);) + trailing // comment
    const codeStyle = new CodeEditorKineticStyle();
    const codeLayout = measurer.measure(ctx, lyrics, 600, 500, 'JetBrains Mono', 1.0, undefined, codeStyle.getMeasurementSpec({ scriptMode: 'auto' }));
    ctx.ops.length = 0;
    codeStyle.render(
      ctx,
      {
        lyrics,
        layout: codeLayout,
        timeSeconds: 2.0,
        deltaSeconds: 1 / 60,
        activeLineIndex: 0,
        activeWordIndex: 0,
        wordProgress: 0.5,
        lineFadeAlpha: 1,
        scriptMode: 'auto',
        palette: {
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
        },
        audio: { rmsLevel: 0.4, bassEnergy: 0.4, midEnergy: 0.3, trebleEnergy: 0.3, beatDetected: false },
        fontFamily: 'JetBrains Mono',
        fontSizeScale: 1,
        dpiScale: 1,
        reduceMotion: true,
        isAmbientMode: false,
        didSeekThisFrame: false,
        variationId: 'ide-macro',
        manualScrollY: 0,
        isFollowingPlayback: true,
        hoveredLineIndex: -1,
        backgroundOpacity: 0.95,
        vignetteStrength: 0.5,
        textAlign: 'left',
        trackMetadata: null,
        recordHitRect: () => {},
      },
      800,
      500
    );

    const renderedTexts = ctx.ops.filter((op) => Array.isArray(op) && op[0] === 'fillText').map((op) => op[1]);
    assert.ok(renderedTexts.includes('yume'), 'Must render romanized token yume');
    assert.ok(renderedTexts.includes('wo'), 'Must render romanized token wo');
    assert.ok(renderedTexts.includes('miteita'), 'Must render romanized token miteita');
    assert.ok(!renderedTexts.includes('w0'), 'Must NEVER render fallback w0 identifier');
    assert.ok(renderedTexts.includes('// I was dreaming'), 'Must render trailing inline translation/original comment');

    // Shared instrumental indicator renders cleanly
    ctx.ops.length = 0;
    drawInstrumentalIndicator(
      ctx,
      {
        lyrics: null,
        layout: null,
        timeSeconds: 3.0,
        deltaSeconds: 1 / 60,
        activeLineIndex: -1,
        activeWordIndex: -1,
        wordProgress: 0,
        lineFadeAlpha: 0,
        isInstrumentalGap: true,
        gapProgress: 0.5,
        timeUntilNextLine: 4.0,
        hasLyrics: false,
        palette: {
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
        },
        audio: { rmsLevel: 0.5, bassEnergy: 0.6, midEnergy: 0.4, trebleEnergy: 0.3, beatDetected: true },
        fontFamily: 'Inter',
        fontSizeScale: 1,
        dpiScale: 1,
        reduceMotion: false,
        isAmbientMode: false,
        didSeekThisFrame: false,
        variationId: 'silk-glow',
        manualScrollY: 0,
        isFollowingPlayback: true,
        hoveredLineIndex: -1,
        backgroundOpacity: 0.95,
        vignetteStrength: 0.5,
        textAlign: 'center',
        trackMetadata: null,
        recordHitRect: () => {},
      },
      800,
      500,
      '#5eead4'
    );
    assert.ok(ctx.ops.length > 0);
  });
});
