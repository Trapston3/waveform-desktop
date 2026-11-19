// src/ui/player/useTiltTransform.ts
// Interactive 3D perspective tilt (perspective: 1200px) and dynamic specular sheen hook
// Conforms to Apple Music macOS/Windows large floating album artwork immersion lockup

import { useState, useCallback, useMemo } from 'react';

export interface TiltOptions {
  maxTiltDeg?: number;
  perspectivePx?: number;
  scale?: number;
  active?: boolean;
}

export interface TiltTransformResult {
  tiltX: number;
  tiltY: number;
  sheenX: number;
  sheenY: number;
  isHovered: boolean;
  transform: string;
  sheenGradient: string;
  handleMouseMove: (e: React.MouseEvent<HTMLElement>) => void;
  handleMouseLeave: () => void;
}

export function useTiltTransform(options: TiltOptions = {}): TiltTransformResult {
  const {
    maxTiltDeg = 10,
    perspectivePx = 1200,
    scale = 1.0,
    active = true,
  } = options;

  const [tilt, setTilt] = useState<{ tiltX: number; tiltY: number; sheenX: number; sheenY: number; isHovered: boolean }>({
    tiltX: 0,
    tiltY: 0,
    sheenX: 50,
    sheenY: 50,
    isHovered: false,
  });

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!active) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // Normalized coordinates from -1 to 1 (center is 0,0)
    const normX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const normY = ((e.clientY - rect.top) / rect.height) * 2 - 1;

    // Clamped -1 to 1
    const clampedX = Math.max(-1, Math.min(1, normX));
    const clampedY = Math.max(-1, Math.min(1, normY));

    // tiltX rotates around Y-axis (horizontal mouse pos determines Y-rotation)
    const tiltX = parseFloat((clampedX * maxTiltDeg).toFixed(2));
    // tiltY rotates around X-axis (vertical mouse pos determines X-rotation, inverted)
    const tiltY = parseFloat((-clampedY * maxTiltDeg).toFixed(2));

    // Sheen coordinates in percent 0% to 100%
    const sheenX = parseFloat((((clampedX + 1) / 2) * 100).toFixed(1));
    const sheenY = parseFloat((((clampedY + 1) / 2) * 100).toFixed(1));

    setTilt({
      tiltX,
      tiltY,
      sheenX,
      sheenY,
      isHovered: true,
    });
  }, [active, maxTiltDeg]);

  const handleMouseLeave = useCallback(() => {
    setTilt({
      tiltX: 0,
      tiltY: 0,
      sheenX: 50,
      sheenY: 50,
      isHovered: false,
    });
  }, []);

  const transform = useMemo(() => {
    return `perspective(${perspectivePx}px) rotateX(${tilt.tiltY}deg) rotateY(${tilt.tiltX}deg) scale(${scale})`;
  }, [perspectivePx, tilt.tiltX, tilt.tiltY, scale]);

  const sheenGradient = useMemo(() => {
    if (!tilt.isHovered) return 'none';
    return `radial-gradient(circle at ${tilt.sheenX}% ${tilt.sheenY}%, rgba(255, 255, 255, 0.22) 0%, transparent 60%)`;
  }, [tilt.isHovered, tilt.sheenX, tilt.sheenY]);

  return {
    tiltX: tilt.tiltX,
    tiltY: tilt.tiltY,
    sheenX: tilt.sheenX,
    sheenY: tilt.sheenY,
    isHovered: tilt.isHovered,
    transform,
    sheenGradient,
    handleMouseMove,
    handleMouseLeave,
  };
}
