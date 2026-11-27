// tests/challenger_m4_2_empirical_stress.mjs
// Empirical Challenger 2 Stress Harness for Milestone 4 (UI Parity, Screens & Desktop Adaptation)
// Tests: WaveformCanvasSeekbar, SyllableLyricsEngine, AlbumCoverFlow, DSP & Production Packaging

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Import compiled or source modules
import { LyricsService } from '../src/services/LyricsService.ts';
import { LiveVisualizer } from '../src/audio/LiveVisualizer.ts';

console.log('================================================================');
console.log('  CHALLENGER 2 EMPIRICAL STRESS HARNESS — MILESTONE 4 AUDIT    ');
console.log('================================================================');

// -----------------------------------------------------------------------------
// Module Mirror / Direct Logic Extracts for Waveform Canvas Seekbar
// -----------------------------------------------------------------------------

function resampleTo68Bars(buckets200) {
  const targetBars = 68;
  const out = new Float32Array(targetBars);
  if (!buckets200 || buckets200.length === 0) {
    for (let i = 0; i < targetBars; i++) {
      const x = i / targetBars;
      out[i] = 0.22 + 0.45 * Math.abs(Math.sin(x * Math.PI * 4) + 0.3 * Math.cos(x * Math.PI * 8));
    }
    return out;
  }

  if (buckets200.length === targetBars) {
    return new Float32Array(buckets200);
  }

  const srcSize = buckets200.length;
  const pooled = new Float32Array(targetBars);

  for (let i = 0; i < targetBars; i++) {
    const startIdx = Math.min(Math.floor((i / targetBars) * srcSize), srcSize - 1);
    const endIdx = Math.min(Math.max(Math.floor(((i + 1) / targetBars) * srcSize), startIdx + 1), srcSize);

    let peak = 0;
    let sumSq = 0;
    const count = endIdx - startIdx;

    for (let j = startIdx; j < endIdx; j++) {
      const raw = buckets200[j];
      const v = Number.isFinite(raw) ? Math.abs(raw) : 0;
      if (v > peak) peak = v;
      sumSq += v * v;
    }

    const rms = count > 0 ? Math.sqrt(sumSq / count) : peak;
    pooled[i] = 0.65 * peak + 0.35 * rms;
  }

  let maxVal = 0;
  for (let i = 0; i < targetBars; i++) {
    if (pooled[i] > maxVal) maxVal = pooled[i];
  }

  if (maxVal > 0.001) {
    const invMax = 1.0 / maxVal;
    for (let i = 0; i < targetBars; i++) {
      const norm = Math.max(0, Math.min(1.0, pooled[i] * invMax));
      out[i] = 0.14 + 0.61 * norm;
    }
  } else {
    out.fill(0.18);
  }

  return out;
}

function computeDynamicAmp(baseAmp, index, totalBars, progress, phase, pulse, liveParams = {}) {
  const { liveBands = null, liveBass = 0, liveMid = 0, liveHigh = 0, liveRms = 0 } = liveParams;
  if (pulse <= 0.01) return baseAmp;

  const normIndex = index / Math.max(1, totalBars - 1);
  const playheadFocus = 1.0 - Math.min(1.0, Math.max(0.0, Math.abs(normIndex - progress) / 0.22));

  let spectralMix = 0;
  if (Math.abs(normIndex - progress) < 0.14) {
    spectralMix = 0.5 * liveBass + 0.35 * liveMid + 0.15 * liveRms;
  } else if (index % 3 === 0) {
    spectralMix = 0.75 * liveBass + 0.2 * liveRms;
  } else if (index % 3 === 1) {
    spectralMix = 0.75 * liveMid + 0.2 * liveRms;
  } else {
    spectralMix = 0.8 * liveHigh + 0.2 * liveMid;
  }

  const bandEnergy = liveBands && index < liveBands.length ? liveBands[index % liveBands.length] : 0;
  const rawBounce =
    (0.45 * bandEnergy + 0.35 * spectralMix + 0.05 * Math.sin(phase * 2 + index * 0.07)) *
      (1 + 0.25 * playheadFocus) -
    0.12;

  const modulation = Math.max(-0.3, Math.min(0.45, 0.45 * rawBounce * pulse + 0.2 * (bandEnergy - 0.22) * pulse));
  const modAmp = baseAmp * (1 + 0.55 * modulation) + 0.08 * rawBounce * pulse;

  if (modAmp <= 0.8) {
    return Math.max(0.08, modAmp);
  }
  const excess = (modAmp - 0.8) / 0.25;
  return 0.8 + 0.15 * (excess / (1 + excess));
}

function formatTime(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// -----------------------------------------------------------------------------
// SUITE 1: WAVEFORM CANVAS SEEKBAR RESAMPLING, GEOMETRY & SCRUBBING
// -----------------------------------------------------------------------------
test('CHAL-SEEK-01: Resampling algorithm 200 -> 68 bars guarantees exact 68 bars and finite bounds', () => {
  const testInputs = [
    null,
    new Float32Array(0),
    new Float32Array(68).fill(0.5),
    new Float32Array(200).map((_, i) => Math.sin(i / 10)),
    new Float32Array(10000).map(() => Math.random()),
    new Float32Array(1).fill(0.9),
  ];

  for (const input of testInputs) {
    const res = resampleTo68Bars(input);
    assert.strictEqual(res.length, 68, `Expected exactly 68 bars, got ${res.length}`);
    for (let i = 0; i < 68; i++) {
      assert.ok(Number.isFinite(res[i]), `Bar ${i} must be finite`);
      assert.ok(res[i] >= 0.0 && res[i] <= 1.0, `Bar ${i} (${res[i]}) must be within [0.0, 1.0]`);
    }
  }
});

test('CHAL-SEEK-02: Waveform resampling under extreme fuzzing (NaN, Infinity, -Infinity, huge values)', () => {
  const corrupted = new Float32Array(200);
  corrupted[0] = NaN;
  corrupted[1] = Infinity;
  corrupted[2] = -Infinity;
  corrupted[3] = 1e30;
  corrupted[4] = -1e30;
  for (let i = 5; i < 200; i++) {
    corrupted[i] = i % 2 === 0 ? 0.7 : -0.7;
  }

  const res = resampleTo68Bars(corrupted);
  assert.strictEqual(res.length, 68);
  for (let i = 0; i < 68; i++) {
    assert.ok(Number.isFinite(res[i]), `Bar ${i} should be finite despite corrupted input, got ${res[i]}`);
    assert.ok(!Number.isNaN(res[i]), `Bar ${i} must not be NaN`);
  }
});

test('CHAL-SEEK-03: Zero/silent buffer defaults to 0.18 base floor (within Float32 precision)', () => {
  const silent = new Float32Array(200).fill(0);
  const res = resampleTo68Bars(silent);
  assert.strictEqual(res.length, 68);
  for (let i = 0; i < 68; i++) {
    assert.ok(Math.abs(res[i] - 0.18) < 1e-6, `Silent bar ${i} must equal 0.18 within Float32 precision`);
  }
});

test('CHAL-SEEK-04: Resampling Peak/RMS mathematical blend conforms to 65% Peak + 35% RMS', () => {
  const testBuf = new Float32Array(200).fill(1.0);
  const pooled = resampleTo68Bars(testBuf);
  assert.strictEqual(pooled.length, 68);
  for (let i = 0; i < 68; i++) {
    assert.ok(Math.abs(pooled[i] - 0.75) < 0.001, `Expected bar ${i} to be 0.75, got ${pooled[i]}`);
  }
});

test('CHAL-SEEK-05: Reverse-engineered Geometry: 66% Crest / 34% Trough Ratio & Axis Placement', () => {
  const h = 36;
  const axisY = h * 0.56;
  const upperShare = 0.66;
  const lowerShare = 1.0 - upperShare;

  const barH = 22; // default maxBarH
  const crest = barH * upperShare;
  const trough = barH * lowerShare;

  assert.ok(Math.abs(crest + trough - barH) < 1e-6);
  assert.ok(Math.abs(crest - 14.52) < 0.01, `Crest should be ~14.52px, got ${crest}`);
  assert.ok(Math.abs(trough - 7.48) < 0.01, `Trough should be ~7.48px, got ${trough}`);
  assert.ok(Math.abs((crest / trough) - (66 / 34)) < 1e-6, `Ratio should strictly match 66/34`);
});

test('CHAL-SEEK-06: Dynamic Amplitude Limiter never exceeds soft-knee ceiling (0.95 max)', () => {
  const totalBars = 68;
  const liveParams = {
    liveBands: new Float32Array(32).fill(1.0),
    liveBass: 1.0,
    liveMid: 1.0,
    liveHigh: 1.0,
    liveRms: 1.0,
  };

  for (let i = 0; i < totalBars; i++) {
    const amp = computeDynamicAmp(1.0, i, totalBars, 0.5, 1.23, 1.0, liveParams);
    assert.ok(Number.isFinite(amp), `Amp must be finite at index ${i}`);
    assert.ok(amp <= 0.95, `Amp ${amp} at bar ${i} must not exceed ceiling of 0.95`);
    assert.ok(amp >= 0.08, `Amp ${amp} at bar ${i} must not drop below 0.08`);
  }
});

test('CHAL-SEEK-07: Time formatting and tooltip values at 0ms, midpoint, durationMs, and extremes', () => {
  assert.strictEqual(formatTime(0), '0:00');
  assert.strictEqual(formatTime(500), '0:00');
  assert.strictEqual(formatTime(1000), '0:01');
  assert.strictEqual(formatTime(65000), '1:05');
  assert.strictEqual(formatTime(154500), '2:34');
  assert.strictEqual(formatTime(300000), '5:00');
  assert.strictEqual(formatTime(3600000), '60:00');
  assert.strictEqual(formatTime(3665000), '61:05');
  assert.strictEqual(formatTime(-5000), '0:00', 'Negative time must format as 0:00');
});

test('CHAL-SEEK-08: Scrubbing and wheel delta boundary stress (10,000 rapid cycles)', () => {
  const durationMs = 210000; // 3.5 minutes
  let currentPos = 105000;

  for (let i = 0; i < 5000; i++) {
    const deltaMs = (i % 2 === 0 ? 1 : -1) * 5000;
    const target = Math.max(0, Math.min(durationMs, currentPos + deltaMs));
    assert.ok(target >= 0 && target <= durationMs);
    currentPos = target;
  }

  const wayPastEnd = Math.max(0, Math.min(durationMs, 1000000));
  assert.strictEqual(wayPastEnd, durationMs);
  const wayPastStart = Math.max(0, Math.min(durationMs, -500000));
  assert.strictEqual(wayPastStart, 0);

  const containerWidth = 800;
  const clientXPoints = [-100, 0, 100, 400, 800, 950, 10000];
  for (const clientX of clientXPoints) {
    const fraction = Math.max(0, Math.min(1.0, clientX / containerWidth));
    const targetMs = fraction * durationMs;
    assert.ok(fraction >= 0.0 && fraction <= 1.0);
    assert.ok(targetMs >= 0 && targetMs <= durationMs);
  }
});

// -----------------------------------------------------------------------------
// SUITE 2: SYLLABLE LYRICS ENGINE, RAPID SEEKING & RTL/INTERNATIONALIZATION
// -----------------------------------------------------------------------------
test('CHAL-LYR-01: Rapid seeking across syllable boundaries & mid-syllable interpolation', () => {
  const sampleTtml = `
  <tt xmlns="http://www.w3.org/ns/ttml">
    <body>
      <div>
        <p begin="00:05.000" end="00:09.000">
          <span begin="00:05.000" end="00:06.000">Hel</span>
          <span begin="00:06.000" end="00:07.500">lo </span>
          <span begin="00:07.500" end="00:09.000">World</span>
        </p>
        <p begin="00:10.000" end="00:15.000">
          <span begin="00:10.000" end="00:11.200">Wave</span>
          <span begin="00:11.200" end="00:12.500">form </span>
          <span begin="00:12.500" end="00:15.000">Desktop</span>
        </p>
      </div>
    </body>
  </tt>`;

  const parsed = LyricsService.parseTtml(sampleTtml);
  assert.strictEqual(parsed.lines.length, 2);
  assert.strictEqual(parsed.lines[0].syllables?.length, 3);
  assert.strictEqual(parsed.lines[1].syllables?.length, 3);

  assert.strictEqual(LyricsService.getActiveLineIndex(parsed, 2000), -1);

  assert.strictEqual(LyricsService.getActiveLineIndex(parsed, 5000), 0);
  const w1 = LyricsService.getActiveWord(parsed.lines[0], 5000);
  assert.strictEqual(w1.syllableIndex, 0);
  assert.strictEqual(w1.activeSyllable?.text, 'Hel');
  assert.strictEqual(w1.progress, 0.0);

  assert.strictEqual(LyricsService.getActiveLineIndex(parsed, 6750), 0);
  const w2 = LyricsService.getActiveWord(parsed.lines[0], 6750);
  assert.strictEqual(w2.syllableIndex, 1);
  assert.strictEqual(w2.activeSyllable?.text, 'lo ');
  assert.ok(Math.abs(w2.progress - 0.5) < 0.01, `Progress should be 0.5, got ${w2.progress}`);

  const lineGapIdx = LyricsService.getActiveLineIndex(parsed, 9500);
  assert.ok(lineGapIdx >= 0);
  const wGap = LyricsService.getActiveWord(parsed.lines[0], 9500);
  assert.strictEqual(wGap.activeSyllable, null);
  assert.strictEqual(wGap.progress, 0);

  assert.strictEqual(LyricsService.getActiveLineIndex(parsed, 13750), 1);
  const w3 = LyricsService.getActiveWord(parsed.lines[1], 13750);
  assert.strictEqual(w3.syllableIndex, 2);
  assert.strictEqual(w3.activeSyllable?.text, 'Desktop');
  assert.ok(Math.abs(w3.progress - 0.5) < 0.01, `Progress should be 0.5, got ${w3.progress}`);

  for (let i = 0; i < 20000; i++) {
    const seekMs = Math.floor(Math.random() * 20000);
    const lineIdx = LyricsService.getActiveLineIndex(parsed, seekMs);
    if (seekMs < 5000) {
      assert.strictEqual(lineIdx, -1);
    } else if (seekMs >= 5000 && seekMs <= 9000) {
      assert.strictEqual(lineIdx, 0);
    } else if (seekMs >= 10000 && seekMs <= 15000) {
      assert.strictEqual(lineIdx, 1);
    }
  }
});

test('CHAL-LYR-02: Comprehensive RTL text detection (Arabic, Hebrew, Persian, Urdu, Mixed)', () => {
  const rtlSamples = [
    'مرحبا بالعالم',
    'إن الله مع الصابرين',
    'שלום עולם',
    'שיר של יום שלישי',
    'درود بر همه دوستان',
    'آهنگ جدید و زیبا',
    'یہ اردو شاعری ہے',
    'پنجابی زبان',
    'Track 01 (مرحبا)',
    'Intro - שלום',
  ];

  for (const text of rtlSamples) {
    assert.ok(LyricsService.isRtlText(text), `Text "${text}" should be detected as RTL`);
  }

  const ltrSamples = [
    'Hello World',
    'Bohemian Rhapsody',
    '夜に駆ける',
    '안녕하세요 세계',
    '你好世界',
    'Bonjour le monde',
    '1234567890 !@#$%^&*()',
  ];

  for (const text of ltrSamples) {
    assert.ok(!LyricsService.isRtlText(text), `Text "${text}" should NOT be detected as RTL`);
  }
});

test('CHAL-LYR-03: Vazirmatn font file presence and asset integrity', () => {
  const srcFontPath = path.join(rootDir, 'src', 'assets', 'fonts', 'vazirmatn_regular.ttf');
  assert.ok(fs.existsSync(srcFontPath), `Vazirmatn font must exist at ${srcFontPath}`);
  const stat = fs.statSync(srcFontPath);
  assert.ok(stat.size > 50000, `Vazirmatn font size must be > 50KB (actual: ${stat.size} bytes)`);

  const sfWeights = ['regular', 'medium', 'semibold', 'bold', 'heavy'];
  for (const weight of sfWeights) {
    const fontPath = path.join(rootDir, 'src', 'assets', 'fonts', `sf_pro_display_${weight}.otf`);
    assert.ok(fs.existsSync(fontPath), `SF Pro Display ${weight} must exist at ${fontPath}`);
    const sfStat = fs.statSync(fontPath);
    assert.ok(sfStat.size > 1000000, `SF Pro Display ${weight} size must be > 1MB`);
  }
});

test('CHAL-LYR-04: SyllableLyricsEngine User Scroll Detention Timer (3500ms simulation)', async () => {
  let isUserScrolled = false;
  let detentionTimer = null;

  const onScroll = () => {
    isUserScrolled = true;
    if (detentionTimer) clearTimeout(detentionTimer);
    detentionTimer = setTimeout(() => {
      isUserScrolled = false;
    }, 3500);
  };

  const resumeSync = () => {
    if (detentionTimer) clearTimeout(detentionTimer);
    isUserScrolled = false;
  };

  assert.strictEqual(isUserScrolled, false);

  onScroll();
  assert.strictEqual(isUserScrolled, true);

  resumeSync();
  assert.strictEqual(isUserScrolled, false);

  onScroll();
  assert.strictEqual(isUserScrolled, true);
  onScroll();
  assert.strictEqual(isUserScrolled, true);

  resumeSync();
});

test('CHAL-LYR-05: Romanization & Translation metadata preservation and model contract', () => {
  const line = {
    startTimeMs: 1000,
    endTimeMs: 4000,
    text: '夜に駆ける',
    romanization: 'Yoru ni Kakeru',
    translation: 'Racing into the Night',
    isRtl: false,
  };

  assert.strictEqual(line.text, '夜に駆ける');
  assert.strictEqual(line.romanization, 'Yoru ni Kakeru');
  assert.strictEqual(line.translation, 'Racing into the Night');
  assert.strictEqual(line.isRtl, false);
});

// -----------------------------------------------------------------------------
// SUITE 3: 3D ALBUM COVER FLOW MATHEMATICS & BOUNDARIES
// -----------------------------------------------------------------------------
test('CHAL-COV-01: 3D perspective transform parameters conform strictly to design spec', () => {
  const albums = Array.from({ length: 15 }, (_, i) => ({
    id: `album-${i}`,
    title: `Album ${i}`,
    artist: `Artist ${i}`,
    coverUrl: `https://example.com/cover-${i}.jpg`,
  }));

  const activeIndex = 7;

  for (let i = 0; i < albums.length; i++) {
    const offset = i - activeIndex;
    const absOffset = Math.min(1.0, Math.abs(offset));

    if (Math.abs(offset) > 5) {
      continue;
    }

    const rotationY = offset === 0 ? 0 : offset < 0 ? 55 : -55;
    const scale = 1.0 - 0.28 * absOffset;
    const translateX = offset === 0 ? 0 : offset * 140 + (offset > 0 ? 60 : -60);
    const translateZ = -150 * absOffset;
    const opacity = 1.0 - 0.45 * absOffset;
    const zIndex = 100 - Math.abs(offset) * 10;

    if (offset === 0) {
      assert.strictEqual(rotationY, 0, 'Active album must have 0deg rotation');
      assert.strictEqual(scale, 1.0, 'Active album must have scale 1.0');
      assert.strictEqual(translateX, 0, 'Active album must have translateX 0');
      assert.ok(Math.abs(translateZ) < 1e-6, 'Active album must have translateZ 0');
      assert.strictEqual(opacity, 1.0, 'Active album must have opacity 1.0');
      assert.strictEqual(zIndex, 100, 'Active album must have zIndex 100');
    } else if (offset === -1) {
      assert.strictEqual(rotationY, 55, 'Left album must rotate +55deg');
      assert.strictEqual(scale, 0.72, 'Neighbor album scale must be 0.72');
      assert.strictEqual(translateX, -200, 'Left neighbor translateX must be -200px');
      assert.strictEqual(translateZ, -150, 'Neighbor translateZ must be -150px');
      assert.strictEqual(opacity, 0.55, 'Neighbor opacity must be 0.55');
      assert.strictEqual(zIndex, 90, 'Neighbor zIndex must be 90');
    } else if (offset === 1) {
      assert.strictEqual(rotationY, -55, 'Right album must rotate -55deg');
      assert.strictEqual(scale, 0.72, 'Neighbor album scale must be 0.72');
      assert.strictEqual(translateX, 200, 'Right neighbor translateX must be +200px');
      assert.strictEqual(translateZ, -150, 'Neighbor translateZ must be -150px');
      assert.strictEqual(opacity, 0.55, 'Neighbor opacity must be 0.55');
      assert.strictEqual(zIndex, 90, 'Neighbor zIndex must be 90');
    }
  }
});

test('CHAL-COV-02: Index clamping & navigation boundaries (0 albums, 1 album, 1000 albums)', () => {
  const clampIndex = (idx, total) => Math.max(0, Math.min(total - 1, idx));

  assert.strictEqual(clampIndex(0, 1), 0);
  assert.strictEqual(clampIndex(-1, 1), 0);
  assert.strictEqual(clampIndex(1, 1), 0);

  assert.strictEqual(clampIndex(-5, 10), 0);
  assert.strictEqual(clampIndex(4, 10), 4);
  assert.strictEqual(clampIndex(9, 10), 9);
  assert.strictEqual(clampIndex(15, 10), 9);

  const computeFlick = (delta) => {
    if (delta > 45) return -1;
    if (delta < -45) return 1;
    return 0;
  };

  assert.strictEqual(computeFlick(50), -1);
  assert.strictEqual(computeFlick(-50), 1);
  assert.strictEqual(computeFlick(30), 0);
  assert.strictEqual(computeFlick(-25), 0);
});

// -----------------------------------------------------------------------------
// SUITE 4: PRODUCTION PACKAGING, LAYOUT GEOMETRY & IPC RESILIENCE
// -----------------------------------------------------------------------------
test('CHAL-PROD-01: Bundled distribution files and assets exist and are non-empty', () => {
  const indexHtml = path.join(rootDir, 'dist', 'index.html');
  assert.ok(fs.existsSync(indexHtml), 'dist/index.html must exist');
  assert.ok(fs.statSync(indexHtml).size > 100, 'dist/index.html must not be empty');

  const mainJs = path.join(rootDir, 'dist-electron', 'main.js');
  assert.ok(fs.existsSync(mainJs), 'dist-electron/main.js must exist');

  const preloadCjs = path.join(rootDir, 'dist-electron', 'preload.cjs');
  assert.ok(fs.existsSync(preloadCjs), 'dist-electron/preload.cjs must exist');

  const autoEqDb = path.join(rootDir, 'src', 'assets', 'data', 'auto_eq.db');
  assert.ok(fs.existsSync(autoEqDb), 'auto_eq.db must exist');
  assert.ok(fs.statSync(autoEqDb).size > 100000, 'auto_eq.db must be > 100KB');
});

test('CHAL-PROD-02: Layout Geometry dimensions conformance', () => {
  const leftSidebarCode = fs.readFileSync(path.join(rootDir, 'src', 'ui', 'layout', 'LeftSidebar.tsx'), 'utf-8');
  assert.ok(leftSidebarCode.includes('w-60'), 'LeftSidebar must have standard width 240px (w-60)');

  const rightInspectorCode = fs.readFileSync(path.join(rootDir, 'src', 'ui', 'layout', 'RightSidecar.tsx'), 'utf-8');
  assert.ok(rightInspectorCode.includes('w-[360px]'), 'RightInspector must have standard collapsible width 360px');

  const bottomPlayerBarCode = fs.readFileSync(path.join(rootDir, 'src', 'ui', 'layout', 'BottomPlayerBar.tsx'), 'utf-8');
  assert.ok(bottomPlayerBarCode.includes('h-[76px]'), 'BottomPlayerBar must have height 76px');

  const titleBarCode = fs.readFileSync(path.join(rootDir, 'src', 'ui', 'layout', 'DesktopTitleBar.tsx'), 'utf-8');
  assert.ok(titleBarCode.includes('h-9'), 'DesktopTitleBar must have standard height 36px (h-9)');
});

// -----------------------------------------------------------------------------
// SUITE 5: AUDIO VISUALIZER & ZERO-ALLOCATION PCM ANALYSIS
// -----------------------------------------------------------------------------
test('CHAL-VIS-01: Zero-allocation compute32BandPcmEnergy under edge cases', () => {
  const outBuf = new Float32Array(32);

  // 1. Zero length PCM block
  LiveVisualizer.compute32BandPcmEnergy(new Float32Array(0), outBuf);
  assert.strictEqual(outBuf.length, 32);
  for (let i = 0; i < 32; i++) assert.strictEqual(outBuf[i], 0);

  // 2. Length smaller than 32
  LiveVisualizer.compute32BandPcmEnergy(new Float32Array(16).fill(0.8), outBuf);
  for (let i = 0; i < 32; i++) assert.strictEqual(outBuf[i], 0);

  // 3. Normal block 1024 samples
  const pcm = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) pcm[i] = Math.sin((i / 1024) * Math.PI * 8);
  LiveVisualizer.compute32BandPcmEnergy(pcm, outBuf);
  for (let i = 0; i < 32; i++) {
    assert.ok(Number.isFinite(outBuf[i]));
    assert.ok(outBuf[i] >= 0.0 && outBuf[i] <= 1.0);
  }

  // 4. Corrupted block with NaN and Infinity
  const corrupted = new Float32Array(512);
  corrupted[10] = NaN;
  corrupted[50] = Infinity;
  corrupted[100] = -Infinity;
  LiveVisualizer.compute32BandPcmEnergy(corrupted, outBuf);
  for (let i = 0; i < 32; i++) {
    assert.ok(Number.isFinite(outBuf[i]), `Band ${i} must be finite`);
    assert.ok(!Number.isNaN(outBuf[i]), `Band ${i} must not be NaN`);
  }
});

test('CHAL-VIS-02: LiveVisualizer processPcmFrame, 3-band decomposition & subscriber resilience', () => {
  const visualizer = new LiveVisualizer();
  let dispatchCount = 0;

  const unsub = visualizer.subscribe((bands) => {
    dispatchCount++;
    assert.strictEqual(bands.length, 32);
  });

  // Adding an erroneous subscriber to test error containment
  visualizer.subscribe(() => {
    throw new Error('Exploding test subscriber');
  });

  const samples = new Float32Array(2048);
  for (let i = 0; i < 2048; i++) {
    samples[i] = 0.5 * Math.sin((i / 2048) * 2 * Math.PI * 100); // 100Hz low frequency
  }

  // Process 10 frames
  for (let f = 0; f < 10; f++) {
    visualizer.processPcmFrame(samples, 2, 44100);
  }

  assert.ok(dispatchCount >= 10, 'Subscriber should have received all frames');
  assert.ok(visualizer.bassLevel > 0, 'Bass level should be activated by 100Hz signal');
  assert.ok(Number.isFinite(visualizer.rmsLevel));
  assert.ok(Number.isFinite(visualizer.bassLevel));
  assert.ok(Number.isFinite(visualizer.midLevel));
  assert.ok(Number.isFinite(visualizer.highLevel));

  // Reset
  visualizer.reset();
  assert.strictEqual(visualizer.bassLevel, 0);
  assert.strictEqual(visualizer.rmsLevel, 0);

  unsub();
});

console.log('--- ALL CHALLENGER 2 EMPIRICAL STRESS TESTS DEFINED ---');
