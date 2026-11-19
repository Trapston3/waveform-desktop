import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SIZES = [16, 32, 48, 64, 128, 256];
const projectRoot = process.cwd();
const srcLogo = path.resolve(projectRoot, 'src/assets/icons/Logo.png');
const buildDir = path.resolve(projectRoot, 'build');
const outPng = path.resolve(buildDir, 'icon.png');
const outIco = path.resolve(buildDir, 'icon.ico');

if (!fs.existsSync(srcLogo)) {
  console.error(`Source logo not found at: ${srcLogo}`);
  process.exit(1);
}

if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}

// Prepare temporary directory for generated resized PNGs
const tempDir = path.resolve(buildDir, '.tmp_icon_gen');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Generate square resized PNGs preserving aspect ratio centered on transparent ARGB canvas
const psScript = `
Add-Type -AssemblyName System.Drawing
$srcPath = "${srcLogo.replace(/\\/g, '\\\\')}"
$tempDir = "${tempDir.replace(/\\/g, '\\\\')}"
$src = [System.Drawing.Image]::FromFile($srcPath)

$sizes = @(16, 32, 48, 64, 128, 256)

foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    $scale = [Math]::Min($size / $src.Width, $size / $src.Height)
    $w = [int][Math]::Round($src.Width * $scale)
    $h = [int][Math]::Round($src.Height * $scale)
    $x = [int][Math]::Round(($size - $w) / 2)
    $y = [int][Math]::Round(($size - $h) / 2)

    $rect = New-Object System.Drawing.Rectangle($x, $y, $w, $h)
    $g.DrawImage($src, $rect)
    $g.Dispose()

    $outPath = Join-Path $tempDir "icon_$size.png"
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

$src.Dispose()
`;

try {
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
    stdio: 'inherit'
  });
} catch (err) {
  console.error('Failed to run powershell image generation:', err);
  process.exit(1);
}

// Copy 256x256 PNG to build/icon.png
const png256Path = path.join(tempDir, 'icon_256.png');
fs.copyFileSync(png256Path, outPng);
console.log(`Saved 256x256 PNG to: ${outPng}`);

// Read all PNG buffers
const pngBuffers = SIZES.map(size => {
  const file = path.join(tempDir, `icon_${size}.png`);
  return {
    size,
    buffer: fs.readFileSync(file)
  };
});

// Construct Vista+ PNG-in-ICO format
// ICONDIR: 6 bytes
//   0-1: Reserved (must be 0)
//   2-3: Image type (1 for icon)
//   4-5: Number of images (6)
// ICONDIRENTRY (16 bytes each):
//   0: Width (0 for 256)
//   1: Height (0 for 256)
//   2: Color count (0 for 32bpp)
//   3: Reserved (0)
//   4-5: Color planes (1)
//   6-7: Bits per pixel (32)
//   8-11: Size of image data in bytes
//   12-15: Offset of image data from beginning of file

const numImages = pngBuffers.length;
const headerSize = 6;
const dirEntrySize = 16;
const totalDirSize = headerSize + numImages * dirEntrySize;

let currentOffset = totalDirSize;
const dirEntries = [];

for (const img of pngBuffers) {
  const entry = Buffer.alloc(dirEntrySize);
  // Width & height: 256 is encoded as 0
  entry.writeUInt8(img.size === 256 ? 0 : img.size, 0);
  entry.writeUInt8(img.size === 256 ? 0 : img.size, 1);
  entry.writeUInt8(0, 2); // Colors in palette
  entry.writeUInt8(0, 3); // Reserved
  entry.writeUInt16LE(1, 4); // Color planes
  entry.writeUInt16LE(32, 6); // Bits per pixel
  entry.writeUInt32LE(img.buffer.length, 8); // Image size in bytes
  entry.writeUInt32LE(currentOffset, 12); // Offset

  dirEntries.push(entry);
  currentOffset += img.buffer.length;
}

const iconDir = Buffer.alloc(headerSize);
iconDir.writeUInt16LE(0, 0); // Reserved
iconDir.writeUInt16LE(1, 2); // ICO type = 1
iconDir.writeUInt16LE(numImages, 4); // Image count

const icoBuffer = Buffer.concat([
  iconDir,
  ...dirEntries,
  ...pngBuffers.map(img => img.buffer)
]);

fs.writeFileSync(outIco, icoBuffer);
console.log(`Saved multi-resolution ICO to: ${outIco} (${icoBuffer.length} bytes)`);

// Cleanup temporary directory
fs.rmSync(tempDir, { recursive: true, force: true });
console.log('Icon generation completed successfully.');
