// src/state/navigationStore.ts
// Desktop hierarchical navigation stack & modal management

import { create } from 'zustand';
import type { DetailPage, ArtistPage } from '../models/Navigation';

export type PrimaryTab = 'home' | 'explore' | 'library' | 'search' | 'equalizer';

export interface ReleaseViewTarget {
  type: 'release';
  id: string; // Browse ID e.g. "MPREb_redline_01" or playlist ID
  releaseType: 'album' | 'playlist';
  initialData?: DetailPage;
}

export interface ArtistViewTarget {
  type: 'artist';
  id: string; // Artist channel ID
  initialData?: ArtistPage;
}

export interface TabViewTarget {
  type: 'tab';
  tab: PrimaryTab;
  subView?: string; // e.g. "Songs", "Albums", "Playlists" for library
}

export type NavigationTarget = TabViewTarget | ReleaseViewTarget | ArtistViewTarget;

export interface NavigationState {
  current: NavigationTarget;
  history: NavigationTarget[];
  forwardStack: NavigationTarget[];
  isSettingsOpen: boolean;
  isCreatePlaylistOpen: boolean;
  isReplayOpen: boolean;
  isEqualizerOpen: boolean;
  isLyricsDrawerOpen: boolean;
  isQueueDrawerOpen: boolean;
  searchInitialQuery: string;
  searchQuery: string;
  searchFocusCounter: number;
}

export interface NavigationActions {
  navigate: (target: NavigationTarget) => void;
  navigateToTab: (tab: PrimaryTab, subView?: string) => void;
  navigateToRelease: (id: string, releaseType?: 'album' | 'playlist', initialData?: DetailPage) => void;
  navigateToArtist: (id: string, initialData?: ArtistPage) => void;
  goBack: () => boolean;
  goForward: () => boolean;
  canGoBack: () => boolean;
  canGoForward: () => boolean;

  setSettingsOpen: (open: boolean) => void;
  setCreatePlaylistOpen: (open: boolean) => void;
  setReplayOpen: (open: boolean) => void;
  setEqualizerOpen: (open: boolean) => void;
  toggleEqualizer: () => void;
  setLyricsDrawerOpen: (open: boolean) => void;
  setQueueDrawerOpen: (open: boolean) => void;
  toggleLyricsDrawer: () => void;
  toggleQueueDrawer: () => void;
  setSearchInitialQuery: (query: string) => void;
  setSearchQuery: (query: string) => void;
  requestSearchFocus: () => void;
}

export type NavigationStore = NavigationState & NavigationActions;

export const useNavigationStore = create<NavigationStore>((set, get) => ({
  current: { type: 'tab', tab: 'home' },
  history: [],
  forwardStack: [],
  isSettingsOpen: false,
  isCreatePlaylistOpen: false,
  isReplayOpen: false,
  isEqualizerOpen: false,
  isLyricsDrawerOpen: false,
  isQueueDrawerOpen: false,
  searchInitialQuery: '',
  searchQuery: '',
  searchFocusCounter: 0,

  navigate: (target: NavigationTarget) => {
    const { current, history } = get();
    // Avoid pushing duplicate target to history if same
    if (JSON.stringify(current) === JSON.stringify(target)) return;

    set({
      history: [...history, current],
      forwardStack: [],
      current: target,
    });
  },

  navigateToTab: (tab: PrimaryTab, subView?: string) => {
    get().navigate({ type: 'tab', tab, subView });
  },

  navigateToRelease: (id: string, releaseType: 'album' | 'playlist' = 'album', initialData?: DetailPage) => {
    get().navigate({ type: 'release', id, releaseType, initialData });
  },

  navigateToArtist: (id: string, initialData?: ArtistPage) => {
    get().navigate({ type: 'artist', id, initialData });
  },

  goBack: (): boolean => {
    const { history, current, forwardStack } = get();
    if (history.length === 0) return false;

    const previous = history[history.length - 1];
    const newHistory = history.slice(0, history.length - 1);

    set({
      history: newHistory,
      forwardStack: [current, ...forwardStack],
      current: previous,
    });
    return true;
  },

  goForward: (): boolean => {
    const { forwardStack, current, history } = get();
    if (forwardStack.length === 0) return false;

    const [next, ...remainingForward] = forwardStack;

    set({
      history: [...history, current],
      forwardStack: remainingForward,
      current: next,
    });
    return true;
  },

  canGoBack: (): boolean => get().history.length > 0,
  canGoForward: (): boolean => get().forwardStack.length > 0,

  setSettingsOpen: (open: boolean) => set({ isSettingsOpen: open }),
  setCreatePlaylistOpen: (open: boolean) => set({ isCreatePlaylistOpen: open }),
  setReplayOpen: (open: boolean) => set({ isReplayOpen: open }),
  setEqualizerOpen: (open: boolean) => set({ isEqualizerOpen: open }),
  toggleEqualizer: () => set((state) => ({ isEqualizerOpen: !state.isEqualizerOpen })),

  setLyricsDrawerOpen: (open: boolean) => {
    set({
      isLyricsDrawerOpen: open,
      isQueueDrawerOpen: open ? false : get().isQueueDrawerOpen,
    });
  },

  setQueueDrawerOpen: (open: boolean) => {
    set({
      isQueueDrawerOpen: open,
      isLyricsDrawerOpen: open ? false : get().isLyricsDrawerOpen,
    });
  },

  toggleLyricsDrawer: () => {
    const { isLyricsDrawerOpen } = get();
    set({
      isLyricsDrawerOpen: !isLyricsDrawerOpen,
      isQueueDrawerOpen: false,
    });
  },

  toggleQueueDrawer: () => {
    const { isQueueDrawerOpen } = get();
    set({
      isQueueDrawerOpen: !isQueueDrawerOpen,
      isLyricsDrawerOpen: false,
    });
  },

  setSearchInitialQuery: (query: string) => set({ searchInitialQuery: query, searchQuery: query }),
  setSearchQuery: (query: string) => set({ searchQuery: query }),
  requestSearchFocus: () => set((state) => ({ searchFocusCounter: state.searchFocusCounter + 1 })),
}));
