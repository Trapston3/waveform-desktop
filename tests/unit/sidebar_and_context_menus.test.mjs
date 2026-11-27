// tests/unit/sidebar_and_context_menus.test.mjs
// Unit tests for Sidebar Playlist resolution/CRUD, typed ContextMenu, font dropdown VisualizerContextMenu, and Studio Tools popover

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const rootDir = path.resolve('.');
const resolverHook = `
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(${JSON.stringify(pathToFileURL(path.join(rootDir, 'package.json')).href)});
const ts = require('typescript');
export async function resolve(specifier, context, nextResolve) {
  try { return await nextResolve(specifier, context); } catch (err) {
    if (specifier.startsWith('.')) {
      for (const sfx of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
        try { return await nextResolve(specifier + sfx, context); } catch {}
      }
    }
    throw err;
  }
}
export async function load(url, context, nextLoad) {
  if (url.endsWith('.tsx')) {
    const source = fs.readFileSync(fileURLToPath(url), 'utf8');
    const transpiled = ts.transpileModule(source, {
      fileName: fileURLToPath(url),
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    });
    return { format: 'module', shortCircuit: true, source: transpiled.outputText };
  }
  return nextLoad(url, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(resolverHook)}`, import.meta.url);

if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    documentElement: {
      classList: { add: () => {}, remove: () => {}, contains: () => true },
      style: { setProperty: () => {}, getPropertyValue: () => '' },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');
const { StorageService } = await import('../../src/services/StorageService.ts');
const { resolvePlaylistSongs, useLibraryStore } = await import('../../src/state/libraryStore.ts');
const { normalizeContextMenuTarget } = await import('../../src/ui/hooks/useContextMenu.ts');
const { ContextMenu } = await import('../../src/ui/common/ContextMenu.tsx');
const { VisualizerContextMenu } = await import('../../src/ui/common/VisualizerContextMenu.tsx');

const SAMPLE_SONGS = [
  { videoId: 's1', title: 'Track One', artist: 'Artist A', liked: true, totalPlayTimeMs: 180000, playCount: 1, artistIds: ['art_a'], artists: [{ id: 'art_a', name: 'Artist A' }], isExplicit: false },
  { videoId: 's2', title: 'Track Two', artist: 'Artist B', liked: false, totalPlayTimeMs: 210000, playCount: 2, artistIds: ['art_b'], artists: [{ id: 'art_b', name: 'Artist B' }], isExplicit: false },
];

describe('Sidebar Play, Playlist CRUD & Object-Specific Context Menus', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-menu-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('resolvePlaylistSongs preserves playlist order and falls back to embedded tracks', () => {
    const playlist = {
      id: 'pl_1',
      title: 'Night Mix',
      description: '',
      thumbnailUrl: null,
      isCustom: true,
      createdAt: '',
      updatedAt: '',
      songIds: ['s2', 's1'],
      songCount: 2,
      totalDurationSec: 390,
    };
    const ordered = resolvePlaylistSongs(playlist, SAMPLE_SONGS);
    assert.deepEqual(ordered.map((s) => s.videoId), ['s2', 's1']);
  });

  test('StorageService & libraryStore renamePlaylist and duplicatePlaylist persist atomically', async () => {
    const storage = new StorageService(tmpDir);
    await useLibraryStore.getState().initLibrary(storage);
    const created = await useLibraryStore.getState().createPlaylist('Original Mix', 'desc');
    await useLibraryStore.getState().addTracksToPlaylist(created.id, ['s1', 's2']);

    const renamed = await useLibraryStore.getState().renamePlaylist(created.id, 'Renamed Mix');
    assert.equal(renamed?.title, 'Renamed Mix');

    const duplicated = await useLibraryStore.getState().duplicatePlaylist(created.id);
    assert.ok(duplicated);
    assert.equal(duplicated.title, 'Renamed Mix (Copy)');
    assert.deepEqual(duplicated.songIds, ['s1', 's2']);

    const reloaded = await new StorageService(tmpDir).getPlaylists();
    assert.equal(reloaded.length, 2);
    assert.equal(reloaded[0].title, 'Renamed Mix');
    assert.equal(reloaded[1].title, 'Renamed Mix (Copy)');
  });

  test('ContextMenu renders distinct object-specific actions for playlist, album, artist, and song', () => {
    const playlistHtml = renderToStaticMarkup(
      React.createElement(ContextMenu, {
        isOpen: true,
        x: 40,
        y: 80,
        target: {
          kind: 'playlist',
          playlist: {
            id: 'pl_x',
            title: 'Late Night',
            description: '',
            thumbnailUrl: null,
            isCustom: true,
            createdAt: '',
            updatedAt: '',
            songIds: ['s1'],
            songCount: 1,
            totalDurationSec: 180,
          },
          songs: SAMPLE_SONGS,
        },
        onClose: () => {},
      })
    );
    assert.ok(playlistHtml.includes('Play Playlist'));
    assert.ok(playlistHtml.includes('Shuffle Playlist'));
    assert.ok(playlistHtml.includes('Rename Playlist'));
    assert.ok(playlistHtml.includes('Duplicate Playlist'));
    assert.ok(playlistHtml.includes('Delete Playlist'));

    const albumHtml = renderToStaticMarkup(
      React.createElement(ContextMenu, {
        isOpen: true,
        x: 40,
        y: 80,
        target: {
          kind: 'album',
          album: { id: 'alb_1', title: 'Discovery', artist: 'Daft Punk', songs: SAMPLE_SONGS },
        },
        onClose: () => {},
      })
    );
    assert.ok(albumHtml.includes('Play Album'));
    assert.ok(albumHtml.includes('Shuffle Album'));
    assert.ok(albumHtml.includes('Add Album to Queue'));
    assert.ok(albumHtml.includes('Pin Album Offline'));

    const artistHtml = renderToStaticMarkup(
      React.createElement(ContextMenu, {
        isOpen: true,
        x: 40,
        y: 80,
        target: {
          kind: 'artist',
          artist: { id: 'art_1', name: 'Lazerhawk', songs: SAMPLE_SONGS },
        },
        onClose: () => {},
      })
    );
    assert.ok(artistHtml.includes('Play Top Songs'));
    assert.ok(artistHtml.includes('Start Artist Radio'));
    assert.ok(artistHtml.includes('Open Artist Page'));

    const songHtml = renderToStaticMarkup(
      React.createElement(ContextMenu, {
        isOpen: true,
        x: 40,
        y: 80,
        track: SAMPLE_SONGS[0],
        onClose: () => {},
      })
    );
    assert.ok(songHtml.includes('Play Next'));
    assert.ok(songHtml.includes('Start Song Radio'));
    assert.ok(songHtml.includes('Copy Song Title'));

    const autoAlbum = normalizeContextMenuTarget({ id: 'alb_raw', title: 'Raw Alb', isAlbum: true });
    assert.equal(autoAlbum?.kind, 'album');
    const autoArtist = normalizeContextMenuTarget({ id: 'art_raw', title: 'Raw Art', isArtist: true });
    assert.equal(autoArtist?.kind, 'artist');
  });

  test('VisualizerContextMenu uses compact <select> Font Family and NowPlayingScreen includes Studio Tools', () => {
    const vizSrc = fs.readFileSync('src/ui/common/VisualizerContextMenu.tsx', 'utf8');
    assert.ok(vizSrc.includes('data-testid="viz-font-select"'));
    assert.ok(vizSrc.includes('1. Style & Variation'));
    assert.ok(vizSrc.includes('2. Typography & Look'));
    assert.ok(vizSrc.includes('3. Motion & Extras'));

    const npSrc = fs.readFileSync('src/ui/player/NowPlayingScreen.tsx', 'utf8');
    assert.ok(npSrc.includes('data-testid="now-playing-studio-tools-toggle"'));
    assert.ok(npSrc.includes('data-testid="studio-tools-popover"'));
    assert.ok(npSrc.includes('Karaoke Vocal Removal'));
    assert.ok(npSrc.includes('Auto-Mix Transitions'));

    const sidebarSrc = fs.readFileSync('src/ui/layout/LeftSidebar.tsx', 'utf8');
    assert.ok(sidebarSrc.includes('handlePlayPlaylist'));
    assert.ok(sidebarSrc.includes("kind: 'playlist'"));
  });
});
