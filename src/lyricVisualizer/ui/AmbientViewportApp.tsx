// src/lyricVisualizer/ui/AmbientViewportApp.tsx
// Fullscreen GPU Ambient Mode takeover viewport (in-app portal in App.tsx or standalone #/ambient).
// When inAppPortal=true, binds directly to live playerStore, lyricsStore, AudioEngine, and bridge
// for 100% live sync with zero IPC drift. NEVER falls back to Starlight Harbor unless sandboxEnabled.
// Supports power-lock 0% GPU halt (setLocked(locked)), Escape exit, auto-hiding minimal bottom HUD,
// and glassmorphic right-click VisualizerContextMenu.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Minimize2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Sparkles,
} from 'lucide-react';
import {
  type AudioFrameMetrics,
  buildLyricsCacheKey,
  DEMO_FALLBACK_PALETTE,
  extractPaletteFromArtworkUrl,
  getBundledFontCssFamily,
  getSyncButtonTheme,
  type Lyrics,
  LyricsPipeline,
  type PlaybackSnapshot,
  resolveStyleVariationId,
  SF_PRO_DISPLAY_STACK,
  STARLIGHT_HARBOR_LYRICS,
  STARLIGHT_HARBOR_TRACK,
  type StyleTrackMetadata,
  SyncEngine,
  type TrackInfo,
  VISUAL_STYLE_DEFINITIONS,
  type VisualStyleId,
} from '../core';
import { type LyricStageFrameInput, LyricStageRenderer } from '../rendering';
import {
  type LyricVisualizerBroadcastPayload,
  useLyricVisualizerStore,
} from '../state/lyricVisualizerStore';
import {
  convertParsedLyricsToVisualizerLyrics,
  getSharedWaveFormPlaybackBridge,
  songToTrackInfo,
} from '../bridge/waveFormPlaybackBridge';
import { useQueueStore } from '../../state/queueStore';
import { usePlayerStore } from '../../state/playerStore';
import { useLyricsStore } from '../../state/lyricsStore';
import { VisualizerContextMenu } from '../../ui/common/VisualizerContextMenu';

export interface AmbientViewportAppProps {
  inAppPortal?: boolean;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export const AmbientViewportApp: React.FC<AmbientViewportAppProps> = ({
  inAppPortal = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const webGlCanvasRef = useRef<HTMLCanvasElement>(null);
  const shipCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<LyricStageRenderer | null>(null);
  const syncEngineRef = useRef<SyncEngine>(new SyncEngine());
  const pipelineRef = useRef<LyricsPipeline | null>(null);
  const activeLyricsRef = useRef<Lyrics | null>(null);
  const lastTrackIdRef = useRef<string | null>(null);
  const lastRevisionIdRef = useRef<number>(0);

  const initialSandbox = useLyricVisualizerStore.getState().config.sandboxEnabled;

  const [ipcIsPlaying, setIpcIsPlaying] = useState(initialSandbox);
  const [showHud, setShowHud] = useState(true);
  const [isFollowingPlayback, setIsFollowingPlayback] = useState(true);
  const [isHoveringLine, setIsHoveringLine] = useState(false);
  const [isDraggingStage, setIsDraggingStage] = useState(false);
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
  const [vizMenu, setVizMenu] = useState<{ isOpen: boolean; x: number; y: number }>({
    isOpen: false,
    x: 0,
    y: 0,
  });
  const hudTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const snapshotRef = useRef<PlaybackSnapshot>({
    track: initialSandbox ? STARLIGHT_HARBOR_TRACK : null,
    positionSeconds: 0,
    isPlaying: initialSandbox,
    playbackRate: 1,
    timestampMs: nowMs(),
  });
  const latestAudioRef = useRef<AudioFrameMetrics>({
    rmsLevel: 0,
    bassEnergy: 0,
    midEnergy: 0,
    trebleEnergy: 0,
    beatDetected: false,
  });
  const sampleFrameOutRef = useRef<LyricStageFrameInput>({
    timeSeconds: 0,
    activeLineIndex: -1,
    activeWordIndex: -1,
    wordProgress: 0,
    lineFadeAlpha: 1,
    didSeekThisFrame: false,
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

  const config = useLyricVisualizerStore((s) => s.config);
  const activeTrack = useLyricVisualizerStore((s) => s.activeTrack);
  const activeLyrics = useLyricVisualizerStore((s) => s.activeLyrics);
  const activePalette = useLyricVisualizerStore((s) => s.activePalette);
  const currentSongOffsetMs = useLyricVisualizerStore((s) => s.currentSongOffsetMs);
  const currentAutoSyncOffsetMs = useLyricVisualizerStore((s) => s.currentAutoSyncOffsetMs);
  const vocalSilenceRanges = useLyricVisualizerStore((s) => s.vocalSilenceRanges);
  const isScreenLocked = useLyricVisualizerStore((s) => s.isScreenLocked);

  const applyBroadcastPayload = useLyricVisualizerStore((s) => s.applyBroadcastPayload);
  const setStyleId = useLyricVisualizerStore((s) => s.setStyleId);
  const cycleStyle = useLyricVisualizerStore((s) => s.cycleStyle);
  const closeAmbientMode = useLyricVisualizerStore((s) => s.closeAmbientMode);
  const setScreenLocked = useLyricVisualizerStore((s) => s.setScreenLocked);
  const setActiveTrack = useLyricVisualizerStore((s) => s.setActiveTrack);
  const setActiveLyrics = useLyricVisualizerStore((s) => s.setActiveLyrics);
  const setActivePalette = useLyricVisualizerStore((s) => s.setActivePalette);
  const setCurrentSongKey = useLyricVisualizerStore((s) => s.setCurrentSongKey);

  // Live store selectors used when running as in-app portal
  const liveTrack = usePlayerStore((s) => s.currentTrack);
  const livePlaybackState = usePlayerStore((s) => s.playbackState);
  const liveDurationMs = usePlayerStore((s) => s.durationMs);
  const liveLyricsData = useLyricsStore((s) => s.lyricsData);
  const liveLyricsTrackId = useLyricsStore((s) => s.currentTrackId);
  const fetchLyricsForTrack = useLyricsStore((s) => s.fetchLyricsForTrack);

  const isPlaying = inAppPortal
    ? config.sandboxEnabled
      ? ipcIsPlaying
      : livePlaybackState === 'PLAYING'
    : ipcIsPlaying;

  // Initialize LyricsPipeline for in-app portal resolution
  useEffect(() => {
    if (!inAppPortal) return;
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
  }, [inAppPortal]);

  // Keep bridge sandbox state synced in portal mode
  useEffect(() => {
    if (!inAppPortal) return;
    const bridge = getSharedWaveFormPlaybackBridge();
    bridge.setSandboxMode(config.sandboxEnabled);
    setIpcIsPlaying(bridge.currentSnapshot.isPlaying);
    const unsubState = bridge.onPlaybackStateChanged((playing) => {
      setIpcIsPlaying(playing);
    });
    return unsubState;
  }, [inAppPortal, config.sandboxEnabled]);

  // Ensure lyrics are fetched for current track when running as in-app portal
  useEffect(() => {
    if (!inAppPortal || config.sandboxEnabled) return;
    if (liveTrack) {
      fetchLyricsForTrack(liveTrack);
    }
  }, [
    inAppPortal,
    config.sandboxEnabled,
    liveTrack?.videoId,
    liveTrack?.title,
    liveTrack?.artist,
    fetchLyricsForTrack,
  ]);

  // Live sync track, lyrics, and OKLCH palette in in-app portal mode
  useEffect(() => {
    if (!inAppPortal) return;
    const abortController = new AbortController();

    const syncPortalState = async () => {
      if (config.sandboxEnabled) {
        lastTrackIdRef.current = STARLIGHT_HARBOR_TRACK.id;
        activeLyricsRef.current = STARLIGHT_HARBOR_LYRICS;
        setActiveTrack(STARLIGHT_HARBOR_TRACK);
        setActiveLyrics(STARLIGHT_HARBOR_LYRICS);
        setCurrentSongKey(STARLIGHT_HARBOR_TRACK.id).catch(() => {});
        rendererRef.current?.setLyrics(STARLIGHT_HARBOR_LYRICS);
        setActivePalette(DEMO_FALLBACK_PALETTE);
        return;
      }

      const trackInfo: TrackInfo | null = songToTrackInfo(liveTrack, null, liveDurationMs);
      const nextTrackId = trackInfo?.id ?? null;

      if (nextTrackId !== lastTrackIdRef.current) {
        lastTrackIdRef.current = nextTrackId;
        activeLyricsRef.current = null;
        rendererRef.current?.setLyrics(null);
      }

      setActiveTrack(trackInfo);

      if (!trackInfo) {
        activeLyricsRef.current = null;
        setActiveLyrics(null);
        setCurrentSongKey(null).catch(() => {});
        rendererRef.current?.setLyrics(null);
        setActivePalette(DEMO_FALLBACK_PALETTE);
        return;
      }

      setCurrentSongKey(buildLyricsCacheKey(trackInfo)).catch(() => {});

      const lState = useLyricsStore.getState();
      const matchesTrack = !lState.currentTrackId || lState.currentTrackId === trackInfo.id;
      const storeLyrics = matchesTrack
        ? convertParsedLyricsToVisualizerLyrics(lState.lyricsData)
        : null;

      if (storeLyrics && storeLyrics.lines.length > 0) {
        activeLyricsRef.current = storeLyrics;
        setActiveLyrics(storeLyrics);
        rendererRef.current?.setLyrics(storeLyrics);
      } else if (pipelineRef.current) {
        const resolved = await pipelineRef.current.resolveLyricsAsync(
          trackInfo,
          abortController.signal
        );
        if (!abortController.signal.aborted && lastTrackIdRef.current === trackInfo.id) {
          activeLyricsRef.current = resolved;
          setActiveLyrics(resolved);
          rendererRef.current?.setLyrics(resolved);
        }
      }

      const artUrl = liveTrack?.thumbnailUrl || (liveTrack as any)?.artworkUrl || trackInfo.artworkUrl;
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
    };

    syncPortalState().catch(() => {});

    return () => {
      abortController.abort();
    };
  }, [
    inAppPortal,
    config.sandboxEnabled,
    config.albumArtColorMatch,
    liveTrack?.videoId,
    liveTrack?.thumbnailUrl,
    liveDurationMs,
    liveLyricsData,
    liveLyricsTrackId,
    setActiveTrack,
    setActiveLyrics,
    setActivePalette,
    setCurrentSongKey,
  ]);

  const handleCloseAmbient = useCallback(() => {
    setVizMenu((prev) => (prev.isOpen ? { ...prev, isOpen: false } : prev));
    const api = typeof window !== 'undefined' ? (window as any).electronAPI : undefined;
    if (!inAppPortal) {
      try {
        api?.lvCloseAmbient?.();
      } catch {
        // Ignore in browser/test mode
      }
    }
    closeAmbientMode().catch(() => {});
  }, [inAppPortal, closeAmbientMode]);

  // Escape key closes Ambient Mode (or closes context menu first)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.code === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (vizMenu.isOpen) {
          setVizMenu((prev) => ({ ...prev, isOpen: false }));
          return;
        }
        handleCloseAmbient();
      } else if (e.key === 'ArrowRight') {
        cycleStyle(1);
      } else if (e.key === 'ArrowLeft') {
        cycleStyle(-1);
      } else if (e.key === ' ') {
        e.preventDefault();
        getSharedWaveFormPlaybackBridge().togglePlay();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [handleCloseAmbient, cycleStyle, vizMenu.isOpen]);

  // Auto-hide bottom hover bar after 3s of mouse inactivity
  const bumpHudVisibility = useCallback(() => {
    setShowHud(true);
    if (hudTimeoutRef.current) {
      clearTimeout(hudTimeoutRef.current);
    }
    hudTimeoutRef.current = setTimeout(() => {
      setShowHud(false);
    }, 3000);
  }, []);

  useEffect(() => {
    bumpHudVisibility();
    return () => {
      if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
    };
  }, [bumpHudVisibility]);

  // Subscribe to IPC broadcast state (standalone window) and platform events (power-lock -> setLocked(true))
  useEffect(() => {
    const api = typeof window !== 'undefined' ? (window as any).electronAPI : undefined;

    const handleIncomingPayload = (payload: LyricVisualizerBroadcastPayload) => {
      if (!payload || typeof payload !== 'object') return;
      if (
        typeof payload.revisionId === 'number' &&
        lastRevisionIdRef.current > 0 &&
        payload.revisionId < lastRevisionIdRef.current
      ) {
        return;
      }
      if (typeof payload.revisionId === 'number') {
        lastRevisionIdRef.current = payload.revisionId;
      }

      const incomingTrackId =
        payload.trackId !== undefined ? payload.trackId : payload.track?.id ?? null;
      if (incomingTrackId !== lastTrackIdRef.current) {
        lastTrackIdRef.current = incomingTrackId;
        activeLyricsRef.current = payload.lyrics ?? null;
        rendererRef.current?.setLyrics(payload.lyrics ?? null);
      } else if (payload.lyrics !== undefined) {
        activeLyricsRef.current = payload.lyrics;
      }

      applyBroadcastPayload(payload);
      syncEngineRef.current.setOffsetMs(payload.songOffsetMs ?? 0);
      syncEngineRef.current.setAutoSyncOffsetMs(payload.autoSyncOffsetMs ?? 0);
      setIpcIsPlaying(Boolean(payload.isPlaying));
      snapshotRef.current = {
        track: payload.track ?? null,
        positionSeconds: payload.positionSeconds ?? 0,
        isPlaying: Boolean(payload.isPlaying),
        playbackRate: 1,
        timestampMs: nowMs(),
      };
      if (payload.audio) {
        latestAudioRef.current = { ...payload.audio };
      }
      if (typeof payload.isScreenLocked === 'boolean') {
        rendererRef.current?.setLocked(payload.isScreenLocked);
      }
    };

    const unsubBroadcast =
      !inAppPortal && typeof api?.onLvStateBroadcast === 'function'
        ? api.onLvStateBroadcast(handleIncomingPayload)
        : null;

    if (!inAppPortal && typeof api?.lvRequestSnapshot === 'function') {
      Promise.resolve(api.lvRequestSnapshot())
        .then((snap: LyricVisualizerBroadcastPayload | null) => {
          if (snap) handleIncomingPayload(snap);
        })
        .catch(() => {});
    }

    const unsubPlatform =
      typeof api?.onLvPlatformEvent === 'function'
        ? api.onLvPlatformEvent((evt: { type: string; data?: any }) => {
            if (!evt || typeof evt !== 'object') return;
            if (evt.type === 'power-lock') {
              const locked = Boolean(evt.data?.locked);
              setScreenLocked(locked);
              // Immediately halt rAF and GPU shaders (0% GPU usage on lock screen)
              rendererRef.current?.setLocked(locked);
            } else if (evt.type === 'ambient-closed') {
              useLyricVisualizerStore.setState({ isAmbientOpen: false });
            }
          })
        : null;

    return () => {
      if (typeof unsubBroadcast === 'function') unsubBroadcast();
      if (typeof unsubPlatform === 'function') unsubPlatform();
    };
  }, [inAppPortal, applyBroadcastPayload, setScreenLocked]);

  const activeVariationId = resolveStyleVariationId(config.styleId, config.variationByStyle);

  const displayTrack: TrackInfo | null = config.sandboxEnabled
    ? STARLIGHT_HARBOR_TRACK
    : inAppPortal && liveTrack
    ? songToTrackInfo(liveTrack, null, liveDurationMs)
    : activeTrack;

  const trackMetadata = useMemo<StyleTrackMetadata | null>(() => {
    if (!displayTrack) return null;
    return {
      id: displayTrack.id,
      title: displayTrack.title || 'Unknown Title',
      artist: displayTrack.artist || 'Unknown Artist',
      album: displayTrack.album || '',
      year: displayTrack.year,
      bpm: liveBpm ?? displayTrack.bpm ?? (config.sandboxEnabled ? 108 : undefined),
    };
  }, [displayTrack, liveBpm, config.sandboxEnabled]);

  // Mount fullscreen GPU LyricStageRenderer
  useEffect(() => {
    const canvas = canvasRef.current;
    const webGlCanvas = webGlCanvasRef.current;
    const shipCanvas = shipCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const bridge = getSharedWaveFormPlaybackBridge();
    const state = useLyricVisualizerStore.getState();
    const initialLyrics =
      state.activeLyrics ?? (state.config.sandboxEnabled ? STARLIGHT_HARBOR_LYRICS : null);
    activeLyricsRef.current = initialLyrics;

    const renderer = new LyricStageRenderer({
      canvas,
      webGlCanvas,
      shipCanvas,
      styleId: state.config.styleId,
      variationId: resolveStyleVariationId(state.config.styleId, state.config.variationByStyle),
      fontFamily: getBundledFontCssFamily(state.config.fontId),
      fontSizeScale: state.config.fontSizeScale,
      palette: state.config.albumArtColorMatch ? state.activePalette : DEMO_FALLBACK_PALETTE,
      reduceMotion: state.config.reduceMotion,
      motionIntensity: state.config.motionIntensity,
      backgroundOpacity: state.config.backgroundOpacity,
      vignetteStrength: state.config.vignetteStrength,
      textAlign: state.config.textAlign,
      trackMetadata,
      isAmbientMode: true,
      isOverlayMode: false,
      audioReactive: state.config.audioReactive,
      onFollowStateChange: (following) => {
        setIsFollowingPlayback(following);
      },
      onSampleFrame: (outAudio) => {
        const curState = useLyricVisualizerStore.getState();
        let sync;

        if (inAppPortal) {
          const snapshot = bridge.currentSnapshot;
          if (curState.config.audioReactive) {
            bridge.sampleAudioMetrics(outAudio);
          } else {
            outAudio.rmsLevel = 0;
            outAudio.bassEnergy = 0;
            outAudio.midEnergy = 0;
            outAudio.trebleEnergy = 0;
            outAudio.beatDetected = false;
            outAudio.beatStrength = 0;
          }

          if (
            typeof outAudio.estimatedBpm === 'number' &&
            Number.isFinite(outAudio.estimatedBpm) &&
            outAudio.estimatedBpm > 0
          ) {
            const rounded = Math.round(outAudio.estimatedBpm);
            if (rounded !== lastBpmRef.current) {
              lastBpmRef.current = rounded;
              setLiveBpm(rounded);
            }
          }

          const lyrics =
            activeLyricsRef.current ??
            (curState.config.sandboxEnabled ? STARLIGHT_HARBOR_LYRICS : null);
          sync = syncEngineRef.current.update(snapshot, lyrics);

          const bp = broadcastPayloadRef.current;
          bp.track = snapshot.track;
          bp.trackId = snapshot.track?.id ?? null;
          bp.lyrics = lyrics;
          bp.positionSeconds = sync.timeSeconds;
          bp.isPlaying = snapshot.isPlaying;
          bp.audio = outAudio;
          curState.broadcastSnapshot(bp);
        } else {
          const srcAudio = latestAudioRef.current;
          outAudio.rmsLevel = curState.config.audioReactive ? srcAudio.rmsLevel : 0;
          outAudio.bassEnergy = curState.config.audioReactive ? srcAudio.bassEnergy : 0;
          outAudio.midEnergy = curState.config.audioReactive ? srcAudio.midEnergy : 0;
          outAudio.trebleEnergy = curState.config.audioReactive ? srcAudio.trebleEnergy : 0;
          outAudio.beatDetected = curState.config.audioReactive ? srcAudio.beatDetected : false;
          outAudio.estimatedBpm = srcAudio.estimatedBpm;
          outAudio.beatStrength = curState.config.audioReactive ? srcAudio.beatStrength : 0;

          const lyrics =
            curState.activeLyrics ??
            (curState.config.sandboxEnabled ? STARLIGHT_HARBOR_LYRICS : null);
          sync = syncEngineRef.current.update(snapshotRef.current, lyrics);
        }

        const out = sampleFrameOutRef.current;
        out.timeSeconds = sync.timeSeconds;
        out.activeLineIndex = sync.activeLineIndex;
        out.activeWordIndex = sync.activeWordIndex;
        out.wordProgress = sync.wordProgress;
        out.lineFadeAlpha = sync.lineFadeAlpha;
        out.didSeekThisFrame = sync.didSeekThisFrame;
        return out;
      },
    });

    renderer.setLyrics(initialLyrics);
    rendererRef.current = renderer;

    const handleResize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      renderer.resize(
        Math.max(480, rect.width || window.innerWidth || 1920),
        Math.max(320, rect.height || window.innerHeight || 1080),
        dpr
      );
    };

    handleResize();
    renderer.start();

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [inAppPortal]);

  // Non-passive wheel listener for smooth manual lyric scrolling in Ambient mode
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      const renderer = rendererRef.current;
      if (!renderer || !activeLyricsRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      renderer.scrollBy(e.deltaY);
      bumpHudVisibility();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [bumpHudVisibility]);

  // Synchronize store updates & lock-screen 0% GPU pause to renderer
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    syncEngineRef.current.setOffsetMs(currentSongOffsetMs);
    syncEngineRef.current.setAutoSyncOffsetMs(currentAutoSyncOffsetMs);
    syncEngineRef.current.setVocalSilenceRanges(vocalSilenceRanges);
    renderer.setStyle(config.styleId);
    renderer.setVariation(activeVariationId);
    renderer.setTypography(getBundledFontCssFamily(config.fontId), config.fontSizeScale);
    renderer.setPalette(config.albumArtColorMatch ? activePalette : DEMO_FALLBACK_PALETTE);
    renderer.setVisualSettings({
      backgroundOpacity: config.backgroundOpacity,
      vignetteStrength: config.vignetteStrength,
      textAlign: config.textAlign,
    });
    renderer.setTrackMetadata(trackMetadata);
    const resolvedLyrics =
      activeLyrics ?? (config.sandboxEnabled ? STARLIGHT_HARBOR_LYRICS : null);
    activeLyricsRef.current = resolvedLyrics;
    renderer.setLyrics(resolvedLyrics);
    renderer.setModes({
      reduceMotion: config.reduceMotion,
      motionIntensity: config.motionIntensity,
      isAmbientMode: true,
      isOverlayMode: false,
      audioReactive: config.audioReactive,
    });
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
    config.sandboxEnabled,
    trackMetadata,
    activePalette,
    activeLyrics,
    currentSongOffsetMs,
    isScreenLocked,
  ]);

  const handleTogglePlay = () => {
    const bridge = getSharedWaveFormPlaybackBridge();
    bridge.togglePlay();
    if (!inAppPortal || config.sandboxEnabled) {
      const nextPlaying = !isPlaying;
      setIpcIsPlaying(nextPlaying);
      snapshotRef.current = {
        ...snapshotRef.current,
        isPlaying: nextPlaying,
        timestampMs: nowMs(),
      };
    }
  };

  const handlePrevious = () => {
    if (config.sandboxEnabled) {
      getSharedWaveFormPlaybackBridge().seek(0);
      snapshotRef.current = {
        ...snapshotRef.current,
        positionSeconds: 0,
        timestampMs: nowMs(),
        didSeek: true,
      };
      return;
    }
    useQueueStore.getState().previousTrack();
  };

  const handleNext = () => {
    if (config.sandboxEnabled) {
      getSharedWaveFormPlaybackBridge().seek(0);
      snapshotRef.current = {
        ...snapshotRef.current,
        positionSeconds: 0,
        timestampMs: nowMs(),
        didSeek: true,
      };
      return;
    }
    useQueueStore.getState().advanceQueue();
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    dragStateRef.current.active = true;
    dragStateRef.current.pointerId = e.pointerId;
    dragStateRef.current.startY = e.clientY;
    dragStateRef.current.lastY = e.clientY;
    dragStateRef.current.moved = false;
    dragStateRef.current.suppressClick = false;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;
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
        bumpHudVisibility();
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

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragStateRef.current.suppressClick) {
      dragStateRef.current.suppressClick = false;
      return;
    }
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;
    const lyrics = activeLyricsRef.current;
    if (!renderer || !canvas || !lyrics || lyrics.sourceKind === 'Unsynced') return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const lineIndex = renderer.findLineAtPoint(x, y);
    if (lineIndex === null || lineIndex < 0 || lineIndex >= lyrics.lines.length) return;

    const targetSec = Math.max(0, lyrics.lines[lineIndex].startSeconds);
    const bridge = getSharedWaveFormPlaybackBridge();
    bridge.seek(targetSec);
    renderer.resumeFollowPlayback();
    useLyricVisualizerStore.getState().broadcastSnapshot({ positionSeconds: targetSec }, true);
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    bumpHudVisibility();
    setVizMenu({ isOpen: true, x: e.clientX, y: e.clientY });
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

  const hudVisible = showHud || vizMenu.isOpen;

  return (
    <div
      ref={containerRef}
      data-testid="ambient-viewport-root"
      data-ambient-portal={inAppPortal ? 'true' : 'false'}
      onMouseMove={bumpHudVisibility}
      onContextMenu={handleContextMenu}
      style={{
        fontFamily: SF_PRO_DISPLAY_STACK,
        backgroundColor: activePalette?.bgDeep || '#050508',
      }}
      className={`fixed inset-0 w-screen h-screen overflow-hidden select-none ${
        inAppPortal ? 'z-[120]' : 'z-50'
      }`}
    >
      {/* WebGL2 Fullscreen Ambient Shader Layer */}
      <canvas
        ref={webGlCanvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-0"
      />

      {/* Three.js 3D Starfighter & Asteroid Layer */}
      <canvas
        ref={shipCanvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-[1] bg-transparent"
      />

      {/* Primary 2D Lyric Stage Canvas */}
      <canvas
        ref={canvasRef}
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
        className="relative z-[2] w-full h-full"
      />

      {/* Theme-adapted Floating "Sync with Playback" button when manually browsing */}
      {!isFollowingPlayback && (
        <button
          type="button"
          data-testid="ambient-sync-playback-btn"
          onClick={(e) => {
            e.stopPropagation();
            rendererRef.current?.resumeFollowPlayback();
          }}
          style={{
            ...syncTheme.style,
            left: '50%',
            transform: 'translateX(-50%)',
          }}
          className="absolute bottom-24 z-20 inline-flex items-center gap-2 transition-all duration-200 hover:scale-[1.03] active:scale-[0.97] cursor-pointer"
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

      {/* Top-Left Track Info & Sandbox Badge */}
      <div
        className={`absolute top-6 left-8 z-20 flex items-center gap-3 transition-opacity duration-300 ${
          hudVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="px-4 py-2 rounded-2xl bg-neutral-950/70 border border-white/15 backdrop-blur-xl text-white">
          <div className="text-sm font-bold truncate max-w-md">
            {displayTrack?.title || 'No Track Playing'}
          </div>
          <div className="text-xs text-white/65 truncate max-w-md">
            {displayTrack?.artist || 'WaveForm'}
          </div>
        </div>

        {config.sandboxEnabled && (
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/25 border border-amber-400/50 backdrop-blur-md text-amber-100 text-xs font-semibold">
            <Sparkles size={13} className="text-amber-300" />
            <span>Demo: Starlight Harbor (Original)</span>
          </div>
        )}
      </div>

      {/* Minimal Auto-Hiding Bottom Hover Bar for Style / Pause / Skip / Exit */}
      <div
        data-testid="ambient-bottom-hover-bar"
        className={`absolute bottom-7 left-1/2 -translate-x-1/2 z-20 flex items-center gap-4 px-6 py-3 rounded-full bg-neutral-950/80 border border-white/15 backdrop-blur-2xl text-white shadow-2xl transition-all duration-300 ${
          hudVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none'
        }`}
      >
        {/* Style Selector */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => cycleStyle(-1)}
            className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white cursor-pointer"
            title="Previous Visual Style"
          >
            <ChevronLeft size={15} />
          </button>

          <select
            aria-label="Ambient Visual Style"
            value={config.styleId}
            onChange={(e) => setStyleId(e.target.value as VisualStyleId)}
            className="bg-white/10 border border-white/15 rounded-full px-3 py-1 text-xs font-semibold text-white focus:outline-none cursor-pointer"
          >
            {VISUAL_STYLE_DEFINITIONS.map((s, i) => (
              <option key={s.id} value={s.id} className="bg-neutral-900 text-white">
                {i + 1}. {s.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => cycleStyle(1)}
            className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white cursor-pointer"
            title="Next Visual Style"
          >
            <ChevronRight size={15} />
          </button>
        </div>

        {/* Transport Controls: Skip Back / Pause-Play / Skip Forward */}
        <div className="flex items-center gap-2 px-3 border-x border-white/15">
          <button
            type="button"
            onClick={handlePrevious}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white cursor-pointer"
            title="Previous Track"
          >
            <SkipBack size={15} />
          </button>

          <button
            type="button"
            onClick={handleTogglePlay}
            className="p-2.5 rounded-full bg-white text-black hover:scale-105 transition-transform cursor-pointer"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>

          <button
            type="button"
            onClick={handleNext}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white cursor-pointer"
            title="Next Track"
          >
            <SkipForward size={15} />
          </button>
        </div>

        {/* Exit Ambient Mode (Esc) */}
        <button
          type="button"
          onClick={handleCloseAmbient}
          className="px-3.5 py-1.5 rounded-full bg-white/10 hover:bg-red-500/35 border border-white/15 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
          title="Exit Fullscreen Ambient Mode (Esc)"
        >
          <Minimize2 size={14} />
          <span>Exit (Esc)</span>
        </button>
      </div>

      {/* Right-click Glassmorphic VisualizerContextMenu */}
      <VisualizerContextMenu
        isOpen={vizMenu.isOpen}
        x={vizMenu.x}
        y={vizMenu.y}
        onClose={() => setVizMenu((prev) => ({ ...prev, isOpen: false }))}
        context="ambient"
      />
    </div>
  );
};
