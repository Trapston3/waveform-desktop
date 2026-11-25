import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronFetchResult {
  ok: boolean;
  status: number;
  statusText: string;
  text: string;
}

export interface ElectronAPI {
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onMaximizedChange: (callback: (isMaximized: boolean) => void) => () => void;
  setFullscreen: (flag: boolean) => Promise<boolean>;
  isFullscreen: () => Promise<boolean>;
  onFullscreenChange: (callback: (isFullscreen: boolean) => void) => () => void;
  setTrayBehavior: (behavior: { minimizeToTray?: boolean; closeToTray?: boolean }) => Promise<void>;
  onMediaCommand: (callback: (command: 'toggle-playback' | 'next-track' | 'prev-track') => void) => () => void;
  fetch: (url: string, options?: Record<string, any>) => Promise<ElectronFetchResult>;
  searchAutoEq: (query: string, limit?: number) => Promise<any[]>;
  findAutoEqProfile: (nameOrId: string) => Promise<any | null>;
  getAutoEqStatus: () => Promise<any>;
  partyStartLanHost: (options?: Record<string, any>) => Promise<any>;
  partyStopLanHost: () => Promise<boolean>;
  partyGetLanInfo: () => Promise<any>;
  discordRpcUpdate: (payload: Record<string, any>) => Promise<boolean>;
  discordRpcClear: () => Promise<boolean>;
  discordRpcGetStatus: () => Promise<any>;
  discordRpcConfigure: (config: Record<string, any>) => Promise<any>;
  selectLocalFolder: () => Promise<{ canceled: boolean; folderPath: string | null }>;
  scanLocalFolder: (folderPath: string) => Promise<any[]>;
  loadLocalLibraryCache: () => Promise<{ version: number; folders: string[]; tracks: any[]; updatedAt?: number } | null>;
  saveLocalLibraryCache: (payload: { folders: string[]; tracks: any[] }) => Promise<any>;
  incrementalScanLocalFolders: (extraFolders?: string[]) => Promise<{ folders: string[]; tracks: any[]; added: number; updated: number; removed: number }>;
  removeLocalFolder: (folderPath: string) => Promise<any>;
  showItemInFolder: (filePathOrUrl: string) => Promise<boolean>;
  getMetadataCache: (keyOrTrack: string | { artist?: string; title?: string; durationSec?: number }) => Promise<Record<string, any> | null>;
  setMetadataCache: (keyOrTrack: string | { artist?: string; title?: string; durationSec?: number }, patch: Record<string, any>) => Promise<Record<string, any> | null>;
  enrichLocalArtwork: (payload: { artist?: string; title?: string; durationSec?: number }) => Promise<string | null>;
  loginYouTubeMusic: () => Promise<{ connected: boolean; displayName?: string }>;
  loginSpotify: () => Promise<{ connected: boolean; displayName?: string }>;
  getAccountAuthStatus: () => Promise<Record<'ytmusic' | 'spotify', { connected: boolean; displayName?: string }>>;
  logoutAccount: (provider: 'ytmusic' | 'spotify') => Promise<void>;
  getSpotifyPlaylists: () => Promise<any[]>;
  getSpotifyPlaylistTracks: (playlistId: string) => Promise<any[]>;
  resolveYoutubeStream: (videoId: string) => Promise<{ streamUrl: string; mimeType: string; durationSec: number; sourceClient: string; cached: boolean } | null>;
  getArtworkPixels: (url: string) => Promise<{ width: number; height: number; rgba: Uint8Array } | null>;
  lvGetMonitors: () => Promise<Array<{ id: string; label: string; bounds: any; workArea: any; scaleFactor: number; isPrimary: boolean }>>;
  lvSetOverlayConfig: (config: { enabled?: boolean; monitorIds?: string[]; opacity?: number; locked?: boolean }) => Promise<any>;
  lvOpenAmbient: (keepAwake?: boolean) => Promise<boolean>;
  lvCloseAmbient: () => Promise<boolean>;
  lvSetAmbientSettings: (settings: { keepAwake?: boolean; keepAwakeInAmbient?: boolean; idleAmbientSeconds?: number; gameGuardEnabled?: boolean }) => Promise<any>;
  lvGetLyricsCache: (trackKey: string) => Promise<any>;
  lvSetLyricsCache: (trackKey: string, lyrics: any) => Promise<boolean>;
  lvGetSongOffset: (trackKey: string) => Promise<number>;
  lvSetSongOffset: (trackKey: string, offsetMs: number) => Promise<number>;
  lvRequestSnapshot: () => Promise<any>;
  lvSetKeepAwake: (enabled: boolean) => Promise<boolean>;
  lvBroadcastState: (payload: any) => void;
  onLvStateBroadcast: (callback: (payload: any) => void) => () => void;
  onLvPlatformEvent: (callback: (evt: { type: string; data?: any }) => void) => () => void;
  updaterCheck: () => Promise<any>;
  updaterDownloadAndInstall: () => Promise<any>;
  updaterDismissForSession: () => Promise<any>;
  updaterGetState: () => Promise<any>;
  updaterOpenReleasePage: () => Promise<any>;
  onUpdaterStateChanged: (callback: (state: any) => void) => () => void;
  getNativeCoreStatus: () => Promise<any>;
  initNativeOnnxModels: () => Promise<any>;
  replayLoad: () => Promise<{ version: number; entries: any[] }>;
  replayAppend: (entry: any) => Promise<{ ok: boolean; count: number }>;
  replayFlush: (entries: any[]) => Promise<{ ok: boolean; count: number; entries?: any[] }>;
  replayReset: () => Promise<{ ok: boolean }>;
  importPlaylistFromUrl: (url: string) => Promise<any>;
  mlAnalyzeTrackBeats: (payload: {
    trackId: string;
    leftPcm?: Float32Array | number[] | null;
    rightPcm?: Float32Array | number[] | null;
    sampleRate?: number;
    forceRefresh?: boolean;
  }) => Promise<any>;
  mlSeparateVocals: (payload: {
    trackId: string;
    leftPcm?: Float32Array | number[] | null;
    rightPcm?: Float32Array | number[] | null;
    sampleRate?: number;
  }) => Promise<any>;
  mlAutoSyncLyrics: (payload: {
    vocalEnvelope: Float32Array | number[];
    envelopeFps?: number;
    lineStartTimesSec: number[];
  }) => Promise<{ offsetMs: number; confidence: number }>;
  platform: string;
}

const electronAPI: ElectronAPI = {
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onMaximizedChange: (callback: (isMaximized: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: boolean) => callback(value);
    ipcRenderer.on('window-maximized-change', handler);
    return () => {
      ipcRenderer.removeListener('window-maximized-change', handler);
    };
  },
  setFullscreen: (flag: boolean) => ipcRenderer.invoke('window-set-fullscreen', Boolean(flag)),
  isFullscreen: () => ipcRenderer.invoke('window-is-fullscreen'),
  onFullscreenChange: (callback: (isFullscreen: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: boolean) => callback(value);
    ipcRenderer.on('window-fullscreen-change', handler);
    return () => {
      ipcRenderer.removeListener('window-fullscreen-change', handler);
    };
  },
  setTrayBehavior: (behavior: { minimizeToTray?: boolean; closeToTray?: boolean }) =>
    ipcRenderer.invoke('ui:setTrayBehavior', behavior),
  onMediaCommand: (callback: (command: 'toggle-playback' | 'next-track' | 'prev-track') => void) => {
    const onToggle = () => callback('toggle-playback');
    const onNext = () => callback('next-track');
    const onPrev = () => callback('prev-track');
    ipcRenderer.on('media-toggle-playback', onToggle);
    ipcRenderer.on('media-next-track', onNext);
    ipcRenderer.on('media-prev-track', onPrev);
    return () => {
      ipcRenderer.removeListener('media-toggle-playback', onToggle);
      ipcRenderer.removeListener('media-next-track', onNext);
      ipcRenderer.removeListener('media-prev-track', onPrev);
    };
  },
  fetch: (url: string, options?: Record<string, any>) =>
    ipcRenderer.invoke('network-fetch', { url, options }),
  searchAutoEq: (query: string, limit?: number) =>
    ipcRenderer.invoke('autoeq-search', query, limit),
  findAutoEqProfile: (nameOrId: string) =>
    ipcRenderer.invoke('autoeq-find-profile', nameOrId),
  getAutoEqStatus: () =>
    ipcRenderer.invoke('autoeq:status'),
  partyStartLanHost: (options?: Record<string, any>) =>
    ipcRenderer.invoke('party:startLanHost', options),
  partyStopLanHost: () =>
    ipcRenderer.invoke('party:stopLanHost'),
  partyGetLanInfo: () =>
    ipcRenderer.invoke('party:getLanInfo'),
  discordRpcUpdate: (payload: Record<string, any>) =>
    ipcRenderer.invoke('discordRpc:update', payload),
  discordRpcClear: () =>
    ipcRenderer.invoke('discordRpc:clear'),
  discordRpcGetStatus: () =>
    ipcRenderer.invoke('discordRpc:getStatus'),
  discordRpcConfigure: (config: Record<string, any>) =>
    ipcRenderer.invoke('discordRpc:configure', config),
  selectLocalFolder: () => ipcRenderer.invoke('select-local-folder'),
  scanLocalFolder: (folderPath: string) => ipcRenderer.invoke('scan-local-folder', folderPath),
  loadLocalLibraryCache: () => ipcRenderer.invoke('local-library-load-cache'),
  saveLocalLibraryCache: (payload) => ipcRenderer.invoke('local-library-save-cache', payload),
  incrementalScanLocalFolders: (extraFolders) => ipcRenderer.invoke('local-library-incremental-scan', extraFolders),
  removeLocalFolder: (folderPath) => ipcRenderer.invoke('local-library-remove-folder', folderPath),
  showItemInFolder: (filePathOrUrl) => ipcRenderer.invoke('show-item-in-folder', filePathOrUrl),
  getMetadataCache: (keyOrTrack) => ipcRenderer.invoke('local-get-metadata-cache', keyOrTrack),
  setMetadataCache: (keyOrTrack, patch) => ipcRenderer.invoke('local-set-metadata-cache', keyOrTrack, patch),
  enrichLocalArtwork: (payload) => ipcRenderer.invoke('local-enrich-artwork', payload),
  loginYouTubeMusic: () => ipcRenderer.invoke('account-login', 'ytmusic'),
  loginSpotify: () => ipcRenderer.invoke('account-login', 'spotify'),
  getAccountAuthStatus: () => ipcRenderer.invoke('account-status'),
  logoutAccount: (provider) => ipcRenderer.invoke('account-logout', provider),
  getSpotifyPlaylists: () => ipcRenderer.invoke('spotify-get-playlists'),
  getSpotifyPlaylistTracks: (playlistId: string) => ipcRenderer.invoke('spotify-get-playlist-tracks', playlistId),
  resolveYoutubeStream: (videoId: string) => ipcRenderer.invoke('resolve-youtube-stream', videoId),
  getArtworkPixels: (url: string) => ipcRenderer.invoke('get-artwork-pixels', url),
  lvGetMonitors: () => ipcRenderer.invoke('lv-get-monitors'),
  lvSetOverlayConfig: (config) => ipcRenderer.invoke('lv-set-overlay-config', config),
  lvOpenAmbient: (keepAwake) => ipcRenderer.invoke('lv-open-ambient', keepAwake),
  lvCloseAmbient: () => ipcRenderer.invoke('lv-close-ambient'),
  lvSetAmbientSettings: (settings) => ipcRenderer.invoke('lv-set-ambient-settings', settings),
  lvGetLyricsCache: (trackKey) => ipcRenderer.invoke('lv-get-lyrics-cache', trackKey),
  lvSetLyricsCache: (trackKey, lyrics) => ipcRenderer.invoke('lv-set-lyrics-cache', trackKey, lyrics),
  lvGetSongOffset: (trackKey) => ipcRenderer.invoke('lv-get-song-offset', trackKey),
  lvSetSongOffset: (trackKey, offsetMs) => ipcRenderer.invoke('lv-set-song-offset', trackKey, offsetMs),
  lvRequestSnapshot: () => ipcRenderer.invoke('lv-request-snapshot'),
  lvSetKeepAwake: (enabled) => ipcRenderer.invoke('lv-set-keep-awake', Boolean(enabled)),
  lvBroadcastState: (payload) => {
    ipcRenderer.send('lv-broadcast-state', payload);
  },
  onLvStateBroadcast: (callback: (payload: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: any) => callback(payload);
    ipcRenderer.on('lv-state-broadcast', handler);
    return () => {
      ipcRenderer.removeListener('lv-state-broadcast', handler);
    };
  },
  onLvPlatformEvent: (callback: (evt: { type: string; data?: any }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, evt: { type: string; data?: any }) => callback(evt);
    ipcRenderer.on('lv-platform-event', handler);
    return () => {
      ipcRenderer.removeListener('lv-platform-event', handler);
    };
  },
  updaterCheck: () => ipcRenderer.invoke('updater:check'),
  updaterDownloadAndInstall: () => ipcRenderer.invoke('updater:downloadAndInstall'),
  updaterDismissForSession: () => ipcRenderer.invoke('updater:dismissForSession'),
  updaterGetState: () => ipcRenderer.invoke('updater:getState'),
  updaterOpenReleasePage: () => ipcRenderer.invoke('updater:openReleasePage'),
  onUpdaterStateChanged: (callback: (state: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: any) => callback(state);
    ipcRenderer.on('updater:state-changed', handler);
    return () => {
      ipcRenderer.removeListener('updater:state-changed', handler);
    };
  },
  getNativeCoreStatus: () => ipcRenderer.invoke('nativeCore:status'),
  initNativeOnnxModels: () => ipcRenderer.invoke('nativeCore:onnxInit'),
  replayLoad: () => ipcRenderer.invoke('replay:load'),
  replayAppend: (entry: any) => ipcRenderer.invoke('replay:append', entry),
  replayFlush: (entries: any[]) => ipcRenderer.invoke('replay:flush', entries),
  replayReset: () => ipcRenderer.invoke('replay:reset'),
  importPlaylistFromUrl: (url: string) => ipcRenderer.invoke('playlist:import-url', url),
  mlAnalyzeTrackBeats: (payload: any) => ipcRenderer.invoke('ml:analyzeTrackBeats', payload),
  mlSeparateVocals: (payload: any) => ipcRenderer.invoke('ml:separateVocals', payload),
  mlAutoSyncLyrics: (payload: any) => ipcRenderer.invoke('ml:autoSyncLyrics', payload),
  platform: process.platform,
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
