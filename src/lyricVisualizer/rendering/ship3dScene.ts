// Procedural 3D Starfield + Stylized Banking Starship scene.
// Pre-allocates all starfield and mesh projection buffers for zero per-frame heap allocations.

import type { AudioFrameMetrics, LyricPalette } from '../core/models';

const STAR_COUNT = 220;
const STAR_STRIDE = 4; // x, y, z, size

// Stylized sleek delta-wing starship vertices (x, y, z) in local ship space
const SHIP_VERTS = new Float32Array([
  // 0: nose tip
  0.0, 0.0, 2.2,
  // 1: cockpit canopy top
  0.0, 0.34, 0.55,
  // 2: left hull mid
  -0.55, 0.05, 0.25,
  // 3: right hull mid
  0.55, 0.05, 0.25,
  // 4: left wingtip
  -2.05, -0.18, -1.05,
  // 5: right wingtip
  2.05, -0.18, -1.05,
  // 6: left rear thruster
  -0.52, -0.06, -1.35,
  // 7: right rear thruster
  0.52, -0.06, -1.35,
  // 8: dorsal spine rear
  0.0, 0.42, -1.15,
  // 9: ventral keel
  0.0, -0.26, -0.25,
  // 10: left wing inner rear
  -1.15, -0.1, -1.2,
  // 11: right wing inner rear
  1.15, -0.1, -1.2,
]);

// Triangles (indices into SHIP_VERTS) with shade factor [i0, i1, i2, shade]
const SHIP_FACES = new Float32Array([
  // Nose upper left/right
  0, 1, 2, 0.92,
  0, 3, 1, 0.84,
  // Canopy to dorsal spine
  1, 8, 2, 0.78,
  1, 3, 8, 0.72,
  // Left wing upper
  2, 4, 10, 0.68,
  2, 10, 6, 0.74,
  // Right wing upper
  3, 11, 5, 0.62,
  3, 7, 11, 0.66,
  // Rear upper deck
  8, 6, 2, 0.58,
  8, 3, 7, 0.54,
  // Ventral hull
  0, 2, 9, 0.45,
  0, 9, 3, 0.42,
  9, 6, 7, 0.36,
]);

const VERT_COUNT = SHIP_VERTS.length / 3;
const FACE_COUNT = SHIP_FACES.length / 4;

export class Ship3DScene {
  private readonly stars = new Float32Array(STAR_COUNT * STAR_STRIDE);
  private readonly projX = new Float32Array(VERT_COUNT);
  private readonly projY = new Float32Array(VERT_COUNT);
  private readonly projZ = new Float32Array(VERT_COUNT);
  private readonly faceOrder = new Int32Array(FACE_COUNT);
  private readonly faceDepth = new Float32Array(FACE_COUNT);

  private rollAngle = 0;
  private pitchAngle = 0;
  private thrustPulse = 0;

  constructor() {
    // Deterministic seeded PRNG so visual tests are reproducible
    let seed = 0x5f3759df;
    const nextRand = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };

    for (let i = 0; i < STAR_COUNT; i++) {
      const idx = i * STAR_STRIDE;
      this.stars[idx] = (nextRand() - 0.5) * 2.8;
      this.stars[idx + 1] = (nextRand() - 0.5) * 1.9;
      this.stars[idx + 2] = 0.08 + nextRand() * 1.92;
      this.stars[idx + 3] = 0.6 + nextRand() * 1.6;
    }
    for (let f = 0; f < FACE_COUNT; f++) {
      this.faceOrder[f] = f;
    }
  }

  reset(): void {
    this.rollAngle = 0;
    this.pitchAngle = 0;
    this.thrustPulse = 0;
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
    isOverlayMode: boolean
  ): void {
    const dt = Math.max(0, Math.min(0.1, deltaSeconds));
    const cx = width * 0.5;
    const cy = height * 0.58;
    const focal = Math.min(width, height) * 0.65;

    // 1. Deep space backdrop (skipped in transparent overlay mode)
    if (!isOverlayMode) {
      const bg = ctx.createRadialGradient(cx, height * 0.35, 12, cx, cy, Math.max(width, height) * 0.85);
      bg.addColorStop(0, palette.bgMid);
      bg.addColorStop(0.55, palette.bgDeep);
      bg.addColorStop(1, '#04060d');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
    }

    // 2. Parallax 3D Starfield
    const warpSpeed = reduceMotion
      ? 0.04
      : 0.38 + audio.bassEnergy * 1.25 + (audio.beatDetected ? 0.55 : 0);

    ctx.save();
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
      if (sx < -20 || sx > width + 20 || sy < -20 || sy > height + 20) continue;

      const alpha = Math.min(1, (2.0 - z) * 0.65) * (isOverlayMode ? 0.55 : 0.92);
      const radius = Math.max(0.6, this.stars[idx + 3] * invZ * 0.72);

      // Motion streak on high bass / beat
      if (!reduceMotion && warpSpeed > 0.6) {
        const prevZ = z + warpSpeed * 0.035;
        const px = cx + this.stars[idx] * focal / prevZ;
        const py = cy + this.stars[idx + 1] * focal / prevZ;
        ctx.strokeStyle = i % 5 === 0 ? palette.accentSecondary : palette.textActive;
        ctx.globalAlpha = alpha * 0.55;
        ctx.lineWidth = Math.min(2.2, radius);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(sx, sy);
        ctx.stroke();
      }

      ctx.fillStyle = i % 7 === 0 ? palette.accentPrimary : '#eef4ff';
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(sx, sy, Math.min(3.0, radius), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 3. Banking / Pitching Procedural 3D Starship
    const targetRoll = reduceMotion
      ? 0.06
      : Math.sin(timeSeconds * 0.85) * (0.28 + audio.bassEnergy * 0.25) +
        (audio.beatDetected ? 0.14 * Math.sign(Math.cos(timeSeconds * 1.7) || 1) : 0);
    const targetPitch = reduceMotion
      ? 0.08
      : 0.12 + Math.cos(timeSeconds * 0.62) * 0.11 - audio.bassEnergy * 0.12;

    const smooth = Math.min(1, dt * 6.5);
    this.rollAngle += (targetRoll - this.rollAngle) * smooth;
    this.pitchAngle += (targetPitch - this.pitchAngle) * smooth;
    const targetThrust = audio.beatDetected ? 1.0 : audio.bassEnergy * 0.85 + audio.rmsLevel * 0.35;
    this.thrustPulse += (targetThrust - this.thrustPulse) * Math.min(1, dt * 10);

    const shipCenterX = cx + (reduceMotion ? 0 : Math.sin(timeSeconds * 0.7) * width * 0.045);
    const shipCenterY = height * 0.74 + (reduceMotion ? 0 : Math.cos(timeSeconds * 1.1) * height * 0.02);
    const shipScale = Math.min(width, height) * 0.135;

    const cosR = Math.cos(this.rollAngle);
    const sinR = Math.sin(this.rollAngle);
    const cosP = Math.cos(this.pitchAngle);
    const sinP = Math.sin(this.pitchAngle);
    const yaw = reduceMotion ? 0 : Math.sin(timeSeconds * 0.45) * 0.16;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);

    // Project all 12 vertices
    for (let v = 0; v < VERT_COUNT; v++) {
      const vx = SHIP_VERTS[v * 3];
      const vy = SHIP_VERTS[v * 3 + 1];
      const vz = SHIP_VERTS[v * 3 + 2];

      // Roll (Z)
      const rx = vx * cosR - vy * sinR;
      const ry = vx * sinR + vy * cosR;
      const rz = vz;

      // Pitch (X)
      const px = rx;
      const py = ry * cosP - rz * sinP;
      const pz = ry * sinP + rz * cosP;

      // Yaw (Y)
      const yx = px * cosY + pz * sinY;
      const yy = py;
      const yz = -px * sinY + pz * cosY;

      const camZ = 5.4 - yz;
      const persp = 4.6 / Math.max(1.2, camZ);
      this.projX[v] = shipCenterX + yx * shipScale * persp;
      this.projY[v] = shipCenterY - yy * shipScale * persp;
      this.projZ[v] = camZ;
    }

    // Painter's algorithm sort (insertion sort on 13 faces, zero allocations)
    for (let f = 0; f < FACE_COUNT; f++) {
      const i0 = SHIP_FACES[f * 4] | 0;
      const i1 = SHIP_FACES[f * 4 + 1] | 0;
      const i2 = SHIP_FACES[f * 4 + 2] | 0;
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
    // Engine thruster glow behind ship
    const glowRadius = shipScale * (0.55 + this.thrustPulse * 0.45);
    const drawThruster = (vertIdx: number): void => {
      const tx = this.projX[vertIdx];
      const ty = this.projY[vertIdx];
      const tg = ctx.createRadialGradient(tx, ty, 1, tx, ty, glowRadius);
      tg.addColorStop(0, '#ffffff');
      tg.addColorStop(0.28, palette.accentPrimary);
      tg.addColorStop(0.65, palette.accentSecondary);
      tg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = (isOverlayMode ? 0.65 : 0.88) * (0.65 + this.thrustPulse * 0.35);
      ctx.fillStyle = tg;
      ctx.beginPath();
      ctx.arc(tx, ty, glowRadius, 0, Math.PI * 2);
      ctx.fill();
    };
    drawThruster(6);
    drawThruster(7);

    // Draw sorted ship hull triangles
    for (let k = 0; k < FACE_COUNT; k++) {
      const f = this.faceOrder[k];
      const i0 = SHIP_FACES[f * 4] | 0;
      const i1 = SHIP_FACES[f * 4 + 1] | 0;
      const i2 = SHIP_FACES[f * 4 + 2] | 0;
      const shade = SHIP_FACES[f * 4 + 3];

      ctx.beginPath();
      ctx.moveTo(this.projX[i0], this.projY[i0]);
      ctx.lineTo(this.projX[i1], this.projY[i1]);
      ctx.lineTo(this.projX[i2], this.projY[i2]);
      ctx.closePath();

      const lum = Math.round(28 + shade * 68);
      ctx.fillStyle = `rgb(${Math.round(lum * 0.85)}, ${Math.round(lum * 0.95)}, ${Math.min(255, Math.round(lum * 1.2))})`;
      ctx.globalAlpha = isOverlayMode ? 0.78 : 0.94;
      ctx.fill();

      ctx.strokeStyle = palette.accentPrimary;
      ctx.globalAlpha = 0.42 + this.thrustPulse * 0.25;
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
    ctx.restore();
  }
}
