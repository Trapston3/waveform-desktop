// Style: StarfieldShip3D
// Variations:
//  0: 'deep-space' (default) - deep cosmos starfield + multi-part Three.js 3D starfighter & cratered asteroids
//  1: 'nebula-run'           - album-tinted cosmic nebula clouds + avoidance AI flight
//  2: 'retro-wireframe'      - vector wireframe starfighter, asteroids, and perspective grid

import type { StyleFrameContext } from '../../core/models';
import {
  clamp01,
  drawRoundedRectPath,
  formatTimestamp,
  getFocalRect,
  isTransparentStage,
  isUnsyncedLyrics,
  resolveDisplayLine,
  type ILyricVisualStyle,
  type StyleMeasurementSpec,
} from '../styleInterface';
import { getActiveShip3DScene, setShip3DSceneHint, type Ship3DHudTelemetry } from '../ship3dScene';

export class StarfieldShip3DStyle implements ILyricVisualStyle {
  readonly id = 'StarfieldShip3D' as const;
  readonly name = 'Starfield Ship 3D';
  readonly webGlEffect = 'starfield' as const;
  readonly usesShip3D = true;

  private scrollY = 0;
  private initialized = false;
  private lastKnownActiveIdx = -1;

  getVariationIndex(variationId?: string): 0 | 1 | 2 {
    if (variationId === 'nebula-run') return 1;
    if (variationId === 'retro-wireframe' || variationId === 'retro-vector-wireframe') return 2;
    return 0;
  }

  getMeasurementSpec(frame?: StyleFrameContext): StyleMeasurementSpec {
    // Synchronize variation & backdrop settings before Ship3DScene.render() runs in LyricStageRenderer
    setShip3DSceneHint(
      frame?.variationId,
      frame?.backgroundOpacity,
      frame?.vignetteStrength
    );
    return {
      fontWeight: 700,
      fontSizeMultiplier: 0.96,
      maxLineWidthRatio: 0.72,
      scriptMode: frame?.scriptMode ?? 'auto',
      styleId: this.id,
    };
  }

  reset(): void {
    this.scrollY = 0;
    this.initialized = false;
    this.lastKnownActiveIdx = -1;
  }

  private drawSignalInstrumentalWaveform(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    hudX: number,
    hudW: number,
    lyricTop: number,
    lyricBottom: number,
    isTransparent: boolean
  ): void {
    const areaH = Math.max(48, lyricBottom - lyricTop);
    const cx = hudX + hudW * 0.5;
    const waveCenterY = lyricTop + areaH * 0.42;
    const motion = frame.reduceMotion ? 0 : 1;
    const t = frame.timeSeconds || 0;
    const bass = frame.audio?.bassEnergy ?? 0;
    const mid = frame.audio?.midEnergy ?? 0;
    const treble = frame.audio?.trebleEnergy ?? 0;
    const rms = frame.audio?.rmsLevel ?? 0;
    const beatBoost = motion > 0 && frame.audio?.beatDetected ? 0.25 : 0;

    ctx.save();

    // Subtle baseline across HUD interior
    ctx.strokeStyle = frame.palette.accentPrimary;
    ctx.globalAlpha = isTransparent ? 0.25 : 0.22;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hudX + 24, waveCenterY);
    ctx.lineTo(hudX + hudW - 24, waveCenterY);
    ctx.stroke();

    // 18-bar beat-reactive telemetry waveform centered safely below lyricTop
    const barCount = 18;
    const barW = 5;
    const barGap = 7;
    const totalW = barCount * barW + (barCount - 1) * barGap;
    const startX = cx - totalW * 0.5;
    const maxBarH = Math.max(18, Math.min(44, areaH * 0.46));

    for (let i = 0; i < barCount; i++) {
      const band = i < 6 ? bass : i < 12 ? mid : treble;
      const env = Math.sin(((i + 0.5) / barCount) * Math.PI);
      const wave =
        motion === 0
          ? 0.45
          : 0.25 + 0.75 * Math.abs(Math.sin(t * 5.6 + i * 0.72));
      const amp = clamp01(0.18 + env * wave * (0.4 + band * 0.8 + rms * 0.35 + beatBoost));
      const bh = Math.max(4, Math.round(maxBarH * amp));
      const bx = startX + i * (barW + barGap);
      const by = waveCenterY - bh * 0.5;
      ctx.fillStyle = i % 2 === 0 ? frame.palette.accentPrimary : frame.palette.accentSecondary;
      ctx.globalAlpha = 0.74 + amp * 0.26;
      drawRoundedRectPath(ctx, bx, by, barW, bh, 2.5);
      ctx.fill();
    }

    const countdown =
      typeof frame.timeUntilNextLine === 'number' &&
      Number.isFinite(frame.timeUntilNextLine) &&
      frame.timeUntilNextLine > 0 &&
      frame.timeUntilNextLine <= 3
        ? `  //  NEXT IN ${Math.ceil(frame.timeUntilNextLine)}S`
        : '';
    const labelY = Math.min(lyricBottom - 20, Math.max(lyricTop + 4, waveCenterY + maxBarH * 0.5 + 14));
    ctx.font = `700 12px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = frame.palette.textActive;
    ctx.globalAlpha = motion === 0 ? 0.84 : 0.72 + 0.28 * Math.sin(t * 3.0);
    ctx.fillText(`SIGNAL // INSTRUMENTAL${countdown}  •  AUTOPILOT // ASTEROID GAUNTLET`, cx, labelY);

    const progress =
      typeof frame.gapProgress === 'number' && Number.isFinite(frame.gapProgress)
        ? clamp01(frame.gapProgress)
        : 0;
    if (
      progress > 0 &&
      progress < 1 &&
      typeof frame.timeUntilNextLine === 'number' &&
      Number.isFinite(frame.timeUntilNextLine)
    ) {
      const trackW = Math.min(320, hudW - 80);
      const trackX = cx - trackW * 0.5;
      const trackY = lyricBottom - 6;
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = '#ffffff';
      drawRoundedRectPath(ctx, trackX, trackY, trackW, 2.5, 1.25);
      ctx.fill();

      ctx.globalAlpha = 0.92;
      ctx.fillStyle = frame.palette.accentPrimary;
      drawRoundedRectPath(ctx, trackX, trackY, Math.max(6, trackW * progress), 2.5, 1.25);
      ctx.fill();
    }

    ctx.restore();
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

    // Cockpit HUD framing brackets in upper lyric zone with generous padded interior
    const hudW = Math.min(focalWidth * 0.86, 900);
    const hudH = Math.max(176, Math.min(height * 0.44, 268));
    const hudX = (focalWidth - hudW) * 0.5;
    const hudY = Math.max(20, height * 0.1);
    const corner = 18;
    const lyricTop = hudY + 62; // >= 36px clearance below top HUD header bar (hudY + 10..24)
    const lyricBottom = hudY + hudH - 14;
    const lyricAreaH = Math.max(72, lyricBottom - lyricTop);
    const lyricCenterY = lyricTop + lyricAreaH * 0.5;

    const bpmVal = Math.round(frame.trackMetadata?.bpm || frame.audio.estimatedBpm || 120);
    const warpVal = (
      (bpmVal / 120) *
      (1 + frame.audio.bassEnergy * 2.4 + ((frame.audio.beatStrength ?? 0) > 0.72 ? 0.8 : 0))
    ).toFixed(2);
    const activeScene = getActiveShip3DScene();
    const telemetry: Ship3DHudTelemetry | null = activeScene ? activeScene.getHudTelemetry() : null;
    const scoreStr = String(telemetry ? telemetry.score : 0).padStart(6, '0');
    const comboVal = telemetry ? telemetry.combo : 0;
    const wordPop = telemetry && !frame.reduceMotion ? telemetry.wordPop : 0;
    const icePulse = telemetry ? telemetry.icePulse : 0;
    const chromaPulse = telemetry && !frame.reduceMotion ? Math.max(telemetry.chromaticPulse, telemetry.glitchPulse) : 0;

    // Draw floating 3D Lyric Gate word tags in the lower 3D flight corridor (below HUD brackets)
    if (activeScene && !isTransparent) {
      const gateCount = activeScene.getProjectedWordGateCount();
      if (gateCount > 0) {
        ctx.save();
        ctx.font = `700 11px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const minTagY = hudY + hudH + 14;
        for (let g = gateCount - 1; g >= 0; g--) {
          const gp = activeScene.getProjectedWordGate(g);
          if (!gp.text || gp.alpha <= 0.05) continue;
          if (gp.screenY < minTagY || gp.screenY > height - 24) continue;
          if (gp.screenX < focal.left + 32 || gp.screenX > focal.left + focalWidth - 32) continue;
          ctx.globalAlpha = gp.alpha * (gp.isActive ? 0.95 : 0.65);
          ctx.fillStyle = gp.isActive ? '#ffffff' : frame.palette.accentPrimary;
          ctx.shadowColor = frame.palette.accentPrimary;
          ctx.shadowBlur = gp.isActive ? 10 : 4;
          ctx.fillText(gp.text.toUpperCase(), gp.screenX, gp.screenY);
        }
        ctx.restore();
      }
    }

    ctx.save();
    // WS2: no full-height focal.left clip; translate smoothly into focal stage
    if (focal.left > 0) {
      ctx.translate(focal.left, 0);
    }

    // Subtle dark HUD backdrop plate in non-transparent mode for crisp lyric readability
    if (!isTransparent) {
      ctx.save();
      drawRoundedRectPath(ctx, hudX, hudY, hudW, hudH, 12);
      ctx.fillStyle = varIdx === 2 ? 'rgba(6, 4, 16, 0.58)' : 'rgba(4, 7, 15, 0.46)';
      ctx.fill();
      ctx.restore();
    }

    ctx.strokeStyle = icePulse > 0.1 ? '#7dd3fc' : frame.palette.accentPrimary;
    ctx.globalAlpha = isTransparent ? 0.36 : 0.58 + (telemetry ? telemetry.collectFlash * 0.25 : 0);
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

    // Cockpit telemetry bar (strictly inside top HUD header above lyricTop)
    if (!isTransparent) {
      const modeTag =
        varIdx === 0 ? 'DEEP-SPACE' : varIdx === 1 ? 'NEBULA-RUN' : 'VECTOR-WIRE';
      ctx.font = `600 11px "JetBrains Mono", monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = frame.palette.accentSecondary;
      ctx.globalAlpha = 0.84;
      ctx.fillText(
        `HUD [${modeTag}] // SCORE ${scoreStr} // COMBO x${comboVal}`,
        hudX + 14,
        hudY + 10
      );
      ctx.textAlign = 'right';
      ctx.fillText(
        `NAV:AUTO-WEAVE  WARP ${warpVal}C • ${bpmVal} BPM`,
        hudX + hudW - 14,
        hudY + 10
      );

      // Subtle header divider rule well above lyricTop
      ctx.strokeStyle = frame.palette.accentPrimary;
      ctx.globalAlpha = 0.2;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hudX + 14, hudY + 34);
      ctx.lineTo(hudX + hudW - 14, hudY + 34);
      ctx.stroke();

      // Micro-toast below HUD bottom bracket (never collides with lyrics or top header)
      if (telemetry && telemetry.toastAlpha > 0.05 && telemetry.toastText) {
        ctx.save();
        ctx.font = `700 11px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.globalAlpha = Math.min(1, telemetry.toastAlpha);
        ctx.fillStyle =
          telemetry.toastColorKind === 'gold'
            ? '#fbbf24'
            : telemetry.toastColorKind === 'danger'
            ? '#fb7185'
            : telemetry.toastColorKind === 'ice'
            ? '#7dd3fc'
            : frame.palette.accentPrimary;
        ctx.fillText(telemetry.toastText, hudX + hudW * 0.5, hudY + hudH + 8);
        ctx.restore();
      }
    }

    const manualScroll =
      typeof frame.manualScrollY === 'number' && Number.isFinite(frame.manualScrollY)
        ? frame.manualScrollY
        : 0;
    const isBrowsing = frame.isFollowingPlayback === false || Math.abs(manualScroll) > 3;

    const layout = frame.layout;
    if (!layout || layout.lines.length === 0) {
      // Strictly clip interior HUD area for empty / instrumental signal
      ctx.save();
      ctx.beginPath();
      ctx.rect(hudX + 10, lyricTop, Math.max(1, hudW - 20), lyricAreaH);
      ctx.clip();
      this.drawSignalInstrumentalWaveform(ctx, frame, hudX, hudW, lyricTop, lyricBottom, isTransparent);
      ctx.restore();
      ctx.restore();
      return;
    }

    // WS6: preserve lastActiveLineIndex instead of clamping -1 -> 0
    const hasActiveLine = frame.activeLineIndex >= 0 && frame.activeLineIndex < layout.lines.length;
    if (hasActiveLine) {
      this.lastKnownActiveIdx = frame.activeLineIndex;
    }
    const fallbackIdx =
      typeof frame.lastActiveLineIndex === 'number' && frame.lastActiveLineIndex >= 0
        ? frame.lastActiveLineIndex
        : this.lastKnownActiveIdx >= 0
        ? this.lastKnownActiveIdx
        : 0;
    const scrollIdx = Math.max(
      0,
      Math.min(layout.lines.length - 1, hasActiveLine ? frame.activeLineIndex : fallbackIdx)
    );
    const anchorLine = layout.lines[scrollIdx];
    const targetScrollY = anchorLine.y + anchorLine.height * 0.5;

    if (!this.initialized || frame.didSeekThisFrame || frame.reduceMotion) {
      this.scrollY = targetScrollY;
      this.initialized = true;
    } else {
      const rate = Math.min(1, Math.max(0.016, frame.deltaSeconds) * 8.5);
      this.scrollY += (targetScrollY - this.scrollY) * rate;
    }

    const effectiveScrollY = this.scrollY + manualScroll;

    // Strictly clip all HUD lyric lines and waveforms to padded cockpit HUD interior below header
    ctx.save();
    ctx.beginPath();
    ctx.rect(hudX + 10, lyricTop, Math.max(1, hudW - 20), lyricAreaH);
    ctx.clip();

    if (frame.isInstrumentalGap && !isBrowsing) {
      this.drawSignalInstrumentalWaveform(ctx, frame, hudX, hudW, lyricTop, lyricBottom, isTransparent);
      ctx.restore();
      ctx.restore();
      return;
    }

    const fontSize = layout.fontSizePx;
    const unsyncedOrLineLevel = isUnsyncedLyrics(frame) || frame.activeWordIndex < 0;
    const isLeftAlign = frame.textAlign === 'left';
    const leftPad = hudX + 24;
    const hoveredIdx = typeof frame.hoveredLineIndex === 'number' ? frame.hoveredLineIndex : -1;

    // Ensure tall wrapped active line never starts above lyricTop during normal playback
    let centerAnchorY = lyricCenterY;
    if (!isBrowsing && hasActiveLine) {
      const activeRawY = lyricCenterY + (anchorLine.y + anchorLine.height * 0.5 - effectiveScrollY) - anchorLine.height * 0.5;
      if (activeRawY < lyricTop + 4) {
        centerAnchorY += lyricTop + 4 - activeRawY;
      }
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    for (let i = 0; i < layout.lines.length; i++) {
      const line = layout.lines[i];
      const lineCenterOffset = line.y + line.height * 0.5 - effectiveScrollY;
      const screenY = centerAnchorY + lineCenterOffset - line.height * 0.5;

      // Strict HUD interior vertical bounds guard (ensures zero text collides with HUD header even in headless mocks)
      if (screenY + line.height < lyricTop || screenY > lyricBottom) continue;
      if (!isBrowsing && Math.abs(i - scrollIdx) > 1) continue;

      const isActive = hasActiveLine && i === frame.activeLineIndex;
      const isHovered = i === hoveredIdx;
      const rawLine = frame.lyrics?.lines[i];
      const resolved = rawLine ? resolveDisplayLine(rawLine, frame.scriptMode, this.id) : null;
      const secondaryText = line.secondaryText ?? resolved?.secondaryText ?? null;

      const lineBaseX = isLeftAlign
        ? leftPad
        : Math.max(hudX + 20, hudX + (hudW - line.width) * 0.5);

      const hitTop = Math.max(lyricTop, screenY - 4);
      const hitBottom = Math.min(lyricBottom, screenY + line.height + 4);
      if (hitBottom > hitTop + 4) {
        const hitLocalX = Math.max(hudX + 12, lineBaseX - 12);
        const hitW = Math.min(hudW - 24, Math.max(line.width + 24, 150));
        frame.recordHitRect?.(i, focal.left + hitLocalX, hitTop, hitW, hitBottom - hitTop);

        if (isHovered) {
          ctx.save();
          drawRoundedRectPath(ctx, hitLocalX, hitTop, hitW, hitBottom - hitTop, 8);
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
          if (wy < lyricTop || wy + fontSize > lyricBottom + 4) continue;

          const isCurrent = unsyncedOrLineLevel ? true : w === frame.activeWordIndex;
          const isPast = !unsyncedOrLineLevel && w < frame.activeWordIndex;

          ctx.globalAlpha = (isCurrent ? 1.0 : isPast ? 0.9 : isHovered ? 0.65 : 0.4) * frame.lineFadeAlpha;
          ctx.fillStyle = isCurrent
            ? '#ffffff'
            : isPast
            ? frame.palette.textActive
            : frame.palette.textUpcoming;
          ctx.shadowColor = isCurrent ? frame.palette.accentPrimary : frame.palette.accentSecondary;
          ctx.shadowBlur = isCurrent ? 20 + frame.audio.bassEnergy * 12 + wordPop * 10 : isPast ? 8 : 0;

          if (isCurrent && (wordPop > 0.04 || chromaPulse > 0.15)) {
            const popScale = 1.0 + wordPop * 0.18;
            const halfW = word.width * 0.5;
            const halfH = fontSize * 0.5;
            ctx.save();
            ctx.translate(wx + halfW, wy + halfH);
            ctx.scale(popScale, popScale);
            if (chromaPulse > 0.15) {
              const split = chromaPulse * 2.5;
              ctx.globalAlpha *= 0.65;
              ctx.fillStyle = '#ff2e63';
              ctx.fillText(word.text, -halfW - split, -halfH);
              ctx.fillStyle = '#00f5d4';
              ctx.fillText(word.text, -halfW + split, -halfH);
              ctx.globalAlpha = frame.lineFadeAlpha;
              ctx.fillStyle = '#ffffff';
            }
            ctx.fillText(word.text, -halfW, -halfH);
            ctx.restore();
          } else {
            ctx.fillText(word.text, wx, wy);
          }
        }

        // Secondary translation / original subtitle line inside HUD interior
        if (secondaryText) {
          const secFont = Math.max(11, Math.round(fontSize * 0.42));
          const secY = screenY + line.height + 4;
          if (secY >= lyricTop && secY + secFont <= lyricBottom) {
            ctx.save();
            ctx.font = `500 ${secFont}px ${frame.fontFamily}`;
            ctx.textAlign = isLeftAlign ? 'left' : 'center';
            ctx.fillStyle = frame.palette.textUpcoming;
            ctx.globalAlpha = 0.72 * frame.lineFadeAlpha;
            ctx.shadowBlur = 0;
            ctx.fillText(secondaryText, isLeftAlign ? leftPad : hudX + hudW * 0.5, secY);
            ctx.restore();
          }
        }
      } else {
        const subScale = isBrowsing ? 0.76 : 0.62;
        const subFont = Math.max(12, Math.round(fontSize * subScale));
        const subLineBaseX = isLeftAlign
          ? leftPad
          : Math.max(hudX + 20, hudX + (hudW - line.width * subScale) * 0.5);
        ctx.save();
        ctx.font = `500 ${subFont}px ${frame.fontFamily}`;
        ctx.fillStyle = isHovered ? frame.palette.textActive : frame.palette.textUpcoming;
        ctx.globalAlpha = isHovered ? 0.8 : 0.46;
        ctx.shadowBlur = 0;
        for (let w = 0; w < line.words.length; w++) {
          const word = line.words[w];
          const wx = subLineBaseX + word.x * subScale;
          const wy = screenY + word.y * subScale;
          if (wy < lyricTop || wy + subFont > lyricBottom + 2) continue;
          ctx.fillText(word.text, wx, wy);
        }
        ctx.restore();
      }
    }

    ctx.restore(); // end HUD interior clip
    ctx.restore(); // end focal translate
  }
}
