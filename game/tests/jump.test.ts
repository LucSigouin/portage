/**
 * The jump (Luc's list, Round 3: "character need to jump").
 *
 * - By the numbers: off the ground on the step the key arrives, 0.9 m at the top, half a second in the air, as far
 *   as a walk or a run goes in that time, one jump for one press.
 * - The rules stay simple: the height is for the eye. A jumper takes only a walker's steps, so no tree, rock, wall,
 *   steep bank or deep water is cleared, and nobody jumps aboard, asleep or in a talk.
 * - Nothing of it is left behind: no field in the state before a jump or after one, and the bot never jumps.
 *
 * Lines that begin `JUMP` are the numbers for the report.
 */
import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/data/index.ts';
import { NPCS } from '../src/data/dialogue.ts';
import { createBotDriver } from '../src/bot/bot.ts';
import { deserialize, serialize } from '../src/save/index.ts';
import {
  FIXED_STEP, LEAP_AIR_STEPS, LEAP_FALL_STEPS, LEAP_LAND_STEPS, LEAP_RISE_STEPS, NEUTRAL_INPUT, airborne, blendLeap, bodyBlocked,
  dispatch, drainEvents, groundHeight, hashState, leapHeight, setConnected, solidIndex, step, terrainHeight,
} from '../src/sim/index.ts';
import type { GameState, PlayerState, SolidCircle, StepInput } from '../src/sim/index.ts';
import { canWalk } from '../src/sim/foot.ts';
import { floatCanoeAt, newGame, standOn, teleport } from './support.ts';

const FOOT = TUNING.foot;
const BODY = FOOT.bodyRadius;
/** Where a straight walk north from z 1150 on Home Knoll meets nothing all the way into the lake (as `foot.test.ts`). */
const CLEAR_LANE_X = -2.5;
const NORTH: Partial<StepInput> = { moveY: 1, cameraYaw: 0 };

function onHomeKnoll(): GameState {
  const state = newGame();
  teleport(state, 'home_knoll', CLEAR_LANE_X, 1150);
  state.players[0].heading = 0;
  Object.assign(state.players[0], { hunger: 100, thirst: 100, energy: 100 });
  state.weather.secondsRemaining = 99999;
  drainEvents(state);
  return state;
}

/** One step of the rules with these keys. */
function one(state: GameState, input: Partial<StepInput> = {}): PlayerState {
  step(state, { ...NEUTRAL_INPUT, ...input }, FIXED_STEP);
  return state.players[0];
}

/** Steps with these keys; the height of the feet after each. */
function heights(state: GameState, input: Partial<StepInput>, steps: number): number[] {
  return Array.from({ length: steps }, () => leapHeight(one(state, input).leap));
}

const place = (state: GameState): { x: number; z: number } => ({ x: state.players[0].position.x, z: state.players[0].position.z });
const apart = (first: { x: number; z: number }, second: { x: number; z: number }): number => Math.hypot(second.x - first.x, second.z - first.z);

/** Nothing but this one tree near a walk at it from the west, on dry, gentle ground (as `solids.test.ts`). */
function loneTree(): SolidCircle {
  const { circles } = solidIndex();
  for (const tree of circles) {
    if (tree.kind !== 'spruce' && tree.kind !== 'pine' && tree.kind !== 'birch') continue;
    let fine = true;
    for (let along = -5; along <= 5 && fine; along += 0.25) {
      for (const across of [-1.6, -0.8, 0, 0.8, 1.6]) {
        const x = tree.x + along;
        const z = tree.z + across;
        if (terrainHeight(x, z) < 0.3 || !canWalk(x, z, x + 0.25, z)) fine = false;
        if (circles.some((other) => other !== tree && Math.hypot(other.x - x, other.z - z) < other.radius + BODY * 2)) fine = false;
        if (Math.hypot(tree.x - x, tree.z - z) > tree.radius + BODY * 2 && bodyBlocked(x, z, BODY * 2)) fine = false;
      }
    }
    if (fine) return tree;
  }
  throw new Error('no lone tree');
}

/** The same numbers every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('the jump, by the numbers', () => {
  it('leaves the ground on the step the key arrives, tops out at 0.9 m and is down half a second later', () => {
    const state = onHomeKnoll();
    expect(state.players[0].leap).toBeUndefined();
    const up = heights(state, { jump: true }, 1);
    const rest = heights(state, {}, 59);
    const all = [...up, ...rest];
    // Off the ground at once: the very first step.
    expect(all[0]).toBeGreaterThan(0.1);
    const top = Math.max(...all);
    const topStep = all.indexOf(top) + 1;
    const air = all.filter((height) => height > 0).length;
    const landed = all.findIndex((height, index) => index > 0 && height === 0) + 1;
    console.log(`JUMP standing: ${all[0].toFixed(3)} m after the first step, top ${top.toFixed(3)} m at step ${topStep} (${(topStep * FIXED_STEP).toFixed(3)} s), `
      + `feet down at step ${landed} (${(landed * FIXED_STEP).toFixed(3)} s), off the ground for ${air} steps`);
    expect(top).toBeCloseTo(0.9, 9);
    expect(topStep).toBe(LEAP_RISE_STEPS);
    expect(landed).toBe(LEAP_AIR_STEPS);
    expect(landed * FIXED_STEP).toBeCloseTo(0.5, 9);
    expect(LEAP_RISE_STEPS).toBe(16);
    expect(LEAP_FALL_STEPS).toBe(14);
    // Up all the way to the top, down all the way after it, and never a step of more than 13 cm.
    for (let index = 1; index < landed; index += 1) {
      if (index < topStep) expect(all[index]).toBeGreaterThan(all[index - 1]);
      else expect(all[index]).toBeLessThan(all[index - 1]);
      expect(Math.abs(all[index] - all[index - 1])).toBeLessThan(0.13);
    }
    // Then nothing: it stays down, and a standing jump went nowhere.
    expect(all.slice(landed)).toEqual(Array(60 - landed).fill(0));
    expect(apart(place(state), { x: CLEAR_LANE_X, z: 1150 })).toBe(0);
  });

  it('carries a walk 1.3 m and a run 2.2 m: the speed it took off with, kept, the keys down or up', () => {
    for (const [name, keys, speed] of [['walk', { ...NORTH }, FOOT.walkSpeed], ['run', { ...NORTH, run: true }, FOOT.runSpeed]] as const) {
      const jumper = onHomeKnoll();
      const walker = onHomeKnoll();
      const letGo = onHomeKnoll();
      for (let count = 0; count < 60; count += 1) {
        one(jumper, keys);
        one(walker, keys);
        one(letGo, keys);
      }
      const from = place(jumper);
      // The key goes down for three steps (a tap), the walk carries on.
      for (let count = 0; count < LEAP_AIR_STEPS; count += 1) {
        one(jumper, { ...keys, jump: count < 3 });
        one(walker, keys);
        // A jumper is exactly where the walker beside it is: the jump neither adds nor costs a centimetre.
        expect(apart(place(jumper), place(walker))).toBe(0);
        expect(airborne(jumper.players[0].leap)).toBe(count < LEAP_AIR_STEPS - 1);
        // The third lets go of every key the step after take-off. In the air it is carried just as far, at the speed
        // it took off with; the step its feet come down on is the first it slows on.
        if (count < LEAP_AIR_STEPS - 1) {
          one(letGo, count === 0 ? { ...keys, jump: true } : {});
          expect(apart(place(letGo), place(jumper))).toBeLessThan(1e-9);
          expect(letGo.players[0].gait!.speed).toBeCloseTo(speed, 9);
        }
      }
      const distance = apart(from, place(jumper));
      console.log(`JUMP at a ${name}: ${distance.toFixed(3)} m over the ground from take-off to landing (${speed} m/s for 0.5 s is ${(speed * 0.5).toFixed(2)})`);
      expect(distance).toBeCloseTo(speed * 0.5, 6);
      one(letGo);
      expect(airborne(letGo.players[0].leap)).toBe(false);
      expect(letGo.players[0].gait!.speed).toBeCloseTo(speed - FOOT.braking * FIXED_STEP, 9);
      // No stumble on landing: the walk that held its keys goes on at full speed on the very next step.
      const before = place(jumper);
      one(jumper, keys);
      expect(apart(before, place(jumper))).toBeCloseTo(speed * FIXED_STEP, 9);
    }
  });

  it('a little steering in the air: a standing jump drifts under half a metre, and turns a fifth as fast', () => {
    const state = onHomeKnoll();
    one(state, { jump: true });
    for (let count = 1; count < LEAP_AIR_STEPS; count += 1) one(state, { ...NORTH });
    const drift = apart(place(state), { x: CLEAR_LANE_X, z: 1150 });
    console.log(`JUMP standing, forward held in the air: ${drift.toFixed(3)} m of drift, landing at ${state.players[0].gait!.speed.toFixed(2)} m/s`);
    expect(drift).toBeGreaterThan(0.2);
    expect(drift).toBeLessThan(0.5);
    // Turning: a quarter turn asked for in the air comes to 72 degrees at most by the landing; on the ground it takes 8 steps.
    const turner = onHomeKnoll();
    for (let count = 0; count < 60; count += 1) one(turner, NORTH);
    one(turner, { ...NORTH, jump: true });
    for (let count = 1; count < LEAP_AIR_STEPS - 1; count += 1) one(turner, { moveX: 1, cameraYaw: 0 });
    expect(airborne(turner.players[0].leap)).toBe(true);
    const turned = turner.players[0].heading;
    console.log(`JUMP walking, a quarter turn asked in the air: turned ${(turned * 180 / Math.PI).toFixed(1)} degrees by the landing`);
    expect(turned).toBeGreaterThan(0.5);
    expect(turned).toBeLessThanOrEqual(FOOT.turnRate * FOOT.jumpAirControl * (LEAP_AIR_STEPS - 1) * FIXED_STEP + 1e-9);
    // And it kept its walking speed through the turn: nothing brakes in the air.
    expect(turner.players[0].gait!.speed).toBeCloseTo(FOOT.walkSpeed, 9);
  });

  it('one press is one jump: the key held does not jump again, and a press early in the air is no second jump', () => {
    const held = onHomeKnoll();
    const tall = heights(held, { jump: true }, 180);
    expect(tall.filter((height, index) => height > 0 && (index === 0 || tall[index - 1] === 0))).toHaveLength(1);
    expect(held.players[0].leap).toEqual({ steps: LEAP_AIR_STEPS + LEAP_LAND_STEPS, held: true, again: false });
    // Let go, press: the next jump, on that step.
    one(held);
    expect(held.players[0].leap).toBeUndefined();
    expect(leapHeight(one(held, { jump: true }).leap)).toBeGreaterThan(0.1);

    // A second press on the way up changes nothing about the jump: the same heights as one press.
    const once = onHomeKnoll();
    const twice = onHomeKnoll();
    const plain = [...heights(once, { jump: true }, 2), ...heights(once, {}, 58)];
    const mashed = [...heights(twice, { jump: true }, 2), ...heights(twice, {}, 4), ...heights(twice, { jump: true }, 3), ...heights(twice, {}, 51)];
    expect(mashed).toEqual(plain);
    expect(Math.max(...mashed)).toBeCloseTo(0.9, 9);
  });

  it('a press in the last tenth of a second of the fall jumps again on landing', () => {
    const state = onHomeKnoll();
    heights(state, { jump: true }, 2);
    heights(state, {}, LEAP_AIR_STEPS - 2 - 4);
    expect(airborne(state.players[0].leap)).toBe(true);
    // Four steps before the feet are down: a tap.
    const tail = [...heights(state, { jump: true }, 2), ...heights(state, {}, 2)];
    expect(tail[3]).toBe(0);
    expect(state.players[0].leap!.again).toBe(true);
    // The step after the landing is the first of the next jump.
    expect(leapHeight(one(state).leap)).toBeGreaterThan(0.1);
    expect(state.players[0].leap).toEqual({ steps: 1, held: false, again: false });
    // A press too early in the fall is not kept.
    const early = onHomeKnoll();
    heights(early, { jump: true }, 2);
    heights(early, {}, 10);
    heights(early, { jump: true }, 2);
    const after = heights(early, {}, 60);
    expect(Math.max(...after.slice(LEAP_AIR_STEPS - 14))).toBe(0);
  });

  it('the state keeps the ground\'s height all through: the height of the jump is not in the position', () => {
    const state = onHomeKnoll();
    for (let count = 0; count < 200; count += 1) {
      const player = one(state, { ...NORTH, run: count > 100, jump: count % 45 < 3 });
      expect(player.position.y).toBe(groundHeight(player.position.x, player.position.z));
    }
  });
});

describe('the jump keeps to the walking rules', () => {
  it('against a tree: a jumper is never in the trunk, and one pushing at it is exactly where a walker pushing at it is', () => {
    const tree = loneTree();
    const touching = tree.radius + BODY;
    const at = (): GameState => {
      const state = newGame(7);
      standOn(state, tree.islandId);
      state.weather.secondsRemaining = 99999;
      const x = tree.x - 4;
      Object.assign(state.players[0], { mode: 'foot', seat: null, islandId: tree.islandId, position: { x, y: terrainHeight(x, tree.z), z: tree.z }, hunger: 100, thirst: 100, energy: 100 });
      return state;
    };
    const away = (state: GameState): number => Math.hypot(state.players[0].position.x - tree.x, state.players[0].position.z - tree.z);
    // East, straight at its middle.
    const east = (run: boolean): Partial<StepInput> => ({ moveY: 1, cameraYaw: Math.PI / 2, run });

    // Jumping all the way in, at a walk and at a run, a jump every 0.6 s: at the top of a jump against the trunk, never in it.
    for (const run of [false, true]) {
      const state = at();
      let nearest = Infinity;
      let jumps = 0;
      let highAtTree = 0;
      for (let count = 0; count < 6 * 60; count += 1) {
        const before = state.players[0].leap;
        const player = one(state, { ...east(run), jump: count % 36 < 4 });
        if (airborne(player.leap) && !airborne(before)) jumps += 1;
        nearest = Math.min(nearest, away(state));
        if (away(state) < touching + 0.05) highAtTree = Math.max(highAtTree, leapHeight(player.leap));
        expect(away(state)).toBeGreaterThanOrEqual(touching - 1e-9);
        expect(bodyBlocked(player.position.x, player.position.z)).toBe(false);
        state.players[0].energy = 100;
      }
      console.log(`JUMP at a tree, ${run ? 'running' : 'walking'}: ${jumps} jumps, nearest ${nearest.toFixed(3)} m from its middle (touching is ${touching.toFixed(3)}), up to ${highAtTree.toFixed(2)} m high against it`);
      expect(jumps).toBe(10);
      expect(highAtTree).toBeGreaterThan(0.8);
    }

    // A walker straight at its middle is held there (`solids.test.ts`). Jumping against it changes nothing: after five
    // seconds of jumps the jumper stands on the very spot the walker beside it stands on, west of the tree.
    const walker = at();
    const jumper = at();
    for (let count = 0; count < 3 * 60; count += 1) {
      one(walker, east(false));
      one(jumper, east(false));
    }
    expect(away(walker)).toBeLessThan(touching + 0.1);
    let top = 0;
    for (let count = 0; count < 5 * 60; count += 1) {
      one(walker, east(false));
      top = Math.max(top, leapHeight(one(jumper, { ...east(false), jump: count % 36 < 4 }).leap));
      expect(apart(place(jumper), place(walker))).toBe(0);
    }
    expect(top).toBeCloseTo(0.9, 9);
    expect(jumper.players[0].position.x).toBeLessThan(tree.x);
    console.log(`JUMP pushing at a tree: after 5 s of jumps the jumper is ${apart(place(jumper), place(walker)).toFixed(3)} m from a walker pushing at it, ${away(jumper).toFixed(3)} m from its middle`);
  });

  it('at a shore: jump after jump into the lake stops at wading depth, as a walk does', () => {
    const jumper = onHomeKnoll();
    const walker = onHomeKnoll();
    let deepest = 0;
    for (let count = 0; count < 60 * 60; count += 1) {
      const player = one(jumper, { ...NORTH, jump: count % 36 < 4 });
      one(walker, NORTH);
      deepest = Math.min(deepest, groundHeight(player.position.x, player.position.z));
    }
    console.log(`JUMP into the lake: deepest ground under the jumper ${deepest.toFixed(3)} m (wading depth is ${FOOT.wadeDepth}), `
      + `${apart(place(jumper), place(walker)).toFixed(3)} m from where a walker stops`);
    expect(deepest).toBeLessThan(-0.3);
    expect(deepest).toBeGreaterThanOrEqual(-FOOT.wadeDepth - 1e-9);
    // Stopped at the very line a walker stops at, the key still down.
    expect(apart(place(jumper), place(walker))).toBeLessThan(0.05);
    const stopped = place(jumper);
    for (let count = 0; count < 120; count += 1) one(jumper, { ...NORTH, jump: count % 36 < 4 });
    expect(apart(stopped, place(jumper))).toBeLessThan(0.05);
  });

  it('every step a jumper takes is a step a walker may take: no bank too steep, no water too deep, no solid entered', () => {
    for (const islandId of ['home_knoll', 'cabin_roofs'] as const) {
      const state = newGame(7);
      standOn(state, islandId);
      state.weather.secondsRemaining = 99999;
      const random = seeded(31);
      let keys: Partial<StepInput> = {};
      let inAir = 0;
      let moved = 0;
      for (let count = 0; count < 4 * 60 * 60; count += 1) {
        if (count % 40 === 0) keys = { moveY: 1, cameraYaw: random() * Math.PI * 2, run: random() < 0.5 };
        const from = place(state);
        const wasIn = bodyBlocked(from.x, from.z);
        const player = one(state, { ...keys, jump: random() < 0.3 });
        Object.assign(player, { hunger: 100, thirst: 100, energy: 100 });
        const to = place(state);
        if (airborne(player.leap)) inAir += 1;
        if (to.x === from.x && to.z === from.z) continue;
        moved += 1;
        expect(canWalk(from.x, from.z, to.x, to.z)).toBe(true);
        if (!wasIn) expect(bodyBlocked(to.x, to.z)).toBe(false);
      }
      expect(inAir).toBeGreaterThan(4000);
      expect(moved).toBeGreaterThan(4000);
    }
  });

  it('the roof corner at Cabin Roofs holds a jumper as it holds a walker: a jump does not free them, another way does', async () => {
    const wedged = import.meta.glob<string>('./fixtures/wedged-*.json', { eager: true, query: '?raw', import: 'default' });
    const loaded = deserialize(wedged['./fixtures/wedged-cabin-roofs.json']);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const corner = place(loaded.state);
    const push: Partial<StepInput> = { moveX: 0.64, moveY: 0.77, cameraYaw: 0 };
    const game = structuredClone(loaded.state);
    let jumps = 0;
    for (let count = 0; count < 3 * 60; count += 1) {
      const before = game.players[0].leap;
      const player = one(game, { ...push, jump: count % 36 < 4 });
      if (airborne(player.leap) && !airborne(before)) jumps += 1;
    }
    const held = apart(corner, place(game));
    console.log(`JUMP in the roof corner: ${jumps} jumps with the key held toward it, moved ${held.toFixed(3)} m`);
    expect(jumps).toBe(5);
    expect(held).toBeLessThan(0.01);
    // Any other way out still works, jumping or not.
    const out = structuredClone(loaded.state);
    for (let count = 0; count < 120; count += 1) one(out, { moveX: -0.64, moveY: -0.77, cameraYaw: 0, jump: count < 3 });
    expect(apart(corner, place(out))).toBeGreaterThan(0.5);
  });

  it('no jump aboard, asleep or in a talk: the key does nothing there', () => {
    // Aboard: the same canoe, step for step, with the key and without it.
    const keyed = newGame(7);
    const plain = newGame(7);
    floatCanoeAt(keyed, 200, 1300, 0);
    floatCanoeAt(plain, 200, 1300, 0);
    for (let count = 0; count < 120; count += 1) {
      step(keyed, { ...NEUTRAL_INPUT, paddle: 1, jump: true }, FIXED_STEP);
      step(plain, { ...NEUTRAL_INPUT, paddle: 1 }, FIXED_STEP);
      expect(keyed.players[0].leap).toBeUndefined();
    }
    expect(hashState(keyed)).toBe(hashState(plain));

    // Asleep, and in a talk: the rules hand a held player no keys at all.
    for (const hold of [{ asleep: true }, { dialogue: { npcId: 'odile' as const, nodeId: Object.keys(NPCS.odile.nodes)[0]! } }]) {
      const state = onHomeKnoll();
      Object.assign(state.players[0], hold);
      for (let count = 0; count < 60; count += 1) expect(one(state, { ...NORTH, jump: true }).leap).toBeUndefined();
      expect(apart(place(state), { x: CLEAR_LANE_X, z: 1150 })).toBe(0);
    }
  });

  it('a jump cut short ends on the ground: boarding, being put somewhere else, going away', () => {
    // Put somewhere else in the air (a fail washes a player ashore): on the ground there, no jump carried over.
    const moved = onHomeKnoll();
    heights(moved, { jump: true }, 2);
    heights(moved, {}, 8);
    expect(airborne(moved.players[0].leap)).toBe(true);
    teleport(moved, 'home_knoll', CLEAR_LANE_X + 3, 1150);
    expect(one(moved).leap).toBeUndefined();
    expect(heights(moved, {}, 40).every((height) => height === 0)).toBe(true);

    // Going away in the air: put down at once, and nothing pending when they come back.
    const away = onHomeKnoll();
    heights(away, { jump: true }, 10);
    expect(airborne(away.players[0].leap)).toBe(true);
    setConnected(away, 0, false);
    expect(away.players[0].leap).toBeUndefined();

    // Boarding in the air: aboard, and when they step ashore again they stand.
    const boarder = newGame(7);
    standOn(boarder, 'home_knoll');
    heights(boarder, { jump: true }, 6);
    expect(airborne(boarder.players[0].leap)).toBe(true);
    expect(dispatch(boarder, { type: 'board' }).ok).toBe(true);
    for (let count = 0; count < 30; count += 1) one(boarder);
    expect(dispatch(boarder, { type: 'disembark' }).ok).toBe(true);
    expect(heights(boarder, {}, 40).every((height) => height === 0)).toBe(true);
    expect(boarder.players[0].leap).toBeUndefined();
  });
});

describe('nothing of a jump is left behind', () => {
  it('a player who never jumps carries no jump: the state is what it was before jumping existed', () => {
    const state = onHomeKnoll();
    for (let count = 0; count < 300; count += 1) one(state, { ...NORTH, run: count > 150 });
    expect('leap' in state.players[0]).toBe(false);
    expect(JSON.stringify(state)).not.toContain('leap');
    // And after a jump is over and the key is up, it is gone again.
    heights(state, { jump: true }, 3);
    heights(state, {}, LEAP_AIR_STEPS + LEAP_LAND_STEPS);
    expect('leap' in state.players[0]).toBe(false);
  });

  it('the knees give for 0.15 s after the landing, on the ground, and then the jump is over', () => {
    const state = onHomeKnoll();
    heights(state, { jump: true }, 1);
    heights(state, {}, LEAP_AIR_STEPS - 1);
    expect(state.players[0].leap!.steps).toBe(LEAP_AIR_STEPS);
    expect(LEAP_LAND_STEPS).toBe(9);
    for (let count = 1; count < LEAP_LAND_STEPS; count += 1) {
      const leap = one(state).leap!;
      expect(leap.steps).toBe(LEAP_AIR_STEPS + count);
      expect(leapHeight(leap)).toBe(0);
      expect(airborne(leap)).toBe(false);
    }
    expect(one(state).leap).toBeUndefined();
    // On the ground through the landing, a new press jumps at once: the landing holds nobody.
    const quick = onHomeKnoll();
    heights(quick, { jump: true }, 1);
    heights(quick, {}, LEAP_AIR_STEPS + 1);
    expect(quick.players[0].leap!.steps).toBe(LEAP_AIR_STEPS + 2);
    expect(leapHeight(one(quick, { jump: true }).leap)).toBeGreaterThan(0.1);
  });

  it('a save made in the air loads, and the jump lands; a save from before jumping loads as it was', () => {
    const state = onHomeKnoll();
    heights(state, { jump: true }, 10);
    const loaded = deserialize(serialize(state, 0));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.state.players[0].leap).toEqual(state.players[0].leap);
    const after = heights(loaded.state, {}, 40);
    expect(after[0]).toBeGreaterThan(0.5);
    expect(after.slice(LEAP_AIR_STEPS - 10)).toEqual(Array(40 - (LEAP_AIR_STEPS - 10)).fill(0));
    // No field, no jump: a state with none steps exactly as one that never heard of jumping.
    const older = onHomeKnoll();
    const reloaded = deserialize(serialize(older, 0));
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    for (let count = 0; count < 120; count += 1) {
      one(older, NORTH);
      one(reloaded.state, NORTH);
    }
    expect(hashState(reloaded.state)).toBe(hashState(older));
  });

  it('the bot never asks for a jump', () => {
    const game = newGame(3);
    const driver = createBotDriver(game, { log: () => undefined });
    for (let count = 0; count < 20 * 60 * 60; count += 1) {
      const input = driver.next();
      if (!input) break;
      const inputs = Array.isArray(input) ? input : [input];
      for (const each of inputs) expect((each as StepInput | undefined)?.jump).toBeUndefined();
      step(game, input, FIXED_STEP);
      drainEvents(game);
    }
    expect(JSON.stringify(game)).not.toContain('leap');
    expect(game.players[0].mode === 'foot' || game.statistics.distanceWalked > 0).toBe(true);
  });
});

describe('a jump between two states (a crewmate on a guest\'s screen)', () => {
  it('is placed between them: rising from the ground, running out to its end, never backwards', () => {
    const at = (steps: number) => ({ steps, held: false, again: false });
    expect(blendLeap(undefined, undefined, 0.5)).toBeUndefined();
    // Took off in between: half way to where the newer state has it.
    expect(blendLeap(undefined, at(4), 0.5)).toEqual(at(2));
    expect(blendLeap(at(4), at(8), 0.25)).toEqual(at(5));
    // Over in between (the newer state has none): it runs out, then it is gone.
    const done = LEAP_AIR_STEPS + LEAP_LAND_STEPS;
    expect(blendLeap(at(done - 4), undefined, 0.5)).toEqual(at(done - 2));
    expect(blendLeap(at(done - 4), undefined, 1)).toBeUndefined();
    // A new jump begun in between: shown as the newer state has it, not run backwards.
    expect(blendLeap(at(LEAP_AIR_STEPS + 3), at(2), 0.5)).toEqual(at(2));
    // The key still down on the ground stays just that.
    const parked = { steps: done, held: true, again: false };
    expect(blendLeap(parked, parked, 0.5)).toBe(parked);
    // The heights between two states a tenth of a second apart climb evenly.
    const between = [0, 0.25, 0.5, 0.75, 1].map((share) => leapHeight(blendLeap(at(2), at(8), share)));
    for (let index = 1; index < between.length; index += 1) expect(between[index]).toBeGreaterThan(between[index - 1]);
  });
});
