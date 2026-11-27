// Procedural 2.5D Apple Maps Driving Engine (Three.js + Canvas2D Software Fallback).
// Supports 3 flagship biomes (Cityscape, Highway, Countryside) and 3 times of day
// (Night, Sunset, Day) with deterministic genre/BPM/lyrics/palette auto-resolution
// and explicit user overrides.
//
// All 3 biomes drive along high-fidelity C1-continuous 2D XZ turning route graphs
// with biome-specific curvature, road widths, orbiting chase camera, Split-View
// setViewOffset framing, sleek white CarPlay sedan with blinking turn signals &
// route shield pill, and crisp Apple Maps palettes.
//
// Strict 60fps zero-GC rendering: all Three.js geometries, materials, instanced pools,
// textures, typed arrays, and scratch vectors are pre-allocated once on init.
// Preserves matching headless Canvas2D 2.5D perspective fallback for all 3 biomes x 3 times.

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

export type UpcomingTurnDirection = 'straight' | 'left' | 'right';

export interface MapEnvironment {
  readonly biome: MapBiomeKind;
  readonly timeOfDay: MapTimeOfDay;
  readonly cameraDistance: number;
  readonly cameraHeight: number;
  readonly cameraFov: number;
  readonly upcomingTurn?: UpcomingTurnDirection;
  readonly distanceToTurnMeters?: number;
  readonly upcomingStreetName?: string;
  readonly routeShieldLabel?: string;
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
  readonly lookAhead: number;
  readonly lookY: number;
  readonly roadHalfW: number;
  readonly shoulderExtraW: number;
  readonly routeHalfW: number;
  readonly shieldLabel: string;
  readonly defaultStreet: string;
  readonly speedScale: number;
}

const BIOME_CAMERA_SPECS: Record<MapBiomeKind, BiomeCameraSpec> = {
  cityscape: {
    distance: 13.8,
    height: 8.8,
    fov: 50,
    lookAhead: 16.5,
    lookY: 0.65,
    roadHalfW: 3.6,
    shoulderExtraW: 0.95,
    routeHalfW: 0.96,
    shieldLabel: 'I-5 N',
    defaultStreet: 'De Anza Blvd',
    speedScale: 1.0,
  },
  highway: {
    distance: 8.4,
    height: 4.6,
    fov: 56,
    lookAhead: 22.0,
    lookY: 0.52,
    roadHalfW: 5.2,
    shoulderExtraW: 1.25,
    routeHalfW: 1.16,
    shieldLabel: 'I-280 N',
    defaultStreet: 'I-280 N',
    speedScale: 1.48,
  },
  countryside: {
    distance: 9.2,
    height: 5.2,
    fov: 48,
    lookAhead: 17.5,
    lookY: 0.54,
    roadHalfW: 2.75,
    shoulderExtraW: 0.72,
    routeHalfW: 0.84,
    shieldLabel: 'SR-1 N',
    defaultStreet: 'Cedar Creek Rd',
    speedScale: 0.92,
  },
};

interface MapPaletteSpec {
  readonly skyTop: string;
  readonly skyMid: string;
  readonly skyHorizon: string;
  readonly fogHex: number;
  readonly fogDensity: number;
  readonly groundHex: number;
  readonly groundCss: string;
  readonly highwayGroundHex: number;
  readonly highwayGroundCss: string;
  readonly countryGroundHex: number;
  readonly countryGroundCss: string;
  readonly roadHex: number;
  readonly roadCss: string;
  readonly shoulderHex: number;
  readonly shoulderCss: string;
  readonly laneDashHex: number;
  readonly laneDashCss: string;
  readonly crosswalkHex: number;
  readonly crosswalkCss: string;
  readonly routePrimaryHex: number;
  readonly routePrimaryCss: string;
  readonly routeGlowHex: number;
  readonly routeGlowCss: string;
  readonly buildingHex: number;
  readonly buildingAltHex: number;
  readonly buildingCss: string;
  readonly buildingShadedCss: string;
  readonly buildingRoofCss: string;
  readonly parkHex: number;
  readonly parkCss: string;
  readonly treeFoliageHex: number;
  readonly treeFoliageCss: string;
  readonly treeTrunkHex: number;
  readonly hillHex: number;
  readonly hillTopHex: number;
  readonly hillCss: string;
  readonly hillTopCss: string;
  readonly waterHex: number;
  readonly waterCss: string;
  readonly riverBankHex: number;
  readonly fenceHex: number;
  readonly fenceCss: string;
  readonly barnHex: number;
  readonly barnCss: string;
  readonly barnRoofHex: number;
  readonly barnRoofCss: string;
  readonly overpassHex: number;
  readonly overpassCss: string;
  readonly overpassRailHex: number;
  readonly overpassRailCss: string;
  readonly sunLightHex: number;
  readonly sunIntensity: number;
  readonly hemiSkyHex: number;
  readonly hemiGroundHex: number;
  readonly hemiIntensity: number;
  readonly windowGlow: number;
  readonly windowColorHex: number;
  readonly headlightIntensity: number;
  readonly taillightIntensity: number;
  readonly calloutBg: string;
  readonly calloutText: string;
  readonly calloutBorder: string;
}

// Crisp Apple Maps / CarPlay palettes across Night, Sunset, and Day (zero muddy brown/black slabs)
const MAP_PALETTES: Record<MapTimeOfDay, MapPaletteSpec> = {
  night: {
    skyTop: '#121928',
    skyMid: '#172033',
    skyHorizon: '#1b2538',
    fogHex: 0x1b2538,
    fogDensity: 0.0112,
    groundHex: 0x161f2f,
    groundCss: '#161f2f',
    highwayGroundHex: 0x142030,
    highwayGroundCss: '#142030',
    countryGroundHex: 0x12262c,
    countryGroundCss: '#12262c',
    roadHex: 0x222c3c,
    roadCss: '#222c3c',
    shoulderHex: 0x2c384d,
    shoulderCss: '#2c384d',
    laneDashHex: 0xdbe4f0,
    laneDashCss: 'rgba(219, 228, 240, 0.80)',
    crosswalkHex: 0xe2e8f0,
    crosswalkCss: 'rgba(226, 232, 240, 0.78)',
    routePrimaryHex: 0x0a84ff,
    routePrimaryCss: '#0A84FF',
    routeGlowHex: 0x38bdf8,
    routeGlowCss: '#38BDF8',
    buildingHex: 0x232f44,
    buildingAltHex: 0x2f3c52,
    buildingCss: '#232f44',
    buildingShadedCss: '#182233',
    buildingRoofCss: '#2f3c52',
    parkHex: 0x0f5a4f,
    parkCss: '#0f5a4f',
    treeFoliageHex: 0x146d5e,
    treeFoliageCss: '#146d5e',
    treeTrunkHex: 0x4b3b30,
    hillHex: 0x14383b,
    hillTopHex: 0x1b4e4c,
    hillCss: '#14383b',
    hillTopCss: '#1b4e4c',
    waterHex: 0x123862,
    waterCss: '#123862',
    riverBankHex: 0x1d4245,
    fenceHex: 0x705d4f,
    fenceCss: '#705d4f',
    barnHex: 0x8d3a44,
    barnCss: '#8d3a44',
    barnRoofHex: 0x334155,
    barnRoofCss: '#334155',
    overpassHex: 0x3b4960,
    overpassCss: '#3b4960',
    overpassRailHex: 0xe2e8f0,
    overpassRailCss: '#e2e8f0',
    sunLightHex: 0xdbeafe,
    sunIntensity: 1.38,
    hemiSkyHex: 0x5c7aa8,
    hemiGroundHex: 0x182233,
    hemiIntensity: 0.96,
    windowGlow: 0.58,
    windowColorHex: 0xe2e8f0,
    headlightIntensity: 0.92,
    taillightIntensity: 1.0,
    calloutBg: 'rgba(22, 30, 44, 0.92)',
    calloutText: '#f8fafc',
    calloutBorder: 'rgba(56, 189, 248, 0.55)',
  },
  sunset: {
    skyTop: '#24234a',
    skyMid: '#7d4467',
    skyHorizon: '#f4a261',
    fogHex: 0x6c485f,
    fogDensity: 0.0098,
    groundHex: 0x2b2d42,
    groundCss: '#2b2d42',
    highwayGroundHex: 0x282d3f,
    highwayGroundCss: '#282d3f',
    countryGroundHex: 0x2c3c40,
    countryGroundCss: '#2c3c40',
    roadHex: 0x34384c,
    roadCss: '#34384c',
    shoulderHex: 0x4d4e66,
    shoulderCss: '#4d4e66',
    laneDashHex: 0xfff3d1,
    laneDashCss: 'rgba(255, 243, 209, 0.85)',
    crosswalkHex: 0xfff7e0,
    crosswalkCss: 'rgba(255, 247, 224, 0.84)',
    routePrimaryHex: 0x0a84ff,
    routePrimaryCss: '#0A84FF',
    routeGlowHex: 0x60a5fa,
    routeGlowCss: '#60A5FA',
    buildingHex: 0x3b3b56,
    buildingAltHex: 0x544e6c,
    buildingCss: '#3b3b56',
    buildingShadedCss: '#2d2d44',
    buildingRoofCss: '#655a78',
    parkHex: 0x2e6150,
    parkCss: '#2e6150',
    treeFoliageHex: 0x3d785b,
    treeFoliageCss: '#3d785b',
    treeTrunkHex: 0x5f4536,
    hillHex: 0x3d5c4e,
    hillTopHex: 0x5b7c5b,
    hillCss: '#3d5c4e',
    hillTopCss: '#5b7c5b',
    waterHex: 0x40547c,
    waterCss: '#40547c',
    riverBankHex: 0x5c6858,
    fenceHex: 0x9c7656,
    fenceCss: '#9c7656',
    barnHex: 0xb84c45,
    barnCss: '#b84c45',
    barnRoofHex: 0x475569,
    barnRoofCss: '#475569',
    overpassHex: 0x6b677e,
    overpassCss: '#6b677e',
    overpassRailHex: 0xfef3c7,
    overpassRailCss: '#fef3c7',
    sunLightHex: 0xffb36b,
    sunIntensity: 1.92,
    hemiSkyHex: 0xfba96c,
    hemiGroundHex: 0x2b2940,
    hemiIntensity: 1.04,
    windowGlow: 0.52,
    windowColorHex: 0xfde68a,
    headlightIntensity: 0.55,
    taillightIntensity: 0.9,
    calloutBg: 'rgba(34, 30, 48, 0.91)',
    calloutText: '#fffbeb',
    calloutBorder: 'rgba(251, 191, 36, 0.58)',
  },
  day: {
    skyTop: '#b7d4ec',
    skyMid: '#cfe3f4',
    skyHorizon: '#dce6f2',
    fogHex: 0xdce6f2,
    fogDensity: 0.0092,
    groundHex: 0xe4e9ef,
    groundCss: '#e4e9ef',
    highwayGroundHex: 0xdde5e2,
    highwayGroundCss: '#dde5e2',
    countryGroundHex: 0xd6e7d1,
    countryGroundCss: '#d6e7d1',
    roadHex: 0x4a5260,
    roadCss: '#4a5260',
    shoulderHex: 0xcbd5e1,
    shoulderCss: '#cbd5e1',
    laneDashHex: 0xffffff,
    laneDashCss: 'rgba(255, 255, 255, 0.92)',
    crosswalkHex: 0xffffff,
    crosswalkCss: 'rgba(255, 255, 255, 0.90)',
    routePrimaryHex: 0x0a84ff,
    routePrimaryCss: '#0A84FF',
    routeGlowHex: 0x60a5fa,
    routeGlowCss: '#60A5FA',
    buildingHex: 0xc6cfdb,
    buildingAltHex: 0xdce2ea,
    buildingCss: '#c6cfdb',
    buildingShadedCss: '#b4bfd0',
    buildingRoofCss: '#dce2ea',
    parkHex: 0x9ecf86,
    parkCss: '#9ecf86',
    treeFoliageHex: 0x7eb868,
    treeFoliageCss: '#7eb868',
    treeTrunkHex: 0x7b5e46,
    hillHex: 0xa7d694,
    hillTopHex: 0x8cc47b,
    hillCss: '#a7d694',
    hillTopCss: '#8cc47b',
    waterHex: 0x64b5f6,
    waterCss: '#64b5f6',
    riverBankHex: 0xc8ddb9,
    fenceHex: 0xb08962,
    fenceCss: '#b08962',
    barnHex: 0xc94a42,
    barnCss: '#c94a42',
    barnRoofHex: 0x475569,
    barnRoofCss: '#475569',
    overpassHex: 0xdbe2ea,
    overpassCss: '#dbe2ea',
    overpassRailHex: 0xffffff,
    overpassRailCss: '#ffffff',
    sunLightHex: 0xfffaf0,
    sunIntensity: 1.88,
    hemiSkyHex: 0xeaf4ff,
    hemiGroundHex: 0x9ab0c2,
    hemiIntensity: 1.12,
    windowGlow: 0.0,
    windowColorHex: 0xe2e8f0,
    headlightIntensity: 0.0,
    taillightIntensity: 0.45,
    calloutBg: 'rgba(255, 255, 255, 0.94)',
    calloutText: '#0f172a',
    calloutBorder: 'rgba(10, 132, 255, 0.48)',
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
 * Resolve biome (cityscape | highway | countryside), time-of-day (night | sunset | day),
 * and camera preset deterministically from track metadata, lyrics, BPM, album-art OKLCH
 * palette, and explicit user overrides.
 */
export function resolveMapEnvironment(
  track: StyleTrackMetadata | TrackInfo | null | undefined,
  lyrics: Lyrics | null | undefined,
  bpm: number | undefined,
  palette: LyricPalette | null | undefined,
  scenePref?: MapScenePreference,
  timePref?: MapTimePreference
): MapEnvironment {
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
    upcomingTurn: 'straight',
    distanceToTurnMeters: 120,
    upcomingStreetName: cam.defaultStreet,
    routeShieldLabel: cam.shieldLabel,
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
  { re: /\b(midnight|moon|moonlight|night|starlight|stars)\b/i, label: 'Midnight Sq', sublabel: 'Overlook', badgeColor: '#6366F1', iconGlyph: '🌙', isExitBubble: true },
  { re: /\b(ocean|sea|wave|waves|tide|harbor|harbour|coast)\b/i, label: 'Harbor Pkwy', sublabel: 'Waterfront', badgeColor: '#0EA5E9', iconGlyph: '🌊', isExitBubble: true },
  { re: /\b(heart|love|kiss|lover|forever)\b/i, label: 'Goat Hill Park', sublabel: 'Landmark', badgeColor: '#10B981', iconGlyph: '♣', isExitBubble: false },
  { re: /\b(crown|king|queen|royal|gold|diamond)\b/i, label: 'Crown Sq', sublabel: 'District', badgeColor: '#F59E0B', iconGlyph: '★', isExitBubble: false },
  { re: /\b(sun|sunrise|sunshine|morning|golden|amber)\b/i, label: 'Sunrise Park', sublabel: 'Scenic', badgeColor: '#10B981', iconGlyph: '☀', isExitBubble: false },
  { re: /\b(rain|storm|tears|cloud|sky)\b/i, label: 'Skyline Way', sublabel: 'Vista', badgeColor: '#60A5FA', iconGlyph: '✦', isExitBubble: true },
  { re: /\b(home|house|door|room|back)\b/i, label: 'Seneca St', sublabel: '0.1 mi', badgeColor: '#10B981', iconGlyph: '⌂', isExitBubble: true },
  { re: /\b(city|downtown|neon|tokyo|street|club)\b/i, label: 'Neon District', sublabel: 'Midtown', badgeColor: '#A855F7', iconGlyph: '◈', isExitBubble: false },
  { re: /\b(drive|highway|road|fast|speed|car)\b/i, label: 'I-280 Express', sublabel: 'I-280 N', badgeColor: '#0A84FF', iconGlyph: '↱', isExitBubble: true },
  { re: /\b(music|song|rhythm|dance|beat|melody)\b/i, label: 'Soundstage', sublabel: 'Live Venue', badgeColor: '#EC4899', iconGlyph: '♪', isExitBubble: false },
];

const BIOME_STREETS: Record<MapBiomeKind, readonly string[]> = {
  cityscape: [
    'De Anza Blvd',
    'Seneca St',
    'Market St',
    'Howard St',
    'Embarcadero',
    'Valencia St',
    'Castro Ave',
    'Junipero Blvd',
  ],
  highway: [
    'I-280 N',
    'US-101 N',
    'I-5 Express',
    'Bayshore Fwy',
    'Skyway 80',
    'Coast Hwy 1',
  ],
  countryside: [
    'Cedar Creek Rd',
    'Pine Ridge Way',
    'Meadow Ln',
    'Old Mill Rd',
    'Harbor Bluff Rd',
    'Valley View Rd',
  ],
};

const BIOME_AMBIENT_EXITS: Record<MapBiomeKind, readonly string[]> = {
  cityscape: ['Exit 11', 'Seneca St', 'Goat Hill Park', 'Exit 47', 'Market St', 'De Anza Blvd'],
  highway: ['Exit 42 · I-280', 'US-101 North', 'Bay Bridge', 'Skyway Exit', 'Summit Rd', 'Coast Hwy'],
  countryside: ['Cedar Creek', 'Pine Ridge', 'Harbor Overlook', 'Meadow Ln', 'Old Mill', 'Vista Pt'],
};

function hashUint(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

function wrapAngle(rad: number): number {
  let a = rad;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// ---------------------------------------------------------------------------
// C1-Continuous 2D XZ Biome Route Graph (Real Turns & Sweeping Curves, Zero-GC)
// ---------------------------------------------------------------------------

type RouteSegKind = 'straight' | 'turnLeft90' | 'turnRight90' | 'sweepLeft' | 'sweepRight';

interface RouteSegment {
  readonly index: number;
  readonly kind: RouteSegKind;
  readonly startS: number;
  readonly endS: number;
  readonly length: number;
  readonly startX: number;
  readonly startZ: number;
  readonly startHeading: number;
  readonly radius: number;
  readonly turnAngle: number;
  readonly streetName: string;
}

interface RouteSample {
  x: number;
  z: number;
  heading: number;
  tx: number;
  tz: number;
  curvature: number;
  segIdx: number;
  streetName: string;
}

const MAX_ROUTE_SEGMENTS = 512;

class BiomeRouteGraph {
  private readonly biome: MapBiomeKind;
  private readonly segments: RouteSegment[] = [];
  private totalLength = 0;

  constructor(biome: MapBiomeKind) {
    this.biome = biome;
    this.ensureLength(240);
  }

  getSegmentCount(): number {
    return this.segments.length;
  }

  getSegment(idx: number): RouteSegment {
    return this.segments[idx];
  }

  ensureLength(targetS: number): void {
    const needed = Math.max(240, targetS + 180);
    const streets = BIOME_STREETS[this.biome];
    const seedSalt = this.biome === 'cityscape' ? 97 : this.biome === 'highway' ? 313 : 719;

    while (this.totalLength < needed && this.segments.length < MAX_ROUTE_SEGMENTS) {
      const idx = this.segments.length;
      const prev = idx > 0 ? this.segments[idx - 1] : null;
      const startS = prev ? prev.endS : 0;
      let startX = 0;
      let startZ = 18;
      let startHeading = 0;

      if (prev) {
        const endPos = this.evalSegmentEnd(prev);
        startX = endPos.x;
        startZ = endPos.z;
        startHeading = endPos.heading;
      }

      const h = hashUint(idx * 48271 + seedSalt);
      const isTurn = idx % 2 === 1;
      let kind: RouteSegKind = 'straight';
      let radius = 0;
      let turnAngle = 0;
      let length = 40;

      if (this.biome === 'cityscape') {
        // Exact Pass 1 Cityscape 90-degree & sweeping avenue turn profile
        if (!isTurn) {
          length = idx === 0 ? 20 : 34 + (h % 3) * 10;
        } else {
          const turnChoice = idx === 1 ? 0 : h % 4;
          if (turnChoice === 0) {
            kind = 'turnRight90';
            radius = 14.5;
            turnAngle = Math.PI * 0.5;
          } else if (turnChoice === 1) {
            kind = 'turnLeft90';
            radius = 14.5;
            turnAngle = -Math.PI * 0.5;
          } else if (turnChoice === 2) {
            kind = 'sweepRight';
            radius = 25.0;
            turnAngle = Math.PI * 0.28;
          } else {
            kind = 'sweepLeft';
            radius = 25.0;
            turnAngle = -Math.PI * 0.28;
          }
          length = Math.abs(turnAngle) * radius;
        }
      } else if (this.biome === 'highway') {
        // Sweeping curved multi-lane expressway with long fast straights & wide banked arcs
        if (!isTurn) {
          length = idx === 0 ? 26 : 38 + (h % 4) * 9;
        } else {
          const goRight = idx === 1 ? true : (h & 1) === 0;
          kind = goRight ? 'sweepRight' : 'sweepLeft';
          radius = 38.0 + ((h >> 2) % 4) * 5.5;
          const arcMag = Math.PI * (0.24 + ((h >> 5) % 4) * 0.045);
          turnAngle = goRight ? arcMag : -arcMag;
          length = Math.abs(turnAngle) * radius;
        }
      } else {
        // Countryside: picturesque winding 2-lane road with frequent gentle & sweeping bends
        if (!isTurn) {
          length = idx === 0 ? 18 : 18 + (h % 3) * 7;
        } else {
          const goRight = idx === 1 ? false : ((idx >> 1) + (h & 1)) % 2 === 0;
          kind = goRight ? 'sweepRight' : 'sweepLeft';
          radius = 20.5 + ((h >> 2) % 4) * 3.2;
          const arcMag = Math.PI * (0.30 + ((h >> 5) % 4) * 0.055);
          turnAngle = goRight ? arcMag : -arcMag;
          length = Math.abs(turnAngle) * radius;
        }
      }

      const streetName = streets[(Math.floor(idx / 2) + (h & 3)) % streets.length];
      const seg: RouteSegment = {
        index: idx,
        kind,
        startS,
        endS: startS + length,
        length,
        startX,
        startZ,
        startHeading,
        radius,
        turnAngle,
        streetName,
      };
      this.segments.push(seg);
      this.totalLength = seg.endS;
    }
  }

  private evalSegmentEnd(seg: RouteSegment): { x: number; z: number; heading: number } {
    if (seg.kind === 'straight') {
      return {
        x: seg.startX + Math.sin(seg.startHeading) * seg.length,
        z: seg.startZ - Math.cos(seg.startHeading) * seg.length,
        heading: seg.startHeading,
      };
    }
    const endHeading = seg.startHeading + seg.turnAngle;
    if (seg.turnAngle > 0) {
      const cx = seg.startX + seg.radius * Math.cos(seg.startHeading);
      const cz = seg.startZ + seg.radius * Math.sin(seg.startHeading);
      return {
        x: cx - seg.radius * Math.cos(endHeading),
        z: cz - seg.radius * Math.sin(endHeading),
        heading: endHeading,
      };
    }
    const cx = seg.startX - seg.radius * Math.cos(seg.startHeading);
    const cz = seg.startZ - seg.radius * Math.sin(seg.startHeading);
    return {
      x: cx + seg.radius * Math.cos(endHeading),
      z: cz + seg.radius * Math.sin(endHeading),
      heading: endHeading,
    };
  }

  sampleAt(sRaw: number, out: RouteSample): void {
    const s = Math.max(0, sRaw);
    this.ensureLength(s);

    let lo = 0;
    let hi = this.segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.segments[mid].endS < s) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    const seg = this.segments[lo];
    const localS = Math.max(0, Math.min(seg.length, s - seg.startS));

    if (seg.kind === 'straight' || seg.radius <= 0.01) {
      const h = seg.startHeading;
      const tx = Math.sin(h);
      const tz = -Math.cos(h);
      out.x = seg.startX + tx * localS;
      out.z = seg.startZ + tz * localS;
      out.heading = h;
      out.tx = tx;
      out.tz = tz;
      out.curvature = 0;
      out.segIdx = seg.index;
      out.streetName = seg.streetName;
      return;
    }

    const u = localS / seg.length;
    const h = seg.startHeading + seg.turnAngle * u;
    if (seg.turnAngle > 0) {
      const cx = seg.startX + seg.radius * Math.cos(seg.startHeading);
      const cz = seg.startZ + seg.radius * Math.sin(seg.startHeading);
      out.x = cx - seg.radius * Math.cos(h);
      out.z = cz - seg.radius * Math.sin(h);
      out.curvature = 1 / seg.radius;
    } else {
      const cx = seg.startX - seg.radius * Math.cos(seg.startHeading);
      const cz = seg.startZ - seg.radius * Math.sin(seg.startHeading);
      out.x = cx + seg.radius * Math.cos(h);
      out.z = cz + seg.radius * Math.sin(h);
      out.curvature = -1 / seg.radius;
    }
    out.heading = h;
    out.tx = Math.sin(h);
    out.tz = -Math.cos(h);
    out.segIdx = seg.index;
    out.streetName = seg.streetName;
  }

  findUpcomingTurn(
    sRaw: number
  ): { direction: UpcomingTurnDirection; distanceMeters: number; streetName: string } {
    const s = Math.max(0, sRaw);
    this.ensureLength(s + 110);
    let lo = 0;
    let hi = this.segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.segments[mid].endS < s) lo = mid + 1;
      else hi = mid;
    }

    const cur = this.segments[lo];
    if (cur.kind !== 'straight') {
      const dir: UpcomingTurnDirection = cur.turnAngle < 0 ? 'left' : 'right';
      const nextSeg = this.segments[Math.min(this.segments.length - 1, lo + 1)];
      return {
        direction: dir,
        distanceMeters: Math.max(5, Math.round((cur.endS - s) * 2)),
        streetName: nextSeg.streetName,
      };
    }

    const nextSeg = this.segments[Math.min(this.segments.length - 1, lo + 1)];
    if (nextSeg && nextSeg.kind !== 'straight') {
      const dist = Math.max(0, nextSeg.startS - s);
      const afterTurn = this.segments[Math.min(this.segments.length - 1, lo + 2)];
      return {
        direction: nextSeg.turnAngle < 0 ? 'left' : 'right',
        distanceMeters: Math.max(10, Math.round(dist * 4)),
        streetName: afterTurn ? afterTurn.streetName : nextSeg.streetName,
      };
    }

    return {
      direction: 'straight',
      distanceMeters: 150,
      streetName: cur.streetName,
    };
  }
}

// ---------------------------------------------------------------------------
// Pre-allocated Pool Constants
// ---------------------------------------------------------------------------

const ROAD_SEGMENTS = 72;
const ROAD_LOOK_BACK = 22.0;
const ROAD_LOOK_AHEAD = 112.0;
const ROAD_SPAN = ROAD_LOOK_BACK + ROAD_LOOK_AHEAD;

const LANE_DASH_COUNT = 66; // up to 3 lanes x 22 dashes
const CHEVRON_COUNT = 20;
const CROSSWALK_STRIPE_COUNT = 48;
const TRAFFIC_LIGHT_COUNT = 16;

// Cityscape pools
const CITY_GRID_RADIUS = 6;
const CITY_BLOCK_COUNT = 156;
const CITY_WINDOW_COUNT = 180;
const CITY_PARK_COUNT = 28;
const CITY_TREE_COUNT = 64;

// Highway pools
const HIGHWAY_OVERPASS_COUNT = 4;
const HIGHWAY_SIGN_COUNT = 4;
const HIGHWAY_EXIT_RAMP_COUNT = 4;
const HIGHWAY_GUARD_COUNT = 64;
const HIGHWAY_TREE_COUNT = 96;

// Countryside pools
const COUNTRY_HILL_COUNT = 48;
const COUNTRY_TREE_COUNT = 96;
const COUNTRY_FENCE_COUNT = 72;
const COUNTRY_COTTAGE_COUNT = 16;

const ROUTE_CLEARANCE_SAMPLES = 52;
const MAX_PROJECTED_CALLOUTS = 4;
const HIGHWAY_LANE_OFFSETS: readonly number[] = [-2.65, 0, 2.65];

interface ThreeMapsState {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly fog: THREE.FogExp2;
  readonly camera: THREE.PerspectiveCamera;
  readonly skyTextures: Record<MapTimeOfDay, THREE.CanvasTexture | null>;
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
  // Sleek White CarPlay Sedan + Route Shield Pill
  readonly carGroup: THREE.Group;
  readonly carHeadlightLeft: THREE.Mesh;
  readonly carHeadlightRight: THREE.Mesh;
  readonly carHeadlightBeamMat: THREE.MeshBasicMaterial;
  readonly carTaillightMat: THREE.MeshBasicMaterial;
  readonly carTurnLeftMat: THREE.MeshBasicMaterial;
  readonly carTurnRightMat: THREE.MeshBasicMaterial;
  readonly carHaloMesh: THREE.Mesh;
  readonly carHaloMat: THREE.MeshBasicMaterial;
  readonly shieldMat: THREE.MeshBasicMaterial;
  readonly shieldTextures: Record<MapBiomeKind, THREE.CanvasTexture | null>;
  // Biome 1: Cityscape
  readonly cityGroup: THREE.Group;
  readonly crosswalkMesh: THREE.InstancedMesh;
  readonly crosswalkMat: THREE.MeshBasicMaterial;
  readonly cityBlocksMesh: THREE.InstancedMesh;
  readonly cityBlocksMat: THREE.MeshLambertMaterial;
  readonly cityRoofsMesh: THREE.InstancedMesh;
  readonly cityRoofsMat: THREE.MeshLambertMaterial;
  readonly cityWindowsMesh: THREE.InstancedMesh;
  readonly cityWindowsMat: THREE.MeshBasicMaterial;
  readonly cityParksMesh: THREE.InstancedMesh;
  readonly cityParksMat: THREE.MeshLambertMaterial;
  readonly cityTreeTrunksMesh: THREE.InstancedMesh;
  readonly cityTreesMesh: THREE.InstancedMesh;
  readonly cityTreesMat: THREE.MeshLambertMaterial;
  readonly trafficPoleMesh: THREE.InstancedMesh;
  readonly trafficGlowMesh: THREE.InstancedMesh;
  readonly trafficGlowMat: THREE.MeshBasicMaterial;
  // Biome 2: Highway
  readonly highwayGroup: THREE.Group;
  readonly overpassDeckMesh: THREE.InstancedMesh;
  readonly overpassDeckMat: THREE.MeshLambertMaterial;
  readonly overpassRailMesh: THREE.InstancedMesh;
  readonly overpassRailMat: THREE.MeshLambertMaterial;
  readonly overpassPillarMesh: THREE.InstancedMesh;
  readonly highwayGantryBeamMesh: THREE.InstancedMesh;
  readonly highwaySignPoles: THREE.InstancedMesh;
  readonly highwaySignBoards: THREE.InstancedMesh;
  readonly highwayExitRampMesh: THREE.InstancedMesh;
  readonly highwayExitRailMesh: THREE.InstancedMesh;
  readonly highwayGuardMesh: THREE.InstancedMesh;
  readonly highwayTreesTrunk: THREE.InstancedMesh;
  readonly highwayTreesCrown: THREE.InstancedMesh;
  readonly highwayTreesCrownMat: THREE.MeshLambertMaterial;
  // Biome 3: Countryside
  readonly countryGroup: THREE.Group;
  readonly riverGeo: THREE.BufferGeometry;
  readonly riverPosArr: Float32Array;
  readonly riverMat: THREE.MeshBasicMaterial;
  readonly riverBankGeo: THREE.BufferGeometry;
  readonly riverBankPosArr: Float32Array;
  readonly riverBankMat: THREE.MeshLambertMaterial;
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
  readonly countryBarnRoofMat: THREE.MeshLambertMaterial;
  readonly countryBarnWindowMesh: THREE.InstancedMesh;
  readonly countryBarnWindowMat: THREE.MeshBasicMaterial;
  readonly disposables: Array<{ dispose: () => void }>;
}

function createSkyGradientTexture(
  palette: MapPaletteSpec,
  timeOfDay: MapTimeOfDay
): THREE.CanvasTexture | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return null;
  }
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d');
  if (!g) return null;

  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, palette.skyTop);
  grad.addColorStop(0.42, palette.skyMid);
  grad.addColorStop(0.62, palette.skyHorizon);
  const fogHexStr = `#${palette.fogHex.toString(16).padStart(6, '0')}`;
  grad.addColorStop(0.76, fogHexStr);
  grad.addColorStop(1, fogHexStr);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 128);

  if (timeOfDay === 'sunset') {
    const sunGrad = g.createRadialGradient(32, 74, 2, 32, 74, 34);
    sunGrad.addColorStop(0, 'rgba(255, 232, 188, 0.72)');
    sunGrad.addColorStop(0.48, 'rgba(251, 156, 84, 0.30)');
    sunGrad.addColorStop(1, 'rgba(251, 156, 84, 0)');
    g.fillStyle = sunGrad;
    g.fillRect(0, 32, 64, 80);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createRouteShieldTexture(label: string): THREE.CanvasTexture | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return null;
  }
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d');
  if (!g) return null;

  g.clearRect(0, 0, 256, 96);
  drawRoundedRectPath(g, 8, 8, 240, 80, 26);
  g.fillStyle = '#0A84FF';
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = 'rgba(255, 255, 255, 0.92)';
  g.stroke();

  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = "800 40px 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif";
  g.fillText(label, 128, 50);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createHighwayGantryTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return null;
  }
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 176;
  const g = c.getContext('2d');
  if (!g) return null;

  g.clearRect(0, 0, 512, 176);
  drawRoundedRectPath(g, 6, 6, 500, 164, 18);
  g.fillStyle = '#0c6b43';
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = '#f8fafc';
  g.stroke();

  // Interstate shield badge on left
  drawRoundedRectPath(g, 24, 28, 124, 62, 14);
  g.fillStyle = '#0A84FF';
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = '#ffffff';
  g.stroke();

  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = "800 30px 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif";
  g.fillText('I-280', 86, 61);

  g.textAlign = 'left';
  g.font = "800 36px 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif";
  g.fillText('NORTH  ·  EXIT 42', 168, 58);

  g.fillStyle = 'rgba(241, 245, 249, 0.92)';
  g.font = "700 28px 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif";
  g.fillText('BAYSHORE  ↗   0.4 MI', 28, 128);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
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
  const normals = new Float32Array(vertCount * 3);
  for (let i = 0; i < vertCount; i++) {
    normals[i * 3 + 1] = 1;
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return { geo, pos };
}

function pointToSegmentDistSq2D(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number
): number {
  const vx = bx - ax;
  const vz = bz - az;
  const wx = px - ax;
  const wz = pz - az;
  const c1 = vx * wx + vz * wz;
  if (c1 <= 0) return wx * wx + wz * wz;
  const c2 = vx * vx + vz * vz;
  if (c2 <= c1) {
    const dx = px - bx;
    const dz = pz - bz;
    return dx * dx + dz * dz;
  }
  const b = c1 / c2;
  const projX = ax + b * vx;
  const projZ = az + b * vz;
  const dx = px - projX;
  const dz = pz - projZ;
  return dx * dx + dz * dz;
}

export class Maps3DScene {
  private readonly routes: Record<MapBiomeKind, BiomeRouteGraph> = {
    cityscape: new BiomeRouteGraph('cityscape'),
    highway: new BiomeRouteGraph('highway'),
    countryside: new BiomeRouteGraph('countryside'),
  };
  private threeState: ThreeMapsState | null = null;
  private threeAttempted = false;
  private threeActive = false;
  private width = 960;
  private height = 540;
  private dpr = 1;

  private env: MapEnvironment = {
    biome: 'cityscape',
    timeOfDay: 'night',
    cameraDistance: BIOME_CAMERA_SPECS.cityscape.distance,
    cameraHeight: BIOME_CAMERA_SPECS.cityscape.height,
    cameraFov: BIOME_CAMERA_SPECS.cityscape.fov,
    upcomingTurn: 'straight',
    distanceToTurnMeters: 120,
    upcomingStreetName: BIOME_CAMERA_SPECS.cityscape.defaultStreet,
    routeShieldLabel: BIOME_CAMERA_SPECS.cityscape.shieldLabel,
  };
  private cachedTrackKey = '';
  private cachedLyricsRef: Lyrics | null = null;
  private cachedScenePref: MapScenePreference = 'auto';
  private cachedTimePref: MapTimePreference = 'auto';
  private cachedPaletteL = -1;
  private cachedPaletteH = -1;
  private cachedBpmBucket = -1;
  private appliedBiome: MapBiomeKind | null = null;
  private appliedTimeOfDay: MapTimeOfDay | null = null;
  private activePoseBiome: MapBiomeKind = 'cityscape';

  private milestones: MapRoadMilestone[] = [];

  // Continuous driving & orbiting chase-camera state (zero GC)
  private travelDistance = 0;
  private smoothedCarX = 0;
  private smoothedCarZ = 18;
  private smoothedCarHeading = 0;
  private smoothedCarBank = 0;
  private chaseHeading = 0;
  private beatPulse = 0;
  private lastTimeSec = -1;

  // Pre-allocated zero-GC scratch objects & typed arrays
  private readonly dummy = new THREE.Object3D();
  private readonly tmpVec = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();
  private readonly tmpRouteSample: RouteSample = {
    x: 0,
    z: 18,
    heading: 0,
    tx: 0,
    tz: -1,
    curvature: 0,
    segIdx: 0,
    streetName: 'De Anza Blvd',
  };
  private readonly tmpRouteSampleB: RouteSample = {
    x: 0,
    z: 18,
    heading: 0,
    tx: 0,
    tz: -1,
    curvature: 0,
    segIdx: 0,
    streetName: 'De Anza Blvd',
  };
  private readonly routeClearX = new Float32Array(ROUTE_CLEARANCE_SAMPLES);
  private readonly routeClearZ = new Float32Array(ROUTE_CLEARANCE_SAMPLES);
  private readonly riverClearX = new Float32Array(ROUTE_CLEARANCE_SAMPLES);
  private readonly riverClearZ = new Float32Array(ROUTE_CLEARANCE_SAMPLES);
  // Software fallback pre-allocated buffers (ROAD_SEGMENTS + 1 points)
  private readonly swLeftX = new Float32Array(ROAD_SEGMENTS + 1);
  private readonly swRightX = new Float32Array(ROAD_SEGMENTS + 1);
  private readonly swCenterX = new Float32Array(ROAD_SEGMENTS + 1);
  private readonly swScreenY = new Float32Array(ROAD_SEGMENTS + 1);
  private readonly swScale = new Float32Array(ROAD_SEGMENTS + 1);
  private readonly swDepth = new Float32Array(ROAD_SEGMENTS + 1);
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

  getCarPose(): { x: number; z: number; heading: number; travelDistance: number } {
    return {
      x: this.smoothedCarX,
      z: this.smoothedCarZ,
      heading: this.smoothedCarHeading,
      travelDistance: this.travelDistance,
    };
  }

  isWebGlActive(): boolean {
    return this.threeActive;
  }

  reset(): void {
    this.travelDistance = 0;
    const route = this.routes[this.env.biome];
    route.sampleAt(0, this.tmpRouteSample);
    this.smoothedCarX = this.tmpRouteSample.x;
    this.smoothedCarZ = this.tmpRouteSample.z;
    this.smoothedCarHeading = this.tmpRouteSample.heading;
    this.smoothedCarBank = 0;
    this.chaseHeading = this.tmpRouteSample.heading;
    this.activePoseBiome = this.env.biome;
    this.beatPulse = 0;
    this.lastTimeSec = -1;
    this.cachedTrackKey = '';
    this.cachedLyricsRef = null;
    this.cachedBpmBucket = -1;
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
    renderer.toneMappingExposure = 1.14;
    canvas.addEventListener('webglcontextlost', this.boundContextLost);

    const disposables: Array<{ dispose: () => void }> = [];
    const trackDisp = <T extends { dispose: () => void }>(item: T): T => {
      disposables.push(item);
      return item;
    };

    const scene = new THREE.Scene();
    const fog = new THREE.FogExp2(MAP_PALETTES.night.fogHex, MAP_PALETTES.night.fogDensity);
    scene.fog = fog;

    const skyTextures: Record<MapTimeOfDay, THREE.CanvasTexture | null> = {
      night: createSkyGradientTexture(MAP_PALETTES.night, 'night'),
      sunset: createSkyGradientTexture(MAP_PALETTES.sunset, 'sunset'),
      day: createSkyGradientTexture(MAP_PALETTES.day, 'day'),
    };
    if (skyTextures.night) trackDisp(skyTextures.night);
    if (skyTextures.sunset) trackDisp(skyTextures.sunset);
    if (skyTextures.day) trackDisp(skyTextures.day);
    scene.background = skyTextures.night ?? new THREE.Color(MAP_PALETTES.night.fogHex);

    const initCam = BIOME_CAMERA_SPECS.cityscape;
    const camera = new THREE.PerspectiveCamera(
      initCam.fov,
      this.width / Math.max(1, this.height),
      0.25,
      210
    );
    camera.position.set(0, initCam.height, 18 + initCam.distance);
    camera.lookAt(0, initCam.lookY, 0);

    // Crisp Apple Maps architectural directional + hemisphere lighting
    const sunLight = new THREE.DirectionalLight(MAP_PALETTES.night.sunLightHex, 1.38);
    sunLight.position.set(20, 34, 16);
    scene.add(sunLight);

    const hemiLight = new THREE.HemisphereLight(
      MAP_PALETTES.night.hemiSkyHex,
      MAP_PALETTES.night.hemiGroundHex,
      0.96
    );
    scene.add(hemiLight);

    // Infinite-horizon ground plane centered dynamically under car (zero vertical seam)
    const groundGeo = trackDisp(new THREE.PlaneGeometry(420, 420));
    const groundMat = trackDisp(new THREE.MeshLambertMaterial({ color: MAP_PALETTES.night.groundHex }));
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI * 0.5;
    groundMesh.position.set(0, -0.02, 0);
    scene.add(groundMesh);

    // Turning 2D XZ Road Shoulder, Asphalt & Glowing Apple Blue Route Ribbon
    const shoulder = createRibbonGeometry(ROAD_SEGMENTS);
    trackDisp(shoulder.geo);
    const shoulderMat = trackDisp(
      new THREE.MeshLambertMaterial({ color: MAP_PALETTES.night.shoulderHex })
    );
    const shoulderMesh = new THREE.Mesh(shoulder.geo, shoulderMat);
    scene.add(shoulderMesh);

    const road = createRibbonGeometry(ROAD_SEGMENTS);
    trackDisp(road.geo);
    const roadMat = trackDisp(new THREE.MeshLambertMaterial({ color: MAP_PALETTES.night.roadHex }));
    const roadMesh = new THREE.Mesh(road.geo, roadMat);
    scene.add(roadMesh);

    const route = createRibbonGeometry(ROAD_SEGMENTS);
    trackDisp(route.geo);
    const routeMat = trackDisp(
      new THREE.MeshBasicMaterial({
        color: MAP_PALETTES.night.routePrimaryHex,
        transparent: true,
        opacity: 0.92,
      })
    );
    const routeMesh = new THREE.Mesh(route.geo, routeMat);
    scene.add(routeMesh);

    const routeCore = createRibbonGeometry(ROAD_SEGMENTS);
    trackDisp(routeCore.geo);
    const routeCoreMat = trackDisp(
      new THREE.MeshBasicMaterial({
        color: MAP_PALETTES.night.routeGlowHex,
        transparent: true,
        opacity: 0.88,
      })
    );
    const routeCoreMesh = new THREE.Mesh(routeCore.geo, routeCoreMat);
    scene.add(routeCoreMesh);

    // Multi-lane dashed lane dividers
    const dashGeo = trackDisp(new THREE.BoxGeometry(0.14, 0.02, 2.1));
    const laneDashMat = trackDisp(
      new THREE.MeshBasicMaterial({
        color: MAP_PALETTES.night.laneDashHex,
        transparent: true,
        opacity: 0.82,
      })
    );
    const laneDashMesh = new THREE.InstancedMesh(dashGeo, laneDashMat, LANE_DASH_COUNT);
    laneDashMesh.frustumCulled = false;
    scene.add(laneDashMesh);

    // Animated directional route chevrons
    const chevGeo = trackDisp(new THREE.ConeGeometry(0.42, 0.78, 3));
    chevGeo.rotateX(-Math.PI * 0.5);
    chevGeo.scale(1.0, 0.14, 1.0);
    const chevronMat = trackDisp(
      new THREE.MeshBasicMaterial({ color: 0xe0f2fe, transparent: true, opacity: 0.9 })
    );
    const chevronMesh = new THREE.InstancedMesh(chevGeo, chevronMat, CHEVRON_COUNT);
    chevronMesh.frustumCulled = false;
    scene.add(chevronMesh);

    // -----------------------------------------------------------------------
    // Sleek White Low-Poly 3D CarPlay Sedan + Blinking Signals + Route Shield
    // -----------------------------------------------------------------------
    const carGroup = new THREE.Group();
    const carBodyMat = trackDisp(
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.24, metalness: 0.22 })
    );
    const carGlassMat = trackDisp(
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.1, metalness: 0.65 })
    );
    const carWheelMat = trackDisp(new THREE.MeshLambertMaterial({ color: 0x0f172a }));
    const carShadowMat = trackDisp(
      new THREE.MeshBasicMaterial({
        color: 0x040710,
        transparent: true,
        opacity: 0.44,
        depthWrite: false,
      })
    );
    const carHeadlightBeamMat = trackDisp(
      new THREE.MeshBasicMaterial({
        color: 0xfff8d6,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
      })
    );
    const carTaillightMat = trackDisp(new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
    const carHeadlampMat = trackDisp(new THREE.MeshBasicMaterial({ color: 0xfffbeb }));
    const carTurnLeftMat = trackDisp(new THREE.MeshBasicMaterial({ color: 0xf59e0b }));
    const carTurnRightMat = trackDisp(new THREE.MeshBasicMaterial({ color: 0xf59e0b }));

    const dropShadowGeo = trackDisp(new THREE.PlaneGeometry(1.65, 3.0));
    dropShadowGeo.rotateX(-Math.PI * 0.5);
    const dropShadowMesh = new THREE.Mesh(dropShadowGeo, carShadowMat);
    dropShadowMesh.position.set(0, 0.04, 0.05);
    carGroup.add(dropShadowMesh);

    const chassisGeo = trackDisp(new THREE.BoxGeometry(1.24, 0.34, 2.48));
    const chassisMesh = new THREE.Mesh(chassisGeo, carBodyMat);
    chassisMesh.position.set(0, 0.31, 0);
    carGroup.add(chassisMesh);

    const hoodGeo = trackDisp(new THREE.BoxGeometry(1.16, 0.14, 0.72));
    const hoodMesh = new THREE.Mesh(hoodGeo, carBodyMat);
    hoodMesh.position.set(0, 0.44, -0.82);
    hoodMesh.rotation.x = 0.08;
    carGroup.add(hoodMesh);

    const cabinGeo = trackDisp(new THREE.BoxGeometry(1.02, 0.32, 1.28));
    const cabinMesh = new THREE.Mesh(cabinGeo, carGlassMat);
    cabinMesh.position.set(0, 0.6, 0.12);
    carGroup.add(cabinMesh);

    const roofGeo = trackDisp(new THREE.BoxGeometry(0.96, 0.065, 0.94));
    const roofMesh = new THREE.Mesh(roofGeo, carBodyMat);
    roofMesh.position.set(0, 0.77, 0.16);
    carGroup.add(roofMesh);

    const wheelGeo = trackDisp(new THREE.CylinderGeometry(0.21, 0.21, 0.16, 10));
    wheelGeo.rotateZ(Math.PI * 0.5);
    const wheelPositions: readonly [number, number, number][] = [
      [-0.63, 0.21, -0.76],
      [0.63, 0.21, -0.76],
      [-0.63, 0.21, 0.76],
      [0.63, 0.21, 0.76],
    ];
    for (let i = 0; i < wheelPositions.length; i++) {
      const wp = wheelPositions[i];
      const wm = new THREE.Mesh(wheelGeo, carWheelMat);
      wm.position.set(wp[0], wp[1], wp[2]);
      carGroup.add(wm);
    }

    const lampGeo = trackDisp(new THREE.BoxGeometry(0.24, 0.09, 0.06));
    const hlLeft = new THREE.Mesh(lampGeo, carHeadlampMat);
    hlLeft.position.set(-0.4, 0.35, -1.24);
    carGroup.add(hlLeft);
    const hlRight = new THREE.Mesh(lampGeo, carHeadlampMat);
    hlRight.position.set(0.4, 0.35, -1.24);
    carGroup.add(hlRight);

    const beamGeo = trackDisp(new THREE.ConeGeometry(1.15, 5.8, 12, 1, true));
    beamGeo.rotateX(Math.PI * 0.5);
    const carHeadlightLeft = new THREE.Mesh(beamGeo, carHeadlightBeamMat);
    carHeadlightLeft.position.set(-0.4, 0.16, -4.15);
    carHeadlightLeft.scale.set(1.0, 0.18, 1.0);
    carGroup.add(carHeadlightLeft);
    const carHeadlightRight = new THREE.Mesh(beamGeo, carHeadlightBeamMat);
    carHeadlightRight.position.set(0.4, 0.16, -4.15);
    carHeadlightRight.scale.set(1.0, 0.18, 1.0);
    carGroup.add(carHeadlightRight);

    const tailGeo = trackDisp(new THREE.BoxGeometry(0.26, 0.1, 0.06));
    const tlLeft = new THREE.Mesh(tailGeo, carTaillightMat);
    tlLeft.position.set(-0.42, 0.38, 1.24);
    carGroup.add(tlLeft);
    const tlRight = new THREE.Mesh(tailGeo, carTaillightMat);
    tlRight.position.set(0.42, 0.38, 1.24);
    carGroup.add(tlRight);
    const tailBarGeo = trackDisp(new THREE.BoxGeometry(0.58, 0.045, 0.05));
    const tailBar = new THREE.Mesh(tailBarGeo, carTaillightMat);
    tailBar.position.set(0, 0.39, 1.24);
    carGroup.add(tailBar);

    const turnGeo = trackDisp(new THREE.BoxGeometry(0.11, 0.09, 0.08));
    const turnLeft = new THREE.Mesh(turnGeo, carTurnLeftMat);
    turnLeft.position.set(-0.56, 0.36, 1.23);
    carGroup.add(turnLeft);
    const turnRight = new THREE.Mesh(turnGeo, carTurnRightMat);
    turnRight.position.set(0.56, 0.36, 1.23);
    carGroup.add(turnRight);

    // Pre-allocated biome route shield pill textures ("I-5 N" / "I-280 N" / "SR-1 N")
    const shieldTextures: Record<MapBiomeKind, THREE.CanvasTexture | null> = {
      cityscape: createRouteShieldTexture(BIOME_CAMERA_SPECS.cityscape.shieldLabel),
      highway: createRouteShieldTexture(BIOME_CAMERA_SPECS.highway.shieldLabel),
      countryside: createRouteShieldTexture(BIOME_CAMERA_SPECS.countryside.shieldLabel),
    };
    if (shieldTextures.cityscape) trackDisp(shieldTextures.cityscape);
    if (shieldTextures.highway) trackDisp(shieldTextures.highway);
    if (shieldTextures.countryside) trackDisp(shieldTextures.countryside);

    const shieldGeo = trackDisp(new THREE.PlaneGeometry(2.35, 0.88));
    const shieldMat = trackDisp(
      new THREE.MeshBasicMaterial({
        map: shieldTextures.cityscape ?? undefined,
        color: 0xffffff,
        transparent: true,
        depthWrite: false,
      })
    );
    const shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
    shieldMesh.position.set(0, 0.24, 2.75);
    shieldMesh.rotation.x = -Math.PI * 0.34;
    carGroup.add(shieldMesh);

    const haloGeo = trackDisp(new THREE.RingGeometry(1.08, 1.52, 28));
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
    carHaloMesh.position.set(0, 0.07, 0);
    carGroup.add(carHaloMesh);
    scene.add(carGroup);

    // Shared wood trunk & metal pole materials
    const trunkGeo = trackDisp(new THREE.CylinderGeometry(0.15, 0.22, 1.05, 6));
    const trunkMat = trackDisp(new THREE.MeshLambertMaterial({ color: MAP_PALETTES.night.treeTrunkHex }));
    const poleGeo = trackDisp(new THREE.CylinderGeometry(0.08, 0.09, 3.8, 6));
    const poleMat = trackDisp(new THREE.MeshLambertMaterial({ color: 0x64748b }));

    // -----------------------------------------------------------------------
    // BIOME 1: CITYSCAPE (Exact Pass 1 Architectural Blocks, Parks, Crosswalks)
    // -----------------------------------------------------------------------
    const cityGroup = new THREE.Group();

    const cwGeo = trackDisp(new THREE.BoxGeometry(0.46, 0.024, 1.55));
    const crosswalkMat = trackDisp(
      new THREE.MeshBasicMaterial({
        color: MAP_PALETTES.night.crosswalkHex,
        transparent: true,
        opacity: 0.84,
      })
    );
    const crosswalkMesh = new THREE.InstancedMesh(cwGeo, crosswalkMat, CROSSWALK_STRIPE_COUNT);
    crosswalkMesh.frustumCulled = false;
    cityGroup.add(crosswalkMesh);

    const blockGeo = trackDisp(new THREE.BoxGeometry(1, 1, 1));
    const cityBlocksMat = trackDisp(
      new THREE.MeshLambertMaterial({ color: MAP_PALETTES.night.buildingHex })
    );
    const cityBlocksMesh = new THREE.InstancedMesh(blockGeo, cityBlocksMat, CITY_BLOCK_COUNT);
    cityBlocksMesh.frustumCulled = false;
    cityGroup.add(cityBlocksMesh);

    const roofBevelGeo = trackDisp(new THREE.BoxGeometry(0.9, 0.26, 0.9));
    const cityRoofsMat = trackDisp(
      new THREE.MeshLambertMaterial({ color: MAP_PALETTES.night.buildingAltHex })
    );
    const cityRoofsMesh = new THREE.InstancedMesh(roofBevelGeo, cityRoofsMat, CITY_BLOCK_COUNT);
    cityRoofsMesh.frustumCulled = false;
    cityGroup.add(cityRoofsMesh);

    const winGeo = trackDisp(new THREE.BoxGeometry(1.02, 0.14, 0.76));
    const cityWindowsMat = trackDisp(
      new THREE.MeshBasicMaterial({
        color: MAP_PALETTES.night.windowColorHex,
        transparent: true,
        opacity: 0.42,
      })
    );
    const cityWindowsMesh = new THREE.InstancedMesh(winGeo, cityWindowsMat, CITY_WINDOW_COUNT);
    cityWindowsMesh.frustumCulled = false;
    cityGroup.add(cityWindowsMesh);

    const parkGeo = trackDisp(new THREE.BoxGeometry(10.6, 0.14, 10.6));
    const cityParksMat = trackDisp(
      new THREE.MeshLambertMaterial({ color: MAP_PALETTES.night.parkHex })
    );
    const cityParksMesh = new THREE.InstancedMesh(parkGeo, cityParksMat, CITY_PARK_COUNT);
    cityParksMesh.frustumCulled = false;
    cityGroup.add(cityParksMesh);

    const cityTreeTrunksMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, CITY_TREE_COUNT);
    cityTreeTrunksMesh.frustumCulled = false;
    cityGroup.add(cityTreeTrunksMesh);

    const roundedTreeGeo = trackDisp(new THREE.IcosahedronGeometry(0.95, 1));
    const cityTreesMat = trackDisp(
      new THREE.MeshLambertMaterial({ color: MAP_PALETTES.night.treeFoliageHex })
    );
    const cityTreesMesh = new THREE.InstancedMesh(roundedTreeGeo, cityTreesMat, CITY_TREE_COUNT);
    cityTreesMesh.frustumCulled = false;
    cityGroup.add(cityTreesMesh);

    const trafficPoleMesh = new THREE.InstancedMesh(poleGeo, poleMat, TRAFFIC_LIGHT_COUNT);
    trafficPoleMesh.frustumCulled = false;
    cityGroup.add(trafficPoleMesh);

    const tGlowGeo = trackDisp(new THREE.SphereGeometry(0.24, 8, 6));
    const trafficGlowMat = trackDisp(new THREE.MeshBasicMaterial({ color: 0x34d399 }));
    const trafficGlowMesh = new THREE.InstancedMesh(tGlowGeo, trafficGlowMat, TRAFFIC_LIGHT_COUNT);
    trafficGlowMesh.frustumCulled = false;
    cityGroup.add(trafficGlowMesh);
    scene.add(cityGroup);

    // -----------------------------------------------------------------------
    // BIOME 2: HIGHWAY (Sweeping Expressway, White-Railed Overpasses, Gantries, Exit Ramps, Wooded Shoulders)
    // -----------------------------------------------------------------------
    const highwayGroup = new THREE.Group();

    const deckGeo = trackDisp(new THREE.BoxGeometry(34, 0.8, 4.6));
    const overpassDeckMat = trackDisp(
      new THREE.MeshLambertMaterial({ color: MAP_PALETTES.night.overpassHex })
    );
    const overpassDeckMesh = new THREE.InstancedMesh(deckGeo, overpassDeckMat, HIGHWAY_OVERPASS_COUNT);
    overpassDeckMesh.frustumCulled = false;
    highwayGroup.add(overpassDeckMesh);

    const railGeo = trackDisp(new THREE.BoxGeometry(34, 0.36, 0.24));
    const overpassRailMat = trackDisp(
      new THREE.MeshLambertMaterial({ color: MAP_PALETTES.night.overpassRailHex })
    );
    const overpassRailMesh = new THREE.InstancedMesh(
      railGeo,
      overpassRailMat,
      HIGHWAY_OVERPASS_COUNT * 2
    );
    overpassRailMesh.frustumCulled = false;
    highwayGroup.add(overpassRailMesh);

    const pillarGeo = trackDisp(new THREE.BoxGeometry(1.05, 5.8, 1.2));
    const overpassPillarMesh = new THREE.InstancedMesh(
      pillarGeo,
      overpassDeckMat,
      HIGHWAY_OVERPASS_COUNT * 2
    );
    overpassPillarMesh.frustumCulled = false;
    highwayGroup.add(overpassPillarMesh);

    const gantryBeamGeo = trackDisp(new THREE.BoxGeometry(14.0, 0.28, 0.28));
    const highwayGantryBeamMesh = new THREE.InstancedMesh(
      gantryBeamGeo,
      poleMat,
      HIGHWAY_SIGN_COUNT
    );
    highwayGantryBeamMesh.frustumCulled = false;
    highwayGroup.add(highwayGantryBeamMesh);

    const gantryPoleGeo = trackDisp(new THREE.CylinderGeometry(0.15, 0.18, 5.8, 6));
    const highwaySignPoles = new THREE.InstancedMesh(
      gantryPoleGeo,
      poleMat,
      HIGHWAY_SIGN_COUNT * 2
    );
    highwaySignPoles.frustumCulled = false;
    highwayGroup.add(highwaySignPoles);

    const gantryTex = createHighwayGantryTexture();
    if (gantryTex) trackDisp(gantryTex);
    const signBoardGeo = trackDisp(new THREE.BoxGeometry(6.8, 2.25, 0.22));
    const signBoardMat = trackDisp(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        map: gantryTex ?? undefined,
      })
    );
    const highwaySignBoards = new THREE.InstancedMesh(
      signBoardGeo,
      signBoardMat,
      HIGHWAY_SIGN_COUNT
    );
    highwaySignBoards.frustumCulled = false;
    highwayGroup.add(highwaySignBoards);

    // Sweeping right-hand exit ramp decks & white outer rails
    const exitRampGeo = trackDisp(new THREE.BoxGeometry(4.4, 0.12, 22.0));
    const highwayExitRampMesh = new THREE.InstancedMesh(
      exitRampGeo,
      roadMat,
      HIGHWAY_EXIT_RAMP_COUNT
    );
    highwayExitRampMesh.frustumCulled = false;
    highwayGroup.add(highwayExitRampMesh);

    const exitRailGeo = trackDisp(new THREE.BoxGeometry(0.22, 0.44, 22.0));
    const highwayExitRailMesh = new THREE.InstancedMesh(
      exitRailGeo,
      overpassRailMat,
      HIGHWAY_EXIT_RAMP_COUNT
    );
    highwayExitRailMesh.frustumCulled = false;
    highwayGroup.add(highwayExitRailMesh);

    // Curved roadside guardrail barrier segments along expressway edges
    const guardGeo = trackDisp(new THREE.BoxGeometry(0.16, 0.42, 3.6));
    const highwayGuardMesh = new THREE.InstancedMesh(
      guardGeo,
      overpassRailMat,
      HIGHWAY_GUARD_COUNT
    );
    highwayGuardMesh.frustumCulled = false;
    highwayGroup.add(highwayGuardMesh);

    // Wooded Apple Maps highway shoulders
    const highwayTreesTrunk = new THREE.InstancedMesh(trunkGeo, trunkMat, HIGHWAY_TREE_COUNT);
    highwayTreesTrunk.frustumCulled = false;
    highwayGroup.add(highwayTreesTrunk);

    const highwayTreeGeo = trackDisp(new THREE.IcosahedronGeometry(1.12, 1));
    const highwayTreesCrownMat = trackDisp(
      new THREE.MeshLambertMaterial({ color: MAP_PALETTES.night.treeFoliageHex })
    );
    const highwayTreesCrown = new THREE.InstancedMesh(
      highwayTreeGeo,
      highwayTreesCrownMat,
      HIGHWAY_TREE_COUNT
    );
    highwayTreesCrown.frustumCulled = false;
    highwayGroup.add(highwayTreesCrown);
    scene.add(highwayGroup);

    // -----------------------------------------------------------------------
    // BIOME 3: COUNTRYSIDE (Winding 2-Lane Road, Terraced Hills, Rounded Trees, Fences, Cottages/Barns, River Bend)
    // -----------------------------------------------------------------------
    const countryGroup = new THREE.Group();

    const riverBank = createRibbonGeometry(ROAD_SEGMENTS);
    trackDisp(riverBank.geo);
    const riverBankMat = trackDisp(
      new THREE.MeshLambertMaterial({ color: MAP_PALETTES.night.riverBankHex })
    );
    const riverBankMesh = new THREE.Mesh(riverBank.geo, riverBankMat);
    countryGroup.add(riverBankMesh);

    const river = createRibbonGeometry(ROAD_SEGMENTS);
    trackDisp(river.geo);
    const riverMat = trackDisp(
      new THREE.MeshBasicMaterial({
        color: MAP_PALETTES.night.waterHex,
        transparent: true,
        opacity: 0.94,
      })
    );
    const riverMesh = new THREE.Mesh(river.geo, riverMat);
    countryGroup.add(riverMesh);

    const hillGeo = trackDisp(new THREE.CylinderGeometry(4.6, 8.2, 2.5, 8));
    const countryHillsMat = trackDisp(
      new THREE.MeshLambertMaterial({ color: MAP_PALETTES.night.hillHex })
    );
    const countryHillsMesh = new THREE.InstancedMesh(hillGeo, countryHillsMat, COUNTRY_HILL_COUNT);
    countryHillsMesh.frustumCulled = false;
    countryGroup.add(countryHillsMesh);

    const hillCapGeo = trackDisp(new THREE.CylinderGeometry(2.6, 4.8, 1.35, 8));
    const countryHillCapsMat = trackDisp(
      new THREE.MeshLambertMaterial({ color: MAP_PALETTES.night.hillTopHex })
    );
    const countryHillCapsMesh = new THREE.InstancedMesh(
      hillCapGeo,
      countryHillCapsMat,
      COUNTRY_HILL_COUNT
    );
    countryHillCapsMesh.frustumCulled = false;
    countryGroup.add(countryHillCapsMesh);

    const countryTreesTrunk = new THREE.InstancedMesh(trunkGeo, trunkMat, COUNTRY_TREE_COUNT);
    countryTreesTrunk.frustumCulled = false;
    countryGroup.add(countryTreesTrunk);

    const countryTreesCrownMat = trackDisp(
      new THREE.MeshLambertMaterial({ color: MAP_PALETTES.night.treeFoliageHex })
    );
    const countryTreesCrown = new THREE.InstancedMesh(
      roundedTreeGeo,
      countryTreesCrownMat,
      COUNTRY_TREE_COUNT
    );
    countryTreesCrown.frustumCulled = false;
    countryGroup.add(countryTreesCrown);

    const fenceGeo = trackDisp(new THREE.BoxGeometry(0.14, 0.68, 2.8));
    const countryFenceMat = trackDisp(
      new THREE.MeshLambertMaterial({ color: MAP_PALETTES.night.fenceHex })
    );
    const countryFenceMesh = new THREE.InstancedMesh(
      fenceGeo,
      countryFenceMat,
      COUNTRY_FENCE_COUNT
    );
    countryFenceMesh.frustumCulled = false;
    countryGroup.add(countryFenceMesh);

    const barnBodyGeo = trackDisp(new THREE.BoxGeometry(2.8, 1.9, 3.4));
    const countryBarnBodyMat = trackDisp(
      new THREE.MeshLambertMaterial({ color: MAP_PALETTES.night.barnHex })
    );
    const countryBarnBodyMesh = new THREE.InstancedMesh(
      barnBodyGeo,
      countryBarnBodyMat,
      COUNTRY_COTTAGE_COUNT
    );
    countryBarnBodyMesh.frustumCulled = false;
    countryGroup.add(countryBarnBodyMesh);

    const barnRoofGeo = trackDisp(new THREE.ConeGeometry(2.45, 1.35, 4));
    barnRoofGeo.rotateY(Math.PI * 0.25);
    const countryBarnRoofMat = trackDisp(
      new THREE.MeshLambertMaterial({ color: MAP_PALETTES.night.barnRoofHex })
    );
    const countryBarnRoofMesh = new THREE.InstancedMesh(
      barnRoofGeo,
      countryBarnRoofMat,
      COUNTRY_COTTAGE_COUNT
    );
    countryBarnRoofMesh.frustumCulled = false;
    countryGroup.add(countryBarnRoofMesh);

    const barnWinGeo = trackDisp(new THREE.BoxGeometry(2.86, 0.36, 0.92));
    const countryBarnWindowMat = trackDisp(
      new THREE.MeshBasicMaterial({ color: 0xfde68a, transparent: true, opacity: 0.85 })
    );
    const countryBarnWindowMesh = new THREE.InstancedMesh(
      barnWinGeo,
      countryBarnWindowMat,
      COUNTRY_COTTAGE_COUNT
    );
    countryBarnWindowMesh.frustumCulled = false;
    countryGroup.add(countryBarnWindowMesh);
    scene.add(countryGroup);

    this.threeState = {
      canvas,
      renderer,
      scene,
      fog,
      camera,
      skyTextures,
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
      carTurnLeftMat,
      carTurnRightMat,
      carHaloMesh,
      carHaloMat,
      shieldMat,
      shieldTextures,
      cityGroup,
      crosswalkMesh,
      crosswalkMat,
      cityBlocksMesh,
      cityBlocksMat,
      cityRoofsMesh,
      cityRoofsMat,
      cityWindowsMesh,
      cityWindowsMat,
      cityParksMesh,
      cityParksMat,
      cityTreeTrunksMesh,
      cityTreesMesh,
      cityTreesMat,
      trafficPoleMesh,
      trafficGlowMesh,
      trafficGlowMat,
      highwayGroup,
      overpassDeckMesh,
      overpassDeckMat,
      overpassRailMesh,
      overpassRailMat,
      overpassPillarMesh,
      highwayGantryBeamMesh,
      highwaySignPoles,
      highwaySignBoards,
      highwayExitRampMesh,
      highwayExitRailMesh,
      highwayGuardMesh,
      highwayTreesTrunk,
      highwayTreesCrown,
      highwayTreesCrownMat,
      countryGroup,
      riverGeo: river.geo,
      riverPosArr: river.pos,
      riverMat,
      riverBankGeo: riverBank.geo,
      riverBankPosArr: riverBank.pos,
      riverBankMat,
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
      countryBarnRoofMat,
      countryBarnWindowMesh,
      countryBarnWindowMat,
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
    const bpmBucket = Math.round(bpm / 6);
    const needsRecompute =
      this.cachedTrackKey !== trackKey ||
      this.cachedLyricsRef !== lyrics ||
      this.cachedScenePref !== scenePref ||
      this.cachedTimePref !== timePref ||
      this.cachedPaletteL !== palL ||
      this.cachedPaletteH !== palH ||
      this.cachedBpmBucket !== bpmBucket;

    if (!needsRecompute) return;

    const prevLyrics = this.cachedLyricsRef;
    const prevBiome = this.env.biome;
    this.cachedTrackKey = trackKey;
    this.cachedLyricsRef = lyrics;
    this.cachedScenePref = scenePref;
    this.cachedTimePref = timePref;
    this.cachedPaletteL = palL;
    this.cachedPaletteH = palH;
    this.cachedBpmBucket = bpmBucket;

    this.env = resolveMapEnvironment(track, lyrics, bpm, palette, scenePref, timePref);

    if (prevLyrics !== lyrics || prevBiome !== this.env.biome || this.milestones.length === 0) {
      this.buildMilestones(lyrics, this.env.biome);
    }
  }

  private buildMilestones(lyrics: Lyrics | null, biome: MapBiomeKind): void {
    const built: MapRoadMilestone[] = [];
    const ambientExits = BIOME_AMBIENT_EXITS[biome];

    if (lyrics && lyrics.lines.length > 0) {
      const freq = new Map<string, number>();
      for (let i = 0; i < lyrics.lines.length; i++) {
        const key = lyrics.lines[i].text.trim().toLowerCase();
        if (key.length >= 6) {
          freq.set(key, (freq.get(key) ?? 0) + 1);
        }
      }

      let lastTrigger = -10;
      let exitCounter = biome === 'highway' ? 42 : 11;
      for (let i = 0; i < lyrics.lines.length; i++) {
        const line = lyrics.lines[i];
        if (line.startSeconds - lastTrigger < 5.6) continue;

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
          exitCounter += 4;
          built.push({
            lineIndex: i,
            triggerSec: line.startSeconds,
            label: `Exit ${exitCounter}`,
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
            label: matched.label,
            sublabel: matched.sublabel,
            badgeColor: matched.badgeColor,
            iconGlyph: matched.iconGlyph,
            isExitBubble: matched.isExitBubble,
            sideSign: i % 2 === 0 ? -1 : 1,
          });
          lastTrigger = line.startSeconds;
        } else if (i % 5 === 0) {
          exitCounter += 3;
          built.push({
            lineIndex: i,
            triggerSec: line.startSeconds,
            label: ambientExits[i % ambientExits.length],
            sublabel: '0.2 mi',
            badgeColor: i % 2 === 0 ? '#0A84FF' : '#10B981',
            iconGlyph: i % 2 === 0 ? '↱' : '♣',
            isExitBubble: i % 2 === 0,
            sideSign: i % 2 === 0 ? 1 : -1,
          });
          lastTrigger = line.startSeconds;
        }
      }
    }

    if (built.length === 0) {
      for (let k = 0; k < 4; k++) {
        built.push({
          lineIndex: -1,
          triggerSec: k * 9,
          label: ambientExits[k % ambientExits.length],
          sublabel: 'Live Route',
          badgeColor: k % 2 === 0 ? '#0A84FF' : '#10B981',
          iconGlyph: k % 2 === 0 ? '↱' : '♣',
          isExitBubble: k % 2 === 0,
          sideSign: k % 2 === 0 ? 1 : -1,
        });
      }
    }

    this.milestones = built;
  }

  private applyBiomeAndPaletteToThree(
    st: ThreeMapsState,
    biome: MapBiomeKind,
    timeOfDay: MapTimeOfDay
  ): void {
    const biomeChanged = this.appliedBiome !== biome;
    const timeChanged = this.appliedTimeOfDay !== timeOfDay;
    if (!biomeChanged && !timeChanged) return;

    this.appliedBiome = biome;
    this.appliedTimeOfDay = timeOfDay;

    st.cityGroup.visible = biome === 'cityscape';
    st.highwayGroup.visible = biome === 'highway';
    st.countryGroup.visible = biome === 'countryside';

    if (biomeChanged) {
      const shieldTex = st.shieldTextures[biome];
      if (shieldTex) {
        st.shieldMat.map = shieldTex;
        st.shieldMat.needsUpdate = true;
      }
    }

    const p = MAP_PALETTES[timeOfDay];
    st.fog.color.setHex(p.fogHex);
    st.fog.density = biome === 'highway' ? p.fogDensity * 0.88 : p.fogDensity;

    const skyTex = st.skyTextures[timeOfDay];
    if (skyTex) {
      st.scene.background = skyTex;
    } else if (st.scene.background instanceof THREE.Color) {
      st.scene.background.setHex(p.fogHex);
    } else {
      st.scene.background = new THREE.Color(p.fogHex);
    }

    st.sunLight.color.setHex(p.sunLightHex);
    st.sunLight.intensity = p.sunIntensity;
    if (timeOfDay === 'sunset') {
      st.sunLight.position.set(-22, 16, -34);
    } else if (timeOfDay === 'day') {
      st.sunLight.position.set(18, 36, 16);
    } else {
      st.sunLight.position.set(20, 34, 16);
    }

    st.hemiLight.color.setHex(p.hemiSkyHex);
    st.hemiLight.groundColor.setHex(p.hemiGroundHex);
    st.hemiLight.intensity = p.hemiIntensity;

    const groundHex =
      biome === 'countryside'
        ? p.countryGroundHex
        : biome === 'highway'
        ? p.highwayGroundHex
        : p.groundHex;
    st.groundMat.color.setHex(groundHex);
    st.roadMat.color.setHex(p.roadHex);
    st.shoulderMat.color.setHex(p.shoulderHex);
    st.laneDashMat.color.setHex(p.laneDashHex);
    st.crosswalkMat.color.setHex(p.crosswalkHex);
    st.routeMat.color.setHex(p.routePrimaryHex);
    st.routeCoreMat.color.setHex(p.routeGlowHex);

    // Cityscape materials
    st.cityBlocksMat.color.setHex(p.buildingHex);
    st.cityRoofsMat.color.setHex(p.buildingAltHex);
    st.cityWindowsMat.color.setHex(p.windowColorHex);
    st.cityWindowsMat.opacity = p.windowGlow * 0.65;
    st.cityWindowsMesh.visible = p.windowGlow > 0.05;
    st.cityParksMat.color.setHex(p.parkHex);
    st.cityTreesMat.color.setHex(p.treeFoliageHex);

    // Highway materials
    st.overpassDeckMat.color.setHex(p.overpassHex);
    st.overpassRailMat.color.setHex(p.overpassRailHex);
    st.highwayTreesCrownMat.color.setHex(p.treeFoliageHex);

    // Countryside materials
    st.riverMat.color.setHex(p.waterHex);
    st.riverBankMat.color.setHex(p.riverBankHex);
    st.countryHillsMat.color.setHex(p.hillHex);
    st.countryHillCapsMat.color.setHex(p.hillTopHex);
    st.countryTreesCrownMat.color.setHex(p.treeFoliageHex);
    st.countryFenceMat.color.setHex(p.fenceHex);
    st.countryBarnBodyMat.color.setHex(p.barnHex);
    st.countryBarnRoofMat.color.setHex(p.barnRoofHex);
    st.countryBarnWindowMesh.visible = p.windowGlow > 0.05;
    st.countryBarnWindowMat.opacity = Math.min(0.92, p.windowGlow * 1.15);

    st.carHeadlightBeamMat.opacity = p.headlightIntensity * 0.24;
    st.carHeadlightLeft.visible = p.headlightIntensity > 0.05;
    st.carHeadlightRight.visible = p.headlightIntensity > 0.05;
  }

  private updateRibbons2DXZ(
    st: ThreeMapsState,
    route: BiomeRouteGraph,
    biome: MapBiomeKind,
    travel: number
  ): void {
    const spec = BIOME_CAMERA_SPECS[biome];
    const fill = (
      pos: Float32Array,
      halfW: number,
      y: number,
      lateralOffset = 0,
      meanderAmp = 0
    ): void => {
      for (let i = 0; i <= ROAD_SEGMENTS; i++) {
        const u = i / ROAD_SEGMENTS;
        const s = Math.max(0, travel - ROAD_LOOK_BACK + u * ROAD_SPAN);
        route.sampleAt(s, this.tmpRouteSample);
        const rx = -this.tmpRouteSample.tz;
        const rz = this.tmpRouteSample.tx;
        const lat =
          lateralOffset + (meanderAmp !== 0 ? Math.sin(s * 0.048) * meanderAmp : 0);
        const cx = this.tmpRouteSample.x + rx * lat;
        const cz = this.tmpRouteSample.z + rz * lat;
        const base = i * 6;
        pos[base] = cx - rx * halfW;
        pos[base + 1] = y;
        pos[base + 2] = cz - rz * halfW;
        pos[base + 3] = cx + rx * halfW;
        pos[base + 4] = y;
        pos[base + 5] = cz + rz * halfW;
      }
    };

    fill(st.shoulderPosArr, spec.roadHalfW + spec.shoulderExtraW, 0.01);
    (st.shoulderGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    fill(st.roadPosArr, spec.roadHalfW, 0.028);
    (st.roadGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    fill(st.routePosArr, spec.routeHalfW, 0.052);
    (st.routeGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    fill(st.routeCorePosArr, spec.routeHalfW * 0.44, 0.062);
    (st.routeCoreGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    if (biome === 'countryside') {
      const riverLat = spec.roadHalfW + 8.6;
      fill(st.riverBankPosArr, 4.9, 0.008, riverLat, 2.8);
      (st.riverBankGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;

      fill(st.riverPosArr, 3.6, 0.018, riverLat, 2.8);
      (st.riverGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  private sampleRouteClearance(
    route: BiomeRouteGraph,
    travel: number,
    includeRiver = false
  ): void {
    const riverBaseLat = BIOME_CAMERA_SPECS.countryside.roadHalfW + 8.6;
    for (let k = 0; k < ROUTE_CLEARANCE_SAMPLES; k++) {
      const s = Math.max(0, travel - 30 + (k / (ROUTE_CLEARANCE_SAMPLES - 1)) * 150);
      route.sampleAt(s, this.tmpRouteSample);
      this.routeClearX[k] = this.tmpRouteSample.x;
      this.routeClearZ[k] = this.tmpRouteSample.z;
      if (includeRiver) {
        const rx = -this.tmpRouteSample.tz;
        const rz = this.tmpRouteSample.tx;
        const lat = riverBaseLat + Math.sin(s * 0.048) * 2.8;
        this.riverClearX[k] = this.tmpRouteSample.x + rx * lat;
        this.riverClearZ[k] = this.tmpRouteSample.z + rz * lat;
      }
    }
  }

  private minDistSqToRiver(wx: number, wz: number): number {
    let minSq = 999999;
    for (let k = 0; k < ROUTE_CLEARANCE_SAMPLES; k++) {
      const dx = wx - this.riverClearX[k];
      const dz = wz - this.riverClearZ[k];
      const dSq = dx * dx + dz * dz;
      if (dSq < minSq) minSq = dSq;
    }
    return minSq;
  }

  private minDistSqToRoute(wx: number, wz: number): number {
    let minSq = 999999;
    for (let k = 0; k < ROUTE_CLEARANCE_SAMPLES; k++) {
      const dx = wx - this.routeClearX[k];
      const dz = wz - this.routeClearZ[k];
      const dSq = dx * dx + dz * dz;
      if (dSq < minSq) minSq = dSq;
    }
    return minSq;
  }

  private updateCityscapeThree(
    st: ThreeMapsState,
    route: BiomeRouteGraph,
    travel: number,
    timeSeconds: number,
    camX: number,
    camZ: number
  ): void {
    const roadHalfW = BIOME_CAMERA_SPECS.cityscape.roadHalfW;

    // Crosswalks & traffic lights at 90-degree intersection entries
    let cwIdx = 0;
    let tlIdx = 0;
    const greenPhase = Math.floor(timeSeconds * 0.45) % 2 === 0;
    st.trafficGlowMat.color.setHex(greenPhase ? 0x34d399 : 0xfbbf24);
    const segCount = route.getSegmentCount();
    for (let si = 0; si < segCount && (cwIdx < CROSSWALK_STRIPE_COUNT || tlIdx < TRAFFIC_LIGHT_COUNT); si++) {
      const seg = route.getSegment(si);
      if (seg.kind !== 'turnLeft90' && seg.kind !== 'turnRight90') continue;
      if (seg.endS < travel - 24 || seg.startS > travel + 106) continue;

      route.sampleAt(Math.max(0, seg.startS - 1.5), this.tmpRouteSample);
      const rx = -this.tmpRouteSample.tz;
      const rz = this.tmpRouteSample.tx;
      const yaw = -this.tmpRouteSample.heading;

      for (let stp = -2; stp <= 2 && cwIdx < CROSSWALK_STRIPE_COUNT; stp++) {
        if (stp === 0) continue;
        const off = stp * 1.1;
        this.dummy.position.set(
          this.tmpRouteSample.x + rx * off,
          0.04,
          this.tmpRouteSample.z + rz * off
        );
        this.dummy.rotation.set(0, yaw, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        st.crosswalkMesh.setMatrixAt(cwIdx++, this.dummy.matrix);
      }

      for (let side = -1; side <= 1 && tlIdx < TRAFFIC_LIGHT_COUNT; side += 2) {
        const px = this.tmpRouteSample.x + rx * side * (roadHalfW + 1.15);
        const pz = this.tmpRouteSample.z + rz * side * (roadHalfW + 1.15);
        this.dummy.position.set(px, 1.9, pz);
        this.dummy.rotation.set(0, yaw, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        st.trafficPoleMesh.setMatrixAt(tlIdx, this.dummy.matrix);

        this.dummy.position.set(px - rx * side * 0.45, 3.65, pz - rz * side * 0.45);
        this.dummy.updateMatrix();
        st.trafficGlowMesh.setMatrixAt(tlIdx, this.dummy.matrix);
        tlIdx++;
      }
    }

    const CELL_STEP = 14.0;
    const baseGx = Math.round(this.smoothedCarX / CELL_STEP);
    const baseGz = Math.round(this.smoothedCarZ / CELL_STEP);

    let blockIdx = 0;
    let winIdx = 0;
    let parkIdx = 0;
    let treeIdx = 0;

    for (let gxOff = -CITY_GRID_RADIUS; gxOff <= CITY_GRID_RADIUS; gxOff++) {
      for (let gzOff = -CITY_GRID_RADIUS; gzOff <= CITY_GRID_RADIUS; gzOff++) {
        const gx = baseGx + gxOff;
        const gz = baseGz + gzOff;
        const wx = gx * CELL_STEP;
        const wz = gz * CELL_STEP;

        const minRouteDistSq = this.minDistSqToRoute(wx, wz);
        const sightDistSq = pointToSegmentDistSq2D(
          wx,
          wz,
          camX,
          camZ,
          this.smoothedCarX,
          this.smoothedCarZ
        );
        if (minRouteDistSq < 11.4 * 11.4 || sightDistSq < 8.4 * 8.4) continue;

        const h = hashUint(Math.imul(gx, 73856093) ^ Math.imul(gz, 19349663));
        const isPark = h % 6 === 0 && parkIdx < CITY_PARK_COUNT;

        if (isPark) {
          this.dummy.position.set(wx, 0.05, wz);
          this.dummy.rotation.set(0, 0, 0);
          this.dummy.scale.set(1, 1, 1);
          this.dummy.updateMatrix();
          st.cityParksMesh.setMatrixAt(parkIdx++, this.dummy.matrix);

          for (let t = 0; t < 3 && treeIdx < CITY_TREE_COUNT; t++) {
            const ox = (((h >> (t * 4)) & 7) - 3.5) * 1.05;
            const oz = (((h >> (t * 4 + 12)) & 7) - 3.5) * 1.05;
            const ts = 0.85 + (((h >> (t * 3)) & 3) * 0.16);
            this.dummy.position.set(wx + ox, 0.45 * ts, wz + oz);
            this.dummy.scale.set(ts, ts, ts);
            this.dummy.updateMatrix();
            st.cityTreeTrunksMesh.setMatrixAt(treeIdx, this.dummy.matrix);

            this.dummy.position.set(wx + ox, 1.38 * ts, wz + oz);
            this.dummy.scale.set(ts, ts * 1.15, ts);
            this.dummy.updateMatrix();
            st.cityTreesMesh.setMatrixAt(treeIdx, this.dummy.matrix);
            treeIdx++;
          }
        } else if (blockIdx < CITY_BLOCK_COUNT) {
          const bw = 6.2 + ((h & 15) / 15) * 3.4;
          const bd = 6.2 + (((h >> 4) & 15) / 15) * 3.4;
          const distFactor = Math.min(1.5, Math.sqrt(minRouteDistSq) / 28);
          const bh = 4.6 + (((h >> 8) & 31) / 31) * (10.5 + distFactor * 6.5);

          this.dummy.position.set(wx, bh * 0.5, wz);
          this.dummy.rotation.set(0, 0, 0);
          this.dummy.scale.set(bw, bh, bd);
          this.dummy.updateMatrix();
          st.cityBlocksMesh.setMatrixAt(blockIdx, this.dummy.matrix);

          this.dummy.position.set(wx, bh + 0.13, wz);
          this.dummy.scale.set(bw, 1.0, bd);
          this.dummy.updateMatrix();
          st.cityRoofsMesh.setMatrixAt(blockIdx, this.dummy.matrix);
          blockIdx++;

          if (winIdx < CITY_WINDOW_COUNT && (h & 3) !== 0) {
            const floors = bh > 10 ? 2 : 1;
            for (let f = 0; f < floors && winIdx < CITY_WINDOW_COUNT; f++) {
              const wy = 2.2 + f * 3.2 + ((h >> 14) & 3) * 0.5;
              if (wy < bh - 1.0) {
                this.dummy.position.set(wx, wy, wz);
                this.dummy.scale.set(bw, 1.0, bd);
                this.dummy.updateMatrix();
                st.cityWindowsMesh.setMatrixAt(winIdx++, this.dummy.matrix);
              }
            }
          }
        }
      }
    }

    this.dummy.position.set(0, -60, 0);
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.scale.set(0.01, 0.01, 0.01);
    this.dummy.updateMatrix();
    for (let i = blockIdx; i < CITY_BLOCK_COUNT; i++) {
      st.cityBlocksMesh.setMatrixAt(i, this.dummy.matrix);
      st.cityRoofsMesh.setMatrixAt(i, this.dummy.matrix);
    }
    for (let i = winIdx; i < CITY_WINDOW_COUNT; i++) {
      st.cityWindowsMesh.setMatrixAt(i, this.dummy.matrix);
    }
    for (let i = parkIdx; i < CITY_PARK_COUNT; i++) {
      st.cityParksMesh.setMatrixAt(i, this.dummy.matrix);
    }
    for (let i = treeIdx; i < CITY_TREE_COUNT; i++) {
      st.cityTreeTrunksMesh.setMatrixAt(i, this.dummy.matrix);
      st.cityTreesMesh.setMatrixAt(i, this.dummy.matrix);
    }
    for (let i = cwIdx; i < CROSSWALK_STRIPE_COUNT; i++) {
      st.crosswalkMesh.setMatrixAt(i, this.dummy.matrix);
    }
    for (let i = tlIdx; i < TRAFFIC_LIGHT_COUNT; i++) {
      st.trafficPoleMesh.setMatrixAt(i, this.dummy.matrix);
      st.trafficGlowMesh.setMatrixAt(i, this.dummy.matrix);
    }

    st.cityBlocksMesh.instanceMatrix.needsUpdate = true;
    st.cityRoofsMesh.instanceMatrix.needsUpdate = true;
    st.cityWindowsMesh.instanceMatrix.needsUpdate = true;
    st.cityParksMesh.instanceMatrix.needsUpdate = true;
    st.cityTreeTrunksMesh.instanceMatrix.needsUpdate = true;
    st.cityTreesMesh.instanceMatrix.needsUpdate = true;
    st.crosswalkMesh.instanceMatrix.needsUpdate = true;
    st.trafficPoleMesh.instanceMatrix.needsUpdate = true;
    st.trafficGlowMesh.instanceMatrix.needsUpdate = true;
  }

  private updateHighwayThree(
    st: ThreeMapsState,
    route: BiomeRouteGraph,
    travel: number,
    camX: number,
    camZ: number
  ): void {
    const roadHalfW = BIOME_CAMERA_SPECS.highway.roadHalfW;

    // 1. Elevated white-railed overpasses spanning the curved expressway
    const overpassStep = 46.0;
    const baseOp = Math.floor(Math.max(0, travel - 18) / overpassStep);
    for (let i = 0; i < HIGHWAY_OVERPASS_COUNT; i++) {
      const s = (baseOp + i) * overpassStep + 14;
      route.sampleAt(s, this.tmpRouteSample);
      const skew = ((baseOp + i) & 1) === 0 ? 0.14 : -0.14;
      const yaw = -this.tmpRouteSample.heading + skew;
      const rx = -this.tmpRouteSample.tz;
      const rz = this.tmpRouteSample.tx;
      const tx = this.tmpRouteSample.tx;
      const tz = this.tmpRouteSample.tz;

      this.dummy.position.set(this.tmpRouteSample.x, 5.2, this.tmpRouteSample.z);
      this.dummy.rotation.set(0, yaw, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      st.overpassDeckMesh.setMatrixAt(i, this.dummy.matrix);

      // Front & rear crisp white guardrails on overpass deck
      for (let rSide = -1; rSide <= 1; rSide += 2) {
        const railIdx = i * 2 + (rSide < 0 ? 0 : 1);
        this.dummy.position.set(
          this.tmpRouteSample.x + tx * rSide * 2.18,
          5.76,
          this.tmpRouteSample.z + tz * rSide * 2.18
        );
        this.dummy.rotation.set(0, yaw, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        st.overpassRailMesh.setMatrixAt(railIdx, this.dummy.matrix);
      }

      // Flanking concrete bridge pillars outside highway shoulders
      const pillarOut = roadHalfW + 3.2;
      for (let pSide = -1; pSide <= 1; pSide += 2) {
        const pIdx = i * 2 + (pSide < 0 ? 0 : 1);
        this.dummy.position.set(
          this.tmpRouteSample.x + rx * pSide * pillarOut,
          2.6,
          this.tmpRouteSample.z + rz * pSide * pillarOut
        );
        this.dummy.rotation.set(0, yaw, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        st.overpassPillarMesh.setMatrixAt(pIdx, this.dummy.matrix);
      }
    }

    // 2. Overhead highway gantry signs & right-hand exit ramp offshoots
    const gantryStep = 38.0;
    const baseG = Math.floor(Math.max(0, travel - 12) / gantryStep);
    for (let i = 0; i < HIGHWAY_SIGN_COUNT; i++) {
      const s = (baseG + i) * gantryStep + 26;
      route.sampleAt(s, this.tmpRouteSample);
      const rx = -this.tmpRouteSample.tz;
      const rz = this.tmpRouteSample.tx;
      const tx = this.tmpRouteSample.tx;
      const tz = this.tmpRouteSample.tz;
      const yaw = -this.tmpRouteSample.heading;

      // Overhead steel beam & green Apple Maps interstate sign
      this.dummy.position.set(this.tmpRouteSample.x, 5.55, this.tmpRouteSample.z);
      this.dummy.rotation.set(0, yaw, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      st.highwayGantryBeamMesh.setMatrixAt(i, this.dummy.matrix);

      this.dummy.position.set(
        this.tmpRouteSample.x + rx * 1.4,
        5.15,
        this.tmpRouteSample.z + rz * 1.4
      );
      this.dummy.rotation.set(0, yaw, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      st.highwaySignBoards.setMatrixAt(i, this.dummy.matrix);

      const poleOut = roadHalfW + 1.65;
      for (let side = -1; side <= 1; side += 2) {
        const pIdx = i * 2 + (side < 0 ? 0 : 1);
        this.dummy.position.set(
          this.tmpRouteSample.x + rx * side * poleOut,
          2.9,
          this.tmpRouteSample.z + rz * side * poleOut
        );
        this.dummy.rotation.set(0, yaw, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        st.highwaySignPoles.setMatrixAt(pIdx, this.dummy.matrix);
      }

      // Sweeping right-hand exit ramp branching off ahead of gantry
      if (i < HIGHWAY_EXIT_RAMP_COUNT) {
        const rampCenterX = this.tmpRouteSample.x + rx * (roadHalfW + 4.4) + tx * 9.5;
        const rampCenterZ = this.tmpRouteSample.z + rz * (roadHalfW + 4.4) + tz * 9.5;
        const rampYaw = yaw - 0.30;
        const rampRightX = Math.cos(-rampYaw);
        const rampRightZ = Math.sin(-rampYaw);
        this.dummy.position.set(rampCenterX, 0.04, rampCenterZ);
        this.dummy.rotation.set(0, rampYaw, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        st.highwayExitRampMesh.setMatrixAt(i, this.dummy.matrix);

        this.dummy.position.set(
          rampCenterX + rampRightX * 2.15,
          0.26,
          rampCenterZ + rampRightZ * 2.15
        );
        this.dummy.rotation.set(0, rampYaw, 0);
        this.dummy.updateMatrix();
        st.highwayExitRailMesh.setMatrixAt(i, this.dummy.matrix);
      }
    }

    // 3. Curved white roadside guardrail segments hugging expressway outer shoulders
    const guardStep = 4.2;
    const baseGuard = Math.floor(Math.max(0, travel - ROAD_LOOK_BACK) / guardStep);
    let guardIdx = 0;
    for (let i = 0; i < HIGHWAY_GUARD_COUNT / 2; i++) {
      const s = (baseGuard + i) * guardStep;
      route.sampleAt(s, this.tmpRouteSample);
      const rx = -this.tmpRouteSample.tz;
      const rz = this.tmpRouteSample.tx;
      const yaw = -this.tmpRouteSample.heading;
      const edgeOff = roadHalfW + 0.95;

      this.dummy.position.set(
        this.tmpRouteSample.x - rx * edgeOff,
        0.24,
        this.tmpRouteSample.z - rz * edgeOff
      );
      this.dummy.rotation.set(0, yaw, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      st.highwayGuardMesh.setMatrixAt(guardIdx++, this.dummy.matrix);

      this.dummy.position.set(
        this.tmpRouteSample.x + rx * edgeOff,
        0.24,
        this.tmpRouteSample.z + rz * edgeOff
      );
      this.dummy.updateMatrix();
      st.highwayGuardMesh.setMatrixAt(guardIdx++, this.dummy.matrix);
    }

    // 4. Wooded Apple Maps highway shoulders across wide 2D world grid (route- & sightline-cleared)
    const TREE_CELL = 11.5;
    const baseGx = Math.round(this.smoothedCarX / TREE_CELL);
    const baseGz = Math.round(this.smoothedCarZ / TREE_CELL);
    let treeIdx = 0;
    for (let gxOff = -7; gxOff <= 7 && treeIdx < HIGHWAY_TREE_COUNT; gxOff++) {
      for (let gzOff = -7; gzOff <= 7 && treeIdx < HIGHWAY_TREE_COUNT; gzOff++) {
        const gx = baseGx + gxOff;
        const gz = baseGz + gzOff;
        const h = hashUint(Math.imul(gx, 73856093) ^ Math.imul(gz, 19349663));
        if ((h % 3) === 0) continue;

        const wx = gx * TREE_CELL + (((h & 15) / 15) - 0.5) * 4.5;
        const wz = gz * TREE_CELL + ((((h >> 4) & 15) / 15) - 0.5) * 4.5;
        const minRouteDistSq = this.minDistSqToRoute(wx, wz);
        const sightDistSq = pointToSegmentDistSq2D(
          wx,
          wz,
          camX,
          camZ,
          this.smoothedCarX,
          this.smoothedCarZ
        );
        if (minRouteDistSq < (roadHalfW + 4.8) * (roadHalfW + 4.8) || sightDistSq < 7.2 * 7.2) {
          continue;
        }

        const ts = 0.95 + (((h >> 8) & 7) / 7) * 0.72;
        this.dummy.position.set(wx, 0.52 * ts, wz);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(ts, ts, ts);
        this.dummy.updateMatrix();
        st.highwayTreesTrunk.setMatrixAt(treeIdx, this.dummy.matrix);

        this.dummy.position.set(wx, 1.65 * ts, wz);
        this.dummy.scale.set(ts * 1.05, ts * 1.28, ts * 1.05);
        this.dummy.updateMatrix();
        st.highwayTreesCrown.setMatrixAt(treeIdx, this.dummy.matrix);
        treeIdx++;
      }
    }

    this.dummy.position.set(0, -60, 0);
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.scale.set(0.01, 0.01, 0.01);
    this.dummy.updateMatrix();
    for (let i = treeIdx; i < HIGHWAY_TREE_COUNT; i++) {
      st.highwayTreesTrunk.setMatrixAt(i, this.dummy.matrix);
      st.highwayTreesCrown.setMatrixAt(i, this.dummy.matrix);
    }

    st.overpassDeckMesh.instanceMatrix.needsUpdate = true;
    st.overpassRailMesh.instanceMatrix.needsUpdate = true;
    st.overpassPillarMesh.instanceMatrix.needsUpdate = true;
    st.highwayGantryBeamMesh.instanceMatrix.needsUpdate = true;
    st.highwaySignPoles.instanceMatrix.needsUpdate = true;
    st.highwaySignBoards.instanceMatrix.needsUpdate = true;
    st.highwayExitRampMesh.instanceMatrix.needsUpdate = true;
    st.highwayExitRailMesh.instanceMatrix.needsUpdate = true;
    st.highwayGuardMesh.instanceMatrix.needsUpdate = true;
    st.highwayTreesTrunk.instanceMatrix.needsUpdate = true;
    st.highwayTreesCrown.instanceMatrix.needsUpdate = true;
  }

  private updateCountrysideThree(
    st: ThreeMapsState,
    route: BiomeRouteGraph,
    travel: number,
    camX: number,
    camZ: number
  ): void {
    const roadHalfW = BIOME_CAMERA_SPECS.countryside.roadHalfW;

    // 1. Roadside wooden fences tracing the winding 2D XZ road curve
    const fenceStep = 3.6;
    const baseFence = Math.floor(Math.max(0, travel - ROAD_LOOK_BACK) / fenceStep);
    let fenceIdx = 0;
    for (let i = 0; i < COUNTRY_FENCE_COUNT / 2; i++) {
      const s = (baseFence + i) * fenceStep;
      route.sampleAt(s, this.tmpRouteSample);
      const rx = -this.tmpRouteSample.tz;
      const rz = this.tmpRouteSample.tx;
      const yaw = -this.tmpRouteSample.heading;
      const fenceOff = roadHalfW + 1.38;

      // Left fence continuous along meadow edge
      this.dummy.position.set(
        this.tmpRouteSample.x - rx * fenceOff,
        0.34,
        this.tmpRouteSample.z - rz * fenceOff
      );
      this.dummy.rotation.set(0, yaw, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      st.countryFenceMesh.setMatrixAt(fenceIdx++, this.dummy.matrix);

      // Right fence segments along scenic road border before riverbank
      this.dummy.position.set(
        this.tmpRouteSample.x + rx * fenceOff,
        0.34,
        this.tmpRouteSample.z + rz * fenceOff
      );
      this.dummy.updateMatrix();
      st.countryFenceMesh.setMatrixAt(fenceIdx++, this.dummy.matrix);
    }

    // 2. Rolling terraced low-poly hills, rounded Apple Maps tree clusters & distant cozy cottages/barns
    const CELL_STEP = 16.5;
    const baseGx = Math.round(this.smoothedCarX / CELL_STEP);
    const baseGz = Math.round(this.smoothedCarZ / CELL_STEP);
    let hillIdx = 0;
    let treeIdx = 0;
    let barnIdx = 0;

    for (let gxOff = -6; gxOff <= 6; gxOff++) {
      for (let gzOff = -6; gzOff <= 6; gzOff++) {
        const gx = baseGx + gxOff;
        const gz = baseGz + gzOff;
        const h = hashUint(Math.imul(gx, 73856093) ^ Math.imul(gz, 19349663));
        const wx = gx * CELL_STEP + (((h & 15) / 15) - 0.5) * 4.0;
        const wz = gz * CELL_STEP + ((((h >> 4) & 15) / 15) - 0.5) * 4.0;

        const minRouteDistSq = this.minDistSqToRoute(wx, wz);
        const minRiverDistSq = this.minDistSqToRiver(wx, wz);
        const sightDistSq = pointToSegmentDistSq2D(
          wx,
          wz,
          camX,
          camZ,
          this.smoothedCarX,
          this.smoothedCarZ
        );
        // Keep road, river channel, and camera sightline clear
        if (
          minRouteDistSq < 10.6 * 10.6 ||
          minRiverDistSq < 6.4 * 6.4 ||
          sightDistSq < 8.0 * 8.0
        ) {
          continue;
        }

        const kindMod = h % 10;
        if (kindMod === 0 && barnIdx < COUNTRY_COTTAGE_COUNT && minRouteDistSq > 14.5 * 14.5) {
          // Cozy roadside cottage / barn with pitched roof & warm evening window
          const yaw = (((h >> 8) & 15) / 15) * Math.PI * 2;
          const bs = 0.92 + (((h >> 12) & 7) / 7) * 0.35;
          this.dummy.position.set(wx, 0.95 * bs, wz);
          this.dummy.rotation.set(0, yaw, 0);
          this.dummy.scale.set(bs, bs, bs);
          this.dummy.updateMatrix();
          st.countryBarnBodyMesh.setMatrixAt(barnIdx, this.dummy.matrix);

          this.dummy.position.set(wx, 2.48 * bs, wz);
          this.dummy.scale.set(bs, bs, bs);
          this.dummy.updateMatrix();
          st.countryBarnRoofMesh.setMatrixAt(barnIdx, this.dummy.matrix);

          this.dummy.position.set(wx, 1.05 * bs, wz);
          this.dummy.scale.set(bs, bs, bs);
          this.dummy.updateMatrix();
          st.countryBarnWindowMesh.setMatrixAt(barnIdx, this.dummy.matrix);
          barnIdx++;
        } else if (kindMod <= 4 && hillIdx < COUNTRY_HILL_COUNT && minRouteDistSq > 16.5 * 16.5) {
          // Rolling terraced 2-tier low-poly Apple Maps hill
          const hs = 0.85 + (((h >> 8) & 15) / 15) * 0.85;
          const hh = 0.75 + (((h >> 12) & 15) / 15) * 1.25;
          this.dummy.position.set(wx, 1.1 * hh, wz);
          this.dummy.rotation.set(0, (h & 7) * 0.4, 0);
          this.dummy.scale.set(hs, hh, hs);
          this.dummy.updateMatrix();
          st.countryHillsMesh.setMatrixAt(hillIdx, this.dummy.matrix);

          this.dummy.position.set(wx, 2.65 * hh, wz);
          this.dummy.scale.set(hs * 0.96, hh * 0.95, hs * 0.96);
          this.dummy.updateMatrix();
          st.countryHillCapsMesh.setMatrixAt(hillIdx, this.dummy.matrix);
          hillIdx++;

          // Perched tree cluster on hill skirt
          for (let t = 0; t < 2 && treeIdx < COUNTRY_TREE_COUNT; t++) {
            const tx = wx + (t === 0 ? -3.1 : 2.9) * hs * 0.55;
            const tz = wz + (t === 0 ? 2.4 : -2.6) * hs * 0.55;
            const ts = 0.85 + (((h >> (t * 4 + 16)) & 3) * 0.18);
            this.dummy.position.set(tx, 0.55 * ts + hh * 1.1, tz);
            this.dummy.rotation.set(0, 0, 0);
            this.dummy.scale.set(ts, ts, ts);
            this.dummy.updateMatrix();
            st.countryTreesTrunk.setMatrixAt(treeIdx, this.dummy.matrix);

            this.dummy.position.set(tx, 1.52 * ts + hh * 1.1, tz);
            this.dummy.scale.set(ts * 1.15, ts * 1.18, ts * 1.15);
            this.dummy.updateMatrix();
            st.countryTreesCrown.setMatrixAt(treeIdx, this.dummy.matrix);
            treeIdx++;
          }
        } else if (treeIdx < COUNTRY_TREE_COUNT) {
          // Meadow cluster of 2-3 rounded Apple Maps trees
          const clusterCount = 2 + (h & 1);
          for (let t = 0; t < clusterCount && treeIdx < COUNTRY_TREE_COUNT; t++) {
            const ox = (((h >> (t * 4)) & 7) - 3.5) * 1.25;
            const oz = (((h >> (t * 4 + 10)) & 7) - 3.5) * 1.25;
            const tx = wx + ox;
            const tz = wz + oz;
            if (this.minDistSqToRoute(tx, tz) < 7.8 * 7.8 || this.minDistSqToRiver(tx, tz) < 5.6 * 5.6) {
              continue;
            }
            const ts = 0.88 + (((h >> (t * 3 + 18)) & 3) * 0.22);
            this.dummy.position.set(tx, 0.5 * ts, tz);
            this.dummy.rotation.set(0, 0, 0);
            this.dummy.scale.set(ts, ts, ts);
            this.dummy.updateMatrix();
            st.countryTreesTrunk.setMatrixAt(treeIdx, this.dummy.matrix);

            this.dummy.position.set(tx, 1.48 * ts, tz);
            this.dummy.scale.set(ts * 1.15, ts * 1.18, ts * 1.15);
            this.dummy.updateMatrix();
            st.countryTreesCrown.setMatrixAt(treeIdx, this.dummy.matrix);
            treeIdx++;
          }
        }
      }
    }

    this.dummy.position.set(0, -60, 0);
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.scale.set(0.01, 0.01, 0.01);
    this.dummy.updateMatrix();
    for (let i = hillIdx; i < COUNTRY_HILL_COUNT; i++) {
      st.countryHillsMesh.setMatrixAt(i, this.dummy.matrix);
      st.countryHillCapsMesh.setMatrixAt(i, this.dummy.matrix);
    }
    for (let i = treeIdx; i < COUNTRY_TREE_COUNT; i++) {
      st.countryTreesTrunk.setMatrixAt(i, this.dummy.matrix);
      st.countryTreesCrown.setMatrixAt(i, this.dummy.matrix);
    }
    for (let i = barnIdx; i < COUNTRY_COTTAGE_COUNT; i++) {
      st.countryBarnBodyMesh.setMatrixAt(i, this.dummy.matrix);
      st.countryBarnRoofMesh.setMatrixAt(i, this.dummy.matrix);
      st.countryBarnWindowMesh.setMatrixAt(i, this.dummy.matrix);
    }

    st.countryFenceMesh.instanceMatrix.needsUpdate = true;
    st.countryHillsMesh.instanceMatrix.needsUpdate = true;
    st.countryHillCapsMesh.instanceMatrix.needsUpdate = true;
    st.countryTreesTrunk.instanceMatrix.needsUpdate = true;
    st.countryTreesCrown.instanceMatrix.needsUpdate = true;
    st.countryBarnBodyMesh.instanceMatrix.needsUpdate = true;
    st.countryBarnRoofMesh.instanceMatrix.needsUpdate = true;
    st.countryBarnWindowMesh.instanceMatrix.needsUpdate = true;
  }

  private updateThreeScene(
    st: ThreeMapsState,
    route: BiomeRouteGraph,
    width: number,
    height: number,
    focalCenterX: number,
    timeSeconds: number,
    dt: number,
    audio: AudioFrameMetrics,
    reduceMotion: boolean,
    turnInfo: { direction: UpcomingTurnDirection; distanceMeters: number; streetName: string }
  ): void {
    const biome = this.env.biome;
    const timeOfDay = this.env.timeOfDay;
    const camSpec = BIOME_CAMERA_SPECS[biome];
    this.applyBiomeAndPaletteToThree(st, biome, timeOfDay);

    if (this.width !== width || this.height !== height) {
      this.width = width;
      this.height = height;
      st.renderer.setSize(width, height, false);
      st.camera.aspect = width / Math.max(1, height);
      st.camera.updateProjectionMatrix();
    }

    const travel = this.travelDistance;
    route.sampleAt(travel, this.tmpRouteSample);
    const targetX = this.tmpRouteSample.x;
    const targetZ = this.tmpRouteSample.z;
    const targetHeading = this.tmpRouteSample.heading;
    const bankGain = biome === 'highway' ? 2.4 : 1.65;
    const targetBank = Math.max(-0.14, Math.min(0.14, -this.tmpRouteSample.curvature * bankGain));

    // Smooth critically-damped sedan & orbiting chase-camera motion
    const carRate = 1 - Math.exp(-dt * 12.0);
    const chaseRate = 1 - Math.exp(-dt * (biome === 'highway' ? 5.2 : 4.4));
    this.smoothedCarX += (targetX - this.smoothedCarX) * carRate;
    this.smoothedCarZ += (targetZ - this.smoothedCarZ) * carRate;
    this.smoothedCarHeading += wrapAngle(targetHeading - this.smoothedCarHeading) * carRate;
    this.smoothedCarBank += (targetBank - this.smoothedCarBank) * carRate;
    this.chaseHeading += wrapAngle(this.smoothedCarHeading - this.chaseHeading) * chaseRate;

    const bounceY = reduceMotion
      ? 0
      : Math.abs(Math.sin(timeSeconds * 8.0)) * 0.025 + this.beatPulse * 0.045;
    st.carGroup.position.set(this.smoothedCarX, 0.04 + bounceY, this.smoothedCarZ);
    st.carGroup.rotation.set(0, -this.smoothedCarHeading, this.smoothedCarBank);

    // Blinking turn signals when approaching turn/curve
    const p = MAP_PALETTES[timeOfDay];
    const blinkOn = !reduceMotion && Math.sin(timeSeconds * 11.5) > 0;
    const signalLeft = turnInfo.direction === 'left' && turnInfo.distanceMeters <= 80 && blinkOn;
    const signalRight = turnInfo.direction === 'right' && turnInfo.distanceMeters <= 80 && blinkOn;
    st.carTurnLeftMat.color.setHex(signalLeft ? 0xffbf24 : 0x3b2a14);
    st.carTurnRightMat.color.setHex(signalRight ? 0xffbf24 : 0x3b2a14);

    // Beat-reactive taillight & Apple Maps blue GPS halo pulse
    const haloScale = 1.0 + this.beatPulse * 0.16 + (audio.bassEnergy ?? 0) * 0.08;
    st.carHaloMesh.scale.set(haloScale, haloScale, 1);
    st.carHaloMat.opacity = 0.36 + this.beatPulse * 0.24;
    this.tmpColor.setHex(0xff3b30);
    if (p.taillightIntensity > 0.5) {
      this.tmpColor.offsetHSL(0, 0, this.beatPulse * 0.12);
    }
    st.carTaillightMat.color.copy(this.tmpColor);

    // Orbiting 2.5D chase camera per biome + Split-View setViewOffset framing
    const camFov = camSpec.fov + (reduceMotion ? 0 : this.beatPulse * 1.35);
    if (Math.abs(st.camera.fov - camFov) > 0.05) {
      st.camera.fov = camFov;
      st.camera.updateProjectionMatrix();
    }
    if (Math.abs(focalCenterX - width * 0.5) > 1.0) {
      st.camera.setViewOffset(width, height, width * 0.5 - focalCenterX, 0, width, height);
    } else {
      st.camera.clearViewOffset();
    }

    const chaseTx = Math.sin(this.chaseHeading);
    const chaseTz = -Math.cos(this.chaseHeading);
    const camX = this.smoothedCarX - chaseTx * camSpec.distance;
    const camZ = this.smoothedCarZ - chaseTz * camSpec.distance;
    route.sampleAt(travel + camSpec.lookAhead, this.tmpRouteSampleB);
    const lookX =
      this.tmpRouteSampleB.x * 0.48 + (this.smoothedCarX + chaseTx * camSpec.lookAhead) * 0.52;
    const lookZ =
      this.tmpRouteSampleB.z * 0.48 + (this.smoothedCarZ + chaseTz * camSpec.lookAhead) * 0.52;

    st.camera.position.set(camX, camSpec.height, camZ);
    st.camera.lookAt(lookX, camSpec.lookY, lookZ);
    st.camera.updateMatrixWorld();

    // Keep ground plane centered beneath car (zero vertical seam)
    st.groundMesh.position.set(this.smoothedCarX, -0.02, this.smoothedCarZ);

    // Update curved 2D XZ road, shoulder, blue route, and countryside river ribbons
    this.updateRibbons2DXZ(st, route, biome, travel);

    // Lane dashes along curved 2D XZ road
    const dashStep = 5.4;
    const baseDash = Math.floor(Math.max(0, travel - ROAD_LOOK_BACK) / dashStep);
    let dashIdx = 0;
    const lanesPerRow = biome === 'highway' ? 3 : 2;
    const rowCount = Math.floor(LANE_DASH_COUNT / lanesPerRow);
    for (let i = 0; i < rowCount; i++) {
      const s = (baseDash + i) * dashStep;
      route.sampleAt(s, this.tmpRouteSample);
      const rx = -this.tmpRouteSample.tz;
      const rz = this.tmpRouteSample.tx;
      const yaw = -this.tmpRouteSample.heading;

      if (biome === 'highway') {
        for (let l = 0; l < 3 && dashIdx < LANE_DASH_COUNT; l++) {
          const off = HIGHWAY_LANE_OFFSETS[l];
          this.dummy.position.set(
            this.tmpRouteSample.x + rx * off,
            0.048,
            this.tmpRouteSample.z + rz * off
          );
          this.dummy.rotation.set(0, yaw, 0);
          this.dummy.scale.set(1, 1, 1.25);
          this.dummy.updateMatrix();
          st.laneDashMesh.setMatrixAt(dashIdx++, this.dummy.matrix);
        }
      } else if (biome === 'countryside') {
        // Subtle twin center-line dashes for scenic 2-lane road
        const off = 0.14;
        this.dummy.position.set(
          this.tmpRouteSample.x - rx * off,
          0.046,
          this.tmpRouteSample.z - rz * off
        );
        this.dummy.rotation.set(0, yaw, 0);
        this.dummy.scale.set(0.75, 1, 0.9);
        this.dummy.updateMatrix();
        st.laneDashMesh.setMatrixAt(dashIdx++, this.dummy.matrix);

        this.dummy.position.set(
          this.tmpRouteSample.x + rx * off,
          0.046,
          this.tmpRouteSample.z + rz * off
        );
        this.dummy.updateMatrix();
        st.laneDashMesh.setMatrixAt(dashIdx++, this.dummy.matrix);
      } else {
        const off = 1.75;
        this.dummy.position.set(
          this.tmpRouteSample.x - rx * off,
          0.048,
          this.tmpRouteSample.z - rz * off
        );
        this.dummy.rotation.set(0, yaw, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        st.laneDashMesh.setMatrixAt(dashIdx++, this.dummy.matrix);

        this.dummy.position.set(
          this.tmpRouteSample.x + rx * off,
          0.048,
          this.tmpRouteSample.z + rz * off
        );
        this.dummy.updateMatrix();
        st.laneDashMesh.setMatrixAt(dashIdx++, this.dummy.matrix);
      }
    }
    this.dummy.position.set(0, -60, 0);
    this.dummy.scale.set(0.01, 0.01, 0.01);
    this.dummy.updateMatrix();
    for (let i = dashIdx; i < LANE_DASH_COUNT; i++) {
      st.laneDashMesh.setMatrixAt(i, this.dummy.matrix);
    }
    st.laneDashMesh.instanceMatrix.needsUpdate = true;

    // Animated route chevrons gliding ahead along 2D spline
    const chevStep = 5.0;
    const chevPhase = (travel * 1.45) % chevStep;
    for (let i = 0; i < CHEVRON_COUNT; i++) {
      const s = travel + 2.4 + i * chevStep - chevPhase;
      route.sampleAt(Math.max(0, s), this.tmpRouteSample);
      const pulseScale = 0.88 + this.beatPulse * 0.22;
      this.dummy.position.set(this.tmpRouteSample.x, 0.072, this.tmpRouteSample.z);
      this.dummy.rotation.set(0, -this.tmpRouteSample.heading, 0);
      this.dummy.scale.set(pulseScale, 1, pulseScale);
      this.dummy.updateMatrix();
      st.chevronMesh.setMatrixAt(i, this.dummy.matrix);
    }
    st.chevronMesh.instanceMatrix.needsUpdate = true;

    // Populate route & river clearance corridor once for active biome
    this.sampleRouteClearance(route, travel, biome === 'countryside');

    if (biome === 'cityscape') {
      this.updateCityscapeThree(st, route, travel, timeSeconds, camX, camZ);
    } else if (biome === 'highway') {
      this.updateHighwayThree(st, route, travel, camX, camZ);
    } else {
      this.updateCountrysideThree(st, route, travel, camX, camZ);
    }

    st.renderer.render(st.scene, st.camera);
  }

  // -------------------------------------------------------------------------
  // Canvas2D 2.5D Perspective Software Fallback (All 3 Biomes x 3 Times, Zero-GC)
  // -------------------------------------------------------------------------

  private renderCanvas2DFallback(
    ctx: CanvasRenderingContext2D,
    route: BiomeRouteGraph,
    width: number,
    height: number,
    focalLeft: number,
    focalWidth: number,
    timeSeconds: number,
    dt: number,
    audio: AudioFrameMetrics,
    reduceMotion: boolean,
    turnInfo: { direction: UpcomingTurnDirection; distanceMeters: number; streetName: string }
  ): void {
    const biome = this.env.biome;
    const timeOfDay = this.env.timeOfDay;
    const p = MAP_PALETTES[timeOfDay];
    const camSpec = BIOME_CAMERA_SPECS[biome];
    const roadHalfW = camSpec.roadHalfW;
    const cx = focalLeft + focalWidth * 0.5;
    const horizonY = height * (biome === 'cityscape' ? 0.36 : biome === 'highway' ? 0.38 : 0.37);
    const travel = this.travelDistance;

    route.sampleAt(travel, this.tmpRouteSample);
    const carRate = 1 - Math.exp(-dt * 12.0);
    const chaseRate = 1 - Math.exp(-dt * (biome === 'highway' ? 5.2 : 4.4));
    this.smoothedCarX += (this.tmpRouteSample.x - this.smoothedCarX) * carRate;
    this.smoothedCarZ += (this.tmpRouteSample.z - this.smoothedCarZ) * carRate;
    this.smoothedCarHeading += wrapAngle(this.tmpRouteSample.heading - this.smoothedCarHeading) * carRate;
    this.smoothedCarBank +=
      (Math.max(-0.14, Math.min(0.14, -this.tmpRouteSample.curvature * 1.8)) -
        this.smoothedCarBank) *
      carRate;
    this.chaseHeading += wrapAngle(this.smoothedCarHeading - this.chaseHeading) * chaseRate;

    const chaseSin = Math.sin(this.chaseHeading);
    const chaseCos = Math.cos(this.chaseHeading);
    const camDist = camSpec.distance;
    const camX = this.smoothedCarX - chaseSin * camDist;
    const camZ = this.smoothedCarZ - chaseCos * camDist;
    const camHeight = camSpec.height;
    const focalLen = Math.min(focalWidth, height) * (biome === 'cityscape' ? 0.82 : 0.90);

    const worldToCamX = (wx: number, wz: number): number => {
      const dx = wx - camX;
      const dz = wz - camZ;
      return dx * chaseCos + dz * chaseSin;
    };
    const worldToCamDepth = (wx: number, wz: number): number => {
      const dx = wx - camX;
      const dz = wz - camZ;
      return dx * chaseSin - dz * chaseCos;
    };

    ctx.save();
    // 1. Full-bleed Sky / Horizon Gradient (zero vertical clip seam)
    const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY + 14);
    skyGrad.addColorStop(0, p.skyTop);
    skyGrad.addColorStop(0.55, p.skyMid);
    skyGrad.addColorStop(1, p.skyHorizon);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, width, horizonY + 14);

    if (timeOfDay === 'sunset') {
      const sunGrad = ctx.createRadialGradient(cx, horizonY, 8, cx, horizonY, focalWidth * 0.42);
      sunGrad.addColorStop(0, 'rgba(255, 224, 178, 0.78)');
      sunGrad.addColorStop(0.45, 'rgba(244, 162, 97, 0.32)');
      sunGrad.addColorStop(1, 'rgba(244, 162, 97, 0)');
      ctx.fillStyle = sunGrad;
      ctx.fillRect(0, 0, width, horizonY + 64);
    }

    // 2. Full-bleed Biome Ground Plane
    ctx.fillStyle =
      biome === 'countryside'
        ? p.countryGroundCss
        : biome === 'highway'
        ? p.highwayGroundCss
        : p.groundCss;
    ctx.fillRect(0, horizonY, width, height - horizonY);

    // 3. Project curved 2D XZ road ribbon into chase-camera screen coordinates
    for (let i = 0; i <= ROAD_SEGMENTS; i++) {
      const u = i / ROAD_SEGMENTS;
      const s = Math.max(0, travel - 4 + (1 - u) * 86);
      route.sampleAt(s, this.tmpRouteSample);
      const localX = worldToCamX(this.tmpRouteSample.x, this.tmpRouteSample.z);
      const depth = Math.max(2.6, worldToCamDepth(this.tmpRouteSample.x, this.tmpRouteSample.z));
      const sc = focalLen / depth;
      const sy = horizonY + camHeight * sc * 0.62;
      this.swCenterX[i] = cx + localX * sc;
      this.swLeftX[i] = cx + (localX - roadHalfW) * sc;
      this.swRightX[i] = cx + (localX + roadHalfW) * sc;
      this.swScreenY[i] = sy;
      this.swScale[i] = sc;
      this.swDepth[i] = depth;
    }

    // 4. Pre-road Biome Background Scenery (far to near)
    this.sampleRouteClearance(route, travel);

    if (biome === 'cityscape') {
      const CELL_STEP = 14.0;
      const baseGx = Math.round(this.smoothedCarX / CELL_STEP);
      const baseGz = Math.round(this.smoothedCarZ / CELL_STEP);
      for (let gzOff = CITY_GRID_RADIUS; gzOff >= -CITY_GRID_RADIUS; gzOff--) {
        for (let gxOff = -CITY_GRID_RADIUS; gxOff <= CITY_GRID_RADIUS; gxOff++) {
          const gx = baseGx + gxOff;
          const gz = baseGz + gzOff;
          const wx = gx * CELL_STEP;
          const wz = gz * CELL_STEP;
          const depth = worldToCamDepth(wx, wz);
          if (depth < 8.5 || depth > 95) continue;
          if (this.minDistSqToRoute(wx, wz) < 11.4 * 11.4) continue;

          const sc = focalLen / depth;
          const localX = worldToCamX(wx, wz);
          const sx = cx + localX * sc;
          const sy = horizonY + camHeight * sc * 0.62;
          if (sx < -120 || sx > width + 120 || sy > height + 60) continue;

          const h = hashUint(Math.imul(gx, 73856093) ^ Math.imul(gz, 19349663));
          const bw = (6.4 + ((h & 15) / 15) * 3.0) * sc;
          if (h % 6 === 0) {
            ctx.fillStyle = p.parkCss;
            ctx.fillRect(sx - bw * 0.55, sy - sc * 0.4, bw * 1.1, sc * 1.6);
            ctx.fillStyle = p.treeFoliageCss;
            ctx.beginPath();
            ctx.arc(sx, sy - sc * 1.1, Math.max(2.5, sc * 0.95), 0, Math.PI * 2);
            ctx.fill();
          } else {
            const bh = (5.0 + (((h >> 8) & 31) / 31) * 11.5) * sc;
            ctx.fillStyle = p.buildingCss;
            ctx.fillRect(sx - bw * 0.5, sy - bh, bw * 0.72, bh);
            ctx.fillStyle = p.buildingShadedCss;
            ctx.fillRect(sx + bw * 0.22, sy - bh, bw * 0.28, bh);
            ctx.fillStyle = p.buildingRoofCss;
            ctx.fillRect(sx - bw * 0.46, sy - bh - sc * 0.2, bw * 0.92, Math.max(1.5, sc * 0.24));
            if (p.windowGlow > 0.05 && bh > 12) {
              ctx.fillStyle =
                timeOfDay === 'sunset' ? 'rgba(253, 230, 138, 0.45)' : 'rgba(226, 232, 240, 0.36)';
              ctx.fillRect(sx - bw * 0.36, sy - bh * 0.68, bw * 0.52, Math.max(1.4, sc * 0.14));
              ctx.fillRect(sx - bw * 0.36, sy - bh * 0.38, bw * 0.52, Math.max(1.4, sc * 0.14));
            }
          }
        }
      }
    } else if (biome === 'countryside') {
      // Curved river bend along right side of scenic road
      ctx.fillStyle = p.waterCss;
      ctx.beginPath();
      for (let i = 0; i <= ROAD_SEGMENTS; i++) {
        const sc = this.swScale[i];
        const rx = this.swRightX[i] + sc * (3.8 + Math.sin(i * 0.24 + travel * 0.05) * 1.4);
        if (i === 0) ctx.moveTo(rx, this.swScreenY[i]);
        else ctx.lineTo(rx, this.swScreenY[i]);
      }
      for (let i = ROAD_SEGMENTS; i >= 0; i--) {
        const sc = this.swScale[i];
        const rx = this.swRightX[i] + sc * (10.4 + Math.sin(i * 0.24 + travel * 0.05) * 1.4);
        ctx.lineTo(rx, this.swScreenY[i]);
      }
      ctx.closePath();
      ctx.fill();

      // Rolling terraced low-poly hills, rounded Apple Maps trees, cottages & wooden fences
      for (let i = 2; i < ROAD_SEGMENTS; i += 4) {
        const sc = this.swScale[i];
        const sy = this.swScreenY[i];
        const hW = sc * 8.4;
        const hH = sc * 3.1;
        ctx.fillStyle = p.hillCss;
        ctx.beginPath();
        ctx.ellipse(this.swLeftX[i] - sc * 9.5, sy, hW, hH, 0, Math.PI, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = p.hillTopCss;
        ctx.beginPath();
        ctx.ellipse(this.swLeftX[i] - sc * 9.5, sy - hH * 0.45, hW * 0.58, hH * 0.52, 0, Math.PI, Math.PI * 2);
        ctx.fill();

        // Cozy distant cottage/barn every third step
        if (i % 12 === 2) {
          const bx = this.swLeftX[i] - sc * 6.4;
          const bw = sc * 2.5;
          const bh = sc * 1.65;
          ctx.fillStyle = p.barnCss;
          ctx.fillRect(bx - bw * 0.5, sy - bh, bw, bh);
          ctx.fillStyle = p.barnRoofCss;
          ctx.beginPath();
          ctx.moveTo(bx - bw * 0.62, sy - bh);
          ctx.lineTo(bx, sy - bh - sc * 1.0);
          ctx.lineTo(bx + bw * 0.62, sy - bh);
          ctx.closePath();
          ctx.fill();
        }

        // Rounded Apple Maps tree clusters
        const trR = Math.max(2.5, sc * 1.05);
        ctx.fillStyle = p.treeFoliageCss;
        ctx.beginPath();
        ctx.arc(this.swLeftX[i] - sc * 3.1, sy - trR * 1.25, trR, 0, Math.PI * 2);
        ctx.arc(this.swLeftX[i] - sc * 4.4, sy - trR * 1.0, trR * 0.85, 0, Math.PI * 2);
        ctx.arc(this.swRightX[i] + sc * 2.4, sy - trR * 1.15, trR * 0.92, 0, Math.PI * 2);
        ctx.fill();

        // Roadside wooden fence posts
        ctx.fillStyle = p.fenceCss;
        ctx.fillRect(this.swLeftX[i] - sc * 1.25, sy - sc * 0.65, Math.max(1.5, sc * 0.22), sc * 0.65);
        ctx.fillRect(this.swRightX[i] + sc * 1.05, sy - sc * 0.65, Math.max(1.5, sc * 0.22), sc * 0.65);
      }
    } else {
      // Highway: wooded Apple Maps shoulders flanking curved expressway
      for (let i = 2; i < ROAD_SEGMENTS; i += 3) {
        const sc = this.swScale[i];
        const sy = this.swScreenY[i];
        const trR = Math.max(2.5, sc * 1.12);
        ctx.fillStyle = p.treeFoliageCss;
        ctx.beginPath();
        ctx.arc(this.swLeftX[i] - sc * 3.0, sy - trR * 1.3, trR, 0, Math.PI * 2);
        ctx.arc(this.swLeftX[i] - sc * 5.2, sy - trR * 1.1, trR * 0.9, 0, Math.PI * 2);
        ctx.arc(this.swRightX[i] + sc * 3.0, sy - trR * 1.3, trR, 0, Math.PI * 2);
        ctx.arc(this.swRightX[i] + sc * 5.2, sy - trR * 1.1, trR * 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 5. Curved Road Shoulder & Asphalt Polygon
    ctx.fillStyle = p.shoulderCss;
    ctx.beginPath();
    for (let i = 0; i <= ROAD_SEGMENTS; i++) {
      const shW = this.swScale[i] * camSpec.shoulderExtraW;
      if (i === 0) ctx.moveTo(this.swLeftX[i] - shW, this.swScreenY[i]);
      else ctx.lineTo(this.swLeftX[i] - shW, this.swScreenY[i]);
    }
    for (let i = ROAD_SEGMENTS; i >= 0; i--) {
      const shW = this.swScale[i] * camSpec.shoulderExtraW;
      ctx.lineTo(this.swRightX[i] + shW, this.swScreenY[i]);
    }
    ctx.closePath();
    ctx.fill();

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
      const rw = this.swScale[i] * camSpec.routeHalfW;
      if (i === 0) ctx.moveTo(this.swCenterX[i] - rw, this.swScreenY[i]);
      else ctx.lineTo(this.swCenterX[i] - rw, this.swScreenY[i]);
    }
    for (let i = ROAD_SEGMENTS; i >= 0; i--) {
      const rw = this.swScale[i] * camSpec.routeHalfW;
      ctx.lineTo(this.swCenterX[i] + rw, this.swScreenY[i]);
    }
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = p.routeGlowCss;
    ctx.beginPath();
    for (let i = 0; i <= ROAD_SEGMENTS; i++) {
      const rw = this.swScale[i] * (camSpec.routeHalfW * 0.42);
      if (i === 0) ctx.moveTo(this.swCenterX[i] - rw, this.swScreenY[i]);
      else ctx.lineTo(this.swCenterX[i] - rw, this.swScreenY[i]);
    }
    for (let i = ROAD_SEGMENTS; i >= 0; i--) {
      const rw = this.swScale[i] * (camSpec.routeHalfW * 0.42);
      ctx.lineTo(this.swCenterX[i] + rw, this.swScreenY[i]);
    }
    ctx.closePath();
    ctx.fill();

    // Dashed lane dividers
    ctx.strokeStyle = p.laneDashCss;
    ctx.lineWidth = 2;
    const dashShift = Math.floor((travel * 0.7) % 4);
    for (let i = 2 + dashShift; i < ROAD_SEGMENTS - 2; i += 4) {
      const sc = this.swScale[i];
      const scNext = this.swScale[i + 2];
      const laneFrac = biome === 'countryside' ? 0.05 : 0.52;
      const off = sc * (roadHalfW * laneFrac);
      const offNext = scNext * (roadHalfW * laneFrac);
      ctx.beginPath();
      ctx.moveTo(this.swCenterX[i] - off, this.swScreenY[i]);
      ctx.lineTo(this.swCenterX[i + 2] - offNext, this.swScreenY[i + 2]);
      ctx.moveTo(this.swCenterX[i] + off, this.swScreenY[i]);
      ctx.lineTo(this.swCenterX[i + 2] + offNext, this.swScreenY[i + 2]);
      ctx.stroke();
    }

    // Highway elevated white-railed overpasses & green overhead gantry signs spanning the road
    if (biome === 'highway') {
      const opIdx = Math.min(ROAD_SEGMENTS - 8, 22 + Math.floor((travel * 0.45) % 24));
      const sc = this.swScale[opIdx];
      const sy = this.swScreenY[opIdx];
      const deckY = sy - sc * 4.8;
      const spanW = (this.swRightX[opIdx] - this.swLeftX[opIdx]) * 2.1;
      const deckX = this.swCenterX[opIdx] - spanW * 0.5;
      const deckH = Math.max(4, sc * 0.85);

      ctx.fillStyle = p.overpassCss;
      ctx.fillRect(this.swLeftX[opIdx] - sc * 2.2, deckY, Math.max(3, sc * 0.9), sy - deckY);
      ctx.fillRect(this.swRightX[opIdx] + sc * 1.3, deckY, Math.max(3, sc * 0.9), sy - deckY);
      ctx.fillRect(deckX, deckY, spanW, deckH);
      ctx.fillStyle = p.overpassRailCss;
      ctx.fillRect(deckX, deckY - Math.max(2, sc * 0.28), spanW, Math.max(2, sc * 0.28));

      // Overhead green interstate gantry sign closer ahead
      const signIdx = Math.min(ROAD_SEGMENTS - 4, 42 + Math.floor((travel * 0.45) % 18));
      const ssc = this.swScale[signIdx];
      const ssy = this.swScreenY[signIdx];
      const gY = ssy - ssc * 4.6;
      const boardW = Math.max(42, ssc * 6.4);
      const boardH = Math.max(14, ssc * 2.1);
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = Math.max(1.5, ssc * 0.22);
      ctx.beginPath();
      ctx.moveTo(this.swLeftX[signIdx] - ssc * 0.8, ssy);
      ctx.lineTo(this.swLeftX[signIdx] - ssc * 0.8, gY);
      ctx.lineTo(this.swRightX[signIdx] + ssc * 0.8, gY);
      ctx.lineTo(this.swRightX[signIdx] + ssc * 0.8, ssy);
      ctx.stroke();

      drawRoundedRectPath(
        ctx,
        this.swCenterX[signIdx] - boardW * 0.5,
        gY - boardH * 0.45,
        boardW,
        boardH,
        4
      );
      ctx.fillStyle = '#0c6b43';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // 7. Sleek White Low-Poly CarPlay Sedan + Turning Yaw + Route Shield Pill
    const carY = height * 0.76;
    const carBob = reduceMotion ? 0 : Math.sin(timeSeconds * 7.5) * 1.3 - this.beatPulse * 2.2;
    const carRelYaw = wrapAngle(this.smoothedCarHeading - this.chaseHeading);
    const carTilt = Math.max(-0.24, Math.min(0.24, carRelYaw * 0.55 + this.smoothedCarBank * 0.6));
    const carW = Math.max(38, Math.min(60, focalWidth * 0.058));
    const carH = carW * 0.58;

    ctx.save();
    ctx.translate(cx, carY + carBob);
    ctx.rotate(carTilt);

    const haloR = carW * (0.86 + this.beatPulse * 0.14 + (audio.bassEnergy ?? 0) * 0.08);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.24)';
    ctx.beginPath();
    ctx.ellipse(0, carH * 0.26, haloR, haloR * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();

    if (p.headlightIntensity > 0.05) {
      const beamGrad = ctx.createLinearGradient(0, -carH * 0.4, 0, -carH * 3.1);
      beamGrad.addColorStop(
        0,
        `rgba(255, 248, 214, ${(0.32 * p.headlightIntensity).toFixed(3)})`
      );
      beamGrad.addColorStop(1, 'rgba(255, 248, 214, 0)');
      ctx.fillStyle = beamGrad;
      ctx.beginPath();
      ctx.moveTo(-carW * 0.36, -carH * 0.35);
      ctx.lineTo(-carW * 1.15, -carH * 3.0);
      ctx.lineTo(carW * 1.15, -carH * 3.0);
      ctx.lineTo(carW * 0.36, -carH * 0.35);
      ctx.closePath();
      ctx.fill();
    }

    drawRoundedRectPath(ctx, -carW * 0.5, -carH * 0.32, carW, carH * 0.62, 7);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();

    drawRoundedRectPath(ctx, -carW * 0.38, -carH * 0.64, carW * 0.76, carH * 0.44, 6);
    ctx.fillStyle = '#0f172a';
    ctx.fill();

    drawRoundedRectPath(ctx, -carW * 0.31, -carH * 0.62, carW * 0.62, carH * 0.2, 4);
    ctx.fillStyle = '#e2e8f0';
    ctx.fill();

    ctx.fillStyle = '#ff3b30';
    drawRoundedRectPath(ctx, -carW * 0.44, -carH * 0.14, carW * 0.22, carH * 0.16, 2);
    ctx.fill();
    drawRoundedRectPath(ctx, carW * 0.22, -carH * 0.14, carW * 0.22, carH * 0.16, 2);
    ctx.fill();

    const blinkOn = !reduceMotion && Math.sin(timeSeconds * 11.5) > 0;
    if (turnInfo.direction === 'left' && turnInfo.distanceMeters <= 80 && blinkOn) {
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(-carW * 0.5, -carH * 0.14, carW * 0.1, carH * 0.14);
    } else if (turnInfo.direction === 'right' && turnInfo.distanceMeters <= 80 && blinkOn) {
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(carW * 0.4, -carH * 0.14, carW * 0.1, carH * 0.14);
    }

    ctx.restore();

    // Road-anchored route shield pill cleanly behind sedan
    const pillW = 68;
    const pillH = 22;
    const pillY = carY + carH * 0.72;
    drawRoundedRectPath(ctx, cx - pillW * 0.5, pillY, pillW, pillH, 8);
    ctx.fillStyle = '#0A84FF';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = "800 11px 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(camSpec.shieldLabel, cx, pillY + pillH * 0.5 + 0.5);

    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // 3D World-Space Road Callouts & Circular POI Milestone Pins
  // -------------------------------------------------------------------------

  private drawProjectedMilestones(
    ctx: CanvasRenderingContext2D,
    route: BiomeRouteGraph,
    width: number,
    height: number,
    focalLeft: number,
    focalWidth: number,
    timeSeconds: number
  ): void {
    if (this.milestones.length === 0) return;

    const biome = this.env.biome;
    const p = MAP_PALETTES[this.env.timeOfDay];
    const camSpec = BIOME_CAMERA_SPECS[biome];
    const travel = this.travelDistance;
    const cx = focalLeft + focalWidth * 0.5;
    const horizonY = height * (biome === 'cityscape' ? 0.36 : biome === 'highway' ? 0.38 : 0.37);
    const focalLen = Math.min(focalWidth, height) * (biome === 'cityscape' ? 0.82 : 0.90);
    const st = this.threeActive ? this.threeState : null;
    const chaseSin = Math.sin(this.chaseHeading);
    const chaseCos = Math.cos(this.chaseHeading);
    const camX = this.smoothedCarX - chaseSin * camSpec.distance;
    const camZ = this.smoothedCarZ - chaseCos * camSpec.distance;

    let count = 0;
    for (let i = 0; i < this.milestones.length && count < MAX_PROJECTED_CALLOUTS; i++) {
      const m = this.milestones[i];
      const dtToTrigger = m.triggerSec - timeSeconds;
      if (dtToTrigger < -1.1 || dtToTrigger > 4.4) continue;

      const sAlong = Math.max(0, travel + 2.5 + dtToTrigger * 12.5 * camSpec.speedScale);
      route.sampleAt(sAlong, this.tmpRouteSample);
      const rx = -this.tmpRouteSample.tz;
      const rz = this.tmpRouteSample.tx;
      const sideOffset = m.sideSign * (camSpec.roadHalfW + 2.6);
      const worldX = this.tmpRouteSample.x + rx * sideOffset;
      const worldZ = this.tmpRouteSample.z + rz * sideOffset;
      const worldY = m.isExitBubble ? 2.6 : 2.1;

      let sx = 0;
      let sy = 0;
      let sc = 1;
      if (st) {
        this.tmpVec.set(worldX, worldY, worldZ);
        this.tmpVec.project(st.camera);
        if (this.tmpVec.z > 1.0 || this.tmpVec.z < -1.0) continue;
        sx = (this.tmpVec.x * 0.5 + 0.5) * width;
        sy = (-this.tmpVec.y * 0.5 + 0.5) * height;
        const dist = Math.hypot(worldX - camX, worldZ - camZ);
        sc = clamp01(1 - dist / 74) * 0.52 + 0.56;
      } else {
        const dx = worldX - camX;
        const dz = worldZ - camZ;
        const depth = dx * chaseSin - dz * chaseCos;
        if (depth < 4.0 || depth > 72.0) continue;
        const localX = dx * chaseCos + dz * chaseSin;
        const persp = focalLen / depth;
        sx = cx + localX * persp;
        sy = horizonY + (camSpec.height - worldY) * persp * 0.62;
        sc = clamp01(1 - depth / 66) * 0.52 + 0.56;
      }

      if (sx < focalLeft + 44 || sx > focalLeft + focalWidth - 44) continue;
      if (sy < 185 || sy > height - 96) continue;

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
        ctx.font = "700 12px 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif";
        const labelW = Math.min(168, Math.max(84, ctx.measureText(m.label).width + 26));
        const pillH = 28;
        const px = -labelW * 0.5;
        const py = -pillH - 10;

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

        drawRoundedRectPath(ctx, px, py, labelW, pillH, 14);
        ctx.fillStyle = p.calloutBg;
        ctx.fill();
        ctx.strokeStyle = p.calloutBorder;
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.fillStyle = m.badgeColor;
        ctx.beginPath();
        ctx.arc(px + 12, py + pillH * 0.5, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = p.calloutText;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(m.label, px + 21, py + pillH * 0.5, labelW - 28);
      } else {
        ctx.fillStyle = m.badgeColor;
        ctx.beginPath();
        ctx.arc(0, -12, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

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
        : 108;

    this.syncEnvironmentAndMilestones(track, lyrics, bpm, palette, scenePref, timePref);

    const biome = this.env.biome;
    const camSpec = BIOME_CAMERA_SPECS[biome];
    const route = this.routes[biome];

    const dt = Math.max(0.001, Math.min(0.05, Number.isFinite(deltaSeconds) ? deltaSeconds : 0.016));
    const biomeSwitched = this.activePoseBiome !== biome;
    if (
      didSeek ||
      biomeSwitched ||
      this.lastTimeSec < 0 ||
      Math.abs(timeSeconds - this.lastTimeSec) > 1.5
    ) {
      this.travelDistance = Math.max(0, timeSeconds * 10.5 * camSpec.speedScale);
      route.sampleAt(this.travelDistance, this.tmpRouteSample);
      this.smoothedCarX = this.tmpRouteSample.x;
      this.smoothedCarZ = this.tmpRouteSample.z;
      this.smoothedCarHeading = this.tmpRouteSample.heading;
      this.smoothedCarBank = 0;
      this.chaseHeading = this.tmpRouteSample.heading;
      this.activePoseBiome = biome;
    } else if (!reduceMotion) {
      const baseSpeed = (bpm / 100) * 10.2 * camSpec.speedScale;
      const surge = audio.isDownbeat ? 2.4 : audio.beatDetected ? 1.2 : 0;
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

    const turnInfo = route.findUpcomingTurn(this.travelDistance);
    if (
      this.env.upcomingTurn !== turnInfo.direction ||
      this.env.distanceToTurnMeters !== turnInfo.distanceMeters ||
      this.env.upcomingStreetName !== turnInfo.streetName ||
      this.env.routeShieldLabel !== camSpec.shieldLabel
    ) {
      this.env = {
        biome,
        timeOfDay: this.env.timeOfDay,
        cameraDistance: camSpec.distance,
        cameraHeight: camSpec.height,
        cameraFov: camSpec.fov,
        upcomingTurn: turnInfo.direction,
        distanceToTurnMeters: turnInfo.distanceMeters,
        upcomingStreetName: turnInfo.streetName,
        routeShieldLabel: camSpec.shieldLabel,
      };
    }

    const focalCenterX = focalLeft + focalWidth * 0.5;
    this.ensureThreeInitialized();

    if (this.threeActive && this.threeState) {
      this.updateThreeScene(
        this.threeState,
        route,
        safeW,
        safeH,
        focalCenterX,
        timeSeconds,
        dt,
        audio,
        reduceMotion,
        turnInfo
      );
      if (typeof ctx.drawImage === 'function') {
        ctx.drawImage(this.threeState.canvas, 0, 0, safeW, safeH);
      }
    } else {
      this.renderCanvas2DFallback(
        ctx,
        route,
        safeW,
        safeH,
        focalLeft,
        focalWidth,
        timeSeconds,
        dt,
        audio,
        reduceMotion,
        turnInfo
      );
    }

    this.drawProjectedMilestones(ctx, route, safeW, safeH, focalLeft, focalWidth, timeSeconds);

    return this.env;
  }
}
