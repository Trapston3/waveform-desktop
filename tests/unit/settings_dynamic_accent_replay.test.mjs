// tests/unit/settings_dynamic_accent_replay.test.mjs
// Behavioral tests for Dynamic Album-Cover Accent Color, Settings application, and Replay Reset

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

const { defaultAppSettings } = await import('../../src/models/Settings.ts');
const { useThemeStore, ensureReadableAccent } = await import('../../src/ui/theme/Theme.ts');
const { useSettingsStore } = await import('../../src/state/settingsStore.ts');
const { StorageService } = await import('../../src/services/StorageService.ts');
const { useLibraryStore } = await import('../../src/state/libraryStore.ts');

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

    const yearMonth = new Date().toISOString().slice(0, 7);
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

    const monthFile = path.join(tempDir, 'listening', `${yearMonth}.json`);
    assert.equal(existsSync(monthFile), true);

    // Reset listening data
    await useLibraryStore.getState().resetListeningData();

    assert.equal(useLibraryStore.getState().listeningHistory.length, 0);
    assert.equal(useLibraryStore.getState().monthlyStats, null);
    assert.equal(existsSync(monthFile), false);

    const afterReset = await storage.getMonthlyListeningHistory(yearMonth);
    assert.equal(afterReset.totalPlaysCount, 0);
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
