// Style: TypewriterEditorial
// Variations:
//  0: 'dark-slate' (default) - nocturnal literary slate surface with silver-ivory serif ink
//  1: 'warm-ink'             - warm dark-editorial manuscript surface with parchment ink & ledger rules

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

function resolveSerifFamily(fontFamily: string): string {
  return fontFamily.includes('serif')
    ? fontFamily
    : `"Instrument Serif", Fraunces, ${fontFamily}`;
}

export class TypewriterEditorialStyle implements ILyricVisualStyle {
  readonly id = 'TypewriterEditorial' as const;
  readonly name = 'Typewriter Editorial';
  readonly webGlEffect = 'none' as const;

  private scrollY = 0;
  private initialized = false;
  private lastKnownActiveIdx = -1;

  getVariationIndex(variationId?: string): 0 | 1 {
    return variationId === 'warm-ink' ? 1 : 0;
  }

  getMeasurementSpec(frame: StyleFrameContext): StyleMeasurementSpec {
    return {
      fontWeight: 600,
      fontSizeMultiplier: 1.06,
      fontFamilyOverride: resolveSerifFamily(frame.fontFamily),
      maxLineWidthRatio: 0.76,
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
    const marginX = Math.max(36, Math.round(focal.width * 0.1));
    const globalLeftMargin = focal.left + marginX;

    const bgAlpha =
      typeof frame.backgroundOpacity === 'number' && Number.isFinite(frame.backgroundOpacity)
        ? clamp01(frame.backgroundOpacity)
        : 0.95;
    const vigStrength =
      typeof frame.vignetteStrength === 'number' && Number.isFinite(frame.vignetteStrength)
        ? clamp01(frame.vignetteStrength)
        : 0.55;

    // Dark-slate or warm-ink editorial paper surface & subtle margin rules
    if (!isTransparent) {
      ctx.save();
      ctx.globalAlpha = bgAlpha;
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      if (varIdx === 0) {
        bg.addColorStop(0, '#0b0e14');
        bg.addColorStop(1, '#111622');
      } else {
        bg.addColorStop(0, '#161311');
        bg.addColorStop(1, '#1e1915');
      }
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle =
        varIdx === 0 ? 'rgba(203, 213, 225, 0.065)' : 'rgba(244, 232, 212, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      // Omit hard vertical margin rule at focal.left when split-view inset is active
      if (focal.left <= 2) {
        ctx.moveTo(globalLeftMargin, 24);
        ctx.lineTo(globalLeftMargin, height - 24);
      }
      ctx.moveTo(width - marginX, 24);
      ctx.lineTo(width - marginX, height - 24);
      const ruleStart = focal.left > 2 ? marginX : globalLeftMargin;
      const ruleStep = 44;
      for (let y = 64; y < height - 40; y += ruleStep) {
        ctx.moveTo(ruleStart, y);
        ctx.lineTo(width - marginX, y);
      }
      ctx.stroke();

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
        vig.addColorStop(1, `rgba(4, 5, 8, ${(0.72 * vigStrength).toFixed(3)})`);
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
        drawEmptyState(ctx, frame, width, height, 'Awaiting manuscript...');
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

    const serifFamily = resolveSerifFamily(frame.fontFamily);
    const fontSize = layout.fontSizePx;
    const focalMarginX = focal.left > 0 ? Math.max(20, Math.round(focal.width * 0.08)) : marginX;
    const leftContentX = focalMarginX + 20;
    const centerY = height * 0.48;
    const unsyncedOrLineLevel = isUnsyncedLyrics(frame) || frame.activeWordIndex < 0;
    const isCenterAlign = frame.textAlign === 'center';
    const hoveredIdx = typeof frame.hoveredLineIndex === 'number' ? frame.hoveredLineIndex : -1;

    const inkBright = varIdx === 0 ? '#f8fafc' : '#fff9ee';
    const inkPast = varIdx === 0 ? '#e2e8f0' : '#faf3e6';
    const inkGhost = varIdx === 0 ? '#94a3b8' : '#d7cab8';

    ctx.save();
    if (focal.left > 0) {
      ctx.translate(focal.left, 0);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // Editorial folio header
    ctx.font = `500 12px "JetBrains Mono", monospace`;
    ctx.fillStyle = frame.palette.accentPrimary;
    ctx.globalAlpha = 0.76;
    const folioTag = varIdx === 0 ? 'FOLIO // SLATE' : 'FOLIO // WARM-INK';
    const lineNumLabel = hasActiveLine ? String(scrollIdx + 1).padStart(2, '0') : '--';
    ctx.fillText(
      `${folioTag}  ·  LINE ${lineNumLabel}  /  ${formatTimestamp(activeLine.startSeconds)}`,
      leftContentX,
      Math.max(26, height * 0.12)
    );

    const showInstrumental = Boolean(frame.isInstrumentalGap || activeLineIsBlank);
    for (let i = 0; i < layout.lines.length; i++) {
      const line = layout.lines[i];
      if (isLineBlank(i)) continue;
      const lineCenterOffset = line.y + line.height * 0.5 - effectiveScrollY;
      const gapOffset =
        showInstrumental && !isBrowsing && !hasActiveLine
          ? i <= scrollIdx
            ? -58
            : 58
          : 0;
      const screenY = centerY + lineCenterOffset - line.height * 0.5 + gapOffset;

      if (screenY + line.height < -60 || screenY > height + 60) continue;
      if (!isBrowsing && Math.abs(i - scrollIdx) > 1) continue;

      const isActive = hasActiveLine && i === frame.activeLineIndex;
      const isHovered = i === hoveredIdx;
      const rawLine = frame.lyrics?.lines[i];
      const resolved = rawLine ? resolveDisplayLine(rawLine, frame.scriptMode, this.id) : null;
      const secondaryText = line.secondaryText ?? resolved?.secondaryText ?? null;
      const lineBaseX = isCenterAlign ? Math.max(leftContentX, line.x) : leftContentX;

      const hitLocalX = Math.max(12, lineBaseX - 16);
      const hitW = Math.min(focal.width - hitLocalX - 12, Math.max(line.width + 32, 180));
      frame.recordHitRect?.(i, focal.left + hitLocalX, screenY - 6, hitW, line.height + 12);

      if (isHovered) {
        ctx.save();
        drawRoundedRectPath(ctx, hitLocalX, screenY - 6, hitW, line.height + 12, 8);
        ctx.fillStyle =
          varIdx === 0 ? 'rgba(148, 163, 184, 0.1)' : 'rgba(244, 232, 212, 0.09)';
        ctx.fill();
        ctx.strokeStyle = frame.palette.accentPrimary;
        ctx.globalAlpha = 0.42;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }

      if (isActive) {
        ctx.font = `600 ${fontSize}px ${serifFamily}`;
        let cursorX = lineBaseX;
        let cursorY = screenY;

        for (let w = 0; w < line.words.length; w++) {
          const word = line.words[w];
          const wx = lineBaseX + word.x;
          const wy = screenY + word.y;

          if (unsyncedOrLineLevel || w < frame.activeWordIndex) {
            ctx.globalAlpha = 0.96 * frame.lineFadeAlpha;
            ctx.fillStyle = inkPast;
            ctx.fillText(word.text, wx, wy);
            cursorX = wx + word.width + 6;
            cursorY = wy;
          } else if (w === frame.activeWordIndex) {
            const p = clamp01(frame.wordProgress);
            let revealed = word.text;
            if (p < 0.999) {
              const chars = [...word.text];
              const charCount = Math.max(1, Math.ceil(chars.length * Math.max(0.15, p)));
              revealed = chars.slice(0, charCount).join('');
            }
            ctx.globalAlpha = frame.lineFadeAlpha;
            ctx.fillStyle = inkBright;
            ctx.fillText(revealed, wx, wy);

            const revealedW = ctx.measureText(revealed).width || word.width * p;
            cursorX = wx + revealedW + 3;
            cursorY = wy;
          } else {
            ctx.globalAlpha = (isHovered ? 0.48 : 0.28) * frame.lineFadeAlpha;
            ctx.fillStyle = inkGhost;
            ctx.fillText(word.text, wx, wy);
          }
        }

        // Crisp animated typewriter cursor
        const blinkOn = frame.reduceMotion || Math.sin(frame.timeSeconds * 7.5) >= -0.2;
        if (blinkOn) {
          ctx.globalAlpha = 0.92;
          ctx.fillStyle = frame.palette.accentPrimary;
          ctx.fillRect(cursorX, cursorY + 4, 3, Math.max(18, fontSize * 0.95));
        }

        if (secondaryText) {
          const secFont = Math.max(12, Math.round(fontSize * 0.42));
          ctx.save();
          ctx.font = `400 italic ${secFont}px ${serifFamily}`;
          ctx.fillStyle = inkGhost;
          ctx.globalAlpha = 0.78 * frame.lineFadeAlpha;
          ctx.fillText(secondaryText, lineBaseX, screenY + line.height + 4);
          ctx.restore();
        }
      } else {
        const subScale = isBrowsing ? 0.85 : 0.66;
        const subFont = Math.max(14, Math.round(fontSize * subScale));
        ctx.save();
        ctx.font = `400 ${subFont}px ${serifFamily}`;
        ctx.fillStyle = inkGhost;
        ctx.globalAlpha = isHovered ? 0.78 : 0.36;
        for (let w = 0; w < line.words.length; w++) {
          const word = line.words[w];
          ctx.fillText(word.text, lineBaseX + word.x * subScale, screenY + word.y * subScale);
        }
        ctx.restore();
      }
    }

    ctx.restore();

    if (showInstrumental && !isBrowsing) {
      drawInstrumentalIndicator(ctx, frame, width, height, frame.palette.accentPrimary);
    }
  }
}
