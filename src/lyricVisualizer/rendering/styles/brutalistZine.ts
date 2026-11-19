// Style 8: BrutalistZine
// High-impact tilted poster cards, bold uppercase blocks, halftone dots, high-contrast knockout pill highlights.

import type { StyleFrameContext } from '../../core/models';
import {
  drawEmptyState,
  getActiveLine,
  type ILyricVisualStyle,
} from '../styleInterface';

export class BrutalistZineStyle implements ILyricVisualStyle {
  readonly id = 'BrutalistZine' as const;
  readonly name = 'Brutalist Zine';
  readonly webGlEffect = 'none' as const;

  render(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    width: number,
    height: number
  ): void {
    const isOverlay = Boolean(frame.isOverlayMode);

    if (!isOverlay) {
      // Raw zine backdrop
      ctx.fillStyle = '#111111';
      ctx.fillRect(0, 0, width, height);

      // Halftone dot matrix in top-left and bottom-right corners
      ctx.save();
      ctx.fillStyle = frame.palette.accentSecondary;
      ctx.globalAlpha = 0.24;
      const spacing = 14;
      for (let gx = 0; gx < 10; gx++) {
        for (let gy = 0; gy < 7; gy++) {
          const r = Math.max(1.2, 4.2 - (gx + gy) * 0.28);
          ctx.beginPath();
          ctx.arc(24 + gx * spacing, 24 + gy * spacing, r, 0, Math.PI * 2);
          ctx.fill();

          ctx.beginPath();
          ctx.arc(width - 24 - gx * spacing, height - 24 - gy * spacing, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    const { line, measured, index } = getActiveLine(frame);
    if (!line || !measured || !frame.layout) {
      drawEmptyState(ctx, frame, width, height, 'ZINE // STANDBY');
      return;
    }

    const cx = width * 0.5;
    const cy = height * 0.5;
    const fontSize = Math.round(frame.layout.fontSizePx * 1.04);
    const tilt = frame.reduceMotion
      ? 0
      : ((index % 2 === 0 ? -1 : 1) * 0.032) + (frame.audio.beatDetected ? 0.014 : 0);

    const cardPadX = 32;
    const cardPadY = 24;
    const cardW = Math.min(width * 0.88, Math.max(260, measured.width + cardPadX * 2));
    const cardH = measured.height + cardPadY * 2;
    const cardX = cx - cardW * 0.5;
    const cardY = cy - cardH * 0.5;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    ctx.translate(-cx, -cy);

    // Hard offset brutalist shadow block
    ctx.fillStyle = frame.palette.accentPrimary;
    ctx.fillRect(cardX + 10, cardY + 10, cardW, cardH);

    // Main high-contrast poster card
    ctx.fillStyle = isOverlay ? 'rgba(14, 14, 14, 0.88)' : '#f4f1ea';
    ctx.fillRect(cardX, cardY, cardW, cardH);
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#090909';
    ctx.strokeRect(cardX, cardY, cardW, cardH);

    // Issue stamp tag
    ctx.fillStyle = '#090909';
    ctx.fillRect(cardX + 14, cardY - 16, 118, 22);
    ctx.font = `700 11px "JetBrains Mono", monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`ISSUE #${String(index + 1).padStart(2, '0')}`, cardX + 24, cardY - 5);

    // Bold uppercase words with knockout pill highlight on active word
    ctx.font = `900 ${fontSize}px ${frame.fontFamily}`;
    ctx.textBaseline = 'top';
    const textStartX = cx - measured.width * 0.5;
    const textStartY = cardY + cardPadY;

    for (let w = 0; w < measured.words.length; w++) {
      const word = measured.words[w];
      const upper = word.text.toUpperCase();
      const wx = textStartX + word.x;
      const wy = textStartY + word.y;
      const isCurrent = w === frame.activeWordIndex;
      const isPast = w < frame.activeWordIndex;

      if (isCurrent) {
        // High-contrast knockout pill
        ctx.fillStyle = '#090909';
        ctx.fillRect(wx - 7, wy - 4, word.width + 14, fontSize + 10);
        ctx.fillStyle = frame.palette.accentPrimary;
        ctx.fillText(upper, wx, wy);
      } else {
        ctx.fillStyle = isOverlay
          ? isPast
            ? '#ffffff'
            : 'rgba(255,255,255,0.52)'
          : isPast
          ? '#090909'
          : 'rgba(9, 9, 9, 0.44)';
        ctx.fillText(upper, wx, wy);
      }
    }

    ctx.restore();
  }
}
