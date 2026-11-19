// Style 1: AppleMusicFlow
// Smooth vertical spring/ease-out word-by-word illumination, soft glowing gradient sweep,
// distant line opacity falloff, translucent atmospheric album-palette backdrop (muted in overlay mode).

import type { StyleFrameContext } from '../../core/models';
import {
  clamp01,
  drawEmptyState,
  easeOutCubic,
  isUnsyncedLyrics,
  type ILyricVisualStyle,
} from '../styleInterface';

export class AppleMusicFlowStyle implements ILyricVisualStyle {
  readonly id = 'AppleMusicFlow' as const;
  readonly name = 'Atmospheric Flow';
  readonly webGlEffect = 'ambientFlow' as const;

  private scrollY = 0;
  private initialized = false;

  reset(): void {
    this.scrollY = 0;
    this.initialized = false;
  }

  render(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    width: number,
    height: number
  ): void {
    const isOverlay = Boolean(frame.isOverlayMode);

    // Translucent atmospheric backdrop (cleanly transparent in overlay mode)
    if (!isOverlay) {
      const bg = ctx.createLinearGradient(0, 0, width * 0.4, height);
      bg.addColorStop(0, frame.palette.bgDeep);
      bg.addColorStop(0.55, frame.palette.bgMid);
      bg.addColorStop(1, frame.palette.bgDeep);
      ctx.save();
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      // Soft breathing radial bloom
      const breath = frame.reduceMotion ? 0 : Math.sin(frame.timeSeconds * 0.7) * 0.08;
      const cx = width * (0.5 + breath);
      const cy = height * 0.44;
      const rad = Math.max(width, height) * (0.48 + frame.audio.bassEnergy * 0.14);
      const bloom = ctx.createRadialGradient(cx, cy, 10, cx, cy, rad);
      bloom.addColorStop(0, frame.palette.accentPrimary);
      bloom.addColorStop(0.55, frame.palette.accentSecondary);
      bloom.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.16 + frame.audio.rmsLevel * 0.14;
      ctx.fillStyle = bloom;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
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
      const springRate = Math.min(1, Math.max(0.016, frame.deltaSeconds) * 7.5);
      this.scrollY += (targetScrollY - this.scrollY) * springRate;
    }

    const unsynced = isUnsyncedLyrics(frame);
    const anchorY = height * (isOverlay ? 0.52 : 0.46);
    const fontSize = layout.fontSizePx;

    ctx.save();
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    for (let i = 0; i < layout.lines.length; i++) {
      const line = layout.lines[i];
      const screenY = anchorY + (line.y - this.scrollY);
      if (screenY + line.height < -80 || screenY > height + 80) continue;

      const dist = Math.abs(i - activeIdx);
      const isActive = i === activeIdx;
      const isPast = i < activeIdx;

      const falloff = isActive
        ? 1.0
        : Math.max(0.14, 0.56 - dist * 0.13);
      const scale = isActive
        ? 1.0 + (frame.reduceMotion ? 0 : frame.audio.bassEnergy * 0.025)
        : Math.max(0.86, 0.96 - dist * 0.03);

      ctx.save();
      const lineCenterX = width * 0.5;
      const lineCenterY = screenY + line.height * 0.5;
      ctx.translate(lineCenterX, lineCenterY);
      ctx.scale(scale, scale);
      ctx.translate(-lineCenterX, -lineCenterY);

      ctx.font = `${isActive ? 700 : 600} ${fontSize}px ${frame.fontFamily}`;

      if (!isActive || unsynced) {
        ctx.globalAlpha = falloff * (isOverlay ? 0.92 : 1.0);
        ctx.fillStyle = isPast ? frame.palette.textPassed : frame.palette.textUpcoming;
        for (let w = 0; w < line.words.length; w++) {
          const word = line.words[w];
          ctx.fillText(word.text, line.x + word.x, screenY + word.y);
        }
      } else {
        // Active line: word-by-word illumination + soft glowing gradient sweep
        for (let w = 0; w < line.words.length; w++) {
          const word = line.words[w];
          const wx = line.x + word.x;
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
            // Base dimmed word
            ctx.globalAlpha = 0.42 * frame.lineFadeAlpha;
            ctx.shadowBlur = 0;
            ctx.fillStyle = frame.palette.textUpcoming;
            ctx.fillText(word.text, wx, wy + lift);

            // Illuminated gradient sweep
            const sweepGrad = ctx.createLinearGradient(wx, wy, wx + Math.max(1, word.width), wy);
            sweepGrad.addColorStop(0, frame.palette.textActive);
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
          } else {
            ctx.globalAlpha = 0.38 * frame.lineFadeAlpha;
            ctx.shadowBlur = 0;
            ctx.fillStyle = frame.palette.textUpcoming;
            ctx.fillText(word.text, wx, wy);
          }
        }
      }

      ctx.restore();
    }

    ctx.restore();
  }
}
