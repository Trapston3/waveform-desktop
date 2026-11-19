import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

const { parseArtistCredits, resolveArtistTarget } = await import('../../src/utils/artistCredits.ts');
const { parseAppleArtistPageHtml, generateStylizedArtistSignatureSvgDataUri } = await import('../../src/services/AppleArtistArtService.ts');
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

test('parseAppleArtistPageHtml extracts hero, custom artistLogo, and dynamic colors', () => {
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
  assert.equal(art.logoUrl, 'https://is1-ssl.mzstatic.com/image/thumb/logo/1000x333Hbb.png');
  assert.equal(art.heroUrl, 'https://is1-ssl.mzstatic.com/image/thumb/hero/1200x600Hbb.jpg');
  assert.equal(art.logoAspect, 3);
  assert.equal(art.heroAspect, 2);
  assert.equal(art.background, '#1a1822');
  assert.equal(art.accent, '#f5f5f7');
  assert.equal(art.keyColor, '#FA2D48');

  assert.equal(parseAppleArtistPageHtml('<html>no script</html>'), null);
  assert.equal(parseAppleArtistPageHtml('<script id="serialized-server-data">{bad json</script>'), null);
});

test('generateStylizedArtistSignatureSvgDataUri produces valid escaped SVG data URI', () => {
  const sig = generateStylizedArtistSignatureSvgDataUri('Tyler & The Creator');
  assert.ok(sig.dataUri.startsWith('data:image/svg+xml;charset=utf-8,'));
  const decoded = decodeURIComponent(sig.dataUri.replace('data:image/svg+xml;charset=utf-8,', ''));
  assert.match(decoded, /<svg[^>]+viewBox=/);
  assert.match(decoded, /Tyler &amp; The Creator/);
  assert.match(decoded, /<path /);
  assert.ok(sig.aspect > 1);
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

test('ContextMenu, LeftSidebar, ArtistCredits wiring, and ArtistDetailView invariants', () => {
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

  for (const f of [
    'src/ui/layout/BottomPlayerBar.tsx',
    'src/ui/player/NowPlayingScreen.tsx',
    'src/ui/components/DesktopTrackTable.tsx',
    'src/ui/layout/RightSidecar.tsx',
    'src/ui/views/ReleaseDetailView.tsx',
  ]) {
    assert.match(r(f), /<ArtistCredits/, `${f} must render <ArtistCredits>`);
  }

  const adv = r('src/ui/views/ArtistDetailView.tsx');
  assert.match(adv, /artist-hero/);
  assert.match(adv, /artist-custom-logo/);
  assert.match(adv, /Signed by/);
  assert.match(adv, /tracklist-row/);
  assert.match(adv, /No releases available for this artist\./);
  assert.match(adv, /Play Top Songs/);
  assert.match(adv, /rawBio\.length > 320/);
  assert.doesNotMatch(adv, /positionMs/);
});
