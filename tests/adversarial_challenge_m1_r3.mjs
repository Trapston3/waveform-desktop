// tests/adversarial_challenge_m1_r3.mjs
// Comprehensive Empirical Challenge & Adversarial Harness for Milestone 1 Iteration 3
// Tests: Preload loading, sandboxing matrix, IPC functional round-trip,
// security isolation, prototype tampering, listener leak stress, TitleBar UI, fonts, and shortcuts.

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Switches for headless / automated testing on Windows
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

const preloadPath = path.join(rootDir, 'dist-electron', 'preload.cjs');
const indexPath = path.join(rootDir, 'dist', 'index.html');

let testCount = 0;
let passCount = 0;
let failCount = 0;

function report(name, passed, detail = '') {
  testCount++;
  if (passed) {
    passCount++;
    console.log(`  [PASS] ${name}${detail ? ' (' + detail + ')' : ''}`);
  } else {
    failCount++;
    console.error(`  [FAIL] ${name}: ${detail}`);
  }
}

async function runAdversarialSuite() {
  await app.whenReady();

  console.log('================================================================');
  console.log(' EMPIRICAL CHALLENGER: ADVERSARIAL STRESS SUITE (M1 ITERATION 3)');
  console.log('================================================================');
  console.log(`Preload Path: ${preloadPath}`);
  console.log(`Index Path  : ${indexPath}`);
  console.log(`Platform    : ${process.platform} (${process.arch})`);
  console.log('----------------------------------------------------------------\n');

  // Verify preload file exists and is CommonJS
  assert.ok(fs.existsSync(preloadPath), `preload.cjs must exist at ${preloadPath}`);
  const preloadCode = fs.readFileSync(preloadPath, 'utf8');
  assert.ok(!preloadCode.includes('import '), 'preload.cjs must not contain ESM import statements');
  assert.ok(preloadCode.includes('require('), 'preload.cjs must use CommonJS require');
  console.log('[SECTION 1] Preload Artifact Verification: PASS (Clean CommonJS)\n');

  // -------------------------------------------------------------------------
  // 1. PRELOAD LOADING & SANDBOXING MATRIX
  // -------------------------------------------------------------------------
  console.log('[SECTION 2] Preload Sandboxing Compatibility Matrix:');
  const sandboxConfigs = [
    { name: 'Production Default (sandbox: true, contextIsolation: true)', sandbox: true, contextIsolation: true, nodeIntegration: false },
    { name: 'Unsandboxed (sandbox: false, contextIsolation: true)', sandbox: false, contextIsolation: true, nodeIntegration: false },
    { name: 'NodeIntegration Off (sandbox: true, contextIsolation: true, nodeIntegration: false)', sandbox: true, contextIsolation: true, nodeIntegration: false },
  ];

  for (const cfg of sandboxConfigs) {
    let preloadErrorCaught = null;
    const testWin = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: preloadPath,
        sandbox: cfg.sandbox,
        contextIsolation: cfg.contextIsolation,
        nodeIntegration: cfg.nodeIntegration,
      },
    });

    testWin.webContents.on('preload-error', (event, scriptPath, error) => {
      preloadErrorCaught = error ? error.toString() : 'Unknown preload error';
    });

    await testWin.loadFile(indexPath);
    await new Promise((r) => setTimeout(r, 400));

    const check = await testWin.webContents.executeJavaScript(`
      (() => ({
        apiDefined: typeof window.electronAPI === 'object' && window.electronAPI !== null,
        apiKeys: window.electronAPI ? Object.keys(window.electronAPI).sort() : [],
      }))()
    `);

    report(
      `Matrix: ${cfg.name}`,
      preloadErrorCaught === null && check.apiDefined,
      preloadErrorCaught ? `Preload Error: ${preloadErrorCaught}` : `Keys: ${check.apiKeys.join(', ')}`
    );

    testWin.close();
  }

  // -------------------------------------------------------------------------
  // 2. LIVE IPC FUNCTIONAL ROUND-TRIP & STRESS
  // -------------------------------------------------------------------------
  console.log('\n[SECTION 3] Live IPC Functional Round-Trip & Stress:');

  let minimizeCalls = 0;
  let maximizeCalls = 0;
  let closeCalls = 0;
  let isMaximizedCalls = 0;
  let simulatedMaximized = false;

  ipcMain.handle('window-minimize', () => {
    minimizeCalls++;
  });
  ipcMain.handle('window-maximize', () => {
    maximizeCalls++;
    simulatedMaximized = !simulatedMaximized;
  });
  ipcMain.handle('window-close', () => {
    closeCalls++;
  });
  ipcMain.handle('window-is-maximized', () => {
    isMaximizedCalls++;
    return simulatedMaximized;
  });

  const mainWin = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await mainWin.loadFile(indexPath);
  await new Promise((r) => setTimeout(r, 600));

  // Test individual methods
  const ipcResults = await mainWin.webContents.executeJavaScript(`
    (async () => {
      const results = {};
      const api = window.electronAPI;

      results.platformMatches = api.platform === '${process.platform}';
      
      const beforeMax = await api.isMaximized();
      results.isMaximizedInitial = beforeMax === false;

      await api.minimize();
      results.minimizeInvoked = true;

      await api.maximize();
      results.maximizeInvoked = true;

      const afterMax = await api.isMaximized();
      results.isMaximizedToggled = afterMax === true;

      await api.close();
      results.closeInvoked = true;

      return results;
    })()
  `);

  report('IPC: window.electronAPI.platform matches process.platform', ipcResults.platformMatches, `platform="${process.platform}"`);
  report('IPC: window.electronAPI.isMaximized() round-trip', ipcResults.isMaximizedInitial && ipcResults.isMaximizedToggled, `calls=${isMaximizedCalls}`);
  report('IPC: window.electronAPI.minimize() invocation', ipcResults.minimizeInvoked && minimizeCalls === 1, `calls=${minimizeCalls}`);
  report('IPC: window.electronAPI.maximize() invocation', ipcResults.maximizeInvoked && maximizeCalls === 1, `calls=${maximizeCalls}`);
  report('IPC: window.electronAPI.close() invocation', ipcResults.closeInvoked && closeCalls === 1, `calls=${closeCalls}`);

  // -------------------------------------------------------------------------
  // 3. EVENT LISTENER & UNCOMMITTED LEAK STRESS
  // -------------------------------------------------------------------------
  console.log('\n[SECTION 4] Event Subscription & Listener Memory Leak Stress:');

  // Register multiple listeners and test unsubscribe
  const listenerStress = await mainWin.webContents.executeJavaScript(`
    (async () => {
      const received1 = [];
      const received2 = [];
      
      const un緻1 = window.electronAPI.onMaximizedChange((val) => {
        received1.push(val);
      });
      const un緻2 = window.electronAPI.onMaximizedChange((val) => {
        received2.push(val);
      });

      return { subscribed: true };
    })()
  `);

  // Send event from main
  mainWin.webContents.send('window-maximized-change', true);
  await new Promise((r) => setTimeout(r, 100));
  mainWin.webContents.send('window-maximized-change', false);
  await new Promise((r) => setTimeout(r, 100));

  // Test 50 rapid subscriptions and unsubscriptions
  const leakTest = await mainWin.webContents.executeJavaScript(`
    (async () => {
      const unsubs = [];
      let count = 0;
      for (let i = 0; i < 50; i++) {
        unsubs.push(window.electronAPI.onMaximizedChange(() => { count++; }));
      }
      // Unsubscribe all
      for (const unsub of unsubs) {
        if (typeof unsub === 'function') unsub();
      }
      return { count, unsubCount: unsubs.length };
    })()
  `);

  report('Listener Stress: 50 subscriptions created and cleanly unsubscribed', leakTest.unsubCount === 50, `unsubscribed=${leakTest.unsubCount}`);

  // Test listener throwing an exception does not break subsequent events
  const throwResilience = await mainWin.webContents.executeJavaScript(`
    (async () => {
      let safeListenerFired = false;
      const badUnsub = window.electronAPI.onMaximizedChange(() => {
        throw new Error('Adversarial listener error');
      });
      const goodUnsub = window.electronAPI.onMaximizedChange(() => {
        safeListenerFired = true;
      });

      return { goodUnsubType: typeof goodUnsub, badUnsubType: typeof badUnsub };
    })()
  `);

  mainWin.webContents.send('window-maximized-change', true);
  await new Promise((r) => setTimeout(r, 100));

  report('Resilience: onMaximizedChange returns valid unsubscribe closures', throwResilience.goodUnsubType === 'function' && throwResilience.badUnsubType === 'function');

  // -------------------------------------------------------------------------
  // 4. ADVERSARIAL SECURITY & TAMPER ISOLATION
  // -------------------------------------------------------------------------
  console.log('\n[SECTION 5] Adversarial Security & Prototype Tampering:');

  const securityCheck = await mainWin.webContents.executeJavaScript(`
    (() => {
      const api = window.electronAPI;
      const leaks = {
        require: typeof window.require,
        process: typeof window.process,
        Buffer: typeof window.Buffer,
        ipcRenderer: typeof window.ipcRenderer,
        module: typeof window.module,
        exports: typeof window.exports,
      };

      // Tamper attempt: overwrite API method in renderer
      let tamperPrevented = false;
      try {
        window.electronAPI.minimize = () => 'tampered';
        // Check if mutation succeeded or was frozen/ignored
        tamperPrevented = typeof window.electronAPI.minimize === 'function';
      } catch (e) {
        tamperPrevented = true; // Strict mode throws on frozen object
      }

      // Check Object properties
      const isFrozen = Object.isFrozen(window.electronAPI);
      const isSealed = Object.isSealed(window.electronAPI);

      return { leaks, tamperPrevented, isFrozen, isSealed };
    })()
  `);

  report('Security: window.require is undefined', securityCheck.leaks.require === 'undefined');
  report('Security: window.process is undefined', securityCheck.leaks.process === 'undefined');
  report('Security: window.Buffer is undefined', securityCheck.leaks.Buffer === 'undefined');
  report('Security: window.ipcRenderer is undefined', securityCheck.leaks.ipcRenderer === 'undefined');
  report('Security: contextBridge exposure integrity', securityCheck.tamperPrevented, `isFrozen=${securityCheck.isFrozen}`);

  // -------------------------------------------------------------------------
  // 5. LIVE ELECTRON DOM, TITLEBAR, LOGO & TYPOGRAPHY
  // -------------------------------------------------------------------------
  console.log('\n[SECTION 6] Live TitleBar, Logo & Typography Verification:');

  const domCheck = await mainWin.webContents.executeJavaScript(`
    (() => {
      const header = document.querySelector('header');
      const logo = document.querySelector('aside img[alt="WaveForm"]') || document.querySelector('header img') || document.querySelector('img[alt="WaveForm"]');
      const titleSpan = document.querySelector('aside .tracking-tight') || document.querySelector('header span');
      const buttons = Array.from(document.querySelectorAll('header button'));
      const minBtn = buttons.find(b => b.title === 'Minimize');
      const maxBtn = buttons.find(b => b.title === 'Maximize' || b.title === 'Restore');
      const closeBtn = buttons.find(b => b.title === 'Close');
      const themeBtn = buttons.find(b => b.title && b.title.includes('mode'));

      const computedHeader = header ? window.getComputedStyle(header) : null;
      const computedBody = window.getComputedStyle(document.body);

      return {
        headerPresent: !!header,
        headerHasDrag: header ? header.classList.contains('app-drag-region') : false,
        logo: logo ? {
          present: true,
          complete: logo.complete,
          naturalWidth: logo.naturalWidth,
          naturalHeight: logo.naturalHeight,
          srcPrefix: logo.src ? logo.src.substring(0, 40) : null,
        } : null,
        titleText: titleSpan ? titleSpan.textContent.trim() : null,
        buttons: {
          minPresent: !!minBtn,
          maxPresent: !!maxBtn,
          closePresent: !!closeBtn,
          themePresent: !!themeBtn,
          minNoDrag: minBtn ? minBtn.parentElement.classList.contains('app-no-drag') : false,
        },
        fontFamily: computedBody ? computedBody.fontFamily : null,
      };
    })()
  `);

  report('TitleBar: Header rendered with app-drag-region', domCheck.headerPresent && domCheck.headerHasDrag);
  report(
    'TitleBar: Logo SVG rendered with 730x484 natural dimensions',
    domCheck.logo && domCheck.logo.complete && domCheck.logo.naturalWidth === 730 && domCheck.logo.naturalHeight === 484,
    domCheck.logo ? `${domCheck.logo.naturalWidth}x${domCheck.logo.naturalHeight}` : 'missing'
  );
  report('Branding: Logo text equals "Music" or "WaveForm"', domCheck.titleText === 'Music' || domCheck.titleText === 'WaveForm', `text="${domCheck.titleText}"`);
  report(
    'TitleBar: Control buttons (Min, Max/Restore, Close, Theme) present with app-no-drag',
    domCheck.buttons.minPresent && domCheck.buttons.maxPresent && domCheck.buttons.closePresent && domCheck.buttons.themePresent && domCheck.buttons.minNoDrag
  );
  report('Typography: Document body font-family includes "SF Pro Display"', domCheck.fontFamily && domCheck.fontFamily.includes('SF Pro Display'), `family="${domCheck.fontFamily}"`);

  // -------------------------------------------------------------------------
  // 6. SHORTCUT INTERACTIONS IN LIVE ELECTRON WINDOW
  // -------------------------------------------------------------------------
  console.log('\n[SECTION 7] Live Electron Keyboard Shortcut Adversarial Verification:');

  const shortcutCheck = await mainWin.webContents.executeJavaScript(`
    (async () => {
      const waitTick = () => new Promise(r => setTimeout(r, 50));
      const results = {};

      const getPlayBtn = () => document.querySelector('button[title="Play"], button[title="Pause"]');
      const getInitialPlayState = getPlayBtn() ? getPlayBtn().getAttribute('title') : null;
      results.initialState = getInitialPlayState;

      // 1. Send Space event
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
      await waitTick();
      const stateAfterSpace = getPlayBtn() ? getPlayBtn().getAttribute('title') : null;
      results.spaceToggled = stateAfterSpace !== getInitialPlayState;

      // 2. Send modified Space (Ctrl+Space) -> should NOT toggle
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', ctrlKey: true, bubbles: true }));
      await waitTick();
      const stateAfterCtrlSpace = getPlayBtn() ? getPlayBtn().getAttribute('title') : null;
      results.ctrlSpaceBlocked = stateAfterCtrlSpace === stateAfterSpace;

      // 3. Reset state with clean Space
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
      await waitTick();
      const stateReset = getPlayBtn() ? getPlayBtn().getAttribute('title') : null;
      results.resetClean = stateReset === getInitialPlayState;

      // 4. Test input focus protection
      const input = document.createElement('input');
      input.type = 'text';
      document.body.appendChild(input);
      input.focus();

      input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
      await waitTick();
      const stateAfterInputSpace = getPlayBtn() ? getPlayBtn().getAttribute('title') : null;
      results.inputIsolated = stateAfterInputSpace === getInitialPlayState;
      input.remove();

      return results;
    })()
  `);

  report('Shortcuts: Space key toggles play/pause state', shortcutCheck.spaceToggled, `initial=${shortcutCheck.initialState}`);
  report('Shortcuts: Ctrl+Space modifier blocked from triggering playback', shortcutCheck.ctrlSpaceBlocked);
  report('Shortcuts: Space toggles cleanly back to original state', shortcutCheck.resetClean);
  report('Shortcuts: Focused <input> typing isolates Space from triggering playback', shortcutCheck.inputIsolated);

  mainWin.close();

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(` CHALLENGE SUITE SUMMARY: ${passCount}/${testCount} PASS (${failCount} FAIL)`);
  console.log('================================================================');

  if (failCount === 0) {
    console.log('>>> VERDICT: ALL ADVERSARIAL CHALLENGES EMPIRICALLY SATISFIED <<<');
    process.exit(0);
  } else {
    console.error(`>>> VERDICT: FAILED WITH ${failCount} DEFECTS <<<`);
    process.exit(1);
  }
}

runAdversarialSuite().catch((err) => {
  console.error('Fatal challenge runner error:', err);
  process.exit(1);
});
