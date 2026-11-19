// Style 6: HoloVaporwave
// Perspective neon synth grid horizon + chromatic pastel scanlines + iridescent holographic word sweep.

import type { StyleFrameContext } from '../../core/models';
import {
  clamp01,
  drawEmptyState,
  getActiveLine,
  type ILyricVisualStyle,
} from '../styleInterface';

export class HoloVaporwaveStyle implements ILyricVisualStyle {
  readonly id = 'HoloVaporwave' as const;
  readonly name = 'Holo Vaporwave';
  readonly webGlEffect = 'holoVaporwave' as const;

  render(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    width: number,
    height: number
  ): void {
    const isOverlay = Boolean(frame.isOverlayMode);

    // Subtle pastel chromatic scanlines on top of WebGL2 synth grid
    if (!isOverlay) {
      ctx.save();
      ctx.fillStyle = 'rgba(255, 190, 245, 0.045)';
      for (let y = 0; y < height; y += 6) {
        ctx.fillRect(0, y, width, 1);
      }
      ctx.restore();
    }

    const { line, measured, index } = getActiveLine(frame);
    if (!line || !measured || !frame.layout) {
      drawEmptyState(ctx, frame, width, height);
      return;
    }

    const cx = width * 0.5;
    const cy = height * 0.44;
    const fontSize = Math.round(frame.layout.fontSizePx * 1.08);
    const startY = cy - measured.height * 0.5;
    const chromaOffset = frame.reduceMotion ? 1.2 : 2.2 + frame.audio.bassEnergy * 3.5;

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `800 ${fontSize}px ${frame.fontFamily}`;

    for (let w = 0; w < measured.words.length; w++) {
      const word = measured.words[w];
      const wx = measured.x + word.x;
      const wy = startY + word.y;
      const isCurrent = w === frame.activeWordIndex;
      const isPast = w < frame.activeWordIndex;

      if (isCurrent || isPast) {
        // Chromatic cyan/magenta split
        ctx.save();
        ctx.globalAlpha = 0.45 * frame.lineFadeAlpha;
        ctx.fillStyle = '#5ef2ff';
        ctx.fillText(word.text, wx - chromaOffset, wy);
        ctx.fillStyle = '#ff6ad5';
        ctx.fillText(word.text, wx + chromaOffset, wy);
        ctx.restore();

        // Iridescent holographic pastel gradient
        const holo = ctx.createLinearGradient(wx, wy, wx + Math.max(1, word.width), wy + fontSize);
        const shift = isCurrent ? clamp01(frame.wordProgress) : 0.5;
        holo.addColorStop(0, '#9bf6ff');
        holo.addColorStop(Math.max(0.1, Math.min(0.9, 0.35 + shift * 0.3)), '#ffffff');
        holo.addColorStop(0.75, '#ffc6ff');
        holo.addColorStop(1, frame.palette.accentPrimary);

        ctx.save();
        ctx.globalAlpha = frame.lineFadeAlpha;
        ctx.shadowColor = isCurrent ? '#ff6ad5' : '#5ef2ff';
        ctx.shadowBlur = isCurrent ? 18 : 8;
        ctx.fillStyle = holo;
        ctx.fillText(word.text, wx, wy);
        ctx.restore();
      } else {
        ctx.globalAlpha = 0.34 * frame.lineFadeAlpha;
        ctx.fillStyle = frame.palette.textUpcoming;
        ctx.fillText(word.text, wx, wy);
      }
    }

    // Upcoming line floating above horizon
    if (index + 1 < frame.layout.lines.length) {
      const next = frame.layout.lines[index + 1];
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = `500 ${Math.round(fontSize * 0.58)}px ${frame.fontFamily}`;
      ctx.fillStyle = '#d8b4fe';
      ctx.globalAlpha = 0.45;
      ctx.fillText(next.text, cx, startY + measured.height + fontSize * 0.55);
      ctx.restore();
    }

    ctx.restore();
  }
}
