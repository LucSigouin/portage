/**
 * Pure world functions shared by the simulation and rendering, so the canoe
 * sits on the water you see and feet stand on the ground you see.
 */
import type { IslandDefinition, IslandId, RegionDefinition } from '../data/types.ts';
import { HULL_TIERS } from '../data/canoe.ts';
import { TUNING } from '../data/tuning.ts';
import {
  ISLANDS, ISLANDS_BY_ID, REGIONS, VALLEY_HALF_WIDTH, VALLEY_NORTH_SHORE_Z, VALLEY_SOUTH_SHORE_Z,
  WAVE_TABLE, spotPosition,
} from '../data/world.ts';
import type { Vector3 } from './types.ts';

const smoothstep = (value: number): number => {
  const clamped = value <= 0 ? 0 : value >= 1 ? 1 : value;
  return clamped * clamped * (3 - 2 * clamped);
};

// --- Water ------------------------------------------------------------------

/**
 * Height of the water surface above rest level, metres.
 *
 *   roughness * sum_i amplitude_i * sin(wavenumber_i * (directionX_i * x + directionZ_i * z)
 *                                       - angularFrequency_i * time + phase_i)
 *
 * with the components of `WAVE_TABLE`. A shader that evaluates the same sum
 * matches this function exactly. `roughness` comes from `waterRoughnessAt`.
 */
export function waveHeight(x: number, z: number, time: number, roughness: number): number {
  let height = 0;
  for (const component of WAVE_TABLE) {
    const phase = component.wavenumber * (component.directionX * x + component.directionZ * z)
      - component.angularFrequency * time + component.phase;
    height += component.amplitude * Math.sin(phase);
  }
  return roughness * height;
}

/** Slope of the water surface: (d height / dx, d height / dz). */
export function waveGradient(x: number, z: number, time: number, roughness: number): { x: number; z: number } {
  let gradientX = 0;
  let gradientZ = 0;
  for (const component of WAVE_TABLE) {
    const phase = component.wavenumber * (component.directionX * x + component.directionZ * z)
      - component.angularFrequency * time + component.phase;
    const slope = component.amplitude * component.wavenumber * Math.cos(phase);
    gradientX += slope * component.directionX;
    gradientZ += slope * component.directionZ;
  }
  return { x: roughness * gradientX, z: roughness * gradientZ };
}

/** Unit normal of the water surface. */
export function waveNormal(x: number, z: number, time: number, roughness: number): Vector3 {
  const gradient = waveGradient(x, z, time, roughness);
  const length = Math.hypot(gradient.x, 1, gradient.z);
  return { x: -gradient.x / length, y: 1 / length, z: -gradient.z / length };
}

// --- Regions ----------------------------------------------------------------

/** The region band a point lies in. Regions depend on z only. */
export function regionAt(_x: number, z: number): RegionDefinition {
  for (const region of REGIONS) {
    if (z > region.northEdgeZ && z <= region.southEdgeZ) return region;
  }
  return z > 0 ? REGIONS[0] : REGIONS[REGIONS.length - 1];
}

/**
 * How far into the rougher side of its southern boundary a point is, 0 to 1.
 * Roughness and current ramp with this, so the water ahead visibly changes.
 */
function boundaryBlend(region: RegionDefinition, z: number): number {
  return smoothstep((region.southEdgeZ - z) / TUNING.world.regionBlendMetres);
}

/** Region roughness without weather. Ramps up just inside a rougher region. */
export function baseRoughnessAt(x: number, z: number): number {
  const region = regionAt(x, z);
  const index = REGIONS.indexOf(region);
  const southern = index > 0 ? REGIONS[index - 1] : null;
  if (!southern || southern.roughness >= region.roughness) return region.roughness;
  return southern.roughness + (region.roughness - southern.roughness) * boundaryBlend(region, z);
}

/**
 * Water roughness with weather: region roughness plus the storm bonus.
 * `stormLevel` is `state.weather.stormLevel` (0 to 1).
 */
export function waterRoughnessAt(x: number, z: number, stormLevel: number): number {
  return baseRoughnessAt(x, z) + stormLevel;
}

/** Water current at a point, metres per second. */
export function currentAt(x: number, z: number): { x: number; z: number } {
  const region = regionAt(x, z);
  if (region.current.x === 0 && region.current.z === 0) return { x: 0, z: 0 };
  const fade = Math.min(
    boundaryBlend(region, z),
    smoothstep((z - region.northEdgeZ) / TUNING.world.regionBlendMetres),
  );
  return { x: region.current.x * fade, z: region.current.z * fade };
}

// --- Terrain ----------------------------------------------------------------

interface IslandShape {
  definition: IslandDefinition;
  cosine: number;
  sine: number;
  /** Beyond this distance on either axis the island cannot matter. */
  reach: number;
}

const SHELF_OUTER = 1 + TUNING.world.shelfWidth;

const ISLAND_SHAPES: IslandShape[] = ISLANDS.map((definition) => ({
  definition,
  cosine: Math.cos(definition.rotation),
  sine: Math.sin(definition.rotation),
  reach: Math.max(definition.radiusX, definition.radiusZ) * SHELF_OUTER,
}));

/** Half-width of the flooded valley floor at z. */
export function valleyHalfWidth(z: number): number {
  const points = VALLEY_HALF_WIDTH;
  if (z <= points[0].z) return points[0].halfWidth;
  for (let index = 1; index < points.length; index += 1) {
    const upper = points[index];
    if (z <= upper.z) {
      const lower = points[index - 1];
      return lower.halfWidth + (upper.halfWidth - lower.halfWidth) * smoothstep((z - lower.z) / (upper.z - lower.z));
    }
  }
  return points[points.length - 1].halfWidth;
}

/** Squared elliptical distance from an island centre. 1 is the shoreline. */
function islandDistanceSquared(shape: IslandShape, x: number, z: number): number {
  const offsetX = x - shape.definition.center.x;
  const offsetZ = z - shape.definition.center.z;
  const along = (offsetX * shape.cosine + offsetZ * shape.sine) / shape.definition.radiusX;
  const across = (-offsetX * shape.sine + offsetZ * shape.cosine) / shape.definition.radiusZ;
  return along * along + across * across;
}

/**
 * Ground height at a point, metres. Negative is under water. Built from the
 * island table (domed islands with an underwater shelf), the seabed, and the
 * valley walls that close the lake.
 */
export function terrainHeight(x: number, z: number): number {
  const seabed = -TUNING.world.seabedDepth;
  const shoreDistance = Math.max(Math.abs(x) - valleyHalfWidth(z), z - VALLEY_SOUTH_SHORE_Z, VALLEY_NORTH_SHORE_Z - z);
  let height = Math.max(seabed, shoreDistance * TUNING.world.valleyWallSlope);
  for (const shape of ISLAND_SHAPES) {
    const center = shape.definition.center;
    if (Math.abs(x - center.x) > shape.reach || Math.abs(z - center.z) > shape.reach) continue;
    const distanceSquared = islandDistanceSquared(shape, x, z);
    if (distanceSquared >= SHELF_OUTER * SHELF_OUTER) continue;
    let islandHeight: number;
    if (distanceSquared <= 1) {
      const dome = 1 - distanceSquared;
      const bump = TUNING.world.bumpHeight * Math.sin(x * 0.21 + z * 0.13) * Math.sin(z * 0.17 - x * 0.09);
      islandHeight = dome * (shape.definition.peakHeight + bump);
    } else {
      islandHeight = seabed * smoothstep((Math.sqrt(distanceSquared) - 1) / TUNING.world.shelfWidth);
    }
    if (islandHeight > height) height = islandHeight;
  }
  return height;
}

/** The island a point is on or right beside (inside 1.2 radii), or null. */
export function islandAt(x: number, z: number): IslandId | null {
  let best: IslandId | null = null;
  let bestDistance = 1.2 * 1.2;
  for (const shape of ISLAND_SHAPES) {
    const distanceSquared = islandDistanceSquared(shape, x, z);
    if (distanceSquared < bestDistance) {
      bestDistance = distanceSquared;
      best = shape.definition.id;
    }
  }
  return best;
}

/** The island whose shoreline is closest to a point. */
export function nearestIsland(x: number, z: number): IslandId {
  let best = ISLAND_SHAPES[0];
  let bestDistance = Infinity;
  for (const shape of ISLAND_SHAPES) {
    const distance = (Math.sqrt(islandDistanceSquared(shape, x, z)) - 1) * Math.min(shape.definition.radiusX, shape.definition.radiusZ);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = shape;
    }
  }
  return best.definition.id;
}

// --- Bearings ---------------------------------------------------------------

/** Unit vector for a bearing: (sin, -cos). Bearing 0 points north (-z). */
export function bearingVector(bearing: number): { x: number; z: number } {
  return { x: Math.sin(bearing), z: -Math.cos(bearing) };
}

/** Bearing from one point to another, radians in (-PI, PI]. */
export function bearingBetween(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(toX - fromX, -(toZ - fromZ));
}

/** Smallest signed difference between two bearings, in (-PI, PI]. */
export function bearingDifference(target: number, current: number): number {
  let difference = (target - current) % (2 * Math.PI);
  if (difference > Math.PI) difference -= 2 * Math.PI;
  if (difference <= -Math.PI) difference += 2 * Math.PI;
  return difference;
}

// --- Landings ---------------------------------------------------------------

export interface Landing {
  /** Point on the shoreline. */
  shore: { x: number; z: number };
  /** Point in deep water straight off the beach. */
  approach: { x: number; z: number };
  /** Bearing from the approach point to the shore. */
  bearing: number;
}

/** The landing beach of an island. */
export function islandLanding(islandId: IslandId): Landing {
  const definition = ISLANDS_BY_ID[islandId];
  const shore = spotPosition(definition, definition.landing);
  const approach = spotPosition(definition, {
    along: definition.landing.along * 1.5,
    across: definition.landing.across * 1.5,
  });
  return { shore, approach, bearing: bearingBetween(approach.x, approach.z, shore.x, shore.z) };
}

/**
 * How far the hull sits into the ground: the highest ground under the bow,
 * centre and stern plus the draft. At or below 0 the canoe floats free.
 */
export function hullGrounding(x: number, z: number, heading: number, hullTier: number): number {
  const dimensions = HULL_TIERS[hullTier].dimensions;
  const forward = bearingVector(heading);
  const reach = dimensions.length / 2 - 0.2;
  const ground = Math.max(
    terrainHeight(x + forward.x * reach, z + forward.z * reach),
    terrainHeight(x, z),
    terrainHeight(x - forward.x * reach, z - forward.z * reach),
  );
  return ground + dimensions.draft;
}

/** Where a canoe run straight up an island's landing beach comes to rest. */
export function landingBerth(islandId: IslandId, hullTier: number): { x: number; z: number; heading: number } {
  const landing = islandLanding(islandId);
  const forward = bearingVector(landing.bearing);
  const distance = Math.hypot(landing.shore.x - landing.approach.x, landing.shore.z - landing.approach.z);
  let berthX = landing.approach.x;
  let berthZ = landing.approach.z;
  for (let travelled = 0; travelled <= distance; travelled += 0.2) {
    const x = landing.approach.x + forward.x * travelled;
    const z = landing.approach.z + forward.z * travelled;
    if (hullGrounding(x, z, landing.bearing, hullTier) > 0) break;
    berthX = x;
    berthZ = z;
  }
  return { x: berthX, z: berthZ, heading: landing.bearing };
}

/**
 * Nearest spot a person can stand, searching rings around a point. Used to
 * step out of the canoe. Returns null when nothing is in reach.
 */
export function findStandingSpot(x: number, z: number, reach: number): { x: number; z: number } | null {
  const maximumDepth = -TUNING.foot.disembarkDepth;
  if (terrainHeight(x, z) >= maximumDepth) return { x, z };
  for (let radius = 0.5; radius <= reach + 1e-9; radius += 0.5) {
    let best: { x: number; z: number } | null = null;
    let bestHeight = maximumDepth;
    for (let step = 0; step < 16; step += 1) {
      const angle = (step / 16) * 2 * Math.PI;
      const candidateX = x + Math.sin(angle) * radius;
      const candidateZ = z - Math.cos(angle) * radius;
      const height = terrainHeight(candidateX, candidateZ);
      if (height >= bestHeight) {
        bestHeight = height;
        best = { x: candidateX, z: candidateZ };
      }
    }
    if (best) return best;
  }
  return null;
}
