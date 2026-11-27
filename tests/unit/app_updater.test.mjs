// tests/unit/app_updater.test.mjs
// Unit & UI tests for One-Click In-App Updater, SHA-256 verification, Persistent Cold-Boot Reminder, and Tray Sync

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

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
    if (specifier.startsWith('.')) {
      if (specifier.endsWith('.js')) {
        try {
          return await nextResolve(specifier.slice(0, -3) + '.ts', context);
        } catch {}
      }
      if (!specifier.endsWith('.ts') && !specifier.endsWith('.tsx') && !specifier.endsWith('.js') && !specifier.endsWith('.mjs')) {
        for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
          try {
            return await nextResolve(specifier + suffix, context);
          } catch {}
        }
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

function createMockDom() {
  const classes = new Set(['dark']);
  const styleMap = new Map();
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
  globalThis.document = { documentElement };
  globalThis.window = {
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

createMockDom();

const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');
const {
  compareSemVer,
  parseSha256Sums,
  selectReleaseAssets,
  parseInstallManifest,
  parseInstallManifestMeta,
  planDeltaUpdate,
  buildDirectPatchApplierScript,
  getInstalledAppVersion,
  verifyFileSha256,
  createAppUpdaterController,
  initAppUpdaterIpc,
} = await import('../../electron/appUpdater.ts');
const {
  useSettingsStore,
  useUpdateStore,
  _resetUpdateStoreForTests,
} = await import('../../src/state/settingsStore.ts');
const { UpdatePromptModal } = await import('../../src/ui/common/UpdatePromptModal.tsx');
const { DesktopTitleBar } = await import('../../src/ui/layout/DesktopTitleBar.tsx');
const { SettingsModal } = await import('../../src/ui/common/SettingsModal.tsx');

function makeJsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeChunkedBinaryResponse(chunks, delayMs = 0) {
  const totalBytes = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const stream = new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        if (delayMs > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-length': String(totalBytes) },
  });
}

describe('One-Click In-App Updater & Persistent Cold-Boot Reminder', () => {
  let tempRoot;

  beforeEach(() => {
    createMockDom();
    _resetUpdateStoreForTests();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-updater-test-'));
  });

  afterEach(() => {
    _resetUpdateStoreForTests();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('compareSemVer, parseSha256Sums, selectReleaseAssets, and verifyFileSha256 work accurately', async () => {
    assert.equal(compareSemVer('v1.3.0', '1.2.0'), 1);
    assert.equal(compareSemVer('1.10.0', '1.2.9'), 1);
    assert.equal(compareSemVer('v1.2.0', '1.2.0'), 0);
    assert.equal(compareSemVer('1.2.0-beta.1', '1.2.0'), -1);
    assert.equal(compareSemVer('1.2.0-beta.2', '1.2.0-beta.1'), 1);
    assert.equal(compareSemVer('1.1.9', '1.2.0'), -1);

    const sumsText = [
      '# release checksums',
      'ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789  WaveForm-Setup-1.3.0.exe',
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef *WaveForm-Portable-1.3.0.exe',
    ].join('\n');
    const parsed = parseSha256Sums(sumsText);
    assert.equal(
      parsed.get('WaveForm-Setup-1.3.0.exe'),
      'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
    );
    assert.equal(
      parsed.get('WaveForm-Portable-1.3.0.exe'),
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    );

    const selected = selectReleaseAssets({
      assets: [
        {
          name: 'WaveForm-Portable-1.3.0.exe',
          browser_download_url: 'https://example.com/portable.exe',
          size: 500,
        },
        {
          name: 'WaveForm-Setup-1.3.0.exe',
          browser_download_url: 'https://example.com/setup.exe',
          size: 12345,
        },
        {
          name: 'SHA256SUMS.txt',
          browser_download_url: 'https://example.com/SHA256SUMS.txt',
          size: 128,
        },
      ],
    });
    assert.equal(selected.installerAsset?.name, 'WaveForm-Setup-1.3.0.exe');
    assert.equal(selected.installerAsset?.size, 12345);
    assert.equal(selected.checksumAsset?.name, 'SHA256SUMS.txt');

    const sampleFile = path.join(tempRoot, 'sample.bin');
    const content = Buffer.from('waveform-sha256-test-payload');
    fs.writeFileSync(sampleFile, content);
    const expected = createHash('sha256').update(content).digest('hex');
    assert.equal(await verifyFileSha256(sampleFile, expected), true);
    assert.equal(await verifyFileSha256(sampleFile, '0'.repeat(64)), false);
  });

  test('Cold-boot network errors fail silently while manual checks surface clean errors', async () => {
    const requestedUrls = [];
    const requestedHeaders = [];

    const failingFetch = async (url, init) => {
      requestedUrls.push(url);
      requestedHeaders.push(init?.headers || {});
      throw new Error('ENOTFOUND api.github.com');
    };

    const controller = createAppUpdaterController({
      currentVersion: '1.2.0',
      tempDir: tempRoot,
      fetchFn: failingFetch,
    });

    controller.scheduleColdBootCheck(10);
    await new Promise((r) => setTimeout(r, 40));

    assert.equal(
      requestedUrls[0],
      'https://api.github.com/repos/Trapston3/waveform-desktop/releases/latest'
    );
    assert.equal(requestedHeaders[0]['User-Agent'], 'WaveForm-Desktop/1.2.0');
    assert.equal(controller.getState().status, 'idle');
    assert.equal(controller.getState().error, null);

    const manualResult = await controller.checkForUpdates(true);
    assert.equal(manualResult.status, 'error');
    assert.ok(manualResult.error?.includes('ENOTFOUND'));
    controller.dispose();
  });

  test('Session-only dismissal hides reminder now and reminds again on fresh cold boot', async () => {
    const releasePayload = {
      tag_name: 'v1.3.0',
      name: 'WaveForm 1.3.0',
      body: '- Improved audio engine\n- One-click updater',
      html_url: 'https://github.com/Trapston3/waveform-desktop/releases/tag/v1.3.0',
      published_at: '2026-11-24T12:00:00Z',
      assets: [
        {
          name: 'WaveForm-Setup-1.3.0.exe',
          browser_download_url: 'https://example.com/WaveForm-Setup-1.3.0.exe',
          size: 4096,
        },
        {
          name: 'SHA256SUMS.txt',
          browser_download_url: 'https://example.com/SHA256SUMS.txt',
          size: 120,
        },
      ],
    };

    const fetchRelease = async () => makeJsonResponse(releasePayload);

    const firstSession = createAppUpdaterController({
      currentVersion: '1.2.0',
      tempDir: tempRoot,
      fetchFn: fetchRelease,
    });
    const firstState = await firstSession.checkForUpdates(false);
    assert.equal(firstState.status, 'available');
    assert.equal(firstState.dismissedThisSession, false);

    const dismissed = firstSession.dismissForSession();
    assert.equal(dismissed.dismissedThisSession, true);
    assert.equal(firstSession.getState().dismissedThisSession, true);

    // Simulate a new cold boot with a fresh controller instance
    const secondSession = createAppUpdaterController({
      currentVersion: '1.2.0',
      tempDir: tempRoot,
      fetchFn: fetchRelease,
    });
    const secondState = await secondSession.checkForUpdates(false);
    assert.equal(secondState.status, 'available');
    assert.equal(secondState.dismissedThisSession, false);
  });

  test('Streaming download emits progress and aborts + deletes installer on SHA-256 mismatch', async () => {
    const chunkA = Buffer.alloc(1024, 0xaa);
    const chunkB = Buffer.alloc(1024, 0xbb);
    const wrongHash = 'f'.repeat(64);
    const observedStatuses = [];
    const progressEvents = [];
    let spawnCalled = false;
    let quitCalled = false;

    const controller = createAppUpdaterController({
      currentVersion: '1.2.0',
      tempDir: tempRoot,
      installDir: path.join(tempRoot, 'install'),
      spawnFn: () => {
        spawnCalled = true;
        return { unref() {} };
      },
      quitFn: () => {
        quitCalled = true;
      },
      onStateChange: (s) => {
        observedStatuses.push(s.status);
        if (s.status === 'downloading' && s.progress) {
          progressEvents.push(s.progress);
        }
      },
      fetchFn: async (url) => {
        if (url.endsWith('/releases/latest')) {
          return makeJsonResponse({
            tag_name: 'v1.3.0',
            name: 'WaveForm 1.3.0',
            assets: [
              {
                name: 'WaveForm-Setup-1.3.0.exe',
                browser_download_url: 'https://downloads.example.com/WaveForm-Setup-1.3.0.exe',
                size: 2048,
              },
              {
                name: 'SHA256SUMS.txt',
                browser_download_url: 'https://downloads.example.com/SHA256SUMS.txt',
                size: 90,
              },
            ],
          });
        }
        if (url.endsWith('WaveForm-Setup-1.3.0.exe')) {
          return makeChunkedBinaryResponse([chunkA, chunkB], 115);
        }
        if (url.endsWith('SHA256SUMS.txt')) {
          return new Response(`${wrongHash}  WaveForm-Setup-1.3.0.exe\n`, { status: 200 });
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await controller.checkForUpdates(true);
    const finalState = await controller.downloadAndInstall();

    assert.equal(finalState.status, 'error');
    assert.ok(finalState.error?.toLowerCase().includes('sha-256'));
    assert.equal(spawnCalled, false);
    assert.equal(quitCalled, false);
    assert.ok(progressEvents.length >= 2, 'Expected throttled streaming progress events');
    assert.equal(progressEvents.at(-1).percent, 100);
    assert.ok(observedStatuses.includes('verifying'));

    const downloadedPath = path.join(tempRoot, 'WaveForm-Update', 'WaveForm-Setup-1.3.0.exe');
    assert.equal(fs.existsSync(downloadedPath), false, 'Mismatched installer must be deleted');
  });

  test('Happy-path verify spawns detached silent NSIS installer + WaveForm relaunch and calls quitFn', async () => {
    const payload = Buffer.from('valid-waveform-nsis-installer-binary');
    const validHash = createHash('sha256').update(payload).digest('hex');
    const installDir = path.join(tempRoot, 'app');
    const spawnCalls = [];
    let unrefCalled = false;
    let quitCalled = false;
    const statuses = [];

    const controller = createAppUpdaterController({
      currentVersion: '1.2.0',
      tempDir: tempRoot,
      installDir,
      quitDelayMs: 30,
      spawnFn: (cmd, args, opts) => {
        spawnCalls.push({ cmd, args, opts });
        return {
          unref() {
            unrefCalled = true;
          },
        };
      },
      quitFn: () => {
        quitCalled = true;
      },
      onStateChange: (s) => statuses.push(s.status),
      fetchFn: async (url) => {
        if (url.endsWith('/releases/latest')) {
          return makeJsonResponse({
            tag_name: 'v1.4.0',
            name: 'WaveForm 1.4.0',
            assets: [
              {
                name: 'WaveForm-Setup-1.4.0.exe',
                browser_download_url: 'https://downloads.example.com/WaveForm-Setup-1.4.0.exe',
                size: payload.byteLength,
              },
              {
                name: 'SHA256SUMS.txt',
                browser_download_url: 'https://downloads.example.com/SHA256SUMS.txt',
                size: 90,
              },
            ],
          });
        }
        if (url.endsWith('WaveForm-Setup-1.4.0.exe')) {
          return makeChunkedBinaryResponse([payload]);
        }
        if (url.endsWith('SHA256SUMS.txt')) {
          return new Response(`${validHash}  WaveForm-Setup-1.4.0.exe\n`, { status: 200 });
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await controller.checkForUpdates(true);
    const result = await controller.downloadAndInstall();

    assert.equal(result.status, 'installing');
    assert.ok(statuses.includes('downloading'));
    assert.ok(statuses.includes('verifying'));
    assert.ok(statuses.includes('installing'));

    assert.equal(spawnCalls.length, 1);
    const call = spawnCalls[0];
    assert.equal(call.cmd, 'powershell.exe');
    assert.equal(call.opts.detached, true);
    assert.equal(call.opts.stdio, 'ignore');
    assert.equal(call.opts.windowsHide, true);
    const psCmd = call.args.join(' ');
    assert.ok(psCmd.includes("'/S'"));
    assert.ok(psCmd.includes('Start-Process'));
    assert.ok(psCmd.includes('WaveForm-Setup-1.4.0.exe'));
    assert.ok(psCmd.includes(path.join(installDir, 'WaveForm.exe')));
    assert.equal(unrefCalled, true);

    await new Promise((r) => setTimeout(r, 60));
    assert.equal(quitCalled, true);
  });

  test('initAppUpdaterIpc registers IPC handlers and pushes updater:state-changed', async () => {
    const handlers = new Map();
    const sent = [];
    const windowListeners = new Map();

    const controller = initAppUpdaterIpc({
      ipcMain: {
        handle: (ch, fn) => handlers.set(ch, fn),
        removeHandler: (ch) => handlers.delete(ch),
      },
      app: {
        getVersion: () => '1.2.0',
        quit: () => {},
        once: () => {},
      },
      shell: {
        openExternal: async () => {},
      },
      getMainWindow: () => ({
        isDestroyed: () => false,
        isVisible: () => false,
        once: (ev, fn) => windowListeners.set(ev, fn),
        webContents: {
          isDestroyed: () => false,
          send: (ch, payload) => sent.push({ ch, payload }),
        },
      }),
      tempDir: tempRoot,
      fetchFn: async () =>
        makeJsonResponse({
          tag_name: 'v1.5.0',
          assets: [
            {
              name: 'WaveForm-Setup-1.5.0.exe',
              browser_download_url: 'https://example.com/WaveForm-Setup-1.5.0.exe',
              size: 100,
            },
          ],
        }),
    });

    assert.ok(handlers.has('updater:check'));
    assert.ok(handlers.has('updater:downloadAndInstall'));
    assert.ok(handlers.has('updater:dismissForSession'));
    assert.ok(handlers.has('updater:getState'));
    assert.ok(handlers.has('updater:openReleasePage'));
    assert.ok(windowListeners.has('ready-to-show'));

    const checked = await handlers.get('updater:check')();
    assert.equal(checked.status, 'available');
    assert.equal(checked.latestVersion, '1.5.0');
    assert.ok(sent.some((m) => m.ch === 'updater:state-changed' && m.payload.status === 'available'));

    controller.dispose();
  });

  test('useUpdateStore, Tray sync, UpdatePromptModal, DesktopTitleBar, and SettingsModal render and wire cleanly', async () => {
    const trayCalls = [];
    let stateListener = null;
    let dismissedIpcCalled = false;

    globalThis.window.electronAPI = {
      setTrayBehavior: (cfg) => trayCalls.push(cfg),
      updaterGetState: async () => ({
        status: 'available',
        currentVersion: '1.2.0',
        latestVersion: '1.3.0',
        releaseName: 'WaveForm 1.3.0',
        releaseNotes: '## WaveForm v1.3.0\n### Highlights\n- **Updater**: Verified `original-fs` staging\n- Polished Markdown notes',
        releaseUrl: 'https://github.com/Trapston3/waveform-desktop/releases/tag/v1.3.0',
        publishedAt: '2026-11-24T12:00:00Z',
        assetName: 'WaveForm-Setup-1.3.0.exe',
        assetSize: 45 * 1024 * 1024,
        dismissedThisSession: false,
        progress: null,
        error: null,
        lastCheckedAt: Date.now(),
      }),
      updaterDismissForSession: async () => {
        dismissedIpcCalled = true;
        return { ...useUpdateStore.getState().state, dismissedThisSession: true };
      },
      onUpdaterStateChanged: (cb) => {
        stateListener = cb;
        return () => {
          stateListener = null;
        };
      },
    };

    await useSettingsStore.getState().resetToDefaults();
    await useSettingsStore.getState().updateSettings({
      'ui.minimizeToTray': false,
      'ui.closeToTray': true,
    });
    assert.deepEqual(trayCalls.at(-1), { minimizeToTray: false, closeToTray: true });

    await useUpdateStore.getState().initUpdater();
    assert.equal(useUpdateStore.getState().isModalOpen, true);

    const openModalHtml = renderToStaticMarkup(React.createElement(UpdatePromptModal));
    assert.ok(openModalHtml.includes('z-[80]'), `Unexpected openModalHtml: ${openModalHtml}`);
    assert.ok(openModalHtml.includes('liquid-glass-capsule'));
    assert.ok(openModalHtml.includes('v1.2.0'));
    assert.ok(openModalHtml.includes('v1.3.0'));
    assert.ok(openModalHtml.includes('One-Click Update Now'));
    assert.ok(openModalHtml.includes('Remind Me Next Launch'));
    assert.ok(openModalHtml.includes('View on GitHub'));
    assert.ok(openModalHtml.includes('<strong'));
    assert.ok(openModalHtml.includes('<code'));
    assert.ok(openModalHtml.includes('<ul'));
    assert.equal(openModalHtml.includes('## WaveForm'), false);
    assert.equal(openModalHtml.includes('**Updater**'), false);
    assert.equal(openModalHtml.includes('`original-fs`'), false);

    // Pill is hidden while modal is open
    const barWithOpenModal = renderToStaticMarkup(React.createElement(DesktopTitleBar));
    assert.equal(barWithOpenModal.includes('Update v1.3.0'), false);

    // Dismissing for session hides modal and reveals sleek titlebar pill
    await useUpdateStore.getState().dismissForSession();
    assert.equal(dismissedIpcCalled, true);
    assert.equal(useUpdateStore.getState().isModalOpen, false);
    assert.equal(useUpdateStore.getState().state.dismissedThisSession, true);

    const closedModalHtml = renderToStaticMarkup(React.createElement(UpdatePromptModal));
    assert.equal(closedModalHtml, '');

    const barWithClosedModal = renderToStaticMarkup(React.createElement(DesktopTitleBar));
    assert.ok(barWithClosedModal.includes('Update v1.3.0'));

    // Live progress push updates titlebar pill % and modal progress bar
    stateListener?.({
      ...useUpdateStore.getState().state,
      status: 'downloading',
      progress: {
        bytesDownloaded: 22.5 * 1024 * 1024,
        totalBytes: 45 * 1024 * 1024,
        percent: 50,
        bytesPerSecond: 5 * 1024 * 1024,
      },
    });
    const barDownloading = renderToStaticMarkup(React.createElement(DesktopTitleBar));
    assert.ok(barDownloading.includes('50%'));

    useUpdateStore.getState().openModal();
    const modalDownloading = renderToStaticMarkup(React.createElement(UpdatePromptModal));
    assert.ok(modalDownloading.includes('22.5 MB / 45.0 MB'));
    assert.ok(modalDownloading.includes('50%'));

    const settingsHtml = renderToStaticMarkup(
      React.createElement(SettingsModal, { isOpen: true, onClose: () => {} })
    );
    assert.ok(settingsHtml.includes('App Updates'));
  });

  test('Direct delta-file updater: manifest planning, binary upgrade fallback, per-file SHA-256 verification, and PowerShell applier', async () => {
    const hashOf = (s) => createHash('sha256').update(s).digest('hex');
    const localTsv = [
      'version\tsize\tsha256\trelPath',
      `1.3.0\t1000\t${hashOf('old-asar')}\tresources\\app.asar`,
      `1.3.0\t200\t${hashOf('same-dll')}\tWaveForm.exe`,
      `1.3.0\t50\t${hashOf('obsolete-file')}\tresources\\old-asset.txt`,
    ].join('\n');

    const remoteTsvResourcesOnly = [
      'version\tsize\tsha256\trelPath',
      `1.3.1\t1024\t${hashOf('new-asar-payload')}\tresources\\app.asar`,
      `1.3.1\t200\t${hashOf('same-dll')}\tWaveForm.exe`,
    ].join('\n');

    const localMap = parseInstallManifest(localTsv);
    const remoteResMap = parseInstallManifest(remoteTsvResourcesOnly);
    const deltaPlan = planDeltaUpdate(localMap, remoteResMap);
    assert.equal(deltaPlan.strategy, 'direct_patch');
    assert.equal(deltaPlan.requiresBinaryUpgrade, false);
    assert.deepEqual(deltaPlan.changedFiles, ['resources\\app.asar']);
    assert.deepEqual(deltaPlan.removedFiles, ['resources\\old-asset.txt']);

    // WaveForm.exe version-stamp hash diff alone must NOT force full_installer!
    const remoteExeOnlyDiffMap = parseInstallManifest([
      'version\tsize\tsha256\trelPath',
      `1.3.1\t1024\t${hashOf('new-asar-payload')}\tresources\\app.asar`,
      `1.3.1\t220\t${hashOf('new-exe-stamp')}\tWaveForm.exe`,
    ].join('\n'));
    const exeOnlyPlan = planDeltaUpdate(localMap, remoteExeOnlyDiffMap, {
      localElectronVersion: '30.5.1',
      remoteElectronVersion: '30.5.1',
    });
    assert.equal(exeOnlyPlan.strategy, 'direct_patch');
    assert.equal(exeOnlyPlan.requiresBinaryUpgrade, false);
    assert.deepEqual(exeOnlyPlan.changedFiles, ['resources\\app.asar']);

    // 3-column after-pack-manifest.mjs format parsing + Electron runtime DLL / electronVersion mismatch forces full_installer
    const tsv3Col = [
      '# version=1.3.4',
      '# electronVersion=31.0.0',
      `resources\\app.asar\t${hashOf('new-asar-payload')}\t1024`,
      `ffmpeg.dll\t${hashOf('new-ffmpeg')}\t900`,
      `WaveForm.exe\t${hashOf('new-exe-stamp')}\t220`,
    ].join('\n');
    const meta3Col = parseInstallManifestMeta(tsv3Col);
    assert.equal(meta3Col.version, '1.3.4');
    assert.equal(meta3Col.electronVersion, '31.0.0');
    assert.equal(meta3Col.entries.size, 3);
    const runtimeDiffPlan = planDeltaUpdate(localMap, meta3Col.entries, {
      localElectronVersion: '30.5.1',
      remoteElectronVersion: meta3Col.electronVersion,
    });
    assert.equal(runtimeDiffPlan.strategy, 'full_installer');
    assert.equal(runtimeDiffPlan.requiresBinaryUpgrade, true);

    // getInstalledAppVersion reads resources/app-version.json first so patched builds never loop
    const versionDir = path.join(tempRoot, 'versioned-install');
    fs.mkdirSync(path.join(versionDir, 'resources'), { recursive: true });
    fs.writeFileSync(
      path.join(versionDir, 'resources', 'app-version.json'),
      JSON.stringify({ version: '1.3.4', electronVersion: '30.5.1' })
    );
    assert.equal(getInstalledAppVersion(versionDir, '1.3.2'), '1.3.4');

    // Script asserts UAC probe, logging, full dir process cleanup, 12x retry, backup/rollback, DisplayVersion, and --updated-from
    const script = buildDirectPatchApplierScript({
      targetPid: 4242,
      installDir: 'C:\\Program Files\\WaveForm',
      stagingDir: 'C:\\Temp\\staging',
      updateDir: 'C:\\Temp\\WaveForm-Update',
      relaunchExePath: 'C:\\Program Files\\WaveForm\\WaveForm.exe',
      targetVersion: '1.3.4',
      fromVersion: '1.3.2',
      changedFiles: ['resources\\app.asar'],
      removedFiles: ['resources\\old-asset.txt'],
    });
    assert.ok(script.includes('Get-Process -Id $TargetPid'));
    assert.ok(script.includes('updater.log'));
    assert.ok(script.includes('-Verb RunAs'));
    assert.ok(script.includes('$attempt -lt 12'));
    assert.ok(script.includes('Start-Sleep -Milliseconds 500'));
    assert.ok(script.includes('DisplayVersion'));
    assert.ok(script.includes('BackupDir'));
    assert.ok(script.includes('--updated-from='));
    assert.equal(script.includes('/S'), false);

    // UpdatePromptModal renders "Updated to v..." toast when updatedFromVersion is set and modal is closed
    useUpdateStore.setState({
      isModalOpen: false,
      state: {
        ...useUpdateStore.getState().state,
        status: 'up-to-date',
        currentVersion: '1.3.4',
        updatedFromVersion: '1.3.2',
      },
    });
    const toastHtml = renderToStaticMarkup(React.createElement(UpdatePromptModal));
    assert.ok(toastHtml.includes('Updated to v1.3.4'));

    // Controller end-to-end direct patch run
    const installDir = path.join(tempRoot, 'install');
    fs.mkdirSync(path.join(installDir, 'resources'), { recursive: true });
    fs.writeFileSync(path.join(installDir, 'resources', 'install-manifest.tsv'), localTsv, 'utf-8');

    const patchZipBytes = Buffer.from('mock-zip-archive-bytes');
    const newAsarBytes = Buffer.from('new-asar-payload');
    const sums = `${hashOf(patchZipBytes)}  WaveForm-AppPatch-1.3.1.zip\n`;

    const spawnedCalls = [];
    let quitCalled = false;
    const ctrl = createAppUpdaterController({
      currentVersion: '1.3.0',
      tempDir: tempRoot,
      installDir,
      relaunchExePath: path.join(installDir, 'WaveForm.exe'),
      pid: 9999,
      quitDelayMs: 5,
      fetchFn: async (url) => {
        if (url.includes('releases/latest')) {
          return makeJsonResponse({
            tag_name: 'v1.3.1',
            name: 'WaveForm v1.3.1',
            body: 'Delta release test',
            assets: [
              { name: 'WaveForm-Setup-1.3.1.exe', browser_download_url: 'https://example.com/setup.exe', size: 90_000_000 },
              { name: 'WaveForm-AppPatch-1.3.1.zip', browser_download_url: 'https://example.com/patch.zip', size: patchZipBytes.byteLength },
              { name: 'install-manifest.tsv', browser_download_url: 'https://example.com/install-manifest.tsv', size: remoteTsvResourcesOnly.length },
              { name: 'SHA256SUMS.txt', browser_download_url: 'https://example.com/SHA256SUMS.txt', size: sums.length },
            ],
          });
        }
        if (url.endsWith('install-manifest.tsv')) return new Response(remoteTsvResourcesOnly, { status: 200 });
        if (url.endsWith('patch.zip')) return makeChunkedBinaryResponse([patchZipBytes]);
        if (url.endsWith('SHA256SUMS.txt')) return new Response(sums, { status: 200 });
        throw new Error(`Unexpected URL: ${url}`);
      },
      extractZipFn: async (_zipPath, stagingDir) => {
        fs.mkdirSync(path.join(stagingDir, 'resources'), { recursive: true });
        fs.writeFileSync(path.join(stagingDir, 'resources', 'app.asar'), newAsarBytes);
        fs.writeFileSync(path.join(stagingDir, 'resources', 'install-manifest.tsv'), remoteTsvResourcesOnly);
      },
      spawnFn: (cmd, args, opts) => {
        spawnedCalls.push({ cmd, args: [...args], opts });
        return { unref() {} };
      },
      quitFn: () => {
        quitCalled = true;
      },
    });

    const avail = await ctrl.checkForUpdates(true);
    assert.equal(avail.status, 'available');
    assert.equal(avail.updateStrategy, 'direct_patch');
    assert.equal(avail.assetName, 'WaveForm-AppPatch-1.3.1.zip');
    assert.equal(avail.deltaChangedCount, 1);

    const installed = await ctrl.downloadAndInstall();
    assert.equal(installed.status, 'installing');
    assert.equal(spawnedCalls.length, 1);
    assert.ok(spawnedCalls[0].cmd.toLowerCase().includes('powershell'));
    assert.ok(spawnedCalls[0].args.includes('-File'));
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(quitCalled, true);
  });
});
