// src/lyricVisualizer/ui/OverlayViewportApp.tsx
// Transparent multi-monitor desktop overlay viewport app (#/overlay).
// Listens to onLvStateBroadcast and onLvPlatformEvent, requests initial snapshot via lvRequestSnapshot(),
// drops stale revisionId payloads, clears lyrics immediately on trackId change, and NEVER falls back
// to Starlight Harbor unless sandboxEnabled is true.
// Renders zero opaque chrome when click-through locked, and a subtle drag/control bar when unlocked.

import React, { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Lock, Move, Sparkles, X } from 'lucide-react';
import {
  type AudioFrameMetrics,
  DEMO_FALLBACK_PALETTE,
  getBundledFontCssFamily,
  type PlaybackSnapshot,
  resolveStyleVariationId,
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
  const lastRevisionIdRef = useRef<number>(0);
  const lastTrackIdRef = useRef<string | null>(null);

  const initialSandbox = useLyricVisualizerStore.getState().config.sandboxEnabled;

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

  const config = useLyricVisualizerStore((s) => s.config);
  const activeTrack = useLyricVisualizerStore((s) => s.activeTrack);
  const activeLyrics = useLyricVisualizerStore((s) => s.activeLyrics);
  const activePalette = useLyricVisualizerStore((s) => s.activePalette);
  const currentSongOffsetMs = useLyricVisualizerStore((s) => s.currentSongOffsetMs);
  const currentAutoSyncOffsetMs = useLyricVisualizerStore((s) => s.currentAutoSyncOffsetMs);
  const vocalSilenceRanges = useLyricVisualizerStore((s) => s.vocalSilenceRanges);
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

  // Subscribe to IPC broadcast state, request initial snapshot, and listen to platform events
  useEffect(() => {
    const api = typeof window !== 'undefined' ? (window as any).electronAPI : undefined;

    const handleIncomingPayload = (payload: LyricVisualizerBroadcastPayload) => {
      if (!payload || typeof payload !== 'object') return;

      // Drop stale out-of-order broadcast revisions
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

      // Immediately clear previous song's lyrics when trackId changes
      const incomingTrackId =
        payload.trackId !== undefined ? payload.trackId : payload.track?.id ?? null;
      if (incomingTrackId !== lastTrackIdRef.current) {
        lastTrackIdRef.current = incomingTrackId;
        rendererRef.current?.setLyrics(payload.lyrics ?? null);
      }

      applyBroadcastPayload(payload);
      syncEngineRef.current.setOffsetMs(payload.songOffsetMs ?? 0);
      syncEngineRef.current.setAutoSyncOffsetMs(payload.autoSyncOffsetMs ?? 0);
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
    };

    const unsubBroadcast =
      typeof api?.onLvStateBroadcast === 'function'
        ? api.onLvStateBroadcast(handleIncomingPayload)
        : null;

    // Request latest cached broadcast snapshot immediately on mount
    if (typeof api?.lvRequestSnapshot === 'function') {
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
    const initialLyrics =
      state.activeLyrics ?? (state.config.sandboxEnabled ? STARLIGHT_HARBOR_LYRICS : null);

    const renderer = new LyricStageRenderer({
      canvas,
      styleId: state.config.styleId,
      variationId: resolveStyleVariationId(state.config.styleId, state.config.variationByStyle),
      fontFamily: getBundledFontCssFamily(state.config.fontId),
      fontSizeScale: state.config.fontSizeScale,
      palette: state.activePalette ?? DEMO_FALLBACK_PALETTE,
      reduceMotion: state.config.reduceMotion,
      motionIntensity: state.config.motionIntensity,
      beatCameraThump: state.config.beatCameraThump,
      iosKineticZoom: state.config.iosKineticZoom,
      backgroundOpacity: state.config.backgroundOpacity,
      vignetteStrength: state.config.vignetteStrength,
      textAlign: state.config.textAlign,
      isAmbientMode: false,
      isOverlayMode: true,
      audioReactive: state.config.audioReactive,
      onSampleFrame: (outAudio) => {
        const curState = useLyricVisualizerStore.getState();
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
  const activeVariationId = resolveStyleVariationId(config.styleId, config.variationByStyle);
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
      iosKineticZoom: config.iosKineticZoom,
    });
    const resolvedTrack = config.sandboxEnabled ? STARLIGHT_HARBOR_TRACK : activeTrack;
    renderer.setTrackMetadata(
      resolvedTrack
        ? {
            id: resolvedTrack.id,
            title: resolvedTrack.title,
            artist: resolvedTrack.artist,
            album: resolvedTrack.album || '',
            year: resolvedTrack.year,
            bpm: resolvedTrack.bpm,
          }
        : null
    );
    renderer.setLyrics(activeLyrics ?? (config.sandboxEnabled ? STARLIGHT_HARBOR_LYRICS : null));
    renderer.setModes({
      reduceMotion: config.reduceMotion,
      motionIntensity: config.motionIntensity,
      beatCameraThump: config.beatCameraThump,
      isOverlayMode: true,
      isAmbientMode: false,
      audioReactive: config.audioReactive,
    });
    renderer.setLocked(isScreenLocked || isGameSuppressed);
  }, [
    config.styleId,
    activeVariationId,
    config.fontId,
    config.fontSizeScale,
    config.albumArtColorMatch,
    config.reduceMotion,
    config.motionIntensity,
    config.beatCameraThump,
    config.iosKineticZoom,
    config.audioReactive,
    config.backgroundOpacity,
    config.vignetteStrength,
    config.textAlign,
    config.sandboxEnabled,
    activeTrack,
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
