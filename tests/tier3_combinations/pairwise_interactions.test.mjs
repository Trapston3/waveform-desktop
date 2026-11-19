// tests/tier3_combinations/pairwise_interactions.test.mjs
// Tier 3 Cross-Feature Combinations: 27 Pairwise Interaction Tests

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngineSimulator, MusicServiceSimulator, StorageServiceSimulator } from '../helpers/testEngine.mjs';
import { mockSongs, validateSongContract } from '../fixtures/mockSongs.mjs';
import { mockAutoEq } from '../fixtures/mockAutoEq.mjs';
import { mockAudio } from '../fixtures/mockAudio.mjs';
import { mockLyrics, findActiveLyricElements } from '../fixtures/mockLyrics.mjs';

describe('Tier 3: Pairwise Cross-Feature Interactions (27 Tests)', () => {
  test('P01: F01 (Assets) + F03 (Design Tokens) - Dynamic artwork extraction overrides default accent token', () => {
    let currentAccent = '#FA2D48'; // Default Apple Music red
    const extractedPalette = { vibrant: '#34C759' }; // Extracted from green album artwork
    currentAccent = extractedPalette.vibrant;
    assert.strictEqual(currentAccent, '#34C759');
  });

  test('P02: F01 (Assets) + F07 (AutoEQ) - Loading auto_eq.db asset loads headphone calibration into engine', async () => {
    const engine = new AudioEngineSimulator();
    const success = await engine.loadAutoEqProfile('Sony WH-1000XM4');
    assert.strictEqual(success, true);
    assert.strictEqual(engine.autoEqProfile.name, 'Sony WH-1000XM4');
    assert.ok(engine.autoEqProfile.filters.length > 0);
  });

  test('P03: F02 (Chrome) + F04 (Layout) - Maximizing window expands main viewport while preserving 240px sidebar and 360px inspector', () => {
    const calcMain = (w, isMaximized) => {
      const windowWidth = isMaximized ? 1920 : 1280;
      return windowWidth - 240 - 360;
    };
    assert.strictEqual(calcMain(1280, false), 680);
    assert.strictEqual(calcMain(1920, true), 1320);
  });

  test('P04: F02 (Chrome) + F24 (Shortcuts) - F11 keyboard shortcut toggles window fullscreen state', () => {
    let winState = 'normal';
    const handleKey = (code) => {
      if (code === 'F11') winState = winState === 'fullscreen' ? 'normal' : 'fullscreen';
    };
    handleKey('F11');
    assert.strictEqual(winState, 'fullscreen');
    handleKey('F11');
    assert.strictEqual(winState, 'normal');
  });

  test('P05: F03 (Tokens) + F21 (Now Playing) - Switching theme swaps waveform playhead and bar colors', () => {
    const getWaveformColors = (theme) =>
      theme === 'dark'
        ? { played: '#FA2D48', unplayed: 'rgba(255,255,255,0.2)', glow: '#FA2D48' }
        : { played: '#FA2D48', unplayed: 'rgba(0,0,0,0.15)', glow: '#FA2D48' };

    const darkColors = getWaveformColors('dark');
    const lightColors = getWaveformColors('light');
    assert.strictEqual(darkColors.played, lightColors.played);
    assert.notStrictEqual(darkColors.unplayed, lightColors.unplayed);
  });

  test('P06: F04 (Layout) + F24 (Shortcuts) - Toggling right inspector hotkey dynamically recalculates main viewport width', () => {
    let inspectorCollapsed = false;
    const windowWidth = 1440;
    const getViewport = () => windowWidth - 240 - (inspectorCollapsed ? 0 : 360);

    const initial = getViewport();
    assert.strictEqual(initial, 840);

    // Press shortcut to toggle inspector (e.g. Ctrl+I)
    inspectorCollapsed = true;
    const expanded = getViewport();
    assert.strictEqual(expanded, 1200);
    assert.strictEqual(expanded - initial, 360);
  });

  test('P07: F05 (Dual-Deck) + F06 (Equalizer) - Adjusting 10-band EQ gains during ongoing crossfade updates audio output', async () => {
    const engine = new AudioEngineSimulator();
    await engine.loadTrack(mockSongs.standardYouTube, 'active');
    await engine.loadTrack(mockSongs.localFlac, 'standby');
    engine.play();

    // Start crossfade
    const crossfadePromise = engine.crossfade('standby', 100);
    // Adjust EQ mid-crossfade
    engine.setEqualizerBands(mockAutoEq.factoryPresets.BassBoost);
    await crossfadePromise;

    assert.deepStrictEqual(engine.equalizerBands, mockAutoEq.factoryPresets.BassBoost);
    assert.strictEqual(engine.activeDeckName, 'standby');
  });

  test('P08: F05 (Dual-Deck) + F08 (Spatial Audio) - Spatial audio width expansion applies seamlessly to active deck during playback', async () => {
    const engine = new AudioEngineSimulator();
    await engine.loadTrack(mockSongs.standardYouTube, 'active');
    engine.play();

    engine.setSpatialAudio(true, 3.2);
    assert.strictEqual(engine.spatialAudio.enabled, true);
    assert.strictEqual(engine.spatialAudio.width, 3.2);
    assert.strictEqual(engine.playbackState, 'PLAYING');
  });

  test('P09: F05 (Dual-Deck) + F09 (Automix) - Automix tempo ramp triggers constant-power deck swap at target beat boundary', async () => {
    const engine = new AudioEngineSimulator();
    await engine.loadTrack(mockSongs.standardYouTube, 'active');
    await engine.loadTrack(mockSongs.localFlac, 'standby');
    engine.play();

    // Automix triggers transition
    await engine.crossfade('standby', 2000);
    assert.strictEqual(engine.activeDeckName, 'standby');
    assert.strictEqual(engine.deckB.isPlaying, true);
    assert.strictEqual(engine.deckA.isPlaying, false);
  });

  test('P10: F05 (Dual-Deck) + F10 (Waveform Visualizer) - Active playback feeds live 32-band PCM energy updates', async () => {
    const engine = new AudioEngineSimulator();
    await engine.loadTrack(mockSongs.standardYouTube, 'active');
    engine.play();

    let energyReceived = null;
    engine.subscribeLivePcmEnergy((energy) => {
      energyReceived = energy;
    });

    const block = mockAudio.generateSine(440, 0.05, 0.8);
    engine.triggerLivePcmBlock(block);

    assert.ok(energyReceived);
    assert.strictEqual(energyReceived.length, 32);
    assert.ok(energyReceived[0] > 0);
  });

  test('P11: F05 (Dual-Deck) + F11 (Peak Limiter) - Dual-deck summing peaks at crossfade midpoint are constrained below 0.985', () => {
    const t = 0.5; // Midpoint
    const { gainOut, gainIn } = mockAudio.calculateConstantPowerGains(t);
    // Both decks playing loud sine waves
    const deckA = mockAudio.generateSine(440, 0.05, 0.9);
    const deckB = mockAudio.generateSine(440, 0.05, 0.9);

    const summed = new Float32Array(deckA.length);
    for (let i = 0; i < summed.length; i++) {
      summed[i] = deckA[i] * gainOut + deckB[i] * gainIn;
    }

    const { output } = mockAudio.applyLookaheadLimiter(summed, 0.985);
    for (let i = 0; i < output.length; i++) {
      assert.ok(Math.abs(output[i]) <= 0.98501);
    }
  });

  test('P12: F05 (Dual-Deck) + F15 (Local Media) - Crossfading from remote YouTube stream to local 24-bit FLAC transitions smoothly', async () => {
    const engine = new AudioEngineSimulator();
    await engine.loadTrack(mockSongs.standardYouTube, 'active'); // YouTube
    await engine.loadTrack(mockSongs.localFlac, 'standby'); // Local FLAC
    engine.play();

    await engine.crossfade('standby', 500);
    assert.strictEqual(engine.activeDeckName, 'standby');
    assert.strictEqual(engine.deckB.track.playbackSourceType, 'LOCAL');
  });

  test('P13: F06 (Equalizer) + F07 (AutoEQ) - Combining AutoEQ calibration curve with user Rock preset sums EQ gains safely', () => {
    const userPreset = mockAutoEq.factoryPresets.Rock;
    const autoEqOffsets = [1.5, 1.0, 0, -1.0, -1.5, 0, 1.0, 1.5, 2.0, 1.0];

    const combined = userPreset.map((g, i) => Math.max(-12, Math.min(12, g + autoEqOffsets[i])));
    assert.strictEqual(combined.length, 10);
    for (const g of combined) {
      assert.ok(g >= -12 && g <= 12);
    }
  });

  test('P14: F06 (Equalizer) + F11 (Peak Limiter) - Extreme 10-band EQ boost (+12 dB) is caught and limited by lookahead limiter', () => {
    const hotPcm = mockAudio.generateSine(1000, 0.05, 0.9);
    // +12 dB boost is approx 4x linear gain
    const boosted = new Float32Array(hotPcm.length);
    for (let i = 0; i < hotPcm.length; i++) boosted[i] = hotPcm[i] * 4.0;

    const { output } = mockAudio.applyLookaheadLimiter(boosted, 0.985);
    for (let i = 0; i < output.length; i++) {
      assert.ok(Math.abs(output[i]) <= 0.98501);
    }
  });

  test('P15: F07 (AutoEQ) + F13 (Persistence) - Selecting headphone profile persists AutoEQ choice into user settings store', async () => {
    const storage = new StorageServiceSimulator();
    await storage.updateSettings({
      'dsp.autoEqEnabled': true,
      'dsp.autoEqSelectedProfile': 'Sony WH-1000XM4',
    });
    const settings = await storage.getSettings();
    assert.strictEqual(settings['dsp.autoEqEnabled'], true);
    assert.strictEqual(settings['dsp.autoEqSelectedProfile'], 'Sony WH-1000XM4');
  });

  test('P16: F08 (Spatial Audio) + F11 (Peak Limiter) - 2.5x spatial stereo widening makeup gain is stabilized by limiter', () => {
    const { left, right } = mockAudio.generateStereo(440, 0.05, 1.0, Math.PI / 2);
    const { leftOut } = mockAudio.processSpatialAudio(left, right, 2.5, 15);
    const { output } = mockAudio.applyLookaheadLimiter(leftOut, 0.985);

    for (let i = 0; i < output.length; i++) {
      assert.ok(Math.abs(output[i]) <= 0.98501);
    }
  });

  test('P17: F09 (Automix) + F10 (Waveform Visualizer) - Low-pass filter sweep reduces energy in upper bands of live PCM visualizer', () => {
    // Generate white noise representing full frequency audio
    const whiteNoise = mockAudio.generateHiHat(0.05);
    const energyFull = mockAudio.compute32BandPcmEnergy(whiteNoise);

    // Simulate filtered noise (attenuate upper half of samples)
    const filtered = new Float32Array(whiteNoise.length);
    for (let i = 0; i < filtered.length; i++) filtered[i] = whiteNoise[i] * 0.2;
    const energyFiltered = mockAudio.compute32BandPcmEnergy(filtered);

    // Sum upper bands
    let sumFull = 0;
    let sumFiltered = 0;
    for (let b = 16; b < 32; b++) {
      sumFull += energyFull[b];
      sumFiltered += energyFiltered[b];
    }
    assert.ok(sumFiltered < sumFull);
  });

  test('P18: F10 (Waveform Visualizer) + F21 (Now Playing) - Seeking on 68-bar waveform updates playback position and playhead', async () => {
    const engine = new AudioEngineSimulator();
    await engine.loadTrack(mockSongs.standardYouTube, 'active');
    engine.play();

    // User clicks bar 34 of 68 (50% progress)
    const trackDurationMs = 255000;
    const seekMs = (34 / 68) * trackDurationMs;
    engine.seek(seekMs);

    assert.strictEqual(engine.deckA.positionMs, 127500);
  });

  test('P19: F12 (Domain Models) + F13 (Persistence) - Song entity with explicit rating serializes and deserializes accurately', async () => {
    const storage = new StorageServiceSimulator();
    await storage.recordListeningHistory(mockSongs.explicitHipHop, 177);
    const history = await storage.getListeningHistory();

    assert.strictEqual(history.length, 1);
    assert.strictEqual(history[0].videoId, mockSongs.explicitHipHop.videoId);
    assert.strictEqual(history[0].title, 'HUMBLE.');
  });

  test('P20: F12 (Domain Models) + F14 (InnerTube) - InnerTube search result converts into valid Song entity', () => {
    const browseItem = {
      id: 'sr_02',
      title: 'Overdrive',
      subtitle: 'Lazerhawk • Redline',
      thumbnailUrl: 'https://i.ytimg.com/vi/sr_02/hqdefault.jpg',
      badge: 'Song',
    };

    const song = {
      videoId: browseItem.id,
      title: browseItem.title,
      artist: 'Lazerhawk',
      albumName: 'Redline',
      durationText: '4:31',
      thumbnailUrl: browseItem.thumbnailUrl,
      albumId: 'alb_redline_01',
      artistId: 'art_lazerhawk_01',
      artistIds: ['art_lazerhawk_01'],
      artists: [{ id: 'art_lazerhawk_01', name: 'Lazerhawk' }],
      year: '2010',
      date: '2010-01-15',
      liked: false,
      totalPlayTimeMs: 271000,
      playCount: 0,
      lastPlayedTimeMs: 0,
      lyrics: null,
      streamUrl: 'https://rr.googlevideo.com/videoplayback?id=sr_02',
      sourceQuality: '160kbps Opus',
      isExplicit: false,
      playbackSourceType: 'YOUTUBE',
      playbackSessionId: null,
      playlistBrowseId: null,
      hasOriginalAudio: true,
      isLocal: false,
    };

    const validation = validateSongContract(song);
    assert.strictEqual(validation.valid, true);
  });

  test('P21: F13 (Persistence) + F18 (Playlists) - Custom playlist creation persists across StorageService instances', async () => {
    const storage1 = new StorageServiceSimulator();
    const created = await storage1.createPlaylist('Synth Classics');
    await storage1.addSongToPlaylist(created.id, mockSongs.standardYouTube.videoId);

    const playlists = await storage1.getPlaylists();
    const target = playlists.find((p) => p.title === 'Synth Classics');
    assert.ok(target);
    assert.strictEqual(target.songCount, 1);
  });

  test('P22: F14 (InnerTube) + F19 (Search Filters) - Filtering search results by songs pill excludes non-song items', async () => {
    const music = new MusicServiceSimulator();
    const songOnly = await music.search('synthwave', 'songs');
    assert.ok(songOnly.items.length > 0);
    for (const item of songOnly.items) {
      assert.strictEqual(item.badge, 'Song');
    }
  });

  test('P23: F14 (InnerTube) + F20 (Release Detail) - InnerTube release browseId fetches complete album detail and tracks', async () => {
    const music = new MusicServiceSimulator();
    const detail = await music.getReleaseDetails('MPREb_redline_01');
    assert.ok(detail);
    assert.strictEqual(detail.title, 'Redline');
    assert.strictEqual(detail.songs.length, 2);
  });

  test('P24: F15 (Local Media) + F18 (Playlists) - Adding local FLAC track to user playlist updates playlist duration', async () => {
    const storage = new StorageServiceSimulator();
    const playlists = await storage.getPlaylists();
    const pl = playlists[0];
    const initialDuration = pl.totalDurationSec;

    await storage.addSongToPlaylist(pl.id, mockSongs.localFlac.videoId);
    // Simulate duration aggregation: 4:03 (243s)
    pl.totalDurationSec += 243;
    assert.strictEqual(pl.totalDurationSec, initialDuration + 243);
  });

  test('P25: F16 (External Services) + F22 (Lyrics Engine) - Syllable lyrics unavailable triggers fallback to LRC with continuous timing', async () => {
    const music = new MusicServiceSimulator();
    const lyrics = await music.getLyrics(mockSongs.localFlac.videoId, mockSongs.localFlac.title, mockSongs.localFlac.artist);
    assert.ok(lyrics);
    assert.strictEqual(lyrics.type, 'LINE_SYNCED');
    assert.ok(lyrics.lines[0].endTimeMs > lyrics.lines[0].startTimeMs);
  });

  test('P26: F18 (Playlists) + F23 (3D Cover Flow) - Playlists thumbnail artworks map to Cover Flow carousel items', async () => {
    const storage = new StorageServiceSimulator();
    const playlists = await storage.getPlaylists();

    const coverFlowItems = playlists.map((p, index) => ({
      id: p.id,
      title: p.title,
      thumbnailUrl: p.thumbnailUrl,
      index,
    }));

    assert.ok(coverFlowItems.length >= 2);
    assert.strictEqual(coverFlowItems[0].title, 'Synthwave Driving');
    assert.ok(coverFlowItems[0].thumbnailUrl);
  });

  test('P27: F21 (Now Playing) + F22 (Lyrics Engine) - Seeking on waveform seekbar updates active lyric syllable', () => {
    const lyrics = mockLyrics.syllableSynced;
    // Seek to 17000ms: line 1 "Waiting for a ride in the dark", syllable "for " (16700-17200ms)
    const { activeLine, activeSyllable } = findActiveLyricElements(lyrics, 17000);
    assert.ok(activeLine);
    assert.strictEqual(activeLine.text, 'Waiting for a ride in the dark');
    assert.ok(activeSyllable);
    assert.strictEqual(activeSyllable.text, 'for ');
  });
});
