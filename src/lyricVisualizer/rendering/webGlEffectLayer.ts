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
  float ridge = pow(1.0 - abs(f * 2.0 - 1.0), 2.4);
  float spec = pow(max(0.0, ridge), 4.0) * (0.65 + u_treble * 0.55 + u_beat * 0.35);

  vec3 chrome = mix(u_bgDeep, u_bgMid, clamp(f * 1.15, 0.0, 1.0));
  vec3 irid = 0.5 + 0.5 * cos(6.28318 * (f * 1.3 + t * 0.25 + vec3(0.0, 0.33, 0.67)));
  vec3 tint = mix(u_accent1, u_accent2, clamp(q.x, 0.0, 1.0));
  vec3 col = mix(chrome, mix(tint, irid, 0.45), ridge * 0.52) + vec3(0.85, 0.9, 1.0) * spec * 0.38;
  col *= (0.85 + u_rms * 0.25);
  outColor = vec4(col, 1.0);
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
uniform vec3 u_bgDeep;
uniform vec3 u_bgMid;
uniform vec3 u_accent1;
uniform vec3 u_accent2;

void main() {
  vec2 uv = v_uv;
  float horizon = 0.44;
  float t = u_time * (u_reduceMotion > 0.5 ? 0.15 : 1.1);
  vec3 col = mix(u_bgDeep * 0.7, u_bgMid * 0.85, smoothstep(0.0, 1.0, uv.y));

  if (uv.y >= horizon) {
    // Sky with synth sun glow
    float skyT = (uv.y - horizon) / max(0.001, 1.0 - horizon);
    col = mix(u_accent2 * 0.45, u_bgDeep, pow(skyT, 0.75));
    vec2 sunPos = vec2(0.5, horizon + 0.18);
    vec2 d = (uv - sunPos) * vec2(u_res.x / max(1.0, u_res.y), 1.0);
    float dist = length(d);
    float sun = smoothstep(0.21 + u_bass * 0.025, 0.19 + u_bass * 0.025, dist);
    float stripes = step(0.18, fract((uv.y - horizon) * 28.0 - t * 0.2));
    float sunMask = sun * mix(1.0, stripes, smoothstep(horizon + 0.22, horizon, uv.y));
    vec3 sunCol = mix(u_accent1, u_accent2, clamp((uv.y - horizon) * 3.0, 0.0, 1.0));
    col += sunCol * sunMask * 0.85;
    col += u_accent1 * exp(-dist * 5.0) * (0.28 + u_beat * 0.2);
  } else {
    // Perspective neon grid floor
    float py = max(0.015, horizon - uv.y);
    float z = 0.28 / py;
    float x = (uv.x - 0.5) * z * (u_res.x / max(1.0, u_res.y));
    float gz = z + t * 1.4;
    float lineX = abs(fract(x * 0.9 - 0.5) - 0.5) / max(0.001, fwidth(x * 0.9));
    float lineZ = abs(fract(gz * 0.9 - 0.5) - 0.5) / max(0.001, fwidth(gz * 0.9));
    float grid = 1.0 - min(min(lineX, lineZ), 1.0);
    float fade = exp(-py * 2.2) * (0.55 + u_rms * 0.45 + u_beat * 0.25);
    col = mix(u_bgDeep * 0.65, u_bgMid * 0.55, exp(-py * 4.0));
    col += mix(u_accent1, u_accent2, clamp(uv.x, 0.0, 1.0)) * grid * fade;
  }

  // Subtle pastel scanline shimmer
  float scan = 0.94 + 0.06 * sin(gl_FragCoord.y * 1.5);
  col *= scan;
  outColor = vec4(col, 1.0);
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
uniform vec3 u_bgDeep;
uniform vec3 u_bgMid;
uniform vec3 u_accent1;
uniform vec3 u_accent2;

void main() {
  vec2 c = v_uv * 2.0 - 1.0;
  float r2 = dot(c, c);
  vec2 warped = c * (1.0 + 0.06 * r2);
  vec2 uv = warped * 0.5 + 0.5;

  float vig = smoothstep(1.38, 0.25, r2);
  vec3 base = mix(u_bgDeep * 0.45, u_bgMid * 0.5, vig);

  float scan = 0.86 + 0.14 * sin(gl_FragCoord.y * 3.14159);
  float rgbMask = 0.95 + 0.05 * sin(gl_FragCoord.x * 2.1);
  float sweepY = fract(u_time * (u_reduceMotion > 0.5 ? 0.0 : 0.12));
  float sweep = exp(-abs(uv.y - sweepY) * 18.0) * (u_reduceMotion > 0.5 ? 0.0 : 0.12);

  vec3 phosphor = base * scan * rgbMask + u_accent1 * (sweep + u_rms * 0.08 + u_beat * 0.06);
  phosphor *= vig;
  outColor = vec4(phosphor, 1.0);
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
uniform vec3 u_bgDeep;
uniform vec3 u_bgMid;
uniform vec3 u_accent1;
uniform vec3 u_accent2;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / max(1.0, min(u_res.x, u_res.y));
  float speed = u_reduceMotion > 0.5 ? 0.04 : (0.28 + u_bass * 0.35 + u_beat * 0.15);
  float t = u_time * speed;

  vec3 col = mix(u_bgDeep * 0.6, u_bgMid * 0.35, clamp(1.0 - length(uv), 0.0, 1.0));
  for (int layer = 0; layer < 3; layer++) {
    float fl = float(layer);
    float depth = fract(fl * 0.333 + t * 0.25);
    float scale = mix(14.0, 1.5, depth);
    float fade = smoothstep(0.0, 0.25, depth) * smoothstep(1.0, 0.65, depth);
    vec2 gv = fract(uv * scale + vec2(fl * 17.3, fl * 9.1)) - 0.5;
    vec2 id = floor(uv * scale + vec2(fl * 17.3, fl * 9.1));
    float n = hash21(id);
    vec2 offset = (vec2(n, fract(n * 34.0)) - 0.5) * 0.7;
    float d = length(gv - offset);
    float star = smoothstep(0.055, 0.008, d) * fade;
    vec3 starTint = mix(vec3(0.88, 0.93, 1.0), mix(u_accent1, u_accent2, fract(n * 19.0)), 0.45);
    col += starTint * star * (0.7 + u_treble * 0.5);
  }
  outColor = vec4(col, 1.0);
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
  outColor = vec4(col, 1.0);
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
  uBgDeep: WebGLUniformLocation | null;
  uBgMid: WebGLUniformLocation | null;
  uAccent1: WebGLUniformLocation | null;
  uAccent2: WebGLUniformLocation | null;
}

function parseHexToRgbInto(hex: string, out: Float32Array): void {
  const cleaned = hex.startsWith('#') ? hex.slice(1) : hex;
  if (cleaned.length === 6) {
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

  // Pre-allocated RGB scratch buffers (zero per-frame heap allocations)
  private readonly rgbBgDeep = new Float32Array(3);
  private readonly rgbBgMid = new Float32Array(3);
  private readonly rgbAccent1 = new Float32Array(3);
  private readonly rgbAccent2 = new Float32Array(3);

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.initContext();
  }

  get isWebGlActive(): boolean {
    return this.gl !== null && !this.disposed;
  }

  private initContext(): void {
    try {
      const gl = this.canvas.getContext('webgl2', {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'low-power',
        preserveDrawingBuffer: false,
      }) as WebGL2RenderingContext | null;

      if (gl && typeof gl.createShader === 'function') {
        this.gl = gl;
        this.setupQuad(gl);
        return;
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

    if (this.gl && this.vao) {
      const prog = this.getOrCompileProgram(mode);
      if (prog) {
        const gl = this.gl;
        parseHexToRgbInto(params.bgDeepHex, this.rgbBgDeep);
        parseHexToRgbInto(params.bgMidHex, this.rgbBgMid);
        parseHexToRgbInto(params.accentPrimaryHex, this.rgbAccent1);
        parseHexToRgbInto(params.accentSecondaryHex, this.rgbAccent2);

        gl.useProgram(prog.program);
        gl.uniform2f(prog.uRes, this.canvas.width, this.canvas.height);
        gl.uniform1f(prog.uTime, params.timeSeconds);
        gl.uniform1f(prog.uRms, params.rmsLevel);
        gl.uniform1f(prog.uBass, params.bassEnergy);
        gl.uniform1f(prog.uTreble, params.trebleEnergy);
        gl.uniform1f(prog.uBeat, params.beatDetected ? 1.0 : 0.0);
        gl.uniform1f(prog.uReduceMotion, params.reduceMotion ? 1.0 : 0.0);
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

    ctx.save();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, params.bgDeepHex);
    grad.addColorStop(1, params.bgMidHex);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    if (mode === 'liquidMetal') {
      const cx = w * (0.5 + 0.12 * Math.sin(t * 0.45));
      const cy = h * (0.45 + 0.1 * Math.cos(t * 0.35));
      const rad = Math.max(w, h) * (0.42 + params.bassEnergy * 0.12);
      const sheen = ctx.createRadialGradient(cx, cy, rad * 0.05, cx, cy, rad);
      sheen.addColorStop(0, params.accentPrimaryHex);
      sheen.addColorStop(0.5, params.accentSecondaryHex);
      sheen.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.28 + params.rmsLevel * 0.18;
      ctx.fillStyle = sheen;
      ctx.fillRect(0, 0, w, h);
    } else if (mode === 'holoVaporwave') {
      const horizonY = h * 0.56;
      ctx.strokeStyle = params.accentPrimaryHex;
      ctx.globalAlpha = 0.28 + params.bassEnergy * 0.2;
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
      for (let y = 0; y < h; y += 4) {
        ctx.fillRect(0, y, w, 1.5);
      }
    } else if (mode === 'starfield' || mode === 'ambientFlow') {
      const cx = w * (0.35 + 0.1 * Math.sin(t * 0.3));
      const cy = h * (0.4 + 0.1 * Math.cos(t * 0.25));
      const rad = Math.max(w, h) * 0.5;
      const glow = ctx.createRadialGradient(cx, cy, 4, cx, cy, rad);
      glow.addColorStop(0, params.accentPrimaryHex);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.22 + params.rmsLevel * 0.14;
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.gl) {
      const gl = this.gl;
      for (const entry of this.programs.values()) {
        gl.deleteProgram(entry.program);
      }
      this.programs.clear();
      if (this.vbo) {
        gl.deleteBuffer(this.vbo);
        this.vbo = null;
      }
      if (this.vao) {
        gl.deleteVertexArray(this.vao);
        this.vao = null;
      }
      try {
        const loseCtx = gl.getExtension('WEBGL_lose_context');
        loseCtx?.loseContext();
      } catch {
        // Ignore if extension unavailable
      }
      this.gl = null;
    }
    this.fallbackCtx = null;
  }
}
