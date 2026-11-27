// WebGL2 procedural shader effect layer with automatic Canvas2D graceful fallback.
// Supports LiquidMetal, HoloVaporwave, CRTScanline, Starfield, and AmbientFlow effects.

export type WebGlEffectMode =
  | 'none'
  | 'liquidMetal'
  | 'holoVaporwave'
  | 'crtScanline'
  | 'starfield'
  | 'ambientFlow';

export interface WebGlEffectParams {
  timeSeconds: number;
  rmsLevel: number;
  bassEnergy: number;
  midEnergy: number;
  trebleEnergy: number;
  beatDetected: boolean;
  reduceMotion: boolean;
  isOverlayMode: boolean;
  bgDeepHex: string;
  bgMidHex: string;
  accentPrimaryHex: string;
  accentSecondaryHex: string;
  variationIndex?: number;
  backgroundOpacity?: number;
}

const VERTEX_SHADER_SRC = `#version 300 es
precision highp float;
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAGMENT_SHADERS: Record<Exclude<WebGlEffectMode, 'none'>, string> = {
  liquidMetal: `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform vec2 u_res;
uniform float u_time;
uniform float u_rms;
uniform float u_bass;
uniform float u_treble;
uniform float u_beat;
uniform float u_reduceMotion;
uniform float u_variation;
uniform float u_bgOpacity;
uniform vec3 u_bgDeep;
uniform vec3 u_bgMid;
uniform vec3 u_accent1;
uniform vec3 u_accent2;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = rot * p * 2.02;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / max(1.0, min(u_res.x, u_res.y));
  float t = u_time * (u_reduceMotion > 0.5 ? 0.08 : 0.32);
  vec2 q = vec2(fbm(uv * 2.2 + vec2(t, -t * 0.6)), fbm(uv * 2.2 + vec2(-t * 0.5, t * 0.8)));
  float f = fbm(uv * 2.8 + q * (1.8 + u_bass * 0.8));
  float ridge = pow(max(0.0, 1.0 - abs(f * 2.0 - 1.0)), 3.6);
  float spec = pow(max(0.0, ridge), 3.4) * (0.72 + u_treble * 0.6 + u_beat * 0.42);

  vec3 col;
  if (u_variation < 0.5) {
    // Variation 0: Obsidian Chrome (#07090e deep obsidian + crisp high-contrast silver specular ridges, NO grey wash)
    vec3 obsidianDeep = vec3(0.027, 0.035, 0.055); // #07090e
    vec3 obsidianValley = vec3(0.016, 0.020, 0.033);
    vec3 silverRidge = vec3(0.76, 0.83, 0.93);
    vec3 chromeHighlight = vec3(0.94, 0.97, 1.0);
    vec3 base = mix(obsidianValley, obsidianDeep, smoothstep(0.15, 0.85, f));
    col = base + silverRidge * (ridge * 0.24) + chromeHighlight * (spec * 0.34);
  } else if (u_variation < 1.5) {
    // Variation 1: Holo Vaporwave (#090517 deep midnight synthwave + cyan/magenta/violet sheen)
    vec3 midnight = vec3(0.035, 0.020, 0.090); // #090517
    vec3 deepViolet = vec3(0.068, 0.032, 0.155);
    vec3 cyan = vec3(0.0, 0.90, 1.0);
    vec3 magenta = vec3(1.0, 0.16, 0.58);
    vec3 violet = vec3(0.56, 0.22, 0.96);
    vec3 holo = mix(cyan, magenta, clamp(q.x * 1.2, 0.0, 1.0));
    holo = mix(holo, violet, clamp(q.y, 0.0, 1.0));
    col = mix(midnight, deepViolet, smoothstep(0.2, 0.9, f));
    col += holo * (ridge * 0.30 + spec * 0.32);
  } else {
    // Variation 2: Mercury Album Tint (live album palette infused into dark liquid mercury)
    vec3 obsidian = vec3(0.027, 0.035, 0.055);
    vec3 base = mix(obsidian, u_bgDeep * 0.52, 0.48);
    vec3 tint = mix(u_accent1, u_accent2, clamp(q.x * 1.15, 0.0, 1.0));
    col = base + tint * (ridge * 0.28) + mix(tint, vec3(0.90, 0.95, 1.0), 0.55) * (spec * 0.32);
  }

  // Subtle center contrast scrim for crisp lyric legibility
  float centerDist = length(uv * vec2(0.85, 1.25));
  float vig = smoothstep(1.15, 0.25, centerDist);
  col *= mix(0.62, 1.0, vig);
  col *= (0.86 + u_rms * 0.16);
  outColor = vec4(clamp(col, 0.0, 0.56), clamp(u_bgOpacity, 0.2, 1.0));
}
`,

  holoVaporwave: `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform vec2 u_res;
uniform float u_time;
uniform float u_rms;
uniform float u_bass;
uniform float u_treble;
uniform float u_beat;
uniform float u_reduceMotion;
uniform float u_variation;
uniform float u_bgOpacity;
uniform vec3 u_bgDeep;
uniform vec3 u_bgMid;
uniform vec3 u_accent1;
uniform vec3 u_accent2;

void main() {
  vec2 uv = v_uv;
  float horizon = 0.38;
  float t = u_time * (u_reduceMotion > 0.5 ? 0.15 : 1.0);
  vec3 midnightTop = vec3(0.035, 0.020, 0.090); // #090517
  vec3 midnightMid = vec3(0.075, 0.035, 0.165);
  vec3 col = mix(midnightMid, midnightTop, smoothstep(0.0, 1.0, uv.y));

  if (uv.y >= horizon) {
    float skyT = (uv.y - horizon) / max(0.001, 1.0 - horizon);
    col = mix(mix(midnightMid, u_bgMid * 0.45, 0.35), midnightTop, pow(skyT, 0.7));
    vec2 sunPos = vec2(0.5, horizon + 0.14);
    vec2 d = (uv - sunPos) * vec2(u_res.x / max(1.0, u_res.y), 1.0);
    float dist = length(d);
    float sun = smoothstep(0.18 + u_bass * 0.02, 0.16 + u_bass * 0.02, dist);
    float stripes = step(0.22, fract((uv.y - horizon) * 26.0 - t * 0.18));
    float sunMask = sun * mix(1.0, stripes, smoothstep(horizon + 0.18, horizon, uv.y));
    vec3 sunCol = mix(vec3(1.0, 0.18, 0.58), vec3(0.0, 0.90, 1.0), clamp((uv.y - horizon) * 3.0, 0.0, 1.0));
    col += sunCol * sunMask * 0.32;
    col += vec3(0.56, 0.22, 0.96) * exp(-dist * 5.5) * (0.14 + u_beat * 0.1);
  } else {
    float py = max(0.015, horizon - uv.y);
    float z = 0.28 / py;
    float x = (uv.x - 0.5) * z * (u_res.x / max(1.0, u_res.y));
    float gz = z + t * 1.4;
    float lineX = abs(fract(x * 0.9 - 0.5) - 0.5) / max(0.001, fwidth(x * 0.9));
    float lineZ = abs(fract(gz * 0.9 - 0.5) - 0.5) / max(0.001, fwidth(gz * 0.9));
    float grid = 1.0 - min(min(lineX, lineZ), 1.0);
    float fade = exp(-py * 2.4) * (0.42 + u_rms * 0.35 + u_beat * 0.18);
    col = mix(midnightTop, midnightMid * 0.72, exp(-py * 4.0));
    vec3 gridCol = mix(vec3(0.0, 0.90, 1.0), vec3(1.0, 0.18, 0.58), clamp(uv.x, 0.0, 1.0));
    col += gridCol * grid * fade;
  }

  // Dark center lyric scrim for crisp WCAG readability
  vec2 centerD = (uv - vec2(0.5, 0.46)) * vec2(1.0, 1.5);
  float centerScrim = exp(-dot(centerD, centerD) * 4.5);
  col *= (1.0 - centerScrim * 0.52);

  float scan = 0.96 + 0.04 * sin(gl_FragCoord.y * 1.5);
  col *= scan;
  outColor = vec4(col, clamp(u_bgOpacity, 0.2, 1.0));
}
`,

  crtScanline: `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform vec2 u_res;
uniform float u_time;
uniform float u_rms;
uniform float u_bass;
uniform float u_treble;
uniform float u_beat;
uniform float u_reduceMotion;
uniform float u_variation;
uniform float u_bgOpacity;
uniform vec3 u_bgDeep;
uniform vec3 u_bgMid;
uniform vec3 u_accent1;
uniform vec3 u_accent2;

void main() {
  vec2 c = v_uv * 2.0 - 1.0;
  float r2 = dot(c, c);
  vec2 warped = c * (1.0 + 0.055 * r2);
  vec2 uv = warped * 0.5 + 0.5;

  // True opaque deep CRT glass per variation (never washed-out grey)
  vec3 glassDeep;
  vec3 phosphorTint;
  if (u_variation < 0.5) {
    // Variation 0: P31 Green (#030605)
    glassDeep = vec3(0.012, 0.024, 0.020);
    phosphorTint = vec3(0.20, 0.84, 0.58);
  } else if (u_variation < 1.5) {
    // Variation 1: P3 Amber (#070503)
    glassDeep = vec3(0.027, 0.020, 0.012);
    phosphorTint = vec3(0.98, 0.74, 0.14);
  } else {
    // Variation 2: Trinitron RGB (#050709)
    glassDeep = vec3(0.020, 0.027, 0.035);
    phosphorTint = mix(vec3(0.38, 0.72, 0.98), u_accent1, 0.65);
  }

  float vig = smoothstep(1.45, 0.22, r2);
  vec3 bezelBlack = vec3(0.006, 0.008, 0.010);
  vec3 base = mix(bezelBlack, glassDeep, vig);

  // Dark scanlines & aperture grille mask
  float scan = 0.84 + 0.16 * sin(gl_FragCoord.y * 3.14159);
  float rgbMask = 0.93 + 0.07 * sin(gl_FragCoord.x * 2.094);
  float sweepY = fract(u_time * (u_reduceMotion > 0.5 ? 0.0 : 0.1));
  float sweep = exp(-abs(uv.y - sweepY) * 24.0) * (u_reduceMotion > 0.5 ? 0.0 : 0.042);

  vec3 phosphor = base * scan * rgbMask + phosphorTint * (sweep + (u_rms * 0.024 + u_beat * 0.022) * vig);
  phosphor *= mix(0.25, 1.0, vig);
  outColor = vec4(clamp(phosphor, 0.0, 0.26), clamp(u_bgOpacity, 0.2, 1.0));
}
`,

  starfield: `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform vec2 u_res;
uniform float u_time;
uniform float u_rms;
uniform float u_bass;
uniform float u_treble;
uniform float u_beat;
uniform float u_reduceMotion;
uniform float u_variation;
uniform float u_bgOpacity;
uniform vec3 u_bgDeep;
uniform vec3 u_bgMid;
uniform vec3 u_accent1;
uniform vec3 u_accent2;

float sfHash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float sfNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(sfHash21(i), sfHash21(i + vec2(1.0, 0.0)), u.x),
    mix(sfHash21(i + vec2(0.0, 1.0)), sfHash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float sfFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * sfNoise(p);
    p = rot * p * 2.03;
    a *= 0.5;
  }
  return v;
}

void main() {
  float minDim = max(1.0, min(u_res.x, u_res.y));
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / minDim;
  float drift = u_reduceMotion > 0.5 ? 0.0 : u_time * 0.012;

  // Serene deep velvet midnight-blue/indigo sky respecting u_variation
  vec3 midnightSky;
  float nebulaLift;
  if (u_variation < 0.5) {
    // deep-space
    midnightSky = mix(vec3(0.012, 0.018, 0.048), u_bgDeep * 0.72, 0.55);
    nebulaLift = 0.20;
  } else if (u_variation < 1.5) {
    // nebula-run
    midnightSky = mix(vec3(0.016, 0.021, 0.058), u_bgDeep * 0.78, 0.60);
    nebulaLift = 0.38;
  } else if (u_variation < 2.5) {
    // retro-wireframe (deeper pitch-black)
    midnightSky = mix(vec3(0.005, 0.006, 0.015), u_bgDeep * 0.24, 0.30);
    nebulaLift = 0.08;
  } else {
    // vaporwave (deep twilight gradient #070214 -> #1b0633 -> #3a0d47)
    vec3 vTop = vec3(0.027, 0.008, 0.078);
    vec3 vMid = vec3(0.106, 0.024, 0.200);
    vec3 vHor = vec3(0.227, 0.051, 0.278);
    float vh = clamp(v_uv.y, 0.0, 1.0);
    midnightSky = vh > 0.55
      ? mix(vMid, vTop, smoothstep(0.55, 0.98, vh))
      : mix(vHor, vMid, smoothstep(0.15, 0.55, vh));
    nebulaLift = 0.0;
  }

  float horizonGrad = smoothstep(-0.75, 0.75, v_uv.y);
  vec3 skyVelvet = u_variation >= 2.5
    ? midnightSky
    : mix(midnightSky * 0.82, mix(midnightSky, u_bgMid * 0.32, 0.35), 1.0 - horizonGrad * 0.65);

  // Subtle diagonal Milky Way & album-art-tinted smooth FBM nebula veil
  vec2 mwUv = mat2(0.848, -0.530, 0.530, 0.848) * uv;
  float band = exp(-pow(mwUv.y * 2.15, 2.0));
  float fbmBroad = sfFbm(mwUv * 2.1 + vec2(drift, -drift * 0.35));
  float fbmDetail = sfFbm(mwUv * 4.4 - vec2(drift * 0.45, 0.0) + vec2(fbmBroad * 0.55));
  float veil = band * smoothstep(0.24, 0.88, fbmBroad * 0.6 + fbmDetail * 0.4);
  vec3 nebulaTint = mix(u_accent1, u_accent2, clamp(fbmDetail * 1.15, 0.0, 1.0));
  vec3 col = skyVelvet + nebulaTint * (veil * nebulaLift * (0.88 + u_rms * 0.22));

  // Crisp sub-pixel twinkling background stars (static positions, zero zooming circles, zero jitter)
  vec2 starCoord = gl_FragCoord.xy / minDim;
  for (int layer = 0; layer < 3; layer++) {
    float fl = float(layer);
    float density = layer == 0 ? 44.0 : (layer == 1 ? 82.0 : 136.0);
    vec2 cellUv = starCoord * density + vec2(fl * 29.7, fl * 17.3);
    vec2 id = floor(cellUv);
    vec2 gv = fract(cellUv) - 0.5;
    float h1 = sfHash21(id);
    if (h1 > 0.64) {
      float h2 = sfHash21(id + vec2(11.3, 5.7));
      vec2 offset = (vec2(h2, fract(h1 * 37.13)) - 0.5) * 0.76;
      float d = length(gv - offset);
      float pinpoint = exp(-d * d * 2600.0) * smoothstep(0.048, 0.004, d);
      float twinkle = u_reduceMotion > 0.5
        ? 0.88
        : (0.58 + 0.42 * sin(u_time * (0.85 + h2 * 1.75) + h1 * 62.8318));
      float mag = mix(0.35, 1.0, fract(h1 * 19.7)) * (1.0 - fl * 0.18);
      vec3 starCol = h2 < 0.52
        ? vec3(0.973, 0.980, 0.988)
        : (h2 < 0.80 ? vec3(0.812, 0.894, 1.0) : vec3(1.0, 0.894, 0.710));
      col += starCol * pinpoint * twinkle * mag * (0.78 + u_treble * 0.22);
    }
  }

  outColor = vec4(col, clamp(u_bgOpacity, 0.2, 1.0));
}
`,

  ambientFlow: `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform vec2 u_res;
uniform float u_time;
uniform float u_rms;
uniform float u_bass;
uniform float u_treble;
uniform float u_beat;
uniform float u_reduceMotion;
uniform float u_variation;
uniform float u_bgOpacity;
uniform vec3 u_bgDeep;
uniform vec3 u_bgMid;
uniform vec3 u_accent1;
uniform vec3 u_accent2;

void main() {
  vec2 uv = v_uv;
  float t = u_time * (u_reduceMotion > 0.5 ? 0.05 : 0.22);
  vec2 p1 = vec2(0.28 + 0.16 * sin(t * 0.9), 0.34 + 0.14 * cos(t * 0.7));
  vec2 p2 = vec2(0.74 + 0.15 * cos(t * 0.8), 0.64 + 0.16 * sin(t * 1.1));
  float g1 = exp(-dot(uv - p1, uv - p1) * 4.2);
  float g2 = exp(-dot(uv - p2, uv - p2) * 3.8);

  vec3 col = mix(u_bgDeep, u_bgMid, uv.y * 0.75 + 0.15);
  col += u_accent1 * g1 * (0.28 + u_bass * 0.18);
  col += u_accent2 * g2 * (0.24 + u_rms * 0.16);
  outColor = vec4(col, clamp(u_bgOpacity, 0.2, 1.0));
}
`,
};

interface CompiledProgram {
  program: WebGLProgram;
  uRes: WebGLUniformLocation | null;
  uTime: WebGLUniformLocation | null;
  uRms: WebGLUniformLocation | null;
  uBass: WebGLUniformLocation | null;
  uTreble: WebGLUniformLocation | null;
  uBeat: WebGLUniformLocation | null;
  uReduceMotion: WebGLUniformLocation | null;
  uVariation: WebGLUniformLocation | null;
  uBgOpacity: WebGLUniformLocation | null;
  uBgDeep: WebGLUniformLocation | null;
  uBgMid: WebGLUniformLocation | null;
  uAccent1: WebGLUniformLocation | null;
  uAccent2: WebGLUniformLocation | null;
}

export function parseColorToRgbInto(color: string, out: Float32Array): void {
  const trimmed = typeof color === 'string' ? color.trim() : '';
  if (trimmed.startsWith('#')) {
    const cleaned = trimmed.slice(1);
    if (cleaned.length === 6 || cleaned.length === 8) {
      const r = parseInt(cleaned.slice(0, 2), 16);
      const g = parseInt(cleaned.slice(2, 4), 16);
      const b = parseInt(cleaned.slice(4, 6), 16);
      if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
        out[0] = r / 255;
        out[1] = g / 255;
        out[2] = b / 255;
        return;
      }
    }
    if (cleaned.length === 3) {
      const r = parseInt(cleaned[0] + cleaned[0], 16);
      const g = parseInt(cleaned[1] + cleaned[1], 16);
      const b = parseInt(cleaned[2] + cleaned[2], 16);
      if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
        out[0] = r / 255;
        out[1] = g / 255;
        out[2] = b / 255;
        return;
      }
    }
  }

  const rgbMatch = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i.exec(trimmed);
  if (rgbMatch) {
    const r = Math.max(0, Math.min(255, Number(rgbMatch[1])));
    const g = Math.max(0, Math.min(255, Number(rgbMatch[2])));
    const b = Math.max(0, Math.min(255, Number(rgbMatch[3])));
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      out[0] = r / 255;
      out[1] = g / 255;
      out[2] = b / 255;
      return;
    }
  }

  out[0] = 0.08;
  out[1] = 0.09;
  out[2] = 0.14;
}

export class WebGlEffectLayer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private fallbackCtx: CanvasRenderingContext2D | null = null;
  private programs: Map<Exclude<WebGlEffectMode, 'none'>, CompiledProgram> = new Map();
  private vao: WebGLVertexArrayObject | null = null;
  private vbo: WebGLBuffer | null = null;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private disposed = false;
  private readonly boundContextLost: (e: Event) => void;
  private readonly boundContextRestored: () => void;

  // Pre-allocated RGB scratch buffers (zero per-frame heap allocations)
  private readonly rgbBgDeep = new Float32Array(3);
  private readonly rgbBgMid = new Float32Array(3);
  private readonly rgbAccent1 = new Float32Array(3);
  private readonly rgbAccent2 = new Float32Array(3);

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.boundContextLost = (e: Event) => {
      if (typeof (e as { preventDefault?: () => void }).preventDefault === 'function') {
        e.preventDefault();
      }
      this.handleContextLost();
    };
    this.boundContextRestored = () => {
      this.handleContextRestored();
    };
    if (typeof this.canvas.addEventListener === 'function') {
      this.canvas.addEventListener('webglcontextlost', this.boundContextLost);
      this.canvas.addEventListener('webglcontextrestored', this.boundContextRestored);
    }
    this.initContext();
  }

  private handleContextLost(): void {
    if (this.disposed) return;
    this.programs.clear();
    this.vao = null;
    this.vbo = null;
    this.gl = null;
    try {
      this.fallbackCtx = this.canvas.getContext('2d');
      if (this.fallbackCtx && typeof this.fallbackCtx.setTransform === 'function') {
        this.fallbackCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      }
    } catch {
      this.fallbackCtx = null;
    }
  }

  private handleContextRestored(): void {
    if (this.disposed) return;
    this.programs.clear();
    this.vao = null;
    this.vbo = null;
    this.initContext();
    if (this.gl) {
      this.gl.viewport(0, 0, Math.max(1, this.canvas.width), Math.max(1, this.canvas.height));
    }
  }

  get isWebGlActive(): boolean {
    return this.gl !== null && !this.disposed;
  }

  get isRenderable(): boolean {
    return Boolean((this.gl || this.fallbackCtx) && !this.disposed);
  }

  private initContext(): void {
    try {
      const gl = this.canvas.getContext('webgl2', {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'low-power',
        preserveDrawingBuffer: true,
      }) as WebGL2RenderingContext | null;

      if (gl && typeof gl.createShader === 'function') {
        if (typeof gl.isContextLost === 'function' && gl.isContextLost()) {
          try {
            gl.getExtension('WEBGL_lose_context')?.restoreContext();
          } catch {
            // Ignore restore failure
          }
        }
        if (typeof gl.isContextLost !== 'function' || !gl.isContextLost()) {
          this.gl = gl;
          this.fallbackCtx = null;
          this.setupQuad(gl);
          if (this.gl) {
            this.gl.viewport(0, 0, Math.max(1, this.canvas.width), Math.max(1, this.canvas.height));
            return;
          }
        }
      }
    } catch {
      // Fall through to Canvas2D fallback
    }

    this.gl = null;
    try {
      this.fallbackCtx = this.canvas.getContext('2d');
    } catch {
      this.fallbackCtx = null;
    }
  }

  private setupQuad(gl: WebGL2RenderingContext): void {
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    if (!vao || !vbo) {
      this.gl = null;
      this.fallbackCtx = this.canvas.getContext('2d');
      return;
    }
    this.vao = vao;
    this.vbo = vbo;

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    const verts = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  private compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  private getOrCompileProgram(mode: Exclude<WebGlEffectMode, 'none'>): CompiledProgram | null {
    if (!this.gl) return null;
    const cached = this.programs.get(mode);
    if (cached) return cached;

    const gl = this.gl;
    const vs = this.compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
    const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADERS[mode]);
    if (!vs || !fs) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      return null;
    }

    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return null;
    }
    gl.bindAttribLocation(program, 0, 'a_pos');
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return null;
    }

    const compiled: CompiledProgram = {
      program,
      uRes: gl.getUniformLocation(program, 'u_res'),
      uTime: gl.getUniformLocation(program, 'u_time'),
      uRms: gl.getUniformLocation(program, 'u_rms'),
      uBass: gl.getUniformLocation(program, 'u_bass'),
      uTreble: gl.getUniformLocation(program, 'u_treble'),
      uBeat: gl.getUniformLocation(program, 'u_beat'),
      uReduceMotion: gl.getUniformLocation(program, 'u_reduceMotion'),
      uVariation: gl.getUniformLocation(program, 'u_variation'),
      uBgOpacity: gl.getUniformLocation(program, 'u_bgOpacity'),
      uBgDeep: gl.getUniformLocation(program, 'u_bgDeep'),
      uBgMid: gl.getUniformLocation(program, 'u_bgMid'),
      uAccent1: gl.getUniformLocation(program, 'u_accent1'),
      uAccent2: gl.getUniformLocation(program, 'u_accent2'),
    };
    this.programs.set(mode, compiled);
    return compiled;
  }

  resize(width: number, height: number, dpr: number): void {
    if (this.disposed) return;
    const clampedDpr = Math.max(1, Math.min(2, Number.isFinite(dpr) ? dpr : 1));
    const safeW = Math.max(1, Math.floor(width));
    const safeH = Math.max(1, Math.floor(height));
    const physW = Math.max(1, Math.floor(safeW * clampedDpr));
    const physH = Math.max(1, Math.floor(safeH * clampedDpr));

    if (this.width === safeW && this.height === safeH && this.dpr === clampedDpr &&
        this.canvas.width === physW && this.canvas.height === physH) {
      return;
    }

    this.width = safeW;
    this.height = safeH;
    this.dpr = clampedDpr;
    this.canvas.width = physW;
    this.canvas.height = physH;

    if (this.gl) {
      this.gl.viewport(0, 0, physW, physH);
    } else if (this.fallbackCtx && typeof this.fallbackCtx.setTransform === 'function') {
      this.fallbackCtx.setTransform(clampedDpr, 0, 0, clampedDpr, 0, 0);
    }
  }

  clear(): void {
    if (this.disposed) return;
    if (this.gl) {
      this.gl.clearColor(0, 0, 0, 0);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    } else if (this.fallbackCtx) {
      this.fallbackCtx.clearRect(0, 0, this.width, this.height);
    }
  }

  render(mode: WebGlEffectMode, params: WebGlEffectParams): void {
    if (this.disposed) return;
    if (mode === 'none' || params.isOverlayMode) {
      this.clear();
      return;
    }

    const variationIndex =
      typeof params.variationIndex === 'number' && Number.isFinite(params.variationIndex)
        ? params.variationIndex
        : 0;
    const bgOpacity =
      typeof params.backgroundOpacity === 'number' && Number.isFinite(params.backgroundOpacity)
        ? Math.max(0.2, Math.min(1.0, params.backgroundOpacity))
        : 0.95;

    if (this.gl && this.vao) {
      const prog = this.getOrCompileProgram(mode);
      if (prog) {
        const gl = this.gl;
        parseColorToRgbInto(params.bgDeepHex, this.rgbBgDeep);
        parseColorToRgbInto(params.bgMidHex, this.rgbBgMid);
        parseColorToRgbInto(params.accentPrimaryHex, this.rgbAccent1);
        parseColorToRgbInto(params.accentSecondaryHex, this.rgbAccent2);

        gl.useProgram(prog.program);
        gl.uniform2f(prog.uRes, this.canvas.width, this.canvas.height);
        gl.uniform1f(prog.uTime, params.timeSeconds);
        gl.uniform1f(prog.uRms, params.rmsLevel);
        gl.uniform1f(prog.uBass, params.bassEnergy);
        gl.uniform1f(prog.uTreble, params.trebleEnergy);
        gl.uniform1f(prog.uBeat, params.beatDetected ? 1.0 : 0.0);
        gl.uniform1f(prog.uReduceMotion, params.reduceMotion ? 1.0 : 0.0);
        gl.uniform1f(prog.uVariation, variationIndex);
        gl.uniform1f(prog.uBgOpacity, bgOpacity);
        gl.uniform3f(prog.uBgDeep, this.rgbBgDeep[0], this.rgbBgDeep[1], this.rgbBgDeep[2]);
        gl.uniform3f(prog.uBgMid, this.rgbBgMid[0], this.rgbBgMid[1], this.rgbBgMid[2]);
        gl.uniform3f(prog.uAccent1, this.rgbAccent1[0], this.rgbAccent1[1], this.rgbAccent1[2]);
        gl.uniform3f(prog.uAccent2, this.rgbAccent2[0], this.rgbAccent2[1], this.rgbAccent2[2]);

        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.bindVertexArray(null);
        return;
      }
    }

    // Automatic Canvas2D fallback when WebGL2 is unavailable
    this.renderFallback2D(mode, params);
  }

  private renderFallback2D(mode: Exclude<WebGlEffectMode, 'none'>, params: WebGlEffectParams): void {
    const ctx = this.fallbackCtx;
    if (!ctx) return;

    const w = this.width;
    const h = this.height;
    const t = params.reduceMotion ? 0 : params.timeSeconds;
    const variationIndex =
      typeof params.variationIndex === 'number' && Number.isFinite(params.variationIndex)
        ? Math.round(params.variationIndex)
        : 0;
    const bgOpacity =
      typeof params.backgroundOpacity === 'number' && Number.isFinite(params.backgroundOpacity)
        ? Math.max(0.2, Math.min(1.0, params.backgroundOpacity))
        : 0.95;

    ctx.save();
    ctx.globalAlpha = bgOpacity;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    if (mode === 'crtScanline') {
      if (variationIndex === 1) {
        grad.addColorStop(0, '#070503');
        grad.addColorStop(1, '#040302');
      } else if (variationIndex === 2) {
        grad.addColorStop(0, '#050709');
        grad.addColorStop(1, '#030406');
      } else {
        grad.addColorStop(0, '#030605');
        grad.addColorStop(1, '#020403');
      }
    } else if (mode === 'holoVaporwave') {
      grad.addColorStop(0, '#090517');
      grad.addColorStop(1, '#120828');
    } else if (mode === 'liquidMetal') {
      if (variationIndex === 1) {
        grad.addColorStop(0, '#090517');
        grad.addColorStop(1, '#120828');
      } else {
        grad.addColorStop(0, '#07090e');
        grad.addColorStop(1, '#0b0e17');
      }
    } else if (mode === 'starfield' && variationIndex === 3) {
      grad.addColorStop(0, '#070214');
      grad.addColorStop(0.45, '#1b0633');
      grad.addColorStop(0.68, '#3a0d47');
      grad.addColorStop(1, '#120424');
    } else {
      grad.addColorStop(0, params.bgDeepHex);
      grad.addColorStop(1, params.bgMidHex);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    if (mode === 'liquidMetal') {
      const cx = w * (0.5 + 0.12 * Math.sin(t * 0.45));
      const cy = h * (0.45 + 0.1 * Math.cos(t * 0.35));
      const rad = Math.max(w, h) * (0.42 + params.bassEnergy * 0.12);
      const sheen = ctx.createRadialGradient(cx, cy, rad * 0.05, cx, cy, rad);
      if (variationIndex === 0) {
        sheen.addColorStop(0, '#e2e8f0');
        sheen.addColorStop(0.45, '#64748b');
        sheen.addColorStop(1, 'rgba(0,0,0,0)');
      } else if (variationIndex === 1) {
        sheen.addColorStop(0, '#00e5ff');
        sheen.addColorStop(0.5, '#ff2a94');
        sheen.addColorStop(1, 'rgba(0,0,0,0)');
      } else {
        sheen.addColorStop(0, params.accentPrimaryHex);
        sheen.addColorStop(0.5, params.accentSecondaryHex);
        sheen.addColorStop(1, 'rgba(0,0,0,0)');
      }
      ctx.globalAlpha = (0.14 + params.rmsLevel * 0.1) * bgOpacity;
      ctx.fillStyle = sheen;
      ctx.fillRect(0, 0, w, h);
    } else if (mode === 'holoVaporwave') {
      const horizonY = h * 0.56;
      ctx.strokeStyle = '#00e5ff';
      ctx.globalAlpha = (0.24 + params.bassEnergy * 0.16) * bgOpacity;
      ctx.lineWidth = 1;
      for (let i = 1; i <= 8; i++) {
        const y = horizonY + ((h - horizonY) * (i * i)) / 64;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      for (let i = -6; i <= 6; i++) {
        ctx.beginPath();
        ctx.moveTo(w * 0.5 + i * (w * 0.04), horizonY);
        ctx.lineTo(w * 0.5 + i * (w * 0.18), h);
        ctx.stroke();
      }
    } else if (mode === 'crtScanline') {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      for (let y = 0; y < h; y += 3) {
        ctx.fillRect(0, y, w, 1);
      }
      const vig = ctx.createRadialGradient(
        w * 0.5,
        h * 0.5,
        Math.min(w, h) * 0.25,
        w * 0.5,
        h * 0.5,
        Math.max(w, h) * 0.75
      );
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(1,2,3,0.75)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);
    } else if (mode === 'starfield' || mode === 'ambientFlow') {
      const cx = w * (0.35 + 0.1 * Math.sin(t * 0.3));
      const cy = h * (0.4 + 0.1 * Math.cos(t * 0.25));
      const rad = Math.max(w, h) * 0.5;
      const glow = ctx.createRadialGradient(cx, cy, 4, cx, cy, rad);
      glow.addColorStop(0, params.accentPrimaryHex);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = (0.22 + params.rmsLevel * 0.14) * bgOpacity;
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (typeof this.canvas.removeEventListener === 'function') {
      this.canvas.removeEventListener('webglcontextlost', this.boundContextLost);
      this.canvas.removeEventListener('webglcontextrestored', this.boundContextRestored);
    }

    if (this.gl) {
      const gl = this.gl;
      try {
        if (typeof gl.isContextLost !== 'function' || !gl.isContextLost()) {
          gl.bindVertexArray(null);
          gl.bindBuffer(gl.ARRAY_BUFFER, null);
          gl.useProgram(null);
          for (const entry of this.programs.values()) {
            gl.deleteProgram(entry.program);
          }
          if (this.vbo) {
            gl.deleteBuffer(this.vbo);
            this.vbo = null;
          }
          if (this.vao) {
            gl.deleteVertexArray(this.vao);
            this.vao = null;
          }
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
      } catch {
        // Ignore cleanup errors during disposal
      }
      this.programs.clear();
      this.vbo = null;
      this.vao = null;
      // Do NOT call WEBGL_lose_context.loseContext() here: React StrictMode and
      // effect remounts reuse the same <canvas> element and a forced context loss
      // permanently bricks the canvas, leaving hasWebGlBackdrop=false and burying
      // lower z-index 3D layers under the Canvas2D solid fallback fill.
      this.gl = null;
    }
    this.fallbackCtx = null;
  }
}
