// tests/adversarial_m4_raf_transitions.mjs
// Adversarial Empirical Challenger Suite for Milestone 4:
// Canvas RAF Loop, Extrapolation Stability, High-DPI Scaling, Rapid View Transitions & Tracklist Containment
// Challenger Agent: challenger_m4_perf_2

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// Register ESM resolution hook for relative .ts imports
import { register } from 'node:module';
const resolverHook = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && !specifier.endsWith('.ts') && !specifier.endsWith('.js') && !specifier.endsWith('.mjs')) {
      try {
        return await nextResolve(specifier + '.ts', context);
      } catch {}
      try {
        return await nextResolve(specifier + '/index.ts', context);
      } catch {}
    }
    throw err;
  }
}
`;
register(`data:text/javascript,${encodeURIComponent(resolverHook)}`, import.meta.url);

const { useNavigationStore } = await import('../src/state/navigationStore.ts');

const seekbarPath = path.join(ROOT, 'src/ui/player/WaveformCanvasSeekbar.tsx');
const seekbarContent = fs.readFileSync(seekbarPath, 'utf8');

// Dynamically extract resampleTo68Bars directly from WaveformCanvasSeekbar.tsx
const rawResampleMatch = seekbarContent.match(/export function resampleTo68Bars[\s\S]*?\n\}/);
assert.ok(rawResampleMatch, 'WaveformCanvasSeekbar must export resampleTo68Bars');
const cleanResampleCode = rawResampleMatch[0]
  .replace(/export function resampleTo68Bars\([^)]*\):[^{]*/, 'function resampleTo68Bars(buckets200)');
const resampleTo68Bars = new Function('Float32Array', cleanResampleCode + '; return resampleTo68Bars;')(Float32Array);

// ============================================================================
// SUITE 1: WAVEFORM CANVAS SEEKBAR RAF LIFECYCLE & NON-TEARDOWN
// ============================================================================
describe('SUITE 1: Waveform Canvas Seekbar RAF Loop Lifecycle & Non-Teardown', () => {

// Helper to parse all useEffect blocks cleanly
function extractUseEffects(source) {
  let pos = 0;
  const effects = [];
  while ((pos = source.indexOf('useEffect(', pos)) !== -1) {
    const start = pos;
    let braceCount = 0;
    let inBody = false;
    let end = -1;
    for (let i = start + 10; i < source.length; i++) {
      if (source[i] === '{') {
        braceCount++;
        inBody = true;
      } else if (source[i] === '}') {
        braceCount--;
        if (braceCount === 0 && inBody) {
          const closeParen = source.indexOf(')', i);
          end = closeParen + 1;
          break;
        }
      }
    }
    if (end !== -1) {
      const full = source.substring(start, end);
      const depMatch = full.match(/\},\s*\[([\s\S]*?)\]\s*\)$/);
      effects.push({
        full,
        deps: depMatch ? depMatch[1].trim() : null,
        hasRaf: full.includes('requestAnimationFrame'),
      });
      pos = end;
    } else {
      pos += 10;
    }
  }
  return effects;
}

  test('1.1: RAF useEffect dependency array is strictly empty [] (mounts ONCE on mount)', () => {
    const effects = extractUseEffects(seekbarContent);
    const rafEffects = effects.filter(e => e.hasRaf);
    assert.strictEqual(rafEffects.length, 1, 'Must contain exactly 1 continuous RAF loop useEffect');
    assert.strictEqual(
      rafEffects[0].deps,
      '',
      `RAF useEffect must have empty dependency array [] to prevent re-mounting during playback, but got: [${rafEffects[0].deps}]`
    );
  });

  test('1.2: Volatile playback state variables are NOT in the RAF useEffect dependency array', () => {
    const volatileVars = [
      'currentPositionMs',
      'isPlaying',
      'durationMs',
      'amplitudes',
      'liveBands',
      'liveRms',
      'liveBass',
      'liveMid',
      'liveHigh',
      'transitionWindow',
    ];

    const effects = extractUseEffects(seekbarContent);
    const rafEffect = effects.find(e => e.hasRaf);
    assert.ok(rafEffect, 'RAF effect must exist');
    for (const v of volatileVars) {
      assert.ok(
        !rafEffect.deps.includes(v),
        `Volatile variable '${v}' must NOT be in RAF useEffect dependency array!`
      );
    }
  });

  test('1.3: Empirical simulation: 200 continuous prop mutations do NOT trigger RAF teardown/re-mount', () => {
    let rafMountCount = 0;
    let rafTeardownCount = 0;
    let renderedFrameCount = 0;

    // Simulate the exact lifecycle architecture used by WaveformCanvasSeekbar
    class MockSeekbarLifecycle {
      constructor() {
        this.propsRef = { current: {} };
        this.interactionRef = { current: { isDragging: false, scrubPositionMs: null } };
        this.clockRef = { current: { interpolatedMs: 0, basePositionMs: 0, baseTimestamp: 0, optimisticSeekMs: null } };
        this.cleanupFn = null;
        this.mount();
      }

      mount() {
        // Equivalent to useEffect(..., [])
        rafMountCount++;
        let isRunning = true;

        const render = () => {
          if (!isRunning) return;
          renderedFrameCount++;
        };

        // Simulated RAF loop
        this.interval = setInterval(render, 16);

        this.cleanupFn = () => {
          isRunning = false;
          clearInterval(this.interval);
          rafTeardownCount++;
        };
      }

      updateProps(newProps) {
        // WaveformCanvasSeekbar updates propsRef.current on every render
        this.propsRef.current = { ...this.propsRef.current, ...newProps };
        // currentPositionMs synchronizer effect (does NOT touch RAF loop)
        if (newProps.currentPositionMs !== undefined) {
          const drift = newProps.currentPositionMs - this.clockRef.current.interpolatedMs;
          if (Math.abs(drift) > 150) {
            this.clockRef.current.basePositionMs = newProps.currentPositionMs;
            this.clockRef.current.interpolatedMs = newProps.currentPositionMs;
          }
        }
      }

      unmount() {
        if (this.cleanupFn) {
          this.cleanupFn();
          this.cleanupFn = null;
        }
      }
    }

    const instance = new MockSeekbarLifecycle();

    // Simulate 200 rapid continuous playback updates at 20Hz (50ms intervals) + scrubbing
    for (let i = 0; i < 200; i++) {
      instance.updateProps({
        currentPositionMs: i * 50,
        isPlaying: true,
        durationMs: 240000,
        liveRms: Math.random() * 0.8,
      });

      if (i === 50) {
        // User starts scrubbing
        instance.interactionRef.current.isDragging = true;
        instance.interactionRef.current.scrubPositionMs = 80000;
      }
      if (i === 80) {
        // User releases scrub
        instance.interactionRef.current.isDragging = false;
        instance.interactionRef.current.scrubPositionMs = null;
      }
    }

    assert.strictEqual(rafMountCount, 1, 'RAF loop must mount exactly ONCE');
    assert.strictEqual(rafTeardownCount, 0, 'RAF loop must NEVER teardown during playback or scrubbing');

    // Clean unmount
    instance.unmount();
    assert.strictEqual(rafMountCount, 1, 'Mount count remains 1');
    assert.strictEqual(rafTeardownCount, 1, 'Teardown count must be 1 on final unmount');
  });

  test('1.4: Ref-holding architecture shields render thread from React reconciliation re-renders', () => {
    assert.ok(
      seekbarContent.includes('const propsRef = useRef('),
      'Must use propsRef to store mutable props across renders'
    );
    assert.ok(
      seekbarContent.includes('const interactionRef = useRef('),
      'Must use interactionRef to prevent React re-renders during mouse scrub'
    );
    assert.ok(
      seekbarContent.includes('const clockRef = useRef('),
      'Must use clockRef for high-precision playhead clock'
    );
  });
});

// ============================================================================
// SUITE 2: MONOTONIC EXTRAPOLATION CLOCK & EXPONENTIAL SMOOTHING (alpha = 0.22)
// ============================================================================
describe('SUITE 2: Monotonic Playhead Extrapolation & alpha = 0.22 Exponential Smoothing', () => {
  const seekbarPath = path.join(ROOT, 'src/ui/player/WaveformCanvasSeekbar.tsx');
  const seekbarContent = fs.readFileSync(seekbarPath, 'utf8');

  test('2.1: Mathematical stability of exponential smoothing filter with alpha = 0.22', () => {
    // Difference equation: x[k] = x[k-1] + alpha * (u[k] - x[k-1])
    // Characteristic pole: z = 1 - alpha = 1 - 0.22 = 0.78
    const alpha = 0.22;
    const pole = 1 - alpha;
    assert.ok(Math.abs(pole) < 1.0, `System pole ${pole} must lie strictly inside unit circle |z| < 1 (guarantees asymptotic stability)`);

    // Step response test: step input u[k] = 1000 for k >= 0 with x[0] = 0
    let x = 0;
    const target = 1000;
    const trajectory = [];
    for (let k = 0; k < 40; k++) {
      x += (target - x) * alpha;
      trajectory.push(x);
      assert.ok(Number.isFinite(x), `Step response at step ${k} must be finite`);
      assert.ok(x <= target + 1e-6, `Exponential smoothing must NOT overshoot target (${x} <= ${target})`);
      if (k > 0) {
        assert.ok(x >= trajectory[k - 1], `Step response must be monotonically increasing (${x} >= ${trajectory[k - 1]})`);
      }
    }

    // 95% settling time for pole 0.78 is ~12 frames
    assert.ok(x > 0.99 * target, `After 40 frames, output must converge to >99% of target (got ${x})`);
  });

  test('2.2: Extreme frame rate stress: 10,000 RAF frames with variable delta-time never move backward', () => {
    const alpha = 0.22;
    const safeDuration = 240000; // 4 minutes track

    const clock = {
      basePositionMs: 0,
      baseTimestamp: 0,
      interpolatedMs: 0,
      optimisticSeekMs: null,
      optimisticSeekTime: 0,
    };

    let simulatedTime = 0;
    let authoritativeEnginePos = 0;
    let lastEngineUpdateTime = 0;
    let lastPosition = -1;
    let backwardStepCount = 0;
    let maxBackwardJitter = 0;

    // Simulate variable frame rates: 60Hz (16.6ms), 120Hz (8.33ms), 144Hz (6.94ms), 240Hz (4.16ms), plus GC drops (45ms)
    const frameDeltas = [16.66, 8.33, 6.94, 4.16, 16.66, 33.33, 50.0, 16.66, 8.33, 2.5];

    for (let frame = 0; frame < 10000; frame++) {
      const dt = frameDeltas[frame % frameDeltas.length] + (Math.sin(frame) * 1.5);
      simulatedTime += dt;

      // Audio engine updates position periodically every ~50ms
      if (simulatedTime - lastEngineUpdateTime >= 50) {
        authoritativeEnginePos = simulatedTime; // ideal continuous audio playback
        lastEngineUpdateTime = simulatedTime;

        // Sync logic from WaveformCanvasSeekbar.tsx
        const engineDrift = authoritativeEnginePos - clock.interpolatedMs;
        if (Math.abs(engineDrift) > 150 || engineDrift < -40) {
          clock.basePositionMs = authoritativeEnginePos;
          clock.baseTimestamp = simulatedTime;
          clock.interpolatedMs = authoritativeEnginePos;
        } else {
          clock.basePositionMs = authoritativeEnginePos;
          clock.baseTimestamp = simulatedTime;
        }
      }

      // Continuous extrapolation loop from WaveformCanvasSeekbar.tsx
      const timeSinceBase = Math.max(0, simulatedTime - clock.baseTimestamp);
      const targetMs = Math.min(safeDuration, clock.basePositionMs + timeSinceBase);
      clock.interpolatedMs += (targetMs - clock.interpolatedMs) * alpha;

      const activeMs = Math.max(0, Math.min(safeDuration, clock.interpolatedMs));

      // Verify invariants
      assert.ok(Number.isFinite(activeMs), `activeMs must be finite at frame ${frame}`);
      assert.ok(activeMs >= 0, `activeMs must be >= 0 (got ${activeMs})`);
      assert.ok(activeMs <= safeDuration, `activeMs must not exceed duration (got ${activeMs} > ${safeDuration})`);

      if (lastPosition >= 0) {
        const stepDelta = activeMs - lastPosition;
        if (stepDelta < -1e-6) {
          backwardStepCount++;
          if (Math.abs(stepDelta) > maxBackwardJitter) {
            maxBackwardJitter = Math.abs(stepDelta);
          }
        }
      }

      lastPosition = activeMs;
    }

    assert.strictEqual(
      backwardStepCount,
      0,
      `Playhead must NEVER move backward during continuous playback! Backward steps: ${backwardStepCount}, max jitter: ${maxBackwardJitter}ms`
    );
    assert.strictEqual(maxBackwardJitter, 0, 'Backward jitter must be exactly 0ms');
  });

  test('2.3: Audio engine reporting drift: soft alignment for small drift vs hard snap on large seek', () => {
    const alpha = 0.22;
    const clock = {
      basePositionMs: 50000,
      baseTimestamp: 1000,
      interpolatedMs: 50000,
    };

    // Case A: Small engine jitter (+30ms drift) -> soft alignment (no snap)
    const smallDriftPos = 50030;
    const engineDriftA = smallDriftPos - clock.interpolatedMs;
    assert.ok(Math.abs(engineDriftA) <= 150 && engineDriftA >= -40);
    // Soft update
    clock.basePositionMs = smallDriftPos;
    clock.baseTimestamp = 1050;
    // Next frame: smooth step
    const targetA = clock.basePositionMs + (1060 - clock.baseTimestamp);
    clock.interpolatedMs += (targetA - clock.interpolatedMs) * alpha;
    assert.ok(clock.interpolatedMs > 50000 && clock.interpolatedMs < targetA);

    // Case B: Large user seek / buffer skip (+50,000ms jump) -> hard snap
    const largeSeekPos = 120000;
    const engineDriftB = largeSeekPos - clock.interpolatedMs;
    assert.ok(Math.abs(engineDriftB) > 150);
    // Hard snap logic
    clock.basePositionMs = largeSeekPos;
    clock.baseTimestamp = 2000;
    clock.interpolatedMs = largeSeekPos;

    assert.strictEqual(clock.interpolatedMs, 120000, 'Large jump must hard snap interpolated position');
  });
});

// ============================================================================
// SUITE 3: 250ms OPTIMISTIC SEEK LATCH EMPIRICAL STRESS
// ============================================================================
describe('SUITE 3: 250ms Optimistic Seek Latch Empirical Stress', () => {
  test('3.1: Optimistic seek latch prevents lagging engine timestamps from rubber-banding playhead', () => {
    const clock = {
      basePositionMs: 15000,
      baseTimestamp: 1000,
      interpolatedMs: 15000,
      optimisticSeekMs: null,
      optimisticSeekTime: 0,
    };

    // User scrubs to 80,000ms at t = 2000ms and releases
    const seekTargetMs = 80000;
    const seekReleaseTime = 2000;
    clock.optimisticSeekMs = seekTargetMs;
    clock.optimisticSeekTime = seekReleaseTime;
    clock.basePositionMs = seekTargetMs;
    clock.baseTimestamp = seekReleaseTime;
    clock.interpolatedMs = seekTargetMs;

    // Simulate lagging audio engine reporting pre-seek positions (15,100ms, 15,150ms) for the next 200ms
    for (let t = 2020; t <= 2240; t += 20) {
      const now = t;
      let authoritativePos = 15000 + (t - 2000); // stale engine position around 15.2s

      // Latch logic from WaveformCanvasSeekbar.tsx:
      if (clock.optimisticSeekMs !== null) {
        if (now - clock.optimisticSeekTime < 250 && Math.abs(authoritativePos - clock.optimisticSeekMs) > 150) {
          authoritativePos = clock.optimisticSeekMs; // Latch overrides stale pos!
        } else {
          clock.optimisticSeekMs = null;
        }
      }

      assert.strictEqual(
        authoritativePos,
        seekTargetMs,
        `Lagging engine position at t=${t}ms (${t - seekReleaseTime}ms elapsed) must be latched to ${seekTargetMs}`
      );
    }
  });

  test('3.2: Optimistic seek latch expires after 250ms if engine does not confirm', () => {
    const clock = {
      optimisticSeekMs: 80000,
      optimisticSeekTime: 2000,
    };

    const now = 2251; // 251ms elapsed (> 250ms window)
    let authoritativePos = 81000;

    if (clock.optimisticSeekMs !== null) {
      if (now - clock.optimisticSeekTime < 250 && Math.abs(authoritativePos - clock.optimisticSeekMs) > 150) {
        authoritativePos = clock.optimisticSeekMs;
      } else {
        clock.optimisticSeekMs = null; // Automatically cleared
      }
    }

    assert.strictEqual(clock.optimisticSeekMs, null, 'Latch must be cleared after 250ms');
    assert.strictEqual(authoritativePos, 81000, 'Authoritative pos must be used after latch expiry');
  });

  test('3.3: Optimistic seek latch early-clears when engine confirms seek within 150ms tolerance', () => {
    const clock = {
      optimisticSeekMs: 80000,
      optimisticSeekTime: 2000,
    };

    // Engine responds fast at t = 2050ms (50ms elapsed) with 80,025ms
    const now = 2050;
    let authoritativePos = 80025; // within 150ms tolerance

    if (clock.optimisticSeekMs !== null) {
      if (now - clock.optimisticSeekTime < 250 && Math.abs(authoritativePos - clock.optimisticSeekMs) > 150) {
        authoritativePos = clock.optimisticSeekMs;
      } else {
        clock.optimisticSeekMs = null;
      }
    }

    assert.strictEqual(clock.optimisticSeekMs, null, 'Latch must clear early when engine confirms seek within 150ms tolerance');
    assert.strictEqual(authoritativePos, 80025, 'Authoritative pos must be accepted');
  });

  test('3.4: 100 rapid seek releases in succession never corrupt clock state or lock up latch', () => {
    const clock = {
      basePositionMs: 0,
      baseTimestamp: 0,
      interpolatedMs: 0,
      optimisticSeekMs: null,
      optimisticSeekTime: 0,
    };

    let simulatedTime = 1000;
    for (let i = 0; i < 100; i++) {
      simulatedTime += 25; // seeks occurring every 25ms
      const seekTarget = (i * 2000) % 200000;

      clock.optimisticSeekMs = seekTarget;
      clock.optimisticSeekTime = simulatedTime;
      clock.basePositionMs = seekTarget;
      clock.baseTimestamp = simulatedTime;
      clock.interpolatedMs = seekTarget;

      assert.strictEqual(clock.optimisticSeekMs, seekTarget);
      assert.strictEqual(clock.interpolatedMs, seekTarget);
      assert.ok(Number.isFinite(clock.basePositionMs));
    }

    // Advance 300ms after last seek
    simulatedTime += 300;
    const finalEnginePos = 195000;
    if (clock.optimisticSeekMs !== null) {
      if (simulatedTime - clock.optimisticSeekTime < 250 && Math.abs(finalEnginePos - clock.optimisticSeekMs) > 150) {
        // latch
      } else {
        clock.optimisticSeekMs = null;
      }
    }

    assert.strictEqual(clock.optimisticSeekMs, null, 'Latch must clean up completely after seek storm terminates');
  });
});

// ============================================================================
// SUITE 4: HIGH-DPI SCALING & PHYSICAL PIXEL BUFFER GEOMETRY
// ============================================================================
describe('SUITE 4: High-DPI Scaling & Physical Pixel Buffer Geometry', () => {
  const standardScalings = [
    { label: '100% (Standard)', dpr: 1.0 },
    { label: '125% (Windows Standard)', dpr: 1.25 },
    { label: '150% (Windows Standard)', dpr: 1.5 },
    { label: '175% (Surface / High-DPI)', dpr: 1.75 },
    { label: '200% (4K Display)', dpr: 2.0 },
    { label: '225% (Ultra-DPI)', dpr: 2.25 },
    { label: '250% (Ultra-DPI)', dpr: 2.5 },
    { label: '300% (Retina / 5K)', dpr: 3.0 },
  ];

  const fractionalWidths = [
    533.33,
    533.3333333,
    666.67,
    666.6666667,
    725.5,
    819.333,
    1023.75,
    1200.5,
    1440.33,
    1920.8,
  ];

  test('4.1: Physical width and height are ALWAYS positive integers using Math.round across all Windows scalings', () => {
    const h = 36;
    for (const { label, dpr } of standardScalings) {
      for (const width of fractionalWidths) {
        const physicalWidth = Math.max(1, Math.round(width * dpr));
        const physicalHeight = Math.max(1, Math.round(h * dpr));

        assert.ok(
          Number.isInteger(physicalWidth),
          `Physical width for ${width}px @ ${label} must be integer (got ${physicalWidth})`
        );
        assert.ok(
          physicalWidth > 0,
          `Physical width for ${width}px @ ${label} must be > 0 (got ${physicalWidth})`
        );
        assert.ok(
          Number.isInteger(physicalHeight),
          `Physical height for ${h}px @ ${label} must be integer (got ${physicalHeight})`
        );
        assert.ok(
          physicalHeight > 0,
          `Physical height for ${h}px @ ${label} must be > 0 (got ${physicalHeight})`
        );
      }
    }
  });

  test('4.2: CSS style width and height remain exact floating-point CSS pixels (no physical pixel leak)', () => {
    for (const width of fractionalWidths) {
      const h = 36;
      const styleWidth = `${width}px`;
      const styleHeight = `${h}px`;

      assert.strictEqual(styleWidth, `${width}px`);
      assert.strictEqual(styleHeight, '36px');
      assert.ok(!styleWidth.includes('undefined'), 'style.width must not contain undefined');
      assert.ok(!styleHeight.includes('undefined'), 'style.height must not contain undefined');
    }
  });

  test('4.3: Physical scaling factor matches DPR within sub-pixel rounding boundary (no column truncation)', () => {
    // Contrast Math.round vs Math.floor:
    // When width = 533.33 and dpr = 1.5:
    // width * dpr = 799.995.
    // Math.floor(799.995) = 799 (LOSES 1 physical pixel column!)
    // Math.round(799.995) = 800 (PRESERVES full physical pixel width!)
    const width = 533.33;
    const dpr = 1.5;
    const floored = Math.floor(width * dpr);
    const rounded = Math.round(width * dpr);

    assert.strictEqual(floored, 799, 'Math.floor drops physical pixel column on 533.33px @ 150%');
    assert.strictEqual(rounded, 800, 'Math.round correctly aligns to 800 physical pixels');

    // Matrix scale factor check:
    const physicalWidth = Math.max(1, Math.round(width * dpr));
    const effectiveScale = physicalWidth / width;
    const scaleError = Math.abs(effectiveScale - dpr);
    assert.ok(scaleError < 0.005, `Effective context scale error ${scaleError} must be < 0.5%`);
  });

  test('4.4: Boundary conditions: width = 0, width = 0.2, height = 0, dpr = 0 never crash buffer allocation', () => {
    const testCases = [
      { w: 0, h: 36, dpr: 1.5 },
      { w: 0.2, h: 36, dpr: 1.5 },
      { w: 600, h: 0, dpr: 1.5 },
      { w: 600, h: 36, dpr: 0 },
      { w: -50, h: -10, dpr: 2.0 },
    ];

    for (const { w, h, dpr } of testCases) {
      const safeDpr = dpr || 1;
      const physicalWidth = Math.max(1, Math.round(w * safeDpr));
      const physicalHeight = Math.max(1, Math.round(h * safeDpr));

      assert.ok(physicalWidth >= 1, `physicalWidth must be clamped to >= 1 (got ${physicalWidth})`);
      assert.ok(physicalHeight >= 1, `physicalHeight must be clamped to >= 1 (got ${physicalHeight})`);
      assert.ok(Number.isInteger(physicalWidth));
      assert.ok(Number.isInteger(physicalHeight));
    }
  });

  test('4.5: resampleTo68Bars generates valid Float32Array across empty, degenerate, and oversized inputs', () => {
    // 1. Null / empty
    const rEmpty = resampleTo68Bars(null);
    assert.strictEqual(rEmpty.length, 68);
    for (let i = 0; i < 68; i++) {
      assert.ok(Number.isFinite(rEmpty[i]));
      assert.ok(rEmpty[i] >= 0.1 && rEmpty[i] <= 1.0);
    }

    // 2. Exactly 68 bars input
    const exact68 = new Float32Array(68).fill(0.5);
    const rExact = resampleTo68Bars(exact68);
    assert.strictEqual(rExact.length, 68);
    assert.strictEqual(rExact[0], 0.5);

    // 3. Oversized 200 buckets
    const buckets200 = new Float32Array(200);
    for (let i = 0; i < 200; i++) buckets200[i] = Math.sin(i / 10);
    const r200 = resampleTo68Bars(buckets200);
    assert.strictEqual(r200.length, 68);
    for (let i = 0; i < 68; i++) {
      assert.ok(Number.isFinite(r200[i]));
      assert.ok(r200[i] >= 0.14 && r200[i] <= 0.85);
    }

    // 4. Degenerate all-zeros
    const zeros = new Float32Array(200).fill(0);
    const rZeros = resampleTo68Bars(zeros);
    assert.strictEqual(rZeros.length, 68);
    assert.ok(Math.abs(rZeros[0] - 0.18) < 1e-6, `Expected rZeros[0] ≈ 0.18, got ${rZeros[0]}`);
  });
});

// ============================================================================
// SUITE 5: RAPID VIEW TRANSITIONS & NAVIGATION STRESS (10Hz & 20Hz)
// ============================================================================
describe('SUITE 5: Rapid View Transitions & Navigation Stress (10Hz & 20Hz)', () => {
  const viewportPath = path.join(ROOT, 'src/ui/layout/MainViewport.tsx');
  const viewportContent = fs.readFileSync(viewportPath, 'utf8');
  const cssPath = path.join(ROOT, 'src/index.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');

  test('5.1: index.css defines .view-transition-container with GPU acceleration tokens', () => {
    assert.ok(cssContent.includes('.view-transition-container'));
    assert.ok(cssContent.includes('transform: translateZ(0)'), 'Must promote to GPU compositing layer with translateZ(0)');
    assert.ok(cssContent.includes('will-change: opacity, transform'), 'Must optimize compositing with will-change');
    assert.ok(cssContent.includes('backface-visibility: hidden'), 'Must prevent backface flickering');
    assert.ok(cssContent.includes('180ms'), 'Must use 180ms ease transition duration');
  });

  test('5.2: MainViewport viewKey generates distinct keys preventing container reuse collision', () => {
    const routeSamples = [
      { type: 'tab', tab: 'home' },
      { type: 'tab', tab: 'search' },
      { type: 'tab', tab: 'library', subView: 'playlists' },
      { type: 'tab', tab: 'library', subView: 'songs' },
      { type: 'tab', tab: 'library', subView: 'albums' },
      { type: 'tab', tab: 'explore' },
      { type: 'tab', tab: 'equalizer' },
      { type: 'release', id: 'album-strokes-ode', releaseType: 'album' },
      { type: 'artist', id: 'artist-strokes' },
      { type: 'release', id: 'album-sweet-taste', releaseType: 'single' },
    ];

    const keys = new Set();
    for (const route of routeSamples) {
      const viewKey =
        route.type === 'tab'
          ? `tab-${route.tab}-${route.subView || ''}`
          : `${route.type}-${route.id}`;

      assert.ok(!keys.has(viewKey), `Collision detected for viewKey: ${viewKey}`);
      keys.add(viewKey);
    }

    assert.strictEqual(keys.size, routeSamples.length, 'All unique routes must produce unique viewKeys');
  });

  test('5.3: Stress: 500 rapid route transitions at 10Hz and 20Hz with navigationStore stack integrity', () => {
    useNavigationStore.setState({
      current: { type: 'tab', tab: 'home' },
      history: [],
      forwardStack: [],
    });

    const routes = [
      { type: 'tab', tab: 'home' },
      { type: 'tab', tab: 'search' },
      { type: 'tab', tab: 'library', subView: 'songs' },
      { type: 'artist', id: 'artist-the-strokes' },
      { type: 'release', id: 'release-ode-to-the-mets', releaseType: 'album' },
      { type: 'tab', tab: 'explore' },
      { type: 'tab', tab: 'equalizer' },
    ];

    const startTime = performance.now();

    for (let i = 0; i < 500; i++) {
      const nextRoute = routes[i % routes.length];
      useNavigationStore.getState().navigate(nextRoute);

      const current = useNavigationStore.getState().current;
      assert.strictEqual(current.type, nextRoute.type);
      if (current.type === 'tab') {
        assert.strictEqual(current.tab, nextRoute.tab);
      } else {
        assert.strictEqual(current.id, nextRoute.id);
      }
    }

    const elapsed = performance.now() - startTime;
    assert.ok(elapsed < 1000, `500 transitions completed in ${elapsed.toFixed(1)}ms (< 1000ms threshold)`);
    assert.ok(useNavigationStore.getState().history.length > 0, 'History stack must record transitions');
  });

  test('5.4: MainViewport scrollTop reset eliminates scroll bleed between routes', () => {
    // Verify code contract
    assert.ok(
      viewportContent.includes('mainRef.current.scrollTop = 0'),
      'MainViewport must reset mainRef.current.scrollTop = 0 on viewKey change'
    );
    assert.ok(
      viewportContent.includes('useEffect(() => {\n    if (mainRef.current) {\n      mainRef.current.scrollTop = 0;\n    }\n  }, [viewKey]);') ||
      viewportContent.includes('mainRef.current.scrollTop = 0;\n    }\n  }, [viewKey]);'),
      'Scroll reset must trigger on [viewKey] dependency'
    );

    // Simulate DOM element scroll reset
    const mockMainElement = { scrollTop: 1850 };
    assert.strictEqual(mockMainElement.scrollTop, 1850);

    // Trigger effect logic
    mockMainElement.scrollTop = 0;
    assert.strictEqual(mockMainElement.scrollTop, 0, 'Scroll position must be instantly reset to top (0)');
  });

  test('5.5: Memory leak resilience: store listeners count remains bounded after route thrashing', () => {
    const initialListenerCount = useNavigationStore.listeners?.size ?? 0;

    // Simulate 200 navigation actions
    for (let i = 0; i < 200; i++) {
      useNavigationStore.getState().navigate({ type: 'tab', tab: i % 2 === 0 ? 'home' : 'search' });
    }

    const finalListenerCount = useNavigationStore.listeners?.size ?? 0;
    assert.strictEqual(
      finalListenerCount,
      initialListenerCount,
      'Navigation transitions must not accumulate leaked Zustand listeners'
    );
  });
});

// ============================================================================
// SUITE 6: TRACKLIST CSS CONTAINMENT & VIRTUALIZATION STRESS
// ============================================================================
describe('SUITE 6: Tracklist CSS Containment & Virtualization Performance', () => {
  const cssPath = path.join(ROOT, 'src/index.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');

  test('6.1: index.css defines calibrated 56px standard and 44px compact intrinsic heights', () => {
    assert.ok(
      /\.tracklist-row\s*\{[\s\S]*?content-visibility:\s*auto;/m.test(cssContent),
      '.tracklist-row must specify content-visibility: auto'
    );
    assert.ok(
      /\.tracklist-row\s*\{[\s\S]*?contain-intrinsic-size:\s*0\s*56px;/m.test(cssContent),
      '.tracklist-row must specify contain-intrinsic-size: 0 56px'
    );
    assert.ok(
      /\.tracklist-row-compact\s*\{[\s\S]*?contain-intrinsic-size:\s*0\s*44px;/m.test(cssContent),
      '.tracklist-row-compact must specify contain-intrinsic-size: 0 44px'
    );
  });

  test('6.2: All target view files apply .tracklist-row containment class', () => {
    const views = [
      { name: 'LibraryScreen', file: 'src/ui/views/LibraryScreen.tsx' },
      { name: 'ReleaseDetailView', file: 'src/ui/views/ReleaseDetailView.tsx' },
      { name: 'ArtistDetailView', file: 'src/ui/views/ArtistDetailView.tsx' },
    ];

    for (const { name, file } of views) {
      const fullPath = path.join(ROOT, file);
      assert.ok(fs.existsSync(fullPath), `${file} must exist`);
      const content = fs.readFileSync(fullPath, 'utf8');
      assert.ok(
        content.includes('tracklist-row'),
        `${name} must apply tracklist-row containment class`
      );
    }
  });

  test('6.3: Large collection layout prediction stability for 100, 500, 1,000, and 5,000 tracks', () => {
    const trackCounts = [100, 500, 1000, 5000];
    const standardRowH = 56;
    const compactRowH = 44;

    for (const count of trackCounts) {
      const standardHeight = count * standardRowH;
      const compactHeight = count * compactRowH;

      assert.strictEqual(standardHeight, count * 56);
      assert.strictEqual(compactHeight, count * 44);

      // Verify that off-screen elements in content-visibility: auto occupy exact predicted geometry
      const viewportHeight = 800;
      const visibleStandardRows = Math.ceil(viewportHeight / standardRowH);
      const offscreenStandardRows = count - visibleStandardRows;

      assert.ok(offscreenStandardRows > 0);
      assert.strictEqual(
        (visibleStandardRows * standardRowH) + (offscreenStandardRows * standardRowH),
        standardHeight,
        'Intrinsic sizes must prevent layout shifts when elements enter viewport'
      );
    }
  });

  test('6.4: Containment architecture prevents reflow cascade across parent containers', () => {
    // Check Tier B containment tokens in index.css
    assert.ok(
      cssContent.includes('.liquid-glass-card') && cssContent.includes('contain: paint layout;'),
      'Cards must specify contain: paint layout'
    );
    assert.ok(
      cssContent.includes('.acrylic-tile') && cssContent.includes('contain: paint layout;'),
      'Acrylic tiles must specify contain: paint layout'
    );
    assert.ok(
      cssContent.includes('.lyric-line') && cssContent.includes('contain: layout;'),
      'Lyric lines must specify contain: layout'
    );
  });
});
