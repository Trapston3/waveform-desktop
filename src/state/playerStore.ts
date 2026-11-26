// src/state/playerStore.ts
// Single source of truth for all playback state, directly bound to AudioEngine

import { create } from 'zustand';
import type { Song } from '../models/Song';
import { normalizeSong } from '../models/Song';
import type { DeckName, PlaybackStatus, PlaybackState as EnginePlaybackState } from '../audio/AudioEngine';
import { AudioEngine, getTrackExpectedDurationSec } from '../audio/AudioEngine';
import { clampPlaybackRate } from '../utils/practiceLoop';
import { AutoEqLoader, type AutoEqProfile } from '../audio/AutoEqLoader';
import { MusicService } from '../services/MusicService';
import { OfflineCacheService } from '../services/OfflineCacheService';
import { StreamResolver, type ResolvedStream } from '../services/StreamResolver';
import { useSettingsStore } from './settingsStore';
import { extractArtworkPaletteFromUrl, useThemeStore } from '../ui/theme/Theme';
import {
  loadSyncSession,
  persistSessionDebounced,
  sanitizeResumePositionMs,
} from '../utils/sessionPersistence';

const sharedMusicService = new MusicService();
const sharedStreamResolver = new StreamResolver();
type StreamResolverFn = (
  videoId: string,
  title?: string,
  artist?: string,
  retryAttempt?: number
) => Promise<{
  url?: string;
  quality?: string;
  durationMs?: number;
  isLossless?: boolean;
  isDolbyAtmos?: boolean;
} | null>;
type LosslessStreamResolverFn = (track: Song) => Promise<ResolvedStream | null>;

let customStreamResolver: StreamResolverFn | null = null;
let customLosslessStreamResolver: LosslessStreamResolverFn | null = null;
let bridgeResyncCallback: ((positionSeconds: number) => void) | null = null;

export function registerPlayerBridgeResync(cb: ((positionSeconds: number) => void) | null): void {
  bridgeResyncCallback = cb;
}

export function setPlayerStreamResolver(resolver: StreamResolverFn | null): void {
  customStreamResolver = resolver;
}

export function setPlayerLosslessStreamResolver(resolver: LosslessStreamResolverFn | null): void {
  customLosslessStreamResolver = resolver;
}

function isSyntheticOrEmptyStreamUrl(url?: string | null): boolean {
  if (!url || !url.trim()) return true;
  if (url.includes('sn-redline') || url.includes('sn-audio') || url.includes('sn-offline')) return true;
  if (url.includes('01_Midnight_City.flac')) return true;
  return false;
}

export interface PlayerState {
  currentTrack: Song | null;
  playbackState: PlaybackStatus;
  positionMs: number;
  pendingResumePositionMs: number | null;
  isScrubbing: boolean;
  durationMs: number;
  volume: number; // 0.0 to 1.0
  isMuted: boolean;
  preMuteVolume: number;
  isShuffle: boolean;
  repeatMode: 'off' | 'all' | 'one';
  activeDeck: DeckName;
  isCrossfading: boolean;
  autoMixStatus: { active: boolean; targetTitle: string | null };
  isNowPlayingModalOpen: boolean;

  // Active playing stream quality badge metadata
  activeStreamQuality: string | null;
  activeStreamIsAtmos: boolean;

  // Active AutoEQ headphone calibration profile
  activeAutoEqProfile: AutoEqProfile | null;

  // Practice / A-B Loop & Pitch-Preserving Speed
  playbackRate: number;
  abLoop: {
    startMs: number | null;
    endMs: number | null;
    active: boolean;
    barCount: number | null;
  };

  // Waveform & Visualizer Buffers
  waveformBuckets: Float32Array | null; // 200 amplitude values
  livePcmEnergy: Float32Array | null; // 32-band live energy values
  isLiveVisualizerActive: boolean;

  // AudioEngine reference
  audioEngine: AudioEngine | null;
}

export interface PlayerActions {
  initEngine: (engine?: AudioEngine) => void;
  cleanupEngine: () => void;

  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  seek: (positionMs: number) => void;
  seekRelative: (deltaMs: number) => void;
  setIsScrubbing: (scrubbing: boolean) => void;
  syncPositionFromEngine: (ms: number) => void;
  clearPendingResumePosition: () => void;

  setVolume: (volume: number) => void;
  adjustVolumeRelative: (delta: number) => void;
  toggleMute: () => void;

  toggleShuffle: () => void;
  cycleRepeatMode: () => void;
  setRepeatMode: (mode: 'off' | 'all' | 'one') => void;

  loadTrack: (track: Song, deck?: DeckName, autoPlay?: boolean) => Promise<void>;
  prepareRestoredTrack: (track: Song, positionMs?: number) => Promise<void>;
  crossfade: (targetDeck?: DeckName, durationMs?: number) => Promise<void>;
  setAutoMixStatus: (active: boolean, targetTitle?: string | null) => void;
  setNowPlayingModalOpen: (open: boolean) => void;

  // DSP bridges
  setEqualizerBands: (gains: number[]) => void;
  loadAutoEqProfile: (profileName: string) => Promise<boolean>;
  setSpatialAudio: (enabled: boolean, width?: number) => void;

  // Practice controls
  setPlaybackRate: (rate: number) => void;
  setAbLoopStart: (ms: number | null) => void;
  setAbLoopEnd: (ms: number | null) => void;
  setAbLoopRange: (startMs: number | null, endMs: number | null, barCount?: number | null) => void;
  toggleAbLoop: () => void;
  clearAbLoop: () => void;

  // Engine callback handlers
  _updatePlaybackState: (state: PlaybackStatus) => void;
  _updatePosition: (positionMs: number) => void;
  _setWaveformData: (waveform: Float32Array) => void;
  _setLivePcmEnergy: (energy: Float32Array) => void;
}

export type PlayerStore = PlayerState & PlayerActions;

let globalAudioEngineInstance: AudioEngine | null = null;
let unsubscribeEngineState: (() => void) | null = null;
let unsubscribeLivePcm: (() => void) | null = null;
let isSyncingVolumeToEngine = false;
let activeLoadToken = 0;
let unsubscribeEngineError: (() => void) | null = null;
let unsubscribeEnginePrematureEnded: (() => void) | null = null;
let autoRetriedTrackId: string | null = null;
let prematureRetryState: { videoId: string; attempts: number; inFlight: boolean } = {
  videoId: '',
  attempts: 0,
  inFlight: false,
};

function getEffectiveDurationMs(
  durationMs: number,
  audioEngine: AudioEngine | null,
  currentTrack: Song | null
): number {
  const engineDur =
    audioEngine && typeof audioEngine.getCurrentDurationMs === 'function'
      ? audioEngine.getCurrentDurationMs() || 0
      : 0;
  const trackDur = getTrackExpectedDurationSec(currentTrack) * 1000;
  return Math.max(durationMs || 0, engineDur, trackDur);
}

function appendSabrStartMs(rawUrl: string, startMs: number): string {
  const rounded = Math.max(0, Math.floor(startMs));
  if (rounded <= 0 || !rawUrl.includes('waveform-stream://yt')) {
    return rawUrl;
  }
  try {
    const u = new URL(rawUrl);
    u.searchParams.set('startMs', String(rounded));
    return u.toString();
  } catch {
    return `${rawUrl}${rawUrl.includes('?') ? '&' : '?'}startMs=${rounded}`;
  }
}

/** Re-resolve a fresh stream URL for the current track and resume from positionMs. Returns false for local tracks. */
function recoverStream(
  get: () => PlayerStore,
  set: (p: Partial<PlayerState>) => void,
  overrideResumeMs?: number
): boolean {
  const { audioEngine, currentTrack, positionMs, pendingResumePositionMs } = get();
  if ((audioEngine as any)?.isSeeking?.()) return false;
  const fallbackPos = positionMs > 0 ? positionMs : (pendingResumePositionMs ?? 0);
  const resumeMs =
    typeof overrideResumeMs === 'number' && overrideResumeMs >= 0 ? overrideResumeMs : fallbackPos;
  const url = currentTrack?.streamUrl || '';
  if (!audioEngine || !currentTrack || /^(waveform-local|file):/i.test(url)) return false;
  const token = activeLoadToken;
  const shouldResumePlaying = get().playbackState === 'PLAYING';
  sharedStreamResolver.invalidateCache(currentTrack.videoId);
  sharedMusicService.invalidateStreamCache(currentTrack.videoId);
  const resolveFn =
    customStreamResolver ||
    ((id: string, title?: string, artist?: string) =>
      sharedMusicService.resolveStream(id, title, artist, currentTrack.durationSec));
  resolveFn(currentTrack.videoId, currentTrack.title, currentTrack.artist)
    .then(async (resolved) => {
      if (
        !resolved?.url ||
        token !== activeLoadToken ||
        get().currentTrack?.videoId !== currentTrack.videoId
      ) {
        return;
      }
      const freshQuality =
        resolved.quality || currentTrack.sourceQuality || get().activeStreamQuality || '160kbps Opus';
      const fresh = normalizeSong({
        ...currentTrack,
        streamUrl: appendSabrStartMs(resolved.url, resumeMs),
        sourceQuality: freshQuality,
      } as any);
      const wantPlay = shouldResumePlaying || get().playbackState === 'PLAYING';
      set({
        currentTrack: fresh,
        positionMs: resumeMs,
        activeStreamQuality: freshQuality,
        activeStreamIsAtmos: Boolean(resolved.isDolbyAtmos),
      });
      await audioEngine.loadTrack(fresh as any, 'active');
      if (token !== activeLoadToken || get().currentTrack?.videoId !== currentTrack.videoId) {
        return;
      }
      if (resumeMs > 0) audioEngine.seek(Math.floor(resumeMs));
      if (wantPlay) {
        audioEngine.play();
        set({ playbackState: 'PLAYING' });
      }
    })
    .catch((err) => {
      console.warn('[playerStore] Stream recovery failed:', err);
      if (token === activeLoadToken && get().currentTrack?.videoId === currentTrack.videoId) {
        set({ playbackState: 'PAUSED' });
      }
    });
  return true;
}

/**
 * Recover from a premature 'ended' or stall cutoff at resumeMs (up to 3 retries per track),
 * invalidating caches, retrying fresh SABR at startMs, and stepping down the quality ladder:
 * Lossless -> fresh SABR YouTube -> JioSaavn 320kbps AAC -> Direct InnerTube.
 */
async function recoverStreamFromPrematureEnd(
  get: () => PlayerStore,
  set: (p: Partial<PlayerState>) => void,
  resumeMs: number,
  attemptNum: number,
  token: number = activeLoadToken
): Promise<boolean> {
  const { audioEngine, currentTrack, activeStreamQuality } = get();
  const url = currentTrack?.streamUrl || '';
  if (!audioEngine || !currentTrack || /^(waveform-local|file):/i.test(url)) return false;
  if (token !== activeLoadToken) return false;

  const targetResumeMs = Math.max(0, Math.floor(resumeMs));
  sharedStreamResolver.invalidateCache(currentTrack.videoId);
  sharedMusicService.invalidateStreamCache(currentTrack.videoId);

  try {
    let resolved: {
      url?: string;
      quality?: string;
      durationMs?: number;
      isLossless?: boolean;
      isDolbyAtmos?: boolean;
    } | null = null;

    if (customStreamResolver) {
      resolved = await customStreamResolver(
        currentTrack.videoId,
        currentTrack.title,
        currentTrack.artist,
        attemptNum
      );
    } else {
      const wasLossless =
        /flac|alac|lossless/i.test(activeStreamQuality || currentTrack.sourceQuality || '') ||
        url.includes('waveform-stream://proxy');
      const query = `${currentTrack.title || ''} ${currentTrack.artist || ''}`.trim();
      const target =
        currentTrack.title && currentTrack.artist
          ? {
              title: currentTrack.title,
              artist: currentTrack.artist,
              durationSec: currentTrack.durationSec,
            }
          : undefined;

      if (attemptNum === 1) {
        // Attempt 1: If Lossless, step down to YouTube SABR/Opus; otherwise retry fresh SABR
        resolved =
          (await sharedStreamResolver.resolveYouTubeOnly(
            currentTrack.videoId,
            currentTrack.title,
            currentTrack.artist,
            currentTrack.durationSec
          )) ||
          (await sharedMusicService.resolveStream(
            currentTrack.videoId,
            currentTrack.title,
            currentTrack.artist,
            currentTrack.durationSec
          ));
      } else if (attemptNum === 2) {
        // Attempt 2: Step down to JioSaavn 320kbps AAC (or fresh YouTube if unavailable)
        resolved =
          (query ? await sharedStreamResolver.resolveJioSaavnTrack(query, target) : null) ||
          (await sharedStreamResolver.resolveYouTubeOnly(
            currentTrack.videoId,
            currentTrack.title,
            currentTrack.artist,
            currentTrack.durationSec
          )) ||
          (await sharedMusicService.resolveStream(
            currentTrack.videoId,
            currentTrack.title,
            currentTrack.artist,
            currentTrack.durationSec
          ));
      } else {
        // Attempt 3: Direct InnerTube clients (bypassing SABR) -> JioSaavn -> full resolve
        resolved =
          (await sharedStreamResolver.resolveYouTubeOnly(
            currentTrack.videoId,
            currentTrack.title,
            currentTrack.artist,
            currentTrack.durationSec,
            { skipSabr: !wasLossless }
          )) ||
          (query ? await sharedStreamResolver.resolveJioSaavnTrack(query, target) : null) ||
          (await sharedMusicService.resolveStream(
            currentTrack.videoId,
            currentTrack.title,
            currentTrack.artist,
            currentTrack.durationSec
          ));
      }
    }

    if (
      !resolved?.url ||
      token !== activeLoadToken ||
      get().currentTrack?.videoId !== currentTrack.videoId
    ) {
      return false;
    }

    const freshQuality = resolved.quality || '160kbps Opus';
    const nextUrl = appendSabrStartMs(resolved.url, targetResumeMs);
    const fresh = normalizeSong({
      ...currentTrack,
      streamUrl: nextUrl,
      sourceQuality: freshQuality,
    } as any);
    const wantPlay = get().playbackState === 'PLAYING';
    set({
      currentTrack: fresh,
      positionMs: targetResumeMs,
      activeStreamQuality: freshQuality,
      activeStreamIsAtmos: Boolean(resolved.isDolbyAtmos),
    });
    await audioEngine.loadTrack(fresh as any, 'active');
    if (token !== activeLoadToken || get().currentTrack?.videoId !== currentTrack.videoId) {
      return false;
    }
    if (targetResumeMs > 0) audioEngine.seek(targetResumeMs);
    if (wantPlay) {
      audioEngine.play();
      set({ playbackState: 'PLAYING' });
    }
    return true;
  } catch (err) {
    console.warn('[playerStore] Premature ended recovery failed:', err);
    return false;
  }
}

const initialSession = typeof window !== 'undefined' || typeof globalThis !== 'undefined' ? loadSyncSession() : null;
const initialPlayer = initialSession?.player;
const initialSanitizedPosMs = initialPlayer
  ? sanitizeResumePositionMs(
      initialPlayer.positionMs || 0,
      initialPlayer.durationMs ||
        getTrackExpectedDurationSec(initialPlayer.currentTrack) * 1000
    )
  : 0;

export const usePlayerStore = create<PlayerStore>((set, get) => ({
  currentTrack: initialPlayer?.currentTrack || null,
  playbackState: 'PAUSED',
  positionMs: typeof Audio !== 'undefined' ? 0 : initialSanitizedPosMs,
  pendingResumePositionMs: initialSanitizedPosMs > 0 ? initialSanitizedPosMs : null,
  isScrubbing: false,
  durationMs: initialPlayer?.durationMs || 0,
  volume: initialPlayer?.volume ?? 0.85,
  isMuted: initialPlayer?.isMuted ?? false,
  preMuteVolume: initialPlayer?.preMuteVolume ?? 0.85,
  isShuffle: initialPlayer?.isShuffle ?? false,
  repeatMode: initialPlayer?.repeatMode || 'off',
  activeDeck: 'active',
  isCrossfading: false,
  autoMixStatus: { active: false, targetTitle: null },
  isNowPlayingModalOpen: false,

  activeStreamQuality: initialPlayer?.currentTrack?.sourceQuality || null,
  activeStreamIsAtmos: false,

  activeAutoEqProfile: null,

  playbackRate: 1.0,
  abLoop: { startMs: null, endMs: null, active: false, barCount: null },

  waveformBuckets: null,
  livePcmEnergy: null,
  isLiveVisualizerActive: false,

  audioEngine: null,

  initEngine: (engine?: AudioEngine) => {
    if (get().audioEngine) return;

    if (!engine) {
      if (!globalAudioEngineInstance) {
        globalAudioEngineInstance = new AudioEngine();
      }
      engine = globalAudioEngineInstance;
    }

    set({ audioEngine: engine });
    if (typeof (engine as any).setPlaybackRate === 'function') {
      (engine as any).setPlaybackRate(get().playbackRate);
    }

    // Make the store the source of truth for volume: push the restored/persisted level
    // into the engine instead of letting the engine's 0.85 default overwrite it.
    isSyncingVolumeToEngine = true;
    try {
      const { volume, isMuted } = get();
      engine.setVolume(isMuted ? 0 : volume);
    } catch {
      // Ignore in headless/mock engines
    } finally {
      isSyncingVolumeToEngine = false;
    }

    // Subscribe to AudioEngine playback state changes
    unsubscribeEngineState = engine.onPlaybackStateChange((engineState: EnginePlaybackState) => {
      // Volume/mute are owned by the store; volume-only echoes from the engine must NEVER
      // overwrite playbackState, positionMs, or currentTrack (especially during async stream resolution).
      const emitReason = (engine as any).lastEmitReason as
        | 'state'
        | 'volume'
        | 'load'
        | 'seek'
        | 'timeupdate'
        | undefined;
      if (isSyncingVolumeToEngine || emitReason === 'volume') {
        return;
      }

      const currentTrack = engineState.currentTrack ? normalizeSong(engineState.currentTrack as any) : null;
      
      // Guard: If engine has no track yet (idle freshly initialized engine), do NOT wipe restored track or position!
      if (!currentTrack && get().currentTrack) {
        return;
      }

      const engineDur = engine ? engine.getCurrentDurationMs() : 0;
      const trackDur = currentTrack ? getTrackExpectedDurationSec(currentTrack) * 1000 : 0;
      const prevDur = get().currentTrack?.videoId === currentTrack?.videoId ? get().durationMs : 0;
      const durationMs = engineDur > 0 ? engineDur : trackDur > 0 ? trackDur : prevDur;

      const prev = get();
      const isSameTrack = prev.currentTrack?.videoId === currentTrack?.videoId;

      // Guard: Re-loading the same track (e.g. when async resolveStream finishes) must not
      // flip PLAYING back to IDLE/PAUSED or zero out position before audioEngine.play() resumes it.
      if (emitReason === 'load' && isSameTrack && prev.playbackState === 'PLAYING') {
        set({
          currentTrack: currentTrack || prev.currentTrack,
          activeDeck: engineState.activeDeck,
          durationMs,
        });
        return;
      }

      // Guard: In-place Stage 2 lossless crossfade on the same track keeps playbackState as PLAYING
      if (engineState.playbackState === 'CROSSFADING' && isSameTrack && prev.playbackState === 'PLAYING') {
        set({
          currentTrack: currentTrack || prev.currentTrack,
          activeDeck: engineState.activeDeck,
          durationMs,
        });
        return;
      }

      // Fallback guard for mock engines without lastEmitReason: stale IDLE/PAUSED echoes
      // must not pause an actively playing track (including while resolving a stream).
      const volumeOnlyEcho =
        isSameTrack &&
        Math.abs(engineState.positionMs - prev.positionMs) < 1500 &&
        prev.playbackState === 'PLAYING' &&
        (engineState.playbackState === 'PAUSED' || engineState.playbackState === 'IDLE') &&
        ((typeof (engine as any).isActiveDeckAdvancing === 'function'
          ? (engine as any).isActiveDeckAdvancing()
          : false) ||
          isSyntheticOrEmptyStreamUrl(prev.currentTrack?.streamUrl));

      set({
        playbackState: volumeOnlyEcho ? prev.playbackState : engineState.playbackState,
        currentTrack: currentTrack || prev.currentTrack,
        positionMs: engineState.positionMs,
        activeDeck: engineState.activeDeck,
        durationMs,
      });
    });

    if ('onResumeResetToZeroCallback' in engine) {
      (engine as any).onResumeResetToZeroCallback = () => {
        get().syncPositionFromEngine(0);
        if (bridgeResyncCallback) bridgeResyncCallback(0);
      };
    }

    // Mid-song media error (expired URL / network drop): re-resolve once per track and resume.
    unsubscribeEngineError?.();
    unsubscribeEngineError = typeof engine.onPlaybackError === 'function'
      ? engine.onPlaybackError(() => {
          if ((engine as any)?.isSeeking?.()) return;
          const id = get().currentTrack?.videoId;
          if (!id || autoRetriedTrackId === id) return;
          autoRetriedTrackId = id;
          recoverStream(get, set);
        })
      : null;

    // Premature 'ended' or stall cutoff guard: recover stream from resumeMs (up to 3 retries stepping down quality ladder)
    unsubscribeEnginePrematureEnded?.();
    unsubscribeEnginePrematureEnded = typeof (engine as any).onPrematureEnded === 'function'
      ? (engine as any).onPrematureEnded((resumeMs: number) => {
          if ((engine as any)?.isSeeking?.()) return;
          const current = get().currentTrack;
          if (!current) return;
          const safeResumeMs =
            typeof resumeMs === 'number' && resumeMs > 0 ? resumeMs : get().positionMs;
          if (prematureRetryState.videoId !== current.videoId) {
            prematureRetryState = { videoId: current.videoId, attempts: 0, inFlight: false };
          }
          if (prematureRetryState.inFlight) {
            return;
          }
          if (prematureRetryState.attempts >= 3) {
            set({ positionMs: safeResumeMs, playbackState: 'PAUSED' });
            return;
          }
          prematureRetryState.attempts += 1;
          prematureRetryState.inFlight = true;
          const attemptNum = prematureRetryState.attempts;
          const retryToken = activeLoadToken;
          set({ positionMs: safeResumeMs, playbackState: 'PLAYING' });
          recoverStreamFromPrematureEnd(get, set, safeResumeMs, attemptNum, retryToken)
            .then((recovered) => {
              if (
                !recovered &&
                retryToken === activeLoadToken &&
                get().currentTrack?.videoId === current.videoId
              ) {
                set({ positionMs: safeResumeMs, playbackState: 'PAUSED' });
              }
            })
            .catch(() => {
              if (
                retryToken === activeLoadToken &&
                get().currentTrack?.videoId === current.videoId
              ) {
                set({ positionMs: safeResumeMs, playbackState: 'PAUSED' });
              }
            })
            .finally(() => {
              if (prematureRetryState.videoId === current.videoId) {
                prematureRetryState.inFlight = false;
              }
            });
        })
      : null;

    // Subscribe to live 32-band PCM energy
    unsubscribeLivePcm = engine.subscribeLivePcmEnergy((energy: Float32Array) => {
      set({ livePcmEnergy: energy, isLiveVisualizerActive: true });
    });
  },

  cleanupEngine: () => {
    unsubscribeEngineError?.();
    unsubscribeEngineError = null;
    unsubscribeEnginePrematureEnded?.();
    unsubscribeEnginePrematureEnded = null;
    prematureRetryState = { videoId: '', attempts: 0, inFlight: false };
    if (unsubscribeEngineState) {
      unsubscribeEngineState();
      unsubscribeEngineState = null;
    }
    if (unsubscribeLivePcm) {
      unsubscribeLivePcm();
      unsubscribeLivePcm = null;
    }
    set({ audioEngine: null, isLiveVisualizerActive: false });
  },

  play: () => {
    const { audioEngine, currentTrack } = get();
    if (audioEngine && currentTrack) {
      const activeDeck =
        audioEngine.activeDeckName === 'active' ? audioEngine.deckA : audioEngine.deckB;
      // Dead or unresolved restored deck: reloading the same URL can't help — fetch a fresh one.
      if (
        (activeDeck?.needsStreamReResolution === true ||
          (typeof audioEngine.isActiveDeckErrored === 'function' && audioEngine.isActiveDeckErrored())) &&
        recoverStream(get, set)
      ) {
        set({ playbackState: 'PLAYING' });
        return;
      }
      try {
        audioEngine.play();
      } catch (err) {
        console.warn('[playerStore] Play failed:', err);
      }
    }
    set({ playbackState: 'PLAYING' });
  },

  pause: () => {
    const { audioEngine, currentTrack } = get();
    if (audioEngine && currentTrack) {
      try {
        audioEngine.pause();
      } catch (err) {
        console.warn('[playerStore] Pause failed:', err);
      }
    }
    set({ playbackState: 'PAUSED' });
  },

  togglePlay: () => {
    const { playbackState, play, pause } = get();
    if (playbackState === 'PLAYING') {
      pause();
    } else {
      play();
    }
  },

  seek: (positionMs: number) => {
    const { audioEngine, durationMs, currentTrack } = get();
    const safePos = Number.isFinite(positionMs) ? positionMs : 0;
    const effectiveDuration = getEffectiveDurationMs(durationMs, audioEngine, currentTrack);
    const clamped =
      effectiveDuration > 0
        ? Math.max(0, Math.min(effectiveDuration, safePos))
        : Math.max(0, safePos);
    if (audioEngine) {
      try {
        audioEngine.seek(clamped);
      } catch (err) {
        console.warn('[playerStore] Seek failed:', err);
      }
    }
    set({
      positionMs: clamped,
      pendingResumePositionMs: null,
      ...(effectiveDuration > (durationMs || 0) ? { durationMs: effectiveDuration } : {}),
    });
    if (bridgeResyncCallback) {
      bridgeResyncCallback(clamped / 1000);
    }
  },

  seekRelative: (deltaMs: number) => {
    const { positionMs, seek } = get();
    seek(Math.max(0, positionMs + deltaMs));
  },

  setIsScrubbing: (scrubbing: boolean) => {
    set({ isScrubbing: Boolean(scrubbing) });
  },

  syncPositionFromEngine: (ms: number) => {
    const safeMs = Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0;
    set({ positionMs: safeMs });
  },

  clearPendingResumePosition: () => {
    const { audioEngine } = get();
    if (audioEngine && typeof (audioEngine as any).clearPendingResumePosition === 'function') {
      (audioEngine as any).clearPendingResumePosition();
    }
    set({ pendingResumePositionMs: null });
  },

  setVolume: (volume: number) => {
    const clamped = Math.max(0, Math.min(1.0, volume));
    const { audioEngine } = get();
    set((state) => ({
      volume: clamped,
      isMuted: clamped === 0,
      preMuteVolume: clamped > 0 ? clamped : state.preMuteVolume,
    }));
    if (audioEngine) {
      isSyncingVolumeToEngine = true;
      try {
        audioEngine.setVolume(clamped);
      } catch (err) {
        console.warn('[playerStore] setVolume failed:', err);
      } finally {
        isSyncingVolumeToEngine = false;
      }
    }
  },

  adjustVolumeRelative: (delta: number) => {
    const { volume, isMuted, preMuteVolume, setVolume } = get();
    if (isMuted && delta > 0) {
      // Unmute and apply positive step from pre-mute volume
      const base = volume > 0 ? volume : preMuteVolume > 0 ? preMuteVolume : 0;
      const restored = Math.min(1.0, base + delta);
      setVolume(restored);
      return;
    }
    setVolume(volume + delta);
  },

  toggleMute: () => {
    const { isMuted, volume, preMuteVolume, setVolume } = get();
    if (isMuted) {
      const restored = preMuteVolume > 0 ? preMuteVolume : 0.5;
      setVolume(restored);
    } else {
      set({ preMuteVolume: volume > 0 ? volume : 0.5 });
      setVolume(0);
    }
  },

  toggleShuffle: () => {
    set((state) => ({ isShuffle: !state.isShuffle }));
  },

  cycleRepeatMode: () => {
    set((state) => {
      const next = state.repeatMode === 'off' ? 'all' : state.repeatMode === 'all' ? 'one' : 'off';
      return { repeatMode: next };
    });
  },

  setRepeatMode: (mode: 'off' | 'all' | 'one') => {
    set({ repeatMode: mode });
  },

  loadTrack: async (track: Song, deck: DeckName = 'active', autoPlay = true) => {
    let normalized = normalizeSong(track as any);
    if (isSyntheticOrEmptyStreamUrl(normalized.streamUrl) && !normalized.localFilePath) {
      const offlineHit = await OfflineCacheService.resolveOfflineUrl(normalized.videoId);
      if (offlineHit?.url) {
        normalized = normalizeSong({
          ...normalized,
          streamUrl: offlineHit.url,
          sourceQuality: offlineHit.pinned ? 'Offline Pinned' : 'Offline Cached',
        } as any);
      }
    }
    const { audioEngine } = get();
    const duration = getTrackExpectedDurationSec(normalized) * 1000;
    const loadToken = deck === 'active' ? ++activeLoadToken : 0;
    if (deck === 'active') {
      autoRetriedTrackId = null;
      prematureRetryState = { videoId: normalized.videoId, attempts: 0, inFlight: false };
    }
    const needsStreamResolution =
      (typeof window !== 'undefined' || customStreamResolver !== null) &&
      isSyntheticOrEmptyStreamUrl(normalized.streamUrl);

    const initialQuality = needsStreamResolution
      ? normalized.sourceQuality || '160kbps Opus'
      : normalized.sourceQuality || (normalized.isLocal ? 'Lossless FLAC' : null);

    const prevTrackId = get().currentTrack?.videoId;
    set((state) => ({
      currentTrack: normalized,
      durationMs: duration,
      positionMs: 0,
      pendingResumePositionMs: deck === 'active' ? null : state.pendingResumePositionMs,
      activeDeck: deck,
      playbackState: deck === 'active' && autoPlay ? 'PLAYING' : state.playbackState,
      ...(deck === 'active' && prevTrackId !== normalized.videoId
        ? { abLoop: { startMs: null, endMs: null, active: false, barCount: null } }
        : {}),
      ...(deck === 'active'
        ? {
            activeStreamQuality: initialQuality,
            activeStreamIsAtmos: false,
          }
        : {}),
    }));

    // Update dynamic Liquid Glass artwork palette when track changes in browser
    if (typeof window !== 'undefined' && deck === 'active') {
      extractArtworkPaletteFromUrl(
        normalized.thumbnailUrl || normalized.artworkUrl,
        normalized.title || normalized.videoId
      )
        .then((palette) => {
          useThemeStore.getState().setArtworkPalette(palette);
        })
        .catch(() => {});
    }

    if (audioEngine) {
      try {
        // Avoid feeding a known-synthetic placeholder URL into HTMLAudioElement before real resolution
        const initialEngineTrack = needsStreamResolution
          ? { ...normalized, streamUrl: undefined }
          : normalized;
        await audioEngine.loadTrack(initialEngineTrack as any, deck);
        if (deck === 'active' && loadToken !== activeLoadToken) {
          return; // Superseded by a newer loadTrack call
        }

        // Load waveform data asynchronously
        audioEngine.getWaveformData(normalized.videoId).then((waveform) => {
          if (deck !== 'active' || loadToken === activeLoadToken) {
            set({ waveformBuckets: waveform });
          }
        }).catch(() => {
          // Fallback waveform if extraction fails
          const fallback = new Float32Array(200);
          for (let i = 0; i < 200; i++) {
            fallback[i] = 0.2 + 0.6 * Math.abs(Math.sin((i / 200) * Math.PI * 4));
          }
          if (deck !== 'active' || loadToken === activeLoadToken) {
            set({ waveformBuckets: fallback });
          }
        });

        if (autoPlay && (deck !== 'active' || get().playbackState === 'PLAYING')) {
          audioEngine.play();
          set({ playbackState: 'PLAYING' });
        }

        // In browser runtime (or test resolver), if streamUrl is missing or synthetic, resolve real stream
        if (needsStreamResolution) {
          const resolveFn =
            customStreamResolver ||
            ((id: string, title?: string, artist?: string) =>
              sharedMusicService.resolveStream(id, title, artist, normalized.durationSec));
          resolveFn(normalized.videoId, normalized.title, normalized.artist)
            .then(async (resolved) => {
              if (!resolved || !resolved.url) {
                if (deck === 'active' && loadToken === activeLoadToken) {
                  set({ playbackState: 'PAUSED' });
                }
                return;
              }
              const current = get().currentTrack;
              if (
                deck === 'active' &&
                (loadToken !== activeLoadToken || (current && current.videoId !== normalized.videoId))
              ) {
                return; // User already switched to another track
              }
              const resolvedDurationMs =
                resolved.durationMs && resolved.durationMs > 0
                  ? resolved.durationMs
                  : getTrackExpectedDurationSec(normalized) * 1000;
              const stage1Quality = resolved.quality || normalized.sourceQuality || '160kbps Opus';
              const stage1IsAtmos = Boolean(resolved.isDolbyAtmos);
              const enriched = normalizeSong({
                ...normalized,
                streamUrl: resolved.url,
                sourceQuality: stage1Quality,
                ...(resolvedDurationMs > 0
                  ? {
                      durationSec: Math.round(resolvedDurationMs / 1000),
                      ...(normalized.totalPlayTimeMs <= 0 ? { totalPlayTimeMs: resolvedDurationMs } : {}),
                    }
                  : {}),
              } as any);
              const shouldResumePlaying = deck === 'active' && get().playbackState === 'PLAYING';
              const resumePos = deck === 'active' ? get().positionMs : 0;
              if (deck === 'active') {
                set((s) => ({
                  currentTrack: enriched,
                  durationMs: resolvedDurationMs > 0 ? resolvedDurationMs : s.durationMs,
                  activeStreamQuality: stage1Quality,
                  activeStreamIsAtmos: stage1IsAtmos,
                }));
              }
              await audioEngine.loadTrack(enriched as any, deck);
              if (deck === 'active' && loadToken !== activeLoadToken) {
                return;
              }
              // Only seek if user explicitly sought past initial synthetic pre-roll;
              // WebAudioDeck safely defers seeks until loadedmetadata.
              if (deck === 'active' && resumePos > 2000) {
                audioEngine.seek(resumePos);
              }
              if (deck === 'active' && (get().playbackState === 'PLAYING' || (shouldResumePlaying && get().playbackState !== 'PAUSED'))) {
                audioEngine.play();
                set({ playbackState: 'PLAYING' });
              }

              // Stage 2 background Lossless FLAC upgrade (OTA standby deck swap)
              const prefBitrate =
                useSettingsStore.getState().settings?.['playback.preferredStreamingBitrate'] || 'high';
              const allowsLossless =
                prefBitrate === 'lossless' || prefBitrate === 'high' || prefBitrate === 'auto';
              const isAlreadyLossless =
                Boolean(resolved.isLossless) || /flac|alac|lossless/i.test(stage1Quality);

              if (
                deck === 'active' &&
                allowsLossless &&
                !isAlreadyLossless &&
                !normalized.isLocal &&
                typeof (audioEngine as any).stageAndCrossfadeLosslessSwap === 'function' &&
                (typeof window !== 'undefined' || customLosslessStreamResolver !== null)
              ) {
                const resolveLosslessFn =
                  customLosslessStreamResolver ||
                  ((t: Song) => sharedStreamResolver.resolveLosslessStream(t));

                Promise.resolve()
                  .then(() => resolveLosslessFn(enriched))
                  .then(async (losslessStream) => {
                    if (
                      !losslessStream ||
                      !losslessStream.url ||
                      loadToken !== activeLoadToken ||
                      get().currentTrack?.videoId !== enriched.videoId ||
                      get().playbackState !== 'PLAYING'
                    ) {
                      return;
                    }
                    const losslessQuality = losslessStream.quality || '16-bit / 44.1kHz FLAC';
                    const losslessTrack = normalizeSong({
                      ...enriched,
                      streamUrl: losslessStream.url,
                      sourceQuality: losslessQuality,
                    } as any);
                    const swapped = await audioEngine.stageAndCrossfadeLosslessSwap(
                      losslessTrack as any,
                      300
                    );
                    if (
                      swapped &&
                      loadToken === activeLoadToken &&
                      get().currentTrack?.videoId === enriched.videoId
                    ) {
                      set({
                        currentTrack: losslessTrack,
                        activeDeck: audioEngine.activeDeckName,
                        activeStreamQuality: losslessQuality,
                        activeStreamIsAtmos: Boolean(losslessStream.isDolbyAtmos),
                      });
                    }
                  })
                  .catch(() => {
                    // Silently ignore Stage 2 lossless errors; Stage 1 keeps playing uninterrupted
                  });
              }
            })
            .catch((err) => {
              console.warn('[playerStore] Live stream resolution fallback error:', err);
              if (deck === 'active' && loadToken === activeLoadToken) {
                set({ playbackState: 'PAUSED' });
              }
            });
        }
      } catch (err) {
        console.warn('[playerStore] loadTrack failed:', err);
      }
    }
  },

  prepareRestoredTrack: async (track: Song, positionMs = 0) => {
    const normalized = normalizeSong(track as any);
    const { audioEngine } = get();
    const restoreToken = ++activeLoadToken;
    const duration = getTrackExpectedDurationSec(normalized) * 1000;
    const safePos = sanitizeResumePositionMs(positionMs, duration);
    const hasAudioEl = Boolean(audioEngine && audioEngine.getActiveAudioElement?.());

    set({
      currentTrack: normalized,
      durationMs: duration,
      positionMs: hasAudioEl ? 0 : safePos,
      pendingResumePositionMs: safePos > 0 ? safePos : null,
      playbackState: 'PAUSED',
      activeStreamQuality: normalized.sourceQuality || null,
      activeStreamIsAtmos: false,
    });

    if (typeof window !== 'undefined') {
      extractArtworkPaletteFromUrl(
        normalized.thumbnailUrl || normalized.artworkUrl,
        normalized.title || normalized.videoId
      )
        .then((palette) => {
          if (restoreToken === activeLoadToken) {
            useThemeStore.getState().setArtworkPalette(palette);
          }
        })
        .catch(() => {});
    }

    if (audioEngine) {
      await audioEngine.prepareRestoredTrack(normalized as any, safePos, 'active');
      if (restoreToken !== activeLoadToken) return;
      audioEngine
        .getWaveformData(normalized.videoId)
        .then((waveform) => {
          if (restoreToken === activeLoadToken) {
            set({ waveformBuckets: waveform });
          }
        })
        .catch(() => {
          const fallback = new Float32Array(200);
          for (let i = 0; i < 200; i++) {
            fallback[i] = 0.2 + 0.6 * Math.abs(Math.sin((i / 200) * Math.PI * 4));
          }
          if (restoreToken === activeLoadToken) {
            set({ waveformBuckets: fallback });
          }
        });
    }
  },

  crossfade: async (targetDeck?: DeckName, durationMs = 4000) => {
    const { audioEngine, activeDeck } = get();
    if (!audioEngine) return;
    const destDeck = targetDeck || (activeDeck === 'active' ? 'standby' : 'active');
    set({ isCrossfading: true });
    try {
      await audioEngine.crossfade(destDeck, durationMs);
      set({ activeDeck: destDeck, isCrossfading: false });
    } catch (err) {
      console.warn('[playerStore] crossfade failed:', err);
      set({ isCrossfading: false });
    }
  },

  setAutoMixStatus: (active: boolean, targetTitle = null) => {
    set({ autoMixStatus: { active: Boolean(active), targetTitle: active ? targetTitle : null } });
  },

  setNowPlayingModalOpen: (open: boolean) => {
    set({ isNowPlayingModalOpen: open });
  },

  setEqualizerBands: (gains: number[]) => {
    const { audioEngine } = get();
    if (audioEngine) {
      audioEngine.setEqualizerBands(gains);
    }
  },

  loadAutoEqProfile: async (profileName: string): Promise<boolean> => {
    const { audioEngine } = get();
    if (!profileName || typeof profileName !== 'string' || !profileName.trim()) {
      if (audioEngine) {
        await audioEngine.loadAutoEqProfile('');
      }
      set({ activeAutoEqProfile: null });
      return false;
    }
    if (audioEngine) {
      const ok = await audioEngine.loadAutoEqProfile(profileName);
      set({ activeAutoEqProfile: ok ? audioEngine.autoEqProfile : null });
      return ok;
    }
    const profile = await AutoEqLoader.findProfile(profileName);
    set({ activeAutoEqProfile: profile ?? null });
    return Boolean(profile);
  },

  setSpatialAudio: (enabled: boolean, width = 2.5) => {
    const { audioEngine } = get();
    if (audioEngine) {
      audioEngine.setSpatialAudio(enabled, width);
    }
  },

  setPlaybackRate: (rate: number) => {
    const safe = clampPlaybackRate(rate);
    const { audioEngine } = get();
    if (audioEngine && typeof (audioEngine as any).setPlaybackRate === 'function') {
      (audioEngine as any).setPlaybackRate(safe);
    }
    set({ playbackRate: safe });
  },

  setAbLoopStart: (ms: number | null) => {
    set((state) => {
      const startMs = typeof ms === 'number' && Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : null;
      let endMs = state.abLoop.endMs;
      if (startMs !== null && endMs !== null && endMs <= startMs + 250) {
        endMs = null;
      }
      return {
        abLoop: {
          startMs,
          endMs,
          active: startMs !== null && endMs !== null ? state.abLoop.active : false,
          barCount: null,
        },
      };
    });
  },

  setAbLoopEnd: (ms: number | null) => {
    set((state) => {
      const endMs = typeof ms === 'number' && Number.isFinite(ms) ? Math.max(250, Math.round(ms)) : null;
      const startMs = state.abLoop.startMs ?? (endMs !== null ? 0 : null);
      if (startMs !== null && endMs !== null && endMs <= startMs + 250) {
        return {
          abLoop: { ...state.abLoop, endMs: startMs + 250, active: true, barCount: null },
        };
      }
      return {
        abLoop: {
          startMs,
          endMs,
          active: startMs !== null && endMs !== null,
          barCount: null,
        },
      };
    });
  },

  setAbLoopRange: (startMs: number | null, endMs: number | null, barCount: number | null = null) => {
    const safeA = typeof startMs === 'number' && Number.isFinite(startMs) ? Math.max(0, Math.round(startMs)) : null;
    const safeB = typeof endMs === 'number' && Number.isFinite(endMs) ? Math.max(0, Math.round(endMs)) : null;
    const valid = safeA !== null && safeB !== null && safeB > safeA + 200;
    set({
      abLoop: {
        startMs: safeA,
        endMs: safeB,
        active: valid,
        barCount: valid ? barCount : null,
      },
    });
  },

  toggleAbLoop: () => {
    set((state) => {
      const hasRange =
        state.abLoop.startMs !== null &&
        state.abLoop.endMs !== null &&
        state.abLoop.endMs > state.abLoop.startMs;
      if (!hasRange) return state;
      return {
        abLoop: { ...state.abLoop, active: !state.abLoop.active },
      };
    });
  },

  clearAbLoop: () => {
    set({ abLoop: { startMs: null, endMs: null, active: false, barCount: null } });
  },

  _updatePlaybackState: (state: PlaybackStatus) => set({ playbackState: state }),
  _updatePosition: (positionMs: number) => set({ positionMs }),
  _setWaveformData: (waveform: Float32Array) => set({ waveformBuckets: waveform }),
  _setLivePcmEnergy: (energy: Float32Array) => set({ livePcmEnergy: energy, isLiveVisualizerActive: true }),
}));
