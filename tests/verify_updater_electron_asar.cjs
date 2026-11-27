// tests/verify_updater_electron_asar.cjs
// Real Electron-runtime test verifying appUpdater handles .asar binaries cleanly via original-fs.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

if (!process.versions.electron) {
  const electronBinary = require('electron');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const res = spawnSync(electronBinary, [__filename], { env, stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

function buildMinimalAsarBuffer(fileName, contentStr) {
  const fileBuf = Buffer.from(contentStr, 'utf8');
  const headerJson = Buffer.from(
    JSON.stringify({
      files: {
        [fileName]: { size: fileBuf.byteLength, offset: '0' },
      },
    }),
    'utf8'
  );
  const alignedHeaderLen = Math.ceil(headerJson.byteLength / 4) * 4;
  const headerPadded = Buffer.alloc(alignedHeaderLen, 0);
  headerJson.copy(headerPadded);

  const pickle = Buffer.alloc(16 + alignedHeaderLen);
  pickle.writeUInt32LE(4, 0);
  pickle.writeUInt32LE(8 + alignedHeaderLen, 4);
  pickle.writeUInt32LE(4 + alignedHeaderLen, 8);
  pickle.writeUInt32LE(headerJson.byteLength, 12);
  headerPadded.copy(pickle, 16);

  return Buffer.concat([pickle, fileBuf]);
}

async function runInElectron() {
  const { app } = require('electron');
  const rootDir = path.resolve(__dirname, '..');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-electron-asar-test-'));

  try {
    const {
      getRawFs,
      computeFileSha256,
      verifyFileSha256,
      createAppUpdaterController,
    } = await import(pathToFileURL(path.join(rootDir, 'dist-electron', 'appUpdater.js')).href);

    const rawFs = getRawFs();
    assert.notEqual(rawFs, fs, 'Inside Electron, getRawFs() must return original-fs rather than patched fs');

    const updateDir = path.join(tmpRoot, 'WaveForm-Update');
    const stagingDir = path.join(updateDir, 'staging');
    const resourcesDir = path.join(stagingDir, 'resources');
    const asarPath = path.join(resourcesDir, 'app.asar');
    const probeAsarPath = path.join(tmpRoot, 'patched-probe.asar');
    rawFs.mkdirSync(resourcesDir, { recursive: true });

    const asarBytes = buildMinimalAsarBuffer('hello.txt', 'waveform-asar-ok');
    rawFs.writeFileSync(asarPath, asarBytes);
    rawFs.writeFileSync(probeAsarPath, asarBytes);

    // Confirm Electron patched fs intercepts .asar paths while original-fs sees the real binary file
    assert.throws(
      () => fs.readFileSync(probeAsarPath),
      /asar|ENOENT|Invalid/i,
      'Patched fs should reject reading raw app.asar binary directly'
    );
    assert.equal(rawFs.existsSync(asarPath), true);
    assert.equal(rawFs.statSync(asarPath).isFile(), true);

    const expectedSha = createHash('sha256').update(asarBytes).digest('hex');
    assert.equal(await computeFileSha256(asarPath), expectedSha);
    assert.equal(await verifyFileSha256(asarPath, expectedSha), true);

    // Exercise end-to-end controller direct_patch staging and verification inside real Electron
    const installDir = path.join(tmpRoot, 'install');
    rawFs.mkdirSync(path.join(installDir, 'resources'), { recursive: true });
    rawFs.writeFileSync(
      path.join(installDir, 'resources', 'install-manifest.tsv'),
      `resources\\app.asar\t${'0'.repeat(64)}\t10\n`,
      'utf8'
    );

    const patchBytes = Buffer.from('mock-patch-zip-bytes');
    const patchSha = createHash('sha256').update(patchBytes).digest('hex');
    const remoteTsv = [
      '# version=1.3.5',
      `resources\\app.asar\t${expectedSha}\t${asarBytes.byteLength}`,
    ].join('\n');

    const controller = createAppUpdaterController({
      currentVersion: '1.3.4',
      isPortable: false,
      tempDir: tmpRoot,
      installDir,
      quitDelayMs: 5,
      fetchFn: async (url) => {
        if (url.endsWith('/releases/latest')) {
          return new Response(
            JSON.stringify({
              tag_name: 'v1.3.5',
              name: 'WaveForm v1.3.5',
              body: '## Fixes\n- **Updater**: Electron `original-fs` ASAR fix',
              assets: [
                {
                  name: 'WaveForm-AppPatch-1.3.5.zip',
                  browser_download_url: 'https://example.com/WaveForm-AppPatch-1.3.5.zip',
                  size: patchBytes.byteLength,
                },
                {
                  name: 'install-manifest.tsv',
                  browser_download_url: 'https://example.com/install-manifest.tsv',
                  size: remoteTsv.length,
                },
                {
                  name: 'SHA256SUMS.txt',
                  browser_download_url: 'https://example.com/SHA256SUMS.txt',
                  size: 120,
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        if (url.endsWith('install-manifest.tsv')) return new Response(remoteTsv, { status: 200 });
        if (url.endsWith('WaveForm-AppPatch-1.3.5.zip')) return new Response(patchBytes, { status: 200 });
        if (url.endsWith('SHA256SUMS.txt')) {
          return new Response(`${patchSha}  WaveForm-AppPatch-1.3.5.zip\n`, { status: 200 });
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
      extractZipFn: async (_zipPath, destDir) => {
        const destRes = path.join(destDir, 'resources');
        rawFs.mkdirSync(destRes, { recursive: true });
        rawFs.writeFileSync(path.join(destRes, 'app.asar'), asarBytes);
      },
      spawnFn: () => ({ unref() {} }),
      quitFn: () => {},
    });

    const avail = await controller.checkForUpdates(true);
    assert.equal(avail.status, 'available');
    assert.equal(avail.updateStrategy, 'direct_patch');

    const installed = await controller.downloadAndInstall();
    assert.equal(installed.status, 'installing', `Unexpected error: ${installed.error}`);
    assert.equal(installed.error, null);
    assert.equal(rawFs.existsSync(path.join(updateDir, 'apply-patch.ps1')), true);

    await rawFs.promises.rm(updateDir, { recursive: true, force: true });
    assert.equal(rawFs.existsSync(updateDir), false, 'Recursive staging cleanup must remove app.asar');

    console.log('[PASS] Electron runtime ASAR staging, SHA-256 verification, and cleanup via original-fs');
  } finally {
    try {
      const cleanFs = require('original-fs');
      cleanFs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
    if (app && typeof app.exit === 'function') {
      app.exit(0);
    }
  }
}

runInElectron().catch((err) => {
  console.error('[FAIL] verify_updater_electron_asar:', err);
  try {
    require('electron').app?.exit(1);
  } catch {}
  process.exit(1);
});
