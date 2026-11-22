import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync('electron/main.ts', 'utf8');
const preload = fs.readFileSync('electron/preload.cts', 'utf8');
const view = fs.readFileSync('src/ui/views/LocalMediaView.tsx', 'utf8');
const libraryScreen = fs.readFileSync('src/ui/views/LibraryScreen.tsx', 'utf8');
const coverFlowView = fs.readFileSync('src/ui/views/CoverFlowView.tsx', 'utf8');
const albumCoverFlow = fs.readFileSync('src/ui/player/AlbumCoverFlow.tsx', 'utf8');
const searchScreen = fs.readFileSync('src/ui/views/SearchScreen.tsx', 'utf8');

test('main registers privileged waveform-local protocol with Range support', () => {
  assert.match(main, /registerSchemesAsPrivileged/);
  assert.match(main, /protocol\??\.handle\('waveform-local'/);
  assert.match(main, /status: 206/);
  assert.match(main, /Content-Range/);
  assert.match(main, /Accept-Ranges/);
});

test('main exposes folder, scan and account IPC', () => {
  for (const ch of ['select-local-folder', 'scan-local-folder', 'account-login', 'account-status', 'account-logout']) {
    assert.ok(main.includes(`'${ch}'`), ch);
  }
  assert.match(main, /SAPISID/);
  assert.match(main, /sp_dc/);
});

test('preload bridges all new APIs', () => {
  for (const fn of ['selectLocalFolder', 'scanLocalFolder', 'loginYouTubeMusic', 'loginSpotify', 'getAccountAuthStatus', 'logoutAccount']) {
    assert.ok(preload.includes(`${fn}:`), fn);
  }
});

test('LocalMediaView uses real scanLocalFolder, Browse button, storage.localFolders, folder management, and persistent enrichment patches', () => {
  assert.doesNotMatch(view, /null as any, folderPath/);
  assert.match(view, /scanLocalFolder/);
  assert.match(view, /Browse\.\.\./);
  assert.match(view, /selectLocalFolder/);
  assert.match(view, /storage\.localFolders/);
  assert.doesNotMatch(view, /localMusicFolders/);
  assert.match(view, /upsertLocalTrackPatch/);
  assert.match(view, /removeLocalFolder/);
  assert.match(view, /Rescan/);
  assert.match(view, /Remove/);
});

test('LibraryScreen unifies favorites + localSongs with source filter, preserves invariants and zero liquid-glass / positionMs', () => {
  assert.match(libraryScreen, /selectUnifiedSongs/);
  assert.match(libraryScreen, /selectUnifiedAlbums/);
  assert.match(libraryScreen, /selectUnifiedArtists/);
  assert.match(libraryScreen, /sourceFilter/);
  assert.match(libraryScreen, /setContextQueue/);
  assert.match(libraryScreen, /acrylic-tile/);
  assert.match(libraryScreen, /tracklist-row/);
  assert.match(libraryScreen, /memo\(/);
  assert.match(libraryScreen, /Spotify Playlists/);
  assert.doesNotMatch(libraryScreen, /liquid-glass/);
  assert.doesNotMatch(libraryScreen, /positionMs/);
});

test('CoverFlowView and AlbumCoverFlow support unified local albums and preserve exact 3D CSS reflection styles', () => {
  assert.match(coverFlowView, /selectUnifiedSongs/);
  assert.match(coverFlowView, /selectUnifiedAlbums/);
  assert.match(coverFlowView, /onActiveAlbumChange/);
  assert.doesNotMatch(coverFlowView, /positionMs/);

  assert.ok(albumCoverFlow.includes("perspective: '1000px'"));
  assert.ok(albumCoverFlow.includes("transformStyle: 'preserve-3d'"));
  assert.ok(albumCoverFlow.includes('scaleY(-1) translateY(-6px)'));
  assert.ok(albumCoverFlow.includes('opacity: 0.28'));
  assert.ok(
    albumCoverFlow.includes(
      'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.45) 40%, rgba(0,0,0,0.95) 100%)'
    )
  );
  assert.doesNotMatch(albumCoverFlow, /positionMs/);
});

test('SearchScreen includes localSongs in search results without adding an input element', () => {
  assert.match(searchScreen, /useLibraryStore/);
  assert.match(searchScreen, /localSongs/);
  assert.equal(searchScreen.includes('<input'), false);
  assert.doesNotMatch(searchScreen, /positionMs/);
});
