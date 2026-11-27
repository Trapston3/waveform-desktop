import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

// Register TSX/TS ESM resolution & esbuild loader hook so Node 25 can import both .ts and .tsx modules
register(new URL('../helpers/tsxLoader.mjs', import.meta.url), import.meta.url);

const { parseArtistCredits, resolveArtistTarget } = await import('../../src/utils/artistCredits.ts');
const AppleArtistArtService = await import('../../src/services/AppleArtistArtService.ts');
const {
  parseAppleArtistPageHtml,
  fillTemplate,
  fetchAppleArtistArt,
  toProxiedArtistImageUrl,
} = AppleArtistArtService;
const { fallbackArtistDetail } = await import('../../src/services/fallbackFixtures.ts');
const { formatArtistStats } = await import('../../src/ui/views/ArtistDetailView.tsx');
const { MusicService } = await import('../../src/services/MusicService.ts');

const r = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('parseArtistCredits splits multi-artist, singer, and producer credits accurately', () => {
  const segs = parseArtistCredits('Daft Punk, Pharrell Williams feat. Nile Rodgers prod. by Chad Hugo');
  assert.equal(segs.length, 4);
  assert.deepEqual(
    segs.map((s) => ({ name: s.name, targetId: s.targetId })),
    [
      { name: 'Daft Punk', targetId: 'art_Daft Punk' },
      { name: 'Pharrell Williams', targetId: 'art_Pharrell Williams' },
      { name: 'Nile Rodgers', targetId: 'art_Nile Rodgers' },
      { name: 'Chad Hugo', targetId: 'art_Chad Hugo' },
    ],
  );

  // Matches explicit artists metadata and artistIds fallback
  const withMeta = parseArtistCredits(
    'Artist A & Artist B • Artist C',
    [{ id: 'UC_A', name: 'Artist A' }],
  );
  assert.equal(withMeta[0].targetId, 'UC_A');
  assert.equal(withMeta[1].targetId, 'art_Artist B');
  assert.equal(withMeta[2].targetId, 'art_Artist C');

  const withIds = parseArtistCredits('X ft. Y with Z', undefined, ['id_x', 'id_y', 'id_z']);
  assert.deepEqual(withIds.map((s) => s.targetId), ['id_x', 'id_y', 'id_z']);

  assert.deepEqual(parseArtistCredits(''), []);
  assert.deepEqual(parseArtistCredits(null), []);
});

test('resolveArtistTarget prioritizes explicit IDs and falls back to first parsed credit', () => {
  assert.equal(resolveArtistTarget({ artist: 'A & B' }, { id: 'UC_SPEC', name: 'Spec' }), 'UC_SPEC');
  assert.equal(resolveArtistTarget({ artist: 'A & B' }, { name: 'Spec Name' }), 'art_Spec Name');
  assert.equal(resolveArtistTarget({ artists: [{ id: 'UC_1', name: 'A' }], artist: 'A' }), 'UC_1');
  assert.equal(resolveArtistTarget({ artistIds: ['UC_2'], artist: 'A' }), 'UC_2');
  assert.equal(resolveArtistTarget({ channelId: 'UC_3', artist: 'A' }), 'UC_3');
  assert.equal(resolveArtistTarget({ artist: 'Julian Casablancas prod. by Rick Rubin' }), 'art_Julian Casablancas');
  assert.equal(resolveArtistTarget({}), 'art_Unknown Artist');
});

test('fillTemplate uses valid bb crop, replaceAll placeholders, and rejects unexpanded braces', () => {
  const res = fillTemplate(
    {
      url: 'https://is1-ssl.mzstatic.com/image/thumb/{w}x{h}{c}.{f}?mirror={w}x{h}{c}.{f}',
      width: 1000,
      height: 500,
    },
    800,
    'png',
  );
  assert.ok(res);
  assert.equal(res.url, 'https://is1-ssl.mzstatic.com/image/thumb/800x400bb.png?mirror=800x400bb.png');
  assert.equal(res.aspect, 2);

  // Rejects unexpanded template tokens
  const bad = fillTemplate(
    {
      url: 'https://is1-ssl.mzstatic.com/image/thumb/{w}x{h}{unknown}.{f}',
      width: 1000,
      height: 500,
    },
    800,
    'png',
  );
  assert.equal(bad, null);
});

test('parseAppleArtistPageHtml extracts hero, custom artistLogo, editorialArtwork, bannerUber, and dynamic colors with bb crop', () => {
  const payload = {
    data: [
      {
        attributes: {
          keyColor: 'FA2D48',
          artistLogo: {
            dictionary: {
              url: 'https://is1-ssl.mzstatic.com/image/thumb/logo/{w}x{h}{c}.{f}',
              width: 900,
              height: 300,
            },
          },
          artwork: {
            dictionary: {
              url: 'https://is1-ssl.mzstatic.com/image/thumb/hero/{w}x{h}{c}.{f}',
              width: 1600,
              height: 800,
              bgColor: '1a1822',
              textColor1: 'f5f5f7',
            },
          },
        },
      },
    ],
  };
  const html = `<html><head><script id="serialized-server-data" type="application/json">${JSON.stringify(payload)}</script></head></html>`;
  const art = parseAppleArtistPageHtml(html);
  assert.ok(art);
  assert.equal(art.logoUrl, 'https://is1-ssl.mzstatic.com/image/thumb/logo/1000x333bb.png');
  assert.equal(art.heroUrl, 'https://is1-ssl.mzstatic.com/image/thumb/hero/1200x600bb.jpg');
  assert.equal(art.logoAspect, 3);
  assert.equal(art.heroAspect, 2);
  assert.equal(art.background, '#1a1822');
  assert.equal(art.accent, '#f5f5f7');
  assert.equal(art.keyColor, '#FA2D48');

  // Also handles editorialArtwork.centeredFullscreenBackgroundImage / bannerUber when artistLogo is absent
  const editorialPayload = {
    data: [
      {
        attributes: {
          editorialArtwork: {
            centeredFullscreenBackgroundImage: {
              url: 'https://is1-ssl.mzstatic.com/image/thumb/editorial/{w}x{h}{c}.{f}',
              width: 2400,
              height: 1200,
              bgColor: '0d0d12',
              textColor1: 'ffffff',
            },
          },
        },
      },
    ],
  };
  const editorialHtml = `<script id="serialized-server-data">${JSON.stringify(editorialPayload)}</script>`;
  const editorialArt = parseAppleArtistPageHtml(editorialHtml);
  assert.ok(editorialArt);
  assert.equal(editorialArt.logoUrl, null);
  assert.equal(editorialArt.heroUrl, 'https://is1-ssl.mzstatic.com/image/thumb/editorial/1200x600bb.jpg');
  assert.equal(editorialArt.background, '#0d0d12');

  assert.equal(parseAppleArtistPageHtml('<html>no script</html>'), null);
  assert.equal(parseAppleArtistPageHtml('<script id="serialized-server-data">{bad json</script>'), null);
});

test('generateStylizedArtistSignatureSvgDataUri is deleted and fake cursive signature is removed', () => {
  assert.equal(
    'generateStylizedArtistSignatureSvgDataUri' in AppleArtistArtService,
    false,
    'generateStylizedArtistSignatureSvgDataUri must be deleted from AppleArtistArtService',
  );
});

test('fetchAppleArtistArt executes 3-stage waterfall (Apple Music -> MusicBrainz/Fanart.tv -> TheAudioDB)', async () => {
  // Case 1: Apple Music has hero only -> falls through to MusicBrainz + Fanart.tv for transparent logo
  const mockFetcherFanart = async (url) => {
    if (url.includes('itunes.apple.com/search')) {
      return {
        ok: true,
        json: async () => ({
          results: [{ artistName: 'Daft Punk', artistLinkUrl: 'https://music.apple.com/us/artist/daft-punk/1' }],
        }),
      };
    }
    if (url.includes('music.apple.com/us/artist/daft-punk')) {
      const payload = {
        data: [
          {
            attributes: {
              centeredFullscreenBackgroundImage: {
                url: 'https://is1-ssl.mzstatic.com/image/thumb/dp/{w}x{h}{c}.{f}',
                width: 1600,
                height: 800,
                bgColor: '101014',
              },
            },
          },
        ],
      };
      return {
        ok: true,
        text: async () => `<script id="serialized-server-data">${JSON.stringify(payload)}</script>`,
      };
    }
    if (url.includes('musicbrainz.org/ws/2/artist')) {
      return {
        ok: true,
        json: async () => ({
          artists: [{ id: '056e4f3e-d505-4dad-8ec1-d04f521cbb56', name: 'Daft Punk' }],
        }),
      };
    }
    if (url.includes('webservice.fanart.tv/v3/music/056e4f3e-d505-4dad-8ec1-d04f521cbb56')) {
      return {
        ok: true,
        json: async () => ({
          hdmusiclogo: [{ url: 'https://assets.fanart.tv/fanart/music/dp/hdmusiclogo/daft-punk.png', lang: 'en' }],
        }),
      };
    }
    return { ok: false };
  };

  const fanartMerged = await fetchAppleArtistArt('Daft Punk', mockFetcherFanart);
  assert.ok(fanartMerged);
  assert.equal(fanartMerged.heroUrl, 'https://is1-ssl.mzstatic.com/image/thumb/dp/1200x600bb.jpg');
  assert.equal(fanartMerged.logoUrl, 'https://assets.fanart.tv/fanart/music/dp/hdmusiclogo/daft-punk.png');

  // Case 2: Apple Music and Fanart.tv unavailable -> falls back to TheAudioDB
  const mockFetcherAudioDb = async (url) => {
    if (url.includes('theaudiodb.com/api/v1/json/2/search.php')) {
      return {
        ok: true,
        json: async () => ({
          artists: [
            {
              strArtist: 'Justice',
              strArtistLogo: 'https://www.theaudiodb.com/images/media/artist/logo/justice.png',
              strArtistFanart: 'https://www.theaudiodb.com/images/media/artist/fanart/justice.jpg',
            },
          ],
        }),
      };
    }
    return { ok: false };
  };

  const audioDbResult = await fetchAppleArtistArt('Justice', mockFetcherAudioDb);
  assert.ok(audioDbResult);
  assert.equal(audioDbResult.logoUrl, 'https://www.theaudiodb.com/images/media/artist/logo/justice.png');
  assert.equal(audioDbResult.heroUrl, 'https://www.theaudiodb.com/images/media/artist/fanart/justice.jpg');
});

test('toProxiedArtistImageUrl routes external URLs through waveform-local://artist-art in Electron', () => {
  const prevWindow = globalThis.window;
  try {
    delete globalThis.window;
    assert.equal(
      toProxiedArtistImageUrl('https://assets.fanart.tv/logo.png'),
      'https://assets.fanart.tv/logo.png',
    );
    assert.equal(toProxiedArtistImageUrl('https://bad.url/{w}x{h}.png'), null);

    globalThis.window = { electronAPI: { platform: 'win32' } };
    const proxied = toProxiedArtistImageUrl('https://assets.fanart.tv/logo.png');
    assert.equal(
      proxied,
      'waveform-local://artist-art?url=' + encodeURIComponent('https://assets.fanart.tv/logo.png'),
    );
    // Idempotent when already proxied
    assert.equal(toProxiedArtistImageUrl(proxied), proxied);
  } finally {
    if (prevWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
  }
});

test('formatArtistStats formats subscribersText and filters invalid monthlyListeners, and fallbackArtistDetail omits mock 420000', () => {
  assert.equal(fallbackArtistDetail.monthlyListeners, undefined);

  assert.deepEqual(formatArtistStats(null), []);
  assert.deepEqual(formatArtistStats({ monthlyListeners: undefined, subscribersText: '2.09M' }), [
    '2.09M subscribers',
  ]);
  assert.deepEqual(formatArtistStats({ monthlyListeners: 0, subscribersText: '• 2.09M' }), [
    '2.09M subscribers',
  ]);
  assert.deepEqual(formatArtistStats({ monthlyListeners: -50, subscribersText: '184K subscribers' }), [
    '184K subscribers',
  ]);
  assert.deepEqual(formatArtistStats({ monthlyListeners: 1250000, subscribersText: '2.09M' }), [
    '1,250,000 monthly listeners',
    '2.09M subscribers',
  ]);
});

test('MusicService.getArtistDetails("art_The Strokes") returns a populated ArtistPage', async () => {
  const svc = new MusicService();
  // Stub network calls so test is deterministic and fast offline
  svc.search = async (_query, filter) => {
    if (filter === 'artists') {
      return { items: [{ isArtist: true, title: 'The Strokes', thumbnailUrl: 'https://example.com/strokes.jpg' }] };
    }
    if (filter === 'songs') {
      return {
        items: [
          { videoId: 'vid_strokes_1', title: 'The Adults Are Talking', subtitle: 'The Strokes', secondaryText: '5:09', thumbnailUrl: 'https://example.com/t1.jpg' },
        ],
      };
    }
    if (filter === 'albums') {
      return {
        items: [
          { isAlbum: true, browseId: 'MPRE_strokes_1', title: 'The New Abnormal', year: '2020', thumbnailUrl: 'https://example.com/a1.jpg' },
        ],
      };
    }
    return { items: [] };
  };

  const page = await svc.getArtistDetails('art_The Strokes');
  assert.ok(page);
  assert.equal(page.id, 'art_The Strokes');
  assert.equal(page.name, 'The Strokes');
  assert.ok(page.topSongs.length > 0);
  assert.equal(page.topSongs[0].title, 'The Adults Are Talking');
  assert.ok(page.albums.length > 0);
  assert.equal(page.albums[0].title, 'The New Abnormal');
});

test('ContextMenu, LeftSidebar, DesktopTitleBar darwin traffic-light gating, ArtistCredits wiring, and ArtistDetailView invariants', () => {
  const cm = r('src/ui/common/ContextMenu.tsx');
  assert.match(cm, /position: 'fixed'/);
  assert.match(cm, /zIndex: 9999/);
  assert.match(cm, /resolveArtistTarget\(track\)/);
  assert.match(cm, /effectiveVideoId/);
  assert.match(cm, /effectiveArtist/);
  assert.match(cm, /flipSubmenuLeft/);

  const hook = r('src/ui/hooks/useContextMenu.ts');
  assert.match(hook, /Escape/);
  assert.match(hook, /windowHeight - menuHeight - 96/);

  const sb = r('src/ui/layout/LeftSidebar.tsx');
  assert.match(sb, /flex-1 min-h-0 overflow-y-auto/);
  assert.match(sb, /shrink-0 px-3 pt-2\.5 pb-\[100px\]/);
  assert.match(sb, /dark:text-white text-black/);

  const tb = r('src/ui/layout/DesktopTitleBar.tsx');
  assert.match(tb, /getPlatformBridge\(\)\.platform === 'darwin'/);
  assert.match(tb, /\{isMac && \(/);
  assert.match(tb, /h-10/);
  assert.match(tb, /w-7 h-7/);
  assert.match(tb, /#E81123/);

  for (const f of [
    'src/ui/layout/BottomPlayerBar.tsx',
    'src/ui/player/NowPlayingScreen.tsx',
    'src/ui/components/DesktopTrackTable.tsx',
    'src/ui/layout/RightSidecar.tsx',
    'src/ui/views/ReleaseDetailView.tsx',
    'src/ui/views/ArtistDetailView.tsx',
  ]) {
    assert.match(r(f), /<ArtistCredits/, `${f} must render <ArtistCredits>`);
  }

  const adv = r('src/ui/views/ArtistDetailView.tsx');
  assert.match(adv, /artist-hero/);
  assert.match(adv, /artist-custom-logo/);
  assert.match(adv, /artist-editorial-title/);
  assert.match(adv, /new Image\(\)/);
  assert.match(adv, /tracklist-row/);
  assert.match(adv, /No releases available for this artist\./);
  assert.match(adv, /Play Top Songs/);
  assert.match(adv, /rawBio\.length > 320/);
  assert.match(adv, /memo\(/);
  assert.doesNotMatch(adv, /Signed by/);
  assert.doesNotMatch(adv, /artist-signature/);
  assert.doesNotMatch(adv, /generateStylizedArtistSignatureSvgDataUri/);
  assert.doesNotMatch(adv, /positionMs/);
});
