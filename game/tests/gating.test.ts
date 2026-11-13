import { describe, expect, it } from 'vitest';
import { ATTACHMENTS, REGIONS_BY_ID, TUNING } from '../src/data/index.ts';
import { islandLanding, regionAt, selectCanoeStats } from '../src/sim/index.ts';
import type { GameState } from '../src/sim/index.ts';
import { build, floatCanoeAt, newGame, run, teleport } from './support.ts';

/** A dry, patched canoe with the weather held clear. */
function canoeAt(x: number, z: number, heading: number, ...attachments: Parameters<typeof build>[1][]): GameState {
  const state = newGame();
  state.canoe.hullTier = 3;
  build(state, ...attachments);
  floatCanoeAt(state, x, z, heading);
  state.weather.secondsRemaining = 99999;
  state.weather.windSpeed = 0;
  state.weather.windTarget = 0;
  state.players[0].energy = 100;
  return state;
}

/** Water level gained per second, sitting still at a spot. */
function floodPerSecond(state: GameState): number {
  const before = state.canoe.waterLevel;
  run(state, {}, 4);
  return (state.canoe.waterLevel - before) / 4;
}

describe('rough water gates the regions', () => {
  it('floods in proportion to roughness minus stability, and not at all when stable enough', () => {
    const perExcess = TUNING.canoe.floodPerSecondPerExcess;
    expect(floodPerSecond(canoeAt(150, 800, 0))).toBe(0); // Shallows 1, stability 1
    expect(floodPerSecond(canoeAt(150, 100, 0))).toBeCloseTo(perExcess * 1, 6); // Reach 2, stability 1
    expect(floodPerSecond(canoeAt(150, -650, Math.PI / 2))).toBeCloseTo(perExcess * 2, 6); // Narrows 3, stability 1
    expect(floodPerSecond(canoeAt(150, 100, 0, 'outrigger_port'))).toBe(0);
    expect(floodPerSecond(canoeAt(150, -650, Math.PI / 2, 'outrigger_port'))).toBeCloseTo(perExcess * 1, 6);
    expect(floodPerSecond(canoeAt(150, -650, Math.PI / 2, 'outrigger_port', 'outrigger_starboard'))).toBe(0);
    const stats = selectCanoeStats(canoeAt(150, -650, 0, 'outrigger_port'));
    expect(stats).toMatchObject({ stability: 2, roughnessHere: 3, floodPerSecond: perExcess });
  });

  it('counts stability as 1 plus 1 per outrigger', () => {
    expect(selectCanoeStats(canoeAt(0, 800, 0)).stability).toBe(1);
    expect(selectCanoeStats(canoeAt(0, 800, 0, 'outrigger_port')).stability).toBe(2);
    expect(selectCanoeStats(canoeAt(0, 800, 0, 'outrigger_port', 'outrigger_starboard')).stability).toBe(3);
    expect(ATTACHMENTS.outrigger_port.stabilityBonus + ATTACHMENTS.outrigger_starboard.stabilityBonus).toBe(2);
  });

  it('lets a bare canoe try the Reach, and swamps it: no wall, just water', () => {
    const state = canoeAt(150, 520, 0); // Shallows, pointing north up the open middle of the Reach
    const events = run(state, { paddle: 1, powerStroke: true }, 150);
    const types = events.map((event) => event.type);
    expect(types).toContain('region_entered');
    expect(types).toContain('rough_water');
    expect(types).toContain('swamping_warning');
    expect(types).toContain('capsized');
    expect(state.statistics.fails).toBe(1);
    const entered = events.find((event) => event.type === 'region_entered');
    expect(entered).toMatchObject({ regionId: 'reach' });
  });

  // Since the paddle speeds were doubled (2026-11-12) the nearest island of the Reach is inside a bare canoe's
  // reach from the boundary: it lands with water aboard. Before, a power stroke got there at 85 of 100 and a plain
  // paddle swamped 31 m short. The islands further in still swamp it. Whether the chop should rise to match is Luc's call.
  it('lets a bare canoe just make the nearest island of the Reach, wet', () => {
    const state = canoeAt(40, 520, 0); // Shallows, pointing north at Steeple Rock
    const events = run(state, { paddle: 1 }, 60);
    expect(events.some((event) => event.type === 'capsized')).toBe(false);
    expect(regionAt(state.canoe.position.x, state.canoe.position.z).id).toBe('reach');
    expect(state.canoe.waterLevel).toBeGreaterThan(30);
    expect(state.statistics.fails).toBe(0);
  });

  it('cannot be bailed across: the can is slower than the chop', () => {
    const state = canoeAt(150, 100, 0);
    run(state, { bail: true }, 30);
    expect(state.canoe.waterLevel).toBeGreaterThan(10);
    expect(TUNING.canoe.bailPerSecond).toBeLessThan(TUNING.canoe.floodPerSecondPerExcess);
  });

  it('carries one outrigger across the Reach dry, and two through the Narrows', () => {
    const reach = canoeAt(40, 520, 0, 'outrigger_port');
    run(reach, { paddle: 1 }, 110);
    expect(regionAt(reach.canoe.position.x, reach.canoe.position.z).id).toBe('reach');
    expect(reach.canoe.position.z).toBeLessThan(islandLanding('steeple_rock').approach.z + 10);
    expect(reach.canoe.waterLevel).toBe(0);
    expect(reach.statistics.fails).toBe(0);

    const narrows = canoeAt(150, -300, 0, 'outrigger_port', 'outrigger_starboard');
    run(narrows, { paddle: 1 }, 100); // at the doubled speed 240 s would carry it into the fog and back
    expect(narrows.canoe.position.z).toBeLessThan(-600);
    expect(regionAt(narrows.canoe.position.x, narrows.canoe.position.z).id).toBe('narrows');
    expect(narrows.canoe.waterLevel).toBe(0);

    const tooSoon = canoeAt(150, -300, 0, 'outrigger_port');
    const events = run(tooSoon, { paddle: 1 }, 240);
    expect(events.some((event) => event.type === 'capsized')).toBe(true);
  });

  it('makes a storm swamp what calm water would not, but never a beached canoe', () => {
    const state = canoeAt(150, 100, 0, 'outrigger_port');
    expect(floodPerSecond(state)).toBe(0);
    state.weather.kind = 'storm';
    state.weather.stormLevel = 1;
    // Chop over the side, plus the storm's rain in an open hull.
    expect(floodPerSecond(state)).toBeCloseTo(TUNING.canoe.floodPerSecondPerExcess + TUNING.canoe.rainPerSecond, 6);
    state.weather.stormLevel = 0.5;
    state.weather.kind = 'clear';
    const fading = floodPerSecond(state);
    expect(fading).toBeGreaterThan(0);
    expect(fading).toBeLessThan(TUNING.canoe.floodPerSecondPerExcess * 0.5);
    state.canoe.beached = true;
    state.weather.kind = 'storm';
    state.weather.stormLevel = 1;
    expect(floodPerSecond(state)).toBe(0);
  });

  it('does not touch someone on foot: the Truss Bridge is walked dry into the Narrows', () => {
    const state = canoeAt(0, -265, 0, 'outrigger_port');
    state.canoe.beached = true;
    teleport(state, 'truss_bridge', 0, -300);
    run(state, { moveY: 1 }, 60);
    expect(regionAt(state.players[0].position.x, state.players[0].position.z).id).toBe('narrows');
    expect(state.players[0].regionId).toBe('narrows');
    expect(state.canoe.waterLevel).toBe(0);
    expect(state.statistics.fails).toBe(0);
  });
});

describe('the fog wall', () => {
  const fogEdge = REGIONS_BY_ID.fog.southEdgeZ;
  const start = { x: 320, z: fogEdge + 40 };

  it('turns you around without the lantern mast and the radio', () => {
    for (const gear of [[], ['lantern_mast'], ['radio']] as Parameters<typeof build>[1][][]) {
      const state = canoeAt(start.x, start.z, 0, 'outrigger_port', 'outrigger_starboard', ...gear);
      let deepest = state.canoe.position.z;
      let turnedBack = 0;
      for (let second = 0; second < 300; second += 1) {
        const events = run(state, { paddle: 1 }, 1);
        deepest = Math.min(deepest, state.canoe.position.z);
        turnedBack += events.filter((event) => event.type === 'fog_turned_back').length;
        // The player fights it the whole way: steer north whenever possible.
        if (!state.canoe.lostInFog && state.canoe.position.z > fogEdge + 30) state.canoe.heading = 0;
      }
      expect(turnedBack, gear.join()).toBeGreaterThan(1);
      expect(deepest, gear.join()).toBeLessThan(fogEdge); // you do get in: it is not a wall
      expect(deepest, gear.join()).toBeGreaterThan(fogEdge - 40); // but never far
      expect(state.statistics.fails).toBe(0);
      expect(selectCanoeStats(state).canCrossFog).toBe(false);
    }
  });

  it('lets you through with both', () => {
    const state = canoeAt(start.x, start.z, 0, 'outrigger_port', 'outrigger_starboard', 'lantern_mast', 'radio');
    const events = run(state, { paddle: 1 }, 200);
    expect(events.some((event) => event.type === 'fog_turned_back')).toBe(false);
    expect(state.canoe.position.z).toBeLessThan(fogEdge - 300);
    expect(state.players[0].regionId).toBe('fog');
    expect(selectCanoeStats(state).canCrossFog).toBe(true);
  });

  it('still needs stability 3 in the Fog', () => {
    const state = canoeAt(start.x, fogEdge - 150, 0, 'outrigger_port', 'lantern_mast', 'radio');
    expect(floodPerSecond(state)).toBeCloseTo(TUNING.canoe.floodPerSecondPerExcess, 6);
  });
});
