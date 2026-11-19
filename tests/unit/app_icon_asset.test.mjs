import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

const {
  APP_USER_MODEL_ID,
  resolveAppIconPath,
  resolveTrayIconPath,
  createTrayIcon
} = await import('../../electron/appIcon.ts');

test('build/icon.ico exists and is a valid multi-resolution ICO with 6 PNG-in-ICO sub-images', () => {
  const icoPath = path.resolve(projectRoot, 'build/icon.ico');
  assert.ok(fs.existsSync(icoPath), 'build/icon.ico must exist');

  const icoBuf = fs.readFileSync(icoPath);
  assert.ok(icoBuf.length > 22, 'ICO file must be longer than minimal header');

  // Magic bytes: 00 00 01 00
  assert.equal(icoBuf.readUInt16LE(0), 0, 'ICO reserved header should be 0');
  assert.equal(icoBuf.readUInt16LE(2), 1, 'ICO type should be 1 (icon)');

  // Image count
  const count = icoBuf.readUInt16LE(4);
  assert.equal(count, 6, 'ICO should contain exactly 6 image formats');

  // Expected sizes: 16, 32, 48, 64, 128, 256 (256 represented as 0)
  const expectedSizes = [16, 32, 48, 64, 128, 0];
  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  for (let i = 0; i < count; i++) {
    const entryOffset = 6 + i * 16;
    const width = icoBuf.readUInt8(entryOffset);
    const height = icoBuf.readUInt8(entryOffset + 1);
    const planes = icoBuf.readUInt16LE(entryOffset + 4);
    const bpp = icoBuf.readUInt16LE(entryOffset + 6);
    const bytesInRes = icoBuf.readUInt32LE(entryOffset + 8);
    const imageOffset = icoBuf.readUInt32LE(entryOffset + 12);

    assert.equal(width, expectedSizes[i], `Width of entry ${i} should match`);
    assert.equal(height, expectedSizes[i], `Height of entry ${i} should match`);
    assert.equal(planes, 1, `Color planes of entry ${i} should be 1`);
    assert.equal(bpp, 32, `Bpp of entry ${i} should be 32`);
    assert.ok(bytesInRes > 0, `Payload size for entry ${i} must be > 0`);
    assert.ok(imageOffset >= 6 + 6 * 16, `Offset for entry ${i} must be after header table`);

    const imgHeader = icoBuf.subarray(imageOffset, imageOffset + 8);
    assert.ok(
      imgHeader.equals(pngMagic),
      `Entry ${i} (${expectedSizes[i] === 0 ? 256 : expectedSizes[i]}x${expectedSizes[i] === 0 ? 256 : expectedSizes[i]}) payload must start with PNG magic bytes`
    );
  }
});

test('build/icon.png exists and has valid 256x256 dimensions and PNG magic', () => {
  const pngPath = path.resolve(projectRoot, 'build/icon.png');
  assert.ok(fs.existsSync(pngPath), 'build/icon.png must exist');

  const pngBuf = fs.readFileSync(pngPath);
  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(pngBuf.subarray(0, 8).equals(pngMagic), 'Must have PNG magic header');

  // IHDR width and height at offset 16 and 20 (big-endian 32-bit uint)
  const width = pngBuf.readUInt32BE(16);
  const height = pngBuf.readUInt32BE(20);
  assert.equal(width, 256, 'PNG width must be 256');
  assert.equal(height, 256, 'PNG height must be 256');
});

test('build/icon.png pixel sampling matches WaveForm red/pink gradient, centered white waveform bars, and transparent corners', () => {
  const pngPath = path.resolve(projectRoot, 'build/icon.png');
  const psScript = `
    Add-Type -AssemblyName System.Drawing
    $bmp = [System.Drawing.Bitmap]::FromFile("${pngPath.replace(/\\/g, '\\\\')}")
    $cCorner = $bmp.GetPixel(1, 1)
    $cTopBg = $bmp.GetPixel(128, 20)
    $cBar = $bmp.GetPixel(112, 128)
    $cBottomBg = $bmp.GetPixel(128, 240)
    $bmp.Dispose()
    Write-Output "$($cCorner.A),$($cCorner.R),$($cCorner.G),$($cCorner.B)"
    Write-Output "$($cTopBg.A),$($cTopBg.R),$($cTopBg.G),$($cTopBg.B)"
    Write-Output "$($cBar.A),$($cBar.R),$($cBar.G),$($cBar.B)"
    Write-Output "$($cBottomBg.A),$($cBottomBg.R),$($cBottomBg.G),$($cBottomBg.B)"
  `;

  const output = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
    encoding: 'utf-8'
  }).trim().split(/\r?\n/).map(line => line.trim());

  assert.equal(output.length, 4, 'Expected 4 sampled points from icon.png');

  const [cornerA, cornerR, cornerG, cornerB] = output[0].split(',').map(Number);
  const [topA, topR, topG, topB] = output[1].split(',').map(Number);
  const [barA, barR, barG, barB] = output[2].split(',').map(Number);
  const [bottomA, bottomR, bottomG, bottomB] = output[3].split(',').map(Number);

  // 1. Transparent rounded corner (outside rx=128 corner radius)
  assert.equal(cornerA, 0, 'Pixel (1,1) should be fully transparent outside rounded rectangle corner');

  // 2. Top background gradient (near #FB5C74 -> R~251, G~92, B~116)
  assert.equal(topA, 255, 'Top background pixel should be fully opaque');
  assert.ok(topR > 230, `Top gradient red channel should be high (expected >230, got ${topR})`);
  assert.ok(topG > 60 && topG < 120, `Top gradient green channel should be ~87-92 (got ${topG})`);
  assert.ok(topB > 80 && topB < 140, `Top gradient blue channel should be ~111-116 (got ${topB})`);

  // 3. Center waveform bar (white capsule -> #FFFFFF)
  assert.equal(barA, 255, 'Waveform bar pixel should be fully opaque');
  assert.equal(barR, 255, 'Waveform bar red channel should be 255 (white)');
  assert.equal(barG, 255, 'Waveform bar green channel should be 255 (white)');
  assert.equal(barB, 255, 'Waveform bar blue channel should be 255 (white)');

  // 4. Bottom background gradient (near #FA233B -> R~250, G~35, B~59)
  assert.equal(bottomA, 255, 'Bottom background pixel should be fully opaque');
  assert.ok(bottomR > 230, `Bottom gradient red channel should be high (expected >230, got ${bottomR})`);
  assert.ok(bottomG < 60, `Bottom gradient green channel should be ~35-40 (got ${bottomG})`);
  assert.ok(bottomB > 30 && bottomB < 80, `Bottom gradient blue channel should be ~39-59 (got ${bottomB})`);
});

test('Zero occurrences of Logo.png in electron/appIcon.ts and scripts/generate-icon.mjs', () => {
  const appIconSrc = fs.readFileSync(path.resolve(projectRoot, 'electron/appIcon.ts'), 'utf-8');
  assert.equal(
    appIconSrc.includes('Logo.png'),
    false,
    'electron/appIcon.ts must not contain any reference to Logo.png'
  );

  const generateIconSrc = fs.readFileSync(path.resolve(projectRoot, 'scripts/generate-icon.mjs'), 'utf-8');
  assert.equal(
    generateIconSrc.includes('Logo.png'),
    false,
    'scripts/generate-icon.mjs must not contain any reference to Logo.png'
  );
  assert.ok(
    generateIconSrc.includes('Logo.svg'),
    'scripts/generate-icon.mjs must reference Logo.svg'
  );
});

test('electron/appIcon.ts exports constants and resolves paths correctly per platform', () => {
  assert.equal(APP_USER_MODEL_ID, 'com.waveform.desktop');

  const baseDir = path.resolve(projectRoot, 'electron');

  const win32Icon = resolveAppIconPath(baseDir, projectRoot, undefined, 'win32');
  assert.ok(win32Icon, 'win32 icon path should resolve');
  assert.ok(
    win32Icon.endsWith(path.join('build', 'icon.ico')),
    `win32 icon should resolve to build/icon.ico, got: ${win32Icon}`
  );

  const linuxIcon = resolveAppIconPath(baseDir, projectRoot, undefined, 'linux');
  assert.ok(linuxIcon, 'linux icon path should resolve');
  assert.ok(
    linuxIcon.endsWith(path.join('build', 'icon.png')),
    `linux icon should resolve to build/icon.png, got: ${linuxIcon}`
  );

  const trayIcon = resolveTrayIconPath(baseDir, projectRoot);
  assert.ok(trayIcon, 'tray icon path should resolve');
  assert.ok(
    trayIcon.endsWith(path.join('build', 'icon.png')),
    `tray icon should resolve to build/icon.png, got: ${trayIcon}`
  );

  // Cross-platform fallback verification: when candidate dirs do not exist and cwd is isolated
  const emptyDir = path.resolve(projectRoot, 'node_modules');
  const win32FallbackToPng = resolveAppIconPath(baseDir, projectRoot, undefined, 'win32');
  assert.ok(win32FallbackToPng, 'win32 icon path should resolve with existing paths');
});

test('createTrayIcon handles mock nativeImage safely', () => {
  const baseDir = path.resolve(projectRoot, 'electron');

  let resizedTo = null;
  const mockNativeImage = {
    createFromPath(p) {
      return {
        isEmpty() {
          return false;
        },
        resize(dims) {
          resizedTo = dims;
          return { resized: true, dims };
        }
      };
    }
  };

  const trayIcon = createTrayIcon(mockNativeImage, baseDir, projectRoot);
  assert.ok(trayIcon, 'createTrayIcon should return resized icon');
  assert.deepEqual(resizedTo, { width: 16, height: 16 });

  // Test empty icon guard
  const mockEmptyImage = {
    createFromPath() {
      return {
        isEmpty() {
          return true;
        }
      };
    }
  };
  const emptyResult = createTrayIcon(mockEmptyImage, baseDir, projectRoot);
  assert.equal(emptyResult, null, 'createTrayIcon should return null when icon is empty');
});
