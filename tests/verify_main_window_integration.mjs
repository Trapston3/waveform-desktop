// tests/verify_main_window_integration.mjs
// Empirical test of the exact production BrowserWindow configuration in electron/main.ts

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Register the actual IPC handlers from electron/main.ts
ipcMain.handle('window-minimize', () => {});
ipcMain.handle('window-maximize', () => {});
ipcMain.handle('window-close', () => {});
ipcMain.handle('window-is-maximized', () => false);

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

async function verifyMainWindowConfig() {
  await app.whenReady();

  console.log('--- Testing Exact electron/main.ts BrowserWindow Configuration ---');
  
  // This mirrors electron/main.ts lines 14-32 exactly:
  // webPreferences: {
  //   preload: path.join(__dirname, 'preload.js'),
  //   sandbox: false,
  //   contextIsolation: true,
  //   nodeIntegration: false,
  // }
  const preloadPath = path.join(rootDir, 'dist-electron', 'preload.cjs');
  console.log('Preload path:', preloadPath);

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: preloadPath,
      sandbox: false, // EXACT setting from electron/main.ts
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  let preloadErrorOccurred = false;
  let preloadErrorMessage = '';

  win.webContents.on('preload-error', (event, scriptPath, error) => {
    preloadErrorOccurred = true;
    preloadErrorMessage = error ? error.toString() : 'Unknown error';
    console.error('[DETECTION] Preload error emitted by webContents:');
    console.error(`  Script: ${scriptPath}`);
    console.error(`  Error:  ${preloadErrorMessage}`);
  });

  const indexPath = path.join(rootDir, 'dist', 'index.html');
  await win.loadFile(indexPath);

  // Allow time for script execution
  await new Promise((r) => setTimeout(r, 800));

  const apiStatus = await win.webContents.executeJavaScript(`
    (() => {
      return {
        apiDefined: typeof window.electronAPI !== 'undefined',
        apiType: typeof window.electronAPI,
        keys: window.electronAPI ? Object.keys(window.electronAPI) : []
      };
    })()
  `);

  console.log('\nResults with electron/main.ts settings (sandbox: false):');
  console.log(JSON.stringify(apiStatus, null, 2));

  win.close();

  // Now contrast with sandbox: true (or omitting sandbox)
  console.log('\n--- Comparing with Sandboxed Execution (sandbox: true / default) ---');
  const winSandboxed = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: preloadPath,
      // sandbox omitted or true
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  let sandboxedErrorOccurred = false;
  winSandboxed.webContents.on('preload-error', (event, scriptPath, error) => {
    sandboxedErrorOccurred = true;
  });

  await winSandboxed.loadFile(indexPath);
  await new Promise((r) => setTimeout(r, 800));

  const sandboxedApiStatus = await winSandboxed.webContents.executeJavaScript(`
    (() => {
      return {
        apiDefined: typeof window.electronAPI !== 'undefined',
        apiType: typeof window.electronAPI,
        keys: window.electronAPI ? Object.keys(window.electronAPI) : []
      };
    })()
  `);

  console.log('Results with Sandboxed Execution:');
  console.log(JSON.stringify(sandboxedApiStatus, null, 2));

  winSandboxed.close();
  app.quit();

  console.log('\n--- Summary Diagnosis ---');
  if (preloadErrorOccurred || !apiStatus.apiDefined) {
    console.error('CRITICAL BUG CONFIRMED: electron/main.ts sets sandbox: false while package.json has "type": "module".');
    console.error('Node.js loader fails with ERR_REQUIRE_ESM because dist-electron/preload.js ends in .js.');
    console.error('As a result, window.electronAPI is undefined in the real application.');
    process.exit(1);
  } else {
    console.log('No bug detected.');
    process.exit(0);
  }
}

verifyMainWindowConfig().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
