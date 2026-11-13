import { describe, expect, it } from 'vitest';
import { ISLANDS_BY_ID, TUNING } from '../src/data/index.ts';
import { islandLanding, terrainHeight } from '../src/sim/index.ts';
import { newGame, run, teleport } from './support.ts';

function onHomeKnoll(x = 0) {
  const state = newGame();
  teleport(state, 'home_knoll', x, 1150);
  return state;
}

/** Where a straight walk north from z 1150 meets no tree, rock or landmark all the way into the lake (Luc's list, line 1). */
const CLEAR_LANE_X = -2.5;

describe('walking', () => {
  it('walks at 2.6 m/s and runs at 4.4 m/s, on the terrain', () => {
    const state = onHomeKnoll(CLEAR_LANE_X);
    run(state, { moveY: 1 }, 5);
    expect(state.players[0].position.z).toBeCloseTo(1150 - TUNING.foot.walkSpeed * 5, 1);
    expect(state.players[0].position.y).toBeCloseTo(terrainHeight(state.players[0].position.x, state.players[0].position.z), 9);
    const before = state.players[0].position.z;
    run(state, { moveY: -1, run: true }, 3);
    expect(state.players[0].position.z).toBeCloseTo(before + TUNING.foot.runSpeed * 3, 1);
    expect(state.statistics.distanceWalked).toBeCloseTo(2.6 * 5 + 4.4 * 3, 0);
  });

  it('moves relative to the camera bearing', () => {
    const state = onHomeKnoll();
    run(state, { moveY: 1, cameraYaw: Math.PI / 2 }, 2); // camera looks east: forward is east
    expect(state.players[0].position.x).toBeCloseTo(TUNING.foot.walkSpeed * 2, 1);
    expect(state.players[0].position.z).toBeCloseTo(1150, 1);
    run(state, { moveX: 1, cameraYaw: Math.PI / 2 }, 2); // strafe right of an east view: south
    expect(state.players[0].position.z).toBeCloseTo(1150 + TUNING.foot.walkSpeed * 2, 1);
    expect(state.players[0].heading).toBeCloseTo(Math.PI, 3);
  });

  it('does not let diagonal input go faster', () => {
    const state = onHomeKnoll();
    run(state, { moveX: 1, moveY: 1 }, 2);
    expect(Math.hypot(state.players[0].position.x, state.players[0].position.z - 1150)).toBeCloseTo(TUNING.foot.walkSpeed * 2, 1);
  });

  it('spends energy running and refuses to run when spent', () => {
    const state = onHomeKnoll();
    state.players[0].energy = 60;
    run(state, { moveX: 1, run: true }, 4);
    expect(state.players[0].energy).toBeCloseTo(60 - TUNING.survival.runEnergyPerSecond * 4, 0);
    state.players[0].energy = 3;
    teleport(state, 'home_knoll', 0, 1150);
    run(state, { moveX: 1, run: true }, 2);
    expect(state.players[0].running).toBe(false);
    expect(state.players[0].position.x).toBeCloseTo(TUNING.foot.walkSpeed * 2, 1);
    expect(state.players[0].energy).toBeGreaterThan(3);
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
