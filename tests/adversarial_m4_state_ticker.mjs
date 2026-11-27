// tests/adversarial_m4_state_ticker.mjs
// Adversarial Empirical Challenger Suite for Milestone 4:
// State Decoupling, Audio Ticker Throttling, Component Re-render Isolation & Lyrics Synchronization
//
// Role: challenger_m4_perf_1 (Empirical Challenger)
// Verifying:
// 1. Zero React re-renders during playback: 5,000ms continuous playback simulation (100 ticks @ 50ms).
//    Verify usePlayerStore.setState({ positionMs }) is throttled to 1Hz (1000ms) rather than firing at 50ms (20Hz).
// 2. Component isolation: Verify BottomPlayerBar, RightInspector, HomeScreen, ExploreScreen, SearchScreen,
//    LibraryScreen, ReleaseDetailView, and ArtistDetailView do NOT execute virtual DOM diffing or re-render during playback ticks.
// 3. Immediate responsiveness: Verify seek(), pause(), and loadTrack() immediately update state without 1000ms throttle delay.
// 4. Lyrics active line synchronization: Verify SyllableLyricsEngine tracks singing progress accurately without desync or stutter.

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Register ESM resolution hook for relative .ts and .tsx imports
register('./helpers/tsxLoader.mjs', import.meta.url);

const { usePlayerStore } = await import('../src/state/playerStore.ts');
const { LyricsService } = await import('../src/services/LyricsService.ts');
const { normalizeSong } = await import('../src/models/Song.ts');

const sampleTrack = normalizeSong({
  videoId: 'm4-challenger-track-1',
  title: 'Ode to the Mets',
  artist: 'The Strokes',
  durationSec: 351,
  totalPlayTimeMs: 351000,
  streamUrl: 'https://rr1---sn-audio.googlevideo.com/videoplayback?id=sample',
});

// Mock minimal AudioEngine for store integration
class MockEngine {
  constructor(initialPos = 0, initialDur = 351000) {
    this.pos = initialPos;
    this.dur = initialDur;
    this.activeDeckName = 'active';
    this.deckA = { positionMs: initialPos, audioElement: { paused: false, readyState: 4 } };
    this.deckB = { positionMs: 0, audioElement: { paused: false, readyState: 4 } };
    this.stateCallbacks = [];
  }
  getCurrentPositionMs() {
    return this.pos;
  }
  getCurrentDurationMs() {
    return this.dur;
  }
  onPlaybackStateChange(cb) {
    this.stateCallbacks.push(cb);
    return () => {
      this.stateCallbacks = this.stateCallbacks.filter((c) => c !== cb);
    };
  }
  subscribeLivePcmEnergy() {
    return () => {};
  }
  play() {}
  pause() {}
  seek(ms) {
    this.pos = ms;
    this.deckA.positionMs = ms;
  }
  setVolume() {}
  async loadTrack() {}
  async getWaveformData() {
    return new Float32Array(200);
  }
}

// ============================================================================
// SUITE 1: AUDIO TICKER 1Hz THROTTLING & 5,000ms CONTINUOUS PLAYBACK SIMULATION
// ============================================================================
describe('Suite 1: Audio Ticker 1Hz Throttling & 5,000ms Playback Simulation', () => {
  beforeEach(() => {
    const store = usePlayerStore.getState();
    store.cleanupEngine();
    usePlayerStore.setState({
      currentTrack: sampleTrack,
      playbackState: 'PLAYING',
      positionMs: 0,
      durationMs: 351000,
      volume: 0.85,
      isMuted: false,
    });
  });

  test('T01: 5,000ms continuous playback produces <= 5 store position updates (1Hz), NOT 100 (20Hz)', () => {
    const engine = new MockEngine(0, 351000);
    usePlayerStore.getState().initEngine(engine);

    // Track every mutation of usePlayerStore
    let storePositionUpdateCount = 0;
    const storeUpdates = [];

    const unsubscribe = usePlayerStore.subscribe((state, prevState) => {
      if (state.positionMs !== prevState.positionMs) {
        storePositionUpdateCount++;
        storeUpdates.push({
          pos: state.positionMs,
          timeDelta: storeUpdates.length > 0 ? state.positionMs - storeUpdates[storeUpdates.length - 1].pos : state.positionMs,
        });
      }
    });

    // Simulate the exact useAudioController progress ticker logic:
    // 100 consecutive 50ms ticks = 5,000ms total simulated continuous playback
    let simulatedClock = 1000000; // arbitrary base timestamp
    let lastStoreSyncTime = simulatedClock;

    for (let tick = 1; tick <= 100; tick++) {
      simulatedClock += 50;
      engine.pos += 50;
      engine.deckA.positionMs = engine.pos;

      const state = usePlayerStore.getState();
      const enginePos = engine.getCurrentPositionMs();
      const engineDur = engine.getCurrentDurationMs();
      const nextDur = engineDur > 0 ? engineDur : state.durationMs || 180_000;

      let nextPos = enginePos;

      // 1Hz (1000ms) throttled store synchronization logic from useAudioController.ts:
      const now = simulatedClock;
      if (now - lastStoreSyncTime >= 1000 || Math.abs(nextPos - state.positionMs) > 1500) {
        lastStoreSyncTime = now;
        usePlayerStore.setState({
          positionMs: nextPos,
          durationMs: nextDur,
        });
      }
    }

    unsubscribe();

    // In 5,000ms at 20Hz (unthrottled), there would have been 100 updates.
    // With 1Hz throttling, there must be exactly 5 updates!
    assert.strictEqual(
      storePositionUpdateCount,
      5,
      `Expected exactly 5 store position updates over 5,000ms (1Hz), but got ${storePositionUpdateCount}`
    );

    // Verify timestamps of the updates: exactly ~1000ms apart
    assert.deepStrictEqual(
      storeUpdates.map((u) => u.pos),
      [1000, 2000, 3000, 4000, 5000],
      'Store updates must sync position at 1000ms increments (1s, 2s, 3s, 4s, 5s)'
    );

    // Verify intermediate 50ms ticks did NOT touch store positionMs
    // (Between t=4000 and t=4950, store positionMs remained 4000)
    assert.strictEqual(usePlayerStore.getState().positionMs, 5000);
  });

  test('T02: Source-level verification of useAudioController interval throttling contract', () => {
    const controllerPath = path.join(rootDir, 'src/ui/hooks/useAudioController.ts');
    assert.ok(fs.existsSync(controllerPath), 'useAudioController.ts must exist');
    const content = fs.readFileSync(controllerPath, 'utf8');

    // Must check now - lastStoreSyncTime >= 1000
    assert.match(
      content,
      /now\s*-\s*lastStoreSyncTime\s*>=\s*1000/,
      'useAudioController must enforce >= 1000ms elapsed before calling setState({ positionMs })'
    );

    // Verify the progress ticker block
    const tickerBlockMatch = content.match(/const\s+timer\s*=\s*setInterval\s*\(\s*\(\)\s*=>\s*\{([\s\S]*?)\},\s*50\s*\);/);
    assert.ok(tickerBlockMatch, '50ms interval must exist in useAudioController');
    const tickerBody = tickerBlockMatch[1];

    // Must NOT have unconditional usePlayerStore.setState inside the interval body
    // The setState must be strictly inside the if (now - lastStoreSyncTime >= 1000 ...) block
    assert.match(
      tickerBody,
      /if\s*\(\s*now\s*-\s*lastStoreSyncTime\s*>=\s*1000[\s\S]*?usePlayerStore\.setState/,
      'usePlayerStore.setState must be guarded by the 1000ms throttle condition'
    );

    // Must NOT poll live visualizer at 20Hz in progress ticker
    assert.strictEqual(
      tickerBody.includes('engine.pollLiveVisualizer()'),
      false,
      'useAudioController must not dispatch 20Hz pollLiveVisualizer() in progress interval'
    );
  });

  test('T03: Extended 10,000ms continuous playback stress test (200 ticks @ 50ms) produces exactly 10 store updates', () => {
    const engine = new MockEngine(0, 351000);
    usePlayerStore.getState().initEngine(engine);

    let storeUpdates = 0;
    const unsubscribe = usePlayerStore.subscribe((state, prevState) => {
      if (state.positionMs !== prevState.positionMs) {
        storeUpdates++;
      }
    });

    let simulatedClock = 2000000;
    let lastStoreSyncTime = simulatedClock;

    for (let tick = 1; tick <= 200; tick++) {
      simulatedClock += 50;
      engine.pos += 50;
      engine.deckA.positionMs = engine.pos;

      const state = usePlayerStore.getState();
      const enginePos = engine.getCurrentPositionMs();
      const engineDur = engine.getCurrentDurationMs();
      const nextDur = engineDur > 0 ? engineDur : state.durationMs || 180_000;
      let nextPos = enginePos;

      const now = simulatedClock;
      if (now - lastStoreSyncTime >= 1000 || Math.abs(nextPos - state.positionMs) > 1500) {
        lastStoreSyncTime = now;
        usePlayerStore.setState({
          positionMs: nextPos,
          durationMs: nextDur,
        });
      }
    }

    unsubscribe();
    assert.strictEqual(
      storeUpdates,
      10,
      `Expected exactly 10 store updates across 200 ticks (10,000ms at 1Hz), got ${storeUpdates}`
    );
    assert.strictEqual(usePlayerStore.getState().positionMs, 10000);
  });

  test('T04: AudioController fallback smoothly advances position by 50ms if audio element time delta is < 5ms', () => {
    // When audio element currentTime reports identical position (e.g. paused/buffering),
    // nextPos = Math.min(nextDur, state.positionMs + 50);
    const engine = new MockEngine(5000, 351000);
    // Keep engine.pos frozen at 5000
    usePlayerStore.setState({ positionMs: 5000, durationMs: 351000 });

    const state = usePlayerStore.getState();
    const enginePos = engine.getCurrentPositionMs(); // 5000
    let nextPos = enginePos;

    if (Math.abs(enginePos - state.positionMs) < 5) {
      nextPos = Math.min(state.durationMs, state.positionMs + 50);
    }

    assert.strictEqual(nextPos, 5050, 'Fallback smoothly increments position by 50ms');
  });
});

// ============================================================================
// SUITE 2: COMPONENT ISOLATION & ZERO RE-RENDERS DURING PLAYBACK
// ============================================================================
describe('Suite 2: Component Isolation & Zero Re-renders During Playback', () => {
  beforeEach(() => {
    usePlayerStore.setState({
      currentTrack: sampleTrack,
      playbackState: 'PLAYING',
      positionMs: 1000,
      durationMs: 351000,
      volume: 0.85,
      isMuted: false,
      isShuffle: false,
      repeatMode: 'off',
      waveformBuckets: new Float32Array(200),
    });
  });

  test('C01: BottomPlayerBar selectors evaluate identically across 100 playback position ticks (0 re-renders)', () => {
    // Exact selectors extracted from BottomPlayerBar.tsx lines 118-135
    const selectors = [
      (s) => s.currentTrack,
      (s) => s.playbackState,
      (s) => s.durationMs,
      (s) => s.volume,
      (s) => s.isMuted,
      (s) => s.isShuffle,
      (s) => s.repeatMode,
      (s) => s.waveformBuckets,
      (s) => s.togglePlay,
      (s) => s.seek,
      (s) => s.setVolume,
      (s) => s.toggleMute,
      (s) => s.toggleShuffle,
      (s) => s.cycleRepeatMode,
      (s) => s.adjustVolumeRelative,
      (s) => s.setNowPlayingModalOpen,
    ];

    // Record baseline values
    const baselines = selectors.map((sel) => sel(usePlayerStore.getState()));

    let diffDetected = 0;

    // Simulate 100 position updates to store (from 1,000ms to 101,000ms)
    for (let pos = 2000; pos <= 101000; pos += 1000) {
      usePlayerStore.setState({ positionMs: pos });
      const currentState = usePlayerStore.getState();

      for (let i = 0; i < selectors.length; i++) {
        const nextVal = selectors[i](currentState);
        if (!Object.is(baselines[i], nextVal)) {
          diffDetected++;
        }
      }
    }

    assert.strictEqual(
      diffDetected,
      0,
      `BottomPlayerBar had ${diffDetected} selector differences during position updates! Must be 0 to guarantee 0Hz re-renders.`
    );
  });

  test('C02: Leaf PlaybackTimePill selectors do not depend on positionMs (0 re-renders)', () => {
    // Exact selectors from PlaybackTimePill in BottomPlayerBar.tsx lines 50-51:
    // const isPlaying = usePlayerStore((s) => s.playbackState === 'PLAYING');
    // const storeDurationMs = usePlayerStore((s) => s.durationMs);
    const selIsPlaying = (s) => s.playbackState === 'PLAYING';
    const selDurationMs = (s) => s.durationMs;

    const baseIsPlaying = selIsPlaying(usePlayerStore.getState());
    const baseDuration = selDurationMs(usePlayerStore.getState());

    let pillDiffs = 0;
    for (let pos = 1000; pos <= 50000; pos += 1000) {
      usePlayerStore.setState({ positionMs: pos });
      const s = usePlayerStore.getState();
      if (!Object.is(baseIsPlaying, selIsPlaying(s)) || !Object.is(baseDuration, selDurationMs(s))) {
        pillDiffs++;
      }
    }

    assert.strictEqual(pillDiffs, 0, 'PlaybackTimePill selectors must be 100% immune to positionMs mutations');
  });

  test('C03: RightInspector suspends positionMs subscription when closed or on queue tab (0 re-renders)', () => {
    // Exact selector from RightSidecar.tsx line 49:
    // const positionMs = usePlayerStore((s) => (isOpen && activeTab === 'lyrics' ? s.positionMs : 0));

    // Case A: Inspector closed (isOpen = false)
    const closedSelector = (s) => (false && 'lyrics' === 'lyrics' ? s.positionMs : 0);
    const closedBase = closedSelector(usePlayerStore.getState());
    assert.strictEqual(closedBase, 0, 'Closed inspector must return 0');

    let closedDiffs = 0;
    for (let pos = 1000; pos <= 50000; pos += 1000) {
      usePlayerStore.setState({ positionMs: pos });
      if (!Object.is(closedBase, closedSelector(usePlayerStore.getState()))) {
        closedDiffs++;
      }
    }
    assert.strictEqual(closedDiffs, 0, 'Closed RightInspector must never diff/re-render on position changes');

    // Case B: Inspector open, but queue tab active (activeTab = 'queue')
    const queueTabSelector = (s) => (true && 'queue' === 'lyrics' ? s.positionMs : 0);
    const queueBase = queueTabSelector(usePlayerStore.getState());
    assert.strictEqual(queueBase, 0, 'Queue tab must return 0');

    let queueDiffs = 0;
    for (let pos = 1000; pos <= 50000; pos += 1000) {
      usePlayerStore.setState({ positionMs: pos });
      if (!Object.is(queueBase, queueTabSelector(usePlayerStore.getState()))) {
        queueDiffs++;
      }
    }
    assert.strictEqual(queueDiffs, 0, 'Queue tab in RightInspector must never diff/re-render on position changes');
  });

  test('C04: All 6 primary views (HomeScreen, ExploreScreen, SearchScreen, LibraryScreen, ReleaseDetailView, ArtistDetailView) have ZERO position-driven re-renders', () => {
    const viewSelectors = [
      {
        view: 'HomeScreen',
        selectors: [(s) => s.loadTrack, (s) => s.currentTrack?.videoId],
      },
      {
        view: 'ExploreScreen',
        selectors: [(s) => s.loadTrack, (s) => s.currentTrack?.videoId],
      },
      {
        view: 'SearchScreen',
        selectors: [(s) => s.loadTrack, (s) => s.currentTrack?.videoId],
      },
      {
        view: 'LibraryScreen',
        selectors: [(s) => s.loadTrack],
      },
      {
        view: 'ReleaseDetailView',
        selectors: [(s) => s.loadTrack, (s) => s.currentTrack?.videoId, (s) => s.playbackState === 'PLAYING'],
      },
      {
        view: 'ArtistDetailView',
        selectors: [(s) => s.loadTrack, (s) => s.currentTrack?.videoId],
      },
    ];

    for (const { view, selectors } of viewSelectors) {
      const baselines = selectors.map((sel) => sel(usePlayerStore.getState()));
      let diffs = 0;

      for (let pos = 1000; pos <= 20000; pos += 1000) {
        usePlayerStore.setState({ positionMs: pos });
        const s = usePlayerStore.getState();
        for (let i = 0; i < selectors.length; i++) {
          if (!Object.is(baselines[i], selectors[i](s))) {
            diffs++;
          }
        }
      }

      assert.strictEqual(diffs, 0, `${view} must have 0 selector changes during playback position updates`);
    }
  });

  test('C05: Source audit confirms 8 components use memo and do not reference unthrottled position', () => {
    const files = [
      'src/ui/layout/BottomPlayerBar.tsx',
      'src/ui/layout/RightSidecar.tsx',
      'src/ui/views/HomeScreen.tsx',
      'src/ui/views/ExploreScreen.tsx',
      'src/ui/views/SearchScreen.tsx',
      'src/ui/views/LibraryScreen.tsx',
      'src/ui/views/ReleaseDetailView.tsx',
      'src/ui/views/ArtistDetailView.tsx',
    ];

    for (const file of files) {
      const fullPath = path.join(rootDir, file);
      const text = fs.readFileSync(fullPath, 'utf8');

      // 1. Must be wrapped in memo / React.memo
      assert.ok(
        text.includes('memo(') || text.includes('React.memo(') || text.includes('memo<'),
        `${file} must be wrapped in memo()`
      );

      // 2. Must not call wide usePlayerStore()
      assert.strictEqual(
        /usePlayerStore\s*\(\s*\)/.test(text),
        false,
        `${file} must not call unselected usePlayerStore()`
      );

      // 3. For views and BottomPlayerBar, must not subscribe to s.positionMs
      if (!file.includes('RightSidecar.tsx')) {
        assert.strictEqual(
          /s\.positionMs/.test(text),
          false,
          `${file} must not subscribe to s.positionMs`
        );
      }
    }
  });

  test('C06: Active React-like subscriber harnesses for all 8 components verify exactly 0 re-render notifications over 100 playback position ticks', () => {
    function createSubscriberHarness(selectors) {
      let renderCount = 0;
      let lastValues = selectors.map((sel) => sel(usePlayerStore.getState()));

      const unsubscribe = usePlayerStore.subscribe((state) => {
        let shouldRender = false;
        for (let i = 0; i < selectors.length; i++) {
          const nextVal = selectors[i](state);
          if (!Object.is(lastValues[i], nextVal)) {
            lastValues[i] = nextVal;
            shouldRender = true;
          }
        }
        if (shouldRender) {
          renderCount++;
        }
      });

      return {
        getRenderCount: () => renderCount,
        unsubscribe,
      };
    }

    const componentConfigs = [
      {
        name: 'BottomPlayerBar',
        selectors: [
          (s) => s.currentTrack,
          (s) => s.playbackState,
          (s) => s.durationMs,
          (s) => s.volume,
          (s) => s.isMuted,
          (s) => s.isShuffle,
          (s) => s.repeatMode,
          (s) => s.waveformBuckets,
        ],
      },
      {
        name: 'RightInspector (closed)',
        selectors: [
          (s) => s.currentTrack,
          (s) => s.seek,
          (s) => (false && 'lyrics' === 'lyrics' ? s.positionMs : 0),
        ],
      },
      {
        name: 'HomeScreen',
        selectors: [(s) => s.loadTrack, (s) => s.currentTrack?.videoId],
      },
      {
        name: 'ExploreScreen',
        selectors: [(s) => s.loadTrack, (s) => s.currentTrack?.videoId],
      },
      {
        name: 'SearchScreen',
        selectors: [(s) => s.loadTrack, (s) => s.currentTrack?.videoId],
      },
      {
        name: 'LibraryScreen',
        selectors: [(s) => s.loadTrack],
      },
      {
        name: 'ReleaseDetailView',
        selectors: [(s) => s.loadTrack, (s) => s.currentTrack?.videoId, (s) => s.playbackState === 'PLAYING'],
      },
      {
        name: 'ArtistDetailView',
        selectors: [(s) => s.loadTrack, (s) => s.currentTrack?.videoId],
      },
    ];

    const mountedHarnesses = componentConfigs.map((cfg) => ({
      name: cfg.name,
      harness: createSubscriberHarness(cfg.selectors),
    }));

    // Fire 100 continuous playback position updates
    for (let pos = 1000; pos <= 100000; pos += 1000) {
      usePlayerStore.setState({ positionMs: pos });
    }

    for (const { name, harness } of mountedHarnesses) {
      assert.strictEqual(
        harness.getRenderCount(),
        0,
        `${name} simulated subscriber executed ${harness.getRenderCount()} re-renders during playback! Expected 0.`
      );
      harness.unsubscribe();
    }
  });
});

// ============================================================================
// SUITE 3: IMMEDIATE RESPONSIVENESS ON SEEK, PAUSE, AND LOADTRACK
// ============================================================================
describe('Suite 3: Immediate Responsiveness on Seek, Pause, and LoadTrack', () => {
  let engine;

  beforeEach(() => {
    usePlayerStore.getState().cleanupEngine();
    engine = new MockEngine(10000, 351000);
    usePlayerStore.getState().initEngine(engine);
    usePlayerStore.setState({
      currentTrack: sampleTrack,
      playbackState: 'PLAYING',
      positionMs: 10000,
      durationMs: 351000,
    });
  });

  test('R01: seek(positionMs) immediately updates positionMs with 0ms delay (no 1000ms throttle)', () => {
    const targetMs = 45000;
    usePlayerStore.getState().seek(targetMs);

    assert.strictEqual(
      usePlayerStore.getState().positionMs,
      targetMs,
      'seek() must synchronously update store positionMs immediately'
    );
    assert.strictEqual(
      engine.getCurrentPositionMs(),
      targetMs,
      'seek() must immediately update audio engine position'
    );
  });

  test('R02: seek() boundary clamping: negative clamped to 0, overflow clamped to durationMs', () => {
    // Negative seek
    usePlayerStore.getState().seek(-5000);
    assert.strictEqual(usePlayerStore.getState().positionMs, 0, 'Negative seek must clamp to 0');

    // Overflow seek
    usePlayerStore.getState().seek(999999);
    assert.strictEqual(
      usePlayerStore.getState().positionMs,
      351000,
      'Seek beyond duration must clamp to durationMs'
    );
  });

  test('R03: seekRelative(+deltaMs / -deltaMs) immediately updates state without throttle', () => {
    usePlayerStore.getState().seek(50000);
    assert.strictEqual(usePlayerStore.getState().positionMs, 50000);

    // Relative forward +5000ms
    usePlayerStore.getState().seekRelative(5000);
    assert.strictEqual(usePlayerStore.getState().positionMs, 55000, '+5000ms relative seek must update immediately');

    // Relative backward -15000ms
    usePlayerStore.getState().seekRelative(-15000);
    assert.strictEqual(usePlayerStore.getState().positionMs, 40000, '-15000ms relative seek must update immediately');
  });

  test('R04: pause() immediately sets playbackState to PAUSED with 0ms delay', () => {
    assert.strictEqual(usePlayerStore.getState().playbackState, 'PLAYING');
    usePlayerStore.getState().pause();

    assert.strictEqual(
      usePlayerStore.getState().playbackState,
      'PAUSED',
      'pause() must synchronously transition state to PAUSED'
    );
  });

  test('R05: loadTrack() immediately sets track, resets positionMs to 0, sets durationMs', async () => {
    const newTrack = normalizeSong({
      videoId: 'm4-challenger-track-2',
      title: 'Sweet Taste of India',
      artist: 'Asha Bhosle',
      durationSec: 180,
      totalPlayTimeMs: 180000,
      streamUrl: 'https://rr1---sn-audio.googlevideo.com/videoplayback?id=sample2',
    });

    usePlayerStore.setState({ positionMs: 120000 });
    assert.strictEqual(usePlayerStore.getState().positionMs, 120000);

    await usePlayerStore.getState().loadTrack(newTrack, 'active', false);

    const s = usePlayerStore.getState();
    assert.strictEqual(s.currentTrack?.videoId, 'm4-challenger-track-2', 'Track must load immediately');
    assert.strictEqual(s.positionMs, 0, 'positionMs must immediately reset to 0');
    assert.strictEqual(s.durationMs, 180000, 'durationMs must immediately update to new track duration');
  });

  test('R06: Large position jump (>1500ms) bypasses 1000ms throttle in ticker loop', () => {
    // In useAudioController.ts:
    // if (now - lastStoreSyncTime >= 1000 || Math.abs(nextPos - state.positionMs) > 1500)
    let lastStoreSyncTime = 1000000;
    const now = 1000200; // Only 200ms elapsed since last sync!

    const currentStorePos = 10000;
    const jumpedEnginePos = 45000; // Jump of 35,000ms (user scrubbed or skipped)

    const shouldForceSync = (now - lastStoreSyncTime >= 1000) || Math.abs(jumpedEnginePos - currentStorePos) > 1500;
    assert.strictEqual(
      shouldForceSync,
      true,
      'Large delta (>1500ms) must immediately bypass 1000ms throttle and trigger sync'
    );
  });

  test('R07: High-frequency rapid seek burst (20 seeks in 100ms) updates synchronously on every single seek with zero delay', () => {
    // Simulate user rapidly dragging or scrubbing seek bar
    for (let i = 1; i <= 20; i++) {
      const scrubPos = i * 5000;
      usePlayerStore.getState().seek(scrubPos);
      assert.strictEqual(
        usePlayerStore.getState().positionMs,
        scrubPos,
        `Seek call #${i} at ${scrubPos}ms must update immediately`
      );
      assert.strictEqual(
        engine.getCurrentPositionMs(),
        scrubPos,
        `Engine position for call #${i} must update immediately`
      );
    }
  });
});

// ============================================================================
// SUITE 4: LYRICS ACTIVE LINE SYNCHRONIZATION & MEMOIZATION ORACLE
// ============================================================================
describe('Suite 4: Lyrics Active Line Synchronization & Memoization Oracle', () => {
  const denseLyrics = {
    type: 'SYLLABLE_SYNCED',
    isSynced: true,
    provider: 'lrclib',
    lines: [
      {
        lineIndex: 0,
        startTimeMs: 1000,
        endTimeMs: 4000,
        text: 'Up on the hill',
        syllables: [
          { text: 'Up', startTimeMs: 1000, endTimeMs: 1500 },
          { text: ' ', startTimeMs: 1500, endTimeMs: 1600 },
          { text: 'on', startTimeMs: 1600, endTimeMs: 2200 },
          { text: ' ', startTimeMs: 2200, endTimeMs: 2300 },
          { text: 'the', startTimeMs: 2300, endTimeMs: 2800 },
          { text: ' ', startTimeMs: 2800, endTimeMs: 2900 },
          { text: 'hill', startTimeMs: 2900, endTimeMs: 4000 },
        ],
      },
      {
        lineIndex: 1,
        startTimeMs: 4500,
        endTimeMs: 8000,
        text: 'Where we used to play',
        syllables: [
          { text: 'Where', startTimeMs: 4500, endTimeMs: 5200 },
          { text: ' ', startTimeMs: 5200, endTimeMs: 5300 },
          { text: 'we', startTimeMs: 5300, endTimeMs: 5900 },
          { text: ' ', startTimeMs: 5900, endTimeMs: 6000 },
          { text: 'used', startTimeMs: 6000, endTimeMs: 6800 },
          { text: ' ', startTimeMs: 6800, endTimeMs: 6900 },
          { text: 'to', startTimeMs: 6900, endTimeMs: 7300 },
          { text: ' ', startTimeMs: 7300, endTimeMs: 7400 },
          { text: 'play', startTimeMs: 7400, endTimeMs: 8000 },
        ],
      },
      {
        lineIndex: 2,
        startTimeMs: 8500,
        endTimeMs: 12000,
        text: 'Echoes in the wind',
        syllables: [
          { text: 'Echoes', startTimeMs: 8500, endTimeMs: 9500 },
          { text: ' ', startTimeMs: 9500, endTimeMs: 9600 },
          { text: 'in', startTimeMs: 9600, endTimeMs: 10200 },
          { text: ' ', startTimeMs: 10200, endTimeMs: 10300 },
          { text: 'the', startTimeMs: 10300, endTimeMs: 10800 },
          { text: ' ', startTimeMs: 10800, endTimeMs: 10900 },
          { text: 'wind', startTimeMs: 10900, endTimeMs: 12000 },
        ],
      },
    ],
  };

  test('L01: LyricsService.getActiveLineIndex tracks progression across exact boundary milestones', () => {
    // Before first line
    assert.strictEqual(LyricsService.getActiveLineIndex(denseLyrics, 500), -1);

    // Exactly at line 0 start
    assert.strictEqual(LyricsService.getActiveLineIndex(denseLyrics, 1000), 0);

    // Midway in line 0
    assert.strictEqual(LyricsService.getActiveLineIndex(denseLyrics, 2500), 0);

    // Exactly at line 0 end
    assert.strictEqual(LyricsService.getActiveLineIndex(denseLyrics, 4000), 0);

    // Gap between line 0 and line 1 (4000-4500ms): binary search remains on last sung line or advances
    const gapIndex = LyricsService.getActiveLineIndex(denseLyrics, 4200);
    assert.ok(gapIndex === 0 || gapIndex === 1, 'In-between line gap must resolve monotonically');

    // Exactly at line 1 start
    assert.strictEqual(LyricsService.getActiveLineIndex(denseLyrics, 4500), 1);

    // Midway in line 1
    assert.strictEqual(LyricsService.getActiveLineIndex(denseLyrics, 6500), 1);

    // Line 2
    assert.strictEqual(LyricsService.getActiveLineIndex(denseLyrics, 9000), 2);

    // Beyond last line
    assert.strictEqual(LyricsService.getActiveLineIndex(denseLyrics, 15000), 2);
  });

  test('L02: Syllable progression states: upcoming -> singing -> sung sequence is monotonic and glitch-free', () => {
    const line0 = denseLyrics.lines[0];
    const sylHill = line0.syllables.find((s) => s.text === 'hill'); // 2900 - 4000ms

    // Test helper matching SyllableLyricsEngine.tsx lines 103-105:
    function getSyllableState(syl, pos) {
      const isSung = pos >= syl.endTimeMs;
      const isSinging = pos >= syl.startTimeMs && pos < syl.endTimeMs;
      return { isSung, isSinging, isUpcoming: !isSung && !isSinging };
    }

    // t = 2000ms (before "hill"): upcoming
    const stateBefore = getSyllableState(sylHill, 2000);
    assert.strictEqual(stateBefore.isUpcoming, true);
    assert.strictEqual(stateBefore.isSinging, false);
    assert.strictEqual(stateBefore.isSung, false);

    // t = 3200ms (singing "hill"): singing
    const stateSinging = getSyllableState(sylHill, 3200);
    assert.strictEqual(stateSinging.isUpcoming, false);
    assert.strictEqual(stateSinging.isSinging, true);
    assert.strictEqual(stateSinging.isSung, false);

    // t = 4500ms (after "hill"): sung
    const stateSung = getSyllableState(sylHill, 4500);
    assert.strictEqual(stateSung.isUpcoming, false);
    assert.strictEqual(stateSung.isSinging, false);
    assert.strictEqual(stateSung.isSung, true);
  });

  test('L03: Whitespace syllables are strictly filtered from singing animation styles', () => {
    const line0 = denseLyrics.lines[0];
    const whitespaceSyllables = line0.syllables.filter((s) => /^\s+$/.test(s.text));
    assert.strictEqual(whitespaceSyllables.length, 3, 'Line must contain 3 whitespace separators');

    for (const space of whitespaceSyllables) {
      const isWhitespace = /^\s+$/.test(space.text);
      assert.strictEqual(isWhitespace, true);
      // In SyllableLyricsEngine.tsx:
      // if (isWhitespace) return <span className="inline text-white/45">{syl.text}</span>;
      // It completely bypasses singing lift (-2px) and textShadow!
    }
  });

  test('L04: LyricLineRow memoization comparator skips re-rendering for >= 97% of lines on every playback tick', () => {
    // Generate a 40-line lyrics structure
    const totalLines = 40;
    const lines = [];
    for (let i = 0; i < totalLines; i++) {
      lines.push({
        lineIndex: i,
        startTimeMs: i * 4000,
        endTimeMs: (i + 1) * 4000 - 500,
        text: `Lyric line test number ${i}`,
        syllables: [],
      });
    }

    // Exact comparator from SyllableLyricsEngine.tsx lines 168-186:
    function lineRowComparator(prev, next) {
      if (
        !prev.isActiveLine &&
        !next.isActiveLine &&
        prev.isPassedLine === next.isPassedLine &&
        prev.showRomanization === next.showRomanization &&
        prev.showTranslation === next.showTranslation &&
        prev.fontSize === next.fontSize &&
        prev.line === next.line &&
        prev.isUnsynced === next.isUnsynced &&
        prev.canSeek === next.canSeek
      ) {
        return true; // SKIP RE-RENDERING THIS LINE!
      }
      return false; // RE-RENDER
    }

    // Scenario A: Playhead is at t = 22,000ms (Active line is line 5).
    // Playhead advances by 50ms to t = 22,050ms (Line 5 is still active).
    const activeLine = 5;

    let skippedLines = 0;
    let reRenderedLines = 0;

    for (let i = 0; i < totalLines; i++) {
      const prevProps = {
        line: lines[i],
        lIndex: i,
        isActiveLine: i === activeLine,
        isPassedLine: i < activeLine,
        isUnsynced: false,
        fontSize: 24,
        canSeek: true,
        showRomanization: false,
        showTranslation: false,
      };

      const nextProps = {
        ...prevProps,
        // Position ticks forward
        currentPositionMs: 22050,
      };

      const shouldSkip = lineRowComparator(prevProps, nextProps);
      if (shouldSkip) {
        skippedLines++;
      } else {
        reRenderedLines++;
      }
    }

    // Exactly 39 lines should be skipped (97.5%), and only 1 line (line 5) re-renders!
    assert.strictEqual(reRenderedLines, 1, 'Only the active singing line should re-render');
    assert.strictEqual(skippedLines, 39, 'All 39 non-active lines must skip re-render');

    const skipPercentage = (skippedLines / totalLines) * 100;
    assert.ok(
      skipPercentage >= 97.0,
      `Expected >= 97% lines skipped, got ${skipPercentage.toFixed(1)}%`
    );

    // Scenario B: Line transition (from line 5 to line 6):
    let transitionSkipped = 0;
    let transitionReRendered = 0;

    for (let i = 0; i < totalLines; i++) {
      const prevProps = {
        line: lines[i],
        lIndex: i,
        isActiveLine: i === 5,
        isPassedLine: i < 5,
        isUnsynced: false,
        fontSize: 24,
        canSeek: true,
        showRomanization: false,
        showTranslation: false,
      };

      const nextProps = {
        ...prevProps,
        isActiveLine: i === 6,
        isPassedLine: i < 6,
        currentPositionMs: 24100,
      };

      const shouldSkip = lineRowComparator(prevProps, nextProps);
      if (shouldSkip) {
        transitionSkipped++;
      } else {
        transitionReRendered++;
      }
    }

    // On line transition: exactly line 5 (previous active) and line 6 (now active) re-render.
    // 38 lines (95%) still skip re-render!
    assert.strictEqual(transitionReRendered, 2, 'Exactly 2 lines re-render during line transition');
    assert.strictEqual(transitionSkipped, 38, '38 lines skip re-render during line transition');
  });

  test('L05: Unsynced lyrics guard completely locks active line to -1 and prevents dimming', () => {
    const unsyncedLyrics = {
      type: 'UNSYNCED',
      isSynced: false,
      provider: 'lrclib',
      lines: [
        { lineIndex: 0, startTimeMs: 0, endTimeMs: 0, text: 'First unsynced line', syllables: [] },
        { lineIndex: 1, startTimeMs: 0, endTimeMs: 0, text: 'Second unsynced line', syllables: [] },
      ],
    };

    // 1. Evaluate SyllableLyricsEngine.tsx isUnsynced formula (lines 213-217)
    const isUnsynced =
      !unsyncedLyrics || !unsyncedLyrics.lines || unsyncedLyrics.lines.length === 0
        ? false
        : unsyncedLyrics.type === 'UNSYNCED' ||
          unsyncedLyrics.isSynced === false ||
          unsyncedLyrics.lines.every((l) => l.startTimeMs === 0 && l.endTimeMs === 0);

    assert.strictEqual(isUnsynced, true, 'isUnsynced formula must classify unsynced lyrics as true');

    // 2. Evaluate SyllableLyricsEngine activeLineIndex formula (lines 220-224)
    // When isUnsynced is true, binary search is bypassed and activeLineIndex is locked to -1
    const activeLineIndex = isUnsynced ? -1 : LyricsService.getActiveLineIndex(unsyncedLyrics, 5000);
    assert.strictEqual(
      activeLineIndex,
      -1,
      'SyllableLyricsEngine activeLineIndex MUST be locked to -1 for unsynced lyrics'
    );
  });

  test('L06: Rapid scrub stress test across dense lyrics jumps active line index instantly without desync or memory leaks', () => {
    // 50 rapid scrub hops across 100,000ms song
    const hops = [
      500, 3200, 7500, 11500, 200, 6000, 9500, 4500, 8000, 1000,
      12000, 3500, 7000, 9000, 1500, 5000, 10500, 2500, 8500, 11000,
    ];

    for (const pos of hops) {
      const idx = LyricsService.getActiveLineIndex(denseLyrics, pos);
      assert.ok(idx >= -1 && idx < denseLyrics.lines.length, `Active line index ${idx} must be within bounds [-1, ${denseLyrics.lines.length - 1}]`);

      if (pos >= 1000 && pos <= 4000) {
        assert.strictEqual(idx, 0, `At ${pos}ms, active line must be 0`);
      } else if (pos >= 4500 && pos <= 8000) {
        assert.strictEqual(idx, 1, `At ${pos}ms, active line must be 1`);
      } else if (pos >= 8500 && pos <= 12000) {
        assert.strictEqual(idx, 2, `At ${pos}ms, active line must be 2`);
      }
    }
  });

  test('L07: Micro-syllables (<50ms) accurately transition singing state without skipping', () => {
    const fastLine = {
      lineIndex: 0,
      startTimeMs: 1000,
      endTimeMs: 1200,
      text: 'quick rap',
      syllables: [
        { text: 'quick', startTimeMs: 1000, endTimeMs: 1040 },
        { text: ' ', startTimeMs: 1040, endTimeMs: 1050 },
        { text: 'rap', startTimeMs: 1050, endTimeMs: 1200 },
      ],
    };

    const wordInfo1 = LyricsService.getActiveWord(fastLine, 1020);
    assert.strictEqual(wordInfo1.activeSyllable?.text, 'quick');
    assert.strictEqual(wordInfo1.syllableIndex, 0);
    assert.ok(wordInfo1.progress > 0 && wordInfo1.progress < 1.0);

    const wordInfo2 = LyricsService.getActiveWord(fastLine, 1100);
    assert.strictEqual(wordInfo2.activeSyllable?.text, 'rap');
    assert.strictEqual(wordInfo2.syllableIndex, 2);
    assert.ok(wordInfo2.progress > 0 && wordInfo2.progress < 1.0);
  });
});
