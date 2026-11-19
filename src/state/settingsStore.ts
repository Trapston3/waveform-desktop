// src/state/settingsStore.ts
// Reactive bidirectional synchronization of over 70 user settings with StorageService

import { create } from 'zustand';
import type { AppSettings } from '../models/Settings';
import { defaultAppSettings, mergeSettings } from '../models/Settings';
import { StorageService } from '../services/StorageService';
import { applyThemeSettings } from '../ui/theme/Theme';

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
      const loaded = await storageInstance.getSettings();
      const merged = mergeSettings(defaultAppSettings, loaded);
      set({ settings: merged, isLoaded: true, isLoading: false });
      applyThemeSettings(merged);
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
