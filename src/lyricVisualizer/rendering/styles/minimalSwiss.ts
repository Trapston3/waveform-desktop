// Style: MinimalSwiss
// Variations:
//  0: 'international-grid' (default) - classic asymmetric Swiss 12-column hairline grid + micro-timestamps
//  1: 'editorial-bold'               - high-contrast modernist poster layout with horizontal Swiss dividers & bold index
// Timestamp strictly stays >= focal.left + 12.

import type { StyleFrameContext } from '../../core/models';
import { isBlankOrInstrumentalLineText } from '../../core/lrcParser';
import {
  clamp01,
  drawEmptyState,
  drawInstrumentalIndicator,
  drawRoundedRectPath,
  formatTimestamp,
  getFocalRect,
  isTransparentStage,
  isUnsyncedLyrics,
  resolveDisplayLine,
  type ILyricVisualStyle,
  type StyleMeasurementSpec,
} from '../styleInterface';

export class MinimalSwissStyle implements ILyricVisualStyle {
  readonly id = 'MinimalSwiss' as const;
  readonly name = 'Minimal Swiss';
  readonly webGlEffect = 'none' as const;

  private scrollY = 0;
  private initialized = false;
  private lastKnownActiveIdx = -1;

  getVariationIndex(variationId?: string): 0 | 1 {
    return variationId === 'editorial-bold' ? 1 : 0;
  }

  getMeasurementSpec(frame: StyleFrameContext): StyleMeasurementSpec {
    const varIdx = this.getVariationIndex(frame?.variationId);
    return {
      fontWeight: varIdx === 1 ? 800 : 700,
      fontSizeMultiplier: varIdx === 1 ? 1.02 : 0.96,
      maxLineWidthRatio: 0.72,
      scriptMode: frame?.scriptMode ?? 'auto',
      styleId: this.id,
    };
  }

  reset(): void {
    this.scrollY = 0;
    this.initialized = false;
    this.lastKnownActiveIdx = -1;
  }

  render(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    width: number,
    height: number
  ): void {
    const isTransparent = isTransparentStage(frame);
    const varIdx = this.getVariationIndex(frame.variationId);
    const focal = getFocalRect(frame, width);
    const isCenterAlign = frame.textAlign === 'center';
    const fgGutterX = Math.max(92, Math.round(focal.width * (isCenterAlign ? 0.18 : 0.14)));
    const globalGutterX = focal.left + fgGutterX;

    const bgAlpha =
      typeof frame.backgroundOpacity === 'number' && Number.isFinite(frame.backgroundOpacity)
        ? clamp01(frame.backgroundOpacity)
        : 0.95;
    const vigStrength =
      typeof frame.vignetteStrength === 'number' && Number.isFinite(frame.vignetteStrength)
        ? clamp01(frame.vignetteStrength)
        : 0.55;

    if (!isTransparent) {
      ctx.save();
      ctx.globalAlpha = bgAlpha;
      ctx.fillStyle = varIdx === 1 ? '#07080c' : frame.palette.bgDeep;
      ctx.fillRect(0, 0, width, height);

      // Swiss 12-column hairline grid (soften/remove left vertical divider when focal.left > 0 so split-view flows seamlessly)
      ctx.strokeStyle = varIdx === 1 ? 'rgba(255, 255, 255, 0.085)' : 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = varIdx === 1 ? 1.2 : 1;
      ctx.beginPath();
      if (focal.left <= 2) {
        ctx.moveTo(globalGutterX - 18, 0);
        ctx.lineTo(globalGutterX - 18, height);
      }
      ctx.moveTo(focal.left + focal.width * 0.88, 0);
      ctx.lineTo(focal.left + focal.width * 0.88, height);
      ctx.moveTo(0, height * 0.14);
      ctx.lineTo(width, height * 0.14);
      ctx.stroke();

      if (vigStrength > 0.01) {
        const vig = ctx.createRadialGradient(
          width * 0.5,
          height * 0.5,
          Math.min(width, height) * 0.28,
          width * 0.5,
          height * 0.5,
          Math.max(width, height) * 0.8
        );
        vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
        vig.addColorStop(1, `rgba(2, 3, 6, ${(0.7 * vigStrength).toFixed(3)})`);
        ctx.globalAlpha = 1;
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, width, height);
      }
      ctx.restore();
    }

    const layout = frame.layout;
    if (!layout || layout.lines.length === 0) {
      if (frame.isInstrumentalGap) {
        drawInstrumentalIndicator(ctx, frame, width, height, frame.palette.accentPrimary);
      } else {
        drawEmptyState(ctx, frame, width, height, 'NO LYRIC TRACK');
      }
      return;
    }

    const isLineBlank = (idx: number): boolean =>
      idx < 0 ||
      idx >= layout.lines.length ||
      isBlankOrInstrumentalLineText(frame.lyrics?.lines[idx]?.text ?? layout.lines[idx].text);

    let firstNonBlankIdx = -1;
    for (let i = 0; i < layout.lines.length; i++) {
      if (!isLineBlank(i)) {
        firstNonBlankIdx = i;
        break;
      }
    }
    if (firstNonBlankIdx < 0) {
      drawInstrumentalIndicator(ctx, frame, width, height, frame.palette.accentPrimary);
      return;
    }

    const activeLineIsBlank =
      frame.activeLineIndex >= 0 &&
      frame.activeLineIndex < layout.lines.length &&
      isLineBlank(frame.activeLineIndex);
    const hasActiveLine =
      frame.activeLineIndex >= 0 &&
      frame.activeLineIndex < layout.lines.length &&
      !activeLineIsBlank;
    if (hasActiveLine) {
      this.lastKnownActiveIdx = frame.activeLineIndex;
    }
    const fallbackIdx =
      typeof frame.lastActiveLineIndex === 'number' &&
      frame.lastActiveLineIndex >= 0 &&
      !isLineBlank(frame.lastActiveLineIndex)
        ? frame.lastActiveLineIndex
        : this.lastKnownActiveIdx >= 0 && !isLineBlank(this.lastKnownActiveIdx)
        ? this.lastKnownActiveIdx
        : firstNonBlankIdx;
    let scrollIdx = Math.max(
      0,
      Math.min(layout.lines.length - 1, hasActiveLine ? frame.activeLineIndex : fallbackIdx)
    );
    while (scrollIdx > 0 && isLineBlank(scrollIdx)) scrollIdx--;
    if (isLineBlank(scrollIdx)) scrollIdx = firstNonBlankIdx;
    const activeLine = layout.lines[scrollIdx];
    const targetScrollY = activeLine.y;

    if (!this.initialized || frame.didSeekThisFrame || frame.reduceMotion) {
      this.scrollY = targetScrollY;
      this.initialized = true;
    } else {
      const rate = Math.min(1, Math.max(0.016, frame.deltaSeconds) * 8.5);
      this.scrollY += (targetScrollY - this.scrollY) * rate;
    }

    const manualScroll =
      typeof frame.manualScrollY === 'number' && Number.isFinite(frame.manualScrollY)
        ? frame.manualScrollY
        : 0;
    const effectiveScrollY = this.scrollY + manualScroll;
    const isBrowsing = frame.isFollowingPlayback === false || Math.abs(manualScroll) > 3;

    const anchorY = height * 0.44;
    const fontSize = layout.fontSizePx;
    const unsyncedOrLineLevel = isUnsyncedLyrics(frame) || frame.activeWordIndex < 0;
    const hoveredIdx = typeof frame.hoveredLineIndex === 'number' ? frame.hoveredLineIndex : -1;

    ctx.save();
    if (focal.left > 0) {
      ctx.translate(focal.left, 0);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // Top-left Swiss grid index badge
    if (!isTransparent) {
      ctx.font = `${varIdx === 1 ? 700 : 600} 11px "JetBrains Mono", monospace`;
      ctx.fillStyle = frame.palette.accentPrimary;
      ctx.globalAlpha = 0.88;
      const idxLabel = hasActiveLine ? String(scrollIdx + 1).padStart(2, '0') : '--';
      const headerLabel =
        varIdx === 1
          ? `SWISS // EDITION ${idxLabel} OF ${String(layout.lines.length).padStart(2, '0')}`
          : `INDEX ${idxLabel}/${String(layout.lines.length).padStart(2, '0')}`;
      ctx.fillText(headerLabel, fgGutterX, Math.max(18, height * 0.08));
    }

    // Timestamp X in local focal coordinates: Math.max(14, fgGutterX - 72) -> global X is ALWAYS >= focal.left + 14 >= focal.left + 12!
    const timestampLocalX = Math.max(14, fgGutterX - 72);

    const showInstrumental = Boolean(frame.isInstrumentalGap || activeLineIsBlank);
    for (let i = 0; i < layout.lines.length; i++) {
      const line = layout.lines[i];
      if (isLineBlank(i)) continue;
      const gapOffset =
        showInstrumental && !isBrowsing && !hasActiveLine
          ? i <= scrollIdx
            ? -58
            : 58
          : 0;
      const y = anchorY + (line.y - effectiveScrollY) + gapOffset;
      if (y + line.height < -60 || y > height + 60) continue;

      const isActive = hasActiveLine && i === frame.activeLineIndex;
      const isPast = hasActiveLine
        ? i < frame.activeLineIndex
        : i <= scrollIdx && (frame.lyrics?.lines[i]?.endSeconds ?? 0) <= frame.timeSeconds;
      const isHovered = i === hoveredIdx;
      const rawLine = frame.lyrics?.lines[i];
      const resolved = rawLine ? resolveDisplayLine(rawLine, frame.scriptMode, this.id) : null;
      const secondaryText = line.secondaryText ?? resolved?.secondaryText ?? null;

      // Record hit rect in global canvas coordinates (zero allocations)
      const hitLocalX = timestampLocalX;
      const hitW = Math.min(
        focal.width - hitLocalX - 10,
        Math.max(fgGutterX - hitLocalX + line.width + 28, 220)
      );
      frame.recordHitRect?.(i, focal.left + hitLocalX, y - 6, hitW, line.height + 12);

      if (isHovered) {
        ctx.save();
        drawRoundedRectPath(ctx, hitLocalX - 4, y - 5, hitW + 8, line.height + 10, 6);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
        ctx.fill();
        ctx.strokeStyle = frame.palette.accentPrimary;
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }

      if (varIdx === 1 && !isTransparent) {
        // Editorial Bold horizontal Swiss rule divider
        ctx.save();
        ctx.strokeStyle = isActive ? frame.palette.accentPrimary : 'rgba(255, 255, 255, 0.06)';
        ctx.globalAlpha = isActive ? 0.35 : 1;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(timestampLocalX, y - 6);
        ctx.lineTo(focal.width * 0.88, y - 6);
        ctx.stroke();
        ctx.restore();
      }

      // Micro-timestamp in left Swiss column (strictly >= focal.left + 12 in global canvas coords)
      ctx.font = `${varIdx === 1 ? 700 : 500} 12px "JetBrains Mono", monospace`;
      ctx.fillStyle =
        isActive || isHovered ? frame.palette.accentPrimary : frame.palette.textPassed;
      ctx.globalAlpha = isActive ? 0.96 : isHovered ? 0.8 : 0.42;
      ctx.fillText(formatTimestamp(line.startSeconds), timestampLocalX, y + 8);

      // Active-playing pulse dot next to timestamp in Browse Mode
      if (isActive && frame.isFollowingPlayback === false) {
        const pulse = frame.reduceMotion
          ? 0.9
          : 0.55 + 0.45 * Math.sin(frame.timeSeconds * 5.2);
        ctx.save();
        ctx.fillStyle = frame.palette.accentPrimary;
        ctx.globalAlpha = pulse;
        ctx.shadowColor = frame.palette.accentPrimary;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(timestampLocalX - 8, y + 14, frame.reduceMotion ? 3.5 : 3.2 + 0.8 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Bold vertical Swiss active line bar indicator
      if (isActive || isHovered) {
        ctx.globalAlpha = isActive ? 1.0 : 0.55;
        ctx.fillStyle = frame.palette.accentPrimary;
        const barH = Math.max(fontSize, line.height - 6);
        ctx.fillRect(fgGutterX - 20, y + 2, varIdx === 1 ? 7 : 5, barH);
      }

      // Tight grotesque typography
      ctx.font = `${isActive ? (varIdx === 1 ? 800 : 700) : 500} ${fontSize}px ${frame.fontFamily}`;
      for (let w = 0; w < line.words.length; w++) {
        const word = line.words[w];
        const wx = fgGutterX + word.x;
        const wy = y + word.y;
        if (isActive) {
          if (unsyncedOrLineLevel) {
            ctx.fillStyle = frame.palette.textActive;
            ctx.globalAlpha = frame.lineFadeAlpha;
          } else {
            const isWordCurrent = w === frame.activeWordIndex;
            const isWordPassed = w < frame.activeWordIndex;
            ctx.fillStyle = isWordCurrent
              ? frame.palette.accentPrimary
              : isWordPassed
              ? frame.palette.textActive
              : frame.palette.textUpcoming;
            ctx.globalAlpha = (isWordCurrent || isWordPassed ? 1.0 : 0.56) * frame.lineFadeAlpha;
          }
        } else {
          ctx.fillStyle = isHovered
            ? frame.palette.textActive
            : isPast
            ? frame.palette.textPassed
            : frame.palette.textUpcoming;
          ctx.globalAlpha = isHovered
            ? 0.85
            : Math.max(0.18, 0.48 - Math.abs(i - scrollIdx) * 0.1);
        }
        ctx.fillText(word.text, wx, wy);
      }

      if (isActive && secondaryText) {
        const secFont = Math.max(12, Math.round(fontSize * 0.42));
        ctx.save();
        ctx.font = `500 ${secFont}px ${frame.fontFamily}`;
        ctx.fillStyle = frame.palette.textUpcoming;
        ctx.globalAlpha = 0.72 * frame.lineFadeAlpha;
        ctx.fillText(secondaryText, fgGutterX, y + line.height + 4);
        ctx.restore();
      }
    }

    ctx.restore();

    if (showInstrumental && !isBrowsing) {
      drawInstrumentalIndicator(ctx, frame, width, height, frame.palette.accentPrimary);
    }
  }
}
