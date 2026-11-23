// Apple glossy emoji renderer:
// 1. Bundled 64px Apple PNGs loaded statically via Vite import.meta.glob
// 2. Cached CDN PNG fallback (emoji-datasource-apple@15.1.2)
// 3. Multi-stop 3D glossy Canvas2D vector fallback (OffscreenCanvas-cached in browser, direct draw in mocks)
// Never falls back to flat system Segoe UI fillText for emojis.

import { drawRoundedRectPath } from './styleInterface';

const APPLE_CDN_BASE = 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64';

const BUNDLED_EMOJI_URLS: Readonly<Record<string, string>> = (() => {
  const map: Record<string, string> = {};
  try {
    const rawGlob = import.meta.glob('../../assets/emojis/*.png', {
      eager: true,
      import: 'default',
    }) as Record<string, string>;
    for (const [filePath, url] of Object.entries(rawGlob)) {
      if (typeof url !== 'string' || !url) continue;
      const slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
      const base = (slash >= 0 ? filePath.slice(slash + 1) : filePath).replace(/\.png$/i, '').toLowerCase();
      map[base] = url;
      const stripped = base.replace(/-fe0f/g, '');
      if (!map[stripped]) {
        map[stripped] = url;
      }
    }
  } catch {
    // Non-Vite Node test runtime: falls back gracefully to vector renderer
  }
  return map;
})();

const imageCache = new Map<string, HTMLImageElement>();
const loadingImages = new Set<string>();
const failedImages = new Set<string>();
const offscreenVectorCache = new Map<string, OffscreenCanvas>();
const MAX_OFFSCREEN_CACHE = 96;

export function emojiToUnified(emoji: string): string {
  if (!emoji) return '';
  const parts: string[] = [];
  for (const ch of emoji) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined) {
      parts.push(cp.toString(16).toLowerCase());
    }
  }
  return parts.join('-');
}

function resolveBundledUrl(emoji: string): string | null {
  const unified = emojiToUnified(emoji);
  if (!unified) return null;
  if (BUNDLED_EMOJI_URLS[unified]) return BUNDLED_EMOJI_URLS[unified];
  const stripped = unified.replace(/-fe0f/g, '');
  return BUNDLED_EMOJI_URLS[stripped] ?? null;
}

export function hasBundledAppleEmoji(emoji: string): boolean {
  return resolveBundledUrl(emoji) !== null;
}

function requestEmojiImage(emoji: string): HTMLImageElement | null {
  const unified = emojiToUnified(emoji);
  if (!unified) return null;

  const existing = imageCache.get(unified);
  if (existing) {
    return existing.complete && existing.naturalWidth > 0 ? existing : null;
  }
  if (failedImages.has(unified) || loadingImages.has(unified)) {
    return null;
  }
  if (typeof Image === 'undefined') {
    return null;
  }

  const bundledUrl = resolveBundledUrl(emoji);
  const stripped = unified.replace(/-fe0f/g, '');
  const cdnUrl = `${APPLE_CDN_BASE}/${stripped}.png`;

  loadingImages.add(unified);
  const img = new Image();
  if (!bundledUrl) {
    img.crossOrigin = 'anonymous';
  }

  let triedCdn = !bundledUrl;
  img.onload = () => {
    loadingImages.delete(unified);
    imageCache.set(unified, img);
  };
  img.onerror = () => {
    if (!triedCdn) {
      triedCdn = true;
      img.crossOrigin = 'anonymous';
      img.src = cdnUrl;
      return;
    }
    loadingImages.delete(unified);
    failedImages.add(unified);
  };
  img.src = bundledUrl ?? cdnUrl;
  return null;
}

export function preloadAppleEmojis(emojis: readonly string[]): void {
  for (let i = 0; i < emojis.length; i++) {
    requestEmojiImage(emojis[i]);
  }
}

// ---------------------------------------------------------------------------
// Glossy Apple-Styled Multi-Stop 3D Canvas2D Vector Fallback (zero flat fillText)
// Uses only Canvas2D primitives safe across browser and unit test mock contexts
// ---------------------------------------------------------------------------

function drawHeartShape(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.72);
  ctx.quadraticCurveTo(cx - s * 1.05, cy + s * 0.1, cx - s * 0.85, cy - s * 0.42);
  ctx.quadraticCurveTo(cx - s * 0.65, cy - s * 0.88, cx - s * 0.22, cy - s * 0.68);
  ctx.quadraticCurveTo(cx, cy - s * 0.52, cx, cy - s * 0.34);
  ctx.quadraticCurveTo(cx, cy - s * 0.52, cx + s * 0.22, cy - s * 0.68);
  ctx.quadraticCurveTo(cx + s * 0.65, cy - s * 0.88, cx + s * 0.85, cy - s * 0.42);
  ctx.quadraticCurveTo(cx + s * 1.05, cy + s * 0.1, cx, cy + s * 0.72);
  ctx.closePath();
}

function drawFourPointSparkle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outerR: number,
  innerR: number
): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - outerR);
  ctx.quadraticCurveTo(cx + innerR, cy - innerR, cx + outerR, cy);
  ctx.quadraticCurveTo(cx + innerR, cy + innerR, cx, cy + outerR);
  ctx.quadraticCurveTo(cx - innerR, cy + innerR, cx - outerR, cy);
  ctx.quadraticCurveTo(cx - innerR, cy - innerR, cx, cy - outerR);
  ctx.closePath();
}

function drawGlossyOrbBase(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  topColor: string,
  midColor: string,
  bottomColor: string
): void {
  const grad = ctx.createRadialGradient(cx - r * 0.28, cy - r * 0.32, r * 0.08, cx, cy, r);
  grad.addColorStop(0, topColor);
  grad.addColorStop(0.55, midColor);
  grad.addColorStop(1, bottomColor);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Top-left 3D specular highlight crescent
  ctx.fillStyle = 'rgba(255, 255, 255, 0.32)';
  ctx.beginPath();
  ctx.arc(cx - r * 0.24, cy - r * 0.34, r * 0.28, 0, Math.PI * 2);
  ctx.fill();
}

function drawVectorAppleEmoji(
  ctx: CanvasRenderingContext2D,
  emoji: string,
  cx: number,
  cy: number,
  sizePx: number
): void {
  const s = Math.max(4, sizePx * 0.45);
  const key = emoji.replace(/\ufe0f/g, '');
  ctx.save();

  if (key === '❤' || key === '♥' || key === '🩷') {
    drawHeartShape(ctx, cx, cy, s * 0.92);
    const g = ctx.createLinearGradient(cx, cy - s, cx, cy + s);
    g.addColorStop(0, '#ff85a1');
    g.addColorStop(0.45, '#ff2d55');
    g.addColorStop(1, '#b91c1c');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.52)';
    ctx.beginPath();
    ctx.arc(cx - s * 0.34, cy - s * 0.36, s * 0.16, 0, Math.PI * 2);
    ctx.fill();
  } else if (key === '💔') {
    drawHeartShape(ctx, cx, cy, s * 0.92);
    const g = ctx.createLinearGradient(cx, cy - s, cx, cy + s);
    g.addColorStop(0, '#fb7185');
    g.addColorStop(0.5, '#e11d48');
    g.addColorStop(1, '#881337');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = '#18181b';
    ctx.lineWidth = Math.max(1.2, s * 0.14);
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.04, cy - s * 0.38);
    ctx.lineTo(cx - s * 0.14, cy - s * 0.05);
    ctx.lineTo(cx + s * 0.14, cy + s * 0.12);
    ctx.lineTo(cx - s * 0.06, cy + s * 0.56);
    ctx.stroke();
  } else if (key === '👍' || key === '👎') {
    const flipY = key === '👎' ? -1 : 1;
    ctx.translate(cx, cy);
    ctx.scale(1, flipY);
    drawRoundedRectPath(ctx, -s * 0.72, -s * 0.18, s * 0.36, s * 0.76, s * 0.12);
    ctx.fillStyle = '#0A84FF';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-s * 0.3, -s * 0.12);
    ctx.quadraticCurveTo(-s * 0.1, -s * 0.82, s * 0.14, -s * 0.76);
    ctx.quadraticCurveTo(s * 0.32, -s * 0.68, s * 0.22, -s * 0.16);
    ctx.lineTo(s * 0.68, -s * 0.16);
    ctx.quadraticCurveTo(s * 0.82, s * 0.2, s * 0.56, s * 0.58);
    ctx.lineTo(-s * 0.3, s * 0.58);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -s * 0.8, 0, s * 0.6);
    g.addColorStop(0, '#fef08a');
    g.addColorStop(0.5, '#facc15');
    g.addColorStop(1, '#d97706');
    ctx.fillStyle = g;
    ctx.fill();
  } else if (key === '😂' || key === '😭' || key === '🥹' || key === '🤯') {
    drawGlossyOrbBase(ctx, cx, cy, s * 0.86, '#fef08a', '#facc15', '#d97706');
    ctx.strokeStyle = '#451a03';
    ctx.fillStyle = '#451a03';
    ctx.lineWidth = Math.max(1.2, s * 0.12);
    if (key === '😂') {
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.45, cy - s * 0.12);
      ctx.quadraticCurveTo(cx - s * 0.28, cy - s * 0.34, cx - s * 0.12, cy - s * 0.12);
      ctx.moveTo(cx + s * 0.12, cy - s * 0.12);
      ctx.quadraticCurveTo(cx + s * 0.28, cy - s * 0.34, cx + s * 0.45, cy - s * 0.12);
      ctx.stroke();
      ctx.fillStyle = '#78350f';
      ctx.beginPath();
      ctx.arc(cx, cy + s * 0.08, s * 0.42, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(cx - s * 0.62, cy + s * 0.06, s * 0.16, 0, Math.PI * 2);
      ctx.arc(cx + s * 0.62, cy + s * 0.06, s * 0.16, 0, Math.PI * 2);
      ctx.fill();
    } else if (key === '😭') {
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(cx - s * 0.42, cy - s * 0.06, s * 0.18, s * 0.62);
      ctx.fillRect(cx + s * 0.24, cy - s * 0.06, s * 0.18, s * 0.62);
      ctx.fillStyle = '#78350f';
      ctx.beginPath();
      ctx.arc(cx, cy + s * 0.35, s * 0.24, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
    } else if (key === '🥹') {
      ctx.fillStyle = '#292524';
      ctx.beginPath();
      ctx.arc(cx - s * 0.28, cy - s * 0.12, s * 0.14, 0, Math.PI * 2);
      ctx.arc(cx + s * 0.28, cy - s * 0.12, s * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx - s * 0.32, cy - s * 0.16, s * 0.05, 0, Math.PI * 2);
      ctx.arc(cx + s * 0.24, cy - s * 0.16, s * 0.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(cx - s * 0.3, cy + s * 0.08, s * 0.1, 0, Math.PI * 2);
      ctx.arc(cx + s * 0.3, cy + s * 0.08, s * 0.1, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // 🤯 mind blown cap
      ctx.fillStyle = '#fb923c';
      ctx.beginPath();
      ctx.arc(cx, cy - s * 0.56, s * 0.46, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#451a03';
      ctx.beginPath();
      ctx.arc(cx, cy + s * 0.3, s * 0.18, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (key === '🔥') {
    const outer = ctx.createLinearGradient(cx, cy - s, cx, cy + s);
    outer.addColorStop(0, '#ef4444');
    outer.addColorStop(0.55, '#f97316');
    outer.addColorStop(1, '#dc2626');
    ctx.fillStyle = outer;
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 0.92);
    ctx.quadraticCurveTo(cx + s * 0.85, cy - s * 0.15, cx + s * 0.65, cy + s * 0.52);
    ctx.quadraticCurveTo(cx, cy + s * 0.96, cx - s * 0.65, cy + s * 0.52);
    ctx.quadraticCurveTo(cx - s * 0.85, cy - s * 0.15, cx, cy - s * 0.92);
    ctx.closePath();
    ctx.fill();
    const inner = ctx.createLinearGradient(cx, cy - s * 0.3, cx, cy + s * 0.8);
    inner.addColorStop(0, '#fef9c3');
    inner.addColorStop(1, '#facc15');
    ctx.fillStyle = inner;
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 0.35);
    ctx.quadraticCurveTo(cx + s * 0.42, cy + s * 0.15, cx + s * 0.32, cy + s * 0.58);
    ctx.quadraticCurveTo(cx, cy + s * 0.82, cx - s * 0.32, cy + s * 0.58);
    ctx.quadraticCurveTo(cx - s * 0.42, cy + s * 0.15, cx, cy - s * 0.35);
    ctx.closePath();
    ctx.fill();
  } else if (key === '✨' || key === '⭐' || key === '🌠') {
    const g = ctx.createLinearGradient(cx - s, cy - s, cx + s, cy + s);
    g.addColorStop(0, '#fef9c3');
    g.addColorStop(0.5, '#facc15');
    g.addColorStop(1, '#f59e0b');
    ctx.fillStyle = g;
    drawFourPointSparkle(ctx, cx - s * 0.12, cy + s * 0.08, s * 0.72, s * 0.22);
    ctx.fill();
    ctx.fillStyle = '#fef08a';
    drawFourPointSparkle(ctx, cx + s * 0.48, cy - s * 0.48, s * 0.34, s * 0.11);
    ctx.fill();
    if (key === '🌠') {
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.85)';
      ctx.lineWidth = Math.max(1.2, s * 0.16);
      ctx.beginPath();
      ctx.moveTo(cx + s * 0.1, cy - s * 0.1);
      ctx.lineTo(cx + s * 0.85, cy - s * 0.72);
      ctx.stroke();
    }
  } else if (key === '⚡') {
    const g = ctx.createLinearGradient(cx, cy - s, cx, cy + s);
    g.addColorStop(0, '#fef08a');
    g.addColorStop(0.5, '#facc15');
    g.addColorStop(1, '#f59e0b');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.15, cy - s * 0.9);
    ctx.lineTo(cx - s * 0.48, cy + s * 0.08);
    ctx.lineTo(cx + s * 0.02, cy + s * 0.08);
    ctx.lineTo(cx - s * 0.18, cy + s * 0.9);
    ctx.lineTo(cx + s * 0.5, cy - s * 0.08);
    ctx.lineTo(cx + s * 0.02, cy - s * 0.08);
    ctx.closePath();
    ctx.fill();
  } else if (key === '💀') {
    drawGlossyOrbBase(ctx, cx, cy - s * 0.1, s * 0.72, '#ffffff', '#e5e7eb', '#9ca3af');
    drawRoundedRectPath(ctx, cx - s * 0.36, cy + s * 0.25, s * 0.72, s * 0.48, s * 0.16);
    ctx.fillStyle = '#d1d5db';
    ctx.fill();
    ctx.fillStyle = '#18181b';
    ctx.beginPath();
    ctx.arc(cx - s * 0.26, cy - s * 0.08, s * 0.17, 0, Math.PI * 2);
    ctx.arc(cx + s * 0.26, cy - s * 0.08, s * 0.17, 0, Math.PI * 2);
    ctx.fill();
  } else if (key === '✈️' || key === '✈' || key === '🚀') {
    const g = ctx.createLinearGradient(cx - s, cy - s, cx + s, cy + s);
    g.addColorStop(0, '#f8fafc');
    g.addColorStop(0.55, '#cbd5e1');
    g.addColorStop(1, '#64748b');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.76, cy - s * 0.76);
    ctx.lineTo(cx + s * 0.18, cy + s * 0.02);
    ctx.lineTo(cx + s * 0.56, cy + s * 0.62);
    ctx.lineTo(cx + s * 0.22, cy + s * 0.68);
    ctx.lineTo(cx - s * 0.08, cy + s * 0.22);
    ctx.lineTo(cx - s * 0.45, cy + s * 0.52);
    ctx.lineTo(cx - s * 0.64, cy + s * 0.36);
    ctx.lineTo(cx - s * 0.34, cy - s * 0.02);
    ctx.lineTo(cx - s * 0.78, cy - s * 0.28);
    ctx.lineTo(cx - s * 0.66, cy - s * 0.56);
    ctx.lineTo(cx - s * 0.04, cy - s * 0.24);
    ctx.closePath();
    ctx.fill();
    if (key === '🚀') {
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(cx - s * 0.55, cy + s * 0.55, s * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (key === '🛳️' || key === '🛳') {
    const hull = ctx.createLinearGradient(cx, cy, cx, cy + s);
    hull.addColorStop(0, '#f8fafc');
    hull.addColorStop(0.5, '#1e3a8a');
    hull.addColorStop(1, '#0f172a');
    ctx.fillStyle = hull;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.78, cy + s * 0.12);
    ctx.lineTo(cx + s * 0.78, cy + s * 0.12);
    ctx.lineTo(cx + s * 0.54, cy + s * 0.62);
    ctx.lineTo(cx - s * 0.58, cy + s * 0.62);
    ctx.closePath();
    ctx.fill();
    drawRoundedRectPath(ctx, cx - s * 0.52, cy - s * 0.36, s * 1.04, s * 0.46, s * 0.12);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(cx - s * 0.24, cy - s * 0.7, s * 0.24, s * 0.34);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(cx - s * 0.85, cy + s * 0.58, s * 1.7, s * 0.18);
  } else if (key === '🌊') {
    const g = ctx.createLinearGradient(cx, cy - s, cx, cy + s);
    g.addColorStop(0, '#bae6fd');
    g.addColorStop(0.45, '#0ea5e9');
    g.addColorStop(1, '#1d4ed8');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.82, cy + s * 0.65);
    ctx.quadraticCurveTo(cx - s * 0.75, cy - s * 0.78, cx + s * 0.2, cy - s * 0.68);
    ctx.quadraticCurveTo(cx + s * 0.72, cy - s * 0.6, cx + s * 0.34, cy - s * 0.12);
    ctx.quadraticCurveTo(cx + s * 0.12, cy - s * 0.32, cx - s * 0.08, cy - s * 0.08);
    ctx.quadraticCurveTo(cx + s * 0.42, cy + s * 0.25, cx + s * 0.82, cy + s * 0.65);
    ctx.closePath();
    ctx.fill();
  } else if (key === '🌙') {
    const g = ctx.createLinearGradient(cx - s, cy - s, cx + s, cy + s);
    g.addColorStop(0, '#fef08a');
    g.addColorStop(1, '#f59e0b');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.78, 0.45, Math.PI * 2 - 0.45);
    ctx.quadraticCurveTo(cx - s * 0.05, cy, cx + Math.cos(0.45) * s * 0.78, cy + Math.sin(0.45) * s * 0.78);
    ctx.fill();
  } else if (key === '☀️' || key === '☀') {
    drawGlossyOrbBase(ctx, cx, cy, s * 0.56, '#fef9c3', '#facc15', '#ea580c');
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = Math.max(1.2, s * 0.14);
    ctx.beginPath();
    for (let r = 0; r < 8; r++) {
      const a = (r / 8) * Math.PI * 2;
      ctx.moveTo(cx + Math.cos(a) * s * 0.68, cy + Math.sin(a) * s * 0.68);
      ctx.lineTo(cx + Math.cos(a) * s * 0.9, cy + Math.sin(a) * s * 0.9);
    }
    ctx.stroke();
  } else if (key === '🎵') {
    const g = ctx.createLinearGradient(cx - s, cy - s, cx + s, cy + s);
    g.addColorStop(0, '#f472b6');
    g.addColorStop(0.55, '#a855f7');
    g.addColorStop(1, '#6366f1');
    ctx.fillStyle = g;
    ctx.strokeStyle = g;
    ctx.lineWidth = Math.max(1.5, s * 0.18);
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.25, cy + s * 0.45);
    ctx.lineTo(cx - s * 0.25, cy - s * 0.55);
    ctx.lineTo(cx + s * 0.48, cy - s * 0.72);
    ctx.lineTo(cx + s * 0.48, cy + s * 0.28);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx - s * 0.42, cy + s * 0.46, s * 0.22, 0, Math.PI * 2);
    ctx.arc(cx + s * 0.31, cy + s * 0.3, s * 0.22, 0, Math.PI * 2);
    ctx.fill();
  } else if (key === '🥂') {
    ctx.strokeStyle = '#fde047';
    ctx.fillStyle = 'rgba(254, 240, 138, 0.85)';
    ctx.lineWidth = Math.max(1.1, s * 0.12);
    drawRoundedRectPath(ctx, cx - s * 0.62, cy - s * 0.68, s * 0.44, s * 0.68, s * 0.14);
    ctx.fill();
    drawRoundedRectPath(ctx, cx + s * 0.16, cy - s * 0.68, s * 0.44, s * 0.68, s * 0.14);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.4, cy);
    ctx.lineTo(cx - s * 0.4, cy + s * 0.7);
    ctx.moveTo(cx + s * 0.38, cy);
    ctx.lineTo(cx + s * 0.38, cy + s * 0.7);
    ctx.stroke();
  } else if (key === '💎') {
    const g = ctx.createLinearGradient(cx - s, cy - s, cx + s, cy + s);
    g.addColorStop(0, '#e0f2fe');
    g.addColorStop(0.5, '#38bdf8');
    g.addColorStop(1, '#0284c7');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.55, cy - s * 0.55);
    ctx.lineTo(cx + s * 0.55, cy - s * 0.55);
    ctx.lineTo(cx + s * 0.86, cy - s * 0.1);
    ctx.lineTo(cx, cy + s * 0.82);
    ctx.lineTo(cx - s * 0.86, cy - s * 0.1);
    ctx.closePath();
    ctx.fill();
  } else if (key === '👑') {
    const g = ctx.createLinearGradient(cx, cy - s, cx, cy + s);
    g.addColorStop(0, '#fef08a');
    g.addColorStop(1, '#d97706');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.76, cy + s * 0.52);
    ctx.lineTo(cx - s * 0.82, cy - s * 0.42);
    ctx.lineTo(cx - s * 0.34, cy);
    ctx.lineTo(cx, cy - s * 0.62);
    ctx.lineTo(cx + s * 0.34, cy);
    ctx.lineTo(cx + s * 0.82, cy - s * 0.42);
    ctx.lineTo(cx + s * 0.76, cy + s * 0.52);
    ctx.closePath();
    ctx.fill();
  } else if (key === '🦋') {
    const g = ctx.createLinearGradient(cx - s, cy - s, cx + s, cy + s);
    g.addColorStop(0, '#60a5fa');
    g.addColorStop(0.5, '#818cf8');
    g.addColorStop(1, '#2563eb');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx - s * 0.42, cy - s * 0.24, s * 0.4, 0, Math.PI * 2);
    ctx.arc(cx + s * 0.42, cy - s * 0.24, s * 0.4, 0, Math.PI * 2);
    ctx.arc(cx - s * 0.34, cy + s * 0.28, s * 0.3, 0, Math.PI * 2);
    ctx.arc(cx + s * 0.34, cy + s * 0.28, s * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1e1b4b';
    drawRoundedRectPath(ctx, cx - s * 0.1, cy - s * 0.45, s * 0.2, s * 0.9, s * 0.1);
    ctx.fill();
  } else if (key === '👻') {
    drawGlossyOrbBase(ctx, cx, cy - s * 0.08, s * 0.74, '#ffffff', '#f1f5f9', '#cbd5e1');
    drawRoundedRectPath(ctx, cx - s * 0.74, cy - s * 0.08, s * 1.48, s * 0.78, s * 0.28);
    ctx.fillStyle = '#f1f5f9';
    ctx.fill();
    ctx.fillStyle = '#18181b';
    ctx.beginPath();
    ctx.arc(cx - s * 0.26, cy - s * 0.12, s * 0.13, 0, Math.PI * 2);
    ctx.arc(cx + s * 0.26, cy - s * 0.12, s * 0.13, 0, Math.PI * 2);
    ctx.fill();
  } else if (key === '👀') {
    drawGlossyOrbBase(ctx, cx - s * 0.38, cy, s * 0.42, '#ffffff', '#f8fafc', '#cbd5e1');
    drawGlossyOrbBase(ctx, cx + s * 0.38, cy, s * 0.42, '#ffffff', '#f8fafc', '#cbd5e1');
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(cx - s * 0.48, cy, s * 0.18, 0, Math.PI * 2);
    ctx.arc(cx + s * 0.28, cy, s * 0.18, 0, Math.PI * 2);
    ctx.fill();
  } else if (key === '🌹' || key === '🥀') {
    ctx.strokeStyle = '#16a34a';
    ctx.lineWidth = Math.max(1.4, s * 0.15);
    ctx.beginPath();
    ctx.moveTo(cx, cy + s * 0.1);
    ctx.lineTo(cx, cy + s * 0.85);
    ctx.stroke();
    drawGlossyOrbBase(
      ctx,
      key === '🥀' ? cx + s * 0.14 : cx,
      key === '🥀' ? cy - s * 0.05 : cy - s * 0.25,
      s * 0.46,
      '#fda4af',
      key === '🥀' ? '#be123c' : '#f43f5e',
      '#881337'
    );
  } else if (key === '🚦') {
    drawRoundedRectPath(ctx, cx - s * 0.4, cy - s * 0.86, s * 0.8, s * 1.72, s * 0.26);
    ctx.fillStyle = '#27272a';
    ctx.fill();
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(cx, cy - s * 0.48, s * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.arc(cx, cy + s * 0.48, s * 0.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (key === '⏰') {
    drawGlossyOrbBase(ctx, cx, cy + s * 0.05, s * 0.72, '#ffffff', '#f1f5f9', '#ef4444');
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = Math.max(1.4, s * 0.14);
    ctx.beginPath();
    ctx.moveTo(cx, cy + s * 0.05);
    ctx.lineTo(cx, cy - s * 0.35);
    ctx.moveTo(cx, cy + s * 0.05);
    ctx.lineTo(cx + s * 0.28, cy + s * 0.18);
    ctx.stroke();
  } else if (key === '🚗' || key === '🏍️' || key === '🏍' || key === '🚆') {
    const g = ctx.createLinearGradient(cx, cy - s * 0.6, cx, cy + s * 0.6);
    g.addColorStop(0, key === '🚆' ? '#93c5fd' : '#f87171');
    g.addColorStop(1, key === '🚆' ? '#1d4ed8' : '#b91c1c');
    ctx.fillStyle = g;
    drawRoundedRectPath(ctx, cx - s * 0.82, cy - s * 0.28, s * 1.64, s * 0.62, s * 0.24);
    ctx.fill();
    ctx.fillStyle = '#bae6fd';
    drawRoundedRectPath(ctx, cx - s * 0.48, cy - s * 0.56, s * 0.96, s * 0.34, s * 0.14);
    ctx.fill();
    ctx.fillStyle = '#18181b';
    ctx.beginPath();
    ctx.arc(cx - s * 0.45, cy + s * 0.38, s * 0.22, 0, Math.PI * 2);
    ctx.arc(cx + s * 0.45, cy + s * 0.38, s * 0.22, 0, Math.PI * 2);
    ctx.fill();
  } else if (key === '🐎') {
    drawGlossyOrbBase(ctx, cx, cy, s * 0.78, '#d97706', '#92400e', '#451a03');
    ctx.fillStyle = '#fde68a';
    drawFourPointSparkle(ctx, cx, cy - s * 0.12, s * 0.32, s * 0.14);
    ctx.fill();
  } else if (key === '🌧️' || key === '🌧') {
    drawGlossyOrbBase(ctx, cx - s * 0.2, cy - s * 0.15, s * 0.44, '#f1f5f9', '#cbd5e1', '#64748b');
    drawGlossyOrbBase(ctx, cx + s * 0.25, cy - s * 0.1, s * 0.38, '#f1f5f9', '#cbd5e1', '#64748b');
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(cx - s * 0.28, cy + s * 0.55, s * 0.12, 0, Math.PI * 2);
    ctx.arc(cx + s * 0.05, cy + s * 0.65, s * 0.12, 0, Math.PI * 2);
    ctx.arc(cx + s * 0.36, cy + s * 0.52, s * 0.12, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Glossy 3D Apple-styled gradient orb badge for any other emoji (never raw Segoe UI text)
    const palette = key === '🫶' ? ['#fde047', '#f59e0b', '#b45309'] : ['#93c5fd', '#3b82f6', '#1d4ed8'];
    drawGlossyOrbBase(ctx, cx, cy, s * 0.8, palette[0], palette[1], palette[2]);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    drawFourPointSparkle(ctx, cx, cy, s * 0.36, s * 0.14);
    ctx.fill();
  }

  ctx.restore();
}

function getCachedOffscreenVector(emoji: string): OffscreenCanvas | null {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const cached = offscreenVectorCache.get(emoji);
  if (cached) return cached;

  try {
    const off = new OffscreenCanvas(64, 64);
    const octx = off.getContext('2d') as unknown as CanvasRenderingContext2D | null;
    if (!octx) return null;
    drawVectorAppleEmoji(octx, emoji, 32, 32, 56);
    if (offscreenVectorCache.size >= MAX_OFFSCREEN_CACHE) {
      const oldest = offscreenVectorCache.keys().next().value;
      if (oldest !== undefined) offscreenVectorCache.delete(oldest);
    }
    offscreenVectorCache.set(emoji, off);
    return off;
  } catch {
    return null;
  }
}

/**
 * Draws a crisp Apple-style emoji centered at `(cx, cy)` with bounding width/height `sizePx`.
 * Zero per-frame allocations; uses bundled 64px PNG -> CDN PNG -> OffscreenCanvas-cached 3D vector fallback.
 */
export function drawAppleEmoji(
  ctx: CanvasRenderingContext2D,
  emoji: string,
  cx: number,
  cy: number,
  sizePx: number
): void {
  if (!emoji || sizePx <= 0) return;

  const canDrawImage = typeof ctx.drawImage === 'function';
  if (canDrawImage) {
    const img = requestEmojiImage(emoji);
    if (img) {
      const half = sizePx * 0.5;
      ctx.drawImage(img, cx - half, cy - half, sizePx, sizePx);
      return;
    }

    const off = getCachedOffscreenVector(emoji);
    if (off) {
      const half = sizePx * 0.5;
      ctx.drawImage(off as unknown as CanvasImageSource, cx - half, cy - half, sizePx, sizePx);
      return;
    }
  }

  // Mock / headless fallback: draw 3D glossy vector shapes directly onto ctx
  drawVectorAppleEmoji(ctx, emoji, cx, cy, sizePx);
}
