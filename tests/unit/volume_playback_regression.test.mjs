// tests/unit/volume_playback_regression.test.mjs
// Behavioral regression tests for volume-change + async stream resolution playback stability

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

// Register ESM resolution hook for extensionless .ts imports
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

const { AudioEngine } = await import('../../src/audio/AudioEngine.ts');
const { usePlayerStore, setPlayerStreamResolver } = await import('../../src/state/playerStore.ts');

/**
 * Minimal browser-like HTMLAudioElement + AudioContext mock to test real WebAudioDeck behavior.
 */
function createMockAudioEnvironment({ failFirstPlayWithAbort = false, startSuspended = false } = {}) {
  const createdElements = [];

  class MockAudio {
    constructor() {
      this._src = '';
      this.crossOrigin = '';
      this.preload = '';
      this.preservesPitch = true;
      this.paused = true;
      this.ended = false;
      this.currentTime = 0;
      this.duration = NaN;
      this.readyState = 0; // HAVE_NOTHING
      this.volume = 1.0;
      this.error = null;
      this.playCalls = 0;
      this.pauseCalls = 0;
      this.loadCalls = 0;
      this.seekAttemptsBeforeMetadata = 0;
      this._listeners = new Map();
      createdElements.push(this);
    }

    get src() {
      return this._src;
    }

    set src(val) {
      this._src = val || '';
    }

    getAttribute(name) {
      return name === 'src' ? (this._src || null) : null;
    }

    removeAttribute(name) {
      if (name === 'src') this._src = '';
    }

    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, new Set());
      this._listeners.get(type).add(fn);
    }

    removeEventListener(type, fn) {
      this._listeners.get(type)?.delete(fn);
    }

    dispatch(type) {
      const set = this._listeners.get(type);
      if (set) {
        for (const fn of [...set]) fn();
      }
    }

    load() {
      this.loadCalls++;
      this.paused = true;
      this.ended = false;
      this.readyState = 0;
      this.duration = NaN;
      // Simulate browsers firing an error event when load() is called with empty src
      if (!this._src) {
        this.error = { code: 4 };
        this.dispatch('error');
      }
    }

    pause() {
      this.pauseCalls++;
      this.paused = true;
    }

    play() {
      this.playCalls++;
      if (failFirstPlayWithAbort && this.playCalls === 1) {
        const err = new Error('The play() request was interrupted by a new load request.');
        err.name = 'AbortError';
        return Promise.reject(err);
      }
      this.paused = false;
      this.ended = false;
      return Promise.resolve();
    }

    simulateMetadataLoaded(durationSec = 210) {
      this.duration = durationSec;
      this.readyState = 1; // HAVE_METADATA
      this.dispatch('loadedmetadata');
      this.readyState = 4; // HAVE_ENOUGH_DATA
      this.dispatch('canplay');
    }
  }

  function createMockParam(initial = 0) {
    return {
      value: initial,
      lastTarget: initial,
      setValueAtTime(v) {
        this.value = v;
        this.lastTarget = v;
      },
      setTargetAtTime(v) {
        this.value = v;
        this.lastTarget = v;
      },
      cancelScheduledValues() {},
      setValueCurveAtTime() {},
    };
  }

  class MockAudioContext {
    constructor() {
      this.state = startSuspended ? 'suspended' : 'running';
      this.currentTime = 0;
      this.destination = { connect() {} };
      this.resumeCalls = 0;
      this.gainNodes = [];
    }

    resume() {
      this.resumeCalls++;
      this.state = 'running';
      return Promise.resolve();
    }

    createGain() {
      const node = {
        gain: createMockParam(1),
        connect() {},
      };
      this.gainNodes.push(node);
      return node;
    }

    createMediaElementSource() {
      return { connect() {} };
    }

    createBiquadFilter() {
      return {
        type: 'peaking',
        Q: createMockParam(1),
        frequency: createMockParam(1000),
        gain: createMockParam(0),
        connect() {},
      };
    }

    createAnalyser() {
      return {
        fftSize: 2048,
        connect() {},
        getFloatTimeDomainData() {},
      };
    }
  }

  return { MockAudio, MockAudioContext, createdElements };
}

function makeTrack(overrides = {}) {
  return {
    videoId: 'vid_vol_test_1',
    title: 'Midnight Signal',
    artist: 'Solaris, Luna',
    artistIds: ['art_solaris', 'art_luna'],
    artists: [
      { id: 'art_solaris', name: 'Solaris' },
      { id: 'art_luna', name: 'Luna' },
    ],
    liked: false,
    totalPlayTimeMs: 210000,
    durationSec: 210,
    playCount: 0,
    ...overrides,
  };
}

describe('Volume & Async Stream Resolution Playback Regression Suite', () => {
  let origWindow;
  let origAudio;
  let origAudioContext;

  beforeEach(() => {
    origWindow = globalThis.window;
    origAudio = globalThis.Audio;
    origAudioContext = globalThis.AudioContext;

    usePlayerStore.getState().cleanupEngine();
    setPlayerStreamResolver(null);
    usePlayerStore.setState({
      currentTrack: null,
      playbackState: 'PAUSED',
      positionMs: 0,
      durationMs: 0,
      volume: 0.85,
      isMuted: false,
      preMuteVolume: 0.85,
      activeDeck: 'active',
    });
  });

  afterEach(() => {
    usePlayerStore.getState().cleanupEngine();
    setPlayerStreamResolver(null);
    if (origWindow === undefined) delete globalThis.window;
    else globalThis.window = origWindow;
    if (origAudio === undefined) delete globalThis.Audio;
    else globalThis.Audio = origAudio;
    if (origAudioContext === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = origAudioContext;
  });

  test('1. Changing volume before playing a track with async stream resolution stays PLAYING and does not stop', async () => {
    const env = createMockAudioEnvironment({ startSuspended: true });
    globalThis.window = { AudioContext: env.MockAudioContext };
    globalThis.Audio = env.MockAudio;
    globalThis.AudioContext = env.MockAudioContext;

    const engine = new AudioEngine();
    usePlayerStore.getState().initEngine(engine);

    // User changes volume before hitting play
    usePlayerStore.getState().setVolume(0.42);
    assert.strictEqual(usePlayerStore.getState().volume, 0.42);
    assert.strictEqual(engine.globalVolume, 0.42);

    // Simulate ~150ms async stream resolution (representative of ~1s network resolution)
    let resolveCalled = false;
    setPlayerStreamResolver(async () => {
      resolveCalled = true;
      await new Promise((r) => setTimeout(r, 150));
      return {
        url: 'https://cdn.example.com/real-audio-stream.m4a',
        quality: 'Lossless 24/48',
        durationMs: 215000,
      };
    });

    // Play a song without streamUrl (or with synthetic placeholder URL)
    await usePlayerStore.getState().loadTrack(
      makeTrack({ streamUrl: 'https://sn-redline.example.com/fake.mp3' }),
      'active',
      true
    );

    assert.strictEqual(usePlayerStore.getState().playbackState, 'PLAYING');
    assert.strictEqual(engine.playbackState, 'PLAYING');

    // Wait for async resolveStream + loadTrack(enriched) + play() to complete
    await new Promise((r) => setTimeout(r, 250));

    assert.strictEqual(resolveCalled, true);
    assert.strictEqual(usePlayerStore.getState().playbackState, 'PLAYING');
    assert.strictEqual(engine.playbackState, 'PLAYING');
    assert.strictEqual(engine.deckA.isPlaying, true);
    assert.strictEqual(engine.deckA.audioElement.src, 'https://cdn.example.com/real-audio-stream.m4a');
    assert.strictEqual(engine.deckA.audioElement.paused, false);
    assert.strictEqual(engine.globalVolume, 0.42);
    assert.strictEqual(usePlayerStore.getState().volume, 0.42);
  });

  test('2. Changing volume DURING async stream resolution (~200ms in) must NOT flip playbackState to PAUSED/IDLE or stop playback', async () => {
    const env = createMockAudioEnvironment();
    globalThis.window = { AudioContext: env.MockAudioContext };
    globalThis.Audio = env.MockAudio;
    globalThis.AudioContext = env.MockAudioContext;

    const engine = new AudioEngine();
    usePlayerStore.getState().initEngine(engine);

    let finishResolve;
    const resolvePromise = new Promise((resolve) => {
      finishResolve = resolve;
    });
    setPlayerStreamResolver(() => resolvePromise);

    await usePlayerStore.getState().loadTrack(makeTrack({ streamUrl: '' }), 'active', true);
    assert.strictEqual(usePlayerStore.getState().playbackState, 'PLAYING');

    // Simulate worst-case stale engine state (IDLE/PAUSED while audioElement has no src yet)
    // and user dragging the volume slider repeatedly during stream resolution!
    engine.playbackState = 'IDLE';
    usePlayerStore.getState().setVolume(0.35);
    assert.strictEqual(
      usePlayerStore.getState().playbackState,
      'PLAYING',
      'store.setVolume echo during IDLE engine state must not stop PLAYING'
    );

    engine.playbackState = 'PAUSED';
    engine.setVolume(0.55); // Direct engine.setVolume echo
    assert.strictEqual(
      usePlayerStore.getState().playbackState,
      'PLAYING',
      'direct engine.setVolume echo during PAUSED engine state must not stop PLAYING'
    );

    // Advance synthetic timer position to simulate ~1s pre-roll
    usePlayerStore.setState({ positionMs: 1000 });

    // Now the real stream resolves
    finishResolve({
      url: 'https://cdn.example.com/resolved-track.m4a',
      quality: 'AAC 256',
      durationMs: 210000,
    });
    await new Promise((r) => setTimeout(r, 60));

    assert.strictEqual(usePlayerStore.getState().playbackState, 'PLAYING');
    assert.strictEqual(engine.playbackState, 'PLAYING');
    assert.strictEqual(engine.deckA.isPlaying, true);
    assert.strictEqual(engine.deckA.audioElement.src, 'https://cdn.example.com/resolved-track.m4a');
    assert.strictEqual(engine.deckA.audioElement.paused, false);
  });

  test('3. Changing volume from muted (0) to non-zero unmutes cleanly without re-muting', () => {
    const engine = new AudioEngine();
    usePlayerStore.getState().initEngine(engine);

    // Start at 0.75, then mute
    usePlayerStore.getState().setVolume(0.75);
    usePlayerStore.getState().toggleMute();
    assert.strictEqual(usePlayerStore.getState().isMuted, true);
    assert.strictEqual(usePlayerStore.getState().volume, 0);
    assert.strictEqual(usePlayerStore.getState().preMuteVolume, 0.75);
    assert.strictEqual(engine.globalVolume, 0);

    // Drag slider from 0 to 0.35 (both BottomPlayerBar and NowPlayingScreen call setVolume directly)
    usePlayerStore.getState().setVolume(0.35);
    assert.strictEqual(usePlayerStore.getState().isMuted, false);
    assert.strictEqual(usePlayerStore.getState().volume, 0.35);
    assert.strictEqual(engine.globalVolume, 0.35);

    // Mute again and unmute via mouse wheel up (adjustVolumeRelative)
    usePlayerStore.getState().toggleMute();
    assert.strictEqual(usePlayerStore.getState().isMuted, true);
    assert.strictEqual(usePlayerStore.getState().volume, 0);

    usePlayerStore.getState().adjustVolumeRelative(0.05);
    assert.strictEqual(usePlayerStore.getState().isMuted, false);
    assert.ok(usePlayerStore.getState().volume > 0.35);
    assert.strictEqual(engine.globalVolume, usePlayerStore.getState().volume);
  });

  test('4. Changing volume while actively playing keeps AudioEngine & store in PLAYING state', async () => {
    const env = createMockAudioEnvironment();
    globalThis.window = { AudioContext: env.MockAudioContext };
    globalThis.Audio = env.MockAudio;
    globalThis.AudioContext = env.MockAudioContext;

    const engine = new AudioEngine();
    usePlayerStore.getState().initEngine(engine);

    await usePlayerStore.getState().loadTrack(
      makeTrack({ streamUrl: 'https://cdn.example.com/direct.m4a' }),
      'active',
      true
    );
    engine.deckA.audioElement.simulateMetadataLoaded(210);

    for (const vol of [0.1, 0.5, 0.0, 0.8, 1.0, 0.25]) {
      usePlayerStore.getState().setVolume(vol);
      assert.strictEqual(usePlayerStore.getState().playbackState, 'PLAYING');
      assert.strictEqual(engine.playbackState, 'PLAYING');
      assert.strictEqual(engine.deckA.isPlaying, true);
      assert.strictEqual(engine.globalVolume, vol);
    }
  });

  test('5. WebAudioDeck defers seek before loadedmetadata and retries AbortError on canplay', async () => {
    const env = createMockAudioEnvironment({ failFirstPlayWithAbort: true });
    globalThis.window = { AudioContext: env.MockAudioContext };
    globalThis.Audio = env.MockAudio;
    globalThis.AudioContext = env.MockAudioContext;

    const engine = new AudioEngine();
    await engine.loadTrack(makeTrack({ streamUrl: 'https://cdn.example.com/stream.m4a' }), 'active');

    // Seek before loadedmetadata (readyState === 0)
    engine.seek(15000);
    assert.strictEqual(engine.deckA.positionMs, 15000);
    assert.strictEqual(engine.deckA.audioElement.currentTime, 0, 'must not write currentTime before loadedmetadata');

    // Call play() -> first attempt rejects with AbortError, should attach canplay retry
    engine.play();
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(engine.deckA.isPlaying, true);
    assert.strictEqual(engine.playbackState, 'PLAYING');

    // Now metadata loads & canplay fires -> deferred seek applies and play retries!
    engine.deckA.audioElement.simulateMetadataLoaded(210);
    await new Promise((r) => setTimeout(r, 20));

    assert.strictEqual(engine.deckA.audioElement.currentTime, 15);
    assert.strictEqual(engine.deckA.audioElement.paused, false);
    assert.ok(engine.deckA.audioElement.playCalls >= 2, 'should have retried play() on canplay');
  });

  test('6. BottomPlayerBar and NowPlayingScreen keep ArtistCredits & clean volume controls intact', () => {
    const bottomSrc = readFileSync(path.join(rootDir, 'src/ui/layout/BottomPlayerBar.tsx'), 'utf8');
    const nowPlayingSrc = readFileSync(path.join(rootDir, 'src/ui/player/NowPlayingScreen.tsx'), 'utf8');

    // Both use ArtistCredits and close NowPlaying modal on artist navigation
    assert.ok(bottomSrc.includes('<ArtistCredits'), 'BottomPlayerBar must render ArtistCredits');
    assert.ok(bottomSrc.includes('setNowPlayingModalOpen(false)'), 'BottomPlayerBar must close NowPlaying on artist click');
    assert.ok(nowPlayingSrc.includes('<ArtistCredits'), 'NowPlayingScreen must render ArtistCredits');
    assert.ok(nowPlayingSrc.includes('onClose(); navigateToArtist(id);'), 'NowPlayingScreen must close and navigate on artist click');

    // Neither uses stale `if (isMuted) toggleMute()` inside volume slider onChange (ignoring comments)
    const stripComments = (src) => src.replace(/\/\/.*$/gm, '');
    assert.ok(!stripComments(bottomSrc).includes('if (isMuted) toggleMute()'), 'BottomPlayerBar must not call stale toggleMute in slider onChange');
    assert.ok(!stripComments(nowPlayingSrc).includes('if (isMuted) toggleMute()'), 'NowPlayingScreen must not call stale toggleMute in slider onChange');
    assert.ok(nowPlayingSrc.includes('onWheel='), 'NowPlayingScreen volume container should support wheel adjustments cleanly');
  });
});
