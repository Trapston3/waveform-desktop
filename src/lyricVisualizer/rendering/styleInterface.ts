// Shared visual style contract and lightweight Canvas2D drawing helpers.

import type {
  LyricLine,
  MeasuredLineLayout,
  StyleFrameContext,
  VisualStyleId,
} from '../core/models';
import type { WebGlEffectMode } from './webGlEffectLayer';

export interface ILyricVisualStyle {
  readonly id: VisualStyleId;
  readonly name: string;
  readonly webGlEffect: WebGlEffectMode;
  readonly usesShip3D?: boolean;
  render(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    width: number,
    height: number
  ): void;
  reset?(): void;
  dispose?(): void;
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
  const cx = width * 0.5;
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
