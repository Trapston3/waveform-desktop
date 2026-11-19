// Style 13: StarfieldShip3D
// Deep 3D parallax starfield + Ship3DScene stylized procedural starship cruising/banking gently
// to bassEnergy & beatDetected while lyrics float in cockpit/HUD space above.

import type { StyleFrameContext } from '../../core/models';
import {
  drawEmptyState,
  formatTimestamp,
  getActiveLine,
  type ILyricVisualStyle,
} from '../styleInterface';

export class StarfieldShip3DStyle implements ILyricVisualStyle {
  readonly id = 'StarfieldShip3D' as const;
  readonly name = 'Starfield Ship 3D';
  readonly webGlEffect = 'starfield' as const;
  readonly usesShip3D = true;

  render(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    width: number,
    height: number
  ): void {
    const isOverlay = Boolean(frame.isOverlayMode);

    // Cockpit HUD framing brackets in upper lyric zone
    const hudW = Math.min(width * 0.84, 880);
    const hudH = Math.max(120, Math.min(height * 0.36, 220));
    const hudX = (width - hudW) * 0.5;
    const hudY = Math.max(24, height * 0.14);
    const corner = 18;

    ctx.save();
    ctx.strokeStyle = frame.palette.accentPrimary;
    ctx.globalAlpha = isOverlay ? 0.32 : 0.5;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    // Top-left bracket
    ctx.moveTo(hudX, hudY + corner);
    ctx.lineTo(hudX, hudY);
    ctx.lineTo(hudX + corner, hudY);
    // Top-right bracket
    ctx.moveTo(hudX + hudW - corner, hudY);
    ctx.lineTo(hudX + hudW, hudY);
    ctx.lineTo(hudX + hudW, hudY + corner);
    // Bottom-left bracket
    ctx.moveTo(hudX, hudY + hudH - corner);
    ctx.lineTo(hudX, hudY + hudH);
    ctx.lineTo(hudX + corner, hudY + hudH);
    // Bottom-right bracket
    ctx.moveTo(hudX + hudW - corner, hudY + hudH);
    ctx.lineTo(hudX + hudW, hudY + hudH);
    ctx.lineTo(hudX + hudW, hudY + hudH - corner);
    ctx.stroke();

    // Minimal cockpit telemetry bar
    if (!isOverlay) {
      ctx.font = `600 11px "JetBrains Mono", monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = frame.palette.accentSecondary;
      ctx.globalAlpha = 0.68;
      ctx.fillText(
        `HUD // WARP ${(1 + frame.audio.bassEnergy * 2.5).toFixed(2)}C`,
        hudX + 14,
        hudY + 10
      );
      ctx.textAlign = 'right';
      ctx.fillText(
        `T+${formatTimestamp(frame.timeSeconds)}`,
        hudX + hudW - 14,
        hudY + 10
      );
    }
    ctx.restore();

    const { line, measured, index } = getActiveLine(frame);
    if (!line || !measured || !frame.layout) {
      drawEmptyState(ctx, frame, width, hudY + hudH * 1.1, 'Autopilot Engaged');
      return;
    }

    // Float lyrics cleanly inside cockpit HUD zone above the starship
    const fontSize = Math.round(frame.layout.fontSizePx * 1.02);
    const textStartY = hudY + (hudH - measured.height) * 0.52;

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `700 ${fontSize}px ${frame.fontFamily}`;

    for (let w = 0; w < measured.words.length; w++) {
      const word = measured.words[w];
      const wx = measured.x + word.x;
      const wy = textStartY + word.y;
      const isCurrent = w === frame.activeWordIndex;
      const isPast = w < frame.activeWordIndex;

      ctx.globalAlpha = (isCurrent ? 1.0 : isPast ? 0.9 : 0.4) * frame.lineFadeAlpha;
      ctx.fillStyle = isCurrent
        ? '#ffffff'
        : isPast
        ? frame.palette.textActive
        : frame.palette.textUpcoming;
      ctx.shadowColor = isCurrent ? frame.palette.accentPrimary : frame.palette.accentSecondary;
      ctx.shadowBlur = isCurrent ? 20 + frame.audio.bassEnergy * 12 : isPast ? 8 : 0;
      ctx.fillText(word.text, wx, wy);
    }

    // Next HUD line cue
    if (index + 1 < frame.layout.lines.length) {
      const next = frame.layout.lines[index + 1];
      ctx.textAlign = 'center';
      ctx.font = `500 ${Math.max(13, Math.round(fontSize * 0.48))}px ${frame.fontFamily}`;
      ctx.fillStyle = frame.palette.textUpcoming;
      ctx.globalAlpha = 0.45;
      ctx.shadowBlur = 0;
      ctx.fillText(next.text, width * 0.5, hudY + hudH + 14);
    }

    ctx.restore();
  }
}
