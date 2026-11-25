// src/ui/common/VisualizerContextMenu.tsx
// Glassmorphic right-click context menu for Lyric Visualizer & Now Playing lyrics stages.
// Viewport-clamped with flipSubmenuLeft, Escape/outside-click close, and cascading submenus.

import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlignCenter,
  AlignLeft,
  Check,
  ChevronRight,
  Clock,
  Disc,
  Eye,
  Languages,
  Layout,
  Maximize2,
  Monitor,
  Palette,
  RotateCcw,
  Sliders,
  Sparkles,
  Type,
  Wand2,
} from 'lucide-react';
import {
  BUNDLED_FONTS,
  type BundledFontId,
  getBundledFontCssFamily,
  type LyricsScriptMode,
  type LyricTextAlign,
  normalizeNowPlayingLayout,
  type NowPlayingLayoutMode,
  resolveStyleVariationId,
  VISUAL_STYLE_DEFINITIONS,
  type VisualStyleId,
} from '../../lyricVisualizer/core';
import {
  MAX_BACKGROUND_OPACITY,
  MAX_FONT_SIZE_SCALE,
  MAX_VIGNETTE_STRENGTH,
  MIN_BACKGROUND_OPACITY,
  MIN_FONT_SIZE_SCALE,
  MIN_VIGNETTE_STRENGTH,
  type MotionIntensity,
  useLyricVisualizerStore,
} from '../../lyricVisualizer/state/lyricVisualizerStore';
import { MlAudioService } from '../../services/MlAudioService';
import { usePlayerStore } from '../../state/playerStore';

export interface VisualizerContextMenuProps {
  isOpen: boolean;
  x: number;
  y: number;
  onClose: () => void;
  isFullBleed?: boolean;
  onToggleFullBleed?: () => void;
  context?: 'now-playing' | 'ambient' | 'overlay';
}

type SubmenuId = 'none' | 'styles' | 'appearance' | 'script' | 'sync';

const SCRIPT_MODE_OPTIONS: readonly {
  id: LyricsScriptMode;
  label: string;
  shortLabel: string;
  description: string;
}[] = [
  {
    id: 'auto',
    label: 'Auto (Romanize for Code)',
    shortLabel: 'Auto',
    description: 'Original script in lyric styles; Romanized in Code Editor',
  },
  {
    id: 'original',
    label: 'Original',
    shortLabel: 'Original',
    description: 'Display original lyric script only',
  },
  {
    id: 'romanized',
    label: 'Romanized',
    shortLabel: 'Romanized',
    description: 'Transliterate non-Latin lyrics into Latin script',
  },
  {
    id: 'romanized_translation',
    label: 'Romanized + Translation',
    shortLabel: 'Rom + Trans',
    description: 'Romanized pronunciation with translated subtitle',
  },
  {
    id: 'original_translation',
    label: 'Original + Translation',
    shortLabel: 'Orig + Trans',
    description: 'Original script with translated subtitle',
  },
];

const SIZE_PRESETS: readonly { label: string; value: number }[] = [
  { label: '0.8x', value: 0.8 },
  { label: '1.0x', value: 1.0 },
  { label: '1.2x', value: 1.2 },
  { label: '1.4x', value: 1.4 },
  { label: '1.6x', value: 1.6 },
];

const MOTION_INTENSITY_OPTIONS: readonly { id: MotionIntensity; label: string }[] = [
  { id: 'subtle', label: 'Subtle' },
  { id: 'normal', label: 'Normal' },
  { id: 'vivid', label: 'Vivid' },
];

export const VisualizerContextMenu: React.FC<VisualizerContextMenuProps> = ({
  isOpen,
  x,
  y,
  onClose,
  isFullBleed = false,
  onToggleFullBleed,
  context = 'now-playing',
}) => {
  const [activeSubmenu, setActiveSubmenu] = useState<SubmenuId>('none');
  const [isAutoSyncing, setIsAutoSyncing] = useState(false);
  const [autoSyncMessage, setAutoSyncMessage] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const config = useLyricVisualizerStore((s) => s.config);
  const nowPlayingLyricsMode = useLyricVisualizerStore((s) => s.nowPlayingLyricsMode);
  const isAmbientOpen = useLyricVisualizerStore((s) => s.isAmbientOpen);
  const currentSongOffsetMs = useLyricVisualizerStore((s) => s.currentSongOffsetMs);
  const currentAutoSyncOffsetMs = useLyricVisualizerStore((s) => s.currentAutoSyncOffsetMs);
  const activeLyrics = useLyricVisualizerStore((s) => s.activeLyrics);
  const activeTrack = useLyricVisualizerStore((s) => s.activeTrack);

  const setNowPlayingLyricsMode = useLyricVisualizerStore((s) => s.setNowPlayingLyricsMode);
  const setStyleId = useLyricVisualizerStore((s) => s.setStyleId);
  const setStyleVariation = useLyricVisualizerStore((s) => s.setStyleVariation);
  const setFontId = useLyricVisualizerStore((s) => s.setFontId);
  const setFontSizeScale = useLyricVisualizerStore((s) => s.setFontSizeScale);
  const setAlbumArtColorMatch = useLyricVisualizerStore((s) => s.setAlbumArtColorMatch);
  const setAudioReactive = useLyricVisualizerStore((s) => s.setAudioReactive);
  const setReduceMotion = useLyricVisualizerStore((s) => s.setReduceMotion);
  const setMotionIntensity = useLyricVisualizerStore((s) => s.setMotionIntensity);
  const setBackgroundOpacity = useLyricVisualizerStore((s) => s.setBackgroundOpacity);
  const setVignetteStrength = useLyricVisualizerStore((s) => s.setVignetteStrength);
  const setTextAlign = useLyricVisualizerStore((s) => s.setTextAlign);
  const setNowPlayingLayout = useLyricVisualizerStore((s) => s.setNowPlayingLayout);
  const setScriptMode = useLyricVisualizerStore((s) => s.setScriptMode);
  const nudgeSongOffsetMs = useLyricVisualizerStore((s) => s.nudgeSongOffsetMs);
  const resetSongOffsetMs = useLyricVisualizerStore((s) => s.resetSongOffsetMs);
  const setAutoSyncOffsetMs = useLyricVisualizerStore((s) => s.setAutoSyncOffsetMs);
  const resetAutoSyncOffsetMs = useLyricVisualizerStore((s) => s.resetAutoSyncOffsetMs);
  const setVocalSilenceRanges = useLyricVisualizerStore((s) => s.setVocalSilenceRanges);
  const setOverlayEnabled = useLyricVisualizerStore((s) => s.setOverlayEnabled);
  const openAmbientMode = useLyricVisualizerStore((s) => s.openAmbientMode);
  const closeAmbientMode = useLyricVisualizerStore((s) => s.closeAmbientMode);
  const setSandboxEnabled = useLyricVisualizerStore((s) => s.setSandboxEnabled);

  // Reset open submenu whenever menu closes
  useEffect(() => {
    if (!isOpen) {
      setActiveSubmenu('none');
    }
  }, [isOpen]);

  // Close on Escape key or outside click
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' || ev.code === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        onClose();
      }
    };

    const handlePointerDown = (ev: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(ev.target as Node)) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('mousedown', handlePointerDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('mousedown', handlePointerDown, true);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const menuWidth = 256;
  const estimatedMenuHeight = 396;
  const submenuWidth = 264;
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 720;

  let clampedX = x;
  let clampedY = y;
  if (clampedX + menuWidth > viewportW - 12) {
    clampedX = x - menuWidth;
  }
  if (clampedY + estimatedMenuHeight > viewportH - 16) {
    clampedY = viewportH - estimatedMenuHeight - 16;
  }
  clampedX = Math.max(12, Math.min(clampedX, Math.max(12, viewportW - menuWidth - 12)));
  clampedY = Math.max(12, Math.min(clampedY, Math.max(12, viewportH - estimatedMenuHeight - 16)));

  const flipSubmenuLeft = clampedX + menuWidth + submenuWidth + 12 > viewportW;
  const alignSubmenuBottom = clampedY > viewportH * 0.52;

  const activeStyle = VISUAL_STYLE_DEFINITIONS.find((s) => s.id === config.styleId);
  const activeVariationId = resolveStyleVariationId(config.styleId, config.variationByStyle);
  const currentMotionIntensity: MotionIntensity =
    ((config as any).motionIntensity as MotionIntensity | undefined) || 'normal';
  const rawLayout = normalizeNowPlayingLayout(config.nowPlayingLayout);
  const currentLayout: NowPlayingLayoutMode =
    isAmbientOpen || context === 'ambient'
      ? 'ambient'
      : isFullBleed && rawLayout === 'split'
      ? 'lyrics-focus'
      : rawLayout;
  const isArtworkFocus = currentLayout === 'artwork-focus';
  const currentTextAlign: LyricTextAlign = config.textAlign ?? 'center';
  const currentScriptMode: LyricsScriptMode = config.scriptMode ?? 'auto';
  const activeScriptOption =
    SCRIPT_MODE_OPTIONS.find((opt) => opt.id === currentScriptMode) ?? SCRIPT_MODE_OPTIONS[0];
  const currentBgOpacity = typeof config.backgroundOpacity === 'number' ? config.backgroundOpacity : 0.95;
  const currentVignette = typeof config.vignetteStrength === 'number' ? config.vignetteStrength : 0.55;
  const combinedOffsetMs = currentSongOffsetMs + currentAutoSyncOffsetMs;
  const formattedOffset =
    combinedOffsetMs > 0 ? `+${combinedOffsetMs}ms` : `${combinedOffsetMs}ms`;

  const handleAutoSyncLyrics = async () => {
    const lineStarts = (activeLyrics?.lines || []).map((l) => l.startSeconds).filter((t) => Number.isFinite(t));
    if (lineStarts.length === 0) {
      setAutoSyncMessage('Load timed lyrics first');
      return;
    }
    const playerTrack = usePlayerStore.getState().currentTrack;
    const trackId = playerTrack?.videoId || activeTrack?.id || '';
    const streamUrl =
      playerTrack?.streamUrl ||
      (playerTrack?.localFilePath ? `local://${playerTrack.localFilePath}` : null);
    if (!trackId) {
      setAutoSyncMessage('No active track');
      return;
    }

    setIsAutoSyncing(true);
    setAutoSyncMessage('Analyzing vocal contour...');
    try {
      const analysis =
        (await MlAudioService.analyzeTrackBeats(trackId, streamUrl)) ??
        MlAudioService.getCachedTrackBeatsSync(trackId);
      if (!analysis || analysis.vocalEnvelope.length < 4) {
        setAutoSyncMessage('Play or cache track audio to auto-sync');
        return;
      }
      setVocalSilenceRanges(analysis.vocalSilenceRanges);
      const result = await MlAudioService.autoSyncLyrics(
        analysis.vocalEnvelope,
        analysis.envelopeFps || 10,
        lineStarts
      );
      setAutoSyncOffsetMs(result.offsetMs);
      const sign = result.offsetMs > 0 ? '+' : '';
      setAutoSyncMessage(
        `Auto-synced ${sign}${Math.round(result.offsetMs)}ms (${Math.round(result.confidence * 100)}%)`
      );
    } catch {
      setAutoSyncMessage('Auto-sync unavailable for this stream');
    } finally {
      setIsAutoSyncing(false);
    }
  };

  const handleSelectLayout = (layout: NowPlayingLayoutMode) => {
    if (layout === 'ambient') {
      setNowPlayingLayout('ambient');
      if (!isAmbientOpen && context !== 'ambient') {
        openAmbientMode().catch(() => {});
      }
      onClose();
      return;
    }
    if (isFullBleed && layout === 'split' && onToggleFullBleed) {
      onToggleFullBleed();
    }
    if (isAmbientOpen) {
      closeAmbientMode().catch(() => {});
    }
    setNowPlayingLayout(layout);
    onClose();
  };

  const handleSelectClassic = () => {
    setNowPlayingLyricsMode('classic');
    if (isArtworkFocus) {
      setNowPlayingLayout('split');
    }
    if (isAmbientOpen) {
      closeAmbientMode().catch(() => {});
    }
    onClose();
  };

  const handleSelectVisualizer = () => {
    setNowPlayingLyricsMode('visualizer');
    if (isArtworkFocus) {
      setNowPlayingLayout('split');
    }
    if (isAmbientOpen) {
      closeAmbientMode().catch(() => {});
    }
    onClose();
  };

  const handleToggleOverlay = () => {
    setOverlayEnabled(!config.overlayEnabled);
    onClose();
  };

  const handleSelectStyle = (styleId: VisualStyleId) => {
    setStyleId(styleId);
    if (nowPlayingLyricsMode !== 'visualizer') {
      setNowPlayingLyricsMode('visualizer');
    }
    if (isArtworkFocus) {
      setNowPlayingLayout('split');
    }
  };

  const submenuPositionStyle: React.CSSProperties = {
    position: 'absolute',
    ...(alignSubmenuBottom ? { bottom: -6 } : { top: -6 }),
    left: flipSubmenuLeft ? 'auto' : '100%',
    right: flipSubmenuLeft ? '100%' : 'auto',
    marginLeft: flipSubmenuLeft ? 0 : 6,
    marginRight: flipSubmenuLeft ? 6 : 0,
    zIndex: 10000,
  };

  return (
    <div
      ref={menuRef}
      data-testid="visualizer-context-menu"
      style={{
        position: 'fixed',
        left: `${clampedX}px`,
        top: `${clampedY}px`,
        zIndex: 9999,
      }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      className="liquid-glass-capsule fixed w-64 rounded-2xl text-white p-1.5 text-xs select-none shadow-2xl border border-white/15 animate-in fade-in zoom-in-95 duration-100"
    >
      {/* Section 1: Layout (Unified 4-Mode Choice) */}
      <div className="flex items-center gap-1.5 px-2.5 pt-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-white/45">
        <Layout size={11} />
        <span>Layout</span>
      </div>

      {(
        [
          { id: 'split', label: 'Split View', icon: <Layout size={14} className="text-white/75" /> },
          { id: 'lyrics-focus', label: 'Lyrics Focus', icon: <AlignCenter size={14} className="text-white/75" /> },
          { id: 'artwork-focus', label: 'Artwork Focus', icon: <Disc size={14} className="text-white/75" /> },
          { id: 'ambient', label: 'Fullscreen Ambient', icon: <Maximize2 size={14} className="text-white/75" /> },
        ] as const
      ).map((opt) => {
        const active = currentLayout === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            data-testid={`layout-option-${opt.id}`}
            onMouseEnter={() => setActiveSubmenu('none')}
            onClick={() => handleSelectLayout(opt.id)}
            className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition-colors text-left cursor-pointer"
          >
            <span className="flex items-center gap-2.5">
              {opt.icon}
              <span>{opt.label}</span>
            </span>
            {active && <Check size={13} className="text-[var(--color-accent)] shrink-0" />}
          </button>
        );
      })}

      <div className="h-[1px] bg-white/10 my-1.5" />

      {/* Section 2: Lyric Engine */}
      <div className="px-2.5 pt-0.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-white/45">
        Lyric Engine
      </div>

      <button
        type="button"
        onMouseEnter={() => setActiveSubmenu('none')}
        onClick={handleSelectClassic}
        className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition-colors text-left cursor-pointer ${
          isArtworkFocus ? 'opacity-60' : ''
        }`}
      >
        <span className="flex items-center gap-2.5">
          <AlignLeft size={14} className="text-white/75" />
          <span>Classic Apple Music</span>
        </span>
        {!isArtworkFocus && nowPlayingLyricsMode === 'classic' && (
          <Check size={13} className="text-[var(--color-accent)] shrink-0" />
        )}
      </button>

      <button
        type="button"
        onMouseEnter={() => setActiveSubmenu('none')}
        onClick={handleSelectVisualizer}
        className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition-colors text-left cursor-pointer ${
          isArtworkFocus ? 'opacity-60' : ''
        }`}
      >
        <span className="flex items-center gap-2.5">
          <Sparkles size={14} className="text-white/75" />
          <span>Lyric Visualizer</span>
        </span>
        {!isArtworkFocus && nowPlayingLyricsMode === 'visualizer' && (
          <Check size={13} className="text-[var(--color-accent)] shrink-0" />
        )}
      </button>

      <div className="h-[1px] bg-white/10 my-1.5" />

      {/* Theme / Style Submenu (consolidated 12 styles) */}
      <div
        className="relative"
        onMouseEnter={() => setActiveSubmenu('styles')}
      >
        <button
          type="button"
          onClick={() => setActiveSubmenu((prev) => (prev === 'styles' ? 'none' : 'styles'))}
          className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg transition-colors text-left cursor-pointer ${
            activeSubmenu === 'styles' ? 'bg-white/15' : 'hover:bg-white/10'
          }`}
        >
          <span className="flex items-center gap-2.5 min-w-0">
            <Wand2 size={14} className="text-white/75 shrink-0" />
            <span className="truncate">Theme / Style</span>
          </span>
          <span className="flex items-center gap-1 text-[10px] text-white/55 shrink-0">
            <span className="max-w-[82px] truncate">{activeStyle?.label || config.styleId}</span>
            <ChevronRight size={12} />
          </span>
        </button>

        {activeSubmenu === 'styles' && (
          <div
            data-testid="visualizer-submenu-styles"
            style={submenuPositionStyle}
            className="liquid-glass-capsule w-64 rounded-2xl text-white p-1.5 max-h-[70vh] overflow-y-auto shadow-2xl border border-white/15"
          >
            <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white/45">
              Visual Styles ({VISUAL_STYLE_DEFINITIONS.length})
            </div>
            {VISUAL_STYLE_DEFINITIONS.map((style, idx) => {
              const selected = config.styleId === style.id;
              return (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => handleSelectStyle(style.id)}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg transition-colors text-left cursor-pointer ${
                    selected ? 'bg-white/15 text-white' : 'hover:bg-white/10 text-white/85'
                  }`}
                  title={style.description}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-mono text-white/40 w-4 shrink-0">
                      {idx + 1}.
                    </span>
                    <span className="truncate font-medium">{style.label}</span>
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    {style.uses3D && (
                      <span className="text-[9px] px-1 py-0.2 rounded bg-white/10 text-white/60">
                        3D
                      </span>
                    )}
                    {selected && <Check size={13} className="text-[var(--color-accent)]" />}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 3: Variations & Appearance Submenu */}
      <div
        className="relative"
        onMouseEnter={() => setActiveSubmenu('appearance')}
      >
        <button
          type="button"
          onClick={() => setActiveSubmenu((prev) => (prev === 'appearance' ? 'none' : 'appearance'))}
          className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg transition-colors text-left cursor-pointer ${
            activeSubmenu === 'appearance' ? 'bg-white/15' : 'hover:bg-white/10'
          }`}
        >
          <span className="flex items-center gap-2.5">
            <Sliders size={14} className="text-white/75" />
            <span>Variations & Appearance</span>
          </span>
          <ChevronRight size={12} className="text-white/55" />
        </button>

        {activeSubmenu === 'appearance' && (
          <div
            data-testid="visualizer-submenu-appearance"
            style={submenuPositionStyle}
            className="liquid-glass-capsule w-72 rounded-2xl text-white p-2.5 max-h-[75vh] overflow-y-auto shadow-2xl border border-white/15 space-y-2.5"
          >
            {/* Active Style Variation Selector */}
            {activeStyle && activeStyle.variations.length > 1 && (
              <>
                <div className="space-y-1.5 px-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-white/45">
                    Variation ({activeStyle.label})
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {activeStyle.variations.map((v) => {
                      const active = activeVariationId === v.id;
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => setStyleVariation(activeStyle.id, v.id)}
                          title={v.description}
                          className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors cursor-pointer ${
                            active
                              ? 'bg-white/25 text-white font-semibold'
                              : 'bg-white/5 hover:bg-white/15 text-white/75'
                          }`}
                        >
                          {v.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="h-[1px] bg-white/10" />
              </>
            )}

            {/* Lyric Justification: Centered / Left */}
            <div className="space-y-1.5 px-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-white/45">
                Lyric Justification
              </div>
              <div className="grid grid-cols-2 gap-1">
                {(
                  [
                    { id: 'center', label: 'Centered', icon: <AlignCenter size={11} /> },
                    { id: 'left', label: 'Left', icon: <AlignLeft size={11} /> },
                  ] as const
                ).map((opt) => {
                  const active = currentTextAlign === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setTextAlign(opt.id)}
                      className={`py-1 rounded-md text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                        active
                          ? 'bg-white/25 text-white font-semibold'
                          : 'bg-white/5 hover:bg-white/15 text-white/70'
                      }`}
                    >
                      {opt.icon}
                      <span>{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="h-[1px] bg-white/10" />

            {/* Background Opacity & Vignette Strength */}
            <div className="space-y-2 px-1">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-white/75">
                  <span>Background Opacity</span>
                  <span className="font-mono text-white font-semibold">
                    {Math.round(currentBgOpacity * 100)}%
                  </span>
                </div>
                <input
                  aria-label="Background Opacity"
                  type="range"
                  min={MIN_BACKGROUND_OPACITY}
                  max={MAX_BACKGROUND_OPACITY}
                  step="0.05"
                  value={currentBgOpacity}
                  onChange={(e) => setBackgroundOpacity(parseFloat(e.target.value))}
                  className="w-full h-1.5 accent-[var(--color-accent)] bg-white/20 rounded-lg cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-white/75">
                  <span>Vignette Strength</span>
                  <span className="font-mono text-white font-semibold">
                    {Math.round(currentVignette * 100)}%
                  </span>
                </div>
                <input
                  aria-label="Vignette Strength"
                  type="range"
                  min={MIN_VIGNETTE_STRENGTH}
                  max={MAX_VIGNETTE_STRENGTH}
                  step="0.05"
                  value={currentVignette}
                  onChange={(e) => setVignetteStrength(parseFloat(e.target.value))}
                  className="w-full h-1.5 accent-[var(--color-accent)] bg-white/20 rounded-lg cursor-pointer"
                />
              </div>
            </div>

            <div className="h-[1px] bg-white/10" />

            {/* Font Family (8 BUNDLED_FONTS) */}
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 px-1 text-[10px] font-bold uppercase tracking-wider text-white/45">
                <Type size={11} />
                <span>Font Family</span>
              </div>
              <div className="space-y-0.5">
                {BUNDLED_FONTS.map((font) => {
                  const selected = config.fontId === font.id;
                  return (
                    <button
                      key={font.id}
                      type="button"
                      onClick={() => setFontId(font.id as BundledFontId)}
                      style={{ fontFamily: getBundledFontCssFamily(font.id) }}
                      className={`w-full flex items-center justify-between px-2 py-1 rounded-lg text-xs transition-colors cursor-pointer ${
                        selected ? 'bg-white/15 text-white font-semibold' : 'hover:bg-white/10 text-white/80'
                      }`}
                    >
                      <span>{font.label}</span>
                      {selected && <Check size={12} className="text-[var(--color-accent)]" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="h-[1px] bg-white/10" />

            {/* Text Size / Scale Presets + Slider */}
            <div className="space-y-1.5 px-1">
              <div className="flex items-center justify-between text-[11px] text-white/75">
                <span>Text Size</span>
                <span className="font-mono text-white font-semibold">
                  {config.fontSizeScale.toFixed(2)}x
                </span>
              </div>
              <div className="grid grid-cols-5 gap-1">
                {SIZE_PRESETS.map((preset) => {
                  const active = Math.abs(config.fontSizeScale - preset.value) < 0.03;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setFontSizeScale(preset.value)}
                      className={`py-1 rounded-md text-[10px] font-mono transition-colors cursor-pointer ${
                        active
                          ? 'bg-white/25 text-white font-bold'
                          : 'bg-white/5 hover:bg-white/15 text-white/70'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              <input
                aria-label="Text Size Scale"
                type="range"
                min={MIN_FONT_SIZE_SCALE}
                max={MAX_FONT_SIZE_SCALE}
                step="0.05"
                value={config.fontSizeScale}
                onChange={(e) => setFontSizeScale(parseFloat(e.target.value))}
                className="w-full h-1.5 accent-[var(--color-accent)] bg-white/20 rounded-lg cursor-pointer"
              />
            </div>

            <div className="h-[1px] bg-white/10" />

            {/* Motion Intensity: Subtle / Normal / Vivid + Reduce Motion */}
            <div className="space-y-1.5 px-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-white/45">
                Motion Intensity
              </div>
              <div className="grid grid-cols-3 gap-1">
                {MOTION_INTENSITY_OPTIONS.map((opt) => {
                  const active = currentMotionIntensity === opt.id && !config.reduceMotion;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setMotionIntensity(opt.id);
                        if (config.reduceMotion) setReduceMotion(false);
                      }}
                      className={`py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                        active
                          ? 'bg-white/25 text-white font-semibold'
                          : 'bg-white/5 hover:bg-white/15 text-white/70'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="h-[1px] bg-white/10" />

            {/* Feature Toggles */}
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={() => setAlbumArtColorMatch(!config.albumArtColorMatch)}
                className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Palette size={13} className="text-white/75" />
                  <span>Album-Art Color Matching</span>
                </span>
                {config.albumArtColorMatch && <Check size={13} className="text-cyan-400" />}
              </button>

              <button
                type="button"
                onClick={() => setAudioReactive(!config.audioReactive)}
                className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Activity size={13} className="text-white/75" />
                  <span>Audio-Reactive FFT</span>
                </span>
                {config.audioReactive && <Check size={13} className="text-emerald-400" />}
              </button>

              <button
                type="button"
                onClick={() => setReduceMotion(!config.reduceMotion)}
                className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Eye size={13} className="text-white/75" />
                  <span>Reduce Motion</span>
                </span>
                {config.reduceMotion && <Check size={13} className="text-amber-400" />}
              </button>

              <button
                type="button"
                onClick={() => setSandboxEnabled(!config.sandboxEnabled)}
                className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Sparkles size={13} className="text-amber-300" />
                  <span>Sandbox Demo Mode</span>
                </span>
                {config.sandboxEnabled && <Check size={13} className="text-amber-400" />}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Section 4: Lyrics Script Submenu */}
      <div
        className="relative"
        onMouseEnter={() => setActiveSubmenu('script')}
      >
        <button
          type="button"
          onClick={() => setActiveSubmenu((prev) => (prev === 'script' ? 'none' : 'script'))}
          className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg transition-colors text-left cursor-pointer ${
            activeSubmenu === 'script' ? 'bg-white/15' : 'hover:bg-white/10'
          }`}
        >
          <span className="flex items-center gap-2.5 min-w-0">
            <Languages size={14} className="text-white/75 shrink-0" />
            <span className="truncate">Lyrics Script</span>
          </span>
          <span className="flex items-center gap-1 text-[10px] text-white/55 shrink-0">
            <span className="max-w-[78px] truncate">{activeScriptOption.shortLabel}</span>
            <ChevronRight size={12} />
          </span>
        </button>

        {activeSubmenu === 'script' && (
          <div
            data-testid="visualizer-submenu-script"
            style={submenuPositionStyle}
            className="liquid-glass-capsule w-64 rounded-2xl text-white p-1.5 shadow-2xl border border-white/15 space-y-0.5"
          >
            <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white/45">
              Lyrics Script
            </div>
            {SCRIPT_MODE_OPTIONS.map((opt) => {
              const selected = currentScriptMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  title={opt.description}
                  onClick={() => setScriptMode(opt.id)}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg transition-colors text-left cursor-pointer ${
                    selected ? 'bg-white/15 text-white font-semibold' : 'hover:bg-white/10 text-white/85'
                  }`}
                >
                  <span className="truncate">{opt.label}</span>
                  {selected && <Check size={13} className="text-[var(--color-accent)] shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 5: Lyrics Timing / Sync Submenu */}
      <div
        className="relative"
        onMouseEnter={() => setActiveSubmenu('sync')}
      >
        <button
          type="button"
          onClick={() => setActiveSubmenu((prev) => (prev === 'sync' ? 'none' : 'sync'))}
          className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg transition-colors text-left cursor-pointer ${
            activeSubmenu === 'sync' ? 'bg-white/15' : 'hover:bg-white/10'
          }`}
        >
          <span className="flex items-center gap-2.5">
            <Clock size={14} className="text-white/75" />
            <span>Lyrics Timing / Sync</span>
          </span>
          <span className="flex items-center gap-1 text-[10px] font-mono text-white/60">
            <span>{formattedOffset}</span>
            <ChevronRight size={12} />
          </span>
        </button>

        {activeSubmenu === 'sync' && (
          <div
            data-testid="visualizer-submenu-sync"
            style={submenuPositionStyle}
            className="liquid-glass-capsule w-56 rounded-2xl text-white p-1.5 shadow-2xl border border-white/15"
          >
            <div className="flex items-center justify-between px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white/45">
              <span>Timing Offset</span>
              <span className="font-mono text-cyan-300">{formattedOffset}</span>
            </div>

            <button
              type="button"
              onClick={() => nudgeSongOffsetMs(-1000)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition-colors text-left cursor-pointer"
            >
              <span>Earlier -1.0s</span>
              <span className="font-mono text-[10px] text-white/55">-1000ms</span>
            </button>

            <button
              type="button"
              onClick={() => nudgeSongOffsetMs(-100)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition-colors text-left cursor-pointer"
            >
              <span>Earlier -0.1s</span>
              <span className="font-mono text-[10px] text-white/55">-100ms</span>
            </button>

            <button
              type="button"
              onClick={() => nudgeSongOffsetMs(100)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition-colors text-left cursor-pointer"
            >
              <span>Later +0.1s</span>
              <span className="font-mono text-[10px] text-white/55">+100ms</span>
            </button>

            <button
              type="button"
              onClick={() => nudgeSongOffsetMs(1000)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition-colors text-left cursor-pointer"
            >
              <span>Later +1.0s</span>
              <span className="font-mono text-[10px] text-white/55">+1000ms</span>
            </button>

            <div className="h-[1px] bg-white/10 my-1" />

            <button
              type="button"
              data-testid="auto-sync-lyrics-btn"
              disabled={isAutoSyncing}
              onClick={() => void handleAutoSyncLyrics()}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-white/10 disabled:opacity-50 transition-colors text-left cursor-pointer text-cyan-300"
            >
              <span className="flex items-center gap-2">
                <Wand2 size={12} />
                <span>{isAutoSyncing ? 'Auto-Syncing...' : 'Auto-Sync Lyrics'}</span>
              </span>
              {currentAutoSyncOffsetMs !== 0 && (
                <span className="font-mono text-[10px] text-cyan-200/80">
                  {currentAutoSyncOffsetMs > 0
                    ? `+${currentAutoSyncOffsetMs}ms`
                    : `${currentAutoSyncOffsetMs}ms`}
                </span>
              )}
            </button>

            {autoSyncMessage && (
              <div className="px-2.5 py-1 text-[10px] text-white/65 leading-snug">
                {autoSyncMessage}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                resetSongOffsetMs();
                resetAutoSyncOffsetMs();
                setAutoSyncMessage(null);
              }}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition-colors text-left cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <RotateCcw size={12} className="text-white/75" />
                <span>Reset Offset</span>
              </span>
              <span className="font-mono text-[10px] text-white/55">0ms</span>
            </button>
          </div>
        )}
      </div>

      {/* Desktop Overlay toggle (nested under Lyric Engine) */}
      <button
        type="button"
        onMouseEnter={() => setActiveSubmenu('none')}
        onClick={handleToggleOverlay}
        className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition-colors text-left cursor-pointer"
      >
        <span className="flex items-center gap-2.5">
          <Monitor size={14} className="text-white/75" />
          <span>Desktop Overlay</span>
        </span>
        {config.overlayEnabled && <Check size={13} className="text-cyan-400 shrink-0" />}
      </button>
    </div>
  );
};
