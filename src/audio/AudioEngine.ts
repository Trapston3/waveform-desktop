// src/audio/AudioEngine.ts
// Dual-Deck Web Audio Playback Engine conforming to Feature 5 (PROJECT.md)
// Reverse-engineered from Android CrossfadeController.kt & Web deck.ts

import { AutoEqLoader } from './AutoEqLoader';
import type { AutoEqProfile } from './AutoEqLoader';
import { DspChain, FACTORY_EQ_PRESETS, EQ_FREQUENCIES_HZ } from './DspChain';
import { LiveVisualizer } from './LiveVisualizer';
import { WaveformExtractor } from './WaveformExtractor';

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
  gain = 1.0;
  isPlaying = false;
  hasRealMedia = false;
  private pendingSeekMs: number | null = null;
  private pendingCanPlayRetry: (() => void) | null = null;
  private pendingCanPlayRetryEl: HTMLAudioElement | null = null;
  onEndedCallback: (() => void) | null = null;
  onErrorCallback: (() => void) | null = null;
  onTimeUpdateCallback: (() => void) | null = null;

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

  private wireElementEvents(el: HTMLAudioElement, isDirect: boolean): void {
    const syncDuration = () => {
      if (el !== this.audioElement || this.isTearingDownSrc || !el.getAttribute('src')) {
        return;
      }
      if (Number.isFinite(el.duration) && el.duration > 0) {
        this.durationMs = Math.floor(el.duration * 1000);
        this.hasRealMedia = true;
        if (this.pendingSeekMs !== null && el.readyState >= 1) {
          const clampedMs = Math.max(0, Math.min(this.durationMs, this.pendingSeekMs));
          this.pendingSeekMs = null;
          this.positionMs = clampedMs;
          try {
            el.currentTime = clampedMs / 1000;
          } catch {
            // Ignore seek error
          }
        }
        if (this.onTimeUpdateCallback) this.onTimeUpdateCallback();
      }
    };

    el.addEventListener('loadedmetadata', syncDuration);
    el.addEventListener('durationchange', syncDuration);

    el.addEventListener('timeupdate', () => {
      if (el !== this.audioElement || this.isTearingDownSrc || !el.getAttribute('src')) {
        return;
      }
      this.positionMs = Math.floor(el.currentTime * 1000);
      this.hasRealMedia = true;
      if (this.onTimeUpdateCallback) this.onTimeUpdateCallback();
    });

    el.addEventListener('ended', () => {
      if (el !== this.audioElement || this.isTearingDownSrc || !this.isPlaying || !el.getAttribute('src')) {
        return;
      }
      this.isPlaying = false;
      if (this.onEndedCallback) {
        this.onEndedCallback();
      }
    });

    el.addEventListener('error', () => {
      if (el !== this.audioElement || this.isTearingDownSrc || !el.getAttribute('src')) {
        return;
      }
      if (!isDirect) {
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

    this.isTearingDownSrc = true;
    try {
      if (this.routedElement) {
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
      this.directElement = direct;
      this.wireElementEvents(this.directElement, true);
    }

    this.usingDirectFallback = true;
    this.audioElement = this.directElement;

    try {
      this.directElement.volume = Math.max(0.0, Math.min(1.0, this.fallbackVolume * this.gain));
    } catch {
      // Ignore
    }

    if (this.positionMs > 0) {
      this.pendingSeekMs = this.positionMs;
    }

    try {
      this.directElement.src = this.track.streamUrl;
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

  load(track: Song): void {
    this.clearPendingCanPlayRetry();
    this.pendingSeekMs = null;
    this.track = track;
    this.positionMs = 0;
    this.durationMs = track.totalPlayTimeMs || (track.durationSec ? track.durationSec * 1000 : 0);
    this.isPlaying = false;
    this.hasRealMedia = false;

    this.isTearingDownSrc = true;
    try {
      const teardownElement = (el: HTMLAudioElement | null) => {
        if (!el) return;
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

    this.usingDirectFallback = false;
    if (this.routedElement) {
      this.audioElement = this.routedElement;
    }

    if (this.normalizationNode) {
      this.normalizationNode.gain.value =
        typeof track.replayGainDb === 'number' ? Math.pow(10, track.replayGainDb / 20) : 1.0;
    }

    if (this.audioElement) {
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
        try {
          el.src = el.getAttribute('src') || el.src;
          el.load();
          if (resumeMs > 0) {
            const seek = () => {
              el.removeEventListener('loadedmetadata', seek);
              try { el.currentTime = resumeMs / 1000; } catch { /* ignore */ }
            };
            el.addEventListener('loadedmetadata', seek);
          }
        } catch {
          // Ignore reload errors in headless tests
        }
      }
      Promise.resolve()
        .then(() => el.play())
        .catch((err: any) => {
          if (
            err &&
            err.name === 'NotSupportedError' &&
            !this.usingDirectFallback &&
            this.routedElement === el &&
            this.isPlaying
          ) {
            if (this.activateDirectFallback(true)) {
              return;
            }
          }
          // A load() issued right after play() (stream re-resolution) aborts the first attempt;
          // retry once as soon as the new source can play instead of silently staying stopped.
          if (err && (err.name === 'AbortError' || err.name === 'NotSupportedError') && this.isPlaying) {
            if (el.readyState >= 2) {
              setTimeout(() => {
                if (this.isPlaying && this.audioElement === el) {
                  Promise.resolve()
                    .then(() => el.play())
                    .catch(() => {});
                }
              }, 0);
              return;
            }
            const retry = () => {
              this.clearPendingCanPlayRetry();
              if (this.isPlaying && this.audioElement === el) {
                Promise.resolve()
                  .then(() => el.play())
                  .catch(() => {});
              }
            };
            this.pendingCanPlayRetry = retry;
            this.pendingCanPlayRetryEl = el;
            el.addEventListener('canplay', retry);
          }
        });
    }
  }

  pause(): void {
    this.clearPendingCanPlayRetry();
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
    this.positionMs = positionMs;
    if (this.audioElement) {
      if (this.audioElement.readyState >= 1) {
        this.pendingSeekMs = null;
        try {
          this.audioElement.currentTime = positionMs / 1000;
        } catch {
          // Ignore
        }
      } else {
        // Defer seeking until loadedmetadata so seeking an unloaded element never fails or ends playback
        this.pendingSeekMs = positionMs;
      }
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

  readonly dspChain: DspChain;
  readonly visualizer: LiveVisualizer;
  readonly waveformExtractor: WaveformExtractor;

  readonly deckA: WebAudioDeck;
  readonly deckB: WebAudioDeck;

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
  private onPlaybackErrorSubscribers = new Set<() => void>();
  private cachedWaveforms = new Map<string, Float32Array>();

  /** Zero-allocation persistent buffer for 32-band visualizer dispatch */
  private readonly liveEnergyBuffer = new Float32Array(32);
  private readonly timeDomainBuffer = new Float32Array(1024);
  private synthPhase = 0;
  private crossfadeSequence = 0;

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
        // decksBus -> eqFilterNodes[0] -> ... -> eqFilterNodes[9] -> masterVolumeNode -> analyserNode -> destination
        let prevNode: AudioNode = this.decksBus;
        for (const filter of this.eqFilterNodes) {
          prevNode.connect(filter);
          prevNode = filter;
        }
        prevNode.connect(this.masterVolumeNode);

        this.masterVolumeNode.connect(this.analyserNode);
        this.analyserNode.connect(this.ctx.destination);
      } catch {
        // Fallback for mock/test runners
      }
    }

    this.deckA = new WebAudioDeck('deckA', this.ctx, this.decksBus);
    this.deckB = new WebAudioDeck('deckB', this.ctx, this.decksBus);
    this.deckA.setGain(1.0);
    this.deckB.setGain(0.0);

    this.deckA.onEndedCallback = () => this._handleDeckEnded('deckA');
    this.deckB.onEndedCallback = () => this._handleDeckEnded('deckB');
    this.deckA.onErrorCallback = () => this._handleDeckError('deckA');
    this.deckB.onErrorCallback = () => this._handleDeckError('deckB');
    this.deckA.onTimeUpdateCallback = () => this._emitStateChange('timeupdate');
    this.deckB.onTimeUpdateCallback = () => this._emitStateChange('timeupdate');
  }

  /**
   * Load track into designated deck ('active' or 'standby')
   */
  async loadTrack(track: Song, deck: DeckName = 'active'): Promise<void> {
    const validation = validateSongContract(track);
    if (!validation.valid) {
      throw new Error(`Invalid Song Contract: ${validation.error}`);
    }

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
    }

    target.load(track);

    // Pre-calculate 200-bucket amplitude envelope
    if (!this.cachedWaveforms.has(track.videoId)) {
      const envelope = await this.waveformExtractor.getOrExtractWaveform(track.videoId);
      this.cachedWaveforms.set(track.videoId, envelope);
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
    }

    target.load(track);
    if (positionMs > 0) {
      target.seek(positionMs);
    }
    this.playbackState = 'PAUSED';

    // Pre-calculate 200-bucket amplitude envelope
    if (!this.cachedWaveforms.has(track.videoId)) {
      try {
        const envelope = await this.waveformExtractor.getOrExtractWaveform(track.videoId);
        this.cachedWaveforms.set(track.videoId, envelope);
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

    this.playbackState = 'CROSSFADING';
    this._emitStateChange();

    const outgoing = this.activeDeckName === 'active' ? this.deckA : this.deckB;
    const incoming = this.activeDeckName === 'active' ? this.deckB : this.deckA;

    if (!incoming.track) {
      throw new Error('Standby deck has no pre-rolled track for crossfading');
    }

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

  /**
   * Query and load AutoEQ headphone profile
   */
  async loadAutoEqProfile(profileName: string): Promise<boolean> {
    if (!profileName || typeof profileName !== 'string' || !profileName.trim()) {
      this.autoEqProfile = null;
      this.dspChain.clearAutoEqProfile();
      return false;
    }
    const profile = await AutoEqLoader.findProfile(profileName);
    if (!profile) {
      this.autoEqProfile = null;
      this.dspChain.clearAutoEqProfile();
      return false;
    }
    this.autoEqProfile = profile;
    this.dspChain.setAutoEqProfile(profile.filters, profile.preampGainDb);
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

  /**
   * Retrieve pre-computed 200-bucket amplitude envelope
   */
  async getWaveformData(songId: string): Promise<Float32Array> {
    if (!songId) throw new Error('Song ID required');
    if (this.cachedWaveforms.has(songId)) {
      return this.cachedWaveforms.get(songId)!;
    }
    const envelope = await this.waveformExtractor.getOrExtractWaveform(songId);
    this.cachedWaveforms.set(songId, envelope);
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

  private _handleDeckError(deckId: 'deckA' | 'deckB'): void {
    const active = this.activeDeckName === 'active' ? this.deckA : this.deckB;
    if (active !== (deckId === 'deckA' ? this.deckA : this.deckB)) return;
    for (const cb of this.onPlaybackErrorSubscribers) {
      try { cb(); } catch { /* ignore subscriber errors */ }
    }
  }

  onTrackEnded(callback: () => void): () => void {
    this.onTrackEndedSubscribers.add(callback);
    return () => this.onTrackEndedSubscribers.delete(callback);
  }

  private _handleDeckEnded(deckId: 'deckA' | 'deckB'): void {
    const activeDeck = this.activeDeckName === 'active' ? this.deckA : this.deckB;
    const endedDeck = deckId === 'deckA' ? this.deckA : this.deckB;
    if (activeDeck === endedDeck) {
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
   * Read real-time playback position from the active deck's HTMLAudioElement when metadata is loaded.
   */
  getCurrentPositionMs(): number {
    const activeDeck = this.activeDeckName === 'active' ? this.deckA : this.deckB;
    if (
      activeDeck.audioElement &&
      activeDeck.audioElement.readyState >= 1 &&
      (activeDeck.audioElement.getAttribute('src') || activeDeck.audioElement.src)
    ) {
      activeDeck.positionMs = Math.round(activeDeck.audioElement.currentTime * 1000);
    }
    return activeDeck.positionMs;
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
    if (
      activeDeck.audioElement &&
      Number.isFinite(activeDeck.audioElement.duration) &&
      activeDeck.audioElement.duration > 0
    ) {
      activeDeck.durationMs = Math.round(activeDeck.audioElement.duration * 1000);
    }
    return activeDeck.durationMs;
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
}
