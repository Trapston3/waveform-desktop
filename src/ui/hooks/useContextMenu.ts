// src/ui/hooks/useContextMenu.ts
// Viewport-bounded desktop context menu state & collision prevention hook

import { useState, useCallback, useEffect } from 'react';
import type { Song } from '../../models/Song';
import type { QueueTierType } from '../../state/queueStore';

export interface ContextMenuQueueContext {
  tier: QueueTierType;
  index: number;
}

export interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  track: Song | null;
  queueContext?: ContextMenuQueueContext | null;
}

export function useContextMenu() {
  const [menuState, setMenuState] = useState<ContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    track: null,
    queueContext: null,
  });

  const openContextMenu = useCallback(
    (e: React.MouseEvent, track: Song, queueContext?: ContextMenuQueueContext | null) => {
      e.preventDefault();
      e.stopPropagation();

      const menuWidth = 232;
      const menuHeight = 350;
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;
      let x = e.clientX;
      let y = e.clientY;
      if (x + menuWidth > windowWidth - 10) x = x - menuWidth;
      if (y + menuHeight > windowHeight - 96) y = y - menuHeight;
      x = Math.min(Math.max(10, x), Math.max(10, windowWidth - menuWidth - 10));
      y = Math.min(Math.max(52, y), Math.max(52, windowHeight - menuHeight - 96));

      setMenuState({
        isOpen: true,
        x,
        y,
        track,
        queueContext: queueContext ?? null,
      });
    },
    []
  );

  const closeContextMenu = useCallback(() => {
    setMenuState((prev) =>
      prev.isOpen ? { ...prev, isOpen: false, track: null, queueContext: null } : prev
    );
  }, []);

  // Close context menu on global click or scroll
  useEffect(() => {
    if (!menuState.isOpen) return;

    const handleWindowClick = () => closeContextMenu();
    const handleWindowScroll = () => closeContextMenu();

    const handleKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') closeContextMenu(); };
    window.addEventListener('keydown', handleKey);
    window.addEventListener('click', handleWindowClick);
    window.addEventListener('scroll', handleWindowScroll, true);
    return () => {
      window.removeEventListener('keydown', handleKey);
    window.removeEventListener('click', handleWindowClick);
      window.removeEventListener('scroll', handleWindowScroll, true);
    };
  }, [menuState.isOpen, closeContextMenu]);

  return {
    menuState,
    openContextMenu,
    closeContextMenu,
  };
}
