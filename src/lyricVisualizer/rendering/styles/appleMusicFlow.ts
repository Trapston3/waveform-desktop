// Style 1: AppleMusicFlow
// Variations:
//  0: 'silk-glow' (default) - lush atmospheric radial bloom + glowing word gradient sweep
//  1: 'editorial-crisp'     - high-contrast deep dark backdrop with razor-crisp word illumination

import type { StyleFrameContext } from '../../core/models';
import {
  clamp01,
  drawEmptyState,
  drawInstrumentalIndicator,
  drawRoundedRectPath,
  easeOutCubic,
  getFocalRect,
  isTransparentStage,
  isUnsyncedLyrics,
  resolveDisplayLine,
  type ILyricVisualStyle,
  type StyleMeasurementSpec,
} from '../styleInterface';

export class AppleMusicFlowStyle implements ILyricVisualStyle {
  readonly id = 'AppleMusicFlow' as const;
  readonly name = 'Atmospheric Flow';
  readonly webGlEffect = 'ambientFlow' as const;

  private scrollY = 0;
  private initialized = false;
  private lastKnownActiveIdx = -1;

  getVariationIndex(variationId?: string): 0 | 1 {
    return variationId === 'editorial-crisp' ? 1 : 0;
  }

  getMeasurementSpec(frame?: StyleFrameContext): StyleMeasurementSpec {
    return {
      fontWeight: 700,
      fontSizeMultiplier: 1.0,
      maxLineWidthRatio: 0.84,
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
    const bgAlpha =
      typeof frame.backgroundOpacity === 'number' && Number.isFinite(frame.backgroundOpacity)
        ? clamp01(frame.backgroundOpacity)
        : 0.95;
    const vigStrength =
      typeof frame.vignetteStrength === 'number' && Number.isFinite(frame.vignetteStrength)
        ? clamp01(frame.vignetteStrength)
        : 0.55;

    // Translucent atmospheric backdrop (cleanly transparent in overlay / embedded mode)
    if (!isTransparent) {
      ctx.save();
      const bg = ctx.createLinearGradient(0, 0, width * 0.4, height);
      bg.addColorStop(0, frame.palette.bgDeep);
      bg.addColorStop(0.55, varIdx === 1 ? frame.palette.bgDeep : frame.palette.bgMid);
      bg.addColorStop(1, frame.palette.bgDeep);
      ctx.globalAlpha = (varIdx === 1 ? 0.88 : 0.76) * bgAlpha;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      // Soft breathing radial bloom
      const breath = frame.reduceMotion ? 0 : Math.sin(frame.timeSeconds * 0.7) * 0.08;
      const cx = width * (0.5 + breath);
      const cy = height * 0.44;
      const rad = Math.max(width, height) * (0.48 + frame.audio.bassEnergy * 0.14);
      const bloom = ctx.createRadialGradient(cx, cy, 10, cx, cy, rad);
      bloom.addColorStop(0, frame.palette.accentPrimary);
      bloom.addColorStop(0.55, frame.palette.accentSecondary);
      bloom.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha =
        (varIdx === 1 ? 0.08 : 0.16 + frame.audio.rmsLevel * 0.14) * bgAlpha;
      ctx.fillStyle = bloom;
      ctx.fillRect(0, 0, width, height);

      if (vigStrength > 0.01) {
        const vig = ctx.createRadialGradient(
          width * 0.5,
          height * 0.48,
          Math.min(width, height) * 0.28,
          width * 0.5,
          height * 0.5,
          Math.max(width, height) * 0.8
        );
        vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
        vig.addColorStop(1, `rgba(4, 6, 12, ${(0.68 * vigStrength).toFixed(3)})`);
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
        drawEmptyState(ctx, frame, width, height);
      }
      return;
    }

    const hasActiveLine =
      frame.activeLineIndex >= 0 && frame.activeLineIndex < layout.lines.length;
    if (hasActiveLine) {
      this.lastKnownActiveIdx = frame.activeLineIndex;
    }
    const fallbackIdx =
      typeof frame.lastActiveLineIndex === 'number' && frame.lastActiveLineIndex >= 0
        ? frame.lastActiveLineIndex
        : this.lastKnownActiveIdx >= 0
        ? this.lastKnownActiveIdx
        : 0;
    const scrollIdx = Math.max(
      0,
      Math.min(layout.lines.length - 1, hasActiveLine ? frame.activeLineIndex : fallbackIdx)
    );
    const activeLine = layout.lines[scrollIdx];
    const targetScrollY = activeLine.y + activeLine.height * 0.5;

    if (!this.initialized || frame.didSeekThisFrame || frame.reduceMotion) {
      this.scrollY = targetScrollY;
      this.initialized = true;
    } else {
      const springRate = Math.min(1, Math.max(0.016, frame.deltaSeconds) * 7.5);
      this.scrollY += (targetScrollY - this.scrollY) * springRate;
    }

    const manualScroll =
      typeof frame.manualScrollY === 'number' && Number.isFinite(frame.manualScrollY)
        ? frame.manualScrollY
        : 0;
    const effectiveScrollY = this.scrollY + manualScroll;
    const isBrowsing = frame.isFollowingPlayback === false || Math.abs(manualScroll) > 3;

    const focal = getFocalRect(frame, width);
    const unsynced = isUnsyncedLyrics(frame);
    const anchorY = height * (isTransparent ? 0.52 : 0.46);
    const fontSize = layout.fontSizePx;
    const isLeftAlign = frame.textAlign === 'left';
    const leftPad = Math.max(28, Math.round(focal.width * 0.08));
    const hoveredIdx = typeof frame.hoveredLineIndex === 'number' ? frame.hoveredLineIndex : -1;

    ctx.save();
    if (focal.left > 0) {
      ctx.translate(focal.left, 0);
    }
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    for (let i = 0; i < layout.lines.length; i++) {
      const line = layout.lines[i];
      const gapOffset =
        frame.isInstrumentalGap && !isBrowsing && !hasActiveLine
          ? i <= scrollIdx
            ? -58
            : 58
          : 0;
      const screenY = anchorY + (line.y - effectiveScrollY) + gapOffset;
      if (screenY + line.height < -80 || screenY > height + 80) continue;

      const dist = Math.abs(i - scrollIdx);
      const isActive = hasActiveLine && i === frame.activeLineIndex;
      const isPast = hasActiveLine
        ? i < frame.activeLineIndex
        : i <= scrollIdx && (frame.lyrics?.lines[i]?.endSeconds ?? 0) <= frame.timeSeconds;
      const isHovered = i === hoveredIdx;
      const lineBaseX = isLeftAlign ? leftPad : line.x;
      const rawLine = frame.lyrics?.lines[i];
      const resolved = rawLine ? resolveDisplayLine(rawLine, frame.scriptMode, this.id) : null;
      const secondaryText = line.secondaryText ?? resolved?.secondaryText ?? null;

      // Record hit rect in global canvas coordinates (zero allocations)
      const hitLocalX = Math.max(8, Math.min(lineBaseX - 18, focal.width * 0.1));
      const hitW = Math.min(
        focal.width - hitLocalX - 8,
        Math.max(line.width + 36, focal.width - hitLocalX * 2)
      );
      frame.recordHitRect?.(i, focal.left + hitLocalX, screenY - 10, hitW, line.height + 20);

      if (isHovered) {
        ctx.save();
        drawRoundedRectPath(ctx, Math.max(8, lineBaseX - 18), screenY - 8, Math.min(focal.width - 16, line.width + 36), line.height + 16, 12);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.fill();
        ctx.strokeStyle = frame.palette.accentPrimary;
        ctx.globalAlpha = 0.38;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();
      }

      if (isActive && isBrowsing) {
        ctx.save();
        ctx.fillStyle = frame.palette.accentPrimary;
        ctx.globalAlpha = 0.9;
        drawRoundedRectPath(ctx, Math.max(4, lineBaseX - 14), screenY + 4, 4, Math.max(16, line.height - 8), 2);
        ctx.fill();
        ctx.restore();
      }

      const falloff = isActive
        ? 1.0
        : isHovered
        ? 0.85
        : Math.max(0.16, 0.56 - dist * 0.12);
      const scale = isActive
        ? 1.0 + (frame.reduceMotion ? 0 : frame.audio.bassEnergy * 0.025)
        : Math.max(0.86, 0.96 - dist * 0.03);

      ctx.save();
      const lineCenterX = isLeftAlign ? leftPad + line.width * 0.5 : focal.width * 0.5;
      const lineCenterY = screenY + line.height * 0.5;
      ctx.translate(lineCenterX, lineCenterY);
      ctx.scale(scale, scale);
      ctx.translate(-lineCenterX, -lineCenterY);

      ctx.font = `${isActive ? (varIdx === 1 ? 800 : 700) : 600} ${fontSize}px ${frame.fontFamily}`;

      if (!isActive || unsynced || frame.activeWordIndex < 0) {
        ctx.globalAlpha = isActive
          ? frame.lineFadeAlpha
          : falloff * (isTransparent ? 0.92 : 1.0);
        ctx.fillStyle = isActive
          ? frame.palette.textActive
          : isHovered
          ? frame.palette.textActive
          : isPast
          ? frame.palette.textPassed
          : frame.palette.textUpcoming;
        for (let w = 0; w < line.words.length; w++) {
          const word = line.words[w];
          ctx.fillText(word.text, lineBaseX + word.x, screenY + word.y);
        }
      } else {
        // Active line: word-by-word illumination + soft glowing gradient sweep
        for (let w = 0; w < line.words.length; w++) {
          const word = line.words[w];
          const wx = lineBaseX + word.x;
          const wy = screenY + word.y;

          const isWordPassed = w < frame.activeWordIndex;
          const isWordActive = w === frame.activeWordIndex;
          const lift =
            isWordActive && !frame.reduceMotion
              ? (varIdx === 1 ? -3.0 : -4.5) * easeOutCubic(frame.wordProgress)
              : isWordPassed && !frame.reduceMotion
              ? -1.5
              : 0;

          if (isWordPassed) {
            ctx.globalAlpha = 0.96 * frame.lineFadeAlpha;
            ctx.fillStyle = frame.palette.textActive;
            ctx.shadowColor = frame.palette.accentPrimary;
            ctx.shadowBlur = varIdx === 1 ? 4 : 10;
            ctx.fillText(word.text, wx, wy + lift);
          } else if (isWordActive) {
            const p = clamp01(frame.wordProgress);
            // Base dimmed word
            ctx.globalAlpha = 0.42 * frame.lineFadeAlpha;
            ctx.shadowBlur = 0;
            ctx.fillStyle = frame.palette.textUpcoming;
            ctx.fillText(word.text, wx, wy + lift);

            // Illuminated gradient sweep
            const sweepGrad = ctx.createLinearGradient(wx, wy, wx + Math.max(1, word.width), wy);
            sweepGrad.addColorStop(0, '#ffffff');
            sweepGrad.addColorStop(Math.max(0.01, Math.min(0.99, p)), frame.palette.accentPrimary);
            sweepGrad.addColorStop(1, frame.palette.textActive);

            ctx.save();
            ctx.beginPath();
            ctx.rect(wx - 6, wy + lift - 10, (word.width + 12) * Math.max(0.08, p), word.height + 20);
            ctx.clip();
            ctx.globalAlpha = frame.lineFadeAlpha;
            ctx.fillStyle = sweepGrad;
            ctx.shadowColor = frame.palette.accentPrimary;
            ctx.shadowBlur = varIdx === 1 ? 8 : 16 + frame.audio.rmsLevel * 10;
            ctx.fillText(word.text, wx, wy + lift);
            ctx.restore();
          } else {
            ctx.globalAlpha = 0.38 * frame.lineFadeAlpha;
            ctx.shadowBlur = 0;
            ctx.fillStyle = frame.palette.textUpcoming;
            ctx.fillText(word.text, wx, wy);
          }
        }
      }

      if (isActive && secondaryText) {
        const secFont = Math.max(12, Math.round(fontSize * 0.42));
        ctx.save();
        ctx.font = `500 ${secFont}px ${frame.fontFamily}`;
        ctx.fillStyle = frame.palette.textUpcoming;
        ctx.globalAlpha = 0.72 * frame.lineFadeAlpha;
        ctx.shadowBlur = 0;
        ctx.textAlign = isLeftAlign ? 'left' : 'center';
        ctx.fillText(
          secondaryText,
          isLeftAlign ? leftPad : focal.width * 0.5,
          screenY + line.height + 4
        );
        ctx.restore();
      }

      ctx.restore();
    }

    ctx.restore();

    if (frame.isInstrumentalGap && !isBrowsing) {
      drawInstrumentalIndicator(ctx, frame, width, height, frame.palette.accentPrimary);
    }
  }
}
