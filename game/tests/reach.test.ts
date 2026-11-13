/**
 * Luc's list, line 1: trees, rocks and landmarks are solid. Nothing a quest needs may end up out of reach.
 *
 * Every island is walked from its landing beach: a 0.5 m grid, each step allowed by the rules' own tests (the
 * ground, `canWalk`, and the solids, `bodyBlocked`). Then every scavenge node, survivor, bed, bench, fire and the
 * Beacon must have a spot reached that is in the rules' reach of it.
 */
import { describe, expect, it } from 'vitest';
import { CAMP_LAYOUTS, ISLANDS, NODES_BY_ISLAND, NPCS, NPC_IDS, TUNING, spotPosition } from '../src/data/index.ts';
import type { IslandDefinition } from '../src/data/index.ts';
import { approachTo, bodyBlocked, freeSpotNear, landingBerth } from '../src/sim/index.ts';
import { canWalk } from '../src/sim/foot.ts';
import { shoreSpotBeside } from '../src/sim/interact.ts';

const CELL = 0.5;
/** The farthest outside a landmark's outline a spot inside it may be used from, metres: a long arm into an attic. */
const MOST_DEPTH = 4.5;

/** Where a crew steps ashore at an island's landing, cleared of solids the way the rules clear it. */
export function landingSpot(island: IslandDefinition): { x: number; z: number } {
  const berth = landingBerth(island.id, 0);
  const shore = shoreSpotBeside(berth.x, berth.z, berth.heading)!;
  return freeSpotNear(shore.x, shore.z, 4)!;
}

/** Every grid point a walker reaches from the landing, as world points. */
export function walkable(island: IslandDefinition): { x: number; z: number }[] {
  const start = landingSpot(island);
  // A grid over the whole island, lined up so the landing spot is one of its points.
  const reach = Math.max(island.radiusX, island.radiusZ) * 1.25;
  const before = (value: number, low: number): number => Math.ceil((value - low) / CELL);
  const startColumn = before(start.x, island.center.x - reach);
  const startRow = before(start.z, island.center.z - reach);
  const size = Math.ceil((reach * 2) / CELL) + 2;
  const originX = start.x - startColumn * CELL;
  const originZ = start.z - startRow * CELL;
  const pointOf = (cell: number): { x: number; z: number } => ({ x: originX + (cell % size) * CELL, z: originZ + Math.floor(cell / size) * CELL });
  const seen = new Uint8Array(size * size);
  const first = startRow * size + startColumn;
  seen[first] = 1;
  const stack = [first];
  const reached: { x: number; z: number }[] = [];
  while (stack.length > 0) {
    const cell = stack.pop()!;
    const from = pointOf(cell);
    reached.push(from);
    const column = cell % size;
    const row = Math.floor(cell / size);
    for (const [stepColumn, stepRow] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nextColumn = column + stepColumn;
      const nextRow = row + stepRow;
      if (nextColumn < 0 || nextRow < 0 || nextColumn >= size || nextRow >= size) continue;
      const next = nextRow * size + nextColumn;
      if (seen[next]) continue;
      const to = pointOf(next);
      if (!canWalk(from.x, from.z, to.x, to.z) || bodyBlocked(to.x, to.z)) continue;
      seen[next] = 1;
      stack.push(next);
    }
  }
  return reached;
}

/** What a walker must be able to reach on an island, with the rules' reach for each. */
function targets(island: IslandDefinition): { name: string; x: number; z: number; reach: number }[] {
  const list: { name: string; x: number; z: number; reach: number }[] = [];
  for (const node of NODES_BY_ISLAND[island.id] ?? []) {
    // A spot inside a landmark's outline is reached from its edge: the rules add how deep it sits.
    if (node.reach === 'foot') list.push({ name: node.id, ...node.position, reach: TUNING.foot.nodeRange + approachTo(node.position.x, node.position.z).depth });
  }
  for (const npcId of NPC_IDS) {
    if (NPCS[npcId].islandId === island.id) list.push({ name: npcId, ...spotPosition(island, NPCS[npcId].spot), reach: TUNING.foot.npcRange });
  }
  const layout = CAMP_LAYOUTS[island.id];
  if (layout) {
    list.push({ name: 'the fire (cooking, warmth)', ...layout.fire, reach: TUNING.foot.campRange });
    for (const bed of layout.beds) list.push({ name: `bed: ${bed.kind}`, x: bed.x, z: bed.z, reach: TUNING.foot.campLandmarkRange });
    for (const landmark of layout.landmarks.filter((entry) => entry.kind === 'stump_bench')) list.push({ name: 'stump bench', x: landmark.x, z: landmark.z, reach: TUNING.foot.benchRange });
  }
  return list;
}

describe('with trees, rocks and landmarks solid, every island is still all there to use', () => {
  it.each(ISLANDS.map((island) => [island.id, island] as const))('%s', (_name, island) => {
    const start = landingSpot(island);
    expect(bodyBlocked(start.x, start.z), 'the landing is clear').toBe(false);
    const reached = walkable(island);
    expect(reached.length).toBeGreaterThan(20);
    const missed: string[] = [];
    for (const target of targets(island)) {
      // A margin inside the reach, so a spot on the edge of a grid cell is not what makes it pass.
      const within = target.reach - 0.2;
      if (!reached.some((point) => Math.hypot(point.x - target.x, point.z - target.z) <= within)) missed.push(target.name);
    }
    expect(missed, 'out of reach').toEqual([]);
  });

  it('lets a spot inside a landmark be used from its edge, never from far off', () => {
    // How deep each one sits today: attics 3.25 to 3.5 m, the steeple's 4, junk heaps 2 and 3, the lookout 3, the lamp 2.5.
    const deep: Record<string, number> = {};
    for (const island of ISLANDS) {
      for (const node of NODES_BY_ISLAND[island.id] ?? []) {
        if (node.reach !== 'foot') continue;
        const { depth } = approachTo(node.position.x, node.position.z);
        if (depth > 0) deep[node.id] = depth;
      }
    }
    expect(Object.keys(deep).length).toBeGreaterThan(3);
    for (const [id, depth] of Object.entries(deep)) expect(depth, id).toBeLessThanOrEqual(MOST_DEPTH);
  });

  it('checks every kind of thing the quests send you to', () => {
    const names = ISLANDS.flatMap((island) => targets(island).map((target) => target.name));
    expect(names).toContain('the_beacon.lamp');
    for (const npcId of NPC_IDS) expect(names).toContain(npcId);
    expect(names.filter((name) => name.startsWith('bed: '))).toHaveLength(ISLANDS.filter((island) => island.camp).length);
    expect(names).toContain('stump bench');
  });
});
