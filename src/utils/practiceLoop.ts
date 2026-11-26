// src/utils/practiceLoop.ts
// Pure helpers for beat/bar derivation, bar-snapped A-B looping, and pitch-preserving speed clamping.

export const MIN_PRACTICE_SPEED = 0.5;
export const MAX_PRACTICE_SPEED = 1.5;

export function clampPlaybackRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1.0;
  const clamped = Math.max(MIN_PRACTICE_SPEED, Math.min(MAX_PRACTICE_SPEED, rate));
  return Math.round(clamped * 100) / 100;
}

export function deriveBarsFromBeatAnalysis(
  beats: readonly number[] = [],
  downbeats: readonly number[] = []
): number[] {
  if (Array.isArray(downbeats) && downbeats.length > 0) {
    return downbeats.filter((t) => Number.isFinite(t) && t >= 0);
  }
  if (!Array.isArray(beats) || beats.length === 0) return [];
  const bars: number[] = [];
  for (let i = 0; i < beats.length; i += 4) {
    const t = beats[i];
    if (Number.isFinite(t) && t >= 0) bars.push(t);
  }
  return bars;
}

export function snapLoopToBars(
  currentSec: number,
  barCount: number,
  downbeats: readonly number[] = [],
  beats: readonly number[] = [],
  bpm = 120,
  durationSec = 0
): { startMs: number; endMs: number } {
  const safeCurrentSec = Math.max(0, Number.isFinite(currentSec) ? currentSec : 0);
  const safeBars = Math.max(1, Math.min(64, Math.round(Number.isFinite(barCount) ? barCount : 4)));
  const safeBpm = Number.isFinite(bpm) && bpm >= 40 && bpm <= 260 ? bpm : 120;
  const approxBarSec = (4 * 60) / safeBpm;
  const barGrid = deriveBarsFromBeatAnalysis(beats, downbeats);

  let startSec = safeCurrentSec;
  let endSec = safeCurrentSec + safeBars * approxBarSec;

  if (barGrid.length > 0) {
    let bestIdx = 0;
    for (let i = 0; i < barGrid.length; i++) {
      if (barGrid[i] <= safeCurrentSec + 0.18) {
        bestIdx = i;
      } else {
        break;
      }
    }
    startSec = barGrid[bestIdx];
    const targetEndIdx = bestIdx + safeBars;
    if (targetEndIdx < barGrid.length) {
      endSec = barGrid[targetEndIdx];
    } else {
      const avgBarDur =
        barGrid.length >= 2
          ? Math.max(0.5, (barGrid[barGrid.length - 1] - barGrid[0]) / (barGrid.length - 1))
          : approxBarSec;
      endSec = startSec + safeBars * avgBarDur;
    }
  } else {
    const snappedBarIdx = Math.max(0, Math.floor((safeCurrentSec + 0.12) / approxBarSec));
    startSec = snappedBarIdx * approxBarSec;
    endSec = startSec + safeBars * approxBarSec;
  }

  if (Number.isFinite(durationSec) && durationSec > 0.5) {
    startSec = Math.min(startSec, Math.max(0, durationSec - 0.5));
    endSec = Math.min(durationSec, Math.max(startSec + 0.25, endSec));
  } else {
    endSec = Math.max(startSec + 0.25, endSec);
  }

  return {
    startMs: Math.round(startSec * 1000),
    endMs: Math.round(endSec * 1000),
  };
}
