// Style: CodeEditorKinetic
// Flagship dark obsidian IDE kinetic typography visualizer with deterministic lyric-to-code
// syntax transformation, glowing crimson block cursor + collaborator pills, 7 precomputed
// code-native word effects, spring-damped macro camera with beat chromatic split,
// dark-glass telemetry pills, and 4 variations.
// Strict 60fps with ZERO per-frame heap allocations inside render().

import type {
  Lyrics,
  LyricsLayout,
  LyricsScriptMode,
  LyricWord,
  StyleFrameContext,
  StyleTrackMetadata,
} from '../../core/models';
import {
  clamp01,
  drawRoundedRectPath,
  easeOutBack,
  easeOutCubic,
  getFocalRect,
  isTransparentStage,
  isUnsyncedLyrics,
  resolveDisplayLine,
  type ILyricVisualStyle,
  type StyleMeasurementSpec,
} from '../styleInterface';
import {
  hasNonLatinScript,
  mapRomanizedWords,
  transliterateToLatin,
} from '../../../utils/transliterate';
import { isBlankOrInstrumentalLineText } from '../../core/lrcParser';

export const CODE_FONT_STACK =
  "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace";

export type CodeWordEffect =
  | 'mirror'
  | 'strikethrough'
  | 'squiggle'
  | 'lift'
  | 'sink'
  | 'cascade'
  | 'split'
  | 'nullish'
  | 'loop'
  | 'async'
  | 'return';

export type CodeTokenRole =
  | 'identifier'
  | 'negation'
  | 'hook'
  | 'method'
  | 'punctuation'
  | 'keyword'
  | 'comment';

export interface CodeSyntaxToken {
  readonly text: string;
  readonly role: CodeTokenRole;
  readonly kind: CodeTokenRole;
  readonly color: string;
  readonly wordIndex: number; // 0..wordCount-1 for lyric words; -1 for syntax punctuation
  readonly effect: CodeWordEffect | null;
}

export interface TransformedCodeLineMetadata {
  readonly tokens: readonly CodeSyntaxToken[];
  readonly wordTokenIndices: readonly number[];
  readonly formattedCode: string;
  readonly text: string;
  readonly lineIndex: number;
  readonly indentLevel: number;
  readonly isArrowBlock: boolean;
  readonly isParenthetical: boolean;
  readonly repeatCount: number;
  readonly ghostAnnotation: string | null;
  readonly telemetryLabel: string | null;
}

export type TransformedCodeTokensResult = readonly CodeSyntaxToken[] & TransformedCodeLineMetadata;

// Exact syntax palette from specification
export const CODE_COLOR_IDENTIFIER = '#e6edf3';
export const CODE_COLOR_NEGATION = '#ff2e3b';
export const CODE_COLOR_HOOK = '#f5a623';
export const CODE_COLOR_METHOD = '#7aa2f7';
export const CODE_COLOR_PUNCTUATION = '#6e7681';
export const CODE_BG_OBSIDIAN = '#06070a';

const CODE_WORD_EFFECT_MAP: Readonly<Record<string, CodeWordEffect>> = {
  // mirror
  back: 'mirror',
  reverse: 'mirror',
  mirror: 'mirror',
  turn: 'mirror',
  turning: 'mirror',
  around: 'mirror',
  rewind: 'mirror',
  // strikethrough
  cant: 'strikethrough',
  "can't": 'strikethrough',
  cannot: 'strikethrough',
  erase: 'strikethrough',
  cross: 'strikethrough',
  forget: 'strikethrough',
  forgotten: 'strikethrough',
  become: 'strikethrough',
  gone: 'strikethrough',
  never: 'strikethrough',
  nothing: 'strikethrough',
  dont: 'strikethrough',
  "don't": 'strikethrough',
  wont: 'strikethrough',
  "won't": 'strikethrough',
  // squiggle
  wrong: 'squiggle',
  again: 'squiggle',
  broken: 'squiggle',
  ignored: 'squiggle',
  burn: 'squiggle',
  burning: 'squiggle',
  error: 'squiggle',
  fault: 'squiggle',
  mistake: 'squiggle',
  // lift
  up: 'lift',
  rise: 'lift',
  rising: 'lift',
  high: 'lift',
  higher: 'lift',
  sky: 'lift',
  above: 'lift',
  soar: 'lift',
  // sink
  down: 'sink',
  low: 'sink',
  lower: 'sink',
  fall: 'sink',
  falling: 'sink',
  fell: 'sink',
  drop: 'sink',
  sink: 'sink',
  sinking: 'sink',
  under: 'sink',
  // cascade
  you: 'cascade',
  away: 'cascade',
  fade: 'cascade',
  fading: 'cascade',
  apart: 'cascade',
  // split
  torn: 'split',
  split: 'split',
  break: 'split',
  breaking: 'split',
  shatter: 'split',
  // nullish
  null: 'nullish',
  empty: 'nullish',
  void: 'nullish',
  zero: 'nullish',
  hollow: 'nullish',
  blank: 'nullish',
  undefined: 'nullish',
  // loop
  forever: 'loop',
  always: 'loop',
  loop: 'loop',
  repeat: 'loop',
  endless: 'loop',
  eternal: 'loop',
  circle: 'loop',
  cycle: 'loop',
  round: 'loop',
  // async
  wait: 'async',
  waiting: 'async',
  await: 'async',
  stay: 'async',
  pause: 'async',
  hold: 'async',
  linger: 'async',
  breathe: 'async',
  promise: 'async',
  // return
  return: 'return',
  escape: 'return',
  leave: 'return',
  exit: 'return',
  bail: 'return',
};

export function detectCodeWordEffect(word: string): CodeWordEffect | null {
  if (!word || typeof word !== 'string') return null;
  const cleaned = word.toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, '');
  if (!cleaned) return null;
  const direct = CODE_WORD_EFFECT_MAP[cleaned];
  if (direct) return direct;
  const plain = cleaned.replace(/'/g, '');
  return plain ? (CODE_WORD_EFFECT_MAP[plain] ?? null) : null;
}

const NEGATION_HEAVY_WORDS: ReadonlySet<string> = new Set([
  'cant',
  "can't",
  'cannot',
  'dont',
  "don't",
  'wont',
  "won't",
  'never',
  'nothing',
  'no',
  'not',
  'none',
  'broken',
  'wrong',
  'burn',
  'burning',
  'fire',
  'pain',
  'hurt',
  'die',
  'dead',
  'cry',
  'tears',
  'scream',
  'hate',
  'lost',
  'gone',
  'alone',
  'fear',
  'crash',
  'torn',
  'break',
  'erase',
  'forget',
  'ignored',
  'split',
]);

const HOOK_ACTION_WORDS: ReadonlySet<string> = new Set([
  'feel',
  'run',
  'fly',
  'hold',
  'wake',
  'guide',
  'chart',
  'drift',
  'hum',
  'ring',
  'listen',
  'drive',
  'call',
  'send',
  'walk',
  'turn',
  'fall',
  'rise',
  'shine',
  'sparkle',
  'love',
  'kiss',
  'shake',
  'stay',
  'go',
  'come',
  'take',
  'make',
  'give',
  'keep',
  'find',
  'know',
  'see',
  'look',
  'hear',
  'say',
  'tell',
  'think',
  'want',
  'need',
  'anchored',
  'open',
]);

const OBJECT_METHOD_WORDS: ReadonlySet<string> = new Set([
  'way',
  'time',
  'night',
  'midnight',
  'sky',
  'harbor',
  'home',
  'tide',
  'sea',
  'ocean',
  'rain',
  'starlight',
  'stars',
  'heart',
  'mind',
  'world',
  'life',
  'dream',
  'light',
  'shadow',
  'voice',
  'radio',
  'plane',
  'train',
  'car',
  'moon',
  'sun',
  'rainbow',
  'magic',
  'lanterns',
  'ripples',
  'compass',
  'beacons',
  'constellations',
  'breeze',
  'glow',
]);

function normalizeCodeIdentifier(raw: string, fallbackIdx: number): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/^[^a-z0-9_]+|[^a-z0-9_?!]+$/g, '');
  const base = cleaned.replace(/[^a-z0-9_]/g, '');
  return base || `w${fallbackIdx}`;
}

function classifyWordRoleAndColor(
  rawWord: string,
  ident: string,
  effect: CodeWordEffect | null,
  isCallTarget: boolean
): { role: CodeTokenRole; color: string } {
  const lower = rawWord.toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, '');
  if (
    NEGATION_HEAVY_WORDS.has(lower) ||
    NEGATION_HEAVY_WORDS.has(ident) ||
    effect === 'strikethrough' ||
    effect === 'squiggle' ||
    effect === 'split'
  ) {
    return { role: 'negation', color: CODE_COLOR_NEGATION };
  }
  if (HOOK_ACTION_WORDS.has(ident)) {
    return { role: 'hook', color: CODE_COLOR_HOOK };
  }
  if (OBJECT_METHOD_WORDS.has(ident) || isCallTarget) {
    return { role: 'method', color: CODE_COLOR_METHOD };
  }
  return { role: 'identifier', color: CODE_COLOR_IDENTIFIER };
}

function makePunctToken(text: string, role: CodeTokenRole = 'punctuation'): CodeSyntaxToken {
  return {
    text,
    role,
    kind: role,
    color: CODE_COLOR_PUNCTUATION,
    wordIndex: -1,
    effect: null,
  };
}

export function transformLyricLineToCodeTokens(
  lineText: string,
  wordCount?: number,
  lineIndex = 0,
  repeatCount = 1
): TransformedCodeTokensResult {
  const safeText = typeof lineText === 'string' ? lineText.trim() : '';
  const isParenthetical =
    (safeText.startsWith('(') && safeText.endsWith(')')) || /\([^)]{2,}\)/.test(safeText);

  const splitWords = safeText ? safeText.split(/\s+/).filter(Boolean) : [];
  const targetWordCount =
    typeof wordCount === 'number' && wordCount > 0 ? Math.floor(wordCount) : splitWords.length;

  const rawWords: string[] = new Array(targetWordCount);
  if (targetWordCount > 0) {
    for (let i = 0; i < targetWordCount; i++) {
      if (i < splitWords.length) {
        if (i === targetWordCount - 1 && splitWords.length > targetWordCount) {
          rawWords[i] = splitWords.slice(i).join('_');
        } else {
          rawWords[i] = splitWords[i];
        }
      } else {
        rawWords[i] = `_${i}`;
      }
    }
  }

  const tokens: CodeSyntaxToken[] = [];
  const wordTokenIndices: number[] = new Array(targetWordCount);
  const isArrowBlock = targetWordCount >= 7 && lineIndex % 3 === 1;
  const indentLevel = isParenthetical ? 2 : isArrowBlock ? 1 : lineIndex % 4 === 2 ? 1 : 0;

  if (isArrowBlock) {
    tokens.push(makePunctToken('() => { ', 'keyword'));
  }

  // Determine call parenthesis positions for expressive method-chain syntax:
  // e.g. 8 words -> w0.w1.w2(w3.w4(w5.w6.w7)); ("i.cant.feel(the.way(i.did.before));")
  const openParen1 = targetWordCount >= 5 ? 2 : targetWordCount >= 3 ? 1 : -1;
  const openParen2 = targetWordCount >= 6 ? 4 : -1;

  let openDepth = 0;
  for (let w = 0; w < targetWordCount; w++) {
    const raw = rawWords[w];
    const ident = normalizeCodeIdentifier(raw, w);
    const effect = detectCodeWordEffect(raw);
    const isCallTarget = w === openParen1 || w === openParen2;
    const { role, color } = classifyWordRoleAndColor(raw, ident, effect, isCallTarget);

    wordTokenIndices[w] = tokens.length;
    tokens.push({
      text: ident,
      role,
      kind: role,
      color,
      wordIndex: w,
      effect,
    });

    if (w < targetWordCount - 1) {
      if (w === openParen1 || w === openParen2) {
        tokens.push(makePunctToken('('));
        openDepth++;
      } else {
        tokens.push(makePunctToken('.'));
      }
    }
  }

  if (targetWordCount > 0) {
    const closeParens = openDepth > 0 ? ')'.repeat(openDepth) : targetWordCount <= 2 ? '()' : '';
    const suffix = isArrowBlock ? `${closeParens}; }` : `${closeParens};`;
    tokens.push(makePunctToken(suffix));
  }

  let formattedCode = '';
  for (let i = 0; i < tokens.length; i++) {
    formattedCode += tokens[i].text;
  }

  let ghostAnnotation: string | null = null;
  if (repeatCount > 1) {
    ghostAnnotation = repeatCount > 2 ? `• repeat x${repeatCount}` : '• repeat';
  } else if (
    tokens.some((t) => t.role === 'negation' || t.effect === 'strikethrough' || t.effect === 'squiggle')
  ) {
    ghostAnnotation = '• never read';
  }

  const telemetryLabel =
    repeatCount > 1 ? '● chorus' : isParenthetical ? '● vocal_2' : null;

  const result = tokens as unknown as TransformedCodeTokensResult;
  Object.defineProperties(result, {
    tokens: { value: tokens, enumerable: false },
    wordTokenIndices: { value: wordTokenIndices, enumerable: false },
    formattedCode: { value: formattedCode, enumerable: false },
    text: { value: formattedCode, enumerable: false },
    lineIndex: { value: lineIndex, enumerable: false },
    indentLevel: { value: indentLevel, enumerable: false },
    isArrowBlock: { value: isArrowBlock, enumerable: false },
    isParenthetical: { value: isParenthetical, enumerable: false },
    repeatCount: { value: repeatCount, enumerable: false },
    ghostAnnotation: { value: ghostAnnotation, enumerable: false },
    telemetryLabel: { value: telemetryLabel, enumerable: false },
  });

  return result;
}

// Preallocated line number strings '01'..'256' (zero per-frame string formatting)
const LINE_NUM_LABELS: readonly string[] = Array.from({ length: 256 }, (_, idx) =>
  idx + 1 < 10 ? `0${idx + 1}` : `${idx + 1}`
);

interface PrecomputedVisualToken {
  readonly text: string;
  readonly role: CodeTokenRole;
  readonly color: string;
  readonly wordIndex: number;
  readonly effect: CodeWordEffect | null;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly chars: readonly string[];
  readonly charOffsets: Float32Array;
}

interface PrecomputedCodeLine {
  readonly lineIndex: number;
  readonly lineNumberLabel: string;
  readonly indentLevel: number;
  readonly isParenthetical: boolean;
  readonly repeatCount: number;
  readonly visualTokens: readonly PrecomputedVisualToken[];
  readonly wordVisualIndices: Int32Array;
  readonly topY: number;
  readonly lineH: number;
  readonly centerY: number;
  readonly maxRightX: number;
  readonly ghostAnnotation: string | null;
  readonly inlineComment: string | null;
  readonly hasAsyncBreakpoint: boolean;
  readonly gitDiff: 1 | -1 | 0;
}

function toSlug(input: string | undefined, fallback: string): string {
  if (!input || typeof input !== 'string') return fallback;
  const normalized = hasNonLatinScript(input) ? transliterateToLatin(input) : input;
  const s = normalized
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s ? s.slice(0, 26) : fallback;
}

export class CodeEditorKineticStyle implements ILyricVisualStyle {
  readonly id = 'CodeEditorKinetic' as const;
  readonly name = 'Code Editor Kinetic';
  readonly webGlEffect = 'none' as const;

  private cachedLyrics: Lyrics | null = null;
  private cachedLayout: LyricsLayout | null = null;
  private cachedWidth = -1;
  private cachedFontSize = -1;
  private cachedScriptMode: LyricsScriptMode = 'auto';
  private codeLines: PrecomputedCodeLine[] = [];
  private totalCodeHeight = 0;

  // Cached metadata strings (updated only when track metadata changes)
  private cachedMetaKey = '';
  private tabTitleLabel = 'starlight_harbor.js ×';
  private breadcrumbLabel = 'waveform_studio > session > starlight_harbor.js';
  private topCommentLabel = '// Original Sandbox Sessions — live synced session';
  private primaryCollabSlug = 'waveform_studio';
  private secondaryCollabSlug = 'vocal_2';
  private joinedTelemetryLabel = '● WaveForm Studio joined the session';
  private cachedBpmInt = 120;
  private bpmTelemetryLabel = '● 120 bpm';

  // Lazily cached 32x32 offscreen film-grain pattern for IDE Macro (zero per-frame allocations)
  private filmGrainCanvas: HTMLCanvasElement | null = null;
  private filmGrainPattern: CanvasPattern | null = null;
  private grainInitAttempted = false;

  // Smooth spring-damped scroll, cursor, and macro camera state
  private scrollY = 0;
  private scrollVel = 0;
  private cursorX = 0;
  private cursorY = 0;
  private cameraPanX = 0;
  private cameraZoom = 1.0;
  private whipChromatic = 0;
  private lastActiveLineIdx = -1;
  private lastKnownActiveIdx = -1;
  private lineToCodeIdx: Int32Array = new Int32Array(0);
  private initialized = false;

  getVariationIndex(variationId: string): number {
    if (variationId === 'led-stage-matrix') return 1;
    if (variationId === 'clockwork-orbit') return 2;
    if (variationId === 'clean-dark-ide') return 3;
    return 0; // 'ide-macro'
  }

  getMeasurementSpec(frame?: StyleFrameContext): StyleMeasurementSpec {
    return {
      fontWeight: 600,
      fontSizeMultiplier: 0.78,
      fontFamilyOverride: CODE_FONT_STACK,
      maxLineWidthRatio: 0.82,
      scriptMode: frame?.scriptMode ?? 'auto',
      styleId: this.id,
    };
  }

  reset(): void {
    this.cachedLyrics = null;
    this.cachedLayout = null;
    this.cachedWidth = -1;
    this.cachedFontSize = -1;
    this.cachedScriptMode = 'auto';
    this.codeLines = [];
    this.lineToCodeIdx = new Int32Array(0);
    this.totalCodeHeight = 0;
    this.scrollY = 0;
    this.scrollVel = 0;
    this.cursorX = 0;
    this.cursorY = 0;
    this.cameraPanX = 0;
    this.cameraZoom = 1.0;
    this.whipChromatic = 0;
    this.lastActiveLineIdx = -1;
    this.lastKnownActiveIdx = -1;
    this.initialized = false;
  }

  private updateMetadataStrings(meta: StyleTrackMetadata | null | undefined, bpm: number): void {
    const bpmInt = Math.max(60, Math.min(240, Math.round(Number.isFinite(bpm) && bpm > 0 ? bpm : 120)));
    if (bpmInt !== this.cachedBpmInt) {
      this.cachedBpmInt = bpmInt;
      this.bpmTelemetryLabel = `● ${bpmInt} bpm`;
    }

    const key = meta
      ? `${meta.id}|${meta.title}|${meta.artist}|${meta.album}|${meta.year ?? ''}`
      : 'default';
    if (key === this.cachedMetaKey) return;
    this.cachedMetaKey = key;

    const artistRaw = meta?.artist?.trim() || 'WaveForm Studio';
    const albumRaw = meta?.album?.trim() || 'Original Sandbox Sessions';
    const titleRaw = meta?.title?.trim() || 'starlight_harbor';
    const yearRaw = meta?.year?.trim() || '';

    const artistSlug = toSlug(artistRaw, 'waveform_studio');
    const albumSlug = toSlug(albumRaw, 'session');
    const trackSlug = toSlug(titleRaw, 'track');

    this.tabTitleLabel = `${trackSlug}.js ×`;
    this.breadcrumbLabel = `${artistSlug} > ${albumSlug} > ${trackSlug}.js`;
    this.topCommentLabel = yearRaw
      ? `// ${albumRaw}, ${yearRaw} — ${artistRaw}`
      : `// ${albumRaw} — ${artistRaw}`;
    this.primaryCollabSlug = artistSlug;
    this.secondaryCollabSlug = `${artistSlug}:2`;
    this.joinedTelemetryLabel = `● ${artistRaw} joined the session`;
  }

  private ensurePrecomputed(
    ctx: CanvasRenderingContext2D,
    lyrics: Lyrics,
    layout: LyricsLayout,
    focalWidth: number,
    scriptMode: LyricsScriptMode
  ): void {
    const codeFontSize = Math.max(15, Math.min(30, Math.round(layout.fontSizePx * 0.88)));
    if (
      this.cachedLyrics === lyrics &&
      this.cachedLayout === layout &&
      this.cachedWidth === focalWidth &&
      this.cachedFontSize === codeFontSize &&
      this.cachedScriptMode === scriptMode
    ) {
      return;
    }

    this.cachedLyrics = lyrics;
    this.cachedLayout = layout;
    this.cachedWidth = focalWidth;
    this.cachedFontSize = codeFontSize;
    this.cachedScriptMode = scriptMode;
    this.lastKnownActiveIdx = -1;

    ctx.save();
    ctx.font = `600 ${codeFontSize}px ${CODE_FONT_STACK}`;

    const count = Math.min(lyrics.lines.length, layout.lines.length);
    const lineToCodeIdx = new Int32Array(count);
    lineToCodeIdx.fill(-1);
    const result: PrecomputedCodeLine[] = [];
    const gutterWidth = Math.max(54, Math.round(focalWidth * 0.08));
    const maxCodeLineWidth = Math.max(180, focalWidth - gutterWidth - 48);
    const rowHeight = Math.round(codeFontSize * 1.62);
    const lineGap = Math.round(codeFontSize * 0.52);

    const seenCounts = new Map<string, number>();
    let cursorY = 0;

    for (let i = 0; i < count; i++) {
      const line = lyrics.lines[i];
      const measured = layout.lines[i];
      if (isBlankOrInstrumentalLineText(line.text)) continue;
      const display = resolveDisplayLine(line, scriptMode, this.id);
      if (isBlankOrInstrumentalLineText(display.primaryText)) continue;

      const cIdx = result.length;
      lineToCodeIdx[i] = cIdx;
      const normKey = line.text.trim().toLowerCase();
      const rep = (seenCounts.get(normKey) ?? 0) + 1;
      seenCounts.set(normKey, rep);

      let codeSourceText = display.primaryText;
      let codeSourceWords: readonly LyricWord[] = display.primaryWords;
      if (hasNonLatinScript(codeSourceText)) {
        const fallbackRom =
          (typeof line.romanizedText === 'string' && line.romanizedText.trim()) ||
          transliterateToLatin(codeSourceText);
        if (fallbackRom && !hasNonLatinScript(fallbackRom)) {
          codeSourceText = fallbackRom;
          codeSourceWords =
            line.romanizedWords && line.romanizedWords.length > 0
              ? line.romanizedWords
              : mapRomanizedWords(line.words, fallbackRom, line.startSeconds, line.endSeconds);
        }
      }

      const codeWordTargetCount =
        codeSourceWords.length > 0
          ? codeSourceWords.length
          : codeSourceText.trim().split(/\s+/).filter(Boolean).length;

      const transformed = transformLyricLineToCodeTokens(
        codeSourceText,
        codeWordTargetCount,
        i,
        rep
      );

      const indentPx = transformed.indentLevel * Math.round(codeFontSize * 1.1);
      let penX = indentPx;
      let penY = 0;
      let maxRightX = indentPx;

      const visualTokens: PrecomputedVisualToken[] = new Array(transformed.length);
      const measuredCount = Math.max(1, measured.words.length);
      const wordVisualIndices = new Int32Array(measuredCount);
      wordVisualIndices.fill(-1);

      let hasAsyncBreakpoint = false;
      let hasNegOrDel = false;
      let hasAddOrRise = false;

      for (let t = 0; t < transformed.length; t++) {
        const tok = transformed[t];
        const tokW = Math.max(4, ctx.measureText(tok.text).width);

        if (penX > indentPx + 20 && penX + tokW > maxCodeLineWidth && tok.wordIndex >= 0) {
          penX = indentPx + Math.round(codeFontSize * 1.1);
          penY += rowHeight;
        }

        const chars = tok.effect === 'cascade' ? tok.text.split('') : [];
        const charOffsets = new Float32Array(chars.length);
        let cOff = 0;
        for (let c = 0; c < chars.length; c++) {
          charOffsets[c] = cOff;
          cOff += ctx.measureText(chars[c]).width;
        }

        if (tok.effect === 'async') hasAsyncBreakpoint = true;
        if (tok.role === 'negation' || tok.effect === 'strikethrough' || tok.effect === 'squiggle') {
          hasNegOrDel = true;
        } else if (tok.effect === 'lift' || tok.effect === 'return' || tok.effect === 'loop') {
          hasAddOrRise = true;
        }

        visualTokens[t] = {
          text: tok.text,
          role: tok.role,
          color: tok.color,
          wordIndex: tok.wordIndex,
          effect: tok.effect,
          x: penX,
          y: penY,
          width: tokW,
          height: codeFontSize,
          chars,
          charOffsets,
        };

        if (tok.wordIndex >= 0 && tok.wordIndex < wordVisualIndices.length) {
          wordVisualIndices[tok.wordIndex] = t;
        }

        penX += tokW;
        if (penX > maxRightX) maxRightX = penX;
      }

      // If measured.words count differed from codeSourceWords count, fill proportional indices
      if (measured.words.length > 0 && transformed.wordTokenIndices.length > 0) {
        for (let mw = 0; mw < measured.words.length; mw++) {
          if (wordVisualIndices[mw] < 0) {
            const mappedIdx = Math.min(
              transformed.wordTokenIndices.length - 1,
              Math.floor((mw / measured.words.length) * transformed.wordTokenIndices.length)
            );
            wordVisualIndices[mw] = transformed.wordTokenIndices[mappedIdx];
          }
        }
      }

      const commentBody =
        display.secondaryText ??
        (hasNonLatinScript(line.text) ? line.translatedText?.trim() || line.text.trim() : null);
      const inlineComment = commentBody ? `// ${commentBody}` : null;
      const gitDiff: 1 | -1 | 0 = hasNegOrDel ? -1 : hasAddOrRise || i % 3 === 0 ? 1 : 0;

      const lineH = penY + rowHeight;
      result.push({
        lineIndex: i,
        lineNumberLabel:
          cIdx < LINE_NUM_LABELS.length ? LINE_NUM_LABELS[cIdx] : String(cIdx + 1).padStart(2, '0'),
        indentLevel: transformed.indentLevel,
        isParenthetical: transformed.isParenthetical,
        repeatCount: rep,
        visualTokens,
        wordVisualIndices,
        topY: cursorY,
        lineH,
        centerY: cursorY + lineH * 0.5,
        maxRightX,
        ghostAnnotation: transformed.ghostAnnotation,
        inlineComment,
        hasAsyncBreakpoint,
        gitDiff,
      });

      cursorY += lineH + lineGap;
    }

    ctx.restore();
    this.codeLines = result;
    this.lineToCodeIdx = lineToCodeIdx;
    this.totalCodeHeight = Math.max(1, cursorY);
  }

  private getMotionScale(frame: StyleFrameContext): number {
    if (frame.reduceMotion) return 0;
    if (frame.motionIntensity === 'subtle') return 0.45;
    if (frame.motionIntensity === 'vivid') return 1.45;
    return 1.0;
  }

  private getOrInitFilmGrainPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
    if (this.filmGrainPattern) return this.filmGrainPattern;
    if (this.grainInitAttempted) return null;
    if (
      typeof document === 'undefined' ||
      typeof document.createElement !== 'function' ||
      typeof ctx.createPattern !== 'function'
    ) {
      return null;
    }
    this.grainInitAttempted = true;
    try {
      const patCanvas = document.createElement('canvas');
      patCanvas.width = 32;
      patCanvas.height = 32;
      const pctx = patCanvas.getContext('2d');
      if (pctx) {
        let seed = 0x9e3779b9;
        for (let py = 0; py < 32; py++) {
          for (let px = 0; px < 32; px++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            const v = seed >>> 24;
            if (v > 205) {
              pctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
              pctx.fillRect(px, py, 1, 1);
            } else if (v < 48) {
              pctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
              pctx.fillRect(px, py, 1, 1);
            }
          }
        }
        this.filmGrainCanvas = patCanvas;
        this.filmGrainPattern = ctx.createPattern(patCanvas, 'repeat');
      }
    } catch {
      this.filmGrainPattern = null;
    }
    return this.filmGrainPattern;
  }

  private drawVariationBackdrop(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    focalLeft: number,
    focalWidth: number,
    fullWidth: number,
    height: number,
    variationIdx: number,
    motionScale: number
  ): void {
    const cx = focalLeft + focalWidth * 0.54;
    const cy = height * 0.52;

    if (variationIdx === 1) {
      // LED Stage Matrix: spans FULL width with zero seam at focal.left
      const step = 22;
      const bass = frame.audio.bassEnergy;
      const mid = frame.audio.midEnergy;
      const treble = frame.audio.trebleEnergy;
      const beatKick =
        motionScale > 0 && frame.audio.isDownbeat
          ? 0.2
          : motionScale > 0 && frame.audio.beatDetected
          ? 0.12
          : 0;
      const rightEdge = fullWidth - 16;

      ctx.save();
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = pass === 0 ? CODE_COLOR_NEGATION : CODE_COLOR_HOOK;
        let rowIdx = 0;
        for (let gy = 64; gy < height - 28; gy += step) {
          let colIdx = 0;
          for (let gx = 16; gx < rightEdge; gx += step) {
            if (((rowIdx + colIdx) & 1) === pass) {
              const wave =
                motionScale === 0
                  ? 0.32
                  : 0.5 +
                    0.5 *
                      Math.sin(
                        gx * 0.02 + gy * 0.024 - frame.timeSeconds * (pass === 0 ? 3.2 : 2.5)
                      );
              const energy = pass === 0 ? bass * 0.09 + treble * 0.04 : mid * 0.08 + treble * 0.05;
              ctx.globalAlpha = 0.035 + wave * (0.055 + energy + beatKick * 0.4);
              ctx.fillRect(gx, gy, 2.4, 2.4);
            }
            colIdx++;
          }
          rowIdx++;
        }
      }

      // Bottom-edge beat-reactive warm amber/crimson stage light wash across FULL width
      const washTop = height * 0.68;
      const washGrad = ctx.createLinearGradient(0, washTop, 0, height);
      washGrad.addColorStop(0, 'rgba(255, 46, 59, 0)');
      washGrad.addColorStop(0.55, 'rgba(245, 166, 35, 0.22)');
      washGrad.addColorStop(1, 'rgba(255, 46, 59, 0.48)');
      ctx.globalAlpha = 0.28 + bass * 0.45 + beatKick * 1.4;
      ctx.fillStyle = washGrad;
      ctx.fillRect(0, washTop, fullWidth, height - washTop);

      // Subtle crowd silhouette curve along bottom edge across FULL width
      const crowdBaseY = height - 8;
      const bumpCount = 16;
      const bumpW = fullWidth / bumpCount;
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = '#030407';
      ctx.beginPath();
      ctx.moveTo(0, height);
      ctx.lineTo(0, crowdBaseY);
      for (let c = 0; c < bumpCount; c++) {
        const sx = c * bumpW;
        const ex = sx + bumpW;
        const ctrlX = sx + bumpW * 0.5;
        const sway =
          motionScale === 0
            ? 0
            : Math.sin(frame.timeSeconds * 3.4 + c * 1.15) * (1.2 + bass * 2.5);
        const crestH = 7 + ((c * 7 + 3) % 5) * 2.4 + sway;
        ctx.quadraticCurveTo(ctrlX, crowdBaseY - crestH, ex, crowdBaseY - (c % 3) * 1.5);
      }
      ctx.lineTo(fullWidth, height);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else if (variationIdx === 2) {
      // Clockwork Orbit: concentric BPM-locked geometric timing rings, inner gear teeth, & sweeping clock hand
      const bpm = this.cachedBpmInt;
      const beatsElapsed = frame.timeSeconds * (bpm / 60);
      const beatPhase = beatsElapsed % 1.0;
      const baseR = Math.min(focalWidth, height) * 0.34;
      const beatPulse =
        motionScale > 0 && frame.audio.isDownbeat
          ? 1 + 0.075 * motionScale
          : motionScale > 0 && frame.audio.beatDetected
          ? 1 + 0.045 * motionScale
          : 1.0;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(beatPulse, beatPulse);

      for (let rIdx = 0; rIdx < 3; rIdx++) {
        const radius = baseR * (0.52 + rIdx * 0.28);
        ctx.strokeStyle =
          rIdx === 1 ? 'rgba(255, 46, 59, 0.16)' : 'rgba(122, 162, 247, 0.12)';
        ctx.lineWidth = rIdx === 1 ? 1.5 : 1;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.stroke();

        const dir = rIdx % 2 === 0 ? 1 : -1;
        const angle =
          (motionScale === 0 ? 0.4 : beatsElapsed * 0.65 * dir) + rIdx * 1.4;
        ctx.strokeStyle =
          rIdx === 1 ? 'rgba(255, 46, 59, 0.34)' : 'rgba(245, 166, 35, 0.24)';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(0, 0, radius, angle, angle + 0.85);
        ctx.stroke();
      }

      const innerR = baseR * 0.52;
      const gearSpin = motionScale === 0 ? 0.2 : beatsElapsed * 0.65;
      const gearTeeth = 24;
      ctx.strokeStyle = 'rgba(122, 162, 247, 0.26)';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      for (let t = 0; t < gearTeeth; t++) {
        const a = (t / gearTeeth) * Math.PI * 2 + gearSpin;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        ctx.moveTo(cos * (innerR - 4.5), sin * (innerR - 4.5));
        ctx.lineTo(cos * (innerR + 5.5), sin * (innerR + 5.5));
      }
      ctx.stroke();

      const outerR = baseR * 1.08;
      ctx.strokeStyle = 'rgba(230, 237, 243, 0.14)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2 + (motionScale > 0 ? beatPhase * 0.08 : 0);
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        ctx.moveTo(cos * (outerR - 8), sin * (outerR - 8));
        ctx.lineTo(cos * (outerR + 4), sin * (outerR + 4));
      }
      ctx.stroke();

      const lastLineEnd =
        frame.lyrics && frame.lyrics.lines.length > 0
          ? frame.lyrics.lines[frame.lyrics.lines.length - 1].endSeconds
          : 0;
      const songProgress = lastLineEnd > 0 ? clamp01(frame.timeSeconds / lastLineEnd) : 0;
      const handAngle =
        -Math.PI * 0.5 +
        (motionScale === 0 ? songProgress * Math.PI * 2 : beatsElapsed * Math.PI * 0.5);
      const hCos = Math.cos(handAngle);
      const hSin = Math.sin(handAngle);
      ctx.strokeStyle = 'rgba(255, 46, 59, 0.62)';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(-hCos * (baseR * 0.14), -hSin * (baseR * 0.14));
      ctx.lineTo(hCos * (baseR * 0.96), hSin * (baseR * 0.96));
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 46, 59, 0.72)';
      ctx.beginPath();
      ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawCodeToken(
    ctx: CanvasRenderingContext2D,
    tok: PrecomputedVisualToken,
    tx: number,
    ty: number,
    alpha: number,
    isActiveLine: boolean,
    isWordActive: boolean,
    isWordPassed: boolean,
    wordProgress: number,
    motionScale: number,
    timeSeconds: number,
    repeatCount: number,
    variationIdx: number
  ): void {
    const eff = tok.effect;
    const effectActive = isActiveLine && (isWordActive || isWordPassed);
    const p = isWordActive ? clamp01(wordProgress) : isWordPassed ? 1.0 : 0.0;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = tok.color;

    if (isActiveLine && (isWordActive || tok.role === 'negation' || repeatCount > 1 || variationIdx === 1)) {
      ctx.shadowColor = tok.color;
      const baseGlow = isWordActive ? 14 : tok.role === 'negation' ? 10 : 6;
      ctx.shadowBlur = baseGlow + Math.min(8, (repeatCount - 1) * 3) + (variationIdx === 1 ? 4 : 0);
    }

    // Nullish pill background behind token
    if (eff === 'nullish' && effectActive) {
      drawRoundedRectPath(ctx, tx - 3, ty - 1, tok.width + 6, tok.height + 3, 4);
      ctx.fillStyle = 'rgba(139, 148, 158, 0.16)';
      ctx.fill();
      ctx.fillStyle = '#c9d1d9';
    }

    if (eff === 'mirror' && effectActive) {
      const cx = tx + tok.width * 0.5;
      const cy = ty + tok.height * 0.5;
      ctx.translate(cx, cy);
      ctx.scale(-1, 1);
      ctx.fillText(tok.text, -tok.width * 0.5, -tok.height * 0.5);
    } else if (eff === 'lift' && effectActive) {
      const liftY = motionScale === 0 ? -3 : -5.5 * easeOutCubic(p) * Math.min(1.2, motionScale);
      ctx.fillText(tok.text, tx, ty + liftY);
    } else if (eff === 'sink' && effectActive) {
      const sinkY = motionScale === 0 ? 3 : 5.5 * easeOutCubic(p) * Math.min(1.2, motionScale);
      ctx.fillText(tok.text, tx, ty + sinkY);
    } else if (eff === 'return' && effectActive) {
      const punch = isWordActive && motionScale > 0 ? 1 + 0.1 * Math.sin(p * Math.PI) : 1.0;
      const cx = tx + tok.width * 0.5;
      const cy = ty + tok.height * 0.5;
      ctx.translate(cx, cy);
      ctx.scale(punch, punch);
      ctx.translate(-cx, -cy);
      ctx.fillStyle = '#ff7b72';
      ctx.fillText(tok.text, tx, ty);
    } else if (eff === 'cascade' && effectActive && tok.chars.length > 0) {
      const stepY = (motionScale === 0 ? 1.2 : 2.2 * Math.min(1.25, motionScale)) * easeOutCubic(p);
      for (let c = 0; c < tok.chars.length; c++) {
        ctx.fillText(tok.chars[c], tx + tok.charOffsets[c], ty + c * stepY);
      }
    } else if (eff === 'split' && effectActive && typeof ctx.clip === 'function') {
      const splitShift =
        motionScale === 0
          ? 1.5
          : (isWordActive ? Math.sin(p * Math.PI) * 3.8 : 2.0) * Math.min(1.3, motionScale);
      const midY = ty + tok.height * 0.52;

      ctx.save();
      ctx.beginPath();
      ctx.rect(tx - 8, ty - 6, tok.width + 16, tok.height * 0.54 + 6);
      ctx.clip();
      ctx.fillText(tok.text, tx - splitShift, ty);
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.rect(tx - 8, midY, tok.width + 16, tok.height * 0.6 + 6);
      ctx.clip();
      ctx.fillText(tok.text, tx + splitShift, ty);
      ctx.restore();
    } else {
      ctx.fillText(tok.text, tx, ty);
    }

    ctx.shadowBlur = 0;

    // Crimson strikethrough + animated delete cursor sweep
    if (eff === 'strikethrough' && (effectActive || !isActiveLine)) {
      const strikeRatio = isActiveLine ? Math.max(0.25, easeOutCubic(p)) : 1.0;
      const strikeY = ty + tok.height * 0.54;
      const tipX = tx - 1 + (tok.width + 2) * strikeRatio;
      ctx.fillStyle = CODE_COLOR_NEGATION;
      ctx.shadowColor = CODE_COLOR_NEGATION;
      ctx.shadowBlur = isActiveLine ? 8 : 0;
      ctx.fillRect(tx - 1, strikeY, (tok.width + 2) * strikeRatio, 2.2);
      if (isActiveLine && isWordActive && p < 0.98) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(tipX, ty + 1, 2, tok.height);
      }
      ctx.shadowBlur = 0;
    }

    // Red IDE diagnostic wavy squiggle + floating IDE diagnostic pill ('ERR_BROKEN' / 'TypeError')
    if (eff === 'squiggle' && (effectActive || !isActiveLine)) {
      const squigY = ty + tok.height + 3;
      const step = 4.5;
      const phase = motionScale === 0 ? 0 : timeSeconds * 7.0;
      ctx.strokeStyle = CODE_COLOR_NEGATION;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(tx, squigY);
      for (let sx = step; sx <= tok.width + 2; sx += step) {
        const clampedX = Math.min(tok.width, sx);
        const wave = Math.sin(sx * 0.9 + phase) * 2.0;
        ctx.lineTo(tx + clampedX, squigY + wave);
      }
      ctx.stroke();

      if (isActiveLine && isWordActive) {
        const diagText = tok.text.includes('broken') ? 'ERR_BROKEN' : 'TypeError';
        ctx.save();
        ctx.font = `700 9.5px ${CODE_FONT_STACK}`;
        const pillW = Math.max(58, ctx.measureText(diagText).width + 10);
        const pillH = 14;
        const pillX = tx;
        const pillY = ty - pillH - 3;
        drawRoundedRectPath(ctx, pillX, pillY, pillW, pillH, 4);
        ctx.fillStyle = 'rgba(40, 12, 18, 0.92)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 46, 59, 0.7)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ff7b72';
        ctx.fillText(diagText, pillX + 5, pillY + pillH * 0.5);
        ctx.restore();
      }
    }

    // Null/empty ghost dashed underline (no setLineDash needed)
    if (eff === 'nullish' && effectActive) {
      const uY = ty + tok.height + 2;
      ctx.fillStyle = '#8b949e';
      for (let gx = 0; gx < tok.width; gx += 6) {
        ctx.fillRect(tx + gx, uY, Math.min(3.5, tok.width - gx), 1.4);
      }
    }

    // Loop while(true) / ∞ badge
    if (eff === 'loop' && isActiveLine && (isWordActive || isWordPassed)) {
      ctx.save();
      ctx.font = `700 9.5px ${CODE_FONT_STACK}`;
      const badge = '∞ while(true)';
      const bw = Math.max(58, ctx.measureText(badge).width + 8);
      const bx = tx;
      const by = ty - 16;
      drawRoundedRectPath(ctx, bx, by, bw, 14, 4);
      ctx.fillStyle = 'rgba(22, 32, 48, 0.92)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(122, 162, 247, 0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = CODE_COLOR_METHOD;
      ctx.fillText(badge, bx + 4, by + 7);
      ctx.restore();
    }

    // Async/wait inline 'await' tag
    if (eff === 'async' && isActiveLine && isWordActive) {
      ctx.save();
      ctx.font = `700 9.5px ${CODE_FONT_STACK}`;
      const bx = tx;
      const by = ty - 16;
      drawRoundedRectPath(ctx, bx, by, 38, 14, 4);
      ctx.fillStyle = 'rgba(42, 22, 54, 0.92)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(198, 120, 221, 0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#d2a8ff';
      ctx.fillText('await', bx + 19, by + 7);
      ctx.restore();
    }

    ctx.restore();
  }

  private drawIdeChromeAndTelemetry(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    focalLeft: number,
    focalWidth: number,
    fullWidth: number,
    activeRepeatCount: number,
    activeIsParen: boolean
  ): number {
    const tabBarH = 30;
    const crumbBarH = 22;
    const totalTopH = tabBarH + crumbBarH;

    ctx.save();
    // 1. Full-width top tab bar (no vertical seam at focalLeft)
    ctx.fillStyle = 'rgba(10, 12, 18, 0.92)';
    ctx.fillRect(0, 0, fullWidth, tabBarH);

    // Active tab pill positioned at focalLeft
    const activeTabW = Math.min(230, Math.max(148, this.tabTitleLabel.length * 8.2 + 28));
    ctx.fillStyle = '#0f131d';
    ctx.fillRect(focalLeft, 0, activeTabW, tabBarH);
    ctx.fillStyle = CODE_COLOR_NEGATION;
    ctx.fillRect(focalLeft, 0, activeTabW, 2);

    ctx.fillStyle = CODE_COLOR_HOOK;
    ctx.beginPath();
    ctx.arc(focalLeft + 14, tabBarH * 0.5, 3.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `600 11.5px ${CODE_FONT_STACK}`;
    ctx.fillStyle = CODE_COLOR_IDENTIFIER;
    ctx.fillText(this.tabTitleLabel, focalLeft + 24, tabBarH * 0.5 + 0.5);

    ctx.font = `500 11px ${CODE_FONT_STACK}`;
    ctx.fillStyle = CODE_COLOR_PUNCTUATION;
    ctx.fillText('session_sync.ts', focalLeft + activeTabW + 16, tabBarH * 0.5 + 0.5);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, tabBarH);
    ctx.lineTo(fullWidth, tabBarH);
    ctx.stroke();

    // 2. Full-width breadcrumb bar
    ctx.fillStyle = 'rgba(7, 9, 14, 0.88)';
    ctx.fillRect(0, tabBarH, fullWidth, crumbBarH);
    ctx.font = `500 10.5px ${CODE_FONT_STACK}`;
    ctx.fillStyle = '#8b949e';
    ctx.fillText(this.breadcrumbLabel, focalLeft + 14, tabBarH + crumbBarH * 0.5);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.beginPath();
    ctx.moveTo(0, totalTopH);
    ctx.lineTo(fullWidth, totalTopH);
    ctx.stroke();

    // 3. Dark-glass telemetry pills on right side of chrome (clear of split-view top-right controls)
    if (focalWidth >= 420) {
      const controlsReserve =
        focalLeft > 0 && !frame.isOverlayMode && !frame.isEmbeddedTransparent ? 132 : 12;
      let pillRightX = fullWidth - controlsReserve;
      const pillY = 6;
      const pillH = 19;

      ctx.font = `600 10px ${CODE_FONT_STACK}`;
      const bpmW = ctx.measureText(this.bpmTelemetryLabel).width + 16;
      pillRightX -= bpmW;
      drawRoundedRectPath(ctx, pillRightX, pillY, bpmW, pillH, 9.5);
      ctx.fillStyle = 'rgba(22, 27, 38, 0.86)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(122, 162, 247, 0.28)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = CODE_COLOR_METHOD;
      ctx.fillText(this.bpmTelemetryLabel, pillRightX + 8, pillY + pillH * 0.5 + 0.5);

      const statusText =
        activeRepeatCount > 1
          ? '● chorus'
          : activeIsParen
          ? '● call_response'
          : focalWidth >= 620
          ? this.joinedTelemetryLabel
          : '● live_session';
      const statusColor =
        activeRepeatCount > 1
          ? CODE_COLOR_NEGATION
          : activeIsParen
          ? CODE_COLOR_METHOD
          : '#3fb950';
      const statusW = ctx.measureText(statusText).width + 16;
      pillRightX -= statusW + 8;
      if (pillRightX > focalLeft + activeTabW + 20) {
        drawRoundedRectPath(ctx, pillRightX, pillY, statusW, pillH, 9.5);
        ctx.fillStyle = 'rgba(22, 27, 38, 0.86)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.stroke();
        ctx.fillStyle = statusColor;
        ctx.fillText(statusText, pillRightX + 8, pillY + pillH * 0.5 + 0.5);
      }
    }

    ctx.restore();
    return totalTopH;
  }

  render(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    width: number,
    height: number
  ): void {
    const isTransparent = isTransparentStage(frame);
    const motionScale = this.getMotionScale(frame);
    const variationIdx = this.getVariationIndex(frame.variationId ?? 'ide-macro');
    const bgOpacity = clamp01(frame.backgroundOpacity ?? 1.0);
    const vignetteStrength = clamp01(frame.vignetteStrength ?? 0.55);

    const focal = getFocalRect(frame, width);
    const focalWidth = focal.width;
    const liveBpm = frame.audio.estimatedBpm ?? frame.trackMetadata?.bpm ?? 120;
    this.updateMetadataStrings(frame.trackMetadata, liveBpm);

    // 1. Deep obsidian IDE canvas (#06070a — never bright or washed-out grey)
    if (!isTransparent) {
      ctx.save();
      ctx.globalAlpha = bgOpacity;
      ctx.fillStyle = CODE_BG_OBSIDIAN;
      ctx.fillRect(0, 0, width, height);

      // Subtle atmospheric dark obsidian radial depth
      const glow = ctx.createRadialGradient(
        focal.centerX,
        height * 0.48,
        16,
        focal.centerX,
        height * 0.48,
        Math.max(focalWidth, height) * 0.65
      );
      glow.addColorStop(0, 'rgba(255, 46, 59, 0.06)');
      glow.addColorStop(0.45, 'rgba(122, 162, 247, 0.04)');
      glow.addColorStop(1, 'rgba(6, 7, 10, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      this.drawVariationBackdrop(
        ctx,
        frame,
        focal.left,
        focalWidth,
        width,
        height,
        variationIdx,
        motionScale
      );

      if (variationIdx === 0 && !frame.reduceMotion) {
        const grain = this.getOrInitFilmGrainPattern(ctx);
        if (grain) {
          ctx.save();
          ctx.globalAlpha = 0.035;
          ctx.fillStyle = grain;
          ctx.fillRect(0, 0, width, height);
          ctx.restore();
        }
      }
      ctx.restore();
    }

    const lyrics = frame.lyrics;
    const layout = frame.layout;
    if (!lyrics || !layout || lyrics.lines.length === 0 || layout.lines.length === 0) {
      const chromeH = !isTransparent
        ? this.drawIdeChromeAndTelemetry(ctx, frame, focal.left, focalWidth, width, 1, false)
        : 0;
      this.drawInstrumentalCodeLine(
        ctx,
        frame,
        focal.left + Math.max(54, Math.round(focalWidth * 0.08)) + 16,
        focal.left + Math.max(54, Math.round(focalWidth * 0.08)),
        chromeH + (height - chromeH) * 0.46,
        Math.round(18 * (frame.fontSizeScale || 1)),
        focal.left,
        focalWidth,
        motionScale
      );
      return;
    }

    const scriptMode: LyricsScriptMode = frame.scriptMode ?? 'auto';
    this.ensurePrecomputed(ctx, lyrics, layout, focalWidth, scriptMode);
    if (this.codeLines.length === 0) {
      const chromeH = !isTransparent
        ? this.drawIdeChromeAndTelemetry(ctx, frame, focal.left, focalWidth, width, 1, false)
        : 0;
      this.drawInstrumentalCodeLine(
        ctx,
        frame,
        focal.left + Math.max(54, Math.round(focalWidth * 0.08)) + 16,
        focal.left + Math.max(54, Math.round(focalWidth * 0.08)),
        chromeH + (height - chromeH) * 0.46,
        Math.round(18 * (frame.fontSizeScale || 1)),
        focal.left,
        focalWidth,
        motionScale
      );
      return;
    }

    const activeLineIsBlank =
      frame.activeLineIndex >= 0 &&
      (frame.activeLineIndex >= this.lineToCodeIdx.length ||
        this.lineToCodeIdx[frame.activeLineIndex] < 0);

    // WS6: preserve lastActiveLineIndex across instrumental breaks (never snap -1 -> 0)
    let resolvedActiveIdx = -1;
    if (!activeLineIsBlank && frame.activeLineIndex >= 0) {
      resolvedActiveIdx = this.lineToCodeIdx[frame.activeLineIndex];
      this.lastKnownActiveIdx = Math.min(this.codeLines.length - 1, resolvedActiveIdx);
    } else if (typeof frame.lastActiveLineIndex === 'number' && frame.lastActiveLineIndex >= 0) {
      for (let li = Math.min(this.lineToCodeIdx.length - 1, frame.lastActiveLineIndex); li >= 0; li--) {
        if (this.lineToCodeIdx[li] >= 0) {
          resolvedActiveIdx = this.lineToCodeIdx[li];
          break;
        }
      }
    }
    if (resolvedActiveIdx < 0 && this.lastKnownActiveIdx >= 0) {
      resolvedActiveIdx = this.lastKnownActiveIdx;
    }
    if (resolvedActiveIdx < 0) {
      resolvedActiveIdx = 0;
      for (let i = 0; i < this.codeLines.length; i++) {
        if (lyrics.lines[this.codeLines[i].lineIndex].startSeconds <= frame.timeSeconds) {
          resolvedActiveIdx = i;
        } else {
          break;
        }
      }
    }
    const activeIdx = Math.max(0, Math.min(this.codeLines.length - 1, resolvedActiveIdx));
    const activeCodeLine = this.codeLines[activeIdx];
    const codeFontSize = this.cachedFontSize;
    const gutterWidth = Math.max(54, Math.round(focalWidth * 0.08));
    const codeOriginX = gutterWidth + 16;

    // Locate target cursor coordinates on the active word token
    let targetCursorLocalX = 0;
    let targetCursorLocalY = activeCodeLine.topY;
    let activeCursorTokenW = Math.round(codeFontSize * 0.62);

    if (activeCodeLine.visualTokens.length > 0) {
      const wIdx =
        frame.activeWordIndex >= 0 && frame.activeWordIndex < activeCodeLine.wordVisualIndices.length
          ? activeCodeLine.wordVisualIndices[frame.activeWordIndex]
          : 0;
      const safeTokIdx = wIdx >= 0 ? wIdx : 0;
      const activeTok = activeCodeLine.visualTokens[safeTokIdx];
      const p = frame.activeWordIndex >= 0 ? clamp01(frame.wordProgress) : 0;
      targetCursorLocalX = activeTok.x + activeTok.width * p;
      targetCursorLocalY = activeCodeLine.topY + activeTok.y;
      activeCursorTokenW = Math.max(8, Math.min(14, Math.round(codeFontSize * 0.56)));
    }

    const targetScrollY = activeCodeLine.centerY;
    const dt = Math.max(0.001, Math.min(0.05, frame.deltaSeconds));
    const isMacroCameraActive =
      variationIdx !== 3 &&
      motionScale > 0 &&
      frame.isFollowingPlayback !== false &&
      Math.abs(frame.manualScrollY ?? 0) < 1;

    if (this.initialized && this.lastActiveLineIdx !== activeIdx) {
      if (isMacroCameraActive) {
        this.whipChromatic = Math.min(1.0, this.whipChromatic + 0.85);
      }
      this.lastActiveLineIdx = activeIdx;
    } else if (
      isMacroCameraActive &&
      (frame.audio.beatDetected || (frame.audio.beatStrength ?? 0) > 0.72)
    ) {
      this.whipChromatic = Math.max(this.whipChromatic, 0.55);
    }

    if (!this.initialized || frame.didSeekThisFrame || frame.reduceMotion) {
      this.scrollY = targetScrollY;
      this.scrollVel = 0;
      this.cursorX = targetCursorLocalX;
      this.cursorY = targetCursorLocalY;
      this.cameraPanX = 0;
      this.cameraZoom = 1.0;
      this.whipChromatic = 0;
      this.lastActiveLineIdx = activeIdx;
      this.initialized = true;
    } else {
      const stiffness = 120 * (0.65 + motionScale * 0.35);
      const damping = 19;
      const force = (targetScrollY - this.scrollY) * stiffness;
      this.scrollVel += (force - this.scrollVel * damping) * dt;
      this.scrollY += this.scrollVel * dt;

      const cursorLerp = 1 - Math.exp(-dt * 22);
      this.cursorX += (targetCursorLocalX - this.cursorX) * cursorLerp;
      this.cursorY += (targetCursorLocalY - this.cursorY) * cursorLerp;

      const targetZoom = isMacroCameraActive
        ? (variationIdx === 0 ? 1.07 : 1.03) + frame.audio.bassEnergy * 0.04
        : 1.0;
      const targetPanX = isMacroCameraActive
        ? Math.max(-48, Math.min(64, (this.cursorX - focalWidth * 0.32) * 0.22))
        : 0;

      const camLerp = 1 - Math.exp(-dt * 9.5);
      this.cameraZoom += (targetZoom - this.cameraZoom) * camLerp;
      this.cameraPanX += (targetPanX - this.cameraPanX) * camLerp;
      this.whipChromatic *= Math.exp(-dt * 11);
    }

    const manualOffset = Number.isFinite(frame.manualScrollY) ? (frame.manualScrollY ?? 0) : 0;
    const effectiveScrollY = Math.max(
      -height * 0.35,
      Math.min(this.totalCodeHeight + height * 0.35, this.scrollY + manualOffset)
    );

    // WS2: Draw top IDE chrome across FULL width before translating focal stage (zero seam)
    const chromeTopH = !isTransparent
      ? this.drawIdeChromeAndTelemetry(
          ctx,
          frame,
          focal.left,
          focalWidth,
          width,
          activeCodeLine.repeatCount,
          activeCodeLine.isParenthetical
        )
      : 0;

    ctx.save();
    // WS2: no hard focal.left clip; translate code column into focal stage cleanly
    if (focal.left > 0) ctx.translate(focal.left, 0);

    // Clip vertically below top IDE chrome only (full width horizontally)
    ctx.save();
    if (chromeTopH > 0 && typeof ctx.rect === 'function' && typeof ctx.clip === 'function') {
      ctx.beginPath();
      ctx.rect(-focal.left, chromeTopH, width, Math.max(1, height - chromeTopH));
      ctx.clip();
    }

    const anchorY = chromeTopH + (height - chromeTopH) * 0.46;
    const focusY = anchorY;
    const slantAngle = isMacroCameraActive
      ? Math.sin(frame.timeSeconds * 0.48) * 0.0085 * motionScale
      : 0;

    if (this.cameraZoom !== 1.0 || this.cameraPanX !== 0 || slantAngle !== 0) {
      const focusX = focalWidth * 0.46;
      ctx.translate(focusX - this.cameraPanX, focusY);
      ctx.scale(this.cameraZoom, this.cameraZoom);
      if (slantAngle !== 0) ctx.rotate(slantAngle);
      ctx.translate(-focusX, -focusY);
    }

    // Gutter vertical separator & indent guide line
    if (!isTransparent) {
      ctx.strokeStyle = 'rgba(110, 118, 129, 0.14)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gutterWidth, chromeTopH);
      ctx.lineTo(gutterWidth, height);
      ctx.stroke();
    }

    // Top metadata comment above line 01
    const commentScreenY = anchorY - effectiveScrollY - Math.round(codeFontSize * 1.9);
    if (commentScreenY > chromeTopH - 30 && commentScreenY < height) {
      ctx.font = `500 ${Math.round(codeFontSize * 0.82)}px ${CODE_FONT_STACK}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = CODE_COLOR_PUNCTUATION;
      ctx.globalAlpha = 0.72;
      ctx.fillText(this.topCommentLabel, codeOriginX, commentScreenY);
    }

    const unsyncedOrLineLevel = isUnsyncedLyrics(frame) || frame.activeWordIndex < 0;
    const hoveredIdx = frame.hoveredLineIndex ?? -1;
    const minY = chromeTopH - 60;
    const maxY = height + 60;

    for (let i = 0; i < this.codeLines.length; i++) {
      const cl = this.codeLines[i];
      const screenY = anchorY + (cl.topY - effectiveScrollY);
      if (screenY + cl.lineH < minY || screenY > maxY) continue;

      const isActive = !activeLineIsBlank && frame.activeLineIndex >= 0 && cl.lineIndex === frame.activeLineIndex;
      const isHovered = cl.lineIndex === hoveredIdx;
      const isPast =
        i < activeIdx ||
        ((frame.activeLineIndex < 0 || activeLineIsBlank) &&
          lyrics.lines[cl.lineIndex].endSeconds < frame.timeSeconds);
      const dist = Math.abs(i - activeIdx);

      const hitY =
        (this.cameraZoom !== 1.0
          ? focusY + (screenY - focusY) * this.cameraZoom
          : screenY) - 4;
      const hitH =
        (this.cameraZoom !== 1.0 ? cl.lineH * this.cameraZoom : cl.lineH) + 8;
      frame.recordHitRect?.(
        cl.lineIndex,
        focal.left + 8,
        hitY,
        focalWidth - 16,
        hitH
      );

      // WS2: Active/hovered line highlight band fades cleanly across left edge (zero seam)
      if (isActive || isHovered) {
        ctx.save();
        const fadeLeft = focal.left > 2 ? -Math.min(focal.left, 90) : 0;
        const bandColor = isActive
          ? cl.isParenthetical
            ? 'rgba(122, 162, 247, 0.10)'
            : 'rgba(255, 46, 59, 0.085)'
          : 'rgba(230, 237, 243, 0.045)';
        if (fadeLeft < 0) {
          const bandGrad = ctx.createLinearGradient(fadeLeft, 0, focalWidth, 0);
          bandGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
          bandGrad.addColorStop(Math.min(0.45, Math.abs(fadeLeft) / (focalWidth - fadeLeft)), bandColor);
          bandGrad.addColorStop(1, bandColor);
          ctx.fillStyle = bandGrad;
          ctx.fillRect(fadeLeft, screenY - 5, focalWidth - fadeLeft, cl.lineH + 6);
        } else {
          ctx.fillStyle = bandColor;
          ctx.fillRect(0, screenY - 5, focalWidth, cl.lineH + 6);
        }

        ctx.fillStyle = isActive
          ? cl.isParenthetical
            ? CODE_COLOR_METHOD
            : CODE_COLOR_NEGATION
          : CODE_COLOR_PUNCTUATION;
        ctx.fillRect(gutterWidth - 2.5, screenY - 5, 2.5, cl.lineH + 6);
        ctx.restore();
      }

      // Git diff '+' / '-' gutter marker
      if (cl.gitDiff !== 0) {
        ctx.save();
        ctx.fillStyle = cl.gitDiff > 0 ? '#3fb950' : CODE_COLOR_NEGATION;
        ctx.globalAlpha = isActive ? 0.85 : 0.35;
        ctx.fillRect(gutterWidth - 6, screenY + 2, 2, Math.max(10, cl.lineH - 8));
        ctx.restore();
      }

      // Pulsing red gutter breakpoint dot on async/wait lines
      if (cl.hasAsyncBreakpoint) {
        const bpPulse =
          motionScale === 0 ? 0.85 : 0.55 + 0.45 * Math.sin(frame.timeSeconds * 5.2 + i);
        ctx.save();
        ctx.fillStyle = CODE_COLOR_NEGATION;
        ctx.globalAlpha = (isActive ? 0.95 : 0.45) * bpPulse;
        ctx.beginPath();
        ctx.arc(16, screenY + codeFontSize * 0.55, 4.2 * (0.9 + 0.15 * bpPulse), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Gutter line number ('01', '02', ...)
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.font = `${isActive ? 700 : 500} ${Math.round(codeFontSize * 0.82)}px ${CODE_FONT_STACK}`;
      ctx.fillStyle = isActive
        ? cl.isParenthetical
          ? CODE_COLOR_METHOD
          : CODE_COLOR_NEGATION
        : isHovered
        ? CODE_COLOR_IDENTIFIER
        : '#484f58';
      ctx.globalAlpha = isActive ? 1.0 : isHovered ? 0.9 : 0.65;
      ctx.fillText(cl.lineNumberLabel, gutterWidth - 12, screenY + 2);

      // Code tokens for line i
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const fontWeight = isActive && cl.repeatCount > 1 ? 700 : 600;
      ctx.font = `${fontWeight} ${codeFontSize}px ${CODE_FONT_STACK}`;

      const lineBaseAlpha = isActive
        ? 1.0 * frame.lineFadeAlpha
        : isHovered
        ? 0.92
        : isPast
        ? Math.max(0.48, 0.78 - dist * 0.1)
        : Math.max(0.38, 0.62 - dist * 0.08);

      if (isActive && this.whipChromatic > 0.08 && motionScale > 0) {
        const shift = this.whipChromatic * 2.4 * Math.min(1.3, motionScale);
        ctx.save();
        ctx.globalAlpha = Math.min(0.42, this.whipChromatic * 0.45);
        for (let t = 0; t < cl.visualTokens.length; t++) {
          const vt = cl.visualTokens[t];
          ctx.fillStyle = '#00f0ff';
          ctx.fillText(vt.text, codeOriginX + vt.x - shift, screenY + vt.y);
          ctx.fillStyle = CODE_COLOR_NEGATION;
          ctx.fillText(vt.text, codeOriginX + vt.x + shift, screenY + vt.y);
        }
        ctx.restore();
      }

      for (let t = 0; t < cl.visualTokens.length; t++) {
        const vt = cl.visualTokens[t];
        const tx = codeOriginX + vt.x;
        const ty = screenY + vt.y;

        if (!isActive || unsyncedOrLineLevel) {
          this.drawCodeToken(
            ctx,
            vt,
            tx,
            ty,
            lineBaseAlpha,
            false,
            false,
            isPast,
            isPast ? 1.0 : 0.0,
            motionScale,
            frame.timeSeconds,
            cl.repeatCount,
            variationIdx
          );
        } else {
          const isWordTok = vt.wordIndex >= 0;
          const isWordActive = isWordTok && vt.wordIndex === frame.activeWordIndex;
          const isWordPassed =
            isWordTok
              ? vt.wordIndex < frame.activeWordIndex
              : t <=
                (frame.activeWordIndex >= 0 &&
                frame.activeWordIndex < cl.wordVisualIndices.length
                  ? cl.wordVisualIndices[frame.activeWordIndex]
                  : 0);

          const tokAlpha = isWordActive
            ? 1.0
            : isWordPassed
            ? 0.96
            : 0.48;

          this.drawCodeToken(
            ctx,
            vt,
            tx,
            ty,
            tokAlpha * frame.lineFadeAlpha,
            true,
            isWordActive,
            isWordPassed,
            frame.wordProgress,
            motionScale,
            frame.timeSeconds,
            cl.repeatCount,
            variationIdx
          );
        }
      }

      // Trailing inline original/translated comment (`// ...`) + ghost annotation
      let tailX = codeOriginX + cl.maxRightX + 14;
      if (cl.inlineComment && tailX + 40 < focalWidth) {
        ctx.save();
        ctx.font = `500 ${Math.round(codeFontSize * 0.76)}px ${CODE_FONT_STACK}`;
        ctx.fillStyle = '#6e7681';
        ctx.globalAlpha = isActive ? 0.78 : isPast ? 0.45 : 0.3;
        ctx.fillText(cl.inlineComment, tailX, screenY + 2);
        const cWidth = ctx.measureText(cl.inlineComment).width;
        tailX += (Number.isFinite(cWidth) ? cWidth : cl.inlineComment.length * 8) + 12;
        ctx.restore();
      }
      if (cl.ghostAnnotation && (isActive || isPast || isHovered) && tailX + 70 < focalWidth) {
        ctx.save();
        ctx.font = `500 ${Math.round(codeFontSize * 0.72)}px ${CODE_FONT_STACK}`;
        ctx.fillStyle = cl.repeatCount > 1 ? CODE_COLOR_HOOK : '#484f58';
        ctx.globalAlpha = isActive ? 0.72 : 0.42;
        ctx.fillText(cl.ghostAnnotation, tailX, screenY + 3);
        ctx.restore();
      }
    }

    // WS6: Live pulsing instrumental code line during instrumental gaps
    let nextLineIdx =
      typeof frame.nextLineIndex === 'number' &&
      frame.nextLineIndex >= 0 &&
      frame.nextLineIndex < this.lineToCodeIdx.length &&
      this.lineToCodeIdx[frame.nextLineIndex] >= 0
        ? frame.nextLineIndex
        : -1;
    if (nextLineIdx < 0) {
      for (let c = 0; c < this.codeLines.length; c++) {
        const li = this.codeLines[c].lineIndex;
        if (lyrics.lines[li].startSeconds > frame.timeSeconds) {
          nextLineIdx = li;
          break;
        }
      }
    }
    const nextCodeIdx = nextLineIdx >= 0 ? this.lineToCodeIdx[nextLineIdx] : -1;
    const nextLine = nextLineIdx >= 0 ? lyrics.lines[nextLineIdx] : null;
    const prevCodeObj =
      nextCodeIdx > 0 ? lyrics.lines[this.codeLines[nextCodeIdx - 1].lineIndex] : null;
    const prevEnd = prevCodeObj
      ? prevCodeObj.words.length > 0
        ? Math.min(prevCodeObj.endSeconds, prevCodeObj.words[prevCodeObj.words.length - 1].endSeconds)
        : prevCodeObj.endSeconds
      : 0;
    const gapDur = nextLine ? nextLine.startSeconds - prevEnd : 0;
    const isGap =
      activeLineIsBlank ||
      (typeof frame.isInstrumentalGap === 'boolean'
        ? frame.isInstrumentalGap
        : frame.activeLineIndex < 0 &&
          ((nextCodeIdx === 0 && nextLine!.startSeconds > 3.0) ||
            (nextCodeIdx > 0 && gapDur >= 3.5) ||
            nextCodeIdx < 0));

    if (isGap) {
      const gapScreenY =
        nextCodeIdx === 0
          ? anchorY - codeFontSize * 0.6
          : anchorY + (activeCodeLine.topY + activeCodeLine.lineH + 12 - effectiveScrollY);
      if (gapScreenY > minY && gapScreenY < maxY) {
        this.drawInstrumentalCodeLine(
          ctx,
          frame,
          codeOriginX,
          gutterWidth,
          gapScreenY,
          codeFontSize,
          0,
          focalWidth,
          motionScale
        );
      }
    }

    // Glowing Crimson Block Cursor (█) or Secondary Blue Bar Cursor + Floating Collaborator Pill
    if (!isGap && !activeLineIsBlank && frame.activeLineIndex >= 0 && activeIdx < this.codeLines.length) {
      const curScreenX = codeOriginX + this.cursorX;
      const curScreenY = anchorY + (this.cursorY - effectiveScrollY);
      const isSecondary = activeCodeLine.isParenthetical;
      const cursorColor = isSecondary ? CODE_COLOR_METHOD : CODE_COLOR_NEGATION;
      const cursorW = isSecondary ? 3.5 : activeCursorTokenW;
      const cursorH = Math.round(codeFontSize * 1.12);

      ctx.save();
      ctx.shadowColor = cursorColor;
      ctx.shadowBlur = 14 + frame.audio.bassEnergy * 8;
      ctx.fillStyle = cursorColor;
      ctx.globalAlpha = isSecondary ? 0.28 : 0.22;
      drawRoundedRectPath(ctx, curScreenX - 2, curScreenY - 1, Math.max(4, cursorW + 4), cursorH, 3);
      ctx.fill();

      ctx.globalAlpha = 0.96;
      drawRoundedRectPath(ctx, curScreenX - 3, curScreenY - 1, 2.5, cursorH, 1.25);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.65;
      ctx.fillRect(curScreenX, curScreenY - 1, cursorW, 2);

      const pillLabel = isSecondary ? this.secondaryCollabSlug : this.primaryCollabSlug;
      ctx.font = `700 10px ${CODE_FONT_STACK}`;
      const pillW = Math.max(54, ctx.measureText(pillLabel).width + 14);
      const pillH = 17;
      const pillX = Math.max(gutterWidth + 4, Math.min(focalWidth - pillW - 8, curScreenX - 2));
      const pillY = curScreenY - pillH - 4;

      ctx.fillStyle = cursorColor;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(curScreenX + 1, pillY + pillH - 1, 2, 5);

      drawRoundedRectPath(ctx, pillX, pillY, pillW, pillH, 6);
      ctx.fillStyle = cursorColor;
      ctx.fill();

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isSecondary ? '#06070a' : '#ffffff';
      ctx.globalAlpha = 1.0;
      ctx.fillText(pillLabel, pillX + 7, pillY + pillH * 0.5 + 0.5);
      ctx.restore();
    }

    ctx.restore(); // end code viewport clip
    ctx.restore(); // end focal translate

    // WS2: Edge vignette across FULL (0, 0, width, height)
    if (!isTransparent && vignetteStrength > 0.02) {
      ctx.save();
      const vig = ctx.createRadialGradient(
        width * 0.5,
        height * 0.5,
        Math.min(width, height) * 0.3,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.78
      );
      vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vig.addColorStop(1, 'rgba(0, 0, 0, 0.78)');
      ctx.globalAlpha = vignetteStrength * bgOpacity;
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
  }

  private drawInstrumentalCodeLine(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    codeOriginX: number,
    gutterWidth: number,
    screenY: number,
    codeFontSize: number,
    leftBase: number,
    focalWidth: number,
    motionScale: number
  ): void {
    const t = frame.timeSeconds || 0;
    const bass = frame.audio.bassEnergy ?? 0;
    const pulse = motionScale === 0 ? 0.85 : 0.65 + 0.35 * Math.sin(t * 4.2);
    const rowH = Math.round(codeFontSize * 1.62);

    ctx.save();
    // Pulsing breakpoint dot in gutter
    ctx.fillStyle = CODE_COLOR_NEGATION;
    ctx.globalAlpha = 0.75 * pulse;
    ctx.beginPath();
    ctx.arc(leftBase + 16, screenY + codeFontSize * 0.55, 4.4, 0, Math.PI * 2);
    ctx.fill();

    // Subtle active band
    ctx.fillStyle = 'rgba(122, 162, 247, 0.08)';
    ctx.globalAlpha = 0.85;
    ctx.fillRect(leftBase, screenY - 4, focalWidth, rowH + 4);

    // Tokenized live statement: await audio.solo(); // ♪ instrumental...
    ctx.font = `600 ${codeFontSize}px ${CODE_FONT_STACK}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let penX = codeOriginX;

    const kw = 'await ';
    ctx.fillStyle = '#d2a8ff';
    ctx.globalAlpha = 0.96;
    ctx.fillText(kw, penX, screenY);
    penX += ctx.measureText(kw).width || kw.length * codeFontSize * 0.6;

    const obj = 'audio';
    ctx.fillStyle = CODE_COLOR_IDENTIFIER;
    ctx.fillText(obj, penX, screenY);
    penX += ctx.measureText(obj).width || obj.length * codeFontSize * 0.6;

    const dot = '.';
    ctx.fillStyle = CODE_COLOR_PUNCTUATION;
    ctx.fillText(dot, penX, screenY);
    penX += ctx.measureText(dot).width || codeFontSize * 0.6;

    const fnCall = 'solo()';
    ctx.fillStyle = CODE_COLOR_METHOD;
    ctx.fillText(fnCall, penX, screenY);
    penX += ctx.measureText(fnCall).width || fnCall.length * codeFontSize * 0.6;

    const semi = '; ';
    ctx.fillStyle = CODE_COLOR_PUNCTUATION;
    ctx.fillText(semi, penX, screenY);
    penX += ctx.measureText(semi).width || codeFontSize * 0.6;

    // Blinking crimson block cursor at end of statement
    const cursorW = Math.max(8, Math.round(codeFontSize * 0.55));
    const cursorVisible = motionScale === 0 ? true : Math.sin(t * 6.4) >= -0.2;
    if (cursorVisible) {
      ctx.fillStyle = CODE_COLOR_NEGATION;
      ctx.shadowColor = CODE_COLOR_NEGATION;
      ctx.shadowBlur = 12 + bass * 8;
      ctx.globalAlpha = 0.9;
      drawRoundedRectPath(ctx, penX, screenY, cursorW, Math.round(codeFontSize * 1.08), 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    const commentX = penX + cursorW + 10;
    if (commentX + 60 < leftBase + focalWidth) {
      ctx.fillStyle = '#6e7681';
      ctx.globalAlpha = 0.72 * pulse;
      ctx.font = `500 ${Math.round(codeFontSize * 0.85)}px ${CODE_FONT_STACK}`;
      ctx.fillText('// ♪ instrumental...', commentX, screenY + 1);
    }

    // Beat-reactive progress/audio bar beneath statement
    const barW = Math.min(240, Math.max(100, focalWidth * 0.35));
    const barY = screenY + rowH - 2;
    const progress =
      typeof frame.gapProgress === 'number' && Number.isFinite(frame.gapProgress) && frame.gapProgress > 0
        ? clamp01(frame.gapProgress)
        : clamp01(0.25 + bass * 0.75);
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(codeOriginX, barY, barW, 2);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = CODE_COLOR_METHOD;
    ctx.fillRect(codeOriginX, barY, Math.max(8, barW * progress), 2);

    ctx.restore();
  }
}
