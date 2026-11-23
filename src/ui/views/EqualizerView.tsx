// src/ui/views/EqualizerView.tsx
// 10-Band Interactive SVF Equalizer, live AutoEQ calibration search & curve overlay, and Spatial Audio

import React, { useState, useEffect, useRef } from 'react';
import { Sliders, Headphones, Layers, Sparkles, RotateCcw, Search, Check, X } from 'lucide-react';
import { usePlayerStore } from '../../state/playerStore';
import { useSettingsStore } from '../../state/settingsStore';
import { FACTORY_EQ_PRESETS } from '../../audio/DspChain';
import {
  AutoEqLoader,
  extractMeasurementRig,
  type AutoEqSearchResult,
} from '../../audio/AutoEqLoader';
import { InteractiveEqGraph } from '../components/InteractiveEqGraph';

const POPULAR_HEADPHONES = [
  'Sony WH-CH720N',
  'Sony WH-1000XM4',
  'Sony WH-1000XM5',
  'Sennheiser HD 600',
  'Sennheiser HD 650',
  'Audio-Technica ATH-M50x',
  'Beyerdynamic DT 770 Pro (80 Ohm)',
  'Beyerdynamic DT 990 Pro (250 Ohm)',
  'Apple AirPods Pro 2',
  'Apple AirPods Max',
  'Bose QuietComfort 45',
  'AKG K371',
] as const;

export const EqualizerView: React.FC = () => {
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

  // Live AutoEQ Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AutoEqSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [autoEqFeedback, setAutoEqFeedback] = useState<string | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeqRef = useRef<number>(0);
  const autoHydratedProfileRef = useRef<string | null>(null);

  // Sync reactively with settingsStore changes
  useEffect(() => {
    const savedBands = settings['dsp.equalizerBands'];
    if (Array.isArray(savedBands) && savedBands.length === 10) {
      setBands([...savedBands]);
    }
    if (settings['dsp.equalizerPreset']) {
      setActivePreset(settings['dsp.equalizerPreset']);
    }
    if (settings['dsp.spatialAudioEnabled'] !== undefined) {
      setSpatialEnabled(Boolean(settings['dsp.spatialAudioEnabled']));
    }
    if (typeof settings['dsp.spatialWidthGain'] === 'number') {
      setSpatialWidth(settings['dsp.spatialWidthGain']);
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
  }, [settings, activeAutoEqProfile, loadAutoEqProfile]);

  // Keep selectedAutoEq aligned if playerStore activeAutoEqProfile changes elsewhere
  useEffect(() => {
    if (activeAutoEqProfile?.name) {
      setSelectedAutoEq(activeAutoEqProfile.name);
    } else if (!settings['dsp.autoEqEnabled']) {
      setSelectedAutoEq('');
    }
  }, [activeAutoEqProfile, settings]);

  // Debounced live search across all 17,703 AutoEQ profiles
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

  const handleAutoEqSelect = async (profile: string) => {
    setAutoEqFeedback(null);
    if (!profile) {
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

    const ok = await loadAutoEqProfile(profile);
    const resolvedName = usePlayerStore.getState().activeAutoEqProfile?.name || profile;
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
      setAutoEqFeedback(`Could not load AutoEQ profile for "${profile}".`);
    }
  };

  const activeAutoEqName = activeAutoEqProfile?.name || selectedAutoEq;
  const activeAutoEqRig = activeAutoEqProfile?.source
    ? extractMeasurementRig(activeAutoEqProfile.source).rig
    : null;

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-12 animate-in fade-in duration-150">
      {/* View Header */}
      <div className="flex items-center justify-between gap-4">
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
          type="button"
          onClick={handleResetFlat}
          className="spring-press liquid-glass-pill flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold text-[var(--color-primary)] transition-all cursor-pointer shrink-0"
        >
          <RotateCcw size={14} />
          <span>Reset Flat</span>
        </button>
      </div>

      {/* 1. Interactive 10-Band SVF Equalizer Curve */}
      <section className="liquid-glass-card p-6 rounded-3xl space-y-5">
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
            {Object.keys(FACTORY_EQ_PRESETS).map((pName) => (
              <button
                key={pName}
                type="button"
                onClick={() => handleSelectPreset(pName)}
                className={`spring-press px-3 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
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

        <InteractiveEqGraph
          bands={bands}
          onChangeBand={handleBandChange}
          activeAutoEqProfile={activeAutoEqProfile}
          heightClassName="h-64"
        />
      </section>

      {/* 2. AutoEQ Headphone Calibration & Spatial Audio Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* AutoEQ Calibration Card */}
        <section className="liquid-glass-card p-6 rounded-3xl space-y-4 relative">
          <div className="flex items-center justify-between gap-2">
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
          </div>

          {/* Active AutoEQ Pill with Disable AutoEQ */}
          {activeAutoEqName && (
            <div className="flex items-center justify-between gap-2 p-3 rounded-2xl bg-purple-500/15 border border-purple-500/35">
              <div className="flex items-center gap-2 min-w-0">
                <Check size={14} className="text-purple-300 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white truncate">{activeAutoEqName}</div>
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
          )}

          {/* Live Search Input + Instant In-Flow Results List */}
          <div className="space-y-2">
            <label
              htmlFor="autoeq-search-view"
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
                id="autoeq-search-view"
                type="text"
                spellCheck={false}
                autoComplete="off"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search across 17,703 headphone models..."
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
                Searching 17,703 headphone profiles in database...
              </p>
            )}

            {/* Instant Scrollable Live Results List */}
            {searchQuery.trim().length > 0 && !isSearching && (
              <div className="max-h-52 overflow-y-auto bg-[#141419] border border-white/15 rounded-xl shadow-xl divide-y divide-white/5">
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

          <p className="text-[11px] text-[var(--color-on-surface-variant)] leading-relaxed">
            Applying AutoEQ dynamically compensates for your headphone acoustic response using multi-stage biquad filters and automatic headroom preamp attenuation.
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
