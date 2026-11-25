// src/ui/views/CoverFlowView.tsx
// 3D Cover Flow Experience (macOS Apple Music Desktop Experience with Liquid Glass):
// Interactive 3D perspective album cover carousel with floor reflection (Feature 23 / AlbumCoverFlow.tsx)
// and dynamically linked lower album metadata & DesktopTrackTable covering unified local + online albums.

import React, { useState, useMemo, useEffect, memo } from 'react';
import { Shuffle, Sparkles, HardDrive, Music } from 'lucide-react';
import { MlAudioService } from '../../services/MlAudioService';
import {
  useLibraryStore,
  selectUnifiedSongs,
  selectUnifiedAlbums,
  DEFAULT_LOCAL_ALBUM_ART_SVG,
} from '../../state/libraryStore';
import { usePlayerStore } from '../../state/playerStore';
import { useQueueStore } from '../../state/queueStore';
import { AlbumCoverFlow, CoverFlowAlbum } from '../player/AlbumCoverFlow';
import { DesktopTrackTable } from '../components/DesktopTrackTable';
import { PlayerPlayIcon } from '../common/WaveFormIcons';
import type { Song } from '../../models/Song';

export interface CoverFlowViewProps {
  onOpenContextMenu?: (e: React.MouseEvent, song: Song) => void;
}

const DEMO_COVER_FLOW_ALBUMS: CoverFlowAlbum[] = [
  {
    id: 'demo_1',
    title: 'The New Abnormal',
    artist: 'The Strokes',
    year: '2020',
    coverUrl: 'https://i.ytimg.com/vi/5dNP-a-XXx0/hqdefault.jpg',
    source: 'online',
    isLocal: false,
  },
  {
    id: 'demo_2',
    title: 'Redline',
    artist: 'Lazerhawk',
    year: '2010',
    coverUrl: 'https://i.ytimg.com/vi/DCas2ZWGwl4/hqdefault.jpg',
    source: 'online',
    isLocal: false,
  },
  {
    id: 'demo_3',
    title: 'Sweet Taste of India',
    artist: 'Anoop Sankar',
    year: '2024',
    coverUrl: 'https://i.ytimg.com/vi/dX3k_QDnzHE/hqdefault.jpg',
    source: 'online',
    isLocal: false,
  },
];

export const CoverFlowView: React.FC<CoverFlowViewProps> = memo(({ onOpenContextMenu }) => {
  const favorites = useLibraryStore((s) => s.favorites);
  const localSongs = useLibraryStore((s) => s.localSongs);
  const loadTrack = usePlayerStore((s) => s.loadTrack);
  const { setContextQueue } = useQueueStore();

  const unifiedSongs = useMemo(
    () => selectUnifiedSongs(favorites, localSongs),
    [favorites, localSongs]
  );

  // Derived unified albums (local + favorites) grouped by normalized album + albumArtist
  const derivedAlbums: CoverFlowAlbum[] = useMemo(() => {
    const unified = selectUnifiedAlbums(unifiedSongs);
    if (unified.length === 0) {
      return DEMO_COVER_FLOW_ALBUMS;
    }
    return unified.map((alb) => ({
      id: alb.id,
      title: alb.title,
      artist: alb.artist,
      albumArtist: alb.albumArtist,
      year: alb.year,
      coverUrl: alb.coverUrl || DEFAULT_LOCAL_ALBUM_ART_SVG,
      source: alb.source,
      isLocal: alb.isLocal,
      songs: alb.songs,
    }));
  }, [unifiedSongs]);

  const [selectedAlbum, setSelectedAlbum] = useState<CoverFlowAlbum | null>(
    derivedAlbums[0] || null
  );

  // Keep selectedAlbum synced whenever derivedAlbums updates (e.g., local library hydrates or rescans)
  useEffect(() => {
    if (derivedAlbums.length === 0) {
      setSelectedAlbum(null);
      return;
    }
    setSelectedAlbum((prev) => {
      if (!prev) return derivedAlbums[0];
      const match = derivedAlbums.find((a) => a.id === prev.id);
      return match || derivedAlbums[0];
    });
  }, [derivedAlbums]);

  const selectedAlbumSongs: Song[] = useMemo(() => {
    if (!selectedAlbum) return unifiedSongs.slice(0, 5);
    if (Array.isArray(selectedAlbum.songs) && selectedAlbum.songs.length > 0) {
      return selectedAlbum.songs;
    }
    const normTitle = selectedAlbum.title.trim().toLowerCase();
    const normArtist = (selectedAlbum.albumArtist || selectedAlbum.artist).trim().toLowerCase();
    const matched = unifiedSongs.filter((s) => {
      const sAlb = (s.albumName || s.album || 'Single Collection').trim().toLowerCase();
      const sArt = (s.albumArtist || s.artist || 'Unknown Artist').trim().toLowerCase();
      return sAlb === normTitle && sArt === normArtist;
    });
    return matched.length > 0 ? matched : unifiedSongs.slice(0, 5);
  }, [unifiedSongs, selectedAlbum]);

  const handlePlayAlbum = (album: CoverFlowAlbum) => {
    const tracks =
      Array.isArray(album.songs) && album.songs.length > 0 ? album.songs : selectedAlbumSongs;
    if (tracks.length > 0) {
      setContextQueue(tracks, 0, {
        id: album.id,
        browseId: album.id,
        title: album.title,
        type: 'album',
        currentIndex: 0,
      });
      loadTrack(tracks[0], 'active', true);
    }
  };

  const handleShuffle = () => {
    if (selectedAlbumSongs.length === 0) return;
    const shuffled = [...selectedAlbumSongs].sort(() => Math.random() - 0.5);
    setContextQueue(shuffled, 0);
    loadTrack(shuffled[0], 'active', true);
  };

  const handlePreviewChorus = async () => {
    const tracks =
      selectedAlbum && Array.isArray(selectedAlbum.songs) && selectedAlbum.songs.length > 0
        ? selectedAlbum.songs
        : selectedAlbumSongs;
    if (tracks.length === 0) return;
    const featured = tracks[0];
    setContextQueue(tracks, 0);
    loadTrack(featured, 'active', true);
    const cached = await MlAudioService.getCachedTrackBeats(featured.videoId).catch(() => null);
    const dur = featured.durationSec || 180;
    const targetSec =
      cached && cached.chorusStartSec > 4
        ? cached.chorusStartSec
        : Math.round(Math.min(Math.max(dur * 0.34, 24), Math.max(24, dur - 25)));
    setTimeout(() => {
      usePlayerStore.getState().seek(targetSec * 1000);
    }, 350);
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-16 select-none animate-in fade-in duration-200">
      {/* 1. Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full liquid-glass-pill text-[11px] font-bold text-[#FA2D48] mb-2">
            <Sparkles size={12} />
            3D Perspective Display
          </div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight text-white">
            Albums (3D Cover Flow)
          </h1>
          <p className="text-xs text-[#A1A1A6] pt-1">
            Browse your unified local and online album artwork in an authentic 3D perspective carousel with mirror reflections.
          </p>
        </div>
      </div>

      {/* 2. Top Zone: 3D Cover Flow Carousel */}
      <section className="acrylic-tile p-6 rounded-3xl overflow-hidden shadow-2xl">
        <AlbumCoverFlow
          albums={derivedAlbums}
          onActiveAlbumChange={(alb) => setSelectedAlbum(alb)}
          onSelectAlbum={(alb) => setSelectedAlbum(alb)}
          onPlayAlbum={handlePlayAlbum}
        />
      </section>

      {/* 3. Bottom Zone: Selected Album Details & DesktopTrackTable */}
      {selectedAlbum && (
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 acrylic-tile p-5 rounded-2xl">
            <div className="flex items-center gap-4 min-w-0">
              <div className="artwork-lockup relative w-16 h-16 rounded-xl overflow-hidden bg-neutral-900 shadow-md shrink-0">
                <img
                  src={selectedAlbum.coverUrl || DEFAULT_LOCAL_ALBUM_ART_SVG}
                  alt={selectedAlbum.title}
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = DEFAULT_LOCAL_ALBUM_ART_SVG;
                  }}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#FA2D48]">
                    Selected Album
                  </span>
                  {(selectedAlbum.isLocal || selectedAlbum.source === 'local') && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/10 text-[9px] font-bold uppercase tracking-wider text-white/80">
                      <HardDrive size={9} />
                      Local
                    </span>
                  )}
                </div>
                <h2 className="text-xl font-black text-white truncate">
                  {selectedAlbum.title}
                </h2>
                <p className="text-xs text-[#A1A1A6] truncate">
                  {selectedAlbum.artist} {selectedAlbum.year ? `• ${selectedAlbum.year}` : ''}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => handlePlayAlbum(selectedAlbum)}
                className="spring-press flex items-center gap-2 px-5 py-2 rounded-full bg-[#FA2D48] hover:bg-[#e0263f] text-white font-bold text-xs cursor-pointer shadow-lg shadow-[#FA2D48]/25 transition-all"
              >
                <PlayerPlayIcon size={14} />
                <span>Play Album</span>
              </button>
              <button
                onClick={handleShuffle}
                className="spring-press flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-white font-semibold text-xs cursor-pointer transition-all"
              >
                <Shuffle size={13} />
                <span>Shuffle</span>
              </button>
              <button
                onClick={() => void handlePreviewChorus()}
                data-testid="coverflow-preview-chorus-btn"
                className="spring-press flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-white font-semibold text-xs cursor-pointer transition-all"
              >
                <Music size={13} />
                <span>Preview Chorus</span>
              </button>
            </div>
          </div>

          {/* DesktopTrackTable for selected album */}
          <div className="acrylic-tile p-4 rounded-3xl overflow-hidden tracklist-row">
            <DesktopTrackTable
              songs={selectedAlbumSongs}
              showCover={false}
              showArtist={false}
              showAlbum={false}
              showTrackNumber={true}
              density="standard"
              onOpenContextMenu={onOpenContextMenu}
              emptyMessage="No tracks found for this album in your library"
            />
          </div>
        </section>
      )}
    </div>
  );
});

CoverFlowView.displayName = 'CoverFlowView';
