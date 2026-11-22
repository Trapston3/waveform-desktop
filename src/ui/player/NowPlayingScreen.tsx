// src/ui/player/NowPlayingScreen.tsx
// Fullscreen immersive Apple Music Now Playing experience:
// - Unified Full-Bleed Backdrop Layer: WebGL 2 OkLab fluid mesh (Classic) OR edge-to-edge LyricStageControl (Visualizer)
// - Auto-hiding minimal top chrome (~3s inactivity fade, zero heavy bars/pills)
// - Left Column: Floating album artwork lockup with 3D perspective tilt (perspective: 1200px) & cursor sheen,
//   68-bar waveform seekbar, borderless floating transport icons, and volume slider flanked by quiet sidecar toggles
// - Right Column: Borderless floating live lyrics (Classic), click-through to Visualizer canvas, or glass Queue drawer
// - Decoupled 0Hz playback re-render time pills

import React, { useRef, useEffect, useState, useMemo, useCallback, memo } from 'react';
import {
  ChevronDown,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  Heart,
  AlignLeft,
  ListOrdered,
  Maximize2,
  Minimize2,
  Sparkles,
  X,
  Music2,
  PanelLeft,
} from 'lucide-react';
import { ArtistCredits } from '../common/ArtistCredits';
import { VisualizerContextMenu } from '../common/VisualizerContextMenu';
import { LyricStageControl } from '../../lyricVisualizer/ui/LyricStageControl';
import { useLyricVisualizerStore } from '../../lyricVisualizer/state/lyricVisualizerStore';
import { useSettingsStore } from '../../state/settingsStore';
import { useNavigationStore } from '../../state/navigationStore';
import { resolveArtistTarget } from '../../utils/artistCredits';
import { usePlayerStore } from '../../state/playerStore';
import { useQueueStore } from '../../state/queueStore';
import { useLibraryStore } from '../../state/libraryStore';
import { useLyricsStore } from '../../state/lyricsStore';
import { extractArtworkPaletteFromUrl, useThemeStore } from '../theme/Theme';
import { WaveformCanvasSeekbar } from './WaveformCanvasSeekbar';
import { SyllableLyricsEngine } from './SyllableLyricsEngine';
import { AppleMusicFluidMeshCanvas } from './AppleMusicFluidMeshCanvas';
import { useTiltTransform } from './useTiltTransform';
import {
  PlayerPlayIcon,
  PlayerPauseIcon,
  PlayerPreviousIcon,
  PlayerNextIcon,
  LosslessWaveIcon,
  DolbyAtmosIcon,
  OutputSpeakerIcon,
} from '../common/WaveFormIcons';

export interface NowPlayingScreenProps {
  isOpen: boolean;
  onClose: () => void;
}

function exitNativeFullscreen(): void {
  if (typeof document !== 'undefined' && document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }
}

function isValidImageUrl(url: unknown): url is string {
  return Boolean(
    url &&
      typeof url === 'string' &&
      url.trim() &&
      url !== 'undefined' &&
      url !== 'null'
  );
}

export const NowPlayingScreen: React.FC<NowPlayingScreenProps> = memo(({ isOpen, onClose }) => {
  const [activeSidecar, setActiveSidecar] = useState<'lyrics' | 'queue' | 'none'>('lyrics');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isFullBleedVisualizer, setIsFullBleedVisualizer] = useState(false);
  const [artBroken, setArtBroken] = useState(false);
  const [brokenQueueArt, setBrokenQueueArt] = useState<Record<string, boolean>>({});
  const [stageWidth, setStageWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1280
  );
  const [isChromeVisible, setIsChromeVisible] = useState(true);
  const [isHeaderHovered, setIsHeaderHovered] = useState(false);
  const [isDockHovered, setIsDockHovered] = useState(false);
  const [vizContextMenu, setVizContextMenu] = useState<{ isOpen: boolean; x: number; y: number }>({
    isOpen: false,
    x: 0,
    y: 0,
  });

  const { lyricsData, isLoading, fetchLyricsForTrack } = useLyricsStore();
  const nowPlayingLyricsMode = useLyricVisualizerStore((s) => s.nowPlayingLyricsMode);
  const setNowPlayingLyricsMode = useLyricVisualizerStore((s) => s.setNowPlayingLyricsMode);
  const nowPlayingLayout = useLyricVisualizerStore((s) => s.config.nowPlayingLayout ?? 'split');
  const hideAlbumCover = useLyricVisualizerStore((s) => Boolean(s.config.hideAlbumCover));
  const vizTextAlign = useLyricVisualizerStore((s) => s.config.textAlign ?? 'center');
  const setHideAlbumCover = useLyricVisualizerStore((s) => s.setHideAlbumCover);
  const setNowPlayingLayout = useLyricVisualizerStore((s) => s.setNowPlayingLayout);
  const settingsLyricsAlignment = useSettingsStore((s) => s.settings?.lyricsAlignment ?? 'left');

  const rootRef = useRef<HTMLDivElement>(null);
  const chromeHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedSpanRef = useRef<HTMLSpanElement>(null);
  const remainingSpanRef = useRef<HTMLSpanElement>(null);

  // Granular Zustand selectors - eliminates wide re-renders on playback position ticks
  const { navigateToArtist, navigateToRelease } = useNavigationStore();
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const durationMs = usePlayerStore((s) => s.durationMs);
  const volume = usePlayerStore((s) => s.volume);
  const isMuted = usePlayerStore((s) => s.isMuted);
  const isShuffle = usePlayerStore((s) => s.isShuffle);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const waveformBuckets = usePlayerStore((s) => s.waveformBuckets);
  const livePcmEnergy = usePlayerStore((s) => s.livePcmEnergy);
  const activeStreamQuality = usePlayerStore((s) => (s as any).activeStreamQuality as string | null | undefined);
  const activeStreamIsAtmos = usePlayerStore((s) => Boolean((s as any).activeStreamIsAtmos));

  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const seek = usePlayerStore((s) => s.seek);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const adjustVolumeRelative = usePlayerStore((s) => s.adjustVolumeRelative);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeatMode = usePlayerStore((s) => s.cycleRepeatMode);

  const { advanceQueue, previousTrack, tiers, jumpToTrack } = useQueueStore();
  const { toggleFavorite, isFavorite } = useLibraryStore();
  const artworkPalette = useThemeStore((s) => s.artworkPalette);

  const revealChrome = useCallback(() => {
    setIsChromeVisible(true);
    if (chromeHideTimerRef.current) {
      clearTimeout(chromeHideTimerRef.current);
    }
    chromeHideTimerRef.current = setTimeout(() => {
      chromeHideTimerRef.current = null;
      setIsChromeVisible(false);
    }, 3000);
  }, []);

  const handleOpenVizContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    revealChrome();
    setVizContextMenu({ isOpen: true, x: e.clientX, y: e.clientY });
  }, [revealChrome]);

  const handleCloseVizContextMenu = useCallback(() => {
    setVizContextMenu((prev) => (prev.isOpen ? { ...prev, isOpen: false } : prev));
  }, []);

  const handleToggleFullBleed = useCallback(() => {
    setIsFullBleedVisualizer((prev) => {
      const next = !prev;
      if (next) {
        setActiveSidecar('lyrics');
        setNowPlayingLyricsMode('visualizer');
      }
      return next;
    });
  }, [setNowPlayingLyricsMode]);

  const isPlaying = playbackState === 'PLAYING';
  const isLiked = currentTrack ? isFavorite(currentTrack.videoId) : false;
  const isVisualizerMode = nowPlayingLyricsMode === 'visualizer';
  const isArtworkHidden =
    hideAlbumCover ||
    nowPlayingLayout === 'centered' ||
    nowPlayingLayout === 'ambient' ||
    isFullBleedVisualizer;
  const splitContentInsetLeft =
    isArtworkHidden || isFullBleedVisualizer || stageWidth < 768 || activeSidecar === 'queue'
      ? 0
      : Math.round(Math.min(Math.max(stageWidth * 0.44, 380), 540));

  // 3D Perspective Tilt and Specular Cursor Sheen for Floating Artwork Lockup
  const tilt = useTiltTransform({
    maxTiltDeg: 10,
    perspectivePx: 1200,
    scale: isPlaying ? 1.0 : 0.95,
    active: true,
  });

  // Extract 4 palette colors for OkLab GPU Fluid Mesh
  const meshColors = useMemo(() => {
    if (artworkPalette?.meshColors && artworkPalette.meshColors.length >= 4) {
      return [...artworkPalette.meshColors];
    }
    return [
      artworkPalette?.vibrantAccent || '#FA2D48',
      artworkPalette?.edgeWash || '#3A1019',
      artworkPalette?.ambientBackground || '#080507',
      artworkPalette?.playerTint || 'rgba(58, 16, 25, 0.65)',
    ];
  }, [artworkPalette]);

  const artworkUrl =
    currentTrack?.thumbnailUrl || (currentTrack as any)?.artworkUrl || '';

  // Reset broken-image fallback state whenever artwork URL changes
  useEffect(() => {
    setArtBroken(false);
    setBrokenQueueArt({});
  }, [artworkUrl]);

  // Synchronize dynamic album art palette whenever track or artwork changes
  useEffect(() => {
    if (!currentTrack) return;
    let cancelled = false;
    extractArtworkPaletteFromUrl(artworkUrl, currentTrack?.title || '')
      .then((p) => {
        if (!cancelled) {
          useThemeStore.getState().setArtworkPalette(p);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [
    currentTrack?.videoId,
    currentTrack?.thumbnailUrl,
    (currentTrack as any)?.artworkUrl,
    currentTrack?.title,
    artworkUrl,
  ]);

  // Load lyrics for currently playing track via centralized store
  useEffect(() => {
    fetchLyricsForTrack(currentTrack);
  }, [
    currentTrack?.videoId,
    currentTrack?.title,
    currentTrack?.artist,
    (currentTrack as any)?.lyrics,
    fetchLyricsForTrack,
  ]);

  // Track root container width for responsive Visualizer split-view contentInsetLeft
  useEffect(() => {
    if (!isOpen) return;
    const el = rootRef.current;
    if (!el) return;

    const measure = () => {
      const w = el.getBoundingClientRect().width || el.clientWidth;
      if (w > 0) setStageWidth(w);
    };
    measure();

    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      const w = entry?.contentRect?.width ?? el.getBoundingClientRect().width;
      if (w > 0) setStageWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isOpen, Boolean(currentTrack)]);

  // Reveal top chrome briefly on open or view transitions, then auto-fade after ~3s
  useEffect(() => {
    if (!isOpen) return;
    revealChrome();
    return () => {
      if (chromeHideTimerRef.current) {
        clearTimeout(chromeHideTimerRef.current);
        chromeHideTimerRef.current = null;
      }
    };
  }, [isOpen, nowPlayingLyricsMode, isFullBleedVisualizer, revealChrome]);

  // Decoupled position ticker for elapsed/remaining time pills (zero React re-renders)
  useEffect(() => {
    if (!isOpen) return;

    const updateTime = () => {
      const engine = usePlayerStore.getState().audioEngine;
      const pos = engine ? engine.getCurrentPositionMs() : usePlayerStore.getState().positionMs;
      const dur = durationMs || 0;
      const totalSec = Math.max(0, Math.floor(pos / 1000));
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      const elapsedStr = `${m}:${s.toString().padStart(2, '0')}`;

      const remSec = Math.max(0, Math.floor(Math.max(0, dur - pos) / 1000));
      const rm = Math.floor(remSec / 60);
      const rs = remSec % 60;
      const remainingStr = `-${rm}:${rs.toString().padStart(2, '0')}`;

      if (elapsedSpanRef.current && elapsedSpanRef.current.textContent !== elapsedStr) {
        elapsedSpanRef.current.textContent = elapsedStr;
      }
      if (remainingSpanRef.current && remainingSpanRef.current.textContent !== remainingStr) {
        remainingSpanRef.current.textContent = remainingStr;
      }
    };

    updateTime();
    if (!isPlaying) return;

    const interval = setInterval(updateTime, 250);
    return () => clearInterval(interval);
  }, [isOpen, isPlaying, durationMs, isArtworkHidden]);

  // Sync isFullscreen with native/Electron fullscreenchange events
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Reset fullscreen & full-bleed cleanly if NowPlayingScreen closes externally
  useEffect(() => {
    if (!isOpen) {
      if (isFullBleedVisualizer) setIsFullBleedVisualizer(false);
      if (vizContextMenu.isOpen) setVizContextMenu((prev) => ({ ...prev, isOpen: false }));
      if (isFullscreen) {
        setIsFullscreen(false);
        exitNativeFullscreen();
      }
    }
  }, [isOpen, isFullscreen, isFullBleedVisualizer, vizContextMenu.isOpen]);

  // Capture-phase Escape handler: closes menu -> exits full-bleed -> exits fullscreen -> closes Now Playing
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.code === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (vizContextMenu.isOpen) {
          setVizContextMenu((prev) => ({ ...prev, isOpen: false }));
        } else if (isFullBleedVisualizer) {
          setIsFullBleedVisualizer(false);
        } else if (isFullscreen) {
          setIsFullscreen(false);
          exitNativeFullscreen();
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, isFullscreen, isFullBleedVisualizer, vizContextMenu.isOpen, onClose]);

  const toggleFullscreen = () => {
    if (isFullscreen) {
      setIsFullscreen(false);
      exitNativeFullscreen();
    } else {
      setIsFullscreen(true);
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
  };

  const handleClose = () => {
    setIsFullBleedVisualizer(false);
    setVizContextMenu((prev) => (prev.isOpen ? { ...prev, isOpen: false } : prev));
    if (isFullscreen) {
      setIsFullscreen(false);
      exitNativeFullscreen();
    }
    onClose();
  };

  if (!isOpen || !currentTrack) return null;

  const showHeader = isChromeVisible || isHeaderHovered || vizContextMenu.isOpen;
  const showBottomDock = isChromeVisible || isDockHovered || vizContextMenu.isOpen;

  const renderQueueItem = (s: typeof tiers.CONTEXT[number], tier: 'USER_QUEUE' | 'CONTEXT', idx: number) => {
    const itemArt = s.thumbnailUrl || (s as any).artworkUrl || artworkUrl;
    const artKey = `${tier}-${idx}-${s.videoId || s.title}`;
    return (
      <div
        key={`${tier}-${idx}`}
        onClick={() => jumpToTrack(tier, idx)}
        className="flex items-center gap-3 p-2.5 rounded-xl bg-white/5 hover:bg-white/15 cursor-pointer transition-colors"
      >
        {isValidImageUrl(itemArt) && !brokenQueueArt[artKey] ? (
          <img
            src={itemArt}
            alt=""
            onError={() => setBrokenQueueArt((prev) => ({ ...prev, [artKey]: true }))}
            className="w-9 h-9 rounded-lg object-cover shrink-0"
          />
        ) : (
          <div className="w-9 h-9 rounded-lg bg-neutral-900 flex items-center justify-center text-white/25 shrink-0">
            <Music2 size={14} />
          </div>
        )}
        <div className="min-w-0 flex-1 text-xs">
          <div className="font-bold truncate text-white">{s.title}</div>
          <div className="text-[var(--color-text-secondary)] truncate">
            <span
              className="hover:text-[#FA2D48] hover:underline cursor-pointer transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
                navigateToArtist(resolveArtistTarget(s));
              }}
            >
              {s.artist}
            </span>
          </div>
        </div>
      </div>
    );
  };

  // Ambient dark scrim fallback invariant: ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';

  return (
    <div
      ref={rootRef}
      data-fullscreen={isFullscreen ? 'true' : 'false'}
      onMouseMove={revealChrome}
      onMouseEnter={revealChrome}
      onContextMenu={handleOpenVizContextMenu}
      className={`fixed isolate left-0 right-0 ${
        isFullscreen ? 'inset-0 z-[70]' : 'top-10 md:top-12 inset-x-0 bottom-0 z-50'
      } flex flex-col bg-black overflow-hidden select-none animate-in fade-in duration-300`}
    >
      {/* Unified Full-Bleed Backdrop Layer */}
      <div className="absolute inset-0 z-0">
        {!isVisualizerMode ? (
          <>
            {/* GPU Fluid Mesh Background Canvas (640x360 hardware-accelerated OkLab shader with blur-[64px]) */}
            <AppleMusicFluidMeshCanvas
              colors={meshColors}
              isPlaying={isPlaying}
              width={640}
              height={360}
              className="absolute inset-0 w-full h-full object-cover filter blur-[64px] scale-110 pointer-events-none opacity-90 z-0"
            />

            {/* Layer 1: Radial Vignette Scrim (35% to 55% dark edge vignette) */}
            <div
              style={{
                background: 'radial-gradient(ellipse 90% 85% at 50% 50%, transparent 35%, rgba(0, 0, 0, 0.55) 100%)',
              }}
              className="absolute inset-0 pointer-events-none z-[1]"
            />

            {/* Layer 2: Directional Horizontal Scrim (maximizes lyrics readability on right while keeping artwork vibrant) */}
            <div
              style={{
                background: 'linear-gradient(to right, rgba(0, 0, 0, 0.15) 0%, rgba(0, 0, 0, 0.30) 45%, rgba(0, 0, 0, 0.65) 100%)',
              }}
              className="absolute inset-0 pointer-events-none z-[2]"
            />
          </>
        ) : (
          <div
            data-testid={isFullBleedVisualizer ? 'full-bleed-visualizer-stage' : 'backdrop-visualizer-stage'}
            className="absolute inset-0 w-full h-full z-0"
          >
            <LyricStageControl
              className="absolute inset-0 w-full h-full z-0"
              showControls={false}
              blendWithParent={false}
              isBackdrop={true}
              contentInsetLeft={splitContentInsetLeft}
              hasBottomDock={isArtworkHidden}
              onSwitchToClassic={() => {
                setIsFullBleedVisualizer(false);
                setNowPlayingLyricsMode('classic');
              }}
              onContextMenu={handleOpenVizContextMenu}
              isFullBleed={isFullBleedVisualizer}
              onToggleFullBleed={handleToggleFullBleed}
            />
            {!isArtworkHidden && (
              <div
                style={{
                  background: 'linear-gradient(to right, rgba(0, 0, 0, 0.48) 0%, rgba(0, 0, 0, 0.22) 38%, transparent 56%)',
                }}
                className="absolute inset-0 pointer-events-none z-[2]"
              />
            )}
          </div>
        )}
      </div>

      {/* Auto-Hiding Minimal Top Chrome (zero heavy bar or border) */}
      <header
        onMouseEnter={() => setIsHeaderHovered(true)}
        onMouseLeave={() => setIsHeaderHovered(false)}
        className={`absolute top-0 inset-x-0 z-20 flex items-center justify-between px-6 pt-3 pb-2 pointer-events-none transition-opacity duration-300 ${
          showHeader ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <button
          type="button"
          onClick={handleClose}
          className={`w-8 h-8 rounded-lg flex items-center justify-center bg-white/[0.08] hover:bg-white/[0.16] text-white/75 hover:text-white backdrop-blur-md transition-all cursor-pointer active:scale-95 ${
            showHeader ? 'pointer-events-auto' : 'pointer-events-none'
          }`}
          title="Collapse Now Playing"
          aria-label="Collapse Now Playing"
        >
          <ChevronDown size={18} />
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="full-bleed-visualizer-toggle"
            onClick={() => {
              if (isVisualizerMode) {
                handleToggleFullBleed();
              } else {
                toggleFullscreen();
              }
            }}
            className={`w-8 h-8 rounded-lg flex items-center justify-center backdrop-blur-md transition-all cursor-pointer active:scale-95 ${
              (isVisualizerMode ? isFullBleedVisualizer : isFullscreen)
                ? 'bg-white/20 text-white'
                : 'bg-white/[0.08] hover:bg-white/[0.16] text-white/75 hover:text-white'
            } ${showHeader ? 'pointer-events-auto' : 'pointer-events-none'}`}
            title={
              isVisualizerMode
                ? isFullBleedVisualizer
                  ? 'Exit Full-Bleed Visualizer'
                  : 'Expand Full-Bleed Visualizer'
                : isFullscreen
                ? 'Exit Fullscreen (Esc)'
                : 'Enter Fullscreen'
            }
            aria-label={
              isVisualizerMode
                ? isFullBleedVisualizer
                  ? 'Exit Full-Bleed Visualizer'
                  : 'Expand Full-Bleed Visualizer'
                : isFullscreen
                ? 'Exit Fullscreen'
                : 'Enter Fullscreen'
            }
          >
            {(isVisualizerMode ? isFullBleedVisualizer : isFullscreen) ? (
              <Minimize2 size={15} />
            ) : (
              <Maximize2 size={15} />
            )}
          </button>

          <button
            type="button"
            onClick={handleClose}
            className={`w-8 h-8 rounded-lg flex items-center justify-center bg-white/[0.08] hover:bg-white/[0.16] text-white/75 hover:text-white backdrop-blur-md transition-all cursor-pointer active:scale-95 ${
              showHeader ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
            title="Close Now Playing"
            aria-label="Close Now Playing"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {/* Main Split / Centered Foreground Viewport (hidden only in Full-Bleed Ambient Visualizer) */}
      {!isFullBleedVisualizer && (
        <div
          className={`relative z-10 flex-1 flex min-h-0 overflow-hidden px-6 md:px-10 lg:px-12 pt-11 ${
            isArtworkHidden ? 'pb-24' : 'pb-5'
          } gap-8 lg:gap-14 items-center ${
            isArtworkHidden
              ? 'justify-center'
              : isVisualizerMode && activeSidecar !== 'queue'
              ? 'justify-start'
              : 'justify-center'
          } ${isVisualizerMode ? 'pointer-events-none' : ''}`}
        >
          {/* Left Column: Floating Artwork Lockup & Borderless Transport Deck (collapsed when artwork hidden) */}
          {!isArtworkHidden && (
            <div className="pointer-events-auto w-full md:w-[340px] lg:w-[410px] max-w-md shrink-0 flex flex-col items-center space-y-3.5 overflow-hidden">
            {/* Central Square Album Artwork with 3D Perspective Tilt & Specular Sheen */}
            <div
              onMouseMove={tilt.handleMouseMove}
              onMouseLeave={tilt.handleMouseLeave}
              style={{
                transform: tilt.transform,
                transformStyle: 'preserve-3d',
                boxShadow: `0 28px 72px rgba(0,0,0,0.65), 0 12px 32px ${artworkPalette?.edgeWash || 'rgba(250,45,72,0.35)'}, inset 0 0 0 0.5px rgba(255,255,255,0.22)`,
                transition: 'transform 180ms cubic-bezier(0.2, 0.9, 0.3, 1), box-shadow 300ms ease',
              }}
              className="artwork-lockup relative w-[min(320px,36vh)] h-[min(320px,36vh)] md:w-[min(352px,40vh)] md:h-[min(352px,40vh)] rounded-2xl overflow-hidden bg-neutral-900 cursor-pointer"
            >
              {isValidImageUrl(artworkUrl) && !artBroken ? (
                <img
                  src={artworkUrl}
                  alt={currentTrack.title}
                  onError={() => setArtBroken(true)}
                  className="w-full h-full object-cover pointer-events-none select-none"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-neutral-800/80 to-neutral-950 text-white/25 pointer-events-none select-none">
                  <Music2 size={56} />
                </div>
              )}
              {/* Dynamic Specular Sheen Reflection Layer */}
              <div
                style={{
                  background: tilt.sheenGradient,
                }}
                className="absolute inset-0 pointer-events-none transition-opacity duration-200"
              />
            </div>

            {/* Track Metadata & Favorite */}
            <div className="w-full flex items-center justify-between pt-0.5">
              <div className="min-w-0 flex-1 pr-3">
                <div className="flex items-center gap-2">
                  <h1 className="text-xl lg:text-2xl font-extrabold text-white truncate tracking-tight">
                    {currentTrack.title}
                  </h1>
                  {currentTrack.isExplicit && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-white/20 text-white shrink-0">
                      E
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium text-[var(--color-text-secondary)] truncate pt-0.5">
                  <ArtistCredits
                    artist={currentTrack.artist}
                    artists={currentTrack.artists}
                    artistIds={currentTrack.artistIds}
                    onNavigate={(id) => { onClose(); navigateToArtist(id); }}
                  />{" • "}
                  <span
                    className={(currentTrack.albumName || currentTrack.album) ? "hover:text-[#FA2D48] hover:underline cursor-pointer transition-colors" : ""}
                    onClick={() => {
                      const alb = currentTrack.albumName || currentTrack.album;
                      if (!alb) return;
                      onClose();
                      navigateToRelease(currentTrack.albumId || 'alb_' + alb, 'album');
                    }}
                  >
                    {currentTrack.albumName || currentTrack.album || 'Single'}
                  </span>
                </p>
              </div>

              <button
                type="button"
                onClick={() => toggleFavorite(currentTrack)}
                className="w-8 h-8 rounded-lg bg-white/[0.06] hover:bg-white/[0.14] flex items-center justify-center text-white transition-all cursor-pointer active:scale-95 shrink-0"
                title={isLiked ? 'Remove from Favorites' : 'Add to Favorites'}
              >
                <Heart
                  size={17}
                  className={isLiked ? 'text-[var(--color-accent)] fill-current' : 'text-white/65'}
                />
              </button>
            </div>

            {/* 68-Bar Waveform Canvas Seekbar + Quality Badge Row */}
            <div className="w-full space-y-1.5">
              <WaveformCanvasSeekbar
                amplitudes={waveformBuckets}
                durationMs={durationMs}
                isPlaying={isPlaying}
                onSeek={seek}
                liveBands={livePcmEnergy}
                height={38}
              />

              <div className="flex items-center justify-between text-[11px] font-mono text-[var(--color-text-secondary)] px-1">
                <span ref={elapsedSpanRef}>0:00</span>

                {/* Center Audio Quality & Dolby Atmos Pill (strictly bound to active playing stream) */}
                <div className="flex items-center gap-2 font-sans">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/10 text-white/90 text-[10px] font-bold border border-white/15">
                    <LosslessWaveIcon size={13} className="text-[var(--color-accent)]" />
                    <span>{activeStreamQuality || currentTrack.sourceQuality || 'Stream'}</span>
                  </span>
                  {activeStreamIsAtmos && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/10 text-cyan-300 text-[10px] font-bold border border-white/15">
                      <DolbyAtmosIcon size={12} />
                      <span>Dolby Atmos</span>
                    </span>
                  )}
                </div>

                <span ref={remainingSpanRef}>-0:00</span>
              </div>
            </div>

            {/* Borderless Floating Transport Icons */}
            <div className="w-full flex items-center justify-center gap-6 py-0.5">
              <button
                type="button"
                onClick={toggleShuffle}
                className={`p-2 rounded-full hover:bg-white/10 active:scale-95 transition-all cursor-pointer ${
                  isShuffle
                    ? 'text-[var(--color-accent)] opacity-100'
                    : 'text-white opacity-65 hover:opacity-100'
                }`}
                title="Shuffle"
              >
                <Shuffle size={16} />
              </button>

              <button
                type="button"
                onClick={previousTrack}
                className="p-2 rounded-full text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
                title="Previous"
              >
                <PlayerPreviousIcon size={24} />
              </button>

              <button
                type="button"
                onClick={togglePlay}
                className="p-2.5 rounded-full text-white hover:bg-white/10 active:scale-95 flex items-center justify-center transition-all cursor-pointer"
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? (
                  <PlayerPauseIcon size={30} />
                ) : (
                  <PlayerPlayIcon size={30} className="ml-0.5" />
                )}
              </button>

              <button
                type="button"
                onClick={advanceQueue}
                className="p-2 rounded-full text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
                title="Next"
              >
                <PlayerNextIcon size={24} />
              </button>

              <button
                type="button"
                onClick={cycleRepeatMode}
                className={`p-2 rounded-full hover:bg-white/10 active:scale-95 transition-all cursor-pointer ${
                  repeatMode !== 'off'
                    ? 'text-[var(--color-accent)] opacity-100'
                    : 'text-white opacity-65 hover:opacity-100'
                }`}
                title="Repeat"
              >
                {repeatMode === 'one' ? <Repeat1 size={16} /> : <Repeat size={16} />}
              </button>
            </div>

            {/* Bottom Control Row: Lyrics/Visualizer Toggle + Volume Slider + Queue Toggle */}
            <div className="w-full flex items-center gap-3 pt-0.5">
              <button
                type="button"
                data-testid="lyrics-visualizer-toggle"
                onClick={() => {
                  if (activeSidecar !== 'lyrics') {
                    setActiveSidecar('lyrics');
                  } else {
                    const nextMode = isVisualizerMode ? 'classic' : 'visualizer';
                    setNowPlayingLyricsMode(nextMode);
                    if (nextMode === 'classic' && isFullBleedVisualizer) {
                      setIsFullBleedVisualizer(false);
                    }
                  }
                }}
                onContextMenu={handleOpenVizContextMenu}
                className={`w-8 h-8 rounded-lg shrink-0 flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
                  activeSidecar === 'lyrics' && isVisualizerMode
                    ? 'bg-white/20 text-white'
                    : activeSidecar === 'lyrics'
                    ? 'bg-white/12 text-white/90 hover:bg-white/18'
                    : 'bg-white/[0.06] text-white/60 hover:text-white hover:bg-white/12'
                }`}
                title="Toggle Lyrics / Visualizer (Right-click for Visualizer options)"
                aria-label="Toggle Lyrics or Visualizer"
              >
                {isVisualizerMode ? <Sparkles size={15} /> : <AlignLeft size={15} />}
              </button>

              <div
                onWheel={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  adjustVolumeRelative(e.deltaY < 0 ? 0.05 : -0.05);
                }}
                className="flex-1 min-w-0 flex items-center justify-center gap-2.5"
                title="Volume (Scroll wheel supported)"
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleMute();
                  }}
                  className="text-[var(--color-text-secondary)] hover:text-white cursor-pointer shrink-0"
                >
                  {isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={isMuted ? 0 : volume}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  className="w-full h-1.5 accent-white bg-white/25 rounded-lg cursor-pointer"
                />
                <OutputSpeakerIcon size={15} className="text-[var(--color-text-secondary)] shrink-0" />
              </div>

              <button
                type="button"
                data-testid="now-playing-queue-toggle"
                onClick={() => {
                  setActiveSidecar((prev) => (prev === 'queue' ? 'lyrics' : 'queue'));
                }}
                className={`w-8 h-8 rounded-lg shrink-0 flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
                  activeSidecar === 'queue'
                    ? 'bg-white/20 text-white'
                    : 'bg-white/[0.06] text-white/60 hover:text-white hover:bg-white/12'
                }`}
                title="Toggle Up Next Queue"
                aria-label="Toggle Up Next Queue"
              >
                <ListOrdered size={15} />
              </button>
            </div>
          </div>
          )}

          {/* Right / Centered Column: BORDERLESS FLOATING LYRICS (Classic) or Queue Sidecar */}
          {activeSidecar !== 'none' && (
            <div
              className={`flex-1 ${
                isArtworkHidden ? 'max-w-4xl mx-auto w-full' : 'max-w-2xl'
              } h-full min-h-0 flex flex-col justify-center overflow-hidden ${
                isVisualizerMode && activeSidecar === 'lyrics'
                  ? 'pointer-events-none'
                  : 'pointer-events-auto'
              }`}
            >
              {activeSidecar === 'lyrics' && (
                <div className="now-playing-lyrics borderless-floating-lyrics relative flex-1 h-full flex flex-col justify-center overflow-hidden"
                  onContextMenu={handleOpenVizContextMenu}
                >
                  {!isVisualizerMode && (
                    <SyllableLyricsEngine
                      lyricsData={lyricsData}
                      onSeek={seek}
                      fontSize={isArtworkHidden ? 38 : 32}
                      alignment={isArtworkHidden ? vizTextAlign : settingsLyricsAlignment}
                      isLoading={isLoading}
                      bottomOffsetClass={isArtworkHidden ? 'bottom-24' : 'bottom-6'}
                      className="h-full"
                    />
                  )}
                </div>
              )}

              {activeSidecar === 'queue' && (
                <div className={`liquid-glass now-playing-lyrics now-playing-queue flex-1 ${
                  isArtworkHidden ? 'max-w-xl mx-auto w-full' : 'max-w-lg'
                } h-full rounded-3xl overflow-hidden flex flex-col p-6 backdrop-blur-2xl`}>
                  <div className="flex-1 overflow-y-auto space-y-4 no-scrollbar">
                    <h3 className="text-xs font-bold tracking-widest uppercase text-[var(--color-text-secondary)]">
                      Up Next Queue
                    </h3>
                    <div className="space-y-2">
                      {tiers.USER_QUEUE.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="text-xs font-semibold text-[var(--color-accent)]">
                            User Queue
                          </div>
                          {tiers.USER_QUEUE.map((s, idx) => renderQueueItem(s, 'USER_QUEUE', idx))}
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <div className="text-xs font-semibold text-[var(--color-text-secondary)]">Context Queue</div>
                        {tiers.CONTEXT.slice(0, 20).map((s, idx) => renderQueueItem(s, 'CONTEXT', idx))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Auto-Fading Minimal Bottom Control Dock (Centered Lyric Mode / Hide Album Cover / Ambient) */}
      {isArtworkHidden && (
        <div
          data-testid="centered-bottom-control-dock"
          onMouseEnter={() => {
            setIsDockHovered(true);
            revealChrome();
          }}
          onMouseLeave={() => setIsDockHovered(false)}
          className={`absolute bottom-4 inset-x-4 md:inset-x-8 z-20 flex justify-center pointer-events-none transition-all duration-300 ${
            showBottomDock ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
          }`}
        >
          <div
            className={`w-full max-w-5xl rounded-2xl bg-black/50 backdrop-blur-2xl border border-white/12 px-4 py-2.5 shadow-[0_20px_50px_rgba(0,0,0,0.65)] flex items-center gap-4 ${
              showBottomDock ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
          >
            {/* Compact Track Info + Mini Thumbnail */}
            <div className="flex items-center gap-2.5 min-w-0 w-44 lg:w-56 shrink-0">
              {!hideAlbumCover && (
                <div className="w-9 h-9 rounded-lg overflow-hidden bg-neutral-900 shrink-0 flex items-center justify-center border border-white/10">
                  {isValidImageUrl(artworkUrl) && !artBroken ? (
                    <img
                      src={artworkUrl}
                      alt={currentTrack.title}
                      onError={() => setArtBroken(true)}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Music2 size={15} className="text-white/40" />
                  )}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-white truncate">{currentTrack.title}</div>
                <div className="text-[11px] text-white/60 truncate">
                  <ArtistCredits
                    artist={currentTrack.artist}
                    artists={currentTrack.artists}
                    artistIds={currentTrack.artistIds}
                    onNavigate={(id) => { onClose(); navigateToArtist(id); }}
                  />
                </div>
              </div>
            </div>

            {/* Borderless Transport + Waveform Seekbar */}
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={toggleShuffle}
                  className={`p-1 rounded-full hover:bg-white/10 active:scale-95 transition-all cursor-pointer ${
                    isShuffle ? 'text-[var(--color-accent)] opacity-100' : 'text-white opacity-65 hover:opacity-100'
                  }`}
                  title="Shuffle"
                >
                  <Shuffle size={13} />
                </button>
                <button
                  type="button"
                  onClick={previousTrack}
                  className="p-1 rounded-full text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
                  title="Previous"
                >
                  <PlayerPreviousIcon size={18} />
                </button>
                <button
                  type="button"
                  onClick={togglePlay}
                  className="p-1.5 rounded-full text-white hover:bg-white/10 active:scale-95 flex items-center justify-center transition-all cursor-pointer"
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? <PlayerPauseIcon size={22} /> : <PlayerPlayIcon size={22} className="ml-0.5" />}
                </button>
                <button
                  type="button"
                  onClick={advanceQueue}
                  className="p-1 rounded-full text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
                  title="Next"
                >
                  <PlayerNextIcon size={18} />
                </button>
                <button
                  type="button"
                  onClick={cycleRepeatMode}
                  className={`p-1 rounded-full hover:bg-white/10 active:scale-95 transition-all cursor-pointer ${
                    repeatMode !== 'off' ? 'text-[var(--color-accent)] opacity-100' : 'text-white opacity-65 hover:opacity-100'
                  }`}
                  title="Repeat"
                >
                  {repeatMode === 'one' ? <Repeat1 size={13} /> : <Repeat size={13} />}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <span ref={elapsedSpanRef} className="text-[10px] font-mono text-white/65 w-8 text-right shrink-0">
                  0:00
                </span>
                <div className="flex-1 min-w-0">
                  <WaveformCanvasSeekbar
                    amplitudes={waveformBuckets}
                    durationMs={durationMs}
                    isPlaying={isPlaying}
                    onSeek={seek}
                    liveBands={livePcmEnergy}
                    height={24}
                  />
                </div>
                <span ref={remainingSpanRef} className="text-[10px] font-mono text-white/65 w-9 text-left shrink-0">
                  -0:00
                </span>
              </div>
            </div>

            {/* Compact Volume & View Toggles */}
            <div className="flex items-center gap-2 shrink-0">
              <div
                onWheel={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  adjustVolumeRelative(e.deltaY < 0 ? 0.05 : -0.05);
                }}
                className="hidden sm:flex items-center gap-1.5 w-24"
                title="Volume (Scroll wheel supported)"
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleMute();
                  }}
                  className="text-white/70 hover:text-white cursor-pointer shrink-0"
                >
                  {isMuted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={isMuted ? 0 : volume}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  className="w-full h-1 accent-white bg-white/25 rounded-lg cursor-pointer"
                />
              </div>

              <button
                type="button"
                data-testid="lyrics-visualizer-toggle"
                onClick={() => {
                  if (activeSidecar !== 'lyrics') {
                    setActiveSidecar('lyrics');
                  } else {
                    const nextMode = isVisualizerMode ? 'classic' : 'visualizer';
                    setNowPlayingLyricsMode(nextMode);
                    if (nextMode === 'classic' && isFullBleedVisualizer) {
                      setIsFullBleedVisualizer(false);
                    }
                  }
                }}
                onContextMenu={handleOpenVizContextMenu}
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
                  activeSidecar === 'lyrics' && isVisualizerMode
                    ? 'bg-white/20 text-white'
                    : activeSidecar === 'lyrics'
                    ? 'bg-white/12 text-white/90 hover:bg-white/18'
                    : 'bg-white/[0.06] text-white/60 hover:text-white hover:bg-white/12'
                }`}
                title="Toggle Lyrics / Visualizer"
                aria-label="Toggle Lyrics or Visualizer"
              >
                {isVisualizerMode ? <Sparkles size={14} /> : <AlignLeft size={14} />}
              </button>

              <button
                type="button"
                data-testid="now-playing-queue-toggle"
                onClick={() => {
                  if (isFullBleedVisualizer) setIsFullBleedVisualizer(false);
                  setActiveSidecar((prev) => (prev === 'queue' ? 'lyrics' : 'queue'));
                }}
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
                  activeSidecar === 'queue'
                    ? 'bg-white/20 text-white'
                    : 'bg-white/[0.06] text-white/60 hover:text-white hover:bg-white/12'
                }`}
                title="Toggle Up Next Queue"
                aria-label="Toggle Up Next Queue"
              >
                <ListOrdered size={14} />
              </button>

              <button
                type="button"
                data-testid="toggle-album-cover"
                onClick={() => {
                  if (isFullBleedVisualizer) setIsFullBleedVisualizer(false);
                  if (nowPlayingLayout === 'centered' || nowPlayingLayout === 'ambient') {
                    setNowPlayingLayout('split');
                  }
                  setHideAlbumCover(false);
                }}
                className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/[0.06] text-white/70 hover:text-white hover:bg-white/15 transition-all cursor-pointer active:scale-95"
                title="Show Album Cover (Split View)"
                aria-label="Show Album Cover"
              >
                <PanelLeft size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Glassmorphic Visualizer & Lyrics Right-Click Context Menu */}
      <VisualizerContextMenu
        isOpen={vizContextMenu.isOpen}
        x={vizContextMenu.x}
        y={vizContextMenu.y}
        onClose={handleCloseVizContextMenu}
        isFullBleed={isFullBleedVisualizer}
        onToggleFullBleed={handleToggleFullBleed}
        context="now-playing"
      />
    </div>
  );
});

NowPlayingScreen.displayName = 'NowPlayingScreen';
