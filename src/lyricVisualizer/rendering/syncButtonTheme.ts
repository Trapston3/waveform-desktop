// Bespoke theme-adapted styling for the floating "Sync with Playback" button
// across Classic Lyrics view and all 12 consolidated LyricVisualizer styles.

import {
  resolveStyleVariationId,
  SF_PRO_DISPLAY_STACK,
  type LyricPalette,
  type VisualStyleId,
} from '../core/models';
import { DEMO_FALLBACK_PALETTE } from '../core/oklchPalette';

export interface SyncButtonTheme {
  readonly styleId: VisualStyleId | 'Classic';
  readonly variationId: string;
  readonly label: string;
  readonly background: string;
  readonly border: string;
  readonly borderColor: string;
  readonly textColor: string;
  readonly accentColor: string;
  readonly dotColor: string;
  readonly boxShadow: string;
  readonly backdropFilter: string;
  readonly borderRadius: string;
  readonly fontFamily: string;
  readonly fontSize: string;
  readonly fontWeight: number;
  readonly letterSpacing: string;
  readonly textTransform: 'none' | 'uppercase' | 'lowercase';
  readonly padding: string;
  readonly showDot: boolean;
  readonly style: {
    readonly background: string;
    readonly border: string;
    readonly color: string;
    readonly boxShadow: string;
    readonly backdropFilter: string;
    readonly WebkitBackdropFilter: string;
    readonly borderRadius: string;
    readonly fontFamily: string;
    readonly fontSize: string;
    readonly fontWeight: number;
    readonly letterSpacing: string;
    readonly textTransform: 'none' | 'uppercase' | 'lowercase';
    readonly padding: string;
  };
}

function buildTheme(spec: Omit<SyncButtonTheme, 'style'>): SyncButtonTheme {
  return {
    ...spec,
    style: {
      background: spec.background,
      border: spec.border,
      color: spec.textColor,
      boxShadow: spec.boxShadow,
      backdropFilter: spec.backdropFilter,
      WebkitBackdropFilter: spec.backdropFilter,
      borderRadius: spec.borderRadius,
      fontFamily: spec.fontFamily,
      fontSize: spec.fontSize,
      fontWeight: spec.fontWeight,
      letterSpacing: spec.letterSpacing,
      textTransform: spec.textTransform,
      padding: spec.padding,
    },
  };
}

export function getSyncButtonTheme(
  styleId: VisualStyleId | 'Classic' | string,
  variationId?: string,
  palette?: Partial<LyricPalette> | { vibrantAccent?: string } | null
): SyncButtonTheme {
  const accent =
    (palette as LyricPalette | undefined)?.accentPrimary ||
    (palette as { vibrantAccent?: string } | undefined)?.vibrantAccent ||
    DEMO_FALLBACK_PALETTE.accentPrimary;
  const accentSecondary =
    (palette as LyricPalette | undefined)?.accentSecondary ||
    DEMO_FALLBACK_PALETTE.accentSecondary;

  if (styleId === 'Classic') {
    return buildTheme({
      styleId: 'Classic',
      variationId: variationId || 'liquid-glass',
      label: 'Sync with Playback',
      background: 'linear-gradient(135deg, rgba(24, 26, 34, 0.72), rgba(12, 14, 20, 0.84))',
      border: '1px solid rgba(255, 255, 255, 0.22)',
      borderColor: 'rgba(255, 255, 255, 0.22)',
      textColor: '#f8fafc',
      accentColor: accent,
      dotColor: accent,
      boxShadow: '0 12px 32px rgba(0, 0, 0, 0.48), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
      backdropFilter: 'blur(20px) saturate(160%)',
      borderRadius: '9999px',
      fontFamily: SF_PRO_DISPLAY_STACK,
      fontSize: '12px',
      fontWeight: 600,
      letterSpacing: '0.01em',
      textTransform: 'none',
      padding: '8px 16px',
      showDot: true,
    });
  }

  const resolvedVar =
    variationId || resolveStyleVariationId(styleId, undefined);

  switch (styleId) {
    case 'CodeEditorKinetic':
      return buildTheme({
        styleId: 'CodeEditorKinetic',
        variationId: resolvedVar,
        label: '● sync.playback()',
        background: 'rgba(10, 12, 18, 0.94)',
        border: '1px solid rgba(255, 46, 59, 0.55)',
        borderColor: 'rgba(255, 46, 59, 0.55)',
        textColor: '#e6edf3',
        accentColor: '#ff2e3b',
        dotColor: '#ff2e3b',
        boxShadow: '0 8px 26px rgba(0, 0, 0, 0.72), 0 0 14px rgba(255, 46, 59, 0.22)',
        backdropFilter: 'blur(12px)',
        borderRadius: '6px',
        fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
        fontSize: '12px',
        fontWeight: 600,
        letterSpacing: '0.02em',
        textTransform: 'none',
        padding: '7px 14px',
        showDot: false,
      });

    case 'CRTScanline': {
      const isAmber = resolvedVar === 'p3-amber';
      const isTrinitron = resolvedVar === 'trinitron-rgb';
      const crtColor = isAmber ? '#fbbf24' : isTrinitron ? accent : '#34d399';
      return buildTheme({
        styleId: 'CRTScanline',
        variationId: resolvedVar,
        label: '[ SYNC_PLAYBACK ]',
        background: 'rgba(3, 7, 6, 0.94)',
        border: `1px solid ${crtColor}`,
        borderColor: crtColor,
        textColor: crtColor,
        accentColor: crtColor,
        dotColor: crtColor,
        boxShadow: `0 0 18px rgba(0, 0, 0, 0.85), inset 0 0 10px rgba(52, 211, 153, 0.14)`,
        backdropFilter: 'none',
        borderRadius: '2px',
        fontFamily: '"JetBrains Mono", Consolas, monospace',
        fontSize: '11px',
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        padding: '7px 14px',
        showDot: false,
      });
    }

    case 'BrutalistZine': {
      const isXerox = resolvedVar === 'xerox-contrast';
      const fillBg = isXerox ? '#f8fafc' : accent;
      return buildTheme({
        styleId: 'BrutalistZine',
        variationId: resolvedVar,
        label: 'SYNC LIVE ↗',
        background: fillBg,
        border: '2px solid #090a0d',
        borderColor: '#090a0d',
        textColor: '#07080b',
        accentColor: '#07080b',
        dotColor: '#07080b',
        boxShadow: '4px 4px 0px #07080b',
        backdropFilter: 'none',
        borderRadius: '0px',
        fontFamily: '"Space Grotesk", Inter, sans-serif',
        fontSize: '11px',
        fontWeight: 800,
        letterSpacing: '0.09em',
        textTransform: 'uppercase',
        padding: '7px 14px',
        showDot: false,
      });
    }

    case 'StarfieldShip3D':
      return buildTheme({
        styleId: 'StarfieldShip3D',
        variationId: resolvedVar,
        label: '[ HUD // RESYNC ]',
        background: 'rgba(7, 13, 25, 0.86)',
        border: `1px solid ${accent}`,
        borderColor: accent,
        textColor: '#e0f2fe',
        accentColor: accent,
        dotColor: '#38bdf8',
        boxShadow: '0 8px 28px rgba(0, 0, 0, 0.65), inset 0 0 12px rgba(56, 189, 248, 0.18)',
        backdropFilter: 'blur(14px)',
        borderRadius: '4px',
        fontFamily: '"JetBrains Mono", "Space Grotesk", monospace',
        fontSize: '11px',
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        padding: '7px 15px',
        showDot: true,
      });

    case 'FisheyeKinetic':
      return buildTheme({
        styleId: 'FisheyeKinetic',
        variationId: resolvedVar,
        label: 'Resync Stack',
        background: accent,
        border: '1px solid rgba(255, 255, 255, 0.28)',
        borderColor: 'rgba(255, 255, 255, 0.28)',
        textColor: '#ffffff',
        accentColor: '#ffffff',
        dotColor: '#ffffff',
        boxShadow: '0 10px 26px rgba(0, 0, 0, 0.62)',
        backdropFilter: 'blur(12px)',
        borderRadius: '10px',
        fontFamily: SF_PRO_DISPLAY_STACK,
        fontSize: '12px',
        fontWeight: 800,
        letterSpacing: '0.02em',
        textTransform: 'none',
        padding: '7px 16px',
        showDot: false,
      });

    case 'MotionGeometry':
      return buildTheme({
        styleId: 'MotionGeometry',
        variationId: resolvedVar,
        label: '✦ Resume Orbit',
        background: 'rgba(6, 10, 22, 0.88)',
        border: `1px solid ${accent}`,
        borderColor: accent,
        textColor: '#e2e8f0',
        accentColor: accent,
        dotColor: accentSecondary,
        boxShadow: '0 8px 26px rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(14px)',
        borderRadius: '9999px',
        fontFamily: SF_PRO_DISPLAY_STACK,
        fontSize: '12px',
        fontWeight: 600,
        letterSpacing: '0.02em',
        textTransform: 'none',
        padding: '7px 15px',
        showDot: true,
      });

    case 'IosTextingMotion': {
      const isGreen = resolvedVar === 'classic-sms';
      const isGlass = resolvedVar === 'liquid-glass';
      const bubbleBg = isGlass
        ? 'rgba(26, 30, 42, 0.78)'
        : isGreen
        ? '#30D158'
        : '#0A84FF';
      return buildTheme({
        styleId: 'IosTextingMotion',
        variationId: resolvedVar,
        label: '↓ Jump to Latest Message',
        background: bubbleBg,
        border: isGlass
          ? '1px solid rgba(255, 255, 255, 0.28)'
          : '1px solid rgba(255, 255, 255, 0.18)',
        borderColor: 'rgba(255, 255, 255, 0.24)',
        textColor: '#ffffff',
        accentColor: '#ffffff',
        dotColor: '#ffffff',
        boxShadow: '0 10px 26px rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(18px)',
        borderRadius: '9999px',
        fontFamily: SF_PRO_DISPLAY_STACK,
        fontSize: '12px',
        fontWeight: 600,
        letterSpacing: '-0.01em',
        textTransform: 'none',
        padding: '8px 16px',
        showDot: false,
      });
    }

    case 'TypewriterEditorial':
      return buildTheme({
        styleId: 'TypewriterEditorial',
        variationId: resolvedVar,
        label: '§ Resume Manuscript',
        background:
          resolvedVar === 'warm-ink'
            ? 'rgba(28, 23, 18, 0.92)'
            : 'rgba(15, 18, 25, 0.92)',
        border: `1px solid ${accent}`,
        borderColor: accent,
        textColor: '#f8fafc',
        accentColor: accent,
        dotColor: accent,
        boxShadow: '0 10px 28px rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(12px)',
        borderRadius: '4px',
        fontFamily: '"Instrument Serif", Fraunces, Georgia, serif',
        fontSize: '14px',
        fontWeight: 500,
        letterSpacing: '0.03em',
        textTransform: 'none',
        padding: '6px 16px',
        showDot: false,
      });

    case 'MinimalSwiss':
      return buildTheme({
        styleId: 'MinimalSwiss',
        variationId: resolvedVar,
        label: '00 // SYNC PLAYBACK',
        background: 'rgba(9, 11, 15, 0.94)',
        border: '1px solid rgba(255, 255, 255, 0.4)',
        borderColor: 'rgba(255, 255, 255, 0.4)',
        textColor: '#ffffff',
        accentColor: accent,
        dotColor: accent,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(10px)',
        borderRadius: '0px',
        fontFamily: '"Space Grotesk", Inter, sans-serif',
        fontSize: '11px',
        fontWeight: 700,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        padding: '7px 14px',
        showDot: true,
      });

    case 'LiquidMetal': {
      const isHolo = resolvedVar === 'holo-vaporwave';
      return buildTheme({
        styleId: 'LiquidMetal',
        variationId: resolvedVar,
        label: isHolo ? '◈ RESYNC SYNTH' : '◈ Sync Playback',
        background: isHolo
          ? 'linear-gradient(135deg, rgba(16, 8, 36, 0.88), rgba(32, 12, 58, 0.88))'
          : 'linear-gradient(135deg, rgba(18, 22, 32, 0.9), rgba(9, 11, 17, 0.94))',
        border: isHolo
          ? '1px solid rgba(0, 229, 255, 0.55)'
          : '1px solid rgba(226, 232, 240, 0.35)',
        borderColor: isHolo ? '#00e5ff' : '#cbd5e1',
        textColor: '#f8fafc',
        accentColor: isHolo ? '#00e5ff' : '#e2e8f0',
        dotColor: isHolo ? '#ff2a94' : accent,
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.25)',
        backdropFilter: 'blur(18px)',
        borderRadius: '9999px',
        fontFamily: SF_PRO_DISPLAY_STACK,
        fontSize: '12px',
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: isHolo ? 'uppercase' : 'none',
        padding: '8px 16px',
        showDot: false,
      });
    }

    case 'KaraokeStage':
      return buildTheme({
        styleId: 'KaraokeStage',
        variationId: resolvedVar,
        label: '★ Sync Stage Cue',
        background: 'rgba(14, 16, 26, 0.9)',
        border: `1.5px solid ${accent}`,
        borderColor: accent,
        textColor: '#ffffff',
        accentColor: accent,
        dotColor: accentSecondary,
        boxShadow: '0 10px 28px rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(16px)',
        borderRadius: '9999px',
        fontFamily: 'Outfit, "Plus Jakarta Sans", sans-serif',
        fontSize: '12px',
        fontWeight: 700,
        letterSpacing: '0.03em',
        textTransform: 'none',
        padding: '8px 16px',
        showDot: false,
      });

    case 'GenerativeParticleInk':
      return buildTheme({
        styleId: 'GenerativeParticleInk',
        variationId: resolvedVar,
        label:
          resolvedVar === 'spectrum-ribbon'
            ? '∿ Sync Wave Ribbon'
            : '✦ Sync Ink Flow',
        background: 'rgba(11, 14, 22, 0.86)',
        border: '1px solid rgba(255, 255, 255, 0.22)',
        borderColor: 'rgba(255, 255, 255, 0.22)',
        textColor: '#f8fafc',
        accentColor: accent,
        dotColor: accent,
        boxShadow: '0 10px 28px rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(18px)',
        borderRadius: '9999px',
        fontFamily: SF_PRO_DISPLAY_STACK,
        fontSize: '12px',
        fontWeight: 600,
        letterSpacing: '0.02em',
        textTransform: 'none',
        padding: '8px 16px',
        showDot: true,
      });

    case 'Spatial3DDepth':
      return buildTheme({
        styleId: 'Spatial3DDepth',
        variationId: resolvedVar,
        label: '◎ Lock Focal Plane',
        background: 'rgba(10, 14, 24, 0.84)',
        border: '1px solid rgba(255, 255, 255, 0.24)',
        borderColor: 'rgba(255, 255, 255, 0.24)',
        textColor: '#f8fafc',
        accentColor: accent,
        dotColor: accent,
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.62), inset 0 1px 0 rgba(255, 255, 255, 0.18)',
        backdropFilter: 'blur(20px)',
        borderRadius: '12px',
        fontFamily: SF_PRO_DISPLAY_STACK,
        fontSize: '12px',
        fontWeight: 600,
        letterSpacing: '0.03em',
        textTransform: 'none',
        padding: '8px 16px',
        showDot: false,
      });

    case 'AppleMusicFlow':
    default:
      return buildTheme({
        styleId: 'AppleMusicFlow',
        variationId: resolvedVar,
        label: 'Sync with Playback',
        background: 'linear-gradient(135deg, rgba(24, 28, 38, 0.76), rgba(12, 15, 22, 0.88))',
        border: '1px solid rgba(255, 255, 255, 0.22)',
        borderColor: 'rgba(255, 255, 255, 0.22)',
        textColor: '#f8fafc',
        accentColor: accent,
        dotColor: accent,
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
        backdropFilter: 'blur(20px) saturate(160%)',
        borderRadius: '9999px',
        fontFamily: SF_PRO_DISPLAY_STACK,
        fontSize: '12px',
        fontWeight: 600,
        letterSpacing: '0.01em',
        textTransform: 'none',
        padding: '8px 16px',
        showDot: true,
      });
  }
}
