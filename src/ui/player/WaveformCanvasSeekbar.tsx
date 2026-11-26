// src/ui/player/WaveformCanvasSeekbar.tsx
// 68-Bar interactive canvas seekbar with exact reverse-engineered geometry (66% crest / 34% trough)
// Decoupled 60fps/120fps continuous RAF loop, sub-pixel playhead interpolation, and crisp high-DPI scaling

import React, { useRef, useEffect, useState, useMemo } from 'react';
import type { AudioEngine } from '../../audio/AudioEngine';
import { usePlayerStore } from '../../state/playerStore';

export interface WaveformCanvasSeekbarProps {
  amplitudes: Float32Array | null; // 200 raw buckets or 68 bars
  currentPositionMs?: number;      // Authoritative position from parent
  durationMs: number;
  isPlaying: boolean;
  onSeek: (positionMs: number) => void;
  audioEngine?: AudioEngine | null;
  getPositionMs?: () => number;
  liveBands?: Float32Array | null; // 32 bands
  liveRms?: number;
  liveBass?: number;
  liveMid?: number;
  liveHigh?: number;
  transitionWindow?: [number, number];
  abLoop?: {
    startMs: number | null;
    endMs: number | null;
    active: boolean;
  };
  barTimestampsSec?: readonly number[];
  onChangeAbLoop?: (startMs: number | null, endMs: number | null) => void;
  height?: number;
  className?: string;
}

// 65% Peak + 35% RMS resampling algorithm from 200 to 68 bars (Survey 2 §6.2)
export function resampleTo68Bars(buckets200: Float32Array | null): Float32Array {
  const targetBars = 68;
  const out = new Float32Array(targetBars);
  if (!buckets200 || buckets200.length === 0) {
    for (let i = 0; i < targetBars; i++) {
      const x = i / targetBars;
      out[i] = 0.22 + 0.45 * Math.abs(Math.sin(x * Math.PI * 4) + 0.3 * Math.cos(x * Math.PI * 8));
    }
    return out;
  }

  if (buckets200.length === targetBars) {
    return new Float32Array(buckets200);
  }

  const srcSize = buckets200.length;
  const pooled = new Float32Array(targetBars);

  for (let i = 0; i < targetBars; i++) {
    const startIdx = Math.min(Math.floor((i / targetBars) * srcSize), srcSize - 1);
    const endIdx = Math.min(Math.max(Math.floor(((i + 1) / targetBars) * srcSize), startIdx + 1), srcSize);

    let peak = 0;
    let sumSq = 0;
    const count = endIdx - startIdx;

    for (let j = startIdx; j < endIdx; j++) {
      const v = Math.abs(buckets200[j]);
      if (v > peak) peak = v;
      sumSq += v * v;
    }

    const rms = count > 0 ? Math.sqrt(sumSq / count) : peak;
    pooled[i] = 0.65 * peak + 0.35 * rms;
  }

  let maxVal = 0;
  for (let i = 0; i < targetBars; i++) {
    if (pooled[i] > maxVal) maxVal = pooled[i];
  }

  if (maxVal > 0.001) {
    const invMax = 1.0 / maxVal;
    for (let i = 0; i < targetBars; i++) {
      const norm = Math.max(0, Math.min(1.0, pooled[i] * invMax));
      out[i] = 0.14 + 0.61 * norm;
    }
  } else {
    out.fill(0.18);
  }

  return out;
}

function formatTime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function resolveEffectiveDurationMs(
  durationMs: number,
  propEngine?: AudioEngine | null
): number {
  const engine = propEngine ?? usePlayerStore.getState().audioEngine;
  const engineDur =
    engine && typeof engine.getCurrentDurationMs === 'function'
      ? engine.getCurrentDurationMs() || 0
      : 0;
  return Math.max(durationMs || 0, engineDur);
}

export const WaveformCanvasSeekbar: React.FC<WaveformCanvasSeekbarProps> = React.memo(({
  amplitudes,
  currentPositionMs = 0,
  durationMs,
  isPlaying,
  onSeek,
  audioEngine,
  getPositionMs,
  liveBands,
  liveRms = 0,
  liveBass = 0,
  liveMid = 0,
  liveHigh = 0,
  transitionWindow,
  abLoop,
  barTimestampsSec,
  onChangeAbLoop,
  height = 36,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // High-performance mutable interaction state held in ref (avoids React re-renders during drag)
  const interactionRef = useRef({
    isHovered: false,
    isDragging: false,
    scrubPositionMs: null as number | null,
    hoverX: 0,
    hasMoved: false,
  });

  // Hover tooltip state for UI display only
  const [tooltipState, setTooltipState] = useState<{ visible: boolean; x: number; timeMs: number } | null>(null);

  // High-precision playhead clock state
  const clockRef = useRef({
    basePositionMs: currentPositionMs,
    baseTimestamp: performance.now(),
    interpolatedMs: currentPositionMs,
    optimisticSeekMs: null as number | null,
    optimisticSeekTime: 0,
  });

  // Cached layout dimensions
  const layoutRef = useRef({
    width: 600,
    height: height,
    dpr: (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1,
  });

  // Resampled 68 bars (memoized on amplitudes change only)
  const bars68 = useMemo(() => resampleTo68Bars(amplitudes), [amplitudes]);

  // Synchronize mutable props into refs for the persistent RAF loop
  const propsRef = useRef({
    bars68,
    durationMs,
    isPlaying,
    onSeek,
    audioEngine,
    getPositionMs,
    liveBands,
    liveRms,
    liveBass,
    liveMid,
    liveHigh,
    transitionWindow,
    abLoop,
    barTimestampsSec,
    onChangeAbLoop,
    height,
  });

  propsRef.current = {
    bars68,
    durationMs,
    isPlaying,
    onSeek,
    audioEngine,
    getPositionMs,
    liveBands,
    liveRms,
    liveBass,
    liveMid,
    liveHigh,
    transitionWindow,
    abLoop,
    barTimestampsSec,
    onChangeAbLoop,
    height,
  };

  // Synchronize external currentPositionMs prop updates into clockRef
  useEffect(() => {
    const clock = clockRef.current;
    const now = performance.now();

    // If an optimistic seek is active (< 250ms), ignore stale external positions
    if (clock.optimisticSeekMs !== null) {
      if (now - clock.optimisticSeekTime < 250 && Math.abs(currentPositionMs - clock.optimisticSeekMs) > 150) {
        return;
      }
      clock.optimisticSeekMs = null;
    }

    const drift = currentPositionMs - clock.interpolatedMs;
    if (Math.abs(drift) > 150 || drift < -40) {
      // Hard snap on large seek / jump
      clock.basePositionMs = currentPositionMs;
      clock.baseTimestamp = now;
      clock.interpolatedMs = currentPositionMs;
    } else {
      // Soft drift alignment
      clock.basePositionMs = currentPositionMs;
      clock.baseTimestamp = now;
    }
  }, [currentPositionMs]);

  // Track container sizing via ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateDimensions = () => {
      const rect = container.getBoundingClientRect();
      layoutRef.current = {
        width: rect.width > 0 ? rect.width : 600,
        height: height,
        dpr: (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1,
      };
    };

    updateDimensions();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        updateDimensions();
      });
      observer.observe(container);
      return () => observer.disconnect();
    }
  }, [height]);

  // Compute dynamic amplitude with live PCM modulation and soft-knee headroom limiter
  const computeDynamicAmp = (
    baseAmp: number,
    index: number,
    totalBars: number,
    progress: number,
    phase: number,
    pulse: number,
    p: typeof propsRef.current
  ): number => {
    if (pulse <= 0.01) return baseAmp;

    const normIndex = index / Math.max(1, totalBars - 1);
    const playheadFocus = 1.0 - Math.min(1.0, Math.max(0.0, Math.abs(normIndex - progress) / 0.22));

    // Spectral mix from live PCM bands
    let spectralMix = 0;
    if (Math.abs(normIndex - progress) < 0.14) {
      spectralMix = 0.5 * (p.liveBass || 0) + 0.35 * (p.liveMid || 0) + 0.15 * (p.liveRms || 0);
    } else if (index % 3 === 0) {
      spectralMix = 0.75 * (p.liveBass || 0) + 0.2 * (p.liveRms || 0);
    } else if (index % 3 === 1) {
      spectralMix = 0.75 * (p.liveMid || 0) + 0.2 * (p.liveRms || 0);
    } else {
      spectralMix = 0.8 * (p.liveHigh || 0) + 0.2 * (p.liveMid || 0);
    }

    const bandEnergy = p.liveBands && index < p.liveBands.length ? p.liveBands[index % p.liveBands.length] : 0;
    const rawBounce =
      (0.45 * bandEnergy + 0.35 * spectralMix + 0.05 * Math.sin(phase * 2 + index * 0.07)) *
        (1 + 0.25 * playheadFocus) -
      0.12;

    const modulation = Math.max(-0.3, Math.min(0.45, 0.45 * rawBounce * pulse + 0.2 * (bandEnergy - 0.22) * pulse));
    const modAmp = baseAmp * (1 + 0.55 * modulation) + 0.08 * rawBounce * pulse;

    if (modAmp <= 0.8) {
      return Math.max(0.08, modAmp);
    }
    const excess = (modAmp - 0.8) / 0.25;
    return 0.8 + 0.15 * (excess / (1 + excess));
  };

  // Continuous Isolated RAF Render Loop (Mounted ONCE on component lifecycle)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let isRunning = true;
    let animPhase = 0;
    let playPulse = propsRef.current.isPlaying ? 1.0 : 0.0;
    let rafId: number | null = null;

    const render = () => {
      if (!isRunning) return;

      const p = propsRef.current;
      const interaction = interactionRef.current;
      const clock = clockRef.current;
      const now = performance.now();

      // 1. High-DPI Canvas Buffer Geometry Sync
      const currentDpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
      const width = layoutRef.current.width;
      const h = p.height || 36;
      const physicalWidth = Math.max(1, Math.round(width * currentDpr));
      const physicalHeight = Math.max(1, Math.round(h * currentDpr));

      if (canvas.width !== physicalWidth || canvas.height !== physicalHeight) {
        canvas.width = physicalWidth;
        canvas.height = physicalHeight;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${h}px`;
      }

      ctx.save();
      // Exact physical pixel scaling matrix (eliminates fractional 1px blur)
      ctx.scale(physicalWidth / width, physicalHeight / h);
      ctx.clearRect(0, 0, width, h);

      // 2. Play Pulse and Animation Phase Updates
      const targetPulse = p.isPlaying ? 1.0 : 0.0;
      playPulse += (targetPulse - playPulse) * 0.12;
      animPhase += 0.035;

      // 3. Sub-Pixel Playhead Position Resolution
      let activeMs: number;
      const effectiveDurationMs = resolveEffectiveDurationMs(p.durationMs, p.audioEngine);
      const safeDuration = effectiveDurationMs > 0 ? effectiveDurationMs : 1;
      const liveEngine = p.audioEngine ?? usePlayerStore.getState().audioEngine;

      if (interaction.isDragging && interaction.scrubPositionMs !== null) {
        // Zero-latency drag tracking
        activeMs = interaction.scrubPositionMs;
        clock.basePositionMs = activeMs;
        clock.baseTimestamp = now;
        clock.interpolatedMs = activeMs;
        clock.optimisticSeekMs = null;
      } else {
        // Sample real-time AudioEngine accessor if available
        let authoritativePos: number | null = null;
        if (p.getPositionMs) {
          authoritativePos = p.getPositionMs();
        } else if (liveEngine) {
          authoritativePos = liveEngine.getCurrentPositionMs();
        }

        if (authoritativePos !== null && authoritativePos >= 0) {
          // Check optimistic seek latch (ignore old pre-seek positions for 250ms)
          if (clock.optimisticSeekMs !== null) {
            if (now - clock.optimisticSeekTime < 250 && Math.abs(authoritativePos - clock.optimisticSeekMs) > 150) {
              authoritativePos = clock.optimisticSeekMs;
            } else {
              clock.optimisticSeekMs = null;
            }
          }

          const engineDrift = authoritativePos - clock.interpolatedMs;
          if (Math.abs(engineDrift) > 150 || engineDrift < -40) {
            clock.basePositionMs = authoritativePos;
            clock.baseTimestamp = now;
            clock.interpolatedMs = authoritativePos;
          } else {
            clock.basePositionMs = authoritativePos;
            clock.baseTimestamp = now;
          }
        }

        // Sub-pixel continuous extrapolation
        const isEngineSeeking = Boolean((liveEngine as any)?.isSeeking?.());
        if (p.isPlaying && !isEngineSeeking) {
          const dt = Math.max(0, now - clock.baseTimestamp);
          const targetMs = Math.min(safeDuration, clock.basePositionMs + dt);
          clock.interpolatedMs += (targetMs - clock.interpolatedMs) * 0.22;
        } else {
          clock.interpolatedMs = clock.basePositionMs;
        }

        activeMs = Math.max(0, Math.min(safeDuration, clock.interpolatedMs));
      }

      const progress = Math.max(0, Math.min(1.0, activeMs / safeDuration));

      // 4. Bar Geometry Calculations (66% Crest / 34% Trough)
      const totalBars = 68;
      const gap = 1.35;
      const barWidth = Math.max(1.5, (width - (totalBars - 1) * gap) / totalBars);
      const cornerRadius = barWidth / 2;

      const axisY = h * 0.56;
      const upperShare = 0.66;
      const maxBarH = interaction.isDragging || interaction.isHovered ? 28 : 22;

      const playheadX = progress * width;
      const effectivePlayheadBar = progress * totalBars;

      // 4B. Subtle neural bar ticks along bottom baseline
      if (p.barTimestampsSec && p.barTimestampsSec.length > 0 && effectiveDurationMs > 0) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.24)';
        const durSec = effectiveDurationMs / 1000;
        for (let bIdx = 0; bIdx < p.barTimestampsSec.length; bIdx++) {
          const barSec = p.barTimestampsSec[bIdx];
          if (barSec <= 0 || barSec >= durSec) continue;
          const bx = (barSec / durSec) * width;
          ctx.fillRect(bx - 0.5, h - 4, 1, 3.5);
        }
      }

      // 4C. Glowing Practice A-B Loop Region
      const loopA = p.abLoop?.startMs;
      const loopB = p.abLoop?.endMs;
      const hasLoopA = typeof loopA === 'number' && Number.isFinite(loopA) && effectiveDurationMs > 0;
      const hasLoopB = typeof loopB === 'number' && Number.isFinite(loopB) && effectiveDurationMs > 0;
      if (hasLoopA && hasLoopB && loopB > loopA) {
        const ax = Math.max(0, Math.min(width, (loopA / effectiveDurationMs) * width));
        const bx = Math.max(ax, Math.min(width, (loopB / effectiveDurationMs) * width));
        ctx.fillStyle = p.abLoop?.active
          ? 'rgba(56, 189, 248, 0.20)'
          : 'rgba(255, 255, 255, 0.10)';
        ctx.fillRect(ax, 2, Math.max(2, bx - ax), h - 4);
      }

      // 5. Draw 68 Waveform Bars
      for (let i = 0; i < totalBars; i++) {
        const barLeft = i * (barWidth + gap);
        const dynamicAmp = computeDynamicAmp(
          p.bars68[i],
          i,
          totalBars,
          progress,
          animPhase,
          playPulse,
          p
        );
        const barH = Math.max(barWidth * 1.15, Math.min(h - 6, dynamicAmp * maxBarH));
        const barTop = axisY - barH * upperShare;

        // Played vs Unplayed Bar Styling
        let barColor = 'rgba(255, 255, 255, 0.26)';
        if (i < Math.floor(effectivePlayheadBar)) {
          barColor = '#FA2D48'; // Apple Music Accent Red
        } else if (i === Math.floor(effectivePlayheadBar)) {
          barColor = '#FA2D48';
        } else if (
          p.transitionWindow &&
          i / totalBars >= p.transitionWindow[0] &&
          i / totalBars <= p.transitionWindow[1]
        ) {
          barColor = 'rgba(255, 255, 255, 0.55)';
        }

        ctx.fillStyle = barColor;
        ctx.beginPath();
        ctx.roundRect(barLeft, barTop, barWidth, barH, cornerRadius);
        ctx.fill();
      }

      // 6. Liquid Glass Specular Glow Playhead
      const glowRadius = interaction.isDragging ? 24 : 15;
      const glowAlpha = interaction.isDragging ? 0.45 : 0.22 + 0.1 * playPulse * (p.liveRms || 0);

      const radialGlow = ctx.createRadialGradient(
        playheadX,
        axisY - 2,
        0,
        playheadX,
        axisY - 2,
        glowRadius
      );
      radialGlow.addColorStop(0, `rgba(255, 255, 255, ${glowAlpha})`);
      radialGlow.addColorStop(0.4, `rgba(250, 45, 72, ${glowAlpha * 0.4})`);
      radialGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');

      ctx.fillStyle = radialGlow;
      ctx.beginPath();
      ctx.arc(playheadX, axisY - 2, glowRadius, 0, Math.PI * 2);
      ctx.fill();

      // 7. Specular Playhead Capsule Core with High-DPI Glass Rim
      const pillWidth = interaction.isDragging ? Math.max(3.5, barWidth * 1.5) : Math.max(2.5, barWidth * 1.15);
      const pillHeight = Math.min(h - 4, maxBarH + (interaction.isDragging ? 5 : 2));
      const pillLeft = playheadX - pillWidth / 2;
      const pillTop = Math.max(2, axisY - pillHeight * upperShare);

      const verticalGrad = ctx.createLinearGradient(0, pillTop, 0, pillTop + pillHeight);
      verticalGrad.addColorStop(
        0,
        interaction.isDragging ? 'rgba(255, 255, 255, 0.98)' : 'rgba(255, 255, 255, 0.92)'
      );
      verticalGrad.addColorStop(
        1,
        interaction.isDragging ? 'rgba(255, 255, 255, 0.72)' : 'rgba(255, 255, 255, 0.56)'
      );

      ctx.fillStyle = verticalGrad;
      ctx.beginPath();
      ctx.roundRect(pillLeft, pillTop, pillWidth, pillHeight, pillWidth / 2);
      ctx.fill();

      // Outer specular rim stroke
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // 8. Draggable Glowing A / B Loop Handles
      if (hasLoopA) {
        const ax = Math.max(2, Math.min(width - 2, ((loopA as number) / effectiveDurationMs) * width));
        ctx.save();
        ctx.strokeStyle = p.abLoop?.active ? '#38bdf8' : 'rgba(186, 230, 253, 0.78)';
        ctx.lineWidth = 2;
        ctx.shadowColor = p.abLoop?.active ? 'rgba(56, 189, 248, 0.85)' : 'rgba(56, 189, 248, 0.35)';
        ctx.shadowBlur = 7;
        ctx.beginPath();
        ctx.moveTo(ax, 2);
        ctx.lineTo(ax, h - 2);
        ctx.stroke();
        ctx.fillStyle = p.abLoop?.active ? '#38bdf8' : '#7dd3fc';
        ctx.beginPath();
        ctx.roundRect(ax - 5, 1, 10, 10, 3);
        ctx.fill();
        ctx.fillStyle = '#04121d';
        ctx.font = 'bold 7.5px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('A', ax, 6.2);
        ctx.restore();
      }
      if (hasLoopB) {
        const bx = Math.max(2, Math.min(width - 2, ((loopB as number) / effectiveDurationMs) * width));
        ctx.save();
        ctx.strokeStyle = p.abLoop?.active ? '#38bdf8' : 'rgba(186, 230, 253, 0.78)';
        ctx.lineWidth = 2;
        ctx.shadowColor = p.abLoop?.active ? 'rgba(56, 189, 248, 0.85)' : 'rgba(56, 189, 248, 0.35)';
        ctx.shadowBlur = 7;
        ctx.beginPath();
        ctx.moveTo(bx, 2);
        ctx.lineTo(bx, h - 2);
        ctx.stroke();
        ctx.fillStyle = p.abLoop?.active ? '#38bdf8' : '#7dd3fc';
        ctx.beginPath();
        ctx.roundRect(bx - 5, 1, 10, 10, 3);
        ctx.fill();
        ctx.fillStyle = '#04121d';
        ctx.font = 'bold 7.5px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('B', bx, 6.2);
        ctx.restore();
      }

      ctx.restore();

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);

    return () => {
      isRunning = false;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, []); // Run ONCE on mount; clean up ONCE on unmount!

  // Unified Mouse & Drag Interactions
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
      if (interactionRef.current.isDragging) {
        interactionRef.current.isDragging = false;
        interactionRef.current.scrubPositionMs = null;
        usePlayerStore.getState().setIsScrubbing(false);
      }
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!containerRef.current) return;

    dragCleanupRef.current?.();

    const rect = containerRef.current.getBoundingClientRect();
    const startX = e.clientX;
    const effectiveDuration = resolveEffectiveDurationMs(
      propsRef.current.durationMs,
      propsRef.current.audioEngine
    );
    const localStartX = startX - rect.left;
    const loopStartMs = propsRef.current.abLoop?.startMs;
    const loopEndMs = propsRef.current.abLoop?.endMs;
    let draggingHandle: 'A' | 'B' | null = null;
    if (propsRef.current.onChangeAbLoop && effectiveDuration > 0 && rect.width > 0) {
      const ax = typeof loopStartMs === 'number' ? (loopStartMs / effectiveDuration) * rect.width : null;
      const bx = typeof loopEndMs === 'number' ? (loopEndMs / effectiveDuration) * rect.width : null;
      if (ax !== null && Math.abs(localStartX - ax) <= 10) {
        draggingHandle = 'A';
      } else if (bx !== null && Math.abs(localStartX - bx) <= 10) {
        draggingHandle = 'B';
      }
    }

    const calcPositionMs = (clientX: number): number => {
      const dur = resolveEffectiveDurationMs(
        propsRef.current.durationMs,
        propsRef.current.audioEngine
      );
      const x = clientX - rect.left;
      const fraction = rect.width > 0 ? Math.max(0, Math.min(1.0, x / rect.width)) : 0;
      return Math.round(fraction * dur);
    };

    if (draggingHandle && propsRef.current.onChangeAbLoop) {
      const handleBracketMove = (moveEvent: MouseEvent) => {
        const ms = calcPositionMs(moveEvent.clientX);
        const curA = propsRef.current.abLoop?.startMs ?? 0;
        const curB = propsRef.current.abLoop?.endMs ?? effectiveDuration;
        if (draggingHandle === 'A') {
          const nextA = Math.min(ms, Math.max(0, curB - 250));
          propsRef.current.onChangeAbLoop?.(nextA, curB);
          setTooltipState({
            visible: true,
            x: Math.max(28, Math.min(rect.width - 28, moveEvent.clientX - rect.left)),
            timeMs: nextA,
          });
        } else {
          const nextB = Math.max(ms, curA + 250);
          propsRef.current.onChangeAbLoop?.(curA, nextB);
          setTooltipState({
            visible: true,
            x: Math.max(28, Math.min(rect.width - 28, moveEvent.clientX - rect.left)),
            timeMs: nextB,
          });
        }
      };
      const cleanupBracketListeners = () => {
        window.removeEventListener('mousemove', handleBracketMove);
        window.removeEventListener('mouseup', handleBracketUp);
        if (dragCleanupRef.current === cleanupBracketListeners) {
          dragCleanupRef.current = null;
        }
      };
      const handleBracketUp = () => {
        cleanupBracketListeners();
        setTooltipState(null);
      };
      dragCleanupRef.current = cleanupBracketListeners;
      window.addEventListener('mousemove', handleBracketMove);
      window.addEventListener('mouseup', handleBracketUp);
      return;
    }

    interactionRef.current.isDragging = true;
    interactionRef.current.hasMoved = false;
    usePlayerStore.getState().setIsScrubbing(true);

    const initialMs = calcPositionMs(startX);
    interactionRef.current.scrubPositionMs = initialMs;

    const handleMouseMoveWindow = (moveEvent: MouseEvent) => {
      if (Math.abs(moveEvent.clientX - startX) > 2) {
        interactionRef.current.hasMoved = true;
      }
      const ms = calcPositionMs(moveEvent.clientX);
      interactionRef.current.scrubPositionMs = ms;

      // Update hover tooltip (clamped within [28, width - 28])
      const rawX = moveEvent.clientX - rect.left;
      const x = rect.width > 56 ? Math.max(28, Math.min(rect.width - 28, rawX)) : Math.max(0, rawX);
      setTooltipState({
        visible: true,
        x,
        timeMs: ms,
      });
    };

    const cleanupDragListeners = () => {
      window.removeEventListener('mousemove', handleMouseMoveWindow);
      window.removeEventListener('mouseup', handleMouseUpWindow);
      if (dragCleanupRef.current === cleanupDragListeners) {
        dragCleanupRef.current = null;
      }
    };

    const handleMouseUpWindow = (upEvent: MouseEvent) => {
      cleanupDragListeners();

      const targetMs = calcPositionMs(upEvent.clientX);

      // Optimistic seek latch
      clockRef.current.optimisticSeekMs = targetMs;
      clockRef.current.optimisticSeekTime = performance.now();
      clockRef.current.basePositionMs = targetMs;
      clockRef.current.baseTimestamp = performance.now();
      clockRef.current.interpolatedMs = targetMs;

      interactionRef.current.isDragging = false;
      interactionRef.current.scrubPositionMs = null;
      usePlayerStore.getState().setIsScrubbing(false);

      // Dispatch single seek event
      propsRef.current.onSeek(targetMs);
    };

    dragCleanupRef.current = cleanupDragListeners;
    window.addEventListener('mousemove', handleMouseMoveWindow);
    window.addEventListener('mouseup', handleMouseUpWindow);
  };

  // Mouse wheel scrubbing (±5000ms)
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const duration = resolveEffectiveDurationMs(
      propsRef.current.durationMs,
      propsRef.current.audioEngine
    );
    const deltaMs = e.deltaY < 0 ? 5000 : -5000;
    const currentMs = clockRef.current.interpolatedMs;
    const rawTarget = currentMs + deltaMs;
    const targetMs = Math.round(
      duration > 0 ? Math.max(0, Math.min(duration, rawTarget)) : Math.max(0, rawTarget)
    );

    clockRef.current.optimisticSeekMs = targetMs;
    clockRef.current.optimisticSeekTime = performance.now();
    clockRef.current.basePositionMs = targetMs;
    clockRef.current.baseTimestamp = performance.now();
    clockRef.current.interpolatedMs = targetMs;

    propsRef.current.onSeek(targetMs);
  };

  const handleMouseMoveHover = (e: React.MouseEvent<HTMLDivElement>) => {
    if (interactionRef.current.isDragging || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const x = rect.width > 56 ? Math.max(28, Math.min(rect.width - 28, rawX)) : Math.max(0, rawX);
    const fraction = rect.width > 0 ? Math.max(0, Math.min(1.0, rawX / rect.width)) : 0;
    const effectiveDuration = resolveEffectiveDurationMs(
      propsRef.current.durationMs,
      propsRef.current.audioEngine
    );
    const timeMs = fraction * effectiveDuration;

    interactionRef.current.hoverX = x;
    setTooltipState({
      visible: true,
      x,
      timeMs,
    });
  };

  const handleMouseEnter = () => {
    interactionRef.current.isHovered = true;
  };

  const handleMouseLeave = () => {
    interactionRef.current.isHovered = false;
    if (!interactionRef.current.isDragging) {
      setTooltipState(null);
    }
  };

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMoveHover}
      onWheel={handleWheel}
      className={`relative w-full cursor-pointer select-none group flex items-center ${className}`}
      style={{ height: `${height}px` }}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ height: `${height}px` }}
      />

      {/* Hover Timestamp Tooltip */}
      {tooltipState && tooltipState.visible && (
        <div
          style={{
            transform: `translateX(${
              layoutRef.current.width > 56
                ? Math.max(28, Math.min(layoutRef.current.width - 28, tooltipState.x))
                : Math.max(0, tooltipState.x)
            }px) translateX(-50%)`,
          }}
          className="absolute -top-7 left-0 px-2 py-0.5 rounded-md bg-[var(--color-surface)] border border-[var(--color-outline)] text-[10px] font-mono text-[var(--color-primary)] shadow-lg pointer-events-none z-30"
        >
          {formatTime(tooltipState.timeMs)}
        </div>
      )}
    </div>
  );
});

WaveformCanvasSeekbar.displayName = 'WaveformCanvasSeekbar';
