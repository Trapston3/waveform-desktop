// tests/unit/ui_search_sidebar_lyrics.test.mjs
// Source and behavioral verification for Wave 2 Ticket C:
// - Unified Top-Left Search Bar + Autocomplete Popover in LeftSidebar (removed from DesktopTitleBar & SearchScreen)
// - Collapsible Apple Music Sidebar (isLibraryOpen, isPlaylistsOpen, clean 64px collapsed rail, hidden pin button when collapsed)
// - Minimal Mini-Lyrics in RightSidecar & RightInspector (subheader removed, zero 1Hz positionMs subscription, passes isActive)
// - 60fps Smooth Lyrics in SyllableLyricsEngine (rAF reading audio currentTime, GPU-only transform/opacity transitions, SpringScroller convergence)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const resolverHook = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && !specifier.endsWith('.ts') && !specifier.endsWith('.tsx') && !specifier.endsWith('.js') && !specifier.endsWith('.mjs')) {
      for (const ext of ['.ts', '.tsx', '/index.ts']) {
        try {
          return await nextResolve(specifier + ext, context);
        } catch {}
      }
    }
    throw err;
  }
}
`;
register(`data:text/javascript,${encodeURIComponent(resolverHook)}`, import.meta.url);

const { useNavigationStore } = await import('../../src/state/navigationStore.ts');
const { default: esbuild } = await import('esbuild');

const readSrc = (relPath) => readFileSync(path.join(rootDir, relPath), 'utf8');

// Extract & transpile real SpringScroller class from SyllableLyricsEngine.tsx
const lyricsEngineSrc = readSrc('src/ui/player/SyllableLyricsEngine.tsx');
const springStart = lyricsEngineSrc.indexOf('export class SpringScroller');
const springEnd = lyricsEngineSrc.indexOf('interface LyricLineRowProps');
const springTs = lyricsEngineSrc.slice(springStart, springEnd);
const springJs = esbuild.transformSync(springTs, { loader: 'ts' }).code.replace('export class', 'class');
const SpringScroller = new Function(`${springJs}; return SpringScroller;`)();

describe('Wave 2 Ticket C: Unified Top-Left Search & Navigation Store', () => {
  test('navigationStore manages searchQuery, setSearchInitialQuery sync, and requestSearchFocus counter', () => {
    const store = useNavigationStore;
    store.setState({
      searchQuery: '',
      searchInitialQuery: '',
      searchFocusCounter: 0,
    });

    store.getState().setSearchQuery('Daft Punk');
    assert.equal(store.getState().searchQuery, 'Daft Punk');

    store.getState().setSearchInitialQuery('The Strokes');
    assert.equal(store.getState().searchInitialQuery, 'The Strokes');
    assert.equal(store.getState().searchQuery, 'The Strokes');

    const beforeFocus = store.getState().searchFocusCounter;
    store.getState().requestSearchFocus();
    assert.equal(store.getState().searchFocusCounter, beforeFocus + 1);
    store.getState().requestSearchFocus();
    assert.equal(store.getState().searchFocusCounter, beforeFocus + 2);
  });

  test('useKeyboardShortcuts routes Ctrl/Cmd+K and Ctrl/Cmd+F to navigationStore.requestSearchFocus()', () => {
    const shortcutsSrc = readSrc('src/ui/hooks/useKeyboardShortcuts.ts');
    assert.equal(shortcutsSrc.includes('useNavigationStore.getState().requestSearchFocus()'), true);
    assert.equal(shortcutsSrc.includes('options?.onFocusSearch?.()'), true);
  });

  test('DesktopTitleBar removes center search pill while preserving h-10, w-7 h-7, and #E81123', () => {
    const titleBarSrc = readSrc('src/ui/layout/DesktopTitleBar.tsx');
    assert.equal(titleBarSrc.includes('waveform-search-input'), false);
    assert.equal(titleBarSrc.includes('handleSearchClick'), false);
    assert.equal(titleBarSrc.includes('<kbd'), false);
    assert.equal(titleBarSrc.includes('h-10'), true);
    assert.equal(titleBarSrc.includes('w-7 h-7'), true);
    assert.equal(titleBarSrc.includes('#E81123'), true);
  });

  test('SearchScreen removes redundant search input and reads searchQuery from navigationStore', () => {
    const searchSrc = readSrc('src/ui/views/SearchScreen.tsx');
    assert.equal(searchSrc.includes('id="waveform-search-input"'), false);
    assert.equal(searchSrc.includes('<input'), false);
    assert.equal(searchSrc.includes('useNavigationStore((s) => s.searchQuery)'), true);
    assert.equal(searchSrc.includes('useNavigationStore((s) => s.setSearchQuery)'), true);
    assert.equal(searchSrc.includes('acrylic-tile'), true);
  });
});

describe('Wave 2 Ticket C: Collapsible Apple Music LeftSidebar & Autocomplete Popover', () => {
  test('LeftSidebar hosts sole top-left search input, Ctrl+K badge, autocomplete popover, and collapsible Library/Playlists accordions', () => {
    const sidebarSrc = readSrc('src/ui/layout/LeftSidebar.tsx');
    assert.equal(sidebarSrc.includes('waveform-search-input'), false);
    assert.equal(sidebarSrc.includes('w-60'), true);
    assert.equal(sidebarSrc.includes('2.5px'), true);
    assert.equal(sidebarSrc.includes('text-white'), true);
    assert.equal(sidebarSrc.includes('Ctrl+K'), true);
    assert.equal(sidebarSrc.includes('getSearchSuggestions'), true);
    assert.equal(sidebarSrc.includes('isLibraryOpen'), true);
    assert.equal(sidebarSrc.includes('isPlaylistsOpen'), true);
    assert.equal(sidebarSrc.includes('grid-rows-[1fr]'), true);
    assert.equal(sidebarSrc.includes('grid-rows-[0fr]'), true);
    assert.equal(sidebarSrc.includes('searchFocusCounter'), true);
    assert.equal(sidebarSrc.includes('requestSearchFocus'), true);

    // Pin/Collapse toggle button is rendered only inside the isExpanded branch
    const toggleBtnOccurrences = (sidebarSrc.match(/onClick=\{toggleCollapse\}/g) || []).length;
    assert.equal(toggleBtnOccurrences, 1);
  });
});

describe('Wave 2 Ticket C: Minimal Mini-Lyrics & 60fps Smooth Lyrics Engine', () => {
  test('RightSidecar and RightInspector remove redundant mini-lyrics header and pass isActive without 1Hz positionMs subscription', () => {
    const sidecarSrc = readSrc('src/ui/layout/RightSidecar.tsx');
    assert.equal(sidecarSrc.includes('Syllable-Synced (Apple Music Style)'), false, 'RightSidecar must not contain mini-lyrics header');
    assert.equal(sidecarSrc.includes('Line-Synced'), false, 'RightSidecar must not contain Line-Synced subheader');
    assert.equal(sidecarSrc.includes('Plain Lyrics'), false, 'RightSidecar must not contain Plain Lyrics subheader');
    assert.equal(sidecarSrc.includes('s.positionMs'), false, 'RightSidecar must not subscribe to 1Hz positionMs');
    assert.equal(sidecarSrc.includes("isActive={isOpen && activeTab === 'lyrics'}"), true, 'RightSidecar must pass isActive to SyllableLyricsEngine');
    assert.equal(sidecarSrc.includes('w-[360px]'), true);
    assert.equal(sidecarSrc.includes('translate3d'), true);

    assert.equal(
      sidecarSrc.includes('export const RightInspector = RightSidecar;'),
      true,
      'src/ui/layout/RightSidecar.tsx must export RightInspector compatibility alias'
    );
  });

  test('SyllableLyricsEngine uses requestAnimationFrame currentTime, removes conflicting smooth scroll, and animates only GPU transform/opacity', () => {
    assert.equal(lyricsEngineSrc.includes('requestAnimationFrame'), true);
    assert.equal(lyricsEngineSrc.includes('getActiveAudioElement'), true);
    assert.equal(lyricsEngineSrc.includes('el.currentTime'), true);
    assert.equal(lyricsEngineSrc.includes('scroll-smooth'), false);
    assert.equal(lyricsEngineSrc.includes("behavior: 'smooth'"), false);
    assert.equal(lyricsEngineSrc.includes('filter: blur('), false);
    assert.equal(lyricsEngineSrc.includes('blur('), false);
    assert.equal(lyricsEngineSrc.includes(
      'transform 400ms cubic-bezier(0.22, 1, 0.36, 1), opacity 400ms cubic-bezier(0.22, 1, 0.36, 1)'
    ), true);
  });

  test('SpringScroller converges smoothly across sequential steps and seek target jumps without NaN or runaway oscillation', () => {
    const scroller = new SpringScroller(0);
    scroller.setTarget(420, 350, false);

    let settled = false;
    let steps = 0;
    let maxOvershoot = 0;

    while (!settled && steps < 300) {
      const res = scroller.step(1 / 60);
      assert.equal(Number.isFinite(res.position), true, 'Position must remain finite');
      if (res.position > 420) {
        maxOvershoot = Math.max(maxOvershoot, res.position - 420);
      }
      settled = res.isSettled;
      steps++;
    }

    assert.equal(settled, true, 'SpringScroller must settle within 300 frames at 60fps');
    assert.equal(scroller.getPosition(), 420);
    assert.equal(maxOvershoot < 2, true, `Critically damped spring should not oscillate wildly (overshoot=${maxOvershoot})`);

    // Test large seek target jump
    scroller.setTarget(1800, undefined, true);
    let seekSettled = false;
    let seekSteps = 0;
    while (!seekSettled && seekSteps < 400) {
      const res = scroller.step(1 / 60);
      assert.equal(Number.isFinite(res.position), true);
      seekSettled = res.isSettled;
      seekSteps++;
    }
    assert.equal(seekSettled, true, 'Seek spring jump must converge cleanly');
    assert.equal(scroller.getPosition(), 1800);
  });
});
