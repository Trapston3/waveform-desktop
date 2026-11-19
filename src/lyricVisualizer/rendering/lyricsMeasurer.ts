// Cached word-wrapping layout engine for Lyrics.
// Measures text only when lyrics reference, viewport dimensions, fontFamily, or fontSizePx change.

import type {
  Lyrics,
  LyricsLayout,
  MeasuredLineLayout,
  MeasuredWordLayout,
} from '../core/models';

const DEFAULT_BASE_FONT_PX = 38;
const LINE_GAP_MULTIPLIER = 1.48;
const BLOCK_SPACING_MULTIPLIER = 0.72;

export class LyricsMeasurer {
  private cachedLyrics: Lyrics | null = null;
  private cachedWidth = -1;
  private cachedHeight = -1;
  private cachedFontFamily = '';
  private cachedFontSizePx = -1;
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
    this.cachedFontSizePx = -1;
  }

  measure(
    ctx: CanvasRenderingContext2D,
    lyrics: Lyrics | null,
    viewportWidth: number,
    viewportHeight: number,
    fontFamily: string,
    fontSizeScale: number,
    baseFontSizePx = DEFAULT_BASE_FONT_PX
  ): LyricsLayout | null {
    if (!lyrics || lyrics.lines.length === 0) {
      this.cachedLyrics = lyrics;
      this.cachedLayout = null;
      return null;
    }

    const safeW = Math.max(120, Math.round(viewportWidth));
    const safeH = Math.max(80, Math.round(viewportHeight));
    const safeScale = Math.max(0.5, Math.min(2.5, Number.isFinite(fontSizeScale) ? fontSizeScale : 1));
    const responsiveBase = Math.max(20, Math.min(baseFontSizePx, safeW * 0.052));
    const fontSizePx = Math.max(14, Math.round(responsiveBase * safeScale));

    if (
      this.cachedLayout !== null &&
      this.cachedLyrics === lyrics &&
      this.cachedWidth === safeW &&
      this.cachedHeight === safeH &&
      this.cachedFontFamily === fontFamily &&
      this.cachedFontSizePx === fontSizePx
    ) {
      return this.cachedLayout;
    }

    this.measureCalls++;
    const maxLineWidth = Math.max(100, safeW * 0.82);
    const lineHeightPx = Math.round(fontSizePx * LINE_GAP_MULTIPLIER);
    const blockGapPx = Math.round(fontSizePx * BLOCK_SPACING_MULTIPLIER);

    ctx.save();
    ctx.font = `700 ${fontSizePx}px ${fontFamily}`;
    const spaceWidth = Math.max(fontSizePx * 0.28, ctx.measureText(' ').width || fontSizePx * 0.28);

    const measuredLines: MeasuredLineLayout[] = [];
    let cursorY = 0;

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
        const rawWidth = ctx.measureText(word.text).width;
        const wordWidth = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : word.text.length * fontSizePx * 0.56;

        if (rowX > 0 && rowX + wordWidth > maxLineWidth) {
          widestRow = Math.max(widestRow, rowX - spaceWidth);
          rowX = 0;
          rowY += lineHeightPx;
        }

        measuredWords.push({
          text: word.text,
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
        text: line.text,
        startSeconds: line.startSeconds,
        endSeconds: line.endSeconds,
        x: Math.max(0, (safeW - widestRow) * 0.5),
        y: cursorY,
        width: widestRow,
        height: lineBlockHeight,
        words: measuredWords,
      });

      cursorY += lineBlockHeight + blockGapPx;
    }

    ctx.restore();

    const layout: LyricsLayout = {
      width: safeW,
      height: safeH,
      fontFamily,
      fontSizePx,
      lineHeightPx,
      totalHeight: Math.max(0, cursorY - blockGapPx),
      lines: measuredLines,
    };

    this.cachedLyrics = lyrics;
    this.cachedWidth = safeW;
    this.cachedHeight = safeH;
    this.cachedFontFamily = fontFamily;
    this.cachedFontSizePx = fontSizePx;
    this.cachedLayout = layout;
    return layout;
  }
}
