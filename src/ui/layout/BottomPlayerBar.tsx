// src/ui/layout/BottomPlayerBar.tsx
// Zone 4: Floating 76px Liquid-Glass Player Dock with 3 distinct ergonomic clusters
// Fully decoupled state with granular selectors and leaf PlaybackTimePill for 0Hz re-renders during playback

import { ArtistCredits } from '../common/ArtistCredits';
import React, { useRef, useEffect } from 'react';
import {
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  Heart,
  AlignLeft,
  ListOrdered,
  Maximize2,
  Music2,
} from 'lucide-react';
import { usePlayerStore } from '../../state/playerStore';
import { useQueueStore } from '../../state/queueStore';
import { useLibraryStore } from '../../state/libraryStore';
import { useSettingsStore } from '../../state/settingsStore';
import { useNavigationStore } from '../../state/navigationStore';
import { WaveformCanvasSeekbar } from '../player/WaveformCanvasSeekbar';
import {
  PlayerPlayIcon,
  PlayerPauseIcon,
  PlayerPreviousIcon,
  PlayerNextIcon,
  LosslessWaveIcon,
  DolbyAtmosIcon,
  OutputSpeakerIcon,
} from '../common/WaveFormIcons';

export interface PlaybackTimePillProps {
  type: 'elapsed' | 'remaining';
  durationMs?: number;
  className?: string;
}

/**
 * Isolated leaf component that updates elapsed/remaining text directly in the DOM
 * without causing any re-renders of the parent 3-zone player capsule.
 */
export const PlaybackTimePill: React.FC<PlaybackTimePillProps> = React.memo(({
  type,
  durationMs: propDurationMs,
  className = '',
}) => {
  const spanRef = useRef<HTMLSpanElement>(null);
  const isPlaying = usePlayerStore((s) => s.playbackState === 'PLAYING');
  const storeDurationMs = usePlayerStore((s) => s.durationMs);
  const durationMs = propDurationMs ?? storeDurationMs;

  useEffect(() => {
    const updateTime = () => {
      if (!spanRef.current) return;
      const engine = usePlayerStore.getState().audioEngine;
      const posMs = engine ? engine.getCurrentPositionMs() : usePlayerStore.getState().positionMs;

      const totalSec = Math.max(0, Math.floor((durationMs || 0) / 1000));
      const elapsedSec = Math.max(0, Math.floor((posMs || 0) / 1000));

      if (type === 'elapsed') {
        const m = Math.floor(elapsedSec / 60);
        const s = Math.floor(elapsedSec % 60);
        spanRef.current.textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
      } else {
        const remainingSec = Math.max(0, totalSec - elapsedSec);
        const m = Math.floor(remainingSec / 60);
        const s = Math.floor(remainingSec % 60);
        spanRef.current.textContent = `-${m}:${s < 10 ? '0' : ''}${s}`;
      }
    };

    updateTime();

    if (!isPlaying) return;

    // 250ms interval ensures sub-second accuracy with direct DOM mutation (0 React re-renders)
    const interval = setInterval(updateTime, 250);
    return () => clearInterval(interval);
  }, [isPlaying, durationMs, type]);

  return (
    <span ref={spanRef} className={className}>
      {type === 'elapsed' ? '0:00' : '-0:00'}
    </span>
  );
});

PlaybackTimePill.displayName = 'PlaybackTimePill';

export interface BottomPlayerBarProps {
  currentTrack?: {
    title: string;
    artist: string;
    duration: string;
    cover: string;
  };
  isPlaying?: boolean;
  onTogglePlay?: () => void;
  isLyricsOpen?: boolean;
  onToggleLyrics?: () => void;
  isQueueOpen?: boolean;
  onToggleQueue?: () => void;
}

export const BottomPlayerBar: React.FC<BottomPlayerBarProps> = React.memo(({
  currentTrack: fallbackTrack,
  isPlaying: externalIsPlaying,
  onTogglePlay: externalOnTogglePlay,
  isLyricsOpen: externalIsLyricsOpen = false,
  onToggleLyrics: externalOnToggleLyrics,
  isQueueOpen: externalIsQueueOpen = false,
  onToggleQueue: externalOnToggleQueue,
}) => {
  // Granular Zustand selectors - eliminates wide re-renders on 50ms/1Hz position changes
  const storeTrack = usePlayerStore((s) => s.currentTrack);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const durationMs = usePlayerStore((s) => s.durationMs);
  const volume = usePlayerStore((s) => s.volume);
  const isMuted = usePlayerStore((s) => s.isMuted);
  const isShuffle = usePlayerStore((s) => s.isShuffle);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const waveformBuckets = usePlayerStore((s) => s.waveformBuckets);

  // Stable action callbacks
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const seek = usePlayerStore((s) => s.seek);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeatMode = usePlayerStore((s) => s.cycleRepeatMode);
  const adjustVolumeRelative = usePlayerStore((s) => s.adjustVolumeRelative);
  const setNowPlayingModalOpen = usePlayerStore((s) => s.setNowPlayingModalOpen);

  const { advanceQueue, previousTrack } = useQueueStore();
  const { toggleFavorite, isFavorite } = useLibraryStore();
  const { settings } = useSettingsStore();
  const { navigateToArtist, navigateToTab, setEqualizerOpen } = useNavigationStore();

  const activeTrack =
    storeTrack ||
    (fallbackTrack
      ? {
          videoId: 'sample',
          title: fallbackTrack.title,
          artist: fallbackTrack.artist,
          thumbnailUrl: fallbackTrack.cover,
          durationSec: 243,
          totalPlayTimeMs: 243000,
          liked: false,
          playCount: 1,
          artistIds: [],
          artists: [],
          isExplicit: false,
        }
      : null);

  const isPlaying = externalIsPlaying !== undefined ? externalIsPlaying : playbackState === 'PLAYING';
  const handleTogglePlay = externalOnTogglePlay || togglePlay;
  const isLiked = activeTrack ? isFavorite(activeTrack.videoId) : false;

  const isAtmos = Boolean(settings['dsp.spatialAudioEnabled']);

  const totalSec =
    (durationMs > 0
      ? durationMs
      : activeTrack?.durationSec
      ? activeTrack.durationSec * 1000
      : 0) / 1000;

  const handleVolumeWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.05 : -0.05;
    adjustVolumeRelative(delta);
  };

  return (
    <footer className="fixed bottom-0 left-0 right-0 h-[92px] px-4 pb-4 pt-0 select-none z-40 pointer-events-none">
      <div className="liquid-glass-capsule h-16 h-[76px] w-full rounded-2xl flex items-center justify-between px-4 text-white pointer-events-auto shadow-[0_20px_48px_rgba(0,0,0,0.65)] border border-white/18 bg-[rgba(20,20,25,0.78)] backdrop-blur-2xl">
        {/* =========================================================================
         * CLUSTER 1 (Left, 280px): Artwork, Metadata, Single Clean Badge, Heart
         * ========================================================================= */}
        <div className="flex items-center gap-3 w-[220px] min-[768px]:w-[280px] w-[280px] shrink-0 min-w-0">
          {/* 54px WinUI 3 Artwork Lockup (with 48px w-12 h-12 fallback) */}
          <div
            onClick={() => setNowPlayingModalOpen(true)}
            className="artwork-lockup relative group w-12 h-12 w-[54px] h-[54px] rounded-xl bg-neutral-900 shrink-0 cursor-pointer overflow-hidden transition-transform duration-200 hover:scale-105"
          >
            {activeTrack?.thumbnailUrl ? (
              <img
                src={activeTrack.thumbnailUrl}
                alt={activeTrack.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-neutral-500 bg-white/5">
                <Music2 size={20} />
              </div>
            )}
          </div>

          {/* Metadata Stack & Single Quality Badge */}
          <div className="min-w-0 flex-1 flex flex-col justify-center">
            {/* Title Row */}
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                onClick={() => setNowPlayingModalOpen(true)}
                className="text-[13px] font-bold text-white truncate hover:underline cursor-pointer tracking-tight"
                title={activeTrack?.title}
              >
                {activeTrack?.title || 'Not Playing'}
              </span>
              {activeTrack?.isExplicit && (
                <span className="px-1 py-0.2 rounded text-[8px] font-extrabold bg-white/15 text-white/80 shrink-0">
                  E
                </span>
              )}
            </div>

            {/* Artist & Quality Badge Row */}
            <div className="flex items-center gap-2 mt-0.5 min-w-0">
              <p
                className="text-[11px] font-medium text-[var(--color-on-surface-variant)] truncate"
                title={activeTrack?.artist}
              >
                <ArtistCredits
                  artist={activeTrack?.artist}
                  artists={activeTrack?.artists}
                  artistIds={activeTrack?.artistIds}
                  fallback="Select any song to stream"
                  onNavigate={(id) => {
                    usePlayerStore.getState().setNowPlayingModalOpen(false);
                    navigateToArtist(id);
                  }}
                />
              </p>

              {/* Single Clean Quality Badge */}
              <button
                onClick={() => setEqualizerOpen(true)}
                title={isAtmos ? 'Dolby Atmos Active' : 'Lossless ALAC 24-bit/48kHz'}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-white/10 text-white/90 border border-white/15 hover:border-[var(--color-accent)] transition-colors shrink-0 cursor-pointer"
              >
                {isAtmos ? (
                  <>
                    <DolbyAtmosIcon size={11} className="text-cyan-400" />
                    <span>ATMOS</span>
                  </>
                ) : (
                  <>
                    <LosslessWaveIcon size={12} className="text-[var(--color-accent)]" />
                    <span>LOSSLESS 24/48</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Favorite Heart Button */}
          {activeTrack && (
            <button
              onClick={() => toggleFavorite(activeTrack as any)}
              className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 transition-all cursor-pointer shrink-0"
              title={isLiked ? 'Remove from Favorites' : 'Add to Favorites'}
            >
              <Heart
                size={16}
                className={isLiked ? 'text-[var(--color-accent)] fill-current' : 'text-[var(--color-on-surface-variant)] hover:text-white'}
              />
            </button>
          )}
        </div>

        {/* =========================================================================
         * CLUSTER 2 (Center, flex-1 max-w-xl): Transport Controls & 68-Bar Waveform
         * ========================================================================= */}
        <div className="flex flex-col items-center justify-center flex-1 max-w-xl px-4 min-w-0">
          {/* Row 1: Transport Controls */}
          <div className="flex items-center gap-4 mb-1">
            <button
              onClick={toggleShuffle}
              className={`p-1.5 rounded-full transition-colors cursor-pointer ${
                isShuffle
                  ? 'text-[var(--color-accent)] bg-white/10'
                  : 'text-[var(--color-on-surface-variant)] hover:text-white'
              }`}
              title="Shuffle (S)"
            >
              <Shuffle size={14} />
            </button>

            <button
              onClick={previousTrack}
              className="p-1.5 rounded-full text-white/85 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
              title="Previous Track"
            >
              <PlayerPreviousIcon size={20} />
            </button>

            {/* Solid White Play/Pause Pill (36x36px) */}
            <button
              onClick={handleTogglePlay}
              className="w-9 h-9 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 shadow-[0_4px_16px_rgba(255,255,255,0.25)] transition-all cursor-pointer"
              title={isPlaying ? 'Pause' : 'Play'}
              aria-label={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            >
              {isPlaying ? (
                <PlayerPauseIcon size={20} />
              ) : (
                <PlayerPlayIcon size={20} className="ml-0.5" />
              )}
            </button>

            <button
              onClick={() => advanceQueue()}
              className="p-1.5 rounded-full text-white/85 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
              title="Next Track"
            >
              <PlayerNextIcon size={20} />
            </button>

            <button
              onClick={cycleRepeatMode}
              className={`p-1.5 rounded-full transition-colors cursor-pointer ${
                repeatMode !== 'off'
                  ? 'text-[var(--color-accent)] bg-white/10'
                  : 'text-[var(--color-on-surface-variant)] hover:text-white'
              }`}
              title={
                repeatMode === 'one'
                  ? 'Repeat One (R)'
                  : repeatMode === 'all'
                  ? 'Repeat All (R)'
                  : 'Repeat Off (R)'
              }
            >
              {repeatMode === 'one' ? <Repeat1 size={14} /> : <Repeat size={14} />}
            </button>
          </div>

          {/* Row 2: 68-Bar Waveform Scrubber with Decoupled Time Pills */}
          <div className="w-full flex items-center gap-2.5">
            <PlaybackTimePill
              type="elapsed"
              durationMs={totalSec * 1000}
              className="text-[10px] font-mono text-[var(--color-on-surface-variant)] w-9 text-right shrink-0"
            />

            <div className="flex-1 h-7 flex items-center min-w-0">
              <WaveformCanvasSeekbar
                amplitudes={waveformBuckets}
                isPlaying={isPlaying}
                durationMs={totalSec * 1000}
                onSeek={seek}
                height={26}
                className="w-full flex-1"
              />
            </div>

            <PlaybackTimePill
              type="remaining"
              durationMs={totalSec * 1000}
              className="text-[10px] font-mono text-[var(--color-on-surface-variant)] w-9 text-left shrink-0"
            />
          </div>
        </div>

        {/* =========================================================================
         * CLUSTER 3 (Right, 240px): Output Route, Volume Wheel & Feature Toggles
         * ========================================================================= */}
        <div className="flex items-center justify-end gap-2 w-[200px] min-[768px]:w-[240px] w-[240px] shrink-0">
          {/* Audio Output / DSP Route */}
          <button
            onClick={() => setEqualizerOpen(true)}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-on-surface-variant)] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title="Audio Output & DSP Engine"
          >
            <OutputSpeakerIcon size={16} />
          </button>

          {/* Volume slider with mouse wheel support */}
          <div
            onWheel={handleVolumeWheel}
            className="flex items-center gap-1.5"
            title="Volume (Scroll wheel supported)"
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleMute();
              }}
              className="w-6 h-6 flex items-center justify-center text-[var(--color-on-surface-variant)] hover:text-white transition-colors cursor-pointer"
              title={isMuted || volume === 0 ? 'Unmute' : 'Mute'}
              aria-label={isMuted || volume === 0 ? 'Unmute (M)' : 'Mute (M)'}
            >
              {isMuted || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={isMuted ? 0 : volume}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                // Single store update: setVolume already clears the muted flag for any value > 0.
                // (The old `if (isMuted) toggleMute()` used a stale closure value and re-muted the player.)
                setVolume(parseFloat(e.target.value));
              }}
              className="w-18 h-1 accent-[var(--color-accent)] bg-white/20 rounded-lg cursor-pointer"
            />
          </div>

          <div className="h-4 w-[0.5px] bg-white/15 mx-0.5" />

          {/* Syllable Lyrics Toggle Pill */}
          <button
            onClick={externalOnToggleLyrics}
            className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all cursor-pointer ${
              externalIsLyricsOpen
                ? 'bg-white/15 text-[var(--color-accent)] border border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]'
                : 'text-[var(--color-on-surface-variant)] hover:text-white hover:bg-white/10'
            }`}
            title="Toggle Lyrics"
            aria-label="Toggle Lyrics (L)"
          >
            <AlignLeft size={15} />
          </button>

          {/* Up Next Queue Toggle Pill */}
          <button
            onClick={externalOnToggleQueue}
            className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all cursor-pointer ${
              externalIsQueueOpen
                ? 'bg-white/15 text-[var(--color-accent)] border border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]'
                : 'text-[var(--color-on-surface-variant)] hover:text-white hover:bg-white/10'
            }`}
            title="Toggle Play Queue"
            aria-label="Toggle Play Queue (Q)"
          >
            <ListOrdered size={15} />
          </button>

          {/* Fullscreen Now Playing Toggle */}
          <button
            onClick={() => setNowPlayingModalOpen(true)}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-on-surface-variant)] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title="Fullscreen Now Playing (F)"
          >
            <Maximize2 size={14} />
          </button>
        </div>
      </div>
    </footer>
  );
});

BottomPlayerBar.displayName = 'BottomPlayerBar';
