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

export function rgbToHex(rgb: RgbColor): string {
  return (
    '#' +
    clampByte(rgb.r).toString(16).padStart(2, '0') +
    clampByte(rgb.g).toString(16).padStart(2, '0') +
    clampByte(rgb.b).toString(16).padStart(2, '0')
  );
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

interface ParsedCssColor {
  readonly rgb: RgbColor;
  readonly alpha: number;
}

function parseCssColor(css: string): ParsedCssColor | null {
  if (typeof css !== 'string') return null;
  const trimmed = css.trim();
  if (trimmed.startsWith('#')) {
    const hex = trimmed.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
        return { rgb: { r, g, b }, alpha: 1 };
      }
    } else if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b) && !Number.isNaN(a)) {
        return { rgb: { r, g, b }, alpha: clamp01(a) };
      }
    }
    return null;
  }

  const m = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i.exec(trimmed);
  if (m) {
    const r = clampByte(Number(m[1]));
    const g = clampByte(Number(m[2]));
    const b = clampByte(Number(m[3]));
    const alpha = m[4] !== undefined ? clamp01(Number(m[4])) : 1;
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) && Number.isFinite(alpha)) {
      return { rgb: { r, g, b }, alpha };
    }
  }
  return null;
}

function compositeOver(fg: RgbColor, alpha: number, bg: RgbColor): RgbColor {
  const a = clamp01(alpha);
  if (a >= 0.999) return fg;
  return {
    r: clampByte(fg.r * a + bg.r * (1 - a)),
    g: clampByte(fg.g * a + bg.g * (1 - a)),
    b: clampByte(fg.b * a + bg.b * (1 - a)),
  };
}

/**
 * Clamp OKLCH L and C so `fg` meets `minRatio` WCAG contrast against `bg`.
 */
export function ensureContrastRgb(
  fg: RgbColor,
  bg: RgbColor,
  minRatio = 7.0,
  preferLighter?: boolean
): RgbColor {
  if (contrastRatio(fg, bg) >= minRatio) {
    return fg;
  }

  const lighter = preferLighter !== undefined ? preferLighter : relativeLuminance(bg) < 0.5;
  const { L, C, h } = rgbToOklch(fg.r, fg.g, fg.b);

  for (let step = 1; step <= 24; step++) {
    const t = step / 24;
    const targetL = lighter ? L + (1 - L) * t : L * (1 - t);
    const targetC = lighter ? C * Math.max(0.05, 1 - t * 0.85) : C * Math.max(0.05, 1 - t * 0.75);
    const candidate = oklchToRgb(targetL, targetC, h);
    if (contrastRatio(candidate, bg) >= minRatio) {
      return candidate;
    }
  }

  const extreme: RgbColor = lighter ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
  if (contrastRatio(extreme, bg) >= minRatio) {
    return extreme;
  }
  const opposite: RgbColor = lighter ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
  return contrastRatio(opposite, bg) >= contrastRatio(extreme, bg) ? opposite : extreme;
}

function ensureContrastAgainstBoth(
  fg: RgbColor,
  bgDeep: RgbColor,
  bgMid: RgbColor,
  minRatio: number
): RgbColor {
  const harderBg = relativeLuminance(bgMid) >= relativeLuminance(bgDeep) ? bgMid : bgDeep;
  let result = ensureContrastRgb(fg, harderBg, minRatio, true);
  if (contrastRatio(result, bgDeep) < minRatio) {
    result = ensureContrastRgb(result, bgDeep, minRatio, true);
  }
  return result;
}

/**
 * Enforce WCAG AAA (>= 7.0:1) for textActive and AA (>= 4.5:1) for textUpcoming and accentPrimary
 * against both bgDeep and bgMid by clamping OKLCH L/C.
 */
export function ensurePaletteContrast(palette: LyricPalette): LyricPalette {
  const parsedDeep = parseCssColor(palette.bgDeep)?.rgb ?? { r: 10, g: 14, b: 28 };
  const parsedMid = parseCssColor(palette.bgMid)?.rgb ?? { r: 20, g: 29, b: 54 };

  let bgDeepRgb = parsedDeep;
  let bgMidRgb = parsedMid;
  const white: RgbColor = { r: 255, g: 255, b: 255 };

  // Ensure dark backgrounds allow >= 7.5:1 headroom for luminous text
  if (contrastRatio(white, bgDeepRgb) < 7.5) {
    const o = rgbToOklch(bgDeepRgb.r, bgDeepRgb.g, bgDeepRgb.b);
    let curL = Math.min(o.L, 0.18);
    let curC = Math.min(o.C, 0.08);
    for (let i = 0; i < 16; i++) {
      bgDeepRgb = oklchToRgb(curL, curC, o.h);
      if (contrastRatio(white, bgDeepRgb) >= 7.5) break;
      curL = Math.max(0.03, curL - 0.015);
      curC *= 0.85;
    }
  }
  if (contrastRatio(white, bgMidRgb) < 7.5) {
    const o = rgbToOklch(bgMidRgb.r, bgMidRgb.g, bgMidRgb.b);
    let curL = Math.min(o.L, 0.24);
    let curC = Math.min(o.C, 0.10);
    for (let i = 0; i < 16; i++) {
      bgMidRgb = oklchToRgb(curL, curC, o.h);
      if (contrastRatio(white, bgMidRgb) >= 7.5) break;
      curL = Math.max(0.05, curL - 0.015);
      curC *= 0.85;
    }
  }

  const parsedActive = parseCssColor(palette.textActive)?.rgb ?? { r: 248, g: 250, b: 255 };
  const textActiveRgb = ensureContrastAgainstBoth(parsedActive, bgDeepRgb, bgMidRgb, 7.0);

  const parsedAccent1 = parseCssColor(palette.accentPrimary)?.rgb ?? { r: 94, g: 212, b: 245 };
  const accentPrimaryRgb = ensureContrastAgainstBoth(parsedAccent1, bgDeepRgb, bgMidRgb, 4.5);

  const parsedAccent2 = parseCssColor(palette.accentSecondary)?.rgb ?? { r: 168, g: 132, b: 248 };
  const accentSecondaryRgb = ensureContrastAgainstBoth(parsedAccent2, bgDeepRgb, bgMidRgb, 4.5);

  const parsedUpcoming = parseCssColor(palette.textUpcoming) ?? {
    rgb: { r: 218, g: 226, b: 242 },
    alpha: 0.82,
  };
  let upcomingAlpha = Math.max(0.78, parsedUpcoming.alpha);
  let textUpcomingRgb = ensureContrastAgainstBoth(parsedUpcoming.rgb, bgDeepRgb, bgMidRgb, 4.5);
  // Also guarantee composited color over bgMid/bgDeep satisfies >= 4.5:1
  for (let i = 0; i < 10; i++) {
    const compDeep = compositeOver(textUpcomingRgb, upcomingAlpha, bgDeepRgb);
    const compMid = compositeOver(textUpcomingRgb, upcomingAlpha, bgMidRgb);
    if (contrastRatio(compDeep, bgDeepRgb) >= 4.5 && contrastRatio(compMid, bgMidRgb) >= 4.5) {
      break;
    }
    upcomingAlpha = Math.min(1, upcomingAlpha + 0.04);
    textUpcomingRgb = ensureContrastAgainstBoth(
      oklchToRgb(
        Math.min(0.98, rgbToOklch(textUpcomingRgb.r, textUpcomingRgb.g, textUpcomingRgb.b).L + 0.03),
        rgbToOklch(textUpcomingRgb.r, textUpcomingRgb.g, textUpcomingRgb.b).C * 0.7,
        rgbToOklch(textUpcomingRgb.r, textUpcomingRgb.g, textUpcomingRgb.b).h
      ),
      bgDeepRgb,
      bgMidRgb,
      4.5
    );
  }

  return {
    ...palette,
    bgDeep: rgbToCss(bgDeepRgb),
    bgMid: rgbToCss(bgMidRgb),
    accentPrimary: rgbToCss(accentPrimaryRgb),
    accentSecondary: rgbToCss(accentSecondaryRgb),
    textActive: rgbToCss(textActiveRgb),
    textUpcoming: rgbToCss(textUpcomingRgb, upcomingAlpha),
  };
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
  meshColors: ['#5ed4f5', '#a884f8', '#0a0e1c', '#141d36'],
};

interface HueBucket {
  weight: number;
  sumL: number;
  sumC: number;
  sumCos: number;
  sumSin: number;
}

interface HueCluster {
  weight: number;
  L: number;
  C: number;
  h: number;
}

function circularHueDistance(a: number, b: number): number {
  const diff = Math.abs(normalizeHue(a) - normalizeHue(b));
  return diff > 180 ? 360 - diff : diff;
}

function clampRange(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
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

  const HUE_BINS = 36;
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

    neutralWeight += 0.25;
    neutralSumL += L * 0.25;

    // Filter pure/near-black, washed-out greys, and near-white highlights from chromatic peaks
    if (L < 0.14 || C < 0.038 || (L > 0.94 && C < 0.04)) {
      continue;
    }

    // Chroma-weighted clustering prioritizes vibrant artwork hues without drowning out large darker hues
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

  const nonEmptyBins: Array<HueBucket & { h: number; L: number; C: number }> = [];
  for (const b of buckets) {
    if (b.weight > 0.001) {
      nonEmptyBins.push({
        ...b,
        L: b.sumL / b.weight,
        C: b.sumC / b.weight,
        h: normalizeHue((Math.atan2(b.sumSin, b.sumCos) * 180) / Math.PI),
      });
    }
  }
  nonEmptyBins.sort((a, b) => b.weight - a.weight);

  const clusters: HueCluster[] = [];
  if (nonEmptyBins.length > 0) {
    const minPeakWeight = nonEmptyBins[0].weight * 0.015;
    const seedHues: number[] = [];
    for (const bin of nonEmptyBins) {
      if (bin.weight < minPeakWeight) break;
      if (seedHues.every((sh) => circularHueDistance(bin.h, sh) >= 28)) {
        seedHues.push(bin.h);
        if (seedHues.length >= 4) break;
      }
    }

    // Merge adjacent bins within 20deg into their nearest seed peak so split hue bands stay unified
    const merged: HueBucket[] = seedHues.map(() => ({
      weight: 0,
      sumL: 0,
      sumC: 0,
      sumCos: 0,
      sumSin: 0,
    }));
    for (const bin of nonEmptyBins) {
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < seedHues.length; i++) {
        const d = circularHueDistance(bin.h, seedHues[i]);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0 && bestDist <= 20) {
        const m = merged[bestIdx];
        m.weight += bin.weight;
        m.sumL += bin.sumL;
        m.sumC += bin.sumC;
        m.sumCos += bin.sumCos;
        m.sumSin += bin.sumSin;
      }
    }

    const rawClusters: HueCluster[] = [];
    for (const m of merged) {
      if (m.weight > 0.001) {
        rawClusters.push({
          weight: m.weight,
          L: m.sumL / m.weight,
          C: m.sumC / m.weight,
          h: normalizeHue((Math.atan2(m.sumSin, m.sumCos) * 180) / Math.PI),
        });
      }
    }
    rawClusters.sort((a, b) => b.weight - a.weight);
    for (const c of rawClusters) {
      if (clusters.every((kept) => circularHueDistance(c.h, kept.h) >= 28)) {
        clusters.push(c);
      }
    }
  }

  let domL: number;
  let domC: number;
  let domH: number;
  let bgDeepL: number;
  let bgMidL: number;
  let bgDeepC: number;
  let bgMidC: number;
  let bgMidH: number;
  let accentPrimaryRgb: RgbColor;
  let accentSecondaryRgb: RgbColor;
  let c0Rgb: RgbColor;
  let c1Rgb: RgbColor;
  let c3Rgb: RgbColor;

  if (clusters.length === 0) {
    // Pure monochrome / grayscale artwork: synthesize a refined cool slate-indigo palette (never red)
    domL = neutralWeight > 0 ? neutralSumL / neutralWeight : 0.5;
    domC = 0.04;
    domH = 245;
    bgDeepL = clampRange(domL * 0.22, 0.10, 0.16);
    bgMidL = clampRange(domL * 0.30, 0.15, 0.22);
    bgDeepC = 0.028;
    bgMidC = 0.036;
    bgMidH = 255;

    accentPrimaryRgb = oklchToRgb(0.72, 0.08, 245);
    accentSecondaryRgb = oklchToRgb(0.66, 0.08, 268);
    c0Rgb = oklchToRgb(0.56, 0.055, 245);
    c1Rgb = oklchToRgb(0.40, 0.05, 260);
    c3Rgb = oklchToRgb(0.25, 0.04, 232);
  } else {
    const p0 = clusters[0];
    const p1 = clusters[1];
    const p2 = clusters[2];
    domL = p0.L;
    domC = p0.C;
    domH = p0.h;

    bgDeepL = clampRange(domL * 0.22, 0.10, 0.18);
    bgMidL = clampRange(domL * 0.32, 0.14, 0.24);
    bgDeepC = Math.min(0.07, domC * 0.55);
    bgMidC = Math.min(0.10, (p1 ? p1.C : domC) * 0.65);
    bgMidH = p1 ? p1.h : normalizeHue(domH + 12);

    accentPrimaryRgb = oklchToRgb(
      clampRange(domL, 0.68, 0.82),
      clampRange(domC * 1.1, 0.12, 0.22),
      domH,
    );
    accentSecondaryRgb = p1
      ? oklchToRgb(
          clampRange(p1.L, 0.64, 0.80),
          clampRange(p1.C * 1.08, 0.11, 0.22),
          p1.h,
        )
      : oklchToRgb(
          clampRange(domL * 0.95, 0.62, 0.78),
          clampRange(domC * 0.95, 0.10, 0.20),
          normalizeHue(domH + 42),
        );

    c0Rgb = oklchToRgb(
      clampRange(p0.L, 0.42, 0.76),
      clampRange(p0.C * 1.08, 0.08, 0.24),
      p0.h,
    );
    c1Rgb = p1
      ? oklchToRgb(
          clampRange(p1.L, 0.36, 0.74),
          clampRange(p1.C * 1.08, 0.08, 0.24),
          p1.h,
        )
      : oklchToRgb(
          clampRange(p0.L * 0.78, 0.30, 0.60),
          clampRange(p0.C * 0.92, 0.07, 0.20),
          normalizeHue(domH + 34),
        );
    c3Rgb = p2
      ? oklchToRgb(
          clampRange(p2.L * 0.78, 0.24, 0.52),
          clampRange(p2.C * 0.95, 0.06, 0.20),
          p2.h,
        )
      : p1
        ? oklchToRgb(
            clampRange(p1.L * 0.56, 0.20, 0.40),
            clampRange(p1.C * 0.85, 0.06, 0.16),
            p1.h,
          )
        : oklchToRgb(
            clampRange(p0.L * 0.52, 0.20, 0.36),
            clampRange(p0.C * 0.80, 0.05, 0.14),
            normalizeHue(domH - 28),
          );
  }

  let bgDeepRgb = oklchToRgb(bgDeepL, bgDeepC, domH);
  let bgMidRgb = oklchToRgb(bgMidL, bgMidC, bgMidH);

  // Start with crisp tinted white text and enforce WCAG AAA (>= 7.0:1) against both bgDeep and bgMid
  let textActiveRgb = oklchToRgb(0.97, Math.min(0.014, domC * 0.12), domH);

  let guard = 0;
  while (
    (contrastRatio(textActiveRgb, bgDeepRgb) < 7.0 ||
      contrastRatio(textActiveRgb, bgMidRgb) < 7.0) &&
    guard < 16
  ) {
    bgDeepL = Math.max(0.04, bgDeepL - 0.015);
    bgMidL = Math.max(0.07, bgMidL - 0.02);
    bgDeepRgb = oklchToRgb(bgDeepL, bgDeepC * 0.8, domH);
    bgMidRgb = oklchToRgb(bgMidL, bgMidC * 0.8, bgMidH);
    textActiveRgb = guard >= 6 ? { r: 255, g: 255, b: 255 } : oklchToRgb(0.99, 0.004, domH);
    guard++;
  }

  const textUpcomingRgb = oklchToRgb(0.88, Math.min(0.025, domC * 0.2), domH);
  const textPassedRgb = oklchToRgb(0.74, Math.min(0.025, domC * 0.2), domH);

  const contrasted = ensurePaletteContrast({
    bgDeep: rgbToCss(bgDeepRgb),
    bgMid: rgbToCss(bgMidRgb),
    accentPrimary: rgbToCss(accentPrimaryRgb),
    accentSecondary: rgbToCss(accentSecondaryRgb),
    textActive: rgbToCss(textActiveRgb),
    textUpcoming: rgbToCss(textUpcomingRgb, 0.84),
    textPassed: rgbToCss(textPassedRgb, 0.56),
    oklchL: Number(domL.toFixed(4)),
    oklchC: Number(domC.toFixed(4)),
    oklchH: Number(domH.toFixed(2)),
    isFallback: false,
  });

  const finalDeepRgb = parseCssColor(contrasted.bgDeep)?.rgb ?? bgDeepRgb;

  return {
    ...contrasted,
    meshColors: [
      rgbToHex(c0Rgb),
      rgbToHex(c1Rgb),
      rgbToHex(finalDeepRgb),
      rgbToHex(c3Rgb),
    ],
  };
}

const ARTWORK_URL_PALETTE_CACHE_MAX = 120;
const artworkUrlPaletteCache = new Map<string, LyricPalette>();
const artworkUrlPaletteInFlight = new Map<string, Promise<LyricPalette>>();

function setCachedUrlPalette(url: string, palette: LyricPalette): void {
  if (artworkUrlPaletteCache.has(url)) {
    artworkUrlPaletteCache.delete(url);
  } else if (artworkUrlPaletteCache.size >= ARTWORK_URL_PALETTE_CACHE_MAX) {
    const oldest = artworkUrlPaletteCache.keys().next().value;
    if (oldest !== undefined) artworkUrlPaletteCache.delete(oldest);
  }
  artworkUrlPaletteCache.set(url, palette);
}

export async function extractPaletteFromArtworkUrl(url: string): Promise<LyricPalette> {
  const trimmedUrl = typeof url === 'string' ? url.trim() : '';
  if (!trimmedUrl) {
    return DEMO_FALLBACK_PALETTE;
  }

  const cached = artworkUrlPaletteCache.get(trimmedUrl);
  if (cached) {
    artworkUrlPaletteCache.delete(trimmedUrl);
    artworkUrlPaletteCache.set(trimmedUrl, cached);
    return cached;
  }

  const pending = artworkUrlPaletteInFlight.get(trimmedUrl);
  if (pending) {
    return pending;
  }

  const task = (async (): Promise<LyricPalette> => {
    try {
      const electronApi = typeof window !== 'undefined' ? (window as any)?.electronAPI : undefined;
      const getArtworkPixels = electronApi?.getArtworkPixels;

      if (typeof getArtworkPixels === 'function') {
        const pixels = await getArtworkPixels(trimmedUrl);
        if (pixels && pixels.rgba && pixels.width > 0 && pixels.height > 0) {
          const palette = extractPaletteFromPixels(pixels.rgba, pixels.width, pixels.height);
          if (!palette.isFallback) {
            setCachedUrlPalette(trimmedUrl, palette);
          }
          return palette;
        }
        return DEMO_FALLBACK_PALETTE;
      }

      if (typeof document === 'undefined' || typeof Image === 'undefined') {
        return DEMO_FALLBACK_PALETTE;
      }

      const loadUrl =
        electronApi && (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://'))
          ? `waveform-local://artist-art?url=${encodeURIComponent(trimmedUrl)}`
          : trimmedUrl;

      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        const timeout = setTimeout(() => reject(new Error('Artwork load timeout')), 4000);
        image.crossOrigin = 'anonymous';
        image.onload = () => {
          clearTimeout(timeout);
          resolve(image);
        };
        image.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('Artwork load failed'));
        };
        image.src = loadUrl;
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
      const palette = extractPaletteFromPixels(imageData.data, size, size);
      if (!palette.isFallback) {
        setCachedUrlPalette(trimmedUrl, palette);
      }
      return palette;
    } catch {
      return DEMO_FALLBACK_PALETTE;
    } finally {
      artworkUrlPaletteInFlight.delete(trimmedUrl);
    }
  })();

  artworkUrlPaletteInFlight.set(trimmedUrl, task);
  return task;
}
