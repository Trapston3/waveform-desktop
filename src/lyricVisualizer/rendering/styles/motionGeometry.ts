// Style: MotionGeometry ("Constellation / Branches / Web")
// Dark-canvas generative motion scenes connecting lyric words word-by-word across
// luminous astronomical constellations, botanical branches, or radial audio webs.
// Strict 60fps with ZERO per-frame heap allocations inside render().

import type { Lyrics, LyricsScriptMode, StyleFrameContext } from '../../core/models';
import {
  clamp01,
  easeOutCubic,
  getFocalRect,
  isTransparentStage,
  isUnsyncedLyrics,
  resolveDisplayLine,
  type ILyricVisualStyle,
  type StyleMeasurementSpec,
} from '../styleInterface';
import { isBlankOrInstrumentalLineText } from '../../core/lrcParser';

const STAR_COUNT = 120;
const MAX_LINE_NODES = 18;

export class MotionGeometryStyle implements ILyricVisualStyle {
  readonly id = 'MotionGeometry' as const;
  readonly name = 'Constellation / Branches / Web';
  readonly webGlEffect = 'none' as const;

  // Fixed typed arrays for background starfield [xNorm, yNorm, phase]
  private readonly stars = new Float32Array(STAR_COUNT * 3);
  // Pre-allocated node screen coordinate scratch buffers
  private readonly nodeX = new Float32Array(MAX_LINE_NODES);
  private readonly nodeY = new Float32Array(MAX_LINE_NODES);
  private readonly nodeRadius = new Float32Array(MAX_LINE_NODES);

  constructor() {
    let seed = 133791;
    const nextRand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < STAR_COUNT; i++) {
      this.stars[i * 3] = nextRand();
      this.stars[i * 3 + 1] = nextRand();
      this.stars[i * 3 + 2] = nextRand() * Math.PI * 2;
    }
  }

  getMeasurementSpec(frame: StyleFrameContext): StyleMeasurementSpec {
    return {
      fontWeight: 600,
      fontSizeMultiplier: 0.95,
      maxLineWidthRatio: 0.85,
      scriptMode: frame.scriptMode ?? 'auto',
      styleId: this.id,
    };
  }

  reset(): void {
    // Nothing dynamic to clear beyond stateless typed buffers
  }

  private computeLineNodeCount(lyrics: Lyrics, lineIdx: number, scriptMode: LyricsScriptMode): {
    words: readonly string[];
    count: number;
  } {
    const line = lyrics.lines[lineIdx];
    const resolved = resolveDisplayLine(line, scriptMode, this.id);
    if (resolved.primaryWords && resolved.primaryWords.length > 0) {
      return {
        words: resolved.primaryWords.map((w) => w.text),
        count: Math.min(MAX_LINE_NODES, resolved.primaryWords.length),
      };
    }
    const split = resolved.primaryText.split(/\s+/).filter(Boolean);
    return {
      words: split,
      count: Math.min(MAX_LINE_NODES, split.length),
    };
  }

  render(ctx: CanvasRenderingContext2D, frame: StyleFrameContext, width: number, height: number): void {
    const focal = getFocalRect(frame, width);
    const focalWidth = focal.width;
    const variation = frame.variationId || 'constellation';
    const isTransparent = isTransparentStage(frame);
    const motion = frame.reduceMotion
      ? 0
      : frame.motionIntensity === 'vivid'
      ? 1.25
      : frame.motionIntensity === 'subtle'
      ? 0.65
      : 1.0;
    const t = frame.timeSeconds || 0;
    const accent = frame.palette.accentPrimary || '#60a5fa';
    const secondary = frame.palette.accentSecondary || '#a78bfa';

    if (!isTransparent) {
      ctx.save();
      ctx.fillStyle = variation === 'branches' ? '#04090a' : '#04060e';
      ctx.fillRect(0, 0, width, height);

      // Subtle atmospheric backdrop halo
      const grad = ctx.createRadialGradient(
        focal.centerX,
        height * 0.5,
        16,
        focal.centerX,
        height * 0.5,
        Math.max(focalWidth, height) * 0.62
      );
      grad.addColorStop(0, accent);
      grad.addColorStop(1, 'rgba(4, 6, 14, 0)');
      ctx.globalAlpha = 0.08 + frame.audio.bassEnergy * 0.07;
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Ambient pinpoint starfield (strongest in Constellation)
      const starBaseAlpha = variation === 'constellation' ? 0.58 : 0.22;
      ctx.fillStyle = '#e2e8f0';
      for (let i = 0; i < STAR_COUNT; i++) {
        const sx = focal.left + this.stars[i * 3] * focalWidth;
        const sy = this.stars[i * 3 + 1] * height;
        const phase = this.stars[i * 3 + 2];
        const twinkle = motion > 0 ? 0.55 + 0.45 * Math.sin(t * 1.8 + phase) : 0.8;
        ctx.globalAlpha = starBaseAlpha * twinkle;
        ctx.fillRect(sx, sy, 1.8, 1.8);
      }
      ctx.restore();
    }

    const lyrics = frame.lyrics;
    if (!lyrics || frame.isInstrumentalGap || frame.activeLineIndex < 0) {
      // Gentle geometric breathing emblem during instrumental gaps
      ctx.save();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.4;
      ctx.globalAlpha = 0.55;
      const r = 24 + (frame.audio.bassEnergy || 0) * 14 * motion;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + t * 0.45 * motion;
        const px = focal.centerX + Math.cos(a) * r;
        const py = height * 0.5 + Math.sin(a) * r;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
      return;
    }

    const line = lyrics.lines[frame.activeLineIndex];
    if (!line || isBlankOrInstrumentalLineText(line.text)) return;

    const { words, count } = this.computeLineNodeCount(lyrics, frame.activeLineIndex, frame.scriptMode ?? 'auto');
    if (count === 0) return;

    const unsynced = isUnsyncedLyrics(frame) || frame.activeWordIndex < 0;
    const activeW = unsynced ? count - 1 : Math.max(0, Math.min(count - 1, frame.activeWordIndex));
    const downbeatPulse = frame.audio.isDownbeat ? 1.28 : frame.audio.beatDetected ? 1.12 : 1.0;
    const scale = typeof frame.fontSizeScale === 'number' ? frame.fontSizeScale : 1.0;
    const fontPx = Math.max(14, Math.min(26, Math.round(18 * scale)));

    const padX = Math.max(48, focalWidth * 0.12);
    const usableW = Math.max(120, focalWidth - padX * 2);
    const cx = focal.centerX;
    const cy = height * 0.5;

    // Populate node geometry according to active variation
    if (variation === 'branches') {
      for (let i = 0; i < count; i++) {
        const u = count === 1 ? 0.5 : i / (count - 1);
        const side = i % 2 === 0 ? -1 : 1;
        const branchLift = Math.sin(u * Math.PI) * Math.min(115, height * 0.2);
        const sway = motion > 0 ? Math.sin(t * 2.1 + i) * 6 : 0;
        this.nodeX[i] = focal.left + padX + u * usableW;
        this.nodeY[i] = cy + side * (36 + (i % 3) * 24) - branchLift * 0.25 + sway;
        this.nodeRadius[i] = i === activeW ? 6.5 * downbeatPulse : 4.2;
      }
    } else if (variation === 'web') {
      const rxMax = Math.min(usableW * 0.44, height * 0.34);
      const vib = motion > 0 ? frame.audio.bassEnergy * 10 * downbeatPulse : 0;
      for (let i = 0; i < count; i++) {
        const ring = 0.36 + 0.62 * ((i + 0.5) / Math.max(1, count));
        const angle = -Math.PI * 0.5 + (i / Math.max(1, count)) * Math.PI * 2 + (motion > 0 ? Math.sin(t * 0.6) * 0.04 : 0);
        this.nodeX[i] = cx + Math.cos(angle) * (rxMax * ring + vib);
        this.nodeY[i] = cy + Math.sin(angle) * (rxMax * 0.72 * ring + vib * 0.7);
        this.nodeRadius[i] = i === activeW ? 6.5 * downbeatPulse : 4.0;
      }
    } else {
      // Constellation: celestial zig-zag arc across stage
      const seedOffset = ((frame.activeLineIndex * 97) % 100) / 100;
      for (let i = 0; i < count; i++) {
        const u = count === 1 ? 0.5 : i / (count - 1);
        const arcY = Math.sin(u * Math.PI * 1.45 + seedOffset * Math.PI) * Math.min(115, height * 0.22);
        const drift = motion > 0 ? Math.sin(t * 1.2 + i * 0.9) * 4 : 0;
        this.nodeX[i] = focal.left + padX + u * usableW;
        this.nodeY[i] = cy + arcY + drift;
        this.nodeRadius[i] = i === activeW ? 7.0 * downbeatPulse : 4.2;
      }
    }

    ctx.save();

    // Draw background Web radial grid for 'web' variation
    if (variation === 'web') {
      const rxMax = Math.min(usableW * 0.46, height * 0.36);
      const vibOffset = motion > 0 ? frame.audio.bassEnergy * 6 * downbeatPulse : 0;
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.16)';
      ctx.lineWidth = 1;
      for (let ring = 1; ring <= 4; ring++) {
        const rr = (ring / 4) * rxMax + vibOffset * 0.4;
        ctx.beginPath();
        for (let s = 0; s <= 10; s++) {
          const a = (s / 10) * Math.PI * 2;
          const px = cx + Math.cos(a) * rr;
          const py = cy + Math.sin(a) * rr * 0.72;
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      for (let s = 0; s < 10; s++) {
        const a = (s / 10) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * rxMax, cy + Math.sin(a) * rxMax * 0.72);
        ctx.stroke();
      }
    }

    // Draw luminous main organic stem in 'branches' variation
    if (variation === 'branches') {
      const startX = focal.left + padX * 0.5;
      const endX = focal.left + padX + usableW * clamp01((activeW + easeOutCubic(frame.wordProgress || 0.5)) / Math.max(1, count - 0.5));
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2.6;
      ctx.globalAlpha = 0.85 * frame.lineFadeAlpha;
      ctx.beginPath();
      ctx.moveTo(startX, cy + 28);
      ctx.bezierCurveTo(cx - usableW * 0.2, cy - 18, cx + usableW * 0.2, cy + 18, endX, cy - 10);
      ctx.stroke();
    }

    // Draw connecting segments up to active word
    for (let i = 0; i < count; i++) {
      if (i > activeW) break;
      const x1 = this.nodeX[i];
      const y1 = this.nodeY[i];

      if (variation === 'branches') {
        const rootX = focal.left + padX + (count === 1 ? 0.5 : i / (count - 1)) * usableW * 0.88;
        const rootY = cy + 6;
        ctx.strokeStyle = i === activeW ? secondary : accent;
        ctx.lineWidth = i === activeW ? 2.1 : 1.4;
        ctx.globalAlpha = (i === activeW ? 0.95 : 0.65) * frame.lineFadeAlpha;
        ctx.beginPath();
        ctx.moveTo(rootX, rootY);
        ctx.quadraticCurveTo((rootX + x1) * 0.5, rootY, x1, y1);
        ctx.stroke();
      } else if (i > 0) {
        const x0 = this.nodeX[i - 1];
        const y0 = this.nodeY[i - 1];
        const segProgress = i === activeW ? easeOutCubic(clamp01((frame.wordProgress || 0.25) * 1.6)) : 1.0;
        const drawToX = x0 + (x1 - x0) * segProgress;
        const drawToY = y0 + (y1 - y0) * segProgress;

        ctx.shadowColor = accent;
        ctx.shadowBlur = i === activeW ? 16 : 8;
        ctx.strokeStyle = i === activeW ? '#ffffff' : accent;
        ctx.lineWidth = i === activeW ? 2.2 : 1.5;
        ctx.globalAlpha = (i === activeW ? 0.95 : 0.72) * frame.lineFadeAlpha;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(drawToX, drawToY);
        ctx.stroke();
      }
    }

    // Draw word star/leaf/web nodes & labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${fontPx}px ${frame.fontFamily}`;

    for (let i = 0; i < count; i++) {
      const nx = this.nodeX[i];
      const ny = this.nodeY[i];
      const isActive = !unsynced && i === activeW;
      const isLit = unsynced || i <= activeW;
      const r = this.nodeRadius[i];

      ctx.shadowColor = isActive ? secondary : accent;
      ctx.shadowBlur = isActive ? 22 : isLit ? 10 : 0;
      ctx.fillStyle = isActive ? '#ffffff' : isLit ? accent : 'rgba(226, 232, 240, 0.25)';
      ctx.globalAlpha = (isActive ? 1.0 : isLit ? 0.88 : 0.32) * frame.lineFadeAlpha;
      ctx.beginPath();
      ctx.arc(nx, ny, r, 0, Math.PI * 2);
      ctx.fill();

      // Label above or below alternating so consecutive words never collide
      const labelOffsetY = i % 2 === 0 ? -(fontPx * 1.15) : fontPx * 1.15;
      ctx.shadowBlur = isActive ? 14 : 4;
      ctx.fillStyle = isActive ? '#ffffff' : isLit ? '#e2e8f0' : 'rgba(226, 232, 240, 0.34)';
      ctx.fillText(words[i], nx, ny + labelOffsetY);
    }

    ctx.restore();
  }
}
