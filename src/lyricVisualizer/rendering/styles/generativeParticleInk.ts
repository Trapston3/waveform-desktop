// Style 9: GenerativeParticleInk
// Particle flow field emitting ink droplets & glowing embers synchronized with word strikes
// and RMS/treble energy. Zero allocations inside hot frame loop (pre-allocated Float32Array pool!).

import type { StyleFrameContext } from '../../core/models';
import {
  drawEmptyState,
  getActiveLine,
  type ILyricVisualStyle,
} from '../styleInterface';

const PARTICLE_COUNT = 160;
const STRIDE = 8; // x, y, vx, vy, life, maxLife, size, kind (0=ink droplet, 1=glowing ember)

export class GenerativeParticleInkStyle implements ILyricVisualStyle {
  readonly id = 'GenerativeParticleInk' as const;
  readonly name = 'Particle Ink';
  readonly webGlEffect = 'none' as const;

  // Pre-allocated flat typed-array particle pool (zero GC pressure in render loop)
  private readonly pool = new Float32Array(PARTICLE_COUNT * STRIDE);
  private writeCursor = 0;
  private lastLineIndex = -1;
  private lastWordIndex = -1;
  private prngState = 0x1337c0de;

  reset(): void {
    this.pool.fill(0);
    this.writeCursor = 0;
    this.lastLineIndex = -1;
    this.lastWordIndex = -1;
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

  render(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    width: number,
    height: number
  ): void {
    const isOverlay = Boolean(frame.isOverlayMode);
    const dt = Math.max(0, Math.min(0.05, frame.deltaSeconds));

    if (!isOverlay) {
      const bg = ctx.createRadialGradient(
        width * 0.5,
        height * 0.5,
        24,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.8
      );
      bg.addColorStop(0, frame.palette.bgMid);
      bg.addColorStop(1, frame.palette.bgDeep);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
    }

    const { line, measured } = getActiveLine(frame);
    if (!line || !measured || !frame.layout) {
      drawEmptyState(ctx, frame, width, height);
      return;
    }

    const cy = height * 0.5;
    const startY = cy - measured.height * 0.5;

    // Emit burst on new word strike or beat spike
    const wordChanged =
      frame.activeLineIndex !== this.lastLineIndex ||
      frame.activeWordIndex !== this.lastWordIndex;
    if (wordChanged) {
      this.lastLineIndex = frame.activeLineIndex;
      this.lastWordIndex = frame.activeWordIndex;
      if (!frame.reduceMotion) {
        const activeWord =
          measured.words[Math.max(0, Math.min(measured.words.length - 1, frame.activeWordIndex))];
        const ex = activeWord ? measured.x + activeWord.x + activeWord.width * 0.5 : width * 0.5;
        const ey = activeWord ? startY + activeWord.y + activeWord.height * 0.5 : cy;
        this.emitBurst(ex, ey, 14, frame.audio.rmsLevel + frame.audio.trebleEnergy);
      }
    } else if (frame.audio.beatDetected && !frame.reduceMotion) {
      this.emitBurst(width * 0.5, cy, 8, frame.audio.bassEnergy + frame.audio.trebleEnergy);
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
        // Curl-like trig flow field
        const flowAngle = Math.sin(px * 0.008 + t * 0.9) * Math.cos(py * 0.008 - t * 0.7) * Math.PI * 2;
        const vx = this.pool[idx + 2] * 0.975 + Math.cos(flowAngle) * 26 * dt * trebleBoost;
        const vy = this.pool[idx + 3] * 0.975 + Math.sin(flowAngle) * 26 * dt * trebleBoost - 12 * dt;

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

    // Render illuminated lyrics over ink flow field
    const fontSize = Math.round(frame.layout.fontSizePx * 1.06);
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `700 ${fontSize}px ${frame.fontFamily}`;

    for (let w = 0; w < measured.words.length; w++) {
      const word = measured.words[w];
      const wx = measured.x + word.x;
      const wy = startY + word.y;
      const isCurrent = w === frame.activeWordIndex;
      const isPast = w < frame.activeWordIndex;

      ctx.globalAlpha = (isCurrent ? 1.0 : isPast ? 0.88 : 0.36) * frame.lineFadeAlpha;
      ctx.fillStyle = isCurrent
        ? '#ffffff'
        : isPast
        ? frame.palette.textActive
        : frame.palette.textUpcoming;
      ctx.shadowColor = isCurrent ? frame.palette.accentPrimary : 'transparent';
      ctx.shadowBlur = isCurrent ? 18 + frame.audio.rmsLevel * 12 : 0;
      ctx.fillText(word.text, wx, wy);
    }

    ctx.restore();
  }
}
