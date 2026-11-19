// Regression: errored/stalled deck must recover on Play; local tracks must not be re-resolved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const hook = `export async function resolve(s, c, n) { try { return await n(s, c); } catch (e) {
  if (s.startsWith('.') && !/\\.(ts|js|mjs)$/.test(s)) { try { return await n(s + '.ts', c); } catch {} try { return await n(s + '/index.ts', c); } catch {} }
  throw e; } }`;
register(`data:text/javascript,${encodeURIComponent(hook)}`, import.meta.url);

const { WebAudioDeck } = await import('../../src/audio/AudioEngine.ts');
const { usePlayerStore, setPlayerStreamResolver } = await import('../../src/state/playerStore.ts');

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
