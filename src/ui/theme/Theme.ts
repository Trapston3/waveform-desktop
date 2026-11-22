import { create } from 'zustand';
import type { AppSettings } from '../../models/Settings';
import { extractPaletteFromArtworkUrl, rgbToHex } from '../../lyricVisualizer/core/oklchPalette';

export type ThemeMode = 'dark' | 'light';

export interface ColorTokens {
  background: string;
  surface: string;
  surfaceVariant: string;
  outline: string;
  onSurfaceVariant: string;
  primary: string;
  onPrimary: string;
  accent: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  scrimAmbient: string;
  glassBg: string;
  glassBorder: string;
  glassPlayer: string;
}

export const DarkThemeTokens: ColorTokens = {
  background: '#000000',
  surface: '#0D0D0F',
  surfaceVariant: '#1C1C1E',
  outline: '#2C2C2E',
  onSurfaceVariant: '#A1A1A6',
  primary: '#FFFFFF',
  onPrimary: '#000000',
  accent: '#FA2D48',
  textPrimary: '#FFFFFF',
  textSecondary: '#A1A1A6',
  textTertiary: '#8E8E93',
  scrimAmbient: 'rgba(0, 0, 0, 0.45)',
  glassBg: 'rgba(18, 18, 22, 0.52)',
  glassBorder: 'rgba(255, 255, 255, 0.16)',
  glassPlayer: 'rgba(22, 22, 26, 0.58)',
};

export const LightThemeTokens: ColorTokens = {
  background: '#FFFFFF',
  surface: '#F7F7F9',
  surfaceVariant: '#F2F2F7',
  outline: '#E5E5EA',
  onSurfaceVariant: '#52525B',
  primary: '#000000',
  onPrimary: '#FFFFFF',
  accent: '#FA2D48',
  textPrimary: '#000000',
  textSecondary: '#52525B',
  textTertiary: '#71717A',
  scrimAmbient: 'rgba(255, 255, 255, 0.70)',
  glassBg: 'rgba(250, 250, 252, 0.62)',
  glassBorder: 'rgba(255, 255, 255, 0.72)',
  glassPlayer: 'rgba(245, 245, 250, 0.68)',
};

export interface ArtworkPalette {
  dominantHue: number;
  vibrantAccent: string;
  edgeWash: string;
  ambientBackground: string;
  playerTint: string;
  topBandLuminance: number;
  meshColors?: [string, string, string, string];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return [Math.round(h * 360), s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = (((h % 360) + 360) % 360) / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, hue + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, hue) * 255),
    Math.round(hue2rgb(p, q, hue - 1 / 3) * 255),
  ];
}

function parseColorToRgbTuple(color: string): [number, number, number] | null {
  const trimmed = (color || '').trim();
  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(trimmed);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  const rgbMatch = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(trimmed);
  if (rgbMatch) {
    return [
      Math.max(0, Math.min(255, Math.round(parseFloat(rgbMatch[1])))),
      Math.max(0, Math.min(255, Math.round(parseFloat(rgbMatch[2])))),
      Math.max(0, Math.min(255, Math.round(parseFloat(rgbMatch[3])))),
    ];
  }
  return null;
}

function parseColorToHslAndRgb(color: string): { h: number; s: number; l: number; r: number; g: number; b: number } | null {
  const rgbTuple = parseColorToRgbTuple(color);
  if (rgbTuple) {
    const [r, g, b] = rgbTuple;
    const [h, s, l] = rgbToHsl(r, g, b);
    return { h, s, l, r, g, b };
  }
  const trimmed = (color || '').trim();
  const hslMatch = /^hsla?\(\s*([\d.-]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/i.exec(trimmed);
  if (hslMatch) {
    const h = ((Math.round(parseFloat(hslMatch[1])) % 360) + 360) % 360;
    const s = Math.max(0, Math.min(1, parseFloat(hslMatch[2]) / 100));
    const l = Math.max(0, Math.min(1, parseFloat(hslMatch[3]) / 100));
    const [r, g, b] = hslToRgb(h, s, l);
    return { h, s, l, r, g, b };
  }
  return null;
}

/**
 * Ensures an accent color has readable contrast against dark or light surfaces.
 */
export function ensureReadableAccent(
  color: string,
  isLightMode = false
): { accent: string; hover: string; subtle: string; pillActive: string } {
  const parsed = parseColorToHslAndRgb(color);
  if (!parsed) {
    const fallback = '#FA2D48';
    return {
      accent: fallback,
      hover: '#FB475E',
      subtle: 'rgba(250, 45, 72, 0.15)',
      pillActive: 'rgba(250, 45, 72, 0.92)',
    };
  }

  let { h, s, l, r, g, b } = parsed;
  let adjusted = false;
  const relLum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

  if (!isLightMode && (relLum < 0.16 || l < 0.45)) {
    l = Math.max(0.58, l);
    s = Math.max(0.55, s);
    adjusted = true;
  } else if (isLightMode && (relLum > 0.55 || l > 0.52)) {
    l = Math.min(0.44, l);
    adjusted = true;
  }

  if (adjusted) {
    [r, g, b] = hslToRgb(h, s, l);
  }

  const accent = adjusted
    ? `hsl(${h}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`
    : color;
  const hoverL = Math.min(0.88, l + (isLightMode ? -0.06 : 0.08));
  const hover = `hsl(${h}, ${Math.round(s * 100)}%, ${Math.round(hoverL * 100)}%)`;
  return {
    accent,
    hover,
    subtle: `rgba(${r}, ${g}, ${b}, 0.15)`,
    pillActive: `rgba(${r}, ${g}, ${b}, 0.92)`,
  };
}

function buildPaletteFromHue(hue: number, edgeHue = hue, topBandLuminance = 0.24): ArtworkPalette {
  const safeHue = ((Math.round(hue) % 360) + 360) % 360;
  const safeEdge = ((Math.round(edgeHue) % 360) + 360) % 360;
  const [vr, vg, vb] = hslToRgb(safeHue, 0.78, 0.58);
  const [er, eg, eb] = hslToRgb(safeEdge, 0.45, 0.18);
  const [ar, ag, ab] = hslToRgb(safeHue, 0.35, 0.08);
  const [pr, pg, pb] = hslToRgb(safeHue, 0.42, 0.24);
  const vibrantAccent = rgbToHex({ r: vr, g: vg, b: vb });
  const edgeOpaque = rgbToHex({ r: er, g: eg, b: eb });
  const ambientBackground = rgbToHex({ r: ar, g: ag, b: ab });
  const playerOpaque = rgbToHex({ r: pr, g: pg, b: pb });
  return {
    dominantHue: safeHue,
    vibrantAccent,
    edgeWash: `rgba(${er}, ${eg}, ${eb}, 0.55)`,
    ambientBackground,
    playerTint: `rgba(${pr}, ${pg}, ${pb}, 0.65)`,
    topBandLuminance,
    meshColors: [vibrantAccent, edgeOpaque, ambientBackground, playerOpaque],
  };
}

const PALETTE_CACHE_MAX = 120;
const paletteCache = new Map<string, ArtworkPalette>();

function setCachedThemePalette(key: string, palette: ArtworkPalette): void {
  if (paletteCache.has(key)) {
    paletteCache.delete(key);
  } else if (paletteCache.size >= PALETTE_CACHE_MAX) {
    const oldest = paletteCache.keys().next().value;
    if (oldest !== undefined) paletteCache.delete(oldest);
  }
  paletteCache.set(key, palette);
}

function cssColorToHex(color: string, fallbackHex: string): string {
  const tuple = parseColorToRgbTuple(color);
  return tuple ? rgbToHex({ r: tuple[0], g: tuple[1], b: tuple[2] }) : fallbackHex;
}

function cssColorToRgba(color: string, alpha: number, fallbackRgba: string): string {
  const tuple = parseColorToRgbTuple(color);
  return tuple ? `rgba(${tuple[0]}, ${tuple[1]}, ${tuple[2]}, ${alpha})` : fallbackRgba;
}

/**
 * Extracts a dynamic ArtworkPalette via shared OKLCH multi-peak extractor (IPC pixel bridge + CORS fallback),
 * falling back deterministically to seedHue when artwork is absent or fails to load.
 */
export async function extractArtworkPaletteFromUrl(
  imageUrl?: string | null,
  seedText = ''
): Promise<ArtworkPalette> {
  const trimmedUrl = typeof imageUrl === 'string' ? imageUrl.trim() : '';
  const key = trimmedUrl || seedText || 'default';
  const cached = paletteCache.get(key);
  if (cached) {
    paletteCache.delete(key);
    paletteCache.set(key, cached);
    return cached;
  }

  // Deterministic seed fallback based on URL/title characters
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  const seedHue = Math.abs(hash) % 360;
  const fallbackPalette = buildPaletteFromHue(seedHue, (seedHue + 28) % 360, 0.25);

  if (!trimmedUrl) {
    setCachedThemePalette(key, fallbackPalette);
    return fallbackPalette;
  }

  try {
    const extracted = await extractPaletteFromArtworkUrl(trimmedUrl);
    if (!extracted.isFallback) {
      const vibrantAccent = cssColorToHex(extracted.accentPrimary, fallbackPalette.vibrantAccent);
      const ambientBackground = cssColorToHex(extracted.bgDeep, fallbackPalette.ambientBackground);
      const bgMidHex = cssColorToHex(extracted.bgMid, ambientBackground);
      const secondaryHex = cssColorToHex(extracted.accentSecondary, vibrantAccent);
      const meshColors: [string, string, string, string] = extracted.meshColors
        ? [
            extracted.meshColors[0],
            extracted.meshColors[1],
            extracted.meshColors[2],
            extracted.meshColors[3],
          ]
        : [vibrantAccent, secondaryHex, ambientBackground, bgMidHex];

      const palette: ArtworkPalette = {
        dominantHue: ((Math.round(extracted.oklchH) % 360) + 360) % 360,
        vibrantAccent,
        edgeWash: cssColorToRgba(meshColors[1], 0.55, fallbackPalette.edgeWash),
        ambientBackground,
        playerTint: cssColorToRgba(extracted.bgMid, 0.65, fallbackPalette.playerTint),
        topBandLuminance: Number(Math.min(0.95, Math.max(0.05, extracted.oklchL * 0.45)).toFixed(3)),
        meshColors,
      };
      setCachedThemePalette(key, palette);
      return palette;
    }
  } catch {
    // Fall through to deterministic seed palette
  }

  setCachedThemePalette(key, fallbackPalette);
  return fallbackPalette;
}

interface ThemeState {
  mode: ThemeMode;
  tokens: ColorTokens;
  artworkPalette: ArtworkPalette | null;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
  setArtworkPalette: (palette: ArtworkPalette | null) => void;
}

let activeThemeSettings: Partial<AppSettings> = {
  'appearance.themeMode': 'dark',
  'appearance.accentColor': '#FA2D48',
  'appearance.accentColorMode': 'custom',
};
let attachedWindow: unknown = null;

function resolveEffectiveMode(modeSetting?: 'dark' | 'light' | 'system'): ThemeMode {
  if (modeSetting === 'light') return 'light';
  if (modeSetting === 'system' && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return 'dark';
}

function applyAccentTokensToRoot(
  accentColor: string,
  isLightMode: boolean
): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const { accent, hover, subtle, pillActive } = ensureReadableAccent(accentColor, isLightMode);
  root.style.setProperty('--color-accent', accent);
  root.style.setProperty('--am-brand-pink', accent);
  root.style.setProperty('--color-accent-hover', hover);
  root.style.setProperty('--color-accent-subtle', subtle);
  root.style.setProperty('--glass-pill-active', pillActive);
}

/**
 * Applies all appearance settings to document.documentElement in real time.
 */
export function applyThemeSettings(
  settings: Partial<AppSettings>,
  paletteOverride?: ArtworkPalette | null
): void {
  activeThemeSettings = { ...activeThemeSettings, ...settings };
  const resolvedMode = resolveEffectiveMode(activeThemeSettings['appearance.themeMode']);
  const isLightMode = resolvedMode === 'light';

  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    if (isLightMode) {
      root.classList.remove('dark');
      root.classList.add('light');
    } else {
      root.classList.remove('light');
      root.classList.add('dark');
    }

    const toggleClass = (cls: string, disabled: boolean | undefined) => {
      if (disabled) root.classList.add(cls);
      else root.classList.remove(cls);
    };

    toggleClass('no-acrylic-blur', activeThemeSettings['appearance.acrylicBlurEnabled'] === false);
    toggleClass('no-liquid-glass', activeThemeSettings['appearance.liquidGlassControls'] === false);
    toggleClass('no-dynamic-artwork', activeThemeSettings['appearance.dynamicArtworkColor'] === false);
    toggleClass('no-ambient-glow', activeThemeSettings['appearance.ambientBackdropGlow'] === false);
    toggleClass('compact-sidebar', activeThemeSettings['appearance.compactSidebar'] === true);

    if (typeof activeThemeSettings['appearance.acrylicBlurOpacity'] === 'number') {
      root.style.setProperty('--acrylic-opacity', String(activeThemeSettings['appearance.acrylicBlurOpacity']));
    }
    if (activeThemeSettings['appearance.fontFamily']) {
      root.style.setProperty(
        '--font-sans',
        `'${activeThemeSettings['appearance.fontFamily']}', 'Vazirmatn', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
      );
    }

    const palette = paletteOverride !== undefined ? paletteOverride : useThemeStore.getState().artworkPalette;
    const isDynamic =
      activeThemeSettings['appearance.accentColorMode'] === 'dynamic' ||
      activeThemeSettings['appearance.accentColor'] === 'dynamic';
    const rawAccent =
      isDynamic && palette?.vibrantAccent
        ? palette.vibrantAccent
        : activeThemeSettings['appearance.accentColor'] && activeThemeSettings['appearance.accentColor'] !== 'dynamic'
          ? activeThemeSettings['appearance.accentColor']
          : '#FA2D48';

    applyAccentTokensToRoot(rawAccent, isLightMode);
  }

  if (useThemeStore.getState().mode !== resolvedMode) {
    useThemeStore.setState({
      mode: resolvedMode,
      tokens: isLightMode ? LightThemeTokens : DarkThemeTokens,
    });
  }

  if (
    typeof window !== 'undefined' &&
    attachedWindow !== window &&
    typeof window.matchMedia === 'function'
  ) {
    attachedWindow = window;
    const mql = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      if (activeThemeSettings['appearance.themeMode'] === 'system') {
        applyThemeSettings(activeThemeSettings);
      }
    };
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
    }
  }
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: 'dark',
  tokens: DarkThemeTokens,
  artworkPalette: buildPaletteFromHue(350, 335, 0.22),
  setMode: (mode: ThemeMode) => {
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      if (mode === 'light') {
        root.classList.remove('dark');
        root.classList.add('light');
      } else {
        root.classList.remove('light');
        root.classList.add('dark');
      }
    }
    set({ mode, tokens: mode === 'light' ? LightThemeTokens : DarkThemeTokens });
  },
  toggleMode: () => {
    const nextMode = get().mode === 'dark' ? 'light' : 'dark';
    get().setMode(nextMode);
  },
  setArtworkPalette: (artworkPalette) => {
    if (typeof document !== 'undefined' && artworkPalette) {
      const root = document.documentElement;
      root.style.setProperty('--artwork-hue', String(artworkPalette.dominantHue));
      root.style.setProperty('--artwork-vibrant', artworkPalette.vibrantAccent);
      root.style.setProperty('--artwork-edge-wash', artworkPalette.edgeWash);
      root.style.setProperty('--artwork-ambient-bg', artworkPalette.ambientBackground);
      root.style.setProperty('--artwork-player-tint', artworkPalette.playerTint);

      const isDynamic =
        activeThemeSettings['appearance.accentColorMode'] === 'dynamic' ||
        activeThemeSettings['appearance.accentColor'] === 'dynamic';
      if (isDynamic) {
        applyAccentTokensToRoot(artworkPalette.vibrantAccent, get().mode === 'light');
      }
    }
    set({ artworkPalette });
  },
}));
