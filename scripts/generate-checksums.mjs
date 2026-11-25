// scripts/generate-checksums.mjs
// Generates release/SHA256SUMS.txt for all Windows .exe artifacts in release/
// and ensures release/latest.yml is present with accurate SHA-512 base64 + byte size metadata.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const releaseDir = path.resolve(rootDir, 'release');
const pkgPath = path.resolve(rootDir, 'package.json');

function computeHashes(filePath) {
  const buf = fs.readFileSync(filePath);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const sha512 = createHash('sha512').update(buf).digest('base64');
  return {
    sha256,
    sha512,
    size: buf.byteLength,
  };
}

function main() {
  if (!fs.existsSync(releaseDir)) {
    console.error(`[generate-checksums] Release directory not found: ${releaseDir}`);
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const version = pkg.version || '1.0.0';

  const entries = fs.readdirSync(releaseDir, { withFileTypes: true });
  const exeFiles = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.exe') && !e.name.includes('__uninstaller'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));

  const checksumTargets = entries
    .filter((e) => {
      if (!e.isFile()) return false;
      const lower = e.name.toLowerCase();
      if (lower.endsWith('.exe') && !e.name.includes('__uninstaller')) return true;
      if (lower.endsWith('.msi')) return true;
      if (/^waveform-apppatch-.*\.zip$/i.test(e.name)) return true;
      if (lower === 'install-manifest.tsv') return true;
      return false;
    })
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));

  if (checksumTargets.length === 0) {
    console.error(`[generate-checksums] No release artifacts found in ${releaseDir}`);
    process.exit(1);
  }

  const sha256Lines = [];
  const metadataByFile = new Map();

  for (const fileName of checksumTargets) {
    const fullPath = path.join(releaseDir, fileName);
    const info = computeHashes(fullPath);
    metadataByFile.set(fileName, info);
    sha256Lines.push(`${info.sha256}  ${fileName}`);
    console.log(`[generate-checksums] ${fileName} (${(info.size / (1024 * 1024)).toFixed(2)} MB)`);
    console.log(`  SHA-256: ${info.sha256}`);
  }

  const sha256SumsPath = path.join(releaseDir, 'SHA256SUMS.txt');
  fs.writeFileSync(sha256SumsPath, `${sha256Lines.join('\n')}\n`, 'utf-8');
  console.log(`[generate-checksums] Wrote ${sha256SumsPath}`);

  const latestYmlPath = path.join(releaseDir, 'latest.yml');
  if (!fs.existsSync(latestYmlPath)) {
    const preferredSetup =
      exeFiles.find((name) => name.toLowerCase().startsWith('waveform-setup-')) || exeFiles[0];
    const primaryInfo = metadataByFile.get(preferredSetup);
    const releaseDate = new Date().toISOString();

    const latestYml = [
      `version: ${version}`,
      `files:`,
      `  - url: ${preferredSetup}`,
      `    sha512: ${primaryInfo.sha512}`,
      `    size: ${primaryInfo.size}`,
      `path: ${preferredSetup}`,
      `sha512: ${primaryInfo.sha512}`,
      `releaseDate: '${releaseDate}'`,
      '',
    ].join('\n');

    fs.writeFileSync(latestYmlPath, latestYml, 'utf-8');
    console.log(`[generate-checksums] Generated ${latestYmlPath} for ${preferredSetup}`);
  } else {
    console.log(`[generate-checksums] Verified existing ${latestYmlPath}`);
  }

  const scoopManifestPath = path.resolve(rootDir, 'packaging/scoop/waveform.json');
  const portableExe = exeFiles.find((name) => name.toLowerCase().startsWith('waveform-portable-'));
  if (fs.existsSync(scoopManifestPath) && portableExe) {
    try {
      const portableInfo = metadataByFile.get(portableExe);
      const manifest = JSON.parse(fs.readFileSync(scoopManifestPath, 'utf-8'));
      manifest.version = version;
      if (manifest.architecture?.['64bit']) {
        manifest.architecture['64bit'].url = `https://github.com/trapston3/waveform-desktop/releases/download/v${version}/${portableExe}#/WaveForm.exe`;
        manifest.architecture['64bit'].hash = portableInfo.sha256;
      }
      fs.writeFileSync(scoopManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
      console.log(`[generate-checksums] Synced SHA-256 into ${scoopManifestPath}`);
    } catch (err) {
      console.warn(`[generate-checksums] Skipped Scoop manifest hash sync:`, err);
    }
  }
}

main();
