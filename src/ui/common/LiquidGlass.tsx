// src/ui/common/LiquidGlass.tsx
// Reusable Liquid Glass Material & Optics Component for WaveForm Desktop.
// Implements the SDF rounded-rect displacement lens, inward rim meniscus bend,
// chromatic dispersion, and directional specular sheen referencing samasante/liquid-glass.

import React, {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export interface GlassOptics {
  strength: number;      // Max displacement fraction (default: 0.14)
  depth: number;         // Inward reach fraction 0..1 (default: 0.35)
  curvature: number;     // Convex dome center magnification 0..1 (default: 0.12)
  bend: number;          // Inward rim meniscus refraction 0..1 (default: 0.85)
  bendWidth: number;     // Rim meniscus band width fraction (default: 0.16)
  dispersion: number;    // Chromatic aberration RGB split 0..1 (default: 0.28)
  sheen: number;         // Directional specular edge intensity 0..1 (default: 0.70)
  sheenAngle: number;    // Incident light angle in degrees (default: 135)
  sheenWidth: number;    // Specular highlight band thickness in px (default: 3)
  glow: number;          // Soft volume inner glow intensity (default: 0.22)
  glowSpread: number;    // Inner glow reach fraction (default: 1.0)
  frost: number;         // Underlying backdrop blur in px (default: 22)
  saturate: number;      // Backdrop saturation multiplier (default: 1.85)
  specular: number;      // Overall specular gain (default: 1.0)
  brightness: number;    // Subtle luminance veil (default: 0.0)
  mapSize: number;       // Normal map texture resolution (default: 512)
}

export const DEFAULT_GLASS_OPTICS: GlassOptics = {
  strength: 0.14,
  depth: 0.35,
  curvature: 0.12,
  bend: 0.85,
  bendWidth: 0.16,
  dispersion: 0.28,
  sheen: 0.70,
  sheenAngle: 135,
  sheenWidth: 3,
  glow: 0.22,
  glowSpread: 1.0,
  frost: 22,
  saturate: 1.85,
  specular: 1.0,
  brightness: 0.0,
  mapSize: 512,
};

export interface LiquidGlassProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  variant?: 'chrome' | 'card' | 'pill' | 'capsule';
  optics?: Partial<GlassOptics>;
  radius?: number;
  width?: number | string;
  height?: number | string;
}

// ----------------------------------------------------------------------------
// Quadrant-Mirrored SDF Displacement Lens Generator (Optimized for 60fps)
// ----------------------------------------------------------------------------
const DISPERSION_SPREAD = 0.22;
const ERF_K = Math.sqrt(Math.PI);
const fastErf = (x: number) => Math.tanh(ERF_K * x);

function generateLensMap(
  size: number,
  halfW: number,
  halfH: number,
  radius: number,
  optics: GlassOptics
): string {
  if (typeof document === 'undefined') return '';

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const image = ctx.createImageData(size, size);
  const data = image.data;
  const half = size >> 1;
  const rad = Math.min(radius, Math.min(halfW, halfH));

  const minHalf = Math.min(halfW, halfH);
  const depthPx = Math.min(optics.depth * minHalf, minHalf - 1);
  const innerHalfW = Math.max(0, halfW - depthPx);
  const innerHalfH = Math.max(0, halfH - depthPx);
  const innerRadius = Math.max(0, Math.min(rad, Math.min(innerHalfW, innerHalfH)));
  const falloff = depthPx > 0 ? Math.SQRT1_2 / depthPx : 1e6;

  const angleRad = (optics.sheenAngle * Math.PI) / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  const edgeInv = optics.sheenWidth > 0 ? 1 / optics.sheenWidth : 0;
  const glowReachInv = 1 / Math.max(2, optics.glowSpread * minHalf);
  const stepX = (2 * halfW) / size;
  const stepY = (2 * halfH) / size;
  const invW = 1 / Math.max(1, halfW);
  const invH = 1 / Math.max(1, halfH);
  const erInv = 1 / Math.max(2, optics.bendWidth * minHalf);

  const cornerDistance = (ox: number, oy: number) =>
    ox > 0 || oy > 0 ? Math.sqrt(ox * ox + oy * oy) : 0;

  for (let row = 0; row < half; row += 1) {
    const mirrorRow = size - 1 - row;
    const py = -((row + 0.5) * stepY - halfH);
    const edgeY = py - halfH + rad;
    const innerEdgeY = py - innerHalfH + innerRadius;
    const normY = py * invH > 1 ? 1 : py * invH;
    const rowBase = row * size;
    const mirrorRowBase = mirrorRow * size;

    for (let col = 0; col < half; col += 1) {
      const mirrorCol = size - 1 - col;
      const px = -((col + 0.5) * stepX - halfW);
      const edgeX = px - halfW + rad;

      // 1. Exact Rounded-Rect SDF
      const sdf =
        cornerDistance(edgeX > 0 ? edgeX : 0, edgeY > 0 ? edgeY : 0) +
        (edgeX > edgeY ? (edgeX > 0 ? 0 : edgeX) : edgeY > 0 ? 0 : edgeY) -
        rad;

      const i00 = (rowBase + col) * 4;           // Top-Left (Canonical)
      const i01 = (rowBase + mirrorCol) * 4;     // Top-Right (Mirror X)
      const i10 = (mirrorRowBase + col) * 4;     // Bottom-Left (Mirror Y)
      const i11 = (mirrorRowBase + mirrorCol) * 4;// Bottom-Right (Mirror XY)

      if (sdf >= 0) {
        // Outside the lens: neutral 128 displacement, zero specular
        for (const idx of [i00, i01, i10, i11]) {
          data[idx] = 128;
          data[idx + 1] = 128;
          data[idx + 2] = 128;
          data[idx + 3] = 255;
        }
        continue;
      }

      // 2. Dome Gradient
      const normX = px * invW > 1 ? 1 : px * invW;
      const dirX = normX;
      const dirY = normY;

      // 3. Error-Function Edge Feathering
      const ix = px - innerHalfW + innerRadius;
      const innerSdf =
        cornerDistance(ix > 0 ? ix : 0, innerEdgeY > 0 ? innerEdgeY : 0) +
        (ix > innerEdgeY ? (ix > 0 ? 0 : ix) : innerEdgeY > 0 ? 0 : innerEdgeY) -
        innerRadius;
      const edgeOpacity = 0.5 * (1 + fastErf(innerSdf * falloff));

      let dx = 0.5 * dirX * edgeOpacity;
      let dy = 0.5 * dirY * edgeOpacity;

      // 4. Inward Rim Meniscus Bend: m(s) = 6.75 * s^2 * (1 - s)
      if (optics.bend > 0) {
        const s = sdf < 0 ? Math.max(0, 1 + sdf * erInv) : 0;
        if (s > 0) {
          const len = Math.sqrt(dirX * dirX + dirY * dirY);
          if (len > 1e-4) {
            const m = 6.75 * s * s * (1 - s);
            const a = (0.5 * optics.bend * m * edgeOpacity) / len;
            dx += dirX * a;
            dy += dirY * a;
          }
        }
      }

      // 5. Directional Specular Sheen & Soft Volume Glow
      let specMain = 0;
      let specCross = 0;
      const axisMain = Math.min(1, Math.abs(normX * cosA + normY * sinA) * Math.SQRT1_2);
      const axisCross = Math.min(1, Math.abs(normX * cosA - normY * sinA) * Math.SQRT1_2);

      if (optics.sheen > 0) {
        const band = sdf < 0 ? Math.max(0, 1 + sdf * edgeInv) : 0;
        const b = optics.sheen * Math.pow(band, 1.5);
        specMain += b * (0.16 + 0.84 * Math.pow(axisMain, 1.6));
        specCross += b * (0.16 + 0.84 * Math.pow(axisCross, 1.6));
      }

      if (optics.glow > 0) {
        const reach = sdf < 0 ? Math.min(1, -sdf * glowReachInv) : 1;
        const t = 1 - reach;
        const g = optics.glow * Math.pow(t * t * (3 - 2 * t), 0.5) * edgeOpacity;
        specMain += g * (0.6 + 0.4 * axisMain);
        specCross += g * (0.6 + 0.4 * axisCross);
      }

      specMain = Math.max(-1, Math.min(1, specMain));
      specCross = Math.max(-1, Math.min(1, specCross));

      // 6. Encode into R (dx), G (dy), B (specular)
      const rPos = ((0.5 + dx) * 255 + 0.5) | 0;
      const rNeg = ((0.5 - dx) * 255 + 0.5) | 0;
      const gPos = ((0.5 + dy) * 255 + 0.5) | 0;
      const gNeg = ((0.5 - dy) * 255 + 0.5) | 0;
      const bMain = (127 * specMain + 128 + 0.5) | 0;
      const bCross = (127 * specCross + 128 + 0.5) | 0;

      data[i00] = rPos; data[i00 + 1] = gPos; data[i00 + 2] = bMain;  data[i00 + 3] = 255;
      data[i01] = rNeg; data[i01 + 1] = gPos; data[i01 + 2] = bCross; data[i01 + 3] = 255;
      data[i10] = rPos; data[i10 + 1] = gNeg; data[i10 + 2] = bCross; data[i10 + 3] = 255;
      data[i11] = rNeg; data[i11 + 1] = gNeg; data[i11 + 2] = bMain;  data[i11 + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

// ----------------------------------------------------------------------------
// LiquidGlass Component
// ----------------------------------------------------------------------------
export const LiquidGlass: React.FC<LiquidGlassProps> = ({
  children,
  variant = 'chrome',
  optics: userOptics,
  radius,
  width,
  height,
  className = '',
  style,
  ...rest
}) => {
  const mergedOptics = useMemo(
    () => ({ ...DEFAULT_GLASS_OPTICS, ...userOptics }),
    [userOptics]
  );
  const baseId = useId().replace(/:/g, '');
  const containerRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<SVGFilterElement>(null);
  const feImageRef = useRef<SVGFEImageElement>(null);
  const versionRef = useRef(0);

  const [box, setBox] = useState({ w: 0, h: 0, r: radius || 16 });

  // Tier B (card/pill) does NOT need live SVG displacement maps
  const isTierA = variant === 'chrome' || variant === 'capsule';

  useLayoutEffect(() => {
    if (!isTierA || !containerRef.current) return;
    const el = containerRef.current;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      const cs = window.getComputedStyle(el);
      const computedR = radius ?? (parseFloat(cs.borderTopLeftRadius) || 16);
      setBox((prev) =>
        prev.w === rect.width && prev.h === rect.height && prev.r === computedR
          ? prev
          : { w: rect.width, h: rect.height, r: computedR }
      );
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isTierA, radius]);

  // Generate Displacement Map & Apply SVG filter
  useLayoutEffect(() => {
    if (!isTierA || box.w <= 0 || box.h <= 0) return;

    const mapUrl = generateLensMap(
      mergedOptics.mapSize,
      box.w / 2,
      box.h / 2,
      box.r,
      mergedOptics
    );

    if (feImageRef.current && filterRef.current && containerRef.current) {
      versionRef.current += 1;
      const filterId = `lg-lens-${baseId}-v${versionRef.current}`;
      filterRef.current.id = filterId;
      feImageRef.current.setAttribute('href', mapUrl);

      const fns = `blur(${mergedOptics.frost}px) saturate(${mergedOptics.saturate}) url(#${filterId})`;
      containerRef.current.style.backdropFilter = fns;
      containerRef.current.style.setProperty('-webkit-backdrop-filter', fns);
    }
  }, [isTierA, box.w, box.h, box.r, mergedOptics, baseId]);

  // CSS Class Name per Variant
  const variantClass = useMemo(() => {
    switch (variant) {
      case 'card':
        return 'liquid-glass-card';
      case 'pill':
        return 'liquid-glass-pill';
      case 'capsule':
        return 'liquid-glass-capsule';
      case 'chrome':
      default:
        return 'liquid-glass';
    }
  }, [variant]);

  const norm = box.w > 0 ? Math.sqrt((box.w * box.w + box.h * box.h) / 2) : 100;
  const dispScale = mergedOptics.strength * norm;
  const scaleR = dispScale * (1 + DISPERSION_SPREAD * mergedOptics.dispersion);
  const scaleG = dispScale * (1 + DISPERSION_SPREAD * 0.5 * mergedOptics.dispersion);
  const scaleB = dispScale;

  return (
    <div
      ref={containerRef}
      className={`${variantClass} ${className}`}
      style={{
        width,
        height,
        borderRadius: radius,
        ...style,
      }}
      {...rest}
    >
      {/* Crisp Foreground Content Layer */}
      <div className="relative z-10 w-full h-full pointer-events-auto">
        {children}
      </div>

      {/* SVG Displacement & Chromatic Aberration Filter (Tier A only) */}
      {isTierA && (
        <svg
          aria-hidden="true"
          className="absolute w-0 h-0 pointer-events-none"
          style={{ width: 0, height: 0 }}
        >
          <defs>
            <filter
              ref={filterRef}
              id={`lg-lens-${baseId}-v0`}
              filterUnits="userSpaceOnUse"
              primitiveUnits="userSpaceOnUse"
              x="0"
              y="0"
              width={box.w}
              height={box.h}
            >
              <feFlood floodColor="rgb(128,128,128)" floodOpacity="1" result="mapBg" />
              <feImage
                ref={feImageRef}
                x={0}
                y={0}
                width={box.w}
                height={box.h}
                preserveAspectRatio="none"
                result="rawMap"
              />
              <feComposite in="rawMap" in2="mapBg" operator="over" result="map" />

              {/* 3-Pass Chromatic Aberration */}
              <feDisplacementMap
                in="SourceGraphic"
                in2="map"
                scale={scaleR}
                xChannelSelector="R"
                yChannelSelector="G"
              />
              <feColorMatrix
                type="matrix"
                values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
                result="refractR"
              />

              <feDisplacementMap
                in="SourceGraphic"
                in2="map"
                scale={scaleG}
                xChannelSelector="R"
                yChannelSelector="G"
              />
              <feColorMatrix
                type="matrix"
                values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
                result="refractG"
              />

              <feDisplacementMap
                in="SourceGraphic"
                in2="map"
                scale={scaleB}
                xChannelSelector="R"
                yChannelSelector="G"
              />
              <feColorMatrix
                type="matrix"
                values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
                result="refractB"
              />

              <feComposite
                in="refractR"
                in2="refractG"
                operator="arithmetic"
                k1="0"
                k2="1"
                k3="1"
                k4="0"
                result="refractRG"
              />
              <feComposite
                in="refractRG"
                in2="refractB"
                operator="arithmetic"
                k1="0"
                k2="1"
                k3="1"
                k4="0"
                result="lensOut"
              />

              {/* Specular Sheen Lift (Blue channel 128..255 -> 0..1) */}
              <feColorMatrix
                in="map"
                type="matrix"
                values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 1 0 -0.50196"
                result="sheenMask"
              />
              <feComposite
                in="sheenMask"
                in2="lensOut"
                operator="arithmetic"
                k1="0"
                k2={mergedOptics.specular}
                k3="1"
                k4="0"
              />
            </filter>
          </defs>
        </svg>
      )}
    </div>
  );
};
