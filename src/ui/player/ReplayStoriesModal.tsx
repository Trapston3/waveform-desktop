// src/ui/player/ReplayStoriesModal.tsx
// 9:16 interactive vertical story presentation for Year-in-Review / Monthly Replay (Feature 23)
// 7000ms auto-advance progress timer, hold-to-pause, 8 narrative slides, stardust particles

import React, { useState, useEffect, useRef } from 'react';
import { X, Sparkles, Trophy, Music, RotateCcw } from 'lucide-react';
import type { MonthlyHistory } from '../../models/Playlist';
import { useLibraryStore } from '../../state/libraryStore';

export interface ReplayStoriesModalProps {
  isOpen: boolean;
  onClose: () => void;
  monthlyStats?: MonthlyHistory | null;
}

const SLIDE_DURATION_MS = 7000;

export const ReplayStoriesModal: React.FC<ReplayStoriesModalProps> = ({
  isOpen,
  onClose,
  monthlyStats,
}) => {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0); // 0 to 1

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const elapsedBeforePauseRef = useRef<number>(0);

  const totalSlides = 8;

  // Stardust canvas particle animation
  useEffect(() => {
    if (!isOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const particles = Array.from({ length: 35 }, () => ({
      x: Math.random() * 400,
      y: Math.random() * 700,
      radius: 1 + Math.random() * 2.5,
      vx: (Math.random() - 0.5) * 0.4,
      vy: -0.3 - Math.random() * 0.5,
      alpha: 0.2 + Math.random() * 0.6,
    }));

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.y < 0) p.y = canvas.height;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;

        ctx.fillStyle = `rgba(255, 255, 255, ${p.alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [isOpen]);

  // Slide progress countdown loop
  useEffect(() => {
    if (!isOpen || isPaused) return;

    startTimeRef.current = Date.now() - elapsedBeforePauseRef.current;

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const frac = Math.min(1.0, elapsed / SLIDE_DURATION_MS);
      setProgress(frac);

      if (frac >= 1.0) {
        elapsedBeforePauseRef.current = 0;
        setProgress(0);
        setCurrentSlide((prev) => {
          if (prev >= totalSlides - 1) {
            onClose();
            return 0;
          }
          return prev + 1;
        });
      }
    }, 30);

    return () => clearInterval(interval);
  }, [isOpen, isPaused, currentSlide, totalSlides, onClose]);

  if (!isOpen) return null;

  const handleHoldStart = () => {
    setIsPaused(true);
    elapsedBeforePauseRef.current = progress * SLIDE_DURATION_MS;
  };

  const handleHoldEnd = () => {
    setIsPaused(false);
  };

  const handleTap = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const isLeft = clickX < rect.width * 0.35;

    elapsedBeforePauseRef.current = 0;
    setProgress(0);

    if (isLeft) {
      setCurrentSlide((prev) => Math.max(0, prev - 1));
    } else {
      setCurrentSlide((prev) => {
        if (prev >= totalSlides - 1) {
          onClose();
          return 0;
        }
        return prev + 1;
      });
    }
  };

  const storeMonthlyStats = useLibraryStore((s) => s.monthlyStats);
  const resetListeningData = useLibraryStore((s) => s.resetListeningData);
  const [resetNotice, setResetNotice] = useState(false);

  const effectiveStats = monthlyStats !== undefined ? monthlyStats : storeMonthlyStats;
  const hasStats = Boolean(effectiveStats && effectiveStats.totalPlaysCount > 0);
  const topTrack = effectiveStats?.topTracks?.[0] ?? null;
  const topArtist = effectiveStats?.topArtists?.[0] ?? null;
  const totalMinutes = Math.round((effectiveStats?.totalListeningTimeSec || 0) / 60);
  const totalPlays = effectiveStats?.totalPlaysCount || 0;
  const uniqueTracks = effectiveStats?.uniqueTracksCount || 0;
  const uniqueArtists = effectiveStats?.uniqueArtistsCount || 0;

  const handleResetReplay = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await resetListeningData();
    elapsedBeforePauseRef.current = 0;
    setProgress(0);
    setCurrentSlide(0);
    setResetNotice(true);
    setTimeout(() => setResetNotice(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xl select-none animate-in fade-in duration-200">
      {/* 9:16 Aspect Ratio Frame */}
      <div
        onMouseDown={handleHoldStart}
        onMouseUp={handleHoldEnd}
        onClick={handleTap}
        className="relative w-[405px] h-[720px] rounded-3xl overflow-hidden shadow-2xl border border-white/10 flex flex-col justify-between p-6 bg-gradient-to-b from-neutral-900 via-neutral-950 to-black text-white cursor-pointer"
      >
        {/* Background Canvas Particles */}
        <canvas
          ref={canvasRef}
          width={405}
          height={720}
          className="absolute inset-0 w-full h-full pointer-events-none z-0"
        />

        {/* Ambient Gradient Glow */}
        <div className="absolute -top-24 -left-24 w-72 h-72 rounded-full bg-red-600/25 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-72 h-72 rounded-full bg-purple-600/20 blur-3xl pointer-events-none" />

        {/* Top Header: Progress Segments & Close Button */}
        <div className="relative z-10 space-y-3">
          <div className="flex items-center gap-1.5 w-full">
            {Array.from({ length: totalSlides }).map((_, idx) => {
              let segProgress = 0;
              if (idx < currentSlide) segProgress = 1;
              else if (idx === currentSlide) segProgress = progress;

              return (
                <div key={idx} className="flex-1 h-1 rounded-full bg-white/20 overflow-hidden">
                  <div
                    style={{ width: `${segProgress * 100}%` }}
                    className="h-full bg-white rounded-full transition-all duration-75"
                  />
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="flex items-center gap-1.5 text-xs font-bold tracking-wider uppercase text-[var(--color-accent)]">
              <Sparkles size={14} /> WaveForm Replay
            </span>
            <div className="flex items-center gap-2">
              {resetNotice && (
                <span className="text-[10px] font-semibold text-green-400">Cleared</span>
              )}
              <button
                onClick={handleResetReplay}
                title="Reset Replay & Listening Data"
                className="flex items-center gap-1 px-2 py-1 rounded-full bg-white/10 hover:bg-red-500/30 text-white text-[11px] font-medium transition-colors cursor-pointer"
              >
                <RotateCcw size={12} />
                <span>Reset Data</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                }}
                className="p-1 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* Main Slide Presentation Content */}
        <div className="relative z-10 flex-1 flex flex-col justify-center items-center text-center px-4 py-8">
          {currentSlide === 0 && (
            <div className="space-y-6 animate-in zoom-in-95 duration-300">
              <div className="w-24 h-24 rounded-3xl bg-gradient-to-tr from-red-600 to-purple-600 flex items-center justify-center shadow-2xl mx-auto">
                <Music size={44} className="text-white" />
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight">Your Replay is ready</h1>
              <p className="text-sm text-neutral-400 max-w-xs">
                Take a look back at the music, artists, and anthems that defined your soundtrack.
              </p>
            </div>
          )}

          {currentSlide === 1 && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <span className="text-xs font-bold tracking-wider text-neutral-400 uppercase">
                Listening Time
              </span>
              <div className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-purple-400">
                {totalMinutes.toLocaleString()}
              </div>
              <p className="text-lg font-bold">Minutes Listened</p>
              <p className="text-xs text-neutral-400">
                {hasStats
                  ? `${totalPlays.toLocaleString()} total plays recorded this month.`
                  : 'No listening history recorded yet. Play tracks to build your Replay.'}
              </p>
            </div>
          )}

          {currentSlide === 2 && (
            <div className="space-y-5 animate-in fade-in duration-300">
              <span className="text-xs font-bold tracking-wider text-[var(--color-accent)] uppercase">
                Top Track
              </span>
              {topTrack ? (
                <>
                  <div className="w-24 h-24 rounded-2xl bg-white/10 flex items-center justify-center mx-auto border border-white/20">
                    <Music size={36} className="text-white/80" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold truncate max-w-xs">{topTrack.title}</h3>
                    <p className="text-sm text-neutral-400">{topTrack.artist}</p>
                  </div>
                  <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-white/10">
                    Played {topTrack.playCount} {topTrack.playCount === 1 ? 'time' : 'times'}
                  </span>
                </>
              ) : (
                <p className="text-sm text-neutral-400 max-w-xs">
                  No top track yet — start listening to populate your Replay.
                </p>
              )}
            </div>
          )}

          {currentSlide === 3 && (
            <div className="space-y-5 animate-in fade-in duration-300">
              <span className="text-xs font-bold tracking-wider text-yellow-400 uppercase flex items-center justify-center gap-1">
                <Trophy size={14} /> #1 Top Artist
              </span>
              {topArtist ? (
                <>
                  <div className="w-24 h-24 rounded-full bg-yellow-400/15 flex items-center justify-center mx-auto border-2 border-yellow-400/40">
                    <Trophy size={36} className="text-yellow-400" />
                  </div>
                  <h2 className="text-3xl font-extrabold">{topArtist.artistName}</h2>
                  <p className="text-xs text-neutral-400">
                    {topArtist.playCount} total {topArtist.playCount === 1 ? 'play' : 'plays'} in your collection
                  </p>
                </>
              ) : (
                <p className="text-sm text-neutral-400 max-w-xs">
                  No top artist yet — listen to music to see your #1 artist.
                </p>
              )}
            </div>
          )}

          {currentSlide === 4 && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <span className="text-xs font-bold tracking-wider text-cyan-400 uppercase">
                Tracks Explored
              </span>
              <div className="text-5xl font-black text-white">{uniqueTracks}</div>
              <h3 className="text-lg font-bold">Unique Tracks</h3>
              <p className="text-xs text-neutral-400">
                Across {uniqueArtists} {uniqueArtists === 1 ? 'artist' : 'artists'} this month
              </p>
            </div>
          )}

          {currentSlide === 5 && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <span className="text-xs font-bold tracking-wider text-pink-400 uppercase">
                Top Tracks Breakdown
              </span>
              {effectiveStats && effectiveStats.topTracks.length > 0 ? (
                <div className="space-y-2 max-w-xs w-full text-left">
                  {effectiveStats.topTracks.slice(0, 3).map((t, i) => (
                    <div
                      key={t.videoId}
                      className="p-3 rounded-xl bg-white/10 flex items-center justify-between text-xs font-bold gap-2"
                    >
                      <span className="truncate">{i + 1}. {t.title}</span>
                      <span className="text-[var(--color-accent)] shrink-0">{t.playCount}x</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-neutral-400 max-w-xs">
                  No tracks played yet.
                </p>
              )}
            </div>
          )}

          {currentSlide === 6 && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <span className="text-xs font-bold tracking-wider text-orange-400 uppercase">
                Top Artists Breakdown
              </span>
              {effectiveStats && effectiveStats.topArtists.length > 0 ? (
                <div className="space-y-2 max-w-xs w-full text-left">
                  {effectiveStats.topArtists.slice(0, 3).map((a, i) => (
                    <div
                      key={a.artistName}
                      className="p-3 rounded-xl bg-white/10 flex items-center justify-between text-xs font-bold gap-2"
                    >
                      <span className="truncate">{i + 1}. {a.artistName}</span>
                      <span className="text-orange-400 shrink-0">{a.playCount}x</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-neutral-400 max-w-xs">
                  No artists played yet.
                </p>
              )}
            </div>
          )}

          {currentSlide === 7 && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <span className="text-xs font-bold tracking-wider text-green-400 uppercase">
                Summary
              </span>
              <div className="p-4 rounded-2xl bg-white/10 border border-white/20 space-y-2 text-left">
                <div className="text-sm font-bold text-white">WaveForm Replay Snapshot</div>
                <div className="text-xs text-neutral-300">
                  {totalMinutes.toLocaleString()} Minutes • {topArtist?.artistName || 'No Artist'} • {topTrack?.title || 'No Track'}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                }}
                className="px-6 py-2.5 rounded-full bg-[var(--color-accent)] hover:brightness-110 text-white font-bold text-xs shadow-xl shadow-red-500/30"
              >
                Close Replay
              </button>
            </div>
          )}
        </div>

        {/* Bottom Helper Notice */}
        <div className="relative z-10 flex items-center justify-between text-[11px] text-neutral-500 px-2">
          <span>Tap sides to navigate</span>
          <span>Hold to pause</span>
        </div>
      </div>
    </div>
  );
};
