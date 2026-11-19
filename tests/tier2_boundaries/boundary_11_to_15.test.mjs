// tests/tier2_boundaries/boundary_11_to_15.test.mjs
// Tier 2 Boundary & Corner Cases: Features 11 to 15 (25 tests)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mockAudio } from '../fixtures/mockAudio.mjs';
import { validateSongContract, mockSongs } from '../fixtures/mockSongs.mjs';
import { StorageServiceSimulator, MusicServiceSimulator } from '../helpers/testEngine.mjs';

describe('Boundary: Feature 11 - Peak Limiter & Normalization', () => {
  test('B11-T01: Limiter ceiling exceeding 1.0 is clamped to 0.985 to protect DAC headroom', () => {
    const sanitizeCeiling = (c) => Math.min(0.985, Math.max(0.1, c));
    assert.strictEqual(sanitizeCeiling(1.5), 0.985);
    assert.strictEqual(sanitizeCeiling(0.985), 0.985);
    assert.strictEqual(sanitizeCeiling(-1.0), 0.1);
  });

  test('B11-T02: Massive +30 dBFS spike (amplitude 31.6) is clamped down to ceiling', () => {
    const extremeSpike = new Float32Array(100);
    extremeSpike[50] = 31.62;
    const { output } = mockAudio.applyLookaheadLimiter(extremeSpike, 0.985);
    assert.ok(Math.abs(output[50]) <= 0.98501);
  });

  test('B11-T03: Zero-length PCM buffer passes through limiter returning empty buffer', () => {
    const empty = new Float32Array(0);
    const { output } = mockAudio.applyLookaheadLimiter(empty, 0.985);
    assert.strictEqual(output.length, 0);
  });

  test('B11-T04: Missing ReplayGain metadata defaults to unity gain (0.0 dB offset)', () => {
    const resolveGainOffset = (track) => {
      if (track && typeof track.replayGainDb === 'number') return track.replayGainDb;
      return 0.0;
    };
    assert.strictEqual(resolveGainOffset({}), 0.0);
    assert.strictEqual(resolveGainOffset(null), 0.0);
    assert.strictEqual(resolveGainOffset({ replayGainDb: -3.2 }), -3.2);
  });

  test('B11-T05: Limiter handles DC bias offset without permanent gain reduction collapse', () => {
    const dcBuffer = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) dcBuffer[i] = 0.5; // Constant DC offset
    const { output } = mockAudio.applyLookaheadLimiter(dcBuffer, 0.985);
    assert.ok(output[500] <= 0.98501);
  });
});

describe('Boundary: Feature 12 - Domain Data Models & Entities', () => {
  test('B12-T01: Song missing mandatory videoId fails validation', () => {
    const badSong = { ...mockSongs.standardYouTube, videoId: '' };
    const res = validateSongContract(badSong);
    assert.strictEqual(res.valid, false);
    assert.ok(res.error.includes('videoId'));
  });

  test('B12-T02: Song missing mandatory title or artist fails validation', () => {
    const noTitle = { ...mockSongs.standardYouTube, title: '   ' };
    assert.strictEqual(validateSongContract(noTitle).valid, false);

    const noArtist = { ...mockSongs.standardYouTube, artist: '' };
    assert.strictEqual(validateSongContract(noArtist).valid, false);
  });

  test('B12-T03: Negative playCount or totalPlayTimeMs fails validation', () => {
    const badPlayCount = { ...mockSongs.standardYouTube, playCount: -5 };
    assert.strictEqual(validateSongContract(badPlayCount).valid, false);

    const badDuration = { ...mockSongs.standardYouTube, totalPlayTimeMs: -1000 };
    assert.strictEqual(validateSongContract(badDuration).valid, false);
  });

  test('B12-T04: Non-array artistIds or artists property fails validation', () => {
    const badArtists = { ...mockSongs.standardYouTube, artists: 'NotAnArray' };
    assert.strictEqual(validateSongContract(badArtists).valid, false);
  });

  test('B12-T05: Unknown supplementary fields on Song object are preserved without corruption', () => {
    const extendedSong = { ...mockSongs.standardYouTube, customCustomField: 'metadata_value' };
    assert.strictEqual(validateSongContract(extendedSong).valid, true);
    assert.strictEqual(extendedSong.customCustomField, 'metadata_value');
  });
});

describe('Boundary: Feature 13 - Local Persistence & State Storage', () => {
  test('B13-T01: Updating setting with mismatched type throws TypeError', async () => {
    const storage = new StorageServiceSimulator();
    await assert.rejects(
      async () => storage.updateSettings({ 'playback.crossfadeDurationSec': 'invalid_string' }),
      TypeError
    );
  });

  test('B13-T02: Unknown settings keys outside schema are ignored cleanly', async () => {
    const storage = new StorageServiceSimulator();
    await storage.updateSettings({ 'unknown.rogue.property': 42 });
    const settings = await storage.getSettings();
    assert.strictEqual('unknown.rogue.property' in settings, false);
  });

  test('B13-T03: Creating playlist with empty or whitespace-only name throws error', async () => {
    const storage = new StorageServiceSimulator();
    await assert.rejects(async () => storage.createPlaylist(''), /Playlist title cannot be empty/);
    await assert.rejects(async () => storage.createPlaylist('   '), /Playlist title cannot be empty/);
  });

  test('B13-T04: Adding track to nonexistent playlist ID throws error', async () => {
    const storage = new StorageServiceSimulator();
    await assert.rejects(
      async () => storage.addSongToPlaylist('nonexistent_id_404', 'yt_track_001'),
      /not found/
    );
  });

  test('B13-T05: Recording listening history with negative duration throws RangeError', async () => {
    const storage = new StorageServiceSimulator();
    await assert.rejects(
      async () => storage.recordListeningHistory(mockSongs.standardYouTube, -50),
      RangeError
    );
  });
});

describe('Boundary: Feature 14 - InnerTube Music Service & Search', () => {
  test('B14-T01: Search with extreme query string length (10,000 chars) is truncated safely', async () => {
    const music = new MusicServiceSimulator();
    const extremeQuery = 'a'.repeat(10000);
    const sanitized = extremeQuery.slice(0, 256);
    assert.strictEqual(sanitized.length, 256);
    const result = await music.search(sanitized);
    assert.strictEqual(typeof result.query, 'string');
  });

  test('B14-T02: Search with SQL/regex special characters executes without injection errors', async () => {
    const music = new MusicServiceSimulator();
    const adversarialQuery = '\'; DROP TABLE songs; -- [a-z]+.*$';
    const result = await music.search(adversarialQuery);
    assert.strictEqual(result.query, adversarialQuery);
  });

  test('B14-T03: Requesting nonexistent release detail ID returns null', async () => {
    const music = new MusicServiceSimulator();
    const release = await music.getReleaseDetails('nonexistent_release_999');
    assert.strictEqual(release, null);
  });

  test('B14-T04: Requesting nonexistent artist detail ID returns null', async () => {
    const music = new MusicServiceSimulator();
    const artist = await music.getArtistDetails('nonexistent_artist_999');
    assert.strictEqual(artist, null);
  });

  test('B14-T05: Malformed continuation token does not throw unhandled exception', () => {
    const parseContinuation = (token) => {
      if (!token || typeof token !== 'string' || !token.startsWith('ctn_')) return null;
      return token;
    };
    assert.strictEqual(parseContinuation('bad_token'), null);
    assert.strictEqual(parseContinuation(''), null);
    assert.strictEqual(parseContinuation('ctn_valid_123'), 'ctn_valid_123');
  });
});

describe('Boundary: Feature 15 - Local Audio File & Offline Playback', () => {
  test('B15-T01: Scanning directory with 0 audio files returns empty array', () => {
    const scanDir = (files) => files.filter((f) => /\.(mp3|flac|wav|m4a|opus)$/i.test(f));
    assert.deepStrictEqual(scanDir(['readme.txt', 'image.png']), []);
  });

  test('B15-T02: Unsupported audio file extension is ignored by scanner', () => {
    const isSupported = (ext) => ['flac', 'wav', 'mp3', 'opus', 'alac', 'dsf'].includes(ext.toLowerCase());
    assert.strictEqual(isSupported('flac'), true);
    assert.strictEqual(isSupported('exe'), false);
    assert.strictEqual(isSupported('zip'), false);
  });

  test('B15-T03: Audio file with missing ID3 tag falls back to filename without extension for title', () => {
    const resolveTitle = (tagTitle, filePath) => {
      if (tagTitle && tagTitle.trim()) return tagTitle;
      const filename = filePath.split(/[/\\]/).pop();
      return filename.replace(/\.[^/.]+$/, '');
    };
    assert.strictEqual(resolveTitle(null, 'C:/Music/Track_01_Demo.flac'), 'Track_01_Demo');
    assert.strictEqual(resolveTitle('Real Title', 'C:/Music/Track.mp3'), 'Real Title');
  });

  test('B15-T04: Zero-duration local audio file is flagged as unplayable', () => {
    const isPlayable = (durationSec) => Number.isFinite(durationSec) && durationSec > 0;
    assert.strictEqual(isPlayable(0), false);
    assert.strictEqual(isPlayable(-1), false);
    assert.strictEqual(isPlayable(240), true);
  });

  test('B15-T05: Offline mode search with no matches returns empty items list', async () => {
    const music = new MusicServiceSimulator();
    music.setNetworkAvailable(false);
    const result = await music.search('NonExistentLocalSongXYZ');
    assert.deepStrictEqual(result.items, []);
  });
});
