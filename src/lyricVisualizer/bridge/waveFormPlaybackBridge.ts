// src/lyricVisualizer/bridge/waveFormPlaybackBridge.ts
// Adapts WaveForm's AudioEngine, usePlayerStore, and useLyricsStore to IPlaybackBridge,
// including the built-in "Starlight Harbor" public-domain Sandbox demo playback simulator.

import {
  type AudioFrameMetrics,
  type IPlaybackBridge,
  type LyricLine,
  type Lyrics,
  type LyricsSourceKind,
  type LyricWord,
  type PlaybackSnapshot,
  STARLIGHT_HARBOR_LYRICS,
  STARLIGHT_HARBOR_TRACK,
  type TrackInfo,
} from '../core/models';
import { snapAllSyncEngines } from '../core/syncEngine';
import { enrichLyricsRomanization } from '../core/lyricsPipeline';
import { registerPlayerBridgeResync, usePlayerStore } from '../../state/playerStore';
import { useLyricsStore } from '../../state/lyricsStore';
import type { Song } from '../../models/Song';
import type { ParsedLyrics } from '../../services/LyricsService';

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function getMatchingLyricsData(song: Song | null): ParsedLyrics | null {
  if (!song) return null;
  const trackId = song.videoId || (song as any).id || null;
  const lState = useLyricsStore.getState();
  if (!lState.lyricsData) return null;
  if (lState.currentTrackId && trackId && lState.currentTrackId !== trackId) {
    return null;
  }
  return lState.lyricsData;
}

/**
 * Converts WaveForm's ParsedLyrics (from LyricsService / useLyricsStore) into
 * LyricVisualizer's canonical Lyrics model.
 */
export function convertParsedLyricsToVisualizerLyrics(parsed: ParsedLyrics | null): Lyrics | null {
  if (!parsed || !Array.isArray(parsed.lines) || parsed.lines.length === 0) {
    return null;
  }

  const isUnsynced = parsed.type === 'UNSYNCED' || parsed.isSynced === false;
  const providerLower = (parsed.provider || '').toLowerCase();
  const isInterpolatedLrc = providerLower === 'lrclib';

  let hasAnyWords = false;
  let allSynthesized = true;

  const lines: LyricLine[] = parsed.lines.map((line, idx) => {
    const rawRom =
      (typeof line.romanization === 'string' && line.romanization.trim()) ||
      (typeof (line as any).romanizedText === 'string' && (line as any).romanizedText.trim()) ||
      undefined;
    const rawTrans =
      (typeof line.translation === 'string' && line.translation.trim()) ||
      (typeof (line as any).translatedText === 'string' && (line as any).translatedText.trim()) ||
      undefined;

    if (isUnsynced) {
      const startSec = idx * 4;
      const endSec = (idx + 1) * 4;
      return {
        startSeconds: startSec,
        endSeconds: endSec,
        text: line.text || '',
        words: [],
        isSynthesizedWords: false,
        ...(rawRom ? { romanizedText: rawRom } : {}),
        ...(rawTrans ? { translatedText: rawTrans } : {}),
      };
    }

    const startSeconds = Math.max(0, (line.startTimeMs || 0) / 1000);
    const rawEndSeconds = (line.endTimeMs || line.startTimeMs + 4000) / 1000;
    const endSeconds = Math.max(startSeconds + 0.25, rawEndSeconds);

    const rawSyllables = Array.isArray(line.syllables)
      ? line.syllables.filter((s) => typeof s.text === 'string' && s.text.trim().length > 0)
      : [];

    if (rawSyllables.length > 0) {
      hasAnyWords = true;
      if (!isInterpolatedLrc) {
        allSynthesized = false;
      }
      const words: LyricWord[] = rawSyllables.map((s) => {
        const wStart = Math.max(startSeconds, (s.startTimeMs || 0) / 1000);
        const wEnd = Math.max(wStart + 0.04, (s.endTimeMs || s.startTimeMs + 200) / 1000);
        return {
          text: s.text.trim(),
          startSeconds: wStart,
          endSeconds: Math.min(endSeconds + 0.5, wEnd),
        };
      });
      return {
        startSeconds,
        endSeconds,
        text: line.text || words.map((w) => w.text).join(' '),
        words,
        isSynthesizedWords: isInterpolatedLrc,
        ...(rawRom ? { romanizedText: rawRom } : {}),
        ...(rawTrans ? { translatedText: rawTrans } : {}),
      };
    }

    // Synthesize proportional word timings for line-synced lines without syllables
    const tokens = (line.text || '').trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      return {
        startSeconds,
        endSeconds,
        text: line.text || '',
        words: [],
        isSynthesizedWords: true,
        ...(rawRom ? { romanizedText: rawRom } : {}),
        ...(rawTrans ? { translatedText: rawTrans } : {}),
      };
    }

    hasAnyWords = true;
    const span = Math.max(0.25, endSeconds - startSeconds);
    const weights = tokens.map((tok) => {
      const vowelMatches = tok.match(/[aeiouy]+/gi);
      const syllables = vowelMatches ? vowelMatches.length : 1;
      const punctBonus = /[.,!?;:—\-]$/.test(tok) ? 0.65 : 0;
      return Math.max(1, syllables) + punctBonus;
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;

    let cursor = startSeconds;
    const words: LyricWord[] = tokens.map((tok, wIdx) => {
      const dur = (span * weights[wIdx]) / totalWeight;
      const wStart = cursor;
      const wEnd = wIdx === tokens.length - 1 ? endSeconds : Math.min(endSeconds, cursor + dur);
      cursor = wEnd;
      return {
        text: tok,
        startSeconds: wStart,
        endSeconds: Math.max(wStart + 0.02, wEnd),
      };
    });

    return {
      startSeconds,
      endSeconds,
      text: line.text || '',
      words,
      isSynthesizedWords: true,
      ...(rawRom ? { romanizedText: rawRom } : {}),
      ...(rawTrans ? { translatedText: rawTrans } : {}),
    };
  });

  let sourceKind: LyricsSourceKind = 'LineSynced';
  if (isUnsynced) {
    sourceKind = 'Unsynced';
  } else if (hasAnyWords && !allSynthesized) {
    sourceKind = 'WordSynced';
  } else if (hasAnyWords && allSynthesized) {
    sourceKind = 'FallbackSynthesis';
  }

  return enrichLyricsRomanization({
    providerName: parsed.provider || 'WaveForm',
    sourceKind,
    lines,
  });
}

/**
 * Converts a WaveForm Song and optional ParsedLyrics into a LyricVisualizer TrackInfo.
 */
export function songToTrackInfo(
  song: Song | null,
  parsedLyrics?: ParsedLyrics | null,
  fallbackDurationMs = 0
): TrackInfo | null {
  if (!song) return null;

  const durationSeconds =
    (song.totalPlayTimeMs && song.totalPlayTimeMs > 0
      ? song.totalPlayTimeMs / 1000
      : song.durationSec && song.durationSec > 0
      ? song.durationSec
      : fallbackDurationMs > 0
      ? fallbackDurationMs / 1000
      : 180);

  const parsedLines =
    parsedLyrics && parsedLyrics.type !== 'UNSYNCED' && Array.isArray(parsedLyrics.lines)
      ? parsedLyrics.lines.map((l) => ({
          startTimeMs: l.startTimeMs,
          endTimeMs: l.endTimeMs,
          text: l.text,
          romanizedText:
            typeof l.romanization === 'string' && l.romanization.trim()
              ? l.romanization.trim()
              : undefined,
          translatedText:
            typeof l.translation === 'string' && l.translation.trim()
              ? l.translation.trim()
              : undefined,
          words: Array.isArray(l.syllables)
            ? l.syllables
                .filter((s) => typeof s.text === 'string' && s.text.trim().length > 0)
                .map((s) => ({
                  text: s.text.trim(),
                  startTimeMs: s.startTimeMs,
                  endTimeMs: s.endTimeMs,
                }))
            : undefined,
        }))
      : null;

  return {
    id: song.videoId || (song as any).id || `${song.title}-${song.artist}`,
    title: song.title || 'Unknown Title',
    artist: song.artist || 'Unknown Artist',
    album: song.albumName || (song as any).album || undefined,
    durationSeconds,
    artworkUrl: song.thumbnailUrl || (song as any).artworkUrl || null,
    rawSyncedLyrics: typeof song.lyrics === 'string' ? song.lyrics : null,
    parsedLyricsLines: parsedLines,
  };
}

export class WaveFormPlaybackBridge implements IPlaybackBridge {
  private trackListeners = new Set<(track: TrackInfo | null) => void>();
  private stateListeners = new Set<(isPlaying: boolean) => void>();
  private seekListeners = new Set<(positionSeconds: number) => void>();

  private sandboxMode = false;
  private sandboxIsPlaying = true;
  private sandboxBasePositionSec = 0;
  private sandboxResumeTimestampMs = nowMs();
  private sandboxLastBeatIndex = -1;
  private pendingDidSeek = false;

  private lastObservedTrackId: string | null = null;
  private lastObservedIsPlaying = false;
  private lastObservedPositionSec = 0;
  private lastObservedTimestampMs = nowMs();

  private unsubscribePlayer: (() => void) | null = null;
  private unsubscribeLyrics: (() => void) | null = null;

  constructor(initialSandboxMode = false) {
    this.sandboxMode = initialSandboxMode;
    this.attachStoreListeners();
  }

  private attachStoreListeners(): void {
    const pState = usePlayerStore.getState();
    this.lastObservedTrackId = pState.currentTrack?.videoId ?? null;
    this.lastObservedIsPlaying = pState.playbackState === 'PLAYING';
    this.lastObservedPositionSec = this.getLivePositionSeconds();
    this.lastObservedTimestampMs = nowMs();

    this.unsubscribePlayer = usePlayerStore.subscribe((state) => {
      if (this.sandboxMode) return;

      const nextTrackId = state.currentTrack?.videoId ?? null;
      const nextIsPlaying = state.playbackState === 'PLAYING';
      const engine = state.audioEngine;
      const nextPosSec = engine
        ? typeof engine.getCurrentTime === 'function'
          ? Math.max(0, engine.getCurrentTime())
          : Math.max(0, (engine.getCurrentPositionMs?.() || 0) / 1000)
        : Math.max(0, (state.positionMs || 0) / 1000);
      const currentTs = nowMs();

      if (nextTrackId !== this.lastObservedTrackId) {
        this.lastObservedTrackId = nextTrackId;
        this.lastObservedPositionSec = nextPosSec;
        this.lastObservedTimestampMs = currentTs;
        const lyricsData = getMatchingLyricsData(state.currentTrack);
        const trackInfo = songToTrackInfo(state.currentTrack, lyricsData, state.durationMs);
        this.emitTrackChanged(trackInfo);
      } else {
        const elapsedSec = Math.max(0, (currentTs - this.lastObservedTimestampMs) / 1000);
        const expectedPosSec = this.lastObservedIsPlaying
          ? this.lastObservedPositionSec + elapsedSec
          : this.lastObservedPositionSec;
        if (Math.abs(nextPosSec - expectedPosSec) > 0.85) {
          this.pendingDidSeek = true;
          this.emitSeeked(nextPosSec);
        }
        this.lastObservedPositionSec = nextPosSec;
        this.lastObservedTimestampMs = currentTs;
      }

      if (nextIsPlaying !== this.lastObservedIsPlaying) {
        this.lastObservedIsPlaying = nextIsPlaying;
        this.emitPlaybackStateChanged(nextIsPlaying);
      }
    });

    this.unsubscribeLyrics = useLyricsStore.subscribe((lState, prevLState) => {
      if (this.sandboxMode) return;
      if (lState.lyricsData !== prevLState.lyricsData || lState.currentTrackId !== prevLState.currentTrackId) {
        const p = usePlayerStore.getState();
        if (p.currentTrack) {
          const matching = getMatchingLyricsData(p.currentTrack);
          const trackInfo = songToTrackInfo(p.currentTrack, matching, p.durationMs);
          this.emitTrackChanged(trackInfo);
        }
      }
    });
  }

  get isSandboxMode(): boolean {
    return this.sandboxMode;
  }

  setSandboxMode(enabled: boolean): void {
    const next = Boolean(enabled);
    if (this.sandboxMode === next) return;

    this.sandboxMode = next;
    this.pendingDidSeek = true;

    if (next) {
      this.sandboxBasePositionSec = 0;
      this.sandboxIsPlaying = true;
      this.sandboxResumeTimestampMs = nowMs();
      this.sandboxLastBeatIndex = -1;
      this.emitTrackChanged(STARLIGHT_HARBOR_TRACK);
      this.emitPlaybackStateChanged(true);
      this.emitSeeked(0);
    } else {
      const pState = usePlayerStore.getState();
      const matchingLyrics = getMatchingLyricsData(pState.currentTrack);
      const trackInfo = songToTrackInfo(pState.currentTrack, matchingLyrics, pState.durationMs);
      const isPlaying = pState.playbackState === 'PLAYING';
      const posSec = this.getLivePositionSeconds();
      this.lastObservedTrackId = pState.currentTrack?.videoId ?? null;
      this.lastObservedIsPlaying = isPlaying;
      this.lastObservedPositionSec = posSec;
      this.lastObservedTimestampMs = nowMs();
      this.emitTrackChanged(trackInfo);
      this.emitPlaybackStateChanged(isPlaying);
      this.emitSeeked(posSec);
    }
  }

  private getSandboxPositionSeconds(): number {
    const dur = STARLIGHT_HARBOR_TRACK.durationSeconds || 42;
    if (!this.sandboxIsPlaying) {
      return Math.max(0, Math.min(dur, this.sandboxBasePositionSec));
    }
    const elapsedSec = Math.max(0, (nowMs() - this.sandboxResumeTimestampMs) / 1000);
    const total = this.sandboxBasePositionSec + elapsedSec;
    return dur > 0 ? total % dur : 0;
  }

  private getLivePositionSeconds(): number {
    const pState = usePlayerStore.getState();
    const engine = pState.audioEngine;
    if (engine) {
      if (typeof engine.getCurrentTime === 'function') {
        return Math.max(0, engine.getCurrentTime());
      }
      if (typeof engine.getCurrentPositionMs === 'function') {
        return Math.max(0, (engine.getCurrentPositionMs() || 0) / 1000);
      }
    }
    return Math.max(0, (pState.positionMs || 0) / 1000);
  }

  get currentSnapshot(): PlaybackSnapshot {
    const didSeek = this.pendingDidSeek;
    this.pendingDidSeek = false;
    const timestampMs = nowMs();

    if (this.sandboxMode) {
      return {
        track: STARLIGHT_HARBOR_TRACK,
        positionSeconds: this.getSandboxPositionSeconds(),
        isPlaying: this.sandboxIsPlaying,
        playbackRate: 1.0,
        timestampMs,
        didSeek,
      };
    }

    const pState = usePlayerStore.getState();
    const matchingLyrics = getMatchingLyricsData(pState.currentTrack);
    const track = songToTrackInfo(pState.currentTrack, matchingLyrics, pState.durationMs);
    const isPlaying = pState.playbackState === 'PLAYING';
    const positionSeconds = this.getLivePositionSeconds();

    return {
      track,
      positionSeconds,
      isPlaying,
      playbackRate: 1.0,
      timestampMs,
      didSeek,
    };
  }

  /**
   * Returns current Lyrics (either Sandbox "Starlight Harbor" or converted live store lyrics).
   */
  getCurrentLyrics(): Lyrics | null {
    if (this.sandboxMode) {
      return STARLIGHT_HARBOR_LYRICS;
    }
    const pState = usePlayerStore.getState();
    return convertParsedLyricsToVisualizerLyrics(getMatchingLyricsData(pState.currentTrack));
  }

  play(): void {
    if (this.sandboxMode) {
      if (!this.sandboxIsPlaying) {
        this.sandboxResumeTimestampMs = nowMs();
        this.sandboxIsPlaying = true;
        this.emitPlaybackStateChanged(true);
      }
      return;
    }
    usePlayerStore.getState().play();
  }

  pause(): void {
    if (this.sandboxMode) {
      if (this.sandboxIsPlaying) {
        this.sandboxBasePositionSec = this.getSandboxPositionSeconds();
        this.sandboxIsPlaying = false;
        this.emitPlaybackStateChanged(false);
      }
      return;
    }
    usePlayerStore.getState().pause();
  }

  togglePlay(): void {
    if (this.sandboxMode) {
      if (this.sandboxIsPlaying) {
        this.pause();
      } else {
        this.play();
      }
      return;
    }
    usePlayerStore.getState().togglePlay();
  }

  seek(positionSeconds: number): void {
    if (!Number.isFinite(positionSeconds)) return;
    if (this.sandboxMode) {
      const dur = STARLIGHT_HARBOR_TRACK.durationSeconds || 42;
      const clamped = Math.max(0, Math.min(dur, positionSeconds));
      this.sandboxBasePositionSec = clamped;
      this.sandboxResumeTimestampMs = nowMs();
      this.pendingDidSeek = true;
      this.emitSeeked(clamped);
      return;
    }

    const pState = usePlayerStore.getState();
    const targetMs = Math.max(0, Math.round(positionSeconds * 1000));
    this.pendingDidSeek = true;
    this.lastObservedPositionSec = targetMs / 1000;
    this.lastObservedTimestampMs = nowMs();

    if (pState && typeof pState.seek === 'function') {
      pState.seek(targetMs);
      const updatedMs = usePlayerStore.getState().positionMs;
      const syncedSec = Math.max(0, (Number.isFinite(updatedMs) ? updatedMs : targetMs) / 1000);
      this.lastObservedPositionSec = syncedSec;
      this.lastObservedTimestampMs = nowMs();
      this.emitSeeked(syncedSec);
      return;
    }

    if (pState?.audioEngine) {
      if (typeof (pState.audioEngine as any).seek === 'function') {
        (pState.audioEngine as any).seek(targetMs);
      } else if (typeof (pState.audioEngine as any).seekTo === 'function') {
        (pState.audioEngine as any).seekTo(targetMs);
      }
    }
    this.emitSeeked(targetMs / 1000);
  }

  seekMs(positionMs: number): void {
    this.seek(positionMs / 1000);
  }

  forceResync(positionSeconds: number): void {
    const liveSec =
      typeof positionSeconds === 'number' && Number.isFinite(positionSeconds)
        ? Math.max(0, positionSeconds)
        : this.sandboxMode
        ? this.getSandboxPositionSeconds()
        : this.getLivePositionSeconds();

    this.pendingDidSeek = true;
    this.lastObservedPositionSec = liveSec;
    this.lastObservedTimestampMs = nowMs();

    if (this.sandboxMode) {
      const dur = STARLIGHT_HARBOR_TRACK.durationSeconds || 42;
      this.sandboxBasePositionSec = Math.max(0, Math.min(dur, liveSec));
      this.sandboxResumeTimestampMs = this.lastObservedTimestampMs;
    }

    snapAllSyncEngines(liveSec, this.getCurrentLyrics());
    this.emitSeeked(liveSec);
  }

  onTrackChanged(cb: (track: TrackInfo | null) => void): () => void {
    this.trackListeners.add(cb);
    return () => {
      this.trackListeners.delete(cb);
    };
  }

  onPlaybackStateChanged(cb: (isPlaying: boolean) => void): () => void {
    this.stateListeners.add(cb);
    return () => {
      this.stateListeners.delete(cb);
    };
  }

  onSeeked(cb: (positionSeconds: number) => void): () => void {
    this.seekListeners.add(cb);
    return () => {
      this.seekListeners.delete(cb);
    };
  }

  sampleAudioMetrics(outAudio?: AudioFrameMetrics): AudioFrameMetrics {
    const target: AudioFrameMetrics = outAudio ?? {
      rmsLevel: 0,
      bassEnergy: 0,
      midEnergy: 0,
      trebleEnergy: 0,
      beatDetected: false,
    };

    if (this.sandboxMode) {
      if (!this.sandboxIsPlaying) {
        target.rmsLevel = 0;
        target.bassEnergy = 0;
        target.midEnergy = 0;
        target.trebleEnergy = 0;
        target.beatDetected = false;
        (target as any).estimatedBpm = 118;
        (target as any).beatStrength = 0;
        return target;
      }

      // Deterministic ~118 BPM atmospheric wave synthesizer for Starlight Harbor sandbox demo
      const t = this.getSandboxPositionSeconds();
      const beatPeriod = 60 / 118; // ~0.508s per beat
      const beatIndex = Math.floor(t / beatPeriod);
      const beatPhase = (t % beatPeriod) / beatPeriod;
      const kickEnv = Math.exp(-beatPhase * 5.2);

      const bass = Math.max(0, Math.min(1, 0.24 + 0.62 * kickEnv + 0.1 * Math.sin(t * 2.1)));
      const mid = Math.max(0, Math.min(1, 0.28 + 0.35 * Math.sin(t * 3.4 + 0.7) * Math.cos(t * 1.3)));
      const treble = Math.max(0, Math.min(1, 0.18 + 0.28 * Math.abs(Math.sin(t * 7.5))));
      const rms = Math.max(0, Math.min(1, Math.sqrt((bass * bass + mid * mid + treble * treble) / 3)));

      const isNewBeat = beatIndex !== this.sandboxLastBeatIndex && beatPhase < 0.25;
      if (isNewBeat) {
        this.sandboxLastBeatIndex = beatIndex;
      }

      target.rmsLevel = rms;
      target.bassEnergy = bass;
      target.midEnergy = mid;
      target.trebleEnergy = treble;
      target.beatDetected = isNewBeat;
      (target as any).estimatedBpm = 118;
      (target as any).beatStrength = Math.max(0, Math.min(1, kickEnv));
      return target;
    }

    const engine = usePlayerStore.getState().audioEngine;
    if (engine && typeof engine.sampleAudioMetrics === 'function') {
      const sampled = engine.sampleAudioMetrics(target);
      const viz = (engine as any).visualizer;
      if (typeof (sampled as any).estimatedBpm !== 'number' || !Number.isFinite((sampled as any).estimatedBpm)) {
        (sampled as any).estimatedBpm =
          viz && typeof viz.getEstimatedBpm === 'function' ? viz.getEstimatedBpm() : 120;
      }
      if (typeof (sampled as any).beatStrength !== 'number' || !Number.isFinite((sampled as any).beatStrength)) {
        (sampled as any).beatStrength =
          viz && typeof viz.getBeatStrength === 'function' ? viz.getBeatStrength() : 0;
      }
      return sampled;
    }

    target.rmsLevel = 0;
    target.bassEnergy = 0;
    target.midEnergy = 0;
    target.trebleEnergy = 0;
    target.beatDetected = false;
    (target as any).estimatedBpm = 120;
    (target as any).beatStrength = 0;
    return target;
  }

  private emitTrackChanged(track: TrackInfo | null): void {
    for (const cb of this.trackListeners) {
      try {
        cb(track);
      } catch {
        // Ignore listener error
      }
    }
  }

  private emitPlaybackStateChanged(isPlaying: boolean): void {
    for (const cb of this.stateListeners) {
      try {
        cb(isPlaying);
      } catch {
        // Ignore listener error
      }
    }
  }

  private emitSeeked(positionSeconds: number): void {
    for (const cb of this.seekListeners) {
      try {
        cb(positionSeconds);
      } catch {
        // Ignore listener error
      }
    }
  }

  dispose(): void {
    if (this.unsubscribePlayer) {
      this.unsubscribePlayer();
      this.unsubscribePlayer = null;
    }
    if (this.unsubscribeLyrics) {
      this.unsubscribeLyrics();
      this.unsubscribeLyrics = null;
    }
    this.trackListeners.clear();
    this.stateListeners.clear();
    this.seekListeners.clear();
  }
}

let sharedPlaybackBridge: WaveFormPlaybackBridge | null = null;

export function getSharedWaveFormPlaybackBridge(): WaveFormPlaybackBridge {
  if (!sharedPlaybackBridge) {
    sharedPlaybackBridge = new WaveFormPlaybackBridge(false);
    registerPlayerBridgeResync((sec: number) => {
      sharedPlaybackBridge?.forceResync(sec);
    });
  }
  return sharedPlaybackBridge;
}
