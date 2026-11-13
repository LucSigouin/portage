/**
 * What a walker cannot pass through on the islands (Luc's list, line 1): the trees, the rocks and the landmarks.
 *
 * - Trees and boulders: the very placements the look draws (`sim/scatter.ts`), a trunk or a stone each.
 * - Crags on the high ground, skerries and drowned snags in the shallows, the great pine over Home Knoll's camp:
 *   the look's dressing (`look/world/dressing.ts`), placed here by the same seeded rules. A test holds the two.
 * - Landmarks: their footprints, measured from the drawings (`data/footprints.ts`).
 *
 * Built once, the first time anything asks, and filed in a coarse grid, so the question "is a body standing here
 * in something?" costs a handful of comparisons: four players, every step. The answer depends on the place alone,
 * never on the state, so a guest's own screen (`net/walk.ts`) gets the same answer as the host.
 */
import type { IslandDefinition, IslandId, LandmarkKind } from '../data/types.ts';
import { LANDMARK_FOOTPRINTS } from '../data/footprints.ts';
import type { Footprint } from '../data/footprints.ts';
import { FOOTPRINT_CELL } from '../data/footprints.ts';
import { floraMixFor, floraPresetFor } from '../data/flora.ts';
import { TUNING } from '../data/tuning.ts';
import { ISLANDS, REGIONS_BY_ID, START, spotPosition } from '../data/world.ts';
import { hashText, keepOutCircles, scatterIsland, seededRandom, shoreLength } from './scatter.ts';
import type { Placement } from './scatter.ts';
import { terrainHeight } from './world.ts';

/** A solid circle on the ground, world metres. */
export interface SolidCircle {
  x: number;
  z: number;
  radius: number;
  /** What it is, for the tests and the debug view. */
  kind: string;
  islandId: IslandId;
}

/** One landmark's footprint where the island table puts it. */
export interface PlacedFootprint {
  kind: LandmarkKind;
  islandId: IslandId;
  x: number;
  z: number;
  /** The landmark's turn, as the look gives it: by its bearing and its island's. */
  cosine: number;
  sine: number;
  footprint: Footprint;
}

/**
 * How wide a tree is to a walker, metres, at a placement scale of 1: the trunk, and for the spruce the boughs that
 * come down to head height. Narrow enough that a wood stays walkable (trees stand 3.1 m apart or more).
 */
export const TRUNK_RADIUS = { spruce: 0.55, pine: 0.4, birch: 0.3, snag: 0.3, signalPine: 0.6 } as const;

/** Boulders: the main stone's half-width and the second lump's, as shares of the builder's radius (`look/props.ts`). */
const BOULDER_MAIN = 1.15;
const BOULDER_LUMP = 0.6;

/** The crag shapes of the look's dressing (`crag` in `look/world/dressing.ts`), block by block, from its own seed. */
function cragBlocks(variant: number): { x: number; z: number; radius: number }[] {
  const random = seededRandom(400 + variant);
  const blocks: { x: number; z: number; radius: number }[] = [];
  for (let block = 0; block < 3 + variant; block += 1) {
    const width = 1.7 + random() * 1.6;
    random(); // height
    const depth = 1.4 + random() * 1.3;
    const x = (random() - 0.5) * 2.8;
    const z = (random() - 0.5) * 2.2;
    random(); // tilt
    random(); // turn
    random(); // tilt
    blocks.push({ x, z, radius: Math.max(width, depth) / 2 });
  }
  return blocks;
}

const CRAG_BLOCKS = [0, 1, 2].map(cragBlocks);

/** A shape of the look's turned and scaled: its own (x, z) to the world, about the vertical. */
function placed(originX: number, originZ: number, yaw: number, scale: number, x: number, z: number): { x: number; z: number } {
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  return { x: originX + (x * cosine + z * sine) * scale, z: originZ + (-x * sine + z * cosine) * scale };
}

/** The trees and boulders of one island's scatter, as solid circles. Scrub, reeds and sedge are walked through. */
function scatterSolids(island: IslandDefinition, placements: readonly Placement[]): SolidCircle[] {
  const circles: SolidCircle[] = [];
  for (const placement of placements) {
    const { kind, x, z, scale } = placement;
    if (kind === 'spruce' || kind === 'pine' || kind === 'birch') {
      circles.push({ x, z, radius: TRUNK_RADIUS[kind] * scale, kind, islandId: island.id });
    } else if (kind === 'boulder') {
      const radius = (0.34 + placement.variant * 0.16) * scale;
      circles.push({ x, z, radius: radius * BOULDER_MAIN, kind, islandId: island.id });
      if (placement.variant > 0) {
        const lump = placed(x, z, placement.yaw, scale, (0.34 + placement.variant * 0.16) * 1.1, (0.34 + placement.variant * 0.16) * 0.5);
        circles.push({ ...lump, radius: radius * BOULDER_LUMP, kind, islandId: island.id });
      }
    }
  }
  return circles;
}

/** One solid piece of the look's dressing where it stands: as the look places its instance. */
export interface DressingAnchor {
  kind: 'crag' | 'skerry' | 'snag' | 'signal_pine';
  /** The shape: which crag, or which snag. */
  variant: number;
  x: number;
  z: number;
  yaw: number;
  scale: number;
}

/**
 * The solid part of the look's dressing on one island, by its own seeded rules and in its own order: crags on the
 * slopes of high ground, skerries off rough-water rock, drowned snags round wet ground and in the Fog, and the
 * great pine over the starting camp. Herons and wrecks are left out: a heron is not in the way, a wreck is afloat.
 * `tests/look/solids.test.ts` holds these to the look's own instances.
 */
export function dressingAnchors(island: IslandDefinition): DressingAnchor[] {
  const anchors: DressingAnchor[] = [];
  const random = seededRandom(hashText(`${island.id}.dressing`));
  const circles = keepOutCircles(island);
  const clear = (x: number, z: number, margin: number): boolean => !circles.some((circle) => Math.hypot(circle.x - x, circle.z - z) < circle.radius + margin);
  const region = REGIONS_BY_ID[island.regionId];
  const preset = floraPresetFor(island);
  const ring = (kind: DressingAnchor['kind'], variant: number, count: number, nearest: number, farthest: number, accept: (x: number, z: number, height: number) => boolean, scaleOf: () => number): void => {
    for (let index = 0; index < count; index += 1) {
      const angle = ((index + random()) / count) * Math.PI * 2;
      const reach = nearest + random() * (farthest - nearest);
      const point = spotPosition(island, { along: Math.cos(angle) * reach, across: Math.sin(angle) * reach });
      const height = terrainHeight(point.x, point.z);
      // The look draws its yaw and scale before it asks whether the spot is kept: the same here, or the seed drifts.
      const yaw = random() * 6.28;
      const scale = scaleOf();
      if (accept(point.x, point.z, height)) anchors.push({ kind, variant, x: point.x, z: point.z, yaw, scale });
    }
  };
  if (island.peakHeight >= 20) {
    for (let variant = 0; variant < 3; variant += 1) {
      ring('crag', variant, Math.round(shoreLength(island) / 75), 0.4, 0.92, (x, z, height) => height > 2 && clear(x, z, 3), () => 0.9 + random() * 0.9);
    }
  }
  if (region.roughness >= 3 && preset !== 'works') {
    ring('skerry', 1, Math.round(shoreLength(island) / 55), 1.04, 1.13, (x, z) => clear(x, z, 7), () => 0.7 + random() * 0.7);
  }
  if (preset === 'marsh' || region.fogWall) {
    for (let variant = 0; variant < 2; variant += 1) {
      ring('snag', variant, Math.round(shoreLength(island) / (region.fogWall ? 60 : 55)), 1.03, 1.11, (x, z) => clear(x, z, 6), () => 0.8 + random() * 0.5);
    }
  }
  if (island.id === START.islandId) {
    const top = spotPosition(island, { along: 0.02, across: 0.05 });
    anchors.push({ kind: 'signal_pine', variant: 0, x: top.x, z: top.z, yaw: 0.4, scale: 1.7 });
  }
  return anchors;
}

/** One piece of the look's dressing as circles: a crag block by block, a snag or the great pine by its trunk. */
export function anchorSolids(anchor: DressingAnchor, islandId: IslandId): SolidCircle[] {
  if (anchor.kind === 'crag' || anchor.kind === 'skerry') {
    return CRAG_BLOCKS[anchor.variant].map((block) => ({
      ...placed(anchor.x, anchor.z, anchor.yaw, anchor.scale, block.x, block.z), radius: block.radius * anchor.scale, kind: anchor.kind, islandId,
    }));
  }
  const radius = anchor.kind === 'snag' ? TRUNK_RADIUS.snag * anchor.scale : TRUNK_RADIUS.signalPine;
  return [{ x: anchor.x, z: anchor.z, radius, kind: anchor.kind, islandId }];
}

/** The look's solid dressing on one island, as circles. */
export function dressingSolids(island: IslandDefinition): SolidCircle[] {
  return dressingAnchors(island).flatMap((anchor) => anchorSolids(anchor, island.id));
}

/** Every landmark of the island table that has a footprint, where it stands. */
function placedFootprints(island: IslandDefinition): PlacedFootprint[] {
  const placedList: PlacedFootprint[] = [];
  for (const landmark of island.landmarks) {
    const footprint = LANDMARK_FOOTPRINTS[landmark.kind];
    if (!footprint || footprint.rows.length === 0) continue;
    const spot = spotPosition(island, landmark.spot);
    const turn = -(landmark.bearing + island.rotation);
    placedList.push({ kind: landmark.kind, islandId: island.id, x: spot.x, z: spot.z, cosine: Math.cos(turn), sine: Math.sin(turn), footprint });
  }
  return placedList;
}

/** True when a world point is on a solid cell of a placed footprint. */
function onFootprint(placedFootprint: PlacedFootprint, x: number, z: number): boolean {
  const offsetX = x - placedFootprint.x;
  const offsetZ = z - placedFootprint.z;
  // The look's turn undone: world offset back to the landmark's own x and z.
  const localX = offsetX * placedFootprint.cosine - offsetZ * placedFootprint.sine;
  const localZ = offsetX * placedFootprint.sine + offsetZ * placedFootprint.cosine;
  const { footprint } = placedFootprint;
  const row = Math.floor((localZ - footprint.z) / FOOTPRINT_CELL);
  if (row < 0 || row >= footprint.rows.length) return false;
  const column = Math.floor((localX - footprint.x) / FOOTPRINT_CELL);
  const line = footprint.rows[row];
  return column >= 0 && column < line.length && line.charCodeAt(column) === 35; // '#'
}

/** Metres a filing cell spans, and how far past its own edge a solid is filed, so any body radius up to it is seen. */
const FILE_CELL = 8;
const FILE_MARGIN = 1.2;

interface SolidIndex {
  circles: SolidCircle[];
  footprints: PlacedFootprint[];
  cells: Map<number, { circles: number[]; footprints: number[] }>;
}

let built: SolidIndex | null = null;

const cellKey = (column: number, row: number): number => (column + 2048) * 4096 + (row + 2048);

function file(index: SolidIndex, minimumX: number, maximumX: number, minimumZ: number, maximumZ: number, add: (entry: { circles: number[]; footprints: number[] }) => void): void {
  for (let column = Math.floor((minimumX - FILE_MARGIN) / FILE_CELL); column <= Math.floor((maximumX + FILE_MARGIN) / FILE_CELL); column += 1) {
    for (let row = Math.floor((minimumZ - FILE_MARGIN) / FILE_CELL); row <= Math.floor((maximumZ + FILE_MARGIN) / FILE_CELL); row += 1) {
      const key = cellKey(column, row);
      let entry = index.cells.get(key);
      if (!entry) {
        entry = { circles: [], footprints: [] };
        index.cells.set(key, entry);
      }
      add(entry);
    }
  }
}

/** Every solid of the valley, built on first use. */
export function solidIndex(): SolidIndex {
  if (built) return built;
  const index: SolidIndex = { circles: [], footprints: [], cells: new Map() };
  for (const island of ISLANDS) {
    index.circles.push(...scatterSolids(island, scatterIsland(island, floraMixFor(island))), ...dressingSolids(island));
    index.footprints.push(...placedFootprints(island));
  }
  index.circles.forEach((circle, at) => {
    file(index, circle.x - circle.radius, circle.x + circle.radius, circle.z - circle.radius, circle.z + circle.radius, (entry) => entry.circles.push(at));
  });
  index.footprints.forEach((placedFootprint, at) => {
    const { footprint } = placedFootprint;
    const width = (footprint.rows[0]?.length ?? 0) * FOOTPRINT_CELL;
    const depth = footprint.rows.length * FOOTPRINT_CELL;
    const corners = [[footprint.x, footprint.z], [footprint.x + width, footprint.z], [footprint.x, footprint.z + depth], [footprint.x + width, footprint.z + depth]]
      .map(([x, z]) => ({ x: placedFootprint.x + x * placedFootprint.cosine + z * placedFootprint.sine, z: placedFootprint.z - x * placedFootprint.sine + z * placedFootprint.cosine }));
    file(index, Math.min(...corners.map((corner) => corner.x)), Math.max(...corners.map((corner) => corner.x)),
      Math.min(...corners.map((corner) => corner.z)), Math.max(...corners.map((corner) => corner.z)), (entry) => entry.footprints.push(at));
  });
  built = index;
  return index;
}

/** Points round a body's edge that are tried against footprints: its middle and eight round it. */
const RIM = Array.from({ length: 8 }, (_, step) => [Math.sin((step / 8) * Math.PI * 2), -Math.cos((step / 8) * Math.PI * 2)] as const);

/**
 * True when a body `radius` wide (a walker's, `TUNING.foot.bodyRadius`, unless said) standing at a point would be
 * in a tree, a rock or a landmark. A radius past `bodyRadius + FILE_MARGIN` is not supported.
 */
export function bodyBlocked(x: number, z: number, radius: number = TUNING.foot.bodyRadius): boolean {
  const index = solidIndex();
  const entry = index.cells.get(cellKey(Math.floor(x / FILE_CELL), Math.floor(z / FILE_CELL)));
  if (!entry) return false;
  for (const at of entry.circles) {
    const circle = index.circles[at];
    const reach = circle.radius + radius;
    const offsetX = x - circle.x;
    const offsetZ = z - circle.z;
    if (offsetX * offsetX + offsetZ * offsetZ < reach * reach) return true;
  }
  for (const at of entry.footprints) {
    const placedFootprint = index.footprints[at];
    if (onFootprint(placedFootprint, x, z)) return true;
    for (const [rimX, rimZ] of RIM) if (onFootprint(placedFootprint, x + rimX * radius, z + rimZ * radius)) return true;
  }
  return false;
}

const approaches = new Map<string, { x: number; z: number; depth: number }>();

/** Clear ground behind a spot, looking away from what it approaches: it is on the outside, not in a pocket. */
const OPEN_BEHIND = [0.5, 1, 1.5, 2];
/** A spot a body cannot walk this far from, on clear ground, is shut in: inside walls with no way through. */
const POCKET_REACH = 10;
/** A way out counts when a body this much wider than a walker's fits through it: a door a walker squeezes through is no way in. */
const POCKET_SPARE = 0.15;

/** True when a body at (x, z) is shut in by solids: it cannot get `POCKET_REACH` away on clear ground. */
function inPocket(x: number, z: number): boolean {
  const cell = 0.25;
  const seen = new Set<string>(['0,0']);
  const stack: [number, number][] = [[0, 0]];
  while (stack.length > 0) {
    const [column, row] = stack.pop()!;
    if (Math.hypot(column, row) * cell >= POCKET_REACH) return false;
    for (const [stepColumn, stepRow] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const key = `${column + stepColumn},${row + stepRow}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (bodyBlocked(x + (column + stepColumn) * cell, z + (row + stepRow) * cell, TUNING.foot.bodyRadius + POCKET_SPARE)) continue;
      stack.push([column + stepColumn, row + stepRow]);
    }
  }
  return true;
}

/**
 * Where to stand for something inside a landmark (an attic in a cottage roof, the lamp at the foot of the Beacon's
 * tower, the lookout up the fire tower): the nearest clear ground with open ground behind it, away from the thing, so
 * not a pocket inside the walls; and how far that is. For anything with clear ground round it, the point itself and 0. A scavenge spot's reach grows
 * by that depth, so it is used from the landmark's edge.
 */
export function approachTo(x: number, z: number): { x: number; z: number; depth: number } {
  const key = `${x},${z}`;
  const known = approaches.get(key);
  if (known) return known;
  const dry = (pointX: number, pointZ: number): boolean => terrainHeight(pointX, pointZ) >= -TUNING.foot.wadeDepth;
  // Roomy ground to stand on: a body and some spare, as for a pocket's way out.
  const clear = (pointX: number, pointZ: number): boolean => dry(pointX, pointZ) && !bodyBlocked(pointX, pointZ, TUNING.foot.bodyRadius + POCKET_SPARE);
  let found = { x, z, depth: 0 };
  if (bodyBlocked(x, z) || !dry(x, z) || inPocket(x, z)) {
    search: for (let ring = 0.25; ring <= 30; ring += 0.25) {
      const steps = Math.max(8, Math.ceil((ring * Math.PI * 2) / 0.25));
      for (let step = 0; step < steps; step += 1) {
        const outX = Math.sin((step / steps) * Math.PI * 2);
        const outZ = -Math.cos((step / steps) * Math.PI * 2);
        const pointX = x + outX * ring;
        const pointZ = z + outZ * ring;
        if (clear(pointX, pointZ) && OPEN_BEHIND.every((behind) => clear(pointX + outX * behind, pointZ + outZ * behind))
          && !inPocket(pointX, pointZ)) {
          found = { x: pointX, z: pointZ, depth: ring };
          break search;
        }
      }
    }
  }
  approaches.set(key, found);
  return found;
}

/**
 * The nearest point to (x, z), within `reach`, where a body stands clear of every solid on dry enough ground, or
 * null. For stepping ashore, waking from a fail, and for the bot's targets.
 */
export function freeSpotNear(x: number, z: number, reach: number, radius: number = TUNING.foot.bodyRadius): { x: number; z: number } | null {
  const dry = (pointX: number, pointZ: number): boolean => terrainHeight(pointX, pointZ) >= -TUNING.foot.disembarkDepth;
  if (!bodyBlocked(x, z, radius) && dry(x, z)) return { x, z };
  for (let ring = 0.25; ring <= reach + 1e-9; ring += 0.25) {
    const steps = Math.max(8, Math.ceil((ring * Math.PI * 2) / 0.25));
    for (let step = 0; step < steps; step += 1) {
      const angle = (step / steps) * Math.PI * 2;
      const pointX = x + Math.sin(angle) * ring;
      const pointZ = z - Math.cos(angle) * ring;
      if (dry(pointX, pointZ) && !bodyBlocked(pointX, pointZ, radius)) return { x: pointX, z: pointZ };
    }
  }
  return null;
}
