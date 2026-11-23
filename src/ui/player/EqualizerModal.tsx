// src/ui/player/EqualizerModal.tsx
// Floating Liquid Glass modal for interactive 10-band SVF equalizer curve,
// live 17,703 AutoEQ database search, and Spatial Audio

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
} from 'lucide-react';
import { usePlayerStore } from '../../state/playerStore';
import { useSettingsStore } from '../../state/settingsStore';
import { FACTORY_EQ_PRESETS } from '../../audio/DspChain';
import {
  AutoEqLoader,
  extractMeasurementRig,
  type AutoEqSearchResult,
} from '../../audio/AutoEqLoader';
import { InteractiveEqGraph } from '../components/InteractiveEqGraph';

export interface EqualizerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const POPULAR_HEADPHONES = [
  'Sony WH-CH720N',
  'Sony WH-1000XM4',
  'Sennheiser HD 600',
  'Beyerdynamic DT 770 Pro (80 Ohm)',
  'Apple AirPods Pro 2',
  'Apple AirPods Max',
  'Audio-Technica ATH-M50x',
  'Bose QuietComfort 45',
] as const;

export const EqualizerModal: React.FC<EqualizerModalProps> = ({ isOpen, onClose }) => {
  const setEqualizerBands = usePlayerStore((s) => s.setEqualizerBands);
  const loadAutoEqProfile = usePlayerStore((s) => s.loadAutoEqProfile);
  const setSpatialAudio = usePlayerStore((s) => s.setSpatialAudio);
  const activeAutoEqProfile = usePlayerStore((s) => s.activeAutoEqProfile);

  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  const [activePreset, setActivePreset] = useState<string>(
    settings['dsp.equalizerPreset'] || 'Flat'
  );
  const [bands, setBands] = useState<number[]>(
    settings['dsp.equalizerBands'] && settings['dsp.equalizerBands'].length === 10
      ? settings['dsp.equalizerBands']
      : [...FACTORY_EQ_PRESETS.Flat]
  );
  const [spatialWidth, setSpatialWidth] = useState<number>(settings['dsp.spatialWidthGain'] || 2.5);
  const [spatialEnabled, setSpatialEnabled] = useState<boolean>(
    settings['dsp.spatialAudioEnabled'] ?? true
  );
  const [selectedAutoEq, setSelectedAutoEq] = useState<string>(
    settings['dsp.autoEqEnabled'] ? settings['dsp.autoEqSelectedProfile'] || '' : ''
  );

  // Live AutoEQ Search State across 17,703 profiles
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AutoEqSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [autoEqFeedback, setAutoEqFeedback] = useState<string | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeqRef = useRef<number>(0);
  const autoHydratedProfileRef = useRef<string | null>(null);

  // Sync settings when opened or changed externally
  useEffect(() => {
    if (!isOpen) return;
    if (settings['dsp.equalizerBands'] && settings['dsp.equalizerBands'].length === 10) {
      setBands([...settings['dsp.equalizerBands']]);
    }
    if (settings['dsp.equalizerPreset']) {
      setActivePreset(settings['dsp.equalizerPreset']);
    }
    const enabled = Boolean(settings['dsp.autoEqEnabled']);
    const savedProfile = enabled ? settings['dsp.autoEqSelectedProfile'] || '' : '';
    setSelectedAutoEq(savedProfile);
    if (
      enabled &&
      savedProfile &&
      !activeAutoEqProfile &&
      autoHydratedProfileRef.current !== savedProfile
    ) {
      autoHydratedProfileRef.current = savedProfile;
      void loadAutoEqProfile(savedProfile);
    }
    if (settings['dsp.spatialAudioEnabled'] !== undefined) {
      setSpatialEnabled(Boolean(settings['dsp.spatialAudioEnabled']));
    }
    if (settings['dsp.spatialWidthGain'] !== undefined) {
      setSpatialWidth(settings['dsp.spatialWidthGain']);
    }
  }, [isOpen, settings, activeAutoEqProfile, loadAutoEqProfile]);

  useEffect(() => {
    if (activeAutoEqProfile?.name) {
      setSelectedAutoEq(activeAutoEqProfile.name);
    } else if (!settings['dsp.autoEqEnabled']) {
      setSelectedAutoEq('');
    }
  }, [activeAutoEqProfile, settings]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Debounced live AutoEQ search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }

    const trimmed = searchQuery.trim();
    if (!trimmed) {
      searchSeqRef.current += 1;
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const seq = ++searchSeqRef.current;
    setIsSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await AutoEqLoader.searchHeadphones(trimmed, 30);
        if (seq === searchSeqRef.current) {
          setSearchResults(Array.isArray(results) ? results : []);
        }
      } catch {
        if (seq === searchSeqRef.current) {
          setSearchResults([]);
        }
      } finally {
        if (seq === searchSeqRef.current) {
          setIsSearching(false);
        }
      }
    }, 60);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
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
    void updateSettings({
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
    void updateSettings({
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
    void updateSettings({
      'dsp.spatialAudioEnabled': enabled,
    });
  };

  const handleSpatialWidthChange = (val: number) => {
    const clamped = Math.max(1.0, Math.min(4.0, val));
    setSpatialWidth(clamped);
    if (spatialEnabled) {
      setSpatialAudio(true, clamped);
    }
    void updateSettings({
      'dsp.spatialWidthGain': clamped,
    });
  };

  const handleAutoEqSelect = async (profileName: string) => {
    setAutoEqFeedback(null);
    if (!profileName) {
      autoHydratedProfileRef.current = null;
      setSelectedAutoEq('');
      setSearchQuery('');
      setSearchResults([]);
      await loadAutoEqProfile('');
      await updateSettings({
        'dsp.autoEqEnabled': false,
        'dsp.autoEqSelectedProfile': null,
      });
      return;
    }

    const ok = await loadAutoEqProfile(profileName);
    const resolvedName = usePlayerStore.getState().activeAutoEqProfile?.name || profileName;
    if (ok) {
      autoHydratedProfileRef.current = resolvedName;
      setSelectedAutoEq(resolvedName);
      setSearchQuery('');
      setSearchResults([]);
      await updateSettings({
        'dsp.autoEqEnabled': true,
        'dsp.autoEqSelectedProfile': resolvedName,
      });
    } else {
      setAutoEqFeedback(`Could not load AutoEQ profile for "${profileName}".`);
    }
  };

  const activeAutoEqName = activeAutoEqProfile?.name || selectedAutoEq;
  const activeAutoEqRig = activeAutoEqProfile?.source
    ? extractMeasurementRig(activeAutoEqProfile.source).rig
    : null;

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
              type="button"
              onClick={handleResetFlat}
              title="Reset EQ bands to 0 dB Flat"
              className="spring-press liquid-glass-pill flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-[var(--color-on-surface-variant)] hover:text-white transition-all cursor-pointer"
            >
              <RotateCcw size={13} />
              <span>Reset Flat</span>
            </button>

            <button
              type="button"
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
          {/* Section 1: Interactive 10-Band SVF Equalizer Curve */}
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
                {Object.keys(FACTORY_EQ_PRESETS).map((pName) => (
                  <button
                    key={pName}
                    type="button"
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

            <InteractiveEqGraph
              bands={bands}
              onChangeBand={handleBandChange}
              activeAutoEqProfile={activeAutoEqProfile}
              heightClassName="h-56"
            />
          </section>

          {/* Section 2: AutoEQ Search across 17,703 Profiles & Spatial Audio */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* AutoEQ Search & Calibration Card */}
            <section className="liquid-glass-card p-5 rounded-2xl space-y-4 relative">
              <div className="flex items-center justify-between gap-2">
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
              </div>

              {/* Active Profile Pill with Disable AutoEQ */}
              {activeAutoEqName ? (
                <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-purple-500/15 border border-purple-500/35">
                  <div className="flex items-center gap-2 min-w-0">
                    <Check size={14} className="text-purple-300 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate">
                        {activeAutoEqName}
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-purple-200/80 font-mono">
                        {activeAutoEqRig && <span>{activeAutoEqRig}</span>}
                        {activeAutoEqProfile && (
                          <span>
                            • Preamp {activeAutoEqProfile.preampGainDb > 0 ? '+' : ''}
                            {activeAutoEqProfile.preampGainDb.toFixed(1)} dB
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleAutoEqSelect('')}
                    className="px-2.5 py-1 rounded-full bg-white/10 hover:bg-red-500/30 border border-white/15 text-[11px] font-semibold text-white transition-colors cursor-pointer shrink-0"
                  >
                    Disable AutoEQ
                  </button>
                </div>
              ) : null}

              {/* Live Search Input & Instant Scrollable Results */}
              <div className="space-y-2">
                <label
                  htmlFor="autoeq-search-modal"
                  className="text-xs font-semibold text-[var(--color-on-surface-variant)] block"
                >
                  Search Headphone Model
                </label>
                <div className="relative">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-3 top-2.5 text-[var(--color-on-surface-variant)]"
                  />
                  <input
                    id="autoeq-search-modal"
                    type="text"
                    spellCheck={false}
                    autoComplete="off"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="e.g. Sony WH-CH720N, Sennheiser HD 600, AirPods..."
                    className="w-full pl-8 pr-8 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-white/35 focus:outline-none focus:border-[var(--color-accent)]"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      aria-label="Clear AutoEQ search"
                      onClick={() => {
                        setSearchQuery('');
                        setSearchResults([]);
                      }}
                      className="absolute right-2.5 top-2.5 text-[var(--color-on-surface-variant)] hover:text-white cursor-pointer"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                {isSearching && (
                  <p className="text-[10px] text-[var(--color-on-surface-variant)] italic">
                    Searching 17,703 headphone calibration profiles...
                  </p>
                )}

                {/* Instant Scrollable Live Results List */}
                {searchQuery.trim().length > 0 && !isSearching && (
                  <div className="max-h-48 overflow-y-auto bg-[#141419] border border-white/15 rounded-xl shadow-xl divide-y divide-white/5">
                    {searchResults.length > 0 ? (
                      searchResults.map((res) => {
                        const rig = extractMeasurementRig(res.meta).rig;
                        return (
                          <button
                            key={`${res.id}-${res.name}`}
                            type="button"
                            onClick={() => void handleAutoEqSelect(res.name)}
                            className="w-full text-left px-3.5 py-2 hover:bg-white/10 flex items-center justify-between gap-2 text-xs transition-colors cursor-pointer group"
                          >
                            <span className="font-medium text-white group-hover:text-[var(--color-accent)] truncate">
                              {res.name}
                            </span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-neutral-200 font-medium">
                                {rig}
                              </span>
                              {res.parametric && (
                                <span className="text-[9px] px-1.5 py-0.5 bg-purple-500/20 text-purple-300 rounded font-mono">
                                  PaP
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="px-3.5 py-3 text-xs text-[var(--color-on-surface-variant)]">
                        No matching headphone profiles found for &ldquo;{searchQuery.trim()}&rdquo;.
                      </div>
                    )}
                  </div>
                )}

                {autoEqFeedback && (
                  <p className="text-[11px] text-amber-300">{autoEqFeedback}</p>
                )}

                {/* Popular Quick-Select Chips */}
                <div className="pt-2">
                  <span className="text-[10px] font-semibold text-[var(--color-on-surface-variant)] block mb-1.5">
                    Popular Models:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {POPULAR_HEADPHONES.map((hp) => {
                      const isActiveChip =
                        activeAutoEqName.toLowerCase() === hp.toLowerCase();
                      return (
                        <button
                          key={hp}
                          type="button"
                          onClick={() => void handleAutoEqSelect(hp)}
                          className={`text-[10px] px-2.5 py-1 rounded-full transition-all cursor-pointer ${
                            isActiveChip
                              ? 'bg-purple-500 text-white font-semibold'
                              : 'liquid-glass-pill text-[var(--color-on-surface-variant)] hover:text-white'
                          }`}
                        >
                          {hp}
                        </button>
                      );
                    })}
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
