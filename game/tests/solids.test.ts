/**
 * Luc's list, line 1: "collision on everything on the islands". A walker stops at a tree, a rock or a landmark and
 * slides along it: never through it, never stuck on it, never shaking against it. The same on a guest's own screen,
 * and cheap enough for four players every step.
 */
import { describe, expect, it } from 'vitest';
import { ISLANDS_BY_ID, TUNING } from '../src/data/index.ts';
import { FOOTPRINT_CELL } from '../src/data/footprints.ts';
import type { IslandId, LandmarkKind } from '../src/data/index.ts';
import { FIXED_STEP, bodyBlocked, drainEvents, solidIndex, step, NEUTRAL_INPUT, terrainHeight } from '../src/sim/index.ts';
import type { GameState, SolidCircle, StepInput } from '../src/sim/index.ts';
import { canWalk } from '../src/sim/foot.ts';
import { newGame, standOn } from './support.ts';
import { createRig } from './net/rig.ts';
import { findFootPath } from '../src/bot/navigation.ts';

const BODY = TUNING.foot.bodyRadius;
/** Walking east: the keys straight ahead, the camera a quarter turn round. */
const EAST: Partial<StepInput> = { moveY: 1, cameraYaw: Math.PI / 2 };

/** Nothing but this one tree near a walk past it from the west, on dry, gentle ground. */
function loneTree(islandId?: IslandId): SolidCircle {
  const { circles } = solidIndex();
  for (const tree of circles) {
    if (tree.kind !== 'spruce' && tree.kind !== 'pine' && tree.kind !== 'birch') continue;
    if (islandId && tree.islandId !== islandId) continue;
    let fine = true;
    for (let along = -5; along <= 5 && fine; along += 0.25) {
      for (const across of [-1.6, -0.8, 0, 0.8, 1.6]) {
        const x = tree.x + along;
        const z = tree.z + across;
        if (terrainHeight(x, z) < 0.3 || !canWalk(x, z, x + 0.25, z)) fine = false;
        // Clear of every solid but this tree, with a body to spare.
        if (circles.some((other) => other !== tree && Math.hypot(other.x - x, other.z - z) < other.radius + BODY * 2)) fine = false;
        if (Math.hypot(tree.x - x, tree.z - z) > tree.radius + BODY * 2 && bodyBlocked(x, z, BODY * 2)) fine = false;
      }
    }
    if (fine) return tree;
  }
  throw new Error('no lone tree');
}

function walker(islandId: IslandId, x: number, z: number): GameState {
  const game = newGame(7);
  standOn(game, islandId);
  game.weather.secondsRemaining = 99999;
  Object.assign(game.players[0], { mode: 'foot', seat: null, islandId, position: { x, y: terrainHeight(x, z), z }, hunger: 100, thirst: 100, energy: 100 });
  drainEvents(game);
  return game;
}

/** Step the game and keep where the walker stood after each step. */
function walk(game: GameState, input: Partial<StepInput>, seconds: number): { x: number; z: number }[] {
  const trail: { x: number; z: number }[] = [];
  for (let count = 0; count < Math.round(seconds / FIXED_STEP); count += 1) {
    step(game, { ...NEUTRAL_INPUT, ...input }, FIXED_STEP);
    trail.push({ x: game.players[0].position.x, z: game.players[0].position.z });
  }
  return trail;
}

const moved = (trail: { x: number; z: number }[], from: number): number => {
  let most = 0;
  for (let index = Math.max(1, from); index < trail.length; index += 1) most = Math.max(most, Math.hypot(trail[index].x - trail[index - 1].x, trail[index].z - trail[index - 1].z));
  return most;
};

describe('a tree', () => {
  const tree = loneTree();
  const touching = tree.radius + BODY;

  it('stops a walker who walks straight into it, outside it, and holds them still', () => {
    const game = walker(tree.islandId, tree.x - 4, tree.z);
    const trail = walk(game, EAST, 6);
    for (const point of trail) expect(Math.hypot(point.x - tree.x, point.z - tree.z)).toBeGreaterThanOrEqual(touching - 1e-9);
    const end = trail[trail.length - 1];
    expect(end.x).toBeLessThan(tree.x);
    expect(Math.hypot(end.x - tree.x, end.z - tree.z)).toBeLessThan(touching + 0.1);
    // Stopped, not shaking: over the last second, the key still down, it hardly moves at all.
    expect(moved(trail, trail.length - 60)).toBeLessThan(0.002);
  });

  it('lets a walker slightly off its middle slide round it and on, with no back and forth', () => {
    for (const side of [1, -1]) {
      const game = walker(tree.islandId, tree.x - 4, tree.z + side * 0.25);
      const trail = walk(game, EAST, 8);
      for (const point of trail) expect(Math.hypot(point.x - tree.x, point.z - tree.z)).toBeGreaterThanOrEqual(touching - 1e-9);
      // Past the tree and on its way.
      expect(trail[trail.length - 1].x).toBeGreaterThan(tree.x + 2);
      // Round it on its own side, steadily: never forward then back, never across and back again.
      let turns = 0;
      for (let index = 2; index < trail.length; index += 1) {
        expect(trail[index].x - trail[index - 1].x).toBeGreaterThanOrEqual(-1e-9);
        const before = Math.sign(trail[index - 1].z - trail[index - 2].z);
        const now = Math.sign(trail[index].z - trail[index - 1].z);
        if (before !== 0 && now !== 0 && before !== now) turns += 1;
      }
      // Out round the trunk, then back to the line: one turn.
      expect(turns).toBeLessThanOrEqual(1);
      expect(Math.sign(Math.max(...trail.map((point) => side * (point.z - tree.z))))).toBe(1);
    }
  });

  it('lets someone already inside it (an old save, a landing) walk out, and holds them from then on', () => {
    const game = walker(tree.islandId, tree.x + 0.05, tree.z);
    expect(bodyBlocked(game.players[0].position.x, game.players[0].position.z)).toBe(true);
    walk(game, EAST, 2);
    const out = game.players[0].position;
    expect(bodyBlocked(out.x, out.z)).toBe(false);
    expect(out.x).toBeGreaterThan(tree.x + touching);
    // And back west into it: held.
    const trail = walk(game, { moveY: 1, cameraYaw: -Math.PI / 2 }, 4);
    for (const point of trail) expect(Math.hypot(point.x - tree.x, point.z - tree.z)).toBeGreaterThanOrEqual(touching - 1e-9);
  });
});

describe('a landmark', () => {
  /** The first of a kind in the island table, walked at from open ground beside it. */
  function approach(kind: LandmarkKind): { game: GameState; yaw: number; edge: { x: number; z: number } } {
    const placed = solidIndex().footprints.find((footprint) => footprint.kind === kind)!;
    expect(placed, kind).toBeDefined();
    const island = ISLANDS_BY_ID[placed.islandId];
    // No further out than the outline's farthest corner and a body: past that, a solid is something else.
    const { footprint } = placed;
    const width = footprint.rows[0].length * FOOTPRINT_CELL;
    const depth = footprint.rows.length * FOOTPRINT_CELL;
    const farthest = Math.hypot(Math.max(Math.abs(footprint.x), Math.abs(footprint.x + width)), Math.max(Math.abs(footprint.z), Math.abs(footprint.z + depth))) + BODY;
    // Out from the landmark's middle every sixteenth of a turn, toward the island's middle first: the first way that
    // meets the outline and is open ground for three metres beyond it.
    for (let turn = 0; turn < 32; turn += 1) {
      const yaw = Math.atan2(island.center.x - placed.x, -(island.center.z - placed.z)) + (turn * Math.PI) / 16;
      const outX = Math.sin(yaw);
      const outZ = -Math.cos(yaw);
      // The outline's outer edge this way (a hut's middle, a tower's between its legs, may be open).
      let edge = 0;
      for (let along = 0; along < farthest; along += 0.05) if (bodyBlocked(placed.x + outX * along, placed.z + outZ * along)) edge = along + 0.05;
      if (edge === 0) continue;
      const start = { x: placed.x + outX * (edge + 3), z: placed.z + outZ * (edge + 3) };
      let open = true;
      for (let along = 0.1; along <= 3 && open; along += 0.1) {
        const x = placed.x + outX * (edge + along);
        const z = placed.z + outZ * (edge + along);
        if (!canWalk(x, z, x - outX * 0.1, z - outZ * 0.1) || bodyBlocked(x, z)) open = false;
      }
      if (!open) continue;
      // Walk back in: the camera faces the landmark.
      return { game: walker(placed.islandId, start.x, start.z), yaw: yaw + Math.PI, edge: { x: placed.x + outX * edge, z: placed.z + outZ * edge } };
    }
    throw new Error(`no open way up to the ${kind}`);
  }

  it.each(['lean_to', 'stump_bench', 'campfire', 'keeper_hut', 'radio_tower', 'boathouse', 'fire_tower'] as const)('%s: walked into, it stops the walker at its edge', (kind) => {
    const { game, yaw, edge } = approach(kind);
    const trail = walk(game, { moveY: 1, cameraYaw: yaw }, 8);
    for (const point of trail) expect(bodyBlocked(point.x, point.z), `${kind} at ${point.x.toFixed(2)},${point.z.toFixed(2)}`).toBe(false);
    // It got there: up against the outline (within a few centimetres of it), and it never went in.
    expect(trail.some((point) => bodyBlocked(point.x, point.z, BODY + 0.05)), `${kind}: reached the outline`).toBe(true);
    expect(Math.min(...trail.map((point) => Math.hypot(point.x - edge.x, point.z - edge.z)))).toBeLessThan(1);
  });
});

describe('a guest walking into a tree', () => {
  it('stops where the host stops it, with nothing put right on the guest\'s own screen', () => {
    const tree = loneTree('home_knoll');
    const game = newGame(7);
    standOn(game, 'home_knoll');
    game.quests.bail_out.status = 'completed';
    game.quests.first_haul.status = 'active';
    game.weather.secondsRemaining = 99999;
    drainEvents(game);
    const rig = createRig({ game });
    const sam = rig.join('Sam');
    rig.run(3);
    expect(sam.link.status).toBe('playing');
    for (const [index, player] of rig.game.players.entries()) {
      const x = tree.x - 3 - index * 0.2;
      const z = tree.z + (index === 1 ? 0.25 : 1.4 + index);
      Object.assign(player, { mode: 'foot', seat: null, islandId: 'home_knoll', position: { x, y: terrainHeight(x, z), z }, hunger: 100, thirst: 100, energy: 100 });
    }
    rig.run(3);
    let worstSlip = 0;
    let worstEase = 0;
    sam.input = { ...EAST };
    for (let count = 0; count < 6 * 60; count += 1) {
      rig.run(FIXED_STEP);
      worstSlip = Math.max(worstSlip, sam.link.walk.slip);
      worstEase = Math.max(worstEase, sam.link.walk.eased);
      const shown = sam.link.view()!.players[1]!.position;
      expect(Math.hypot(shown.x - tree.x, shown.z - tree.z)).toBeGreaterThanOrEqual(tree.radius + BODY - 1e-9);
    }
    // It slid round the trunk, on the host and on its own screen alike.
    const host = rig.game.players[1]!.position;
    expect(host.x).toBeGreaterThan(tree.x + 1);
    expect(worstSlip).toBeLessThan(1e-9);
    expect(worstEase).toBe(0);
    expect(sam.link.walk.cuts).toBe(0);
    // Let go: half a second on, the figure is exactly where the host has it.
    sam.input = {};
    rig.run(0.5);
    const shown = sam.link.view()!.players[1]!.position;
    expect(Math.hypot(host.x - shown.x, host.z - shown.z)).toBeLessThan(1e-9);
    expect(rig.settle()).toBe(true);
    expect(sam.link.mismatches).toBe(0);
  });
});

describe('the cost', () => {
  it('asks "is a body in something?" for four players every step for well under a millisecond a second', () => {
    const tree = loneTree();
    const started = performance.now();
    let hits = 0;
    // Ten minutes of four players at 60 steps a second, a handful of asks per step.
    for (let count = 0; count < 4 * 60 * 60 * 10; count += 1) {
      const x = tree.x - 3 + (count % 600) * 0.01;
      if (bodyBlocked(x, tree.z + (count % 7) * 0.1)) hits += 1;
    }
    const perSecondOfPlay = (performance.now() - started) / 600;
    expect(hits).toBeGreaterThan(0);
    expect(perSecondOfPlay).toBeLessThan(0.5);
  });
});

describe('the bot, with solids in its way', () => {
  it('squeezes out of a cottage roof through its door when there is no roomier way (Luc\'s stuck save stands in one)', () => {
    const roof = solidIndex().footprints.find((footprint) => footprint.kind === 'cabin_roof')!;
    // The roof's own frame (x to its right, z out of its door) to the world, as the rules place it.
    const world = (x: number, z: number): { x: number; z: number } => ({ x: roof.x + x * roof.cosine + z * roof.sine, z: roof.z - x * roof.sine + z * roof.cosine });
    // From a corner of the attic floor to open ground off to one side of the door: no straight line, and the
    // door (a metre wide) has no room for the bot's usual berth.
    const inside = world(-1, -0.5);
    const outside = world(2, 6);
    expect(bodyBlocked(inside.x, inside.z)).toBe(false);
    const route = findFootPath(roof.islandId, inside, outside);
    expect(route).not.toBeNull();
    const game = walker(roof.islandId, inside.x, inside.z);
    for (const waypoint of route!) {
      for (let count = 0; count < 600 && Math.hypot(waypoint.x - game.players[0].position.x, waypoint.z - game.players[0].position.z) > 0.1; count += 1) {
        const { x, z } = game.players[0].position;
        const away = Math.hypot(waypoint.x - x, waypoint.z - z);
        step(game, { ...NEUTRAL_INPUT, moveX: (waypoint.x - x) / away, moveY: -(waypoint.z - z) / away, cameraYaw: 0 }, FIXED_STEP);
      }
    }
    expect(Math.hypot(outside.x - game.players[0].position.x, outside.z - game.players[0].position.z)).toBeLessThan(0.2);
  });

  it('wades out of the shallows it stands in (an old save left one at wading depth)', () => {
    const from = { x: 14.46, z: 1099.89 };
    expect(terrainHeight(from.x, from.z)).toBeLessThan(-0.45);
    expect(findFootPath('home_knoll', from, { x: 32, z: 1127 })).not.toBeNull();
  });
});
