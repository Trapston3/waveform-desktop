// tests/verify_keyboard_shortcuts.mjs
// Adversarial empirical verification of keyboard shortcut modifier isolation and edge cases in App.tsx

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

ipcMain.handle('window-minimize', () => {});
ipcMain.handle('window-maximize', () => {});
ipcMain.handle('window-close', () => {});
ipcMain.handle('window-is-maximized', () => false);

async function runTests() {
  await app.whenReady();

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(rootDir, 'dist-electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const indexPath = path.join(rootDir, 'dist', 'index.html');
  await win.loadFile(indexPath);
  await new Promise((resolve) => setTimeout(resolve, 800));

  console.log('--- Adversarial Keyboard Events Test Suite on App.tsx ---');

  const testResults = await win.webContents.executeJavaScript(`
    (async () => {
      const results = [];
      const waitTick = () => new Promise(r => setTimeout(r, 60));

      const getPlayButtonTitle = () => {
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
        return !!document.querySelector('aside.w-\\\\[360px\\\\]');
      };

      const dispatchKey = async (init, targetElement = window) => {
        const event = new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          ...init,
        });
        targetElement.dispatchEvent(event);
        await waitTick();
      };

      // 1. Baseline state
      results.push({
        test: 'Baseline Initial State (Play, Lyrics=false, Queue=false)',
        pass: getPlayButtonTitle() === 'Play' && !isLyricsActive() && !isQueueActive() && !isInspectorPresent()
      });

      // 2. Modifier Isolation on Space
      const spaceModifiers = [
        { name: 'Ctrl+Space', ctrlKey: true, code: 'Space' },
        { name: 'Alt+Space', altKey: true, code: 'Space' },
        { name: 'Meta+Space', metaKey: true, code: 'Space' },
        { name: 'Ctrl+Alt+Space', ctrlKey: true, altKey: true, code: 'Space' },
        { name: 'Ctrl+Meta+Space', ctrlKey: true, metaKey: true, code: 'Space' },
        { name: 'Ctrl+Alt+Meta+Space', ctrlKey: true, altKey: true, metaKey: true, code: 'Space' },
      ];
      for (const m of spaceModifiers) {
        await dispatchKey(m);
        const state = getPlayButtonTitle();
        results.push({
          test: 'Modifier blocked: ' + m.name,
          pass: state === 'Play'
        });
      }

      // 3. Normal Space Toggle
      await dispatchKey({ code: 'Space' });
      results.push({
        test: 'Unmodified Space toggles to Pause',
        pass: getPlayButtonTitle() === 'Pause'
      });

      // 4. Modifier Isolation while Paused
      for (const m of spaceModifiers) {
        await dispatchKey(m);
        const state = getPlayButtonTitle();
        results.push({
          test: 'Modifier blocked while Paused: ' + m.name,
          pass: state === 'Pause'
        });
      }

      // Return to Play
      await dispatchKey({ code: 'Space' });
      results.push({
        test: 'Unmodified Space toggles back to Play',
        pass: getPlayButtonTitle() === 'Play'
      });

      // 5. Modifier Isolation on L (Lyrics)
      const lModifiers = [
        { name: 'Ctrl+L', ctrlKey: true, key: 'l' },
        { name: 'Alt+L', altKey: true, key: 'l' },
        { name: 'Meta+L', metaKey: true, key: 'l' },
        { name: 'Ctrl+Alt+L', ctrlKey: true, altKey: true, key: 'l' },
        { name: 'Ctrl+Meta+L', ctrlKey: true, metaKey: true, key: 'l' },
        { name: 'Ctrl+Shift+L', ctrlKey: true, shiftKey: true, key: 'L' },
      ];
      for (const m of lModifiers) {
        await dispatchKey(m);
        results.push({
          test: 'Modifier blocked: ' + m.name,
          pass: !isLyricsActive() && !isInspectorPresent()
        });
      }

      // 6. Case sensitivity test for L (lowercase 'l' and uppercase 'L')
      await dispatchKey({ key: 'l' });
      results.push({
        test: 'Lowercase "l" toggles lyrics open',
        pass: isLyricsActive() && isInspectorPresent()
      });

      await dispatchKey({ key: 'L' });
      results.push({
        test: 'Uppercase "L" toggles lyrics closed',
        pass: !isLyricsActive() && !isInspectorPresent()
      });

      // 7. Modifier Isolation on Q (Queue)
      const qModifiers = [
        { name: 'Ctrl+Q', ctrlKey: true, key: 'q' },
        { name: 'Alt+Q', altKey: true, key: 'q' },
        { name: 'Meta+Q', metaKey: true, key: 'q' },
        { name: 'Ctrl+Alt+Q', ctrlKey: true, altKey: true, key: 'q' },
        { name: 'Ctrl+Meta+Q', ctrlKey: true, metaKey: true, key: 'q' },
        { name: 'Ctrl+Shift+Q', ctrlKey: true, shiftKey: true, key: 'Q' },
      ];
      for (const m of qModifiers) {
        await dispatchKey(m);
        results.push({
          test: 'Modifier blocked: ' + m.name,
          pass: !isQueueActive() && !isInspectorPresent()
        });
      }

      // 8. Case sensitivity test for Q (lowercase 'q' and uppercase 'Q')
      await dispatchKey({ key: 'q' });
      results.push({
        test: 'Lowercase "q" toggles queue open',
        pass: isQueueActive() && isInspectorPresent()
      });

      await dispatchKey({ key: 'Q' });
      results.push({
        test: 'Uppercase "Q" toggles queue closed',
        pass: !isQueueActive() && !isInspectorPresent()
      });

      // 9. Input and TextArea focus isolation
      const dummyInput = document.createElement('input');
      const dummyTextArea = document.createElement('textarea');
      document.body.appendChild(dummyInput);
      document.body.appendChild(dummyTextArea);

      dummyInput.focus();
      await dispatchKey({ code: 'Space' }, dummyInput);
      await dispatchKey({ key: 'l' }, dummyInput);
      await dispatchKey({ key: 'q' }, dummyInput);
      results.push({
        test: 'Input focus isolation: Space, L, Q do not trigger actions when typing in <input>',
        pass: getPlayButtonTitle() === 'Play' && !isLyricsActive() && !isQueueActive()
      });

      dummyTextArea.focus();
      await dispatchKey({ code: 'Space' }, dummyTextArea);
      await dispatchKey({ key: 'l' }, dummyTextArea);
      await dispatchKey({ key: 'q' }, dummyTextArea);
      results.push({
        test: 'TextArea focus isolation: Space, L, Q do not trigger actions when typing in <textarea>',
        pass: getPlayButtonTitle() === 'Play' && !isLyricsActive() && !isQueueActive()
      });

      dummyInput.remove();
      dummyTextArea.remove();

      return results;
    })()
  `);

  let allPass = true;
  for (const r of testResults) {
    if (r.pass) {
      console.log(`[PASS] ${r.test}`);
    } else {
      console.error(`[FAIL] ${r.test}`);
      allPass = false;
    }
  }

  win.close();
  app.quit();

  if (!allPass) {
    console.error('\nAdversarial keyboard shortcut tests FAILED.');
    process.exit(1);
  } else {
    console.log(`\n[ALL PASS] All ${testResults.length} adversarial shortcut isolation tests passed!`);
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Test run error:', err);
  process.exit(1);
});
