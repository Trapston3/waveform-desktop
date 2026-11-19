// ==============================================================================
// tests/adversarial_challenge_m2_shell_stress.mjs
// Milestone M2 Adversarial Stress Suite: macOS Shell Chrome, Navigation & Audio Controls
// Challenger: challenger_m2_1 (Empirical Challenger)
//
// Invariants Verified:
// 1. macOS TitleBar Chrome & Traffic Light Micro-Glyphs
// 2. Translucent Vibrancy Sidebar Navigation & Search Sync
// 3. BottomPlayerBar Cluster Sizing, Volume Relative Adjustments & Badges
// 4. Sidecar Tab Switching & Queue Tier Mutations Isolation
// ==============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// Register ESM resolution hook for relative .ts and .tsx imports
register('./helpers/tsxLoader.mjs', import.meta.url);

const { usePlayerStore } = await import('../src/state/playerStore.ts');
const { useNavigationStore } = await import('../src/state/navigationStore.ts');
const { useQueueStore } = await import('../src/state/queueStore.ts');
const { normalizeSong } = await import('../src/models/Song.ts');

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
  console.log(`\n\x1b[1m\x1b[36m=== [SHELL STRESS SUITE] ${name} ===\x1b[0m`);
  fn();
}

async function asyncSuite(name, fn) {
  console.log(`\n\x1b[1m\x1b[36m=== [SHELL STRESS SUITE] ${name} ===\x1b[0m`);
  await fn();
}

// =============================================================================
// SUITE 1: MACOS TITLEBAR CHROME & TRAFFIC LIGHT INTEGRATION
// =============================================================================
suite('1. macOS TitleBar Chrome & Traffic Light Invariants', () => {
  const titleBarPath = path.join(ROOT, 'src/ui/layout/DesktopTitleBar.tsx');
  assert(fs.existsSync(titleBarPath), 'src/ui/layout/DesktopTitleBar.tsx exists');
  const titleBarSrc = fs.readFileSync(titleBarPath, 'utf8');

  // Traffic lights: red #FF5F56, yellow #FFBD2E, green #27C93F
  assert(titleBarSrc.includes('#FF5F56'), 'TitleBar includes macOS Red close button (#FF5F56)');
  assert(titleBarSrc.includes('#FFBD2E'), 'TitleBar includes macOS Yellow minimize button (#FFBD2E)');
  assert(titleBarSrc.includes('#27C93F'), 'TitleBar includes macOS Green zoom button (#27C93F)');
  assert(titleBarSrc.includes('mac-traffic-btn'), 'Traffic lights use .mac-traffic-btn class for hover micro-glyphs');

  // Navigation chevrons (28x28px)
  assert(titleBarSrc.includes('w-7 h-7') || titleBarSrc.includes('28px'), 'Back/Forward buttons sized to 28x28px');

  // Windows 11 caption buttons for cross-platform support
  assert(titleBarSrc.includes('#E81123'), 'Windows caption close button includes native #E81123 hover fill');

  // CSS rules for traffic buttons in index.css
  const cssSrc = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8');
  assert(cssSrc.includes('.mac-traffic-btn'), 'index.css defines .mac-traffic-btn styling');
  assert(cssSrc.includes('.mac-traffic-group:hover .mac-traffic-btn svg'), 'index.css reveals traffic light SVG micro-glyphs on group hover');
});

// =============================================================================
// SUITE 2: TRANSLUCENT VIBRANCY SIDEBAR HIERARCHY
// =============================================================================
suite('2. Translucent Vibrancy Sidebar Hierarchy & Apple Music Styling', () => {
  const sidebarPath = path.join(ROOT, 'src/ui/layout/LeftSidebar.tsx');
  assert(fs.existsSync(sidebarPath), 'src/ui/layout/LeftSidebar.tsx exists');
  const sidebarSrc = fs.readFileSync(sidebarPath, 'utf8');

  // Top search field
  assert(sidebarSrc.includes('type="text"') && sidebarSrc.includes('placeholder="Search"'), 'Sidebar includes integrated top search input');

  // WaveForm Music section
  assert(
    sidebarSrc.includes('LogoTransparent.svg') && sidebarSrc.includes('Music'),
    'Sidebar defines WaveForm Music branding section header'
  );
  assert(sidebarSrc.includes('Home') && sidebarSrc.includes('Explore') && sidebarSrc.includes('Radio & Party'), 'Apple Music section includes Home, Explore, Radio & Party');

  // Library section
  assert(sidebarSrc.includes('Library'), 'Sidebar defines "Library" section header');
  assert(sidebarSrc.includes('Recently Added') && sidebarSrc.includes('Artists') && sidebarSrc.includes('Albums (3D Flow)') && sidebarSrc.includes('Songs') && sidebarSrc.includes('Local Media'), 'Library section includes Recently Added, Artists, Albums, Songs, Local Media');

  // Playlists section
  assert(sidebarSrc.includes('Playlists'), 'Sidebar defines "Playlists" section header');
  assert(sidebarSrc.includes('Favorites'), 'Playlists section includes Favorites smart playlist');

  // Apple Music #FA2D48 accent pill
  assert(sidebarSrc.includes('#FA2D48'), 'Sidebar active indicators use Apple Music #FA2D48 crimson color');
  assert(sidebarSrc.includes('w-[2.5px]'), 'Sidebar active indicator uses refined 2.5px vertical bar');
});

// =============================================================================
// SUITE 3: BOTTOM PLAYER BAR ERGONOMIC CLUSTERS & AUDIO CONTROLS
// =============================================================================
await asyncSuite('3. Bottom Player Bar Clusters, Badges & Audio Control Invariants', async () => {
  const playerBarPath = path.join(ROOT, 'src/ui/layout/BottomPlayerBar.tsx');
  const playerBarSrc = fs.readFileSync(playerBarPath, 'utf8');

  // Cluster 1 (Left ~280px)
  assert(playerBarSrc.includes('w-[280px]'), 'Cluster 1 left allocation is 280px');
  assert(playerBarSrc.includes('w-12 h-12') || playerBarSrc.includes('48px'), 'Artwork thumbnail is 48x48px');
  assert(playerBarSrc.includes('ATMOS') || playerBarSrc.includes('LOSSLESS'), 'Provides Hi-Res Lossless / Dolby Atmos audio badge');

  // Cluster 2 (Center flex-1)
  assert(playerBarSrc.includes('flex-1 max-w-[680px]') || playerBarSrc.includes('max-w-[640px]') || playerBarSrc.includes('flex-1'), 'Cluster 2 center flex scrubber is centered and ergonomically constrained');

  // Cluster 3 (Right 240px)
  assert(playerBarSrc.includes('w-[240px]'), 'Cluster 3 right allocation is 240px');

  // Volume control responsiveness
  const { adjustVolumeRelative, setVolume } = usePlayerStore.getState();
  setVolume(0.5);
  assert(usePlayerStore.getState().volume === 0.5, 'Volume set to 0.5');

  adjustVolumeRelative(0.05);
  assert(Math.abs(usePlayerStore.getState().volume - 0.55) < 0.001, 'Relative volume adjustment +0.05 yields 0.55');

  adjustVolumeRelative(-0.1);
  assert(Math.abs(usePlayerStore.getState().volume - 0.45) < 0.001, 'Relative volume adjustment -0.10 yields 0.45');

  // Volume bounds clamping [0.0, 1.0]
  adjustVolumeRelative(2.0);
  assert(usePlayerStore.getState().volume === 1.0, 'Volume clamped at maximum 1.0');

  adjustVolumeRelative(-2.0);
  assert(usePlayerStore.getState().volume === 0.0, 'Volume clamped at minimum 0.0');

  setVolume(0.75);
});

// =============================================================================
// SUITE 4: 3-TIER QUEUE MUTATION & ISOLATION
// =============================================================================
suite('4. 3-Tier Queue Mutation & Player Capsule Isolation', () => {
  const songA = normalizeSong({ videoId: 'q-song-a', title: 'Song A', artist: 'Artist A' });
  const songB = normalizeSong({ videoId: 'q-song-b', title: 'Song B', artist: 'Artist B' });
  const songC = normalizeSong({ videoId: 'q-song-c', title: 'Song C', artist: 'Artist C' });

  const { addToUserQueue, setContextQueue, setAutoplayQueue, clearQueue, tiers } = useQueueStore.getState();

  clearQueue();
  assert(useQueueStore.getState().tiers.USER_QUEUE.length === 0, 'User queue initially empty');

  // Add items
  addToUserQueue(songA);
  assert(useQueueStore.getState().tiers.USER_QUEUE.length === 1, 'Song A added to USER_QUEUE');

  setContextQueue([songB]);
  assert(useQueueStore.getState().tiers.CONTEXT.length === 1, 'Song B added to CONTEXT');

  setAutoplayQueue([songC]);
  assert(useQueueStore.getState().tiers.AUTOPLAY.length === 1, 'Song C added to AUTOPLAY');

  // Verify priority order: USER_QUEUE -> CONTEXT -> AUTOPLAY
  const state = useQueueStore.getState();
  assert(state.tiers.USER_QUEUE[0].videoId === 'q-song-a', 'Priority Tier 1 is USER_QUEUE');
  assert(state.tiers.CONTEXT[0].videoId === 'q-song-b', 'Priority Tier 2 is CONTEXT');
  assert(state.tiers.AUTOPLAY[0].videoId === 'q-song-c', 'Priority Tier 3 is AUTOPLAY');

  clearQueue();
});

// =============================================================================
// SUMMARY REPORT
// =============================================================================
console.log('\n================================================================================');
console.log('       MILESTONE M2 SHELL STRESS VERIFICATION SUMMARY');
console.log('================================================================================');
console.log(`Total Shell Checks      : ${totalTests}`);
console.log(`Passed Checks           : \x1b[32m${passedTests}\x1b[0m`);
console.log(`Failed Checks           : ${failedTests > 0 ? `\x1b[31m${failedTests}\x1b[0m` : '\x1b[32m0\x1b[0m'}`);
console.log(`Success Rate            : ${((passedTests / totalTests) * 100).toFixed(1)}%`);
console.log('================================================================================\n');

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
