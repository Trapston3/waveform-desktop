// Style 3: TypewriterEditorial
// Literary serif spotlight with crisp animated cursor, ink reveal per word, warm paper/editorial margin grid.

import type { StyleFrameContext } from '../../core/models';
import {
  clamp01,
  drawEmptyState,
  formatTimestamp,
  getActiveLine,
  type ILyricVisualStyle,
} from '../styleInterface';

export class TypewriterEditorialStyle implements ILyricVisualStyle {
  readonly id = 'TypewriterEditorial' as const;
  readonly name = 'Typewriter Editorial';
  readonly webGlEffect = 'none' as const;

  render(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    width: number,
    height: number
  ): void {
    const isOverlay = Boolean(frame.isOverlayMode);
    const marginX = Math.max(36, Math.round(width * 0.1));

    // Warm dark-editorial paper surface & subtle margin rules
    if (!isOverlay) {
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, '#161311');
      bg.addColorStop(1, '#1e1915');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.strokeStyle = 'rgba(244, 232, 212, 0.08)';
      ctx.lineWidth = 1;
      // Vertical editorial margin rules
      ctx.beginPath();
      ctx.moveTo(marginX, 24);
      ctx.lineTo(marginX, height - 24);
      ctx.moveTo(width - marginX, 24);
      ctx.lineTo(width - marginX, height - 24);
      // Subtle ruled ledger lines
      const ruleStep = 44;
      for (let y = 64; y < height - 40; y += ruleStep) {
        ctx.moveTo(marginX, y);
        ctx.lineTo(width - marginX, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    const { line, measured, index } = getActiveLine(frame);
    if (!line || !measured || !frame.layout) {
      drawEmptyState(ctx, frame, width, height, 'Awaiting manuscript...');
      return;
    }

    const serifFamily = frame.fontFamily.includes('serif')
      ? frame.fontFamily
      : `"Instrument Serif", Fraunces, ${frame.fontFamily}`;
    const fontSize = Math.round(frame.layout.fontSizePx * 1.06);
    const contentX = marginX + 20;
    const centerY = height * 0.48;

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // Editorial folio header
    ctx.font = `500 12px "JetBrains Mono", monospace`;
    ctx.fillStyle = frame.palette.accentPrimary;
    ctx.globalAlpha = 0.72;
    ctx.fillText(
      `LINE ${String(index + 1).padStart(2, '0')}  /  ${formatTimestamp(line.startSeconds)}`,
      contentX,
      Math.max(28, centerY - measured.height * 0.5 - 52)
    );

    // Previous line softly printed above
    if (index > 0) {
      const prev = frame.layout.lines[index - 1];
      ctx.font = `400 ${Math.round(fontSize * 0.66)}px ${serifFamily}`;
      ctx.fillStyle = '#d7cab8';
      ctx.globalAlpha = 0.35;
      ctx.fillText(prev.text, contentX, centerY - measured.height * 0.5 - fontSize * 1.15);
    }

    // Active line with per-word ink reveal & animated cursor
    ctx.font = `600 ${fontSize}px ${serifFamily}`;
    const lineStartY = centerY - measured.height * 0.5;
    let cursorX = contentX;
    let cursorY = lineStartY;

    for (let w = 0; w < measured.words.length; w++) {
      const word = measured.words[w];
      const wx = contentX + word.x;
      const wy = lineStartY + word.y;

      if (w < frame.activeWordIndex) {
        ctx.globalAlpha = 0.95 * frame.lineFadeAlpha;
        ctx.fillStyle = '#faf3e6';
        ctx.fillText(word.text, wx, wy);
        cursorX = wx + word.width + 6;
        cursorY = wy;
      } else if (w === frame.activeWordIndex) {
        const p = clamp01(frame.wordProgress);
        const charCount = Math.max(1, Math.ceil(word.text.length * Math.max(0.15, p)));
        const revealed = word.text.slice(0, charCount);
        ctx.globalAlpha = frame.lineFadeAlpha;
        ctx.fillStyle = '#fff9ee';
        ctx.fillText(revealed, wx, wy);

        const revealedW = ctx.measureText(revealed).width || word.width * p;
        cursorX = wx + revealedW + 3;
        cursorY = wy;
      } else {
        // Faint paper ghost of upcoming words
        ctx.globalAlpha = 0.16 * frame.lineFadeAlpha;
        ctx.fillStyle = '#d7cab8';
        ctx.fillText(word.text, wx, wy);
      }
    }

    // Crisp animated typewriter cursor
    const blinkOn = frame.reduceMotion || Math.sin(frame.timeSeconds * 7.5) >= -0.2;
    if (blinkOn) {
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = frame.palette.accentPrimary;
      ctx.fillRect(cursorX, cursorY + 4, 3, Math.max(18, fontSize * 0.95));
    }

    ctx.restore();
  }
}
