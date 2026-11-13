import { describe, expect, it } from 'vitest';
import { ISLANDS_BY_ID, TUNING } from '../src/data/index.ts';
import { FIXED_STEP, bearingDifference, islandLanding, terrainHeight } from '../src/sim/index.ts';
import type { GameState, StepInput } from '../src/sim/index.ts';
import { newGame, run, teleport } from './support.ts';

function onHomeKnoll(x = 0) {
  const state = newGame();
  teleport(state, 'home_knoll', x, 1150);
  return state;
}

/** On the open ground, facing north: the way W goes with the camera looking north. */
function facingNorth() {
  const state = onHomeKnoll(CLEAR_LANE_X);
  state.players[0].heading = 0;
  return state;
}

/** Where a straight walk north from z 1150 meets no tree, rock or landmark all the way into the lake (Luc's list, line 1). */
const CLEAR_LANE_X = -2.5;

/** Metres moved over one step of the rules, and the step's input. */
function stepOnce(state: GameState, input: Partial<StepInput>): number {
  const { x, z } = state.players[0].position;
  run(state, input, FIXED_STEP);
  return Math.hypot(state.players[0].position.x - x, state.players[0].position.z - z);
}

const WALK_STEP = TUNING.foot.walkSpeed * FIXED_STEP;
const RUN_STEP = TUNING.foot.runSpeed * FIXED_STEP;

describe('walking', () => {
  it('walks at 2.6 m/s and runs at 4.4 m/s once under way, on the terrain', () => {
    const state = onHomeKnoll(CLEAR_LANE_X);
    run(state, { moveY: 1 }, 1);
    const start = state.players[0].position.z;
    run(state, { moveY: 1 }, 4);
    expect(state.players[0].position.z).toBeCloseTo(start - TUNING.foot.walkSpeed * 4, 6);
    expect(state.players[0].position.y).toBeCloseTo(terrainHeight(state.players[0].position.x, state.players[0].position.z), 9);
    // About-face into a run: under way again after half a second, then 4.4 m/s.
    run(state, { moveY: -1, run: true }, 0.5);
    const before = state.players[0].position.z;
    run(state, { moveY: -1, run: true }, 2.5);
    expect(state.players[0].position.z).toBeCloseTo(before + TUNING.foot.runSpeed * 2.5, 6);
  });

  it('moves relative to the camera bearing, and the figure turns to face the way it goes', () => {
    const state = onHomeKnoll();
    run(state, { moveY: 1, cameraYaw: Math.PI / 2 }, 2); // camera looks east: forward is east
    expect(state.players[0].position.x).toBeGreaterThan(TUNING.foot.walkSpeed * 2 - 0.4);
    expect(Math.abs(state.players[0].position.z - 1150)).toBeLessThan(0.1);
    expect(state.players[0].heading).toBeCloseTo(Math.PI / 2, 9);
    const east = state.players[0].position.x;
    run(state, { moveX: 1, cameraYaw: Math.PI / 2 }, 2); // strafe right of an east view: south
    expect(state.players[0].position.z).toBeGreaterThan(1150 + TUNING.foot.walkSpeed * 2 - 0.4);
    expect(state.players[0].position.x - east).toBeLessThan(0.3);
    expect(state.players[0].heading).toBeCloseTo(Math.PI, 9);
  });

  it('does not let diagonal input go faster', () => {
    const state = onHomeKnoll();
    run(state, { moveX: 1, moveY: 1 }, 1);
    for (let index = 0; index < 60; index += 1) expect(stepOnce(state, { moveX: 1, moveY: 1 })).toBeCloseTo(WALK_STEP, 9);
  });

  it('spends energy running and refuses to run when spent', () => {
    const state = onHomeKnoll();
    state.players[0].energy = 60;
    run(state, { moveX: 1, run: true }, 4);
    expect(state.players[0].energy).toBeCloseTo(60 - TUNING.survival.runEnergyPerSecond * 4, 0);
    state.players[0].energy = 3;
    teleport(state, 'home_knoll', 0, 1150);
    run(state, { moveX: 1, run: true }, 1);
    expect(state.players[0].running).toBe(false);
    expect(stepOnce(state, { moveX: 1, run: true })).toBeCloseTo(WALK_STEP, 9);
    expect(state.players[0].energy).toBeGreaterThan(3);
  });
});

describe('how walking feels (Luc\'s list, line 11)', () => {
  it('eases into a walk: a little on the first step, full speed after 0.15 s, never more', () => {
    const state = facingNorth();
    const steps: number[] = [];
    for (let index = 0; index < 30; index += 1) steps.push(stepOnce(state, { moveY: 1 }));
    expect(steps[0]).toBeGreaterThan(0);
    expect(steps[0]).toBeLessThan(WALK_STEP * 0.2);
    const full = steps.findIndex((step) => step >= WALK_STEP - 1e-9) + 1;
    expect(full).toBe(9); // 0.15 s
    for (let index = 1; index < steps.length; index += 1) {
      expect(steps[index]).toBeGreaterThanOrEqual(steps[index - 1]! - 1e-12);
      expect(steps[index]).toBeLessThanOrEqual(WALK_STEP + 1e-12);
    }
    console.log(`FEEL walk: first step ${(steps[0]! * 100).toFixed(2)} cm of ${(WALK_STEP * 100).toFixed(2)}, full speed after ${full} steps (${(full / 60).toFixed(3)} s)`);
  });

  it('eases into a run: full speed after 0.25 s', () => {
    const state = facingNorth();
    let full = 0;
    for (let index = 1; index <= 60 && full === 0; index += 1) if (stepOnce(state, { moveY: 1, run: true }) >= RUN_STEP - 1e-9) full = index;
    expect(full).toBe(15);
  });

  it('eases out: a walk stops 0.09 s after the keys come up, a run 0.15 s, and then stands dead still', () => {
    for (const [running, longest, slideAtMost] of [[false, 6, 0.13], [true, 9, 0.33]] as const) {
      const state = onHomeKnoll(CLEAR_LANE_X);
      run(state, { moveY: 1, run: running }, 1);
      let slide = 0;
      let stopped = 0;
      for (let index = 1; index <= 60; index += 1) {
        const moved = stepOnce(state, {});
        slide += moved;
        if (moved > 0) stopped = index + 1;
      }
      expect(stopped).toBeGreaterThan(2);
      expect(stopped).toBeLessThanOrEqual(longest);
      expect(slide).toBeGreaterThan(0.03);
      expect(slide).toBeLessThan(slideAtMost);
      const body = (): string => JSON.stringify([state.players[0].position, state.players[0].heading, state.players[0].gait]);
      const still = body();
      run(state, {}, 1);
      expect(body()).toBe(still);
      console.log(`FEEL ${running ? 'run' : 'walk'}: stands still ${stopped - 1} steps after the keys come up, sliding ${(slide * 100).toFixed(1)} cm`);
    }
  });

  it('turns at the turn rate: a right angle in 0.125 s, an about-face in 0.25 s, never in one step', () => {
    for (const [keys, target, steps] of [[{ moveX: 1 }, Math.PI / 2, 8], [{ moveY: -1 }, Math.PI, 15]] as const) {
      const state = onHomeKnoll(CLEAR_LANE_X);
      run(state, { moveY: 1 }, 1);
      expect(state.players[0].heading).toBeCloseTo(0, 9);
      let faced = 0;
      let largest = 0;
      for (let index = 1; index <= 30; index += 1) {
        const before = state.players[0].heading;
        stepOnce(state, keys);
        largest = Math.max(largest, Math.abs(bearingDifference(state.players[0].heading, before)));
        if (faced === 0 && Math.abs(bearingDifference(target, state.players[0].heading)) < 1e-9) faced = index;
      }
      expect(faced).toBe(steps);
      expect(largest).toBeCloseTo(TUNING.foot.turnRate * FIXED_STEP, 9);
      console.log(`FEEL turn ${Math.round((target * 180) / Math.PI)} degrees: faces the new way after ${faced} steps (${(faced / 60).toFixed(3)} s), at most ${((largest * 180) / Math.PI).toFixed(0)} degrees a step`);
    }
  });

  it('walks the way it faces: never sideways or backwards against the figure, whatever the keys do', () => {
    const state = onHomeKnoll(CLEAR_LANE_X);
    const random = (() => {
      let seed = 11;
      return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000;
    })();
    for (let leg = 0; leg < 40; leg += 1) {
      const keys = { moveX: Math.floor(random() * 3) - 1, moveY: Math.floor(random() * 3) - 1, run: random() < 0.3, cameraYaw: random() * 6 };
      for (let index = 0; index < 4 + Math.floor(random() * 30); index += 1) {
        const { x, z } = state.players[0].position;
        stepOnce(state, keys);
        const player = state.players[0];
        const moved = Math.hypot(player.position.x - x, player.position.z - z);
        if (moved === 0) continue;
        const along = ((player.position.x - x) * Math.sin(player.heading) - (player.position.z - z) * Math.cos(player.heading)) / moved;
        expect(along).toBeCloseTo(1, 9);
      }
      // Back to the middle of the open ground now and then, so the walk stays on it.
      if (Math.hypot(state.players[0].position.x - CLEAR_LANE_X, state.players[0].position.z - 1150) > 4) teleport(state, 'home_knoll', CLEAR_LANE_X, 1150);
    }
  });

  it('an about-face is a tight turn, not a wide loop: the figure strays under 20 cm sideways and slows nearly to a stand', () => {
    const state = onHomeKnoll(CLEAR_LANE_X);
    run(state, { moveY: 1 }, 1);
    const startX = state.players[0].position.x;
    let slowest = Infinity;
    let wide = 0;
    for (let index = 0; index < 30; index += 1) {
      slowest = Math.min(slowest, stepOnce(state, { moveY: -1 }) / FIXED_STEP);
      wide = Math.max(wide, Math.abs(state.players[0].position.x - startX));
    }
    // Turning round at full speed would swing out 2 x 2.6 / turn rate = 41 cm.
    expect(wide).toBeLessThan(0.2);
    expect(slowest).toBeLessThan(0.5);
    console.log(`FEEL about-face: strays ${(wide * 100).toFixed(1)} cm sideways, slowest ${slowest.toFixed(2)} m/s`);
  });

  it('starts from a stand wherever it was put: a landing or a fail carries no speed from before', () => {
    const state = onHomeKnoll(CLEAR_LANE_X);
    run(state, { moveY: 1, run: true }, 1);
    expect(state.players[0].gait?.speed).toBeCloseTo(TUNING.foot.runSpeed, 9);
    teleport(state, 'home_knoll', 0, 1150);
    expect(stepOnce(state, { moveY: 1, run: true })).toBeLessThan(WALK_STEP * 0.2);
    // Put somewhere else while letting go: no slide at all.
    run(state, { moveY: 1 }, 1);
    teleport(state, 'home_knoll', CLEAR_LANE_X, 1150);
    expect(stepOnce(state, {})).toBe(0);
  });

  it('a held step changes nothing: not the place, not the heading, not the speed', () => {
    const state = onHomeKnoll(CLEAR_LANE_X);
    run(state, { moveY: 1 }, 1);
    const before = JSON.stringify(state.players[0].gait);
    const heading = state.players[0].heading;
    for (let index = 0; index < 30; index += 1) expect(stepOnce(state, { moveX: 1, hold: true })).toBe(0);
    expect(JSON.stringify(state.players[0].gait)).toBe(before);
    expect(state.players[0].heading).toBe(heading);
    // And the walk carries on at full speed from where it was held.
    expect(stepOnce(state, { moveY: 1 })).toBeCloseTo(WALK_STEP, 9);
  });
});

describe('limits', () => {
  it('wades in to about 0.6 m and no deeper', () => {
    const state = onHomeKnoll(CLEAR_LANE_X);
    run(state, { moveY: 1 }, 40); // north, off the beach and into the lake
    const depth = -terrainHeight(state.players[0].position.x, state.players[0].position.z);
    expect(depth).toBeGreaterThan(0.45);
    expect(depth).toBeLessThanOrEqual(TUNING.foot.wadeDepth);
    const shore = islandLanding('home_knoll').shore;
    expect(state.players[0].position.z).toBeLessThan(shore.z); // really is past the waterline
  });

  it('cannot climb the sheer side of Quarry Face, but can walk its spine', () => {
    const quarry = ISLANDS_BY_ID.quarry_face;
    const state = newGame();
    // Start on the south shore and push straight up the face.
    teleport(state, 'quarry_face', quarry.center.x, quarry.center.z + quarry.radiusZ - 0.5);
    run(state, { moveY: 1 }, 20);
    expect(terrainHeight(state.players[0].position.x, state.players[0].position.z)).toBeLessThan(quarry.peakHeight * 0.5);
    // From the east tip, the spine goes all the way to the top.
    teleport(state, 'quarry_face', quarry.center.x + quarry.radiusX - 1, quarry.center.z);
    run(state, { moveX: -1 }, 45);
    expect(terrainHeight(state.players[0].position.x, state.players[0].position.z)).toBeGreaterThan(quarry.peakHeight * 0.9);
  });

  it('slides along what it cannot climb instead of sticking', () => {
    const quarry = ISLANDS_BY_ID.quarry_face;
    const state = newGame();
    teleport(state, 'quarry_face', quarry.center.x + 60, quarry.center.z + 14);
    const startX = state.players[0].position.x;
    run(state, { moveX: -1, moveY: 1 }, 6); // north-west into the slope
    expect(state.players[0].position.x).toBeLessThan(startX - 5);
  });
});
