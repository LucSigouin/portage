/**
 * The jump as it is drawn (Luc's list, Round 3: "character need to jump"): the figure lifted by the rules' own
 * height, a rise with the legs trailing, the knees drawn up over the top, a fall, and a landing where the knees give.
 * All of it from the state's count of steps, so it is the same on every screen, the tool stays in the hand, and a
 * figure nobody is jumping with stands as still as it stood.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FIXED_STEP, LEAP_AIR_STEPS, LEAP_LAND_STEPS, LEAP_RISE_STEPS, NEUTRAL_INPUT, createGame, leapHeight, step } from '../../src/sim/index.ts';
import type { GameState, StepInput } from '../../src/sim/index.ts';
import type { Crew as Figure } from '../../src/look/b2/canoe.js';
import { CREW_LAYER } from '../../src/look/b2/post.js';
import { CanoeView } from '../../src/look/canoe.ts';
import { crewOf } from '../../src/look/crew.ts';
import { NO_JUMP, jumpPose } from '../../src/look/jump-pose.ts';
import { teleport } from '../support.ts';

const DONE = LEAP_AIR_STEPS + LEAP_LAND_STEPS;

/** A player standing on open ground on Home Knoll, facing north. */
function ashore(tool: GameState['players'][number]['selectedTool'] = null): GameState {
  const state = createGame(7);
  teleport(state, 'home_knoll', -2.5, 1150);
  Object.assign(state.players[0], { heading: 0, selectedTool: tool, hunger: 100, thirst: 100, energy: 100 });
  state.weather.secondsRemaining = 99999;
  return state;
}

/** One step of the rules, then one frame of the picture. */
function frame(view: CanoeView, state: GameState, input: Partial<StepInput> = {}, time = 0): void {
  step(state, { ...NEUTRAL_INPUT, ...input }, FIXED_STEP);
  view.sync(state, crewOf(state), FIXED_STEP, time, true, false);
}

const figureOf = (view: CanoeView, playerId = 0): Figure =>
  (view as unknown as { members: Map<number, { figure: Figure }> }).members.get(playerId)!.figure;

function drawn(object: THREE.Object3D): boolean {
  for (let at: THREE.Object3D | null = object; at; at = at.parent) if (!at.visible) return false;
  return true;
}

/** Where every mesh of a figure is drawn, as one list of numbers. */
function poseOf(view: CanoeView, playerId = 0): number[] {
  const root = view.figureOf(playerId)!;
  root.updateMatrixWorld(true);
  const numbers: number[] = [];
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh && drawn(object)) numbers.push(...object.matrixWorld.elements);
  });
  return numbers;
}

/** The same, with the figure's own place taken out: how it holds itself. */
function stanceOf(view: CanoeView, playerId = 0): number[] {
  const root = view.figureOf(playerId)!;
  const numbers: number[] = [];
  root.traverse((object) => {
    if (object !== root && (object as THREE.Mesh).isMesh && drawn(object)) {
      object.updateMatrix();
      numbers.push(...object.matrix.elements);
    }
  });
  return numbers;
}

describe('how a figure holds itself through a jump', () => {
  it('is nothing at all outside a jump, and four numbers from 0 to 1 inside one', () => {
    for (const steps of [0, -1, DONE, DONE + 1, 500, Number.NaN]) expect(jumpPose(steps)).toBe(NO_JUMP);
    expect(NO_JUMP).toEqual({ trail: 0, tuck: 0, arms: 0, crouch: 0 });
    for (let steps = 0.25; steps < DONE; steps += 0.25) {
      for (const value of Object.values(jumpPose(steps))) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('runs rise, top, fall and landing in that order: legs trailing, knees up, legs down, knees giving', () => {
    const at = (steps: number) => jumpPose(steps);
    // Early in the rise: the push. The legs trail, nothing is tucked yet.
    expect(at(4).trail).toBeGreaterThan(0.9);
    expect(at(4).tuck).toBe(0);
    // Over the top: the knees are up, the arms are up, the trail is gone.
    expect(at(LEAP_RISE_STEPS).tuck).toBeGreaterThan(0.95);
    expect(at(LEAP_RISE_STEPS).trail).toBeLessThan(0.05);
    expect(at(LEAP_RISE_STEPS).arms).toBe(1);
    // Coming down: the legs are let down to meet the ground, the arms come down with them.
    expect(at(LEAP_AIR_STEPS - 1).tuck).toBeLessThan(0.05);
    expect(at(LEAP_AIR_STEPS - 1).arms).toBeLessThan(0.5);
    // Never a crouch in the air; on the ground the knees give, most two fifths of the way through, and straighten.
    for (let steps = 1; steps <= LEAP_AIR_STEPS; steps += 1) expect(at(steps).crouch).toBe(0);
    const crouches = Array.from({ length: LEAP_LAND_STEPS }, (_, index) => at(LEAP_AIR_STEPS + index).crouch);
    expect(Math.max(...crouches)).toBeGreaterThan(0.85);
    expect(crouches.indexOf(Math.max(...crouches))).toBeGreaterThanOrEqual(3);
    expect(crouches.indexOf(Math.max(...crouches))).toBeLessThanOrEqual(4);
    expect(at(DONE - 0.01).crouch).toBeLessThan(0.01);
    // No pop anywhere: from one step to the next nothing changes by more than 45% of its range, and it starts and ends at rest.
    let most = 0;
    for (let steps = 0; steps < DONE; steps += 1) {
      const from = steps === 0 ? NO_JUMP : at(steps);
      const to = steps + 1 >= DONE ? NO_JUMP : at(steps + 1);
      for (const key of ['trail', 'tuck', 'arms', 'crouch'] as const) most = Math.max(most, Math.abs(to[key] - from[key]));
    }
    console.log(`JUMP pose: the biggest change of any part from one step to the next is ${most.toFixed(3)} of its range`);
    expect(most).toBeLessThan(0.45);
  });
});

describe('the figure in a jump', () => {
  it('is lifted by the rules\' own height on every frame, and stands on the ground again after', () => {
    const state = ashore();
    const view = new CanoeView();
    for (let count = 0; count < 30; count += 1) frame(view, state);
    const ground = view.figureOf(0)!.position.y;
    expect(ground).toBe(state.players[0].position.y);
    const lifts: number[] = [];
    for (let count = 0; count < 60; count += 1) {
      frame(view, state, { jump: count < 3 });
      const root = view.figureOf(0)!;
      expect(root.position.y - ground).toBeCloseTo(leapHeight(state.players[0].leap), 12);
      expect(view.figures()[0].lift).toBe(leapHeight(state.players[0].leap));
      // Only up and down: a standing jump moves the figure nowhere else and does not turn it.
      expect(root.position.x).toBe(state.players[0].position.x);
      expect(root.position.z).toBe(state.players[0].position.z);
      lifts.push(root.position.y - ground);
    }
    expect(lifts[0]).toBeGreaterThan(0.1);
    expect(Math.max(...lifts)).toBeCloseTo(0.9, 9);
    expect(lifts.slice(LEAP_AIR_STEPS - 1).every((lift) => lift === 0)).toBe(true);
  });

  it('holds itself differently at the push, the top, the fall and the landing: knees and hands move, in the figure\'s own limbs', () => {
    const state = ashore();
    const view = new CanoeView();
    for (let count = 0; count < 30; count += 1) frame(view, state);
    const figure = figureOf(view);
    const read = () => ({
      boot: figure.paddler.L.boot.position.clone(), knee: figure.paddler.L.knee.position.clone(), hand: figure.paddler.L.H.clone(),
      thigh: figure.paddler.L.thigh.scale.y, shin: figure.paddler.L.shin.scale.y, stance: stanceOf(view),
    });
    const standing = read();
    const shots: Record<number, ReturnType<typeof read>> = {};
    for (let count = 1; count <= DONE + 4; count += 1) {
      frame(view, state, { jump: count <= 3 });
      shots[count] = read();
      // Legs stay legs: thigh and shin keep near their standing lengths all through (0.40 and 0.37 m).
      expect(shots[count].thigh).toBeGreaterThan(0.3);
      expect(shots[count].thigh).toBeLessThan(0.46);
      expect(shots[count].shin).toBeGreaterThan(0.28);
      expect(shots[count].shin).toBeLessThan(0.43);
      // The boots never go through the ground the figure stands on.
      expect(shots[count].boot.y + view.figureOf(0)!.position.y).toBeGreaterThanOrEqual(state.players[0].position.y + standing.boot.y - 1e-9);
    }
    const push = shots[4];
    const top = shots[LEAP_RISE_STEPS];
    const landing = shots[LEAP_AIR_STEPS + 3];
    // The push: the feet trail behind the body (the model faces +z) and are off the ground under it.
    expect(push.boot.z).toBeLessThan(standing.boot.z - 0.18);
    expect(push.boot.y).toBeGreaterThan(standing.boot.y + 0.08);
    // The top: the knees are drawn up and forward, the feet tucked under, the hands swung up to the chest and out ahead.
    expect(top.knee.y).toBeGreaterThan(standing.knee.y + 0.12);
    expect(top.knee.z).toBeGreaterThan(standing.knee.z + 0.15);
    expect(top.boot.y).toBeGreaterThan(standing.boot.y + 0.18);
    expect(top.hand.y).toBeGreaterThan(standing.hand.y + 0.3);
    expect(top.hand.z).toBeGreaterThan(standing.hand.z + 0.2);
    // To the chest, not over the head: the hands stay below the chin (the head's middle is 0.69 m above the hips).
    expect(top.hand.y).toBeLessThan(0.8 + 0.5);
    // The last step of the fall: the legs are down again to meet the ground.
    expect(shots[LEAP_AIR_STEPS - 1].boot.y).toBeLessThan(standing.boot.y + 0.03);
    // The landing: the feet are planted where they stand, the knees forward, the hips (and so the hands) lower.
    expect(landing.boot.y).toBeCloseTo(standing.boot.y, 9);
    expect(landing.knee.z).toBeGreaterThan(standing.knee.z + 0.15);
    expect(landing.hand.y).toBeLessThan(standing.hand.y - 0.05);
    // And then it stands exactly as it stood before the jump: not a number of it has changed.
    expect(shots[DONE + 4].stance).toEqual(standing.stance);
    expect(state.players[0].leap).toBeUndefined();
  });

  it('keeps the tool in the hand and every piece on the crew\'s pen all through', () => {
    const state = ashore('stone_knife');
    const view = new CanoeView();
    for (let count = 0; count < 30; count += 1) frame(view, state);
    const figure = figureOf(view);
    for (let count = 1; count <= DONE + 2; count += 1) {
      frame(view, state, { jump: count <= 3 });
      expect(view.figures()[0].holding).toBe('stone_knife');
      let tool: THREE.Object3D | null = null;
      view.figureOf(0)!.traverse((object) => {
        if (object.name === 'tool:stone_knife' && drawn(object)) tool = object;
        if ((object as THREE.Mesh).isMesh && drawn(object)) expect(object.layers.isEnabled(CREW_LAYER), object.name || object.type).toBe(true);
      });
      expect(tool).not.toBeNull();
      // In the fist: at the right hand, wherever the jump has taken it.
      expect(tool!.position.distanceTo(figure.paddler.R.H)).toBe(0);
    }
    // The hand with the tool is thrown up less than the free one.
    const state2 = ashore('stone_knife');
    const view2 = new CanoeView();
    for (let count = 0; count < 30; count += 1) frame(view2, state2);
    for (let count = 1; count <= LEAP_RISE_STEPS; count += 1) frame(view2, state2, { jump: count <= 3 });
    const hands = figureOf(view2).paddler;
    expect(hands.R.H.y).toBeLessThan(hands.L.H.y - 0.15);
  });

  it('is drawn from the state alone: a screen that sees the jump only now draws it as one that watched it all', () => {
    for (const tool of [null, 'hatchet'] as const) {
      const state = ashore(tool);
      const watched = new CanoeView();
      for (let count = 0; count < 30; count += 1) frame(watched, state);
      for (let count = 1; count <= 12; count += 1) frame(watched, state, { jump: count <= 3 });
      const late = new CanoeView();
      late.sync(state, crewOf(state), FIXED_STEP, 99, true, true);
      late.sync(state, crewOf(state), FIXED_STEP, 99, true, false);
      expect(poseOf(late)).toEqual(poseOf(watched));
    }
  });

  it('a running jump keeps the stride it took off with: the legs do not run on in the air', () => {
    const state = ashore();
    const view = new CanoeView();
    const run: Partial<StepInput> = { moveY: 1, cameraYaw: 0, run: true };
    for (let count = 0; count < 90; count += 1) frame(view, state, run);
    const stride = view.figures()[0].stride;
    for (let count = 1; count < LEAP_AIR_STEPS; count += 1) {
      frame(view, state, { ...run, jump: count <= 3 });
      expect(view.figures()[0].stride).toBe(stride);
    }
    // Down again, the stride goes on from where it waited.
    frame(view, state, run);
    frame(view, state, run);
    expect(view.figures()[0].stride).toBeGreaterThan(stride);
  });
});

describe('nothing moves by itself', () => {
  it('a figure standing ashore is drawn the same 0.3 s apart: before any jump, after one, and with the key still held down', () => {
    const state = ashore('hammer');
    const view = new CanoeView();
    let time = 0;
    const still = (input: Partial<StepInput> = {}): void => {
      for (let count = 0; count < 30; count += 1) frame(view, state, input, time += FIXED_STEP);
      const first = poseOf(view);
      for (let count = 0; count < 18; count += 1) frame(view, state, input, time += FIXED_STEP);
      expect(poseOf(view)).toEqual(first);
    };
    still();
    const before = poseOf(view);
    // A jump with the key held down all the way through it and after: one jump, then still, the key still down.
    for (let count = 0; count < DONE + 5; count += 1) frame(view, state, { jump: true }, time += FIXED_STEP);
    expect(state.players[0].leap).toEqual({ steps: DONE, held: true, again: false });
    still({ jump: true });
    expect(poseOf(view)).toEqual(before);
    // Key up: still, and the same picture as before the jump.
    still();
    expect(poseOf(view)).toEqual(before);
  });

  it('aboard and asleep there is no lift, whatever the state carries', () => {
    const state = ashore();
    const view = new CanoeView();
    state.players[0].leap = { steps: 10, held: false, again: false };
    Object.assign(state.players[0], { mode: 'canoe', seat: 0 });
    view.sync(state, crewOf(state), FIXED_STEP, 0, true, true);
    expect(view.figures()[0].lift).toBe(0);
  });
});
