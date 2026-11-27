// Style: SolariSplitFlap ("Airport Split-Flap Board")
// Mechanical Solari departure board lyric visualizer with pre-allocated fixed flap cell grid,
// cosine hinged top-half-to-bottom-half flip animation, mid-tile hinge seam, specular shadow sweep,
// departure header strip (FLIGHT / TRACK, GATE / BPM, STATUS: BOARDING / ON TIME),
// and inline wordIconDictionary icon flaps.
// Strict 60fps with ZERO per-frame heap allocations inside render().

import type { Lyrics, LyricsScriptMode, StyleFrameContext } from '../../core/models';
import { isBlankOrInstrumentalLineText } from '../../core/lrcParser';
import {
  clamp01,
  drawBackdropVignette,
  drawEmptyState,
  drawInstrumentalIndicator,
  drawRoundedRectPath,
  getFocalRect,
  isTransparentStage,
  isUnsyncedLyrics,
  resolveDisplayLine,
  type ILyricVisualStyle,
  type StyleMeasurementSpec,
} from '../styleInterface';
import { detectMagicWordEffect } from '../lyricSemantics';
import {
  drawSemanticWordMicroFx,
  drawWordIcon,
  resolveWordIcon,
  type WordIconId,
} from '../wordIconDictionary';
import { parseColorToRgbInto } from '../webGlEffectLayer';

const GRID_ROWS = 4;
const GRID_COLS = 26;
const TOTAL_CELLS = GRID_ROWS * GRID_COLS;
const FLAP_FLIP_DURATION_SEC = 0.22;
const STAGGER_PER_COL_SEC = 0.011;
const FLAP_FONT_STACK = '"JetBrains Mono", "Space Grotesk", ui-monospace, monospace';

// Pre-allocated single-character strings for common ASCII flap characters (zero GC)
const ASCII_CHAR_TABLE: readonly string[] = Array.from({ length: 128 }, (_, i) =>
  i >= 32 && i < 127 ? String.fromCharCode(i) : ' '
);

function internUpperChar(ch: string): string {
  if (!ch) return ' ';
  const upper = ch.toUpperCase();
  const code = upper.charCodeAt(0);
  if (code >= 32 && code < 127) {
    return ASCII_CHAR_TABLE[code];
  }
  return upper;
}

interface PrecomputedFlapWord {
  readonly chars: readonly string[];
  readonly wordIndex: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly iconId: WordIconId | null;
}

interface PrecomputedFlapLine {
  readonly lineIndex: number;
  readonly words: readonly PrecomputedFlapWord[];
}

export interface FlapCell {
  currentChar: string;
  targetChar: string;
  flipProgress: number;
  staggerRemaining: number;
  activeWord: boolean;
  passedWord: boolean;
  accented: boolean;
  iconId: WordIconId | null;
  currentIconId: WordIconId | null;
}

export class SolariSplitFlapStyle implements ILyricVisualStyle {
  readonly id = 'SolariSplitFlap' as const;
  readonly name = 'Airport Split-Flap Board';
  readonly webGlEffect = 'none' as const;

  private readonly cells: FlapCell[];
  private readonly rowLineIndices: Int32Array;
  private readonly rowIsActive: Uint8Array;
  private readonly rowTargetChars: string[];
  private readonly rowTargetActiveWord: Uint8Array;
  private readonly rowTargetPassedWord: Uint8Array;
  private readonly rowTargetIcons: (WordIconId | null)[];

  private cachedLyricsRef: Lyrics | null = null;
  private cachedScriptMode: LyricsScriptMode | null = null;
  private lines: PrecomputedFlapLine[] = [];
  private lineToIdx: number[] = [];

  private lastKnownActiveIdx = -1;
  private lastAnchorLineIdx = -1;
  private beatPulse = 0;
  private readonly tmpRgbA = new Float32Array(3);

  // Cached header labels so render() never builds strings unless metadata/BPM changes
  private lastTrackKey = '';
  private headerFlightLabel = 'FLT WF-01 // STANDBY';
  private lastBpmInt = -1;
  private headerGateLabel = 'GATE A01 // 120 BPM';

  constructor() {
    this.cells = new Array<FlapCell>(TOTAL_CELLS);
    for (let i = 0; i < TOTAL_CELLS; i++) {
      this.cells[i] = {
        currentChar: ' ',
        targetChar: ' ',
        flipProgress: 1,
        staggerRemaining: 0,
        activeWord: false,
        passedWord: false,
        accented: false,
        iconId: null,
        currentIconId: null,
      };
    }
    this.rowLineIndices = new Int32Array(GRID_ROWS);
    this.rowLineIndices.fill(-1);
    this.rowIsActive = new Uint8Array(GRID_ROWS);
    this.rowTargetChars = new Array<string>(GRID_COLS).fill(' ');
    this.rowTargetActiveWord = new Uint8Array(GRID_COLS);
    this.rowTargetPassedWord = new Uint8Array(GRID_COLS);
    this.rowTargetIcons = new Array<WordIconId | null>(GRID_COLS).fill(null);
  }

  getVariationIndex(variationId?: string): 0 | 1 {
    return variationId === 'amber-terminal' ? 1 : 0;
  }

  getMeasurementSpec(frame?: StyleFrameContext): StyleMeasurementSpec {
    return {
      fontWeight: 700,
      fontSizeMultiplier: 0.96,
      textTransform: 'uppercase',
      maxLineWidthRatio: 0.86,
      scriptMode: frame?.scriptMode ?? 'auto',
      styleId: this.id,
    };
  }

  reset(): void {
    this.cachedLyricsRef = null;
    this.cachedScriptMode = null;
    this.lines = [];
    this.lineToIdx = [];
    this.lastKnownActiveIdx = -1;
    this.lastAnchorLineIdx = -1;
    this.beatPulse = 0;
    this.rowLineIndices.fill(-1);
    this.rowIsActive.fill(0);
    for (let i = 0; i < TOTAL_CELLS; i++) {
      const c = this.cells[i];
      c.currentChar = ' ';
      c.targetChar = ' ';
      c.flipProgress = 1;
      c.staggerRemaining = 0;
      c.activeWord = false;
      c.passedWord = false;
      c.accented = false;
      c.iconId = null;
      c.currentIconId = null;
    }
  }

  dispose(): void {
    this.reset();
  }

  private ensurePrecomputed(lyrics: Lyrics, scriptMode: LyricsScriptMode): void {
    if (this.cachedLyricsRef === lyrics && this.cachedScriptMode === scriptMode) return;
    this.cachedLyricsRef = lyrics;
    this.cachedScriptMode = scriptMode;
    this.lines = [];
    this.lineToIdx = new Array<number>(lyrics.lines.length).fill(-1);

    for (let i = 0; i < lyrics.lines.length; i++) {
      const line = lyrics.lines[i];
      if (isBlankOrInstrumentalLineText(line.text)) continue;

      const resolved = resolveDisplayLine(line, scriptMode, this.id);
      const sourceWords =
        resolved.primaryWords && resolved.primaryWords.length > 0
          ? resolved.primaryWords
          : resolved.primaryText
              .split(/\s+/)
              .filter(Boolean)
              .map((t, wi, arr) => ({
                text: t,
                startSeconds:
                  line.startSeconds + ((line.endSeconds - line.startSeconds) * wi) / Math.max(1, arr.length),
                endSeconds:
                  line.startSeconds + ((line.endSeconds - line.startSeconds) * (wi + 1)) / Math.max(1, arr.length),
              }));

      const packed: PrecomputedFlapWord[] = [];
      for (let w = 0; w < sourceWords.length; w++) {
        const wd = sourceWords[w];
        const cleanText = wd.text.trim();
        if (!cleanText) continue;
        const chars: string[] = [];
        for (let ci = 0; ci < cleanText.length; ci++) {
          chars.push(internUpperChar(cleanText[ci]));
        }
        packed.push({
          chars,
          wordIndex: w,
          startSeconds: wd.startSeconds,
          endSeconds: wd.endSeconds,
          iconId: resolveWordIcon(cleanText, resolved.primaryText),
        });
      }

      if (packed.length > 0) {
        this.lineToIdx[i] = this.lines.length;
        this.lines.push({
          lineIndex: i,
          words: packed,
        });
      }
    }
  }

  private refreshHeaderStrings(frame: StyleFrameContext): void {
    const title = frame.trackMetadata?.title ?? '';
    const artist = frame.trackMetadata?.artist ?? '';
    const trackKey = `${title}|${artist}`;
    if (trackKey !== this.lastTrackKey) {
      this.lastTrackKey = trackKey;
      if (title) {
        const upperTitle = title.toUpperCase().slice(0, 22);
        const upperArtist = artist ? ` · ${artist.toUpperCase().slice(0, 14)}` : '';
        this.headerFlightLabel = `FLT ${upperTitle}${upperArtist}`;
      } else {
        this.headerFlightLabel = 'FLT WF-01 // DEPARTURES';
      }
    }

    const rawBpm = frame.audio?.estimatedBpm ?? frame.trackMetadata?.bpm ?? 120;
    const roundedBpm = Math.max(40, Math.min(240, Math.round(Number.isFinite(rawBpm) ? rawBpm : 120)));
    if (roundedBpm !== this.lastBpmInt) {
      this.lastBpmInt = roundedBpm;
      this.headerGateLabel = `GATE A04 · ${roundedBpm} BPM`;
    }
  }

  private fillRowTargets(
    lineObj: PrecomputedFlapLine | null,
    isActiveRow: boolean,
    isPassedRow: boolean,
    activeWordIndex: number,
    unsyncedOrLineLevel: boolean,
    wordIconsEnabled: boolean,
    visibleCols: number
  ): void {
    for (let c = 0; c < GRID_COLS; c++) {
      this.rowTargetChars[c] = ' ';
      this.rowTargetActiveWord[c] = 0;
      this.rowTargetPassedWord[c] = 0;
      this.rowTargetIcons[c] = null;
    }

    if (!lineObj || lineObj.words.length === 0) return;

    // Calculate total character budget to center the line inside visibleCols
    let totalLen = 0;
    let firstVisibleWord = 0;

    // If line is longer than visibleCols, keep a sliding window around activeWordIndex on active row
    if (isActiveRow && !unsyncedOrLineLevel && activeWordIndex > 0) {
      let fullLen = 0;
      for (let w = 0; w < lineObj.words.length; w++) {
        const wd = lineObj.words[w];
        const iconSpan = wordIconsEnabled && wd.iconId ? 2 : 0;
        fullLen += wd.chars.length + iconSpan + (w > 0 ? 1 : 0);
      }
      if (fullLen > visibleCols) {
        // Walk backwards from activeWordIndex so active word stays cleanly inside the board
        let accum = 0;
        firstVisibleWord = Math.min(activeWordIndex, lineObj.words.length - 1);
        for (let w = firstVisibleWord; w >= 0; w--) {
          const wd = lineObj.words[w];
          const span = wd.chars.length + (wordIconsEnabled && wd.iconId ? 2 : 0) + (w < firstVisibleWord ? 1 : 0);
          if (accum + span > visibleCols && w < firstVisibleWord) break;
          accum += span;
          firstVisibleWord = w;
        }
      }
    }

    for (let w = firstVisibleWord; w < lineObj.words.length; w++) {
      const wd = lineObj.words[w];
      const iconSpan = wordIconsEnabled && wd.iconId ? 2 : 0;
      const addLen = wd.chars.length + iconSpan + (w > firstVisibleWord ? 1 : 0);
      if (totalLen + addLen > visibleCols) {
        if (w === firstVisibleWord) {
          totalLen = Math.min(visibleCols, wd.chars.length);
        }
        break;
      }
      totalLen += addLen;
    }

    let cursor = Math.max(0, Math.floor((visibleCols - totalLen) * 0.5));

    for (let w = firstVisibleWord; w < lineObj.words.length; w++) {
      const wd = lineObj.words[w];
      const isWordActive = isActiveRow && !unsyncedOrLineLevel && wd.wordIndex === activeWordIndex;
      const isWordPassed =
        isPassedRow || (isActiveRow && (unsyncedOrLineLevel || wd.wordIndex < activeWordIndex));

      if (w > firstVisibleWord) {
        if (cursor >= visibleCols) break;
        cursor += 1;
      }

      for (let ci = 0; ci < wd.chars.length; ci++) {
        if (cursor >= visibleCols) break;
        this.rowTargetChars[cursor] = wd.chars[ci];
        this.rowTargetActiveWord[cursor] = isWordActive ? 1 : 0;
        this.rowTargetPassedWord[cursor] = isWordPassed ? 1 : 0;
        cursor += 1;
      }

      if (wordIconsEnabled && wd.iconId && cursor + 1 < visibleCols) {
        cursor += 1; // 1 space before icon flap
        this.rowTargetChars[cursor] = ' ';
        this.rowTargetIcons[cursor] = wd.iconId;
        this.rowTargetActiveWord[cursor] = isWordActive ? 1 : 0;
        this.rowTargetPassedWord[cursor] = isWordPassed ? 1 : 0;
        cursor += 1;
      }
    }
  }

  private fillStatusRowTargets(label: string, visibleCols: number): void {
    for (let c = 0; c < GRID_COLS; c++) {
      this.rowTargetChars[c] = ' ';
      this.rowTargetActiveWord[c] = 0;
      this.rowTargetPassedWord[c] = 0;
      this.rowTargetIcons[c] = null;
    }
    const len = Math.min(label.length, visibleCols);
    const startCol = Math.max(0, Math.floor((visibleCols - len) * 0.5));
    for (let i = 0; i < len; i++) {
      this.rowTargetChars[startCol + i] = internUpperChar(label[i]);
      this.rowTargetActiveWord[startCol + i] = 1;
    }
  }

  private applyRowTargetsAndAdvance(
    row: number,
    visibleCols: number,
    dt: number,
    snapImmediate: boolean
  ): void {
    const base = row * GRID_COLS;
    for (let col = 0; col < GRID_COLS; col++) {
      const cell = this.cells[base + col];
      const nextChar = col < visibleCols ? this.rowTargetChars[col] : ' ';
      const nextIcon = col < visibleCols ? this.rowTargetIcons[col] : null;
      const nextActive = col < visibleCols && this.rowTargetActiveWord[col] === 1;
      const nextPassed = col < visibleCols && this.rowTargetPassedWord[col] === 1;

      cell.activeWord = nextActive;
      cell.passedWord = nextPassed;
      cell.accented = nextActive;

      if (cell.targetChar !== nextChar || cell.iconId !== nextIcon) {
        if (snapImmediate) {
          cell.currentChar = nextChar;
          cell.targetChar = nextChar;
          cell.currentIconId = nextIcon;
          cell.iconId = nextIcon;
          cell.flipProgress = 1;
          cell.staggerRemaining = 0;
        } else {
          // Commit half-finished previous char so fast updates don't stutter backwards
          if (cell.flipProgress >= 0.5) {
            cell.currentChar = cell.targetChar;
            cell.currentIconId = cell.iconId;
          }
          cell.targetChar = nextChar;
          cell.iconId = nextIcon;
          cell.flipProgress = 0;
          cell.staggerRemaining = col * STAGGER_PER_COL_SEC;
        }
      }

      if (cell.flipProgress < 1) {
        if (snapImmediate) {
          cell.currentChar = cell.targetChar;
          cell.currentIconId = cell.iconId;
          cell.flipProgress = 1;
          cell.staggerRemaining = 0;
        } else if (cell.staggerRemaining > 0) {
          cell.staggerRemaining = Math.max(0, cell.staggerRemaining - dt);
        } else {
          cell.flipProgress = Math.min(1, cell.flipProgress + dt / FLAP_FLIP_DURATION_SEC);
          if (cell.flipProgress >= 1) {
            cell.currentChar = cell.targetChar;
            cell.currentIconId = cell.iconId;
          }
        }
      }
    }
  }

  private drawFlapCell(
    ctx: CanvasRenderingContext2D,
    cell: FlapCell,
    x: number,
    y: number,
    w: number,
    h: number,
    isAmber: boolean,
    accentPrimary: string,
    accentSecondary: string,
    fontPx: number,
    reduceMotion: boolean
  ): void {
    const midY = y + h * 0.5;
    const radius = Math.max(2.5, Math.min(5, w * 0.14));

    const tileTopBg = isAmber ? '#21180e' : '#181c26';
    const tileBottomBg = isAmber ? '#181109' : '#11141d';
    const tileBorder = cell.activeWord
      ? accentPrimary
      : isAmber
      ? 'rgba(245, 158, 11, 0.28)'
      : 'rgba(255, 255, 255, 0.12)';

    const settledTextColor = cell.activeWord
      ? isAmber
        ? '#fef08a'
        : '#ffffff'
      : cell.passedWord
      ? isAmber
        ? '#f59e0b'
        : '#cbd5e1'
      : isAmber
      ? 'rgba(245, 158, 11, 0.58)'
      : 'rgba(186, 198, 218, 0.52)';

    // Outer recessed mechanical slot shadow
    drawRoundedRectPath(ctx, x, y, w, h, radius);
    ctx.fillStyle = '#050609';
    ctx.fill();

    // Active word backplate glow
    if (cell.activeWord && (cell.targetChar !== ' ' || cell.iconId !== null)) {
      ctx.save();
      ctx.globalAlpha = 0.26;
      ctx.fillStyle = accentPrimary;
      drawRoundedRectPath(ctx, x - 1, y - 1, w + 2, h + 2, radius + 1);
      ctx.fill();
      ctx.restore();
    }

    const p = reduceMotion ? 1 : clamp01(cell.flipProgress);
    const isFlipping = p > 0 && p < 1;

    // 1. Static Top Half (displays targetChar / target icon)
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h * 0.5);
    ctx.clip();
    drawRoundedRectPath(ctx, x, y, w, h, radius);
    ctx.fillStyle = tileTopBg;
    ctx.fill();
    this.drawCellGlyph(
      ctx,
      isFlipping ? cell.targetChar : cell.currentChar,
      isFlipping ? cell.iconId : cell.currentIconId,
      x + w * 0.5,
      midY,
      w,
      h,
      fontPx,
      settledTextColor,
      accentSecondary
    );
    ctx.restore();

    // 2. Static Bottom Half (displays currentChar / current icon while top falls; target once settled)
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, midY, w, h * 0.5);
    ctx.clip();
    drawRoundedRectPath(ctx, x, y, w, h, radius);
    ctx.fillStyle = tileBottomBg;
    ctx.fill();
    this.drawCellGlyph(
      ctx,
      p >= 1 ? cell.targetChar : cell.currentChar,
      p >= 1 ? cell.iconId : cell.currentIconId,
      x + w * 0.5,
      midY,
      w,
      h,
      fontPx,
      settledTextColor,
      accentSecondary
    );
    ctx.restore();

    // 3. Hinged Top-to-Bottom Cosine Flip Flap + Specular Shadow Sweep
    if (isFlipping) {
      if (p < 0.5) {
        // Top half folding down toward hinge
        const cosScale = Math.max(0.02, Math.cos(p * Math.PI));
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h * 0.5);
        ctx.clip();
        ctx.translate(x + w * 0.5, midY);
        ctx.scale(1, cosScale);
        ctx.translate(-(x + w * 0.5), -midY);

        drawRoundedRectPath(ctx, x, y, w, h, radius);
        ctx.fillStyle = tileTopBg;
        ctx.fill();

        this.drawCellGlyph(
          ctx,
          cell.currentChar,
          cell.currentIconId,
          x + w * 0.5,
          midY,
          w,
          h,
          fontPx,
          settledTextColor,
          accentSecondary
        );

        // Darkening tilt shadow as flap faces downward
        ctx.fillStyle = '#000000';
        ctx.globalAlpha = clamp01(p * 1.15);
        ctx.fillRect(x, y, w, h * 0.5);
        ctx.restore();
      } else {
        // Bottom half unfolding downward from hinge
        const cosScale = Math.max(0.02, Math.cos((1 - p) * Math.PI));
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, midY, w, h * 0.5);
        ctx.clip();
        ctx.translate(x + w * 0.5, midY);
        ctx.scale(1, cosScale);
        ctx.translate(-(x + w * 0.5), -midY);

        drawRoundedRectPath(ctx, x, y, w, h, radius);
        ctx.fillStyle = tileBottomBg;
        ctx.fill();

        this.drawCellGlyph(
          ctx,
          cell.targetChar,
          cell.iconId,
          x + w * 0.5,
          midY,
          w,
          h,
          fontPx,
          settledTextColor,
          accentSecondary
        );

        // Specular shadow sweep across unfolding flap
        const sweepAlpha = Math.sin(p * Math.PI) * 0.38;
        ctx.fillStyle = isAmber ? '#fde68a' : '#ffffff';
        ctx.globalAlpha = sweepAlpha;
        ctx.fillRect(x, midY, w, h * 0.5);
        ctx.restore();
      }
    }

    // 4. Outer tile border + mid-tile mechanical hinge seam + side hinge pins
    ctx.save();
    drawRoundedRectPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, radius);
    ctx.strokeStyle = tileBorder;
    ctx.lineWidth = cell.activeWord ? 1.25 : 0.8;
    ctx.stroke();

    // Mid-tile dark hinge gap
    ctx.fillStyle = '#030407';
    ctx.fillRect(x + 1, midY - 0.85, w - 2, 1.7);

    // Subtle hinge pins on left and right seam edges
    ctx.fillStyle = isAmber ? 'rgba(245, 158, 11, 0.45)' : 'rgba(255, 255, 255, 0.25)';
    ctx.fillRect(x + 1, midY - 1.4, 2, 2.8);
    ctx.fillRect(x + w - 3, midY - 1.4, 2, 2.8);
    ctx.restore();
  }

  private drawCellGlyph(
    ctx: CanvasRenderingContext2D,
    char: string,
    iconId: WordIconId | null,
    cx: number,
    cy: number,
    tileW: number,
    tileH: number,
    fontPx: number,
    textColor: string,
    accentSecondary: string
  ): void {
    if (iconId) {
      const iconSize = Math.min(tileW * 0.68, tileH * 0.54);
      drawWordIcon(ctx, iconId, cx, cy, iconSize, accentSecondary || textColor, 1.0);
      return;
    }
    if (char === ' ') return;
    ctx.font = `700 ${fontPx}px ${FLAP_FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = textColor;
    ctx.fillText(char, cx, cy + 1);
  }

  render(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    width: number,
    height: number
  ): void {
    const focal = getFocalRect(frame, width);
    const isTransparent = isTransparentStage(frame);
    const varIdx = this.getVariationIndex(frame.variationId);
    const isAmber = varIdx === 1;

    const bgAlpha =
      typeof frame.backgroundOpacity === 'number' && Number.isFinite(frame.backgroundOpacity)
        ? clamp01(frame.backgroundOpacity)
        : 0.95;
    const vigStrength =
      typeof frame.vignetteStrength === 'number' && Number.isFinite(frame.vignetteStrength)
        ? clamp01(frame.vignetteStrength)
        : 0.55;

    const dt = Math.max(0.001, Math.min(0.1, frame.deltaSeconds || 1 / 60));
    if (frame.reduceMotion) {
      this.beatPulse = 0;
    } else if (frame.audio?.isDownbeat) {
      this.beatPulse = 1;
    } else if (frame.audio?.beatDetected) {
      this.beatPulse = Math.max(this.beatPulse, 0.72);
    } else {
      this.beatPulse *= Math.exp(-dt * 7.5);
    }

    const hasAlbumPalette = !frame.palette.isFallback;
    const accentPrimary =
      hasAlbumPalette && frame.palette.accentPrimary
        ? frame.palette.accentPrimary
        : isAmber
        ? '#f59e0b'
        : '#22d3ee';
    const accentSecondary =
      hasAlbumPalette && frame.palette.accentSecondary
        ? frame.palette.accentSecondary
        : isAmber
        ? '#fde047'
        : '#34d399';
    parseColorToRgbInto(accentPrimary, this.tmpRgbA);
    const sheenR = Math.round(this.tmpRgbA[0] * 255);
    const sheenG = Math.round(this.tmpRgbA[1] * 255);
    const sheenB = Math.round(this.tmpRgbA[2] * 255);

    // 1. Backdrop
    if (!isTransparent) {
      ctx.save();
      ctx.globalAlpha = bgAlpha;
      ctx.fillStyle =
        hasAlbumPalette && !isAmber && frame.palette.bgDeep
          ? frame.palette.bgDeep
          : isAmber
          ? '#0b0805'
          : '#06070b';
      ctx.fillRect(0, 0, width, height);

      // Subtle mechanical chassis radial sheen tinted to active album palette
      const rad = ctx.createRadialGradient(
        focal.centerX,
        height * 0.45,
        20,
        focal.centerX,
        height * 0.5,
        Math.max(focal.width, height) * 0.72
      );
      rad.addColorStop(0, `rgba(${sheenR}, ${sheenG}, ${sheenB}, ${hasAlbumPalette ? 0.14 : 0.09})`);
      rad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = rad;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();

      if (vigStrength > 0.01) {
        drawBackdropVignette(ctx, width, height, vigStrength, '#020306');
      }
    }

    this.refreshHeaderStrings(frame);

    const lyrics = frame.lyrics;
    if (!lyrics || lyrics.lines.length === 0) {
      drawEmptyState(ctx, frame, width, height, 'NO DEPARTURE LYRICS LOADED');
      return;
    }

    this.ensurePrecomputed(lyrics, frame.scriptMode ?? 'auto');
    if (this.lines.length === 0) {
      if (frame.isInstrumentalGap) {
        drawInstrumentalIndicator(ctx, frame, width, height, accentPrimary, 'INSTRUMENTAL STANDBY');
      } else {
        drawEmptyState(ctx, frame, width, height, 'WAITING FOR BOARD DATA');
      }
      return;
    }

    // 2. Compute responsive Solari board geometry strictly inside getFocalRect
    const boardMarginX = Math.max(18, Math.round(focal.width * 0.05));
    const boardW = Math.min(980, Math.max(240, focal.width - boardMarginX * 2));
    const boardX = focal.centerX - boardW * 0.5;
    const headerH = Math.max(44, Math.min(60, Math.round(height * 0.095)));
    const boardPadX = Math.max(12, Math.round(boardW * 0.028));
    const boardPadY = Math.max(12, Math.round(height * 0.022));

    const innerW = boardW - boardPadX * 2;
    const minTileW = 16;
    const tileGap = Math.max(3, Math.round(boardW * 0.0048));
    const visibleCols = Math.max(
      12,
      Math.min(GRID_COLS, Math.floor((innerW + tileGap) / (minTileW + tileGap)))
    );
    const tileW = Math.max(14, Math.min(36, (innerW - tileGap * (visibleCols - 1)) / visibleCols));
    const fontScale =
      typeof frame.fontSizeScale === 'number' && Number.isFinite(frame.fontSizeScale)
        ? frame.fontSizeScale
        : 1.0;
    const tileH = Math.max(28, Math.min(68, Math.round(tileW * 1.48 * Math.min(1.22, Math.max(0.85, fontScale)))));
    const rowGap = Math.max(8, Math.round(tileH * 0.24));

    const gridW = visibleCols * tileW + (visibleCols - 1) * tileGap;
    const gridH = GRID_ROWS * tileH + (GRID_ROWS - 1) * rowGap;
    const boardH = headerH + boardPadY * 2 + gridH + 14;
    const boardY = Math.max(18, (height - boardH) * 0.5);
    const gridStartX = boardX + (boardW - gridW) * 0.5;
    const gridStartY = boardY + headerH + boardPadY;

    // 3. Draw outer Solari board chassis & departure header strip
    if (!isTransparent) {
      ctx.save();
      drawRoundedRectPath(ctx, boardX, boardY, boardW, boardH, 14);
      ctx.fillStyle = isAmber ? '#130e09' : '#0b0d13';
      ctx.fill();
      ctx.strokeStyle = isAmber ? 'rgba(245, 158, 11, 0.32)' : 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Header strip background
      drawRoundedRectPath(ctx, boardX + 6, boardY + 6, boardW - 12, headerH - 8, 9);
      ctx.fillStyle = isAmber ? '#1b140c' : '#12151f';
      ctx.fill();
      ctx.restore();
    }

    // Header telemetry columns: FLIGHT / TRACK | GATE / BPM | STATUS: BOARDING / ON TIME
    ctx.save();
    const headerCenterY = boardY + 6 + (headerH - 8) * 0.5;
    const headerFontPx = Math.max(9.5, Math.min(12.5, Math.round(boardW * 0.015)));
    ctx.font = `700 ${headerFontPx}px ${FLAP_FONT_STACK}`;
    ctx.textBaseline = 'middle';

    // Left: FLIGHT / TRACK
    ctx.textAlign = 'left';
    ctx.fillStyle = isAmber ? '#fbbf24' : '#f8fafc';
    ctx.fillText(this.headerFlightLabel, boardX + 18, headerCenterY);

    // Middle: GATE / BPM (only if board wide enough)
    if (boardW >= 460) {
      ctx.textAlign = 'center';
      ctx.fillStyle = isAmber ? 'rgba(251, 191, 36, 0.78)' : 'rgba(203, 213, 225, 0.78)';
      ctx.fillText(this.headerGateLabel, boardX + boardW * 0.54, headerCenterY);
    }

    // Right: STATUS: BOARDING / ON TIME pulsing green/amber on beats
    const isBoarding = !frame.isInstrumentalGap && frame.activeLineIndex >= 0;
    const statusText = isBoarding ? 'STATUS: BOARDING' : 'STATUS: ON TIME';
    const statusLedColor = isBoarding
      ? isAmber
        ? '#f59e0b'
        : '#22c55e'
      : '#f59e0b';
    const ledAlpha = frame.reduceMotion ? 0.85 : 0.45 + 0.55 * this.beatPulse;
    const statusX = boardX + boardW - 18;

    ctx.textAlign = 'right';
    ctx.fillStyle = statusLedColor;
    ctx.globalAlpha = 0.72 + 0.28 * ledAlpha;
    ctx.fillText(statusText, statusX - 14, headerCenterY);

    // Pulsing status LED beacon
    ctx.beginPath();
    ctx.arc(statusX - 4, headerCenterY, 4.2 + this.beatPulse * 1.4, 0, Math.PI * 2);
    ctx.fillStyle = statusLedColor;
    ctx.globalAlpha = ledAlpha;
    ctx.fill();
    ctx.restore();

    // 4. Resolve active line window + manualScrollY offset
    const rawActive = frame.activeLineIndex;
    const activeMapped =
      rawActive >= 0 && rawActive < this.lineToIdx.length ? this.lineToIdx[rawActive] : -1;
    if (activeMapped >= 0) {
      this.lastKnownActiveIdx = activeMapped;
    }

    const fallbackMapped =
      typeof frame.lastActiveLineIndex === 'number' &&
      frame.lastActiveLineIndex >= 0 &&
      frame.lastActiveLineIndex < this.lineToIdx.length &&
      this.lineToIdx[frame.lastActiveLineIndex] >= 0
        ? this.lineToIdx[frame.lastActiveLineIndex]
        : this.lastKnownActiveIdx >= 0
        ? this.lastKnownActiveIdx
        : 0;

    const baseMapped = activeMapped >= 0 ? activeMapped : fallbackMapped;
    const manualScroll =
      typeof frame.manualScrollY === 'number' && Number.isFinite(frame.manualScrollY)
        ? frame.manualScrollY
        : 0;
    const scrollLineDelta = Math.round(manualScroll / Math.max(24, tileH + rowGap));
    const centerMapped = Math.max(0, Math.min(this.lines.length - 1, baseMapped + scrollLineDelta));

    const snapImmediate =
      Boolean(frame.didSeekThisFrame) ||
      Boolean(frame.reduceMotion) ||
      this.lastAnchorLineIdx === -1;
    this.lastAnchorLineIdx = centerMapped;

    const unsyncedOrLineLevel = isUnsyncedLyrics(frame) || frame.activeWordIndex < 0;
    const wordIconsEnabled = frame.wordIconsEnabled !== false;

    // Row 1 is focal active line (row 0 = previous line, row 2 & 3 = upcoming lines)
    // During instrumental gap (when user isn't manually scrolling), show standby status on row 1
    const showGapBanner = Boolean(frame.isInstrumentalGap) && Math.abs(scrollLineDelta) === 0;

    for (let r = 0; r < GRID_ROWS; r++) {
      this.rowLineIndices[r] = -1;
      this.rowIsActive[r] = 0;

      if (showGapBanner) {
        if (r === 1) {
          this.fillStatusRowTargets('INSTRUMENTAL STANDBY', visibleCols);
          this.rowIsActive[r] = 1;
        } else if (r === 2 && typeof frame.timeUntilNextLine === 'number' && frame.timeUntilNextLine > 0 && frame.timeUntilNextLine < 99) {
          this.fillStatusRowTargets('STANDBY FOR NEXT LINE', visibleCols);
        } else {
          this.fillRowTargets(null, false, false, -1, false, false, visibleCols);
        }
        this.applyRowTargetsAndAdvance(r, visibleCols, dt, snapImmediate);
        continue;
      }

      const mappedIdx = centerMapped + (r - 1);
      const lineObj =
        mappedIdx >= 0 && mappedIdx < this.lines.length ? this.lines[mappedIdx] : null;
      const isRowActive =
        lineObj !== null && activeMapped >= 0 && mappedIdx === activeMapped;
      const isRowPassed =
        lineObj !== null && activeMapped >= 0 && mappedIdx < activeMapped;

      if (lineObj) {
        this.rowLineIndices[r] = lineObj.lineIndex;
      }
      this.rowIsActive[r] = isRowActive ? 1 : 0;

      this.fillRowTargets(
        lineObj,
        isRowActive,
        isRowPassed,
        frame.activeWordIndex,
        unsyncedOrLineLevel,
        wordIconsEnabled,
        visibleCols
      );
      this.applyRowTargetsAndAdvance(r, visibleCols, dt, snapImmediate);
    }

    // 5. Render the flap rows & record hit rects for click-to-seek
    const glyphFontPx = Math.max(12, Math.min(28, Math.round(tileH * 0.56)));
    for (let r = 0; r < GRID_ROWS; r++) {
      const rowY = gridStartY + r * (tileH + rowGap);
      const lineIdx = this.rowLineIndices[r];
      if (lineIdx >= 0) {
        frame.recordHitRect(lineIdx, gridStartX, rowY, gridW, tileH);
      }

      // Subtle active-row indicator bar on left chassis rail
      if (this.rowIsActive[r] === 1 && !isTransparent) {
        ctx.save();
        ctx.fillStyle = accentPrimary;
        ctx.globalAlpha = 0.78 + 0.22 * this.beatPulse;
        drawRoundedRectPath(ctx, boardX + 8, rowY + 4, 3.5, tileH - 8, 2);
        ctx.fill();
        ctx.restore();
      }

      const rowBase = r * GRID_COLS;
      let activeStartCol = -1;
      let activeEndCol = -1;
      for (let c = 0; c < visibleCols; c++) {
        const cell = this.cells[rowBase + c];
        if (this.rowIsActive[r] === 1 && cell.activeWord) {
          if (activeStartCol < 0) activeStartCol = c;
          activeEndCol = c;
        }
        const cellX = gridStartX + c * (tileW + tileGap);
        this.drawFlapCell(
          ctx,
          cell,
          cellX,
          rowY,
          tileW,
          tileH,
          isAmber,
          accentPrimary,
          accentSecondary,
          glyphFontPx,
          frame.reduceMotion
        );
      }

      if (
        this.rowIsActive[r] === 1 &&
        !unsyncedOrLineLevel &&
        !frame.reduceMotion &&
        activeStartCol >= 0 &&
        activeMapped >= 0
      ) {
        const activeLineObj = this.lines[activeMapped];
        const activeWord =
          activeLineObj &&
          frame.activeWordIndex >= 0 &&
          frame.activeWordIndex < activeLineObj.words.length
            ? activeLineObj.words[frame.activeWordIndex]
            : null;
        if (activeWord) {
          const magic = detectMagicWordEffect(activeWord.chars.join(''));
          if (magic) {
            const spanX = gridStartX + activeStartCol * (tileW + tileGap);
            const spanW =
              (activeEndCol - activeStartCol + 1) * tileW +
              Math.max(0, activeEndCol - activeStartCol) * tileGap;
            const motionScale =
              frame.motionIntensity === 'vivid'
                ? 1.25
                : frame.motionIntensity === 'subtle'
                ? 0.65
                : 1.0;
            drawSemanticWordMicroFx(
              ctx,
              magic,
              spanX,
              rowY,
              spanW,
              tileH,
              frame.timeSeconds,
              accentPrimary,
              accentSecondary,
              motionScale
            );
          }
        }
      }
    }
  }
}
