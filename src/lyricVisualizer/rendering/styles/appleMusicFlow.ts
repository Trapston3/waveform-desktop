// Style 1: AppleMusicFlow (Classic Flow + Karaoke Stage consolidated)
// Variations:
//  0: 'classic-flow' (default) - lush atmospheric radial bloom + glowing word gradient sweep
//  1: 'karaoke-stage'          - high-contrast live stage bounce with word fill-wipe & next-line pill

import type { StyleFrameContext } from '../../core/models';
import { isBlankOrInstrumentalLineText } from '../../core/lrcParser';
import {
  clamp01,
  drawEmptyState,
  drawInstrumentalIndicator,
  drawRoundedRectPath,
  easeOutBack,
  easeOutCubic,
  getFocalRect,
  isTransparentStage,
  isUnsyncedLyrics,
  resolveDisplayLine,
  type ILyricVisualStyle,
  type StyleMeasurementSpec,
} from '../styleInterface';
import { detectMagicWordEffect } from '../lyricSemantics';
import {
  drawInlineWordIconPop,
  drawSemanticWordMicroFx,
  resolveWordIcon,
} from '../wordIconDictionary';

export class AppleMusicFlowStyle implements ILyricVisualStyle {
  readonly id = 'AppleMusicFlow' as const;
  readonly name = 'Atmospheric Flow';
  readonly webGlEffect = 'ambientFlow' as const;

  private scrollY = 0;
  private initialized = false;
  private lastKnownActiveIdx = -1;

  getVariationIndex(variationId?: string): 0 | 1 {
    if (
      variationId === 'karaoke-stage' ||
      variationId === 'concert-gold' ||
      variationId === 'club-neon'
    ) {
      return 1;
    }
    return 0;
  }

  getWebGlEffect(frame: StyleFrameContext): 'ambientFlow' | 'none' {
    return this.getVariationIndex(frame.variationId) === 1 ? 'none' : 'ambientFlow';
  }

  getMeasurementSpec(frame?: StyleFrameContext): StyleMeasurementSpec {
    const varIdx = this.getVariationIndex(frame?.variationId);
    if (varIdx === 1) {
      return {
        fontWeight: 800,
        fontSizeMultiplier: 1.12,
        maxLineWidthRatio: 0.82,
        scriptMode: frame?.scriptMode ?? 'auto',
        styleId: this.id,
      };
    }
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
    const varIdx = this.getVariationIndex(frame.variationId);
    const iconsEnabled = frame.wordIconsEnabled !== false;
    const motionScale = frame.reduceMotion
      ? 0
      : frame.motionIntensity === 'vivid'
      ? 1.3
      : frame.motionIntensity === 'subtle'
      ? 0.55
      : 1.0;

    if (varIdx === 1) {
      this.renderKaraokeStage(ctx, frame, width, height, iconsEnabled, motionScale);
      return;
    }
    this.renderClassicFlow(ctx, frame, width, height, iconsEnabled, motionScale);
  }

  private renderClassicFlow(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    width: number,
    height: number,
    iconsEnabled: boolean,
    motionScale: number
  ): void {
    const isTransparent = isTransparentStage(frame);
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
      const bg = ctx.createLinearGradient(0, 0, width * 0.4, height);
      bg.addColorStop(0, frame.palette.bgDeep);
      bg.addColorStop(0.55, frame.palette.bgMid);
      bg.addColorStop(1, frame.palette.bgDeep);
      ctx.globalAlpha = 0.76 * bgAlpha;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      const breath = frame.reduceMotion ? 0 : Math.sin(frame.timeSeconds * 0.7) * 0.08;
      const cx = width * (0.5 + breath);
      const cy = height * 0.44;
      const rad = Math.max(width, height) * (0.48 + frame.audio.bassEnergy * 0.14);
      const bloom = ctx.createRadialGradient(cx, cy, 10, cx, cy, rad);
      bloom.addColorStop(0, frame.palette.accentPrimary);
      bloom.addColorStop(0.55, frame.palette.accentSecondary);
      bloom.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = (0.16 + frame.audio.rmsLevel * 0.14) * bgAlpha;
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

      ctx.font = `${isActive ? 700 : 600} ${fontSize}px ${frame.fontFamily}`;

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
          const wx = lineBaseX + word.x;
          const wy = screenY + word.y;
          ctx.fillText(word.text, wx, wy);
          if (isActive && iconsEnabled) {
            const iconId = resolveWordIcon(word.text, line.text);
            if (iconId) {
              drawInlineWordIconPop(
                ctx,
                iconId,
                wx,
                wy,
                word.width,
                word.height,
                frame.palette.accentPrimary,
                1.0,
                true,
                frame.reduceMotion
              );
            }
          }
        }
      } else {
        for (let w = 0; w < line.words.length; w++) {
          const word = line.words[w];
          const wx = lineBaseX + word.x;
          const wy = screenY + word.y;

          const isWordPassed = w < frame.activeWordIndex;
          const isWordActive = w === frame.activeWordIndex;
          const lift =
            isWordActive && !frame.reduceMotion
              ? -4.5 * easeOutCubic(frame.wordProgress)
              : isWordPassed && !frame.reduceMotion
              ? -1.5
              : 0;

          if (isWordPassed) {
            ctx.globalAlpha = 0.96 * frame.lineFadeAlpha;
            ctx.fillStyle = frame.palette.textActive;
            ctx.shadowColor = frame.palette.accentPrimary;
            ctx.shadowBlur = 10;
            ctx.fillText(word.text, wx, wy + lift);
          } else if (isWordActive) {
            const p = clamp01(frame.wordProgress);
            ctx.globalAlpha = 0.42 * frame.lineFadeAlpha;
            ctx.shadowBlur = 0;
            ctx.fillStyle = frame.palette.textUpcoming;
            ctx.fillText(word.text, wx, wy + lift);

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
            ctx.shadowBlur = 16 + frame.audio.rmsLevel * 10;
            ctx.fillText(word.text, wx, wy + lift);
            ctx.restore();

            const magic = detectMagicWordEffect(word.text);
            if (magic) {
              drawSemanticWordMicroFx(
                ctx,
                magic,
                wx,
                wy + lift,
                word.width,
                word.height,
                frame.timeSeconds,
                frame.palette.accentPrimary,
                frame.palette.accentSecondary,
                motionScale
              );
            }
          } else {
            ctx.globalAlpha = 0.38 * frame.lineFadeAlpha;
            ctx.shadowBlur = 0;
            ctx.fillStyle = frame.palette.textUpcoming;
            ctx.fillText(word.text, wx, wy);
          }

          if (iconsEnabled && (isWordActive || isWordPassed)) {
            const iconId = resolveWordIcon(word.text, line.text);
            if (iconId) {
              drawInlineWordIconPop(
                ctx,
                iconId,
                wx,
                wy + lift,
                word.width,
                word.height,
                isWordActive ? frame.palette.accentPrimary : frame.palette.textActive,
                frame.wordProgress,
                isWordActive,
                frame.reduceMotion
              );
            }
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

    if (showInstrumental && !isBrowsing) {
      drawInstrumentalIndicator(ctx, frame, width, height, frame.palette.accentPrimary);
    }
  }

  private renderKaraokeStage(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    width: number,
    height: number,
    iconsEnabled: boolean,
    motionScale: number
  ): void {
    const isTransparent = isTransparentStage(frame);
    const bgAlpha =
      typeof frame.backgroundOpacity === 'number' && Number.isFinite(frame.backgroundOpacity)
        ? clamp01(frame.backgroundOpacity)
        : 0.95;
    const vigStrength =
      typeof frame.vignetteStrength === 'number' && Number.isFinite(frame.vignetteStrength)
        ? clamp01(frame.vignetteStrength)
        : 0.55;

    const fillAccent = frame.palette.accentPrimary;
    const secondaryAccent = frame.palette.accentSecondary || '#fbbf24';

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
      bg.addColorStop(0, frame.palette.bgMid);
      bg.addColorStop(0.65, frame.palette.bgDeep);
      bg.addColorStop(1, '#06070c');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

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
      drawInstrumentalIndicator(ctx, frame, width, height, fillAccent);
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

    if ((frame.isInstrumentalGap || activeLineIsBlank) && !isBrowsing && !hasActiveLine) {
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

    let nextNonBlankIdx = -1;
    for (let n = scrollIdx + 1; n < layout.lines.length; n++) {
      if (!isLineBlank(n)) {
        nextNonBlankIdx = n;
        break;
      }
    }

    for (let i = 0; i < layout.lines.length; i++) {
      const line = layout.lines[i];
      if (isLineBlank(i)) continue;
      const lineCenterOffset = line.y + line.height * 0.5 - effectiveScrollY;
      const startY = cy + lineCenterOffset - line.height * 0.5;

      if (startY + line.height < -60 || startY > height + 60) continue;
      if (!isBrowsing && i !== scrollIdx && i !== nextNonBlankIdx) continue;

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

            const magic = detectMagicWordEffect(word.text);
            if (magic) {
              drawSemanticWordMicroFx(
                ctx,
                magic,
                wx,
                wy,
                word.width,
                word.height,
                frame.timeSeconds,
                fillAccent,
                secondaryAccent,
                motionScale
              );
            }
          } else {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.52)';
            ctx.fillText(word.text, wx, wy);
          }

          if (iconsEnabled && (isWordActive || isWordPast || unsyncedOrLineLevel)) {
            const iconId = resolveWordIcon(word.text, line.text);
            if (iconId) {
              drawInlineWordIconPop(
                ctx,
                iconId,
                wx,
                wy,
                word.width,
                word.height,
                isWordActive ? fillAccent : '#ffffff',
                frame.wordProgress,
                isWordActive,
                frame.reduceMotion
              );
            }
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
      } else if (!isBrowsing && i === nextNonBlankIdx) {
        const nextText = (line.text || resolved?.primaryText || '').trim();
        if (!nextText || isBlankOrInstrumentalLineText(nextText)) continue;
        const pillFont = Math.max(13, Math.round(fontSize * 0.44));
        ctx.font = `600 ${pillFont}px ${frame.fontFamily}`;
        const label = `NEXT  ${nextText}`;
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
