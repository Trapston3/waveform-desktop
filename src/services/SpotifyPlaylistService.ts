// src/services/SpotifyPlaylistService.ts
// Renderer-side service for caching and transforming Spotify playlists and tracks into playable WaveForm Songs

import { AccountAuthService } from './AccountAuthService';
import type { Song } from '../models/Song';

export interface SpotifyPlaylistItem {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string | null;
  trackCount: number;
  owner: string;
}

let cachedPlaylists: SpotifyPlaylistItem[] | null = null;

// Subscribe to auth changes: clear cache when Spotify logs out or switches
AccountAuthService.onAuthChanged(({ provider, connected }) => {
  if (provider === 'spotify') {
    cachedPlaylists = null;
  }
});

export const SpotifyPlaylistService = {
  clearCache(): void {
    cachedPlaylists = null;
  },

  async loadSpotifyPlaylists(forceRefresh = false): Promise<SpotifyPlaylistItem[]> {
    if (!forceRefresh && cachedPlaylists) {
      return cachedPlaylists;
    }

    try {
      const items = await AccountAuthService.getSpotifyPlaylists();
      cachedPlaylists = Array.isArray(items) ? items : [];
      return cachedPlaylists;
    } catch (err) {
      console.warn('[SpotifyPlaylistService] Failed to load playlists:', err);
      return [];
    }
  },

  async loadSpotifyPlaylistSongs(playlistId: string): Promise<Song[]> {
    try {
      const tracks = await AccountAuthService.getSpotifyPlaylistTracks(playlistId);
      if (!Array.isArray(tracks)) return [];

      return tracks.map((track: any): Song => {
        const id = String(track.id || '');
        const durationSec = typeof track.durationSec === 'number' ? track.durationSec : 0;
        const artists = Array.isArray(track.artists)
          ? track.artists.map((a: any) => ({
              id: a.id ? String(a.id) : null,
              name: a.name || 'Unknown Artist',
            }))
          : [{ id: null, name: track.artist || 'Unknown Artist' }];
        const artistIds = artists.map((a: any) => a.id).filter(Boolean) as string[];

        return {
          id: `sp_${id}`,
          videoId: `sp_${id}`,
          title: track.title || 'Untitled Track',
          artist: track.artist || (artists[0]?.name ?? 'Unknown Artist'),
          artists,
          artistIds,
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
    } catch (err) {
      console.warn('[SpotifyPlaylistService] Failed to load playlist tracks:', err);
      return [];
    }
  },
};

export const { loadSpotifyPlaylists, loadSpotifyPlaylistSongs } = SpotifyPlaylistService;
