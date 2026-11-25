// src/ui/views/SearchScreen.tsx
// Driven by the single unified top-left search input in LeftSidebar (useNavigationStore.searchQuery).
// Renders 6 Liquid Glass filter pills, recent search history, Top Result Acrylic Tile Hero Card,
// and categorized playable/navigable result shelves.

import React, { useState, useEffect, useRef, useMemo, memo, useCallback } from 'react';
import { X, Clock, Sparkles, Loader2 } from 'lucide-react';
import { MusicService } from '../../services/MusicService';
import type { SearchResult } from '../../models/Navigation';
import type { Song } from '../../models/Song';
import { usePlayerStore } from '../../state/playerStore';
import { useQueueStore } from '../../state/queueStore';
import { useNavigationStore } from '../../state/navigationStore';
import {
  useLibraryStore,
  selectUnifiedAlbums,
  selectUnifiedArtists,
  DEFAULT_LOCAL_ALBUM_ART_SVG,
} from '../../state/libraryStore';
import { PlayerPlayIcon, LosslessWaveIcon } from '../common/WaveFormIcons';

export type SearchFilterPill = 'all' | 'songs' | 'videos' | 'albums' | 'artists' | 'playlists';

export interface SearchScreenProps {
  onOpenContextMenu?: (e: React.MouseEvent, song: Song) => void;
}

const FILTER_PILLS: { id: SearchFilterPill; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'songs', label: 'Songs' },
  { id: 'videos', label: 'Videos' },
  { id: 'albums', label: 'Albums' },
  { id: 'artists', label: 'Artists' },
  { id: 'playlists', label: 'Playlists' },
];

const INITIAL_RECENT_HISTORY = [
  'The Weeknd',
  'Daft Punk',
  'Midnight City',
  'Lazerhawk',
  'Hans Zimmer',
];

export const SearchScreen: React.FC<SearchScreenProps> = memo(({ onOpenContextMenu }) => {
  const searchQuery = useNavigationStore((s) => s.searchQuery);
  const setSearchQuery = useNavigationStore((s) => s.setSearchQuery);
  const searchInitialQuery = useNavigationStore((s) => s.searchInitialQuery);
  const navigateToRelease = useNavigationStore((s) => s.navigateToRelease);
  const navigateToArtist = useNavigationStore((s) => s.navigateToArtist);

  const [activeFilter, setActiveFilter] = useState<SearchFilterPill>('all');
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null);
  const [recentHistory, setRecentHistory] = useState<string[]>(INITIAL_RECENT_HISTORY);
  const [isLoading, setIsLoading] = useState(false);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadTrack = usePlayerStore((s) => s.loadTrack);
  const currentTrackId = usePlayerStore((s) => s.currentTrack?.videoId);
  const setContextQueue = useQueueStore((s) => s.setContextQueue);
  const playSingleWithRadio = useQueueStore((s) => s.playSingleWithRadio);
  const localSongs = useLibraryStore((s) => s.localSongs);

  const localMatchedItems: any[] = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    if (!q || !Array.isArray(localSongs) || localSongs.length === 0) return [];

    if (activeFilter === 'videos' || activeFilter === 'playlists') return [];

    if (activeFilter === 'albums') {
      return selectUnifiedAlbums(localSongs)
        .filter(
          (alb) =>
            alb.title.toLowerCase().includes(q) ||
            alb.artist.toLowerCase().includes(q) ||
            alb.albumArtist.toLowerCase().includes(q)
        )
        .map((alb) => ({
          id: alb.id,
          browseId: alb.id,
          title: alb.title,
          subtitle: alb.artist,
          artist: alb.artist,
          thumbnailUrl: alb.coverUrl || DEFAULT_LOCAL_ALBUM_ART_SVG,
          artworkUrl: alb.coverUrl || DEFAULT_LOCAL_ALBUM_ART_SVG,
          isAlbum: true,
          isLocal: true,
          source: 'local',
          songs: alb.songs,
        }));
    }

    if (activeFilter === 'artists') {
      return selectUnifiedArtists(localSongs)
        .filter((art) => art.name.toLowerCase().includes(q))
        .map((art) => ({
          id: art.id,
          channelId: art.id,
          title: art.name,
          subtitle: `${art.trackCount} local ${art.trackCount === 1 ? 'track' : 'tracks'}`,
          artist: art.name,
          thumbnailUrl: art.avatarUrl || DEFAULT_LOCAL_ALBUM_ART_SVG,
          artworkUrl: art.avatarUrl || DEFAULT_LOCAL_ALBUM_ART_SVG,
          isArtist: true,
          isLocal: true,
          source: 'local',
        }));
    }

    // 'all' or 'songs'
    return localSongs
      .filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.artist.toLowerCase().includes(q) ||
          (s.albumName && s.albumName.toLowerCase().includes(q)) ||
          (s.albumArtist && s.albumArtist.toLowerCase().includes(q))
      )
      .map((s) => ({
        ...s,
        id: s.videoId,
        subtitle: s.albumName ? `${s.artist} • ${s.albumName}` : s.artist,
        thumbnailUrl: s.thumbnailUrl || s.artworkUrl || DEFAULT_LOCAL_ALBUM_ART_SVG,
        artworkUrl: s.artworkUrl || s.thumbnailUrl || DEFAULT_LOCAL_ALBUM_ART_SVG,
        isLocal: true,
        source: 'local',
      }));
  }, [localSongs, searchQuery, activeFilter]);

  const executeSearch = useCallback(async (targetQuery: string, filter: SearchFilterPill) => {
    const sanitized = targetQuery ? targetQuery.trim() : '';
    if (!sanitized) {
      setSearchResults(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const musicService = new MusicService();
      const results = await musicService.search(
        sanitized,
        filter === 'all' ? undefined : filter
      );
      setSearchResults(results);

      setRecentHistory((prev) => {
        const dedupe = prev.filter((h) => h.toLowerCase() !== sanitized.toLowerCase());
        return [sanitized, ...dedupe].slice(0, 8);
      });
    } catch (err) {
      console.warn('[SearchScreen] Execution failed:', err);
      setSearchResults({
        query: sanitized,
        filter: filter === 'all' ? undefined : filter,
        items: [],
      } as any);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const mergedResults: SearchResult | null = useMemo(() => {
    const hasQuery = Boolean((searchQuery || '').trim());
    if (!hasQuery) return null;
    if (!searchResults && localMatchedItems.length === 0) return null;

    const remoteItems = Array.isArray(searchResults?.items) ? searchResults.items : [];
    const seenIds = new Set<string>();
    const combined: any[] = [];

    for (const item of localMatchedItems) {
      const key = String(item.videoId || item.id || '');
      if (key && seenIds.has(key)) continue;
      if (key) seenIds.add(key);
      combined.push(item);
    }
    for (const item of remoteItems as any[]) {
      const key = String(item.videoId || item.id || '');
      if (key && seenIds.has(key)) continue;
      if (key) seenIds.add(key);
      combined.push(item);
    }

    return {
      ...(searchResults || { query: searchQuery.trim() }),
      items: combined,
    } as SearchResult;
  }, [searchResults, localMatchedItems, searchQuery]);

  // Sync legacy searchInitialQuery if populated externally without searchQuery
  useEffect(() => {
    if (searchInitialQuery && searchInitialQuery.trim() && !searchQuery) {
      setSearchQuery(searchInitialQuery);
    }
  }, [searchInitialQuery, searchQuery, setSearchQuery]);

  // Debounce search execution whenever searchQuery or activeFilter changes
  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }

    const sanitized = searchQuery ? searchQuery.trim() : '';
    if (!sanitized) {
      setSearchResults(null);
      setIsLoading(false);
      return;
    }

    debounceTimer.current = setTimeout(() => {
      executeSearch(sanitized, activeFilter);
    }, 220);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
    };
  }, [searchQuery, activeFilter, executeSearch]);

  const handleFilterChange = (filter: SearchFilterPill) => {
    setActiveFilter(filter);
  };

  const handleItemClick = (item: any) => {
    if (item.isLocal && item.isAlbum && Array.isArray(item.songs) && item.songs.length > 0) {
      setContextQueue(item.songs, 0, {
        id: item.id,
        browseId: item.id,
        title: item.title,
        type: 'album',
        currentIndex: 0,
      });
      loadTrack(item.songs[0], 'active', true);
      return;
    }

    const isBrowse = Boolean(item.browseId || item.isAlbum || item.isPlaylist || item.isArtist);
    if (isBrowse && !item.videoId) {
      if (item.isArtist && (item.channelId || item.id)) {
        navigateToArtist(item.channelId || item.id);
      } else if (item.browseId || item.id) {
        navigateToRelease(item.browseId || item.id, item.isPlaylist ? 'playlist' : 'album');
      }
      return;
    }

    // Play only the clicked song and populate Up Next via genuine YouTube Music Up Next Radio
    void playSingleWithRadio({
      ...item,
      videoId: item.videoId || item.id,
      artist: item.artist || item.subtitle || 'Unknown Artist',
    });
  };

  const formatItemBadge = (item: any) => {
    if (item.isLocal) {
      if (item.isArtist) return 'Local Artist';
      if (item.isAlbum) return 'Local Album';
      return 'Local';
    }
    if (item.isArtist) return 'Artist';
    if (item.isAlbum) return 'Album';
    if (item.isPlaylist) return 'Playlist';
    return 'Song';
  };

  const formatDuration = (item: any) => {
    if (item.durationText) return item.durationText;
    if (item.durationSec) {
      const m = Math.floor(item.durationSec / 60);
      const s = String(item.durationSec % 60).padStart(2, '0');
      return `${m}:${s}`;
    }
    return '';
  };

  const topResult = mergedResults?.items?.[0] as any;

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12 select-none animate-in fade-in duration-200">
      {/* 1. Liquid Glass Filter Pills Bar */}
      <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1">
        <div className="flex items-center gap-2">
          {FILTER_PILLS.map((pill) => {
            const isActive = activeFilter === pill.id;
            return (
              <button
                key={pill.id}
                onClick={() => handleFilterChange(pill.id)}
                className={`spring-press px-4 py-1.5 rounded-full text-xs font-semibold cursor-pointer ${
                  isActive
                    ? 'liquid-glass-pill-active text-white'
                    : 'liquid-glass-pill text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {pill.label}
              </button>
            );
          })}
        </div>
        {isLoading && (
          <Loader2 size={16} className="text-[var(--color-accent)] animate-spin shrink-0" />
        )}
      </div>

      {/* 2. Recent Search History (When query is empty) */}
      {!mergedResults && (
        <div className="max-w-2xl mx-auto space-y-3 pt-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
              Recent Searches
            </span>
            {recentHistory.length > 0 && (
              <button
                onClick={() => setRecentHistory([])}
                className="text-xs text-[var(--color-text-secondary)] hover:text-red-400 transition-colors cursor-pointer"
              >
                Clear all
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {recentHistory.map((item, idx) => (
              <div
                key={idx}
                onClick={() => setSearchQuery(item)}
                className="liquid-glass-pill group flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs cursor-pointer"
              >
                <Clock size={12} className="text-[var(--color-text-secondary)]" />
                <span className="font-medium text-[var(--color-text-primary)]">{item}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setRecentHistory((prev) => prev.filter((_, i) => i !== idx));
                  }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 transition-opacity"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Top Result + Categorized Search Results */}
      {mergedResults && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
              {mergedResults.items.length} Results for &ldquo;{searchQuery}&rdquo;
            </div>
          </div>

          {mergedResults.items.length === 0 ? (
            <div className="acrylic-tile rounded-3xl py-16 text-center text-xs text-[var(--color-text-secondary)]">
              No results found. Try checking your spelling or searching for another keyword.
            </div>
          ) : (
            <>
              {/* Top Result Hero Card (shown on 'all' filter) */}
              {activeFilter === 'all' && topResult && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
                  <div className="lg:col-span-5 flex flex-col space-y-2.5">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                      Top Result
                    </h3>
                    <div
                      onClick={() => handleItemClick(topResult)}
                      onContextMenu={(e) =>
                        onOpenContextMenu && onOpenContextMenu(e, topResult as any)
                      }
                      className="acrylic-tile flex-1 p-5 rounded-3xl flex flex-col justify-between gap-4 cursor-pointer group"
                    >
                      <div className="flex items-center gap-4">
                        <div
                          className={`artwork-lockup relative w-24 h-24 ${
                            topResult.isArtist ? 'rounded-full' : 'rounded-2xl'
                          } overflow-hidden bg-neutral-900 shrink-0`}
                        >
                          <img
                            src={
                              topResult.thumbnailUrl ||
                              topResult.artworkUrl ||
                              'https://i.ytimg.com/vi/5dNP-a-XXx0/hqdefault.jpg'
                            }
                            alt={topResult.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <span className="liquid-glass-pill-active inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase">
                            <Sparkles size={10} />
                            {formatItemBadge(topResult)}
                          </span>
                          <h4 className="text-xl font-extrabold truncate text-[var(--color-text-primary)]">
                            {topResult.title}
                          </h4>
                          <p className="text-xs text-[var(--color-text-secondary)] truncate">
                            {topResult.subtitle || topResult.artist || ''}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-white/75">
                          <LosslessWaveIcon size={12} className="text-[var(--color-accent)]" />
                          Lossless Audio Ready
                        </span>
                        <button className="spring-press w-10 h-10 rounded-full liquid-glass-pill-active flex items-center justify-center shadow-lg">
                          <PlayerPlayIcon size={18} className="ml-0.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Quick Top Songs Column */}
                  <div className="lg:col-span-7 flex flex-col space-y-2.5">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                      Top Songs
                    </h3>
                    <div className="space-y-2 flex-1 flex flex-col justify-between">
                      {mergedResults.items.slice(1, 5).map((item: any, idx: number) => {
                        const cover =
                          item.thumbnailUrl ||
                          item.artworkUrl ||
                          'https://i.ytimg.com/vi/5dNP-a-XXx0/hqdefault.jpg';
                        const isActiveTrack =
                          Boolean(
                            currentTrackId &&
                              (currentTrackId === item.videoId || currentTrackId === item.id)
                          );
                        return (
                          <div
                            key={item.id || item.videoId || idx}
                            onClick={() => handleItemClick(item)}
                            onContextMenu={(e) => onOpenContextMenu && onOpenContextMenu(e, item)}
                            className={`acrylic-tile group flex items-center justify-between p-2.5 rounded-2xl cursor-pointer ${
                              isActiveTrack ? 'border-[var(--color-accent)]/60' : ''
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="artwork-lockup relative w-11 h-11 rounded-xl flex-shrink-0 bg-neutral-900">
                                <img
                                  src={cover}
                                  alt={item.title}
                                  className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                  <PlayerPlayIcon size={15} className="text-white ml-0.5" />
                                </div>
                              </div>
                              <div className="min-w-0">
                                <div
                                  className={`text-xs font-bold truncate ${
                                    isActiveTrack
                                      ? 'text-[var(--color-accent)]'
                                      : 'text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)]'
                                  }`}
                                >
                                  {item.title}
                                </div>
                                <div className="text-[11px] text-[var(--color-text-secondary)] truncate">
                                  {item.subtitle || item.artist || ''}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {formatDuration(item) && (
                                <span className="text-[10px] font-mono text-[var(--color-text-tertiary)]">
                                  {formatDuration(item)}
                                </span>
                              )}
                              <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full liquid-glass-pill text-[var(--color-accent)]">
                                {formatItemBadge(item)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Full Results Grid */}
              <div className="space-y-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                  {activeFilter === 'all' ? 'All Results' : `${activeFilter} Results`}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {mergedResults.items.map((item: any, idx) => {
                    const cover =
                      item.thumbnailUrl ||
                      item.artworkUrl ||
                      'https://i.ytimg.com/vi/5dNP-a-XXx0/hqdefault.jpg';
                    const badge = formatItemBadge(item);
                    const duration = formatDuration(item);
                    const isActiveTrack =
                      Boolean(
                        currentTrackId &&
                          (currentTrackId === item.videoId || currentTrackId === item.id)
                      );

                    return (
                      <div
                        key={item.id || item.videoId || idx}
                        onClick={() => handleItemClick(item)}
                        onContextMenu={(e) => onOpenContextMenu && onOpenContextMenu(e, item)}
                        className={`acrylic-tile group flex items-center justify-between p-3 rounded-2xl cursor-pointer ${
                          isActiveTrack ? 'border-[var(--color-accent)]/60' : ''
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`artwork-lockup relative w-12 h-12 ${
                              item.isArtist ? 'rounded-full' : 'rounded-xl'
                            } flex-shrink-0 bg-neutral-900`}
                          >
                            <img
                              src={cover}
                              alt={item.title}
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                              <PlayerPlayIcon size={16} className="text-white ml-0.5" />
                            </div>
                          </div>
                          <div className="min-w-0">
                            <div
                              className={`text-xs font-bold truncate ${
                                isActiveTrack
                                  ? 'text-[var(--color-accent)]'
                                  : 'text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)]'
                              }`}
                            >
                              {item.title}
                            </div>
                            <div className="text-[11px] text-[var(--color-text-secondary)] truncate">
                              {item.subtitle || item.artist || ''}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 pl-2">
                          {duration && (
                            <span className="text-[10px] font-mono text-[var(--color-text-tertiary)]">
                              {duration}
                            </span>
                          )}
                          <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full liquid-glass-pill text-[var(--color-accent)]">
                            {badge}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
});

SearchScreen.displayName = 'SearchScreen';
