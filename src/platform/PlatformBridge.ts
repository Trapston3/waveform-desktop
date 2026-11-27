export interface PlatformFetchResult {
  ok: boolean;
  status: number;
  statusText: string;
  text: string;
}

export interface PlatformMonitorInfo {
  id: string;
  label: string;
  bounds: any;
  workArea: any;
  scaleFactor: number;
  isPrimary: boolean;
}

export interface PlatformBridge {
  readonly isDesktop: boolean;
  readonly platform: string;

  // Window & Tray
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onMaximizedChange: (callback: (isMaximized: boolean) => void) => () => void;
  setFullscreen: (flag: boolean) => Promise<boolean>;
  isFullscreen: () => Promise<boolean>;
  onFullscreenChange: (callback: (isFullscreen: boolean) => void) => () => void;
  setTrayBehavior: (behavior: { minimizeToTray?: boolean; closeToTray?: boolean }) => Promise<void>;
  onMediaCommand: (
    callback: (command: 'toggle-playback' | 'next-track' | 'prev-track') => void
  ) => () => void;

  // Network & Lyrics Search
  fetch: (url: string, options?: Record<string, any>) => Promise<PlatformFetchResult>;
  searchNetEaseLyrics: (payload: {
    title: string;
    artist?: string;
    durationSec?: number;
  }) => Promise<{ syncedLyrics: string | null; plainLyrics: string | null }>;
  searchKugouLyrics: (payload: {
    title: string;
    artist?: string;
    durationSec?: number;
  }) => Promise<{ syncedLyrics: string | null; plainLyrics: string | null }>;

  // AutoEQ
  searchAutoEq: (query: string, limit?: number) => Promise<any[]>;
  findAutoEqProfile: (nameOrId: string) => Promise<any | null>;
  getAutoEqStatus: () => Promise<any>;

  // Party LAN Host
  partyStartLanHost: (options?: Record<string, any>) => Promise<any>;
  partyStopLanHost: () => Promise<boolean>;
  partyGetLanInfo: () => Promise<any>;

  // Discord RPC
  discordRpcUpdate: (payload: Record<string, any>) => Promise<boolean>;
  discordRpcClear: () => Promise<boolean>;
  discordRpcGetStatus: () => Promise<any>;
  discordRpcConfigure: (config: Record<string, any>) => Promise<any>;

  // Scrobbler
  scrobbleConfigure: (config: Record<string, any>) => Promise<any>;
  scrobbleNowPlaying: (track: Record<string, any>) => Promise<any>;
  scrobbleSubmit: (track: Record<string, any>) => Promise<any>;
  scrobbleValidateListenBrainz: (token: string) => Promise<any>;
  scrobbleTestLastFm: (cfg: Record<string, any>) => Promise<any>;
  scrobbleFlushQueue: () => Promise<any>;
  scrobbleGetStatus: () => Promise<any>;

  // Custom Lyrics
  getCustomLyrics: (trackKey: string) => Promise<any>;
  saveCustomLyrics: (trackKey: string, rawText: string, offsetMs?: number) => Promise<any>;
  deleteCustomLyrics: (trackKey: string) => Promise<boolean>;
  setCustomLyricsOffset: (trackKey: string, offsetMs: number) => Promise<number>;
  getCustomLyricsOffset: (trackKey: string) => Promise<number>;

  // Global Hotkeys
  hotkeysConfigure: (config: Record<string, any>) => Promise<any>;
  hotkeysGetStatus: () => Promise<any>;
  hotkeysResetDefaults: () => Promise<any>;
  onHotkeyTriggered: (callback: (action: string) => void) => () => void;

  // Offline Cache
  offlineCachePin: (input: Record<string, any>) => Promise<any>;
  offlineCacheUnpin: (trackId: string) => Promise<any>;
  offlineCacheResolve: (trackId: string) => Promise<any>;
  offlineCacheGetStats: () => Promise<any>;
  offlineCacheSetLimitGb: (gb: number) => Promise<any>;
  offlineCacheClearUnpinned: () => Promise<any>;

  // Local Media & Metadata Cache
  selectLocalFolder: () => Promise<{ canceled: boolean; folderPath: string | null }>;
  scanLocalFolder: (folderPath: string) => Promise<any[]>;
  loadLocalLibraryCache: () => Promise<{
    version: number;
    folders: string[];
    tracks: any[];
    updatedAt?: number;
  } | null>;
  saveLocalLibraryCache: (payload: { folders: string[]; tracks: any[] }) => Promise<any>;
  incrementalScanLocalFolders: (extraFolders?: string[]) => Promise<{
    folders: string[];
    tracks: any[];
    added: number;
    updated: number;
    removed: number;
  }>;
  removeLocalFolder: (folderPath: string) => Promise<any>;
  removeLocalLibraryFolder?: (folderPath: string) => Promise<any>;
  showItemInFolder: (filePathOrUrl: string) => Promise<boolean>;
  getMetadataCache: (
    keyOrTrack: string | { artist?: string; title?: string; durationSec?: number }
  ) => Promise<Record<string, any> | null>;
  setMetadataCache: (
    keyOrTrack: string | { artist?: string; title?: string; durationSec?: number },
    patch: Record<string, any>
  ) => Promise<Record<string, any> | null>;
  enrichLocalArtwork: (payload: {
    artist?: string;
    title?: string;
    durationSec?: number;
  }) => Promise<string | null>;

  // Account Auth & Spotify
  loginYouTubeMusic: () => Promise<{ connected: boolean; displayName?: string }>;
  loginSpotify: () => Promise<{ connected: boolean; displayName?: string }>;
  getAccountAuthStatus: () => Promise<
    Record<'ytmusic' | 'spotify', { connected: boolean; displayName?: string }>
  >;
  logoutAccount: (provider: 'ytmusic' | 'spotify') => Promise<void>;
  getSpotifyPlaylists: () => Promise<any[]>;
  getSpotifyPlaylistTracks: (playlistId: string) => Promise<any[]>;

  // Streams & Artwork Pixels
  resolveYoutubeStream: (
    videoId: string
  ) => Promise<{
    streamUrl: string;
    mimeType: string;
    durationSec: number;
    sourceClient: string;
    cached: boolean;
  } | null>;
  getArtworkPixels: (
    url: string
  ) => Promise<{ width: number; height: number; rgba: Uint8Array } | null>;

  // LyricVisualizer Windows, Cache & Clip Save
  lvGetMonitors: () => Promise<PlatformMonitorInfo[]>;
  lvSetOverlayConfig: (config: {
    enabled?: boolean;
    monitorIds?: string[];
    opacity?: number;
    locked?: boolean;
  }) => Promise<any>;
  lvOpenAmbient: (keepAwake?: boolean) => Promise<boolean>;
  lvCloseAmbient: () => Promise<boolean>;
  lvSetAmbientSettings: (settings: {
    keepAwake?: boolean;
    keepAwakeInAmbient?: boolean;
    idleAmbientSeconds?: number;
    gameGuardEnabled?: boolean;
  }) => Promise<any>;
  lvGetLyricsCache: (trackKey: string) => Promise<any>;
  lvSetLyricsCache: (trackKey: string, lyrics: any) => Promise<boolean>;
  lvGetSongOffset: (trackKey: string) => Promise<number>;
  lvSetSongOffset: (trackKey: string, offsetMs: number) => Promise<number>;
  lvRequestSnapshot: () => Promise<any>;
  lvSetKeepAwake: (enabled: boolean) => Promise<boolean>;
  lvSaveClipFile: (payload: {
    defaultName: string;
    bytes: Uint8Array;
  }) => Promise<{ canceled: boolean; filePath?: string; error?: string }>;
  lvBroadcastState: (payload: any) => void;
  onLvStateBroadcast: (callback: (payload: any) => void) => () => void;
  onLvPlatformEvent: (callback: (evt: { type: string; data?: any }) => void) => () => void;

  // Updater
  updaterCheck: () => Promise<any>;
  updaterDownloadAndInstall: () => Promise<any>;
  updaterDismissForSession: () => Promise<any>;
  updaterGetState: () => Promise<any>;
  updaterOpenReleasePage: () => Promise<any>;
  onUpdaterStateChanged: (callback: (state: any) => void) => () => void;

  // Native Core & ML Audio
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
}
