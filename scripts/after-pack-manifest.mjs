// scripts/after-pack-manifest.mjs
// electron-builder afterPack hook + pure manifest generation & diff utilities.
// Generates deterministic SHA-256 install-manifest.tsv in <appOutDir>/resources/install-manifest.tsv
// and stages build/install-manifest.tsv + build/7za.exe for NSIS selective updates.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function normalizeWinRelPath(relPath) {
  return relPath.replace(/\//g, '\\').replace(/^\\+/, '');
}

/**
 * Compares two SemVer strings (e.g. "1.1.0" vs "v1.2.0").
 * Returns -1 if a < b, 0 if a === b, 1 if a > b.
 */
export function compareSemVer(a, b) {
  const parse = (v) => {
    const cleaned = String(v || '')
      .trim()
      .replace(/^v/i, '')
      .split('-')[0];
    const parts = cleaned.split('.').map((n) => {
      const parsed = parseInt(n, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    });
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

function shouldExcludeManifestPath(relPath) {
  const lower = relPath.toLowerCase();
  if (lower === 'resources\\install-manifest.tsv') return true;
  if (lower === 'resources\\app-version.json') return true;
  if (/^uninstall\s+.*\.exe$/i.test(relPath)) return true;
  if (lower === 'uninstallericon.ico') return true;
  return false;
}

function readPackagedElectronVersion() {
  try {
    const pkgPath = path.join(rootDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const raw = pkg?.devDependencies?.electron || pkg?.dependencies?.electron;
    if (typeof raw === 'string' && raw.trim()) {
      return raw.trim().replace(/^[\^~>=<\s]+/, '');
    }
  } catch {
    // Fallback below
  }
  return process.versions?.electron || null;
}

function walkFilesSorted(dirPath, baseDir = dirPath, out = []) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkFilesSorted(fullPath, baseDir, out);
    } else if (entry.isFile()) {
      const rel = normalizeWinRelPath(path.relative(baseDir, fullPath));
      if (!shouldExcludeManifestPath(rel)) {
        out.push({ relPath: rel, fullPath });
      }
    }
  }
  return out;
}

export function computeFileSha256(filePath) {
  const buf = fs.readFileSync(filePath);
  return {
    sha256: createHash('sha256').update(buf).digest('hex'),
    size: buf.byteLength,
  };
}

/**
 * Generates a deterministic sorted TSV manifest for all packaged files in appOutDir.
 */
export function generateInstallManifest(appOutDir, version = '1.0.0', electronVersion = null) {
  const files = walkFilesSorted(appOutDir);
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));

  const entries = [];
  const lines = [`# version=${version}`];
  if (electronVersion) {
    lines.push(`# electronVersion=${electronVersion}`);
  }

  for (const f of files) {
    const { sha256, size } = computeFileSha256(f.fullPath);
    entries.push({ relPath: f.relPath, sha256, size });
    lines.push(`${f.relPath}\t${sha256}\t${size}`);
  }

  return {
    version,
    electronVersion,
    entries,
    manifestText: `${lines.join('\n')}\n`,
  };
}

/**
 * Parses an install-manifest.tsv string into { version, electronVersion, entries: Map<relPath, { sha256, size }> }.
 */
export function parseInstallManifest(tsvText) {
  const entries = new Map();
  let version = '';
  let electronVersion = null;
  if (!tsvText || typeof tsvText !== 'string') {
    return { version, electronVersion, entries };
  }
  const lines = tsvText.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const vm = /^#\s*version=(.+)$/i.exec(line);
      if (vm) version = vm[1].trim();
      const em = /^#\s*electronVersion=(.+)$/i.exec(line);
      if (em) electronVersion = em[1].trim();
      continue;
    }
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const relPath = normalizeWinRelPath(parts[0].trim());
    const sha256 = parts[1].trim().toLowerCase();
    const size = Number(parts[2].trim());
    if (!relPath || !/^[a-f0-9]{64}$/.test(sha256) || !Number.isFinite(size)) continue;
    entries.set(relPath, { sha256, size });
  }
  return { version, electronVersion, entries };
}

/**
 * Computes exact unchanged, changed/added, and obsolete file lists.
 * If oldEntries is null (upgrading from a legacy build without install-manifest.tsv),
 * falls back to inspecting/hashing existing files on disk via diskInspector(relPath).
 */
export function diffInstallManifests(newEntries, oldEntries, diskInspector) {
  const unchanged = [];
  const changed = [];
  const removed = [];

  const newMap =
    newEntries instanceof Map
      ? newEntries
      : new Map(newEntries.map((e) => [normalizeWinRelPath(e.relPath), { sha256: e.sha256, size: e.size }]));

  for (const [relPath, newMeta] of newMap.entries()) {
    const diskInfo = typeof diskInspector === 'function' ? diskInspector(relPath) : null;
    if (oldEntries && oldEntries.size > 0) {
      const oldMeta = oldEntries.get(relPath);
      if (
        oldMeta &&
        oldMeta.sha256 === newMeta.sha256 &&
        oldMeta.size === newMeta.size &&
        diskInfo &&
        diskInfo.exists &&
        diskInfo.size === newMeta.size
      ) {
        unchanged.push(relPath);
      } else {
        changed.push(relPath);
      }
    } else {
      // Legacy upgrade without prior manifest: hash file on disk directly
      if (
        diskInfo &&
        diskInfo.exists &&
        diskInfo.size === newMeta.size &&
        diskInfo.sha256 &&
        diskInfo.sha256.toLowerCase() === newMeta.sha256.toLowerCase()
      ) {
        unchanged.push(relPath);
      } else {
        changed.push(relPath);
      }
    }
  }

  if (oldEntries && oldEntries.size > 0) {
    for (const oldRelPath of oldEntries.keys()) {
      if (!newMap.has(oldRelPath) && !shouldExcludeManifestPath(oldRelPath)) {
        removed.push(oldRelPath);
      }
    }
  }

  unchanged.sort((a, b) => a.localeCompare(b));
  changed.sort((a, b) => a.localeCompare(b));
  removed.sort((a, b) => a.localeCompare(b));

  return { unchanged, changed, removed };
}

function findBundled7zaExe() {
  const candidates = [
    path.join(rootDir, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe'),
    path.join(rootDir, 'node_modules', 'app-builder-lib', 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const cacheBase = path.join(localAppData, 'electron-builder', 'Cache');
  if (fs.existsSync(cacheBase)) {
    const dirs = fs.readdirSync(cacheBase, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.startsWith('7zip'));
    for (const d of dirs) {
      const subDir = path.join(cacheBase, d.name);
      const nested = fs.readdirSync(subDir, { withFileTypes: true });
      for (const n of nested) {
        const exe = path.join(subDir, n.name, 'bin', '7za.exe');
        if (fs.existsSync(exe)) return exe;
      }
      const directExe = path.join(subDir, 'bin', '7za.exe');
      if (fs.existsSync(directExe)) return directExe;
    }
  }
  return null;
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const appOutDir = context.appOutDir;
  const version = context.packager?.appInfo?.version || '1.0.0';
  const electronVersion = readPackagedElectronVersion();
  const resourcesDir = path.join(appOutDir, 'resources');
  fs.mkdirSync(resourcesDir, { recursive: true });

  const appVersionPath = path.join(resourcesDir, 'app-version.json');
  fs.writeFileSync(
    appVersionPath,
    JSON.stringify(
      {
        version,
        electronVersion,
        builtAt: new Date().toISOString(),
      },
      null,
      2
    ) + '\n',
    'utf-8'
  );

  const { entries, manifestText } = generateInstallManifest(appOutDir, version, electronVersion);
  const outManifestPath = path.join(resourcesDir, 'install-manifest.tsv');
  fs.writeFileSync(outManifestPath, manifestText, 'utf-8');

  const buildDir = path.join(rootDir, 'build');
  fs.mkdirSync(buildDir, { recursive: true });
  fs.writeFileSync(path.join(buildDir, 'install-manifest.tsv'), manifestText, 'utf-8');

  const releaseDir = path.join(rootDir, 'release');
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(path.join(releaseDir, 'install-manifest.tsv'), manifestText, 'utf-8');

  const sevenZa = findBundled7zaExe();
  if (sevenZa) {
    fs.copyFileSync(sevenZa, path.join(buildDir, '7za.exe'));
    console.log(`[after-pack-manifest] Staged 7za.exe from ${sevenZa}`);
  } else {
    console.warn('[after-pack-manifest] Warning: 7za.exe not found; NSIS selective update will use full fallback.');
  }

  // Build compact WaveForm-AppPatch-<version>.zip containing resources/** + app-version.json + install-manifest.tsv for direct delta updates
  const patchZipPath = path.join(releaseDir, `WaveForm-AppPatch-${version}.zip`);
  try {
    fs.rmSync(patchZipPath, { force: true });
  } catch {}

  const patchTargets = [];
  if (fs.existsSync(path.join(resourcesDir, 'app.asar'))) {
    patchTargets.push(path.join('resources', 'app.asar'));
  }
  if (fs.existsSync(path.join(resourcesDir, 'app.asar.unpacked'))) {
    patchTargets.push(path.join('resources', 'app.asar.unpacked'));
  }
  if (fs.existsSync(appVersionPath)) {
    patchTargets.push(path.join('resources', 'app-version.json'));
  }
  if (fs.existsSync(outManifestPath)) {
    patchTargets.push(path.join('resources', 'install-manifest.tsv'));
  }

  if (patchTargets.length > 0) {
    if (sevenZa) {
      const res = spawnSync(
        sevenZa,
        ['a', '-tzip', '-mx=5', patchZipPath, ...patchTargets],
        { cwd: appOutDir, stdio: 'pipe' }
      );
      if (res.status === 0 && fs.existsSync(patchZipPath)) {
        const sizeMb = (fs.statSync(patchZipPath).size / (1024 * 1024)).toFixed(2);
        console.log(`[after-pack-manifest] Created ${patchZipPath} (${sizeMb} MB)`);
      } else {
        console.warn(`[after-pack-manifest] 7za patch zip failed (exit ${res.status}): ${res.stderr?.toString() || ''}`);
      }
    } else {
      const quotedTargets = patchTargets.map((t) => `'${t.replace(/'/g, "''")}'`).join(', ');
      const psCmd = `Compress-Archive -Path ${quotedTargets} -DestinationPath '${patchZipPath.replace(/'/g, "''")}' -Force`;
      spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCmd], {
        cwd: appOutDir,
        stdio: 'pipe',
      });
    }
  }

  console.log(
    `[after-pack-manifest] Wrote ${entries.length} manifest entries (v${version}) to ${outManifestPath}`
  );
}
