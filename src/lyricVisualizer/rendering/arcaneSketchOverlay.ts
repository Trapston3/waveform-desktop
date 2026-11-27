// Arcane / Jinx Hand-Drawn Neon Scribble Glitch FX Overlay
// Zero-GC pre-allocated event pool (MAX_SCRIBBLES = 6), dynamically tinted to the
// active album palette boosted to vivid neon + subtle RGB chromatic-split edge echoes (±2.5px),
// 2-frame stepped chalk/marker stroke jitter (Math.floor(timeSeconds * 16)),
// double/triple imperfect strokes, crisp 140-320ms lifetime, and global rate-limiter.

import type { LyricPalette } from '../core/models';
import { parseColorToRgbInto } from './webGlEffectLayer';

export const MAX_SCRIBBLES = 6;
const MAX_CONCURRENT_SCRIBBLES = 2;
const AMBIENT_MIN_GAP_SEC = 0.18;
const CHROMATIC_OFFSET_PX = 2.5;

export type ArcaneFxEventKind =
  | 'word_collect'
  | 'asteroid_split'
  | 'laser_salvo'
  | 'whoosh_boost'
  | 'semantic_crown'
  | 'semantic_crazy'
  | 'semantic_love'
  | 'semantic_electric'
  | 'semantic_eyes'
  | 'semantic_fire'
  | 'semantic_wings';

export interface ArcaneFxEvent {
  kind: ArcaneFxEventKind;
  screenX: number;
  screenY: number;
  shipScreenX: number;
  shipScreenY: number;
  shipRoll: number;
  shipScale: number;
  seed: number;
  timeSeconds: number;
  brokenVariant: boolean;
}

export interface ArcaneSemanticClassification {
  readonly kind: ArcaneFxEventKind | null;
  readonly brokenVariant: boolean;
}

const ASTEROID_CALLOUTS: readonly string[] = ['BOOM!', 'CRACK!', 'KRAK!', 'SHATTER!'];
const LASER_CALLOUTS: readonly string[] = ['POW POW', 'PEW PEW', 'ZAP!'];
const WHOOSH_CALLOUTS: readonly string[] = ['WHOOSH!', 'ZOOM!'];

// Normalized starfighter silhouette polyline (closed loop around ship center)
const SHIP_SILHOUETTE_X = new Float32Array([
  0.0, 0.24, 0.42, 1.32, 1.18, 0.46, 0.34, 0.0, -0.34, -0.46, -1.18, -1.32, -0.42, -0.24, 0.0,
]);
const SHIP_SILHOUETTE_Y = new Float32Array([
  -1.15, -0.48, -0.18, 0.62, 0.86, 0.56, 0.88, 0.72, 0.88, 0.56, 0.86, 0.62, -0.18, -0.48, -1.15,
]);
const SHIP_SILHOUETTE_LEN = SHIP_SILHOUETTE_X.length;

// Pre-allocated normalized neon wing polyline (zero per-frame array allocation)
const WING_SKETCH_X = new Float32Array([0.42, 1.35, 2.05, 1.55, 1.88, 1.32, 1.52, 0.55]);
const WING_SKETCH_Y = new Float32Array([0.0, -0.58, -0.38, -0.04, 0.18, 0.32, 0.56, 0.38]);
const WING_SKETCH_LEN = WING_SKETCH_X.length;

function isSemanticKind(kind: ArcaneFxEventKind): boolean {
  return (
    kind === 'semantic_crown' ||
    kind === 'semantic_crazy' ||
    kind === 'semantic_love' ||
    kind === 'semantic_electric' ||
    kind === 'semantic_eyes' ||
    kind === 'semantic_fire' ||
    kind === 'semantic_wings'
  );
}

/**
 * Precomputed once per lyrics load (zero per-frame string scanning).
 */
export function classifyArcaneSemanticKind(rawWord: string): ArcaneSemanticClassification {
  const clean = rawWord.toLowerCase().replace(/[^a-z]/g, '');
  if (!clean) return { kind: null, brokenVariant: false };

  if (clean === 'crown' || clean === 'king' || clean === 'queen' || clean === 'throne' || clean === 'royal') {
    return { kind: 'semantic_crown', brokenVariant: false };
  }
  if (
    clean === 'crazy' ||
    clean === 'laugh' ||
    clean === 'laughing' ||
    clean === 'ha' ||
    clean === 'haha' ||
    clean === 'hahaha' ||
    clean === 'mad' ||
    clean === 'insane' ||
    clean === 'jinx' ||
    clean === 'chaos'
  ) {
    return { kind: 'semantic_crazy', brokenVariant: false };
  }
  if (clean === 'broken' || clean === 'heartbreak' || clean === 'heartbroken') {
    return { kind: 'semantic_love', brokenVariant: true };
  }
  if (clean === 'love' || clean === 'heart' || clean === 'hearts' || clean === 'loved' || clean === 'lover') {
    return { kind: 'semantic_love', brokenVariant: false };
  }
  if (
    clean === 'electric' ||
    clean === 'shock' ||
    clean === 'shocked' ||
    clean === 'lightning' ||
    clean === 'thunder' ||
    clean === 'volt' ||
    clean === 'static' ||
    clean === 'zap'
  ) {
    return { kind: 'semantic_electric', brokenVariant: false };
  }
  if (clean === 'eyes' || clean === 'eye' || clean === 'watch' || clean === 'watching' || clean === 'stare') {
    return { kind: 'semantic_eyes', brokenVariant: false };
  }
  if (
    clean === 'fire' ||
    clean === 'burn' ||
    clean === 'burning' ||
    clean === 'burned' ||
    clean === 'flame' ||
    clean === 'flames' ||
    clean === 'blaze'
  ) {
    return { kind: 'semantic_fire', brokenVariant: false };
  }
  if (clean === 'wings' || clean === 'wing' || clean === 'fly' || clean === 'flying' || clean === 'soar') {
    return { kind: 'semantic_wings', brokenVariant: false };
  }

  return { kind: null, brokenVariant: false };
}

function hashSigned(seed: number, stepFrame: number, idx: number): number {
  let h =
    (Math.imul(seed | 0, 374761393) +
      Math.imul(stepFrame | 0, 668265263) +
      Math.imul(idx | 0, 2147483647)) |
    0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  const u = ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  return u * 2 - 1;
}

function hashUnit(seed: number, salt: number): number {
  let h = (Math.imul(seed | 0, 1597334677) + Math.imul(salt | 0, 3812015801)) | 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967295;
}

function boostRgbToNeonCss(rgb: Float32Array): string {
  let r = rgb[0];
  let g = rgb[1];
  let b = rgb[2];
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  if (maxC < 0.08) {
    return '#22f5e6';
  }
  // Push dominant channel near 1.0 and exaggerate chroma for vibrant neon chalk
  const scale = 1.0 / maxC;
  r = Math.min(1, r * scale);
  g = Math.min(1, g * scale);
  b = Math.min(1, b * scale);
  const avg = (r + g + b) / 3;
  r = Math.max(0.12, Math.min(1, avg + (r - avg) * 1.42 + 0.08));
  g = Math.max(0.12, Math.min(1, avg + (g - avg) * 1.42 + 0.08));
  b = Math.max(0.12, Math.min(1, avg + (b - avg) * 1.42 + 0.08));
  if (maxC - minC < 0.12) {
    // Near-neutral palette: tint electric cyan-magenta
    r = 0.25;
    g = 0.98;
    b = 0.92;
  }
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

interface ScribbleSlot {
  active: boolean;
  kind: ArcaneFxEventKind;
  semantic: boolean;
  brokenVariant: boolean;
  screenX: number;
  screenY: number;
  shipScreenX: number;
  shipScreenY: number;
  shipRoll: number;
  shipScale: number;
  seed: number;
  age: number;
  duration: number;
  calloutText: string;
  offsetX: number;
  offsetY: number;
  tiltRad: number;
  useSecondary: boolean;
}

export class ArcaneSketchOverlay {
  private readonly slots: ScribbleSlot[] = Array.from({ length: MAX_SCRIBBLES }, () => ({
    active: false,
    kind: 'word_collect',
    semantic: false,
    brokenVariant: false,
    screenX: 0,
    screenY: 0,
    shipScreenX: 0,
    shipScreenY: 0,
    shipRoll: 0,
    shipScale: 72,
    seed: 1,
    age: 0,
    duration: 0.2,
    calloutText: '',
    offsetX: 0,
    offsetY: 0,
    tiltRad: 0,
    useSecondary: false,
  }));

  private readonly tmpRgbA = new Float32Array(3);
  private readonly tmpRgbB = new Float32Array(3);
  private readonly scratchX = new Float32Array(32);
  private readonly scratchY = new Float32Array(32);

  private cachedPrimarySrc = '';
  private cachedSecondarySrc = '';
  private neonPrimary = '#38f8e8';
  private neonSecondary = '#ff3ca6';
  private chromaCyan = '#22f2ff';
  private chromaMagenta = '#ff2e97';

  private lastAmbientSpawnTime = -10;
  private totalSpawnedCount = 0;

  reset(): void {
    for (let i = 0; i < MAX_SCRIBBLES; i++) {
      this.slots[i].active = false;
      this.slots[i].age = 0;
    }
    this.lastAmbientSpawnTime = -10;
  }

  getActiveCount(): number {
    let count = 0;
    for (let i = 0; i < MAX_SCRIBBLES; i++) {
      if (this.slots[i].active) count++;
    }
    return count;
  }

  getTotalSpawnedCount(): number {
    return this.totalSpawnedCount;
  }

  private syncNeonColors(palette: LyricPalette): void {
    if (
      palette.accentPrimary === this.cachedPrimarySrc &&
      palette.accentSecondary === this.cachedSecondarySrc
    ) {
      return;
    }
    this.cachedPrimarySrc = palette.accentPrimary;
    this.cachedSecondarySrc = palette.accentSecondary;

    parseColorToRgbInto(palette.accentPrimary, this.tmpRgbA);
    parseColorToRgbInto(palette.accentSecondary, this.tmpRgbB);
    this.neonPrimary = boostRgbToNeonCss(this.tmpRgbA);
    this.neonSecondary = boostRgbToNeonCss(this.tmpRgbB);

    // Subtle RGB chromatic-split edge echoes biased toward neon cyan & hot magenta
    const cr = Math.round(Math.min(255, (0.12 + this.tmpRgbB[0] * 0.25) * 255));
    const cg = Math.round(Math.min(255, (0.86 + this.tmpRgbA[1] * 0.14) * 255));
    const cb = 255;
    this.chromaCyan = `rgb(${cr}, ${cg}, ${cb})`;

    const mr = 255;
    const mg = Math.round(Math.min(255, (0.14 + this.tmpRgbA[1] * 0.22) * 255));
    const mb = Math.round(Math.min(255, (0.58 + this.tmpRgbB[2] * 0.38) * 255));
    this.chromaMagenta = `rgb(${mr}, ${mg}, ${mb})`;
  }

  enqueueEvent(ev: Readonly<ArcaneFxEvent>, reduceMotion: boolean): boolean {
    if (reduceMotion) return false;

    const semantic = isSemanticKind(ev.kind);
    const activeCount = this.getActiveCount();

    // Global rate-limiter: min 180ms gap for ambient events, max 2 concurrent scribbles
    if (!semantic) {
      if (ev.timeSeconds - this.lastAmbientSpawnTime < AMBIENT_MIN_GAP_SEC) {
        return false;
      }
      if (activeCount >= MAX_CONCURRENT_SCRIBBLES) {
        return false;
      }
    } else if (activeCount >= MAX_CONCURRENT_SCRIBBLES) {
      // Allow a semantic lyric trigger to replace the oldest ambient scribble without exceeding max 2 concurrent
      let oldestAmbientIdx = -1;
      let oldestAge = -1;
      for (let i = 0; i < MAX_SCRIBBLES; i++) {
        const s = this.slots[i];
        if (s.active && !s.semantic && s.age > oldestAge) {
          oldestAge = s.age;
          oldestAmbientIdx = i;
        }
      }
      if (oldestAmbientIdx < 0) {
        return false;
      }
      this.slots[oldestAmbientIdx].active = false;
    }

    let freeIdx = -1;
    for (let i = 0; i < MAX_SCRIBBLES; i++) {
      if (!this.slots[i].active) {
        freeIdx = i;
        break;
      }
    }
    if (freeIdx < 0) return false;

    const slot = this.slots[freeIdx];
    const r0 = hashUnit(ev.seed, 11);
    const r1 = hashUnit(ev.seed, 23);
    const r2 = hashUnit(ev.seed, 37);
    const r3 = hashUnit(ev.seed, 53);

    slot.active = true;
    slot.kind = ev.kind;
    slot.semantic = semantic;
    slot.brokenVariant = ev.brokenVariant;
    slot.screenX = ev.screenX;
    slot.screenY = ev.screenY;
    slot.shipScreenX = ev.shipScreenX;
    slot.shipScreenY = ev.shipScreenY;
    slot.shipRoll = ev.shipRoll;
    slot.shipScale = Math.max(36, Math.min(130, ev.shipScale || 72));
    slot.seed = ev.seed | 0;
    slot.age = 0;
    slot.offsetX = (r0 >= 0.5 ? 1 : -1) * (8 + r1 * 8);
    slot.offsetY = (r2 - 0.5) * 14;
    slot.tiltRad = (r3 - 0.5) * 0.28;
    slot.useSecondary = r1 > 0.48;

    if (ev.kind === 'word_collect') {
      slot.duration = 0.14 + r0 * 0.08; // 140-220ms
      slot.calloutText = '';
    } else if (ev.kind === 'asteroid_split') {
      slot.duration = 0.2 + r0 * 0.12; // 200-320ms
      slot.calloutText = ASTEROID_CALLOUTS[Math.floor(r1 * ASTEROID_CALLOUTS.length) % ASTEROID_CALLOUTS.length];
    } else if (ev.kind === 'laser_salvo') {
      slot.duration = 0.16 + r0 * 0.1; // 160-260ms
      slot.calloutText = LASER_CALLOUTS[Math.floor(r1 * LASER_CALLOUTS.length) % LASER_CALLOUTS.length];
    } else if (ev.kind === 'whoosh_boost') {
      slot.duration = 0.19 + r0 * 0.12; // 190-310ms
      slot.calloutText = WHOOSH_CALLOUTS[Math.floor(r1 * WHOOSH_CALLOUTS.length) % WHOOSH_CALLOUTS.length];
    } else {
      slot.duration = 0.22 + r0 * 0.1; // 220-320ms
      slot.calloutText = ev.kind === 'semantic_crazy' ? 'HA HA' : '';
    }

    if (!semantic) {
      this.lastAmbientSpawnTime = ev.timeSeconds;
    }
    this.totalSpawnedCount += 1;
    return true;
  }

  private strokeImperfectPolyline(
    ctx: CanvasRenderingContext2D,
    count: number,
    seed: number,
    stepFrame: number,
    jitterAmp: number,
    passes: number,
    dx: number,
    dy: number,
    strokeStyle: string,
    lineWidth: number,
    alpha: number
  ): void {
    if (count < 2 || alpha <= 0.01) return;
    ctx.strokeStyle = strokeStyle;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let p = 0; p < passes; p++) {
      const passAlpha = p === 0 ? alpha : alpha * (p === 1 ? 0.68 : 0.42);
      ctx.globalAlpha = passAlpha;
      ctx.lineWidth = Math.max(1.1, lineWidth * (1 - p * 0.18));
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const jx = hashSigned(seed + p * 79, stepFrame, i * 2) * jitterAmp;
        const jy = hashSigned(seed + p * 79, stepFrame, i * 2 + 1) * jitterAmp;
        const px = this.scratchX[i] + dx + jx;
        const py = this.scratchY[i] + dy + jy;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }

  private drawChromaticPolyline(
    ctx: CanvasRenderingContext2D,
    count: number,
    seed: number,
    stepFrame: number,
    jitterAmp: number,
    passes: number,
    mainColor: string,
    lineWidth: number,
    alpha: number
  ): void {
    // RGB chromatic-split edge echoes (±2.5px)
    this.strokeImperfectPolyline(
      ctx,
      count,
      seed + 13,
      stepFrame,
      jitterAmp * 0.85,
      1,
      -CHROMATIC_OFFSET_PX,
      -0.8,
      this.chromaCyan,
      lineWidth * 0.9,
      alpha * 0.46
    );
    this.strokeImperfectPolyline(
      ctx,
      count,
      seed + 29,
      stepFrame,
      jitterAmp * 0.85,
      1,
      CHROMATIC_OFFSET_PX,
      0.8,
      this.chromaMagenta,
      lineWidth * 0.9,
      alpha * 0.46
    );
    // Double/triple imperfect neon chalk core strokes
    this.strokeImperfectPolyline(
      ctx,
      count,
      seed,
      stepFrame,
      jitterAmp,
      passes,
      0,
      0,
      mainColor,
      lineWidth,
      alpha * 0.95
    );
    // Bright chalk highlight pass
    this.strokeImperfectPolyline(
      ctx,
      count,
      seed + 41,
      stepFrame,
      jitterAmp * 0.6,
      1,
      0,
      0,
      '#ffffff',
      Math.max(1.0, lineWidth * 0.42),
      alpha * 0.65
    );
  }

  private drawShipSilhouette(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    roll: number,
    scale: number,
    seed: number,
    stepFrame: number,
    mainColor: string,
    alpha: number
  ): void {
    const cosR = Math.cos(roll);
    const sinR = Math.sin(roll);
    const s = scale * 0.72;
    for (let i = 0; i < SHIP_SILHOUETTE_LEN; i++) {
      const lx = SHIP_SILHOUETTE_X[i] * s;
      const ly = SHIP_SILHOUETTE_Y[i] * s;
      this.scratchX[i] = cx + lx * cosR - ly * sinR;
      this.scratchY[i] = cy + lx * sinR + ly * cosR;
    }
    this.drawChromaticPolyline(ctx, SHIP_SILHOUETTE_LEN, seed, stepFrame, 3.2, 3, mainColor, 2.5, alpha);

    // Sketchy cockpit canopy diamond inside the silhouette
    const cd = s * 0.24;
    const ptsX0 = 0;
    const ptsY0 = -cd * 1.45;
    const ptsX1 = cd * 0.65;
    const ptsY1 = -cd * 0.2;
    const ptsX2 = 0;
    const ptsY2 = cd * 0.75;
    const ptsX3 = -cd * 0.65;
    const ptsY3 = -cd * 0.2;
    this.scratchX[0] = cx + ptsX0 * cosR - ptsY0 * sinR;
    this.scratchY[0] = cy + ptsX0 * sinR + ptsY0 * cosR;
    this.scratchX[1] = cx + ptsX1 * cosR - ptsY1 * sinR;
    this.scratchY[1] = cy + ptsX1 * sinR + ptsY1 * cosR;
    this.scratchX[2] = cx + ptsX2 * cosR - ptsY2 * sinR;
    this.scratchY[2] = cy + ptsX2 * sinR + ptsY2 * cosR;
    this.scratchX[3] = cx + ptsX3 * cosR - ptsY3 * sinR;
    this.scratchY[3] = cy + ptsX3 * sinR + ptsY3 * cosR;
    this.scratchX[4] = this.scratchX[0];
    this.scratchY[4] = this.scratchY[0];
    this.drawChromaticPolyline(ctx, 5, seed + 107, stepFrame, 2.2, 2, this.neonSecondary, 1.8, alpha * 0.88);
  }

  private drawGraffitiText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    fontPx: number,
    tiltRad: number,
    seed: number,
    stepFrame: number,
    mainColor: string,
    fontFamily: string,
    alpha: number
  ): void {
    if (!text || alpha <= 0.01) return;
    const jx = hashSigned(seed + 5, stepFrame, 0) * 2.2;
    const jy = hashSigned(seed + 5, stepFrame, 1) * 2.2;

    ctx.save();
    ctx.translate(x + jx, y + jy);
    ctx.rotate(tiltRad + hashSigned(seed + 9, stepFrame, 2) * 0.045);
    ctx.font = `italic 900 ${Math.round(fontPx)}px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    // Chromatic split text echoes (±2.5px)
    ctx.globalAlpha = alpha * 0.55;
    ctx.fillStyle = this.chromaCyan;
    ctx.fillText(text, -CHROMATIC_OFFSET_PX, -0.8);

    ctx.fillStyle = this.chromaMagenta;
    ctx.fillText(text, CHROMATIC_OFFSET_PX, 0.8);

    // Dark rough marker outline + vivid neon fill + inner crisp white sketch stroke
    ctx.globalAlpha = alpha * 0.92;
    ctx.strokeStyle = 'rgba(4, 6, 16, 0.9)';
    ctx.lineWidth = Math.max(3.2, fontPx * 0.14);
    ctx.strokeText(text, 0, 0);

    ctx.fillStyle = mainColor;
    ctx.fillText(text, 0, 0);

    ctx.globalAlpha = alpha * 0.72;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.15;
    ctx.strokeText(text, hashSigned(seed, stepFrame, 7) * 1.1, hashSigned(seed, stepFrame, 8) * 1.1);

    // Double scratchy underline stroke beneath graffiti word
    const halfW = Math.max(26, text.length * fontPx * 0.29);
    const underY = fontPx * 0.54;
    this.scratchX[0] = -halfW;
    this.scratchY[0] = underY + 2;
    this.scratchX[1] = -halfW * 0.25;
    this.scratchY[1] = underY - 3;
    this.scratchX[2] = halfW * 0.35;
    this.scratchY[2] = underY + 1;
    this.scratchX[3] = halfW;
    this.scratchY[3] = underY - 2;
    this.drawChromaticPolyline(ctx, 4, seed + 173, stepFrame, 2.0, 2, mainColor, 2.1, alpha * 0.85);

    ctx.restore();
  }

  private drawRadiatingZigZags(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    rayCount: number,
    seed: number,
    stepFrame: number,
    mainColor: string,
    alpha: number
  ): void {
    for (let r = 0; r < rayCount; r++) {
      const ang = (r / rayCount) * Math.PI * 2 + hashUnit(seed, r * 17) * 0.45;
      const cosA = Math.cos(ang);
      const sinA = Math.sin(ang);
      const perpX = -sinA;
      const perpY = cosA;
      const r0 = radius * 0.34;
      const r3 = radius * (0.85 + hashUnit(seed + 7, r * 19) * 0.45);
      const zig = radius * 0.14 * (r % 2 === 0 ? 1 : -1);

      this.scratchX[0] = cx + cosA * r0;
      this.scratchY[0] = cy + sinA * r0;
      this.scratchX[1] = cx + cosA * (r0 + (r3 - r0) * 0.36) + perpX * zig;
      this.scratchY[1] = cy + sinA * (r0 + (r3 - r0) * 0.36) + perpY * zig;
      this.scratchX[2] = cx + cosA * (r0 + (r3 - r0) * 0.68) - perpX * zig * 0.85;
      this.scratchY[2] = cy + sinA * (r0 + (r3 - r0) * 0.68) - perpY * zig * 0.85;
      this.scratchX[3] = cx + cosA * r3;
      this.scratchY[3] = cy + sinA * r3;

      this.drawChromaticPolyline(
        ctx,
        4,
        seed + r * 31,
        stepFrame,
        2.4,
        2,
        r % 2 === 0 ? mainColor : this.neonSecondary,
        2.2,
        alpha
      );
    }
  }

  private drawMuzzleBurst(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    size: number,
    seed: number,
    stepFrame: number,
    mainColor: string,
    alpha: number
  ): void {
    const spikes = 7;
    for (let i = 0; i <= spikes * 2; i++) {
      const idx = i % (spikes * 2);
      const ang = (idx / (spikes * 2)) * Math.PI * 2 - Math.PI * 0.5;
      const rad = idx % 2 === 0 ? size : size * 0.36;
      this.scratchX[i] = cx + Math.cos(ang) * rad;
      this.scratchY[i] = cy + Math.sin(ang) * rad;
    }
    this.drawChromaticPolyline(ctx, spikes * 2 + 1, seed, stepFrame, 2.2, 2, mainColor, 2.0, alpha);
  }

  private drawWhooshArcs(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    roll: number,
    scale: number,
    seed: number,
    stepFrame: number,
    mainColor: string,
    alpha: number
  ): void {
    const cosR = Math.cos(roll);
    const sinR = Math.sin(roll);
    for (let a = 0; a < 3; a++) {
      const side = a === 0 ? -1 : a === 1 ? 1 : -0.45;
      const startX = side * scale * (0.75 + a * 0.2);
      const startY = scale * 0.25;
      for (let i = 0; i < 6; i++) {
        const u = i / 5;
        const lx = startX + side * u * scale * 0.55 + Math.sin(u * Math.PI) * side * 14;
        const ly = startY + u * scale * 1.55;
        this.scratchX[i] = cx + lx * cosR - ly * sinR;
        this.scratchY[i] = cy + lx * sinR + ly * cosR;
      }
      this.drawChromaticPolyline(
        ctx,
        6,
        seed + a * 43,
        stepFrame,
        2.6,
        2,
        a === 1 ? this.neonSecondary : mainColor,
        2.4,
        alpha * (0.95 - a * 0.14)
      );
    }
  }

  private drawCrown(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    size: number,
    seed: number,
    stepFrame: number,
    mainColor: string,
    alpha: number
  ): void {
    // Jagged 3-peak neon crown
    const w = size * 1.15;
    const h = size * 0.72;
    this.scratchX[0] = cx - w * 0.52;
    this.scratchY[0] = cy + h * 0.42;
    this.scratchX[1] = cx - w * 0.62;
    this.scratchY[1] = cy - h * 0.36;
    this.scratchX[2] = cx - w * 0.24;
    this.scratchY[2] = cy + h * 0.04;
    this.scratchX[3] = cx;
    this.scratchY[3] = cy - h * 0.58;
    this.scratchX[4] = cx + w * 0.24;
    this.scratchY[4] = cy + h * 0.04;
    this.scratchX[5] = cx + w * 0.62;
    this.scratchY[5] = cy - h * 0.36;
    this.scratchX[6] = cx + w * 0.52;
    this.scratchY[6] = cy + h * 0.42;
    this.scratchX[7] = cx - w * 0.52;
    this.scratchY[7] = cy + h * 0.42;
    this.drawChromaticPolyline(ctx, 8, seed, stepFrame, 2.8, 3, mainColor, 2.8, alpha);
  }

  private drawSketchyX(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    seed: number,
    stepFrame: number,
    color: string,
    alpha: number
  ): void {
    this.scratchX[0] = cx - r;
    this.scratchY[0] = cy - r;
    this.scratchX[1] = cx + r;
    this.scratchY[1] = cy + r;
    this.drawChromaticPolyline(ctx, 2, seed, stepFrame, 2.2, 2, color, 2.6, alpha);

    this.scratchX[0] = cx + r;
    this.scratchY[0] = cy - r;
    this.scratchX[1] = cx - r;
    this.scratchY[1] = cy + r;
    this.drawChromaticPolyline(ctx, 2, seed + 17, stepFrame, 2.2, 2, color, 2.6, alpha);
  }

  private drawHeart(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    size: number,
    broken: boolean,
    seed: number,
    stepFrame: number,
    mainColor: string,
    alpha: number
  ): void {
    const pts = 16;
    for (let i = 0; i <= pts; i++) {
      const t = (i / pts) * Math.PI * 2;
      const hx = 16 * Math.pow(Math.sin(t), 3);
      const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      this.scratchX[i] = cx + (hx / 18) * size;
      this.scratchY[i] = cy + (hy / 18) * size;
    }
    this.drawChromaticPolyline(ctx, pts + 1, seed, stepFrame, 2.6, 3, mainColor, 2.7, alpha);

    if (broken) {
      this.scratchX[0] = cx + size * 0.05;
      this.scratchY[0] = cy - size * 0.55;
      this.scratchX[1] = cx - size * 0.16;
      this.scratchY[1] = cy - size * 0.14;
      this.scratchX[2] = cx + size * 0.18;
      this.scratchY[2] = cy + size * 0.18;
      this.scratchX[3] = cx - size * 0.06;
      this.scratchY[3] = cy + size * 0.72;
      this.drawChromaticPolyline(ctx, 4, seed + 61, stepFrame, 2.4, 2, this.neonSecondary, 2.9, alpha);
    }
  }

  private drawLightningBolts(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    size: number,
    seed: number,
    stepFrame: number,
    mainColor: string,
    alpha: number
  ): void {
    for (let b = 0; b < 3; b++) {
      const baseAng = -Math.PI * 0.75 + b * (Math.PI * 0.55) + hashUnit(seed, b * 13) * 0.25;
      const cosA = Math.cos(baseAng);
      const sinA = Math.sin(baseAng);
      const px = -sinA;
      const py = cosA;
      const len = size * (1.2 + b * 0.18);
      for (let i = 0; i < 7; i++) {
        const u = i / 6;
        const jag = i === 0 || i === 6 ? 0 : (i % 2 === 0 ? 1 : -1) * (10 + hashUnit(seed + b * 29, i) * 14);
        this.scratchX[i] = cx + cosA * (u * len) + px * jag;
        this.scratchY[i] = cy + sinA * (u * len) + py * jag;
      }
      this.drawChromaticPolyline(
        ctx,
        7,
        seed + b * 37,
        stepFrame,
        2.8,
        2,
        b === 1 ? this.neonSecondary : mainColor,
        2.6,
        alpha
      );
    }
  }

  private drawEyes(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    size: number,
    seed: number,
    stepFrame: number,
    mainColor: string,
    alpha: number
  ): void {
    const sep = size * 0.68;
    // Left and right glowing X-eyes with angular brow glints
    this.drawSketchyX(ctx, cx - sep, cy, size * 0.34, seed + 11, stepFrame, mainColor, alpha);
    this.drawSketchyX(ctx, cx + sep, cy, size * 0.34, seed + 29, stepFrame, mainColor, alpha);

    // Tilted wicked brow/glint arcs
    this.scratchX[0] = cx - sep - size * 0.45;
    this.scratchY[0] = cy - size * 0.45;
    this.scratchX[1] = cx - sep + size * 0.38;
    this.scratchY[1] = cy - size * 0.24;
    this.drawChromaticPolyline(ctx, 2, seed + 51, stepFrame, 2.0, 2, this.neonSecondary, 2.2, alpha * 0.88);

    this.scratchX[0] = cx + sep + size * 0.45;
    this.scratchY[0] = cy - size * 0.45;
    this.scratchX[1] = cx + sep - size * 0.38;
    this.scratchY[1] = cy - size * 0.24;
    this.drawChromaticPolyline(ctx, 2, seed + 73, stepFrame, 2.0, 2, this.neonSecondary, 2.2, alpha * 0.88);
  }

  private drawFlameSpikes(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    size: number,
    seed: number,
    stepFrame: number,
    mainColor: string,
    alpha: number
  ): void {
    const peaks = 5;
    const w = size * 1.45;
    let ptIdx = 0;
    for (let i = 0; i < peaks; i++) {
      const u0 = i / peaks - 0.5;
      const uMid = (i + 0.5) / peaks - 0.5;
      const peakH = size * (0.62 + (i === 2 ? 0.58 : i === 1 || i === 3 ? 0.32 : 0.12));
      this.scratchX[ptIdx] = cx + u0 * w;
      this.scratchY[ptIdx] = cy + size * 0.32;
      ptIdx++;
      this.scratchX[ptIdx] = cx + uMid * w + hashSigned(seed, stepFrame, i) * 5;
      this.scratchY[ptIdx] = cy - peakH;
      ptIdx++;
    }
    this.scratchX[ptIdx] = cx + w * 0.5;
    this.scratchY[ptIdx] = cy + size * 0.32;
    ptIdx++;
    this.drawChromaticPolyline(ctx, ptIdx, seed, stepFrame, 2.8, 3, mainColor, 2.7, alpha);
  }

  private drawWings(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    roll: number,
    scale: number,
    seed: number,
    stepFrame: number,
    mainColor: string,
    alpha: number
  ): void {
    const cosR = Math.cos(roll);
    const sinR = Math.sin(roll);
    for (let sIdx = 0; sIdx < 2; sIdx++) {
      const side = sIdx === 0 ? -1 : 1;
      for (let i = 0; i < WING_SKETCH_LEN; i++) {
        const lx = side * scale * WING_SKETCH_X[i];
        const ly = scale * WING_SKETCH_Y[i];
        this.scratchX[i] = cx + lx * cosR - ly * sinR;
        this.scratchY[i] = cy + lx * sinR + ly * cosR;
      }
      this.drawChromaticPolyline(
        ctx,
        WING_SKETCH_LEN,
        seed + (side < 0 ? 19 : 83),
        stepFrame,
        3.0,
        3,
        side < 0 ? mainColor : this.neonSecondary,
        2.5,
        alpha
      );
    }
  }

  updateAndRender(
    ctx: CanvasRenderingContext2D,
    timeSeconds: number,
    deltaSeconds: number,
    palette: LyricPalette,
    reduceMotion: boolean,
    fontFamily: string,
    width: number,
    height: number
  ): void {
    if (reduceMotion) {
      this.reset();
      return;
    }

    const dt = Math.max(0, Math.min(0.1, Number.isFinite(deltaSeconds) ? deltaSeconds : 0.016));
    let anyActive = false;
    for (let i = 0; i < MAX_SCRIBBLES; i++) {
      const s = this.slots[i];
      if (!s.active) continue;
      s.age += dt;
      if (s.age >= s.duration) {
        s.active = false;
      } else {
        anyActive = true;
      }
    }
    if (!anyActive) return;

    this.syncNeonColors(palette);
    // Authentic 2-frame stepped Arcane/Jinx hand-drawn chalk boil (~16Hz)
    const stepFrame = Math.floor(timeSeconds * 16);

    ctx.save();
    for (let i = 0; i < MAX_SCRIBBLES; i++) {
      const s = this.slots[i];
      if (!s.active) continue;

      const u = Math.max(0, Math.min(1, s.age / Math.max(0.05, s.duration)));
      // Snappy pop-in, crisp hold, clean alpha fade-out
      const env = u < 0.14 ? u / 0.14 : u < 0.62 ? 1.0 : Math.max(0, (1 - u) / 0.38);
      const alpha = env * 0.94;
      if (alpha <= 0.01) continue;

      const mainColor = s.useSecondary ? this.neonSecondary : this.neonPrimary;
      const sx = Math.max(48, Math.min(width - 48, s.screenX));
      const sy = Math.max(48, Math.min(height - 48, s.screenY));
      const shipX = Math.max(56, Math.min(width - 56, s.shipScreenX));
      const shipY = Math.max(56, Math.min(height - 56, s.shipScreenY));

      switch (s.kind) {
        case 'word_collect': {
          this.drawShipSilhouette(
            ctx,
            shipX + s.offsetX,
            shipY + s.offsetY,
            s.shipRoll,
            s.shipScale,
            s.seed,
            stepFrame,
            mainColor,
            alpha * 0.9
          );
          break;
        }
        case 'asteroid_split': {
          this.drawShipSilhouette(
            ctx,
            shipX + s.offsetX,
            shipY + s.offsetY,
            s.shipRoll,
            s.shipScale,
            s.seed + 3,
            stepFrame,
            this.neonPrimary,
            alpha * 0.72
          );
          this.drawRadiatingZigZags(
            ctx,
            sx,
            sy,
            56 + u * 26,
            6,
            s.seed + 19,
            stepFrame,
            mainColor,
            alpha * 0.92
          );
          this.drawGraffitiText(
            ctx,
            s.calloutText || 'BOOM!',
            sx,
            sy - 14 - u * 12,
            26 + (1 - u) * 5,
            s.tiltRad,
            s.seed + 41,
            stepFrame,
            mainColor,
            fontFamily,
            alpha
          );
          break;
        }
        case 'laser_salvo': {
          const muzzleSpan = s.shipScale * 0.72;
          const cosR = Math.cos(s.shipRoll);
          const sinR = Math.sin(s.shipRoll);
          const lx = shipX - muzzleSpan * cosR + s.shipScale * 0.4 * sinR;
          const ly = shipY - muzzleSpan * sinR - s.shipScale * 0.4 * cosR;
          const rx = shipX + muzzleSpan * cosR + s.shipScale * 0.4 * sinR;
          const ry = shipY + muzzleSpan * sinR - s.shipScale * 0.4 * cosR;
          this.drawMuzzleBurst(ctx, lx, ly, 16 + u * 8, s.seed + 7, stepFrame, mainColor, alpha * 0.9);
          this.drawMuzzleBurst(ctx, rx, ry, 16 + u * 8, s.seed + 23, stepFrame, this.neonSecondary, alpha * 0.9);
          this.drawGraffitiText(
            ctx,
            s.calloutText || 'PEW PEW',
            shipX + s.offsetX * 2.2,
            shipY - s.shipScale * 0.95 - u * 10,
            22,
            s.tiltRad,
            s.seed + 59,
            stepFrame,
            mainColor,
            fontFamily,
            alpha
          );
          break;
        }
        case 'whoosh_boost': {
          this.drawWhooshArcs(
            ctx,
            shipX + s.offsetX,
            shipY + s.offsetY,
            s.shipRoll,
            s.shipScale,
            s.seed + 11,
            stepFrame,
            mainColor,
            alpha * 0.9
          );
          this.drawShipSilhouette(
            ctx,
            shipX + s.offsetX * 1.25,
            shipY + s.offsetY,
            s.shipRoll,
            s.shipScale * 1.04,
            s.seed + 29,
            stepFrame,
            this.neonSecondary,
            alpha * 0.78
          );
          this.drawGraffitiText(
            ctx,
            s.calloutText || 'WHOOSH!',
            shipX - s.offsetX * 2.4,
            shipY + s.shipScale * 0.72,
            24,
            s.tiltRad,
            s.seed + 71,
            stepFrame,
            mainColor,
            fontFamily,
            alpha
          );
          break;
        }
        case 'semantic_crown': {
          this.drawCrown(
            ctx,
            shipX,
            shipY - s.shipScale * 0.92 - u * 8,
            34,
            s.seed,
            stepFrame,
            mainColor,
            alpha
          );
          break;
        }
        case 'semantic_crazy': {
          this.drawGraffitiText(
            ctx,
            'HA HA',
            sx + s.offsetX * 1.6,
            sy - 26 - u * 10,
            28,
            s.tiltRad * 1.3,
            s.seed + 13,
            stepFrame,
            mainColor,
            fontFamily,
            alpha
          );
          this.drawSketchyX(ctx, sx - 58, sy - 10, 12, s.seed + 31, stepFrame, this.neonSecondary, alpha * 0.92);
          this.drawSketchyX(ctx, sx + 62, sy + 12, 10, s.seed + 47, stepFrame, mainColor, alpha * 0.92);
          this.drawSketchyX(ctx, sx + 32, sy - 46, 8, s.seed + 67, stepFrame, this.neonSecondary, alpha * 0.82);
          break;
        }
        case 'semantic_love': {
          this.drawHeart(
            ctx,
            sx,
            sy - 14 - u * 10,
            32,
            s.brokenVariant,
            s.seed,
            stepFrame,
            mainColor,
            alpha
          );
          break;
        }
        case 'semantic_electric': {
          this.drawLightningBolts(ctx, shipX, shipY, 44 + u * 14, s.seed, stepFrame, mainColor, alpha);
          break;
        }
        case 'semantic_eyes': {
          this.drawEyes(
            ctx,
            shipX,
            shipY - s.shipScale * 0.85,
            28,
            s.seed,
            stepFrame,
            mainColor,
            alpha
          );
          break;
        }
        case 'semantic_fire': {
          this.drawFlameSpikes(ctx, sx, sy + 10, 38, s.seed, stepFrame, mainColor, alpha);
          break;
        }
        case 'semantic_wings': {
          this.drawWings(
            ctx,
            shipX,
            shipY,
            s.shipRoll,
            s.shipScale,
            s.seed,
            stepFrame,
            mainColor,
            alpha
          );
          break;
        }
      }
    }
    ctx.restore();
  }
}
