// Cached word-wrapping layout engine for Lyrics.
// Measures text only when lyrics reference, viewport dimensions, typography, or StyleMeasurementSpec change.

import type {
  Lyrics,
  LyricsLayout,
  LyricsScriptMode,
  LyricWord,
  MeasuredLineLayout,
  MeasuredWordLayout,
  VisualStyleId,
} from '../core/models';
import { resolveDisplayLine, type StyleMeasurementSpec } from './styleInterface';

const DEFAULT_BASE_FONT_PX = 38;
const DEFAULT_MAX_LINE_WIDTH_RATIO = 0.85;
const LINE_GAP_MULTIPLIER = 1.48;
const BLOCK_SPACING_MULTIPLIER = 0.72;
const MIN_FONT_SIZE_PX = 14;
const CJK_UNSPACED_REGEX = /[\u3040-\u30FF\u31F0-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF65-\uFF9F]/;
const KANA_ATTACH_REGEX = /^[ゃゅょっぁぃぅぇぉャュョッァィゥェォー、。，．！？!?,.\s]$/;

function segmentTextForWrapping(text: string): string[] {
  const spaceTokens = text.trim().split(/\s+/).filter(Boolean);
  if (spaceTokens.length === 0) return [];
  const out: string[] = [];
  for (let i = 0; i < spaceTokens.length; i++) {
    const tok = spaceTokens[i];
    if (!CJK_UNSPACED_REGEX.test(tok) || tok.length <= 2) {
      out.push(tok);
      continue;
    }
    let current = '';
    for (let c = 0; c < tok.length; c++) {
      const ch = tok[c];
      const isCjk = CJK_UNSPACED_REGEX.test(ch);
      if (KANA_ATTACH_REGEX.test(ch)) {
        current += ch;
      } else if (isCjk) {
        if (current) out.push(current);
        current = ch;
      } else {
        if (current && CJK_UNSPACED_REGEX.test(current[current.length - 1])) {
          out.push(current);
          current = ch;
        } else {
          current += ch;
        }
      }
    }
    if (current) out.push(current);
  }
  return out;
}

function applyTextTransform(
  text: string,
  transform: 'none' | 'uppercase' | 'lowercase'
): string {
  if (transform === 'uppercase') return text.toUpperCase();
  if (transform === 'lowercase') return text.toLowerCase();
  return text;
}

export class LyricsMeasurer {
  private cachedLyrics: Lyrics | null = null;
  private cachedWidth = -1;
  private cachedHeight = -1;
  private cachedFontFamily = '';
  private cachedFontSizeScale = -1;
  private cachedBaseFontPx = -1;
  private cachedWeight = -1;
  private cachedMultiplier = -1;
  private cachedTransform = 'none';
  private cachedLetterSpacing = '0px';
  private cachedMaxWidthRatio = -1;
  private cachedScriptMode: LyricsScriptMode = 'auto';
  private cachedStyleId = '';
  private cachedLayout: LyricsLayout | null = null;
  private measureCalls = 0;

  get measureCount(): number {
    return this.measureCalls;
  }

  invalidate(): void {
    this.cachedLyrics = null;
    this.cachedLayout = null;
    this.cachedWidth = -1;
    this.cachedHeight = -1;
    this.cachedFontFamily = '';
    this.cachedFontSizeScale = -1;
    this.cachedBaseFontPx = -1;
    this.cachedWeight = -1;
    this.cachedMultiplier = -1;
    this.cachedTransform = 'none';
    this.cachedLetterSpacing = '0px';
    this.cachedMaxWidthRatio = -1;
    this.cachedScriptMode = 'auto';
    this.cachedStyleId = '';
  }

  measure(
    ctx: CanvasRenderingContext2D,
    lyrics: Lyrics | null,
    viewportWidth: number,
    viewportHeight: number,
    fontFamily: string,
    fontSizeScale: number,
    baseFontSizePx = DEFAULT_BASE_FONT_PX,
    spec?: StyleMeasurementSpec,
    scriptMode?: LyricsScriptMode,
    styleId?: VisualStyleId | string
  ): LyricsLayout | null {
    if (!lyrics || lyrics.lines.length === 0) {
      this.cachedLyrics = lyrics;
      this.cachedLayout = null;
      return null;
    }

    const safeW = Math.max(120, Math.round(viewportWidth));
    const safeH = Math.max(80, Math.round(viewportHeight));
    const safeScale = Math.max(
      0.5,
      Math.min(2.5, Number.isFinite(fontSizeScale) ? fontSizeScale : 1)
    );
    const safeBase = Number.isFinite(baseFontSizePx) ? baseFontSizePx : DEFAULT_BASE_FONT_PX;
    const weight = spec?.fontWeight ?? 700;
    const multiplier = spec?.fontSizeMultiplier ?? 1.0;
    const effectiveFontFamily = spec?.fontFamilyOverride ?? fontFamily;
    const textTransform = spec?.textTransform ?? 'none';
    const letterSpacing = spec?.letterSpacing ?? '0px';
    const maxLineWidthRatio = spec?.maxLineWidthRatio ?? DEFAULT_MAX_LINE_WIDTH_RATIO;
    const resolvedScriptMode: LyricsScriptMode = scriptMode ?? spec?.scriptMode ?? 'auto';
    const resolvedStyleId = String(styleId ?? spec?.styleId ?? '');

    if (
      this.cachedLayout !== null &&
      this.cachedLyrics === lyrics &&
      this.cachedWidth === safeW &&
      this.cachedHeight === safeH &&
      this.cachedFontFamily === effectiveFontFamily &&
      this.cachedFontSizeScale === safeScale &&
      this.cachedBaseFontPx === safeBase &&
      this.cachedWeight === weight &&
      this.cachedMultiplier === multiplier &&
      this.cachedTransform === textTransform &&
      this.cachedLetterSpacing === letterSpacing &&
      this.cachedMaxWidthRatio === maxLineWidthRatio &&
      this.cachedScriptMode === resolvedScriptMode &&
      this.cachedStyleId === resolvedStyleId
    ) {
      return this.cachedLayout;
    }

    this.measureCalls++;
    const responsiveBase = Math.max(20, Math.min(safeBase, safeW * 0.052)) * multiplier;
    let fontSizePx = Math.max(MIN_FONT_SIZE_PX, Math.round(responsiveBase * safeScale));
    const maxLineWidth = Math.max(100, Math.min(Math.max(100, safeW - 24), safeW * maxLineWidthRatio));

    const ctxMutable = ctx as unknown as { letterSpacing?: string };
    const prevLetterSpacing = ctxMutable.letterSpacing;
    ctx.save();
    if ('letterSpacing' in ctxMutable || letterSpacing !== '0px') {
      ctxMutable.letterSpacing = letterSpacing;
    }

    const runLayoutPass = (
      currentFontPx: number
    ): {
      lines: MeasuredLineLayout[];
      totalHeight: number;
      lineHeightPx: number;
      maxSingleWordWidth: number;
    } => {
      ctx.font = `${weight} ${currentFontPx}px ${effectiveFontFamily}`;
      const rawSpaceWidth = ctx.measureText(' ').width;
      const spaceWidth = Math.max(
        Number.isFinite(rawSpaceWidth) ? rawSpaceWidth : 0,
        currentFontPx * 0.28
      );
      const lineHeightPx = Math.round(currentFontPx * LINE_GAP_MULTIPLIER);
      const blockGapPx = Math.round(currentFontPx * BLOCK_SPACING_MULTIPLIER);

      const measuredLines: MeasuredLineLayout[] = [];
      let cursorY = 0;
      let maxSingleWordWidth = 0;

      for (let li = 0; li < lyrics.lines.length; li++) {
        const line = lyrics.lines[li];
        const resolved = resolveDisplayLine(line, resolvedScriptMode, resolvedStyleId);
        let sourceWords: readonly LyricWord[];
        if (resolved.primaryWords && resolved.primaryWords.length > 0) {
          // If a single unspaced CJK token overflows maxLineWidth, segment it cleanly for wrapping
          const expanded: LyricWord[] = [];
          let didExpand = false;
          for (let wi = 0; wi < resolved.primaryWords.length; wi++) {
            const w = resolved.primaryWords[wi];
            if (CJK_UNSPACED_REGEX.test(w.text) && w.text.length > 2) {
              const rawW = ctx.measureText(w.text).width;
              const estW = Number.isFinite(rawW) && rawW > 0 ? rawW : w.text.length * currentFontPx;
              if (estW > maxLineWidth * 0.92) {
                const segs = segmentTextForWrapping(w.text);
                if (segs.length > 1) {
                  didExpand = true;
                  const span = Math.max(0.02, w.endSeconds - w.startSeconds);
                  let cur = w.startSeconds;
                  for (let si = 0; si < segs.length; si++) {
                    const segDur = (span * segs[si].length) / w.text.length;
                    const segEnd = si === segs.length - 1 ? w.endSeconds : Math.min(w.endSeconds, cur + segDur);
                    expanded.push({ text: segs[si], startSeconds: cur, endSeconds: Math.max(cur + 0.005, segEnd) });
                    cur = segEnd;
                  }
                  continue;
                }
              }
            }
            expanded.push(w);
          }
          sourceWords = didExpand ? expanded : resolved.primaryWords;
        } else {
          sourceWords = segmentTextForWrapping(resolved.primaryText).map((w) => ({
            text: w,
            startSeconds: line.startSeconds,
            endSeconds: line.endSeconds,
          }));
        }

        const measuredWords: MeasuredWordLayout[] = [];
        let rowX = 0;
        let rowY = 0;
        let widestRow = 0;
        let lastGap = 0;

        for (let wi = 0; wi < sourceWords.length; wi++) {
          const word = sourceWords[wi];
          const trimmed = word.text.trim();
          const tokenText = applyTextTransform(trimmed || word.text, textTransform);
          const rawWidth = ctx.measureText(tokenText).width;
          const wordWidth =
            Number.isFinite(rawWidth) && rawWidth > 0
              ? rawWidth
              : tokenText.length * currentFontPx * 0.56;

          if (wordWidth > maxSingleWordWidth) {
            maxSingleWordWidth = wordWidth;
          }

          if (rowX > 0 && rowX + wordWidth > maxLineWidth) {
            widestRow = Math.max(widestRow, rowX - lastGap);
            rowX = 0;
            lastGap = 0;
            rowY += lineHeightPx;
          }

          measuredWords.push({
            text: tokenText,
            startSeconds: word.startSeconds,
            endSeconds: word.endSeconds,
            x: rowX,
            y: rowY,
            width: wordWidth,
            height: lineHeightPx,
            lineIndex: li,
            wordIndex: wi,
          });

          const joinGap =
            wi + 1 < sourceWords.length &&
            CJK_UNSPACED_REGEX.test(tokenText) &&
            CJK_UNSPACED_REGEX.test(sourceWords[wi + 1].text)
              ? 0
              : spaceWidth;
          rowX += wordWidth + joinGap;
          lastGap = joinGap;
        }

        if (rowX > 0) {
          widestRow = Math.max(widestRow, rowX - lastGap);
        }

        const lineBlockHeight = rowY + lineHeightPx;
        measuredLines.push({
          lineIndex: li,
          text: applyTextTransform(resolved.primaryText, textTransform),
          startSeconds: line.startSeconds,
          endSeconds: line.endSeconds,
          x: Math.max(12, (safeW - widestRow) * 0.5),
          y: cursorY,
          width: widestRow,
          height: lineBlockHeight,
          words: measuredWords,
          ...(resolved.secondaryText !== null ? { secondaryText: resolved.secondaryText } : {}),
          ...(resolved.isRomanized ? { isRomanized: true } : {}),
        });

        cursorY += lineBlockHeight + blockGapPx;
      }

      return {
        lines: measuredLines,
        totalHeight: Math.max(0, cursorY - blockGapPx),
        lineHeightPx,
        maxSingleWordWidth,
      };
    };

    let pass = runLayoutPass(fontSizePx);
    let safety = 0;
    while (pass.maxSingleWordWidth > maxLineWidth && fontSizePx > MIN_FONT_SIZE_PX && safety < 6) {
      const ratio = Math.max(0.35, Math.min(0.92, maxLineWidth / pass.maxSingleWordWidth));
      const nextFontPx = Math.max(MIN_FONT_SIZE_PX, Math.floor(fontSizePx * ratio));
      fontSizePx = nextFontPx < fontSizePx ? nextFontPx : Math.max(MIN_FONT_SIZE_PX, fontSizePx - 2);
      pass = runLayoutPass(fontSizePx);
      safety++;
    }

    if (prevLetterSpacing !== undefined) {
      ctxMutable.letterSpacing = prevLetterSpacing;
    } else if ('letterSpacing' in ctxMutable) {
      ctxMutable.letterSpacing = '0px';
    }
    ctx.restore();

    const layout: LyricsLayout = {
      width: safeW,
      height: safeH,
      fontFamily: effectiveFontFamily,
      fontSizePx,
      lineHeightPx: pass.lineHeightPx,
      totalHeight: pass.totalHeight,
      lines: pass.lines,
    };

    this.cachedLyrics = lyrics;
    this.cachedWidth = safeW;
    this.cachedHeight = safeH;
    this.cachedFontFamily = effectiveFontFamily;
    this.cachedFontSizeScale = safeScale;
    this.cachedBaseFontPx = safeBase;
    this.cachedWeight = weight;
    this.cachedMultiplier = multiplier;
    this.cachedTransform = textTransform;
    this.cachedLetterSpacing = letterSpacing;
    this.cachedMaxWidthRatio = maxLineWidthRatio;
    this.cachedScriptMode = resolvedScriptMode;
    this.cachedStyleId = resolvedStyleId;
    this.cachedLayout = layout;
    return layout;
  }
}
