// src/ui/common/LrcEditorModal.tsx
// Interactive LRC editor, tap-to-sync timestamper, file importer, and live per-track offset modal

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Clock, RotateCcw, Save, Upload, Wand2, X } from 'lucide-react';
import type { Song } from '../../models/Song';
import type { ParsedLyrics } from '../../services/LyricsService';
import { LyricsService } from '../../services/LyricsService';
import { useLyricsStore } from '../../state/lyricsStore';
import { useLyricVisualizerStore } from '../../lyricVisualizer/state/lyricVisualizerStore';
import { getPlatformBridge, hasPlatformBridge } from '../../platform/index';

export interface LrcEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  track: Song | null;
  currentLyrics: ParsedLyrics | null;
  currentPositionMs: number;
}

function formatLrcStamp(ms: number): string {
  const safe = Math.max(0, Math.round(Number.isFinite(ms) ? ms : 0));
  const totalSec = Math.floor(safe / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  const centis = Math.floor((safe % 1000) / 10);
  return `[${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}]`;
}

function serializeParsedLyricsToLrc(lyrics: ParsedLyrics | null): string {
  if (!lyrics || !Array.isArray(lyrics.lines) || lyrics.lines.length === 0) return '';
  const hasTiming = lyrics.isSynced !== false && lyrics.type !== 'UNSYNCED';
  return lyrics.lines
    .map((line) => {
      const txt = (line.text || '').trim();
      if (!hasTiming) return txt;
      return `${formatLrcStamp(line.startTimeMs)} ${txt}`;
    })
    .filter(Boolean)
    .join('\n');
}

export const LrcEditorModal: React.FC<LrcEditorModalProps> = ({
  isOpen,
  onClose,
  track,
  currentLyrics,
  currentPositionMs,
}) => {
  const trackKey = track?.videoId || track?.id || '';
  const perSongOffsetsMs = useLyricVisualizerStore((s) => s.perSongOffsetsMs);
  const setSongOffsetMs = useLyricVisualizerStore((s) => s.setSongOffsetMs);
  const resetSongOffsetMs = useLyricVisualizerStore((s) => s.resetSongOffsetMs);
  const reloadLyricsForTrack = useLyricsStore((s) => s.reloadLyricsForTrack);

  const currentOffsetMs = trackKey ? perSongOffsetsMs[trackKey] ?? 0 : 0;

  const [rawText, setRawText] = useState('');
  const [tapSyncActive, setTapSyncActive] = useState(false);
  const [tapLineIndex, setTapLineIndex] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen || !trackKey) return;
    let cancelled = false;
    setStatusMessage(null);
    setTapSyncActive(false);
    setTapLineIndex(0);

    if (hasPlatformBridge('getCustomLyrics')) {
      Promise.resolve(getPlatformBridge().getCustomLyrics(trackKey))
        .then((rec) => {
          if (cancelled) return;
          if (rec?.rawText) {
            setRawText(rec.rawText);
            if (typeof rec.offsetMs === 'number') {
              setSongOffsetMs(rec.offsetMs, trackKey);
            }
          } else {
            setRawText(serializeParsedLyricsToLrc(currentLyrics));
          }
        })
        .catch(() => {
          if (!cancelled) setRawText(serializeParsedLyricsToLrc(currentLyrics));
        });
    } else {
      setRawText(serializeParsedLyricsToLrc(currentLyrics));
    }

    return () => {
      cancelled = true;
    };
  }, [isOpen, trackKey, currentLyrics, setSongOffsetMs]);

  const editorLines = useMemo(() => rawText.split(/\r?\n/), [rawText]);

  const applyOffset = (nextOffsetMs: number) => {
    if (!trackKey) return;
    const clamped = Math.max(-2000, Math.min(2000, Math.round(nextOffsetMs)));
    setSongOffsetMs(clamped, trackKey);
    if (hasPlatformBridge('setCustomLyricsOffset')) {
      void getPlatformBridge().setCustomLyricsOffset(trackKey, clamped).catch(() => {});
    }
  };

  const handleStampLine = () => {
    const lines = rawText.split(/\r?\n/);
    if (lines.length === 0) return;
    let idx = Math.max(0, Math.min(lines.length - 1, tapLineIndex));
    while (idx < lines.length && !lines[idx].trim()) {
      idx++;
    }
    if (idx >= lines.length) {
      setTapSyncActive(false);
      setStatusMessage('All lines timestamped.');
      return;
    }
    const stripped = lines[idx].replace(/^(\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]\s*)+/, '').trim();
    lines[idx] = `${formatLrcStamp(currentPositionMs)} ${stripped}`;
    setRawText(lines.join('\n'));
    const nextIdx = Math.min(lines.length, idx + 1);
    setTapLineIndex(nextIdx);
    if (nextIdx >= lines.length) {
      setTapSyncActive(false);
      setStatusMessage('Reached end of lyrics.');
    }
  };

  useEffect(() => {
    if (!isOpen || !tapSyncActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        handleStampLine();
      } else if (e.key === 'Escape') {
        setTapSyncActive(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!isOpen || !track) return null;

  const handleImportFile = async (file: File) => {
    try {
      const content = await file.text();
      setRawText(content.replace(/\r\n/g, '\n'));
      setTapLineIndex(0);
      setStatusMessage(`Loaded ${file.name} — click Save Override to apply.`);
    } catch {
      setStatusMessage('Could not read selected file.');
    }
  };

  const handleSaveOverride = async () => {
    if (!trackKey) return;
    setIsSaving(true);
    try {
      if (hasPlatformBridge('saveCustomLyrics')) {
        await getPlatformBridge().saveCustomLyrics(trackKey, rawText, currentOffsetMs);
      }
      await reloadLyricsForTrack(track);
      setStatusMessage('Saved custom lyrics override.');
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Failed to save override.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetToProvider = async () => {
    if (!trackKey) return;
    setIsSaving(true);
    try {
      if (hasPlatformBridge('deleteCustomLyrics')) {
        await getPlatformBridge().deleteCustomLyrics(trackKey);
      }
      resetSongOffsetMs(trackKey);
      LyricsService.clearCache();
      await reloadLyricsForTrack(track);
      setStatusMessage('Reset to provider lyrics.');
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Failed to reset lyrics.');
    } finally {
      setIsSaving(false);
    }
  };

  const nextLinePreview =
    tapLineIndex < editorLines.length
      ? editorLines[tapLineIndex]?.replace(/^(\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]\s*)+/, '').trim() || '(blank line)'
      : 'End of lyrics';

  return (
    <div
      data-testid="lrc-editor-modal"
      onClick={onClose}
      className="fixed inset-0 z-[95] bg-black/75 backdrop-blur-md flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="liquid-glass-capsule w-full max-w-2xl rounded-2xl border border-white/15 bg-[#12131c]/95 text-white shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10">
          <div className="min-w-0">
            <h2 className="text-sm font-bold truncate">Lyrics Editor & Sync Timing</h2>
            <p className="text-[11px] text-white/60 truncate">
              {track.title} — {track.artist}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/10 text-white/70 hover:text-white cursor-pointer"
            aria-label="Close Lyrics Editor"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Interactive Timing Offset */}
          <div className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs">
              <Clock size={14} className="text-cyan-300" />
              <span className="font-semibold">Live Sync Offset:</span>
              <span className="font-mono text-cyan-300 font-bold">
                {currentOffsetMs > 0 ? `+${currentOffsetMs}ms` : `${currentOffsetMs}ms`}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
              <button
                type="button"
                onClick={() => applyOffset(currentOffsetMs - 500)}
                className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 cursor-pointer"
              >
                -500ms
              </button>
              <button
                type="button"
                onClick={() => applyOffset(currentOffsetMs - 100)}
                className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 cursor-pointer"
              >
                -100ms
              </button>
              <button
                type="button"
                onClick={() => applyOffset(currentOffsetMs + 100)}
                className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 cursor-pointer"
              >
                +100ms
              </button>
              <button
                type="button"
                onClick={() => applyOffset(currentOffsetMs + 500)}
                className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 cursor-pointer"
              >
                +500ms
              </button>
              <button
                type="button"
                onClick={() => applyOffset(0)}
                className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/15 text-white/75 cursor-pointer"
              >
                0ms
              </button>
            </div>
          </div>

          {/* Tap-to-Sync Toolbar */}
          <div className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex items-center gap-2 text-xs font-semibold">
                <Wand2 size={14} className="text-[#FA2D48]" />
                <span>Tap-to-Sync ({formatLrcStamp(currentPositionMs)})</span>
              </div>
              <p className="text-[11px] text-white/65 truncate">
                Line {Math.min(tapLineIndex + 1, Math.max(1, editorLines.length))}/{Math.max(1, editorLines.length)}: {nextLinePreview}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setTapLineIndex(0);
                  setTapSyncActive((prev) => !prev);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  tapSyncActive
                    ? 'bg-[#FA2D48] text-white'
                    : 'bg-white/10 hover:bg-white/20 text-white'
                }`}
              >
                {tapSyncActive ? 'Stop Tap Mode (Space)' : 'Start Tap-to-Sync'}
              </button>
              {tapSyncActive && (
                <button
                  type="button"
                  onClick={handleStampLine}
                  className="px-3 py-1.5 rounded-lg bg-cyan-500/80 hover:bg-cyan-500 text-black text-xs font-bold cursor-pointer"
                >
                  Stamp Line
                </button>
              )}
            </div>
          </div>

          {/* Raw LRC Textarea */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-white/65">
              <span>Raw .lrc / plain .txt content (or drag & drop a file onto Now Playing)</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".lrc,.txt,text/plain"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleImportFile(f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-white cursor-pointer"
              >
                <Upload size={12} />
                <span>Import .lrc / .txt</span>
              </button>
            </div>
            <textarea
              aria-label="Raw LRC Lyrics Editor"
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              rows={11}
              spellCheck={false}
              placeholder="[00:12.34] Enter LRC lines or plain lyrics..."
              className="w-full p-3 rounded-xl bg-black/50 border border-white/15 focus:border-cyan-400/60 focus:outline-none text-xs font-mono leading-relaxed text-white resize-y"
            />
          </div>

          {statusMessage && (
            <div className="text-xs text-cyan-300 font-medium">{statusMessage}</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 border-t border-white/10 bg-black/30">
          <button
            type="button"
            disabled={isSaving}
            onClick={() => void handleResetToProvider()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/15 disabled:opacity-50 text-xs font-semibold text-white/85 cursor-pointer"
          >
            <RotateCcw size={13} />
            <span>Reset to Provider</span>
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-xs font-semibold text-white/75 cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void handleSaveOverride()}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#FA2D48] hover:brightness-110 disabled:opacity-50 text-xs font-bold text-white cursor-pointer"
            >
              <Save size={13} />
              <span>{isSaving ? 'Saving...' : 'Save Override'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
