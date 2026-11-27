// tests/unit/data_layer_m3.test.mjs
// Comprehensive Unit & Integration Test Suite for Milestone 3 (Data Layer, Persistence & Service Integration)
// Covering Feature 12 (Domain Models), Feature 13 (StorageService), Feature 14 (InnerTube & MusicService),
// Feature 15 (Local Media Scanner), Feature 16 (Lyrics, Discord RPC, Party Sync)

import { test, describe, before, after } from 'node:test';
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

// Dynamic imports of production M3 models & services
const {
  AudioQuality,
  PlaybackState,
  QueueTier,
  FilterType,
  validateSongContract,
  normalizeSong,
  defaultAppSettings,
  DEFAULT_SETTINGS,
  mergeSettings,
  ShelfLayout,
} = await import('../../src/models/index.ts');

const {
  StorageService,
  writeJsonAtomic,
  readJsonSafe,
  InnerTubeClient,
  extractSapisid,
  generateSapisidHash,
  InnerTubeParser,
  StreamResolver,
  rankAudioFormats,
  extractDirectUrl,
  MusicService,
  LocalMediaScanner,
  LyricsService,
  DiscordRpcService,
  PartySyncClient,
  MockPartyBroadcastServer,
} = await import('../../src/services/index.ts');

const { mockSongs } = await import('../fixtures/mockSongs.mjs');
const { mockPlaylists } = await import('../fixtures/mockPlaylists.mjs');
const { mockInnerTube } = await import('../fixtures/mockInnerTube.mjs');
const { mockLyrics } = await import('../fixtures/mockLyrics.mjs');

// Temporary directory for isolated storage tests
const testStorageDir = path.join(os.tmpdir(), `waveform-m3-test-${Date.now()}`);

before(() => {
  if (!fs.existsSync(testStorageDir)) {
    fs.mkdirSync(testStorageDir, { recursive: true });
  }
});

after(() => {
  try {
    if (fs.existsSync(testStorageDir)) {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors
  }
});

// ============================================================================
// FEATURE 12: DOMAIN DATA MODELS & ENTITIES
// ============================================================================
describe('Feature 12: Domain Data Models & Entities (src/models/)', () => {
  test('F12-M01: Enums define expected invariants', () => {
    assert.strictEqual(AudioQuality.LOW, 'LOW');
    assert.strictEqual(AudioQuality.STANDARD, 'STANDARD');
    assert.strictEqual(AudioQuality.HIGH, 'HIGH');
    assert.strictEqual(AudioQuality.LOSSLESS, 'LOSSLESS');

    assert.strictEqual(PlaybackState.IDLE, 'IDLE');
    assert.strictEqual(PlaybackState.PLAYING, 'PLAYING');
    assert.strictEqual(PlaybackState.PAUSED, 'PAUSED');
    assert.strictEqual(PlaybackState.BUFFERING, 'BUFFERING');
    assert.strictEqual(PlaybackState.CROSSFADING, 'CROSSFADING');

    assert.strictEqual(QueueTier.USER_QUEUE, 'USER_QUEUE');
    assert.strictEqual(QueueTier.CONTEXT, 'CONTEXT');
    assert.strictEqual(QueueTier.AUTOPLAY, 'AUTOPLAY');

    assert.strictEqual(FilterType.ALL, 'all');
    assert.strictEqual(FilterType.SONGS, 'songs');
    assert.strictEqual(FilterType.ALBUMS, 'albums');
    assert.strictEqual(FilterType.ARTISTS, 'artists');
    assert.strictEqual(FilterType.PLAYLISTS, 'playlists');
    assert.strictEqual(FilterType.VIDEOS, 'videos');

    assert.strictEqual(ShelfLayout.ROW, 'ROW');
    assert.strictEqual(ShelfLayout.GRID, 'GRID');
    assert.strictEqual(ShelfLayout.TWO_ROW_GRID, 'TWO_ROW_GRID');
    assert.strictEqual(ShelfLayout.COMPACT_ROW, 'COMPACT_ROW');
    assert.strictEqual(ShelfLayout.LIST, 'LIST');
  });

  test('F12-M02: validateSongContract accepts all valid authoritative fixture tracks', () => {
    for (const [name, song] of Object.entries(mockSongs)) {
      const result = validateSongContract(song);
      assert.strictEqual(result.valid, true, `Expected valid for ${name}: ${result.error}`);
    }
  });

  test('F12-M03: validateSongContract rejects non-object or null', () => {
    assert.strictEqual(validateSongContract(null).valid, false);
    assert.strictEqual(validateSongContract(undefined).valid, false);
    assert.strictEqual(validateSongContract('string').valid, false);
    assert.strictEqual(validateSongContract(12345).valid, false);
  });

  test('F12-M04: validateSongContract rejects missing or empty required string fields', () => {
    assert.strictEqual(validateSongContract({ videoId: '', title: 'A', artist: 'B', liked: true, totalPlayTimeMs: 0, playCount: 0, artists: [], artistIds: [] }).valid, false);
    assert.strictEqual(validateSongContract({ videoId: '1', title: '   ', artist: 'B', liked: true, totalPlayTimeMs: 0, playCount: 0, artists: [], artistIds: [] }).valid, false);
    assert.strictEqual(validateSongContract({ videoId: '1', title: 'A', artist: '', liked: true, totalPlayTimeMs: 0, playCount: 0, artists: [], artistIds: [] }).valid, false);
  });

  test('F12-M05: validateSongContract rejects non-boolean liked or negative metrics', () => {
    const base = { videoId: 'v1', title: 'T', artist: 'A', artists: [], artistIds: [] };
    assert.strictEqual(validateSongContract({ ...base, liked: 'true', totalPlayTimeMs: 0, playCount: 0 }).valid, false);
    assert.strictEqual(validateSongContract({ ...base, liked: true, totalPlayTimeMs: -1, playCount: 0 }).valid, false);
    assert.strictEqual(validateSongContract({ ...base, liked: true, totalPlayTimeMs: 0, playCount: -5 }).valid, false);
  });

  test('F12-M06: validateSongContract rejects non-array artists or artistIds', () => {
    const base = { videoId: 'v1', title: 'T', artist: 'A', liked: true, totalPlayTimeMs: 0, playCount: 0 };
    assert.strictEqual(validateSongContract({ ...base, artists: 'not-an-array', artistIds: [] }).valid, false);
    assert.strictEqual(validateSongContract({ ...base, artists: [], artistIds: null }).valid, false);
  });

  test('F12-M07: normalizeSong converts UI shorthands without data loss', () => {
    const raw = {
      id: 'short_001',
      title: 'Neon Sky',
      artist: 'Synth Master',
      album: 'Retrowave Vol 1',
      artworkUrl: 'https://example.com/art.jpg',
      audioQuality: '320kbps MP3',
      explicit: true,
      durationSec: 185,
    };
    const song = normalizeSong(raw);
    assert.strictEqual(song.videoId, 'short_001');
    assert.strictEqual(song.id, 'short_001');
    assert.strictEqual(song.title, 'Neon Sky');
    assert.strictEqual(song.artist, 'Synth Master');
    assert.strictEqual(song.albumName, 'Retrowave Vol 1');
    assert.strictEqual(song.album, 'Retrowave Vol 1');
    assert.strictEqual(song.thumbnailUrl, 'https://example.com/art.jpg');
    assert.strictEqual(song.artworkUrl, 'https://example.com/art.jpg');
    assert.strictEqual(song.sourceQuality, '320kbps MP3');
    assert.strictEqual(song.audioQuality, '320kbps MP3');
    assert.strictEqual(song.isExplicit, true);
    assert.strictEqual(song.explicit, true);
    assert.strictEqual(song.durationText, '3:05');
    assert.strictEqual(song.durationSec, 185);

    // Conformance validation
    const validation = validateSongContract(song);
    assert.strictEqual(validation.valid, true);
  });

  test('F12-M08: defaultAppSettings houses at least 70 configuration keys', () => {
    const keys = Object.keys(defaultAppSettings);
    assert.ok(keys.length >= 70, `Expected >= 70 keys, found ${keys.length}`);
    assert.strictEqual(DEFAULT_SETTINGS, defaultAppSettings);
  });

  test('F12-M09: mergeSettings correctly mutates known keys and rejects type mismatches', () => {
    const updated = mergeSettings(defaultAppSettings, {
      'appearance.accentColor': '#1DB954',
      'playback.crossfadeDurationSec': 8.0,
      'dsp.spatialWidthGain': 3.0,
    });
    assert.strictEqual(updated['appearance.accentColor'], '#1DB954');
    assert.strictEqual(updated['playback.crossfadeDurationSec'], 8.0);
    assert.strictEqual(updated['dsp.spatialWidthGain'], 3.0);
    assert.strictEqual(updated['appearance.themeMode'], 'dark'); // Unaltered

    // Type mismatch throws TypeError
    assert.throws(
      () => mergeSettings(defaultAppSettings, { 'playback.volumeLevel': 'loud' }),
      /Invalid type for setting/
    );
  });
});

// ============================================================================
// FEATURE 13: LOCAL PERSISTENCE & STORAGE (src/services/StorageService.ts)
// ============================================================================
describe('Feature 13: Local Persistence & State Storage (StorageService)', () => {
  let storage;

  before(() => {
    storage = new StorageService(testStorageDir);
  });

  test('F13-S01: Initial getSettings returns complete default settings', async () => {
    const settings = await storage.getSettings();
    assert.ok(Object.keys(settings).length >= 70);
    assert.strictEqual(settings['appearance.themeMode'], 'dark');
    assert.strictEqual(settings['playback.crossfadeDurationSec'], 4.0);
  });

  test('F13-S02: updateSettings persists delta and disk read confirms persistence', async () => {
    await storage.updateSettings({
      'appearance.themeMode': 'light',
      'playback.volumeLevel': 0.95,
      'dsp.equalizerPreset': 'Electronic',
    });

    const settings = await storage.getSettings();
    assert.strictEqual(settings['appearance.themeMode'], 'light');
    assert.strictEqual(settings['playback.volumeLevel'], 0.95);
    assert.strictEqual(settings['dsp.equalizerPreset'], 'Electronic');

    // Confirm written on disk
    const diskPath = path.join(testStorageDir, 'settings.json');
    assert.ok(fs.existsSync(diskPath));
    const diskContent = JSON.parse(fs.readFileSync(diskPath, 'utf-8'));
    assert.strictEqual(diskContent['appearance.themeMode'], 'light');
  });

  test('F13-S03: createPlaylist creates unique playlist and validates empty name', async () => {
    await assert.rejects(
      () => storage.createPlaylist('   '),
      /Playlist title cannot be empty/
    );

    const pl = await storage.createPlaylist('Synth Roadtrip', 'Night drive tracks');
    assert.ok(pl.id.startsWith('pl_custom_'));
    assert.strictEqual(pl.title, 'Synth Roadtrip');
    assert.strictEqual(pl.description, 'Night drive tracks');
    assert.strictEqual(pl.songCount, 0);
    assert.deepStrictEqual(pl.songIds, []);
    assert.strictEqual(pl.isCustom, true);

    const all = await storage.getPlaylists();
    assert.ok(all.some((p) => p.id === pl.id));
  });

  test('F13-S04: addTracksToPlaylist appends track IDs without duplicates and updates count', async () => {
    const pl = await storage.createPlaylist('Gaming Hits');
    await storage.addTracksToPlaylist(pl.id, ['track_1', 'track_2']);

    let all = await storage.getPlaylists();
    let target = all.find((p) => p.id === pl.id);
    assert.strictEqual(target.songCount, 2);
    assert.deepStrictEqual(target.songIds, ['track_1', 'track_2']);

    // Add duplicate and single track
    await storage.addSongToPlaylist(pl.id, 'track_2'); // duplicate
    await storage.addSongToPlaylist(pl.id, 'track_3'); // new

    all = await storage.getPlaylists();
    target = all.find((p) => p.id === pl.id);
    assert.strictEqual(target.songCount, 3);
    assert.deepStrictEqual(target.songIds, ['track_1', 'track_2', 'track_3']);
  });

  test('F13-S05: addTracksToPlaylist throws on nonexistent playlist ID', async () => {
    await assert.rejects(
      () => storage.addTracksToPlaylist('pl_nonexistent_999', ['t1']),
      /not found/
    );
  });

  test('F13-S06: toggleFavorite adds then removes song', async () => {
    const song = mockSongs.standardYouTube;
    const added = await storage.toggleFavorite(song);
    assert.strictEqual(added, true);

    let favs = await storage.getFavorites();
    assert.ok(favs.some((f) => f.videoId === song.videoId));

    const removed = await storage.toggleFavorite(song);
    assert.strictEqual(removed, false);

    favs = await storage.getFavorites();
    assert.ok(!favs.some((f) => f.videoId === song.videoId));
  });

  test('F13-S07: toggleFavorite rejects invalid song contract', async () => {
    await assert.rejects(
      () => storage.toggleFavorite({ videoId: '', title: '' }),
      /Mandatory field/
    );
  });

  test('F13-S08: recordListeningHistory updates temporal monthly history and aggregates', async () => {
    const song = mockSongs.standardYouTube;
    await storage.recordListeningHistory(song, 255);

    const history = await storage.getListeningHistory();
    assert.ok(history.length >= 1);
    const last = history[history.length - 1];
    assert.strictEqual(last.videoId, song.videoId);
    assert.strictEqual(last.durationSec, 255);

    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthly = await storage.getMonthlyListeningHistory(ym);

    assert.ok(monthly.totalListeningTimeSec >= 255);
    assert.ok(monthly.totalPlaysCount >= 1);
    assert.ok(monthly.topTracks.some((t) => t.videoId === song.videoId));
    assert.ok(monthly.topArtists.some((a) => a.artistName === song.artist));

    const dayKey = now.toISOString().slice(0, 10);
    assert.ok(monthly.dailyPlays[dayKey] >= 1);

    // Negative duration throws RangeError
    await assert.rejects(
      () => storage.recordListeningHistory(song, -10),
      RangeError
    );
  });

  test('F13-S09: writeJsonAtomic handles 50 rapid sequential writes without corruption', async () => {
    const testFile = path.join(testStorageDir, 'atomic_stress.json');
    for (let i = 0; i < 50; i++) {
      await writeJsonAtomic(testFile, { counter: i, timestamp: Date.now() });
    }
    const read = await readJsonSafe(testFile, null);
    assert.strictEqual(read.counter, 49);
  });
});

// ============================================================================
// FEATURE 14: INNERTUBE MUSIC SERVICE & SEARCH
// ============================================================================
describe('Feature 14: InnerTube Music Service & Search (src/services/)', () => {
  test('F14-I01: InnerTubeClient header builder and SAPISIDHASH generator', () => {
    const cookie = 'SAPISID=test_sapisid_value_123; OTHER=abc';
    const sapisid = extractSapisid(cookie);
    assert.strictEqual(sapisid, 'test_sapisid_value_123');

    const hash = generateSapisidHash(sapisid);
    assert.ok(hash.startsWith('SAPISIDHASH '));
    assert.ok(hash.length > 20);

    const client = new InnerTubeClient({ cookie });
    const headers = client.buildHeaders();
    assert.strictEqual(headers['X-YouTube-Client-Name'], '67');
    assert.strictEqual(headers['Origin'], 'https://music.youtube.com');
    assert.strictEqual(headers['Authorization'], hash);

    const anonHeaders = client.buildHeaders(true);
    assert.strictEqual(anonHeaders['Authorization'], undefined);
  });

  test('F14-I02: InnerTubeClient wrapContext injects WEB_REMIX metadata', () => {
    const client = new InnerTubeClient();
    client.setVisitorData('CgtsWjB_TEST_VISITOR_ID_40CHARS_1234567890');
    const wrapped = client.wrapContext({ browseId: 'FEmusic_home' });

    assert.strictEqual(wrapped.browseId, 'FEmusic_home');
    const ctx = wrapped.context;
    assert.strictEqual(ctx.client.clientName, 'WEB_REMIX');
    assert.strictEqual(ctx.client.visitorData, 'CgtsWjB_TEST_VISITOR_ID_40CHARS_1234567890');
    assert.strictEqual(ctx.user.lockedSafetyMode, false);
  });

  test('F14-I03: InnerTubeParser parseArtistsFromRuns parses collaborations and delimiters', () => {
    const parser = new InnerTubeParser();
    const runs = [
      { text: 'The Weeknd', navigationEndpoint: { browseEndpoint: { browseId: 'art_w', browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ARTIST' } } } } },
      { text: ' & ' },
      { text: 'Ariana Grande', navigationEndpoint: { browseEndpoint: { browseId: 'art_a', browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ARTIST' } } } } },
    ];
    const parsed = parser.parseArtistsFromRuns(runs);
    assert.strictEqual(parsed.artistText, 'The Weeknd, Ariana Grande');
    assert.strictEqual(parsed.artists.length, 2);
    assert.strictEqual(parsed.artists[0].name, 'The Weeknd');
    assert.strictEqual(parsed.artists[1].name, 'Ariana Grande');
    assert.deepStrictEqual(parsed.artistIds, ['art_w', 'art_a']);
  });

  test('F14-I04: InnerTubeParser filter parameters match category encodings', () => {
    const parser = new InnerTubeParser();
    assert.strictEqual(parser.getFilterParam('all'), undefined);
    assert.ok(parser.getFilterParam('songs')?.includes('EgWKAQIIAWo'));
    assert.ok(parser.getFilterParam('albums')?.includes('EgWKAQIYAWo'));
    assert.ok(parser.getFilterParam('artists')?.includes('EgWKAQIgAWo'));
    assert.ok(parser.getFilterParam('playlists')?.includes('EgWKAQIoAWo'));
  });

  test('F14-I05: StreamResolver rankAudioFormats prioritizes Itag 251 (Opus) over Itag 140 (AAC)', () => {
    const formats = [
      { itag: 140, mimeType: 'audio/mp4', bitrate: 128000, averageBitrate: 128000 },
      { itag: 249, mimeType: 'audio/webm', bitrate: 50000, averageBitrate: 50000 },
      { itag: 251, mimeType: 'audio/webm', bitrate: 160000, averageBitrate: 160000 },
      { itag: 250, mimeType: 'audio/webm', bitrate: 70000, averageBitrate: 70000 },
    ];
    const ranked = rankAudioFormats(formats);
    assert.strictEqual(ranked[0].itag, 251);
    assert.strictEqual(ranked[1].itag, 140);
  });

  test('F14-I06: StreamResolver extractDirectUrl decodes signature cipher parameters', () => {
    const formatDirect = { itag: 251, mimeType: 'audio/webm', bitrate: 160000, url: 'https://googlevideo.com/playback?id=123' };
    assert.strictEqual(extractDirectUrl(formatDirect), 'https://googlevideo.com/playback?id=123');

    const formatCipher = {
      itag: 251,
      mimeType: 'audio/webm',
      bitrate: 160000,
      signatureCipher: 's=SIG_TOKEN_ABC&sp=sig&url=https%3A%2F%2Fgooglevideo.com%2Fmedia',
    };
    const extracted = extractDirectUrl(formatCipher);
    assert.ok(extracted.startsWith('https://googlevideo.com/media'));
    assert.ok(extracted.includes('sig=SIG_TOKEN_ABC'));
  });

  test('F14-I07: MusicService getHomeShelves returns structured shelves and offline empty array', async () => {
    const music = new MusicService();
    const shelves = await music.getHomeShelves();
    assert.ok(typeof shelves[0].title === 'string' && shelves[0].title.length > 0);
    assert.ok(shelves[0].items.length > 0);

    // Offline mode returns empty array per F15-T05
    music.setNetworkAvailable(false);
    const offlineShelves = await music.getHomeShelves();
    assert.deepStrictEqual(offlineShelves, []);
  });

  test('F14-I08: MusicService getExploreCategories returns chips and trending content', async () => {
    const music = new MusicService();
    const explore = await music.getExploreCategories();
    assert.ok(explore.chips.includes('Energize'));
    assert.ok(explore.trending.length > 0);

    music.setNetworkAvailable(false);
    const offlineExplore = await music.getExploreCategories();
    assert.deepStrictEqual(offlineExplore.chips, []);
  });

  test('F14-I09: MusicService search returns results online and falls back to local tracks offline', async () => {
    const music = new MusicService();
    const online = await music.search('synthwave');
    assert.strictEqual(online.query, 'synthwave');
    assert.ok(online.items.length > 0);

    // Empty query returns empty
    const empty = await music.search('   ');
    assert.deepStrictEqual(empty.items, []);

    // Offline search with match
    music.setNetworkAvailable(false);
    const offlineMatch = await music.search('Midnight');
    assert.ok(offlineMatch.items.length > 0);
    assert.strictEqual(offlineMatch.items[0].videoId, 'local_flac_002');

    // Offline search with no match returns empty array per B15-T05
    const offlineNoMatch = await music.search('XYZNonExistentTrack');
    assert.deepStrictEqual(offlineNoMatch.items, []);
  });

  test('F14-I10: MusicService getReleaseDetails and getArtistDetails handle valid and invalid IDs', async () => {
    const music = new MusicService();
    const release = await music.getReleaseDetails('MPREb_redline_01');
    assert.ok(release);
    assert.strictEqual(release.title, 'Redline');
    assert.strictEqual(release.songs.length, 2);

    const invalidRelease = await music.getReleaseDetails('nonexistent_release_999');
    assert.strictEqual(invalidRelease, null);

    const artist = await music.getArtistDetails('art_lazerhawk_01');
    assert.ok(artist);
    assert.strictEqual(artist.name, 'Lazerhawk');

    const invalidArtist = await music.getArtistDetails('nonexistent_art_999');
    assert.strictEqual(invalidArtist, null);
  });

  test('F14-I11: MusicService resolveStream provides audio playback URL', async () => {
    const music = new MusicService();
    const stream = await music.resolveStream('yt_track_001');
    assert.ok(stream.url.length > 0);
    assert.strictEqual(stream.quality, '160kbps Opus');
  });
});

// ============================================================================
// FEATURE 15: LOCAL MEDIA SCANNER (src/services/LocalMediaScanner.ts)
// ============================================================================
describe('Feature 15: Local Audio File & Offline Playback (LocalMediaScanner)', () => {
  test('F15-L01: isSupportedAudio validates music extensions and rejects non-audio', () => {
    assert.strictEqual(LocalMediaScanner.isSupportedAudio('track.flac'), true);
    assert.strictEqual(LocalMediaScanner.isSupportedAudio('song.mp3'), true);
    assert.strictEqual(LocalMediaScanner.isSupportedAudio('audio.wav'), true);
    assert.strictEqual(LocalMediaScanner.isSupportedAudio('apple.m4a'), true);
    assert.strictEqual(LocalMediaScanner.isSupportedAudio('opus.opus'), true);
    assert.strictEqual(LocalMediaScanner.isSupportedAudio('installer.exe'), false);
    assert.strictEqual(LocalMediaScanner.isSupportedAudio('archive.zip'), false);
    assert.strictEqual(LocalMediaScanner.isSupportedAudio('image.jpg'), false);
  });

  test('F15-L02: isExcludedPath detects system and non-music sound effect folders', () => {
    assert.strictEqual(LocalMediaScanner.isExcludedPath('C:/Android/Ringtones/bell.mp3'), true);
    assert.strictEqual(LocalMediaScanner.isExcludedPath('C:/System/Notifications/ping.wav'), true);
    assert.strictEqual(LocalMediaScanner.isExcludedPath('C:/Podcasts/episode1.mp3'), true);
    assert.strictEqual(LocalMediaScanner.isExcludedPath('C:/Music/Albums/Track1.flac'), false);
  });

  test('F15-L03: isPlayable gates positive finite duration', () => {
    assert.strictEqual(LocalMediaScanner.isPlayable(240), true);
    assert.strictEqual(LocalMediaScanner.isPlayable(0.5), true);
    assert.strictEqual(LocalMediaScanner.isPlayable(0), false);
    assert.strictEqual(LocalMediaScanner.isPlayable(-10), false);
    assert.strictEqual(LocalMediaScanner.isPlayable(NaN), false);
  });

  test('F15-L04: resolveTitle falls back to filename without extension', () => {
    assert.strictEqual(LocalMediaScanner.resolveTitle('Tagged Title', 'C:/Music/track01.mp3'), 'Tagged Title');
    assert.strictEqual(LocalMediaScanner.resolveTitle(null, 'C:/Music/Synth_Master_99.flac'), 'Synth_Master_99');
    assert.strictEqual(LocalMediaScanner.resolveTitle('', 'C:\\Music\\Retro_Drive.wav'), 'Retro_Drive');
  });

  test('F15-L05: createSongEntity produces conforming Song entity with file URL', () => {
    const meta = {
      filePath: 'C:/Music/Synth/TestTrack.flac',
      fileUrl: 'file:///C:/Music/Synth/TestTrack.flac',
      format: 'FLAC',
      sampleRate: 96000,
      bitDepth: 24,
      channels: 2,
      bitrateKbps: 1411,
      durationSec: 250,
      title: 'Test Track',
      artist: 'Local Artist',
      album: 'Local Album',
      trackNumber: 1,
      year: '2024',
      artworkDataUrl: null,
      fileSizeBytes: 1048576,
      lastModifiedMs: Date.now(),
    };
    const song = LocalMediaScanner.createSongEntity(meta);
    assert.strictEqual(song.isLocal, true);
    assert.strictEqual(song.playbackSourceType, 'LOCAL');
    assert.ok(song.videoId.startsWith('local_'));
    assert.strictEqual(song.streamUrl, 'file:///C:/Music/Synth/TestTrack.flac');
    assert.strictEqual(song.durationText, '4:10');

    const validation = validateSongContract(song);
    assert.strictEqual(validation.valid, true);
  });

  test('F15-L06: search helper filters scanned tracks by title and artist', () => {
    const tracks = [
      LocalMediaScanner.createSongEntity({
        filePath: 'C:/track1.mp3',
        fileUrl: 'file:///C:/track1.mp3',
        format: 'MP3',
        sampleRate: 44100,
        bitDepth: 16,
        channels: 2,
        bitrateKbps: 320,
        durationSec: 180,
        title: 'Neon Nights',
        artist: 'Lazerhawk',
        album: 'Outrun',
        trackNumber: 1,
        year: '2010',
        artworkDataUrl: null,
        fileSizeBytes: 5000000,
        lastModifiedMs: Date.now(),
      }),
      LocalMediaScanner.createSongEntity({
        filePath: 'C:/track2.mp3',
        fileUrl: 'file:///C:/track2.mp3',
        format: 'MP3',
        sampleRate: 44100,
        bitDepth: 16,
        channels: 2,
        bitrateKbps: 320,
        durationSec: 210,
        title: 'Midnight City',
        artist: 'M83',
        album: 'Dreaming',
        trackNumber: 2,
        year: '2011',
        artworkDataUrl: null,
        fileSizeBytes: 5000000,
        lastModifiedMs: Date.now(),
      }),
    ];

    const matchLazer = LocalMediaScanner.search(tracks, 'lazer');
    assert.strictEqual(matchLazer.length, 1);
    assert.strictEqual(matchLazer[0].title, 'Neon Nights');

    const matchCity = LocalMediaScanner.search(tracks, 'city');
    assert.strictEqual(matchCity.length, 1);
    assert.strictEqual(matchCity[0].title, 'Midnight City');

    const matchNone = LocalMediaScanner.search(tracks, 'nonexistent');
    assert.strictEqual(matchNone.length, 0);
  });

  test('F15-L07: LocalMediaScanner extractMetadata correctly parses binary RIFF WAV header', async () => {
    const testWavPath = path.join(testStorageDir, 'standard_synth_test.wav');
    const buf = Buffer.alloc(44);
    buf.write('RIFF', 0, 4, 'ascii');
    buf.writeUInt32LE(36 + 176400 * 5, 4);
    buf.write('WAVE', 8, 4, 'ascii');
    buf.write('fmt ', 12, 4, 'ascii');
    buf.writeUInt32LE(16, 16); // Chunk size
    buf.writeUInt16LE(1, 20); // Audio format: PCM
    buf.writeUInt16LE(2, 22); // Stereo channels
    buf.writeUInt32LE(44100, 24); // 44.1 kHz
    buf.writeUInt32LE(176400, 28); // Byte rate
    buf.writeUInt16LE(4, 32); // Block align
    buf.writeUInt16LE(16, 34); // 16-bit depth
    buf.write('data', 36, 4, 'ascii');
    buf.writeUInt32LE(176400 * 5, 40); // 5 seconds of audio

    await fs.promises.writeFile(testWavPath, buf);

    try {
      const meta = await LocalMediaScanner.extractMetadata(testWavPath);
      assert.strictEqual(meta.format, 'WAV');
      assert.strictEqual(meta.sampleRate, 44100);
      assert.strictEqual(meta.channels, 2);
      assert.strictEqual(meta.bitDepth, 16);
      assert.strictEqual(meta.durationSec, 5);
      assert.strictEqual(meta.bitrateKbps, 1411);
    } finally {
      if (fs.existsSync(testWavPath)) {
        await fs.promises.unlink(testWavPath);
      }
    }
  });
});

// ============================================================================
// FEATURE 16: EXTERNAL SERVICES & FALLBACK MOCKING
// ============================================================================
describe('Feature 16: LyricsService, DiscordRpcService & PartySyncClient', () => {
  // --- LYRICS SERVICE ---
  test('F16-LY01: LyricsService parseLrc parses timestamps and calculates end times', () => {
    const lrc = `[00:10.00]Line one\n[00:15.50]Line two\n[00:22.00]Line three`;
    const parsed = LyricsService.parseLrc(lrc);
    assert.strictEqual(parsed.type, 'LINE_SYNCED');
    assert.strictEqual(parsed.lines.length, 3);
    assert.strictEqual(parsed.lines[0].startTimeMs, 10000);
    assert.strictEqual(parsed.lines[0].endTimeMs, 15500);
    assert.strictEqual(parsed.lines[1].startTimeMs, 15500);
    assert.strictEqual(parsed.lines[1].endTimeMs, 22000);
    assert.strictEqual(parsed.lines[2].endTimeMs, 27000); // 22000 + 5000
  });

  test('F16-LY02: LyricsService parseTtml extracts syllable-level spans', () => {
    const ttml = `
      <p begin="10.0s" end="15.0s">
        <span begin="10.0s" end="11.5s">Wait-</span>
        <span begin="11.5s" end="13.0s">ing </span>
        <span begin="13.0s" end="15.0s">here</span>
      </p>
    `;
    const parsed = LyricsService.parseTtml(ttml);
    assert.strictEqual(parsed.type, 'SYLLABLE_SYNCED');
    assert.strictEqual(parsed.lines.length, 1);
    const line = parsed.lines[0];
    assert.strictEqual(line.startTimeMs, 10000);
    assert.strictEqual(line.endTimeMs, 15000);
    assert.strictEqual(line.syllables.length, 3);
    assert.strictEqual(line.syllables[0].text, 'Wait-');
    assert.strictEqual(line.syllables[0].startTimeMs, 10000);
    assert.strictEqual(line.syllables[0].endTimeMs, 11500);
  });

  test('F16-LY03: LyricsService getActiveLineIndex performs binary search in O(log N)', () => {
    const lyrics = {
      type: 'LINE_SYNCED',
      provider: 'Test',
      lines: [
        { startTimeMs: 10000, endTimeMs: 15000, text: 'A' },
        { startTimeMs: 15000, endTimeMs: 20000, text: 'B' },
        { startTimeMs: 20000, endTimeMs: 25000, text: 'C' },
      ],
    };
    assert.strictEqual(LyricsService.getActiveLineIndex(lyrics, 12000), 0);
    assert.strictEqual(LyricsService.getActiveLineIndex(lyrics, 17500), 1);
    assert.strictEqual(LyricsService.getActiveLineIndex(lyrics, 22000), 2);
    assert.strictEqual(LyricsService.getActiveLineIndex(lyrics, 5000), -1);
  });

  test('F16-LY04: LyricsService getActiveWord computes progress clamped [0.0, 1.0]', () => {
    const line = {
      startTimeMs: 10000,
      endTimeMs: 15000,
      text: 'Wait-ing here',
      syllables: [
        { text: 'Wait-', startTimeMs: 10000, endTimeMs: 12000 },
        { text: 'ing ', startTimeMs: 12000, endTimeMs: 14000 },
        { text: 'here', startTimeMs: 14000, endTimeMs: 15000 },
      ],
    };
    const active1 = LyricsService.getActiveWord(line, 11000);
    assert.strictEqual(active1.syllableIndex, 0);
    assert.strictEqual(active1.progress, 0.5);

    const active2 = LyricsService.getActiveWord(line, 13000);
    assert.strictEqual(active2.syllableIndex, 1);
    assert.strictEqual(active2.progress, 0.5);

    const activeOut = LyricsService.getActiveWord(line, 9000);
    assert.strictEqual(activeOut.activeSyllable, null);
  });

  test('F16-LY05: LyricsService isRtlText identifies Hebrew and Arabic characters', () => {
    assert.strictEqual(LyricsService.isRtlText('שלום עולם'), true);
    assert.strictEqual(LyricsService.isRtlText('مرحبا بالعالم'), true);
    assert.strictEqual(LyricsService.isRtlText('Hello World'), false);
  });

  test('F16-LY06: LyricsService parseTtml supports arbitrary attribute orders and XML entity unescaping', () => {
    const ttml = `
      <tt xmlns="http://www.w3.org/ns/ttml">
        <body>
          <div>
            <p xml:id="p1" region="bottom" begin="00:00:10.000" end="00:00:15.000">
              <span style="s1" begin="00:00:10.000" end="00:00:12.000">Rock &amp; </span>
              <span style="s1" begin="00:00:12.000" end="00:00:15.000">Roll</span>
            </p>
            <p end="00:00:20.000" begin="00:00:15.500">
              <span begin="00:00:15.500" end="00:00:20.000">&quot;Forever&quot;</span>
            </p>
          </div>
        </body>
      </tt>
    `;
    const parsed = LyricsService.parseTtml(ttml);
    assert.strictEqual(parsed.lines.length, 2);
    assert.strictEqual(parsed.lines[0].startTimeMs, 10000);
    assert.strictEqual(parsed.lines[0].endTimeMs, 15000);
    assert.strictEqual(parsed.lines[0].text, 'Rock & Roll');
    assert.strictEqual(parsed.lines[1].startTimeMs, 15500);
    assert.strictEqual(parsed.lines[1].endTimeMs, 20000);
    assert.strictEqual(parsed.lines[1].text, '"Forever"');
  });

  test('F16-LY07: LyricsService parseClockTime safely handles empty and non-numeric inputs with 0 fallback', () => {
    assert.strictEqual(LyricsService.parseClockTime(''), 0);
    assert.strictEqual(LyricsService.parseClockTime('invalid'), 0);
    assert.strictEqual(LyricsService.parseClockTime('abc:def'), 0);
    assert.strictEqual(LyricsService.parseClockTime(null), 0);
    assert.strictEqual(LyricsService.parseClockTime(undefined), 0);
    assert.strictEqual(LyricsService.parseClockTime('10s'), 10000);
    assert.strictEqual(LyricsService.parseClockTime('500ms'), 500);
  });

  // --- DISCORD RPC SERVICE ---
  test('F16-DC01: DiscordRpcService connects, disconnects, and tracks status', async () => {
    const discord = new DiscordRpcService();
    assert.strictEqual(discord.getStatus(), 'DISCONNECTED');
    assert.strictEqual(discord.isConnected(), false);

    // Named pipe connect will gracefully return false when Discord is closed
    const connected = await discord.connect();
    assert.strictEqual(typeof connected, 'boolean');

    discord.disconnect();
    assert.strictEqual(discord.getStatus(), 'DISCONNECTED');
  });

  test('F16-DC02: DiscordRpcService updatePlayback accepts speed adjustments safely', () => {
    const discord = new DiscordRpcService();
    const song = mockSongs.standardYouTube;

    // Must execute cleanly without throwing
    assert.doesNotThrow(() => {
      discord.updatePlayback(song, 60000, 255000, true, 1.25);
      discord.updatePlayback(song, 60000, 255000, false);
      discord.clearActivity();
    });
  });

  // --- PARTY SYNC CLIENT & MOCK SERVER ---
  test('F16-PT01: PartySyncClient isValidPartyCode validates room code formats', () => {
    assert.strictEqual(PartySyncClient.isValidPartyCode('WAVE-1234'), true);
    assert.strictEqual(PartySyncClient.isValidPartyCode('WAVE-9999'), true);
    assert.strictEqual(PartySyncClient.isValidPartyCode('ABC123'), true);
    assert.strictEqual(PartySyncClient.isValidPartyCode('BAD-CODE'), false);
    assert.strictEqual(PartySyncClient.isValidPartyCode(''), false);
    assert.strictEqual(PartySyncClient.isValidPartyCode(null), false);
  });

  test('F16-PT02: PartySyncClient handles pong NTP clock drift estimation', () => {
    const client = new PartySyncClient();
    const clientSent = Date.now() - 100;
    const serverTimestamp = clientSent + 5000;

    client.handleFrame({
      type: 'pong',
      clientMs: clientSent,
      serverMs: serverTimestamp,
    });

    assert.strictEqual(client.getIsClockSynced(), true);
    // Offset should approximate +5000ms
    assert.ok(Math.abs(client.getClockOffsetMs() - 5000) < 150);
  });

  test('F16-PT03: PartySyncClient checkDrift uses 3-zone controller (lead-compensated seek + cooldown)', () => {
    const client = new PartySyncClient();
    const seeks = [];
    client.setCallbacks({
      onSeek: (targetMs) => {
        seeks.push(targetMs);
      },
    });

    const now = Date.now();
    // Simulate clock synced with 0 offset
    client.handleFrame({ type: 'pong', clientMs: now, serverMs: now });

    const playback = {
      isPlaying: true,
      positionMs: 50000,
      anchorMs: now,
      speed: 1.0,
      currentTrack: null,
    };

    // Deadzone (<150ms): no seek
    assert.strictEqual(client.checkDrift(50050, playback, now), false);
    assert.strictEqual(seeks.length, 0);

    // Major behind desync (10s behind): single lead-compensated seek + 4.5s cooldown prevents loop
    assert.strictEqual(client.checkDrift(40000, playback, now), true);
    assert.strictEqual(seeks.length, 1);
    assert.ok(seeks[0] >= 50300);

    // Subsequent check inside cooldown window suppresses second hard seek
    assert.strictEqual(client.checkDrift(40000, playback, now + 500), false);
    assert.strictEqual(seeks.length, 1);
  });

  test('F16-PT04: MockPartyBroadcastServer tracks members and room state', () => {
    const server = new MockPartyBroadcastServer('WAVE-7721', 'host_01');
    assert.strictEqual(server.getRoomStatus(), 'VACANT');

    server.addMember('host_01', 'Host User', true);
    assert.strictEqual(server.getRoomStatus(), 'ACTIVE');

    const snap = server.getSnapshot();
    assert.strictEqual(snap.partyCode, 'WAVE-7721');
    assert.strictEqual(snap.participants.length, 1);

    // Handle play control
    const state = server.handleControl('play', { positionMs: 15000 });
    assert.strictEqual(state.type, 'state');
    assert.strictEqual(state.playback.isPlaying, true);
    assert.strictEqual(state.playback.positionMs, 15000);

    server.removeMember('host_01');
    assert.strictEqual(server.getRoomStatus(), 'VACANT');
  });
});
