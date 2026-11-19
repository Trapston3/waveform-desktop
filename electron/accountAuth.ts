// electron/accountAuth.ts
// Node ESM helpers for YouTube Music SAPISID auth and Spotify Access Token / Playlist resolution

import { createHash } from 'node:crypto';

export interface SpotifyTrackItem {
  id: string;
  title: string;
  artist: string;
  artists: { id: string | null; name: string }[];
  albumName: string;
  durationSec: number;
  thumbnailUrl: string | null;
}

export interface SpotifyPlaylistItem {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string | null;
  trackCount: number;
  owner: string;
}

interface SpotifyTokenCache {
  accessToken: string;
  expiresAtMs: number;
}

let spotifyTokenCache: SpotifyTokenCache | null = null;

export function clearSpotifyTokenCache(): void {
  spotifyTokenCache = null;
}

export function extractSapisid(cookieHeader: string): string | null {
  if (!cookieHeader || typeof cookieHeader !== 'string') return null;
  const match = cookieHeader.match(/(?:^|;\s*)(?:__Secure-3PAPISID|__Secure-1PAPISID|SAPISID)=([^;]+)/);
  return match ? match[1].trim() : null;
}

export function generateSapisidHash(
  sapisid: string,
  origin = 'https://music.youtube.com',
  timestampSec?: number
): string {
  const ts = timestampSec ?? Math.floor(Date.now() / 1000);
  const payload = `${ts} ${sapisid} ${origin}`;
  const sha1Hex = createHash('sha1').update(payload, 'utf8').digest('hex');
  return `SAPISIDHASH ${ts}_${sha1Hex}`;
}

export function applyYouTubeAuthHeaders(
  url: string,
  headers: Record<string, string>,
  ytCookie?: string | null
): Record<string, string> {
  const result: Record<string, string> = { ...headers };

  // Check if X-Waveform-Anonymous / x-waveform-anonymous header is present
  const anonKey = Object.keys(result).find(
    (k) => k.toLowerCase() === 'x-waveform-anonymous'
  );
  if (anonKey) {
    delete result[anonKey];
    return result;
  }

  if (!ytCookie || typeof ytCookie !== 'string') {
    return result;
  }

  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {
    return result;
  }

  if (hostname.toLowerCase() !== 'music.youtube.com') {
    return result;
  }

  // Remove case-insensitive duplicates
  const keysToRemove = ['cookie', 'authorization', 'x-origin', 'origin', 'referer', 'x-goog-authuser'];
  for (const k of Object.keys(result)) {
    if (keysToRemove.includes(k.toLowerCase())) {
      delete result[k];
    }
  }

  result['Cookie'] = ytCookie;
  result['X-Origin'] = 'https://music.youtube.com';
  result['Origin'] = 'https://music.youtube.com';
  result['Referer'] = 'https://music.youtube.com/';
  result['X-Goog-AuthUser'] = '0';

  const sapisid = extractSapisid(ytCookie);
  if (sapisid) {
    result['Authorization'] = generateSapisidHash(sapisid, 'https://music.youtube.com');
  }

  return result;
}

async function getSpotifyAccessToken(
  spDcCookie: string,
  fetchImpl: typeof fetch = fetch,
  forceRefresh = false
): Promise<string | null> {
  const now = Date.now();
  if (
    !forceRefresh &&
    spotifyTokenCache &&
    spotifyTokenCache.expiresAtMs - now > 60000 // 60s safety buffer
  ) {
    return spotifyTokenCache.accessToken;
  }

  try {
    const cookieHeader = spDcCookie.startsWith('sp_dc=') ? spDcCookie : `sp_dc=${spDcCookie}`;
    const res = await fetchImpl(
      'https://open.spotify.com/get_access_token?reason=transport&productType=web_player',
      {
        headers: {
          Cookie: cookieHeader,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      }
    );

    if (!res.ok) {
      spotifyTokenCache = null;
      return null;
    }

    const data = (await res.json()) as any;
    const accessToken = data.accessToken || data.token;
    const expiresAt =
      typeof data.accessTokenExpirationTimestampMs === 'number'
        ? data.accessTokenExpirationTimestampMs
        : typeof data.expiresAtMs === 'number'
          ? data.expiresAtMs
          : now + 3600 * 1000;

    if (!accessToken) {
      spotifyTokenCache = null;
      return null;
    }

    spotifyTokenCache = {
      accessToken,
      expiresAtMs: expiresAt,
    };
    return accessToken;
  } catch {
    spotifyTokenCache = null;
    return null;
  }
}

export async function fetchSpotifyUserPlaylists(
  spDcCookie: string,
  fetchImpl: typeof fetch = fetch
): Promise<SpotifyPlaylistItem[]> {
  try {
    let token = await getSpotifyAccessToken(spDcCookie, fetchImpl);
    if (!token) return [];

    let res = await fetchImpl('https://api.spotify.com/v1/me/playlists?limit=50', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.status === 401) {
      // Invalidate cache and retry once
      token = await getSpotifyAccessToken(spDcCookie, fetchImpl, true);
      if (!token) return [];
      res = await fetchImpl('https://api.spotify.com/v1/me/playlists?limit=50', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    }

    if (!res.ok) return [];

    const data = (await res.json()) as any;
    const items = Array.isArray(data.items) ? data.items : [];

    return items
      .filter((it: any) => it && it.id)
      .map((it: any): SpotifyPlaylistItem => ({
        id: String(it.id),
        title: it.name || 'Untitled Playlist',
        description: it.description || '',
        thumbnailUrl: it.images?.[0]?.url || null,
        trackCount: typeof it.tracks?.total === 'number' ? it.tracks.total : 0,
        owner: it.owner?.display_name || it.owner?.id || 'Spotify',
      }));
  } catch {
    return [];
  }
}

export async function fetchSpotifyPlaylistTracks(
  spDcCookie: string,
  playlistId: string,
  fetchImpl: typeof fetch = fetch
): Promise<SpotifyTrackItem[]> {
  try {
    let token = await getSpotifyAccessToken(spDcCookie, fetchImpl);
    if (!token) return [];

    const url = `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/tracks?limit=100`;
    let res = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.status === 401) {
      token = await getSpotifyAccessToken(spDcCookie, fetchImpl, true);
      if (!token) return [];
      res = await fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    }

    if (!res.ok) return [];

    const data = (await res.json()) as any;
    const items = Array.isArray(data.items) ? data.items : [];

    const tracks: SpotifyTrackItem[] = [];
    for (const item of items) {
      const track = item?.track;
      if (!track || !track.id) continue;

      const artists = Array.isArray(track.artists)
        ? track.artists.map((a: any) => ({
            id: a?.id ? String(a.id) : null,
            name: a?.name || 'Unknown Artist',
          }))
        : [];

      const artistName = artists.map((a: any) => a.name).join(', ') || 'Unknown Artist';
      const durationSec = Math.round((track.duration_ms || 0) / 1000);
      const thumbnailUrl =
        track.album?.images?.[0]?.url ||
        track.album?.images?.[1]?.url ||
        null;

      tracks.push({
        id: String(track.id),
        title: track.name || 'Untitled Track',
        artist: artistName,
        artists,
        albumName: track.album?.name || '',
        durationSec,
        thumbnailUrl,
      });
    }

    return tracks;
  } catch {
    return [];
  }
}
