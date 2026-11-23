// Procedural 3D Starfield + Real Three.js WebGL Multi-Part Starfighter & Procedural Cratered Asteroids.
// Pre-allocates all Three.js geometries, materials, typed arrays, and scratch objects for zero per-frame heap allocations.
// Includes graceful Canvas2D software fallback when WebGL is unavailable (e.g. headless Node unit tests).

import * as THREE from 'three';
import type { AudioFrameMetrics, LyricPalette } from '../core/models';
import { parseColorToRgbInto } from './webGlEffectLayer';

const STAR_COUNT = 260;
const STAR_STRIDE = 4; // x, y, z, size

const ASTEROID_COUNT = 24;
const ASTEROID_STRIDE = 9; // x, y, z, rx, ry, rotSpeed, scale, variantIdx, seedStretch
const ASTEROID_VARIANTS = 7;

const DEBRIS_COUNT = 220;
const TRAIL_SEGMENTS = 36;
const SHOCKWAVE_POOL = 3;

// Module-level hint synchronized by StarfieldShip3DStyle before/during render
let currentVariationIndex: 0 | 1 | 2 = 0;
let currentBackgroundOpacity = 0.95;
let currentVignetteStrength = 0.55;

export function setShip3DSceneHint(
  variationId?: string,
  backgroundOpacity?: number,
  vignetteStrength?: number
): void {
  if (variationId === 'nebula-run') currentVariationIndex = 1;
  else if (variationId === 'retro-wireframe') currentVariationIndex = 2;
  else currentVariationIndex = 0;

  if (typeof backgroundOpacity === 'number' && Number.isFinite(backgroundOpacity)) {
    currentBackgroundOpacity = Math.max(0, Math.min(1, backgroundOpacity));
  }
  if (typeof vignetteStrength === 'number' && Number.isFinite(vignetteStrength)) {
    currentVignetteStrength = Math.max(0, Math.min(1, vignetteStrength));
  }
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
// Deterministic 3D FBM Noise & Procedural Cratered Asteroid Geometry Builder
// ---------------------------------------------------------------------------

function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 2147483647) + Math.imul(seed, 1274126177)) | 0;
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

  // Deterministic crater centers per variant
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
// Sculpted Tapered Starfighter Fuselage & Plasma Shader Helpers
// ---------------------------------------------------------------------------

function createSculptedFuselageGeometry(): THREE.BufferGeometry {
  // 7 cross-section stations along Z (-2.65 nose to +1.36 aft), 8 vertices per ring
  const stations = [
    { z: -2.65, rx: 0.035, ryTop: 0.025, ryBot: -0.02, yOff: -0.02 },
    { z: -1.85, rx: 0.24, ryTop: 0.14, ryBot: -0.1, yOff: -0.01 },
    { z: -0.95, rx: 0.42, ryTop: 0.24, ryBot: -0.18, yOff: 0.0 },
    { z: -0.1, rx: 0.56, ryTop: 0.28, ryBot: -0.22, yOff: 0.02 },
    { z: 0.68, rx: 0.6, ryTop: 0.27, ryBot: -0.22, yOff: 0.02 },
    { z: 1.26, rx: 0.52, ryTop: 0.22, ryBot: -0.19, yOff: 0.0 },
    { z: 1.38, rx: 0.42, ryTop: 0.16, ryBot: -0.14, yOff: 0.0 },
  ];
  // 8 profile points around cross section (CCW looking from +Z toward -Z)
  const ringPts = [
    [0.0, 1.0],    // 0: dorsal ridge
    [0.62, 0.72],  // 1: upper stbd shoulder
    [1.0, 0.12],   // 2: stbd chine
    [0.72, -0.68], // 3: lower stbd keel
    [0.0, -1.0],   // 4: ventral keel
    [-0.72, -0.68],// 5: lower port keel
    [-1.0, 0.12],  // 6: port chine
    [-0.62, 0.72], // 7: upper port shoulder
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

  // Cap aft transom
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
        // ConeGeometry translated so base is at y=0 and apex tip is at y=-1
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

// ---------------------------------------------------------------------------
// Three.js Scene Bundle Interface (disposed cleanly on teardown)
// ---------------------------------------------------------------------------

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
  shipWireOverlays: THREE.LineSegments[];
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
  shockwaveState: Float32Array; // [active, progress, x, y, z] per slot
  asteroidGeoms: THREE.BufferGeometry[];
  asteroidEdgeGeoms: THREE.EdgesGeometry[];
  asteroidMeshes: THREE.Mesh[];
  asteroidWireMeshes: THREE.LineSegments[];
  asteroidBasaltMat: THREE.MeshStandardMaterial;
  asteroidWireMat: THREE.LineBasicMaterial;
  starPositions: Float32Array;
  starColors: Float32Array;
  starGeom: THREE.BufferGeometry;
  starMat: THREE.LineBasicMaterial;
  debrisOffsets: Float32Array;
  debrisPositions: Float32Array;
  debrisGeom: THREE.BufferGeometry;
  debrisMat: THREE.PointsMaterial;
  nebulaMeshes: THREE.Mesh[];
  nebulaMats: THREE.MeshBasicMaterial[];
  nebulaTex: THREE.CanvasTexture | null;
  retroGrid: THREE.LineSegments;
  retroGridPositions: Float32Array;
  retroGridMat: THREE.LineBasicMaterial;
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

  // Pre-allocated scratch buffers (zero per-frame heap allocations)
  private readonly tmpRgbA = new Float32Array(3);
  private readonly tmpRgbB = new Float32Array(3);
  private readonly tmpRgbC = new Float32Array(3);
  private readonly tmpColorA = new THREE.Color();
  private readonly tmpColorB = new THREE.Color();
  private readonly tmpColorC = new THREE.Color();
  private readonly tmpVecA = new THREE.Vector3();
  private readonly tmpVecB = new THREE.Vector3();

  private prngSeed = 0x5f3759df;
  private shipX = 0;
  private shipY = 0;
  private shipVx = 0;
  private shipVy = 0;
  private rollAngle = 0;
  private pitchAngle = 0;
  private yawAngle = 0;
  private barrelRollPhase = 0;
  private barrelRollActive = false;
  private thrustPulse = 0;
  private warpSurge = 0;
  private shockwaveProgress = 0;
  private surgeCooldown = 0;

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
      this.stars[idx] = (this.nextRand() - 0.5) * 3.0;
      this.stars[idx + 1] = (this.nextRand() - 0.5) * 2.0;
      this.stars[idx + 2] = 0.08 + this.nextRand() * 1.92;
      this.stars[idx + 3] = 0.6 + this.nextRand() * 1.6;
    }

    for (let a = 0; a < ASTEROID_COUNT; a++) {
      this.spawnAsteroid(a, 0.8 + (a / ASTEROID_COUNT) * 6.8);
      this.astOrder[a] = a;
    }

    for (let f = 0; f < FACE_COUNT; f++) {
      this.faceOrder[f] = f;
    }
  }

  private spawnAsteroid(index: number, zOverride?: number): void {
    const idx = index * ASTEROID_STRIDE;
    const lane = (index % 5) - 2;
    this.asteroids[idx] = lane * 0.42 + (this.nextRand() - 0.5) * 0.55;
    this.asteroids[idx + 1] = (this.nextRand() - 0.42) * 0.95;
    this.asteroids[idx + 2] = zOverride ?? (5.6 + this.nextRand() * 3.2);
    this.asteroids[idx + 3] = this.nextRand() * Math.PI * 2;
    this.asteroids[idx + 4] = this.nextRand() * Math.PI * 2;
    this.asteroids[idx + 5] = (this.nextRand() - 0.5) * 2.4;
    this.asteroids[idx + 6] = 0.09 + this.nextRand() * 0.14;
    this.asteroids[idx + 7] = index % ASTEROID_VARIANTS;
    this.asteroids[idx + 8] = 0.78 + this.nextRand() * 0.46;
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

    const camera = new THREE.PerspectiveCamera(52, this.width / Math.max(1, this.height), 0.1, 160);
    camera.position.set(0, 0.72, 5.75);
    camera.lookAt(0, -0.18, -4.5);

    // 3-Point Space Lighting
    const keyLight = new THREE.DirectionalLight(0xdbeafe, 2.35);
    keyLight.position.set(6, 9, 8);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x5eead4, 2.1);
    rimLight.position.set(-7, 2.5, -10);
    scene.add(rimLight);

    const rimPointLight = new THREE.PointLight(0x818cf8, 5.0, 24);
    rimPointLight.position.set(3.8, 1.4, -4.2);
    scene.add(rimPointLight);

    const hemiLight = new THREE.HemisphereLight(0x818cf8, 0x060913, 0.74);
    scene.add(hemiLight);

    // Sculpted Multi-Part Starfighter
    const shipGroup = new THREE.Group();
    const shipWireOverlays: THREE.LineSegments[] = [];

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

    // Fuselage & beveled nose probe
    const fuselageGeom = createSculptedFuselageGeometry();
    const fuselageEdgeGeom = new THREE.EdgesGeometry(fuselageGeom, 24);
    const fuselageMesh = new THREE.Mesh(fuselageGeom, titaniumMat);
    const fuselageWire = new THREE.LineSegments(fuselageEdgeGeom, shipWireMat);
    shipGroup.add(fuselageMesh);
    shipGroup.add(fuselageWire);
    shipWireOverlays.push(fuselageWire);
    disposables.push(fuselageGeom, fuselageEdgeGeom);

    const noseProbeGeom = new THREE.ConeGeometry(0.032, 0.42, 6);
    noseProbeGeom.rotateX(-Math.PI / 2);
    const noseProbe = new THREE.Mesh(noseProbeGeom, panelAccentMat);
    noseProbe.position.set(0, -0.02, -2.84);
    shipGroup.add(noseProbe);
    disposables.push(noseProbeGeom);

    // Subtle dorsal panel-line spine rib & aft deck plate
    const spineGeom = new THREE.BoxGeometry(0.14, 0.06, 1.32);
    const spineMesh = new THREE.Mesh(spineGeom, panelAccentMat);
    spineMesh.position.set(0, 0.26, 0.56);
    shipGroup.add(spineMesh);
    disposables.push(spineGeom);

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
    const intakeEdgeGeom = new THREE.EdgesGeometry(intakeGeom, 24);
    const intakeInnerGeom = new THREE.BoxGeometry(0.16, 0.14, 0.08);

    for (const side of [-1, 1] as const) {
      const intake = new THREE.Mesh(intakeGeom, darkGunmetalMat);
      intake.position.set(side * 0.44, -0.01, -0.12);
      if (side < 0) intake.scale.x = -1;
      shipGroup.add(intake);

      const intakeWire = new THREE.LineSegments(intakeEdgeGeom, shipWireMat);
      intakeWire.position.copy(intake.position);
      intakeWire.scale.copy(intake.scale);
      shipGroup.add(intakeWire);
      shipWireOverlays.push(intakeWire);

      const intakeRecess = new THREE.Mesh(intakeInnerGeom, trimEmissiveMat);
      intakeRecess.position.set(side * 0.56, 0.0, -0.58);
      shipGroup.add(intakeRecess);
    }
    disposables.push(intakeGeom, intakeEdgeGeom, intakeInnerGeom);

    // Inner glowing instrument console + cockpit tub + glossy tinted canopy
    const tubGeom = new THREE.BoxGeometry(0.32, 0.12, 0.82);
    const tubMesh = new THREE.Mesh(tubGeom, darkGunmetalMat);
    tubMesh.position.set(0, 0.22, -0.35);
    shipGroup.add(tubMesh);

    const consoleGeom = new THREE.BoxGeometry(0.22, 0.06, 0.26);
    const consoleMesh = new THREE.Mesh(consoleGeom, cockpitGlowMat);
    consoleMesh.position.set(0, 0.28, -0.52);
    consoleMesh.rotation.x = 0.35;
    shipGroup.add(consoleMesh);

    const canopyGeom = new THREE.SphereGeometry(0.3, 20, 14);
    canopyGeom.scale(0.76, 0.56, 2.2);
    const canopyMesh = new THREE.Mesh(canopyGeom, canopyGlassMat);
    canopyMesh.position.set(0, 0.27, -0.32);
    shipGroup.add(canopyMesh);

    const canopyBowGeom = new THREE.TorusGeometry(0.21, 0.016, 8, 16, Math.PI);
    const canopyBow = new THREE.Mesh(canopyBowGeom, darkGunmetalMat);
    canopyBow.position.set(0, 0.26, -0.08);
    shipGroup.add(canopyBow);
    disposables.push(tubGeom, consoleGeom, canopyGeom, canopyBowGeom);

    // Swept Delta Wings + Wingtip Pods + Blinking Beacons
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0.0, -0.45);
    wingShape.lineTo(1.78, 0.78);
    wingShape.lineTo(1.86, 1.24);
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
    const wingEdgeGeom = new THREE.EdgesGeometry(wingGeom, 24);
    const podGeom = new THREE.CylinderGeometry(0.048, 0.058, 0.58, 10);
    podGeom.rotateX(Math.PI / 2);
    const beaconGeom = new THREE.SphereGeometry(0.052, 10, 8);
    const wingStripGeom = new THREE.BoxGeometry(1.18, 0.016, 0.032);

    for (const side of [-1, 1] as const) {
      const wingPivot = new THREE.Group();
      wingPivot.position.set(side * 0.44, 0.0, 0.05);
      wingPivot.rotation.z = -side * 0.06;

      const wing = new THREE.Mesh(wingGeom, titaniumMat);
      if (side < 0) wing.scale.x = -1;
      wingPivot.add(wing);

      const wingWire = new THREE.LineSegments(wingEdgeGeom, shipWireMat);
      if (side < 0) wingWire.scale.x = -1;
      wingPivot.add(wingWire);
      shipWireOverlays.push(wingWire);

      const strip = new THREE.Mesh(wingStripGeom, trimEmissiveMat);
      strip.position.set(side * 0.88, 0.025, 0.52);
      strip.rotation.y = -side * 0.52;
      wingPivot.add(strip);

      const pod = new THREE.Mesh(podGeom, darkGunmetalMat);
      pod.position.set(side * 1.84, -0.01, 0.98);
      wingPivot.add(pod);

      const beacon = new THREE.Mesh(beaconGeom, side < 0 ? portBeaconMat : stbdBeaconMat);
      beacon.position.set(side * 1.85, -0.01, 1.28);
      wingPivot.add(beacon);

      shipGroup.add(wingPivot);
    }
    disposables.push(wingGeom, wingEdgeGeom, podGeom, beaconGeom, wingStripGeom);

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
    const finEdgeGeom = new THREE.EdgesGeometry(finGeom, 24);

    for (const side of [-1, 1] as const) {
      const fin = new THREE.Mesh(finGeom, panelAccentMat);
      fin.position.set(side * 0.44, 0.14, 0.54);
      fin.rotation.z = -side * 0.36;
      shipGroup.add(fin);

      const finWire = new THREE.LineSegments(finEdgeGeom, shipWireMat);
      finWire.position.copy(fin.position);
      finWire.rotation.copy(fin.rotation);
      shipGroup.add(finWire);
      shipWireOverlays.push(finWire);
    }
    disposables.push(finGeom, finEdgeGeom);

    // Twin Recessed Rear Thruster Nozzles + Volumetric Tapered Additive Plasma Cones
    const nozzleOuterGeom = new THREE.CylinderGeometry(0.18, 0.22, 0.34, 16, 1, true);
    nozzleOuterGeom.rotateX(Math.PI / 2);
    const nozzleCoreGeom = new THREE.CircleGeometry(0.14, 16);

    // ConeGeometry translated so base (y=0) sits inside nozzle and tip (y=-1) extends along +Z
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

      const core = new THREE.Mesh(nozzleCoreGeom, trimEmissiveMat);
      core.position.set(xPos, -0.02, 1.36);
      shipGroup.add(core);

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
      nozzleCoreGeom,
      innerConeGeom,
      outerConeGeom,
      innerPlumeMat,
      outerPlumeMat
    );

    shipGroup.position.set(0, -0.6, 0.35);
    scene.add(shipGroup);

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

    // Pre-allocated Expanding Additive Shockwave Rings
    const shockGeom = new THREE.RingGeometry(0.76, 1.0, 32);
    const shockwaveMeshes: THREE.Mesh[] = [];
    const shockwaveMats: THREE.MeshBasicMaterial[] = [];
    const shockwaveState = new Float32Array(SHOCKWAVE_POOL * 5);
    for (let i = 0; i < SHOCKWAVE_POOL; i++) {
      const smat = new THREE.MeshBasicMaterial({
        color: 0x5eead4,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const smesh = new THREE.Mesh(shockGeom, smat);
      smesh.visible = false;
      scene.add(smesh);
      shockwaveMeshes.push(smesh);
      shockwaveMats.push(smat);
      disposables.push(smat);
    }
    disposables.push(shockGeom);

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
      opacity: 0.72,
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

    // Parallax Hyperspace Star Streaks (LineSegments)
    const starPositions = new Float32Array(STAR_COUNT * 2 * 3);
    const starColors = new Float32Array(STAR_COUNT * 2 * 3);
    const starGeom = new THREE.BufferGeometry();
    starGeom.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starGeom.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
    const starMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const starLines = new THREE.LineSegments(starGeom, starMat);
    starLines.frustumCulled = false;
    scene.add(starLines);
    disposables.push(starGeom, starMat);

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
      color: 0xdbeafe,
      size: 0.055,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const debrisPoints = new THREE.Points(debrisGeom, debrisMat);
    debrisPoints.frustumCulled = false;
    scene.add(debrisPoints);
    disposables.push(debrisGeom, debrisMat);

    // Nebula Run Volumetric Translucent Additive Clouds
    const nebulaTex = createNebulaCloudTexture();
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

    // Retro Wireframe Scrolling Horizon Perspective Grid
    const gridCols = 16;
    const gridRows = 14;
    const gridSegCount = gridCols + 1 + (gridRows + 1);
    const retroGridPositions = new Float32Array(gridSegCount * 2 * 3);
    const retroGridGeom = new THREE.BufferGeometry();
    retroGridGeom.setAttribute('position', new THREE.BufferAttribute(retroGridPositions, 3));
    const retroGridMat = new THREE.LineBasicMaterial({
      color: 0x5eead4,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const retroGrid = new THREE.LineSegments(retroGridGeom, retroGridMat);
    retroGrid.visible = false;
    retroGrid.frustumCulled = false;
    scene.add(retroGrid);
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
      shipWireOverlays,
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
      asteroidGeoms,
      asteroidEdgeGeoms,
      asteroidMeshes,
      asteroidWireMeshes,
      asteroidBasaltMat,
      asteroidWireMat,
      starPositions,
      starColors,
      starGeom,
      starMat,
      debrisOffsets,
      debrisPositions,
      debrisGeom,
      debrisMat,
      nebulaMeshes,
      nebulaMats,
      nebulaTex,
      retroGrid,
      retroGridPositions,
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
    this.shipY = 0;
    this.shipVx = 0;
    this.shipVy = 0;
    this.rollAngle = 0;
    this.pitchAngle = 0;
    this.yawAngle = 0;
    this.barrelRollPhase = 0;
    this.barrelRollActive = false;
    this.thrustPulse = 0;
    this.warpSurge = 0;
    this.shockwaveProgress = 0;
    this.surgeCooldown = 0;
    if (this.threeState) {
      this.threeState.trailInitialized = false;
      this.threeState.shockwaveState.fill(0);
    }
    this.initScene();
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

    // Parse palette colors with zero per-frame allocations
    parseColorToRgbInto(palette.accentPrimary, this.tmpRgbA);
    parseColorToRgbInto(palette.accentSecondary, this.tmpRgbB);
    parseColorToRgbInto(palette.bgDeep, this.tmpRgbC);
    this.tmpColorA.setRGB(this.tmpRgbA[0], this.tmpRgbA[1], this.tmpRgbA[2]);
    this.tmpColorB.setRGB(this.tmpRgbB[0], this.tmpRgbB[1], this.tmpRgbB[2]);
    this.tmpColorC.setRGB(this.tmpRgbC[0], this.tmpRgbC[1], this.tmpRgbC[2]);

    // Shift frustum optical axis smoothly to focalCenterX without clipping edge-to-edge stars
    if (Math.abs(cx - width * 0.5) > 1.0) {
      st.camera.setViewOffset(width, height, width * 0.5 - cx, 0, width, height);
    } else {
      st.camera.clearViewOffset();
    }
    const targetFov = 52 + this.warpSurge * 10;
    if (Math.abs(st.camera.fov - targetFov) > 0.05) {
      st.camera.fov = targetFov;
      st.camera.updateProjectionMatrix();
    }

    // Update 3-point space lights & FogExp2 deep-space haze
    st.rimLight.color.copy(this.tmpColorA);
    st.rimLight.intensity = (varIdx === 1 ? 2.8 : 2.1) + audio.rmsLevel * 1.1 + this.warpSurge * 0.8;
    st.rimPointLight.color.copy(this.tmpColorB);
    st.rimPointLight.intensity = 4.2 + audio.bassEnergy * 3.5;
    st.hemiLight.color.copy(this.tmpColorB);
    if (isOverlayMode) {
      st.scene.fog = null;
    } else {
      st.scene.fog = st.fog;
      st.fog.color.copy(this.tmpColorC).multiplyScalar(0.55);
      st.fog.density = varIdx === 1 ? 0.015 : 0.019;
    }

    // Update Starfighter materials & variation styling
    const isWire = varIdx === 2;
    st.titaniumMat.wireframe = isWire;
    st.panelAccentMat.wireframe = isWire;
    st.asteroidBasaltMat.wireframe = false;
    st.trimEmissiveMat.color.copy(this.tmpColorA);
    st.cockpitGlowMat.color.copy(this.tmpColorA);
    st.shipWireMat.color.copy(this.tmpColorA);
    st.shipWireMat.opacity = isWire ? 0.86 : 0.22;
    for (let i = 0; i < st.shipWireOverlays.length; i++) {
      st.shipWireOverlays[i].visible = true;
    }
    st.asteroidWireMat.color.copy(this.tmpColorB);
    for (let i = 0; i < st.asteroidWireMeshes.length; i++) {
      st.asteroidWireMeshes[i].visible = isWire;
    }

    // Blinking wingtip red / cyan beacons
    const navPulse = reduceMotion ? 0.85 : 0.45 + 0.55 * (Math.sin(timeSeconds * 6.4) > 0 ? 1 : 0.25);
    st.portBeaconMat.color.setRGB(1.0 * navPulse, 0.23 * navPulse, 0.36 * navPulse);
    const stbdPulse = reduceMotion ? 0.85 : 0.45 + 0.55 * (Math.sin(timeSeconds * 6.4 + Math.PI * 0.5) > 0 ? 1 : 0.25);
    st.stbdBeaconMat.color.setRGB(0.13 * stbdPulse, 0.83 * stbdPulse, 0.93 * stbdPulse);

    // Position & orient Starfighter smoothly in lower-center flight corridor
    const worldShipX = this.shipX * 2.4;
    const worldShipY = -0.68 + this.shipY * 1.1;
    st.shipGroup.position.set(worldShipX, worldShipY, 0.35 - this.warpSurge * 0.25);
    st.shipGroup.rotation.set(this.pitchAngle * 0.85, this.yawAngle, -this.rollAngle);
    st.shipGroup.updateMatrixWorld(true);

    // Update Volumetric Tapered Additive Plasma Cones
    const coneLen = 0.85 + this.thrustPulse * 0.95 + this.warpSurge * 1.35;
    const coneRad = 1.0 + this.thrustPulse * 0.28 + this.warpSurge * 0.22;
    st.innerPlumeL.scale.set(coneRad, coneRad, coneLen * 0.88);
    st.innerPlumeR.scale.set(coneRad, coneRad, coneLen * 0.88);
    st.outerPlumeL.scale.set(coneRad * 1.15, coneRad * 1.15, coneLen);
    st.outerPlumeR.scale.set(coneRad * 1.15, coneRad * 1.15, coneLen);

    st.innerPlumeMat.uniforms.uColorEdge.value.copy(this.tmpColorA);
    st.innerPlumeMat.uniforms.uIntensity.value = Math.min(1.4, 0.78 + this.thrustPulse * 0.45 + this.warpSurge * 0.35);
    st.innerPlumeMat.uniforms.uTime.value = timeSeconds;

    st.outerPlumeMat.uniforms.uColorCore.value.copy(this.tmpColorA);
    st.outerPlumeMat.uniforms.uColorEdge.value.copy(this.tmpColorB);
    st.outerPlumeMat.uniforms.uIntensity.value = Math.min(1.2, 0.52 + this.thrustPulse * 0.42 + this.warpSurge * 0.38);
    st.outerPlumeMat.uniforms.uTime.value = timeSeconds;

    // Wingtip Additive Ribbon Contrails (zero allocations)
    const trailAdvectZ = (reduceMotion ? 0.2 : warpSpeed * 6.8) * dt;
    this.tmpVecA.set(-2.22, -0.02, 1.24).applyMatrix4(st.shipGroup.matrixWorld);
    this.tmpVecB.set(2.22, -0.02, 1.24).applyMatrix4(st.shipGroup.matrixWorld);

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

    const trailBright = isOverlayMode ? 0.55 : 0.85;
    for (let s = 0; s < TRAIL_SEGMENTS; s++) {
      const tNorm = 1 - s / (TRAIL_SEGMENTS - 1);
      const halfW = 0.042 * tNorm * (1 + this.warpSurge * 0.45);
      const fade = tNorm * tNorm * trailBright;
      const ho = s * 3;
      const vo = s * 6;

      // Port ribbon (red-tinted + album accent)
      st.portTrailPositions[vo] = st.portTrailHistory[ho];
      st.portTrailPositions[vo + 1] = st.portTrailHistory[ho + 1] + halfW;
      st.portTrailPositions[vo + 2] = st.portTrailHistory[ho + 2];
      st.portTrailPositions[vo + 3] = st.portTrailHistory[ho];
      st.portTrailPositions[vo + 4] = st.portTrailHistory[ho + 1] - halfW;
      st.portTrailPositions[vo + 5] = st.portTrailHistory[ho + 2];

      const pr = (0.95 * 0.6 + this.tmpRgbA[0] * 0.4) * fade;
      const pg = (0.24 * 0.6 + this.tmpRgbA[1] * 0.4) * fade;
      const pb = (0.38 * 0.6 + this.tmpRgbA[2] * 0.4) * fade;
      st.portTrailColors[vo] = pr;
      st.portTrailColors[vo + 1] = pg;
      st.portTrailColors[vo + 2] = pb;
      st.portTrailColors[vo + 3] = pr;
      st.portTrailColors[vo + 4] = pg;
      st.portTrailColors[vo + 5] = pb;

      // Starboard ribbon (cyan-tinted + album accent)
      st.stbdTrailPositions[vo] = st.stbdTrailHistory[ho];
      st.stbdTrailPositions[vo + 1] = st.stbdTrailHistory[ho + 1] + halfW;
      st.stbdTrailPositions[vo + 2] = st.stbdTrailHistory[ho + 2];
      st.stbdTrailPositions[vo + 3] = st.stbdTrailHistory[ho];
      st.stbdTrailPositions[vo + 4] = st.stbdTrailHistory[ho + 1] - halfW;
      st.stbdTrailPositions[vo + 5] = st.stbdTrailHistory[ho + 2];

      const sr = (0.14 * 0.5 + this.tmpRgbA[0] * 0.5) * fade;
      const sg = (0.85 * 0.5 + this.tmpRgbA[1] * 0.5) * fade;
      const sb = (0.95 * 0.5 + this.tmpRgbA[2] * 0.5) * fade;
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

    // Update Expanding Additive Shockwave Rings
    for (let i = 0; i < SHOCKWAVE_POOL; i++) {
      const base = i * 5;
      const mesh = st.shockwaveMeshes[i];
      const mat = st.shockwaveMats[i];
      if (st.shockwaveState[base] > 0.5 && !reduceMotion) {
        st.shockwaveState[base + 1] += dt * 1.95;
        const p = st.shockwaveState[base + 1];
        if (p >= 1.0) {
          st.shockwaveState[base] = 0;
          mesh.visible = false;
        } else {
          mesh.visible = true;
          const sc = 0.45 + p * 2.6;
          mesh.position.set(
            st.shockwaveState[base + 2],
            st.shockwaveState[base + 3],
            st.shockwaveState[base + 4] + p * 1.4
          );
          mesh.scale.set(sc, sc * 0.68, 1);
          mesh.rotation.set(0.12, 0, -this.rollAngle * 0.45);
          mat.color.copy(this.tmpColorA);
          mat.opacity = (1 - p) * (1 - p) * (isOverlayMode ? 0.5 : 0.78);
        }
      } else {
        mesh.visible = false;
      }
    }

    // Map Asteroid Corridor into 3D World Space (-48 .. +6.5)
    for (let a = 0; a < ASTEROID_COUNT; a++) {
      const idx = a * ASTEROID_STRIDE;
      const azNorm = this.asteroids[idx + 2]; // 0.18 .. 8.8
      const worldZ = 5.0 - azNorm * 6.2;
      const worldX = this.asteroids[idx] * 5.2;
      const worldY = -0.25 + this.asteroids[idx + 1] * 3.4;
      const sc = this.asteroids[idx + 6] * 3.2;
      const mesh = st.asteroidMeshes[a];
      mesh.position.set(worldX, worldY, worldZ);
      mesh.rotation.set(this.asteroids[idx + 3], this.asteroids[idx + 4], this.asteroids[idx + 3] * 0.5);
      mesh.scale.set(sc * this.asteroids[idx + 8], sc, sc);
    }

    // Parallax 3D Hyperspace Star Streaks
    const streakLen = reduceMotion ? 0.12 : 0.25 + warpSpeed * 1.2 + this.warpSurge * 4.4;
    const starBright = isOverlayMode ? 0.68 : 1.0;
    for (let i = 0; i < STAR_COUNT; i++) {
      const idx = i * STAR_STRIDE;
      const zNorm = this.stars[idx + 2]; // 0.06 .. 2.0
      const wz = 4.5 - zNorm * 28.0;
      const wx = this.stars[idx] * 14.0;
      const wy = this.stars[idx + 1] * 11.0;
      const vo = i * 6;

      st.starPositions[vo] = wx;
      st.starPositions[vo + 1] = wy;
      st.starPositions[vo + 2] = wz;
      st.starPositions[vo + 3] = wx;
      st.starPositions[vo + 4] = wy;
      st.starPositions[vo + 5] = wz - streakLen;

      const fade = Math.min(1, (2.05 - zNorm) * 0.65) * starBright;
      let r = 0.92;
      let g = 0.96;
      let b = 1.0;
      if (i % 5 === 0) {
        r = this.tmpRgbA[0];
        g = this.tmpRgbA[1];
        b = this.tmpRgbA[2];
      } else if (i % 7 === 0) {
        r = this.tmpRgbB[0];
        g = this.tmpRgbB[1];
        b = this.tmpRgbB[2];
      }
      st.starColors[vo] = r * fade;
      st.starColors[vo + 1] = g * fade;
      st.starColors[vo + 2] = b * fade;
      st.starColors[vo + 3] = r * fade * 0.15;
      st.starColors[vo + 4] = g * fade * 0.15;
      st.starColors[vo + 5] = b * fade * 0.15;
    }
    (st.starGeom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (st.starGeom.attributes.color as THREE.BufferAttribute).needsUpdate = true;

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

    // Retro Wireframe Horizon Grid
    const showGrid = varIdx === 2 && !isOverlayMode;
    st.retroGrid.visible = showGrid;
    if (showGrid) {
      const gridCols = 16;
      const gridRows = 14;
      const gridW = 28;
      const gridDepth = 42;
      const gridY = -2.35;
      const phase = reduceMotion ? 0 : (timeSeconds * warpSpeed * 1.8) % (gridDepth / gridRows);
      let ptr = 0;
      for (let c = 0; c <= gridCols; c++) {
        const x = -gridW * 0.5 + (c / gridCols) * gridW;
        st.retroGridPositions[ptr++] = x;
        st.retroGridPositions[ptr++] = gridY;
        st.retroGridPositions[ptr++] = 5;
        st.retroGridPositions[ptr++] = x;
        st.retroGridPositions[ptr++] = gridY;
        st.retroGridPositions[ptr++] = 5 - gridDepth;
      }
      for (let r = 0; r <= gridRows; r++) {
        const z = 5 - (r * (gridDepth / gridRows) - phase);
        st.retroGridPositions[ptr++] = -gridW * 0.5;
        st.retroGridPositions[ptr++] = gridY;
        st.retroGridPositions[ptr++] = z;
        st.retroGridPositions[ptr++] = gridW * 0.5;
        st.retroGridPositions[ptr++] = gridY;
        st.retroGridPositions[ptr++] = z;
      }
      (st.retroGrid.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      st.retroGridMat.color.copy(this.tmpColorA);
      st.retroGridMat.opacity = 0.24 + audio.bassEnergy * 0.16;
    }

    st.renderer.setClearColor(0x000000, 0);
    st.renderer.render(st.scene, st.camera);

    // If no dedicated shipCanvas was provided (e.g. AmbientViewportApp), composite offscreen WebGL canvas onto ctx
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
          ctx.fillStyle = 'rgba(8, 6, 20, 0.78)';
          ctx.globalAlpha = distAlpha;
          ctx.fill();
          ctx.strokeStyle = palette.accentSecondary;
          ctx.lineWidth = 1.1;
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
    hasWebGlBackdrop = false
  ): void {
    if (variationId !== undefined || backgroundOpacity !== undefined) {
      setShip3DSceneHint(variationId, backgroundOpacity);
    }
    const varIdx = currentVariationIndex;
    const bgAlpha = currentBackgroundOpacity;
    const vigStrength = currentVignetteStrength;

    const dt = Math.max(0, Math.min(0.1, deltaSeconds));
    const cx =
      typeof focalCenterX === 'number' && Number.isFinite(focalCenterX)
        ? focalCenterX
        : width * 0.5;
    const cy = height * 0.58;
    const stageSpan = Math.max(220, Math.min(width, Math.min(cx, width - cx) * 2));

    // Strong-beat "whoosh" warp surge detection
    this.surgeCooldown = Math.max(0, this.surgeCooldown - dt);
    const beatStrength = audio.beatStrength ?? (audio.beatDetected ? 1.0 : audio.bassEnergy);
    const strongBeat = !reduceMotion && (audio.beatDetected || beatStrength > 0.72);
    if (strongBeat && this.surgeCooldown <= 0) {
      this.warpSurge = 1.0;
      this.shockwaveProgress = 0.02;
      this.surgeCooldown = 0.24;

      if (this.threeState && this.threeActive) {
        const base = this.shockwaveCursor * 5;
        this.shockwaveCursor = (this.shockwaveCursor + 1) % SHOCKWAVE_POOL;
        this.threeState.shockwaveState[base] = 1;
        this.threeState.shockwaveState[base + 1] = 0.02;
        this.threeState.shockwaveState[base + 2] = this.shipX * 2.4;
        this.threeState.shockwaveState[base + 3] = -0.68 + this.shipY * 1.1;
        this.threeState.shockwaveState[base + 4] = 1.75;
      }
    } else {
      this.warpSurge = Math.max(0, this.warpSurge - dt * 2.8);
    }
    if (this.shockwaveProgress > 0) {
      this.shockwaveProgress += dt * 1.85;
      if (this.shockwaveProgress > 1.0) this.shockwaveProgress = 0;
    }

    const bpm = audio.estimatedBpm && audio.estimatedBpm > 30 ? audio.estimatedBpm : 120;
    const bpmFactor = Math.max(0.65, Math.min(2.1, bpm / 120));
    const warpSpeed = reduceMotion
      ? 0.05
      : 0.42 * bpmFactor + audio.bassEnergy * 1.15 + this.warpSurge * 1.35;

    // Update Starfield
    for (let i = 0; i < STAR_COUNT; i++) {
      const idx = i * STAR_STRIDE;
      let z = this.stars[idx + 2] - warpSpeed * dt;
      if (z <= 0.06) z += 1.94;
      this.stars[idx + 2] = z;
    }

    // Update Asteroids + Scan Danger Corridor for Avoidance AI
    let avoidX = 0;
    let avoidY = 0;
    let closestThreatZ = 99;
    const astSpeed = reduceMotion ? 0.18 : warpSpeed * 1.45;

    for (let a = 0; a < ASTEROID_COUNT; a++) {
      const idx = a * ASTEROID_STRIDE;
      let az = this.asteroids[idx + 2] - astSpeed * dt;
      if (az <= 0.18) {
        this.spawnAsteroid(a);
        az = this.asteroids[idx + 2];
      } else {
        this.asteroids[idx + 2] = az;
      }

      if (!reduceMotion) {
        this.asteroids[idx + 3] += this.asteroids[idx + 5] * dt;
        this.asteroids[idx + 4] += this.asteroids[idx + 5] * 0.7 * dt;
      }

      if (az > 0.75 && az < 3.4) {
        const dx = this.asteroids[idx] - this.shipX;
        const dy = this.asteroids[idx + 1] - (0.35 + this.shipY);
        const distSq = dx * dx + dy * dy;
        if (distSq < 0.68) {
          const urgency = (3.4 - az) / 2.65;
          const pushDirX = dx >= 0 ? -1 : 1;
          const pushDirY = dy >= 0 ? -1 : 1;
          avoidX += pushDirX * urgency * (0.72 - Math.min(0.65, Math.abs(dx)));
          avoidY += pushDirY * urgency * 0.45;
          if (az < closestThreatZ) closestThreatZ = az;
        }
      }
      this.astOrder[a] = a;
    }

    // Rhythmic Avoidance AI & Spring-Damped Starfighter Flight Dynamics
    if (reduceMotion) {
      this.shipX = 0;
      this.shipY = 0;
      this.rollAngle = 0.05;
      this.pitchAngle = 0.08;
      this.yawAngle = 0;
      this.barrelRollPhase = 0;
      this.barrelRollActive = false;
    } else {
      const cruiseWeaveX = Math.sin(timeSeconds * 0.75 * bpmFactor) * 0.22;
      const cruiseWeaveY = Math.cos(timeSeconds * 1.05 * bpmFactor) * 0.08;
      const targetX = Math.max(-0.78, Math.min(0.78, cruiseWeaveX + avoidX * 0.65));
      const targetY = Math.max(-0.28, Math.min(0.28, cruiseWeaveY + avoidY * 0.45));

      const springK = 14.0;
      const damping = 5.5;
      const ax = (targetX - this.shipX) * springK - this.shipVx * damping;
      const ay = (targetY - this.shipY) * springK - this.shipVy * damping;
      this.shipVx += ax * dt;
      this.shipVy += ay * dt;
      this.shipX += this.shipVx * dt;
      this.shipY += this.shipVy * dt;

      if (!this.barrelRollActive && closestThreatZ < 1.9 && strongBeat && Math.abs(avoidX) > 0.25) {
        this.barrelRollActive = true;
        this.barrelRollPhase = 0;
      }
      if (this.barrelRollActive) {
        this.barrelRollPhase += dt * 5.8;
        if (this.barrelRollPhase >= Math.PI * 2) {
          this.barrelRollPhase = 0;
          this.barrelRollActive = false;
        }
      }

      const bankFromVelocity = -this.shipVx * 0.85;
      const beatBank = this.warpSurge * 0.22 * Math.sign(this.shipVx || Math.sin(timeSeconds * 1.5) || 1);
      const targetRoll =
        Math.max(-0.95, Math.min(0.95, bankFromVelocity + beatBank)) +
        (this.barrelRollActive ? Math.sin(this.barrelRollPhase) * 1.15 : 0);
      const targetPitch =
        0.11 + this.shipVy * 0.45 - audio.bassEnergy * 0.1 - this.warpSurge * 0.08;
      const targetYaw = -this.shipVx * 0.26 + Math.sin(timeSeconds * 0.45) * 0.08;

      const rotSmooth = Math.min(1, dt * 8.0);
      this.rollAngle += (targetRoll - this.rollAngle) * rotSmooth;
      this.pitchAngle += (targetPitch - this.pitchAngle) * rotSmooth;
      this.yawAngle += (targetYaw - this.yawAngle) * rotSmooth;
    }

    const targetThrust = Math.min(
      1.35,
      (audio.beatDetected ? 1.0 : audio.bassEnergy * 0.85 + audio.rmsLevel * 0.35) +
        this.warpSurge * 0.45
    );
    this.thrustPulse += (targetThrust - this.thrustPulse) * Math.min(1, dt * 12);

    // Try lazy Three.js init if running in browser without explicit attached shipCanvas
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
    const focal = Math.min(stageSpan, height) * (0.65 - this.warpSurge * 0.055);
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
      const bg = ctx.createRadialGradient(
        cx,
        height * 0.36,
        12,
        cx,
        cy,
        Math.max(width, height) * 0.86
      );
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

    // Software fallback stars
    ctx.save();
    const streakFactor = 0.032 + this.warpSurge * 0.085;
    for (let i = 0; i < STAR_COUNT; i++) {
      const idx = i * STAR_STRIDE;
      const z = this.stars[idx + 2];
      const invZ = 1.0 / z;
      const sx = cx + this.stars[idx] * focal * invZ;
      const sy = cy + this.stars[idx + 1] * focal * invZ;
      if (sx < -30 || sx > width + 30 || sy < -30 || sy > height + 30) continue;

      const alpha = Math.min(1, (2.0 - z) * 0.65) * (isOverlayMode ? 0.55 : 0.92);
      const radius = Math.max(0.6, this.stars[idx + 3] * invZ * 0.72);

      if (!reduceMotion && (warpSpeed > 0.55 || this.warpSurge > 0.1)) {
        const prevZ = z + warpSpeed * streakFactor;
        const px = cx + (this.stars[idx] * focal) / prevZ;
        const py = cy + (this.stars[idx + 1] * focal) / prevZ;
        ctx.strokeStyle = i % 4 === 0 ? palette.accentPrimary : i % 7 === 0 ? palette.accentSecondary : palette.textActive;
        ctx.globalAlpha = alpha * (0.55 + this.warpSurge * 0.35);
        ctx.lineWidth = Math.min(2.5, radius * (1 + this.warpSurge * 0.4));
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(sx, sy);
        ctx.stroke();
      }

      ctx.fillStyle = i % 6 === 0 ? palette.accentPrimary : '#eef4ff';
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(sx, sy, Math.min(3.0, radius), 0, Math.PI * 2);
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

    this.shipCenterX = cx + this.shipX * stageSpan * 0.28;
    this.shipCenterY = height * 0.74 + this.shipY * height * 0.22;
    this.shipScale = Math.min(stageSpan, height) * 0.14;

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
        ctx.fillStyle = partKind === 2 ? 'rgba(34, 211, 238, 0.24)' : 'rgba(6, 5, 16, 0.84)';
        ctx.globalAlpha = isOverlayMode ? 0.78 : 0.92;
        ctx.fill();
        ctx.strokeStyle = partKind === 2 ? '#22d3ee' : palette.accentPrimary;
        ctx.globalAlpha = 0.82;
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
  }
}
