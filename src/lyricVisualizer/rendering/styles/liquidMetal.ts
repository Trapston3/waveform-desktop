// Style: LiquidMetal
// Variations:
//  0: 'obsidian-chrome' (default) - deep #07090e obsidian backdrop + high-contrast liquid silver/chrome specular gradients
//  1: 'holo-vaporwave'            - deep midnight #090517 synthwave stage, dark neon perspective horizon grid, iridescent cyan/magenta/violet sheen
//  2: 'mercury-album-tint'        - dark liquid mercury stage tinted with live palette accentPrimary / accentSecondary

import type { StyleFrameContext } from '../../core/models';
import {
  clamp01,
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
import type { WebGlEffectMode } from '../webGlEffectLayer';

export class LiquidMetalStyle implements ILyricVisualStyle {
  readonly id = 'LiquidMetal' as const;
  readonly name = 'Liquid Metal';
  readonly webGlEffect = 'liquidMetal' as const;

  private scrollY = 0;
  private initialized = false;
  private lastKnownActiveIdx = -1;

  getVariationIndex(variationId?: string): 0 | 1 | 2 {
    if (variationId === 'holo-vaporwave') return 1;
    if (variationId === 'mercury-album-tint') return 2;
    return 0;
  }

  getWebGlEffect(frame: StyleFrameContext): WebGlEffectMode {
    return this.getVariationIndex(frame.variationId) === 1 ? 'holoVaporwave' : 'liquidMetal';
  }

  getMeasurementSpec(frame?: StyleFrameContext): StyleMeasurementSpec {
    return {
      fontWeight: 800,
      fontSizeMultiplier: 1.08,
      maxLineWidthRatio: 0.82,
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

    if (!isTransparent) {
      ctx.save();
      ctx.globalAlpha = bgAlpha;

      if (varIdx === 0) {
        // Obsidian Chrome: deep #07090e obsidian backdrop (never washed-out grey)
        if (!frame.hasWebGlBackdrop) {
          const scrim = ctx.createRadialGradient(
            width * 0.5,
            height * 0.48,
            18,
            width * 0.5,
            height * 0.5,
            Math.max(width, height) * 0.78
          );
          scrim.addColorStop(0, '#090c14');
          scrim.addColorStop(0.55, '#07090e');
          scrim.addColorStop(1, '#040508');
          ctx.fillStyle = scrim;
          ctx.fillRect(0, 0, width, height);
        }

        const sheenX =
          width * (0.5 + (frame.reduceMotion ? 0 : 0.24 * Math.sin(frame.timeSeconds * 0.55)));
        const grad = ctx.createLinearGradient(
          sheenX - width * 0.32,
          0,
          sheenX + width * 0.32,
          height
        );
        grad.addColorStop(0, 'rgba(7, 9, 14, 0)');
        grad.addColorStop(0.5, 'rgba(226, 232, 240, 0.055)');
        grad.addColorStop(1, 'rgba(7, 9, 14, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
      } else if (varIdx === 1) {
        // Holo Vaporwave: deep midnight #090517 synthwave stage + perspective horizon grid
        if (!frame.hasWebGlBackdrop) {
          const bg = ctx.createLinearGradient(0, 0, 0, height);
          bg.addColorStop(0, '#070412');
          bg.addColorStop(0.58, '#090517');
          bg.addColorStop(1, '#120826');
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, width, height);
        }

        const horizonY = height * 0.64;
        const sunGrad = ctx.createRadialGradient(
          width * 0.5,
          horizonY - height * 0.06,
          8,
          width * 0.5,
          horizonY - height * 0.06,
          Math.min(width, height) * 0.34
        );
        sunGrad.addColorStop(0, frame.hasWebGlBackdrop ? 'rgba(244, 114, 182, 0.1)' : 'rgba(244, 114, 182, 0.22)');
        sunGrad.addColorStop(0.5, frame.hasWebGlBackdrop ? 'rgba(168, 85, 247, 0.05)' : 'rgba(168, 85, 247, 0.12)');
        sunGrad.addColorStop(1, 'rgba(9, 5, 23, 0)');
        ctx.fillStyle = sunGrad;
        ctx.fillRect(0, 0, width, height);

        if (!frame.hasWebGlBackdrop) {
          // Dark neon perspective horizon grid
          ctx.save();
          ctx.strokeStyle = '#22d3ee';
          ctx.lineWidth = 1;
          ctx.globalAlpha = bgAlpha * (0.15 + frame.audio.bassEnergy * 0.12);
          const rays = 10;
          for (let r = -rays; r <= rays; r++) {
            const topX = width * 0.5 + r * (width * 0.018);
            const botX = width * 0.5 + r * (width * 0.11);
            ctx.beginPath();
            ctx.moveTo(topX, horizonY);
            ctx.lineTo(botX, height);
            ctx.stroke();
          }

          const scrollPhase = frame.reduceMotion ? 0 : (frame.timeSeconds * 0.65) % 1;
          ctx.strokeStyle = '#f472b6';
          for (let row = 0; row < 7; row++) {
            const t = (row + scrollPhase) / 7;
            const y = horizonY + t * t * (height - horizonY);
            ctx.globalAlpha = bgAlpha * (0.06 + t * 0.18);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
          }
          ctx.restore();

          // Dark center lyric contrast scrim + subtle scanlines
          ctx.fillStyle = 'rgba(244, 114, 182, 0.022)';
          for (let y = 0; y < height; y += 6) {
            ctx.fillRect(0, y, width, 1);
          }
        }
      } else {
        // Mercury Album Tint: dark liquid mercury stage tinted with live palette
        if (!frame.hasWebGlBackdrop) {
          const bg = ctx.createRadialGradient(
            width * 0.5,
            height * 0.45,
            20,
            width * 0.5,
            height * 0.5,
            Math.max(width, height) * 0.82
          );
          bg.addColorStop(0, '#090d16');
          bg.addColorStop(0.6, '#06080e');
          bg.addColorStop(1, '#040509');
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, width, height);
        }

        const drift = frame.reduceMotion ? 0 : Math.sin(frame.timeSeconds * 0.5) * width * 0.08;
        const tint1 = ctx.createRadialGradient(
          width * 0.38 + drift,
          height * 0.44,
          12,
          width * 0.38 + drift,
          height * 0.44,
          Math.max(width, height) * 0.48
        );
        tint1.addColorStop(0, frame.palette.accentPrimary);
        tint1.addColorStop(0.55, frame.palette.accentSecondary);
        tint1.addColorStop(1, 'rgba(6, 8, 14, 0)');
        ctx.globalAlpha = bgAlpha * (0.14 + frame.audio.rmsLevel * 0.12);
        ctx.fillStyle = tint1;
        ctx.fillRect(0, 0, width, height);
      }

      if (vigStrength > 0.01) {
        const vig = ctx.createRadialGradient(
          width * 0.5,
          height * 0.48,
          Math.min(width, height) * 0.25,
          width * 0.5,
          height * 0.5,
          Math.max(width, height) * 0.76
        );
        vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
        vig.addColorStop(1, `rgba(3, 4, 8, ${(0.76 * vigStrength).toFixed(3)})`);
        ctx.globalAlpha = 1;
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, width, height);
      }

      ctx.restore();
    }

    const layout = frame.layout;
    if (!layout || layout.lines.length === 0) {
      const gapAccent = varIdx === 1 ? '#22d3ee' : frame.palette.accentPrimary;
      if (frame.isInstrumentalGap) {
        drawInstrumentalIndicator(ctx, frame, width, height, gapAccent);
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
      const rate = Math.min(1, Math.max(0.016, frame.deltaSeconds) * 8.0);
      this.scrollY += (targetScrollY - this.scrollY) * rate;
    }

    const manualScroll =
      typeof frame.manualScrollY === 'number' && Number.isFinite(frame.manualScrollY)
        ? frame.manualScrollY
        : 0;
    const effectiveScrollY = this.scrollY + manualScroll;
    const isBrowsing = frame.isFollowingPlayback === false || Math.abs(manualScroll) > 3;

    const focal = getFocalRect(frame, width);
    const cy = height * (varIdx === 1 ? 0.45 : 0.48);
    const fontSize = layout.fontSizePx;
    const unsyncedOrLineLevel = isUnsyncedLyrics(frame) || frame.activeWordIndex < 0;
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
      const lineCenterOffset = line.y + line.height * 0.5 - effectiveScrollY;
      const gapOffset =
        frame.isInstrumentalGap && !isBrowsing && !hasActiveLine
          ? i <= scrollIdx
            ? -58
            : 58
          : 0;
      const screenY = cy + lineCenterOffset - line.height * 0.5 + gapOffset;

      if (screenY + line.height < -60 || screenY > height + 60) continue;
      if (!isBrowsing && Math.abs(i - scrollIdx) > 2) continue;

      const isActive = hasActiveLine && i === frame.activeLineIndex;
      const isHovered = i === hoveredIdx;
      const rawLine = frame.lyrics?.lines[i];
      const resolved = rawLine ? resolveDisplayLine(rawLine, frame.scriptMode, this.id) : null;
      const secondaryText = line.secondaryText ?? resolved?.secondaryText ?? null;
      const lineBaseX = isLeftAlign ? leftPad : line.x;

      // Record hit rect in global canvas coordinates (zero allocations)
      const hitLocalX = Math.max(8, lineBaseX - 16);
      const hitW = Math.min(focal.width - hitLocalX - 8, Math.max(line.width + 32, 160));
      frame.recordHitRect?.(i, focal.left + hitLocalX, screenY - 6, hitW, line.height + 12);

      if (isHovered) {
        ctx.save();
        drawRoundedRectPath(ctx, hitLocalX, screenY - 6, hitW, line.height + 12, 12);
        ctx.fillStyle =
          varIdx === 1 ? 'rgba(244, 114, 182, 0.14)' : 'rgba(226, 232, 240, 0.09)';
        ctx.fill();
        ctx.strokeStyle = varIdx === 1 ? '#22d3ee' : frame.palette.accentPrimary;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();
      }

      if (isActive && isBrowsing) {
        // Subtle active playing line indicator while browsing
        ctx.save();
        ctx.fillStyle = varIdx === 1 ? '#f472b6' : frame.palette.accentPrimary;
        ctx.globalAlpha = 0.9;
        drawRoundedRectPath(ctx, Math.max(4, hitLocalX - 8), screenY + 4, 4, Math.max(16, line.height - 8), 2);
        ctx.fill();
        ctx.restore();
      }

      if (isActive) {
        ctx.font = `800 ${fontSize}px ${frame.fontFamily}`;
        for (let w = 0; w < line.words.length; w++) {
          const word = line.words[w];
          const wx = lineBaseX + word.x;
          const wy = screenY + word.y;
          const isWordCurrent = unsyncedOrLineLevel ? true : w === frame.activeWordIndex;
          const isWordPast = !unsyncedOrLineLevel && w < frame.activeWordIndex;

          if (isWordCurrent || isWordPast) {
            const shift = isWordCurrent ? clamp01(frame.wordProgress) * 0.28 : 0.16;
            const grad =
              varIdx === 1
                ? ctx.createLinearGradient(wx, wy, wx + Math.max(1, word.width), wy + fontSize)
                : ctx.createLinearGradient(wx, wy, wx, wy + fontSize);

            if (varIdx === 0) {
              // High-contrast liquid silver/chrome specular gradient
              grad.addColorStop(0, '#ffffff');
              grad.addColorStop(0.28 + shift * 0.25, '#f8fafc');
              grad.addColorStop(0.52, '#64748b');
              grad.addColorStop(0.76, '#ffffff');
              grad.addColorStop(1, frame.palette.accentPrimary);
            } else if (varIdx === 1) {
              // Iridescent cyan / magenta / violet holographic sheen
              grad.addColorStop(0, '#ffffff');
              grad.addColorStop(Math.max(0.14, Math.min(0.84, 0.26 + shift * 0.3)), '#67e8f9');
              grad.addColorStop(0.62, '#f0abfc');
              grad.addColorStop(0.86, '#c084fc');
              grad.addColorStop(1, '#ffffff');
            } else {
              // Mercury album-tinted liquid metallic reflection
              grad.addColorStop(0, '#ffffff');
              grad.addColorStop(0.3 + shift * 0.22, frame.palette.accentPrimary);
              grad.addColorStop(0.55, '#334155');
              grad.addColorStop(0.8, '#f8fafc');
              grad.addColorStop(1, frame.palette.accentSecondary);
            }

            ctx.save();
            ctx.globalAlpha = frame.lineFadeAlpha;
            ctx.lineWidth = 3;
            ctx.strokeStyle = varIdx === 1 ? 'rgba(9, 5, 23, 0.88)' : 'rgba(7, 9, 14, 0.88)';
            ctx.strokeText(word.text, wx, wy);
            ctx.shadowColor =
              varIdx === 1
                ? isWordCurrent
                  ? '#f472b6'
                  : '#22d3ee'
                : isWordCurrent
                ? frame.palette.accentPrimary
                : 'rgba(7, 9, 14, 0.9)';
            ctx.shadowBlur = isWordCurrent ? 18 + frame.audio.trebleEnergy * 10 : 8;
            ctx.fillStyle = grad;
            ctx.fillText(word.text, wx, wy);
            ctx.restore();
          } else {
            ctx.globalAlpha = (isHovered ? 0.72 : 0.48) * frame.lineFadeAlpha;
            ctx.fillStyle = varIdx === 1 ? '#e9d5ff' : frame.palette.textUpcoming;
            ctx.fillText(word.text, wx, wy);
          }
        }
        if (secondaryText) {
          const secFont = Math.max(12, Math.round(fontSize * 0.4));
          ctx.save();
          ctx.font = `500 ${secFont}px ${frame.fontFamily}`;
          ctx.fillStyle = varIdx === 1 ? '#e9d5ff' : frame.palette.textUpcoming;
          ctx.globalAlpha = 0.74 * frame.lineFadeAlpha;
          ctx.textAlign = isLeftAlign ? 'left' : 'center';
          ctx.fillText(
            secondaryText,
            isLeftAlign ? leftPad : focal.width * 0.5,
            screenY + line.height + 4
          );
          ctx.restore();
        }
      } else {
        const dist = Math.abs(i - scrollIdx);
        const distPixels = Math.abs(lineCenterOffset);
        const alpha = isHovered
          ? 0.82
          : Math.max(0.16, 0.52 - Math.min(dist * 0.14, (distPixels / Math.max(1, height)) * 0.55));
        const subScale = isBrowsing ? 0.88 : 0.66;
        const subFontSize = Math.max(14, Math.round(fontSize * subScale));

        ctx.save();
        ctx.font = `600 ${subFontSize}px ${frame.fontFamily}`;
        ctx.fillStyle = varIdx === 1 ? '#e9d5ff' : frame.palette.textUpcoming;
        ctx.globalAlpha = alpha;
        for (let w = 0; w < line.words.length; w++) {
          const word = line.words[w];
          ctx.fillText(word.text, lineBaseX + word.x * subScale, screenY + word.y * subScale);
        }
        ctx.restore();
      }
    }

    ctx.restore();

    if (frame.isInstrumentalGap && !isBrowsing) {
      drawInstrumentalIndicator(
        ctx,
        frame,
        width,
        height,
        varIdx === 1 ? '#22d3ee' : frame.palette.accentPrimary
      );
    }
  }
}
