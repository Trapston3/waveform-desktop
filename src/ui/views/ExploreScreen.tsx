// src/ui/views/ExploreScreen.tsx
// Explore Screen (1:1 macOS Apple Music Desktop Experience with Liquid Glass):
// Ranked Top Charts with Dual-Hover Controls, Horizontal New Releases Carousel (< >), Sculpted Moods & Genre Discovery Tiles

import React, { useState, useEffect, useRef, memo } from 'react';
import {
  Flame,
  Trophy,
  Sparkles,
  Disc,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
} from 'lucide-react';
import { MusicService } from '../../services/MusicService';
import type { ExploreData, BrowseItem } from '../../models/Navigation';
import type { Song } from '../../models/Song';
import { usePlayerStore } from '../../state/playerStore';
import { useQueueStore } from '../../state/queueStore';
import { useNavigationStore } from '../../state/navigationStore';
import { PlayerPlayIcon } from '../common/WaveFormIcons';

export interface ExploreScreenProps {
  onOpenContextMenu?: (e: React.MouseEvent, song: Song) => void;
}

export const ExploreScreen: React.FC<ExploreScreenProps> = memo(({ onOpenContextMenu }) => {
  const [exploreData, setExploreData] = useState<ExploreData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const carouselRef = useRef<HTMLDivElement | null>(null);

  const loadTrack = usePlayerStore((s) => s.loadTrack);
  const currentTrackId = usePlayerStore((s) => s.currentTrack?.videoId);
  const { setContextQueue } = useQueueStore();
  const {
    navigateToRelease,
    navigateToArtist,
    navigateToTab,
    setSearchInitialQuery,
  } = useNavigationStore();

  useEffect(() => {
    let isMounted = true;
    async function loadExplore() {
      setIsLoading(true);
      try {
        const musicService = new MusicService();
        const data = await musicService.getExploreCategories();
        if (isMounted) setExploreData(data);
      } catch (err) {
        console.warn('[ExploreScreen] Load failed:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    loadExplore();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleCategorySearch = (categoryQuery: string) => {
    setSearchInitialQuery(categoryQuery);
    navigateToTab('search');
  };

  const scrollCarousel = (direction: 'left' | 'right') => {
    if (carouselRef.current) {
      const distance = carouselRef.current.clientWidth * 0.75;
      carouselRef.current.scrollBy({
        left: direction === 'left' ? -distance : distance,
        behavior: 'smooth',
      });
    }
  };

  const handleItemClick = (item: BrowseItem | any, contextList?: any[]) => {
    const isBrowse = Boolean(item.browseId || item.isAlbum || item.isPlaylist || item.isArtist);
    if (isBrowse && !item.videoId) {
      if (item.isArtist && (item.channelId || item.id)) {
        navigateToArtist(item.channelId || item.id);
      } else if (item.browseId || item.id) {
        navigateToRelease(item.browseId || item.id, item.isPlaylist ? 'playlist' : 'album');
      }
      return;
    }

    // Playable track item
    if (contextList && contextList.length > 0) {
      const playable = contextList
        .filter((it) => !it.isAlbum && !it.isPlaylist && !it.isArtist && (it.videoId || it.id))
        .map((it) => ({
          ...it,
          videoId: it.videoId || it.id,
          artist: it.artist || it.subtitle || 'Unknown Artist',
        }));
      const startIdx = playable.findIndex((s) => s.videoId === (item.videoId || item.id));
      if (playable.length > 0) {
        setContextQueue(playable as any, Math.max(0, startIdx));
      }
    }

    loadTrack(
      {
        ...item,
        videoId: item.videoId || item.id,
        artist: item.artist || item.subtitle || 'Unknown Artist',
      },
      'active',
      true
    );
  };

  const defaultCharts = [
    {
      id: 'chart_1',
      title: 'Global Top 100',
      subtitle: 'Daily most played songs worldwide',
      thumbnailUrl: 'https://i.ytimg.com/vi/5dNP-a-XXx0/hqdefault.jpg',
      isPlaylist: true,
      isAlbum: false,
      isArtist: false,
    },
    {
      id: 'chart_2',
      title: 'Viral Hits 2026',
      subtitle: 'Trending on socials & streaming',
      thumbnailUrl: 'https://i.ytimg.com/vi/dX3k_QDnzHE/hqdefault.jpg',
      isPlaylist: true,
      isAlbum: false,
      isArtist: false,
    },
    {
      id: 'chart_3',
      title: 'Synthwave & Cyberpunk',
      subtitle: 'Retro analog arpeggios and neon beats',
      thumbnailUrl: 'https://i.ytimg.com/vi/DCas2ZWGwl4/hqdefault.jpg',
      isPlaylist: true,
      isAlbum: false,
      isArtist: false,
    },
    {
      id: 'chart_4',
      title: 'Deep Electronic & Focus',
      subtitle: 'Minimal techno and ambient pulses',
      thumbnailUrl: 'https://i.ytimg.com/vi/MWdFrw53n6s/hqdefault.jpg',
      isPlaylist: true,
      isAlbum: false,
      isArtist: false,
    },
  ];

  const allTrending =
    exploreData?.trending && exploreData.trending.length > 0
      ? exploreData.trending
      : defaultCharts;
  const topChartItems = allTrending.slice(0, 4);
  const moreTrendingItems = allTrending.slice(4, 16);

  const moodTiles = [
    { title: 'Chill & Relax', gradient: 'from-blue-900/55 to-cyan-900/35', badge: 'Ambient' },
    { title: 'Workout Energy', gradient: 'from-orange-900/55 to-red-900/35', badge: 'High BPM' },
    { title: 'Deep Focus & Study', gradient: 'from-purple-900/55 to-indigo-900/35', badge: 'No Lyrics' },
    { title: 'Party & Weekend', gradient: 'from-pink-900/55 to-rose-900/35', badge: 'Club Mix' },
    { title: 'Sleep & Meditate', gradient: 'from-slate-900/55 to-teal-900/35', badge: 'Binaural' },
    { title: 'Gaming & Cyber', gradient: 'from-emerald-900/55 to-cyan-900/35', badge: 'OST & Synth' },
    { title: 'Romance & Sunset', gradient: 'from-amber-900/55 to-red-900/35', badge: 'Acoustic' },
    { title: 'Feel Good Indie', gradient: 'from-yellow-900/55 to-lime-900/35', badge: 'Uplifting' },
  ];

  const genres = [
    { name: 'Electronic', color: '#FA2D48' },
    { name: 'Synthwave', color: '#9B51E0' },
    { name: 'Pop', color: '#2F80ED' },
    { name: 'Hip-Hop & R&B', color: '#F2994A' },
    { name: 'Rock & Alternative', color: '#EB5757' },
    { name: 'Ambient & Lo-Fi', color: '#27AE60' },
    { name: 'Jazz & Soul', color: '#E2B93B' },
    { name: 'Classical & Film', color: '#56CCF2' },
  ];

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-12 select-none animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full liquid-glass-pill text-[11px] font-bold text-[var(--color-accent)] mb-2">
            <Sparkles size={12} />
            Global Discovery
          </div>
          <h1 className="text-3xl font-black tracking-tight text-[var(--color-text-primary)]">
            Explore
          </h1>
          <p className="text-xs text-[var(--color-text-secondary)] pt-1">
            Discover top charts, lifestyle stations, and global genre catalogues
          </p>
        </div>

        {/* Quick Mood Chips */}
        {exploreData?.chips && exploreData.chips.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            {exploreData.chips.map((chip) => (
              <button
                key={chip}
                onClick={() => handleCategorySearch(`${chip} music`)}
                className="spring-press liquid-glass-pill px-3.5 py-1.5 rounded-full text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] whitespace-nowrap cursor-pointer"
              >
                {chip}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 1. Top Charts Section (Ranked #1 to #4 with macOS Dual-Hover Controls) */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Trophy size={18} className="text-yellow-400" />
          <h2 className="text-lg font-bold tracking-tight text-[var(--color-text-primary)]">Top Charts</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {topChartItems.map((item: any, idx) => (
            <div
              key={item.id || idx}
              onClick={() => handleItemClick(item, allTrending)}
              onContextMenu={(e) => onOpenContextMenu && onOpenContextMenu(e, item)}
              className="acrylic-tile group relative p-4 rounded-lg transition-all cursor-pointer flex flex-col justify-between h-44"
            >
              <div className="flex items-start justify-between">
                <span className="w-6 h-6 rounded-full bg-[#FA2D48] text-white font-bold text-[11px] flex items-center justify-center shadow-md">
                  #{idx + 1}
                </span>
                <div className="artwork-lockup relative w-16 h-16 rounded-lg overflow-hidden bg-neutral-900">
                  <img
                    src={
                      item.thumbnailUrl ||
                      'https://i.ytimg.com/vi/5dNP-a-XXx0/hqdefault.jpg'
                    }
                    alt={item.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  {/* macOS Dual-Hover Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent opacity-0 group-hover:opacity-100 flex items-end justify-between p-1.5 transition-opacity">
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        handleItemClick(item, allTrending);
                      }}
                      className="w-7 h-7 rounded-full bg-[#FA2D48] text-white shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-transform cursor-pointer"
                      title="Play"
                    >
                      <PlayerPlayIcon size={12} className="ml-0.5 text-white" />
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onOpenContextMenu) {
                          onOpenContextMenu(e, item);
                        }
                      }}
                      className="w-6 h-6 rounded-full bg-black/60 hover:bg-black/80 text-white/90 border border-white/20 flex items-center justify-center transition-all cursor-pointer"
                      title="More Options"
                    >
                      <MoreHorizontal size={12} />
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-bold truncate text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)]">
                  {item.title}
                </h3>
                <p className="text-xs text-[var(--color-text-secondary)] line-clamp-1 pt-0.5">
                  {item.subtitle || 'Apple Music Top 100'}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 2. New Releases & Trending Carousel Shelf (with < > arrows) */}
      {moreTrendingItems.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Flame size={18} className="text-orange-400" />
              <h2 className="text-lg font-bold tracking-tight text-[var(--color-text-primary)]">
                New Releases & Trending
              </h2>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => scrollCarousel('left')}
                className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 active:bg-white/15 flex items-center justify-center text-white/80 hover:text-white transition-all cursor-pointer"
                title="Previous"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => scrollCarousel('right')}
                className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 active:bg-white/15 flex items-center justify-center text-white/80 hover:text-white transition-all cursor-pointer"
                title="Next"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          <div
            ref={carouselRef}
            className="flex items-center gap-4 overflow-x-auto pb-2 scrollbar-none scroll-smooth"
          >
            {moreTrendingItems.map((item: any, idx) => (
              <div
                key={item.id || idx}
                onClick={() => handleItemClick(item, moreTrendingItems)}
                onContextMenu={(e) => onOpenContextMenu && onOpenContextMenu(e, item)}
                className="acrylic-tile group flex-shrink-0 w-44 p-3 rounded-lg cursor-pointer"
              >
                <div className="artwork-lockup relative aspect-square rounded-lg overflow-hidden mb-2.5 bg-neutral-900">
                  <img
                    src={
                      item.thumbnailUrl ||
                      'https://i.ytimg.com/vi/5dNP-a-XXx0/hqdefault.jpg'
                    }
                    alt={item.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  {/* macOS Dual-Hover Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent opacity-0 group-hover:opacity-100 flex items-end justify-between p-2.5 transition-opacity">
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        handleItemClick(item, moreTrendingItems);
                      }}
                      className="w-8 h-8 rounded-full bg-[#FA2D48] text-white shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-transform cursor-pointer"
                      title="Play"
                    >
                      <PlayerPlayIcon size={14} className="ml-0.5 text-white" />
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onOpenContextMenu) {
                          onOpenContextMenu(e, item);
                        }
                      }}
                      className="w-7 h-7 rounded-full bg-black/60 hover:bg-black/80 text-white/90 border border-white/20 flex items-center justify-center transition-all cursor-pointer"
                      title="More Options"
                    >
                      <MoreHorizontal size={13} />
                    </button>
                  </div>
                </div>
                <h3 className="text-xs font-bold truncate text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)]">
                  {item.title}
                </h3>
                <p className="text-[11px] text-[var(--color-text-secondary)] truncate pt-0.5">
                  {item.subtitle || 'Trending'}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 3. Moods & Activities Discovery Tiles */}
      <section className="space-y-4">
        <h2 className="text-lg font-bold tracking-tight text-[var(--color-text-primary)]">
          Moods & Activities
        </h2>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
          {moodTiles.map((tile) => (
            <div
              key={tile.title}
              onClick={() => handleCategorySearch(tile.title)}
              className={`acrylic-tile group relative p-4 rounded-lg cursor-pointer overflow-hidden h-28 flex flex-col justify-between transition-all hover:scale-[1.02] bg-gradient-to-br ${tile.gradient}`}
            >
              <span className="self-start px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/15 border border-white/20 text-white/90">
                {tile.badge}
              </span>
              <h3 className="text-sm font-black text-white group-hover:text-[var(--color-accent)] transition-colors leading-snug">
                {tile.title}
              </h3>
            </div>
          ))}
        </div>
      </section>

      {/* 4. Global Genre Hub */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Disc size={18} className="text-[var(--color-accent)]" />
          <h2 className="text-lg font-bold tracking-tight text-[var(--color-text-primary)]">Genres</h2>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {genres.map((genre) => (
            <button
              key={genre.name}
              onClick={() => handleCategorySearch(`${genre.name} music`)}
              className="acrylic-tile p-3.5 rounded-lg text-left flex items-center justify-between group cursor-pointer transition-all hover:border-white/20"
            >
              <div className="flex items-center gap-2.5">
                <span
                  style={{ backgroundColor: genre.color }}
                  className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm"
                />
                <span className="text-xs font-bold text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)] transition-colors">
                  {genre.name}
                </span>
              </div>
              <ChevronRight
                size={14}
                className="text-[var(--color-text-secondary)] opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all"
              />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
});

ExploreScreen.displayName = 'ExploreScreen';
