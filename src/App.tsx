// src/App.tsx
// Root application workstation shell integrating navigation, audio controller, modals, and desktop ergonomics

import React, { useEffect, useCallback } from 'react';
import { DesktopTitleBar } from './ui/layout/DesktopTitleBar';
import { LeftSidebar, NavTab } from './ui/layout/LeftSidebar';
import { MainViewport } from './ui/layout/MainViewport';
import { RightSidecar } from './ui/layout/RightSidecar';
import { BottomPlayerBar } from './ui/layout/BottomPlayerBar';

import { usePlayerStore } from './state/playerStore';
import { useQueueStore } from './state/queueStore';
import { useLibraryStore } from './state/libraryStore';
import { useSettingsStore } from './state/settingsStore';
import { useNavigationStore } from './state/navigationStore';

import { useAudioController } from './ui/hooks/useAudioController';
import { useKeyboardShortcuts } from './ui/hooks/useKeyboardShortcuts';
import { useWindowDimensions } from './ui/hooks/useWindowDimensions';
import { useContextMenu } from './ui/hooks/useContextMenu';

import { SettingsModal } from './ui/common/SettingsModal';
import { CreatePlaylistModal } from './ui/common/CreatePlaylistModal';
import { ErrorBoundary } from './ui/common/ErrorBoundary';
import { NowPlayingScreen } from './ui/player/NowPlayingScreen';
import { ReplayStoriesModal } from './ui/player/ReplayStoriesModal';
import { EqualizerModal } from './ui/player/EqualizerModal';
import { ContextMenu } from './ui/common/ContextMenu';
import { AmbientViewportApp } from './lyricVisualizer/ui/AmbientViewportApp';
import { useLyricVisualizerStore } from './lyricVisualizer/state/lyricVisualizerStore';

export const App: React.FC = () => {
  // 1. Initialize stores and background services on app mount
  useEffect(() => {
    usePlayerStore.getState().initEngine();
    useLibraryStore.getState().initLibrary();
    useSettingsStore.getState().initSettings();
  }, []);

  // 2. Wire desktop hooks
  useAudioController();
  useKeyboardShortcuts();
  const dimensions = useWindowDimensions();
  const { menuState, openContextMenu, closeContextMenu } = useContextMenu();

  // 3. Navigation store state
  const {
    current,
    navigateToTab,
    isSettingsOpen,
    setSettingsOpen,
    isCreatePlaylistOpen,
    setCreatePlaylistOpen,
    isReplayOpen,
    setReplayOpen,
    isEqualizerOpen,
    setEqualizerOpen,
    isLyricsDrawerOpen,
    isQueueDrawerOpen,
    toggleLyricsDrawer,
    toggleQueueDrawer,
    setLyricsDrawerOpen,
    setQueueDrawerOpen,
  } = useNavigationStore();

  // 4. Playback store state
  const isNowPlayingModalOpen = usePlayerStore((s) => s.isNowPlayingModalOpen);
  const setNowPlayingModalOpen = usePlayerStore((s) => s.setNowPlayingModalOpen);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const isPlaying = playbackState === 'PLAYING';

  // 5. Library & Ambient portal store state
  const monthlyStats = useLibraryStore((s) => s.monthlyStats);
  const yearlyReplayStats = useLibraryStore((s) => s.yearlyReplayStats);
  const isAmbientOpen = useLyricVisualizerStore((s) => s.isAmbientOpen);

  const handleCloseReplay = useCallback(() => {
    setReplayOpen(false);
  }, [setReplayOpen]);

  // Inspector is open if either lyrics or queue is toggled and not in compact mode
  const isInspectorOpen = (isLyricsDrawerOpen || isQueueDrawerOpen) && dimensions.layoutMode !== 'compact';

  const handleCloseInspector = () => {
    setLyricsDrawerOpen(false);
    setQueueDrawerOpen(false);
  };

  const activeTabName: NavTab = current.type === 'tab' ? (current.tab as NavTab) : 'home';

  return (
    <div className="relative flex flex-col h-screen w-screen overflow-hidden bg-[var(--color-bg)] text-[var(--color-primary)] font-sans antialiased">
      {/* 0. Global SVG Lens Refraction Filter & Dynamic Artwork Ambient Mesh Backdrop */}
      <svg className="hidden" aria-hidden="true">
        <defs>
          <filter id="liquid-glass-lens" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.008 0.008" numOctaves="3" result="glassNoise" />
            {/* Chromatic aberration 3-pass RGB split */}
            <feDisplacementMap in="SourceGraphic" in2="glassNoise" scale="14" xChannelSelector="R" yChannelSelector="G" result="dispRed" />
            <feColorMatrix in="dispRed" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="redChannel" />
            <feDisplacementMap in="SourceGraphic" in2="glassNoise" scale="12" xChannelSelector="R" yChannelSelector="G" result="dispGreen" />
            <feColorMatrix in="dispGreen" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="greenChannel" />
            <feDisplacementMap in="SourceGraphic" in2="glassNoise" scale="10" xChannelSelector="R" yChannelSelector="G" result="dispBlue" />
            <feColorMatrix in="dispBlue" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blueChannel" />
            <feComposite in="redChannel" in2="greenChannel" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="rgBlend" />
            <feComposite in="rgBlend" in2="blueChannel" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="chromaticGlass" />
            {/* Directional 135° specular sheen */}
            <feGaussianBlur in="glassNoise" stdDeviation="1.5" result="sheenBlur" />
            <feSpecularLighting in="sheenBlur" surfaceScale="2" specularConstant="0.8" specularExponent="20" lightingColor="#ffffff" result="sheenLit">
              <feDistantLight azimuth="135" elevation="60" />
            </feSpecularLighting>
            <feComposite in="sheenLit" in2="SourceGraphic" operator="in" result="sheenTrim" />
            <feComposite in="chromaticGlass" in2="sheenTrim" operator="arithmetic" k1="0" k2="1" k3="0.5" k4="0" result="finalLens" />
          </filter>
          <filter id="liquid-glass-refraction" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.008 0.008" numOctaves="3" result="glassNoise" />
            <feDisplacementMap in="SourceGraphic" in2="glassNoise" scale="12" xChannelSelector="R" yChannelSelector="G" result="disp" />
            <feSpecularLighting in="glassNoise" surfaceScale="2" specularConstant="0.7" specularExponent="16" lightingColor="#ffffff" result="sheen">
              <feDistantLight azimuth="135" elevation="55" />
            </feSpecularLighting>
            <feComposite in="disp" in2="sheen" operator="arithmetic" k1="0" k2="1" k3="0.4" k4="0" />
          </filter>
        </defs>
      </svg>
      <div className="waveform-ambient-backdrop" aria-hidden="true" />

      {/* 1. Custom Frameless Liquid Glass Title Bar (Electron drag region) */}
      <DesktopTitleBar />

      {/* 2. Responsive 3-Column Workstation Shell */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative z-10">
        {/* Left Column: Collapsible Navigation Sidebar */}
        {!dimensions.isCompact && (
          <LeftSidebar
            currentTab={activeTabName}
            onSelectTab={(tab, subView) => {
              if (tab !== 'settings') {
                navigateToTab(tab, subView);
              } else {
                setSettingsOpen(true);
              }
            }}
          />
        )}

        {/* Center Column: Fluid Dynamic Viewport */}
        <MainViewport onOpenContextMenu={openContextMenu} />

        {/* Right Sidecar Drawer (Lyrics & Queue) */}
        <RightSidecar
          isOpen={isInspectorOpen}
          onClose={handleCloseInspector}
        />
      </div>

      {/* 3. Persistent Floating Liquid Glass Bottom Player Capsule */}
      <BottomPlayerBar
        isPlaying={isPlaying}
        onTogglePlay={togglePlay}
        isLyricsOpen={isLyricsDrawerOpen}
        onToggleLyrics={toggleLyricsDrawer}
        isQueueOpen={isQueueDrawerOpen}
        onToggleQueue={toggleQueueDrawer}
      />

      {/* 4. Desktop Dialogs & Overlays */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      <CreatePlaylistModal
        isOpen={isCreatePlaylistOpen}
        onClose={() => setCreatePlaylistOpen(false)}
      />

      <NowPlayingScreen
        isOpen={isNowPlayingModalOpen}
        onClose={() => setNowPlayingModalOpen(false)}
      />

      <ErrorBoundary
        onClose={handleCloseReplay}
        onReset={handleCloseReplay}
        resetKey={isReplayOpen}
        title="2026 Replay couldn't open"
      >
        <ReplayStoriesModal
          isOpen={isReplayOpen}
          onClose={handleCloseReplay}
          yearlyStats={yearlyReplayStats}
          monthlyStats={monthlyStats}
        />
      </ErrorBoundary>

      <EqualizerModal
        isOpen={isEqualizerOpen}
        onClose={() => setEqualizerOpen(false)}
      />

      <ContextMenu
        isOpen={menuState.isOpen}
        x={menuState.x}
        y={menuState.y}
        track={menuState.track}
        onClose={closeContextMenu}
      />

      {/* 5. In-App Fullscreen Ambient Mode Portal (100% live AudioEngine/Store sync) */}
      {isAmbientOpen && <AmbientViewportApp inAppPortal />}
    </div>
  );
};

export default App;
