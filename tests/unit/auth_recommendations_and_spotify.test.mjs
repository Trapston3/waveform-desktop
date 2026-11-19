// tests/unit/auth_recommendations_and_spotify.test.mjs
// Unit tests for YouTube Music SAPISID auth, Spotify access token / playlist services, and UI integration

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';

// Register ESM resolution hook so Node 25 can resolve extensionless relative .ts imports
const resolverHook = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && !specifier.endsWith('.ts') && !specifier.endsWith('.js') && !specifier.endsWith('.mjs')) {
      try {
        return await nextResolve(specifier + '.ts', context);
      } catch {}
    }
    throw err;
  }
}
`;
register(`data:text/javascript,${encodeURIComponent(resolverHook)}`, import.meta.url);

const {
  extractSapisid,
  generateSapisidHash,
  applyYouTubeAuthHeaders,
  fetchSpotifyUserPlaylists,
  fetchSpotifyPlaylistTracks,
  clearSpotifyTokenCache,
} = await import('../../electron/accountAuth.ts');
const { AccountAuthService } = await import('../../src/services/AccountAuthService.ts');
const { SpotifyPlaylistService } = await import('../../src/services/SpotifyPlaylistService.ts');

// ---------------------------------------------------------------------------
// 1. YouTube Music SAPISID Extraction & Hash Tests
// ---------------------------------------------------------------------------

test('extractSapisid extracts SAPISID from cookie headers', () => {
  assert.equal(extractSapisid(''), null);
  assert.equal(extractSapisid(null), null);
  assert.equal(extractSapisid('VISITOR_INFO1_LIVE=abc; other=123'), null);

  assert.equal(
    extractSapisid('VISITOR_INFO1_LIVE=abc; SAPISID=test_sapisid_123; SID=xyz'),
    'test_sapisid_123'
  );
  assert.equal(
    extractSapisid('__Secure-3PAPISID=sec3_sapisid_456; other=1'),
    'sec3_sapisid_456'
  );
  assert.equal(
    extractSapisid('__Secure-1PAPISID=sec1_sapisid_789'),
    'sec1_sapisid_789'
  );
});

test('generateSapisidHash formats SAPISIDHASH timestamp_sha1hex', () => {
  const ts = 1700000000;
  const hash = generateSapisidHash('sample_sapisid', 'https://music.youtube.com', ts);
  assert.match(hash, /^SAPISIDHASH 1700000000_[a-f0-9]{40}$/);

  // Default origin and current timestamp
  const dynamicHash = generateSapisidHash('sample_sapisid');
  assert.match(dynamicHash, /^SAPISIDHASH \d+_[a-f0-9]{40}$/);
});

test('applyYouTubeAuthHeaders injects auth on YouTube endpoints and respects anonymous flags', () => {
  const ytCookie = 'VISITOR_INFO1_LIVE=xyz; SAPISID=my_sapisid_value; HSID=123';
  const ytUrl = 'https://music.youtube.com/youtubei/v1/browse?key=dummy';

  // 1. Valid YouTube URL with cookie
  const headers = applyYouTubeAuthHeaders(ytUrl, { 'Content-Type': 'application/json' }, ytCookie);
  assert.equal(headers['Cookie'], ytCookie);
  assert.equal(headers['X-Origin'], 'https://music.youtube.com');
  assert.equal(headers['Origin'], 'https://music.youtube.com');
  assert.equal(headers['Referer'], 'https://music.youtube.com/');
  assert.equal(headers['X-Goog-AuthUser'], '0');
  assert.match(headers['Authorization'], /^SAPISIDHASH \d+_[a-f0-9]{40}$/);
  assert.equal(headers['Content-Type'], 'application/json');

  // 2. Non-YouTube endpoint should be skipped cleanly
  const lrclibHeaders = applyYouTubeAuthHeaders('https://api.lrclib.net/api/get', { 'Accept': 'application/json' }, ytCookie);
  assert.equal(lrclibHeaders['Authorization'], undefined);
  assert.equal(lrclibHeaders['Cookie'], undefined);
  assert.equal(lrclibHeaders['Accept'], 'application/json');

  // 3. X-Waveform-Anonymous should strip the flag and skip auth injection
  const anonHeaders = applyYouTubeAuthHeaders(
    ytUrl,
    { 'X-Waveform-Anonymous': 'true', 'Content-Type': 'application/json' },
    ytCookie
  );
  assert.equal(anonHeaders['X-Waveform-Anonymous'], undefined);
  assert.equal(anonHeaders['x-waveform-anonymous'], undefined);
  assert.equal(anonHeaders['Authorization'], undefined);
  assert.equal(anonHeaders['Cookie'], undefined);
  assert.equal(anonHeaders['Content-Type'], 'application/json');
});

// ---------------------------------------------------------------------------
// 2. Spotify Token Exchange & Playlist API Tests (Mock Fetch)
// ---------------------------------------------------------------------------

test('fetchSpotifyUserPlaylists exchanges sp_dc and fetches user playlists', async () => {
  clearSpotifyTokenCache();
  const mockCalls = [];

  const mockFetch = async (url, options) => {
    mockCalls.push({ url, options });
    if (url.includes('get_access_token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          accessToken: 'mock_access_token_123',
          accessTokenExpirationTimestampMs: Date.now() + 3600000,
        }),
      };
    }
    if (url.includes('api.spotify.com/v1/me/playlists')) {
      assert.equal(options?.headers?.Authorization, 'Bearer mock_access_token_123');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              id: 'pl_001',
              name: 'Synthwave Night Drive',
              description: '80s retrowave and neon vibes',
              images: [{ url: 'https://images.spotify.com/pl_001.jpg' }],
              tracks: { total: 42 },
              owner: { display_name: 'RetroFan' },
            },
          ],
        }),
      };
    }
    return { ok: false, status: 404 };
  };

  const playlists = await fetchSpotifyUserPlaylists('mock_sp_dc_cookie', mockFetch);
  assert.equal(playlists.length, 1);
  assert.equal(playlists[0].id, 'pl_001');
  assert.equal(playlists[0].title, 'Synthwave Night Drive');
  assert.equal(playlists[0].trackCount, 42);
  assert.equal(playlists[0].owner, 'RetroFan');
  assert.equal(playlists[0].thumbnailUrl, 'https://images.spotify.com/pl_001.jpg');
});

test('fetchSpotifyPlaylistTracks maps Spotify tracks to canonical track items', async () => {
  clearSpotifyTokenCache();

  const mockFetch = async (url, options) => {
    if (url.includes('get_access_token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          accessToken: 'mock_token_abc',
          expiresAtMs: Date.now() + 3600000,
        }),
      };
    }
    if (url.includes('playlists/pl_001/tracks')) {
      assert.equal(options?.headers?.Authorization, 'Bearer mock_token_abc');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              track: {
                id: 'track_999',
                name: 'Redline',
                duration_ms: 271000,
                artists: [{ id: 'art_1', name: 'Lazerhawk' }],
                album: {
                  name: 'Redline',
                  images: [{ url: 'https://images.spotify.com/redline.jpg' }],
                },
              },
            },
          ],
        }),
      };
    }
    return { ok: false, status: 404 };
  };

  const tracks = await fetchSpotifyPlaylistTracks('mock_sp_dc', 'pl_001', mockFetch);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].id, 'track_999');
  assert.equal(tracks[0].title, 'Redline');
  assert.equal(tracks[0].artist, 'Lazerhawk');
  assert.equal(tracks[0].durationSec, 271);
  assert.equal(tracks[0].albumName, 'Redline');
  assert.equal(tracks[0].thumbnailUrl, 'https://images.spotify.com/redline.jpg');
});

test('fetchSpotifyUserPlaylists handles network error cleanly without rejecting', async () => {
  clearSpotifyTokenCache();
  const failingFetch = async () => {
    throw new Error('Connection refused');
  };

  const res = await fetchSpotifyUserPlaylists('cookie', failingFetch);
  assert.deepEqual(res, []);
});

// ---------------------------------------------------------------------------
// 3. Renderer AccountAuthService & SpotifyPlaylistService Integration
// ---------------------------------------------------------------------------

test('AccountAuthService onAuthChanged fires upon login and logout', async () => {
  const events = [];
  const unsubscribe = AccountAuthService.onAuthChanged((detail) => {
    events.push(detail);
  });

  AccountAuthService.emitAuthChanged('ytmusic', true);
  AccountAuthService.emitAuthChanged('spotify', false);

  assert.equal(events.length, 2);
  assert.deepEqual(events[0], { provider: 'ytmusic', connected: true });
  assert.deepEqual(events[1], { provider: 'spotify', connected: false });

  unsubscribe();
  AccountAuthService.emitAuthChanged('ytmusic', false);
  assert.equal(events.length, 2); // Unsubscribed
});

test('SpotifyPlaylistService maps tracks to playable Song objects with empty streamUrl and videoId prefix', async () => {
  // Mock window.electronAPI
  globalThis.window = {
    electronAPI: {
      getSpotifyPlaylistTracks: async (plId) => [
        {
          id: 'sp_trk_1',
          title: 'Starboy',
          artist: 'The Weeknd, Daft Punk',
          artists: [
            { id: 'weeknd', name: 'The Weeknd' },
            { id: 'daftpunk', name: 'Daft Punk' },
          ],
          albumName: 'Starboy',
          durationSec: 230,
          thumbnailUrl: 'https://images.spotify.com/starboy.jpg',
        },
      ],
    },
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const songs = await SpotifyPlaylistService.loadSpotifyPlaylistSongs('any_pl');
  assert.equal(songs.length, 1);
  const song = songs[0];

  assert.equal(song.videoId, 'sp_sp_trk_1');
  assert.equal(song.title, 'Starboy');
  assert.equal(song.artist, 'The Weeknd, Daft Punk');
  assert.equal(song.albumName, 'Starboy');
  assert.equal(song.durationSec, 230);
  assert.equal(song.totalPlayTimeMs, 230000);
  assert.equal(song.streamUrl, '');
  assert.equal(song.playbackSourceType, 'YOUTUBE');
  assert.equal(song.liked, false);
  assert.equal(song.playCount, 0);
  assert.equal(song.artists.length, 2);
  assert.deepEqual(song.artistIds, ['weeknd', 'daftpunk']);
});

// ---------------------------------------------------------------------------
// 4. Source Inspection for Constraints & Collision Rules
// ---------------------------------------------------------------------------

test('HomeScreen does NOT render Spotify playlists shelf and has personalized pill', () => {
  const homeSrc = fs.readFileSync('src/ui/views/HomeScreen.tsx', 'utf8');
  assert.doesNotMatch(homeSrc, /SpotifyPlaylistService/i);
  assert.doesNotMatch(homeSrc, /Spotify Playlists/i);
  assert.match(homeSrc, /Personalized for/);
  assert.match(homeSrc, /AccountAuthService\.onAuthChanged/);
});

test('LibraryScreen renders Spotify Playlists shelf only when connected', () => {
  const libSrc = fs.readFileSync('src/ui/views/LibraryScreen.tsx', 'utf8');
  assert.match(libSrc, /Spotify Playlists/);
  assert.match(libSrc, /spotifyConnected/);
  assert.match(libSrc, /loadSpotifyPlaylistSongs/);
  assert.match(libSrc, /DesktopTrackTable/);
});

test('SettingsModal keeps account status in sync with AccountAuthService', () => {
  const setSrc = fs.readFileSync('src/ui/common/SettingsModal.tsx', 'utf8');
  assert.match(setSrc, /AccountAuthService\.getAccountAuthStatus/);
  assert.match(setSrc, /handleAccountLogin/);
  assert.match(setSrc, /handleAccountLogout/);
});
