// src/ui/player/InstrumentalDotsRow.tsx
// 3 pulsating beat countdown dots (• • •) for instrumental breaks >= 4.0s
// 1:1 Apple Music InstrumentalAnimationStates & InstrumentalPulseStates parity

import React, { memo } from 'react';

export interface InstrumentalDotsRowProps {
  startTimeMs: number;
  endTimeMs: number;
  currentPositionMs: number;
  onSeek?: (positionMs: number) => void;
  className?: string;
  fontSize?: number;
}

export const InstrumentalDotsRow: React.FC<InstrumentalDotsRowProps> = memo(({
  startTimeMs,
  endTimeMs,
  currentPositionMs,
  onSeek,
  className = '',
  fontSize = 24,
}) => {
  const isInsideBreak = currentPositionMs >= startTimeMs && currentPositionMs <= endTimeMs;
  const remainingMs = endTimeMs - currentPositionMs;

  // Countdown activates in the final 3000ms of the instrumental break
  // Dot 1 pulses when 3000ms - 2000ms remain
  // Dot 2 pulses when 2000ms - 1000ms remain
  // Dot 3 pulses when 1000ms - 0ms remain
  const isCountdownActive = isInsideBreak && remainingMs <= 3000 && remainingMs >= 0;

  const dot1Active = isCountdownActive && remainingMs <= 3000 && remainingMs > 2000;
  const dot2Active = isCountdownActive && remainingMs <= 2000 && remainingMs > 1000;
  const dot3Active = isCountdownActive && remainingMs <= 1000;

  const getDotStyle = (isActive: boolean) => {
    if (isActive) {
      return {
        transform: 'scale(1.4)',
        opacity: 1.0,
        backgroundColor: '#FFFFFF',
        boxShadow: '0 0 14px rgba(255, 255, 255, 0.95), 0 0 24px rgba(250, 45, 72, 0.65)',
      };
    }
    if (isInsideBreak) {
      return {
        transform: 'scale(1.0)',
        opacity: 0.55,
        backgroundColor: 'rgba(255, 255, 255, 0.70)',
        boxShadow: 'none',
      };
    }
    return {
      transform: 'scale(0.9)',
      opacity: 0.25,
      backgroundColor: 'rgba(255, 255, 255, 0.40)',
      boxShadow: 'none',
    };
  };

  const dotSize = Math.max(6, Math.round(fontSize * 0.32));

  return (
    <div
      onClick={onSeek ? () => onSeek(startTimeMs) : undefined}
      className={`instrumental-dots-row flex items-center gap-3 py-3 px-2 rounded-xl transition-all duration-300 ${
        onSeek ? 'cursor-pointer hover:bg-white/5' : ''
      } ${className}`}
      title="Instrumental Break"
      role="status"
      aria-label="Instrumental break"
    >
      <div className="flex items-center gap-3.5">
        <span
          style={{
            width: `${dotSize}px`,
            height: `${dotSize}px`,
            borderRadius: '9999px',
            transition: 'transform 260ms cubic-bezier(0.2, 0.9, 0.3, 1), opacity 260ms ease, box-shadow 260ms ease',
            ...getDotStyle(dot1Active),
          }}
          className="inline-block"
        />
        <span
          style={{
            width: `${dotSize}px`,
            height: `${dotSize}px`,
            borderRadius: '9999px',
            transition: 'transform 260ms cubic-bezier(0.2, 0.9, 0.3, 1), opacity 260ms ease, box-shadow 260ms ease',
            ...getDotStyle(dot2Active),
          }}
          className="inline-block"
        />
        <span
          style={{
            width: `${dotSize}px`,
            height: `${dotSize}px`,
            borderRadius: '9999px',
            transition: 'transform 260ms cubic-bezier(0.2, 0.9, 0.3, 1), opacity 260ms ease, box-shadow 260ms ease',
            ...getDotStyle(dot3Active),
          }}
          className="inline-block"
        />
      </div>
    </div>
  );
});

InstrumentalDotsRow.displayName = 'InstrumentalDotsRow';
