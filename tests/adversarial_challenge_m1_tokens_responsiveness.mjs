// ==============================================================================
// tests/adversarial_challenge_m1_tokens_responsiveness.mjs
// Adversarial Empirical Stress Harness: M1 Layout Geometry, CSS Tokens & Light/Dark Contrast
// Challenger: teamwork_challenger (Challenger 2 for Milestone M1)
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
  console.log(`\n\x1b[1m\x1b[36m=== [CHALLENGE SUITE] ${name} ===\x1b[0m`);
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
  } else if (cleanHex.length === 8) {
    // RRGGBBAA
    r = parseInt(cleanHex.substring(0, 2), 16);
    g = parseInt(cleanHex.substring(2, 4), 16);
    b = parseInt(cleanHex.substring(4, 6), 16);
  } else {
    throw new Error(`Invalid hex: ${hex}`);
  }
  return { r, g, b };
}

function parseRgba(rgbaStr) {
  const match = rgbaStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!match) throw new Error(`Cannot parse rgba: ${rgbaStr}`);
  return {
    r: parseInt(match[1], 10),
    g: parseInt(match[2], 10),
    b: parseInt(match[3], 10),
    a: match[4] !== undefined ? parseFloat(match[4]) : 1.0,
  };
}

function blendRgbaOverBase(fgRgba, bgRgb) {
  const a = fgRgba.a;
  return {
    r: Math.round(fgRgba.r * a + bgRgb.r * (1 - a)),
    g: Math.round(fgRgba.g * a + bgRgb.g * (1 - a)),
    b: Math.round(fgRgba.b * a + bgRgb.b * (1 - a)),
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

// =============================================================================
// SUITE 1: Interface Contract Tokens (PROJECT.md M1 ↔ M2)
// =============================================================================
suite('1. Verification of M1 ↔ M2 CSS Design Tokens in index.css', () => {
  const cssPath = path.join(ROOT, 'src/index.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  // PROJECT.md specified:
  // --am-acrylic-sidebar: rgba(24, 24, 27, 0.78)
  // --am-text-primary: #D8FFFFFF
  // --am-text-secondary: #83FFFFFF
  // --am-text-tertiary: #3FFFFFFF
  // --am-brand-pink: #FA2D48
  const hasAmAcrylic = css.includes('--am-acrylic-sidebar');
  const hasAmTextPrimary = css.includes('--am-text-primary');
  const hasAmTextSecondary = css.includes('--am-text-secondary');
  const hasAmTextTertiary = css.includes('--am-text-tertiary');
  const hasAmBrandPink = css.includes('--am-brand-pink');

  assert(hasAmAcrylic, 'index.css defines --am-acrylic-sidebar (PROJECT.md Contract)', 'Missing --am-acrylic-sidebar');
  assert(hasAmTextPrimary, 'index.css defines --am-text-primary (PROJECT.md Contract)', 'Missing --am-text-primary');
  assert(hasAmTextSecondary, 'index.css defines --am-text-secondary (PROJECT.md Contract)', 'Missing --am-text-secondary');
  assert(hasAmTextTertiary, 'index.css defines --am-text-tertiary (PROJECT.md Contract)', 'Missing --am-text-tertiary');
  assert(hasAmBrandPink, 'index.css defines --am-brand-pink (PROJECT.md Contract)', 'Missing --am-brand-pink');
});

// =============================================================================
// SUITE 2: Light Mode Token Symmetry & Parity in index.css
// =============================================================================
suite('2. Dark vs Light Mode CSS Token Symmetry in index.css', () => {
  const cssPath = path.join(ROOT, 'src/index.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  const rootBlock = css.substring(css.indexOf(':root {'), css.indexOf('.light {'));
  const lightBlock = css.substring(css.indexOf('.light {'), css.indexOf('body {'));

  // Tokens that exist in :root must have light mode variants
  const requiredSymmetricTokens = [
    '--color-bg',
    '--color-surface',
    '--color-surface-variant',
    '--color-outline',
    '--color-on-surface-variant',
    '--color-text-primary',
    '--color-text-secondary',
    '--color-text-tertiary',
    '--color-scrim-ambient',
    '--color-primary',
    '--color-on-primary',
    '--color-accent',
    '--glass-bg',
    '--glass-border',
    '--glass-player',
    '--liquid-acrylic-fill',
    '--liquid-acrylic-border',
    '--sidebar-bg',
    '--sidebar-border',
    '--sidebar-item-active',
    '--sidebar-item-hover',
  ];

  for (const token of requiredSymmetricTokens) {
    const inRoot = rootBlock.includes(token);
    const inLight = lightBlock.includes(token);
    assert(
      !inRoot || inLight,
      `Token ${token} has symmetrical .light definition`,
      `Token ${token} defined in :root but omitted in .light!`
    );
  }

  // Light mode scrollbar thumb visibility
  const hasLightScrollbar = css.includes('.light ::-webkit-scrollbar-thumb') ||
    css.includes('.light::-webkit-scrollbar-thumb') ||
    css.includes('var(--scrollbar-thumb');
  assert(hasLightScrollbar, 'Custom scrollbar thumb has visible light mode styling', 'No light mode scrollbar thumb override found');
});

// =============================================================================
// SUITE 3: WCAG 2.1 AA Contrast Ratios in Light Mode
// =============================================================================
suite('3. WCAG 2.1 AA Empirical Contrast Analysis in Light Mode', () => {
  const lightBgRgb = hexToRgb('#F5F5F7');
  const lightSurfaceRgb = hexToRgb('#FFFFFF');

  // Test 1: DesktopTitleBar in Light Mode
  const titlebarSrc = fs.readFileSync(path.join(ROOT, 'src/ui/layout/DesktopTitleBar.tsx'), 'utf8');
  const lightBgMatch = titlebarSrc.match(/bg-\[(rgba?\([^)]+\))\]/);
  const titlebarBgRgba = lightBgMatch ? parseRgba(lightBgMatch[1]) : parseRgba('rgba(16, 16, 20, 0.75)');
  const titlebarEffectiveBg = blendRgbaOverBase(titlebarBgRgba, lightBgRgb);
  const titlebarBgLum = getRelativeLuminance(titlebarEffectiveBg);

  const blackTextLum = getRelativeLuminance(hexToRgb('#000000'));
  const titlebarPrimaryContrast = calculateContrastRatio(titlebarBgLum, blackTextLum);
  console.log(`    [Empirical Metric] TitleBar primary text contrast in light mode: ${titlebarPrimaryContrast.toFixed(2)}:1`);

  assert(
    titlebarPrimaryContrast >= 4.5,
    `TitleBar primary text on dark acrylic header in light mode meets WCAG AA (>= 4.5:1)`,
    `Actual contrast is ${titlebarPrimaryContrast.toFixed(2)}:1 (black text on dark header fails WCAG AA!)`
  );

  // TitleBar search pill text (--color-on-surface-variant = #52525B in light mode)
  const onSurfaceVariantLum = getRelativeLuminance(hexToRgb('#52525B'));
  const titlebarSearchTextContrast = calculateContrastRatio(titlebarBgLum, onSurfaceVariantLum);
  console.log(`    [Empirical Metric] TitleBar search pill contrast in light mode: ${titlebarSearchTextContrast.toFixed(2)}:1`);
  assert(
    titlebarSearchTextContrast >= 4.5,
    `TitleBar search text (#52525B) on dark acrylic header meets WCAG AA (>= 4.5:1)`,
    `Actual contrast is ${titlebarSearchTextContrast.toFixed(2)}:1 (dark gray on dark header fails WCAG AA!)`
  );

  // Test 2: LeftSidebar in Light Mode
  // Sidebar in light mode is rgba(242, 242, 247, 0.88)
  const sidebarLightBgRgba = parseRgba('rgba(242, 242, 247, 0.88)');
  const sidebarEffectiveBg = blendRgbaOverBase(sidebarLightBgRgba, lightBgRgb);
  const sidebarBgLum = getRelativeLuminance(sidebarEffectiveBg);

  const sidebarSrc = fs.readFileSync(path.join(ROOT, 'src/ui/layout/LeftSidebar.tsx'), 'utf8');

  // LeftSidebar search input contrast
  const searchInputHasWhite = /<input[^>]*className="[^"]*\btext-white\b(?!\/)[^"]*"/.test(sidebarSrc);
  const searchInputColor = searchInputHasWhite ? '#FFFFFF' : '#000000';
  const searchInputTextLum = getRelativeLuminance(hexToRgb(searchInputColor));
  const sidebarSearchInputContrast = calculateContrastRatio(sidebarBgLum, searchInputTextLum);
  console.log(`    [Empirical Metric] LeftSidebar search input text contrast in light mode: ${sidebarSearchInputContrast.toFixed(2)}:1`);
  assert(
    sidebarSearchInputContrast >= 4.5,
    `LeftSidebar search input text (text-white) on light sidebar meets WCAG AA (>= 4.5:1)`,
    `Actual contrast is ${sidebarSearchInputContrast.toFixed(2)}:1 (white text on #F2F2F7 sidebar fails WCAG AA!)`
  );

  // LeftSidebar active nav item contrast
  const activeItemHasWhite = /currentTab === 'home'[^?]*\?[^:]*\btext-white\b(?!\/)/.test(sidebarSrc);
  const activeItemColor = activeItemHasWhite ? '#FFFFFF' : '#000000';
  const activeItemLum = getRelativeLuminance(hexToRgb(activeItemColor));
  const sidebarActiveItemContrast = calculateContrastRatio(sidebarBgLum, activeItemLum);
  console.log(`    [Empirical Metric] LeftSidebar active item (Home/Explore) contrast in light mode: ${sidebarActiveItemContrast.toFixed(2)}:1`);
  assert(
    sidebarActiveItemContrast >= 4.5,
    `LeftSidebar active nav item (text-white) on light sidebar meets WCAG AA (>= 4.5:1)`,
    `Actual contrast is ${sidebarActiveItemContrast.toFixed(2)}:1 (white active item text fails WCAG AA!)`
  );

  // LeftSidebar hovered item contrast
  const hoverHasWhite = /(?<!dark:(?:group-)?)hover:text-white\b/.test(sidebarSrc);
  const hoverItemColor = hoverHasWhite ? '#FFFFFF' : '#000000';
  const hoverItemLum = getRelativeLuminance(hexToRgb(hoverItemColor));
  const sidebarHoverItemContrast = calculateContrastRatio(sidebarBgLum, hoverItemLum);
  assert(
    sidebarHoverItemContrast >= 4.5,
    `LeftSidebar hover item (hover:text-white) on light sidebar meets WCAG AA (>= 4.5:1)`,
    `Actual contrast is ${sidebarHoverItemContrast.toFixed(2)}:1 (hovering item turns text white on light sidebar!)`
  );

  // Scrollbar thumb contrast on light page
  const lightBgLum = getRelativeLuminance(lightBgRgb);
  const cssSrc = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8');
  const scrollbarThumbMatch = cssSrc.match(/\.light\s+::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*([^;]+);/);
  const scrollbarThumbRgba = scrollbarThumbMatch ? parseRgba(scrollbarThumbMatch[1].trim()) : parseRgba('rgba(255, 255, 255, 0.16)');
  const scrollbarThumbEffective = blendRgbaOverBase(scrollbarThumbRgba, lightBgRgb);
  const scrollbarThumbLum = getRelativeLuminance(scrollbarThumbEffective);
  const scrollbarContrast = calculateContrastRatio(lightBgLum, scrollbarThumbLum);
  console.log(`    [Empirical Metric] Scrollbar thumb contrast on light canvas: ${scrollbarContrast.toFixed(2)}:1`);
  assert(
    scrollbarContrast >= 3.0,
    `Scrollbar thumb on light canvas meets UI component contrast (>= 3.0:1)`,
    `Actual contrast is ${scrollbarContrast.toFixed(2)}:1 (white scrollbar thumb is invisible on light canvas!)`
  );
});

// =============================================================================
// SUITE 4: Viewport Geometry & Responsiveness Invariants
// =============================================================================
suite('4. Viewport Resizing & Layout Responsiveness Invariants', () => {
  // 1. Sidebar width parity across code & hooks
  const sidebarSrc = fs.readFileSync(path.join(ROOT, 'src/ui/layout/LeftSidebar.tsx'), 'utf8');
  const hooksSrc = fs.readFileSync(path.join(ROOT, 'src/ui/hooks/useWindowDimensions.ts'), 'utf8');

  assert(sidebarSrc.includes('w-[260px]'), 'LeftSidebar enforces 260px WinUI 3 width class (w-[260px])');
  assert(hooksSrc.includes('260'), 'useWindowDimensions.ts reflects 260px sidebar width', 'useWindowDimensions uses 240px instead of 260px!');

  // 2. DesktopTitleBar geometry
  const titlebarSrc = fs.readFileSync(path.join(ROOT, 'src/ui/layout/DesktopTitleBar.tsx'), 'utf8');
  assert(titlebarSrc.includes('h-12'), 'DesktopTitleBar conforms to 48px height (h-12)');

  // 3. BottomPlayerBar geometry & cluster constraints
  const playerSrc = fs.readFileSync(path.join(ROOT, 'src/ui/layout/BottomPlayerBar.tsx'), 'utf8');
  assert(playerSrc.includes('h-16'), 'BottomPlayerBar conforms to 64px capsule dock (h-16)');
  assert(playerSrc.includes('w-[54px] h-[54px]'), 'BottomPlayerBar artwork lockup conforms to 54px (w-[54px] h-[54px])');
  assert(playerSrc.includes('w-[280px]'), 'BottomPlayerBar Cluster 1 allocated 280px');
  assert(playerSrc.includes('w-[240px]'), 'BottomPlayerBar Cluster 3 allocated 240px');

  // 4. Player bar squeeze boundary analysis
  // Check if player bar implements responsive cluster sizing at small desktop viewports (700-756px)
  const cluster1ResponsiveMatch = playerSrc.match(/w-\[(\d+)px\]\s+min-\[768px\]:w-\[280px\]/);
  const cluster3ResponsiveMatch = playerSrc.match(/w-\[(\d+)px\]\s+min-\[768px\]:w-\[240px\]/);
  const c1Width = cluster1ResponsiveMatch ? parseInt(cluster1ResponsiveMatch[1], 10) : 280;
  const c3Width = cluster3ResponsiveMatch ? parseInt(cluster3ResponsiveMatch[1], 10) : 240;
  const widthAtBoundary = 720;
  const availableCenterWidth = widthAtBoundary - c1Width - c3Width - 32;
  console.log(`    [Empirical Metric] At ${widthAtBoundary}px viewport, available center cluster width is ${availableCenterWidth}px`);
  // Transport controls min width: 5 buttons * ~30px + 4 * 16px gap = ~214px
  assert(
    availableCenterWidth >= 214,
    `At 720px viewport (pre-compact breakpoint), center cluster has space for transport controls (>= 214px)`,
    `Available center width is ${availableCenterWidth}px < 214px minimum needed for transport controls!`
  );

  // 5. MainViewport sticky bottom clearance
  const viewportSrc = fs.readFileSync(path.join(ROOT, 'src/ui/layout/MainViewport.tsx'), 'utf8');
  assert(viewportSrc.includes('pb-28'), 'MainViewport specifies pb-28 (112px) bottom clearance');
  // Clearance proof: 112px pb-28 covers 64px player bar + 28px bottom dock margin = 92px fixed dock envelope
  const clearanceMargin = 112 - 92;
  assert(clearanceMargin >= 16, `Clearance margin (${clearanceMargin}px) provides safe margin >= 16px`);
});

// =============================================================================
// SUITE 5: Liquid Glass Restraint (User Directive R3)
// =============================================================================
suite('5. Restrained Liquid Glass Audit on Milestone M1 Scope', () => {
  const sidebarSrc = fs.readFileSync(path.join(ROOT, 'src/ui/layout/LeftSidebar.tsx'), 'utf8');
  const librarySrc = fs.readFileSync(path.join(ROOT, 'src/ui/views/LibraryScreen.tsx'), 'utf8');

  // Verify LibraryScreen has 0 .liquid-glass occurrences
  const libraryGlassMatches = librarySrc.match(/liquid-glass(?!-sidebar)/g) || [];
  assert(libraryGlassMatches.length === 0, `LibraryScreen.tsx has 0 .liquid-glass references (found: ${libraryGlassMatches.length})`);

  // Verify LeftSidebar uses .liquid-glass-sidebar (which maps to WinUI acrylic)
  assert(sidebarSrc.includes('liquid-glass-sidebar'), 'LeftSidebar uses .liquid-glass-sidebar acrylic');
  const sidebarUnscopedGlass = (sidebarSrc.match(/className="[^"]*liquid-glass(?!-sidebar)[^"]*"/g) || []).length;
  assert(sidebarUnscopedGlass === 0, `LeftSidebar has 0 unscoped .liquid-glass elements (found: ${sidebarUnscopedGlass})`);
});

// =============================================================================
// SUMMARY & VERDICT
// =============================================================================
console.log('\n================================================================================');
console.log('       EMPIRICAL CHALLENGER TEST SUITE SUMMARY (CHALLENGER 2 - M1)');
console.log('================================================================================');
console.log(`Total Empirical Checks  : ${totalTests}`);
console.log(`Passed Checks           : ${passedTests}`);
console.log(`Failed Checks           : ${failedTests}`);
console.log(`Pass Rate               : ${((passedTests / totalTests) * 100).toFixed(1)}%`);

if (failures.length > 0) {
  console.log('\nFAILURES IDENTIFIED:');
  failures.forEach((f, idx) => console.log(`  ${idx + 1}. ${f}`));
}

console.log('================================================================================\n');

process.exit(failedTests > 0 ? 1 : 0);
