/**
 * Luc, from the live game, on Home Knoll: "you can still walk through some things, like the fishing, the water
 * container". The fishing place and the rain barrel are scavenge spots, and no spot was solid. Now every spot that is
 * hard and stands above the shin is, and so are the survivors, the herons and the buffer stop on the bridge.
 *
 * Each kind is walked straight at, from open ground: the walker is stopped at it or slides along it, never in it,
 * and what it gives is still in reach from where they are stopped.
 */
import { describe, expect, it } from 'vitest';
import { ISLANDS, ISLANDS_BY_ID, NODES, NODES_BY_ID, NPCS, NPC_IDS, TUNING, spotPosition } from '../src/data/index.ts';
import { NODE_SOLIDS } from '../src/data/footprints.ts';
import type { IslandId, NodeTypeId } from '../src/data/index.ts';
import {
  FIXED_STEP, NEUTRAL_INPUT, approachTo, bodyBlocked, bufferStopSolids, dressingSolids, drainEvents, nodeSolids, selectInteractable,
  solidIndex, step, survivorSolids, terrainHeight,
} from '../src/sim/index.ts';
import type { GameState, SolidCircle, StepInput } from '../src/sim/index.ts';
import { canWalk } from '../src/sim/foot.ts';
import { filedAt } from '../src/sim/solids.ts';
import { newGame, standOn } from './support.ts';
import { createRig } from './net/rig.ts';

const BODY = TUNING.foot.bodyRadius;

function walker(islandId: IslandId, x: number, z: number): GameState {
  const game = newGame(7);
  standOn(game, islandId);
  game.weather.secondsRemaining = 99999;
  Object.assign(game.players[0], { mode: 'foot', seat: null, islandId, position: { x, y: terrainHeight(x, z), z }, hunger: 100, thirst: 100, energy: 100 });
  drainEvents(game);
  return game;
}

function walk(game: GameState, input: Partial<StepInput>, seconds: number): { x: number; z: number }[] {
  const trail: { x: number; z: number }[] = [];
  for (let count = 0; count < Math.round(seconds / FIXED_STEP); count += 1) {
    step(game, { ...NEUTRAL_INPUT, ...input }, FIXED_STEP);
    trail.push({ x: game.players[0].position.x, z: game.players[0].position.z });
  }
  return trail;
}

/** How far a point is inside the nearest of a thing's circles, with a body round it: above zero is in it. */
const into = (circles: readonly SolidCircle[], x: number, z: number): number =>
  Math.max(...circles.map((circle) => circle.radius + BODY - Math.hypot(circle.x - x, circle.z - z)));

interface Approach { start: { x: number; z: number }; yaw: number; run: number }

/**
 * A straight walk at a thing's middle from open ground: the first way in, of 32 round it, that is clear ground a
 * walker may cross for `run` metres up to the thing's own edge. Three metres where there is room, one where the
 * thing stands inside something else (an attic's cupola under its roof).
 */
function approachOf(circles: readonly SolidCircle[]): Approach | null {
  const middle = { x: circles.reduce((sum, circle) => sum + circle.x, 0) / circles.length, z: circles.reduce((sum, circle) => sum + circle.z, 0) / circles.length };
  const farthest = Math.max(...circles.map((circle) => Math.hypot(circle.x - middle.x, circle.z - middle.z) + circle.radius)) + BODY;
  for (const run of [3, 1]) {
    for (let turn = 0; turn < 32; turn += 1) {
      const yaw = (turn * Math.PI) / 16;
      const outX = Math.sin(yaw);
      const outZ = -Math.cos(yaw);
      // The thing's own edge this way: the last point along it where a body would be in one of its circles.
      let edge = 0;
      for (let along = 0; along <= farthest; along += 0.05) if (into(circles, middle.x + outX * along, middle.z + outZ * along) > 0) edge = along + 0.05;
      if (edge === 0) continue;
      let open = true;
      for (let along = 0.05; along <= run && open; along += 0.05) {
        const x = middle.x + outX * (edge + along);
        const z = middle.z + outZ * (edge + along);
        if (bodyBlocked(x, z) || !canWalk(x, z, x - outX * 0.05, z - outZ * 0.05) || terrainHeight(x, z) < -TUNING.foot.wadeDepth + 0.1) open = false;
      }
      if (open) return { start: { x: middle.x + outX * (edge + run), z: middle.z + outZ * (edge + run) }, yaw: yaw + Math.PI, run };
    }
  }
  return null;
}

/** Walk straight at a thing and hold the key: where the walker went, where they came nearest to it, and the game it ended in. */
function walkAt(circles: readonly SolidCircle[], name: string): { trail: { x: number; z: number }[]; nearest: { x: number; z: number }; game: GameState } {
  const approach = approachOf(circles);
  if (!approach) throw new Error(`no open way up to ${name}`);
  const game = walker(circles[0].islandId, approach.start.x, approach.start.z);
  const trail = walk(game, { moveY: 1, cameraYaw: approach.yaw }, 2 + approach.run * 2);
  // Never in it, nor in anything else.
  for (const point of trail) {
    expect(into(circles, point.x, point.z), `${name}: in it at ${point.x.toFixed(2)}, ${point.z.toFixed(2)}`).toBeLessThanOrEqual(1e-9);
    expect(bodyBlocked(point.x, point.z), `${name}: in a solid at ${point.x.toFixed(2)}, ${point.z.toFixed(2)}`).toBe(false);
  }
  // It got there: up against the thing itself, within a few centimetres.
  const nearest = trail.reduce((best, point) => (into(circles, point.x, point.z) > into(circles, best.x, best.z) ? point : best));
  expect(into(circles, nearest.x, nearest.z), `${name}: reached`).toBeGreaterThan(-0.05);
  return { trail, nearest, game };
}

/** The first placed spot of a kind that can be walked straight at, or null when every one stands inside a landmark's own outline. */
function spotOf(typeId: NodeTypeId): { nodeId: string; circles: SolidCircle[] } | null {
  for (const node of NODES) {
    if (node.typeId !== typeId || node.reach !== 'foot') continue;
    const circles = nodeSolids(node);
    if (approachOf(circles)) return { nodeId: node.id, circles };
  }
  return null;
}

/** Kinds nobody can walk up to: the Beacon's lamp stands between the legs of its tower, and the tower stops a walker first. */
const BEHIND_A_LANDMARK: readonly NodeTypeId[] = ['beacon_lamp'];

const solidTypes = (Object.keys(NODE_SOLIDS) as NodeTypeId[]).filter((typeId) => NODE_SOLIDS[typeId].length > 0);

describe('the three things Luc named, on Home Knoll', () => {
  it('"the water container": the rain barrel stops a walker, and its water is in reach from there', () => {
    const { trail, game } = walkAt(nodeSolids(NODES_BY_ID['home_knoll.rain_barrel.1']), 'the rain barrel');
    // Stopped, not shaking: the key still down, it hardly moves over the last second.
    const last = trail.slice(-60);
    expect(Math.hypot(last[0].x - last[59].x, last[0].z - last[59].z)).toBeLessThan(0.05);
    expect(selectInteractable(game)).toMatchObject({ kind: 'node', nodeId: 'home_knoll.rain_barrel.1' });
  });

  it('"the fishing": the fishing place stops a walker, and its catch is in reach from there', () => {
    const { game } = walkAt(nodeSolids(NODES_BY_ID['home_knoll.fishing_spot.1']), 'the fishing place');
    expect(selectInteractable(game)).toMatchObject({ kind: 'node', nodeId: 'home_knoll.fishing_spot.1' });
  });

  it('a walker cannot cut between the fishing place\'s stakes and its rod, where a body does not fit', () => {
    const circles = nodeSolids(NODES_BY_ID['home_knoll.fishing_spot.1']);
    // From every side, at every sixteenth of a turn, held for six seconds: never in it.
    const middle = NODES_BY_ID['home_knoll.fishing_spot.1'].position;
    for (let turn = 0; turn < 16; turn += 1) {
      const yaw = (turn * Math.PI) / 8;
      const start = { x: middle.x + Math.sin(yaw) * 4.5, z: middle.z - Math.cos(yaw) * 4.5 };
      if (bodyBlocked(start.x, start.z) || terrainHeight(start.x, start.z) < 0.1) continue;
      const game = walker('home_knoll', start.x, start.z);
      for (const point of walk(game, { moveY: 1, cameraYaw: yaw + Math.PI }, 6)) expect(into(circles, point.x, point.z), `from ${turn}`).toBeLessThanOrEqual(1e-9);
    }
  });

  it('"the fire": the campfire stops a walker at its stones (it did already)', () => {
    const fire = solidIndex().footprints.find((footprint) => footprint.kind === 'campfire' && footprint.islandId === 'home_knoll')!;
    const game = walker('home_knoll', fire.x + 6, fire.z);
    const trail = walk(game, { moveY: 1, cameraYaw: -Math.PI / 2 }, 6);
    for (const point of trail) expect(bodyBlocked(point.x, point.z)).toBe(false);
    expect(trail.at(-1)!.x).toBeGreaterThan(fire.x + 0.5);
    expect(trail.at(-1)!.x).toBeLessThan(fire.x + 3);
  });
});

describe('every kind of scavenge spot that is hard and stands above the shin', () => {
  it.each(solidTypes)('%s: walked straight at, it stops the walker or turns them aside, and stays in reach', (typeId) => {
    const spot = spotOf(typeId);
    expect(spot === null, 'whether one can be walked up to').toBe(BEHIND_A_LANDMARK.includes(typeId));
    if (!spot) {
      // Shut in by a landmark's outline: used from that outline's edge, which the reach test walks to.
      for (const node of NODES.filter((candidate) => candidate.typeId === typeId)) expect(approachTo(node.position.x, node.position.z).depth, node.id).toBeGreaterThan(1);
      return;
    }
    const { nearest } = walkAt(spot.circles, spot.nodeId);
    // What it gives is in reach from where the walker was held, by the rules' own measure: its range, and how deep its middle sits.
    const node = NODES_BY_ID[spot.nodeId];
    const reach = TUNING.foot.nodeRange + approachTo(node.position.x, node.position.z).depth;
    expect(Math.hypot(node.position.x - nearest.x, node.position.z - nearest.z), `${spot.nodeId}: in reach`).toBeLessThanOrEqual(reach);
  });

  it('is in the rules\' index, spot by spot: 190 or so placed, none missed', () => {
    const { circles } = solidIndex();
    for (const node of NODES) {
      const own = nodeSolids(node);
      expect(own.length, node.id).toBe(node.reach === 'foot' ? NODE_SOLIDS[node.typeId].length : 0);
      for (const circle of own) {
        expect(circles.some((filed) => filed.x === circle.x && filed.z === circle.z && filed.radius === circle.radius && filed.kind === `spot:${node.typeId}`), node.id).toBe(true);
        expect(bodyBlocked(circle.x, circle.z), `${node.id}: a body at its circle's middle is in it`).toBe(true);
      }
    }
  });

  it('can be used from outside itself: the nearest clear ground to every spot is within its reach', () => {
    for (const node of NODES) {
      if (node.reach !== 'foot') continue;
      const approach = approachTo(node.position.x, node.position.z);
      expect(bodyBlocked(approach.x, approach.z), `${node.id}: its approach is clear`).toBe(false);
      // Standing there, the spot is offered or something nearer is: it is inside the rules' reach with room to spare.
      expect(Math.hypot(approach.x - node.position.x, approach.z - node.position.z), node.id).toBeLessThanOrEqual(TUNING.foot.nodeRange + approach.depth - 1);
    }
  });
});

describe('the survivors', () => {
  it.each(NPC_IDS)('%s: walked straight at, they stop the walker, and can be talked to from there', (npcId) => {
    const island = ISLANDS_BY_ID[NPCS[npcId].islandId];
    const spot = spotPosition(island, NPCS[npcId].spot);
    const circles = survivorSolids(island).filter((circle) => circle.x === spot.x && circle.z === spot.z);
    expect(circles).toHaveLength(1);
    const { game } = walkAt(circles, npcId);
    const player = game.players[0].position;
    expect(Math.hypot(spot.x - player.x, spot.z - player.z)).toBeLessThan(TUNING.foot.npcRange);
    expect(selectInteractable(game)).toMatchObject({ kind: 'npc', npcId });
  });

  it('are all solid: one body each, where the look stands them', () => {
    const all = ISLANDS.flatMap((island) => survivorSolids(island));
    expect(all).toHaveLength(NPC_IDS.length);
    for (const circle of all) expect(circle.radius).toBe(BODY);
  });
});

describe('the herons and the buffer stop', () => {
  it('a heron in the shallows stops a wader', () => {
    const herons = dressingSolids(ISLANDS_BY_ID.heron_marsh).filter((circle) => circle.kind === 'heron');
    expect(herons.length).toBeGreaterThan(3);
    const reachable = herons.find((heron) => approachOf([heron]) !== null)!;
    expect(reachable, 'one can be waded up to').toBeDefined();
    walkAt([reachable], 'a heron');
  });

  it('the buffer stop at the north end of the bridge\'s track stops a walker', () => {
    const stop = bufferStopSolids(ISLANDS_BY_ID.truss_bridge);
    expect(stop).toHaveLength(4);
    walkAt(stop, 'the buffer stop');
    for (const island of ISLANDS) if (island.id !== 'truss_bridge') expect(bufferStopSolids(island)).toEqual([]);
  });
});

describe('a jump at a rain barrel', () => {
  it('clears nothing: the jumper is stopped as a walker is', () => {
    const circles = nodeSolids(NODES_BY_ID['home_knoll.rain_barrel.1']);
    const approach = approachOf(circles)!;
    const game = walker('home_knoll', approach.start.x, approach.start.z);
    const trail: { x: number; z: number }[] = [];
    let airborne = 0;
    for (let count = 0; count < 6 * 60; count += 1) {
      // Running at it, jumping again and again.
      step(game, { ...NEUTRAL_INPUT, moveY: 1, run: true, cameraYaw: approach.yaw, jump: count % 40 < 20 }, FIXED_STEP);
      trail.push({ x: game.players[0].position.x, z: game.players[0].position.z });
      if (game.players[0].leap && game.players[0].leap.steps > 0) airborne += 1;
    }
    expect(airborne).toBeGreaterThan(60);
    for (const point of trail) expect(into(circles, point.x, point.z)).toBeLessThanOrEqual(1e-9);
    expect(Math.max(...trail.map((point) => into(circles, point.x, point.z)))).toBeGreaterThan(-0.05);
  });
});

describe('a guest walking into the rain barrel', () => {
  it('is stopped on their own screen where the host stops them, with nothing put right', () => {
    const circles = nodeSolids(NODES_BY_ID['home_knoll.rain_barrel.1']);
    const approach = approachOf(circles)!;
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
    // The guest at the start of the walk, the host well out of the way.
    Object.assign(rig.game.players[1]!, { mode: 'foot', seat: null, islandId: 'home_knoll', position: { x: approach.start.x, y: terrainHeight(approach.start.x, approach.start.z), z: approach.start.z }, hunger: 100, thirst: 100, energy: 100 });
    rig.run(3);
    let worstSlip = 0;
    sam.input = { moveY: 1, cameraYaw: approach.yaw };
    for (let count = 0; count < 5 * 60; count += 1) {
      rig.run(FIXED_STEP);
      worstSlip = Math.max(worstSlip, sam.link.walk.slip);
      const shown = sam.link.view()!.players[1]!.position;
      expect(into(circles, shown.x, shown.z)).toBeLessThanOrEqual(1e-9);
    }
    const host = rig.game.players[1]!.position;
    expect(into(circles, host.x, host.z)).toBeGreaterThan(-0.05);
    expect(worstSlip).toBeLessThan(1e-9);
    expect(sam.link.walk.cuts).toBe(0);
    sam.input = {};
    rig.run(0.5);
    expect(rig.settle()).toBe(true);
    expect(sam.link.mismatches).toBe(0);
  });
});

describe('the cost of a step', () => {
  it('is no more than before these were solid: an ask looks through fewer circles and footprints than it did', () => {
    // The live game (main at 2857012), measured the same way: 0.8977 circles and 0.0468 footprints filed where a
    // walker asks, as a mean over a 2 m grid on all the ground of every island (r4-solid/scripts/cost-filed.ts).
    const BEFORE = { circles: 0.8977, footprints: 0.0468 };
    let asks = 0;
    let circles = 0;
    let footprints = 0;
    for (const island of ISLANDS) {
      const reach = Math.max(island.radiusX, island.radiusZ) * 1.2;
      for (let x = island.center.x - reach; x <= island.center.x + reach; x += 2) {
        for (let z = island.center.z - reach; z <= island.center.z + reach; z += 2) {
          if (terrainHeight(x, z) < -TUNING.foot.wadeDepth) continue;
          const filed = filedAt(x, z);
          asks += 1;
          circles += filed.circles;
          footprints += filed.footprints;
        }
      }
    }
    expect(asks).toBeGreaterThan(50000);
    expect(circles / asks).toBeLessThanOrEqual(BEFORE.circles);
    expect(footprints / asks).toBeLessThanOrEqual(BEFORE.footprints);
  });

  it('still sees every solid from anywhere a body would touch it: the finer filing loses none', () => {
    const { circles } = solidIndex();
    for (const circle of circles) {
      for (let turn = 0; turn < 8; turn += 1) {
        const reach = circle.radius + BODY - 0.01;
        const x = circle.x + Math.sin((turn * Math.PI) / 4) * reach;
        const z = circle.z - Math.cos((turn * Math.PI) / 4) * reach;
        expect(bodyBlocked(x, z), `${circle.kind} at ${circle.x.toFixed(1)}, ${circle.z.toFixed(1)}`).toBe(true);
        // And a body as wide as the filing allows for (a roomy stand, `approachTo`).
        expect(bodyBlocked(circle.x + Math.sin((turn * Math.PI) / 4) * (circle.radius + 1.19), circle.z - Math.cos((turn * Math.PI) / 4) * (circle.radius + 1.19), 1.2)).toBe(true);
      }
    }
  });
});
