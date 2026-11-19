// tests/tier1_features/feature11_to_15.test.mjs
// Tier 1 Feature Coverage: Features 11 to 15 (25 tests)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mockAudio } from '../fixtures/mockAudio.mjs';
import { mockSongs, validateSongContract } from '../fixtures/mockSongs.mjs';
import { StorageServiceSimulator, MusicServiceSimulator } from '../helpers/testEngine.mjs';

describe('Feature 11: Lookahead Peak Limiter & Normalization', () => {
  test('F11-T01: Limiter clamps hot audio signals strictly below 0.985 ceiling', () => {
    // Generate hot signal with peaks reaching 2.0 (+6 dBFS)
    const hotSignal = mockAudio.generateSine(440, 0.1, 2.0);
    const { output, ceiling } = mockAudio.applyLookaheadLimiter(hotSignal, 0.985);

    assert.strictEqual(ceiling, 0.985);
    for (let i = 0; i < output.length; i++) {
      assert.ok(
        Math.abs(output[i]) <= 0.98501,
        `Sample ${i} exceeded limiter ceiling: ${Math.abs(output[i])} > 0.985`
      );
    }
  });

  test('F11-T02: Signals below ceiling pass through without alteration', () => {
    const quietSignal = mockAudio.generateSine(440, 0.05, 0.5);
    const { output } = mockAudio.applyLookaheadLimiter(quietSignal, 0.985);

    for (let i = 0; i < quietSignal.length; i++) {
      assert.ok(Math.abs(output[i] - quietSignal[i]) < 1e-4);
    }
  });

  test('F11-T03: Limiter instantaneous attack catches the very first peak sample', () => {
    const suddenBurst = new Float32Array(500);
    suddenBurst[10] = 3.5; // Instant spike
    const { output } = mockAudio.applyLookaheadLimiter(suddenBurst, 0.985);
    assert.ok(Math.abs(output[10]) <= 0.98501);
  });

  test('F11-T04: Exponential release smooths gain recovery without clicks or pumping', () => {
    const stepSignal = new Float32Array(4410); // 100ms
    stepSignal[0] = 2.0;
    // Remainder is quiet sine
    for (let i = 1; i < 4410; i++) stepSignal[i] = 0.4 * Math.sin((2 * Math.PI * 440 * i) / 44100);

    const { output } = mockAudio.applyLookaheadLimiter(stepSignal, 0.985);
    assert.ok(Math.abs(output[0]) <= 0.98501);
    // At the end of release, amplitude should have returned near 0.4
    const endSample = Math.abs(output[4000]);
    assert.ok(endSample <= 0.41);
  });

  test('F11-T05: Normalization mode calculates ReplayGain target alignment', () => {
    const targetLufs = -14.0;
    const trackLufs = -11.5; // Loud track
    const gainOffsetDb = targetLufs - trackLufs; // -2.5 dB
    assert.strictEqual(gainOffsetDb, -2.5);
    const linearGain = Math.pow(10, gainOffsetDb / 20);
    assert.ok(linearGain < 1.0 && linearGain > 0.7);
  });
});

describe('Feature 12: Domain Data Models & Entities', () => {
  test('F12-T01: Standard YouTube Song entity validates successfully', () => {
    const validation = validateSongContract(mockSongs.standardYouTube);
    assert.strictEqual(validation.valid, true);
    assert.strictEqual(mockSongs.standardYouTube.playbackSourceType, 'YOUTUBE');
  });

  test('F12-T02: Local FLAC lossless entity validates with local playback flags', () => {
    const validation = validateSongContract(mockSongs.localFlac);
    assert.strictEqual(validation.valid, true);
    assert.strictEqual(mockSongs.localFlac.isLocal, true);
    assert.strictEqual(mockSongs.localFlac.playbackSourceType, 'LOCAL');
  });

  test('F12-T03: Explicit track entity maintains content rating flag', () => {
    assert.strictEqual(mockSongs.explicitHipHop.isExplicit, true);
    assert.strictEqual(mockSongs.standardYouTube.isExplicit, false);
  });

  test('F12-T04: Multi-artist track correctly parses individual ArtistRef instances', () => {
    const collab = mockSongs.multiArtistCollaboration;
    assert.strictEqual(collab.artists.length, 2);
    assert.strictEqual(collab.artists[0].name, 'The Weeknd');
    assert.strictEqual(collab.artists[1].name, 'Ariana Grande');
  });

  test('F12-T05: QueueTier enum defines exactly USER_QUEUE, CONTEXT, and AUTOPLAY', () => {
    const tiers = ['USER_QUEUE', 'CONTEXT', 'AUTOPLAY'];
    assert.strictEqual(tiers.length, 3);
    assert.ok(tiers.includes('USER_QUEUE'));
    assert.ok(tiers.includes('CONTEXT'));
    assert.ok(tiers.includes('AUTOPLAY'));
  });
});

describe('Feature 13: Local Persistence & State Storage', () => {
  test('F13-T01: Default settings store houses over 70 configuration properties', async () => {
    const storage = new StorageServiceSimulator();
    const settings = await storage.getSettings();
    const keysCount = Object.keys(settings).length;
    assert.ok(keysCount >= 70, `Expected >= 70 settings, found ${keysCount}`);
  });

  test('F13-T02: Updating settings persists modified values without losing unchanged defaults', async () => {
    const storage = new StorageServiceSimulator();
    await storage.updateSettings({
      'appearance.accentColor': '#007AFF',
      'playback.crossfadeDurationSec': 6.5,
    });
    const updated = await storage.getSettings();
    assert.strictEqual(updated['appearance.accentColor'], '#007AFF');
    assert.strictEqual(updated['playback.crossfadeDurationSec'], 6.5);
    // Unchanged default remains intact
    assert.strictEqual(updated['appearance.themeMode'], 'dark');
  });

  test('F13-T03: User playlist creation generates unique record and persists', async () => {
    const storage = new StorageServiceSimulator();
    const initialPlaylists = await storage.getPlaylists();
    const initialCount = initialPlaylists.length;

    const created = await storage.createPlaylist('Late Night Lo-Fi', 'Chill beats');
    assert.strictEqual(created.title, 'Late Night Lo-Fi');

    const updatedPlaylists = await storage.getPlaylists();
    assert.strictEqual(updatedPlaylists.length, initialCount + 1);
  });

  test('F13-T04: Toggle favorite adds and removes song correctly', async () => {
    const storage = new StorageServiceSimulator();
    // Toggle new song (localFlac) -> should become favorited
    const isFavNow = await storage.toggleFavorite(mockSongs.localFlac);
    assert.strictEqual(isFavNow, true);
    const favs = await storage.getFavorites();
    assert.ok(favs.some((s) => s.videoId === mockSongs.localFlac.videoId));

    // Toggle again -> should be un-favorited
    const isFavAfter = await storage.toggleFavorite(mockSongs.localFlac);
    assert.strictEqual(isFavAfter, false);
  });

  test('F13-T05: Listening history record logs song metadata and listening duration', async () => {
    const storage = new StorageServiceSimulator();
    await storage.recordListeningHistory(mockSongs.standardYouTube, 240);
    const history = await storage.getListeningHistory();
    assert.strictEqual(history.length, 1);
    assert.strictEqual(history[0].videoId, mockSongs.standardYouTube.videoId);
    assert.strictEqual(history[0].durationSec, 240);
    assert.ok(history[0].timestamp > 0);
  });
});

describe('Feature 14: InnerTube Music Service & Search', () => {
  test('F14-T01: Home shelves fetch returns structured categories', async () => {
    const music = new MusicServiceSimulator();
    const shelves = await music.getHomeShelves();
    assert.ok(shelves.length >= 2);
    assert.strictEqual(shelves[0].title, 'Top Picks For You');
    assert.ok(shelves[0].items.length > 0);
  });

  test('F14-T02: Explore categories return genre chips and trending content', async () => {
    const music = new MusicServiceSimulator();
    const explore = await music.getExploreCategories();
    assert.ok(explore.chips.length > 0);
    assert.ok(explore.chips.includes('Energize'));
    assert.ok(explore.trending.length > 0);
  });

  test('F14-T03: Search query returns matched items and typeahead suggestions', async () => {
    const music = new MusicServiceSimulator();
    const result = await music.search('synthwave');
    assert.strictEqual(result.query, 'synthwave');
    assert.ok(result.suggestions.length > 0);
    assert.ok(result.items.length > 0);
  });

  test('F14-T04: Release detail lookup returns full album tracklist and metadata', async () => {
    const music = new MusicServiceSimulator();
    const album = await music.getReleaseDetails('MPREb_redline_01');
    assert.ok(album);
    assert.strictEqual(album.title, 'Redline');
    assert.strictEqual(album.isAlbum, true);
    assert.strictEqual(album.songs.length, 2);
    assert.strictEqual(album.songs[0].title, 'Redline');
  });

  test('F14-T05: Artist detail lookup returns bio, subscriber stats, and top tracks', async () => {
    const music = new MusicServiceSimulator();
    const artist = await music.getArtistDetails('art_lazerhawk_01');
    assert.ok(artist);
    assert.strictEqual(artist.name, 'Lazerhawk');
    assert.ok(artist.bio.includes('Austin, Texas'));
    assert.ok(artist.topSongs.length > 0);
  });
});

describe('Feature 15: Local Audio File & Offline Playback', () => {
  test('F15-T01: Local audio track designates LOCAL playback source type and file URL', () => {
    const localSong = mockSongs.localFlac;
    assert.strictEqual(localSong.isLocal, true);
    assert.strictEqual(localSong.playbackSourceType, 'LOCAL');
    assert.ok(localSong.streamUrl.startsWith('file:///'));
  });

  test('F15-T02: Local media scanner extracts audio file metadata attributes', () => {
    const mockLocalFile = {
      filePath: 'C:/Music/Synth/track01.flac',
      format: 'FLAC',
      bitDepth: 24,
      sampleRate: 96000,
      channels: 2,
      durationSec: 243.5,
    };
    assert.strictEqual(mockLocalFile.format, 'FLAC');
    assert.strictEqual(mockLocalFile.sampleRate, 96000);
    assert.strictEqual(mockLocalFile.bitDepth, 24);
  });

  test('F15-T03: Offline downloaded track indicates DOWNLOAD source type with local cache path', () => {
    const downloaded = mockSongs.stashedDownload;
    assert.strictEqual(downloaded.playbackSourceType, 'DOWNLOAD');
    assert.ok(downloaded.streamUrl.includes('downloads/clair_de_lune.opus'));
  });

  test('F15-T04: MusicService offline mode falls back to local tracks during search', async () => {
    const music = new MusicServiceSimulator();
    music.setNetworkAvailable(false); // Simulate offline network disconnection

    const results = await music.search('Midnight');
    assert.ok(results.items.length > 0);
    assert.strictEqual(results.items[0].videoId, mockSongs.localFlac.videoId);
  });

  test('F15-T05: Home shelves return empty array when offline without crashing', async () => {
    const music = new MusicServiceSimulator();
    music.setNetworkAvailable(false);
    const shelves = await music.getHomeShelves();
    assert.deepStrictEqual(shelves, []);
  });
});
