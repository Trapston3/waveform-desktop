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
  fetch: (url: string, options?: Record<string, any>) => Promise<ElectronFetchResult>;
  searchAutoEq: (query: string, limit?: number) => Promise<any[]>;
  findAutoEqProfile: (nameOrId: string) => Promise<any | null>;
  selectLocalFolder: () => Promise<{ canceled: boolean; folderPath: string | null }>;
  scanLocalFolder: (folderPath: string) => Promise<any[]>;
  getMetadataCache: (keyOrTrack: string | { artist?: string; title?: string; durationSec?: number }) => Promise<Record<string, any> | null>;
  setMetadataCache: (keyOrTrack: string | { artist?: string; title?: string; durationSec?: number }, patch: Record<string, any>) => Promise<Record<string, any> | null>;
  enrichLocalArtwork: (payload: { artist?: string; title?: string; durationSec?: number }) => Promise<string | null>;
  loginYouTubeMusic: () => Promise<{ connected: boolean; displayName?: string }>;
  loginSpotify: () => Promise<{ connected: boolean; displayName?: string }>;
  getAccountAuthStatus: () => Promise<Record<'ytmusic' | 'spotify', { connected: boolean; displayName?: string }>>;
  logoutAccount: (provider: 'ytmusic' | 'spotify') => Promise<void>;
  getSpotifyPlaylists: () => Promise<any[]>;
  getSpotifyPlaylistTracks: (playlistId: string) => Promise<any[]>;
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
  fetch: (url: string, options?: Record<string, any>) =>
    ipcRenderer.invoke('network-fetch', { url, options }),
  searchAutoEq: (query: string, limit?: number) =>
    ipcRenderer.invoke('autoeq-search', query, limit),
  findAutoEqProfile: (nameOrId: string) =>
    ipcRenderer.invoke('autoeq-find-profile', nameOrId),
  selectLocalFolder: () => ipcRenderer.invoke('select-local-folder'),
  scanLocalFolder: (folderPath: string) => ipcRenderer.invoke('scan-local-folder', folderPath),
  getMetadataCache: (keyOrTrack) => ipcRenderer.invoke('local-get-metadata-cache', keyOrTrack),
  setMetadataCache: (keyOrTrack, patch) => ipcRenderer.invoke('local-set-metadata-cache', keyOrTrack, patch),
  enrichLocalArtwork: (payload) => ipcRenderer.invoke('local-enrich-artwork', payload),
  loginYouTubeMusic: () => ipcRenderer.invoke('account-login', 'ytmusic'),
  loginSpotify: () => ipcRenderer.invoke('account-login', 'spotify'),
  getAccountAuthStatus: () => ipcRenderer.invoke('account-status'),
  logoutAccount: (provider) => ipcRenderer.invoke('account-logout', provider),
  getSpotifyPlaylists: () => ipcRenderer.invoke('spotify-get-playlists'),
  getSpotifyPlaylistTracks: (playlistId: string) => ipcRenderer.invoke('spotify-get-playlist-tracks', playlistId),
  platform: process.platform,
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
