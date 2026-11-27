import type { PlatformBridge } from './PlatformBridge';

const NOOP_UNSUB = () => {};

function getRawElectronHost(): Partial<PlatformBridge> | undefined {
  if (typeof window !== 'undefined' && (window as any).electronAPI) {
    return (window as any).electronAPI as Partial<PlatformBridge>;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as any).window?.electronAPI) {
    return (globalThis as any).window.electronAPI as Partial<PlatformBridge>;
  }
  return undefined;
}

export function hasLiveElectronHost(capability?: keyof PlatformBridge): boolean {
  const host = getRawElectronHost();
  if (!host) return false;
  if (!capability || capability === 'isDesktop' || capability === 'platform') return true;
  return typeof (host as any)[capability] === 'function';
}

function callAsync<T>(key: keyof PlatformBridge, fallback: T, ...args: any[]): Promise<T> {
  const host = getRawElectronHost();
  const fn = host ? (host as any)[key] : undefined;
  if (typeof fn === 'function') {
    return Promise.resolve(fn(...args));
  }
  return Promise.resolve(fallback);
}

function callSub(key: keyof PlatformBridge, cb: (...args: any[]) => void): () => void {
  const host = getRawElectronHost();
  const fn = host ? (host as any)[key] : undefined;
  if (typeof fn === 'function') {
    const unsub = fn(cb);
    return typeof unsub === 'function' ? unsub : NOOP_UNSUB;
  }
  return NOOP_UNSUB;
}

export function createElectronPlatformBridge(): PlatformBridge {
  return {
    get isDesktop() {
      return Boolean(getRawElectronHost());
    },
    get platform() {
      return getRawElectronHost()?.platform || 'web';
    },

    minimize: () => callAsync('minimize', undefined),
    maximize: () => callAsync('maximize', undefined),
    close: () => callAsync('close', undefined),
    isMaximized: () => callAsync('isMaximized', false),
    onMaximizedChange: (cb) => callSub('onMaximizedChange', cb),
    setFullscreen: (flag) => callAsync('setFullscreen', false, flag),
    isFullscreen: () => callAsync('isFullscreen', false),
    onFullscreenChange: (cb) => callSub('onFullscreenChange', cb),
    setTrayBehavior: (behavior) => callAsync('setTrayBehavior', undefined, behavior),
    onMediaCommand: (cb) => callSub('onMediaCommand', cb),

    fetch: (url, options) =>
      callAsync('fetch', { ok: false, status: 503, statusText: 'No Desktop Host', text: '' }, url, options),
    searchNetEaseLyrics: (payload) =>
      callAsync('searchNetEaseLyrics', { syncedLyrics: null, plainLyrics: null }, payload),
    searchKugouLyrics: (payload) =>
      callAsync('searchKugouLyrics', { syncedLyrics: null, plainLyrics: null }, payload),

    searchAutoEq: (query, limit) => callAsync('searchAutoEq', [], query, limit),
    findAutoEqProfile: (nameOrId) => callAsync('findAutoEqProfile', null, nameOrId),
    getAutoEqStatus: () => callAsync('getAutoEqStatus', null),

    partyStartLanHost: (options) => callAsync('partyStartLanHost', null, options),
    partyStopLanHost: () => callAsync('partyStopLanHost', false),
    partyGetLanInfo: () => callAsync('partyGetLanInfo', null),

    discordRpcUpdate: (payload) => callAsync('discordRpcUpdate', false, payload),
    discordRpcClear: () => callAsync('discordRpcClear', false),
    discordRpcGetStatus: () => callAsync('discordRpcGetStatus', null),
    discordRpcConfigure: (config) => callAsync('discordRpcConfigure', null, config),

    scrobbleConfigure: (config) => callAsync('scrobbleConfigure', null, config),
    scrobbleNowPlaying: (track) => callAsync('scrobbleNowPlaying', null, track),
    scrobbleSubmit: (track) => callAsync('scrobbleSubmit', null, track),
    scrobbleValidateListenBrainz: (token) => callAsync('scrobbleValidateListenBrainz', null, token),
    scrobbleTestLastFm: (cfg) => callAsync('scrobbleTestLastFm', null, cfg),
    scrobbleFlushQueue: () => callAsync('scrobbleFlushQueue', null),
    scrobbleGetStatus: () => callAsync('scrobbleGetStatus', null),

    getCustomLyrics: (trackKey) => callAsync('getCustomLyrics', null, trackKey),
    saveCustomLyrics: (trackKey, rawText, offsetMs) =>
      callAsync('saveCustomLyrics', null, trackKey, rawText, offsetMs),
    deleteCustomLyrics: (trackKey) => callAsync('deleteCustomLyrics', false, trackKey),
    setCustomLyricsOffset: (trackKey, offsetMs) =>
      callAsync('setCustomLyricsOffset', offsetMs, trackKey, offsetMs),
    getCustomLyricsOffset: (trackKey) => callAsync('getCustomLyricsOffset', 0, trackKey),

    hotkeysConfigure: (config) => callAsync('hotkeysConfigure', null, config),
    hotkeysGetStatus: () => callAsync('hotkeysGetStatus', null),
    hotkeysResetDefaults: () => callAsync('hotkeysResetDefaults', null),
    onHotkeyTriggered: (cb) => callSub('onHotkeyTriggered', cb),

    offlineCachePin: (input) => callAsync('offlineCachePin', null, input),
    offlineCacheUnpin: (trackId) => callAsync('offlineCacheUnpin', null, trackId),
    offlineCacheResolve: (trackId) => callAsync('offlineCacheResolve', null, trackId),
    offlineCacheGetStats: () => callAsync('offlineCacheGetStats', null),
    offlineCacheSetLimitGb: (gb) => callAsync('offlineCacheSetLimitGb', null, gb),
    offlineCacheClearUnpinned: () => callAsync('offlineCacheClearUnpinned', null),

    selectLocalFolder: () => callAsync('selectLocalFolder', { canceled: true, folderPath: null }),
    scanLocalFolder: (folderPath) => callAsync('scanLocalFolder', [], folderPath),
    loadLocalLibraryCache: () => callAsync('loadLocalLibraryCache', null),
    saveLocalLibraryCache: (payload) => callAsync('saveLocalLibraryCache', null, payload),
    incrementalScanLocalFolders: (extraFolders) =>
      callAsync(
        'incrementalScanLocalFolders',
        { folders: extraFolders ?? [], tracks: [], added: 0, updated: 0, removed: 0 },
        extraFolders
      ),
    removeLocalFolder: (folderPath) => callAsync('removeLocalFolder', null, folderPath),
    removeLocalLibraryFolder: (folderPath) => callAsync('removeLocalLibraryFolder', null, folderPath),
    showItemInFolder: (filePathOrUrl) => callAsync('showItemInFolder', false, filePathOrUrl),
    getMetadataCache: (keyOrTrack) => callAsync('getMetadataCache', null, keyOrTrack),
    setMetadataCache: (keyOrTrack, patch) => callAsync('setMetadataCache', null, keyOrTrack, patch),
    enrichLocalArtwork: (payload) => callAsync('enrichLocalArtwork', null, payload),

    loginYouTubeMusic: () => callAsync('loginYouTubeMusic', { connected: false }),
    loginSpotify: () => callAsync('loginSpotify', { connected: false }),
    getAccountAuthStatus: () =>
      callAsync('getAccountAuthStatus', {
        ytmusic: { connected: false },
        spotify: { connected: false },
      }),
    logoutAccount: (provider) => callAsync('logoutAccount', undefined, provider),
    getSpotifyPlaylists: () => callAsync('getSpotifyPlaylists', []),
    getSpotifyPlaylistTracks: (playlistId) => callAsync('getSpotifyPlaylistTracks', [], playlistId),

    resolveYoutubeStream: (videoId) => callAsync('resolveYoutubeStream', null, videoId),
    getArtworkPixels: (url) => callAsync('getArtworkPixels', null, url),

    lvGetMonitors: () => callAsync('lvGetMonitors', []),
    lvSetOverlayConfig: (config) => callAsync('lvSetOverlayConfig', null, config),
    lvOpenAmbient: (keepAwake) => callAsync('lvOpenAmbient', false, keepAwake),
    lvCloseAmbient: () => callAsync('lvCloseAmbient', false),
    lvSetAmbientSettings: (settings) => callAsync('lvSetAmbientSettings', null, settings),
    lvGetLyricsCache: (trackKey) => callAsync('lvGetLyricsCache', null, trackKey),
    lvSetLyricsCache: (trackKey, lyrics) => callAsync('lvSetLyricsCache', false, trackKey, lyrics),
    lvGetSongOffset: (trackKey) => callAsync('lvGetSongOffset', 0, trackKey),
    lvSetSongOffset: (trackKey, offsetMs) =>
      callAsync('lvSetSongOffset', offsetMs, trackKey, offsetMs),
    lvRequestSnapshot: () => callAsync('lvRequestSnapshot', null),
    lvSetKeepAwake: (enabled) => callAsync('lvSetKeepAwake', false, enabled),
    lvSaveClipFile: (payload) =>
      callAsync('lvSaveClipFile', { canceled: true, error: 'No Desktop Host' }, payload),
    lvBroadcastState: (payload) => {
      const host = getRawElectronHost();
      if (typeof host?.lvBroadcastState === 'function') {
        host.lvBroadcastState(payload);
      }
    },
    onLvStateBroadcast: (cb) => callSub('onLvStateBroadcast', cb),
    onLvPlatformEvent: (cb) => callSub('onLvPlatformEvent', cb),

    updaterCheck: () => callAsync('updaterCheck', null),
    updaterDownloadAndInstall: () => callAsync('updaterDownloadAndInstall', null),
    updaterDismissForSession: () => callAsync('updaterDismissForSession', null),
    updaterGetState: () => callAsync('updaterGetState', null),
    updaterOpenReleasePage: () => callAsync('updaterOpenReleasePage', false),
    onUpdaterStateChanged: (cb) => callSub('onUpdaterStateChanged', cb),

    getNativeCoreStatus: () => callAsync('getNativeCoreStatus', null),
    initNativeOnnxModels: () => callAsync('initNativeOnnxModels', null),
    replayLoad: () => callAsync('replayLoad', { version: 1, entries: [] }),
    replayAppend: (entry) => callAsync('replayAppend', { ok: false, count: 0 }, entry),
    replayFlush: (entries) => callAsync('replayFlush', { ok: false, count: 0 }, entries),
    replayReset: () => callAsync('replayReset', { ok: false }),
    importPlaylistFromUrl: (url) => callAsync('importPlaylistFromUrl', null, url),
    mlAnalyzeTrackBeats: (payload) => callAsync('mlAnalyzeTrackBeats', null, payload),
    mlSeparateVocals: (payload) => callAsync('mlSeparateVocals', null, payload),
    mlAutoSyncLyrics: (payload) =>
      callAsync('mlAutoSyncLyrics', { offsetMs: 0, confidence: 0 }, payload),
  };
}
