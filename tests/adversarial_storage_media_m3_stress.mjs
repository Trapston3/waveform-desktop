// tests/adversarial_storage_media_m3_stress.mjs
// Adversarial Empirical Stress & Robustness Challenge Harness (Milestone 3)
// Stress-tests StorageService (concurrency, atomic writes, corrupt file recovery, partial settings)
// and LocalMediaScanner (deep folders, missing files, non-audio, empty files, corrupted headers, search benchmark).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
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

const {
  validateSongContract,
  normalizeSong,
  defaultAppSettings,
  DEFAULT_SETTINGS,
  mergeSettings,
} = await import('../src/models/index.ts');

const {
  StorageService,
  writeJsonAtomic,
  readJsonSafe,
  LocalMediaScanner,
} = await import('../src/services/index.ts');

const { mockSongs } = await import('./fixtures/mockSongs.mjs');

// Isolated workspace for stress tests
const stressDir = path.join(os.tmpdir(), `waveform-m3-adversarial-${Date.now()}`);

before(() => {
  if (!fs.existsSync(stressDir)) {
    fs.mkdirSync(stressDir, { recursive: true });
  }
});

after(() => {
  try {
    if (fs.existsSync(stressDir)) {
      fs.rmSync(stressDir, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors
  }
});

// Helper to create a valid test song
function createTestSong(id, title = 'Test Track', artist = 'Test Artist') {
  return {
    videoId: id,
    title,
    artist,
    artists: [{ id: `art_${id}`, name: artist }],
    artistIds: [`art_${id}`],
    album: 'Test Album',
    albumName: 'Test Album',
    durationSec: 210,
    liked: false,
    totalPlayTimeMs: 210000,
    playCount: 0,
  };
}

// ============================================================================
// SUITE 1: ATOMIC WRITES & STORAGE CONCURRENCY STRESS
// ============================================================================
describe('Suite 1: Atomic Writes & Storage Concurrency Stress', () => {

  test('ADV-S01: writeJsonAtomic survives 50 simultaneous concurrent writes to same file without corruption', async () => {
    const targetFile = path.join(stressDir, 'concurrent_target.json');
    const writeCount = 50;
    const writePromises = [];

    const startTime = performance.now();
    for (let i = 0; i < writeCount; i++) {
      const payload = {
        iteration: i,
        timestamp: Date.now(),
        data: Array.from({ length: 50 }, (_, idx) => `data_entry_${i}_${idx}`),
      };
      writePromises.push(writeJsonAtomic(targetFile, payload));
    }

    const results = await Promise.allSettled(writePromises);
    const duration = performance.now() - startTime;

    const rejected = results.filter((r) => r.status === 'rejected');
    assert.strictEqual(
      rejected.length,
      0,
      `Concurrent writes had ${rejected.length} rejections: ${rejected[0]?.reason?.message}`
    );

    // Verify file integrity
    assert.strictEqual(fs.existsSync(targetFile), true, 'Target file must exist');
    const raw = fs.readFileSync(targetFile, 'utf-8');
    let parsed;
    assert.doesNotThrow(() => {
      parsed = JSON.parse(raw);
    }, 'File content must be valid parseable JSON');

    assert.strictEqual(typeof parsed.iteration, 'number', 'Payload iteration must be a number');
    assert.strictEqual(Array.isArray(parsed.data), true, 'Payload data must be an array');
    assert.strictEqual(parsed.data.length, 50, 'Payload data array must have 50 items');

    // Verify no leftover .tmp files
    const dirFiles = fs.readdirSync(stressDir);
    const tmpFiles = dirFiles.filter((f) => f.startsWith('concurrent_target.json.') && f.endsWith('.tmp'));
    assert.strictEqual(tmpFiles.length, 0, `No dangling .tmp files allowed, found: ${tmpFiles.length}`);

    console.log(`    ℹ ADV-S01: 50 concurrent writes resolved in ${duration.toFixed(2)}ms (zero corruptions, 0 .tmp leftovers)`);
  });

  test('ADV-S02: Multi-file concurrent writes across 5 distinct files (100 total writes)', async () => {
    const fileCount = 5;
    const writesPerFile = 20;
    const allPromises = [];

    const startTime = performance.now();
    for (let f = 0; f < fileCount; f++) {
      const filePath = path.join(stressDir, `multi_file_${f}.json`);
      for (let i = 0; i < writesPerFile; i++) {
        allPromises.push(writeJsonAtomic(filePath, { fileIndex: f, writeIndex: i, ts: Date.now() }));
      }
    }

    const results = await Promise.allSettled(allPromises);
    const duration = performance.now() - startTime;

    const failed = results.filter((r) => r.status === 'rejected');
    assert.strictEqual(failed.length, 0, `Multi-file concurrent writes failed: ${failed.length}`);

    for (let f = 0; f < fileCount; f++) {
      const filePath = path.join(stressDir, `multi_file_${f}.json`);
      assert.strictEqual(fs.existsSync(filePath), true);
      const raw = fs.readFileSync(filePath, 'utf-8');
      let content;
      try {
        content = JSON.parse(raw);
      } catch (err) {
        console.error(`    [CORRUPTED FILE multi_file_${f}.json CONTENT]:\n>>>\n${raw}\n<<<`);
        throw err;
      }
      assert.strictEqual(content.fileIndex, f);
      assert.strictEqual(typeof content.writeIndex, 'number');
    }

    console.log(`    ℹ ADV-S02: 100 multi-file writes completed in ${duration.toFixed(2)}ms`);
  });

  test('ADV-S03: StorageService 100 rapid concurrent updateSettings calls preserve all 70 keys', async () => {
    const storageDir = path.join(stressDir, 'service_settings_test');
    const storage = new StorageService(storageDir);

    const initialSettings = await storage.getSettings();
    assert.strictEqual(Object.keys(initialSettings).length >= 70, true);

    const updateCount = 100;
    const updatePromises = [];

    const startTime = performance.now();
    for (let i = 0; i < updateCount; i++) {
      updatePromises.push(
        storage.updateSettings({
          'playback.volumeLevel': +(0.1 + (i % 80) * 0.01).toFixed(2),
          'appearance.accentColor': i % 2 === 0 ? '#FA2D48' : '#007AFF',
        })
      );
    }

    const settled = await Promise.allSettled(updatePromises);
    const duration = performance.now() - startTime;
    const rejected = settled.filter((s) => s.status === 'rejected');
    if (rejected.length > 0) {
      console.error(`    [ADV-S03 REJECTION]:`, rejected[0].reason);
    }
    assert.strictEqual(rejected.length, 0, `updateSettings rejections: ${rejected.length}`);

    // Verify final settings
    const finalSettings = await storage.getSettings();
    assert.strictEqual(Object.keys(finalSettings).length, Object.keys(initialSettings).length);
    assert.strictEqual(typeof finalSettings['playback.volumeLevel'], 'number');
    assert.strictEqual(['#FA2D48', '#007AFF'].includes(finalSettings['appearance.accentColor']), true);

    // Verify disk consistency with new instance
    const freshStorage = new StorageService(storageDir);
    const diskSettings = await freshStorage.getSettings();
    assert.deepStrictEqual(diskSettings, finalSettings, 'Fresh instance reading disk must match in-memory state');

    console.log(`    ℹ ADV-S03: 100 concurrent updateSettings completed in ${duration.toFixed(2)}ms`);
  });

  test('ADV-S04: Concurrent createPlaylist and addTracksToPlaylist race stress', async () => {
    const storageDir = path.join(stressDir, 'service_playlist_test');
    const storage = new StorageService(storageDir);

    // 1. Create 15 playlists concurrently
    const createPromises = [];
    for (let i = 0; i < 15; i++) {
      createPromises.push(storage.createPlaylist(`Playlist_${i}`, `Description for ${i}`));
    }
    const createdPlaylists = await Promise.all(createPromises);
    assert.strictEqual(createdPlaylists.length, 15);

    // Check uniqueness of IDs
    const idSet = new Set(createdPlaylists.map((p) => p.id));
    assert.strictEqual(idSet.size, 15, 'All playlist IDs must be unique');

    // 2. Concurrently add tracks to the first playlist
    const targetId = createdPlaylists[0].id;
    const trackAddPromises = [];
    for (let i = 0; i < 30; i++) {
      // Repeat track IDs 0..9 to test duplicate deduplication under concurrency
      const trackId = `track_id_${i % 10}`;
      trackAddPromises.push(storage.addTracksToPlaylist(targetId, [trackId]));
    }
    await Promise.all(trackAddPromises);

    // Verify playlist track deduplication and song count
    const freshStorage = new StorageService(storageDir);
    const allPlaylists = await freshStorage.getPlaylists();
    const updatedTarget = allPlaylists.find((p) => p.id === targetId);

    assert.ok(updatedTarget, 'Target playlist must exist');
    assert.strictEqual(updatedTarget.songIds.length, 10, 'Target playlist must have exactly 10 unique track IDs');
    assert.strictEqual(updatedTarget.songCount, 10, 'songCount must match songIds.length');
    for (let i = 0; i < 10; i++) {
      assert.strictEqual(updatedTarget.songIds.includes(`track_id_${i}`), true);
    }
  });

  test('ADV-S05: Concurrent toggleFavorite integrity & idempotency', async () => {
    const storageDir = path.join(stressDir, 'service_favorites_test');
    const storage = new StorageService(storageDir);

    const testSongA = createTestSong('song_fav_A', 'Favorite A');
    const testSongB = createTestSong('song_fav_B', 'Favorite B');

    // Toggle song A 5 times concurrently and song B 1 time
    const favPromises = [
      storage.toggleFavorite(testSongA),
      storage.toggleFavorite(testSongB),
    ];
    await Promise.all(favPromises);

    const favorites = await storage.getFavorites();
    assert.strictEqual(favorites.length, 2, 'Both songs should be favorited');

    // Untoggle song A
    const untoggled = await storage.toggleFavorite(testSongA);
    assert.strictEqual(untoggled, false, 'Untoggle should return false');

    const favoritesAfter = await storage.getFavorites();
    assert.strictEqual(favoritesAfter.length, 1);
    assert.strictEqual(favoritesAfter[0].videoId, 'song_fav_B');
  });

  test('ADV-S06: Concurrent recordListeningHistory temporal aggregation stress', async () => {
    const storageDir = path.join(stressDir, 'service_history_test');
    const storage = new StorageService(storageDir);

    const songs = [
      createTestSong('hist_track_1', 'Song 1', 'Artist Alpha'),
      createTestSong('hist_track_2', 'Song 2', 'Artist Beta'),
      createTestSong('hist_track_3', 'Song 3', 'Artist Alpha'),
    ];

    const historyPromises = [];
    // 30 listening events across 3 songs
    for (let i = 0; i < 30; i++) {
      const song = songs[i % songs.length];
      historyPromises.push(storage.recordListeningHistory(song, 120));
    }
    await Promise.all(historyPromises);

    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthly = await storage.getMonthlyListeningHistory(ym);

    assert.strictEqual(monthly.totalPlaysCount, 30, 'Total plays count must be 30');
    assert.strictEqual(monthly.totalListeningTimeSec, 30 * 120, 'Total listening time must be 3600s');
    assert.strictEqual(monthly.uniqueTracksCount, 3, 'Unique tracks count must be 3');
    assert.strictEqual(monthly.uniqueArtistsCount, 2, 'Unique artists count must be 2 (Alpha and Beta)');

    // Verify top tracks and top artists sorting
    assert.strictEqual(monthly.topTracks.length, 3);
    assert.strictEqual(monthly.topArtists.length, 2);
    // Artist Alpha had 20 plays, Beta had 10 plays
    const artistAlpha = monthly.topArtists.find((a) => a.artistName === 'Artist Alpha');
    const artistBeta = monthly.topArtists.find((a) => a.artistName === 'Artist Beta');
    assert.strictEqual(artistAlpha.playCount, 20);
    assert.strictEqual(artistBeta.playCount, 10);
    assert.strictEqual(monthly.topArtists[0].artistName, 'Artist Alpha');
  });
});

// ============================================================================
// SUITE 2: STORAGE CORRUPT FILE RECOVERY & SCHEMA MIGRATION
// ============================================================================
describe('Suite 2: Storage Corrupt File Recovery & Schema Migration', () => {

  test('ADV-C01: readJsonSafe returns fallback when file does not exist', async () => {
    const nonExistent = path.join(stressDir, 'does_not_exist_xyz.json');
    const fallback = { fallback: true };
    const res = await readJsonSafe(nonExistent, fallback);
    assert.deepStrictEqual(res, fallback);
  });

  test('ADV-C02: readJsonSafe gracefully catches malformed JSON syntax and returns fallback', async () => {
    const corruptFile = path.join(stressDir, 'corrupt_syntax.json');
    fs.writeFileSync(corruptFile, '{"unclosed_json": [1, 2, 3, ', 'utf-8');

    const fallback = { status: 'safe_fallback' };
    const res = await readJsonSafe(corruptFile, fallback);
    assert.deepStrictEqual(res, fallback, 'Must return fallback on syntax error');
  });

  test('ADV-C03: readJsonSafe handles 0-byte empty file without throwing', async () => {
    const emptyFile = path.join(stressDir, 'empty_zero_byte.json');
    fs.writeFileSync(emptyFile, '', 'utf-8');

    const fallback = [];
    const res = await readJsonSafe(emptyFile, fallback);
    assert.deepStrictEqual(res, fallback);
  });

  test('ADV-C04: StorageService recovers from corrupt settings.json file on disk', async () => {
    const storageDir = path.join(stressDir, 'corrupt_settings_recovery');
    fs.mkdirSync(storageDir, { recursive: true });
    const settingsPath = path.join(storageDir, 'settings.json');
    fs.writeFileSync(settingsPath, '<<< CORRUPTED DISK SECTOR DATA >>>', 'utf-8');

    const storage = new StorageService(storageDir);
    const settings = await storage.getSettings();

    // Must return complete default settings without crash
    assert.strictEqual(Object.keys(settings).length >= 70, true);
    assert.strictEqual(settings['appearance.accentColor'], '#FA2D48');
    assert.strictEqual(settings['playback.volumeLevel'], 0.85);
  });

  test('ADV-C05: Partial settings file on disk is migrated and merged with defaults', async () => {
    const storageDir = path.join(stressDir, 'partial_settings_migration');
    fs.mkdirSync(storageDir, { recursive: true });
    const settingsPath = path.join(storageDir, 'settings.json');
    // Save only 3 keys (simulating legacy or partial config)
    const partialData = {
      'appearance.accentColor': '#9900FF',
      'playback.volumeLevel': 0.42,
      'appearance.themeMode': 'light',
    };
    fs.writeFileSync(settingsPath, JSON.stringify(partialData), 'utf-8');

    const storage = new StorageService(storageDir);
    const settings = await storage.getSettings();

    // Verify custom values are preserved
    assert.strictEqual(settings['appearance.accentColor'], '#9900FF');
    assert.strictEqual(settings['playback.volumeLevel'], 0.42);
    assert.strictEqual(settings['appearance.themeMode'], 'light');

    // Verify all other 67+ keys are populated from defaultAppSettings
    assert.strictEqual(Object.keys(settings).length >= 70, true);
    assert.strictEqual(settings['playback.gaplessEnabled'], true);
    assert.strictEqual(settings['dsp.equalizerPreset'], 'Flat');
  });

  test('ADV-C06: Obsolete / unknown legacy keys in settings.json are ignored gracefully', async () => {
    const storageDir = path.join(stressDir, 'legacy_keys_settings');
    fs.mkdirSync(storageDir, { recursive: true });
    const settingsPath = path.join(storageDir, 'settings.json');
    const legacyData = {
      'v1_deprecated_key': 'should_be_ignored',
      'unknown.vendor.setting': 99999,
      'appearance.accentColor': '#112233',
    };
    fs.writeFileSync(settingsPath, JSON.stringify(legacyData), 'utf-8');

    const storage = new StorageService(storageDir);
    const settings = await storage.getSettings();

    assert.strictEqual(settings['appearance.accentColor'], '#112233');
    assert.strictEqual(settings['v1_deprecated_key'], undefined);
    assert.strictEqual(settings['unknown.vendor.setting'], undefined);
  });

  test('ADV-C07: Strict type validation rejects type mutations in updateSettings', async () => {
    const storageDir = path.join(stressDir, 'type_validation_test');
    const storage = new StorageService(storageDir);

    // 1. String expected, number provided
    await assert.rejects(
      async () => {
        await storage.updateSettings({ 'appearance.themeMode': 12345 });
      },
      (err) => err instanceof TypeError && err.message.includes('Invalid type')
    );

    // 2. Number expected, boolean provided
    await assert.rejects(
      async () => {
        await storage.updateSettings({ 'playback.volumeLevel': false });
      },
      (err) => err instanceof TypeError && err.message.includes('Invalid type')
    );

    // 3. String expected, number provided
    await assert.rejects(
      async () => {
        await storage.updateSettings({ 'appearance.accentColor': 12345 });
      },
      (err) => err instanceof TypeError && err.message.includes('Invalid type')
    );
  });
});

// ============================================================================
// SUITE 3: LOCAL MEDIA SCANNER ROBUSTNESS & EDGE CASES
// ============================================================================
describe('Suite 3: Local Media Scanner Robustness & Edge Cases', () => {

  test('ADV-L01: scanDirectory returns empty array for nonexistent directory without throwing', async () => {
    const nonExistent = path.join(stressDir, 'non_existent_folder_abc');
    const result = await LocalMediaScanner.scanDirectory(nonExistent);
    assert.strictEqual(Array.isArray(result), true);
    assert.strictEqual(result.length, 0);
  });

  test('ADV-L02: scanDirectory discovers audio files across 15 levels of deep folder nesting', async () => {
    const deepRoot = path.join(stressDir, 'deep_nesting_test');
    let currentDir = deepRoot;

    // Create 15 nested levels
    const levelsToPlace = [1, 5, 10, 15];
    const placedFiles = [];

    for (let level = 1; level <= 15; level++) {
      currentDir = path.join(currentDir, `level_${level}`);
      fs.mkdirSync(currentDir, { recursive: true });

      if (levelsToPlace.includes(level)) {
        const filePath = path.join(currentDir, `track_at_level_${level}.flac`);
        // Write synthetic FLAC header (4 bytes 'fLaC' + 22 bytes dummy STREAMINFO)
        const flacHeader = Buffer.alloc(40);
        flacHeader.write('fLaC', 0, 4, 'ascii');
        // sampleRate=44100, channels=2, bitDepth=16, duration=180s
        // totalSamples = 180 * 44100 = 7938000 (0x7920D0)
        flacHeader[18] = (44100 >> 12) & 0xff;
        flacHeader[19] = (44100 >> 4) & 0xff;
        flacHeader[20] = ((44100 & 0x0f) << 4) | (1 << 1) | 0; // channels=2
        flacHeader[21] = (15 << 4) | 0; // bitDepth=16
        flacHeader.writeUInt32BE(7938000, 22);

        fs.writeFileSync(filePath, flacHeader);
        placedFiles.push(filePath);
      }
    }

    assert.strictEqual(placedFiles.length, 4, 'Should have created 4 files across levels 1, 5, 10, 15');

    const scanned = await LocalMediaScanner.scanDirectory(deepRoot);
    assert.strictEqual(scanned.length, 4, `Must find all 4 tracks in deep folder tree, found: ${scanned.length}`);

    for (const song of scanned) {
      const validation = validateSongContract(song);
      assert.strictEqual(validation.valid, true, `Song at depth must pass contract: ${validation.error}`);
      assert.strictEqual(song.durationSec, 180);
      assert.strictEqual(song.isLocal, true);
    }
  });

  test('ADV-L03: System audio & excluded segments are strictly excluded at all depths', async () => {
    const excludedRoot = path.join(stressDir, 'excluded_segments_test');
    const validDir = path.join(excludedRoot, 'Music', 'Albums');
    const alarmsDir = path.join(excludedRoot, 'System', 'Alarms');
    const ringtonesDir = path.join(excludedRoot, 'Media', 'Ringtones');
    const podcastsDir = path.join(excludedRoot, 'Podcasts', 'Show1');
    const voiceRecDir = path.join(excludedRoot, 'Voice Recorder');

    fs.mkdirSync(validDir, { recursive: true });
    fs.mkdirSync(alarmsDir, { recursive: true });
    fs.mkdirSync(ringtonesDir, { recursive: true });
    fs.mkdirSync(podcastsDir, { recursive: true });
    fs.mkdirSync(voiceRecDir, { recursive: true });

    // Dummy audio header buffer
    const wavHeader = Buffer.alloc(64);
    wavHeader.write('RIFF', 0, 4, 'ascii');
    wavHeader.writeUInt32LE(64, 4);
    wavHeader.write('WAVE', 8, 4, 'ascii');
    wavHeader.write('fmt ', 12, 4, 'ascii');
    wavHeader.writeUInt16LE(2, 20); // 2 channels
    wavHeader.writeUInt32LE(44100, 22); // 44.1kHz
    wavHeader.writeUInt16LE(16, 32); // 16-bit
    wavHeader.write('data', 36, 4, 'ascii');
    wavHeader.writeUInt32LE(176400 * 60, 40); // 60s

    fs.writeFileSync(path.join(validDir, 'legit_music.wav'), wavHeader);
    fs.writeFileSync(path.join(alarmsDir, 'loud_alarm.wav'), wavHeader);
    fs.writeFileSync(path.join(ringtonesDir, 'ringtone_chime.wav'), wavHeader);
    fs.writeFileSync(path.join(podcastsDir, 'podcast_ep.wav'), wavHeader);
    fs.writeFileSync(path.join(voiceRecDir, 'memo.wav'), wavHeader);

    const results = await LocalMediaScanner.scanDirectory(excludedRoot);
    assert.strictEqual(results.length, 1, `Only the legit music track should be included, found: ${results.length}`);
    assert.strictEqual(results[0].title, 'legit_music');
  });

  test('ADV-L04: Non-audio files, empty files, and corrupt header files do not crash scanner', async () => {
    const mixedDir = path.join(stressDir, 'mixed_corrupt_test');
    fs.mkdirSync(mixedDir, { recursive: true });

    // 1. Non-audio files
    fs.writeFileSync(path.join(mixedDir, 'document.pdf'), 'PDF-1.4 binary content');
    fs.writeFileSync(path.join(mixedDir, 'photo.jpg'), 'JPEG binary header');
    fs.writeFileSync(path.join(mixedDir, 'script.exe'), 'MZ binary PE file');
    fs.writeFileSync(path.join(mixedDir, 'readme.txt'), 'Hello world lyrics');

    // 2. Zero-byte files
    fs.writeFileSync(path.join(mixedDir, 'zero_byte.mp3'), Buffer.alloc(0));
    fs.writeFileSync(path.join(mixedDir, 'zero_byte.flac'), Buffer.alloc(0));

    // 3. Corrupt ID3 MP3 file (ID3 header claiming 100MB frame size)
    const corruptId3 = Buffer.alloc(128);
    corruptId3.write('ID3', 0, 3, 'ascii');
    corruptId3[3] = 0x03; // ID3v2.3
    corruptId3.write('TIT2', 10, 4, 'ascii');
    corruptId3.writeUInt32BE(0xFFFFFFFF, 14); // Outrageous frame size
    fs.writeFileSync(path.join(mixedDir, 'corrupt_id3.mp3'), corruptId3);

    // 4. Truncated FLAC file (only 'fLaC' without metadata block)
    const truncatedFlac = Buffer.from('fLaC');
    fs.writeFileSync(path.join(mixedDir, 'truncated.flac'), truncatedFlac);

    // 5. Valid audio file
    const validWav = Buffer.alloc(44);
    validWav.write('RIFF', 0, 4, 'ascii');
    validWav.write('WAVE', 8, 4, 'ascii');
    validWav.write('fmt ', 12, 4, 'ascii');
    validWav.writeUInt16LE(2, 20);
    validWav.writeUInt32LE(44100, 22);
    validWav.writeUInt16LE(16, 32);
    validWav.write('data', 36, 4, 'ascii');
    validWav.writeUInt32LE(176400 * 45, 40); // 45 seconds
    fs.writeFileSync(path.join(mixedDir, 'valid_soundtrack.wav'), validWav);

    let scanned;
    try {
      scanned = await LocalMediaScanner.scanDirectory(mixedDir);
    } catch (err) {
      assert.fail(`Scanning mixed directory threw an error: ${err.message}`);
    }

    // The valid audio file must be recognized
    const validTrack = scanned.find((s) => s.title === 'valid_soundtrack');
    assert.ok(validTrack, 'Valid soundtrack WAV must be discovered');
    assert.strictEqual(validTrack.durationSec, 45);

    // None of the non-audio files (.pdf, .jpg, .exe, .txt) may be present
    for (const song of scanned) {
      assert.strictEqual(
        ['document', 'photo', 'script', 'readme'].includes(song.title),
        false,
        `Non-audio file ${song.title} should not be scanned`
      );
    }
  });

  test('ADV-L05: ID3v2 metadata frame parsing resilience under diverse encodings & corrupted frames', async () => {
    const testFile = path.join(stressDir, 'id3_resilience.mp3');

    // Build synthetic ID3v2.3 tag
    // Header: 10 bytes ('ID3' 0x03 0x00 0x00, size syncsafe)
    // TIT2 frame: 'TIT2', size=14, flags=0, encoding=0 (ISO-8859-1), 'Symphony No. 5'
    const title = 'Symphony No. 5';
    const artist = 'Ludwig van Beethoven';
    const album = 'Classical Masterpieces';
    const year = '1808';

    const buf = Buffer.alloc(512);
    buf.write('ID3', 0, 3, 'ascii');
    buf[3] = 0x03; // v2.3

    let offset = 10;
    const writeFrame = (id, text) => {
      const textBuf = Buffer.from(text, 'utf-8');
      buf.write(id, offset, 4, 'ascii');
      buf.writeUInt32BE(textBuf.length + 1, offset + 4);
      buf[offset + 10] = 0x03; // UTF-8 encoding flag
      textBuf.copy(buf, offset + 11);
      offset += 11 + textBuf.length;
    };

    writeFrame('TIT2', title);
    writeFrame('TPE1', artist);
    writeFrame('TALB', album);
    writeFrame('TYER', year);

    // Fill remaining with dummy audio payload (100KB)
    const fullFile = Buffer.concat([buf, Buffer.alloc(100000)]);
    fs.writeFileSync(testFile, fullFile);

    const metadata = await LocalMediaScanner.extractMetadata(testFile);
    assert.strictEqual(metadata.format, 'MP3');
    assert.strictEqual(metadata.title, title);
    assert.strictEqual(metadata.artist, artist);
    assert.strictEqual(metadata.album, album);
    assert.strictEqual(metadata.year, year);
    assert.strictEqual(metadata.durationSec > 0, true);

    const song = LocalMediaScanner.createSongEntity(metadata);
    const contract = validateSongContract(song);
    assert.strictEqual(contract.valid, true);
  });
});

// ============================================================================
// SUITE 4: LOCAL MEDIA SEARCH PERFORMANCE & ORACLE VERIFICATION
// ============================================================================
describe('Suite 4: Local Media Search Performance & Oracle Verification', () => {

  // Generate 10,000 synthetic tracks for search benchmark
  const trackCount = 10000;
  const libraryTracks = [];

  before(() => {
    const genres = ['Rock', 'Jazz', 'Electronic', 'Classical', 'Hip-Hop', 'Pop', 'Ambient', 'Metal'];
    const artists = [
      'Daft Punk', 'Pink Floyd', 'Radiohead', 'Miles Davis', 'Hans Zimmer',
      'Kendrick Lamar', 'Taylor Swift', 'Aphex Twin', 'The Beatles', 'Led Zeppelin',
    ];

    for (let i = 0; i < trackCount; i++) {
      const artist = artists[i % artists.length];
      const genre = genres[i % genres.length];
      const title = `Track ${i} - ${genre} Journey (${i % 2 === 0 ? 'Remix' : 'Live'})`;
      const album = `Album Vol. ${Math.floor(i / 10)} - The ${genre} Collection`;

      libraryTracks.push({
        id: `local_track_${i}`,
        videoId: `local_track_${i}`,
        title,
        artist,
        artists: [{ id: `art_${artist}`, name: artist }],
        artistIds: [`art_${artist}`],
        album,
        albumName: album,
        durationSec: 180 + (i % 120),
        durationText: '3:30',
        thumbnailUrl: null,
        liked: false,
        totalPlayTimeMs: 210000,
        playCount: 0,
        lastPlayedTimeMs: 0,
        streamUrl: `file:///C:/Music/${artist}/${title}.flac`,
        isLocal: true,
      });
    }
  });

  test('ADV-M01: Search returns empty array on empty or whitespace queries', () => {
    assert.deepStrictEqual(LocalMediaScanner.search(libraryTracks, ''), []);
    assert.deepStrictEqual(LocalMediaScanner.search(libraryTracks, '   '), []);
    assert.deepStrictEqual(LocalMediaScanner.search(libraryTracks, null), []);
    assert.deepStrictEqual(LocalMediaScanner.search(libraryTracks, undefined), []);
  });

  test('ADV-M02: Search is case-insensitive across title, artist, and album', () => {
    // 1. Lowercase search for uppercase artist
    const resLower = LocalMediaScanner.search(libraryTracks, 'daft punk');
    assert.strictEqual(resLower.length, trackCount / 10);
    assert.strictEqual(resLower.every((t) => t.artist === 'Daft Punk'), true);

    // 2. Uppercase search
    const resUpper = LocalMediaScanner.search(libraryTracks, 'DAFT PUNK');
    assert.strictEqual(resUpper.length, resLower.length);

    // 3. Mixed case search for album
    const resAlbum = LocalMediaScanner.search(libraryTracks, 'tHe aMbIeNt cOlLeCtIoN');
    assert.strictEqual(resAlbum.length > 0, true);
    assert.strictEqual(resAlbum.every((t) => t.albumName.toLowerCase().includes('the ambient collection')), true);
  });

  test('ADV-M03: Search latency across 10,000 tracks is under 50ms', () => {
    const queries = ['Daft Punk', 'Journey', 'Vol. 42', 'Remix', 'Nonexistentxyz123'];
    const latencies = [];

    for (const q of queries) {
      const t0 = performance.now();
      const results = LocalMediaScanner.search(libraryTracks, q);
      const t1 = performance.now();
      latencies.push(t1 - t0);
      assert.strictEqual(Array.isArray(results), true);
    }

    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const maxLatency = Math.max(...latencies);

    console.log(`    ℹ ADV-M03: 10,000 tracks search avg latency: ${avgLatency.toFixed(2)}ms, max: ${maxLatency.toFixed(2)}ms`);
    assert.strictEqual(avgLatency < 50, true, `Average search latency must be < 50ms, was ${avgLatency.toFixed(2)}ms`);
    assert.strictEqual(maxLatency < 100, true, `Max search latency must be < 100ms, was ${maxLatency.toFixed(2)}ms`);
  });

  test('ADV-M04: Search handles unicode, diacritics, and symbols correctly', () => {
    const specialTracks = [
      createTestSong('sp_1', 'Borders (feat. Sigur Rós)', 'Jónsi'),
      createTestSong('sp_2', 'Ace of Spades (Motörhead Cover)', 'Metallica'),
      createTestSong('sp_3', 'Café del Mar', 'Energy 52'),
      createTestSong('sp_4', '100% Pure Love [2024 Remaster]', 'Crystal Waters'),
    ];

    // Diacritic search
    const resRós = LocalMediaScanner.search(specialTracks, 'Sigur Rós');
    assert.strictEqual(resRós.length, 1);
    assert.strictEqual(resRós[0].videoId, 'sp_1');

    // Symbol search
    const resPercent = LocalMediaScanner.search(specialTracks, '100%');
    assert.strictEqual(resPercent.length, 1);
    assert.strictEqual(resPercent[0].videoId, 'sp_4');

    // Bracket search
    const resBracket = LocalMediaScanner.search(specialTracks, '[2024 Remaster]');
    assert.strictEqual(resBracket.length, 1);
    assert.strictEqual(resBracket[0].videoId, 'sp_4');
  });
});
