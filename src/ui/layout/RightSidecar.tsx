// src/ui/layout/RightSidecar.tsx
// Zone 5: Collapsible macOS Apple Music Liquid-Glass Right Sidecar Drawer
// Housing syllable-synced glowing lyrics with graduated depth-of-field blur,
// ambient artwork tinting, and the 3-tier queue (USER_QUEUE -> CONTEXT -> AUTOPLAY)

import React, { useState, useEffect, memo } from 'react';
import {
  AlignLeft,
  ListOrdered,
  X,
  Music2,
  GripVertical,
  Trash2,
  ArrowUp,
  ArrowDown,
  Shuffle,
  ListPlus,
  Radio,
  Check,
} from 'lucide-react';
import { ArtistCredits } from '../common/ArtistCredits';
import { usePlayerStore } from '../../state/playerStore';
import { useQueueStore, type QueueTierType } from '../../state/queueStore';
import { useLibraryStore } from '../../state/libraryStore';
import { useLyricsStore } from '../../state/lyricsStore';
import { useNavigationStore } from '../../state/navigationStore';
import { useThemeStore } from '../theme/Theme';
import { SyllableLyricsEngine } from '../player/SyllableLyricsEngine';
import type { Song } from '../../models/Song';
import type { ContextMenuQueueContext } from '../hooks/useContextMenu';

function isValidImageUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  return Boolean(trimmed && trimmed !== 'undefined' && trimmed !== 'null');
}

export interface RightSidecarProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenContextMenu?: (
    e: React.MouseEvent,
    song: Song,
    queueContext?: ContextMenuQueueContext | null
  ) => void;
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
  onOpenContextMenu,
  currentTrack: fallbackTrack,
}) => {
  const [activeTab, setActiveTab] = useState<'lyrics' | 'queue'>('lyrics');
  const [brokenArt, setBrokenArt] = useState<Record<string, boolean>>({});
  const [dragItem, setDragItem] = useState<{ tier: QueueTierType; index: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ tier: QueueTierType; index: number } | null>(null);
  const [savedQueueNotice, setSavedQueueNotice] = useState(false);

  const markArtBroken = (url: string) =>
    setBrokenArt((prev) => (prev[url] ? prev : { ...prev, [url]: true }));

  const renderCoverArt = (url: unknown, iconSize: number) => {
    if (isValidImageUrl(url)) {
      const src = url.trim();
      if (!brokenArt[src]) {
        return (
          <img
            src={src}
            alt="cover"
            onError={() => markArtBroken(src)}
            className="w-full h-full object-cover"
          />
        );
      }
    }
    return (
      <div className="w-full h-full flex items-center justify-center text-neutral-600">
        <Music2 size={iconSize} />
      </div>
    );
  };

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

  const {
    tiers,
    currentSong,
    autoplayEnabled,
    isAutoplayLoading,
    jumpToTrack,
    removeFromQueue,
    reorderQueue,
    moveTrackUp,
    moveTrackDown,
    shuffleUpNext,
    toggleAutoplay,
    clearQueue,
  } = useQueueStore();
  const createPlaylistWithSongs = useLibraryStore((s) => s.createPlaylistWithSongs);
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
    if (!sec || isNaN(sec) || sec <= 0) return '—';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const currentPlaying = currentSong || activeTrack;

  const handleSaveQueueAsPlaylist = async () => {
    const queueSongs: Song[] = [];
    const seen = new Set<string>();
    for (const s of [
      ...(currentPlaying ? [currentPlaying] : []),
      ...tiers.USER_QUEUE,
      ...tiers.CONTEXT,
      ...tiers.AUTOPLAY,
    ]) {
      if (!s?.videoId || seen.has(s.videoId)) continue;
      seen.add(s.videoId);
      queueSongs.push(s);
    }
    if (queueSongs.length === 0) return;
    const label = currentPlaying?.title
      ? `Up Next • ${currentPlaying.title}`
      : `Saved Queue (${new Date().toLocaleDateString()})`;
    await createPlaylistWithSongs(label, queueSongs, {
      description: `Saved from WaveForm Up Next queue (${queueSongs.length} tracks)`,
    });
    setSavedQueueNotice(true);
    setTimeout(() => setSavedQueueNotice(false), 1800);
  };

  const renderTierRows = (tier: QueueTierType, items: Song[], keyPrefix: string) =>
    items.map((item, idx) => {
      const isDragging = dragItem?.tier === tier && dragItem.index === idx;
      const isDropHere =
        dropTarget?.tier === tier &&
        dropTarget.index === idx &&
        dragItem?.tier === tier &&
        dragItem.index !== idx;
      const dur = item.durationSec || (item.totalPlayTimeMs ? item.totalPlayTimeMs / 1000 : 0);

      return (
        <div
          key={`${keyPrefix}-${item.videoId}-${idx}`}
          draggable
          onDragStart={(e) => {
            setDragItem({ tier, index: idx });
            e.dataTransfer.effectAllowed = 'move';
            try {
              e.dataTransfer.setData('text/plain', `${tier}:${idx}`);
            } catch {}
          }}
          onDragOver={(e) => {
            if (!dragItem || dragItem.tier !== tier) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (dropTarget?.tier !== tier || dropTarget.index !== idx) {
              setDropTarget({ tier, index: idx });
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragItem && dragItem.tier === tier && dragItem.index !== idx) {
              reorderQueue(tier, dragItem.index, idx);
            }
            setDragItem(null);
            setDropTarget(null);
          }}
          onDragEnd={() => {
            setDragItem(null);
            setDropTarget(null);
          }}
          onClick={() => jumpToTrack(tier, idx)}
          onContextMenu={(e) => onOpenContextMenu?.(e, item, { tier, index: idx })}
          className={`queue-row group relative flex items-center gap-2 p-2 rounded-lg hover:bg-white/[0.06] transition-all cursor-pointer ${
            isDragging ? 'opacity-45 scale-[0.98]' : ''
          }`}
        >
          {isDropHere && (
            <div className="pointer-events-none absolute -top-0.5 inset-x-2 h-[2px] rounded-full bg-[var(--color-accent)] shadow-[0_0_8px_var(--color-accent)]" />
          )}
          <GripVertical
            size={13}
            className="text-[var(--color-on-surface-variant)] opacity-25 group-hover:opacity-90 cursor-grab shrink-0"
          />
          <div className="w-8 h-8 rounded overflow-hidden bg-neutral-900 shrink-0">
            {renderCoverArt(item.thumbnailUrl, 12)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-white truncate">{item.title}</div>
            <div className="text-[10px] text-[var(--color-on-surface-variant)] truncate">{item.artist}</div>
          </div>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <button
              type="button"
              disabled={idx === 0}
              onClick={(e) => {
                e.stopPropagation();
                moveTrackUp(tier, idx);
              }}
              aria-label="Move track up"
              className="p-0.5 text-[var(--color-on-surface-variant)] hover:text-white disabled:opacity-25 cursor-pointer"
            >
              <ArrowUp size={11} />
            </button>
            <button
              type="button"
              disabled={idx >= items.length - 1}
              onClick={(e) => {
                e.stopPropagation();
                moveTrackDown(tier, idx);
              }}
              aria-label="Move track down"
              className="p-0.5 text-[var(--color-on-surface-variant)] hover:text-white disabled:opacity-25 cursor-pointer"
            >
              <ArrowDown size={11} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeFromQueue(tier, idx);
              }}
              aria-label="Remove from queue"
              className="p-0.5 text-[var(--color-on-surface-variant)] hover:text-red-400 cursor-pointer"
            >
              <X size={12} />
            </button>
          </div>
          <span className="text-[10px] font-mono text-[var(--color-on-surface-variant)] shrink-0">
            {formatDuration(dur)}
          </span>
        </div>
      );
    });

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
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[var(--color-on-surface-variant)] uppercase tracking-wider">
                Playing Now
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => toggleAutoplay()}
                  title={autoplayEnabled ? 'Autoplay Radio On' : 'Autoplay Radio Off'}
                  className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-colors cursor-pointer ${
                    autoplayEnabled
                      ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)] border border-[var(--color-accent)]/40'
                      : 'bg-white/5 text-[var(--color-on-surface-variant)] hover:text-white'
                  }`}
                >
                  <Radio size={11} />
                  <span>Autoplay</span>
                </button>
                <button
                  type="button"
                  onClick={() => shuffleUpNext()}
                  title="Shuffle Up Next"
                  className="p-1.5 rounded-md text-[var(--color-on-surface-variant)] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <Shuffle size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveQueueAsPlaylist()}
                  title="Save Queue as Playlist"
                  className="p-1.5 rounded-md text-[var(--color-on-surface-variant)] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  {savedQueueNotice ? <Check size={12} className="text-emerald-400" /> : <ListPlus size={12} />}
                </button>
                <button
                  type="button"
                  onClick={() => clearQueue()}
                  title="Clear Up Next"
                  className="flex items-center gap-1 px-1.5 py-1 rounded-md text-[11px] text-[var(--color-on-surface-variant)] hover:text-red-400 hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <Trash2 size={12} />
                  <span>Clear</span>
                </button>
              </div>
            </div>

            {/* Current Playing Item Card */}
            {currentPlaying && (
              <div className="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.06] border border-[var(--color-accent)]/30">
                <div className="w-10 h-10 rounded-lg overflow-hidden bg-neutral-900 shrink-0">
                  {renderCoverArt(currentPlaying.thumbnailUrl, 16)}
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
                {renderTierRows('USER_QUEUE', tiers.USER_QUEUE, 'user')}
              </div>
            )}

            {/* Tier 2: Context Queue */}
            {tiers.CONTEXT.length > 0 && (
              <div className="space-y-1.5 pt-2">
                <div className="text-xs font-semibold text-[var(--color-on-surface-variant)] uppercase tracking-wider">
                  Next Up ({tiers.CONTEXT.length})
                </div>
                {renderTierRows('CONTEXT', tiers.CONTEXT.slice(0, 30), 'ctx')}
              </div>
            )}

            {/* Tier 3: Autoplay Radio Queue */}
            {(tiers.AUTOPLAY.length > 0 || isAutoplayLoading) && (
              <div className="space-y-1.5 pt-2">
                <div className="flex items-center justify-between text-xs font-semibold text-[var(--color-on-surface-variant)] uppercase tracking-wider">
                  <span>Autoplay Radio ({tiers.AUTOPLAY.length})</span>
                  {isAutoplayLoading && (
                    <span className="text-[10px] font-normal lowercase text-[var(--color-accent)]">
                      curating…
                    </span>
                  )}
                </div>
                {renderTierRows('AUTOPLAY', tiers.AUTOPLAY, 'auto')}
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
