// tests/unit/playlist_importer.test.mjs
// Unit tests for zero-API-key Spotify, Apple Music & YouTube playlist URL parsing and track extraction.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const resolverHook = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && !specifier.endsWith('.ts') && !specifier.endsWith('.tsx') && !specifier.endsWith('.js') && !specifier.endsWith('.mjs')) {
      for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
        try {
          return await nextResolve(specifier + suffix, context);
        } catch {}
      }
    }
    throw err;
  }
}
`;
register(`data:text/javascript,${encodeURIComponent(resolverHook)}`, import.meta.url);

const {
  detectPlaylistUrl,
  parseSpotifyEmbedHtml,
  parseAppleMusicCatalogResponse,
  parseAppleMusicHtmlFallback,
} = await import(pathToFileURL(path.join(rootDir, 'electron/playlistImporter.ts')).href);

describe('Zero-API-Key Playlist Importer (Spotify, Apple Music & YouTube)', () => {
  test('detectPlaylistUrl identifies Spotify, Apple Music, and YouTube playlist/album URLs', () => {
    const spUrl = detectPlaylistUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc');
    assert.deepEqual(spUrl, {
      source: 'spotify',
      id: '37i9dQZF1DXcBWIGoYBM5M',
      kind: 'playlist',
      url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc',
    });

    const amPl = detectPlaylistUrl(
      'https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41148aaacabb233eb5eb'
    );
    assert.equal(amPl?.source, 'apple');
    assert.equal(amPl?.id, 'pl.f4d106fed2bd41148aaacabb233eb5eb');
    assert.equal(amPl?.storefront, 'us');

    const ytPl = detectPlaylistUrl('https://music.youtube.com/playlist?list=PL123456');
    assert.equal(ytPl?.source, 'youtube');
    assert.equal(ytPl?.id, 'PL123456');

    assert.equal(detectPlaylistUrl('https://example.com/not-a-playlist'), null);
  });

  test('parseSpotifyEmbedHtml extracts playlist metadata and tracks from __NEXT_DATA__', () => {
    const nextData = {
      props: {
        pageProps: {
          state: {
            data: {
              entity: {
                name: 'Late Night Synthwave',
                subtitle: 'Curated electronic driving picks',
                coverArt: { sources: [{ url: 'https://i.scdn.co/image/cover123' }] },
                trackList: [
                  {
                    uri: 'spotify:track:t1',
                    title: 'Midnight City',
                    subtitle: 'M83',
                    duration: 244000,
                  },
                  {
                    uri: 'spotify:track:t2',
                    title: 'Nightcall',
                    subtitle: 'Kavinsky',
                    duration: 258000,
                  },
                ],
              },
            },
          },
        },
      },
    };
    const html = `<html><head></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
      nextData
    )}</script></body></html>`;
    const parsed = parseSpotifyEmbedHtml(html, {
      id: 'abc',
      kind: 'playlist',
      sourceUrl: 'https://open.spotify.com/playlist/abc',
    });
    assert.equal(parsed?.title, 'Late Night Synthwave');
    assert.equal(parsed?.thumbnailUrl, 'https://i.scdn.co/image/cover123');
    assert.equal(parsed?.tracks.length, 2);
    assert.equal(parsed?.tracks[0].title, 'Midnight City');
    assert.equal(parsed?.tracks[0].artist, 'M83');
    assert.equal(parsed?.tracks[0].durationSec, 244);
  });

  test('parseAppleMusicCatalogResponse and serialized-server-data HTML fallback parse Apple Music tracks cleanly', () => {
    const catalogJson = {
      data: [
        {
          id: 'pl.123',
          attributes: {
            name: 'Chill Electronica',
            curatorName: 'Apple Music Electronic',
            artwork: { url: 'https://is1-ssl.mzstatic.com/image/thumb/{w}x{h}{c}.{f}' },
          },
          relationships: {
            tracks: {
              data: [
                {
                  id: 's1',
                  attributes: {
                    name: 'Intro',
                    artistName: 'The xx',
                    albumName: 'xx',
                    durationInMillis: 127000,
                    artwork: { url: 'https://is1-ssl.mzstatic.com/{w}x{h}.{f}' },
                  },
                },
              ],
            },
          },
        },
      ],
    };
    const res = parseAppleMusicCatalogResponse(catalogJson, {
      id: 'pl.123',
      kind: 'playlist',
      sourceUrl: 'https://music.apple.com/us/playlist/chill/pl.123',
    });
    assert.equal(res?.preview.title, 'Chill Electronica');
    assert.equal(res?.preview.owner, 'Apple Music Electronic');
    assert.equal(res?.preview.thumbnailUrl, 'https://is1-ssl.mzstatic.com/image/thumb/600x600bb.jpg');
    assert.equal(res?.preview.tracks.length, 1);
    assert.equal(res?.preview.tracks[0].durationSec, 127);

    const ssrJson = {
      data: [
        {
          seoData: { ogTitle: 'Top Pop Mix' },
          items: [
            {
              title: 'Viva La Vida',
              artistName: 'Coldplay',
              duration: 242000,
              artwork: { dictionary: { url: 'https://is1-ssl.mzstatic.com/{w}x{h}.jpg' } },
            },
          ],
        },
      ],
    };
    const ssrHtml = `<html><body><script id="serialized-server-data" type="application/json">${JSON.stringify(
      ssrJson
    )}</script></body></html>`;
    const fallback = parseAppleMusicHtmlFallback(ssrHtml, {
      id: 'pl.999',
      kind: 'playlist',
      sourceUrl: 'https://music.apple.com/us/playlist/top-pop/pl.999',
    });
    assert.equal(fallback?.tracks.length, 1);
    assert.equal(fallback?.tracks[0].title, 'Viva La Vida');
    assert.equal(fallback?.tracks[0].artist, 'Coldplay');
    assert.equal(fallback?.tracks[0].durationSec, 242);
  });
});
