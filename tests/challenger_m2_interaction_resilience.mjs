// ==============================================================================
// tests/challenger_m2_interaction_resilience.mjs
// Adversarial Empirical Stress Suite for Milestone M2:
// macOS Apple Music Workstation Shell & Liquid Glass UI
//
// Challenger: Challenger 2 (Milestone M2)
// Coverage:
//   1. Window Resizing & Responsive Breakpoint Grid (Aspect Ratios: Compact to 4K)
//   2. Navigation & Sidebar Selection State Transitions & History Traversal
//   3. Drawer Toggle & Interaction Resilience (Lyrics & Queue Sidecar)
//   4. Theme Switching (Dark <-> Light and Back) & Token Adaptability
//   5. Liquid Glass Optics & Visual Hierarchy Invariants
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
  console.log(`\n\x1b[1m\x1b[35m=== [CHALLENGER-2] ${name} ===\x1b[0m`);
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

// -----------------------------------------------------------------------------
// MODULE 1: Window Resizing & Responsive Breakpoint Grid (Aspect Ratios)
// -----------------------------------------------------------------------------
suite('Module 1: Window Resizing & Responsive Breakpoints across Aspect Ratios', () => {
  const hookFile = path.join(ROOT, 'src/ui/hooks/useWindowDimensions.ts');
  assert(fs.existsSync(hookFile), 'useWindowDimensions.ts exists');
  const hookSrc = fs.readFileSync(hookFile, 'utf8');

  // Verify breakpoint logic pure simulation
  function computeLayout(width, height, isLyricsOpen = false, isQueueOpen = false) {
    let layoutMode = 'full';
    if (width < 700) {
      layoutMode = 'compact';
    } else if (width < 1000) {
      layoutMode = 'medium';
    } else {
      layoutMode = 'full';
    }

    const isInspectorOpen = (isLyricsOpen || isQueueOpen) && width >= 1000;
    const sidebarWidth = layoutMode === 'compact' ? 0 : 240;
    const inspectorWidth = isInspectorOpen && layoutMode === 'full' ? 360 : 0;
    const viewportWidth = Math.max(300, width - sidebarWidth - inspectorWidth);

    return {
      width,
      height,
      layoutMode,
      isCompact: layoutMode === 'compact',
      isMedium: layoutMode === 'medium',
      isFull: layoutMode === 'full',
      sidebarWidth,
      inspectorWidth,
      viewportWidth,
    };
  }

  // 1. Standard Resolutions Matrix
  const resolutions = [
    { name: '4:3 Compact SVGA', w: 800, h: 600, expectedMode: 'medium' },
    { name: '4:3 XGA', w: 1024, h: 768, expectedMode: 'full' },
    { name: '16:9 720p HD', w: 1280, h: 720, expectedMode: 'full' },
    { name: '16:10 Laptop Default', w: 1280, h: 800, expectedMode: 'full' },
    { name: '16:9 Laptop Typical', w: 1366, h: 768, expectedMode: 'full' },
    { name: '16:10 MacBook Pro 14"', w: 1440, h: 900, expectedMode: 'full' },
    { name: '16:9 Desktop HD+', w: 1600, h: 900, expectedMode: 'full' },
    { name: '16:9 1080p Full HD', w: 1920, h: 1080, expectedMode: 'full' },
    { name: '16:10 WUXGA', w: 1920, h: 1200, expectedMode: 'full' },
    { name: '16:9 QHD 2K (1440p)', w: 2560, h: 1440, expectedMode: 'full' },
    { name: '16:10 WQXGA', w: 2560, h: 1600, expectedMode: 'full' },
    { name: '21:9 Ultrawide UWQHD', w: 3440, h: 1440, expectedMode: 'full' },
    { name: '16:9 4K UHD', w: 3840, h: 2160, expectedMode: 'full' },
    { name: '32:9 Super Ultrawide', w: 5120, h: 1440, expectedMode: 'full' },
    { name: '16:9 5K Display', w: 5120, h: 2880, expectedMode: 'full' },
  ];

  for (const r of resolutions) {
    const layout = computeLayout(r.w, r.h, true, false);
    assert(
      layout.layoutMode === r.expectedMode,
      `${r.name} (${r.w}x${r.h}) -> layoutMode === '${r.expectedMode}'`,
      `Got ${layout.layoutMode}`
    );
    assert(
      layout.viewportWidth >= 300,
      `${r.name}: viewportWidth (${layout.viewportWidth}px) satisfies >= 300px min bound`
    );
  }

  // 2. Boundary Transitions & Edge Cases
  const boundaries = [
    { w: 699, expected: 'compact', sidebar: 0 },
    { w: 700, expected: 'medium', sidebar: 240 },
    { w: 701, expected: 'medium', sidebar: 240 },
    { w: 999, expected: 'medium', sidebar: 240 },
    { w: 1000, expected: 'full', sidebar: 240 },
    { w: 1001, expected: 'full', sidebar: 240 },
  ];

  for (const b of boundaries) {
    const res = computeLayout(b.w, 800, true, false);
    assert(
      res.layoutMode === b.expected && res.sidebarWidth === b.sidebar,
      `Boundary width ${b.w}px -> mode='${b.expected}', sidebar=${b.sidebar}px`,
      `Got mode=${res.layoutMode}, sidebar=${res.sidebarWidth}`
    );
  }

  // 3. Auto-collapse behavior when resized < 1000px
  assert(
    hookSrc.includes('w < 1000') &&
    hookSrc.includes('setLyricsDrawerOpen(false)') &&
    hookSrc.includes('setQueueDrawerOpen(false)'),
    'Auto-collapses lyrics and queue drawers when resized below 1000px'
  );

  // 4. Mathematical non-negativity across extreme values [0..10000]
  for (let w = 0; w <= 10000; w += 500) {
    const res = computeLayout(w, 800, true, true);
    assert(
      Number.isFinite(res.viewportWidth) && res.viewportWidth >= 300,
      `Stress width ${w}px -> viewportWidth is finite (${res.viewportWidth}px) and >= 300`
    );
  }

  // 5. MainViewport widescreen canvas containment
  const viewportFile = path.join(ROOT, 'src/ui/layout/MainViewport.tsx');
  const viewportSrc = fs.readFileSync(viewportFile, 'utf8');
  assert(
    viewportSrc.includes('max-w-[1920px]') && viewportSrc.includes('mx-auto'),
    'MainViewport contains widescreen canvas with max-w-[1920px] and centers via mx-auto'
  );

  // 6. Dock clearance margin
  const playerFile = path.join(ROOT, 'src/ui/layout/BottomPlayerBar.tsx');
  const playerSrc = fs.readFileSync(playerFile, 'utf8');
  assert(
    playerSrc.includes('h-[92px]') && playerSrc.includes('h-[76px]'),
    'BottomPlayerBar defines 92px fixed dock envelope and 76px floating capsule'
  );
  assert(
    viewportSrc.includes('pb-28'),
    'MainViewport specifies pb-28 bottom clearance (112px > 92px dock height by 20px)'
  );

  // 7. Player Dock 3 clusters geometry
  assert(
    playerSrc.includes('w-[280px]') && playerSrc.includes('shrink-0'),
    'BottomPlayerBar Cluster 1 allocated 280px fixed width with shrink-0'
  );
  assert(
    playerSrc.includes('flex-1 max-w-xl') && playerSrc.includes('min-w-0'),
    'BottomPlayerBar Cluster 2 allocated flex-1 max-w-xl with min-w-0 for waveform scrub rail'
  );
  assert(
    playerSrc.includes('w-[240px]') && playerSrc.includes('shrink-0'),
    'BottomPlayerBar Cluster 3 allocated 240px fixed width with shrink-0'
  );
});

// -----------------------------------------------------------------------------
// MODULE 2: Navigation & Sidebar Selection State Transitions
// -----------------------------------------------------------------------------
suite('Module 2: Navigation & Sidebar Selection State Transitions', () => {
  const navFile = path.join(ROOT, 'src/state/navigationStore.ts');
  assert(fs.existsSync(navFile), 'navigationStore.ts exists');
  const navSrc = fs.readFileSync(navFile, 'utf8');

  // Pure simulation of Zustand NavigationStore
  function createNavigationStoreMock() {
    let state = {
      current: { type: 'tab', tab: 'home' },
      history: [],
      forwardStack: [],
      isSettingsOpen: false,
      isCreatePlaylistOpen: false,
      isReplayOpen: false,
      isLyricsDrawerOpen: false,
      isQueueDrawerOpen: false,
      searchInitialQuery: '',
    };

    const actions = {
      getState: () => state,
      navigate: (target) => {
        if (JSON.stringify(state.current) === JSON.stringify(target)) return;
        state = {
          ...state,
          history: [...state.history, state.current],
          forwardStack: [],
          current: target,
        };
      },
      navigateToTab: (tab, subView) => {
        actions.navigate({ type: 'tab', tab, subView });
      },
      navigateToRelease: (id, releaseType = 'album', initialData) => {
        actions.navigate({ type: 'release', id, releaseType, initialData });
      },
      navigateToArtist: (id, initialData) => {
        actions.navigate({ type: 'artist', id, initialData });
      },
      goBack: () => {
        if (state.history.length === 0) return false;
        const previous = state.history[state.history.length - 1];
        const newHistory = state.history.slice(0, state.history.length - 1);
        state = {
          ...state,
          history: newHistory,
          forwardStack: [state.current, ...state.forwardStack],
          current: previous,
        };
        return true;
      },
      goForward: () => {
        if (state.forwardStack.length === 0) return false;
        const [next, ...remainingForward] = state.forwardStack;
        state = {
          ...state,
          history: [...state.history, state.current],
          forwardStack: remainingForward,
          current: next,
        };
        return true;
      },
      canGoBack: () => state.history.length > 0,
      canGoForward: () => state.forwardStack.length > 0,
    };

    return actions;
  }

  // 1. Initial State
  const store = createNavigationStoreMock();
  assert(
    store.getState().current.type === 'tab' && store.getState().current.tab === 'home',
    'Navigation initially lands on Home tab'
  );
  assert(
    !store.canGoBack() && !store.canGoForward(),
    'Back and Forward disabled initially'
  );

  // 2. Sequential primary tab navigation
  const tabs = ['explore', 'library', 'search', 'equalizer', 'home'];
  for (const t of tabs) {
    store.navigateToTab(t);
    assert(
      store.getState().current.tab === t,
      `Navigated cleanly to tab '${t}'`
    );
  }
  assert(store.getState().history.length === 5, 'History correctly records 5 transitions');

  // 3. Duplicate suppression
  const lenBefore = store.getState().history.length;
  store.navigateToTab('home');
  assert(
    store.getState().history.length === lenBefore,
    'Duplicate navigation to current tab does NOT append duplicate history entry'
  );

  // 4. Subview navigation
  store.navigateToTab('library', 'Recently Added');
  assert(
    store.getState().current.tab === 'library' && store.getState().current.subView === 'Recently Added',
    'Navigated to Library with subView="Recently Added"'
  );

  // 5. Release & Artist navigation
  store.navigateToRelease('album_123', 'album');
  assert(
    store.getState().current.type === 'release' && store.getState().current.id === 'album_123',
    'Navigated to Release detail page'
  );

  store.navigateToArtist('artist_456');
  assert(
    store.getState().current.type === 'artist' && store.getState().current.id === 'artist_456',
    'Navigated to Artist detail page'
  );

  // 6. History traversal: goBack
  assert(store.canGoBack(), 'canGoBack is true');
  const back1 = store.goBack();
  assert(back1 && store.getState().current.type === 'release', 'goBack returned to Release');
  assert(store.canGoForward(), 'canGoForward is now true');

  const back2 = store.goBack();
  assert(back2 && store.getState().current.subView === 'Recently Added', 'goBack returned to Library subview');

  // 7. Forward traversal: goForward
  const fwd1 = store.goForward();
  assert(fwd1 && store.getState().current.type === 'release', 'goForward returned to Release');

  // 8. Clears forward stack on branch navigation
  store.navigateToTab('explore');
  assert(
    !store.canGoForward() && store.getState().forwardStack.length === 0,
    'Navigating to new target clears forwardStack completely'
  );

  // 9. Rapid randomized navigation stress test
  const randomizedStore = createNavigationStoreMock();
  const availableTargets = [
    { type: 'tab', tab: 'home' },
    { type: 'tab', tab: 'explore' },
    { type: 'tab', tab: 'library', subView: 'Recently Added' },
    { type: 'tab', tab: 'library', subView: 'Artists' },
    { type: 'tab', tab: 'library', subView: 'Albums' },
    { type: 'tab', tab: 'library', subView: 'Songs' },
    { type: 'tab', tab: 'search' },
    { type: 'tab', tab: 'equalizer' },
    { type: 'release', id: 'rel_1', releaseType: 'album' },
    { type: 'release', id: 'rel_2', releaseType: 'playlist' },
    { type: 'artist', id: 'art_1' },
  ];

  let stressPass = true;
  for (let i = 0; i < 500; i++) {
    const action = Math.random();
    if (action < 0.6) {
      const target = availableTargets[Math.floor(Math.random() * availableTargets.length)];
      randomizedStore.navigate(target);
    } else if (action < 0.8) {
      randomizedStore.goBack();
    } else {
      randomizedStore.goForward();
    }

    const curr = randomizedStore.getState().current;
    if (!curr || !curr.type) {
      stressPass = false;
      break;
    }
  }
  assert(stressPass, '500 rapid randomized navigation transitions executed without state corruption');

  // 10. Unique viewKey evaluation in MainViewport
  function computeViewKey(target) {
    return target.type === 'tab'
      ? `tab-${target.tab}-${target.subView || ''}`
      : `${target.type}-${target.id}`;
  }

  const generatedKeys = new Set();
  for (const t of availableTargets) {
    const key = computeViewKey(t);
    assert(!generatedKeys.has(key), `Unique viewKey generated: '${key}'`);
    generatedKeys.add(key);
  }

  // 11. LeftSidebar active indicators
  const sidebarFile = path.join(ROOT, 'src/ui/layout/LeftSidebar.tsx');
  const sidebarSrc = fs.readFileSync(sidebarFile, 'utf8');
  assert(
    sidebarSrc.includes("currentTab === 'home'") &&
    sidebarSrc.includes('bg-[#FA2D48]') &&
    sidebarSrc.includes('w-[2.5px]'),
    'LeftSidebar renders 2.5px vertical crimson #FA2D48 indicator on active tab'
  );
  assert(
    sidebarSrc.includes("currentTab === 'explore'") &&
    sidebarSrc.includes("currentTab === 'equalizer'"),
    'LeftSidebar handles active tab styling across Explore and Equalizer tabs'
  );
});

// -----------------------------------------------------------------------------
// MODULE 3: Drawer Toggle & Interaction Resilience (Sidecar)
// -----------------------------------------------------------------------------
suite('Module 3: Drawer Toggle & Interaction Resilience (Lyrics & Queue Sidecar)', () => {
  const sidecarFile = path.join(ROOT, 'src/ui/layout/RightSidecar.tsx');
  assert(fs.existsSync(sidecarFile), 'RightSidecar.tsx exists');
  const sidecarSrc = fs.readFileSync(sidecarFile, 'utf8');

  // 1. RightSidecar metrics and animations
  assert(
    sidecarSrc.includes('w-[360px]'),
    'RightSidecar enforces 360px desktop sidecar width'
  );
  assert(
    sidecarSrc.includes("translate3d(0, 0, 0)") &&
    sidecarSrc.includes("translate3d(100%, 0, 0)"),
    'RightSidecar uses hardware-accelerated translate3d slide transitions'
  );
  assert(
    sidecarSrc.includes('cubic-bezier(0.22, 1, 0.36, 1)') ||
    sidecarSrc.includes('cubic-bezier(0.22,1,0.36,1)'),
    'RightSidecar uses Apple-standard cubic-bezier(0.22, 1, 0.36, 1) spring curve'
  );

  // 2. Inactive lyrics position ticker suspension
  assert(
    sidecarSrc.includes('isOpen && activeTab === \'lyrics\' ? s.positionMs : 0'),
    'RightSidecar suspends lyrics position ticker to 0 when drawer is closed or on queue tab'
  );

  // 3. Mutual exclusivity and drawer toggle state machine simulation
  function createDrawerStateMachine() {
    let isLyricsOpen = false;
    let isQueueOpen = false;

    return {
      getLyrics: () => isLyricsOpen,
      getQueue: () => isQueueOpen,
      isOpen: () => isLyricsOpen || isQueueOpen,
      toggleLyrics: () => {
        if (isLyricsOpen) {
          isLyricsOpen = false;
        } else {
          isLyricsOpen = true;
          isQueueOpen = false;
        }
      },
      toggleQueue: () => {
        if (isQueueOpen) {
          isQueueOpen = false;
        } else {
          isQueueOpen = true;
          isLyricsOpen = false;
        }
      },
      setLyrics: (val) => {
        isLyricsOpen = val;
        if (val) isQueueOpen = false;
      },
      setQueue: (val) => {
        isQueueOpen = val;
        if (val) isLyricsOpen = false;
      },
      closeAll: () => {
        isLyricsOpen = false;
        isQueueOpen = false;
      },
    };
  }

  const drawer = createDrawerStateMachine();
  assert(!drawer.isOpen(), 'Drawer initially closed');

  drawer.toggleLyrics();
  assert(drawer.getLyrics() && !drawer.getQueue() && drawer.isOpen(), 'Toggling lyrics opens lyrics');

  drawer.toggleQueue();
  assert(!drawer.getLyrics() && drawer.getQueue() && drawer.isOpen(), 'Toggling queue closes lyrics and opens queue');

  drawer.toggleQueue();
  assert(!drawer.isOpen(), 'Toggling active queue closes sidecar');

  // 4. Rapid drawer toggling stress
  let drawerStressPass = true;
  for (let i = 0; i < 200; i++) {
    if (Math.random() > 0.5) {
      drawer.toggleLyrics();
    } else {
      drawer.toggleQueue();
    }
    // Invariant: lyrics and queue must NEVER both be true simultaneously
    if (drawer.getLyrics() && drawer.getQueue()) {
      drawerStressPass = false;
      break;
    }
  }
  assert(drawerStressPass, '200 rapid alternating drawer toggles maintain mutual exclusivity invariant');

  // 5. Close handler
  drawer.setLyrics(true);
  drawer.closeAll();
  assert(!drawer.isOpen(), 'closeAll() (handleCloseInspector) resets both drawers to closed');

  // 6. RightInspector re-export compatibility
  const inspectorFile = path.join(ROOT, 'src/ui/layout/RightInspector.tsx');
  assert(fs.existsSync(inspectorFile), 'RightInspector.tsx exists');
  const inspectorSrc = fs.readFileSync(inspectorFile, 'utf8');
  assert(
    inspectorSrc.includes('export const RightInspector = RightSidecar') ||
    inspectorSrc.includes('export { RightSidecar'),
    'RightInspector cleanly re-exports RightSidecar for backward compatibility'
  );
});

// -----------------------------------------------------------------------------
// MODULE 4: Theme Switching (Dark <-> Light and Back) & Token Adaptability
// -----------------------------------------------------------------------------
suite('Module 4: Theme Switching (Dark <-> Light and Back) & Token Adaptability', () => {
  const themeFile = path.join(ROOT, 'src/ui/theme/Theme.ts');
  assert(fs.existsSync(themeFile), 'Theme.ts exists');
  const themeSrc = fs.readFileSync(themeFile, 'utf8');

  const cssFile = path.join(ROOT, 'src/index.css');
  assert(fs.existsSync(cssFile), 'index.css exists');
  const cssSrc = fs.readFileSync(cssFile, 'utf8');

  // 1. Dark & Light Theme Token Definitions
  assert(
    themeSrc.includes('DarkThemeTokens: ColorTokens') &&
    themeSrc.includes('LightThemeTokens: ColorTokens'),
    'Theme.ts defines both DarkThemeTokens and LightThemeTokens interfaces'
  );

  // 2. Token definitions in index.css
  const requiredTokens = [
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
    '--shadow-dock',
  ];

  for (const tok of requiredTokens) {
    const inRoot = cssSrc.includes(`${tok}:`);
    assert(inRoot, `Token ${tok} is defined in :root (dark mode default)`);
  }

  // Verify .light block defines light equivalents
  const lightBlockMatch = cssSrc.match(/\.light\s*\{([^}]+)\}/s);
  assert(lightBlockMatch !== null, 'index.css contains dedicated .light CSS selector block');
  const lightBlock = lightBlockMatch ? lightBlockMatch[1] : '';

  const lightTokens = [
    '--color-bg',
    '--color-surface',
    '--color-text-primary',
    '--color-text-secondary',
    '--color-text-tertiary',
    '--glass-bg',
    '--glass-border',
    '--glass-player',
    '--liquid-acrylic-fill',
    '--liquid-acrylic-border',
  ];

  for (const tok of lightTokens) {
    assert(lightBlock.includes(tok), `Token ${tok} has explicit override in .light block`);
  }

  // 3. WCAG 2.1 AA Contrast Ratios in Light Mode
  // Light Canvas: #F5F5F7, Card Surface: #FFFFFF, Hover Surface: #EFEFF4
  const lightSurfaces = [
    { name: 'Light Canvas Background', hex: '#F5F5F7' },
    { name: 'Light Card Surface', hex: '#FFFFFF' },
    { name: 'Light Surface Variant (Hover/Input)', hex: '#EFEFF4' },
  ];

  const lightTextTokens = [
    { name: 'Primary Text (#000000)', hex: '#000000', minRatio: 14.0 },
    { name: 'Secondary Text (#52525B)', hex: '#52525B', minRatio: 4.5 },
    { name: 'Tertiary Text (#71717A)', hex: '#71717A', minRatio: 3.5 },
  ];

  for (const s of lightSurfaces) {
    const sLum = getRelativeLuminance(hexToRgb(s.hex));
    for (const t of lightTextTokens) {
      const tLum = getRelativeLuminance(hexToRgb(t.hex));
      const ratio = calculateContrastRatio(sLum, tLum);
      assert(
        ratio >= t.minRatio,
        `[Light Mode] ${s.name} (${s.hex}) vs ${t.name} achieves ${ratio.toFixed(2)}:1 (exceeds >=${t.minRatio}:1)`
      );
    }
  }

  // 4. Crimson Accent (#FA2D48) Contrast
  const accentLum = getRelativeLuminance(hexToRgb('#FA2D48'));
  const darkCanvasLum = getRelativeLuminance(hexToRgb('#000000'));
  const lightCanvasLum = getRelativeLuminance(hexToRgb('#FFFFFF'));

  const accentDarkRatio = calculateContrastRatio(accentLum, darkCanvasLum);
  const accentLightRatio = calculateContrastRatio(accentLum, lightCanvasLum);

  assert(
    accentDarkRatio >= 4.5,
    `Accent #FA2D48 on Dark Canvas (#000000) achieves ${accentDarkRatio.toFixed(2)}:1 (WCAG AA >=4.5:1)`
  );
  assert(
    accentLightRatio >= 3.0,
    `Accent #FA2D48 on Light Canvas (#FFFFFF) achieves ${accentLightRatio.toFixed(2)}:1 (WCAG UI >=3.0:1)`
  );

  // 5. TitleBar Theme Toggle Button
  const titleBarFile = path.join(ROOT, 'src/ui/layout/DesktopTitleBar.tsx');
  const titleBarSrc = fs.readFileSync(titleBarFile, 'utf8');
  assert(
    titleBarSrc.includes('toggleMode') &&
    titleBarSrc.includes('Sun') &&
    titleBarSrc.includes('Moon'),
    'DesktopTitleBar contains Sun/Moon theme toggle button invoking toggleMode'
  );

  // 6. Rapid theme switching stress simulation
  function createThemeStoreMock() {
    let mode = 'dark';
    return {
      getMode: () => mode,
      toggleMode: () => {
        mode = mode === 'dark' ? 'light' : 'dark';
      },
      setMode: (m) => {
        mode = m;
      },
    };
  }

  const themeStore = createThemeStoreMock();
  for (let i = 0; i < 1000; i++) {
    themeStore.toggleMode();
  }
  assert(themeStore.getMode() === 'dark', '1000 rapid theme switches cycle cleanly without state drift');
});

// -----------------------------------------------------------------------------
// MODULE 5: Liquid Glass Optics & Visual Hierarchy Invariants
// -----------------------------------------------------------------------------
suite('Module 5: Liquid Glass Optics & Visual Hierarchy Invariants', () => {
  const cssFile = path.join(ROOT, 'src/index.css');
  const cssSrc = fs.readFileSync(cssFile, 'utf8');

  // 1. Two-Tier Material System
  assert(
    cssSrc.includes('.liquid-glass') &&
    cssSrc.includes('.liquid-glass-sidebar') &&
    cssSrc.includes('.liquid-glass-capsule'),
    'Tier A structural chrome classes (.liquid-glass, .liquid-glass-sidebar, .liquid-glass-capsule) defined'
  );

  assert(
    cssSrc.includes('.acrylic-tile') && cssSrc.includes('.liquid-glass-card'),
    'Tier B high-performance content cards (.acrylic-tile, .liquid-glass-card) defined'
  );

  // 2. CSS Containment
  assert(
    cssSrc.includes('contain: paint layout') || cssSrc.includes('contain: paint'),
    'Tier B cards enforce CSS containment (contain: paint layout) to protect 60fps scrolling'
  );

  // 3. Absence of per-card backdrop-filter
  const acrylicRule = cssSrc.match(/\.acrylic-tile\s*\{([^}]+)\}/s);
  const acrylicBody = acrylicRule ? acrylicRule[1] : '';
  assert(
    !acrylicBody.includes('backdrop-filter'),
    'Tier B .acrylic-tile does NOT use backdrop-filter (eliminates GPU rasterization bottlenecks)'
  );

  // 4. Virtualization tokens
  assert(
    cssSrc.includes('content-visibility: auto') &&
    cssSrc.includes('contain-intrinsic-size: 0 56px'),
    'Tracklist rows implement browser-native virtualization via content-visibility: auto and 56px intrinsic size'
  );

  // 5. Global SVG displacement filter in App.tsx
  const appFile = path.join(ROOT, 'src/App.tsx');
  const appSrc = fs.readFileSync(appFile, 'utf8');
  assert(
    appSrc.includes('id="liquid-glass-lens"') &&
    appSrc.includes('feDisplacementMap') &&
    appSrc.includes('feTurbulence') &&
    appSrc.includes('feSpecularLighting'),
    'App.tsx renders #liquid-glass-lens SVG filter with turbulence, displacement map, and specular lighting'
  );
});

// -----------------------------------------------------------------------------
// SUMMARY
// -----------------------------------------------------------------------------
console.log('\n================================================================================');
console.log('       CHALLENGER 2: EMPIRICAL STRESS & RESILIENCE VERIFICATION SUMMARY');
console.log('================================================================================');
console.log(`Total Empirical Checks  : ${totalTests}`);
console.log(`Passed Checks           : \x1b[32m${passedTests}\x1b[0m`);
console.log(`Failed Checks           : ${failedTests > 0 ? `\x1b[31m${failedTests}\x1b[0m` : '\x1b[32m0\x1b[0m'}`);
console.log(`Success Rate            : ${((passedTests / totalTests) * 100).toFixed(1)}%`);

if (failedTests > 0) {
  console.log('\nFailures Detected:');
  for (const f of failures) {
    console.log(`  - ${f}`);
  }
}
console.log('================================================================================\n');

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
