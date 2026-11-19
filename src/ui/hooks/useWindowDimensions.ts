// src/ui/hooks/useWindowDimensions.ts
// Responsive desktop workstation breakpoint engine conforming to Feature 4 & 24

import { useState, useEffect } from 'react';
import { useNavigationStore } from '../../state/navigationStore';

export type DesktopLayoutMode = 'compact' | 'medium' | 'full';

export interface WindowDimensions {
  width: number;
  height: number;
  layoutMode: DesktopLayoutMode;
  isCompact: boolean;
  isMedium: boolean;
  isFull: boolean;
  viewportWidth: number;
}

export function useWindowDimensions(): WindowDimensions {
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  const { isLyricsDrawerOpen, isQueueDrawerOpen, setLyricsDrawerOpen, setQueueDrawerOpen } =
    useNavigationStore();

  const isInspectorOpen = isLyricsDrawerOpen || isQueueDrawerOpen;

  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setDimensions({ width: w, height: h });

      // Auto-collapse inspector when resized below 1000px (B04-T02)
      if (w < 1000) {
        if (useNavigationStore.getState().isLyricsDrawerOpen) {
          setLyricsDrawerOpen(false);
        }
        if (useNavigationStore.getState().isQueueDrawerOpen) {
          setQueueDrawerOpen(false);
        }
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [setLyricsDrawerOpen, setQueueDrawerOpen]);

  const { width, height } = dimensions;

  let layoutMode: DesktopLayoutMode = 'full';
  if (width < 700) {
    layoutMode = 'compact';
  } else if (width < 1000) {
    layoutMode = 'medium';
  } else {
    layoutMode = 'full';
  }

  const sidebarWidth = layoutMode === 'compact' ? 0 : 260;
  const inspectorWidth = isInspectorOpen && layoutMode === 'full' ? 360 : 0;
  const viewportWidth = Math.max(300, width - sidebarWidth - inspectorWidth);

  return {
    width,
    height,
    layoutMode,
    isCompact: layoutMode === 'compact',
    isMedium: layoutMode === 'medium',
    isFull: layoutMode === 'full',
    viewportWidth,
  };
}
