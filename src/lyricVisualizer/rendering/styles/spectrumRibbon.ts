// Style 10: SpectrumRibbon
// Flowing multi-band FFT waveform ribbons across background driven by bass/mid/treble energy
// behind illuminated lyrics.

import type { StyleFrameContext } from '../../core/models';
import {
  drawEmptyState,
  getActiveLine,
  type ILyricVisualStyle,
} from '../styleInterface';

const RIBBON_SEGMENTS = 48;

export class SpectrumRibbonStyle implements ILyricVisualStyle {
  readonly id = 'SpectrumRibbon' as const;
  readonly name = 'Spectrum Ribbon';
  readonly webGlEffect = 'none' as const;

  render(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    width: number,
    height: number
  ): void {
    const isOverlay = Boolean(frame.isOverlayMode);

    if (!isOverlay) {
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, frame.palette.bgDeep);
      bg.addColorStop(0.5, frame.palette.bgMid);
      bg.addColorStop(1, frame.palette.bgDeep);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
    }

    // Draw 3 multi-band flowing ribbons (bass, mid, treble)
    const t = frame.reduceMotion ? 0.5 : frame.timeSeconds;
    const baseY = height * 0.52;
    const stepX = width / RIBBON_SEGMENTS;

    ctx.save();
    for (let band = 0; band < 3; band++) {
      const energy =
        band === 0
          ? frame.audio.bassEnergy
          : band === 1
          ? frame.audio.midEnergy
          : frame.audio.trebleEnergy;
      const freq = band === 0 ? 1.8 : band === 1 ? 3.4 : 5.6;
      const speed = band === 0 ? 1.1 : band === 1 ? 1.8 : 2.6;
      const amp = (16 + energy * 72 + (frame.audio.beatDetected ? 14 : 0)) * (band === 0 ? 1.15 : band === 1 ? 0.85 : 0.6);
      const yOffset = (band - 1) * 34;

      ctx.beginPath();
      for (let s = 0; s <= RIBBON_SEGMENTS; s++) {
        const nx = s / RIBBON_SEGMENTS;
        const env = Math.sin(nx * Math.PI); // Taper at screen edges
        const wave =
          Math.sin(nx * Math.PI * freq + t * speed) * 0.65 +
          Math.cos(nx * Math.PI * (freq * 1.7) - t * (speed * 0.8)) * 0.35;
        const x = s * stepX;
        const y = baseY + yOffset + wave * amp * env;
        if (s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      ctx.strokeStyle =
        band === 0
          ? frame.palette.accentPrimary
          : band === 1
          ? frame.palette.accentSecondary
          : frame.palette.textActive;
      ctx.lineWidth = band === 0 ? 3.2 : band === 1 ? 2.2 : 1.4;
      ctx.globalAlpha = (isOverlay ? 0.42 : 0.68) * (0.6 + energy * 0.4);
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = band === 0 ? 18 : 10;
      ctx.stroke();
    }
    ctx.restore();

    const { line, measured, index } = getActiveLine(frame);
    if (!line || !measured || !frame.layout) {
      drawEmptyState(ctx, frame, width, height);
      return;
    }

    const cx = width * 0.5;
    const cy = height * 0.48;
    const fontSize = Math.round(frame.layout.fontSizePx * 1.06);
    const startY = cy - measured.height * 0.5;

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `700 ${fontSize}px ${frame.fontFamily}`;

    for (let w = 0; w < measured.words.length; w++) {
      const word = measured.words[w];
      const wx = measured.x + word.x;
      const wy = startY + word.y;
      const isCurrent = w === frame.activeWordIndex;
      const isPast = w < frame.activeWordIndex;

      ctx.globalAlpha = (isCurrent ? 1.0 : isPast ? 0.9 : 0.38) * frame.lineFadeAlpha;
      ctx.fillStyle = isCurrent
        ? '#ffffff'
        : isPast
        ? frame.palette.textActive
        : frame.palette.textUpcoming;
      ctx.shadowColor = isCurrent ? frame.palette.accentPrimary : 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = isCurrent ? 18 : 6;
      ctx.fillText(word.text, wx, wy);
    }

    if (index + 1 < frame.layout.lines.length) {
      const next = frame.layout.lines[index + 1];
      ctx.textAlign = 'center';
      ctx.font = `500 ${Math.round(fontSize * 0.56)}px ${frame.fontFamily}`;
      ctx.fillStyle = frame.palette.textUpcoming;
      ctx.globalAlpha = 0.42;
      ctx.shadowBlur = 0;
      ctx.fillText(next.text, cx, startY + measured.height + fontSize * 0.65);
    }

    ctx.restore();
  }
}
