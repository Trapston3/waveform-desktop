// Core contracts, types, visual style definitions, bundled OFL fonts, and original demo track.

export type VisualStyleId =
  | 'AppleMusicFlow'
  | 'NeonKinetic'
  | 'TypewriterEditorial'
  | 'MinimalSwiss'
  | 'LiquidMetal'
  | 'HoloVaporwave'
  | 'KaraokeStage'
  | 'BrutalistZine'
  | 'GenerativeParticleInk'
  | 'SpectrumRibbon'
  | 'Spatial3DDepth'
  | 'CRTScanline'
  | 'StarfieldShip3D';

export interface VisualStyleDefinition {
  readonly id: VisualStyleId;
  readonly label: string;
  readonly description: string;
  readonly usesWebGl: boolean;
  readonly uses3D?: boolean;
}

export const VISUAL_STYLE_DEFINITIONS: readonly VisualStyleDefinition[] = [
  {
    id: 'AppleMusicFlow',
    label: 'Atmospheric Flow',
    description: 'Smooth spring-eased word illumination with atmospheric palette backdrop and depth falloff.',
    usesWebGl: false,
  },
  {
    id: 'NeonKinetic',
    label: 'Neon Kinetic',
    description: 'Electric synthwave typography with neon bloom trails and beat-reactive pulse.',
    usesWebGl: false,
  },
  {
    id: 'TypewriterEditorial',
    label: 'Typewriter Editorial',
    description: 'Literary serif spotlight with animated cursor, ink reveal, and warm editorial grid.',
    usesWebGl: false,
  },
  {
    id: 'MinimalSwiss',
    label: 'Minimal Swiss',
    description: 'Asymmetric Swiss modernist grid with tight grotesque type and crisp active bar.',
    usesWebGl: false,
  },
  {
    id: 'LiquidMetal',
    label: 'Liquid Metal',
    description: 'Specular chrome and iridescent fluid shader backdrop with reflective active words.',
    usesWebGl: true,
  },
  {
    id: 'HoloVaporwave',
    label: 'Holo Vaporwave',
    description: 'Perspective neon synth grid horizon with chromatic pastel scanlines.',
    usesWebGl: true,
  },
  {
    id: 'KaraokeStage',
    label: 'Karaoke Stage',
    description: 'High-contrast live stage bounce with word fill-wipe progress and upcoming preview.',
    usesWebGl: false,
  },
  {
    id: 'BrutalistZine',
    label: 'Brutalist Zine',
    description: 'Tilted poster cards, bold uppercase blocks, halftone dots, and knockout highlights.',
    usesWebGl: false,
  },
  {
    id: 'GenerativeParticleInk',
    label: 'Particle Ink',
    description: 'Audio-reactive ink droplets and glowing embers synchronized with word strikes.',
    usesWebGl: false,
  },
  {
    id: 'SpectrumRibbon',
    label: 'Spectrum Ribbon',
    description: 'Flowing multi-band FFT waveform ribbons driven by bass, mid, and treble energy.',
    usesWebGl: false,
  },
  {
    id: 'Spatial3DDepth',
    label: 'Spatial 3D Depth',
    description: 'Multi-plane Z-depth perspective camera with depth-of-field alpha and scale.',
    usesWebGl: false,
    uses3D: true,
  },
  {
    id: 'CRTScanline',
    label: 'CRT Scanline',
    description: 'Retro phosphor monitor vignette, subtle RGB mask, and glowing terminal lyrics.',
    usesWebGl: true,
  },
  {
    id: 'StarfieldShip3D',
    label: 'Starfield Ship 3D',
    description: 'Deep 3D parallax starfield with procedural starship banking to bass and beat.',
    usesWebGl: true,
    uses3D: true,
  },
] as const;

export type BundledFontId =
  | 'Inter'
  | 'PlusJakartaSans'
  | 'InstrumentSerif'
  | 'Fraunces'
  | 'SpaceGrotesk'
  | 'JetBrainsMono'
  | 'Outfit';

export interface BundledFontDefinition {
  readonly id: BundledFontId;
  readonly label: string;
  readonly cssFamily: string;
  readonly packageName: string;
  readonly license: 'OFL-1.1';
}

export const BUNDLED_FONTS: readonly BundledFontDefinition[] = [
  {
    id: 'Inter',
    label: 'Inter',
    cssFamily: 'Inter, sans-serif',
    packageName: '@fontsource/inter',
    license: 'OFL-1.1',
  },
  {
    id: 'PlusJakartaSans',
    label: 'Plus Jakarta Sans',
    cssFamily: '"Plus Jakarta Sans", sans-serif',
    packageName: '@fontsource/plus-jakarta-sans',
    license: 'OFL-1.1',
  },
  {
    id: 'InstrumentSerif',
    label: 'Instrument Serif',
    cssFamily: '"Instrument Serif", serif',
    packageName: '@fontsource/instrument-serif',
    license: 'OFL-1.1',
  },
  {
    id: 'Fraunces',
    label: 'Fraunces',
    cssFamily: 'Fraunces, serif',
    packageName: '@fontsource/fraunces',
    license: 'OFL-1.1',
  },
  {
    id: 'SpaceGrotesk',
    label: 'Space Grotesk',
    cssFamily: '"Space Grotesk", sans-serif',
    packageName: '@fontsource/space-grotesk',
    license: 'OFL-1.1',
  },
  {
    id: 'JetBrainsMono',
    label: 'JetBrains Mono',
    cssFamily: '"JetBrains Mono", monospace',
    packageName: '@fontsource/jetbrains-mono',
    license: 'OFL-1.1',
  },
  {
    id: 'Outfit',
    label: 'Outfit',
    cssFamily: 'Outfit, sans-serif',
    packageName: '@fontsource/outfit',
    license: 'OFL-1.1',
  },
] as const;

export type LyricsSourceKind =
  | 'WordSynced'
  | 'LineSynced'
  | 'Unsynced'
  | 'FallbackSynthesis';

export interface LyricWord {
  readonly text: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
}

export interface LyricLine {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly text: string;
  readonly words: readonly LyricWord[];
  readonly isSynthesizedWords: boolean;
}

export interface Lyrics {
  readonly providerName: string;
  readonly sourceKind: LyricsSourceKind;
  readonly lines: readonly LyricLine[];
  readonly copyrightNotice?: string;
}

export interface TrackParsedWordInput {
  readonly text: string;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
}

export interface TrackParsedLineInput {
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly text: string;
  readonly words?: readonly TrackParsedWordInput[];
}

export interface TrackInfo {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly album?: string;
  readonly durationSeconds: number;
  readonly artworkUrl?: string | null;
  readonly isrc?: string;
  readonly rawSyncedLyrics?: string | null;
  readonly parsedLyricsLines?: readonly TrackParsedLineInput[] | null;
}

export interface PlaybackSnapshot {
  readonly track: TrackInfo | null;
  readonly positionSeconds: number;
  readonly isPlaying: boolean;
  readonly playbackRate: number;
  readonly timestampMs: number;
  readonly didSeek?: boolean;
}

export interface AudioFrameMetrics {
  rmsLevel: number;
  bassEnergy: number;
  midEnergy: number;
  trebleEnergy: number;
  beatDetected: boolean;
}

export interface IPlaybackBridge {
  readonly currentSnapshot: PlaybackSnapshot;
  onTrackChanged(cb: (track: TrackInfo | null) => void): () => void;
  onPlaybackStateChanged(cb: (isPlaying: boolean) => void): () => void;
  onSeeked(cb: (positionSeconds: number) => void): () => void;
  sampleAudioMetrics(out?: AudioFrameMetrics): AudioFrameMetrics;
}

export interface ILyricsProvider {
  readonly name: string;
  readonly supportedGranularity: 'Word' | 'Line';
  getLyricsAsync(track: TrackInfo, signal?: AbortSignal): Promise<Lyrics | null>;
}

export interface LyricPalette {
  readonly bgDeep: string;
  readonly bgMid: string;
  readonly accentPrimary: string;
  readonly accentSecondary: string;
  readonly textActive: string;
  readonly textUpcoming: string;
  readonly textPassed: string;
  readonly oklchL: number;
  readonly oklchC: number;
  readonly oklchH: number;
  readonly isFallback: boolean;
}

export interface MeasuredWordLayout {
  readonly text: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly lineIndex: number;
  readonly wordIndex: number;
}

export interface MeasuredLineLayout {
  readonly lineIndex: number;
  readonly text: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly words: readonly MeasuredWordLayout[];
}

export interface LyricsLayout {
  readonly width: number;
  readonly height: number;
  readonly fontFamily: string;
  readonly fontSizePx: number;
  readonly lineHeightPx: number;
  readonly totalHeight: number;
  readonly lines: readonly MeasuredLineLayout[];
}

export interface StyleFrameContext {
  readonly lyrics: Lyrics | null;
  readonly layout: LyricsLayout | null;
  readonly timeSeconds: number;
  readonly deltaSeconds: number;
  readonly activeLineIndex: number;
  readonly activeWordIndex: number;
  readonly wordProgress: number;
  readonly lineFadeAlpha: number;
  readonly palette: LyricPalette;
  readonly audio: AudioFrameMetrics;
  readonly fontFamily: string;
  readonly fontSizeScale: number;
  readonly dpiScale: number;
  readonly reduceMotion: boolean;
  readonly isAmbientMode: boolean;
  readonly isOverlayMode?: boolean;
  readonly didSeekThisFrame: boolean;
}

export interface LyricVisualizerConfig {
  readonly styleId: VisualStyleId;
  readonly fontId: BundledFontId;
  readonly fontSizeScale: number;
  readonly albumArtColorMatch: boolean;
  readonly audioReactive: boolean;
  readonly reduceMotion: boolean;
  readonly overlayEnabled: boolean;
  readonly overlayMonitorIds: readonly string[];
  readonly overlayOpacity: number;
  readonly overlayLocked: boolean;
  readonly idleAmbientSeconds: number;
  readonly keepAwakeInAmbient: boolean;
  readonly gameGuardEnabled: boolean;
  readonly sandboxEnabled: boolean;
}

export const DEFAULT_LYRIC_VISUALIZER_CONFIG: LyricVisualizerConfig = {
  styleId: 'AppleMusicFlow',
  fontId: 'Inter',
  fontSizeScale: 1.0,
  albumArtColorMatch: true,
  audioReactive: true,
  reduceMotion: false,
  overlayEnabled: false,
  overlayMonitorIds: [],
  overlayOpacity: 0.9,
  overlayLocked: false,
  idleAmbientSeconds: 0,
  keepAwakeInAmbient: true,
  gameGuardEnabled: true,
  sandboxEnabled: false,
};

export function getBundledFontCssFamily(fontId: BundledFontId): string {
  const found = BUNDLED_FONTS.find((f) => f.id === fontId);
  return found ? found.cssFamily : BUNDLED_FONTS[0].cssFamily;
}

// Original public-domain Sandbox demo track ("Starlight Harbor" by "WaveForm Studio")
export const STARLIGHT_HARBOR_TRACK: TrackInfo = {
  id: 'sandbox-starlight-harbor',
  title: 'Starlight Harbor',
  artist: 'WaveForm Studio',
  album: 'Original Sandbox Sessions',
  durationSeconds: 42,
  artworkUrl: null,
};

export const STARLIGHT_HARBOR_LYRICS: Lyrics = {
  providerName: 'WaveForm Original Sandbox',
  sourceKind: 'WordSynced',
  copyrightNotice: 'Original public-domain demo composition by WaveForm Studio.',
  lines: [
    {
      startSeconds: 0.5,
      endSeconds: 5.0,
      text: 'Lanterns drift across the quiet tide',
      isSynthesizedWords: false,
      words: [
        { text: 'Lanterns', startSeconds: 0.5, endSeconds: 1.25 },
        { text: 'drift', startSeconds: 1.25, endSeconds: 1.9 },
        { text: 'across', startSeconds: 1.9, endSeconds: 2.65 },
        { text: 'the', startSeconds: 2.65, endSeconds: 3.15 },
        { text: 'quiet', startSeconds: 3.15, endSeconds: 4.05 },
        { text: 'tide', startSeconds: 4.05, endSeconds: 5.0 },
      ],
    },
    {
      startSeconds: 5.4,
      endSeconds: 10.2,
      text: 'Silver ripples hold the evening sky',
      isSynthesizedWords: false,
      words: [
        { text: 'Silver', startSeconds: 5.4, endSeconds: 6.2 },
        { text: 'ripples', startSeconds: 6.2, endSeconds: 7.05 },
        { text: 'hold', startSeconds: 7.05, endSeconds: 7.65 },
        { text: 'the', startSeconds: 7.65, endSeconds: 8.1 },
        { text: 'evening', startSeconds: 8.1, endSeconds: 9.15 },
        { text: 'sky', startSeconds: 9.15, endSeconds: 10.2 },
      ],
    },
    {
      startSeconds: 10.8,
      endSeconds: 15.8,
      text: 'Compass needles hum in amber glow',
      isSynthesizedWords: false,
      words: [
        { text: 'Compass', startSeconds: 10.8, endSeconds: 11.65 },
        { text: 'needles', startSeconds: 11.65, endSeconds: 12.5 },
        { text: 'hum', startSeconds: 12.5, endSeconds: 13.1 },
        { text: 'in', startSeconds: 13.1, endSeconds: 13.55 },
        { text: 'amber', startSeconds: 13.55, endSeconds: 14.6 },
        { text: 'glow', startSeconds: 14.6, endSeconds: 15.8 },
      ],
    },
    {
      startSeconds: 16.4,
      endSeconds: 21.6,
      text: 'Steady beacons guide the harbor home',
      isSynthesizedWords: false,
      words: [
        { text: 'Steady', startSeconds: 16.4, endSeconds: 17.25 },
        { text: 'beacons', startSeconds: 17.25, endSeconds: 18.2 },
        { text: 'guide', startSeconds: 18.2, endSeconds: 18.9 },
        { text: 'the', startSeconds: 18.9, endSeconds: 19.4 },
        { text: 'harbor', startSeconds: 19.4, endSeconds: 20.5 },
        { text: 'home', startSeconds: 20.5, endSeconds: 21.6 },
      ],
    },
    {
      startSeconds: 22.4,
      endSeconds: 27.6,
      text: 'Salt and cedar wake the midnight breeze',
      isSynthesizedWords: false,
      words: [
        { text: 'Salt', startSeconds: 22.4, endSeconds: 23.15 },
        { text: 'and', startSeconds: 23.15, endSeconds: 23.65 },
        { text: 'cedar', startSeconds: 23.65, endSeconds: 24.55 },
        { text: 'wake', startSeconds: 24.55, endSeconds: 25.25 },
        { text: 'the', startSeconds: 25.25, endSeconds: 25.7 },
        { text: 'midnight', startSeconds: 25.7, endSeconds: 26.65 },
        { text: 'breeze', startSeconds: 26.65, endSeconds: 27.6 },
      ],
    },
    {
      startSeconds: 28.2,
      endSeconds: 33.8,
      text: 'Constellations chart the open sea',
      isSynthesizedWords: false,
      words: [
        { text: 'Constellations', startSeconds: 28.2, endSeconds: 29.8 },
        { text: 'chart', startSeconds: 29.8, endSeconds: 30.65 },
        { text: 'the', startSeconds: 30.65, endSeconds: 31.2 },
        { text: 'open', startSeconds: 31.2, endSeconds: 32.35 },
        { text: 'sea', startSeconds: 32.35, endSeconds: 33.8 },
      ],
    },
    {
      startSeconds: 34.4,
      endSeconds: 40.5,
      text: 'Anchored softly under starlight',
      isSynthesizedWords: false,
      words: [
        { text: 'Anchored', startSeconds: 34.4, endSeconds: 35.85 },
        { text: 'softly', startSeconds: 35.85, endSeconds: 37.25 },
        { text: 'under', startSeconds: 37.25, endSeconds: 38.6 },
        { text: 'starlight', startSeconds: 38.6, endSeconds: 40.5 },
      ],
    },
  ],
};
