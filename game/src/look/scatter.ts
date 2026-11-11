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
  lean_to: 3.5, campfire: 3, stump_bench: 2, cabin_roof: 5.5, birch_grove: 0, orchard_rows: 10, farmhouse: 7.5, boathouse: 8, dock: 5,
  steeple: 6, silo: 5, pylon: 5, scrap_stack: 5.5, crane_arm: 3, reed_bed: 0, truss_span: 6, quarry_cut: 4, fire_tower: 4, dam_wall: 6,
  gatehouse: 5, radio_tower: 5, keeper_hut: 4.5, bedroll: 2, forge_hearth: 3,
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
