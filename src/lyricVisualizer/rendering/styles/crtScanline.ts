// Style 12: CRTScanline
// Retro phosphor monitor curvature vignette, subtle RGB phosphor mask & scanlines,
// crisp glowing terminal/display lyrics (strictly respects reduceMotion).

import type { StyleFrameContext } from '../../core/models';
import {
  drawEmptyState,
  formatTimestamp,
  getActiveLine,
  type ILyricVisualStyle,
} from '../styleInterface';

export class CRTScanlineStyle implements ILyricVisualStyle {
  readonly id = 'CRTScanline' as const;
  readonly name = 'CRT Scanline';
  readonly webGlEffect = 'crtScanline' as const;

  render(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    width: number,
    height: number
  ): void {
    const isOverlay = Boolean(frame.isOverlayMode);

    if (!isOverlay) {
      // Subtle scanlines & phosphor curvature vignette
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
      for (let y = 0; y < height; y += 4) {
        ctx.fillRect(0, y, width, 1.5);
      }

      const vig = ctx.createRadialGradient(
        width * 0.5,
        height * 0.5,
        Math.min(width, height) * 0.34,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.72
      );
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.62)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    const { line, measured, index } = getActiveLine(frame);
    if (!line || !measured || !frame.layout) {
      drawEmptyState(ctx, frame, width, height, '> AWAITING SIGNAL_');
      return;
    }

    const monoFamily = `"JetBrains Mono", ${frame.fontFamily}`;
    const fontSize = Math.round(frame.layout.fontSizePx * 0.94);
    const padX = Math.max(32, Math.round(width * 0.1));
    const cy = height * 0.48;
    const startY = cy - measured.height * 0.5;
    const phosphor = frame.palette.accentPrimary;

    // Respect reduceMotion: zero jitter/flicker when reduceMotion is true
    const jitterX = frame.reduceMotion ? 0 : (frame.audio.beatDetected ? 1.5 : 0);
    const flicker = frame.reduceMotion ? 1.0 : 0.96 + 0.04 * Math.sin(frame.timeSeconds * 38);

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // Terminal header bar
    if (!isOverlay) {
      ctx.font = `600 12px ${monoFamily}`;
      ctx.fillStyle = phosphor;
      ctx.globalAlpha = 0.72 * flicker;
      ctx.fillText(
        `SYS://LYRIC-CRT  CH:${String(index + 1).padStart(2, '0')}  T+${formatTimestamp(frame.timeSeconds)}`,
        padX,
        Math.max(24, startY - 64)
      );
    }

    // Previous line dim phosphor persistence
    if (index > 0) {
      const prev = frame.layout.lines[index - 1];
      ctx.font = `500 ${Math.round(fontSize * 0.65)}px ${monoFamily}`;
      ctx.fillStyle = phosphor;
      ctx.globalAlpha = 0.28 * flicker;
      ctx.fillText(`  ${prev.text}`, padX, startY - fontSize * 1.1);
    }

    // Active terminal prompt + RGB phosphor split + glowing words
    ctx.font = `700 ${fontSize}px ${monoFamily}`;
    ctx.fillStyle = phosphor;
    ctx.globalAlpha = 0.9 * flicker;
    ctx.fillText('>', Math.max(12, padX - fontSize * 0.75), startY);

    for (let w = 0; w < measured.words.length; w++) {
      const word = measured.words[w];
      const wx = padX + word.x + jitterX;
      const wy = startY + word.y;
      const isCurrent = w === frame.activeWordIndex;
      const isPast = w < frame.activeWordIndex;

      if (isCurrent) {
        // Subtle RGB subpixel fringe (zero when reduceMotion)
        if (!frame.reduceMotion) {
          ctx.globalAlpha = 0.32 * flicker;
          ctx.fillStyle = '#ff4d6d';
          ctx.fillText(word.text, wx - 1.5, wy);
          ctx.fillStyle = '#4cc9f0';
          ctx.fillText(word.text, wx + 1.5, wy);
        }
        ctx.globalAlpha = frame.lineFadeAlpha * flicker;
        ctx.fillStyle = '#eafff5';
        ctx.shadowColor = phosphor;
        ctx.shadowBlur = 18;
        ctx.fillText(word.text, wx, wy);
      } else {
        ctx.shadowBlur = isPast ? 8 : 0;
        ctx.shadowColor = phosphor;
        ctx.globalAlpha = (isPast ? 0.85 : 0.34) * frame.lineFadeAlpha * flicker;
        ctx.fillStyle = isPast ? phosphor : frame.palette.textUpcoming;
        ctx.fillText(word.text, wx, wy);
      }
    }

    ctx.restore();
  }
}
