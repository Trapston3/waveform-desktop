// src/lyricVisualizer/ui/LyricStageControl.tsx
// Interactive LyricVisualizer stage combining WebGL2 + Canvas2D LyricStageRenderer,
// SyncEngine, LyricsPipeline, OKLCH album palette extraction, click-line-to-seek,
// Sandbox "Demo: Starlight Harbor (Original)" badge, and hover VisualizerControlBar.

import React, { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import {
  buildLyricsCacheKey,
  DEMO_FALLBACK_PALETTE,
  extractPaletteFromArtworkUrl,
  getBundledFontCssFamily,
  type Lyrics,
  LyricsPipeline,
  STARLIGHT_HARBOR_LYRICS,
  STARLIGHT_HARBOR_TRACK,
  SyncEngine,
  type TrackInfo,
} from '../core';
import { LyricStageRenderer } from '../rendering';
import {
  convertParsedLyricsToVisualizerLyrics,
  getSharedWaveFormPlaybackBridge,
} from '../bridge/waveFormPlaybackBridge';
import { useLyricVisualizerStore } from '../state/lyricVisualizerStore';
import { VisualizerControlBar } from './VisualizerControlBar';
import { usePlayerStore } from '../../state/playerStore';
import { useLyricsStore } from '../../state/lyricsStore';

export interface LyricStageControlProps {
  className?: string;
  showControls?: boolean;
  isAmbientMode?: boolean;
  isOverlayMode?: boolean;
  onSwitchToClassic?: () => void;
}

export const LyricStageControl: React.FC<LyricStageControlProps> = ({
  className = '',
  showControls = true,
  isAmbientMode = false,
  isOverlayMode = false,
  onSwitchToClassic,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const webGlCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvas2dRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<LyricStageRenderer | null>(null);
  const syncEngineRef = useRef<SyncEngine>(new SyncEngine());
  const pipelineRef = useRef<LyricsPipeline | null>(null);
  const activeLyricsRef = useRef<Lyrics | null>(null);

  const [isHovered, setIsHovered] = useState(false);

  const config = useLyricVisualizerStore((s) => s.config);
  const currentSongOffsetMs = useLyricVisualizerStore((s) => s.currentSongOffsetMs);
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

  // Keep SyncEngine per-song offset synchronized
  useEffect(() => {
    syncEngineRef.current.setOffsetMs(currentSongOffsetMs);
  }, [currentSongOffsetMs]);

  // Resolve track lyrics & OKLCH palette whenever track, lyricsData, or sandbox mode changes
  useEffect(() => {
    const bridge = getSharedWaveFormPlaybackBridge();
    const abortController = new AbortController();

    const syncTrackAndLyrics = async (track: TrackInfo | null) => {
      if (config.sandboxEnabled) {
        activeLyricsRef.current = STARLIGHT_HARBOR_LYRICS;
        setActiveTrack(STARLIGHT_HARBOR_TRACK);
        setActiveLyrics(STARLIGHT_HARBOR_LYRICS);
        setCurrentSongKey(STARLIGHT_HARBOR_TRACK.id).catch(() => {});
        rendererRef.current?.setLyrics(STARLIGHT_HARBOR_LYRICS);
        return;
      }

      setActiveTrack(track);
      if (!track) {
        activeLyricsRef.current = null;
        setActiveLyrics(null);
        setCurrentSongKey(null).catch(() => {});
        rendererRef.current?.setLyrics(null);
        return;
      }

      const songKey = buildLyricsCacheKey(track);
      setCurrentSongKey(songKey).catch(() => {});

      // Prefer already loaded lyrics from useLyricsStore if matching current track
      const storeLyrics = convertParsedLyricsToVisualizerLyrics(useLyricsStore.getState().lyricsData);
      if (storeLyrics && storeLyrics.lines.length > 0) {
        activeLyricsRef.current = storeLyrics;
        setActiveLyrics(storeLyrics);
        rendererRef.current?.setLyrics(storeLyrics);
      } else if (pipelineRef.current) {
        const resolved = await pipelineRef.current.resolveLyricsAsync(
          track,
          abortController.signal
        );
        if (!abortController.signal.aborted) {
          activeLyricsRef.current = resolved;
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
    setActiveLyrics,
    setActivePalette,
    setActiveTrack,
    setCurrentSongKey,
  ]);

  // Mount LyricStageRenderer and ResizeObserver
  useEffect(() => {
    const canvas = canvas2dRef.current;
    const webGlCanvas = webGlCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const bridge = getSharedWaveFormPlaybackBridge();
    const state = useLyricVisualizerStore.getState();

    const renderer = new LyricStageRenderer({
      canvas,
      webGlCanvas,
      styleId: state.config.styleId,
      fontFamily: getBundledFontCssFamily(state.config.fontId),
      fontSizeScale: state.config.fontSizeScale,
      palette: state.config.albumArtColorMatch ? state.activePalette : DEMO_FALLBACK_PALETTE,
      reduceMotion: state.config.reduceMotion,
      isAmbientMode,
      isOverlayMode,
      audioReactive: state.config.audioReactive,
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
        }

        const lyrics = activeLyricsRef.current;
        const syncResult = syncEngineRef.current.update(snapshot, lyrics);

        // Throttled broadcast to open overlay / ambient windows (~20Hz)
        useLyricVisualizerStore.getState().broadcastSnapshot({
          positionSeconds: syncResult.timeSeconds,
          isPlaying: snapshot.isPlaying,
          audio: outAudio,
        });

        return {
          timeSeconds: syncResult.timeSeconds,
          activeLineIndex: syncResult.activeLineIndex,
          activeWordIndex: syncResult.activeWordIndex,
          wordProgress: syncResult.wordProgress,
          lineFadeAlpha: syncResult.lineFadeAlpha,
          didSeekThisFrame: syncResult.didSeekThisFrame,
        };
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
  }, [isAmbientMode, isOverlayMode]);

  // Synchronize live config changes to LyricStageRenderer without remounting
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setStyle(config.styleId);
    renderer.setTypography(getBundledFontCssFamily(config.fontId), config.fontSizeScale);
    renderer.setPalette(config.albumArtColorMatch ? activePalette : DEMO_FALLBACK_PALETTE);
    renderer.setModes({
      reduceMotion: config.reduceMotion,
      isAmbientMode,
      isOverlayMode,
      audioReactive: config.audioReactive,
    });
    renderer.setLocked(isScreenLocked);
  }, [
    config.styleId,
    config.fontId,
    config.fontSizeScale,
    config.albumArtColorMatch,
    config.reduceMotion,
    config.audioReactive,
    activePalette,
    isAmbientMode,
    isOverlayMode,
    isScreenLocked,
  ]);

  // Click-line-to-seek handler
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
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
    const targetMs = Math.round(targetSec * 1000);

    const bridge = getSharedWaveFormPlaybackBridge();
    if (config.sandboxEnabled) {
      bridge.seek(targetSec);
    } else {
      const engine = usePlayerStore.getState().audioEngine;
      if (engine && typeof engine.seekTo === 'function') {
        engine.seekTo(targetMs);
      }
      bridge.seek(targetSec);
    }
    broadcastSnapshot({ positionSeconds: targetSec }, true);
  };

  return (
    <div
      ref={containerRef}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{ fontFamily: 'Inter, "Segoe UI", sans-serif' }}
      className={`relative w-full h-full flex flex-col overflow-hidden rounded-3xl select-none ${className}`}
    >
      {/* WebGL2 Background Shader Layer */}
      <canvas
        ref={webGlCanvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-0"
      />

      {/* Primary 2D Lyric Stage Canvas (Click-line-to-seek enabled) */}
      <canvas
        ref={canvas2dRef}
        onClick={handleCanvasClick}
        title="Click any lyric line to seek"
        className="relative z-[1] w-full h-full cursor-pointer"
      />

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

      {/* Hover / Active VisualizerControlBar at bottom of stage */}
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
    </div>
  );
};
