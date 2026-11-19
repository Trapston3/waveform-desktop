import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SIZES = [16, 32, 48, 64, 128, 256];
const projectRoot = process.cwd();
const srcSvg = path.resolve(projectRoot, 'src/assets/icons/Logo.svg');
const buildDir = path.resolve(projectRoot, 'build');
const outPng = path.resolve(buildDir, 'icon.png');
const outIco = path.resolve(buildDir, 'icon.ico');

if (!fs.existsSync(srcSvg)) {
  console.error(`Source SVG logo not found at: ${srcSvg}`);
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

// Render high-DPI 1024x1024 WaveForm logo from exact vector geometry in Logo.svg,
// then downsample into square transparent canvases for [16, 32, 48, 64, 128, 256].
const psScript = `
Add-Type -AssemblyName System.Drawing

function Add-RoundedRect($path, $rect, $rx, $ry) {
    $d = $rx * 2
    $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
    $path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
    $path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
    $path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
    $path.CloseFigure()
}

function Add-Capsule($path, $x, $y, $w, $h, $r) {
    $d = $r * 2
    $path.AddArc([float]$x, [float]$y, [float]$d, [float]$d, [float]180, [float]180)
    $path.AddArc([float]$x, [float]($y + $h - $d), [float]$d, [float]$d, [float]0, [float]180)
    $path.CloseFigure()
}

# 1. Render master 1024x1024 bitmap from Logo.svg vector geometry
$masterBmp = New-Object System.Drawing.Bitmap(1024, 1024, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$mg = [System.Drawing.Graphics]::FromImage($masterBmp)
$mg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$mg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$mg.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$mg.Clear([System.Drawing.Color]::Transparent)

# Rounded rectangle background: rx="128"
$bgPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$bgRect = New-Object System.Drawing.RectangleF(0, 0, 1024, 1024)
Add-RoundedRect $bgPath $bgRect 128 128

# Vertical linear gradient: #FB5C74 -> #FA233B
$cTop = [System.Drawing.ColorTranslator]::FromHtml("#FB5C74")
$cBottom = [System.Drawing.ColorTranslator]::FromHtml("#FA233B")
$gradBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.PointF(512, 0)),
    (New-Object System.Drawing.PointF(512, 1024)),
    $cTop,
    $cBottom
)
$mg.FillPath($gradBrush, $bgPath)
$gradBrush.Dispose()
$bgPath.Dispose()

# 6 white waveform capsule bars: width=80, rx=40
$bars = @(
    @(162, 380, 80, 264),
    @(286, 260, 80, 504),
    @(410, 180, 80, 664),
    @(534, 300, 80, 424),
    @(658, 220, 80, 584),
    @(782, 360, 80, 304)
)

$barsPath = New-Object System.Drawing.Drawing2D.GraphicsPath
foreach ($bar in $bars) {
    Add-Capsule $barsPath $bar[0] $bar[1] $bar[2] $bar[3] 40
}
$whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$mg.FillPath($whiteBrush, $barsPath)
$whiteBrush.Dispose()
$barsPath.Dispose()
$mg.Dispose()

# 2. Downsample master into target sizes [16, 32, 48, 64, 128, 256]
$tempDir = "${tempDir.replace(/\\/g, '\\\\')}"
$sizes = @(16, 32, 48, 64, 128, 256)

foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    $destRect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $g.DrawImage($masterBmp, $destRect, 0, 0, 1024, 1024, [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()

    $outPath = Join-Path $tempDir "icon_$size.png"
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

$masterBmp.Dispose()
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
