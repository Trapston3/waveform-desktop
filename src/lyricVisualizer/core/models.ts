// Core contracts, types, visual style definitions, bundled OFL fonts, and original demo track.

export type VisualStyleId =
  | 'AppleMusicFlow'
  | 'TypewriterEditorial'
  | 'MinimalSwiss'
  | 'LiquidMetal'
  | 'KaraokeStage'
  | 'BrutalistZine'
  | 'GenerativeParticleInk'
  | 'Spatial3DDepth'
  | 'CRTScanline'
  | 'StarfieldShip3D'
  | 'IosTextingMotion'
  | 'CodeEditorKinetic';

export interface StyleVariationDefinition {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

export interface VisualStyleDefinition {
  readonly id: VisualStyleId;
  readonly label: string;
  readonly description: string;
  readonly usesWebGl: boolean;
  readonly uses3D?: boolean;
  readonly defaultVariationId: string;
  readonly variations: readonly StyleVariationDefinition[];
}

export const VISUAL_STYLE_DEFINITIONS: readonly VisualStyleDefinition[] = [
  {
    id: 'AppleMusicFlow',
    label: 'Atmospheric Flow',
    description: 'Smooth spring-eased word illumination with atmospheric palette backdrop and depth falloff.',
    usesWebGl: false,
    defaultVariationId: 'silk-glow',
    variations: [
      { id: 'silk-glow', label: 'Silk Glow', description: 'Soft ambient bloom with liquid word sweep' },
      { id: 'editorial-crisp', label: 'Editorial Crisp', description: 'High-contrast razor focus without bloom' },
    ],
  },
  {
    id: 'TypewriterEditorial',
    label: 'Typewriter Editorial',
    description: 'Literary serif spotlight with animated cursor, ink reveal, and warm editorial grid.',
    usesWebGl: false,
    defaultVariationId: 'dark-slate',
    variations: [
      { id: 'dark-slate', label: 'Dark Slate', description: 'Deep obsidian literary manuscript page' },
      { id: 'warm-ink', label: 'Warm Ink', description: 'Warm charcoal paper with amber ink rule' },
    ],
  },
  {
    id: 'MinimalSwiss',
    label: 'Minimal Swiss',
    description: 'Asymmetric Swiss modernist grid with tight grotesque type and crisp active bar.',
    usesWebGl: false,
    defaultVariationId: 'international-grid',
    variations: [
      { id: 'international-grid', label: 'International Grid', description: 'Josef Müller-Brockmann hairlines and timecode column' },
      { id: 'editorial-bold', label: 'Editorial Bold', description: 'Oversized display weight with minimal grid framing' },
    ],
  },
  {
    id: 'LiquidMetal',
    label: 'Liquid Metal',
    description: 'Specular obsidian chrome, iridescent vaporwave synth grid, and album-tinted mercury shaders.',
    usesWebGl: true,
    defaultVariationId: 'obsidian-chrome',
    variations: [
      { id: 'obsidian-chrome', label: 'Obsidian Chrome', description: 'Deep obsidian base with crisp liquid silver specular ridges' },
      { id: 'holo-vaporwave', label: 'Holo Vaporwave', description: 'Midnight synthwave horizon grid with cyan/magenta holographic sheen' },
      { id: 'mercury-album-tint', label: 'Mercury Album Tint', description: 'Liquid metallic ridges infused with live album artwork hues' },
    ],
  },
  {
    id: 'KaraokeStage',
    label: 'Karaoke Stage',
    description: 'High-contrast live stage bounce with word fill-wipe progress and upcoming preview.',
    usesWebGl: false,
    defaultVariationId: 'concert-gold',
    variations: [
      { id: 'concert-gold', label: 'Concert Gold', description: 'Warm spotlight stage with crisp word wipe' },
      { id: 'club-neon', label: 'Club Neon', description: 'Electric cyan/magenta duet stage pulse' },
    ],
  },
  {
    id: 'BrutalistZine',
    label: 'Brutalist Zine',
    description: 'Tilted poster cards, bold uppercase blocks, newsprint halftone dots, and knockout highlights.',
    usesWebGl: false,
    defaultVariationId: 'newsprint-cutout',
    variations: [
      { id: 'newsprint-cutout', label: 'Newsprint Cutout', description: 'High-contrast ink cards, masking tape, and halftone grain' },
      { id: 'xerox-contrast', label: 'Xerox Contrast', description: 'Stark monochrome photocopy zine with razor borders' },
      { id: 'accent-risograph', label: 'Accent Risograph', description: 'Dual-tone album risograph ink over dark newsprint' },
    ],
  },
  {
    id: 'GenerativeParticleInk',
    label: 'Particle Ink & Ribbons',
    description: 'Audio-reactive calligraphic ink droplets and multi-band FFT spectrum ribbons.',
    usesWebGl: false,
    defaultVariationId: 'pure-ink',
    variations: [
      { id: 'pure-ink', label: 'Pure Ink', description: 'Organic calligraphic ink bursts and word-strike embers' },
      { id: 'spectrum-ribbon', label: 'Spectrum Ribbon', description: 'Multi-layered 3-band glowing FFT waveform ribbons' },
      { id: 'ink-ribbon-hybrid', label: 'Ink + Ribbon Hybrid', description: 'Combined FFT ribbons with reactive ink particle bursts' },
    ],
  },
  {
    id: 'Spatial3DDepth',
    label: 'Spatial 3D Depth',
    description: 'Multi-plane Z-depth perspective camera with volumetric rings and depth-of-field scale.',
    usesWebGl: false,
    uses3D: true,
    defaultVariationId: 'depth-rings',
    variations: [
      { id: 'depth-rings', label: 'Depth Rings', description: 'Concentric perspective portal rings with Z-extruded focal lyrics' },
      { id: 'glass-planes', label: 'Glass Planes', description: 'Translucent dark glass depth cards receding in 3D space' },
      { id: 'horizon-grid', label: 'Horizon Grid', description: 'Perspective floor and ceiling depth rails with reflective glow' },
    ],
  },
  {
    id: 'CRTScanline',
    label: 'CRT Scanline',
    description: 'Deep phosphor CRT glass monitor with curved barrel vignette, scanlines, and RGB subpixel mask.',
    usesWebGl: true,
    defaultVariationId: 'p31-green',
    variations: [
      { id: 'p31-green', label: 'P31 Phosphor Green', description: 'Classic monochrome green terminal phosphor on deep black glass' },
      { id: 'p3-amber', label: 'P3 Amber Monitor', description: 'Warm vintage amber CRT phosphor glow' },
      { id: 'trinitron-rgb', label: 'Trinitron RGB', description: 'Aperture-grille chromatic RGB subpixel separation with album tint' },
    ],
  },
  {
    id: 'StarfieldShip3D',
    label: 'Starfield Ship 3D',
    description: '3D starfighter weaving through procedural asteroids with BPM cruise and beat warp surges.',
    usesWebGl: true,
    uses3D: true,
    defaultVariationId: 'deep-space',
    variations: [
      { id: 'deep-space', label: 'Deep Space', description: 'Tactical interceptor banking through asteroid corridor' },
      { id: 'nebula-run', label: 'Nebula Run', description: 'Album-tinted cosmic nebula clouds and plasma exhaust' },
      { id: 'retro-wireframe', label: 'Retro Wireframe', description: 'Vector arcade wireframe starfighter and faceted asteroids' },
    ],
  },
  {
    id: 'IosTextingMotion',
    label: 'iOS Messages',
    description: 'Synced iOS message thread with glossy Tapbacks, Magic Word kinetic effects, and rich cards.',
    usesWebGl: false,
    defaultVariationId: 'ios-dark',
    variations: [
      { id: 'ios-dark', label: 'iOS Dark', description: 'Authentic dark iMessage blue and graphite thread' },
      { id: 'liquid-glass', label: 'Liquid Glass', description: 'Frosted translucent glass bubbles with specular rim highlights' },
      { id: 'cinema-edit', label: 'Cinema Edit', description: 'Letterboxed kinetic edit with dramatic focal zoom' },
      { id: 'classic-sms', label: 'Classic SMS Green', description: 'iMessage blue paired with classic SMS green replies' },
    ],
  },
  {
    id: 'CodeEditorKinetic',
    label: 'Code Editor Kinetic',
    description: 'Macro-camera dark IDE where lyrics compile live as expressive JavaScript with collaborator cursors.',
    usesWebGl: false,
    uses3D: true,
    defaultVariationId: 'ide-macro',
    variations: [
      { id: 'ide-macro', label: 'IDE Macro', description: '3D macro camera tracking live syntax tokens and crimson block cursor' },
      { id: 'led-stage-matrix', label: 'LED Stage Matrix', description: 'Concert LED dot-matrix glow over live code tokens' },
      { id: 'clockwork-orbit', label: 'Clockwork Orbit', description: 'BPM-locked geometric timing rings rotating behind syntax' },
      { id: 'clean-dark-ide', label: 'Clean Dark IDE', description: 'Razor-sharp flat obsidian code editor without camera tilt' },
    ],
  },
] as const;

export function getStyleDefinition(id: VisualStyleId | string): VisualStyleDefinition {
  const mappedId =
    id === 'HoloVaporwave'
      ? 'LiquidMetal'
      : id === 'SpectrumRibbon'
      ? 'GenerativeParticleInk'
      : id === 'NeonKinetic'
      ? 'AppleMusicFlow'
      : id;
  const found = VISUAL_STYLE_DEFINITIONS.find((s) => s.id === mappedId);
  return found ?? VISUAL_STYLE_DEFINITIONS[0];
}

export function resolveStyleVariationId(
  styleId: VisualStyleId | string,
  variationByStyle?: Partial<Record<VisualStyleId, string>> | Record<string, string | undefined> | null
): string {
  const def = getStyleDefinition(styleId);
  const rawCandidate =
    variationByStyle && typeof variationByStyle === 'object'
      ? (variationByStyle as Record<string, string | undefined>)[def.id] ??
        (variationByStyle as Record<string, string | undefined>)[styleId]
      : undefined;
  if (rawCandidate && def.variations.some((v) => v.id === rawCandidate)) {
    return rawCandidate;
  }
  if (styleId === 'HoloVaporwave' && def.variations.some((v) => v.id === 'holo-vaporwave')) {
    return 'holo-vaporwave';
  }
  if (styleId === 'SpectrumRibbon' && def.variations.some((v) => v.id === 'spectrum-ribbon')) {
    return 'spectrum-ribbon';
  }
  return def.defaultVariationId;
}

export const SF_PRO_DISPLAY_STACK = "'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif";

export type BundledFontId =
  | 'SFProDisplay'
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
  readonly license: 'OFL-1.1' | 'Bundled';
}

export const BUNDLED_FONTS: readonly BundledFontDefinition[] = [
  {
    id: 'SFProDisplay',
    label: 'SF Pro Display',
    cssFamily: SF_PRO_DISPLAY_STACK,
    packageName: 'bundled/sf-pro-display',
    license: 'Bundled',
  },
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

export type LyricsScriptMode =
  | 'auto'
  | 'original'
  | 'romanized'
  | 'romanized_translation'
  | 'original_translation';

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
  readonly romanizedText?: string;
  readonly romanizedWords?: readonly LyricWord[];
  readonly translatedText?: string;
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
  readonly romanizedText?: string;
  readonly romanizedWords?: readonly TrackParsedWordInput[];
  readonly translatedText?: string;
}

export interface TrackInfo {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly album?: string;
  readonly year?: string;
  readonly bpm?: number;
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
  isDownbeat?: boolean;
  estimatedBpm?: number;
  beatStrength?: number;
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
  readonly meshColors?: readonly [string, string, string, string];
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
  readonly secondaryText?: string | null;
  readonly isRomanized?: boolean;
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

export type MotionIntensity = 'subtle' | 'normal' | 'vivid';
export type NowPlayingLayoutMode = 'split' | 'lyrics-focus' | 'artwork-focus' | 'ambient';
export type LyricTextAlign = 'center' | 'left';

export function normalizeNowPlayingLayout(val: unknown): NowPlayingLayoutMode {
  if (val === 'centered' || val === 'lyrics-focus') return 'lyrics-focus';
  if (val === 'artwork-focus') return 'artwork-focus';
  if (val === 'ambient') return 'ambient';
  return 'split';
}

export interface StyleTrackMetadata {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly year?: string;
  readonly bpm?: number;
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
  readonly isEmbeddedTransparent?: boolean;
  readonly hasWebGlBackdrop?: boolean;
  readonly contentInsetLeft?: number;
  readonly motionIntensity?: MotionIntensity;
  readonly didSeekThisFrame: boolean;
  readonly variationId: string;
  readonly manualScrollY: number;
  readonly isFollowingPlayback: boolean;
  readonly hoveredLineIndex: number;
  readonly backgroundOpacity: number;
  readonly vignetteStrength: number;
  readonly textAlign: LyricTextAlign;
  readonly trackMetadata: StyleTrackMetadata | null;
  readonly scriptMode?: LyricsScriptMode;
  readonly isInstrumentalGap?: boolean;
  readonly gapProgress?: number;
  readonly timeUntilNextLine?: number;
  readonly hasLyrics?: boolean;
  readonly lastActiveLineIndex?: number;
  readonly nextLineIndex?: number;
  readonly recordHitRect: (
    lineIndex: number,
    x: number,
    y: number,
    width: number,
    height: number
  ) => void;
}

export interface LyricVisualizerConfig {
  readonly styleId: VisualStyleId;
  readonly variationByStyle: Partial<Record<VisualStyleId, string>>;
  readonly fontId: BundledFontId;
  readonly fontSizeScale: number;
  readonly albumArtColorMatch: boolean;
  readonly audioReactive: boolean;
  readonly reduceMotion: boolean;
  readonly motionIntensity?: MotionIntensity;
  readonly backgroundOpacity: number;
  readonly vignetteStrength: number;
  readonly textAlign: LyricTextAlign;
  readonly nowPlayingLayout: NowPlayingLayoutMode;
  readonly hideAlbumCover: boolean;
  readonly scriptMode: LyricsScriptMode;
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
  variationByStyle: {},
  fontId: 'SFProDisplay',
  fontSizeScale: 1.0,
  albumArtColorMatch: true,
  audioReactive: true,
  reduceMotion: false,
  motionIntensity: 'normal',
  backgroundOpacity: 0.95,
  vignetteStrength: 0.55,
  textAlign: 'center',
  nowPlayingLayout: 'split',
  hideAlbumCover: false,
  scriptMode: 'auto',
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
