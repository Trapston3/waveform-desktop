// tests/verify_live_streaming_search_liquid_glass.mjs
// End-to-end verification of Live Search, Autocomplete Suggestions, Category Filters,
// Multi-Client Audio Stream Resolution (HTTP 200/206 byte-range check), and Liquid Glass UI parity.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';

const resolverHook = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && !specifier.endsWith('.ts') && !specifier.endsWith('.tsx') && !specifier.endsWith('.js') && !specifier.endsWith('.mjs')) {
      for (const ext of ['.ts', '.tsx', '/index.ts']) {
        try {
          return await nextResolve(specifier + ext, context);
        } catch {}
      }
    }
    throw err;
  }
}
`;
register(`data:text/javascript,${encodeURIComponent(resolverHook)}`, import.meta.url);

const { MusicService } = await import('../src/services/MusicService.ts');
const { StreamResolver } = await import('../src/services/StreamResolver.ts');
const { extractArtworkPaletteFromUrl } = await import('../src/ui/theme/Theme.ts');
const { normalizeSong } = await import('../src/models/Song.ts');
const { AudioEngine } = await import('../src/audio/AudioEngine.ts');
const { StorageService } = await import('../src/services/StorageService.ts');

describe('Live Streaming, Search & Liquid Glass Verification Suite', () => {
  const musicService = new MusicService();
  const streamResolver = new StreamResolver();

  it('1. Unfiltered ("all") and filtered Live Search unwrap itemSectionRenderer shelves to return full results', async () => {
    const allRes = await musicService.search('The Weeknd', 'all');
    assert.ok(allRes.items.length >= 15, `Expected >= 15 unfiltered results across shelves, got ${allRes.items.length}`);
    const first = allRes.items[0];
    assert.ok(first.id && first.title, 'First search result must have id and title');

    const songsRes = await musicService.search('Daft Punk', 'songs');
    assert.ok(songsRes.items.length >= 5, 'Filtered songs search must return tracks');
    const songItem = songsRes.items[0];
    assert.equal(songItem.isAlbum, false, 'Songs filter item must not be an album');
    assert.equal(songItem.isArtist, false, 'Songs filter item must not be an artist');
  });

  it('2. Live Search Autocomplete Suggestions return real typeahead completions', async () => {
    const suggestions = await musicService.getSearchSuggestions('Blinding');
    assert.ok(Array.isArray(suggestions) && suggestions.length > 0, 'Must return non-empty suggestions');
  });

  it('3. Multi-Client StreamResolver resolves full-length (> 200s) googlevideo Opus stream with HTTP 200/206 byte range and valid HTTP 200 artwork', async () => {
    const resolved = await streamResolver.resolve('yt_track_001', 'Overdrive', 'Lazerhawk');
    assert.ok(resolved, 'StreamResolver must resolve a stream for yt_track_001');
    assert.ok(resolved.url.startsWith('http'), `Stream URL must be HTTP(S), got ${resolved.url}`);
    assert.ok(
      resolved.durationMs > 200000,
      `Expected full-length track (> 200000ms), got ${resolved.durationMs}ms`
    );

    // Verify actual audio bytes are streamable with a Range request
    const res = await fetch(resolved.url, {
      method: 'GET',
      headers: {
        Range: 'bytes=0-1023',
        'User-Agent':
          'com.google.android.apps.youtube.vr.oculus/1.61.48 (Linux; U; Android 12; en_US; Oculus Quest 3; Build/SQ3A.220605.009.A1; Cronet/132.0.6808.3)',
      },
    });
    assert.ok(
      res.status === 200 || res.status === 206,
      `Expected HTTP 200 or 206 from resolved audio stream, got ${res.status}`
    );
    const contentType = res.headers.get('content-type') || '';
    assert.ok(
      contentType.includes('audio') || contentType.includes('video') || contentType.includes('octet-stream'),
      `Expected audio/video content-type, got ${contentType}`
    );

    // Verify default fallback thumbnail returns HTTP 200 (no dead 404 video IDs)
    const thumbRes = await fetch('https://i.ytimg.com/vi/5dNP-a-XXx0/hqdefault.jpg', { method: 'HEAD' });
    assert.equal(thumbRes.status, 200, 'Default fallback artwork must return HTTP 200');
  });

  it('4. normalizeSong parses durationText and secondaryText ("mm:ss" / "h:mm:ss") into durationSec and totalPlayTimeMs', () => {
    const songFromSearch = normalizeSong({
      id: '5dNP-a-XXx0',
      title: 'Overdrive',
      artist: 'Lazerhawk',
      secondaryText: '4:29',
    });
    assert.equal(songFromSearch.durationText, '4:29');
    assert.equal(songFromSearch.durationSec, 269);
    assert.equal(songFromSearch.totalPlayTimeMs, 269000);

    const songWithHour = normalizeSong({
      id: 'mix_01',
      title: 'Synthwave Mix',
      artist: 'Various',
      secondaryText: '1:02:05',
    });
    assert.equal(songWithHour.durationSec, 3725);
    assert.equal(songWithHour.totalPlayTimeMs, 3725000);
  });

  it('5. AudioEngine WebAudioDeck clears previous audio element src when loading a track with pending streamUrl', async () => {
    const engine = new AudioEngine();
    const deck = engine.deckA;

    // Stub a minimal HTMLAudioElement on the deck to verify DOM audio element cleanup
    let removedSrc = false;
    let paused = false;
    deck.audioElement = {
      src: 'https://existing-track-stream.example/audio.webm',
      currentTime: 42,
      crossOrigin: 'anonymous',
      preload: 'auto',
      pause() {
        paused = true;
      },
      removeAttribute(attr) {
        if (attr === 'src') {
          this.src = '';
          removedSrc = true;
        }
      },
      load() {},
    };

    await engine.loadTrack({
      videoId: 'next_track_pending_stream',
      title: 'Pending Track',
      artist: 'Artist',
      artists: [],
      artistIds: [],
      liked: false,
      totalPlayTimeMs: 210000,
      playCount: 0,
      durationSec: 210,
      streamUrl: undefined,
    });

    assert.equal(paused, true, 'AudioElement must be paused immediately when loading a new track');
    assert.equal(removedSrc, true, 'AudioElement src attribute must be cleared when new track streamUrl is null');
    assert.equal(deck.audioElement.src, '', 'Previous track streamUrl must not remain on audioElement');
  });

  it('6. StorageService works in browser/renderer environments without throwing ReferenceError', async () => {
    const tmpDir = path.resolve('data/__test_storage_verify__');
    const storage = new StorageService(tmpDir);
    await storage.updateSettings({ 'dsp.equalizerPreset': 'Harman' });
    const settings = await storage.getSettings();
    assert.equal(settings['dsp.equalizerPreset'], 'Harman');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('7. Liquid Glass optical CSS classes, ArtworkPalette generator, APK vector icons, and all views are wired with zero dead 404 thumbnail IDs', async () => {
    const css = fs.readFileSync(path.resolve('src/index.css'), 'utf8');
    assert.ok(css.includes('.liquid-glass'), 'index.css must define .liquid-glass');
    assert.ok(css.includes('.liquid-glass-capsule'), 'index.css must define .liquid-glass-capsule');
    assert.ok(css.includes('.liquid-glass-pill'), 'index.css must define .liquid-glass-pill');
    assert.ok(css.includes('.liquid-glass-card'), 'index.css must define .liquid-glass-card');
    assert.ok(css.includes('.waveform-ambient-backdrop'), 'index.css must define .waveform-ambient-backdrop');

    const icons = fs.readFileSync(path.resolve('src/ui/common/WaveFormIcons.tsx'), 'utf8');
    assert.ok(icons.includes('PlayerPlayIcon'), 'WaveFormIcons.tsx must export PlayerPlayIcon');
    assert.ok(icons.includes('LosslessWaveIcon'), 'WaveFormIcons.tsx must export LosslessWaveIcon');
    assert.ok(icons.includes('DolbyAtmosIcon'), 'WaveFormIcons.tsx must export DolbyAtmosIcon');

    const viewFiles = [
      'src/ui/views/HomeScreen.tsx',
      'src/ui/views/SearchScreen.tsx',
      'src/ui/views/ExploreScreen.tsx',
      'src/ui/views/LibraryScreen.tsx',
      'src/ui/views/ArtistDetailView.tsx',
      'src/ui/views/ReleaseDetailView.tsx',
      'src/ui/views/EqualizerView.tsx',
      'src/ui/player/NowPlayingScreen.tsx',
      'src/ui/common/SettingsModal.tsx',
      'src/ui/common/ContextMenu.tsx',
      'src/ui/common/CreatePlaylistModal.tsx',
    ];
    for (const relPath of viewFiles) {
      const content = fs.readFileSync(path.resolve(relPath), 'utf8');
      assert.ok(
        content.includes('liquid-glass'),
        `${relPath} must use Liquid Glass optical classes`
      );
      assert.ok(
        !content.includes('qAYlTi02n7U') && !content.includes('cr3U1h2f9GQ'),
        `${relPath} must not reference dead HTTP 404 YouTube thumbnail IDs`
      );
    }

    const palette = await extractArtworkPaletteFromUrl(null, 'Overdrive - Lazerhawk');
    assert.ok(palette.vibrantAccent, 'Palette must generate vibrantAccent');
    assert.ok(palette.edgeWash, 'Palette must generate edgeWash');
    assert.ok(palette.ambientBackground, 'Palette must generate ambientBackground');
    assert.ok(palette.playerTint, 'Palette must generate playerTint');
  });
});

