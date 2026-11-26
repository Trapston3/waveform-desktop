// src/ui/common/ContextMenu.tsx
// Viewport-bounded desktop right-click context menu for tracks

import React, { useState } from 'react';
import {
  Play,
  ListPlus,
  ListStart,
  FolderPlus,
  Heart,
  Copy,
  FolderOpen,
  Check,
  ChevronRight,
  User,
  Disc,
  Radio,
  Trash2,
  Pin,
} from 'lucide-react';
import type { Song } from '../../models/Song';
import { usePlayerStore } from '../../state/playerStore';
import { useQueueStore, type QueueTierType } from '../../state/queueStore';
import { useLibraryStore } from '../../state/libraryStore';
import { useNavigationStore } from '../../state/navigationStore';
import { useOfflineCacheStore } from '../../services/OfflineCacheService';
import { resolveArtistTarget } from '../../utils/artistCredits';

export interface ContextMenuProps {
  isOpen: boolean;
  x: number;
  y: number;
  track: Song | null;
  queueContext?: { tier: QueueTierType; index: number } | null;
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  isOpen,
  x,
  y,
  track: rawTrack,
  queueContext,
  onClose,
}) => {
  const [showPlaylistSubmenu, setShowPlaylistSubmenu] = useState(false);
  const [copied, setCopied] = useState(false);

  const { loadTrack } = usePlayerStore();
  const { playNext, addToUserQueue, startSongRadio, removeFromQueue } = useQueueStore();
  const { playlists, addTracksToPlaylist, toggleFavorite, isFavorite } = useLibraryStore();
  const { navigateToArtist, navigateToRelease } = useNavigationStore();
  const pinnedIds = useOfflineCacheStore((s) => s.pinnedIds);
  const pinningIds = useOfflineCacheStore((s) => s.pinningIds);
  const pinTrack = useOfflineCacheStore((s) => s.pinTrack);
  const unpinTrack = useOfflineCacheStore((s) => s.unpinTrack);

  if (!isOpen || !rawTrack) return null;

  const effectiveVideoId = rawTrack.videoId || (rawTrack as any).id || (rawTrack as any).browseId || '';
  const effectiveArtist = rawTrack.artist || (rawTrack as any).subtitle || (rawTrack as any).artists?.[0]?.name || 'Unknown Artist';
  const effectiveTitle = rawTrack.title || (rawTrack as any).name || 'Untitled';
  const effectiveThumb = rawTrack.thumbnailUrl || (rawTrack as any).artworkUrl || (rawTrack as any).thumbnails?.[0]?.url;
  const track: Song = {
    ...rawTrack,
    videoId: effectiveVideoId,
    artist: effectiveArtist,
    title: effectiveTitle,
    thumbnailUrl: effectiveThumb,
    artworkUrl: effectiveThumb || rawTrack.artworkUrl,
  };
  const flipSubmenuLeft = typeof window !== 'undefined' && x + 224 + 200 > window.innerWidth;

  const isLiked = isFavorite(track.videoId);
  const isTrackPinned = pinnedIds.includes(track.videoId);
  const isTrackPinning = pinningIds.includes(track.videoId);

  const handleTogglePin = async () => {
    if (isTrackPinned) {
      await unpinTrack(track.videoId);
    } else {
      await pinTrack(track);
    }
    onClose();
  };

  const handleGoToArtist = () => {
    const artistId = resolveArtistTarget(track);
    navigateToArtist(artistId);
    onClose();
  };

  const handleGoToAlbum = () => {
    const albumId =
      track.albumId ||
      (rawTrack as any).browseId ||
      ((rawTrack as any).isAlbum ? effectiveVideoId : '') ||
      (track.albumName || track.album ? `alb_${track.albumName || track.album}` : effectiveVideoId);
    navigateToRelease(albumId, 'album');
    onClose();
  };

  const handlePlayNow = () => {
    loadTrack(track, 'active', true);
    onClose();
  };

  const handlePlayNext = () => {
    playNext(track);
    onClose();
  };

  const handleAddToQueue = () => {
    addToUserQueue(track);
    onClose();
  };

  const handleStartRadio = () => {
    void startSongRadio(track);
    onClose();
  };

  const handleRemoveFromQueue = () => {
    if (queueContext) {
      removeFromQueue(queueContext.tier, queueContext.index);
    }
    onClose();
  };

  const handleAddToPlaylist = async (playlistId: string) => {
    await addTracksToPlaylist(playlistId, [track.videoId]);
    onClose();
  };

  const handleToggleFavorite = async () => {
    await toggleFavorite(track);
    onClose();
  };

  const handleCopyLink = () => {
    const url = `https://music.youtube.com/watch?v=${track.videoId}`;
    navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
      onClose();
    }, 600);
  };

  const handleShowInFolder = () => {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.showItemInFolder) {
      const streamUrl = track.streamUrl || '';
      (window as any).electronAPI.showItemInFolder(streamUrl);
    }
    onClose();
  };

  return (
    <div
      style={{ position: 'fixed', left: `${x}px`, top: `${y}px`, zIndex: 9999 }}
      onClick={(e) => e.stopPropagation()}
      className="liquid-glass-capsule fixed z-50 w-56 rounded-2xl text-[var(--color-primary)] p-1.5 text-xs select-none animate-in fade-in zoom-in-95 duration-100"
    >
      <button
        onClick={handlePlayNow}
        className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-[var(--color-accent)] transition-colors text-left cursor-pointer"
      >
        <Play size={14} />
        <span>Play Now</span>
      </button>

      <button
        onClick={handlePlayNext}
        className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-[var(--color-accent)] transition-colors text-left cursor-pointer"
      >
        <ListStart size={14} />
        <span>Play Next</span>
      </button>

      <button
        onClick={handleAddToQueue}
        className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-[var(--color-accent)] transition-colors text-left cursor-pointer"
      >
        <ListPlus size={14} />
        <span>Add to Queue</span>
      </button>

      <button
        onClick={handleStartRadio}
        className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-[var(--color-accent)] transition-colors text-left cursor-pointer"
      >
        <Radio size={14} />
        <span>Start Song Radio</span>
      </button>

      {queueContext && (
        <button
          onClick={handleRemoveFromQueue}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-red-500/15 hover:text-red-400 transition-colors text-left cursor-pointer"
        >
          <Trash2 size={14} />
          <span>Remove from Queue</span>
        </button>
      )}

      <div className="h-[1px] bg-white/10 my-1" />

      {/* Add to Playlist with Hover Submenu */}
      <div
        className="relative"
        onMouseEnter={() => setShowPlaylistSubmenu(true)}
        onMouseLeave={() => setShowPlaylistSubmenu(false)}
      >
        <button className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-[var(--color-accent)] transition-colors text-left cursor-pointer">
          <div className="flex items-center gap-2.5">
            <FolderPlus size={14} />
            <span>Add to Playlist</span>
          </div>
          <ChevronRight size={12} className="text-[var(--color-on-surface-variant)]" />
        </button>

        {showPlaylistSubmenu && (
          <div style={{ position: 'absolute', top: 0, left: flipSubmenuLeft ? 'auto' : '100%', right: flipSubmenuLeft ? '100%' : 'auto', zIndex: 10000 }} className="liquid-glass-capsule w-48 rounded-2xl text-[var(--color-primary)] p-1.5 max-h-56 overflow-y-auto">
            {playlists.length === 0 ? (
              <div className="px-3 py-1.5 text-[11px] text-[var(--color-on-surface-variant)]">
                No playlists yet
              </div>
            ) : (
              playlists.map((pl) => (
                <button
                  key={pl.id}
                  onClick={() => handleAddToPlaylist(pl.id)}
                  className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-[var(--color-accent)] transition-colors truncate cursor-pointer"
                >
                  {pl.title}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <button
        onClick={handleGoToArtist}
        className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-[var(--color-accent)] transition-colors text-left cursor-pointer"
      >
        <User size={14} />
        <span>Go to Artist</span>
      </button>

      <button
        onClick={handleGoToAlbum}
        className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-[var(--color-accent)] transition-colors text-left cursor-pointer"
      >
        <Disc size={14} />
        <span>Go to Album</span>
      </button>

      <button
        onClick={handleToggleFavorite}
        className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-[var(--color-accent)] transition-colors text-left cursor-pointer"
      >
        <Heart size={14} className={isLiked ? 'text-[var(--color-accent)] fill-current' : ''} />
        <span>{isLiked ? 'Remove from Favorites' : 'Add to Favorites'}</span>
      </button>

      <button
        onClick={() => void handleTogglePin()}
        disabled={isTrackPinning}
        className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-cyan-300 disabled:opacity-50 transition-colors text-left cursor-pointer"
      >
        <Pin size={14} className={isTrackPinned ? 'text-cyan-300 fill-current' : ''} />
        <span>
          {isTrackPinning
            ? 'Pinning...'
            : isTrackPinned
              ? 'Remove Offline Pin'
              : 'Pin for Offline'}
        </span>
      </button>

      <div className="h-[1px] bg-[var(--color-outline)] my-1" />

      <button
        onClick={handleCopyLink}
        className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-[var(--color-accent)] transition-colors text-left cursor-pointer"
      >
        {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
        <span>{copied ? 'Link Copied!' : 'Copy Link'}</span>
      </button>

      {(track.isLocal || track.playbackSourceType === 'LOCAL') && (
        <button
          onClick={handleShowInFolder}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-[var(--color-accent)] transition-colors text-left cursor-pointer"
        >
          <FolderOpen size={14} />
          <span>Show in Folder</span>
        </button>
      )}
    </div>
  );
};
