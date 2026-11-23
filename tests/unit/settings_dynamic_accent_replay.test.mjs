// tests/unit/settings_dynamic_accent_replay.test.mjs
// Behavioral tests for Dynamic Album-Cover Accent Color, Settings application, and Replay Reset

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

// Register ESM resolution + TSX transpilation hook for .ts/.tsx imports
const resolverHook = `
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(${JSON.stringify(pathToFileURL(path.join(rootDir, 'package.json')).href)});
const ts = require('typescript');

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && !specifier.endsWith('.ts') && !specifier.endsWith('.tsx') && !specifier.endsWith('.js') && !specifier.endsWith('.mjs')) {
      for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
        try {
          return await nextResolve(specifier + suffix, context);
        } catch {}
      }
    }
    throw err;
  }
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.tsx')) {
    const source = fs.readFileSync(fileURLToPath(url), 'utf8');
    const transpiled = ts.transpileModule(source, {
      fileName: fileURLToPath(url),
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    });
    return { format: 'module', shortCircuit: true, source: transpiled.outputText };
  }
  return nextLoad(url, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(resolverHook)}`, import.meta.url);

function createMockDom({ prefersLight = false } = {}) {
  const classes = new Set(['dark']);
  const styleMap = new Map();
  const listeners = new Set();

  const documentElement = {
    classList: {
      add: (...cls) => cls.forEach((c) => classes.add(c)),
      remove: (...cls) => cls.forEach((c) => classes.delete(c)),
      contains: (c) => classes.has(c),
    },
    style: {
      setProperty: (k, v) => styleMap.set(k, String(v)),
      getPropertyValue: (k) => styleMap.get(k) || '',
    },
  };

  let lightMode = prefersLight;
  const mockWindow = {
    matchMedia: () => ({
      get matches() {
        return lightMode;
      },
      addEventListener: (_ev, fn) => listeners.add(fn),
      removeEventListener: (_ev, fn) => listeners.delete(fn),
    }),
  };

  globalThis.document = { documentElement };
  globalThis.window = mockWindow;

  return {
    classes,
    styleMap,
    triggerSystemThemeChange: (nextLight) => {
      lightMode = nextLight;
      listeners.forEach((fn) => fn({ matches: nextLight }));
    },
  };
}

const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');
const { defaultAppSettings } = await import('../../src/models/Settings.ts');
const { useThemeStore, ensureReadableAccent } = await import('../../src/ui/theme/Theme.ts');
const { useSettingsStore } = await import('../../src/state/settingsStore.ts');
const {
  StorageService,
  formatLocalYearMonth,
  computeYearlyReplayStats,
} = await import('../../src/services/StorageService.ts');
const { useLibraryStore } = await import('../../src/state/libraryStore.ts');
const { AutoEqLoader } = await import('../../src/audio/AutoEqLoader.ts');
const { ReplayStoriesModal } = await import('../../src/ui/player/ReplayStoriesModal.tsx');
const { ErrorBoundary } = await import('../../src/ui/common/ErrorBoundary.tsx');
const { InteractiveEqGraph } = await import('../../src/ui/components/InteractiveEqGraph.tsx');
const { EqualizerView } = await import('../../src/ui/views/EqualizerView.tsx');
const { EqualizerModal } = await import('../../src/ui/player/EqualizerModal.tsx');

describe('Dynamic Album-Cover Accent Color & Functional Settings', () => {
  let dom;

  beforeEach(() => {
    dom = createMockDom();
  });

  afterEach(() => {
    delete globalThis.document;
    delete globalThis.window;
  });

  test('defaultAppSettings includes appearance.accentColorMode defaulting to custom', () => {
    assert.equal(defaultAppSettings['appearance.accentColorMode'], 'custom');
    assert.equal(defaultAppSettings['appearance.accentColor'], '#FA2D48');
  });

  test('Dynamic accent mode applies artworkPalette.vibrantAccent to CSS tokens and restores custom hex', async () => {
    await useSettingsStore.getState().resetToDefaults();
    await useSettingsStore.getState().updateSettings({
      'appearance.accentColorMode': 'dynamic',
    });

    useThemeStore.getState().setArtworkPalette({
      dominantHue: 210,
      vibrantAccent: 'hsl(210, 82%, 60%)',
      edgeWash: 'hsla(210, 45%, 18%, 0.55)',
      ambientBackground: 'hsl(210, 35%, 8%)',
      playerTint: 'hsla(210, 42%, 24%, 0.65)',
      topBandLuminance: 0.25,
    });

    assert.equal(dom.styleMap.get('--color-accent'), 'hsl(210, 82%, 60%)');
    assert.equal(dom.styleMap.get('--am-brand-pink'), 'hsl(210, 82%, 60%)');
    assert.ok(dom.styleMap.get('--color-accent-hover'));
    assert.ok(dom.styleMap.get('--color-accent-subtle'));
    assert.ok(dom.styleMap.get('--glass-pill-active'));

    // Switching back to custom restores the chosen hex color
    await useSettingsStore.getState().updateSettings({
      'appearance.accentColorMode': 'custom',
      'appearance.accentColor': '#3B82F6',
    });

    assert.equal(dom.styleMap.get('--color-accent'), '#3B82F6');
    assert.equal(dom.styleMap.get('--am-brand-pink'), '#3B82F6');
  });

  test('Luminance guard boosts overly dark accent colors in dark mode', () => {
    const guarded = ensureReadableAccent('hsl(240, 70%, 15%)', false);
    assert.notEqual(guarded.accent, 'hsl(240, 70%, 15%)');
    assert.ok(guarded.accent.includes('58%'));
  });

  test('Appearance toggles apply root CSS classes and system theme reacts to prefers-color-scheme', async () => {
    await useSettingsStore.getState().updateSettings({
      'appearance.themeMode': 'system',
      'appearance.acrylicBlurEnabled': false,
      'appearance.liquidGlassControls': false,
      'appearance.dynamicArtworkColor': false,
      'appearance.ambientBackdropGlow': false,
    });

    assert.equal(dom.classes.has('dark'), true);
    assert.equal(dom.classes.has('no-acrylic-blur'), true);
    assert.equal(dom.classes.has('no-liquid-glass'), true);
    assert.equal(dom.classes.has('no-dynamic-artwork'), true);
    assert.equal(dom.classes.has('no-ambient-glow'), true);

    dom.triggerSystemThemeChange(true);
    assert.equal(dom.classes.has('light'), true);
    assert.equal(dom.classes.has('dark'), false);
  });
});

describe('Reset Replay & Listening Data', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'waveform-replay-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('Fresh storage starts with 0 listening history and resetListeningData wipes persisted stats', async () => {
    const storage = new StorageService(tempDir);
    await useLibraryStore.getState().initLibrary(storage);

    const yearMonth = formatLocalYearMonth();
    const initialStats = await storage.getMonthlyListeningHistory(yearMonth);
    assert.equal(initialStats.totalPlaysCount, 0);
    assert.equal(initialStats.totalListeningTimeSec, 0);
    assert.equal(initialStats.topTracks.length, 0);

    // Record a play
    await useLibraryStore.getState().recordListeningHistory(
      {
        videoId: 'vid_test_1',
        title: 'Test Track',
        artist: 'Test Artist',
        durationSec: 180,
      },
      180
    );
    await useLibraryStore.getState().refreshMonthlyStats(yearMonth);

    assert.equal(useLibraryStore.getState().listeningHistory.length, 1);
    assert.equal(useLibraryStore.getState().monthlyStats.totalPlaysCount, 1);
    assert.equal(useLibraryStore.getState().yearlyReplayStats.totalPlaysCount, 1);

    const monthFile = path.join(tempDir, 'listening', `${yearMonth}.json`);
    const historyFile = path.join(tempDir, 'listening', 'history.json');
    assert.equal(existsSync(monthFile), true);
    assert.equal(existsSync(historyFile), true);

    // Verify listeningHistory & yearlyReplayStats survive StorageService restart
    const restartedStorage = new StorageService(tempDir);
    const persistedHistory = await restartedStorage.getListeningHistory();
    assert.equal(persistedHistory.length, 1);
    assert.equal(persistedHistory[0].videoId, 'vid_test_1');

    // Reset listening data
    await useLibraryStore.getState().resetListeningData();

    assert.equal(useLibraryStore.getState().listeningHistory.length, 0);
    assert.equal(useLibraryStore.getState().monthlyStats, null);
    assert.equal(useLibraryStore.getState().yearlyReplayStats, null);
    assert.equal(existsSync(monthFile), false);
    assert.equal(existsSync(historyFile), false);

    const afterReset = await storage.getMonthlyListeningHistory(yearMonth);
    assert.equal(afterReset.totalPlaysCount, 0);
  });

  test('StorageService.getYearlyReplayStats(2026) aggregates tracks, top 5 artists, top 4 albums, quality breakdown, peak hour, and streaks', async () => {
    const storage = new StorageService(tempDir);
    await useLibraryStore.getState().initLibrary(storage);

    const samples = [
      {
        song: {
          videoId: 'trk_1',
          title: 'Starlight',
          artist: 'Muse',
          albumName: 'Black Holes',
          artworkUrl: 'https://example.com/muse.jpg',
          sourceQuality: '24-bit / 96kHz FLAC',
          durationSec: 240,
        },
        dur: 240,
      },
      {
        song: {
          videoId: 'trk_1',
          title: 'Starlight',
          artist: 'Muse',
          albumName: 'Black Holes',
          artworkUrl: 'https://example.com/muse.jpg',
          sourceQuality: '24-bit / 96kHz FLAC',
          durationSec: 240,
        },
        dur: 240,
      },
      {
        song: {
          videoId: 'trk_2',
          title: 'Instant Crush',
          artist: 'Daft Punk',
          albumName: 'Random Access Memories',
          artworkUrl: 'https://example.com/ram.jpg',
          sourceQuality: '160kbps Opus',
          durationSec: 337,
        },
        dur: 300,
      },
      {
        song: {
          videoId: 'trk_3',
          title: 'Ode to the Mets',
          artist: 'The Strokes',
          albumName: 'The New Abnormal',
          sourceQuality: '256kbps AAC',
          durationSec: 351,
        },
        dur: 200,
      },
      {
        song: {
          videoId: 'trk_4',
          title: 'Track 4',
          artist: 'Artist 4',
          albumName: 'Album 4',
          sourceQuality: '16-bit / 44.1kHz ALAC',
          durationSec: 120,
        },
        dur: 120,
      },
      {
        song: {
          videoId: 'trk_5',
          title: 'Track 5',
          artist: 'Artist 5',
          albumName: 'Album 5',
          durationSec: 100,
        },
        dur: 100,
      },
      {
        song: {
          videoId: 'trk_6',
          title: 'Track 6',
          artist: 'Artist 6',
          durationSec: 90,
        },
        dur: 90,
      },
    ];

    for (const s of samples) {
      await useLibraryStore.getState().recordListeningHistory(s.song, s.dur);
    }

    const currentYear = new Date().getFullYear();
    const restarted = new StorageService(tempDir);
    const yearly = await restarted.getYearlyReplayStats(currentYear);

    assert.equal(yearly.totalPlaysCount, 7);
    assert.equal(yearly.totalListeningTimeSec, 1290);
    assert.equal(yearly.uniqueTracksCount, 6);
    assert.equal(yearly.uniqueArtistsCount, 6);
    assert.equal(yearly.longestStreakDays >= 1, true);
    assert.equal(typeof yearly.peakHour, 'number');
    assert.equal(yearly.topTracks[0].videoId, 'trk_1');
    assert.equal(yearly.topTracks[0].playCount, 2);
    assert.equal(yearly.topTracks[0].totalSec, 480);
    assert.equal(yearly.topTracks[0].albumName, 'Black Holes');
    assert.equal(yearly.topTracks[0].artworkUrl, 'https://example.com/muse.jpg');
    assert.equal(yearly.topArtists.length, 5);
    assert.equal(yearly.topArtists[0].artistName, 'Muse');
    assert.equal(yearly.topArtists[0].playCount, 2);
    assert.equal(yearly.topArtists[0].percentage, Math.round((2 / 7) * 100));
    assert.equal(yearly.topAlbums.length, 4);
    assert.deepEqual(yearly.qualityBreakdown, { lossless: 3, opus: 1, other: 3 });

    // Direct 2026 multi-day streak and peak hour aggregation check
    const ts = (y, m, d, h) => new Date(y, m - 1, d, h, 15, 0).getTime();
    const synthetic2026 = computeYearlyReplayStats(
      [
        { videoId: 'a', title: 'A', artist: 'Art A', timestamp: ts(2026, 3, 1, 21), durationSec: 180 },
        { videoId: 'b', title: 'B', artist: 'Art B', timestamp: ts(2026, 3, 2, 21), durationSec: 120 },
        { videoId: 'c', title: 'C', artist: 'Art A', timestamp: ts(2026, 3, 3, 14), durationSec: 200 },
        { videoId: 'd', title: 'D', artist: 'Art C', timestamp: ts(2026, 3, 10, 21), durationSec: 90 },
      ],
      2026
    );
    assert.equal(synthetic2026.year, 2026);
    assert.equal(synthetic2026.longestStreakDays, 3);
    assert.equal(synthetic2026.peakHour, 21);
  });

  test('ReplayStoriesModal renders safely across isOpen=false -> isOpen=true for empty and populated stats without hook errors', () => {
    // Structural check: no hook calls appear after `if (!isOpen) return null;`
    const replaySrc = readFileSync(path.join(rootDir, 'src/ui/player/ReplayStoriesModal.tsx'), 'utf8');
    const guardIdx = replaySrc.indexOf('if (!isOpen) return null;');
    assert.ok(guardIdx > 0, 'ReplayStoriesModal must contain isOpen early return');
    const afterGuard = replaySrc.slice(guardIdx);
    assert.equal(/\buse(State|Effect|Ref|Memo|Callback|LibraryStore)\s*\(/.test(afterGuard), false);

    // SSR render safety: closed -> empty string
    const closedHtml = renderToStaticMarkup(
      React.createElement(ReplayStoriesModal, { isOpen: false, onClose: () => {} })
    );
    assert.equal(closedHtml, '');

    // SSR render safety: open with empty stats -> graceful starter recap
    const emptyStats = computeYearlyReplayStats([], 2026);
    const openEmptyHtml = renderToStaticMarkup(
      React.createElement(ReplayStoriesModal, {
        isOpen: true,
        onClose: () => {},
        yearlyStats: emptyStats,
      })
    );
    assert.ok(openEmptyHtml.includes('Your 2026 Replay is Warming Up'));
    assert.equal(openEmptyHtml.includes('Midnight City'), false);
    assert.equal(openEmptyHtml.includes('48200'), false);

    // SSR render safety: open with populated stats -> zero TypeErrors
    const populatedStats = {
      year: 2026,
      totalListeningTimeSec: 3600,
      totalPlaysCount: 12,
      uniqueTracksCount: 5,
      uniqueArtistsCount: 3,
      peakHour: 22,
      longestStreakDays: 4,
      topTracks: [
        {
          videoId: 'trk_1',
          title: 'Overdrive',
          artist: 'Lazerhawk',
          albumName: 'Redline',
          playCount: 6,
          totalSec: 1800,
        },
      ],
      topArtists: [
        { artistName: 'Lazerhawk', playCount: 8, totalSec: 2400, percentage: 67 },
      ],
      topAlbums: [
        { albumName: 'Redline', artist: 'Lazerhawk', playCount: 8, totalSec: 2400 },
      ],
      qualityBreakdown: { lossless: 8, opus: 4, other: 0 },
    };
    const openPopulatedHtml = renderToStaticMarkup(
      React.createElement(ReplayStoriesModal, {
        isOpen: true,
        onClose: () => {},
        yearlyStats: populatedStats,
      })
    );
    assert.ok(openPopulatedHtml.includes('Minutes Listened'));
    assert.ok(openPopulatedHtml.includes('60'));
    assert.ok(openPopulatedHtml.includes('10 PM'));
  });

  test('ErrorBoundary, InteractiveEqGraph, EqualizerView, and EqualizerModal render safely and wire AutoEQ', async () => {
    const okBoundary = renderToStaticMarkup(
      React.createElement(
        ErrorBoundary,
        { onClose: () => {}, onReset: () => {} },
        React.createElement('div', null, 'Healthy Child')
      )
    );
    assert.ok(okBoundary.includes('Healthy Child'));

    const errInstance = new ErrorBoundary({
      title: '2026 Replay error',
      onClose: () => {},
      onReset: () => {},
      children: null,
    });
    errInstance.state = ErrorBoundary.getDerivedStateFromError(new Error('Hook count mismatch'));
    const fallbackHtml = renderToStaticMarkup(errInstance.render());
    assert.ok(fallbackHtml.includes('Hook count mismatch'));
    assert.ok(fallbackHtml.includes('Reset'));
    assert.ok(fallbackHtml.includes('Close'));

    const appSrc = readFileSync(path.join(rootDir, 'src/App.tsx'), 'utf8');
    assert.ok(appSrc.includes('<ErrorBoundary'));
    assert.ok(appSrc.includes('<AmbientViewportApp inAppPortal'));

    const sidebarSrc = readFileSync(path.join(rootDir, 'src/ui/layout/LeftSidebar.tsx'), 'utf8');
    const replayBtnCount = (sidebarSrc.match(/setReplayOpen\(true\)/g) || []).length;
    assert.equal(replayBtnCount, 2, 'LeftSidebar must render 2026 Replay button in both expanded and collapsed views');

    const homeSrc = readFileSync(path.join(rootDir, 'src/ui/views/HomeScreen.tsx'), 'utf8');
    assert.equal(homeSrc.includes('new StorageService()'), false, 'HomeScreen must read history from useLibraryStore');
    assert.ok(homeSrc.includes('setReplayOpen(true)'));

    const profile = await AutoEqLoader.findProfile('Sony WH-CH720N');
    assert.ok(profile && profile.filters.length > 0, 'Sony WH-CH720N must resolve from auto_eq.db');

    const dt770 = await AutoEqLoader.findProfile('Beyerdynamic DT 770 Pro (80 Ohm)');
    assert.ok(dt770 && dt770.filters.length > 0, 'Beyerdynamic DT 770 Pro (80 Ohm) must resolve');

    const eqSvgHtml = renderToStaticMarkup(
      React.createElement(InteractiveEqGraph, {
        bands: [3.5, 3, 2, 1, 1.5, 2, 3, 3.5, 3, 2.5],
        onChangeBand: () => {},
        activeAutoEqProfile: profile,
      })
    );
    assert.ok(eqSvgHtml.includes('<svg'));
    assert.ok(eqSvgHtml.includes('Preamp:'));
    assert.ok(eqSvgHtml.includes('Rtings'));

    const eqViewHtml = renderToStaticMarkup(React.createElement(EqualizerView));
    assert.ok(eqViewHtml.includes('Sony WH-CH720N'));
    assert.ok(eqViewHtml.includes('Beyerdynamic DT 770 Pro (80 Ohm)'));
    assert.ok(eqViewHtml.includes('spellCheck') || eqViewHtml.includes('spellcheck="false"'));

    const eqModalClosedHtml = renderToStaticMarkup(
      React.createElement(EqualizerModal, { isOpen: false, onClose: () => {} })
    );
    assert.equal(eqModalClosedHtml, '');

    const eqModalOpenHtml = renderToStaticMarkup(
      React.createElement(EqualizerModal, { isOpen: true, onClose: () => {} })
    );
    assert.ok(eqModalOpenHtml.includes('Equalizer &amp; Audio DSP'));
    assert.ok(eqModalOpenHtml.includes('Sony WH-CH720N'));

    AutoEqLoader.closeDatabase();
  });

  test('ReplayStoriesModal has no fake M83 fallback and SettingsModal wires search, browse, accounts, and reset', () => {
    const replaySrc = readFileSync(path.join(rootDir, 'src/ui/player/ReplayStoriesModal.tsx'), 'utf8');
    assert.equal(replaySrc.includes('Midnight City'), false);
    assert.equal(replaySrc.includes('48200'), false);
    assert.equal(replaySrc.includes('resetListeningData'), true);

    const settingsSrc = readFileSync(path.join(rootDir, 'src/ui/common/SettingsModal.tsx'), 'utf8');
    assert.equal(settingsSrc.includes('Dynamic (Album Cover)'), true);
    assert.equal(settingsSrc.includes('selectLocalFolder'), true);
    assert.equal(settingsSrc.includes('AccountAuthService'), true);
    assert.equal(settingsSrc.includes('Reset Replay & Listening Data'), true);
    assert.equal(settingsSrc.includes('Search Results'), true);
  });
});
