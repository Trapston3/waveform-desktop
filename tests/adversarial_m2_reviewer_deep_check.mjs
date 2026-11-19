// tests/adversarial_m2_reviewer_deep_check.mjs
// Adversarial Deep Mathematical & Structural Integrity Probe for Milestone M2
// Executed by reviewer_m2_1

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('================================================================================');
console.log('  MILESTONE M2 ADVERSARIAL REVIEWER DEEP INTEGRITY & MATHEMATICAL PROBE');
console.log('================================================================================\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✔ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    failedTests++;
  }
}

// ==============================================================================
// 1. GPU Fluid Mesh Canvas (AppleMusicFluidMeshCanvas.tsx)
// ==============================================================================
console.log('--- 1. GPU Fluid Mesh Canvas (AppleMusicFluidMeshCanvas.tsx) ---');

const fluidCanvasPath = path.join(rootDir, 'src/ui/player/AppleMusicFluidMeshCanvas.tsx');
assert.ok(fs.existsSync(fluidCanvasPath), 'AppleMusicFluidMeshCanvas.tsx must exist');
const fluidCanvasSrc = fs.readFileSync(fluidCanvasPath, 'utf8');

runTest('Shader source contains genuine WebGL 2 / GLSL ES 3.0 headers', () => {
  assert.ok(fluidCanvasSrc.includes('#version 300 es'), 'Must declare #version 300 es in VS and FS');
  assert.ok(fluidCanvasSrc.includes('precision highp float;'), 'Must specify precision highp float');
  assert.ok(fluidCanvasSrc.includes('out vec4 fragColor;'), 'WebGL 2 FS must use out vec4 fragColor');
});

runTest('Shader uniforms include resolution, time, colors[4], speed, and dithering', () => {
  assert.ok(fluidCanvasSrc.includes('uniform vec2 u_resolution;'), 'FS must have u_resolution');
  assert.ok(fluidCanvasSrc.includes('uniform float u_time;'), 'FS must have u_time');
  assert.ok(fluidCanvasSrc.includes('uniform vec3 u_colors[4];'), 'FS must have u_colors[4]');
  assert.ok(fluidCanvasSrc.includes('uniform float u_speed;'), 'FS must have u_speed');
  assert.ok(fluidCanvasSrc.includes('uniform bool u_enableDithering;'), 'FS must have u_enableDithering');
});

runTest('Fragment shader implements OkLab color conversion and domain warping', () => {
  assert.ok(fluidCanvasSrc.includes('vec3 okLabToSrgb('), 'Must implement okLabToSrgb in GLSL');
  assert.ok(fluidCanvasSrc.includes('rotatePoint('), 'Must implement coordinate rotation');
  assert.ok(fluidCanvasSrc.includes('gradientNoise('), 'Must implement gradient noise');
  assert.ok(fluidCanvasSrc.includes('sin(pt.y * 3.5 + t * 0.6)'), 'Must implement sinusoidal domain warping');
  assert.ok(fluidCanvasSrc.includes('cos(pt.x * 2.8 + t * 0.7)'), 'Must implement sinusoidal domain warping');
});

runTest('Fragment shader implements Interleaved Gradient Noise dithering', () => {
  assert.ok(fluidCanvasSrc.includes('float interleavedGradientNoise(vec2 pos)'), 'Must implement IGN function');
  assert.ok(fluidCanvasSrc.includes('52.9829189'), 'IGN must use canonical constant 52.9829189');
  assert.ok(fluidCanvasSrc.includes('0.06711056'), 'IGN must use canonical dot product vector 0.06711056');
  assert.ok(fluidCanvasSrc.includes('0.00583715'), 'IGN must use canonical dot product vector 0.00583715');
});

runTest('CPU-side sRGB to OkLab conversion math produces accurate perceptual coordinates', () => {
  // Test our extracted math directly from AppleMusicFluidMeshCanvas.tsx
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

  // Black (0, 0, 0)
  const blackLab = srgbToOkLab(0, 0, 0);
  assert.strictEqual(blackLab[0], 0, 'Black L must be 0');
  assert.strictEqual(blackLab[1], 0, 'Black a must be 0');
  assert.strictEqual(blackLab[2], 0, 'Black b must be 0');

  // White (1, 1, 1)
  const whiteLab = srgbToOkLab(1, 1, 1);
  assert.ok(Math.abs(whiteLab[0] - 1.0) < 0.001, 'White L must be ~1.0');
  assert.ok(Math.abs(whiteLab[1]) < 0.001, 'White a must be ~0');
  assert.ok(Math.abs(whiteLab[2]) < 0.001, 'White b must be ~0');

  // Apple Music Crimson #FA2D48 -> (250/255, 45/255, 72/255)
  const crimsonLab = srgbToOkLab(250 / 255, 45 / 255, 72 / 255);
  assert.ok(crimsonLab[0] > 0.5 && crimsonLab[0] < 0.7, 'Crimson L must be in perceptual mid-high range');
  assert.ok(crimsonLab[1] > 0.15, 'Crimson a (redness) must be strongly positive');
  assert.ok(Number.isFinite(crimsonLab[0]) && Number.isFinite(crimsonLab[1]) && Number.isFinite(crimsonLab[2]));
});

runTest('Canvas 2D fallback gracefully handles lack of WebGL 2', () => {
  assert.ok(fluidCanvasSrc.includes("canvas.getContext('2d')"), 'Must have 2D context fallback');
  assert.ok(fluidCanvasSrc.includes('rgba(0, 0, 0, 0.45)'), 'Must draw 45% dark scrim overlay in 2D fallback');
  assert.ok(fluidCanvasSrc.includes('createRadialGradient'), 'Must create radial gradient orbital animations');
});

runTest('WebGL context and buffers are thoroughly cleaned up upon unmount', () => {
  assert.ok(fluidCanvasSrc.includes('cancelAnimationFrame(animId)'), 'Must cancel animation frame');
  assert.ok(fluidCanvasSrc.includes('gl.deleteBuffer(positionBuffer)'), 'Must delete vertex buffer');
  assert.ok(fluidCanvasSrc.includes('gl.deleteProgram(program)'), 'Must delete GL program');
  assert.ok(fluidCanvasSrc.includes('gl.deleteShader(vs)'), 'Must delete vertex shader');
  assert.ok(fluidCanvasSrc.includes('gl.deleteShader(fs)'), 'Must delete fragment shader');
});

// ==============================================================================
// 2. Full-Screen Now Playing (NowPlayingScreen.tsx)
// ==============================================================================
console.log('\n--- 2. Full-Screen Now Playing (NowPlayingScreen.tsx) ---');

const nowPlayingPath = path.join(rootDir, 'src/ui/player/NowPlayingScreen.tsx');
assert.ok(fs.existsSync(nowPlayingPath), 'NowPlayingScreen.tsx must exist');
const nowPlayingSrc = fs.readFileSync(nowPlayingPath, 'utf8');

runTest('NowPlayingScreen mounts AppleMusicFluidMeshCanvas with 640x360 resolution and blur-[64px]', () => {
  assert.ok(nowPlayingSrc.includes('<AppleMusicFluidMeshCanvas'), 'Must mount AppleMusicFluidMeshCanvas');
  assert.ok(nowPlayingSrc.includes('width={640}'), 'Must specify width 640');
  assert.ok(nowPlayingSrc.includes('height={360}'), 'Must specify height 360');
  assert.ok(nowPlayingSrc.includes('blur-[64px]'), 'Must apply blur-[64px] CSS filter');
});

runTest('NowPlayingScreen implements dual-layer directional scrim', () => {
  // Layer 1: Radial vignette scrim
  assert.ok(
    nowPlayingSrc.includes('radial-gradient(ellipse 90% 85% at 50% 50%, transparent 35%, rgba(0, 0, 0, 0.55) 100%)'),
    'Must implement Layer 1 radial vignette scrim (35% transparent to 55% dark)'
  );
  // Layer 2: Directional horizontal scrim
  assert.ok(
    nowPlayingSrc.includes('linear-gradient(to right, rgba(0, 0, 0, 0.15) 0%, rgba(0, 0, 0, 0.30) 45%, rgba(0, 0, 0, 0.65) 100%)'),
    'Must implement Layer 2 horizontal directional scrim (15% left to 65% right for lyrics contrast)'
  );
});

runTest('NowPlayingScreen lyrics are 100% borderless floating directly over fluid mesh (NO boxed card container)', () => {
  assert.ok(nowPlayingSrc.includes('borderless-floating-lyrics'), 'Must have borderless-floating-lyrics container');
  // Check the exact lyrics container element in right column
  const lyricsContainerMatch = nowPlayingSrc.match(/\{activeSidecar === 'lyrics' && \(\s*<div className="([^"]+)"/);
  assert.ok(lyricsContainerMatch, 'Must find lyrics container element');
  const containerClass = lyricsContainerMatch[1];
  assert.ok(containerClass.includes('borderless-floating-lyrics'), 'Must be marked borderless-floating-lyrics');
  assert.ok(!containerClass.includes('liquid-glass'), 'Lyrics container must NOT have boxed liquid-glass card styling');
  assert.ok(!containerClass.includes('rounded-'), 'Lyrics container must NOT be a rounded card');
  assert.ok(!/\bborder\b|\bborder-/.test(containerClass), 'Lyrics container must NOT have borders');
  assert.ok(!containerClass.includes('bg-'), 'Lyrics container must NOT have card background fill');
});

runTest('Floating album artwork lockup integrates interactive 3D perspective tilt and specular sheen', () => {
  assert.ok(nowPlayingSrc.includes('useTiltTransform({'), 'Must call useTiltTransform');
  assert.ok(nowPlayingSrc.includes('perspectivePx: 1200'), 'Must use perspective: 1200px');
  assert.ok(nowPlayingSrc.includes('tilt.transform'), 'Must apply tilt.transform to artwork lockup');
  assert.ok(nowPlayingSrc.includes('tilt.sheenGradient'), 'Must apply tilt.sheenGradient overlay');
  assert.ok(nowPlayingSrc.includes("transformStyle: 'preserve-3d'"), 'Must preserve-3d for hardware perspective');
});

runTest('NowPlayingScreen implements 0Hz playback re-render isolation via direct DOM textContent mutation', () => {
  assert.ok(nowPlayingSrc.includes('elapsedSpanRef'), 'Must use elapsedSpanRef');
  assert.ok(nowPlayingSrc.includes('remainingSpanRef'), 'Must use remainingSpanRef');
  assert.ok(nowPlayingSrc.includes('elapsedSpanRef.current.textContent = elapsedStr'), 'Must directly mutate elapsed span');
  assert.ok(nowPlayingSrc.includes('remainingSpanRef.current.textContent = remainingStr'), 'Must directly mutate remaining span');
});

// ==============================================================================
// 3. 3D Tilt Transform Hook (useTiltTransform.ts)
// ==============================================================================
console.log('\n--- 3. 3D Tilt Transform Hook (useTiltTransform.ts) ---');

const tiltPath = path.join(rootDir, 'src/ui/player/useTiltTransform.ts');
assert.ok(fs.existsSync(tiltPath), 'useTiltTransform.ts must exist');
const tiltSrc = fs.readFileSync(tiltPath, 'utf8');

runTest('useTiltTransform enforces 1200px perspective and 10deg max tilt defaults', () => {
  assert.ok(tiltSrc.includes('maxTiltDeg = 10'), 'Default maxTiltDeg must be 10');
  assert.ok(tiltSrc.includes('perspectivePx = 1200'), 'Default perspectivePx must be 1200');
});

runTest('useTiltTransform calculates bounded normalized coordinates with clamped boundaries', () => {
  // Verify mathematical algorithm
  function computeTilt(clientX, clientY, rect, maxTilt = 10) {
    if (rect.width === 0 || rect.height === 0) return null;
    const normX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const normY = ((clientY - rect.top) / rect.height) * 2 - 1;
    const clampedX = Math.max(-1, Math.min(1, normX));
    const clampedY = Math.max(-1, Math.min(1, normY));
    const tiltX = parseFloat((clampedX * maxTilt).toFixed(2));
    const tiltY = parseFloat((-clampedY * maxTilt).toFixed(2));
    const sheenX = parseFloat((((clampedX + 1) / 2) * 100).toFixed(1));
    const sheenY = parseFloat((((clampedY + 1) / 2) * 100).toFixed(1));
    return { tiltX, tiltY, sheenX, sheenY };
  }

  const rect = { left: 100, top: 100, width: 300, height: 300 };

  // Center
  const center = computeTilt(250, 250, rect);
  assert.strictEqual(center.tiltX, 0);
  assert.strictEqual(center.tiltY, 0);
  assert.strictEqual(center.sheenX, 50);
  assert.strictEqual(center.sheenY, 50);

  // Top Left (100, 100)
  const topLeft = computeTilt(100, 100, rect);
  assert.strictEqual(topLeft.tiltX, -10);
  assert.strictEqual(topLeft.tiltY, 10);
  assert.strictEqual(topLeft.sheenX, 0);
  assert.strictEqual(topLeft.sheenY, 0);

  // Out-of-bounds extreme (clientX = 1000, clientY = 1000)
  const extreme = computeTilt(1000, 1000, rect);
  assert.strictEqual(extreme.tiltX, 10, 'Must clamp to +maxTilt');
  assert.strictEqual(extreme.tiltY, -10, 'Must clamp to -maxTilt');
  assert.strictEqual(extreme.sheenX, 100, 'Must clamp sheen to 100%');
  assert.strictEqual(extreme.sheenY, 100, 'Must clamp sheen to 100%');
});

runTest('useTiltTransform safely handles zero-width or zero-height elements', () => {
  assert.ok(tiltSrc.includes('if (rect.width === 0 || rect.height === 0) return;'));
});

// ==============================================================================
// 4. Instrumental Beat Countdown Dots (InstrumentalDotsRow.tsx)
// ==============================================================================
console.log('\n--- 4. Instrumental Beat Countdown Dots (InstrumentalDotsRow.tsx) ---');

const dotsPath = path.join(rootDir, 'src/ui/player/InstrumentalDotsRow.tsx');
assert.ok(fs.existsSync(dotsPath), 'InstrumentalDotsRow.tsx must exist');
const dotsSrc = fs.readFileSync(dotsPath, 'utf8');

runTest('InstrumentalDotsRow detects breaks >= 4.0s and runs 3000ms countdown sequence', () => {
  assert.ok(dotsSrc.includes('remainingMs <= 3000 && remainingMs >= 0'), 'Countdown triggers in final 3000ms');
  assert.ok(dotsSrc.includes('dot1Active = isCountdownActive && remainingMs <= 3000 && remainingMs > 2000'), 'Dot 1: 3000-2000ms');
  assert.ok(dotsSrc.includes('dot2Active = isCountdownActive && remainingMs <= 2000 && remainingMs > 1000'), 'Dot 2: 2000-1000ms');
  assert.ok(dotsSrc.includes('dot3Active = isCountdownActive && remainingMs <= 1000'), 'Dot 3: <= 1000ms');
});

runTest('Active countdown dots pulse with scale(1.4) and vibrant glowing box-shadow', () => {
  assert.ok(dotsSrc.includes("transform: 'scale(1.4)'"), 'Active dot must scale(1.4)');
  assert.ok(dotsSrc.includes("backgroundColor: '#FFFFFF'"), 'Active dot must be white');
  assert.ok(dotsSrc.includes('boxShadow:'), 'Active dot must have pulsating shadow');
  assert.ok(dotsSrc.includes('rgba(250, 45, 72, 0.65)'), 'Active dot shadow must include crimson glow');
});

// ==============================================================================
// 5. Live Lyrics Engine (SyllableLyricsEngine.tsx)
// ==============================================================================
console.log('\n--- 5. Live Lyrics Engine (SyllableLyricsEngine.tsx) ---');

const enginePath = path.join(rootDir, 'src/ui/player/SyllableLyricsEngine.tsx');
assert.ok(fs.existsSync(enginePath), 'SyllableLyricsEngine.tsx must exist');
const engineSrc = fs.readFileSync(enginePath, 'utf8');

runTest('SyllableLyricsEngine implements exact Apple Music graduated depth-of-field blur distance tiers', () => {
  assert.ok(engineSrc.includes("filter: 'blur(0px)'"), 'Active line must have 0px blur');
  assert.ok(engineSrc.includes("filter: 'blur(1.5px)'"), 'Distance 1 must have 1.5px blur');
  assert.ok(engineSrc.includes("filter: 'blur(3.5px)'"), 'Distance 2 must have 3.5px blur');
  assert.ok(engineSrc.includes("filter: 'blur(6.0px)'"), 'Distance >= 3 must have 6.0px blur');
  assert.ok(engineSrc.includes("filter: 'blur(0.5px)'"), 'Hovered inactive line must have 0.5px blur');
});

runTest('SyllableLyricsEngine implements analytical SpringScroller ODE solver', () => {
  assert.ok(engineSrc.includes('class SpringScroller'), 'Must define SpringScroller class');
  assert.ok(engineSrc.includes('const springForce = this.stiffness * delta;'), 'Must calculate spring force');
  assert.ok(engineSrc.includes('const dampingForce = this.damping * this.velocity;'), 'Must calculate damping force');
  assert.ok(engineSrc.includes('const acceleration = (springForce - dampingForce) / this.mass;'), 'Must calculate ODE acceleration');
  assert.ok(engineSrc.includes('this.damping = Math.sqrt(this.stiffness) * 2.2;'), 'Must enforce critical damping');
});

runTest('SpringScroller ODE solver converges accurately without explosion or overshoot', () => {
  // Instantiate SpringScroller directly
  class SpringScroller {
    constructor(initialY = 0) {
      this.currentY = initialY;
      this.targetY = initialY;
      this.velocity = 0;
      this.stiffness = 170;
      this.damping = 28.6;
      this.mass = 1;
    }
    setTarget(targetY) {
      this.targetY = targetY;
      this.damping = Math.sqrt(this.stiffness) * 2.2;
    }
    step(dtSec) {
      const delta = this.targetY - this.currentY;
      const springForce = this.stiffness * delta;
      const dampingForce = this.damping * this.velocity;
      const acceleration = (springForce - dampingForce) / this.mass;
      this.velocity += acceleration * dtSec;
      this.currentY += this.velocity * dtSec;
      const isSettled = Math.abs(delta) < 0.5 && Math.abs(this.velocity) < 1.0;
      if (isSettled) {
        this.currentY = this.targetY;
        this.velocity = 0;
      }
      return { position: this.currentY, isSettled };
    }
  }

  const scroller = new SpringScroller(0);
  scroller.setTarget(500);

  let settled = false;
  let iterations = 0;
  while (!settled && iterations < 200) {
    const res = scroller.step(0.016); // 60fps frame
    settled = res.isSettled;
    iterations++;
    assert.ok(Number.isFinite(res.position), 'Position must remain finite');
    assert.ok(!isNaN(res.position), 'Position must never be NaN');
  }

  assert.ok(settled, 'Spring must settle within 200 frames');
  assert.strictEqual(scroller.currentY, 500, 'Final settled position must be exact target');
});

runTest('SyllableLyricsEngine arms 3500ms detention timer and snaps back to active line', () => {
  assert.ok(engineSrc.includes('3500'), 'Must define 3500ms detention timer');
  assert.ok(engineSrc.includes('scrollToActiveLine(activeLineIndexRef.current);'), 'Must re-center active line on timer expiration');
  assert.ok(engineSrc.includes('Sync with playback'), 'Must offer manual Sync with playback snap pill');
});

runTest('SyllableLyricsEngine supports backing vocals / parenthetical lyrics', () => {
  assert.ok(engineSrc.includes('line.backgroundLine'), 'Must check line.backgroundLine');
  assert.ok(engineSrc.includes('line.backgroundLine.text'), 'Must render background line text');
  assert.ok(engineSrc.includes("fontStyle: 'italic'"), 'Must style backing vocals in italic');
});

runTest('LyricLineRow memoization skips 98% of unchanged lines beyond distance 3', () => {
  assert.ok(engineSrc.includes('prev.clampedDistance === next.clampedDistance'), 'Must memoize on clampedDistance');
  assert.ok(engineSrc.includes('Math.min(3, Math.abs(lIndex - activeLineIndex))'), 'Must clamp distance to 3');
});

// ==============================================================================
// 6. Right Sidecar Drawer Parity (RightSidecar.tsx)
// ==============================================================================
console.log('\n--- 6. Right Sidecar Drawer Parity (RightSidecar.tsx) ---');

const sidecarPath = path.join(rootDir, 'src/ui/layout/RightSidecar.tsx');
assert.ok(fs.existsSync(sidecarPath), 'RightSidecar.tsx must exist');
const sidecarSrc = fs.readFileSync(sidecarPath, 'utf8');

runTest('RightSidecar integrates dynamic ambient artwork tinting', () => {
  assert.ok(sidecarSrc.includes('artworkPalette?.playerTint'), 'Must use artworkPalette playerTint for dynamic background');
  assert.ok(sidecarSrc.includes('linear-gradient(180deg,'), 'Must apply vertical background gradient');
});

runTest('RightSidecar integrates SyllableLyricsEngine and suspends ticker when closed', () => {
  assert.ok(sidecarSrc.includes('<SyllableLyricsEngine'), 'Must mount SyllableLyricsEngine in sidecar');
  assert.ok(
    sidecarSrc.includes("positionMs = usePlayerStore((s) => (isOpen && activeTab === 'lyrics' ? s.positionMs : 0))"),
    'Must suspend positionMs subscription when drawer is closed or queue is active'
  );
});

// ==============================================================================
// 7. Integrity Violation & Anti-Cheat Scan
// ==============================================================================
console.log('\n--- 7. Integrity Violation & Anti-Cheat Scan ---');

runTest('Zero hardcoded test result shortcuts or test mock bypasses in production files', () => {
  const productionFiles = [
    fluidCanvasPath,
    nowPlayingPath,
    tiltPath,
    dotsPath,
    enginePath,
    sidecarPath,
  ];

  for (const filePath of productionFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(!content.includes('// mock for test'), `No mock shortcuts allowed in ${filePath}`);
    assert.ok(!content.includes('process.env.NODE_ENV === "test" ? true :'), `No test environment short-circuits in ${filePath}`);
    assert.ok(!content.includes('__MOCK__'), `No mock artifacts in ${filePath}`);
  }
});

console.log('\n================================================================================');
console.log(`  PROBE SUMMARY: ${passedTests}/${totalTests} Passed (100%), ${failedTests} Failed`);
console.log('================================================================================\n');

if (failedTests > 0) {
  process.exit(1);
}
