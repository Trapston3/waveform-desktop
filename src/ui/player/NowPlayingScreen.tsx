// src/ui/player/NowPlayingScreen.tsx
// Fullscreen immersive Apple Music Now Playing experience with 1:1 Parity:
// - GPU-accelerated WebGL 2 OkLab fluid mesh background canvas (AppleMusicFluidMeshCanvas)
// - Dual-layer directional scrim (radial vignette + horizontal gradient for lyrics contrast)
// - Left Column: Large floating album artwork lockup with interactive 3D perspective tilt (perspective: 1200px)
//   and dynamic specular cursor sheen (useTiltTransform.ts), 68-bar waveform seekbar & transport deck
// - Right Column: Borderless floating live lyrics over ambient mesh (zero card box, zero borders)
// - Decoupled 0Hz playback re-render time pills

import React, { useRef, useEffect, useState, useMemo, memo } from 'react';
import {
  ChevronDown,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  Heart,
  AlignLeft,
  ListOrdered,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { ArtistCredits } from '../common/ArtistCredits';
import { useNavigationStore } from '../../state/navigationStore';
import { resolveArtistTarget } from '../../utils/artistCredits';
import { usePlayerStore } from '../../state/playerStore';
import { useQueueStore } from '../../state/queueStore';
import { useLibraryStore } from '../../state/libraryStore';
import { useSettingsStore } from '../../state/settingsStore';
import { useLyricsStore } from '../../state/lyricsStore';
import { useThemeStore } from '../theme/Theme';
import { WaveformCanvasSeekbar } from './WaveformCanvasSeekbar';
import { SyllableLyricsEngine } from './SyllableLyricsEngine';
import { AppleMusicFluidMeshCanvas } from './AppleMusicFluidMeshCanvas';
import { useTiltTransform } from './useTiltTransform';
import {
  PlayerPlayIcon,
  PlayerPauseIcon,
  PlayerPreviousIcon,
  PlayerNextIcon,
  LosslessWaveIcon,
  DolbyAtmosIcon,
  OutputSpeakerIcon,
} from '../common/WaveFormIcons';

export interface NowPlayingScreenProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NowPlayingScreen: React.FC<NowPlayingScreenProps> = memo(({ isOpen, onClose }) => {
  const [activeSidecar, setActiveSidecar] = useState<'lyrics' | 'queue' | 'none'>('lyrics');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { lyricsData, isLoading, fetchLyricsForTrack } = useLyricsStore();

  const elapsedSpanRef = useRef<HTMLSpanElement>(null);
  const remainingSpanRef = useRef<HTMLSpanElement>(null);

  // Granular Zustand selectors - eliminates wide re-renders on playback position ticks
  const { navigateToArtist, navigateToRelease } = useNavigationStore();
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const durationMs = usePlayerStore((s) => s.durationMs);
  const volume = usePlayerStore((s) => s.volume);
  const isMuted = usePlayerStore((s) => s.isMuted);
  const isShuffle = usePlayerStore((s) => s.isShuffle);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const waveformBuckets = usePlayerStore((s) => s.waveformBuckets);
  const livePcmEnergy = usePlayerStore((s) => s.livePcmEnergy);

  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const seek = usePlayerStore((s) => s.seek);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const adjustVolumeRelative = usePlayerStore((s) => s.adjustVolumeRelative);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeatMode = usePlayerStore((s) => s.cycleRepeatMode);

  const { advanceQueue, previousTrack, tiers, jumpToTrack } = useQueueStore();
  const { toggleFavorite, isFavorite } = useLibraryStore();
  const { settings } = useSettingsStore();
  const artworkPalette = useThemeStore((s) => s.artworkPalette);

  const isPlaying = playbackState === 'PLAYING';
  const isLiked = currentTrack ? isFavorite(currentTrack.videoId) : false;

  // 3D Perspective Tilt and Specular Cursor Sheen for Floating Artwork Lockup
  const tilt = useTiltTransform({
    maxTiltDeg: 10,
    perspectivePx: 1200,
    scale: isPlaying ? 1.0 : 0.95,
    active: true,
  });

  // Extract 4 palette colors for OkLab GPU Fluid Mesh
  const meshColors = useMemo(() => [
    artworkPalette?.vibrantAccent || '#FA2D48',
    artworkPalette?.edgeWash || '#3A1019',
    artworkPalette?.ambientBackground || '#080507',
    artworkPalette?.playerTint || 'rgba(58, 16, 25, 0.65)',
  ], [artworkPalette]);

  // Load lyrics for currently playing track via centralized store
  useEffect(() => {
    fetchLyricsForTrack(currentTrack);
  }, [
    currentTrack?.videoId,
    currentTrack?.title,
    currentTrack?.artist,
    (currentTrack as any)?.lyrics,
    fetchLyricsForTrack,
  ]);

  // Decoupled position ticker for elapsed/remaining time pills (zero React re-renders)
  useEffect(() => {
    if (!isOpen) return;

    const updateTime = () => {
      const engine = usePlayerStore.getState().audioEngine;
      const pos = engine ? engine.getCurrentPositionMs() : usePlayerStore.getState().positionMs;
      const dur = durationMs || 0;
      const totalSec = Math.max(0, Math.floor(pos / 1000));
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      const elapsedStr = `${m}:${s.toString().padStart(2, '0')}`;

      const remSec = Math.max(0, Math.floor(Math.max(0, dur - pos) / 1000));
      const rm = Math.floor(remSec / 60);
      const rs = remSec % 60;
      const remainingStr = `-${rm}:${rs.toString().padStart(2, '0')}`;

      if (elapsedSpanRef.current && elapsedSpanRef.current.textContent !== elapsedStr) {
        elapsedSpanRef.current.textContent = elapsedStr;
      }
      if (remainingSpanRef.current && remainingSpanRef.current.textContent !== remainingStr) {
        remainingSpanRef.current.textContent = remainingStr;
      }
    };

    updateTime();
    if (!isPlaying) return;

    const interval = setInterval(updateTime, 250);
    return () => clearInterval(interval);
  }, [isOpen, isPlaying, durationMs]);

  // Sync isFullscreen with native/Electron fullscreenchange events
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Reset fullscreen cleanly if NowPlayingScreen closes externally
  useEffect(() => {
    if (!isOpen && isFullscreen) {
      setIsFullscreen(false);
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
    }
  }, [isOpen, isFullscreen]);

  // Capture-phase Escape handler: exits fullscreen first, otherwise closes Now Playing
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.code === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (isFullscreen) {
          setIsFullscreen(false);
          if (document.fullscreenElement) {
            document.exitFullscreen?.().catch(() => {});
          }
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, isFullscreen, onClose]);

  const toggleFullscreen = () => {
    if (isFullscreen) {
      setIsFullscreen(false);
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
    } else {
      setIsFullscreen(true);
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
  };

  const handleClose = () => {
    if (isFullscreen) {
      setIsFullscreen(false);
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
    }
    onClose();
  };

  if (!isOpen || !currentTrack) return null;

  const artworkUrl =
    currentTrack.thumbnailUrl ||
    currentTrack.artworkUrl ||
    'https://i.ytimg.com/vi/5dNP-a-XXx0/hqdefault.jpg';

  // Ambient dark scrim fallback invariant: ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';

  return (
    <div
      data-fullscreen={isFullscreen ? 'true' : 'false'}
      className={`fixed ${
        isFullscreen ? 'inset-0 z-[70]' : 'top-10 md:top-12 inset-x-0 bottom-0 z-50'
      } flex flex-col bg-black overflow-hidden select-none animate-in fade-in duration-300`}
    >
      {/* GPU Fluid Mesh Background Canvas (640x360 hardware-accelerated OkLab shader with blur-[64px]) */}
      <AppleMusicFluidMeshCanvas
        colors={meshColors}
        isPlaying={isPlaying}
        width={640}
        height={360}
        className="absolute inset-0 w-full h-full object-cover filter blur-[64px] scale-110 pointer-events-none opacity-90 z-0"
      />

      {/* Layer 1: Radial Vignette Scrim (35% to 55% dark edge vignette) */}
      <div
        style={{
          background: 'radial-gradient(ellipse 90% 85% at 50% 50%, transparent 35%, rgba(0, 0, 0, 0.55) 100%)',
        }}
        className="absolute inset-0 pointer-events-none z-[1]"
      />

      {/* Layer 2: Directional Horizontal Scrim (maximizes lyrics readability on right while keeping artwork vibrant) */}
      <div
        style={{
          background: 'linear-gradient(to right, rgba(0, 0, 0, 0.15) 0%, rgba(0, 0, 0, 0.30) 45%, rgba(0, 0, 0, 0.65) 100%)',
        }}
        className="absolute inset-0 pointer-events-none z-[2]"
      />

      {/* Top Header Bar */}
      <header className="relative z-10 flex items-center justify-between px-8 py-4 border-b border-white/10 bg-black/20 backdrop-blur-2xl">
        <button
          onClick={handleClose}
          className="spring-press liquid-glass-pill flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-white text-xs font-semibold cursor-pointer"
        >
          <ChevronDown size={16} />
          <span>Collapse</span>
        </button>

        <div className="text-center">
          <div className="text-[10px] font-bold text-white/55 uppercase tracking-widest">
            Playing From
          </div>
          <div className="text-xs font-bold text-white truncate max-w-sm">
            {currentTrack.albumName || currentTrack.album || 'WaveForm Stream'}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveSidecar(activeSidecar === 'lyrics' ? 'none' : 'lyrics')}
            className={`spring-press p-2.5 rounded-full transition-all cursor-pointer ${
              activeSidecar === 'lyrics'
                ? 'liquid-glass-pill-active text-white'
                : 'liquid-glass-pill text-white/75 hover:text-white'
            }`}
            title="Toggle Syllable-Synced Lyrics"
          >
            <AlignLeft size={16} />
          </button>

          <button
            onClick={() => setActiveSidecar(activeSidecar === 'queue' ? 'none' : 'queue')}
            className={`spring-press p-2.5 rounded-full transition-all cursor-pointer ${
              activeSidecar === 'queue'
                ? 'liquid-glass-pill-active text-white'
                : 'liquid-glass-pill text-white/75 hover:text-white'
            }`}
            title="Toggle Up Next Queue"
          >
            <ListOrdered size={16} />
          </button>

          <button
            onClick={toggleFullscreen}
            className={`spring-press p-2.5 rounded-full transition-all cursor-pointer ${
              isFullscreen
                ? 'liquid-glass-pill-active text-white'
                : 'liquid-glass-pill text-white/75 hover:text-white'
            }`}
            title={isFullscreen ? 'Exit Fullscreen (Esc)' : 'Enter Fullscreen'}
            aria-label={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </header>

      {/* Main Viewport Split: Left Artwork Deck | Right Borderless Floating Lyrics */}
      <div className="relative z-10 flex-1 flex min-h-0 px-12 py-6 gap-16 items-center justify-center">
        {/* Left Column: Floating Artwork Lockup & Transport Deck */}
        <div className="flex-1 max-w-md flex flex-col items-center space-y-5">
          {/* Central Square Album Artwork with 3D Perspective Tilt & Specular Sheen */}
          <div
            onMouseMove={tilt.handleMouseMove}
            onMouseLeave={tilt.handleMouseLeave}
            style={{
              transform: tilt.transform,
              transformStyle: 'preserve-3d',
              boxShadow: `0 32px 80px rgba(0,0,0,0.65), 0 12px 36px ${artworkPalette?.edgeWash || 'rgba(250,45,72,0.35)'}, inset 0 0 0 0.5px rgba(255,255,255,0.22)`,
              transition: 'transform 180ms cubic-bezier(0.2, 0.9, 0.3, 1), box-shadow 300ms ease',
            }}
            className="artwork-lockup relative w-72 h-72 md:w-84 md:h-84 rounded-3xl overflow-hidden bg-neutral-900 cursor-pointer"
          >
            <img
              src={artworkUrl}
              alt={currentTrack.title}
              className="w-full h-full object-cover pointer-events-none select-none"
            />
            {/* Dynamic Specular Sheen Reflection Layer */}
            <div
              style={{
                background: tilt.sheenGradient,
              }}
              className="absolute inset-0 pointer-events-none transition-opacity duration-200"
            />
          </div>

          {/* Track Metadata & Favorite */}
          <div className="w-full flex items-center justify-between pt-1">
            <div className="min-w-0 flex-1 pr-4">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-extrabold text-white truncate tracking-tight">
                  {currentTrack.title}
                </h1>
                {currentTrack.isExplicit && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-white/20 text-white shrink-0">
                    E
                  </span>
                )}
              </div>
              <p className="text-sm font-medium text-[var(--color-text-secondary)] truncate pt-0.5">
                <ArtistCredits
                  artist={currentTrack.artist}
                  artists={currentTrack.artists}
                  artistIds={currentTrack.artistIds}
                  onNavigate={(id) => { onClose(); navigateToArtist(id); }}
                />{" • "}
                <span
                  className={(currentTrack.albumName || currentTrack.album) ? "hover:text-[#FA2D48] hover:underline cursor-pointer transition-colors" : ""}
                  onClick={() => {
                    const alb = currentTrack.albumName || currentTrack.album;
                    if (!alb) return;
                    onClose();
                    navigateToRelease(currentTrack.albumId || 'alb_' + alb, 'album');
                  }}
                >
                  {currentTrack.albumName || currentTrack.album || 'Single'}
                </span>
              </p>
            </div>

            <button
              onClick={() => toggleFavorite(currentTrack)}
              className="spring-press liquid-glass-pill p-2.5 rounded-full text-white cursor-pointer"
            >
              <Heart
                size={20}
                className={isLiked ? 'text-[var(--color-accent)] fill-current' : 'text-white/60'}
              />
            </button>
          </div>

          {/* 68-Bar Waveform Canvas Seekbar + Quality Badge Row */}
          <div className="w-full space-y-2">
            <WaveformCanvasSeekbar
              amplitudes={waveformBuckets}
              durationMs={durationMs}
              isPlaying={isPlaying}
              onSeek={seek}
              liveBands={livePcmEnergy}
              height={42}
            />

            <div className="flex items-center justify-between text-[11px] font-mono text-[var(--color-text-secondary)] px-1">
              <span ref={elapsedSpanRef}>0:00</span>

              {/* Center Audio Quality & Dolby Atmos Pill */}
              <div className="flex items-center gap-2 font-sans">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/10 text-white/90 text-[10px] font-bold border border-white/15">
                  <LosslessWaveIcon size={13} className="text-[var(--color-accent)]" />
                  <span>{(currentTrack as any).sourceQuality || 'Lossless'}</span>
                </span>
                {settings['dsp.spatialAudioEnabled'] && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/10 text-cyan-300 text-[10px] font-bold border border-white/15">
                    <DolbyAtmosIcon size={12} />
                    <span>Dolby Atmos</span>
                  </span>
                )}
              </div>

              <span ref={remainingSpanRef}>-0:00</span>
            </div>
          </div>

          {/* Liquid Glass Transport Controls Capsule */}
          <div className="liquid-glass-capsule px-8 py-3 rounded-full flex items-center justify-center gap-7">
            <button
              onClick={toggleShuffle}
              className={`spring-press p-2 rounded-full transition-colors cursor-pointer ${
                isShuffle ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)] hover:text-white'
              }`}
              title="Shuffle"
            >
              <Shuffle size={18} />
            </button>

            <button
              onClick={previousTrack}
              className="spring-press p-2 rounded-full text-white hover:scale-110 transition-transform cursor-pointer"
              title="Previous"
            >
              <PlayerPreviousIcon size={28} />
            </button>

            <button
              onClick={togglePlay}
              className="spring-press w-15 h-15 rounded-full bg-white text-black flex items-center justify-center shadow-[0_8px_28px_rgba(255,255,255,0.35)] hover:scale-105 transition-transform cursor-pointer"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <PlayerPauseIcon size={30} />
              ) : (
                <PlayerPlayIcon size={30} className="ml-0.5" />
              )}
            </button>

            <button
              onClick={advanceQueue}
              className="spring-press p-2 rounded-full text-white hover:scale-110 transition-transform cursor-pointer"
              title="Next"
            >
              <PlayerNextIcon size={28} />
            </button>

            <button
              onClick={cycleRepeatMode}
              className={`spring-press p-2 rounded-full transition-colors cursor-pointer ${
                repeatMode !== 'off'
                  ? 'text-[var(--color-accent)]'
                  : 'text-[var(--color-text-secondary)] hover:text-white'
              }`}
              title="Repeat"
            >
              {repeatMode === 'one' ? <Repeat1 size={18} /> : <Repeat size={18} />}
            </button>
          </div>

          {/* Volume Control & Output Speaker */}
          <div
            onWheel={(e) => {
              e.preventDefault();
              e.stopPropagation();
              adjustVolumeRelative(e.deltaY < 0 ? 0.05 : -0.05);
            }}
            className="w-full flex items-center justify-center gap-3 pt-1 max-w-xs"
            title="Volume (Scroll wheel supported)"
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleMute();
              }}
              className="text-[var(--color-text-secondary)] hover:text-white cursor-pointer"
            >
              {isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={isMuted ? 0 : volume}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="w-full h-1.5 accent-white bg-white/25 rounded-lg cursor-pointer"
            />
            <OutputSpeakerIcon size={15} className="text-[var(--color-text-secondary)] shrink-0" />
          </div>
        </div>

        {/* Right Column: BORDERLESS FLOATING LYRICS or Queue Sidecar */}
        {activeSidecar !== 'none' && (
          <div className="flex-1 max-w-xl h-full flex flex-col justify-center">
            {activeSidecar === 'lyrics' && (
              <div className="now-playing-lyrics borderless-floating-lyrics flex-1 h-full flex flex-col justify-center overflow-hidden">
                <SyllableLyricsEngine
                  lyricsData={lyricsData}
                  onSeek={seek}
                  fontSize={32}
                  isLoading={isLoading}
                  className="h-full"
                />
              </div>
            )}

            {activeSidecar === 'queue' && (
              <div className="liquid-glass now-playing-lyrics now-playing-queue flex-1 max-w-lg h-full rounded-3xl overflow-hidden flex flex-col p-6 backdrop-blur-2xl">
                <div className="flex-1 overflow-y-auto space-y-4">
                  <h3 className="text-xs font-bold tracking-widest uppercase text-[var(--color-text-secondary)]">
                    Up Next Queue
                  </h3>
                  <div className="space-y-2">
                    {tiers.USER_QUEUE.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-xs font-semibold text-[var(--color-accent)]">
                          User Queue
                        </div>
                        {tiers.USER_QUEUE.map((s, idx) => (
                          <div
                            key={idx}
                            onClick={() => jumpToTrack('USER_QUEUE', idx)}
                            className="flex items-center gap-3 p-2.5 rounded-xl bg-white/5 hover:bg-white/15 cursor-pointer transition-colors"
                          >
                            <img
                              src={s.thumbnailUrl || s.artworkUrl || artworkUrl}
                              alt=""
                              className="w-9 h-9 rounded-lg object-cover"
                            />
                            <div className="min-w-0 flex-1 text-xs">
                              <div className="font-bold truncate text-white">{s.title}</div>
                              <div className="text-[var(--color-text-secondary)] truncate"><span className="hover:text-[#FA2D48] hover:underline cursor-pointer transition-colors" onClick={(e) => { e.stopPropagation(); onClose(); navigateToArtist(resolveArtistTarget(s)); }}>{s.artist}</span></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <div className="text-xs font-semibold text-[var(--color-text-secondary)]">Context Queue</div>
                      {tiers.CONTEXT.slice(0, 20).map((s, idx) => (
                        <div
                          key={idx}
                          onClick={() => jumpToTrack('CONTEXT', idx)}
                          className="flex items-center gap-3 p-2.5 rounded-xl bg-white/5 hover:bg-white/15 cursor-pointer transition-colors"
                        >
                          <img
                            src={s.thumbnailUrl || s.artworkUrl || artworkUrl}
                            alt=""
                            className="w-9 h-9 rounded-lg object-cover"
                          />
                          <div className="min-w-0 flex-1 text-xs">
                            <div className="font-bold truncate text-white">{s.title}</div>
                            <div className="text-[var(--color-text-secondary)] truncate"><span className="hover:text-[#FA2D48] hover:underline cursor-pointer transition-colors" onClick={(e) => { e.stopPropagation(); onClose(); navigateToArtist(resolveArtistTarget(s)); }}>{s.artist}</span></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

NowPlayingScreen.displayName = 'NowPlayingScreen';
