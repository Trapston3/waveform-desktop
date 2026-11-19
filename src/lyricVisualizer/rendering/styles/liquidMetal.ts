// Style 5: LiquidMetal
// Specular chrome/iridescent fluid shader backdrop (via WebGlEffectLayer with Canvas2D fallback),
// crisp reflective active words.

import type { StyleFrameContext } from '../../core/models';
import {
  clamp01,
  drawEmptyState,
  getActiveLine,
  type ILyricVisualStyle,
} from '../styleInterface';

export class LiquidMetalStyle implements ILyricVisualStyle {
  readonly id = 'LiquidMetal' as const;
  readonly name = 'Liquid Metal';
  readonly webGlEffect = 'liquidMetal' as const;

  render(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    width: number,
    height: number
  ): void {
    const isOverlay = Boolean(frame.isOverlayMode);

    // Subtle metallic sheen veil on Canvas2D (keeps WebGL2 shader visible beneath)
    if (!isOverlay) {
      ctx.save();
      const sheenX = width * (0.5 + (frame.reduceMotion ? 0 : 0.25 * Math.sin(frame.timeSeconds * 0.6)));
      const grad = ctx.createLinearGradient(sheenX - width * 0.4, 0, sheenX + width * 0.4, height);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.5, 'rgba(220,232,255,0.06)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    const { line, measured, index } = getActiveLine(frame);
    if (!line || !measured || !frame.layout) {
      drawEmptyState(ctx, frame, width, height);
      return;
    }

    const cx = width * 0.5;
    const cy = height * 0.5;
    const fontSize = Math.round(frame.layout.fontSizePx * 1.1);
    const startY = cy - measured.height * 0.5;

    ctx.save();
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    // Previous / next subtle chrome reflections
    if (index > 0) {
      const prev = frame.layout.lines[index - 1];
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = `500 ${Math.round(fontSize * 0.62)}px ${frame.fontFamily}`;
      ctx.fillStyle = frame.palette.textPassed;
      ctx.globalAlpha = 0.34;
      ctx.fillText(prev.text, cx, startY - fontSize * 1.15);
      ctx.restore();
    }

    ctx.font = `800 ${fontSize}px ${frame.fontFamily}`;
    for (let w = 0; w < measured.words.length; w++) {
      const word = measured.words[w];
      const wx = measured.x + word.x;
      const wy = startY + word.y;
      const isActive = w === frame.activeWordIndex;
      const isPast = w < frame.activeWordIndex;

      if (isActive || isPast) {
        // Specular liquid chrome vertical gradient
        const chromeGrad = ctx.createLinearGradient(wx, wy, wx, wy + fontSize);
        const shift = isActive ? clamp01(frame.wordProgress) * 0.25 : 0.15;
        chromeGrad.addColorStop(0, '#ffffff');
        chromeGrad.addColorStop(0.32 + shift * 0.4, '#dbe6f7');
        chromeGrad.addColorStop(0.55, frame.palette.accentPrimary);
        chromeGrad.addColorStop(0.82, '#eef5ff');
        chromeGrad.addColorStop(1, frame.palette.accentSecondary);

        ctx.save();
        ctx.globalAlpha = frame.lineFadeAlpha;
        ctx.shadowColor = isActive ? '#ffffff' : frame.palette.accentPrimary;
        ctx.shadowBlur = isActive ? 18 + frame.audio.trebleEnergy * 14 : 8;
        ctx.fillStyle = chromeGrad;
        ctx.fillText(word.text, wx, wy);

        // Crisp specular rim stroke
        ctx.lineWidth = 0.9;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.strokeText(word.text, wx, wy);
        ctx.restore();
      } else {
        ctx.globalAlpha = 0.32 * frame.lineFadeAlpha;
        ctx.fillStyle = frame.palette.textUpcoming;
        ctx.fillText(word.text, wx, wy);
      }
    }

    if (index + 1 < frame.layout.lines.length) {
      const next = frame.layout.lines[index + 1];
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = `500 ${Math.round(fontSize * 0.62)}px ${frame.fontFamily}`;
      ctx.fillStyle = frame.palette.textUpcoming;
      ctx.globalAlpha = 0.36;
      ctx.fillText(next.text, cx, startY + measured.height + fontSize * 0.55);
      ctx.restore();
    }

    ctx.restore();
  }
}
