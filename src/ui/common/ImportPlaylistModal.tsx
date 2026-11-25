// src/ui/common/ImportPlaylistModal.tsx
// Zero-API-key Spotify, Apple Music & YouTube Music playlist URL importer modal

import React, { useState, useEffect } from 'react';
import { X, Link2, Check, Loader2, Music2, Sparkles, AlertCircle } from 'lucide-react';
import {
  PlaylistImportService,
  detectImportUrlSource,
  type ImportedPlaylistData,
  type MatchedImportTrack,
} from '../../services/PlaylistImportService';
import { useLibraryStore } from '../../state/libraryStore';
import { useNavigationStore } from '../../state/navigationStore';

export interface ImportPlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SOURCE_BADGE: Record<'spotify' | 'apple' | 'youtube', { label: string; colorClass: string }> = {
  spotify: {
    label: 'Spotify',
    colorClass: 'bg-[#1DB954]/20 text-[#1DB954] border-[#1DB954]/40',
  },
  apple: {
    label: 'Apple Music',
    colorClass: 'bg-[#FA2D48]/20 text-[#FA2D48] border-[#FA2D48]/40',
  },
  youtube: {
    label: 'YouTube Music',
    colorClass: 'bg-red-500/20 text-red-300 border-red-400/40',
  },
};

export const ImportPlaylistModal: React.FC<ImportPlaylistModalProps> = ({ isOpen, onClose }) => {
  const [url, setUrl] = useState('');
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isMatching, setIsMatching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportedPlaylistData | null>(null);
  const [matchedTracks, setMatchedTracks] = useState<MatchedImportTrack[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState<{ completed: number; total: number; matchedCount: number }>({
    completed: 0,
    total: 0,
    matchedCount: 0,
  });

  const createPlaylistWithSongs = useLibraryStore((s) => s.createPlaylistWithSongs);
  const navigateToRelease = useNavigationStore((s) => s.navigateToRelease);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
  }, [isOpen]);

  if (!isOpen) return null;

  const detectedSource = detectImportUrlSource(url);

  const handleLoadPreview = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!url.trim()) return;
    setError(null);
    setPreview(null);
    setMatchedTracks([]);
    setSelectedIndices(new Set());
    setIsLoadingPreview(true);
    try {
      const data = await PlaylistImportService.fetchPreview(url);
      setPreview(data);

      if (data.preloadedSongs && data.preloadedSongs.length > 0) {
        const pre = data.preloadedSongs.map((s, idx) => ({
          raw: data.tracks[idx] || {
            title: s.title,
            artist: s.artist,
            durationSec: s.durationSec || 0,
          },
          song: s,
          matched: true,
        }));
        setMatchedTracks(pre);
        setSelectedIndices(new Set(pre.map((_, i) => i)));
      } else {
        setIsMatching(true);
        setProgress({ completed: 0, total: data.tracks.length, matchedCount: 0 });
        const matched = await PlaylistImportService.matchTracksConcurrently(data.tracks, {
          concurrency: 5,
          onProgress: (p) => setProgress(p),
        });
        setMatchedTracks(matched);
        const sel = new Set<number>();
        matched.forEach((m, i) => {
          if (m.matched) sel.add(i);
        });
        setSelectedIndices(sel);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to import playlist from URL.');
    } finally {
      setIsLoadingPreview(false);
      setIsMatching(false);
    }
  };

  const toggleTrack = (idx: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleSavePlaylist = async () => {
    if (!preview) return;
    const songs = matchedTracks
      .filter((m, idx) => selectedIndices.has(idx) && m.song)
      .map((m) => m.song!);
    if (songs.length === 0) return;

    setIsSaving(true);
    try {
      const created = await createPlaylistWithSongs(preview.title, songs, {
        description:
          preview.description ||
          `Imported from ${SOURCE_BADGE[preview.source].label}${preview.owner ? ` • ${preview.owner}` : ''}`,
        thumbnailUrl: preview.thumbnailUrl || songs[0]?.thumbnailUrl || null,
        sourceUrl: preview.sourceUrl,
      });
      onClose();
      setUrl('');
      setPreview(null);
      setMatchedTracks([]);
      navigateToRelease(created.id, 'playlist');
    } catch (err: any) {
      setError(err?.message || 'Could not save imported playlist.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 select-none animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-3xl bg-[#16161a]/95 border border-white/15 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#FA2D48]/20 text-[#FA2D48] flex items-center justify-center">
              <Link2 size={16} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Import Playlist from URL</h2>
              <p className="text-[11px] text-white/55">
                Spotify, Apple Music, or YouTube Music — no API key required
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Import Modal"
            className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* URL Input */}
        <form onSubmit={handleLoadPreview} className="p-5 space-y-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Paste https://open.spotify.com/playlist/... or https://music.apple.com/..."
                autoFocus
                className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/15 focus:border-[#FA2D48] focus:outline-none text-xs text-white placeholder:text-white/35 pr-28"
              />
              {detectedSource && (
                <span
                  className={`absolute right-2.5 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-full text-[10px] font-bold border ${SOURCE_BADGE[detectedSource].colorClass}`}
                >
                  {SOURCE_BADGE[detectedSource].label}
                </span>
              )}
            </div>
            <button
              type="submit"
              disabled={!url.trim() || isLoadingPreview || isMatching}
              className="px-4 py-2.5 rounded-xl bg-[#FA2D48] hover:bg-[#ff3b56] disabled:opacity-45 text-white text-xs font-bold transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
            >
              {isLoadingPreview ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              <span>Fetch & Match</span>
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/15 border border-red-400/30 text-xs text-red-200">
              <AlertCircle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </form>

        {/* Preview & Matching Progress */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {preview ? (
            <>
              <div className="flex items-center gap-4 p-3.5 rounded-2xl bg-white/[0.04] border border-white/10">
                <div className="w-16 h-16 rounded-xl overflow-hidden bg-neutral-900 shrink-0 flex items-center justify-center">
                  {preview.thumbnailUrl ? (
                    <img
                      src={preview.thumbnailUrl}
                      alt={preview.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Music2 size={24} className="text-white/30" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${SOURCE_BADGE[preview.source].colorClass}`}
                    >
                      {SOURCE_BADGE[preview.source].label}
                    </span>
                    <span className="text-[11px] text-white/55">
                      {preview.tracks.length} tracks
                    </span>
                  </div>
                  <h3 className="text-base font-extrabold text-white truncate mt-1">
                    {preview.title}
                  </h3>
                  {preview.owner && (
                    <p className="text-xs text-white/60 truncate">{preview.owner}</p>
                  )}
                </div>
              </div>

              {isMatching && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-white/75">
                    <span>
                      Matching {progress.completed} / {progress.total} tracks…
                    </span>
                    <span className="font-mono text-emerald-400">
                      {progress.matchedCount} matched
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full bg-[#FA2D48] transition-all duration-150"
                      style={{
                        width: `${
                          progress.total > 0
                            ? Math.round((progress.completed / progress.total) * 100)
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {matchedTracks.length > 0 && (
                <div className="space-y-1.5">
                  {matchedTracks.map((item, idx) => {
                    const checked = selectedIndices.has(idx);
                    return (
                      <div
                        key={idx}
                        onClick={() => item.matched && toggleTrack(idx)}
                        className={`flex items-center justify-between gap-3 px-3 py-2 rounded-xl border transition-colors ${
                          item.matched
                            ? checked
                              ? 'bg-white/[0.06] border-white/15 cursor-pointer'
                              : 'bg-white/[0.02] border-white/5 opacity-60 cursor-pointer'
                            : 'bg-red-500/5 border-red-500/20 opacity-55'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 ${
                              item.matched && checked
                                ? 'bg-[#FA2D48] border-[#FA2D48] text-white'
                                : 'border-white/25'
                            }`}
                          >
                            {item.matched && checked && <Check size={11} />}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-white truncate">
                              {item.raw.title}
                            </div>
                            <div className="text-[11px] text-white/55 truncate">
                              {item.raw.artist}
                              {item.raw.album ? ` • ${item.raw.album}` : ''}
                            </div>
                          </div>
                        </div>
                        <span className="text-[10px] font-mono shrink-0 text-white/50">
                          {item.matched ? 'Matched' : 'Not found'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="py-12 text-center space-y-2 text-xs text-white/45">
              <Link2 size={28} className="mx-auto text-white/25" />
              <p>Paste any public Spotify playlist/album, Apple Music playlist/album, or YouTube Music playlist link above.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-white/10 bg-black/25">
          <span className="text-xs text-white/60">
            {selectedIndices.size > 0
              ? `${selectedIndices.size} tracks selected`
              : 'No tracks ready yet'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-white/80 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={selectedIndices.size === 0 || isMatching || isSaving}
              onClick={() => void handleSavePlaylist()}
              className="px-4 py-2 rounded-xl bg-[#FA2D48] hover:bg-[#ff3b56] disabled:opacity-45 text-white text-xs font-bold cursor-pointer flex items-center gap-1.5"
            >
              {isSaving && <Loader2 size={13} className="animate-spin" />}
              <span>Save Playlist ({selectedIndices.size})</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
