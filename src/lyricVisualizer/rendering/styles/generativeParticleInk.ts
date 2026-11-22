// Style: GenerativeParticleInk
// Variations:
//  0: 'pure-ink' (default)     - calligraphic ink bursts + ink-wash bloom on active words
//  1: 'spectrum-ribbon'        - multi-layered 3-band glowing FFT spectrum ribbons behind lyrics
//  2: 'ink-ribbon-hybrid'      - both ink particles/bloom and 3-band FFT ribbons combined
// Zero per-frame heap allocations (preallocated Float32Array particle pool & FFT wave buffers).

import type { StyleFrameContext } from '../../core/models';
import {
  clamp01,
  drawEmptyState,
  drawRoundedRectPath,
  getFocalRect,
  isTransparentStage,
  isUnsyncedLyrics,
  type ILyricVisualStyle,
  type StyleMeasurementSpec,
} from '../styleInterface';

const PARTICLE_COUNT = 160;
const STRIDE = 8; // x, y, vx, vy, life, maxLife, size, kind (0=ink droplet, 1=glowing ember)
const RIBBON_SEGMENTS = 56;
const RIBBON_STRIDE = RIBBON_SEGMENTS + 1;

export class GenerativeParticleInkStyle implements ILyricVisualStyle {
  readonly id = 'GenerativeParticleInk' as const;
  readonly name = 'Particle Ink';
  readonly webGlEffect = 'none' as const;

  // Pre-allocated flat typed-array particle pool & FFT ribbon buffers (zero GC in render loop)
  private readonly pool = new Float32Array(PARTICLE_COUNT * STRIDE);
  private readonly ribbonX = new Float32Array(RIBBON_STRIDE);
  private readonly ribbonY = new Float32Array(RIBBON_STRIDE * 3);
  private readonly ribbonHarmonicY = new Float32Array(RIBBON_STRIDE * 3);

  private writeCursor = 0;
  private lastLineIndex = -1;
  private lastWordIndex = -1;
  private prngState = 0x1337c0de;
  private scrollY = 0;
  private initialized = false;

  getVariationIndex(variationId?: string): 0 | 1 | 2 {
    if (variationId === 'spectrum-ribbon') return 1;
    if (variationId === 'ink-ribbon-hybrid') return 2;
    return 0;
  }

  getMeasurementSpec(): StyleMeasurementSpec {
    return {
      fontWeight: 700,
      fontSizeMultiplier: 1.06,
      maxLineWidthRatio: 0.82,
    };
  }

  reset(): void {
    this.pool.fill(0);
    this.writeCursor = 0;
    this.lastLineIndex = -1;
    this.lastWordIndex = -1;
    this.scrollY = 0;
    this.initialized = false;
  }

  private nextRand(): number {
    this.prngState = (Math.imul(this.prngState, 1664525) + 1013904223) >>> 0;
    return this.prngState / 0xffffffff;
  }

  private emitBurst(originX: number, originY: number, count: number, energy: number): void {
    for (let i = 0; i < count; i++) {
      const idx = this.writeCursor * STRIDE;
      this.writeCursor = (this.writeCursor + 1) % PARTICLE_COUNT;

      const angle = this.nextRand() * Math.PI * 2;
      const speed = 28 + this.nextRand() * (110 + energy * 140);
      this.pool[idx] = originX + (this.nextRand() - 0.5) * 28;
      this.pool[idx + 1] = originY + (this.nextRand() - 0.5) * 14;
      this.pool[idx + 2] = Math.cos(angle) * speed;
      this.pool[idx + 3] = Math.sin(angle) * speed - 22;
      const maxLife = 0.65 + this.nextRand() * 1.15;
      this.pool[idx + 4] = maxLife;
      this.pool[idx + 5] = maxLife;
      this.pool[idx + 6] = 2.0 + this.nextRand() * (4.5 + energy * 3.0);
      this.pool[idx + 7] = this.nextRand() > 0.45 ? 1 : 0;
    }
  }

  private renderSpectrumRibbons(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    width: number,
    height: number,
    isTransparent: boolean
  ): void {
    const t = frame.reduceMotion ? 0.5 : frame.timeSeconds;
    const baseY = height * 0.51;
    const stepX = width / RIBBON_SEGMENTS;
    const beatBoost = frame.audio.beatDetected || (frame.audio.beatStrength ?? 0) > 0.7 ? 16 : 0;

    for (let s = 0; s <= RIBBON_SEGMENTS; s++) {
      this.ribbonX[s] = s * stepX;
    }

    for (let band = 0; band < 3; band++) {
      const energy =
        band === 0
          ? frame.audio.bassEnergy
          : band === 1
          ? frame.audio.midEnergy
          : frame.audio.trebleEnergy;
      const freq = band === 0 ? 1.8 : band === 1 ? 3.4 : 5.6;
      const speed = band === 0 ? 1.15 : band === 1 ? 1.85 : 2.65;
      const amp =
        (16 + energy * 76 + beatBoost) * (band === 0 ? 1.18 : band === 1 ? 0.88 : 0.62);
      const yOffset = (band - 1) * 34;
      const bandOffset = band * RIBBON_STRIDE;

      for (let s = 0; s <= RIBBON_SEGMENTS; s++) {
        const nx = s / RIBBON_SEGMENTS;
        const env = Math.sin(nx * Math.PI);
        const primaryWave =
          Math.sin(nx * Math.PI * freq + t * speed) * 0.65 +
          Math.cos(nx * Math.PI * (freq * 1.7) - t * (speed * 0.8)) * 0.35;
        const harmonicWave =
          Math.sin(nx * Math.PI * (freq * 2.2) - t * (speed * 1.25)) * 0.5 +
          Math.cos(nx * Math.PI * freq + t * (speed * 0.6)) * 0.5;
        this.ribbonY[bandOffset + s] = baseY + yOffset + primaryWave * amp * env;
        this.ribbonHarmonicY[bandOffset + s] =
          baseY + yOffset + harmonicWave * amp * 0.62 * env;
      }
    }

    ctx.save();
    for (let band = 0; band < 3; band++) {
      const energy =
        band === 0
          ? frame.audio.bassEnergy
          : band === 1
          ? frame.audio.midEnergy
          : frame.audio.trebleEnergy;
      const color =
        band === 0
          ? frame.palette.accentPrimary
          : band === 1
          ? frame.palette.accentSecondary
          : frame.palette.textActive;
      const bandOffset = band * RIBBON_STRIDE;

      // Secondary harmonic ribbon shimmer
      ctx.beginPath();
      for (let s = 0; s <= RIBBON_SEGMENTS; s++) {
        const rx = this.ribbonX[s];
        const ry = this.ribbonHarmonicY[bandOffset + s];
        if (s === 0) ctx.moveTo(rx, ry);
        else ctx.lineTo(rx, ry);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = band === 0 ? 1.6 : 1.1;
      ctx.globalAlpha = (isTransparent ? 0.2 : 0.32) * (0.5 + energy * 0.5);
      ctx.shadowBlur = 0;
      ctx.stroke();

      // Primary glowing FFT wave ribbon
      ctx.beginPath();
      for (let s = 0; s <= RIBBON_SEGMENTS; s++) {
        const rx = this.ribbonX[s];
        const ry = this.ribbonY[bandOffset + s];
        if (s === 0) ctx.moveTo(rx, ry);
        else ctx.lineTo(rx, ry);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = band === 0 ? 3.4 : band === 1 ? 2.3 : 1.5;
      ctx.globalAlpha = (isTransparent ? 0.45 : 0.74) * (0.6 + energy * 0.4);
      ctx.shadowColor = color;
      ctx.shadowBlur = band === 0 ? 20 : 12;
      ctx.stroke();
    }
    ctx.restore();
  }

  render(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    width: number,
    height: number
  ): void {
    const isTransparent = isTransparentStage(frame);
    const dt = Math.max(0, Math.min(0.05, frame.deltaSeconds));
    const varIdx = this.getVariationIndex(frame.variationId);
    const showInk = varIdx === 0 || varIdx === 2;
    const showRibbons = varIdx === 1 || varIdx === 2;

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
      const bg = ctx.createRadialGradient(
        width * 0.5,
        height * 0.5,
        24,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.82
      );
      bg.addColorStop(0, frame.palette.bgMid);
      bg.addColorStop(1, frame.palette.bgDeep);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

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
        vig.addColorStop(1, `rgba(4, 6, 12, ${(0.72 * vigStrength).toFixed(3)})`);
        ctx.globalAlpha = 1;
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, width, height);
      }
      ctx.restore();
    }

    if (showRibbons) {
      this.renderSpectrumRibbons(ctx, frame, width, height, isTransparent);
    }

    const layout = frame.layout;
    if (!layout || layout.lines.length === 0) {
      drawEmptyState(ctx, frame, width, height);
      return;
    }

    const activeIdx = Math.max(0, Math.min(layout.lines.length - 1, frame.activeLineIndex));
    const activeLine = layout.lines[activeIdx];
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
    const cy = height * 0.49;
    const isLeftAlign = frame.textAlign === 'left';
    const leftPad = Math.max(28, Math.round(focal.width * 0.08));
    const activeBaseX = isLeftAlign ? leftPad : activeLine.x;
    const activeScreenY = cy + (activeLine.y + activeLine.height * 0.5 - effectiveScrollY) - activeLine.height * 0.5;

    if (showInk) {
      // Emit burst on new word strike or beat spike
      const wordChanged =
        frame.activeLineIndex !== this.lastLineIndex ||
        frame.activeWordIndex !== this.lastWordIndex;
      if (wordChanged) {
        this.lastLineIndex = frame.activeLineIndex;
        this.lastWordIndex = frame.activeWordIndex;
        if (!frame.reduceMotion) {
          const activeWord =
            activeLine.words[
              Math.max(0, Math.min(activeLine.words.length - 1, frame.activeWordIndex))
            ];
          const ex = activeWord
            ? focal.left + activeBaseX + activeWord.x + activeWord.width * 0.5
            : focal.centerX;
          const ey = activeWord
            ? activeScreenY + activeWord.y + activeWord.height * 0.5
            : cy;
          this.emitBurst(ex, ey, 14, frame.audio.rmsLevel + frame.audio.trebleEnergy);
        }
      } else if (frame.audio.beatDetected && !frame.reduceMotion) {
        this.emitBurst(focal.centerX, cy, 8, frame.audio.bassEnergy + frame.audio.trebleEnergy);
      }

      // Update & render flow-field particles (zero allocations)
      if (!frame.reduceMotion) {
        ctx.save();
        const t = frame.timeSeconds;
        const trebleBoost = 1 + frame.audio.trebleEnergy * 1.4;
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          const idx = i * STRIDE;
          let life = this.pool[idx + 4];
          if (life <= 0) continue;

          life -= dt;
          this.pool[idx + 4] = life;
          if (life <= 0) continue;

          const px = this.pool[idx];
          const py = this.pool[idx + 1];
          const flowAngle =
            Math.sin(px * 0.008 + t * 0.9) * Math.cos(py * 0.008 - t * 0.7) * Math.PI * 2;
          const vx = this.pool[idx + 2] * 0.975 + Math.cos(flowAngle) * 26 * dt * trebleBoost;
          const vy =
            this.pool[idx + 3] * 0.975 + Math.sin(flowAngle) * 26 * dt * trebleBoost - 12 * dt;

          this.pool[idx] = px + vx * dt;
          this.pool[idx + 1] = py + vy * dt;
          this.pool[idx + 2] = vx;
          this.pool[idx + 3] = vy;

          const normLife = life / Math.max(0.001, this.pool[idx + 5]);
          const radius = Math.max(0.8, this.pool[idx + 6] * normLife);
          const isEmber = this.pool[idx + 7] > 0.5;

          ctx.globalAlpha = normLife * (isEmber ? 0.85 : 0.52);
          ctx.fillStyle = isEmber ? frame.palette.accentPrimary : frame.palette.accentSecondary;
          ctx.beginPath();
          ctx.arc(this.pool[idx], this.pool[idx + 1], radius, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }

    // Render illuminated lyrics over ink flow field / spectrum ribbons
    const fontSize = layout.fontSizePx;
    const unsyncedOrLineLevel = isUnsyncedLyrics(frame) || frame.activeWordIndex < 0;
    const hoveredIdx = typeof frame.hoveredLineIndex === 'number' ? frame.hoveredLineIndex : -1;

    ctx.save();
    if (focal.left > 2) {
      ctx.beginPath();
      ctx.rect(focal.left, 0, Math.max(1, width - focal.left), height);
      ctx.clip();
    }
    if (focal.left > 0) {
      ctx.translate(focal.left, 0);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    for (let i = 0; i < layout.lines.length; i++) {
      const line = layout.lines[i];
      const lineCenterOffset = line.y + line.height * 0.5 - effectiveScrollY;
      const screenY = cy + lineCenterOffset - line.height * 0.5;

      if (screenY + line.height < -60 || screenY > height + 60) continue;
      if (!isBrowsing && Math.abs(i - activeIdx) > 1) continue;

      const isActive = i === activeIdx;
      const isHovered = i === hoveredIdx;
      const lineBaseX = isLeftAlign ? leftPad : line.x;

      const hitLocalX = Math.max(8, lineBaseX - 16);
      const hitW = Math.min(focal.width - hitLocalX - 8, Math.max(line.width + 32, 160));
      frame.recordHitRect?.(i, focal.left + hitLocalX, screenY - 6, hitW, line.height + 12);

      if (isHovered) {
        ctx.save();
        drawRoundedRectPath(ctx, hitLocalX, screenY - 6, hitW, line.height + 12, 10);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.fill();
        ctx.strokeStyle = frame.palette.accentPrimary;
        ctx.globalAlpha = 0.42;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();
      }

      if (isActive && isBrowsing) {
        ctx.save();
        ctx.fillStyle = frame.palette.accentPrimary;
        ctx.globalAlpha = 0.9;
        drawRoundedRectPath(ctx, Math.max(4, hitLocalX - 8), screenY + 4, 4, Math.max(16, line.height - 8), 2);
        ctx.fill();
        ctx.restore();
      }

      if (isActive) {
        ctx.font = `700 ${fontSize}px ${frame.fontFamily}`;
        for (let w = 0; w < line.words.length; w++) {
          const word = line.words[w];
          const wx = lineBaseX + word.x;
          const wy = screenY + word.y;
          const isCurrent = unsyncedOrLineLevel ? true : w === frame.activeWordIndex;
          const isPast = !unsyncedOrLineLevel && w < frame.activeWordIndex;

          // Calligraphic ink-wash bloom behind active word when ink variation is active
          if (showInk && isCurrent && !isTransparent) {
            ctx.save();
            const washCx = wx + word.width * 0.5;
            const washCy = wy + word.height * 0.45;
            const washR = Math.max(24, Math.min(110, word.width * 0.72));
            const wash = ctx.createRadialGradient(washCx, washCy, 2, washCx, washCy, washR);
            wash.addColorStop(0, frame.palette.accentPrimary);
            wash.addColorStop(0.55, frame.palette.accentSecondary);
            wash.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.globalAlpha = (0.24 + frame.audio.rmsLevel * 0.16) * frame.lineFadeAlpha;
            ctx.fillStyle = wash;
            ctx.beginPath();
            ctx.arc(washCx, washCy, washR, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }

          ctx.globalAlpha = (isCurrent ? 1.0 : isPast ? 0.9 : isHovered ? 0.62 : 0.38) * frame.lineFadeAlpha;
          ctx.fillStyle = isCurrent
            ? '#ffffff'
            : isPast
            ? frame.palette.textActive
            : frame.palette.textUpcoming;
          ctx.shadowColor = isCurrent ? frame.palette.accentPrimary : 'rgba(0,0,0,0.6)';
          ctx.shadowBlur = isCurrent ? 18 + frame.audio.rmsLevel * 12 : 4;
          ctx.fillText(word.text, wx, wy);
        }
      } else {
        const subScale = isBrowsing ? 0.88 : 0.62;
        const subFontSize = Math.max(14, Math.round(fontSize * subScale));
        ctx.save();
        ctx.font = `500 ${subFontSize}px ${frame.fontFamily}`;
        ctx.fillStyle = frame.palette.textUpcoming;
        ctx.globalAlpha = isHovered ? 0.78 : 0.42;
        ctx.shadowBlur = 0;
        for (let w = 0; w < line.words.length; w++) {
          const word = line.words[w];
          ctx.fillText(word.text, lineBaseX + word.x * subScale, screenY + word.y * subScale);
        }
        ctx.restore();
      }
    }

    ctx.restore();
  }
}
