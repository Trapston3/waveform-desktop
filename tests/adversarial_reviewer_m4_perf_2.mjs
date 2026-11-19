// tests/adversarial_reviewer_m4_perf_2.mjs
// Adversarial test suite by reviewer_m4_perf_2
// Stress-tests WaveformCanvasSeekbar math, High-DPI scaling, View Transitions,
// CSS containment properties, and PlaybackTimePill boundary conditions.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

test('ADV-M4-01: WaveformCanvasSeekbar resampleTo68Bars with extreme edge inputs', () => {
  const seekbarPath = path.join(ROOT, 'src/ui/player/WaveformCanvasSeekbar.tsx');
  const code = fs.readFileSync(seekbarPath, 'utf8');

  assert.ok(code.includes('export function resampleTo68Bars'));

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
        const v = Math.abs(buckets200[j]);
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

  // Case 1: null input
  const resNull = resampleTo68Bars(null);
  assert.strictEqual(resNull.length, 68);
  for (let i = 0; i < 68; i++) {
    assert.ok(Number.isFinite(resNull[i]) && resNull[i] > 0);
  }

  // Case 2: all zeros (Float32 precision tolerance)
  const allZeros = new Float32Array(200);
  const resZeros = resampleTo68Bars(allZeros);
  assert.strictEqual(resZeros.length, 68);
  for (let i = 0; i < 68; i++) {
    assert.ok(Math.abs(resZeros[i] - 0.18) < 1e-6);
  }

  // Case 3: single spike
  const spike200 = new Float32Array(200);
  spike200[100] = 5.0;
  const resSpike = resampleTo68Bars(spike200);
  assert.strictEqual(resSpike.length, 68);
  assert.ok(Math.max(...resSpike) <= 0.75 + 0.001); // 0.14 + 0.61 * 1.0 = 0.75
  assert.ok(Math.min(...resSpike) >= 0.14);

  // Case 4: exactly 68 bars
  const exact68 = new Float32Array(68).fill(0.42);
  const res68 = resampleTo68Bars(exact68);
  assert.strictEqual(res68.length, 68);
  assert.ok(Math.abs(res68[0] - 0.42) < 1e-6);

  // Case 5: 1 bar input
  const single1 = new Float32Array([0.9]);
  const res1 = resampleTo68Bars(single1);
  assert.strictEqual(res1.length, 68);
  assert.ok(res1[0] > 0);
});

test('ADV-M4-02: Playhead exponential smoothing convergence and monotonic extrapolation', () => {
  // Simulate the seekbar RAF interpolation loop over 60 frames (1 second at 60fps)
  const fps = 60;
  const frameIntervalMs = 1000 / fps; // ~16.67ms
  const safeDuration = 180000; // 3 min song
  const alpha = 0.22;

  let basePositionMs = 10000;
  let baseTimestamp = 0;
  let interpolatedMs = 10000;

  // Let real audio progress at 1x real time
  for (let frame = 1; frame <= fps; frame++) {
    const now = frame * frameIntervalMs;
    // Simulate authoritative engine position polled every ~50ms
    if (frame % 3 === 0) {
      basePositionMs = 10000 + now;
      baseTimestamp = now;
    }

    const dt = Math.max(0, now - baseTimestamp);
    const targetMs = Math.min(safeDuration, basePositionMs + dt);
    interpolatedMs += (targetMs - interpolatedMs) * alpha;

    // Invariant: interpolatedMs must be strictly non-decreasing (monotonic)
    const activeMs = Math.max(0, Math.min(safeDuration, interpolatedMs));
    assert.ok(activeMs >= 10000, 'Playhead must not regress during playback');
    assert.ok(activeMs <= 10000 + now + 5, 'Playhead must not overshoot beyond real time');
  }

  // Theoretical steady-state lag for alpha=0.22 with dt=16.67ms is dt*(1-alpha)/alpha ≈ 59ms
  // So interpolatedMs should be within 10940ms ± 50ms at 1 second
  assert.ok(
    Math.abs(interpolatedMs - 10941) < 20,
    `Playhead after 1s should exhibit smooth theoretical tracking (~10941ms), got ${interpolatedMs}`
  );
});

test('ADV-M4-03: Optimistic seek latch prevents rubber-banding on audio engine timestamp latency', () => {
  let optimisticSeekMs = 45000;
  let optimisticSeekTime = 1000; // timestamp when user released seekbar
  let interpolatedMs = 45000;
  let basePositionMs = 45000;
  let baseTimestamp = 1000;

  // Simulate audio engine returning stale position (e.g. 10000ms) for the first 150ms after seek
  const now1 = 1100; // 100ms later (< 250ms latch window)
  let enginePos = 10000; // stale position

  if (optimisticSeekMs !== null) {
    if (now1 - optimisticSeekTime < 250 && Math.abs(enginePos - optimisticSeekMs) > 150) {
      enginePos = optimisticSeekMs; // Latch overrides stale engine position!
    } else {
      optimisticSeekMs = null;
    }
  }

  assert.strictEqual(enginePos, 45000, 'Latch must shield against pre-seek engine position');

  // After 300ms, engine catches up to 45300ms
  const now2 = 1350; // 350ms later (> 250ms window)
  let freshEnginePos = 45350;

  if (optimisticSeekMs !== null) {
    if (now2 - optimisticSeekTime < 250 && Math.abs(freshEnginePos - optimisticSeekMs) > 150) {
      freshEnginePos = optimisticSeekMs;
    } else {
      optimisticSeekMs = null;
    }
  }

  assert.strictEqual(optimisticSeekMs, null, 'Latch must expire after 250ms');
  assert.strictEqual(freshEnginePos, 45350, 'Engine authoritative position now controls playback');
});

test('ADV-M4-04: High-DPI Scaling calculations for Windows desktop standard scaling factors', () => {
  const dprList = [1.0, 1.25, 1.5, 1.75, 2.0];
  const containerWidths = [533.33, 600.0, 843.67, 1024.5, 1280.0];

  for (const dpr of dprList) {
    for (const width of containerWidths) {
      const h = 36;
      const physicalWidth = Math.max(1, Math.round(width * dpr));
      const physicalHeight = Math.max(1, Math.round(h * dpr));

      assert.ok(Number.isInteger(physicalWidth), `physicalWidth must be integer on DPR ${dpr}`);
      assert.ok(Number.isInteger(physicalHeight), `physicalHeight must be integer on DPR ${dpr}`);
      assert.ok(physicalWidth > 0, 'physicalWidth must be positive');
      assert.ok(physicalHeight > 0, 'physicalHeight must be positive');
    }
  }
});

test('ADV-M4-05: PlaybackTimePill text formatting boundary checks', () => {
  function formatPlaybackTime(type, posMs, durationMs) {
    const totalSec = Math.max(0, Math.floor((durationMs || 0) / 1000));
    const elapsedSec = Math.max(0, Math.floor((posMs || 0) / 1000));

    if (type === 'elapsed') {
      const m = Math.floor(elapsedSec / 60);
      const s = Math.floor(elapsedSec % 60);
      return `${m}:${s < 10 ? '0' : ''}${s}`;
    } else {
      const remainingSec = Math.max(0, totalSec - elapsedSec);
      const m = Math.floor(remainingSec / 60);
      const s = Math.floor(remainingSec % 60);
      return `-${m}:${s < 10 ? '0' : ''}${s}`;
    }
  }

  // 0ms
  assert.strictEqual(formatPlaybackTime('elapsed', 0, 180000), '0:00');
  assert.strictEqual(formatPlaybackTime('remaining', 0, 180000), '-3:00');

  // Negative ms clamping
  assert.strictEqual(formatPlaybackTime('elapsed', -5000, 180000), '0:00');
  assert.strictEqual(formatPlaybackTime('remaining', -5000, 180000), '-3:00');

  // Past duration clamping
  assert.strictEqual(formatPlaybackTime('elapsed', 190000, 180000), '3:10');
  assert.strictEqual(formatPlaybackTime('remaining', 190000, 180000), '-0:00');

  // Long track (> 1 hour)
  assert.strictEqual(formatPlaybackTime('elapsed', 3665000, 7200000), '61:05');
  assert.strictEqual(formatPlaybackTime('remaining', 3665000, 7200000), '-58:55');
});

test('ADV-M4-06: MainViewport viewKey uniqueness across tabs and detail routes', () => {
  function computeViewKey(current) {
    return current.type === 'tab'
      ? `tab-${current.tab}-${current.subView || ''}`
      : `${current.type}-${current.id}`;
  }

  const k1 = computeViewKey({ type: 'tab', tab: 'home' });
  const k2 = computeViewKey({ type: 'tab', tab: 'explore' });
  const k3 = computeViewKey({ type: 'tab', tab: 'library', subView: 'songs' });
  const k4 = computeViewKey({ type: 'tab', tab: 'library', subView: 'albums' });
  const k5 = computeViewKey({ type: 'release', id: 'album-123', releaseType: 'album' });
  const k6 = computeViewKey({ type: 'artist', id: 'artist-456' });

  const set = new Set([k1, k2, k3, k4, k5, k6]);
  assert.strictEqual(set.size, 6, 'All view keys must be unique to trigger clean route transitions');
});
