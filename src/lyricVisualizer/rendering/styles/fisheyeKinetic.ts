// Style: FisheyeKinetic ("Fisheye & Visual")
// Stacked 3-4 word kinetic typography with real radial barrel-lens fisheye warp,
// tilted solid accent inverse highlight bar, and inline monochrome vector icons.
// Strict 60fps with ZERO per-frame heap allocations inside render().

import type { Lyrics, LyricsScriptMode, StyleFrameContext } from '../../core/models';
import {
  clamp01,
  drawRoundedRectPath,
  easeOutBack,
  getFocalRect,
  isTransparentStage,
  isUnsyncedLyrics,
  resolveDisplayLine,
  type ILyricVisualStyle,
  type StyleMeasurementSpec,
} from '../styleInterface';
import { drawWordIcon, resolveWordIcon, type WordIconId } from '../wordIconDictionary';
import { isBlankOrInstrumentalLineText } from '../../core/lrcParser';

interface PrecomputedStackWord {
  readonly text: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly wordIndex: number;
  readonly iconId: WordIconId | null;
}

interface PrecomputedStackLine {
  readonly lineIndex: number;
  readonly words: readonly PrecomputedStackWord[];
}

function getContrastCutoutColor(hex: string): string {
  const clean = hex.replace('#', '');
  if (clean.length < 6) return '#ffffff';
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luma > 0.62 ? '#06070a' : '#ffffff';
}

export class FisheyeKineticStyle implements ILyricVisualStyle {
  readonly id = 'FisheyeKinetic' as const;
  readonly name = 'Fisheye & Visual';
  readonly webGlEffect = 'none' as const;

  private cachedLyricsRef: Lyrics | null = null;
  private cachedScriptMode: LyricsScriptMode | null = null;
  private lines: PrecomputedStackLine[] = [];
  private lineToIdx: number[] = [];

  getMeasurementSpec(frame: StyleFrameContext): StyleMeasurementSpec {
    return {
      fontWeight: 800,
      fontSizeMultiplier: 1.45,
      maxLineWidthRatio: 0.78,
      scriptMode: frame.scriptMode ?? 'auto',
      styleId: this.id,
    };
  }

  reset(): void {
    this.cachedLyricsRef = null;
    this.cachedScriptMode = null;
    this.lines = [];
    this.lineToIdx = [];
  }

  private ensurePrecomputed(lyrics: Lyrics, scriptMode: LyricsScriptMode): void {
    if (this.cachedLyricsRef === lyrics && this.cachedScriptMode === scriptMode) return;
    this.cachedLyricsRef = lyrics;
    this.cachedScriptMode = scriptMode;
    this.lines = [];
    this.lineToIdx = new Array(lyrics.lines.length).fill(-1);

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
                startSeconds: line.startSeconds + ((line.endSeconds - line.startSeconds) * wi) / arr.length,
                endSeconds: line.startSeconds + ((line.endSeconds - line.startSeconds) * (wi + 1)) / arr.length,
              }));

      const packed: PrecomputedStackWord[] = [];
      for (let w = 0; w < sourceWords.length; w++) {
        const wd = sourceWords[w];
        const cleanText = wd.text.trim();
        if (!cleanText) continue;
        packed.push({
          text: cleanText,
          startSeconds: wd.startSeconds,
          endSeconds: wd.endSeconds,
          wordIndex: w,
          iconId: resolveWordIcon(cleanText, resolved.primaryText),
        });
      }

      if (packed.length > 0) {
        this.lineToIdx[i] = this.lines.length;
        this.lines.push({ lineIndex: i, words: packed });
      }
    }
  }

  render(ctx: CanvasRenderingContext2D, frame: StyleFrameContext, width: number, height: number): void {
    const focal = getFocalRect(frame, width);
    const focalWidth = focal.width;
    const variation = frame.variationId || 'fisheye-visual';
    const useFisheye = variation !== 'visual-stack';
    const showIcons = variation !== 'fisheye';
    const motion = frame.reduceMotion ? 0 : frame.motionIntensity === 'vivid' ? 1.25 : frame.motionIntensity === 'subtle' ? 0.65 : 1.0;
    const isTransparent = isTransparentStage(frame);

    if (!isTransparent) {
      ctx.save();
      ctx.fillStyle = '#050608';
      ctx.fillRect(0, 0, width, height);

      const spot = ctx.createRadialGradient(
        focal.centerX,
        height * 0.5,
        24,
        focal.centerX,
        height * 0.5,
        Math.max(focalWidth, height) * 0.65
      );
      const glowPulse = (frame.audio.isDownbeat ? 0.16 : 0.08) + frame.audio.bassEnergy * 0.1;
      spot.addColorStop(0, frame.palette.accentPrimary);
      spot.addColorStop(1, 'rgba(5, 6, 8, 0)');
      ctx.globalAlpha = glowPulse * (typeof frame.backgroundOpacity === 'number' ? frame.backgroundOpacity : 0.95);
      ctx.fillStyle = spot;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    const lyrics = frame.lyrics;
    if (!lyrics || lyrics.lines.length === 0) return;

    this.ensurePrecomputed(lyrics, frame.scriptMode ?? 'auto');
    if (this.lines.length === 0) return;

    const cx = focal.centerX;
    const cy = height * 0.5;
    const scale = typeof frame.fontSizeScale === 'number' ? frame.fontSizeScale : 1.0;

    if (frame.isInstrumentalGap || frame.activeLineIndex < 0) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${Math.round(28 * scale)}px ${frame.fontFamily}`;
      ctx.fillStyle = frame.palette.accentPrimary;
      ctx.globalAlpha = 0.72 + 0.24 * Math.sin((frame.timeSeconds || 0) * 3.2);
      ctx.fillText('♪', cx, cy);
      ctx.restore();
      return;
    }

    const mappedIdx =
      frame.activeLineIndex < this.lineToIdx.length ? this.lineToIdx[frame.activeLineIndex] : -1;
    const lineObj = mappedIdx >= 0 ? this.lines[mappedIdx] : null;
    if (!lineObj || lineObj.words.length === 0) return;

    const unsyncedOrLine = isUnsyncedLyrics(frame) || frame.activeWordIndex < 0;
    const activeWIdx = unsyncedOrLine
      ? 0
      : Math.max(0, Math.min(lineObj.words.length - 1, frame.activeWordIndex));

    // Group words into windows of up to 4 so the stack remains tight and readable
    const windowSize = lineObj.words.length <= 4 ? lineObj.words.length : 4;
    const groupStart = Math.floor(activeWIdx / windowSize) * windowSize;
    const groupEnd = Math.min(lineObj.words.length, groupStart + windowSize);
    const count = groupEnd - groupStart;

    const baseFontPx = Math.max(30, Math.min(68, Math.round(focalWidth * 0.088 * scale)));
    const rowStep = baseFontPx * 1.32;
    const maxRadius = Math.max(rowStep * 1.8, 120);
    const downbeatPump =
      motion > 0 && frame.audio.isDownbeat
        ? 0.08 * motion
        : motion > 0 && frame.audio.beatDetected
        ? 0.04 * motion
        : 0;
    const accent = frame.palette.accentPrimary || '#FA2D48';
    const cutoutText = getContrastCutoutColor(accent);

    for (let idx = groupStart; idx < groupEnd; idx++) {
      const w = lineObj.words[idx];
      const rel = idx - groupStart - (count - 1) * 0.5;
      const linearY = cy + rel * rowStep;
      const dy = linearY - cy;
      const distNorm = Math.min(1.0, Math.abs(dy) / maxRadius);

      // Barrel-lens warp pushes outer rows slightly outward/Curved while swelling the center focal word
      const warpFactor = useFisheye ? 1.0 + 0.16 * (1.0 - distNorm * distNorm) : 1.0;
      const warpedY = cy + dy * warpFactor;
      const rowScale = useFisheye
        ? (1.16 - 0.34 * Math.pow(distNorm, 1.35)) * (1.0 + downbeatPump * (1 - distNorm))
        : 1.0 + downbeatPump * 0.5;

      const isActiveWord = !unsyncedOrLine && idx === activeWIdx;
      const isPassedWord = unsyncedOrLine || idx < activeWIdx;
      const wordFontPx = Math.round(baseFontPx * rowScale);

      ctx.save();
      ctx.font = `900 ${wordFontPx}px ${frame.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const textW = ctx.measureText(w.text).width;
      const hasIcon = showIcons && w.iconId !== null;
      const iconSize = Math.round(wordFontPx * 0.78);
      const iconGap = hasIcon ? Math.round(wordFontPx * 0.32) : 0;
      const totalGroupW = textW + (hasIcon ? iconGap + iconSize : 0);
      const textCx = cx - (hasIcon ? (iconGap + iconSize) * 0.5 : 0);
      const iconCx = textCx + textW * 0.5 + iconGap + iconSize * 0.5;

      if (isActiveWord) {
        const popP = easeOutBack(clamp01((frame.wordProgress || 0) * 2.2));
        const tiltRad = motion > 0 ? -0.026 * motion : 0;
        ctx.translate(cx, warpedY);
        ctx.rotate(tiltRad);
        ctx.translate(-cx, -warpedY);

        const padX = Math.round(wordFontPx * 0.38);
        const padY = Math.round(wordFontPx * 0.22);
        const barW = totalGroupW + padX * 2;
        const barH = wordFontPx + padY * 2;
        const barX = cx - barW * 0.5;
        const barY = warpedY - barH * 0.5;

        ctx.shadowColor = accent;
        ctx.shadowBlur = 22 + frame.audio.bassEnergy * 14;
        ctx.fillStyle = accent;
        drawRoundedRectPath(ctx, barX, barY, barW, barH, Math.max(8, wordFontPx * 0.2));
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.fillStyle = cutoutText;
        ctx.globalAlpha = frame.lineFadeAlpha;
        ctx.fillText(w.text, textCx, warpedY + 1);

        if (hasIcon && w.iconId) {
          drawWordIcon(ctx, w.iconId, iconCx, warpedY, iconSize, cutoutText, 0.85 + 0.25 * popP);
        }
      } else {
        ctx.fillStyle = isPassedWord ? '#e2e8f0' : 'rgba(226, 232, 240, 0.42)';
        ctx.globalAlpha = (isPassedWord ? 0.88 : 0.48) * frame.lineFadeAlpha;
        ctx.fillText(w.text, textCx, warpedY);

        if (hasIcon && w.iconId) {
          drawWordIcon(
            ctx,
            w.iconId,
            iconCx,
            warpedY,
            iconSize,
            isPassedWord ? frame.palette.accentSecondary : 'rgba(226, 232, 240, 0.42)',
            1.0
          );
        }
      }

      ctx.restore();
    }
  }
}
