// tests/verify_electron_runtime.cjs
// Empirical verification of Electron preload execution, window.electronAPI exposure, and TitleBar logo rendering

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const mode = process.argv[2];
const rootDir = path.resolve(__dirname, '..');

if (mode === '--run-electron') {
  const targetPreload = process.argv[3];
  const { app, BrowserWindow } = require('electron');

  app.whenReady().then(async () => {
    const preloadPath = path.resolve(rootDir, targetPreload);
    const indexPath = path.resolve(rootDir, 'dist', 'index.html');

    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    win.webContents.on('did-finish-load', async () => {
      try {
        const evalResult = await win.webContents.executeJavaScript(`
          (() => {
            const api = window.electronAPI;
            const img = document.querySelector('header img');
            return {
              apiExists: typeof api !== 'undefined',
              apiType: typeof api,
              apiKeys: api ? Object.keys(api) : [],
              methods: {
                minimize: typeof api?.minimize,
                maximize: typeof api?.maximize,
                close: typeof api?.close,
                isMaximized: typeof api?.isMaximized,
                onMaximizedChange: typeof api?.onMaximizedChange,
                platform: api?.platform,
              },
              logo: img ? {
                found: true,
                tagName: img.tagName,
                srcPreview: img.src ? img.src.substring(0, 50) : null,
                isDataUri: img.src ? img.src.startsWith('data:image/svg+xml') : false,
                naturalWidth: img.naturalWidth,
                naturalHeight: img.naturalHeight,
                complete: img.complete,
              } : { found: false },
              security: {
                hasRequire: typeof window.require,
                hasProcess: typeof window.process,
                hasBuffer: typeof window.Buffer,
                hasIpcRenderer: typeof window.ipcRenderer,
              }
            };
          })()
        `);
        console.log('RESULT_PAYLOAD:' + JSON.stringify(evalResult));
      } catch (err) {
        console.error('EXECUTE_JS_ERROR:', err);
      } finally {
        app.quit();
      }
    });

    win.webContents.on('did-fail-load', (e, code, desc) => {
      console.error('LOAD_FAILED:', code, desc);
      app.quit();
    });

    win.loadFile(indexPath);
  });
} else {
  // Runner orchestrator
  async function runElectronWith(preloadRelPath) {
    return new Promise((resolve) => {
      const electronBinary = require('electron');
      const child = spawn(electronBinary, [__filename, '--run-electron', preloadRelPath], {
        cwd: rootDir,
        stdio: ['inherit', 'pipe', 'pipe'],
        env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });

      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      child.on('close', (code) => {
        resolve({ code, stdout, stderr });
      });
    });
  }

  (async () => {
    console.log('====================================================');
    console.log('EMPIRICAL CHALLENGER: ELECTRON RUNTIME VERIFICATION');
    console.log('====================================================\n');

    console.log('[TEST 1] Current Production Preload: dist-electron/preload.js');
    const res1 = await runElectronWith('dist-electron/preload.js');
    console.log('Exit Code:', res1.code);
    const match1 = res1.stdout.match(/RESULT_PAYLOAD:(.*)/);
    if (match1) {
      console.log('Payload:', JSON.stringify(JSON.parse(match1[1]), null, 2));
    }
    const errMatch1 = res1.stderr.match(/ERR_REQUIRE_ESM[^\n]+/);
    if (errMatch1) {
      console.log('Observed Stderr Match:', errMatch1[0]);
    }

    console.log('\n[TEST 2] Counter-example / Proof of Fix: dist-electron/preload.cjs');
    const preloadJsPath = path.join(rootDir, 'dist-electron', 'preload.js');
    const preloadCjsPath = path.join(rootDir, 'dist-electron', 'preload.cjs');
    fs.copyFileSync(preloadJsPath, preloadCjsPath);

    const res2 = await runElectronWith('dist-electron/preload.cjs');
    try {
      fs.unlinkSync(preloadCjsPath);
    } catch {
      // ignore
    }

    console.log('Exit Code:', res2.code);
    const match2 = res2.stdout.match(/RESULT_PAYLOAD:(.*)/);
    if (match2) {
      console.log('Payload:', JSON.stringify(JSON.parse(match2[1]), null, 2));
    }
    const errMatch2 = res2.stderr.match(/ERR_REQUIRE_ESM[^\n]+/);
    if (errMatch2) {
      console.log('Observed Stderr Match:', errMatch2[0]);
    } else {
      console.log('No ERR_REQUIRE_ESM observed with .cjs extension.');
    }

    console.log('\n====================================================');
  })();
}
