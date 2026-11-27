// src/lyricVisualizer/ui/ClipExportModal.tsx
// Liquid Glass 10s / 15s / 30s lyric video clip exporter modal with 9:16 & 16:9 crop presets,
// Detected Chorus vs Current Playhead start point, live progress, video preview, and native save.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Clock,
  Download,
  Film,
  Monitor,
  Play,
  RotateCcw,
  Smartphone,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import {
  LyricClipExporter,
  saveClipBlob,
  type ClipAspectRatio,
  type ClipDurationSec,
  type ClipExportResult,
  type StageCanvasSources,
} from '../export/lyricClipExporter';

export interface ClipExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  getStageCanvases: () => StageCanvasSources;
  registerSyncCompositeHook?: (cb: (() => void) | null) => void;
  getAudioStream?: () => MediaStream | null;
  currentTimeSec: number;
  durationSec: number;
  trackTitle: string;
  trackArtist: string;
  chorusStartSec?: number;
  onSeekTo?: (seconds: number) => void;
}

type StartPointMode = 'chorus' | 'playhead';

const DURATION_OPTIONS: readonly ClipDurationSec[] = [10, 15, 30] as const;

function formatTimeSec(sec: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const mins = Math.floor(safe / 60);
  const rem = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

function sanitizeFileSegment(raw: string): string {
  return raw
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
}

export const ClipExportModal: React.FC<ClipExportModalProps> = ({
  isOpen,
  onClose,
  getStageCanvases,
  registerSyncCompositeHook,
  getAudioStream,
  currentTimeSec,
  durationSec,
  trackTitle,
  trackArtist,
  chorusStartSec,
  onSeekTo,
}) => {
  const hasChorus = typeof chorusStartSec === 'number' && Number.isFinite(chorusStartSec) && chorusStartSec > 0;
  const maxDurationSec = Math.max(1, Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 180);

  const [aspectRatio, setAspectRatio] = useState<ClipAspectRatio>('9:16');
  const [clipDuration, setClipDuration] = useState<ClipDurationSec>(15);
  const [startMode, setStartMode] = useState<StartPointMode>(hasChorus ? 'chorus' : 'playhead');
  const [customStartSec, setCustomStartSec] = useState<number>(
    hasChorus ? Math.min(maxDurationSec, chorusStartSec!) : Math.max(0, Math.min(maxDurationSec, currentTimeSec))
  );

  const [isRecording, setIsRecording] = useState(false);
  const [progressElapsed, setProgressElapsed] = useState(0);
  const [progressPercent, setProgressPercent] = useState(0);
  const [exportResult, setExportResult] = useState<ClipExportResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const exporterRef = useRef<LyricClipExporter | null>(null);
  const resultUrlRef = useRef<string | null>(null);

  // Sync default start point whenever modal opens
  useEffect(() => {
    if (!isOpen) return;
    setErrorMessage(null);
    setSaveMessage(null);
    if (hasChorus && chorusStartSec !== undefined) {
      setStartMode('chorus');
      setCustomStartSec(Math.max(0, Math.min(maxDurationSec, chorusStartSec)));
    } else {
      setStartMode('playhead');
      setCustomStartSec(Math.max(0, Math.min(maxDurationSec, currentTimeSec)));
    }
  }, [isOpen, hasChorus, chorusStartSec, maxDurationSec]);

  // Revoke object URLs & cancel active recording on close/unmount
  useEffect(() => {
    return () => {
      exporterRef.current?.cancel();
      exporterRef.current = null;
      if (resultUrlRef.current && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(resultUrlRef.current);
        resultUrlRef.current = null;
      }
    };
  }, []);

  const defaultFileName = useMemo(() => {
    const artistPart = sanitizeFileSegment(trackArtist) || 'WaveForm';
    const titlePart = sanitizeFileSegment(trackTitle) || 'Lyric Clip';
    const ratioTag = aspectRatio === '9:16' ? '9x16' : '16x9';
    return `${artistPart} - ${titlePart} (${ratioTag} ${clipDuration}s).webm`;
  }, [trackArtist, trackTitle, aspectRatio, clipDuration]);

  if (!isOpen) return null;

  const revokePreviousResult = () => {
    if (resultUrlRef.current && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(resultUrlRef.current);
      resultUrlRef.current = null;
    }
    setExportResult(null);
    setSaveMessage(null);
  };

  const handleClose = () => {
    if (isRecording) {
      exporterRef.current?.cancel();
      exporterRef.current = null;
      setIsRecording(false);
    }
    revokePreviousResult();
    onClose();
  };

  const handleSelectStartMode = (mode: StartPointMode) => {
    setStartMode(mode);
    if (mode === 'chorus' && hasChorus && chorusStartSec !== undefined) {
      setCustomStartSec(Math.max(0, Math.min(maxDurationSec, chorusStartSec)));
    } else {
      setCustomStartSec(Math.max(0, Math.min(maxDurationSec, currentTimeSec)));
    }
  };

  const handleStartRecording = async () => {
    if (isRecording) return;
    setErrorMessage(null);
    setSaveMessage(null);
    revokePreviousResult();

    if (onSeekTo) {
      onSeekTo(Math.max(0, Math.min(maxDurationSec, customStartSec)));
    }

    const exporter = new LyricClipExporter({
      getStageCanvases,
      aspectRatio,
      durationSec: clipDuration,
      audioStream: getAudioStream ? getAudioStream() : null,
      registerSyncCompositeHook,
      fps: 60,
      onProgress: (elapsed, _total, percent) => {
        setProgressElapsed(elapsed);
        setProgressPercent(percent);
      },
    });

    exporterRef.current = exporter;
    setIsRecording(true);
    setProgressElapsed(0);
    setProgressPercent(0);

    try {
      const result = await exporter.start();
      resultUrlRef.current = result.objectUrl;
      setExportResult(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Clip export failed.';
      if (!msg.toLowerCase().includes('cancel')) {
        setErrorMessage(msg);
      }
    } finally {
      exporterRef.current = null;
      setIsRecording(false);
    }
  };

  const handleStopEarly = () => {
    exporterRef.current?.stopEarly();
  };

  const handleCancelRecording = () => {
    exporterRef.current?.cancel();
    exporterRef.current = null;
    setIsRecording(false);
  };

  const handleSaveClip = async () => {
    if (!exportResult || isSaving) return;
    setIsSaving(true);
    setErrorMessage(null);
    setSaveMessage(null);
    try {
      const res = await saveClipBlob(exportResult.blob, defaultFileName);
      if (res.canceled) {
        setSaveMessage('Save dialog canceled.');
      } else if (res.saved) {
        setSaveMessage(res.filePath ? `Saved to ${res.filePath}` : `Saved ${defaultFileName}`);
      } else {
        setErrorMessage('Could not save clip in this environment.');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save clip.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      data-testid="clip-export-modal"
      onClick={handleClose}
      className="fixed inset-0 z-[95] bg-black/75 backdrop-blur-md flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="liquid-glass-capsule w-full max-w-xl rounded-2xl border border-white/15 bg-[#10131e]/92 backdrop-blur-2xl text-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-400/25 to-rose-500/25 border border-white/15 flex items-center justify-center shrink-0">
              <Film size={15} className="text-cyan-300" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold truncate">Export Lyric Clip</h2>
              <p className="text-[11px] text-white/60 truncate">
                {trackTitle || 'Untitled Track'} — {trackArtist || 'WaveForm'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded-full hover:bg-white/10 text-white/70 hover:text-white cursor-pointer"
            aria-label="Close Clip Exporter"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {!exportResult ? (
            <>
              {/* Aspect Ratio Selector */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-white/55">
                  Aspect Ratio
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    disabled={isRecording}
                    onClick={() => setAspectRatio('9:16')}
                    className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all cursor-pointer disabled:opacity-60 ${
                      aspectRatio === '9:16'
                        ? 'bg-cyan-500/20 border-cyan-400/65 text-white shadow-[0_0_20px_rgba(34,211,238,0.18)]'
                        : 'bg-white/[0.04] border-white/10 text-white/75 hover:bg-white/[0.08]'
                    }`}
                  >
                    <Smartphone size={17} className={aspectRatio === '9:16' ? 'text-cyan-300' : 'text-white/50'} />
                    <div className="min-w-0">
                      <div className="text-xs font-bold truncate">9:16 Vertical (Reels / TikTok / Shorts)</div>
                      <div className="text-[10px] text-white/55">720 × 1280 · 60fps</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={isRecording}
                    onClick={() => setAspectRatio('16:9')}
                    className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all cursor-pointer disabled:opacity-60 ${
                      aspectRatio === '16:9'
                        ? 'bg-cyan-500/20 border-cyan-400/65 text-white shadow-[0_0_20px_rgba(34,211,238,0.18)]'
                        : 'bg-white/[0.04] border-white/10 text-white/75 hover:bg-white/[0.08]'
                    }`}
                  >
                    <Monitor size={17} className={aspectRatio === '16:9' ? 'text-cyan-300' : 'text-white/50'} />
                    <div className="min-w-0">
                      <div className="text-xs font-bold truncate">16:9 Widescreen</div>
                      <div className="text-[10px] text-white/55">1280 × 720 · 60fps</div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Start Point Selector & Quick Scrubber */}
              <div className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-white/60 flex items-center gap-1.5">
                    <Clock size={12} className="text-cyan-300" />
                    <span>Start Point</span>
                  </span>
                  <span className="text-xs font-mono font-bold text-cyan-300">
                    {formatTimeSec(customStartSec)} / {formatTimeSec(maxDurationSec)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={isRecording || !hasChorus}
                    onClick={() => handleSelectStartMode('chorus')}
                    className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                      startMode === 'chorus' && hasChorus
                        ? 'bg-rose-500/25 border-rose-400/65 text-white'
                        : 'bg-white/5 border-white/10 text-white/75 hover:bg-white/10'
                    }`}
                  >
                    <Sparkles size={13} />
                    <span>
                      Detected Chorus{hasChorus && chorusStartSec !== undefined ? ` (${formatTimeSec(chorusStartSec)})` : ''}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={isRecording}
                    onClick={() => handleSelectStartMode('playhead')}
                    className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60 ${
                      startMode === 'playhead'
                        ? 'bg-cyan-500/25 border-cyan-400/65 text-white'
                        : 'bg-white/5 border-white/10 text-white/75 hover:bg-white/10'
                    }`}
                  >
                    <Play size={13} />
                    <span>Current Playhead ({formatTimeSec(currentTimeSec)})</span>
                  </button>
                </div>

                {/* Quick Start-Time Scrubber */}
                <div className="flex items-center gap-2.5">
                  <input
                    aria-label="Clip Start Time Scrubber"
                    type="range"
                    min={0}
                    max={maxDurationSec}
                    step={0.5}
                    disabled={isRecording}
                    value={customStartSec}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setCustomStartSec(val);
                      onSeekTo?.(val);
                    }}
                    className="flex-1 accent-cyan-400 cursor-pointer disabled:opacity-50"
                  />
                </div>
              </div>

              {/* Duration Selector */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-white/55">
                  Clip Duration
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {DURATION_OPTIONS.map((dur) => {
                    const active = clipDuration === dur;
                    return (
                      <button
                        key={dur}
                        type="button"
                        disabled={isRecording}
                        onClick={() => setClipDuration(dur)}
                        className={`py-2 rounded-xl border text-xs font-bold transition-all cursor-pointer disabled:opacity-60 ${
                          active
                            ? 'bg-white text-black border-white shadow-lg'
                            : 'bg-white/5 border-white/10 text-white/75 hover:bg-white/10'
                        }`}
                      >
                        {dur}s{dur === 15 ? ' · Recommended' : ''}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Live Recording Progress */}
              {isRecording && (
                <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-400/35 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 font-semibold text-rose-200">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
                      <span>Capturing 60fps Stage + Audio...</span>
                    </span>
                    <span className="font-mono font-bold text-white">
                      {progressElapsed.toFixed(1)}s / {clipDuration}s ({progressPercent}%)
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-black/50 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-rose-500 to-cyan-400 transition-all duration-100"
                      style={{ width: `${Math.max(2, progressPercent)}%` }}
                    />
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Post-Capture Preview */
            <div className="space-y-3">
              <div className="rounded-xl overflow-hidden bg-black/70 border border-white/15 flex items-center justify-center p-2">
                <video
                  controls
                  playsInline
                  autoPlay
                  loop
                  src={exportResult.objectUrl}
                  className="max-h-[340px] w-auto rounded-lg object-contain"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/65 px-1">
                <span>
                  {exportResult.width} × {exportResult.height} · {exportResult.durationSec.toFixed(1)}s
                </span>
                <span className="font-mono text-white/50 truncate max-w-[260px]">
                  {exportResult.mimeType}
                </span>
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="p-2.5 rounded-lg bg-rose-500/15 border border-rose-400/40 text-xs text-rose-200">
              {errorMessage}
            </div>
          )}

          {saveMessage && (
            <div className="p-2.5 rounded-lg bg-emerald-500/15 border border-emerald-400/40 text-xs text-emerald-200 flex items-center gap-1.5">
              <Check size={14} />
              <span className="truncate">{saveMessage}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 border-t border-white/10 bg-black/30">
          {exportResult ? (
            <>
              <button
                type="button"
                onClick={revokePreviousResult}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/10 hover:bg-white/15 text-xs font-semibold text-white cursor-pointer"
              >
                <RotateCcw size={13} />
                <span>New Clip</span>
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-3.5 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-xs font-semibold text-white/75 cursor-pointer"
                >
                  Done
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => void handleSaveClip()}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-cyan-400 hover:brightness-110 disabled:opacity-50 text-xs font-bold text-black cursor-pointer"
                >
                  <Download size={13} />
                  <span>{isSaving ? 'Saving...' : 'Save Clip...'}</span>
                </button>
              </div>
            </>
          ) : isRecording ? (
            <>
              <button
                type="button"
                onClick={handleCancelRecording}
                className="px-3.5 py-1.5 rounded-full bg-white/10 hover:bg-white/15 text-xs font-semibold text-white/80 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleStopEarly}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-rose-500 hover:brightness-110 text-xs font-bold text-white cursor-pointer"
              >
                <Square size={12} />
                <span>Stop Early</span>
              </button>
            </>
          ) : (
            <>
              <span className="text-[11px] text-white/50 truncate max-w-[240px]">
                {defaultFileName}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-3.5 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-xs font-semibold text-white/75 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleStartRecording()}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#FA2D48] hover:brightness-110 text-xs font-bold text-white cursor-pointer"
                >
                  <Film size={13} />
                  <span>Record {clipDuration}s Clip</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
