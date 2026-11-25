// src/lyricVisualizer/ui/LyricStageControl.tsx
// Interactive LyricVisualizer stage combining WebGL2 + Canvas2D LyricStageRenderer,
// SyncEngine, LyricsPipeline, OKLCH album palette extraction, click-line-to-seek,
// Sandbox "Demo: Starlight Harbor (Original)" badge, seamless transparent blending,
// and right-click VisualizerContextMenu integration.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import {
  type AudioFrameMetrics,
  buildLyricsCacheKey,
  DEMO_FALLBACK_PALETTE,
  extractPaletteFromArtworkUrl,
  getBundledFontCssFamily,
  getSyncButtonTheme,
  type Lyrics,
  LyricsPipeline,
  resolveStyleVariationId,
  SF_PRO_DISPLAY_STACK,
  STARLIGHT_HARBOR_LYRICS,
  STARLIGHT_HARBOR_TRACK,
  type StyleTrackMetadata,
  SyncEngine,
  type TrackInfo,
} from '../core';
import { type LyricStageFrameInput, LyricStageRenderer } from '../rendering';
import {
  convertParsedLyricsToVisualizerLyrics,
  getSharedWaveFormPlaybackBridge,
} from '../bridge/waveFormPlaybackBridge';
import { useLyricVisualizerStore } from '../state/lyricVisualizerStore';
import { VisualizerControlBar } from './VisualizerControlBar';
import { VisualizerContextMenu } from '../../ui/common/VisualizerContextMenu';
import { usePlayerStore } from '../../state/playerStore';
import { useLyricsStore } from '../../state/lyricsStore';

export interface LyricStageControlProps {
  className?: string;
  showControls?: boolean;
  blendWithParent?: boolean;
  isBackdrop?: boolean;
  contentInsetLeft?: number;
  hasBottomDock?: boolean;
  isAmbientMode?: boolean;
  isOverlayMode?: boolean;
  onSwitchToClassic?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  isFullBleed?: boolean;
  onToggleFullBleed?: () => void;
}

export const LyricStageControl: React.FC<LyricStageControlProps> = ({
  className = '',
  showControls = false,
  blendWithParent = false,
  isBackdrop = false,
  contentInsetLeft = 0,
  hasBottomDock = false,
  isAmbientMode = false,
  isOverlayMode = false,
  onSwitchToClassic,
  onContextMenu,
  isFullBleed = false,
  onToggleFullBleed,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const webGlCanvasRef = useRef<HTMLCanvasElement>(null);
  const shipCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvas2dRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<LyricStageRenderer | null>(null);
  const syncEngineRef = useRef<SyncEngine>(new SyncEngine());
  const pipelineRef = useRef<LyricsPipeline | null>(null);
  const activeLyricsRef = useRef<Lyrics | null>(null);
  const lastTrackIdRef = useRef<string | null>(null);
  const sampleFrameOutRef = useRef<LyricStageFrameInput>({
    timeSeconds: 0,
    activeLineIndex: -1,
    activeWordIndex: -1,
    wordProgress: 0,
    lineFadeAlpha: 1,
    didSeekThisFrame: false,
    isInstrumentalGap: false,
    gapProgress: 0,
    timeUntilNextLine: Number.POSITIVE_INFINITY,
    hasLyrics: false,
    lastActiveLineIndex: -1,
    nextLineIndex: -1,
  });
  const broadcastPayloadRef = useRef<{
    track: TrackInfo | null;
    trackId: string | null;
    lyrics: Lyrics | null;
    positionSeconds: number;
    isPlaying: boolean;
    audio: AudioFrameMetrics;
  }>({
    track: null,
    trackId: null,
    lyrics: null,
    positionSeconds: 0,
    isPlaying: false,
    audio: {
      rmsLevel: 0,
      bassEnergy: 0,
      midEnergy: 0,
      trebleEnergy: 0,
      beatDetected: false,
      beatStrength: 0,
    },
  });

  const [isHovered, setIsHovered] = useState(false);
  const [isFollowingPlayback, setIsFollowingPlayback] = useState(true);
  const [isHoveringLine, setIsHoveringLine] = useState(false);
  const [isDraggingStage, setIsDraggingStage] = useState(false);
  const [isPlainUnsynced, setIsPlainUnsynced] = useState(false);
  const [liveBpm, setLiveBpm] = useState<number | undefined>(undefined);
  const lastBpmRef = useRef<number | undefined>(undefined);
  const dragStateRef = useRef<{
    active: boolean;
    pointerId: number;
    startY: number;
    lastY: number;
    moved: boolean;
    suppressClick: boolean;
  }>({
    active: false,
    pointerId: -1,
    startY: 0,
    lastY: 0,
    moved: false,
    suppressClick: false,
  });
  const [internalMenu, setInternalMenu] = useState<{ isOpen: boolean; x: number; y: number }>({
    isOpen: false,
    x: 0,
    y: 0,
  });

  const config = useLyricVisualizerStore((s) => s.config);
  const currentSongOffsetMs = useLyricVisualizerStore((s) => s.currentSongOffsetMs);
  const currentAutoSyncOffsetMs = useLyricVisualizerStore((s) => s.currentAutoSyncOffsetMs);
  const vocalSilenceRanges = useLyricVisualizerStore((s) => s.vocalSilenceRanges);
  const isScreenLocked = useLyricVisualizerStore((s) => s.isScreenLocked);
  const activePalette = useLyricVisualizerStore((s) => s.activePalette);

  const setCurrentSongKey = useLyricVisualizerStore((s) => s.setCurrentSongKey);
  const setActivePalette = useLyricVisualizerStore((s) => s.setActivePalette);
  const setActiveLyrics = useLyricVisualizerStore((s) => s.setActiveLyrics);
  const setActiveTrack = useLyricVisualizerStore((s) => s.setActiveTrack);
  const setScreenLocked = useLyricVisualizerStore((s) => s.setScreenLocked);
  const setGameSuppressed = useLyricVisualizerStore((s) => s.setGameSuppressed);
  const openAmbientMode = useLyricVisualizerStore((s) => s.openAmbientMode);
  const broadcastSnapshot = useLyricVisualizerStore((s) => s.broadcastSnapshot);

  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const lyricsData = useLyricsStore((s) => s.lyricsData);
  const lyricsTrackId = useLyricsStore((s) => s.currentTrackId);

  // Initialize LyricsPipeline with Electron IPC disk cache adapter
  useEffect(() => {
    const api = typeof window !== 'undefined' ? (window as any).electronAPI : undefined;
    pipelineRef.current = new LyricsPipeline({
      enableLrclibFallback: true,
      cache: {
        getCachedLyrics: async (songKey: string) => {
          if (typeof api?.lvGetLyricsCache === 'function') {
            return (await api.lvGetLyricsCache(songKey)) ?? null;
          }
          return null;
        },
        setCachedLyrics: async (songKey: string, lyrics: Lyrics) => {
          if (typeof api?.lvSetLyricsCache === 'function') {
            await api.lvSetLyricsCache(songKey, lyrics);
          }
        },
      },
    });
  }, []);

  // Subscribe to Electron platform events (lock-screen 0% GPU pause, game guard, idle ambient)
  useEffect(() => {
    const api = typeof window !== 'undefined' ? (window as any).electronAPI : undefined;
    if (typeof api?.onLvPlatformEvent !== 'function') return;

    const unsub = api.onLvPlatformEvent((evt: { type: string; data?: any }) => {
      if (!evt || typeof evt !== 'object') return;
      if (evt.type === 'power-lock') {
        const locked = Boolean(evt.data?.locked);
        setScreenLocked(locked);
        rendererRef.current?.setLocked(locked);
      } else if (evt.type === 'game-guard') {
        setGameSuppressed(Boolean(evt.data?.suppressed ?? evt.data?.blocked));
      } else if (evt.type === 'displays-changed') {
        if (Array.isArray(evt.data?.monitors)) {
          useLyricVisualizerStore.setState({ availableMonitors: evt.data.monitors });
        }
      } else if (evt.type === 'ambient-closed') {
        useLyricVisualizerStore.setState({ isAmbientOpen: false });
      } else if (evt.type === 'idle-ambient') {
        openAmbientMode().catch(() => {});
      }
    });

    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [setScreenLocked, setGameSuppressed, openAmbientMode]);

  // Keep playback bridge sandbox mode synchronized with store config
  useEffect(() => {
    const bridge = getSharedWaveFormPlaybackBridge();
    bridge.setSandboxMode(config.sandboxEnabled);
  }, [config.sandboxEnabled]);

  // Keep SyncEngine per-song offset, auto-sync offset & vocal silence ranges synchronized
  useEffect(() => {
    syncEngineRef.current.setOffsetMs(currentSongOffsetMs);
    syncEngineRef.current.setAutoSyncOffsetMs(currentAutoSyncOffsetMs);
    syncEngineRef.current.setVocalSilenceRanges(vocalSilenceRanges);
  }, [currentSongOffsetMs, currentAutoSyncOffsetMs, vocalSilenceRanges]);

  // Resolve track lyrics & OKLCH palette whenever track, lyricsData, or sandbox mode changes
  useEffect(() => {
    const bridge = getSharedWaveFormPlaybackBridge();
    const abortController = new AbortController();

    const syncTrackAndLyrics = async (track: TrackInfo | null) => {
      if (config.sandboxEnabled) {
        lastTrackIdRef.current = STARLIGHT_HARBOR_TRACK.id;
        activeLyricsRef.current = STARLIGHT_HARBOR_LYRICS;
        setIsPlainUnsynced(false);
        setActiveTrack(STARLIGHT_HARBOR_TRACK);
        setActiveLyrics(STARLIGHT_HARBOR_LYRICS);
        setCurrentSongKey(STARLIGHT_HARBOR_TRACK.id).catch(() => {});
        rendererRef.current?.setLyrics(STARLIGHT_HARBOR_LYRICS);
        return;
      }

      const nextTrackId = track?.id ?? null;
      const trackChanged = nextTrackId !== lastTrackIdRef.current;

      // Immediately clear old lyrics on track change so previous song lines never linger
      if (trackChanged) {
        lastTrackIdRef.current = nextTrackId;
        activeLyricsRef.current = null;
        setIsPlainUnsynced(false);
        rendererRef.current?.setLyrics(null);
      }

      setActiveTrack(track);
      if (!track) {
        activeLyricsRef.current = null;
        setIsPlainUnsynced(false);
        setActiveLyrics(null);
        setCurrentSongKey(null).catch(() => {});
        rendererRef.current?.setLyrics(null);
        return;
      }

      const songKey = buildLyricsCacheKey(track);
      setCurrentSongKey(songKey).catch(() => {});

      // Prefer already loaded lyrics from useLyricsStore ONLY when they match the active track
      const lState = useLyricsStore.getState();
      const lyricsMatchesTrack = !lState.currentTrackId || lState.currentTrackId === track.id;
      const storeLyrics = lyricsMatchesTrack
        ? convertParsedLyricsToVisualizerLyrics(lState.lyricsData)
        : null;

      if (storeLyrics && storeLyrics.lines.length > 0) {
        activeLyricsRef.current = storeLyrics;
        setIsPlainUnsynced(storeLyrics.sourceKind === 'Unsynced');
        setActiveLyrics(storeLyrics);
        rendererRef.current?.setLyrics(storeLyrics);
      } else if (pipelineRef.current) {
        const resolved = await pipelineRef.current.resolveLyricsAsync(
          track,
          abortController.signal
        );
        if (!abortController.signal.aborted && lastTrackIdRef.current === track.id) {
          activeLyricsRef.current = resolved;
          setIsPlainUnsynced(resolved?.sourceKind === 'Unsynced');
          setActiveLyrics(resolved);
          rendererRef.current?.setLyrics(resolved);
        }
      }
    };

    const currentSnapTrack = bridge.currentSnapshot.track;
    syncTrackAndLyrics(currentSnapTrack).catch(() => {});

    // Extract OKLCH palette from album art
    const artUrl = config.sandboxEnabled
      ? null
      : currentTrack?.thumbnailUrl || (currentTrack as any)?.artworkUrl || currentSnapTrack?.artworkUrl;
    if (config.albumArtColorMatch && artUrl) {
      extractPaletteFromArtworkUrl(artUrl)
        .then((pal) => {
          if (!abortController.signal.aborted) {
            setActivePalette(pal);
          }
        })
        .catch(() => {
          if (!abortController.signal.aborted) {
            setActivePalette(DEMO_FALLBACK_PALETTE);
          }
        });
    } else {
      setActivePalette(DEMO_FALLBACK_PALETTE);
    }

    return () => {
      abortController.abort();
    };
  }, [
    config.sandboxEnabled,
    config.albumArtColorMatch,
    currentTrack?.videoId,
    currentTrack?.thumbnailUrl,
    lyricsData,
    lyricsTrackId,
    setActiveLyrics,
    setActivePalette,
    setActiveTrack,
    setCurrentSongKey,
  ]);

  const activeVariationId = resolveStyleVariationId(config.styleId, config.variationByStyle);

  const trackMetadata = useMemo<StyleTrackMetadata | null>(() => {
    if (config.sandboxEnabled) {
      return {
        id: STARLIGHT_HARBOR_TRACK.id,
        title: STARLIGHT_HARBOR_TRACK.title,
        artist: STARLIGHT_HARBOR_TRACK.artist,
        album: STARLIGHT_HARBOR_TRACK.album || 'Original Sandbox Sessions',
        bpm: liveBpm ?? 108,
      };
    }
    if (!currentTrack) return null;
    const rawYear = (currentTrack as any).year ?? (currentTrack as any).releaseYear;
    return {
      id: currentTrack.videoId || (currentTrack as any).id || currentTrack.title,
      title: currentTrack.title || 'Unknown Title',
      artist: currentTrack.artist || 'Unknown Artist',
      album: currentTrack.albumName || (currentTrack as any).album || '',
      year: rawYear ? String(rawYear) : undefined,
      bpm: liveBpm ?? ((currentTrack as any).bpm || undefined),
    };
  }, [config.sandboxEnabled, currentTrack, liveBpm]);

  // Mount LyricStageRenderer and ResizeObserver
  useEffect(() => {
    const canvas = canvas2dRef.current;
    const webGlCanvas = webGlCanvasRef.current;
    const shipCanvas = shipCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const bridge = getSharedWaveFormPlaybackBridge();
    const state = useLyricVisualizerStore.getState();
    const initialVarId = resolveStyleVariationId(state.config.styleId, state.config.variationByStyle);

    const renderer = new LyricStageRenderer({
      canvas,
      webGlCanvas,
      shipCanvas,
      styleId: state.config.styleId,
      variationId: initialVarId,
      fontFamily: getBundledFontCssFamily(state.config.fontId),
      fontSizeScale: state.config.fontSizeScale,
      palette: state.config.albumArtColorMatch ? state.activePalette : DEMO_FALLBACK_PALETTE,
      reduceMotion: state.config.reduceMotion,
      motionIntensity: state.config.motionIntensity,
      backgroundOpacity: state.config.backgroundOpacity,
      vignetteStrength: state.config.vignetteStrength,
      textAlign: state.config.textAlign,
      scriptMode: state.config.scriptMode,
      trackMetadata,
      isAmbientMode,
      isOverlayMode,
      isEmbeddedTransparent: blendWithParent,
      contentInsetLeft,
      audioReactive: state.config.audioReactive,
      onFollowStateChange: (following) => {
        setIsFollowingPlayback(following);
      },
      onSampleFrame: (outAudio) => {
        const snapshot = bridge.currentSnapshot;
        if (useLyricVisualizerStore.getState().config.audioReactive) {
          bridge.sampleAudioMetrics(outAudio);
        } else {
          outAudio.rmsLevel = 0;
          outAudio.bassEnergy = 0;
          outAudio.midEnergy = 0;
          outAudio.trebleEnergy = 0;
          outAudio.beatDetected = false;
          outAudio.beatStrength = 0;
        }

        if (typeof outAudio.estimatedBpm === 'number' && Number.isFinite(outAudio.estimatedBpm) && outAudio.estimatedBpm > 0) {
          const roundedBpm = Math.round(outAudio.estimatedBpm);
          if (roundedBpm !== lastBpmRef.current) {
            lastBpmRef.current = roundedBpm;
            setLiveBpm(roundedBpm);
          }
        }

        const lyrics = activeLyricsRef.current;
        const syncResult = syncEngineRef.current.update(snapshot, lyrics);

        // Throttled broadcast to open overlay / ambient windows (~20Hz) without per-frame allocation
        const bp = broadcastPayloadRef.current;
        bp.track = snapshot.track;
        bp.trackId = snapshot.track?.id ?? null;
        bp.lyrics = lyrics;
        bp.positionSeconds = syncResult.timeSeconds;
        bp.isPlaying = snapshot.isPlaying;
        bp.audio = outAudio;
        useLyricVisualizerStore.getState().broadcastSnapshot(bp);

        const out = sampleFrameOutRef.current;
        out.timeSeconds = syncResult.timeSeconds;
        out.activeLineIndex = syncResult.activeLineIndex;
        out.activeWordIndex = syncResult.activeWordIndex;
        out.wordProgress = syncResult.wordProgress;
        out.lineFadeAlpha = syncResult.lineFadeAlpha;
        out.didSeekThisFrame = syncResult.didSeekThisFrame;
        out.isInstrumentalGap = syncResult.isInstrumentalGap;
        out.gapProgress = syncResult.gapProgress;
        out.timeUntilNextLine = syncResult.timeUntilNextLine;
        out.hasLyrics = syncResult.hasLyrics;
        out.lastActiveLineIndex = syncResult.lastActiveLineIndex;
        out.nextLineIndex = syncResult.nextLineIndex;
        return out;
      },
    });

    rendererRef.current = renderer;
    renderer.setLyrics(activeLyricsRef.current);

    const updateSize = () => {
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      renderer.resize(Math.max(240, rect.width || 640), Math.max(180, rect.height || 420), dpr);
    };

    updateSize();
    renderer.start();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => updateSize());
      resizeObserver.observe(container);
    }

    return () => {
      resizeObserver?.disconnect();
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [isAmbientMode, isOverlayMode, blendWithParent]);

  // Non-passive wheel listener for smooth manual lyric scrolling
  useEffect(() => {
    const canvas = canvas2dRef.current;
    if (!canvas || isOverlayMode) return;
    const onWheel = (e: WheelEvent) => {
      const renderer = rendererRef.current;
      if (!renderer || !activeLyricsRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      renderer.scrollBy(e.deltaY);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [isOverlayMode]);

  // Synchronize live config changes to LyricStageRenderer without remounting
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setStyle(config.styleId);
    renderer.setVariation(activeVariationId);
    renderer.setTypography(getBundledFontCssFamily(config.fontId), config.fontSizeScale);
    renderer.setPalette(config.albumArtColorMatch ? activePalette : DEMO_FALLBACK_PALETTE);
    renderer.setVisualSettings({
      backgroundOpacity: config.backgroundOpacity,
      vignetteStrength: config.vignetteStrength,
      textAlign: config.textAlign,
    });
    renderer.setScriptMode(config.scriptMode);
    renderer.setTrackMetadata(trackMetadata);
    renderer.setModes({
      reduceMotion: config.reduceMotion,
      motionIntensity: config.motionIntensity,
      isAmbientMode,
      isOverlayMode,
      isEmbeddedTransparent: blendWithParent,
      audioReactive: config.audioReactive,
    });
    renderer.setContentInsetLeft(contentInsetLeft);
    renderer.setLocked(isScreenLocked);
  }, [
    config.styleId,
    activeVariationId,
    config.fontId,
    config.fontSizeScale,
    config.albumArtColorMatch,
    config.reduceMotion,
    config.motionIntensity,
    config.audioReactive,
    config.backgroundOpacity,
    config.vignetteStrength,
    config.textAlign,
    config.scriptMode,
    trackMetadata,
    activePalette,
    isAmbientMode,
    isOverlayMode,
    blendWithParent,
    contentInsetLeft,
    isScreenLocked,
  ]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || isOverlayMode) return;
    dragStateRef.current.active = true;
    dragStateRef.current.pointerId = e.pointerId;
    dragStateRef.current.startY = e.clientY;
    dragStateRef.current.lastY = e.clientY;
    dragStateRef.current.moved = false;
    dragStateRef.current.suppressClick = false;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const renderer = rendererRef.current;
    const canvas = canvas2dRef.current;
    if (!renderer || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hovered = renderer.setPointerPosition(x, y);
    setIsHoveringLine(hovered >= 0);

    const drag = dragStateRef.current;
    if (drag.active && drag.pointerId === e.pointerId) {
      const totalDy = Math.abs(e.clientY - drag.startY);
      if (!drag.moved && totalDy > 6) {
        drag.moved = true;
        drag.suppressClick = true;
        setIsDraggingStage(true);
      }
      if (drag.moved) {
        const deltaY = drag.lastY - e.clientY;
        drag.lastY = e.clientY;
        renderer.scrollBy(deltaY);
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragStateRef.current;
    if (drag.active && drag.pointerId === e.pointerId) {
      drag.active = false;
      setIsDraggingStage(false);
    }
  };

  const handlePointerLeave = () => {
    dragStateRef.current.active = false;
    setIsDraggingStage(false);
    setIsHoveringLine(false);
    rendererRef.current?.clearPointerPosition();
  };

  // Click-line-to-seek handler
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragStateRef.current.suppressClick) {
      dragStateRef.current.suppressClick = false;
      return;
    }
    const renderer = rendererRef.current;
    const canvas = canvas2dRef.current;
    const lyrics = activeLyricsRef.current;
    if (!renderer || !canvas || !lyrics || lyrics.sourceKind === 'Unsynced') return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const lineIndex = renderer.findLineAtPoint(x, y);
    if (lineIndex === null || lineIndex < 0 || lineIndex >= lyrics.lines.length) return;

    const targetLine = lyrics.lines[lineIndex];
    const targetSec = Math.max(0, targetLine.startSeconds);

    const bridge = getSharedWaveFormPlaybackBridge();
    bridge.seek(targetSec);
    renderer.resumeFollowPlayback();
    broadcastSnapshot({ positionSeconds: targetSec }, true);
  };

  const handleStageContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (onContextMenu) {
      onContextMenu(e);
    } else {
      setInternalMenu({ isOpen: true, x: e.clientX, y: e.clientY });
    }
  };

  const syncTheme = useMemo(
    () =>
      getSyncButtonTheme(
        config.styleId,
        activeVariationId,
        config.albumArtColorMatch ? activePalette : DEMO_FALLBACK_PALETTE
      ),
    [config.styleId, activeVariationId, config.albumArtColorMatch, activePalette]
  );

  return (
    <div
      ref={containerRef}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onContextMenu={handleStageContextMenu}
      style={{
        fontFamily: SF_PRO_DISPLAY_STACK,
        background: blendWithParent ? 'transparent' : (activePalette?.bgDeep || '#08080c'),
      }}
      className={`${
        /\b(absolute|fixed|relative|sticky)\b/.test(className)
          ? ''
          : isBackdrop
          ? 'absolute inset-0'
          : 'relative'
      } w-full h-full flex flex-col overflow-hidden select-none ${
        blendWithParent ? 'bg-transparent' : isBackdrop ? '' : 'rounded-3xl'
      } ${className}`}
    >
      {/* WebGL2 Background Shader Layer */}
      <canvas
        ref={webGlCanvasRef}
        className="absolute inset-0 block w-full h-full pointer-events-none z-0 bg-transparent"
      />

      {/* Three.js 3D Starfighter & Asteroid Layer */}
      <canvas
        ref={shipCanvasRef}
        className="absolute inset-0 block w-full h-full pointer-events-none z-[1] bg-transparent"
      />

      {/* Primary 2D Lyric Stage Canvas (Click-line-to-seek, wheel & drag scroll enabled) */}
      <canvas
        ref={canvas2dRef}
        onClick={handleCanvasClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        style={{
          cursor: isDraggingStage ? 'grabbing' : isHoveringLine ? 'pointer' : 'default',
          touchAction: 'none',
        }}
        className="absolute inset-0 block w-full h-full z-[2] bg-transparent"
      />

      {/* Theme-adapted Floating "Sync with Playback" button when manually browsing */}
      {!isFollowingPlayback && !isOverlayMode && (
        <button
          type="button"
          data-testid="visualizer-sync-playback-btn"
          onClick={(e) => {
            e.stopPropagation();
            rendererRef.current?.resumeFollowPlayback();
          }}
          style={{
            ...syncTheme.style,
            left:
              contentInsetLeft > 2
                ? `calc(${Math.round(contentInsetLeft)}px + (100% - ${Math.round(contentInsetLeft)}px) / 2)`
                : '50%',
            transform: 'translateX(-50%)',
          }}
          className={`absolute ${
            hasBottomDock ? 'bottom-24' : showControls ? 'bottom-20' : 'bottom-6'
          } z-20 inline-flex items-center gap-2 transition-all duration-200 hover:scale-[1.03] active:scale-[0.97] cursor-pointer`}
        >
          {syncTheme.showDot && (
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: syncTheme.dotColor }}
            />
          )}
          <span>{syncTheme.label}</span>
        </button>
      )}

      {/* Plain unsynced lyrics fallback notice inside Visualizer */}
      {isPlainUnsynced && !config.sandboxEnabled && !isOverlayMode && (
        <div
          data-testid="visualizer-plain-lyrics-notice"
          style={{
            left:
              contentInsetLeft > 2
                ? `calc(${Math.round(contentInsetLeft)}px + (100% - ${Math.round(contentInsetLeft)}px) / 2)`
                : '50%',
            transform: 'translate(-50%, -50%)',
          }}
          className="absolute top-1/2 z-20 flex flex-col items-center gap-3 px-6 py-5 rounded-2xl bg-black/55 border border-white/15 backdrop-blur-xl text-center shadow-2xl"
        >
          <p className="text-sm font-semibold text-white">No synced lyrics available</p>
          <p className="text-xs text-white/65 max-w-xs">
            Only plain text lyrics were found for this track.
          </p>
          {onSwitchToClassic && (
            <button
              type="button"
              onClick={onSwitchToClassic}
              className="px-3.5 py-1.5 rounded-full bg-white text-black text-xs font-bold hover:scale-[1.03] active:scale-[0.97] transition-all cursor-pointer"
            >
              View Plain Lyrics
            </button>
          )}
        </div>
      )}

      {/* Small clear Sandbox Demo badge when Sandbox mode is active */}
      {config.sandboxEnabled && (
        <div
          data-testid="sandbox-demo-badge"
          className="absolute top-3 left-3 z-10 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/25 border border-amber-400/50 backdrop-blur-md text-amber-100 text-[11px] font-semibold shadow-md pointer-events-none"
        >
          <Sparkles size={12} className="text-amber-300" />
          <span>Demo: Starlight Harbor (Original)</span>
        </div>
      )}

      {/* Optional VisualizerControlBar when explicitly enabled */}
      {showControls && (
        <div
          className={`absolute inset-x-3 bottom-3 z-20 transition-all duration-200 ${
            isHovered || config.sandboxEnabled
              ? 'opacity-100 translate-y-0'
              : 'opacity-85 hover:opacity-100 translate-y-0'
          }`}
        >
          <VisualizerControlBar onSwitchToClassic={onSwitchToClassic} />
        </div>
      )}

      {/* Built-in Glassmorphic VisualizerContextMenu when parent doesn't supply custom handler */}
      {!onContextMenu && (
        <VisualizerContextMenu
          isOpen={internalMenu.isOpen}
          x={internalMenu.x}
          y={internalMenu.y}
          onClose={() => setInternalMenu((prev) => ({ ...prev, isOpen: false }))}
          isFullBleed={isFullBleed}
          onToggleFullBleed={onToggleFullBleed}
          context="now-playing"
        />
      )}
    </div>
  );
};
