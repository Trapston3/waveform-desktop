// tests/unit/lyric_visualizer_platform.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { register } from 'node:module';

// Register Electron mock loader hook so importing electron resolves cleanly
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return {
      url: 'data:text/javascript,' + encodeURIComponent(\`
        export const app = {
          commandLine: { appendSwitch() {} },
          requestSingleInstanceLock() { return false; },
          quit() {},
          on() {},
          whenReady() { return new Promise(() => {}); },
          getPath() { return process.cwd(); }
        };
        export const BrowserWindow = class { static getAllWindows() { return []; } };
        export const ipcMain = { handle() {}, on() {} };
        export const Menu = { buildFromTemplate() { return {}; }, setApplicationMenu() {} };
        export const Tray = class { setToolTip() {} setContextMenu() {} };
        export const nativeImage = { createEmpty() { return {}; } };
        export const session = {
          defaultSession: {
            webRequest: { onBeforeSendHeaders() {}, onHeadersReceived() {} }
          }
        };
        export const screen = {
          getPrimaryDisplay() { return null; },
          getAllDisplays() { return []; },
          on() {},
          removeListener() {}
        };
        export const powerMonitor = {
          getSystemIdleTime() { return 0; },
          on() {},
          removeListener() {}
        };
        export const powerSaveBlocker = {
          start() { return 1; },
          stop() {},
          isStarted() { return false; }
        };
      \`),
      format: 'module',
      shortCircuit: true
    };
  }
  return nextResolve(specifier, context);
}
`;
register('data:text/javascript,' + encodeURIComponent(hook), import.meta.url);

import esbuild from 'esbuild';

const tsPath = path.resolve('electron/lyricVisualizerPlatform.ts');
const tsCode = fs.readFileSync(tsPath, 'utf8');
const transpiled = esbuild.transformSync(tsCode, {
  loader: 'ts',
  format: 'esm',
  target: 'es2022',
});

// Write temporary transpiled file in tmp directory to import cleanly
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-transpile-'));
const tempJsFile = path.join(tmpDir, 'lyricVisualizerPlatform.mjs');
fs.writeFileSync(tempJsFile, transpiled.code, 'utf8');

const {
  isBlockingNotificationState,
  clampSongOffset,
  LyricsCacheAndOffsetStore,
  KeepAwakeService,
  createLyricVisualizerPlatformController,
  POSITIVE_LYRICS_TTL_MS,
  NEGATIVE_LYRICS_TTL_MS,
  MIN_OFFSET_MS,
  MAX_OFFSET_MS,
} = await import(`file://${tempJsFile.replace(/\\/g, '/')}`);

// -----------------------------------------------------------------------------
// Test 1: Helper Functions & Notification States
// -----------------------------------------------------------------------------
test('isBlockingNotificationState correctly identifies game/fullscreen/presentation states', () => {
  // QUNS_NOT_PRESENT = 1 -> false
  assert.equal(isBlockingNotificationState(1), false);
  // QUNS_BUSY = 2 -> true
  assert.equal(isBlockingNotificationState(2), true);
  // QUNS_RUNNING_D3D_FULL_SCREEN = 3 -> true
  assert.equal(isBlockingNotificationState(3), true);
  // QUNS_PRESENTATION_MODE = 4 -> true
  assert.equal(isBlockingNotificationState(4), true);
  // QUNS_ACCEPTS_NOTIFICATIONS = 5 -> false
  assert.equal(isBlockingNotificationState(5), false);
  // QUNS_QUIET_TIME = 6 -> false
  assert.equal(isBlockingNotificationState(6), false);
  // QUNS_APP = 7 -> true
  assert.equal(isBlockingNotificationState(7), true);
  // Unknown
  assert.equal(isBlockingNotificationState(0), false);
  assert.equal(isBlockingNotificationState(99), false);
});

test('clampSongOffset clamps values to [-2000, 2000] and handles bad inputs', () => {
  assert.equal(clampSongOffset(0), 0);
  assert.equal(clampSongOffset(500), 500);
  assert.equal(clampSongOffset(-500), -500);
  assert.equal(clampSongOffset(2000), 2000);
  assert.equal(clampSongOffset(-2000), -2000);
  assert.equal(clampSongOffset(5000), 2000);
  assert.equal(clampSongOffset(-9999), -2000);
  assert.equal(clampSongOffset(NaN), 0);
  assert.equal(clampSongOffset(null), 0);
  assert.equal(clampSongOffset('abc'), 0);
});

// -----------------------------------------------------------------------------
// Test 2: Persistent LyricsCacheAndOffsetStore (TTLs, Clamping, Atomic I/O)
// -----------------------------------------------------------------------------
test('LyricsCacheAndOffsetStore: positive TTL (30 days) and negative miss TTL (24 hours)', () => {
  const storeTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-cache-test-'));
  const cacheFile = path.join(storeTmpDir, 'cache.json');

  let simulatedTime = 1_000_000;
  const nowFn = () => simulatedTime;

  const store = new LyricsCacheAndOffsetStore(cacheFile, nowFn);

  // Set positive entry
  const posKey = 'artist-track-positive';
  const posData = { type: 'synced', lines: [{ time: 10, text: 'Hello' }] };
  store.setLyrics(posKey, posData);

  // Set negative entry
  const negKey = 'artist-track-negative';
  store.setLyrics(negKey, null);

  // Immediately retrieve
  assert.deepEqual(store.getLyrics(posKey), posData);
  assert.equal(store.getLyrics(negKey), null);

  // Advance time by 25 hours (past 24h negative TTL, within 30d positive TTL)
  simulatedTime += 25 * 3600 * 1000;
  assert.deepEqual(store.getLyrics(posKey), posData, 'Positive lyrics should still be valid after 25 hours');
  assert.equal(store.getLyrics(negKey), undefined, 'Negative miss should have expired after 25 hours');

  // Advance time past 30 days total (e.g., 31 days)
  simulatedTime += 30 * 86400 * 1000;
  assert.equal(store.getLyrics(posKey), undefined, 'Positive lyrics should expire after 30 days');

  // Cleanup
  fs.rmSync(storeTmpDir, { recursive: true, force: true });
});

test('LyricsCacheAndOffsetStore: atomic persistence across store reload', () => {
  const storeTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-cache-reload-'));
  const cacheFile = path.join(storeTmpDir, 'cache.json');

  let simulatedTime = 5_000_000;
  const nowFn = () => simulatedTime;

  const store1 = new LyricsCacheAndOffsetStore(cacheFile, nowFn);
  store1.setLyrics('song-1', { text: 'La la la' });
  store1.setOffset('song-1', 450);
  store1.setOffset('song-2', -3000); // Should be clamped to -2000

  // Verify file was written and is valid JSON
  assert.ok(fs.existsSync(cacheFile));
  const raw = fs.readFileSync(cacheFile, 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.offsets['song-1'], 450);
  assert.equal(parsed.offsets['song-2'], -2000);

  // Instantiate new store pointing to same file
  const store2 = new LyricsCacheAndOffsetStore(cacheFile, nowFn);
  assert.deepEqual(store2.getLyrics('song-1'), { text: 'La la la' });
  assert.equal(store2.getOffset('song-1'), 450);
  assert.equal(store2.getOffset('song-2'), -2000);

  fs.rmSync(storeTmpDir, { recursive: true, force: true });
});

// -----------------------------------------------------------------------------
// Test 3: KeepAwakeService Lifecycle
// -----------------------------------------------------------------------------
test('KeepAwakeService starts and stops powerSaveBlocker cleanly', () => {
  let activeBlockerId = null;
  const mockPowerSaveBlocker = {
    start(reason) {
      activeBlockerId = 42;
      return 42;
    },
    stop(id) {
      if (activeBlockerId === id) {
        activeBlockerId = null;
      }
    },
    isStarted(id) {
      return activeBlockerId === id;
    },
  };

  const service = new KeepAwakeService(mockPowerSaveBlocker);
  assert.equal(service.isActive(), false);

  assert.equal(service.start('prevent-display-sleep'), true);
  assert.equal(service.isActive(), true);
  assert.equal(activeBlockerId, 42);

  // Second start is a no-op idempotent
  assert.equal(service.start(), true);
  assert.equal(activeBlockerId, 42);

  service.stop();
  assert.equal(service.isActive(), false);
  assert.equal(activeBlockerId, null);
});

// -----------------------------------------------------------------------------
// Test 4: Multi-Monitor Overlay Spawn, Mouse Events & Lock/Unlock Sync
// -----------------------------------------------------------------------------
test('LyricVisualizerPlatformController: multi-monitor discovery & overlay management', async () => {
  try {
  const ctrlTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-ctrl-test-'));

  // Mock displays
  const displays = [
    {
      id: 101,
      label: 'Main LG Display',
      bounds: { x: 0, y: 0, width: 2560, height: 1440 },
      workArea: { x: 0, y: 0, width: 2560, height: 1400 },
      scaleFactor: 1.25,
    },
    {
      id: 102,
      label: 'Secondary Dell Display',
      bounds: { x: 2560, y: 0, width: 1920, height: 1080 },
      workArea: { x: 2560, y: 0, width: 1920, height: 1040 },
      scaleFactor: 1.0,
    },
  ];

  class MockScreen extends EventEmitter {
    getPrimaryDisplay() {
      return displays[0];
    }
    getAllDisplays() {
      return displays;
    }
  }
  const screenMock = new MockScreen();

  // Mock BrowserWindow
  const createdWindows = [];
  class MockBrowserWindow extends EventEmitter {
    constructor(opts) {
      super();
      this.opts = opts;
      this.bounds = { x: opts.x, y: opts.y, width: opts.width, height: opts.height };
      this.opacity = 1;
      this.ignoreMouseEvents = null;
      this.alwaysOnTop = null;
      this.isVisible = false;
      this.isClosed = false;
      this.loadedUrl = null;
      const wcEmitter = new EventEmitter();
      this.webContents = {
        send: (channel, ...args) => {
          this.emit('ipc-send', { channel, args });
        },
        once: (eventName, listener) => {
          wcEmitter.once(eventName, listener);
        },
        emit: (eventName, ...args) => {
          wcEmitter.emit(eventName, ...args);
        },
      };
      createdWindows.push(this);
    }
    static getAllWindows() {
      return createdWindows.filter((w) => !w.isClosed);
    }
    setOpacity(val) {
      this.opacity = val;
    }
    setIgnoreMouseEvents(ignore, forwardOpts) {
      this.ignoreMouseEvents = { ignore, forwardOpts };
    }
    setAlwaysOnTop(flag, level) {
      this.alwaysOnTop = { flag, level };
    }
    setBounds(b) {
      this.bounds = b;
    }
    showInactive() {
      this.isVisible = true;
    }
    show() {
      this.isVisible = true;
    }
    hide() {
      this.isVisible = false;
    }
    focus() {}
    close() {
      this.isClosed = true;
      this.emit('closed');
    }
    isDestroyed() {
      return this.isClosed;
    }
    loadURL(u) {
      this.loadedUrl = u;
      return Promise.resolve();
    }
    loadFile(f, opts) {
      this.loadedUrl = `${f}#${opts?.hash || ''}`;
      return Promise.resolve();
    }
  }

  // Mock power monitor
  class MockPowerMonitor extends EventEmitter {
    getSystemIdleTime() {
      return 120;
    }
  }
  const powerMonitorMock = new MockPowerMonitor();

  // Mock power save blocker
  let powerBlockerActive = false;
  const powerSaveBlockerMock = {
    start: () => {
      powerBlockerActive = true;
      return 1;
    },
    stop: () => {
      powerBlockerActive = false;
    },
    isStarted: () => powerBlockerActive,
  };

  // Mock IPC
  const ipcHandlers = new Map();
  const ipcListeners = new Map();
  const ipcMainMock = {
    handle: (channel, handler) => {
      ipcHandlers.set(channel, handler);
    },
    on: (channel, listener) => {
      ipcListeners.set(channel, listener);
    },
  };

  let gameState = 5; // Default QUNS_ACCEPTS_NOTIFICATIONS
  const gameGuardMock = {
    queryState: async () => gameState,
    dispose: () => {},
  };

  const loadedRoutes = [];
  const controller = createLyricVisualizerPlatformController({
    BrowserWindow: MockBrowserWindow,
    ipcMain: ipcMainMock,
    userDataDir: ctrlTmpDir,
    screenMock,
    powerMonitorMock,
    powerSaveBlockerMock,
    gameGuardMock,
    loadWindowRoute: (win, route) => {
      loadedRoutes.push({ win, route });
    },
  });

  controller.registerIpcHandlers();

  // 1. Verify monitors listing
  const monitors = controller.getAvailableMonitors();
  assert.equal(monitors.length, 2);
  assert.equal(monitors[0].id, '101');
  assert.equal(monitors[0].isPrimary, true);
  assert.equal(monitors[1].id, '102');
  assert.equal(monitors[1].isPrimary, false);

  // 2. Enable overlays on both monitors with click-through lock and opacity
  controller.setOverlayConfig({
    enabled: true,
    monitorIds: ['101', '102'],
    opacity: 0.85,
    locked: true,
  });

  const overlayWindows = controller._getOverlayWindows();
  assert.equal(overlayWindows.size, 2);

  const win101 = overlayWindows.get('101');
  const win102 = overlayWindows.get('102');
  assert.ok(win101);
  assert.ok(win102);

  // Verify transparency & window settings
  assert.equal(win101.opts.transparent, true);
  assert.equal(win101.opts.frame, false);
  assert.equal(win101.opts.skipTaskbar, true);
  assert.equal(win101.opacity, 0.85);
  assert.deepEqual(win101.ignoreMouseEvents, { ignore: true, forwardOpts: { forward: true } });
  assert.deepEqual(win101.alwaysOnTop, { flag: true, level: 'screen-saver' });

  // Verify route loading
  assert.ok(loadedRoutes.some((r) => r.route === '/overlay?monitorId=101'));
  assert.ok(loadedRoutes.some((r) => r.route === '/overlay?monitorId=102'));

  // 3. Deselect secondary monitor (102), verify it closes
  controller.setOverlayConfig({
    enabled: true,
    monitorIds: ['101'],
  });
  assert.equal(overlayWindows.size, 1);
  assert.equal(overlayWindows.has('101'), true);
  assert.equal(win102.isClosed, true);

  // 4. Test Ambient Mode window lifecycle and KeepAwake
  controller.openAmbientWindow(true);
  const ambientWin = controller._getAmbientWindow();
  assert.ok(ambientWin);
  assert.equal(ambientWin.opts.fullscreen, true);
  assert.equal(ambientWin.opts.frame, false);
  assert.equal(powerBlockerActive, true, 'Power blocker should be active during ambient with keepAwake');

  // 5. Test lock-screen handling (should pause keep-awake and hide overlays)
  controller._handleLock();
  assert.equal(controller._isSystemLocked(), true);
  assert.equal(powerBlockerActive, false, 'Power blocker must stop on lock');
  assert.equal(win101.isVisible, false, 'Overlay must hide on lock');

  // Unlock screen
  controller._handleUnlock();
  assert.equal(controller._isSystemLocked(), false);
  assert.equal(powerBlockerActive, true, 'Power blocker should resume after unlock if ambient active');
  assert.equal(win101.isVisible, true, 'Overlay should restore after unlock');

  // Close ambient
  controller.closeAmbientWindow();
  assert.equal(controller._getAmbientWindow(), null);
  assert.equal(powerBlockerActive, false);

  // 6. Test state broadcast relay via IPC
  const broadcastHandler = ipcListeners.get('lv-broadcast-state');
  assert.ok(broadcastHandler);

  let receivedBroadcast = null;
  win101.on('ipc-send', ({ channel, args }) => {
    if (channel === 'lv-state-broadcast') {
      receivedBroadcast = args[0];
    }
  });

  broadcastHandler(null, { revisionId: 5, trackId: 't-1', currentTrack: { title: 'Test Track' }, positionMs: 5000 });
  assert.deepEqual(receivedBroadcast, { revisionId: 5, trackId: 't-1', currentTrack: { title: 'Test Track' }, positionMs: 5000 });

  // Stale lower revisionId should not overwrite cached snapshot
  broadcastHandler(null, { revisionId: 2, trackId: 't-stale', currentTrack: { title: 'Stale' }, positionMs: 100 });
  const requestSnapshotHandler = ipcHandlers.get('lv-request-snapshot');
  assert.ok(requestSnapshotHandler, 'lv-request-snapshot IPC handler must be registered');
  const cachedSnap = await requestSnapshotHandler();
  assert.equal(cachedSnap.revisionId, 5);
  assert.equal(cachedSnap.trackId, 't-1');

  // Newly opened overlay window must immediately receive cached snapshot on did-finish-load
  controller.setOverlayConfig({
    enabled: true,
    monitorIds: ['101', '102'],
  });
  const win102Reopened = controller._getOverlayWindows().get('102');
  assert.ok(win102Reopened);
  let replayedPayload = null;
  win102Reopened.on('ipc-send', ({ channel, args }) => {
    if (channel === 'lv-state-broadcast') {
      replayedPayload = args[0];
    }
  });
  win102Reopened.webContents.emit('did-finish-load');
  assert.deepEqual(replayedPayload, cachedSnap);

  // Test lv-set-keep-awake IPC handler (used by in-app fullscreen ambient portal)
  const setKeepAwakeHandler = ipcHandlers.get('lv-set-keep-awake');
  assert.ok(setKeepAwakeHandler, 'lv-set-keep-awake IPC handler must be registered');
  await setKeepAwakeHandler(null, true);
  assert.equal(powerBlockerActive, true, 'lv-set-keep-awake(true) must activate power blocker');
  await setKeepAwakeHandler(null, false);
  assert.equal(powerBlockerActive, false, 'lv-set-keep-awake(false) must deactivate power blocker');

  // 7. Cleanup
  controller.dispose();
  assert.equal(overlayWindows.size, 0);
  assert.equal(win101.isClosed, true);

  fs.rmSync(ctrlTmpDir, { recursive: true, force: true });
  } catch (err) {
    console.error('INNER ERROR STACK:', err);
    throw err;
  }
});
