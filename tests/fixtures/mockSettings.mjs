// tests/fixtures/mockSettings.mjs
// Over 70 user settings and default configurations conforming to Survey 1 & 3

export const defaultAppSettings = {
  // Appearance & Theme (10 items)
  'appearance.themeMode': 'dark', // 'dark' | 'light' | 'system'
  'appearance.accentColor': '#FA2D48', // Apple Music Red
  'appearance.acrylicBlurEnabled': true,
  'appearance.acrylicBlurOpacity': 0.75,
  'appearance.liquidGlassControls': true,
  'appearance.fontFamily': 'SF Pro Display',
  'appearance.dynamicArtworkColor': true,
  'appearance.waveformStyle': 'bars68', // 'bars68' | 'thinSlider'
  'appearance.ambientBackdropGlow': true,
  'appearance.compactSidebar': false,

  // Audio Engine & Playback (16 items)
  'playback.crossfadeDurationSec': 4.0, // 0.0 to 12.0
  'playback.crossfadeCurve': 'constant_power', // 'constant_power' | 'linear'
  'playback.gaplessEnabled': true,
  'playback.automixEnabled': true,
  'playback.automixTransitionBars': 4,
  'playback.signalsmithStretchEnabled': true,
  'playback.replayGainMode': 'track', // 'off' | 'track' | 'album'
  'playback.replayGainPreampDb': 0.0,
  'playback.peakLimiterEnabled': true,
  'playback.peakLimiterCeiling': 0.985,
  'playback.preferredStreamingBitrate': 'high', // 'auto' | 'standard' | 'high' | 'lossless'
  'playback.audioOutputDevice': 'default',
  'playback.bitPerfectExclusiveAAudio': false,
  'playback.volumeLevel': 0.85,
  'playback.muted': false,
  'playback.stopPlaybackOnSleep': true,

  // Equalizer & DSP Calibration (10 items)
  'dsp.equalizerEnabled': true,
  'dsp.equalizerPreset': 'Flat',
  'dsp.equalizerBands': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // 10 bands in dB
  'dsp.bassGainDb': 0.0,
  'dsp.trebleGainDb': 0.0,
  'dsp.autoEqEnabled': false,
  'dsp.autoEqSelectedProfile': null,
  'dsp.spatialAudioEnabled': true,
  'dsp.spatialWidthGain': 2.5,
  'dsp.spatialCrossfeedDelayMs': 15,

  // Lyrics Engine (8 items)
  'lyrics.enabled': true,
  'lyrics.syllableSyncGlow': true,
  'lyrics.romanizationEnabled': false,
  'lyrics.translationEnabled': false,
  'lyrics.fontSize': 24,
  'lyrics.autoScrollSpeed': 'smooth',
  'lyrics.rtlSupport': true,
  'lyrics.providerPriority': ['AppleMusic', 'LrcLib', 'Musixmatch'],

  // Local Music & Storage (8 items)
  'storage.localFolders': ['C:\\Users\\traps\\Music'],
  'storage.watchLocalFolders': true,
  'storage.parseId3Tags': true,
  'storage.cacheSizeLimitMb': 4096,
  'storage.offlineDownloadsDirectory': 'C:\\Users\\traps\\AppData\\Local\\WaveForm\\downloads',
  'storage.autoClearOrphanedCache': true,
  'storage.syncLocalMetadata': true,
  'storage.embedArtworkInCache': true,

  // External Integrations & Scrobbling (10 items)
  'scrobble.lastFmEnabled': false,
  'scrobble.lastFmApiKey': '',
  'scrobble.lastFmSessionKey': '',
  'scrobble.listenBrainzEnabled': false,
  'scrobble.listenBrainzToken': '',
  'scrobble.discordRpcEnabled': true,
  'scrobble.discordShowTimeRemaining': true,
  'scrobble.discordShowAlbumArt': true,
  'listenTogether.serverUrl': 'wss://party.waveform.app/ws',
  'listenTogether.nickname': 'DesktopListener',

  // UI Navigation & Ergonomics (8 items)
  'ui.startInFullScreen': false,
  'ui.minimizeToTray': true,
  'ui.closeToTray': false,
  'ui.hardwareMediaKeys': true,
  'ui.mouseWheelVolumeStep': 0.05,
  'ui.enable3dCoverFlow': true,
  'ui.enableCanvasVideo': true,
  'ui.defaultHomeTab': 'Home',
};

/**
 * Validates and merges user settings delta into current settings.
 */
export function mergeSettings(current, delta) {
  const updated = { ...current };
  for (const [key, value] of Object.entries(delta)) {
    if (key in defaultAppSettings) {
      if (typeof value === typeof defaultAppSettings[key] || defaultAppSettings[key] === null) {
        updated[key] = value;
      } else {
        throw new TypeError(`Invalid type for setting '${key}': expected ${typeof defaultAppSettings[key]}, got ${typeof value}`);
      }
    }
  }
  return updated;
}
