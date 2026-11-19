// src/ui/views/LocalMediaView.tsx
// Local Media Hub (macOS Apple Music Desktop Experience with Liquid Glass):
// Indexes local FLAC, WAV, M4A, MP3, and OPUS audio files using LocalMediaScanner.ts
// Features folder scanner, metadata tag extractor, format badges, and DesktopTrackTable integration.

import React, { useState, useMemo, memo } from 'react';
import {
  HardDrive,
  FolderOpen,
  Search,
  Music2,
  Sparkles,
  RefreshCw,
  FolderSync,
} from 'lucide-react';
import { useLibraryStore } from '../../state/libraryStore';
import { usePlayerStore } from '../../state/playerStore';
import { useSettingsStore } from '../../state/settingsStore';
import { enrichLocalTracksInBackground } from '../../services/LocalMetadataEnricher';
import { DesktopTrackTable } from '../components/DesktopTrackTable';
import type { Song } from '../../models/Song';

export interface LocalMediaViewProps {
  onOpenContextMenu?: (e: React.MouseEvent, song: Song) => void;
}

export const LocalMediaView: React.FC<LocalMediaViewProps> = memo(({ onOpenContextMenu }) => {
  const [folderPath, setFolderPath] = useState(() => (typeof localStorage !== 'undefined' && localStorage.getItem('waveform.localMusicFolder')) || 'C:\\Music');
  const [searchFilter, setSearchFilter] = useState('');

  const {
    localSongs = [],
    scanState,
    startLocalMediaScan,
  } = useLibraryStore();

  const runScan = async (folder: string) => {
    if (!folder.trim()) return;
    try {
      const api = (window as any).electronAPI;
      // Electron: real scan via main process; otherwise store falls back to its web preview scan.
      const scanner = api?.scanLocalFolder ? { scanDirectory: (p: string) => api.scanLocalFolder(p) } : null;
      const scanned = await startLocalMediaScan(scanner as any, folder.trim());
      if (Array.isArray(scanned) && scanned.length > 0) {
        void enrichLocalTracksInBackground(scanned, (videoId, patch) => {
          const libState = useLibraryStore.getState();
          const updatedSongs = libState.localSongs.map((s) =>
            s.videoId === videoId ? { ...s, ...patch } : s
          );
          libState.setLocalSongs(updatedSongs);

          const playerState = usePlayerStore.getState();
          if (playerState.currentTrack?.videoId === videoId) {
            usePlayerStore.setState({
              currentTrack: { ...playerState.currentTrack, ...patch },
            });
          }
        });
      }
    } catch (err) {
      console.warn('[LocalMediaView] Scan failed:', err);
    }
  };

  const handleScan = () => runScan(folderPath);

  const handleBrowse = async () => {
    const res = await (window as any).electronAPI?.selectLocalFolder?.();
    if (!res || res.canceled || !res.folderPath) return;
    setFolderPath(res.folderPath);
    try {
      localStorage.setItem('waveform.localMusicFolder', res.folderPath);
      await useSettingsStore.getState().updateSettings({ localMusicFolders: [res.folderPath] } as any);
    } catch { /* persistence is best-effort */ }
    void runScan(res.folderPath);
  };
  const filteredTracks = useMemo(() => {
    if (!searchFilter.trim()) return localSongs;
    const q = searchFilter.toLowerCase().trim();
    return localSongs.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.artist.toLowerCase().includes(q) ||
        (s.albumName && s.albumName.toLowerCase().includes(q))
    );
  }, [localSongs, searchFilter]);

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-16 select-none animate-in fade-in duration-200">
      {/* 1. Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full liquid-glass-pill text-[11px] font-bold text-[#FA2D48] mb-2">
            <HardDrive size={12} />
            High-Resolution Local Library
          </div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight text-white">
            Local Media
          </h1>
          <p className="text-xs text-[#A1A1A6] pt-1">
            Scan and stream your personal FLAC, WAV, ALAC, and MP3 collection with 68-bar waveform analysis.
          </p>
        </div>
      </div>

      {/* 2. Folder Scanner Control Box */}
      <section className="acrylic-tile p-6 rounded-3xl space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center text-white shrink-0">
            <FolderSync size={20} className="text-[#FA2D48]" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Directory Scanner</h2>
            <p className="text-xs text-[#A1A1A6]">
              Point WaveForm to an audio directory on your computer to index metadata and embedded artwork.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-1">
          <div className="relative flex-1">
            <FolderOpen size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8E8E93]" />
            <input
              type="text"
              placeholder="e.g. C:\Users\YourName\Music..."
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              className="liquid-glass w-full h-10 pl-10 pr-4 rounded-full text-xs text-white placeholder-[#8E8E93] outline-none"
            />
          </div>

          <button
            onClick={handleBrowse}
            className="spring-press flex items-center justify-center gap-2 px-5 py-2.5 rounded-full liquid-glass text-white font-bold text-xs cursor-pointer shrink-0"
          >
            <FolderOpen size={13} />
            <span>Browse...</span>
          </button>

          <button
            onClick={handleScan}
            disabled={scanState.isScanning}
            className="spring-press flex items-center justify-center gap-2 px-6 py-2.5 rounded-full bg-[#FA2D48] hover:bg-[#e0263f] disabled:opacity-50 text-white font-bold text-xs cursor-pointer shadow-lg shadow-[#FA2D48]/25 transition-all shrink-0"
          >
            <RefreshCw size={13} className={scanState.isScanning ? 'animate-spin' : ''} />
            <span>{scanState.isScanning ? 'Scanning...' : 'Scan Directory'}</span>
          </button>
        </div>

        {scanState.isScanning && (
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between text-xs text-[#A1A1A6]">
              <span>Extracting audio tags & waveform samples...</span>
              <span className="font-mono text-white font-bold">{scanState.scannedFiles} files indexed</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-[#FA2D48] animate-pulse w-3/4 rounded-full" />
            </div>
          </div>
        )}
      </section>

      {/* 3. Local Media Tracks Table */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Music2 size={18} className="text-[#FA2D48]" />
            <h2 className="text-xl font-bold tracking-tight text-white">
              Indexed Local Tracks ({filteredTracks.length})
            </h2>
          </div>

          {localSongs.length > 0 && (
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8E8E93]" />
              <input
                type="text"
                placeholder="Filter local files..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="liquid-glass h-8 pl-8 pr-3 rounded-full text-xs text-white placeholder-[#8E8E93] outline-none w-52"
              />
            </div>
          )}
        </div>

        {/* DesktopTrackTable integration */}
        <div className="acrylic-tile p-4 rounded-3xl overflow-hidden tracklist-row">
          <DesktopTrackTable
            songs={filteredTracks}
            showCover={true}
            showArtist={true}
            showAlbum={true}
            showTrackNumber={true}
            density="standard"
            allowSorting={true}
            onOpenContextMenu={onOpenContextMenu}
            emptyMessage={
              localSongs.length === 0
                ? 'No local tracks scanned yet. Enter a directory path and click "Scan Directory".'
                : 'No local files match your search filter.'
            }
          />
        </div>
      </section>
    </div>
  );
});

LocalMediaView.displayName = 'LocalMediaView';
