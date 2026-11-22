// Cached word-wrapping layout engine for Lyrics.
// Measures text only when lyrics reference, viewport dimensions, typography, or StyleMeasurementSpec change.

import type {
  Lyrics,
  LyricsLayout,
  MeasuredLineLayout,
  MeasuredWordLayout,
} from '../core/models';
import type { StyleMeasurementSpec } from './styleInterface';

const DEFAULT_BASE_FONT_PX = 38;
const DEFAULT_MAX_LINE_WIDTH_RATIO = 0.85;
const LINE_GAP_MULTIPLIER = 1.48;
const BLOCK_SPACING_MULTIPLIER = 0.72;
const MIN_FONT_SIZE_PX = 14;

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
  }

  measure(
    ctx: CanvasRenderingContext2D,
    lyrics: Lyrics | null,
    viewportWidth: number,
    viewportHeight: number,
    fontFamily: string,
    fontSizeScale: number,
    baseFontSizePx = DEFAULT_BASE_FONT_PX,
    spec?: StyleMeasurementSpec
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
      this.cachedMaxWidthRatio === maxLineWidthRatio
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
        const sourceWords =
          line.words && line.words.length > 0
            ? line.words
            : line.text
                .trim()
                .split(/\s+/)
                .filter(Boolean)
                .map((w) => ({
                  text: w,
                  startSeconds: line.startSeconds,
                  endSeconds: line.endSeconds,
                }));

        const measuredWords: MeasuredWordLayout[] = [];
        let rowX = 0;
        let rowY = 0;
        let widestRow = 0;

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
            widestRow = Math.max(widestRow, rowX - spaceWidth);
            rowX = 0;
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

          rowX += wordWidth + spaceWidth;
        }

        if (rowX > 0) {
          widestRow = Math.max(widestRow, rowX - spaceWidth);
        }

        const lineBlockHeight = rowY + lineHeightPx;
        measuredLines.push({
          lineIndex: li,
          text: applyTextTransform(line.text, textTransform),
          startSeconds: line.startSeconds,
          endSeconds: line.endSeconds,
          x: Math.max(12, (safeW - widestRow) * 0.5),
          y: cursorY,
          width: widestRow,
          height: lineBlockHeight,
          words: measuredWords,
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
    this.cachedLayout = layout;
    return layout;
  }
}
