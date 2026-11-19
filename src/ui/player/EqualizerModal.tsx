// src/ui/player/EqualizerModal.tsx
// Floating Liquid Glass modal for 10-band SVF equalizer, live 17,703 AutoEQ database search, and Spatial Audio

import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Sliders,
  Headphones,
  Layers,
  Sparkles,
  RotateCcw,
  Search,
  Check,
  ChevronDown,
} from 'lucide-react';
import { usePlayerStore } from '../../state/playerStore';
import { useSettingsStore } from '../../state/settingsStore';
import { FACTORY_EQ_PRESETS, EQ_FREQUENCIES_HZ } from '../../audio/DspChain';
import { AutoEqLoader, type AutoEqSearchResult } from '../../audio/AutoEqLoader';

export interface EqualizerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const EqualizerModal: React.FC<EqualizerModalProps> = ({ isOpen, onClose }) => {
  const { setEqualizerBands, loadAutoEqProfile, setSpatialAudio } = usePlayerStore();
  const { settings, updateSettings } = useSettingsStore();

  const [activePreset, setActivePreset] = useState<string>(
    settings['dsp.equalizerPreset'] || 'Flat'
  );
  const [bands, setBands] = useState<number[]>(
    settings['dsp.equalizerBands'] && settings['dsp.equalizerBands'].length === 10
      ? settings['dsp.equalizerBands']
      : [...FACTORY_EQ_PRESETS.Flat]
  );
  const [spatialWidth, setSpatialWidth] = useState<number>(settings['dsp.spatialWidthGain'] || 2.5);
  const [spatialEnabled, setSpatialEnabled] = useState<boolean>(settings['dsp.spatialAudioEnabled'] ?? true);
  const [selectedAutoEq, setSelectedAutoEq] = useState<string>(settings['dsp.autoEqSelectedProfile'] || '');

  // Live AutoEQ Search State across 17,703 profiles
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AutoEqSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);

  const popularHeadphones = [
    'Sennheiser HD 600',
    'Sony WH-1000XM4',
    'Apple AirPods Max',
    'Audio-Technica ATH-M50x',
    'Beyerdynamic DT 770 Pro',
    'Bose QuietComfort 45',
  ];

  // Sync settings when opened
  useEffect(() => {
    if (isOpen) {
      if (settings['dsp.equalizerBands'] && settings['dsp.equalizerBands'].length === 10) {
        setBands(settings['dsp.equalizerBands']);
      }
      if (settings['dsp.equalizerPreset']) {
        setActivePreset(settings['dsp.equalizerPreset']);
      }
      if (settings['dsp.autoEqSelectedProfile'] !== undefined) {
        setSelectedAutoEq(settings['dsp.autoEqSelectedProfile'] || '');
      }
      if (settings['dsp.spatialAudioEnabled'] !== undefined) {
        setSpatialEnabled(settings['dsp.spatialAudioEnabled']);
      }
      if (settings['dsp.spatialWidthGain'] !== undefined) {
        setSpatialWidth(settings['dsp.spatialWidthGain']);
      }
    }
  }, [isOpen, settings]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Click outside search dropdown to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced AutoEQ search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!searchQuery.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await AutoEqLoader.searchHeadphones(searchQuery.trim(), 30);
        setSearchResults(results);
        setIsDropdownOpen(true);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 180);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery]);

  if (!isOpen) return null;

  const handleBandChange = (index: number, value: number) => {
    const updated = [...bands];
    updated[index] = Math.max(-12, Math.min(12, value));
    setBands(updated);
    setActivePreset('Custom');
    setEqualizerBands(updated);
    updateSettings({
      'dsp.equalizerBands': updated,
      'dsp.equalizerPreset': 'Custom',
    });
  };

  const handleSelectPreset = (name: string) => {
    const presetBands = FACTORY_EQ_PRESETS[name];
    if (!presetBands) return;
    const cloned = [...presetBands];
    setBands(cloned);
    setActivePreset(name);
    setEqualizerBands(cloned);
    updateSettings({
      'dsp.equalizerBands': cloned,
      'dsp.equalizerPreset': name,
    });
  };

  const handleResetFlat = () => {
    handleSelectPreset('Flat');
  };

  const handleSpatialToggle = (enabled: boolean) => {
    setSpatialEnabled(enabled);
    setSpatialAudio(enabled, spatialWidth);
    updateSettings({
      'dsp.spatialAudioEnabled': enabled,
    });
  };

  const handleSpatialWidthChange = (val: number) => {
    const clamped = Math.max(1.0, Math.min(4.0, val));
    setSpatialWidth(clamped);
    if (spatialEnabled) {
      setSpatialAudio(true, clamped);
    }
    updateSettings({
      'dsp.spatialWidthGain': clamped,
    });
  };

  const handleAutoEqSelect = async (profileName: string) => {
    setSelectedAutoEq(profileName);
    setIsDropdownOpen(false);
    setSearchQuery('');
    if (profileName) {
      await loadAutoEqProfile(profileName);
      updateSettings({
        'dsp.autoEqEnabled': true,
        'dsp.autoEqSelectedProfile': profileName,
      });
    } else {
      updateSettings({
        'dsp.autoEqEnabled': false,
        'dsp.autoEqSelectedProfile': null,
      });
    }
  };

  const formatFreqLabel = (hz: number) => {
    return hz >= 1000 ? `${hz / 1000}k` : `${hz}`;
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-md animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="liquid-glass-capsule w-full max-w-4xl max-h-[90vh] rounded-3xl flex flex-col overflow-hidden text-[var(--color-primary)] animate-in zoom-in-95 duration-150 border border-white/15 shadow-2xl"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
              <Sliders size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">Equalizer & Audio DSP</h2>
                <span className="liquid-glass-pill inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold text-[var(--color-accent)]">
                  <Sparkles size={10} /> SVF + AutoEQ
                </span>
              </div>
              <p className="text-xs text-[var(--color-on-surface-variant)]">
                10-Band State-Variable Filter (SVF), 17,703 headphone calibrations, and Mid/Side stereo widening
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleResetFlat}
              title="Reset EQ bands to 0 dB Flat"
              className="spring-press liquid-glass-pill flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-[var(--color-on-surface-variant)] hover:text-white transition-all cursor-pointer"
            >
              <RotateCcw size={13} />
              <span>Reset Flat</span>
            </button>

            <button
              onClick={onClose}
              title="Close Equalizer"
              className="spring-press liquid-glass-pill p-1.5 rounded-full text-[var(--color-on-surface-variant)] hover:text-white transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Section 1: 10-Band SVF Equalizer */}
          <section className="liquid-glass-card p-5 rounded-2xl space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h3 className="text-sm font-bold text-white">10-Band SVF Equalizer</h3>
                <p className="text-[11px] text-[var(--color-on-surface-variant)]">
                  Active Preset: <span className="font-semibold text-[var(--color-accent)]">{activePreset}</span>
                </p>
              </div>

              {/* Preset Selector Chips */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {Object.keys(FACTORY_EQ_PRESETS).slice(0, 8).map((pName) => (
                  <button
                    key={pName}
                    onClick={() => handleSelectPreset(pName)}
                    className={`spring-press px-3 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
                      activePreset === pName
                        ? 'liquid-glass-pill-active text-white'
                        : 'liquid-glass-pill text-[var(--color-on-surface-variant)] hover:text-white'
                    }`}
                  >
                    {pName}
                  </button>
                ))}
              </div>
            </div>

            {/* 10 Vertical Band Sliders */}
            <div className="grid grid-cols-10 gap-2 h-56 items-end pt-4 pb-2 px-2 border-t border-white/10">
              {EQ_FREQUENCIES_HZ.map((freq, idx) => {
                const gain = bands[idx] ?? 0;
                return (
                  <div key={freq} className="flex flex-col items-center gap-2 h-full justify-between">
                    <span className="text-[10px] font-mono font-semibold text-[var(--color-accent)]">
                      {gain > 0 ? `+${gain.toFixed(1)}` : gain.toFixed(1)}
                    </span>

                    <div className="relative flex-1 flex items-center justify-center w-full">
                      <input
                        type="range"
                        min="-12"
                        max="12"
                        step="0.5"
                        value={gain}
                        onChange={(e) => handleBandChange(idx, parseFloat(e.target.value))}
                        className="h-36 w-1.5 accent-[var(--color-accent)] bg-white/15 rounded-full cursor-pointer appearance-none -rotate-90"
                        style={{ transformOrigin: 'center' }}
                      />
                    </div>

                    <span className="text-[11px] font-mono font-medium text-[var(--color-on-surface-variant)]">
                      {formatFreqLabel(freq)}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Section 2: AutoEQ Search across 17,703 Profiles & Spatial Audio */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* AutoEQ Search & Calibration Card */}
            <section className="liquid-glass-card p-5 rounded-2xl space-y-4 relative">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-purple-500/15 text-purple-400">
                    <Headphones size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">AutoEQ Calibration</h3>
                    <p className="text-[11px] text-[var(--color-on-surface-variant)]">
                      17,703 Harman acoustic headphone profiles
                    </p>
                  </div>
                </div>

                {selectedAutoEq && (
                  <button
                    onClick={() => handleAutoEqSelect('')}
                    className="text-[10px] text-[var(--color-accent)] hover:underline cursor-pointer"
                  >
                    Clear Profile
                  </button>
                )}
              </div>

              {/* Active Profile Banner */}
              {selectedAutoEq ? (
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-purple-500/15 border border-purple-500/30">
                  <div className="flex items-center gap-2">
                    <Check size={14} className="text-purple-400" />
                    <span className="text-xs font-semibold text-white truncate max-w-[200px]">
                      {selectedAutoEq}
                    </span>
                  </div>
                  <span className="text-[10px] text-purple-300 font-mono">Calibrated</span>
                </div>
              ) : null}

              {/* Searchable Input with Debounced Typeahead */}
              <div ref={searchContainerRef} className="relative space-y-2">
                <label className="text-xs font-semibold text-[var(--color-on-surface-variant)] block">
                  Search Headphone Model
                </label>
                <div className="relative">
                  <Search
                    size={14}
                    className="absolute left-3 top-2.5 text-[var(--color-on-surface-variant)]"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onFocus={() => {
                      if (searchResults.length > 0) setIsDropdownOpen(true);
                    }}
                    placeholder="e.g. Sennheiser HD 600, AirPods, Sony..."
                    className="w-full pl-8 pr-8 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-white/30 focus:outline-none focus:border-[var(--color-accent)]"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => {
                        setSearchQuery('');
                        setSearchResults([]);
                      }}
                      className="absolute right-2.5 top-2.5 text-[var(--color-on-surface-variant)] hover:text-white"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                {/* Dropdown Results across 17,703 profiles */}
                {isDropdownOpen && searchResults.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1.5 max-h-48 overflow-y-auto bg-[#141419] border border-white/15 rounded-xl shadow-2xl z-30 divide-y divide-white/5">
                    {searchResults.map((res) => (
                      <button
                        key={`${res.id}-${res.name}`}
                        onClick={() => handleAutoEqSelect(res.name)}
                        className="w-full text-left px-3.5 py-2 hover:bg-white/10 flex items-center justify-between text-xs transition-colors cursor-pointer group"
                      >
                        <span className="font-medium text-white group-hover:text-[var(--color-accent)] truncate mr-2">
                          {res.name}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {res.meta && (
                            <span className="text-[10px] text-[var(--color-on-surface-variant)]">
                              {res.meta}
                            </span>
                          )}
                          {res.parametric && (
                            <span className="text-[9px] px-1 py-0.2 bg-purple-500/20 text-purple-300 rounded font-mono">
                              PaP
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {isSearching && (
                  <p className="text-[10px] text-[var(--color-on-surface-variant)] italic">
                    Searching 17,703 headphone calibration profiles...
                  </p>
                )}

                {/* Popular Quick-Select Chips */}
                <div className="pt-2">
                  <span className="text-[10px] font-semibold text-[var(--color-on-surface-variant)] block mb-1.5">
                    Popular Benchmarks:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {popularHeadphones.map((hp) => (
                      <button
                        key={hp}
                        onClick={() => handleAutoEqSelect(hp)}
                        className={`text-[10px] px-2.5 py-1 rounded-full transition-all cursor-pointer ${
                          selectedAutoEq === hp
                            ? 'bg-purple-500 text-white font-semibold'
                            : 'liquid-glass-pill text-[var(--color-on-surface-variant)] hover:text-white'
                        }`}
                      >
                        {hp}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* Spatial Audio & Stereo Width Card */}
            <section className="liquid-glass-card p-5 rounded-2xl space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-cyan-500/15 text-cyan-400">
                    <Layers size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Spatial Audio Engine</h3>
                    <p className="text-[11px] text-[var(--color-on-surface-variant)]">
                      Mid/Side stereo expansion & 15ms circular crossfeed
                    </p>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={spatialEnabled}
                    onChange={(e) => handleSpatialToggle(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-5 bg-[var(--color-surface-variant)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--color-accent)]" />
                </label>
              </div>

              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[var(--color-on-surface-variant)]">
                    Stereo Width Gain
                  </span>
                  <span className="font-mono font-bold text-cyan-400">{spatialWidth.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min="1.0"
                  max="4.0"
                  step="0.05"
                  value={spatialWidth}
                  disabled={!spatialEnabled}
                  onChange={(e) => handleSpatialWidthChange(parseFloat(e.target.value))}
                  className="w-full h-1.5 accent-cyan-400 bg-[var(--color-surface-variant)] rounded-lg cursor-pointer disabled:opacity-40"
                />
                <p className="text-[11px] text-[var(--color-on-surface-variant)] leading-relaxed">
                  Expands soundstage imaging by separating Mid (mono center) from Side (stereo difference) channels with simulated HRTF crossfeed and automatic -1.72 dB headroom protection.
                </p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};
