// src/ui/layout/DesktopTitleBar.tsx
// Zone 1: Frameless Acrylic Title Bar conforming to Windows 11 desktop ergonomics

import React, { useEffect, useState } from 'react';
import {
  Minus,
  Square,
  Copy,
  X,
  Sun,
  Moon,
  ChevronLeft,
  ChevronRight,
  ArrowUpCircle,
  Loader2,
} from 'lucide-react';
import { useThemeStore } from '../theme/Theme';
import { useNavigationStore } from '../../state/navigationStore';
import { useUpdateStore } from '../../state/settingsStore';

declare global {
  interface Window {
    electronAPI?: {
      minimize: () => Promise<void>;
      maximize: () => Promise<void>;
      close: () => Promise<void>;
      isMaximized: () => Promise<boolean>;
      onMaximizedChange: (callback: (isMaximized: boolean) => void) => () => void;
      platform: string;
    };
  }
}

export const DesktopTitleBar: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false);
  const { mode, toggleMode } = useThemeStore();
  const { goBack, goForward, canGoBack, canGoForward } = useNavigationStore();
  const updateState = useUpdateStore((s) => s.state);
  const isUpdateModalOpen = useUpdateStore((s) => s.isModalOpen);
  const openUpdateModal = useUpdateStore((s) => s.openModal);

  const showUpdatePill =
    !isUpdateModalOpen &&
    (updateState.status === 'available' ||
      updateState.status === 'downloading' ||
      updateState.status === 'verifying' ||
      updateState.status === 'installing');

  const updatePillLabel =
    updateState.status === 'downloading'
      ? `${Math.round(updateState.progress?.percent ?? 0)}%`
      : updateState.status === 'verifying'
        ? 'Verifying'
        : updateState.status === 'installing'
          ? 'Installing'
          : `Update v${updateState.latestVersion || ''}`;

  useEffect(() => {
    if (window.electronAPI?.isMaximized) {
      window.electronAPI.isMaximized().then(setIsMaximized);
    }

    if (window.electronAPI?.onMaximizedChange) {
      const unsubscribe = window.electronAPI.onMaximizedChange((max) => {
        setIsMaximized(max);
      });
      return () => unsubscribe();
    }
  }, []);

  const handleMinimize = () => window.electronAPI?.minimize();
  const handleMaximize = () => window.electronAPI?.maximize();
  const handleClose = () => window.electronAPI?.close();
  const isMac = typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin';

  return (
    <header className="relative app-drag-region flex items-center justify-between h-10 md:h-12 pl-3 pr-0 border-b border-[var(--glass-border-subtle)] bg-[rgba(242,242,247,0.85)] dark:bg-[rgba(16,16,20,0.75)] backdrop-blur-xl text-[var(--color-primary)] select-none z-[60]">
      {/* 1. Left Cluster: macOS Traffic Lights (darwin only) & Navigation History */}
      <div className="flex items-center gap-3">
        {/* macOS Traffic Lights (12px circular with hover micro-glyphs) */}
        {isMac && (
          <div className="app-no-drag mac-traffic-group flex items-center gap-2 pl-0.5 pr-1">
            {/* Close (Red) */}
            <button
              onClick={handleClose}
              title="Close Window"
              aria-label="Close"
              className="mac-traffic-btn bg-[#FF5F56] border border-[#E0443E] shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]"
            >
              <svg width="6" height="6" viewBox="0 0 6 6" fill="none" stroke="#4C0000" strokeWidth="1.2">
                <path d="M1 1L5 5M5 1L1 5" />
              </svg>
            </button>

            {/* Minimize (Yellow) */}
            <button
              onClick={handleMinimize}
              title="Minimize Window"
              aria-label="Minimize"
              className="mac-traffic-btn bg-[#FFBD2E] border border-[#DEA123] shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]"
            >
              <svg width="6" height="6" viewBox="0 0 6 6" fill="none" stroke="#664600" strokeWidth="1.2">
                <path d="M0.5 3H5.5" />
              </svg>
            </button>

            {/* Maximize / Zoom (Green) */}
            <button
              onClick={handleMaximize}
              title={isMaximized ? 'Restore' : 'Zoom'}
              aria-label="Zoom"
              className="mac-traffic-btn bg-[#27C93F] border border-[#1AAB29] shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]"
            >
              <svg width="6" height="6" viewBox="0 0 6 6" fill="none" stroke="#004D11" strokeWidth="1.2">
                <path d="M1 3H5M3 1V5" />
              </svg>
            </button>
          </div>
        )}

        {/* 28x28px History Hitboxes */}
        <div className="app-no-drag flex items-center gap-1 ml-1.5">
          <button
            onClick={goBack}
            disabled={!canGoBack()}
            title="Go Back"
            aria-label="Back (Alt+Left)"
            className="w-7 h-7 flex items-center justify-center rounded-lg dark:bg-white/[0.05] bg-black/[0.04] dark:hover:bg-white/10 hover:bg-black/[0.08] active:scale-95 border dark:border-white/10 border-black/10 dark:hover:border-white/20 hover:border-black/20 text-[var(--color-on-surface-variant)] dark:hover:text-white hover:text-black disabled:opacity-20 disabled:pointer-events-none transition-all cursor-pointer"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            onClick={goForward}
            disabled={!canGoForward()}
            title="Go Forward"
            aria-label="Forward (Alt+Right)"
            className="w-7 h-7 flex items-center justify-center rounded-lg dark:bg-white/[0.05] bg-black/[0.04] dark:hover:bg-white/10 hover:bg-black/[0.08] active:scale-95 border dark:border-white/10 border-black/10 dark:hover:border-white/20 hover:border-black/20 text-[var(--color-on-surface-variant)] dark:hover:text-white hover:text-black disabled:opacity-20 disabled:pointer-events-none transition-all cursor-pointer"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      {/* 2. Center Drag Spacer (Ctrl+K Quick Search consolidated into LeftSidebar) */}
      <div className="flex-1" />

      {/* 3. Right Cluster: Update Pill, Theme Switcher & Windows 11 Native Caption Controls */}
      <div className="app-no-drag flex items-center h-full">
        {showUpdatePill && (
          <button
            type="button"
            onClick={openUpdateModal}
            title="Open WaveForm Updater"
            className="spring-press liquid-glass-pill h-7 px-2.5 mr-2 rounded-full flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-accent)] border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/12 hover:bg-[var(--color-accent)]/20 transition-all cursor-pointer"
          >
            {updateState.status === 'available' ? (
              <ArrowUpCircle size={13} />
            ) : (
              <Loader2 size={13} className="animate-spin" />
            )}
            <span>{updatePillLabel}</span>
          </button>
        )}

        <button
          onClick={toggleMode}
          title={`Switch to ${mode === 'dark' ? 'Light' : 'Dark'} mode`}
          className="w-7 h-7 flex items-center justify-center rounded-lg dark:bg-white/[0.05] bg-black/[0.04] dark:hover:bg-white/10 hover:bg-black/[0.08] border dark:border-white/10 border-black/10 text-[var(--color-on-surface-variant)] dark:hover:text-white hover:text-black transition-colors mr-2 cursor-pointer"
        >
          {mode === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>

        {/* Windows 11 Minimize Button (46px standard width) */}
        <button
          onClick={handleMinimize}
          title="Minimize"
          className="w-[46px] h-full flex items-center justify-center dark:hover:bg-white/10 hover:bg-black/[0.06] dark:active:bg-white/15 active:bg-black/[0.10] text-[var(--color-on-surface-variant)] dark:hover:text-white hover:text-black transition-colors"
        >
          <Minus size={14} />
        </button>

        {/* Windows 11 Maximize / Restore Button */}
        <button
          onClick={handleMaximize}
          title={isMaximized ? 'Restore' : 'Maximize'}
          className="w-[46px] h-full flex items-center justify-center dark:hover:bg-white/10 hover:bg-black/[0.06] dark:active:bg-white/15 active:bg-black/[0.10] text-[var(--color-on-surface-variant)] dark:hover:text-white hover:text-black transition-colors"
        >
          {isMaximized ? <Copy size={12} className="rotate-180" /> : <Square size={12} />}
        </button>

        {/* Windows 11 Close Button (#E81123 hover, Fitts's Law top-right corner) */}
        <button
          onClick={handleClose}
          title="Close"
          className="w-[46px] h-full flex items-center justify-center hover:bg-[#E81123] active:bg-[#C4101E] text-[var(--color-on-surface-variant)] hover:text-white transition-colors"
        >
          <X size={14} />
        </button>
      </div>
    </header>
  );
};
