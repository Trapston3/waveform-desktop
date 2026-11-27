// Style: Editorial (consolidates Minimal Swiss + Typewriter Editorial)
// Variations:
//  0: 'swiss-minimal' (default) - asymmetric Swiss 12-column hairline grid + micro-timestamps
//  1: 'typewriter'              - literary serif manuscript spotlight with animated cursor & ink reveal

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
import { detectMagicWordEffect } from '../lyricSemantics';
import {
  drawInlineWordIconPop,
  drawSemanticWordMicroFx,
  resolveWordIcon,
} from '../wordIconDictionary';

function resolveSerifFamily(fontFamily: string): string {
  return fontFamily.includes('serif')
    ? fontFamily
    : `"Instrument Serif", Fraunces, ${fontFamily}`;
}

function sliceCodePointsZeroAlloc(text: string, wordProgress: number): string {
  let cpCount = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    cpCount++;
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i++;
    }
  }
  const targetCp = Math.max(
    1,
    Math.min(cpCount, Math.ceil(cpCount * Math.max(0.15, wordProgress)))
  );
  let seen = 0;
  let endIdx = text.length;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i++;
    }
    seen++;
    if (seen >= targetCp) {
      endIdx = i + 1;
      break;
    }
  }
  return text.slice(0, endIdx);
}

export class EditorialStyle implements ILyricVisualStyle {
  readonly id = 'Editorial' as const;
  readonly name = 'Editorial';
  readonly webGlEffect = 'none' as const;

  private scrollY = 0;
  private initialized = false;
  private lastKnownActiveIdx = -1;

  getVariationIndex(variationId?: string): 0 | 1 {
    if (variationId === 'typewriter' || variationId === 'dark-slate' || variationId === 'warm-ink') {
      return 1;
    }
    return 0;
  }

  getMeasurementSpec(frame: StyleFrameContext): StyleMeasurementSpec {
    const varIdx = this.getVariationIndex(frame?.variationId);
    if (varIdx === 1) {
      return {
        fontWeight: 600,
        fontSizeMultiplier: 1.06,
        fontFamilyOverride: resolveSerifFamily(frame.fontFamily),
        maxLineWidthRatio: 0.76,
        scriptMode: frame?.scriptMode ?? 'auto',
        styleId: this.id,
      };
    }
    return {
      fontWeight: 700,
      fontSizeMultiplier: 0.96,
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
    const iconsEnabled = frame.wordIconsEnabled !== false;
    const motionScale = frame.reduceMotion
      ? 0
      : frame.motionIntensity === 'vivid'
      ? 1.3
      : frame.motionIntensity === 'subtle'
      ? 0.55
      : 1.0;

    if (varIdx === 1) {
      this.renderTypewriter(ctx, frame, width, height, isTransparent, iconsEnabled, motionScale);
      return;
    }
    this.renderSwissMinimal(ctx, frame, width, height, isTransparent, iconsEnabled, motionScale);
  }

  private renderSwissMinimal(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    width: number,
    height: number,
    isTransparent: boolean,
    iconsEnabled: boolean,
    motionScale: number
  ): void {
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
      ctx.fillStyle = frame.palette.bgDeep;
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
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

    if (!isTransparent) {
      ctx.font = `600 11px "JetBrains Mono", monospace`;
      ctx.fillStyle = frame.palette.accentPrimary;
      ctx.globalAlpha = 0.88;
      const idxLabel = hasActiveLine ? String(scrollIdx + 1).padStart(2, '0') : '--';
      ctx.fillText(
        `INDEX ${idxLabel}/${String(layout.lines.length).padStart(2, '0')}`,
        fgGutterX,
        Math.max(18, height * 0.08)
      );
    }

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

      ctx.font = `500 12px "JetBrains Mono", monospace`;
      ctx.fillStyle =
        isActive || isHovered ? frame.palette.accentPrimary : frame.palette.textPassed;
      ctx.globalAlpha = isActive ? 0.96 : isHovered ? 0.8 : 0.42;
      ctx.fillText(formatTimestamp(line.startSeconds), timestampLocalX, y + 8);

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

      if (isActive || isHovered) {
        ctx.globalAlpha = isActive ? 1.0 : 0.55;
        ctx.fillStyle = frame.palette.accentPrimary;
        const barH = Math.max(fontSize, line.height - 6);
        ctx.fillRect(fgGutterX - 20, y + 2, 5, barH);
      }

      ctx.font = `${isActive ? 700 : 500} ${fontSize}px ${frame.fontFamily}`;
      for (let w = 0; w < line.words.length; w++) {
        const word = line.words[w];
        const wx = fgGutterX + word.x;
        const wy = y + word.y;
        const isWordCurrent = isActive && !unsyncedOrLineLevel && w === frame.activeWordIndex;
        const isWordPassed = isActive && !unsyncedOrLineLevel && w < frame.activeWordIndex;

        if (isActive) {
          if (unsyncedOrLineLevel) {
            ctx.fillStyle = frame.palette.textActive;
            ctx.globalAlpha = frame.lineFadeAlpha;
          } else {
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

        if (isWordCurrent || (isActive && unsyncedOrLineLevel && w === 0)) {
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
              frame.palette.accentPrimary,
              frame.palette.accentSecondary,
              motionScale
            );
          }
        }
        if (iconsEnabled && isActive && (isWordCurrent || isWordPassed || unsyncedOrLineLevel)) {
          const iconId = resolveWordIcon(word.text, line.text);
          if (iconId) {
            drawInlineWordIconPop(
              ctx,
              iconId,
              wx,
              wy,
              word.width,
              word.height,
              isWordCurrent ? frame.palette.accentPrimary : frame.palette.textActive,
              frame.wordProgress,
              isWordCurrent,
              frame.reduceMotion
            );
          }
        }
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

  private renderTypewriter(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    width: number,
    height: number,
    isTransparent: boolean,
    iconsEnabled: boolean,
    motionScale: number
  ): void {
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

    if (!isTransparent) {
      ctx.save();
      ctx.globalAlpha = bgAlpha;
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, '#0b0e14');
      bg.addColorStop(1, '#111622');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = 'rgba(203, 213, 225, 0.065)';
      ctx.lineWidth = 1;
      ctx.beginPath();
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

    const inkBright = '#f8fafc';
    const inkPast = '#e2e8f0';
    const inkGhost = '#94a3b8';

    ctx.save();
    if (focal.left > 0) {
      ctx.translate(focal.left, 0);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    ctx.font = `500 12px "JetBrains Mono", monospace`;
    ctx.fillStyle = frame.palette.accentPrimary;
    ctx.globalAlpha = 0.76;
    const lineNumLabel = hasActiveLine ? String(scrollIdx + 1).padStart(2, '0') : '--';
    ctx.fillText(
      `FOLIO // EDITORIAL  ·  LINE ${lineNumLabel}  /  ${formatTimestamp(activeLine.startSeconds)}`,
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
        ctx.fillStyle = 'rgba(148, 163, 184, 0.1)';
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
          const isWordCurrent = !unsyncedOrLineLevel && w === frame.activeWordIndex;
          const isWordPassed = !unsyncedOrLineLevel && w < frame.activeWordIndex;

          if (unsyncedOrLineLevel || isWordPassed) {
            ctx.globalAlpha = 0.96 * frame.lineFadeAlpha;
            ctx.fillStyle = inkPast;
            ctx.fillText(word.text, wx, wy);
            cursorX = wx + word.width + 6;
            cursorY = wy;
          } else if (isWordCurrent) {
            const p = clamp01(frame.wordProgress);
            const revealed = p < 0.999 ? sliceCodePointsZeroAlloc(word.text, p) : word.text;
            ctx.globalAlpha = frame.lineFadeAlpha;
            ctx.fillStyle = inkBright;
            ctx.fillText(revealed, wx, wy);

            const revealedW = ctx.measureText(revealed).width || word.width * p;
            cursorX = wx + revealedW + 3;
            cursorY = wy;

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
                frame.palette.accentPrimary,
                frame.palette.accentSecondary,
                motionScale
              );
            }
          } else {
            ctx.globalAlpha = (isHovered ? 0.48 : 0.28) * frame.lineFadeAlpha;
            ctx.fillStyle = inkGhost;
            ctx.fillText(word.text, wx, wy);
          }

          if (iconsEnabled && (isWordCurrent || isWordPassed || unsyncedOrLineLevel)) {
            const iconId = resolveWordIcon(word.text, line.text);
            if (iconId) {
              drawInlineWordIconPop(
                ctx,
                iconId,
                wx,
                wy,
                word.width,
                word.height,
                isWordCurrent ? frame.palette.accentPrimary : inkPast,
                frame.wordProgress,
                isWordCurrent,
                frame.reduceMotion
              );
            }
          }
        }

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
