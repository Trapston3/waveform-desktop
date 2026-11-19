// src/ui/views/EqualizerView.tsx
// 10-Band Graphic Equalizer, AutoEQ calibration profile loader, and Spatial Audio stereo width processor

import React, { useState, useEffect, useRef } from 'react';
import { Sliders, Headphones, Layers, Sparkles, RotateCcw, Search, Check, X } from 'lucide-react';
import { usePlayerStore } from '../../state/playerStore';
import { useSettingsStore } from '../../state/settingsStore';
import { FACTORY_EQ_PRESETS, EQ_FREQUENCIES_HZ } from '../../audio/DspChain';
import { AutoEqLoader, type AutoEqSearchResult } from '../../audio/AutoEqLoader';

export const EqualizerView: React.FC = () => {
  const { setEqualizerBands, loadAutoEqProfile, setSpatialAudio } = usePlayerStore();
  const { settings, updateSettings } = useSettingsStore();

  const [activePreset, setActivePreset] = useState<string>('Flat');
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
    'Sennheiser HD 650',
    'Audio-Technica ATH-M50x',
    'Sony WH-1000XM4',
    'Sony WH-1000XM5',
    'Bose QuietComfort 45',
    'Apple AirPods Pro 2',
    'Apple AirPods Max',
    'Beyerdynamic DT 770 Pro 80 Ohm',
    'Beyerdynamic DT 990 Pro 250 Ohm',
    'AKG K371',
  ];

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced search across all 17,703 AutoEQ profiles
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

  const handleAutoEqSelect = async (profile: string) => {
    setSelectedAutoEq(profile);
    setIsDropdownOpen(false);
    setSearchQuery('');
    if (profile) {
      await loadAutoEqProfile(profile);
      updateSettings({
        'dsp.autoEqEnabled': true,
        'dsp.autoEqSelectedProfile': profile,
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
    <div className="space-y-8 max-w-5xl mx-auto pb-12 animate-in fade-in duration-150">
      {/* View Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="liquid-glass-pill inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold text-[var(--color-accent)] mb-2">
            <Sparkles size={12} />
            Hardware DSP Suite
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-[var(--color-primary)]">
            Equalizer & Audio DSP
          </h1>
          <p className="text-xs text-[var(--color-on-surface-variant)] mt-1">
            10-band State-Variable Filter (SVF), parametric AutoEQ calibration, and Mid/Side stereo widening
          </p>
        </div>

        <button
          onClick={handleResetFlat}
          className="spring-press liquid-glass-pill flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold text-[var(--color-primary)] transition-all cursor-pointer"
        >
          <RotateCcw size={14} />
          <span>Reset Flat</span>
        </button>
      </div>

      {/* 1. 10-Band Graphic Equalizer */}
      <section className="liquid-glass-card p-6 rounded-3xl space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
              <Sliders size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[var(--color-primary)]">10-Band SVF Equalizer</h2>
              <p className="text-[11px] text-[var(--color-on-surface-variant)]">
                Active Preset: <span className="font-semibold text-[var(--color-accent)]">{activePreset}</span>
              </p>
            </div>
          </div>

          {/* Preset Buttons */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {Object.keys(FACTORY_EQ_PRESETS).slice(0, 8).map((pName) => (
              <button
                key={pName}
                onClick={() => handleSelectPreset(pName)}
                className={`spring-press px-3.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
                  activePreset === pName
                    ? 'liquid-glass-pill-active text-white'
                    : 'liquid-glass-pill text-[var(--color-on-surface-variant)] hover:text-[var(--color-primary)]'
                }`}
              >
                {pName}
              </button>
            ))}
          </div>
        </div>

        {/* 10 Vertical Band Sliders */}
        <div className="grid grid-cols-10 gap-2 h-64 items-end pt-4 pb-2 px-2 border-t border-white/10">
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
                    className="h-40 w-1.5 accent-[var(--color-accent)] bg-white/15 rounded-full cursor-pointer appearance-none -rotate-90"
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

      {/* 2. AutoEQ Headphone Calibration & Spatial Audio Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* AutoEQ Calibration Card */}
        <section className="liquid-glass-card p-6 rounded-3xl space-y-4 relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-purple-500/15 text-purple-400">
                <Headphones size={18} />
              </div>
              <div>
                <h2 className="text-sm font-bold text-[var(--color-primary)]">AutoEQ Calibration</h2>
                <p className="text-[11px] text-[var(--color-on-surface-variant)]">
                  17,703 Harman acoustic target corrections from auto_eq.db
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

          {/* Active Profile Indicator */}
          {selectedAutoEq && (
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-purple-500/15 border border-purple-500/30">
              <div className="flex items-center gap-2">
                <Check size={14} className="text-purple-400" />
                <span className="text-xs font-semibold text-white truncate max-w-[200px]">
                  {selectedAutoEq}
                </span>
              </div>
              <span className="text-[10px] text-purple-300 font-mono">Calibrated</span>
            </div>
          )}

          {/* Searchable Input with Debounced Typeahead across 17,703 profiles */}
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
                placeholder="Search across all 17,703 headphone models..."
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

            {/* Dropdown Results */}
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
                Searching 17,703 headphone profiles in database...
              </p>
            )}

            {/* Popular Quick-Select Chips */}
            <div className="pt-2">
              <span className="text-[10px] font-semibold text-[var(--color-on-surface-variant)] block mb-1.5">
                Popular Models:
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
          <p className="text-[11px] text-[var(--color-on-surface-variant)] leading-relaxed">
            Applying AutoEQ dynamically compensates for your headphone acoustic impedance and frequency distortion using multi-stage biquad filters.
          </p>
        </section>

        {/* Spatial Audio & Stereo Width Card */}
        <section className="liquid-glass-card p-6 rounded-3xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-cyan-500/15 text-cyan-400">
                <Layers size={18} />
              </div>
              <div>
                <h2 className="text-sm font-bold text-[var(--color-primary)]">Spatial Audio Engine</h2>
                <p className="text-[11px] text-[var(--color-on-surface-variant)]">
                  Mid/Side stereo expansion & circular crossfeed
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
              <span className="font-semibold text-[var(--color-on-surface-variant)]">Stereo Width Gain</span>
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
              Expands soundstage imaging by separating Mid (mono center) from Side (stereo difference) channels with a 15ms simulated crossfeed filter.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
};
