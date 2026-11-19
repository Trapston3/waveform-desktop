// tests/unit/audio_cors_fallback_and_switching.test.mjs
// Regression & behavioral tests for CORS fallback, local<->web switching, real-media progress, and Electron CORS config

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const resolverHook = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && !specifier.endsWith('.ts') && !specifier.endsWith('.js') && !specifier.endsWith('.mjs')) {
      try { return await nextResolve(specifier + '.ts', context); } catch {}
      try { return await nextResolve(specifier + '/index.ts', context); } catch {}
    }
    throw err;
  }
}
`;
register(`data:text/javascript,${encodeURIComponent(resolverHook)}`, import.meta.url);

const { AudioEngine } = await import('../../src/audio/AudioEngine.ts');
const { usePlayerStore, setPlayerStreamResolver } = await import('../../src/state/playerStore.ts');

function createMockAudioEnvironment({ failPlayWithNotSupportedOnFirst = false } = {}) {
  const createdElements = [];
  const mediaSourceElements = [];

  class MockAudio {
    constructor() {
      this._src = '';
      this.crossOrigin = null;
      this.preload = '';
      this.preservesPitch = true;
      this.paused = true;
      this.ended = false;
      this.currentTime = 0;
      this.duration = NaN;
      this.readyState = 0;
      this.networkState = 1;
      this.volume = 1.0;
      this.error = null;
      this.playCalls = 0;
      this.pauseCalls = 0;
      this.loadCalls = 0;
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
      if (name === 'src') return this._src || null;
      if (name === 'crossorigin') return this.crossOrigin;
      return null;
    }

    removeAttribute(name) {
      if (name === 'src') this._src = '';
      if (name === 'crossorigin') this.crossOrigin = null;
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
      this.error = null;
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
      if (failPlayWithNotSupportedOnFirst && this === createdElements[0] && this.playCalls === 1) {
        const err = new Error('The element has no supported sources.');
        err.name = 'NotSupportedError';
        return Promise.reject(err);
      }
      this.paused = false;
      this.ended = false;
      return Promise.resolve();
    }

    simulateMetadataLoaded(durationSec = 200) {
      this.duration = durationSec;
      this.readyState = 1;
      this.dispatch('loadedmetadata');
      this.readyState = 4;
      this.dispatch('canplay');
    }

    simulateError(code = 4) {
      this.error = { code };
      this.dispatch('error');
    }
  }

  function createMockParam(initial = 0) {
    return {
      value: initial,
      setValueAtTime(v) { this.value = v; },
      setTargetAtTime(v) { this.value = v; },
      cancelScheduledValues() {},
      setValueCurveAtTime() {},
    };
  }

  class MockAudioContext {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.destination = { connect() {} };
      this.resumeCalls = 0;
    }
    resume() {
      this.resumeCalls++;
      this.state = 'running';
      return Promise.resolve();
    }
    createGain() {
      return { gain: createMockParam(1), connect() {} };
    }
    createMediaElementSource(el) {
      mediaSourceElements.push(el);
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
      return { fftSize: 2048, connect() {}, getFloatTimeDomainData() {} };
    }
  }

  return { MockAudio, MockAudioContext, createdElements, mediaSourceElements };
}

function makeTrack(overrides = {}) {
  return {
    videoId: 'vid_test_1',
    title: 'Test Track',
    artist: 'Test Artist',
    artistIds: ['art_1'],
    artists: [{ id: 'art_1', name: 'Test Artist' }],
    liked: false,
    totalPlayTimeMs: 200000,
    durationSec: 200,
    playCount: 0,
    ...overrides,
  };
}

describe('Audio CORS Fallback, Switching & Integrity Suite', () => {
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

  test('1. local -> web -> local -> web switching maintains single active output and clean deck gains', async () => {
    const env = createMockAudioEnvironment();
    globalThis.window = { AudioContext: env.MockAudioContext };
    globalThis.Audio = env.MockAudio;
    globalThis.AudioContext = env.MockAudioContext;

    const engine = new AudioEngine();
    engine.setVolume(0.7);

    const sequence = [
      makeTrack({ videoId: 'local_1', title: 'Local 1', streamUrl: 'waveform-local://file?path=C%3A%2Fmusic%2F1.flac', isLocal: true }),
      makeTrack({ videoId: 'web_1', title: 'Web 1', streamUrl: 'https://rr1.googlevideo.com/videoplayback?id=1' }),
      makeTrack({ videoId: 'local_2', title: 'Local 2', streamUrl: 'waveform-local://file?path=C%3A%2Fmusic%2F2.mp3', isLocal: true }),
      makeTrack({ videoId: 'web_2', title: 'Web 2', streamUrl: 'https://rr2.googlevideo.com/videoplayback?id=2' }),
    ];

    for (const track of sequence) {
      // Simulate standby deck having been left playing/nonzero gain before switch
      const standby = engine.activeDeckName === 'active' ? engine.deckB : engine.deckA;
      standby.setGain(0.5);
      standby.isPlaying = true;

      await engine.loadTrack(track, 'active');
      engine.play();
      await new Promise((r) => setTimeout(r, 10));

      const active = engine.activeDeckName === 'active' ? engine.deckA : engine.deckB;
      assert.strictEqual(active.gain, 1.0, `active deck gain must be 1.0 for ${track.videoId}`);
      assert.strictEqual(standby.gain, 0.0, `standby deck gain must be 0.0 for ${track.videoId}`);
      assert.strictEqual(standby.isPlaying, false, `standby deck must be paused for ${track.videoId}`);
      assert.strictEqual(active.usingDirectFallback, false, `must reset to routed element on ${track.videoId}`);
      assert.strictEqual(engine.getActiveAudioElement(), active.audioElement);
      assert.strictEqual(active.audioElement.src, track.streamUrl);

      // Verify strictly single playing <audio> element across all created elements
      const playingEls = env.createdElements.filter((el) => !el.paused);
      assert.strictEqual(playingEls.length, 1, `exactly one audio element should be playing for ${track.videoId}`);
      assert.strictEqual(playingEls[0], active.audioElement);

      // Verify getCurrentPositionMs reads currentTime when readyState >= 1
      active.audioElement.simulateMetadataLoaded(200);
      active.audioElement.currentTime = 12.345;
      assert.strictEqual(engine.getCurrentPositionMs(), 12345);
    }
  });

  test('2. CORS/decode error on routedElement engages unbound directElement and returns cleanly on next track', async () => {
    const env = createMockAudioEnvironment();
    globalThis.window = { AudioContext: env.MockAudioContext };
    globalThis.Audio = env.MockAudio;
    globalThis.AudioContext = env.MockAudioContext;

    const engine = new AudioEngine();
    engine.setVolume(0.6);

    let errorEvents = 0;
    engine.onPlaybackError(() => { errorEvents++; });

    const webTrack = makeTrack({
      videoId: 'web_cors_1',
      streamUrl: 'https://rr1.googlevideo.com/videoplayback?cors=strict',
    });
    await engine.loadTrack(webTrack, 'active');
    const routedEl = engine.deckA.audioElement;
    assert.strictEqual(routedEl.crossOrigin, 'anonymous');
    assert.ok(env.mediaSourceElements.includes(routedEl));

    engine.play();
    await new Promise((r) => setTimeout(r, 10));
    engine.deckA.positionMs = 15000;

    // Trigger CORS/decode error on routedElement
    routedEl.simulateError(4);
    await new Promise((r) => setTimeout(r, 10));

    assert.strictEqual(errorEvents, 0, 'engaging direct fallback must not fire onPlaybackError');
    assert.strictEqual(engine.deckA.usingDirectFallback, true);
    const directEl = engine.deckA.audioElement;
    assert.notStrictEqual(directEl, routedEl, 'active audioElement must switch to directElement');
    assert.strictEqual(directEl.crossOrigin, null, 'directElement must NOT set crossOrigin');
    assert.ok(!env.mediaSourceElements.includes(directEl), 'directElement must NEVER be passed to createMediaElementSource');
    assert.strictEqual(routedEl.paused, true, 'routedElement must be paused');
    assert.strictEqual(routedEl.src, '', 'routedElement src must be cleared');
    assert.strictEqual(directEl.src, webTrack.streamUrl);
    assert.strictEqual(directEl.paused, false, 'directElement must resume playback');
    assert.strictEqual(engine.deckA.isPlaying, true);
    assert.ok(Math.abs(directEl.volume - 0.6) < 0.001, 'directElement volume must sync to globalVolume * gain');

    // Verify only 1 element is playing
    const playingEls = env.createdElements.filter((el) => !el.paused);
    assert.strictEqual(playingEls.length, 1);
    assert.strictEqual(playingEls[0], directEl);

    // Metadata load on directElement should apply preserved positionMs
    directEl.simulateMetadataLoaded(200);
    assert.strictEqual(directEl.currentTime, 15);

    // Volume change updates directElement volume
    engine.setVolume(0.3);
    assert.ok(Math.abs(directEl.volume - 0.3) < 0.001);

    // If directElement itself errors while playing, onPlaybackError MUST fire
    directEl.simulateError(2);
    assert.strictEqual(errorEvents, 1, 'error on directElement must propagate to onPlaybackError');

    // Loading next track resets cleanly back to routedElement
    const nextTrack = makeTrack({
      videoId: 'local_next',
      streamUrl: 'waveform-local://file?path=C%3A%2Fmusic%2Fnext.flac',
      isLocal: true,
    });
    await engine.loadTrack(nextTrack, 'active');
    assert.strictEqual(engine.deckA.usingDirectFallback, false);
    assert.strictEqual(engine.deckA.audioElement, routedEl);
    assert.strictEqual(directEl.paused, true);
    assert.strictEqual(directEl.src, '');
    assert.strictEqual(routedEl.src, nextTrack.streamUrl);
  });

  test('3. NotSupportedError from routedElement.play() engages direct fallback', async () => {
    const env = createMockAudioEnvironment({ failPlayWithNotSupportedOnFirst: true });
    globalThis.window = { AudioContext: env.MockAudioContext };
    globalThis.Audio = env.MockAudio;
    globalThis.AudioContext = env.MockAudioContext;

    const engine = new AudioEngine();
    const track = makeTrack({ videoId: 'web_ns_1', streamUrl: 'https://cdn.example.com/strict.m4a' });
    await engine.loadTrack(track, 'active');
    const routedEl = engine.deckA.audioElement;

    engine.play();
    await new Promise((r) => setTimeout(r, 20));

    assert.strictEqual(engine.deckA.usingDirectFallback, true);
    assert.notStrictEqual(engine.deckA.audioElement, routedEl);
    assert.strictEqual(engine.deckA.audioElement.crossOrigin, null);
    assert.strictEqual(engine.deckA.audioElement.paused, false);
    assert.strictEqual(routedEl.paused, true);
  });

  test('4. pause, seek, and skip work across both routed and direct-fallback decks', async () => {
    const env = createMockAudioEnvironment();
    globalThis.window = { AudioContext: env.MockAudioContext };
    globalThis.Audio = env.MockAudio;
    globalThis.AudioContext = env.MockAudioContext;

    const engine = new AudioEngine();
    await engine.loadTrack(makeTrack({ videoId: 't1', streamUrl: 'https://cdn.example.com/1.m4a' }), 'active');
    engine.play();
    await new Promise((r) => setTimeout(r, 10));
    engine.deckA.audioElement.simulateMetadataLoaded(200);

    // Seek & pause on routed deck
    engine.seek(30000);
    assert.strictEqual(engine.deckA.audioElement.currentTime, 30);
    engine.pause();
    assert.strictEqual(engine.deckA.audioElement.paused, true);
    assert.strictEqual(engine.playbackState, 'PAUSED');

    // Resume and trigger fallback to direct deck
    engine.play();
    await new Promise((r) => setTimeout(r, 10));
    engine.deckA.audioElement.simulateError(4);
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(engine.deckA.usingDirectFallback, true);

    const directEl = engine.deckA.audioElement;
    directEl.simulateMetadataLoaded(200);

    // Seek & pause on direct-fallback deck
    engine.seek(65000);
    assert.strictEqual(directEl.currentTime, 65);
    assert.strictEqual(engine.getCurrentPositionMs(), 65000);

    engine.pause();
    assert.strictEqual(directEl.paused, true);
    assert.strictEqual(engine.playbackState, 'PAUSED');

    // Skip to next track resets back to routed element cleanly
    await engine.loadTrack(makeTrack({ videoId: 't2', streamUrl: 'https://cdn.example.com/2.m4a' }), 'active');
    engine.play();
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(engine.deckA.usingDirectFallback, false);
    assert.strictEqual(directEl.paused, true);
    assert.strictEqual(engine.deckA.audioElement.paused, false);
  });

  test('5. playerStore resets playbackState to PAUSED on empty or rejected stream resolution', async () => {
    const env = createMockAudioEnvironment();
    globalThis.window = { AudioContext: env.MockAudioContext };
    globalThis.Audio = env.MockAudio;
    globalThis.AudioContext = env.MockAudioContext;

    const engine = new AudioEngine();
    usePlayerStore.getState().initEngine(engine);

    // Case A: Resolver returns null / empty url
    setPlayerStreamResolver(async () => null);
    await usePlayerStore.getState().loadTrack(makeTrack({ videoId: 'unresolved_1', streamUrl: '' }), 'active', true);
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(usePlayerStore.getState().playbackState, 'PAUSED', 'empty stream resolution must reset to PAUSED');

    // Case B: Resolver rejects with error
    setPlayerStreamResolver(async () => {
      throw new Error('Network unreachable');
    });
    await usePlayerStore.getState().loadTrack(makeTrack({ videoId: 'unresolved_2', streamUrl: '' }), 'active', true);
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(usePlayerStore.getState().playbackState, 'PAUSED', 'rejected stream resolution must reset to PAUSED');
  });

  test('6. useAudioController removes synthetic 50ms progress and electron/main.ts configures full CORS', () => {
    const controllerSrc = readFileSync(path.join(rootDir, 'src/ui/hooks/useAudioController.ts'), 'utf8');
    const mainSrc = readFileSync(path.join(rootDir, 'electron/main.ts'), 'utf8');

    // No synthetic 50ms position fabrication
    assert.ok(!controllerSrc.includes('syntheticCap'), 'useAudioController must not fabricate synthetic progress');
    assert.ok(!controllerSrc.includes('+ 50'), 'useAudioController must not add +50ms synthetic ticks');
    assert.match(controllerSrc, /isRealMediaPlaying/);

    // electron/main.ts CORS & protocol hardening
    assert.match(mainSrc, /scheme:\s*'waveform-local'[\s\S]*corsEnabled:\s*true/);
    assert.match(mainSrc, /access-control-allow-credentials/);
    assert.match(mainSrc, /request\.method\s*===\s*'OPTIONS'/);
    assert.match(mainSrc, /status:\s*204/);
    assert.match(mainSrc, /'Access-Control-Expose-Headers':\s*'Content-Length, Content-Range, Accept-Ranges'/);
    assert.match(mainSrc, /urls:\s*\['http:\/\/\*\/\*',\s*'https:\/\/\*\/\*'\]/);
  });
});
