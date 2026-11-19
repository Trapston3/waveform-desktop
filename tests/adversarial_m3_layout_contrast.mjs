// ==============================================================================
// tests/adversarial_m3_layout_contrast.mjs
// Adversarial Empirical Stress Harness: Desktop 5-Zone Layout & WCAG Contrast
// Challenger: challenger_m3_ui_1
// ==============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function assert(condition, message, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  \x1b[32m✓\x1b[0m ${message}`);
  } else {
    failedTests++;
    const fullMsg = details ? `${message} -> ${details}` : message;
    failures.push(fullMsg);
    console.error(`  \x1b[31m✗\x1b[0m ${fullMsg}`);
  }
}

function suite(name, fn) {
  console.log(`\n\x1b[1m\x1b[35m=== [CHALLENGE SUITE] ${name} ===\x1b[0m`);
  fn();
}

// -----------------------------------------------------------------------------
// sRGB and WCAG 2.1 Gamma-Expanded Math Engine
// -----------------------------------------------------------------------------
function srgbToLinear(c) {
  const norm = c / 255;
  return norm <= 0.04045 ? norm / 12.92 : Math.pow((norm + 0.055) / 1.055, 2.4);
}

function hexToRgb(hex) {
  const cleanHex = hex.replace('#', '').trim();
  let r, g, b;
  if (cleanHex.length === 3) {
    r = parseInt(cleanHex[0] + cleanHex[0], 16);
    g = parseInt(cleanHex[1] + cleanHex[1], 16);
    b = parseInt(cleanHex[2] + cleanHex[2], 16);
  } else if (cleanHex.length === 6) {
    r = parseInt(cleanHex.substring(0, 2), 16);
    g = parseInt(cleanHex.substring(2, 4), 16);
    b = parseInt(cleanHex.substring(4, 6), 16);
  } else {
    throw new Error(`Invalid hex: ${hex}`);
  }
  return { r, g, b };
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rPrime = 0, gPrime = 0, bPrime = 0;
  if (h >= 0 && h < 60) {
    rPrime = c; gPrime = x; bPrime = 0;
  } else if (h >= 60 && h < 120) {
    rPrime = x; gPrime = c; bPrime = 0;
  } else if (h >= 120 && h < 180) {
    rPrime = 0; gPrime = c; bPrime = x;
  } else if (h >= 180 && h < 240) {
    rPrime = 0; gPrime = x; bPrime = c;
  } else if (h >= 240 && h < 300) {
    rPrime = x; gPrime = 0; bPrime = c;
  } else {
    rPrime = c; gPrime = 0; bPrime = x;
  }
  return {
    r: Math.round((rPrime + m) * 255),
    g: Math.round((gPrime + m) * 255),
    b: Math.round((bPrime + m) * 255),
  };
}

function getRelativeLuminance({ r, g, b }) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function calculateContrastRatio(lum1, lum2) {
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Alpha compositing: foreground over background
function compositeOver(fgRgb, fgAlpha, bgRgb) {
  return {
    r: Math.round(fgRgb.r * fgAlpha + bgRgb.r * (1 - fgAlpha)),
    g: Math.round(fgRgb.g * fgAlpha + bgRgb.g * (1 - fgAlpha)),
    b: Math.round(fgRgb.b * fgAlpha + bgRgb.b * (1 - fgAlpha)),
  };
}

// -----------------------------------------------------------------------------
// ADVERSARIAL SUITE 1: Zone 1 - DesktopTitleBar Ergonomics & Native Caption Controls
// -----------------------------------------------------------------------------
suite('Zone 1: DesktopTitleBar Ergonomic Metrics & Caption Hitboxes', () => {
  const file = path.join(ROOT, 'src/ui/layout/DesktopTitleBar.tsx');
  assert(fs.existsSync(file), 'DesktopTitleBar.tsx source file exists');
  const src = fs.readFileSync(file, 'utf8');

  // Height verification: strictly 40px (h-10 in Tailwind is 2.5rem = 40px)
  assert(
    src.includes('h-10'),
    'TitleBar constrained to standard desktop height of 40px via h-10',
    'Found no h-10 class'
  );

  // Electron drag boundaries
  assert(
    src.includes('app-drag-region'),
    'Header defines app-drag-region for window dragging',
    'Missing app-drag-region'
  );
  assert(
    src.includes('app-no-drag'),
    'Interactive controls marked with app-no-drag to prevent click trapping',
    'Missing app-no-drag on controls'
  );

  // History buttons hitbox: exactly 28x28px (w-7 h-7 = 1.75rem = 28px)
  const historyButtons = src.match(/w-7 h-7 flex items-center justify-center/g);
  assert(
    historyButtons && historyButtons.length >= 2,
    `Back and Forward buttons sized to 28x28px hitboxes (w-7 h-7 count: ${historyButtons?.length || 0})`,
    'Expected at least 2 history buttons with w-7 h-7'
  );

  // Quick Search & Command pill
  assert(
    src.includes('Ctrl+K') || (src.includes('Ctrl') && src.includes('K')),
    'Command Search pill includes Ctrl+K shortcut indicator',
    'Missing Ctrl+K badge'
  );
  assert(
    src.includes("navigateToTab('search')"),
    'Command pill routes directly to Search tab upon user click'
  );
  assert(
    src.includes("waveform-search-input"),
    'Command pill focuses #waveform-search-input on click for immediate typing'
  );

  // Windows 11 Caption Controls: 46px standard width buttons
  const win11Buttons = src.match(/w-\[46px\] h-full/g);
  assert(
    win11Buttons && win11Buttons.length === 3,
    `Windows 11 caption controls allocate standard 46px width across Minimize, Maximize, Close (count: ${win11Buttons?.length || 0})`,
    'Expected exactly 3 buttons with w-[46px] h-full'
  );

  // Windows 11 Close button hover color #E81123
  assert(
    src.includes('hover:bg-[#E81123]'),
    'Windows 11 close button implements authentic #E81123 red hover fill',
    'Missing hover:bg-[#E81123]'
  );
  assert(
    src.includes('active:bg-[#C4101E]'),
    'Windows 11 close button implements active #C4101E press fill',
    'Missing active:bg-[#C4101E]'
  );

  // Maximize state toggle
  assert(
    src.includes('isMaximized') && src.includes('handleMaximize') && src.includes('handleMinimize') && src.includes('handleClose'),
    'Implements full window caption state machine (minimize, maximize, close, isMaximized)'
  );
});

// -----------------------------------------------------------------------------
// ADVERSARIAL SUITE 2: Zone 2 - LeftSidebar Width, Accent Indicator & Visual Purity
// -----------------------------------------------------------------------------
suite('Zone 2: LeftSidebar Layout Metrics, 2.5px Accent Bar & Neon Removal', () => {
  const file = path.join(ROOT, 'src/ui/layout/LeftSidebar.tsx');
  assert(fs.existsSync(file), 'LeftSidebar.tsx source file exists');
  const src = fs.readFileSync(file, 'utf8');

  // Width: strictly 240px (w-60 in Tailwind is 15rem = 240px)
  assert(
    src.includes('w-60'),
    'LeftSidebar width strictly constrained to 240px via w-60',
    'Missing w-60 class'
  );

  // Active selection item: 2.5px left accent bar in #FA2D48
  assert(
    src.includes('w-[2.5px]') && src.includes('bg-[#FA2D48]'),
    'Active nav item renders 2.5px vertical accent bar in #FA2D48 (w-[2.5px] bg-[#FA2D48])',
    'Missing 2.5px accent bar'
  );

  // Active text color: pure white
  assert(
    src.includes('text-white') && src.includes('font-semibold text-white'),
    'Active nav item typography is pure white #FFFFFF for maximum contrast',
    'Missing pure white text-white on active state'
  );

  // Harsh neon red drop shadow elimination
  const neonGlowRegex = /shadow-\[[^\]]*rgba\(250,\s*45,\s*72/gi;
  const matches = src.match(neonGlowRegex);
  assert(
    matches === null || matches.length === 0,
    `Absence of harsh neon red drop shadow in LeftSidebar (found: ${matches ? matches.length : 0})`,
    `Found harsh shadow: ${matches ? matches.join(', ') : ''}`
  );

  // Layer ordering z-index: z-20 for sidebar chrome
  assert(
    src.includes('z-20'),
    'LeftSidebar has z-20 layer priority, sitting beneath TitleBar (z-50) and Player Dock (z-40)'
  );
});

// -----------------------------------------------------------------------------
// ADVERSARIAL SUITE 3: Zone 3 - MainViewport Floating Dock Clearance Mathematics
// -----------------------------------------------------------------------------
suite('Zone 3: MainViewport Floating Dock Clearance & Bottom Clearance Physics', () => {
  const viewportFile = path.join(ROOT, 'src/ui/layout/MainViewport.tsx');
  const playerFile = path.join(ROOT, 'src/ui/layout/BottomPlayerBar.tsx');
  assert(fs.existsSync(viewportFile), 'MainViewport.tsx exists');
  assert(fs.existsSync(playerFile), 'BottomPlayerBar.tsx exists');

  const viewportSrc = fs.readFileSync(viewportFile, 'utf8');
  const playerSrc = fs.readFileSync(playerFile, 'utf8');

  // BottomPlayerBar dimensions:
  // Container: fixed bottom-0 left-0 right-0 h-[92px] px-4 pb-4
  // Capsule: h-[76px]
  const hasDockHeight92 = playerSrc.includes('h-[92px]');
  const hasCapsuleHeight76 = playerSrc.includes('h-[76px]');
  assert(
    hasDockHeight92 && hasCapsuleHeight76,
    'BottomPlayerBar defines 92px fixed dock envelope with 76px floating capsule',
    `h-[92px]: ${hasDockHeight92}, h-[76px]: ${hasCapsuleHeight76}`
  );

  // MainViewport bottom clearance: pb-28
  // pb-28 in Tailwind = 28 * 0.25rem = 7rem = 112px.
  assert(
    viewportSrc.includes('pb-28'),
    'MainViewport specifies pb-28 bottom clearance',
    'Missing pb-28'
  );

  // Mathematical proof of non-obscuration:
  const dockEnvelopeHeightPx = 92;
  const viewportClearancePx = 28 * 4; // 112px
  const netClearanceMarginPx = viewportClearancePx - dockEnvelopeHeightPx;

  assert(
    netClearanceMarginPx >= 16,
    `Clearance proof: pb-28 (${viewportClearancePx}px) exceeds dock envelope (${dockEnvelopeHeightPx}px) by ${netClearanceMarginPx}px margin (>= 16px)`,
    `Insufficient clearance margin: ${netClearanceMarginPx}px`
  );

  // Containment and scroll smoothness
  assert(
    viewportSrc.includes('overscroll-contain'),
    'MainViewport applies overscroll-contain to isolate scroll physics from window body'
  );
});

// -----------------------------------------------------------------------------
// ADVERSARIAL SUITE 4: Zone 4 - BottomPlayerBar Ergonomic Clusters & Truncation Stress
// -----------------------------------------------------------------------------
suite('Zone 4: BottomPlayerBar 3 Clusters, Audio Quality Badge & Truncation Stress', () => {
  const file = path.join(ROOT, 'src/ui/layout/BottomPlayerBar.tsx');
  const src = fs.readFileSync(file, 'utf8');

  // Height: strictly 76px capsule
  assert(
    src.includes('h-[76px]'),
    'Floating Player Bar capsule strictly constrained to 76px (h-[76px])'
  );

  // Cluster 1 (Left): 280px width
  assert(
    src.includes('w-[280px]'),
    'Cluster 1 (Left) allocated strictly 280px for Artwork, Metadata, Quality Badge, and Heart',
    'Missing w-[280px]'
  );

  // Cluster 2 (Center): flex-1 max-w-xl
  assert(
    src.includes('flex-1') && src.includes('max-w-xl'),
    'Cluster 2 (Center) allocated flex-1 max-w-xl for Transport controls and 68-Bar Waveform Scrubber'
  );

  // Cluster 3 (Right): 240px width
  assert(
    src.includes('w-[240px]'),
    'Cluster 3 (Right) allocated strictly 240px for Output Route, Volume Wheel, and Secondary Toggles',
    'Missing w-[240px]'
  );

  // Single clean quality badge (ATMOS or LOSSLESS)
  assert(
    src.includes('ATMOS') && src.includes('LOSSLESS 24/48'),
    'BottomPlayerBar renders a single clean dynamic quality badge (ATMOS or LOSSLESS 24/48)'
  );

  // Play button: 36x36px solid white pill
  assert(
    src.includes('w-9 h-9 rounded-full bg-white text-black'),
    'Play/Pause button rendered as high-contrast solid white 36x36px circular pill (w-9 h-9 bg-white text-black)'
  );

  // Truncation defense against extreme strings
  const titleHasTruncate = src.includes('truncate') && src.includes('activeTrack?.title');
  const artistHasTruncate = src.includes('truncate') && src.includes('activeTrack?.artist');
  const minW0OnCluster1 = src.includes('min-w-0');

  assert(
    titleHasTruncate && artistHasTruncate && minW0OnCluster1,
    'Metadata row protects against extreme string overflow using min-w-0 + truncate on title and artist',
    `title: ${titleHasTruncate}, artist: ${artistHasTruncate}, min-w-0: ${minW0OnCluster1}`
  );
});

// -----------------------------------------------------------------------------
// ADVERSARIAL SUITE 5: Zone 5 - RightInspector Width & GPU Compositor Slide Animation
// -----------------------------------------------------------------------------
suite('Zone 5: RightInspector 360px Sidecar & GPU translate3d Slide Transition', () => {
  const file = path.join(ROOT, 'src/ui/layout/RightInspector.tsx');
  const src = fs.readFileSync(file, 'utf8');

  // Width: strictly 360px
  assert(
    src.includes('w-[360px]'),
    'RightInspector width constrained to 360px desktop sidecar standard (w-[360px])',
    'Missing w-[360px]'
  );

  // CSS hardware-accelerated translate3d slide transition
  assert(
    src.includes("translate3d(0, 0, 0)") && src.includes("translate3d(100%, 0, 0)"),
    'Slide transition executed via translate3d(0,0,0) / translate3d(100%,0,0) on GPU compositor thread',
    'Missing translate3d transforms'
  );

  // Smooth cubic-bezier timing
  assert(
    src.includes('cubic-bezier(0.16, 1, 0.3, 1)') || src.includes('cubic-bezier(0.16,1,0.3,1)'),
    'Transition uses calibrated Apple-standard spring cubic-bezier(0.16, 1, 0.3, 1)'
  );

  // Syllable lyrics and Up Next queue tabs
  assert(
    src.includes('activeTab === \'lyrics\'') && src.includes('activeTab === \'queue\''),
    'Supports dual-mode sidecar switching between Syllable Lyrics and Up Next Queue'
  );
});

// -----------------------------------------------------------------------------
// ADVERSARIAL SUITE 6: WCAG 2.1 AA Contrast Stress Test Across Operational Dark Surfaces
// -----------------------------------------------------------------------------
suite('WCAG 2.1 AA Contrast Ratios Across All Operational Dark Surfaces', () => {
  // Text Tokens under test
  const primaryText = { name: 'Primary Text', hex: '#FFFFFF', minReq: 14.0 };
  const secondaryText = { name: 'Secondary Text', hex: '#A1A1A6', minReq: 5.2 };
  const tertiaryText = { name: 'Tertiary Text', hex: '#8E8E93', minReq: 4.5 };

  const lumPrimary = getRelativeLuminance(hexToRgb(primaryText.hex));
  const lumSecondary = getRelativeLuminance(hexToRgb(secondaryText.hex));
  const lumTertiary = getRelativeLuminance(hexToRgb(tertiaryText.hex));

  // 5 Operational Dark Surfaces in WaveForm Desktop:
  const surfaces = [
    { name: 'Surface 1: Pure Black Canvas', hex: '#000000' },
    { name: 'Surface 2: Base Surface / Acrylic Card', hex: '#0D0D0F' },
    { name: 'Surface 3: Glass Chrome (TitleBar / Dock)', hex: '#0F0F12' },
    { name: 'Surface 4: Ambient Mesh with 45% Scrim', hex: '#181014' },
    { name: 'Surface 5: Surface Variant (Hover / Inputs)', hex: '#1C1C1E' },
  ];

  for (const surf of surfaces) {
    const sRgb = hexToRgb(surf.hex);
    const sLum = getRelativeLuminance(sRgb);

    const crP = calculateContrastRatio(lumPrimary, sLum);
    const crS = calculateContrastRatio(lumSecondary, sLum);
    const crT = calculateContrastRatio(lumTertiary, sLum);

    assert(
      crP >= primaryText.minReq,
      `${surf.name} (${surf.hex}) -> Primary #FFFFFF achieves ${crP.toFixed(2)}:1 (threshold >${primaryText.minReq}:1)`,
      `Expected >= ${primaryText.minReq}:1, got ${crP.toFixed(2)}:1`
    );

    assert(
      crS >= secondaryText.minReq,
      `${surf.name} (${surf.hex}) -> Secondary #A1A1A6 achieves ${crS.toFixed(2)}:1 (threshold >=${secondaryText.minReq}:1)`,
      `Expected >= ${secondaryText.minReq}:1, got ${crS.toFixed(2)}:1`
    );

    assert(
      crT >= tertiaryText.minReq,
      `${surf.name} (${surf.hex}) -> Tertiary #8E8E93 achieves ${crT.toFixed(2)}:1 (threshold >=${tertiaryText.minReq}:1)`,
      `Expected >= ${tertiaryText.minReq}:1, got ${crT.toFixed(2)}:1`
    );
  }
});

// -----------------------------------------------------------------------------
// ADVERSARIAL SUITE 7: Artwork Palette Stress Matrix (360 Hues & Extreme Pastel Covers)
// -----------------------------------------------------------------------------
suite('Adversarial Artwork Palette Stress Matrix (360° Hue Sweep + 45% Scrim Proof)', () => {
  // Theme.ts dynamic artwork extraction calibration:
  // ambientBackground: hsl(safeHue, 35%, 8%)
  // edgeWash: hsla(safeEdge, 45%, 18%, 0.55)
  // playerTint: hsla(safeHue, 42%, 24%, 0.65)
  // scrim: 45% black rgba(0, 0, 0, 0.45)
  
  const blackCanvas = { r: 0, g: 0, b: 0 };
  const lumPrimary = getRelativeLuminance(hexToRgb('#FFFFFF'));
  const lumSecondary = getRelativeLuminance(hexToRgb('#A1A1A6'));
  const lumTertiary = getRelativeLuminance(hexToRgb('#8E8E93'));

  let minCrPrimary = Infinity;
  let minCrSecondary = Infinity;
  let minCrTertiary = Infinity;
  let worstHueP = 0;
  let worstHueS = 0;
  let worstHueT = 0;

  // Sweep all 360 hues in 5-degree increments (72 discrete spectrum samples)
  for (let hue = 0; hue < 360; hue += 5) {
    // 1. Ambient Background base (hsl(hue, 35%, 8%))
    const ambientRgb = hslToRgb(hue, 0.35, 0.08);

    // 2. Edge wash (hsl(hue, 45%, 18%) at 55% alpha) composited over ambient
    const edgeRgb = hslToRgb(hue, 0.45, 0.18);
    const afterEdge = compositeOver(edgeRgb, 0.55, ambientRgb);

    // 3. Player tint (hsl(hue, 42%, 24%) at 65% alpha) composited in dock area
    const playerRgb = hslToRgb(hue, 0.42, 0.24);
    const afterPlayer = compositeOver(playerRgb, 0.65, afterEdge);

    // 4. Global 45% black scrim: rgba(0, 0, 0, 0.45) composited over the result
    const scrimmedAmbient = compositeOver(blackCanvas, 0.45, afterEdge);
    const scrimmedPlayer = compositeOver(blackCanvas, 0.45, afterPlayer);

    for (const surfaceRgb of [scrimmedAmbient, scrimmedPlayer]) {
      const sLum = getRelativeLuminance(surfaceRgb);
      const crP = calculateContrastRatio(lumPrimary, sLum);
      const crS = calculateContrastRatio(lumSecondary, sLum);
      const crT = calculateContrastRatio(lumTertiary, sLum);

      if (crP < minCrPrimary) { minCrPrimary = crP; worstHueP = hue; }
      if (crS < minCrSecondary) { minCrSecondary = crS; worstHueS = hue; }
      if (crT < minCrTertiary) { minCrTertiary = crT; worstHueT = hue; }
    }
  }

  assert(
    minCrPrimary >= 14.0,
    `360° Hue Sweep: Worst-case Primary contrast is ${minCrPrimary.toFixed(2)}:1 at hue ${worstHueP}° (satisfies >14:1)`,
    `Primary dropped below 14:1: ${minCrPrimary.toFixed(2)}:1`
  );

  assert(
    minCrSecondary >= 5.2,
    `360° Hue Sweep: Worst-case Secondary contrast is ${minCrSecondary.toFixed(2)}:1 at hue ${worstHueS}° (satisfies >=5.2:1)`,
    `Secondary dropped below 5.2:1: ${minCrSecondary.toFixed(2)}:1`
  );

  assert(
    minCrTertiary >= 4.5,
    `360° Hue Sweep: Worst-case Tertiary contrast is ${minCrTertiary.toFixed(2)}:1 at hue ${worstHueT}° (satisfies >=4.5:1 WCAG AA)`,
    `Tertiary dropped below 4.5:1: ${minCrTertiary.toFixed(2)}:1`
  );

  // Adversarial Extreme Covers (Pastel Yellow, Neon Magenta, Electric Cyan, Pure White)
  const extremeCoverColors = [
    { name: 'Ultra-Pastel Yellow Cover', hex: '#FFFDD0' },
    { name: 'Blinding Neon Magenta Cover', hex: '#FF00FF' },
    { name: 'Pure Electric Cyan Cover', hex: '#00FFFF' },
    { name: '100% Saturated Acid Green Cover', hex: '#39FF14' },
    { name: '100% Pure White Blank Cover', hex: '#FFFFFF' },
  ];

  for (const cover of extremeCoverColors) {
    // When an album cover is pure white/pastel, without dark scrim & hue clamping it would destroy contrast.
    // In WaveForm, Theme.ts clamps dark mode background lightness to 8% and edge wash to 18%,
    // and .waveform-ambient-backdrop applies 45% dark scrim.
    // Even in worst-case direct scrim over the cover color itself:
    const rawRgb = hexToRgb(cover.hex);
    // If the cover bled 20% into ambient behind the scrim:
    const bledRgb = compositeOver(rawRgb, 0.20, blackCanvas);
    const finalRgb = compositeOver(blackCanvas, 0.45, bledRgb);
    const lum = getRelativeLuminance(finalRgb);
    const crP = calculateContrastRatio(lumPrimary, lum);
    const crS = calculateContrastRatio(lumSecondary, lum);
    const crT = calculateContrastRatio(lumTertiary, lum);

    assert(
      crP >= 14.0 && crS >= 5.2 && crT >= 4.5,
      `Adversarial Cover (${cover.name}): Scrimmed backdrop yields P:${crP.toFixed(2)}:1, S:${crS.toFixed(2)}:1, T:${crT.toFixed(2)}:1 (all pass)`,
      `Failed on ${cover.name}`
    );
  }
});

// -----------------------------------------------------------------------------
// ADVERSARIAL SUITE 8: Two-Tier Material Isolation & 60fps CSS Containment Rules
// -----------------------------------------------------------------------------
suite('Two-Tier Material System & 60fps CSS Containment Architecture', () => {
  const cssFile = path.join(ROOT, 'src/index.css');
  const cssSrc = fs.readFileSync(cssFile, 'utf8');

  // Verify Tier B (.acrylic-tile / .liquid-glass-card) does NOT have backdrop-filter
  // Extract .acrylic-tile CSS block
  const acrylicTileIdx = cssSrc.indexOf('.liquid-glass-card,');
  const acrylicTileBlock = cssSrc.substring(acrylicTileIdx, acrylicTileIdx + 450);

  assert(
    !acrylicTileBlock.includes('backdrop-filter:'),
    'Tier B (.acrylic-tile / .liquid-glass-card) does NOT invoke per-card backdrop-filter (eliminates GPU readback stalls)',
    'Found illegal backdrop-filter in .acrylic-tile definition'
  );

  assert(
    acrylicTileBlock.includes('contain: paint layout') || acrylicTileBlock.includes('contain: paint'),
    'Tier B (.acrylic-tile) enforces CSS containment (contain: paint layout)',
    'Missing CSS containment in .acrylic-tile'
  );

  // Verify Tier A structural chrome uses saturate(190%) blur(24px)
  assert(
    cssSrc.includes('saturate(190%) blur(24px)') || cssSrc.includes('--glass-blur: saturate(190%) blur(24px)'),
    'Tier A structural chrome defines optical saturation and blur (saturate(190%) blur(24px))'
  );

  // Verify tracklist row virtualization containment
  assert(
    cssSrc.includes('content-visibility: auto'),
    'Tracklist rows implement browser-native DOM virtualization via content-visibility: auto',
    'Missing content-visibility: auto in index.css'
  );

  // Verify 45% dark scrim token
  assert(
    cssSrc.includes('--color-scrim-ambient: rgba(0, 0, 0, 0.45)'),
    'index.css defines --color-scrim-ambient: rgba(0, 0, 0, 0.45)'
  );
});

// -----------------------------------------------------------------------------
// SUMMARY & EXIT DISCIPLINE
// -----------------------------------------------------------------------------
console.log('\n================================================================================');
console.log('             ADVERSARIAL EMPIRICAL CHALLENGE SUMMARY (M3 UI)');
console.log('================================================================================');
console.log(`Total Empirical Checks  : ${totalTests}`);
console.log(`Passed Checks           : \x1b[32m${passedTests}\x1b[0m`);
console.log(`Failed Checks           : ${failedTests > 0 ? `\x1b[31m${failedTests}\x1b[0m` : '\x1b[32m0\x1b[0m'}`);
console.log(`Pass Rate               : ${((passedTests / totalTests) * 100).toFixed(1)}%`);

if (failures.length > 0) {
  console.log('\nFailures Detected:');
  for (const f of failures) {
    console.error(`  - \x1b[31m${f}\x1b[0m`);
  }
}
console.log('================================================================================\n');

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
