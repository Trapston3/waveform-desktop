// Style: BrutalistZine
// Variations:
//  0: 'newsprint-cutout' (default) - dark newsprint halftone grain backdrop + cream cutout poster card
//  1: 'xerox-contrast'             - stark monochrome dark xerox backdrop + high-contrast black/white cutout slabs
//  2: 'accent-risograph'           - dual-ink risograph overprint card with live album accent registration
// Preallocated tiny halftone pattern canvas cached once (zero per-frame heap allocations).

import type { StyleFrameContext } from '../../core/models';
import {
  clamp01,
  drawEmptyState,
  easeOutBack,
  formatTimestamp,
  getFocalRect,
  isTransparentStage,
  isUnsyncedLyrics,
  setCanvasLetterSpacing,
  type ILyricVisualStyle,
  type StyleMeasurementSpec,
} from '../styleInterface';

export class BrutalistZineStyle implements ILyricVisualStyle {
  readonly id = 'BrutalistZine' as const;
  readonly name = 'Brutalist Zine';
  readonly webGlEffect = 'none' as const;

  private halftoneCanvas: HTMLCanvasElement | null = null;
  private halftonePattern: CanvasPattern | null = null;
  private patternInitAttempted = false;
  private scrollY = 0;
  private initialized = false;
  private beatKick = 0;

  getVariationIndex(variationId?: string): 0 | 1 | 2 {
    if (variationId === 'xerox-contrast') return 1;
    if (variationId === 'accent-risograph') return 2;
    return 0;
  }

  getMeasurementSpec(): StyleMeasurementSpec {
    return {
      fontWeight: 900,
      fontSizeMultiplier: 1.04,
      textTransform: 'uppercase',
      letterSpacing: '0.02em',
      maxLineWidthRatio: 0.78,
    };
  }

  reset(): void {
    this.scrollY = 0;
    this.initialized = false;
    this.beatKick = 0;
  }

  private getOrInitHalftonePattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
    if (this.halftonePattern) return this.halftonePattern;
    if (this.patternInitAttempted) return null;
    this.patternInitAttempted = true;

    if (
      typeof document !== 'undefined' &&
      typeof document.createElement === 'function' &&
      typeof ctx.createPattern === 'function'
    ) {
      try {
        const patCanvas = document.createElement('canvas');
        patCanvas.width = 16;
        patCanvas.height = 16;
        const pctx = patCanvas.getContext('2d');
        if (pctx) {
          pctx.fillStyle = 'rgba(255, 255, 255, 0.045)';
          pctx.beginPath();
          pctx.arc(4, 4, 1.35, 0, Math.PI * 2);
          pctx.arc(12, 12, 1.05, 0, Math.PI * 2);
          pctx.fill();
          pctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
          pctx.fillRect(8, 2, 1, 1);
          pctx.fillRect(2, 10, 1, 1);
          this.halftoneCanvas = patCanvas;
          this.halftonePattern = ctx.createPattern(patCanvas, 'repeat');
        }
      } catch {
        this.halftonePattern = null;
      }
    }
    return this.halftonePattern;
  }

  private drawCropMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
    ctx.beginPath();
    ctx.moveTo(x - size, y);
    ctx.lineTo(x + size, y);
    ctx.moveTo(x, y - size);
    ctx.lineTo(x, y + size);
    ctx.stroke();
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

    const dt = Math.max(0.001, Math.min(0.1, frame.deltaSeconds));
    if (!frame.reduceMotion && (frame.audio.beatDetected || (frame.audio.beatStrength ?? 0) > 0.72)) {
      this.beatKick = 1.0;
    } else {
      this.beatKick = Math.max(0, this.beatKick - dt * 5.5);
    }

    const focal = getFocalRect(frame, width);

    if (!isTransparent) {
      ctx.save();
      ctx.globalAlpha = bgAlpha;
      // Dark newsprint / xerox / risograph base stage
      ctx.fillStyle = varIdx === 0 ? '#0e0d0c' : varIdx === 1 ? '#060606' : '#080a10';
      ctx.fillRect(0, 0, width, height);

      // Cached halftone grain pattern (zero per-frame allocation)
      const pattern = this.getOrInitHalftonePattern(ctx);
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, width, height);
      }

      // Halftone dot matrix in top-left and bottom-right of focal stage
      ctx.fillStyle = varIdx === 1 ? '#ffffff' : frame.palette.accentSecondary;
      ctx.globalAlpha = bgAlpha * (varIdx === 1 ? 0.16 : 0.24);
      const spacing = 14;
      const dotLeft = focal.left + 26;
      for (let gx = 0; gx < 9; gx++) {
        for (let gy = 0; gy < 6; gy++) {
          const r = Math.max(1.1, 4.0 - (gx + gy) * 0.28);
          ctx.beginPath();
          ctx.arc(dotLeft + gx * spacing, 26 + gy * spacing, r, 0, Math.PI * 2);
          ctx.fill();

          ctx.beginPath();
          ctx.arc(width - 26 - gx * spacing, height - 26 - gy * spacing, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Crisp corner crop marks (+)
      ctx.strokeStyle = varIdx === 1 ? '#ffffff' : frame.palette.accentPrimary;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = bgAlpha * 0.62;
      const cropInset = 22;
      this.drawCropMark(ctx, focal.left + cropInset, cropInset, 8);
      this.drawCropMark(ctx, width - cropInset, cropInset, 8);
      this.drawCropMark(ctx, focal.left + cropInset, height - cropInset, 8);
      this.drawCropMark(ctx, width - cropInset, height - cropInset, 8);

      if (vigStrength > 0.01) {
        const vig = ctx.createRadialGradient(
          width * 0.5,
          height * 0.5,
          Math.min(width, height) * 0.28,
          width * 0.5,
          height * 0.5,
          Math.max(width, height) * 0.78
        );
        vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
        vig.addColorStop(1, `rgba(0, 0, 0, ${(0.72 * vigStrength).toFixed(3)})`);
        ctx.globalAlpha = 1;
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, width, height);
      }
      ctx.restore();
    }

    const layout = frame.layout;
    if (!layout || layout.lines.length === 0) {
      drawEmptyState(ctx, frame, width, height, 'ZINE // STANDBY');
      return;
    }

    const activeIdx = Math.max(0, Math.min(layout.lines.length - 1, frame.activeLineIndex));
    const activeLine = layout.lines[activeIdx];
    const targetScrollY = activeLine.y + activeLine.height * 0.5;

    if (!this.initialized || frame.didSeekThisFrame || frame.reduceMotion) {
      this.scrollY = targetScrollY;
      this.initialized = true;
    } else {
      const rate = Math.min(1, dt * 8.5);
      this.scrollY += (targetScrollY - this.scrollY) * rate;
    }

    const manualScroll =
      typeof frame.manualScrollY === 'number' && Number.isFinite(frame.manualScrollY)
        ? frame.manualScrollY
        : 0;
    const effectiveScrollY = this.scrollY + manualScroll;
    const isBrowsing = frame.isFollowingPlayback === false || Math.abs(manualScroll) > 3;

    const cx = focal.width * 0.5;
    const cy = height * 0.5;
    const fontSize = layout.fontSizePx;
    const unsyncedOrLineLevel = isUnsyncedLyrics(frame) || frame.activeWordIndex < 0;
    const isLeftAlign = frame.textAlign === 'left';
    const hoveredIdx = typeof frame.hoveredLineIndex === 'number' ? frame.hoveredLineIndex : -1;
    const bpmVal = Math.round(frame.trackMetadata?.bpm || frame.audio.estimatedBpm || 120);

    ctx.save();
    if (focal.left > 2) {
      ctx.beginPath();
      ctx.rect(focal.left, 0, Math.max(1, width - focal.left), height);
      ctx.clip();
    }
    if (focal.left > 0) {
      ctx.translate(focal.left, 0);
    }

    for (let i = 0; i < layout.lines.length; i++) {
      const line = layout.lines[i];
      const lineCenterOffset = line.y + line.height * 0.5 - effectiveScrollY;
      const cardCenterY = cy + lineCenterOffset * 1.15;

      if (cardCenterY + line.height < -90 || cardCenterY - line.height > height + 90) continue;
      if (!isBrowsing && i !== activeIdx) continue;

      const isActive = i === activeIdx;
      const isHovered = i === hoveredIdx;
      const cardPadX = 32;
      const cardPadY = 24;
      const cardW = Math.min(focal.width * 0.88, Math.max(260, line.width + cardPadX * 2));
      const cardH = line.height + cardPadY * 2;
      const cardX = isLeftAlign ? Math.max(24, focal.width * 0.06) : cx - cardW * 0.5;
      const cardY = cardCenterY - cardH * 0.5;

      frame.recordHitRect?.(i, focal.left + cardX - 8, cardY - 12, cardW + 24, cardH + 28);

      const tiltSign = i % 2 === 0 ? -1 : 1;
      const tilt = frame.reduceMotion
        ? 0
        : tiltSign * (isActive ? 0.028 : 0.015) + (isActive ? this.beatKick * 0.014 * tiltSign : 0);
      const kickScale =
        isActive && !frame.reduceMotion ? 1.0 + this.beatKick * 0.024 : isActive ? 1.0 : 0.92;

      ctx.save();
      const pivotX = cardX + cardW * 0.5;
      ctx.translate(pivotX, cardCenterY);
      ctx.rotate(tilt);
      ctx.scale(kickScale, kickScale);
      ctx.translate(-pivotX, -cardCenterY);

      ctx.globalAlpha = isActive ? 1.0 : isHovered ? 0.86 : 0.55;

      // Hard offset brutalist shadow block
      ctx.fillStyle =
        varIdx === 1
          ? '#ffffff'
          : varIdx === 2
          ? frame.palette.accentSecondary
          : frame.palette.accentPrimary;
      ctx.fillRect(cardX + 10, cardY + 10, cardW, cardH);

      if (varIdx === 2) {
        // Risograph second ink offset layer
        ctx.fillStyle = frame.palette.accentPrimary;
        ctx.fillRect(cardX - 5, cardY + 5, cardW, cardH);
      }

      // Main high-contrast poster card
      const cardFill = isTransparent
        ? 'rgba(14, 14, 14, 0.9)'
        : varIdx === 0
        ? '#f4f1ea'
        : varIdx === 1
        ? '#0b0b0b'
        : '#111420';
      ctx.fillStyle = cardFill;
      ctx.fillRect(cardX, cardY, cardW, cardH);

      ctx.lineWidth = isHovered ? 4.5 : 3.5;
      ctx.strokeStyle =
        isHovered
          ? frame.palette.accentPrimary
          : varIdx === 0 && !isTransparent
          ? '#090909'
          : '#f4f1ea';
      ctx.strokeRect(cardX, cardY, cardW, cardH);

      // Deterministic masking-tape / torn-paper accent strips on corners
      const tapeMode = i % 3;
      ctx.save();
      ctx.fillStyle =
        varIdx === 1 ? 'rgba(255, 255, 255, 0.85)' : 'rgba(238, 224, 188, 0.78)';
      const tapeX = tapeMode === 0 ? cardX - 10 : cardX + cardW - 58;
      const tapeY = cardY - 8;
      ctx.translate(tapeX + 34, tapeY + 8);
      ctx.rotate(tapeMode === 0 ? -0.18 : 0.21);
      ctx.fillRect(-34, -8, 68, 16);
      ctx.restore();

      // Dynamic ISSUE #NN + track metadata stamps (BPM, SIDE A, live timecode MM:SS)
      ctx.fillStyle = varIdx === 1 ? '#ffffff' : '#090909';
      ctx.fillRect(cardX + 14, cardY - 16, 118, 22);
      ctx.font = `700 11px "JetBrains Mono", monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = varIdx === 1 ? '#090909' : '#ffffff';
      ctx.fillText(`ISSUE #${String(i + 1).padStart(2, '0')}`, cardX + 22, cardY - 5);

      const stampText = `SIDE A // ${bpmVal} BPM // ${formatTimestamp(frame.timeSeconds)}`;
      const stampW = Math.min(cardW - 144, 210);
      if (stampW > 90) {
        ctx.fillStyle = frame.palette.accentPrimary;
        ctx.fillRect(cardX + cardW - stampW - 12, cardY - 16, stampW, 22);
        ctx.fillStyle = '#090909';
        ctx.textAlign = 'right';
        ctx.fillText(stampText, cardX + cardW - 20, cardY - 5);
      }

      // Bold uppercase words matching exact LyricsMeasurer spec (fontWeight 900 + uppercase + 0.02em)
      ctx.font = `900 ${fontSize}px ${frame.fontFamily}`;
      setCanvasLetterSpacing(ctx, '0.02em');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const textStartX = isLeftAlign ? cardX + cardPadX : cardX + (cardW - line.width) * 0.5;
      const textStartY = cardY + cardPadY;

      for (let w = 0; w < line.words.length; w++) {
        const word = line.words[w];
        const upper = word.text.toUpperCase();
        const wx = textStartX + word.x;
        const wy = textStartY + word.y;
        const isCurrent = isActive && !unsyncedOrLineLevel && w === frame.activeWordIndex;
        const isPast = isActive && (unsyncedOrLineLevel || w < frame.activeWordIndex);

        if (isCurrent) {
          // Staggered cutout highlight block behind active word with kinetic stamp-in spring physics
          const stampSpring = frame.reduceMotion
            ? 1.0
            : easeOutBack(Math.min(1, 0.25 + clamp01(frame.wordProgress) * 1.15));
          const staggerTilt = frame.reduceMotion ? 0 : ((w % 2 === 0 ? -1 : 1) * 0.025);

          ctx.save();
          const wcx = wx + word.width * 0.5;
          const wcy = wy + fontSize * 0.5;
          ctx.translate(wcx, wcy);
          ctx.rotate(staggerTilt);
          ctx.scale(stampSpring, stampSpring);
          ctx.translate(-wcx, -wcy);

          ctx.fillStyle = frame.palette.accentSecondary;
          ctx.fillRect(wx - 5, wy - 2, word.width + 14, fontSize + 10);
          ctx.fillStyle = '#090909';
          ctx.fillRect(wx - 8, wy - 5, word.width + 16, fontSize + 10);
          ctx.fillStyle = frame.palette.accentPrimary;
          ctx.fillText(upper, wx, wy);
          ctx.restore();
        } else {
          const isDarkCard = isTransparent || varIdx === 1 || varIdx === 2;
          ctx.fillStyle = isDarkCard
            ? isPast
              ? '#ffffff'
              : 'rgba(255, 255, 255, 0.56)'
            : isPast
            ? '#090909'
            : 'rgba(9, 9, 9, 0.5)';
          ctx.fillText(upper, wx, wy);
        }
      }

      setCanvasLetterSpacing(ctx, '0px');
      ctx.restore();
    }

    ctx.restore();
  }
}
