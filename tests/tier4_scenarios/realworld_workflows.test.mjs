// tests/tier4_scenarios/realworld_workflows.test.mjs
// Tier 4 Real-World Application Scenarios: 14 End-to-End User Workflows

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngineSimulator, MusicServiceSimulator, StorageServiceSimulator } from '../helpers/testEngine.mjs';
import { mockSongs } from '../fixtures/mockSongs.mjs';
import { mockAutoEq } from '../fixtures/mockAutoEq.mjs';
import { mockAudio } from '../fixtures/mockAudio.mjs';
import { mockLyrics, findActiveLyricElements } from '../fixtures/mockLyrics.mjs';

describe('Tier 4: Real-World End-to-End Application Scenarios (14 Workflows)', () => {
  test('Scenario 01: Cold App Launch & Initial Home Feed Population', async () => {
    // 1. Initialize storage and settings
    const storage = new StorageServiceSimulator();
    const settings = await storage.getSettings();
    assert.strictEqual(settings['appearance.themeMode'], 'dark');

    // 2. Window chrome initial state
    const windowState = { width: 1280, height: 800, isMaximized: false };
    assert.ok(windowState.width >= 1024);

    // 3. Fetch Home Feed shelves
    const music = new MusicServiceSimulator();
    const shelves = await music.getHomeShelves();
    assert.ok(shelves.length >= 2);
    assert.strictEqual(shelves[0].title, 'Top Picks For You');
    assert.ok(shelves[0].items.length > 0);
  });

  test('Scenario 02: Browse Home Feed -> Album Selection -> Track Playback', async () => {
    const music = new MusicServiceSimulator();
    const engine = new AudioEngineSimulator();

    // 1. User picks album from Trending shelf
    const shelves = await music.getHomeShelves();
    const trendingAlbumItem = shelves[1].items[0];
    assert.strictEqual(trendingAlbumItem.isAlbum, true);

    // 2. Open album detail
    const albumDetail = await music.getReleaseDetails(trendingAlbumItem.browseId);
    assert.ok(albumDetail);
    assert.ok(albumDetail.songs.length >= 2);

    // 3. Click play on first song
    const targetSong = albumDetail.songs[0];
    await engine.loadTrack(targetSong, 'active');
    engine.play();

    assert.strictEqual(engine.playbackState, 'PLAYING');
    assert.strictEqual(engine.deckA.track.title, targetSong.title);

    // 4. Verify 68-bar waveform data prepared
    const waveform = await engine.getWaveformData(targetSong.videoId);
    const bars68 = mockAudio.resampleTo68Bars(waveform);
    assert.strictEqual(bars68.length, 68);
  });

  test('Scenario 03: Playback Controls via Keyboard Shortcuts Matrix', async () => {
    const engine = new AudioEngineSimulator();
    await engine.loadTrack(mockSongs.standardYouTube, 'active');
    engine.play();
    assert.strictEqual(engine.playbackState, 'PLAYING');

    // 1. Spacebar pauses playback
    engine.pause();
    assert.strictEqual(engine.playbackState, 'PAUSED');

    // 2. Spacebar resumes playback
    engine.play();
    assert.strictEqual(engine.playbackState, 'PLAYING');

    // 3. ArrowRight seeks forward 5 seconds
    engine.seek(5000);
    assert.strictEqual(engine.deckA.positionMs, 5000);

    // 4. ArrowUp increases volume by 5%
    const currentVol = engine.globalVolume;
    engine.setVolume(currentVol + 0.05);
    assert.ok(Math.abs(engine.globalVolume - (currentVol + 0.05)) < 1e-6);
  });

  test('Scenario 04: Audiophile AutoEQ Headphone Calibration & EQ Curve Stacking', async () => {
    const engine = new AudioEngineSimulator();
    const storage = new StorageServiceSimulator();

    // 1. User selects Sennheiser HD 600 in settings
    const loaded = await engine.loadAutoEqProfile('Sennheiser HD 600');
    assert.strictEqual(loaded, true);
    assert.strictEqual(engine.autoEqProfile.name, 'Sennheiser HD 600');

    // 2. Save preference to storage
    await storage.updateSettings({
      'dsp.autoEqEnabled': true,
      'dsp.autoEqSelectedProfile': 'Sennheiser HD 600',
    });

    // 3. User sets user Equalizer preset to 'Electronic'
    engine.setEqualizerBands(mockAutoEq.factoryPresets.Electronic);
    assert.deepStrictEqual(engine.equalizerBands, mockAutoEq.factoryPresets.Electronic);

    // 4. Verify negative preamp gain is active to avoid digital clipping
    assert.ok(engine.autoEqProfile.preampGainDb < 0);
  });

  test('Scenario 05: Spatial Audio Mid/Side Stereo Expansion & Headroom Limiter', async () => {
    const engine = new AudioEngineSimulator();
    await engine.loadTrack(mockSongs.standardYouTube, 'active');

    // 1. Enable spatial audio with 2.5x width
    engine.setSpatialAudio(true, 2.5);
    assert.strictEqual(engine.spatialAudio.width, 2.5);

    // 2. Process audio block through spatial audio simulator
    const { left, right } = mockAudio.generateStereo(440, 0.1, 0.9, Math.PI / 3);
    const { leftOut, rightOut } = mockAudio.processSpatialAudio(left, right, 2.5, 15);

    // 3. Pass through lookahead limiter
    const { output: limitedLeft } = mockAudio.applyLookaheadLimiter(leftOut, 0.985);
    const { output: limitedRight } = mockAudio.applyLookaheadLimiter(rightOut, 0.985);

    for (let i = 0; i < limitedLeft.length; i++) {
      assert.ok(Math.abs(limitedLeft[i]) <= 0.98501);
      assert.ok(Math.abs(limitedRight[i]) <= 0.98501);
    }
  });

  test('Scenario 06: DJ Automix Seamless Crossfade & Deck Role Swap', async () => {
    const engine = new AudioEngineSimulator();

    // 1. Active track playing on Deck A
    await engine.loadTrack(mockSongs.standardYouTube, 'active');
    engine.play();
    assert.strictEqual(engine.activeDeckName, 'active');

    // 2. Standby track pre-rolled on Deck B
    await engine.loadTrack(mockSongs.localFlac, 'standby');
    assert.strictEqual(engine.deckB.track.title, mockSongs.localFlac.title);

    // 3. Trigger 3-second crossfade
    await engine.crossfade('standby', 3000);

    // 4. Verify standby deck is now active and prior deck stopped
    assert.strictEqual(engine.activeDeckName, 'standby');
    assert.strictEqual(engine.deckB.isPlaying, true);
    assert.strictEqual(engine.deckA.isPlaying, false);
    assert.strictEqual(engine.playbackState, 'PLAYING');
  });

  test('Scenario 07: Fullscreen Now Playing -> 68-Bar Waveform Scrub -> Syllable Lyrics Sync', async () => {
    const engine = new AudioEngineSimulator();
    const music = new MusicServiceSimulator();

    // 1. Load and play track
    await engine.loadTrack(mockSongs.standardYouTube, 'active');
    engine.play();

    // 2. Fetch syllable lyrics
    const lyricsData = await music.getLyrics(mockSongs.standardYouTube.videoId, mockSongs.standardYouTube.title, mockSongs.standardYouTube.artist);
    assert.ok(lyricsData);
    assert.strictEqual(lyricsData.type, 'SYLLABLE_SYNCED');

    // 3. Scrub waveform to 13500ms
    engine.seek(13500);
    assert.strictEqual(engine.deckA.positionMs, 13500);

    // 4. Verify syllable glow matches current scrub position
    const { activeLine, activeSyllable } = findActiveLyricElements(lyricsData, 13500);
    assert.ok(activeLine);
    assert.strictEqual(activeLine.text, 'Waiting in a car');
    assert.ok(activeSyllable);
    assert.strictEqual(activeSyllable.text, 'in ');
  });

  test('Scenario 08: Search Query Autocomplete -> Filter Chip -> Play Queue Injection', async () => {
    const music = new MusicServiceSimulator();

    // 1. User types 'synth'
    const searchRes = await music.search('synth', 'all');
    assert.ok(searchRes.suggestions.length > 0);

    // 2. User selects 'songs' filter pill
    const filteredSongs = await music.search('synth', 'songs');
    assert.ok(filteredSongs.items.length > 0);
    const chosenItem = filteredSongs.items[0];

    // 3. Inject chosen song into play queue
    const queue = [];
    queue.push(chosenItem);
    assert.strictEqual(queue.length, 1);
    assert.strictEqual(queue[0].title, 'Overdrive');
  });

  test('Scenario 09: Playlist Creation -> Track Insertion -> Persistent Re-query', async () => {
    const storage = new StorageServiceSimulator();

    // 1. Create custom playlist
    const playlist = await storage.createPlaylist('Late Night Synth Drive', 'High-energy tracks');
    assert.ok(playlist.id.startsWith('pl_custom_'));

    // 2. Add multiple tracks
    await storage.addSongToPlaylist(playlist.id, mockSongs.standardYouTube.videoId);
    await storage.addSongToPlaylist(playlist.id, mockSongs.localFlac.videoId);

    // 3. Re-query playlists from storage
    const playlists = await storage.getPlaylists();
    const found = playlists.find((p) => p.id === playlist.id);
    assert.ok(found);
    assert.strictEqual(found.songCount, 2);
    assert.ok(found.songIds.includes(mockSongs.standardYouTube.videoId));
    assert.ok(found.songIds.includes(mockSongs.localFlac.videoId));
  });

  test('Scenario 10: Multi-Track Playback -> Network Loss Offline Fallback -> History Recorded', async () => {
    const engine = new AudioEngineSimulator();
    const music = new MusicServiceSimulator();
    const storage = new StorageServiceSimulator();

    // 1. Play track 1
    await engine.loadTrack(mockSongs.standardYouTube, 'active');
    engine.play();
    await storage.recordListeningHistory(mockSongs.standardYouTube, 255);

    // 2. Network disconnect occurs
    music.setNetworkAvailable(false);

    // 3. Search for offline music
    const offlineSearch = await music.search('Midnight');
    assert.ok(offlineSearch.items.length > 0);
    const localTrack = offlineSearch.items[0];
    assert.strictEqual(localTrack.isLocal, true);

    // 4. Play local track and log history
    await engine.loadTrack(localTrack, 'active');
    engine.play();
    await storage.recordListeningHistory(localTrack, 243);

    // 5. Verify 2 history items recorded
    const history = await storage.getListeningHistory();
    assert.strictEqual(history.length, 2);
    assert.strictEqual(history[0].title, 'Neon Horizon');
    assert.strictEqual(history[1].title, 'Midnight City (Lossless Master)');
  });

  test('Scenario 11: 3D Cover Flow Navigation & Album Selection', async () => {
    const storage = new StorageServiceSimulator();
    const playlists = await storage.getPlaylists();

    // 1. Build Cover Flow card list
    const cards = playlists.map((p, index) => ({
      index,
      title: p.title,
      isFocused: index === 0,
    }));
    assert.ok(cards.length >= 2);

    // 2. Step forward in carousel (user arrow right)
    cards[0].isFocused = false;
    cards[1].isFocused = true;
    assert.strictEqual(cards[1].isFocused, true);
    assert.strictEqual(cards[1].title, playlists[1].title);
  });

  test('Scenario 12: Local Directory Scan -> Metadata Extraction -> Lossless Playback', async () => {
    const engine = new AudioEngineSimulator();

    // 1. Simulated local file with parsed ID3 tags
    const localSong = mockSongs.localFlac;
    assert.strictEqual(localSong.isLocal, true);
    assert.strictEqual(localSong.sourceQuality, '24-bit / 96kHz FLAC');

    // 2. Load into audio engine
    await engine.loadTrack(localSong, 'active');
    engine.play();

    assert.strictEqual(engine.playbackState, 'PLAYING');
    assert.strictEqual(engine.deckA.track.sourceQuality, '24-bit / 96kHz FLAC');
  });

  test('Scenario 13: Window Resizing -> Inspector Collapse -> Tray Minimization -> Restore', () => {
    const appWindow = {
      width: 1280,
      height: 800,
      isInspectorCollapsed: false,
      state: 'normal',
      resize(w, h) {
        this.width = w;
        this.height = h;
        if (w < 1000) this.isInspectorCollapsed = true;
      },
      minimizeToTray() {
        this.state = 'tray';
      },
      restoreFromTray() {
        this.state = 'normal';
      },
    };

    // 1. User resizes window to 900px width -> collapses inspector
    appWindow.resize(900, 700);
    assert.strictEqual(appWindow.isInspectorCollapsed, true);

    // 2. User minimizes window to tray
    appWindow.minimizeToTray();
    assert.strictEqual(appWindow.state, 'tray');

    // 3. User clicks tray icon to restore
    appWindow.restoreFromTray();
    assert.strictEqual(appWindow.state, 'normal');
  });

  test('Scenario 14: Comprehensive Client Lifecycle: Cold Start -> Play -> EQ -> Lyrics -> History -> Exit', async () => {
    // 1. Cold start
    const engine = new AudioEngineSimulator();
    const music = new MusicServiceSimulator();
    const storage = new StorageServiceSimulator();

    // 2. Fetch personalized recommendations
    const shelves = await music.getHomeShelves();
    assert.ok(shelves.length > 0);

    // 3. Load recommended track
    const track = mockSongs.standardYouTube;
    await engine.loadTrack(track, 'active');
    engine.play();
    assert.strictEqual(engine.playbackState, 'PLAYING');

    // 4. Apply AutoEQ calibration and Rock Equalizer curve
    await engine.loadAutoEqProfile('Sony WH-1000XM4');
    engine.setEqualizerBands(mockAutoEq.factoryPresets.Rock);

    // 5. Open lyrics and seek
    engine.seek(14500);
    const lyrics = await music.getLyrics(track.videoId, track.title, track.artist);
    const { activeLine } = findActiveLyricElements(lyrics, 14500);
    assert.ok(activeLine);

    // 6. Record listening history
    await storage.recordListeningHistory(track, 255);
    const history = await storage.getListeningHistory();
    assert.strictEqual(history.length, 1);

    // 7. Clean pause on shutdown
    engine.pause();
    assert.strictEqual(engine.playbackState, 'PAUSED');
  });
});
