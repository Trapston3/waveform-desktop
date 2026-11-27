// Renderer-side API for YouTube Music / Spotify account login & playlist loading (PlatformBridge IPC; no-op on web).
import type { Song } from '../models/Song';
import { getPlatformBridge, hasPlatformBridge } from '../platform/index';

export type AccountProvider = 'ytmusic' | 'spotify';
export interface AccountStatus { connected: boolean; displayName?: string }
export type AccountAuthStatus = Record<AccountProvider, AccountStatus>;

export interface SpotifyPlaylistItem {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string | null;
  trackCount: number;
  owner: string;
}

const api = () => (hasPlatformBridge() ? getPlatformBridge() : undefined);
const none: AccountAuthStatus = { ytmusic: { connected: false }, spotify: { connected: false } };
let cachedSpotifyPlaylists: SpotifyPlaylistItem[] | null = null;

type AuthChangeListener = (detail: { provider: AccountProvider; connected: boolean }) => void;
const authChangeListeners = new Set<AuthChangeListener>();

export function emitAuthChanged(provider: AccountProvider, connected: boolean): void {
  const detail = { provider, connected };
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent('waveform:auth-changed', { detail }));
    } catch {
      // Ignore in non-standard environments
    }
  }
  for (const listener of authChangeListeners) {
    try {
      listener(detail);
    } catch (err) {
      console.warn('[AccountAuthService] listener threw:', err);
    }
  }
}

export function onAuthChanged(
  listener: (detail: { provider: AccountProvider; connected: boolean }) => void
): () => void {
  authChangeListeners.add(listener);

  let domListener: ((e: Event) => void) | null = null;
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    domListener = (e: Event) => {
      const customEvent = e as CustomEvent<{ provider: AccountProvider; connected: boolean }>;
      if (customEvent && customEvent.detail) {
        listener(customEvent.detail);
      }
    };
    window.addEventListener('waveform:auth-changed', domListener);
  }

  return () => {
    authChangeListeners.delete(listener);
    if (domListener && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('waveform:auth-changed', domListener);
    }
  };
}

export const AccountAuthService = {
  loginYouTubeMusic: async (): Promise<AccountStatus> => {
    const res = (await api()?.loginYouTubeMusic?.()) ?? { connected: false };
    if (res.connected) {
      emitAuthChanged('ytmusic', true);
    }
    return res;
  },
  loginSpotify: async (): Promise<AccountStatus> => {
    const res = (await api()?.loginSpotify?.()) ?? { connected: false };
    if (res.connected) {
      emitAuthChanged('spotify', true);
    }
    return res;
  },
  getAccountAuthStatus: async (): Promise<AccountAuthStatus> => (await api()?.getAccountAuthStatus?.()) ?? none,
  logoutAccount: async (provider: AccountProvider): Promise<void> => {
    await api()?.logoutAccount?.(provider);
    if (provider === 'spotify') cachedSpotifyPlaylists = null;
    emitAuthChanged(provider, false);
  },
  emitAuthChanged,
  onAuthChanged,
  getSpotifyPlaylists: async (): Promise<any[]> => (await (api() as any)?.getSpotifyPlaylists?.()) ?? [],
  getSpotifyPlaylistTracks: async (playlistId: string): Promise<any[]> =>
    (await (api() as any)?.getSpotifyPlaylistTracks?.(playlistId)) ?? [],
  loadSpotifyPlaylists: async (forceRefresh = false): Promise<SpotifyPlaylistItem[]> => {
    if (!forceRefresh && cachedSpotifyPlaylists) return cachedSpotifyPlaylists;
    try {
      const items = (await (api() as any)?.getSpotifyPlaylists?.()) ?? [];
      cachedSpotifyPlaylists = Array.isArray(items) ? items : [];
      return cachedSpotifyPlaylists;
    } catch {
      return [];
    }
  },
  loadSpotifyPlaylistSongs: async (playlistId: string): Promise<Song[]> => {
    try {
      const tracks = (await (api() as any)?.getSpotifyPlaylistTracks?.(playlistId)) ?? [];
      if (!Array.isArray(tracks)) return [];
      return tracks.map((track: any): Song => {
        const id = String(track.id || '');
        const durationSec = typeof track.durationSec === 'number' ? track.durationSec : 0;
        const artists = Array.isArray(track.artists)
          ? track.artists.map((a: any) => ({ id: a.id ? String(a.id) : null, name: a.name || 'Unknown Artist' }))
          : [{ id: null, name: track.artist || 'Unknown Artist' }];
        return {
          id: `sp_${id}`,
          videoId: `sp_${id}`,
          title: track.title || 'Untitled Track',
          artist: track.artist || (artists[0]?.name ?? 'Unknown Artist'),
          artists,
          artistIds: artists.map((a: any) => a.id).filter(Boolean) as string[],
          albumName: track.albumName || '',
          album: track.albumName || '',
          durationSec,
          totalPlayTimeMs: durationSec * 1000,
          playCount: 0,
          thumbnailUrl: track.thumbnailUrl || null,
          artworkUrl: track.thumbnailUrl || undefined,
          streamUrl: '',
          playbackSourceType: 'YOUTUBE',
          liked: false,
          isExplicit: false,
        };
      });
    } catch {
      return [];
    }
  },
};

export const {
  loginYouTubeMusic,
  loginSpotify,
  getAccountAuthStatus,
  logoutAccount,
  getSpotifyPlaylists,
  getSpotifyPlaylistTracks,
  loadSpotifyPlaylists,
  loadSpotifyPlaylistSongs,
} = AccountAuthService;
