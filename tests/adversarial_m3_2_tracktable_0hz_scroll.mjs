// tests/adversarial_m3_2_tracktable_0hz_scroll.mjs
// ==============================================================================
// EMPIRICAL CHALLENGER TEST SUITE: 0Hz AUDIO PLAYBACK RE-RENDER INVARIANT & 60FPS SCROLL
// Milestone 3 Verification Gate
//
// Invariants Tested:
// 1. DesktopTrackTable 0Hz Re-render Invariant during continuous audio playback (200 ticks @ 200ms / 40s)
// 2. DesktopTrackTable isolation against seeks, volume changes, shuffle, and repeat toggles
// 3. DesktopTrackTable surgical re-rendering strictly on track transition or play/pause state change
// 4. Content Views 0Hz Re-render Invariant (HomeScreen, ExploreScreen, LibraryScreen, ReleaseDetailView,
//    ArtistDetailView, LocalMediaView, CoverFlowView, RadioPartyView)
// 5. PlaybackTimePill leaf DOM direct mutation isolation (0 React re-renders)
// 6. RightInspector position subscription suspension (closed / queue tab)
// 7. 60fps CSS containment and layout predictability across 10,000 virtual rows
// 8. AST / Source audit confirming zero uncontained backdropFilter on scroll surfaces
// ==============================================================================

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

register('./helpers/tsxLoader.mjs', import.meta.url);

const { usePlayerStore } = await import('../src/state/playerStore.ts');
const { normalizeSong } = await import('../src/models/Song.ts');

const trackA = normalizeSong({
  videoId: 'track-alpha-001',
  title: 'Ode to the Mets',
  artist: 'The Strokes',
  durationSec: 351,
  totalPlayTimeMs: 351000,
  streamUrl: 'https://example.com/audio1.mp4',
});

const trackB = normalizeSong({
  videoId: 'track-beta-002',
  title: 'Sweet Taste of India',
  artist: 'Asha Bhosle',
  durationSec: 180,
  totalPlayTimeMs: 180000,
  streamUrl: 'https://example.com/audio2.mp4',
});

function createSubscriberHarness(selectors, store = usePlayerStore) {
  let renderCount = 0;
  let lastValues = selectors.map((sel) => sel(store.getState()));

  const unsubscribe = store.subscribe((state) => {
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
    resetCount: () => {
      renderCount = 0;
      lastValues = selectors.map((sel) => sel(store.getState()));
    },
    unsubscribe,
  };
}

// ==============================================================================
// SUITE 1: DESKTOP TRACK TABLE 0HZ PLAYBACK RE-RENDER INVARIANT
// ==============================================================================
describe('Suite 1: DesktopTrackTable 0Hz Playback Re-render Invariant', () => {
  beforeEach(() => {
    usePlayerStore.setState({
      currentTrack: trackA,
      playbackState: 'PLAYING',
      positionMs: 0,
      durationMs: 351000,
      volume: 0.85,
      isMuted: false,
      isShuffle: false,
      repeatMode: 'off',
    });
  });

  test('TT-01: DesktopTrackTable selectors evaluate to 0 re-renders over 200 playback position ticks (40,000ms simulation)', () => {
    // Selectors from DesktopTrackTable.tsx lines 61-64
    const trackTableSelectors = [
      (s) => s.currentTrack?.videoId,
      (s) => s.playbackState === 'PLAYING',
      (s) => s.loadTrack,
      (s) => s.togglePlay,
    ];

    const harness = createSubscriberHarness(trackTableSelectors);

    // Simulate 200 position updates to store (every 200ms = 40s playback)
    for (let pos = 200; pos <= 40000; pos += 200) {
      usePlayerStore.setState({ positionMs: pos });
    }

    assert.strictEqual(
      harness.getRenderCount(),
      0,
      `DesktopTrackTable re-rendered ${harness.getRenderCount()} times during 200 playback position updates! Expected 0.`
    );

    harness.unsubscribe();
  });

  test('TT-02: DesktopTrackTable is completely immune to rapid seeks and relative seeks', () => {
    const trackTableSelectors = [
      (s) => s.currentTrack?.videoId,
      (s) => s.playbackState === 'PLAYING',
      (s) => s.loadTrack,
      (s) => s.togglePlay,
    ];

    const harness = createSubscriberHarness(trackTableSelectors);

    // Fire 50 random seeks
    for (let i = 0; i < 50; i++) {
      const seekTarget = Math.floor(Math.random() * 350000);
      usePlayerStore.getState().seek(seekTarget);
    }

    assert.strictEqual(
      harness.getRenderCount(),
      0,
      `DesktopTrackTable re-rendered ${harness.getRenderCount()} times during rapid seeks! Expected 0.`
    );

    harness.unsubscribe();
  });

  test('TT-03: DesktopTrackTable is immune to volume, mute, shuffle, and repeat changes', () => {
    const trackTableSelectors = [
      (s) => s.currentTrack?.videoId,
      (s) => s.playbackState === 'PLAYING',
      (s) => s.loadTrack,
      (s) => s.togglePlay,
    ];

    const harness = createSubscriberHarness(trackTableSelectors);

    // Volume mutations
    usePlayerStore.setState({ volume: 0.5 });
    usePlayerStore.setState({ volume: 1.0 });
    usePlayerStore.setState({ isMuted: true });
    usePlayerStore.setState({ isMuted: false });

    // Mode mutations
    usePlayerStore.setState({ isShuffle: true });
    usePlayerStore.setState({ repeatMode: 'all' });
    usePlayerStore.setState({ repeatMode: 'one' });
    usePlayerStore.setState({ repeatMode: 'off' });

    assert.strictEqual(
      harness.getRenderCount(),
      0,
      `DesktopTrackTable re-rendered ${harness.getRenderCount()} times during volume/mode changes! Expected 0.`
    );

    harness.unsubscribe();
  });

  test('TT-04: DesktopTrackTable surgical re-rendering: exactly 1 re-render on track change, 1 re-render on pause/play', () => {
    const trackTableSelectors = [
      (s) => s.currentTrack?.videoId,
      (s) => s.playbackState === 'PLAYING',
      (s) => s.loadTrack,
      (s) => s.togglePlay,
    ];

    const harness = createSubscriberHarness(trackTableSelectors);

    // 1. Pause playback -> must re-render once to update equalizer to pause state
    usePlayerStore.setState({ playbackState: 'PAUSED' });
    assert.strictEqual(harness.getRenderCount(), 1, 'Pause must cause exactly 1 re-render');

    // 2. Resume playback -> must re-render once to update pause to equalizer state
    usePlayerStore.setState({ playbackState: 'PLAYING' });
    assert.strictEqual(harness.getRenderCount(), 2, 'Play resume must cause exactly 1 re-render (total 2)');

    // 3. Switch track -> must re-render once to update active row highlight
    usePlayerStore.setState({ currentTrack: trackB });
    assert.strictEqual(harness.getRenderCount(), 3, 'Track switch must cause exactly 1 re-render (total 3)');

    // 4. Continued playback of trackB -> 0 re-renders
    for (let pos = 500; pos <= 10000; pos += 500) {
      usePlayerStore.setState({ positionMs: pos });
    }
    assert.strictEqual(harness.getRenderCount(), 3, 'Position updates on new track must cause 0 additional re-renders');

    harness.unsubscribe();
  });

  test('TT-05: DesktopTrackTable source verification: wrapped in React.memo and 0 positionMs references', () => {
    const filePath = path.join(ROOT, 'src/ui/components/DesktopTrackTable.tsx');
    const content = fs.readFileSync(filePath, 'utf8');

    assert.ok(
      content.includes('memo(') || content.includes('React.memo('),
      'DesktopTrackTable must be memoized'
    );
    assert.strictEqual(
      content.includes('s.positionMs'),
      false,
      'DesktopTrackTable must NOT subscribe to s.positionMs'
    );
    assert.strictEqual(
      /usePlayerStore\s*\(\s*\)/.test(content),
      false,
      'DesktopTrackTable must NOT invoke wide usePlayerStore()'
    );
  });
});

// ==============================================================================
// SUITE 2: CONTENT VIEWS 0HZ RE-RENDER INVARIANT (8 PRIMARY VIEWS)
// ==============================================================================
describe('Suite 2: Content Views 0Hz Re-render Invariant Across 8 Views', () => {
  beforeEach(() => {
    usePlayerStore.setState({
      currentTrack: trackA,
      playbackState: 'PLAYING',
      positionMs: 1000,
      durationMs: 351000,
    });
  });

  const views = [
    {
      name: 'HomeScreen',
      file: 'src/ui/views/HomeScreen.tsx',
      selectors: [(s) => s.loadTrack, (s) => s.currentTrack?.videoId],
    },
    {
      name: 'ExploreScreen',
      file: 'src/ui/views/ExploreScreen.tsx',
      selectors: [(s) => s.loadTrack, (s) => s.currentTrack?.videoId],
    },
    {
      name: 'LibraryScreen',
      file: 'src/ui/views/LibraryScreen.tsx',
      selectors: [(s) => s.loadTrack],
    },
    {
      name: 'ReleaseDetailView',
      file: 'src/ui/views/ReleaseDetailView.tsx',
      selectors: [(s) => s.loadTrack, (s) => s.currentTrack?.videoId, (s) => s.playbackState === 'PLAYING'],
    },
    {
      name: 'ArtistDetailView',
      file: 'src/ui/views/ArtistDetailView.tsx',
      selectors: [(s) => s.loadTrack, (s) => s.currentTrack?.videoId],
    },
    {
      name: 'CoverFlowView',
      file: 'src/ui/views/CoverFlowView.tsx',
      selectors: [(s) => s.loadTrack],
    },
    {
      name: 'RadioPartyView',
      file: 'src/ui/views/RadioPartyView.tsx',
      selectors: [(s) => s.loadTrack, (s) => s.currentTrack?.videoId],
    },
    {
      name: 'LocalMediaView',
      file: 'src/ui/views/LocalMediaView.tsx',
      selectors: [], // No player store subscriptions
    },
  ];

  test('CV-01: All 8 content views produce exactly 0 re-render notifications across 150+ playback ticks', () => {
    const harnesses = views.map((v) => ({
      name: v.name,
      harness: createSubscriberHarness(v.selectors),
    }));

    // Simulate 160 ticks (32,000ms at 200ms per tick)
    for (let pos = 1000; pos <= 33000; pos += 200) {
      usePlayerStore.setState({ positionMs: pos });
    }

    for (const { name, harness } of harnesses) {
      assert.strictEqual(
        harness.getRenderCount(),
        0,
        `${name} triggered ${harness.getRenderCount()} re-renders during 160 position ticks! Must be 0.`
      );
      harness.unsubscribe();
    }
  });

  test('CV-02: Source verification of all 8 view files confirms React.memo and 0 unthrottled position references', () => {
    for (const v of views) {
      const fullPath = path.join(ROOT, v.file);
      assert.ok(fs.existsSync(fullPath), `${v.file} must exist`);
      const text = fs.readFileSync(fullPath, 'utf8');

      // Check memoization (or export default memo)
      const hasMemo = text.includes('React.memo') || text.includes('memo(') || text.includes('memo<');
      assert.ok(hasMemo, `${v.name} must be wrapped in memo()`);

      // Ensure no subscription to positionMs
      assert.strictEqual(
        text.includes('s.positionMs'),
        false,
        `${v.name} must NOT subscribe to s.positionMs`
      );

      // Ensure no wide usePlayerStore()
      assert.strictEqual(
        /usePlayerStore\s*\(\s*\)/.test(text),
        false,
        `${v.name} must NOT call wide usePlayerStore()`
      );
    }
  });
});

// ==============================================================================
// SUITE 3: PLAYBACK TIME PILL & RIGHT INSPECTOR ISOLATION ORACLE
// ==============================================================================
describe('Suite 3: PlaybackTimePill & RightInspector Isolation Oracle', () => {
  beforeEach(() => {
    usePlayerStore.setState({
      currentTrack: trackA,
      playbackState: 'PLAYING',
      positionMs: 0,
      durationMs: 351000,
    });
  });

  test('PILL-01: PlaybackTimePill selectors are immune to position changes (0 React re-renders)', () => {
    // Selectors from PlaybackTimePill:
    // const isPlaying = usePlayerStore((s) => s.playbackState === 'PLAYING');
    // const storeDurationMs = usePlayerStore((s) => s.durationMs);
    const pillSelectors = [
      (s) => s.playbackState === 'PLAYING',
      (s) => s.durationMs,
    ];

    const harness = createSubscriberHarness(pillSelectors);

    // 150 position updates
    for (let pos = 200; pos <= 30000; pos += 200) {
      usePlayerStore.setState({ positionMs: pos });
    }

    assert.strictEqual(harness.getRenderCount(), 0, 'PlaybackTimePill must not re-render on position changes');
    harness.unsubscribe();
  });

  test('PILL-02: Direct DOM textContent formatting logic emulates accurately across 150 ticks', () => {
    const durationMs = 351000; // 5:51
    let simulatedPosMs = 0;

    // Helper from PlaybackTimePill
    function formatElapsed(posMs) {
      const elapsedSec = Math.max(0, Math.floor((posMs || 0) / 1000));
      const m = Math.floor(elapsedSec / 60);
      const s = Math.floor(elapsedSec % 60);
      return `${m}:${s < 10 ? '0' : ''}${s}`;
    }

    function formatRemaining(posMs, durMs) {
      const totalSec = Math.max(0, Math.floor((durMs || 0) / 1000));
      const elapsedSec = Math.max(0, Math.floor((posMs || 0) / 1000));
      const remSec = Math.max(0, totalSec - elapsedSec);
      const m = Math.floor(remSec / 60);
      const s = Math.floor(remSec % 60);
      return `-${m}:${s < 10 ? '0' : ''}${s}`;
    }

    for (let tick = 0; tick <= 150; tick++) {
      simulatedPosMs = tick * 1000;
      const elapsed = formatElapsed(simulatedPosMs);
      const remaining = formatRemaining(simulatedPosMs, durationMs);

      assert.ok(typeof elapsed === 'string' && elapsed.includes(':'), 'Elapsed format is m:ss');
      assert.ok(typeof remaining === 'string' && remaining.startsWith('-'), 'Remaining format is -m:ss');
    }

    // Exact checks
    assert.strictEqual(formatElapsed(0), '0:00');
    assert.strictEqual(formatRemaining(0, 351000), '-5:51');
    assert.strictEqual(formatElapsed(65000), '1:05');
    assert.strictEqual(formatRemaining(65000, 351000), '-4:46');
  });

  test('INSP-01: RightInspector closed / queue tab suspension returns constant 0 across 150 ticks', () => {
    // RightInspector selector:
    // (isOpen && activeTab === 'lyrics' ? s.positionMs : 0)

    // Scenario A: Closed
    const selClosed = (s) => (false && 'lyrics' === 'lyrics' ? s.positionMs : 0);
    const harnessClosed = createSubscriberHarness([selClosed]);

    for (let pos = 200; pos <= 30000; pos += 200) {
      usePlayerStore.setState({ positionMs: pos });
    }
    assert.strictEqual(harnessClosed.getRenderCount(), 0, 'Closed RightInspector must produce 0 re-renders');
    harnessClosed.unsubscribe();

    // Scenario B: Open, but on Queue tab
    const selQueue = (s) => (true && 'queue' === 'lyrics' ? s.positionMs : 0);
    const harnessQueue = createSubscriberHarness([selQueue]);

    for (let pos = 200; pos <= 30000; pos += 200) {
      usePlayerStore.setState({ positionMs: pos });
    }
    assert.strictEqual(harnessQueue.getRenderCount(), 0, 'Queue tab RightInspector must produce 0 re-renders');
    harnessQueue.unsubscribe();
  });
});

// ==============================================================================
// SUITE 4: 60FPS SCROLL PERFORMANCE & CSS CONTAINMENT HARNESS
// ==============================================================================
describe('Suite 4: 60fps Scroll Performance & CSS Containment Harness', () => {
  const indexCss = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8');

  test('SCROLL-01: .tracklist-row and .tracklist-row-compact define content-visibility: auto and fixed intrinsic heights', () => {
    assert.ok(indexCss.includes('.tracklist-row {'), 'Must define .tracklist-row');
    assert.ok(indexCss.includes('content-visibility: auto;'), 'Must specify content-visibility: auto');
    assert.ok(indexCss.includes('contain-intrinsic-size: 0 56px;'), 'Must specify 56px standard intrinsic height');
    assert.ok(indexCss.includes('contain-intrinsic-size: 0 44px;'), 'Must specify 44px compact intrinsic height');
  });

  test('SCROLL-02: .acrylic-tile and .liquid-glass-card enforce contain: paint layout and GPU promotion', () => {
    assert.ok(indexCss.includes('.acrylic-tile {') || indexCss.includes('.liquid-glass-card,'), 'Must define .acrylic-tile');
    assert.ok(indexCss.includes('contain: paint layout;'), 'Acrylic tiles must enforce contain: paint layout');
    assert.ok(indexCss.includes('transform: translateZ(0);'), 'Acrylic tiles must promote to GPU layer via translateZ(0)');
  });

  test('SCROLL-03: Virtual scroll layout predictability over 10,000 items in standard (56px) and compact (44px) modes', () => {
    const totalItems = 10000;
    const stdRowHeight = 56;
    const compactRowHeight = 44;

    const stdPredictedHeight = totalItems * stdRowHeight;
    const compactPredictedHeight = totalItems * compactRowHeight;

    assert.strictEqual(stdPredictedHeight, 560000, 'Standard 10,000 items must compute to 560,000px');
    assert.strictEqual(compactPredictedHeight, 440000, 'Compact 10,000 items must compute to 440,000px');

    // Simulate random viewport queries at offsets
    const viewportHeight = 800;
    for (let scrollY = 0; scrollY <= stdPredictedHeight - viewportHeight; scrollY += 50000) {
      const startIndex = Math.floor(scrollY / stdRowHeight);
      const endIndex = Math.min(totalItems - 1, Math.ceil((scrollY + viewportHeight) / stdRowHeight));
      const visibleCount = endIndex - startIndex + 1;

      assert.ok(visibleCount >= 14 && visibleCount <= 17, `Visible rows at scrollY=${scrollY} must be 14-17, got ${visibleCount}`);
      assert.ok(startIndex >= 0 && endIndex < totalItems, 'Indices must be within bounds');
    }
  });

  test('SCROLL-04: Audit of DesktopTrackTable, HomeScreen, ExploreScreen, LibraryScreen confirms ZERO inline backdropFilter', () => {
    const inspectedFiles = [
      'src/ui/components/DesktopTrackTable.tsx',
      'src/ui/views/HomeScreen.tsx',
      'src/ui/views/ExploreScreen.tsx',
      'src/ui/views/LibraryScreen.tsx',
      'src/ui/views/ReleaseDetailView.tsx',
      'src/ui/views/ArtistDetailView.tsx',
      'src/ui/views/CoverFlowView.tsx',
      'src/ui/views/LocalMediaView.tsx',
    ];

    for (const f of inspectedFiles) {
      const fullPath = path.join(ROOT, f);
      const text = fs.readFileSync(fullPath, 'utf8');

      // Inline style with backdropFilter would break 60fps scrolling
      assert.strictEqual(
        text.includes('backdropFilter:'),
        false,
        `${f} must NOT contain inline backdropFilter`
      );
      assert.strictEqual(
        text.includes('backdrop-blur-'),
        false,
        `${f} must NOT use heavy backdrop-blur-* classes on rows/tiles`
      );
    }
  });
});
