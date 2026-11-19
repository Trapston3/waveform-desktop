// src/ui/hooks/useKeyboardShortcuts.ts
// Focus-guarded desktop keyboard shortcuts and media keys matrix conforming to Feature 24

import { useEffect } from 'react';
import { usePlayerStore } from '../../state/playerStore';
import { useQueueStore } from '../../state/queueStore';
import { useNavigationStore } from '../../state/navigationStore';

export function isInputElementFocused(): boolean {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement;
  if (!active) return false;
  const tagName = active.tagName.toLowerCase();
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    (active as HTMLElement).isContentEditable
  );
}

export interface UseKeyboardShortcutsOptions {
  onFocusSearch?: () => void;
  onCloseModals?: () => void;
}

export function useKeyboardShortcuts(options?: UseKeyboardShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = isInputElementFocused();

      // Esc always works even if inside an input
      if (e.key === 'Escape' || e.code === 'Escape') {
        const nav = useNavigationStore.getState();
        if (nav.isSettingsOpen || nav.isCreatePlaylistOpen || nav.isReplayOpen) {
          nav.setSettingsOpen(false);
          nav.setCreatePlaylistOpen(false);
          nav.setReplayOpen(false);
          return;
        }
        if (usePlayerStore.getState().isNowPlayingModalOpen) {
          usePlayerStore.getState().setNowPlayingModalOpen(false);
          return;
        }
        if (nav.isLyricsDrawerOpen || nav.isQueueDrawerOpen) {
          nav.setLyricsDrawerOpen(false);
          nav.setQueueDrawerOpen(false);
          return;
        }
        if (options?.onCloseModals) {
          options.onCloseModals();
        }
        return;
      }

      // Check Ctrl/Cmd shortcuts
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      if (isCtrlOrCmd) {
        const key = e.key.toLowerCase();
        if (key === 'f' || key === 'k') {
          e.preventDefault();
          useNavigationStore.getState().requestSearchFocus();
          options?.onFocusSearch?.();
          return;
        }
        // Block other action shortcuts when Ctrl/Cmd is held
        return;
      }

      // If user is currently typing in an input field, do NOT trigger playback shortcuts
      if (isInput) return;
      if (e.altKey) return;

      const player = usePlayerStore.getState();
      const queue = useQueueStore.getState();
      const nav = useNavigationStore.getState();

      const lowerKey = e.key ? e.key.toLowerCase() : '';

      if (lowerKey === 'l' || e.code === 'KeyL') {
        e.preventDefault();
        nav.toggleLyricsDrawer();
        return;
      }

      if (lowerKey === 'q' || e.code === 'KeyQ') {
        e.preventDefault();
        nav.toggleQueueDrawer();
        return;
      }

      if (lowerKey === 'j' || e.code === 'KeyJ') {
        e.preventDefault();
        player.seekRelative(-5000);
        return;
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          player.togglePlay();
          break;

        case 'ArrowLeft':
          e.preventDefault();
          // Shift + Left: -15s, Normal Left: -5s
          player.seekRelative(e.shiftKey ? -15000 : -5000);
          break;

        case 'ArrowRight':
          e.preventDefault();
          // Shift + Right: +15s, Normal Right: +5s
          player.seekRelative(e.shiftKey ? 15000 : 5000);
          break;

        case 'ArrowUp':
          e.preventDefault();
          player.adjustVolumeRelative(0.05);
          break;

        case 'ArrowDown':
          e.preventDefault();
          player.adjustVolumeRelative(-0.05);
          break;

        case 'KeyM':
          e.preventDefault();
          player.toggleMute();
          break;

        case 'KeyF':
          e.preventDefault();
          player.setNowPlayingModalOpen(!player.isNowPlayingModalOpen);
          break;

        case 'MediaPlayPause':
          e.preventDefault();
          player.togglePlay();
          break;

        case 'MediaTrackNext':
          e.preventDefault();
          queue.advanceQueue();
          break;

        case 'MediaTrackPrevious':
          e.preventDefault();
          queue.previousTrack();
          break;

        case 'MediaStop':
          e.preventDefault();
          player.pause();
          player.seek(0);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [options]);
}
