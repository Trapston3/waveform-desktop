import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
