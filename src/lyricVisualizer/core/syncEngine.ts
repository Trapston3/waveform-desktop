import type { Lyrics, LyricWord, PlaybackSnapshot } from './models';
import { isBlankOrInstrumentalLineText } from './lrcParser';

export const MIN_OFFSET_MS = -2000;
export const MAX_OFFSET_MS = 2000;
export const MIN_AUTO_SYNC_OFFSET_MS = -15000;
export const MAX_AUTO_SYNC_OFFSET_MS = 15000;
export const INSTRUMENTAL_FADE_THRESHOLD_SECONDS = 12;
export const INSTRUMENTAL_FADE_DURATION_SECONDS = 1.5;

export interface VocalSilenceInterval {
  readonly startSec: number;
  readonly endSec: number;
}

export function clampOffsetMs(offsetMs: number): number {
  if (!Number.isFinite(offsetMs)) return 0;
  return Math.max(MIN_OFFSET_MS, Math.min(MAX_OFFSET_MS, Math.round(offsetMs)));
}

export function clampAutoSyncOffsetMs(offsetMs: number): number {
  if (!Number.isFinite(offsetMs)) return 0;
  return Math.max(MIN_AUTO_SYNC_OFFSET_MS, Math.min(MAX_AUTO_SYNC_OFFSET_MS, Math.round(offsetMs)));
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
  readonly gapDuration?: number;
  readonly hasLyrics: boolean;
  readonly lastActiveLineIndex: number;
  readonly nextLineIndex: number;
}

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function findFirstNonBlankLine(lines: Lyrics['lines'], fromIndex = 0): number {
  for (let i = Math.max(0, fromIndex); i < lines.length; i++) {
    if (!isBlankOrInstrumentalLineText(lines[i].text)) {
      return i;
    }
  }
  return -1;
}

function findLastNonBlankLine(lines: Lyrics['lines'], upToIndex = lines.length - 1): number {
  for (let i = Math.min(lines.length - 1, upToIndex); i >= 0; i--) {
    if (!isBlankOrInstrumentalLineText(lines[i].text)) {
      return i;
    }
  }
  return -1;
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
      return isBlankOrInstrumentalLineText(line.text) ? -1 : mid;
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

  const firstIdx = findFirstNonBlankLine(lines, 0);
  if (firstIdx < 0) return 0;
  const lastIdx = findLastNonBlankLine(lines, lines.length - 1);

  // Before the first vocal line
  if (timeSeconds < lines[firstIdx].startSeconds) {
    const leadIn = lines[firstIdx].startSeconds - timeSeconds;
    if (leadIn > INSTRUMENTAL_FADE_THRESHOLD_SECONDS) {
      const excess = leadIn - INSTRUMENTAL_FADE_THRESHOLD_SECONDS;
      return clamp01(1 - excess / INSTRUMENTAL_FADE_DURATION_SECONDS);
    }
    return 1;
  }

  // After the last vocal line
  const lastLine = lines[lastIdx];
  if (timeSeconds > lastLine.endSeconds) {
    const silence = timeSeconds - lastLine.endSeconds;
    if (silence > INSTRUMENTAL_FADE_THRESHOLD_SECONDS) {
      const excess = silence - INSTRUMENTAL_FADE_THRESHOLD_SECONDS;
      return clamp01(1 - excess / INSTRUMENTAL_FADE_DURATION_SECONDS);
    }
    return 1;
  }

  // Between two lines: find the preceding non-blank line end via binary search
  let low = 0;
  let high = lines.length - 1;
  let prevIdx = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].endSeconds <= timeSeconds) {
      prevIdx = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  prevIdx = findLastNonBlankLine(lines, prevIdx);
  if (prevIdx < 0) prevIdx = firstIdx;

  const prevEnd = lines[prevIdx].endSeconds;
  const nextIdx = findFirstNonBlankLine(lines, prevIdx + 1);
  const nextStart = nextIdx >= 0 ? lines[nextIdx].startSeconds : prevEnd;
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
  private autoSyncOffsetMs = 0;
  private vocalSilenceRanges: VocalSilenceInterval[] = [];
  private lastTrackId: string | null = null;
  private lastSnapshotTimestampMs = -1;
  private lastSnapshotPosition = 0;
  private lastOutputTime = 0;
  private lastLineIndex = -1;
  private pendingSeekFlag = false;
  private lastSeenSeekGeneration = -1;

  constructor() {
    activeSyncEngines.add(this);
  }

  getOffsetMs(): number {
    return this.offsetMs;
  }

  getAutoSyncOffsetMs(): number {
    return this.autoSyncOffsetMs;
  }

  getEffectiveOffsetMs(): number {
    return this.offsetMs + this.autoSyncOffsetMs;
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

  setAutoSyncOffsetMs(offsetMs: number): void {
    const clamped = clampAutoSyncOffsetMs(offsetMs);
    if (clamped !== this.autoSyncOffsetMs) {
      this.autoSyncOffsetMs = clamped;
      this.pendingSeekFlag = true;
    }
  }

  setVocalSilenceRanges(ranges: readonly VocalSilenceInterval[]): void {
    this.vocalSilenceRanges = Array.isArray(ranges)
      ? ranges.filter((r) => r && Number.isFinite(r.startSec) && Number.isFinite(r.endSec) && r.endSec > r.startSec)
      : [];
  }

  snapToTime(positionSeconds: number, lyrics: Lyrics | null = null): void {
    const safeSec = Number.isFinite(positionSeconds) ? Math.max(0, positionSeconds) : 0;
    this.lastSnapshotPosition = safeSec;
    this.lastSnapshotTimestampMs =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    const effectiveSec = Math.max(0, safeSec + this.getEffectiveOffsetMs() / 1000);
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
    this.vocalSilenceRanges = [];
    this.lastSnapshotTimestampMs = -1;
    this.lastSnapshotPosition = 0;
    this.lastOutputTime = 0;
    this.lastLineIndex = -1;
    this.pendingSeekFlag = true;
    this.lastSeenSeekGeneration = -1;
  }

  update(
    snapshot: PlaybackSnapshot,
    lyrics: Lyrics | null,
    nowMs: number = typeof performance !== 'undefined' ? performance.now() : Date.now(),
  ): SyncFrameResult {
    const trackId = snapshot.track?.id ?? null;
    const snapSeekGen = (snapshot as { seekGeneration?: number }).seekGeneration;
    let didSeekThisFrame = this.pendingSeekFlag || Boolean(snapshot.didSeek);
    this.pendingSeekFlag = false;
    if (typeof snapSeekGen === 'number') {
      if (
        (this.lastSeenSeekGeneration >= 0 && snapSeekGen !== this.lastSeenSeekGeneration) ||
        (this.lastSeenSeekGeneration < 0 && snapSeekGen > 0)
      ) {
        didSeekThisFrame = true;
      }
      this.lastSeenSeekGeneration = snapSeekGen;
    }

    if (trackId !== this.lastTrackId) {
      this.lastTrackId = trackId;
      this.vocalSilenceRanges = [];
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

    const effectiveRaw = Math.max(0, rawExtrapolated + this.getEffectiveOffsetMs() / 1000);

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

    const firstNonBlankIdx = lyrics && lyrics.lines.length > 0 ? findFirstNonBlankLine(lyrics.lines, 0) : -1;
    if (!lyrics || lyrics.lines.length === 0 || firstNonBlankIdx < 0) {
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
        gapDuration: Number.POSITIVE_INFINITY,
        hasLyrics: false,
        lastActiveLineIndex: -1,
        nextLineIndex: -1,
      };
    }

    const lines = lyrics.lines;
    const lastNonBlankIdx = findLastNonBlankLine(lines, lines.length - 1);
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
    let gapDuration = 0;
    let lastActiveLineIndex = -1;
    let nextLineIndex = -1;

    if (activeLineIndex >= 0) {
      lastActiveLineIndex = activeLineIndex;
      const line = lines[activeLineIndex];
      const lastWordEnd =
        line.words.length > 0 ? line.words[line.words.length - 1].endSeconds : line.endSeconds;

      nextLineIndex = findFirstNonBlankLine(lines, activeLineIndex + 1);
      if (nextLineIndex >= 0) {
        const nextStart = lines[nextLineIndex].startSeconds;
        timeUntilNextLine = Math.max(0, nextStart - timeSeconds);
        const tailGap = Math.max(0, nextStart - lastWordEnd);
        gapDuration = tailGap;
        if (tailGap >= 3.5 && timeSeconds > lastWordEnd) {
          isInstrumentalGap = true;
          gapProgress = clamp01((timeSeconds - lastWordEnd) / Math.max(0.001, tailGap));
        }
      } else if (line.words.length > 0 && timeSeconds > lastWordEnd && line.endSeconds - lastWordEnd >= 3.5) {
        gapDuration = Math.max(0, line.endSeconds - lastWordEnd);
        isInstrumentalGap = true;
        gapProgress = clamp01((timeSeconds - lastWordEnd) / Math.max(0.001, line.endSeconds - lastWordEnd));
      }
    } else if (timeSeconds < lines[firstNonBlankIdx].startSeconds) {
      // Intro before first vocal line
      nextLineIndex = firstNonBlankIdx;
      const firstStart = lines[firstNonBlankIdx].startSeconds;
      timeUntilNextLine = Math.max(0, firstStart - timeSeconds);
      gapDuration = Math.max(0, firstStart);
      if (firstStart > 3.0) {
        isInstrumentalGap = true;
        gapProgress = clamp01(timeSeconds / Math.max(0.001, firstStart));
      }
    } else if (timeSeconds > lines[lastNonBlankIdx].endSeconds) {
      // Outro after last vocal line
      lastActiveLineIndex = lastNonBlankIdx;
      isInstrumentalGap = true;
      gapProgress = 1;
      gapDuration = Number.POSITIVE_INFINITY;
    } else {
      // Explicit gap between non-blank lines
      let low = 0;
      let high = lines.length - 1;
      let prevIdx = -1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (lines[mid].endSeconds <= timeSeconds) {
          prevIdx = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      prevIdx = prevIdx >= 0 ? findLastNonBlankLine(lines, prevIdx) : -1;
      if (prevIdx < 0) {
        // Only blank lines precede timeSeconds -> treat as intro before firstNonBlankIdx
        nextLineIndex = firstNonBlankIdx;
        const firstStart = lines[firstNonBlankIdx].startSeconds;
        timeUntilNextLine = Math.max(0, firstStart - timeSeconds);
        gapDuration = Math.max(0, firstStart);
        if (firstStart > 3.0) {
          isInstrumentalGap = true;
          gapProgress = clamp01(timeSeconds / Math.max(0.001, firstStart));
        }
      } else {
        lastActiveLineIndex = prevIdx;
        nextLineIndex = findFirstNonBlankLine(lines, prevIdx + 1);
        if (nextLineIndex >= 0) {
          const prevLine = lines[prevIdx];
          const prevVocalEnd =
            prevLine.words.length > 0
              ? Math.min(prevLine.endSeconds, prevLine.words[prevLine.words.length - 1].endSeconds)
              : prevLine.endSeconds;
          const nextStart = lines[nextLineIndex].startSeconds;
          gapDuration = Math.max(0, nextStart - prevVocalEnd);
          timeUntilNextLine = Math.max(0, nextStart - timeSeconds);
          if (gapDuration >= 3.5) {
            isInstrumentalGap = true;
            gapProgress = clamp01((timeSeconds - prevVocalEnd) / Math.max(0.001, gapDuration));
          }
        } else {
          isInstrumentalGap = true;
          gapProgress = 1;
          gapDuration = Number.POSITIVE_INFINITY;
        }
      }
    }

    // Refine instrumental gap detection using neural vocal-silence ranges when available
    if (!isInstrumentalGap && activeLineIndex < 0 && this.vocalSilenceRanges.length > 0) {
      for (const seg of this.vocalSilenceRanges) {
        const segDur = seg.endSec - seg.startSec;
        if (segDur >= 2.5 && rawExtrapolated >= seg.startSec && rawExtrapolated <= seg.endSec) {
          isInstrumentalGap = true;
          gapDuration = Math.max(gapDuration, segDur);
          gapProgress = clamp01((rawExtrapolated - seg.startSec) / Math.max(0.001, segDur));
          break;
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
      gapDuration,
      hasLyrics: true,
      lastActiveLineIndex,
      nextLineIndex,
    };
  }
}
