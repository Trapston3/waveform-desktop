// tests/unit/installer_diff_manifest.test.mjs
// Unit tests for build-time install-manifest.tsv generation & changed-files-only diff classification.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  compareSemVer,
  computeFileSha256,
  diffInstallManifests,
  generateInstallManifest,
  parseInstallManifest,
} from '../../scripts/after-pack-manifest.mjs';

describe('Windows NSIS Install Manifest & Diff Engine', () => {
  test('generateInstallManifest produces deterministic sorted SHA-256 + size entries and excludes manifest/uninstaller', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'waveform-manifest-'));
    try {
      fs.mkdirSync(path.join(tmpRoot, 'resources', 'assets', 'data'), { recursive: true });
      fs.writeFileSync(path.join(tmpRoot, 'WaveForm.exe'), 'exe-binary-payload');
      fs.writeFileSync(path.join(tmpRoot, 'resources', 'app.asar'), 'asar-payload-v1');
      fs.writeFileSync(path.join(tmpRoot, 'resources', 'assets', 'data', 'auto_eq.db'), 'sqlite-db-bytes');
      // Excluded files:
      fs.writeFileSync(path.join(tmpRoot, 'resources', 'install-manifest.tsv'), 'stale-manifest');
      fs.writeFileSync(path.join(tmpRoot, 'Uninstall WaveForm.exe'), 'uninstaller');

      const { version, entries, manifestText } = generateInstallManifest(tmpRoot, '1.2.0');
      assert.equal(version, '1.2.0');
      assert.equal(entries.length, 3);
      assert.deepEqual(
        entries.map((e) => e.relPath),
        ['resources\\app.asar', 'resources\\assets\\data\\auto_eq.db', 'WaveForm.exe']
      );

      const parsed = parseInstallManifest(manifestText);
      assert.equal(parsed.version, '1.2.0');
      assert.equal(parsed.entries.size, 3);
      assert.equal(parsed.entries.get('resources\\app.asar').size, Buffer.byteLength('asar-payload-v1'));
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test('diffInstallManifests accurately classifies unchanged, modified, added, corrupted/missing-on-disk, obsolete, and legacy fallback', () => {
    const tmpInstall = fs.mkdtempSync(path.join(os.tmpdir(), 'waveform-diff-'));
    try {
      fs.mkdirSync(path.join(tmpInstall, 'resources', 'assets', 'data'), { recursive: true });
      fs.writeFileSync(path.join(tmpInstall, 'resources', 'assets', 'data', 'auto_eq.db'), 'unchanged-db');
      fs.writeFileSync(path.join(tmpInstall, 'resources', 'app.asar'), 'old-asar-v1');
      fs.writeFileSync(path.join(tmpInstall, 'resources', 'corrupted.bin'), 'corrupted-size-mismatch-bytes');
      fs.writeFileSync(path.join(tmpInstall, 'resources', 'obsolete.dll'), 'to-be-removed');

      const dbHash = computeFileSha256(path.join(tmpInstall, 'resources', 'assets', 'data', 'auto_eq.db'));
      const oldAsarHash = computeFileSha256(path.join(tmpInstall, 'resources', 'app.asar'));
      const corruptExpectedHash = 'a'.repeat(64);
      const missingHash = 'b'.repeat(64);
      const newAsarHash = 'c'.repeat(64);
      const addedHash = 'd'.repeat(64);
      const obsoleteHash = 'e'.repeat(64);

      const oldEntries = new Map([
        ['resources\\assets\\data\\auto_eq.db', { sha256: dbHash.sha256, size: dbHash.size }],
        ['resources\\app.asar', { sha256: oldAsarHash.sha256, size: oldAsarHash.size }],
        ['resources\\corrupted.bin', { sha256: corruptExpectedHash, size: 12 }],
        ['resources\\missing.dll', { sha256: missingHash, size: 10 }],
        ['resources\\obsolete.dll', { sha256: obsoleteHash, size: 13 }],
      ]);

      const newEntries = new Map([
        ['resources\\assets\\data\\auto_eq.db', { sha256: dbHash.sha256, size: dbHash.size }],
        ['resources\\app.asar', { sha256: newAsarHash, size: 22 }],
        ['resources\\corrupted.bin', { sha256: corruptExpectedHash, size: 12 }],
        ['resources\\missing.dll', { sha256: missingHash, size: 10 }],
        ['resources\\added.node', { sha256: addedHash, size: 42 }],
      ]);

      const diskInspector = (relPath) => {
        const full = path.join(tmpInstall, relPath);
        if (!fs.existsSync(full)) return { exists: false };
        const stat = fs.statSync(full);
        return { exists: true, size: stat.size };
      };

      const diff = diffInstallManifests(newEntries, oldEntries, diskInspector);
      assert.deepEqual(diff.unchanged, ['resources\\assets\\data\\auto_eq.db']);
      assert.deepEqual(diff.changed, [
        'resources\\added.node',
        'resources\\app.asar',
        'resources\\corrupted.bin',
        'resources\\missing.dll',
      ]);
      assert.deepEqual(diff.removed, ['resources\\obsolete.dll']);

      // Legacy first-time upgrade fallback (oldEntries === null): hashes disk directly
      const legacyInspector = (relPath) => {
        const full = path.join(tmpInstall, relPath);
        if (!fs.existsSync(full)) return { exists: false };
        return { exists: true, ...computeFileSha256(full) };
      };
      const legacyDiff = diffInstallManifests(newEntries, null, legacyInspector);
      assert.deepEqual(legacyDiff.unchanged, ['resources\\assets\\data\\auto_eq.db']);
      assert.ok(legacyDiff.changed.includes('resources\\app.asar'));
      assert.ok(legacyDiff.changed.includes('resources\\added.node'));
      assert.equal(legacyDiff.removed.length, 0);
    } finally {
      fs.rmSync(tmpInstall, { recursive: true, force: true });
    }
  });

  test('compareSemVer accurately orders installed vs installer versions (1.1.0 < 1.2.0, 1.2.0 == 1.2.0, 1.3.0 > 1.2.0)', () => {
    assert.equal(compareSemVer('1.1.0', '1.2.0'), -1);
    assert.equal(compareSemVer('1.2.0', '1.2.0'), 0);
    assert.equal(compareSemVer('1.3.0', '1.2.0'), 1);
    assert.equal(compareSemVer('v1.2.0', '1.2.0'), 0);
    assert.equal(compareSemVer('v1.2.1-beta.1', '1.2.0'), 1);
    assert.equal(compareSemVer('2.0.0', '1.9.9'), 1);

    const nshSrc = fs.readFileSync(path.resolve('build/installer.nsh'), 'utf8');
    assert.ok(nshSrc.includes('CompareSemVer'), 'installer.nsh must define CompareSemVer');
    assert.ok(nshSrc.includes('Already Up to Date'), 'installer.nsh must handle Already Up to Date UI');
    assert.ok(nshSrc.includes('Repair / Verify installation'), 'installer.nsh must offer Repair / Verify installation');
    assert.ok(nshSrc.includes('Newer Version Already Installed'), 'installer.nsh must handle downgrade protection');
    assert.ok(nshSrc.includes('api.github.com/repos/Trapston3/waveform-desktop/releases/latest'), 'installer.nsh must include non-blocking GitHub latest release check');
  });
});
