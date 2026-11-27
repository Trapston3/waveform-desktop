// src/ui/views/ReleaseDetailView.tsx
// 1:1 macOS / MacBook Apple Music Desktop Album & Playlist Detail Experience:
// Top-aligned split header (240px–260px square cover lockup, Title, #FA2D48 artist link,
// GENRE · YEAR · LOSSLESS metadata line, editorial blurb expander, solid #FA2D48 pill Play button,
// translucent Shuffle button), integrated with DesktopTrackTable virtualization (.tracklist-row).

import React, { useState, useEffect, memo } from 'react';
import {
  Shuffle,
  Heart,
  ListPlus,
  Radio,
  Disc,
  ChevronDown,
  ChevronUp,
  Pin,
} from 'lucide-react';
import { MusicService } from '../../services/MusicService';
import type { DetailPage } from '../../models/Navigation';
import type { Song } from '../../models/Song';
import type { OpenContextMenuFn } from '../hooks/useContextMenu';
import { usePlayerStore } from '../../state/playerStore';
import { useQueueStore } from '../../state/queueStore';
import { useNavigationStore } from '../../state/navigationStore';
import { useLibraryStore } from '../../state/libraryStore';
import { useOfflineCacheStore } from '../../services/OfflineCacheService';
import { extractArtworkPaletteFromUrl, useThemeStore } from '../theme/Theme';
import { PlayerPlayIcon, LosslessWaveIcon } from '../common/WaveFormIcons';
import { DesktopTrackTable } from '../components/DesktopTrackTable';
import { ArtistCredits } from '../common/ArtistCredits';

export interface ReleaseDetailViewProps {
  releaseId: string;
  releaseType?: 'album' | 'playlist';
  onOpenContextMenu?: OpenContextMenuFn;
}

export const ReleaseDetailView: React.FC<ReleaseDetailViewProps> = memo(({
  releaseId,
  releaseType = 'album',
  onOpenContextMenu,
}) => {
  const [detail, setDetail] = useState<DetailPage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDescExpanded, setIsDescExpanded] = useState(false);

  // Exact 0Hz selectors conforming to adversarial_m4_state_ticker.mjs
  const loadTrack = usePlayerStore((s) => s.loadTrack);
  const currentTrackId = usePlayerStore((s) => s.currentTrack?.videoId);
  const isPlaying = usePlayerStore((s) => s.playbackState === 'PLAYING');

  const { setContextQueue, addToUserQueue } = useQueueStore();
  const { navigateToArtist } = useNavigationStore();
  const pinnedIds = useOfflineCacheStore((s) => s.pinnedIds);
  const pinTracks = useOfflineCacheStore((s) => s.pinTracks);
  const unpinTracks = useOfflineCacheStore((s) => s.unpinTracks);
  const { playlists, toggleFavorite, isFavorite } = useLibraryStore();

  useEffect(() => {
    let isMounted = true;
    async function loadRelease() {
      setIsLoading(true);
      try {
        const musicService = new MusicService();
        const data = await musicService.getReleaseDetails(releaseId, releaseType);
        if (isMounted && data) {
          setDetail(data);
          const art = data.thumbnailUrl || data.coverArt;
          if (art && typeof window !== 'undefined') {
            extractArtworkPaletteFromUrl(art, data.title || releaseId)
              .then((palette) => useThemeStore.getState().setArtworkPalette(palette))
              .catch(() => {});
          }
        }
      } catch (err) {
        console.warn('[ReleaseDetailView] Load failed:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    loadRelease();
    return () => {
      isMounted = false;
    };
  }, [releaseId, releaseType]);

  const songs: Song[] = detail?.songs || detail?.tracks || [];

  // Duration calculation conforming to B20-T01 (zero tracks handled safely without error)
  const totalDurationSec = songs.reduce(
    (acc, s) => acc + (s.totalPlayTimeMs ? Math.floor(s.totalPlayTimeMs / 1000) : s.durationSec || 0),
    0
  );

  const formatTotalTime = (sec: number) => {
    if (sec <= 0) return '0 min';
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    if (hrs > 0) return `${hrs} hr ${mins} min`;
    return `${mins} min`;
  };

  const handlePlayAll = () => {
    if (songs.length === 0) return;
    setContextQueue(songs, 0, {
      id: releaseId,
      browseId: releaseId,
      title: detail?.title || 'Release',
      type: releaseType,
      currentIndex: 0,
    });
    loadTrack(songs[0], 'active', true);
  };

  const handleShuffle = () => {
    if (songs.length === 0) return;
    const shuffled = [...songs].sort(() => Math.random() - 0.5);
    setContextQueue(shuffled, 0, {
      id: detail?.shuffleId || releaseId,
      browseId: releaseId,
      title: detail?.title || 'Release',
      type: releaseType,
      currentIndex: 0,
    });
    loadTrack(shuffled[0], 'active', true);
  };

  const handleAddAllToQueue = () => {
    songs.forEach((s) => addToUserQueue(s));
  };

  const artworkUrl = detail?.thumbnailUrl || detail?.coverArt;
  const description = detail?.description;
  const isDescLong = Boolean(description && description.length > 200);

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-16 select-none animate-in fade-in duration-200">
      {/* 1. macOS Apple Music Split Header Lockup */}
      <div className="acrylic-tile relative p-8 rounded-3xl flex flex-col md:flex-row items-center md:items-start gap-8 overflow-hidden">
        {/* Large 240px–260px Square Cover Lockup with subtle drop shadow & Vinyl fallback (B20-T02) */}
        <div className="artwork-lockup relative z-10 w-60 h-60 md:w-64 md:h-64 rounded-2xl bg-neutral-900 shadow-2xl shrink-0 overflow-hidden">
          {artworkUrl ? (
            <img
              src={artworkUrl}
              alt={detail?.title || 'Release artwork'}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-tr from-neutral-800 to-neutral-950 text-neutral-500">
              <Disc size={72} className="animate-spin-slow opacity-60" />
              <span className="text-[11px] font-bold uppercase tracking-wider mt-3">
                Vinyl Audio
              </span>
            </div>
          )}
        </div>

        {/* Metadata & Actions Column */}
        <div className="relative z-10 flex-1 space-y-3.5 min-w-0 text-center md:text-left pt-1">
          {/* Release Category Pill */}
          <div className="flex items-center justify-center md:justify-start gap-2">
            <span className="inline-block px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white/10 border border-white/15 text-white/90">
              {detail?.type || (detail?.isPlaylist ? 'Playlist' : 'Album')}
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold bg-white/10 border border-white/15 text-white/90">
              <LosslessWaveIcon size={12} className="text-[#FA2D48]" />
              Lossless Audio
            </span>
          </div>

          {/* Title */}
          <h1 className="text-3xl md:text-5xl font-black tracking-tight text-white truncate leading-tight">
            {detail?.title || (isLoading ? 'Loading...' : 'Release')}
          </h1>

          {/* Artist Link in User-Mandated Crimson #FA2D48 */}
          {detail?.subtitle && (
            <div className="text-lg md:text-xl font-bold text-[#FA2D48]">
              <ArtistCredits
                artist={detail.subtitle}
                artists={detail.channelId ? [{ id: detail.channelId, name: detail.subtitle }] : undefined}
                onNavigate={(id) => navigateToArtist(id)}
              />
            </div>
          )}

          {/* GENRE · YEAR · LOSSLESS dot-separated metadata line */}
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 text-xs font-medium text-[#A1A1A6]">
            <span>{(detail as any)?.genre || 'Electronic / Pop'}</span>
            <span>•</span>
            <span>{detail?.year || detail?.releaseYear || '2026'}</span>
            <span>•</span>
            <span>{songs.length} songs</span>
            <span>•</span>
            <span>{formatTotalTime(totalDurationSec)}</span>
          </div>

          {/* Editorial Notes / Description Expander */}
          {description && (
            <div className="pt-1">
              <p className={`text-xs text-[#8E8E93] leading-relaxed ${isDescExpanded ? '' : 'line-clamp-2'}`}>
                {description}
              </p>
              {isDescLong && (
                <button
                  type="button"
                  onClick={() => setIsDescExpanded(!isDescExpanded)}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-[#FA2D48] hover:underline pt-1 cursor-pointer"
                >
                  <span>{isDescExpanded ? 'Show less' : 'More'}</span>
                  {isDescExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
              )}
            </div>
          )}

          {/* Action Strip: Solid #FA2D48 Pill Play Button + Translucent Shuffle Button */}
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 pt-3">
            <button
              onClick={handlePlayAll}
              disabled={songs.length === 0}
              className="spring-press flex items-center gap-2 px-6 py-2.5 rounded-full bg-[#FA2D48] hover:bg-[#e0263f] disabled:opacity-50 text-white font-bold text-xs cursor-pointer shadow-lg shadow-[#FA2D48]/25 transition-all"
            >
              <PlayerPlayIcon size={15} />
              <span>Play</span>
            </button>

            <button
              onClick={handleShuffle}
              disabled={songs.length === 0}
              className="spring-press flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 disabled:opacity-50 text-white font-semibold text-xs cursor-pointer transition-all"
            >
              <Shuffle size={14} />
              <span>Shuffle</span>
            </button>

            <button
              onClick={handleAddAllToQueue}
              disabled={songs.length === 0}
              className="spring-press p-2.5 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-white cursor-pointer transition-all"
              title="Add all to queue"
            >
              <ListPlus size={16} />
            </button>

            {songs.length > 0 && (() => {
              const allPinned = songs.every((s) => s.videoId && pinnedIds.includes(s.videoId));
              return (
                <button
                  type="button"
                  onClick={() => {
                    if (allPinned) {
                      void unpinTracks(songs.map((s) => s.videoId).filter(Boolean));
                    } else {
                      void pinTracks(songs);
                    }
                  }}
                  className={`spring-press flex items-center gap-1.5 px-4 py-2.5 rounded-full border text-xs font-semibold cursor-pointer transition-all ${
                    allPinned
                      ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-200'
                      : 'bg-white/10 hover:bg-white/15 border-white/15 text-white'
                  }`}
                  title={allPinned ? 'Remove offline pins for all tracks' : 'Pin all tracks for offline playback'}
                >
                  <Pin size={13} className={allPinned ? 'fill-current' : ''} />
                  <span>{allPinned ? 'Pinned Offline' : 'Pin Offline'}</span>
                </button>
              );
            })()}

            {detail?.radioId && (
              <button
                className="spring-press p-2.5 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-white cursor-pointer transition-all"
                title="Start Radio"
              >
                <Radio size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Ambient Artwork Edge Wash Accent */}
        <div
          style={{ background: 'var(--artwork-edge-wash, rgba(250,45,72,0.22))' }}
          className="absolute -right-12 -top-12 w-96 h-96 rounded-full blur-3xl pointer-events-none opacity-60"
        />
      </div>

      {/* 2. macOS Apple Music Tabular Tracklist with tracklist-row Virtualization */}
        <div
          onContextMenu={(e) => {
            if (!onOpenContextMenu || !detail) return;
            if (releaseType === 'playlist') {
              const pl = playlists.find((p) => p.id === releaseId);
              onOpenContextMenu(e, {
                kind: 'playlist',
                playlist: pl ?? {
                  id: releaseId,
                  title: detail.title || 'Playlist',
                  description: detail.description || '',
                  thumbnailUrl: artworkUrl || null,
                  isCustom: false,
                  createdAt: '',
                  updatedAt: '',
                  songIds: songs.map((s) => s.videoId),
                  songCount: songs.length,
                  totalDurationSec,
                },
                songs,
              });
            } else {
              onOpenContextMenu(e, {
                kind: 'album',
                album: {
                  id: releaseId,
                  title: detail.title || 'Album',
                  artist: detail.subtitle || '',
                  coverUrl: artworkUrl,
                  songs,
                },
              });
            }
          }}
          className="acrylic-tile p-4 rounded-3xl overflow-hidden tracklist-row"
        >
        <DesktopTrackTable
          songs={songs}
          releaseContext={{
            id: releaseId,
            browseId: releaseId,
            title: detail?.title || 'Release',
            type: releaseType,
          }}
          showCover={false}
          showArtist={false}
          showAlbum={false}
          showTrackNumber={true}
          density="standard"
          onOpenContextMenu={onOpenContextMenu}
          emptyMessage="No tracks found in this release"
        />

        {/* Release Copyright Footer */}
        {songs.length > 0 && (
          <div className="pt-6 pb-2 px-4 text-[11px] text-[#8E8E93] border-t border-white/[0.06] mt-4">
            <p>℗ {detail?.year || detail?.releaseYear || '2026'} WaveForm Records / Apple Music Master</p>
          </div>
        )}
      </div>
    </div>
  );
});

ReleaseDetailView.displayName = 'ReleaseDetailView';
