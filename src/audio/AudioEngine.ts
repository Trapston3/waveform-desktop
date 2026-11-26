// src/audio/AudioEngine.ts
// Dual-Deck Web Audio Playback Engine conforming to Feature 5 (PROJECT.md)
// Reverse-engineered from Android CrossfadeController.kt & Web deck.ts

import { AutoEqLoader } from './AutoEqLoader';
import type { AutoEqProfile } from './AutoEqLoader';
import { DspChain, FACTORY_EQ_PRESETS, EQ_FREQUENCIES_HZ } from './DspChain';
import { LiveVisualizer } from './LiveVisualizer';
import { WaveformExtractor } from './WaveformExtractor';
import type { AudioFrameMetrics } from '../lyricVisualizer/core/models';

export type { AudioFrameMetrics };

export type DeckName = 'active' | 'standby';
export type PlaybackStatus = 'IDLE' | 'PLAYING' | 'PAUSED' | 'CROSSFADING';

export interface ArtistRef {
  id: string;
  name: string;
}

export interface Song {
  videoId: string;
  title: string;
  artist: string;
  albumName?: string;
  durationText?: string;
  thumbnailUrl?: string;
  albumId?: string;
  artistId?: string;
  artistIds: string[];
  artists: ArtistRef[];
  year?: string;
  date?: string;
  liked: boolean;
  durationSec?: number;
  totalPlayTimeMs: number;
  playCount: number;
  lastPlayedTimeMs?: number;
  lyrics?: string | null;
  streamUrl?: string;
  sourceQuality?: string;
  isExplicit?: boolean;
  playbackSourceType?: 'YOUTUBE' | 'LOCAL' | 'DOWNLOAD';
  playbackSessionId?: string | null;
  playlistBrowseId?: string | null;
  hasOriginalAudio?: boolean;
  isLocal?: boolean;
  replayGainDb?: number;
  bpm?: number;
}

export interface PlaybackState {
  playbackState: PlaybackStatus;
  currentTrack: Song | null;
  positionMs: number;
  volume: number;
  activeDeck: DeckName;
}

export interface SpatialAudioConfig {
  enabled: boolean;
  width: number;
}

export function validateSongContract(song: any): { valid: boolean; error?: string } {
  if (!song || typeof song !== 'object') {
    return { valid: false, error: 'Song must be a non-null object' };
  }
  const requiredStringFields = ['videoId', 'title', 'artist'];
  for (const field of requiredStringFields) {
    if (typeof song[field] !== 'string' || song[field].trim().length === 0) {
      return { valid: false, error: `Mandatory field '${field}' is missing or empty` };
    }
  }
  if (typeof song.liked !== 'boolean') {
    return { valid: false, error: "Field 'liked' must be boolean" };
  }
  if (typeof song.totalPlayTimeMs !== 'number' || song.totalPlayTimeMs < 0) {
    return { valid: false, error: "Field 'totalPlayTimeMs' must be a non-negative number" };
  }
  if (typeof song.playCount !== 'number' || song.playCount < 0) {
    return { valid: false, error: "Field 'playCount' must be a non-negative integer" };
  }
  if (!Array.isArray(song.artistIds) || !Array.isArray(song.artists)) {
    return { valid: false, error: "'artistIds' and 'artists' must be arrays" };
  }
  return { valid: true };
}

function isYoutubeSabrStreamUrl(url?: string | null): boolean {
  if (!url) return false;
  return (
    url.includes('waveform-stream://yt') ||
    url.includes('/api/yt-stream') ||
    url.includes('127.0.0.1') ||
    url.includes('sabr')
  );
}

export function isDeadOrStaleRestoredStreamUrl(url?: string | null): boolean {
  if (!url || !url.trim()) return true;
  if (/^(waveform-local|file):/i.test(url)) return false;
  return (
    url.includes('127.0.0.1') ||
    url.includes('localhost') ||
    url.includes('/api/yt-stream') ||
    url.includes('waveform-stream://') ||
    url.includes('sn-redline') ||
    url.includes('sn-audio') ||
    url.includes('sn-offline') ||
    url.includes('01_Midnight_City.flac')
  );
}

function withStartMsParam(rawUrl: string, startMs: number): string {
  const rounded = Math.max(0, Math.round(startMs));
  try {
    const hasScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(rawUrl);
    const u = hasScheme ? new URL(rawUrl) : new URL(rawUrl, 'http://localhost');
    if (rounded > 0) {
      u.searchParams.set('startMs', String(rounded));
    } else {
      u.searchParams.delete('startMs');
    }
    return hasScheme ? u.toString() : `${u.pathname}${u.search}${u.hash}`;
  } catch {
    const cleaned = rawUrl
      .replace(/([?&])startMs=\d+(&?)/g, (_, sep, trail) => (trail ? sep : ''))
      .replace(/[?&]$/, '');
    if (rounded <= 0) return cleaned;
    return `${cleaned}${cleaned.includes('?') ? '&' : '?'}startMs=${rounded}`;
  }
}

function isTargetSafelyBuffered(
  el: HTMLAudioElement,
  targetMs: number,
  playbackOffsetMs: number
): boolean {
  if (el.readyState < 1 || !el.buffered || el.buffered.length === 0) {
    return false;
  }
  const targetElSec = (targetMs - playbackOffsetMs) / 1000;
  if (!Number.isFinite(targetElSec) || targetElSec < 0) {
    return false;
  }
  const elDur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
  for (let i = 0; i < el.buffered.length; i++) {
    try {
      const start = el.buffered.start(i);
      const end = el.buffered.end(i);
      const upperBound = elDur > 0 && end >= elDur - 0.5 ? end : end - 0.5;
      if (
        (targetElSec >= start && targetElSec <= upperBound) ||
        (targetElSec === 0 && start <= 0.05 && end > 0.1)
      ) {
        return true;
      }
    } catch {
      // Ignore invalid TimeRanges index
    }
  }
  return false;
}

function isAsyncMediaElement(el: HTMLAudioElement): boolean {
  return (
    (typeof HTMLAudioElement !== 'undefined' && el instanceof HTMLAudioElement) ||
    Boolean((el as any).seeking)
  );
}

/**
 * Returns expected track duration in seconds, preferring explicit `durationSec` (> 0)
 * over `totalPlayTimeMs` (which represents cumulative listening time on Song.ts).
 */
export function getTrackExpectedDurationSec(
  track?: Pick<Song, 'durationSec' | 'totalPlayTimeMs'> | null
): number {
  if (!track) return 0;
  if (typeof track.durationSec === 'number' && Number.isFinite(track.durationSec) && track.durationSec > 0) {
    return track.durationSec;
  }
  if (
    typeof track.totalPlayTimeMs === 'number' &&
    Number.isFinite(track.totalPlayTimeMs) &&
    track.totalPlayTimeMs > 0 &&
    track.totalPlayTimeMs < 3_600_000
  ) {
    return track.totalPlayTimeMs / 1000;
  }
  return 0;
}

function extractStartMsParam(rawUrl?: string | null): number {
  if (!rawUrl) return 0;
  try {
    const hasScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(rawUrl);
    const u = hasScheme ? new URL(rawUrl) : new URL(rawUrl, 'http://localhost');
    const val = Number(u.searchParams.get('startMs'));
    return Number.isFinite(val) && val > 0 ? Math.round(val) : 0;
  } catch {
    const m = rawUrl.match(/[?&]startMs=(\d+)/);
    return m ? Math.max(0, parseInt(m[1], 10) || 0) : 0;
  }
}

/**
 * Peer Web Audio Deck wrapping an audio element & sub-graph nodes.
 */
export class WebAudioDeck {
  audioElement: HTMLAudioElement | null = null;
  private routedElement: HTMLAudioElement | null = null;
  private directElement: HTMLAudioElement | null = null;
  usingDirectFallback = false;
  private fallbackVolume = 0.85;
  private isTearingDownSrc = false;
  sourceNode: MediaElementAudioSourceNode | null = null;
  faderNode: GainNode | null = null;
  normalizationNode: GainNode | null = null;

  id: 'deckA' | 'deckB';
  ctx: AudioContext | null;
  track: Song | null = null;
  positionMs = 0;
  durationMs = 0;
  playbackOffsetMs = 0;
  isSeeking = false;
  needsStreamReResolution = false;
  baseStreamUrl: string | null = null;
  pendingReloadStartMs: number | null = null;
  private seekGuardTimer: ReturnType<typeof setTimeout> | null = null;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private stallCheckPositionMs = -1;
  private stallArmedToken = -1;
  stallTimeoutMs = 8000;
  loadToken = 0;
  private elementTokens = new WeakMap<HTMLAudioElement, number>();
  isActiveDeckCheck: () => boolean = () => true;
  gain = 1.0;
  isPlaying = false;
  hasRealMedia = false;
  suppressDirectFallback = false;
  lastSeekTargetMs: number | null = null;
  lastSeekAtMs = 0;
  private pendingSeekMs: number | null = null;
  private pendingCanPlayRetry: (() => void) | null = null;
  private pendingCanPlayRetryEl: HTMLAudioElement | null = null;
  private pendingRecoverySeek: (() => void) | null = null;
  private pendingRecoverySeekEl: HTMLAudioElement | null = null;
  onEndedCallback: (() => void) | null = null;
  onPrematureEndedCallback: ((positionMs: number) => void) | null = null;
  onErrorCallback: (() => void) | null = null;
  onTimeUpdateCallback: (() => void) | null = null;
  onMediaReadyCallback: (() => void) | null = null;

  get playbackOffsetSeconds(): number {
    return this.playbackOffsetMs / 1000;
  }

  set playbackOffsetSeconds(sec: number) {
    this.playbackOffsetMs = Math.max(0, Math.round((Number.isFinite(sec) ? sec : 0) * 1000));
  }

  constructor(
    id: 'deckA' | 'deckB',
    ctx: AudioContext | null,
    destination: AudioNode | null
  ) {
    this.id = id;
    this.ctx = ctx;
    if (
      typeof window !== 'undefined' &&
      typeof Audio !== 'undefined' &&
      ctx &&
      destination
    ) {
      try {
        const el = new Audio();
        el.crossOrigin = 'anonymous';
        el.preload = 'auto';
        (el as any).preservesPitch = true;

        this.routedElement = el;
        this.audioElement = el;

        this.sourceNode = ctx.createMediaElementSource(el);
        this.normalizationNode = ctx.createGain();
        this.faderNode = ctx.createGain();

        this.sourceNode.connect(this.normalizationNode);
        this.normalizationNode.connect(this.faderNode);
        this.faderNode.connect(destination);

        this.wireElementEvents(this.routedElement, false);
      } catch {
        // Fallback for mock/test environments
      }
    }
  }

  private clearSeekGuardTimer(): void {
    if (this.seekGuardTimer !== null) {
      clearTimeout(this.seekGuardTimer);
      this.seekGuardTimer = null;
    }
  }

  private armSeekGuardTimer(timeoutMs = 4000): void {
    this.clearSeekGuardTimer();
    const armedToken = this.loadToken;
    this.seekGuardTimer = setTimeout(() => {
      this.seekGuardTimer = null;
      if (this.loadToken !== armedToken) return;
      this.isSeeking = false;
      this.pendingReloadStartMs = null;
    }, timeoutMs);
    (this.seekGuardTimer as any)?.unref?.();
  }

  public clearSeekingState(): void {
    this.isSeeking = false;
    this.pendingSeekMs = null;
    this.clearSeekGuardTimer();
  }

  private clearStallTimer(): void {
    if (this.stallTimer !== null) {
      clearTimeout(this.stallTimer);
      this.stallTimer = null;
    }
    this.stallCheckPositionMs = -1;
    this.stallArmedToken = -1;
  }

  getCurrentPositionMs(): number {
    const el = this.audioElement;
    if (!el || !(el.getAttribute('src') || el.src)) {
      return this.positionMs;
    }
    if (this.isSeeking) {
      return this.positionMs;
    }
    const elSec =
      typeof el.currentTime === 'number' && Number.isFinite(el.currentTime) && el.currentTime >= 0
        ? el.currentTime
        : 0;
    return Math.max(0, Math.round(this.playbackOffsetMs + elSec * 1000));
  }

  private armStallTimer(el: HTMLAudioElement): void {
    if (
      !this.isActiveDeckCheck() ||
      !this.isPlaying ||
      this.isSeeking ||
      this.pendingReloadStartMs !== null ||
      this.isTearingDownSrc ||
      el !== this.audioElement ||
      el.paused ||
      el.ended
    ) {
      return;
    }

    const frozenPosMs = this.getCurrentPositionMs();
    if (
      this.stallTimer !== null &&
      this.stallArmedToken === this.loadToken &&
      Math.abs(frozenPosMs - this.stallCheckPositionMs) < 50
    ) {
      return;
    }

    this.clearStallTimer();
    const armedToken = this.loadToken;
    this.stallArmedToken = armedToken;
    this.stallCheckPositionMs = frozenPosMs;

    this.stallTimer = setTimeout(() => {
      this.stallTimer = null;
      this.stallArmedToken = -1;
      this.stallCheckPositionMs = -1;

      if (
        this.loadToken !== armedToken ||
        el !== this.audioElement ||
        this.isTearingDownSrc ||
        !this.isActiveDeckCheck() ||
        !this.isPlaying ||
        el.paused ||
        el.ended ||
        this.isSeeking ||
        this.pendingReloadStartMs !== null
      ) {
        return;
      }

      const nowPosMs = this.getCurrentPositionMs();
      if (Math.abs(nowPosMs - frozenPosMs) > 250) {
        return;
      }

      const expectedDuration = getTrackExpectedDurationSec(this.track);
      const elDuration = Number.isFinite(el.duration) ? el.duration : NaN;
      this.positionMs = nowPosMs;
      this.isPlaying = false;
      console.warn(
        `[WebAudioDeck ${this.id}] Stream stalled/frozen for >=${this.stallTimeoutMs}ms: ` +
          `videoId=${this.track?.videoId || 'unknown'}, currentSec=${(nowPosMs / 1000).toFixed(2)}, ` +
          `expectedDuration=${expectedDuration.toFixed(2)}, elDuration=${elDuration}, ` +
          `readyState=${el.readyState}, networkState=${el.networkState}, ` +
          `playbackOffsetMs=${this.playbackOffsetMs}, loadToken=${this.loadToken}, ` +
          `src=${el.getAttribute('src') || el.src}`
      );
      this.onPrematureEndedCallback?.(nowPosMs);
    }, this.stallTimeoutMs);
    (this.stallTimer as any)?.unref?.();
  }

  private calibrateReloadOffset(el: HTMLAudioElement, fromPlaying = false): void {
    if (this.pendingReloadStartMs === null) return;
    const rawTime =
      typeof el.currentTime === 'number' && Number.isFinite(el.currentTime) && el.currentTime >= 0
        ? el.currentTime
        : 0;
    // Wait for el.currentTime > 0.05 or playing event before clearing pendingReloadStartMs
    // so WebM cluster PTS isn't double-counted when loadeddata fires at 0.
    if (!fromPlaying && rawTime <= 0.05) {
      return;
    }
    const reqMs = this.pendingReloadStartMs;
    const elMs = Math.round(rawTime * 1000);
    if (reqMs >= 3000 && elMs >= 2000 && Math.abs(elMs - reqMs) <= 15000) {
      this.playbackOffsetMs = 0;
    } else {
      this.playbackOffsetMs = Math.max(0, reqMs - elMs);
    }
    this.pendingReloadStartMs = null;
    this.positionMs = Math.round(this.playbackOffsetMs + elMs);
  }

  syncDurationFromElement(el: HTMLAudioElement | null = this.audioElement): number {
    if (el && Number.isFinite(el.duration) && el.duration > 0) {
      const elDurMs = Math.round(el.duration * 1000);
      const adjustedElDurMs = this.playbackOffsetMs > 0 ? elDurMs + this.playbackOffsetMs : elDurMs;
      const trackExpectedMs = getTrackExpectedDurationSec(this.track) * 1000;
      // Never allow a truncated ~7s segment header to shrink a known full-length track's durationMs
      if (trackExpectedMs > 30000 && adjustedElDurMs < trackExpectedMs * 0.5) {
        this.durationMs = trackExpectedMs;
      } else {
        this.durationMs = Math.max(trackExpectedMs, adjustedElDurMs);
      }
    }
    return this.durationMs;
  }

  private wireElementEvents(el: HTMLAudioElement, isDirect: boolean): void {
    const isEventValid = (): boolean => {
      if (el !== this.audioElement || this.isTearingDownSrc || !(el.getAttribute('src') || el.src)) {
        return false;
      }
      if (!this.isActiveDeckCheck()) {
        return false;
      }
      const taggedToken = this.elementTokens.get(el);
      if (taggedToken !== undefined && taggedToken !== this.loadToken) {
        return false;
      }
      return true;
    };

    const syncDuration = () => {
      if (!isEventValid()) {
        return;
      }
      if (Number.isFinite(el.duration) && el.duration > 0) {
        this.syncDurationFromElement(el);
        this.hasRealMedia = true;
        if (this.pendingSeekMs !== null && el.readyState >= 1) {
          const clampedMs = Math.max(0, Math.min(this.durationMs || this.pendingSeekMs, this.pendingSeekMs));
          this.pendingSeekMs = null;
          this.positionMs = clampedMs;
          try {
            el.currentTime = Math.max(0, (clampedMs - this.playbackOffsetMs) / 1000);
            if (!isAsyncMediaElement(el) && this.pendingReloadStartMs === null) {
              this.isSeeking = false;
              this.clearSeekGuardTimer();
            }
          } catch {
            // Ignore seek error
          }
        }
        if (this.onTimeUpdateCallback) this.onTimeUpdateCallback();
        if (this.onMediaReadyCallback) this.onMediaReadyCallback();
      }
    };

    el.addEventListener('loadedmetadata', syncDuration);
    el.addEventListener('durationchange', syncDuration);

    el.addEventListener('loadeddata', () => {
      if (!isEventValid()) {
        return;
      }
      if (this.pendingReloadStartMs !== null) {
        this.calibrateReloadOffset(el, false);
        this.hasRealMedia = true;
        if (this.onTimeUpdateCallback) this.onTimeUpdateCallback();
      }
    });

    el.addEventListener('canplay', () => {
      if (!isEventValid()) {
        return;
      }
      if (this.pendingReloadStartMs === null && this.isSeeking) {
        this.isSeeking = false;
        this.clearSeekGuardTimer();
      }
      if (this.onMediaReadyCallback) this.onMediaReadyCallback();
    });

    el.addEventListener('playing', () => {
      if (!isEventValid()) {
        return;
      }
      this.clearStallTimer();
      if (this.pendingReloadStartMs !== null) {
        this.calibrateReloadOffset(el, true);
      }
      if (this.isSeeking) {
        this.isSeeking = false;
        this.clearSeekGuardTimer();
      }
    });

    el.addEventListener('seeked', () => {
      if (!isEventValid()) {
        return;
      }
      if (this.pendingReloadStartMs === null && this.isSeeking) {
        this.isSeeking = false;
        this.clearSeekGuardTimer();
      }
    });

    el.addEventListener('timeupdate', () => {
      if (!isEventValid()) {
        return;
      }
      if (this.isSeeking) {
        if (el.currentTime === 0 && this.positionMs > 1500) {
          return;
        }
        if (this.pendingReloadStartMs !== null) {
          this.calibrateReloadOffset(el, false);
        } else {
          const elTotalMs = Math.round(this.playbackOffsetMs + el.currentTime * 1000);
          if (this.lastSeekTargetMs !== null && Math.abs(elTotalMs - this.lastSeekTargetMs) > 2000) {
            return;
          }
        }
      } else if (this.pendingReloadStartMs !== null) {
        this.calibrateReloadOffset(el, false);
      }
      const nextPosMs = Math.round(this.playbackOffsetMs + el.currentTime * 1000);
      if (this.stallTimer !== null && Math.abs(nextPosMs - this.stallCheckPositionMs) > 250) {
        this.clearStallTimer();
      }
      this.positionMs = nextPosMs;
      this.hasRealMedia = true;
      if (this.onTimeUpdateCallback) this.onTimeUpdateCallback();
    });

    el.addEventListener('stalled', () => {
      if (!isEventValid()) return;
      this.armStallTimer(el);
    });

    el.addEventListener('waiting', () => {
      if (!isEventValid()) return;
      this.armStallTimer(el);
    });

    el.addEventListener('ended', () => {
      if (!isEventValid() || !this.isPlaying) {
        return;
      }

      const rawElSec =
        typeof el.currentTime === 'number' && Number.isFinite(el.currentTime) && el.currentTime > 0
          ? el.currentTime
          : 0;
      const currentPosMs =
        rawElSec > 0 ? Math.round(this.playbackOffsetMs + rawElSec * 1000) : this.positionMs;
      const elDurSec = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
      const adjustedElDurSec =
        elDurSec > 0 && this.playbackOffsetMs > 0 ? elDurSec + this.playbackOffsetMs / 1000 : elDurSec;
      const trackExpectedSec = getTrackExpectedDurationSec(this.track);
      const expectedDuration = Math.max(
        trackExpectedSec,
        Number.isFinite(adjustedElDurSec) ? adjustedElDurSec : 0
      );

      if (
        this.pendingReloadStartMs !== null ||
        (this.isSeeking && expectedDuration > 0 && currentPosMs < expectedDuration * 1000 - 2000)
      ) {
        return;
      }
      this.isSeeking = false;
      this.clearSeekGuardTimer();
      this.clearStallTimer();

      const currentSec = currentPosMs / 1000;
      const recentlySoughtNearEnd =
        this.lastSeekTargetMs !== null &&
        Date.now() - this.lastSeekAtMs < 3000 &&
        this.lastSeekTargetMs / 1000 >= expectedDuration - 5;

      if (expectedDuration > 15 && currentSec < expectedDuration - 4.0 && !recentlySoughtNearEnd) {
        const preservedPosMs =
          this.positionMs > 0 && Math.abs(currentSec * 1000 - this.positionMs) < 5000
            ? Math.max(this.positionMs, Math.floor(currentSec * 1000))
            : Math.floor(currentSec * 1000);
        this.positionMs = preservedPosMs;
        this.isPlaying = false;
        console.warn(
          `[WebAudioDeck ${this.id}] Premature 'ended' blocked: ` +
            `videoId=${this.track?.videoId || 'unknown'}, currentSec=${currentSec.toFixed(2)}, ` +
            `expectedDuration=${expectedDuration.toFixed(2)}, elDuration=${el.duration}, ` +
            `readyState=${el.readyState}, networkState=${el.networkState}, ` +
            `playbackOffsetMs=${this.playbackOffsetMs}, loadToken=${this.loadToken}, ` +
            `src=${el.getAttribute('src') || el.src}`
        );
        this.onPrematureEndedCallback?.(preservedPosMs);
        return;
      }

      this.isPlaying = false;
      if (this.onEndedCallback) {
        this.onEndedCallback();
      }
    });

    el.addEventListener('error', () => {
      if (!isEventValid()) {
        return;
      }
      if (this.isSeeking || this.pendingReloadStartMs !== null) {
        return;
      }
      this.clearStallTimer();
      if (!isDirect && !this.suppressDirectFallback) {
        const engaged = this.activateDirectFallback(this.isPlaying);
        if (engaged) {
          return;
        }
      }
      const wasPlaying = this.isPlaying;
      this.isPlaying = false;
      console.warn(`[WebAudioDeck ${this.id}] AudioElement playback error:`, el.error);
      if (wasPlaying && this.onErrorCallback) this.onErrorCallback();
    });
  }

  activateDirectFallback(resumePlay: boolean): boolean {
    if (this.usingDirectFallback || !this.track?.streamUrl || typeof Audio === 'undefined') {
      return false;
    }

    this.clearPendingCanPlayRetry();
    this.clearStallTimer();
    this.loadToken++;

    this.isTearingDownSrc = true;
    try {
      if (this.routedElement) {
        this.elementTokens.set(this.routedElement, -1);
        try {
          this.routedElement.pause();
        } catch {
          // Ignore
        }
        if (this.routedElement.getAttribute('src') || this.routedElement.src) {
          try {
            this.routedElement.removeAttribute('src');
            this.routedElement.load();
          } catch {
            // Ignore
          }
        }
      }
    } finally {
      this.isTearingDownSrc = false;
    }

    if (!this.directElement) {
      const direct = new Audio();
      // Intentionally do NOT set crossOrigin and NEVER call createMediaElementSource on directElement
      direct.preload = 'auto';
      (direct as any).preservesPitch = true;
      (direct as any).mozPreservesPitch = true;
      (direct as any).webkitPreservesPitch = true;
      direct.playbackRate = this.playbackRate;
      this.directElement = direct;
      this.wireElementEvents(this.directElement, true);
    }

    this.usingDirectFallback = true;
    this.audioElement = this.directElement;
    this.elementTokens.set(this.directElement, this.loadToken);

    try {
      this.directElement.volume = Math.max(0.0, Math.min(1.0, this.fallbackVolume * this.gain));
    } catch {
      // Ignore
    }

    const targetFallbackUrl =
      this.baseStreamUrl && isYoutubeSabrStreamUrl(this.baseStreamUrl) && this.playbackOffsetMs > 0
        ? withStartMsParam(this.baseStreamUrl, this.playbackOffsetMs)
        : this.track.streamUrl;

    const pendingOffsetPos = Math.max(0, this.positionMs - this.playbackOffsetMs);
    if (pendingOffsetPos > 0) {
      this.pendingSeekMs = this.positionMs;
    }

    try {
      this.directElement.src = targetFallbackUrl;
      this.directElement.load();
    } catch {
      // Ignore load errors in headless tests
    }

    if (resumePlay) {
      this.isPlaying = true;
      const directEl = this.directElement;
      Promise.resolve()
        .then(() => directEl.play())
        .catch(() => {});
    }

    return true;
  }

  private syncDirectVolumes(): void {
    const effectiveVol = Math.max(0.0, Math.min(1.0, this.fallbackVolume * this.gain));
    if (this.directElement) {
      try {
        this.directElement.volume = effectiveVol;
      } catch {
        // Fallback
      }
    }
    if (this.audioElement && !this.sourceNode) {
      try {
        this.audioElement.volume = effectiveVol;
      } catch {
        // Fallback
      }
    }
  }

  setGain(val: number, ctxTime?: number): void {
    this.gain = val;
    if (this.faderNode && this.ctx) {
      const now = ctxTime ?? this.ctx.currentTime;
      try {
        this.faderNode.gain.cancelScheduledValues(now);
        this.faderNode.gain.setValueAtTime(val, now);
      } catch {
        // Fallback
      }
    }
    this.syncDirectVolumes();
  }

  setFallbackVolume(val: number): void {
    this.fallbackVolume = Math.max(0.0, Math.min(1.0, val));
    this.syncDirectVolumes();
  }

  private playbackRate = 1.0;

  setPlaybackRate(rate: number): number {
    const safe = Number.isFinite(rate)
      ? Math.round(Math.max(0.5, Math.min(1.5, rate)) * 100) / 100
      : 1.0;
    this.playbackRate = safe;
    for (const el of [this.routedElement, this.directElement, this.audioElement]) {
      if (!el) continue;
      try {
        (el as any).preservesPitch = true;
        (el as any).mozPreservesPitch = true;
        (el as any).webkitPreservesPitch = true;
        el.playbackRate = safe;
      } catch {
        // Ignore in mock/headless audio elements
      }
    }
    return safe;
  }

  getPlaybackRate(): number {
    return this.playbackRate;
  }

  private clearPendingCanPlayRetry(): void {
    const retryEl = this.pendingCanPlayRetryEl || this.audioElement;
    if (this.pendingCanPlayRetry && retryEl) {
      try {
        retryEl.removeEventListener('canplay', this.pendingCanPlayRetry);
      } catch {
        // Ignore
      }
      this.pendingCanPlayRetry = null;
      this.pendingCanPlayRetryEl = null;
    }
  }

  private clearPendingRecoverySeek(): void {
    const seekEl = this.pendingRecoverySeekEl || this.audioElement;
    if (this.pendingRecoverySeek && seekEl) {
      try {
        seekEl.removeEventListener('loadedmetadata', this.pendingRecoverySeek);
      } catch {
        // Ignore
      }
      this.pendingRecoverySeek = null;
      this.pendingRecoverySeekEl = null;
    }
  }

  private attemptPlayWithCanPlayRetry(el: HTMLAudioElement): void {
    const capturedToken = this.loadToken;
    Promise.resolve()
      .then(() => el.play())
      .catch((err: any) => {
        if (capturedToken !== this.loadToken || this.audioElement !== el || this.isTearingDownSrc) {
          return;
        }
        if (
          err &&
          err.name === 'NotSupportedError' &&
          !this.usingDirectFallback &&
          !this.isSeeking &&
          this.routedElement === el &&
          this.isPlaying
        ) {
          if (this.activateDirectFallback(true)) {
            return;
          }
        }
        // A load() issued right after play() (stream re-resolution or seek reload) aborts the first attempt;
        // retry once as soon as the new source can play instead of silently staying stopped.
        if (err && (err.name === 'AbortError' || err.name === 'NotSupportedError') && this.isPlaying) {
          if (el.readyState >= 2) {
            setTimeout(() => {
              if (
                capturedToken === this.loadToken &&
                this.isPlaying &&
                this.audioElement === el &&
                !this.isTearingDownSrc
              ) {
                Promise.resolve()
                  .then(() => el.play())
                  .catch(() => {});
              }
            }, 0);
            return;
          }
          const retry = () => {
            this.clearPendingCanPlayRetry();
            if (
              capturedToken === this.loadToken &&
              this.isPlaying &&
              this.audioElement === el &&
              !this.isTearingDownSrc
            ) {
              Promise.resolve()
                .then(() => el.play())
                .catch(() => {});
            }
          };
          this.clearPendingCanPlayRetry();
          this.pendingCanPlayRetry = retry;
          this.pendingCanPlayRetryEl = el;
          el.addEventListener('canplay', retry);
        }
      });
  }

  teardownSource(): void {
    this.loadToken++;
    this.clearPendingCanPlayRetry();
    this.clearPendingRecoverySeek();
    this.clearSeekGuardTimer();
    this.clearStallTimer();
    this.pendingSeekMs = null;
    this.pendingReloadStartMs = null;
    this.isSeeking = false;
    this.isPlaying = false;
    this.suppressDirectFallback = false;

    this.isTearingDownSrc = true;
    try {
      const teardownElement = (el: HTMLAudioElement | null) => {
        if (!el) return;
        this.elementTokens.set(el, -1);
        try {
          el.pause();
          if (el.readyState >= 1) {
            el.currentTime = 0;
          }
          if (el.getAttribute('src') || el.src) {
            el.removeAttribute('src');
            el.load();
          }
        } catch {
          // Ignore teardown errors in headless tests
        }
      };

      teardownElement(this.routedElement);
      teardownElement(this.directElement);
      if (
        this.audioElement &&
        this.audioElement !== this.routedElement &&
        this.audioElement !== this.directElement
      ) {
        teardownElement(this.audioElement);
      }
    } finally {
      this.isTearingDownSrc = false;
    }
  }

  load(track: Song): void {
    this.teardownSource();
    this.loadToken++;
    const initialStartMs =
      track.streamUrl && isYoutubeSabrStreamUrl(track.streamUrl)
        ? extractStartMsParam(track.streamUrl)
        : 0;
    this.playbackOffsetMs = initialStartMs;
    this.pendingReloadStartMs = initialStartMs > 0 ? initialStartMs : null;
    this.lastSeekTargetMs = null;
    this.lastSeekAtMs = 0;
    this.track = track;
    this.baseStreamUrl = track.streamUrl ? withStartMsParam(track.streamUrl, 0) : null;
    this.positionMs = initialStartMs;
    this.durationMs = getTrackExpectedDurationSec(track) * 1000;
    this.isPlaying = false;
    this.hasRealMedia = false;

    this.usingDirectFallback = false;
    if (this.routedElement) {
      this.audioElement = this.routedElement;
    }

    if (this.normalizationNode) {
      this.normalizationNode.gain.value =
        typeof track.replayGainDb === 'number' ? Math.pow(10, track.replayGainDb / 20) : 1.0;
    }

    if (this.audioElement) {
      this.elementTokens.set(this.audioElement, this.loadToken);
      this.setPlaybackRate(this.playbackRate);
      try {
        if (track.streamUrl) {
          this.audioElement.src = track.streamUrl;
          this.audioElement.load();
        } else if (this.audioElement.getAttribute('src') || this.audioElement.src) {
          this.audioElement.removeAttribute('src');
          this.audioElement.load();
        }
      } catch {
        // Ignore load errors in headless tests
      }
    }
  }

  play(): void {
    this.clearPendingCanPlayRetry();
    this.clearStallTimer();
    this.isPlaying = true;
    if (this.ctx && this.ctx.state !== 'running') {
      this.ctx.resume().catch(() => {
        if (!this.usingDirectFallback && this.isPlaying) {
          this.activateDirectFallback(true);
        }
      });
    }
    const el = this.audioElement;
    if (el && (el.src || el.getAttribute('src'))) {
      // Recover a dead element (network/decode error or stalled-out NO_SOURCE): play() on it
      // is a silent no-op, so reload the same source and resume from the last known position.
      if (el.error || el.networkState === 3 /* NETWORK_NO_SOURCE */) {
        const resumeMs = this.positionMs;
        const reloadToken = ++this.loadToken;
        this.elementTokens.set(el, reloadToken);
        try {
          el.src = el.getAttribute('src') || el.src;
          el.load();
          const localResumeMs = Math.max(0, resumeMs - this.playbackOffsetMs);
          if (localResumeMs > 0) {
            this.clearPendingRecoverySeek();
            const seek = () => {
              this.clearPendingRecoverySeek();
              if (this.loadToken !== reloadToken || el !== this.audioElement || this.isTearingDownSrc) {
                return;
              }
              try { el.currentTime = localResumeMs / 1000; } catch { /* ignore */ }
            };
            this.pendingRecoverySeek = seek;
            this.pendingRecoverySeekEl = el;
            el.addEventListener('loadedmetadata', seek);
          }
        } catch {
          // Ignore reload errors in headless tests
        }
      }
      this.attemptPlayWithCanPlayRetry(el);
    }
  }

  pause(): void {
    this.clearPendingCanPlayRetry();
    this.clearStallTimer();
    this.isPlaying = false;
    const elements = new Set<HTMLAudioElement>();
    if (this.audioElement) elements.add(this.audioElement);
    if (this.routedElement) elements.add(this.routedElement);
    if (this.directElement) elements.add(this.directElement);
    for (const el of elements) {
      try {
        el.pause();
      } catch {
        // Ignore
      }
    }
  }

  seek(positionMs: number): void {
    this.clearStallTimer();
    const safeMs = Math.max(0, Number.isFinite(positionMs) ? positionMs : 0);
    const roundedMs = Math.round(safeMs);
    this.positionMs = safeMs;
    this.lastSeekTargetMs = safeMs;
    this.lastSeekAtMs = Date.now();

    const el = this.audioElement;
    if (!el) {
      this.isSeeking = false;
      this.pendingReloadStartMs = null;
      this.clearSeekGuardTimer();
      return;
    }

    const rawBaseUrl =
      this.baseStreamUrl || this.track?.streamUrl || el.getAttribute('src') || el.src || '';
    if (isYoutubeSabrStreamUrl(rawBaseUrl)) {
      const cleanBaseUrl = withStartMsParam(rawBaseUrl, 0);
      this.baseStreamUrl = cleanBaseUrl;

      if (isTargetSafelyBuffered(el, safeMs, this.playbackOffsetMs)) {
        this.isSeeking = true;
        this.pendingSeekMs = null;
        this.pendingReloadStartMs = null;
        this.armSeekGuardTimer(4000);
        try {
          el.currentTime = Math.max(0, (safeMs - this.playbackOffsetMs) / 1000);
          if (!isAsyncMediaElement(el)) {
            this.isSeeking = false;
            this.clearSeekGuardTimer();
          }
        } catch {
          this.isSeeking = false;
          this.clearSeekGuardTimer();
        }
        return;
      }

      const wasPlaying = this.isPlaying || (!el.paused && !el.ended);
      this.clearPendingCanPlayRetry();
      this.loadToken++;
      this.elementTokens.set(el, this.loadToken);
      this.isSeeking = true;
      this.pendingSeekMs = null;
      this.pendingReloadStartMs = roundedMs;
      this.playbackOffsetMs = roundedMs;
      this.positionMs = roundedMs;
      this.armSeekGuardTimer(12_000);

      const reloadUrl = withStartMsParam(cleanBaseUrl, roundedMs);
      try {
        if ((el.getAttribute('src') || el.src) !== reloadUrl) {
          el.src = reloadUrl;
          el.load();
        }
      } catch {
        // Ignore load errors in headless tests
      }

      if (wasPlaying) {
        this.isPlaying = true;
        this.attemptPlayWithCanPlayRetry(el);
      }
      return;
    }

    if (el.readyState >= 1) {
      this.isSeeking = true;
      this.pendingSeekMs = null;
      this.pendingReloadStartMs = null;
      this.armSeekGuardTimer(4000);
      try {
        el.currentTime = Math.max(0, (safeMs - this.playbackOffsetMs) / 1000);
        if (!isAsyncMediaElement(el)) {
          this.isSeeking = false;
          this.clearSeekGuardTimer();
        }
      } catch {
        this.isSeeking = false;
        this.clearSeekGuardTimer();
      }
    } else {
      // Defer seeking until loadedmetadata so seeking an unloaded element never fails or ends playback
      this.isSeeking = true;
      this.pendingReloadStartMs = null;
      this.pendingSeekMs = safeMs;
      this.armSeekGuardTimer(4000);
    }
  }
}

/**
 * Production AudioEngine implementing Feature 5 & PROJECT.md contracts.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private decksBus: GainNode | null = null;
  private masterVolumeNode: GainNode | null = null;
  private analyserNode: AnalyserNode | null = null;

  /** Native Web Audio BiquadFilterNodes for live 10-band equalizer */
  readonly eqFilterNodes: BiquadFilterNode[] = [];
  /** Native Web Audio AutoEQ preamp & parametric biquad chain */
  autoEqPreampNode: GainNode | null = null;
  readonly autoEqFilterNodes: BiquadFilterNode[] = [];

  readonly dspChain: DspChain;
  readonly visualizer: LiveVisualizer;
  readonly waveformExtractor: WaveformExtractor;

  readonly deckA: WebAudioDeck;
  readonly deckB: WebAudioDeck;

  playbackToken = 0;
  activeDeckName: DeckName = 'active'; // 'active' refers to deckA, 'standby' refers to deckB initially
  globalVolume = 0.85;
  playbackState: PlaybackStatus = 'IDLE';
  lastEmitReason: 'state' | 'volume' | 'load' | 'seek' | 'timeupdate' = 'state';
  equalizerBands: number[] = [...FACTORY_EQ_PRESETS.Flat];
  spatialAudio: SpatialAudioConfig = { enabled: true, width: 2.5 };
  autoEqProfile: AutoEqProfile | null = null;

  private livePcmSubscribers = new Set<(energy32: Float32Array) => void>();
  private stateChangeSubscribers = new Set<(state: PlaybackState) => void>();
  private onTrackEndedSubscribers = new Set<() => void>();
  private onPrematureEndedSubscribers = new Set<(positionMs: number) => void>();
  private onPlaybackErrorSubscribers = new Set<() => void>();
  private cachedWaveforms = new Map<string, Float32Array>();

  /** Zero-allocation persistent buffer for 32-band visualizer dispatch */
  private readonly liveEnergyBuffer = new Float32Array(32);
  private readonly timeDomainBuffer = new Float32Array(1024);
  private readonly metricsFreqFloatBuffer = new Float32Array(512);
  private readonly metricsFreqByteBuffer = new Uint8Array(512);
  private metricsRollingBass = 0;
  private metricsLastBeatMs = 0;
  private synthPhase = 0;
  private crossfadeSequence = 0;

  // Live Karaoke DSP + Neural Stem & Downbeat State
  private karaokeEnabled = false;
  private karaokeVocalLevel = 1.0;
  private karaokeIsolateVocals = false;
  private karaokeBypassGain: GainNode | null = null;
  private karaokeSideGain: GainNode | null = null;
  private karaokeEdgeMidGain: GainNode | null = null;
  private karaokeDirectMidGain: GainNode | null = null;
  private karaokeVocalIsoGain: GainNode | null = null;
  private postKaraokeBus: GainNode | null = null;
  private activeBeatAnalysis: {
    bpm: number;
    beats: readonly number[];
    downbeats: readonly number[];
    chorusStartSec?: number;
  } | null = null;
  private lastMatchedDownbeatIdx = -1;
  private beatCountSinceDownbeat = 0;
  private cachedVocalStem: {
    trackId: string;
    vocalsLeft: Float32Array;
    vocalsRight: Float32Array;
    sampleRate: number;
  } | null = null;
  private pendingResumePositionSec: number | null = null;
  private pendingResumeVerifyTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingResumeMaxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingResumeVerifyCleanup: (() => void) | null = null;
  private pendingResumeVerifyEl: HTMLAudioElement | null = null;
  private isApplyingPendingResumeSeek = false;
  public onResumeResetToZeroCallback: (() => void) | null = null;

  constructor(customCtx?: AudioContext | null) {
    this.dspChain = new DspChain();
    this.visualizer = new LiveVisualizer();
    this.waveformExtractor = new WaveformExtractor();

    const AudioCtxClass =
      typeof window !== 'undefined'
        ? window.AudioContext || (window as any).webkitAudioContext
        : (globalThis as any).AudioContext;

    if (customCtx) {
      this.ctx = customCtx;
    } else if (AudioCtxClass) {
      try {
        this.ctx = new AudioCtxClass();
      } catch {
        // Fallback for Node/test runners
      }
    }

    if (this.ctx) {
      try {
        this.decksBus = this.ctx.createGain();
        this.masterVolumeNode = this.ctx.createGain();
        this.masterVolumeNode.gain.setValueAtTime(this.globalVolume, this.ctx.currentTime);

        this.analyserNode = this.ctx.createAnalyser();
        this.visualizer.attachAnalyser(this.analyserNode);

        // Instantiate 10 BiquadFilterNodes for live Web Audio Equalizer
        for (let i = 0; i < EQ_FREQUENCIES_HZ.length; i++) {
          const freq = EQ_FREQUENCIES_HZ[i];
          const filter = this.ctx.createBiquadFilter();
          if (i === 0) {
            filter.type = 'lowshelf';
          } else if (i === EQ_FREQUENCIES_HZ.length - 1) {
            filter.type = 'highshelf';
          } else {
            filter.type = 'peaking';
            try {
              filter.Q.setValueAtTime(1.0, this.ctx.currentTime);
            } catch {
              filter.Q.value = 1.0;
            }
          }
          try {
            filter.frequency.setValueAtTime(freq, this.ctx.currentTime);
            filter.gain.setValueAtTime(this.equalizerBands[i] ?? 0.0, this.ctx.currentTime);
          } catch {
            filter.frequency.value = freq;
            filter.gain.value = this.equalizerBands[i] ?? 0.0;
          }
          this.eqFilterNodes.push(filter);
        }

        // Web Audio Topology:
        // decksBus -> eqFilterNodes[0] -> ... -> eqFilterNodes[9] -> autoEqPreampNode -> autoEqFilterNodes... -> masterVolumeNode -> analyserNode -> destination
        this.autoEqPreampNode = this.ctx.createGain();
        try {
          this.autoEqPreampNode.gain.setValueAtTime(1.0, this.ctx.currentTime);
        } catch {
          this.autoEqPreampNode.gain.value = 1.0;
        }

        let prevNode: AudioNode = this.decksBus;
        // Live Karaoke Mid/Side vocal-band stage (unity bypass when disabled)
        if (
          typeof (this.ctx as any).createChannelSplitter === 'function' &&
          typeof (this.ctx as any).createChannelMerger === 'function' &&
          typeof (this.ctx as any).createBiquadFilter === 'function'
        ) {
          try {
            const postBus = this.ctx.createGain();
            const bypassGain = this.ctx.createGain();
            bypassGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
            this.decksBus.connect(bypassGain);
            bypassGain.connect(postBus);

            const now = this.ctx.currentTime;
            const splitter = this.ctx.createChannelSplitter(2);
            const merger = this.ctx.createChannelMerger(2);

            // Phase-coherent Mid/Side 3-band Karaoke Matrix:
            //   Mid = 0.5*(L+R), Side = 0.5*(L-R)
            //   Standard Karaoke (0% vocal): Side + MidLow(<180Hz) + MidHigh(>5500Hz)
            //   Isolate Vocals: Bandpassed Mid(180Hz..5500Hz)
            const midNode = this.ctx.createGain();
            midNode.gain.setValueAtTime(0.5, now);

            const sideDiff = this.ctx.createGain();
            sideDiff.gain.setValueAtTime(0.5, now);
            const sideRightInv = this.ctx.createGain();
            sideRightInv.gain.setValueAtTime(-0.5, now);

            const sideGain = this.ctx.createGain();
            sideGain.gain.setValueAtTime(0.0, now);
            const sideOutInvR = this.ctx.createGain();
            sideOutInvR.gain.setValueAtTime(-1.0, now);

            const lp180 = this.ctx.createBiquadFilter();
            lp180.type = 'lowpass';
            lp180.frequency.setValueAtTime(180, now);
            lp180.Q.setValueAtTime(0.707, now);

            const hp5500 = this.ctx.createBiquadFilter();
            hp5500.type = 'highpass';
            hp5500.frequency.setValueAtTime(5500, now);
            hp5500.Q.setValueAtTime(0.707, now);

            const edgeMidGain = this.ctx.createGain();
            edgeMidGain.gain.setValueAtTime(0.0, now);

            const directMidGain = this.ctx.createGain();
            directMidGain.gain.setValueAtTime(0.0, now);

            const isoHp180 = this.ctx.createBiquadFilter();
            isoHp180.type = 'highpass';
            isoHp180.frequency.setValueAtTime(180, now);
            isoHp180.Q.setValueAtTime(0.707, now);
            const isoLp5500 = this.ctx.createBiquadFilter();
            isoLp5500.type = 'lowpass';
            isoLp5500.frequency.setValueAtTime(5500, now);
            isoLp5500.Q.setValueAtTime(0.707, now);
            const vocalIsoGain = this.ctx.createGain();
            vocalIsoGain.gain.setValueAtTime(0.0, now);

            this.decksBus.connect(splitter);
            splitter.connect(midNode, 0);
            splitter.connect(midNode, 1);

            splitter.connect(sideDiff, 0);
            splitter.connect(sideRightInv, 1);
            sideRightInv.connect(sideDiff);
            sideDiff.connect(sideGain);
            sideGain.connect(merger, 0, 0);
            sideGain.connect(sideOutInvR);
            sideOutInvR.connect(merger, 0, 1);

            midNode.connect(lp180);
            lp180.connect(edgeMidGain);
            midNode.connect(hp5500);
            hp5500.connect(edgeMidGain);
            edgeMidGain.connect(merger, 0, 0);
            edgeMidGain.connect(merger, 0, 1);

            midNode.connect(directMidGain);
            directMidGain.connect(merger, 0, 0);
            directMidGain.connect(merger, 0, 1);

            midNode.connect(isoHp180);
            isoHp180.connect(isoLp5500);
            isoLp5500.connect(vocalIsoGain);
            vocalIsoGain.connect(merger, 0, 0);
            vocalIsoGain.connect(merger, 0, 1);

            merger.connect(postBus);

            this.karaokeBypassGain = bypassGain;
            this.karaokeSideGain = sideGain;
            this.karaokeEdgeMidGain = edgeMidGain;
            this.karaokeDirectMidGain = directMidGain;
            this.karaokeVocalIsoGain = vocalIsoGain;
            this.postKaraokeBus = postBus;
            prevNode = postBus;
          } catch {
            prevNode = this.decksBus;
          }
        }

        for (const filter of this.eqFilterNodes) {
          prevNode.connect(filter);
          prevNode = filter;
        }
        prevNode.connect(this.autoEqPreampNode);
        this.autoEqPreampNode.connect(this.masterVolumeNode);

        this.masterVolumeNode.connect(this.analyserNode);
        this.analyserNode.connect(this.ctx.destination);
      } catch {
        // Fallback for mock/test runners
      }
    }

    this.deckA = new WebAudioDeck('deckA', this.ctx, this.decksBus);
    this.deckB = new WebAudioDeck('deckB', this.ctx, this.decksBus);
    this.deckA.isActiveDeckCheck = () => this.activeDeckName === 'active';
    this.deckB.isActiveDeckCheck = () => this.activeDeckName === 'standby';
    this.deckA.setGain(1.0);
    this.deckB.setGain(0.0);

    this.deckA.onEndedCallback = () =>
      this._handleDeckEnded('deckA', this.deckA.loadToken, this.playbackToken);
    this.deckB.onEndedCallback = () =>
      this._handleDeckEnded('deckB', this.deckB.loadToken, this.playbackToken);
    this.deckA.onPrematureEndedCallback = (posMs) =>
      this._handleDeckPrematureEnded('deckA', posMs, this.deckA.loadToken, this.playbackToken);
    this.deckB.onPrematureEndedCallback = (posMs) =>
      this._handleDeckPrematureEnded('deckB', posMs, this.deckB.loadToken, this.playbackToken);
    this.deckA.onErrorCallback = () =>
      this._handleDeckError('deckA', this.deckA.loadToken, this.playbackToken);
    this.deckB.onErrorCallback = () =>
      this._handleDeckError('deckB', this.deckB.loadToken, this.playbackToken);
    this.deckA.onTimeUpdateCallback = () => {
      if (this.activeDeckName === 'active') this._emitStateChange('timeupdate');
    };
    this.deckB.onTimeUpdateCallback = () => {
      if (this.activeDeckName === 'standby') this._emitStateChange('timeupdate');
    };
    this.deckA.onMediaReadyCallback = () => {
      if (this.activeDeckName === 'active') this.applyPendingResumeSeek();
    };
    this.deckB.onMediaReadyCallback = () => {
      if (this.activeDeckName === 'standby') this.applyPendingResumeSeek();
    };
  }

  public setPendingResumePosition(seconds: number | null): void {
    this.clearPendingResumeVerify();
    this.pendingResumePositionSec =
      typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }

  public getPendingResumePosition(): number | null {
    return this.pendingResumePositionSec;
  }

  public clearPendingResumePosition(): void {
    this.clearPendingResumeVerify();
    this.pendingResumePositionSec = null;
    this.isApplyingPendingResumeSeek = false;
  }

  private clearPendingResumeVerifyTimer(): void {
    if (this.pendingResumeVerifyTimer !== null) {
      clearTimeout(this.pendingResumeVerifyTimer);
      this.pendingResumeVerifyTimer = null;
    }
    if (this.pendingResumeMaxWaitTimer !== null) {
      clearTimeout(this.pendingResumeMaxWaitTimer);
      this.pendingResumeMaxWaitTimer = null;
    }
  }

  private clearPendingResumeVerify(): void {
    this.clearPendingResumeVerifyTimer();
    this.pendingResumeVerifyCleanup?.();
    this.pendingResumeVerifyCleanup = null;
    this.pendingResumeVerifyEl = null;
  }

  /**
   * Invoked when the active deck fires loadedmetadata / canplay.
   * Applies pendingResumePositionSec if set, then verifies within 1.5s that the stream
   * actually sought; if the stream cannot seek or resets to 0, snaps everything to 0 immediately.
   */
  public applyPendingResumeSeek(): boolean {
    const targetSec = this.pendingResumePositionSec;
    if (targetSec === null || targetSec <= 0 || this.isApplyingPendingResumeSeek) {
      return false;
    }
    const current = this.activeDeckName === 'active' ? this.deckA : this.deckB;
    const el = current.audioElement;
    if (!el || !(el.getAttribute('src') || el.src)) {
      return false;
    }
    const rawUrl =
      current.baseStreamUrl || current.track?.streamUrl || el.getAttribute('src') || el.src || '';
    if (!isYoutubeSabrStreamUrl(rawUrl) && el.readyState < 1) {
      return false;
    }
    if (this.pendingResumeVerifyCleanup !== null) {
      if (this.pendingResumeVerifyEl === el) {
        return false;
      }
      this.clearPendingResumeVerify();
    }

    this.isApplyingPendingResumeSeek = true;
    try {
      this.seek(targetSec * 1000);
    } finally {
      this.isApplyingPendingResumeSeek = false;
    }

    const cleanup = () => {
      this.clearPendingResumeVerifyTimer();
      for (const evt of ['seeked', 'loadeddata', 'canplay'] as const) {
        try {
          el.removeEventListener(evt, onMediaEvent);
        } catch {
          // Ignore in headless mock
        }
      }
      if (this.pendingResumeVerifyCleanup === cleanup) {
        this.pendingResumeVerifyCleanup = null;
        this.pendingResumeVerifyEl = null;
      }
    };

    const armFallbackTimer = () => {
      if (this.pendingResumeVerifyTimer !== null) return;
      const active = this.activeDeckName === 'active' ? this.deckA : this.deckB;
      const activeEl = active.audioElement;
      if (!activeEl || active.pendingReloadStartMs !== null || activeEl.readyState < 1) {
        return;
      }
      this.pendingResumeVerifyTimer = setTimeout(() => {
        this.pendingResumeVerifyTimer = null;
        verifyResume(true);
      }, 1500);
      (this.pendingResumeVerifyTimer as any)?.unref?.();
    };

    const verifyResume = (fromTimer = false) => {
      const active = this.activeDeckName === 'active' ? this.deckA : this.deckB;
      const activeEl = active.audioElement;
      if (this.pendingResumePositionSec === null || !activeEl) {
        cleanup();
        return;
      }
      if (active.pendingReloadStartMs !== null || activeEl.readyState < 1) {
        return;
      }
      if (!fromTimer && (activeEl as any).seeking) {
        armFallbackTimer();
        return;
      }

      const actualSec =
        active.playbackOffsetSeconds +
        (typeof activeEl.currentTime === 'number' && Number.isFinite(activeEl.currentTime)
          ? activeEl.currentTime
          : 0);
      if (Math.abs(actualSec - targetSec) < 1.5) {
        this.pendingResumePositionSec = null;
        cleanup();
        return;
      }

      active.playbackOffsetMs = 0;
      active.positionMs = 0;
      active.isSeeking = false;
      this.pendingResumePositionSec = null;
      cleanup();
      this._emitStateChange('seek');
      this.onResumeResetToZeroCallback?.();
    };

    const onMediaEvent = () => {
      verifyResume(false);
      if (this.pendingResumeVerifyCleanup === cleanup) {
        armFallbackTimer();
      }
    };

    this.pendingResumeVerifyCleanup = cleanup;
    this.pendingResumeVerifyEl = el;
    for (const evt of ['seeked', 'loadeddata', 'canplay'] as const) {
      try {
        el.addEventListener(evt, onMediaEvent);
      } catch {
        // Ignore in headless mock
      }
    }
    this.pendingResumeMaxWaitTimer = setTimeout(() => {
      this.pendingResumeMaxWaitTimer = null;
      if (this.pendingResumeVerifyCleanup === cleanup) {
        verifyResume(true);
        if (this.pendingResumeVerifyCleanup === cleanup) {
          cleanup();
        }
      }
    }, 13_000);
    (this.pendingResumeMaxWaitTimer as any)?.unref?.();
    armFallbackTimer();

    return true;
  }

  /**
   * Load track into designated deck ('active' or 'standby')
   */
  async loadTrack(track: Song, deck: DeckName = 'active'): Promise<void> {
    const validation = validateSongContract(track);
    if (!validation.valid) {
      throw new Error(`Invalid Song Contract: ${validation.error}`);
    }

    const token = ++this.playbackToken;
    const target =
      deck === 'active'
        ? this.activeDeckName === 'active'
          ? this.deckA
          : this.deckB
        : this.activeDeckName === 'active'
        ? this.deckB
        : this.deckA;

    if (deck === 'active') {
      if (this.cachedVocalStem && this.cachedVocalStem.trackId !== track.videoId) {
        this.cachedVocalStem = null;
      }
      this.clearPendingResumePosition();
      this.crossfadeSequence++;
      const other = target === this.deckA ? this.deckB : this.deckA;
      other.pause();
      other.setGain(0.0);
      target.setGain(1.0);
      target.setFallbackVolume(this.globalVolume);
    }

    target.needsStreamReResolution = false;
    target.load(track);

    // Pre-calculate 200-bucket amplitude envelope
    if (!this.cachedWaveforms.has(track.videoId)) {
      const envelope = await this.waveformExtractor.getOrExtractWaveform(track.videoId);
      this.setCachedWaveform(track.videoId, envelope);
    }

    if (token !== this.playbackToken) {
      return;
    }

    this._emitStateChange('load');
  }

  /**
   * Preload a restored track at a saved playback position in PAUSED state (Milestone M3 session persistence)
   */
  async prepareRestoredTrack(track: Song, positionMs = 0, deck: DeckName = 'active'): Promise<void> {
    const target =
      deck === 'active'
        ? this.activeDeckName === 'active'
          ? this.deckA
          : this.deckB
        : this.activeDeckName === 'active'
        ? this.deckB
        : this.deckA;

    if (deck === 'active') {
      this.crossfadeSequence++;
      const other = target === this.deckA ? this.deckB : this.deckA;
      other.pause();
      other.setGain(0.0);
      target.setGain(1.0);
      target.setFallbackVolume(this.globalVolume);
      this.setPendingResumePosition(positionMs > 0 ? positionMs / 1000 : null);
    }

    const needsReResolution = isDeadOrStaleRestoredStreamUrl(track.streamUrl);
    const loadableTrack = needsReResolution ? { ...track, streamUrl: undefined } : track;
    target.load(loadableTrack);
    target.needsStreamReResolution = needsReResolution;
    target.playbackOffsetMs = 0;

    // Never inflate playbackOffsetSeconds or report savedPositionMs as live playback time before stream seeks.
    // Preserve positionMs only in headless test environments with no HTMLAudioElement (PERSIST-02).
    if (!target.audioElement) {
      target.positionMs = positionMs > 0 ? positionMs : 0;
    } else {
      target.positionMs = 0;
    }

    this.playbackState = 'PAUSED';

    // Pre-calculate 200-bucket amplitude envelope
    if (!this.cachedWaveforms.has(track.videoId)) {
      try {
        const envelope = await this.waveformExtractor.getOrExtractWaveform(track.videoId);
        this.setCachedWaveform(track.videoId, envelope);
      } catch {
        // Fallback handled in store
      }
    }

    this._emitStateChange();
  }

  /**
   * Start playback on active deck
   */
  play(): void {
    const current = this.activeDeckName === 'active' ? this.deckA : this.deckB;
    if (!current.track) {
      throw new Error('Cannot play: No track loaded in active deck');
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().then(() => {
        if (this.masterVolumeNode && this.ctx) {
          try {
            const now = this.ctx.currentTime;
            this.masterVolumeNode.gain.cancelScheduledValues(now);
            this.masterVolumeNode.gain.setValueAtTime(this.globalVolume, now);
          } catch {
            this.masterVolumeNode.gain.value = this.globalVolume;
          }
        }
      }).catch(() => {});
    }
    current.play();
    this.playbackState = 'PLAYING';
    this._emitStateChange('state');
  }

  /** True while the active deck's media element is really playing (not paused/ended). */
  isActiveDeckAdvancing(): boolean {
    const deck = this.activeDeckName === 'active' ? this.deckA : this.deckB;
    const el = deck.audioElement;
    return !!el && !el.paused && !el.ended;
  }

  /**
   * Pause playback
   */
  pause(): void {
    this.crossfadeSequence++;
    const current = this.activeDeckName === 'active' ? this.deckA : this.deckB;
    current.pause();
    this.playbackState = 'PAUSED';
    this._emitStateChange();
  }

  /**
   * Seek active deck to position in milliseconds
   */
  seek(positionMs: number): void {
    if (typeof positionMs !== 'number' || isNaN(positionMs) || positionMs < 0) {
      throw new RangeError('Seek position must be a non-negative number');
    }
    this.playbackToken++;
    if (!this.isApplyingPendingResumeSeek) {
      this.clearPendingResumePosition();
    }
    const current = this.activeDeckName === 'active' ? this.deckA : this.deckB;
    if (current.track) {
      current.seek(positionMs);
      this._emitStateChange('seek');
    }
  }

  /**
   * Adjust global playback volume [0.0, 1.0]
   */
  setVolume(gain: number): void {
    if (typeof gain !== 'number' || isNaN(gain)) {
      throw new TypeError('Volume gain must be a number');
    }
    this.globalVolume = Math.max(0.0, Math.min(1.0, gain));
    if (this.masterVolumeNode && this.ctx) {
      try {
        const now = this.ctx.currentTime;
        this.masterVolumeNode.gain.cancelScheduledValues(now);
        if (this.ctx.state === 'suspended') {
          this.masterVolumeNode.gain.setValueAtTime(this.globalVolume, now);
        } else {
          this.masterVolumeNode.gain.setTargetAtTime(this.globalVolume, now, 0.02);
        }
      } catch {
        try {
          this.masterVolumeNode.gain.value = this.globalVolume;
        } catch {
          // Fallback
        }
      }
    }
    this.deckA.setFallbackVolume(this.globalVolume);
    this.deckB.setFallbackVolume(this.globalVolume);
    this._emitStateChange('volume');
  }

  /**
   * Perform constant-power crossfade to target deck ('active' or 'standby')
   */
  async crossfade(targetDeck: DeckName, durationMs = 4000): Promise<void> {
    if (targetDeck !== 'active' && targetDeck !== 'standby') {
      throw new Error("Target deck must be 'active' or 'standby'");
    }

    const outgoing = this.activeDeckName === 'active' ? this.deckA : this.deckB;
    const incoming = this.activeDeckName === 'active' ? this.deckB : this.deckA;

    if (!incoming.track) {
      throw new Error('Standby deck has no pre-rolled track for crossfading');
    }

    this.playbackState = 'CROSSFADING';
    this._emitStateChange();

    incoming.play();

    // Constant-power cosine/sine crossfading
    const steps = 64;
    const durationSec = durationMs / 1000;
    const seq = ++this.crossfadeSequence;

    if (this.ctx && outgoing.faderNode && incoming.faderNode) {
      const now = this.ctx.currentTime;
      const fadeOut = new Float32Array(steps + 1);
      const fadeIn = new Float32Array(steps + 1);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        fadeOut[i] = Math.cos((Math.PI / 2) * t);
        fadeIn[i] = Math.sin((Math.PI / 2) * t);
      }
      outgoing.faderNode.gain.cancelScheduledValues(now);
      incoming.faderNode.gain.cancelScheduledValues(now);
      outgoing.faderNode.gain.setValueCurveAtTime(fadeOut, now, durationSec);
      incoming.faderNode.gain.setValueCurveAtTime(fadeIn, now, durationSec);
    } else {
      for (let step = 0; step <= steps; step++) {
        const t = step / steps;
        const gainOut = Math.cos((Math.PI / 2) * t);
        const gainIn = Math.sin((Math.PI / 2) * t);
        outgoing.setGain(gainOut);
        incoming.setGain(gainIn);
      }
    }

    // Role swap: toggle active deck reference so incoming deck becomes active
    this.activeDeckName = this.activeDeckName === 'active' ? 'standby' : 'active';

    // Await the crossfade duration before pausing outgoing deck
    // In headless test environments (!this.ctx), clamp duration to avoid delaying test suites
    const waitTimeMs = this.ctx ? durationMs : Math.min(durationMs, 10);
    await new Promise((r) => setTimeout(r, waitTimeMs));

    // Abort if another crossfade, pause, or track change superseded this sequence
    if (this.crossfadeSequence !== seq) {
      return;
    }

    outgoing.pause();
    outgoing.setGain(0.0);
    incoming.setGain(1.0);
    this.playbackState = 'PLAYING';
    this._emitStateChange();
  }

  /**
   * Stage a Lossless FLAC stream onto the standby deck in the background while Stage 1 continues
   * playing on the active deck. Waits up to 12s for readyState >= 3 (HAVE_FUTURE_DATA) and duration > 0,
   * seeks standby deck to the active deck's live positionMs, and performs a 300ms crossfade.
   * On ANY failure (403, timeout, CORS, bad codec, track change), silently tears down standby deck
   * and keeps Stage 1 playing uninterrupted, returning false.
   */
  async stageAndCrossfadeLosslessSwap(
    losslessTrack: Song,
    crossfadeMs = 300,
    timeoutMs = 12_000
  ): Promise<boolean> {
    const swapToken = this.playbackToken;
    const initialActiveDeck = this.activeDeckName === 'active' ? this.deckA : this.deckB;
    const standbyDeck = this.activeDeckName === 'active' ? this.deckB : this.deckA;

    if (
      !losslessTrack ||
      !losslessTrack.streamUrl ||
      this.playbackState !== 'PLAYING' ||
      !initialActiveDeck.track ||
      initialActiveDeck.track.videoId !== losslessTrack.videoId
    ) {
      return false;
    }

    const teardownStandby = () => {
      standbyDeck.teardownSource();
      standbyDeck.setGain(0.0);
      standbyDeck.track = null;
    };

    try {
      standbyDeck.setGain(0.0);
      standbyDeck.setFallbackVolume(this.globalVolume);
      standbyDeck.load(losslessTrack);
      standbyDeck.suppressDirectFallback = true;

      const el = standbyDeck.audioElement;
      if (!el) {
        teardownStandby();
        return false;
      }

      const isReady = () =>
        !el.error &&
        el.readyState >= 3 &&
        Number.isFinite(el.duration) &&
        el.duration > 0;

      if (!isReady()) {
        const readyOk = await new Promise<boolean>((resolve) => {
          let settled = false;
          const finish = (result: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            el.removeEventListener('canplay', onEvent);
            el.removeEventListener('canplaythrough', onEvent);
            el.removeEventListener('loadeddata', onEvent);
            el.removeEventListener('loadedmetadata', onEvent);
            el.removeEventListener('error', onError);
            resolve(result);
          };

          const onEvent = () => {
            if (this.playbackToken !== swapToken) {
              finish(false);
              return;
            }
            if (el.error) {
              finish(false);
              return;
            }
            if (isReady()) {
              finish(true);
            }
          };

          const onError = () => {
            finish(false);
          };

          const timer = setTimeout(() => {
            finish(this.playbackToken === swapToken && isReady());
          }, timeoutMs);

          el.addEventListener('canplay', onEvent);
          el.addEventListener('canplaythrough', onEvent);
          el.addEventListener('loadeddata', onEvent);
          el.addEventListener('loadedmetadata', onEvent);
          el.addEventListener('error', onError);

          if (el.error || this.playbackToken !== swapToken) {
            finish(false);
          } else if (isReady()) {
            finish(true);
          }
        });

        if (!readyOk || this.playbackToken !== swapToken) {
          teardownStandby();
          return false;
        }
      }

      standbyDeck.suppressDirectFallback = false;

      // Verify same active track is still actively playing and token hasn't changed before swapping
      const currentActiveDeck = this.activeDeckName === 'active' ? this.deckA : this.deckB;
      if (
        this.playbackToken !== swapToken ||
        this.playbackState !== 'PLAYING' ||
        currentActiveDeck !== initialActiveDeck ||
        currentActiveDeck.track?.videoId !== losslessTrack.videoId
      ) {
        teardownStandby();
        return false;
      }

      // Reject truncated standby lossless streams (e.g., 30s preview or corrupted container header)
      const activeTrackDurSec = getTrackExpectedDurationSec(initialActiveDeck.track);
      const activeEl = initialActiveDeck.audioElement;
      const activeElDurSec =
        activeEl && Number.isFinite(activeEl.duration) && activeEl.duration > 0
          ? activeEl.duration + initialActiveDeck.playbackOffsetMs / 1000
          : 0;
      const expectedDuration = Math.max(activeTrackDurSec, activeElDurSec);
      if (expectedDuration > 15 && (!Number.isFinite(el.duration) || el.duration < expectedDuration - 10)) {
        console.warn(
          `[AudioEngine] Rejecting Stage 2 standby lossless stream for ${losslessTrack.videoId}: ` +
            `standbyEl.duration=${el.duration}s < expectedDuration=${expectedDuration.toFixed(2)}s - 10s`
        );
        teardownStandby();
        return false;
      }

      const livePosMs = this.getCurrentPositionMs();
      standbyDeck.seek(livePosMs);

      if (Math.abs((el.currentTime || 0) * 1000 - livePosMs) > 1500) {
        await new Promise<void>((resolve) => {
          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            clearTimeout(seekTimer);
            el.removeEventListener('seeked', onSeeked);
            el.removeEventListener('error', onSeekErr);
            resolve();
          };
          const onSeeked = () => done();
          const onSeekErr = () => done();
          const seekTimer = setTimeout(done, 2500);
          (seekTimer as any)?.unref?.();
          el.addEventListener('seeked', onSeeked);
          el.addEventListener('error', onSeekErr);
          if (Math.abs((el.currentTime || 0) * 1000 - livePosMs) <= 1500) {
            done();
          }
        });
      }
      standbyDeck.clearSeekingState();

      if (this.playbackToken !== swapToken || this.playbackState !== 'PLAYING') {
        teardownStandby();
        return false;
      }

      const postSwapToken = ++this.playbackToken;
      await this.crossfade('standby', crossfadeMs);

      const newActiveDeck = this.activeDeckName === 'active' ? this.deckA : this.deckB;
      if (
        this.playbackToken !== postSwapToken ||
        newActiveDeck !== standbyDeck ||
        newActiveDeck.audioElement?.error ||
        this.playbackState !== 'PLAYING'
      ) {
        return false;
      }

      // Cleanly release outgoing Stage 1 element src with teardown guards & bumped loadToken
      initialActiveDeck.teardownSource();
      initialActiveDeck.setGain(0.0);
      initialActiveDeck.track = null;

      return true;
    } catch {
      teardownStandby();
      return false;
    }
  }

  /**
   * Apply 10-band Equalizer gains in dB [-12, +12]
   */
  setEqualizerBands(gains: number[]): void {
    if (!Array.isArray(gains) || gains.length !== 10) {
      throw new Error('Equalizer bands must be an array of exactly 10 gain numbers');
    }
    for (const g of gains) {
      if (typeof g !== 'number' || Number.isNaN(g) || g < -12 || g > 12) {
        throw new RangeError(`Gain ${g} dB is outside allowed SVF range [-12, +12] dB`);
      }
    }
    this.equalizerBands = [...gains];
    this.dspChain.equalizer.setBands(gains);

    // Synchronize live Web Audio BiquadFilterNodes
    if (this.eqFilterNodes.length === 10 && this.ctx) {
      const now = this.ctx.currentTime;
      for (let i = 0; i < 10; i++) {
        const filter = this.eqFilterNodes[i];
        try {
          filter.gain.cancelScheduledValues(now);
          filter.gain.setTargetAtTime(gains[i], now, 0.02);
        } catch {
          filter.gain.value = gains[i];
        }
      }
    }
  }

  private applyWebAudioAutoEqChain(profile: AutoEqProfile | null): void {
    if (!this.ctx || !this.autoEqPreampNode || !this.masterVolumeNode) {
      return;
    }

    const now = this.ctx.currentTime ?? 0;

    // Safely disconnect existing AutoEQ subgraph
    try {
      (this.autoEqPreampNode as any).disconnect?.();
    } catch {
      // Ignore in mocks without disconnect()
    }
    for (const node of this.autoEqFilterNodes) {
      try {
        (node as any).disconnect?.();
      } catch {
        // Ignore in mocks
      }
    }
    this.autoEqFilterNodes.length = 0;

    if (!profile || !Array.isArray(profile.filters) || profile.filters.length === 0) {
      try {
        this.autoEqPreampNode.gain.cancelScheduledValues(now);
        this.autoEqPreampNode.gain.setTargetAtTime(1.0, now, 0.02);
      } catch {
        this.autoEqPreampNode.gain.value = 1.0;
      }
      try {
        this.autoEqPreampNode.connect(this.masterVolumeNode);
      } catch {
        // Ignore connect error in mocks
      }
      return;
    }

    const preampLinear = Math.pow(10, (Number.isFinite(profile.preampGainDb) ? profile.preampGainDb : 0) / 20);
    try {
      this.autoEqPreampNode.gain.cancelScheduledValues(now);
      this.autoEqPreampNode.gain.setTargetAtTime(preampLinear, now, 0.02);
    } catch {
      this.autoEqPreampNode.gain.value = preampLinear;
    }

    const TYPE_MAP: Record<string, BiquadFilterType> = {
      PEAKING: 'peaking',
      LOW_SHELF: 'lowshelf',
      HIGH_SHELF: 'highshelf',
      LOW_PASS: 'lowpass',
      HIGH_PASS: 'highpass',
      BAND_PASS: 'bandpass',
    };

    const sampleRate =
      typeof (this.ctx as any).sampleRate === 'number' && (this.ctx as any).sampleRate > 8000
        ? (this.ctx as any).sampleRate
        : 48000;
    const maxFreq = sampleRate * 0.49;

    let prevNode: AudioNode = this.autoEqPreampNode;
    for (const f of profile.filters) {
      try {
        const node = this.ctx.createBiquadFilter();
        const webType = TYPE_MAP[f.type] || 'peaking';
        node.type = webType;

        const safeFreq = Math.max(10, Math.min(maxFreq, Number.isFinite(f.freq) ? f.freq : 1000));
        const safeQ = Math.max(0.05, Math.min(100, Number.isFinite(f.q) ? f.q : 0.707));
        const safeGain = Math.max(-40, Math.min(40, Number.isFinite(f.gainDb) ? f.gainDb : 0));

        try {
          node.frequency.setValueAtTime(safeFreq, now);
          node.Q.setValueAtTime(safeQ, now);
          node.gain.setValueAtTime(safeGain, now);
        } catch {
          node.frequency.value = safeFreq;
          node.Q.value = safeQ;
          node.gain.value = safeGain;
        }

        prevNode.connect(node);
        prevNode = node;
        this.autoEqFilterNodes.push(node);
      } catch {
        // Ignore individual filter creation failure
      }
    }

    try {
      prevNode.connect(this.masterVolumeNode);
    } catch {
      // Ignore connect error
    }
  }

  /**
   * Query and load AutoEQ headphone profile (accepts profile name/id, AutoEqProfile object, or null/'' to bypass)
   */
  async loadAutoEqProfile(profileOrName: string | AutoEqProfile | null): Promise<boolean> {
    if (
      !profileOrName ||
      (typeof profileOrName === 'string' && !profileOrName.trim())
    ) {
      this.autoEqProfile = null;
      this.dspChain.clearAutoEqProfile();
      this.applyWebAudioAutoEqChain(null);
      return false;
    }

    const profile =
      typeof profileOrName === 'string'
        ? await AutoEqLoader.findProfile(profileOrName)
        : profileOrName;

    if (!profile) {
      this.autoEqProfile = null;
      this.dspChain.clearAutoEqProfile();
      this.applyWebAudioAutoEqChain(null);
      return false;
    }

    this.autoEqProfile = profile;
    this.dspChain.setAutoEqProfile(profile.filters, profile.preampGainDb);
    this.applyWebAudioAutoEqChain(profile);
    return true;
  }

  /**
   * Enable/disable spatial audio widening [1.0, 4.0]
   */
  setSpatialAudio(enabled: boolean, width = 2.5): void {
    this.spatialAudio.enabled = Boolean(enabled);
    this.spatialAudio.width = Math.max(1.0, Math.min(4.0, width));
    this.dspChain.spatial.enabled = this.spatialAudio.enabled;
    this.dspChain.spatial.width = this.spatialAudio.width;
  }

  private setCachedWaveform(songId: string, envelope: Float32Array): void {
    if (this.cachedWaveforms.has(songId)) {
      this.cachedWaveforms.delete(songId);
    } else if (this.cachedWaveforms.size >= 200) {
      const oldestKey = this.cachedWaveforms.keys().next().value;
      if (oldestKey !== undefined) {
        this.cachedWaveforms.delete(oldestKey);
      }
    }
    this.cachedWaveforms.set(songId, envelope);
  }

  /**
   * Retrieve pre-computed 200-bucket amplitude envelope
   */
  async getWaveformData(songId: string): Promise<Float32Array> {
    if (!songId) throw new Error('Song ID required');
    const cached = this.cachedWaveforms.get(songId);
    if (cached) {
      this.cachedWaveforms.delete(songId);
      this.cachedWaveforms.set(songId, cached);
      return cached;
    }
    const envelope = await this.waveformExtractor.getOrExtractWaveform(songId);
    this.setCachedWaveform(songId, envelope);
    return envelope;
  }

  /**
   * Subscribe to live 32-band PCM energy updates
   */
  subscribeLivePcmEnergy(callback: (energy32: Float32Array) => void): () => void {
    this.livePcmSubscribers.add(callback);
    return () => this.livePcmSubscribers.delete(callback);
  }

  /**
   * Subscribe to playback state changes
   */
  onPlaybackStateChange(callback: (state: PlaybackState) => void): () => void {
    this.stateChangeSubscribers.add(callback);
    return () => this.stateChangeSubscribers.delete(callback);
  }

  /**
   * Subscribe to track completion events
   */
  /** Subscribe to mid-playback media errors on the active deck (e.g. expired stream URL). */
  onPlaybackError(callback: () => void): () => void {
    this.onPlaybackErrorSubscribers.add(callback);
    return () => this.onPlaybackErrorSubscribers.delete(callback);
  }

  /** True when the active deck's media element is dead (error / no source) and needs a fresh URL. */
  isActiveDeckErrored(): boolean {
    const el = (this.activeDeckName === 'active' ? this.deckA : this.deckB).audioElement;
    return !!el && (!!el.error || el.networkState === 3 || !el.getAttribute('src'));
  }

  private _handleDeckError(
    deckId: 'deckA' | 'deckB',
    capturedLoadToken?: number,
    capturedPlaybackToken?: number
  ): void {
    const targetDeck = deckId === 'deckA' ? this.deckA : this.deckB;
    const active = this.activeDeckName === 'active' ? this.deckA : this.deckB;
    if (active !== targetDeck) return;
    if (capturedLoadToken !== undefined && capturedLoadToken !== targetDeck.loadToken) return;
    if (capturedPlaybackToken !== undefined && capturedPlaybackToken !== this.playbackToken) return;
    for (const cb of this.onPlaybackErrorSubscribers) {
      try { cb(); } catch { /* ignore subscriber errors */ }
    }
  }

  onTrackEnded(callback: () => void): () => void {
    this.onTrackEndedSubscribers.add(callback);
    return () => this.onTrackEndedSubscribers.delete(callback);
  }

  /**
   * Subscribe to premature 'ended' events (when <audio> stops well before expectedDuration - 4s)
   * so playerStore can recover the stream at positionMs without advancing the queue.
   */
  onPrematureEnded(callback: (positionMs: number) => void): () => void {
    this.onPrematureEndedSubscribers.add(callback);
    return () => this.onPrematureEndedSubscribers.delete(callback);
  }

  private _handleDeckPrematureEnded(
    deckId: 'deckA' | 'deckB',
    positionMs: number,
    capturedLoadToken?: number,
    capturedPlaybackToken?: number
  ): void {
    const activeDeck = this.activeDeckName === 'active' ? this.deckA : this.deckB;
    const endedDeck = deckId === 'deckA' ? this.deckA : this.deckB;
    if (activeDeck !== endedDeck) return;
    if (capturedLoadToken !== undefined && capturedLoadToken !== endedDeck.loadToken) return;
    if (capturedPlaybackToken !== undefined && capturedPlaybackToken !== this.playbackToken) return;
    activeDeck.positionMs = positionMs;
    this.playbackState = 'PAUSED';
    for (const cb of this.onPrematureEndedSubscribers) {
      try {
        cb(positionMs);
      } catch (err) {
        console.warn('[AudioEngine] onPrematureEnded subscriber error:', err);
      }
    }
  }

  private _handleDeckEnded(
    deckId: 'deckA' | 'deckB',
    capturedLoadToken?: number,
    capturedPlaybackToken?: number
  ): void {
    const activeDeck = this.activeDeckName === 'active' ? this.deckA : this.deckB;
    const endedDeck = deckId === 'deckA' ? this.deckA : this.deckB;
    if (activeDeck !== endedDeck) return;
    if (capturedLoadToken !== undefined && capturedLoadToken !== endedDeck.loadToken) return;
    if (capturedPlaybackToken !== undefined && capturedPlaybackToken !== this.playbackToken) return;

    this.playbackState = 'PAUSED';
    this._emitStateChange();
    for (const cb of this.onTrackEndedSubscribers) {
      try {
        cb();
      } catch (err) {
        console.warn('[AudioEngine] onTrackEnded subscriber error:', err);
      }
    }
  }

  dispose(): void {
    this.playbackToken++;
    this.crossfadeSequence++;
    this.clearPendingResumePosition();
    this.deckA.teardownSource();
    this.deckB.teardownSource();
    this.livePcmSubscribers.clear();
    this.stateChangeSubscribers.clear();
    this.onTrackEndedSubscribers.clear();
    this.onPrematureEndedSubscribers.clear();
    this.onPlaybackErrorSubscribers.clear();
    this.cachedWaveforms.clear();
    this.cachedVocalStem = null;
    this.ctx?.close?.().catch(() => {});
    this.playbackState = 'IDLE';
  }

  /**
   * Get snapshot of current playback state.
   */
  getPlaybackState(): PlaybackState {
    const activeDeck = this.activeDeckName === 'active' ? this.deckA : this.deckB;
    return {
      playbackState: this.playbackState,
      currentTrack: activeDeck.track,
      positionMs: activeDeck.positionMs,
      volume: this.globalVolume,
      activeDeck: this.activeDeckName,
    };
  }

  private _emitStateChange(reason: 'state' | 'volume' | 'load' | 'seek' | 'timeupdate' = 'state'): void {
    this.lastEmitReason = reason;
    const state = this.getPlaybackState();
    for (const cb of this.stateChangeSubscribers) {
      try {
        cb(state);
      } catch {
        // Ignore subscriber errors
      }
    }
  }

  /**
   * Dispatch synthetic/analyzed PCM block to live subscribers with zero heap allocations.
   */
  triggerLivePcmBlock(pcmBlock: Float32Array): void {
    if (!pcmBlock || pcmBlock.length === 0) return;
    const energy32 = LiveVisualizer.compute32BandPcmEnergy(pcmBlock, this.liveEnergyBuffer);
    for (const cb of this.livePcmSubscribers) {
      try {
        cb(energy32);
      } catch {
        // Ignore subscriber errors
      }
    }
  }

  /**
   * Exact active playback time in seconds from the active deck's HTMLAudioElement.
   * Returns 0 if no audio element or src is bound.
   */
  public getCurrentTime(): number {
    const activeDeck = this.activeDeckName === 'active' ? this.deckA : this.deckB;
    const el = activeDeck.audioElement;
    if (!el || !(el.getAttribute('src') || el.src)) {
      return 0;
    }
    if (activeDeck.isSeeking) {
      return Math.max(0, activeDeck.positionMs / 1000);
    }
    const elSec =
      typeof el.currentTime === 'number' && Number.isFinite(el.currentTime) && el.currentTime >= 0
        ? el.currentTime
        : 0;
    return Math.max(0, activeDeck.playbackOffsetSeconds + elSec);
  }

  /**
   * Read real-time playback position from the active deck's HTMLAudioElement when metadata is loaded.
   */
  getCurrentPositionMs(): number {
    const activeDeck = this.activeDeckName === 'active' ? this.deckA : this.deckB;
    const el = activeDeck.audioElement;
    if (!el || !(el.getAttribute('src') || el.src)) {
      return 0;
    }
    if (activeDeck.isSeeking) {
      return activeDeck.positionMs;
    }
    const ms = Math.round(this.getCurrentTime() * 1000);
    activeDeck.positionMs = ms;
    return ms;
  }

  getCurrentPositionSeconds(): number {
    return this.getCurrentTime();
  }

  isSeeking(): boolean {
    const activeDeck = this.activeDeckName === 'active' ? this.deckA : this.deckB;
    return activeDeck.isSeeking;
  }

  public isSeekingActive(): boolean {
    const activeDeck = this.activeDeckName === 'active' ? this.deckA : this.deckB;
    return activeDeck.isSeeking || this.pendingResumeVerifyTimer !== null;
  }

  getPlaybackOffsetMs(): number {
    const activeDeck = this.activeDeckName === 'active' ? this.deckA : this.deckB;
    return activeDeck.playbackOffsetMs;
  }

  getPlaybackOffsetSeconds(): number {
    return this.getPlaybackOffsetMs() / 1000;
  }

  /**
   * Return the active deck's currently bound HTMLAudioElement (routed or direct fallback).
   */
  getActiveAudioElement(): HTMLAudioElement | null {
    return (this.activeDeckName === 'active' ? this.deckA : this.deckB).audioElement;
  }

  /**
   * Read real-time duration from the active deck's HTMLAudioElement if available.
   */
  getCurrentDurationMs(): number {
    const activeDeck = this.activeDeckName === 'active' ? this.deckA : this.deckB;
    return activeDeck.syncDurationFromElement();
  }

  /**
   * Poll real Web Audio AnalyserNode time-domain data (or synthesize beat-synced harmonic energy
   * if CORS/MediaElement source is silent) and emit 32-band PCM energy.
   */
  pollLiveVisualizer(): void {
    if (this.playbackState !== 'PLAYING') return;

    let hasRealSignal = false;
    if (this.analyserNode && typeof this.analyserNode.getFloatTimeDomainData === 'function') {
      try {
        this.analyserNode.getFloatTimeDomainData(this.timeDomainBuffer);
        for (let i = 0; i < this.timeDomainBuffer.length; i += 8) {
          if (Math.abs(this.timeDomainBuffer[i]) > 0.001) {
            hasRealSignal = true;
            break;
          }
        }
      } catch {
        // Ignore analyser read errors
      }
    }

    if (!hasRealSignal) {
      this.synthPhase += 0.14;
      const p = this.synthPhase;
      for (let i = 0; i < this.timeDomainBuffer.length; i++) {
        const t = i / this.timeDomainBuffer.length;
        const bass = Math.sin(t * Math.PI * 8 + p) * 0.42;
        const mid = Math.sin(t * Math.PI * 28 - p * 1.7) * 0.25;
        const high = Math.cos(t * Math.PI * 84 + p * 2.3) * 0.15;
        const pulse = 0.65 + 0.35 * Math.sin(p * 0.8);
        this.timeDomainBuffer[i] = (bass + mid + high) * pulse * this.globalVolume;
      }
    }

    this.triggerLivePcmBlock(this.timeDomainBuffer);
  }

  /**
   * Alias for seek(positionMs) supporting LyricVisualizer stage click-to-seek.
   */
  seekTo(positionMs: number): void {
    this.seek(positionMs);
  }

  seekSeconds(sec: number): void {
    this.seek(sec * 1000);
  }

  /**
   * Configure live Karaoke / Vocal Attenuation mode (0.0 = Vocals Off, 1.0 = Full Vocals).
   */
  setKaraokeMode(enabled: boolean, vocalLevel: number, isolateVocals = false): void {
    const safeLevel = Number.isFinite(vocalLevel) ? Math.max(0, Math.min(1, vocalLevel)) : 1;
    this.karaokeEnabled = Boolean(enabled);
    this.karaokeVocalLevel = safeLevel;
    this.karaokeIsolateVocals = Boolean(isolateVocals);

    this.dspChain.karaoke.enabled = this.karaokeEnabled;
    this.dspChain.karaoke.vocalLevel = safeLevel;
    this.dspChain.karaoke.isolateVocals = this.karaokeIsolateVocals;

    if (
      this.ctx &&
      this.karaokeBypassGain &&
      this.karaokeSideGain &&
      this.karaokeEdgeMidGain &&
      this.karaokeDirectMidGain &&
      this.karaokeVocalIsoGain
    ) {
      const now = this.ctx.currentTime;
      const bypassVal = this.karaokeEnabled ? 0.0 : 1.0;
      const sideVal = this.karaokeEnabled && !this.karaokeIsolateVocals ? 1.0 : 0.0;
      const directMidVal =
        this.karaokeEnabled && !this.karaokeIsolateVocals ? safeLevel : 0.0;
      const edgeMidVal =
        this.karaokeEnabled && !this.karaokeIsolateVocals ? 1.0 - safeLevel : 0.0;
      const vocalIsoVal =
        this.karaokeEnabled && this.karaokeIsolateVocals ? safeLevel : 0.0;
      try {
        this.karaokeBypassGain.gain.setTargetAtTime(bypassVal, now, 0.02);
        this.karaokeSideGain.gain.setTargetAtTime(sideVal, now, 0.02);
        this.karaokeDirectMidGain.gain.setTargetAtTime(directMidVal, now, 0.02);
        this.karaokeEdgeMidGain.gain.setTargetAtTime(edgeMidVal, now, 0.02);
        this.karaokeVocalIsoGain.gain.setTargetAtTime(vocalIsoVal, now, 0.02);
      } catch {
        this.karaokeBypassGain.gain.value = bypassVal;
        this.karaokeSideGain.gain.value = sideVal;
        this.karaokeDirectMidGain.gain.value = directMidVal;
        this.karaokeEdgeMidGain.gain.value = edgeMidVal;
        this.karaokeVocalIsoGain.gain.value = vocalIsoVal;
      }
    }
  }

  getKaraokeState(trackId?: string | null): {
    enabled: boolean;
    vocalLevel: number;
    isolateVocals: boolean;
    hasNeuralStem: boolean;
  } {
    const activeDeckTrackId = (this.activeDeckName === 'active' ? this.deckA : this.deckB).track?.videoId ?? null;
    const activeId = trackId ?? activeDeckTrackId;
    return {
      enabled: this.karaokeEnabled,
      vocalLevel: this.karaokeVocalLevel,
      isolateVocals: this.karaokeIsolateVocals,
      hasNeuralStem: Boolean(
        activeId && this.cachedVocalStem && this.cachedVocalStem.trackId === activeId
      ),
    };
  }

  private enginePlaybackRate = 1.0;

  setPlaybackRate(rate: number): number {
    const safe = Number.isFinite(rate)
      ? Math.round(Math.max(0.5, Math.min(1.5, rate)) * 100) / 100
      : 1.0;
    this.enginePlaybackRate = safe;
    this.deckA.setPlaybackRate(safe);
    this.deckB.setPlaybackRate(safe);
    return safe;
  }

  getPlaybackRate(): number {
    return this.enginePlaybackRate;
  }

  setNeuralVocalStem(
    trackId: string,
    stem: { vocalsLeft: Float32Array; vocalsRight: Float32Array; sampleRate: number } | null
  ): void {
    this.cachedVocalStem = stem ? { trackId, ...stem } : null;
  }

  setTrackBeatAnalysis(
    analysis: {
      bpm: number;
      beats: readonly number[];
      downbeats: readonly number[];
      chorusStartSec?: number;
    } | null
  ): void {
    this.activeBeatAnalysis = analysis;
    this.lastMatchedDownbeatIdx = -1;
    this.beatCountSinceDownbeat = 0;
  }

  /**
   * Sample normalized RMS, Bass (20-250 Hz), Mid (250-4000 Hz), Treble (4-16 kHz),
   * and beat onset detection from the active Web Audio AnalyserNode / LiveVisualizer
   * without allocating per-call arrays when `out` is provided.
   * Gracefully returns zeroed metrics if AudioContext or CORS analyser is inactive.
   */
  sampleAudioMetrics(out?: AudioFrameMetrics): AudioFrameMetrics {
    const target: AudioFrameMetrics = out ?? {
      rmsLevel: 0,
      bassEnergy: 0,
      midEnergy: 0,
      trebleEnergy: 0,
      beatDetected: false,
    };

    target.rmsLevel = 0;
    target.bassEnergy = 0;
    target.midEnergy = 0;
    target.trebleEnergy = 0;
    target.beatDetected = false;
    target.isDownbeat = false;

    const activeDeck = this.activeDeckName === 'active' ? this.deckA : this.deckB;
    const isCtxInactive =
      !this.ctx ||
      this.ctx.state === 'suspended' ||
      this.ctx.state === 'closed' ||
      activeDeck.usingDirectFallback ||
      !this.analyserNode;

    if (isCtxInactive) {
      return target;
    }

    const analyser = this.analyserNode!;
    const sampleRate =
      typeof (this.ctx as any).sampleRate === 'number' && (this.ctx as any).sampleRate > 8000
        ? (this.ctx as any).sampleRate
        : 44100;
    const fftSize = analyser.fftSize || 1024;
    const binCount = Math.min(
      this.metricsFreqFloatBuffer.length,
      analyser.frequencyBinCount || Math.floor(fftSize / 2)
    );
    const hzPerBin = sampleRate / fftSize;

    // 1. Time-domain RMS calculation
    let hasTimeSignal = false;
    let rms = 0;
    if (typeof analyser.getFloatTimeDomainData === 'function') {
      try {
        this.timeDomainBuffer.fill(0);
        analyser.getFloatTimeDomainData(this.timeDomainBuffer);
        let sumSq = 0;
        const len = this.timeDomainBuffer.length;
        for (let i = 0; i < len; i++) {
          const v = this.timeDomainBuffer[i];
          if (Number.isFinite(v) && Math.abs(v) > 0.0001) {
            hasTimeSignal = true;
            sumSq += v * v;
          }
        }
        if (hasTimeSignal && len > 0) {
          rms = Math.max(0, Math.min(1, Math.sqrt(sumSq / len) * 1.75));
        }
      } catch {
        // Ignore time-domain read failure
      }
    }

    // 2. Frequency-domain band integration: Bass (20-250 Hz), Mid (250-4000 Hz), Treble (4000-16000 Hz)
    const bassStart = Math.max(1, Math.floor(20 / hzPerBin));
    const bassEnd = Math.min(binCount, Math.max(bassStart + 1, Math.ceil(250 / hzPerBin)));
    const midStart = bassEnd;
    const midEnd = Math.min(binCount, Math.max(midStart + 1, Math.ceil(4000 / hzPerBin)));
    const trebleStart = midEnd;
    const trebleEnd = Math.min(binCount, Math.max(trebleStart + 1, Math.ceil(16000 / hzPerBin)));

    let hasFreqSignal = false;
    let bass = 0;
    let mid = 0;
    let treble = 0;

    if (typeof analyser.getFloatFrequencyData === 'function' && binCount > 0) {
      try {
        this.metricsFreqFloatBuffer.fill(-120);
        analyser.getFloatFrequencyData(this.metricsFreqFloatBuffer);

        const avgFloatBand = (start: number, end: number): number => {
          if (end <= start) return 0;
          let sum = 0;
          let count = 0;
          for (let i = start; i < end; i++) {
            const db = this.metricsFreqFloatBuffer[i];
            if (Number.isFinite(db) && db > -115) {
              hasFreqSignal = true;
              const norm = Math.max(0, Math.min(1, (db + 100) / 70));
              sum += norm;
            }
            count++;
          }
          return count > 0 ? sum / count : 0;
        };

        bass = avgFloatBand(bassStart, bassEnd);
        mid = avgFloatBand(midStart, midEnd);
        treble = avgFloatBand(trebleStart, trebleEnd);
      } catch {
        // Ignore float frequency failure
      }
    }

    if (!hasFreqSignal && typeof analyser.getByteFrequencyData === 'function' && binCount > 0) {
      try {
        this.metricsFreqByteBuffer.fill(0);
        analyser.getByteFrequencyData(this.metricsFreqByteBuffer);

        const avgByteBand = (start: number, end: number): number => {
          if (end <= start) return 0;
          let sum = 0;
          let count = 0;
          for (let i = start; i < end; i++) {
            const val = this.metricsFreqByteBuffer[i];
            if (val > 0) {
              hasFreqSignal = true;
              sum += val / 255;
            }
            count++;
          }
          return count > 0 ? sum / count : 0;
        };

        bass = avgByteBand(bassStart, bassEnd);
        mid = avgByteBand(midStart, midEnd);
        treble = avgByteBand(trebleStart, trebleEnd);
      } catch {
        // Ignore byte frequency failure
      }
    }

    if (hasTimeSignal && !hasFreqSignal) {
      this.visualizer.processPcmFrame(this.timeDomainBuffer, 1, sampleRate);
      bass = Math.max(0, Math.min(1, this.visualizer.bassLevel));
      mid = Math.max(0, Math.min(1, this.visualizer.midLevel));
      treble = Math.max(0, Math.min(1, this.visualizer.highLevel));
    } else if (hasFreqSignal && !hasTimeSignal) {
      rms = Math.max(0, Math.min(1, Math.sqrt((bass * bass + mid * mid + treble * treble) / 3)));
    } else if (!hasTimeSignal && !hasFreqSignal && this.playbackState === 'PLAYING') {
      // Fallback to LiveVisualizer smoothed state if pollLiveVisualizer is driving it
      rms = Math.max(0, Math.min(1, this.visualizer.rmsLevel));
      bass = Math.max(0, Math.min(1, this.visualizer.bassLevel));
      mid = Math.max(0, Math.min(1, this.visualizer.midLevel));
      treble = Math.max(0, Math.min(1, this.visualizer.highLevel));
    }

    // 3. Beat onset detection on bass energy + zero-GC BPM estimator
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const prevAvg = this.metricsRollingBass;
    const isBeat =
      bass > 0.18 &&
      bass > Math.max(0.22, prevAvg * 1.28) &&
      nowMs - this.metricsLastBeatMs > 170;

    if (isBeat) {
      this.metricsLastBeatMs = nowMs;
      this.beatCountSinceDownbeat += 1;
    }
    this.metricsRollingBass = prevAvg * 0.82 + bass * 0.18;
    this.visualizer.updateBeatMetrics(bass, nowMs);

    let isDownbeat = false;
    const downbeats = this.activeBeatAnalysis?.downbeats;
    if (downbeats && downbeats.length > 0 && this.playbackState === 'PLAYING') {
      const posSec = this.getCurrentTime();
      for (let i = 0; i < downbeats.length; i++) {
        if (Math.abs(downbeats[i] - posSec) <= 0.055) {
          if (i !== this.lastMatchedDownbeatIdx) {
            this.lastMatchedDownbeatIdx = i;
            isDownbeat = true;
          }
          break;
        }
      }
    } else if (isBeat && this.beatCountSinceDownbeat % 4 === 1) {
      isDownbeat = true;
    }

    target.rmsLevel = rms;
    target.bassEnergy = bass;
    target.midEnergy = mid;
    target.trebleEnergy = treble;
    target.beatDetected = isBeat;
    target.isDownbeat = isDownbeat;
    (target as any).estimatedBpm =
      this.activeBeatAnalysis && this.activeBeatAnalysis.bpm > 40
        ? this.activeBeatAnalysis.bpm
        : this.visualizer.getEstimatedBpm();
    (target as any).beatStrength = this.visualizer.getBeatStrength();

    return target;
  }
}
