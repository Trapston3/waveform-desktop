// Style 4: MinimalSwiss
// Crisp asymmetric Swiss modernist grid, tight grotesque typography, bold active line bar indicator,
// clean micro-timestamps.

import type { StyleFrameContext } from '../../core/models';
import {
  drawEmptyState,
  formatTimestamp,
  type ILyricVisualStyle,
} from '../styleInterface';

export class MinimalSwissStyle implements ILyricVisualStyle {
  readonly id = 'MinimalSwiss' as const;
  readonly name = 'Minimal Swiss';
  readonly webGlEffect = 'none' as const;

  render(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    width: number,
    height: number
  ): void {
    const isOverlay = Boolean(frame.isOverlayMode);
    const gutterX = Math.max(88, Math.round(width * 0.16));

    if (!isOverlay) {
      ctx.fillStyle = frame.palette.bgDeep;
      ctx.fillRect(0, 0, width, height);

      // Swiss 12-column hairline grid
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gutterX - 18, 0);
      ctx.lineTo(gutterX - 18, height);
      ctx.moveTo(width * 0.88, 0);
      ctx.lineTo(width * 0.88, height);
      ctx.moveTo(0, height * 0.14);
      ctx.lineTo(width, height * 0.14);
      ctx.stroke();
      ctx.restore();
    }

    const layout = frame.layout;
    if (!layout || layout.lines.length === 0) {
      drawEmptyState(ctx, frame, width, height, 'NO LYRIC TRACK');
      return;
    }

    const activeIdx = Math.max(0, Math.min(layout.lines.length - 1, frame.activeLineIndex));
    const activeLine = layout.lines[activeIdx];
    const anchorY = height * 0.44;
    const scrollY = activeLine.y;
    const fontSize = Math.round(layout.fontSizePx * 0.96);

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // Top-left Swiss grid index badge
    if (!isOverlay) {
      ctx.font = `600 11px "JetBrains Mono", monospace`;
      ctx.fillStyle = frame.palette.accentPrimary;
      ctx.globalAlpha = 0.85;
      ctx.fillText(
        `INDEX ${String(activeIdx + 1).padStart(2, '0')}/${String(layout.lines.length).padStart(2, '0')}`,
        gutterX,
        Math.max(18, height * 0.08)
      );
    }

    for (let i = 0; i < layout.lines.length; i++) {
      const line = layout.lines[i];
      const y = anchorY + (line.y - scrollY);
      if (y + line.height < -60 || y > height + 60) continue;

      const isActive = i === activeIdx;
      const isPast = i < activeIdx;

      // Micro-timestamp in left Swiss column
      ctx.font = `500 12px "JetBrains Mono", monospace`;
      ctx.fillStyle = isActive ? frame.palette.accentPrimary : frame.palette.textPassed;
      ctx.globalAlpha = isActive ? 0.95 : 0.4;
      ctx.fillText(formatTimestamp(line.startSeconds), Math.max(18, gutterX - 72), y + 8);

      // Bold vertical Swiss active line bar indicator
      if (isActive) {
        ctx.globalAlpha = 1.0;
        ctx.fillStyle = frame.palette.accentPrimary;
        const barH = Math.max(fontSize, line.height - 6);
        ctx.fillRect(gutterX - 20, y + 2, 5, barH);
      }

      // Tight grotesque typography
      ctx.font = `${isActive ? 700 : 500} ${fontSize}px ${frame.fontFamily}`;
      for (let w = 0; w < line.words.length; w++) {
        const word = line.words[w];
        const wx = gutterX + word.x;
        const wy = y + word.y;
        if (isActive) {
          const isWordCurrent = w === frame.activeWordIndex;
          const isWordPassed = w < frame.activeWordIndex;
          ctx.fillStyle = isWordCurrent
            ? frame.palette.accentPrimary
            : isWordPassed
            ? frame.palette.textActive
            : frame.palette.textUpcoming;
          ctx.globalAlpha = isWordCurrent || isWordPassed ? 1.0 : 0.45;
        } else {
          ctx.fillStyle = isPast ? frame.palette.textPassed : frame.palette.textUpcoming;
          ctx.globalAlpha = Math.max(0.18, 0.48 - Math.abs(i - activeIdx) * 0.1);
        }
        ctx.fillText(word.text, wx, wy);
      }
    }

    ctx.restore();
  }
}
