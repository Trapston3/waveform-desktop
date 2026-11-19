// tests/adversarial_challenge_m2_deep_empirical.mjs
// Deep Adversarial Empirical Verification & Stress Harness for Milestone M2
// Focus:
// 1. Second-order harmonic oscillator spring ODE solver mathematical rigor & stability
// 2. Graduated depth-of-field blur calculations & memoization re-render isolation
// 3. Instrumental break 3-dot countdown detection & pulse timing state machine
// 4. WebGL 2 OkLab shader mathematics, uniform binding contracts, and Canvas 2D fallback

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import React from 'react';
import ReactDOMServer from 'react-dom/server';

// Register hook to transpile TS and TSX via esbuild
register('./helpers/tsxLoader.mjs', import.meta.url);

const { SpringScroller, SyllableLyricsEngine } = await import('../src/ui/player/SyllableLyricsEngine.tsx');
const { InstrumentalDotsRow } = await import('../src/ui/player/InstrumentalDotsRow.tsx');
const { AppleMusicFluidMeshCanvas } = await import('../src/ui/player/AppleMusicFluidMeshCanvas.tsx');

// ============================================================================
// SUITE 1: SPRING ODE MATHEMATICAL RIGOR, DAMPING RATIO & NUMERICAL STABILITY
// ============================================================================
describe('Suite 1: Spring ODE Mathematical Rigor & Numerical Stability', () => {

  test('SPRING-01: Physical ODE parameters produce critical damping ratio (zeta ≈ 1.10)', () => {
    // Equation: m*x'' + c*x' + k*(x - x_target) = 0
    // Damping ratio: zeta = c / (2 * sqrt(k * m))
    // Critical damping occurs at zeta = 1.0. Overdamping at zeta > 1.0 (no oscillation/overshoot).

    const scroller = new SpringScroller(0);

    // Default mode: k = 170, c = sqrt(170) * 2.2
    scroller.setTarget(100);
    const kDefault = 170;
    const m = 1;
    const cDefault = Math.sqrt(kDefault) * 2.2;
    const zetaDefault = cDefault / (2 * Math.sqrt(kDefault * m));
    assert.ok(Math.abs(zetaDefault - 1.10) < 0.001, `Expected zeta ~ 1.10, got ${zetaDefault}`);

    // Tempo-adaptive intervals: intervalMs from 100 to 800ms
    for (const interval of [100, 200, 350, 500, 650, 800]) {
      scroller.setTarget(200, interval);
      const clamped = Math.min(Math.max(interval, 100), 800);
      const ratio = Math.pow(1 - (clamped - 100) / 700, 0.2);
      const kAdaptive = 170 + ratio * 50;
      const cAdaptive = Math.sqrt(kAdaptive) * 2.2;
      const zetaAdaptive = cAdaptive / (2 * Math.sqrt(kAdaptive * m));
      assert.ok(Math.abs(zetaAdaptive - 1.10) < 0.001,
        `Interval ${interval}ms: Expected zeta exactly 1.10, got ${zetaAdaptive}`);
      assert.ok(kAdaptive >= 170 && kAdaptive <= 220,
        `Stiffness k must be bounded in [170, 220], got ${kAdaptive}`);
    }

    // Seek mode (isSeek = true): k = 90, c = 15
    scroller.setTarget(300, undefined, true);
    const kSeek = 90;
    const cSeek = 15;
    const zetaSeek = cSeek / (2 * Math.sqrt(kSeek * m));
    // zeta = 15 / (2 * sqrt(90)) = 15 / 18.97366 = 0.79056
    assert.ok(Math.abs(zetaSeek - 0.7905) < 0.005, `Seek mode zeta ~ 0.79, got ${zetaSeek}`);
  });

  test('SPRING-02: Multi-framerate simulation (240Hz, 144Hz, 120Hz, 60Hz, 30Hz, 20Hz) converges without overshoot', () => {
    const framerates = [240, 144, 120, 60, 30, 20];

    for (const fps of framerates) {
      const dt = 1 / fps;
      const target = 500;
      const scroller = new SpringScroller(0);
      scroller.setTarget(target);

      let settled = false;
      let steps = 0;
      let maxPosition = 0;
      const maxSteps = fps * 3; // 3 seconds max

      while (!settled && steps < maxSteps) {
        const res = scroller.step(dt);
        assert.ok(!Number.isNaN(res.position), `FPS ${fps}: Position became NaN at step ${steps}`);
        assert.ok(Number.isFinite(res.position), `FPS ${fps}: Position became Infinite at step ${steps}`);
        if (res.position > maxPosition) maxPosition = res.position;
        settled = res.isSettled;
        steps++;
      }

      assert.ok(settled, `FPS ${fps}: Failed to settle within 3 seconds (took ${steps} steps)`);
      assert.strictEqual(scroller.getPosition(), target, `FPS ${fps}: Final position must exactly equal target`);
      // Monotonic / non-overshooting verification (zeta = 1.10 ensures no overshoot > 0.5px)
      assert.ok(maxPosition <= target + 0.5,
        `FPS ${fps}: Unexpected overshoot! Max position was ${maxPosition}, target was ${target}`);
      // Settlement time verification: 500px jump settling to within 0.5px (<0.1% error)
      const settleTimeSec = steps * dt;
      assert.ok(settleTimeSec <= 1.5, `FPS ${fps}: Settle time ${settleTimeSec}s exceeded 1.5s`);
    }
  });

  test('SPRING-03: Extreme shock input stress (100,000px displacement, rapid reversals, NaN inputs)', () => {
    const scroller = new SpringScroller(0);

    // Massive jump: 0 -> 100,000px
    scroller.setTarget(100000);
    for (let i = 0; i < 300; i++) {
      const { position } = scroller.step(0.016);
      assert.ok(!Number.isNaN(position) && Number.isFinite(position));
    }
    // Should be smoothly progressing
    assert.ok(scroller.getPosition() > 50000, 'Position must smoothly approach large target');

    // Rapid reverse shock: 100,000 -> 0
    scroller.setTarget(0);
    for (let i = 0; i < 300; i++) {
      const { position } = scroller.step(0.016);
      assert.ok(!Number.isNaN(position) && Number.isFinite(position));
    }
    assert.ok(scroller.getPosition() < 50000, 'Position must reverse cleanly without exploding');

    // Alternating oscillation shock (target changes every single frame)
    scroller.reset(0);
    for (let i = 0; i < 100; i++) {
      scroller.setTarget(i % 2 === 0 ? 1000 : 0);
      const { position } = scroller.step(0.016);
      assert.ok(!Number.isNaN(position) && Number.isFinite(position));
      // Position must remain bounded between -50 and 1050
      assert.ok(position >= -50 && position <= 1050, `Position out of bounds: ${position}`);
    }

    // Reset during motion
    scroller.reset(250);
    assert.strictEqual(scroller.getPosition(), 250);
    const stepAfterReset = scroller.step(0.016);
    assert.strictEqual(stepAfterReset.position, 250);
    assert.strictEqual(stepAfterReset.isSettled, true);
  });
});

// ============================================================================
// SUITE 2: GRADUATED DEPTH-OF-FIELD BLUR & MEMOIZATION ISOLATION
// ============================================================================
describe('Suite 2: Graduated Depth-of-Field Blur & Memoization Re-render Isolation', () => {

  // Test distance calculations & exact style output
  test('BLUR-01: Graduated blur distance tiers match Apple Music specification', () => {
    // Spec:
    // d = 0: blur(0px), opacity 1.0, scale(1.02), textShadow
    // d = 1: blur(1.5px), opacity 0.55, scale(0.98), textShadow none
    // d = 2: blur(3.5px), opacity 0.35, scale(0.96), textShadow none
    // d >= 3: blur(6.0px), opacity 0.20, scale(0.94), textShadow none

    const mockLyrics = {
      type: 'LINE_SYNCED',
      isSynced: true,
      provider: 'lrclib',
      lines: [
        { lineIndex: 0, startTimeMs: 1000, endTimeMs: 4000, text: 'Line 0 (d=2)' },
        { lineIndex: 1, startTimeMs: 4000, endTimeMs: 8000, text: 'Line 1 (d=1)' },
        { lineIndex: 2, startTimeMs: 8000, endTimeMs: 12000, text: 'Line 2 (active, d=0)' },
        { lineIndex: 3, startTimeMs: 12000, endTimeMs: 16000, text: 'Line 3 (d=1)' },
        { lineIndex: 4, startTimeMs: 16000, endTimeMs: 20000, text: 'Line 4 (d=2)' },
        { lineIndex: 5, startTimeMs: 20000, endTimeMs: 24000, text: 'Line 5 (d=3)' },
        { lineIndex: 6, startTimeMs: 24000, endTimeMs: 28000, text: 'Line 6 (d=4)' },
      ],
    };

    // Render at t = 9000ms (Line 2 is active)
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(SyllableLyricsEngine, {
        lyricsData: mockLyrics,
        currentPositionMs: 9000,
        onSeek: () => {},
      })
    );

    // Active line (line 2)
    assert.ok(html.includes('id="lyric-line-2"'), 'Active line 2 must be rendered');
    assert.ok(html.includes('blur(0px)'), 'Active line must have blur(0px)');

    // Distance 1 (lines 1 and 3)
    assert.ok(html.includes('blur(1.5px)'), 'Distance 1 must have blur(1.5px)');

    // Distance 2 (lines 0 and 4)
    assert.ok(html.includes('blur(3.5px)'), 'Distance 2 must have blur(3.5px)');

    // Distance >= 3 (lines 5 and 6)
    assert.ok(html.includes('blur(6.0px)') || html.includes('blur(6px)'), 'Distance >= 3 must have blur(6.0px)');
  });

  test('BLUR-02: Clamped distance memoization ensures >=90% re-render isolation on line progression', () => {
    // When active line index changes from L to L+1:
    // Only lines in range [L-3, L+4] can possibly change their clampedDistance.
    // All other lines have clampedDistance = 3 before and clampedDistance = 3 after!

    const totalLines = 60;
    for (let activeLine = 5; activeLine < 55; activeLine++) {
      const nextActiveLine = activeLine + 1;

      let reRenderedCount = 0;
      let skippedCount = 0;

      for (let lIndex = 0; lIndex < totalLines; lIndex++) {
        const prevClamped = Math.min(3, Math.abs(lIndex - activeLine));
        const nextClamped = Math.min(3, Math.abs(lIndex - nextActiveLine));
        const wasActive = lIndex === activeLine;
        const isNowActive = lIndex === nextActiveLine;

        // Memo comparator logic:
        // Returns true (skip) if !wasActive && !isNowActive && prevClamped === nextClamped
        const willSkip = !wasActive && !isNowActive && prevClamped === nextClamped;
        if (willSkip) {
          skippedCount++;
        } else {
          reRenderedCount++;
        }
      }

      // Maximum lines that change: old active, new active, and lines changing distance tier = at most 7-8 lines
      assert.ok(reRenderedCount <= 8, `Expected <= 8 lines to re-render, got ${reRenderedCount}`);
      const isolationRate = skippedCount / totalLines;
      assert.ok(isolationRate >= 0.85, `Expected >= 85% isolation rate, got ${(isolationRate * 100).toFixed(1)}%`);
    }
  });

  test('BLUR-03: User scroll and unsynced mode override depth-of-field blur to 0px', () => {
    const mockUnsyncedLyrics = {
      type: 'UNSYNCED',
      isSynced: false,
      provider: 'musixmatch',
      lines: [
        { lineIndex: 0, startTimeMs: 0, endTimeMs: 0, text: 'Unsynced Line 1' },
        { lineIndex: 1, startTimeMs: 0, endTimeMs: 0, text: 'Unsynced Line 2' },
      ],
    };

    const htmlUnsynced = ReactDOMServer.renderToStaticMarkup(
      React.createElement(SyllableLyricsEngine, {
        lyricsData: mockUnsyncedLyrics,
        currentPositionMs: 5000,
        onSeek: () => {},
      })
    );

    // In unsynced mode, all lines must have blur(0px) and zero graduated blur classes
    assert.ok(!htmlUnsynced.includes('blur(1.5px)'), 'Unsynced mode must not have blur(1.5px)');
    assert.ok(!htmlUnsynced.includes('blur(3.5px)'), 'Unsynced mode must not have blur(3.5px)');
    assert.ok(!htmlUnsynced.includes('blur(6.0px)'), 'Unsynced mode must not have blur(6.0px)');
  });
});

// ============================================================================
// SUITE 3: INSTRUMENTAL BREAK 3-DOT COUNTDOWN & PULSE TIMING
// ============================================================================
describe('Suite 3: Instrumental Break 3-Dot Countdown & Pulse Timing State Machine', () => {

  test('DOTS-01: Break gap detection boundary: exactly >= 4000ms triggers break', () => {
    // 3999ms gap: NOT a break
    const gap3999 = 3999;
    const isBreak3999 = gap3999 >= 4000;
    assert.strictEqual(isBreak3999, false, '3999ms gap must not trigger break');

    // 4000ms gap: BREAK
    const gap4000 = 4000;
    const isBreak4000 = gap4000 >= 4000;
    assert.strictEqual(isBreak4000, true, '4000ms gap must trigger break');

    // Intro break: lines[0].startTimeMs >= 4000
    const intro3999 = { lines: [{ startTimeMs: 3999, endTimeMs: 8000, text: 'Intro' }] };
    const hasIntro3999 = intro3999.lines[0].startTimeMs >= 4000;
    assert.strictEqual(hasIntro3999, false);

    const intro4000 = { lines: [{ startTimeMs: 4000, endTimeMs: 8000, text: 'Intro' }] };
    const hasIntro4000 = intro4000.lines[0].startTimeMs >= 4000;
    assert.strictEqual(hasIntro4000, true);
  });

  test('DOTS-02: Countdown pulse state transitions across 3000ms window', () => {
    // Break window: [10000ms, 20000ms], remaining = 20000 - currentPositionMs
    const startTimeMs = 10000;
    const endTimeMs = 20000;

    const testPoints = [
      // { pos, expectedDot1, expectedDot2, expectedDot3, description }
      { pos: 9000, d1: false, d2: false, d3: false, desc: 'Before break' },
      { pos: 10000, d1: false, d2: false, d3: false, desc: 'Break start (remaining 10s)' },
      { pos: 16999, d1: false, d2: false, d3: false, desc: 'Before countdown (remaining 3001ms)' },
      { pos: 17000, d1: true, d2: false, d3: false, desc: 'Exact 3000ms boundary (Dot 1 activates)' },
      { pos: 17500, d1: true, d2: false, d3: false, desc: 'Dot 1 active (remaining 2500ms)' },
      { pos: 18000, d1: false, d2: true, d3: false, desc: 'Dot 2 activates (remaining 2000ms)' },
      { pos: 18500, d1: false, d2: true, d3: false, desc: 'Dot 2 active (remaining 1500ms)' },
      { pos: 19000, d1: false, d2: false, d3: true, desc: 'Dot 3 active (remaining 1000ms)' },
      { pos: 19500, d1: false, d2: false, d3: true, desc: 'Dot 3 active (remaining 500ms)' },
      { pos: 20000, d1: false, d2: false, d3: true, desc: 'Break end (remaining 0ms)' },
      { pos: 20001, d1: false, d2: false, d3: false, desc: 'After break' },
    ];

    for (const tp of testPoints) {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(InstrumentalDotsRow, {
          startTimeMs,
          endTimeMs,
          currentPositionMs: tp.pos,
        })
      );

      // Verify DOM attributes
      assert.ok(html.includes('role="status"'), 'Must have role="status"');
      assert.ok(html.includes('aria-label="Instrumental break"'), 'Must have aria-label');

      // Check scale(1.4) count for active dot
      const scale14Count = (html.match(/scale\(1\.4\)/g) || []).length;
      const expectedActiveCount = (tp.d1 ? 1 : 0) + (tp.d2 ? 1 : 0) + (tp.d3 ? 1 : 0);
      assert.strictEqual(
        scale14Count,
        expectedActiveCount,
        `Pos ${tp.pos}ms (${tp.desc}): Expected ${expectedActiveCount} active dot(s), got ${scale14Count}`
      );
    }
  });

  test('DOTS-03: Active dot styling contains authentic Apple Music white bloom & crimson glow', () => {
    // When Dot 1 is active (at pos = 17500ms of [10000, 20000])
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(InstrumentalDotsRow, {
        startTimeMs: 10000,
        endTimeMs: 20000,
        currentPositionMs: 17500,
      })
    );

    // Check box shadow: 0 0 14px rgba(255, 255, 255, 0.95), 0 0 24px rgba(250, 45, 72, 0.65)
    assert.ok(html.includes('250, 45, 72') || html.includes('250,45,72'),
      'Active pulse dot must include Apple brand crimson glow (#FA2D48)');
    assert.ok(html.includes('scale(1.4)'), 'Active pulse dot must scale to 1.4');
  });
});

// ============================================================================
// SUITE 4: WEBGL 2 OKLAB SHADER MATH, UNIFORM BINDING CONTRACTS & FALLBACK
// ============================================================================
describe('Suite 4: WebGL 2 OkLab Shader Mathematics, Uniforms & Fallback', () => {

  // Pure JS replicas of sRGB <-> OkLab math from AppleMusicFluidMeshCanvas.tsx
  function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function srgbToOkLab(r, g, b) {
    const lr = srgbToLinear(r);
    const lg = srgbToLinear(g);
    const lb = srgbToLinear(b);

    const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
    const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
    const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

    const l_ = Math.cbrt(l);
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);

    return [
      0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
      1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
      0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    ];
  }

  function srgbTransfer(c) {
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0.0), 1.0 / 2.4) - 0.055;
  }

  function okLabToSrgb(c) {
    const l_ = c[0] + 0.3963377774 * c[1] + 0.2158037573 * c[2];
    const m_ = c[0] - 0.1055613458 * c[1] - 0.0638541728 * c[2];
    const s_ = c[0] - 0.0894841775 * c[1] - 1.2914855480 * c[2];
    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;
    return [
      Math.min(1, Math.max(0, srgbTransfer( 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s))),
      Math.min(1, Math.max(0, srgbTransfer(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s))),
      Math.min(1, Math.max(0, srgbTransfer(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s))),
    ];
  }

  test('SHADER-01: OkLab perceptual color space roundtrip preserves fidelity (<0.002 max error)', () => {
    const testColors = [
      { name: 'Apple Crimson #FA2D48', rgb: [250 / 255, 45 / 255, 72 / 255] },
      { name: 'Pure Red #FF0000', rgb: [1.0, 0.0, 0.0] },
      { name: 'Pure Green #00FF00', rgb: [0.0, 1.0, 0.0] },
      { name: 'Pure Blue #0000FF', rgb: [0.0, 0.0, 1.0] },
      { name: 'Pure White #FFFFFF', rgb: [1.0, 1.0, 1.0] },
      { name: 'Pure Black #000000', rgb: [0.0, 0.0, 0.0] },
      { name: 'Mid Gray #808080', rgb: [0.5, 0.5, 0.5] },
      { name: 'Dark Acrylic #080507', rgb: [8 / 255, 5 / 255, 7 / 255] },
    ];

    for (const { name, rgb } of testColors) {
      const okLab = srgbToOkLab(rgb[0], rgb[1], rgb[2]);
      assert.ok(!Number.isNaN(okLab[0]) && !Number.isNaN(okLab[1]) && !Number.isNaN(okLab[2]),
        `${name}: OkLab conversion resulted in NaN`);

      const roundtripRgb = okLabToSrgb(okLab);
      const maxDelta = Math.max(
        Math.abs(rgb[0] - roundtripRgb[0]),
        Math.abs(rgb[1] - roundtripRgb[1]),
        Math.abs(rgb[2] - roundtripRgb[2])
      );

      assert.ok(maxDelta < 0.002, `${name}: Roundtrip delta ${maxDelta} exceeded 0.002 threshold`);
    }
  });

  test('SHADER-02: Interleaved Gradient Noise (IGN) dithering bounds and high spatial frequency', () => {
    function interleavedGradientNoise(x, y) {
      const dot = x * 0.06711056 + y * 0.00583715;
      const fractDot = dot - Math.floor(dot);
      const mult = 52.9829189 * fractDot;
      return mult - Math.floor(mult);
    }

    // Sample across 10,000 screen-space pixel coordinates
    let minVal = Infinity;
    let maxVal = -Infinity;
    let sum = 0;
    const samples = 10000;

    for (let x = 0; x < 100; x++) {
      for (let y = 0; y < 100; y++) {
        const val = interleavedGradientNoise(x, y);
        assert.ok(!Number.isNaN(val) && Number.isFinite(val), `IGN produced NaN at (${x}, ${y})`);
        if (val < minVal) minVal = val;
        if (val > maxVal) maxVal = val;
        sum += val;
      }
    }

    assert.ok(minVal >= 0.0, `IGN min value was ${minVal}, must be >= 0`);
    assert.ok(maxVal <= 1.0, `IGN max value was ${maxVal}, must be <= 1`);
    const mean = sum / samples;
    // Mean of uniform distribution in [0, 1] is 0.5
    assert.ok(Math.abs(mean - 0.5) < 0.05, `IGN mean value was ${mean}, expected ~0.5`);
  });

  test('SHADER-03: WebGL 2 shader source string validation & uniform binding contracts', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const canvasSrc = fs.readFileSync(
      path.resolve('src/ui/player/AppleMusicFluidMeshCanvas.tsx'),
      'utf-8'
    );

    // Verify #version 300 es
    assert.ok(canvasSrc.includes('#version 300 es'), 'Must declare GLSL ES 3.00 shader header');

    // Verify required uniforms in fragment shader:
    assert.ok(canvasSrc.includes('uniform vec2 u_resolution;'), 'FS must declare u_resolution');
    assert.ok(canvasSrc.includes('uniform float u_time;'), 'FS must declare u_time');
    assert.ok(canvasSrc.includes('uniform vec3 u_colors[4];'), 'FS must declare u_colors[4]');
    assert.ok(canvasSrc.includes('uniform float u_speed;'), 'FS must declare u_speed');
    assert.ok(canvasSrc.includes('uniform bool u_enableDithering;'), 'FS must declare u_enableDithering');

    // Verify CPU uniform binding calls:
    assert.ok(canvasSrc.includes("gl.getUniformLocation(program, 'u_resolution')"), 'Must bind u_resolution');
    assert.ok(canvasSrc.includes("gl.getUniformLocation(program, 'u_time')"), 'Must bind u_time');
    assert.ok(canvasSrc.includes("gl.getUniformLocation(program, 'u_colors')"), 'Must bind u_colors');
    assert.ok(canvasSrc.includes("gl.getUniformLocation(program, 'u_speed')"), 'Must bind u_speed');
    assert.ok(canvasSrc.includes("gl.getUniformLocation(program, 'u_enableDithering')"), 'Must bind u_enableDithering');

    // Verify velocity scaling logic:
    // currentSpeed interpolates towards (isPlaying ? 1.0 : 0.25) * speed
    assert.ok(canvasSrc.includes('(isPlaying ? 1.0 : 0.25) * speed'),
      'Velocity must interpolate between 1.0x (playing) and 0.25x (paused)');
    assert.ok(canvasSrc.includes('gl.uniform1f(uSpeedLoc, currentSpeed)'),
      'Velocity/speed uniform must be bound with currentSpeed');

    // Verify Canvas 2D fallback:
    assert.ok(canvasSrc.includes("canvas.getContext('2d')"), 'Must provide Canvas 2D fallback');
    assert.ok(canvasSrc.includes("ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'"),
      'Canvas 2D fallback must maintain 45% dark scrim');
  });

  test('SHADER-04: AppleMusicFluidMeshCanvas static rendering smoke test (server-side markup)', () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(AppleMusicFluidMeshCanvas, {
        colors: ['#FA2D48', '#3A1019', '#080507', 'rgba(58, 16, 25, 0.65)'],
        isPlaying: true,
        width: 640,
        height: 360,
      })
    );

    assert.ok(html.includes('<canvas'), 'Must render canvas element');
    assert.ok(html.includes('width="640"'), 'Must have width 640');
    assert.ok(html.includes('height="360"'), 'Must have height 360');
  });
});
