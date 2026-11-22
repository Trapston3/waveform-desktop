import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

import {
  computeMetadataCacheKey,
  readMetadataDiskCache,
  writeMetadataDiskCache,
  scanAudioFolderWithMetadata,
  resolveArtProtocolResponse,
  loadLocalLibraryCache,
  saveLocalLibraryCache,
  incrementalScanLocalFolders,
  removeLocalLibraryFolder,
} from '../../electron/localMetadata.ts';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'waveform-meta-test-'));

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function encodeSyncsafeInt(value) {
  return Buffer.from([
    (value >> 21) & 0x7f,
    (value >> 14) & 0x7f,
    (value >> 7) & 0x7f,
    value & 0x7f,
  ]);
}

function makeId3v23Frame(id, payload) {
  const header = Buffer.alloc(10);
  header.write(id, 0, 4, 'ascii');
  header.writeUInt32BE(payload.length, 4);
  header.writeUInt16BE(0, 8);
  return Buffer.concat([header, payload]);
}

function makeTextFrame(id, text) {
  return makeId3v23Frame(id, Buffer.concat([Buffer.from([0x00]), Buffer.from(text, 'latin1')]));
}

function makeUsltFrame(lyrics) {
  const payload = Buffer.concat([
    Buffer.from([0x00]), // ISO-8859-1
    Buffer.from('eng', 'ascii'),
    Buffer.from([0x00]), // empty descriptor
    Buffer.from(lyrics, 'latin1'),
  ]);
  return makeId3v23Frame('USLT', payload);
}

function makeApicFrame(pngBytes) {
  const payload = Buffer.concat([
    Buffer.from([0x00]), // ISO-8859-1
    Buffer.from('image/png\0', 'ascii'),
    Buffer.from([0x03]), // Cover (front)
    Buffer.from([0x00]), // empty description
    pngBytes,
  ]);
  return makeId3v23Frame('APIC', payload);
}

// Minimal 1x1 transparent PNG
const MINIMAL_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex'
);

function buildTestMp3({ title, artist, albumArtist, album, trackNumber, year, lyrics, pngBytes, frameCount = 40 }) {
  const frames = [];
  if (title) frames.push(makeTextFrame('TIT2', title));
  if (artist) frames.push(makeTextFrame('TPE1', artist));
  if (albumArtist) frames.push(makeTextFrame('TPE2', albumArtist));
  if (album) frames.push(makeTextFrame('TALB', album));
  if (trackNumber) frames.push(makeTextFrame('TRCK', String(trackNumber)));
  if (year) frames.push(makeTextFrame('TYER', String(year)));
  if (lyrics) frames.push(makeUsltFrame(lyrics));
  if (pngBytes) frames.push(makeApicFrame(pngBytes));

  const tagBody = Buffer.concat(frames);
  const id3Header = Buffer.concat([
    Buffer.from('ID3', 'ascii'),
    Buffer.from([0x03, 0x00, 0x00]),
    encodeSyncsafeInt(tagBody.length),
  ]);

  // MPEG1 Layer III, 128kbps, 44100Hz, stereo, no padding => 417 bytes per frame
  const mpegFrame = Buffer.alloc(417, 0);
  mpegFrame[0] = 0xff;
  mpegFrame[1] = 0xfb;
  mpegFrame[2] = 0x90;
  mpegFrame[3] = 0x00;

  const audioFrames = Buffer.concat(Array.from({ length: frameCount }, () => mpegFrame));
  return Buffer.concat([id3Header, tagBody, audioFrames]);
}

test('computeMetadataCacheKey normalizes artist, title, and durationSec', () => {
  const k1 = computeMetadataCacheKey('  Daft Punk ', 'One More Time', 320.4);
  const k2 = computeMetadataCacheKey('daft punk', 'one more time', 320);
  const k3 = computeMetadataCacheKey('daft punk', 'one more time', 321);
  assert.match(k1, /^[0-9a-f]{40}$/);
  assert.equal(k1, k2);
  assert.notEqual(k1, k3);
});

test('readMetadataDiskCache and writeMetadataDiskCache handle miss, write, and merge', async () => {
  const userData = path.join(tmpRoot, 'userdata-cache-test');
  const key = computeMetadataCacheKey('Artist', 'Title', 120);

  const miss = await readMetadataDiskCache(userData, key);
  assert.equal(miss, null);

  await writeMetadataDiskCache(userData, key, { artworkUrl: 'https://example.com/art.jpg' });
  const merged = await writeMetadataDiskCache(userData, key, { lyrics: { lines: ['hello'] } });

  assert.equal(merged.artworkUrl, 'https://example.com/art.jpg');
  assert.deepEqual(merged.lyrics, { lines: ['hello'] });

  const readBack = await readMetadataDiskCache(userData, key);
  assert.deepEqual(readBack, merged);
});

test('scanAudioFolderWithMetadata extracts full ID3 tags, hashed artwork-cache, folder cover fallback, USLT lyrics, and resolves both art directories', async () => {
  const musicDir = path.join(tmpRoot, 'music');
  const folderCoverDir = path.join(musicDir, 'FolderAlbum');
  const userData = path.join(tmpRoot, 'userdata-scan-test');
  fs.mkdirSync(folderCoverDir, { recursive: true });

  const taggedMp3Path = path.join(musicDir, '01 - Ignored Filename.mp3');
  fs.writeFileSync(
    taggedMp3Path,
    buildTestMp3({
      title: 'Midnight Signal',
      artist: 'Neon Horizon',
      albumArtist: 'Neon Horizon',
      album: 'Night Drive',
      trackNumber: 3,
      year: '2024',
      lyrics: 'First line of lyrics\nSecond line of lyrics',
      pngBytes: MINIMAL_PNG,
      frameCount: 40,
    })
  );

  const artlessMp3Path = path.join(musicDir, '02_Solaris - Echoes.mp3');
  fs.writeFileSync(
    artlessMp3Path,
    buildTestMp3({
      title: 'Echoes',
      artist: 'Solaris',
      album: 'Orbit',
      frameCount: 40,
    })
  );

  // Subfolder with folder-level cover.png fallback
  fs.writeFileSync(path.join(folderCoverDir, 'cover.png'), MINIMAL_PNG);
  fs.writeFileSync(
    path.join(folderCoverDir, '01_Track.mp3'),
    buildTestMp3({
      title: 'Folder Cover Track',
      artist: 'Cover Artist',
      album: 'Folder Album',
      trackNumber: 1,
      frameCount: 40,
    })
  );

  const firstScan = await scanAudioFolderWithMetadata(musicDir, userData);
  assert.equal(firstScan.length, 3);

  const taggedTrack = firstScan.find((s) => s.title === 'Midnight Signal');
  assert.ok(taggedTrack, 'taggedTrack should be found');
  assert.match(taggedTrack.videoId, /^local_[0-9a-f]{20}$/);
  assert.match(taggedTrack.albumId, /^local_alb_[0-9a-f]{14}$/);
  assert.match(taggedTrack.artistId, /^local_art_[0-9a-f]{14}$/);
  assert.equal(taggedTrack.artist, 'Neon Horizon');
  assert.equal(taggedTrack.albumArtist, 'Neon Horizon');
  assert.equal(taggedTrack.albumName, 'Night Drive');
  assert.equal(taggedTrack.trackNumber, 3);
  assert.equal(taggedTrack.year, '2024');
  assert.equal(taggedTrack.source, 'local');
  assert.equal(taggedTrack.isLocal, true);
  assert.equal(taggedTrack.playbackSourceType, 'LOCAL');
  assert.ok(typeof taggedTrack.mtimeMs === 'number' && taggedTrack.mtimeMs > 0);
  assert.ok(typeof taggedTrack.size === 'number' && taggedTrack.size > 0);
  assert.ok(taggedTrack.durationSec >= 1, `expected durationSec >= 1, got ${taggedTrack.durationSec}`);
  assert.match(taggedTrack.durationText, /^\d+:\d{2}$/);
  assert.equal(taggedTrack.lyrics, 'First line of lyrics\nSecond line of lyrics');
  assert.match(taggedTrack.artworkHash, /^[0-9a-f]{40}$/);
  assert.equal(
    taggedTrack.thumbnailUrl,
    'waveform-local://art?key=' + encodeURIComponent(taggedTrack.artworkHash)
  );

  const artFile = path.join(userData, 'artwork-cache', `${taggedTrack.artworkHash}.png`);
  assert.ok(fs.existsSync(artFile), 'embedded PNG art should be written to artwork-cache/<hash>.png');

  // Verify folder-level cover.png fallback uses same deduplicated hash
  const folderTrack = firstScan.find((s) => s.title === 'Folder Cover Track');
  assert.ok(folderTrack);
  assert.equal(folderTrack.artworkHash, taggedTrack.artworkHash);
  assert.equal(folderTrack.thumbnailUrl, taggedTrack.thumbnailUrl);

  // Verify resolveArtProtocolResponse resolves from artwork-cache/
  const artRes = await resolveArtProtocolResponse(
    new URL(`waveform-local://art?key=${taggedTrack.artworkHash}`),
    userData
  );
  assert.equal(artRes.status, 200);
  assert.equal(artRes.headers.get('Content-Type'), 'image/png');
  assert.equal(artRes.headers.get('Access-Control-Allow-Origin'), '*');

  // Verify resolveArtProtocolResponse also resolves legacy metadata-cache/art/
  const legacyDir = path.join(userData, 'metadata-cache', 'art');
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'legacy_art_key.png'), MINIMAL_PNG);
  const legacyRes = await resolveArtProtocolResponse(
    new URL('waveform-local://art?key=legacy_art_key'),
    userData
  );
  assert.equal(legacyRes.status, 200);
  assert.equal(legacyRes.headers.get('Content-Type'), 'image/png');

  const missRes = await resolveArtProtocolResponse(
    new URL('waveform-local://art?key=nonexistentkey'),
    userData
  );
  assert.equal(missRes.status, 404);
  assert.equal(missRes.headers.get('Access-Control-Allow-Origin'), '*');

  // Populate disk cache for the artless track and verify rescan picks it up
  const artlessTrack = firstScan.find((s) => s.title === 'Echoes');
  assert.ok(artlessTrack);
  assert.equal(artlessTrack.thumbnailUrl, null);

  await writeMetadataDiskCache(userData, artlessTrack.metadataCacheKey, {
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/test/600x600bb.jpg',
  });

  const secondScan = await scanAudioFolderWithMetadata(musicDir, userData);
  const rescannedArtless = secondScan.find((s) => s.title === 'Echoes');
  assert.equal(
    rescannedArtless.thumbnailUrl,
    'https://is1-ssl.mzstatic.com/image/thumb/test/600x600bb.jpg'
  );
});

test('local library disk cache: save/load, incrementalScanLocalFolders (skip unchanged, re-parse modified, prune deleted), and removeLocalLibraryFolder', async () => {
  const userData = path.join(tmpRoot, 'userdata-incremental');
  const folderA = path.join(tmpRoot, 'inc-folder-a');
  const folderB = path.join(tmpRoot, 'inc-folder-b');
  fs.mkdirSync(folderA, { recursive: true });
  fs.mkdirSync(folderB, { recursive: true });

  // Empty cache read
  const empty = await loadLocalLibraryCache(userData);
  assert.equal(empty.version, 1);
  assert.deepEqual(empty.folders, []);
  assert.deepEqual(empty.tracks, []);

  const fileA1 = path.join(folderA, 'track1.mp3');
  const fileA2 = path.join(folderA, 'track2.mp3');
  const fileB1 = path.join(folderB, 'track3.mp3');

  fs.writeFileSync(fileA1, buildTestMp3({ title: 'Alpha', artist: 'Band A', album: 'Alb A', trackNumber: 1 }));
  fs.writeFileSync(fileA2, buildTestMp3({ title: 'Beta', artist: 'Band A', album: 'Alb A', trackNumber: 2 }));
  fs.writeFileSync(fileB1, buildTestMp3({ title: 'Gamma', artist: 'Band B', album: 'Alb B', trackNumber: 1 }));

  // 1. Initial incremental scan adds all 3 tracks across 2 folders
  const scan1 = await incrementalScanLocalFolders(userData, [folderA, folderB]);
  assert.equal(scan1.added, 3);
  assert.equal(scan1.updated, 0);
  assert.equal(scan1.removed, 0);
  assert.equal(scan1.folders.length, 2);
  assert.equal(scan1.tracks.length, 3);

  // Verify persisted JSON exists and loads cleanly
  const loaded = await loadLocalLibraryCache(userData);
  assert.equal(loaded.tracks.length, 3);
  assert.equal(loaded.folders.length, 2);

  // 2. Unchanged rescan skips re-parsing everything
  const scan2 = await incrementalScanLocalFolders(userData);
  assert.equal(scan2.added, 0);
  assert.equal(scan2.updated, 0);
  assert.equal(scan2.removed, 0);
  assert.equal(scan2.tracks.length, 3);

  // 3. Modify fileA1 (new title + different frameCount -> different size) and delete fileA2
  fs.writeFileSync(
    fileA1,
    buildTestMp3({ title: 'Alpha Remastered', artist: 'Band A', album: 'Alb A', trackNumber: 1, frameCount: 60 })
  );
  fs.unlinkSync(fileA2);

  const scan3 = await incrementalScanLocalFolders(userData);
  assert.equal(scan3.added, 0);
  assert.equal(scan3.updated, 1);
  assert.equal(scan3.removed, 1);
  assert.equal(scan3.tracks.length, 2);
  assert.ok(scan3.tracks.some((t) => t.title === 'Alpha Remastered'));
  assert.ok(!scan3.tracks.some((t) => t.title === 'Beta'));

  // 4. removeLocalLibraryFolder removes folderA and its tracks, keeping folderB
  const afterRemove = await removeLocalLibraryFolder(userData, folderA);
  assert.equal(afterRemove.folders.length, 1);
  assert.equal(afterRemove.tracks.length, 1);
  assert.equal(afterRemove.tracks[0].title, 'Gamma');

  // 5. saveLocalLibraryCache strips oversized base64 data URIs
  const hugeDataUri = 'data:image/png;base64,' + 'A'.repeat(4096);
  const savedSanitized = await saveLocalLibraryCache(userData, {
    folders: [folderB],
    tracks: [{ ...afterRemove.tracks[0], thumbnailUrl: hugeDataUri, artworkUrl: hugeDataUri }],
  });
  assert.equal(savedSanitized.tracks[0].thumbnailUrl, null);
});

test('libraryStore hydrates local cache, merges multiple folders, patches tracks, and provides unified selectors', async () => {
  const bundlePath = path.join(tmpRoot, 'libraryStore.bundle.mjs');
  await esbuild.build({
    entryPoints: ['src/state/libraryStore.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: bundlePath,
  });
  const {
    useLibraryStore,
    selectUnifiedSongs,
    selectUnifiedAlbums,
    selectUnifiedArtists,
    DEFAULT_LOCAL_ALBUM_ART_SVG,
  } = await import(pathToFileURL(bundlePath).href);

  const prevWindow = globalThis.window;
  let savedPayload = null;
  let incrementalCalled = false;

  try {
    const cachedTrack = {
      videoId: 'local_cached_a1',
      title: 'Cached Track',
      artist: 'Local Band',
      album: 'Disk Album',
      albumName: 'Disk Album',
      albumArtist: 'Local Band',
      trackNumber: 2,
      folderPath: 'C:\\MusicA',
      localFilePath: 'C:\\MusicA\\track2.flac',
      source: 'local',
      isLocal: true,
      playbackSourceType: 'LOCAL',
      totalPlayTimeMs: 200000,
      playCount: 0,
      liked: false,
      isExplicit: false,
      artists: [{ id: 'local_art_1', name: 'Local Band' }],
      artistIds: ['local_art_1'],
    };

    globalThis.window = {
      electronAPI: {
        loadLocalLibraryCache: async () => ({
          version: 1,
          folders: ['C:\\MusicA'],
          tracks: [cachedTrack],
          updatedAt: Date.now(),
        }),
        incrementalScanLocalFolders: async () => {
          incrementalCalled = true;
          return {
            folders: ['C:\\MusicA'],
            tracks: [cachedTrack],
            added: 0,
            updated: 0,
            removed: 0,
          };
        },
        scanLocalFolder: async (folder) => [
          {
            videoId: 'local_scanned_b1',
            title: 'Second Folder Track',
            artist: 'Local Band',
            album: 'Disk Album',
            albumName: 'Disk Album',
            albumArtist: 'Local Band',
            trackNumber: 1,
            folderPath: folder,
            localFilePath: `${folder}\\track1.flac`,
            source: 'local',
            isLocal: true,
            playbackSourceType: 'LOCAL',
            totalPlayTimeMs: 180000,
            playCount: 0,
            liked: false,
            isExplicit: false,
            artists: [{ id: 'local_art_1', name: 'Local Band' }],
            artistIds: ['local_art_1'],
          },
        ],
        saveLocalLibraryCache: async (payload) => {
          savedPayload = payload;
          return { version: 1, ...payload, updatedAt: Date.now() };
        },
        removeLocalLibraryFolder: async (folder) => {
          const remaining = useLibraryStore.getState().localSongs.filter((s) => s.folderPath !== folder);
          const remainingFolders = useLibraryStore.getState().localFolders.filter((f) => f !== folder);
          return { version: 1, folders: remainingFolders, tracks: remaining, updatedAt: Date.now() };
        },
      },
    };

    useLibraryStore.setState({ isLoaded: false, localSongs: [], localFolders: [], favorites: [] });
    const mockStorage = {
      getPlaylists: async () => [],
      getFavorites: async () => [],
      getListeningHistory: async () => [],
      getMonthlyListeningHistory: async () => null,
      getSettings: async () => ({ 'storage.localFolders': [] }),
      updateSettings: async () => {},
    };

    await useLibraryStore.getState().initLibrary(mockStorage);
    assert.equal(useLibraryStore.getState().localSongs.length, 1);
    assert.deepEqual(useLibraryStore.getState().localFolders, ['C:\\MusicA']);
    assert.equal(incrementalCalled, true);

    // Scan a second folder using electronAPI.scanLocalFolder (scanner = null) -> must MERGE, not overwrite
    await useLibraryStore.getState().startLocalMediaScan(null, 'C:\\MusicB');
    const afterMerge = useLibraryStore.getState();
    assert.equal(afterMerge.localSongs.length, 2, 'must merge Folder B tracks with Folder A tracks');
    assert.equal(afterMerge.localFolders.length, 2);
    assert.ok(savedPayload && savedPayload.tracks.length === 2);

    // Patch track artwork and verify persistence
    await useLibraryStore.getState().upsertLocalTrackPatch('local_cached_a1', {
      thumbnailUrl: 'waveform-local://art?key=abc123',
      artworkUrl: 'waveform-local://art?key=abc123',
    });
    const patched = useLibraryStore.getState().localSongs.find((s) => s.videoId === 'local_cached_a1');
    assert.equal(patched.thumbnailUrl, 'waveform-local://art?key=abc123');
    assert.equal(savedPayload.tracks.find((s) => s.videoId === 'local_cached_a1').thumbnailUrl, 'waveform-local://art?key=abc123');

    // Test unified selectors: favorites + localSongs merged & album tracks sorted by trackNumber
    const onlineFav = {
      videoId: 'yt_online_1',
      title: 'Online Hit',
      artist: 'Web Artist',
      album: 'Web Album',
      albumName: 'Web Album',
      liked: true,
      totalPlayTimeMs: 210000,
      playCount: 3,
      isExplicit: false,
      artists: [{ id: 'yt_art_1', name: 'Web Artist' }],
      artistIds: ['yt_art_1'],
    };
    const unifiedSongs = selectUnifiedSongs(
      [onlineFav, { ...cachedTrack, liked: true }],
      useLibraryStore.getState().localSongs
    );
    assert.equal(unifiedSongs.length, 3, 'duplicate favorited local track should deduplicate');
    assert.equal(unifiedSongs.find((s) => s.videoId === 'local_cached_a1').liked, true);

    const unifiedAlbums = selectUnifiedAlbums(unifiedSongs);
    assert.equal(unifiedAlbums.length, 2);
    const diskAlbum = unifiedAlbums.find((a) => a.title === 'Disk Album');
    assert.ok(diskAlbum);
    assert.equal(diskAlbum.isLocal, true);
    assert.equal(diskAlbum.songs.length, 2);
    assert.equal(diskAlbum.songs[0].trackNumber, 1);
    assert.equal(diskAlbum.songs[1].trackNumber, 2);
    assert.equal(diskAlbum.coverUrl, 'waveform-local://art?key=abc123');

    const webAlbum = unifiedAlbums.find((a) => a.title === 'Web Album');
    assert.equal(webAlbum.coverUrl, DEFAULT_LOCAL_ALBUM_ART_SVG);

    const unifiedArtists = selectUnifiedArtists(unifiedSongs);
    assert.equal(unifiedArtists.length, 2);
    assert.equal(unifiedArtists.find((a) => a.name === 'Local Band').trackCount, 2);

    // Remove Folder A and verify Folder B remains
    await useLibraryStore.getState().removeLocalFolder('C:\\MusicA');
    assert.equal(useLibraryStore.getState().localSongs.length, 1);
    assert.equal(useLibraryStore.getState().localSongs[0].videoId, 'local_scanned_b1');
  } finally {
    if (prevWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
  }
});

test('lyricsStore.fetchLyricsForTrack parses embedded plain/LRC lyrics and checks disk cache before network', async () => {
  const bundlePath = path.join(tmpRoot, 'lyricsStore.bundle.mjs');
  await esbuild.build({
    entryPoints: ['src/state/lyricsStore.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: bundlePath,
  });
  const { useLyricsStore } = await import(pathToFileURL(bundlePath).href);

  const prevWindow = globalThis.window;
  try {
    useLyricsStore.getState().clearLyrics();

    // 1. Embedded plain (UNSYNCED) lyrics
    await useLyricsStore.getState().fetchLyricsForTrack({
      videoId: 'local_plain_1',
      title: 'Plain Track',
      artist: 'Artist A',
      artists: [{ id: null, name: 'Artist A' }],
      artistIds: [],
      totalPlayTimeMs: 0,
      playCount: 0,
      liked: false,
      isExplicit: false,
      lyrics: 'Line one\nLine two',
    });
    let state = useLyricsStore.getState();
    assert.equal(state.lyricsData?.type, 'UNSYNCED');
    assert.equal(state.lyricsData?.provider, 'Embedded');
    assert.equal(state.lyricsData?.isSynced, false);
    assert.equal(state.lyricsData?.lines.length, 2);
    assert.equal(state.lyricsData?.lines[0].text, 'Line one');

    // 2. Embedded LRC (LINE_SYNCED) lyrics
    await useLyricsStore.getState().fetchLyricsForTrack({
      videoId: 'local_lrc_1',
      title: 'Synced Track',
      artist: 'Artist B',
      artists: [{ id: null, name: 'Artist B' }],
      artistIds: [],
      totalPlayTimeMs: 0,
      playCount: 0,
      liked: false,
      isExplicit: false,
      lyrics: '[00:01.00] Hello world\n[00:03.50] Next line',
    });
    state = useLyricsStore.getState();
    assert.equal(state.lyricsData?.type, 'LINE_SYNCED');
    assert.equal(state.lyricsData?.provider, 'Embedded');
    assert.equal(state.lyricsData?.lines.length, 2);
    assert.equal(state.lyricsData?.lines[0].startTimeMs, 1000);

    // 3. Disk cache hit before network
    const cachedLyricsPayload = {
      type: 'LINE_SYNCED',
      provider: 'lrclib',
      lines: [{ lineIndex: 0, startTimeMs: 500, endTimeMs: 2500, text: 'Cached line' }],
    };
    let cacheRequestedWith = null;
    globalThis.window = {
      electronAPI: {
        getMetadataCache: async (arg) => {
          cacheRequestedWith = arg;
          return { lyrics: cachedLyricsPayload };
        },
      },
    };

    await useLyricsStore.getState().fetchLyricsForTrack({
      videoId: 'local_cached_1',
      title: 'Cached Song',
      artist: 'Cached Artist',
      durationSec: 185,
      artists: [{ id: null, name: 'Cached Artist' }],
      artistIds: [],
      totalPlayTimeMs: 185000,
      playCount: 0,
      liked: false,
      isExplicit: false,
      lyrics: null,
    });
    state = useLyricsStore.getState();
    assert.deepEqual(cacheRequestedWith, {
      artist: 'Cached Artist',
      title: 'Cached Song',
      durationSec: 185,
    });
    assert.deepEqual(state.lyricsData, cachedLyricsPayload);
  } finally {
    if (prevWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
    useLyricsStore.getState().clearLyrics();
  }
});
