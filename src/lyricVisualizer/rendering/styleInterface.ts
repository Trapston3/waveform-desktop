// Shared visual style contract and lightweight Canvas2D drawing helpers.

import type {
  LyricLine,
  LyricsScriptMode,
  LyricTextAlign,
  LyricWord,
  MeasuredLineLayout,
  StyleFrameContext,
  VisualStyleId,
} from '../core/models';
import type { WebGlEffectMode } from './webGlEffectLayer';
import {
  hasNonLatinScript,
  mapRomanizedWords,
  transliterateToLatin,
} from '../../utils/transliterate';

export type WebGlEffectKind = WebGlEffectMode;

export interface StyleMeasurementSpec {
  readonly fontWeight?: number;
  readonly fontSizeMultiplier?: number;
  readonly fontFamilyOverride?: string;
  readonly textTransform?: 'none' | 'uppercase' | 'lowercase';
  readonly letterSpacing?: string;
  readonly maxLineWidthRatio?: number;
  readonly scriptMode?: LyricsScriptMode;
  readonly styleId?: VisualStyleId | string;
}

export interface ResolvedDisplayLine {
  readonly primaryText: string;
  readonly primaryWords: readonly LyricWord[];
  readonly secondaryText: string | null;
  readonly isRomanized: boolean;
}

export function resolveDisplayLine(
  line: LyricLine,
  scriptMode: LyricsScriptMode = 'auto',
  styleId?: VisualStyleId | string
): ResolvedDisplayLine {
  const mode: LyricsScriptMode = scriptMode ?? 'auto';
  const trimmedOrig = line.text.trim();

  let rawRom = typeof line.romanizedText === 'string' ? line.romanizedText.trim() : '';
  if (!rawRom && hasNonLatinScript(line.text)) {
    rawRom = transliterateToLatin(line.text).trim();
  }
  const hasRom = Boolean(rawRom && rawRom !== trimmedOrig);
  const romWords: readonly LyricWord[] = hasRom
    ? line.romanizedWords && line.romanizedWords.length > 0
      ? line.romanizedWords
      : mapRomanizedWords(line.words, rawRom, line.startSeconds, line.endSeconds)
    : line.words;

  const rawTrans = typeof line.translatedText === 'string' ? line.translatedText.trim() : '';
  const hasTrans = Boolean(rawTrans && rawTrans !== trimmedOrig);
  const transText = hasTrans ? rawTrans : null;

  if (mode === 'original') {
    return {
      primaryText: line.text,
      primaryWords: line.words,
      secondaryText: null,
      isRomanized: false,
    };
  }

  if (mode === 'romanized') {
    return {
      primaryText: hasRom ? rawRom : line.text,
      primaryWords: hasRom ? romWords : line.words,
      secondaryText: null,
      isRomanized: hasRom,
    };
  }

  if (mode === 'romanized_translation') {
    return {
      primaryText: hasRom ? rawRom : line.text,
      primaryWords: hasRom ? romWords : line.words,
      secondaryText: transText ?? (hasRom ? line.text : null),
      isRomanized: hasRom,
    };
  }

  if (mode === 'original_translation') {
    return {
      primaryText: line.text,
      primaryWords: line.words,
      secondaryText: transText ?? (hasRom ? rawRom : null),
      isRomanized: false,
    };
  }

  // 'auto'
  if (styleId === 'CodeEditorKinetic') {
    return {
      primaryText: hasRom ? rawRom : line.text,
      primaryWords: hasRom ? romWords : line.words,
      secondaryText: transText ?? (hasRom ? line.text : null),
      isRomanized: hasRom,
    };
  }

  return {
    primaryText: line.text,
    primaryWords: line.words,
    secondaryText: transText ?? (hasRom ? rawRom : null),
    isRomanized: false,
  };
}

export interface ILyricVisualStyle {
  readonly id: VisualStyleId;
  readonly name: string;
  readonly webGlEffect: WebGlEffectMode;
  readonly usesShip3D?: boolean;
  getVariationIndex?(variationId: string): number;
  getWebGlEffect?(frame: StyleFrameContext): WebGlEffectKind;
  getMeasurementSpec?(frame: StyleFrameContext): StyleMeasurementSpec;
  render(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    width: number,
    height: number
  ): void;
  reset?(): void;
  dispose?(): void;
}

export interface FocalRect {
  readonly left: number;
  readonly width: number;
  readonly centerX: number;
}

export function getFocalRect(frame: StyleFrameContext, width: number): FocalRect {
  const safeWidth = Math.max(1, Number.isFinite(width) ? width : 1);
  const raw =
    typeof frame.contentInsetLeft === 'number' && Number.isFinite(frame.contentInsetLeft)
      ? frame.contentInsetLeft
      : 0;
  const left = Math.max(0, Math.min(safeWidth * 0.62, raw));
  const focalWidth = Math.max(220, safeWidth - left);
  const centerX = left + focalWidth * 0.5;
  return { left, width: focalWidth, centerX };
}

export function clipToFocalStage(
  _ctx: CanvasRenderingContext2D,
  frame: StyleFrameContext,
  width: number,
  _height: number
): FocalRect {
  return getFocalRect(frame, width);
}

export function computeAlignedX(
  focalWidth: number,
  contentWidth: number,
  textAlign: LyricTextAlign | undefined = 'center',
  leftPad = 36
): number {
  if (textAlign === 'left') {
    return Math.max(16, Math.min(leftPad, focalWidth * 0.1));
  }
  return Math.max(0, (focalWidth - contentWidth) * 0.5);
}

export function drawBackdropVignette(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  strength = 0.55,
  edgeColor = '#020408'
): void {
  const s = clamp01(Number.isFinite(strength) ? strength : 0.55);
  if (s <= 0.01) return;
  ctx.save();
  const vig = ctx.createRadialGradient(
    width * 0.5,
    height * 0.48,
    Math.min(width, height) * 0.26,
    width * 0.5,
    height * 0.5,
    Math.max(width, height) * 0.78
  );
  vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vig.addColorStop(0.62, 'rgba(2, 4, 8, 0.35)');
  vig.addColorStop(1, edgeColor);
  ctx.globalAlpha = s * 0.88;
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

export function isTransparentStage(frame: StyleFrameContext): boolean {
  return Boolean(frame.isOverlayMode || frame.isEmbeddedTransparent);
}

export function setCanvasLetterSpacing(ctx: CanvasRenderingContext2D, letterSpacing: string): void {
  const target = ctx as unknown as { letterSpacing?: string };
  if ('letterSpacing' in target || typeof target === 'object') {
    target.letterSpacing = letterSpacing;
  }
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function easeOutCubic(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

export function easeOutBack(t: number): number {
  const x = clamp01(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

export function formatTimestamp(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.max(0, Math.min(r, w * 0.5, h * 0.5));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export function drawEmptyState(
  ctx: CanvasRenderingContext2D,
  frame: StyleFrameContext,
  width: number,
  height: number,
  subtitle = 'Waiting for synchronized lyrics'
): void {
  const cx = getFocalRect(frame, width).centerX;
  const cy = height * 0.5;
  const pulse = frame.reduceMotion
    ? 0.5
    : 0.5 + 0.5 * Math.sin(frame.timeSeconds * 2.2);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Three subtle pulsing audio dots
  for (let i = -1; i <= 1; i++) {
    const dotPhase = frame.reduceMotion
      ? 0.7
      : 0.45 + 0.55 * Math.sin(frame.timeSeconds * 3.0 + i * 0.9);
    const radius = (4.5 + frame.audio.bassEnergy * 4) * (0.85 + dotPhase * 0.3);
    ctx.fillStyle = i === 0 ? frame.palette.accentPrimary : frame.palette.accentSecondary;
    ctx.globalAlpha = 0.45 + dotPhase * 0.45;
    ctx.beginPath();
    ctx.arc(cx + i * 24, cy - 26, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 0.55 + pulse * 0.25;
  ctx.fillStyle = frame.palette.textUpcoming;
  const fontSize = Math.round(18 * frame.fontSizeScale);
  ctx.font = `500 ${fontSize}px ${frame.fontFamily}`;
  ctx.fillText(subtitle, cx, cy + 12);
  ctx.restore();
}

export function drawInstrumentalIndicator(
  ctx: CanvasRenderingContext2D,
  frame: StyleFrameContext,
  width: number,
  height: number,
  accentColor: string,
  label?: string
): void {
  const focal = getFocalRect(frame, width);
  const cx = focal.centerX;
  const cy = height * 0.5;
  const motion = frame.reduceMotion ? 0 : 1;
  const t = frame.timeSeconds || 0;
  const bass = frame.audio?.bassEnergy ?? 0;
  const mid = frame.audio?.midEnergy ?? 0;
  const treble = frame.audio?.trebleEnergy ?? 0;
  const rms = frame.audio?.rmsLevel ?? 0;
  const beatBoost = motion > 0 && frame.audio?.beatDetected ? 0.22 : 0;

  const pillW = Math.min(280, Math.max(176, focal.width * 0.42));
  const pillH = 74;
  const pillX = cx - pillW * 0.5;
  const pillY = cy - pillH * 0.5;

  ctx.save();
  if (!isTransparentStage(frame)) {
    drawRoundedRectPath(ctx, pillX, pillY, pillW, pillH, 18);
    ctx.fillStyle = 'rgba(15, 19, 30, 0.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Animated 7-bar audio-reactive spectrum
  const barCount = 7;
  const barW = 4;
  const barGap = 7;
  const barsTotalW = barCount * barW + (barCount - 1) * barGap;
  const barsStartX = cx - barsTotalW * 0.5;
  const barsCenterY = cy - 10;

  for (let i = 0; i < barCount; i++) {
    const band = i < 2 ? bass : i < 5 ? mid : treble;
    const wave = motion === 0 ? 0.55 : 0.32 + 0.68 * Math.abs(Math.sin(t * 5.2 + i * 0.85));
    const amp = clamp01(0.24 + wave * (0.35 + band * 0.75 + rms * 0.35 + beatBoost));
    const barH = Math.max(5, Math.round(24 * amp));
    const bx = barsStartX + i * (barW + barGap);
    const by = barsCenterY - barH * 0.5;
    ctx.fillStyle = i % 2 === 0 ? accentColor : frame.palette.accentSecondary;
    ctx.globalAlpha = 0.78 + amp * 0.22;
    drawRoundedRectPath(ctx, bx, by, barW, barH, 2);
    ctx.fill();
  }

  // Musical note + crisp label
  const resolvedLabel =
    label ??
    (frame.hasLyrics === false
      ? '♪  Instrumental'
      : typeof frame.timeUntilNextLine === 'number' &&
        Number.isFinite(frame.timeUntilNextLine) &&
        frame.timeUntilNextLine > 0 &&
        frame.timeUntilNextLine <= 3
      ? `♪  Lyrics in ${Math.ceil(frame.timeUntilNextLine)}s`
      : '♪  ♫  ♪');
  const pulse = motion === 0 ? 0.8 : 0.65 + 0.35 * Math.sin(t * 2.8);
  ctx.globalAlpha = pulse;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.round(13 * (frame.fontSizeScale || 1))}px ${frame.fontFamily}`;
  ctx.fillStyle = frame.palette.textUpcoming;
  ctx.fillText(resolvedLabel, cx, cy + 16);

  // Gap progress hairline if finite gap progress is available
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
    const trackW = pillW - 36;
    const trackX = cx - trackW * 0.5;
    const trackY = pillY + pillH - 9;
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#ffffff';
    drawRoundedRectPath(ctx, trackX, trackY, trackW, 2.5, 1.25);
    ctx.fill();

    ctx.globalAlpha = 0.9;
    ctx.fillStyle = accentColor;
    drawRoundedRectPath(ctx, trackX, trackY, Math.max(4, trackW * progress), 2.5, 1.25);
    ctx.fill();
  }

  ctx.restore();
}

export function getActiveLine(frame: StyleFrameContext): {
  line: LyricLine | null;
  measured: MeasuredLineLayout | null;
  index: number;
} {
  const lines = frame.lyrics?.lines;
  const layoutLines = frame.layout?.lines;
  if (!lines || lines.length === 0) {
    return { line: null, measured: null, index: -1 };
  }
  const idx =
    frame.activeLineIndex >= 0 && frame.activeLineIndex < lines.length
      ? frame.activeLineIndex
      : 0;
  return {
    line: lines[idx] ?? null,
    measured: layoutLines && layoutLines[idx] ? layoutLines[idx] : null,
    index: idx,
  };
}

export function isUnsyncedLyrics(frame: StyleFrameContext): boolean {
  return frame.lyrics?.sourceKind === 'Unsynced';
}
