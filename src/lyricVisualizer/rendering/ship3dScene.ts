// Procedural 3D Starfield + Arcade Rhythm-Runner Starfighter, Cratered Asteroids,
// 3D Lyric Gates, Laser/Shard/Lightning/Spark FX Pools & Trauma Camera Rig.
// Pre-allocates all Three.js geometries, materials, typed arrays, and scratch objects
// for zero per-frame heap allocations at 60fps.
// Includes graceful Canvas2D software fallback when WebGL is unavailable (e.g. headless Node tests).

import * as THREE from 'three';
import type { AudioFrameMetrics, LyricPalette, Lyrics } from '../core/models';
import { detectMagicWordEffect, type MagicWordKind } from './lyricSemantics';
import { parseColorToRgbInto } from './webGlEffectLayer';

const STAR_COUNT = 2400;
const STAR_STRIDE = 6; // x, y, z, size, phase, colorKind
const WARP_STREAK_COUNT = 80;

const ASTEROID_COUNT = 32;
// x, y, z, rx, ry, rotSpeed, scale, variantIdx, seedStretch, vx, vy, alive(0|1)
const ASTEROID_STRIDE = 12;
const ASTEROID_VARIANTS = 7;

const DEBRIS_COUNT = 220;
const TRAIL_SEGMENTS = 36;
const SHOCKWAVE_POOL = 6;
const SPLASH_DROPLET_POOL = 192;
const WORD_FLASH_POOL = 48;
const GATE_POOL = 36;
const STAGGER_QUEUE_SIZE = 16;
const SPARK_POOL = 72;
const LASER_POOL = 8;
const SHARD_POOL = 28;
const LIGHTNING_SEGMENTS = 18;

const SHIP_WIDTH = 1.45;
const SHIP_WORLD_Z = 0.35;
const SHIP_NOSE_Z = SHIP_WORLD_Z - 0.85;
const SHIP_BASE_Y = -0.15;
const GATE_LOOKAHEAD_SEC = 2.8;
const GATE_TRAVEL_SPEED = 14.5;
const MANEUVER_MIN_COOLDOWN_SEC = 6.0;
const MANEUVER_ANTICIPATION_SEC = 0.16;
const MANEUVER_ANTICIPATION_RAD = (12 * Math.PI) / 180;
const MANEUVER_SETTLE_SEC = 0.22;

// Semantic action bitmask flags (precomputed once per lyrics load)
const SEM_FIRE = 1 << 0;
const SEM_BOOST = 1 << 1;
const SEM_RAINBOW = 1 << 2;
const SEM_ICE = 1 << 3;
const SEM_ELECTRIC = 1 << 4;
const SEM_TIME = 1 << 5;
const SEM_UP = 1 << 6;
const SEM_DOWN = 1 << 7;
const SEM_LOVE = 1 << 8;
const SEM_GLITCH = 1 << 9;

// Module-level hint synchronized by StarfieldShip3DStyle before/during render
let currentVariationIndex: 0 | 1 | 2 = 0;
let currentBackgroundOpacity = 0.95;
let currentVignetteStrength = 0.55;
let activeShip3DSceneRef: Ship3DScene | null = null;

export function setActiveShip3DScene(scene: Ship3DScene | null): void {
  activeShip3DSceneRef = scene;
}

export function getActiveShip3DScene(): Ship3DScene | null {
  return activeShip3DSceneRef;
}

export function setShip3DSceneHint(
  variationId?: string,
  backgroundOpacity?: number,
  vignetteStrength?: number
): void {
  if (variationId === 'nebula-run') currentVariationIndex = 1;
  else if (variationId === 'retro-wireframe' || variationId === 'retro-vector-wireframe') currentVariationIndex = 2;
  else currentVariationIndex = 0;

  if (typeof backgroundOpacity === 'number' && Number.isFinite(backgroundOpacity)) {
    currentBackgroundOpacity = Math.max(0, Math.min(1, backgroundOpacity));
  }
  if (typeof vignetteStrength === 'number' && Number.isFinite(vignetteStrength)) {
    currentVignetteStrength = Math.max(0, Math.min(1, vignetteStrength));
  }
}

export interface Ship3DFlightVec {
  x: number;
  y: number;
  z?: number;
}

export interface Ship3DWordGateProjection {
  readonly text: string;
  readonly screenX: number;
  readonly screenY: number;
  readonly scale: number;
  readonly alpha: number;
  readonly isActive: boolean;
  readonly semanticMask: number;
  readonly mergeFlash: number;
  readonly worldX: number;
  readonly worldY: number;
  readonly worldZ: number;
  readonly lineIndex: number;
  readonly wordIndex: number;
}

export interface Ship3DHudTelemetry {
  readonly score: number;
  readonly combo: number;
  readonly nearMissCount: number;
  readonly wordPop: number;
  readonly collectFlash: number;
  readonly chromaticPulse: number;
  readonly icePulse: number;
  readonly glitchPulse: number;
  readonly bulletTimeActive: boolean;
  readonly rainbowActive: boolean;
  readonly toastText: string;
  readonly toastAlpha: number;
  readonly toastColorKind: 'accent' | 'gold' | 'danger' | 'ice';
  readonly activeWordKey: number;
  readonly isInstrumentalGauntlet: boolean;
}

interface PrecomputedWordGate {
  readonly key: number;
  readonly lineIndex: number;
  readonly wordIndex: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly text: string;
  readonly magicKind: MagicWordKind | null;
  readonly semanticMask: number;
}

// ---------------------------------------------------------------------------
// Software Canvas2D Fallback Geometry Tables (used when WebGL is unavailable)
// ---------------------------------------------------------------------------

const SHIP_VERTS = new Float32Array([
  0.0, -0.02, 2.45,
  0.0, 0.16, 1.25,
  -0.46, 0.02, 0.95,
  0.46, 0.02, 0.95,
  -2.25, -0.16, -0.95,
  2.25, -0.16, -0.95,
  -0.54, -0.04, -1.42,
  0.54, -0.04, -1.42,
  0.0, 0.44, -1.18,
  0.0, -0.28, -0.25,
  -1.18, -0.08, -1.26,
  1.18, -0.08, -1.26,
  0.0, 0.42, 0.35,
  0.0, 0.34, -0.42,
  -0.92, 0.56, -1.32,
  0.92, 0.56, -1.32,
  -0.64, 0.1, -0.18,
  0.64, 0.1, -0.18,
]);

const SHIP_FACES = new Float32Array([
  0, 1, 2, 0.95, 0,
  0, 3, 1, 0.88, 0,
  1, 12, 2, 0.98, 2,
  1, 3, 12, 0.92, 2,
  12, 13, 16, 0.9, 2,
  12, 17, 13, 0.85, 2,
  2, 12, 16, 0.78, 0,
  3, 17, 12, 0.74, 0,
  13, 8, 6, 0.68, 0,
  13, 7, 8, 0.64, 0,
  16, 13, 6, 0.62, 0,
  17, 7, 13, 0.58, 0,
  2, 16, 4, 0.72, 1,
  16, 10, 4, 0.66, 1,
  16, 6, 10, 0.7, 1,
  3, 5, 17, 0.68, 1,
  17, 5, 11, 0.62, 1,
  17, 11, 7, 0.65, 1,
  16, 14, 10, 0.82, 1,
  17, 11, 15, 0.79, 1,
  0, 2, 9, 0.44, 3,
  0, 9, 3, 0.41, 3,
  9, 6, 7, 0.35, 3,
]);

const VERT_COUNT = SHIP_VERTS.length / 3;
const FACE_COUNT = SHIP_FACES.length / 5;

const AST_VERTS = new Float32Array([
  0.0, 1.05, 0.0,
  0.0, -1.0, 0.0,
  0.95, 0.1, 0.85,
  -0.9, -0.1, 0.88,
  -0.88, 0.15, -0.9,
  0.92, -0.12, -0.85,
]);

const AST_FACES = new Int32Array([
  0, 3, 2,
  0, 2, 5,
  0, 5, 4,
  0, 4, 3,
  1, 2, 3,
  1, 5, 2,
  1, 4, 5,
  1, 3, 4,
]);

const ASTEROID_SHADE_FILLS: readonly string[] = Array.from({ length: 8 }, (_, f) => {
  const facetShade = 0.35 + (f % 4) * 0.16;
  const baseLum = Math.round(22 + facetShade * 48);
  return `rgb(${baseLum}, ${Math.round(baseLum * 1.05)}, ${Math.round(baseLum * 1.22)})`;
});

const SHIP_FACE_FILLS: readonly string[] = Array.from({ length: FACE_COUNT }, (_, f) => {
  const lum = Math.round(26 + SHIP_FACES[f * 5 + 3] * 72);
  return `rgb(${Math.round(lum * 0.84)}, ${Math.round(lum * 0.94)}, ${Math.min(255, Math.round(lum * 1.22))})`;
});

// ---------------------------------------------------------------------------
// Precomputed Semantic Classifier (called ONLY when lyrics load)
// ---------------------------------------------------------------------------

function classifyWordSemantics(rawWord: string, magic: MagicWordKind | null): number {
  let mask = 0;
  const clean = rawWord.toLowerCase().replace(/[^a-z]/g, '');

  if (
    magic === 'fire' ||
    magic === 'impact' ||
    clean === 'explode' ||
    clean === 'explosion' ||
    clean === 'fight' ||
    clean === 'fighting' ||
    clean === 'break' ||
    clean === 'blast'
  ) {
    mask |= SEM_FIRE;
  }
  if (
    magic === 'spin' ||
    clean === 'boost' ||
    clean === 'fast' ||
    clean === 'faster' ||
    clean === 'speed' ||
    clean === 'rocket' ||
    clean === 'rockets' ||
    clean === 'rush' ||
    clean === 'hyper' ||
    clean === 'run' ||
    clean === 'running'
  ) {
    mask |= SEM_BOOST;
  }
  if (magic === 'rainbow' || magic === 'neon') {
    mask |= SEM_RAINBOW;
  }
  if (magic === 'ice') {
    mask |= SEM_ICE;
  }
  if (magic === 'electric') {
    mask |= SEM_ELECTRIC;
  }
  if (
    magic === 'time' ||
    clean === 'slow' ||
    clean === 'slowly' ||
    clean === 'stop' ||
    clean === 'hold'
  ) {
    mask |= SEM_TIME;
  }
  if (
    magic === 'float' ||
    clean === 'up' ||
    clean === 'high' ||
    clean === 'higher' ||
    clean === 'rise' ||
    clean === 'rising' ||
    clean === 'sky' ||
    clean === 'heaven' ||
    clean === 'fly' ||
    clean === 'flying'
  ) {
    mask |= SEM_UP;
  }
  if (
    magic === 'fall' ||
    clean === 'down' ||
    clean === 'low' ||
    clean === 'sink' ||
    clean === 'sinking' ||
    clean === 'deep'
  ) {
    mask |= SEM_DOWN;
  }
  if (magic === 'love' || magic === 'sparkle' || magic === 'shiny' || magic === 'heartbeat') {
    mask |= SEM_LOVE;
  }
  if (
    magic === 'broken' ||
    magic === 'glitch' ||
    magic === 'ghost' ||
    clean === 'dark' ||
    clean === 'void'
  ) {
    mask |= SEM_GLITCH;
  }

  return mask;
}

// ---------------------------------------------------------------------------
// Deterministic 3D FBM Noise & Procedural Cratered Asteroid Geometry Builder
// ---------------------------------------------------------------------------

function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h =
    (Math.imul(ix, 374761393) +
      Math.imul(iy, 668265263) +
      Math.imul(iz, 2147483647) +
      Math.imul(seed, 1274126177)) |
    0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise3D(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);

  const c000 = hash3(ix, iy, iz, seed);
  const c100 = hash3(ix + 1, iy, iz, seed);
  const c010 = hash3(ix, iy + 1, iz, seed);
  const c110 = hash3(ix + 1, iy + 1, iz, seed);
  const c001 = hash3(ix, iy, iz + 1, seed);
  const c101 = hash3(ix + 1, iy, iz + 1, seed);
  const c011 = hash3(ix, iy + 1, iz + 1, seed);
  const c111 = hash3(ix + 1, iy + 1, iz + 1, seed);

  const x00 = c000 + (c100 - c000) * ux;
  const x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux;
  const x11 = c011 + (c111 - c011) * ux;
  const y0 = x00 + (x10 - x00) * uy;
  const y1 = x01 + (x11 - x01) * uy;
  return (y0 + (y1 - y0) * uz) * 2 - 1;
}

function fbm3D(x: number, y: number, z: number, seed: number): number {
  let sum = 0;
  let amp = 0.55;
  let freq = 1.6;
  for (let o = 0; o < 3; o++) {
    sum += amp * valueNoise3D(x * freq, y * freq, z * freq, seed + o * 31);
    freq *= 2.05;
    amp *= 0.48;
  }
  return sum;
}

function createProceduralAsteroidGeometry(variantIdx: number): THREE.BufferGeometry {
  const geom = new THREE.IcosahedronGeometry(1, 2);
  const pos = geom.attributes.position;
  const seed = 101 + variantIdx * 97;

  const craterCount = 3 + (variantIdx % 2);
  const craters: Array<{ dx: number; dy: number; dz: number; rad: number; depth: number }> = [];
  for (let c = 0; c < craterCount; c++) {
    const theta = hash3(variantIdx, c, 1, seed) * Math.PI * 2;
    const phi = Math.acos(2 * hash3(variantIdx, c, 2, seed) - 1);
    craters.push({
      dx: Math.sin(phi) * Math.cos(theta),
      dy: Math.cos(phi),
      dz: Math.sin(phi) * Math.sin(theta),
      rad: 0.34 + hash3(variantIdx, c, 3, seed) * 0.24,
      depth: 0.16 + hash3(variantIdx, c, 4, seed) * 0.14,
    });
  }

  const stretchX = 0.84 + hash3(variantIdx, 7, 1, seed) * 0.38;
  const stretchY = 0.78 + hash3(variantIdx, 7, 2, seed) * 0.34;
  const stretchZ = 0.86 + hash3(variantIdx, 7, 3, seed) * 0.42;

  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);
    const len = Math.hypot(vx, vy, vz) || 1;
    const nx = vx / len;
    const ny = vy / len;
    const nz = vz / len;

    let disp = 1.0 + fbm3D(nx, ny, nz, seed) * 0.34;
    for (let c = 0; c < craters.length; c++) {
      const cr = craters[c];
      const dot = Math.max(-1, Math.min(1, nx * cr.dx + ny * cr.dy + nz * cr.dz));
      const ang = Math.acos(dot);
      if (ang < cr.rad) {
        const u = ang / cr.rad;
        const bowl = (1 - u * u) * cr.depth;
        const rim = Math.exp(-Math.pow((u - 0.92) / 0.14, 2)) * cr.depth * 0.35;
        disp = disp - bowl + rim;
      }
    }

    pos.setXYZ(i, nx * disp * stretchX, ny * disp * stretchY, nz * disp * stretchZ);
  }

  pos.needsUpdate = true;
  geom.computeVertexNormals();
  return geom;
}

// ---------------------------------------------------------------------------
// Sculpted Tapered Starfighter Fuselage & Shaders
// ---------------------------------------------------------------------------

function createSculptedFuselageGeometry(): THREE.BufferGeometry {
  const stations = [
    { z: -2.65, rx: 0.035, ryTop: 0.025, ryBot: -0.02, yOff: -0.02 },
    { z: -1.85, rx: 0.24, ryTop: 0.14, ryBot: -0.1, yOff: -0.01 },
    { z: -0.95, rx: 0.42, ryTop: 0.24, ryBot: -0.18, yOff: 0.0 },
    { z: -0.1, rx: 0.56, ryTop: 0.28, ryBot: -0.22, yOff: 0.02 },
    { z: 0.68, rx: 0.6, ryTop: 0.27, ryBot: -0.22, yOff: 0.02 },
    { z: 1.26, rx: 0.52, ryTop: 0.22, ryBot: -0.19, yOff: 0.0 },
    { z: 1.38, rx: 0.42, ryTop: 0.16, ryBot: -0.14, yOff: 0.0 },
  ];
  const ringPts = [
    [0.0, 1.0],
    [0.62, 0.72],
    [1.0, 0.12],
    [0.72, -0.68],
    [0.0, -1.0],
    [-0.72, -0.68],
    [-1.0, 0.12],
    [-0.62, 0.72],
  ];

  const ringSize = ringPts.length;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let s = 0; s < stations.length; s++) {
    const st = stations[s];
    for (let p = 0; p < ringSize; p++) {
      const [ux, uy] = ringPts[p];
      const x = ux * st.rx;
      const y = st.yOff + (uy >= 0 ? uy * st.ryTop : -uy * st.ryBot);
      positions.push(x, y, st.z);
    }
  }

  for (let s = 0; s < stations.length - 1; s++) {
    const baseA = s * ringSize;
    const baseB = (s + 1) * ringSize;
    for (let p = 0; p < ringSize; p++) {
      const nextP = (p + 1) % ringSize;
      const a0 = baseA + p;
      const a1 = baseA + nextP;
      const b0 = baseB + p;
      const b1 = baseB + nextP;
      indices.push(a0, b0, a1);
      indices.push(a1, b0, b1);
    }
  }

  const aftCenterIdx = positions.length / 3;
  const lastSt = stations[stations.length - 1];
  positions.push(0, lastSt.yOff, lastSt.z + 0.02);
  const aftRingBase = (stations.length - 1) * ringSize;
  for (let p = 0; p < ringSize; p++) {
    const nextP = (p + 1) % ringSize;
    indices.push(aftRingBase + p, aftCenterIdx, aftRingBase + nextP);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

function createPlasmaConeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uColorCore: { value: new THREE.Color(0xffffff) },
      uColorEdge: { value: new THREE.Color(0x5eead4) },
      uIntensity: { value: 1.0 },
      uTime: { value: 0.0 },
    },
    vertexShader: `
      varying float vAxial;
      varying float vFresnel;
      void main() {
        vAxial = clamp(1.0 + position.y, 0.0, 1.0);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vec3 viewDir = normalize(-mvPos.xyz);
        vec3 n = normalize(normalMatrix * normal);
        vFresnel = pow(abs(dot(n, viewDir)), 1.35);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uColorCore;
      uniform vec3 uColorEdge;
      uniform float uIntensity;
      uniform float uTime;
      varying float vAxial;
      varying float vFresnel;
      void main() {
        float flicker = 0.88 + 0.12 * sin(uTime * 34.0 + vAxial * 16.0);
        float axialFade = pow(vAxial, 1.55);
        float alpha = axialFade * vFresnel * flicker * uIntensity;
        vec3 col = mix(uColorEdge, uColorCore, smoothstep(0.35, 0.95, vAxial));
        gl_FragColor = vec4(col * alpha, clamp(alpha, 0.0, 1.0));
      }
    `,
  });
}

function createInfiniteHorizonGridMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uColorPrimary: { value: new THREE.Color(0x5eead4) },
      uColorSecondary: { value: new THREE.Color(0x818cf8) },
      uScrollZ: { value: 0.0 },
      uOpacity: { value: 0.42 },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 uColorPrimary;
      uniform vec3 uColorSecondary;
      uniform float uScrollZ;
      uniform float uOpacity;
      varying vec3 vWorldPos;

      float gridLine(vec2 coord, float widthScale) {
        vec2 deriv = fwidth(coord);
        vec2 grid = abs(fract(coord - 0.5) - 0.5) / max(deriv * widthScale, vec2(0.0001));
        float line = min(grid.x, grid.y);
        return 1.0 - min(line, 1.0);
      }

      void main() {
        vec2 uv = vec2(vWorldPos.x * 0.42, (vWorldPos.z + uScrollZ) * 0.42);
        float minor = gridLine(uv * 2.0, 1.15) * 0.38;
        float major = gridLine(uv * 0.5, 1.45);
        float dist = length(vWorldPos.xz - vec2(0.0, 4.0));
        float fogFade = exp(-dist * 0.036);
        float edgeFade = smoothstep(78.0, 18.0, abs(vWorldPos.x)) * smoothstep(-95.0, -14.0, vWorldPos.z);
        float intensity = max(minor, major) * fogFade * edgeFade * uOpacity;
        vec3 col = mix(uColorPrimary, uColorSecondary, clamp(dist * 0.018, 0.0, 1.0));
        gl_FragColor = vec4(col * intensity, clamp(intensity, 0.0, 1.0));
      }
    `,
  });
}

function createNebulaCloudTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const gctx = c.getContext('2d');
  if (!gctx) return null;
  const grad = gctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.72)');
  grad.addColorStop(0.38, 'rgba(255, 255, 255, 0.28)');
  grad.addColorStop(0.75, 'rgba(255, 255, 255, 0.06)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  gctx.fillStyle = grad;
  gctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function createPinpointStarMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: {
      uTime: { value: 0.0 },
      uPixelRatio: { value: 1.0 },
      uReduceMotion: { value: 0.0 },
      uBrightness: { value: 1.0 },
    },
    vertexShader: `
      attribute float aSize;
      attribute float aPhase;
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uReduceMotion;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = color;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        float dist = max(1.0, -mvPos.z);
        gl_PointSize = clamp(aSize * uPixelRatio * (18.0 / dist), 1.1, 7.5);
        float depthFade = smoothstep(-64.0, -30.0, mvPos.z) * smoothstep(2.5, -2.0, mvPos.z);
        float twinkle = uReduceMotion > 0.5
          ? 0.92
          : (0.68 + 0.32 * sin(uTime * (0.95 + mod(aPhase, 1.85)) + aPhase));
        vAlpha = depthFade * twinkle;
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform float uBrightness;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - vec2(0.5);
        float d = length(c) * 2.0;
        if (d > 1.0) discard;
        float core = exp(-d * d * 15.0);
        float halo = exp(-d * d * 4.2) * 0.34;
        float edge = smoothstep(1.0, 0.72, d);
        float alpha = clamp((core + halo) * edge * vAlpha * uBrightness, 0.0, 1.0);
        gl_FragColor = vec4(vColor * (1.0 + core * 0.35), alpha);
      }
    `,
  });
}

function createSplashDropletMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: {
      uPixelRatio: { value: 1.0 },
      uBrightness: { value: 1.0 },
    },
    vertexShader: `
      attribute float aSize;
      uniform float uPixelRatio;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        float dist = max(0.8, -mvPos.z);
        gl_PointSize = clamp(aSize * uPixelRatio * (26.0 / dist), 1.5, 18.0);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform float uBrightness;
      varying vec3 vColor;
      void main() {
        vec2 c = gl_PointCoord - vec2(0.5);
        float d = length(c) * 2.0;
        if (d > 1.0) discard;
        float core = exp(-d * d * 9.0);
        float ring = exp(-pow((d - 0.45) * 4.0, 2.0)) * 0.35;
        float edge = smoothstep(1.0, 0.65, d);
        float alpha = clamp((core + ring) * edge * uBrightness, 0.0, 1.0);
        gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.65), alpha);
      }
    `,
  });
}

// ---------------------------------------------------------------------------
// Three.js Scene Bundle Interface (disposed cleanly on teardown)
// ---------------------------------------------------------------------------

interface ShipMeshBinding {
  readonly mesh: THREE.Mesh;
  readonly normalMat: THREE.Material;
  readonly wireMat: THREE.Material;
}

interface ThreeSceneState {
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  ownsOffscreenCanvas: boolean;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  fog: THREE.FogExp2;
  keyLight: THREE.DirectionalLight;
  rimLight: THREE.DirectionalLight;
  rimPointLight: THREE.PointLight;
  hemiLight: THREE.HemisphereLight;
  shipGroup: THREE.Group;
  shipGhostGroup: THREE.Group;
  shipGhostWireMat: THREE.LineBasicMaterial;
  shipWireOverlays: THREE.LineSegments[];
  shipMeshBindings: ShipMeshBinding[];
  hiddenLineFillMat: THREE.MeshBasicMaterial;
  hiddenLineCanopyMat: THREE.MeshBasicMaterial;
  titaniumMat: THREE.MeshStandardMaterial;
  panelAccentMat: THREE.MeshStandardMaterial;
  canopyGlassMat: THREE.MeshPhysicalMaterial;
  cockpitGlowMat: THREE.MeshBasicMaterial;
  trimEmissiveMat: THREE.MeshBasicMaterial;
  portBeaconMat: THREE.MeshBasicMaterial;
  stbdBeaconMat: THREE.MeshBasicMaterial;
  shipWireMat: THREE.LineBasicMaterial;
  innerPlumeL: THREE.Mesh;
  innerPlumeR: THREE.Mesh;
  outerPlumeL: THREE.Mesh;
  outerPlumeR: THREE.Mesh;
  innerPlumeMat: THREE.ShaderMaterial;
  outerPlumeMat: THREE.ShaderMaterial;
  portTrailHistory: Float32Array;
  stbdTrailHistory: Float32Array;
  portTrailPositions: Float32Array;
  stbdTrailPositions: Float32Array;
  portTrailColors: Float32Array;
  stbdTrailColors: Float32Array;
  portTrailGeom: THREE.BufferGeometry;
  stbdTrailGeom: THREE.BufferGeometry;
  trailInitialized: boolean;
  shockwaveMeshes: THREE.Mesh[];
  shockwaveMats: THREE.MeshBasicMaterial[];
  shockwaveState: Float32Array; // [active, progress, x, y, z, colorMode] per slot
  splashPositions: Float32Array;
  splashColors: Float32Array;
  splashSizes: Float32Array;
  splashGeom: THREE.BufferGeometry;
  splashMat: THREE.ShaderMaterial;
  sparkPositions: Float32Array;
  sparkVelocities: Float32Array;
  sparkColors: Float32Array;
  sparkLife: Float32Array; // remaining life 0..1
  sparkGeom: THREE.BufferGeometry;
  sparkMat: THREE.PointsMaterial;
  laserMeshes: THREE.Mesh[];
  laserMats: THREE.MeshBasicMaterial[];
  laserState: Float32Array; // [active, x, y, z, targetIdx] per slot
  shardMeshes: THREE.Mesh[];
  shardMats: THREE.MeshBasicMaterial[];
  shardState: Float32Array; // [active, x, y, z, vx, vy, vz, life] per slot
  lightningPositions: Float32Array;
  lightningGeom: THREE.BufferGeometry;
  lightningMat: THREE.LineBasicMaterial;
  lightningLine: THREE.LineSegments;
  asteroidGeoms: THREE.BufferGeometry[];
  asteroidEdgeGeoms: THREE.EdgesGeometry[];
  asteroidMeshes: THREE.Mesh[];
  asteroidWireMeshes: THREE.LineSegments[];
  asteroidBasaltMat: THREE.MeshStandardMaterial;
  asteroidWireMat: THREE.LineBasicMaterial;
  starPositions: Float32Array;
  starColors: Float32Array;
  starSizes: Float32Array;
  starPhases: Float32Array;
  starGeom: THREE.BufferGeometry;
  starMat: THREE.ShaderMaterial;
  warpStreakPositions: Float32Array;
  warpStreakColors: Float32Array;
  warpStreakGeom: THREE.BufferGeometry;
  warpStreakMat: THREE.LineBasicMaterial;
  warpStreakLines: THREE.LineSegments;
  debrisOffsets: Float32Array;
  debrisPositions: Float32Array;
  debrisGeom: THREE.BufferGeometry;
  debrisMat: THREE.PointsMaterial;
  nebulaMeshes: THREE.Mesh[];
  nebulaMats: THREE.MeshBasicMaterial[];
  nebulaTex: THREE.CanvasTexture | null;
  retroGridMesh: THREE.Mesh;
  retroGridMat: THREE.ShaderMaterial;
  disposables: Array<{ dispose: () => void }>;
}

export class Ship3DScene {
  private readonly stars = new Float32Array(STAR_COUNT * STAR_STRIDE);
  private readonly asteroids = new Float32Array(ASTEROID_COUNT * ASTEROID_STRIDE);
  private readonly astOrder = new Int32Array(ASTEROID_COUNT);
  private readonly astProjX = new Float32Array(6);
  private readonly astProjY = new Float32Array(6);
  private readonly astProjZ = new Float32Array(6);

  private readonly projX = new Float32Array(VERT_COUNT);
  private readonly projY = new Float32Array(VERT_COUNT);
  private readonly projZ = new Float32Array(VERT_COUNT);
  private readonly faceOrder = new Int32Array(FACE_COUNT);
  private readonly faceDepth = new Float32Array(FACE_COUNT);

  // Pre-allocated projected word tags for Canvas2D typography & software fallback
  private readonly gateProjections: Array<{
    text: string;
    screenX: number;
    screenY: number;
    scale: number;
    alpha: number;
    isActive: boolean;
    semanticMask: number;
    mergeFlash: number;
    worldX: number;
    worldY: number;
    worldZ: number;
    lineIndex: number;
    wordIndex: number;
  }> = Array.from({ length: GATE_POOL }, () => ({
    text: '',
    screenX: 0,
    screenY: 0,
    scale: 1,
    alpha: 0,
    isActive: false,
    semanticMask: 0,
    mergeFlash: 0,
    worldX: 0,
    worldY: 0,
    worldZ: 0,
    lineIndex: -1,
    wordIndex: -1,
  }));
  private gateProjectionCount = 0;

  // Pre-allocated per-word mergeFlash ring buffer (zero allocations)
  private readonly wordFlashKeys = new Int32Array(WORD_FLASH_POOL).fill(-1);
  private readonly wordFlashValues = new Float32Array(WORD_FLASH_POOL);
  private wordFlashCursor = 0;

  // Pre-allocated liquid-starlight splash droplet burst pool (SPLASH_DROPLET_POOL = 96)
  // Stride 11: [active, wx, wy, wz, vx, vy, vz, life, r, g, b]
  private readonly splashDroplets = new Float32Array(SPLASH_DROPLET_POOL * 11);
  private splashCursor = 0;

  // Pre-allocated stagger queue for dense fast-tempo multi-word bursts (zero allocations)
  private readonly staggerWordIndices = new Int32Array(STAGGER_QUEUE_SIZE).fill(-1);
  private readonly staggerDelays = new Float32Array(STAGGER_QUEUE_SIZE);
  private staggerCount = 0;

  // Software fallback spark / laser pools (zero allocations)
  private readonly swSparks = new Float32Array(SPARK_POOL * 6); // x, y, z, vx, vy, life
  private readonly swLasers = new Float32Array(LASER_POOL * 4); // active, x, y, z
  private sparkCursor = 0;
  private laserCursor = 0;
  private shardCursor = 0;

  // Pre-allocated scratch buffers (zero per-frame heap allocations)
  private readonly tmpRgbA = new Float32Array(3);
  private readonly tmpRgbB = new Float32Array(3);
  private readonly tmpRgbC = new Float32Array(3);
  private readonly tmpColorA = new THREE.Color();
  private readonly tmpColorB = new THREE.Color();
  private readonly tmpColorC = new THREE.Color();
  private readonly tmpVecA = new THREE.Vector3();
  private readonly tmpVecB = new THREE.Vector3();
  private readonly tmpVecC = new THREE.Vector3();
  private readonly flightPosScratch: Ship3DFlightVec = { x: 0, y: SHIP_BASE_Y, z: SHIP_WORLD_Z };
  private readonly flightVelScratch: Ship3DFlightVec = { x: 0, y: 0, z: 0 };
  private readonly flightAccScratch: Ship3DFlightVec = { x: 0, y: 0, z: 0 };
  private readonly tmpFlightPos: Ship3DFlightVec = { x: 0, y: 0, z: 0 };
  private readonly tmpFlightVel: Ship3DFlightVec = { x: 0, y: 0, z: 0 };
  private readonly tmpFlightAcc: Ship3DFlightVec = { x: 0, y: 0, z: 0 };
  private readonly hudTelemetryCache: {
    score: number;
    combo: number;
    nearMissCount: number;
    wordPop: number;
    collectFlash: number;
    chromaticPulse: number;
    icePulse: number;
    glitchPulse: number;
    bulletTimeActive: boolean;
    rainbowActive: boolean;
    toastText: string;
    toastAlpha: number;
    toastColorKind: 'accent' | 'gold' | 'danger' | 'ice';
    activeWordKey: number;
    isInstrumentalGauntlet: boolean;
  } = {
    score: 0,
    combo: 0,
    nearMissCount: 0,
    wordPop: 0,
    collectFlash: 0,
    chromaticPulse: 0,
    icePulse: 0,
    glitchPulse: 0,
    bulletTimeActive: false,
    rainbowActive: false,
    toastText: '',
    toastAlpha: 0,
    toastColorKind: 'accent',
    activeWordKey: -1,
    isInstrumentalGauntlet: false,
  };

  // Precomputed lyric timeline cache
  private cachedLyricsRef: Lyrics | null = null;
  private precomputedWords: PrecomputedWordGate[] = [];
  private currentLyricTime = 0;
  private currentActiveLine = -1;
  private currentActiveWord = -1;
  private isInstrumental = false;
  private lastCollectedWordKey = -1;
  private prevLyricTime = -1;
  private contentInsetLeft = 0;
  private lastNearMissAsteroid = -1;
  private nearMissCooldown = 0;

  // Gameplay telemetry & semantic effect timers
  private score = 0;
  private combo = 0;
  private nearMissCount = 0;
  private wordPop = 0;
  private collectFlash = 0;
  private collectLunge = 0;
  private cameraTrauma = 0;
  private chromaticPulse = 0;
  private rainbowTimer = 0;
  private iceTimer = 0;
  private electricTimer = 0;
  private bulletTimeTimer = 0;
  private verticalBiasTimer = 0;
  private verticalBiasDir = 0;
  private glitchPulse = 0;
  private toastText = '';
  private toastAlpha = 0;
  private toastColorKind: 'accent' | 'gold' | 'danger' | 'ice' = 'accent';

  private prngSeed = 0x5f3759df;
  private currentBpmFactor = 1.0;
  private currentReduceMotion = false;
  private currentSceneTime = 0;
  private lastAstWorldSpeed = 3.6;
  private shipX = 0;
  private shipY = SHIP_BASE_Y;
  private shipVx = 0;
  private shipVy = 0;
  private rollAngle = 0;
  private pitchAngle = 0;
  private yawAngle = 0;
  private barrelRollPhase = 0;
  private barrelRollActive = false;
  private maneuverKind: 0 | 1 | 2 | 3 = 0; // 0=none, 1=barrelRoll, 2=corkscrew, 3=sBank
  private maneuverProgress = 0;
  private maneuverDuration = 0.62;
  private maneuverDir = 1;
  private maneuverCooldown = 0;
  private cameraSpringPos = 0;
  private cameraSpringVel = 0;
  private thrustPulse = 0;
  private warpSurge = 0;
  private shockwaveProgress = 0;
  private surgeCooldown = 0;
  private gridScrollZ = 0;

  // Software fallback cached scalars
  private frameWidth = 800;
  private frameHeight = 600;
  private frameCx = 400;
  private frameCy = 348;
  private frameFocal = 390;
  private frameVarIdx: 0 | 1 | 2 = 0;
  private frameIsOverlay = false;
  private shipCenterX = 400;
  private shipCenterY = 444;
  private shipScale = 84;
  private cosR = 1;
  private sinR = 0;
  private cosP = 1;
  private sinP = 0;
  private cosY = 1;
  private sinY = 0;
  private plumeLength = 0.75;

  private threeState: ThreeSceneState | null = null;
  private threeActive = false;
  private threeInitAttempted = false;
  private targetCanvas: HTMLCanvasElement | null = null;
  private width = 800;
  private height = 600;
  private dpr = 1;
  private shockwaveCursor = 0;
  private readonly boundContextLost: (e: Event) => void;

  constructor(shipCanvas?: HTMLCanvasElement | null) {
    this.boundContextLost = (e: Event) => {
      if (typeof (e as { preventDefault?: () => void }).preventDefault === 'function') {
        e.preventDefault();
      }
      this.threeActive = false;
    };
    this.initScene();
    if (shipCanvas) {
      this.attachCanvas(shipCanvas);
    }
  }

  get isWebGl3DActive(): boolean {
    return this.threeActive;
  }

  getHudTelemetry(): Ship3DHudTelemetry {
    const t = this.hudTelemetryCache;
    t.score = this.score;
    t.combo = this.combo;
    t.nearMissCount = this.nearMissCount;
    t.wordPop = this.wordPop;
    t.collectFlash = this.collectFlash;
    t.chromaticPulse = this.chromaticPulse;
    t.icePulse = this.iceTimer > 0 ? Math.min(1, this.iceTimer) : 0;
    t.glitchPulse = this.glitchPulse;
    t.bulletTimeActive = this.bulletTimeTimer > 0;
    t.rainbowActive = this.rainbowTimer > 0;
    t.toastText = this.toastText;
    t.toastAlpha = this.toastAlpha;
    t.toastColorKind = this.toastColorKind;
    t.activeWordKey = this.lastCollectedWordKey;
    t.isInstrumentalGauntlet = this.isInstrumental;
    return t;
  }

  private computeSemanticVertical(t: number, derivOrder: 0 | 1 | 2): number {
    if (this.precomputedWords.length === 0) return 0;
    let sum = 0;
    const k = 4.5;
    for (let i = 0; i < this.precomputedWords.length; i++) {
      const w = this.precomputedWords[i];
      const mask = w.semanticMask;
      if ((mask & (SEM_UP | SEM_DOWN)) === 0) continue;
      const dt = t - w.startSeconds;
      if (dt > 1.2 || dt < -1.2) continue;
      const amp = (mask & SEM_UP) !== 0 ? 0.48 : -0.42;
      const g = amp * Math.exp(-k * dt * dt);
      if (derivOrder === 0) {
        sum += g;
      } else if (derivOrder === 1) {
        sum += -2 * k * dt * g;
      } else {
        sum += (4 * k * k * dt * dt - 2 * k) * g;
      }
    }
    return sum;
  }

  /**
   * Zero-alloc C-infinity multi-harmonic flight spline position in world units.
   */
  getFlightPosition(t: number, out?: Ship3DFlightVec): Ship3DFlightVec {
    const target = out ?? this.flightPosScratch;
    const time = Number.isFinite(t) ? t : 0;
    const w = 0.78 * this.currentBpmFactor;
    const amp = this.currentReduceMotion ? 0.25 : 1.0;
    const semY = this.computeSemanticVertical(time, 0);
    let rawX = amp * (3.65 * Math.sin(w * time) + 1.15 * Math.sin(w * 0.47 * time + 0.85));
    // Clamp negative X excursion in Split View so the left wingtip & contrail stay right of contentInsetLeft
    if (this.contentInsetLeft > 2 && this.width > 1) {
      const splitRatio = Math.min(0.62, this.contentInsetLeft / this.width);
      const minSplitX = -4.2 + splitRatio * 4.1;
      if (rawX < minSplitX) {
        rawX = minSplitX + (rawX - minSplitX) * 0.18;
      }
    }
    target.x = rawX;
    target.y =
      SHIP_BASE_Y +
      amp * (0.48 * Math.sin(w * 0.65 * time + 0.35) + 0.18 * Math.cos(w * 1.11 * time) + semY);
    target.z = SHIP_WORLD_Z;
    return target;
  }

  /**
   * Zero-alloc analytical flight spline velocity (vx, vy) in world units/sec.
   */
  getFlightVelocity(t: number, out?: Ship3DFlightVec): Ship3DFlightVec {
    const target = out ?? this.flightVelScratch;
    const time = Number.isFinite(t) ? t : 0;
    const w = 0.78 * this.currentBpmFactor;
    const amp = this.currentReduceMotion ? 0.25 : 1.0;
    const w2 = w * 0.47;
    const wy1 = w * 0.65;
    const wy2 = w * 1.11;
    const semVy = this.computeSemanticVertical(time, 1);
    target.x = amp * (3.65 * w * Math.cos(w * time) + 1.15 * w2 * Math.cos(w2 * time + 0.85));
    target.y =
      amp * (0.48 * wy1 * Math.cos(wy1 * time + 0.35) - 0.18 * wy2 * Math.sin(wy2 * time) + semVy);
    target.z = 0;
    return target;
  }

  /**
   * Zero-alloc analytical flight spline acceleration (ax, ay) in world units/sec^2.
   */
  getFlightAcceleration(t: number, out?: Ship3DFlightVec): Ship3DFlightVec {
    const target = out ?? this.flightAccScratch;
    const time = Number.isFinite(t) ? t : 0;
    const w = 0.78 * this.currentBpmFactor;
    const amp = this.currentReduceMotion ? 0.25 : 1.0;
    const w2 = w * 0.47;
    const wy1 = w * 0.65;
    const wy2 = w * 1.11;
    const semAy = this.computeSemanticVertical(time, 2);
    target.x =
      amp * (-3.65 * w * w * Math.sin(w * time) - 1.15 * w2 * w2 * Math.sin(w2 * time + 0.85));
    target.y =
      amp *
      (-0.48 * wy1 * wy1 * Math.sin(wy1 * time + 0.35) -
        0.18 * wy2 * wy2 * Math.cos(wy2 * time) +
        semAy);
    target.z = 0;
    return target;
  }

  getProjectedWordGateCount(): number {
    return this.gateProjectionCount;
  }

  getProjectedWordGate(index: number): Ship3DWordGateProjection {
    return this.gateProjections[index];
  }

  /**
   * Returns the minimum surface-to-surface clearance (worldDist - (rA + rB)) across all active asteroids.
   * Used by unit tests to verify zero asteroid-to-asteroid clipping.
   */
  getMinAsteroidClearance(): number {
    let minClearance = 999;
    for (let i = 0; i < ASTEROID_COUNT; i++) {
      const idxA = i * ASTEROID_STRIDE;
      if (this.asteroids[idxA + 11] < 0.5) continue;
      const rA = this.asteroids[idxA + 6] * 3.2;
      const wxA = this.asteroids[idxA] * 5.2;
      const wyA = -0.25 + this.asteroids[idxA + 1] * 3.4;
      const wzA = 5.0 - this.asteroids[idxA + 2] * 6.2;

      for (let j = i + 1; j < ASTEROID_COUNT; j++) {
        const idxB = j * ASTEROID_STRIDE;
        if (this.asteroids[idxB + 11] < 0.5) continue;
        const rB = this.asteroids[idxB + 6] * 3.2;
        const wxB = this.asteroids[idxB] * 5.2;
        const wyB = -0.25 + this.asteroids[idxB + 1] * 3.4;
        const wzB = 5.0 - this.asteroids[idxB + 2] * 6.2;
        const dist = Math.hypot(wxB - wxA, wyB - wyA, wzB - wzA);
        const clearance = dist - (rA + rB);
        if (clearance < minClearance) minClearance = clearance;
      }
    }
    return minClearance;
  }

  /**
   * Returns the minimum XY clearance (distXY - exclR) between any active asteroid
   * and the ship's flight spline at [tAtZ - 0.35, tAtZ, tAtZ + 0.35] (and current time if near ship).
   */
  getMinSplineAsteroidClearance(): number {
    let minClearance = 999;
    const astWorldSpeed = Math.max(2.0, this.lastAstWorldSpeed);
    for (let i = 0; i < ASTEROID_COUNT; i++) {
      const idx = i * ASTEROID_STRIDE;
      if (this.asteroids[idx + 11] < 0.5) continue;
      const astWX = this.asteroids[idx] * 5.2;
      const astWY = -0.25 + this.asteroids[idx + 1] * 3.4;
      const astWZ = 5.0 - this.asteroids[idx + 2] * 6.2;
      const astRad = this.asteroids[idx + 6] * 3.2;
      const exclR = SHIP_WIDTH * 1.8 + astRad;
      const tAtZ = this.currentSceneTime + (SHIP_WORLD_Z - astWZ) / astWorldSpeed;

      for (let s = 0; s < 4; s++) {
        if (s === 3 && Math.abs(astWZ - SHIP_WORLD_Z) >= 4.5) continue;
        const ts = s === 0 ? tAtZ - 0.35 : s === 1 ? tAtZ : s === 2 ? tAtZ + 0.35 : this.currentSceneTime;
        const fp = this.getFlightPosition(ts, this.tmpFlightPos);
        const clearance = Math.hypot(astWX - fp.x, astWY - fp.y) - exclR;
        if (clearance < minClearance) minClearance = clearance;
      }
    }
    return minClearance;
  }

  /**
   * Returns the minimum XY clearance (distXY - exclR) between any active asteroid
   * and any active/upcoming lyric word anchor within |astWZ - wordWZ| < 5.0.
   */
  getMinLyricAsteroidClearance(): number {
    let minClearance = 999;
    for (let i = 0; i < ASTEROID_COUNT; i++) {
      const idx = i * ASTEROID_STRIDE;
      if (this.asteroids[idx + 11] < 0.5) continue;
      const astWX = this.asteroids[idx] * 5.2;
      const astWY = -0.25 + this.asteroids[idx + 1] * 3.4;
      const astWZ = 5.0 - this.asteroids[idx + 2] * 6.2;
      const astRad = this.asteroids[idx + 6] * 3.2;
      const exclR = SHIP_WIDTH * 1.8 + astRad;

      for (let g = 0; g < this.gateProjectionCount; g++) {
        const gp = this.gateProjections[g];
        if (!gp.text) continue;
        if (Math.abs(astWZ - gp.worldZ) < 5.0) {
          const clearance = Math.hypot(astWX - gp.worldX, astWY - gp.worldY) - exclR;
          if (clearance < minClearance) minClearance = clearance;
        }
      }
    }
    return minClearance;
  }

  /**
   * Synchronize lyric timeline & precompute word-gate slalom waypoints + semantic flags
   * once per track/lyrics change (zero per-frame string scanning).
   */
  syncLyricsState(
    lyrics: Lyrics | null,
    timeSeconds: number,
    activeLineIndex: number,
    activeWordIndex: number,
    isInstrumentalGap: boolean,
    didSeekThisFrame: boolean
  ): void {
    this.currentLyricTime = Number.isFinite(timeSeconds) ? timeSeconds : 0;
    this.currentActiveLine = activeLineIndex;
    this.currentActiveWord = activeWordIndex;
    this.isInstrumental = Boolean(isInstrumentalGap);

    if (lyrics !== this.cachedLyricsRef) {
      this.cachedLyricsRef = lyrics;
      this.precomputedWords = [];
      this.lastCollectedWordKey = -1;
      this.prevLyricTime = -1;
      this.staggerWordIndices.fill(-1);
      this.staggerDelays.fill(0);
      this.staggerCount = 0;
      this.score = 0;
      this.combo = 0;
      this.nearMissCount = 0;
      this.gateProjectionCount = 0;
      this.wordFlashKeys.fill(-1);
      this.wordFlashValues.fill(0);

      if (lyrics && Array.isArray(lyrics.lines)) {
        for (let li = 0; li < lyrics.lines.length; li++) {
          const line = lyrics.lines[li];
          const words = line.words;
          if (!words || words.length === 0) continue;
          for (let wi = 0; wi < words.length; wi++) {
            const w = words[wi];
            const text = (w.text || '').trim();
            if (!text) continue;
            const magicKind = detectMagicWordEffect(text);
            const semanticMask = classifyWordSemantics(text, magicKind);

            this.precomputedWords.push({
              key: li * 10000 + wi,
              lineIndex: li,
              wordIndex: wi,
              startSeconds: w.startSeconds,
              endSeconds: w.endSeconds,
              text,
              magicKind,
              semanticMask,
            });
          }
        }
      }
    }

    if (didSeekThisFrame) {
      this.lastCollectedWordKey = -1;
      this.prevLyricTime = -1;
      this.staggerWordIndices.fill(-1);
      this.staggerDelays.fill(0);
      this.staggerCount = 0;
      this.wordPop = 0;
      this.collectFlash = 0;
      this.collectLunge = 0;
      this.cameraSpringPos = 0;
      this.cameraSpringVel = 0;
      this.maneuverKind = 0;
      this.maneuverProgress = 0;
      this.barrelRollActive = false;
      this.barrelRollPhase = 0;
      this.bulletTimeTimer = 0;
      this.rainbowTimer = 0;
      this.iceTimer = 0;
      this.electricTimer = 0;
      this.glitchPulse = 0;
      this.toastAlpha = 0;
      this.wordFlashKeys.fill(-1);
      this.wordFlashValues.fill(0);
      this.splashDroplets.fill(0);
      if (this.threeState) {
        this.threeState.sparkLife.fill(0);
        this.threeState.laserState.fill(0);
        this.threeState.shardState.fill(0);
      }
      this.swSparks.fill(0);
      this.swLasers.fill(0);
    }
  }

  attachCanvas(shipCanvas?: HTMLCanvasElement | null): void {
    if (shipCanvas === this.targetCanvas && this.threeInitAttempted) return;
    this.disposeThree();
    this.targetCanvas = shipCanvas ?? null;
    this.threeInitAttempted = false;
    this.tryInitThree();
  }

  private nextRand(): number {
    this.prngSeed = (Math.imul(this.prngSeed, 1664525) + 1013904223) >>> 0;
    return this.prngSeed / 0xffffffff;
  }

  private initScene(): void {
    this.prngSeed = 0x5f3759df;
    for (let i = 0; i < STAR_COUNT; i++) {
      const idx = i * STAR_STRIDE;
      this.stars[idx] = (this.nextRand() - 0.5) * 3.2;
      this.stars[idx + 1] = (this.nextRand() - 0.5) * 2.2;
      this.stars[idx + 2] = 0.08 + this.nextRand() * 1.92;
      this.stars[idx + 3] = 0.65 + Math.pow(this.nextRand(), 2.4) * 2.15;
      this.stars[idx + 4] = this.nextRand() * Math.PI * 2;
      this.stars[idx + 5] = this.nextRand();
    }

    this.asteroids.fill(0);
    for (let a = 0; a < ASTEROID_COUNT; a++) {
      this.spawnAsteroid(a, 0.9 + (a / ASTEROID_COUNT) * 7.2);
      this.astOrder[a] = a;
    }
    this.separateAsteroids(0.016);
    for (let a = 0; a < ASTEROID_COUNT; a++) {
      this.enforceCorridorExclusion(a, this.currentSceneTime);
    }
    this.separateAsteroids(0.016);
    for (let a = 0; a < ASTEROID_COUNT; a++) {
      this.enforceCorridorExclusion(a, this.currentSceneTime);
    }

    for (let f = 0; f < FACE_COUNT; f++) {
      this.faceOrder[f] = f;
    }
  }

  /**
   * Enforces hard flight-corridor & lyric-anchor exclusion around slotIdx.
   * Checks arrival time tAtZ against getFlightPosition across [tAtZ-0.35, tAtZ, tAtZ+0.35]
   * AND every active/upcoming lyric word anchor within |astWZ - wordWZ| < 5.0.
   */
  private enforceCorridorExclusion(slotIdx: number, timeSeconds: number): void {
    const idx = slotIdx * ASTEROID_STRIDE;
    if (this.asteroids[idx + 11] < 0.5) return;

    let astWX = this.asteroids[idx] * 5.2;
    let astWY = -0.25 + this.asteroids[idx + 1] * 3.4;
    const astWZ = 5.0 - this.asteroids[idx + 2] * 6.2;
    const astRad = this.asteroids[idx + 6] * 3.2;
    const exclR = SHIP_WIDTH * 1.8 + astRad;
    const padExclR = exclR + 0.08;
    const maxSkyY = 2.1 - astRad * 1.1;

    const astWorldSpeed = Math.max(2.0, this.lastAstWorldSpeed);
    const tAtZ = timeSeconds + (SHIP_WORLD_Z - astWZ) / astWorldSpeed;

    let pushed = false;
    let pushVx = 0;
    let pushVy = 0;

    for (let pass = 0; pass < 2; pass++) {
      if (astWY > maxSkyY) {
        astWY = maxSkyY;
        pushVy = Math.min(pushVy, 0);
        pushed = true;
      }

      for (let s = 0; s < 4; s++) {
        if (s === 3 && Math.abs(astWZ - SHIP_WORLD_Z) >= 4.5) continue;
        const ts = s === 0 ? tAtZ - 0.35 : s === 1 ? tAtZ : s === 2 ? tAtZ + 0.35 : timeSeconds;
        const fp = this.getFlightPosition(ts, this.tmpFlightPos);
        const dx = astWX - fp.x;
        const dy = astWY - fp.y;
        const distXY = Math.hypot(dx, dy);
        if (distXY < padExclR) {
          let nx: number;
          let ny: number;
          if (distXY > 0.001) {
            nx = dx / distXY;
            ny = dy / distXY;
          } else {
            const ang = (slotIdx * 2.39996) % (Math.PI * 2);
            nx = Math.cos(ang);
            ny = Math.sin(ang);
          }
          astWX = fp.x + nx * padExclR;
          astWY = fp.y + ny * padExclR;
          if (astWY > maxSkyY) {
            // Keep upper lyric ribbon sky unobstructed by deflecting laterally outside exclR
            const side = astWX >= fp.x ? 1 : -1;
            astWY = maxSkyY;
            const dyC = astWY - fp.y;
            const reqDx = Math.sqrt(Math.max(0.01, padExclR * padExclR - dyC * dyC));
            astWX = fp.x + side * Math.max(Math.abs(astWX - fp.x), reqDx);
          }
          pushVx += nx * 1.6;
          pushVy += ny * 1.1;
          pushed = true;
        }
      }

      for (let g = 0; g < this.gateProjectionCount; g++) {
        const gp = this.gateProjections[g];
        if (!gp.text) continue;
        if (Math.abs(astWZ - gp.worldZ) < 5.0) {
          const dx = astWX - gp.worldX;
          const dy = astWY - gp.worldY;
          const distXY = Math.hypot(dx, dy);
          if (distXY < padExclR) {
            let nx: number;
            let ny: number;
            if (distXY > 0.001) {
              nx = dx / distXY;
              ny = dy / distXY;
            } else {
              const ang = ((slotIdx + g) * 2.39996) % (Math.PI * 2);
              nx = Math.cos(ang);
              ny = Math.sin(ang);
            }
            astWX = gp.worldX + nx * padExclR;
            astWY = gp.worldY + ny * padExclR;
            if (astWY > maxSkyY) {
              const side = astWX >= gp.worldX ? 1 : -1;
              astWY = maxSkyY;
              const dyC = astWY - gp.worldY;
              const reqDx = Math.sqrt(Math.max(0.01, padExclR * padExclR - dyC * dyC));
              astWX = gp.worldX + side * Math.max(Math.abs(astWX - gp.worldX), reqDx);
            }
            pushVx += nx * 1.6;
            pushVy += ny * 1.1;
            pushed = true;
          }
        }
      }
    }

    if (pushed) {
      this.asteroids[idx] = astWX / 5.2;
      this.asteroids[idx + 1] = (astWY + 0.25) / 3.4;
      this.asteroids[idx + 9] = this.asteroids[idx + 9] * 0.5 + pushVx;
      this.asteroids[idx + 10] = this.asteroids[idx + 10] * 0.5 + pushVy;
      if (astWY >= maxSkyY - 0.02 && this.asteroids[idx + 10] > 0) {
        this.asteroids[idx + 10] = 0;
      }
    }
  }

  /**
   * Rejection-sampled asteroid spawner enforcing strict minimum clearance
   * of `rA + rB + 3.2` world units against all active asteroids and upcoming flight corridors.
   */
  private spawnAsteroid(index: number, zOverride?: number): void {
    const idx = index * ASTEROID_STRIDE;
    const scale = 0.09 + this.nextRand() * 0.13;
    const myRadius = scale * 3.2;
    const exclR = SHIP_WIDTH * 1.8 + myRadius;

    let bestX = 0;
    let bestY = 0;
    let bestZ = zOverride ?? 6.2;
    let bestMinDist = -1;
    const astWorldSpeed = Math.max(2.0, this.lastAstWorldSpeed);

    for (let attempt = 0; attempt < 16; attempt++) {
      const candZ = zOverride !== undefined ? zOverride + attempt * 0.12 : 5.8 + this.nextRand() * 3.2;
      const wz = 5.0 - candZ * 6.2;
      let candX: number;
      let candY: number;

      if (attempt < 10 && index % 3 !== 2) {
        // Deliberate alternating flank / inside-bend placement along the S-curve spline
        const tAtZ = this.currentSceneTime + (SHIP_WORLD_Z - wz) / astWorldSpeed;
        const fp = this.getFlightPosition(tAtZ, this.tmpFlightPos);
        const side = (index + attempt) % 2 === 0 ? 1 : -1;
        const targetWx = fp.x + side * (exclR + 0.55 + this.nextRand() * 1.35);
        candX = Math.max(-1.85, Math.min(1.85, targetWx / 5.2));
        const targetWy = fp.y + (this.nextRand() - 0.5) * 0.85;
        candY = Math.max(-0.68, Math.min(0.52, (targetWy + 0.25) / 3.4));
      } else {
        const lane = ((index + attempt) % 7) - 3;
        candX = Math.max(-1.85, Math.min(1.85, lane * 0.48 + (this.nextRand() - 0.5) * 0.42));
        const maxCandY = Math.min(0.45, (2.1 - myRadius * 1.1 + 0.25) / 3.4);
        candY = -0.68 + this.nextRand() * Math.max(0.15, maxCandY + 0.68);
      }

      const wx = candX * 5.2;
      const wy = -0.25 + candY * 3.4;

      let minDist = 999;
      let valid = true;

      for (let other = 0; other < ASTEROID_COUNT; other++) {
        if (other === index) continue;
        const oIdx = other * ASTEROID_STRIDE;
        if (this.asteroids[oIdx + 11] < 0.5) continue;
        const oRadius = this.asteroids[oIdx + 6] * 3.2;
        const ox = this.asteroids[oIdx] * 5.2;
        const oy = -0.25 + this.asteroids[oIdx + 1] * 3.4;
        const oz = 5.0 - this.asteroids[oIdx + 2] * 6.2;
        const dist = Math.hypot(wx - ox, wy - oy, wz - oz);
        const req = myRadius + oRadius + 3.2;
        if (dist < req) {
          valid = false;
        }
        if (dist - req < minDist) minDist = dist - req;
      }

      // Keep clear flight corridor around upcoming lyric word anchors
      for (let g = 0; g < this.gateProjectionCount; g++) {
        const gp = this.gateProjections[g];
        if (!gp.text) continue;
        if (Math.abs(wz - gp.worldZ) < 5.0) {
          const dxy = Math.hypot(wx - gp.worldX, wy - gp.worldY);
          if (dxy < exclR) {
            valid = false;
            minDist = Math.min(minDist, dxy - exclR);
          }
        }
      }

      if (valid) {
        bestX = candX;
        bestY = candY;
        bestZ = candZ;
        bestMinDist = 1;
        break;
      }
      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        bestX = candX;
        bestY = candY;
        bestZ = candZ;
      }
    }

    this.asteroids[idx] = bestX;
    this.asteroids[idx + 1] = bestY;
    this.asteroids[idx + 2] = bestZ;
    this.asteroids[idx + 3] = this.nextRand() * Math.PI * 2;
    this.asteroids[idx + 4] = this.nextRand() * Math.PI * 2;
    this.asteroids[idx + 5] = (this.nextRand() - 0.5) * 2.4;
    this.asteroids[idx + 6] = scale;
    this.asteroids[idx + 7] = index % ASTEROID_VARIANTS;
    this.asteroids[idx + 8] = 0.78 + this.nextRand() * 0.44;
    this.asteroids[idx + 9] = 0; // vx drift
    this.asteroids[idx + 10] = 0; // vy drift
    this.asteroids[idx + 11] = 1; // alive

    this.enforceCorridorExclusion(index, this.currentSceneTime);
  }

  /**
   * O(N^2) pairwise separation pass (N <= 32): guarantees zero asteroid-to-asteroid clipping.
   */
  private separateAsteroids(dt: number): void {
    for (let i = 0; i < ASTEROID_COUNT; i++) {
      const idxA = i * ASTEROID_STRIDE;
      if (this.asteroids[idxA + 11] < 0.5) continue;
      const rA = this.asteroids[idxA + 6] * 3.2;

      for (let j = i + 1; j < ASTEROID_COUNT; j++) {
        const idxB = j * ASTEROID_STRIDE;
        if (this.asteroids[idxB + 11] < 0.5) continue;
        const rB = this.asteroids[idxB + 6] * 3.2;

        const wxA = this.asteroids[idxA] * 5.2;
        const wyA = -0.25 + this.asteroids[idxA + 1] * 3.4;
        const wzA = 5.0 - this.asteroids[idxA + 2] * 6.2;

        const wxB = this.asteroids[idxB] * 5.2;
        const wyB = -0.25 + this.asteroids[idxB + 1] * 3.4;
        const wzB = 5.0 - this.asteroids[idxB + 2] * 6.2;

        const dx = wxB - wxA;
        const dy = wyB - wyA;
        const dz = wzB - wzA;
        const distSq = dx * dx + dy * dy + dz * dz;
        const minDist = rA + rB + 1.15;

        if (distSq < minDist * minDist) {
          const dist = Math.sqrt(distSq) || 0.001;
          const overlap = (minDist - dist) * 0.65;
          const nx = dist > 0.01 ? dx / dist : (i % 2 === 0 ? 1 : -1);
          const ny = dist > 0.01 ? dy / dist : 0.2;
          const nz = dist > 0.01 ? dz / dist : 0;

          this.asteroids[idxA] -= (nx * overlap) / 5.2;
          this.asteroids[idxA + 1] -= (ny * overlap) / 3.4;
          this.asteroids[idxA + 2] += (nz * overlap) / 6.2;

          this.asteroids[idxB] += (nx * overlap) / 5.2;
          this.asteroids[idxB + 1] += (ny * overlap) / 3.4;
          this.asteroids[idxB + 2] -= (nz * overlap) / 6.2;

          this.asteroids[idxA + 9] -= nx * dt * 0.35;
          this.asteroids[idxB + 9] += nx * dt * 0.35;
        }
      }
    }
  }

  private tryInitThree(): void {
    if (this.threeInitAttempted) return;
    this.threeInitAttempted = true;

    if (typeof WebGLRenderingContext === 'undefined') {
      this.threeActive = false;
      return;
    }

    let canvas = this.targetCanvas;
    let ownsOffscreenCanvas = false;
    if (!canvas) {
      if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
        this.threeActive = false;
        return;
      }
      canvas = document.createElement('canvas');
      ownsOffscreenCanvas = true;
    }

    if (typeof canvas.addEventListener !== 'function') {
      this.threeActive = false;
      return;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
      });
    } catch {
      this.threeActive = false;
      return;
    }

    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(this.dpr);
    renderer.setSize(this.width, this.height, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    canvas.addEventListener('webglcontextlost', this.boundContextLost);

    const disposables: Array<{ dispose: () => void }> = [];
    const scene = new THREE.Scene();
    const fog = new THREE.FogExp2(0x040710, 0.017);
    scene.fog = fog;

    const camera = new THREE.PerspectiveCamera(52, this.width / Math.max(1, this.height), 0.1, 180);
    camera.position.set(0, 0.72, 5.95);
    camera.lookAt(0, -0.18, -4.5);

    // 3-Point Space Lighting
    const keyLight = new THREE.DirectionalLight(0xdbeafe, 2.35);
    keyLight.position.set(6, 9, 8);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x5eead4, 2.1);
    rimLight.position.set(-7, 2.5, -10);
    scene.add(rimLight);

    const rimPointLight = new THREE.PointLight(0x818cf8, 5.0, 26);
    rimPointLight.position.set(3.8, 1.4, -4.2);
    scene.add(rimPointLight);

    const hemiLight = new THREE.HemisphereLight(0x818cf8, 0x060913, 0.74);
    scene.add(hemiLight);

    // Sculpted Multi-Part Starfighter
    const shipGroup = new THREE.Group();
    const shipWireOverlays: THREE.LineSegments[] = [];
    const shipMeshBindings: ShipMeshBinding[] = [];

    const hiddenLineFillMat = new THREE.MeshBasicMaterial({
      color: 0x04050b,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const hiddenLineCanopyMat = new THREE.MeshBasicMaterial({
      color: 0x07121e,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const titaniumMat = new THREE.MeshStandardMaterial({
      color: 0x262e3e,
      metalness: 0.78,
      roughness: 0.28,
    });
    const darkGunmetalMat = new THREE.MeshStandardMaterial({
      color: 0x141923,
      metalness: 0.86,
      roughness: 0.34,
    });
    const panelAccentMat = new THREE.MeshStandardMaterial({
      color: 0x3b465e,
      metalness: 0.82,
      roughness: 0.24,
    });
    const canopyGlassMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a1c2e,
      metalness: 0.22,
      roughness: 0.08,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      transparent: true,
      opacity: 0.78,
      emissive: 0x164e63,
      emissiveIntensity: 0.35,
    });
    const cockpitGlowMat = new THREE.MeshBasicMaterial({ color: 0x5eead4 });
    const trimEmissiveMat = new THREE.MeshBasicMaterial({ color: 0x5eead4 });
    const portBeaconMat = new THREE.MeshBasicMaterial({ color: 0xff3b5c });
    const stbdBeaconMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
    const shipWireMat = new THREE.LineBasicMaterial({
      color: 0x5eead4,
      transparent: true,
      opacity: 0.28,
    });
    disposables.push(
      hiddenLineFillMat,
      hiddenLineCanopyMat,
      titaniumMat,
      darkGunmetalMat,
      panelAccentMat,
      canopyGlassMat,
      cockpitGlowMat,
      trimEmissiveMat,
      portBeaconMat,
      stbdBeaconMat,
      shipWireMat
    );

    const bindShipMesh = (
      mesh: THREE.Mesh,
      normalMat: THREE.Material,
      wireMat: THREE.Material = hiddenLineFillMat,
      edgeGeom?: THREE.EdgesGeometry
    ) => {
      shipMeshBindings.push({ mesh, normalMat, wireMat });
      if (edgeGeom) {
        const wire = new THREE.LineSegments(edgeGeom, shipWireMat);
        wire.position.copy(mesh.position);
        wire.rotation.copy(mesh.rotation);
        wire.scale.copy(mesh.scale);
        shipGroup.add(wire);
        shipWireOverlays.push(wire);
      }
    };

    // Fuselage & beveled nose probe
    const fuselageGeom = createSculptedFuselageGeometry();
    const fuselageEdgeGeom = new THREE.EdgesGeometry(fuselageGeom, 20);
    const fuselageMesh = new THREE.Mesh(fuselageGeom, titaniumMat);
    shipGroup.add(fuselageMesh);
    bindShipMesh(fuselageMesh, titaniumMat, hiddenLineFillMat, fuselageEdgeGeom);
    disposables.push(fuselageGeom, fuselageEdgeGeom);

    const noseProbeGeom = new THREE.ConeGeometry(0.032, 0.42, 6);
    noseProbeGeom.rotateX(-Math.PI / 2);
    const noseProbeEdgeGeom = new THREE.EdgesGeometry(noseProbeGeom, 20);
    const noseProbe = new THREE.Mesh(noseProbeGeom, panelAccentMat);
    noseProbe.position.set(0, -0.02, -2.84);
    shipGroup.add(noseProbe);
    bindShipMesh(noseProbe, panelAccentMat, hiddenLineFillMat, noseProbeEdgeGeom);
    disposables.push(noseProbeGeom, noseProbeEdgeGeom);

    // Dorsal panel-line spine rib
    const spineGeom = new THREE.BoxGeometry(0.14, 0.06, 1.32);
    const spineEdgeGeom = new THREE.EdgesGeometry(spineGeom, 20);
    const spineMesh = new THREE.Mesh(spineGeom, panelAccentMat);
    spineMesh.position.set(0, 0.26, 0.56);
    shipGroup.add(spineMesh);
    bindShipMesh(spineMesh, panelAccentMat, hiddenLineFillMat, spineEdgeGeom);
    disposables.push(spineGeom, spineEdgeGeom);

    // Dual Side Air Intakes (port & starboard)
    const intakeShape = new THREE.Shape();
    intakeShape.moveTo(0, -0.14);
    intakeShape.lineTo(0.28, -0.12);
    intakeShape.lineTo(0.24, 0.14);
    intakeShape.lineTo(0.02, 0.16);
    intakeShape.closePath();
    const intakeGeom = new THREE.ExtrudeGeometry(intakeShape, {
      depth: 0.92,
      bevelEnabled: true,
      bevelThickness: 0.018,
      bevelSize: 0.018,
      bevelSegments: 2,
    });
    intakeGeom.translate(0, 0, -0.46);
    const intakeEdgeGeom = new THREE.EdgesGeometry(intakeGeom, 20);
    const intakeInnerGeom = new THREE.BoxGeometry(0.16, 0.14, 0.08);

    for (const side of [-1, 1] as const) {
      const intake = new THREE.Mesh(intakeGeom, darkGunmetalMat);
      intake.position.set(side * 0.44, -0.01, -0.12);
      if (side < 0) intake.scale.x = -1;
      shipGroup.add(intake);
      bindShipMesh(intake, darkGunmetalMat, hiddenLineFillMat, intakeEdgeGeom);

      const intakeRecess = new THREE.Mesh(intakeInnerGeom, trimEmissiveMat);
      intakeRecess.position.set(side * 0.56, 0.0, -0.58);
      shipGroup.add(intakeRecess);
      bindShipMesh(intakeRecess, trimEmissiveMat, trimEmissiveMat);
    }
    disposables.push(intakeGeom, intakeEdgeGeom, intakeInnerGeom);

    // Inner glowing instrument console + cockpit tub + glossy tinted canopy
    const tubGeom = new THREE.BoxGeometry(0.32, 0.12, 0.82);
    const tubEdgeGeom = new THREE.EdgesGeometry(tubGeom, 20);
    const tubMesh = new THREE.Mesh(tubGeom, darkGunmetalMat);
    tubMesh.position.set(0, 0.22, -0.35);
    shipGroup.add(tubMesh);
    bindShipMesh(tubMesh, darkGunmetalMat, hiddenLineFillMat, tubEdgeGeom);

    const consoleGeom = new THREE.BoxGeometry(0.22, 0.06, 0.26);
    const consoleMesh = new THREE.Mesh(consoleGeom, cockpitGlowMat);
    consoleMesh.position.set(0, 0.28, -0.52);
    consoleMesh.rotation.x = 0.35;
    shipGroup.add(consoleMesh);
    bindShipMesh(consoleMesh, cockpitGlowMat, cockpitGlowMat);

    const canopyGeom = new THREE.SphereGeometry(0.3, 18, 12);
    canopyGeom.scale(0.76, 0.56, 2.2);
    const canopyEdgeGeom = new THREE.EdgesGeometry(canopyGeom, 16);
    const canopyMesh = new THREE.Mesh(canopyGeom, canopyGlassMat);
    canopyMesh.position.set(0, 0.27, -0.32);
    shipGroup.add(canopyMesh);
    bindShipMesh(canopyMesh, canopyGlassMat, hiddenLineCanopyMat, canopyEdgeGeom);

    const canopyBowGeom = new THREE.TorusGeometry(0.21, 0.016, 8, 16, Math.PI);
    const canopyBowEdgeGeom = new THREE.EdgesGeometry(canopyBowGeom, 20);
    const canopyBow = new THREE.Mesh(canopyBowGeom, darkGunmetalMat);
    canopyBow.position.set(0, 0.26, -0.08);
    shipGroup.add(canopyBow);
    bindShipMesh(canopyBow, darkGunmetalMat, hiddenLineFillMat, canopyBowEdgeGeom);
    disposables.push(tubGeom, tubEdgeGeom, consoleGeom, canopyGeom, canopyEdgeGeom, canopyBowGeom, canopyBowEdgeGeom);

    // Swept Delta Wings + Wingtip Pods + Blinking Beacons
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0.0, -0.45);
    wingShape.lineTo(1.68, 0.75);
    wingShape.lineTo(1.76, 1.2);
    wingShape.lineTo(0.0, 1.05);
    wingShape.closePath();
    const wingGeom = new THREE.ExtrudeGeometry(wingShape, {
      depth: 0.036,
      bevelEnabled: true,
      bevelThickness: 0.014,
      bevelSize: 0.022,
      bevelSegments: 2,
    });
    wingGeom.rotateX(Math.PI / 2);
    const wingEdgeGeom = new THREE.EdgesGeometry(wingGeom, 20);
    const podGeom = new THREE.CylinderGeometry(0.048, 0.058, 0.58, 10);
    podGeom.rotateX(Math.PI / 2);
    const podEdgeGeom = new THREE.EdgesGeometry(podGeom, 20);
    const beaconGeom = new THREE.SphereGeometry(0.052, 10, 8);
    const wingStripGeom = new THREE.BoxGeometry(1.1, 0.016, 0.032);

    for (const side of [-1, 1] as const) {
      const wingPivot = new THREE.Group();
      wingPivot.position.set(side * 0.44, 0.0, 0.05);
      wingPivot.rotation.z = -side * 0.06;

      const wing = new THREE.Mesh(wingGeom, titaniumMat);
      if (side < 0) wing.scale.x = -1;
      wingPivot.add(wing);
      shipMeshBindings.push({ mesh: wing, normalMat: titaniumMat, wireMat: hiddenLineFillMat });

      const wingWire = new THREE.LineSegments(wingEdgeGeom, shipWireMat);
      if (side < 0) wingWire.scale.x = -1;
      wingPivot.add(wingWire);
      shipWireOverlays.push(wingWire);

      const strip = new THREE.Mesh(wingStripGeom, trimEmissiveMat);
      strip.position.set(side * 0.84, 0.025, 0.5);
      strip.rotation.y = -side * 0.52;
      wingPivot.add(strip);
      shipMeshBindings.push({ mesh: strip, normalMat: trimEmissiveMat, wireMat: trimEmissiveMat });

      const pod = new THREE.Mesh(podGeom, darkGunmetalMat);
      pod.position.set(side * 1.74, -0.01, 0.96);
      wingPivot.add(pod);
      shipMeshBindings.push({ mesh: pod, normalMat: darkGunmetalMat, wireMat: hiddenLineFillMat });

      const podWire = new THREE.LineSegments(podEdgeGeom, shipWireMat);
      podWire.position.copy(pod.position);
      wingPivot.add(podWire);
      shipWireOverlays.push(podWire);

      const beacon = new THREE.Mesh(beaconGeom, side < 0 ? portBeaconMat : stbdBeaconMat);
      beacon.position.set(side * 1.75, -0.01, 1.26);
      wingPivot.add(beacon);

      shipGroup.add(wingPivot);
    }
    disposables.push(wingGeom, wingEdgeGeom, podGeom, podEdgeGeom, beaconGeom, wingStripGeom);

    // Twin Angled Vertical Stabilizers
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0);
    finShape.lineTo(0.68, 0.48);
    finShape.lineTo(0.88, 0.48);
    finShape.lineTo(0.55, 0);
    finShape.closePath();
    const finGeom = new THREE.ExtrudeGeometry(finShape, {
      depth: 0.026,
      bevelEnabled: true,
      bevelThickness: 0.01,
      bevelSize: 0.014,
      bevelSegments: 1,
    });
    finGeom.rotateY(Math.PI / 2);
    const finEdgeGeom = new THREE.EdgesGeometry(finGeom, 20);

    for (const side of [-1, 1] as const) {
      const fin = new THREE.Mesh(finGeom, panelAccentMat);
      fin.position.set(side * 0.44, 0.14, 0.54);
      fin.rotation.z = -side * 0.36;
      shipGroup.add(fin);
      bindShipMesh(fin, panelAccentMat, hiddenLineFillMat, finEdgeGeom);
    }
    disposables.push(finGeom, finEdgeGeom);

    // Twin Recessed Dark Engine Bells + Glow Rings + Volumetric Tapered Additive Plasma Cones
    const nozzleOuterGeom = new THREE.CylinderGeometry(0.18, 0.22, 0.36, 16, 1, true);
    nozzleOuterGeom.rotateX(Math.PI / 2);
    const nozzleOuterEdgeGeom = new THREE.EdgesGeometry(nozzleOuterGeom, 18);
    const nozzleBellGeom = new THREE.CylinderGeometry(0.15, 0.11, 0.22, 16, 1, true);
    nozzleBellGeom.rotateX(Math.PI / 2);
    const nozzleCoreRingGeom = new THREE.RingGeometry(0.05, 0.135, 16);

    const innerConeGeom = new THREE.ConeGeometry(0.135, 1.0, 20, 1, true);
    innerConeGeom.translate(0, -0.5, 0);
    innerConeGeom.rotateX(-Math.PI / 2);

    const outerConeGeom = new THREE.ConeGeometry(0.24, 1.0, 20, 1, true);
    outerConeGeom.translate(0, -0.5, 0);
    outerConeGeom.rotateX(-Math.PI / 2);

    const innerPlumeMat = createPlasmaConeMaterial();
    const outerPlumeMat = createPlasmaConeMaterial();
    outerPlumeMat.uniforms.uColorCore.value.setHex(0x5eead4);
    outerPlumeMat.uniforms.uColorEdge.value.setHex(0x818cf8);

    const makeThrusterAssembly = (xPos: number) => {
      const nozzle = new THREE.Mesh(nozzleOuterGeom, darkGunmetalMat);
      nozzle.position.set(xPos, -0.02, 1.32);
      shipGroup.add(nozzle);
      bindShipMesh(nozzle, darkGunmetalMat, hiddenLineFillMat, nozzleOuterEdgeGeom);

      const bell = new THREE.Mesh(nozzleBellGeom, darkGunmetalMat);
      bell.position.set(xPos, -0.02, 1.26);
      shipGroup.add(bell);
      bindShipMesh(bell, darkGunmetalMat, hiddenLineFillMat);

      const core = new THREE.Mesh(nozzleCoreRingGeom, trimEmissiveMat);
      core.position.set(xPos, -0.02, 1.22);
      shipGroup.add(core);
      bindShipMesh(core, trimEmissiveMat, trimEmissiveMat);

      const inner = new THREE.Mesh(innerConeGeom, innerPlumeMat);
      inner.position.set(xPos, -0.02, 1.34);
      shipGroup.add(inner);

      const outer = new THREE.Mesh(outerConeGeom, outerPlumeMat);
      outer.position.set(xPos, -0.02, 1.34);
      shipGroup.add(outer);

      return { inner, outer };
    };

    const leftThruster = makeThrusterAssembly(-0.34);
    const rightThruster = makeThrusterAssembly(0.34);
    disposables.push(
      nozzleOuterGeom,
      nozzleOuterEdgeGeom,
      nozzleBellGeom,
      nozzleCoreRingGeom,
      innerConeGeom,
      outerConeGeom,
      innerPlumeMat,
      outerPlumeMat
    );

    shipGroup.scale.setScalar(0.88);
    shipGroup.position.set(0, SHIP_BASE_Y, SHIP_WORLD_Z);
    scene.add(shipGroup);

    // Ghostly wireframe echo ship for 'glitch' / 'broken' / 'ghost' semantic words
    const shipGhostGroup = new THREE.Group();
    const shipGhostWireMat = new THREE.LineBasicMaterial({
      color: 0xf43f5e,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ghostFuse = new THREE.LineSegments(fuselageEdgeGeom, shipGhostWireMat);
    const ghostWingL = new THREE.LineSegments(wingEdgeGeom, shipGhostWireMat);
    ghostWingL.position.set(-0.44, 0, 0.05);
    ghostWingL.scale.x = -1;
    const ghostWingR = new THREE.LineSegments(wingEdgeGeom, shipGhostWireMat);
    ghostWingR.position.set(0.44, 0, 0.05);
    shipGhostGroup.add(ghostFuse, ghostWingL, ghostWingR);
    shipGhostGroup.scale.setScalar(0.88);
    shipGhostGroup.visible = false;
    scene.add(shipGhostGroup);
    disposables.push(shipGhostWireMat);

    // Pre-allocated Additive Wingtip Ribbon Contrails
    const trailVertCount = TRAIL_SEGMENTS * 2;
    const trailIndices: number[] = [];
    for (let s = 0; s < TRAIL_SEGMENTS - 1; s++) {
      const i0 = s * 2;
      trailIndices.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
    }
    const portTrailHistory = new Float32Array(TRAIL_SEGMENTS * 3);
    const stbdTrailHistory = new Float32Array(TRAIL_SEGMENTS * 3);
    const portTrailPositions = new Float32Array(trailVertCount * 3);
    const stbdTrailPositions = new Float32Array(trailVertCount * 3);
    const portTrailColors = new Float32Array(trailVertCount * 3);
    const stbdTrailColors = new Float32Array(trailVertCount * 3);

    const portTrailGeom = new THREE.BufferGeometry();
    portTrailGeom.setAttribute('position', new THREE.BufferAttribute(portTrailPositions, 3));
    portTrailGeom.setAttribute('color', new THREE.BufferAttribute(portTrailColors, 3));
    portTrailGeom.setIndex(trailIndices);

    const stbdTrailGeom = new THREE.BufferGeometry();
    stbdTrailGeom.setAttribute('position', new THREE.BufferAttribute(stbdTrailPositions, 3));
    stbdTrailGeom.setAttribute('color', new THREE.BufferAttribute(stbdTrailColors, 3));
    stbdTrailGeom.setIndex(trailIndices);

    const trailMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const portTrailMesh = new THREE.Mesh(portTrailGeom, trailMat);
    const stbdTrailMesh = new THREE.Mesh(stbdTrailGeom, trailMat);
    portTrailMesh.frustumCulled = false;
    stbdTrailMesh.frustumCulled = false;
    scene.add(portTrailMesh);
    scene.add(stbdTrailMesh);
    disposables.push(portTrailGeom, stbdTrailGeom, trailMat);

    // Pre-allocated Expanding Additive Shockwave Rings (razor-thin luminous ripple)
    const shockGeom = new THREE.RingGeometry(0.955, 1.0, 48);
    const shockwaveMeshes: THREE.Mesh[] = [];
    const shockwaveMats: THREE.MeshBasicMaterial[] = [];
    const shockwaveState = new Float32Array(SHOCKWAVE_POOL * 6);
    for (let i = 0; i < SHOCKWAVE_POOL; i++) {
      const smat = new THREE.MeshBasicMaterial({
        color: 0x5eead4,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      const smesh = new THREE.Mesh(shockGeom, smat);
      smesh.visible = false;
      smesh.renderOrder = 24;
      scene.add(smesh);
      shockwaveMeshes.push(smesh);
      shockwaveMats.push(smat);
      disposables.push(smat);
    }
    disposables.push(shockGeom);

    // Pooled Liquid-Starlight Splash Droplet Bursts (SPLASH_DROPLET_POOL = 96)
    const splashPositions = new Float32Array(SPLASH_DROPLET_POOL * 3);
    const splashColors = new Float32Array(SPLASH_DROPLET_POOL * 3);
    const splashSizes = new Float32Array(SPLASH_DROPLET_POOL);
    const splashGeom = new THREE.BufferGeometry();
    splashGeom.setAttribute('position', new THREE.BufferAttribute(splashPositions, 3));
    splashGeom.setAttribute('color', new THREE.BufferAttribute(splashColors, 3));
    splashGeom.setAttribute('aSize', new THREE.BufferAttribute(splashSizes, 1));
    const splashMat = createSplashDropletMaterial();
    const splashPoints = new THREE.Points(splashGeom, splashMat);
    splashPoints.frustumCulled = false;
    splashPoints.renderOrder = 25;
    scene.add(splashPoints);
    disposables.push(splashGeom, splashMat);

    // Nebula Run Volumetric Translucent Additive Clouds (and soft circular sprite texture)
    const nebulaTex = createNebulaCloudTexture();

    // Pooled Absorption / Frost / Starlight Sparks (Points)
    const sparkPositions = new Float32Array(SPARK_POOL * 3);
    const sparkVelocities = new Float32Array(SPARK_POOL * 3);
    const sparkColors = new Float32Array(SPARK_POOL * 3);
    const sparkLife = new Float32Array(SPARK_POOL);
    const sparkGeom = new THREE.BufferGeometry();
    sparkGeom.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
    sparkGeom.setAttribute('color', new THREE.BufferAttribute(sparkColors, 3));
    const sparkMat = new THREE.PointsMaterial({
      map: nebulaTex,
      size: 0.18,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sparkPoints = new THREE.Points(sparkGeom, sparkMat);
    sparkPoints.frustumCulled = false;
    scene.add(sparkPoints);
    disposables.push(sparkGeom, sparkMat);

    // Pooled Twin Plasma Laser Bolts
    const laserGeom = new THREE.CylinderGeometry(0.032, 0.045, 2.2, 8);
    laserGeom.rotateX(Math.PI / 2);
    const laserMeshes: THREE.Mesh[] = [];
    const laserMats: THREE.MeshBasicMaterial[] = [];
    const laserState = new Float32Array(LASER_POOL * 5); // active, x, y, z, targetAstIdx
    for (let l = 0; l < LASER_POOL; l++) {
      const lmat = new THREE.MeshBasicMaterial({
        color: 0xff5a36,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const lmesh = new THREE.Mesh(laserGeom, lmat);
      lmesh.visible = false;
      scene.add(lmesh);
      laserMeshes.push(lmesh);
      laserMats.push(lmat);
      disposables.push(lmat);
    }
    disposables.push(laserGeom);

    // Pooled Molten Asteroid Shatter Shards
    const shardGeom = new THREE.TetrahedronGeometry(0.18, 0);
    const shardMeshes: THREE.Mesh[] = [];
    const shardMats: THREE.MeshBasicMaterial[] = [];
    const shardState = new Float32Array(SHARD_POOL * 8); // active, x, y, z, vx, vy, vz, life
    for (let s = 0; s < SHARD_POOL; s++) {
      const smat = new THREE.MeshBasicMaterial({
        color: 0xff7b29,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
      });
      const smesh = new THREE.Mesh(shardGeom, smat);
      smesh.visible = false;
      scene.add(smesh);
      shardMeshes.push(smesh);
      shardMats.push(smat);
      disposables.push(smat);
    }
    disposables.push(shardGeom);

    // Pooled Procedural Jagged Lightning Arcs (LineSegments)
    const lightningPositions = new Float32Array(LIGHTNING_SEGMENTS * 2 * 3);
    const lightningGeom = new THREE.BufferGeometry();
    lightningGeom.setAttribute('position', new THREE.BufferAttribute(lightningPositions, 3));
    const lightningMat = new THREE.LineBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const lightningLine = new THREE.LineSegments(lightningGeom, lightningMat);
    lightningLine.visible = false;
    lightningLine.frustumCulled = false;
    scene.add(lightningLine);
    disposables.push(lightningGeom, lightningMat);

    // 7 Distinct Procedural FBM + Cratered Asteroid Geometries + Pooled Meshes
    const asteroidGeoms: THREE.BufferGeometry[] = [];
    const asteroidEdgeGeoms: THREE.EdgesGeometry[] = [];
    for (let v = 0; v < ASTEROID_VARIANTS; v++) {
      const g = createProceduralAsteroidGeometry(v);
      const eg = new THREE.EdgesGeometry(g, 20);
      asteroidGeoms.push(g);
      asteroidEdgeGeoms.push(eg);
      disposables.push(g, eg);
    }

    const asteroidBasaltMat = new THREE.MeshStandardMaterial({
      color: 0x3b4252,
      roughness: 0.92,
      metalness: 0.08,
      flatShading: true,
    });
    const asteroidWireMat = new THREE.LineBasicMaterial({
      color: 0x818cf8,
      transparent: true,
      opacity: 0.85,
    });
    disposables.push(asteroidBasaltMat, asteroidWireMat);

    const asteroidMeshes: THREE.Mesh[] = [];
    const asteroidWireMeshes: THREE.LineSegments[] = [];
    for (let a = 0; a < ASTEROID_COUNT; a++) {
      const variantIdx = (this.asteroids[a * ASTEROID_STRIDE + 7] | 0) % ASTEROID_VARIANTS;
      const mesh = new THREE.Mesh(asteroidGeoms[variantIdx], asteroidBasaltMat);
      const wire = new THREE.LineSegments(asteroidEdgeGeoms[variantIdx], asteroidWireMat);
      wire.visible = false;
      mesh.add(wire);
      scene.add(mesh);
      asteroidMeshes.push(mesh);
      asteroidWireMeshes.push(wire);
    }

    // Serene Multi-Scale Twinkling Pinpoint Starfield (2,400 THREE.Points with custom Airy ShaderMaterial)
    const starPositions = new Float32Array(STAR_COUNT * 3);
    const starColors = new Float32Array(STAR_COUNT * 3);
    const starSizes = new Float32Array(STAR_COUNT);
    const starPhases = new Float32Array(STAR_COUNT);
    for (let i = 0; i < STAR_COUNT; i++) {
      const idx = i * STAR_STRIDE;
      starSizes[i] = this.stars[idx + 3];
      starPhases[i] = this.stars[idx + 4];
      const ck = this.stars[idx + 5];
      if (ck < 0.55) {
        starColors[i * 3] = 0.973;
        starColors[i * 3 + 1] = 0.980;
        starColors[i * 3 + 2] = 0.988;
      } else if (ck < 0.80) {
        starColors[i * 3] = 0.812;
        starColors[i * 3 + 1] = 0.894;
        starColors[i * 3 + 2] = 1.0;
      } else {
        starColors[i * 3] = 1.0;
        starColors[i * 3 + 1] = 0.894;
        starColors[i * 3 + 2] = 0.710;
      }
    }
    const starGeom = new THREE.BufferGeometry();
    starGeom.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starGeom.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
    starGeom.setAttribute('aSize', new THREE.BufferAttribute(starSizes, 1));
    starGeom.setAttribute('aPhase', new THREE.BufferAttribute(starPhases, 1));
    const starMat = createPinpointStarMaterial();
    const starPoints = new THREE.Points(starGeom, starMat);
    starPoints.frustumCulled = false;
    scene.add(starPoints);
    disposables.push(starGeom, starMat);

    // Secondary Warp Surge Streak Pool (opacity = 0 at cruise, gently elongates distant stars when warpSurge > 0.15)
    const warpStreakPositions = new Float32Array(WARP_STREAK_COUNT * 2 * 3);
    const warpStreakColors = new Float32Array(WARP_STREAK_COUNT * 2 * 3);
    const warpStreakGeom = new THREE.BufferGeometry();
    warpStreakGeom.setAttribute('position', new THREE.BufferAttribute(warpStreakPositions, 3));
    warpStreakGeom.setAttribute('color', new THREE.BufferAttribute(warpStreakColors, 3));
    const warpStreakMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const warpStreakLines = new THREE.LineSegments(warpStreakGeom, warpStreakMat);
    warpStreakLines.visible = false;
    warpStreakLines.frustumCulled = false;
    scene.add(warpStreakLines);
    disposables.push(warpStreakGeom, warpStreakMat);

    // Drifting Micro-Debris Dust Particles (Points)
    const debrisOffsets = new Float32Array(DEBRIS_COUNT * 3);
    const debrisPositions = new Float32Array(DEBRIS_COUNT * 3);
    for (let d = 0; d < DEBRIS_COUNT; d++) {
      const o = d * 3;
      debrisOffsets[o] = (this.nextRand() - 0.5) * 20;
      debrisOffsets[o + 1] = (this.nextRand() - 0.5) * 11;
      debrisOffsets[o + 2] = -36 + this.nextRand() * 42;
      debrisPositions[o] = debrisOffsets[o];
      debrisPositions[o + 1] = debrisOffsets[o + 1];
      debrisPositions[o + 2] = debrisOffsets[o + 2];
    }
    const debrisGeom = new THREE.BufferGeometry();
    debrisGeom.setAttribute('position', new THREE.BufferAttribute(debrisPositions, 3));
    const debrisMat = new THREE.PointsMaterial({
      map: nebulaTex,
      color: 0xdbeafe,
      size: 0.075,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const debrisPoints = new THREE.Points(debrisGeom, debrisMat);
    debrisPoints.frustumCulled = false;
    scene.add(debrisPoints);
    disposables.push(debrisGeom, debrisMat);

    const nebulaGeom = new THREE.PlaneGeometry(18, 12);
    const nebulaMeshes: THREE.Mesh[] = [];
    const nebulaMats: THREE.MeshBasicMaterial[] = [];
    const nebulaAnchors = [
      [-6.5, 2.2, -26],
      [6.8, -1.8, -32],
      [-2.0, 4.0, -38],
      [3.2, 2.6, -22],
    ];
    for (let n = 0; n < nebulaAnchors.length; n++) {
      const nmat = new THREE.MeshBasicMaterial({
        map: nebulaTex,
        color: 0x5eead4,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const nmesh = new THREE.Mesh(nebulaGeom, nmat);
      nmesh.position.set(nebulaAnchors[n][0], nebulaAnchors[n][1], nebulaAnchors[n][2]);
      nmesh.visible = false;
      scene.add(nmesh);
      nebulaMeshes.push(nmesh);
      nebulaMats.push(nmat);
      disposables.push(nmat);
    }
    disposables.push(nebulaGeom);
    if (nebulaTex) disposables.push(nebulaTex);

    // Seamless Infinite-Scrolling Fog-Faded Synth Horizon Grid
    const retroGridGeom = new THREE.PlaneGeometry(160, 160, 1, 1);
    retroGridGeom.rotateX(-Math.PI / 2);
    const retroGridMat = createInfiniteHorizonGridMaterial();
    const retroGridMesh = new THREE.Mesh(retroGridGeom, retroGridMat);
    retroGridMesh.position.set(0, -2.35, -36);
    retroGridMesh.visible = false;
    retroGridMesh.frustumCulled = false;
    scene.add(retroGridMesh);
    disposables.push(retroGridGeom, retroGridMat);

    this.threeState = {
      renderer,
      canvas,
      ownsOffscreenCanvas,
      scene,
      camera,
      fog,
      keyLight,
      rimLight,
      rimPointLight,
      hemiLight,
      shipGroup,
      shipGhostGroup,
      shipGhostWireMat,
      shipWireOverlays,
      shipMeshBindings,
      hiddenLineFillMat,
      hiddenLineCanopyMat,
      titaniumMat,
      panelAccentMat,
      canopyGlassMat,
      cockpitGlowMat,
      trimEmissiveMat,
      portBeaconMat,
      stbdBeaconMat,
      shipWireMat,
      innerPlumeL: leftThruster.inner,
      innerPlumeR: rightThruster.inner,
      outerPlumeL: leftThruster.outer,
      outerPlumeR: rightThruster.outer,
      innerPlumeMat,
      outerPlumeMat,
      portTrailHistory,
      stbdTrailHistory,
      portTrailPositions,
      stbdTrailPositions,
      portTrailColors,
      stbdTrailColors,
      portTrailGeom,
      stbdTrailGeom,
      trailInitialized: false,
      shockwaveMeshes,
      shockwaveMats,
      shockwaveState,
      splashPositions,
      splashColors,
      splashSizes,
      splashGeom,
      splashMat,
      sparkPositions,
      sparkVelocities,
      sparkColors,
      sparkLife,
      sparkGeom,
      sparkMat,
      laserMeshes,
      laserMats,
      laserState,
      shardMeshes,
      shardMats,
      shardState,
      lightningPositions,
      lightningGeom,
      lightningMat,
      lightningLine,
      asteroidGeoms,
      asteroidEdgeGeoms,
      asteroidMeshes,
      asteroidWireMeshes,
      asteroidBasaltMat,
      asteroidWireMat,
      starPositions,
      starColors,
      starSizes,
      starPhases,
      starGeom,
      starMat,
      warpStreakPositions,
      warpStreakColors,
      warpStreakGeom,
      warpStreakMat,
      warpStreakLines,
      debrisOffsets,
      debrisPositions,
      debrisGeom,
      debrisMat,
      nebulaMeshes,
      nebulaMats,
      nebulaTex,
      retroGridMesh,
      retroGridMat,
      disposables,
    };
    this.threeActive = true;
  }

  resize(width: number, height: number, dpr = 1): void {
    const safeW = Math.max(1, Math.floor(width));
    const safeH = Math.max(1, Math.floor(height));
    const safeDpr = Math.max(1, Math.min(2, Number.isFinite(dpr) ? dpr : 1));
    this.width = safeW;
    this.height = safeH;
    this.dpr = safeDpr;

    if (this.threeState && this.threeActive) {
      this.threeState.renderer.setPixelRatio(safeDpr);
      this.threeState.renderer.setSize(safeW, safeH, false);
      this.threeState.camera.aspect = safeW / safeH;
      this.threeState.camera.updateProjectionMatrix();
    }
  }

  clear(): void {
    if (this.threeState && this.threeActive) {
      this.threeState.renderer.setClearColor(0x000000, 0);
      this.threeState.renderer.clear();
    }
  }

  reset(): void {
    this.shipX = 0;
    this.shipY = SHIP_BASE_Y;
    this.shipVx = 0;
    this.shipVy = 0;
    this.rollAngle = 0;
    this.pitchAngle = 0;
    this.yawAngle = 0;
    this.barrelRollPhase = 0;
    this.barrelRollActive = false;
    this.maneuverKind = 0;
    this.maneuverProgress = 0;
    this.maneuverCooldown = 0;
    this.cameraSpringPos = 0;
    this.cameraSpringVel = 0;
    this.thrustPulse = 0;
    this.warpSurge = 0;
    this.shockwaveProgress = 0;
    this.surgeCooldown = 0;
    this.score = 0;
    this.combo = 0;
    this.nearMissCount = 0;
    this.lastCollectedWordKey = -1;
    this.prevLyricTime = -1;
    this.staggerWordIndices.fill(-1);
    this.staggerDelays.fill(0);
    this.staggerCount = 0;
    this.wordPop = 0;
    this.collectFlash = 0;
    this.collectLunge = 0;
    this.cameraTrauma = 0;
    this.chromaticPulse = 0;
    this.rainbowTimer = 0;
    this.iceTimer = 0;
    this.electricTimer = 0;
    this.bulletTimeTimer = 0;
    this.verticalBiasTimer = 0;
    this.glitchPulse = 0;
    this.toastAlpha = 0;
    this.gateProjectionCount = 0;
    this.wordFlashKeys.fill(-1);
    this.wordFlashValues.fill(0);
    this.splashDroplets.fill(0);
    if (this.threeState) {
      this.threeState.trailInitialized = false;
      this.threeState.shockwaveState.fill(0);
      this.threeState.sparkLife.fill(0);
      this.threeState.laserState.fill(0);
      this.threeState.shardState.fill(0);
    }
    this.swSparks.fill(0);
    this.swLasers.fill(0);
    this.initScene();
  }

  private recordWordMergeFlash(key: number): void {
    for (let i = 0; i < WORD_FLASH_POOL; i++) {
      if (this.wordFlashKeys[i] === key) {
        this.wordFlashValues[i] = 1.0;
        return;
      }
    }
    const slot = this.wordFlashCursor;
    this.wordFlashCursor = (this.wordFlashCursor + 1) % WORD_FLASH_POOL;
    this.wordFlashKeys[slot] = key;
    this.wordFlashValues[slot] = 1.0;
  }

  private getWordMergeFlash(key: number): number {
    for (let i = 0; i < WORD_FLASH_POOL; i++) {
      if (this.wordFlashKeys[i] === key) {
        return this.wordFlashValues[i];
      }
    }
    return 0;
  }

  private emitSplashDroplets(
    wx: number,
    wy: number,
    wz: number,
    count: number,
    r: number,
    g: number,
    b: number
  ): void {
    for (let i = 0; i < count; i++) {
      const slot = this.splashCursor;
      this.splashCursor = (this.splashCursor + 1) % SPLASH_DROPLET_POOL;
      const base = slot * 11;
      const ang = (i / count) * Math.PI * 2 + (this.nextRand() - 0.5) * 0.28;
      const radialSpeed = 2.4 + this.nextRand() * 3.6;
      const vx = Math.cos(ang) * radialSpeed;
      const vy = Math.sin(ang) * radialSpeed * 0.85;
      const vz = 1.6 + this.nextRand() * 3.2;

      this.splashDroplets[base] = 1.0;
      this.splashDroplets[base + 1] = wx + Math.cos(ang) * 0.14;
      this.splashDroplets[base + 2] = wy + Math.sin(ang) * 0.14;
      this.splashDroplets[base + 3] = wz;
      this.splashDroplets[base + 4] = vx;
      this.splashDroplets[base + 5] = vy;
      this.splashDroplets[base + 6] = vz;
      this.splashDroplets[base + 7] = 1.0;
      this.splashDroplets[base + 8] = r;
      this.splashDroplets[base + 9] = g;
      this.splashDroplets[base + 10] = b;
    }
  }

  private startChoreographedManeuver(
    kind: 1 | 2 | 3,
    duration: number,
    dir: number,
    _force = false
  ): void {
    if (this.currentReduceMotion) return;
    // Never interrupt an active roll or violate the minimum 6s cooldown
    if (this.maneuverKind !== 0 || this.maneuverCooldown > 0) return;
    const rollDur =
      kind === 1 || kind === 2
        ? Math.max(1.05, Math.min(1.25, duration))
        : Math.max(0.85, duration);
    const totalDur = MANEUVER_ANTICIPATION_SEC + rollDur + MANEUVER_SETTLE_SEC;
    this.maneuverKind = kind;
    this.maneuverProgress = 0;
    this.maneuverDuration = totalDur;
    this.maneuverDir = dir >= 0 ? 1 : -1;
    this.maneuverCooldown = MANEUVER_MIN_COOLDOWN_SEC;
    if (kind === 1 || kind === 2) {
      this.barrelRollActive = true;
      this.barrelRollPhase = 0;
    }
  }

  private emitShockwave(x: number, y: number, z: number): void {
    if (this.threeState && this.threeActive) {
      const base = this.shockwaveCursor * 6;
      this.shockwaveCursor = (this.shockwaveCursor + 1) % SHOCKWAVE_POOL;
      this.threeState.shockwaveState[base] = 1;
      this.threeState.shockwaveState[base + 1] = 0.02;
      this.threeState.shockwaveState[base + 2] = x;
      this.threeState.shockwaveState[base + 3] = y;
      this.threeState.shockwaveState[base + 4] = z;
      this.threeState.shockwaveState[base + 5] = 0;
    }
  }

  private emitSparks(
    wx: number,
    wy: number,
    wz: number,
    count: number,
    r: number,
    g: number,
    b: number
  ): void {
    for (let i = 0; i < count; i++) {
      const slot = this.sparkCursor;
      this.sparkCursor = (this.sparkCursor + 1) % SPARK_POOL;
      const angle = (i / count) * Math.PI * 2 + this.nextRand() * 0.4;
      const speed = 2.6 + this.nextRand() * 3.8;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed * 0.75;
      const vz = 3.2 + this.nextRand() * 5.0;

      if (this.threeState) {
        const o = slot * 3;
        this.threeState.sparkPositions[o] = wx;
        this.threeState.sparkPositions[o + 1] = wy;
        this.threeState.sparkPositions[o + 2] = wz;
        this.threeState.sparkVelocities[o] = vx;
        this.threeState.sparkVelocities[o + 1] = vy;
        this.threeState.sparkVelocities[o + 2] = vz;
        this.threeState.sparkColors[o] = r;
        this.threeState.sparkColors[o + 1] = g;
        this.threeState.sparkColors[o + 2] = b;
        this.threeState.sparkLife[slot] = 1.0;
      }

      const swo = slot * 6;
      this.swSparks[swo] = wx;
      this.swSparks[swo + 1] = wy;
      this.swSparks[swo + 2] = wz;
      this.swSparks[swo + 3] = vx;
      this.swSparks[swo + 4] = vy;
      this.swSparks[swo + 5] = 1.0;
    }
  }

  private fireTwinLasers(shipWorldX: number, shipWorldY: number): void {
    // Find nearest forward asteroid to target
    let targetAst = -1;
    let bestZ = 99;
    for (let a = 0; a < ASTEROID_COUNT; a++) {
      const idx = a * ASTEROID_STRIDE;
      if (this.asteroids[idx + 11] < 0.5) continue;
      const az = this.asteroids[idx + 2];
      if (az > 1.2 && az < bestZ) {
        bestZ = az;
        targetAst = a;
      }
    }

    for (const side of [-1, 1] as const) {
      const slot = this.laserCursor;
      this.laserCursor = (this.laserCursor + 1) % LASER_POOL;
      const lx = shipWorldX + side * 1.15;
      const ly = shipWorldY;
      const lz = SHIP_WORLD_Z - 1.2;

      if (this.threeState) {
        const base = slot * 5;
        this.threeState.laserState[base] = 1;
        this.threeState.laserState[base + 1] = lx;
        this.threeState.laserState[base + 2] = ly;
        this.threeState.laserState[base + 3] = lz;
        this.threeState.laserState[base + 4] = targetAst;
      }

      const swb = slot * 4;
      this.swLasers[swb] = 1;
      this.swLasers[swb + 1] = lx;
      this.swLasers[swb + 2] = ly;
      this.swLasers[swb + 3] = lz;
    }
  }

  private shatterAsteroid(astIndex: number): void {
    const idx = astIndex * ASTEROID_STRIDE;
    const wx = this.asteroids[idx] * 5.2;
    const wy = -0.25 + this.asteroids[idx + 1] * 3.4;
    const wz = 5.0 - this.asteroids[idx + 2] * 6.2;

    if (this.threeState) {
      for (let k = 0; k < 10; k++) {
        const slot = this.shardCursor;
        this.shardCursor = (this.shardCursor + 1) % SHARD_POOL;
        const base = slot * 8;
        this.threeState.shardState[base] = 1;
        this.threeState.shardState[base + 1] = wx;
        this.threeState.shardState[base + 2] = wy;
        this.threeState.shardState[base + 3] = wz;
        this.threeState.shardState[base + 4] = (this.nextRand() - 0.5) * 9.5;
        this.threeState.shardState[base + 5] = (this.nextRand() - 0.5) * 9.5;
        this.threeState.shardState[base + 6] = (this.nextRand() - 0.3) * 8.0;
        this.threeState.shardState[base + 7] = 1.0;
      }
    }
    this.emitSparks(wx, wy, wz, 14, 1.0, 0.45, 0.12);
    this.emitShockwave(wx, wy, wz);
    this.spawnAsteroid(astIndex, 7.6 + this.nextRand() * 1.4);
  }

  private triggerWordCollection(
    wordGate: PrecomputedWordGate,
    wordZ: number,
    reduceMotion: boolean,
    palette: LyricPalette
  ): void {
    this.combo += 1;
    const mult = Math.min(16, 1 + Math.floor(this.combo / 4));
    this.score += 100 * mult;
    this.wordPop = 1.0;
    this.collectFlash = 1.0;
    this.collectLunge = reduceMotion ? 0 : 1.0;
    if (!reduceMotion) {
      this.cameraSpringVel += 1.35;
    }
    this.cameraTrauma = Math.min(reduceMotion ? 0.12 : 1.0, this.cameraTrauma + (reduceMotion ? 0.04 : 0.11));

    this.recordWordMergeFlash(wordGate.key);

    const pos = this.getFlightPosition(wordGate.startSeconds, this.tmpFlightPos);
    const gateWorldX = pos.x;
    const gateWorldY = pos.y;

    parseColorToRgbInto(palette.accentPrimary, this.tmpRgbA);
    parseColorToRgbInto(palette.accentSecondary, this.tmpRgbB);
    let splashR = this.tmpRgbA[0];
    let splashG = this.tmpRgbA[1];
    let splashB = this.tmpRgbA[2];

    const mask = wordGate.semanticMask;
    if ((mask & SEM_ICE) !== 0) {
      splashR = 0.49;
      splashG = 0.85;
      splashB = 1.0;
    } else if ((mask & SEM_FIRE) !== 0) {
      splashR = 1.0;
      splashG = 0.48;
      splashB = 0.18;
    } else if ((mask & SEM_LOVE) !== 0) {
      splashR = 1.0;
      splashG = 0.84;
      splashB = 0.34;
    } else if ((mask & SEM_RAINBOW) !== 0) {
      this.tmpColorC.setHSL((this.combo * 0.17) % 1, 0.95, 0.65);
      splashR = this.tmpColorC.r;
      splashG = this.tmpColorC.g;
      splashB = this.tmpColorC.b;
    }

    this.emitSplashDroplets(gateWorldX, gateWorldY, wordZ, 24, splashR, splashG, splashB);
    this.emitSparks(gateWorldX, gateWorldY, wordZ, 16, splashR, splashG, splashB);
    if (!reduceMotion) {
      this.emitShockwave(gateWorldX, gateWorldY, wordZ);
    }

    const shipWorldX = this.shipX;
    const shipWorldY = this.shipY;

    // Silky anticipated barrel roll on chorus / major phrase transitions (respects 6s cooldown)
    if (
      !reduceMotion &&
      wordGate.wordIndex === 0 &&
      wordGate.lineIndex > 0 &&
      wordGate.lineIndex % 4 === 0
    ) {
      const dir = this.shipVx >= 0 ? 1 : -1;
      const kind: 1 | 2 = wordGate.lineIndex % 8 === 0 ? 2 : 1;
      this.startChoreographedManeuver(kind, 1.15, dir);
    }

    if (mask === 0) {
      if (this.combo > 0 && this.combo % 8 === 0) {
        this.toastText = `COMBO x${this.combo}`;
        this.toastAlpha = 1.0;
        this.toastColorKind = 'accent';
      }
      return;
    }

    if ((mask & SEM_FIRE) !== 0 && !reduceMotion) {
      this.fireTwinLasers(shipWorldX, shipWorldY);
      this.cameraTrauma = Math.min(1.0, this.cameraTrauma + 0.36);
      this.thrustPulse = Math.max(this.thrustPulse, 1.15);
      this.toastText = 'PLASMA STRIKE!';
      this.toastAlpha = 1.15;
      this.toastColorKind = 'danger';
    }
    if ((mask & SEM_BOOST) !== 0 && !reduceMotion) {
      this.warpSurge = 1.25;
      this.startChoreographedManeuver(1, 1.12, this.shipVx >= 0 ? 1 : -1);
      this.chromaticPulse = 0.85;
      this.cameraSpringVel += 1.4;
      this.toastText = 'HYPER WARP!';
      this.toastAlpha = 1.15;
      this.toastColorKind = 'accent';
    }
    if ((mask & SEM_RAINBOW) !== 0) {
      this.rainbowTimer = 3.2;
      this.toastText = 'PRISM OVERDRIVE';
      this.toastAlpha = 1.1;
      this.toastColorKind = 'gold';
    }
    if ((mask & SEM_ICE) !== 0) {
      this.iceTimer = 2.6;
      this.emitSparks(shipWorldX, shipWorldY, SHIP_WORLD_Z - 1.5, 16, 0.55, 0.92, 1.0);
      this.toastText = 'CRYO THRUST';
      this.toastAlpha = 1.1;
      this.toastColorKind = 'ice';
    }
    if ((mask & SEM_ELECTRIC) !== 0 && !reduceMotion) {
      this.electricTimer = 1.35;
      this.cameraTrauma = Math.min(1.0, this.cameraTrauma + 0.22);
      this.toastText = 'ARC DISCHARGE';
      this.toastAlpha = 1.1;
      this.toastColorKind = 'ice';
    }
    if ((mask & SEM_TIME) !== 0 && !reduceMotion) {
      this.bulletTimeTimer = 1.0;
      this.toastText = 'BULLET-TIME';
      this.toastAlpha = 1.15;
      this.toastColorKind = 'accent';
    }
    if ((mask & SEM_UP) !== 0 && !reduceMotion) {
      this.verticalBiasTimer = 0.9;
      this.verticalBiasDir = 1;
    } else if ((mask & SEM_DOWN) !== 0 && !reduceMotion) {
      this.verticalBiasTimer = 0.9;
      this.verticalBiasDir = -1;
    }
    if ((mask & SEM_LOVE) !== 0) {
      this.emitSparks(gateWorldX, gateWorldY, wordZ, 16, 1.0, 0.82, 0.35);
      this.toastText = 'STARLIGHT +250';
      this.score += 250;
      this.toastAlpha = 1.1;
      this.toastColorKind = 'gold';
    }
    if ((mask & SEM_GLITCH) !== 0 && !reduceMotion) {
      this.glitchPulse = 1.0;
      this.chromaticPulse = 1.0;
    }
  }

  private renderThree(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    timeSeconds: number,
    dt: number,
    audio: AudioFrameMetrics,
    palette: LyricPalette,
    reduceMotion: boolean,
    isOverlayMode: boolean,
    varIdx: 0 | 1 | 2,
    warpSpeed: number,
    cx: number
  ): void {
    const st = this.threeState;
    if (!st) return;

    if (width !== this.width || height !== this.height) {
      this.resize(width, height, this.dpr);
    }

    parseColorToRgbInto(palette.accentPrimary, this.tmpRgbA);
    parseColorToRgbInto(palette.accentSecondary, this.tmpRgbB);
    parseColorToRgbInto(palette.bgDeep, this.tmpRgbC);
    this.tmpColorA.setRGB(this.tmpRgbA[0], this.tmpRgbA[1], this.tmpRgbA[2]);
    this.tmpColorB.setRGB(this.tmpRgbB[0], this.tmpRgbB[1], this.tmpRgbB[2]);
    this.tmpColorC.setRGB(this.tmpRgbC[0], this.tmpRgbC[1], this.tmpRgbC[2]);

    // Rainbow or Cryo override color
    if (this.rainbowTimer > 0) {
      const hue = (timeSeconds * 0.85) % 1;
      this.tmpColorA.setHSL(hue, 0.92, 0.62);
      this.tmpColorB.setHSL((hue + 0.35) % 1, 0.92, 0.62);
    } else if (this.iceTimer > 0) {
      this.tmpColorA.setRGB(0.49, 0.83, 0.99);
      this.tmpColorB.setRGB(0.82, 0.95, 1.0);
    }

    // Shift frustum optical axis smoothly to focalCenterX without clipping edge-to-edge stars
    if (Math.abs(cx - width * 0.5) > 1.0) {
      st.camera.setViewOffset(width, height, width * 0.5 - cx, 0, width, height);
    } else {
      st.camera.clearViewOffset();
    }

    // Trauma-based camera shake (quadratic trauma^2) + bullet-time orbital arc + FOV warp kick
    const traumaEff = reduceMotion ? Math.min(0.15, this.cameraTrauma) : this.cameraTrauma;
    const shake = traumaEff * traumaEff;
    const shakeX = shake * Math.sin(timeSeconds * 47.0) * 0.24;
    const shakeY = shake * Math.cos(timeSeconds * 53.0) * 0.18;
    const shakeRoll = shake * Math.sin(timeSeconds * 37.0) * 0.045;

    const bulletArc =
      this.bulletTimeTimer > 0 && !reduceMotion
        ? Math.sin((1.0 - this.bulletTimeTimer) * Math.PI) * 1.45
        : 0;
    const lungeZ = this.collectLunge * 0.16 + this.cameraSpringPos * 0.42;

    st.camera.position.set(this.shipX * 0.16 + shakeX + bulletArc, 0.65 + shakeY, 6.2 - lungeZ);
    st.camera.lookAt(this.shipX * 0.12, -0.14, -5.0);
    st.camera.rotation.z += shakeRoll;

    const targetFov = 52 + this.warpSurge * 13 + this.collectLunge * 2.2 + Math.max(0, this.cameraSpringPos) * 3.5;
    if (Math.abs(st.camera.fov - targetFov) > 0.05) {
      st.camera.fov = targetFov;
      st.camera.updateProjectionMatrix();
    }

    // Update 3-point space lights & FogExp2 deep-space haze
    st.rimLight.color.copy(this.tmpColorA);
    st.rimLight.intensity =
      (varIdx === 1 ? 2.8 : 2.1) + audio.rmsLevel * 1.1 + this.warpSurge * 0.8 + this.collectFlash * 1.6;
    st.rimPointLight.color.copy(this.tmpColorB);
    st.rimPointLight.intensity = 4.2 + audio.bassEnergy * 3.5 + this.collectFlash * 4.0;
    st.hemiLight.color.copy(this.tmpColorB);
    if (isOverlayMode) {
      st.scene.fog = null;
    } else {
      st.scene.fog = st.fog;
      st.fog.color.copy(this.tmpColorC).multiplyScalar(0.55);
      st.fog.density = varIdx === 1 ? 0.015 : 0.018;
    }

    // Unified Hidden-Line Vector Wireframe vs PBR Titanium across 100% of ship parts & asteroids
    const isWire = varIdx === 2;
    for (let i = 0; i < st.shipMeshBindings.length; i++) {
      const b = st.shipMeshBindings[i];
      b.mesh.material = isWire ? b.wireMat : b.normalMat;
    }
    st.asteroidBasaltMat.wireframe = false;
    st.trimEmissiveMat.color.copy(this.tmpColorA);
    if (this.collectFlash > 0.05) {
      st.trimEmissiveMat.color.lerp(this.tmpColorC.setRGB(1, 1, 1), this.collectFlash * 0.65);
    }
    st.cockpitGlowMat.color.copy(this.tmpColorA);
    st.shipWireMat.color.copy(this.tmpColorA);
    st.shipWireMat.opacity = isWire ? 0.92 : 0.22;
    for (let i = 0; i < st.shipWireOverlays.length; i++) {
      st.shipWireOverlays[i].visible = true;
    }
    st.asteroidWireMat.color.copy(this.tmpColorB);
    for (let i = 0; i < ASTEROID_COUNT; i++) {
      st.asteroidMeshes[i].material = isWire ? st.hiddenLineFillMat : st.asteroidBasaltMat;
      st.asteroidWireMeshes[i].visible = isWire;
    }

    // Blinking wingtip red / cyan beacons
    const navPulse = reduceMotion ? 0.85 : 0.45 + 0.55 * (Math.sin(timeSeconds * 6.4) > 0 ? 1 : 0.25);
    st.portBeaconMat.color.setRGB(1.0 * navPulse, 0.23 * navPulse, 0.36 * navPulse);
    const stbdPulse = reduceMotion ? 0.85 : 0.45 + 0.55 * (Math.sin(timeSeconds * 6.4 + Math.PI * 0.5) > 0 ? 1 : 0.25);
    st.stbdBeaconMat.color.setRGB(0.13 * stbdPulse, 0.83 * stbdPulse, 0.93 * stbdPulse);

    // Position & orient Starfighter smoothly in flight corridor
    const worldShipX = this.shipX;
    const worldShipY = this.shipY;
    st.shipGroup.position.set(
      worldShipX,
      worldShipY,
      SHIP_WORLD_Z - this.warpSurge * 0.28 - this.collectLunge * 0.14
    );
    st.shipGroup.rotation.set(this.pitchAngle * 0.85, this.yawAngle, -this.rollAngle);
    st.shipGroup.updateMatrixWorld(true);

    // Ghost wireframe echo during glitch/broken/ghost semantic words
    if (this.glitchPulse > 0.04 && !reduceMotion) {
      st.shipGhostGroup.visible = true;
      st.shipGhostGroup.position.set(
        worldShipX + Math.sin(timeSeconds * 40) * 0.18 * this.glitchPulse,
        worldShipY + 0.04,
        SHIP_WORLD_Z + 0.45
      );
      st.shipGhostGroup.rotation.copy(st.shipGroup.rotation);
      st.shipGhostWireMat.opacity = this.glitchPulse * 0.7;
    } else {
      st.shipGhostGroup.visible = false;
    }

    // Update Volumetric Tapered Additive Plasma Cones
    const coneLen = 0.85 + this.thrustPulse * 0.95 + this.warpSurge * 1.45;
    const coneRad = 1.0 + this.thrustPulse * 0.28 + this.warpSurge * 0.24;
    st.innerPlumeL.scale.set(coneRad, coneRad, coneLen * 0.88);
    st.innerPlumeR.scale.set(coneRad, coneRad, coneLen * 0.88);
    st.outerPlumeL.scale.set(coneRad * 1.15, coneRad * 1.15, coneLen);
    st.outerPlumeR.scale.set(coneRad * 1.15, coneRad * 1.15, coneLen);

    st.innerPlumeMat.uniforms.uColorEdge.value.copy(this.tmpColorA);
    st.innerPlumeMat.uniforms.uIntensity.value = Math.min(1.5, 0.78 + this.thrustPulse * 0.45 + this.warpSurge * 0.4);
    st.innerPlumeMat.uniforms.uTime.value = timeSeconds;

    st.outerPlumeMat.uniforms.uColorCore.value.copy(this.tmpColorA);
    st.outerPlumeMat.uniforms.uColorEdge.value.copy(this.tmpColorB);
    st.outerPlumeMat.uniforms.uIntensity.value = Math.min(1.3, 0.52 + this.thrustPulse * 0.42 + this.warpSurge * 0.42);
    st.outerPlumeMat.uniforms.uTime.value = timeSeconds;

    // Wingtip Additive Ribbon Contrails
    const trailAdvectZ = (reduceMotion ? 0.2 : warpSpeed * 6.8) * dt;
    this.tmpVecA.set(-2.12, -0.02, 1.2).applyMatrix4(st.shipGroup.matrixWorld);
    this.tmpVecB.set(2.12, -0.02, 1.2).applyMatrix4(st.shipGroup.matrixWorld);

    if (!st.trailInitialized) {
      st.trailInitialized = true;
      for (let s = 0; s < TRAIL_SEGMENTS; s++) {
        const o = s * 3;
        st.portTrailHistory[o] = this.tmpVecA.x;
        st.portTrailHistory[o + 1] = this.tmpVecA.y;
        st.portTrailHistory[o + 2] = this.tmpVecA.z + s * 0.08;
        st.stbdTrailHistory[o] = this.tmpVecB.x;
        st.stbdTrailHistory[o + 1] = this.tmpVecB.y;
        st.stbdTrailHistory[o + 2] = this.tmpVecB.z + s * 0.08;
      }
    } else {
      for (let s = TRAIL_SEGMENTS - 1; s > 0; s--) {
        const dst = s * 3;
        const src = (s - 1) * 3;
        st.portTrailHistory[dst] = st.portTrailHistory[src];
        st.portTrailHistory[dst + 1] = st.portTrailHistory[src + 1];
        st.portTrailHistory[dst + 2] = st.portTrailHistory[src + 2] + trailAdvectZ;

        st.stbdTrailHistory[dst] = st.stbdTrailHistory[src];
        st.stbdTrailHistory[dst + 1] = st.stbdTrailHistory[src + 1];
        st.stbdTrailHistory[dst + 2] = st.stbdTrailHistory[src + 2] + trailAdvectZ;
      }
      st.portTrailHistory[0] = this.tmpVecA.x;
      st.portTrailHistory[1] = this.tmpVecA.y;
      st.portTrailHistory[2] = this.tmpVecA.z;
      st.stbdTrailHistory[0] = this.tmpVecB.x;
      st.stbdTrailHistory[1] = this.tmpVecB.y;
      st.stbdTrailHistory[2] = this.tmpVecB.z;
    }

    const trailBright = isOverlayMode ? 0.55 : 0.88;
    const isRainbow = this.rainbowTimer > 0;
    const hasSplitClip = this.contentInsetLeft > 2 && width > 1;
    const splitFadeStart = this.contentInsetLeft + 10;
    for (let s = 0; s < TRAIL_SEGMENTS; s++) {
      const tNorm = 1 - s / (TRAIL_SEGMENTS - 1);
      const halfW = (0.042 + Math.min(0.04, Math.abs(this.shipVx) * 0.03)) * tNorm * (1 + this.warpSurge * 0.45);
      const ho = s * 3;
      const vo = s * 6;

      let portFade = tNorm * tNorm * trailBright;
      if (hasSplitClip) {
        this.tmpVecC
          .set(st.portTrailHistory[ho], st.portTrailHistory[ho + 1], st.portTrailHistory[ho + 2])
          .project(st.camera);
        const ptScreenX = (this.tmpVecC.x * 0.5 + 0.5) * width;
        portFade *= Math.max(0, Math.min(1, (ptScreenX - splitFadeStart) / 36));
      }

      st.portTrailPositions[vo] = st.portTrailHistory[ho];
      st.portTrailPositions[vo + 1] = st.portTrailHistory[ho + 1] + halfW;
      st.portTrailPositions[vo + 2] = st.portTrailHistory[ho + 2];
      st.portTrailPositions[vo + 3] = st.portTrailHistory[ho];
      st.portTrailPositions[vo + 4] = st.portTrailHistory[ho + 1] - halfW;
      st.portTrailPositions[vo + 5] = st.portTrailHistory[ho + 2];

      let pr = (0.95 * 0.55 + this.tmpColorA.r * 0.45) * portFade;
      let pg = (0.24 * 0.55 + this.tmpColorA.g * 0.45) * portFade;
      let pb = (0.38 * 0.55 + this.tmpColorA.b * 0.45) * portFade;
      if (isRainbow) {
        this.tmpColorC.setHSL((timeSeconds * 0.9 + s * 0.04) % 1, 0.95, 0.6);
        pr = this.tmpColorC.r * portFade;
        pg = this.tmpColorC.g * portFade;
        pb = this.tmpColorC.b * portFade;
      }
      st.portTrailColors[vo] = pr;
      st.portTrailColors[vo + 1] = pg;
      st.portTrailColors[vo + 2] = pb;
      st.portTrailColors[vo + 3] = pr;
      st.portTrailColors[vo + 4] = pg;
      st.portTrailColors[vo + 5] = pb;

      let stbdFade = tNorm * tNorm * trailBright;
      if (hasSplitClip) {
        this.tmpVecC
          .set(st.stbdTrailHistory[ho], st.stbdTrailHistory[ho + 1], st.stbdTrailHistory[ho + 2])
          .project(st.camera);
        const stScreenX = (this.tmpVecC.x * 0.5 + 0.5) * width;
        stbdFade *= Math.max(0, Math.min(1, (stScreenX - splitFadeStart) / 36));
      }

      st.stbdTrailPositions[vo] = st.stbdTrailHistory[ho];
      st.stbdTrailPositions[vo + 1] = st.stbdTrailHistory[ho + 1] + halfW;
      st.stbdTrailPositions[vo + 2] = st.stbdTrailHistory[ho + 2];
      st.stbdTrailPositions[vo + 3] = st.stbdTrailHistory[ho];
      st.stbdTrailPositions[vo + 4] = st.stbdTrailHistory[ho + 1] - halfW;
      st.stbdTrailPositions[vo + 5] = st.stbdTrailHistory[ho + 2];

      let sr = (0.14 * 0.5 + this.tmpColorA.r * 0.5) * stbdFade;
      let sg = (0.85 * 0.5 + this.tmpColorA.g * 0.5) * stbdFade;
      let sb = (0.95 * 0.5 + this.tmpColorA.b * 0.5) * stbdFade;
      if (isRainbow) {
        this.tmpColorC.setHSL((timeSeconds * 0.9 + 0.5 + s * 0.04) % 1, 0.95, 0.6);
        sr = this.tmpColorC.r * stbdFade;
        sg = this.tmpColorC.g * stbdFade;
        sb = this.tmpColorC.b * stbdFade;
      }
      st.stbdTrailColors[vo] = sr;
      st.stbdTrailColors[vo + 1] = sg;
      st.stbdTrailColors[vo + 2] = sb;
      st.stbdTrailColors[vo + 3] = sr;
      st.stbdTrailColors[vo + 4] = sg;
      st.stbdTrailColors[vo + 5] = sb;
    }
    (st.portTrailGeom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (st.portTrailGeom.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (st.stbdTrailGeom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (st.stbdTrailGeom.attributes.color as THREE.BufferAttribute).needsUpdate = true;

    // Project exact 3D lyric word anchors to 2D canvas coordinates (zero hexagon geometry)
    for (let g = 0; g < this.gateProjectionCount; g++) {
      const gp = this.gateProjections[g];
      if (gp.worldZ >= st.camera.position.z - 0.5) {
        gp.alpha = 0;
        continue;
      }
      this.tmpVecC.set(gp.worldX, gp.worldY, gp.worldZ).project(st.camera);
      gp.screenX = (this.tmpVecC.x * 0.5 + 0.5) * width;
      gp.screenY = (-this.tmpVecC.y * 0.5 + 0.5) * height;
      gp.scale = Math.max(
        0.55,
        Math.min(1.6, 7.2 / Math.max(1.5, Math.abs(st.camera.position.z - gp.worldZ)))
      );
    }

    // Sync Liquid-Starlight Splash Droplet Bursts (SPLASH_DROPLET_POOL = 96)
    st.splashMat.uniforms.uPixelRatio.value = this.dpr;
    st.splashMat.uniforms.uBrightness.value = isOverlayMode ? 0.65 : 1.0;
    for (let i = 0; i < SPLASH_DROPLET_POOL; i++) {
      const sb = i * 11;
      const o = i * 3;
      const life = this.splashDroplets[sb + 7];
      if (this.splashDroplets[sb] > 0.5 && life > 0) {
        st.splashPositions[o] = this.splashDroplets[sb + 1];
        st.splashPositions[o + 1] = this.splashDroplets[sb + 2];
        st.splashPositions[o + 2] = this.splashDroplets[sb + 3];
        st.splashColors[o] = this.splashDroplets[sb + 8] * life;
        st.splashColors[o + 1] = this.splashDroplets[sb + 9] * life;
        st.splashColors[o + 2] = this.splashDroplets[sb + 10] * life;
        st.splashSizes[i] = 0.9 + life * 1.65;
      } else {
        st.splashPositions[o + 2] = 999;
        st.splashSizes[i] = 0;
      }
    }
    (st.splashGeom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (st.splashGeom.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (st.splashGeom.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;

    // Update Expanding Additive Shockwave Rings
    for (let i = 0; i < SHOCKWAVE_POOL; i++) {
      const base = i * 6;
      const mesh = st.shockwaveMeshes[i];
      const mat = st.shockwaveMats[i];
      if (st.shockwaveState[base] > 0.5 && !reduceMotion) {
        st.shockwaveState[base + 1] += dt * 3.4;
        const p = st.shockwaveState[base + 1];
        if (p >= 1.0) {
          st.shockwaveState[base] = 0;
          mesh.visible = false;
        } else {
          mesh.visible = true;
          const sc = 0.22 + p * 1.05;
          mesh.position.set(
            st.shockwaveState[base + 2],
            st.shockwaveState[base + 3],
            st.shockwaveState[base + 4] + p * 1.4
          );
          mesh.scale.set(sc, sc, 1);
          mesh.rotation.set(0.12, 0, -this.rollAngle * 0.45);
          mat.color.copy(this.tmpColorA);
          mat.opacity = (1 - p) * (1 - p) * (isOverlayMode ? 0.2 : 0.28);
        }
      } else {
        mesh.visible = false;
      }
    }

    // Update Pooled Absorption Sparks
    for (let i = 0; i < SPARK_POOL; i++) {
      const life = st.sparkLife[i];
      const o = i * 3;
      if (life > 0) {
        st.sparkLife[i] = Math.max(0, life - dt * 2.2);
        st.sparkPositions[o] += st.sparkVelocities[o] * dt;
        st.sparkPositions[o + 1] += st.sparkVelocities[o + 1] * dt;
        st.sparkPositions[o + 2] += st.sparkVelocities[o + 2] * dt;
      } else {
        st.sparkPositions[o + 2] = 999; // hide off-screen behind camera
      }
    }
    (st.sparkGeom.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    // Update Pooled Plasma Lasers & Asteroid Shatter
    for (let l = 0; l < LASER_POOL; l++) {
      const base = l * 5;
      const mesh = st.laserMeshes[l];
      if (st.laserState[base] > 0.5) {
        st.laserState[base + 3] -= dt * 44.0;
        const lz = st.laserState[base + 3];
        const targetIdx = st.laserState[base + 4] | 0;
        if (targetIdx >= 0 && targetIdx < ASTEROID_COUNT && this.asteroids[targetIdx * ASTEROID_STRIDE + 11] > 0.5) {
          const astZ = 5.0 - this.asteroids[targetIdx * ASTEROID_STRIDE + 2] * 6.2;
          const astX = this.asteroids[targetIdx * ASTEROID_STRIDE] * 5.2;
          const astY = -0.25 + this.asteroids[targetIdx * ASTEROID_STRIDE + 1] * 3.4;
          st.laserState[base + 1] += (astX - st.laserState[base + 1]) * Math.min(1, dt * 14);
          st.laserState[base + 2] += (astY - st.laserState[base + 2]) * Math.min(1, dt * 14);
          if (lz <= astZ + 1.1) {
            this.shatterAsteroid(targetIdx);
            st.laserState[base] = 0;
            mesh.visible = false;
            continue;
          }
        }
        if (lz < -48) {
          st.laserState[base] = 0;
          mesh.visible = false;
        } else {
          mesh.visible = true;
          mesh.position.set(st.laserState[base + 1], st.laserState[base + 2], lz);
        }
      } else {
        mesh.visible = false;
      }
    }

    // Update Molten Rock Shards
    for (let s = 0; s < SHARD_POOL; s++) {
      const base = s * 8;
      const mesh = st.shardMeshes[s];
      if (st.shardState[base] > 0.5) {
        st.shardState[base + 7] -= dt * 1.4;
        if (st.shardState[base + 7] <= 0) {
          st.shardState[base] = 0;
          mesh.visible = false;
        } else {
          mesh.visible = true;
          st.shardState[base + 1] += st.shardState[base + 4] * dt;
          st.shardState[base + 2] += st.shardState[base + 5] * dt;
          st.shardState[base + 3] += st.shardState[base + 6] * dt;
          mesh.position.set(st.shardState[base + 1], st.shardState[base + 2], st.shardState[base + 3]);
          mesh.rotation.x += dt * 7;
          mesh.rotation.y += dt * 9;
          mesh.scale.setScalar(st.shardState[base + 7]);
          st.shardMats[s].opacity = st.shardState[base + 7];
        }
      } else {
        mesh.visible = false;
      }
    }

    // Update Jagged Procedural Lightning Arcs
    if (this.electricTimer > 0 && !reduceMotion) {
      st.lightningLine.visible = true;
      st.lightningMat.opacity = Math.min(1, this.electricTimer * 1.5);
      const halfSegs = LIGHTNING_SEGMENTS / 2;
      for (let sideIdx = 0; sideIdx < 2; sideIdx++) {
        const startX = sideIdx === 0 ? this.tmpVecA.x : this.tmpVecB.x;
        const startY = sideIdx === 0 ? this.tmpVecA.y : this.tmpVecB.y;
        const startZ = sideIdx === 0 ? this.tmpVecA.z : this.tmpVecB.z;
        const endX = startX * 1.45;
        const endY = startY + (sideIdx === 0 ? 1.1 : -0.9);
        const endZ = startZ - 5.5;

        let px = startX;
        let py = startY;
        let pz = startZ;
        for (let seg = 0; seg < halfSegs; seg++) {
          const frac = (seg + 1) / halfSegs;
          const jitter = seg === halfSegs - 1 ? 0 : 0.42;
          const nx = startX + (endX - startX) * frac + (this.nextRand() - 0.5) * jitter;
          const ny = startY + (endY - startY) * frac + (this.nextRand() - 0.5) * jitter;
          const nz = startZ + (endZ - startZ) * frac;
          const vo = (sideIdx * halfSegs + seg) * 6;
          st.lightningPositions[vo] = px;
          st.lightningPositions[vo + 1] = py;
          st.lightningPositions[vo + 2] = pz;
          st.lightningPositions[vo + 3] = nx;
          st.lightningPositions[vo + 4] = ny;
          st.lightningPositions[vo + 5] = nz;
          px = nx;
          py = ny;
          pz = nz;
        }
      }
      (st.lightningGeom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    } else {
      st.lightningLine.visible = false;
    }

    // Map Asteroid Corridor into 3D World Space
    for (let a = 0; a < ASTEROID_COUNT; a++) {
      const idx = a * ASTEROID_STRIDE;
      const azNorm = this.asteroids[idx + 2];
      const worldZ = 5.0 - azNorm * 6.2;
      const worldX = this.asteroids[idx] * 5.2;
      const worldY = -0.25 + this.asteroids[idx + 1] * 3.4;
      const sc = this.asteroids[idx + 6] * 3.2;
      const mesh = st.asteroidMeshes[a];
      mesh.position.set(worldX, worldY, worldZ);
      mesh.rotation.set(this.asteroids[idx + 3], this.asteroids[idx + 4], this.asteroids[idx + 3] * 0.5);
      mesh.scale.set(sc * this.asteroids[idx + 8], sc, sc);
    }

    // Serene 2,400 Multi-Scale Twinkling Pinpoint Stars + Secondary Warp Surge Streak Pool
    const starBright = isOverlayMode ? 0.68 : 1.0;
    st.starMat.uniforms.uTime.value = timeSeconds;
    st.starMat.uniforms.uPixelRatio.value = this.dpr;
    st.starMat.uniforms.uReduceMotion.value = reduceMotion ? 1.0 : 0.0;
    st.starMat.uniforms.uBrightness.value = starBright;

    for (let i = 0; i < STAR_COUNT; i++) {
      const idx = i * STAR_STRIDE;
      const zNorm = this.stars[idx + 2];
      const wz = 4.5 - zNorm * 32.0;
      const wx = this.stars[idx] * 18.0;
      const wy = this.stars[idx + 1] * 13.0;
      const po = i * 3;
      st.starPositions[po] = wx;
      st.starPositions[po + 1] = wy;
      st.starPositions[po + 2] = wz;
    }
    (st.starGeom.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    const showWarpStreaks = !reduceMotion && this.warpSurge > 0.15;
    st.warpStreakLines.visible = showWarpStreaks;
    if (showWarpStreaks) {
      const surgeAmt = Math.min(1, (this.warpSurge - 0.15) / 1.1);
      const streakLen = surgeAmt * 3.4;
      st.warpStreakMat.opacity = surgeAmt * 0.62 * starBright;
      const stride = Math.max(1, Math.floor(STAR_COUNT / WARP_STREAK_COUNT));
      for (let k = 0; k < WARP_STREAK_COUNT; k++) {
        const starIdx = ((k * stride) % STAR_COUNT) * STAR_STRIDE;
        const zNorm = this.stars[starIdx + 2];
        const wz = 4.5 - zNorm * 32.0;
        const wx = this.stars[starIdx] * 18.0;
        const wy = this.stars[starIdx + 1] * 13.0;
        const vo = k * 6;
        st.warpStreakPositions[vo] = wx;
        st.warpStreakPositions[vo + 1] = wy;
        st.warpStreakPositions[vo + 2] = wz;
        st.warpStreakPositions[vo + 3] = wx;
        st.warpStreakPositions[vo + 4] = wy;
        st.warpStreakPositions[vo + 5] = wz - streakLen;

        const r = 0.88;
        const g = 0.94;
        const b = 1.0;
        st.warpStreakColors[vo] = r;
        st.warpStreakColors[vo + 1] = g;
        st.warpStreakColors[vo + 2] = b;
        st.warpStreakColors[vo + 3] = r * 0.08;
        st.warpStreakColors[vo + 4] = g * 0.08;
        st.warpStreakColors[vo + 5] = b * 0.08;
      }
      (st.warpStreakGeom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (st.warpStreakGeom.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    } else {
      st.warpStreakMat.opacity = 0;
    }

    // Drifting Micro-Debris Dust Particles
    const debrisAdvect = (reduceMotion ? 0.4 : warpSpeed * 12.5) * dt;
    for (let d = 0; d < DEBRIS_COUNT; d++) {
      const o = d * 3;
      let dz = st.debrisOffsets[o + 2] + debrisAdvect;
      if (dz > 5.5) dz -= 42;
      st.debrisOffsets[o + 2] = dz;
      st.debrisPositions[o] = st.debrisOffsets[o];
      st.debrisPositions[o + 1] = st.debrisOffsets[o + 1];
      st.debrisPositions[o + 2] = dz;
    }
    (st.debrisGeom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    st.debrisMat.color.copy(this.tmpColorA).lerp(this.tmpColorB, 0.35);
    st.debrisMat.opacity = isOverlayMode ? 0.32 : 0.56;

    // Nebula Run Clouds
    const showNebula = varIdx === 1 && !isOverlayMode;
    for (let n = 0; n < st.nebulaMeshes.length; n++) {
      const nm = st.nebulaMeshes[n];
      nm.visible = showNebula;
      if (showNebula) {
        const drift = reduceMotion ? 0 : Math.sin(timeSeconds * 0.22 + n * 1.5) * 1.4;
        nm.position.x = (n % 2 === 0 ? -5.5 : 5.8) + drift;
        st.nebulaMats[n].color.copy(n % 2 === 0 ? this.tmpColorA : this.tmpColorB);
        st.nebulaMats[n].opacity = 0.16 + audio.rmsLevel * 0.12;
      }
    }

    // Seamless Infinite Fog-Faded Horizon Grid
    const showGrid = varIdx === 2 && !isOverlayMode;
    st.retroGridMesh.visible = showGrid;
    if (showGrid) {
      if (!reduceMotion) {
        this.gridScrollZ += warpSpeed * 7.5 * dt;
      }
      st.retroGridMat.uniforms.uColorPrimary.value.copy(this.tmpColorA);
      st.retroGridMat.uniforms.uColorSecondary.value.copy(this.tmpColorB);
      st.retroGridMat.uniforms.uScrollZ.value = this.gridScrollZ;
      st.retroGridMat.uniforms.uOpacity.value = 0.42 + audio.bassEnergy * 0.25;
    }

    st.renderer.setClearColor(0x000000, 0);
    st.renderer.render(st.scene, st.camera);

    if (st.ownsOffscreenCanvas && ctx && typeof ctx.drawImage === 'function') {
      ctx.save();
      ctx.drawImage(st.canvas, 0, 0, width, height);
      ctx.restore();
    }
  }

  // -------------------------------------------------------------------------
  // Software Canvas2D Fallback Renderer (Headless / Mock / No-WebGL fallback)
  // -------------------------------------------------------------------------

  private renderAsteroidsInRange(
    ctx: CanvasRenderingContext2D,
    palette: LyricPalette,
    minZ: number,
    maxZ: number
  ): void {
    const cx = this.frameCx;
    const cy = this.frameCy;
    const focal = this.frameFocal;
    const width = this.frameWidth;
    const height = this.frameHeight;
    const varIdx = this.frameVarIdx;
    const isOverlayMode = this.frameIsOverlay;

    ctx.save();
    for (let k = 0; k < ASTEROID_COUNT; k++) {
      const a = this.astOrder[k];
      const idx = a * ASTEROID_STRIDE;
      const az = this.asteroids[idx + 2];
      if (az < minZ || az >= maxZ) continue;

      const ax = this.asteroids[idx];
      const ay = this.asteroids[idx + 1];
      const rx = this.asteroids[idx + 3];
      const ry = this.asteroids[idx + 4];
      const scale = this.asteroids[idx + 6];
      const seedStretch = this.asteroids[idx + 8];

      const cRx = Math.cos(rx);
      const sRx = Math.sin(rx);
      const cRy = Math.cos(ry);
      const sRy = Math.sin(ry);

      for (let v = 0; v < 6; v++) {
        const lx = AST_VERTS[v * 3] * scale * seedStretch;
        const ly = AST_VERTS[v * 3 + 1] * scale;
        const lz = AST_VERTS[v * 3 + 2] * scale;

        const y1 = ly * cRx - lz * sRx;
        const z1 = ly * sRx + lz * cRx;
        const x2 = lx * cRy + z1 * sRy;
        const z2 = -lx * sRy + z1 * cRy;

        const wz = Math.max(0.15, az + z2 * 0.35);
        const invZ = 1.0 / wz;
        this.astProjX[v] = cx + (ax + x2 * 0.45) * focal * invZ;
        this.astProjY[v] = cy + (ay + y1 * 0.45) * focal * invZ;
        this.astProjZ[v] = wz;
      }

      if (
        this.astProjX[0] < -80 ||
        this.astProjX[0] > width + 80 ||
        this.astProjY[0] < -80 ||
        this.astProjY[0] > height + 80
      ) {
        continue;
      }

      const distAlpha =
        Math.min(1, Math.max(0.15, (6.8 - az) * 0.25)) * (isOverlayMode ? 0.65 : 0.92);

      for (let f = 0; f < 8; f++) {
        const i0 = AST_FACES[f * 3];
        const i1 = AST_FACES[f * 3 + 1];
        const i2 = AST_FACES[f * 3 + 2];

        const ux = this.astProjX[i1] - this.astProjX[i0];
        const uy = this.astProjY[i1] - this.astProjY[i0];
        const vx = this.astProjX[i2] - this.astProjX[i0];
        const vy = this.astProjY[i2] - this.astProjY[i0];
        if (ux * vy - uy * vx > 0) continue;

        ctx.beginPath();
        ctx.moveTo(this.astProjX[i0], this.astProjY[i0]);
        ctx.lineTo(this.astProjX[i1], this.astProjY[i1]);
        ctx.lineTo(this.astProjX[i2], this.astProjY[i2]);
        ctx.closePath();

        if (varIdx === 2) {
          ctx.fillStyle = 'rgba(5, 5, 11, 0.92)';
          ctx.globalAlpha = distAlpha;
          ctx.fill();
          ctx.strokeStyle = palette.accentSecondary;
          ctx.lineWidth = 1.15;
          ctx.stroke();
        } else {
          ctx.fillStyle = ASTEROID_SHADE_FILLS[f];
          ctx.globalAlpha = distAlpha;
          ctx.fill();
          ctx.strokeStyle = f % 2 === 0 ? palette.accentSecondary : 'rgba(148, 163, 184, 0.35)';
          ctx.globalAlpha = distAlpha * 0.45;
          ctx.lineWidth = 0.9;
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  private projectLocalPoint(vx: number, vy: number, vz: number, outIndex: number): void {
    const rx = vx * this.cosR - vy * this.sinR;
    const ry = vx * this.sinR + vy * this.cosR;

    const py = ry * this.cosP - vz * this.sinP;
    const pz = ry * this.sinP + vz * this.cosP;

    const yx = rx * this.cosY + pz * this.sinY;
    const yz = -rx * this.sinY + pz * this.cosY;

    const camZ = 5.4 - yz;
    const persp = 4.6 / Math.max(1.2, camZ);
    this.projX[outIndex] = this.shipCenterX + yx * this.shipScale * persp;
    this.projY[outIndex] = this.shipCenterY - py * this.shipScale * persp;
    this.projZ[outIndex] = camZ;
  }

  private drawThrusterPlume(
    ctx: CanvasRenderingContext2D,
    palette: LyricPalette,
    vertIdx: number,
    localX: number
  ): void {
    const tx = this.projX[vertIdx];
    const ty = this.projY[vertIdx];
    const isOverlayMode = this.frameIsOverlay;

    const tipVz = -1.42 - this.plumeLength;
    const rx = localX * this.cosR + 0.04 * this.sinR;
    const ry = localX * this.sinR - 0.04 * this.cosR;
    const py = ry * this.cosP - tipVz * this.sinP;
    const pz = ry * this.sinP + tipVz * this.cosP;
    const yx = rx * this.cosY + pz * this.sinY;
    const yz = -rx * this.sinY + pz * this.cosY;
    const camZ = 5.4 - yz;
    const persp = 4.6 / Math.max(1.2, camZ);
    const tipX = this.shipCenterX + yx * this.shipScale * persp;
    const tipY = this.shipCenterY - py * this.shipScale * persp;

    const plumeW = Math.max(4, this.shipScale * (0.13 + this.thrustPulse * 0.06));
    const nx = -this.sinR * plumeW;
    const ny = this.cosR * plumeW;

    ctx.beginPath();
    ctx.moveTo(tx - ny, ty + nx);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(tx + ny, ty - nx);
    ctx.closePath();
    ctx.fillStyle = palette.accentPrimary;
    ctx.globalAlpha = (isOverlayMode ? 0.55 : 0.82) * Math.min(1, 0.55 + this.thrustPulse * 0.45);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(tx - ny * 0.45, ty + nx * 0.45);
    ctx.lineTo((tx + tipX) * 0.5, (ty + tipY) * 0.5);
    ctx.lineTo(tx + ny * 0.45, ty - nx * 0.45);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = isOverlayMode ? 0.7 : 0.94;
    ctx.fill();
  }

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    timeSeconds: number,
    deltaSeconds: number,
    audio: AudioFrameMetrics,
    palette: LyricPalette,
    reduceMotion: boolean,
    isOverlayMode: boolean,
    variationId?: string,
    backgroundOpacity?: number,
    focalCenterX?: number,
    hasWebGlBackdrop = false,
    contentInsetLeft = 0
  ): void {
    this.contentInsetLeft = Number.isFinite(contentInsetLeft) ? Math.max(0, contentInsetLeft) : 0;
    if (variationId !== undefined || backgroundOpacity !== undefined) {
      setShip3DSceneHint(variationId, backgroundOpacity);
    }
    const varIdx = currentVariationIndex;
    const bgAlpha = currentBackgroundOpacity;
    const vigStrength = currentVignetteStrength;

    const rawDt = Math.max(0, Math.min(0.1, deltaSeconds));
    const bulletScale = this.bulletTimeTimer > 0 && !reduceMotion ? 0.24 : 1.0;
    const dt = rawDt * bulletScale;

    this.currentSceneTime = timeSeconds;
    this.currentReduceMotion = reduceMotion;
    const bpm = audio.estimatedBpm && audio.estimatedBpm > 30 ? audio.estimatedBpm : 120;
    this.currentBpmFactor = Math.max(0.72, Math.min(1.38, bpm / 120));

    // Decay gameplay, word mergeFlash, damped camera spring, & splash droplets
    this.wordPop = Math.max(0, this.wordPop - rawDt * 7.5);
    this.collectFlash = Math.max(0, this.collectFlash - rawDt * 5.2);
    this.collectLunge = Math.max(0, this.collectLunge - rawDt * 9.5);
    this.cameraTrauma = Math.max(0, this.cameraTrauma - rawDt * (this.cameraTrauma > 0.35 ? 1.8 : 4.2));
    this.chromaticPulse = Math.max(0, this.chromaticPulse - rawDt * 3.4);
    this.rainbowTimer = Math.max(0, this.rainbowTimer - rawDt);
    this.iceTimer = Math.max(0, this.iceTimer - rawDt);
    this.electricTimer = Math.max(0, this.electricTimer - rawDt);
    this.bulletTimeTimer = Math.max(0, this.bulletTimeTimer - rawDt);
    this.verticalBiasTimer = Math.max(0, this.verticalBiasTimer - rawDt);
    this.glitchPulse = Math.max(0, this.glitchPulse - rawDt * 4.5);
    this.toastAlpha = Math.max(0, this.toastAlpha - rawDt * 1.15);
    this.nearMissCooldown = Math.max(0, this.nearMissCooldown - rawDt);
    this.maneuverCooldown = Math.max(0, this.maneuverCooldown - rawDt);

    for (let i = 0; i < WORD_FLASH_POOL; i++) {
      if (this.wordFlashValues[i] > 0) {
        this.wordFlashValues[i] = Math.max(0, this.wordFlashValues[i] - rawDt / 0.45);
      }
    }

    if (reduceMotion) {
      this.cameraSpringPos = 0;
      this.cameraSpringVel = 0;
    } else {
      const springAcc = -48.0 * this.cameraSpringPos - 11.0 * this.cameraSpringVel;
      this.cameraSpringVel += springAcc * rawDt;
      this.cameraSpringPos += this.cameraSpringVel * rawDt;
    }

    for (let i = 0; i < SPLASH_DROPLET_POOL; i++) {
      const sb = i * 11;
      if (this.splashDroplets[sb] > 0.5) {
        this.splashDroplets[sb + 7] -= rawDt * 2.1;
        if (this.splashDroplets[sb + 7] <= 0) {
          this.splashDroplets[sb] = 0;
          this.splashDroplets[sb + 7] = 0;
        } else {
          this.splashDroplets[sb + 1] += this.splashDroplets[sb + 4] * dt;
          this.splashDroplets[sb + 2] += this.splashDroplets[sb + 5] * dt;
          this.splashDroplets[sb + 3] += this.splashDroplets[sb + 6] * dt;
          this.splashDroplets[sb + 4] *= 0.96;
          this.splashDroplets[sb + 5] *= 0.96;
        }
      }
    }

    const cx =
      typeof focalCenterX === 'number' && Number.isFinite(focalCenterX)
        ? focalCenterX
        : width * 0.5;
    const cy = height * 0.54;
    const stageSpan = Math.max(220, Math.min(width, Math.min(cx, width - cx) * 2));
    const fallbackFocal = Math.min(stageSpan * 0.68, height * 1.02) * (1.0 - this.warpSurge * 0.04);

    // Update Ship Position & Attitude directly from C-infinity analytical flight spline
    const curPos = this.getFlightPosition(timeSeconds, this.tmpFlightPos);
    const curVel = this.getFlightVelocity(timeSeconds, this.tmpFlightVel);
    const curAcc = this.getFlightAcceleration(timeSeconds, this.tmpFlightAcc);
    this.shipX = curPos.x;
    this.shipY = curPos.y;
    this.shipVx = curVel.x;
    this.shipVy = curVel.y;

    // Strong-beat warp surge & choreographed S-bank / barrel-roll detection
    this.surgeCooldown = Math.max(0, this.surgeCooldown - rawDt);
    const beatStrength = audio.beatStrength ?? (audio.beatDetected ? 1.0 : audio.bassEnergy);
    const strongBeat = !reduceMotion && (audio.beatDetected || beatStrength > 0.72);
    if (strongBeat && this.surgeCooldown <= 0) {
      this.warpSurge = 1.0;
      this.shockwaveProgress = 0.02;
      this.surgeCooldown = 0.24;
      this.cameraTrauma = Math.min(1.0, this.cameraTrauma + (beatStrength > 0.86 ? 0.58 : 0.34));
      this.chromaticPulse = Math.max(this.chromaticPulse, beatStrength > 0.85 ? 0.75 : 0.35);
      this.cameraSpringVel += 1.1;

      if (((audio as any).isDownbeat || beatStrength > 0.88) && this.maneuverKind === 0 && this.maneuverCooldown <= 0) {
        const dir = this.shipVx >= 0 ? 1 : -1;
        this.startChoreographedManeuver(beatStrength > 0.92 ? 1 : 2, 1.15, dir);
      }

      if (this.isInstrumental && beatStrength > 0.86) {
        this.fireTwinLasers(this.shipX, this.shipY);
      }
    } else {
      this.warpSurge = Math.max(0, this.warpSurge - rawDt * 2.8);
    }
    if (this.shockwaveProgress > 0) {
      this.shockwaveProgress += rawDt * 1.85;
      if (this.shockwaveProgress > 1.0) this.shockwaveProgress = 0;
    }

    if (reduceMotion) {
      this.maneuverKind = 0;
      this.maneuverProgress = 0;
      this.barrelRollActive = false;
      this.barrelRollPhase = 0;
      this.rollAngle = Math.atan2(curVel.x * 0.34 + curAcc.x * 0.22, 1.0);
      this.pitchAngle = 0.08 + Math.atan2(curVel.y * 0.32 + curAcc.y * 0.14, 1.0);
      this.yawAngle = -Math.atan2(curVel.x * 0.16, 1.0);
    } else {
      let maneuverRoll = 0;
      let maneuverPitch = 0;
      let maneuverYaw = 0;
      if (this.maneuverKind !== 0) {
        this.maneuverProgress += rawDt / this.maneuverDuration;
        if (this.maneuverProgress >= 1.0) {
          this.maneuverKind = 0;
          this.maneuverProgress = 0;
          this.barrelRollActive = false;
          this.barrelRollPhase = 0;
        } else {
          const elapsed = Math.max(0, Math.min(this.maneuverDuration, this.maneuverProgress * this.maneuverDuration));
          const rollDur = Math.max(0.4, this.maneuverDuration - MANEUVER_ANTICIPATION_SEC - MANEUVER_SETTLE_SEC);
          const rollEnd = MANEUVER_ANTICIPATION_SEC + rollDur;
          const quintic = (t: number) => t * t * t * (t * (6 * t - 15) + 10);

          if (elapsed < MANEUVER_ANTICIPATION_SEC) {
            // Phase 1: 160ms counter-bank anticipation (-12 deg)
            const q = quintic(elapsed / MANEUVER_ANTICIPATION_SEC);
            this.barrelRollPhase = -MANEUVER_ANTICIPATION_RAD * q;
            maneuverRoll = this.barrelRollPhase * this.maneuverDir;
            maneuverYaw = -0.06 * q * this.maneuverDir;
          } else if (elapsed < rollEnd) {
            // Phase 2: Silky quintic ease-in-out 360-deg barrel roll (1.05s - 1.25s)
            const u = (elapsed - MANEUVER_ANTICIPATION_SEC) / rollDur;
            const q = quintic(u);
            this.barrelRollPhase = -MANEUVER_ANTICIPATION_RAD + (2 * Math.PI + MANEUVER_ANTICIPATION_RAD) * q;
            maneuverRoll = this.barrelRollPhase * this.maneuverDir;
            if (this.maneuverKind === 2) {
              maneuverPitch = Math.sin(2 * Math.PI * q) * 0.14;
              maneuverYaw = Math.sin(Math.PI * q) * 0.12 * this.maneuverDir;
            } else {
              maneuverPitch = Math.sin(Math.PI * q) * 0.08;
            }
          } else {
            // Phase 3: Damped settling back onto natural spline bank angle
            const sNorm = (elapsed - rollEnd) / MANEUVER_SETTLE_SEC;
            const settleEnv = Math.exp(-5.5 * sNorm) * Math.sin(Math.PI * sNorm);
            this.barrelRollPhase = 2 * Math.PI;
            maneuverRoll = settleEnv * 0.09 * this.maneuverDir;
          }
        }
      }

      const bankFromDeriv = Math.atan2(curVel.x * 0.34 + curAcc.x * 0.22, 1.0);
      const pitchFromDeriv =
        0.08 +
        Math.atan2(curVel.y * 0.32 + curAcc.y * 0.14, 1.0) -
        audio.bassEnergy * 0.04 -
        this.warpSurge * 0.05;
      const yawFromDeriv = -Math.atan2(curVel.x * 0.16, 1.0);

      this.rollAngle = bankFromDeriv + maneuverRoll;
      this.pitchAngle = pitchFromDeriv + maneuverPitch;
      this.yawAngle = yawFromDeriv + maneuverYaw;
    }

    // Build upcoming 3D Lyric Word Anchors directly along the ship's nose centerline
    // Interval-sweep + micro-stagger queue guarantees zero skipped words at 180+ BPM
    this.gateProjectionCount = 0;
    const lyricT = this.currentLyricTime;
    const prevT = this.prevLyricTime;
    this.prevLyricTime = lyricT;

    if (!this.isInstrumental && this.precomputedWords.length > 0) {
      // Drain queued fast-burst word splashes with 30ms stagger
      for (let q = 0; q < STAGGER_QUEUE_SIZE; q++) {
        const wIdx = this.staggerWordIndices[q];
        if (wIdx < 0) continue;
        this.staggerDelays[q] -= rawDt;
        if (this.staggerDelays[q] <= 0) {
          this.staggerWordIndices[q] = -1;
          this.staggerDelays[q] = 0;
          if (this.staggerCount > 0) this.staggerCount--;
          if (wIdx < this.precomputedWords.length) {
            const qw = this.precomputedWords[wIdx];
            this.lastCollectedWordKey = qw.key;
            this.triggerWordCollection(qw, SHIP_NOSE_Z, reduceMotion, palette);
          }
        }
      }

      const sweepStart =
        prevT >= 0 && lyricT > prevT && lyricT - prevT < 1.5 ? prevT : lyricT - 0.04;
      let triggeredInFrame = 0;
      let lastProjStart = -1;
      let lastProjZ = 0;
      let fastAltIdx = 0;

      for (let i = 0; i < this.precomputedWords.length; i++) {
        const w = this.precomputedWords[i];
        const dtToWord = w.startSeconds - lyricT;
        if (dtToWord < -0.45) continue;
        if (dtToWord > GATE_LOOKAHEAD_SEC) break;

        let wordZ = SHIP_NOSE_Z - dtToWord * GATE_TRAVEL_SPEED;

        // Interval-sweep collision detection: never misses fast consecutive words between frames
        const inSweep = w.startSeconds > sweepStart && w.startSeconds <= lyricT;
        const inNoseWindow = dtToWord <= 0.025 && dtToWord >= -0.18;
        if ((inSweep || inNoseWindow) && w.key !== this.lastCollectedWordKey) {
          if (triggeredInFrame === 0) {
            this.lastCollectedWordKey = w.key;
            this.triggerWordCollection(w, wordZ, reduceMotion, palette);
          } else {
            // Queue simultaneous burst word with 30ms stagger so each splashes cleanly
            for (let slot = 0; slot < STAGGER_QUEUE_SIZE; slot++) {
              if (this.staggerWordIndices[slot] === i) break;
              if (this.staggerWordIndices[slot] < 0) {
                this.staggerWordIndices[slot] = i;
                this.staggerDelays[slot] = triggeredInFrame * 0.03;
                this.staggerCount++;
                break;
              }
            }
          }
          triggeredInFrame++;
        }

        if (this.gateProjectionCount < GATE_POOL) {
          const isTightCluster = lastProjStart >= 0 && w.startSeconds - lastProjStart < 0.22;
          if (isTightCluster) {
            wordZ = Math.min(wordZ, lastProjZ - 4.5);
            fastAltIdx++;
          } else {
            fastAltIdx = 0;
          }
          lastProjStart = w.startSeconds;
          lastProjZ = wordZ;

          const gp = this.gateProjections[this.gateProjectionCount++];
          const anchor = this.getFlightPosition(w.startSeconds, this.tmpFlightPos);
          const mergeFlash = this.getWordMergeFlash(w.key);
          const fastXOff = isTightCluster ? ((fastAltIdx & 1) === 0 ? 1 : -1) * 0.28 : 0;
          const fastYOff = isTightCluster ? (fastAltIdx % 2) * 0.22 : 0;
          const elevLift = 0.45 * Math.max(0, Math.min(1, dtToWord / 0.8));

          gp.text = w.text;
          gp.worldX = anchor.x + fastXOff;
          gp.worldY = anchor.y + elevLift + fastYOff;
          gp.worldZ = wordZ;
          gp.lineIndex = w.lineIndex;
          gp.wordIndex = w.wordIndex;
          gp.isActive = w.lineIndex === this.currentActiveLine && w.wordIndex === this.currentActiveWord;
          gp.semanticMask = w.semanticMask;
          gp.mergeFlash = mergeFlash;
          if (wordZ >= 5.2) {
            gp.alpha = 0;
          } else if (dtToWord < 0) {
            gp.alpha = Math.max(0, Math.min(1, 1.0 + dtToWord / 0.45));
          } else {
            gp.alpha = Math.max(0.08, Math.min(1, (GATE_LOOKAHEAD_SEC - dtToWord) / 0.65));
          }
          const invZ = 1.0 / Math.max(0.4, 6.2 - gp.worldZ);
          gp.screenX = cx + (gp.worldX - this.shipX * 0.12) * fallbackFocal * invZ;
          gp.screenY = cy - (gp.worldY + 0.14) * fallbackFocal * invZ;
          gp.scale = Math.max(0.55, Math.min(1.6, 7.2 * invZ));
        }
      }
    }

    const warpSpeed = reduceMotion
      ? 0.05
      : 0.42 * this.currentBpmFactor + audio.bassEnergy * 1.15 + this.warpSurge * 1.35;

    // Update Serene Starfield Z parallax
    const starSpeed = reduceMotion
      ? 0.025
      : 0.14 * this.currentBpmFactor + audio.bassEnergy * 0.22 + this.warpSurge * 0.65;
    for (let i = 0; i < STAR_COUNT; i++) {
      const idx = i * STAR_STRIDE;
      let z = this.stars[idx + 2] - starSpeed * dt;
      if (z <= 0.06) z += 1.94;
      this.stars[idx + 2] = z;
    }

    // Update Asteroids + Near-Miss Grazing + Hard Corridor Exclusion
    const astSpeed = reduceMotion ? 0.34 : warpSpeed * 1.45;
    this.lastAstWorldSpeed = Math.max(2.0, astSpeed * 6.2);
    const shipWX = this.shipX;
    const shipWY = this.shipY;

    for (let a = 0; a < ASTEROID_COUNT; a++) {
      const idx = a * ASTEROID_STRIDE;
      let az = this.asteroids[idx + 2] - astSpeed * dt;
      if (az <= 0.18) {
        this.spawnAsteroid(a);
        az = this.asteroids[idx + 2];
      } else {
        this.asteroids[idx + 2] = az;
        this.asteroids[idx] += this.asteroids[idx + 9] * dt;
        this.asteroids[idx + 1] += this.asteroids[idx + 10] * dt;
        this.asteroids[idx + 9] *= 0.94;
        this.asteroids[idx + 10] *= 0.94;
      }

      if (!reduceMotion) {
        this.asteroids[idx + 3] += this.asteroids[idx + 5] * dt;
        this.asteroids[idx + 4] += this.asteroids[idx + 5] * 0.7 * dt;
      }

      const astWX = this.asteroids[idx] * 5.2;
      const astWY = -0.25 + this.asteroids[idx + 1] * 3.4;
      const astWZ = 5.0 - az * 6.2;
      const astRad = this.asteroids[idx + 6] * 3.2;

      if (astWZ < SHIP_WORLD_Z + 1.0 && astWZ > -18.0) {
        const dx = astWX - shipWX;
        const dy = astWY - shipWY;
        const distXY = Math.hypot(dx, dy);

        // Near-Miss wingtip skim detection
        if (
          !reduceMotion &&
          this.nearMissCooldown <= 0 &&
          a !== this.lastNearMissAsteroid &&
          Math.abs(astWZ - SHIP_WORLD_Z) < 1.3 &&
          distXY < SHIP_WIDTH * 1.8 + astRad + 1.4 &&
          distXY >= SHIP_WIDTH * 1.4
        ) {
          this.lastNearMissAsteroid = a;
          this.nearMissCooldown = 0.9;
          this.nearMissCount += 1;
          this.score += 250;
          this.cameraTrauma = Math.min(1.0, this.cameraTrauma + 0.25);
          this.toastText = 'NEAR MISS +250';
          this.toastAlpha = 1.15;
          this.toastColorKind = 'gold';
          this.emitSparks(shipWX + (dx >= 0 ? 1.1 : -1.1), shipWY, SHIP_WORLD_Z, 10, 1.0, 0.84, 0.28);
        }
      }
      this.astOrder[a] = a;
    }

    // Guaranteed zero asteroid-to-asteroid clipping & zero corridor/lyric collisions
    for (let pass = 0; pass < 2; pass++) {
      this.separateAsteroids(dt);
      for (let a = 0; a < ASTEROID_COUNT; a++) {
        this.enforceCorridorExclusion(a, timeSeconds);
      }
    }

    const targetThrust = Math.min(
      1.35,
      (audio.beatDetected ? 1.0 : audio.bassEnergy * 0.85 + audio.rmsLevel * 0.35) +
        this.warpSurge * 0.45 +
        this.collectFlash * 0.35
    );
    this.thrustPulse += (targetThrust - this.thrustPulse) * Math.min(1, rawDt * 12);

    if (!this.threeInitAttempted) {
      this.tryInitThree();
    }

    if (this.threeActive && this.threeState) {
      this.renderThree(
        ctx,
        width,
        height,
        timeSeconds,
        dt,
        audio,
        palette,
        reduceMotion,
        isOverlayMode,
        varIdx,
        warpSpeed,
        cx
      );
      return;
    }

    // Software Canvas2D Fallback (Headless Node unit tests / no WebGL)
    const focal = fallbackFocal;
    this.frameWidth = width;
    this.frameHeight = height;
    this.frameCx = cx;
    this.frameCy = cy;
    this.frameFocal = focal;
    this.frameVarIdx = varIdx;
    this.frameIsOverlay = isOverlayMode;

    if (!isOverlayMode && !hasWebGlBackdrop) {
      ctx.save();
      ctx.globalAlpha = bgAlpha;
      const bg = ctx.createRadialGradient(cx, height * 0.36, 12, cx, cy, Math.max(width, height) * 0.86);
      if (varIdx === 2) {
        bg.addColorStop(0, '#090618');
        bg.addColorStop(0.55, '#05030d');
        bg.addColorStop(1, '#020206');
      } else {
        bg.addColorStop(0, palette.bgMid);
        bg.addColorStop(0.55, palette.bgDeep);
        bg.addColorStop(1, '#03050b');
      }
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      if (varIdx === 1) {
        const driftX = reduceMotion ? 0 : Math.sin(timeSeconds * 0.25) * stageSpan * 0.08;
        const neb1 = ctx.createRadialGradient(
          cx - stageSpan * 0.15 + driftX,
          height * 0.38,
          16,
          cx - stageSpan * 0.15 + driftX,
          height * 0.38,
          Math.max(width, height) * 0.52
        );
        neb1.addColorStop(0, palette.accentPrimary);
        neb1.addColorStop(0.5, palette.accentSecondary);
        neb1.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.globalAlpha = bgAlpha * (0.22 + audio.rmsLevel * 0.14);
        ctx.fillStyle = neb1;
        ctx.fillRect(0, 0, width, height);
      } else if (varIdx === 2) {
        const gridHorizonY = height * 0.62;
        ctx.strokeStyle = palette.accentPrimary;
        ctx.lineWidth = 1;
        for (let r = -8; r <= 8; r++) {
          ctx.globalAlpha = bgAlpha * 0.16;
          ctx.beginPath();
          ctx.moveTo(cx + r * stageSpan * 0.02, gridHorizonY);
          ctx.lineTo(cx + r * stageSpan * 0.12, height);
          ctx.stroke();
        }
        const phase = reduceMotion ? 0 : (timeSeconds * warpSpeed * 0.8) % 1;
        for (let row = 0; row < 6; row++) {
          const t = (row + phase) / 6;
          const gy = gridHorizonY + t * t * (height - gridHorizonY);
          ctx.globalAlpha = bgAlpha * (0.06 + t * 0.2);
          ctx.beginPath();
          ctx.moveTo(0, gy);
          ctx.lineTo(width, gy);
          ctx.stroke();
        }
      }

      if (vigStrength > 0.01) {
        const vig = ctx.createRadialGradient(
          cx,
          height * 0.5,
          Math.min(width, height) * 0.28,
          cx,
          height * 0.5,
          Math.max(width, height) * 0.8
        );
        vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
        vig.addColorStop(1, `rgba(2, 3, 8, ${(0.72 * vigStrength).toFixed(3)})`);
        ctx.globalAlpha = 1;
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, width, height);
      }
      ctx.restore();
    }

    // Software fallback serene twinkling pinpoint stars (and subtle warp streak ONLY when warpSurge > 0.15)
    ctx.save();
    const showSwStreaks = !reduceMotion && this.warpSurge > 0.15;
    const swStreakFactor = showSwStreaks ? (this.warpSurge - 0.15) * 0.095 : 0;
    const swStride = Math.max(1, Math.floor(STAR_COUNT / WARP_STREAK_COUNT));
    for (let i = 0; i < STAR_COUNT; i++) {
      const idx = i * STAR_STRIDE;
      const z = this.stars[idx + 2];
      const invZ = 1.0 / z;
      const sx = cx + this.stars[idx] * focal * invZ;
      const sy = cy + this.stars[idx + 1] * focal * invZ;
      if (sx < -24 || sx > width + 24 || sy < -24 || sy > height + 24) continue;

      const phase = this.stars[idx + 4];
      const twinkle = reduceMotion
        ? 0.9
        : 0.68 + 0.32 * Math.sin(timeSeconds * (0.95 + (phase % 1.85)) + phase);
      const alpha = Math.min(1, (2.02 - z) * 0.62) * twinkle * (isOverlayMode ? 0.55 : 0.92);
      const radius = Math.max(0.55, Math.min(2.6, this.stars[idx + 3] * invZ * 0.55));
      const ck = this.stars[idx + 5];
      const starCol = ck < 0.55 ? '#f8fafc' : ck < 0.80 ? '#cfe4ff' : '#ffe4b5';

      if (showSwStreaks && i % swStride === 0 && z > 0.45) {
        const prevZ = z + swStreakFactor;
        const px = cx + (this.stars[idx] * focal) / prevZ;
        const py = cy + (this.stars[idx + 1] * focal) / prevZ;
        ctx.strokeStyle = starCol;
        ctx.globalAlpha = alpha * Math.min(0.65, (this.warpSurge - 0.15) * 0.7);
        ctx.lineWidth = Math.min(1.8, radius * 0.9);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(sx, sy);
        ctx.stroke();
      }

      ctx.fillStyle = starCol;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Software fallback liquid-starlight splash droplets
    for (let i = 0; i < SPLASH_DROPLET_POOL; i++) {
      const sb = i * 11;
      const life = this.splashDroplets[sb + 7];
      if (this.splashDroplets[sb] < 0.5 || life <= 0) continue;
      const dz = Math.max(0.5, 5.95 - this.splashDroplets[sb + 3]);
      const invZ = 1.0 / dz;
      const dx = cx + this.splashDroplets[sb + 1] * focal * invZ;
      const dy = cy - (this.splashDroplets[sb + 2] - 0.24) * focal * invZ;
      if (dx < -20 || dx > width + 20 || dy < -20 || dy > height + 20) continue;
      const r = Math.max(1.2, (1.5 + life * 3.2) * invZ * 4.5);
      const cr = Math.min(255, Math.round(this.splashDroplets[sb + 8] * 255));
      const cg = Math.min(255, Math.round(this.splashDroplets[sb + 9] * 255));
      const cb = Math.min(255, Math.round(this.splashDroplets[sb + 10] * 255));
      ctx.fillStyle = `rgb(${cr}, ${cg}, ${cb})`;
      ctx.globalAlpha = life * (isOverlayMode ? 0.65 : 0.9);
      ctx.beginPath();
      ctx.arc(dx, dy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Sort asteroids back-to-front by Z
    for (let i = 1; i < ASTEROID_COUNT; i++) {
      const key = this.astOrder[i];
      const keyZ = this.asteroids[key * ASTEROID_STRIDE + 2];
      let j = i - 1;
      while (j >= 0 && this.asteroids[this.astOrder[j] * ASTEROID_STRIDE + 2] < keyZ) {
        this.astOrder[j + 1] = this.astOrder[j];
        j--;
      }
      this.astOrder[j + 1] = key;
    }

    this.renderAsteroidsInRange(ctx, palette, 1.25, 99);

    const shipWorldZ = SHIP_WORLD_Z - this.warpSurge * 0.28 - this.collectLunge * 0.14;
    const shipInvZ = 1.0 / Math.max(0.5, 5.95 - shipWorldZ);
    this.shipCenterX = cx + this.shipX * focal * shipInvZ;
    this.shipCenterY = cy - (this.shipY - 0.24) * focal * shipInvZ;
    this.shipScale = Math.min(stageSpan, height) * 0.13;

    this.cosR = Math.cos(this.rollAngle);
    this.sinR = Math.sin(this.rollAngle);
    this.cosP = Math.cos(this.pitchAngle);
    this.sinP = Math.sin(this.pitchAngle);
    this.cosY = Math.cos(this.yawAngle);
    this.sinY = Math.sin(this.yawAngle);

    for (let v = 0; v < VERT_COUNT; v++) {
      this.projectLocalPoint(
        SHIP_VERTS[v * 3],
        SHIP_VERTS[v * 3 + 1],
        SHIP_VERTS[v * 3 + 2],
        v
      );
    }

    for (let f = 0; f < FACE_COUNT; f++) {
      const base = f * 5;
      const i0 = SHIP_FACES[base] | 0;
      const i1 = SHIP_FACES[base + 1] | 0;
      const i2 = SHIP_FACES[base + 2] | 0;
      this.faceDepth[f] = (this.projZ[i0] + this.projZ[i1] + this.projZ[i2]) / 3;
      this.faceOrder[f] = f;
    }
    for (let i = 1; i < FACE_COUNT; i++) {
      const key = this.faceOrder[i];
      const keyD = this.faceDepth[key];
      let j = i - 1;
      while (j >= 0 && this.faceDepth[this.faceOrder[j]] < keyD) {
        this.faceOrder[j + 1] = this.faceOrder[j];
        j--;
      }
      this.faceOrder[j + 1] = key;
    }

    ctx.save();
    if (this.shockwaveProgress > 0 && !reduceMotion) {
      const midThrusterX = (this.projX[6] + this.projX[7]) * 0.5;
      const midThrusterY = (this.projY[6] + this.projY[7]) * 0.5;
      const ringRx = this.shipScale * (0.45 + this.shockwaveProgress * 2.4);
      const ringRy = ringRx * 0.52;
      ctx.strokeStyle = palette.accentPrimary;
      ctx.lineWidth = Math.max(1.2, 4.0 * (1 - this.shockwaveProgress));
      ctx.globalAlpha = (1 - this.shockwaveProgress) * (isOverlayMode ? 0.5 : 0.78);
      ctx.beginPath();
      ctx.ellipse(midThrusterX, midThrusterY, ringRx, ringRy, this.rollAngle * 0.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    this.plumeLength = 0.75 + this.thrustPulse * 0.95 + this.warpSurge * 0.85;
    this.drawThrusterPlume(ctx, palette, 6, -0.54);
    this.drawThrusterPlume(ctx, palette, 7, 0.54);

    for (let k = 0; k < FACE_COUNT; k++) {
      const f = this.faceOrder[k];
      const base = f * 5;
      const i0 = SHIP_FACES[base] | 0;
      const i1 = SHIP_FACES[base + 1] | 0;
      const i2 = SHIP_FACES[base + 2] | 0;
      const partKind = SHIP_FACES[base + 4] | 0;

      ctx.beginPath();
      ctx.moveTo(this.projX[i0], this.projY[i0]);
      ctx.lineTo(this.projX[i1], this.projY[i1]);
      ctx.lineTo(this.projX[i2], this.projY[i2]);
      ctx.closePath();

      if (varIdx === 2) {
        ctx.fillStyle = partKind === 2 ? 'rgba(7, 18, 30, 0.92)' : 'rgba(4, 5, 11, 0.94)';
        ctx.globalAlpha = isOverlayMode ? 0.85 : 0.96;
        ctx.fill();
        ctx.strokeStyle = partKind === 2 ? '#22d3ee' : palette.accentPrimary;
        ctx.globalAlpha = 0.88;
        ctx.lineWidth = partKind === 2 ? 1.5 : 1.2;
        ctx.stroke();
      } else if (partKind === 2) {
        ctx.fillStyle = palette.accentPrimary;
        ctx.globalAlpha = isOverlayMode ? 0.62 : 0.78;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = 1.1;
        ctx.stroke();
      } else {
        ctx.fillStyle = SHIP_FACE_FILLS[f];
        ctx.globalAlpha = isOverlayMode ? 0.8 : 0.95;
        ctx.fill();
        ctx.strokeStyle = partKind === 1 ? palette.accentSecondary : palette.accentPrimary;
        ctx.globalAlpha = 0.4 + this.thrustPulse * 0.24;
        ctx.lineWidth = 1.05;
        ctx.stroke();
      }
    }

    const navPulse = 0.7 + 0.3 * Math.sin(timeSeconds * 6.0);
    const navRadius = Math.max(2.2, this.shipScale * 0.055);
    ctx.fillStyle = '#ff3b5c';
    ctx.globalAlpha = navPulse;
    ctx.beginPath();
    ctx.arc(this.projX[4], this.projY[4], navRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#22d3ee';
    ctx.globalAlpha = navPulse;
    ctx.beginPath();
    ctx.arc(this.projX[5], this.projY[5], navRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
    this.renderAsteroidsInRange(ctx, palette, 0.18, 1.25);
  }

  private disposeThree(): void {
    const st = this.threeState;
    if (!st) return;
    if (typeof st.canvas.removeEventListener === 'function') {
      st.canvas.removeEventListener('webglcontextlost', this.boundContextLost);
    }
    for (let i = 0; i < st.disposables.length; i++) {
      st.disposables[i].dispose();
    }
    try {
      st.renderer.dispose();
    } catch {
      // Ignore WebGL disposal errors during shutdown
    }
    this.threeState = null;
    this.threeActive = false;
  }

  dispose(): void {
    this.disposeThree();
    this.targetCanvas = null;
    if (activeShip3DSceneRef === this) {
      activeShip3DSceneRef = null;
    }
  }
}
