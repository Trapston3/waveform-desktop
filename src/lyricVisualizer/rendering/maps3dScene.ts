// Procedural 2.5D Apple Maps Driving Engine (Three.js + Canvas2D Software Fallback).
// Supports 3 distinct biomes (cityscape, highway, countryside) and 3 times of day
// (night, sunset, day) with automatic resolution from track metadata, lyrics, BPM,
// and album-art OKLCH palette.
//
// Strict 60fps zero-GC rendering: all Three.js geometries, materials, instanced pools,
// typed arrays, and scratch vectors are pre-allocated once on init.
// Preserves full Canvas2D 2.5D perspective fallback for headless Node environments.

import * as THREE from 'three';
import type {
  AudioFrameMetrics,
  LyricPalette,
  Lyrics,
  MapBiomeKind,
  MapScenePreference,
  MapTimeOfDay,
  MapTimePreference,
  StyleTrackMetadata,
  TrackInfo,
} from '../core/models';
import { clamp01, drawRoundedRectPath } from './styleInterface';

export interface MapEnvironment {
  readonly biome: MapBiomeKind;
  readonly timeOfDay: MapTimeOfDay;
  readonly cameraDistance: number;
  readonly cameraHeight: number;
  readonly cameraFov: number;
}

export interface MapRoadMilestone {
  readonly lineIndex: number;
  readonly triggerSec: number;
  readonly label: string;
  readonly sublabel: string;
  readonly badgeColor: string;
  readonly iconGlyph: string;
  readonly isExitBubble: boolean;
  readonly sideSign: -1 | 1;
}

interface BiomeCameraSpec {
  readonly distance: number;
  readonly height: number;
  readonly fov: number;
  readonly lookAheadZ: number;
  readonly lookY: number;
}

const BIOME_CAMERA_SPECS: Record<MapBiomeKind, BiomeCameraSpec> = {
  cityscape: {
    distance: 13.5,
    height: 8.6,
    fov: 52,
    lookAheadZ: -18.0,
    lookY: 0.6,
  },
  highway: {
    distance: 7.4,
    height: 4.1,
    fov: 56,
    lookAheadZ: -22.0,
    lookY: 0.45,
  },
  countryside: {
    distance: 8.2,
    height: 4.9,
    fov: 48,
    lookAheadZ: -17.0,
    lookY: 0.5,
  },
};

interface TimePaletteSpec {
  readonly skyTop: string;
  readonly skyMid: string;
  readonly skyHorizon: string;
  readonly fogHex: number;
  readonly groundHex: number;
  readonly groundCss: string;
  readonly roadHex: number;
  readonly roadCss: string;
  readonly shoulderHex: number;
  readonly laneDashHex: number;
  readonly laneDashCss: string;
  readonly routePrimaryHex: number;
  readonly routePrimaryCss: string;
  readonly routeGlowHex: number;
  readonly routeGlowCss: string;
  readonly buildingHex: number;
  readonly buildingAltHex: number;
  readonly buildingCss: string;
  readonly buildingRoofCss: string;
  readonly parkHex: number;
  readonly parkCss: string;
  readonly treeFoliageHex: number;
  readonly treeFoliageCss: string;
  readonly treeTrunkHex: number;
  readonly hillHex: number;
  readonly hillTopHex: number;
  readonly hillCss: string;
  readonly waterHex: number;
  readonly waterCss: string;
  readonly fenceHex: number;
  readonly barnHex: number;
  readonly overpassHex: number;
  readonly sunLightHex: number;
  readonly sunIntensity: number;
  readonly hemiSkyHex: number;
  readonly hemiGroundHex: number;
  readonly hemiIntensity: number;
  readonly windowGlow: number;
  readonly headlightIntensity: number;
  readonly taillightIntensity: number;
  readonly calloutBg: string;
  readonly calloutText: string;
  readonly calloutBorder: string;
}

const TIME_PALETTES: Record<MapTimeOfDay, TimePaletteSpec> = {
  night: {
    skyTop: '#060a14',
    skyMid: '#0c1528',
    skyHorizon: '#16233d',
    fogHex: 0x0d1527,
    groundHex: 0x0e1525,
    groundCss: '#0e1525',
    roadHex: 0x1c2538,
    roadCss: '#1c2538',
    shoulderHex: 0x26324a,
    laneDashHex: 0xcbd5e1,
    laneDashCss: 'rgba(203, 213, 225, 0.72)',
    routePrimaryHex: 0x0a84ff,
    routePrimaryCss: '#0A84FF',
    routeGlowHex: 0x38bdf8,
    routeGlowCss: '#38BDF8',
    buildingHex: 0x1a2439,
    buildingAltHex: 0x212d46,
    buildingCss: '#1a2439',
    buildingRoofCss: '#273552',
    parkHex: 0x103b36,
    parkCss: '#103b36',
    treeFoliageHex: 0x14554d,
    treeFoliageCss: '#14554d',
    treeTrunkHex: 0x3c2c24,
    hillHex: 0x112a2b,
    hillTopHex: 0x163b38,
    hillCss: '#133131',
    waterHex: 0x0b223d,
    waterCss: '#0d294a',
    fenceHex: 0x5c4b3c,
    barnHex: 0x6b2f35,
    overpassHex: 0x374357,
    sunLightHex: 0x93c5fd,
    sunIntensity: 1.05,
    hemiSkyHex: 0x3b82f6,
    hemiGroundHex: 0x090d16,
    hemiIntensity: 0.75,
    windowGlow: 1.0,
    headlightIntensity: 1.0,
    taillightIntensity: 1.0,
    calloutBg: 'rgba(18, 25, 40, 0.90)',
    calloutText: '#f8fafc',
    calloutBorder: 'rgba(56, 189, 248, 0.55)',
  },
  sunset: {
    skyTop: '#1c1836',
    skyMid: '#7c3a56',
    skyHorizon: '#f59e56',
    fogHex: 0x452a3f,
    groundHex: 0x232230,
    groundCss: '#232230',
    roadHex: 0x2c2b3a,
    roadCss: '#2c2b3a',
    shoulderHex: 0x433d4f,
    laneDashHex: 0xfef3c7,
    laneDashCss: 'rgba(254, 243, 199, 0.78)',
    routePrimaryHex: 0x0a84ff,
    routePrimaryCss: '#0A84FF',
    routeGlowHex: 0x60a5fa,
    routeGlowCss: '#60A5FA',
    buildingHex: 0x312e42,
    buildingAltHex: 0x3e374d,
    buildingCss: '#322e42',
    buildingRoofCss: '#52465c',
    parkHex: 0x2d483a,
    parkCss: '#2d483a',
    treeFoliageHex: 0x3f6148,
    treeFoliageCss: '#3f6148',
    treeTrunkHex: 0x4f3829,
    hillHex: 0x384339,
    hillTopHex: 0x525742,
    hillCss: '#3e473b',
    waterHex: 0x3b3556,
    waterCss: '#483b5d',
    fenceHex: 0x7c5b41,
    barnHex: 0x993e38,
    overpassHex: 0x635b6b,
    sunLightHex: 0xffad66,
    sunIntensity: 1.85,
    hemiSkyHex: 0xfb923c,
    hemiGroundHex: 0x1e1b2e,
    hemiIntensity: 0.92,
    windowGlow: 0.72,
    headlightIntensity: 0.65,
    taillightIntensity: 0.85,
    calloutBg: 'rgba(30, 26, 42, 0.90)',
    calloutText: '#fffbeb',
    calloutBorder: 'rgba(251, 191, 36, 0.55)',
  },
  day: {
    skyTop: '#4a90d9',
    skyMid: '#8cc4f0',
    skyHorizon: '#d9eefc',
    fogHex: 0xc9e2f5,
    groundHex: 0xd9e3d8,
    groundCss: '#d9e3d8',
    roadHex: 0x3c434f,
    roadCss: '#3c434f',
    shoulderHex: 0xc2cbd4,
    laneDashHex: 0xffffff,
    laneDashCss: 'rgba(255, 255, 255, 0.90)',
    routePrimaryHex: 0x007aff,
    routePrimaryCss: '#007AFF',
    routeGlowHex: 0x38bdf8,
    routeGlowCss: '#38BDF8',
    buildingHex: 0xe6ebf0,
    buildingAltHex: 0xd5dde6,
    buildingCss: '#e2e8f0',
    buildingRoofCss: '#f8fafc',
    parkHex: 0x9bd193,
    parkCss: '#9bd193',
    treeFoliageHex: 0x67b065,
    treeFoliageCss: '#67b065',
    treeTrunkHex: 0x7b5e46,
    hillHex: 0xa4d197,
    hillTopHex: 0x8ac27e,
    hillCss: '#9ac98f',
    waterHex: 0x67b8f7,
    waterCss: '#67b8f7',
    fenceHex: 0xa9825c,
    barnHex: 0xc74a42,
    overpassHex: 0xe5e9ee,
    sunLightHex: 0xfff8eb,
    sunIntensity: 2.05,
    hemiSkyHex: 0xdbeafe,
    hemiGroundHex: 0x9cc792,
    hemiIntensity: 1.08,
    windowGlow: 0.0,
    headlightIntensity: 0.0,
    taillightIntensity: 0.35,
    calloutBg: 'rgba(255, 255, 255, 0.94)',
    calloutText: '#0f172a',
    calloutBorder: 'rgba(0, 122, 255, 0.45)',
  },
};

// Regex matchers for deterministic biome & time-of-day inference
const CITY_RE =
  /\b(hip[\s-]?hop|rap|r&b|rnb|pop|electronic|dance|house|techno|trap|urban|city|downtown|skyline|tower|towers|subway|metro|street|streets|avenue|boulevard|blvd|club|neon|traffic|block|concrete|tokyo|shibuya|nyc|new york|manhattan|brooklyn|london|paris|miami|chicago|la|los angeles)\b/gi;
const HIGHWAY_RE =
  /\b(rock|alternative|punk|metal|synthwave|outrun|highway|freeway|expressway|interstate|overpass|asphalt|drive|driving|driver|fast|speed|speeding|turbo|engine|lane|lanes|exit|pedal|wheel|wheels|throttle|gas|burnout|convertible|porsche|ferrari|lamborghini|midnight drive)\b/gi;
const COUNTRY_RE =
  /\b(country|acoustic|folk|indie|lo[\s-]?fi|lofi|ballad|meadow|valley|hills?|river|harbor|harbour|coast|coastal|ocean|sea|tide|woods?|forest|pine|cedar|barn|cottage|farm|field|fields|lake|mountain|mountains|breeze|wildflower|porch|cabin|gravel|dirt road|lanterns?)\b/gi;

const NIGHT_RE =
  /\b(night|midnight|moon|moonlight|neon|dark|darkness|shadow|shadows|star|stars|starlight|3\s*am|after\s+hours|blackout|club|lanterns?|constellations?|nocturne|sleep|dream)\b/gi;
const DAY_RE =
  /\b(sun|sunshine|sunlight|morning|bright|daylight|noon|summer|blue\s+sky|clear\s+sky|afternoon|awake|daytime|radiant|sunny)\b/gi;
const SUNSET_RE =
  /\b(sunset|evening|golden|amber|dusk|horizon|glow|warm|nostalgic|acoustic|autumn|copper|coral|twilight|fade|sundown|violet\s+sky)\b/gi;

function countMatches(text: string, re: RegExp): number {
  re.lastIndex = 0;
  let count = 0;
  while (re.exec(text) !== null) {
    count++;
    if (count >= 24) break;
  }
  return count;
}

/**
 * Resolve biome, time-of-day, and camera preset deterministically from track metadata,
 * lyrics, BPM, album-art OKLCH palette, and explicit user overrides.
 */
export function resolveMapEnvironment(
  track: StyleTrackMetadata | TrackInfo | null | undefined,
  lyrics: Lyrics | null | undefined,
  bpm: number | undefined,
  palette: LyricPalette | null | undefined,
  scenePref?: MapScenePreference,
  timePref?: MapTimePreference
): MapEnvironment {
  // Gather concise text sample from track metadata and up to first 36 lyric lines
  let corpus = '';
  if (track) {
    corpus += `${track.title ?? ''} ${track.artist ?? ''} ${track.album ?? ''} `;
  }
  if (lyrics && lyrics.lines.length > 0) {
    const limit = Math.min(36, lyrics.lines.length);
    for (let i = 0; i < limit; i++) {
      corpus += lyrics.lines[i].text;
      corpus += ' ';
    }
  }

  const effectiveBpm =
    typeof bpm === 'number' && Number.isFinite(bpm) && bpm > 0
      ? bpm
      : typeof track?.bpm === 'number' && Number.isFinite(track.bpm) && track.bpm > 0
      ? track.bpm
      : 108;

  // 1. Resolve Biome
  let biome: MapBiomeKind;
  if (scenePref === 'cityscape' || scenePref === 'highway' || scenePref === 'countryside') {
    biome = scenePref;
  } else {
    let cityScore = countMatches(corpus, CITY_RE) * 2.1;
    let highwayScore = countMatches(corpus, HIGHWAY_RE) * 2.2;
    let countryScore = countMatches(corpus, COUNTRY_RE) * 2.2;

    if (effectiveBpm > 116) {
      highwayScore += 3.2;
      if (effectiveBpm >= 126) highwayScore += 1.4;
    } else if (effectiveBpm < 95) {
      countryScore += 3.2;
      if (effectiveBpm <= 84) countryScore += 1.2;
    } else {
      cityScore += 1.6;
    }

    if (highwayScore > cityScore && highwayScore > countryScore) {
      biome = 'highway';
    } else if (countryScore > cityScore && countryScore >= highwayScore) {
      biome = 'countryside';
    } else {
      biome = 'cityscape';
    }
  }

  // 2. Resolve Time of Day
  let timeOfDay: MapTimeOfDay;
  if (timePref === 'night' || timePref === 'sunset' || timePref === 'day') {
    timeOfDay = timePref;
  } else {
    let nightScore = countMatches(corpus, NIGHT_RE) * 2.4;
    let dayScore = countMatches(corpus, DAY_RE) * 2.4;
    let sunsetScore = countMatches(corpus, SUNSET_RE) * 2.3;

    if (biome === 'countryside' && effectiveBpm < 98) {
      sunsetScore += 0.9;
    }

    if (palette) {
      const l = Number.isFinite(palette.oklchL) ? palette.oklchL : 0.45;
      const h = Number.isFinite(palette.oklchH) ? ((palette.oklchH % 360) + 360) % 360 : 220;
      const isWarmHue = (h >= 12 && h <= 86) || h >= 332;

      if (l < 0.44) {
        nightScore += 2.6;
      } else if (l > 0.65) {
        dayScore += 2.6;
      } else if (isWarmHue) {
        sunsetScore += 2.2;
      } else {
        nightScore += 0.8;
      }
      if (isWarmHue && l >= 0.36 && l <= 0.68) {
        sunsetScore += 1.2;
      }
    } else {
      nightScore += 0.6;
    }

    if (dayScore > nightScore && dayScore > sunsetScore) {
      timeOfDay = 'day';
    } else if (sunsetScore > nightScore && sunsetScore >= dayScore) {
      timeOfDay = 'sunset';
    } else {
      timeOfDay = 'night';
    }
  }

  const cam = BIOME_CAMERA_SPECS[biome];
  return {
    biome,
    timeOfDay,
    cameraDistance: cam.distance,
    cameraHeight: cam.height,
    cameraFov: cam.fov,
  };
}

// ---------------------------------------------------------------------------
// Deterministic Semantic Road Callout & POI Milestone Builder (Precomputed Once)
// ---------------------------------------------------------------------------

interface SemanticMilestoneRule {
  readonly re: RegExp;
  readonly label: string;
  readonly sublabel: string;
  readonly badgeColor: string;
  readonly iconGlyph: string;
  readonly isExitBubble: boolean;
}

const SEMANTIC_MILESTONE_RULES: readonly SemanticMilestoneRule[] = [
  { re: /\b(fire|burn|burning|flame|blaze|hot)\b/i, label: 'Burn Blvd', sublabel: 'Thermal', badgeColor: '#F97316', iconGlyph: '🔥', isExitBubble: true },
  { re: /\b(electric|lightning|thunder|shock|spark|volt)\b/i, label: 'Electric Ave', sublabel: 'Power Grid', badgeColor: '#38BDF8', iconGlyph: '⚡', isExitBubble: true },
  { re: /\b(midnight|moon|moonlight|night|starlight|stars)\b/i, label: 'Midnight Bridge', sublabel: 'Overlook', badgeColor: '#6366F1', iconGlyph: '🌙', isExitBubble: true },
  { re: /\b(ocean|sea|wave|waves|tide|harbor|harbour|coast)\b/i, label: 'Harbor Pkwy', sublabel: 'Waterfront', badgeColor: '#0EA5E9', iconGlyph: '🌊', isExitBubble: true },
  { re: /\b(heart|love|kiss|lover|forever)\b/i, label: 'Heart Plaza', sublabel: 'Landmark', badgeColor: '#F43F5E', iconGlyph: '♥', isExitBubble: false },
  { re: /\b(crown|king|queen|royal|gold|diamond)\b/i, label: 'Crown Sq', sublabel: 'District', badgeColor: '#F59E0B', iconGlyph: '★', isExitBubble: false },
  { re: /\b(sun|sunrise|sunshine|morning|golden|amber)\b/i, label: 'Sunrise Crest', sublabel: 'Scenic', badgeColor: '#FB923C', iconGlyph: '☀', isExitBubble: false },
  { re: /\b(rain|storm|tears|cloud|sky)\b/i, label: 'Skyline Way', sublabel: 'Vista', badgeColor: '#60A5FA', iconGlyph: '✦', isExitBubble: true },
  { re: /\b(home|house|door|room|back)\b/i, label: 'Home Exit', sublabel: '0.4 mi', badgeColor: '#10B981', iconGlyph: '⌂', isExitBubble: true },
  { re: /\b(city|downtown|neon|tokyo|street|club)\b/i, label: 'Neon District', sublabel: 'Midtown', badgeColor: '#A855F7', iconGlyph: '◈', isExitBubble: false },
  { re: /\b(drive|highway|road|fast|speed|car)\b/i, label: 'Expressway', sublabel: 'I-280 N', badgeColor: '#0A84FF', iconGlyph: '↱', isExitBubble: true },
  { re: /\b(music|song|rhythm|dance|beat|melody)\b/i, label: 'Soundstage', sublabel: 'Live Venue', badgeColor: '#EC4899', iconGlyph: '♪', isExitBubble: false },
];

const BIOME_AMBIENT_EXITS: Record<MapBiomeKind, readonly string[]> = {
  cityscape: ['Midtown', 'Arts Dist', 'Bayfront', 'Central Pk', 'Pier 14', 'Metro Hub'],
  highway: ['I-280 N', 'US-101 S', 'Bay Bridge', 'Skyway', 'Summit Rd', 'Coast Hwy'],
  countryside: ['Cedar Creek', 'Pine Ridge', 'Harbor Rd', 'Meadow Ln', 'Old Mill', 'Vista Pt'],
};

function hashUint(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

// ---------------------------------------------------------------------------
// Road Spline Math (Shared by Three.js + Canvas2D Fallback)
// ---------------------------------------------------------------------------

function sampleRoadX(zWorld: number, biome: MapBiomeKind): number {
  if (biome === 'cityscape') {
    return Math.sin(zWorld * 0.015) * 2.1 + Math.cos(zWorld * 0.007) * 1.1;
  }
  if (biome === 'highway') {
    return Math.sin(zWorld * 0.024) * 5.2 + Math.cos(zWorld * 0.011) * 2.4;
  }
  // countryside: scenic winding 2-lane road
  return Math.sin(zWorld * 0.032) * 4.4 + Math.cos(zWorld * 0.017) * 2.8;
}

function sampleRoadSlope(zWorld: number, biome: MapBiomeKind): number {
  if (biome === 'cityscape') {
    return Math.cos(zWorld * 0.015) * 2.1 * 0.015 - Math.sin(zWorld * 0.007) * 1.1 * 0.007;
  }
  if (biome === 'highway') {
    return Math.cos(zWorld * 0.024) * 5.2 * 0.024 - Math.sin(zWorld * 0.011) * 2.4 * 0.011;
  }
  return Math.cos(zWorld * 0.032) * 4.4 * 0.032 - Math.sin(zWorld * 0.017) * 2.8 * 0.017;
}

function getRoadHalfWidth(biome: MapBiomeKind): number {
  if (biome === 'highway') return 4.3;
  if (biome === 'cityscape') return 3.3;
  return 2.45;
}

// ---------------------------------------------------------------------------
// Pre-allocated Pool Constants
// ---------------------------------------------------------------------------

const ROAD_SEGMENTS = 64;
const ROAD_Z_NEAR = 14.0;
const ROAD_Z_FAR = -92.0;
const ROAD_SPAN = ROAD_Z_NEAR - ROAD_Z_FAR;

const LANE_DASH_COUNT = 32;
const CHEVRON_COUNT = 18;
const CITY_BLOCK_COUNT = 64;
const CITY_WINDOW_COUNT = 96;
const CITY_PARK_COUNT = 14;
const TRAFFIC_LIGHT_COUNT = 8;

const HIGHWAY_OVERPASS_COUNT = 3;
const HIGHWAY_SIGN_COUNT = 4;
const HIGHWAY_TREE_COUNT = 48;

const COUNTRY_HILL_COUNT = 32;
const COUNTRY_TREE_COUNT = 56;
const COUNTRY_FENCE_COUNT = 44;
const COUNTRY_COTTAGE_COUNT = 10;

const MAX_PROJECTED_CALLOUTS = 4;

interface ThreeMapsState {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly fog: THREE.FogExp2;
  readonly camera: THREE.PerspectiveCamera;
  readonly sunLight: THREE.DirectionalLight;
  readonly hemiLight: THREE.HemisphereLight;
  readonly groundMesh: THREE.Mesh;
  readonly groundMat: THREE.MeshLambertMaterial;
  readonly roadGeo: THREE.BufferGeometry;
  readonly roadPosArr: Float32Array;
  readonly roadMat: THREE.MeshLambertMaterial;
  readonly shoulderGeo: THREE.BufferGeometry;
  readonly shoulderPosArr: Float32Array;
  readonly shoulderMat: THREE.MeshLambertMaterial;
  readonly routeGeo: THREE.BufferGeometry;
  readonly routePosArr: Float32Array;
  readonly routeMat: THREE.MeshBasicMaterial;
  readonly routeCoreGeo: THREE.BufferGeometry;
  readonly routeCorePosArr: Float32Array;
  readonly routeCoreMat: THREE.MeshBasicMaterial;
  readonly laneDashMesh: THREE.InstancedMesh;
  readonly laneDashMat: THREE.MeshBasicMaterial;
  readonly chevronMesh: THREE.InstancedMesh;
  readonly chevronMat: THREE.MeshBasicMaterial;
  // CarPlay Car
  readonly carGroup: THREE.Group;
  readonly carHeadlightLeft: THREE.Mesh;
  readonly carHeadlightRight: THREE.Mesh;
  readonly carHeadlightBeamMat: THREE.MeshBasicMaterial;
  readonly carTaillightMat: THREE.MeshBasicMaterial;
  readonly carHaloMesh: THREE.Mesh;
  readonly carHaloMat: THREE.MeshBasicMaterial;
  // Cityscape group
  readonly cityGroup: THREE.Group;
  readonly cityBlocksMesh: THREE.InstancedMesh;
  readonly cityBlocksMat: THREE.MeshLambertMaterial;
  readonly cityRoofsMesh: THREE.InstancedMesh;
  readonly cityRoofsMat: THREE.MeshLambertMaterial;
  readonly cityWindowsMesh: THREE.InstancedMesh;
  readonly cityWindowsMat: THREE.MeshBasicMaterial;
  readonly cityParksMesh: THREE.InstancedMesh;
  readonly cityParksMat: THREE.MeshLambertMaterial;
  readonly cityTreesMesh: THREE.InstancedMesh;
  readonly cityTreesMat: THREE.MeshLambertMaterial;
  readonly trafficPoleMesh: THREE.InstancedMesh;
  readonly trafficGlowMesh: THREE.InstancedMesh;
  readonly trafficGlowMat: THREE.MeshBasicMaterial;
  // Highway group
  readonly highwayGroup: THREE.Group;
  readonly overpassDeckMesh: THREE.InstancedMesh;
  readonly overpassDeckMat: THREE.MeshLambertMaterial;
  readonly overpassRailMesh: THREE.InstancedMesh;
  readonly overpassPillarMesh: THREE.InstancedMesh;
  readonly highwaySignPoles: THREE.InstancedMesh;
  readonly highwaySignBoards: THREE.InstancedMesh;
  readonly highwayTreesTrunk: THREE.InstancedMesh;
  readonly highwayTreesCrown: THREE.InstancedMesh;
  readonly highwayTreesCrownMat: THREE.MeshLambertMaterial;
  // Countryside group
  readonly countryGroup: THREE.Group;
  readonly countryHillsMesh: THREE.InstancedMesh;
  readonly countryHillsMat: THREE.MeshLambertMaterial;
  readonly countryHillCapsMesh: THREE.InstancedMesh;
  readonly countryHillCapsMat: THREE.MeshLambertMaterial;
  readonly countryTreesTrunk: THREE.InstancedMesh;
  readonly countryTreesCrown: THREE.InstancedMesh;
  readonly countryTreesCrownMat: THREE.MeshLambertMaterial;
  readonly countryFenceMesh: THREE.InstancedMesh;
  readonly countryFenceMat: THREE.MeshLambertMaterial;
  readonly countryBarnBodyMesh: THREE.InstancedMesh;
  readonly countryBarnBodyMat: THREE.MeshLambertMaterial;
  readonly countryBarnRoofMesh: THREE.InstancedMesh;
  readonly riverGeo: THREE.BufferGeometry;
  readonly riverPosArr: Float32Array;
  readonly riverMat: THREE.MeshBasicMaterial;
  readonly disposables: Array<{ dispose: () => void }>;
}

function createHighwayShieldTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return null;
  }
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d');
  if (!g) return null;

  g.fillStyle = '#0f6a3c';
  g.fillRect(0, 0, 256, 96);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 4;
  g.strokeRect(5, 5, 246, 86);

  // Interstate I-280 shield badge on left
  g.fillStyle = '#dc2626';
  g.fillRect(18, 18, 44, 16);
  g.fillStyle = '#1d4ed8';
  g.fillRect(18, 34, 44, 42);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 2;
  g.strokeRect(18, 18, 44, 58);

  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 10px sans-serif';
  g.fillText('I-280', 40, 26);
  g.font = 'bold 16px sans-serif';
  g.fillText('101', 40, 56);

  g.textAlign = 'left';
  g.font = 'bold 20px sans-serif';
  g.fillText('EXPRESS', 76, 36);
  g.font = '600 15px sans-serif';
  g.fillStyle = '#e2f8ec';
  g.fillText('EXIT 47  ↗', 76, 65);

  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function createRibbonGeometry(segments: number): {
  geo: THREE.BufferGeometry;
  pos: Float32Array;
} {
  const vertCount = (segments + 1) * 2;
  const pos = new Float32Array(vertCount * 3);
  const indices = new Uint16Array(segments * 6);
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    const idx = i * 6;
    indices[idx] = a;
    indices[idx + 1] = b;
    indices[idx + 2] = c;
    indices[idx + 3] = b;
    indices[idx + 4] = d;
    indices[idx + 5] = c;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  // Upward normals for flat-lit ribbons
  const normals = new Float32Array(vertCount * 3);
  for (let i = 0; i < vertCount; i++) {
    normals[i * 3 + 1] = 1;
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return { geo, pos };
}

function fillRibbonPositions(
  pos: Float32Array,
  segments: number,
  travelZ: number,
  biome: MapBiomeKind,
  halfWidth: number,
  yOffset: number,
  lateralShift: number,
  extraWaveAmp = 0
): void {
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const zLocal = ROAD_Z_NEAR - u * ROAD_SPAN;
    const zWorld = travelZ - zLocal;
    const center =
      sampleRoadX(zWorld, biome) +
      lateralShift +
      (extraWaveAmp !== 0 ? Math.sin(zWorld * 0.045) * extraWaveAmp : 0);
    const base = i * 6;
    pos[base] = center - halfWidth;
    pos[base + 1] = yOffset;
    pos[base + 2] = zLocal;
    pos[base + 3] = center + halfWidth;
    pos[base + 4] = yOffset;
    pos[base + 5] = zLocal;
  }
}

export class Maps3DScene {
  private threeState: ThreeMapsState | null = null;
  private threeAttempted = false;
  private threeActive = false;
  private width = 960;
  private height = 540;
  private dpr = 1;

  // Cached environment & milestones
  private env: MapEnvironment = {
    biome: 'highway',
    timeOfDay: 'night',
    cameraDistance: BIOME_CAMERA_SPECS.highway.distance,
    cameraHeight: BIOME_CAMERA_SPECS.highway.height,
    cameraFov: BIOME_CAMERA_SPECS.highway.fov,
  };
  private cachedTrackKey = '';
  private cachedLyricsRef: Lyrics | null = null;
  private cachedScenePref: MapScenePreference = 'auto';
  private cachedTimePref: MapTimePreference = 'auto';
  private cachedPaletteL = -1;
  private cachedPaletteH = -1;
  private appliedBiome: MapBiomeKind | null = null;
  private appliedTimeOfDay: MapTimeOfDay | null = null;

  private milestones: MapRoadMilestone[] = [];

  // Continuous driving state
  private travelDistance = 0;
  private smoothedCarX = 0;
  private smoothedCarYaw = 0;
  private smoothedCarBank = 0;
  private beatPulse = 0;
  private lastTimeSec = -1;

  // Pre-allocated zero-GC scratch objects
  private readonly dummy = new THREE.Object3D();
  private readonly tmpVec = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();
  // Software fallback pre-allocated buffers (ROAD_SEGMENTS + 1 points)
  private readonly swLeftX = new Float32Array(ROAD_SEGMENTS + 1);
  private readonly swRightX = new Float32Array(ROAD_SEGMENTS + 1);
  private readonly swCenterX = new Float32Array(ROAD_SEGMENTS + 1);
  private readonly swScreenY = new Float32Array(ROAD_SEGMENTS + 1);
  private readonly swScale = new Float32Array(ROAD_SEGMENTS + 1);
  // Pre-allocated projected callout slot arrays
  private readonly projX = new Float32Array(MAX_PROJECTED_CALLOUTS);
  private readonly projY = new Float32Array(MAX_PROJECTED_CALLOUTS);
  private readonly projScale = new Float32Array(MAX_PROJECTED_CALLOUTS);
  private readonly projAlpha = new Float32Array(MAX_PROJECTED_CALLOUTS);
  private readonly projMilestoneIdx = new Int32Array(MAX_PROJECTED_CALLOUTS);

  private readonly boundContextLost = (e: Event): void => {
    e.preventDefault();
    this.threeActive = false;
  };

  getEnvironment(): MapEnvironment {
    return this.env;
  }

  isWebGlActive(): boolean {
    return this.threeActive;
  }

  reset(): void {
    this.travelDistance = 0;
    this.smoothedCarX = 0;
    this.smoothedCarYaw = 0;
    this.smoothedCarBank = 0;
    this.beatPulse = 0;
    this.lastTimeSec = -1;
    this.cachedTrackKey = '';
    this.cachedLyricsRef = null;
    this.milestones = [];
  }

  dispose(): void {
    const st = this.threeState;
    if (st) {
      st.canvas.removeEventListener('webglcontextlost', this.boundContextLost);
      for (let i = 0; i < st.disposables.length; i++) {
        st.disposables[i].dispose();
      }
      st.renderer.dispose();
    }
    this.threeState = null;
    this.threeActive = false;
    this.threeAttempted = false;
    this.appliedBiome = null;
    this.appliedTimeOfDay = null;
  }

  private ensureThreeInitialized(): void {
    if (this.threeAttempted) return;
    this.threeAttempted = true;

    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      this.threeActive = false;
      return;
    }

    const canvas = document.createElement('canvas');
    if (typeof canvas.addEventListener !== 'function') {
      this.threeActive = false;
      return;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: false,
        antialias: true,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
      });
    } catch {
      this.threeActive = false;
      return;
    }

    renderer.setPixelRatio(this.dpr);
    renderer.setSize(this.width, this.height, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    canvas.addEventListener('webglcontextlost', this.boundContextLost);

    const disposables: Array<{ dispose: () => void }> = [];
    const trackDisp = <T extends { dispose: () => void }>(item: T): T => {
      disposables.push(item);
      return item;
    };

    const scene = new THREE.Scene();
    const fog = new THREE.FogExp2(0x0d1527, 0.0155);
    scene.fog = fog;
    scene.background = new THREE.Color(0x0d1527);

    const camera = new THREE.PerspectiveCamera(52, this.width / Math.max(1, this.height), 0.25, 160);
    camera.position.set(0, 5.5, 9.5);
    camera.lookAt(0, 0.5, -18);

    // Lighting
    const sunLight = new THREE.DirectionalLight(0x93c5fd, 1.3);
    sunLight.position.set(18, 28, 12);
    scene.add(sunLight);

    const hemiLight = new THREE.HemisphereLight(0x3b82f6, 0x090d16, 0.85);
    scene.add(hemiLight);

    // Ground plane
    const groundGeo = trackDisp(new THREE.PlaneGeometry(260, 220));
    const groundMat = trackDisp(new THREE.MeshLambertMaterial({ color: 0x0e1525 }));
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI * 0.5;
    groundMesh.position.set(0, -0.05, -35);
    scene.add(groundMesh);

    // Road asphalt, shoulder, and glowing Apple Maps navigation ribbon
    const shoulder = createRibbonGeometry(ROAD_SEGMENTS);
    trackDisp(shoulder.geo);
    const shoulderMat = trackDisp(new THREE.MeshLambertMaterial({ color: 0x26324a }));
    const shoulderMesh = new THREE.Mesh(shoulder.geo, shoulderMat);
    scene.add(shoulderMesh);

    const road = createRibbonGeometry(ROAD_SEGMENTS);
    trackDisp(road.geo);
    const roadMat = trackDisp(new THREE.MeshLambertMaterial({ color: 0x1c2538 }));
    const roadMesh = new THREE.Mesh(road.geo, roadMat);
    scene.add(roadMesh);

    const route = createRibbonGeometry(ROAD_SEGMENTS);
    trackDisp(route.geo);
    const routeMat = trackDisp(
      new THREE.MeshBasicMaterial({
        color: 0x0a84ff,
        transparent: true,
        opacity: 0.9,
      })
    );
    const routeMesh = new THREE.Mesh(route.geo, routeMat);
    scene.add(routeMesh);

    const routeCore = createRibbonGeometry(ROAD_SEGMENTS);
    trackDisp(routeCore.geo);
    const routeCoreMat = trackDisp(
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.85,
      })
    );
    const routeCoreMesh = new THREE.Mesh(routeCore.geo, routeCoreMat);
    scene.add(routeCoreMesh);

    // Lane dashes + animated route chevrons
    const dashGeo = trackDisp(new THREE.BoxGeometry(0.14, 0.02, 1.9));
    const laneDashMat = trackDisp(
      new THREE.MeshBasicMaterial({ color: 0xcbd5e1, transparent: true, opacity: 0.78 })
    );
    const laneDashMesh = new THREE.InstancedMesh(dashGeo, laneDashMat, LANE_DASH_COUNT);
    laneDashMesh.frustumCulled = false;
    scene.add(laneDashMesh);

    const chevGeo = trackDisp(new THREE.ConeGeometry(0.42, 0.75, 3));
    chevGeo.rotateX(-Math.PI * 0.5);
    chevGeo.scale(1.0, 0.14, 1.0);
    const chevronMat = trackDisp(
      new THREE.MeshBasicMaterial({ color: 0xe0f2fe, transparent: true, opacity: 0.85 })
    );
    const chevronMesh = new THREE.InstancedMesh(chevGeo, chevronMat, CHEVRON_COUNT);
    chevronMesh.frustumCulled = false;
    scene.add(chevronMesh);

    // Low-Poly 3D White CarPlay Car
    const carGroup = new THREE.Group();
    const carBodyMat = trackDisp(
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.28, metalness: 0.25 })
    );
    const carCabinMat = trackDisp(
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.12, metalness: 0.6 })
    );
    const carWheelMat = trackDisp(new THREE.MeshLambertMaterial({ color: 0x111827 }));
    const carHeadlightBeamMat = trackDisp(
      new THREE.MeshBasicMaterial({
        color: 0xfff8d6,
        transparent: true,
        opacity: 0.26,
        depthWrite: false,
      })
    );
    const carTaillightMat = trackDisp(new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
    const carHeadlampMat = trackDisp(new THREE.MeshBasicMaterial({ color: 0xfffbeb }));

    // Lower chassis
    const chassisGeo = trackDisp(new THREE.BoxGeometry(1.18, 0.36, 2.38));
    const chassisMesh = new THREE.Mesh(chassisGeo, carBodyMat);
    chassisMesh.position.set(0, 0.32, 0);
    carGroup.add(chassisMesh);

    // Sculpted sloped cabin
    const cabinGeo = trackDisp(new THREE.BoxGeometry(0.98, 0.32, 1.24));
    const cabinMesh = new THREE.Mesh(cabinGeo, carCabinMat);
    cabinMesh.position.set(0, 0.62, 0.12);
    carGroup.add(cabinMesh);

    // White roof cap
    const roofGeo = trackDisp(new THREE.BoxGeometry(0.92, 0.06, 0.96));
    const roofMesh = new THREE.Mesh(roofGeo, carBodyMat);
    roofMesh.position.set(0, 0.79, 0.14);
    carGroup.add(roofMesh);

    // 4 wheels
    const wheelGeo = trackDisp(new THREE.CylinderGeometry(0.21, 0.21, 0.16, 10));
    wheelGeo.rotateZ(Math.PI * 0.5);
    const wheelPositions: readonly [number, number, number][] = [
      [-0.6, 0.21, -0.72],
      [0.6, 0.21, -0.72],
      [-0.6, 0.21, 0.72],
      [0.6, 0.21, 0.72],
    ];
    for (let i = 0; i < wheelPositions.length; i++) {
      const wp = wheelPositions[i];
      const wm = new THREE.Mesh(wheelGeo, carWheelMat);
      wm.position.set(wp[0], wp[1], wp[2]);
      carGroup.add(wm);
    }

    // Front headlamps + ground light cones
    const lampGeo = trackDisp(new THREE.BoxGeometry(0.24, 0.1, 0.06));
    const hlLeft = new THREE.Mesh(lampGeo, carHeadlampMat);
    hlLeft.position.set(-0.38, 0.36, -1.2);
    carGroup.add(hlLeft);
    const hlRight = new THREE.Mesh(lampGeo, carHeadlampMat);
    hlRight.position.set(0.38, 0.36, -1.2);
    carGroup.add(hlRight);

    const beamGeo = trackDisp(new THREE.ConeGeometry(1.15, 5.8, 12, 1, true));
    beamGeo.rotateX(Math.PI * 0.5);
    const carHeadlightLeft = new THREE.Mesh(beamGeo, carHeadlightBeamMat);
    carHeadlightLeft.position.set(-0.38, 0.16, -4.1);
    carHeadlightLeft.scale.set(1.0, 0.18, 1.0);
    carGroup.add(carHeadlightLeft);
    const carHeadlightRight = new THREE.Mesh(beamGeo, carHeadlightBeamMat);
    carHeadlightRight.position.set(0.38, 0.16, -4.1);
    carHeadlightRight.scale.set(1.0, 0.18, 1.0);
    carGroup.add(carHeadlightRight);

    // Rear red taillights bar + pods
    const tailGeo = trackDisp(new THREE.BoxGeometry(0.28, 0.11, 0.06));
    const tlLeft = new THREE.Mesh(tailGeo, carTaillightMat);
    tlLeft.position.set(-0.39, 0.38, 1.2);
    carGroup.add(tlLeft);
    const tlRight = new THREE.Mesh(tailGeo, carTaillightMat);
    tlRight.position.set(0.39, 0.38, 1.2);
    carGroup.add(tlRight);
    const tailBarGeo = trackDisp(new THREE.BoxGeometry(0.56, 0.045, 0.05));
    const tailBar = new THREE.Mesh(tailBarGeo, carTaillightMat);
    tailBar.position.set(0, 0.39, 1.2);
    carGroup.add(tailBar);

    // Apple Maps blue GPS halo ring beneath car
    const haloGeo = trackDisp(new THREE.RingGeometry(1.05, 1.48, 28));
    haloGeo.rotateX(-Math.PI * 0.5);
    const carHaloMat = trackDisp(
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      })
    );
    const carHaloMesh = new THREE.Mesh(haloGeo, carHaloMat);
    carHaloMesh.position.set(0, 0.08, 0);
    carGroup.add(carHaloMesh);
    scene.add(carGroup);

    // ---------------- BIOME 1: CITYSCAPE ----------------
    const cityGroup = new THREE.Group();
    const blockGeo = trackDisp(new THREE.BoxGeometry(1, 1, 1));
    const cityBlocksMat = trackDisp(new THREE.MeshLambertMaterial({ color: 0x1a2439 }));
    const cityBlocksMesh = new THREE.InstancedMesh(blockGeo, cityBlocksMat, CITY_BLOCK_COUNT);
    cityBlocksMesh.frustumCulled = false;
    cityGroup.add(cityBlocksMesh);

    const roofBevelGeo = trackDisp(new THREE.BoxGeometry(0.86, 0.22, 0.86));
    const cityRoofsMat = trackDisp(new THREE.MeshLambertMaterial({ color: 0x273552 }));
    const cityRoofsMesh = new THREE.InstancedMesh(roofBevelGeo, cityRoofsMat, CITY_BLOCK_COUNT);
    cityRoofsMesh.frustumCulled = false;
    cityGroup.add(cityRoofsMesh);

    const winGeo = trackDisp(new THREE.BoxGeometry(1.02, 0.14, 0.72));
    const cityWindowsMat = trackDisp(
      new THREE.MeshBasicMaterial({ color: 0xfde68a, transparent: true, opacity: 0.72 })
    );
    const cityWindowsMesh = new THREE.InstancedMesh(winGeo, cityWindowsMat, CITY_WINDOW_COUNT);
    cityWindowsMesh.frustumCulled = false;
    cityGroup.add(cityWindowsMesh);

    const parkGeo = trackDisp(new THREE.BoxGeometry(6.8, 0.12, 8.2));
    const cityParksMat = trackDisp(new THREE.MeshLambertMaterial({ color: 0x103b36 }));
    const cityParksMesh = new THREE.InstancedMesh(parkGeo, cityParksMat, CITY_PARK_COUNT);
    cityParksMesh.frustumCulled = false;
    cityGroup.add(cityParksMesh);

    const parkTreeGeo = trackDisp(new THREE.IcosahedronGeometry(0.82, 1));
    const cityTreesMat = trackDisp(new THREE.MeshLambertMaterial({ color: 0x14554d }));
    const cityTreesMesh = new THREE.InstancedMesh(parkTreeGeo, cityTreesMat, CITY_PARK_COUNT * 2);
    cityTreesMesh.frustumCulled = false;
    cityGroup.add(cityTreesMesh);

    const poleGeo = trackDisp(new THREE.CylinderGeometry(0.08, 0.09, 3.8, 6));
    const poleMat = trackDisp(new THREE.MeshLambertMaterial({ color: 0x475569 }));
    const trafficPoleMesh = new THREE.InstancedMesh(poleGeo, poleMat, TRAFFIC_LIGHT_COUNT);
    trafficPoleMesh.frustumCulled = false;
    cityGroup.add(trafficPoleMesh);

    const tGlowGeo = trackDisp(new THREE.SphereGeometry(0.22, 8, 6));
    const trafficGlowMat = trackDisp(new THREE.MeshBasicMaterial({ color: 0x34d399 }));
    const trafficGlowMesh = new THREE.InstancedMesh(tGlowGeo, trafficGlowMat, TRAFFIC_LIGHT_COUNT);
    trafficGlowMesh.frustumCulled = false;
    cityGroup.add(trafficGlowMesh);
    scene.add(cityGroup);

    // ---------------- BIOME 2: HIGHWAY ----------------
    const highwayGroup = new THREE.Group();
    const deckGeo = trackDisp(new THREE.BoxGeometry(28, 0.75, 4.2));
    const overpassDeckMat = trackDisp(new THREE.MeshLambertMaterial({ color: 0x374357 }));
    const overpassDeckMesh = new THREE.InstancedMesh(deckGeo, overpassDeckMat, HIGHWAY_OVERPASS_COUNT);
    overpassDeckMesh.frustumCulled = false;
    highwayGroup.add(overpassDeckMesh);

    const railGeo = trackDisp(new THREE.BoxGeometry(28, 0.34, 0.24));
    const railMat = trackDisp(new THREE.MeshLambertMaterial({ color: 0xe2e8f0 }));
    const overpassRailMesh = new THREE.InstancedMesh(railGeo, railMat, HIGHWAY_OVERPASS_COUNT * 2);
    overpassRailMesh.frustumCulled = false;
    highwayGroup.add(overpassRailMesh);

    const pillarGeo = trackDisp(new THREE.BoxGeometry(0.95, 5.6, 1.1));
    const overpassPillarMesh = new THREE.InstancedMesh(pillarGeo, overpassDeckMat, HIGHWAY_OVERPASS_COUNT * 2);
    overpassPillarMesh.frustumCulled = false;
    highwayGroup.add(overpassPillarMesh);

    const gantryPoleGeo = trackDisp(new THREE.CylinderGeometry(0.14, 0.16, 5.4, 6));
    const highwaySignPoles = new THREE.InstancedMesh(gantryPoleGeo, poleMat, HIGHWAY_SIGN_COUNT * 2);
    highwaySignPoles.frustumCulled = false;
    highwayGroup.add(highwaySignPoles);

    const shieldTex = createHighwayShieldTexture();
    if (shieldTex) trackDisp(shieldTex);
    const signBoardGeo = trackDisp(new THREE.BoxGeometry(5.6, 2.0, 0.2));
    const signBoardMat = trackDisp(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        map: shieldTex ?? undefined,
      })
    );
    const highwaySignBoards = new THREE.InstancedMesh(signBoardGeo, signBoardMat, HIGHWAY_SIGN_COUNT);
    highwaySignBoards.frustumCulled = false;
    highwayGroup.add(highwaySignBoards);

    const trunkGeo = trackDisp(new THREE.CylinderGeometry(0.16, 0.24, 1.3, 6));
    const trunkMat = trackDisp(new THREE.MeshLambertMaterial({ color: 0x4a3525 }));
    const highwayTreesTrunk = new THREE.InstancedMesh(trunkGeo, trunkMat, HIGHWAY_TREE_COUNT);
    highwayTreesTrunk.frustumCulled = false;
    highwayGroup.add(highwayTreesTrunk);

    const pineCrownGeo = trackDisp(new THREE.ConeGeometry(1.15, 3.1, 7));
    const highwayTreesCrownMat = trackDisp(new THREE.MeshLambertMaterial({ color: 0x14554d }));
    const highwayTreesCrown = new THREE.InstancedMesh(pineCrownGeo, highwayTreesCrownMat, HIGHWAY_TREE_COUNT);
    highwayTreesCrown.frustumCulled = false;
    highwayGroup.add(highwayTreesCrown);
    scene.add(highwayGroup);

    // ---------------- BIOME 3: COUNTRYSIDE ----------------
    const countryGroup = new THREE.Group();
    const hillGeo = trackDisp(new THREE.CylinderGeometry(4.2, 7.6, 2.2, 7));
    const countryHillsMat = trackDisp(new THREE.MeshLambertMaterial({ color: 0x112a2b }));
    const countryHillsMesh = new THREE.InstancedMesh(hillGeo, countryHillsMat, COUNTRY_HILL_COUNT);
    countryHillsMesh.frustumCulled = false;
    countryGroup.add(countryHillsMesh);

    const hillCapGeo = trackDisp(new THREE.CylinderGeometry(2.4, 4.4, 1.2, 7));
    const countryHillCapsMat = trackDisp(new THREE.MeshLambertMaterial({ color: 0x163b38 }));
    const countryHillCapsMesh = new THREE.InstancedMesh(hillCapGeo, countryHillCapsMat, COUNTRY_HILL_COUNT);
    countryHillCapsMesh.frustumCulled = false;
    countryGroup.add(countryHillCapsMesh);

    const countryTreesTrunk = new THREE.InstancedMesh(trunkGeo, trunkMat, COUNTRY_TREE_COUNT);
    countryTreesTrunk.frustumCulled = false;
    countryGroup.add(countryTreesTrunk);

    const appleTreeCrownGeo = trackDisp(new THREE.IcosahedronGeometry(1.18, 1));
    const countryTreesCrownMat = trackDisp(new THREE.MeshLambertMaterial({ color: 0x14554d }));
    const countryTreesCrown = new THREE.InstancedMesh(
      appleTreeCrownGeo,
      countryTreesCrownMat,
      COUNTRY_TREE_COUNT
    );
    countryTreesCrown.frustumCulled = false;
    countryGroup.add(countryTreesCrown);

    const fenceGeo = trackDisp(new THREE.BoxGeometry(0.14, 0.72, 2.4));
    const countryFenceMat = trackDisp(new THREE.MeshLambertMaterial({ color: 0x5c4b3c }));
    const countryFenceMesh = new THREE.InstancedMesh(fenceGeo, countryFenceMat, COUNTRY_FENCE_COUNT);
    countryFenceMesh.frustumCulled = false;
    countryGroup.add(countryFenceMesh);

    const barnBodyGeo = trackDisp(new THREE.BoxGeometry(2.6, 1.8, 3.2));
    const countryBarnBodyMat = trackDisp(new THREE.MeshLambertMaterial({ color: 0x6b2f35 }));
    const countryBarnBodyMesh = new THREE.InstancedMesh(
      barnBodyGeo,
      countryBarnBodyMat,
      COUNTRY_COTTAGE_COUNT
    );
    countryBarnBodyMesh.frustumCulled = false;
    countryGroup.add(countryBarnBodyMesh);

    const barnRoofGeo = trackDisp(new THREE.ConeGeometry(2.2, 1.2, 4));
    barnRoofGeo.rotateY(Math.PI * 0.25);
    const barnRoofMat = trackDisp(new THREE.MeshLambertMaterial({ color: 0x334155 }));
    const countryBarnRoofMesh = new THREE.InstancedMesh(
      barnRoofGeo,
      barnRoofMat,
      COUNTRY_COTTAGE_COUNT
    );
    countryBarnRoofMesh.frustumCulled = false;
    countryGroup.add(countryBarnRoofMesh);

    const river = createRibbonGeometry(ROAD_SEGMENTS);
    trackDisp(river.geo);
    const riverMat = trackDisp(
      new THREE.MeshBasicMaterial({ color: 0x0b223d, transparent: true, opacity: 0.92 })
    );
    const riverMesh = new THREE.Mesh(river.geo, riverMat);
    countryGroup.add(riverMesh);
    scene.add(countryGroup);

    this.threeState = {
      canvas,
      renderer,
      scene,
      fog,
      camera,
      sunLight,
      hemiLight,
      groundMesh,
      groundMat,
      roadGeo: road.geo,
      roadPosArr: road.pos,
      roadMat,
      shoulderGeo: shoulder.geo,
      shoulderPosArr: shoulder.pos,
      shoulderMat,
      routeGeo: route.geo,
      routePosArr: route.pos,
      routeMat,
      routeCoreGeo: routeCore.geo,
      routeCorePosArr: routeCore.pos,
      routeCoreMat,
      laneDashMesh,
      laneDashMat,
      chevronMesh,
      chevronMat,
      carGroup,
      carHeadlightLeft,
      carHeadlightRight,
      carHeadlightBeamMat,
      carTaillightMat,
      carHaloMesh,
      carHaloMat,
      cityGroup,
      cityBlocksMesh,
      cityBlocksMat,
      cityRoofsMesh,
      cityRoofsMat,
      cityWindowsMesh,
      cityWindowsMat,
      cityParksMesh,
      cityParksMat,
      cityTreesMesh,
      cityTreesMat,
      trafficPoleMesh,
      trafficGlowMesh,
      trafficGlowMat,
      highwayGroup,
      overpassDeckMesh,
      overpassDeckMat,
      overpassRailMesh,
      overpassPillarMesh,
      highwaySignPoles,
      highwaySignBoards,
      highwayTreesTrunk,
      highwayTreesCrown,
      highwayTreesCrownMat,
      countryGroup,
      countryHillsMesh,
      countryHillsMat,
      countryHillCapsMesh,
      countryHillCapsMat,
      countryTreesTrunk,
      countryTreesCrown,
      countryTreesCrownMat,
      countryFenceMesh,
      countryFenceMat,
      countryBarnBodyMesh,
      countryBarnBodyMat,
      countryBarnRoofMesh,
      riverGeo: river.geo,
      riverPosArr: river.pos,
      riverMat,
      disposables,
    };
    this.threeActive = true;
  }

  private syncEnvironmentAndMilestones(
    track: StyleTrackMetadata | null,
    lyrics: Lyrics | null,
    bpm: number,
    palette: LyricPalette,
    scenePref: MapScenePreference,
    timePref: MapTimePreference
  ): void {
    const trackKey = track ? `${track.id}:${track.title}:${track.artist}` : '';
    const palL = Math.round((palette.oklchL ?? 0.45) * 20);
    const palH = Math.round((palette.oklchH ?? 220) / 15);
    const needsRecompute =
      this.cachedTrackKey !== trackKey ||
      this.cachedLyricsRef !== lyrics ||
      this.cachedScenePref !== scenePref ||
      this.cachedTimePref !== timePref ||
      this.cachedPaletteL !== palL ||
      this.cachedPaletteH !== palH;

    if (!needsRecompute) return;

    const prevLyrics = this.cachedLyricsRef;
    this.cachedTrackKey = trackKey;
    this.cachedLyricsRef = lyrics;
    this.cachedScenePref = scenePref;
    this.cachedTimePref = timePref;
    this.cachedPaletteL = palL;
    this.cachedPaletteH = palH;

    this.env = resolveMapEnvironment(track, lyrics, bpm, palette, scenePref, timePref);

    if (prevLyrics !== lyrics || this.milestones.length === 0) {
      this.buildMilestones(lyrics, this.env.biome);
    }
  }

  private buildMilestones(lyrics: Lyrics | null, biome: MapBiomeKind): void {
    const built: MapRoadMilestone[] = [];
    const ambientExits = BIOME_AMBIENT_EXITS[biome];

    if (lyrics && lyrics.lines.length > 0) {
      // Detect repeated chorus lines via simple normalized frequency map (runs ONLY on lyrics load)
      const freq = new Map<string, number>();
      for (let i = 0; i < lyrics.lines.length; i++) {
        const key = lyrics.lines[i].text.trim().toLowerCase();
        if (key.length >= 6) {
          freq.set(key, (freq.get(key) ?? 0) + 1);
        }
      }

      let lastTrigger = -10;
      let exitCounter = 41;
      for (let i = 0; i < lyrics.lines.length; i++) {
        const line = lyrics.lines[i];
        if (line.startSeconds - lastTrigger < 5.2) continue;

        const norm = line.text.trim().toLowerCase();
        const isChorus = (freq.get(norm) ?? 0) >= 2 && i > 1;
        let matched: SemanticMilestoneRule | null = null;
        for (let r = 0; r < SEMANTIC_MILESTONE_RULES.length; r++) {
          if (SEMANTIC_MILESTONE_RULES[r].re.test(line.text)) {
            matched = SEMANTIC_MILESTONE_RULES[r];
            break;
          }
        }

        if (isChorus) {
          exitCounter += 2;
          built.push({
            lineIndex: i,
            triggerSec: line.startSeconds,
            label: `Exit ${exitCounter} · Chorus`,
            sublabel: ambientExits[i % ambientExits.length],
            badgeColor: '#0A84FF',
            iconGlyph: '↱',
            isExitBubble: true,
            sideSign: i % 2 === 0 ? 1 : -1,
          });
          lastTrigger = line.startSeconds;
        } else if (matched) {
          built.push({
            lineIndex: i,
            triggerSec: line.startSeconds,
            label: `${matched.iconGlyph} ${matched.label}`,
            sublabel: matched.sublabel,
            badgeColor: matched.badgeColor,
            iconGlyph: matched.iconGlyph,
            isExitBubble: matched.isExitBubble,
            sideSign: i % 2 === 0 ? -1 : 1,
          });
          lastTrigger = line.startSeconds;
        } else if (i % 4 === 0) {
          exitCounter += 3;
          built.push({
            lineIndex: i,
            triggerSec: line.startSeconds,
            label: `Exit ${exitCounter} · ${ambientExits[i % ambientExits.length]}`,
            sublabel: '0.2 mi',
            badgeColor: '#10B981',
            iconGlyph: '●',
            isExitBubble: true,
            sideSign: i % 2 === 0 ? 1 : -1,
          });
          lastTrigger = line.startSeconds;
        }
      }
    }

    // Ensure at least a few atmospheric milestones exist even for sparse/instrumental tracks
    if (built.length === 0) {
      for (let k = 0; k < 4; k++) {
        built.push({
          lineIndex: -1,
          triggerSec: k * 9,
          label: `Exit ${43 + k * 4} · ${ambientExits[k % ambientExits.length]}`,
          sublabel: 'Live Route',
          badgeColor: k % 2 === 0 ? '#0A84FF' : '#10B981',
          iconGlyph: k % 2 === 0 ? '↱' : '✦',
          isExitBubble: k % 2 === 0,
          sideSign: k % 2 === 0 ? 1 : -1,
        });
      }
    }

    this.milestones = built;
  }

  private applyPaletteToThree(st: ThreeMapsState, biome: MapBiomeKind, timeOfDay: MapTimeOfDay): void {
    if (this.appliedBiome === biome && this.appliedTimeOfDay === timeOfDay) return;
    this.appliedBiome = biome;
    this.appliedTimeOfDay = timeOfDay;

    const p = TIME_PALETTES[timeOfDay];
    st.fog.color.setHex(p.fogHex);
    st.fog.density = biome === 'cityscape' ? 0.0135 : biome === 'highway' ? 0.0145 : 0.013;
    if (st.scene.background instanceof THREE.Color) {
      st.scene.background.setHex(p.fogHex);
    }

    st.sunLight.color.setHex(p.sunLightHex);
    st.sunLight.intensity = p.sunIntensity;
    if (timeOfDay === 'sunset') {
      st.sunLight.position.set(-28, 9, -22);
    } else if (timeOfDay === 'day') {
      st.sunLight.position.set(16, 34, 14);
    } else {
      st.sunLight.position.set(10, 24, 8);
    }

    st.hemiLight.color.setHex(p.hemiSkyHex);
    st.hemiLight.groundColor.setHex(p.hemiGroundHex);
    st.hemiLight.intensity = p.hemiIntensity;

    st.groundMat.color.setHex(p.groundHex);
    st.roadMat.color.setHex(p.roadHex);
    st.shoulderMat.color.setHex(p.shoulderHex);
    st.laneDashMat.color.setHex(p.laneDashHex);
    st.routeMat.color.setHex(p.routePrimaryHex);
    st.routeCoreMat.color.setHex(p.routeGlowHex);

    st.cityBlocksMat.color.setHex(p.buildingHex);
    st.cityRoofsMat.color.setHex(p.buildingAltHex);
    st.cityWindowsMat.opacity = p.windowGlow * 0.78;
    st.cityWindowsMesh.visible = p.windowGlow > 0.05;
    st.cityParksMat.color.setHex(p.parkHex);
    st.cityTreesMat.color.setHex(p.treeFoliageHex);

    st.overpassDeckMat.color.setHex(p.overpassHex);
    st.highwayTreesCrownMat.color.setHex(p.treeFoliageHex);

    st.countryHillsMat.color.setHex(p.hillHex);
    st.countryHillCapsMat.color.setHex(p.hillTopHex);
    st.countryTreesCrownMat.color.setHex(p.treeFoliageHex);
    st.countryFenceMat.color.setHex(p.fenceHex);
    st.countryBarnBodyMat.color.setHex(p.barnHex);
    st.riverMat.color.setHex(p.waterHex);

    st.carHeadlightBeamMat.opacity = p.headlightIntensity * 0.28;
    st.carHeadlightLeft.visible = p.headlightIntensity > 0.05;
    st.carHeadlightRight.visible = p.headlightIntensity > 0.05;

    st.cityGroup.visible = biome === 'cityscape';
    st.highwayGroup.visible = biome === 'highway';
    st.countryGroup.visible = biome === 'countryside';
  }

  private updateThreeScene(
    st: ThreeMapsState,
    width: number,
    height: number,
    focalCenterX: number,
    timeSeconds: number,
    audio: AudioFrameMetrics,
    reduceMotion: boolean
  ): void {
    const biome = this.env.biome;
    const timeOfDay = this.env.timeOfDay;
    this.applyPaletteToThree(st, biome, timeOfDay);

    if (this.width !== width || this.height !== height) {
      this.width = width;
      this.height = height;
      st.renderer.setSize(width, height, false);
      st.camera.aspect = width / Math.max(1, height);
      st.camera.updateProjectionMatrix();
    }

    const travel = this.travelDistance;
    const roadHalfW = getRoadHalfWidth(biome);
    const carZ = 0.0;
    const carWorldZ = travel - carZ;
    const targetCarX = sampleRoadX(carWorldZ, biome);
    const roadSlope = sampleRoadSlope(carWorldZ, biome);

    // Smooth car tracking & curve banking
    this.smoothedCarX += (targetCarX - this.smoothedCarX) * 0.22;
    const targetYaw = -Math.atan(roadSlope) * 0.85;
    const targetBank = Math.max(-0.14, Math.min(0.14, roadSlope * 0.38));
    this.smoothedCarYaw += (targetYaw - this.smoothedCarYaw) * 0.18;
    this.smoothedCarBank += (targetBank - this.smoothedCarBank) * 0.18;

    const bounceY = reduceMotion
      ? 0
      : Math.abs(Math.sin(timeSeconds * 8.5)) * 0.03 + this.beatPulse * 0.06;
    st.carGroup.position.set(this.smoothedCarX, 0.06 + bounceY, carZ);
    st.carGroup.rotation.set(0, this.smoothedCarYaw, this.smoothedCarBank);

    // Beat-reactive taillight & GPS halo pulse
    const p = TIME_PALETTES[timeOfDay];
    const haloScale = 1.0 + this.beatPulse * 0.16 + (audio.bassEnergy ?? 0) * 0.1;
    st.carHaloMesh.scale.set(haloScale, haloScale, 1);
    st.carHaloMat.opacity = 0.34 + this.beatPulse * 0.25;
    this.tmpColor.setHex(0xff3b30);
    if (p.taillightIntensity > 0.5) {
      this.tmpColor.offsetHSL(0, 0, this.beatPulse * 0.12);
    }
    st.carTaillightMat.color.copy(this.tmpColor);

    // Camera positioning per biome + Split-View focal centering via setViewOffset
    const camSpec = BIOME_CAMERA_SPECS[biome];
    const camFov = camSpec.fov + (reduceMotion ? 0 : this.beatPulse * 1.6);
    if (Math.abs(st.camera.fov - camFov) > 0.05) {
      st.camera.fov = camFov;
      st.camera.updateProjectionMatrix();
    }
    if (Math.abs(focalCenterX - width * 0.5) > 1.0) {
      st.camera.setViewOffset(width, height, width * 0.5 - focalCenterX, 0, width, height);
    } else {
      st.camera.clearViewOffset();
    }

    const lookWorldZ = travel - camSpec.lookAheadZ;
    const lookX = sampleRoadX(lookWorldZ, biome) * 0.55 + this.smoothedCarX * 0.45;
    st.camera.position.set(
      this.smoothedCarX * 0.78,
      camSpec.height,
      carZ + camSpec.distance
    );
    st.camera.lookAt(lookX, camSpec.lookY, camSpec.lookAheadZ);
    st.camera.updateMatrixWorld();

    // Update road, shoulder, and glowing navigation ribbon buffers in-place (ZERO allocations)
    fillRibbonPositions(st.shoulderPosArr, ROAD_SEGMENTS, travel, biome, roadHalfW + 0.85, 0.01, 0);
    (st.shoulderGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    fillRibbonPositions(st.roadPosArr, ROAD_SEGMENTS, travel, biome, roadHalfW, 0.03, 0);
    (st.roadGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    const routeWidth = biome === 'highway' ? 1.18 : 0.96;
    fillRibbonPositions(st.routePosArr, ROAD_SEGMENTS, travel, biome, routeWidth, 0.052, 0);
    (st.routeGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    fillRibbonPositions(st.routeCorePosArr, ROAD_SEGMENTS, travel, biome, routeWidth * 0.44, 0.06, 0);
    (st.routeCoreGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    // Lane dashes
    const dashStep = ROAD_SPAN / (LANE_DASH_COUNT * 0.5);
    const dashOffset = travel % dashStep;
    const laneOffset = biome === 'highway' ? 2.15 : biome === 'cityscape' ? 1.65 : 0;
    let dashIdx = 0;
    for (let i = 0; i < LANE_DASH_COUNT / 2; i++) {
      const zLocal = ROAD_Z_NEAR - (i * dashStep - dashOffset);
      const zWorld = travel - zLocal;
      const rx = sampleRoadX(zWorld, biome);
      const slope = sampleRoadSlope(zWorld, biome);
      const yaw = -Math.atan(slope);

      if (biome === 'countryside') {
        this.dummy.position.set(rx - 0.12, 0.048, zLocal);
        this.dummy.rotation.set(0, yaw, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        st.laneDashMesh.setMatrixAt(dashIdx++, this.dummy.matrix);

        this.dummy.position.set(rx + 0.12, 0.048, zLocal);
        this.dummy.updateMatrix();
        st.laneDashMesh.setMatrixAt(dashIdx++, this.dummy.matrix);
      } else {
        this.dummy.position.set(rx - laneOffset, 0.048, zLocal);
        this.dummy.rotation.set(0, yaw, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        st.laneDashMesh.setMatrixAt(dashIdx++, this.dummy.matrix);

        this.dummy.position.set(rx + laneOffset, 0.048, zLocal);
        this.dummy.updateMatrix();
        st.laneDashMesh.setMatrixAt(dashIdx++, this.dummy.matrix);
      }
    }
    st.laneDashMesh.instanceMatrix.needsUpdate = true;

    // Animated route lane chevrons moving ahead of car
    const chevStep = 4.8;
    const chevPhase = (travel * 1.45) % chevStep;
    for (let i = 0; i < CHEVRON_COUNT; i++) {
      const zLocal = -2.2 - i * chevStep - chevPhase;
      const zWorld = travel - zLocal;
      const rx = sampleRoadX(zWorld, biome);
      const yaw = -Math.atan(sampleRoadSlope(zWorld, biome));
      const pulseScale = 0.88 + this.beatPulse * 0.25;
      this.dummy.position.set(rx, 0.072, zLocal);
      this.dummy.rotation.set(0, yaw, 0);
      this.dummy.scale.set(pulseScale, 1, pulseScale);
      this.dummy.updateMatrix();
      st.chevronMesh.setMatrixAt(i, this.dummy.matrix);
    }
    st.chevronMesh.instanceMatrix.needsUpdate = true;

    // Update active biome scenery pool
    if (biome === 'cityscape') {
      this.updateCityscapeInstances(st, travel, timeSeconds, roadHalfW);
    } else if (biome === 'highway') {
      this.updateHighwayInstances(st, travel, roadHalfW);
    } else {
      this.updateCountrysideInstances(st, travel, roadHalfW);
    }

    st.renderer.render(st.scene, st.camera);
  }

  private updateCityscapeInstances(
    st: ThreeMapsState,
    travel: number,
    timeSeconds: number,
    roadHalfW: number
  ): void {
    const slotStep = 6.2;
    const baseSlot = Math.floor(travel / slotStep);
    let winIdx = 0;
    let parkIdx = 0;
    let treeIdx = 0;

    for (let i = 0; i < CITY_BLOCK_COUNT; i++) {
      const row = Math.floor(i / 4);
      const col = i % 4; // 0: near-left, 1: near-right, 2: far-left, 3: far-right
      const worldSlot = baseSlot + row - 2;
      const zWorld = worldSlot * slotStep;
      const zLocal = travel - zWorld;
      const rx = sampleRoadX(zWorld, 'cityscape');
      const side = col % 2 === 0 ? -1 : 1;
      const tier = col >= 2 ? 1 : 0;
      const h = hashUint(worldSlot * 73856093 + col * 19349663);

      const isPark = tier === 0 && h % 7 === 0 && parkIdx < CITY_PARK_COUNT;
      const distOut = roadHalfW + 4.4 + tier * 8.2 + ((h % 100) / 100) * 1.4;
      const bx = rx + side * distOut;

      if (isPark) {
        // Hide building slot under ground, place park + trees instead
        this.dummy.position.set(bx, -20, zLocal);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(0.01, 0.01, 0.01);
        this.dummy.updateMatrix();
        st.cityBlocksMesh.setMatrixAt(i, this.dummy.matrix);
        st.cityRoofsMesh.setMatrixAt(i, this.dummy.matrix);

        this.dummy.position.set(bx, 0.05, zLocal);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        st.cityParksMesh.setMatrixAt(parkIdx, this.dummy.matrix);
        parkIdx++;

        for (let t = 0; t < 2; t++) {
          if (treeIdx < CITY_PARK_COUNT * 2) {
            this.dummy.position.set(bx + (t === 0 ? -1.4 : 1.5), 0.95, zLocal + (t === 0 ? -1.2 : 1.4));
            const ts = 0.85 + ((h >> (t * 4)) & 3) * 0.16;
            this.dummy.scale.set(ts, ts * 1.15, ts);
            this.dummy.updateMatrix();
            st.cityTreesMesh.setMatrixAt(treeIdx++, this.dummy.matrix);
          }
        }
      } else {
        const bw = 3.2 + ((h & 15) / 15) * 2.6;
        const bd = 3.6 + (((h >> 4) & 15) / 15) * 2.1;
        const bh = 3.4 + (((h >> 8) & 31) / 31) * (tier === 1 ? 15.5 : 10.5);

        this.dummy.position.set(bx, bh * 0.5, zLocal);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(bw, bh, bd);
        this.dummy.updateMatrix();
        st.cityBlocksMesh.setMatrixAt(i, this.dummy.matrix);

        // Bevel cap on roof
        this.dummy.position.set(bx, bh + 0.12, zLocal);
        this.dummy.scale.set(bw, 1.0, bd);
        this.dummy.updateMatrix();
        st.cityRoofsMesh.setMatrixAt(i, this.dummy.matrix);

        // Subtle warm lit night windows on street-facing tier
        if (tier === 0 && winIdx < CITY_WINDOW_COUNT && (h & 3) !== 0) {
          const floors = bh > 8 ? 2 : 1;
          for (let f = 0; f < floors && winIdx < CITY_WINDOW_COUNT; f++) {
            const wy = 1.8 + f * 2.6 + ((h >> 14) & 3) * 0.45;
            if (wy < bh - 0.8) {
              this.dummy.position.set(bx, wy, zLocal);
              this.dummy.scale.set(bw, 1.0, bd);
              this.dummy.updateMatrix();
              st.cityWindowsMesh.setMatrixAt(winIdx++, this.dummy.matrix);
            }
          }
        }
      }
    }

    // Park unused instances out of view
    this.dummy.position.set(0, -40, 0);
    this.dummy.scale.set(0.01, 0.01, 0.01);
    this.dummy.updateMatrix();
    for (let i = winIdx; i < CITY_WINDOW_COUNT; i++) {
      st.cityWindowsMesh.setMatrixAt(i, this.dummy.matrix);
    }
    for (let i = parkIdx; i < CITY_PARK_COUNT; i++) {
      st.cityParksMesh.setMatrixAt(i, this.dummy.matrix);
    }
    for (let i = treeIdx; i < CITY_PARK_COUNT * 2; i++) {
      st.cityTreesMesh.setMatrixAt(i, this.dummy.matrix);
    }

    // Traffic lights at regular cross-street intervals
    const tlStep = 24.0;
    const tlBase = Math.floor(travel / tlStep);
    const greenPhase = Math.floor(timeSeconds * 0.4) % 2 === 0;
    st.trafficGlowMat.color.setHex(greenPhase ? 0x34d399 : 0xfbbf24);
    for (let i = 0; i < TRAFFIC_LIGHT_COUNT; i++) {
      const slot = tlBase + Math.floor(i / 2);
      const zWorld = slot * tlStep;
      const zLocal = travel - zWorld;
      const side = i % 2 === 0 ? -1 : 1;
      const rx = sampleRoadX(zWorld, 'cityscape') + side * (roadHalfW + 0.9);
      this.dummy.position.set(rx, 1.9, zLocal);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      st.trafficPoleMesh.setMatrixAt(i, this.dummy.matrix);

      this.dummy.position.set(rx - side * 0.45, 3.65, zLocal);
      this.dummy.updateMatrix();
      st.trafficGlowMesh.setMatrixAt(i, this.dummy.matrix);
    }

    st.cityBlocksMesh.instanceMatrix.needsUpdate = true;
    st.cityRoofsMesh.instanceMatrix.needsUpdate = true;
    st.cityWindowsMesh.instanceMatrix.needsUpdate = true;
    st.cityParksMesh.instanceMatrix.needsUpdate = true;
    st.cityTreesMesh.instanceMatrix.needsUpdate = true;
    st.trafficPoleMesh.instanceMatrix.needsUpdate = true;
    st.trafficGlowMesh.instanceMatrix.needsUpdate = true;
  }

  private updateHighwayInstances(st: ThreeMapsState, travel: number, roadHalfW: number): void {
    // Elevated white-railed overpasses
    const opStep = 38.0;
    const opBase = Math.floor(travel / opStep);
    for (let i = 0; i < HIGHWAY_OVERPASS_COUNT; i++) {
      const slot = opBase + i;
      const zWorld = slot * opStep + 14;
      const zLocal = travel - zWorld;
      const rx = sampleRoadX(zWorld, 'highway');
      const yaw = -Math.atan(sampleRoadSlope(zWorld, 'highway')) * 0.5;

      this.dummy.position.set(rx, 5.4, zLocal);
      this.dummy.rotation.set(0, yaw, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      st.overpassDeckMesh.setMatrixAt(i, this.dummy.matrix);

      // Front and back white rails
      this.dummy.position.set(rx, 5.95, zLocal + 1.95);
      this.dummy.updateMatrix();
      st.overpassRailMesh.setMatrixAt(i * 2, this.dummy.matrix);

      this.dummy.position.set(rx, 5.95, zLocal - 1.95);
      this.dummy.updateMatrix();
      st.overpassRailMesh.setMatrixAt(i * 2 + 1, this.dummy.matrix);

      // Left & right support pillars
      this.dummy.position.set(rx - (roadHalfW + 2.4), 2.7, zLocal);
      this.dummy.updateMatrix();
      st.overpassPillarMesh.setMatrixAt(i * 2, this.dummy.matrix);

      this.dummy.position.set(rx + (roadHalfW + 2.4), 2.7, zLocal);
      this.dummy.updateMatrix();
      st.overpassPillarMesh.setMatrixAt(i * 2 + 1, this.dummy.matrix);
    }

    // Overhead highway gantry signs (I-280 / US-101)
    const sgStep = 28.0;
    const sgBase = Math.floor(travel / sgStep);
    for (let i = 0; i < HIGHWAY_SIGN_COUNT; i++) {
      const slot = sgBase + i;
      const zWorld = slot * sgStep + 26;
      const zLocal = travel - zWorld;
      const rx = sampleRoadX(zWorld, 'highway');
      const yaw = -Math.atan(sampleRoadSlope(zWorld, 'highway'));

      this.dummy.position.set(rx + 1.2, 5.3, zLocal);
      this.dummy.rotation.set(0, yaw, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      st.highwaySignBoards.setMatrixAt(i, this.dummy.matrix);

      this.dummy.position.set(rx - (roadHalfW + 1.2), 2.7, zLocal);
      this.dummy.updateMatrix();
      st.highwaySignPoles.setMatrixAt(i * 2, this.dummy.matrix);

      this.dummy.position.set(rx + (roadHalfW + 1.2), 2.7, zLocal);
      this.dummy.updateMatrix();
      st.highwaySignPoles.setMatrixAt(i * 2 + 1, this.dummy.matrix);
    }

    // Wooded highway shoulders
    const trStep = 4.4;
    const trBase = Math.floor(travel / trStep);
    for (let i = 0; i < HIGHWAY_TREE_COUNT; i++) {
      const slot = trBase + Math.floor(i / 2) - 2;
      const zWorld = slot * trStep;
      const zLocal = travel - zWorld;
      const side = i % 2 === 0 ? -1 : 1;
      const h = hashUint(slot * 92821 + i * 31337);
      const distOut = roadHalfW + 3.4 + ((h % 100) / 100) * 11.5;
      const tx = sampleRoadX(zWorld, 'highway') + side * distOut;
      const sc = 0.85 + ((h >> 8) & 7) * 0.14;

      this.dummy.position.set(tx, 0.65 * sc, zLocal);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(sc, sc, sc);
      this.dummy.updateMatrix();
      st.highwayTreesTrunk.setMatrixAt(i, this.dummy.matrix);

      this.dummy.position.set(tx, 2.35 * sc, zLocal);
      this.dummy.updateMatrix();
      st.highwayTreesCrown.setMatrixAt(i, this.dummy.matrix);
    }

    st.overpassDeckMesh.instanceMatrix.needsUpdate = true;
    st.overpassRailMesh.instanceMatrix.needsUpdate = true;
    st.overpassPillarMesh.instanceMatrix.needsUpdate = true;
    st.highwaySignBoards.instanceMatrix.needsUpdate = true;
    st.highwaySignPoles.instanceMatrix.needsUpdate = true;
    st.highwayTreesTrunk.instanceMatrix.needsUpdate = true;
    st.highwayTreesCrown.instanceMatrix.needsUpdate = true;
  }

  private updateCountrysideInstances(st: ThreeMapsState, travel: number, roadHalfW: number): void {
    // Winding river/coastal water bend along right embankment
    fillRibbonPositions(st.riverPosArr, ROAD_SEGMENTS, travel, 'countryside', 4.4, 0.02, 13.5, 3.6);
    (st.riverGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    // Rolling terraced low-poly hills
    const hillStep = 9.0;
    const hillBase = Math.floor(travel / hillStep);
    for (let i = 0; i < COUNTRY_HILL_COUNT; i++) {
      const slot = hillBase + Math.floor(i / 2) - 2;
      const zWorld = slot * hillStep;
      const zLocal = travel - zWorld;
      const side = i % 2 === 0 ? -1 : 1;
      const h = hashUint(slot * 48611 + (side > 0 ? 97 : 19));
      const distOut = side < 0 ? 13.5 + ((h % 100) / 100) * 14.0 : 21.5 + ((h % 100) / 100) * 14.0;
      const hx = sampleRoadX(zWorld, 'countryside') + side * distOut;
      const sx = 0.85 + ((h & 7) / 7) * 0.95;
      const sy = 0.8 + (((h >> 3) & 7) / 7) * 1.45;

      this.dummy.position.set(hx, sy * 0.9, zLocal);
      this.dummy.rotation.set(0, (h % 6) * 0.5, 0);
      this.dummy.scale.set(sx, sy, sx);
      this.dummy.updateMatrix();
      st.countryHillsMesh.setMatrixAt(i, this.dummy.matrix);

      this.dummy.position.set(hx, sy * 2.05, zLocal);
      this.dummy.scale.set(sx * 0.85, sy * 0.9, sx * 0.85);
      this.dummy.updateMatrix();
      st.countryHillCapsMesh.setMatrixAt(i, this.dummy.matrix);
    }

    // Rounded Apple Maps trees
    const trStep = 3.8;
    const trBase = Math.floor(travel / trStep);
    for (let i = 0; i < COUNTRY_TREE_COUNT; i++) {
      const slot = trBase + Math.floor(i / 2) - 2;
      const zWorld = slot * trStep;
      const zLocal = travel - zWorld;
      const side = i % 2 === 0 ? -1 : 1;
      const h = hashUint(slot * 668265 + i * 17);
      const distOut = side < 0
        ? roadHalfW + 3.0 + ((h % 100) / 100) * 8.5
        : roadHalfW + 2.8 + ((h % 100) / 100) * 4.6;
      const tx = sampleRoadX(zWorld, 'countryside') + side * distOut;
      const sc = 0.78 + ((h >> 6) & 7) * 0.13;

      this.dummy.position.set(tx, 0.55 * sc, zLocal);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(sc, sc, sc);
      this.dummy.updateMatrix();
      st.countryTreesTrunk.setMatrixAt(i, this.dummy.matrix);

      this.dummy.position.set(tx, 1.85 * sc, zLocal);
      this.dummy.scale.set(sc, sc * 1.08, sc);
      this.dummy.updateMatrix();
      st.countryTreesCrown.setMatrixAt(i, this.dummy.matrix);
    }

    // Wooden roadside fences
    const fnStep = 4.6;
    const fnBase = Math.floor(travel / fnStep);
    for (let i = 0; i < COUNTRY_FENCE_COUNT; i++) {
      const slot = fnBase + Math.floor(i / 2) - 2;
      const zWorld = slot * fnStep;
      const zLocal = travel - zWorld;
      const side = i % 2 === 0 ? -1 : 1;
      const rx = sampleRoadX(zWorld, 'countryside') + side * (roadHalfW + 1.35);
      const yaw = -Math.atan(sampleRoadSlope(zWorld, 'countryside'));

      this.dummy.position.set(rx, 0.36, zLocal);
      this.dummy.rotation.set(0, yaw, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      st.countryFenceMesh.setMatrixAt(i, this.dummy.matrix);
    }

    // Distant cozy cottages & barns
    const cnStep = 22.0;
    const cnBase = Math.floor(travel / cnStep);
    for (let i = 0; i < COUNTRY_COTTAGE_COUNT; i++) {
      const slot = cnBase + i - 1;
      const zWorld = slot * cnStep + 8;
      const zLocal = travel - zWorld;
      const h = hashUint(slot * 8191 + 13);
      const side = h % 3 === 0 ? 1 : -1;
      const distOut = side < 0 ? 11.2 + (h % 5) * 1.6 : 20.5 + (h % 4) * 1.5;
      const cx = sampleRoadX(zWorld, 'countryside') + side * distOut;

      this.dummy.position.set(cx, 0.9, zLocal);
      this.dummy.rotation.set(0, side * 0.25, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      st.countryBarnBodyMesh.setMatrixAt(i, this.dummy.matrix);

      this.dummy.position.set(cx, 2.38, zLocal);
      this.dummy.updateMatrix();
      st.countryBarnRoofMesh.setMatrixAt(i, this.dummy.matrix);
    }

    st.countryHillsMesh.instanceMatrix.needsUpdate = true;
    st.countryHillCapsMesh.instanceMatrix.needsUpdate = true;
    st.countryTreesTrunk.instanceMatrix.needsUpdate = true;
    st.countryTreesCrown.instanceMatrix.needsUpdate = true;
    st.countryFenceMesh.instanceMatrix.needsUpdate = true;
    st.countryBarnBodyMesh.instanceMatrix.needsUpdate = true;
    st.countryBarnRoofMesh.instanceMatrix.needsUpdate = true;
  }

  // -------------------------------------------------------------------------
  // Canvas2D 2.5D Perspective Software Fallback (Headless Node Safe, Zero-GC)
  // -------------------------------------------------------------------------

  private renderCanvas2DFallback(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    focalLeft: number,
    focalWidth: number,
    timeSeconds: number,
    audio: AudioFrameMetrics,
    reduceMotion: boolean
  ): void {
    const biome = this.env.biome;
    const timeOfDay = this.env.timeOfDay;
    const p = TIME_PALETTES[timeOfDay];
    const cx = focalLeft + focalWidth * 0.5;
    const horizonY =
      biome === 'cityscape' ? height * 0.36 : biome === 'highway' ? height * 0.42 : height * 0.4;
    const travel = this.travelDistance;
    const roadHalfW = getRoadHalfWidth(biome);
    const carWorldZ = travel;
    const carRoadX = sampleRoadX(carWorldZ, biome);
    const roadSlope = sampleRoadSlope(carWorldZ, biome);

    this.smoothedCarX += (carRoadX - this.smoothedCarX) * 0.25;
    const camX = this.smoothedCarX;
    const camHeight = this.env.cameraHeight;
    const focalLen = Math.min(focalWidth, height) * (biome === 'cityscape' ? 0.78 : 0.92);

    ctx.save();
    // 1. Sky / Horizon Gradient
    const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY + 12);
    skyGrad.addColorStop(0, p.skyTop);
    skyGrad.addColorStop(0.55, p.skyMid);
    skyGrad.addColorStop(1, p.skyHorizon);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, width, horizonY + 12);

    // Subtle sunset sun glow on horizon
    if (timeOfDay === 'sunset') {
      const sunGrad = ctx.createRadialGradient(cx, horizonY, 8, cx, horizonY, focalWidth * 0.42);
      sunGrad.addColorStop(0, 'rgba(254, 215, 170, 0.75)');
      sunGrad.addColorStop(0.45, 'rgba(251, 146, 60, 0.28)');
      sunGrad.addColorStop(1, 'rgba(251, 146, 60, 0)');
      ctx.fillStyle = sunGrad;
      ctx.fillRect(0, 0, width, horizonY + 60);
    }

    // 2. Ground Plane below horizon
    ctx.fillStyle = p.groundCss;
    ctx.fillRect(0, horizonY, width, height - horizonY);

    // 3. Precompute perspective road points into pre-allocated Float32Arrays (ZERO allocations)
    for (let i = 0; i <= ROAD_SEGMENTS; i++) {
      const u = i / ROAD_SEGMENTS;
      // Depth from far (78) to near (2.6)
      const depth = 2.6 + (1 - u) * 76.0;
      const zWorld = travel + depth - 4.0;
      const rx = sampleRoadX(zWorld, biome) - camX;
      const sc = focalLen / depth;
      const sy = horizonY + (camHeight * sc) * 0.64;
      this.swCenterX[i] = cx + rx * sc;
      this.swLeftX[i] = cx + (rx - roadHalfW) * sc;
      this.swRightX[i] = cx + (rx + roadHalfW) * sc;
      this.swScreenY[i] = sy;
      this.swScale[i] = sc;
    }

    // 4. Biome Scenery (far to near)
    if (biome === 'countryside') {
      // River bend on right
      ctx.fillStyle = p.waterCss;
      ctx.beginPath();
      for (let i = 0; i <= ROAD_SEGMENTS; i++) {
        const sc = this.swScale[i];
        const rx = this.swRightX[i] + sc * (3.2 + Math.sin(i * 0.25 + travel * 0.05) * 1.1);
        if (i === 0) ctx.moveTo(rx, this.swScreenY[i]);
        else ctx.lineTo(rx, this.swScreenY[i]);
      }
      for (let i = ROAD_SEGMENTS; i >= 0; i--) {
        const sc = this.swScale[i];
        const rx = this.swRightX[i] + sc * (8.8 + Math.sin(i * 0.25 + travel * 0.05) * 1.1);
        ctx.lineTo(rx, this.swScreenY[i]);
      }
      ctx.closePath();
      ctx.fill();

      // Rolling low-poly hills & Apple Maps trees
      for (let i = 2; i < ROAD_SEGMENTS; i += 4) {
        const sc = this.swScale[i];
        const sy = this.swScreenY[i];
        const hW = sc * 7.5;
        const hH = sc * 2.8;
        ctx.fillStyle = p.hillCss;
        ctx.beginPath();
        ctx.ellipse(this.swLeftX[i] - sc * 8.5, sy, hW, hH, 0, Math.PI, Math.PI * 2);
        ctx.fill();

        // Trees
        const trR = Math.max(2, sc * 0.95);
        ctx.fillStyle = p.treeFoliageCss;
        ctx.beginPath();
        ctx.arc(this.swLeftX[i] - sc * 2.8, sy - trR * 1.2, trR, 0, Math.PI * 2);
        ctx.arc(this.swRightX[i] + sc * 2.2, sy - trR * 1.1, trR * 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (biome === 'cityscape') {
      // Low-poly extruded blocks + emerald parks on left and right
      const slotStep = 6.2;
      const baseSlot = Math.floor(travel / slotStep);
      for (let s = 13; s >= 1; s--) {
        const worldSlot = baseSlot + s;
        const depth = Math.max(3.2, worldSlot * slotStep - travel + 3.8);
        const sc = focalLen / depth;
        const sy = horizonY + camHeight * sc * 0.64;
        if (sy > height + 40) continue;
        const roadC = cx + (sampleRoadX(worldSlot * slotStep, biome) - camX) * sc;
        for (let side = -1; side <= 1; side += 2) {
          const h = hashUint(worldSlot * 73856093 + (side > 0 ? 19 : 7));
          const isPark = h % 6 === 0;
          const bx = roadC + side * (roadHalfW + 3.2) * sc;
          const bw = (2.8 + (h & 7) * 0.35) * sc;
          if (isPark) {
            ctx.fillStyle = p.parkCss;
            ctx.fillRect(bx - bw * 0.6, sy - sc * 0.3, bw * 1.2, sc * 1.2);
            ctx.fillStyle = p.treeFoliageCss;
            ctx.beginPath();
            ctx.arc(bx, sy - sc * 0.9, Math.max(2, sc * 0.8), 0, Math.PI * 2);
            ctx.fill();
          } else {
            const bh = (3.8 + ((h >> 4) & 15) * 0.68) * sc;
            ctx.fillStyle = p.buildingCss;
            ctx.fillRect(bx - bw * 0.5, sy - bh, bw, bh);
            ctx.fillStyle = p.buildingRoofCss;
            ctx.fillRect(bx - bw * 0.44, sy - bh - sc * 0.18, bw * 0.88, sc * 0.22);
            if (p.windowGlow > 0.05 && bh > 10) {
              ctx.fillStyle = 'rgba(253, 230, 138, 0.52)';
              ctx.fillRect(bx - bw * 0.35, sy - bh * 0.72, bw * 0.7, Math.max(1.5, sc * 0.14));
              ctx.fillRect(bx - bw * 0.35, sy - bh * 0.42, bw * 0.7, Math.max(1.5, sc * 0.14));
            }
          }
        }
      }
    } else {
      // Highway: wooded shoulders + elevated white-railed overpasses
      for (let i = 4; i < ROAD_SEGMENTS; i += 5) {
        const sc = this.swScale[i];
        const sy = this.swScreenY[i];
        ctx.fillStyle = p.treeFoliageCss;
        const r = Math.max(2.5, sc * 1.05);
        ctx.beginPath();
        ctx.moveTo(this.swLeftX[i] - sc * 3.2, sy - r * 2.2);
        ctx.lineTo(this.swLeftX[i] - sc * 4.2, sy);
        ctx.lineTo(this.swLeftX[i] - sc * 2.2, sy);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(this.swRightX[i] + sc * 3.2, sy - r * 2.2);
        ctx.lineTo(this.swRightX[i] + sc * 2.2, sy);
        ctx.lineTo(this.swRightX[i] + sc * 4.2, sy);
        ctx.closePath();
        ctx.fill();
      }
    }

    // 5. Road Asphalt Polygon
    ctx.fillStyle = p.roadCss;
    ctx.beginPath();
    for (let i = 0; i <= ROAD_SEGMENTS; i++) {
      if (i === 0) ctx.moveTo(this.swLeftX[i], this.swScreenY[i]);
      else ctx.lineTo(this.swLeftX[i], this.swScreenY[i]);
    }
    for (let i = ROAD_SEGMENTS; i >= 0; i--) {
      ctx.lineTo(this.swRightX[i], this.swScreenY[i]);
    }
    ctx.closePath();
    ctx.fill();

    // 6. Glowing Cyan / Apple-Blue Navigation Route Ribbon
    ctx.fillStyle = p.routePrimaryCss;
    ctx.beginPath();
    for (let i = 0; i <= ROAD_SEGMENTS; i++) {
      const rw = this.swScale[i] * 0.92;
      if (i === 0) ctx.moveTo(this.swCenterX[i] - rw, this.swScreenY[i]);
      else ctx.lineTo(this.swCenterX[i] - rw, this.swScreenY[i]);
    }
    for (let i = ROAD_SEGMENTS; i >= 0; i--) {
      const rw = this.swScale[i] * 0.92;
      ctx.lineTo(this.swCenterX[i] + rw, this.swScreenY[i]);
    }
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = p.routeGlowCss;
    ctx.beginPath();
    for (let i = 0; i <= ROAD_SEGMENTS; i++) {
      const rw = this.swScale[i] * 0.36;
      if (i === 0) ctx.moveTo(this.swCenterX[i] - rw, this.swScreenY[i]);
      else ctx.lineTo(this.swCenterX[i] - rw, this.swScreenY[i]);
    }
    for (let i = ROAD_SEGMENTS; i >= 0; i--) {
      const rw = this.swScale[i] * 0.36;
      ctx.lineTo(this.swCenterX[i] + rw, this.swScreenY[i]);
    }
    ctx.closePath();
    ctx.fill();

    // Dashed lane markings
    ctx.strokeStyle = p.laneDashCss;
    ctx.lineWidth = 2;
    const dashShift = Math.floor((travel * 0.7) % 4);
    for (let i = 2 + dashShift; i < ROAD_SEGMENTS - 2; i += 4) {
      const sc = this.swScale[i];
      const off = sc * (roadHalfW * 0.52);
      ctx.beginPath();
      ctx.moveTo(this.swCenterX[i] - off, this.swScreenY[i]);
      ctx.lineTo(this.swCenterX[i + 2] - this.swScale[i + 2] * (roadHalfW * 0.52), this.swScreenY[i + 2]);
      ctx.moveTo(this.swCenterX[i] + off, this.swScreenY[i]);
      ctx.lineTo(this.swCenterX[i + 2] + this.swScale[i + 2] * (roadHalfW * 0.52), this.swScreenY[i + 2]);
      ctx.stroke();
    }

    // Highway overpass bridge crossing in mid-distance
    if (biome === 'highway') {
      const opIdx = Math.floor(ROAD_SEGMENTS * 0.42);
      const sc = this.swScale[opIdx];
      const sy = this.swScreenY[opIdx];
      const bridgeY = sy - sc * 4.4;
      const bridgeH = Math.max(6, sc * 0.85);
      ctx.fillStyle = '#475569';
      ctx.fillRect(this.swLeftX[opIdx] - sc * 5, bridgeY, (this.swRightX[opIdx] - this.swLeftX[opIdx]) + sc * 10, bridgeH);
      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(this.swLeftX[opIdx] - sc * 5, bridgeY - 2, (this.swRightX[opIdx] - this.swLeftX[opIdx]) + sc * 10, 2.5);
    }

    // 7. Low-Poly White CarPlay Car riding the center ribbon
    const carY = height * (biome === 'cityscape' ? 0.78 : 0.79);
    const carBob = reduceMotion ? 0 : Math.sin(timeSeconds * 7.5) * 1.4 - this.beatPulse * 2.5;
    const carBank = Math.max(-0.08, Math.min(0.08, roadSlope * 0.25));
    const carW = Math.max(36, Math.min(58, focalWidth * 0.056));
    const carH = carW * 0.58;

    ctx.save();
    ctx.translate(cx, carY + carBob);
    ctx.rotate(carBank);

    // Blue Apple Maps GPS halo under car
    const haloR = carW * (0.85 + this.beatPulse * 0.14 + (audio.bassEnergy ?? 0) * 0.08);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.24)';
    ctx.beginPath();
    ctx.ellipse(0, carH * 0.26, haloR, haloR * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();

    // Headlight cones at night / sunset
    if (p.headlightIntensity > 0.05) {
      const beamGrad = ctx.createLinearGradient(0, -carH * 0.4, 0, -carH * 3.2);
      beamGrad.addColorStop(0, `rgba(255, 248, 214, ${(0.34 * p.headlightIntensity).toFixed(3)})`);
      beamGrad.addColorStop(1, 'rgba(255, 248, 214, 0)');
      ctx.fillStyle = beamGrad;
      ctx.beginPath();
      ctx.moveTo(-carW * 0.36, -carH * 0.35);
      ctx.lineTo(-carW * 1.15, -carH * 3.1);
      ctx.lineTo(carW * 1.15, -carH * 3.1);
      ctx.lineTo(carW * 0.36, -carH * 0.35);
      ctx.closePath();
      ctx.fill();
    }

    // White sculpted body
    drawRoundedRectPath(ctx, -carW * 0.5, -carH * 0.32, carW, carH * 0.62, 7);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();

    // Dark tinted cabin
    drawRoundedRectPath(ctx, -carW * 0.38, -carH * 0.64, carW * 0.76, carH * 0.44, 6);
    ctx.fillStyle = '#0f172a';
    ctx.fill();

    // White roof highlight
    drawRoundedRectPath(ctx, -carW * 0.31, -carH * 0.62, carW * 0.62, carH * 0.2, 4);
    ctx.fillStyle = '#e2e8f0';
    ctx.fill();

    // Red taillights
    ctx.fillStyle = '#ff3b30';
    drawRoundedRectPath(ctx, -carW * 0.44, -carH * 0.14, carW * 0.22, carH * 0.16, 2);
    ctx.fill();
    drawRoundedRectPath(ctx, carW * 0.22, -carH * 0.14, carW * 0.22, carH * 0.16, 2);
    ctx.fill();

    ctx.restore();
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // 3D World-Space Road Callouts & Circular POI Milestone Pins
  // -------------------------------------------------------------------------

  private drawProjectedMilestones(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    focalLeft: number,
    focalWidth: number,
    timeSeconds: number
  ): void {
    if (this.milestones.length === 0) return;

    const biome = this.env.biome;
    const p = TIME_PALETTES[this.env.timeOfDay];
    const roadHalfW = getRoadHalfWidth(biome);
    const travel = this.travelDistance;
    const cx = focalLeft + focalWidth * 0.5;
    const horizonY =
      biome === 'cityscape' ? height * 0.36 : biome === 'highway' ? height * 0.42 : height * 0.4;
    const focalLen = Math.min(focalWidth, height) * (biome === 'cityscape' ? 0.78 : 0.92);
    const st = this.threeActive ? this.threeState : null;

    // Collect up to MAX_PROJECTED_CALLOUTS gliding past the car (strictly atmospheric milestones)
    let count = 0;
    for (let i = 0; i < this.milestones.length && count < MAX_PROJECTED_CALLOUTS; i++) {
      const m = this.milestones[i];
      // Lead-in window: approaches from far horizon 4.2s before triggerSec, glides past by +1.2s
      const dtToTrigger = m.triggerSec - timeSeconds;
      if (dtToTrigger < -1.1 || dtToTrigger > 4.4) continue;

      const zLocal = -2.0 - dtToTrigger * 12.5;
      if (zLocal > 1.5 || zLocal < -58.0) continue;

      const zWorld = travel - zLocal;
      const worldX = sampleRoadX(zWorld, biome) + m.sideSign * (roadHalfW + 2.35);
      const worldY = m.isExitBubble ? 2.55 : 2.1;

      let sx = 0;
      let sy = 0;
      let sc = 1;
      if (st) {
        this.tmpVec.set(worldX, worldY, zLocal);
        this.tmpVec.project(st.camera);
        if (this.tmpVec.z > 1.0 || this.tmpVec.z < -1.0) continue;
        sx = (this.tmpVec.x * 0.5 + 0.5) * width;
        sy = (-this.tmpVec.y * 0.5 + 0.5) * height;
        sc = clamp01(1 - (-zLocal) / 62) * 0.55 + 0.55;
      } else {
        const depth = Math.max(3.2, -zLocal + 5.0);
        const persp = focalLen / depth;
        sx = cx + (worldX - this.smoothedCarX) * persp;
        sy = horizonY + (this.env.cameraHeight - worldY) * persp * 0.64;
        sc = clamp01(1 - depth / 62) * 0.55 + 0.55;
      }

      // Keep clear of top Hero Card zone and bottom ETA telemetry pill
      if (sx < focalLeft + 44 || sx > focalLeft + focalWidth - 44) continue;
      if (sy < 178 || sy > height - 92) continue;

      const fadeIn = clamp01((4.4 - dtToTrigger) / 0.85);
      const fadeOut = clamp01((dtToTrigger + 1.1) / 0.75);
      const alpha = Math.min(fadeIn, fadeOut) * 0.94;
      if (alpha <= 0.04) continue;

      this.projX[count] = sx;
      this.projY[count] = sy;
      this.projScale[count] = sc;
      this.projAlpha[count] = alpha;
      this.projMilestoneIdx[count] = i;
      count++;
    }

    if (count === 0) return;

    ctx.save();
    for (let k = 0; k < count; k++) {
      const m = this.milestones[this.projMilestoneIdx[k]];
      const sx = this.projX[k];
      const sy = this.projY[k];
      const sc = this.projScale[k];
      const alpha = this.projAlpha[k];

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(sx, sy);
      ctx.scale(sc, sc);

      if (m.isExitBubble) {
        // Crisp Apple Maps white/blue exit bubble with stem pin
        ctx.font = "700 12px 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif";
        const labelW = Math.min(168, Math.max(88, ctx.measureText(m.label).width + 26));
        const pillH = 28;
        const px = -labelW * 0.5;
        const py = -pillH - 10;

        // Vertical anchor stem + ground dot
        ctx.strokeStyle = p.calloutBorder;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(0, -10);
        ctx.lineTo(0, 8);
        ctx.stroke();

        ctx.fillStyle = m.badgeColor;
        ctx.beginPath();
        ctx.arc(0, 10, 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Exit bubble body
        drawRoundedRectPath(ctx, px, py, labelW, pillH, 14);
        ctx.fillStyle = p.calloutBg;
        ctx.fill();
        ctx.strokeStyle = p.calloutBorder;
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Colored accent dot on left of pill
        ctx.fillStyle = m.badgeColor;
        ctx.beginPath();
        ctx.arc(px + 12, py + pillH * 0.5, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = p.calloutText;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(m.label, px + 21, py + pillH * 0.5, labelW - 28);
      } else {
        // Colorful Apple Maps Circular POI Pin + compact floating tag
        ctx.fillStyle = m.badgeColor;
        ctx.beginPath();
        ctx.arc(0, -12, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Pointer triangle under circle
        ctx.fillStyle = m.badgeColor;
        ctx.beginPath();
        ctx.moveTo(-5, -1);
        ctx.lineTo(5, -1);
        ctx.lineTo(0, 7);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = "700 12px 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.fillText(m.iconGlyph, 0, -12);

        // Short 1-2 word POI tag beside pin
        ctx.font = "600 11px 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif";
        const tagW = Math.min(132, Math.max(64, ctx.measureText(m.label).width + 16));
        drawRoundedRectPath(ctx, -tagW * 0.5, 10, tagW, 20, 10);
        ctx.fillStyle = p.calloutBg;
        ctx.fill();
        ctx.strokeStyle = p.calloutBorder;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = p.calloutText;
        ctx.fillText(m.label, 0, 20, tagW - 10);
      }

      ctx.restore();
    }
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Main Entry Point
  // -------------------------------------------------------------------------

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    focalLeft: number,
    focalWidth: number,
    timeSeconds: number,
    deltaSeconds: number,
    audio: AudioFrameMetrics,
    palette: LyricPalette,
    track: StyleTrackMetadata | null,
    lyrics: Lyrics | null,
    scenePref: MapScenePreference,
    timePref: MapTimePreference,
    reduceMotion: boolean,
    didSeek: boolean
  ): MapEnvironment {
    const safeW = Math.max(1, Math.round(width));
    const safeH = Math.max(1, Math.round(height));
    const bpm =
      typeof audio.estimatedBpm === 'number' && Number.isFinite(audio.estimatedBpm) && audio.estimatedBpm > 40
        ? audio.estimatedBpm
        : typeof track?.bpm === 'number' && Number.isFinite(track.bpm) && track.bpm > 40
        ? track.bpm
        : 112;

    this.syncEnvironmentAndMilestones(track, lyrics, bpm, palette, scenePref, timePref);

    // Advance driving speed smoothly with BPM + beat pulse
    const dt = Math.max(0.001, Math.min(0.05, Number.isFinite(deltaSeconds) ? deltaSeconds : 0.016));
    if (didSeek || this.lastTimeSec < 0 || Math.abs(timeSeconds - this.lastTimeSec) > 1.5) {
      this.travelDistance = Math.max(0, timeSeconds * 11.5);
    } else if (!reduceMotion) {
      const speedMult =
        this.env.biome === 'highway' ? 1.38 : this.env.biome === 'cityscape' ? 0.92 : 0.85;
      const baseSpeed = (bpm / 100) * 10.5 * speedMult;
      const surge = audio.isDownbeat ? 2.6 : audio.beatDetected ? 1.35 : 0;
      this.travelDistance += (baseSpeed + surge) * dt;
    }
    this.lastTimeSec = timeSeconds;

    if (audio.isDownbeat && !reduceMotion) {
      this.beatPulse = 1.0;
    } else if (audio.beatDetected && !reduceMotion) {
      this.beatPulse = Math.max(this.beatPulse, 0.65);
    } else {
      this.beatPulse = Math.max(0, this.beatPulse - dt * 3.8);
    }

    const focalCenterX = focalLeft + focalWidth * 0.5;
    this.ensureThreeInitialized();

    if (this.threeActive && this.threeState) {
      this.updateThreeScene(
        this.threeState,
        safeW,
        safeH,
        focalCenterX,
        timeSeconds,
        audio,
        reduceMotion
      );
      if (typeof ctx.drawImage === 'function') {
        ctx.drawImage(this.threeState.canvas, 0, 0, safeW, safeH);
      }
    } else {
      this.renderCanvas2DFallback(
        ctx,
        safeW,
        safeH,
        focalLeft,
        focalWidth,
        timeSeconds,
        audio,
        reduceMotion
      );
    }

    // Project atmospheric 3D world-space road callouts & circular POI pins
    this.drawProjectedMilestones(ctx, safeW, safeH, focalLeft, focalWidth, timeSeconds);

    return this.env;
  }
}
