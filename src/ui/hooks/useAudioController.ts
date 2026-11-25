// src/ui/hooks/useAudioController.ts
// Desktop audio controller managing AudioEngine lifecycle, track advancement, DSP sync, and media session

import { useEffect, useRef } from 'react';
import { isDeadOrStaleRestoredStreamUrl } from '../../audio/AudioEngine';
import { getSharedWaveFormPlaybackBridge } from '../../lyricVisualizer/bridge/waveFormPlaybackBridge';
import { useLyricVisualizerStore } from '../../lyricVisualizer/state/lyricVisualizerStore';
import { MlAudioService } from '../../services/MlAudioService';
import type { AppSettings } from '../../models/Settings';
import {
  DISCORD_DEFAULT_CLIENT_ID,
  DiscordRpcService,
  type DiscordRpcConfig,
} from '../../services/DiscordRpcService';
import { usePartyStore } from '../../services/PartySyncClient';
import { ListeningSessionTracker } from '../../services/StorageService';
import { StreamResolver } from '../../services/StreamResolver';
import { useLibraryStore } from '../../state/libraryStore';
import { usePlayerStore } from '../../state/playerStore';
import { useQueueStore } from '../../state/queueStore';
import { useSettingsStore } from '../../state/settingsStore';
import { saveSyncSession } from '../../utils/sessionPersistence';

const DISCORD_SETTING_KEYS = [
  'scrobble.discordRpcEnabled',
  'scrobble.discordClientId',
  'scrobble.discordDisplayFormat',
  'scrobble.discordShowTimeRemaining',
  'scrobble.discordShowAlbumArt',
  'scrobble.discordShowQualityAndButtons',
] as const;

function buildDiscordConfig(settings: AppSettings): DiscordRpcConfig {
  const rawClientId = settings['scrobble.discordClientId'];
  return {
    enabled: Boolean(settings['scrobble.discordRpcEnabled']),
    clientId:
      typeof rawClientId === 'string' && rawClientId.trim()
        ? rawClientId.trim()
        : DISCORD_DEFAULT_CLIENT_ID,
    displayFormat: settings['scrobble.discordDisplayFormat'] || 'song_on_waveform',
    showTimeRemaining: settings['scrobble.discordShowTimeRemaining'] !== false,
    showAlbumArt: settings['scrobble.discordShowAlbumArt'] !== false,
    showButtons: settings['scrobble.discordShowQualityAndButtons'] !== false,
  };
}

function resolveDurationSec(trackDurationSec: unknown, fallbackDurationMs: number): number {
  if (typeof trackDurationSec === 'number' && Number.isFinite(trackDurationSec) && trackDurationSec > 0) {
    return trackDurationSec;
  }
  return fallbackDurationMs > 0 ? fallbackDurationMs / 1000 : 0;
}

export function useAudioController() {
  const isInitialized = useRef(false);
  const discordRpcRef = useRef<DiscordRpcService | null>(null);
  const sessionTrackerRef = useRef<ListeningSessionTracker>(new ListeningSessionTracker());

  useEffect(() => {
    if (isInitialized.current) return;
    isInitialized.current = true;

    // 1. Initialize AudioEngine on mount
    const player = usePlayerStore.getState();
    player.initEngine();

    const engine = usePlayerStore.getState().audioEngine;
    if (engine && player.currentTrack) {
      const restoredTrack = player.currentTrack;
      const restoredPosMs = player.pendingResumePositionMs ?? player.positionMs;
      // Ensure bridge singleton is initialized and registered for forceResync
      const bridge = getSharedWaveFormPlaybackBridge();
      engine.onResumeResetToZeroCallback = () => {
        usePlayerStore.getState().syncPositionFromEngine(0);
        bridge.forceResync(0);
      };

      player.prepareRestoredTrack(restoredTrack, restoredPosMs).then(async () => {
        if (!isDeadOrStaleRestoredStreamUrl(restoredTrack.streamUrl)) {
          return;
        }
        try {
          const resolver = new StreamResolver();
          const resolved = await resolver.resolve(
            restoredTrack.videoId,
            restoredTrack.title,
            restoredTrack.artist,
            restoredTrack.durationSec
          );
          const latest = usePlayerStore.getState();
          if (
            !resolved?.url ||
            latest.currentTrack?.videoId !== restoredTrack.videoId ||
            latest.playbackState === 'PLAYING'
          ) {
            return;
          }
          const freshTrack = {
            ...latest.currentTrack,
            streamUrl: resolved.url,
            sourceQuality: resolved.quality || latest.currentTrack.sourceQuality,
          };
          usePlayerStore.setState({
            currentTrack: freshTrack,
            activeStreamQuality: freshTrack.sourceQuality || null,
          });
          await engine.loadTrack(freshTrack as any, 'active');
          if (restoredPosMs > 0 && usePlayerStore.getState().pendingResumePositionMs !== null) {
            engine.setPendingResumePosition(restoredPosMs / 1000);
            engine.applyPendingResumeSeek();
          }
        } catch {
          // Non-fatal: user can still press play to trigger fresh resolution
        }
      });
    }

    // 2. Listen for track completion on audio deck to advance queue
    let unsubEnded: (() => void) | null = null;
    if (engine) {
      unsubEnded = engine.onTrackEnded(() => {
        useQueueStore.getState().advanceQueue();
      });
    }

    // 3. Apply initial persisted DSP / AutoEQ state & subscribe to settingsStore changes
    if (engine) {
      const initialSettings = useSettingsStore.getState().settings;
      try {
        if (Array.isArray(initialSettings['dsp.equalizerBands'])) {
          engine.setEqualizerBands(initialSettings['dsp.equalizerBands']);
        }
      } catch {}
      try {
        engine.setSpatialAudio(
          Boolean(initialSettings['dsp.spatialAudioEnabled']),
          initialSettings['dsp.spatialWidthGain']
        );
      } catch {}
      const initialAutoEqEnabled = Boolean(initialSettings['dsp.autoEqEnabled']);
      const initialAutoEqProfile = initialSettings['dsp.autoEqSelectedProfile'];
      void usePlayerStore
        .getState()
        .loadAutoEqProfile(initialAutoEqEnabled && initialAutoEqProfile ? initialAutoEqProfile : '')
        .catch(() => {});
    }

    const unsubSettings = useSettingsStore.subscribe((state, prevState) => {
      if (!engine) return;

      // Equalizer bands
      if (state.settings['dsp.equalizerBands'] !== prevState?.settings?.['dsp.equalizerBands']) {
        try {
          engine.setEqualizerBands(state.settings['dsp.equalizerBands']);
        } catch {}
      }

      // Spatial Audio
      if (
        state.settings['dsp.spatialAudioEnabled'] !== prevState?.settings?.['dsp.spatialAudioEnabled'] ||
        state.settings['dsp.spatialWidthGain'] !== prevState?.settings?.['dsp.spatialWidthGain']
      ) {
        engine.setSpatialAudio(
          state.settings['dsp.spatialAudioEnabled'],
          state.settings['dsp.spatialWidthGain']
        );
      }

      // AutoEQ profile & enable/disable toggle -> update both audioEngine & playerStore.activeAutoEqProfile
      if (
        state.settings['dsp.autoEqSelectedProfile'] !== prevState?.settings?.['dsp.autoEqSelectedProfile'] ||
        state.settings['dsp.autoEqEnabled'] !== prevState?.settings?.['dsp.autoEqEnabled']
      ) {
        const autoEqEnabled = Boolean(state.settings['dsp.autoEqEnabled']);
        const profile = state.settings['dsp.autoEqSelectedProfile'];
        void usePlayerStore
          .getState()
          .loadAutoEqProfile(autoEqEnabled && profile ? profile : '')
          .catch(() => {});
      }
    });

    return () => {
      if (unsubEnded) unsubEnded();
      unsubSettings();
    };
  }, []);

  // 3B. Listen Together party state sync for Discord Join button + Discord Rich Presence lifecycle
  useEffect(() => {
    const rpc = discordRpcRef.current ?? (discordRpcRef.current = new DiscordRpcService());
    let scrubDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    let lastPush = {
      videoId: null as string | null,
      isPlaying: false,
      posMs: 0,
      pushedAtMs: 0,
    };

    const clearScrubTimer = () => {
      if (scrubDebounceTimer !== null) {
        clearTimeout(scrubDebounceTimer);
        scrubDebounceTimer = null;
      }
    };

    const pushDiscordPlayback = (overridePosMs?: number) => {
      const settings = useSettingsStore.getState().settings;
      const p = usePlayerStore.getState();
      if (!settings['scrobble.discordRpcEnabled'] || !p.currentTrack) {
        lastPush = { videoId: null, isPlaying: false, posMs: 0, pushedAtMs: 0 };
        rpc.clearActivity();
        return;
      }

      const rawPosMs =
        overridePosMs ??
        (p.isScrubbing
          ? p.positionMs
          : p.audioEngine
          ? p.audioEngine.getCurrentPositionMs()
          : p.positionMs);
      const posMs = Math.max(0, Math.round(Number.isFinite(rawPosMs) ? rawPosMs : 0));
      const engineDurMs = p.audioEngine ? p.audioEngine.getCurrentDurationMs() : 0;
      const durMs =
        engineDurMs > 0
          ? engineDurMs
          : p.durationMs > 0
          ? p.durationMs
          : Math.round(resolveDurationSec(p.currentTrack.durationSec, 0) * 1000);
      const isPlaying = p.playbackState === 'PLAYING';
      const activeQuality = p.activeStreamQuality || p.currentTrack.sourceQuality;

      rpc.updatePlayback(
        {
          ...p.currentTrack,
          sourceQuality: activeQuality,
        },
        posMs,
        durMs,
        isPlaying,
        1.0
      );
      lastPush = {
        videoId: p.currentTrack.videoId,
        isPlaying,
        posMs,
        pushedAtMs: Date.now(),
      };
    };

    // Initial mount config & party state (usePartyStore already manages player playback sync via attachPlayerStoreSync)
    const initialParty = usePartyStore.getState();
    rpc.setPartyState(
      initialParty.status === 'connected' ? initialParty.partyCode : null,
      initialParty.lanUrl
    );
    const initialConfig = buildDiscordConfig(useSettingsStore.getState().settings);
    rpc.configure(initialConfig);
    if (!initialConfig.enabled || !usePlayerStore.getState().currentTrack) {
      rpc.clearActivity();
    } else {
      pushDiscordPlayback();
    }

    const unsubParty = usePartyStore.subscribe((party, prevParty) => {
      if (
        party.status === prevParty?.status &&
        party.partyCode === prevParty?.partyCode &&
        party.lanUrl === prevParty?.lanUrl
      ) {
        return;
      }
      rpc.setPartyState(party.status === 'connected' ? party.partyCode : null, party.lanUrl);
      if (useSettingsStore.getState().settings['scrobble.discordRpcEnabled']) {
        pushDiscordPlayback();
      }
    });

    const unsubDiscordSettings = useSettingsStore.subscribe((state, prevState) => {
      const changed = DISCORD_SETTING_KEYS.some(
        (key) => state.settings[key] !== prevState?.settings?.[key]
      );
      if (!changed) return;

      const cfg = buildDiscordConfig(state.settings);
      rpc.configure(cfg);
      if (!cfg.enabled) {
        clearScrubTimer();
        lastPush = { videoId: null, isPlaying: false, posMs: 0, pushedAtMs: 0 };
        rpc.clearActivity();
        return;
      }
      pushDiscordPlayback();
    });

    const unsubPlayerRpc = usePlayerStore.subscribe((state, prevState) => {
      const trackChanged = state.currentTrack?.videoId !== prevState?.currentTrack?.videoId;
      if (!state.currentTrack) {
        if (trackChanged) {
          clearScrubTimer();
          lastPush = { videoId: null, isPlaying: false, posMs: 0, pushedAtMs: 0 };
          rpc.clearActivity();
        }
        return;
      }

      if (!useSettingsStore.getState().settings['scrobble.discordRpcEnabled']) {
        return;
      }

      const playStateChanged = state.playbackState !== prevState?.playbackState;
      const qualityChanged = state.activeStreamQuality !== prevState?.activeStreamQuality;
      const scrubCompleted = Boolean(prevState?.isScrubbing) && !state.isScrubbing;

      if (trackChanged || playStateChanged || qualityChanged || scrubCompleted) {
        clearScrubTimer();
        pushDiscordPlayback(scrubCompleted ? state.positionMs : undefined);
        return;
      }

      if (state.isScrubbing) {
        if (state.positionMs !== prevState?.positionMs) {
          clearScrubTimer();
          scrubDebounceTimer = setTimeout(() => {
            scrubDebounceTimer = null;
            pushDiscordPlayback(usePlayerStore.getState().positionMs);
          }, 400);
        }
        return;
      }

      if (state.positionMs !== prevState?.positionMs) {
        const expectedPosMs = lastPush.isPlaying
          ? lastPush.posMs + Math.max(0, Date.now() - lastPush.pushedAtMs)
          : lastPush.posMs;
        if (
          lastPush.videoId !== state.currentTrack.videoId ||
          Math.abs(state.positionMs - expectedPosMs) > 2000
        ) {
          pushDiscordPlayback(state.positionMs);
        }
      }
    });

    return () => {
      clearScrubTimer();
      unsubParty();
      unsubDiscordSettings();
      unsubPlayerRpc();
      rpc.clearActivity();
    };
  }, []);

  // 3C. Tray playback commands & minimize/close-to-tray behavior sync
  useEffect(() => {
    const api = typeof window !== 'undefined' ? (window as any).electronAPI : undefined;
    const syncTrayBehavior = (settings: AppSettings) => {
      void api?.setTrayBehavior?.({
        minimizeToTray: Boolean(settings['ui.minimizeToTray']),
        closeToTray: Boolean(settings['ui.closeToTray']),
      });
    };

    syncTrayBehavior(useSettingsStore.getState().settings);

    const unsubTraySettings = useSettingsStore.subscribe((state, prevState) => {
      if (
        state.settings['ui.minimizeToTray'] !== prevState?.settings?.['ui.minimizeToTray'] ||
        state.settings['ui.closeToTray'] !== prevState?.settings?.['ui.closeToTray']
      ) {
        syncTrayBehavior(state.settings);
      }
    });

    const unsubMediaCommand = api?.onMediaCommand?.((command: string) => {
      if (command === 'toggle-playback') {
        usePlayerStore.getState().togglePlay();
      } else if (command === 'next-track') {
        useQueueStore.getState().advanceQueue();
      } else if (command === 'prev-track') {
        useQueueStore.getState().previousTrack();
      }
    });

    return () => {
      unsubTraySettings();
      if (typeof unsubMediaCommand === 'function') {
        unsubMediaCommand();
      }
    };
  }, []);

  // 4. Update navigator.mediaSession when currentTrack or playbackState changes
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const playbackState = usePlayerStore((s) => s.playbackState);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    if (currentTrack) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title || 'Unknown Title',
        artist: currentTrack.artist || 'Unknown Artist',
        album: currentTrack.album || 'WaveForm',
        artwork: currentTrack.thumbnailUrl
          ? [{ src: currentTrack.thumbnailUrl, sizes: '512x512', type: 'image/jpeg' }]
          : [],
      });
    } else {
      navigator.mediaSession.metadata = null;
    }

    navigator.mediaSession.playbackState =
      playbackState === 'PLAYING'
        ? 'playing'
        : playbackState === 'PAUSED'
        ? 'paused'
        : 'none';

    try {
      navigator.mediaSession.setActionHandler('play', () => {
        usePlayerStore.getState().play();
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        usePlayerStore.getState().pause();
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        useQueueStore.getState().previousTrack();
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        useQueueStore.getState().advanceQueue();
      });
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime !== undefined && details.seekTime !== null) {
          usePlayerStore.getState().seek(details.seekTime * 1000);
        }
      });
      navigator.mediaSession.setActionHandler('stop', () => {
        usePlayerStore.getState().pause();
        usePlayerStore.getState().seek(0);
      });
    } catch {}
  }, [currentTrack, playbackState]);

  // 5. Real-media playback progress, continuous 1s listening telemetry & throttled Zustand store synchronization
  useEffect(() => {
    const tracker = sessionTrackerRef.current;
    const flushSessionEntry = (entry: ReturnType<ListeningSessionTracker['flush']>) => {
      if (!entry) return;
      void useLibraryStore.getState().upsertListeningSession(entry).catch(() => {});
    };

    if (playbackState !== 'PLAYING') {
      flushSessionEntry(tracker.pause(Date.now()));
      return;
    }

    let lastStoreSyncTime = Date.now();

    const timer = setInterval(() => {
      const state = usePlayerStore.getState();
      if (state.playbackState !== 'PLAYING' || !state.currentTrack) return;

      const engine = state.audioEngine;
      if (!engine) return;

      const activeDeck = engine.activeDeckName === 'active' ? engine.deckA : engine.deckB;
      const el = activeDeck.audioElement;
      const isRealMediaPlaying =
        !!el &&
        !el.paused &&
        !el.ended &&
        el.readyState >= 2;

      if (isRealMediaPlaying) {
        const engineTimeSec = engine.getCurrentTime();
        const nextPos = Math.round(engineTimeSec * 1000);
        const engineDur = engine.getCurrentDurationMs();
        const nextDur = engineDur > 0 ? engineDur : state.durationMs;
        const storeTimeSec = state.positionMs / 1000;
        const now = Date.now();
        const durSec = resolveDurationSec(state.currentTrack.durationSec, nextDur);

        const flushed = tracker.onTick({
          song: {
            ...state.currentTrack,
            sourceQuality: state.activeStreamQuality || state.currentTrack.sourceQuality,
          },
          isPlaying: true,
          isSeeking: state.isScrubbing || engine.isSeekingActive(),
          engineTimeSec,
          durationSec: durSec,
          nowMs: now,
        });
        for (const entry of flushed) {
          flushSessionEntry(entry);
        }

        // Drift Watchdog: snap store + lyric visualizer if >1.0s out of sync
        if (
          !state.isScrubbing &&
          !engine.isSeekingActive() &&
          Math.abs(storeTimeSec - engineTimeSec) > 1.0
        ) {
          lastStoreSyncTime = now;
          state.syncPositionFromEngine(nextPos);
          if (nextDur !== state.durationMs) {
            usePlayerStore.setState({ durationMs: nextDur });
          }
          getSharedWaveFormPlaybackBridge().forceResync(engineTimeSec);
        } else if (!state.isScrubbing && now - lastStoreSyncTime >= 1000) {
          lastStoreSyncTime = now;
          usePlayerStore.setState({
            positionMs: nextPos,
            durationMs: nextDur,
          });
        }
      } else if (
        el &&
        (el.getAttribute('src') || el.src) &&
        el.paused &&
        !el.ended &&
        !activeDeck.isPlaying &&
        state.playbackState === 'PLAYING'
      ) {
        usePlayerStore.setState({ playbackState: 'PAUSED' });
      }
    }, 250);

    return () => {
      clearInterval(timer);
      flushSessionEntry(tracker.pause(Date.now()));
      const state = usePlayerStore.getState();
      const engine = state.audioEngine;
      if (engine && state.playbackState === 'PAUSED') {
        const pos = engine.getCurrentPositionMs();
        if (pos > 0) {
          usePlayerStore.setState({
            positionMs: pos,
          });
        }
      }
    };
  }, [playbackState, currentTrack?.videoId]);

  // 6. Persist exact state before page reload (F5 / Ctrl+R) or window close
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleUnload = () => {
      const pendingReplay = sessionTrackerRef.current.flush(Date.now());
      if (pendingReplay) {
        try {
          void useLibraryStore.getState().upsertListeningSession(pendingReplay);
        } catch {}
      }
      const p = usePlayerStore.getState();
      const q = useQueueStore.getState();
      const enginePos = p.audioEngine ? p.audioEngine.getCurrentPositionMs() : p.positionMs;
      const currentPos =
        enginePos > 0 ? enginePos : (p.pendingResumePositionMs ?? p.positionMs);

      saveSyncSession({
        version: 1,
        savedAt: Date.now(),
        player: {
          currentTrack: p.currentTrack,
          positionMs: currentPos,
          durationMs: p.durationMs,
          volume: p.volume,
          isMuted: p.isMuted,
          preMuteVolume: p.preMuteVolume,
          isShuffle: p.isShuffle,
          repeatMode: p.repeatMode,
          playbackState: 'PAUSED',
        },
        queue: {
          tiers: q.tiers,
          currentSong: q.currentSong,
          currentTier: q.currentTier,
          currentIndex: q.currentIndex,
          history: q.history.slice(0, 50),
          context: q.context,
        },
      });
    };

    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
    };
  }, []);

  // 7. Neural beat/downbeat + vocal-silence analysis hook for active tracks
  useEffect(() => {
    const engine = usePlayerStore.getState().audioEngine;
    if (!currentTrack?.videoId) {
      engine?.setTrackBeatAnalysis(null);
      useLyricVisualizerStore.getState().setVocalSilenceRanges([]);
      return;
    }

    let cancelled = false;
    const trackId = currentTrack.videoId;
    const url =
      currentTrack.streamUrl ||
      (currentTrack.localFilePath ? `local://${currentTrack.localFilePath}` : null);

    engine?.setTrackBeatAnalysis(null);
    useLyricVisualizerStore.getState().setVocalSilenceRanges([]);

    void MlAudioService.getCachedTrackBeats(trackId)
      .then((cached) => {
        if (cancelled) return cached;
        if (cached) {
          engine?.setTrackBeatAnalysis(cached);
          useLyricVisualizerStore.getState().setVocalSilenceRanges(cached.vocalSilenceRanges);
          return cached;
        }
        if (url && (currentTrack.localFilePath || currentTrack.isLocal)) {
          return MlAudioService.analyzeTrackBeats(trackId, url).then((fresh) => {
            if (!cancelled && fresh) {
              engine?.setTrackBeatAnalysis(fresh);
              useLyricVisualizerStore.getState().setVocalSilenceRanges(fresh.vocalSilenceRanges);
            }
            return fresh;
          });
        }
        return null;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [currentTrack?.videoId, currentTrack?.streamUrl, currentTrack?.localFilePath]);

  return {
    play: usePlayerStore.getState().play,
    pause: usePlayerStore.getState().pause,
    togglePlay: usePlayerStore.getState().togglePlay,
    seek: usePlayerStore.getState().seek,
    setVolume: usePlayerStore.getState().setVolume,
    toggleMute: usePlayerStore.getState().toggleMute,
    nextTrack: useQueueStore.getState().advanceQueue,
    previousTrack: useQueueStore.getState().previousTrack,
  };
}
