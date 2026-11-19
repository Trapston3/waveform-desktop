// src/lyricVisualizer/ui/OverlayViewportApp.tsx
// Transparent multi-monitor desktop overlay viewport app (#/overlay).
// Listens to onLvStateBroadcast and onLvPlatformEvent.
// Renders zero opaque chrome when click-through locked, and a subtle
// drag/control bar when unlocked.

import React, { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Lock, Move, Sparkles, X } from 'lucide-react';
import {
  type AudioFrameMetrics,
  DEMO_FALLBACK_PALETTE,
  getBundledFontCssFamily,
  type PlaybackSnapshot,
  STARLIGHT_HARBOR_LYRICS,
  STARLIGHT_HARBOR_TRACK,
  SyncEngine,
} from '../core';
import { LyricStageRenderer } from '../rendering';
import {
  type LyricVisualizerBroadcastPayload,
  useLyricVisualizerStore,
} from '../state/lyricVisualizerStore';

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export const OverlayViewportApp: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<LyricStageRenderer | null>(null);
  const syncEngineRef = useRef<SyncEngine>(new SyncEngine());

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
  const isGameSuppressed = useLyricVisualizerStore((s) => s.isGameSuppressed);

  const applyBroadcastPayload = useLyricVisualizerStore((s) => s.applyBroadcastPayload);
  const setOverlayLocked = useLyricVisualizerStore((s) => s.setOverlayLocked);
  const setOverlayEnabled = useLyricVisualizerStore((s) => s.setOverlayEnabled);
  const cycleStyle = useLyricVisualizerStore((s) => s.cycleStyle);
  const setScreenLocked = useLyricVisualizerStore((s) => s.setScreenLocked);
  const setGameSuppressed = useLyricVisualizerStore((s) => s.setGameSuppressed);

  // Ensure transparent HTML/body for transparent desktop overlay window
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const prevHtmlBg = document.documentElement.style.background;
    const prevBodyBg = document.body.style.background;
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    return () => {
      document.documentElement.style.background = prevHtmlBg;
      document.body.style.background = prevBodyBg;
    };
  }, []);

  // Subscribe to IPC broadcast state and platform events
  useEffect(() => {
    const api = typeof window !== 'undefined' ? (window as any).electronAPI : undefined;

    const unsubBroadcast =
      typeof api?.onLvStateBroadcast === 'function'
        ? api.onLvStateBroadcast((payload: LyricVisualizerBroadcastPayload) => {
            if (!payload || typeof payload !== 'object') return;
            applyBroadcastPayload(payload);
            syncEngineRef.current.setOffsetMs(payload.songOffsetMs ?? 0);
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
          })
        : null;

    const unsubPlatform =
      typeof api?.onLvPlatformEvent === 'function'
        ? api.onLvPlatformEvent((evt: { type: string; data?: any }) => {
            if (!evt || typeof evt !== 'object') return;
            if (evt.type === 'power-lock') {
              const locked = Boolean(evt.data?.locked);
              setScreenLocked(locked);
              rendererRef.current?.setLocked(locked);
            } else if (evt.type === 'game-guard') {
              setGameSuppressed(Boolean(evt.data?.suppressed));
            }
          })
        : null;

    return () => {
      if (typeof unsubBroadcast === 'function') unsubBroadcast();
      if (typeof unsubPlatform === 'function') unsubPlatform();
    };
  }, [applyBroadcastPayload, setScreenLocked, setGameSuppressed]);

  // Mount LyricStageRenderer in overlay mode
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const state = useLyricVisualizerStore.getState();
    const initialLyrics = state.activeLyrics ?? STARLIGHT_HARBOR_LYRICS;

    const renderer = new LyricStageRenderer({
      canvas,
      styleId: state.config.styleId,
      fontFamily: getBundledFontCssFamily(state.config.fontId),
      fontSizeScale: state.config.fontSizeScale,
      palette: state.activePalette ?? DEMO_FALLBACK_PALETTE,
      reduceMotion: state.config.reduceMotion,
      isAmbientMode: false,
      isOverlayMode: true,
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
        Math.max(320, rect.width || window.innerWidth || 1280),
        Math.max(180, rect.height || window.innerHeight || 720),
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

  // Synchronize store updates to renderer
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
      isOverlayMode: true,
      isAmbientMode: false,
      audioReactive: config.audioReactive,
    });
    renderer.setLocked(isScreenLocked || isGameSuppressed);
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
    isGameSuppressed,
  ]);

  if (isGameSuppressed) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      data-overlay-locked={config.overlayLocked ? 'true' : 'false'}
      style={{
        fontFamily: 'Inter, "Segoe UI", sans-serif',
        opacity: config.overlayOpacity,
        background: 'transparent',
      }}
      className="fixed inset-0 w-screen h-screen overflow-hidden select-none"
    >
      {/* Subtle unlock drag/control hint ONLY when unlocked; ZERO opaque chrome when locked */}
      {!config.overlayLocked && (
        <div
          data-testid="overlay-unlocked-hint"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
          className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-4 py-2 rounded-full bg-neutral-950/85 border border-white/20 backdrop-blur-xl text-xs text-white shadow-2xl"
        >
          <span className="flex items-center gap-1.5 text-white/80 font-medium">
            <Move size={13} className="text-cyan-300" />
            <span>Desktop Lyric Overlay (Unlocked)</span>
            {activeTrack && (
              <span className="text-white/50 truncate max-w-[180px]">
                — {activeTrack.title}
              </span>
            )}
          </span>

          {config.sandboxEnabled && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/25 border border-amber-400/50 text-amber-200 text-[10px] font-semibold">
              <Sparkles size={10} />
              <span>Demo: Starlight Harbor (Original)</span>
            </span>
          )}

          <div
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className="flex items-center gap-1.5 pl-2 border-l border-white/15"
          >
            <button
              type="button"
              onClick={() => cycleStyle(-1)}
              className="p-1 rounded-md bg-white/10 hover:bg-white/20 text-white cursor-pointer"
              title="Previous Style"
            >
              <ChevronLeft size={13} />
            </button>
            <button
              type="button"
              onClick={() => cycleStyle(1)}
              className="p-1 rounded-md bg-white/10 hover:bg-white/20 text-white cursor-pointer"
              title="Next Style"
            >
              <ChevronRight size={13} />
            </button>
            <button
              type="button"
              onClick={() => setOverlayLocked(true)}
              className="px-2.5 py-1 rounded-full bg-cyan-500/30 hover:bg-cyan-500/45 border border-cyan-400/50 text-cyan-100 font-semibold flex items-center gap-1 cursor-pointer"
              title="Lock Click-Through Mode (Hides Chrome)"
            >
              <Lock size={11} />
              <span>Lock Click-Through</span>
            </button>
            <button
              type="button"
              onClick={() => setOverlayEnabled(false)}
              className="p-1 rounded-full bg-white/10 hover:bg-red-500/40 text-white/80 hover:text-white cursor-pointer"
              title="Close Overlay"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Transparent 2D Stage Canvas */}
      <canvas
        ref={canvasRef}
        className={`w-full h-full ${config.overlayLocked ? 'pointer-events-none' : ''}`}
      />
    </div>
  );
};
