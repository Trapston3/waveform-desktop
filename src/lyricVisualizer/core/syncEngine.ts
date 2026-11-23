import type { Lyrics, LyricWord, PlaybackSnapshot } from './models';

export const MIN_OFFSET_MS = -2000;
export const MAX_OFFSET_MS = 2000;
export const INSTRUMENTAL_FADE_THRESHOLD_SECONDS = 12;
export const INSTRUMENTAL_FADE_DURATION_SECONDS = 1.5;

export function clampOffsetMs(offsetMs: number): number {
  if (!Number.isFinite(offsetMs)) return 0;
  return Math.max(MIN_OFFSET_MS, Math.min(MAX_OFFSET_MS, Math.round(offsetMs)));
}

export interface SyncFrameResult {
  readonly timeSeconds: number;
  readonly activeLineIndex: number;
  readonly activeWordIndex: number;
  readonly wordProgress: number;
  readonly lineFadeAlpha: number;
  readonly didSeekThisFrame: boolean;
  readonly isInstrumentalGap: boolean;
  readonly gapProgress: number;
  readonly timeUntilNextLine: number;
  readonly hasLyrics: boolean;
  readonly lastActiveLineIndex: number;
  readonly nextLineIndex: number;
}

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function binarySearchLine(lines: Lyrics['lines'], timeSeconds: number): number {
  let low = 0;
  let high = lines.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const line = lines[mid];
    if (timeSeconds < line.startSeconds) {
      high = mid - 1;
    } else if (
      timeSeconds > line.endSeconds ||
      (timeSeconds === line.endSeconds && mid + 1 < lines.length && lines[mid + 1].startSeconds <= timeSeconds)
    ) {
      low = mid + 1;
    } else {
      return mid;
    }
  }

  return -1;
}

function binarySearchWord(words: readonly LyricWord[], timeSeconds: number): number {
  let low = 0;
  let high = words.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const word = words[mid];
    if (timeSeconds < word.startSeconds) {
      high = mid - 1;
    } else if (
      timeSeconds > word.endSeconds ||
      (timeSeconds === word.endSeconds && mid + 1 < words.length && words[mid + 1].startSeconds <= timeSeconds)
    ) {
      low = mid + 1;
    } else {
      return mid;
    }
  }

  return -1;
}

function computeLineFadeAlpha(lines: Lyrics['lines'], timeSeconds: number, activeLineIndex: number): number {
  if (lines.length === 0) return 0;
  if (activeLineIndex >= 0) return 1;

  // Before the first line
  if (timeSeconds < lines[0].startSeconds) {
    const leadIn = lines[0].startSeconds - timeSeconds;
    if (leadIn > INSTRUMENTAL_FADE_THRESHOLD_SECONDS) {
      const excess = leadIn - INSTRUMENTAL_FADE_THRESHOLD_SECONDS;
      return clamp01(1 - excess / INSTRUMENTAL_FADE_DURATION_SECONDS);
    }
    return 1;
  }

  // After the last line
  const lastLine = lines[lines.length - 1];
  if (timeSeconds > lastLine.endSeconds) {
    const silence = timeSeconds - lastLine.endSeconds;
    if (silence > INSTRUMENTAL_FADE_THRESHOLD_SECONDS) {
      const excess = silence - INSTRUMENTAL_FADE_THRESHOLD_SECONDS;
      return clamp01(1 - excess / INSTRUMENTAL_FADE_DURATION_SECONDS);
    }
    return 1;
  }

  // Between two lines: find the preceding line end via binary search
  let low = 0;
  let high = lines.length - 1;
  let prevIdx = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].endSeconds < timeSeconds) {
      prevIdx = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const prevEnd = lines[prevIdx].endSeconds;
  const nextStart = prevIdx + 1 < lines.length ? lines[prevIdx + 1].startSeconds : prevEnd;
  const gapDuration = nextStart - prevEnd;
  const silenceElapsed = timeSeconds - prevEnd;

  if (gapDuration > INSTRUMENTAL_FADE_THRESHOLD_SECONDS && silenceElapsed > INSTRUMENTAL_FADE_THRESHOLD_SECONDS) {
    // Fade out after >12s of silence, and fade back in 1.2s before next line starts
    const timeToNext = nextStart - timeSeconds;
    if (timeToNext <= 1.2) {
      return clamp01(1 - timeToNext / 1.2);
    }
    const excess = silenceElapsed - INSTRUMENTAL_FADE_THRESHOLD_SECONDS;
    return clamp01(1 - excess / INSTRUMENTAL_FADE_DURATION_SECONDS);
  }

  return 1;
}

const activeSyncEngines = new Set<SyncEngine>();

export function snapAllSyncEngines(positionSeconds: number, lyrics: Lyrics | null = null): void {
  for (const engine of activeSyncEngines) {
    engine.snapToTime(positionSeconds, lyrics);
  }
}

export class SyncEngine {
  private offsetMs = 0;
  private lastTrackId: string | null = null;
  private lastSnapshotTimestampMs = -1;
  private lastSnapshotPosition = 0;
  private lastOutputTime = 0;
  private lastLineIndex = -1;
  private pendingSeekFlag = false;

  constructor() {
    activeSyncEngines.add(this);
  }

  getOffsetMs(): number {
    return this.offsetMs;
  }

  getLastLineIndex(): number {
    return this.lastLineIndex;
  }

  setOffsetMs(offsetMs: number): void {
    const clamped = clampOffsetMs(offsetMs);
    if (clamped !== this.offsetMs) {
      this.offsetMs = clamped;
      this.pendingSeekFlag = true;
    }
  }

  snapToTime(positionSeconds: number, lyrics: Lyrics | null = null): void {
    const safeSec = Number.isFinite(positionSeconds) ? Math.max(0, positionSeconds) : 0;
    this.lastSnapshotPosition = safeSec;
    this.lastSnapshotTimestampMs =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    const effectiveSec = Math.max(0, safeSec + this.offsetMs / 1000);
    this.lastOutputTime = effectiveSec;
    this.pendingSeekFlag = true;
    if (lyrics && lyrics.lines.length > 0) {
      this.lastLineIndex = binarySearchLine(lyrics.lines, effectiveSec);
    } else {
      this.lastLineIndex = -1;
    }
  }

  reset(): void {
    this.lastTrackId = null;
    this.lastSnapshotTimestampMs = -1;
    this.lastSnapshotPosition = 0;
    this.lastOutputTime = 0;
    this.lastLineIndex = -1;
    this.pendingSeekFlag = true;
  }

  update(
    snapshot: PlaybackSnapshot,
    lyrics: Lyrics | null,
    nowMs: number = typeof performance !== 'undefined' ? performance.now() : Date.now(),
  ): SyncFrameResult {
    const trackId = snapshot.track?.id ?? null;
    let didSeekThisFrame = this.pendingSeekFlag || Boolean(snapshot.didSeek);
    this.pendingSeekFlag = false;

    if (trackId !== this.lastTrackId) {
      this.lastTrackId = trackId;
      this.lastSnapshotTimestampMs = snapshot.timestampMs;
      this.lastSnapshotPosition = snapshot.positionSeconds;
      this.lastOutputTime = 0;
      this.lastLineIndex = -1;
      didSeekThisFrame = true;
    }

    const elapsedSinceSnapshotSec = snapshot.isPlaying
      ? Math.max(0, (nowMs - snapshot.timestampMs) / 1000) * (snapshot.playbackRate || 1)
      : 0;
    const rawExtrapolated = Math.max(0, snapshot.positionSeconds + elapsedSinceSnapshotSec);

    if (
      !didSeekThisFrame &&
      this.lastSnapshotTimestampMs >= 0 &&
      snapshot.timestampMs !== this.lastSnapshotTimestampMs
    ) {
      const expectedAtNewSnapshot =
        this.lastSnapshotPosition +
        (snapshot.isPlaying
          ? Math.max(0, (snapshot.timestampMs - this.lastSnapshotTimestampMs) / 1000) *
            (snapshot.playbackRate || 1)
          : 0);
      if (Math.abs(snapshot.positionSeconds - expectedAtNewSnapshot) > 0.35) {
        didSeekThisFrame = true;
      }
    }

    this.lastSnapshotTimestampMs = snapshot.timestampMs;
    this.lastSnapshotPosition = snapshot.positionSeconds;

    const effectiveRaw = Math.max(0, rawExtrapolated + this.offsetMs / 1000);

    // If effective time jumped backward by >0.35s (e.g., stream reset to 0 or drift snap), treat as seek
    if (!didSeekThisFrame && this.lastOutputTime - effectiveRaw > 0.35) {
      didSeekThisFrame = true;
    }

    let timeSeconds: number;
    if (didSeekThisFrame || !snapshot.isPlaying) {
      timeSeconds = effectiveRaw;
    } else {
      // Enforce monotonic forward progression during normal playback
      timeSeconds = Math.max(this.lastOutputTime, effectiveRaw);
    }
    this.lastOutputTime = timeSeconds;

    if (!lyrics || lyrics.lines.length === 0) {
      this.lastLineIndex = -1;
      return {
        timeSeconds,
        activeLineIndex: -1,
        activeWordIndex: -1,
        wordProgress: 0,
        lineFadeAlpha: 0,
        didSeekThisFrame,
        isInstrumentalGap: true,
        gapProgress: 0,
        timeUntilNextLine: Number.POSITIVE_INFINITY,
        hasLyrics: false,
        lastActiveLineIndex: -1,
        nextLineIndex: -1,
      };
    }

    const lines = lyrics.lines;
    const activeLineIndex = binarySearchLine(lines, timeSeconds);
    this.lastLineIndex = activeLineIndex;
    let activeWordIndex = -1;
    let wordProgress = 0;

    if (activeLineIndex >= 0) {
      const line = lines[activeLineIndex];
      if (line.words.length > 0) {
        activeWordIndex = binarySearchWord(line.words, timeSeconds);
        if (activeWordIndex >= 0) {
          const word = line.words[activeWordIndex];
          const dur = Math.max(0.001, word.endSeconds - word.startSeconds);
          wordProgress = clamp01((timeSeconds - word.startSeconds) / dur);
        } else if (timeSeconds >= line.words[line.words.length - 1].endSeconds) {
          activeWordIndex = line.words.length - 1;
          wordProgress = 1;
        }
      } else {
        const lineDur = Math.max(0.001, line.endSeconds - line.startSeconds);
        wordProgress = clamp01((timeSeconds - line.startSeconds) / lineDur);
      }
    }

    const lineFadeAlpha = computeLineFadeAlpha(lines, timeSeconds, activeLineIndex);

    // Compute instrumental gap telemetry
    let isInstrumentalGap = false;
    let gapProgress = 0;
    let timeUntilNextLine = Number.POSITIVE_INFINITY;
    let lastActiveLineIndex = -1;
    let nextLineIndex = -1;

    if (activeLineIndex >= 0) {
      lastActiveLineIndex = activeLineIndex;
      const line = lines[activeLineIndex];
      const lastWordEnd =
        line.words.length > 0 ? line.words[line.words.length - 1].endSeconds : line.endSeconds;

      if (activeLineIndex + 1 < lines.length) {
        nextLineIndex = activeLineIndex + 1;
        const nextStart = lines[nextLineIndex].startSeconds;
        timeUntilNextLine = Math.max(0, nextStart - timeSeconds);
        const tailGap = nextStart - lastWordEnd;
        if (tailGap >= 3.5 && timeSeconds > lastWordEnd) {
          isInstrumentalGap = true;
          gapProgress = clamp01((timeSeconds - lastWordEnd) / Math.max(0.001, tailGap));
        }
      } else if (line.words.length > 0 && timeSeconds > lastWordEnd && line.endSeconds - lastWordEnd >= 3.5) {
        isInstrumentalGap = true;
        gapProgress = clamp01((timeSeconds - lastWordEnd) / Math.max(0.001, line.endSeconds - lastWordEnd));
      }
    } else if (timeSeconds < lines[0].startSeconds) {
      // Intro before first line
      nextLineIndex = 0;
      const firstStart = lines[0].startSeconds;
      timeUntilNextLine = Math.max(0, firstStart - timeSeconds);
      if (firstStart > 3.0) {
        isInstrumentalGap = true;
        gapProgress = clamp01(timeSeconds / Math.max(0.001, firstStart));
      }
    } else if (timeSeconds > lines[lines.length - 1].endSeconds) {
      // Outro after last line
      lastActiveLineIndex = lines.length - 1;
      isInstrumentalGap = true;
      gapProgress = 1;
    } else {
      // Explicit gap between lines[prevIdx] and lines[prevIdx + 1]
      let low = 0;
      let high = lines.length - 1;
      let prevIdx = 0;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (lines[mid].endSeconds < timeSeconds) {
          prevIdx = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      lastActiveLineIndex = prevIdx;
      nextLineIndex = prevIdx + 1 < lines.length ? prevIdx + 1 : -1;
      if (nextLineIndex >= 0) {
        const prevLine = lines[prevIdx];
        const prevVocalEnd =
          prevLine.words.length > 0
            ? Math.min(prevLine.endSeconds, prevLine.words[prevLine.words.length - 1].endSeconds)
            : prevLine.endSeconds;
        const nextStart = lines[nextLineIndex].startSeconds;
        const gapDur = nextStart - prevVocalEnd;
        timeUntilNextLine = Math.max(0, nextStart - timeSeconds);
        if (gapDur >= 3.5) {
          isInstrumentalGap = true;
          gapProgress = clamp01((timeSeconds - prevVocalEnd) / Math.max(0.001, gapDur));
        }
      }
    }

    return {
      timeSeconds,
      activeLineIndex,
      activeWordIndex,
      wordProgress,
      lineFadeAlpha,
      didSeekThisFrame,
      isInstrumentalGap,
      gapProgress,
      timeUntilNextLine,
      hasLyrics: true,
      lastActiveLineIndex,
      nextLineIndex,
    };
  }
}
