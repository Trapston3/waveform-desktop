// Procedural 3D Starfield + Multi-Part 3D Starfighter + Faceted 3D Asteroids & Rhythmic Avoidance AI.
// Pre-allocates all starfield, asteroid, and mesh projection buffers for zero per-frame heap allocations.

import type { AudioFrameMetrics, LyricPalette } from '../core/models';

const STAR_COUNT = 220;
const STAR_STRIDE = 4; // x, y, z, size

const ASTEROID_COUNT = 20;
const ASTEROID_STRIDE = 8; // x, y, z, rx, ry, rotSpeed, scale, facetSeed

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

// Upgraded multi-part 3D starfighter vertices (x, y, z) in local ship space (18 vertices)
const SHIP_VERTS = new Float32Array([
  // 0: nose tip
  0.0, -0.02, 2.45,
  // 1: forward canopy nose bridge
  0.0, 0.16, 1.25,
  // 2: left fuselage chine forward
  -0.46, 0.02, 0.95,
  // 3: right fuselage chine forward
  0.46, 0.02, 0.95,
  // 4: left main wingtip (port red nav light)
  -2.25, -0.16, -0.95,
  // 5: right main wingtip (starboard cyan nav light)
  2.25, -0.16, -0.95,
  // 6: left plasma ion thruster center
  -0.54, -0.04, -1.42,
  // 7: right plasma ion thruster center
  0.54, -0.04, -1.42,
  // 8: dorsal spine aft peak
  0.0, 0.44, -1.18,
  // 9: ventral keel center
  0.0, -0.28, -0.25,
  // 10: left wing trailing inner
  -1.18, -0.08, -1.26,
  // 11: right wing trailing inner
  1.18, -0.08, -1.26,
  // 12: cockpit canopy crown peak
  0.0, 0.42, 0.35,
  // 13: cockpit canopy aft frame
  0.0, 0.34, -0.42,
  // 14: left vertical stabilizer fin tip
  -0.92, 0.56, -1.32,
  // 15: right vertical stabilizer fin tip
  0.92, 0.56, -1.32,
  // 16: left fuselage mid shoulder
  -0.64, 0.1, -0.18,
  // 17: right fuselage mid shoulder
  0.64, 0.1, -0.18,
]);

// Triangles [i0, i1, i2, shade, partKind]
// partKind: 0 = fuselage/nose, 1 = wings/stabilizers, 2 = glowing cockpit canopy, 3 = ventral/aft deck
const SHIP_FACES = new Float32Array([
  // Nose cone upper facets
  0, 1, 2, 0.95, 0,
  0, 3, 1, 0.88, 0,
  // Translucent glowing cockpit canopy (partKind = 2)
  1, 12, 2, 0.98, 2,
  1, 3, 12, 0.92, 2,
  12, 13, 16, 0.9, 2,
  12, 17, 13, 0.85, 2,
  // Forward chine to mid shoulder
  2, 12, 16, 0.78, 0,
  3, 17, 12, 0.74, 0,
  // Dorsal spine deck
  13, 8, 6, 0.68, 0,
  13, 7, 8, 0.64, 0,
  16, 13, 6, 0.62, 0,
  17, 7, 13, 0.58, 0,
  // Swept twin main wings
  2, 16, 4, 0.72, 1,
  16, 10, 4, 0.66, 1,
  16, 6, 10, 0.7, 1,
  3, 5, 17, 0.68, 1,
  17, 5, 11, 0.62, 1,
  17, 11, 7, 0.65, 1,
  // Twin angled dorsal stabilizer fins
  16, 14, 10, 0.82, 1,
  17, 11, 15, 0.79, 1,
  // Ventral hull keel
  0, 2, 9, 0.44, 3,
  0, 9, 3, 0.41, 3,
  9, 6, 7, 0.35, 3,
]);

const VERT_COUNT = SHIP_VERTS.length / 3;
const FACE_COUNT = SHIP_FACES.length / 5;

// Faceted 3D asteroid template (6 vertices, 8 triangular facets)
const AST_VERTS = new Float32Array([
  0.0, 1.05, 0.0,   // 0: top
  0.0, -1.0, 0.0,   // 1: bottom
  0.95, 0.1, 0.85,  // 2: front-right
  -0.9, -0.1, 0.88, // 3: front-left
  -0.88, 0.15, -0.9,// 4: back-left
  0.92, -0.12, -0.85, // 5: back-right
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

  private prngSeed = 0x5f3759df;
  private shipX = 0;
  private shipY = 0;
  private shipVx = 0;
  private shipVy = 0;
  private rollAngle = 0;
  private pitchAngle = 0;
  private barrelRollPhase = 0;
  private barrelRollActive = false;
  private thrustPulse = 0;
  private warpSurge = 0;
  private shockwaveProgress = 0;
  private surgeCooldown = 0;

  // Pre-cached per-frame scalars (eliminates nested closure allocations in render())
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

  constructor() {
    this.initScene();
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
    // Distribute across corridors including near-center paths so avoidance AI weaves around them
    const lane = (index % 5) - 2;
    this.asteroids[idx] = lane * 0.42 + (this.nextRand() - 0.5) * 0.55;
    this.asteroids[idx + 1] = (this.nextRand() - 0.42) * 0.95;
    this.asteroids[idx + 2] = zOverride ?? (5.6 + this.nextRand() * 3.2);
    this.asteroids[idx + 3] = this.nextRand() * Math.PI * 2;
    this.asteroids[idx + 4] = this.nextRand() * Math.PI * 2;
    this.asteroids[idx + 5] = (this.nextRand() - 0.5) * 2.4;
    this.asteroids[idx + 6] = 0.09 + this.nextRand() * 0.14;
    this.asteroids[idx + 7] = 0.75 + this.nextRand() * 0.5;
  }

  reset(): void {
    this.shipX = 0;
    this.shipY = 0;
    this.shipVx = 0;
    this.shipVy = 0;
    this.rollAngle = 0;
    this.pitchAngle = 0;
    this.barrelRollPhase = 0;
    this.barrelRollActive = false;
    this.thrustPulse = 0;
    this.warpSurge = 0;
    this.shockwaveProgress = 0;
    this.surgeCooldown = 0;
    this.initScene();
  }

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
      const seedStretch = this.asteroids[idx + 7];

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

      // Cull off-screen asteroids
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

        // Back-face culling in 2D projected space
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

    // Compute projected plume tip in-place without allocating
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

    // Tapered plasma exhaust cone
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

    // Inner white-hot plasma core
    ctx.beginPath();
    ctx.moveTo(tx - ny * 0.45, ty + nx * 0.45);
    ctx.lineTo((tx + tipX) * 0.5, (ty + tipY) * 0.5);
    ctx.lineTo(tx + ny * 0.45, ty - nx * 0.45);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = isOverlayMode ? 0.7 : 0.94;
    ctx.fill();

    // Radial ion glow halo
    const glowRadius = this.shipScale * (0.48 + this.thrustPulse * 0.42 + this.warpSurge * 0.25);
    const tg = ctx.createRadialGradient(tx, ty, 1, tx, ty, glowRadius);
    tg.addColorStop(0, '#ffffff');
    tg.addColorStop(0.28, palette.accentPrimary);
    tg.addColorStop(0.65, palette.accentSecondary);
    tg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = (isOverlayMode ? 0.65 : 0.88) * Math.min(1, 0.65 + this.thrustPulse * 0.35);
    ctx.fillStyle = tg;
    ctx.beginPath();
    ctx.arc(tx, ty, glowRadius, 0, Math.PI * 2);
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
    focalCenterX?: number
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
    } else {
      this.warpSurge = Math.max(0, this.warpSurge - dt * 2.8);
    }
    if (this.shockwaveProgress > 0) {
      this.shockwaveProgress += dt * 1.85;
      if (this.shockwaveProgress > 1.0) this.shockwaveProgress = 0;
    }

    // BPM-driven cruise velocity + warp surge kick
    const bpm = audio.estimatedBpm && audio.estimatedBpm > 30 ? audio.estimatedBpm : 120;
    const bpmFactor = Math.max(0.65, Math.min(2.1, bpm / 120));
    const warpSpeed = reduceMotion
      ? 0.05
      : (0.42 * bpmFactor + audio.bassEnergy * 1.15) + this.warpSurge * 1.35;

    // FOV kick during warp surge
    const focal = Math.min(stageSpan, height) * (0.65 - this.warpSurge * 0.055);

    this.frameWidth = width;
    this.frameHeight = height;
    this.frameCx = cx;
    this.frameCy = cy;
    this.frameFocal = focal;
    this.frameVarIdx = varIdx;
    this.frameIsOverlay = isOverlayMode;

    // 1. Deep space / Nebula / Wireframe backdrop (skipped in transparent overlay mode)
    if (!isOverlayMode) {
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
        // Retro Wireframe deep vector stage
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
        // Nebula Run: album-tinted cosmic nebula clouds drifting with parallax
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

        const neb2 = ctx.createRadialGradient(
          cx + stageSpan * 0.18 - driftX * 0.7,
          height * 0.56,
          16,
          cx + stageSpan * 0.18 - driftX * 0.7,
          height * 0.56,
          Math.max(width, height) * 0.45
        );
        neb2.addColorStop(0, palette.accentSecondary);
        neb2.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.globalAlpha = bgAlpha * (0.18 + audio.bassEnergy * 0.12);
        ctx.fillStyle = neb2;
        ctx.fillRect(0, 0, width, height);
      } else if (varIdx === 2) {
        // Retro Wireframe perspective vector grid below ship
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

    // 2. Parallax 3D Starfield with warp-surge hyper-streaks
    ctx.save();
    const streakFactor = 0.032 + this.warpSurge * 0.085;
    for (let i = 0; i < STAR_COUNT; i++) {
      const idx = i * STAR_STRIDE;
      let z = this.stars[idx + 2] - warpSpeed * dt;
      if (z <= 0.06) {
        z += 1.94;
      }
      this.stars[idx + 2] = z;

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

    // 3. Update & Sort Procedural 3D Asteroids + Scan Danger Corridor for Avoidance AI
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

      // Check if asteroid is in forward danger corridor ahead of ship (z in 0.75..3.4)
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

    // 4. Rhythmic Avoidance AI & Spring-Damped Starfighter Flight Dynamics
    if (reduceMotion) {
      this.shipX = 0;
      this.shipY = 0;
      this.rollAngle = 0.05;
      this.pitchAngle = 0.08;
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

      // Occasional heroic barrel-roll / sharp wing-dip when dodging a close asteroid on a strong beat
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

      const rotSmooth = Math.min(1, dt * 8.0);
      this.rollAngle += (targetRoll - this.rollAngle) * rotSmooth;
      this.pitchAngle += (targetPitch - this.pitchAngle) * rotSmooth;
    }

    const targetThrust = Math.min(
      1.35,
      (audio.beatDetected ? 1.0 : audio.bassEnergy * 0.85 + audio.rmsLevel * 0.35) +
        this.warpSurge * 0.45
    );
    this.thrustPulse += (targetThrust - this.thrustPulse) * Math.min(1, dt * 12);

    // Draw distant asteroids behind starfighter (z >= 1.25)
    this.renderAsteroidsInRange(ctx, palette, 1.25, 99);

    // 5. Project & Render Upgraded Multi-Part 3D Starfighter
    this.shipCenterX = cx + this.shipX * stageSpan * 0.28;
    this.shipCenterY = height * 0.74 + this.shipY * height * 0.22;
    this.shipScale = Math.min(stageSpan, height) * 0.14;

    this.cosR = Math.cos(this.rollAngle);
    this.sinR = Math.sin(this.rollAngle);
    this.cosP = Math.cos(this.pitchAngle);
    this.sinP = Math.sin(this.pitchAngle);
    const yaw = reduceMotion ? 0 : -this.shipVx * 0.28 + Math.sin(timeSeconds * 0.45) * 0.1;
    this.cosY = Math.cos(yaw);
    this.sinY = Math.sin(yaw);

    for (let v = 0; v < VERT_COUNT; v++) {
      this.projectLocalPoint(
        SHIP_VERTS[v * 3],
        SHIP_VERTS[v * 3 + 1],
        SHIP_VERTS[v * 3 + 2],
        v
      );
    }

    // Painter's algorithm sort on 23 faces (zero allocations)
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

    // Expanding concentric warp shockwave ring behind thrusters on strong beat
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

    // Twin plasma ion thrusters with dynamic tapered exhaust plumes
    this.plumeLength = 0.75 + this.thrustPulse * 0.95 + this.warpSurge * 0.85;
    this.drawThrusterPlume(ctx, palette, 6, -0.54);
    this.drawThrusterPlume(ctx, palette, 7, 0.54);

    // Draw sorted starfighter hull & canopy triangles
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
        // Retro Wireframe starfighter
        ctx.fillStyle = partKind === 2 ? 'rgba(34, 211, 238, 0.24)' : 'rgba(6, 5, 16, 0.84)';
        ctx.globalAlpha = isOverlayMode ? 0.78 : 0.92;
        ctx.fill();
        ctx.strokeStyle = partKind === 2 ? '#22d3ee' : palette.accentPrimary;
        ctx.globalAlpha = 0.82;
        ctx.lineWidth = partKind === 2 ? 1.5 : 1.2;
        ctx.stroke();
      } else if (partKind === 2) {
        // Glowing translucent cockpit canopy
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

    // Wingtip red (port/left, vert 4) & cyan (starboard/right, vert 5) navigation lights
    const navPulse = 0.7 + 0.3 * Math.sin(timeSeconds * 6.0);
    const navRadius = Math.max(2.2, this.shipScale * 0.055);

    // Port red wingtip light
    ctx.fillStyle = '#ff3b5c';
    ctx.globalAlpha = navPulse;
    ctx.beginPath();
    ctx.arc(this.projX[4], this.projY[4], navRadius, 0, Math.PI * 2);
    ctx.fill();

    // Starboard cyan wingtip light
    ctx.fillStyle = '#22d3ee';
    ctx.globalAlpha = navPulse;
    ctx.beginPath();
    ctx.arc(this.projX[5], this.projY[5], navRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Draw foreground passing asteroids (0.18 <= z < 1.25)
    this.renderAsteroidsInRange(ctx, palette, 0.18, 1.25);
  }
}
