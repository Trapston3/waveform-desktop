// src/models/Settings.ts
// Typed application settings across 7 subsystems conforming to mockSettings.mjs

import type { LyricsScriptMode, NowPlayingLayoutMode } from '../lyricVisualizer/core/models';
import { normalizeNowPlayingLayout } from '../lyricVisualizer/core/models';
import type { DiscordDisplayFormat } from '../services/DiscordRpcService';

export interface AppSettings {
  // Appearance & Theme (11 items)
  'appearance.themeMode': 'dark' | 'light' | 'system';
  'appearance.accentColor': string;
  'appearance.accentColorMode': 'custom' | 'dynamic';
  'appearance.acrylicBlurEnabled': boolean;
  'appearance.acrylicBlurOpacity': number;
  'appearance.liquidGlassControls': boolean;
  'appearance.fontFamily': string;
  'appearance.dynamicArtworkColor': boolean;
  'appearance.waveformStyle': 'bars68' | 'thinSlider';
  'appearance.ambientBackdropGlow': boolean;
  'appearance.compactSidebar': boolean;
  'appearance.nowPlayingLayout': NowPlayingLayoutMode;
  'appearance.hideAlbumCover': boolean;
  nowPlayingLayout: NowPlayingLayoutMode;
  hideAlbumCover: boolean;

  // Audio Engine & Playback (16 items)
  'playback.crossfadeDurationSec': number;
  'playback.crossfadeCurve': 'constant_power' | 'linear';
  'playback.gaplessEnabled': boolean;
  'playback.automixEnabled': boolean;
  'playback.automixMode': 'neural_beat' | 'smooth_crossfade' | 'gapless';
  'playback.automixOverlapSec': number;
  'playback.automixAvoidVocalOverlap': boolean;
  'playback.automixTransitionBars': number;
  'playback.signalsmithStretchEnabled': boolean;
  'playback.replayGainMode': 'off' | 'track' | 'album';
  'playback.replayGainPreampDb': number;
  'playback.peakLimiterEnabled': boolean;
  'playback.peakLimiterCeiling': number;
  'playback.preferredStreamingBitrate': 'auto' | 'standard' | 'high' | 'lossless';
  'playback.audioOutputDevice': string;
  'playback.bitPerfectExclusiveAAudio': boolean;
  'playback.volumeLevel': number;
  'playback.muted': boolean;
  'playback.stopPlaybackOnSleep': boolean;

  // Equalizer & DSP Calibration (10 items)
  'dsp.equalizerEnabled': boolean;
  'dsp.equalizerPreset': string;
  'dsp.equalizerBands': number[];
  'dsp.bassGainDb': number;
  'dsp.trebleGainDb': number;
  'dsp.autoEqEnabled': boolean;
  'dsp.autoEqSelectedProfile': string | null;
  'dsp.spatialAudioEnabled': boolean;
  'dsp.spatialWidthGain': number;
  'dsp.spatialCrossfeedDelayMs': number;

  // Lyrics Engine (9 items)
  'lyrics.enabled': boolean;
  'lyrics.syllableSyncGlow': boolean;
  'lyrics.romanizationEnabled': boolean;
  'lyrics.translationEnabled': boolean;
  'lyrics.scriptMode': LyricsScriptMode;
  'lyrics.fontSize': number;
  'lyrics.autoScrollSpeed': 'smooth' | 'instant';
  'lyrics.rtlSupport': boolean;
  'lyrics.providerPriority': string[];
  'lyrics.autoSyncOnStart': boolean;
  'lyrics.alignment': 'left' | 'center';
  lyricsAlignment: 'left' | 'center';

  // Local Music & Storage (8 items)
  'storage.localFolders': string[];
  'storage.watchLocalFolders': boolean;
  'storage.parseId3Tags': boolean;
  'storage.cacheSizeLimitMb': number;
  'storage.offlineDownloadsDirectory': string;
  'storage.autoClearOrphanedCache': boolean;
  'storage.syncLocalMetadata': boolean;
  'storage.embedArtworkInCache': boolean;

  // External Integrations & Scrobbling (15 items)
  'scrobble.lastFmEnabled': boolean;
  'scrobble.lastFmApiKey': string;
  'scrobble.lastFmApiSecret': string;
  'scrobble.lastFmSessionKey': string;
  'scrobble.lastFmUsername': string;
  'scrobble.listenBrainzEnabled': boolean;
  'scrobble.listenBrainzToken': string;
  'scrobble.discordRpcEnabled': boolean;
  'scrobble.discordClientId': string;
  'scrobble.discordDisplayFormat': DiscordDisplayFormat;
  'scrobble.discordShowTimeRemaining': boolean;
  'scrobble.discordShowAlbumArt': boolean;
  'scrobble.discordShowQualityAndButtons': boolean;
  'listenTogether.serverUrl': string;
  'listenTogether.nickname': string;

  // UI Navigation & Ergonomics (10 items)
  'ui.startInFullScreen': boolean;
  'ui.minimizeToTray': boolean;
  'ui.closeToTray': boolean;
  'ui.hardwareMediaKeys': boolean;
  'hotkeys.enabled': boolean;
  'hotkeys.bindings': Record<string, string>;
  'ui.mouseWheelVolumeStep': number;
  'ui.enable3dCoverFlow': boolean;
  'ui.enableCanvasVideo': boolean;
  'ui.defaultHomeTab': string;

  // Extensible for future addons
  [key: string]: unknown;
}

export const defaultAppSettings: AppSettings = {
  // Appearance & Theme (11 items)
  'appearance.themeMode': 'dark',
  'appearance.accentColor': '#FA2D48',
  'appearance.accentColorMode': 'custom',
  'appearance.acrylicBlurEnabled': true,
  'appearance.acrylicBlurOpacity': 0.75,
  'appearance.liquidGlassControls': true,
  'appearance.fontFamily': 'SF Pro Display',
  'appearance.dynamicArtworkColor': true,
  'appearance.waveformStyle': 'bars68',
  'appearance.ambientBackdropGlow': true,
  'appearance.compactSidebar': false,
  'appearance.nowPlayingLayout': 'split',
  'appearance.hideAlbumCover': false,
  nowPlayingLayout: 'split',
  hideAlbumCover: false,

  // Audio Engine & Playback (16 items)
  'playback.crossfadeDurationSec': 4.0,
  'playback.crossfadeCurve': 'constant_power',
  'playback.gaplessEnabled': true,
  'playback.automixEnabled': true,
  'playback.automixMode': 'neural_beat',
  'playback.automixOverlapSec': 6,
  'playback.automixAvoidVocalOverlap': true,
  'playback.automixTransitionBars': 4,
  'playback.signalsmithStretchEnabled': true,
  'playback.replayGainMode': 'track',
  'playback.replayGainPreampDb': 0.0,
  'playback.peakLimiterEnabled': true,
  'playback.peakLimiterCeiling': 0.985,
  'playback.preferredStreamingBitrate': 'high',
  'playback.audioOutputDevice': 'default',
  'playback.bitPerfectExclusiveAAudio': false,
  'playback.volumeLevel': 0.85,
  'playback.muted': false,
  'playback.stopPlaybackOnSleep': true,

  // Equalizer & DSP Calibration (10 items)
  'dsp.equalizerEnabled': true,
  'dsp.equalizerPreset': 'Flat',
  'dsp.equalizerBands': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'dsp.bassGainDb': 0.0,
  'dsp.trebleGainDb': 0.0,
  'dsp.autoEqEnabled': false,
  'dsp.autoEqSelectedProfile': null,
  'dsp.spatialAudioEnabled': true,
  'dsp.spatialWidthGain': 2.5,
  'dsp.spatialCrossfeedDelayMs': 15,

  // Lyrics Engine (9 items)
  'lyrics.enabled': true,
  'lyrics.syllableSyncGlow': true,
  'lyrics.romanizationEnabled': false,
  'lyrics.translationEnabled': false,
  'lyrics.scriptMode': 'auto',
  'lyrics.fontSize': 24,
  'lyrics.autoScrollSpeed': 'smooth',
  'lyrics.rtlSupport': true,
  'lyrics.providerPriority': ['AppleMusic', 'LrcLib', 'Musixmatch'],
  'lyrics.autoSyncOnStart': true,
  'lyrics.alignment': 'left',
  lyricsAlignment: 'left',

  // Local Music & Storage (8 items)
  'storage.localFolders': ['C:\\Users\\traps\\Music'],
  'storage.watchLocalFolders': true,
  'storage.parseId3Tags': true,
  'storage.cacheSizeLimitMb': 4096,
  'storage.offlineDownloadsDirectory': 'C:\\Users\\traps\\AppData\\Local\\WaveForm\\downloads',
  'storage.autoClearOrphanedCache': true,
  'storage.syncLocalMetadata': true,
  'storage.embedArtworkInCache': true,

  // External Integrations & Scrobbling (15 items)
  'scrobble.lastFmEnabled': false,
  'scrobble.lastFmApiKey': '',
  'scrobble.lastFmApiSecret': '',
  'scrobble.lastFmSessionKey': '',
  'scrobble.lastFmUsername': '',
  'scrobble.listenBrainzEnabled': false,
  'scrobble.listenBrainzToken': '',
  'scrobble.discordRpcEnabled': true,
  'scrobble.discordClientId': '1574112665163530280',
  'scrobble.discordDisplayFormat': 'song_on_waveform',
  'scrobble.discordShowTimeRemaining': true,
  'scrobble.discordShowAlbumArt': true,
  'scrobble.discordShowQualityAndButtons': true,
  'listenTogether.serverUrl': 'wss://party.waveform.app/ws',
  'listenTogether.nickname': 'DesktopListener',

  // UI Navigation & Ergonomics (10 items)
  'ui.startInFullScreen': false,
  'ui.minimizeToTray': true,
  'ui.closeToTray': false,
  'ui.hardwareMediaKeys': true,
  'hotkeys.enabled': true,
  'hotkeys.bindings': {
    playPause: 'CommandOrControl+Alt+P',
    nextTrack: 'CommandOrControl+Alt+Right',
    prevTrack: 'CommandOrControl+Alt+Left',
    toggleKaraoke: 'CommandOrControl+Alt+K',
    cycleVisualizerTheme: 'CommandOrControl+Alt+V',
    jumpBack5s: 'CommandOrControl+Alt+J',
    toggleFullscreenAmbient: 'CommandOrControl+Alt+F',
  },
  'ui.mouseWheelVolumeStep': 0.05,
  'ui.enable3dCoverFlow': true,
  'ui.enableCanvasVideo': true,
  'ui.defaultHomeTab': 'Home',
};

export const DEFAULT_SETTINGS = defaultAppSettings;

/**
 * Validates and merges user settings delta into current settings.
 * Enforces strict type consistency with defaultAppSettings.
 */
export function mergeSettings(current: AppSettings, delta: Partial<AppSettings>): AppSettings {
  const updated: AppSettings = { ...current };
  for (const [key, value] of Object.entries(delta)) {
    if (key in defaultAppSettings) {
      const defaultVal = defaultAppSettings[key];
      if (defaultVal === null || typeof value === typeof defaultVal) {
        (updated as Record<string, unknown>)[key] = value;
      } else {
        throw new TypeError(
          `Invalid type for setting '${key}': expected ${typeof defaultVal}, got ${typeof value}`
        );
      }
    }
  }
  if ('nowPlayingLayout' in delta && !('appearance.nowPlayingLayout' in delta)) {
    updated.nowPlayingLayout = normalizeNowPlayingLayout(updated.nowPlayingLayout);
    updated['appearance.nowPlayingLayout'] = updated.nowPlayingLayout;
  } else if ('appearance.nowPlayingLayout' in delta && !('nowPlayingLayout' in delta)) {
    updated['appearance.nowPlayingLayout'] = normalizeNowPlayingLayout(updated['appearance.nowPlayingLayout']);
    updated.nowPlayingLayout = updated['appearance.nowPlayingLayout'];
  } else {
    updated.nowPlayingLayout = normalizeNowPlayingLayout(updated.nowPlayingLayout);
    updated['appearance.nowPlayingLayout'] = updated.nowPlayingLayout;
  }
  if ('hideAlbumCover' in delta && !('appearance.hideAlbumCover' in delta)) {
    updated['appearance.hideAlbumCover'] = updated.hideAlbumCover;
  } else if ('appearance.hideAlbumCover' in delta && !('hideAlbumCover' in delta)) {
    updated.hideAlbumCover = updated['appearance.hideAlbumCover'];
  }
  if ('lyricsAlignment' in delta && !('lyrics.alignment' in delta)) {
    updated['lyrics.alignment'] = updated.lyricsAlignment;
  } else if ('lyrics.alignment' in delta && !('lyricsAlignment' in delta)) {
    updated.lyricsAlignment = updated['lyrics.alignment'];
  }
  return updated;
}
