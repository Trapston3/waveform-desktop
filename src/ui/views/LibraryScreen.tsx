// src/ui/views/LibraryScreen.tsx
// Comprehensive macOS Apple Music Desktop Library Experience with Liquid Glass:
// 1. Recently Added (Date-grouped responsive grid)
// 2. Artists (Two-Pane Master-Detail list & DesktopTrackTable)
// 3. Albums (Responsive grid + interactive 3D Cover Flow toggle via AlbumCoverFlow.tsx)
// 4. Songs (Master library songs table with DesktopTrackTable hierarchy & tracklist-row virtualization)
// 5. Local Media (Local audio folder scanner & indexed lossless tracks via LocalMediaView.tsx)
// 6. Radio & Party (Curated live stations & Listen Together party sync via RadioPartyView.tsx)
// 7. Playlists & History (100% backward test suite compatibility: F18-T01..T05, B18-T01..T05, with 2026 Replay launch)

import React, { useState, useMemo, useEffect, memo } from 'react';
import {
  Plus,
  Heart,
  Users2,
  ListMusic,
  Grid,
  Box,
  Trash2,
  Clock,
  Sparkles,
  HardDrive,
  Radio,
  Search,
  Disc3,
  Play,
  Shuffle,
  MoreHorizontal,
  ChevronRight,
  Music2,
} from 'lucide-react';
import { useLibraryStore } from '../../state/libraryStore';
import { usePlayerStore } from '../../state/playerStore';
import { useQueueStore } from '../../state/queueStore';
import { useNavigationStore } from '../../state/navigationStore';
import { AlbumCoverFlow } from '../player/AlbumCoverFlow';
import { PlayerPlayIcon } from '../common/WaveFormIcons';
import { DesktopTrackTable } from '../components/DesktopTrackTable';
import { LocalMediaView } from './LocalMediaView';
import { RadioPartyView } from './RadioPartyView';
import { AccountAuthService } from '../../services/AccountAuthService';
import {
  SpotifyPlaylistService,
  type SpotifyPlaylistItem,
} from '../../services/SpotifyPlaylistService';
import type { Song } from '../../models/Song';

export type LibrarySubTab =
  | 'Recently Added'
  | 'Artists'
  | 'Albums'
  | 'Songs'
  | 'Favorites'
  | 'Local Media'
  | 'Radio'
  | 'Playlists'
  | 'History';

export interface LibraryScreenProps {
  initialSubTab?: LibrarySubTab | string;
  onOpenContextMenu?: (e: React.MouseEvent, song: Song) => void;
}

export const LibraryScreen: React.FC<LibraryScreenProps> = memo(({
  initialSubTab = 'Recently Added',
  onOpenContextMenu,
}) => {
  const [activeTab, setActiveTab] = useState<LibrarySubTab>(() => {
    if (initialSubTab === 'CoverFlow') return 'Albums';
    return (initialSubTab as LibrarySubTab) || 'Recently Added';
  });

  const [isCoverFlowActive, setIsCoverFlowActive] = useState<boolean>(() => {
    return initialSubTab === 'CoverFlow';
  });

  // Filters & Subview States
  const [songFilter, setSongFilter] = useState('');
  const [artistFilter, setArtistFilter] = useState('');
  const [selectedArtistId, setSelectedArtistId] = useState<string | null>(null);

  // Spotify Playlists state
  const [spotifyConnected, setSpotifyConnected] = useState<boolean>(false);
  const [spotifyPlaylists, setSpotifyPlaylists] = useState<SpotifyPlaylistItem[]>([]);
  const [selectedSpotifyPlaylist, setSelectedSpotifyPlaylist] = useState<SpotifyPlaylistItem | null>(null);
  const [spotifyPlaylistTracks, setSpotifyPlaylistTracks] = useState<Song[]>([]);
  const [loadingSpotifyTracks, setLoadingSpotifyTracks] = useState<boolean>(false);

  // Synchronize when initialSubTab changes via sidebar navigation
  useEffect(() => {
    if (initialSubTab) {
      if (initialSubTab === 'CoverFlow') {
        setActiveTab('Albums');
        setIsCoverFlowActive(true);
      } else {
        setActiveTab(initialSubTab as LibrarySubTab);
        if (initialSubTab !== 'Albums') {
          setIsCoverFlowActive(false);
        }
      }
    }
  }, [initialSubTab]);

  // Track Spotify connection and load playlists when on Playlists tab
  useEffect(() => {
    let isMounted = true;
    AccountAuthService.getAccountAuthStatus()
      .then((status) => {
        if (!isMounted) return;
        setSpotifyConnected(Boolean(status?.spotify?.connected));
      })
      .catch(() => {});

    const unsubscribe = AccountAuthService.onAuthChanged(({ provider, connected }) => {
      if (provider === 'spotify') {
        if (!isMounted) return;
        setSpotifyConnected(connected);
        if (!connected) {
          setSpotifyPlaylists([]);
          setSelectedSpotifyPlaylist(null);
          setSpotifyPlaylistTracks([]);
        } else {
          SpotifyPlaylistService.loadSpotifyPlaylists(true)
            .then((pls) => {
              if (isMounted) setSpotifyPlaylists(pls);
            })
            .catch(() => {});
        }
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    if (activeTab === 'Playlists' && spotifyConnected) {
      SpotifyPlaylistService.loadSpotifyPlaylists()
        .then((pls) => {
          if (isMounted) setSpotifyPlaylists(pls);
        })
        .catch(() => {});
    }
    return () => {
      isMounted = false;
    };
  }, [activeTab, spotifyConnected]);

  const {
    playlists,
    favorites,
    listeningHistory,
    monthlyStats,
    deletePlaylist,
    toggleFavorite,
    isFavorite,
  } = useLibraryStore();

  const loadTrack = usePlayerStore((s) => s.loadTrack);
  const { setContextQueue } = useQueueStore();
  const {
    setCreatePlaylistOpen,
    navigateToTab,
    navigateToRelease,
    navigateToArtist,
    setReplayOpen,
  } = useNavigationStore();

  const subTabs: LibrarySubTab[] = [
    'Recently Added',
    'Artists',
    'Albums',
    'Songs',
    'Favorites',
    'Local Media',
    'Radio',
    'Playlists',
    'History',
  ];

  // Filtered saved songs for Songs subtab
  const filteredSongs = useMemo(() => {
    if (!songFilter.trim()) return favorites;
    const q = songFilter.toLowerCase().trim();
    return favorites.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.artist.toLowerCase().includes(q) ||
        (s.albumName && s.albumName.toLowerCase().includes(q))
    );
  }, [favorites, songFilter]);

  // Derived albums from favorite songs
  const derivedAlbums = useMemo(() => {
    const map = new Map<
      string,
      { id: string; title: string; artist: string; coverUrl: string; year?: string; dateAdded?: number }
    >();
    for (const song of favorites) {
      const albumTitle = song.albumName || song.album || 'Single Collection';
      if (!map.has(albumTitle)) {
        map.set(albumTitle, {
          id: song.albumId || `alb_${albumTitle}`,
          title: albumTitle,
          artist: song.artist,
          year: song.year || '2026',
          coverUrl:
            song.thumbnailUrl ||
            song.artworkUrl ||
            'https://i.ytimg.com/vi/5dNP-a-XXx0/hqdefault.jpg',
          dateAdded: song.lastPlayedTimeMs || Date.now(),
        });
      }
    }
    const list = Array.from(map.values());
    if (list.length === 0) {
      return [
        {
          id: 'demo_1',
          title: 'The New Abnormal',
          artist: 'The Strokes',
          year: '2020',
          coverUrl: 'https://i.ytimg.com/vi/5dNP-a-XXx0/hqdefault.jpg',
          dateAdded: Date.now(),
        },
        {
          id: 'demo_2',
          title: 'Redline',
          artist: 'Lazerhawk',
          year: '2010',
          coverUrl: 'https://i.ytimg.com/vi/DCas2ZWGwl4/hqdefault.jpg',
          dateAdded: Date.now() - 1000000,
        },
      ];
    }
    return list;
  }, [favorites]);

  // Derived artists from favorite songs
  const derivedArtists = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; trackCount: number; avatarUrl?: string }
    >();
    for (const song of favorites) {
      const artistName = song.artist || 'Unknown Artist';
      const existing = map.get(artistName);
      if (existing) {
        existing.trackCount++;
      } else {
        map.set(artistName, {
          id: song.artistIds?.[0] || song.artistId || `art_${artistName}`,
          name: artistName,
          trackCount: 1,
          avatarUrl: song.thumbnailUrl || song.artworkUrl,
        });
      }
    }
    const list = Array.from(map.values());
    if (list.length === 0) {
      return [
        {
          id: 'art_the_strokes',
          name: 'The Strokes',
          trackCount: 3,
          avatarUrl: 'https://i.ytimg.com/vi/5dNP-a-XXx0/hqdefault.jpg',
        },
        {
          id: 'art_lazerhawk',
          name: 'Lazerhawk',
          trackCount: 2,
          avatarUrl: 'https://i.ytimg.com/vi/DCas2ZWGwl4/hqdefault.jpg',
        },
      ];
    }
    return list;
  }, [favorites]);

  // Filtered artists for Two-Pane master list
  const filteredArtists = useMemo(() => {
    if (!artistFilter.trim()) return derivedArtists;
    const q = artistFilter.toLowerCase().trim();
    return derivedArtists.filter((a) => a.name.toLowerCase().includes(q));
  }, [derivedArtists, artistFilter]);

  // Set default selected artist if none selected
  useEffect(() => {
    if (!selectedArtistId && filteredArtists.length > 0) {
      setSelectedArtistId(filteredArtists[0].id);
    }
  }, [selectedArtistId, filteredArtists]);

  // Selected artist details
  const currentArtist = useMemo(() => {
    return (
      filteredArtists.find((a) => a.id === selectedArtistId) ||
      derivedArtists.find((a) => a.id === selectedArtistId) ||
      filteredArtists[0] ||
      null
    );
  }, [filteredArtists, derivedArtists, selectedArtistId]);

  const currentArtistSongs = useMemo(() => {
    if (!currentArtist) return [];
    const matched = favorites.filter(
      (s) =>
        s.artist === currentArtist.name ||
        s.artistId === currentArtist.id ||
        (s.artistIds && s.artistIds.includes(currentArtist.id))
    );
    return matched.length > 0
      ? matched
      : [
          {
            videoId: '5dNP-a-XXx0',
            title: 'Ode to the Mets',
            artist: currentArtist.name,
            liked: true,
            totalPlayTimeMs: 351000,
            playCount: 1,
            artistIds: [currentArtist.id],
            artists: [{ id: currentArtist.id, name: currentArtist.name }],
            isExplicit: false,
          },
        ];
  }, [favorites, currentArtist]);

  const currentArtistAlbums = useMemo(() => {
    if (!currentArtist) return [];
    return derivedAlbums.filter((a) => a.artist === currentArtist.name);
  }, [derivedAlbums, currentArtist]);

  // Recently Added items grouped chronologically
  const recentlyAddedGroups = useMemo(() => {
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const thisMonth: typeof derivedAlbums = [];
    const earlier: typeof derivedAlbums = [];

    derivedAlbums.forEach((alb) => {
      const addedTime = alb.dateAdded || now;
      if (now - addedTime < thirtyDaysMs) {
        thisMonth.push(alb);
      } else {
        earlier.push(alb);
      }
    });

    return [
      { name: 'Recent Additions (Last 30 Days)', items: thisMonth.length > 0 ? thisMonth : derivedAlbums },
      { name: 'Earlier This Year', items: earlier },
    ].filter((g) => g.items.length > 0);
  }, [derivedAlbums]);

  const handlePlaySong = (song: Song, contextList?: Song[]) => {
    if (contextList && contextList.length > 0) {
      const idx = contextList.findIndex((s) => s.videoId === song.videoId);
      setContextQueue(contextList, Math.max(0, idx));
    }
    loadTrack(song, 'active', true);
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12 select-none animate-in fade-in duration-200">
      {/* Header & Sub-Tabs Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white">
            Your Library
          </h1>
          <p className="text-xs text-[#A1A1A6] pt-1">
            {favorites.length} saved tracks • {derivedAlbums.length} albums • {derivedArtists.length} artists
          </p>
        </div>

        {/* Apple Music Segmented Sub-Tabs */}
        <div className="flex items-center gap-1.5 p-1 rounded-full bg-white/[0.06] hover:bg-white/[0.10] border border-white/10 overflow-x-auto scrollbar-none transition-colors">
          {subTabs.map((tab) => {
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => {
                  setActiveTab(tab);
                  if (tab !== 'Albums') setIsCoverFlowActive(false);
                  navigateToTab('library', tab);
                }}
                className={`spring-press px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  isActive
                    ? 'bg-white/15 text-white shadow-sm'
                    : 'text-[#A1A1A6] hover:text-white'
                }`}
              >
                {tab}
              </button>
            );
          })}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SUB-VIEW 1: RECENTLY ADDED                                                */}
      {/* ========================================================================= */}
      {activeTab === 'Recently Added' && (
        <div className="space-y-6">
          {recentlyAddedGroups.map((group, gIdx) => (
            <section key={gIdx} className="space-y-3.5">
              <h2 className="text-xs font-bold tracking-wider text-[#8E8E93] uppercase">
                {group.name} ({group.items.length})
              </h2>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {group.items.map((alb) => (
                  <div
                    key={alb.id}
                    onClick={() => navigateToRelease(alb.id, 'album')}
                    className="acrylic-tile group p-3 rounded-2xl transition-all cursor-pointer"
                  >
                    <div className="artwork-lockup relative aspect-square rounded-xl overflow-hidden mb-2.5 bg-neutral-900">
                      <img
                        src={alb.coverUrl}
                        alt={alb.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      {/* macOS Dual-Hover Overlay */}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-end justify-between p-2 transition-opacity">
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            navigateToRelease(alb.id, 'album');
                          }}
                          className="w-8 h-8 rounded-full bg-white text-black shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-transform cursor-pointer"
                          title="Play"
                        >
                          <PlayerPlayIcon size={14} className="ml-0.5 text-black" />
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onOpenContextMenu) {
                              onOpenContextMenu(e, {
                                videoId: alb.id,
                                title: alb.title,
                                artist: alb.artist,
                                liked: true,
                              } as any);
                            }
                          }}
                          className="w-7 h-7 rounded-full bg-black/60 hover:bg-black/80 text-white/90 border border-white/20 flex items-center justify-center transition-all cursor-pointer"
                          title="More Options"
                        >
                          <MoreHorizontal size={13} />
                        </button>
                      </div>
                    </div>
                    <div className="text-xs font-bold truncate text-white group-hover:text-[#FA2D48] transition-colors">
                      {alb.title}
                    </div>
                    <div className="text-[11px] text-[#A1A1A6] truncate">
                      {alb.artist}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-VIEW 2: ARTISTS (Two-Pane Master-Detail Browser)                      */}
      {/* ========================================================================= */}
      {activeTab === 'Artists' && (
        <div className="flex flex-col md:flex-row gap-6 min-h-[500px]">
          {/* Master Column (Left): Alphabetized Artist List */}
          <div className="w-full md:w-64 lg:w-72 border-r border-white/10 shrink-0 pr-4 flex flex-col space-y-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8E8E93]" />
              <input
                type="text"
                placeholder="Filter artists..."
                value={artistFilter}
                onChange={(e) => setArtistFilter(e.target.value)}
                className="w-full h-8 pl-8 pr-3 rounded-full bg-white/[0.06] hover:bg-white/[0.09] focus:bg-white/[0.12] border border-white/10 focus:border-white/25 text-xs text-white placeholder-[#8E8E93] outline-none transition-all"
              />
            </div>

            <div className="flex-1 overflow-y-auto space-y-1 max-h-[calc(100vh-280px)] scrollbar-none">
              {filteredArtists.map((artist) => {
                const isSelected = artist.id === currentArtist?.id;
                return (
                  <button
                    key={artist.id}
                    onClick={() => setSelectedArtistId(artist.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-white/12 border border-white/20 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]'
                        : 'text-[#A1A1A6] hover:text-white hover:bg-white/[0.06]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-full bg-neutral-800 overflow-hidden shrink-0 flex items-center justify-center">
                        <Users2 size={14} className="text-neutral-400" />
                      </div>
                      <span className={`text-xs truncate ${isSelected ? 'font-bold text-white' : 'font-medium'}`}>
                        {artist.name}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono opacity-60">
                      {artist.trackCount}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Detail Column (Right): Selected Artist Discography */}
          <div className="flex-1 min-w-0 overflow-y-auto space-y-6 pl-2">
            {currentArtist ? (
              <>
                {/* Artist Header Banner */}
                <div className="acrylic-tile p-5 rounded-3xl flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-neutral-800 to-neutral-700 flex items-center justify-center text-white shrink-0 shadow-lg">
                      <Users2 size={28} />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-2xl font-black text-white truncate">
                        {currentArtist.name}
                      </h2>
                      <p className="text-xs text-[#A1A1A6] pt-0.5">
                        {currentArtistSongs.length} saved songs • {currentArtistAlbums.length} albums in your library
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (currentArtistSongs.length > 0) {
                          handlePlaySong(currentArtistSongs[0], currentArtistSongs);
                        }
                      }}
                      className="spring-press flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#FA2D48] hover:bg-[#e0263f] text-white text-xs font-bold cursor-pointer shadow-md shadow-[#FA2D48]/20 transition-all"
                    >
                      <Play size={13} className="fill-current" />
                      <span>Play All</span>
                    </button>
                    <button
                      onClick={() => navigateToArtist(currentArtist.id)}
                      className="spring-press flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/[0.06] hover:bg-white/[0.10] border border-white/10 text-xs font-semibold text-white cursor-pointer transition-colors"
                    >
                      <span>Full Profile</span>
                      <ChevronRight size={13} />
                    </button>
                  </div>
                </div>

                {/* Top Songs by Artist rendered with DesktopTrackTable */}
                {currentArtistSongs.length > 0 && (
                  <section className="space-y-3">
                    <h3 className="text-sm font-bold tracking-tight text-white">Songs</h3>
                    <div className="acrylic-tile p-4 rounded-3xl overflow-hidden tracklist-row">
                      <DesktopTrackTable
                        songs={currentArtistSongs}
                        showCover={false}
                        showArtist={false}
                        showAlbum={true}
                        showTrackNumber={true}
                        density="standard"
                        onOpenContextMenu={onOpenContextMenu}
                      />
                    </div>
                  </section>
                )}

                {/* Albums by Artist in Library */}
                {currentArtistAlbums.length > 0 && (
                  <section className="space-y-3">
                    <h3 className="text-sm font-bold tracking-tight text-white">Albums</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                      {currentArtistAlbums.map((alb) => (
                        <div
                          key={alb.id}
                          onClick={() => navigateToRelease(alb.id, 'album')}
                          className="acrylic-tile group p-3 rounded-2xl cursor-pointer"
                        >
                          <div className="artwork-lockup relative aspect-square rounded-xl overflow-hidden mb-2 bg-neutral-900">
                            <img src={alb.coverUrl} alt={alb.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                          </div>
                          <div className="text-xs font-bold truncate text-white group-hover:text-[#FA2D48] transition-colors">
                            {alb.title}
                          </div>
                          <div className="text-[11px] text-[#A1A1A6]">{alb.year}</div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            ) : (
              <div className="acrylic-tile rounded-3xl py-16 text-center text-xs text-[#8E8E93]">
                Select an artist from the list
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-VIEW 3: ALBUMS (With Interactive 3D Cover Flow Toggle)                 */}
      {/* ========================================================================= */}
      {activeTab === 'Albums' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#8E8E93]">
              {derivedAlbums.length} Albums in Collection
            </span>

            {/* Toggle Grid vs 3D Cover Flow */}
            <div className="flex items-center gap-1 p-1 rounded-full bg-white/[0.06] border border-white/10">
              <button
                onClick={() => {
                  setIsCoverFlowActive(false);
                  navigateToTab('library', 'Albums');
                }}
                title="Grid View"
                className={`p-1.5 rounded-full text-xs transition-all cursor-pointer ${
                  !isCoverFlowActive
                    ? 'bg-white/15 text-white shadow-sm'
                    : 'text-[#A1A1A6] hover:text-white'
                }`}
              >
                <Grid size={15} />
              </button>
              <button
                onClick={() => {
                  setIsCoverFlowActive(true);
                  navigateToTab('library', 'CoverFlow');
                }}
                title="3D Cover Flow"
                className={`p-1.5 rounded-full text-xs transition-all cursor-pointer ${
                  isCoverFlowActive
                    ? 'bg-white/15 text-white shadow-sm'
                    : 'text-[#A1A1A6] hover:text-white'
                }`}
              >
                <Box size={15} />
              </button>
            </div>
          </div>

          {isCoverFlowActive ? (
            <div className="acrylic-tile p-6 rounded-3xl overflow-hidden shadow-2xl">
              <AlbumCoverFlow
                albums={derivedAlbums}
                onSelectAlbum={(alb) => navigateToRelease(alb.id, 'album')}
                onPlayAlbum={(alb) => navigateToRelease(alb.id, 'album')}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {derivedAlbums.map((alb) => (
                <div
                  key={alb.id}
                  onClick={() => navigateToRelease(alb.id, 'album')}
                  className="acrylic-tile group p-3 rounded-2xl transition-all cursor-pointer"
                >
                  <div className="artwork-lockup relative aspect-square rounded-xl overflow-hidden mb-2.5 bg-neutral-900">
                    <img
                      src={alb.coverUrl}
                      alt={alb.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    {/* macOS Dual-Hover Overlay */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-end justify-between p-2 transition-opacity">
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          navigateToRelease(alb.id, 'album');
                        }}
                        className="w-8 h-8 rounded-full bg-white text-black shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-transform cursor-pointer"
                        title="Play"
                      >
                        <PlayerPlayIcon size={14} className="ml-0.5 text-black" />
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onOpenContextMenu) {
                            onOpenContextMenu(e, {
                              videoId: alb.id,
                              title: alb.title,
                              artist: alb.artist,
                              liked: true,
                            } as any);
                          }
                        }}
                        className="w-7 h-7 rounded-full bg-black/60 hover:bg-black/80 text-white/90 border border-white/20 flex items-center justify-center transition-all cursor-pointer"
                        title="More Options"
                      >
                        <MoreHorizontal size={13} />
                      </button>
                    </div>
                  </div>
                  <div className="text-xs font-bold truncate text-white group-hover:text-[#FA2D48] transition-colors">
                    {alb.title}
                  </div>
                  <div className="text-[11px] text-[#A1A1A6] truncate">
                    {alb.artist}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-VIEW 4: SONGS (Master Library Songs Table with DesktopTrackTable)       */}
      {/* ========================================================================= */}
      {activeTab === 'Songs' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <span className="text-xs font-bold uppercase tracking-wider text-[#8E8E93]">
              {filteredSongs.length} Songs Saved
            </span>

            <div className="relative w-full sm:w-auto">
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8E8E93]" />
              <input
                type="text"
                placeholder="Filter saved songs..."
                value={songFilter}
                onChange={(e) => setSongFilter(e.target.value)}
                className="h-8 pl-9 pr-3 rounded-full bg-white/[0.06] hover:bg-white/[0.09] focus:bg-white/[0.12] border border-white/10 focus:border-white/25 text-xs text-white placeholder-[#8E8E93] outline-none transition-all w-full sm:w-64"
              />
            </div>
          </div>

          <div className="acrylic-tile p-4 rounded-3xl overflow-hidden tracklist-row">
            <DesktopTrackTable
              songs={filteredSongs}
              showCover={true}
              showArtist={true}
              showAlbum={true}
              showTrackNumber={true}
              density="standard"
              allowSorting={true}
              onOpenContextMenu={onOpenContextMenu}
              emptyMessage={
                favorites.length === 0
                  ? 'No favorite tracks saved yet. Heart songs to add them to your library.'
                  : 'No saved songs match your filter.'
              }
            />
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-VIEW 4B: FAVORITES (Dedicated Favorited Songs View)                   */}
      {/* ========================================================================= */}
      {activeTab === 'Favorites' && (
        <div className="space-y-4">
          <div className="acrylic-tile p-5 rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-rose-600 to-red-500 flex items-center justify-center text-white shadow-lg shrink-0">
                <Heart size={24} className="fill-current" />
              </div>
              <div className="min-w-0">
                <h2 className="text-xl font-black text-white truncate">Favorite Songs</h2>
                <p className="text-xs text-[#A1A1A6] pt-0.5">
                  {filteredSongs.length} {filteredSongs.length === 1 ? 'track' : 'tracks'} in your Favorites
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="relative">
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8E8E93]" />
                <input
                  type="text"
                  placeholder="Filter favorites..."
                  value={songFilter}
                  onChange={(e) => setSongFilter(e.target.value)}
                  className="h-8 pl-9 pr-3 rounded-full bg-white/[0.06] hover:bg-white/[0.09] focus:bg-white/[0.12] border border-white/10 focus:border-white/25 text-xs text-white placeholder-[#8E8E93] outline-none transition-all w-48 sm:w-56"
                />
              </div>
              {filteredSongs.length > 0 && (
                <button
                  onClick={() => handlePlaySong(filteredSongs[0], filteredSongs)}
                  className="spring-press flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#FA2D48] hover:bg-[#e0263f] text-white text-xs font-bold cursor-pointer shadow-md shadow-[#FA2D48]/20 transition-all"
                >
                  <Play size={13} className="fill-current" />
                  <span>Play All</span>
                </button>
              )}
            </div>
          </div>

          <div className="acrylic-tile p-4 rounded-3xl overflow-hidden tracklist-row">
            <DesktopTrackTable
              songs={filteredSongs}
              showCover={true}
              showArtist={true}
              showAlbum={true}
              showTrackNumber={true}
              density="standard"
              allowSorting={true}
              onOpenContextMenu={onOpenContextMenu}
              emptyMessage={
                favorites.length === 0
                  ? 'No favorite tracks yet. Heart any song to add it to your Favorites.'
                  : 'No favorited songs match your filter.'
              }
            />
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-VIEW 5: LOCAL MEDIA                                                   */}
      {/* ========================================================================= */}
      {activeTab === 'Local Media' && (
        <LocalMediaView onOpenContextMenu={onOpenContextMenu} />
      )}

      {/* ========================================================================= */}
      {/* SUB-VIEW 6: RADIO & PARTY                                                 */}
      {/* ========================================================================= */}
      {activeTab === 'Radio' && (
        <RadioPartyView />
      )}

      {/* ========================================================================= */}
      {/* SUB-VIEW 7: PLAYLISTS (Preserved for Backward Test Compatibility)         */}
      {/* ========================================================================= */}
      {activeTab === 'Playlists' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#8E8E93]">
              Playlists ({playlists.length})
            </span>
            <button
              onClick={() => setCreatePlaylistOpen(true)}
              className="spring-press flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.10] border border-white/10 text-xs font-semibold text-[#FA2D48] cursor-pointer transition-colors"
            >
              <Plus size={14} />
              <span>New Playlist</span>
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {/* Favorites Quick Card */}
            <div
              onClick={() => {
                setActiveTab('Favorites');
                navigateToTab('library', 'Favorites');
              }}
              className="acrylic-tile group p-4 rounded-2xl transition-all cursor-pointer flex flex-col justify-between h-44"
            >
              <div className="artwork-lockup w-12 h-12 rounded-xl bg-gradient-to-tr from-rose-600 to-red-500 flex items-center justify-center text-white shadow-lg">
                <Heart size={22} className="fill-current" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white group-hover:text-[#FA2D48] transition-colors">
                  Favorites
                </h3>
                <p className="text-xs text-[#A1A1A6] pt-0.5">
                  {favorites.length} tracks
                </p>
              </div>
            </div>

            {/* Custom User Playlists */}
            {playlists.map((pl) => (
              <div
                key={pl.id}
                onClick={() => navigateToRelease(pl.id, 'playlist')}
                className="acrylic-tile group relative p-4 rounded-2xl transition-all cursor-pointer flex flex-col justify-between h-44"
              >
                <div className="artwork-lockup w-12 h-12 rounded-xl bg-gradient-to-tr from-neutral-800 to-neutral-700 flex items-center justify-center text-neutral-300">
                  <ListMusic size={22} />
                </div>
                <div>
                  <h3 className="text-sm font-bold truncate text-white group-hover:text-[#FA2D48] transition-colors">
                    {pl.title}
                  </h3>
                  <p className="text-xs text-[#A1A1A6] pt-0.5">
                    {((pl as any).tracksCount ?? (pl as any).songCount ?? pl.songIds?.length ?? 0)} tracks
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deletePlaylist(pl.id);
                  }}
                  title="Delete Playlist"
                  className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 p-1 rounded-md text-[#8E8E93] hover:text-red-400 transition-opacity"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>

          {/* Spotify Playlists Shelf (Only when Spotify account is connected) */}
          {spotifyConnected && (
            <div className="pt-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#8E8E93]">
                    Spotify Playlists ({spotifyPlaylists.length})
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#1DB954]/20 text-[#1DB954] border border-[#1DB954]/30">
                    Spotify Connected
                  </span>
                </div>
                {selectedSpotifyPlaylist && (
                  <button
                    onClick={() => {
                      setSelectedSpotifyPlaylist(null);
                      setSpotifyPlaylistTracks([]);
                    }}
                    className="spring-press flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-medium text-white cursor-pointer transition-colors"
                  >
                    ← Back to Playlists
                  </button>
                )}
              </div>

              {selectedSpotifyPlaylist ? (
                /* Interactive Spotify Playlist Detail Panel */
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div className="acrylic-tile p-5 rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                      {selectedSpotifyPlaylist.thumbnailUrl ? (
                        <img
                          src={selectedSpotifyPlaylist.thumbnailUrl}
                          alt={selectedSpotifyPlaylist.title}
                          className="w-16 h-16 rounded-2xl object-cover shadow-lg shrink-0"
                        />
                      ) : (
                        <div className="w-16 h-16 rounded-2xl bg-[#1DB954]/20 border border-[#1DB954]/30 flex items-center justify-center text-[#1DB954] shadow-lg shrink-0">
                          <ListMusic size={28} />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h2 className="text-xl font-black text-white truncate">
                            {selectedSpotifyPlaylist.title}
                          </h2>
                          <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#1DB954]/20 text-[#1DB954] border border-[#1DB954]/30">
                            Spotify
                          </span>
                        </div>
                        <p className="text-xs text-[#A1A1A6] pt-0.5">
                          {selectedSpotifyPlaylist.owner ? `By ${selectedSpotifyPlaylist.owner} • ` : ''}
                          {selectedSpotifyPlaylist.trackCount} tracks
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5">
                      {spotifyPlaylistTracks.length > 0 && (
                        <button
                          onClick={() => {
                            setContextQueue(spotifyPlaylistTracks, 0);
                            loadTrack(spotifyPlaylistTracks[0], 'active', true);
                          }}
                          className="spring-press flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#1DB954] hover:bg-[#1aa34a] text-black text-xs font-bold cursor-pointer shadow-md shadow-[#1DB954]/20 transition-all"
                        >
                          <Play size={13} className="fill-current" />
                          <span>Play All</span>
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setSelectedSpotifyPlaylist(null);
                          setSpotifyPlaylistTracks([]);
                        }}
                        className="spring-press flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/[0.06] hover:bg-white/[0.10] border border-white/10 text-xs font-semibold text-white cursor-pointer transition-colors"
                      >
                        <span>Close</span>
                      </button>
                    </div>
                  </div>

                  <div className="acrylic-tile p-4 rounded-3xl overflow-hidden tracklist-row">
                    {loadingSpotifyTracks ? (
                      <div className="py-12 text-center text-xs text-[#8E8E93]">
                        Loading Spotify tracks...
                      </div>
                    ) : (
                      <DesktopTrackTable
                        songs={spotifyPlaylistTracks}
                        showCover={true}
                        showArtist={true}
                        showAlbum={true}
                        showTrackNumber={true}
                        density="standard"
                        allowSorting={true}
                        onOpenContextMenu={onOpenContextMenu}
                        emptyMessage="No tracks found in this Spotify playlist."
                      />
                    )}
                  </div>
                </div>
              ) : (
                /* Grid of Spotify Playlists */
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {spotifyPlaylists.map((pl) => (
                    <div
                      key={pl.id}
                      onClick={async () => {
                        setSelectedSpotifyPlaylist(pl);
                        setLoadingSpotifyTracks(true);
                        try {
                          const tracks = await SpotifyPlaylistService.loadSpotifyPlaylistSongs(pl.id);
                          setSpotifyPlaylistTracks(tracks);
                        } catch {
                          setSpotifyPlaylistTracks([]);
                        } finally {
                          setLoadingSpotifyTracks(false);
                        }
                      }}
                      className="acrylic-tile group relative p-4 rounded-2xl transition-all cursor-pointer flex flex-col justify-between h-44 hover:border-[#1DB954]/40"
                    >
                      {pl.thumbnailUrl ? (
                        <div className="artwork-lockup relative w-12 h-12 rounded-xl overflow-hidden shadow-lg bg-neutral-900">
                          <img
                            src={pl.thumbnailUrl}
                            alt={pl.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        </div>
                      ) : (
                        <div className="artwork-lockup w-12 h-12 rounded-xl bg-[#1DB954]/20 border border-[#1DB954]/30 flex items-center justify-center text-[#1DB954]">
                          <ListMusic size={22} />
                        </div>
                      )}
                      <div>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="px-1.5 py-0.2 rounded text-[8px] font-bold bg-[#1DB954]/20 text-[#1DB954] border border-[#1DB954]/30">
                            Spotify
                          </span>
                        </div>
                        <h3 className="text-sm font-bold truncate text-white group-hover:text-[#1DB954] transition-colors">
                          {pl.title}
                        </h3>
                        <p className="text-xs text-[#A1A1A6] pt-0.5">
                          {pl.trackCount} tracks
                        </p>
                      </div>
                    </div>
                  ))}
                  {spotifyPlaylists.length === 0 && (
                    <div className="col-span-full py-8 text-center text-xs text-[#8E8E93]">
                      No Spotify playlists found on your account.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-VIEW 8: HISTORY (Preserved for Backward Test Compatibility + Replay)  */}
      {/* ========================================================================= */}
      {activeTab === 'History' && (
        <div className="space-y-6">
          {monthlyStats && (
            <div className="acrylic-tile p-6 rounded-3xl bg-gradient-to-r from-red-950/40 via-purple-950/30 to-transparent flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#FA2D48]">
                  <Sparkles size={14} /> Monthly Overview ({monthlyStats.yearMonth})
                </span>
                <h3 className="text-2xl font-black text-white">
                  {Math.round(monthlyStats.totalListeningTimeSec / 60)} Minutes Streamed
                </h3>
                <p className="text-xs text-[#A1A1A6]">
                  {monthlyStats.totalPlaysCount} completed plays across {monthlyStats.uniqueTracksCount} unique tracks
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setReplayOpen(true)}
                  className="spring-press flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#FA2D48] hover:bg-[#e0263f] text-white font-bold text-xs cursor-pointer shadow-lg shadow-[#FA2D48]/25 transition-all"
                >
                  <Sparkles size={14} />
                  <span>Launch Replay '26</span>
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <h3 className="text-xs font-bold tracking-wider uppercase text-[#8E8E93]">
              Playback Timeline
            </h3>

            <div className="acrylic-tile rounded-2xl divide-y divide-white/5 overflow-hidden">
              {listeningHistory.map((item, idx) => (
                <div
                  key={idx}
                  onClick={() =>
                    handlePlaySong({
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
                  className="tracklist-row flex items-center justify-between px-4 py-2.5 text-xs hover:bg-white/5 transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Clock size={14} className="text-[#8E8E93]" />
                    <div>
                      <span className="font-semibold text-white group-hover:text-[#FA2D48] transition-colors">
                        {item.title}
                      </span>
                      <span className="text-[#A1A1A6] ml-2">
                        {item.artist}
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-[#8E8E93]">
                    {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

LibraryScreen.displayName = 'LibraryScreen';
