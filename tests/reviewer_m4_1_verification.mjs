// tests/reviewer_m4_1_verification.mjs
// Independent Reviewer 1 Verification Harness for Milestone 4
// Verifying State Stores, StorageService persistence & concurrency, AudioController & Queue advancement, Navigation routing

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { register } from 'node:module';

// Register ESM resolution hook so Node can resolve relative .ts imports without extensions
const resolverHook = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && !specifier.endsWith('.ts') && !specifier.endsWith('.js') && !specifier.endsWith('.mjs')) {
      try {
        return await nextResolve(specifier + '.ts', context);
      } catch {}
      try {
        return await nextResolve(specifier + '/index.ts', context);
      } catch {}
    }
    throw err;
  }
}
`;
register(`data:text/javascript,${encodeURIComponent(resolverHook)}`, import.meta.url);

const { StorageService } = await import('../src/services/StorageService.ts');
const { useLibraryStore } = await import('../src/state/libraryStore.ts');
const { usePlayerStore } = await import('../src/state/playerStore.ts');
const { useQueueStore } = await import('../src/state/queueStore.ts');
const { useNavigationStore } = await import('../src/state/navigationStore.ts');
const { useSettingsStore } = await import('../src/state/settingsStore.ts');
const { AudioEngine } = await import('../src/audio/AudioEngine.ts');

const testTempDir = path.join(os.tmpdir(), `waveform_rev1_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

test('Reviewer 1 - StorageService: deletePlaylist and removeTracksFromPlaylist atomic persistence', async (t) => {
  const storage = new StorageService(testTempDir);

  // 1. Create a playlist
  const pl = await storage.createPlaylist('Reviewer Playlist', 'Testing persistence');
  assert.ok(pl.id, 'Playlist must have generated ID');
  assert.strictEqual(pl.title, 'Reviewer Playlist');
  assert.strictEqual(pl.songCount, 0);

  // Verify file on disk
  const diskPlaylistsFile = path.join(testTempDir, 'playlists.json');
  assert.ok(fs.existsSync(diskPlaylistsFile), 'playlists.json must exist on disk');
  const onDisk1 = JSON.parse(fs.readFileSync(diskPlaylistsFile, 'utf-8'));
  assert.strictEqual(onDisk1.length, 1);
  assert.strictEqual(onDisk1[0].id, pl.id);

  // 2. Add tracks
  await storage.addTracksToPlaylist(pl.id, ['track_1', 'track_2', 'track_3']);
  const onDisk2 = JSON.parse(fs.readFileSync(diskPlaylistsFile, 'utf-8'));
  assert.strictEqual(onDisk2[0].songCount, 3);
  assert.deepStrictEqual(onDisk2[0].songIds, ['track_1', 'track_2', 'track_3']);

  // 3. Remove single and multiple tracks via removeTracksFromPlaylist
  const removedSingle = await storage.removeTracksFromPlaylist(pl.id, ['track_2']);
  assert.strictEqual(removedSingle, true, 'Should return true when tracks are removed');
  const onDisk3 = JSON.parse(fs.readFileSync(diskPlaylistsFile, 'utf-8'));
  assert.strictEqual(onDisk3[0].songCount, 2);
  assert.deepStrictEqual(onDisk3[0].songIds, ['track_1', 'track_3']);

  // Removing track not in playlist returns false
  const removedNonexistent = await storage.removeTracksFromPlaylist(pl.id, ['nonexistent_track']);
  assert.strictEqual(removedNonexistent, false, 'Removing nonexistent track returns false');

  // Removing from nonexistent playlist returns false
  const removedFromMissing = await storage.removeTracksFromPlaylist('missing_pl_id', ['track_1']);
  assert.strictEqual(removedFromMissing, false, 'Removing from missing playlist returns false');

  // 4. Delete playlist
  const deleted = await storage.deletePlaylist(pl.id);
  assert.strictEqual(deleted, true, 'deletePlaylist returns true on success');
  const onDisk4 = JSON.parse(fs.readFileSync(diskPlaylistsFile, 'utf-8'));
  assert.strictEqual(onDisk4.length, 0, 'playlists.json must now have 0 playlists');

  // Deleting again returns false gracefully
  const deletedAgain = await storage.deletePlaylist(pl.id);
  assert.strictEqual(deletedAgain, false, 'deletePlaylist returns false for nonexistent playlist');
});

test('Reviewer 1 - StorageService: High Concurrency Playlist Mutations', async () => {
  const storage = new StorageService(testTempDir);
  const diskPlaylistsFile = path.join(testTempDir, 'playlists.json');

  // Run 30 concurrent operations (creates, adds, removes)
  const ops = [];
  for (let i = 0; i < 15; i++) {
    ops.push(
      storage.createPlaylist(`Stress PL ${i}`).then(async (created) => {
        await storage.addTracksToPlaylist(created.id, [`song_${i}_a`, `song_${i}_b`]);
        if (i % 2 === 0) {
          await storage.removeTracksFromPlaylist(created.id, [`song_${i}_a`]);
        }
        if (i % 3 === 0) {
          await storage.deletePlaylist(created.id);
        }
      })
    );
  }

  await Promise.all(ops);

  // Verify file on disk is valid JSON and not corrupt
  const finalOnDisk = JSON.parse(fs.readFileSync(diskPlaylistsFile, 'utf-8'));
  assert.ok(Array.isArray(finalOnDisk), 'File must remain a valid array');
  for (const pl of finalOnDisk) {
    assert.ok(pl.id);
    assert.strictEqual(pl.songCount, pl.songIds.length);
  }
});

test('Reviewer 1 - libraryStore: Integration with StorageService for delete & remove', async () => {
  const storage = new StorageService(testTempDir);
  const store = useLibraryStore.getState();
  await store.initLibrary(storage);

  const created = await store.createPlaylist('Store Test PL');
  assert.strictEqual(useLibraryStore.getState().playlists.some(p => p.id === created.id), true);

  await store.addTracksToPlaylist(created.id, ['s1', 's2']);
  let plInStore = useLibraryStore.getState().playlists.find(p => p.id === created.id);
  assert.strictEqual(plInStore?.songCount, 2);

  await store.removeTrackFromPlaylist(created.id, 's1');
  plInStore = useLibraryStore.getState().playlists.find(p => p.id === created.id);
  assert.strictEqual(plInStore?.songCount, 1);
  assert.deepStrictEqual(plInStore?.songIds, ['s2']);

  // Delete via store
  const deleted = await store.deletePlaylist(created.id);
  assert.strictEqual(deleted, true);
  assert.strictEqual(useLibraryStore.getState().playlists.some(p => p.id === created.id), false);

  // Deleting again returns false
  const deletedAgain = await store.deletePlaylist('nonexistent');
  assert.strictEqual(deletedAgain, false);
});

test('Reviewer 1 - AudioEngine and queueStore track ended advancement', async () => {
  const engine = new AudioEngine();
  const player = usePlayerStore.getState();
  player.initEngine(engine);

  const queue = useQueueStore.getState();
  queue.clearQueue();

  const song1 = {
    videoId: 'v1',
    title: 'Song 1',
    artist: 'Artist 1',
    durationSec: 100,
    totalPlayTimeMs: 100000,
    liked: false,
    playCount: 1,
    artistIds: [],
    artists: [],
    isExplicit: false,
  };
  const song2 = {
    videoId: 'v2',
    title: 'Song 2',
    artist: 'Artist 2',
    durationSec: 120,
    totalPlayTimeMs: 120000,
    liked: false,
    playCount: 1,
    artistIds: [],
    artists: [],
    isExplicit: false,
  };

  // Wire onTrackEnded to advanceQueue (simulating useAudioController)
  const unsub = engine.onTrackEnded(() => {
    useQueueStore.getState().advanceQueue();
  });

  // Set context with song1 and song2
  queue.setContextQueue([song1, song2], 0);
  assert.strictEqual(useQueueStore.getState().currentSong?.videoId, 'v1');

  // Trigger track ended on active deck
  engine['_handleDeckEnded']('deckA');

  // Queue should have advanced to song2
  assert.strictEqual(useQueueStore.getState().currentSong?.videoId, 'v2');

  unsub();
  player.cleanupEngine();
});

test('Reviewer 1 - queueStore 3-Tier Priority Traversal', async () => {
  const queue = useQueueStore.getState();
  queue.clearQueue();

  const userSong = {
    videoId: 'user_1',
    title: 'User Song',
    artist: 'A',
    durationSec: 60,
    liked: false,
    playCount: 0,
    artistIds: [],
    artists: [],
    isExplicit: false,
  };
  const ctxSong = {
    videoId: 'ctx_1',
    title: 'Context Song',
    artist: 'B',
    durationSec: 60,
    liked: false,
    playCount: 0,
    artistIds: [],
    artists: [],
    isExplicit: false,
  };
  const autoplaySong = {
    videoId: 'auto_1',
    title: 'Autoplay Song',
    artist: 'C',
    durationSec: 60,
    liked: false,
    playCount: 0,
    artistIds: [],
    artists: [],
    isExplicit: false,
  };

  queue.setContextQueue([ctxSong], 0);
  queue.addToUserQueue(userSong);
  queue.setAutoplayQueue([autoplaySong]);

  // Priority Tier 1: USER_QUEUE must be chosen first
  const next1 = queue.advanceQueue();
  assert.strictEqual(next1?.videoId, 'user_1');
  assert.strictEqual(useQueueStore.getState().currentTier, 'USER_QUEUE');

  // Next: USER_QUEUE empty -> CONTEXT exhausted (was on index 0 of 1) -> Tier 3: AUTOPLAY
  const next2 = queue.advanceQueue();
  assert.strictEqual(next2?.videoId, 'auto_1');
  assert.strictEqual(useQueueStore.getState().currentTier, 'AUTOPLAY');

  // All exhausted
  const next3 = queue.advanceQueue();
  assert.strictEqual(next3, null);
});

test('Reviewer 1 - navigationStore Navigation Stack & Modals', () => {
  // Initial
  useNavigationStore.getState().navigateToTab('home');
  assert.strictEqual(useNavigationStore.getState().current.type, 'tab');
  assert.strictEqual(useNavigationStore.getState().current.tab, 'home');

  // Navigate to explore
  useNavigationStore.getState().navigateToTab('explore');
  assert.strictEqual(useNavigationStore.getState().current.tab, 'explore');
  assert.strictEqual(useNavigationStore.getState().canGoBack(), true);

  // Navigate to release
  useNavigationStore.getState().navigateToRelease('rel_123', 'album');
  assert.strictEqual(useNavigationStore.getState().current.type, 'release');
  assert.strictEqual(useNavigationStore.getState().current.id, 'rel_123');

  // Navigate to artist
  useNavigationStore.getState().navigateToArtist('art_456');
  assert.strictEqual(useNavigationStore.getState().current.type, 'artist');
  assert.strictEqual(useNavigationStore.getState().current.id, 'art_456');

  // goBack
  assert.strictEqual(useNavigationStore.getState().goBack(), true);
  assert.strictEqual(useNavigationStore.getState().current.type, 'release');

  assert.strictEqual(useNavigationStore.getState().goBack(), true);
  assert.strictEqual(useNavigationStore.getState().current.tab, 'explore');

  // goForward
  assert.strictEqual(useNavigationStore.getState().canGoForward(), true);
  assert.strictEqual(useNavigationStore.getState().goForward(), true);
  assert.strictEqual(useNavigationStore.getState().current.type, 'release');

  // Modals
  useNavigationStore.getState().setSettingsOpen(true);
  assert.strictEqual(useNavigationStore.getState().isSettingsOpen, true);
  useNavigationStore.getState().setSettingsOpen(false);
  assert.strictEqual(useNavigationStore.getState().isSettingsOpen, false);

  // Mutual exclusion between Lyrics and Queue drawers
  useNavigationStore.getState().setLyricsDrawerOpen(true);
  assert.strictEqual(useNavigationStore.getState().isLyricsDrawerOpen, true);
  assert.strictEqual(useNavigationStore.getState().isQueueDrawerOpen, false);

  useNavigationStore.getState().setQueueDrawerOpen(true);
  assert.strictEqual(useNavigationStore.getState().isQueueDrawerOpen, true);
  assert.strictEqual(useNavigationStore.getState().isLyricsDrawerOpen, false);
});
