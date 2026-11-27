// src/ui/common/ContextMenu.tsx
// Viewport-bounded desktop right-click context menu for songs, playlists, albums, and artists

import React, { useState, useEffect } from 'react';
import {
  Play,
  Shuffle,
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
  Pencil,
  Files,
  ExternalLink,
} from 'lucide-react';
import type { Song } from '../../models/Song';
import { getPlatformBridge, hasPlatformBridge } from '../../platform/index';
import { usePlayerStore } from '../../state/playerStore';
import { useQueueStore, type QueueTierType } from '../../state/queueStore';
import {
  useLibraryStore,
  selectUnifiedSongs,
  resolvePlaylistSongs,
} from '../../state/libraryStore';
import { useNavigationStore } from '../../state/navigationStore';
import { useOfflineCacheStore } from '../../services/OfflineCacheService';
import { resolveArtistTarget } from '../../utils/artistCredits';
import type { ContextMenuTarget } from '../hooks/useContextMenu';

export interface ContextMenuProps {
  isOpen: boolean;
  x: number;
  y: number;
  target?: ContextMenuTarget | null;
  track?: Song | null;
  queueContext?: { tier: QueueTierType; index: number } | null;
  onClose: () => void;
}

function shuffleSongs<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  isOpen,
  x,
  y,
  target: rawTarget,
  track: rawTrack,
  queueContext,
  onClose,
}) => {
  const [showPlaylistSubmenu, setShowPlaylistSubmenu] = useState(false);
  const [copiedAction, setCopiedAction] = useState<'link' | 'title' | null>(null);
  const [isRenamingPlaylist, setIsRenamingPlaylist] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const loadTrack = usePlayerStore((s) => s.loadTrack);
  const {
    playNext,
    addToUserQueue,
    setContextQueue,
    startSongRadio,
    removeFromQueue,
  } = useQueueStore();
  const {
    playlists,
    favorites,
    localSongs,
    addTracksToPlaylist,
    renamePlaylist,
    duplicatePlaylist,
    deletePlaylist,
    toggleFavorite,
    isFavorite,
  } = useLibraryStore();
  const { navigateToArtist, navigateToRelease } = useNavigationStore();
  const pinnedIds = useOfflineCacheStore((s) => s.pinnedIds);
  const pinningIds = useOfflineCacheStore((s) => s.pinningIds);
  const pinTrack = useOfflineCacheStore((s) => s.pinTrack);
  const pinTracks = useOfflineCacheStore((s) => s.pinTracks);
  const unpinTrack = useOfflineCacheStore((s) => s.unpinTrack);

  useEffect(() => {
    if (!isOpen) {
      setShowPlaylistSubmenu(false);
      setCopiedAction(null);
      setIsRenamingPlaylist(false);
      setRenameDraft('');
      setConfirmingDelete(false);
    }
  }, [isOpen]);

  const effectiveTarget: ContextMenuTarget | null =
    rawTarget ??
    (rawTrack
      ? { kind: 'song', song: rawTrack, queueContext: queueContext ?? null }
      : null);

  if (!isOpen || !effectiveTarget) return null;

  // =========================================================================
  // 1. PLAYLIST CONTEXT MENU
  // =========================================================================
  if (effectiveTarget.kind === 'playlist') {
    const playlist = effectiveTarget.playlist;
    const unifiedSongs = selectUnifiedSongs(favorites, localSongs);
    const playlistSongs =
      Array.isArray(effectiveTarget.songs) && effectiveTarget.songs.length > 0
        ? effectiveTarget.songs
        : resolvePlaylistSongs(playlist, unifiedSongs);

    const startPlaylistPlayback = (shuffled: boolean) => {
      if (playlistSongs.length === 0) {
        navigateToRelease(playlist.id, 'playlist');
        onClose();
        return;
      }
      const list = shuffled ? shuffleSongs(playlistSongs) : playlistSongs;
      setContextQueue(list, 0, {
        id: playlist.id,
        browseId: playlist.id,
        title: playlist.title,
        type: 'playlist',
        currentIndex: 0,
      });
      loadTrack(list[0], 'active', true);
      onClose();
    };

    const handleAddPlaylistToQueue = () => {
      for (const s of playlistSongs) {
        addToUserQueue(s);
      }
      onClose();
    };

    const handlePinPlaylist = async () => {
      if (playlistSongs.length > 0) {
        await pinTracks(playlistSongs);
      }
      onClose();
    };

    const handleCommitRename = async () => {
      const next = renameDraft.trim();
      if (next && next !== playlist.title) {
        await renamePlaylist(playlist.id, next);
      }
      onClose();
    };

    const handleDuplicatePlaylist = async () => {
      await duplicatePlaylist(playlist.id);
      onClose();
    };

    const handleDeletePlaylist = async () => {
      if (!confirmingDelete) {
        setConfirmingDelete(true);
        return;
      }
      await deletePlaylist(playlist.id);
      onClose();
    };

    return (
      <div
        data-testid="context-menu-playlist"
        style={{ position: 'fixed', left: `${x}px`, top: `${y}px`, zIndex: 9999 }}
        onClick={(e) => e.stopPropagation()}
        className="liquid-glass-capsule fixed z-50 w-60 rounded-2xl text-[var(--color-primary)] p-1.5 text-xs select-none animate-in fade-in zoom-in-95 duration-100"
      >
        <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white/45 truncate">
          {playlist.title}
        </div>

        <button
          type="button"
          onClick={() => startPlaylistPlayback(false)}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-[var(--color-accent)] transition-colors text-left cursor-pointer"
        >
          <Play size={14} />
          <span>Play Playlist</span>
        </button>

        <button
          type="button"
          onClick={() => startPlaylistPlayback(true)}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-[var(--color-accent)] transition-colors text-left cursor-pointer"
        >
          <Shuffle size={14} />
          <span>Shuffle Playlist</span>
        </button>

        <button
          type="button"
          onClick={handleAddPlaylistToQueue}
          disabled={playlistSongs.length === 0}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-[var(--color-accent)] disabled:opacity-45 transition-colors text-left cursor-pointer"
        >
          <ListPlus size={14} />
          <span>Add Playlist to Queue</span>
        </button>

        <button
          type="button"
          onClick={() => void handlePinPlaylist()}
          disabled={playlistSongs.length === 0}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-cyan-300 disabled:opacity-45 transition-colors text-left cursor-pointer"
        >
          <Pin size={14} />
          <span>Pin Playlist Offline</span>
        </button>

        <div className="h-[1px] bg-white/10 my-1" />

        {isRenamingPlaylist ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleCommitRename();
            }}
            className="px-2 py-1 space-y-1.5"
          >
            <input
              type="text"
              autoFocus
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setIsRenamingPlaylist(false);
                }
              }}
              maxLength={100}
              aria-label="Playlist Name"
              className="w-full rounded-md bg-black/50 border border-white/25 px-2 py-1 text-xs text-white focus:outline-none focus:border-[#FA2D48]"
            />
            <div className="flex items-center justify-end gap-1">
              <button
                type="button"
                onClick={() => setIsRenamingPlaylist(false)}
                className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[10px] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-2 py-0.5 rounded bg-[#FA2D48] text-white text-[10px] font-semibold cursor-pointer"
              >
                Save
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => {
              setRenameDraft(playlist.title);
              setIsRenamingPlaylist(true);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-white transition-colors text-left cursor-pointer"
          >
            <Pencil size={14} />
            <span>Rename Playlist</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => void handleDuplicatePlaylist()}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-white transition-colors text-left cursor-pointer"
        >
          <Files size={14} />
          <span>Duplicate Playlist</span>
        </button>

        <button
          type="button"
          onClick={() => void handleDeletePlaylist()}
          className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg transition-colors text-left cursor-pointer ${
            confirmingDelete
              ? 'bg-red-500/25 text-red-300 font-semibold'
              : 'hover:bg-red-500/15 hover:text-red-400'
          }`}
        >
          <Trash2 size={14} />
          <span>{confirmingDelete ? 'Confirm Delete Playlist' : 'Delete Playlist'}</span>
        </button>
      </div>
    );
  }

  // =========================================================================
  // 2. ALBUM / RELEASE CONTEXT MENU
  // =========================================================================
  if (effectiveTarget.kind === 'album') {
    const album = effectiveTarget.album;
    const albumSongs = Array.isArray(album.songs) ? album.songs : [];

    const startAlbumPlayback = (shuffled: boolean) => {
      if (albumSongs.length === 0) {
        navigateToRelease(album.id, 'album');
        onClose();
        return;
      }
      const list = shuffled ? shuffleSongs(albumSongs) : albumSongs;
      setContextQueue(list, 0, {
        id: album.id,
        browseId: album.id,
        title: album.title,
        type: 'album',
        currentIndex: 0,
      });
      loadTrack(list[0], 'active', true);
      onClose();
    };

    const handleAddAlbumToQueue = () => {
      for (const s of albumSongs) {
        addToUserQueue(s);
      }
      onClose();
    };

    const handlePinAlbum = async () => {
      if (albumSongs.length > 0) {
        await pinTracks(albumSongs);
      }
      onClose();
    };

    return (
      <div
        data-testid="context-menu-album"
        style={{ position: 'fixed', left: `${x}px`, top: `${y}px`, zIndex: 9999 }}
        onClick={(e) => e.stopPropagation()}
        className="liquid-glass-capsule fixed z-50 w-56 rounded-2xl text-[var(--color-primary)] p-1.5 text-xs select-none animate-in fade-in zoom-in-95 duration-100"
      >
        <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white/45 truncate">
          {album.title}
        </div>

        <button
          type="button"
          onClick={() => startAlbumPlayback(false)}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-[var(--color-accent)] transition-colors text-left cursor-pointer"
        >
          <Play size={14} />
          <span>Play Album</span>
        </button>

        <button
          type="button"
          onClick={() => startAlbumPlayback(true)}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-[var(--color-accent)] transition-colors text-left cursor-pointer"
        >
          <Shuffle size={14} />
          <span>Shuffle Album</span>
        </button>

        <button
          type="button"
          onClick={handleAddAlbumToQueue}
          disabled={albumSongs.length === 0}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-[var(--color-accent)] disabled:opacity-45 transition-colors text-left cursor-pointer"
        >
          <ListPlus size={14} />
          <span>Add Album to Queue</span>
        </button>

        <button
          type="button"
          onClick={() => void handlePinAlbum()}
          disabled={albumSongs.length === 0}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-cyan-300 disabled:opacity-45 transition-colors text-left cursor-pointer"
        >
          <Pin size={14} />
          <span>Pin Album Offline</span>
        </button>

        <div className="h-[1px] bg-white/10 my-1" />

        <button
          type="button"
          onClick={() => {
            navigateToRelease(album.id, 'album');
            onClose();
          }}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-white transition-colors text-left cursor-pointer"
        >
          <Disc size={14} />
          <span>Open Album Page</span>
        </button>
      </div>
    );
  }

  // =========================================================================
  // 3. ARTIST CONTEXT MENU
  // =========================================================================
  if (effectiveTarget.kind === 'artist') {
    const artist = effectiveTarget.artist;
    const artistSongs = Array.isArray(artist.songs) ? artist.songs : [];

    const handlePlayTopSongs = () => {
      if (artistSongs.length > 0) {
        setContextQueue(artistSongs, 0, {
          id: artist.id,
          browseId: artist.id,
          title: artist.name,
          type: 'artist',
          currentIndex: 0,
        });
        loadTrack(artistSongs[0], 'active', true);
      } else {
        navigateToArtist(artist.id);
      }
      onClose();
    };

    const handleStartArtistRadio = () => {
      if (artistSongs[0]) {
        void startSongRadio(artistSongs[0]);
      } else {
        void startSongRadio({
          id: artist.id,
          videoId: artist.id,
          title: artist.name,
          artist: artist.name,
          thumbnailUrl: artist.avatarUrl || null,
          liked: false,
          totalPlayTimeMs: 0,
          playCount: 0,
          artistIds: [artist.id],
          artists: [{ id: artist.id, name: artist.name }],
          isExplicit: false,
        });
      }
      onClose();
    };

    return (
      <div
        data-testid="context-menu-artist"
        style={{ position: 'fixed', left: `${x}px`, top: `${y}px`, zIndex: 9999 }}
        onClick={(e) => e.stopPropagation()}
        className="liquid-glass-capsule fixed z-50 w-56 rounded-2xl text-[var(--color-primary)] p-1.5 text-xs select-none animate-in fade-in zoom-in-95 duration-100"
      >
        <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white/45 truncate">
          {artist.name}
        </div>

        <button
          type="button"
          onClick={handlePlayTopSongs}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-[var(--color-accent)] transition-colors text-left cursor-pointer"
        >
          <Play size={14} />
          <span>Play Top Songs</span>
        </button>

        <button
          type="button"
          onClick={handleStartArtistRadio}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-[var(--color-accent)] transition-colors text-left cursor-pointer"
        >
          <Radio size={14} />
          <span>Start Artist Radio</span>
        </button>

        <div className="h-[1px] bg-white/10 my-1" />

        <button
          type="button"
          onClick={() => {
            navigateToArtist(artist.id);
            onClose();
          }}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-white transition-colors text-left cursor-pointer"
        >
          <ExternalLink size={14} />
          <span>Open Artist Page</span>
        </button>
      </div>
    );
  }

  // =========================================================================
  // 4. SONG CONTEXT MENU
  // =========================================================================
  const songTarget = effectiveTarget.song;
  const effectiveQueueContext = effectiveTarget.queueContext ?? queueContext ?? null;
  const effectiveVideoId = songTarget.videoId || (songTarget as any).id || (songTarget as any).browseId || '';
  const effectiveArtist = songTarget.artist || (songTarget as any).subtitle || (songTarget as any).artists?.[0]?.name || 'Unknown Artist';
  const effectiveTitle = songTarget.title || (songTarget as any).name || 'Untitled';
  const effectiveThumb = songTarget.thumbnailUrl || (songTarget as any).artworkUrl || (songTarget as any).thumbnails?.[0]?.url;
  const track: Song = {
    ...songTarget,
    videoId: effectiveVideoId,
    artist: effectiveArtist,
    title: effectiveTitle,
    thumbnailUrl: effectiveThumb,
    artworkUrl: effectiveThumb || songTarget.artworkUrl,
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
      (songTarget as any).browseId ||
      ((songTarget as any).isAlbum ? effectiveVideoId : '') ||
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
    if (effectiveQueueContext) {
      removeFromQueue(effectiveQueueContext.tier, effectiveQueueContext.index);
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

  const handleCopySongTitle = () => {
    const text = `${track.artist} - ${track.title}`;
    navigator.clipboard?.writeText(text);
    setCopiedAction('title');
    setTimeout(() => {
      setCopiedAction(null);
      onClose();
    }, 500);
  };

  const handleCopyLink = () => {
    const url = `https://music.youtube.com/watch?v=${track.videoId}`;
    navigator.clipboard?.writeText(url);
    setCopiedAction('link');
    setTimeout(() => {
      setCopiedAction(null);
      onClose();
    }, 500);
  };

  const handleShowInFolder = () => {
    if (hasPlatformBridge('showItemInFolder')) {
      const streamUrl = track.streamUrl || '';
      void getPlatformBridge().showItemInFolder(streamUrl);
    }
    onClose();
  };

  return (
    <div
      data-testid="context-menu-song"
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

      {effectiveQueueContext && (
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
        onClick={handleCopySongTitle}
        className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-[var(--color-accent)] transition-colors text-left cursor-pointer"
      >
        {copiedAction === 'title' ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
        <span>{copiedAction === 'title' ? 'Title Copied!' : 'Copy Song Title'}</span>
      </button>

      <button
        onClick={handleCopyLink}
        className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-[var(--color-accent)] transition-colors text-left cursor-pointer"
      >
        {copiedAction === 'link' ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
        <span>{copiedAction === 'link' ? 'Link Copied!' : 'Copy Link'}</span>
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
