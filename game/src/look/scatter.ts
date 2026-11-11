/**
 * Where the trees, scrub, boulders, reeds and sedge stand. Seeded rules, the
 * same on every run, from the rules engine's own ground (`terrainHeight`).
 * Nothing is placed by hand, and nothing is placed where the game needs the
 * ground: the landing, the camp, landmarks, scavenge nodes and survivors.
 *
 * No Three.js in here: props.ts turns placements into instanced meshes.
 */
import { NODES_BY_ISLAND, NPCS, NPC_IDS, spotPosition } from '../data/index.ts';
import type { IslandDefinition, LandmarkKind } from '../data/index.ts';
import { terrainHeight } from '../sim/index.ts';
import type { FloraMix } from './presets.ts';

export type FloraKind = 'spruce' | 'pine' | 'birch' | 'scrub' | 'boulder' | 'reed' | 'sedge';

/** How many meshes each kind has to pick from. */
export const VARIANTS: Record<FloraKind, number> = { spruce: 4, pine: 2, birch: 3, scrub: 2, boulder: 3, reed: 2, sedge: 2 };

export interface Placement {
  kind: FloraKind;
  variant: number;
  x: number;
  y: number;
  z: number;
  /** Turn about the vertical, radians. */
  yaw: number;
  scale: number;
}

/** Ground kept clear round each landmark, metres. */
export const LANDMARK_CLEARANCE: Record<LandmarkKind, number> = {
  lean_to: 4, campfire: 3.2, stump_bench: 3, cabin_roof: 5.5, birch_grove: 0, orchard_rows: 11.5, farmhouse: 9, boathouse: 8.5, dock: 4,
  steeple: 6.5, silo: 5.5, pylon: 5.5, scrap_stack: 6.5, crane_arm: 4.5, reed_bed: 0, truss_span: 6, quarry_cut: 6, fire_tower: 5, dam_wall: 8,
  gatehouse: 5, radio_tower: 5, keeper_hut: 5, bedroll: 2, forge_hearth: 4,
};

/**
 * Landmarks that are longer than a circle: more ground kept clear, as circles [x, z, radius] in the
 * landmark's own frame (x to its right, -z its front). The nave, the dock, the boathouse's slip, the
 * crane's boom, a truss span, the quarry's benches and the dam's wall.
 */
export const LANDMARK_FOOTPRINT: Partial<Record<LandmarkKind, [number, number, number][]>> = {
  steeple: [[0, -5, 6], [0, -11, 6]],
  dock: Array.from({ length: 8 }, (_, index): [number, number, number] => [0, 4 + index * 4, 3]),
  boathouse: [[-3.6, 7, 3], [-3.6, 12, 3], [-6.5, 0, 3]],
  crane_arm: [[0, -4, 3], [0, -8, 3]],
  truss_span: Array.from({ length: 11 }, (_, index): [number, number, number] => [0, -40 + index * 8, 6]),
  quarry_cut: [-20, -10, 0, 10, 20].flatMap((x): [number, number, number][] => [[x, -13, 7], [x, -5, 7], [x, 3, 7]]),
  dam_wall: Array.from({ length: 29 }, (_, index): [number, number, number] => [2, -140 + index * 10, 10]),
};

const MAXIMUM_TREES = 260;
const TREE_SPACING = 3.1;

/** Small deterministic generator, 0 to 1 (the one B2's builder uses). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable number from text, for seeding by id. */
export function hashText(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return hash >>> 0;
}

interface Circle { x: number; z: number; radius: number }

/** The ground the game needs clear on an island. */
export function keepOutCircles(island: IslandDefinition): Circle[] {
  const circles: Circle[] = [];
  const landing = spotPosition(island, island.landing);
  // The beach, and a lane from it toward the middle of the island.
  for (const share of [1, 0.88, 0.76]) {
    const point = spotPosition(island, { along: island.landing.along * share, across: island.landing.across * share });
    circles.push({ x: point.x, z: point.z, radius: 7 });
  }
  circles.push({ x: landing.x, z: landing.z, radius: 9 });
  if (island.camp) {
    const camp = spotPosition(island, island.camp.spot);
    circles.push({ x: camp.x, z: camp.z, radius: 5.5 });
  }
  for (const landmark of island.landmarks) {
    const radius = LANDMARK_CLEARANCE[landmark.kind];
    if (radius <= 0) continue;
    const spot = spotPosition(island, landmark.spot);
    circles.push({ x: spot.x, z: spot.z, radius });
  }
  for (const landmark of island.landmarks) {
    const spot = spotPosition(island, landmark.spot);
    // The world view's turn: a landmark's own x and z, on the island.
    const turn = -(landmark.bearing + island.rotation);
    for (const [x, z, radius] of LANDMARK_FOOTPRINT[landmark.kind] ?? []) {
      circles.push({ x: spot.x + x * Math.cos(turn) + z * Math.sin(turn), z: spot.z - x * Math.sin(turn) + z * Math.cos(turn), radius });
    }
  }
  for (const node of NODES_BY_ISLAND[island.id] ?? []) circles.push({ x: node.position.x, z: node.position.z, radius: 2.4 });
  for (const npcId of NPC_IDS) {
    if (NPCS[npcId].islandId !== island.id) continue;
    const spot = spotPosition(island, NPCS[npcId].spot);
    circles.push({ x: spot.x, z: spot.z, radius: 3 });
  }
  return circles;
}

const inside = (circles: Circle[], x: number, z: number, margin = 0): boolean =>
  circles.some((circle) => Math.hypot(circle.x - x, circle.z - z) < circle.radius + margin);

/** Dry land of an island, in hectares (the ellipse; close enough for a density). */
export function islandHectares(island: IslandDefinition): number {
  return (Math.PI * island.radiusX * island.radiusZ) / 10_000;
}

/** Length of an island's shoreline, metres (Ramanujan's ellipse). */
export function shoreLength(island: IslandDefinition): number {
  const { radiusX, radiusZ } = island;
  return Math.PI * (3 * (radiusX + radiusZ) - Math.sqrt((3 * radiusX + radiusZ) * (radiusX + 3 * radiusZ)));
}

function pickTree(mix: FloraMix, roll: number): 'spruce' | 'pine' | 'birch' {
  const total = mix.spruce + mix.pine + mix.birch;
  const value = roll * total;
  if (value < mix.spruce) return 'spruce';
  return value < mix.spruce + mix.pine ? 'pine' : 'birch';
}

/** Every plant and stone on one island. Same island and mix in, same list out. */
export function scatterIsland(island: IslandDefinition, mix: FloraMix): Placement[] {
  const random = seededRandom(hashText(island.id));
  const circles = keepOutCircles(island);
  const placements: Placement[] = [];
  const place = (kind: FloraKind, x: number, z: number, scale: number): void => {
    placements.push({ kind, variant: Math.floor(random() * VARIANTS[kind]), x, y: terrainHeight(x, z), z, yaw: random() * Math.PI * 2, scale });
  };
  /** A random point inside the shoreline, as an island spot. */
  const landPoint = (): { x: number; z: number } => {
    const angle = random() * Math.PI * 2;
    const reach = Math.sqrt(random()) * 0.97;
    return spotPosition(island, { along: Math.cos(angle) * reach, across: Math.sin(angle) * reach });
  };

  // Trees: off the beach and the camp, never crowding each other.
  const hectares = islandHectares(island);
  const treeCount = Math.min(MAXIMUM_TREES, Math.round(hectares * mix.treesPerHectare));
  const trunks: { x: number; z: number }[] = [];
  for (let attempt = 0; trunks.length < treeCount && attempt < treeCount * 30; attempt += 1) {
    const point = landPoint();
    const kind = pickTree(mix, random());
    const height = terrainHeight(point.x, point.z);
    // Birch likes the low ground near the water; spruce and pine want to be clear of it.
    if (kind === 'birch' ? height < 0.6 : height < 1.1) continue;
    if (inside(circles, point.x, point.z)) continue;
    if (trunks.some((trunk) => Math.hypot(trunk.x - point.x, trunk.z - point.z) < TREE_SPACING)) continue;
    trunks.push(point);
    place(kind, point.x, point.z, 0.85 + random() * 0.35);
  }

  // Low scrub between them.
  const scrubCount = Math.min(160, Math.round(hectares * mix.scrubPerHectare));
  for (let attempt = 0, placed = 0; placed < scrubCount && attempt < scrubCount * 20; attempt += 1) {
    const point = landPoint();
    if (terrainHeight(point.x, point.z) < 0.5 || inside(circles, point.x, point.z)) continue;
    if (trunks.some((trunk) => Math.hypot(trunk.x - point.x, trunk.z - point.z) < 1.4)) continue;
    place('scrub', point.x, point.z, 0.8 + random() * 0.5);
    placed += 1;
  }

  // The shoreline: boulders at the water's edge, reeds just outside it, sedge just inside.
  const shore = shoreLength(island) / 100;
  const ring = (kind: FloraKind, perShore: number, nearest: number, farthest: number, lowest: number, highest: number, scaleSpread: number): void => {
    const count = Math.min(220, Math.round(shore * perShore));
    for (let index = 0; index < count; index += 1) {
      const angle = ((index + random()) / count) * Math.PI * 2;
      const reach = 1 + nearest + random() * (farthest - nearest);
      const point = spotPosition(island, { along: Math.cos(angle) * reach, across: Math.sin(angle) * reach });
      const height = terrainHeight(point.x, point.z);
      if (height < lowest || height > highest || inside(circles, point.x, point.z, 1)) continue;
      place(kind, point.x, point.z, 1 - scaleSpread / 2 + random() * scaleSpread);
    }
  };
  ring('boulder', mix.bouldersPerShore, -0.025, 0.012, -0.35, 0.9, 0.7);
  ring('reed', mix.reedsPerShore, 0.004, 0.04, -0.9, 0.2, 0.4);
  ring('sedge', mix.sedgePerShore, -0.1, -0.02, 0.3, 3, 0.4);
  return placements;
}
