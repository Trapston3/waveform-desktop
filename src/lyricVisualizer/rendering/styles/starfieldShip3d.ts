// Style: StarfieldShip3D
// Variations:
//  0: 'deep-space' (default) - serene deep-space starfield + 3D starfighter & direct lyric-merge splashes
//  1: 'nebula-run'           - album-tinted cosmic nebula veil + fluid flight weave
//  2: 'retro-wireframe'      - vector wireframe starfighter, asteroids, and infinite horizon grid
//  3: 'vaporwave'            - Outrun horizon sun, neon perspective grid, wireframe mountains & cyan-magenta lyrics

import type { LyricPalette, StyleFrameContext } from '../../core/models';
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
import { getActiveShip3DScene, setShip3DSceneHint } from '../ship3dScene';
import { ArcaneSketchOverlay } from '../arcaneSketchOverlay';

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
  // Pre-allocated AABB & back-to-front order scratch for up to 48 projected words (zero GC)
  private readonly drawnWordRects = new Float32Array(192);
  private readonly sortOrder = new Int32Array(48);
  private readonly arcaneOverlay = new ArcaneSketchOverlay();
  private readonly vaporPalette: LyricPalette = {
    bgDeep: '#070214',
    bgMid: '#1b0633',
    accentPrimary: '#00f5ff',
    accentSecondary: '#ff2a9d',
    textActive: '#ffffff',
    textUpcoming: '#f0abfc',
    textPassed: '#67e8f9',
    oklchL: 0.65,
    oklchC: 0.25,
    oklchH: 320,
    isFallback: false,
  };

  getVariationIndex(variationId?: string): 0 | 1 | 2 | 3 {
    if (variationId === 'nebula-run') return 1;
    if (variationId === 'retro-wireframe' || variationId === 'retro-vector-wireframe') return 2;
    if (variationId === 'vaporwave') return 3;
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
    this.arcaneOverlay.reset();
  }

  private renderArcaneOverlay(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    width: number,
    height: number
  ): void {
    const activeScene = getActiveShip3DScene();
    if (activeScene) {
      const pending = activeScene.getPendingArcaneEventCount();
      for (let i = 0; i < pending; i++) {
        this.arcaneOverlay.enqueueEvent(activeScene.getPendingArcaneEvent(i), frame.reduceMotion);
      }
      if (pending > 0) {
        activeScene.clearPendingArcaneEvents();
      }
    }
    const activePalette =
      frame.variationId === 'vaporwave' ? this.vaporPalette : frame.palette;
    this.arcaneOverlay.updateAndRender(
      ctx,
      frame.timeSeconds,
      frame.deltaSeconds,
      activePalette,
      frame.reduceMotion,
      frame.fontFamily,
      width,
      height
    );
  }

  private drawMinimalInstrumentalIndicator(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    centerX: number,
    centerY: number,
    maxWidth: number
  ): void {
    const pal = frame.variationId === 'vaporwave' ? this.vaporPalette : frame.palette;
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
    ctx.shadowColor = pal.accentPrimary;
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
      ctx.fillStyle = i % 2 === 0 ? pal.accentPrimary : pal.accentSecondary;
      ctx.shadowColor = pal.accentPrimary;
      ctx.shadowBlur = 8;
      ctx.globalAlpha = 0.65 + amp * 0.35;
      drawRoundedRectPath(ctx, bx, by, barW, bh, 2);
      ctx.fill();
    }

    // Minimal glowing INSTRUMENTAL label
    ctx.font = `600 13px ${frame.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.shadowColor = pal.accentPrimary;
    ctx.shadowBlur = 12;
    ctx.fillStyle = pal.textActive;
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
      ctx.fillStyle = pal.accentPrimary;
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

    // Sort active gate slots back-to-front by worldZ (closest word approaching nose drawn last on top)
    const count = Math.min(48, gateCount);
    for (let i = 0; i < count; i++) {
      this.sortOrder[i] = i;
    }
    for (let i = 1; i < count; i++) {
      const idx = this.sortOrder[i];
      const zVal = activeScene.getProjectedWordGate(idx).worldZ;
      let j = i - 1;
      while (j >= 0 && activeScene.getProjectedWordGate(this.sortOrder[j]).worldZ > zVal) {
        this.sortOrder[j + 1] = this.sortOrder[j];
        j--;
      }
      this.sortOrder[j + 1] = idx;
    }

    // Draw EVERY active corridor word & nose splash up to 48 slots with guaranteed non-overlapping fan placement
    let drawnCount = 0;
    let unconsumedCount = 0;
    for (let sIdx = 0; sIdx < count; sIdx++) {
      const g = this.sortOrder[sIdx];
      const gp = activeScene.getProjectedWordGate(g);
      if (!gp.text || gp.alpha <= 0.02) continue;

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
      // Keep every approaching word strictly on its exact flight-plane screenY (zero vertical lift or snap)
      const drawY = Math.max(minY, Math.min(maxY, gp.screenY));

      const isVaporwave = frame.variationId === 'vaporwave';
      const glowColor = isVaporwave
        ? '#ff2a9d'
        : resolveWordGlowColor(
            gp.semanticMask,
            frame.timeSeconds,
            frame.palette.accentPrimary,
            frame.palette.accentSecondary
          );

      // Consumed words (t >= word.startSeconds) shatter at SHIP_NOSE_Z into liquid-starlight particles (never float past ship tail!)
      if (gp.consumed) {
        if (gp.mergeFlash > 0.01 && !frame.reduceMotion) {
          const p = 1.0 - gp.mergeFlash;
          ctx.save();
          ctx.shadowColor = isVaporwave ? '#00f5ff' : glowColor;
          ctx.shadowBlur = 20;

          // Brief nose-flash dissolve during first ~90ms of impact pinned strictly at nose before full droplet dispersion
          if (gp.mergeFlash >= 0.80) {
            const wordDissolveAlpha = Math.min(1, (gp.mergeFlash - 0.80) / 0.20);
            ctx.globalAlpha = wordDissolveAlpha;
            ctx.fillStyle = isVaporwave ? '#00f5ff' : '#ffffff';
            ctx.shadowBlur = 26;
            ctx.fillText(gp.text, drawX, drawY);
          }

          // Expanding directional plasma ripple arc sweeping off nose/wings
          const rippleRx = (26 + p * 74) * gp.scale;
          const rippleRy = rippleRx * 0.45;
          ctx.strokeStyle = isVaporwave ? '#00f5ff' : glowColor;
          ctx.lineWidth = Math.max(1.3, (3.5 - p * 2.3) * gp.scale);
          ctx.globalAlpha = gp.alpha * gp.mergeFlash * 0.82;
          ctx.beginPath();
          ctx.ellipse(drawX, drawY, rippleRx, rippleRy, 0, Math.PI * 0.08, Math.PI * 0.92);
          ctx.stroke();

          // Crisp brief glow flare at nose impact
          const flareR = Math.max(10, (24 - p * 12) * gp.scale);
          ctx.fillStyle = '#ffffff';
          ctx.globalAlpha = gp.alpha * gp.mergeFlash * gp.mergeFlash * 0.48;
          ctx.beginPath();
          ctx.arc(drawX, drawY, flareR, 0, Math.PI * 2);
          ctx.fill();

          // 24 radial liquid-starlight splash droplets
          const dropletCount = 24;
          for (let d = 0; d < dropletCount; d++) {
            const ang = (d / dropletCount) * Math.PI * 2 + p * 0.6;
            const dist = (14 + p * (64 + (d % 4) * 14)) * gp.scale;
            const dx = drawX + Math.cos(ang) * dist;
            const dy = drawY + Math.sin(ang) * dist * 0.72;
            const dr = Math.max(1.4, (3.8 - p * 2.4) * gp.scale);
            ctx.fillStyle = isVaporwave
              ? d % 2 === 0
                ? '#00f5ff'
                : '#ff2a9d'
              : d % 2 === 0
              ? '#ffffff'
              : glowColor;
            ctx.globalAlpha = gp.alpha * gp.mergeFlash * 0.94;
            ctx.beginPath();
            ctx.arc(dx, dy, dr, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
        continue;
      }

      // Limit simultaneous far-horizon corridor words to nearest 5 so sky stays clean & legible
      if (unconsumedCount >= 5) continue;
      unconsumedCount++;

      const pad = 10;
      const halfW = textW * 0.5 + pad;
      const halfH = wordFontPx * 0.54 + pad;
      // Keep exact flight-plane screenY; apply gentle horizontal X separation only if tight words overlap
      let finalX = drawX;
      for (let d = 0; d < drawnCount; d++) {
        const o = d * 4;
        const otherRx0 = this.drawnWordRects[o];
        const otherRy0 = this.drawnWordRects[o + 1];
        const otherRx1 = this.drawnWordRects[o + 2];
        const otherRy1 = this.drawnWordRects[o + 3];
        const oy = Math.min(drawY + halfH, otherRy1) - Math.max(drawY - halfH, otherRy0);
        if (oy <= 0) continue;
        const curRx0 = finalX - halfW;
        const curRx1 = finalX + halfW;
        const ox = Math.min(curRx1, otherRx1) - Math.max(curRx0, otherRx0);
        if (ox > 0) {
          const otherCx = (otherRx0 + otherRx1) * 0.5;
          const dir = finalX >= otherCx ? 1 : -1;
          const shift = Math.min(halfW * 1.4, ox + 10);
          const shifted = Math.max(minX, Math.min(maxX, finalX + dir * shift));
          if (Math.abs(shifted - finalX) > 1) {
            finalX = shifted;
          } else {
            finalX = Math.max(minX, Math.min(maxX, finalX - dir * shift));
          }
        }
      }

      const rx0 = finalX - halfW;
      const ry0 = drawY - halfH;
      const rx1 = finalX + halfW;
      const ry1 = drawY + halfH;

      const o = drawnCount * 4;
      this.drawnWordRects[o] = rx0;
      this.drawnWordRects[o + 1] = ry0;
      this.drawnWordRects[o + 2] = rx1;
      this.drawnWordRects[o + 3] = ry1;
      drawnCount++;

      if (gp.lineIndex >= 0) {
        frame.recordHitRect?.(gp.lineIndex, rx0, ry0, rx1 - rx0, ry1 - ry0);
      }

      // Dark drop halo + accent glow + synthwave cyan-to-magenta gradient / white core typography
      ctx.save();
      ctx.globalAlpha = gp.alpha * (gp.isActive ? 1.0 : 0.92);
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeStyle = isVaporwave ? 'rgba(7, 2, 20, 0.96)' : 'rgba(2, 6, 18, 0.9)';
      ctx.lineWidth = Math.max(4.5, wordFontPx * (isVaporwave ? 0.19 : 0.16));
      ctx.shadowColor = isVaporwave ? 'rgba(7, 2, 20, 0.96)' : 'rgba(2, 6, 18, 0.94)';
      ctx.shadowBlur = 10;
      ctx.strokeText(gp.text, finalX, drawY);

      if (isVaporwave) {
        const halfText = Math.max(24, textW * 0.52);
        const vaporGrad = ctx.createLinearGradient(
          finalX - halfText,
          drawY - wordFontPx * 0.45,
          finalX + halfText,
          drawY + wordFontPx * 0.45
        );
        vaporGrad.addColorStop(0, '#00f5ff');
        vaporGrad.addColorStop(0.48, gp.isActive ? '#f5d0fe' : '#e879f9');
        vaporGrad.addColorStop(1, '#ff2a9d');
        ctx.shadowColor = gp.isActive ? '#00f5ff' : '#ff2a9d';
        ctx.shadowBlur = gp.isActive ? 24 : 16;
        ctx.fillStyle = vaporGrad;
      } else {
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = gp.isActive ? 24 : 14;
        ctx.fillStyle = gp.isActive ? '#ffffff' : frame.palette.textActive;
      }
      ctx.fillText(gp.text, finalX, drawY);
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
      this.renderArcaneOverlay(ctx, frame, width, height);
      return;
    }

    // ONE unified lyric stream: render 3D-projected corridor words & nose splashes during playback
    if (!isBrowsing) {
      this.drawProjectedWords(ctx, frame, focal.left, focalWidth, height);
      this.renderArcaneOverlay(ctx, frame, width, height);
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
