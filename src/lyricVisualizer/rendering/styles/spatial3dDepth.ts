// Style: Spatial3DDepth
// Variations:
//  0: 'depth-rings' (default) - glowing album-tinted concentric perspective rings
//  1: 'glass-planes'          - translucent dark frosted glass planes behind lyric slices
//  2: 'horizon-grid'          - perspective neon floor/ceiling grid + soft reflective floor glow
// Fixes receding line clumping via strict Z-spacing (z = baseZ + rel * 210) AND monotonic
// non-overlapping vertical lane positions walking outward from the focal line upward & downward.

import type { StyleFrameContext } from '../../core/models';
import { isBlankOrInstrumentalLineText } from '../../core/lrcParser';
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

const MAX_PLANES = 16;

export class Spatial3DDepthStyle implements ILyricVisualStyle {
  readonly id = 'Spatial3DDepth' as const;
  readonly name = 'Spatial 3D Depth';
  readonly webGlEffect = 'none' as const;

  private smoothLineIndex = 0;
  private initialized = false;
  private tunnelPhase = 0;
  private lastKnownActiveIdx = -1;

  // Pre-allocated lane buffers (zero per-frame heap allocations)
  private readonly laneY = new Float32Array(MAX_PLANES);
  private readonly laneZ = new Float32Array(MAX_PLANES);
  private readonly lanePersp = new Float32Array(MAX_PLANES);
  private readonly laneRel = new Float32Array(MAX_PLANES);
  private readonly drawOrder = new Int32Array(MAX_PLANES);

  getVariationIndex(variationId?: string): 0 | 1 | 2 {
    if (variationId === 'glass-planes') return 1;
    if (variationId === 'horizon-grid') return 2;
    return 0;
  }

  getMeasurementSpec(frame?: StyleFrameContext): StyleMeasurementSpec {
    return {
      fontWeight: 800,
      fontSizeMultiplier: 1.04,
      maxLineWidthRatio: 0.82,
      scriptMode: frame?.scriptMode ?? 'auto',
      styleId: this.id,
    };
  }

  reset(): void {
    this.smoothLineIndex = 0;
    this.initialized = false;
    this.tunnelPhase = 0;
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
    const bgAlpha =
      typeof frame.backgroundOpacity === 'number' && Number.isFinite(frame.backgroundOpacity)
        ? clamp01(frame.backgroundOpacity)
        : 0.95;
    const vigStrength =
      typeof frame.vignetteStrength === 'number' && Number.isFinite(frame.vignetteStrength)
        ? clamp01(frame.vignetteStrength)
        : 0.55;

    if (!frame.reduceMotion) {
      const dt = Math.max(0.001, Math.min(0.1, frame.deltaSeconds));
      this.tunnelPhase =
        (this.tunnelPhase + dt * (0.28 + frame.audio.bassEnergy * 0.36 + frame.audio.rmsLevel * 0.14)) %
        1;
    }

    const camDriftX = frame.reduceMotion
      ? 0
      : Math.sin(frame.timeSeconds * 0.55) * (24 + frame.audio.bassEnergy * 10);
    const camDriftY = frame.reduceMotion
      ? 0
      : Math.cos(frame.timeSeconds * 0.42) * (12 + frame.audio.midEnergy * 6);

    if (!isTransparent) {
      ctx.save();
      ctx.globalAlpha = bgAlpha;
      const bg = ctx.createRadialGradient(
        focal.centerX + camDriftX * 0.3,
        height * 0.46 + camDriftY * 0.3,
        16,
        focal.centerX,
        height * 0.5,
        Math.max(width, height) * 0.85
      );
      bg.addColorStop(0, frame.palette.bgMid);
      bg.addColorStop(0.62, frame.palette.bgDeep);
      bg.addColorStop(1, '#04050a');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      if (varIdx === 0) {
        // Depth Rings: 6 smoothly receding perspective tunnel rings along Z
        for (let r = 0; r < 6; r++) {
          const zNorm = (r + this.tunnelPhase) / 6;
          const z = 0.42 + zNorm * 2.75;
          const persp = 0.52 / z;
          const audioPulse = frame.reduceMotion
            ? 1
            : 1 + frame.audio.bassEnergy * 0.08 * (1 - zNorm * 0.5);
          const edgeFade = Math.sin(zNorm * Math.PI);
          ctx.strokeStyle =
            r % 2 === 0 ? frame.palette.accentPrimary : frame.palette.accentSecondary;
          ctx.lineWidth = Math.max(0.8, 2.2 * persp);
          ctx.globalAlpha = bgAlpha * edgeFade * (0.14 + frame.audio.rmsLevel * 0.08);
          ctx.beginPath();
          ctx.ellipse(
            focal.centerX - camDriftX * (0.28 - zNorm * 0.22),
            height * 0.5 - camDriftY * (0.28 - zNorm * 0.22),
            Math.max(4, focal.width * 0.48 * persp * audioPulse),
            Math.max(3, height * 0.42 * persp * audioPulse),
            0,
            0,
            Math.PI * 2
          );
          ctx.stroke();
        }
      } else if (varIdx === 2) {
        // Horizon Grid: perspective neon floor & ceiling grid + soft reflective floor glow
        const horizonTop = height * 0.24;
        const horizonBot = height * 0.74;
        ctx.strokeStyle = frame.palette.accentSecondary;
        ctx.lineWidth = 1;
        for (let r = -7; r <= 7; r++) {
          const hx = width * 0.5 + r * width * 0.025 - camDriftX * 0.2;
          const ex = width * 0.5 + r * width * 0.12;
          ctx.globalAlpha = bgAlpha * 0.11;
          ctx.beginPath();
          ctx.moveTo(hx, horizonBot);
          ctx.lineTo(ex, height);
          ctx.moveTo(hx, horizonTop);
          ctx.lineTo(ex, 0);
          ctx.stroke();
        }
        for (let step = 1; step <= 5; step++) {
          const t = step / 5;
          const yBot = horizonBot + t * t * (height - horizonBot);
          const yTop = horizonTop - t * t * horizonTop;
          ctx.globalAlpha = bgAlpha * (0.05 + t * 0.12);
          ctx.beginPath();
          ctx.moveTo(0, yBot);
          ctx.lineTo(width, yBot);
          ctx.moveTo(0, yTop);
          ctx.lineTo(width, yTop);
          ctx.stroke();
        }

        const floorGlow = ctx.createRadialGradient(
          width * 0.5,
          height * 0.85,
          10,
          width * 0.5,
          height * 0.85,
          width * 0.45
        );
        floorGlow.addColorStop(0, frame.palette.accentPrimary);
        floorGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.globalAlpha = bgAlpha * (0.14 + frame.audio.bassEnergy * 0.1);
        ctx.fillStyle = floorGlow;
        ctx.fillRect(0, height * 0.6, width, height * 0.4);
      }

      if (vigStrength > 0.01) {
        const vig = ctx.createRadialGradient(
          width * 0.5,
          height * 0.5,
          Math.min(width, height) * 0.26,
          width * 0.5,
          height * 0.5,
          Math.max(width, height) * 0.78
        );
        vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
        vig.addColorStop(1, `rgba(2, 4, 9, ${(0.76 * vigStrength).toFixed(3)})`);
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
    const manualScroll =
      typeof frame.manualScrollY === 'number' && Number.isFinite(frame.manualScrollY)
        ? frame.manualScrollY
        : 0;
    const isBrowsing = frame.isFollowingPlayback === false || Math.abs(manualScroll) > 3;

    const showInstrumental = Boolean(frame.isInstrumentalGap || activeLineIsBlank);
    const targetPlaneFloat =
      showInstrumental && !isBrowsing && !hasActiveLine
        ? Math.min(layout.lines.length - 1, scrollIdx + 0.5)
        : scrollIdx;
    if (!this.initialized || frame.didSeekThisFrame || frame.reduceMotion) {
      this.smoothLineIndex = targetPlaneFloat;
      this.initialized = true;
    } else {
      const rate = Math.min(1, Math.max(0.016, frame.deltaSeconds) * 6.5);
      this.smoothLineIndex += (targetPlaneFloat - this.smoothLineIndex) * rate;
    }

    const lineH = Math.max(32, layout.lineHeightPx);
    // Manual scroll shifts the focal plane smoothly through the 3D Z-stack
    const centerLineFloat = Math.max(
      0,
      Math.min(layout.lines.length - 1, this.smoothLineIndex + manualScroll / lineH)
    );
    const pivotIdx = Math.max(0, Math.min(layout.lines.length - 1, Math.round(centerLineFloat)));

    const cx = focal.width * 0.5;
    const cy = height * 0.5;
    const baseZ = 180;
    const focalLength = 420;
    const fontSize = layout.fontSizePx;
    const unsyncedOrLineLevel = isUnsyncedLyrics(frame) || frame.activeWordIndex < 0;
    const isLeftAlign = frame.textAlign === 'left';
    const leftPad = Math.max(28, Math.round(focal.width * 0.08));
    const hoveredIdx = typeof frame.hoveredLineIndex === 'number' ? frame.hoveredLineIndex : -1;

    const startPlane = Math.max(0, pivotIdx - 3);
    const endPlane = Math.min(layout.lines.length - 1, pivotIdx + 5);
    const planeCount = endPlane - startPlane + 1;
    const minGap = Math.max(lineH * 0.85, 38);

    // 1. Compute strict Z-spacing (z = baseZ + rel * 210) and perspective factors
    for (let i = startPlane; i <= endPlane; i++) {
      const slot = i - startPlane;
      const rel = i - centerLineFloat;
      const distRel = Math.abs(rel);
      const z = baseZ + distRel * 210;
      const persp = focalLength / (focalLength + z - baseZ);
      this.laneRel[slot] = rel;
      this.laneZ[slot] = z;
      this.lanePersp[slot] = persp;
    }

    // 2. Compute monotonic non-overlapping vertical lane positions walking outward from pivotIdx
    const pivotSlot = pivotIdx - startPlane;
    const pivotRel = this.laneRel[pivotSlot];
    const pivotPersp = this.lanePersp[pivotSlot];
    this.laneY[pivotSlot] = cy + pivotRel * lineH * pivotPersp + camDriftY * (1 - pivotPersp);

    // Walk downward (pivotIdx + 1 .. endPlane)
    for (let i = pivotIdx + 1; i <= endPlane; i++) {
      const slot = i - startPlane;
      const prevSlot = slot - 1;
      const rel = this.laneRel[slot];
      const persp = this.lanePersp[slot];
      const rawY = cy + rel * (lineH * 1.08) * persp + camDriftY * (1 - persp);
      const prevScaledH = layout.lines[i - 1].height * this.lanePersp[prevSlot];
      const curScaledH = layout.lines[i].height * persp;
      const requiredGap = Math.max(minGap, (prevScaledH + curScaledH) * 0.5 + 14);
      this.laneY[slot] = Math.max(rawY, this.laneY[prevSlot] + requiredGap);
    }

    // Walk upward (pivotIdx - 1 down to startPlane)
    for (let i = pivotIdx - 1; i >= startPlane; i--) {
      const slot = i - startPlane;
      const nextSlot = slot + 1;
      const rel = this.laneRel[slot];
      const persp = this.lanePersp[slot];
      const rawY = cy + rel * (lineH * 1.08) * persp + camDriftY * (1 - persp);
      const nextScaledH = layout.lines[i + 1].height * this.lanePersp[nextSlot];
      const curScaledH = layout.lines[i].height * persp;
      const requiredGap = Math.max(minGap, (nextScaledH + curScaledH) * 0.5 + 14);
      this.laneY[slot] = Math.min(rawY, this.laneY[nextSlot] - requiredGap);
    }

    // 3. Sort planes back-to-front by Z so closer planes always draw cleanly over distant ones
    for (let s = 0; s < planeCount; s++) {
      this.drawOrder[s] = s;
    }
    for (let a = 1; a < planeCount; a++) {
      const key = this.drawOrder[a];
      const keyZ = this.laneZ[key];
      let b = a - 1;
      while (b >= 0 && this.laneZ[this.drawOrder[b]] < keyZ) {
        this.drawOrder[b + 1] = this.drawOrder[b];
        b--;
      }
      this.drawOrder[b + 1] = key;
    }

    ctx.save();
    if (focal.left > 0) {
      ctx.translate(focal.left, 0);
    }
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    for (let k = 0; k < planeCount; k++) {
      const slot = this.drawOrder[k];
      const i = startPlane + slot;
      const line = layout.lines[i];
      if (isLineBlank(i)) continue;
      const persp = this.lanePersp[slot];
      const planeY = this.laneY[slot];
      const depthDist = Math.abs(this.laneRel[slot]);
      const isActive = hasActiveLine && i === frame.activeLineIndex;
      const isPast = hasActiveLine
        ? i < frame.activeLineIndex
        : i <= scrollIdx && (frame.lyrics?.lines[i]?.endSeconds ?? 0) <= frame.timeSeconds;
      const isFocal = i === pivotIdx;
      const isHovered = i === hoveredIdx;
      const rawLine = frame.lyrics?.lines[i];
      const resolved = rawLine ? resolveDisplayLine(rawLine, frame.scriptMode, this.id) : null;
      const secondaryText = line.secondaryText ?? resolved?.secondaryText ?? null;

      const scaledH = line.height * persp;
      if (planeY + scaledH * 0.5 < -60 || planeY - scaledH * 0.5 > height + 60) continue;

      const gapDim = frame.isInstrumentalGap && !isBrowsing && !hasActiveLine ? 0.52 : 1.0;
      const dofAlpha =
        (isActive
          ? frame.lineFadeAlpha
          : isHovered
          ? 0.88
          : Math.max(0.22, 0.78 * Math.exp(-depthDist * 0.42))) * gapDim;

      const planeXShift = camDriftX * (1 - persp) * 1.35;
      const lineBaseX = isLeftAlign ? leftPad : line.x;
      const scaledW = line.width * persp;
      const hitLocalX = Math.max(8, cx + planeXShift + (lineBaseX - cx) * persp - 16);
      const hitW = Math.min(focal.width - hitLocalX - 8, Math.max(scaledW + 32, 140));
      frame.recordHitRect?.(
        i,
        focal.left + hitLocalX,
        planeY - scaledH * 0.5 - 6,
        hitW,
        scaledH + 12
      );

      ctx.save();
      ctx.translate(cx + planeXShift, planeY);
      ctx.scale(persp, persp);
      ctx.translate(-cx, -line.height * 0.5);

      // Variation 1 ('glass-planes') or hovered line: translucent dark glass plane behind slice
      if ((varIdx === 1 && !isTransparent) || isHovered) {
        const glassX = Math.max(8, lineBaseX - 22);
        const glassW = Math.min(focal.width - 16, line.width + 44);
        drawRoundedRectPath(ctx, glassX, -8, glassW, line.height + 16, 12);
        ctx.fillStyle = isHovered
          ? 'rgba(30, 41, 59, 0.55)'
          : isActive
          ? 'rgba(15, 23, 42, 0.62)'
          : 'rgba(10, 15, 28, 0.42)';
        ctx.globalAlpha = dofAlpha;
        ctx.fill();
        ctx.strokeStyle =
          isHovered || isActive ? frame.palette.accentPrimary : frame.palette.accentSecondary;
        ctx.globalAlpha = (isHovered || isActive ? 0.55 : 0.24) * dofAlpha;
        ctx.lineWidth = isActive || isHovered ? 1.5 : 1;
        ctx.stroke();
      }

      if (isActive && frame.isFollowingPlayback === false) {
        const railX = Math.max(14, lineBaseX - 15);
        const railH = Math.max(18, line.height - 6);
        const pulse = frame.reduceMotion
          ? 0.92
          : 0.72 + 0.28 * Math.sin(frame.timeSeconds * 5.0);
        ctx.save();
        ctx.fillStyle = frame.palette.accentPrimary;
        ctx.globalAlpha = 0.92 * dofAlpha;
        drawRoundedRectPath(ctx, railX, 3, 4, railH, 2);
        ctx.fill();

        ctx.globalAlpha = pulse * dofAlpha;
        ctx.shadowColor = frame.palette.accentPrimary;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(Math.max(7, railX - 7), line.height * 0.5, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.font = `${isActive || isFocal ? 800 : 600} ${fontSize}px ${frame.fontFamily}`;

      if (!isActive) {
        ctx.globalAlpha = dofAlpha;
        ctx.fillStyle = isPast ? frame.palette.textUpcoming : '#e2e8f0';
        ctx.shadowColor = 'rgba(4, 6, 12, 0.75)';
        ctx.shadowBlur = depthDist > 1.5 ? 6 : 2;
        for (let w = 0; w < line.words.length; w++) {
          const word = line.words[w];
          ctx.fillText(word.text, lineBaseX + word.x, word.y);
        }
      } else {
        for (let w = 0; w < line.words.length; w++) {
          const word = line.words[w];
          const wx = lineBaseX + word.x;
          const wy = word.y;
          const isCurrent = unsyncedOrLineLevel ? true : w === frame.activeWordIndex;
          const isPastWord = !unsyncedOrLineLevel && w < frame.activeWordIndex;

          // Crisp Z-extrusion depth shadow behind active line words
          ctx.save();
          ctx.globalAlpha = 0.65 * dofAlpha;
          ctx.fillStyle = 'rgba(4, 6, 14, 0.92)';
          ctx.shadowBlur = 0;
          ctx.fillText(word.text, wx + 2.5, wy + 3.5);
          ctx.restore();

          ctx.globalAlpha = (isCurrent ? 1.0 : isPastWord ? 0.96 : 0.76) * dofAlpha;
          ctx.fillStyle = isCurrent
            ? '#ffffff'
            : isPastWord
            ? '#f1f5f9'
            : frame.palette.textActive;
          ctx.shadowColor = isCurrent ? frame.palette.accentPrimary : 'rgba(15, 23, 42, 0.65)';
          ctx.shadowBlur = isCurrent ? 20 + frame.audio.bassEnergy * 10 : 6;
          ctx.fillText(word.text, wx, wy);
        }
        if (secondaryText) {
          const secFont = Math.max(12, Math.round(fontSize * 0.4));
          ctx.save();
          ctx.font = `500 ${secFont}px ${frame.fontFamily}`;
          ctx.fillStyle = frame.palette.textUpcoming;
          ctx.globalAlpha = 0.72 * dofAlpha;
          ctx.shadowBlur = 0;
          ctx.textAlign = isLeftAlign ? 'left' : 'center';
          ctx.fillText(
            secondaryText,
            isLeftAlign ? leftPad : cx,
            line.height + 4
          );
          ctx.restore();
        }
      }

      ctx.restore();
    }

    ctx.restore();

    if (showInstrumental && !isBrowsing) {
      drawInstrumentalIndicator(ctx, frame, width, height, frame.palette.accentPrimary);
    }
  }
}
