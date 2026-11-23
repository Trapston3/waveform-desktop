// src/ui/components/InteractiveEqGraph.tsx
// Interactive 10-band SVF EQ SVG curve canvas with Catmull-Rom spline, draggable band handles,
// double-click zero reset, and real-time AutoEQ biquad magnitude + composite curve overlays

import React, { useId, useMemo, useRef, useState } from 'react';
import {
  EQ_FREQUENCIES_HZ,
  computeBiquadMagnitudeDb,
} from '../../audio/DspChain';
import {
  extractMeasurementRig,
  type AutoEqProfile,
} from '../../audio/AutoEqLoader';

export interface InteractiveEqGraphProps {
  bands: number[];
  onChangeBand: (index: number, gainDb: number) => void;
  activeAutoEqProfile?: AutoEqProfile | null;
  heightClassName?: string;
}

const SVG_W = 840;
const SVG_H = 290;
const PAD_L = 44;
const PAD_R = 24;
const PAD_T = 26;
const PAD_B = 34;
const PLOT_W = SVG_W - PAD_L - PAD_R;
const PLOT_H = SVG_H - PAD_T - PAD_B;

const MIN_FREQ = 32;
const MAX_FREQ = 16000;
const MIN_DB = -12;
const MAX_DB = 12;
const LOG_MIN = Math.log10(MIN_FREQ);
const LOG_SPAN = Math.log10(MAX_FREQ) - LOG_MIN;

const DB_GRID_LINES = [12, 6, 0, -6, -12] as const;

const SAMPLE_FREQS: number[] = (() => {
  const count = 128;
  const freqs = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    freqs[i] = MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, t);
  }
  return freqs;
})();

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function snapHalfDb(db: number): number {
  return Math.round(clamp(db, MIN_DB, MAX_DB) * 2) / 2;
}

function freqToX(hz: number): number {
  const clamped = clamp(hz, MIN_FREQ, MAX_FREQ);
  const norm = (Math.log10(clamped) - LOG_MIN) / LOG_SPAN;
  return PAD_L + norm * PLOT_W;
}

function dbToY(db: number): number {
  const clamped = clamp(db, MIN_DB, MAX_DB);
  return PAD_T + ((MAX_DB - clamped) / (MAX_DB - MIN_DB)) * PLOT_H;
}

function yToDb(svgY: number): number {
  const raw = MAX_DB - ((svgY - PAD_T) / PLOT_H) * (MAX_DB - MIN_DB);
  return snapHalfDb(raw);
}

function formatFreqLabel(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : `${hz}`;
}

interface Point2D {
  x: number;
  y: number;
}

interface CubicSegment {
  p0: Point2D;
  cp1: Point2D;
  cp2: Point2D;
  p1: Point2D;
}

function buildCatmullRomSegments(points: Point2D[]): CubicSegment[] {
  const segments: CubicSegment[] = [];
  if (points.length < 2) return segments;
  const minY = PAD_T;
  const maxY = PAD_T + PLOT_H;

  for (let i = 0; i < points.length - 1; i++) {
    const pPrev = points[Math.max(0, i - 1)];
    const pStart = points[i];
    const pEnd = points[i + 1];
    const pNext = points[Math.min(points.length - 1, i + 2)];

    const cp1: Point2D = {
      x: pStart.x + (pEnd.x - pPrev.x) / 6,
      y: clamp(pStart.y + (pEnd.y - pPrev.y) / 6, minY, maxY),
    };
    const cp2: Point2D = {
      x: pEnd.x - (pNext.x - pStart.x) / 6,
      y: clamp(pEnd.y - (pNext.y - pStart.y) / 6, minY, maxY),
    };
    segments.push({ p0: pStart, cp1, cp2, p1: pEnd });
  }
  return segments;
}

function segmentsToSvgPath(segments: CubicSegment[]): string {
  if (segments.length === 0) return '';
  let d = `M ${segments[0].p0.x.toFixed(1)} ${segments[0].p0.y.toFixed(1)}`;
  for (const s of segments) {
    d += ` C ${s.cp1.x.toFixed(1)} ${s.cp1.y.toFixed(1)}, ${s.cp2.x.toFixed(1)} ${s.cp2.y.toFixed(1)}, ${s.p1.x.toFixed(1)} ${s.p1.y.toFixed(1)}`;
  }
  return d;
}

function evalSegmentsYAtX(segments: CubicSegment[], targetX: number): number {
  if (segments.length === 0) return dbToY(0);
  if (targetX <= segments[0].p0.x) return segments[0].p0.y;
  const last = segments[segments.length - 1];
  if (targetX >= last.p1.x) return last.p1.y;

  const seg =
    segments.find((s) => targetX >= s.p0.x && targetX <= s.p1.x) ?? last;
  const span = Math.max(1e-6, seg.p1.x - seg.p0.x);
  const t = clamp((targetX - seg.p0.x) / span, 0, 1);
  const u = 1 - t;
  return (
    u * u * u * seg.p0.y +
    3 * u * u * t * seg.cp1.y +
    3 * u * t * t * seg.cp2.y +
    t * t * t * seg.p1.y
  );
}

function pointsToLinePath(pts: Point2D[]): string {
  if (pts.length === 0) return '';
  return pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
}

export const InteractiveEqGraph: React.FC<InteractiveEqGraphProps> = ({
  bands,
  onChangeBand,
  activeAutoEqProfile = null,
  heightClassName = 'h-64',
}) => {
  const uid = useId().replace(/:/g, '');
  const areaGradId = `eq-area-${uid}`;
  const glowFilterId = `autoeq-glow-${uid}`;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [draggingBand, setDraggingBand] = useState<number | null>(null);
  const [hoveredBand, setHoveredBand] = useState<number | null>(null);

  const safeBands = useMemo(
    () =>
      EQ_FREQUENCIES_HZ.map((_, idx) => {
        const val = bands[idx];
        return typeof val === 'number' && Number.isFinite(val)
          ? clamp(val, MIN_DB, MAX_DB)
          : 0;
      }),
    [bands]
  );

  const bandPoints = useMemo<Point2D[]>(
    () =>
      EQ_FREQUENCIES_HZ.map((freq, idx) => ({
        x: freqToX(freq),
        y: dbToY(safeBands[idx]),
      })),
    [safeBands]
  );

  const eqSplineSegments = useMemo<CubicSegment[]>(() => {
    const first = bandPoints[0];
    const last = bandPoints[bandPoints.length - 1];
    const anchored: Point2D[] = [
      { x: freqToX(MIN_FREQ), y: first.y },
      ...bandPoints,
      { x: freqToX(MAX_FREQ), y: last.y },
    ];
    return buildCatmullRomSegments(anchored);
  }, [bandPoints]);

  const eqStrokePath = useMemo(
    () => segmentsToSvgPath(eqSplineSegments),
    [eqSplineSegments]
  );

  const eqAreaPath = useMemo(() => {
    if (!eqStrokePath) return '';
    const startX = freqToX(MIN_FREQ).toFixed(1);
    const endX = freqToX(MAX_FREQ).toFixed(1);
    const bottomY = (PAD_T + PLOT_H).toFixed(1);
    return `${eqStrokePath} L ${endX} ${bottomY} L ${startX} ${bottomY} Z`;
  }, [eqStrokePath]);

  const autoEqOverlay = useMemo(() => {
    if (
      !activeAutoEqProfile ||
      !Array.isArray(activeAutoEqProfile.filters) ||
      activeAutoEqProfile.filters.length === 0
    ) {
      return null;
    }

    const magnitudes = computeBiquadMagnitudeDb(
      activeAutoEqProfile.filters,
      activeAutoEqProfile.preampGainDb || 0,
      SAMPLE_FREQS,
      48000
    );

    const autoEqPts: Point2D[] = new Array(SAMPLE_FREQS.length);
    const compositePts: Point2D[] = new Array(SAMPLE_FREQS.length);
    const zeroY = dbToY(0);

    for (let i = 0; i < SAMPLE_FREQS.length; i++) {
      const x = freqToX(SAMPLE_FREQS[i]);
      const autoDb = magnitudes[i] ?? 0;
      const eqY = evalSegmentsYAtX(eqSplineSegments, x);
      const eqDb = MAX_DB - ((eqY - PAD_T) / PLOT_H) * (MAX_DB - MIN_DB);

      autoEqPts[i] = { x, y: dbToY(autoDb) };
      compositePts[i] = { x, y: dbToY(eqDb + autoDb) };
    }

    return {
      autoEqPath: pointsToLinePath(autoEqPts),
      compositePath: pointsToLinePath(compositePts),
      preampDb: Number(activeAutoEqProfile.preampGainDb) || 0,
      rigLabel: extractMeasurementRig(activeAutoEqProfile.source).rig,
      zeroY,
    };
  }, [activeAutoEqProfile, eqSplineSegments]);

  const getDbFromClientY = (clientY: number): number => {
    const svg = svgRef.current;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    const svgY = ((clientY - rect.top) / Math.max(1, rect.height)) * SVG_H;
    return yToDb(svgY);
  };

  const handleBandPointerDown = (
    idx: number,
    e: React.PointerEvent<SVGGElement>
  ) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore in non-DOM/mocked environments
    }
    setDraggingBand(idx);
    onChangeBand(idx, getDbFromClientY(e.clientY));
  };

  const handleBandPointerMove = (
    idx: number,
    e: React.PointerEvent<SVGGElement>
  ) => {
    if (draggingBand !== idx) return;
    e.preventDefault();
    onChangeBand(idx, getDbFromClientY(e.clientY));
  };

  const handleBandPointerEnd = (
    idx: number,
    e: React.PointerEvent<SVGGElement>
  ) => {
    if (draggingBand === idx) {
      setDraggingBand(null);
    }
    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore capture release errors
    }
  };

  const handleBandDoubleClick = (idx: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onChangeBand(idx, 0);
  };

  const handleBandKeyDown = (
    idx: number,
    e: React.KeyboardEvent<SVGGElement>
  ) => {
    const curr = safeBands[idx] ?? 0;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      onChangeBand(idx, snapHalfDb(curr + 0.5));
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      onChangeBand(idx, snapHalfDb(curr - 0.5));
    } else if (e.key === 'Home' || e.key === '0') {
      e.preventDefault();
      onChangeBand(idx, 0);
    }
  };

  const zeroY = dbToY(0);

  return (
    <div className="space-y-2.5 border-t border-white/10 pt-3">
      {/* Legend & Active AutoEQ Preamp Compensation Strip */}
      <div className="flex items-center justify-between flex-wrap gap-2 text-[11px]">
        <div className="flex items-center gap-3.5 text-[var(--color-on-surface-variant)]">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 rounded-full bg-[var(--color-accent)]" />
            <span>10-Band SVF Curve</span>
          </span>
          {autoEqOverlay && (
            <>
              <span className="inline-flex items-center gap-1.5 text-purple-300">
                <span className="w-3 border-t-2 border-dashed border-purple-400" />
                <span>AutoEQ ({autoEqOverlay.rigLabel})</span>
              </span>
              <span className="inline-flex items-center gap-1.5 text-sky-300">
                <span className="w-2.5 h-0.5 rounded-full bg-sky-400" />
                <span>Combined</span>
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {autoEqOverlay && (
            <span className="px-2 py-0.5 rounded-full bg-purple-500/20 border border-purple-400/30 font-mono text-[10px] font-semibold text-purple-200">
              Preamp: {autoEqOverlay.preampDb > 0 ? `+${autoEqOverlay.preampDb.toFixed(1)}` : autoEqOverlay.preampDb.toFixed(1)} dB
            </span>
          )}
          <span className="text-[10px] text-[var(--color-on-surface-variant)]">
            Drag handles • Double-click to zero
          </span>
        </div>
      </div>

      {/* Responsive Interactive SVG Canvas */}
      <div className="relative rounded-2xl bg-black/30 border border-white/10 px-2 py-1 select-none overflow-hidden">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          className={`w-full ${heightClassName} touch-none select-none overflow-visible`}
          role="group"
          aria-label="Interactive 10-band equalizer curve"
        >
          <defs>
            <linearGradient id={areaGradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-accent, #FA2D48)" stopOpacity="0.32" />
              <stop offset="75%" stopColor="var(--color-accent, #FA2D48)" stopOpacity="0.08" />
              <stop offset="100%" stopColor="var(--color-accent, #FA2D48)" stopOpacity="0.01" />
            </linearGradient>
            <filter id={glowFilterId} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Horizontal dB Gridlines (+12, +6, 0, -6, -12 dB) */}
          {DB_GRID_LINES.map((db) => {
            const y = dbToY(db);
            const isZero = db === 0;
            return (
              <g key={db}>
                <line
                  x1={PAD_L}
                  y1={y}
                  x2={SVG_W - PAD_R}
                  y2={y}
                  stroke={isZero ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)'}
                  strokeWidth={isZero ? 1.2 : 1}
                  strokeDasharray={isZero ? undefined : '4 4'}
                />
                <text
                  x={PAD_L - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  fontSize="10"
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                  fill={isZero ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.42)'}
                >
                  {db > 0 ? `+${db}` : db}
                </text>
              </g>
            );
          })}

          {/* Axis Boundary Frequency Markers (32Hz and 16kHz) */}
          <text
            x={freqToX(MIN_FREQ)}
            y={SVG_H - 10}
            textAnchor="middle"
            fontSize="9.5"
            fontFamily="ui-monospace, SFMono-Regular, monospace"
            fill="rgba(255,255,255,0.32)"
          >
            32
          </text>
          <text
            x={freqToX(MAX_FREQ)}
            y={SVG_H - 10}
            textAnchor="middle"
            fontSize="9.5"
            fontFamily="ui-monospace, SFMono-Regular, monospace"
            fill="rgba(255,255,255,0.32)"
          >
            16k
          </text>

          {/* Vertical Frequency Reference Lines */}
          {EQ_FREQUENCIES_HZ.map((freq) => {
            const x = freqToX(freq);
            return (
              <line
                key={`v-${freq}`}
                x1={x}
                y1={PAD_T}
                x2={x}
                y2={PAD_T + PLOT_H}
                stroke="rgba(255,255,255,0.05)"
                strokeWidth="1"
              />
            );
          })}

          {/* Translucent Accent Gradient Fill Under 10-Band Spline */}
          {eqAreaPath && <path d={eqAreaPath} fill={`url(#${areaGradId})`} />}

          {/* Composite Total Curve (10-Band + AutoEQ) */}
          {autoEqOverlay?.compositePath && (
            <path
              d={autoEqOverlay.compositePath}
              fill="none"
              stroke="rgba(56, 189, 248, 0.72)"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Glowing Dashed Violet AutoEQ Curve */}
          {autoEqOverlay?.autoEqPath && (
            <path
              d={autoEqOverlay.autoEqPath}
              fill="none"
              stroke="#A855F7"
              strokeWidth="2.2"
              strokeDasharray="6 4"
              strokeLinecap="round"
              strokeLinejoin="round"
              filter={`url(#${glowFilterId})`}
            />
          )}

          {/* Smooth Catmull-Rom 10-Band EQ Spline */}
          {eqStrokePath && (
            <path
              d={eqStrokePath}
              fill="none"
              stroke="var(--color-accent, #FA2D48)"
              strokeWidth="2.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* 10 Interactive Vertical Tracks & Draggable Band Handles */}
          {EQ_FREQUENCIES_HZ.map((freq, idx) => {
            const gain = safeBands[idx];
            const pt = bandPoints[idx];
            const isActive = draggingBand === idx || hoveredBand === idx;

            return (
              <g
                key={freq}
                role="slider"
                tabIndex={0}
                aria-label={`${formatFreqLabel(freq)} Hz band`}
                aria-valuemin={MIN_DB}
                aria-valuemax={MAX_DB}
                aria-valuenow={gain}
                onPointerDown={(e) => handleBandPointerDown(idx, e)}
                onPointerMove={(e) => handleBandPointerMove(idx, e)}
                onPointerUp={(e) => handleBandPointerEnd(idx, e)}
                onPointerCancel={(e) => handleBandPointerEnd(idx, e)}
                onDoubleClick={(e) => handleBandDoubleClick(idx, e)}
                onKeyDown={(e) => handleBandKeyDown(idx, e)}
                onMouseEnter={() => setHoveredBand(idx)}
                onMouseLeave={() => setHoveredBand((prev) => (prev === idx ? null : prev))}
                className="cursor-ns-resize outline-none"
              >
                {/* Invisible Generous Hit Target */}
                <rect
                  x={pt.x - 18}
                  y={PAD_T - 8}
                  width={36}
                  height={PLOT_H + 16}
                  fill="transparent"
                />

                {/* Vertical Track Background */}
                <line
                  x1={pt.x}
                  y1={PAD_T}
                  x2={pt.x}
                  y2={PAD_T + PLOT_H}
                  stroke="rgba(255,255,255,0.09)"
                  strokeWidth="3"
                  strokeLinecap="round"
                />

                {/* Active Vertical Track Fill from 0 dB to Handle */}
                {Math.abs(gain) > 0.01 && (
                  <line
                    x1={pt.x}
                    y1={zeroY}
                    x2={pt.x}
                    y2={pt.y}
                    stroke="var(--color-accent, #FA2D48)"
                    strokeOpacity={isActive ? 0.95 : 0.7}
                    strokeWidth="3.5"
                    strokeLinecap="round"
                  />
                )}

                {/* Handle Halo */}
                {isActive && (
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={14}
                    fill="var(--color-accent, #FA2D48)"
                    fillOpacity="0.24"
                  />
                )}

                {/* Draggable Circular Band Handle */}
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={isActive ? 7.5 : 6}
                  fill="var(--color-accent, #FA2D48)"
                  stroke="#FFFFFF"
                  strokeWidth="2"
                />

                {/* Live Band dB Readout */}
                <text
                  x={pt.x}
                  y={14}
                  textAnchor="middle"
                  fontSize="10.5"
                  fontWeight={isActive || Math.abs(gain) > 0.01 ? '700' : '500'}
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                  fill={
                    isActive
                      ? '#FFFFFF'
                      : Math.abs(gain) > 0.01
                      ? 'var(--color-accent, #FA2D48)'
                      : 'rgba(255,255,255,0.55)'
                  }
                >
                  {gain > 0 ? `+${gain.toFixed(1)}` : gain.toFixed(1)}
                </text>

                {/* Band Frequency X-Axis Label */}
                <text
                  x={pt.x}
                  y={SVG_H - 10}
                  textAnchor="middle"
                  fontSize="10.5"
                  fontWeight={isActive ? '700' : '500'}
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                  fill={isActive ? '#FFFFFF' : 'rgba(255,255,255,0.65)'}
                >
                  {formatFreqLabel(freq)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};
