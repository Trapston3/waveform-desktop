// Style: StarfieldShip3D
// Variations:
//  0: 'deep-space' (default) - serene deep-space starfield + 3D starfighter & direct lyric-merge splashes
//  1: 'nebula-run'           - album-tinted cosmic nebula veil + fluid flight weave
//  2: 'retro-wireframe'      - vector wireframe starfighter, asteroids, and infinite horizon grid

import type { StyleFrameContext } from '../../core/models';
import {
  clamp01,
  drawRoundedRectPath,
  getFocalRect,
  isTransparentStage,
  isUnsyncedLyrics,
  resolveDisplayLine,
  type ILyricVisualStyle,
  type StyleMeasurementSpec,
} from '../styleInterface';
import { getActiveShip3DScene, setShip3DSceneHint, type Ship3DHudTelemetry } from '../ship3dScene';

const SEM_FIRE = 1 << 0;
const SEM_RAINBOW = 1 << 2;
const SEM_ICE = 1 << 3;
const SEM_ELECTRIC = 1 << 4;
const SEM_LOVE = 1 << 8;

function resolveWordGlowColor(
  semanticMask: number,
  timeSeconds: number,
  paletteAccentPrimary: string,
  paletteAccentSecondary: string
): string {
  if ((semanticMask & SEM_ICE) !== 0) return '#7dd3fc';
  if ((semanticMask & SEM_FIRE) !== 0) return '#fb923c';
  if ((semanticMask & SEM_ELECTRIC) !== 0) return '#38bdf8';
  if ((semanticMask & SEM_LOVE) !== 0) return '#fbbf24';
  if ((semanticMask & SEM_RAINBOW) !== 0) {
    const hue = Math.round(((timeSeconds * 140) % 360 + 360) % 360);
    return `hsl(${hue}, 92%, 66%)`;
  }
  return semanticMask !== 0 ? paletteAccentSecondary : paletteAccentPrimary;
}

export class StarfieldShip3DStyle implements ILyricVisualStyle {
  readonly id = 'StarfieldShip3D' as const;
  readonly name = 'Starfield Ship 3D';
  readonly webGlEffect = 'starfield' as const;
  readonly usesShip3D = true;

  private scrollY = 0;
  private initialized = false;
  private lastKnownActiveIdx = -1;
  // Pre-allocated AABB scratch for up to 6 non-overlapping 3D projected words (zero GC)
  private readonly drawnWordRects = new Float32Array(24);

  getVariationIndex(variationId?: string): 0 | 1 | 2 {
    if (variationId === 'nebula-run') return 1;
    if (variationId === 'retro-wireframe' || variationId === 'retro-vector-wireframe') return 2;
    return 0;
  }

  getMeasurementSpec(frame?: StyleFrameContext): StyleMeasurementSpec {
    // Synchronize variation & backdrop settings before Ship3DScene.render() runs in LyricStageRenderer
    setShip3DSceneHint(
      frame?.variationId,
      frame?.backgroundOpacity,
      frame?.vignetteStrength
    );
    return {
      fontWeight: 700,
      fontSizeMultiplier: 0.98,
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

  private drawMinimalInstrumentalIndicator(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    centerX: number,
    centerY: number,
    maxWidth: number
  ): void {
    const motion = frame.reduceMotion ? 0 : 1;
    const t = frame.timeSeconds || 0;
    const bass = frame.audio?.bassEnergy ?? 0;
    const mid = frame.audio?.midEnergy ?? 0;
    const treble = frame.audio?.trebleEnergy ?? 0;
    const rms = frame.audio?.rmsLevel ?? 0;
    const beatBoost =
      motion > 0 && frame.audio?.isDownbeat
        ? 0.38
        : motion > 0 && frame.audio?.beatDetected
        ? 0.24
        : 0;

    ctx.save();

    // Soft glowing musical note
    const noteY = centerY - 26;
    ctx.font = `700 22px ${frame.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = frame.palette.accentPrimary;
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = motion === 0 ? 0.85 : 0.78 + 0.22 * Math.sin(t * 2.6);
    ctx.fillText('♪', centerX, noteY);

    // Sleek minimal soft-pulsing waveform
    const barCount = 14;
    const barW = 4;
    const barGap = 6;
    const totalW = barCount * barW + (barCount - 1) * barGap;
    const startX = centerX - totalW * 0.5;
    const maxBarH = 28;

    for (let i = 0; i < barCount; i++) {
      const band = i < 5 ? bass : i < 10 ? mid : treble;
      const env = Math.sin(((i + 0.5) / barCount) * Math.PI);
      const wave =
        motion === 0 ? 0.45 : 0.28 + 0.72 * Math.abs(Math.sin(t * 4.2 + i * 0.65));
      const amp = clamp01(0.16 + env * wave * (0.36 + band * 0.75 + rms * 0.35 + beatBoost));
      const bh = Math.max(4, Math.round(maxBarH * amp));
      const bx = startX + i * (barW + barGap);
      const by = centerY - bh * 0.5 + 2;
      ctx.fillStyle = i % 2 === 0 ? frame.palette.accentPrimary : frame.palette.accentSecondary;
      ctx.shadowColor = frame.palette.accentPrimary;
      ctx.shadowBlur = 8;
      ctx.globalAlpha = 0.65 + amp * 0.35;
      drawRoundedRectPath(ctx, bx, by, barW, bh, 2);
      ctx.fill();
    }

    // Minimal glowing INSTRUMENTAL label
    ctx.font = `600 13px ${frame.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.shadowColor = frame.palette.accentPrimary;
    ctx.shadowBlur = 12;
    ctx.fillStyle = frame.palette.textActive;
    ctx.globalAlpha = motion === 0 ? 0.82 : 0.72 + 0.24 * Math.sin(t * 2.2);
    ctx.fillText('INSTRUMENTAL', centerX, centerY + 24);

    // Subtle progress hair-track if gapProgress is active
    const progress =
      typeof frame.gapProgress === 'number' && Number.isFinite(frame.gapProgress)
        ? clamp01(frame.gapProgress)
        : 0;
    if (progress > 0 && progress < 1) {
      const trackW = Math.min(220, maxWidth * 0.5);
      const trackX = centerX - trackW * 0.5;
      const trackY = centerY + 46;
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = '#ffffff';
      drawRoundedRectPath(ctx, trackX, trackY, trackW, 2, 1);
      ctx.fill();

      ctx.globalAlpha = 0.85;
      ctx.fillStyle = frame.palette.accentPrimary;
      drawRoundedRectPath(ctx, trackX, trackY, Math.max(4, trackW * progress), 2, 1);
      ctx.fill();
    }

    ctx.restore();
  }

  private drawProjectedWords(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    focalLeft: number,
    focalWidth: number,
    height: number
  ): void {
    const activeScene = getActiveShip3DScene();
    if (!activeScene || frame.isInstrumentalGap) return;

    const gateCount = activeScene.getProjectedWordGateCount();
    if (gateCount <= 0) return;

    const fontSizeScale =
      typeof frame.fontSizeScale === 'number' && Number.isFinite(frame.fontSizeScale)
        ? frame.fontSizeScale
        : 1.0;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Draw up to 6 non-overlapping words along the 3D flight corridor (nose-center collision + phrase stream)
    let drawnCount = 0;
    for (let g = 0; g < gateCount && drawnCount < 6; g++) {
      const gp = activeScene.getProjectedWordGate(g);
      if (!gp.text || gp.alpha <= 0.03) continue;

      const rawPx = 44 * gp.scale * fontSizeScale * (1 + gp.mergeFlash * 0.22);
      const wordFontPx = Math.max(28, Math.min(62, Math.round(rawPx)));
      ctx.font = `800 ${wordFontPx}px ${frame.fontFamily}`;

      const textW = ctx.measureText(gp.text).width;
      const marginX = Math.max(28, textW * 0.5 + 18);
      const minX = focalLeft + marginX;
      const maxX = Math.max(minX, focalLeft + focalWidth - marginX);
      const drawX = Math.max(minX, Math.min(maxX, gp.screenX));

      const minY = Math.max(44, wordFontPx * 0.65);
      const maxY = Math.max(minY, height - Math.max(52, wordFontPx * 0.75));
      const drawY = Math.max(minY, Math.min(maxY, gp.screenY));

      const pad = 10;
      const rx0 = drawX - textW * 0.5 - pad;
      const ry0 = drawY - wordFontPx * 0.52 - pad;
      const rx1 = drawX + textW * 0.5 + pad;
      const ry1 = drawY + wordFontPx * 0.52 + pad;

      let overlaps = false;
      for (let d = 0; d < drawnCount; d++) {
        const o = d * 4;
        if (
          rx0 < this.drawnWordRects[o + 2] &&
          rx1 > this.drawnWordRects[o] &&
          ry0 < this.drawnWordRects[o + 3] &&
          ry1 > this.drawnWordRects[o + 1]
        ) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;

      const o = drawnCount * 4;
      this.drawnWordRects[o] = rx0;
      this.drawnWordRects[o + 1] = ry0;
      this.drawnWordRects[o + 2] = rx1;
      this.drawnWordRects[o + 3] = ry1;
      drawnCount++;

      if (gp.lineIndex >= 0) {
        frame.recordHitRect?.(gp.lineIndex, rx0, ry0, rx1 - rx0, ry1 - ry0);
      }

      const glowColor = resolveWordGlowColor(
        gp.semanticMask,
        frame.timeSeconds,
        frame.palette.accentPrimary,
        frame.palette.accentSecondary
      );

      // Rich liquid-starlight impact splash across the ship's nose/wings on collision
      if (gp.mergeFlash > 0.01 && !frame.reduceMotion) {
        const p = 1.0 - gp.mergeFlash;
        ctx.save();
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 18;

        // Expanding directional plasma ripple arc sweeping off nose/wings
        const rippleRx = (24 + p * 68) * gp.scale;
        const rippleRy = rippleRx * 0.44;
        ctx.strokeStyle = glowColor;
        ctx.lineWidth = Math.max(1.2, (3.2 - p * 2.2) * gp.scale);
        ctx.globalAlpha = gp.alpha * gp.mergeFlash * 0.72;
        ctx.beginPath();
        ctx.ellipse(drawX, drawY, rippleRx, rippleRy, 0, Math.PI * 0.12, Math.PI * 0.88);
        ctx.stroke();

        // Crisp brief glow flare at nose impact
        const flareR = Math.max(8, (22 - p * 12) * gp.scale);
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = gp.alpha * gp.mergeFlash * gp.mergeFlash * 0.42;
        ctx.beginPath();
        ctx.arc(drawX, drawY, flareR, 0, Math.PI * 2);
        ctx.fill();

        // Luminous liquid-starlight splash droplets
        const dropletCount = 14;
        for (let d = 0; d < dropletCount; d++) {
          const ang = (d / dropletCount) * Math.PI * 2 + p * 0.55;
          const dist = (12 + p * (60 + (d % 3) * 16)) * gp.scale;
          const dx = drawX + Math.cos(ang) * dist;
          const dy = drawY + Math.sin(ang) * dist * 0.72;
          const dr = Math.max(1.4, (3.8 - p * 2.4) * gp.scale);
          ctx.fillStyle = d % 2 === 0 ? '#ffffff' : glowColor;
          ctx.globalAlpha = gp.alpha * gp.mergeFlash * 0.94;
          ctx.beginPath();
          ctx.arc(dx, dy, dr, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // Dark drop halo + accent glow + white core typography
      ctx.save();
      ctx.globalAlpha = gp.alpha * (gp.isActive || gp.mergeFlash > 0.08 ? 1.0 : 0.86);
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeStyle = 'rgba(2, 6, 18, 0.9)';
      ctx.lineWidth = Math.max(4, wordFontPx * 0.16);
      ctx.shadowColor = 'rgba(2, 6, 18, 0.94)';
      ctx.shadowBlur = 10;
      ctx.strokeText(gp.text, drawX, drawY);

      ctx.shadowColor = glowColor;
      ctx.shadowBlur = (gp.isActive ? 24 : 12) + gp.mergeFlash * 32;
      ctx.fillStyle =
        gp.isActive || gp.mergeFlash > 0.08 ? '#ffffff' : frame.palette.textActive;
      ctx.fillText(gp.text, drawX, drawY);
      ctx.restore();
    }

    ctx.restore();
  }

  render(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    width: number,
    height: number
  ): void {
    setShip3DSceneHint(
      frame.variationId,
      frame.backgroundOpacity,
      frame.vignetteStrength
    );
    const isTransparent = isTransparentStage(frame);
    const focal = getFocalRect(frame, width);
    const focalWidth = focal.width;

    const manualScroll =
      typeof frame.manualScrollY === 'number' && Number.isFinite(frame.manualScrollY)
        ? frame.manualScrollY
        : 0;
    const isBrowsing = frame.isFollowingPlayback === false || Math.abs(manualScroll) > 3;

    const layout = frame.layout;
    if (!layout || layout.lines.length === 0 || (frame.isInstrumentalGap && !isBrowsing)) {
      ctx.save();
      if (focal.left > 0) ctx.translate(focal.left, 0);
      this.drawMinimalInstrumentalIndicator(ctx, frame, focalWidth * 0.5, height * 0.34, Math.min(focalWidth * 0.86, 860));
      ctx.restore();
      return;
    }

    // ONE unified lyric stream: render 3D-projected corridor words & nose splashes during playback
    if (!isBrowsing) {
      this.drawProjectedWords(ctx, frame, focal.left, focalWidth, height);
      return;
    }

    // Manual scroll/drag browse overlay (only active while user is manually scrubbing lyrics)
    const ribbonTop = Math.max(24, height * 0.12);
    const ribbonBottom = Math.min(height * 0.88, height - 48);
    const ribbonAreaH = Math.max(120, ribbonBottom - ribbonTop);
    const ribbonCenterY = ribbonTop + ribbonAreaH * 0.5;
    const ribbonW = Math.min(focalWidth * 0.88, 920);
    const ribbonX = (focalWidth - ribbonW) * 0.5;

    ctx.save();
    if (focal.left > 0) {
      ctx.translate(focal.left, 0);
    }

    const hasActiveLine = frame.activeLineIndex >= 0 && frame.activeLineIndex < layout.lines.length;
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
    const anchorLine = layout.lines[scrollIdx];
    const targetScrollY = anchorLine.y + anchorLine.height * 0.5;

    if (!this.initialized || frame.didSeekThisFrame || frame.reduceMotion) {
      this.scrollY = targetScrollY;
      this.initialized = true;
    } else {
      const rate = Math.min(1, Math.max(0.016, frame.deltaSeconds) * 8.5);
      this.scrollY += (targetScrollY - this.scrollY) * rate;
    }

    const effectiveScrollY = this.scrollY + manualScroll;

    ctx.save();
    ctx.beginPath();
    ctx.rect(Math.max(0, ribbonX - 12), ribbonTop - 8, Math.min(focalWidth, ribbonW + 24), ribbonAreaH + 16);
    ctx.clip();

    const fontSize = layout.fontSizePx;
    const isLeftAlign = frame.textAlign === 'left';
    const leftPad = ribbonX + 16;
    const hoveredIdx = typeof frame.hoveredLineIndex === 'number' ? frame.hoveredLineIndex : -1;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    for (let i = 0; i < layout.lines.length; i++) {
      const line = layout.lines[i];
      if (!line.text.trim() || line.words.length === 0) continue;

      const lineCenterOffset = line.y + line.height * 0.5 - effectiveScrollY;
      const screenY = ribbonCenterY + lineCenterOffset - line.height * 0.5;

      if (screenY + line.height < ribbonTop || screenY > ribbonBottom) continue;

      const isActive = hasActiveLine && i === frame.activeLineIndex;
      const isHovered = i === hoveredIdx;
      const subScale = isActive ? 0.92 : 0.74;
      const subFont = Math.max(14, Math.round(fontSize * subScale));
      const lineBaseX = isLeftAlign
        ? leftPad
        : Math.max(ribbonX + 12, ribbonX + (ribbonW - line.width * subScale) * 0.5);

      const hitTop = Math.max(ribbonTop, screenY - 4);
      const hitBottom = Math.min(ribbonBottom, screenY + line.height + 4);
      if (hitBottom > hitTop + 4) {
        const hitLocalX = Math.max(ribbonX + 4, lineBaseX - 12);
        const hitW = Math.min(ribbonW - 8, Math.max(line.width * subScale + 24, 150));
        frame.recordHitRect?.(i, focal.left + hitLocalX, hitTop, hitW, hitBottom - hitTop);

        if (isHovered) {
          ctx.save();
          drawRoundedRectPath(ctx, hitLocalX, hitTop, hitW, hitBottom - hitTop, 10);
          ctx.fillStyle = isTransparent ? 'rgba(94, 234, 212, 0.14)' : 'rgba(94, 234, 212, 0.10)';
          ctx.fill();
          ctx.restore();
        }
      }

      ctx.save();
      ctx.font = `${isActive ? 700 : 500} ${subFont}px ${frame.fontFamily}`;
      ctx.fillStyle = isActive
        ? '#ffffff'
        : isHovered
        ? frame.palette.textActive
        : frame.palette.textUpcoming;
      ctx.globalAlpha = isActive ? 0.98 : isHovered ? 0.88 : 0.52;
      ctx.shadowColor = 'rgba(2, 6, 18, 0.85)';
      ctx.shadowBlur = isActive ? 12 : 4;
      for (let w = 0; w < line.words.length; w++) {
        const word = line.words[w];
        const wx = lineBaseX + word.x * subScale;
        const wy = screenY + word.y * subScale;
        if (wy < ribbonTop || wy + subFont > ribbonBottom + 2) continue;
        ctx.fillText(word.text, wx, wy);
      }
      ctx.restore();
    }

    ctx.restore(); // end browse clip
    ctx.restore(); // end focal translate
  }
}
