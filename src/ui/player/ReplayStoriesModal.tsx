// src/ui/player/ReplayStoriesModal.tsx
// 9:16 interactive vertical story presentation for 2026 Replay (Feature 23)
// 5 interactive Apple-Music-style slides: Overview, Top Song + 15s Preview, Top 5 Artists,
// Top Albums & Audio Quality Breakdown, and Shareable PNG Summary Card

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  X,
  Sparkles,
  Trophy,
  Music,
  RotateCcw,
  Play,
  Square,
  Download,
  Clock,
  Flame,
  Disc3,
  Check,
  ChevronLeft,
  ChevronRight,
  Pause,
} from 'lucide-react';
import type { MonthlyHistory } from '../../models/Playlist';
import type { Song } from '../../models/Song';
import { useLibraryStore, type YearlyReplayStats } from '../../state/libraryStore';
import { usePlayerStore } from '../../state/playerStore';
import { MusicService } from '../../services/MusicService';

export interface ReplayStoriesModalProps {
  isOpen: boolean;
  onClose: () => void;
  yearlyStats?: YearlyReplayStats | null;
  monthlyStats?: MonthlyHistory | null;
}

const SLIDE_DURATION_MS = 7000;
const PREVIEW_DURATION_MS = 15000;
const TOTAL_SLIDES = 5;

function isValidArtworkUrl(url: unknown): url is string {
  return (
    typeof url === 'string' &&
    url.trim().length > 0 &&
    url !== 'null' &&
    url !== 'undefined'
  );
}

function isLikelyYouTubeId(id?: string | null): boolean {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id);
}

function formatPeakHour(hour: number | null): string {
  if (hour === null || !Number.isFinite(hour) || hour < 0 || hour > 23) {
    return '—';
  }
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

function monthlyToYearlyStats(monthly: MonthlyHistory): YearlyReplayStats {
  const safePlays = Math.max(0, Number(monthly.totalPlaysCount) || 0);
  const divisor = Math.max(1, safePlays);
  const topTracks = (Array.isArray(monthly.topTracks) ? monthly.topTracks : []).map((t) => ({
    videoId: t.videoId,
    title: t.title || 'Unknown Track',
    artist: t.artist || 'Unknown Artist',
    playCount: Math.max(0, Number(t.playCount) || 0),
    totalSec: Math.max(0, Number(t.durationSec) || 0),
  }));
  const topArtists = (Array.isArray(monthly.topArtists) ? monthly.topArtists : [])
    .slice(0, 5)
    .map((a) => {
      const count = Math.max(0, Number(a.playCount) || 0);
      return {
        artistName: a.artistName || 'Unknown Artist',
        playCount: count,
        totalSec: Math.max(0, Number(a.durationSec) || 0),
        percentage: Math.min(100, Math.round((count / divisor) * 100)),
      };
    });

  return {
    year: 2026,
    totalListeningTimeSec: Math.max(0, Number(monthly.totalListeningTimeSec) || 0),
    totalPlaysCount: safePlays,
    uniqueTracksCount: Math.max(0, Number(monthly.uniqueTracksCount) || topTracks.length),
    uniqueArtistsCount: Math.max(0, Number(monthly.uniqueArtistsCount) || topArtists.length),
    peakHour: null,
    longestStreakDays: Object.values(monthly.dailyPlays || {}).filter((n) => n > 0).length,
    topTracks,
    topArtists,
    topAlbums: [],
    qualityBreakdown: {
      lossless: 0,
      opus: 0,
      other: safePlays,
    },
  };
}

function normalizeReplayStats(raw?: YearlyReplayStats | null): YearlyReplayStats {
  const safePlays = Math.max(0, Number(raw?.totalPlaysCount) || 0);
  const divisor = Math.max(1, safePlays);
  const topTracks = Array.isArray(raw?.topTracks)
    ? raw!.topTracks.filter(Boolean).map((t) => ({
        videoId: t.videoId || '',
        title: t.title || 'Unknown Track',
        artist: t.artist || 'Unknown Artist',
        albumName: t.albumName || undefined,
        artworkUrl: t.artworkUrl || undefined,
        playCount: Math.max(0, Number(t.playCount) || 0),
        totalSec: Math.max(0, Number(t.totalSec) || 0),
      }))
    : [];
  const topArtists = Array.isArray(raw?.topArtists)
    ? raw!.topArtists.filter(Boolean).slice(0, 5).map((a) => {
        const count = Math.max(0, Number(a.playCount) || 0);
        return {
          artistName: a.artistName || 'Unknown Artist',
          playCount: count,
          totalSec: Math.max(0, Number(a.totalSec) || 0),
          percentage:
            typeof a.percentage === 'number' && Number.isFinite(a.percentage)
              ? Math.max(0, Math.min(100, Math.round(a.percentage)))
              : Math.min(100, Math.round((count / divisor) * 100)),
          artworkUrl: a.artworkUrl || undefined,
        };
      })
    : [];
  const topAlbums = Array.isArray(raw?.topAlbums)
    ? raw!.topAlbums.filter(Boolean).slice(0, 4).map((al) => ({
        albumName: al.albumName || 'Single',
        artist: al.artist || 'Unknown Artist',
        artworkUrl: al.artworkUrl || undefined,
        playCount: Math.max(0, Number(al.playCount) || 0),
        totalSec: Math.max(0, Number(al.totalSec) || 0),
      }))
    : [];

  return {
    year: typeof raw?.year === 'number' && Number.isFinite(raw.year) ? raw.year : 2026,
    totalListeningTimeSec: Math.max(0, Number(raw?.totalListeningTimeSec) || 0),
    totalPlaysCount: safePlays,
    uniqueTracksCount: Math.max(0, Number(raw?.uniqueTracksCount) || 0),
    uniqueArtistsCount: Math.max(0, Number(raw?.uniqueArtistsCount) || 0),
    peakHour:
      typeof raw?.peakHour === 'number' &&
      Number.isFinite(raw.peakHour) &&
      raw.peakHour >= 0 &&
      raw.peakHour <= 23
        ? raw.peakHour
        : null,
    longestStreakDays: Math.max(0, Number(raw?.longestStreakDays) || 0),
    topTracks,
    topArtists,
    topAlbums,
    qualityBreakdown: {
      lossless: Math.max(0, Number(raw?.qualityBreakdown?.lossless) || 0),
      opus: Math.max(0, Number(raw?.qualityBreakdown?.opus) || 0),
      other: Math.max(0, Number(raw?.qualityBreakdown?.other) || 0),
    },
  };
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export const ReplayStoriesModal: React.FC<ReplayStoriesModalProps> = ({
  isOpen,
  onClose,
  yearlyStats,
  monthlyStats,
}) => {
  // ALL React hooks MUST live unconditionally above any early return!
  const storeYearlyStats = useLibraryStore((s) => s.yearlyReplayStats);
  const storeMonthlyStats = useLibraryStore((s) => s.monthlyStats);
  const favorites = useLibraryStore((s) => s.favorites);
  const localSongs = useLibraryStore((s) => s.localSongs);
  const listeningHistory = useLibraryStore((s) => s.listeningHistory);
  const resetListeningData = useLibraryStore((s) => s.resetListeningData);

  const [currentSlide, setCurrentSlide] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resetNotice, setResetNotice] = useState(false);
  const [savedPngNotice, setSavedPngNotice] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [previewStatus, setPreviewStatus] = useState<string | null>(null);
  const [brokenArtworkUrls, setBrokenArtworkUrls] = useState<Record<string, boolean>>({});

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const elapsedBeforePauseRef = useRef<number>(0);
  const holdStartAtRef = useRef<number>(0);
  const suppressTapRef = useRef<boolean>(false);
  const currentSlideRef = useRef<number>(0);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewSessionRef = useRef<number>(0);

  const effectiveStats = useMemo<YearlyReplayStats>(() => {
    if (yearlyStats !== undefined && yearlyStats !== null) {
      return normalizeReplayStats(yearlyStats);
    }
    if (storeYearlyStats && storeYearlyStats.totalPlaysCount > 0) {
      return normalizeReplayStats(storeYearlyStats);
    }
    const fallbackMonthly = monthlyStats !== undefined ? monthlyStats : storeMonthlyStats;
    if (fallbackMonthly && fallbackMonthly.totalPlaysCount > 0) {
      return monthlyToYearlyStats(fallbackMonthly);
    }
    if (storeYearlyStats) {
      return normalizeReplayStats(storeYearlyStats);
    }
    return normalizeReplayStats(null);
  }, [yearlyStats, storeYearlyStats, monthlyStats, storeMonthlyStats]);

  const starterLibraryTracks = useMemo<Array<{ videoId: string; title: string; artist: string }>>(() => {
    const combined: Array<{ videoId: string; title: string; artist: string }> = [];
    const seen = new Set<string>();
    const candidates: Array<{ videoId?: string; title?: string; artist?: string }> = [
      ...(Array.isArray(favorites) ? favorites : []),
      ...(Array.isArray(localSongs) ? localSongs : []),
      ...(Array.isArray(listeningHistory) ? listeningHistory : []),
    ];
    for (const item of candidates) {
      if (!item || !item.videoId || seen.has(item.videoId)) continue;
      seen.add(item.videoId);
      combined.push({
        videoId: item.videoId,
        title: item.title || 'Unknown Track',
        artist: item.artist || 'Unknown Artist',
      });
      if (combined.length >= 8) break;
    }
    return combined;
  }, [favorites, localSongs, listeningHistory]);

  const stopPreview = useCallback(() => {
    previewSessionRef.current += 1;
    if (previewTimerRef.current) {
      clearInterval(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    if (previewAudioRef.current) {
      try {
        previewAudioRef.current.pause();
        previewAudioRef.current.removeAttribute('src');
        previewAudioRef.current.load();
      } catch {
        // Ignore cleanup errors
      }
      previewAudioRef.current = null;
    }
    setIsPreviewPlaying(false);
    setPreviewProgress(0);
  }, []);

  const markBrokenArt = useCallback((url: string) => {
    setBrokenArtworkUrls((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
  }, []);

  const resolveArtUrl = useCallback(
    (artworkUrl?: string | null, videoId?: string | null): string | null => {
      if (isValidArtworkUrl(artworkUrl) && !brokenArtworkUrls[artworkUrl]) {
        return artworkUrl;
      }
      if (isLikelyYouTubeId(videoId)) {
        const yt = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        if (!brokenArtworkUrls[yt]) return yt;
      }
      return null;
    },
    [brokenArtworkUrls]
  );

  const goToSlide = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(TOTAL_SLIDES - 1, idx));
    elapsedBeforePauseRef.current = 0;
    setProgress(0);
    currentSlideRef.current = clamped;
    setCurrentSlide(clamped);
  }, []);

  const goToPrevSlide = useCallback(() => {
    elapsedBeforePauseRef.current = 0;
    setProgress(0);
    const prev = Math.max(0, currentSlideRef.current - 1);
    currentSlideRef.current = prev;
    setCurrentSlide(prev);
  }, []);

  const goToNextSlide = useCallback(() => {
    elapsedBeforePauseRef.current = 0;
    setProgress(0);
    if (currentSlideRef.current >= TOTAL_SLIDES - 1) {
      onClose();
      return;
    }
    const next = Math.min(TOTAL_SLIDES - 1, currentSlideRef.current + 1);
    currentSlideRef.current = next;
    setCurrentSlide(next);
  }, [onClose]);

  const handleTogglePreview = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isPreviewPlaying) {
        stopPreview();
        setPreviewStatus(null);
        return;
      }

      const candidate = effectiveStats.topTracks[0] ?? starterLibraryTracks[0] ?? null;

      if (!candidate) {
        setPreviewStatus('No track available to preview yet.');
        return;
      }

      if (typeof Audio === 'undefined') {
        setPreviewStatus('Audio preview requires desktop/browser playback.');
        return;
      }

      const session = ++previewSessionRef.current;
      setPreviewStatus('Loading 15s preview...');

      try {
        const allKnown = [
          usePlayerStore.getState().currentTrack,
          ...(Array.isArray(favorites) ? favorites : []),
          ...(Array.isArray(localSongs) ? localSongs : []),
        ].filter((s): s is Song => Boolean(s));
        const matchedSong = allKnown.find((s) => s.videoId === candidate.videoId);
        let streamUrl =
          matchedSong?.streamUrl ||
          (matchedSong?.localFilePath ? `file://${matchedSong.localFilePath}` : null);

        if (!streamUrl && candidate.videoId) {
          const resolved = await new MusicService()
            .resolveStream(candidate.videoId, candidate.title, candidate.artist)
            .catch(() => null);
          streamUrl = resolved?.url || null;
        }

        if (session !== previewSessionRef.current) return;

        if (!streamUrl) {
          setPreviewStatus('Preview unavailable offline for this track.');
          return;
        }

        const audio = new Audio(streamUrl);
        audio.volume = 0.85;
        previewAudioRef.current = audio;

        const startedAt = Date.now();
        audio.onended = () => {
          if (session === previewSessionRef.current) {
            stopPreview();
            setPreviewStatus(null);
          }
        };
        audio.onerror = () => {
          if (session === previewSessionRef.current) {
            stopPreview();
            setPreviewStatus('Unable to play preview stream.');
          }
        };

        await audio.play();
        if (session !== previewSessionRef.current) {
          audio.pause();
          return;
        }

        setIsPreviewPlaying(true);
        setPreviewProgress(0);
        setPreviewStatus(null);

        previewTimerRef.current = setInterval(() => {
          const elapsed = Date.now() - startedAt;
          const frac = Math.min(1, elapsed / PREVIEW_DURATION_MS);
          setPreviewProgress(frac);
          if (frac >= 1) {
            stopPreview();
          }
        }, 100);
      } catch {
        if (session === previewSessionRef.current) {
          stopPreview();
          setPreviewStatus('Preview stream blocked or unavailable.');
        }
      }
    },
    [isPreviewPlaying, stopPreview, effectiveStats.topTracks, starterLibraryTracks, favorites, localSongs]
  );

  const handleResetReplay = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      stopPreview();
      setPreviewStatus(null);
      await resetListeningData();
      elapsedBeforePauseRef.current = 0;
      setProgress(0);
      currentSlideRef.current = 0;
      setCurrentSlide(0);
      setResetNotice(true);
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = setTimeout(() => {
        setResetNotice(false);
        noticeTimerRef.current = null;
      }, 1600);
    },
    [resetListeningData, stopPreview]
  );

  const handleSavePngCard = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (typeof document === 'undefined') return;
      try {
        const cardCanvas = document.createElement('canvas');
        cardCanvas.width = 1080;
        cardCanvas.height = 1920;
        const ctx = cardCanvas.getContext('2d');
        if (!ctx) return;

        // Background gradient
        const bgGrad = ctx.createLinearGradient(0, 0, 1080, 1920);
        bgGrad.addColorStop(0, '#120810');
        bgGrad.addColorStop(0.5, '#0b0b12');
        bgGrad.addColorStop(1, '#1a0c24');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, 1080, 1920);

        // Ambient glow orbs
        const glow1 = ctx.createRadialGradient(200, 260, 40, 200, 260, 520);
        glow1.addColorStop(0, 'rgba(250, 45, 72, 0.42)');
        glow1.addColorStop(1, 'rgba(250, 45, 72, 0)');
        ctx.fillStyle = glow1;
        ctx.fillRect(0, 0, 1080, 1920);

        const glow2 = ctx.createRadialGradient(880, 1520, 40, 880, 1520, 560);
        glow2.addColorStop(0, 'rgba(139, 92, 246, 0.35)');
        glow2.addColorStop(1, 'rgba(139, 92, 246, 0)');
        ctx.fillStyle = glow2;
        ctx.fillRect(0, 0, 1080, 1920);

        // Header Pill
        ctx.fillStyle = 'rgba(250, 45, 72, 0.22)';
        drawRoundedRect(ctx, 84, 96, 410, 56, 28);
        ctx.fill();
        ctx.font = '700 26px sans-serif';
        ctx.fillStyle = '#FA2D48';
        ctx.fillText(`WAVEFORM • ${effectiveStats.year} REPLAY`, 114, 133);

        // Hero Minutes
        const mins = Math.round(effectiveStats.totalListeningTimeSec / 60);
        ctx.font = '900 132px sans-serif';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(mins.toLocaleString(), 84, 330);
        ctx.font = '700 38px sans-serif';
        ctx.fillStyle = '#D4D4D8';
        ctx.fillText('MINUTES LISTENED', 84, 390);
        ctx.font = '500 30px sans-serif';
        ctx.fillStyle = '#A1A1AA';
        ctx.fillText(
          `${effectiveStats.totalPlaysCount.toLocaleString()} plays • ${effectiveStats.uniqueTracksCount} tracks • ${effectiveStats.uniqueArtistsCount} artists`,
          84,
          444
        );

        // Top Song Card
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        drawRoundedRect(ctx, 84, 510, 912, 250, 36);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.font = '700 24px sans-serif';
        ctx.fillStyle = '#FA2D48';
        ctx.fillText('TOP SONG OF 2026', 128, 570);
        const topSong = effectiveStats.topTracks[0];
        ctx.font = '800 46px sans-serif';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText((topSong?.title || 'Listening Journey').slice(0, 28), 128, 636);
        ctx.font = '600 32px sans-serif';
        ctx.fillStyle = '#D4D4D8';
        ctx.fillText(
          topSong ? `${topSong.artist} • ${topSong.playCount} plays` : 'Play tracks to unlock',
          128,
          696
        );

        // Top Artists Card
        ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
        drawRoundedRect(ctx, 84, 810, 912, 620, 36);
        ctx.fill();
        ctx.font = '700 24px sans-serif';
        ctx.fillStyle = '#FACC15';
        ctx.fillText('TOP ARTISTS', 128, 872);

        const artists = effectiveStats.topArtists.slice(0, 5);
        artists.forEach((a, idx) => {
          const y = 948 + idx * 92;
          ctx.font = '800 34px sans-serif';
          ctx.fillStyle = idx === 0 ? '#FACC15' : '#FFFFFF';
          ctx.fillText(`#${idx + 1}  ${a.artistName.slice(0, 26)}`, 128, y);
          ctx.font = '600 26px sans-serif';
          ctx.fillStyle = '#A1A1AA';
          ctx.fillText(`${a.playCount} plays (${a.percentage}%)`, 700, y);
        });
        if (artists.length === 0) {
          ctx.font = '500 30px sans-serif';
          ctx.fillStyle = '#A1A1AA';
          ctx.fillText('Listen to music to populate your Top 5 leaderboard.', 128, 970);
        }

        // Quality + Streak Footer
        const qTotal = Math.max(
          1,
          effectiveStats.qualityBreakdown.lossless +
            effectiveStats.qualityBreakdown.opus +
            effectiveStats.qualityBreakdown.other
        );
        const losslessPct = Math.round((effectiveStats.qualityBreakdown.lossless / qTotal) * 100);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        drawRoundedRect(ctx, 84, 1480, 912, 220, 36);
        ctx.fill();
        ctx.font = '700 24px sans-serif';
        ctx.fillStyle = '#38BDF8';
        ctx.fillText('LISTENING SIGNATURE', 128, 1542);
        ctx.font = '700 34px sans-serif';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(
          `Peak Hour: ${formatPeakHour(effectiveStats.peakHour)}   •   Streak: ${effectiveStats.longestStreakDays} days`,
          128,
          1604
        );
        ctx.font = '600 28px sans-serif';
        ctx.fillStyle = '#A1A1AA';
        ctx.fillText(`Lossless Hi-Res Share: ${losslessPct}%`, 128, 1656);

        ctx.font = '600 26px sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillText('Generated by WaveForm Desktop', 84, 1810);

        const pngUrl = cardCanvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = pngUrl;
        link.download = `waveform-${effectiveStats.year}-replay.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        setSavedPngNotice(true);
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => {
          setSavedPngNotice(false);
          savedTimerRef.current = null;
        }, 2000);
      } catch (err) {
        console.warn('[ReplayStoriesModal] Failed to export PNG card:', err);
      }
    },
    [effectiveStats]
  );

  // Reset state cleanly whenever modal opens or closes
  useEffect(() => {
    elapsedBeforePauseRef.current = 0;
    currentSlideRef.current = 0;
    setCurrentSlide(0);
    setProgress(0);
    setIsPaused(false);
    setPreviewStatus(null);
    stopPreview();
  }, [isOpen, stopPreview]);

  // Stop 15s preview if leaving Slide 1
  useEffect(() => {
    if (!isOpen || currentSlide !== 1) {
      stopPreview();
    }
  }, [isOpen, currentSlide, stopPreview]);

  // Clean up all timers and audio on unmount
  useEffect(() => {
    return () => {
      stopPreview();
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, [stopPreview]);

  // Keyboard navigation: ArrowLeft, ArrowRight, Space, Escape
  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goToNextSlide();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goToPrevSlide();
      } else if (e.key === ' ') {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
        e.preventDefault();
        setIsPaused((prev) => {
          const next = !prev;
          if (next) {
            elapsedBeforePauseRef.current = progress * SLIDE_DURATION_MS;
          }
          return next;
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, goToNextSlide, goToPrevSlide, progress]);

  // Stardust canvas particle animation
  useEffect(() => {
    if (!isOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    const particles = Array.from({ length: 32 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      radius: 0.9 + Math.random() * 2.1,
      vx: (Math.random() - 0.5) * 0.35,
      vy: -0.25 - Math.random() * 0.45,
      alpha: 0.16 + Math.random() * 0.48,
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

  // Auto-advance timer (pauses cleanly when held or during 15s preview)
  useEffect(() => {
    if (!isOpen || isPaused || isPreviewPlaying) return;

    startTimeRef.current = Date.now() - elapsedBeforePauseRef.current;

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const frac = Math.min(1.0, elapsed / SLIDE_DURATION_MS);
      setProgress(frac);

      if (frac >= 1.0) {
        elapsedBeforePauseRef.current = 0;
        setProgress(0);
        if (currentSlideRef.current >= TOTAL_SLIDES - 1) {
          clearInterval(interval);
          onClose();
        } else {
          const next = Math.min(TOTAL_SLIDES - 1, currentSlideRef.current + 1);
          currentSlideRef.current = next;
          setCurrentSlide(next);
        }
      }
    }, 30);

    return () => clearInterval(interval);
  }, [isOpen, isPaused, isPreviewPlaying, currentSlide, onClose]);

  // Early return ONLY AFTER all hooks!
  if (!isOpen) return null;

  const handleHoldStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, a, input')) return;
    holdStartAtRef.current = Date.now();
    suppressTapRef.current = false;
    setIsPaused(true);
    elapsedBeforePauseRef.current = progress * SLIDE_DURATION_MS;
  };

  const handleHoldEnd = () => {
    if (holdStartAtRef.current > 0 && Date.now() - holdStartAtRef.current > 240) {
      suppressTapRef.current = true;
    }
    holdStartAtRef.current = 0;
    setIsPaused(false);
  };

  const handleTap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (suppressTapRef.current) {
      suppressTapRef.current = false;
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, a, input')) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    if (clickX < rect.width * 0.35) {
      goToPrevSlide();
    } else {
      goToNextSlide();
    }
  };

  const hasStats = effectiveStats.totalPlaysCount > 0;
  const totalMinutes = Math.round(effectiveStats.totalListeningTimeSec / 60);
  const totalPlays = effectiveStats.totalPlaysCount;
  const uniqueTracks = effectiveStats.uniqueTracksCount;
  const uniqueArtists = effectiveStats.uniqueArtistsCount;

  const topTrack = effectiveStats.topTracks[0] ?? null;
  const topArtist = effectiveStats.topArtists[0] ?? null;
  const topTrackArt = resolveArtUrl(topTrack?.artworkUrl, topTrack?.videoId);

  const qualityTotal = Math.max(
    1,
    effectiveStats.qualityBreakdown.lossless +
      effectiveStats.qualityBreakdown.opus +
      effectiveStats.qualityBreakdown.other
  );
  const losslessPct = Math.round((effectiveStats.qualityBreakdown.lossless / qualityTotal) * 100);
  const opusPct = Math.round((effectiveStats.qualityBreakdown.opus / qualityTotal) * 100);
  const otherPct = Math.max(0, 100 - losslessPct - opusPct);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xl select-none animate-in fade-in duration-200 p-4"
    >
      {/* 9:16 Interactive Story Frame */}
      <div
        onClick={(e) => {
          e.stopPropagation();
          handleTap(e);
        }}
        onPointerDown={handleHoldStart}
        onPointerUp={handleHoldEnd}
        onPointerCancel={handleHoldEnd}
        onMouseLeave={handleHoldEnd}
        className="relative w-[405px] max-w-[94vw] h-[720px] max-h-[90vh] rounded-3xl overflow-hidden shadow-2xl border border-white/15 flex flex-col justify-between p-5 bg-gradient-to-b from-[#170b14] via-[#0c0c12] to-[#08080c] text-white cursor-pointer"
      >
        {/* Ambient blurred album-art backdrop */}
        {topTrackArt && (
          <img
            src={topTrackArt}
            alt=""
            aria-hidden="true"
            onError={() => markBrokenArt(topTrackArt)}
            className="absolute inset-0 w-full h-full object-cover opacity-20 blur-3xl scale-125 pointer-events-none"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/60 to-black/85 pointer-events-none" />

        {/* Background Stardust Canvas */}
        <canvas
          ref={canvasRef}
          width={405}
          height={720}
          className="absolute inset-0 w-full h-full pointer-events-none z-0"
        />

        {/* Ambient Color Orbs */}
        <div className="absolute -top-24 -left-24 w-72 h-72 rounded-full bg-[#FA2D48]/25 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-72 h-72 rounded-full bg-purple-600/25 blur-3xl pointer-events-none" />

        {/* Top Header: 5 Progress Bars + Controls */}
        <div className="relative z-10 space-y-3">
          <div className="flex items-center gap-1.5 w-full">
            {Array.from({ length: TOTAL_SLIDES }).map((_, idx) => {
              let segProgress = 0;
              if (idx < currentSlide) segProgress = 1;
              else if (idx === currentSlide) segProgress = progress;

              return (
                <button
                  key={idx}
                  type="button"
                  aria-label={`Slide ${idx + 1}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    goToSlide(idx);
                  }}
                  className="flex-1 h-1.5 rounded-full bg-white/20 overflow-hidden cursor-pointer"
                >
                  <div
                    style={{ width: `${segProgress * 100}%` }}
                    className="h-full bg-white rounded-full transition-all duration-75"
                  />
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between pt-0.5">
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs font-bold tracking-wider uppercase text-[#FA2D48]">
                <Sparkles size={14} /> {effectiveStats.year} Replay
              </span>
              {(isPaused || isPreviewPlaying) && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/10 text-[10px] font-semibold text-white/80">
                  <Pause size={10} /> {isPreviewPlaying ? 'Preview' : 'Paused'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {resetNotice && (
                <span className="text-[10px] font-semibold text-emerald-400">Cleared</span>
              )}
              <button
                type="button"
                onClick={handleResetReplay}
                title="Reset Replay & Listening Data"
                className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/10 hover:bg-red-500/30 text-white text-[11px] font-medium transition-colors cursor-pointer"
              >
                <RotateCcw size={11} />
                <span>Reset Data</span>
              </button>
              <button
                type="button"
                aria-label="Close Replay"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                }}
                className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>
          </div>
        </div>

        {/* Main Slide Content */}
        <div className="relative z-10 flex-1 flex flex-col justify-center items-center text-center px-3 py-4 overflow-hidden">
          {/* SLIDE 0: 2026 OVERVIEW */}
          {currentSlide === 0 && (
            <div className="w-full space-y-5 animate-in fade-in zoom-in-95 duration-300">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-[11px] font-bold tracking-wider uppercase text-white/90">
                {hasStats ? '2026 Listening Overview' : 'Getting Started'}
              </span>

              {hasStats ? (
                <>
                  <div>
                    <div className="text-6xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-[#FA2D48] via-pink-400 to-purple-400">
                      {totalMinutes.toLocaleString()}
                    </div>
                    <p className="text-lg font-bold text-white mt-1">Minutes Listened</p>
                    <p className="text-xs text-neutral-300 mt-0.5">
                      {totalPlays.toLocaleString()} total {totalPlays === 1 ? 'play' : 'plays'} in{' '}
                      {effectiveStats.year}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 text-left pt-2">
                    <div className="p-3 rounded-2xl bg-white/10 border border-white/10">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-neutral-400">
                        <Music size={12} className="text-[#FA2D48]" /> Unique Tracks
                      </div>
                      <div className="text-xl font-extrabold text-white mt-1">{uniqueTracks}</div>
                    </div>
                    <div className="p-3 rounded-2xl bg-white/10 border border-white/10">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-neutral-400">
                        <Trophy size={12} className="text-amber-400" /> Unique Artists
                      </div>
                      <div className="text-xl font-extrabold text-white mt-1">{uniqueArtists}</div>
                    </div>
                    <div className="p-3 rounded-2xl bg-white/10 border border-white/10">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-neutral-400">
                        <Clock size={12} className="text-cyan-400" /> Peak Hour
                      </div>
                      <div className="text-xl font-extrabold text-white mt-1">
                        {formatPeakHour(effectiveStats.peakHour)}
                      </div>
                    </div>
                    <div className="p-3 rounded-2xl bg-white/10 border border-white/10">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-neutral-400">
                        <Flame size={12} className="text-orange-400" /> Best Streak
                      </div>
                      <div className="text-xl font-extrabold text-white mt-1">
                        {effectiveStats.longestStreakDays}d
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-[#FA2D48] to-purple-600 flex items-center justify-center shadow-2xl mx-auto">
                    <Sparkles size={38} className="text-white" />
                  </div>
                  <h2 className="text-2xl font-extrabold tracking-tight">
                    Your 2026 Replay is Warming Up
                  </h2>
                  <p className="text-xs text-neutral-300 max-w-xs mx-auto leading-relaxed">
                    {starterLibraryTracks.length > 0
                      ? `You have ${starterLibraryTracks.length} tracks ready in your library. Listen to songs to unlock live 2026 highlights.`
                      : 'Start playing your favorite songs and albums to build your personalized 2026 Replay stories.'}
                  </p>
                  {starterLibraryTracks.length > 0 && (
                    <div className="space-y-1.5 max-w-xs mx-auto text-left">
                      {starterLibraryTracks.slice(0, 3).map((song) => (
                        <div
                          key={song.videoId}
                          className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="font-semibold truncate">{song.title}</span>
                          <span className="text-neutral-400 truncate max-w-[110px]">
                            {song.artist}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* SLIDE 1: TOP SONG OF 2026 + 15s PREVIEW */}
          {currentSlide === 1 && (
            <div className="w-full space-y-5 animate-in fade-in duration-300">
              <span className="text-xs font-bold tracking-wider text-[#FA2D48] uppercase">
                Top Song of 2026
              </span>

              {topTrack ? (
                <>
                  <div className="relative w-44 h-44 mx-auto rounded-2xl overflow-hidden shadow-2xl border border-white/20 bg-white/10 flex items-center justify-center">
                    {topTrackArt ? (
                      <img
                        src={topTrackArt}
                        alt={topTrack.title}
                        onError={() => markBrokenArt(topTrackArt)}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-[#FA2D48]/35 to-purple-600/35 flex items-center justify-center">
                        <Music size={52} className="text-white/80" />
                      </div>
                    )}
                  </div>

                  <div className="space-y-1 px-2">
                    <h2 className="text-2xl font-extrabold text-white truncate">
                      {topTrack.title}
                    </h2>
                    <p className="text-sm font-medium text-neutral-300 truncate">
                      {topTrack.artist}
                    </p>
                    {topTrack.albumName && (
                      <p className="text-[11px] text-neutral-400 truncate">{topTrack.albumName}</p>
                    )}
                  </div>

                  <div className="flex items-center justify-center gap-2">
                    <span className="px-3 py-1 rounded-full text-xs font-semibold bg-white/10 border border-white/15">
                      Played {topTrack.playCount} {topTrack.playCount === 1 ? 'time' : 'times'}
                    </span>
                    <span className="px-3 py-1 rounded-full text-xs font-semibold bg-white/10 border border-white/15">
                      {Math.max(1, Math.round(topTrack.totalSec / 60))} min
                    </span>
                  </div>

                  <div className="space-y-2 pt-1">
                    <button
                      type="button"
                      onClick={handleTogglePreview}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#FA2D48] hover:brightness-110 text-white text-xs font-bold shadow-lg shadow-[#FA2D48]/30 transition-all cursor-pointer"
                    >
                      {isPreviewPlaying ? <Square size={13} /> : <Play size={13} />}
                      <span>{isPreviewPlaying ? 'Stop 15s Preview' : 'Play 15s Preview'}</span>
                    </button>

                    {isPreviewPlaying && (
                      <div className="w-48 mx-auto h-1.5 rounded-full bg-white/15 overflow-hidden">
                        <div
                          style={{ width: `${previewProgress * 100}%` }}
                          className="h-full bg-[#FA2D48] transition-all duration-100"
                        />
                      </div>
                    )}
                    {previewStatus && (
                      <p className="text-[11px] text-neutral-300">{previewStatus}</p>
                    )}
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  <div className="w-28 h-28 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center mx-auto">
                    <Music size={40} className="text-white/60" />
                  </div>
                  <h3 className="text-lg font-bold">Your Top Song Awaits</h3>
                  <p className="text-xs text-neutral-400 max-w-xs mx-auto">
                    {starterLibraryTracks[0]
                      ? `Try playing "${starterLibraryTracks[0].title}" by ${starterLibraryTracks[0].artist} to kick off your 2026 soundtrack.`
                      : 'Play songs in WaveForm to crown your Top Song of 2026.'}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* SLIDE 2: TOP 5 ARTISTS LEADERBOARD */}
          {currentSlide === 2 && (
            <div className="w-full space-y-4 animate-in fade-in duration-300">
              <span className="text-xs font-bold tracking-wider text-amber-400 uppercase flex items-center justify-center gap-1.5">
                <Trophy size={14} /> Top Artists of 2026
              </span>

              {effectiveStats.topArtists.length > 0 ? (
                <div className="space-y-2.5 w-full text-left">
                  {effectiveStats.topArtists.slice(0, 5).map((artist, idx) => {
                    const artUrl = resolveArtUrl(artist.artworkUrl, null);
                    const pct = Math.max(4, Math.min(100, artist.percentage));
                    return (
                      <div
                        key={artist.artistName}
                        className="p-3 rounded-2xl bg-white/10 border border-white/10 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2.5">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span
                              className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black shrink-0 ${
                                idx === 0
                                  ? 'bg-amber-400 text-black'
                                  : 'bg-white/15 text-white'
                              }`}
                            >
                              {idx + 1}
                            </span>
                            <div className="w-8 h-8 rounded-full overflow-hidden bg-white/10 flex items-center justify-center shrink-0">
                              {artUrl ? (
                                <img
                                  src={artUrl}
                                  alt={artist.artistName}
                                  onError={() => markBrokenArt(artUrl)}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <span className="text-xs font-bold text-white/80">
                                  {artist.artistName.charAt(0).toUpperCase()}
                                </span>
                              )}
                            </div>
                            <span className="text-xs font-bold text-white truncate">
                              {artist.artistName}
                            </span>
                          </div>
                          <span className="text-[11px] font-mono text-neutral-300 shrink-0">
                            {artist.playCount}x • {artist.percentage}%
                          </span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                          <div
                            style={{ width: `${pct}%` }}
                            className={`h-full rounded-full ${
                              idx === 0
                                ? 'bg-gradient-to-r from-amber-400 to-[#FA2D48]'
                                : 'bg-gradient-to-r from-[#FA2D48] to-purple-500'
                            }`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-neutral-400 max-w-xs mx-auto">
                  No artists recorded yet — listen across your library to build your Top 5 leaderboard.
                </p>
              )}
            </div>
          )}

          {/* SLIDE 3: TOP ALBUMS & AUDIO QUALITY BREAKDOWN */}
          {currentSlide === 3 && (
            <div className="w-full space-y-4 animate-in fade-in duration-300">
              <span className="text-xs font-bold tracking-wider text-cyan-400 uppercase flex items-center justify-center gap-1.5">
                <Disc3 size={14} /> Albums & Audio Quality
              </span>

              {/* Lossless vs Opus Breakdown */}
              <div className="w-full p-3.5 rounded-2xl bg-white/10 border border-white/10 text-left space-y-2.5">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span>Sound Quality Mix</span>
                  <span className="text-cyan-400 font-mono">{losslessPct}% Lossless</span>
                </div>

                <div className="w-full h-3 rounded-full bg-white/10 overflow-hidden flex">
                  {losslessPct > 0 && (
                    <div
                      style={{ width: `${losslessPct}%` }}
                      className="h-full bg-cyan-400"
                      title={`Lossless: ${losslessPct}%`}
                    />
                  )}
                  {opusPct > 0 && (
                    <div
                      style={{ width: `${opusPct}%` }}
                      className="h-full bg-purple-400"
                      title={`Opus: ${opusPct}%`}
                    />
                  )}
                  {otherPct > 0 && (
                    <div
                      style={{ width: `${otherPct}%` }}
                      className="h-full bg-white/35"
                      title={`Standard/Other: ${otherPct}%`}
                    />
                  )}
                </div>

                <div className="flex items-center justify-between text-[11px] text-neutral-300">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-cyan-400" />
                    Lossless ({effectiveStats.qualityBreakdown.lossless})
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-purple-400" />
                    Opus ({effectiveStats.qualityBreakdown.opus})
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-white/50" />
                    Other ({effectiveStats.qualityBreakdown.other})
                  </span>
                </div>
              </div>

              {/* Top Albums Grid */}
              {effectiveStats.topAlbums.length > 0 ? (
                <div className="grid grid-cols-2 gap-2.5 w-full text-left">
                  {effectiveStats.topAlbums.slice(0, 4).map((album) => {
                    const art = resolveArtUrl(album.artworkUrl, null);
                    return (
                      <div
                        key={`${album.albumName}-${album.artist}`}
                        className="p-2.5 rounded-2xl bg-white/10 border border-white/10 space-y-2"
                      >
                        <div className="w-full aspect-square rounded-xl overflow-hidden bg-white/10 flex items-center justify-center">
                          {art ? (
                            <img
                              src={art}
                              alt={album.albumName}
                              onError={() => markBrokenArt(art)}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Disc3 size={28} className="text-white/50" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold truncate">{album.albumName}</div>
                          <div className="text-[10px] text-neutral-400 truncate">
                            {album.artist} • {album.playCount}x
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-4 rounded-2xl bg-white/5 border border-white/10 text-xs text-neutral-400">
                  {hasStats
                    ? 'Album breakdown appears here as you listen to full album releases.'
                    : 'Play albums in your library to see your top album covers here.'}
                </div>
              )}
            </div>
          )}

          {/* SLIDE 4: SHAREABLE SUMMARY CARD + SAVE PNG */}
          {currentSlide === 4 && (
            <div className="w-full space-y-4 animate-in fade-in duration-300">
              <span className="text-xs font-bold tracking-wider text-emerald-400 uppercase">
                Shareable 2026 Poster
              </span>

              <div className="w-full p-4 rounded-3xl bg-gradient-to-br from-[#FA2D48]/25 via-white/10 to-purple-600/25 border border-white/20 shadow-xl text-left space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black tracking-widest uppercase text-[#FA2D48]">
                    WaveForm • {effectiveStats.year}
                  </span>
                  <span className="text-[10px] font-mono text-white/70">
                    {losslessPct}% Lossless
                  </span>
                </div>

                <div>
                  <div className="text-3xl font-black text-white">
                    {totalMinutes.toLocaleString()} min
                  </div>
                  <div className="text-xs text-neutral-300">
                    {totalPlays.toLocaleString()} plays • {uniqueTracks} tracks • {uniqueArtists}{' '}
                    artists
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
                  <div className="p-2.5 rounded-xl bg-black/30 border border-white/10">
                    <div className="text-[10px] uppercase text-neutral-400 font-bold">Top Song</div>
                    <div className="font-bold text-white truncate mt-0.5">
                      {topTrack?.title || 'Warming Up'}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-black/30 border border-white/10">
                    <div className="text-[10px] uppercase text-neutral-400 font-bold">
                      Top Artist
                    </div>
                    <div className="font-bold text-white truncate mt-0.5">
                      {topArtist?.artistName || 'Warming Up'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-neutral-300 pt-1 border-t border-white/10">
                  <span>Peak: {formatPeakHour(effectiveStats.peakHour)}</span>
                  <span>Streak: {effectiveStats.longestStreakDays} days</span>
                </div>
              </div>

              <div className="flex items-center justify-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={handleSavePngCard}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-white text-black hover:bg-neutral-200 font-bold text-xs shadow-lg transition-colors cursor-pointer"
                >
                  {savedPngNotice ? <Check size={14} /> : <Download size={14} />}
                  <span>{savedPngNotice ? 'Saved PNG Card' : 'Save PNG Card'}</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose();
                  }}
                  className="px-5 py-2.5 rounded-full bg-[#FA2D48] hover:brightness-110 text-white font-bold text-xs shadow-lg shadow-[#FA2D48]/30 transition-all cursor-pointer"
                >
                  Close Replay
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Navigation Footer */}
        <div className="relative z-10 flex items-center justify-between text-[11px] text-neutral-400 px-1 pt-2">
          <button
            type="button"
            aria-label="Previous slide"
            onClick={(e) => {
              e.stopPropagation();
              goToPrevSlide();
            }}
            disabled={currentSlide === 0}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full hover:bg-white/10 disabled:opacity-30 transition-colors cursor-pointer"
          >
            <ChevronLeft size={13} />
            <span>Back</span>
          </button>

          <span>
            {currentSlide + 1} / {TOTAL_SLIDES} • Hold to pause
          </span>

          <button
            type="button"
            aria-label="Next slide"
            onClick={(e) => {
              e.stopPropagation();
              goToNextSlide();
            }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full hover:bg-white/10 transition-colors cursor-pointer"
          >
            <span>{currentSlide === TOTAL_SLIDES - 1 ? 'Done' : 'Next'}</span>
            <ChevronRight size={13} />
          </button>
        </div>
      </div>
    </div>
  );
};
