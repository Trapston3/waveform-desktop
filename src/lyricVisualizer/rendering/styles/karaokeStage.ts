// Style: KaraokeStage
// Variations:
//  0: 'concert-gold' (default) - warm concert stage spotlight + gold/accent word fill-wipe
//  1: 'club-neon'              - deep club stage with dual neon spotlight cones & electric fill-wipe

import type { StyleFrameContext } from '../../core/models';
import {
  clamp01,
  drawEmptyState,
  drawInstrumentalIndicator,
  drawRoundedRectPath,
  easeOutBack,
  getFocalRect,
  isTransparentStage,
  isUnsyncedLyrics,
  resolveDisplayLine,
  type ILyricVisualStyle,
  type StyleMeasurementSpec,
} from '../styleInterface';

export class KaraokeStageStyle implements ILyricVisualStyle {
  readonly id = 'KaraokeStage' as const;
  readonly name = 'Karaoke Stage';
  readonly webGlEffect = 'none' as const;

  private scrollY = 0;
  private initialized = false;
  private lastKnownActiveIdx = -1;

  getVariationIndex(variationId?: string): 0 | 1 {
    return variationId === 'club-neon' ? 1 : 0;
  }

  getMeasurementSpec(frame?: StyleFrameContext): StyleMeasurementSpec {
    return {
      fontWeight: 800,
      fontSizeMultiplier: 1.12,
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

    const fillAccent = varIdx === 0 ? frame.palette.accentPrimary : '#22d3ee';
    const secondaryAccent = varIdx === 0 ? '#fbbf24' : '#f472b6';

    if (!isTransparent) {
      ctx.save();
      ctx.globalAlpha = bgAlpha;
      const bg = ctx.createRadialGradient(
        width * 0.5,
        height * 0.25,
        20,
        width * 0.5,
        height * 0.55,
        Math.max(width, height) * 0.85
      );
      if (varIdx === 1) {
        bg.addColorStop(0, '#110a26');
        bg.addColorStop(0.6, '#070512');
        bg.addColorStop(1, '#040309');
      } else {
        bg.addColorStop(0, frame.palette.bgMid);
        bg.addColorStop(0.65, frame.palette.bgDeep);
        bg.addColorStop(1, '#06070c');
      }
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      if (varIdx === 1) {
        // Club Neon dual stage spotlight cones
        const sway = frame.reduceMotion ? 0 : Math.sin(frame.timeSeconds * 0.9) * width * 0.06;
        const cone = ctx.createRadialGradient(
          width * 0.35 + sway,
          height * 0.15,
          10,
          width * 0.5,
          height * 0.5,
          Math.max(width, height) * 0.55
        );
        cone.addColorStop(0, 'rgba(34, 211, 238, 0.16)');
        cone.addColorStop(0.5, 'rgba(244, 114, 182, 0.1)');
        cone.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = cone;
        ctx.fillRect(0, 0, width, height);
      }

      if (vigStrength > 0.01) {
        const vig = ctx.createRadialGradient(
          width * 0.5,
          height * 0.48,
          Math.min(width, height) * 0.26,
          width * 0.5,
          height * 0.5,
          Math.max(width, height) * 0.78
        );
        vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
        vig.addColorStop(1, `rgba(2, 3, 7, ${(0.75 * vigStrength).toFixed(3)})`);
        ctx.globalAlpha = 1;
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, width, height);
      }
      ctx.restore();
    }

    const layout = frame.layout;
    if (!layout || layout.lines.length === 0) {
      if (frame.isInstrumentalGap) {
        drawInstrumentalIndicator(ctx, frame, width, height, fillAccent);
      } else {
        drawEmptyState(ctx, frame, width, height, 'Ready for stage cue');
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

    if (frame.isInstrumentalGap && !isBrowsing && !hasActiveLine) {
      drawInstrumentalIndicator(ctx, frame, width, height, fillAccent);
      return;
    }

    const focal = getFocalRect(frame, width);
    const focalWidth = focal.width;
    const cx = focalWidth * 0.5;
    const cy = height * 0.45;
    const fontSize = layout.fontSizePx;
    const unsyncedOrLineLevel = isUnsyncedLyrics(frame) || frame.activeWordIndex < 0;
    const isLeftAlign = frame.textAlign === 'left';
    const leftPad = Math.max(28, Math.round(focalWidth * 0.08));
    const hoveredIdx = typeof frame.hoveredLineIndex === 'number' ? frame.hoveredLineIndex : -1;

    ctx.save();
    if (focal.left > 0) {
      ctx.translate(focal.left, 0);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    const totalWords = Math.max(1, activeLine.words.length);
    const overallLineProgress = clamp01(
      (Math.max(0, frame.activeWordIndex) + clamp01(frame.wordProgress)) / totalWords
    );
    const activeRawLine = frame.lyrics?.lines[scrollIdx];
    const activeResolved = activeRawLine
      ? resolveDisplayLine(activeRawLine, frame.scriptMode, this.id)
      : null;
    const activeSecText = activeLine.secondaryText ?? activeResolved?.secondaryText ?? null;

    for (let i = 0; i < layout.lines.length; i++) {
      const line = layout.lines[i];
      const lineCenterOffset = line.y + line.height * 0.5 - effectiveScrollY;
      const startY = cy + lineCenterOffset - line.height * 0.5;

      if (startY + line.height < -60 || startY > height + 60) continue;
      if (!isBrowsing && i !== scrollIdx && i !== scrollIdx + 1) continue;

      const isActive = hasActiveLine && i === frame.activeLineIndex;
      const isHovered = i === hoveredIdx;
      const lineBaseX = isLeftAlign ? leftPad : line.x;
      const rawLine = frame.lyrics?.lines[i];
      const resolved = rawLine ? resolveDisplayLine(rawLine, frame.scriptMode, this.id) : null;
      const secondaryText = line.secondaryText ?? resolved?.secondaryText ?? null;

      if (isActive) {
        const hitLocalX = Math.max(8, lineBaseX - 18);
        const hitW = Math.min(focalWidth - hitLocalX - 8, Math.max(line.width + 36, 180));
        frame.recordHitRect?.(i, focal.left + hitLocalX, startY - 8, hitW, line.height + 16);

        if (isHovered) {
          ctx.save();
          drawRoundedRectPath(ctx, hitLocalX, startY - 8, hitW, line.height + 16, 12);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.09)';
          ctx.fill();
          ctx.strokeStyle = fillAccent;
          ctx.globalAlpha = 0.45;
          ctx.lineWidth = 1.3;
          ctx.stroke();
          ctx.restore();
        }

        ctx.font = `800 ${fontSize}px ${frame.fontFamily}`;
        for (let w = 0; w < line.words.length; w++) {
          const word = line.words[w];
          const wx = lineBaseX + word.x;
          const isWordActive = w === frame.activeWordIndex;
          const isWordPast = w < frame.activeWordIndex;

          const bounceY =
            isWordActive && !frame.reduceMotion
              ? -8 *
                Math.sin(clamp01(frame.wordProgress) * Math.PI) *
                easeOutBack(Math.min(1, frame.wordProgress * 1.4))
              : 0;
          const wy = startY + word.y + bounceY;

          ctx.lineWidth = 4;
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.78)';
          ctx.strokeText(word.text, wx, wy);

          if (unsyncedOrLineLevel) {
            ctx.fillStyle = '#ffffff';
            ctx.fillText(word.text, wx, wy);
          } else if (isWordPast) {
            ctx.fillStyle = fillAccent;
            ctx.fillText(word.text, wx, wy);
          } else if (isWordActive) {
            const p = clamp01(frame.wordProgress);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(word.text, wx, wy);

            ctx.save();
            ctx.beginPath();
            ctx.rect(wx - 4, wy - 10, (word.width + 8) * p, word.height + 24);
            ctx.clip();
            ctx.fillStyle = fillAccent;
            ctx.shadowColor = secondaryAccent;
            ctx.shadowBlur = 16;
            ctx.fillText(word.text, wx, wy);
            ctx.restore();
          } else {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.52)';
            ctx.fillText(word.text, wx, wy);
          }
        }

        if (secondaryText) {
          const secFont = Math.max(12, Math.round(fontSize * 0.38));
          ctx.save();
          ctx.font = `500 ${secFont}px ${frame.fontFamily}`;
          ctx.fillStyle = frame.palette.textUpcoming;
          ctx.globalAlpha = 0.76 * frame.lineFadeAlpha;
          ctx.textAlign = isLeftAlign ? 'left' : 'center';
          ctx.fillText(
            secondaryText,
            isLeftAlign ? leftPad : cx,
            startY + line.height + 4
          );
          ctx.restore();
        }

        // Crisp horizontal line progress bar
        const secBarOffset = secondaryText ? 22 : 0;
        const barW = Math.min(focalWidth * 0.56, Math.max(180, line.width));
        const barH = 5;
        const barX = isLeftAlign ? leftPad : cx - barW * 0.5;
        const barY = startY + line.height + 20 + secBarOffset;

        drawRoundedRectPath(ctx, barX, barY, barW, barH, 3);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.fill();

        drawRoundedRectPath(ctx, barX, barY, Math.max(6, barW * overallLineProgress), barH, 3);
        ctx.fillStyle = fillAccent;
        ctx.fill();
      } else if (!isBrowsing && i === scrollIdx + 1) {
        // Upcoming line preview pill
        const pillFont = Math.max(13, Math.round(fontSize * 0.44));
        ctx.font = `600 ${pillFont}px ${frame.fontFamily}`;
        const label = `NEXT  ${line.text || resolved?.primaryText || ''}`;
        const labelW = Math.min(
          focalWidth * 0.78,
          (ctx.measureText(label).width || label.length * pillFont * 0.55) + 34
        );
        const pillH = pillFont + 18;
        const pillX = isLeftAlign ? leftPad : cx - labelW * 0.5;
        const activeStartY =
          cy + (activeLine.y + activeLine.height * 0.5 - effectiveScrollY) - activeLine.height * 0.5;
        const pillY = activeStartY + activeLine.height + 46 + (activeSecText ? 22 : 0);

        frame.recordHitRect?.(i, focal.left + pillX, pillY, labelW, pillH);

        drawRoundedRectPath(ctx, pillX, pillY, labelW, pillH, pillH * 0.5);
        ctx.fillStyle = isHovered
          ? 'rgba(255, 255, 255, 0.16)'
          : isTransparent
          ? 'rgba(10, 12, 18, 0.65)'
          : 'rgba(255, 255, 255, 0.08)';
        ctx.fill();
        ctx.strokeStyle = isHovered ? fillAccent : 'rgba(255, 255, 255, 0.18)';
        ctx.lineWidth = isHovered ? 1.4 : 1;
        ctx.stroke();

        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = isHovered ? '#ffffff' : frame.palette.textUpcoming;
        ctx.globalAlpha = isHovered ? 0.96 : 0.88;
        ctx.fillText(label, pillX + labelW * 0.5, pillY + pillH * 0.5);
        ctx.restore();
      } else {
        // Scrolled line in Browse Mode
        const hitLocalX = Math.max(8, lineBaseX - 16);
        const hitW = Math.min(focalWidth - hitLocalX - 8, Math.max(line.width + 32, 160));
        frame.recordHitRect?.(i, focal.left + hitLocalX, startY - 6, hitW, line.height + 12);

        if (isHovered) {
          ctx.save();
          drawRoundedRectPath(ctx, hitLocalX, startY - 6, hitW, line.height + 12, 10);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.09)';
          ctx.fill();
          ctx.strokeStyle = fillAccent;
          ctx.globalAlpha = 0.45;
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.restore();
        }

        const subScale = 0.82;
        const subFont = Math.max(14, Math.round(fontSize * subScale));
        ctx.save();
        ctx.font = `700 ${subFont}px ${frame.fontFamily}`;
        ctx.fillStyle = isHovered ? '#ffffff' : frame.palette.textUpcoming;
        ctx.globalAlpha = isHovered ? 0.85 : 0.45;
        for (let w = 0; w < line.words.length; w++) {
          const word = line.words[w];
          ctx.fillText(word.text, lineBaseX + word.x * subScale, startY + word.y * subScale);
        }
        ctx.restore();
      }
    }

    ctx.restore();

    if (frame.isInstrumentalGap && !isBrowsing) {
      drawInstrumentalIndicator(ctx, frame, width, height, fillAccent);
    }
  }
}
