// Style: StarfieldShip3D
// Variations:
//  0: 'deep-space' (default) - deep cosmos starfield + multi-part 3D starfighter & faceted asteroids
//  1: 'nebula-run'           - album-tinted cosmic nebula clouds + avoidance AI flight
//  2: 'retro-wireframe'      - vector wireframe starfighter, asteroids, and perspective grid

import type { StyleFrameContext } from '../../core/models';
import {
  clamp01,
  drawEmptyState,
  drawRoundedRectPath,
  formatTimestamp,
  getFocalRect,
  isTransparentStage,
  isUnsyncedLyrics,
  type ILyricVisualStyle,
  type StyleMeasurementSpec,
} from '../styleInterface';
import { setShip3DSceneHint } from '../ship3dScene';

export class StarfieldShip3DStyle implements ILyricVisualStyle {
  readonly id = 'StarfieldShip3D' as const;
  readonly name = 'Starfield Ship 3D';
  readonly webGlEffect = 'none' as const;
  readonly usesShip3D = true;

  private scrollY = 0;
  private initialized = false;

  getVariationIndex(variationId?: string): 0 | 1 | 2 {
    if (variationId === 'nebula-run') return 1;
    if (variationId === 'retro-wireframe') return 2;
    return 0;
  }

  getMeasurementSpec(frame: StyleFrameContext): StyleMeasurementSpec {
    // Synchronize variation & backdrop settings before Ship3DScene.render() runs in LyricStageRenderer
    setShip3DSceneHint(
      frame?.variationId,
      frame?.backgroundOpacity,
      frame?.vignetteStrength
    );
    return {
      fontWeight: 700,
      fontSizeMultiplier: 1.02,
      maxLineWidthRatio: 0.78,
    };
  }

  reset(): void {
    this.scrollY = 0;
    this.initialized = false;
  }

  render(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    width: number,
    height: number
  ): void {
    setShip3DSceneHint(
      frame.variationId,
      frame.backgroundOpacity,
      frame.vignetteStrength
    );
    const isTransparent = isTransparentStage(frame);
    const varIdx = this.getVariationIndex(frame.variationId);
    const focal = getFocalRect(frame, width);
    const focalWidth = focal.width;

    // Cockpit HUD framing brackets in upper lyric zone
    const hudW = Math.min(focalWidth * 0.86, 900);
    const hudH = Math.max(128, Math.min(height * 0.38, 236));
    const hudX = (focalWidth - hudW) * 0.5;
    const hudY = Math.max(22, height * 0.12);
    const corner = 18;
    const bpmVal = Math.round(frame.trackMetadata?.bpm || frame.audio.estimatedBpm || 120);
    const warpVal = (
      (bpmVal / 120) *
      (1 + frame.audio.bassEnergy * 2.4 + ((frame.audio.beatStrength ?? 0) > 0.72 ? 0.8 : 0))
    ).toFixed(2);

    ctx.save();
    if (focal.left > 2) {
      ctx.beginPath();
      ctx.rect(focal.left, 0, Math.max(1, width - focal.left), height);
      ctx.clip();
    }
    if (focal.left > 0) {
      ctx.translate(focal.left, 0);
    }

    // Subtle dark HUD backdrop plate in non-transparent mode for crisp lyric readability
    if (!isTransparent) {
      ctx.save();
      drawRoundedRectPath(ctx, hudX, hudY, hudW, hudH, 12);
      ctx.fillStyle = varIdx === 2 ? 'rgba(6, 4, 16, 0.58)' : 'rgba(4, 7, 15, 0.42)';
      ctx.fill();
      ctx.restore();
    }

    ctx.strokeStyle = frame.palette.accentPrimary;
    ctx.globalAlpha = isTransparent ? 0.36 : 0.58;
    ctx.lineWidth = varIdx === 2 ? 2.0 : 1.6;
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

    // Cockpit telemetry bar
    if (!isTransparent) {
      const modeTag =
        varIdx === 0 ? 'DEEP-SPACE' : varIdx === 1 ? 'NEBULA-RUN' : 'VECTOR-WIRE';
      ctx.font = `600 11px "JetBrains Mono", monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = frame.palette.accentSecondary;
      ctx.globalAlpha = 0.72;
      ctx.fillText(
        `HUD [${modeTag}] // WARP ${warpVal}C // ${bpmVal} BPM`,
        hudX + 14,
        hudY + 10
      );
      ctx.textAlign = 'right';
      ctx.fillText(
        `NAV:AUTO-WEAVE  T+${formatTimestamp(frame.timeSeconds)}`,
        hudX + hudW - 14,
        hudY + 10
      );
    }

    const layout = frame.layout;
    if (!layout || layout.lines.length === 0) {
      ctx.restore();
      drawEmptyState(ctx, frame, width, hudY + hudH * 1.1, 'Autopilot Engaged');
      return;
    }

    const activeIdx = Math.max(0, Math.min(layout.lines.length - 1, frame.activeLineIndex));
    const activeLine = layout.lines[activeIdx];
    const targetScrollY = activeLine.y + activeLine.height * 0.5;

    if (!this.initialized || frame.didSeekThisFrame || frame.reduceMotion) {
      this.scrollY = targetScrollY;
      this.initialized = true;
    } else {
      const rate = Math.min(1, Math.max(0.016, frame.deltaSeconds) * 8.5);
      this.scrollY += (targetScrollY - this.scrollY) * rate;
    }

    const manualScroll =
      typeof frame.manualScrollY === 'number' && Number.isFinite(frame.manualScrollY)
        ? frame.manualScrollY
        : 0;
    const effectiveScrollY = this.scrollY + manualScroll;
    const isBrowsing = frame.isFollowingPlayback === false || Math.abs(manualScroll) > 3;

    const fontSize = layout.fontSizePx;
    const hudCenterY = hudY + hudH * 0.54;
    const unsyncedOrLineLevel = isUnsyncedLyrics(frame) || frame.activeWordIndex < 0;
    const isLeftAlign = frame.textAlign === 'left';
    const leftPad = hudX + 24;
    const hoveredIdx = typeof frame.hoveredLineIndex === 'number' ? frame.hoveredLineIndex : -1;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    for (let i = 0; i < layout.lines.length; i++) {
      const line = layout.lines[i];
      const lineCenterOffset = line.y + line.height * 0.5 - effectiveScrollY;
      const screenY = hudCenterY + lineCenterOffset - line.height * 0.5;

      if (screenY + line.height < hudY - 24 || screenY > hudY + hudH + 44) continue;
      if (!isBrowsing && i !== activeIdx && i !== activeIdx + 1) continue;

      const isActive = i === activeIdx;
      const isHovered = i === hoveredIdx;
      const lineBaseX = isLeftAlign ? leftPad : line.x;

      if (isActive || isBrowsing) {
        const hitLocalX = Math.max(hudX + 8, lineBaseX - 14);
        const hitW = Math.min(hudW - 16, Math.max(line.width + 28, 160));
        frame.recordHitRect?.(i, focal.left + hitLocalX, screenY - 5, hitW, line.height + 10);

        if (isHovered) {
          ctx.save();
          drawRoundedRectPath(ctx, hitLocalX, screenY - 5, hitW, line.height + 10, 8);
          ctx.fillStyle = 'rgba(94, 234, 212, 0.12)';
          ctx.fill();
          ctx.strokeStyle = frame.palette.accentPrimary;
          ctx.globalAlpha = 0.45;
          ctx.lineWidth = 1.1;
          ctx.stroke();
          ctx.restore();
        }
      }

      if (isActive) {
        ctx.font = `700 ${fontSize}px ${frame.fontFamily}`;
        for (let w = 0; w < line.words.length; w++) {
          const word = line.words[w];
          const wx = lineBaseX + word.x;
          const wy = screenY + word.y;
          const isCurrent = unsyncedOrLineLevel ? true : w === frame.activeWordIndex;
          const isPast = !unsyncedOrLineLevel && w < frame.activeWordIndex;

          ctx.globalAlpha = (isCurrent ? 1.0 : isPast ? 0.9 : isHovered ? 0.65 : 0.4) * frame.lineFadeAlpha;
          ctx.fillStyle = isCurrent
            ? '#ffffff'
            : isPast
            ? frame.palette.textActive
            : frame.palette.textUpcoming;
          ctx.shadowColor = isCurrent ? frame.palette.accentPrimary : frame.palette.accentSecondary;
          ctx.shadowBlur = isCurrent ? 20 + frame.audio.bassEnergy * 12 : isPast ? 8 : 0;
          ctx.fillText(word.text, wx, wy);
        }
      } else if (!isBrowsing && i === activeIdx + 1) {
        // Next HUD line cue below HUD bracket
        const nextY = hudY + hudH + 10;
        const hitLocalX = Math.max(hudX + 16, (focalWidth - line.width * 0.55) * 0.5 - 12);
        const hitW = Math.min(hudW - 32, Math.max(line.width * 0.55 + 24, 140));
        frame.recordHitRect?.(i, focal.left + hitLocalX, nextY - 4, hitW, 26);

        ctx.save();
        ctx.textAlign = isLeftAlign ? 'left' : 'center';
        ctx.font = `500 ${Math.max(13, Math.round(fontSize * 0.48))}px ${frame.fontFamily}`;
        ctx.fillStyle = isHovered ? frame.palette.textActive : frame.palette.textUpcoming;
        ctx.globalAlpha = isHovered ? 0.82 : 0.48;
        ctx.shadowBlur = 0;
        ctx.fillText(line.text, isLeftAlign ? leftPad : focalWidth * 0.5, nextY);
        ctx.restore();
      } else {
        const subScale = 0.76;
        const subFont = Math.max(13, Math.round(fontSize * subScale));
        ctx.save();
        ctx.font = `500 ${subFont}px ${frame.fontFamily}`;
        ctx.fillStyle = frame.palette.textUpcoming;
        ctx.globalAlpha = isHovered ? 0.78 : 0.44;
        ctx.shadowBlur = 0;
        for (let w = 0; w < line.words.length; w++) {
          const word = line.words[w];
          ctx.fillText(word.text, lineBaseX + word.x * subScale, screenY + word.y * subScale);
        }
        ctx.restore();
      }
    }

    ctx.restore();
  }
}
