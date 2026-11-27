// src/ui/hooks/useContextMenu.ts
// Viewport-bounded desktop context menu state & typed entity target support

import { useState, useCallback, useEffect } from 'react';
import type { Song } from '../../models/Song';
import type { Playlist } from '../../models/Playlist';
import type { QueueTierType } from '../../state/queueStore';

export interface ContextMenuQueueContext {
  tier: QueueTierType;
  index: number;
}

export interface ContextMenuAlbumTarget {
  id: string;
  title: string;
  artist?: string;
  coverUrl?: string | null;
  songs?: Song[];
}

export interface ContextMenuArtistTarget {
  id: string;
  name: string;
  avatarUrl?: string | null;
  songs?: Song[];
}

export type ContextMenuTarget =
  | { kind: 'song'; song: Song; queueContext?: ContextMenuQueueContext | null }
  | { kind: 'playlist'; playlist: Playlist; songs?: Song[] }
  | { kind: 'album'; album: ContextMenuAlbumTarget }
  | { kind: 'artist'; artist: ContextMenuArtistTarget };

export type OpenContextMenuFn = (
  e: React.MouseEvent,
  target: Song | ContextMenuTarget,
  queueContext?: ContextMenuQueueContext | null
) => void;

export interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  target: ContextMenuTarget | null;
  track: Song | null;
  queueContext?: ContextMenuQueueContext | null;
}

export function normalizeContextMenuTarget(
  input: Song | ContextMenuTarget | null | undefined,
  queueContext?: ContextMenuQueueContext | null
): ContextMenuTarget | null {
  if (!input || typeof input !== 'object') return null;
  if ('kind' in input && typeof input.kind === 'string') {
    return input as ContextMenuTarget;
  }
  const raw = input as any;
  if (raw.isArtist) {
    return {
      kind: 'artist',
      artist: {
        id: raw.browseId || raw.id || raw.videoId || '',
        name: raw.title || raw.name || 'Artist',
        avatarUrl: raw.thumbnailUrl || raw.artworkUrl || null,
      },
    };
  }
  if (raw.isAlbum) {
    return {
      kind: 'album',
      album: {
        id: raw.browseId || raw.id || raw.videoId || '',
        title: raw.title || raw.name || 'Album',
        artist: raw.subtitle || raw.artist || '',
        coverUrl: raw.thumbnailUrl || raw.artworkUrl || null,
      },
    };
  }
  if (raw.isPlaylist) {
    return {
      kind: 'playlist',
      playlist: {
        id: raw.browseId || raw.id || raw.videoId || '',
        title: raw.title || raw.name || 'Playlist',
        description: '',
        thumbnailUrl: raw.thumbnailUrl || raw.artworkUrl || null,
        isCustom: false,
        createdAt: '',
        updatedAt: '',
        songIds: [],
        songCount: 0,
        totalDurationSec: 0,
      },
    };
  }
  return {
    kind: 'song',
    song: input as Song,
    queueContext: queueContext ?? null,
  };
}

export function useContextMenu() {
  const [menuState, setMenuState] = useState<ContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    target: null,
    track: null,
    queueContext: null,
  });

  const openContextMenu = useCallback<OpenContextMenuFn>(
    (e, rawTarget, queueContext) => {
      e.preventDefault();
      e.stopPropagation();

      const target = normalizeContextMenuTarget(rawTarget, queueContext);
      if (!target) return;

      const menuWidth = 240;
      const menuHeight = target.kind === 'song' ? 370 : target.kind === 'playlist' ? 310 : 220;
      const windowWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
      const windowHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
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
        target,
        track: target.kind === 'song' ? target.song : null,
        queueContext:
          target.kind === 'song' ? (target.queueContext ?? queueContext ?? null) : null,
      });
    },
    []
  );

  const closeContextMenu = useCallback(() => {
    setMenuState((prev) =>
      prev.isOpen ? { ...prev, isOpen: false, target: null, track: null, queueContext: null } : prev
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
