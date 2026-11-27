import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';

const resolverHook = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && !specifier.endsWith('.ts') && !specifier.endsWith('.js') && !specifier.endsWith('.mjs')) {
      try {
        return await nextResolve(specifier + '.ts', context);
      } catch {}
      try {
        return await nextResolve(specifier + '/index.ts', context);
      } catch {}
    }
    throw err;
  }
}
`;
register(`data:text/javascript,${encodeURIComponent(resolverHook)}`, import.meta.url);

const { getPlatformBridge, hasPlatformBridge, setPlatformBridgeForTests } = await import(
  '../../src/platform/index.ts'
);

const ROOT = process.cwd();

after(() => {
  setPlatformBridgeForTests(null);
  if (globalThis.window?.electronAPI) {
    delete globalThis.window;
  }
});

function walkFiles(dir, exts) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, exts));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

test('PlatformBridge: zero raw electronAPI leaks outside src/platform and src/vite-env.d.ts', () => {
  const srcFiles = walkFiles(path.join(ROOT, 'src'), ['.ts', '.tsx']);
  const leaks = [];
  for (const filePath of srcFiles) {
    const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
    if (rel.startsWith('src/platform/') || rel === 'src/vite-env.d.ts') continue;
    const text = fs.readFileSync(filePath, 'utf8');
    if (text.includes('electronAPI')) {
      leaks.push(rel);
    }
  }
  assert.deepEqual(leaks, [], `Found raw electronAPI references outside src/platform/: ${leaks.join(', ')}`);
});

test('PlatformBridge: safe headless fallbacks and mock override work cleanly', async () => {
  setPlatformBridgeForTests(null);
  assert.equal(hasPlatformBridge(), false);
  const headless = getPlatformBridge();
  assert.equal(headless.isDesktop, false);
  assert.equal(await headless.isMaximized(), false);
  assert.equal(await headless.lvGetLyricsCache('missing'), null);
  assert.deepEqual(await headless.replayLoad(), { version: 1, entries: [] });

  let calledWith = null;
  setPlatformBridgeForTests({
    platform: 'win32',
    lvGetLyricsCache: async (songKey) => {
      calledWith = songKey;
      return { lines: [] };
    },
  });

  assert.equal(hasPlatformBridge(), true);
  assert.equal(hasPlatformBridge('lvGetLyricsCache'), true);
  assert.equal(hasPlatformBridge('scrobbleConfigure'), false);
  const cached = await getPlatformBridge().lvGetLyricsCache('song-123');
  assert.equal(calledWith, 'song-123');
  assert.deepEqual(cached, { lines: [] });
});

test('Cargo workspace split: waveform-core has zero N-API dependencies and waveform-napi exports cdylib', () => {
  const rootCargo = fs.readFileSync(path.join(ROOT, 'native', 'Cargo.toml'), 'utf8');
  assert.match(rootCargo, /"waveform-core"/);
  assert.match(rootCargo, /"waveform-napi"/);

  const coreCargo = fs.readFileSync(path.join(ROOT, 'native', 'waveform-core', 'Cargo.toml'), 'utf8');
  assert.ok(!coreCargo.includes('napi'), 'native/waveform-core/Cargo.toml must not depend on napi');
  assert.match(coreCargo, /crate-type\s*=\s*\["rlib"\]/);

  const coreRsFiles = walkFiles(path.join(ROOT, 'native', 'waveform-core', 'src'), ['.rs']);
  for (const rsFile of coreRsFiles) {
    const content = fs.readFileSync(rsFile, 'utf8');
    assert.ok(!content.includes('napi'), `${path.basename(rsFile)} must not import napi`);
  }

  const napiCargo = fs.readFileSync(path.join(ROOT, 'native', 'waveform-napi', 'Cargo.toml'), 'utf8');
  assert.match(napiCargo, /crate-type\s*=\s*\["cdylib"\]/);
  assert.match(napiCargo, /waveform-core\s*=\s*\{\s*path\s*=\s*"\.\.\/waveform-core"\s*\}/);

  const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(gitignore, /native\/target\//);
});

test('Fonts diet: SF Pro Display ships as WOFF2 with zero legacy OTF files', () => {
  const fontsDir = path.join(ROOT, 'src', 'assets', 'fonts');
  const entries = fs.readdirSync(fontsDir);
  const otfFiles = entries.filter((f) => f.endsWith('.otf'));
  assert.deepEqual(otfFiles, [], `Legacy .otf fonts still present: ${otfFiles.join(', ')}`);

  for (const weight of ['regular', 'medium', 'semibold', 'bold', 'heavy']) {
    const name = `sf_pro_display_${weight}.woff2`;
    const filePath = path.join(fontsDir, name);
    assert.ok(fs.existsSync(filePath), `Missing ${name}`);
    const header = fs.readFileSync(filePath).subarray(0, 4).toString('ascii');
    assert.equal(header, 'wOF2', `${name} must have valid wOF2 header`);
  }
});
