import type { LyricPalette } from './models';

export interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface OklchColor {
  readonly L: number;
  readonly C: number;
  readonly h: number;
}

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function clampByte(v: number): number {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return Math.round(v);
}

export function normalizeHue(h: number): number {
  const mod = h % 360;
  return mod < 0 ? mod + 360 : mod;
}

export function srgbToLinear(c255: number): number {
  const c = clamp01(c255 / 255);
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(lin: number): number {
  const c = clamp01(lin);
  const srgb = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return clampByte(srgb * 255);
}

export function rgbToOklch(r: number, g: number, b: number): OklchColor {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
  const b_ = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;

  const C = Math.hypot(a, b_);
  const h = C < 1e-6 ? 0 : normalizeHue((Math.atan2(b_, a) * 180) / Math.PI);

  return { L: clamp01(L), C, h };
}

function oklchToLinearRgbRaw(L: number, C: number, hDeg: number): [number, number, number] {
  const hRad = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b_ = C * Math.sin(hRad);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b_;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b_;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b_;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const lr = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

  return [lr, lg, lb];
}

function isInLinearGamut(lr: number, lg: number, lb: number): boolean {
  const eps = 1e-4;
  return (
    lr >= -eps && lr <= 1 + eps &&
    lg >= -eps && lg <= 1 + eps &&
    lb >= -eps && lb <= 1 + eps
  );
}

export function oklchToRgb(L: number, C: number, h: number): RgbColor {
  const clampedL = clamp01(L);
  const clampedC = Math.max(0, C);
  const normH = normalizeHue(h);

  let [lr, lg, lb] = oklchToLinearRgbRaw(clampedL, clampedC, normH);

  // Gamut-clip by reducing chroma along constant L and hue if outside sRGB cube
  if (!isInLinearGamut(lr, lg, lb) && clampedC > 0) {
    let low = 0;
    let high = clampedC;
    for (let i = 0; i < 16; i++) {
      const mid = (low + high) * 0.5;
      const candidate = oklchToLinearRgbRaw(clampedL, mid, normH);
      if (isInLinearGamut(candidate[0], candidate[1], candidate[2])) {
        low = mid;
        lr = candidate[0];
        lg = candidate[1];
        lb = candidate[2];
      } else {
        high = mid;
      }
    }
  }

  return {
    r: linearToSrgb(lr),
    g: linearToSrgb(lg),
    b: linearToSrgb(lb),
  };
}

export function rgbToCss(rgb: RgbColor, alpha = 1): string {
  if (alpha >= 0.999) {
    return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  }
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Number(a.toFixed(3))})`;
}

export function oklchToCss(L: number, C: number, h: number, alpha = 1): string {
  return rgbToCss(oklchToRgb(L, C, h), alpha);
}

export function relativeLuminance(rgb: RgbColor): number {
  const lr = srgbToLinear(rgb.r);
  const lg = srgbToLinear(rgb.g);
  const lb = srgbToLinear(rgb.b);
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

export function contrastRatio(a: RgbColor, b: RgbColor): number {
  const lumA = relativeLuminance(a);
  const lumB = relativeLuminance(b);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

export const DEMO_FALLBACK_PALETTE: LyricPalette = {
  bgDeep: 'rgb(10, 14, 28)',
  bgMid: 'rgb(20, 29, 54)',
  accentPrimary: 'rgb(94, 212, 245)',
  accentSecondary: 'rgb(168, 132, 248)',
  textActive: 'rgb(248, 250, 255)',
  textUpcoming: 'rgba(218, 226, 242, 0.72)',
  textPassed: 'rgba(176, 190, 218, 0.46)',
  oklchL: 0.68,
  oklchC: 0.14,
  oklchH: 220,
  isFallback: true,
};

interface HueBucket {
  weight: number;
  sumL: number;
  sumC: number;
  sumCos: number;
  sumSin: number;
}

export function extractPaletteFromPixels(
  rgba: Uint8ClampedArray | Uint8Array | readonly number[],
  width: number,
  height: number,
): LyricPalette {
  const totalPixels = Math.floor(Math.min(rgba.length / 4, width * height));
  if (totalPixels <= 0) {
    return DEMO_FALLBACK_PALETTE;
  }

  const HUE_BINS = 24;
  const buckets: HueBucket[] = Array.from({ length: HUE_BINS }, () => ({
    weight: 0,
    sumL: 0,
    sumC: 0,
    sumCos: 0,
    sumSin: 0,
  }));

  let neutralWeight = 0;
  let neutralSumL = 0;
  let validCount = 0;

  const step = totalPixels > 4096 ? Math.floor(totalPixels / 4096) : 1;

  for (let idx = 0; idx < totalPixels; idx += step) {
    const offset = idx * 4;
    const a = rgba[offset + 3] ?? 255;
    if (a < 128) continue;

    const r = rgba[offset];
    const g = rgba[offset + 1];
    const b = rgba[offset + 2];
    const { L, C, h } = rgbToOklch(r, g, b);
    validCount++;

    if (C < 0.028) {
      neutralWeight += 0.25;
      neutralSumL += L * 0.25;
      continue;
    }

    // Chroma-weighted clustering prioritizes vibrant artwork hues over white/black borders
    const w = 0.2 + C * 4.5;
    const bin = Math.min(HUE_BINS - 1, Math.floor((normalizeHue(h) / 360) * HUE_BINS));
    const bucket = buckets[bin];
    const hRad = (h * Math.PI) / 180;
    bucket.weight += w;
    bucket.sumL += L * w;
    bucket.sumC += C * w;
    bucket.sumCos += Math.cos(hRad) * w;
    bucket.sumSin += Math.sin(hRad) * w;
  }

  if (validCount === 0) {
    return DEMO_FALLBACK_PALETTE;
  }

  let bestBucket: HueBucket | null = null;
  for (const bucket of buckets) {
    if (!bestBucket || bucket.weight > bestBucket.weight) {
      bestBucket = bucket;
    }
  }

  let domL: number;
  let domC: number;
  let domH: number;

  if (!bestBucket || bestBucket.weight <= 0.001) {
    // Pure monochrome / grayscale artwork: synthesize a refined cool slate-indigo palette
    domL = neutralWeight > 0 ? neutralSumL / neutralWeight : 0.5;
    domC = 0.04;
    domH = 245;
  } else {
    domL = bestBucket.sumL / bestBucket.weight;
    domC = bestBucket.sumC / bestBucket.weight;
    domH = normalizeHue((Math.atan2(bestBucket.sumSin, bestBucket.sumCos) * 180) / Math.PI);
  }

  // Deep atmospheric backgrounds clamped dark enough for readable luminous typography
  let bgDeepL = Math.min(0.16, Math.max(0.08, domL * 0.22));
  let bgMidL = Math.min(0.24, Math.max(0.14, domL * 0.32));
  const bgDeepC = Math.min(0.07, domC * 0.55);
  const bgMidC = Math.min(0.10, domC * 0.65);

  let bgDeepRgb = oklchToRgb(bgDeepL, bgDeepC, domH);
  let bgMidRgb = oklchToRgb(bgMidL, bgMidC, normalizeHue(domH + 10));

  const accentPrimaryRgb = oklchToRgb(
    Math.min(0.82, Math.max(0.68, domL)),
    Math.min(0.22, Math.max(0.12, domC * 1.1)),
    domH,
  );
  const accentSecondaryRgb = oklchToRgb(
    Math.min(0.78, Math.max(0.62, domL * 0.95)),
    Math.min(0.20, Math.max(0.10, domC * 0.95)),
    normalizeHue(domH + 42),
  );

  // Start with crisp tinted white text and enforce WCAG AA (>= 4.5:1) against both bgDeep and bgMid
  let textActiveRgb = oklchToRgb(0.96, Math.min(0.018, domC * 0.15), domH);

  let guard = 0;
  while (
    (contrastRatio(textActiveRgb, bgDeepRgb) < 4.5 ||
      contrastRatio(textActiveRgb, bgMidRgb) < 4.5) &&
    guard < 16
  ) {
    bgDeepL = Math.max(0.04, bgDeepL - 0.02);
    bgMidL = Math.max(0.08, bgMidL - 0.025);
    bgDeepRgb = oklchToRgb(bgDeepL, bgDeepC * 0.8, domH);
    bgMidRgb = oklchToRgb(bgMidL, bgMidC * 0.8, normalizeHue(domH + 10));
    textActiveRgb = guard >= 6 ? { r: 255, g: 255, b: 255 } : oklchToRgb(0.985, 0.006, domH);
    guard++;
  }

  const textUpcomingRgb = oklchToRgb(0.84, Math.min(0.03, domC * 0.25), domH);
  const textPassedRgb = oklchToRgb(0.72, Math.min(0.025, domC * 0.2), domH);

  return {
    bgDeep: rgbToCss(bgDeepRgb),
    bgMid: rgbToCss(bgMidRgb),
    accentPrimary: rgbToCss(accentPrimaryRgb),
    accentSecondary: rgbToCss(accentSecondaryRgb),
    textActive: rgbToCss(textActiveRgb),
    textUpcoming: rgbToCss(textUpcomingRgb, 0.74),
    textPassed: rgbToCss(textPassedRgb, 0.48),
    oklchL: Number(domL.toFixed(4)),
    oklchC: Number(domC.toFixed(4)),
    oklchH: Number(domH.toFixed(2)),
    isFallback: false,
  };
}

export async function extractPaletteFromArtworkUrl(url: string): Promise<LyricPalette> {
  if (!url || typeof document === 'undefined' || typeof Image === 'undefined') {
    return DEMO_FALLBACK_PALETTE;
  }

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Artwork load failed'));
      image.src = url;
    });

    const size = 48;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return DEMO_FALLBACK_PALETTE;
    }

    ctx.drawImage(img, 0, 0, size, size);
    const imageData = ctx.getImageData(0, 0, size, size);
    return extractPaletteFromPixels(imageData.data, size, size);
  } catch {
    return DEMO_FALLBACK_PALETTE;
  }
}
