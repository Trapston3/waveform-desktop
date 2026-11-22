// Regression: errored/stalled deck must recover on Play; local tracks must not be re-resolved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const hook = `export async function resolve(s, c, n) { try { return await n(s, c); } catch (e) {
  if (s.startsWith('.') && !/\\.(ts|js|mjs)$/.test(s)) { try { return await n(s + '.ts', c); } catch {} try { return await n(s + '/index.ts', c); } catch {} }
  throw e; } }`;
register(`data:text/javascript,${encodeURIComponent(hook)}`, import.meta.url);

const { WebAudioDeck, AudioEngine } = await import('../../src/audio/AudioEngine.ts');
const {
  usePlayerStore,
  setPlayerStreamResolver,
  setPlayerLosslessStreamResolver,
} = await import('../../src/state/playerStore.ts');

function fakeEl(src) {
  const l = {};
  return {
    _src: src, error: null, networkState: 1, readyState: 4, paused: true, currentTime: 0, loads: 0, plays: 0,
    get src() { return this._src; }, set src(v) { this._src = v; },
    getAttribute() { return this._src; },
    addEventListener(t, f) { (l[t] ||= []).push(f); },
    removeEventListener(t, f) { l[t] = (l[t] || []).filter((x) => x !== f); },
    emit(t) { (l[t] || []).slice().forEach((f) => f()); },
    load() { this.loads++; this.error = null; this.networkState = 1; },
    play() { this.plays++; this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; },
  };
}

test('Play on an errored deck reloads the source and resumes from positionMs', async () => {
  const deck = new WebAudioDeck('deckA', null, null);
  const el = fakeEl('https://rr1.googlevideo.com/videoplayback?x=1');
  deck.audioElement = el;
  deck.positionMs = 2500;
  el.error = { code: 2 }; // MEDIA_ERR_NETWORK mid-stream (chunk boundary failure)
  deck.play();
  assert.equal(el.loads, 1, 'dead element must be reloaded');
  el.emit('loadedmetadata');
  assert.equal(el.currentTime, 2.5, 'resumes from last position');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(el.plays, 1);
});

test('Play on a healthy paused deck continues without reload', async () => {
  const deck = new WebAudioDeck('deckA', null, null);
  const el = fakeEl('https://rr1.googlevideo.com/videoplayback?x=1');
  deck.audioElement = el;
  deck.play();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(el.loads, 0);
  assert.equal(el.plays, 1);
});

test('local waveform-local:// tracks are not re-resolved', async () => {
  let calls = 0;
  setPlayerStreamResolver(async () => { calls++; return { url: 'https://x' }; });
  await usePlayerStore.getState().loadTrack?.({
    videoId: 'local-1', title: 'Ode to the Mets', artist: 'The Strokes', artists: ['The Strokes'], artistIds: ['s'],
    streamUrl: 'waveform-local://C:/music/ode.flac', liked: false, totalPlayTimeMs: 351000, playCount: 0,
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls, 0);
  setPlayerStreamResolver(null);
});

test('expired/errored stream URL is re-resolved on mid-song error (once) and on Play', async () => {
  const s = usePlayerStore.getState();
  s.cleanupEngine();
  let errorCb = null, errored = false;
  const loads = [], seeks = [];
  const engine = {
    activeDeckName: 'active', deckA: {}, deckB: {},
    setVolume() {}, play() {}, pause() {}, seek(ms) { seeks.push(ms); },
    async loadTrack(t) { loads.push(t.streamUrl); errored = false; },
    onPlaybackStateChange() { return () => {}; }, subscribeLivePcmEnergy() { return () => {}; },
    onPlaybackError(cb) { errorCb = cb; return () => {}; },
    isActiveDeckErrored() { return errored; },
    getCurrentPositionMs() { return 0; }, getCurrentDurationMs() { return 0; },
  };
  usePlayerStore.getState().initEngine(engine);
  let n = 0;
  setPlayerStreamResolver(async () => ({ url: `https://rr1.googlevideo.com/fresh${++n}` }));
  usePlayerStore.setState({
    currentTrack: { videoId: 'yt-ode', title: 'Ode to the Mets', artist: 'The Strokes', streamUrl: 'https://rr1.googlevideo.com/expired' },
    positionMs: 42000, playbackState: 'PLAYING',
  });
  errored = true;
  errorCb(); errorCb(); // second error must not loop
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(loads, ['https://rr1.googlevideo.com/fresh1']);
  assert.equal(seeks[0], 42000);
  errored = true; // URL died again; user presses Play
  usePlayerStore.getState().play();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(loads[1], 'https://rr1.googlevideo.com/fresh2');
  setPlayerStreamResolver(null);
  usePlayerStore.getState().cleanupEngine();
});

test('Premature ended at ~7s preserves positionMs, blocks onTrackEnded, and recovers stream up to 2 retries', async () => {
  const prevWindow = globalThis.window;
  const prevAudio = globalThis.Audio;
  const prevAudioCtx = globalThis.AudioContext;

  class MockAudioElement {
    constructor() {
      this._src = '';
      this.crossOrigin = 'anonymous';
      this.preload = 'auto';
      this.paused = true;
      this.ended = false;
      this.currentTime = 0;
      this.duration = 210;
      this.readyState = 4;
      this.networkState = 1;
      this.error = null;
      this.volume = 1;
      this._listeners = {};
    }
    get src() { return this._src; }
    set src(v) { this._src = v || ''; }
    getAttribute(k) { return k === 'src' ? (this._src || null) : null; }
    removeAttribute(k) { if (k === 'src') this._src = ''; }
    addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
    removeEventListener(t, fn) {
      this._listeners[t] = (this._listeners[t] || []).filter((x) => x !== fn);
    }
    emit(t) { (this._listeners[t] || []).slice().forEach((fn) => fn()); }
    load() { this.paused = true; this.ended = false; this.error = null; }
    play() { this.paused = false; this.ended = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  }

  class MockCtx {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.destination = { connect() {} };
    }
    resume() { return Promise.resolve(); }
    createGain() {
      return {
        gain: {
          value: 1,
          setValueAtTime(v) { this.value = v; },
          setTargetAtTime(v) { this.value = v; },
          cancelScheduledValues() {},
          setValueCurveAtTime() {},
        },
        connect() {},
      };
    }
    createMediaElementSource() { return { connect() {} }; }
    createBiquadFilter() {
      return {
        type: 'peaking',
        Q: { value: 1, setValueAtTime() {} },
        frequency: { value: 1000, setValueAtTime() {} },
        gain: { value: 0, setValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} },
        connect() {},
      };
    }
    createAnalyser() { return { fftSize: 1024, connect() {}, getFloatTimeDomainData() {} }; }
  }

  globalThis.window = { AudioContext: MockCtx };
  globalThis.Audio = MockAudioElement;
  globalThis.AudioContext = MockCtx;

  try {
    usePlayerStore.getState().cleanupEngine();
    const engine = new AudioEngine();
    usePlayerStore.getState().initEngine(engine);

    let trackEndedCount = 0;
    let prematureEndedPositions = [];
    engine.onTrackEnded(() => { trackEndedCount++; });
    engine.onPrematureEnded((posMs) => { prematureEndedPositions.push(posMs); });

    const recoveryAttempts = [];
    setPlayerStreamResolver(async (_id, _title, _artist, attempt) => {
      if (!attempt) {
        return { url: 'waveform-stream://yt?v=BjC0KUxiMhc', quality: '160kbps Opus', durationMs: 210000 };
      }
      recoveryAttempts.push(attempt);
      return {
        url: attempt === 1
          ? 'https://rr2.googlevideo.com/fallback_opus.webm'
          : 'https://aac.saavncdn.com/fallback_320.mp4',
        quality: attempt === 1 ? '160kbps Opus' : '320kbps AAC',
        durationMs: 210000,
      };
    });
    setPlayerLosslessStreamResolver(async () => null);

    await usePlayerStore.getState().loadTrack(
      {
        videoId: 'BjC0KUxiMhc',
        title: 'Subways of Your Mind',
        artist: 'FEX',
        artistIds: ['fex'],
        artists: [{ id: 'fex', name: 'FEX' }],
        liked: false,
        totalPlayTimeMs: 210000,
        durationSec: 210,
        playCount: 0,
        streamUrl: '',
      },
      'active',
      true
    );
    await new Promise((r) => setTimeout(r, 25));

    const activeEl = engine.deckA.audioElement;
    activeEl.duration = 210;
    activeEl.currentTime = 7.25;
    activeEl.emit('timeupdate');
    assert.equal(usePlayerStore.getState().positionMs, 7250);

    // Simulate premature 'ended' firing at 7.25s on a 210s track
    activeEl.ended = true;
    activeEl.paused = true;
    activeEl.emit('ended');

    assert.equal(trackEndedCount, 0, 'Premature ended at 7.25s must NEVER fire onTrackEnded');
    assert.deepEqual(prematureEndedPositions, [7250]);
    assert.equal(usePlayerStore.getState().positionMs, 7250, 'Scrubber positionMs must be preserved at 7250ms');

    await new Promise((r) => setTimeout(r, 25));
    assert.deepEqual(recoveryAttempts, [1]);
    assert.equal(activeEl.src, 'https://rr2.googlevideo.com/fallback_opus.webm');
    assert.equal(activeEl.currentTime, 7.25);

    // Now simulate user seeking near the end (207s / 210s) and natural 'ended' firing
    engine.seek(207000);
    activeEl.currentTime = 209.8;
    activeEl.emit('ended');
    assert.equal(trackEndedCount, 1, 'Natural ended near track end must fire onTrackEnded');
  } finally {
    setPlayerStreamResolver(null);
    setPlayerLosslessStreamResolver(null);
    usePlayerStore.getState().cleanupEngine();
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    if (prevAudio === undefined) delete globalThis.Audio;
    else globalThis.Audio = prevAudio;
    if (prevAudioCtx === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = prevAudioCtx;
  }
});

test('Stage 2 background lossless swap crossfades standby deck at live position and updates activeStreamQuality only on success', async () => {
  const prevWindow = globalThis.window;
  const prevAudio = globalThis.Audio;
  const prevAudioCtx = globalThis.AudioContext;

  let failStandbyLoad = false;

  class MockAudioElement {
    constructor() {
      this._src = '';
      this.crossOrigin = 'anonymous';
      this.preload = 'auto';
      this.paused = true;
      this.ended = false;
      this.currentTime = 0;
      this.duration = 240;
      this.readyState = 4;
      this.networkState = 1;
      this.error = null;
      this.volume = 1;
      this._listeners = {};
    }
    get src() { return this._src; }
    set src(v) { this._src = v || ''; }
    getAttribute(k) { return k === 'src' ? (this._src || null) : null; }
    removeAttribute(k) { if (k === 'src') this._src = ''; }
    addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
    removeEventListener(t, fn) {
      this._listeners[t] = (this._listeners[t] || []).filter((x) => x !== fn);
    }
    emit(t) { (this._listeners[t] || []).slice().forEach((fn) => fn()); }
    load() {
      this.paused = true;
      this.ended = false;
      if (failStandbyLoad && this._src.includes('flac')) {
        this.readyState = 0;
        this.error = { code: 4 };
        setTimeout(() => this.emit('error'), 5);
        return;
      }
      this.error = null;
      this.readyState = 4;
      this.duration = 240;
      setTimeout(() => {
        this.emit('loadedmetadata');
        this.emit('canplaythrough');
      }, 5);
    }
    play() { this.paused = false; this.ended = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  }

  class MockCtx {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.destination = { connect() {} };
    }
    resume() { return Promise.resolve(); }
    createGain() {
      return {
        gain: {
          value: 1,
          setValueAtTime(v) { this.value = v; },
          setTargetAtTime(v) { this.value = v; },
          cancelScheduledValues() {},
          setValueCurveAtTime() {},
        },
        connect() {},
      };
    }
    createMediaElementSource() { return { connect() {} }; }
    createBiquadFilter() {
      return {
        type: 'peaking',
        Q: { value: 1, setValueAtTime() {} },
        frequency: { value: 1000, setValueAtTime() {} },
        gain: { value: 0, setValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} },
        connect() {},
      };
    }
    createAnalyser() { return { fftSize: 1024, connect() {}, getFloatTimeDomainData() {} }; }
  }

  globalThis.window = { AudioContext: MockCtx };
  globalThis.Audio = MockAudioElement;
  globalThis.AudioContext = MockCtx;

  try {
    usePlayerStore.getState().cleanupEngine();
    const engine = new AudioEngine();
    usePlayerStore.getState().initEngine(engine);

    // Case 1: Stage 2 FLAC fails with 403/decode error -> Stage 1 keeps playing and badge stays '160kbps Opus'
    failStandbyLoad = true;
    setPlayerStreamResolver(async () => ({
      url: 'waveform-stream://yt?v=dX3k_QDnzHE',
      quality: '160kbps Opus',
      durationMs: 240000,
    }));
    setPlayerLosslessStreamResolver(async () => ({
      url: 'waveform-stream://proxy?url=https%3A%2F%2Fcdn.example.com%2Fbroken.flac',
      quality: '24-bit / 96kHz FLAC',
      format: 'audio/flac',
      isLossless: true,
      isDolbyAtmos: false,
    }));

    await usePlayerStore.getState().loadTrack(
      {
        videoId: 'dX3k_QDnzHE',
        title: 'Midnight City',
        artist: 'M83',
        artistIds: ['m83'],
        artists: [{ id: 'm83', name: 'M83' }],
        liked: false,
        totalPlayTimeMs: 240000,
        durationSec: 240,
        playCount: 0,
        streamUrl: '',
      },
      'active',
      true
    );
    await new Promise((r) => setTimeout(r, 60));

    assert.equal(usePlayerStore.getState().playbackState, 'PLAYING');
    assert.equal(
      usePlayerStore.getState().activeStreamQuality,
      '160kbps Opus',
      'Badge must remain 160kbps Opus when Stage 2 lossless swap fails'
    );
    assert.equal(engine.activeDeckName, 'active');

    // Case 2: Stage 2 FLAC succeeds -> crossfades to standby deck at live position and updates badge to '24-bit / 96kHz FLAC'
    failStandbyLoad = false;
    engine.deckA.audioElement.currentTime = 14.5;
    const swapped = await engine.stageAndCrossfadeLosslessSwap(
      {
        videoId: 'dX3k_QDnzHE',
        title: 'Midnight City',
        artist: 'M83',
        artistIds: ['m83'],
        artists: [{ id: 'm83', name: 'M83' }],
        liked: false,
        totalPlayTimeMs: 240000,
        durationSec: 240,
        playCount: 0,
        streamUrl: 'waveform-stream://proxy?url=https%3A%2F%2Fcdn.example.com%2Fworking.flac',
        sourceQuality: '24-bit / 96kHz FLAC',
      },
      20
    );

    assert.equal(swapped, true);
    assert.equal(engine.activeDeckName, 'standby');
    assert.equal(engine.deckB.audioElement.currentTime, 14.5, 'Standby deck must sync to live positionMs before crossfade');
    assert.equal(engine.deckB.isPlaying, true);
    assert.equal(engine.deckA.isPlaying, false);
  } finally {
    setPlayerStreamResolver(null);
    setPlayerLosslessStreamResolver(null);
    usePlayerStore.getState().cleanupEngine();
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    if (prevAudio === undefined) delete globalThis.Audio;
    else globalThis.Audio = prevAudio;
    if (prevAudioCtx === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = prevAudioCtx;
  }
});

test('AudioEngine YouTube SABR seek tracks isSeeking, playbackOffsetMs calibration, event guards, and playerStore.seek when durationMs === 0', async () => {
  const prevWindow = globalThis.window;
  const prevAudio = globalThis.Audio;
  const prevAudioCtx = globalThis.AudioContext;

  class MockSabrAudioElement {
    constructor() {
      this._src = '';
      this.crossOrigin = 'anonymous';
      this.preload = 'auto';
      this.paused = true;
      this.ended = false;
      this.seeking = false;
      this.currentTime = 0;
      this.duration = 210;
      this.readyState = 4;
      this.networkState = 1;
      this.error = null;
      this.volume = 1;
      this._bufferedRanges = [[0, 12]];
      this.buffered = {
        get length() { return this._parent._bufferedRanges.length; },
        start: (i) => this._bufferedRanges[i][0],
        end: (i) => this._bufferedRanges[i][1],
      };
      this.buffered._parent = this;
      this._listeners = {};
      this.srcHistory = [];
    }
    get src() { return this._src; }
    set src(v) { this._src = v || ''; if (v) this.srcHistory.push(v); }
    getAttribute(k) { return k === 'src' ? (this._src || null) : null; }
    removeAttribute(k) { if (k === 'src') this._src = ''; }
    addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
    removeEventListener(t, fn) {
      this._listeners[t] = (this._listeners[t] || []).filter((x) => x !== fn);
    }
    emit(t) { (this._listeners[t] || []).slice().forEach((fn) => fn()); }
    load() { this.paused = true; this.ended = false; this.error = null; }
    play() { this.paused = false; this.ended = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  }

  class MockCtx {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.destination = { connect() {} };
    }
    resume() { return Promise.resolve(); }
    createGain() {
      return {
        gain: {
          value: 1,
          setValueAtTime(v) { this.value = v; },
          setTargetAtTime(v) { this.value = v; },
          cancelScheduledValues() {},
          setValueCurveAtTime() {},
        },
        connect() {},
      };
    }
    createMediaElementSource() { return { connect() {} }; }
    createBiquadFilter() {
      return {
        type: 'peaking',
        Q: { value: 1, setValueAtTime() {} },
        frequency: { value: 1000, setValueAtTime() {} },
        gain: { value: 0, setValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} },
        connect() {},
      };
    }
    createAnalyser() { return { fftSize: 1024, connect() {}, getFloatTimeDomainData() {} }; }
  }

  globalThis.window = { AudioContext: MockCtx };
  globalThis.Audio = MockSabrAudioElement;
  globalThis.AudioContext = MockCtx;

  try {
    usePlayerStore.getState().cleanupEngine();
    setPlayerStreamResolver(null);
    setPlayerLosslessStreamResolver(null);

    const engine = new AudioEngine();
    usePlayerStore.getState().initEngine(engine);

    let errorCount = 0;
    let endedCount = 0;
    let prematureCount = 0;
    engine.onPlaybackError(() => { errorCount++; });
    engine.onTrackEnded(() => { endedCount++; });
    engine.onPrematureEnded(() => { prematureCount++; });

    const sabrTrack = {
      videoId: 'BjC0KUxiMhc',
      title: 'Subways of Your Mind',
      artist: 'FEX',
      artistIds: ['fex'],
      artists: [{ id: 'fex', name: 'FEX' }],
      liked: false,
      totalPlayTimeMs: 0,
      playCount: 0,
      streamUrl: 'waveform-stream://yt?v=BjC0KUxiMhc',
    };

    await engine.loadTrack(sabrTrack, 'active');
    engine.play();
    await new Promise((r) => setTimeout(r, 10));
    const el = engine.deckA.audioElement;

    // 1. Seek within buffered [0..12s] stays native without ?startMs= reload
    const initialHistoryLen = el.srcHistory.length;
    engine.seekSeconds(6);
    assert.equal(el.srcHistory.length, initialHistoryLen);
    assert.equal(el.currentTime, 6);
    assert.equal(engine.getPlaybackOffsetMs(), 0);
    assert.equal(engine.getPlaybackOffsetSeconds(), 0);
    assert.equal(engine.getCurrentPositionSeconds(), 6);

    // 2. Seek outside buffered range -> reloads with ?startMs=45000, tracks isSeeking & playbackOffsetMs
    engine.seek(45000);
    assert.equal(el.src, 'waveform-stream://yt?v=BjC0KUxiMhc&startMs=45000');
    assert.equal(engine.isSeeking(), true);
    assert.equal(engine.getPlaybackOffsetMs(), 45000);
    assert.equal(engine.getPlaybackOffsetSeconds(), 45);
    assert.equal(engine.getCurrentPositionMs(), 45000);

    // Guards during seek reload: timeupdate=0 ignored, error suppressed, ended suppressed
    el.currentTime = 0;
    el.emit('timeupdate');
    assert.equal(engine.getCurrentPositionMs(), 45000);
    el.error = { code: 2 };
    el.emit('error');
    assert.equal(errorCount, 0, 'Transient reload error must be suppressed while isSeeking');
    el.error = null;
    el.ended = true;
    el.emit('ended');
    assert.equal(endedCount, 0, 'Reload ended must be suppressed while pendingReloadStartMs !== null');
    assert.equal(prematureCount, 0, 'Premature ended must be suppressed while pendingReloadStartMs !== null');
    el.ended = false;

    // 3. Reload calibration Case A: element timestamp restarts at 0.25s -> playbackOffsetMs = 44750ms
    el.currentTime = 0.25;
    el.emit('loadeddata');
    el.emit('playing');
    assert.equal(engine.isSeeking(), false);
    assert.equal(engine.getPlaybackOffsetMs(), 44750);
    assert.equal(engine.getCurrentPositionMs(), 45000);

    // 4. Reload calibration Case B: WebM Cluster PTS preserved (~64.5s for ?startMs=65000) -> playbackOffsetMs resets to 0
    engine.seek(65000);
    assert.equal(el.src, 'waveform-stream://yt?v=BjC0KUxiMhc&startMs=65000');
    assert.equal(engine.isSeeking(), true);
    el.currentTime = 64.5;
    el.emit('loadeddata');
    el.emit('playing');
    assert.equal(engine.isSeeking(), false);
    assert.equal(engine.getPlaybackOffsetMs(), 0, 'Preserved PTS must calibrate playbackOffsetMs back to 0');
    assert.equal(engine.getCurrentPositionMs(), 64500);

    // 5. playerStore.seek when durationMs === 0 (before metadata loads) must NOT clamp seek to 0:00
    el.duration = NaN;
    el.readyState = 0;
    engine.deckA.durationMs = 0;
    usePlayerStore.setState({
      currentTrack: sabrTrack,
      durationMs: 0,
      positionMs: 0,
      playbackState: 'PAUSED',
    });
    usePlayerStore.getState().seek(45000);
    assert.equal(
      usePlayerStore.getState().positionMs,
      45000,
      'playerStore.seek must preserve 45000ms when durationMs === 0 instead of clamping to 0'
    );
    assert.equal(engine.getCurrentPositionMs(), 45000);
    assert.equal(engine.isSeeking(), true);
  } finally {
    setPlayerStreamResolver(null);
    setPlayerLosslessStreamResolver(null);
    usePlayerStore.getState().cleanupEngine();
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    if (prevAudio === undefined) delete globalThis.Audio;
    else globalThis.Audio = prevAudio;
    if (prevAudioCtx === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = prevAudioCtx;
  }
});

test('AudioEngine.applyPendingResumeSeek defers on readyState=0 (non-SABR), seeks on loadedmetadata, stays synced within 1.5s, and resets to 0 on failed seek', async () => {
  const prevWindow = globalThis.window;
  const prevAudio = globalThis.Audio;
  const prevAudioCtx = globalThis.AudioContext;

  let allowSeek = true;
  class MockResumeEl {
    constructor() {
      this._src = '';
      this._time = 0;
      this.readyState = 0;
      this.duration = NaN;
      this.paused = true;
      this.ended = false;
      this.seeking = false;
      this.networkState = 1;
      this.error = null;
      this._listeners = {};
    }
    get src() { return this._src; }
    set src(v) { this._src = v || ''; }
    get currentTime() { return this._time; }
    set currentTime(v) { if (allowSeek) this._time = v; }
    getAttribute(k) { return k === 'src' ? (this._src || null) : null; }
    removeAttribute(k) { if (k === 'src') this._src = ''; }
    addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
    removeEventListener(t, fn) { this._listeners[t] = (this._listeners[t] || []).filter((x) => x !== fn); }
    emit(t) { (this._listeners[t] || []).slice().forEach((fn) => fn()); }
    load() { this.paused = true; this.ended = false; this.error = null; }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  }

  class MockCtx {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = { connect() {} }; }
    resume() { return Promise.resolve(); }
    createGain() {
      return {
        gain: { value: 1, setValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {}, setValueCurveAtTime() {} },
        connect() {},
      };
    }
    createMediaElementSource() { return { connect() {} }; }
    createBiquadFilter() {
      return {
        type: 'peaking', Q: { value: 1, setValueAtTime() {} }, frequency: { value: 1000, setValueAtTime() {} },
        gain: { value: 0, setValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} }, connect() {},
      };
    }
    createAnalyser() { return { fftSize: 1024, connect() {}, getFloatTimeDomainData() {} }; }
  }

  globalThis.window = { AudioContext: MockCtx };
  globalThis.Audio = MockResumeEl;
  globalThis.AudioContext = MockCtx;

  const engine = new AudioEngine();
  try {
    let resetCallbacks = 0;
    engine.onResumeResetToZeroCallback = () => { resetCallbacks++; };

    await engine.loadTrack({
      videoId: 'resume-1', title: 'Resume Track', artist: 'Tester', artists: [{ id: 'a', name: 'Tester' }],
      artistIds: ['a'], liked: false, totalPlayTimeMs: 180000, durationSec: 180, playCount: 0,
      streamUrl: 'https://cdn.example.com/audio.mp3',
    }, 'active');
    const el = engine.deckA.audioElement;

    // 1. Defers when readyState === 0 without clearing pendingResumePosition
    engine.setPendingResumePosition(45);
    assert.equal(engine.applyPendingResumeSeek(), false);
    assert.equal(engine.getPendingResumePosition(), 45);
    assert.equal(el.currentTime, 0);

    // 2. Seeks once loadedmetadata fires and stays synced within 1.5s
    el.readyState = 1;
    el.duration = 180;
    el.emit('loadedmetadata');
    assert.equal(el.currentTime, 45);
    el.currentTime = 44.2; // within 1.5s tolerance
    el.emit('seeked');
    assert.equal(engine.getPendingResumePosition(), null);
    assert.equal(engine.getCurrentTime(), 44.2);
    assert.equal(resetCallbacks, 0);

    // 3. Resets to 0 + invokes onResumeResetToZeroCallback when stream fails to seek and remains at 0
    allowSeek = false;
    el._time = 0;
    engine.setPendingResumePosition(45);
    assert.equal(engine.applyPendingResumeSeek(), true);
    assert.equal(el.currentTime, 0);
    el.emit('seeked');
    assert.equal(engine.getCurrentPositionMs(), 0);
    assert.equal(engine.getPlaybackOffsetMs(), 0);
    assert.equal(engine.isSeeking(), false);
    assert.equal(engine.getPendingResumePosition(), null);
    assert.equal(resetCallbacks, 1);
  } finally {
    engine.dispose?.();
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    if (prevAudio === undefined) delete globalThis.Audio;
    else globalThis.Audio = prevAudio;
    if (prevAudioCtx === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = prevAudioCtx;
  }
});
