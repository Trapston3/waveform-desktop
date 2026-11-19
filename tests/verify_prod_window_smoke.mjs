// tests/verify_prod_window_smoke.mjs
// In-depth verification of Electron production runtime with main.js, preload.js, and bundled React DOM

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Enforce production mode
process.env.NODE_ENV = 'production';

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

async function runProductionSmoke() {
  await app.whenReady();

  console.log('--- Verifying Electron Production Window Smoke Check ---');
  console.log('Environment: NODE_ENV=' + process.env.NODE_ENV);

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(rootDir, 'dist-electron', 'preload.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  ipcMain.handle('window-minimize', () => {
    if (!win.isDestroyed()) win.minimize();
  });
  ipcMain.handle('window-maximize', () => {
    if (!win.isDestroyed()) {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    }
  });
  ipcMain.handle('window-close', () => {
    if (!win.isDestroyed()) win.close();
  });
  ipcMain.handle('window-is-maximized', () => {
    if (!win.isDestroyed()) return win.isMaximized();
    return false;
  });

  const indexPath = path.join(rootDir, 'dist', 'index.html');
  console.log(`Loading production file: ${indexPath}`);
  await win.loadFile(indexPath);

  // Wait for React rendering and asset loading
  await new Promise((r) => setTimeout(r, 1000));

  const pageDiagnostics = await win.webContents.executeJavaScript(`
    (() => {
      const apiType = typeof window.electronAPI;
      const apiMethods = window.electronAPI ? Object.keys(window.electronAPI) : [];
      const img = document.querySelector('aside img[alt="WaveForm"]') || document.querySelector('header img') || document.querySelector('img[alt="WaveForm"]');
      const rootChildren = document.getElementById('root') ? document.getElementById('root').children.length : 0;
      const titleBar = !!document.querySelector('header');
      const bottomBar = !!document.querySelector('footer');
      const sidebar = !!document.querySelector('aside');

      return {
        apiType,
        apiMethods,
        rootChildren,
        titleBar,
        bottomBar,
        sidebar,
        logo: {
          present: !!img,
          srcPrefix: img ? img.src.substring(0, 40) : null,
          naturalWidth: img ? img.naturalWidth : 0,
          naturalHeight: img ? img.naturalHeight : 0,
        }
      };
    })()
  `);

  console.log('Page Diagnostics in Production Mode:');
  console.log(JSON.stringify(pageDiagnostics, null, 2));

  // Assertions
  assert.strictEqual(pageDiagnostics.apiType, 'object', 'window.electronAPI must be defined as an object');
  console.log('[PASS] window.electronAPI is defined and exposed via preload.cjs');

  const requiredMethods = ['minimize', 'maximize', 'close', 'isMaximized', 'onMaximizedChange', 'platform'];
  for (const method of requiredMethods) {
    assert.ok(
      pageDiagnostics.apiMethods.includes(method),
      `window.electronAPI missing method ${method}`
    );
  }
  console.log('[PASS] window.electronAPI contains all 6 required platform methods');

  assert.ok(pageDiagnostics.rootChildren > 0, 'React root must have rendered children');
  assert.ok(pageDiagnostics.titleBar, 'DesktopTitleBar must be rendered in DOM');
  assert.ok(pageDiagnostics.bottomBar, 'BottomPlayerBar must be rendered in DOM');
  assert.ok(pageDiagnostics.sidebar, 'LeftSidebar must be rendered in DOM');
  console.log('[PASS] Complete React 3-column workstation shell rendered in DOM');

  assert.ok(pageDiagnostics.logo.present, 'Header logo image must be present in DOM');
  assert.ok(
    pageDiagnostics.logo.srcPrefix.startsWith('data:image/svg+xml') || pageDiagnostics.logo.srcPrefix.includes('.svg'),
    'Logo source must be a bundled asset or data URI'
  );
  assert.strictEqual(pageDiagnostics.logo.naturalWidth, 730, 'Logo naturalWidth must match SVG viewBox (730)');
  assert.strictEqual(pageDiagnostics.logo.naturalHeight, 484, 'Logo naturalHeight must match SVG viewBox (484)');
  console.log('[PASS] Header logo vector asset loaded cleanly with natural dimensions 730x484');

  win.close();
  app.quit();
  console.log('\n[ALL PASS] Production window smoke verification passed cleanly!');
  process.exit(0);
}

runProductionSmoke().catch((err) => {
  console.error('Smoke check error:', err);
  process.exit(1);
});
