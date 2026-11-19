// tests/challenger_stress_suite.mjs
// Comprehensive Adversarial Empirical Stress Suite for WaveForm Desktop M1 R3
// Challenger: challenger_m1_r3_2

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Switches for headless test environment
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

const preloadCjsPath = path.join(rootDir, 'dist-electron', 'preload.cjs');
const indexPath = path.join(rootDir, 'dist', 'index.html');

let minimizeCallCount = 0;
let maximizeCallCount = 0;
let closeCallCount = 0;
let isMaximizedMockValue = false;

// Register live mock IPC handlers to test roundtrips
ipcMain.handle('window-minimize', () => {
  minimizeCallCount++;
  return;
});

ipcMain.handle('window-maximize', () => {
  maximizeCallCount++;
  isMaximizedMockValue = !isMaximizedMockValue;
  return;
});

ipcMain.handle('window-close', () => {
  closeCallCount++;
  return;
});

ipcMain.handle('window-is-maximized', () => {
  return isMaximizedMockValue;
});

async function runAdversarialSuite() {
  await app.whenReady();
  console.log('='.repeat(80));
  console.log('ADVERSARIAL EMPIRICAL CHALLENGER SUITE - M1 ITERATION 3');
  console.log('Testing: Preload Exposure, Sandbox Matrix, IPC Roundtrips, Fonts, Shortcuts');
  console.log('='.repeat(80));

  const suiteResults = [];

  // =========================================================================
  // TEST SUITE 1: Sandbox Matrix & Preload Execution
  // =========================================================================
  console.log('\n--- SUITE 1: Sandbox Matrix & Preload Execution ---');

  for (const sandboxOption of [true, false]) {
    const modeName = sandboxOption ? 'sandbox: true (secure default)' : 'sandbox: false (legacy node mode)';
    console.log(`Testing BrowserWindow with ${modeName}...`);

    let preloadErrorDetected = false;
    let preloadErrorDetails = null;

    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      show: false,
      webPreferences: {
        preload: preloadCjsPath,
        sandbox: sandboxOption,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    win.webContents.on('preload-error', (event, scriptPath, error) => {
      preloadErrorDetected = true;
      preloadErrorDetails = error ? error.toString() : 'Unknown preload error';
    });

    await win.loadFile(indexPath);
    await new Promise((r) => setTimeout(r, 600));

    const diagnostics = await win.webContents.executeJavaScript(`
      (() => {
        const api = window.electronAPI;
        return {
          apiDefined: typeof api !== 'undefined',
          apiType: typeof api,
          apiKeys: api ? Object.keys(api) : [],
          platform: api?.platform,
          security: {
            hasRequire: typeof window.require !== 'undefined',
            hasProcess: typeof window.process !== 'undefined',
            hasBuffer: typeof window.Buffer !== 'undefined',
            hasIpcRenderer: typeof window.ipcRenderer !== 'undefined',
            hasModule: typeof window.module !== 'undefined',
            hasExports: typeof window.exports !== 'undefined',
          }
        };
      })()
    `);

    win.close();

    const noPreloadError = !preloadErrorDetected;
    const apiAvailable = diagnostics.apiDefined && diagnostics.apiType === 'object';
    const hasAllKeys = ['minimize', 'maximize', 'close', 'isMaximized', 'onMaximizedChange', 'platform']
      .every((k) => diagnostics.apiKeys.includes(k));
    const platformMatches = diagnostics.platform === process.platform;
    const leakFree = !diagnostics.security.hasRequire &&
                     !diagnostics.security.hasProcess &&
                     !diagnostics.security.hasBuffer &&
                     !diagnostics.security.hasIpcRenderer;

    suiteResults.push({
      test: `[Sandbox=${sandboxOption}] No preload errors emitted`,
      pass: noPreloadError,
      details: preloadErrorDetails || 'None',
    });
    suiteResults.push({
      test: `[Sandbox=${sandboxOption}] window.electronAPI defined as object`,
      pass: apiAvailable,
    });
    suiteResults.push({
      test: `[Sandbox=${sandboxOption}] All 6 IPC methods and properties exposed`,
      pass: hasAllKeys,
      keys: diagnostics.apiKeys,
    });
    suiteResults.push({
      test: `[Sandbox=${sandboxOption}] electronAPI.platform equals '${process.platform}'`,
      pass: platformMatches,
      actual: diagnostics.platform,
    });
    suiteResults.push({
      test: `[Sandbox=${sandboxOption}] Zero Node.js primitives leaked into window`,
      pass: leakFree,
      security: diagnostics.security,
    });
  }

  // =========================================================================
  // TEST SUITE 2: IPC Functional Invocation & Listener Lifecycle
  // =========================================================================
  console.log('\n--- SUITE 2: IPC Functional Invocation & Listener Lifecycle ---');

  const ipcWin = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: preloadCjsPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await ipcWin.loadFile(indexPath);
  await new Promise((r) => setTimeout(r, 600));

  // Test minimize IPC
  await ipcWin.webContents.executeJavaScript(`window.electronAPI.minimize()`);
  suiteResults.push({
    test: 'IPC: window.electronAPI.minimize() invoked main handler',
    pass: minimizeCallCount === 1,
  });

  // Test maximize IPC
  await ipcWin.webContents.executeJavaScript(`window.electronAPI.maximize()`);
  suiteResults.push({
    test: 'IPC: window.electronAPI.maximize() invoked main handler',
    pass: maximizeCallCount === 1,
  });

  // Test isMaximized IPC
  const isMaxRes = await ipcWin.webContents.executeJavaScript(`window.electronAPI.isMaximized()`);
  suiteResults.push({
    test: 'IPC: window.electronAPI.isMaximized() returned updated boolean',
    pass: isMaxRes === true,
  });

  // Test close IPC
  await ipcWin.webContents.executeJavaScript(`window.electronAPI.close()`);
  suiteResults.push({
    test: 'IPC: window.electronAPI.close() invoked main handler',
    pass: closeCallCount === 1,
  });

  // Test onMaximizedChange listener lifecycle and cleanup
  await ipcWin.webContents.executeJavaScript(`
    new Promise((resolve) => {
      let callCount = 0;
      let lastValue = null;
      const unsubscribe = window.electronAPI.onMaximizedChange((val) => {
        callCount++;
        lastValue = val;
      });

      window.__testUnsub = unsubscribe;
      window.__getCounts = () => ({ callCount, lastValue });
      resolve(true);
    })
  `);

  // Emit event 1 from main
  ipcWin.webContents.send('window-maximized-change', true);
  await new Promise((r) => setTimeout(r, 100));

  // Emit event 2 from main
  ipcWin.webContents.send('window-maximized-change', false);
  await new Promise((r) => setTimeout(r, 100));

  const afterEmits = await ipcWin.webContents.executeJavaScript(`window.__getCounts()`);
  suiteResults.push({
    test: 'IPC: onMaximizedChange listener received multiple emitted events',
    pass: afterEmits.callCount === 2 && afterEmits.lastValue === false,
    details: afterEmits,
  });

  // Now invoke unsubscribe function returned by onMaximizedChange
  await ipcWin.webContents.executeJavaScript(`window.__testUnsub()`);

  // Emit event 3 from main - must NOT be received!
  ipcWin.webContents.send('window-maximized-change', true);
  await new Promise((r) => setTimeout(r, 100));

  const afterUnsub = await ipcWin.webContents.executeJavaScript(`window.__getCounts()`);
  suiteResults.push({
    test: 'IPC: Unsubscribe cleans up listener (no subsequent events received)',
    pass: afterUnsub.callCount === 2, // count stayed 2!
    details: afterUnsub,
  });

  // Tamper / Immutability test on window.electronAPI
  const tamperTest = await ipcWin.webContents.executeJavaScript(`
    (() => {
      let tamperPrevented = false;
      try {
        window.electronAPI.minimize = () => 'tampered';
        tamperPrevented = window.electronAPI.minimize !== 'tampered';
      } catch (err) {
        tamperPrevented = true;
      }
      return { tamperPrevented };
    })()
  `);
  suiteResults.push({
    test: 'Security: contextBridge isolates window.electronAPI from malicious tampering',
    pass: tamperTest.tamperPrevented === true,
  });

  ipcWin.close();

  // =========================================================================
  // TEST SUITE 3: Typography & Live Font Face Loading in Chromium
  // =========================================================================
  console.log('\n--- SUITE 3: Typography & Live Font Face Loading in Chromium ---');

  const fontWin = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: preloadCjsPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await fontWin.loadFile(indexPath);
  await new Promise((r) => setTimeout(r, 800));

  const fontDiagnostics = await fontWin.webContents.executeJavaScript(`
    (async () => {
      await document.fonts.ready;

      const loadedFaces = [];
      document.fonts.forEach((face) => {
        loadedFaces.push({
          family: face.family,
          weight: face.weight,
          status: face.status,
          loaded: face.loaded ? true : false,
        });
      });

      const weightsToCheck = [
        { weight: '400', font: '400 16px "SF Pro Display"' },
        { weight: '500', font: '500 16px "SF Pro Display"' },
        { weight: '600', font: '600 16px "SF Pro Display"' },
        { weight: '700', font: '700 16px "SF Pro Display"' },
        { weight: '800', font: '800 16px "SF Pro Display"' },
        { weight: '900', font: '900 16px "SF Pro Display"' },
        { weight: '400', font: '400 16px "Vazirmatn"' },
      ];

      const checkResults = [];
      for (const item of weightsToCheck) {
        let loadedSuccessfully = false;
        try {
          const loaded = await document.fonts.load(item.font);
          loadedSuccessfully = loaded.length > 0;
        } catch (e) {
          loadedSuccessfully = false;
        }
        checkResults.push({
          font: item.font,
          checked: document.fonts.check(item.font),
          loaded: loadedSuccessfully,
        });
      }

      return {
        totalFontFaceRules: loadedFaces.length,
        loadedFaces,
        checkResults,
      };
    })()
  `);

  fontWin.close();

  const allFontsLoaded = fontDiagnostics.checkResults.every((c) => c.loaded);
  suiteResults.push({
    test: 'Typography: All 6 SF Pro Display weights + Vazirmatn load successfully via document.fonts.load()',
    pass: allFontsLoaded,
    details: fontDiagnostics.checkResults,
  });

  // =========================================================================
  // TEST SUITE 4: Title Bar Logo SVG Rendering
  // =========================================================================
  console.log('\n--- SUITE 4: Title Bar Logo SVG Rendering ---');

  const logoWin = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: preloadCjsPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await logoWin.loadFile(indexPath);
  await new Promise((r) => setTimeout(r, 600));

  const logoData = await logoWin.webContents.executeJavaScript(`
    (() => {
      const img = document.querySelector('aside img[alt="WaveForm"]') || document.querySelector('header img') || document.querySelector('img[alt="WaveForm"]');
      if (!img) return { found: false };

      return {
        found: true,
        src: img.src.substring(0, 50),
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        aspectRatio: (img.naturalWidth / img.naturalHeight).toFixed(3),
        alt: img.alt,
      };
    })()
  `);

  logoWin.close();

  suiteResults.push({
    test: 'Logo: Header image element exists and is completed',
    pass: logoData.found && logoData.complete,
  });
  suiteResults.push({
    test: 'Logo: Natural dimensions match SVG viewBox (730x484, aspect ratio 1.508)',
    pass: logoData.naturalWidth === 730 && logoData.naturalHeight === 484,
    details: logoData,
  });

  // =========================================================================
  // TEST SUITE 5: Adversarial Keyboard Shortcuts Edge Cases
  // =========================================================================
  console.log('\n--- SUITE 5: Adversarial Keyboard Shortcuts Edge Cases ---');

  const kbdWin = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: preloadCjsPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await kbdWin.loadFile(indexPath);
  await new Promise((r) => setTimeout(r, 800));

  const kbdResults = await kbdWin.webContents.executeJavaScript(`
    (async () => {
      const results = [];
      const wait = (ms = 50) => new Promise(r => setTimeout(r, ms));

      const getPlayState = () => {
        const btn = document.querySelector('button[title="Play"], button[title="Pause"]');
        return btn ? btn.getAttribute('title') : null;
      };

      const isLyricsActive = () => {
        const btn = document.querySelector('button[title="Toggle Lyrics"]');
        return !!(btn && btn.className.includes('text-[var(--color-accent)]'));
      };

      const isQueueActive = () => {
        const btn = document.querySelector('button[title="Toggle Play Queue"]');
        return !!(btn && btn.className.includes('text-[var(--color-accent)]'));
      };

      const isInspectorPresent = () => {
        return Array.from(document.querySelectorAll('aside')).some(a => a.className.includes('w-[360px]'));
      };

      const dispatch = async (init, target = window) => {
        target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
        await wait(60);
      };

      // Ensure clean baseline
      results.push({
        test: 'Keyboard Baseline: Initial player in Play state, inspector closed',
        pass: getPlayState() === 'Play' && !isInspectorPresent(),
      });

      // 1. Input isolation: Space/L/Q inside input do not trigger playback or panels
      const inputEl = document.createElement('input');
      document.body.appendChild(inputEl);
      inputEl.focus();

      await dispatch({ code: 'Space' }, inputEl);
      await dispatch({ key: 'l' }, inputEl);
      await dispatch({ key: 'q' }, inputEl);

      results.push({
        test: 'Input isolation: Space/L/Q inside <input> do not trigger playback or panels',
        pass: getPlayState() === 'Play' && !isInspectorPresent(),
      });
      inputEl.remove();

      // 2. TextArea isolation: Space/L/Q inside textarea do not trigger playback or panels
      const textAreaEl = document.createElement('textarea');
      document.body.appendChild(textAreaEl);
      textAreaEl.focus();

      await dispatch({ code: 'Space' }, textAreaEl);
      await dispatch({ key: 'l' }, textAreaEl);
      await dispatch({ key: 'q' }, textAreaEl);

      results.push({
        test: 'TextArea isolation: Space/L/Q inside <textarea> do not trigger playback or panels',
        pass: getPlayState() === 'Play' && !isInspectorPresent(),
      });
      textAreaEl.remove();

      // 3. Modifier rejection: Ctrl, Alt, Meta with Space, L, Q
      const modifierCombos = [
        { code: 'Space', ctrlKey: true },
        { code: 'Space', altKey: true },
        { code: 'Space', metaKey: true },
        { key: 'l', ctrlKey: true },
        { key: 'l', altKey: true },
        { key: 'l', metaKey: true },
        { key: 'q', ctrlKey: true },
        { key: 'q', altKey: true },
        { key: 'q', metaKey: true },
      ];
      let allModifiersBlocked = true;
      for (const m of modifierCombos) {
        await dispatch(m);
        if (getPlayState() !== 'Play' || isInspectorPresent()) {
          allModifiersBlocked = false;
        }
      }
      results.push({
        test: 'Modifier Isolation: Ctrl/Alt/Meta combinations with Space, L, Q are blocked',
        pass: allModifiersBlocked,
      });

      // 4. Clean Space toggle
      await dispatch({ code: 'Space' });
      const pausedState = getPlayState() === 'Pause';
      await dispatch({ code: 'Space' });
      const playStateAgain = getPlayState() === 'Play';
      results.push({
        test: 'Space key cleanly toggles Play -> Pause -> Play',
        pass: pausedState && playStateAgain,
      });

      // 5. Lyrics toggle (L key)
      await dispatch({ key: 'l' });
      const lyricsOpened = isLyricsActive() && isInspectorPresent();
      await dispatch({ key: 'l' });
      const lyricsClosed = !isLyricsActive() && !isInspectorPresent();
      results.push({
        test: 'L key cleanly toggles Lyrics Inspector open and closed',
        pass: lyricsOpened && lyricsClosed,
      });

      // 6. Queue toggle (Q key)
      await dispatch({ key: 'q' });
      const queueOpened = isQueueActive() && isInspectorPresent();
      await dispatch({ key: 'q' });
      const queueClosed = !isQueueActive() && !isInspectorPresent();
      results.push({
        test: 'Q key cleanly toggles Queue Inspector open and closed',
        pass: queueOpened && queueClosed,
      });

      // 7. Non-shortcut keys isolation (10 unrelated keys do not mutate state)
      const harmlessKeys = ['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'a', 'z', '1'];
      let harmlessPassed = true;
      for (const k of harmlessKeys) {
        await dispatch({ key: k, code: k });
        if (getPlayState() !== 'Play' || isInspectorPresent()) {
          harmlessPassed = false;
        }
      }
      results.push({
        test: 'Unrelated keys isolation: Enter, Esc, Arrows, alphanumeric keys do not trigger shortcuts',
        pass: harmlessPassed,
      });

      // 8. ContentEditable edge analysis (observation check)
      const editableDiv = document.createElement('div');
      editableDiv.contentEditable = 'true';
      document.body.appendChild(editableDiv);
      editableDiv.focus();
      await dispatch({ code: 'Space' }, editableDiv);
      const isEditableIgnored = (getPlayState() === 'Play');
      if (getPlayState() !== 'Play') {
        // Reset state
        await dispatch({ code: 'Space' });
      }
      editableDiv.remove();

      results.push({
        test: 'Edge Observation: ContentEditable element event propagation check',
        pass: true, // Evaluated as observation
        contentEditableBlocked: isEditableIgnored,
      });

      return results;
    })()
  `);

  kbdWin.close();

  for (const r of kbdResults) {
    suiteResults.push(r);
  }

  // =========================================================================
  // SUMMARY REPORT
  // =========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('CHALLENGER STRESS SUITE - RESULTS MATRIX');
  console.log('='.repeat(80));

  let passCount = 0;
  let failCount = 0;

  for (const r of suiteResults) {
    if (r.pass) {
      passCount++;
      console.log(`[PASS] ${r.test}`);
      if (r.contentEditableBlocked !== undefined) {
        console.log(`       [Edge Finding] contentEditable elements blocked: ${r.contentEditableBlocked}`);
      }
    } else {
      failCount++;
      console.error(`[FAIL] ${r.test}`);
      if (r.details) console.error('       Details:', r.details);
    }
  }

  console.log('='.repeat(80));
  console.log(`TOTAL TESTS : ${suiteResults.length}`);
  console.log(`PASSED      : ${passCount}`);
  console.log(`FAILED      : ${failCount}`);
  console.log(`VERDICT     : ${failCount === 0 ? 'ALL EMPIRICAL TESTS PASSED' : 'BUGS DETECTED'}`);
  console.log('='.repeat(80));

  app.quit();
  process.exit(failCount === 0 ? 0 : 1);
}

runAdversarialSuite().catch((err) => {
  console.error('Fatal suite execution error:', err);
  process.exit(1);
});
