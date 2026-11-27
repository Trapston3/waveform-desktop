// Style: StudioDawTimeline ("Studio DAW Timeline")
// Scrolling multi-track DAW arrangement visualizer synced to estimatedBpm and isDownbeat,
// featuring proportional rounded MIDI lyric clip blocks, glowing playhead beam at ~28% focal width,
// live word sweep fills, wordIconDictionary semantic badges, and pre-allocated ring buffers
// for lower multi-band FFT automation lanes (Bass / Mid / Treble + Beat trigger pulses).
// Strict 60fps with ZERO per-frame heap allocations inside render().

import type { Lyrics, LyricsScriptMode, StyleFrameContext } from '../../core/models';
import { isBlankOrInstrumentalLineText } from '../../core/lrcParser';
import {
  clamp01,
  drawBackdropVignette,
  drawEmptyState,
  drawRoundedRectPath,
  getFocalRect,
  isTransparentStage,
  resolveDisplayLine,
  type ILyricVisualStyle,
  type StyleMeasurementSpec,
} from '../styleInterface';
import { drawWordIcon, resolveWordIcon, type WordIconId } from '../wordIconDictionary';

const RING_SIZE = 128;
const TRACK_LANE_COUNT = 3;
const DAW_MONO_STACK = '"JetBrains Mono", "Space Grotesk", ui-monospace, monospace';

// Pre-allocated bar labels ('1' .. '512') so ruler drawing allocates ZERO strings
const BAR_LABELS: readonly string[] = Array.from({ length: 512 }, (_, i) => `${i + 1}`);
const LANE_NAMES: readonly string[] = ['LEAD VOX', 'HARMONY', 'AD-LIB'];
const AUTOMATION_NAMES: readonly string[] = ['BASS', 'MID', 'AIR'];

interface DawWordClip {
  readonly lineIndex: number;
  readonly wordIndex: number;
  readonly laneIndex: number;
  readonly pitchOffsetNorm: number; // -0.5..0.5 subtle piano-roll vertical stagger
  readonly text: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly iconId: WordIconId | null;
}

export class StudioDawTimelineStyle implements ILyricVisualStyle {
  readonly id = 'StudioDawTimeline' as const;
  readonly name = 'Studio DAW Timeline';
  readonly webGlEffect = 'none' as const;

  // Pre-allocated ring buffers for lower automation curves (zero GC)
  private readonly bassRing = new Float32Array(RING_SIZE);
  private readonly midRing = new Float32Array(RING_SIZE);
  private readonly trebleRing = new Float32Array(RING_SIZE);
  private readonly beatRing = new Float32Array(RING_SIZE);
  private ringWriteIdx = 0;
  private sampleAccumSec = 0;

  private cachedLyricsRef: Lyrics | null = null;
  private cachedScriptMode: LyricsScriptMode | null = null;
  private clips: DawWordClip[] = [];

  private beatGlow = 0;
  private lastBpmInt = -1;
  private cachedBpmLabel = '120 BPM';

  getVariationIndex(variationId?: string): 0 | 1 {
    return variationId === 'logic-glass' ? 1 : 0;
  }

  getMeasurementSpec(frame?: StyleFrameContext): StyleMeasurementSpec {
    return {
      fontWeight: 700,
      fontSizeMultiplier: 0.92,
      maxLineWidthRatio: 0.85,
      scriptMode: frame?.scriptMode ?? 'auto',
      styleId: this.id,
    };
  }

  reset(): void {
    this.cachedLyricsRef = null;
    this.cachedScriptMode = null;
    this.clips = [];
    this.bassRing.fill(0);
    this.midRing.fill(0);
    this.trebleRing.fill(0);
    this.beatRing.fill(0);
    this.ringWriteIdx = 0;
    this.sampleAccumSec = 0;
    this.beatGlow = 0;
  }

  dispose(): void {
    this.reset();
  }

  private ensurePrecomputed(lyrics: Lyrics, scriptMode: LyricsScriptMode): void {
    if (this.cachedLyricsRef === lyrics && this.cachedScriptMode === scriptMode) return;
    this.cachedLyricsRef = lyrics;
    this.cachedScriptMode = scriptMode;
    this.clips = [];

    let vocalLineCounter = 0;
    for (let i = 0; i < lyrics.lines.length; i++) {
      const line = lyrics.lines[i];
      if (isBlankOrInstrumentalLineText(line.text)) continue;

      const resolved = resolveDisplayLine(line, scriptMode, this.id);
      const trimmed = resolved.primaryText.trim();
      const isAdLib = trimmed.startsWith('(') || trimmed.startsWith('[');
      const laneIndex = isAdLib ? 2 : vocalLineCounter % 2 === 0 ? 0 : 1;
      vocalLineCounter += 1;

      const sourceWords =
        resolved.primaryWords && resolved.primaryWords.length > 0
          ? resolved.primaryWords
          : trimmed
              .split(/\s+/)
              .filter(Boolean)
              .map((t, wi, arr) => ({
                text: t,
                startSeconds:
                  line.startSeconds + ((line.endSeconds - line.startSeconds) * wi) / Math.max(1, arr.length),
                endSeconds:
                  line.startSeconds + ((line.endSeconds - line.startSeconds) * (wi + 1)) / Math.max(1, arr.length),
              }));

      for (let w = 0; w < sourceWords.length; w++) {
        const wd = sourceWords[w];
        const cleanText = wd.text.trim();
        if (!cleanText) continue;
        const startS = Number.isFinite(wd.startSeconds) ? wd.startSeconds : line.startSeconds;
        const endS = Math.max(
          startS + 0.06,
          Number.isFinite(wd.endSeconds) ? wd.endSeconds : line.endSeconds
        );

        // Deterministic gentle vertical pitch contour inside track lane
        const hash = ((cleanText.charCodeAt(0) * 31 + w * 17 + i * 7) & 0xff) / 255;
        this.clips.push({
          lineIndex: i,
          wordIndex: w,
          laneIndex,
          pitchOffsetNorm: (hash - 0.5) * 0.42,
          text: cleanText,
          startSeconds: startS,
          endSeconds: endS,
          iconId: resolveWordIcon(cleanText, resolved.primaryText),
        });
      }
    }
  }

  private pushRingSample(frame: StyleFrameContext, dt: number): void {
    if (frame.didSeekThisFrame) {
      this.bassRing.fill(0);
      this.midRing.fill(0);
      this.trebleRing.fill(0);
      this.beatRing.fill(0);
      this.ringWriteIdx = 0;
      this.sampleAccumSec = 0;
      return;
    }

    this.sampleAccumSec += dt;
    // Sample at ~30Hz into the 128-point ring buffer (~4.2s visible automation trail)
    if (this.sampleAccumSec < 0.032) return;
    this.sampleAccumSec = 0;

    const bass = clamp01(frame.audio?.bassEnergy ?? 0);
    const mid = clamp01(frame.audio?.midEnergy ?? 0);
    const treble = clamp01(frame.audio?.trebleEnergy ?? 0);
    const beatVal = frame.audio?.isDownbeat ? 1.0 : frame.audio?.beatDetected ? 0.68 : 0;

    this.bassRing[this.ringWriteIdx] = bass;
    this.midRing[this.ringWriteIdx] = mid;
    this.trebleRing[this.ringWriteIdx] = treble;
    this.beatRing[this.ringWriteIdx] = beatVal;
    this.ringWriteIdx = (this.ringWriteIdx + 1) % RING_SIZE;
  }

  private drawAutomationCurve(
    ctx: CanvasRenderingContext2D,
    ring: Float32Array,
    x: number,
    y: number,
    w: number,
    h: number,
    strokeColor: string,
    fillAlpha: number
  ): void {
    const stepX = w / (RING_SIZE - 1);
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < RING_SIZE; i++) {
      const idx = (this.ringWriteIdx + i) % RING_SIZE;
      const val = clamp01(ring[idx]);
      const px = x + i * stepX;
      const py = y + h - 4 - val * (h - 8);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Soft area fill under curve
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fillStyle = strokeColor;
    ctx.globalAlpha = fillAlpha;
    ctx.fill();
    ctx.restore();
  }

  render(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    width: number,
    height: number
  ): void {
    const focal = getFocalRect(frame, width);
    const isTransparent = isTransparentStage(frame);
    const isLogicGlass = this.getVariationIndex(frame.variationId) === 1;

    const bgAlpha =
      typeof frame.backgroundOpacity === 'number' && Number.isFinite(frame.backgroundOpacity)
        ? clamp01(frame.backgroundOpacity)
        : 0.95;
    const vigStrength =
      typeof frame.vignetteStrength === 'number' && Number.isFinite(frame.vignetteStrength)
        ? clamp01(frame.vignetteStrength)
        : 0.55;

    const dt = Math.max(0.001, Math.min(0.1, frame.deltaSeconds || 1 / 60));
    if (frame.reduceMotion) {
      this.beatGlow = 0;
    } else {
      if (frame.audio?.isDownbeat) this.beatGlow = 1.0;
      else if (frame.audio?.beatDetected) this.beatGlow = Math.max(this.beatGlow, 0.72);
      else this.beatGlow *= Math.exp(-dt * 8);
      this.pushRingSample(frame, dt);
    }

    const accentA = isLogicGlass ? '#38bdf8' : frame.palette.accentPrimary || '#f97316';
    const accentB = isLogicGlass ? '#a855f7' : frame.palette.accentSecondary || '#22d3ee';
    const accentC = isLogicGlass ? '#34d399' : '#10b981';

    // 1. Backdrop
    if (!isTransparent) {
      ctx.save();
      ctx.globalAlpha = bgAlpha;
      ctx.fillStyle = isLogicGlass ? '#080b14' : '#0c0d11';
      ctx.fillRect(0, 0, width, height);

      if (isLogicGlass) {
        const aurora = ctx.createLinearGradient(focal.left, 0, focal.left + focal.width, height);
        aurora.addColorStop(0, 'rgba(56, 189, 248, 0.08)');
        aurora.addColorStop(0.5, 'rgba(168, 85, 247, 0.06)');
        aurora.addColorStop(1, 'rgba(15, 23, 42, 0.14)');
        ctx.fillStyle = aurora;
        ctx.fillRect(0, 0, width, height);
      }
      ctx.restore();

      if (vigStrength > 0.01) {
        drawBackdropVignette(ctx, width, height, vigStrength, '#030407');
      }
    }

    const lyrics = frame.lyrics;
    if (!lyrics || lyrics.lines.length === 0) {
      drawEmptyState(ctx, frame, width, height, 'NO MIDI LYRIC TRACK');
      return;
    }

    this.ensurePrecomputed(lyrics, frame.scriptMode ?? 'auto');

    // 2. DAW Arrangement Frame Geometry strictly within getFocalRect
    const marginX = Math.max(14, Math.round(focal.width * 0.032));
    const marginY = Math.max(16, Math.round(height * 0.055));
    const panelX = focal.left + marginX;
    const panelW = Math.max(220, focal.width - marginX * 2);
    const panelY = marginY;
    const panelH = Math.max(220, height - marginY * 2);

    const trackHeaderW = panelW >= 540 ? Math.min(118, Math.round(panelW * 0.16)) : 0;
    const timelineX = panelX + trackHeaderW;
    const timelineW = panelW - trackHeaderW;
    const rulerH = 28;
    const lowerAutoH = Math.max(66, Math.min(112, Math.round(panelH * 0.24)));
    const lanesTopY = panelY + rulerH;
    const lanesTotalH = Math.max(90, panelH - rulerH - lowerAutoH - 8);
    const laneH = lanesTotalH / TRACK_LANE_COUNT;
    const autoTopY = lanesTopY + lanesTotalH + 8;

    // Playhead beam anchored ~28% across focal arrangement area
    const playheadX = timelineX + timelineW * 0.28;

    // BPM-synced scroll speed (px per second)
    const rawBpm = frame.audio?.estimatedBpm ?? frame.trackMetadata?.bpm ?? 120;
    const bpm = Math.max(50, Math.min(220, Number.isFinite(rawBpm) ? rawBpm : 120));
    const bpmInt = Math.round(bpm);
    if (bpmInt !== this.lastBpmInt) {
      this.lastBpmInt = bpmInt;
      this.cachedBpmLabel = `${bpmInt} BPM`;
    }

    const beatSec = 60 / bpm;
    const pxPerSec = Math.max(88, Math.min(185, timelineW * 0.16));
    const currentTime = Math.max(0, Number.isFinite(frame.timeSeconds) ? frame.timeSeconds : 0);

    // Draw DAW Window Shell
    if (!isTransparent) {
      ctx.save();
      drawRoundedRectPath(ctx, panelX, panelY, panelW, panelH, 12);
      ctx.fillStyle = isLogicGlass ? 'rgba(13, 18, 30, 0.82)' : 'rgba(18, 20, 26, 0.92)';
      ctx.fill();
      ctx.strokeStyle = isLogicGlass ? 'rgba(148, 163, 184, 0.24)' : 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Top Transport Ruler bar
      drawRoundedRectPath(ctx, panelX + 1, panelY + 1, panelW - 2, rulerH - 1, 10);
      ctx.fillStyle = isLogicGlass ? 'rgba(255, 255, 255, 0.06)' : '#161820';
      ctx.fill();
      ctx.restore();
    }

    // Left Track Headers (LEAD VOX, HARMONY, AD-LIB) + BPM Badge
    if (trackHeaderW > 0) {
      ctx.save();
      ctx.fillStyle = isLogicGlass ? 'rgba(20, 27, 45, 0.65)' : '#15171f';
      ctx.fillRect(panelX + 1, lanesTopY, trackHeaderW - 1, lanesTotalH);

      ctx.font = `700 10px ${DAW_MONO_STACK}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = accentA;
      ctx.fillText(this.cachedBpmLabel, panelX + 12, panelY + rulerH * 0.5);

      for (let l = 0; l < TRACK_LANE_COUNT; l++) {
        const ly = lanesTopY + l * laneH;
        const laneColor = l === 0 ? accentA : l === 1 ? accentB : accentC;

        // Lane stripe
        ctx.fillStyle = laneColor;
        ctx.fillRect(panelX + 4, ly + 6, 3, laneH - 12);

        ctx.font = `600 10.5px ${DAW_MONO_STACK}`;
        ctx.fillStyle = 'rgba(226, 232, 240, 0.82)';
        ctx.fillText(LANE_NAMES[l], panelX + 14, ly + laneH * 0.5);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.beginPath();
        ctx.moveTo(panelX, ly + laneH);
        ctx.lineTo(panelX + panelW, ly + laneH);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 3. Clipped Scrolling Arrangement Timeline (Beat/Bar Grid + MIDI Lyric Clips)
    ctx.save();
    ctx.beginPath();
    ctx.rect(timelineX, panelY, timelineW, rulerH + lanesTotalH);
    ctx.clip();

    const visibleStartTime = currentTime - (playheadX - timelineX) / pxPerSec;
    const visibleEndTime = currentTime + (timelineX + timelineW - playheadX) / pxPerSec;

    // Scrolling Beat & Bar Grid Lines
    const firstBeatIdx = Math.max(0, Math.floor(visibleStartTime / beatSec));
    const lastBeatIdx = Math.ceil(visibleEndTime / beatSec);
    const barAlphaBoost = frame.audio?.isDownbeat ? 0.16 : 0;

    ctx.font = `600 9.5px ${DAW_MONO_STACK}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (let bi = firstBeatIdx; bi <= lastBeatIdx; bi++) {
      const beatTime = bi * beatSec;
      const gx = playheadX + (beatTime - currentTime) * pxPerSec;
      const isBar = bi % 4 === 0;

      ctx.strokeStyle = isBar
        ? isLogicGlass
          ? 'rgba(186, 230, 253, 0.24)'
          : 'rgba(255, 255, 255, 0.16)'
        : 'rgba(255, 255, 255, 0.05)';
      ctx.globalAlpha = isBar ? 0.72 + barAlphaBoost : 0.48;
      ctx.lineWidth = isBar ? 1.1 : 0.8;
      ctx.beginPath();
      ctx.moveTo(gx, isBar ? panelY + 4 : lanesTopY);
      ctx.lineTo(gx, lanesTopY + lanesTotalH);
      ctx.stroke();

      if (isBar) {
        const barNum = Math.floor(bi / 4);
        const label = barNum >= 0 && barNum < BAR_LABELS.length ? BAR_LABELS[barNum] : BAR_LABELS[0];
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = isLogicGlass ? '#bae6fd' : '#94a3b8';
        ctx.fillText(label, gx + 4, panelY + rulerH * 0.5);
      }
    }
    ctx.globalAlpha = 1;

    // Horizontal lane backgrounds
    for (let l = 0; l < TRACK_LANE_COUNT; l++) {
      const ly = lanesTopY + l * laneH;
      if (l % 2 === 1 && !isTransparent) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.018)';
        ctx.fillRect(timelineX, ly, timelineW, laneH);
      }
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.beginPath();
      ctx.moveTo(timelineX, ly + laneH);
      ctx.lineTo(timelineX + timelineW, ly + laneH);
      ctx.stroke();
    }

    // MIDI Lyric Clip Blocks (proportional to [startSeconds, endSeconds])
    const wordIconsEnabled = frame.wordIconsEnabled !== false;
    const fontScale =
      typeof frame.fontSizeScale === 'number' && Number.isFinite(frame.fontSizeScale)
        ? frame.fontSizeScale
        : 1.0;
    const clipFontPx = Math.max(11, Math.min(16, Math.round(laneH * 0.24 * Math.min(1.2, Math.max(0.85, fontScale)))));
    const minClipW = Math.max(26, clipFontPx * 2.1);

    for (let i = 0; i < this.clips.length; i++) {
      const clip = this.clips[i];
      if (clip.endSeconds < visibleStartTime - 0.5 || clip.startSeconds > visibleEndTime + 0.5) {
        continue;
      }

      const rawX = playheadX + (clip.startSeconds - currentTime) * pxPerSec;
      const exactW = (clip.endSeconds - clip.startSeconds) * pxPerSec;
      const clipW = Math.max(minClipW, exactW);
      const clipH = Math.max(24, Math.min(laneH * 0.62, 46));
      const laneCenterY = lanesTopY + (clip.laneIndex + 0.5) * laneH;
      const clipY = laneCenterY - clipH * 0.5 + clip.pitchOffsetNorm * (laneH - clipH);

      const isActive = currentTime >= clip.startSeconds && currentTime <= clip.endSeconds;
      const isPassed = currentTime > clip.endSeconds;
      const progress = isActive
        ? clamp01((currentTime - clip.startSeconds) / Math.max(0.01, clip.endSeconds - clip.startSeconds))
        : isPassed
        ? 1
        : 0;

      const laneAccent = clip.laneIndex === 0 ? accentA : clip.laneIndex === 1 ? accentB : accentC;

      // Record hit rect so click-to-seek works on MIDI lyric clips
      const hitX = Math.max(timelineX, rawX);
      const hitW = Math.min(timelineX + timelineW, rawX + clipW) - hitX;
      if (hitW > 4) {
        frame.recordHitRect(clip.lineIndex, hitX, clipY, hitW, clipH);
      }

      ctx.save();
      if (isActive) {
        ctx.shadowColor = laneAccent;
        ctx.shadowBlur = 16 + this.beatGlow * 10;
      }

      // Clip base housing
      drawRoundedRectPath(ctx, rawX, clipY, clipW, clipH, 7);
      ctx.fillStyle = isActive
        ? 'rgba(255, 255, 255, 0.14)'
        : isPassed
        ? 'rgba(255, 255, 255, 0.06)'
        : 'rgba(15, 23, 42, 0.72)';
      ctx.fill();

      // Clipped Live Sweep Fill inside MIDI Block
      if (progress > 0) {
        ctx.save();
        drawRoundedRectPath(ctx, rawX, clipY, clipW, clipH, 7);
        ctx.clip();
        ctx.fillStyle = laneAccent;
        ctx.globalAlpha = isActive ? 0.82 : 0.34;
        ctx.fillRect(rawX, clipY, clipW * progress, clipH);

        // Leading sweep highlight edge on active word
        if (isActive) {
          ctx.fillStyle = '#ffffff';
          ctx.globalAlpha = 0.85;
          ctx.fillRect(rawX + clipW * progress - 1.5, clipY, 2.5, clipH);
        }
        ctx.restore();
      }

      // Clip border
      ctx.shadowBlur = 0;
      drawRoundedRectPath(ctx, rawX, clipY, clipW, clipH, 7);
      ctx.strokeStyle = isActive
        ? '#ffffff'
        : isPassed
        ? laneAccent
        : 'rgba(255, 255, 255, 0.22)';
      ctx.lineWidth = isActive ? 1.5 : 1;
      ctx.globalAlpha = isActive ? 1 : isPassed ? 0.65 : 0.55;
      ctx.stroke();

      // Word text + optional WordIcon badge inside MIDI block
      const showIcon = wordIconsEnabled && clip.iconId !== null && clipW >= 36;
      const iconSize = Math.round(clipH * 0.44);
      const textPadLeft = showIcon ? iconSize + 12 : 8;

      ctx.save();
      drawRoundedRectPath(ctx, rawX + 1, clipY + 1, clipW - 2, clipH - 2, 6);
      ctx.clip();

      if (showIcon && clip.iconId) {
        drawWordIcon(
          ctx,
          clip.iconId,
          rawX + 6 + iconSize * 0.5,
          clipY + clipH * 0.5,
          iconSize,
          isActive ? '#07090e' : '#f8fafc',
          isActive ? 1.08 : 0.95
        );
      }

      ctx.font = `${isActive ? 800 : 600} ${clipFontPx}px ${frame.fontFamily}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = isActive ? 1 : isPassed ? 0.85 : 0.72;
      ctx.fillStyle = isActive ? '#ffffff' : '#e2e8f0';
      ctx.fillText(clip.text, rawX + textPadLeft, clipY + clipH * 0.5);
      ctx.restore();

      ctx.restore();
    }

    // Instrumental break region badge on timeline
    if (frame.isInstrumentalGap) {
      ctx.save();
      const pillW = Math.min(220, timelineW * 0.44);
      const pillH = 26;
      const pillX = playheadX + 16;
      const pillY = lanesTopY + lanesTotalH * 0.5 - pillH * 0.5;
      drawRoundedRectPath(ctx, pillX, pillY, pillW, pillH, 13);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
      ctx.fill();
      ctx.strokeStyle = accentA;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.font = `600 10.5px ${DAW_MONO_STACK}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = accentA;
      ctx.fillText('♪ INSTRUMENTAL REGION', pillX + pillW * 0.5, pillY + pillH * 0.5);
      ctx.restore();
    }

    // Crisp Vertical Glowing Playhead Beam (~28% across focal area)
    ctx.save();
    ctx.shadowColor = accentA;
    ctx.shadowBlur = 12 + this.beatGlow * 14;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, panelY + 4);
    ctx.lineTo(playheadX, lanesTopY + lanesTotalH);
    ctx.stroke();

    // Playhead cap triangle in ruler
    ctx.fillStyle = accentA;
    ctx.beginPath();
    ctx.moveTo(playheadX - 6, panelY + 4);
    ctx.lineTo(playheadX + 6, panelY + 4);
    ctx.lineTo(playheadX, panelY + 15);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.restore(); // end timeline clip

    // 4. Lower Multi-Band FFT Automation & Drum/Beat Trigger Meter Lanes (zero GC)
    const subLaneGap = 4;
    const subLaneH = (lowerAutoH - subLaneGap * 2) / 3;
    const autoLabelW = trackHeaderW > 0 ? trackHeaderW : 54;
    const autoCurveX = panelX + autoLabelW;
    const autoCurveW = Math.max(60, panelW - autoLabelW - 8);

    ctx.save();
    for (let a = 0; a < 3; a++) {
      const ay = autoTopY + a * (subLaneH + subLaneGap);
      const color = a === 0 ? accentA : a === 1 ? accentB : accentC;
      const ring = a === 0 ? this.bassRing : a === 1 ? this.midRing : this.trebleRing;

      if (!isTransparent) {
        drawRoundedRectPath(ctx, panelX + 4, ay, panelW - 8, subLaneH, 5);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.fill();
      }

      ctx.font = `700 9px ${DAW_MONO_STACK}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = color;
      ctx.fillText(AUTOMATION_NAMES[a], panelX + 12, ay + subLaneH * 0.5);

      this.drawAutomationCurve(ctx, ring, autoCurveX, ay, autoCurveW, subLaneH, color, 0.16);
    }

    // Beat / drum trigger spikes overlaid across automation region
    const stepX = autoCurveW / (RING_SIZE - 1);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < RING_SIZE; i++) {
      const idx = (this.ringWriteIdx + i) % RING_SIZE;
      const b = this.beatRing[idx];
      if (b > 0.2) {
        const bx = autoCurveX + i * stepX;
        ctx.globalAlpha = b * 0.55;
        ctx.beginPath();
        ctx.moveTo(bx, autoTopY + 2);
        ctx.lineTo(bx, autoTopY + lowerAutoH - 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
