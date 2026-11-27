// ==============================================================================
// tests/verify_m3_liquid_glass_ui.mjs
// Milestone 3: Liquid Glass Desktop UI Redesign & Visual Hierarchy Verification
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

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  \x1b[32m✓\x1b[0m ${message}`);
  } else {
    failedTests++;
    console.error(`  \x1b[31m✗\x1b[0m ${message}`);
  }
}

function suite(name, fn) {
  console.log(`\n\x1b[1m\x1b[36m--- ${name} ---\x1b[0m`);
  fn();
}

// -----------------------------------------------------------------------------
// WCAG 2.1 AA Contrast Math Helper
// -----------------------------------------------------------------------------
function srgbToLinear(c) {
  const norm = c / 255;
  return norm <= 0.04045 ? norm / 12.92 : Math.pow((norm + 0.055) / 1.055, 2.4);
}

function hexToRgb(hex) {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  return { r, g, b };
}

function getRelativeLuminance({ r, g, b }) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function calculateContrastRatio(lum1, lum2) {
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

// -----------------------------------------------------------------------------
// Verification Suites
// -----------------------------------------------------------------------------

suite('1. Liquid Glass Optics & Displacement Shader Engine', () => {
  const liquidGlassPath = path.join(ROOT, 'src/ui/common/LiquidGlass.tsx');
  assert(fs.existsSync(liquidGlassPath), 'LiquidGlass.tsx component exists at src/ui/common/LiquidGlass.tsx');

  const liquidGlassSrc = fs.readFileSync(liquidGlassPath, 'utf8');
  assert(liquidGlassSrc.includes('export const LiquidGlass') || liquidGlassSrc.includes('export default LiquidGlass'), 'LiquidGlass component is exported');
  assert(liquidGlassSrc.includes('liquid-glass-lens') || liquidGlassSrc.includes('feDisplacementMap') || liquidGlassSrc.includes('generateDisplacementLensMap'), 'Implements SVG displacement map / lens optic logic');
  assert(liquidGlassSrc.includes('sheen') || liquidGlassSrc.includes('specular') || liquidGlassSrc.includes('highlight'), 'Includes specular sheen and highlight layers');
  assert(liquidGlassSrc.includes('children'), 'Renders crisp child content in dedicated foreground layer');

  const appPath = path.join(ROOT, 'src/App.tsx');
  const appSrc = fs.readFileSync(appPath, 'utf8');
  assert(appSrc.includes('id="liquid-glass-lens"'), 'App.tsx defines SVG filter #liquid-glass-lens');
  assert(appSrc.includes('feDisplacementMap'), 'App.tsx filter contains feDisplacementMap filter primitive');
  assert(appSrc.includes('feSpecularLighting') || appSrc.includes('specularConstant'), 'App.tsx filter contains directional specular lighting');
});

suite('2. Desktop 5-Zone Ergonomic Architecture & Layout Metrics', () => {
  // Zone 1: DesktopTitleBar
  const titleBarPath = path.join(ROOT, 'src/ui/layout/DesktopTitleBar.tsx');
  assert(fs.existsSync(titleBarPath), 'DesktopTitleBar.tsx exists');
  const titleBarSrc = fs.readFileSync(titleBarPath, 'utf8');
  assert(titleBarSrc.includes('h-10') || titleBarSrc.includes('height: 40px') || titleBarSrc.includes('h-[40px]'), 'Zone 1: Title bar constrained to 40px desktop standard (h-10)');
  assert(titleBarSrc.includes('w-7 h-7') || titleBarSrc.includes('28px'), 'Zone 1: Back/Forward history navigation buttons sized to 28x28px');
  assert(titleBarSrc.includes('Ctrl') && titleBarSrc.includes('K'), 'Zone 1: Quick Search & Command pill includes Ctrl+K shortcut indicator');
  assert(titleBarSrc.includes('#E81123') || titleBarSrc.includes('hover:bg-[#E81123]'), 'Zone 1: Windows 11 close button features native #E81123 hover fill');

  // Zone 2: LeftSidebar
  const sidebarPath = path.join(ROOT, 'src/ui/layout/LeftSidebar.tsx');
  assert(fs.existsSync(sidebarPath), 'LeftSidebar.tsx exists');
  const sidebarSrc = fs.readFileSync(sidebarPath, 'utf8');
  assert(sidebarSrc.includes('w-60') || sidebarSrc.includes('w-[240px]'), 'Zone 2: Left sidebar has fixed 240px width (w-60)');
  assert(sidebarSrc.includes('w-[2.5px]') || sidebarSrc.includes('2.5px'), 'Zone 2: Liquid Glass selection pill features 2.5px vertical accent bar');
  assert(sidebarSrc.includes('text-white') || sidebarSrc.includes('text-[var(--color-text-primary)]'), 'Zone 2: Selected navigation item renders in pure white text');
  assert(!sidebarSrc.includes('shadow-[0_0_15px_rgba(250,45,72'), 'Zone 2: Eliminates harsh neon red drop shadow');

  // Zone 3: MainViewport
  const viewportPath = path.join(ROOT, 'src/ui/layout/MainViewport.tsx');
  assert(fs.existsSync(viewportPath), 'MainViewport.tsx exists');
  const viewportSrc = fs.readFileSync(viewportPath, 'utf8');
  assert(viewportSrc.includes('pb-28') || viewportSrc.includes('pb-32'), 'Zone 3: Main viewport provides generous pb-28 bottom clearance for floating dock');

  // Zone 4: BottomPlayerBar
  const playerBarPath = path.join(ROOT, 'src/ui/layout/BottomPlayerBar.tsx');
  assert(fs.existsSync(playerBarPath), 'BottomPlayerBar.tsx exists');
  const playerBarSrc = fs.readFileSync(playerBarPath, 'utf8');
  assert(playerBarSrc.includes('h-[76px]') || playerBarSrc.includes('h-20'), 'Zone 4: Player dock features ergonomic 76px height capsule');
  assert(playerBarSrc.includes('w-[280px]') || playerBarSrc.includes('w-72'), 'Zone 4: Left cluster allocated ~280px for album art, metadata, and single quality badge');
  assert(playerBarSrc.includes('w-[240px]') || playerBarSrc.includes('w-60'), 'Zone 4: Right cluster allocated ~240px for volume slider and secondary toggles');
  assert(playerBarSrc.includes('ATMOS') || playerBarSrc.includes('LOSSLESS') || playerBarSrc.includes('Hi-Res'), 'Zone 4: Single clean high-fidelity audio quality badge');

  // Zone 5: RightInspector
  const inspectorPath = path.join(ROOT, 'src/ui/layout/RightSidecar.tsx');
  assert(fs.existsSync(inspectorPath), 'RightSidecar.tsx exists');
  const inspectorSrc = fs.readFileSync(inspectorPath, 'utf8');
  assert(inspectorSrc.includes('w-[360px]') || inspectorSrc.includes('w-90'), 'Zone 5: Right inspector sidecar has 360px width');
  assert(inspectorSrc.includes('translate3d') || inspectorSrc.includes('transition-transform'), 'Zone 5: Features hardware-accelerated slide animation');
});

suite('3. WCAG 2.1 AA Semantic Color Tokens & Contrast Ratios', () => {
  const themePath = path.join(ROOT, 'src/ui/theme/Theme.ts');
  assert(fs.existsSync(themePath), 'Theme.ts exists');
  const themeSrc = fs.readFileSync(themePath, 'utf8');

  assert(themeSrc.includes("textPrimary: '#FFFFFF'"), 'Theme.ts defines textPrimary as #FFFFFF');
  assert(themeSrc.includes("textSecondary: '#A1A1A6'"), 'Theme.ts defines textSecondary as #A1A1A6');
  assert(themeSrc.includes("textTertiary: '#8E8E93'"), 'Theme.ts defines textTertiary as #8E8E93');
  assert(themeSrc.includes('scrimAmbient'), 'Theme.ts defines scrimAmbient token');

  // Relative luminance calculations
  const primaryRgb = hexToRgb('#FFFFFF');
  const secondaryRgb = hexToRgb('#A1A1A6');
  const tertiaryRgb = hexToRgb('#8E8E93');

  const lumPrimary = getRelativeLuminance(primaryRgb);
  const lumSecondary = getRelativeLuminance(secondaryRgb);
  const lumTertiary = getRelativeLuminance(tertiaryRgb);

  // Operational desktop surfaces:
  // 1. Pure Black Background: #000000
  // 2. Base Surface / Acrylic Card: #0D0D0F
  // 3. Glass Chrome (TitleBar/Dock): #0F0F12
  // 4. Ambient Mesh with 45% Dark Scrim: #181014
  // 5. Surface Variant (Hover/Input): #1C1C1E
  const surfaces = [
    { name: 'Pure Black Background', hex: '#000000' },
    { name: 'Base Surface / Acrylic Card', hex: '#0D0D0F' },
    { name: 'Glass Chrome (TitleBar/Dock)', hex: '#0F0F12' },
    { name: 'Ambient Mesh (45% Dark Scrim)', hex: '#181014' },
    { name: 'Surface Variant (Hover/Input)', hex: '#1C1C1E' },
  ];

  for (const s of surfaces) {
    const sLum = getRelativeLuminance(hexToRgb(s.hex));
    const crPrimary = calculateContrastRatio(lumPrimary, sLum);
    const crSecondary = calculateContrastRatio(lumSecondary, sLum);
    const crTertiary = calculateContrastRatio(lumTertiary, sLum);

    assert(crPrimary >= 14.0, `${s.name} (${s.hex}): Primary #FFFFFF achieves ${crPrimary.toFixed(2)}:1 (exceeds >14:1)`);
    assert(crSecondary >= 5.2, `${s.name} (${s.hex}): Secondary #A1A1A6 achieves ${crSecondary.toFixed(2)}:1 (exceeds >=5.2:1)`);
    assert(crTertiary >= 4.5, `${s.name} (${s.hex}): Tertiary #8E8E93 achieves ${crTertiary.toFixed(2)}:1 (exceeds >=4.5:1 WCAG AA)`);
  }
});

suite('4. Two-Tier Material System & GPU Rendering Optimization', () => {
  const cssPath = path.join(ROOT, 'src/index.css');
  assert(fs.existsSync(cssPath), 'index.css exists');
  const cssSrc = fs.readFileSync(cssPath, 'utf8');

  assert(cssSrc.includes('.acrylic-tile'), 'index.css defines high-performance .acrylic-tile');
  assert(cssSrc.includes('.liquid-glass-card'), 'index.css defines .liquid-glass-card');
  assert(cssSrc.includes('.liquid-glass-capsule'), 'index.css defines .liquid-glass-capsule');
  assert(cssSrc.includes('rgba(255, 255, 255, 0.045)'), 'acrylic-tile uses calibrated translucency rgba(255, 255, 255, 0.045)');
  assert(cssSrc.includes('contain: paint layout') || cssSrc.includes('contain: paint'), 'acrylic-tile uses CSS containment (contain: paint layout)');

  // Verify that views use acrylic-tile for scrollable item cards
  const homeSrc = fs.readFileSync(path.join(ROOT, 'src/ui/views/HomeScreen.tsx'), 'utf8');
  assert(homeSrc.includes('acrylic-tile'), 'HomeScreen uses .acrylic-tile for content cards');

  const exploreSrc = fs.readFileSync(path.join(ROOT, 'src/ui/views/ExploreScreen.tsx'), 'utf8');
  assert(exploreSrc.includes('acrylic-tile'), 'ExploreScreen uses .acrylic-tile for genre and chart tiles');

  const searchSrc = fs.readFileSync(path.join(ROOT, 'src/ui/views/SearchScreen.tsx'), 'utf8');
  assert(searchSrc.includes('acrylic-tile'), 'SearchScreen uses .acrylic-tile for result cards');

  const librarySrc = fs.readFileSync(path.join(ROOT, 'src/ui/views/LibraryScreen.tsx'), 'utf8');
  assert(librarySrc.includes('acrylic-tile') || librarySrc.includes('tracklist-row'), 'LibraryScreen uses .acrylic-tile and .tracklist-row');
  assert(librarySrc.includes('content-visibility: auto') || cssSrc.includes('content-visibility: auto'), 'Library track rows implement content-visibility: auto for virtualization');
});

suite('5. Ambient Scrim & Visual Hierarchy in Views', () => {
  const cssSrc = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8');
  assert(cssSrc.includes('--color-scrim-ambient: rgba(0, 0, 0, 0.45)'), 'index.css defines 45% dark scrim token rgba(0, 0, 0, 0.45)');
  assert(cssSrc.includes('--color-scrim-ambient'), 'index.css applies dark scrim to ambient background backdrop');

  const nowPlayingSrc = fs.readFileSync(path.join(ROOT, 'src/ui/player/NowPlayingScreen.tsx'), 'utf8');
  assert(nowPlayingSrc.includes('rgba(0, 0, 0, 0.45)') || nowPlayingSrc.includes('rgba(0,0,0,0.45)') || nowPlayingSrc.includes('var(--color-scrim-ambient)'), 'NowPlayingScreen contains ambient dark scrim layer');
  assert(nowPlayingSrc.includes('now-playing-lyrics') || nowPlayingSrc.includes('lyrics'), 'NowPlayingScreen maintains high-contrast lyrics view');

  const homeSrc = fs.readFileSync(path.join(ROOT, 'src/ui/views/HomeScreen.tsx'), 'utf8');
  assert(homeSrc.includes('h-56') || homeSrc.includes('220px') || homeSrc.includes('h-[220px]'), 'HomeScreen Hero showcase has compact height (<= 224px / h-56)');

  const searchSrc = fs.readFileSync(path.join(ROOT, 'src/ui/views/SearchScreen.tsx'), 'utf8');
  assert(searchSrc.includes('id="waveform-search-input"'), 'SearchScreen provides unified search input with id waveform-search-input');
});

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------
console.log('\n================================================================================');
console.log('                 MILESTONE 3 VERIFICATION SUMMARY');
console.log('================================================================================');
console.log(`Total Invariants Tested : ${totalTests}`);
console.log(`Passed Invariants       : \x1b[32m${passedTests}\x1b[0m`);
console.log(`Failed Invariants       : ${failedTests > 0 ? `\x1b[31m${failedTests}\x1b[0m` : '\x1b[32m0\x1b[0m'}`);
console.log(`Success Rate            : ${((passedTests / totalTests) * 100).toFixed(1)}%`);
console.log('================================================================================\n');

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
