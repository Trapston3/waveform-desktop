// src/lyricVisualizer/ui/AmbientViewportApp.tsx
// Fullscreen GPU Ambient Mode takeover viewport app (#/ambient).
// Listens to onLvStateBroadcast and onLvPlatformEvent (power-lock -> setLocked(true) for 0% GPU on lock screen).
// Escape key closes via lvCloseAmbient(); includes a minimal bottom hover bar for style/pause/skip/exit.

import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  DEMO_FALLBACK_PALETTE,
  getBundledFontCssFamily,
  type PlaybackSnapshot,
  STARLIGHT_HARBOR_LYRICS,
  STARLIGHT_HARBOR_TRACK,
  SyncEngine,
  VISUAL_STYLE_DEFINITIONS,
  type VisualStyleId,
} from '../core';
import { LyricStageRenderer } from '../rendering';
import {
  type LyricVisualizerBroadcastPayload,
  useLyricVisualizerStore,
} from '../state/lyricVisualizerStore';
import { getSharedWaveFormPlaybackBridge } from '../bridge/waveFormPlaybackBridge';
import { useQueueStore } from '../../state/queueStore';

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export const AmbientViewportApp: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const webGlCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<LyricStageRenderer | null>(null);
  const syncEngineRef = useRef<SyncEngine>(new SyncEngine());

  const [isPlaying, setIsPlaying] = useState(true);
  const [showHud, setShowHud] = useState(true);
  const hudTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const snapshotRef = useRef<PlaybackSnapshot>({
    track: STARLIGHT_HARBOR_TRACK,
    positionSeconds: 0,
    isPlaying: true,
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

  const config = useLyricVisualizerStore((s) => s.config);
  const activeTrack = useLyricVisualizerStore((s) => s.activeTrack);
  const activeLyrics = useLyricVisualizerStore((s) => s.activeLyrics);
  const activePalette = useLyricVisualizerStore((s) => s.activePalette);
  const currentSongOffsetMs = useLyricVisualizerStore((s) => s.currentSongOffsetMs);
  const isScreenLocked = useLyricVisualizerStore((s) => s.isScreenLocked);

  const applyBroadcastPayload = useLyricVisualizerStore((s) => s.applyBroadcastPayload);
  const setStyleId = useLyricVisualizerStore((s) => s.setStyleId);
  const cycleStyle = useLyricVisualizerStore((s) => s.cycleStyle);
  const closeAmbientMode = useLyricVisualizerStore((s) => s.closeAmbientMode);
  const setScreenLocked = useLyricVisualizerStore((s) => s.setScreenLocked);

  const handleCloseAmbient = useCallback(() => {
    const api = typeof window !== 'undefined' ? (window as any).electronAPI : undefined;
    try {
      api?.lvCloseAmbient?.();
    } catch {
      // Ignore in browser/test mode
    }
    closeAmbientMode().catch(() => {});
  }, [closeAmbientMode]);

  // Escape key closes Ambient Mode via lvCloseAmbient()
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.code === 'Escape') {
        e.preventDefault();
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
  }, [handleCloseAmbient, cycleStyle]);

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

  // Subscribe to IPC broadcast state and platform events (power-lock -> setLocked(true))
  useEffect(() => {
    const api = typeof window !== 'undefined' ? (window as any).electronAPI : undefined;

    const unsubBroadcast =
      typeof api?.onLvStateBroadcast === 'function'
        ? api.onLvStateBroadcast((payload: LyricVisualizerBroadcastPayload) => {
            if (!payload || typeof payload !== 'object') return;
            applyBroadcastPayload(payload);
            syncEngineRef.current.setOffsetMs(payload.songOffsetMs ?? 0);
            setIsPlaying(Boolean(payload.isPlaying));
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
          })
        : null;

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
  }, [applyBroadcastPayload, setScreenLocked]);

  // Mount fullscreen GPU LyricStageRenderer
  useEffect(() => {
    const canvas = canvasRef.current;
    const webGlCanvas = webGlCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const state = useLyricVisualizerStore.getState();
    const initialLyrics = state.activeLyrics ?? STARLIGHT_HARBOR_LYRICS;

    const renderer = new LyricStageRenderer({
      canvas,
      webGlCanvas,
      styleId: state.config.styleId,
      fontFamily: getBundledFontCssFamily(state.config.fontId),
      fontSizeScale: state.config.fontSizeScale,
      palette: state.activePalette ?? DEMO_FALLBACK_PALETTE,
      reduceMotion: state.config.reduceMotion,
      isAmbientMode: true,
      isOverlayMode: false,
      audioReactive: state.config.audioReactive,
      onSampleFrame: (outAudio) => {
        const srcAudio = latestAudioRef.current;
        outAudio.rmsLevel = srcAudio.rmsLevel;
        outAudio.bassEnergy = srcAudio.bassEnergy;
        outAudio.midEnergy = srcAudio.midEnergy;
        outAudio.trebleEnergy = srcAudio.trebleEnergy;
        outAudio.beatDetected = srcAudio.beatDetected;

        const lyrics = useLyricVisualizerStore.getState().activeLyrics ?? STARLIGHT_HARBOR_LYRICS;
        const sync = syncEngineRef.current.update(snapshotRef.current, lyrics);
        return {
          timeSeconds: sync.timeSeconds,
          activeLineIndex: sync.activeLineIndex,
          activeWordIndex: sync.activeWordIndex,
          wordProgress: sync.wordProgress,
          lineFadeAlpha: sync.lineFadeAlpha,
          didSeekThisFrame: sync.didSeekThisFrame,
        };
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
  }, []);

  // Synchronize store updates & lock-screen 0% GPU pause to renderer
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    syncEngineRef.current.setOffsetMs(currentSongOffsetMs);
    renderer.setStyle(config.styleId);
    renderer.setTypography(getBundledFontCssFamily(config.fontId), config.fontSizeScale);
    renderer.setPalette(config.albumArtColorMatch ? activePalette : DEMO_FALLBACK_PALETTE);
    renderer.setLyrics(activeLyrics ?? STARLIGHT_HARBOR_LYRICS);
    renderer.setModes({
      reduceMotion: config.reduceMotion,
      isAmbientMode: true,
      isOverlayMode: false,
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
    activeLyrics,
    currentSongOffsetMs,
    isScreenLocked,
  ]);

  const handleTogglePlay = () => {
    const bridge = getSharedWaveFormPlaybackBridge();
    bridge.togglePlay();
    const nextPlaying = !isPlaying;
    setIsPlaying(nextPlaying);
    snapshotRef.current = {
      ...snapshotRef.current,
      isPlaying: nextPlaying,
      timestampMs: nowMs(),
    };
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

  const displayTrack = activeTrack ?? STARLIGHT_HARBOR_TRACK;

  return (
    <div
      ref={containerRef}
      onMouseMove={bumpHudVisibility}
      style={{
        fontFamily: 'Inter, "Segoe UI", sans-serif',
        backgroundColor: activePalette?.bgDeep || '#050508',
      }}
      className="fixed inset-0 w-screen h-screen overflow-hidden select-none"
    >
      {/* WebGL2 Fullscreen Ambient Shader Layer */}
      <canvas
        ref={webGlCanvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-0"
      />

      {/* Primary 2D Lyric Stage Canvas */}
      <canvas ref={canvasRef} className="relative z-[1] w-full h-full" />

      {/* Top-Left Track Info & Sandbox Badge */}
      <div
        className={`absolute top-6 left-8 z-20 flex items-center gap-3 transition-opacity duration-300 ${
          showHud ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="px-4 py-2 rounded-2xl bg-neutral-950/70 border border-white/15 backdrop-blur-xl text-white">
          <div className="text-sm font-bold truncate max-w-md">{displayTrack.title}</div>
          <div className="text-xs text-white/65 truncate max-w-md">{displayTrack.artist}</div>
        </div>

        {config.sandboxEnabled && (
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/25 border border-amber-400/50 backdrop-blur-md text-amber-100 text-xs font-semibold">
            <Sparkles size={13} className="text-amber-300" />
            <span>Demo: Starlight Harbor (Original)</span>
          </div>
        )}
      </div>

      {/* Minimal Bottom Hover Bar for Style / Pause / Skip / Exit */}
      <div
        data-testid="ambient-bottom-hover-bar"
        className={`absolute bottom-7 left-1/2 -translate-x-1/2 z-20 flex items-center gap-4 px-6 py-3 rounded-full bg-neutral-950/80 border border-white/15 backdrop-blur-2xl text-white shadow-2xl transition-all duration-300 ${
          showHud ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none'
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
    </div>
  );
};
