/**
 * A guest's own walking: on its own screen at once, where the host then puts
 * it, with nothing to put right. On a clean line and on a bad one, against the
 * shore, across a command, and against a guest that lies. Loopback wires.
 *
 * Lines that begin `WALK` are the numbers for the report.
 */
import { describe, expect, it } from 'vitest';
import { ISLANDS_BY_ID, TUNING, spotPosition } from '../../src/data/index.ts';
import {
  PROTOCOL_VERSION, WALK_AHEAD_STEPS, WALK_BACKLOG_STEPS, WALK_CUT_METRES, WalkStream, WalkTimeline, createLoopbackPair,
  readClientMessage, readWalkRun,
} from '../../src/net/index.ts';
import type { GuestOptions, LoopbackConditions } from '../../src/net/index.ts';
import { COAST_STEPS, HOLD_INPUT, LEAP_TAIL_STEPS } from '../../src/net/walk.ts';
import {
  FIXED_STEP, LEAP_AIR_STEPS, LEAP_COAST_STEPS, LEAP_LAND_STEPS, NEUTRAL_INPUT, airborne, drainEvents, groundHeight, hashState, leapHeight,
  selectInteractable, step, stepOnFoot, terrainHeight,
} from '../../src/sim/index.ts';
import type { GameState, PlayerState, StepInput } from '../../src/sim/index.ts';
import { newGame, standOn } from '../support.ts';
import { createRig, key } from './rig.ts';
import type { Rig, Seat } from './rig.ts';

const v = PROTOCOL_VERSION;
const CLEAN: Partial<LoopbackConditions> = { delay: 0.03 };
/** The bad line of the brief: 120 ms each way, one message in five lost. */
const BAD: Partial<LoopbackConditions> = { delay: 0.12, loss: 0.2 };
/** Worse: the same with up to 100 ms more on any message, so they also arrive out of order. */
const ROUGH: Partial<LoopbackConditions> = { delay: 0.12, jitter: 0.1, loss: 0.2 };
const WALK_STEP = TUNING.foot.walkSpeed * FIXED_STEP;
const RUN_STEP = TUNING.foot.runSpeed * FIXED_STEP;
/** The furthest a runner slides after letting go: the sum of the steps it slows over. */
const RUN_SLIDE = Array.from({ length: COAST_STEPS }, (_, index) => Math.max(0, TUNING.foot.runSpeed - (index + 1) * TUNING.foot.braking * FIXED_STEP) * FIXED_STEP)
  .reduce((sum, metres) => sum + metres, 0);

/** Where the rules alone take a copy of a player over these inputs, one step each: what a solo player would do. */
function soloWalk(game: GameState, player: PlayerState, inputs: Partial<StepInput>[]): PlayerState {
  const copy: PlayerState = structuredClone(player);
  const sink: GameState = structuredClone(game);
  for (const input of inputs) stepOnFoot(sink, copy, { ...NEUTRAL_INPUT, ...input }, FIXED_STEP);
  return copy;
}

/**
 * After a command is asked for, the figure's walk is let go of until the answer: it slows to a stand where it is
 * (no further than a run's slide) and stays there. It never walks on and gets pulled back.
 */
function slowsToAStand(asked: { x: number; z: number }, positions: { x: number; z: number }[]): void {
  let last = 0;
  positions.forEach((position, index) => {
    const away = gap(asked, position);
    expect(away).toBeLessThanOrEqual(RUN_SLIDE + 1e-9);
    expect(away).toBeGreaterThanOrEqual(last - 1e-9);
    if (index >= COAST_STEPS) expect(away).toBe(last);
    last = away;
  });
}

const camp = () => spotPosition(ISLANDS_BY_ID.home_knoll, ISLANDS_BY_ID.home_knoll.camp!.spot);

/** The canoe beached at Home Knoll, the first quest behind the crew. */
function campGame(): GameState {
  const game = newGame(7);
  standOn(game, 'home_knoll');
  game.quests.bail_out.status = 'completed';
  game.quests.first_haul.status = 'active';
  game.weather.secondsRemaining = 99999;
  drainEvents(game);
  return game;
}

/** Everyone on foot in a row by the fire, fed and rested. */
function seatByFire(game: GameState): void {
  const fire = camp();
  game.players.forEach((player, index) => {
    const x = fire.x + 1 + index * 0.9;
    Object.assign(player, {
      mode: 'foot', seat: null, islandId: 'home_knoll', position: { x, y: terrainHeight(x, fire.z), z: fire.z },
      hunger: 100, thirst: 100, energy: 100,
    });
  });
}

interface Ashore {
  rig: Rig;
  sam: Seat;
  /** Where the host has the guest's player. */
  host(): { x: number; y: number; z: number };
  /** Where the guest's own screen draws it. */
  shown(): { x: number; y: number; z: number };
  frame(): void;
}

/** A host and one guest, both on foot by the fire, the guest holding the host's state. */
function ashore(conditions: Partial<LoopbackConditions> = CLEAN, guest: Partial<GuestOptions> = {}): Ashore {
  const rig = createRig({ game: campGame() });
  const sam = rig.join('Sam', undefined, conditions, guest);
  rig.run(3);
  expect(sam.link.status).toBe('playing');
  seatByFire(rig.game);
  rig.run(3);
  return {
    rig, sam,
    host: () => rig.game.players[1]!.position,
    shown: () => sam.link.view()!.players[1]!.position,
    frame: () => rig.run(FIXED_STEP),
  };
}

const gap = (first: { x: number; z: number }, second: { x: number; z: number }): number => Math.hypot(second.x - first.x, second.z - first.z);
const bearing = (from: { x: number; z: number }, to: { x: number; z: number }): number => Math.atan2(to.x - from.x, -(to.z - from.z));

/** The same numbers every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Keys for a while: a direction that keeps near the fire, sometimes running, sometimes sideways, sometimes with the camera turning. */
function wander(random: () => number, from: { x: number; z: number }): { input: Partial<StepInput>; seconds: number; turn: number } {
  const home = camp();
  const far = gap(from, home) > 6;
  const yaw = far ? bearing(from, home) + (random() - 0.5) * 1.2 : random() * Math.PI * 2;
  const sideways = random() < 0.25;
  return {
    input: { moveY: sideways ? 0 : 1, moveX: sideways ? (random() < 0.5 ? 1 : -1) : (random() < 0.2 ? 1 : 0), run: random() < 0.3, cameraYaw: yaw },
    seconds: 0.2 + random() * 1.6,
    turn: !far && random() < 0.4 ? (random() - 0.5) * 0.06 : 0,
  };
}

describe('at once', () => {
  it('moves the guest\'s own figure on the frame the key goes down, whatever the line', () => {
    for (const delay of [0, 0.06, 0.12, 0.25]) {
      const { rig, sam, shown, frame } = ashore({ delay });
      const before = { ...shown() };
      const solo = soloWalk(rig.game, rig.game.players[1]!, [{ moveX: 1 }]);
      sam.input = { moveX: 1 };
      frame();
      const first = gap(before, shown());
      // One frame, one step of walking: the same as a solo player gets, eased in from a stand.
      expect(first).toBeGreaterThan(0);
      expect(first).toBeCloseTo(gap(before, solo.position), 12);
      console.log(`WALK first movement, ${delay * 1000} ms each way: 1 frame (${(first * 100).toFixed(2)} cm)`);
    }
  });

  it('without the layer the same key waits for the round trip and the view\'s beat', () => {
    for (const delay of [0, 0.06, 0.12, 0.25]) {
      const { sam, shown, frame } = ashore({ delay }, { predictWalk: false });
      const before = { ...shown() };
      sam.input = { moveX: 1 };
      let frames = 1;
      for (frame(); gap(before, shown()) < 1e-6 && frames < 600; frame()) frames += 1;
      expect(frames).toBeGreaterThan(delay * 2 * 60 + 4);
      console.log(`WALK first movement with the layer off, ${delay * 1000} ms each way: ${frames} frames (${Math.round(frames / 60 * 1000)} ms)`);
    }
  });

  it('walks as far each frame as the rules walk a solo player: no faster, no slower', () => {
    const { sam, shown, frame } = ashore({ delay: 0.12 });
    sam.input = { moveX: 1, run: true };
    let last = { ...shown() };
    for (let count = 0; count < 90; count += 1) {
      frame();
      expect(gap(last, shown())).toBeLessThanOrEqual(RUN_STEP + 1e-9);
      last = { ...shown() };
    }
  });
});

describe('true', () => {
  /** Walk and stop, over and over. Returns the worst distance from the host half a second after a stop, and the worst time to get within a centimetre. */
  function stops(conditions: Partial<LoopbackConditions>, cycles: number): { worstGap: number; worstSeconds: number; mismatches: number } {
    const { rig, sam, host, shown, frame } = ashore(conditions);
    const random = seeded(99);
    let worstGap = 0;
    let worstSeconds = 0;
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      const leg = wander(random, shown());
      sam.input = leg.input;
      for (let count = 0; count < Math.round(leg.seconds * 60); count += 1) frame();
      sam.input = {};
      let within = -1;
      for (let count = 1; count <= 30; count += 1) {
        frame();
        if (gap(host(), shown()) < 0.01) {
          if (within < 0) within = count;
        } else {
          within = -1;
        }
      }
      worstGap = Math.max(worstGap, gap(host(), shown()));
      worstSeconds = Math.max(worstSeconds, within < 0 ? Infinity : within / 60);
      for (const player of rig.game.players) Object.assign(player, { hunger: 100, thirst: 100, energy: 100 });
      rig.run(0.3);
    }
    expect(rig.settle()).toBe(true);
    return { worstGap, worstSeconds, mismatches: sam.link.mismatches };
  }

  it('half a second after the guest stops, its figure is where the host has it: on a clean line', () => {
    const result = stops(CLEAN, 60);
    console.log(`WALK after a stop, clean line, 60 stops: worst ${(result.worstGap * 100).toFixed(3)} cm at 0.5 s, within 1 cm after ${result.worstSeconds.toFixed(3)} s at worst`);
    expect(result.worstGap).toBeLessThan(0.01);
    expect(result.mismatches).toBe(0);
  });

  it('and on a bad one (120 ms each way, one message in five lost)', () => {
    const result = stops(BAD, 120);
    console.log(`WALK after a stop, bad line, 120 stops: worst ${(result.worstGap * 100).toFixed(3)} cm at 0.5 s, within 1 cm after ${result.worstSeconds.toFixed(3)} s at worst`);
    expect(result.worstGap).toBeLessThan(0.01);
    expect(result.mismatches).toBe(0);
  });

  it('five minutes of walking on the bad line: never a jump, never backwards against the keys, and one fingerprint at the end', () => {
    for (const [name, line] of [['bad', BAD], ['rough', ROUGH]] as const) {
      const { rig, sam, host, shown, frame } = ashore(line);
      const random = seeded(7);
      let worstEase = 0;
      let worstSlip = 0;
      let worstFrame = 0;
      let worstBack = 0;
      let worstAhead = 0;
      let frames = 0;
      while (frames < 5 * 60 * 60) {
        const still = random() < 0.2;
        const leg = wander(random, shown());
        const input: Partial<StepInput> = still ? {} : { ...leg.input };
        for (let count = 0; count < Math.round(leg.seconds * 60); count += 1) {
          if (!still) input.cameraYaw = (input.cameraYaw ?? 0) + leg.turn;
          sam.input = { ...input };
          const before = { ...shown() };
          frame();
          frames += 1;
          const after = shown();
          const moved = gap(before, after);
          const own = sam.link.walk.walkedLastFrame;
          worstFrame = Math.max(worstFrame, moved);
          worstEase = Math.max(worstEase, sam.link.walk.eased);
          worstSlip = Math.max(worstSlip, sam.link.walk.slip);
          worstAhead = Math.max(worstAhead, gap(host(), after));
          const ownLength = Math.hypot(own.x, own.z);
          if (ownLength > 0) {
            // The way the figure's own walk goes this frame (it turns and eases, so not always the way the keys point).
            const along = ((after.x - before.x) * own.x + (after.z - before.z) * own.z) / ownLength;
            worstBack = Math.min(worstBack, along);
          }
          // Letting go: a few frames slowing to a stand, then only a little easing at most.
          if (still) expect(moved).toBeLessThanOrEqual(count < COAST_STEPS ? RUN_STEP + 0.03 : 0.03);
        }
        for (const player of rig.game.players) Object.assign(player, { hunger: 100, thirst: 100, energy: 100 });
      }
      sam.input = {};
      rig.run(0.5);
      const end = gap(host(), shown());
      expect(rig.settle()).toBe(true);
      console.log(`WALK five minutes, ${name} line: largest one-frame correction ${(worstEase * 100).toFixed(3)} cm, largest slip ${(worstSlip * 100).toFixed(3)} cm, `
        + `longest frame ${(worstFrame * 100).toFixed(2)} cm (a running step is ${(RUN_STEP * 100).toFixed(2)}), most backwards ${(worstBack * 100).toFixed(3)} cm, `
        + `cuts ${sam.link.walk.cuts}, furthest ahead of the host ${worstAhead.toFixed(2)} m, end ${(end * 100).toFixed(3)} cm from the host, mismatches ${sam.link.mismatches}`);
      // A few centimetres at most on top of the frame's own step, never back against the keys, never a cut.
      expect(worstEase).toBeLessThanOrEqual(0.03);
      expect(worstFrame).toBeLessThanOrEqual(RUN_STEP + 0.03);
      expect(worstBack).toBeGreaterThanOrEqual(-1e-9);
      expect(sam.link.walk.cuts).toBe(0);
      expect(end).toBeLessThan(0.01);
      expect(sam.link.mismatches).toBe(0);
      expect(hashState(sam.link.truth!)).toBe(rig.hostHash());
    }
  });

  it('writes nothing into the truth it holds: with the host\'s game standing still the figure walks on, and the truth stays the host\'s', () => {
    const { rig, sam, host, shown } = ashore(CLEAN);
    expect(rig.settle()).toBe(true);
    const at = { ...host() };
    const walkedFrom = rig.game.players[1]!.heading;
    sam.input = { moveX: 1 };
    for (let count = 0; count < 60; count += 1) {
      rig.stand(FIXED_STEP);
      // The view has caught up with the truth here, so the view is the truth's own object: the figure must be a copy on top of it.
      // (Drawn every frame, as a screen does.)
      shown();
      expect(sam.link.truth!.players[1]!.position).toEqual(at);
      expect(hashState(sam.link.truth!)).toBe(rig.hostHash());
    }
    expect(gap(at, shown())).toBeGreaterThan(2);
    expect(sam.link.mismatches).toBe(0);
    // The host steps again: it walks the guest the sixty steps it took and the ones it slowed over, to the spot the figure stands on.
    sam.input = {};
    rig.run(1.5);
    expect(gap(host(), shown())).toBeLessThan(1e-9);
    const solo = soloWalk(rig.game, { ...rig.game.players[1]!, position: { ...at }, gait: undefined, heading: walkedFrom }, [
      ...Array.from({ length: 60 }, () => ({ moveX: 1 })), ...Array.from({ length: COAST_STEPS }, () => ({})),
    ]);
    expect(gap(solo.position, host())).toBeLessThan(1e-9);
    expect(sam.link.mismatches).toBe(0);
  });

  it('is a layer: the truth the guest holds and the host\'s game are the same with it and without it', () => {
    const play = (predictWalk: boolean): { host: string; truth: string; shownAhead: number } => {
      const { rig, sam, shown, frame } = ashore(BAD, { predictWalk });
      const random = seeded(3);
      let shownAhead = 0;
      for (let leg = 0; leg < 20; leg += 1) {
        const next = wander(random, rig.game.players[1]!.position);
        sam.input = next.input;
        for (let count = 0; count < Math.round(next.seconds * 60); count += 1) {
          frame();
          shownAhead = Math.max(shownAhead, gap(sam.link.truth!.players[1]!.position, shown()));
        }
      }
      sam.input = {};
      expect(rig.settle()).toBe(true);
      expect(sam.link.mismatches).toBe(0);
      return { host: rig.hostHash(), truth: hashState(sam.link.truth!), shownAhead };
    };
    const on = play(true);
    const off = play(false);
    expect(on.truth).toBe(on.host);
    expect(off.truth).toBe(off.host);
    // The host's game does not know whether the guest draws its own walk early.
    expect(on.host).toBe(off.host);
    // And the layer was there: the figure was drawn well ahead of the truth.
    expect(on.shownAhead).toBeGreaterThan(0.5);
  });
});

describe('against the shore', () => {
  it('stops where the host stops it: not a step into deep water, and still once it is stopped', () => {
    for (const line of [CLEAN, BAD]) {
      const { rig, sam, host, shown, frame } = ashore(line);
      // Straight out past the canoe and into the lake.
      const out = bearing(camp(), rig.game.canoe.position);
      sam.input = { moveY: 1, cameraYaw: out };
      let worstEase = 0;
      let deepest = 0;
      const trail: number[] = [];
      for (let count = 0; count < 40 * 60; count += 1) {
        const before = { ...shown() };
        frame();
        const now = shown();
        trail.push(gap(before, now));
        worstEase = Math.max(worstEase, sam.link.walk.eased);
        deepest = Math.min(deepest, groundHeight(now.x, now.z));
      }
      // It got to the water and the rules stopped it at wading depth, on the guest's own screen too.
      expect(deepest).toBeLessThan(-0.3);
      expect(deepest).toBeGreaterThanOrEqual(-TUNING.foot.wadeDepth - 1e-9);
      // No pushing: nothing was eased. No shaking: over the last second the figure stood exactly still, the key still down.
      expect(worstEase).toBe(0);
      expect(Math.max(...trail.slice(-60))).toBe(0);
      expect(gap(host(), shown())).toBeLessThan(1e-9);
      sam.input = {};
      rig.run(0.5);
      expect(gap(host(), shown())).toBeLessThan(1e-9);
      expect(rig.settle()).toBe(true);
      expect(sam.link.mismatches).toBe(0);
    }
  });
});

describe('the host stays in charge', () => {
  /** A wire with no game behind it: whatever it sends is all the host knows of this guest. */
  function liar() {
    const rig = createRig({ game: campGame() });
    const pair = createLoopbackPair();
    rig.host.accept(pair.host);
    pair.guest.receive(() => {});
    pair.guest.send({ v, type: 'join', name: 'Mal', key: key('Mal') });
    pair.advance(0);
    seatByFire(rig.game);
    const player = rig.game.players[1]!;
    return { rig, pair, player, start: { ...player.position } };
  }
  const input = { ...NEUTRAL_INPUT, moveX: 1, run: true };

  it('takes no position from a guest: a message that carries one is refused whole', () => {
    const { rig, pair, player, start } = liar();
    const refused = rig.host.stats.refused;
    const there = { x: start.x + 500, y: 0, z: start.z };
    pair.guest.send({ v, type: 'input', seq: 1, have: -1, events: 0, input, step: 60, walk: [[0, 1, 0, 1, 0]], position: there });
    pair.guest.send({ v, type: 'input', seq: 2, have: -1, events: 0, input: { ...input, position: there }, step: 60, walk: [[0, 1, 0, 1, 0]] });
    pair.guest.send({ v, type: 'input', seq: 3, have: -1, events: 0, input, step: 60, walk: [[0, 1, 0, 1, 0, there.x]] });
    pair.guest.send({ v, type: 'input', seq: 4, have: -1, events: 0, input, step: 60, walk: [{ start: 0, x: there.x, z: there.z }] });
    pair.guest.send({ v, type: 'command', id: 1, command: { type: 'board' }, at: 0, position: there });
    pair.advance(0);
    rig.run(1);
    expect(rig.host.stats.refused).toBe(refused + 5);
    expect(player.position).toEqual(start);
  });

  it('walks a guest one step for each step of its own, at the rules\' speed, however many steps the guest claims', () => {
    const { rig, pair, player, start } = liar();
    // A million steps of running already taken, it says, with the stick pushed fifty times too far.
    pair.guest.send({ v, type: 'input', seq: 1, have: -1, events: 0, input, step: 1_000_000, walk: [[0, 50, 0, 1, 0]] });
    pair.advance(0);
    rig.run(1);
    const walked = gap(start, player.position);
    expect(walked).toBeGreaterThan(1);
    expect(walked).toBeLessThanOrEqual(TUNING.foot.runSpeed * 1 + 1e-9);
  });

  it('walks a guest through nothing the rules do not: the liar ends at wading depth like anyone', () => {
    const { rig, pair, player } = liar();
    const out = bearing(camp(), rig.game.canoe.position);
    for (let second = 0; second < 40; second += 1) {
      pair.guest.send({ v, type: 'input', seq: second + 1, have: -1, events: 0, input, step: (second + 2) * 60, walk: [[0, 0, 1, 1, out]] });
      pair.advance(0);
      for (const each of rig.game.players) Object.assign(each, { hunger: 100, thirst: 100, energy: 100 });
      rig.run(1);
    }
    expect(groundHeight(player.position.x, player.position.z)).toBeGreaterThanOrEqual(-TUNING.foot.wadeDepth - 1e-9);
    expect(groundHeight(player.position.x, player.position.z)).toBeLessThan(-0.3);
  });

  it('reads a stretch of walk strictly: five numbers, the axes clamped, standing still made plain', () => {
    expect(readWalkRun([3, 1, 0, 1, 0.5])).toEqual([3, 1, 0, 1, 0.5]);
    expect(readWalkRun([3, 9, -9, 0, 0.5])).toEqual([3, 1, -1, 0, 0.5]);
    expect(readWalkRun([3, 0, 0, 1, 0.5])).toEqual([3, 0, 0, 0, 0]);
    // The keys of a stretch: 1 the run key, 2 the jump key, 3 both. A jump on the spot is kept; a run on the spot is standing.
    expect(readWalkRun([3, 1, 0, 3, 0.5])).toEqual([3, 1, 0, 3, 0.5]);
    expect(readWalkRun([3, 1, 0, 2, 0.5])).toEqual([3, 1, 0, 2, 0.5]);
    expect(readWalkRun([3, 0, 0, 2, 0.5])).toEqual([3, 0, 0, 2, 0]);
    expect(readWalkRun([3, 0, 0, 3, 0.5])).toEqual([3, 0, 0, 2, 0]);
    for (const junk of [null, 5, {}, [], [1, 2, 3, 4], [1, 0, 0, 0, 0, 0], [-1, 0, 0, 0, 0], [1.5, 0, 0, 0, 0], [1, NaN, 0, 0, 0], [1, 0, 0, 4, 0], [1, 0, 0, -1, 0],
      [1, 0, 0, 1.5, 0], [1, 0, 0, true, 0],
      [1, 0, 0, 0, Infinity], [1, 0, 0, 0, 1e9], ['1', 0, 0, 0, 0]]) {
      expect(readWalkRun(junk)).toBeNull();
    }
    const message = (walk: unknown, step: unknown = 10) => readClientMessage({ v, type: 'input', seq: 1, have: 0, events: 0, input: { ...NEUTRAL_INPUT }, step, walk });
    expect(message([[2, 1, 0, 0, 0], [5, 0, 0, 0, 0]])).not.toBeNull();
    // The jump key in the input itself: true or false or left out, nothing else.
    const keyed = (jump: unknown) => readClientMessage({ v, type: 'input', seq: 1, have: 0, events: 0, input: { ...NEUTRAL_INPUT, jump }, step: 10, walk: [] });
    expect(keyed(true)).toMatchObject({ input: { jump: true } });
    expect(keyed(false)).not.toBeNull();
    expect('jump' in (keyed(false) as { input: object }).input).toBe(false);
    for (const junk of [1, 'yes', null, {}]) expect(keyed(junk)).toBeNull();
    // Out of order, twice the same step, from the future, too many, or no count of steps at all.
    expect(message([[5, 1, 0, 0, 0], [2, 0, 0, 0, 0]])).toBeNull();
    expect(message([[2, 1, 0, 0, 0], [2, 0, 0, 0, 0]])).toBeNull();
    expect(message([[10, 1, 0, 0, 0]])).toBeNull();
    expect(message(Array.from({ length: 7 }, (_, index) => [index, 1, 0, 0, index]))).toBeNull();
    expect(message([], -1)).toBeNull();
    expect(message([], 2.5)).toBeNull();
    expect(message('walk')).toBeNull();
    expect(readClientMessage({ v, type: 'command', id: 1, command: { type: 'board' } })).toBeNull();
    expect(readClientMessage({ v, type: 'command', id: 1, command: { type: 'board' }, at: -1 })).toBeNull();
  });
});

describe('the host\'s count of a guest\'s walk', () => {
  const forward: [number, number, number, number, number] = [0, 0, 1, 0, 0];

  it('hands out one step of the walk for each step the rules ran, and holds the player as they are when the walk has not arrived', () => {
    const line = new WalkTimeline(100);
    line.heard(3, [forward]);
    let tick = 100;
    const handed: boolean[] = [];
    for (let count = 0; count < 6; count += 1) {
      line.account(tick);
      const input = line.next(true);
      handed.push(input !== HOLD_INPUT);
      if (input === HOLD_INPUT) expect(input).toMatchObject({ hold: true, moveX: 0, moveY: 0 });
      tick += 1;
    }
    // Three steps known: three handed out, then nothing, however long the host goes on.
    expect(handed).toEqual([true, true, true, false, false, false]);
    expect(line.walked).toBe(3);
    // More of the walk arrives: it goes on from where it stood, no step skipped, none made up.
    line.heard(5, [forward]);
    line.account(tick);
    expect(line.next(true)).toMatchObject({ moveY: 1 });
    line.account(tick + 1);
    expect(line.walked).toBe(4);
  });

  it('passes over the steps the guest stood still on, and only those', () => {
    const line = new WalkTimeline(0);
    line.heard(500, [[0, 0, 0, 0, 0], [490, 0, 1, 0, 0]]);
    line.account(0);
    expect(line.next(true)).toMatchObject({ moveY: 1 });
    expect(line.walked).toBe(490);
    expect(line.reached(480)).toBe(true);
    expect(line.reached(495)).toBe(false);
  });

  it('walks the still steps a player slows over after letting go, one by one, and passes over only the ones after them', () => {
    const line = new WalkTimeline(0);
    // Forward for ten steps, then still: known up to step 100.
    line.heard(100, [[0, 0, 1, 0, 0], [10, 0, 0, 0, 0]]);
    const handed: string[] = [];
    for (let tick = 0; tick < 30; tick += 1) {
      line.account(tick);
      const input = line.next(true);
      handed.push(input === HOLD_INPUT ? 'hold' : input!.moveY === 1 ? 'walk' : 'still');
    }
    expect(handed.slice(0, 10)).toEqual(Array(10).fill('walk'));
    expect(handed.slice(10, 10 + COAST_STEPS)).toEqual(Array(COAST_STEPS).fill('still'));
    expect(handed.slice(10 + COAST_STEPS)).toEqual(Array(30 - 10 - COAST_STEPS).fill('hold'));
    expect(line.walked).toBe(100);
    // The count agrees: the slowing steps are owed, the rest are not.
    const stream = new WalkStream();
    stream.add({ start: 0, moveX: 0, moveY: 1, run: false, yaw: 0, jump: false });
    stream.add({ start: 10, moveX: 0, moveY: 0, run: false, yaw: 0, jump: false });
    expect(stream.movingSteps(0, 100)).toBe(10 + COAST_STEPS);
    expect(stream.movesBetween(10 + COAST_STEPS, 100)).toBe(false);
    expect(stream.movesBetween(10 + COAST_STEPS - 1, 100)).toBe(true);
    expect(COAST_STEPS).toBe(9);
  });

  it('aboard, the walk is not used and counts as walked', () => {
    const line = new WalkTimeline(0);
    line.heard(40, [forward]);
    expect(line.next(false)).toBeNull();
    expect(line.walked).toBe(40);
  });

  it('throws away a backlog longer than two seconds rather than play it out', () => {
    const line = new WalkTimeline(0);
    line.heard(1000, [forward]);
    line.account(0);
    line.next(true);
    expect(line.walked).toBe(1000 - WALK_BACKLOG_STEPS);
    expect(line.dropped).toBe(1000 - WALK_BACKLOG_STEPS);
  });

  it('keeps what was said first about a step', () => {
    const stream = new WalkStream();
    stream.add({ start: 4, moveX: 0, moveY: 1, run: false, yaw: 0, jump: false });
    stream.add({ start: 4, moveX: 1, moveY: 0, run: true, yaw: 2, jump: false });
    stream.add({ start: 2, moveX: -1, moveY: 0, run: false, yaw: 0, jump: false });
    expect(stream.runs.map((run) => run.start)).toEqual([2, 4]);
    expect(stream.at(9)).toMatchObject({ moveY: 1, run: false });
    expect(stream.at(1)).toMatchObject({ moveX: 0, moveY: 0 });
    expect(stream.movesBetween(0, 2)).toBe(false);
    expect(stream.movesBetween(0, 3)).toBe(true);
  });
});

describe('when guess and truth differ', () => {
  it('a small difference is eased out: no jump, and within a centimetre inside half a second', () => {
    const { rig, sam, host, shown, frame } = ashore(CLEAN);
    // The host has the player 30 cm from where the guest's screen has it (a lost stretch of walk would do this).
    rig.game.players[1]!.position.x += 0.3;
    let worstFrame = 0;
    let slip = 0;
    for (let count = 0; count < 30; count += 1) {
      const before = { ...shown() };
      frame();
      worstFrame = Math.max(worstFrame, gap(before, shown()));
      slip = Math.max(slip, sam.link.walk.slip);
    }
    expect(slip).toBeCloseTo(0.3, 6);
    expect(sam.link.walk.cuts).toBe(0);
    expect(worstFrame).toBeLessThan(0.06);
    expect(gap(host(), shown())).toBeLessThan(0.01);
  });

  it('while walking, the easing never turns the figure back against the keys', () => {
    const { rig, sam, shown, frame } = ashore(CLEAN);
    sam.input = { moveX: 1 };
    rig.run(1);
    // The host has the player a metre behind where the guest's screen has it.
    rig.game.players[1]!.position.x -= 1;
    for (let count = 0; count < 120; count += 1) {
      const before = shown().x;
      frame();
      expect(shown().x - before).toBeGreaterThan(0);
    }
    sam.input = {};
    rig.run(0.5);
    expect(gap(rig.game.players[1]!.position, shown())).toBeLessThan(0.01);
  });

  it('a big difference is a cut: the figure is where the host put it on the next frame, never in between', () => {
    const { rig, sam, host, shown, frame } = ashore(CLEAN);
    const from = { ...shown() };
    // Carried, as a fail carries a player: 5 m off, further than any slip.
    rig.game.players[1]!.position.x += 5;
    rig.game.players[1]!.position.y = terrainHeight(rig.game.players[1]!.position.x, rig.game.players[1]!.position.z);
    expect(5).toBeGreaterThan(WALK_CUT_METRES);
    for (let count = 0; count < 30; count += 1) {
      frame();
      const now = shown();
      // Only ever at one end.
      expect(Math.min(gap(from, now), gap(host(), now))).toBeLessThan(1e-9);
    }
    expect(gap(host(), shown())).toBeLessThan(1e-9);
    expect(sam.link.walk.cuts).toBe(1);
  });

  it('with the line dead, the figure walks a second and a half ahead and waits there; when the line is back the host walks it to that very spot', () => {
    const { rig, sam, host, shown } = ashore(CLEAN);
    sam.input = { moveX: 1 };
    rig.run(0.5);
    sam.pair.conditions.loss = 1;
    rig.run(2.5);
    const waiting = { ...shown() };
    rig.run(0.2);
    // It stopped, the key still down, no further ahead than the limit.
    expect(gap(waiting, shown())).toBe(0);
    expect(gap(host(), shown())).toBeLessThanOrEqual((WALK_AHEAD_STEPS + 1) * WALK_STEP);
    sam.input = {};
    sam.pair.conditions.loss = 0;
    let worstEase = 0;
    for (let count = 0; count < 180; count += 1) {
      rig.run(FIXED_STEP);
      worstEase = Math.max(worstEase, sam.link.walk.eased);
    }
    // Nothing to ease: the host walked the steps the guest took, and no others.
    expect(worstEase).toBe(0);
    expect(gap(waiting, shown())).toBe(0);
    expect(gap(host(), shown())).toBeLessThan(1e-9);
  });
});

describe('a host that draws slowly', () => {
  it('at 30 frames a second the host runs two steps on one input: a key change can slip by a step, eased, never a jump', () => {
    const game = campGame();
    const rig = createRig({ game });
    const sam = rig.join('Sam', undefined, { delay: 0.06 });
    rig.run(3);
    seatByFire(game);
    rig.run(3);
    const shown = () => sam.link.view()!.players[1]!.position;
    const random = seeded(5);
    let worstSlip = 0;
    let worstEase = 0;
    let worstFrame = 0;
    let worstStopped = 0;
    for (let leg = 0; leg < 200; leg += 1) {
      const next = wander(random, shown());
      const still = leg % 2 === 1;
      const frames = still ? 36 : Math.round(next.seconds * 30) * 2 + (leg % 4 === 0 ? 1 : 0);
      for (let count = 0; count < frames; count += 1) {
        // The host: one frame for every two of the guest's, two steps of the rules in it.
        sam.pair.advance(FIXED_STEP);
        if (count % 2 === 0) {
          step(game, rig.host.crewInput({ ...NEUTRAL_INPUT }, 0), 2 * FIXED_STEP);
          rig.host.afterFrame(drainEvents(game), 2 * FIXED_STEP);
        }
        const before = { ...shown() };
        sam.link.update(FIXED_STEP);
        sam.link.sendInput({ ...NEUTRAL_INPUT, ...(still ? {} : next.input) });
        sam.link.takeEvents();
        worstFrame = Math.max(worstFrame, gap(before, shown()));
        worstSlip = Math.max(worstSlip, sam.link.walk.slip);
        worstEase = Math.max(worstEase, sam.link.walk.eased);
      }
      if (still) worstStopped = Math.max(worstStopped, gap(game.players[1]!.position, shown()));
      for (const player of game.players) Object.assign(player, { hunger: 100, thirst: 100, energy: 100 });
    }
    console.log(`WALK host at 30 frames a second, 100 walks: largest slip ${(worstSlip * 100).toFixed(2)} cm, largest one-frame correction ${(worstEase * 100).toFixed(2)} cm, `
      + `longest frame ${(worstFrame * 100).toFixed(2)} cm, worst ${(worstStopped * 100).toFixed(3)} cm from the host 0.6 s after a stop, cuts ${sam.link.walk.cuts}`);
    // One running step at most, taken out a little a frame.
    expect(worstSlip).toBeLessThanOrEqual(2 * RUN_STEP);
    expect(worstEase).toBeLessThanOrEqual(0.03);
    expect(worstFrame).toBeLessThanOrEqual(RUN_STEP + 0.03);
    expect(worstStopped).toBeLessThan(0.01);
    expect(sam.link.walk.cuts).toBe(0);
    expect(sam.link.mismatches).toBe(0);
  });
});

describe('things done on foot', () => {
  /** A host and a guest just stepped out of the beached canoe. */
  function landed(conditions: Partial<LoopbackConditions>) {
    const rig = createRig({ game: campGame() });
    const sam = rig.join('Sam', undefined, conditions);
    rig.run(3);
    sam.link.sendCommand({ type: 'disembark' });
    rig.run(3);
    expect(rig.game.players[1]!.mode).toBe('foot');
    const view = () => sam.link.view()!;
    return { rig, sam, view, host: () => rig.game.players[1]!, shown: () => view().players[1]!.position, frame: () => rig.run(FIXED_STEP) };
  }

  it('a command is run where the guest stood when it asked, not where the host had it when the message came', () => {
    const { rig, sam, host, shown, frame } = landed({ delay: 0.12 });
    sam.input = { moveY: 1, cameraYaw: bearing(shown(), camp()) };
    rig.run(1);
    const asked = { ...shown() };
    const run = rig.host.stats.commandsRun;
    sam.link.sendCommand({ type: 'toggle_lantern' });
    let frames = 0;
    for (; rig.host.stats.commandsRun === run && frames < 120; frames += 1) frame();
    expect(rig.host.stats.commandsRun).toBe(run + 1);
    // The guest walked on; the host ran the command with the guest's player on the spot it was asked from.
    // (One step of the host's own had run by the time this test could look.)
    expect(gap(asked, host().position)).toBeLessThanOrEqual(WALK_STEP + 1e-9);
    expect(gap(asked, shown())).toBeGreaterThan(0.2);
  });

  it('the prompt the guest\'s own screen shows is one the host honours: boarding on the first frame it is offered', () => {
    for (const line of [CLEAN, BAD]) {
      const { rig, sam, view, host, shown, frame } = landed(line);
      // Up the beach until the canoe is out of reach, then back down to it.
      sam.input = { moveY: 1, cameraYaw: bearing(shown(), camp()) };
      for (let count = 0; count < 600 && selectInteractable(view(), 1)?.kind === 'board'; count += 1) frame();
      expect(selectInteractable(view(), 1)?.kind).not.toBe('board');
      rig.run(0.5);
      sam.input = { moveY: 1, cameraYaw: bearing(shown(), rig.game.canoe.position) };
      for (let count = 0; count < 600 && selectInteractable(view(), 1)?.kind !== 'board'; count += 1) frame();
      expect(selectInteractable(view(), 1)?.kind).toBe('board');
      // The key stays down, as a player's would.
      const asked = { ...shown() };
      sam.link.sendCommand({ type: 'board' });
      let worstEase = 0;
      const waiting: { x: number; z: number }[] = [];
      for (let count = 0; count < 120; count += 1) {
        frame();
        worstEase = Math.max(worstEase, sam.link.walk.eased);
        // Until the view shows it aboard, the figure slows to a stand where it asked from: it does not walk on and get pulled back.
        if (view().players[1]!.mode === 'foot') waiting.push({ ...shown() });
      }
      slowsToAStand(asked, waiting);
      expect(sam.results.at(-1)).toMatchObject({ command: { type: 'board' }, result: { ok: true } });
      expect(host().mode).toBe('canoe');
      expect(view().players[1]!.mode).toBe('canoe');
      expect(worstEase).toBe(0);
      expect(rig.settle()).toBe(true);
    }
  });

  it('a refusal leaves nothing stuck: the guest is told, and walks on', () => {
    const { rig, sam, shown, frame } = landed({ delay: 0.12 });
    sam.input = { moveY: 1, cameraYaw: bearing(shown(), camp()) };
    rig.run(4);
    // Out of reach of the canoe now. Ask to board anyway, the key still down.
    sam.link.sendCommand({ type: 'board' });
    const asked = { ...shown() };
    const waiting: { x: number; z: number }[] = [];
    for (let count = 0; count < 12; count += 1) {
      frame();
      waiting.push({ ...shown() });
    }
    // Asking lets go of the walk for a moment: if the host says yes, the figure must not have walked on, only slowed to a stand.
    slowsToAStand(asked, waiting);
    rig.run(0.4);
    expect(sam.results.at(-1)).toMatchObject({ command: { type: 'board' }, result: { ok: false, reason: 'not_at_canoe' } });
    expect(sam.link.commandsWaiting).toBe(0);
    // And it walks again, with nothing to put right.
    const before = { ...shown() };
    rig.run(0.5);
    expect(gap(before, shown())).toBeGreaterThan(1);
    expect(sam.link.walk.eased).toBe(0);
    sam.input = {};
    rig.run(0.5);
    expect(gap(rig.game.players[1]!.position, shown())).toBeLessThan(1e-9);
    expect(rig.settle()).toBe(true);
  });

  it('an answer that never comes does not hold the walk for ever', () => {
    const { rig, sam, shown } = landed(CLEAN);
    sam.input = { moveY: 1, cameraYaw: bearing(shown(), camp()) };
    rig.run(4);
    // The command and its answer are lost for a while; the inputs and the states are not.
    const send = sam.pair.guest.send.bind(sam.pair.guest);
    sam.pair.guest.send = (message: unknown) => {
      if ((message as { type?: string }).type !== 'command') send(message);
    };
    sam.link.sendCommand({ type: 'board' });
    const asked = { ...shown() };
    const waiting: { x: number; z: number }[] = [];
    for (let count = 0; count < 150; count += 1) {
      rig.run(FIXED_STEP);
      waiting.push({ ...shown() });
    }
    slowsToAStand(asked, waiting);
    rig.run(1.5);
    expect(gap(asked, shown())).toBeGreaterThan(1);
  });
});

describe('what it costs on the wire', () => {
  it('counts the bytes a second a guest sends and is sent: standing, walking, walking with the camera turning', () => {
    const measure = (name: string, input: (frame: number) => Partial<StepInput>): number => {
      const { rig, sam } = ashore(CLEAN);
      const before = { ...sam.pair.stats.guest, input: { ...sam.pair.stats.guest.byType.input! }, state: { ...sam.pair.stats.host.byType.state! } };
      const seconds = 20;
      for (let frame = 0; frame < seconds * 60; frame += 1) {
        sam.input = input(frame);
        rig.run(FIXED_STEP);
        if (frame % 300 === 0) seatByFire(rig.game);
      }
      const sent = sam.pair.stats.guest.byType.input!;
      const states = sam.pair.stats.host.byType.state!;
      const count = (sent.count - before.input.count) / seconds;
      const bytes = (sent.bytes - before.input.bytes) / seconds;
      console.log(`WALK wire, ${name}: ${count.toFixed(1)} inputs a second, ${Math.round(bytes)} B/s from the guest (${Math.round(bytes / count)} B each); `
        + `${((states.count - before.state.count) / seconds).toFixed(1)} states a second to it`);
      // The relay lets a guest send 60 frames a second.
      expect(count).toBeLessThanOrEqual(31);
      return bytes;
    };
    const standing = measure('standing', () => ({}));
    const walking = measure('walking', (frame) => ({ moveY: 1, cameraYaw: Math.floor(frame / 120) }));
    const turning = measure('walking, the camera turning', (frame) => ({ moveY: 1, cameraYaw: frame * 0.02 }));
    expect(standing).toBeLessThan(5000);
    expect(walking).toBeLessThan(9000);
    expect(turning).toBeLessThan(16000);
  });
});

describe('a jump', () => {
  /** Frames with these keys; the jump key down for the first three (a tap). Returns the height of the guest's own figure after each frame. */
  function tap(sam: Seat, frame: () => void, keys: Partial<StepInput>, frames: number): number[] {
    const tall: number[] = [];
    for (let count = 0; count < frames; count += 1) {
      sam.input = count < 3 ? { ...keys, jump: true } : { ...keys };
      frame();
      tall.push(leapHeight(sam.link.view()!.players[1]!.leap));
    }
    return tall;
  }

  it('is on the guest\'s own screen on the frame the key goes down, whatever the line, and it is the rules\' own jump', () => {
    for (const delay of [0, 0.06, 0.12, 0.25]) {
      const { sam, frame } = ashore({ delay });
      const tall = tap(sam, frame, {}, 60);
      // The first frame is the first step of a solo player's jump, and every frame after is the next.
      const solo = { steps: 0 };
      tall.forEach((height, index) => {
        solo.steps = index + 1;
        expect(height).toBe(leapHeight(solo));
      });
      expect(tall[0]).toBeGreaterThan(0.1);
      expect(Math.max(...tall)).toBeCloseTo(0.9, 9);
      expect(tall.filter((height) => height > 0)).toHaveLength(LEAP_AIR_STEPS - 1);
      console.log(`JUMP first frame on a guest's own screen, ${delay * 1000} ms each way: ${tall[0].toFixed(3)} m up, top ${Math.max(...tall).toFixed(3)} m, down after ${tall.findIndex((height, index) => index > 0 && height === 0) + 1} frames`);
    }
  });

  it('without the layer the same jump waits for the round trip and the view\'s beat', () => {
    const { sam, frame } = ashore({ delay: 0.12 }, { predictWalk: false });
    const tall = tap(sam, frame, {}, 90);
    expect(tall.findIndex((height) => height > 0)).toBeGreaterThan(0.12 * 2 * 60 + 4);
    expect(Math.max(...tall)).toBeGreaterThan(0.85);
  });

  /** Walk, run, stand and jump for a while. Returns what there was to put right, and whether everyone saw the jumps. */
  function jumping(conditions: Partial<LoopbackConditions>, seconds: number) {
    const { rig, sam, host, shown, frame } = ashore(conditions);
    const random = seeded(41);
    let worstSlip = 0;
    let worstEase = 0;
    let ownJumps = 0;
    let hostJumps = 0;
    let frames = 0;
    /** One frame, counting each take-off: on the guest's own screen, and in the host's game. */
    const counted = (): void => {
      const ownBefore = airborne(sam.link.view()!.players[1]!.leap);
      const hostBefore = airborne(rig.game.players[1]!.leap);
      frame();
      frames += 1;
      if (!ownBefore && airborne(sam.link.view()!.players[1]!.leap)) ownJumps += 1;
      if (!hostBefore && airborne(rig.game.players[1]!.leap)) hostJumps += 1;
      worstSlip = Math.max(worstSlip, sam.link.walk.slip);
      worstEase = Math.max(worstEase, sam.link.walk.eased);
    };
    while (frames < seconds * 60) {
      const still = random() < 0.25;
      const leg = wander(random, shown());
      const keys: Partial<StepInput> = still ? {} : leg.input;
      // A jump or two on every leg, some of them double taps and late taps, the key held for 2 to 12 frames.
      const presses = Array.from({ length: 1 + Math.floor(random() * 3) }, () => ({ at: Math.floor(random() * leg.seconds * 60), frames: 2 + Math.floor(random() * 10) }));
      for (let count = 0; count < Math.round(leg.seconds * 60); count += 1) {
        const jump = presses.some((press) => count >= press.at && count < press.at + press.frames);
        sam.input = jump ? { ...keys, jump: true } : { ...keys };
        counted();
      }
      for (const player of rig.game.players) Object.assign(player, { hunger: 100, thirst: 100, energy: 100 });
    }
    // Keys up: the host is a beat behind, so the last jump is still to be run there.
    sam.input = {};
    for (let count = 0; count < 90; count += 1) counted();
    const end = gap(host(), shown());
    const settled = rig.settle();
    return { rig, sam, worstSlip, worstEase, ownJumps, hostJumps, end, settled };
  }

  it('is predicted with nothing to put right on a clean line: two minutes of walking, running and jumping, slip 0, cuts 0', () => {
    const result = jumping(CLEAN, 120);
    console.log(`JUMP two minutes on a clean line: ${result.ownJumps} jumps on the guest's screen, ${result.hostJumps} on the host's, largest slip ${(result.worstSlip * 100).toFixed(3)} cm, `
      + `largest one-frame correction ${(result.worstEase * 100).toFixed(3)} cm, cuts ${result.sam.link.walk.cuts}, end ${(result.end * 100).toFixed(3)} cm from the host`);
    expect(result.ownJumps).toBeGreaterThan(60);
    // Every jump the guest saw, the host ran: the same count, the same jumps.
    expect(result.hostJumps).toBe(result.ownJumps);
    expect(result.worstSlip).toBe(0);
    expect(result.worstEase).toBe(0);
    expect(result.sam.link.walk.cuts).toBe(0);
    expect(result.end).toBe(0);
    expect(result.settled).toBe(true);
    expect(result.sam.link.mismatches).toBe(0);
    // All down again, on both sides.
    expect(result.rig.game.players[1]!.leap).toBeUndefined();
    expect(result.sam.link.view()!.players[1]!.leap).toBeUndefined();
    expect(hashState(result.sam.link.truth!)).toBe(result.rig.hostHash());
  });

  it('and on a bad line (120 ms each way, one message in five lost): never a cut, a few centimetres eased at most', () => {
    for (const [name, line] of [['bad', BAD], ['rough', ROUGH]] as const) {
      const result = jumping(line, 120);
      console.log(`JUMP two minutes on the ${name} line: ${result.ownJumps} jumps on the guest's screen, ${result.hostJumps} on the host's, largest slip ${(result.worstSlip * 100).toFixed(3)} cm, `
        + `largest one-frame correction ${(result.worstEase * 100).toFixed(3)} cm, cuts ${result.sam.link.walk.cuts}, end ${(result.end * 100).toFixed(3)} cm from the host`);
      expect(result.ownJumps).toBeGreaterThan(60);
      expect(result.hostJumps).toBe(result.ownJumps);
      expect(result.sam.link.walk.cuts).toBe(0);
      expect(result.worstEase).toBeLessThanOrEqual(0.03);
      expect(result.end).toBeLessThan(0.01);
      expect(result.settled).toBe(true);
      expect(result.sam.link.mismatches).toBe(0);
      expect(result.rig.game.players[1]!.leap).toBeUndefined();
      expect(result.sam.link.view()!.players[1]!.leap).toBeUndefined();
      expect(hashState(result.sam.link.truth!)).toBe(result.rig.hostHash());
    }
  });

  it('everyone sees everyone jump: the host\'s jump on the guest\'s screen, the guest\'s on the host\'s, each rising and falling smoothly', () => {
    for (const line of [CLEAN, BAD]) {
      const { rig, sam, frame } = ashore(line);
      // The host jumps: the guest's screen shows player 0 a beat behind, placed between the states it holds.
      const seen: number[] = [];
      for (let count = 0; count < 90; count += 1) {
        rig.hostInput = count < 3 ? { jump: true } : {};
        frame();
        seen.push(leapHeight(sam.link.view()!.players[0]!.leap));
      }
      const top = Math.max(...seen);
      const first = seen.findIndex((height) => height > 0);
      const last = seen.length - 1 - [...seen].reverse().findIndex((height) => height > 0);
      console.log(`JUMP the host's jump on a guest's screen: seen from frame ${first + 1} to ${last + 1}, top ${top.toFixed(3)} m, biggest change in one frame ${Math.max(...seen.map((height, index) => (index ? Math.abs(height - seen[index - 1]!) : 0))).toFixed(3)} m`);
      expect(top).toBeGreaterThan(0.85);
      expect(top).toBeLessThanOrEqual(0.9 + 1e-9);
      // One jump, about half a second of it, and no frame where the figure pops: a step of the rules moves it 12 cm at most.
      expect(last - first).toBeGreaterThanOrEqual(LEAP_AIR_STEPS - 8);
      expect(last - first).toBeLessThanOrEqual(LEAP_AIR_STEPS + 8);
      if (line === CLEAN) {
        for (let index = 1; index < seen.length; index += 1) expect(Math.abs(seen[index]! - seen[index - 1]!)).toBeLessThan(0.2);
      }
      expect(seen.at(-1)).toBe(0);

      // The guest jumps: the host runs it through the rules, the whole of it.
      const hosted: number[] = [];
      for (let count = 0; count < 120; count += 1) {
        sam.input = count < 3 ? { jump: true } : {};
        frame();
        hosted.push(leapHeight(rig.game.players[1]!.leap));
      }
      expect(Math.max(...hosted)).toBeCloseTo(0.9, 9);
      // In the air for the rules' 29 steps. The host walks a guest only as fast as its walk arrives, so on its screen
      // the jump can stand still for a frame or two just after take-off, while the next message is on its way.
      const inAir = hosted.filter((height) => height > 0).length;
      console.log(`JUMP a guest's jump on the host's screen: in the air for ${inAir} frames (the rules' ${LEAP_AIR_STEPS - 1} steps and ${inAir - (LEAP_AIR_STEPS - 1)} of waiting)`);
      expect(inAir).toBeGreaterThanOrEqual(LEAP_AIR_STEPS - 1);
      if (line === CLEAN) expect(inAir).toBeLessThanOrEqual(LEAP_AIR_STEPS - 1 + 2);
      expect(rig.settle()).toBe(true);
    }
  });

  it('against the shore the jump is the host\'s to the centimetre: nothing eased, jumping all the way into the lake', () => {
    const { rig, sam, host, shown, frame } = ashore(CLEAN);
    // Straight out past the canoe and into the lake, a jump every 0.6 s.
    const out = bearing(camp(), rig.game.canoe.position);
    let worstEase = 0;
    let deepest = 0;
    let jumps = 0;
    for (let count = 0; count < 40 * 60; count += 1) {
      sam.input = { moveY: 1, cameraYaw: out, ...(count % 36 < 4 ? { jump: true } : {}) };
      const before = airborne(sam.link.view()!.players[1]!.leap);
      frame();
      if (!before && airborne(sam.link.view()!.players[1]!.leap)) jumps += 1;
      worstEase = Math.max(worstEase, sam.link.walk.eased);
      deepest = Math.min(deepest, groundHeight(shown().x, shown().z));
    }
    expect(jumps).toBeGreaterThan(60);
    expect(deepest).toBeLessThan(-0.3);
    expect(deepest).toBeGreaterThanOrEqual(-TUNING.foot.wadeDepth - 1e-9);
    expect(worstEase).toBe(0);
    expect(sam.link.walk.cuts).toBe(0);
    sam.input = {};
    rig.run(1.5);
    expect(gap(host(), shown())).toBeLessThan(1e-9);
    expect(rig.settle()).toBe(true);
    expect(sam.link.mismatches).toBe(0);
  });

  it('no jump aboard: the key in a guest\'s input does nothing to the canoe or to anyone in it', () => {
    const plain = createRig();
    const keyed = createRig();
    for (const [rig, jump] of [[plain, false], [keyed, true]] as const) {
      const sam = rig.join('Sam', undefined, CLEAN);
      rig.run(3);
      expect(sam.link.status).toBe('playing');
      sam.input = jump ? { paddle: 1, jump: true } : { paddle: 1 };
      rig.hostInput = jump ? { paddle: 1, jump: true } : { paddle: 1 };
      rig.run(3);
      for (const player of rig.game.players) expect(player.leap).toBeUndefined();
      expect(JSON.stringify(sam.link.view())).not.toContain('leap');
    }
    expect(keyed.hostHash()).toBe(plain.hostHash());
  });

  it('the host walks every step a jump plays out on after the key is up, and passes over only the ones after them', () => {
    const line = new WalkTimeline(0);
    // The jump key for two steps on the spot, then nothing: known up to step 200.
    line.heard(200, [[0, 0, 0, 2, 0], [2, 0, 0, 0, 0]]);
    const handed: string[] = [];
    for (let tick = 0; tick < 100; tick += 1) {
      line.account(tick);
      const input = line.next(true);
      handed.push(input === HOLD_INPUT ? 'hold' : input!.jump ? 'jump' : 'still');
    }
    expect(handed.slice(0, 2)).toEqual(['jump', 'jump']);
    expect(handed.slice(2, 2 + LEAP_TAIL_STEPS)).toEqual(Array(LEAP_TAIL_STEPS).fill('still'));
    expect(handed.slice(2 + LEAP_TAIL_STEPS)).toEqual(Array(100 - 2 - LEAP_TAIL_STEPS).fill('hold'));
    expect(line.walked).toBe(200);
    // Long enough for the air, the landing, a jump asked for at the last moment and the slowing after it.
    expect(LEAP_TAIL_STEPS).toBe(LEAP_COAST_STEPS + COAST_STEPS);
    expect(LEAP_COAST_STEPS).toBeGreaterThanOrEqual(LEAP_AIR_STEPS + LEAP_LAND_STEPS);

    // The tail runs on over whatever is held after the key: a walk, and the stand after that walk.
    const stream = new WalkStream();
    stream.add({ start: 0, moveX: 0, moveY: 0, run: false, yaw: 0, jump: true });
    stream.add({ start: 2, moveX: 0, moveY: 1, run: false, yaw: 0, jump: false });
    stream.add({ start: 12, moveX: 0, moveY: 0, run: false, yaw: 0, jump: false });
    expect(stream.movesAt(12 + COAST_STEPS)).toBe(true);
    expect(stream.movesAt(2 + LEAP_TAIL_STEPS - 1)).toBe(true);
    expect(stream.movesAt(2 + LEAP_TAIL_STEPS)).toBe(false);
    expect(stream.movingSteps(0, 500)).toBe(2 + LEAP_TAIL_STEPS);
    // A stand long before any jump is still passed over: a jump reaches forward only.
    const later = new WalkStream();
    later.add({ start: 0, moveX: 0, moveY: 0, run: false, yaw: 0, jump: false });
    later.add({ start: 300, moveX: 0, moveY: 0, run: false, yaw: 0, jump: true });
    later.add({ start: 303, moveX: 0, moveY: 0, run: false, yaw: 0, jump: false });
    expect(later.movesBetween(0, 300)).toBe(false);
    expect(later.movingSteps(0, 1000)).toBe(3 + LEAP_TAIL_STEPS);
    // Once the host is past it, the tail is forgotten.
    later.dropBefore(303 + LEAP_TAIL_STEPS);
    expect(later.movesAt(303 + LEAP_TAIL_STEPS)).toBe(false);
  });
});
