import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/data/index.ts';
import { dispatch, landingBerth, selectRespawnPoint, selectTimeOfDay } from '../src/sim/index.ts';
import { distanceToHull } from '../src/sim/interact.ts';
import { build, countIn, floatCanoeAt, give, newGame, run, runUntilFail, standOn, teleportToCamp } from './support.ts';

/** Afloat in the Reach in a bare canoe, loaded, about to go under. */
function aboutToCapsize() {
  const state = newGame();
  state.canoe.hullTier = 2;
  build(state, 'cargo_rack');
  floatCanoeAt(state, 150, 100);
  state.weather.secondsRemaining = 99999;
  give(state, 'plank', 20, 'cargo');
  give(state, 'nails', 5, 'cargo');
  give(state, 'rope', 1, 'cargo');
  give(state, 'clean_water', 4, 'cargo');
  give(state, 'driftwood', 9);
  give(state, 'hammer');
  give(state, 'lens');
  state.players[0].hunger = 91;
  state.players[0].thirst = 12;
  state.players[0].energy = 77;
  state.canoe.waterLevel = 97;
  return state;
}

describe('capsize', () => {
  it('follows the brief to the letter', () => {
    const state = aboutToCapsize();
    const timeBefore = state.time;
    const events = runUntilFail(state, { paddle: 1 }, 5);
    const types = events.map((event) => event.type);
    expect(types).toContain('capsized');
    expect(types).toContain('washed_ashore');

    // Wake at the respawn point: Home Knoll by default...
    expect(state.players[0].mode).toBe('foot');
    expect(state.players[0].islandId).toBe('home_knoll');
    // ...canoe beached beside you...
    expect(state.canoe.beached).toBe(true);
    expect(distanceToHull(state, state.players[0].position.x, state.players[0].position.z)).toBeLessThan(TUNING.canoe.boardRange);
    const berth = landingBerth('home_knoll', 2);
    expect(Math.hypot(state.canoe.position.x - berth.x, state.canoe.position.z - berth.z)).toBeLessThan(0.01);
    expect(state.canoe.waterLevel).toBe(0);
    // ...six hours later...
    expect(state.time - timeBefore).toBeGreaterThan(6 * 60);
    expect(state.time - timeBefore).toBeLessThan(6 * 60 + 1.5);
    expect(state.playedSeconds).toBeLessThan(1.5); // the six hours are skipped, not played
    // ...meters at 50.
    expect([state.players[0].hunger, state.players[0].thirst, state.players[0].energy]).toEqual([50, 50, 50]);

    // Lose half of every non-tool stack in the canoe cargo.
    expect(countIn(state.canoe.cargo, 'plank')).toBe(10);
    expect(countIn(state.canoe.cargo, 'nails')).toBe(3);
    expect(countIn(state.canoe.cargo, 'rope')).toBe(1);
    expect(countIn(state.canoe.cargo, 'clean_water')).toBe(2);
    const washed = events.find((event) => event.type === 'washed_ashore');
    expect(washed).toMatchObject({
      cause: 'capsized', islandId: 'home_knoll',
      lost: [{ itemId: 'plank', count: 10 }, { itemId: 'nails', count: 2 }, { itemId: 'clean_water', count: 2 }],
    });

    // Tools, attachments and quest items are never lost. Neither is the backpack.
    expect(state.tools).toEqual(['bailing_can', 'hammer']);
    expect(state.keyItems).toEqual({ lens: 1 });
    expect(state.canoe.attachments).toEqual(['cargo_rack']);
    expect(state.canoe.hullTier).toBe(2);
    expect(countIn(state.players[0].backpack, 'driftwood')).toBe(9);
    expect(state.statistics.fails).toBe(1);
  });

  it('never costs the save: the game carries on from the beach', () => {
    const state = aboutToCapsize();
    runUntilFail(state, { paddle: 1 }, 5);
    expect(dispatch(state, { type: 'board' }).ok).toBe(true);
    run(state, { paddle: -1 }, 8);
    expect(state.canoe.beached).toBe(false);
    expect(state.statistics.fails).toBe(1);
  });
});

describe('exhaustion', () => {
  it('fails at energy 0 the same way', () => {
    const state = newGame();
    standOn(state, 'cabin_roofs');
    give(state, 'stone', 10, 'cargo');
    state.players[0].hunger = 0;
    state.players[0].energy = 1;
    const events = runUntilFail(state, {}, 10);
    expect(events.map((event) => event.type)).toContain('exhausted');
    expect(events.find((event) => event.type === 'washed_ashore')).toMatchObject({ cause: 'exhausted', islandId: 'home_knoll' });
    expect(state.players[0].islandId).toBe('home_knoll');
    expect([state.players[0].hunger, state.players[0].thirst, state.players[0].energy]).toEqual([50, 50, 50]);
    expect(countIn(state.canoe.cargo, 'stone')).toBe(5);
  });
});

describe('respawn point', () => {
  it('is Home Knoll by default, then the last camp slept at', () => {
    const state = newGame();
    expect(selectRespawnPoint(state)).toMatchObject({ islandId: 'home_knoll', islandName: 'Home Knoll', mobile: false });
    standOn(state, 'orchard_hill');
    teleportToCamp(state, 'orchard_hill');
    state.time = 23 * 60;
    expect(dispatch(state, { type: 'sleep' }).ok).toBe(true);
    expect(selectRespawnPoint(state).islandId).toBe('orchard_hill');
    expect(selectTimeOfDay(state).clock).toBe('06:00');

    state.canoe.hullTier = 1;
    floatCanoeAt(state, 150, 100);
    state.canoe.waterLevel = 99;
    runUntilFail(state, {}, 5);
    expect(state.players[0].islandId).toBe('orchard_hill');
    const berth = landingBerth('orchard_hill', 1);
    expect(Math.hypot(state.canoe.position.x - berth.x, state.canoe.position.z - berth.z)).toBeLessThan(0.01);
  });

  it('follows the canoe with the canopy: wherever it was last beached', () => {
    const state = newGame();
    state.canoe.hullTier = 2;
    build(state, 'canopy', 'outrigger_port');
    standOn(state, 'silo_twins');
    const beachedAt = { ...state.canoe.lastBeached };
    expect(selectRespawnPoint(state)).toMatchObject({ islandId: 'silo_twins', mobile: true });
    floatCanoeAt(state, 150, -500); // the Narrows on one outrigger
    state.canoe.waterLevel = 99;
    runUntilFail(state, {}, 5);
    expect(state.statistics.fails).toBe(1);
    expect(state.players[0].islandId).toBe('silo_twins');
    expect(state.canoe.position.x).toBeCloseTo(beachedAt.x, 6);
    expect(state.canoe.position.z).toBeCloseTo(beachedAt.z, 6);
    expect(state.canoe.beached).toBe(true);
  });
});
