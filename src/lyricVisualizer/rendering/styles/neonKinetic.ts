// Style 2: NeonKinetic
// Electric synthwave typography, bloom/stroke neon trails, audio-reactive kick pulse scale on beat.

import type { StyleFrameContext } from '../../core/models';
import {
  clamp01,
  drawEmptyState,
  getActiveLine,
  type ILyricVisualStyle,
} from '../styleInterface';

export class NeonKineticStyle implements ILyricVisualStyle {
  readonly id = 'NeonKinetic' as const;
  readonly name = 'Neon Kinetic';
  readonly webGlEffect = 'none' as const;

  private beatPulse = 0;

  reset(): void {
    this.beatPulse = 0;
  }

  render(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    width: number,
    height: number
  ): void {
    const isOverlay = Boolean(frame.isOverlayMode);

    if (frame.audio.beatDetected && !frame.reduceMotion) {
      this.beatPulse = 1.0;
    } else {
      this.beatPulse = Math.max(0, this.beatPulse - frame.deltaSeconds * 4.5);
    }

    if (!isOverlay) {
      const bg = ctx.createLinearGradient(0, 0, width, height);
      bg.addColorStop(0, '#070312');
      bg.addColorStop(0.5, frame.palette.bgDeep);
      bg.addColorStop(1, '#090218');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      // Electric horizon neon bars
      ctx.save();
      ctx.strokeStyle = frame.palette.accentSecondary;
      ctx.globalAlpha = 0.16 + this.beatPulse * 0.22;
      ctx.lineWidth = 1.5;
      const barY = height * 0.5;
      ctx.beginPath();
      ctx.moveTo(0, barY - 120);
      ctx.lineTo(width, barY - 120);
      ctx.moveTo(0, barY + 120);
      ctx.lineTo(width, barY + 120);
      ctx.stroke();
      ctx.restore();
    }

    const { line, measured, index } = getActiveLine(frame);
    if (!line || !measured || !frame.layout) {
      drawEmptyState(ctx, frame, width, height);
      return;
    }

    const cx = width * 0.5;
    const cy = height * 0.5;
    const kickScale = frame.reduceMotion
      ? 1.0
      : 1.0 + this.beatPulse * 0.075 + frame.audio.bassEnergy * 0.04;
    const fontSize = Math.round(frame.layout.fontSizePx * 1.12);

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // Previous line ghost above
    if (index > 0) {
      const prev = frame.layout.lines[index - 1];
      ctx.save();
      ctx.font = `600 ${Math.round(fontSize * 0.62)}px ${frame.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = frame.palette.textPassed;
      ctx.globalAlpha = 0.34;
      ctx.fillText(prev.text, cx, cy - measured.height * 0.7 - fontSize * 0.9);
      ctx.restore();
    }

    // Active line with kinetic kick pulse + neon bloom/stroke trail
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(kickScale, kickScale);
    ctx.translate(-cx, -cy);

    const startY = cy - measured.height * 0.5;
    ctx.font = `800 ${fontSize}px ${frame.fontFamily}`;

    for (let w = 0; w < measured.words.length; w++) {
      const word = measured.words[w];
      const wx = measured.x + word.x;
      const wy = startY + word.y;
      const isCurrent = w === frame.activeWordIndex;
      const isPast = w < frame.activeWordIndex;

      // Kinetic neon trail behind active word
      if (isCurrent && !frame.reduceMotion) {
        const trailShift = (1 - clamp01(frame.wordProgress)) * 10 + this.beatPulse * 6;
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = frame.palette.accentSecondary;
        ctx.lineWidth = 2.5;
        ctx.strokeText(word.text, wx - trailShift, wy + 2);
        ctx.restore();
      }

      // Outer neon stroke + bloom
      ctx.save();
      ctx.globalAlpha = (isCurrent || isPast ? 0.98 : 0.36) * frame.lineFadeAlpha;
      ctx.shadowColor = isCurrent ? frame.palette.accentPrimary : frame.palette.accentSecondary;
      ctx.shadowBlur = isCurrent ? 22 + this.beatPulse * 14 : isPast ? 12 : 0;
      ctx.strokeStyle = isCurrent ? frame.palette.accentPrimary : frame.palette.accentSecondary;
      ctx.lineWidth = isCurrent ? 2.4 : 1.2;
      if (isCurrent || isPast) {
        ctx.strokeText(word.text, wx, wy);
      }
      ctx.fillStyle = isCurrent
        ? '#ffffff'
        : isPast
        ? frame.palette.textActive
        : frame.palette.textUpcoming;
      ctx.fillText(word.text, wx, wy);
      ctx.restore();
    }

    ctx.restore();

    // Next line preview below
    if (index + 1 < frame.layout.lines.length) {
      const next = frame.layout.lines[index + 1];
      ctx.save();
      ctx.font = `500 ${Math.round(fontSize * 0.62)}px ${frame.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = frame.palette.textUpcoming;
      ctx.globalAlpha = 0.42;
      ctx.fillText(next.text, cx, cy + measured.height * 0.65 + fontSize * 0.45);
      ctx.restore();
    }

    ctx.restore();
  }
}
