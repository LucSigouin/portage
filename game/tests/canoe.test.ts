import { describe, expect, it } from 'vitest';
import { HULL_TIERS, TUNING } from '../src/data/index.ts';
import {
  dispatch, selectCanoeStats, selectInteractable, terrainHeight, waterRoughnessAt, waveHeight,
} from '../src/sim/index.ts';
import { sailFactor } from '../src/sim/canoe.ts';
import { build, floatCanoeAt, newGame, run, standOn } from './support.ts';

/** A dry, patched canoe in open Shallows water, pointing north, with dead calm air. */
function calmWater(heading = 0) {
  const state = newGame();
  state.canoe.hullTier = 1;
  floatCanoeAt(state, 0, 880, heading);
  state.weather.windSpeed = 0;
  state.weather.windTarget = 0;
  state.weather.secondsRemaining = 9999;
  return state;
}

describe('paddling', () => {
  // Doubled on 2026-11-12 from 2.2, 3.2 and 1.2: Luc's call, a friend found the crossings far too long.
  it('cruises at 4.4 m/s, 6.4 m/s on a power stroke, and backs at 2.4 m/s', () => {
    const state = calmWater();
    run(state, { paddle: 1 }, 8);
    expect(state.canoe.speed).toBeCloseTo(4.4, 2);
    run(state, { paddle: 1, powerStroke: true }, 8);
    expect(state.canoe.speed).toBeCloseTo(6.4, 2);
    run(state, { paddle: -1 }, 10);
    expect(state.canoe.speed).toBeCloseTo(-2.4, 2);
  });

  it('covers ground along its heading and glides to a stop', () => {
    const state = calmWater(Math.PI / 2); // east
    run(state, { paddle: 1 }, 20);
    expect(state.canoe.position.x).toBeGreaterThan(38);
    expect(state.canoe.position.z).toBeCloseTo(880, 3);
    run(state, {}, 20);
    expect(Math.abs(state.canoe.speed)).toBeLessThan(0.01);
  });

  it('is faster with the long hull', () => {
    const state = calmWater();
    state.canoe.hullTier = 3;
    run(state, { paddle: 1 }, 8);
    expect(state.canoe.speed).toBeCloseTo(4.4 * HULL_TIERS[3].speedMultiplier, 2);
    expect(selectCanoeStats(state).paddleSpeed).toBeCloseTo(5.06, 2);
  });

  it('turns with the steer axis, tighter with the rudder, slower at rest', () => {
    const turned = (rudder: boolean, paddle: number): number => {
      const state = calmWater();
      if (rudder) build(state, 'rudder');
      run(state, { paddle }, 6);
      const before = state.canoe.heading;
      run(state, { paddle, steer: 1 }, 1);
      return state.canoe.heading - before;
    };
    expect(turned(false, 1)).toBeCloseTo(TUNING.canoe.turnRate, 1);
    expect(turned(true, 1)).toBeCloseTo(TUNING.canoe.rudderTurnRate, 1);
    expect(turned(false, 0)).toBeGreaterThan(0.2);
    expect(turned(false, 0)).toBeLessThan(turned(false, 1) * 0.5);
  });

  it('slows down as the hull fills', () => {
    const state = calmWater();
    state.canoe.waterLevel = 80;
    run(state, { paddle: 1 }, 8);
    expect(state.canoe.speed).toBeCloseTo(4.4 * (1 - 0.35 * 0.8), 1);
  });
});

describe('sail', () => {
  it('pulls only downwind without a rudder, and on a reach with one', () => {
    const wind = 0; // blowing toward north
    expect(sailFactor(0, wind, false)).toBe(1);
    expect(sailFactor(Math.PI / 2, wind, false)).toBeCloseTo(0, 9);
    expect(sailFactor(Math.PI, wind, false)).toBe(0);
    expect(sailFactor(Math.PI / 2, wind, true)).toBeCloseTo(TUNING.canoe.rudderReachShare, 9);
    expect(sailFactor(Math.PI * 0.7, wind, true)).toBeGreaterThan(0.4);
    expect(sailFactor(Math.PI * 0.9, wind, true)).toBe(0); // inside the no-go zone
  });

  it('pulls downwind with no hand on a paddle, and by itself never passes 5 m/s', () => {
    const state = calmWater();
    state.canoe.hullTier = 2;
    build(state, 'mast_sail');
    state.weather.windDirection = 0;
    state.weather.windSpeed = 5;
    state.weather.windTarget = 5;
    expect(dispatch(state, { type: 'set_sail', raised: true }).ok).toBe(true);
    run(state, {}, 12);
    expect(state.canoe.speed).toBeGreaterThan(3.5);
    state.weather.windSpeed = 12;
    state.weather.windTarget = 12;
    run(state, {}, 12);
    expect(state.canoe.speed).toBeLessThanOrEqual(TUNING.canoe.sailMaximumSpeed + 1e-9);
    expect(state.canoe.speed).toBeGreaterThan(4.9);
  });

  // Since the paddle speeds were doubled (2026-11-12) the sail no longer beats a paddler. It tops out at its own
  // limit, and a paddler going faster than that gets nothing more from it. Whether the sail should be raised to
  // match is Luc's call.
  it('adds nothing to a paddler who already outruns it', () => {
    const paddled = calmWater();
    paddled.canoe.hullTier = 2;
    run(paddled, { paddle: 1, powerStroke: true }, 12);
    const sailed = calmWater();
    sailed.canoe.hullTier = 2;
    build(sailed, 'mast_sail');
    sailed.weather.windDirection = 0;
    sailed.weather.windSpeed = 12;
    sailed.weather.windTarget = 12;
    dispatch(sailed, { type: 'set_sail', raised: true });
    run(sailed, { paddle: 1, powerStroke: true }, 12);
    expect(paddled.canoe.speed).toBeGreaterThan(TUNING.canoe.sailMaximumSpeed);
    expect(sailed.canoe.speed).toBeCloseTo(paddled.canoe.speed, 6);
  });

  it('needs the mast, and drags when pointed into the wind', () => {
    const state = calmWater();
    expect(dispatch(state, { type: 'set_sail', raised: true })).toMatchObject({ ok: false, missing: { attachments: ['mast_sail'] } });
    build(state, 'mast_sail');
    state.weather.windDirection = Math.PI; // blowing south, canoe points north
    state.weather.windSpeed = 5;
    state.weather.windTarget = 5;
    dispatch(state, { type: 'set_sail', raised: true });
    run(state, { paddle: 1 }, 8);
    expect(state.canoe.speed).toBeLessThan(TUNING.canoe.paddleSpeed);
    expect(state.canoe.speed).toBeGreaterThan(TUNING.canoe.paddleSpeed - 2 * TUNING.canoe.luffingDragSpeed);
  });
});

describe('wind and current', () => {
  it('drifts an idle canoe south with the current in the Narrows', () => {
    const state = calmWater();
    build(state, 'outrigger_port', 'outrigger_starboard');
    floatCanoeAt(state, 150, -650, Math.PI / 2);
    run(state, {}, 20);
    expect(state.canoe.position.z).toBeCloseTo(-650 + 0.6 * 20, 0);
  });

  it('pushes the bare hull a little downwind', () => {
    const state = calmWater();
    state.weather.windDirection = Math.PI / 2;
    state.weather.windSpeed = 8;
    state.weather.windTarget = 8;
    run(state, {}, 10);
    expect(state.canoe.position.x).toBeCloseTo(8 * TUNING.canoe.windDriftShare * 10, 1);
  });
});

describe('water in the hull', () => {
  it('leaks at hull tier 0 and stays dry once patched', () => {
    const leaky = calmWater();
    leaky.canoe.hullTier = 0;
    run(leaky, {}, 30);
    expect(leaky.canoe.waterLevel).toBeCloseTo(HULL_TIERS[0].leakPerSecond * 30, 1);
    const patched = calmWater();
    run(patched, {}, 30);
    expect(patched.canoe.waterLevel).toBe(0);
  });

  it('bails at 3 points a second, costs energy and stops the paddle', () => {
    const state = calmWater();
    state.canoe.waterLevel = 60;
    state.players[0].energy = 80;
    run(state, { bail: true, paddle: 1 }, 10);
    expect(state.canoe.waterLevel).toBeCloseTo(30, 1);
    expect(state.players[0].energy).toBeCloseTo(80 - TUNING.survival.bailEnergyPerSecond * 10, 0);
    expect(Math.abs(state.canoe.speed)).toBeLessThan(0.05);
    expect(state.canoe.bailing).toBe(true);
  });

  it('starts a new game half swamped and leaking, so the first job is to bail', () => {
    const state = newGame();
    expect(state.canoe.waterLevel).toBe(60);
    expect(state.canoe.hullTier).toBe(0);
    // The warning comes inside the first minute, with two more minutes to act on it.
    const events = run(state, {}, 45);
    expect(state.canoe.waterLevel).toBeGreaterThan(70);
    expect(events.some((event) => event.type === 'swamping_warning')).toBe(true);
    run(state, {}, 110);
    expect(state.statistics.fails).toBe(0);
  });
});

describe('shoreline', () => {
  it('beaches when run onto a shore, and backs off again', () => {
    const state = calmWater(Math.PI); // heading south toward Home Knoll
    floatCanoeAt(state, 0, 1070, Math.PI);
    const events = run(state, { paddle: 1 }, 25);
    expect(state.canoe.beached).toBe(true);
    expect(state.canoe.speed).toBe(0);
    expect(events.filter((event) => event.type === 'canoe_beached')).toEqual([{ type: 'canoe_beached', islandId: 'home_knoll' }]);
    expect(state.canoe.lastBeached.islandId).toBe('home_knoll');
    const bowZ = state.canoe.position.z + 2.25;
    expect(terrainHeight(0, bowZ)).toBeGreaterThan(-0.4);
    const stuckAt = state.canoe.position.z;
    run(state, { paddle: 1 }, 3);
    expect(state.canoe.position.z).toBeCloseTo(stuckAt, 6); // no pushing through the beach
    const launched = run(state, { paddle: -1 }, 6);
    expect(state.canoe.beached).toBe(false);
    expect(state.canoe.position.z).toBeLessThan(stuckAt - 3);
    expect(launched.some((event) => event.type === 'canoe_launched')).toBe(true);
  });

  it('lets you step ashore from a beached canoe and board again', () => {
    const state = calmWater();
    expect(dispatch(state, { type: 'disembark' })).toMatchObject({ ok: false, reason: 'no_shore_in_reach' });
    expect(selectInteractable(state)).toBeNull();
    floatCanoeAt(state, 0, 1070, Math.PI);
    run(state, { paddle: 1 }, 25);
    expect(selectInteractable(state)).toMatchObject({ kind: 'land', command: { type: 'disembark' } });
    expect(dispatch(state, { type: 'disembark' }).ok).toBe(true);
    expect(state.players[0].mode).toBe('foot');
    expect(state.players[0].islandId).toBe('home_knoll');
    expect(terrainHeight(state.players[0].position.x, state.players[0].position.z)).toBeGreaterThanOrEqual(-TUNING.foot.disembarkDepth);
    expect(dispatch(state, { type: 'disembark' })).toMatchObject({ ok: false, reason: 'not_aboard' });
    expect(selectInteractable(state)).toMatchObject({ kind: 'board' });
    expect(dispatch(state, { type: 'board' }).ok).toBe(true);
    expect(dispatch(state, { type: 'board' })).toMatchObject({ ok: false, reason: 'already_aboard' });
    standOn(state, 'home_knoll');
    state.players[0].position.x += 30;
    expect(dispatch(state, { type: 'board' })).toMatchObject({ ok: false, reason: 'not_at_canoe' });
  });

  it('floats on the water you see: the hull follows waveHeight', () => {
    const state = calmWater();
    build(state, 'outrigger_port', 'outrigger_starboard');
    floatCanoeAt(state, 150, -600);
    run(state, {}, 10);
    let worst = 0;
    for (let sample = 0; sample < 120; sample += 1) {
      run(state, {}, 1 / 12);
      const { x, z } = state.canoe.position;
      const surface = waveHeight(x, z, state.time, waterRoughnessAt(x, z, state.weather.stormLevel));
      worst = Math.max(worst, Math.abs(state.canoe.position.y - surface));
    }
    expect(worst).toBeLessThan(0.15);
    expect(Math.abs(state.canoe.pitch)).toBeLessThan(0.5);
    expect(Math.abs(state.canoe.roll)).toBeLessThan(0.5);
    expect(state.players[0].position.y).toBe(state.canoe.position.y);
  });
});
