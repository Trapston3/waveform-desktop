// src/ui/player/AppleMusicFluidMeshCanvas.tsx
// WebGL 2 (with graceful Canvas 2D fallback) OkLab fluid mesh background canvas
// Multi-frequency sinusoidal domain warping, Lissajous drift, screen-space Interleaved Gradient Noise dithering
// Derived clean-room from Storyteller-Studios/Cirrus (MIT License)

import React, { useRef, useEffect, memo } from 'react';

export interface AppleMusicFluidMeshCanvasProps {
  colors?: string[]; // 4 palette colors [vibrant, edgeWash, ambient, playerTint]
  isPlaying?: boolean;
  speed?: number;
  width?: number;
  height?: number;
  className?: string;
  enableDithering?: boolean;
}

const VS_SOURCE = `#version 300 es
in vec2 a_position;
void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FS_SOURCE = `#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_colors[4]; // OkLab color coordinates (L, a, b)
uniform float u_speed;
uniform bool u_enableDithering;

const float PI = 3.141592653589793;

vec2 rotatePoint(vec2 p, float a) {
    float s = sin(a), c = cos(a);
    return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

vec2 gradientHash(vec2 p) {
    return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}

float gradientNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = dot(-1.0 + 2.0 * gradientHash(i), f);
    float b = dot(-1.0 + 2.0 * gradientHash(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
    float c = dot(-1.0 + 2.0 * gradientHash(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
    float d = dot(-1.0 + 2.0 * gradientHash(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
    return 0.5 + 0.5 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float srgbTransfer(float c) {
    return c <= 0.0031308 ? 12.92 * c : 1.055 * pow(max(c, 0.0), 1.0 / 2.4) - 0.055;
}

vec3 okLabToSrgb(vec3 c) {
    float l_ = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
    float m_ = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
    float s_ = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
    float l = l_ * l_ * l_;
    float m = m_ * m_ * m_;
    float s = s_ * s_ * s_;
    return vec3(
        srgbTransfer( 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        srgbTransfer(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        srgbTransfer(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
    );
}

float interleavedGradientNoise(vec2 pos) {
    return fract(52.9829189 * fract(dot(pos, vec2(0.06711056, 0.00583715))));
}

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    vec2 pt = uv - 0.5;

    // Lissajous curve drift + domain noise
    float t = u_time * u_speed;
    float noise = gradientNoise(vec2(t * 0.08, pt.x * pt.y * 2.0));
    float angle = ((noise - 0.5) * 720.0 + 180.0) * PI / 180.0;
    pt = rotatePoint(pt, angle * 0.25);

    // Sinusoidal domain warping along Lissajous curves
    pt.x += sin(pt.y * 3.5 + t * 0.6) * 0.18;
    pt.y += cos(pt.x * 2.8 + t * 0.7) * 0.18;

    float rotX = rotatePoint(pt, 0.785398).x; // 45 deg tilt
    float h = smoothstep(-0.45, 0.45, rotX);

    vec3 okLab = mix(
        mix(u_colors[0], u_colors[1], h),
        mix(u_colors[2], u_colors[3], h),
        1.0 - smoothstep(-0.4, 0.4, pt.y)
    );

    vec3 rgb = okLabToSrgb(okLab);

    if (u_enableDithering) {
        float dither = (interleavedGradientNoise(gl_FragCoord.xy) - 0.5) / 255.0;
        rgb += vec3(dither);
    }

    fragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
`;

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function clamp01(v: number): number {
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
}

function hslToUnitRgb(hDeg: number, s: number, l: number): [number, number, number] {
  const h = (((hDeg % 360) + 360) % 360) / 360;
  const sat = clamp01(s);
  const lig = clamp01(l);
  if (sat === 0) return [lig, lig, lig];
  const q = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat;
  const p = 2 * lig - q;
  const hue2rgb = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [hue2rgb(h + 1 / 3), hue2rgb(h), hue2rgb(h - 1 / 3)];
}

function parseColorToUnitRgb(colorStr?: string, fallback: [number, number, number] = [0.16, 0.20, 0.28]): [number, number, number] {
  if (typeof colorStr !== 'string') return fallback;
  const trimmed = colorStr.trim();
  if (!trimmed) return fallback;

  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(trimmed);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length <= 4) {
      return [
        parseInt(hex[0] + hex[0], 16) / 255,
        parseInt(hex[1] + hex[1], 16) / 255,
        parseInt(hex[2] + hex[2], 16) / 255,
      ];
    }
    return [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
    ];
  }

  const rgbMatch = /^rgba?\(\s*([0-9.]+%?)\s*[,\s]\s*([0-9.]+%?)\s*[,\s]\s*([0-9.]+%?)(?:\s*[,/]\s*([0-9.]+%?))?\s*\)$/i.exec(trimmed);
  if (rgbMatch) {
    const parseChannel = (tok: string) =>
      tok.endsWith('%') ? clamp01(parseFloat(tok) / 100) : clamp01(parseFloat(tok) / 255);
    const r = parseChannel(rgbMatch[1]);
    const g = parseChannel(rgbMatch[2]);
    const b = parseChannel(rgbMatch[3]);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return [r, g, b];
    }
  }

  const hslMatch = /^hsla?\(\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:deg)?)\s*[,\s]\s*([0-9.]+)%?\s*[,\s]\s*([0-9.]+)%?(?:\s*[,/]\s*([0-9.]+%?))?\s*\)$/i.exec(trimmed);
  if (hslMatch) {
    const h = parseFloat(hslMatch[1]);
    const s = parseFloat(hslMatch[2]) / 100;
    const l = parseFloat(hslMatch[3]) / 100;
    if (Number.isFinite(h) && Number.isFinite(s) && Number.isFinite(l)) {
      return hslToUnitRgb(h, s, l);
    }
  }

  return fallback;
}

const NEUTRAL_COLOR_FALLBACKS: readonly [number, number, number][] = [
  [0.20, 0.24, 0.34],
  [0.12, 0.15, 0.24],
  [0.04, 0.05, 0.08],
  [0.10, 0.12, 0.18],
];

function buildColorBuffers(colors: string[]): { rgb: Float32Array; okLab: Float32Array } {
  const rgb = new Float32Array(12);
  const okLab = new Float32Array(12);
  for (let i = 0; i < 4; i++) {
    const unitRgb = parseColorToUnitRgb(colors[i], NEUTRAL_COLOR_FALLBACKS[i]);
    const lab = srgbToOkLab(unitRgb[0], unitRgb[1], unitRgb[2]);
    const offset = i * 3;
    rgb[offset] = unitRgb[0];
    rgb[offset + 1] = unitRgb[1];
    rgb[offset + 2] = unitRgb[2];
    okLab[offset] = lab[0];
    okLab[offset + 1] = lab[1];
    okLab[offset + 2] = lab[2];
  }
  return { rgb, okLab };
}

function unitRgbToCss(buf: Float32Array, index: number): string {
  const offset = index * 3;
  const r = Math.round(clamp01(buf[offset]) * 255);
  const g = Math.round(clamp01(buf[offset + 1]) * 255);
  const b = Math.round(clamp01(buf[offset + 2]) * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

function srgbToOkLab(r: number, g: number, b: number): [number, number, number] {
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

export const AppleMusicFluidMeshCanvas: React.FC<AppleMusicFluidMeshCanvasProps> = memo(({
  colors = ['#FA2D48', '#3A1019', '#080507', 'rgba(58, 16, 25, 0.65)'],
  isPlaying = false,
  speed = 1.0,
  width = 640,
  height = 360,
  className = '',
  enableDithering = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const initialBuffersRef = useRef<{ rgb: Float32Array; okLab: Float32Array } | null>(null);
  if (!initialBuffersRef.current) {
    initialBuffersRef.current = buildColorBuffers(colors);
  }

  const targetOkLabRef = useRef<Float32Array>(new Float32Array(initialBuffersRef.current.okLab));
  const currentOkLabRef = useRef<Float32Array>(new Float32Array(initialBuffersRef.current.okLab));
  const targetRgbRef = useRef<Float32Array>(new Float32Array(initialBuffersRef.current.rgb));
  const currentRgbRef = useRef<Float32Array>(new Float32Array(initialBuffersRef.current.rgb));
  const targetSpeedRef = useRef<number>((isPlaying ? 1.0 : 0.25) * speed);
  const isPlayingRef = useRef<boolean>(isPlaying);
  const speedRef = useRef<number>(speed);

  useEffect(() => {
    const next = buildColorBuffers(colors);
    targetOkLabRef.current.set(next.okLab);
    targetRgbRef.current.set(next.rgb);
    targetSpeedRef.current = (isPlaying ? 1.0 : 0.25) * speed;
    isPlayingRef.current = isPlaying;
    speedRef.current = speed;
  }, [colors, isPlaying, speed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let animId: number;
    let gl: WebGL2RenderingContext | null = null;

    try {
      gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'low-power',
      });
    } catch {
      gl = null;
    }

    if (gl) {
      // ---------------- WEBGL 2 IMPLEMENTATION ----------------
      const createShader = (type: number, source: string) => {
        if (!gl) return null;
        const shader = gl.createShader(type);
        if (!shader) return null;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          gl.deleteShader(shader);
          return null;
        }
        return shader;
      };

      const vs = createShader(gl.VERTEX_SHADER, VS_SOURCE);
      const fs = createShader(gl.FRAGMENT_SHADER, FS_SOURCE);
      if (!vs || !fs) {
        if (vs) gl.deleteShader(vs);
        if (fs) gl.deleteShader(fs);
        return;
      }

      const program = gl.createProgram();
      if (!program) {
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        return;
      }
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        gl.deleteProgram(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        return;
      }

      gl.useProgram(program);

      // Fullscreen quad buffer
      const positionBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      const quadVertices = new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
        -1,  1,
         1, -1,
         1,  1,
      ]);
      gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

      const aPositionLoc = gl.getAttribLocation(program, 'a_position');
      gl.enableVertexAttribArray(aPositionLoc);
      gl.vertexAttribPointer(aPositionLoc, 2, gl.FLOAT, false, 0, 0);

      const uResolutionLoc = gl.getUniformLocation(program, 'u_resolution');
      const uTimeLoc = gl.getUniformLocation(program, 'u_time');
      const uColorsLoc = gl.getUniformLocation(program, 'u_colors');
      const uSpeedLoc = gl.getUniformLocation(program, 'u_speed');
      const uEnableDitheringLoc = gl.getUniformLocation(program, 'u_enableDithering');

      gl.uniform2f(uResolutionLoc, width, height);
      gl.uniform3fv(uColorsLoc, currentOkLabRef.current);
      gl.uniform1i(uEnableDitheringLoc, enableDithering ? 1 : 0);

      let currentSpeed = targetSpeedRef.current;
      let lastTime = performance.now();
      let elapsedTime = 0;

      const render = (now: number) => {
        if (!gl) return;
        const dt = Math.min(Math.max((now - lastTime) / 1000, 0), 0.1);
        lastTime = now;

        const targetSpeed = targetSpeedRef.current;
        currentSpeed += (targetSpeed - currentSpeed) * (1 - Math.exp(-dt * 3.0));
        elapsedTime += dt * currentSpeed;

        const lerpAlpha = 1 - Math.exp(-dt * 4.5);
        const currentOkLab = currentOkLabRef.current;
        const targetOkLab = targetOkLabRef.current;
        for (let i = 0; i < 12; i++) {
          currentOkLab[i] += (targetOkLab[i] - currentOkLab[i]) * lerpAlpha;
        }

        gl.viewport(0, 0, width, height);
        gl.uniform1f(uTimeLoc, elapsedTime);
        gl.uniform1f(uSpeedLoc, currentSpeed);
        gl.uniform3fv(uColorsLoc, currentOkLab);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
        animId = requestAnimationFrame(render);
      };

      animId = requestAnimationFrame(render);

      return () => {
        cancelAnimationFrame(animId);
        if (gl) {
          gl.deleteBuffer(positionBuffer);
          gl.deleteProgram(program);
          gl.deleteShader(vs);
          gl.deleteShader(fs);
        }
      };
    } else {
      // ---------------- CANVAS 2D FALLBACK ----------------
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      let theta = 0;
      let lastTime = performance.now();
      const anchors = [
        { x: 0.22, y: 0.24 },
        { x: 0.78, y: 0.22 },
        { x: 0.74, y: 0.78 },
        { x: 0.26, y: 0.76 },
      ];
      const speeds = [1.0, -0.75, 0.85, -1.1];

      const render2D = (now: number) => {
        const dt = Math.min(Math.max((now - lastTime) / 1000, 0), 0.1);
        lastTime = now;

        const lerpAlpha = 1 - Math.exp(-dt * 4.5);
        const currentRgb = currentRgbRef.current;
        const targetRgb = targetRgbRef.current;
        for (let i = 0; i < 12; i++) {
          currentRgb[i] += (targetRgb[i] - currentRgb[i]) * lerpAlpha;
        }

        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        ctx.fillStyle = unitRgbToCss(currentRgb, 2);
        ctx.fillRect(0, 0, w, h);

        theta += (isPlayingRef.current ? 0.009 : 0.003) * speedRef.current;

        const secondaryCss = unitRgbToCss(currentRgb, 1);
        for (let k = 0; k < 4; k++) {
          const x = (anchors[k].x + 0.17 * Math.cos(theta * speeds[k] + k * 1.7)) * w;
          const y = (anchors[k].y + 0.17 * Math.sin(theta * speeds[k] * 0.9 + k * 2.3)) * h;
          const radius = Math.max(w, h) * 0.65;

          const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
          grad.addColorStop(0, unitRgbToCss(currentRgb, k));
          grad.addColorStop(0.55, secondaryCss);
          grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }

        // 45% dark scrim for contrast stability
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(0, 0, w, h);

        animId = requestAnimationFrame(render2D);
      };

      animId = requestAnimationFrame(render2D);
      return () => cancelAnimationFrame(animId);
    }
  }, [width, height, enableDithering]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={className}
    />
  );
});

AppleMusicFluidMeshCanvas.displayName = 'AppleMusicFluidMeshCanvas';
