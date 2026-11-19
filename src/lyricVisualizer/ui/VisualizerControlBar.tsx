// src/lyricVisualizer/ui/VisualizerControlBar.tsx
// Hoverable control bar and expandable settings popover for LyricVisualizer:
// 13 visual styles, 7 bundled OFL fonts, typography scale (0.7x..1.8x),
// per-song timing nudge (-2000..+2000ms, +/-50ms + Reset), OKLCH color match,
// audio-reactive toggle, multi-monitor desktop overlay, fullscreen ambient mode,
// and Starlight Harbor sandbox demo controls.

import React, { useEffect, useState } from 'react';
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  Lock,
  Maximize2,
  Monitor,
  Palette,
  Play,
  Pause,
  RefreshCw,
  RotateCcw,
  Shield,
  Sliders,
  Sparkles,
  Type,
  Unlock,
} from 'lucide-react';
import {
  BUNDLED_FONTS,
  type BundledFontId,
  getBundledFontCssFamily,
  VISUAL_STYLE_DEFINITIONS,
  type VisualStyleId,
} from '../core';
import {
  IDLE_AMBIENT_OPTIONS,
  MAX_FONT_SIZE_SCALE,
  MAX_OVERLAY_OPACITY,
  MIN_FONT_SIZE_SCALE,
  MIN_OVERLAY_OPACITY,
  OFFSET_STEP_MS,
  useLyricVisualizerStore,
} from '../state/lyricVisualizerStore';
import { getSharedWaveFormPlaybackBridge } from '../bridge/waveFormPlaybackBridge';

export interface VisualizerControlBarProps {
  className?: string;
  compact?: boolean;
  onSwitchToClassic?: () => void;
}

const IDLE_LABELS: Record<number, string> = {
  0: 'Off',
  30: '30s',
  60: '60s',
  120: '120s',
  300: '300s',
};

export const VisualizerControlBar: React.FC<VisualizerControlBarProps> = ({
  className = '',
  compact = false,
  onSwitchToClassic,
}) => {
  const [expandedPanel, setExpandedPanel] = useState<'none' | 'typography' | 'overlay' | 'ambient'>('none');
  const [sandboxPlaying, setSandboxPlaying] = useState(true);

  const config = useLyricVisualizerStore((s) => s.config);
  const currentSongOffsetMs = useLyricVisualizerStore((s) => s.currentSongOffsetMs);
  const availableMonitors = useLyricVisualizerStore((s) => s.availableMonitors);

  const setStyleId = useLyricVisualizerStore((s) => s.setStyleId);
  const cycleStyle = useLyricVisualizerStore((s) => s.cycleStyle);
  const setFontId = useLyricVisualizerStore((s) => s.setFontId);
  const setFontSizeScale = useLyricVisualizerStore((s) => s.setFontSizeScale);
  const setAlbumArtColorMatch = useLyricVisualizerStore((s) => s.setAlbumArtColorMatch);
  const setAudioReactive = useLyricVisualizerStore((s) => s.setAudioReactive);
  const setReduceMotion = useLyricVisualizerStore((s) => s.setReduceMotion);

  const nudgeSongOffsetMs = useLyricVisualizerStore((s) => s.nudgeSongOffsetMs);
  const setSongOffsetMs = useLyricVisualizerStore((s) => s.setSongOffsetMs);
  const resetSongOffsetMs = useLyricVisualizerStore((s) => s.resetSongOffsetMs);

  const setOverlayEnabled = useLyricVisualizerStore((s) => s.setOverlayEnabled);
  const toggleOverlayMonitor = useLyricVisualizerStore((s) => s.toggleOverlayMonitor);
  const setOverlayOpacity = useLyricVisualizerStore((s) => s.setOverlayOpacity);
  const setOverlayLocked = useLyricVisualizerStore((s) => s.setOverlayLocked);
  const refreshMonitors = useLyricVisualizerStore((s) => s.refreshMonitors);

  const openAmbientMode = useLyricVisualizerStore((s) => s.openAmbientMode);
  const setIdleAmbientSeconds = useLyricVisualizerStore((s) => s.setIdleAmbientSeconds);
  const setKeepAwakeInAmbient = useLyricVisualizerStore((s) => s.setKeepAwakeInAmbient);
  const setGameGuardEnabled = useLyricVisualizerStore((s) => s.setGameGuardEnabled);
  const setSandboxEnabled = useLyricVisualizerStore((s) => s.setSandboxEnabled);

  useEffect(() => {
    refreshMonitors().catch(() => {});
  }, [refreshMonitors]);

  useEffect(() => {
    const bridge = getSharedWaveFormPlaybackBridge();
    setSandboxPlaying(bridge.currentSnapshot.isPlaying);
    const unsub = bridge.onPlaybackStateChanged((playing) => {
      setSandboxPlaying(playing);
    });
    return unsub;
  }, [config.sandboxEnabled]);

  const togglePanel = (panel: 'typography' | 'overlay' | 'ambient') => {
    setExpandedPanel((prev) => (prev === panel ? 'none' : panel));
  };

  const formattedOffset =
    currentSongOffsetMs > 0
      ? `+${currentSongOffsetMs}ms`
      : `${currentSongOffsetMs}ms`;

  const bridge = getSharedWaveFormPlaybackBridge();

  return (
    <div
      style={{ fontFamily: 'Inter, "Segoe UI", sans-serif' }}
      className={`flex flex-col gap-2 select-none ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Expandable Settings Popover Drawer */}
      {expandedPanel !== 'none' && (
        <div className="rounded-2xl bg-neutral-950/90 border border-white/15 backdrop-blur-2xl p-3.5 text-xs text-white shadow-2xl space-y-3">
          {expandedPanel === 'typography' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <span className="font-semibold text-white/90 flex items-center gap-1.5">
                  <Type size={13} />
                  <span>Typography, Sync & Visuals</span>
                </span>
                <span className="text-[10px] text-white/50">7 Bundled OFL Fonts</span>
              </div>

              {/* Font Selector & Size Scale */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-white/65">Font Family (OFL)</span>
                  <select
                    aria-label="Font Family"
                    value={config.fontId}
                    onChange={(e) => setFontId(e.target.value as BundledFontId)}
                    style={{ fontFamily: getBundledFontCssFamily(config.fontId) }}
                    className="bg-white/10 border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-white/40 cursor-pointer"
                  >
                    {BUNDLED_FONTS.map((f) => (
                      <option key={f.id} value={f.id} className="bg-neutral-900 text-white">
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-[11px] text-white/65">
                    <span>Size Scale</span>
                    <span className="font-mono text-white">{config.fontSizeScale.toFixed(2)}x</span>
                  </div>
                  <input
                    aria-label="Font Size Scale"
                    type="range"
                    min={MIN_FONT_SIZE_SCALE}
                    max={MAX_FONT_SIZE_SCALE}
                    step="0.05"
                    value={config.fontSizeScale}
                    onChange={(e) => setFontSizeScale(parseFloat(e.target.value))}
                    className="w-full h-1.5 accent-cyan-400 bg-white/20 rounded-lg cursor-pointer mt-1.5"
                  />
                </label>
              </div>

              {/* Per-Song Timing Offset Nudge (-2000..+2000ms) */}
              <div className="flex flex-col gap-1.5 pt-1 border-t border-white/10">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-white/65 flex items-center gap-1">
                    <Clock size={12} />
                    <span>Per-Song Timing Offset (-2000ms to +2000ms)</span>
                  </span>
                  <span className="font-mono text-[11px] font-bold text-cyan-300">
                    {formattedOffset}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => nudgeSongOffsetMs(-OFFSET_STEP_MS)}
                    className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 font-mono text-[11px] cursor-pointer transition-colors"
                    title="Nudge lyrics 50ms earlier"
                  >
                    -50ms
                  </button>
                  <input
                    aria-label="Per-Song Timing Offset"
                    type="range"
                    min={-2000}
                    max={2000}
                    step={OFFSET_STEP_MS}
                    value={currentSongOffsetMs}
                    onChange={(e) => setSongOffsetMs(parseInt(e.target.value, 10))}
                    className="flex-1 h-1.5 accent-cyan-400 bg-white/20 rounded-lg cursor-pointer"
                  />
                  <button
                    type="button"
                    onClick={() => nudgeSongOffsetMs(OFFSET_STEP_MS)}
                    className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 font-mono text-[11px] cursor-pointer transition-colors"
                    title="Nudge lyrics 50ms later"
                  >
                    +50ms
                  </button>
                  <button
                    type="button"
                    onClick={() => resetSongOffsetMs()}
                    className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 text-[11px] flex items-center gap-1 cursor-pointer transition-colors"
                    title="Reset song timing offset to 0ms"
                  >
                    <RotateCcw size={11} />
                    <span>Reset</span>
                  </button>
                </div>
              </div>

              {/* OKLCH Color Match, Audio Reactive & Reduce Motion Toggles */}
              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setAlbumArtColorMatch(!config.albumArtColorMatch)}
                  className={`px-2.5 py-1 rounded-lg border text-[11px] flex items-center gap-1.5 cursor-pointer transition-colors ${
                    config.albumArtColorMatch
                      ? 'bg-cyan-500/25 border-cyan-400/50 text-cyan-200'
                      : 'bg-white/5 border-white/10 text-white/60 hover:text-white'
                  }`}
                >
                  <Palette size={12} />
                  <span>Album-Art OKLCH Match</span>
                </button>

                <button
                  type="button"
                  onClick={() => setAudioReactive(!config.audioReactive)}
                  className={`px-2.5 py-1 rounded-lg border text-[11px] flex items-center gap-1.5 cursor-pointer transition-colors ${
                    config.audioReactive
                      ? 'bg-emerald-500/25 border-emerald-400/50 text-emerald-200'
                      : 'bg-white/5 border-white/10 text-white/60 hover:text-white'
                  }`}
                >
                  <Activity size={12} />
                  <span>Audio-Reactive FFT</span>
                </button>

                <button
                  type="button"
                  onClick={() => setReduceMotion(!config.reduceMotion)}
                  className={`px-2.5 py-1 rounded-lg border text-[11px] flex items-center gap-1.5 cursor-pointer transition-colors ${
                    config.reduceMotion
                      ? 'bg-amber-500/25 border-amber-400/50 text-amber-200'
                      : 'bg-white/5 border-white/10 text-white/60 hover:text-white'
                  }`}
                >
                  <Eye size={12} />
                  <span>Reduce Motion</span>
                </button>
              </div>
            </div>
          )}

          {expandedPanel === 'overlay' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <span className="font-semibold text-white/90 flex items-center gap-1.5">
                  <Monitor size={13} />
                  <span>Multi-Monitor Desktop Overlay</span>
                </span>
                <button
                  type="button"
                  onClick={() => refreshMonitors()}
                  className="p-1 rounded-md bg-white/10 hover:bg-white/20 text-white/75 hover:text-white cursor-pointer"
                  title="Refresh Connected Displays"
                >
                  <RefreshCw size={12} />
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setOverlayEnabled(!config.overlayEnabled)}
                  className={`px-3 py-1.5 rounded-lg border font-semibold text-xs flex items-center gap-1.5 cursor-pointer transition-colors ${
                    config.overlayEnabled
                      ? 'bg-cyan-500/30 border-cyan-400/60 text-cyan-100'
                      : 'bg-white/10 border-white/15 text-white/75 hover:text-white'
                  }`}
                >
                  <Monitor size={13} />
                  <span>{config.overlayEnabled ? 'Desktop Overlay Active' : 'Enable Desktop Overlay'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setOverlayLocked(!config.overlayLocked)}
                  className={`px-3 py-1.5 rounded-lg border text-xs flex items-center gap-1.5 cursor-pointer transition-colors ${
                    config.overlayLocked
                      ? 'bg-amber-500/25 border-amber-400/50 text-amber-100'
                      : 'bg-white/10 border-white/15 text-white/75 hover:text-white'
                  }`}
                  title="When locked, overlay is 100% click-through with zero window chrome"
                >
                  {config.overlayLocked ? <Lock size={13} /> : <Unlock size={13} />}
                  <span>{config.overlayLocked ? 'Click-Through Locked' : 'Unlocked (Interactive)'}</span>
                </button>
              </div>

              {/* Monitor Checkboxes */}
              <div className="space-y-1">
                <span className="text-[11px] text-white/60">Target Displays</span>
                <div className="flex flex-wrap gap-1.5">
                  {availableMonitors.map((m) => {
                    const selected = config.overlayMonitorIds.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => toggleOverlayMonitor(m.id)}
                        className={`px-2.5 py-1 rounded-lg border text-[11px] cursor-pointer transition-colors ${
                          selected
                            ? 'bg-cyan-500/25 border-cyan-400/60 text-white'
                            : 'bg-white/5 border-white/10 text-white/60 hover:text-white'
                        }`}
                      >
                        {m.label}
                        {m.isPrimary ? ' (Primary)' : ''}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Overlay Opacity Slider */}
              <label className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[11px] text-white/65">
                  <span>Overlay Opacity</span>
                  <span className="font-mono text-white">{Math.round(config.overlayOpacity * 100)}%</span>
                </div>
                <input
                  aria-label="Overlay Opacity"
                  type="range"
                  min={MIN_OVERLAY_OPACITY}
                  max={MAX_OVERLAY_OPACITY}
                  step="0.05"
                  value={config.overlayOpacity}
                  onChange={(e) => setOverlayOpacity(parseFloat(e.target.value))}
                  className="w-full h-1.5 accent-cyan-400 bg-white/20 rounded-lg cursor-pointer"
                />
              </label>
            </div>
          )}

          {expandedPanel === 'ambient' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <span className="font-semibold text-white/90 flex items-center gap-1.5">
                  <Maximize2 size={13} />
                  <span>Fullscreen Ambient Mode & Guards</span>
                </span>
                <button
                  type="button"
                  onClick={() => openAmbientMode()}
                  className="px-2.5 py-1 rounded-lg bg-cyan-500/30 hover:bg-cyan-500/40 border border-cyan-400/50 text-cyan-100 font-semibold text-[11px] cursor-pointer"
                >
                  Launch Ambient Takeover
                </button>
              </div>

              {/* Idle Auto-Trigger Selector */}
              <div className="space-y-1">
                <span className="text-[11px] text-white/65">Auto-Open Ambient on System Idle</span>
                <div className="flex flex-wrap gap-1.5">
                  {IDLE_AMBIENT_OPTIONS.map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => setIdleAmbientSeconds(sec)}
                      className={`px-2.5 py-1 rounded-lg border text-[11px] cursor-pointer transition-colors ${
                        config.idleAmbientSeconds === sec
                          ? 'bg-cyan-500/25 border-cyan-400/60 text-white font-semibold'
                          : 'bg-white/5 border-white/10 text-white/60 hover:text-white'
                      }`}
                    >
                      {IDLE_LABELS[sec]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Keep-Awake & Fullscreen Game Guard */}
              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setKeepAwakeInAmbient(!config.keepAwakeInAmbient)}
                  className={`px-2.5 py-1 rounded-lg border text-[11px] flex items-center gap-1.5 cursor-pointer transition-colors ${
                    config.keepAwakeInAmbient
                      ? 'bg-emerald-500/25 border-emerald-400/50 text-emerald-100'
                      : 'bg-white/5 border-white/10 text-white/60 hover:text-white'
                  }`}
                >
                  <Eye size={12} />
                  <span>Keep Display Awake in Ambient</span>
                </button>

                <button
                  type="button"
                  onClick={() => setGameGuardEnabled(!config.gameGuardEnabled)}
                  className={`px-2.5 py-1 rounded-lg border text-[11px] flex items-center gap-1.5 cursor-pointer transition-colors ${
                    config.gameGuardEnabled
                      ? 'bg-purple-500/25 border-purple-400/50 text-purple-100'
                      : 'bg-white/5 border-white/10 text-white/60 hover:text-white'
                  }`}
                  title="Auto-suspend overlays & idle ambient when a fullscreen D3D game or presentation is active"
                >
                  <Shield size={12} />
                  <span>Fullscreen Game Guard (D3D)</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Primary Compact Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-2xl bg-neutral-950/80 border border-white/15 backdrop-blur-xl shadow-lg">
        {/* Left Cluster: 13 Visual Styles Switcher */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => cycleStyle(-1)}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-white/80 hover:text-white cursor-pointer transition-colors"
            title="Previous Visual Style"
            aria-label="Previous Visual Style"
          >
            <ChevronLeft size={14} />
          </button>

          <select
            aria-label="Visual Style"
            value={config.styleId}
            onChange={(e) => setStyleId(e.target.value as VisualStyleId)}
            className="bg-white/10 hover:bg-white/15 border border-white/15 rounded-lg px-2.5 py-1 text-xs font-semibold text-white focus:outline-none cursor-pointer"
          >
            {VISUAL_STYLE_DEFINITIONS.map((style, idx) => (
              <option key={style.id} value={style.id} className="bg-neutral-900 text-white">
                {idx + 1}. {style.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => cycleStyle(1)}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-white/80 hover:text-white cursor-pointer transition-colors"
            title="Next Visual Style"
            aria-label="Next Visual Style"
          >
            <ChevronRight size={14} />
          </button>
        </div>

        {/* Center/Right Cluster: Quick Action Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Typography & Offset Drawer Toggle */}
          <button
            type="button"
            onClick={() => togglePanel('typography')}
            className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-colors ${
              expandedPanel === 'typography'
                ? 'bg-white/20 border-white/40 text-white'
                : 'bg-white/5 border-white/10 text-white/75 hover:text-white'
            }`}
            title="Typography, 7 OFL Fonts & Per-Song Timing Offset"
          >
            <Sliders size={12} />
            {!compact && <span>Style & Sync</span>}
            {currentSongOffsetMs !== 0 && (
              <span className="font-mono text-[10px] text-cyan-300">({formattedOffset})</span>
            )}
          </button>

          {/* Desktop Overlay Drawer Toggle */}
          <button
            type="button"
            onClick={() => togglePanel('overlay')}
            className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-colors ${
              config.overlayEnabled || expandedPanel === 'overlay'
                ? 'bg-cyan-500/25 border-cyan-400/50 text-cyan-100'
                : 'bg-white/5 border-white/10 text-white/75 hover:text-white'
            }`}
            title="Multi-Monitor Transparent Desktop Overlay"
          >
            <Monitor size={12} />
            {!compact && <span>Overlay</span>}
          </button>

          {/* Ambient Mode Drawer Toggle */}
          <button
            type="button"
            onClick={() => togglePanel('ambient')}
            className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-colors ${
              expandedPanel === 'ambient'
                ? 'bg-white/20 border-white/40 text-white'
                : 'bg-white/5 border-white/10 text-white/75 hover:text-white'
            }`}
            title="Fullscreen Ambient Mode, Idle Trigger & Game Guard"
          >
            <Maximize2 size={12} />
            {!compact && <span>Ambient</span>}
          </button>

          {/* Sandbox "Starlight Harbor" Toggle */}
          <button
            type="button"
            onClick={() => setSandboxEnabled(!config.sandboxEnabled)}
            className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
              config.sandboxEnabled
                ? 'bg-amber-500/30 border-amber-400/60 text-amber-100'
                : 'bg-white/5 border-white/10 text-white/75 hover:text-white'
            }`}
            title='Toggle built-in "Starlight Harbor" Original Sandbox Demo'
          >
            <Sparkles size={12} />
            <span>Sandbox</span>
          </button>

          {/* Sandbox Play/Pause & Restart Controls when active */}
          {config.sandboxEnabled && (
            <div className="flex items-center gap-1 pl-1 border-l border-white/15">
              <button
                type="button"
                onClick={() => bridge.togglePlay()}
                className="p-1 rounded-md bg-amber-500/20 hover:bg-amber-500/35 text-amber-100 cursor-pointer"
                title={sandboxPlaying ? 'Pause Sandbox Demo' : 'Play Sandbox Demo'}
              >
                {sandboxPlaying ? <Pause size={12} /> : <Play size={12} />}
              </button>
              <button
                type="button"
                onClick={() => bridge.seek(0)}
                className="p-1 rounded-md bg-amber-500/20 hover:bg-amber-500/35 text-amber-100 cursor-pointer"
                title="Restart Starlight Harbor Demo"
              >
                <RotateCcw size={12} />
              </button>
            </div>
          )}

          {onSwitchToClassic && (
            <button
              type="button"
              onClick={onSwitchToClassic}
              className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 border border-white/15 text-[11px] text-white/80 hover:text-white cursor-pointer transition-colors"
              title="Switch to Classic Scrollable Lyrics View"
            >
              Classic View
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
