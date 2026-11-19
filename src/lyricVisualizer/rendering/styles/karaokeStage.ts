// Style 7: KaraokeStage
// High-contrast live stage bounce + word fill-wipe progress bar (wordProgress) + upcoming line preview pill.

import type { StyleFrameContext } from '../../core/models';
import {
  clamp01,
  drawEmptyState,
  drawRoundedRectPath,
  easeOutBack,
  getActiveLine,
  type ILyricVisualStyle,
} from '../styleInterface';

export class KaraokeStageStyle implements ILyricVisualStyle {
  readonly id = 'KaraokeStage' as const;
  readonly name = 'Karaoke Stage';
  readonly webGlEffect = 'none' as const;

  render(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    width: number,
    height: number
  ): void {
    const isOverlay = Boolean(frame.isOverlayMode);

    if (!isOverlay) {
      // Stage spotlight backdrop
      const bg = ctx.createRadialGradient(
        width * 0.5,
        height * 0.25,
        20,
        width * 0.5,
        height * 0.55,
        Math.max(width, height) * 0.85
      );
      bg.addColorStop(0, frame.palette.bgMid);
      bg.addColorStop(0.65, frame.palette.bgDeep);
      bg.addColorStop(1, '#06070c');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
    }

    const { line, measured, index } = getActiveLine(frame);
    if (!line || !measured || !frame.layout) {
      drawEmptyState(ctx, frame, width, height, 'Ready for stage cue');
      return;
    }

    const cx = width * 0.5;
    const cy = height * 0.46;
    const fontSize = Math.round(frame.layout.fontSizePx * 1.12);
    const startY = cy - measured.height * 0.5;

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `800 ${fontSize}px ${frame.fontFamily}`;

    const totalWords = Math.max(1, measured.words.length);
    const overallLineProgress = clamp01(
      (Math.max(0, frame.activeWordIndex) + clamp01(frame.wordProgress)) / totalWords
    );

    for (let w = 0; w < measured.words.length; w++) {
      const word = measured.words[w];
      const wx = measured.x + word.x;
      const isActive = w === frame.activeWordIndex;
      const isPast = w < frame.activeWordIndex;

      // Live stage bounce on active word
      const bounceY =
        isActive && !frame.reduceMotion
          ? -8 * Math.sin(clamp01(frame.wordProgress) * Math.PI) * easeOutBack(Math.min(1, frame.wordProgress * 1.4))
          : 0;
      const wy = startY + word.y + bounceY;

      // High-contrast outline for stage legibility
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.78)';
      ctx.strokeText(word.text, wx, wy);

      if (isPast) {
        ctx.fillStyle = frame.palette.accentPrimary;
        ctx.fillText(word.text, wx, wy);
      } else if (isActive) {
        const p = clamp01(frame.wordProgress);
        // Unfilled base
        ctx.fillStyle = '#ffffff';
        ctx.fillText(word.text, wx, wy);

        // Word fill-wipe clip
        ctx.save();
        ctx.beginPath();
        ctx.rect(wx - 4, wy - 10, (word.width + 8) * p, word.height + 24);
        ctx.clip();
        ctx.fillStyle = frame.palette.accentPrimary;
        ctx.shadowColor = frame.palette.accentPrimary;
        ctx.shadowBlur = 14;
        ctx.fillText(word.text, wx, wy);
        ctx.restore();
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.52)';
        ctx.fillText(word.text, wx, wy);
      }
    }

    // Crisp horizontal line progress bar
    const barW = Math.min(width * 0.56, Math.max(180, measured.width));
    const barH = 5;
    const barX = cx - barW * 0.5;
    const barY = startY + measured.height + 20;

    drawRoundedRectPath(ctx, barX, barY, barW, barH, 3);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.fill();

    drawRoundedRectPath(ctx, barX, barY, Math.max(6, barW * overallLineProgress), barH, 3);
    ctx.fillStyle = frame.palette.accentPrimary;
    ctx.fill();

    // Upcoming line preview pill
    if (index + 1 < frame.layout.lines.length) {
      const next = frame.layout.lines[index + 1];
      const pillFont = Math.max(13, Math.round(fontSize * 0.44));
      ctx.font = `600 ${pillFont}px ${frame.fontFamily}`;
      const label = `NEXT  ${next.text}`;
      const labelW = Math.min(width * 0.78, (ctx.measureText(label).width || label.length * pillFont * 0.55) + 34);
      const pillH = pillFont + 18;
      const pillX = cx - labelW * 0.5;
      const pillY = barY + 26;

      drawRoundedRectPath(ctx, pillX, pillY, labelW, pillH, pillH * 0.5);
      ctx.fillStyle = isOverlay ? 'rgba(10, 12, 18, 0.65)' : 'rgba(255, 255, 255, 0.08)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = frame.palette.textUpcoming;
      ctx.globalAlpha = 0.88;
      ctx.fillText(label, cx, pillY + pillH * 0.5);
    }

    ctx.restore();
  }
}
