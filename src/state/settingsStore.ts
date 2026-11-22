// src/state/settingsStore.ts
// Reactive bidirectional synchronization of over 70 user settings with StorageService

import { create } from 'zustand';
import type { AppSettings } from '../models/Settings';
import { defaultAppSettings, mergeSettings } from '../models/Settings';
import { StorageService } from '../services/StorageService';
import { applyThemeSettings } from '../ui/theme/Theme';
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

    if (!layoutChanged && !hideCoverChanged && !alignChanged) return;

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

async function ensureVizStore(): Promise<typeof UseLyricVisualizerStoreType | null> {
  if (cachedVizStore) return cachedVizStore;
  try {
    const mod = await import('../lyricVisualizer/state/lyricVisualizerStore');
    if (mod?.useLyricVisualizerStore) {
      attachVisualizerSubscription(mod.useLyricVisualizerStore);
      return mod.useLyricVisualizerStore;
    }
  } catch {
    // Ignore in isolated mock environments
  }
  return null;
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

    if (shouldSyncLayout && viz.config.nowPlayingLayout !== updated.nowPlayingLayout) {
      viz.setNowPlayingLayout?.(updated.nowPlayingLayout);
    }
    if (shouldSyncHideCover && viz.config.hideAlbumCover !== updated.hideAlbumCover) {
      viz.setHideAlbumCover?.(updated.hideAlbumCover);
    }
    if (shouldSyncAlign && viz.config.textAlign !== updated.lyricsAlignment) {
      viz.setTextAlign?.(updated.lyricsAlignment);
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
        if (Object.keys(vizDelta).length > 0) {
          merged = mergeSettings(merged, vizDelta);
        }
      }

      set({ settings: merged, isLoaded: true, isLoading: false });
      applyThemeSettings(merged);
      pushSettingsToVisualizer(merged);
    } catch (err) {
      console.warn('[settingsStore] initSettings error, using defaults:', err);
      set({ settings: { ...defaultAppSettings }, isLoaded: true, isLoading: false });
      applyThemeSettings(defaultAppSettings);
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
