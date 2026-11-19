// src/ui/layout/RightSidecar.tsx
// Zone 5: Collapsible macOS Apple Music Liquid-Glass Right Sidecar Drawer
// Housing syllable-synced glowing lyrics with graduated depth-of-field blur,
// ambient artwork tinting, and the 3-tier queue (USER_QUEUE -> CONTEXT -> AUTOPLAY)

import React, { useState, useEffect, memo } from 'react';
import { AlignLeft, ListOrdered, X, Music2, GripVertical, Trash2 } from 'lucide-react';
import { ArtistCredits } from '../common/ArtistCredits';
import { usePlayerStore } from '../../state/playerStore';
import { useQueueStore } from '../../state/queueStore';
import { useLyricsStore } from '../../state/lyricsStore';
import { useNavigationStore } from '../../state/navigationStore';
import { useThemeStore } from '../theme/Theme';
import { SyllableLyricsEngine } from '../player/SyllableLyricsEngine';
import type { Song } from '../../models/Song';

export interface RightSidecarProps {
  isOpen: boolean;
  onClose: () => void;
  currentTrack?: {
    title: string;
    artist: string;
    duration: string;
    cover: string;
  };
}

export const RightSidecar: React.FC<RightSidecarProps> = memo(({
  isOpen,
  onClose,
  currentTrack: fallbackTrack,
}) => {
  const [activeTab, setActiveTab] = useState<'lyrics' | 'queue'>('lyrics');

  const isLyricsDrawerOpen = useNavigationStore((s) => s.isLyricsDrawerOpen);
  const isQueueDrawerOpen = useNavigationStore((s) => s.isQueueDrawerOpen);

  useEffect(() => {
    if (isQueueDrawerOpen) {
      setActiveTab('queue');
    } else if (isLyricsDrawerOpen) {
      setActiveTab('lyrics');
    }
  }, [isQueueDrawerOpen, isLyricsDrawerOpen]);

  const storeTrack = usePlayerStore((s) => s.currentTrack);
  const seek = usePlayerStore((s) => s.seek);
  const artworkPalette = useThemeStore((s) => s.artworkPalette);

  const activeTrack =
    storeTrack ||
    (fallbackTrack
      ? ({
          videoId: 'sample',
          title: fallbackTrack.title,
          artist: fallbackTrack.artist,
          thumbnailUrl: fallbackTrack.cover,
          durationSec: 240,
          totalPlayTimeMs: 240000,
          liked: false,
          playCount: 1,
          artistIds: [],
          artists: [],
          isExplicit: false,
        } as Song)
      : null);

  const { tiers, currentSong, jumpToTrack, removeFromQueue, clearQueue } = useQueueStore();
  const { lyricsData, isLoading, fetchLyricsForTrack } = useLyricsStore();

  useEffect(() => {
    fetchLyricsForTrack(activeTrack);
  }, [
    activeTrack?.videoId,
    activeTrack?.title,
    activeTrack?.artist,
    (activeTrack as any)?.lyrics,
    fetchLyricsForTrack,
  ]);

  const formatDuration = (sec?: number) => {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const currentPlaying = currentSong || activeTrack;

  return (
    <div
      className={`h-full shrink-0 overflow-hidden transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
        isOpen ? 'w-[360px]' : 'w-0'
      }`}
      aria-hidden={!isOpen}
    >
      <aside
        className={`${isOpen ? 'w-[360px]' : 'w-0 pointer-events-none'} h-full flex flex-col backdrop-blur-2xl border-l border-[var(--glass-border-subtle)] text-[var(--color-primary)] select-none z-20 will-change-transform transition-transform duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)]`}
        style={{
          transform: isOpen ? 'translate3d(0, 0, 0)' : 'translate3d(100%, 0, 0)',
          background: `linear-gradient(180deg, ${artworkPalette?.playerTint || 'rgba(16,16,20,0.78)'} 0%, rgba(16,16,20,0.85) 100%)`,
        }}
      >
        {/* Header: Segmented Control & Close Button */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--glass-border-subtle)] shrink-0">
          <div className="flex items-center gap-1 bg-black/30 p-1 rounded-xl border border-white/10">
            <button
              onClick={() => setActiveTab('lyrics')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'lyrics'
                  ? 'bg-white/15 text-white shadow-[0_2px_8px_rgba(0,0,0,0.4)] border border-white/10'
                  : 'text-[var(--color-on-surface-variant)] hover:text-white'
              }`}
            >
              <AlignLeft size={13} />
              <span>Lyrics</span>
            </button>

            <button
              onClick={() => setActiveTab('queue')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'queue'
                  ? 'bg-white/15 text-white shadow-[0_2px_8px_rgba(0,0,0,0.4)] border border-white/10'
                  : 'text-[var(--color-on-surface-variant)] hover:text-white'
              }`}
            >
              <ListOrdered size={13} />
              <span>Up Next</span>
            </button>
          </div>

          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-on-surface-variant)] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title="Close Sidecar"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab 1: Syllable Synced Lyrics Engine */}
        {activeTab === 'lyrics' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="flex-1 overflow-hidden">
              <SyllableLyricsEngine
                lyricsData={lyricsData}
                isActive={isOpen && activeTab === 'lyrics'}
                onSeek={seek}
                fontSize={18}
                isLoading={isLoading}
                className="h-full"
              />
            </div>
          </div>
        )}

        {/* Tab 2: Dynamic 3-Tier Queue */}
        {activeTab === 'queue' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--color-on-surface-variant)] uppercase tracking-wider">
                Playing Now
              </span>
              <button
                onClick={() => clearQueue()}
                className="flex items-center gap-1 text-[11px] text-[var(--color-on-surface-variant)] hover:text-red-400 transition-colors cursor-pointer"
              >
                <Trash2 size={12} />
                <span>Clear</span>
              </button>
            </div>

            {/* Current Playing Item Card */}
            {currentPlaying && (
              <div className="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.06] border border-[var(--color-accent)]/30">
                <div className="w-10 h-10 rounded-lg overflow-hidden bg-neutral-900 shrink-0">
                  {currentPlaying.thumbnailUrl ? (
                    <img
                      src={currentPlaying.thumbnailUrl}
                      alt="cover"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-neutral-600">
                      <Music2 size={16} />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-[var(--color-accent)] truncate">
                    {currentPlaying.title}
                  </div>
                  <div className="text-[11px] text-[var(--color-on-surface-variant)] truncate">
                    <ArtistCredits
                      artist={currentPlaying.artist}
                      artists={currentPlaying.artists}
                      artistIds={currentPlaying.artistIds}
                      onNavigate={(id) => useNavigationStore.getState().navigateToArtist(id)}
                    />
                  </div>
                </div>
                <Music2 size={16} className="text-[var(--color-accent)] animate-pulse shrink-0" />
              </div>
            )}

            {/* Tier 1: User Queue */}
            {tiers.USER_QUEUE.length > 0 && (
              <div className="space-y-1.5 pt-2">
                <div className="text-xs font-semibold text-[var(--color-on-surface-variant)] uppercase tracking-wider">
                  User Queue ({tiers.USER_QUEUE.length})
                </div>
                {tiers.USER_QUEUE.map((item, idx) => (
                  <div
                    key={`user-${item.videoId}-${idx}`}
                    onClick={() => jumpToTrack('USER_QUEUE', idx)}
                    className="queue-row group flex items-center gap-2 p-2 rounded-lg hover:bg-white/[0.06] transition-all cursor-pointer"
                  >
                    <GripVertical
                      size={14}
                      className="text-[var(--color-on-surface-variant)] opacity-30 group-hover:opacity-100 cursor-grab"
                    />
                    <div className="w-8 h-8 rounded overflow-hidden bg-neutral-900 shrink-0">
                      {item.thumbnailUrl ? (
                        <img src={item.thumbnailUrl} alt="cover" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-neutral-600">
                          <Music2 size={12} />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-white truncate">{item.title}</div>
                      <div className="text-[10px] text-[var(--color-on-surface-variant)] truncate">{item.artist}</div>
                    </div>
                    <span className="text-[10px] font-mono text-[var(--color-on-surface-variant)]">
                      {formatDuration(item.durationSec || (item.totalPlayTimeMs ? item.totalPlayTimeMs / 1000 : 0))}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromQueue('USER_QUEUE', idx);
                      }}
                      title="Remove from queue"
                      className="p-1 opacity-0 group-hover:opacity-100 text-[var(--color-on-surface-variant)] hover:text-red-400 transition-opacity"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Tier 2: Context Queue */}
            {tiers.CONTEXT.length > 0 && (
              <div className="space-y-1.5 pt-2">
                <div className="text-xs font-semibold text-[var(--color-on-surface-variant)] uppercase tracking-wider">
                  Next Up ({tiers.CONTEXT.length})
                </div>
                {tiers.CONTEXT.slice(0, 25).map((item, idx) => (
                  <div
                    key={`ctx-${item.videoId}-${idx}`}
                    onClick={() => jumpToTrack('CONTEXT', idx)}
                    className="queue-row group flex items-center gap-2 p-2 rounded-lg hover:bg-white/[0.06] transition-all cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded overflow-hidden bg-neutral-900 shrink-0">
                      {item.thumbnailUrl ? (
                        <img src={item.thumbnailUrl} alt="cover" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-neutral-600">
                          <Music2 size={12} />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-white truncate">{item.title}</div>
                      <div className="text-[10px] text-[var(--color-on-surface-variant)] truncate">{item.artist}</div>
                    </div>
                    <span className="text-[10px] font-mono text-[var(--color-on-surface-variant)]">
                      {formatDuration(item.durationSec || (item.totalPlayTimeMs ? item.totalPlayTimeMs / 1000 : 0))}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Tier 3: Autoplay Radio Queue */}
            {tiers.AUTOPLAY.length > 0 && (
              <div className="space-y-1.5 pt-2">
                <div className="text-xs font-semibold text-[var(--color-on-surface-variant)] uppercase tracking-wider">
                  Autoplay Radio ({tiers.AUTOPLAY.length})
                </div>
                {tiers.AUTOPLAY.map((item, idx) => (
                  <div
                    key={`auto-${item.videoId}-${idx}`}
                    onClick={() => jumpToTrack('AUTOPLAY', idx)}
                    className="queue-row group flex items-center gap-2 p-2 rounded-lg hover:bg-white/[0.06] transition-all cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded overflow-hidden bg-neutral-900 shrink-0">
                      {item.thumbnailUrl ? (
                        <img src={item.thumbnailUrl} alt="cover" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-neutral-600">
                          <Music2 size={12} />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-white truncate">{item.title}</div>
                      <div className="text-[10px] text-[var(--color-on-surface-variant)] truncate">{item.artist}</div>
                    </div>
                    <span className="text-[10px] font-mono text-[var(--color-on-surface-variant)]">
                      {formatDuration(item.durationSec || (item.totalPlayTimeMs ? item.totalPlayTimeMs / 1000 : 0))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
});

RightSidecar.displayName = 'RightSidecar';

// Alias for backwards compatibility with tests and existing imports
export const RightInspector = RightSidecar;
export default RightSidecar;
