// src/ui/common/UpdatePromptModal.tsx
// Liquid Glass One-Click In-App Updater modal with SHA-256 verification status and session reminder

import React, { useEffect } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { useUpdateStore } from '../../state/settingsStore';

function formatMegabytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0.0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const UpdatePromptModal: React.FC = () => {
  const state = useUpdateStore((s) => s.state);
  const isModalOpen = useUpdateStore((s) => s.isModalOpen);
  const downloadAndInstall = useUpdateStore((s) => s.downloadAndInstall);
  const dismissForSession = useUpdateStore((s) => s.dismissForSession);
  const closeModal = useUpdateStore((s) => s.closeModal);
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates);
  const openReleasePage = useUpdateStore((s) => s.openReleasePage);

  const isLocked = state.status === 'verifying' || state.status === 'installing';
  const isDownloading = state.status === 'downloading';
  const isError = state.status === 'error';

  const handleDismissOrMinimize = () => {
    if (isLocked) return;
    if (isDownloading) {
      closeModal();
    } else {
      void dismissForSession();
    }
  };

  useEffect(() => {
    if (!isModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (isLocked) {
          event.preventDefault();
          return;
        }
        handleDismissOrMinimize();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isModalOpen, isLocked, isDownloading]);

  if (!isModalOpen) return null;

  const latestLabel = state.latestVersion ? `v${state.latestVersion}` : 'Latest';
  const currentLabel = `v${state.currentVersion}`;
  const progress = state.progress;
  const percent = progress ? Math.max(0, Math.min(100, progress.percent)) : 0;

  const handleRetry = () => {
    if (state.assetName) {
      void downloadAndInstall();
    } else {
      void checkForUpdates();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="waveform-update-modal-title"
      onClick={handleDismissOrMinimize}
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="liquid-glass-capsule max-w-lg w-full rounded-3xl p-6 text-[var(--color-primary)] space-y-5 animate-in zoom-in-95 duration-150"
      >
        {/* Header: WaveForm Branding + Version Transition Badge */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-[var(--color-accent)]/15 border border-[var(--color-accent)]/30 flex items-center justify-center text-[var(--color-accent)] shrink-0 shadow-[0_0_24px_rgba(250,45,72,0.2)]">
              <Sparkles size={20} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 id="waveform-update-modal-title" className="text-base font-bold tracking-tight">
                  WaveForm Update
                </h2>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--color-accent)]/15 border border-[var(--color-accent)]/30 text-[var(--color-accent)]">
                  <span>{currentLabel}</span>
                  <ArrowRight size={11} />
                  <span>{latestLabel}</span>
                </span>
              </div>
              <p className="text-xs text-[var(--color-on-surface-variant)] truncate mt-0.5">
                {state.releaseName || `WaveForm ${latestLabel} is ready to install`}
              </p>
            </div>
          </div>

          {!isLocked && (
            <button
              type="button"
              onClick={handleDismissOrMinimize}
              aria-label={isDownloading ? 'Minimize update dialog' : 'Dismiss update'}
              className="spring-press liquid-glass-pill p-1.5 rounded-full text-[var(--color-on-surface-variant)] hover:text-[var(--color-primary)] transition-colors cursor-pointer shrink-0"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Release Notes */}
        <div className="rounded-2xl bg-black/25 dark:bg-black/35 border border-white/10 p-3.5 max-h-48 overflow-y-auto space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[var(--color-on-surface-variant)]">
            <span>
              {state.updateStrategy === 'direct_patch'
                ? `What's New · Fast Direct Patch${
                    typeof state.deltaChangedCount === 'number'
                      ? ` (${state.deltaChangedCount} files)`
                      : ''
                  }`
                : "What's New"}
            </span>
            {state.assetSize ? (
              <span>{formatMegabytes(state.assetSize)}</span>
            ) : null}
          </div>
          <p className="text-xs leading-relaxed text-[var(--color-primary)]/90 whitespace-pre-wrap break-words">
            {state.releaseNotes?.trim() ||
              'Includes performance improvements, audio engine refinements, and desktop stability updates.'}
          </p>
        </div>

        {/* Live Download Progress */}
        {isDownloading && (
          <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs font-medium">
              <span className="flex items-center gap-1.5 text-[var(--color-primary)]">
                <Download size={14} className="text-[var(--color-accent)] animate-bounce" />
                <span>
                  {state.updateStrategy === 'direct_patch'
                    ? 'Downloading delta patch...'
                    : 'Downloading installer...'}
                </span>
              </span>
              <span className="text-[11px] font-mono text-[var(--color-on-surface-variant)]">
                {formatMegabytes(progress?.bytesDownloaded ?? 0)} /{' '}
                {formatMegabytes(progress?.totalBytes || state.assetSize || 0)} •{' '}
                {percent.toFixed(0)}% • {formatMegabytes(progress?.bytesPerSecond ?? 0)}/s
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-150 ease-out"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )}

        {/* Verifying / Installing Spinner */}
        {isLocked && (
          <div className="rounded-2xl bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/25 p-3.5 flex items-center gap-3">
            {state.status === 'verifying' ? (
              <ShieldCheck size={18} className="text-[var(--color-accent)] shrink-0 animate-pulse" />
            ) : (
              <Loader2 size={18} className="text-[var(--color-accent)] shrink-0 animate-spin" />
            )}
            <div className="min-w-0">
              <div className="text-xs font-semibold text-[var(--color-primary)]">
                {state.status === 'verifying'
                  ? 'Verifying SHA-256 signatures...'
                  : state.updateStrategy === 'direct_patch'
                  ? 'Applying direct patch and relaunching WaveForm...'
                  : 'Installing update and relaunching WaveForm...'}
              </div>
              <div className="text-[11px] text-[var(--color-on-surface-variant)]">
                {state.status === 'verifying'
                  ? state.updateStrategy === 'direct_patch'
                    ? 'Checking patch archive and every modified file against remote manifest.'
                    : 'Checking downloaded installer integrity against SHA256SUMS.txt.'
                  : 'WaveForm will close briefly and reopen automatically on the new version.'}
              </div>
            </div>
          </div>
        )}

        {/* Error State */}
        {isError && state.error && (
          <div className="rounded-2xl bg-red-500/15 border border-red-500/30 p-3.5 flex items-start gap-2.5 text-xs text-red-200">
            <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
            <div className="min-w-0 space-y-1">
              <div className="font-semibold text-red-300">Update could not be completed</div>
              <div className="text-[11px] leading-relaxed break-words">{state.error}</div>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={() => void openReleasePage()}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-on-surface-variant)] hover:text-[var(--color-primary)] transition-colors cursor-pointer"
          >
            <ExternalLink size={13} />
            <span>View on GitHub</span>
          </button>

          <div className="flex items-center gap-2.5">
            {!isLocked && (
              <button
                type="button"
                onClick={handleDismissOrMinimize}
                className="spring-press liquid-glass-pill px-4 py-2 rounded-full text-xs font-semibold text-[var(--color-on-surface-variant)] hover:text-[var(--color-primary)] transition-colors cursor-pointer"
              >
                {isDownloading ? 'Hide' : 'Remind Me Next Launch'}
              </button>
            )}

            {isError ? (
              <button
                type="button"
                onClick={handleRetry}
                className="spring-press inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[var(--color-accent)] hover:brightness-110 text-xs font-semibold text-white shadow-[0_6px_20px_rgba(250,45,72,0.35)] transition-all cursor-pointer"
              >
                <RefreshCw size={13} />
                <span>Retry</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={isDownloading || isLocked}
                onClick={() => void downloadAndInstall()}
                className="spring-press inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[var(--color-accent)] hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none text-xs font-semibold text-white shadow-[0_6px_20px_rgba(250,45,72,0.35)] transition-all cursor-pointer"
              >
                {isDownloading || isLocked ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Download size={13} />
                )}
                <span>
                  {isDownloading
                    ? `Downloading ${percent.toFixed(0)}%`
                    : isLocked
                      ? 'Updating...'
                      : 'One-Click Update Now'}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
