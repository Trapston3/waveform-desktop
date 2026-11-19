// src/ui/views/CoverFlowView.tsx
// 3D Cover Flow Experience (macOS Apple Music Desktop Experience with Liquid Glass):
// Interactive 3D perspective album cover carousel with floor reflection (Feature 23 / AlbumCoverFlow.tsx)
// and dynamically linked lower album metadata & DesktopTrackTable.

import React, { useState, useMemo, memo } from 'react';
import { Play, Shuffle, Disc3, Sparkles } from 'lucide-react';
import { useLibraryStore } from '../../state/libraryStore';
import { usePlayerStore } from '../../state/playerStore';
import { useQueueStore } from '../../state/queueStore';
import { AlbumCoverFlow, CoverFlowAlbum } from '../player/AlbumCoverFlow';
import { DesktopTrackTable } from '../components/DesktopTrackTable';
import { PlayerPlayIcon } from '../common/WaveFormIcons';
import type { Song } from '../../models/Song';

export interface CoverFlowViewProps {
  onOpenContextMenu?: (e: React.MouseEvent, song: Song) => void;
}

export const CoverFlowView: React.FC<CoverFlowViewProps> = memo(({ onOpenContextMenu }) => {
  const favorites = useLibraryStore((s) => s.favorites);
  const loadTrack = usePlayerStore((s) => s.loadTrack);
  const { setContextQueue } = useQueueStore();

  // Derived albums from library
  const derivedAlbums: CoverFlowAlbum[] = useMemo(() => {
    const map = new Map<string, CoverFlowAlbum>();
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
        },
        {
          id: 'demo_2',
          title: 'Redline',
          artist: 'Lazerhawk',
          year: '2010',
          coverUrl: 'https://i.ytimg.com/vi/DCas2ZWGwl4/hqdefault.jpg',
        },
        {
          id: 'demo_3',
          title: 'Sweet Taste of India',
          artist: 'Anoop Sankar',
          year: '2024',
          coverUrl: 'https://i.ytimg.com/vi/dX3k_QDnzHE/hqdefault.jpg',
        },
      ];
    }
    return list;
  }, [favorites]);

  const [selectedAlbum, setSelectedAlbum] = useState<CoverFlowAlbum | null>(
    derivedAlbums[0] || null
  );

  const selectedAlbumSongs: Song[] = useMemo(() => {
    if (!selectedAlbum) return favorites.slice(0, 5);
    const matched = favorites.filter(
      (s) =>
        s.albumName === selectedAlbum.title ||
        s.album === selectedAlbum.title ||
        s.artist === selectedAlbum.artist
    );
    return matched.length > 0 ? matched : favorites.slice(0, 5);
  }, [favorites, selectedAlbum]);

  const handlePlayAlbum = (album: CoverFlowAlbum) => {
    if (selectedAlbumSongs.length > 0) {
      setContextQueue(selectedAlbumSongs, 0, {
        id: album.id,
        browseId: album.id,
        title: album.title,
        type: 'album',
        currentIndex: 0,
      });
      loadTrack(selectedAlbumSongs[0], 'active', true);
    }
  };

  const handleShuffle = () => {
    if (selectedAlbumSongs.length === 0) return;
    const shuffled = [...selectedAlbumSongs].sort(() => Math.random() - 0.5);
    setContextQueue(shuffled, 0);
    loadTrack(shuffled[0], 'active', true);
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
            Browse your album artwork in an authentic 3D perspective carousel with mirror reflections.
          </p>
        </div>
      </div>

      {/* 2. Top Zone: 3D Cover Flow Carousel */}
      <section className="acrylic-tile p-6 rounded-3xl overflow-hidden shadow-2xl">
        <AlbumCoverFlow
          albums={derivedAlbums}
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
                  src={selectedAlbum.coverUrl}
                  alt={selectedAlbum.title}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#FA2D48]">
                  Selected Album
                </span>
                <h2 className="text-xl font-black text-white truncate">
                  {selectedAlbum.title}
                </h2>
                <p className="text-xs text-[#A1A1A6] truncate">
                  {selectedAlbum.artist} • {selectedAlbum.year || '2026'}
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
