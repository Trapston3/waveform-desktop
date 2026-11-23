// Style: CRTScanline
// Variations:
//  0: 'p31-green' (default) - true opaque #030605 phosphor CRT glass, luminous P31 green phosphor text
//  1: 'p3-amber'            - true opaque #070503 amber CRT glass, warm P3 amber terminal phosphor
//  2: 'trinitron-rgb'       - true opaque #050709 Trinitron glass, aperture-grille RGB chromatic subpixel shift

import type { StyleFrameContext } from '../../core/models';
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

export class CRTScanlineStyle implements ILyricVisualStyle {
  readonly id = 'CRTScanline' as const;
  readonly name = 'CRT Scanline';
  readonly webGlEffect = 'crtScanline' as const;

  private scrollY = 0;
  private initialized = false;
  private lastKnownActiveIdx = -1;

  getVariationIndex(variationId?: string): 0 | 1 | 2 {
    if (variationId === 'p3-amber') return 1;
    if (variationId === 'trinitron-rgb') return 2;
    return 0;
  }

  getMeasurementSpec(frame: StyleFrameContext): StyleMeasurementSpec {
    return {
      fontWeight: 700,
      fontSizeMultiplier: 0.94,
      fontFamilyOverride: `"JetBrains Mono", ${frame.fontFamily}`,
      maxLineWidthRatio: 0.78,
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

    const glassHex = varIdx === 0 ? '#030605' : varIdx === 1 ? '#070503' : '#050709';
    const phosphor = varIdx === 0 ? '#6ee7b7' : varIdx === 1 ? '#fbbf24' : '#38bdf8';
    const phosphorBright = varIdx === 0 ? '#ecfdf5' : varIdx === 1 ? '#fffbeb' : '#ffffff';
    const phosphorUpcoming = varIdx === 0 ? '#34d399' : varIdx === 1 ? '#d97706' : '#7dd3fc';

    if (!isTransparent) {
      ctx.save();
      if (!frame.hasWebGlBackdrop) {
        // True opaque dark CRT glass backdrop scaled by backgroundOpacity (NEVER washed-out grey!)
        ctx.globalAlpha = bgAlpha;
        ctx.fillStyle = glassHex;
        ctx.fillRect(0, 0, width, height);
      }

      // Curved CRT barrel vignette
      ctx.globalAlpha = bgAlpha;
      const vig = ctx.createRadialGradient(
        width * 0.5,
        height * 0.5,
        Math.min(width, height) * 0.24,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.74
      );
      vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vig.addColorStop(0.7, `rgba(0, 0, 0, ${(0.35 * (0.5 + vigStrength * 0.5)).toFixed(3)})`);
      vig.addColorStop(1, `rgba(0, 0, 0, ${(0.88 * (0.45 + vigStrength * 0.55)).toFixed(3)})`);
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, width, height);

      // Crisp subtle dark scanlines
      ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
      for (let y = 0; y < height; y += 4) {
        ctx.fillRect(0, y, width, 1);
      }

      // Trinitron vertical aperture grille subpixel lines
      if (varIdx === 2) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.018)';
        for (let x = 0; x < width; x += 6) {
          ctx.fillRect(x, 0, 1, height);
        }
      }

      // Curved CRT glass inner bezel reflection
      ctx.strokeStyle = phosphor;
      ctx.globalAlpha = bgAlpha * (0.14 + vigStrength * 0.12);
      ctx.lineWidth = 1.5;
      drawRoundedRectPath(ctx, 10, 10, Math.max(10, width - 20), Math.max(10, height - 20), 22);
      ctx.stroke();

      ctx.restore();
    }

    const layout = frame.layout;
    if (!layout || layout.lines.length === 0) {
      if (frame.isInstrumentalGap) {
        drawInstrumentalIndicator(ctx, frame, width, height, phosphor);
      } else {
        drawEmptyState(ctx, frame, width, height, '> AWAITING SIGNAL_');
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
      const rate = Math.min(1, Math.max(0.016, frame.deltaSeconds) * 8.5);
      this.scrollY += (targetScrollY - this.scrollY) * rate;
    }

    const manualScroll =
      typeof frame.manualScrollY === 'number' && Number.isFinite(frame.manualScrollY)
        ? frame.manualScrollY
        : 0;
    const effectiveScrollY = this.scrollY + manualScroll;
    const isBrowsing = frame.isFollowingPlayback === false || Math.abs(manualScroll) > 3;

    const focal = getFocalRect(frame, width);
    const monoFamily = `"JetBrains Mono", ${frame.fontFamily}`;
    const fontSize = layout.fontSizePx;
    const padX = Math.max(42, Math.round(focal.width * 0.1));
    const cy = height * 0.48;
    const unsyncedOrLineLevel = isUnsyncedLyrics(frame) || frame.activeWordIndex < 0;
    const isCenterAlign = frame.textAlign === 'center';
    const hoveredIdx = typeof frame.hoveredLineIndex === 'number' ? frame.hoveredLineIndex : -1;

    // Respect reduceMotion: zero jitter/flicker/chromatic shift when reduceMotion is true
    const jitterX = frame.reduceMotion ? 0 : frame.audio.beatDetected ? 1.0 : 0;
    const flicker = frame.reduceMotion ? 1.0 : 0.985 + 0.015 * Math.sin(frame.timeSeconds * 24);
    const chromaShift = frame.reduceMotion
      ? 0
      : (varIdx === 2 ? 2.1 : 1.1) + (frame.audio.beatDetected ? 0.75 : 0);

    ctx.save();
    if (focal.left > 0) {
      ctx.translate(focal.left, 0);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // Terminal header bar strictly inside focal.left
    if (!isTransparent) {
      ctx.font = `600 12px ${monoFamily}`;
      ctx.fillStyle = phosphor;
      ctx.globalAlpha = 0.82 * flicker;
      const modeLabel =
        varIdx === 0 ? 'P31-PHOSPHOR' : varIdx === 1 ? 'P3-AMBER' : 'TRINITRON-RGB';
      const channelTag = hasActiveLine ? String(scrollIdx + 1).padStart(2, '0') : '--';
      ctx.fillText(
        `SYS://LYRIC-CRT [${modeLabel}]  CH:${channelTag}  T+${formatTimestamp(frame.timeSeconds)}`,
        padX,
        Math.max(24, height * 0.11)
      );
    }

    for (let i = 0; i < layout.lines.length; i++) {
      const line = layout.lines[i];
      const lineCenterOffset = line.y + line.height * 0.5 - effectiveScrollY;
      const gapOffset =
        frame.isInstrumentalGap && !isBrowsing && !hasActiveLine
          ? i <= scrollIdx
            ? -58
            : 58
          : 0;
      const screenY = cy + lineCenterOffset - line.height * 0.5 + gapOffset;

      if (screenY + line.height < -60 || screenY > height + 60) continue;
      if (!isBrowsing && Math.abs(i - scrollIdx) > 1) continue;

      const isActive = hasActiveLine && i === frame.activeLineIndex;
      const isHovered = i === hoveredIdx;
      const rawLine = frame.lyrics?.lines[i];
      const resolved = rawLine ? resolveDisplayLine(rawLine, frame.scriptMode, this.id) : null;
      const secondaryText = line.secondaryText ?? resolved?.secondaryText ?? null;
      const lineBaseX = isCenterAlign ? Math.max(padX, line.x) : padX;

      const hitLocalX = Math.max(12, lineBaseX - fontSize);
      const hitW = Math.min(focal.width - hitLocalX - 10, Math.max(line.width + fontSize + 24, 180));
      frame.recordHitRect?.(i, focal.left + hitLocalX, screenY - 6, hitW, line.height + 12);

      if (isHovered) {
        ctx.save();
        drawRoundedRectPath(ctx, hitLocalX, screenY - 5, hitW, line.height + 10, 6);
        ctx.fillStyle =
          varIdx === 0
            ? 'rgba(110, 231, 183, 0.11)'
            : varIdx === 1
            ? 'rgba(251, 191, 36, 0.11)'
            : 'rgba(56, 189, 248, 0.12)';
        ctx.fill();
        ctx.strokeStyle = phosphor;
        ctx.globalAlpha = 0.48;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }

      if (isActive) {
        // Active terminal prompt '>' kept strictly inside focal.left (promptX >= 14 in local focal coords)
        const promptX = Math.max(14, lineBaseX - fontSize * 0.8);
        ctx.font = `700 ${fontSize}px ${monoFamily}`;
        ctx.fillStyle = phosphor;
        ctx.globalAlpha = 0.96 * flicker;
        ctx.shadowColor = phosphor;
        ctx.shadowBlur = 10;
        ctx.fillText('>', promptX, screenY);

        for (let w = 0; w < line.words.length; w++) {
          const word = line.words[w];
          const wx = lineBaseX + word.x + jitterX;
          const wy = screenY + word.y;
          const isCurrent = unsyncedOrLineLevel ? true : w === frame.activeWordIndex;
          const isPast = !unsyncedOrLineLevel && w < frame.activeWordIndex;

          if (isCurrent) {
            // RGB chromatic subpixel shift on active words (richer in trinitron-rgb)
            if (chromaShift > 0) {
              ctx.save();
              ctx.shadowBlur = 0;
              ctx.globalAlpha = (varIdx === 2 ? 0.55 : 0.34) * frame.lineFadeAlpha * flicker;
              ctx.fillStyle = '#ff2a6d';
              ctx.fillText(word.text, wx - chromaShift, wy);
              ctx.fillStyle = '#05d5fa';
              ctx.fillText(word.text, wx + chromaShift, wy);
              ctx.restore();
            }

            ctx.globalAlpha = frame.lineFadeAlpha * flicker;
            ctx.fillStyle = phosphorBright;
            ctx.shadowColor = phosphor;
            ctx.shadowBlur = 16;
            ctx.fillText(word.text, wx, wy);
          } else {
            ctx.shadowBlur = isPast ? 8 : 0;
            ctx.shadowColor = phosphor;
            ctx.globalAlpha =
              (isPast ? 0.9 : isHovered ? 0.68 : 0.46) * frame.lineFadeAlpha * flicker;
            ctx.fillStyle = isPast ? phosphor : phosphorUpcoming;
            ctx.fillText(word.text, wx, wy);
          }
        }

        if (secondaryText) {
          const secFont = Math.max(11, Math.round(fontSize * 0.44));
          ctx.save();
          ctx.font = `500 ${secFont}px ${monoFamily}`;
          ctx.fillStyle = phosphorUpcoming;
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 0.72 * frame.lineFadeAlpha * flicker;
          ctx.fillText(secondaryText, lineBaseX, screenY + line.height + 4);
          ctx.restore();
        }
      } else {
        const subScale = isBrowsing ? 0.86 : 0.66;
        const subFont = Math.max(13, Math.round(fontSize * subScale));
        ctx.save();
        ctx.font = `500 ${subFont}px ${monoFamily}`;
        ctx.fillStyle = phosphor;
        ctx.shadowBlur = 0;
        ctx.globalAlpha = (isHovered ? 0.76 : 0.4) * flicker;
        for (let w = 0; w < line.words.length; w++) {
          const word = line.words[w];
          ctx.fillText(word.text, lineBaseX + word.x * subScale, screenY + word.y * subScale);
        }
        ctx.restore();
      }
    }

    ctx.restore();

    if (frame.isInstrumentalGap && !isBrowsing) {
      drawInstrumentalIndicator(ctx, frame, width, height, phosphor);
    }
  }
}
