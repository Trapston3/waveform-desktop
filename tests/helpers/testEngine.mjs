// tests/helpers/testEngine.mjs
// Unified simulator implementing PROJECT.md Interface Contracts for Audio, Services & Storage

import { mockSongs, validateSongContract } from '../fixtures/mockSongs.mjs';
import { mockInnerTube } from '../fixtures/mockInnerTube.mjs';
import { mockAutoEq } from '../fixtures/mockAutoEq.mjs';
import { mockAudio } from '../fixtures/mockAudio.mjs';
import { mockLyrics, parseLrc } from '../fixtures/mockLyrics.mjs';
import { defaultAppSettings, mergeSettings } from '../fixtures/mockSettings.mjs';
import { mockPlaylists } from '../fixtures/mockPlaylists.mjs';

/**
 * Audio Engine Simulator implementing AudioEngine contract from PROJECT.md
 */
export class AudioEngineSimulator {
  constructor() {
    this.deckA = { track: null, positionMs: 0, gain: 1.0, isPlaying: false };
    this.deckB = { track: null, positionMs: 0, gain: 0.0, isPlaying: false };
    this.activeDeckName = 'active'; // 'active' refers to deckA, 'standby' refers to deckB
    this.globalVolume = 0.85;
    this.playbackState = 'IDLE'; // 'IDLE' | 'PLAYING' | 'PAUSED' | 'CROSSFADING'
    this.equalizerBands = [...mockAutoEq.factoryPresets.Flat];
    this.spatialAudio = { enabled: true, width: 2.5 };
    this.autoEqProfile = null;
    this.livePcmSubscribers = new Set();
    this.stateChangeSubscribers = new Set();
    this.cachedWaveforms = new Map();
  }

  async loadTrack(track, deck = 'active') {
    const validation = validateSongContract(track);
    if (!validation.valid) {
      throw new Error(`Invalid Song Contract: ${validation.error}`);
    }

    const target = deck === 'active' ? this.deckA : this.deckB;
    target.track = track;
    target.positionMs = 0;
    target.isPlaying = false;

    // Pre-calculate 200-bucket amplitude envelope
    if (!this.cachedWaveforms.has(track.videoId)) {
      const syntheticPcm = mockAudio.generateSine(440, 2.0, 0.85);
      const envelope = mockAudio.extract200BucketEnvelope(syntheticPcm);
      this.cachedWaveforms.set(track.videoId, envelope);
    }

    this._emitStateChange();
  }

  play() {
    const current = this.activeDeckName === 'active' ? this.deckA : this.deckB;
    if (!current.track) {
      throw new Error('Cannot play: No track loaded in active deck');
    }
    current.isPlaying = true;
    this.playbackState = 'PLAYING';
    this._emitStateChange();
  }

  pause() {
    const current = this.activeDeckName === 'active' ? this.deckA : this.deckB;
    current.isPlaying = false;
    this.playbackState = 'PAUSED';
    this._emitStateChange();
  }

  seek(positionMs) {
    if (typeof positionMs !== 'number' || isNaN(positionMs) || positionMs < 0) {
      throw new RangeError('Seek position must be a non-negative number');
    }
    const current = this.activeDeckName === 'active' ? this.deckA : this.deckB;
    if (current.track) {
      current.positionMs = positionMs;
      this._emitStateChange();
    }
  }

  setVolume(gain) {
    if (typeof gain !== 'number' || isNaN(gain)) {
      throw new TypeError('Volume gain must be a number');
    }
    this.globalVolume = Math.max(0.0, Math.min(1.0, gain));
    this._emitStateChange();
  }

  async crossfade(targetDeck, durationMs = 4000) {
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

    incoming.isPlaying = true;

    // Simulate constant power gain curve calculation
    const steps = 10;
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      const { gainOut, gainIn } = mockAudio.calculateConstantPowerGains(t);
      outgoing.gain = gainOut;
      incoming.gain = gainIn;
    }

    // Role swap: toggle active deck reference so incoming deck becomes active
    this.activeDeckName = this.activeDeckName === 'active' ? 'standby' : 'active';
    outgoing.isPlaying = false;
    outgoing.gain = 0.0;
    incoming.gain = 1.0;
    this.playbackState = 'PLAYING';
    this._emitStateChange();
  }

  setEqualizerBands(gains) {
    if (!Array.isArray(gains) || gains.length !== 10) {
      throw new Error('Equalizer bands must be an array of exactly 10 gain numbers');
    }
    for (const g of gains) {
      if (typeof g !== 'number' || Number.isNaN(g) || g < -12 || g > 12) {
        throw new RangeError(`Gain ${g} dB is outside allowed SVF range [-12, +12] dB`);
      }
    }
    this.equalizerBands = [...gains];
  }

  async loadAutoEqProfile(profileName) {
    const profile = mockAutoEq.headphoneProfiles.find(
      (p) => p.name.toLowerCase() === profileName.toLowerCase() || p.id === profileName
    );
    if (!profile) {
      return false;
    }
    this.autoEqProfile = profile;
    return true;
  }

  setSpatialAudio(enabled, width = 2.5) {
    this.spatialAudio.enabled = Boolean(enabled);
    this.spatialAudio.width = Math.max(1.0, Math.min(4.0, width));
  }

  async getWaveformData(songId) {
    if (!songId) throw new Error('Song ID required');
    if (this.cachedWaveforms.has(songId)) {
      return this.cachedWaveforms.get(songId);
    }
    const syntheticPcm = mockAudio.generateSine(440, 1.0, 0.7);
    const envelope = mockAudio.extract200BucketEnvelope(syntheticPcm);
    this.cachedWaveforms.set(songId, envelope);
    return envelope;
  }

  subscribeLivePcmEnergy(callback) {
    this.livePcmSubscribers.add(callback);
    return () => this.livePcmSubscribers.delete(callback);
  }

  onPlaybackStateChange(callback) {
    this.stateChangeSubscribers.add(callback);
    return () => this.stateChangeSubscribers.delete(callback);
  }

  _emitStateChange() {
    const activeDeck = this.activeDeckName === 'active' ? this.deckA : this.deckB;
    const state = {
      playbackState: this.playbackState,
      currentTrack: activeDeck.track,
      positionMs: activeDeck.positionMs,
      volume: this.globalVolume,
      activeDeck: this.activeDeckName,
    };
    for (const cb of this.stateChangeSubscribers) {
      try {
        cb(state);
      } catch (err) {
        // ignore subscriber errors
      }
    }
  }

  triggerLivePcmBlock(pcmBlock) {
    const energy32 = mockAudio.compute32BandPcmEnergy(pcmBlock);
    for (const cb of this.livePcmSubscribers) {
      try {
        cb(energy32);
      } catch (err) {
        // ignore subscriber errors
      }
    }
  }
}

/**
 * Music Service Simulator implementing MusicService contract from PROJECT.md
 */
export class MusicServiceSimulator {
  constructor() {
    this.homeShelves = [...mockInnerTube.homeFeed.shelves];
    this.searchResults = { ...mockInnerTube.searchResults };
    this.networkAvailable = true;
  }

  setNetworkAvailable(status) {
    this.networkAvailable = Boolean(status);
  }

  async getHomeShelves() {
    if (!this.networkAvailable) {
      // Fallback offline empty or cached shelves
      return [];
    }
    return JSON.parse(JSON.stringify(this.homeShelves));
  }

  async getExploreCategories() {
    if (!this.networkAvailable) return { categories: [] };
    return {
      chips: [...mockInnerTube.homeFeed.chips],
      trending: JSON.parse(JSON.stringify(this.homeShelves[1].items)),
    };
  }

  async search(query, filter = 'all') {
    if (!query || query.trim() === '') {
      return { query: '', suggestions: [], items: [] };
    }
    if (!this.networkAvailable) {
      // Offline fallback: return only local matching items
      return {
        query,
        suggestions: [],
        items: [mockSongs.localFlac].filter((s) => s.title.toLowerCase().includes(query.toLowerCase())),
      };
    }
    const qLower = query.toLowerCase();
    const suggestions = this.searchResults.suggestions.filter((s) => s.includes(qLower));
    const items = this.searchResults.items.filter((item) => {
      if (filter === 'all') return true;
      if (filter === 'songs' && item.badge === 'Song') return true;
      if (filter === 'albums' && item.isAlbum) return true;
      if (filter === 'artists' && item.isArtist) return true;
      return false;
    });
    return { query, suggestions, items };
  }

  async getReleaseDetails(id, type = 'album') {
    if (id === mockInnerTube.releaseDetail.id) {
      return JSON.parse(JSON.stringify(mockInnerTube.releaseDetail));
    }
    return null;
  }

  async getArtistDetails(id) {
    if (id === mockInnerTube.artistDetail.id) {
      return JSON.parse(JSON.stringify(mockInnerTube.artistDetail));
    }
    return null;
  }

  async getLyrics(songId, title, artist) {
    if (songId === mockSongs.localFlac.videoId) {
      return {
        type: 'LINE_SYNCED',
        lines: parseLrc(mockSongs.localFlac.lyrics),
      };
    }
    if (songId === mockSongs.standardYouTube.videoId) {
      return JSON.parse(JSON.stringify(mockLyrics.syllableSynced));
    }
    return null;
  }
}

/**
 * Storage Service Simulator implementing StorageService contract from PROJECT.md
 */
export class StorageServiceSimulator {
  constructor() {
    this.settings = { ...defaultAppSettings };
    this.playlists = JSON.parse(JSON.stringify(mockPlaylists.customPlaylists));
    this.favorites = [mockSongs.standardYouTube, mockSongs.explicitHipHop];
    this.listeningHistory = [];
  }

  async getSettings() {
    return { ...this.settings };
  }

  async updateSettings(delta) {
    this.settings = mergeSettings(this.settings, delta);
  }

  async getPlaylists() {
    return JSON.parse(JSON.stringify(this.playlists));
  }

  async createPlaylist(title, description = '') {
    if (!title || title.trim() === '') {
      throw new Error('Playlist title cannot be empty');
    }
    const newPlaylist = {
      id: `pl_custom_${Date.now()}`,
      title,
      description,
      thumbnailUrl: null,
      isCustom: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      songIds: [],
      songCount: 0,
      totalDurationSec: 0,
    };
    this.playlists.push(newPlaylist);
    return newPlaylist;
  }

  async addSongToPlaylist(playlistId, songId) {
    const pl = this.playlists.find((p) => p.id === playlistId);
    if (!pl) throw new Error(`Playlist ${playlistId} not found`);
    if (!pl.songIds.includes(songId)) {
      pl.songIds.push(songId);
      pl.songCount = pl.songIds.length;
      pl.updatedAt = new Date().toISOString();
    }
  }

  async getFavorites() {
    return JSON.parse(JSON.stringify(this.favorites));
  }

  async toggleFavorite(song) {
    const validation = validateSongContract(song);
    if (!validation.valid) throw new Error(validation.error);

    const idx = this.favorites.findIndex((f) => f.videoId === song.videoId);
    if (idx >= 0) {
      this.favorites.splice(idx, 1);
      return false; // un-favorited
    } else {
      this.favorites.push({ ...song, liked: true });
      return true; // favorited
    }
  }

  async recordListeningHistory(song, durationSec) {
    const validation = validateSongContract(song);
    if (!validation.valid) throw new Error(validation.error);
    if (typeof durationSec !== 'number' || durationSec < 0) {
      throw new RangeError('Duration must be a positive number');
    }

    this.listeningHistory.push({
      videoId: song.videoId,
      title: song.title,
      artist: song.artist,
      timestamp: Date.now(),
      durationSec,
    });
  }

  async getListeningHistory() {
    return [...this.listeningHistory];
  }
}
