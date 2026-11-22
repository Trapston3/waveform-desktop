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
  fetch: (url: string, options?: Record<string, any>) => Promise<ElectronFetchResult>;
  searchAutoEq: (query: string, limit?: number) => Promise<any[]>;
  findAutoEqProfile: (nameOrId: string) => Promise<any | null>;
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
  fetch: (url: string, options?: Record<string, any>) =>
    ipcRenderer.invoke('network-fetch', { url, options }),
  searchAutoEq: (query: string, limit?: number) =>
    ipcRenderer.invoke('autoeq-search', query, limit),
  findAutoEqProfile: (nameOrId: string) =>
    ipcRenderer.invoke('autoeq-find-profile', nameOrId),
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
  platform: process.platform,
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
