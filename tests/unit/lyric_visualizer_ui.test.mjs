// tests/unit/lyric_visualizer_ui.test.mjs
// Unit & behavioral integration test suite for Wave 2 Ticket 4:
// AudioEngine.sampleAudioMetrics, WaveFormPlaybackBridge, useLyricVisualizerStore,
// VisualizerControlBar, LyricStageControl, OverlayViewportApp, AmbientViewportApp,
// 8 bundled fonts (SF Pro Display default + 7 OFL @fontsource/* imports), hash routing, and NowPlayingScreen invariants.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

// Register ESM resolution hook for extensionless .ts/.tsx imports
const resolverHook = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && !specifier.endsWith('.ts') && !specifier.endsWith('.tsx') && !specifier.endsWith('.js') && !specifier.endsWith('.mjs')) {
      for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
        try {
          return await nextResolve(specifier + suffix, context);
        } catch {}
      }
    }
    throw err;
  }
}
`;
register(`data:text/javascript,${encodeURIComponent(resolverHook)}`, import.meta.url);

const { AudioEngine } = await import('../../src/audio/AudioEngine.ts');
const { usePlayerStore } = await import('../../src/state/playerStore.ts');
const { useLyricsStore } = await import('../../src/state/lyricsStore.ts');
const {
  BUNDLED_FONTS,
  DEFAULT_LYRIC_VISUALIZER_CONFIG,
  STARLIGHT_HARBOR_LYRICS,
  STARLIGHT_HARBOR_TRACK,
  VISUAL_STYLE_DEFINITIONS,
} = await import('../../src/lyricVisualizer/core/models.ts');
const {
  WaveFormPlaybackBridge,
  convertParsedLyricsToVisualizerLyrics,
  songToTrackInfo,
} = await import('../../src/lyricVisualizer/bridge/waveFormPlaybackBridge.ts');
const {
  useLyricVisualizerStore,
  MIN_FONT_SIZE_SCALE,
  MAX_FONT_SIZE_SCALE,
  MIN_OVERLAY_OPACITY,
  MAX_OVERLAY_OPACITY,
  MIN_BACKGROUND_OPACITY,
  MAX_BACKGROUND_OPACITY,
  MIN_VIGNETTE_STRENGTH,
  MAX_VIGNETTE_STRENGTH,
} = await import('../../src/lyricVisualizer/state/lyricVisualizerStore.ts');

function walkFiles(dir, result = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, result);
    } else if (/\.(ts|tsx|js|mjs|css)$/.test(entry.name)) {
      result.push(full);
    }
  }
  return result;
}

describe('Wave 2 Ticket 4: LyricVisualizer Audio, Bridge, Store, OFL Fonts, Routing & UI', () => {
  let origWindow;
  let origLocalStorageDesc;

  beforeEach(() => {
    origWindow = globalThis.window;
    origLocalStorageDesc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  });

  afterEach(() => {
    usePlayerStore.getState().cleanupEngine();
    if (origWindow === undefined) delete globalThis.window;
    else globalThis.window = origWindow;
    if (origLocalStorageDesc) Object.defineProperty(globalThis, 'localStorage', origLocalStorageDesc);
    else delete globalThis.localStorage;
  });

  test('1. main.tsx statically imports all 7 OFL @fontsource/* packages and routes #/overlay, #/ambient, and App', () => {
    const mainSrc = fs.readFileSync(path.join(rootDir, 'src/main.tsx'), 'utf8');

    const expectedPackages = [
      '@fontsource/inter',
      '@fontsource/plus-jakarta-sans',
      '@fontsource/instrument-serif',
      '@fontsource/fraunces',
      '@fontsource/space-grotesk',
      '@fontsource/jetbrains-mono',
      '@fontsource/outfit',
    ];

    assert.strictEqual(BUNDLED_FONTS.length, 8);
    assert.strictEqual(BUNDLED_FONTS[0].id, 'SFProDisplay');
    assert.strictEqual(DEFAULT_LYRIC_VISUALIZER_CONFIG.fontId, 'SFProDisplay');
    for (const pkg of expectedPackages) {
      assert.ok(
        mainSrc.includes(`import '${pkg}';`) || mainSrc.includes(`import "${pkg}";`),
        `src/main.tsx must contain static import for ${pkg}`
      );
    }

    assert.ok(mainSrc.includes("startsWith('#/overlay')"), 'src/main.tsx must route #/overlay');
    assert.ok(mainSrc.includes("startsWith('#/ambient')"), 'src/main.tsx must route #/ambient');
    assert.ok(mainSrc.includes('<OverlayViewportApp'), 'src/main.tsx must render OverlayViewportApp');
    assert.ok(mainSrc.includes('<AmbientViewportApp'), 'src/main.tsx must render AmbientViewportApp');
    assert.ok(mainSrc.includes('<App'), 'src/main.tsx must render default App');
  });

  test('2. Zero forbidden Apple SF Symbols, SF Mono, or SF Compact anywhere in src/lyricVisualizer/** and SF Pro Display wired cleanly', () => {
    const lvDir = path.join(rootDir, 'src/lyricVisualizer');
    const files = walkFiles(lvDir);
    assert.ok(files.length >= 10, 'src/lyricVisualizer should contain core, rendering, bridge, state, and ui files');

    const forbiddenPatterns = [
      /SF\s*Symbols/i,
      /SF\s*Mono/i,
      /SF\s*Compact/i,
      /New\s*York\s*Serif/i,
    ];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      for (const pattern of forbiddenPatterns) {
        assert.ok(
          !pattern.test(content),
          `Forbidden Apple font/symbol reference (${pattern}) found in ${path.relative(rootDir, file)}`
        );
      }
    }

    const modelsSrc = fs.readFileSync(path.join(lvDir, 'core/models.ts'), 'utf8');
    const iosSrc = fs.readFileSync(path.join(lvDir, 'rendering/styles/iosTextingMotion.ts'), 'utf8');
    assert.ok(modelsSrc.includes("SF_PRO_DISPLAY_STACK = \"'SF Pro Display'"));
    assert.ok(iosSrc.includes("IOS_FONT_STACK = \"'SF Pro Display'"));
  });

  test('3. Sandbox "Starlight Harbor" demo track and lyrics are original, non-copyrighted, and word-synced', () => {
    assert.strictEqual(STARLIGHT_HARBOR_TRACK.title, 'Starlight Harbor');
    assert.strictEqual(STARLIGHT_HARBOR_TRACK.artist, 'WaveForm Studio');
    assert.ok(STARLIGHT_HARBOR_TRACK.durationSeconds >= 30);

    assert.strictEqual(STARLIGHT_HARBOR_LYRICS.sourceKind, 'WordSynced');
    assert.ok(STARLIGHT_HARBOR_LYRICS.lines.length >= 5);
    assert.ok(
      STARLIGHT_HARBOR_LYRICS.copyrightNotice?.toLowerCase().includes('original'),
      'Sandbox lyrics must carry original public-domain attribution'
    );

    for (const line of STARLIGHT_HARBOR_LYRICS.lines) {
      assert.ok(line.text.length > 0);
      assert.ok(line.endSeconds > line.startSeconds);
      assert.ok(line.words.length >= 3, 'Each sandbox line must have per-word timings');
      for (let i = 0; i < line.words.length; i++) {
        const w = line.words[i];
        assert.ok(w.endSeconds > w.startSeconds);
        if (i > 0) {
          assert.ok(w.startSeconds >= line.words[i - 1].startSeconds);
        }
      }
    }
  });

  test('4. AudioEngine.sampleAudioMetrics computes RMS/Bass/Mid/Treble/Beat without allocating when out is passed, and returns 0 when inactive', () => {
    // 4a. Headless / inactive AudioContext returns zeroed metrics in-place
    const inactiveEngine = new AudioEngine(null);
    const reusableOut = {
      rmsLevel: 0.9,
      bassEnergy: 0.9,
      midEnergy: 0.9,
      trebleEnergy: 0.9,
      beatDetected: true,
    };
    const ret1 = inactiveEngine.sampleAudioMetrics(reusableOut);
    assert.strictEqual(ret1, reusableOut, 'sampleAudioMetrics must mutate and return the passed `out` reference');
    assert.strictEqual(ret1.rmsLevel, 0);
    assert.strictEqual(ret1.bassEnergy, 0);
    assert.strictEqual(ret1.midEnergy, 0);
    assert.strictEqual(ret1.trebleEnergy, 0);
    assert.strictEqual(ret1.beatDetected, false);

    // 4b. Active AudioContext with synthetic time-domain & frequency data
    const mockAnalyser = {
      fftSize: 1024,
      frequencyBinCount: 512,
      smoothingTimeConstant: 0.8,
      connect() {},
      getFloatTimeDomainData(buf) {
        for (let i = 0; i < buf.length; i++) {
          buf[i] = Math.sin(i * 0.15) * 0.65;
        }
      },
      getFloatFrequencyData(buf) {
        for (let i = 0; i < buf.length; i++) {
          // Strong bass (bins 1..6), moderate mid (bins 6..93), mild treble (bins 93..372)
          if (i >= 1 && i <= 6) buf[i] = -35; // high bass dB
          else if (i > 6 && i <= 93) buf[i] = -55; // mid dB
          else if (i > 93 && i <= 372) buf[i] = -70; // treble dB
          else buf[i] = -110;
        }
      },
    };

    const mockCtx = {
      state: 'running',
      sampleRate: 44100,
      currentTime: 0,
      destination: { connect() {} },
      createGain() {
        return {
          gain: { value: 1, setValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} },
          connect() {},
        };
      },
      createAnalyser() {
        return mockAnalyser;
      },
      createBiquadFilter() {
        return {
          type: 'peaking',
          Q: { value: 1, setValueAtTime() {} },
          frequency: { value: 1000, setValueAtTime() {} },
          gain: { value: 0, setValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} },
          connect() {},
        };
      },
    };

    const activeEngine = new AudioEngine(mockCtx);
    const ret2 = activeEngine.sampleAudioMetrics(reusableOut);
    assert.strictEqual(ret2, reusableOut);
    assert.ok(ret2.rmsLevel > 0.3 && ret2.rmsLevel <= 1.0, `Expected active rmsLevel > 0.3, got ${ret2.rmsLevel}`);
    assert.ok(ret2.bassEnergy > ret2.midEnergy, `Expected bassEnergy (${ret2.bassEnergy}) > midEnergy (${ret2.midEnergy})`);
    assert.ok(ret2.midEnergy > ret2.trebleEnergy, `Expected midEnergy (${ret2.midEnergy}) > trebleEnergy (${ret2.trebleEnergy})`);
    assert.strictEqual(ret2.beatDetected, true, 'Strong initial bass spike should trigger beat onset');

    // 4c. If active deck switches to CORS direct fallback, sampleAudioMetrics gracefully zeroes out
    activeEngine.deckA.usingDirectFallback = true;
    const ret3 = activeEngine.sampleAudioMetrics(reusableOut);
    assert.strictEqual(ret3.rmsLevel, 0);
    assert.strictEqual(ret3.bassEnergy, 0);
    assert.strictEqual(ret3.beatDetected, false);
  });

  test('5. WaveFormPlaybackBridge adapts ParsedLyrics -> Lyrics and runs Sandbox "Starlight Harbor" simulator', () => {
    const parsed = {
      type: 'SYLLABLE_SYNCED',
      provider: 'AppleMusic',
      isSynced: true,
      lines: [
        {
          lineIndex: 0,
          startTimeMs: 1000,
          endTimeMs: 4000,
          text: 'Hello bright world',
          syllables: [
            { text: 'Hello', startTimeMs: 1000, endTimeMs: 1800 },
            { text: 'bright', startTimeMs: 1800, endTimeMs: 2800 },
            { text: 'world', startTimeMs: 2800, endTimeMs: 4000 },
          ],
        },
      ],
    };

    const converted = convertParsedLyricsToVisualizerLyrics(parsed);
    assert.ok(converted);
    assert.strictEqual(converted.sourceKind, 'WordSynced');
    assert.strictEqual(converted.lines.length, 1);
    assert.strictEqual(converted.lines[0].startSeconds, 1);
    assert.strictEqual(converted.lines[0].endSeconds, 4);
    assert.strictEqual(converted.lines[0].words.length, 3);
    assert.strictEqual(converted.lines[0].words[1].text, 'bright');

    const bridge = new WaveFormPlaybackBridge(true);
    assert.strictEqual(bridge.isSandboxMode, true);
    assert.strictEqual(bridge.currentSnapshot.track?.id, STARLIGHT_HARBOR_TRACK.id);
    assert.strictEqual(bridge.currentSnapshot.isPlaying, true);
    assert.strictEqual(bridge.getCurrentLyrics()?.lines.length, STARLIGHT_HARBOR_LYRICS.lines.length);

    let seekedTo = -1;
    let lastPlayState = true;
    bridge.onSeeked((pos) => {
      seekedTo = pos;
    });
    bridge.onPlaybackStateChanged((playing) => {
      lastPlayState = playing;
    });

    bridge.pause();
    assert.strictEqual(lastPlayState, false);
    assert.strictEqual(bridge.currentSnapshot.isPlaying, false);

    bridge.seek(14.5);
    assert.strictEqual(seekedTo, 14.5);
    assert.ok(Math.abs(bridge.currentSnapshot.positionSeconds - 14.5) < 0.05);

    bridge.play();
    assert.strictEqual(lastPlayState, true);
    const metrics = bridge.sampleAudioMetrics();
    assert.ok(metrics.rmsLevel > 0);
    assert.ok(metrics.bassEnergy > 0);

    bridge.dispose();
  });

  test('6. useLyricVisualizerStore clamps offsets (-2000..+2000ms), font scale (0.7..1.8), overlay opacity (0.2..1.0), and syncs IPC', async () => {
    const ipcCalls = {
      overlayConfigs: [],
      ambientSettings: [],
      songOffsets: [],
      broadcasts: [],
      openAmbient: [],
      closeAmbient: 0,
    };

    const storageMap = new Map();
    const mockStorage = {
      getItem: (k) => storageMap.get(k) ?? null,
      setItem: (k, v) => storageMap.set(k, String(v)),
    };
    const activeStorage = typeof globalThis.localStorage?.getItem === 'function' ? globalThis.localStorage : mockStorage;
    if (activeStorage === mockStorage) {
      Object.defineProperty(globalThis, 'localStorage', { value: mockStorage, configurable: true, writable: true });
    }
    globalThis.window = {
      localStorage: activeStorage,
      electronAPI: {
        lvGetMonitors: async () => [
          { id: 'disp-1', label: 'Primary 4K', isPrimary: true },
          { id: 'disp-2', label: 'Secondary Ultrawide', isPrimary: false },
        ],
        lvSetOverlayConfig: (cfg) => ipcCalls.overlayConfigs.push(cfg),
        lvSetAmbientSettings: (cfg) => ipcCalls.ambientSettings.push(cfg),
        lvOpenAmbient: (keepAwake) => ipcCalls.openAmbient.push(keepAwake),
        lvCloseAmbient: () => {
          ipcCalls.closeAmbient++;
        },
        lvGetSongOffset: async (key) => (key === 'remote-song' ? -350 : 0),
        lvSetSongOffset: (key, offset) => ipcCalls.songOffsets.push({ key, offset }),
        lvBroadcastState: (payload) => ipcCalls.broadcasts.push(payload),
      },
    };

    const store = useLyricVisualizerStore.getState();

    // 6a. 12 Consolidated Visual Styles (including Editorial, SolariSplitFlap, StudioDawTimeline & MotionGeometry), legacy migrations, & 8 Bundled Fonts
    assert.strictEqual(VISUAL_STYLE_DEFINITIONS.length, 12);
    assert.ok(
      VISUAL_STYLE_DEFINITIONS.some((s) => s.id === 'IosTextingMotion'),
      'VISUAL_STYLE_DEFINITIONS must include IosTextingMotion'
    );
    assert.ok(
      VISUAL_STYLE_DEFINITIONS.some((s) => s.id === 'Editorial'),
      'VISUAL_STYLE_DEFINITIONS must include Editorial'
    );
    assert.ok(
      VISUAL_STYLE_DEFINITIONS.some((s) => s.id === 'SolariSplitFlap'),
      'VISUAL_STYLE_DEFINITIONS must include SolariSplitFlap'
    );
    assert.ok(
      VISUAL_STYLE_DEFINITIONS.some((s) => s.id === 'StudioDawTimeline'),
      'VISUAL_STYLE_DEFINITIONS must include StudioDawTimeline'
    );
    assert.ok(
      VISUAL_STYLE_DEFINITIONS.some((s) => s.id === 'MotionGeometry'),
      'VISUAL_STYLE_DEFINITIONS must include MotionGeometry'
    );
    assert.ok(
      VISUAL_STYLE_DEFINITIONS.some((s) => s.id === 'CodeEditorKinetic'),
      'VISUAL_STYLE_DEFINITIONS must include CodeEditorKinetic'
    );
    for (const style of VISUAL_STYLE_DEFINITIONS) {
      store.setStyleId(style.id);
      assert.strictEqual(useLyricVisualizerStore.getState().config.styleId, style.id);
    }
    store.setStyleId('HoloVaporwave');
    assert.strictEqual(useLyricVisualizerStore.getState().config.styleId, 'LiquidMetal');
    assert.strictEqual(useLyricVisualizerStore.getState().config.variationByStyle?.LiquidMetal, 'holo-vaporwave');
    store.setStyleId('SpectrumRibbon');
    assert.strictEqual(useLyricVisualizerStore.getState().config.styleId, 'GenerativeParticleInk');
    assert.strictEqual(useLyricVisualizerStore.getState().config.variationByStyle?.GenerativeParticleInk, 'spectrum-ribbon');
    store.setStyleId('FisheyeKinetic');
    assert.strictEqual(useLyricVisualizerStore.getState().config.styleId, 'AppleMusicFlow');
    store.setStyleId('KaraokeStage');
    assert.strictEqual(useLyricVisualizerStore.getState().config.styleId, 'AppleMusicFlow');
    assert.strictEqual(useLyricVisualizerStore.getState().config.variationByStyle?.AppleMusicFlow, 'karaoke-stage');
    store.setStyleId('TypewriterEditorial');
    assert.strictEqual(useLyricVisualizerStore.getState().config.styleId, 'Editorial');
    assert.strictEqual(useLyricVisualizerStore.getState().config.variationByStyle?.Editorial, 'typewriter');

    store.setWordIconsEnabled(false);
    assert.strictEqual(useLyricVisualizerStore.getState().config.wordIconsEnabled, false);
    store.setWordIconsEnabled(true);
    store.setIosKineticPopup(true);
    assert.strictEqual(useLyricVisualizerStore.getState().config.iosKineticPopup, true);
    store.setMapScene('highway');
    assert.strictEqual(useLyricVisualizerStore.getState().config.mapScene, 'highway');
    store.setMapTimeOfDay('sunset');
    assert.strictEqual(useLyricVisualizerStore.getState().config.mapTimeOfDay, 'sunset');
    const exportedJson = store.exportStylePreset();
    store.setMapScene('countryside');
    assert.strictEqual(store.importStylePreset(exportedJson), true);
    assert.strictEqual(useLyricVisualizerStore.getState().config.mapScene, 'highway');
    assert.strictEqual(store.importStylePreset('{invalid-json'), false);

    store.setNowPlayingLayout('centered');
    assert.strictEqual(useLyricVisualizerStore.getState().config.nowPlayingLayout, 'lyrics-focus');
    store.setNowPlayingLayout('artwork-focus');
    assert.strictEqual(useLyricVisualizerStore.getState().config.nowPlayingLayout, 'artwork-focus');
    store.setNowPlayingLayout('centered');
    store.setHideAlbumCover(true);
    store.setBackgroundOpacity(0.05);
    assert.strictEqual(useLyricVisualizerStore.getState().config.backgroundOpacity, MIN_BACKGROUND_OPACITY);
    store.setBackgroundOpacity(1.8);
    assert.strictEqual(useLyricVisualizerStore.getState().config.backgroundOpacity, MAX_BACKGROUND_OPACITY);
    store.setVignetteStrength(-0.5);
    assert.strictEqual(useLyricVisualizerStore.getState().config.vignetteStrength, MIN_VIGNETTE_STRENGTH);
    store.setVignetteStrength(2.5);
    assert.strictEqual(useLyricVisualizerStore.getState().config.vignetteStrength, MAX_VIGNETTE_STRENGTH);
    store.setTextAlign('left');
    store.setTextAlign('invalid');
    assert.strictEqual(useLyricVisualizerStore.getState().config.textAlign, 'left');
    const persisted = JSON.parse(activeStorage.getItem('waveform.lyricVisualizer.v1'));
    assert.strictEqual(persisted.config.nowPlayingLayout, 'lyrics-focus');
    assert.strictEqual(persisted.config.hideAlbumCover, true);
    assert.strictEqual(persisted.config.backgroundOpacity, MAX_BACKGROUND_OPACITY);
    assert.strictEqual(persisted.config.vignetteStrength, MAX_VIGNETTE_STRENGTH);
    assert.strictEqual(persisted.config.textAlign, 'left');
    for (const font of BUNDLED_FONTS) {
      store.setFontId(font.id);
      assert.strictEqual(useLyricVisualizerStore.getState().config.fontId, font.id);
    }
    for (const intensity of ['subtle', 'normal', 'vivid']) {
      store.setMotionIntensity(intensity);
      assert.strictEqual(useLyricVisualizerStore.getState().config.motionIntensity, intensity);
    }

    // 6b. Typography size scale clamping [0.7, 1.8]
    store.setFontSizeScale(0.2);
    assert.strictEqual(useLyricVisualizerStore.getState().config.fontSizeScale, MIN_FONT_SIZE_SCALE);
    store.setFontSizeScale(3.5);
    assert.strictEqual(useLyricVisualizerStore.getState().config.fontSizeScale, MAX_FONT_SIZE_SCALE);
    store.setFontSizeScale(1.25);
    assert.strictEqual(useLyricVisualizerStore.getState().config.fontSizeScale, 1.25);

    // 6b2. v1.3.2 Beat Camera Thump (default true) & iOS Kinetic Zoom clamping [0.75, 1.85]
    assert.strictEqual(DEFAULT_LYRIC_VISUALIZER_CONFIG.beatCameraThump, true);
    assert.strictEqual(DEFAULT_LYRIC_VISUALIZER_CONFIG.iosKineticZoom, 1.45);
    store.setBeatCameraThump(false);
    assert.strictEqual(useLyricVisualizerStore.getState().config.beatCameraThump, false);
    store.setBeatCameraThump(true);
    assert.strictEqual(useLyricVisualizerStore.getState().config.beatCameraThump, true);
    store.setIosKineticZoom(0.2);
    assert.strictEqual(useLyricVisualizerStore.getState().config.iosKineticZoom, 0.75);
    store.setIosKineticZoom(2.9);
    assert.strictEqual(useLyricVisualizerStore.getState().config.iosKineticZoom, 1.85);
    store.setIosKineticZoom(1.45);
    assert.strictEqual(useLyricVisualizerStore.getState().config.iosKineticZoom, 1.45);

    // 6c. Per-song timing offset clamping [-2000, +2000], +/-50ms nudge, reset, and IPC persistence
    await store.setCurrentSongKey('song-alpha');
    store.setSongOffsetMs(5000);
    assert.strictEqual(useLyricVisualizerStore.getState().currentSongOffsetMs, 2000);
    store.setSongOffsetMs(-4500);
    assert.strictEqual(useLyricVisualizerStore.getState().currentSongOffsetMs, -2000);
    store.setSongOffsetMs(0);
    store.nudgeSongOffsetMs(50);
    assert.strictEqual(useLyricVisualizerStore.getState().currentSongOffsetMs, 50);
    store.nudgeSongOffsetMs(-150);
    assert.strictEqual(useLyricVisualizerStore.getState().currentSongOffsetMs, -100);
    store.resetSongOffsetMs();
    assert.strictEqual(useLyricVisualizerStore.getState().currentSongOffsetMs, 0);
    assert.ok(ipcCalls.songOffsets.some((c) => c.key === 'song-alpha' && c.offset === 0));

    // Separate Auto-Sync offset clamping [-15000, +15000]
    store.setAutoSyncOffsetMs(6200);
    assert.strictEqual(useLyricVisualizerStore.getState().currentAutoSyncOffsetMs, 6200);
    store.setAutoSyncOffsetMs(25000);
    assert.strictEqual(useLyricVisualizerStore.getState().currentAutoSyncOffsetMs, 15000);
    store.resetAutoSyncOffsetMs();
    assert.strictEqual(useLyricVisualizerStore.getState().currentAutoSyncOffsetMs, 0);

    // Remote IPC offset loading
    await store.setCurrentSongKey('remote-song');
    assert.strictEqual(useLyricVisualizerStore.getState().currentSongOffsetMs, -350);

    // 6d. Multi-monitor overlay selection, opacity clamping [0.2, 1.0], click-through lock
    const monitors = await store.refreshMonitors();
    assert.strictEqual(monitors.length, 2);
    store.setOverlayEnabled(true);
    store.toggleOverlayMonitor('disp-2');
    store.setOverlayOpacity(0.05);
    assert.strictEqual(useLyricVisualizerStore.getState().config.overlayOpacity, MIN_OVERLAY_OPACITY);
    store.setOverlayOpacity(1.5);
    assert.strictEqual(useLyricVisualizerStore.getState().config.overlayOpacity, MAX_OVERLAY_OPACITY);
    store.setOverlayLocked(true);
    assert.strictEqual(useLyricVisualizerStore.getState().config.overlayLocked, true);
    assert.ok(ipcCalls.overlayConfigs.length > 0);
    const lastOverlayCfg = ipcCalls.overlayConfigs[ipcCalls.overlayConfigs.length - 1];
    assert.strictEqual(lastOverlayCfg.locked, true);
    assert.strictEqual(lastOverlayCfg.enabled, true);

    // 6e. Ambient mode, idle trigger, keep-awake, game guard, and sandbox toggle
    store.setIdleAmbientSeconds(120);
    store.setKeepAwakeInAmbient(true);
    store.setGameGuardEnabled(true);
    assert.strictEqual(useLyricVisualizerStore.getState().config.idleAmbientSeconds, 120);
    await store.openAmbientMode();
    assert.strictEqual(useLyricVisualizerStore.getState().isAmbientOpen, true);
    assert.strictEqual(ipcCalls.openAmbient[0], true);
    await store.closeAmbientMode();
    assert.strictEqual(useLyricVisualizerStore.getState().isAmbientOpen, false);
    assert.strictEqual(ipcCalls.closeAmbient, 1);

    store.setSandboxEnabled(true);
    assert.strictEqual(useLyricVisualizerStore.getState().config.sandboxEnabled, true);
    assert.strictEqual(useLyricVisualizerStore.getState().activeTrack?.id, STARLIGHT_HARBOR_TRACK.id);
    store.setSandboxEnabled(false);

    // 6f. In-app fullscreen portal path when setFullscreen + lvSetKeepAwake exist on electronAPI
    const fsCalls = [];
    const keepAwakeCalls = [];
    let legacyOpenAmbientCount = 0;
    globalThis.window = {
      electronAPI: {
        setFullscreen: async (flag) => {
          fsCalls.push(flag);
          return flag;
        },
        lvSetKeepAwake: async (flag) => {
          keepAwakeCalls.push(flag);
          return flag;
        },
        lvOpenAmbient: () => {
          legacyOpenAmbientCount++;
        },
        lvBroadcastState: (payload) => ipcCalls.broadcasts.push(payload),
      },
    };
    store.setKeepAwakeInAmbient(true);
    await store.openAmbientMode();
    assert.strictEqual(useLyricVisualizerStore.getState().isAmbientOpen, true);
    assert.deepStrictEqual(fsCalls, [true]);
    assert.deepStrictEqual(keepAwakeCalls, [true]);
    assert.strictEqual(legacyOpenAmbientCount, 0, 'Must use setFullscreen instead of lvOpenAmbient when available');
    await store.closeAmbientMode();
    assert.strictEqual(useLyricVisualizerStore.getState().isAmbientOpen, false);
    assert.deepStrictEqual(fsCalls, [true, false]);
    assert.deepStrictEqual(keepAwakeCalls, [true, false]);

    // 6g. Broadcast revisionId ordering guard and trackId-change lyrics clearing
    useLyricVisualizerStore.setState({ lastAppliedRevisionId: 0, activeTrack: null, activeLyrics: null });
    const trackA = { id: 'track-a', title: 'Song A', artist: 'Artist A', durationSeconds: 200 };
    const trackB = { id: 'track-b', title: 'Song B', artist: 'Artist B', durationSeconds: 180 };
    const lyricsA = {
      providerName: 'Test',
      sourceKind: 'LineSynced',
      lines: [{ startSeconds: 1, endSeconds: 4, text: 'Line from A', words: [], isSynthesizedWords: false }],
    };
    store.applyBroadcastPayload({
      revisionId: 10,
      trackId: 'track-a',
      config: DEFAULT_LYRIC_VISUALIZER_CONFIG,
      track: trackA,
      lyrics: lyricsA,
      palette: useLyricVisualizerStore.getState().activePalette,
      positionSeconds: 2,
      isPlaying: true,
      songOffsetMs: 0,
      audio: { rmsLevel: 0, bassEnergy: 0, midEnergy: 0, trebleEnergy: 0, beatDetected: false },
      isScreenLocked: false,
      timestampMs: 1000,
    });
    assert.strictEqual(useLyricVisualizerStore.getState().activeTrack?.id, 'track-a');
    assert.strictEqual(useLyricVisualizerStore.getState().activeLyrics?.lines[0].text, 'Line from A');

    // Stale older revisionId must be rejected
    store.applyBroadcastPayload({
      revisionId: 8,
      trackId: 'track-stale',
      config: DEFAULT_LYRIC_VISUALIZER_CONFIG,
      track: { id: 'track-stale', title: 'Stale', artist: 'Stale', durationSeconds: 100 },
      lyrics: null,
      palette: useLyricVisualizerStore.getState().activePalette,
      positionSeconds: 0,
      isPlaying: false,
      songOffsetMs: 0,
      audio: { rmsLevel: 0, bassEnergy: 0, midEnergy: 0, trebleEnergy: 0, beatDetected: false },
      isScreenLocked: false,
      timestampMs: 900,
    });
    assert.strictEqual(useLyricVisualizerStore.getState().activeTrack?.id, 'track-a', 'Stale revisionId must be rejected');

    // New revisionId with changed trackId and omitted/null lyrics must immediately clear activeLyrics
    store.applyBroadcastPayload({
      revisionId: 11,
      trackId: 'track-b',
      config: DEFAULT_LYRIC_VISUALIZER_CONFIG,
      track: trackB,
      lyrics: null,
      palette: useLyricVisualizerStore.getState().activePalette,
      positionSeconds: 0,
      isPlaying: true,
      songOffsetMs: 0,
      audio: { rmsLevel: 0, bassEnergy: 0, midEnergy: 0, trebleEnergy: 0, beatDetected: false },
      isScreenLocked: false,
      timestampMs: 1100,
    });
    assert.strictEqual(useLyricVisualizerStore.getState().activeTrack?.id, 'track-b');
    assert.strictEqual(useLyricVisualizerStore.getState().activeLyrics, null, 'activeLyrics must clear immediately on trackId change');

    // broadcastSnapshot includes monotonic revisionId and trackId
    const beforeLen = ipcCalls.broadcasts.length;
    store.broadcastSnapshot({ track: trackB, positionSeconds: 5 }, true);
    store.broadcastSnapshot({ track: trackB, positionSeconds: 6 }, true);
    assert.ok(ipcCalls.broadcasts.length >= beforeLen + 2);
    const snap1 = ipcCalls.broadcasts[ipcCalls.broadcasts.length - 2];
    const snap2 = ipcCalls.broadcasts[ipcCalls.broadcasts.length - 1];
    assert.strictEqual(snap2.trackId, 'track-b');
    assert.ok(typeof snap1.revisionId === 'number' && snap2.revisionId > snap1.revisionId);

    // Reset config back to defaults
    useLyricVisualizerStore.setState({
      config: DEFAULT_LYRIC_VISUALIZER_CONFIG,
      lastAppliedRevisionId: 0,
      activeTrack: null,
      activeLyrics: null,
    });
  });

  test('7. UI components and NowPlayingScreen preserve ArtistCredits, volume wheel invariants, VisualizerContextMenu, quality badges, and portal integration', () => {
    const nowPlayingSrc = fs.readFileSync(path.join(rootDir, 'src/ui/player/NowPlayingScreen.tsx'), 'utf8');
    const stageSrc = fs.readFileSync(path.join(rootDir, 'src/lyricVisualizer/ui/LyricStageControl.tsx'), 'utf8');
    const overlaySrc = fs.readFileSync(path.join(rootDir, 'src/lyricVisualizer/ui/OverlayViewportApp.tsx'), 'utf8');
    const ambientSrc = fs.readFileSync(path.join(rootDir, 'src/lyricVisualizer/ui/AmbientViewportApp.tsx'), 'utf8');
    const vizMenuSrc = fs.readFileSync(path.join(rootDir, 'src/ui/common/VisualizerContextMenu.tsx'), 'utf8');
    const appSrc = fs.readFileSync(path.join(rootDir, 'src/App.tsx'), 'utf8');

    // NowPlayingScreen regression invariants
    assert.ok(nowPlayingSrc.includes('<ArtistCredits'), 'NowPlayingScreen must render ArtistCredits');
    assert.ok(
      nowPlayingSrc.includes('onClose(); navigateToArtist(id);'),
      'NowPlayingScreen must close and navigate on artist click'
    );
    const stripComments = (src) => src.replace(/\/\/.*$/gm, '');
    assert.ok(
      !stripComments(nowPlayingSrc).includes('if (isMuted) toggleMute()'),
      'NowPlayingScreen must not call stale toggleMute in slider onChange'
    );
    assert.ok(nowPlayingSrc.includes('onWheel='), 'NowPlayingScreen volume container must support wheel adjustments');
    assert.ok(nowPlayingSrc.includes('<LyricStageControl'), 'NowPlayingScreen must integrate LyricStageControl');
    assert.ok(nowPlayingSrc.includes('<SyllableLyricsEngine'), 'NowPlayingScreen must preserve SyllableLyricsEngine');
    assert.ok(nowPlayingSrc.includes('showControls={false}'), 'NowPlayingScreen must hide VisualizerControlBar clutter');
    assert.ok(nowPlayingSrc.includes('isBackdrop={true}'), 'NowPlayingScreen must mount LyricStageControl as full-bleed unified backdrop');
    assert.ok(nowPlayingSrc.includes('contentInsetLeft={splitContentInsetLeft}'), 'NowPlayingScreen must pass splitContentInsetLeft to LyricStageControl');
    assert.ok(nowPlayingSrc.includes('blendWithParent={false}'), 'NowPlayingScreen unified backdrop LyricStageControl must set blendWithParent={false}');
    assert.ok(!nowPlayingSrc.includes('liquid-glass-capsule'), 'NowPlayingScreen transport controls must be borderless without liquid-glass-capsule pill');
    assert.ok(!nowPlayingSrc.includes('bg-white text-black'), 'NowPlayingScreen Play/Pause control must be borderless without bg-white text-black circle');
    assert.ok(nowPlayingSrc.includes('data-testid="full-bleed-visualizer-toggle"'), 'NowPlayingScreen must expose full-bleed visualizer toggle');
    assert.ok(nowPlayingSrc.includes('data-testid="lyrics-visualizer-toggle"'), 'NowPlayingScreen must expose lyrics/visualizer toggle');
    assert.ok(nowPlayingSrc.includes('data-testid="now-playing-queue-toggle"'), 'NowPlayingScreen must expose queue toggle');
    assert.ok(nowPlayingSrc.includes('<VisualizerContextMenu'), 'NowPlayingScreen must mount VisualizerContextMenu');
    assert.ok(nowPlayingSrc.includes('activeStreamQuality'), 'NowPlayingScreen quality pill must bind to activeStreamQuality');
    assert.ok(nowPlayingSrc.includes('activeStreamIsAtmos'), 'NowPlayingScreen Atmos pill must bind strictly to activeStreamIsAtmos');
    assert.ok(!nowPlayingSrc.includes("dsp.spatialAudioEnabled"), 'NowPlayingScreen must remove fake dsp.spatialAudioEnabled Atmos pill');

    // VisualizerContextMenu invariants
    assert.ok(vizMenuSrc.includes('liquid-glass-capsule'), 'VisualizerContextMenu must use liquid-glass-capsule');
    assert.ok(vizMenuSrc.includes("position: 'fixed'") && vizMenuSrc.includes('zIndex: 9999'));
    assert.ok(vizMenuSrc.includes('flipSubmenuLeft'), 'VisualizerContextMenu must support flipSubmenuLeft');
    assert.ok(vizMenuSrc.includes('VISUAL_STYLE_DEFINITIONS') && vizMenuSrc.includes('BUNDLED_FONTS'));
    assert.ok(vizMenuSrc.includes('nudgeSongOffsetMs(-1000)') && vizMenuSrc.includes('nudgeSongOffsetMs(1000)'));
    assert.ok(vizMenuSrc.includes('nudgeSongOffsetMs(-100)') && vizMenuSrc.includes('nudgeSongOffsetMs(100)'));
    assert.ok(vizMenuSrc.includes('resetSongOffsetMs'), 'VisualizerContextMenu must support offset reset');

    // LyricStageControl invariants
    assert.ok(
      stageSrc.includes('showControls = false'),
      'LyricStageControl must default showControls to false'
    );
    assert.ok(
      stageSrc.includes('isEmbeddedTransparent: blendWithParent'),
      'LyricStageControl must forward blendWithParent as isEmbeddedTransparent'
    );
    assert.ok(
      stageSrc.includes('Demo: Starlight Harbor (Original)'),
      'LyricStageControl must display "Demo: Starlight Harbor (Original)" badge in sandbox mode'
    );
    assert.ok(
      stageSrc.includes('findLineAtPoint'),
      'LyricStageControl must support click-line-to-seek via findLineAtPoint'
    );
    assert.ok(
      stageSrc.includes('shipCanvasRef') && stageSrc.includes('shipCanvas,'),
      'LyricStageControl must mount and forward the dedicated Three.js shipCanvas layer'
    );
    assert.ok(
      stageSrc.includes('config.scriptMode') && stageSrc.includes('isInstrumentalGap'),
      'LyricStageControl must forward scriptMode and SyncEngine instrumental gap telemetry'
    );

    // OverlayViewportApp, AmbientViewportApp & App.tsx portal invariants
    assert.ok(
      appSrc.includes('<AmbientViewportApp inAppPortal'),
      'App.tsx must render AmbientViewportApp as an in-app portal when isAmbientOpen is true'
    );
    assert.ok(
      overlaySrc.includes('onLvStateBroadcast') && overlaySrc.includes('onLvPlatformEvent'),
      'OverlayViewportApp must subscribe to onLvStateBroadcast and onLvPlatformEvent'
    );
    assert.ok(
      overlaySrc.includes('lvRequestSnapshot'),
      'OverlayViewportApp must request initial broadcast snapshot on mount'
    );
    assert.ok(
      !overlaySrc.includes('?? STARLIGHT_HARBOR_LYRICS'),
      'OverlayViewportApp must never unconditionally fall back to STARLIGHT_HARBOR_LYRICS'
    );
    assert.ok(
      ambientSrc.includes('power-lock') && ambientSrc.includes('setLocked(locked)'),
      'AmbientViewportApp must halt GPU rendering via setLocked(true) on power-lock'
    );
    assert.ok(
      ambientSrc.includes('Escape') && ambientSrc.includes('lvCloseAmbient'),
      'AmbientViewportApp must close via lvCloseAmbient() on Escape key'
    );
    assert.ok(
      !ambientSrc.includes('?? STARLIGHT_HARBOR_LYRICS') && !ambientSrc.includes('?? STARLIGHT_HARBOR_TRACK'),
      'AmbientViewportApp must never unconditionally fall back to STARLIGHT_HARBOR when sandboxEnabled is false'
    );
  });
});
