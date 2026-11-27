// src/ui/views/HomeScreen.tsx
// Home View (1:1 macOS Apple Music Desktop Experience with Liquid Glass):
// Editorial Top Picks Showcase (<=220px), Mood Capsule Bar, Horizontal Carousel Shelves (< >), Responsive Card Grids, Dual-Hover Controls

import React, { useState, useEffect, useRef, memo } from 'react';
import {
  Shuffle,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Music,
  MoreHorizontal,
} from 'lucide-react';
import { MusicService } from '../../services/MusicService';
import { AccountAuthService } from '../../services/AccountAuthService';
import type { HomeShelf, BrowseItem } from '../../models/Navigation';
import type { Song } from '../../models/Song';
import type { OpenContextMenuFn } from '../hooks/useContextMenu';
import { usePlayerStore } from '../../state/playerStore';
import { useQueueStore } from '../../state/queueStore';
import { useNavigationStore } from '../../state/navigationStore';
import { useLibraryStore } from '../../state/libraryStore';
import { PlayerPlayIcon, LosslessWaveIcon } from '../common/WaveFormIcons';

export interface HomeScreenProps {
  onOpenContextMenu?: OpenContextMenuFn;
}

export const HomeScreen: React.FC<HomeScreenProps> = memo(({ onOpenContextMenu }) => {
  const [shelves, setShelves] = useState<HomeShelf[]>([]);
  const [chips, setChips] = useState<string[]>([
    'ALL',
    'Energize',
    'Relax',
    'Workout',
    'Commute',
    'Focus',
  ]);
  const [activeChip, setActiveChip] = useState<string>('ALL');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [ytAuth, setYtAuth] = useState<{ connected: boolean; displayName?: string }>({
    connected: false,
  });

  const chipDebounceTimer = useRef<NodeJS.Timeout | null>(null);
  const shelfRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const loadTrack = usePlayerStore((s) => s.loadTrack);
  const currentTrackId = usePlayerStore((s) => s.currentTrack?.videoId);
  const { setContextQueue } = useQueueStore();
  const { navigateToRelease, navigateToArtist, setReplayOpen } = useNavigationStore();
  const listeningHistory = useLibraryStore((s) => s.listeningHistory);
  const yearlyReplayStats = useLibraryStore((s) => s.yearlyReplayStats);
  const monthlyStats = useLibraryStore((s) => s.monthlyStats);
  const recentTracks = listeningHistory.slice(0, 12);

  useEffect(() => {
    let isMounted = true;
    async function loadHome() {
      setIsLoading(true);
      try {
        const musicService = new MusicService();
        const [homeShelves, exploreData, authStatus] = await Promise.all([
          musicService.getHomeShelves(),
          musicService.getExploreCategories(),
          AccountAuthService.getAccountAuthStatus().catch(() => ({
            ytmusic: { connected: false },
            spotify: { connected: false },
          })),
        ]);
        if (!isMounted) return;
        setShelves(homeShelves);
        if (exploreData.chips && exploreData.chips.length > 0) {
          setChips(['ALL', ...exploreData.chips]);
        }
        if (authStatus?.ytmusic) {
          setYtAuth(authStatus.ytmusic);
        }
      } catch (err: any) {
        if (isMounted) setError(err.message || 'Failed to load home feed');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    loadHome();

    // Subscribe to auth status changes to auto-refresh personalized shelves
    const unsubscribe = AccountAuthService.onAuthChanged(async ({ provider }) => {
      if (provider === 'ytmusic') {
        try {
          const authStatus = await AccountAuthService.getAccountAuthStatus();
          if (isMounted && authStatus?.ytmusic) {
            setYtAuth(authStatus.ytmusic);
          }
          const musicService = new MusicService();
          const [homeShelves, exploreData] = await Promise.all([
            musicService.getHomeShelves(),
            musicService.getExploreCategories(),
          ]);
          if (isMounted) {
            setShelves(homeShelves);
            if (exploreData.chips && exploreData.chips.length > 0) {
              setChips(['ALL', ...exploreData.chips]);
            }
          }
        } catch (err) {
          console.warn('[HomeScreen] Failed to refresh personalized home shelves:', err);
        }
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  // Debounced chip filtering
  const handleChipSelect = (selectedChip: string) => {
    setActiveChip(selectedChip);
    if (chipDebounceTimer.current) clearTimeout(chipDebounceTimer.current);

    chipDebounceTimer.current = setTimeout(async () => {
      const musicService = new MusicService();
      try {
        if (selectedChip === 'ALL') {
          const homeShelves = await musicService.getHomeShelves();
          setShelves(homeShelves);
        } else {
          const [homeShelves, moodSearch] = await Promise.all([
            musicService.getHomeShelves(),
            musicService.search(`${selectedChip} music`, 'songs').catch(() => null),
          ]);
          const filtered = homeShelves.filter(
            (s) =>
              s.title.toLowerCase().includes(selectedChip.toLowerCase()) ||
              (s.subtitle && s.subtitle.toLowerCase().includes(selectedChip.toLowerCase()))
          );
          if (moodSearch && moodSearch.items.length > 0) {
            const moodShelf: HomeShelf = {
              id: `mood_${selectedChip.toLowerCase()}`,
              title: `${selectedChip} Picks`,
              subtitle: `Curated for ${selectedChip}`,
              layout: 'ROW',
              items: moodSearch.items,
            };
            setShelves([moodShelf, ...(filtered.length > 0 ? filtered : homeShelves)]);
          } else {
            setShelves(filtered.length > 0 ? filtered : homeShelves);
          }
        }
      } catch (err) {
        console.warn('[HomeScreen] Chip filter failed:', err);
      }
    }, 200);
  };

  const scrollShelf = (shelfKey: string, direction: 'left' | 'right') => {
    const el = shelfRefs.current[shelfKey];
    if (el) {
      const distance = el.clientWidth * 0.75;
      el.scrollBy({
        left: direction === 'left' ? -distance : distance,
        behavior: 'smooth',
      });
    }
  };

  const handlePlaySong = (song: Song, contextItems?: any[]) => {
    if (contextItems && contextItems.length > 0) {
      const playableSongs = contextItems
        .filter((it) => !it.isAlbum && !it.isPlaylist && !it.isArtist && (it.videoId || it.id))
        .map((it) => ({
          ...it,
          videoId: it.videoId || it.id,
          artist: it.artist || it.subtitle || 'Unknown Artist',
        }));
      const startIdx = playableSongs.findIndex(
        (s) => s.videoId === (song.videoId || (song as any).id)
      );
      if (playableSongs.length > 0) {
        setContextQueue(playableSongs as any, Math.max(0, startIdx));
      }
    }
    loadTrack(
      {
        ...song,
        videoId: song.videoId || (song as any).id,
        artist: song.artist || (song as any).subtitle || 'Unknown Artist',
      },
      'active',
      true
    );
  };

  const handleItemClick = (item: BrowseItem | Song, shelfItems?: any[]) => {
    const bItem = item as any;
    const isBrowse = Boolean(bItem.browseId || bItem.isAlbum || bItem.isPlaylist || bItem.isArtist);
    if (isBrowse && !bItem.videoId) {
      if (bItem.isArtist && (bItem.channelId || bItem.id)) {
        navigateToArtist(bItem.channelId || bItem.id);
      } else if (bItem.browseId || bItem.id) {
        const id = bItem.browseId || bItem.id;
        const type = bItem.isPlaylist ? 'playlist' : 'album';
        navigateToRelease(id, type);
      }
    } else {
      handlePlaySong(item as Song, shelfItems);
    }
  };

  const defaultHeroFallback: any = {
    id: '5dNP-a-XXx0',
    videoId: '5dNP-a-XXx0',
    title: 'Overdrive',
    subtitle: 'Lazerhawk • Redline',
    artist: 'Lazerhawk',
    thumbnailUrl: 'https://i.ytimg.com/vi/5dNP-a-XXx0/hqdefault.jpg',
    secondaryText: '4:31',
  };

  const allShelfItems = shelves.flatMap((s) => s.items || []);
  const firstPlayableHero = allShelfItems.find(
    (it: any) => !it.isAlbum && !it.isPlaylist && !it.isArtist && (it.videoId || it.id)
  );
  const heroItem = (firstPlayableHero || shelves[0]?.items?.[0] || defaultHeroFallback) as any;
  const heroCover =
    heroItem?.thumbnailUrl ||
    heroItem?.artworkUrl ||
    'https://i.ytimg.com/vi/5dNP-a-XXx0/hqdefault.jpg';

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12 select-none animate-in fade-in duration-200">
      {/* 1. Compact 220px Hero Showcase (Editorial Top Picks) */}
      <div className="acrylic-tile relative overflow-hidden rounded-3xl p-5 md:p-6 flex flex-col md:flex-row items-center justify-between gap-5 min-h-[200px] max-h-[220px]">
        <div className="relative z-10 max-w-xl space-y-2.5">
          <div className="flex items-center gap-2">
            <span className="liquid-glass-pill-active inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-[10px] font-bold">
              <Sparkles size={11} />
              Featured Pick
            </span>
            {ytAuth.connected && (
              <span className="liquid-glass-pill inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold text-white/90 border border-white/20">
                Personalized for {ytAuth.displayName || 'YouTube Music'}
              </span>
            )}
            <span className="liquid-glass-pill inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold text-white/85">
              <LosslessWaveIcon size={11} className="text-[var(--color-accent)]" />
              Lossless 24-bit
            </span>
          </div>

          <h1 className="text-2xl md:text-3xl font-black tracking-tight text-white leading-tight truncate max-w-lg">
            {heroItem?.title || 'Overdrive'}
          </h1>

          <p className="text-xs text-[var(--color-text-secondary)] line-clamp-2 max-w-md">
            {heroItem?.subtitle ||
              heroItem?.artist ||
              'Stream high-resolution audio with real-time 68-bar waveform scrubbing and dynamic Liquid Glass optics.'}
          </p>

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => {
                handleItemClick(heroItem, allShelfItems.length > 0 ? allShelfItems : [defaultHeroFallback]);
              }}
              className="spring-press liquid-glass-pill-active flex items-center gap-2 px-5 py-2 rounded-full font-bold text-xs cursor-pointer"
            >
              <PlayerPlayIcon size={14} />
              <span>Play Now</span>
            </button>
            <button
              onClick={() => {
                const items = allShelfItems.length > 0 ? allShelfItems : [defaultHeroFallback];
                const randomItem = items[Math.floor(Math.random() * Math.max(1, items.length))];
                if (randomItem) handleItemClick(randomItem, items);
              }}
              className="spring-press liquid-glass-pill flex items-center gap-2 px-4 py-2 rounded-full text-[var(--color-primary)] font-semibold text-xs cursor-pointer"
            >
              <Shuffle size={13} />
              <span>Shuffle</span>
            </button>
          </div>
        </div>

        {/* Hero Artwork Lockup with macOS Hover Actions */}
        <div
          onClick={() =>
            handleItemClick(heroItem, allShelfItems.length > 0 ? allShelfItems : [defaultHeroFallback])
          }
          className="artwork-lockup relative z-10 w-32 h-32 md:w-36 md:h-36 rounded-2xl shrink-0 cursor-pointer group"
        >
          <img
            src={heroCover}
            alt={heroItem?.title || 'Featured'}
            className="w-full h-full object-cover rounded-2xl group-hover:scale-105 transition-transform duration-500"
          />
          {/* Floating Play Pill */}
          <div className="absolute bottom-2.5 right-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="w-9 h-9 rounded-full bg-[#FA2D48] text-white flex items-center justify-center shadow-lg shadow-[#FA2D48]/30">
              <PlayerPlayIcon size={16} className="ml-0.5" />
            </div>
          </div>
        </div>

        <div
          style={{ background: 'var(--artwork-edge-wash, rgba(250,45,72,0.18))' }}
          className="absolute -right-12 -bottom-12 w-80 h-80 rounded-full blur-3xl pointer-events-none opacity-50"
        />
      </div>

      {/* 2. WinUI 3 Acrylic Mood & Activity Filter Capsule Bar */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        {chips.map((chip) => {
          const isActive = activeChip === chip;
          return (
            <button
              key={chip}
              onClick={() => handleChipSelect(chip)}
              className={`spring-press px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap cursor-pointer transition-all ${
                isActive
                  ? 'bg-white/20 text-white border border-white/30 shadow-sm'
                  : 'bg-white/10 text-white/80 border border-white/10 hover:text-white hover:bg-white/15'
              }`}
            >
              {chip}
            </button>
          );
        })}
      </div>

      {/* 2b. Prominent 2026 Replay Highlights Banner */}
      {(() => {
        const replayPlays = yearlyReplayStats?.totalPlaysCount ?? monthlyStats?.totalPlaysCount ?? 0;
        const replayMinutes = Math.round(
          (yearlyReplayStats?.totalListeningTimeSec ?? monthlyStats?.totalListeningTimeSec ?? 0) / 60
        );
        const replayTopArtist =
          yearlyReplayStats?.topArtists?.[0]?.artistName ??
          monthlyStats?.topArtists?.[0]?.artistName ??
          null;

        return (
          <div
            onClick={() => setReplayOpen(true)}
            className="acrylic-tile relative overflow-hidden rounded-2xl px-5 py-4 flex items-center justify-between gap-4 cursor-pointer group border border-white/10"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-[#FA2D48] to-purple-600 flex items-center justify-center text-white shadow-lg shadow-[#FA2D48]/25 shrink-0">
                <Sparkles size={20} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-extrabold text-white tracking-tight">2026 Replay</h2>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#FA2D48]/20 text-[#FA2D48]">
                    Interactive Stories
                  </span>
                </div>
                <p className="text-xs text-[var(--color-text-secondary)] truncate mt-0.5">
                  {replayPlays > 0
                    ? `${replayMinutes.toLocaleString()} min listened • ${replayPlays.toLocaleString()} plays${replayTopArtist ? ` • Top Artist: ${replayTopArtist}` : ''}`
                    : 'Your 2026 Replay is warming up — open your interactive 5-slide year-in-review.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setReplayOpen(true);
              }}
              className="spring-press liquid-glass-pill-active px-4 py-2 rounded-full text-xs font-bold text-white shrink-0 cursor-pointer"
            >
              Open 2026 Replay
            </button>
          </div>
        );
      })()}

      {/* 3. Recently Played Carousel Shelf (with < > navigation) */}
      {recentTracks.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold tracking-tight text-white">Recently Played</h2>
            <div className="flex items-center gap-1">
              <button
                onClick={() => scrollShelf('recently_played', 'left')}
                className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 active:bg-white/15 flex items-center justify-center text-white/80 hover:text-white transition-all cursor-pointer"
                title="Previous"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => scrollShelf('recently_played', 'right')}
                className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 active:bg-white/15 flex items-center justify-center text-white/80 hover:text-white transition-all cursor-pointer"
                title="Next"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          <div
            ref={(el) => {
              shelfRefs.current['recently_played'] = el;
            }}
            className="flex items-center gap-3.5 overflow-x-auto pb-2 scrollbar-none scroll-smooth"
          >
            {recentTracks.map((item, idx) => {
              const recentArt =
                (item as any).artworkUrl ||
                (/^[A-Za-z0-9_-]{11}$/.test(item.videoId || '')
                  ? `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`
                  : null);
              return (
              <div
                key={idx}
                onClick={() =>
                  handlePlaySong({
                    videoId: item.videoId,
                    title: item.title,
                    artist: item.artist,
                    albumName: (item as any).albumName || undefined,
                    thumbnailUrl: recentArt,
                    artworkUrl: recentArt || undefined,
                    liked: false,
                    totalPlayTimeMs: item.durationSec * 1000,
                    playCount: 1,
                    artistIds: [],
                    artists: [],
                    isExplicit: false,
                  })
                }
                onContextMenu={(e) =>
                  onOpenContextMenu &&
                  onOpenContextMenu(e, {
                    videoId: item.videoId,
                    title: item.title,
                    artist: item.artist,
                    liked: false,
                    totalPlayTimeMs: item.durationSec * 1000,
                    playCount: 1,
                    artistIds: [],
                    artists: [],
                    isExplicit: false,
                  })
                }
                className="acrylic-tile group flex-shrink-0 w-36 p-2.5 rounded-lg cursor-pointer"
              >
                <div className="artwork-lockup relative w-full aspect-square rounded-lg bg-neutral-900 mb-2 overflow-hidden">
                  {recentArt && (
                    <img
                      src={recentArt}
                      alt={item.title}
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  )}
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-neutral-800 to-neutral-900 text-neutral-500">
                    <Music size={22} />
                  </div>
                  {/* macOS Hover Overlay: bottom-left play circle and bottom-right ... circle */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent opacity-0 group-hover:opacity-100 flex items-end justify-between p-2 transition-opacity">
                    <div className="w-8 h-8 rounded-full bg-[#FA2D48] text-white shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-transform">
                      <PlayerPlayIcon size={14} className="ml-0.5 text-white" />
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onOpenContextMenu) {
                          onOpenContextMenu(e, {
                            videoId: item.videoId,
                            title: item.title,
                            artist: item.artist,
                            liked: false,
                            totalPlayTimeMs: item.durationSec * 1000,
                            playCount: 1,
                            artistIds: [],
                            artists: [],
                            isExplicit: false,
                          });
                        }
                      }}
                      className="w-7 h-7 rounded-full bg-black/60 hover:bg-black/80 text-white/90 border border-white/20 flex items-center justify-center transition-all cursor-pointer"
                      title="More Options"
                    >
                      <MoreHorizontal size={13} />
                    </button>
                  </div>
                </div>
                <div className="text-xs font-bold truncate text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)]">
                  {item.title}
                </div>
                <div className="text-[11px] text-[var(--color-text-secondary)] truncate">
                  {item.artist}
                </div>
              </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 4. Dynamic Feed Shelves (Horizontal Carousels & Grid Shelves with < > arrows) */}
      {shelves.map((shelf, sIdx) => {
        const title = shelf.title && shelf.title.trim() ? shelf.title : 'Featured Collection';
        const items = shelf.items || [];
        if (items.length === 0) return null;
        const shelfKey = shelf.id || `shelf_${sIdx}`;

        return (
          <section key={shelfKey} className="space-y-3.5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold tracking-tight text-white">{title}</h2>
                {shelf.subtitle && (
                  <p className="text-xs text-[var(--color-text-secondary)]">{shelf.subtitle}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const first = items[0];
                    if (first) handleItemClick(first, items);
                  }}
                  className="text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors cursor-pointer mr-1"
                >
                  Play all
                </button>
                {/* Carousel Navigation Arrows < > */}
                <button
                  onClick={() => scrollShelf(shelfKey, 'left')}
                  className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 active:bg-white/15 flex items-center justify-center text-white/80 hover:text-white transition-all cursor-pointer"
                  title="Previous"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={() => scrollShelf(shelfKey, 'right')}
                  className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 active:bg-white/15 flex items-center justify-center text-white/80 hover:text-white transition-all cursor-pointer"
                  title="Next"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            {/* Horizontal Carousel Shelf Container */}
            <div
              ref={(el) => {
                shelfRefs.current[shelfKey] = el;
              }}
              className="flex items-center gap-3.5 overflow-x-auto pb-2 scrollbar-none scroll-smooth"
            >
              {items.slice(0, 16).map((item: any, iIdx: number) => {
                const cover =
                  item.thumbnailUrl ||
                  item.artworkUrl ||
                  'https://i.ytimg.com/vi/5dNP-a-XXx0/hqdefault.jpg';
                const isActiveTrack = Boolean(
                  currentTrackId &&
                  (currentTrackId === item.videoId || currentTrackId === item.id)
                );

                return (
                  <div
                    key={item.id || item.videoId || iIdx}
                    onClick={() => handleItemClick(item, items)}
                    onContextMenu={(e) => onOpenContextMenu && onOpenContextMenu(e, item)}
                    className={`acrylic-tile group flex-shrink-0 w-40 p-2.5 rounded-lg cursor-pointer ${
                      isActiveTrack ? 'border-[var(--color-accent)]/60' : ''
                    }`}
                  >
                    <div className="artwork-lockup relative aspect-square rounded-lg mb-2 bg-neutral-900 overflow-hidden">
                      <img
                        src={cover}
                        alt={item.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      {/* macOS Apple Music Dual-Hover Overlay: bottom-left play circle + bottom-right ... circle */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent opacity-0 group-hover:opacity-100 flex items-end justify-between p-2.5 transition-opacity">
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlaySong(item as Song, items);
                          }}
                          className="w-9 h-9 rounded-full bg-[#FA2D48] text-white shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-transform cursor-pointer"
                          title="Play"
                        >
                          <PlayerPlayIcon size={16} className="ml-0.5 text-white" />
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onOpenContextMenu) {
                              onOpenContextMenu(e, item);
                            }
                          }}
                          className="w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 text-white/90 border border-white/20 flex items-center justify-center transition-all cursor-pointer"
                          title="More Options"
                        >
                          <MoreHorizontal size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="text-xs font-bold truncate text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)]">
                      {item.title}
                    </div>
                    <div className="text-[11px] text-[var(--color-text-secondary)] truncate">
                      {item.subtitle ||
                        item.artist ||
                        (item.isAlbum ? 'Album' : item.isPlaylist ? 'Playlist' : 'Single')}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
});

HomeScreen.displayName = 'HomeScreen';
