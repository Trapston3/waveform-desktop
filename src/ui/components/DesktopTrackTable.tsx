// src/ui/components/DesktopTrackTable.tsx
// 1:1 macOS / MacBook Apple Music Desktop Tabular Tracklist Component
// Virtualization-ready (.tracklist-row / .tracklist-row-compact), click-to-sort headers,
// multi-selection (Shift/Ctrl), double-click to play, animated playing equalizers (#FA2D48),
// favorite heart toggles, context menu triggers, and 0Hz playback re-render isolation.

import React, { useState, useMemo, useCallback, memo } from 'react';
import {
  Star,
  MoreHorizontal,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { ArtistCredits } from '../common/ArtistCredits';
import { PlayerPlayIcon, PlayerPauseIcon } from '../common/WaveFormIcons';
import type { Song } from '../../models/Song';
import { usePlayerStore } from '../../state/playerStore';
import { useQueueStore } from '../../state/queueStore';
import { useLibraryStore } from '../../state/libraryStore';
import { useNavigationStore } from '../../state/navigationStore';

export interface DesktopTrackTableProps {
  songs: Song[];
  releaseContext?: {
    id: string;
    browseId?: string;
    title: string;
    type?: 'album' | 'playlist' | 'artist' | 'radio' | 'search';
  };
  showCover?: boolean;
  showArtist?: boolean;
  showAlbum?: boolean;
  showTrackNumber?: boolean;
  density?: 'standard' | 'compact';
  allowSorting?: boolean;
  allowMultiSelect?: boolean;
  onPlaySong?: (song: Song, index: number, list: Song[]) => void;
  onOpenContextMenu?: (e: React.MouseEvent, song: Song) => void;
  emptyMessage?: string;
  className?: string;
}

type SortField = 'title' | 'artist' | 'album' | 'duration' | null;
type SortDirection = 'asc' | 'desc';

export const DesktopTrackTable: React.FC<DesktopTrackTableProps> = memo(({
  songs = [],
  releaseContext,
  showCover = false,
  showArtist = true,
  showAlbum = true,
  showTrackNumber = true,
  density = 'standard',
  allowSorting = true,
  allowMultiSelect = true,
  onPlaySong,
  onOpenContextMenu,
  emptyMessage = 'No tracks available',
  className = '',
}) => {
  // Fine-grained atomic selectors for 0Hz playback re-render invariant
  const currentTrackId = usePlayerStore((s) => s.currentTrack?.videoId);
  const isPlaying = usePlayerStore((s) => s.playbackState === 'PLAYING');
  const togglePlay = usePlayerStore((s) => s.togglePlay);

  const { setContextQueue } = useQueueStore();
  const { toggleFavorite, isFavorite } = useLibraryStore();
  const { navigateToArtist, navigateToRelease } = useNavigationStore();

  // Column layout grid calculation
  const colSpans = useMemo(() => {
    if (showArtist && showAlbum) {
      return { index: 'col-span-1', title: 'col-span-5', artist: 'col-span-3', album: 'col-span-2', time: 'col-span-1' };
    }
    if (showArtist && !showAlbum) {
      return { index: 'col-span-1', title: 'col-span-6', artist: 'col-span-3', album: '', time: 'col-span-2' };
    }
    if (!showArtist && showAlbum) {
      return { index: 'col-span-1', title: 'col-span-6', artist: '', album: 'col-span-3', time: 'col-span-2' };
    }
    return { index: 'col-span-1', title: 'col-span-9', artist: '', album: '', time: 'col-span-2' };
  }, [showArtist, showAlbum]);

  // Sorting state
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Multi-selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

  // Format track duration helper
  const formatDuration = useCallback((msOrSec?: number) => {
    if (!msOrSec || msOrSec <= 0) return '0:00';
    const totalSec = msOrSec > 10000 ? Math.floor(msOrSec / 1000) : Math.floor(msOrSec);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }, []);

  // Sort cycle handler: natural (null) -> asc -> desc -> natural
  const handleSortClick = (field: SortField) => {
    if (!allowSorting) return;
    if (sortField !== field) {
      setSortField(field);
      setSortDirection('asc');
    } else if (sortDirection === 'asc') {
      setSortDirection('desc');
    } else {
      setSortField(null);
      setSortDirection('asc');
    }
  };

  // Derived sorted songs list
  const displaySongs = useMemo(() => {
    if (!sortField) return songs;

    const sorted = [...songs].sort((a, b) => {
      let valA = '';
      let valB = '';

      if (sortField === 'title') {
        valA = (a.title || '').toLowerCase();
        valB = (b.title || '').toLowerCase();
      } else if (sortField === 'artist') {
        valA = (a.artist || '').toLowerCase();
        valB = (b.artist || '').toLowerCase();
      } else if (sortField === 'album') {
        const getAlbumStr = (s: Song) => (typeof s.album === 'string' ? s.album : s.albumName || (s as any).albumTitle || '');
        valA = getAlbumStr(a).toLowerCase();
        valB = getAlbumStr(b).toLowerCase();
      } else if (sortField === 'duration') {
        const durA = a.totalPlayTimeMs || (a.durationSec ? a.durationSec * 1000 : 0);
        const durB = b.totalPlayTimeMs || (b.durationSec ? b.durationSec * 1000 : 0);
        return sortDirection === 'asc' ? durA - durB : durB - durA;
      }

      const cmp = valA.localeCompare(valB);
      return sortDirection === 'asc' ? cmp : -cmp;
    });

    return sorted;
  }, [songs, sortField, sortDirection]);

  // Unified playback trigger
  const handlePlay = useCallback(
    (song: Song, index: number) => {
      if (onPlaySong) {
        onPlaySong(song, index, displaySongs);
      } else {
        setContextQueue(
          displaySongs,
          index,
          releaseContext
            ? {
                id: releaseContext.id,
                browseId: releaseContext.browseId || releaseContext.id,
                title: releaseContext.title,
                type: releaseContext.type || 'album',
                currentIndex: index,
              }
            : undefined
        );
      }
    },
    [onPlaySong, displaySongs, releaseContext, setContextQueue]
  );

  // Row selection handler
  const handleRowClick = useCallback(
    (e: React.MouseEvent, songId: string, index: number) => {
      if (!allowMultiSelect) {
        setSelectedIds(new Set([songId]));
        setLastSelectedId(songId);
        return;
      }

      if (e.shiftKey && lastSelectedId) {
        const lastIdx = displaySongs.findIndex((s) => (s.videoId || s.id) === lastSelectedId);
        if (lastIdx !== -1) {
          const start = Math.min(lastIdx, index);
          const end = Math.max(lastIdx, index);
          const rangeIds = new Set<string>();
          for (let i = start; i <= end; i++) {
            const id = displaySongs[i].videoId || displaySongs[i].id;
            if (id) rangeIds.add(id);
          }
          setSelectedIds(rangeIds);
          return;
        }
      }

      if (e.ctrlKey || e.metaKey) {
        const updated = new Set(selectedIds);
        if (updated.has(songId)) {
          updated.delete(songId);
        } else {
          updated.add(songId);
        }
        setSelectedIds(updated);
        setLastSelectedId(songId);
        return;
      }

      // Plain click
      setSelectedIds(new Set([songId]));
      setLastSelectedId(songId);
    },
    [allowMultiSelect, lastSelectedId, displaySongs, selectedIds]
  );

  const isCompact = density === 'compact';

  return (
    <div className={`w-full select-none ${className}`}>
      {/* Table Header Row */}
      <div className="grid grid-cols-12 px-4 h-8 text-[11px] font-bold text-[#8E8E93] uppercase tracking-wider border-b border-white/[0.08] items-center">
        {/* Index Column */}
        <span className={`${colSpans.index} text-center font-mono`}>#</span>

        {/* Title Column */}
        <div
          onClick={() => handleSortClick('title')}
          className={`${colSpans.title} flex items-center gap-1.5 cursor-pointer hover:text-white transition-colors ${
            sortField === 'title' ? 'text-white' : ''
          }`}
        >
          <span>Title</span>
          {sortField === 'title' && (
            sortDirection === 'asc' ? (
              <ChevronUp size={11} className="text-[#FA2D48]" />
            ) : (
              <ChevronDown size={11} className="text-[#FA2D48]" />
            )
          )}
        </div>

        {/* Artist Column */}
        {showArtist && (
          <div
            onClick={() => handleSortClick('artist')}
            className={`${colSpans.artist} flex items-center gap-1.5 cursor-pointer hover:text-white transition-colors ${
              sortField === 'artist' ? 'text-white' : ''
            }`}
          >
            <span>Artist</span>
            {sortField === 'artist' && (
              sortDirection === 'asc' ? (
                <ChevronUp size={11} className="text-[#FA2D48]" />
              ) : (
                <ChevronDown size={11} className="text-[#FA2D48]" />
              )
            )}
          </div>
        )}

        {/* Album Column */}
        {showAlbum && (
          <div
            onClick={() => handleSortClick('album')}
            className={`${colSpans.album} flex items-center gap-1.5 cursor-pointer hover:text-white transition-colors ${
              sortField === 'album' ? 'text-white' : ''
            }`}
          >
            <span>Album</span>
            {sortField === 'album' && (
              sortDirection === 'asc' ? (
                <ChevronUp size={11} className="text-[#FA2D48]" />
              ) : (
                <ChevronDown size={11} className="text-[#FA2D48]" />
              )
            )}
          </div>
        )}

        {/* Duration / Actions Column */}
        <div
          onClick={() => handleSortClick('duration')}
          className={`${colSpans.time} flex items-center justify-end gap-1.5 cursor-pointer hover:text-white transition-colors text-right`}
        >
          <span>Time</span>
          {sortField === 'duration' && (
            sortDirection === 'asc' ? (
              <ChevronUp size={11} className="text-[#FA2D48]" />
            ) : (
              <ChevronDown size={11} className="text-[#FA2D48]" />
            )
          )}
        </div>
      </div>

      {/* Empty State */}
      {displaySongs.length === 0 ? (
        <div className="py-16 text-center text-xs text-[#8E8E93]">
          {emptyMessage}
        </div>
      ) : (
        /* Tracklist Rows */
        <div className="divide-y divide-white/[0.04]">
          {displaySongs.map((song, idx) => {
            const songId = song.videoId || song.id || `${idx}`;
            const isCurrentTrack = currentTrackId === song.videoId;
            const isCurrentPlaying = isCurrentTrack && isPlaying;
            const isSelected = selectedIds.has(songId);
            const isLiked = isFavorite(song.videoId);

            return (
              <div
                key={songId}
                onClick={(e) => handleRowClick(e, songId, idx)}
                onDoubleClick={() => handlePlay(song, idx)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setSelectedIds(new Set([songId]));
                  if (onOpenContextMenu) {
                    onOpenContextMenu(e, song);
                  }
                }}
                className={`tracklist-row ${isCompact ? 'tracklist-row-compact h-[36px]' : 'h-[44px]'} grid grid-cols-12 px-4 items-center text-xs cursor-pointer group transition-colors rounded-lg ${
                  isSelected
                    ? 'bg-white/[0.12] text-white'
                    : 'hover:bg-white/[0.06] text-[#A1A1A6]'
                }`}
              >
                {/* 1. Track Number / Play Icon / Equalizer */}
                <div className={`${colSpans.index} flex items-center justify-center font-mono`}>
                  {isCurrentPlaying ? (
                    /* Animated Apple Music Equalizer Bars with Hover Pause */
                    <div className="relative flex items-center justify-center">
                      <div className="flex group-hover:hidden items-end justify-center gap-[2px] h-3.5 w-4 mx-auto">
                        <span className="w-[3px] bg-[#FA2D48] rounded-full animate-eq-bar-1 h-2.5" />
                        <span className="w-[3px] bg-[#FA2D48] rounded-full animate-eq-bar-2 h-3.5" />
                        <span className="w-[3px] bg-[#FA2D48] rounded-full animate-eq-bar-3 h-2" />
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePlay();
                        }}
                        className="hidden group-hover:flex w-5 h-5 rounded-full items-center justify-center text-[#FA2D48] hover:scale-110 transition-transform"
                        title="Pause"
                      >
                        <PlayerPauseIcon size={13} />
                      </button>
                    </div>
                  ) : isCurrentTrack ? (
                    <>
                      {/* Active Paused Song Indicator */}
                      <span className="group-hover:hidden text-[#FA2D48] font-bold">
                        {showTrackNumber ? idx + 1 : ''}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePlay();
                        }}
                        className="hidden group-hover:flex w-5 h-5 rounded-full items-center justify-center text-white hover:text-[#FA2D48] transition-colors"
                        title="Play"
                      >
                        <PlayerPlayIcon size={12} className="ml-0.5" />
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Normal Number (Hidden on Hover) */}
                      <span className="group-hover:hidden text-[#8E8E93]">
                        {showTrackNumber ? idx + 1 : ''}
                      </span>
                      {/* Hover Play Button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePlay(song, idx);
                        }}
                        className="hidden group-hover:flex w-5 h-5 rounded-full items-center justify-center text-white hover:text-[#FA2D48] transition-colors"
                        title="Play"
                      >
                        <PlayerPlayIcon size={12} className="ml-0.5" />
                      </button>
                    </>
                  )}
                </div>

                {/* 2. Title + Cover + Badges */}
                <div className={`${colSpans.title} flex items-center gap-3 min-w-0 pr-3`}>
                  {showCover && (
                    <div className="artwork-lockup w-8 h-8 rounded-md overflow-hidden bg-neutral-900 shrink-0">
                      <img
                        src={
                          song.thumbnailUrl ||
                          song.artworkUrl ||
                          'https://i.ytimg.com/vi/5dNP-a-XXx0/hqdefault.jpg'
                        }
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}

                  <div className="min-w-0 flex items-center gap-2">
                    <span
                      className={`truncate font-medium ${
                        isCurrentTrack
                          ? 'text-[#FA2D48] font-bold'
                          : isSelected
                          ? 'text-white'
                          : 'group-hover:text-white text-white'
                      }`}
                    >
                      {song.title}
                    </span>

                    {song.isExplicit && (
                      <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-white/10 text-[#8E8E93] border border-white/20 uppercase shrink-0">
                        E
                      </span>
                    )}
                  </div>
                </div>

                {/* 3. Artist */}
                {showArtist && (
                  <div className={`${colSpans.artist} truncate text-[#A1A1A6] hover:text-white pr-2`}>
                    <ArtistCredits
                      artist={song.artist}
                      artists={song.artists}
                      artistIds={song.artistIds}
                      onNavigate={(id) => navigateToArtist(id)}
                    />
                  </div>
                )}

                {/* 4. Album */}
                {showAlbum && (
                  <div
                    className={`${colSpans.album} truncate text-[#A1A1A6] hover:text-white pr-2`}
                  >
                    <span
                      onClick={(e) => {
                        const albumId = (song as any).albumId || (song as any).browseId;
                        if (albumId) {
                          e.stopPropagation();
                          navigateToRelease(albumId, 'album');
                        }
                      }}
                      className="hover:underline cursor-pointer"
                    >
                      {song.album || (song as any).albumTitle || '—'}
                    </span>
                  </div>
                )}

                {/* 5. Duration + Heart + Context Menu */}
                <div
                  className={`${colSpans.time} flex items-center justify-end gap-2.5 font-mono text-[#8E8E93]`}
                >
                  <span className="tabular-nums">
                    {formatDuration(song.totalPlayTimeMs || (song.durationSec ? song.durationSec * 1000 : 0))}
                  </span>

                  {/* Favorite Star Toggle */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(song);
                    }}
                    className={`p-1 hover:text-[#FA2D48] transition-all cursor-pointer ${
                      isLiked
                        ? 'text-[#FA2D48] opacity-100'
                        : 'opacity-0 group-hover:opacity-100 hover:scale-110'
                    }`}
                    title={isLiked ? 'Remove from Favorites' : 'Add to Favorites'}
                  >
                    <Star
                      size={13}
                      className={isLiked ? 'fill-[#FA2D48] text-[#FA2D48]' : 'text-[#8E8E93] hover:text-[#FA2D48]'}
                    />
                  </button>

                  {/* Context Menu Button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onOpenContextMenu) {
                        onOpenContextMenu(e, song);
                      }
                    }}
                    className="p-1 opacity-0 group-hover:opacity-100 hover:text-white transition-opacity cursor-pointer"
                    title="More actions"
                  >
                    <MoreHorizontal size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

DesktopTrackTable.displayName = 'DesktopTrackTable';
