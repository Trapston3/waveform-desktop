// Renderer-side API for YouTube Music / Spotify account login (Electron IPC; no-op on web).
export type AccountProvider = 'ytmusic' | 'spotify';
export interface AccountStatus { connected: boolean; displayName?: string }
export type AccountAuthStatus = Record<AccountProvider, AccountStatus>;

const api = () => (typeof window !== 'undefined' ? (window as any).electronAPI : undefined);
const none: AccountAuthStatus = { ytmusic: { connected: false }, spotify: { connected: false } };

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
    emitAuthChanged(provider, false);
  },
  emitAuthChanged,
  onAuthChanged,
  getSpotifyPlaylists: async (): Promise<any[]> => (await (api() as any)?.getSpotifyPlaylists?.()) ?? [],
  getSpotifyPlaylistTracks: async (playlistId: string): Promise<any[]> =>
    (await (api() as any)?.getSpotifyPlaylistTracks?.(playlistId)) ?? [],
};

export const {
  loginYouTubeMusic,
  loginSpotify,
  getAccountAuthStatus,
  logoutAccount,
  getSpotifyPlaylists,
  getSpotifyPlaylistTracks,
} = AccountAuthService;
