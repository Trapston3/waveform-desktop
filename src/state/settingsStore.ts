// src/state/settingsStore.ts
// Reactive bidirectional synchronization of over 70 user settings with StorageService

import { create, useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { AppSettings } from '../models/Settings';
import { defaultAppSettings, mergeSettings } from '../models/Settings';
import { StorageService } from '../services/StorageService';
import { applyThemeSettings } from '../ui/theme/Theme';
import { getPlatformBridge, hasPlatformBridge } from '../platform/index';
import type { useLyricVisualizerStore as UseLyricVisualizerStoreType } from '../lyricVisualizer/state/lyricVisualizerStore';

export interface SettingsState {
  settings: AppSettings;
  isLoaded: boolean;
  isLoading: boolean;
  storageService: StorageService | null;
}

export interface SettingsActions {
  initSettings: (storage?: StorageService) => Promise<void>;
  updateSettings: (delta: Partial<AppSettings>) => Promise<void>;
  getSetting: <K extends keyof AppSettings>(key: K) => AppSettings[K];
  resetToDefaults: () => Promise<void>;
}

export type SettingsStore = SettingsState & SettingsActions;

let globalStorageService: StorageService | null = null;
let isSyncingWithVisualizer = false;
let cachedVizStore: typeof UseLyricVisualizerStoreType | null = null;
let vizSubscribed = false;

function attachVisualizerSubscription(vizStore: typeof UseLyricVisualizerStoreType): void {
  cachedVizStore = vizStore;
  if (vizSubscribed) return;
  vizSubscribed = true;

  vizStore.subscribe((state, prevState) => {
    if (isSyncingWithVisualizer) return;
    const cfg = state.config;
    const prevCfg = prevState.config;
    if (!cfg || !prevCfg) return;

    const layoutChanged = cfg.nowPlayingLayout !== prevCfg.nowPlayingLayout;
    const hideCoverChanged = cfg.hideAlbumCover !== prevCfg.hideAlbumCover;
    const alignChanged = cfg.textAlign !== prevCfg.textAlign;
    const scriptModeChanged = cfg.scriptMode !== prevCfg.scriptMode;

    if (!layoutChanged && !hideCoverChanged && !alignChanged && !scriptModeChanged) return;

    const currentSettings = useSettingsStore.getState().settings;
    const delta: Partial<AppSettings> = {};

    if (
      layoutChanged &&
      cfg.nowPlayingLayout &&
      currentSettings.nowPlayingLayout !== cfg.nowPlayingLayout
    ) {
      delta.nowPlayingLayout = cfg.nowPlayingLayout;
      delta['appearance.nowPlayingLayout'] = cfg.nowPlayingLayout;
    }
    if (
      hideCoverChanged &&
      typeof cfg.hideAlbumCover === 'boolean' &&
      currentSettings.hideAlbumCover !== cfg.hideAlbumCover
    ) {
      delta.hideAlbumCover = cfg.hideAlbumCover;
      delta['appearance.hideAlbumCover'] = cfg.hideAlbumCover;
    }
    if (alignChanged && cfg.textAlign && currentSettings.lyricsAlignment !== cfg.textAlign) {
      delta.lyricsAlignment = cfg.textAlign;
      delta['lyrics.alignment'] = cfg.textAlign;
    }
    if (
      scriptModeChanged &&
      cfg.scriptMode &&
      currentSettings['lyrics.scriptMode'] !== cfg.scriptMode
    ) {
      delta['lyrics.scriptMode'] = cfg.scriptMode;
    }

    if (Object.keys(delta).length > 0) {
      isSyncingWithVisualizer = true;
      useSettingsStore
        .getState()
        .updateSettings(delta)
        .catch(() => {})
        .finally(() => {
          isSyncingWithVisualizer = false;
        });
    }
  });
}

export function registerLyricVisualizerStore(vizStore: typeof UseLyricVisualizerStoreType): void {
  if (!vizStore) return;
  attachVisualizerSubscription(vizStore);
  const current = useSettingsStore.getState().settings;
  if (current) {
    pushSettingsToVisualizer(current);
  }
}

async function ensureVizStore(): Promise<typeof UseLyricVisualizerStoreType | null> {
  return cachedVizStore;
}

function pushTrayBehavior(updated: AppSettings): void {
  try {
    if (!hasPlatformBridge('setTrayBehavior')) return;

    Promise.resolve(
      getPlatformBridge().setTrayBehavior({
        minimizeToTray: Boolean(updated['ui.minimizeToTray']),
        closeToTray: Boolean(updated['ui.closeToTray']),
      })
    ).catch(() => {});
  } catch {
    // Non-fatal in isolated test environments
  }
}

function pushDiscordRpcConfig(updated: AppSettings): void {
  try {
    if (!hasPlatformBridge('discordRpcConfigure')) return;

    const rawClientId =
      typeof updated['scrobble.discordClientId'] === 'string'
        ? updated['scrobble.discordClientId'].trim()
        : '';
    const showQualityAndButtons = Boolean(updated['scrobble.discordShowQualityAndButtons']);

    Promise.resolve(
      getPlatformBridge().discordRpcConfigure({
        enabled: Boolean(updated['scrobble.discordRpcEnabled']),
        clientId: rawClientId || defaultAppSettings['scrobble.discordClientId'],
        displayFormat:
          updated['scrobble.discordDisplayFormat'] ||
          defaultAppSettings['scrobble.discordDisplayFormat'],
        showTimeRemaining: Boolean(updated['scrobble.discordShowTimeRemaining']),
        showAlbumArt: Boolean(updated['scrobble.discordShowAlbumArt']),
        showQualityAndButtons,
        showButtons: showQualityAndButtons,
      })
    ).catch(() => {});
  } catch {
    // Non-fatal in isolated test environments
  }
}

function pushSettingsToVisualizer(
  updated: AppSettings,
  delta?: Partial<AppSettings>,
  isReset = false
): void {
  if (isSyncingWithVisualizer || !cachedVizStore) return;
  isSyncingWithVisualizer = true;
  try {
    const viz = cachedVizStore.getState();
    const shouldSyncLayout =
      isReset || !delta || 'nowPlayingLayout' in delta || 'appearance.nowPlayingLayout' in delta;
    const shouldSyncHideCover =
      isReset || !delta || 'hideAlbumCover' in delta || 'appearance.hideAlbumCover' in delta;
    const shouldSyncAlign =
      isReset ||
      (delta
        ? 'lyricsAlignment' in delta || 'lyrics.alignment' in delta
        : updated.lyricsAlignment !== defaultAppSettings.lyricsAlignment);
    const shouldSyncScriptMode =
      isReset ||
      (delta
        ? 'lyrics.scriptMode' in delta
        : updated['lyrics.scriptMode'] !== defaultAppSettings['lyrics.scriptMode']);

    if (shouldSyncLayout && viz.config.nowPlayingLayout !== updated.nowPlayingLayout) {
      viz.setNowPlayingLayout?.(updated.nowPlayingLayout);
    }
    if (shouldSyncHideCover && viz.config.hideAlbumCover !== updated.hideAlbumCover) {
      viz.setHideAlbumCover?.(updated.hideAlbumCover);
    }
    if (shouldSyncAlign && viz.config.textAlign !== updated.lyricsAlignment) {
      viz.setTextAlign?.(updated.lyricsAlignment);
    }
    if (shouldSyncScriptMode && viz.config.scriptMode !== updated['lyrics.scriptMode']) {
      viz.setScriptMode?.(updated['lyrics.scriptMode']);
    }
  } catch {
    // Ignore in isolated mock tests
  } finally {
    isSyncingWithVisualizer = false;
  }
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: { ...defaultAppSettings },
  isLoaded: false,
  isLoading: false,
  storageService: null,

  initSettings: async (storage?: StorageService) => {
    if (get().isLoaded && !storage) return;

    const storageInstance = storage || globalStorageService || new StorageService();
    globalStorageService = storageInstance;

    set({ isLoading: true, storageService: storageInstance });
    try {
      const vizStore = await ensureVizStore();
      const loaded = await storageInstance.getSettings();
      let merged = mergeSettings(defaultAppSettings, loaded);

      // Reconcile with persisted useLyricVisualizerStore if settings are still at defaults
      const vizCfg = vizStore?.getState()?.config;
      if (vizCfg) {
        const vizDelta: Partial<AppSettings> = {};
        if (
          merged.nowPlayingLayout === defaultAppSettings.nowPlayingLayout &&
          vizCfg.nowPlayingLayout &&
          vizCfg.nowPlayingLayout !== merged.nowPlayingLayout
        ) {
          vizDelta.nowPlayingLayout = vizCfg.nowPlayingLayout;
        }
        if (
          merged.hideAlbumCover === defaultAppSettings.hideAlbumCover &&
          typeof vizCfg.hideAlbumCover === 'boolean' &&
          vizCfg.hideAlbumCover !== merged.hideAlbumCover
        ) {
          vizDelta.hideAlbumCover = vizCfg.hideAlbumCover;
        }
        if (
          merged['lyrics.scriptMode'] === defaultAppSettings['lyrics.scriptMode'] &&
          vizCfg.scriptMode &&
          vizCfg.scriptMode !== merged['lyrics.scriptMode']
        ) {
          vizDelta['lyrics.scriptMode'] = vizCfg.scriptMode;
        }
        if (Object.keys(vizDelta).length > 0) {
          merged = mergeSettings(merged, vizDelta);
        }
      }

      set({ settings: merged, isLoaded: true, isLoading: false });
      applyThemeSettings(merged);
      pushSettingsToVisualizer(merged);
      pushDiscordRpcConfig(merged);
      pushTrayBehavior(merged);
    } catch (err) {
      console.warn('[settingsStore] initSettings error, using defaults:', err);
      set({ settings: { ...defaultAppSettings }, isLoaded: true, isLoading: false });
      applyThemeSettings(defaultAppSettings);
      pushDiscordRpcConfig(defaultAppSettings);
      pushTrayBehavior(defaultAppSettings);
    }
  },

  updateSettings: async (delta: Partial<AppSettings>) => {
    const { settings, storageService } = get();
    const updated = mergeSettings(settings, delta);
    set({ settings: updated });

    // Apply theme, accent, acrylic, glass, and backdrop settings immediately
    applyThemeSettings(updated);
    if (cachedVizStore) {
      pushSettingsToVisualizer(updated, delta);
    } else {
      ensureVizStore().then(() => pushSettingsToVisualizer(updated, delta));
    }
    if (Object.keys(delta).some((key) => key.startsWith('scrobble.discord'))) {
      pushDiscordRpcConfig(updated);
    }
    if ('ui.minimizeToTray' in delta || 'ui.closeToTray' in delta) {
      pushTrayBehavior(updated);
    }

    if (storageService) {
      try {
        await storageService.updateSettings(delta);
      } catch (err) {
        console.warn('[settingsStore] updateSettings persistence failed:', err);
      }
    } else if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
      try {
        (globalThis as any).localStorage.setItem('waveform_settings', JSON.stringify(updated));
      } catch {}
    }
  },

  getSetting: <K extends keyof AppSettings>(key: K): AppSettings[K] => {
    return get().settings[key];
  },

  resetToDefaults: async () => {
    const { storageService } = get();
    const defaults = { ...defaultAppSettings };
    set({ settings: defaults });
    applyThemeSettings(defaults);
    pushDiscordRpcConfig(defaults);
    pushTrayBehavior(defaults);
    if (cachedVizStore) {
      pushSettingsToVisualizer(defaults, undefined, true);
    } else {
      ensureVizStore().then(() => pushSettingsToVisualizer(defaults, undefined, true));
    }
    if (storageService) {
      try {
        await storageService.updateSettings(defaults);
      } catch (err) {
        console.warn('[settingsStore] resetToDefaults persistence failed:', err);
      }
    } else if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
      try {
        (globalThis as any).localStorage.setItem('waveform_settings', JSON.stringify(defaults));
      } catch {}
    }
  },
}));

// Eagerly resolve visualizer store after module evaluation completes (avoids circular static import)
void ensureVizStore();

export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'up-to-date'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'error';

export interface AppUpdateProgress {
  bytesDownloaded: number;
  totalBytes: number;
  percent: number;
  bytesPerSecond: number;
}

export interface AppUpdateState {
  status: AppUpdateStatus;
  currentVersion: string;
  latestVersion: string | null;
  releaseName: string | null;
  releaseNotes: string | null;
  releaseUrl: string | null;
  publishedAt: string | null;
  assetName: string | null;
  assetSize: number | null;
  updateStrategy?: 'direct_patch' | 'full_installer';
  deltaChangedCount?: number | null;
  deltaRemovedCount?: number | null;
  updatedFromVersion?: string | null;
  dismissedThisSession: boolean;
  progress: AppUpdateProgress | null;
  error: string | null;
  lastCheckedAt: number | null;
}

export interface UpdateStore {
  state: AppUpdateState;
  isModalOpen: boolean;
  initUpdater: () => Promise<void>;
  checkForUpdates: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  dismissForSession: () => Promise<void>;
  dismissUpdatedToast: () => void;
  openModal: () => void;
  closeModal: () => void;
  openReleasePage: () => Promise<void>;
}

const DEFAULT_UPDATE_STATE: AppUpdateState = {
  status: 'idle',
  currentVersion: '1.3.4',
  latestVersion: null,
  releaseName: null,
  releaseNotes: null,
  releaseUrl: null,
  publishedAt: null,
  assetName: null,
  assetSize: null,
  updateStrategy: 'full_installer',
  deltaChangedCount: null,
  deltaRemovedCount: null,
  updatedFromVersion: null,
  dismissedThisSession: false,
  progress: null,
  error: null,
  lastCheckedAt: null,
};

function getElectronApi(): any {
  return hasPlatformBridge() ? getPlatformBridge() : undefined;
}

let updaterInitialized = false;
let updaterUnsubscribe: (() => void) | null = null;
let autoOpenedThisSession = false;

const updateStoreApi = createStore<UpdateStore>((set, get) => {
  const applyIncomingState = (next: AppUpdateState | null | undefined) => {
    if (!next || typeof next !== 'object') return;
    const shouldAutoOpen =
      next.status === 'available' &&
      !next.dismissedThisSession &&
      !autoOpenedThisSession;
    if (shouldAutoOpen) {
      autoOpenedThisSession = true;
    }
    set((prev) => ({
      state: { ...DEFAULT_UPDATE_STATE, ...next },
      isModalOpen: shouldAutoOpen ? true : prev.isModalOpen,
    }));
  };

  return {
    state: { ...DEFAULT_UPDATE_STATE },
    isModalOpen: false,

    initUpdater: async () => {
      if (updaterInitialized) return;
      const api = getElectronApi();
      if (!api) return;
      updaterInitialized = true;

      const subscribe = api.onUpdaterStateChanged ?? api.onUpdaterStateChange;
      if (typeof subscribe === 'function') {
        updaterUnsubscribe = subscribe((nextState: AppUpdateState) => {
          applyIncomingState(nextState);
        });
      }

      if (typeof api.updaterGetState === 'function') {
        try {
          const initial = await api.updaterGetState();
          applyIncomingState(initial);
        } catch {
          // Non-fatal in browser or partial preload environments
        }
      }
    },

    checkForUpdates: async () => {
      const api = getElectronApi();
      if (typeof api?.updaterCheck !== 'function') return;
      set((prev) => ({
        state: { ...prev.state, status: 'checking', error: null },
      }));
      try {
        const next = await api.updaterCheck();
        applyIncomingState(next);
      } catch (err: any) {
        set((prev) => ({
          state: {
            ...prev.state,
            status: 'error',
            error: err?.message || 'Failed to check for updates.',
          },
        }));
      }
    },

    downloadAndInstall: async () => {
      const api = getElectronApi();
      if (typeof api?.updaterDownloadAndInstall !== 'function') return;
      try {
        const next = await api.updaterDownloadAndInstall();
        applyIncomingState(next);
      } catch (err: any) {
        set((prev) => ({
          state: {
            ...prev.state,
            status: 'error',
            error: err?.message || 'Update installation failed.',
          },
        }));
      }
    },

    dismissForSession: async () => {
      const api = getElectronApi();
      set((prev) => ({
        isModalOpen: false,
        state: { ...prev.state, dismissedThisSession: true },
      }));
      if (typeof api?.updaterDismissForSession === 'function') {
        try {
          const next = await api.updaterDismissForSession();
          if (next && typeof next === 'object') {
            set({ state: { ...DEFAULT_UPDATE_STATE, ...next } });
          }
        } catch {
          // Keep in-memory dismissal even if IPC fails
        }
      }
    },

    dismissUpdatedToast: () =>
      set((prev) => ({
        state: { ...prev.state, updatedFromVersion: null },
      })),

    openModal: () => set({ isModalOpen: true }),

    closeModal: () => {
      const currentStatus = get().state.status;
      if (currentStatus === 'verifying' || currentStatus === 'installing') return;
      set({ isModalOpen: false });
    },

    openReleasePage: async () => {
      const api = getElectronApi();
      if (typeof api?.updaterOpenReleasePage === 'function') {
        await api.updaterOpenReleasePage().catch(() => {});
        return;
      }
      const url =
        get().state.releaseUrl ||
        'https://github.com/Trapston3/waveform-desktop/releases/latest';
      if (typeof window !== 'undefined' && typeof window.open === 'function') {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    },
  };
});

// Allow SSR unit tests (renderToStaticMarkup) to observe live in-memory store updates
if (typeof document === 'undefined' || typeof (document as any).createElement !== 'function') {
  updateStoreApi.getInitialState = updateStoreApi.getState;
}

type UseUpdateStoreHook = {
  (): UpdateStore;
  <T>(selector: (state: UpdateStore) => T): T;
} & typeof updateStoreApi;

export const useUpdateStore: UseUpdateStoreHook = Object.assign(
  ((selector?: (state: UpdateStore) => any) =>
    useStore(updateStoreApi, selector ?? ((s) => s))) as UseUpdateStoreHook,
  updateStoreApi
);

export function _resetUpdateStoreForTests(): void {
  updaterUnsubscribe?.();
  updaterUnsubscribe = null;
  updaterInitialized = false;
  autoOpenedThisSession = false;
  useUpdateStore.setState({
    state: { ...DEFAULT_UPDATE_STATE },
    isModalOpen: false,
  });
}
