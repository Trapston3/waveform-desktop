// tests/adversarial_m4_stores_stress.mjs
// Adversarial Empirical Stress & Boundary Harness for Milestone 4
// Rigorously tests:
// 1. playerStore: Space play/pause, seek relative & boundary clamping, volume clamping, mute/unmute
// 2. navigationStore: Linear path, back/forward history stacks, rapid switching stress
// 3. libraryStore & StorageService: Concurrent playlist creation, track addition/removal, deletion, disk persistence

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { register } from 'node:module';

// Register ESM resolution hook for relative .ts imports
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

// Import stores and models
const { usePlayerStore } = await import('../src/state/playerStore.ts');
const { useNavigationStore } = await import('../src/state/navigationStore.ts');
const { useLibraryStore } = await import('../src/state/libraryStore.ts');
const { StorageService } = await import('../src/services/StorageService.ts');
const { normalizeSong } = await import('../src/models/Song.ts');

const tempStorageDir = path.join(os.tmpdir(), `waveform-m4-stress-${Date.now()}`);

before(() => {
  if (!fs.existsSync(tempStorageDir)) {
    fs.mkdirSync(tempStorageDir, { recursive: true });
  }
});

after(() => {
  try {
    fs.rmSync(tempStorageDir, { recursive: true, force: true });
  } catch {}
});

describe('M4 Adversarial Challenge: PlayerStore Clamping & Playback Logic', () => {
  test('P01: Initial state starts at IDLE when no track is loaded', () => {
    const store = usePlayerStore.getState();
    assert.strictEqual(store.playbackState, 'IDLE');
    assert.strictEqual(store.currentTrack, null);
    assert.strictEqual(store.positionMs, 0);
  });

  test('P02: Space togglePlay cleanly transitions between PLAYING and PAUSED when no track is loaded', () => {
    const store = usePlayerStore.getState();

    store.togglePlay();
    assert.strictEqual(usePlayerStore.getState().playbackState, 'PLAYING');

    store.togglePlay();
    assert.strictEqual(usePlayerStore.getState().playbackState, 'PAUSED');

    store.togglePlay();
    assert.strictEqual(usePlayerStore.getState().playbackState, 'PLAYING');

    store.pause();
    assert.strictEqual(usePlayerStore.getState().playbackState, 'PAUSED');

    store.play();
    assert.strictEqual(usePlayerStore.getState().playbackState, 'PLAYING');
  });

  test('P03: Seek clamping when durationMs is 0 clamps position to exactly 0ms', () => {
    const store = usePlayerStore.getState();
    usePlayerStore.setState({ durationMs: 0, positionMs: 0 });

    store.seek(5000);
    assert.strictEqual(usePlayerStore.getState().positionMs, 0);

    store.seek(-5000);
    assert.strictEqual(usePlayerStore.getState().positionMs, 0);

    store.seekRelative(5000);
    assert.strictEqual(usePlayerStore.getState().positionMs, 0);

    store.seekRelative(-5000);
    assert.strictEqual(usePlayerStore.getState().positionMs, 0);
  });

  test('P04: ArrowRight / ArrowLeft seek (+-5000ms) with boundary clamping at [0, durationMs]', () => {
    const store = usePlayerStore.getState();
    const duration = 180000; // 3 minutes
    usePlayerStore.setState({ durationMs: duration, positionMs: 10000 });

    // Normal forward seek
    store.seekRelative(5000);
    assert.strictEqual(usePlayerStore.getState().positionMs, 15000);

    // Normal backward seek
    store.seekRelative(-5000);
    assert.strictEqual(usePlayerStore.getState().positionMs, 10000);

    // Left boundary clamping: seek backward past 0
    usePlayerStore.setState({ positionMs: 2000 });
    store.seekRelative(-5000);
    assert.strictEqual(usePlayerStore.getState().positionMs, 0); // Not -3000

    // Left boundary clamping at 0
    store.seekRelative(-5000);
    assert.strictEqual(usePlayerStore.getState().positionMs, 0);

    // Right boundary clamping: seek forward past duration
    usePlayerStore.setState({ positionMs: 178000 });
    store.seekRelative(5000);
    assert.strictEqual(usePlayerStore.getState().positionMs, 180000); // Not 183000

    // Right boundary clamping at duration
    store.seekRelative(5000);
    assert.strictEqual(usePlayerStore.getState().positionMs, 180000);
  });

  test('P05: Shift + ArrowRight / ArrowLeft (+-15000ms) fast seek with boundary clamping', () => {
    const store = usePlayerStore.getState();
    const duration = 180000;
    usePlayerStore.setState({ durationMs: duration, positionMs: 50000 });

    store.seekRelative(15000);
    assert.strictEqual(usePlayerStore.getState().positionMs, 65000);

    store.seekRelative(-15000);
    assert.strictEqual(usePlayerStore.getState().positionMs, 50000);

    // Shift left boundary clamping
    usePlayerStore.setState({ positionMs: 8000 });
    store.seekRelative(-15000);
    assert.strictEqual(usePlayerStore.getState().positionMs, 0);

    // Shift right boundary clamping
    usePlayerStore.setState({ positionMs: 172000 });
    store.seekRelative(15000);
    assert.strictEqual(usePlayerStore.getState().positionMs, 180000);
  });

  test('P06: ArrowUp / ArrowDown volume (+-0.05) with boundary clamping at [0.0, 1.0]', () => {
    const store = usePlayerStore.getState();
    store.setVolume(0.85);

    store.adjustVolumeRelative(0.05);
    assert.ok(Math.abs(usePlayerStore.getState().volume - 0.90) < 1e-6);

    store.adjustVolumeRelative(-0.05);
    assert.ok(Math.abs(usePlayerStore.getState().volume - 0.85) < 1e-6);

    // Upper boundary clamping at 1.0
    store.setVolume(0.98);
    store.adjustVolumeRelative(0.05);
    assert.strictEqual(usePlayerStore.getState().volume, 1.0); // Not 1.03

    store.adjustVolumeRelative(0.05);
    assert.strictEqual(usePlayerStore.getState().volume, 1.0);

    // Lower boundary clamping at 0.0
    store.setVolume(0.03);
    store.adjustVolumeRelative(-0.05);
    assert.strictEqual(usePlayerStore.getState().volume, 0.0);
    assert.strictEqual(usePlayerStore.getState().isMuted, true);

    store.adjustVolumeRelative(-0.05);
    assert.strictEqual(usePlayerStore.getState().volume, 0.0);
  });

  test('P07: Volume un-muting via ArrowUp restores preMuteVolume + step', () => {
    const store = usePlayerStore.getState();
    store.setVolume(0.60);
    store.toggleMute();

    assert.strictEqual(usePlayerStore.getState().isMuted, true);
    assert.strictEqual(usePlayerStore.getState().volume, 0.0);

    // ArrowUp while muted should unmute and add 0.05 to preMuteVolume (0.60 + 0.05 = 0.65)
    store.adjustVolumeRelative(0.05);
    assert.strictEqual(usePlayerStore.getState().isMuted, false);
    assert.ok(Math.abs(usePlayerStore.getState().volume - 0.65) < 1e-6);
  });

  test('P08: ToggleMute round-trip preserves exact pre-mute volume level', () => {
    const store = usePlayerStore.getState();
    store.setVolume(0.72);

    store.toggleMute();
    assert.strictEqual(usePlayerStore.getState().isMuted, true);
    assert.strictEqual(usePlayerStore.getState().volume, 0.0);

    store.toggleMute();
    assert.strictEqual(usePlayerStore.getState().isMuted, false);
    assert.ok(Math.abs(usePlayerStore.getState().volume - 0.72) < 1e-6);
  });

  test('P09: Track loading sets currentTrack, duration, resets positionMs to 0', async () => {
    const store = usePlayerStore.getState();
    const mockTrack = normalizeSong({
      videoId: 'test_vid_01',
      title: 'Midnight City',
      artist: 'M83',
      durationSec: 243,
      totalPlayTimeMs: 243000,
      isExplicit: false,
    });

    await store.loadTrack(mockTrack, 'active', false);

    const updated = usePlayerStore.getState();
    assert.strictEqual(updated.currentTrack?.videoId, 'test_vid_01');
    assert.strictEqual(updated.durationMs, 243000);
    assert.strictEqual(updated.positionMs, 0);

    // Now test play/pause with loaded track
    store.play();
    assert.strictEqual(usePlayerStore.getState().playbackState, 'PLAYING');

    store.pause();
    assert.strictEqual(usePlayerStore.getState().playbackState, 'PAUSED');
  });
});

describe('M4 Adversarial Challenge: NavigationStore Concurrency & Stacks', () => {
  test('N01: Full path traversal Home -> Search -> Release -> Artist -> Library -> Home', () => {
    const nav = useNavigationStore.getState();
    useNavigationStore.setState({
      current: { type: 'tab', tab: 'home' },
      history: [],
      forwardStack: [],
    });

    // 1. Navigate to Search
    nav.navigateToTab('search');
    assert.strictEqual(useNavigationStore.getState().current.type, 'tab');
    assert.strictEqual(useNavigationStore.getState().current.tab, 'search');
    assert.strictEqual(useNavigationStore.getState().history.length, 1);

    // 2. Navigate to Release
    nav.navigateToRelease('MPREb_redline_01', 'album');
    assert.strictEqual(useNavigationStore.getState().current.type, 'release');
    assert.strictEqual(useNavigationStore.getState().current.id, 'MPREb_redline_01');
    assert.strictEqual(useNavigationStore.getState().history.length, 2);

    // 3. Navigate to Artist
    nav.navigateToArtist('UC_lazerhawk');
    assert.strictEqual(useNavigationStore.getState().current.type, 'artist');
    assert.strictEqual(useNavigationStore.getState().current.id, 'UC_lazerhawk');
    assert.strictEqual(useNavigationStore.getState().history.length, 3);

    // 4. Navigate to Library
    nav.navigateToTab('library', 'Playlists');
    assert.strictEqual(useNavigationStore.getState().current.type, 'tab');
    assert.strictEqual(useNavigationStore.getState().current.tab, 'library');
    assert.strictEqual(useNavigationStore.getState().current.subView, 'Playlists');
    assert.strictEqual(useNavigationStore.getState().history.length, 4);

    // 5. Navigate to Home
    nav.navigateToTab('home');
    assert.strictEqual(useNavigationStore.getState().current.type, 'tab');
    assert.strictEqual(useNavigationStore.getState().current.tab, 'home');
    assert.strictEqual(useNavigationStore.getState().history.length, 5);

    assert.strictEqual(nav.canGoBack(), true);
    assert.strictEqual(nav.canGoForward(), false);
  });

  test('N02: Full reverse history traversal via goBack()', () => {
    const nav = useNavigationStore.getState();

    // 1. Back to Library
    assert.strictEqual(nav.goBack(), true);
    assert.strictEqual(useNavigationStore.getState().current.tab, 'library');

    // 2. Back to Artist
    assert.strictEqual(nav.goBack(), true);
    assert.strictEqual(useNavigationStore.getState().current.id, 'UC_lazerhawk');

    // 3. Back to Release
    assert.strictEqual(nav.goBack(), true);
    assert.strictEqual(useNavigationStore.getState().current.id, 'MPREb_redline_01');

    // 4. Back to Search
    assert.strictEqual(nav.goBack(), true);
    assert.strictEqual(useNavigationStore.getState().current.tab, 'search');

    // 5. Back to Home
    assert.strictEqual(nav.goBack(), true);
    assert.strictEqual(useNavigationStore.getState().current.tab, 'home');

    // 6. At root: goBack returns false
    assert.strictEqual(nav.canGoBack(), false);
    assert.strictEqual(nav.goBack(), false);
    assert.strictEqual(nav.canGoForward(), true);
  });

  test('N03: Forward history traversal via goForward() and branch truncation', () => {
    const nav = useNavigationStore.getState();

    // Forward to Search
    assert.strictEqual(nav.goForward(), true);
    assert.strictEqual(useNavigationStore.getState().current.tab, 'search');

    // Forward to Release
    assert.strictEqual(nav.goForward(), true);
    assert.strictEqual(useNavigationStore.getState().current.id, 'MPREb_redline_01');

    // Branching: navigate to Explore breaks forward stack
    nav.navigateToTab('explore');
    assert.strictEqual(useNavigationStore.getState().current.tab, 'explore');
    assert.strictEqual(nav.canGoForward(), false);
  });

  test('N04: Duplicate navigation suppression avoids phantom history entries', () => {
    const nav = useNavigationStore.getState();
    useNavigationStore.setState({
      current: { type: 'tab', tab: 'home' },
      history: [],
      forwardStack: [],
    });

    nav.navigateToTab('home');
    nav.navigateToTab('home');
    nav.navigateToTab('home');

    assert.strictEqual(useNavigationStore.getState().history.length, 0);
  });

  test('N05: Rapid randomized view switching stress (100 transitions)', () => {
    const nav = useNavigationStore.getState();
    const targets = [
      { type: 'tab', tab: 'home' },
      { type: 'tab', tab: 'search' },
      { type: 'tab', tab: 'explore' },
      { type: 'tab', tab: 'library' },
      { type: 'release', id: 'alb_1', releaseType: 'album' },
      { type: 'artist', id: 'art_1' },
    ];

    for (let i = 0; i < 100; i++) {
      const idx = i % targets.length;
      nav.navigate(targets[idx]);
      const cur = useNavigationStore.getState().current;
      assert.ok(cur.type, 'Target type must exist');
    }

    assert.ok(useNavigationStore.getState().history.length > 0);
  });
});

describe('M4 Adversarial Challenge: LibraryStore & StorageService Atomic Concurrency', () => {
  let storage;

  before(async () => {
    storage = new StorageService(tempStorageDir);
    await useLibraryStore.getState().initLibrary(storage);
  });

  test('L01: Playlist creation with unique ID and empty track list', async () => {
    const lib = useLibraryStore.getState();
    const pl = await lib.createPlaylist('Synthwave Dreams', 'Best of 80s synth');

    assert.ok(pl.id.startsWith('pl_'));
    assert.strictEqual(pl.title, 'Synthwave Dreams');
    assert.strictEqual(pl.description, 'Best of 80s synth');
    assert.strictEqual(pl.songCount, 0);
    assert.strictEqual(pl.songIds.length, 0);

    const inState = useLibraryStore.getState().playlists.find((p) => p.id === pl.id);
    assert.ok(inState);
  });

  test('L02: Title boundary clamping (>100 characters clamped to 100 chars)', async () => {
    const lib = useLibraryStore.getState();
    const longTitle = 'A'.repeat(150);
    const pl = await lib.createPlaylist(longTitle);

    assert.strictEqual(pl.title.length, 100);
    assert.strictEqual(pl.title, 'A'.repeat(100));
  });

  test('L03: Empty and whitespace titles rejected with Error', async () => {
    const lib = useLibraryStore.getState();
    await assert.rejects(async () => {
      await lib.createPlaylist('');
    }, /cannot be empty/i);

    await assert.rejects(async () => {
      await lib.createPlaylist('   ');
    }, /cannot be empty/i);
  });

  test('L04: Add tracks to playlist updates in-memory state and disk file', async () => {
    const lib = useLibraryStore.getState();
    const pl = await lib.createPlaylist('Driving at Night');

    const tracksToAdd = ['song_a1', 'song_a2', 'song_a3', 'song_a4'];
    await lib.addTracksToPlaylist(pl.id, tracksToAdd);

    const inState = useLibraryStore.getState().playlists.find((p) => p.id === pl.id);
    assert.ok(inState);
    assert.strictEqual(inState.songIds.length, 4);
    assert.deepStrictEqual(inState.songIds, tracksToAdd);

    // Verify disk persistence directly from fresh StorageService instance
    const freshStorage = new StorageService(tempStorageDir);
    const onDisk = await freshStorage.getPlaylists();
    const diskPl = onDisk.find((p) => p.id === pl.id);
    assert.ok(diskPl);
    assert.strictEqual(diskPl.songIds.length, 4);
    assert.deepStrictEqual(diskPl.songIds, tracksToAdd);
  });

  test('L05: Remove track from playlist updates in-memory state and disk file', async () => {
    const lib = useLibraryStore.getState();
    const playlists = useLibraryStore.getState().playlists;
    const target = playlists.find((p) => p.title === 'Driving at Night');
    assert.ok(target);

    await lib.removeTrackFromPlaylist(target.id, 'song_a2');

    const inState = useLibraryStore.getState().playlists.find((p) => p.id === target.id);
    assert.strictEqual(inState.songIds.length, 3);
    assert.strictEqual(inState.songIds.includes('song_a2'), false);

    // Verify disk persistence
    const freshStorage = new StorageService(tempStorageDir);
    const onDisk = await freshStorage.getPlaylists();
    const diskPl = onDisk.find((p) => p.id === target.id);
    assert.ok(diskPl);
    assert.strictEqual(diskPl.songIds.length, 3);
    assert.strictEqual(diskPl.songIds.includes('song_a2'), false);
  });

  test('L06: Delete playlist removes from in-memory state and disk file', async () => {
    const lib = useLibraryStore.getState();
    const pl = await lib.createPlaylist('To Be Deleted');
    assert.ok(useLibraryStore.getState().playlists.some((p) => p.id === pl.id));

    const deleted = await lib.deletePlaylist(pl.id);
    assert.strictEqual(deleted, true);
    assert.strictEqual(useLibraryStore.getState().playlists.some((p) => p.id === pl.id), false);

    // Verify disk persistence
    const freshStorage = new StorageService(tempStorageDir);
    const onDisk = await freshStorage.getPlaylists();
    assert.strictEqual(onDisk.some((p) => p.id === pl.id), false);

    // Graceful handling of deleting non-existent ID
    const deletedAgain = await lib.deletePlaylist('pl_non_existent_id');
    assert.strictEqual(deletedAgain, false);
  });

  test('L07: High-speed concurrent playlist creation, mutation, and deletion under load', async () => {
    const lib = useLibraryStore.getState();

    // Create 5 playlists in sequence
    const createdPlaylists = [];
    for (let i = 0; i < 5; i++) {
      const pl = await lib.createPlaylist(`Stress Playlist ${i}`);
      createdPlaylists.push(pl);
    }

    // Concurrently add tracks to each playlist
    await Promise.all(
      createdPlaylists.map((pl, idx) =>
        lib.addTracksToPlaylist(pl.id, [`track_${idx}_1`, `track_${idx}_2`, `track_${idx}_3`])
      )
    );

    // Verify all 5 playlists have tracks on disk
    const freshStorage = new StorageService(tempStorageDir);
    const onDisk = await freshStorage.getPlaylists();
    for (const pl of createdPlaylists) {
      const found = onDisk.find((p) => p.id === pl.id);
      assert.ok(found, `Playlist ${pl.id} must exist on disk`);
      assert.strictEqual(found.songIds.length, 3);
    }

    // Delete 3 playlists
    for (let i = 0; i < 3; i++) {
      const deleted = await lib.deletePlaylist(createdPlaylists[i].id);
      assert.strictEqual(deleted, true);
    }

    // Verify remaining 2 playlists remain on disk via fresh instance with empty cache
    const freshStorageAfterDelete = new StorageService(tempStorageDir);
    const remainingDisk = await freshStorageAfterDelete.getPlaylists();
    assert.strictEqual(remainingDisk.some((p) => p.id === createdPlaylists[0].id), false);
    assert.strictEqual(remainingDisk.some((p) => p.id === createdPlaylists[1].id), false);
    assert.strictEqual(remainingDisk.some((p) => p.id === createdPlaylists[2].id), false);
    assert.strictEqual(remainingDisk.some((p) => p.id === createdPlaylists[3].id), true);
    assert.strictEqual(remainingDisk.some((p) => p.id === createdPlaylists[4].id), true);
  });
});
