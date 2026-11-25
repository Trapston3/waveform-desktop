// src/ui/player/SyllableLyricsEngine.tsx
// Real-time syllable-by-syllable lyric rendering engine with 1:1 Apple Music Live Lyrics Parity
// - GPU-composited transform & opacity row transitions (zero blur repaints)
// - 60fps requestAnimationFrame audio element currentTime reader & sub-frame interpolator
// - 3-dot pulsating countdown beat dots for breaks >= 4.0s (InstrumentalDotsRow)
// - Second-order harmonic oscillator spring ODE solver for auto-scrolling
// - 3.0s detention auto-center snap-back to active line
// - Support for backing vocals / parenthetical words and Romanization/Translation toggles
// - Memoized LyricLineRow skipping unchanged lines for 0Hz playback re-render isolation

import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { Languages, Globe, ArrowDownCircle } from 'lucide-react';
import { LyricsService } from '../../services/LyricsService';
import type { ParsedLyrics, LyricLine, LyricSyllable } from '../../services/LyricsService';
import { usePlayerStore } from '../../state/playerStore';
import { useSettingsStore } from '../../state/settingsStore';
import { useThemeStore } from '../theme/Theme';
import { getSyncButtonTheme } from '../../lyricVisualizer/rendering/syncButtonTheme';
import { InstrumentalDotsRow } from './InstrumentalDotsRow';

export interface SyllableLyricsEngineProps {
  lyricsData: ParsedLyrics | null;
  currentPositionMs?: number;
  isActive?: boolean;
  onSeek: (positionMs: number) => void;
  className?: string;
  fontSize?: number;
  alignment?: 'left' | 'center';
  isLoading?: boolean;
  bottomOffsetClass?: string;
}

const ROW_GPU_TRANSITION =
  'transform 400ms cubic-bezier(0.22, 1, 0.36, 1), opacity 400ms cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * Analytical Second-Order Harmonic Oscillator Spring ODE Solver
 * m * x'' + c * x' + k * (x - target) = 0
 * Dynamic stiffness and critical damping adapted to lyric line interval
 */
export class SpringScroller {
  private currentY: number;
  private targetY: number;
  private velocity = 0;
  private stiffness = 170;
  private damping = 28.6;
  private mass = 1;

  constructor(initialY = 0) {
    this.currentY = initialY;
    this.targetY = initialY;
  }

  public setTarget(targetY: number, intervalMs?: number, isSeek = false) {
    this.targetY = targetY;
    if (isSeek) {
      this.stiffness = 120;
      this.damping = Math.sqrt(this.stiffness) * 2.2;
    } else if (intervalMs !== undefined && intervalMs > 0) {
      const clamped = Math.min(Math.max(intervalMs, 100), 800);
      const ratio = Math.pow(1 - (clamped - 100) / 700, 0.2);
      this.stiffness = 170 + ratio * 50; // [170, 220]
      this.damping = Math.sqrt(this.stiffness) * 2.2; // Critical damping ~1.1 ratio
    } else {
      this.stiffness = 170;
      this.damping = Math.sqrt(170) * 2.2;
    }
  }

  public reset(y: number) {
    this.currentY = y;
    this.targetY = y;
    this.velocity = 0;
  }

  public step(dtSec: number): { position: number; isSettled: boolean } {
    const safeDt = Number.isFinite(dtSec) && dtSec > 0 ? Math.min(dtSec, 0.05) : 1 / 60;
    const delta = this.targetY - this.currentY;
    const springForce = this.stiffness * delta;
    const dampingForce = this.damping * this.velocity;
    const acceleration = (springForce - dampingForce) / this.mass;

    this.velocity += acceleration * safeDt;
    this.currentY += this.velocity * safeDt;

    const isSettled = Math.abs(delta) < 0.5 && Math.abs(this.velocity) < 1.0;
    if (isSettled) {
      this.currentY = this.targetY;
      this.velocity = 0;
    }

    return { position: this.currentY, isSettled };
  }

  public getPosition(): number {
    return this.currentY;
  }
}

interface LyricLineRowProps {
  line: LyricLine;
  lIndex: number;
  isActiveLine: boolean;
  clampedDistance: number; // 0 for active, 1, 2, or 3 for >=3
  isUserScrolled: boolean;
  isPassedLine: boolean;
  isUnsynced: boolean;
  currentPositionMs: number;
  fontSize: number;
  alignment: 'left' | 'center';
  canSeek: boolean;
  onSeek: (ms: number, lineIndex?: number) => void;
  showRomanization: boolean;
  showTranslation: boolean;
}

/**
 * Memoized row rendering for individual lyric lines.
 * Animates ONLY GPU-composited transform and opacity and re-evaluates
 * syllable animations only when actively singing.
 */
const LyricLineRow = React.memo<LyricLineRowProps>(({
  line,
  lIndex,
  isActiveLine,
  clampedDistance,
  isUserScrolled,
  isPassedLine,
  isUnsynced,
  currentPositionMs,
  fontSize,
  alignment,
  canSeek,
  onSeek,
  showRomanization,
  showTranslation,
}) => {
  const isRtl = line.isRtl || LyricsService.isRtlText(line.text);
  const isCentered = alignment === 'center';
  const [isHovered, setIsHovered] = useState(false);

  // Render metadata / credit footer in unsynced mode
  if (isUnsynced && /^(source|written by|lyrics licensed by|provided by):/i.test(line.text)) {
    return (
      <p
        className={`lyric-line text-xs text-white/40 italic pt-4 mt-6 border-t border-white/10 select-text ${
          isCentered ? 'text-center' : ''
        }`}
      >
        {line.text}
      </p>
    );
  }

  // Apple Music GPU-Only Row Visuals (transform + opacity only)
  const getVisualStyles = () => {
    if (isUnsynced) {
      return {
        opacity: 0.90,
        transform: 'translate3d(0, 0, 0) scale(1)',
        textShadow: 'none',
      };
    }

    if (isUserScrolled) {
      return {
        opacity: isActiveLine ? 1.0 : 0.75,
        transform: isActiveLine
          ? 'translate3d(0, 0, 0) scale(1.02)'
          : 'translate3d(0, 0, 0) scale(1)',
        textShadow: isActiveLine
          ? '0 0 16px rgba(255, 255, 255, 0.62), 0 0 32px rgba(250, 45, 72, 0.45)'
          : 'none',
      };
    }

    if (isHovered && !isActiveLine) {
      return {
        opacity: 0.84,
        transform: 'translate3d(0, 0, 0) scale(0.995)',
        textShadow: 'none',
      };
    }

    if (isActiveLine) {
      return {
        opacity: 1.0,
        transform: 'translate3d(0, 0, 0) scale(1.02)',
        textShadow: '0 0 16px rgba(255, 255, 255, 0.70), 0 0 32px rgba(250, 45, 72, 0.45)',
      };
    }

    switch (clampedDistance) {
      case 1:
        return {
          opacity: 0.55,
          transform: 'translate3d(0, 0, 0) scale(0.985)',
          textShadow: 'none',
        };
      case 2:
        return {
          opacity: 0.34,
          transform: 'translate3d(0, 0, 0) scale(0.97)',
          textShadow: 'none',
        };
      default: // >= 3
        return {
          opacity: 0.20,
          transform: 'translate3d(0, 0, 0) scale(0.955)',
          textShadow: 'none',
        };
    }
  };

  const visuals = getVisualStyles();

  return (
    <div
      id={`lyric-line-${lIndex}`}
      onClick={canSeek ? () => onSeek(line.startTimeMs, lIndex) : undefined}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        direction: isRtl ? 'rtl' : 'ltr',
        textAlign: isCentered ? 'center' : isRtl ? 'right' : 'left',
        transformOrigin: isCentered ? 'center center' : isRtl ? 'right center' : 'left center',
        fontFamily: isRtl ? "'Vazirmatn', sans-serif" : "'SF Pro Display', var(--font-sans)",
        opacity: visuals.opacity,
        transform: visuals.transform,
        transition: ROW_GPU_TRANSITION,
      }}
      className={`lyric-line group p-2 rounded-xl will-change-[transform,opacity] ${
        canSeek ? 'cursor-pointer hover:bg-[var(--color-surface-variant)]/30' : 'cursor-text select-text'
      } ${
        isUnsynced
          ? 'font-medium text-white/85 hover:text-white'
          : isActiveLine
          ? 'text-white font-extrabold tracking-tight'
          : isPassedLine
          ? 'text-white font-bold tracking-tight'
          : 'text-white font-bold tracking-tight'
      }`}
    >
      {/* Syllable-level rendering if available and not unsynced, else line-level */}
      {!isUnsynced && line.syllables && line.syllables.length > 0 ? (
        <div
          style={{ fontSize: `${fontSize}px` }}
          className={`flex flex-wrap items-baseline gap-x-1 leading-snug tracking-tight ${
            isCentered ? 'justify-center' : ''
          } ${
            isActiveLine ? 'font-extrabold' : 'font-bold'
          }`}
        >
          {line.syllables.map((syl: LyricSyllable, sIndex: number) => {
            const isWhitespace = /^\s+$/.test(syl.text);
            if (isWhitespace) {
              return (
                <span key={sIndex} className="inline text-white/45">
                  {syl.text}
                </span>
              );
            }

            const isSung = currentPositionMs >= syl.endTimeMs;
            const isSinging =
              currentPositionMs >= syl.startTimeMs && currentPositionMs < syl.endTimeMs;

            return (
              <span
                key={sIndex}
                style={{
                  transform: isSinging ? 'translateY(-2px)' : 'none',
                  color: isSinging
                    ? '#FFFFFF'
                    : isSung
                    ? '#FFFFFF'
                    : 'rgba(255, 255, 255, 0.45)',
                  textShadow: isSinging
                    ? '0 0 12px rgba(255, 255, 255, 0.62), 0 0 24px rgba(250, 45, 72, 0.40)'
                    : isSung
                    ? '0 0 4px rgba(255, 255, 255, 0.25)'
                    : 'none',
                  transition:
                    'transform 120ms cubic-bezier(0.22, 1, 0.36, 1), opacity 120ms cubic-bezier(0.22, 1, 0.36, 1)',
                }}
                className="inline-block"
              >
                {syl.text}
              </span>
            );
          })}
        </div>
      ) : (
        <p
          style={{
            fontSize: `${fontSize}px`,
            textShadow: visuals.textShadow,
          }}
          className={`leading-snug tracking-tight ${
            isUnsynced
              ? 'text-white/90 font-medium leading-relaxed'
              : isActiveLine
              ? 'text-white font-extrabold'
              : 'text-white font-bold'
          }`}
        >
          {line.text}
        </p>
      )}

      {/* Backing Vocals / Parenthetical line support */}
      {line.backgroundLine && (
        <div
          style={{
            fontSize: `${Math.round(fontSize * 0.75)}px`,
            fontStyle: 'italic',
            opacity: 0.65,
          }}
          className="pt-1 text-white/70 select-text"
        >
          ({line.backgroundLine.text})
        </div>
      )}

      {/* Romanization Sub-Text */}
      {showRomanization && (line.romanizedText || line.romanization) && (
        <p className="text-xs text-[var(--color-on-surface-variant)] font-normal pt-1 opacity-80">
          {line.romanizedText || line.romanization}
        </p>
      )}

      {/* Translation Sub-Text */}
      {showTranslation && (line.translatedText || line.translation) && (
        <p className="text-xs text-[var(--color-accent)] font-medium pt-1 opacity-90">
          {line.translatedText || line.translation}
        </p>
      )}
    </div>
  );
}, (prev, next) => {
  // Memoization: if line remains inactive, and clampedDistance / display state didn't change:
  if (
    !prev.isActiveLine &&
    !next.isActiveLine &&
    prev.clampedDistance === next.clampedDistance &&
    prev.isUserScrolled === next.isUserScrolled &&
    prev.isPassedLine === next.isPassedLine &&
    prev.showRomanization === next.showRomanization &&
    prev.showTranslation === next.showTranslation &&
    prev.fontSize === next.fontSize &&
    prev.alignment === next.alignment &&
    prev.line === next.line &&
    prev.isUnsynced === next.isUnsynced &&
    prev.canSeek === next.canSeek
  ) {
    return true; // Skip re-rendering!
  }

  // Active line or transitioning line re-renders
  return false;
});

LyricLineRow.displayName = 'LyricLineRow';

export const SyllableLyricsEngine: React.FC<SyllableLyricsEngineProps> = React.memo(({
  lyricsData,
  currentPositionMs: propCurrentPositionMs,
  isActive = true,
  onSeek,
  className = '',
  fontSize = 24,
  alignment,
  isLoading = false,
  bottomOffsetClass = 'bottom-6',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const settingsAlignment = useSettingsStore((s) => s.settings?.lyricsAlignment);
  const settingsScriptMode = useSettingsStore((s) => s.settings?.['lyrics.scriptMode'] ?? 'auto');
  const settingsRomanizationEnabled = useSettingsStore((s) =>
    Boolean(s.settings?.['lyrics.romanizationEnabled'])
  );
  const settingsTranslationEnabled = useSettingsStore((s) =>
    Boolean(s.settings?.['lyrics.translationEnabled'])
  );
  const artworkPalette = useThemeStore((s) => s.artworkPalette);
  const effectiveAlignment: 'left' | 'center' = alignment ?? settingsAlignment ?? 'left';
  const syncTheme = useMemo(
    () => getSyncButtonTheme('Classic', undefined, artworkPalette),
    [artworkPalette]
  );

  const [rafPositionMs, setRafPositionMs] = useState<number>(() =>
    propCurrentPositionMs !== undefined
      ? propCurrentPositionMs
      : usePlayerStore.getState().positionMs
  );

  const currentPositionMs =
    propCurrentPositionMs !== undefined ? propCurrentPositionMs : rafPositionMs;

  const [isUserScrolled, setIsUserScrolled] = useState(false);
  const [manualRomanization, setManualRomanization] = useState<boolean | null>(null);
  const [manualTranslation, setManualTranslation] = useState<boolean | null>(null);

  const defaultShowRomanization =
    settingsScriptMode === 'romanized' ||
    settingsScriptMode === 'romanized_translation' ||
    (settingsScriptMode === 'auto' && settingsRomanizationEnabled);
  const defaultShowTranslation =
    settingsScriptMode === 'romanized_translation' ||
    settingsScriptMode === 'original_translation' ||
    (settingsScriptMode !== 'original' &&
      settingsScriptMode !== 'romanized' &&
      settingsTranslationEnabled);

  const showRomanization = manualRomanization ?? defaultShowRomanization;
  const showTranslation = manualTranslation ?? defaultShowTranslation;

  const isUserScrolledRef = useRef(false);
  const activeLineIndexRef = useRef(-1);
  const detentionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isProgrammaticScrollRef = useRef(false);
  const programmaticScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const springScrollerRef = useRef<SpringScroller>(new SpringScroller());
  const rafIdRef = useRef<number | null>(null);

  // Refs for 60fps audio timing & sub-frame interpolation
  const interpolatedRef = useRef<number>(currentPositionMs);
  const lastSampledMediaMsRef = useRef<number>(currentPositionMs);
  const lastSamplePerfMsRef = useRef<number>(0);
  const lastCommittedLineIdxRef = useRef<number>(-1);
  const lastCommittedSyllableIdxRef = useRef<number>(-1);
  const lastCommittedPositionMsRef = useRef<number>(currentPositionMs);
  const lastStateCommitPerfRef = useRef<number>(0);
  const pendingSeekScrollRef = useRef<boolean>(false);

  const readLiveAudioPosition = useCallback(() => {
    const storeState = usePlayerStore.getState();
    const engine = storeState.audioEngine as any;
    const el = engine?.getActiveAudioElement?.() ?? null;
    const hasBoundSrc = Boolean(el && (el.src || el.getAttribute?.('src')));

    let measuredMs = storeState.positionMs;
    let isPaused = storeState.playbackState !== 'PLAYING';

    if (hasBoundSrc) {
      measuredMs =
        typeof engine.getCurrentTime === 'function'
          ? engine.getCurrentTime() * 1000
          : typeof engine.getCurrentPositionMs === 'function'
          ? engine.getCurrentPositionMs()
          : (engine?.getPlaybackOffsetMs?.() || 0) +
            (Number.isFinite(el.currentTime) ? el.currentTime * 1000 : 0);
      if (!engine?.isSeeking?.() && typeof el.paused === 'boolean') {
        isPaused = el.paused;
      }
    } else if (engine?.isSeeking?.()) {
      measuredMs =
        typeof engine.getCurrentPositionMs === 'function'
          ? engine.getCurrentPositionMs()
          : storeState.positionMs;
    } else if (engine && typeof engine.getCurrentPositionMs === 'function') {
      measuredMs = engine.getCurrentPositionMs();
    }

    return { measuredMs, isPaused, storePositionMs: storeState.positionMs };
  }, []);

  // Check if lyrics are unsynchronized
  const isUnsynced = useMemo(() => {
    if (!lyricsData || !lyricsData.lines || lyricsData.lines.length === 0) return false;
    if (lyricsData.syncType === 'plain' || lyricsData.type === 'UNSYNCED' || lyricsData.isSynced === false) {
      return true;
    }
    return lyricsData.lines.every((l) => l.startTimeMs === 0 && l.endTimeMs === 0);
  }, [lyricsData]);

  const hasRomanization = useMemo(
    () =>
      Boolean(
        lyricsData?.lines?.some((l) => Boolean((l.romanizedText || l.romanization)?.trim()))
      ),
    [lyricsData]
  );

  const hasTranslation = useMemo(
    () =>
      Boolean(
        lyricsData?.lines?.some((l) => Boolean((l.translatedText || l.translation)?.trim()))
      ),
    [lyricsData]
  );

  const lyricsIdentityKey = useMemo(() => {
    if (!lyricsData || !lyricsData.lines || lyricsData.lines.length === 0) return '';
    const first = lyricsData.lines[0];
    const last = lyricsData.lines[lyricsData.lines.length - 1];
    return `${lyricsData.provider}:${lyricsData.lines.length}:${first?.text ?? ''}:${last?.text ?? ''}`;
  }, [lyricsData]);

  // Reset manual Rom/Trans pill overrides whenever track or script settings change
  useEffect(() => {
    setManualRomanization(null);
    setManualTranslation(null);
  }, [
    lyricsIdentityKey,
    settingsScriptMode,
    settingsRomanizationEnabled,
    settingsTranslationEnabled,
  ]);

  // Reset line/syllable commit caches and user scroll state whenever track lyrics change
  useEffect(() => {
    if (detentionTimerRef.current) {
      clearTimeout(detentionTimerRef.current);
      detentionTimerRef.current = null;
    }
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    isProgrammaticScrollRef.current = false;
    isUserScrolledRef.current = false;
    setIsUserScrolled(false);
    lastCommittedLineIdxRef.current = -2;
    lastCommittedSyllableIdxRef.current = -2;
    lastCommittedPositionMsRef.current = -1;
    lastStateCommitPerfRef.current = 0;
    pendingSeekScrollRef.current = true;

    if (propCurrentPositionMs === undefined) {
      const { measuredMs } = readLiveAudioPosition();
      interpolatedRef.current = measuredMs;
      lastSampledMediaMsRef.current = measuredMs;
      lastSamplePerfMsRef.current = typeof performance !== 'undefined' ? performance.now() : 0;
      setRafPositionMs(Math.round(measuredMs));
    }
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
    springScrollerRef.current.reset(0);
  }, [lyricsData, propCurrentPositionMs, readLiveAudioPosition]);

  // Instrumental breaks calculation (>4.0s gap between lines)
  const instrumentalBreaks = useMemo(() => {
    if (isUnsynced || !lyricsData?.lines || lyricsData.lines.length === 0) return [];
    const breaks: { afterIndex: number; startTimeMs: number; endTimeMs: number }[] = [];

    // Intro instrumental break
    if (lyricsData.lines[0].startTimeMs >= 4000) {
      breaks.push({
        afterIndex: -1,
        startTimeMs: 0,
        endTimeMs: lyricsData.lines[0].startTimeMs,
      });
    }

    // Mid-song instrumental breaks
    for (let i = 0; i < lyricsData.lines.length - 1; i++) {
      const cur = lyricsData.lines[i];
      const next = lyricsData.lines[i + 1];
      const gap = next.startTimeMs - cur.endTimeMs;
      if (gap >= 4000) {
        breaks.push({
          afterIndex: i,
          startTimeMs: cur.endTimeMs,
          endTimeMs: next.startTimeMs,
        });
      }
    }
    return breaks;
  }, [lyricsData, isUnsynced]);

  // Track external prop position jumps (> 1200ms) as seeks
  useEffect(() => {
    if (propCurrentPositionMs !== undefined) {
      if (Math.abs(propCurrentPositionMs - interpolatedRef.current) > 1200) {
        pendingSeekScrollRef.current = true;
      }
      interpolatedRef.current = propCurrentPositionMs;
      lastSampledMediaMsRef.current = propCurrentPositionMs;
    }
  }, [propCurrentPositionMs]);

  // Immediately sync when paused whenever store positionMs changes (e.g. seekbar scrub while paused)
  useEffect(() => {
    if (!isActive || isUnsynced || propCurrentPositionMs !== undefined) {
      return;
    }

    return usePlayerStore.subscribe((state, prevState) => {
      if (state.positionMs === prevState.positionMs) return;
      const { measuredMs, isPaused } = readLiveAudioPosition();
      if (!isPaused && state.playbackState === 'PLAYING') return;

      const targetMs = Math.round(
        Math.abs(measuredMs - prevState.positionMs) > 1 ? measuredMs : state.positionMs
      );
      if (Math.abs(targetMs - interpolatedRef.current) > 1200) {
        pendingSeekScrollRef.current = true;
      }
      interpolatedRef.current = targetMs;
      lastSampledMediaMsRef.current = targetMs;
      lastSamplePerfMsRef.current = typeof performance !== 'undefined' ? performance.now() : 0;
      lastCommittedPositionMsRef.current = targetMs;
      lastCommittedLineIdxRef.current = LyricsService.getActiveLineIndex(lyricsData, targetMs);
      setRafPositionMs(targetMs);
    });
  }, [isActive, isUnsynced, lyricsData, propCurrentPositionMs, readLiveAudioPosition]);

  // 60fps requestAnimationFrame loop reading real HTMLAudioElement currentTime
  useEffect(() => {
    if (
      !isActive ||
      isUnsynced ||
      !lyricsData?.lines ||
      lyricsData.lines.length === 0 ||
      propCurrentPositionMs !== undefined
    ) {
      return;
    }

    let timingRafId: number | null = null;

    const tick = (now: number) => {
      const { measuredMs, isPaused } = readLiveAudioPosition();

      const jumpDelta = Math.abs(measuredMs - interpolatedRef.current);
      if (jumpDelta > 600) {
        // Seek or track jump occurred: snap cleanly without drift
        interpolatedRef.current = measuredMs;
        lastSampledMediaMsRef.current = measuredMs;
        lastSamplePerfMsRef.current = now;
        if (jumpDelta > 1200) {
          pendingSeekScrollRef.current = true;
        }
      } else if (Math.abs(measuredMs - lastSampledMediaMsRef.current) >= 1) {
        // Fresh currentTime tick from audio element
        lastSampledMediaMsRef.current = measuredMs;
        lastSamplePerfMsRef.current = now;
        interpolatedRef.current = measuredMs;
      } else if (!isPaused && lastSamplePerfMsRef.current > 0) {
        // Interpolate smoothly between currentTime ticks, clamping forward drift <= 120ms
        const driftMs = Math.min(120, Math.max(0, now - lastSamplePerfMsRef.current));
        interpolatedRef.current = lastSampledMediaMsRef.current + driftMs;
      } else {
        interpolatedRef.current = measuredMs;
      }

      const currentMs = Math.round(interpolatedRef.current);
      const nextLineIndex = LyricsService.getActiveLineIndex(lyricsData, currentMs);
      const activeLine = nextLineIndex >= 0 ? lyricsData.lines[nextLineIndex] : null;

      let nextSyllableIndex = -1;
      let hasActiveSyllables = false;
      if (activeLine?.syllables && activeLine.syllables.length > 0) {
        hasActiveSyllables = true;
        for (let i = 0; i < activeLine.syllables.length; i++) {
          const syl = activeLine.syllables[i];
          if (currentMs >= syl.startTimeMs && currentMs < syl.endTimeMs) {
            nextSyllableIndex = i;
            break;
          } else if (currentMs >= syl.endTimeMs) {
            nextSyllableIndex = i;
          }
        }
      }

      const inInstrumentalBreak = instrumentalBreaks.some(
        (b) => currentMs >= b.startTimeMs && currentMs <= b.endTimeMs
      );

      const lineChanged = nextLineIndex !== lastCommittedLineIdxRef.current;
      const syllableChanged = nextSyllableIndex !== lastCommittedSyllableIdxRef.current;
      const pausedPositionChanged = isPaused && currentMs !== lastCommittedPositionMsRef.current;
      const throttledSingingUpdate =
        !isPaused &&
        (hasActiveSyllables || inInstrumentalBreak) &&
        now - lastStateCommitPerfRef.current >= 16;

      if (
        lineChanged ||
        syllableChanged ||
        pausedPositionChanged ||
        throttledSingingUpdate ||
        jumpDelta > 600
      ) {
        lastCommittedLineIdxRef.current = nextLineIndex;
        lastCommittedSyllableIdxRef.current = nextSyllableIndex;
        lastCommittedPositionMsRef.current = currentMs;
        lastStateCommitPerfRef.current = now;
        setRafPositionMs(currentMs);
      }

      timingRafId = requestAnimationFrame(tick);
    };

    timingRafId = requestAnimationFrame(tick);
    return () => {
      if (timingRafId !== null) {
        cancelAnimationFrame(timingRafId);
      }
    };
  }, [isActive, isUnsynced, lyricsData, propCurrentPositionMs, instrumentalBreaks, readLiveAudioPosition]);

  // Active line index via binary search (bypassed if unsynced)
  const activeLineIndex = useMemo(() => {
    if (!lyricsData || !lyricsData.lines || lyricsData.lines.length === 0) return -1;
    if (isUnsynced) return -1;
    return LyricsService.getActiveLineIndex(lyricsData, currentPositionMs);
  }, [lyricsData, currentPositionMs, isUnsynced]);

  // Keep ref up to date
  useEffect(() => {
    activeLineIndexRef.current = activeLineIndex;
  }, [activeLineIndex]);

  // Analytical Harmonic Oscillator Spring Smooth Scroll to active line
  const scrollToActiveLine = useCallback((targetIndex: number, isSeek = false) => {
    if (isUserScrolledRef.current || isUnsynced || targetIndex < 0) return;
    const container = containerRef.current;
    if (!container) return;

    const lineElem = container.querySelector(`#lyric-line-${targetIndex}`) as HTMLElement;
    if (!lineElem) return;

    const containerHeight = container.clientHeight;
    const containerRect = container.getBoundingClientRect();
    const lineRect = lineElem.getBoundingClientRect();

    const currentRelativeTop = lineRect.top - containerRect.top + container.scrollTop;
    const lineHeight = lineRect.height || lineElem.clientHeight;

    // Apple Music centers active line around 42-45% of viewport
    const maxScrollTop =
      container.scrollHeight > containerHeight
        ? container.scrollHeight - containerHeight
        : Number.POSITIVE_INFINITY;
    const targetScrollTop = Math.max(
      0,
      Math.min(maxScrollTop, currentRelativeTop - containerHeight * 0.42 + lineHeight / 2)
    );

    isProgrammaticScrollRef.current = true;
    if (programmaticScrollTimeoutRef.current) {
      clearTimeout(programmaticScrollTimeoutRef.current);
      programmaticScrollTimeoutRef.current = null;
    }

    // Fallback only if requestAnimationFrame is unavailable in headless mocks
    if (typeof container.scrollTo === 'function' && typeof requestAnimationFrame === 'undefined') {
      container.scrollTo({ top: targetScrollTop });
      programmaticScrollTimeoutRef.current = setTimeout(() => {
        programmaticScrollTimeoutRef.current = null;
        isProgrammaticScrollRef.current = false;
      }, 120);
      return;
    }

    // Run harmonic oscillator spring loop exclusively (no conflicting CSS/DOM smooth scroll)
    const curLine = lyricsData?.lines[targetIndex];
    const nextLine = lyricsData?.lines[targetIndex + 1];
    const intervalMs = curLine && nextLine ? nextLine.startTimeMs - curLine.startTimeMs : undefined;

    const scroller = springScrollerRef.current;
    if (rafIdRef.current === null) {
      scroller.reset(container.scrollTop);
    }
    scroller.setTarget(targetScrollTop, intervalMs, isSeek);

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    let lastTime = performance.now();
    const animateSpring = (now: number) => {
      if (isUserScrolledRef.current || !containerRef.current) {
        rafIdRef.current = null;
        return;
      }
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      isProgrammaticScrollRef.current = true;
      const res = scroller.step(dt);
      containerRef.current.scrollTop = res.position;

      if (!res.isSettled) {
        rafIdRef.current = requestAnimationFrame(animateSpring);
      } else {
        rafIdRef.current = null;
        if (programmaticScrollTimeoutRef.current) {
          clearTimeout(programmaticScrollTimeoutRef.current);
        }
        programmaticScrollTimeoutRef.current = setTimeout(() => {
          programmaticScrollTimeoutRef.current = null;
          isProgrammaticScrollRef.current = false;
        }, 120);
      }
    };

    rafIdRef.current = requestAnimationFrame(animateSpring);
  }, [isUnsynced, lyricsData]);

  // Listen for native DOM 'scrollend' (never clear mid-flight while spring rAF is running)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScrollEnd = () => {
      if (rafIdRef.current !== null) return;
      if (programmaticScrollTimeoutRef.current) {
        clearTimeout(programmaticScrollTimeoutRef.current);
      }
      programmaticScrollTimeoutRef.current = setTimeout(() => {
        programmaticScrollTimeoutRef.current = null;
        isProgrammaticScrollRef.current = false;
      }, 120);
    };

    container.addEventListener('scrollend', handleScrollEnd);
    return () => {
      container.removeEventListener('scrollend', handleScrollEnd);
      if (programmaticScrollTimeoutRef.current) {
        clearTimeout(programmaticScrollTimeoutRef.current);
        programmaticScrollTimeoutRef.current = null;
      }
      if (detentionTimerRef.current) {
        clearTimeout(detentionTimerRef.current);
        detentionTimerRef.current = null;
      }
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [isLoading, lyricsData]);

  // Programmatic smooth auto-scroll to center active line
  useEffect(() => {
    if (isUserScrolled || isUnsynced || activeLineIndex < 0) return;
    const isSeek = pendingSeekScrollRef.current;
    pendingSeekScrollRef.current = false;
    scrollToActiveLine(activeLineIndex, isSeek);
  }, [activeLineIndex, isUserScrolled, isUnsynced, scrollToActiveLine]);

  // Shared 3.0s user scroll detention timer before snapping back to active line
  const armUserScrollDetention = useCallback(() => {
    isUserScrolledRef.current = true;
    setIsUserScrolled(true);

    if (detentionTimerRef.current) {
      clearTimeout(detentionTimerRef.current);
    }
    detentionTimerRef.current = setTimeout(() => {
      detentionTimerRef.current = null;
      isUserScrolledRef.current = false;
      setIsUserScrolled(false);
      if (activeLineIndexRef.current >= 0) {
        scrollToActiveLine(activeLineIndexRef.current);
      }
    }, 3000);
  }, [scrollToActiveLine]);

  // Physical user gesture detection (wheel, touch)
  const handleUserGesture = () => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    isProgrammaticScrollRef.current = false;
    if (programmaticScrollTimeoutRef.current) {
      clearTimeout(programmaticScrollTimeoutRef.current);
      programmaticScrollTimeoutRef.current = null;
    }
    armUserScrollDetention();
  };

  // Scroll event handler: suppresses programmatic scroll, handles manual scrollbar drags
  const handleScroll = () => {
    if (isProgrammaticScrollRef.current || rafIdRef.current !== null) return;

    armUserScrollDetention();
  };

  const handleResumeSync = () => {
    if (detentionTimerRef.current) {
      clearTimeout(detentionTimerRef.current);
      detentionTimerRef.current = null;
    }
    isUserScrolledRef.current = false;
    setIsUserScrolled(false);
    if (activeLineIndexRef.current >= 0) {
      scrollToActiveLine(activeLineIndexRef.current);
    }
  };

  const handleLineSeek = useCallback((ms: number, lineIdx?: number) => {
    if (detentionTimerRef.current) {
      clearTimeout(detentionTimerRef.current);
      detentionTimerRef.current = null;
    }
    isUserScrolledRef.current = false;
    setIsUserScrolled(false);
    pendingSeekScrollRef.current = true;

    let visualMs = ms;
    if (
      typeof lineIdx === 'number' &&
      lyricsData?.lines?.[lineIdx] &&
      LyricsService.getActiveLineIndex(lyricsData, ms) !== lineIdx
    ) {
      const clickedLine = lyricsData.lines[lineIdx];
      if (clickedLine.endTimeMs > ms + 1) {
        visualMs = ms + 1;
      }
    }

    interpolatedRef.current = visualMs;
    lastSampledMediaMsRef.current = visualMs;
    lastSamplePerfMsRef.current = typeof performance !== 'undefined' ? performance.now() : 0;
    if (typeof lineIdx === 'number') {
      lastCommittedLineIdxRef.current = lineIdx;
    }
    lastCommittedSyllableIdxRef.current = -2;
    lastCommittedPositionMsRef.current = visualMs;
    if (propCurrentPositionMs === undefined) {
      setRafPositionMs(visualMs);
    }
    if (typeof lineIdx === 'number' && lineIdx >= 0) {
      scrollToActiveLine(lineIdx, true);
    }
    onSeek(ms);
  }, [lyricsData, onSeek, propCurrentPositionMs, scrollToActiveLine]);

  if (isLoading) {
    return (
      <div className={`flex flex-col items-center justify-center p-8 space-y-4 ${className}`}>
        <div className="w-8 h-8 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
        <p className="text-xs text-[var(--color-on-surface-variant)] animate-pulse">
          Fetching synchronized lyrics...
        </p>
      </div>
    );
  }

  if (!lyricsData || !lyricsData.lines || lyricsData.lines.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center p-8 text-center space-y-3 ${className}`}>
        <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center text-[var(--color-on-surface-variant)]">
          <Languages size={24} />
        </div>
        <p className="text-sm font-semibold text-white/80">No synchronized lyrics available for this track</p>
        <p className="text-xs text-[var(--color-on-surface-variant)] max-w-xs">
          Synced lyrics couldn't be found for this track. Enjoy the instrumental!
        </p>
      </div>
    );
  }

  return (
    <div className={`relative flex flex-col h-full overflow-x-hidden select-none ${className}`}>
      {/* Top Floating Control Bar: Plain Lyrics indicator + Romanization/Translation toggles */}
      {(isUnsynced || hasRomanization || hasTranslation) && (
        <div className="flex items-center justify-between gap-2 px-6 py-2.5 shrink-0 z-10 border-b border-white/5 bg-transparent">
          <div>
            {isUnsynced && (
              <span
                data-testid="plain-lyrics-badge"
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-white/10 border border-white/15 text-white/80"
              >
                Plain Lyrics · Unsynced
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {hasRomanization && (
              <button
                onClick={() => setManualRomanization(!showRomanization)}
                title="Toggle Romanization (Pronunciation)"
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                  showRomanization
                    ? 'bg-white/15 text-white shadow-sm border border-white/20'
                    : 'text-[var(--color-on-surface-variant)] hover:text-[var(--color-primary)]'
                }`}
              >
                <Languages size={13} />
                <span>Rom</span>
              </button>
            )}

            {hasTranslation && (
              <button
                onClick={() => setManualTranslation(!showTranslation)}
                title="Toggle English Translation"
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                  showTranslation
                    ? 'bg-white/15 text-[var(--color-accent)] shadow-sm border border-white/20'
                    : 'text-[var(--color-on-surface-variant)] hover:text-[var(--color-primary)]'
                }`}
              >
                <Globe size={13} />
                <span>Trans</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Lyrics Scroll Area (driven exclusively by SpringScroller rAF) */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        onWheel={handleUserGesture}
        onTouchMove={handleUserGesture}
        className="no-scrollbar relative flex-1 overflow-y-auto overflow-x-hidden px-6 py-24 space-y-7"
      >
        {/* Intro instrumental break */}
        {instrumentalBreaks.some((b) => b.afterIndex === -1) && (
          <InstrumentalDotsRow
            startTimeMs={0}
            endTimeMs={lyricsData.lines[0].startTimeMs}
            currentPositionMs={currentPositionMs}
            onSeek={handleLineSeek}
            fontSize={fontSize}
            className={effectiveAlignment === 'center' ? 'justify-center' : ''}
          />
        )}

        {lyricsData.lines.map((line: LyricLine, lIndex: number) => {
          const isActiveLine = !isUnsynced && lIndex === activeLineIndex;
          const isPassedLine = !isUnsynced && lIndex < activeLineIndex;
          const canSeek = !isUnsynced && line.startTimeMs >= 0;
          const clampedDistance = !isUnsynced && activeLineIndex >= 0
            ? Math.min(3, Math.abs(lIndex - activeLineIndex))
            : 1;

          const breakAfter = instrumentalBreaks.find((b) => b.afterIndex === lIndex);

          return (
            <React.Fragment key={lIndex}>
              <LyricLineRow
                line={line}
                lIndex={lIndex}
                isActiveLine={isActiveLine}
                clampedDistance={clampedDistance}
                isUserScrolled={isUserScrolled}
                isPassedLine={isPassedLine}
                isUnsynced={isUnsynced}
                currentPositionMs={currentPositionMs}
                fontSize={fontSize}
                alignment={effectiveAlignment}
                canSeek={canSeek}
                onSeek={handleLineSeek}
                showRomanization={hasRomanization && showRomanization}
                showTranslation={hasTranslation && showTranslation}
              />

              {/* Mid-song instrumental break */}
              {breakAfter && (
                <InstrumentalDotsRow
                  startTimeMs={breakAfter.startTimeMs}
                  endTimeMs={breakAfter.endTimeMs}
                  currentPositionMs={currentPositionMs}
                  onSeek={handleLineSeek}
                  fontSize={fontSize}
                  className={effectiveAlignment === 'center' ? 'justify-center' : ''}
                />
              )}
            </React.Fragment>
          );
        })}

        {/* Source attribution footer */}
        {lyricsData.sourceAttribution && (
          <p
            className={`text-[11px] text-white/35 italic pt-6 border-t border-white/5 select-text ${
              effectiveAlignment === 'center' ? 'text-center' : ''
            }`}
          >
            {lyricsData.sourceAttribution}
          </p>
        )}
      </div>

      {/* Floating "Sync with playback" Pill when user has manually scrolled */}
      {isUserScrolled && !isUnsynced && (
        <div className={`absolute ${bottomOffsetClass} left-1/2 -translate-x-1/2 z-20 animate-in fade-in zoom-in-95 duration-200`}>
          <button
            type="button"
            onClick={handleResumeSync}
            style={syncTheme.style}
            className="flex items-center gap-2 hover:brightness-110 active:scale-95 transition-all cursor-pointer"
          >
            {syncTheme.showDot && (
              <span
                style={{
                  backgroundColor: syncTheme.dotColor,
                  boxShadow: `0 0 10px ${syncTheme.dotColor}`,
                }}
                className="w-2 h-2 rounded-full shrink-0"
              />
            )}
            <ArrowDownCircle size={15} style={{ color: syncTheme.accentColor }} />
            <span>Sync with playback</span>
          </button>
        </div>
      )}
    </div>
  );
});

SyllableLyricsEngine.displayName = 'SyllableLyricsEngine';
