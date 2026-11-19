// src/ui/hooks/useAudioController.ts
// Desktop audio controller managing AudioEngine lifecycle, track advancement, DSP sync, and media session

import { useEffect, useRef } from 'react';
import { usePlayerStore } from '../../state/playerStore';
import { useQueueStore } from '../../state/queueStore';
import { useSettingsStore } from '../../state/settingsStore';
import { saveSyncSession } from '../../utils/sessionPersistence';

export function useAudioController() {
  const isInitialized = useRef(false);

  useEffect(() => {
    if (isInitialized.current) return;
    isInitialized.current = true;

    // 1. Initialize AudioEngine on mount
    const player = usePlayerStore.getState();
    player.initEngine();

    const engine = usePlayerStore.getState().audioEngine;
    if (engine && player.currentTrack) {
      player.prepareRestoredTrack(player.currentTrack, player.positionMs);
    }

    // 2. Listen for track completion on audio deck to advance queue
    let unsubEnded: (() => void) | null = null;
    if (engine) {
      unsubEnded = engine.onTrackEnded(() => {
        useQueueStore.getState().advanceQueue();
      });
    }

    // 3. Subscribe to DSP settings changes from settingsStore
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

      // AutoEQ profile
      if (state.settings['dsp.autoEqSelectedProfile'] !== prevState?.settings?.['dsp.autoEqSelectedProfile']) {
        const profile = state.settings['dsp.autoEqSelectedProfile'];
        if (state.settings['dsp.autoEqEnabled'] && profile) {
          engine.loadAutoEqProfile(profile).catch(() => {});
        }
      }
    });

    return () => {
      if (unsubEnded) unsubEnded();
      unsubSettings();
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

  // 5. Real-media playback progress & throttled Zustand store synchronization (no synthetic progress)
  useEffect(() => {
    if (playbackState !== 'PLAYING') return;

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
        const nextPos = engine.getCurrentPositionMs();
        const engineDur = engine.getCurrentDurationMs();
        const nextDur = engineDur > 0 ? engineDur : state.durationMs;

        const now = Date.now();
        if (now - lastStoreSyncTime >= 1000 || Math.abs(nextPos - state.positionMs) > 1500) {
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
        !activeDeck.isPlaying &&
        state.playbackState === 'PLAYING'
      ) {
        usePlayerStore.setState({ playbackState: 'PAUSED' });
      }
    }, 250);

    return () => {
      clearInterval(timer);
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
  }, [playbackState]);

  // 6. Persist exact state before page reload (F5 / Ctrl+R) or window close
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleUnload = () => {
      const p = usePlayerStore.getState();
      const q = useQueueStore.getState();
      const currentPos = p.audioEngine ? p.audioEngine.getCurrentPositionMs() : p.positionMs;

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
