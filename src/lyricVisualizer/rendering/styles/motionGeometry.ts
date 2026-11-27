// Style: MotionGeometry ("Constellation / Branches / Web")
// Dark-canvas generative motion scenes connecting lyric words word-by-word across
// luminous astronomical constellations, botanical branches, or radial audio webs.
// Strict 60fps with ZERO per-frame heap allocations inside render().

import type { Lyrics, LyricsScriptMode, StyleFrameContext } from '../../core/models';
import {
  clamp01,
  easeOutBack,
  easeOutCubic,
  getFocalRect,
  isTransparentStage,
  isUnsyncedLyrics,
  resolveDisplayLine,
  type ILyricVisualStyle,
  type StyleMeasurementSpec,
} from '../styleInterface';
import { isBlankOrInstrumentalLineText } from '../../core/lrcParser';
import { detectMagicWordEffect } from '../lyricSemantics';
import {
  drawInlineWordIconPop,
  drawSemanticWordMicroFx,
  resolveWordIcon,
} from '../wordIconDictionary';

const STAR_COUNT = 120;
const MAX_LINE_NODES = 18;
const WORD_POOL_STRIDE = 4;

function drawFourPointStarFlare(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outerR: number,
  innerR: number
): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - outerR);
  ctx.quadraticCurveTo(cx + innerR, cy - innerR, cx + outerR, cy);
  ctx.quadraticCurveTo(cx + innerR, cy + innerR, cx, cy + outerR);
  ctx.quadraticCurveTo(cx - innerR, cy + innerR, cx - outerR, cy);
  ctx.quadraticCurveTo(cx - innerR, cy - innerR, cx, cy - outerR);
  ctx.closePath();
}

export class MotionGeometryStyle implements ILyricVisualStyle {
  readonly id = 'MotionGeometry' as const;
  readonly name = 'Constellation / Branches / Web';
  readonly webGlEffect = 'none' as const;

  // Fixed typed arrays for multi-scale starfield [xNorm, yNorm, phase, sizeNorm]
  private readonly stars = new Float32Array(STAR_COUNT * WORD_POOL_STRIDE);
  // Pre-allocated node & non-overlapping screen label scratch buffers
  private readonly nodeX = new Float32Array(MAX_LINE_NODES);
  private readonly nodeY = new Float32Array(MAX_LINE_NODES);
  private readonly nodeRadius = new Float32Array(MAX_LINE_NODES);
  private readonly labelBoxes = new Float32Array(MAX_LINE_NODES * 4);

  private camX = 0;
  private camY = 0;
  private camInitialized = false;
  private vibrationEnergy = 0;

  constructor() {
    let seed = 133791;
    const nextRand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < STAR_COUNT; i++) {
      const b = i * WORD_POOL_STRIDE;
      this.stars[b] = nextRand();
      this.stars[b + 1] = nextRand();
      this.stars[b + 2] = nextRand() * Math.PI * 2;
      this.stars[b + 3] = 0.45 + Math.pow(nextRand(), 2.2) * 1.45;
    }
  }

  getMeasurementSpec(frame: StyleFrameContext): StyleMeasurementSpec {
    return {
      fontWeight: 700,
      fontSizeMultiplier: 1.05,
      maxLineWidthRatio: 0.85,
      scriptMode: frame.scriptMode ?? 'auto',
      styleId: this.id,
    };
  }

  reset(): void {
    this.camX = 0;
    this.camY = 0;
    this.camInitialized = false;
    this.vibrationEnergy = 0;
  }

  private computeLineNodeCount(
    lyrics: Lyrics,
    lineIdx: number,
    scriptMode: LyricsScriptMode
  ): {
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

  private drawBackdrop(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    variation: string,
    focalLeft: number,
    focalWidth: number,
    focalCenterX: number,
    width: number,
    height: number,
    t: number,
    motion: number,
    accent: string,
    secondary: string
  ): void {
    ctx.save();
    ctx.fillStyle =
      variation === 'branches' ? '#050608' : variation === 'web' ? '#04060b' : '#03050d';
    ctx.fillRect(0, 0, width, height);

    const bass = frame.audio.bassEnergy || 0;
    const nebulaR = Math.max(focalWidth, height) * 0.72;

    if (variation === 'constellation') {
      // Deep nebula mist clouds
      const nebA = ctx.createRadialGradient(
        focalCenterX - focalWidth * 0.18,
        height * 0.36,
        20,
        focalCenterX - focalWidth * 0.12,
        height * 0.42,
        nebulaR
      );
      nebA.addColorStop(0, accent);
      nebA.addColorStop(0.55, secondary);
      nebA.addColorStop(1, 'rgba(3, 5, 13, 0)');
      ctx.globalAlpha = 0.14 + bass * 0.08;
      ctx.fillStyle = nebA;
      ctx.fillRect(0, 0, width, height);

      const nebB = ctx.createRadialGradient(
        focalCenterX + focalWidth * 0.22,
        height * 0.66,
        16,
        focalCenterX + focalWidth * 0.18,
        height * 0.62,
        nebulaR * 0.85
      );
      nebB.addColorStop(0, secondary);
      nebB.addColorStop(1, 'rgba(3, 5, 13, 0)');
      ctx.globalAlpha = 0.11 + bass * 0.06;
      ctx.fillStyle = nebB;
      ctx.fillRect(0, 0, width, height);

      // Subtle celestial coordinate rings & degree tick marks
      const ringR = Math.min(focalWidth, height) * 0.41;
      const rot = t * 0.03 * motion;
      ctx.save();
      ctx.translate(focalCenterX, height * 0.5);
      ctx.rotate(rot);
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.09)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, ringR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, ringR * 0.68, 0, Math.PI * 2);
      ctx.stroke();

      for (let d = 0; d < 24; d++) {
        const ang = (d / 24) * Math.PI * 2;
        const inner = d % 6 === 0 ? ringR - 10 : ringR - 5;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * inner, Math.sin(ang) * inner);
        ctx.lineTo(Math.cos(ang) * ringR, Math.sin(ang) * ringR);
        ctx.stroke();
      }
      ctx.restore();
    } else if (variation === 'branches') {
      // Warm obsidian & gold-ink atmosphere
      const inkGlow = ctx.createRadialGradient(
        focalCenterX,
        height * 0.48,
        24,
        focalCenterX,
        height * 0.5,
        nebulaR * 0.9
      );
      inkGlow.addColorStop(0, '#f5d08a');
      inkGlow.addColorStop(0.42, accent);
      inkGlow.addColorStop(1, 'rgba(5, 6, 8, 0)');
      ctx.globalAlpha = 0.09 + bass * 0.07;
      ctx.fillStyle = inkGlow;
      ctx.fillRect(0, 0, width, height);
    } else {
      const webGlow = ctx.createRadialGradient(
        focalCenterX,
        height * 0.5,
        18,
        focalCenterX,
        height * 0.5,
        nebulaR * 0.85
      );
      webGlow.addColorStop(0, accent);
      webGlow.addColorStop(0.55, secondary);
      webGlow.addColorStop(1, 'rgba(4, 6, 11, 0)');
      ctx.globalAlpha = 0.1 + bass * 0.08;
      ctx.fillStyle = webGlow;
      ctx.fillRect(0, 0, width, height);
    }

    // Multi-scale twinkling starfield
    const starAlpha = variation === 'constellation' ? 0.78 : variation === 'web' ? 0.34 : 0.2;
    for (let i = 0; i < STAR_COUNT; i++) {
      const b = i * WORD_POOL_STRIDE;
      const sx = focalLeft + this.stars[b] * focalWidth;
      const sy = this.stars[b + 1] * height;
      const phase = this.stars[b + 2];
      const sz = this.stars[b + 3];
      const twinkle = motion > 0 ? 0.48 + 0.52 * Math.sin(t * 1.9 + phase) : 0.82;
      ctx.globalAlpha = starAlpha * twinkle;
      ctx.fillStyle = i % 7 === 0 ? accent : '#f8fafc';
      if (sz > 1.35 && variation === 'constellation') {
        drawFourPointStarFlare(ctx, sx, sy, sz * 2.4, sz * 0.45);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(sx, sy, sz, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawHeroWordLabel(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    fontPx: number,
    fontFamily: string,
    isActive: boolean,
    isLit: boolean,
    glowColor: string,
    alpha: number,
    minX: number,
    maxX: number,
    wordProgress: number,
    timeSeconds: number,
    motionScale: number,
    wordIconsEnabled: boolean,
    accentPrimary: string,
    accentSecondary: string
  ): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${isActive ? 800 : 700} ${fontPx}px ${fontFamily}`;
    const textW = ctx.measureText(text).width;
    const halfW = textW * 0.5 + 14;
    const clampedX = Math.max(minX + halfW, Math.min(maxX - halfW, x));
    const wordLeft = clampedX - textW * 0.5;
    const wordTop = y - fontPx * 0.5;

    ctx.globalAlpha = alpha;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = 'rgba(2, 4, 10, 0.92)';
    ctx.lineWidth = Math.max(4, fontPx * 0.14);
    ctx.strokeText(text, clampedX, y);

    ctx.shadowColor = glowColor;
    ctx.shadowBlur = isActive ? 24 : isLit ? 12 : 0;
    ctx.fillStyle = isActive ? '#ffffff' : isLit ? '#f1f5f9' : 'rgba(203, 213, 225, 0.36)';
    ctx.fillText(text, clampedX, y);

    if (wordIconsEnabled && (isActive || isLit)) {
      const iconId = resolveWordIcon(text);
      if (iconId) {
        drawInlineWordIconPop(
          ctx,
          iconId,
          wordLeft,
          wordTop,
          textW,
          fontPx,
          isActive ? '#ffffff' : glowColor,
          wordProgress,
          isActive,
          motionScale <= 0
        );
      }
    }

    if (isActive && motionScale > 0) {
      const magic = detectMagicWordEffect(text);
      if (magic) {
        drawSemanticWordMicroFx(
          ctx,
          magic,
          wordLeft,
          wordTop,
          textW,
          fontPx,
          timeSeconds,
          accentPrimary,
          accentSecondary,
          motionScale
        );
      }
    }
    ctx.restore();
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
    const dt = Math.max(0.001, Math.min(0.05, frame.deltaSeconds || 1 / 60));
    const accent = frame.palette.accentPrimary || '#60a5fa';
    const secondary = frame.palette.accentSecondary || '#a78bfa';

    if (!isTransparent) {
      this.drawBackdrop(
        ctx,
        frame,
        variation,
        focal.left,
        focalWidth,
        focal.centerX,
        width,
        height,
        t,
        motion,
        accent,
        secondary
      );
    }

    const lyrics = frame.lyrics;
    if (!lyrics || frame.isInstrumentalGap || frame.activeLineIndex < 0) {
      ctx.save();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.65;
      const r = 34 + (frame.audio.bassEnergy || 0) * 18 * motion;
      drawFourPointStarFlare(ctx, focal.centerX, height * 0.5, r, r * 0.22);
      ctx.stroke();
      ctx.restore();
      return;
    }

    const line = lyrics.lines[frame.activeLineIndex];
    if (!line || isBlankOrInstrumentalLineText(line.text)) return;

    const { words, count } = this.computeLineNodeCount(
      lyrics,
      frame.activeLineIndex,
      frame.scriptMode ?? 'auto'
    );
    if (count === 0) return;

    const unsynced = isUnsyncedLyrics(frame) || frame.activeWordIndex < 0;
    const activeW = unsynced ? count - 1 : Math.max(0, Math.min(count - 1, frame.activeWordIndex));
    const downbeatPulse = frame.audio.isDownbeat ? 1.28 : frame.audio.beatDetected ? 1.14 : 1.0;
    const bass = frame.audio.bassEnergy || 0;
    if (!frame.reduceMotion && (frame.audio.beatDetected || frame.audio.isDownbeat || bass > 0.55)) {
      this.vibrationEnergy = Math.min(1.0, Math.max(this.vibrationEnergy, 0.55 + bass * 0.45));
    } else {
      this.vibrationEnergy *= Math.exp(-dt * 4.5);
    }

    const fontScale = typeof frame.fontSizeScale === 'number' ? frame.fontSizeScale : 1.0;
    // 2.5x larger, bold hero typography (active word 38-60px, context words 22-32px)
    const activeFontPx = Math.max(36, Math.min(60, Math.round(46 * fontScale)));
    const contextFontPx = Math.max(22, Math.min(34, Math.round(25 * fontScale)));

    const padX = Math.max(58, focalWidth * 0.1);
    const usableW = Math.max(160, focalWidth - padX * 2);
    const cx = focal.centerX;
    const cy = height * 0.5;
    const minStageX = focal.left + 16;
    const maxStageX = focal.left + focalWidth - 16;

    // 1. Compute world node layout and smooth camera pan/glide target
    if (variation === 'branches') {
      const virtualSpan = Math.max(usableW * 0.92, count * 175);
      for (let i = 0; i < count; i++) {
        const u = count === 1 ? 0.5 : i / (count - 1);
        const branchY = Math.sin(u * Math.PI * 2.1 + (frame.activeLineIndex % 3) * 0.7) * Math.min(130, height * 0.22);
        const side = i % 2 === 0 ? -1 : 1;
        const tendrilOut = side * (48 + (i % 3) * 20);
        const sway = motion > 0 ? Math.sin(t * 1.9 + i * 1.1) * 6 : 0;
        this.nodeX[i] = (u - 0.5) * virtualSpan;
        this.nodeY[i] = branchY + tendrilOut + sway;
        this.nodeRadius[i] = i === activeW ? 8 * downbeatPulse : 4.5;
      }
    } else if (variation === 'web') {
      const rxMax = Math.min(usableW * 0.45, height * 0.37);
      const vib = motion > 0 ? this.vibrationEnergy * 12 * downbeatPulse : 0;
      for (let i = 0; i < count; i++) {
        // Alternate inner/outer web rings so consecutive adjacent spoke words never collide
        const ringFrac = i % 2 === 0 ? 0.56 + 0.14 * ((i % 4) / 3) : 0.78 + 0.14 * ((i % 3) / 2);
        const angle =
          -Math.PI * 0.5 +
          (i / Math.max(1, count)) * Math.PI * 2 +
          (motion > 0 ? Math.sin(t * 0.55) * 0.04 : 0);
        this.nodeX[i] = cx + Math.cos(angle) * (rxMax * ringFrac + vib);
        this.nodeY[i] = cy + Math.sin(angle) * (rxMax * 0.8 * ringFrac + vib * 0.72);
        this.nodeRadius[i] = i === activeW ? 8.5 * downbeatPulse : 4.6;
      }
    } else {
      // Constellation: generous celestial star spacing
      const virtualSpan = Math.max(usableW * 0.95, count * 185);
      const seedOffset = ((frame.activeLineIndex * 97) % 100) / 100;
      for (let i = 0; i < count; i++) {
        const u = count === 1 ? 0.5 : i / (count - 1);
        const arcY =
          Math.sin(u * Math.PI * 1.85 + seedOffset * Math.PI) * Math.min(145, height * 0.24) +
          (i % 2 === 0 ? -36 : 36);
        const drift = motion > 0 ? Math.sin(t * 1.15 + i * 0.85) * 5 : 0;
        this.nodeX[i] = (u - 0.5) * virtualSpan;
        this.nodeY[i] = arcY + drift;
        this.nodeRadius[i] = i === activeW ? 11 * downbeatPulse : 5.5;
      }
    }

    // Smooth camera pan centered on active node (Constellation & Branches full pan; Web gentle focus pull)
    const targetCamX =
      variation === 'web'
        ? (this.nodeX[activeW] - cx) * 0.24
        : this.nodeX[activeW];
    const targetCamY =
      variation === 'web'
        ? (this.nodeY[activeW] - cy) * 0.24
        : this.nodeY[activeW];
    if (!this.camInitialized || frame.didSeekThisFrame || frame.reduceMotion) {
      this.camX = targetCamX;
      this.camY = targetCamY;
      this.camInitialized = true;
    } else {
      const rate = 1 - Math.exp(-dt * (variation === 'branches' ? 5.2 : 4.6));
      this.camX += (targetCamX - this.camX) * rate;
      this.camY += (targetCamY - this.camY) * rate;
    }

    ctx.save();

    frame.recordHitRect?.(frame.activeLineIndex, focal.left + 20, height * 0.22, focalWidth - 40, height * 0.56);

    if (variation === 'web') {
      const focusCx = cx - this.camX;
      const focusCy = cy - this.camY;
      const rxMax = Math.min(focalWidth * 0.46, height * 0.42);
      const vibAmp = motion > 0 ? this.vibrationEnergy * 9.5 : 0;

      // Full-stage luminous concentric catenary silk web + harmonic string vibration
      const spokes = 12;
      const rings = 6;
      for (let ring = 1; ring <= rings; ring++) {
        const rr = (ring / rings) * rxMax;
        ctx.strokeStyle =
          ring === rings - 1 ? 'rgba(147, 197, 253, 0.28)' : 'rgba(226, 232, 240, 0.19)';
        ctx.lineWidth = ring % 2 === 0 ? 1.35 : 0.95;
        ctx.beginPath();
        for (let s = 0; s <= spokes; s++) {
          const a = (s / spokes) * Math.PI * 2;
          const vib =
            vibAmp > 0.2
              ? Math.sin(t * 26 + ring * 1.3 + s * 0.8) * vibAmp * 0.45
              : 0;
          const px = focusCx + Math.cos(a) * (rr + vib);
          const py = focusCy + Math.sin(a) * ((rr + vib) * 0.8);
          if (s === 0) ctx.moveTo(px, py);
          else {
            const prevA = ((s - 1) / spokes) * Math.PI * 2;
            const midA = (prevA + a) * 0.5;
            const sagR = rr * 0.92 + vib * 0.6;
            const mx = focusCx + Math.cos(midA) * sagR;
            const my = focusCy + Math.sin(midA) * (sagR * 0.8);
            ctx.quadraticCurveTo(mx, my, px, py);
          }
        }
        ctx.stroke();

        // Glowing crystalline dewdrop nodes along alternating web intersections
        for (let s = 0; s < spokes; s += 2) {
          if ((s + ring) % 2 !== 0) continue;
          const a = (s / spokes) * Math.PI * 2;
          const dx = focusCx + Math.cos(a) * rr;
          const dy = focusCy + Math.sin(a) * (rr * 0.8);
          ctx.fillStyle = '#e0f2fe';
          ctx.globalAlpha = 0.42 + bass * 0.35;
          ctx.beginPath();
          ctx.arc(dx, dy, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Radial silk spokes with harmonic wave pluck on active beat
      ctx.globalAlpha = 1;
      for (let s = 0; s < spokes; s++) {
        const a = (s / spokes) * Math.PI * 2;
        const endX = focusCx + Math.cos(a) * rxMax;
        const endY = focusCy + Math.sin(a) * (rxMax * 0.8);
        const nx = -Math.sin(a);
        const ny = Math.cos(a);
        const pluck =
          vibAmp > 0.2 ? Math.sin(t * 28 + s * 1.1) * vibAmp * 0.65 : 0;
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.2)';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(focusCx, focusCy);
        ctx.quadraticCurveTo(
          (focusCx + endX) * 0.5 + nx * pluck,
          (focusCy + endY) * 0.5 + ny * pluck,
          endX,
          endY
        );
        ctx.stroke();
      }

      // Illuminated silk threads connecting spoken lyric nodes up to activeW
      for (let i = 1; i <= activeW && i < count; i++) {
        const x0 = this.nodeX[i - 1] - this.camX;
        const y0 = this.nodeY[i - 1] - this.camY;
        const x1 = this.nodeX[i] - this.camX;
        const y1 = this.nodeY[i] - this.camY;
        const segP = i === activeW ? easeOutCubic(clamp01((frame.wordProgress || 0.3) * 1.5)) : 1.0;
        const drawX = x0 + (x1 - x0) * segP;
        const drawY = y0 + (y1 - y0) * segP;
        const perp = (vibAmp * 0.55) * Math.sin(t * 28 + i * 1.7);

        ctx.save();
        ctx.shadowColor = i === activeW ? secondary : accent;
        ctx.shadowBlur = i === activeW ? 18 : 10;
        ctx.strokeStyle = i === activeW ? '#ffffff' : accent;
        ctx.lineWidth = i === activeW ? 2.6 : 1.7;
        ctx.globalAlpha = (i === activeW ? 0.96 : 0.72) * frame.lineFadeAlpha;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo((x0 + drawX) * 0.5, (y0 + drawY) * 0.5 + perp, drawX, drawY);
        ctx.stroke();
        ctx.restore();
      }

      // Draw dewdrop nodes & collision-free giant bold hero typography
      let drawnLabelCount = 0;
      for (let i = 0; i < count; i++) {
        if (Math.abs(i - activeW) > 5 && i > activeW + 1) continue;
        const nx = this.nodeX[i] - this.camX;
        const ny = this.nodeY[i] - this.camY;
        const isActive = !unsynced && i === activeW;
        const isLit = unsynced || i <= activeW;
        const r = this.nodeRadius[i];

        ctx.save();
        ctx.shadowColor = isActive ? '#ffffff' : accent;
        ctx.shadowBlur = isActive ? 22 : isLit ? 12 : 4;
        ctx.fillStyle = isActive ? '#ffffff' : isLit ? accent : 'rgba(226, 232, 240, 0.45)';
        ctx.globalAlpha = (isActive ? 1.0 : isLit ? 0.9 : 0.48) * frame.lineFadeAlpha;
        ctx.beginPath();
        ctx.arc(nx, ny, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        const fontPx = isActive ? activeFontPx : contextFontPx;
        ctx.font = `${isActive ? 800 : 700} ${fontPx}px ${frame.fontFamily}`;
        const labelW = ctx.measureText(words[i]).width + 16;
        const labelH = fontPx * 1.15;
        const dx = nx - focusCx;
        const dy = ny - focusCy;
        const radialLen = Math.max(1, Math.hypot(dx, dy));
        const ux = dx / radialLen;
        const uy = dy / radialLen;

        let lx = nx + ux * (isActive ? 38 : 28);
        let ly = ny + uy * (isActive ? 38 : 28);
        // If near vertical center horizontally, ensure clean vertical clearance above/below node
        if (Math.abs(uy) < 0.35) {
          ly = ny + (i % 2 === 0 ? -36 : 36);
        }
        lx = Math.max(minStageX + labelW * 0.5, Math.min(maxStageX - labelW * 0.5, lx));
        ly = Math.max(labelH * 0.65 + 12, Math.min(height - labelH * 0.65 - 12, ly));

        for (let attempt = 0; attempt < 6; attempt++) {
          let hits = false;
          const x0 = lx - labelW * 0.5;
          const y0 = ly - labelH * 0.5;
          const x1 = lx + labelW * 0.5;
          const y1 = ly + labelH * 0.5;
          for (let d = 0; d < drawnLabelCount; d++) {
            const b = d * 4;
            if (
              x0 < this.labelBoxes[b + 2] &&
              x1 > this.labelBoxes[b] &&
              y0 < this.labelBoxes[b + 3] &&
              y1 > this.labelBoxes[b + 1]
            ) {
              hits = true;
              break;
            }
          }
          if (!hits) break;
          const nudgeStep = (attempt + 1) * (labelH * 0.72);
          ly = ny + (uy >= 0 ? nudgeStep + 26 : -(nudgeStep + 26));
          ly = Math.max(labelH * 0.65 + 12, Math.min(height - labelH * 0.65 - 12, ly));
        }

        const lb = drawnLabelCount * 4;
        this.labelBoxes[lb] = lx - labelW * 0.5;
        this.labelBoxes[lb + 1] = ly - labelH * 0.5;
        this.labelBoxes[lb + 2] = lx + labelW * 0.5;
        this.labelBoxes[lb + 3] = ly + labelH * 0.5;
        drawnLabelCount++;

        this.drawHeroWordLabel(
          ctx,
          words[i],
          lx,
          ly,
          fontPx,
          frame.fontFamily,
          isActive,
          isLit,
          isActive ? secondary : accent,
          (isActive ? 1.0 : isLit ? 0.88 : 0.56) * frame.lineFadeAlpha,
          minStageX,
          maxStageX,
          frame.wordProgress,
          t,
          motion,
          frame.wordIconsEnabled !== false,
          accent,
          secondary
        );
      }
    } else if (variation === 'branches') {
      // Gold & calligraphy ink tones
      const goldCore = '#f5d08a';
      const camOffX = cx - this.camX;
      const camOffY = cy - this.camY;

      // 1. Lush sweeping organic Bezier calligraphic vine across the full line (bright gold up to activeW, subtle amber-ink silhouette ahead)
      const spineSteps = Math.max(18, count * 6);
      const growMaxFrac = clamp01(
        (activeW + easeOutCubic(clamp01(frame.wordProgress || 0.45))) / Math.max(1, count - 1)
      );
      const virtualSpan = Math.max(usableW * 0.92, count * 175);
      const linePhase = (frame.activeLineIndex % 3) * 0.7;
      const ampY = Math.min(130, height * 0.22);

      for (let s = 1; s <= spineSteps; s++) {
        const u0 = (s - 1) / spineSteps;
        const u1 = s / spineSteps;
        const sx0 = camOffX + (u0 - 0.5) * virtualSpan;
        const sy0 = camOffY + Math.sin(u0 * Math.PI * 2.1 + linePhase) * ampY;
        const sx1 = camOffX + (u1 - 0.5) * virtualSpan;
        const sy1 = camOffY + Math.sin(u1 * Math.PI * 2.1 + linePhase) * ampY;

        const isGrown = u1 <= Math.max(growMaxFrac, 0.12);
        const taperW = 6.2 * (1 - 0.72 * u1);
        ctx.save();
        ctx.lineCap = 'round';
        ctx.shadowColor = isGrown ? accent : goldCore;
        ctx.shadowBlur = isGrown ? 16 : 6;
        ctx.strokeStyle = isGrown ? goldCore : 'rgba(245, 208, 138, 0.34)';
        ctx.lineWidth = Math.max(1.5, taperW);
        ctx.globalAlpha = (isGrown ? 0.94 : 0.52) * frame.lineFadeAlpha;
        ctx.beginPath();
        ctx.moveTo(sx0, sy0);
        ctx.lineTo(sx1, sy1);
        ctx.stroke();
        ctx.restore();
      }

      // 2. Curling calligraphic side tendrils + secondary sub-twigs + blossom light sparks + bold hero typography
      for (let i = 0; i < count; i++) {
        const isActive = !unsynced && i === activeW;
        const isLit = unsynced || i <= activeW;

        const u = count === 1 ? 0.5 : i / (count - 1);
        const spineX = camOffX + (u - 0.5) * virtualSpan;
        const spineY = camOffY + Math.sin(u * Math.PI * 2.1 + linePhase) * ampY;
        const nx = camOffX + this.nodeX[i];
        const ny = camOffY + this.nodeY[i];
        if (nx < focal.left - 180 || nx > focal.left + focalWidth + 180) continue;

        const dirSide = ny >= spineY ? 1 : -1;

        // Graceful Bezier curling tendril & twin sub-twigs on every vine node (brighter on reached nodes)
        ctx.save();
        ctx.strokeStyle = isActive ? '#ffffff' : isLit ? goldCore : 'rgba(245, 208, 138, 0.36)';
        ctx.shadowColor = isActive ? secondary : accent;
        ctx.shadowBlur = isActive ? 16 : isLit ? 8 : 3;
        ctx.lineWidth = isActive ? 2.8 : isLit ? 1.8 : 1.2;
        ctx.globalAlpha = (isActive ? 0.96 : isLit ? 0.76 : 0.45) * frame.lineFadeAlpha;
        ctx.beginPath();
        ctx.moveTo(spineX, spineY);
        ctx.bezierCurveTo(
          spineX + 38,
          spineY + dirSide * 14,
          nx - 32,
          ny - dirSide * 24,
          nx,
          ny
        );
        ctx.stroke();

        // Calligraphic sub-twig & logarithmic spiral leaf flourish
        ctx.beginPath();
        ctx.lineWidth = isLit ? 1.25 : 0.9;
        ctx.globalAlpha *= 0.72;
        ctx.moveTo(nx, ny);
        ctx.quadraticCurveTo(nx + 20, ny + dirSide * 12, nx + 14, ny + dirSide * 26);
        ctx.moveTo((spineX + nx) * 0.5, (spineY + ny) * 0.5);
        ctx.quadraticCurveTo(nx - 24, ny + dirSide * 18, nx - 12, ny + dirSide * 30);
        ctx.stroke();

        // Blossom light spark orb
        const bloomScale =
          isActive && motion > 0
            ? easeOutBack(clamp01((frame.wordProgress || 0.25) / 0.45))
            : 1.0;
        const r = this.nodeRadius[i] * bloomScale;
        ctx.globalAlpha = (isActive ? 1.0 : isLit ? 0.88 : 0.48) * frame.lineFadeAlpha;
        ctx.fillStyle = isActive ? '#ffffff' : isLit ? goldCore : accent;
        drawFourPointStarFlare(ctx, nx, ny, r * (isActive ? 2.1 : 1.6), r * 0.4);
        ctx.fill();
        ctx.restore();

        const labelY = ny + dirSide * (isActive ? 38 : 28);
        this.drawHeroWordLabel(
          ctx,
          words[i],
          nx,
          labelY,
          isActive ? activeFontPx : contextFontPx,
          frame.fontFamily,
          isActive,
          isLit,
          goldCore,
          (isActive ? 1.0 : isLit ? 0.88 : 0.58) * frame.lineFadeAlpha,
          minStageX,
          maxStageX,
          frame.wordProgress,
          t,
          motion,
          frame.wordIconsEnabled !== false,
          accent,
          secondary
        );
      }
    } else {
      // Constellation: Luminous tapered star-lines + 4-point diffraction-spike glowing stars + giant typography
      const camOffX = cx - this.camX;
      const camOffY = cy - this.camY;

      for (let i = 1; i < count; i++) {
        const x0 = camOffX + this.nodeX[i - 1];
        const y0 = camOffY + this.nodeY[i - 1];
        const x1 = camOffX + this.nodeX[i];
        const y1 = camOffY + this.nodeY[i];

        ctx.save();
        if (i <= activeW) {
          const segP = i === activeW ? easeOutCubic(clamp01((frame.wordProgress || 0.25) * 1.6)) : 1.0;
          const drawX = x0 + (x1 - x0) * segP;
          const drawY = y0 + (y1 - y0) * segP;

          ctx.shadowColor = accent;
          ctx.shadowBlur = i === activeW ? 20 : 10;
          ctx.strokeStyle = i === activeW ? '#ffffff' : accent;
          ctx.lineWidth = i === activeW ? 2.8 : 1.8;
          ctx.globalAlpha = (i === activeW ? 0.96 : 0.78) * frame.lineFadeAlpha;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(drawX, drawY);
          ctx.stroke();
        } else if (i <= activeW + 2) {
          // Subtle faint celestial guide line to immediate upcoming star
          ctx.setLineDash([4, 6]);
          ctx.strokeStyle = 'rgba(226, 232, 240, 0.22)';
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
        ctx.restore();
      }

      for (let i = 0; i < count; i++) {
        const nx = camOffX + this.nodeX[i];
        const ny = camOffY + this.nodeY[i];
        if (nx < focal.left - 160 || nx > focal.left + focalWidth + 160) continue;

        const isActive = !unsynced && i === activeW;
        const isLit = unsynced || i <= activeW;
        const r = this.nodeRadius[i];

        ctx.save();
        ctx.shadowColor = isActive ? '#ffffff' : isLit ? secondary : accent;
        ctx.shadowBlur = isActive ? 28 : isLit ? 16 : 6;
        ctx.fillStyle = isActive ? '#ffffff' : isLit ? accent : 'rgba(226, 232, 240, 0.34)';
        ctx.globalAlpha = (isActive ? 1.0 : isLit ? 0.9 : 0.36) * frame.lineFadeAlpha;
        drawFourPointStarFlare(ctx, nx, ny, r * (isActive ? 2.15 : 1.65), r * 0.36);
        ctx.fill();

        if (isActive || isLit) {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(nx, ny, isActive ? 4.2 : 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();

        const labelOffsetY = i % 2 === 0 ? -(isActive ? 42 : 30) : isActive ? 42 : 30;
        this.drawHeroWordLabel(
          ctx,
          words[i],
          nx,
          ny + labelOffsetY,
          isActive ? activeFontPx : contextFontPx,
          frame.fontFamily,
          isActive,
          isLit,
          isActive ? secondary : accent,
          (isActive ? 1.0 : isLit ? 0.88 : 0.35) * frame.lineFadeAlpha,
          minStageX,
          maxStageX,
          frame.wordProgress,
          t,
          motion,
          frame.wordIconsEnabled !== false,
          accent,
          secondary
        );
      }
    }

    ctx.restore();
  }
}
