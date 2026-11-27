// src/ui/layout/MainViewport.tsx
// Zone 3: Fluid Center Viewport with generous pb-28 player dock clearance
// Hardware-accelerated view transitions, scroll position reset, and memoization

import React, { useRef, useEffect, memo } from 'react';
import { useNavigationStore } from '../../state/navigationStore';
import { HomeScreen } from '../views/HomeScreen';
import { ExploreScreen } from '../views/ExploreScreen';
import { LibraryScreen } from '../views/LibraryScreen';
import { SearchScreen } from '../views/SearchScreen';
import { EqualizerView } from '../views/EqualizerView';
import { ReleaseDetailView } from '../views/ReleaseDetailView';
import { ArtistDetailView } from '../views/ArtistDetailView';
import type { Song } from '../../models/Song';
import type { OpenContextMenuFn } from '../hooks/useContextMenu';

export interface MainViewportProps {
  currentTab?: string;
  onOpenContextMenu?: OpenContextMenuFn;
  onPlayTrack?: (track: any) => void;
}

export const MainViewport: React.FC<MainViewportProps> = memo(({ onOpenContextMenu }) => {
  const current = useNavigationStore((s) => s.current);
  const mainRef = useRef<HTMLElement>(null);

  // Compute unique view key for hardware-accelerated view transitions
  const viewKey =
    current.type === 'tab'
      ? `tab-${current.tab}-${current.subView || ''}`
      : `${current.type}-${current.id}`;

  // Instant scroll-to-top on view navigation to eliminate scroll retention bugs
  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.scrollTop = 0;
    }
  }, [viewKey]);

  return (
    <main
      ref={mainRef}
      className="flex-1 h-full overflow-y-auto overscroll-contain bg-transparent text-[var(--color-primary)] px-8 pt-6 pb-28 transition-colors duration-200"
    >
      <div className="w-full max-w-[1920px] mx-auto">
        <div key={viewKey} className="view-transition-container">
          {current.type === 'tab' && current.tab === 'home' && (
            <HomeScreen onOpenContextMenu={onOpenContextMenu} />
          )}
          {current.type === 'tab' && current.tab === 'explore' && <ExploreScreen onOpenContextMenu={onOpenContextMenu} />}
          {current.type === 'tab' && current.tab === 'library' && (
            <LibraryScreen initialSubTab={current.subView} onOpenContextMenu={onOpenContextMenu} />
          )}
          {current.type === 'tab' && current.tab === 'search' && (
            <SearchScreen onOpenContextMenu={onOpenContextMenu} />
          )}
          {current.type === 'tab' && current.tab === 'equalizer' && <EqualizerView />}
          {current.type === 'release' && (
            <ReleaseDetailView
              releaseId={current.id}
              releaseType={current.releaseType}
              onOpenContextMenu={onOpenContextMenu}
            />
          )}
          {current.type === 'artist' && (
            <ArtistDetailView
              artistId={current.id}
              onOpenContextMenu={onOpenContextMenu}
            />
          )}
        </div>
      </div>
    </main>
  );
});

MainViewport.displayName = 'MainViewport';
