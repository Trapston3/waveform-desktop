// src/ui/player/AlbumCoverFlow.tsx
// Interactive 3D perspective album cover carousel with reflection floor (Feature 23)
// CSS 3D transforms, mouse drag/flick, mouse wheel navigation, and keyboard arrows

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import type { BrowseItem } from '../../models/Navigation';

export interface CoverFlowAlbum {
  id: string;
  title: string;
  artist: string;
  year?: string;
  coverUrl: string;
}

export interface AlbumCoverFlowProps {
  albums: CoverFlowAlbum[];
  onSelectAlbum?: (album: CoverFlowAlbum) => void;
  onPlayAlbum?: (album: CoverFlowAlbum) => void;
  className?: string;
}

export const AlbumCoverFlow: React.FC<AlbumCoverFlowProps> = ({
  albums,
  onSelectAlbum,
  onPlayAlbum,
  className = '',
}) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const currentDragDeltaRef = useRef(0);

  const total = albums.length;

  const clampIndex = useCallback(
    (idx: number) => {
      return Math.max(0, Math.min(total - 1, idx));
    },
    [total]
  );

  const handlePrev = useCallback(() => {
    setActiveIndex((prev) => clampIndex(prev - 1));
  }, [clampIndex]);

  const handleNext = useCallback(() => {
    setActiveIndex((prev) => clampIndex(prev + 1));
  }, [clampIndex]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'Enter') {
        if (albums[activeIndex] && onPlayAlbum) {
          onPlayAlbum(albums[activeIndex]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePrev, handleNext, albums, activeIndex, onPlayAlbum]);

  // Mouse wheel navigation
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      if (e.deltaX > 20) handleNext();
      else if (e.deltaX < -20) handlePrev();
    } else {
      if (e.deltaY > 20) handleNext();
      else if (e.deltaY < -20) handlePrev();
    }
  };

  // Mouse drag / flick
  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    startXRef.current = e.clientX;
    currentDragDeltaRef.current = 0;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;
      currentDragDeltaRef.current = moveEvent.clientX - startXRef.current;
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      isDraggingRef.current = false;

      const delta = currentDragDeltaRef.current;
      if (delta > 45) {
        handlePrev();
      } else if (delta < -45) {
        handleNext();
      }
      currentDragDeltaRef.current = 0;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  if (albums.length === 0) {
    return (
      <div className="flex items-center justify-center h-80 text-xs text-[var(--color-on-surface-variant)]">
        No albums to display in 3D Cover Flow
      </div>
    );
  }

  const currentAlbum = albums[activeIndex] || albums[0];

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      className={`relative w-full h-[460px] flex flex-col items-center justify-center overflow-hidden select-none ${className}`}
      style={{ perspective: '1000px' }}
    >
      {/* 3D Cards Stage */}
      <div
        className="relative w-full h-[320px] flex items-center justify-center"
        style={{ transformStyle: 'preserve-3d' }}
      >
        {albums.map((album, i) => {
          const offset = i - activeIndex;
          const absOffset = Math.min(1.0, Math.abs(offset));

          // Only render visible neighborhood cards to optimize performance
          if (Math.abs(offset) > 5) return null;

          const rotationY = offset === 0 ? 0 : offset < 0 ? 55 : -55;
          const scale = 1.0 - 0.28 * absOffset;
          const translateX = offset === 0 ? 0 : offset * 140 + (offset > 0 ? 60 : -60);
          const translateZ = -150 * absOffset;
          const opacity = 1.0 - 0.45 * absOffset;
          const zIndex = 100 - Math.abs(offset) * 10;

          return (
            <div
              key={album.id}
              onClick={(e) => {
                e.stopPropagation();
                if (offset === 0) {
                  if (onSelectAlbum) onSelectAlbum(album);
                } else {
                  setActiveIndex(i);
                }
              }}
              style={{
                transform: `translateX(${translateX}px) translateZ(${translateZ}px) rotateY(${rotationY}deg) scale(${scale})`,
                zIndex,
                opacity,
                transition: 'transform 380ms cubic-bezier(0.2, 0.9, 0.3, 1), opacity 380ms ease',
                transformOrigin: offset > 0 ? '0% 50%' : offset < 0 ? '100% 50%' : '50% 50%',
              }}
              className="absolute w-56 h-56 cursor-pointer group rounded-2xl"
            >
              {/* Primary Album Cover */}
              <div className="relative w-full h-full rounded-2xl overflow-hidden shadow-2xl border border-[var(--color-outline)] bg-neutral-900">
                <img
                  src={album.coverUrl}
                  alt={album.title}
                  className="w-full h-full object-cover"
                />

                {/* Center Card Play Button Overlay */}
                {offset === 0 && (
                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onPlayAlbum) onPlayAlbum(album);
                      }}
                      className="w-12 h-12 rounded-full bg-[var(--color-accent)] text-white flex items-center justify-center shadow-xl hover:scale-110 active:scale-95 transition-transform"
                    >
                      <Play size={20} fill="white" className="ml-0.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Reflection Floor (42% height, scaleY(-1), linear gradient mask) */}
              <div
                style={{
                  height: '42%',
                  transform: 'scaleY(-1) translateY(-6px)',
                  opacity: 0.28,
                  WebkitMaskImage:
                    'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.45) 40%, rgba(0,0,0,0.95) 100%)',
                  maskImage:
                    'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.45) 40%, rgba(0,0,0,0.95) 100%)',
                }}
                className="w-full overflow-hidden rounded-2xl pointer-events-none mt-2"
              >
                <img
                  src={album.coverUrl}
                  alt="reflection"
                  className="w-full h-full object-cover filter blur-[1px]"
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Active Album Metadata Display */}
      <div className="text-center mt-3 space-y-1 z-20">
        <h3 className="text-base font-bold text-[var(--color-primary)] truncate max-w-md">
          {currentAlbum.title}
        </h3>
        <p className="text-xs text-[var(--color-on-surface-variant)]">
          {currentAlbum.artist} {currentAlbum.year ? `• ${currentAlbum.year}` : ''}
        </p>
      </div>

      {/* Navigation Buttons */}
      <button
        onClick={handlePrev}
        disabled={activeIndex === 0}
        className="absolute left-6 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-[var(--color-surface)]/80 hover:bg-[var(--color-surface)] disabled:opacity-30 border border-[var(--color-outline)] shadow-lg flex items-center justify-center text-[var(--color-primary)] transition-all cursor-pointer z-30"
      >
        <ChevronLeft size={20} />
      </button>

      <button
        onClick={handleNext}
        disabled={activeIndex === total - 1}
        className="absolute right-6 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-[var(--color-surface)]/80 hover:bg-[var(--color-surface)] disabled:opacity-30 border border-[var(--color-outline)] shadow-lg flex items-center justify-center text-[var(--color-primary)] transition-all cursor-pointer z-30"
      >
        <ChevronRight size={20} />
      </button>
    </div>
  );
};
