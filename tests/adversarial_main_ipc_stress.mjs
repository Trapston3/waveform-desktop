// tests/adversarial_main_ipc_stress.mjs
// Adversarial edge-case and concurrent stress testing for Electron main process IPC

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

const preloadPath = path.join(rootDir, 'dist-electron', 'preload.cjs');
const indexPath = path.join(rootDir, 'dist', 'index.html');

let testsPassed = 0;
let testsTotal = 0;

function check(desc, condition) {
  testsTotal++;
  if (condition) {
    testsPassed++;
    console.log(`  [PASS] ${desc}`);
  } else {
    console.error(`  [FAIL] ${desc}`);
  }
}

async function run() {
  await app.whenReady();
  console.log('--- Adversarial Main Process IPC Edge Cases & Concurrent Stress ---');

  let windowInstance = null;
  let maximizeCount = 0;
  let minimizeCount = 0;
  let isMaximizedCount = 0;

  // Real handlers matching electron/main.ts logic exactly
  ipcMain.handle('window-minimize', () => {
    if (windowInstance && !windowInstance.isDestroyed()) {
      minimizeCount++;
      windowInstance.minimize();
    }
  });

  ipcMain.handle('window-maximize', () => {
    if (windowInstance && !windowInstance.isDestroyed()) {
      maximizeCount++;
      if (windowInstance.isMaximized()) {
        windowInstance.unmaximize();
      } else {
        windowInstance.maximize();
      }
    }
  });

  ipcMain.handle('window-close', () => {
    if (windowInstance && !windowInstance.isDestroyed()) {
      windowInstance.close();
    }
  });

  ipcMain.handle('window-is-maximized', () => {
    isMaximizedCount++;
    if (windowInstance && !windowInstance.isDestroyed()) {
      return windowInstance.isMaximized();
    }
    return false;
  });

  windowInstance = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await windowInstance.loadFile(indexPath);
  await new Promise((r) => setTimeout(r, 500));

  // Stress 1: 100 concurrent isMaximized invocations
  console.log('\n[TEST 1] 100 Concurrent isMaximized invocations...');
  const resConcurrent = await windowInstance.webContents.executeJavaScript(`
    (async () => {
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(window.electronAPI.isMaximized());
      }
      const results = await Promise.all(promises);
      return {
        allBooleans: results.every(r => typeof r === 'boolean'),
        count: results.length,
      };
    })()
  `);
  check('100 concurrent isMaximized calls resolve to boolean', resConcurrent.allBooleans && resConcurrent.count === 100);

  // Stress 2: Calling IPC handlers with garbage arguments
  console.log('\n[TEST 2] Calling IPC with garbage / unexpected arguments...');
  const resGarbage = await windowInstance.webContents.executeJavaScript(`
    (async () => {
      let errCount = 0;
      try {
        await window.electronAPI.isMaximized('garbage', 123, { a: 1 });
      } catch { errCount++; }
      try {
        await window.electronAPI.minimize({ evil: true }, [1, 2, 3]);
      } catch { errCount++; }
      try {
        await window.electronAPI.maximize(null, undefined, NaN);
      } catch { errCount++; }
      return { errCount };
    })()
  `);
  check('IPC gracefully accepts extra/unexpected arguments without crashing', resGarbage.errCount === 0);

  // Stress 3: Rapid sequential maximize/minimize toggles
  console.log('\n[TEST 3] 20 Rapid sequential maximize calls...');
  const resRapidToggle = await windowInstance.webContents.executeJavaScript(`
    (async () => {
      for (let i = 0; i < 20; i++) {
        await window.electronAPI.maximize();
      }
      return true;
    })()
  `);
  check('20 rapid maximize calls complete cleanly', resRapidToggle === true);

  // Stress 4: Calling IPC after window destruction
  console.log('\n[TEST 4] Calling IPC when window is destroyed or null...');
  const tempWin = windowInstance;
  windowInstance = null; // simulate mainWindow set to null
  const resNullWin = await tempWin.webContents.executeJavaScript(`
    (async () => {
      const isMax = await window.electronAPI.isMaximized();
      await window.electronAPI.minimize();
      await window.electronAPI.maximize();
      return { isMax };
    })()
  `);
  check('Calling IPC handlers when window is null returns default value safely', resNullWin.isMax === false);

  tempWin.close();
  app.quit();

  console.log(`\nResults: ${testsPassed}/${testsTotal} passed`);
  process.exit(testsPassed === testsTotal ? 0 : 1);
}

run().catch((err) => {
  console.error('Stress test failed:', err);
  process.exit(1);
});
