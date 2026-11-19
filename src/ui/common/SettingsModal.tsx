// src/ui/common/SettingsModal.tsx
// Comprehensive desktop modal exposing typed settings across 7 subsystems + Accounts

import React, { useState, useEffect } from 'react';
import {
  X,
  Search,
  RotateCcw,
  Sliders,
  Palette,
  Volume2,
  Music2,
  HardDrive,
  Radio,
  Monitor,
  Check,
  User,
  FolderOpen,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useSettingsStore } from '../../state/settingsStore';
import { useLibraryStore } from '../../state/libraryStore';
import { usePlayerStore } from '../../state/playerStore';
import { FACTORY_EQ_PRESETS } from '../../audio/DspChain';
import { LocalMediaScanner } from '../../services/LocalMediaScanner';
import {
  AccountAuthService,
  type AccountAuthStatus,
  type AccountProvider,
} from '../../services/AccountAuthService';
import type { AppSettings } from '../../models/Settings';

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsTab =
  | 'appearance'
  | 'playback'
  | 'dsp'
  | 'lyrics'
  | 'storage'
  | 'accounts'
  | 'integrations'
  | 'ergonomics';

interface SettingEntry {
  id: string;
  tab: SettingsTab;
  title: string;
  description: string;
  keywords?: string;
  control: React.ReactNode;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const [searchQuery, setSearchQuery] = useState('');
  const [savedNotice, setSavedNotice] = useState(false);
  const [replayResetNotice, setReplayResetNotice] = useState(false);
  const [authStatus, setAuthStatus] = useState<AccountAuthStatus>({
    ytmusic: { connected: false },
    spotify: { connected: false },
  });
  const [authBusy, setAuthBusy] = useState<AccountProvider | null>(null);

  const { settings, updateSettings, resetToDefaults } = useSettingsStore();
  const resetListeningData = useLibraryStore((s) => s.resetListeningData);
  const startLocalMediaScan = useLibraryStore((s) => s.startLocalMediaScan);

  useEffect(() => {
    if (!isOpen) return;
    AccountAuthService.getAccountAuthStatus()
      .then((status) => setAuthStatus(status))
      .catch(() => {});
  }, [isOpen]);

  if (!isOpen) return null;

  const flashSaved = () => {
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 800);
  };

  const handleUpdate = async (delta: Partial<AppSettings>) => {
    await updateSettings(delta);
    flashSaved();
  };

  const handleBrowseFolder = async () => {
    const picker = (window as any)?.electronAPI?.selectLocalFolder;
    if (typeof picker !== 'function') return;
    try {
      const result = await picker();
      const folderPath =
        typeof result === 'string'
          ? result
          : result && !result.canceled
            ? result.folderPath
            : undefined;
      if (!folderPath) return;

      const existing = Array.isArray(settings['storage.localFolders'])
        ? settings['storage.localFolders']
        : [];
      const nextFolders = existing.includes(folderPath) ? existing : [...existing, folderPath];
      await handleUpdate({ 'storage.localFolders': nextFolders });
      await startLocalMediaScan(LocalMediaScanner, folderPath);
    } catch (err) {
      console.warn('[SettingsModal] selectLocalFolder failed:', err);
    }
  };

  const handleRemoveFolder = async (folder: string) => {
    const existing = Array.isArray(settings['storage.localFolders'])
      ? settings['storage.localFolders']
      : [];
    await handleUpdate({ 'storage.localFolders': existing.filter((f) => f !== folder) });
  };

  const handleResetReplay = async () => {
    await resetListeningData();
    setReplayResetNotice(true);
    setTimeout(() => setReplayResetNotice(false), 1800);
  };

  const handleAccountLogin = async (provider: AccountProvider) => {
    setAuthBusy(provider);
    try {
      const res =
        provider === 'ytmusic'
          ? await AccountAuthService.loginYouTubeMusic()
          : await AccountAuthService.loginSpotify();
      const updated = await AccountAuthService.getAccountAuthStatus().catch(() => null);
      if (updated) {
        setAuthStatus(updated);
      } else {
        setAuthStatus((prev) => ({ ...prev, [provider]: res }));
      }
    } finally {
      setAuthBusy(null);
    }
  };

  const handleAccountLogout = async (provider: AccountProvider) => {
    setAuthBusy(provider);
    try {
      await AccountAuthService.logoutAccount(provider);
      const updated = await AccountAuthService.getAccountAuthStatus().catch(() => null);
      if (updated) {
        setAuthStatus(updated);
      } else {
        setAuthStatus((prev) => ({ ...prev, [provider]: { connected: false } }));
      }
    } finally {
      setAuthBusy(null);
    }
  };

  const navTabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'appearance', label: 'Appearance', icon: <Palette size={16} /> },
    { id: 'playback', label: 'Audio & Playback', icon: <Volume2 size={16} /> },
    { id: 'dsp', label: 'Equalizer & DSP', icon: <Sliders size={16} /> },
    { id: 'lyrics', label: 'Lyrics Engine', icon: <Music2 size={16} /> },
    { id: 'storage', label: 'Local Library & Storage', icon: <HardDrive size={16} /> },
    { id: 'accounts', label: 'Accounts', icon: <User size={16} /> },
    { id: 'integrations', label: 'Scrobble & Discord', icon: <Radio size={16} /> },
    { id: 'ergonomics', label: 'Desktop Ergonomics', icon: <Monitor size={16} /> },
  ];

  const isDynamicAccent =
    settings['appearance.accentColorMode'] === 'dynamic' ||
    settings['appearance.accentColor'] === 'dynamic';

  const entries: SettingEntry[] = [
    // Appearance
    {
      id: 'themeMode',
      tab: 'appearance',
      title: 'Theme Mode',
      description: 'Select light, dark, or follow system theme',
      keywords: 'dark light system theme',
      control: (
        <select
          value={settings['appearance.themeMode']}
          onChange={(e) => handleUpdate({ 'appearance.themeMode': e.target.value as any })}
          className="px-3 py-1.5 rounded-lg bg-[var(--color-surface-variant)] border border-[var(--color-outline)] text-xs text-[var(--color-primary)]"
        >
          <option value="dark">Dark (#000000)</option>
          <option value="light">Light (#FFFFFF)</option>
          <option value="system">Follow System</option>
        </select>
      ),
    },
    {
      id: 'accentColor',
      tab: 'appearance',
      title: 'Accent Color',
      description: 'Use a custom highlight color or adapt dynamically to the current album cover',
      keywords: 'accent color dynamic album cover pink theme',
      control: (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              handleUpdate({
                'appearance.accentColorMode': isDynamicAccent ? 'custom' : 'dynamic',
              })
            }
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
              isDynamicAccent
                ? 'bg-[var(--color-accent)] text-white border-transparent'
                : 'bg-[var(--color-surface-variant)] text-[var(--color-primary)] border-[var(--color-outline)] hover:border-[var(--color-accent)]'
            }`}
          >
            <Sparkles size={13} />
            <span>Dynamic (Album Cover)</span>
          </button>
          <input
            type="color"
            value={
              settings['appearance.accentColor'] === 'dynamic'
                ? '#FA2D48'
                : settings['appearance.accentColor']
            }
            onChange={(e) =>
              handleUpdate({
                'appearance.accentColor': e.target.value,
                'appearance.accentColorMode': 'custom',
              })
            }
            className="w-7 h-7 rounded border border-[var(--color-outline)] cursor-pointer"
          />
          <span className="text-xs font-mono">
            {isDynamicAccent ? 'Dynamic' : settings['appearance.accentColor']}
          </span>
        </div>
      ),
    },
    {
      id: 'acrylicBlur',
      tab: 'appearance',
      title: 'Windows 11 Acrylic Blur',
      description: 'Enable frosted glass background composition',
      keywords: 'acrylic blur frosted glass',
      control: (
        <input
          type="checkbox"
          checked={settings['appearance.acrylicBlurEnabled']}
          onChange={(e) => handleUpdate({ 'appearance.acrylicBlurEnabled': e.target.checked })}
          className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
        />
      ),
    },
    {
      id: 'liquidGlass',
      tab: 'appearance',
      title: 'Liquid Glass Controls',
      description: 'Specular gloss on playback buttons and sliders',
      keywords: 'liquid glass specular gloss',
      control: (
        <input
          type="checkbox"
          checked={settings['appearance.liquidGlassControls']}
          onChange={(e) => handleUpdate({ 'appearance.liquidGlassControls': e.target.checked })}
          className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
        />
      ),
    },
    {
      id: 'dynamicArtworkColor',
      tab: 'appearance',
      title: 'Dynamic Artwork Color Background',
      description: 'Tint ambient backdrop with album cover palette',
      keywords: 'dynamic artwork background ambient tint',
      control: (
        <input
          type="checkbox"
          checked={settings['appearance.dynamicArtworkColor']}
          onChange={(e) => handleUpdate({ 'appearance.dynamicArtworkColor': e.target.checked })}
          className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
        />
      ),
    },
    {
      id: 'ambientBackdropGlow',
      tab: 'appearance',
      title: 'Ambient Backdrop Glow',
      description: 'Show soft ambient color mesh behind the workspace',
      keywords: 'ambient glow backdrop',
      control: (
        <input
          type="checkbox"
          checked={settings['appearance.ambientBackdropGlow']}
          onChange={(e) => handleUpdate({ 'appearance.ambientBackdropGlow': e.target.checked })}
          className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
        />
      ),
    },
    {
      id: 'waveformStyle',
      tab: 'appearance',
      title: 'Waveform Style',
      description: '68-bar amplitude seekbar vs standard linear slider',
      keywords: 'waveform seekbar slider 68-bar',
      control: (
        <select
          value={settings['appearance.waveformStyle']}
          onChange={(e) => handleUpdate({ 'appearance.waveformStyle': e.target.value as any })}
          className="px-3 py-1.5 rounded-lg bg-[var(--color-surface-variant)] border border-[var(--color-outline)] text-xs text-[var(--color-primary)]"
        >
          <option value="bars68">68-Bar Waveform Seekbar</option>
          <option value="thinSlider">Thin Slider</option>
        </select>
      ),
    },

    // Playback
    {
      id: 'crossfade',
      tab: 'playback',
      title: 'Crossfade Duration',
      description: `Overlap transition time between tracks (${settings['playback.crossfadeDurationSec']}s)`,
      keywords: 'crossfade overlap transition',
      control: (
        <input
          type="range"
          min="0"
          max="12"
          step="1"
          value={settings['playback.crossfadeDurationSec']}
          onChange={(e) =>
            handleUpdate({ 'playback.crossfadeDurationSec': parseFloat(e.target.value) })
          }
          className="w-32 accent-[var(--color-accent)] cursor-pointer"
        />
      ),
    },
    {
      id: 'gapless',
      tab: 'playback',
      title: 'Gapless Playback',
      description: 'Pre-roll standby deck for zero-latency track transitions',
      keywords: 'gapless deck transition',
      control: (
        <input
          type="checkbox"
          checked={settings['playback.gaplessEnabled']}
          onChange={(e) => handleUpdate({ 'playback.gaplessEnabled': e.target.checked })}
          className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
        />
      ),
    },
    {
      id: 'automix',
      tab: 'playback',
      title: 'Automix Transitions',
      description: 'Filter sweep and tempo match between tracks',
      keywords: 'automix tempo filter',
      control: (
        <input
          type="checkbox"
          checked={settings['playback.automixEnabled']}
          onChange={(e) => handleUpdate({ 'playback.automixEnabled': e.target.checked })}
          className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
        />
      ),
    },
    {
      id: 'peakLimiter',
      tab: 'playback',
      title: 'Lookahead Peak Limiter',
      description: 'Dynamic headroom limiter ceiling (0.985 FS)',
      keywords: 'limiter clipping headroom',
      control: (
        <input
          type="checkbox"
          checked={settings['playback.peakLimiterEnabled']}
          onChange={(e) => handleUpdate({ 'playback.peakLimiterEnabled': e.target.checked })}
          className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
        />
      ),
    },
    {
      id: 'replayGain',
      tab: 'playback',
      title: 'ReplayGain Normalization',
      description: 'Normalize playback loudness per track or album',
      keywords: 'replaygain loudness volume normalize',
      control: (
        <select
          value={settings['playback.replayGainMode']}
          onChange={(e) => handleUpdate({ 'playback.replayGainMode': e.target.value as any })}
          className="px-3 py-1.5 rounded-lg bg-[var(--color-surface-variant)] border border-[var(--color-outline)] text-xs text-[var(--color-primary)]"
        >
          <option value="off">Off</option>
          <option value="track">Track</option>
          <option value="album">Album</option>
        </select>
      ),
    },
    {
      id: 'streamingQuality',
      tab: 'playback',
      title: 'Streaming Quality Target',
      description: 'Preferred codec and bitrate',
      keywords: 'bitrate quality flac opus aac',
      control: (
        <select
          value={settings['playback.preferredStreamingBitrate']}
          onChange={(e) =>
            handleUpdate({ 'playback.preferredStreamingBitrate': e.target.value as any })
          }
          className="px-3 py-1.5 rounded-lg bg-[var(--color-surface-variant)] border border-[var(--color-outline)] text-xs text-[var(--color-primary)]"
        >
          <option value="auto">Auto Adaptive</option>
          <option value="standard">Standard (128kbps AAC)</option>
          <option value="high">High (160kbps Opus)</option>
          <option value="lossless">Hi-Res Lossless (FLAC)</option>
        </select>
      ),
    },

    // DSP
    {
      id: 'eqEnabled',
      tab: 'dsp',
      title: '10-Band Equalizer',
      description: 'Enable State-Variable Filter (SVF) parametric EQ',
      keywords: 'equalizer eq svf',
      control: (
        <input
          type="checkbox"
          checked={settings['dsp.equalizerEnabled']}
          onChange={(e) => {
            const enabled = e.target.checked;
            handleUpdate({ 'dsp.equalizerEnabled': enabled });
            usePlayerStore
              .getState()
              .setEqualizerBands(
                enabled ? settings['dsp.equalizerBands'] : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
              );
          }}
          className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
        />
      ),
    },
    {
      id: 'eqPreset',
      tab: 'dsp',
      title: 'Equalizer Preset',
      description: 'Factory acoustic curves applied in real time',
      keywords: 'eq preset flat bass electronic rock vocal acoustic',
      control: (
        <select
          value={settings['dsp.equalizerPreset']}
          onChange={(e) => {
            const preset = e.target.value;
            const bands = FACTORY_EQ_PRESETS[preset] || FACTORY_EQ_PRESETS.Flat;
            handleUpdate({
              'dsp.equalizerPreset': preset,
              'dsp.equalizerBands': [...bands],
            });
            usePlayerStore.getState().setEqualizerBands([...bands]);
          }}
          className="px-3 py-1.5 rounded-lg bg-[var(--color-surface-variant)] border border-[var(--color-outline)] text-xs text-[var(--color-primary)]"
        >
          {Object.keys(FACTORY_EQ_PRESETS).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      ),
    },
    {
      id: 'spatialAudio',
      tab: 'dsp',
      title: 'Spatial Audio & Stereo Width',
      description: 'Mid/Side width expansion and crossfeed delay',
      keywords: 'spatial stereo width crossfeed',
      control: (
        <input
          type="checkbox"
          checked={settings['dsp.spatialAudioEnabled']}
          onChange={(e) => handleUpdate({ 'dsp.spatialAudioEnabled': e.target.checked })}
          className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
        />
      ),
    },
    {
      id: 'autoEq',
      tab: 'dsp',
      title: 'AutoEQ Headphone Calibration',
      description: 'Apply Harman target curve for detected headphone',
      keywords: 'autoeq headphone harman calibration',
      control: (
        <input
          type="checkbox"
          checked={settings['dsp.autoEqEnabled']}
          onChange={(e) => handleUpdate({ 'dsp.autoEqEnabled': e.target.checked })}
          className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
        />
      ),
    },

    // Lyrics
    {
      id: 'lyricsEnabled',
      tab: 'lyrics',
      title: 'Lyrics Engine',
      description: 'Enable synchronized lyrics lookup and display',
      keywords: 'lyrics enable sync',
      control: (
        <input
          type="checkbox"
          checked={settings['lyrics.enabled']}
          onChange={(e) => handleUpdate({ 'lyrics.enabled': e.target.checked })}
          className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
        />
      ),
    },
    {
      id: 'syllableSyncGlow',
      tab: 'lyrics',
      title: 'Syllable Sync Glow (GPU Bloom)',
      description: 'Sub-second word highlight with 0.62 alpha halo',
      keywords: 'syllable glow bloom lyrics',
      control: (
        <input
          type="checkbox"
          checked={settings['lyrics.syllableSyncGlow']}
          onChange={(e) => handleUpdate({ 'lyrics.syllableSyncGlow': e.target.checked })}
          className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
        />
      ),
    },
    {
      id: 'romanization',
      tab: 'lyrics',
      title: 'Romanization Support',
      description: 'Pronunciation guides for CJK / non-Latin lyrics',
      keywords: 'romanization cjk pronunciation',
      control: (
        <input
          type="checkbox"
          checked={settings['lyrics.romanizationEnabled']}
          onChange={(e) => handleUpdate({ 'lyrics.romanizationEnabled': e.target.checked })}
          className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
        />
      ),
    },
    {
      id: 'rtlSupport',
      tab: 'lyrics',
      title: 'Auto RTL Detection',
      description: 'Arabic / Hebrew right-to-left layout with Vazirmatn font',
      keywords: 'rtl arabic hebrew',
      control: (
        <input
          type="checkbox"
          checked={settings['lyrics.rtlSupport']}
          onChange={(e) => handleUpdate({ 'lyrics.rtlSupport': e.target.checked })}
          className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
        />
      ),
    },
    {
      id: 'lyricsFontSize',
      tab: 'lyrics',
      title: 'Lyrics Font Size',
      description: `Base font size (${settings['lyrics.fontSize']}px)`,
      keywords: 'lyrics font size',
      control: (
        <input
          type="range"
          min="16"
          max="36"
          step="2"
          value={settings['lyrics.fontSize']}
          onChange={(e) => handleUpdate({ 'lyrics.fontSize': parseInt(e.target.value, 10) })}
          className="w-32 accent-[var(--color-accent)] cursor-pointer"
        />
      ),
    },

    // Storage
    {
      id: 'localFolders',
      tab: 'storage',
      title: 'Local Music Folders',
      description: 'Directories scanned for FLAC, MP3, WAV, and M4A tracks',
      keywords: 'local folder browse music directory scan',
      control: (
        <button
          type="button"
          onClick={handleBrowseFolder}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-accent)] text-white text-xs font-semibold hover:brightness-110 transition-all cursor-pointer"
        >
          <FolderOpen size={14} />
          <span>Browse...</span>
        </button>
      ),
    },
    {
      id: 'watchLocalFolders',
      tab: 'storage',
      title: 'Watch Local Folders',
      description: 'Auto-scan directories for FLAC, MP3, WAV files',
      keywords: 'watch scan folders',
      control: (
        <input
          type="checkbox"
          checked={settings['storage.watchLocalFolders']}
          onChange={(e) => handleUpdate({ 'storage.watchLocalFolders': e.target.checked })}
          className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
        />
      ),
    },
    {
      id: 'parseId3Tags',
      tab: 'storage',
      title: 'Parse ID3 Tags',
      description: 'Extract embedded artwork, title, artist, album metadata',
      keywords: 'id3 tags metadata artwork',
      control: (
        <input
          type="checkbox"
          checked={settings['storage.parseId3Tags']}
          onChange={(e) => handleUpdate({ 'storage.parseId3Tags': e.target.checked })}
          className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
        />
      ),
    },
    {
      id: 'cacheSizeLimit',
      tab: 'storage',
      title: 'Cache Size Limit (MB)',
      description: `Maximum disk space for offline audio cache (${settings['storage.cacheSizeLimitMb']} MB)`,
      keywords: 'cache size limit storage',
      control: (
        <input
          type="number"
          value={settings['storage.cacheSizeLimitMb']}
          onChange={(e) =>
            handleUpdate({ 'storage.cacheSizeLimitMb': parseInt(e.target.value, 10) || 1024 })
          }
          className="w-24 px-2 py-1 rounded bg-[var(--color-surface-variant)] border border-[var(--color-outline)] text-xs text-right"
        />
      ),
    },
    {
      id: 'resetReplayData',
      tab: 'storage',
      title: 'Reset Replay & Listening Data',
      description: 'Clear all recorded listening history and monthly Replay stats',
      keywords: 'reset replay listening history clear stats',
      control: (
        <button
          type="button"
          onClick={handleResetReplay}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30 text-xs font-semibold transition-colors cursor-pointer"
        >
          <Trash2 size={13} />
          <span>{replayResetNotice ? 'Replay Data Cleared' : 'Reset Replay & Listening Data'}</span>
        </button>
      ),
    },

    // Accounts
    {
      id: 'accountYtMusic',
      tab: 'accounts',
      title: 'YouTube Music',
      description: authStatus.ytmusic.connected
        ? `Connected${authStatus.ytmusic.displayName ? ` as ${authStatus.ytmusic.displayName}` : ''} • Library & personalized feed sync active`
        : 'Sign in to sync your YouTube Music library and personalized feed',
      keywords: 'youtube music account login sign in',
      control: (
        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
              authStatus.ytmusic.connected
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'bg-white/10 text-[var(--color-on-surface-variant)]'
            }`}
          >
            {authStatus.ytmusic.connected ? 'Connected' : 'Not Connected'}
          </span>
          {authStatus.ytmusic.connected ? (
            <button
              type="button"
              disabled={authBusy === 'ytmusic'}
              onClick={() => handleAccountLogout('ytmusic')}
              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              Sign Out
            </button>
          ) : (
            <button
              type="button"
              disabled={authBusy === 'ytmusic'}
              onClick={() => handleAccountLogin('ytmusic')}
              className="px-3 py-1.5 rounded-lg bg-[var(--color-accent)] text-white text-xs font-semibold hover:brightness-110 transition-all cursor-pointer disabled:opacity-50"
            >
              {authBusy === 'ytmusic' ? 'Signing in...' : 'Sign In'}
            </button>
          )}
        </div>
      ),
    },
    {
      id: 'accountSpotify',
      tab: 'accounts',
      title: 'Spotify',
      description: authStatus.spotify.connected
        ? `Connected${authStatus.spotify.displayName ? ` as ${authStatus.spotify.displayName}` : ''} • Playlist & canvas integration active`
        : 'Sign in to enable Spotify playlist import and canvas integration',
      keywords: 'spotify account login sign in playlist canvas',
      control: (
        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
              authStatus.spotify.connected
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'bg-white/10 text-[var(--color-on-surface-variant)]'
            }`}
          >
            {authStatus.spotify.connected ? 'Connected' : 'Not Connected'}
          </span>
          {authStatus.spotify.connected ? (
            <button
              type="button"
              disabled={authBusy === 'spotify'}
              onClick={() => handleAccountLogout('spotify')}
              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              Sign Out
            </button>
          ) : (
            <button
              type="button"
              disabled={authBusy === 'spotify'}
              onClick={() => handleAccountLogin('spotify')}
              className="px-3 py-1.5 rounded-lg bg-[var(--color-accent)] text-white text-xs font-semibold hover:brightness-110 transition-all cursor-pointer disabled:opacity-50"
            >
              {authBusy === 'spotify' ? 'Signing in...' : 'Sign In'}
            </button>
          )}
        </div>
      ),
    },

    // Integrations
    {
      id: 'discordRpc',
      tab: 'integrations',
      title: 'Discord Rich Presence (RPC)',
      description: 'Show currently playing track on your Discord profile',
      keywords: 'discord rpc presence',
      control: (
        <input
          type="checkbox"
          checked={settings['scrobble.discordRpcEnabled']}
          onChange={(e) => handleUpdate({ 'scrobble.discordRpcEnabled': e.target.checked })}
          className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
        />
      ),
    },
    {
      id: 'lastFm',
      tab: 'integrations',
      title: 'Last.fm Scrobbling',
      description: 'Log listening history to Last.fm',
      keywords: 'lastfm scrobble',
      control: (
        <input
          type="checkbox"
          checked={settings['scrobble.lastFmEnabled']}
          onChange={(e) => handleUpdate({ 'scrobble.lastFmEnabled': e.target.checked })}
          className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
        />
      ),
    },
    {
      id: 'listenBrainz',
      tab: 'integrations',
      title: 'ListenBrainz Scrobbling',
      description: 'Submit plays to ListenBrainz',
      keywords: 'listenbrainz scrobble',
      control: (
        <input
          type="checkbox"
          checked={settings['scrobble.listenBrainzEnabled']}
          onChange={(e) => handleUpdate({ 'scrobble.listenBrainzEnabled': e.target.checked })}
          className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
        />
      ),
    },
    {
      id: 'listenTogether',
      tab: 'integrations',
      title: 'Listen Together Party Client',
      description: 'Real-time synchronized listening rooms with friends',
      keywords: 'listen together party nickname',
      control: (
        <input
          type="text"
          value={settings['listenTogether.nickname']}
          onChange={(e) => handleUpdate({ 'listenTogether.nickname': e.target.value })}
          placeholder="Your nickname"
          className="w-36 px-2.5 py-1 rounded bg-[var(--color-surface-variant)] border border-[var(--color-outline)] text-xs"
        />
      ),
    },

    // Ergonomics
    {
      id: 'hardwareMediaKeys',
      tab: 'ergonomics',
      title: 'Hardware Media Keys',
      description: 'Capture keyboard Play/Pause, Next, Prev media buttons',
      keywords: 'media keys keyboard',
      control: (
        <input
          type="checkbox"
          checked={settings['ui.hardwareMediaKeys']}
          onChange={(e) => handleUpdate({ 'ui.hardwareMediaKeys': e.target.checked })}
          className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
        />
      ),
    },
    {
      id: 'minimizeToTray',
      tab: 'ergonomics',
      title: 'Minimize to System Tray',
      description: 'Keep music playing in background when minimized',
      keywords: 'tray minimize',
      control: (
        <input
          type="checkbox"
          checked={settings['ui.minimizeToTray']}
          onChange={(e) => handleUpdate({ 'ui.minimizeToTray': e.target.checked })}
          className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
        />
      ),
    },
    {
      id: 'closeToTray',
      tab: 'ergonomics',
      title: 'Close to System Tray',
      description: 'Hide window to tray instead of quitting on close',
      keywords: 'tray close',
      control: (
        <input
          type="checkbox"
          checked={settings['ui.closeToTray']}
          onChange={(e) => handleUpdate({ 'ui.closeToTray': e.target.checked })}
          className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
        />
      ),
    },
    {
      id: 'enable3dCoverFlow',
      tab: 'ergonomics',
      title: '3D Album Cover Flow',
      description: 'Enable interactive CSS 3D perspective album browser',
      keywords: '3d cover flow',
      control: (
        <input
          type="checkbox"
          checked={settings['ui.enable3dCoverFlow']}
          onChange={(e) => handleUpdate({ 'ui.enable3dCoverFlow': e.target.checked })}
          className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
        />
      ),
    },
    {
      id: 'enableCanvasVideo',
      tab: 'ergonomics',
      title: 'Canvas Video Loops',
      description: 'Show looping canvas visuals in Now Playing when available',
      keywords: 'canvas video loop',
      control: (
        <input
          type="checkbox"
          checked={settings['ui.enableCanvasVideo']}
          onChange={(e) => handleUpdate({ 'ui.enableCanvasVideo': e.target.checked })}
          className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
        />
      ),
    },
  ];

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const visibleEntries = trimmedQuery
    ? entries.filter((entry) =>
        `${entry.title} ${entry.description} ${entry.keywords || ''} ${entry.tab}`
          .toLowerCase()
          .includes(trimmedQuery)
      )
    : entries.filter((entry) => entry.tab === activeTab);

  const activeTabLabel =
    navTabs.find((t) => t.id === activeTab)?.label || 'Preferences';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-md animate-in fade-in duration-150">
      <div
        onClick={(e) => e.stopPropagation()}
        className="liquid-glass-capsule w-full max-w-4xl h-[680px] rounded-3xl flex flex-col overflow-hidden text-[var(--color-primary)] animate-in zoom-in-95 duration-150"
      >
        {/* Modal Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <Sliders size={20} className="text-[var(--color-accent)]" />
            <div>
              <h2 className="text-base font-bold">Preferences</h2>
              <p className="text-xs text-[var(--color-on-surface-variant)]">
                Customize audio DSP, themes, accounts, and desktop interaction
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {savedNotice && (
              <span className="flex items-center gap-1 text-xs text-green-400 animate-in fade-in">
                <Check size={14} /> Saved
              </span>
            )}

            <button
              onClick={() => resetToDefaults()}
              title="Reset all settings to defaults"
              className="spring-press liquid-glass-pill flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs text-[var(--color-on-surface-variant)] hover:text-white transition-colors cursor-pointer"
            >
              <RotateCcw size={14} />
              <span>Reset Defaults</span>
            </button>

            <button
              onClick={onClose}
              className="spring-press liquid-glass-pill p-1.5 rounded-full text-[var(--color-on-surface-variant)] hover:text-white transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Content Body: Left Tab Sidebar + Right Settings Panel */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left Subsystem Navigation */}
          <div className="w-56 p-3 space-y-1 border-r border-white/10 flex flex-col">
            <div className="relative mb-2">
              <Search
                size={14}
                className="absolute left-3 top-2.5 text-[var(--color-on-surface-variant)]"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search settings..."
                className="liquid-glass w-full pl-8 pr-3 py-1.5 rounded-full text-xs text-[var(--color-primary)] placeholder-[var(--color-on-surface-variant)] focus:outline-none focus:border-[var(--color-accent)]"
              />
            </div>

            <div className="flex-1 space-y-1 overflow-y-auto">
              {navTabs.map((tab) => {
                const isActive = !trimmedQuery && activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setSearchQuery('');
                      setActiveTab(tab.id);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                      isActive
                        ? 'liquid-glass-pill text-[var(--color-accent)]'
                        : 'text-[var(--color-on-surface-variant)] hover:text-[var(--color-primary)] hover:bg-white/5'
                    }`}
                  >
                    <span>{tab.icon}</span>
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Settings Details Container */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-black/20">
            <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--color-accent)]">
              {trimmedQuery ? `Search Results (${visibleEntries.length})` : activeTabLabel}
            </h3>

            {visibleEntries.length === 0 ? (
              <div className="p-6 rounded-xl bg-[var(--color-surface)] border border-[var(--color-outline)] text-xs text-[var(--color-on-surface-variant)]">
                No settings match "{searchQuery}".
              </div>
            ) : (
              visibleEntries.map((entry) => (
                <div key={entry.id} className="space-y-2">
                  <div className="flex items-center justify-between gap-4 p-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-outline)]">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold flex items-center gap-2">
                        <span>{entry.title}</span>
                        {trimmedQuery && (
                          <span className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] font-normal text-[var(--color-on-surface-variant)]">
                            {entry.tab}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--color-on-surface-variant)]">
                        {entry.description}
                      </div>
                    </div>
                    <div className="shrink-0">{entry.control}</div>
                  </div>

                  {entry.id === 'localFolders' &&
                    Array.isArray(settings['storage.localFolders']) &&
                    settings['storage.localFolders'].length > 0 && (
                      <div className="pl-3 space-y-1">
                        {settings['storage.localFolders'].map((folder) => (
                          <div
                            key={folder}
                            className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-[var(--color-surface-variant)] border border-[var(--color-outline)] text-[11px]"
                          >
                            <span className="truncate font-mono">{folder}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveFolder(folder)}
                              className="text-[var(--color-on-surface-variant)] hover:text-red-400 ml-2 cursor-pointer"
                              title="Remove folder"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
