// src/state/playerStore.ts
// Single source of truth for all playback state, directly bound to AudioEngine

import { create } from 'zustand';
import type { Song } from '../models/Song';
import { normalizeSong } from '../models/Song';
import type { DeckName, PlaybackStatus, PlaybackState as EnginePlaybackState } from '../audio/AudioEngine';
import { AudioEngine } from '../audio/AudioEngine';
import { MusicService } from '../services/MusicService';
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
  isNowPlayingModalOpen: boolean;

  // Active playing stream quality badge metadata
  activeStreamQuality: string | null;
  activeStreamIsAtmos: boolean;

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
  setNowPlayingModalOpen: (open: boolean) => void;

  // DSP bridges
  setEqualizerBands: (gains: number[]) => void;
  loadAutoEqProfile: (profileName: string) => Promise<boolean>;
  setSpatialAudio: (enabled: boolean, width?: number) => void;

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
  const trackDur =
    currentTrack?.totalPlayTimeMs ||
    (currentTrack?.durationSec ? currentTrack.durationSec * 1000 : 0);
  return Math.max(durationMs || 0, engineDur, trackDur);
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
  const resolveFn =
    customStreamResolver ||
    ((id: string, title?: string, artist?: string) =>
      sharedMusicService.resolveStream(id, title, artist));
  resolveFn(currentTrack.videoId, currentTrack.title, currentTrack.artist)
    .then(async (resolved) => {
      if (
        !resolved?.url ||
        token !== activeLoadToken ||
        get().currentTrack?.videoId !== currentTrack.videoId
      )
        return;
      const freshQuality = resolved.quality || currentTrack.sourceQuality || get().activeStreamQuality || '160kbps Opus';
      const fresh = normalizeSong({
        ...currentTrack,
        streamUrl: resolved.url,
        sourceQuality: freshQuality,
      } as any);
      set({
        currentTrack: fresh,
        positionMs: resumeMs,
        activeStreamQuality: freshQuality,
        activeStreamIsAtmos: Boolean(resolved.isDolbyAtmos),
      });
      await audioEngine.loadTrack(fresh as any, 'active');
      if (resumeMs > 0) audioEngine.seek(resumeMs);
      if (get().playbackState === 'PLAYING') audioEngine.play();
    })
    .catch((err) => console.warn('[playerStore] Stream recovery failed:', err));
  return true;
}

/**
 * Recover from a premature 'ended' cutoff at resumeMs (up to 2 retries per track),
 * stepping down the quality ladder: Lossless -> YouTube Opus/AAC -> JioSaavn.
 */
async function recoverStreamFromPrematureEnd(
  get: () => PlayerStore,
  set: (p: Partial<PlayerState>) => void,
  resumeMs: number,
  attemptNum: number
): Promise<boolean> {
  const { audioEngine, currentTrack, activeStreamQuality } = get();
  const url = currentTrack?.streamUrl || '';
  if (!audioEngine || !currentTrack || /^(waveform-local|file):/i.test(url)) return false;
  const token = activeLoadToken;

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

      if (wasLossless && attemptNum === 1) {
        // Step 1 down ladder: Lossless FLAC -> YouTube Opus/AAC
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
            currentTrack.artist
          ));
      } else {
        // Step 2 down ladder: YouTube Opus/AAC -> JioSaavn 320kbps AAC (or alternate YouTube stream)
        const query = `${currentTrack.title || ''} ${currentTrack.artist || ''}`.trim();
        const target =
          currentTrack.title && currentTrack.artist
            ? {
                title: currentTrack.title,
                artist: currentTrack.artist,
                durationSec: currentTrack.durationSec,
              }
            : undefined;
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
            currentTrack.artist
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
    const fresh = normalizeSong({
      ...currentTrack,
      streamUrl: resolved.url,
      sourceQuality: freshQuality,
    } as any);
    set({
      currentTrack: fresh,
      positionMs: resumeMs,
      activeStreamQuality: freshQuality,
      activeStreamIsAtmos: Boolean(resolved.isDolbyAtmos),
    });
    await audioEngine.loadTrack(fresh as any, 'active');
    if (resumeMs > 0) audioEngine.seek(resumeMs);
    if (get().playbackState === 'PLAYING') audioEngine.play();
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
        initialPlayer.currentTrack?.totalPlayTimeMs ||
        (initialPlayer.currentTrack?.durationSec ? initialPlayer.currentTrack.durationSec * 1000 : 0)
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
  isNowPlayingModalOpen: false,

  activeStreamQuality: initialPlayer?.currentTrack?.sourceQuality || null,
  activeStreamIsAtmos: false,

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
      const trackDur = currentTrack
        ? (currentTrack.totalPlayTimeMs || (currentTrack.durationSec ? currentTrack.durationSec * 1000 : 0))
        : 0;
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

    // Premature 'ended' cutoff guard: recover stream from resumeMs (up to 2 retries stepping down quality ladder)
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
          if (prematureRetryState.inFlight || prematureRetryState.attempts >= 2) {
            return;
          }
          prematureRetryState.attempts += 1;
          prematureRetryState.inFlight = true;
          const attemptNum = prematureRetryState.attempts;
          set({ positionMs: safeResumeMs, playbackState: 'PLAYING' });
          recoverStreamFromPrematureEnd(get, set, safeResumeMs, attemptNum).finally(() => {
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
    const normalized = normalizeSong(track as any);
    const { audioEngine } = get();
    const duration = normalized.totalPlayTimeMs || (normalized.durationSec ? normalized.durationSec * 1000 : 0);
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

    set((state) => ({
      currentTrack: normalized,
      durationMs: duration,
      positionMs: 0,
      pendingResumePositionMs: deck === 'active' ? null : state.pendingResumePositionMs,
      activeDeck: deck,
      playbackState: deck === 'active' && autoPlay ? 'PLAYING' : state.playbackState,
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
              sharedMusicService.resolveStream(id, title, artist));
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
                  : normalized.totalPlayTimeMs || (normalized.durationSec ? normalized.durationSec * 1000 : 0);
              const stage1Quality = resolved.quality || normalized.sourceQuality || '160kbps Opus';
              const stage1IsAtmos = Boolean(resolved.isDolbyAtmos);
              const enriched = normalizeSong({
                ...normalized,
                streamUrl: resolved.url,
                sourceQuality: stage1Quality,
                ...(resolvedDurationMs > 0
                  ? {
                      totalPlayTimeMs: resolvedDurationMs,
                      durationSec: Math.round(resolvedDurationMs / 1000),
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
    const duration = normalized.totalPlayTimeMs || (normalized.durationSec ? normalized.durationSec * 1000 : 0);
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
          useThemeStore.getState().setArtworkPalette(palette);
        })
        .catch(() => {});
    }

    if (audioEngine) {
      await audioEngine.prepareRestoredTrack(normalized as any, safePos, 'active');
      audioEngine
        .getWaveformData(normalized.videoId)
        .then((waveform) => {
          set({ waveformBuckets: waveform });
        })
        .catch(() => {
          const fallback = new Float32Array(200);
          for (let i = 0; i < 200; i++) {
            fallback[i] = 0.2 + 0.6 * Math.abs(Math.sin((i / 200) * Math.PI * 4));
          }
          set({ waveformBuckets: fallback });
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
    if (audioEngine) {
      return await audioEngine.loadAutoEqProfile(profileName);
    }
    return false;
  },

  setSpatialAudio: (enabled: boolean, width = 2.5) => {
    const { audioEngine } = get();
    if (audioEngine) {
      audioEngine.setSpatialAudio(enabled, width);
    }
  },

  _updatePlaybackState: (state: PlaybackStatus) => set({ playbackState: state }),
  _updatePosition: (positionMs: number) => set({ positionMs }),
  _setWaveformData: (waveform: Float32Array) => set({ waveformBuckets: waveform }),
  _setLivePcmEnergy: (energy: Float32Array) => set({ livePcmEnergy: energy, isLiveVisualizerActive: true }),
}));
