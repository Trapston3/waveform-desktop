// Style 11: Spatial3DDepth
// Multi-plane Z-depth perspective camera gently drifting with depth-of-field alpha & perspective scale
// across past/active/future lines.

import type { StyleFrameContext } from '../../core/models';
import {
  drawEmptyState,
  type ILyricVisualStyle,
} from '../styleInterface';

export class Spatial3DDepthStyle implements ILyricVisualStyle {
  readonly id = 'Spatial3DDepth' as const;
  readonly name = 'Spatial 3D Depth';
  readonly webGlEffect = 'none' as const;

  private smoothLineIndex = 0;
  private initialized = false;

  reset(): void {
    this.smoothLineIndex = 0;
    this.initialized = false;
  }

  render(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    width: number,
    height: number
  ): void {
    const isOverlay = Boolean(frame.isOverlayMode);

    if (!isOverlay) {
      const bg = ctx.createRadialGradient(
        width * 0.5,
        height * 0.45,
        16,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.85
      );
      bg.addColorStop(0, frame.palette.bgMid);
      bg.addColorStop(0.65, frame.palette.bgDeep);
      bg.addColorStop(1, '#05060b');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      // Subtle Z-depth perspective reference rings
      ctx.save();
      ctx.strokeStyle = frame.palette.accentSecondary;
      ctx.lineWidth = 1;
      for (let r = 1; r <= 3; r++) {
        ctx.globalAlpha = 0.08 - r * 0.018;
        ctx.beginPath();
        ctx.ellipse(
          width * 0.5,
          height * 0.52,
          width * (0.18 * r),
          height * (0.13 * r),
          0,
          0,
          Math.PI * 2
        );
        ctx.stroke();
      }
      ctx.restore();
    }

    const layout = frame.layout;
    if (!layout || layout.lines.length === 0) {
      drawEmptyState(ctx, frame, width, height);
      return;
    }

    const activeIdx = Math.max(0, Math.min(layout.lines.length - 1, frame.activeLineIndex));
    if (!this.initialized || frame.didSeekThisFrame || frame.reduceMotion) {
      this.smoothLineIndex = activeIdx;
      this.initialized = true;
    } else {
      const rate = Math.min(1, Math.max(0.016, frame.deltaSeconds) * 6.5);
      this.smoothLineIndex += (activeIdx - this.smoothLineIndex) * rate;
    }

    // Gentle perspective camera drift
    const camDriftX = frame.reduceMotion ? 0 : Math.sin(frame.timeSeconds * 0.55) * 28;
    const camDriftY = frame.reduceMotion ? 0 : Math.cos(frame.timeSeconds * 0.42) * 14;
    const cx = width * 0.5;
    const cy = height * 0.5;
    const focalLength = 420;
    const fontSize = Math.round(layout.fontSizePx * 1.04);

    // Draw back-to-front: future (+3..+1), past (-2..-1), then active (0)
    const startPlane = Math.max(0, activeIdx - 2);
    const endPlane = Math.min(layout.lines.length - 1, activeIdx + 4);

    ctx.save();
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    for (let pass = 0; pass < 2; pass++) {
      for (let i = endPlane; i >= startPlane; i--) {
        const isActive = i === activeIdx;
        if ((pass === 0 && isActive) || (pass === 1 && !isActive)) continue;

        const line = layout.lines[i];
        const rel = i - this.smoothLineIndex;
        // Positive rel = deeper into Z plane; negative rel = closer past camera
        const z = 180 + rel * 165;
        if (z < 40) continue;

        const persp = focalLength / (focalLength + z - 180);
        const depthDist = Math.abs(rel);
        const dofAlpha = isActive
          ? frame.lineFadeAlpha
          : Math.max(0.08, 0.62 * Math.exp(-depthDist * 0.72));

        const planeY = cy + rel * (layout.lineHeightPx * 1.05) * persp + camDriftY * (1 - persp);
        const planeXShift = camDriftX * (1 - persp) * 1.4;

        ctx.save();
        ctx.translate(cx + planeXShift, planeY);
        ctx.scale(persp, persp);
        ctx.translate(-cx, -line.height * 0.5);

        ctx.font = `${isActive ? 800 : 600} ${fontSize}px ${frame.fontFamily}`;

        if (!isActive) {
          ctx.globalAlpha = dofAlpha;
          ctx.fillStyle = i < activeIdx ? frame.palette.textPassed : frame.palette.textUpcoming;
          for (let w = 0; w < line.words.length; w++) {
            const word = line.words[w];
            ctx.fillText(word.text, line.x + word.x, word.y);
          }
        } else {
          for (let w = 0; w < line.words.length; w++) {
            const word = line.words[w];
            const isCurrent = w === frame.activeWordIndex;
            const isPast = w < frame.activeWordIndex;
            ctx.globalAlpha = (isCurrent ? 1.0 : isPast ? 0.92 : 0.42) * dofAlpha;
            ctx.fillStyle = isCurrent
              ? '#ffffff'
              : isPast
              ? frame.palette.textActive
              : frame.palette.textUpcoming;
            ctx.shadowColor = isCurrent ? frame.palette.accentPrimary : 'transparent';
            ctx.shadowBlur = isCurrent ? 20 : 0;
            ctx.fillText(word.text, line.x + word.x, word.y);
          }
        }

        ctx.restore();
      }
    }

    ctx.restore();
  }
}
