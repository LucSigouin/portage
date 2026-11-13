import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/data/index.ts';
import { dispatch, selectMeters, selectTimeOfDay } from '../src/sim/index.ts';
import { build, countIn, floatCanoeAt, give, newGame, run, standOn, teleport, teleportToBed } from './support.ts';

const DAY = TUNING.time.daySeconds;

/** Standing idle at the Home Knoll camp, by the lean-to, at 08:00, meters full. */
function atCamp(difficulty: 'relaxed' | 'standard' = 'standard') {
  const state = newGame(7, { difficulty });
  standOn(state, 'home_knoll');
  teleportToBed(state, 'home_knoll');
  state.players[0].hunger = 100;
  state.players[0].thirst = 100;
  state.players[0].energy = 100;
  return state;
}

describe('the clock', () => {
  it('starts at 07:00 on day 1 and runs a day in 24 minutes, 8 of them night', () => {
    const state = newGame();
    expect(selectTimeOfDay(state)).toMatchObject({ day: 1, clock: '07:00', isNight: false });
    expect(DAY).toBe(24 * 60);
    let nightSeconds = 0;
    for (let second = 0; second < DAY; second += 1) {
      state.time = second;
      if (selectTimeOfDay(state).isNight) nightSeconds += 1;
    }
    expect(nightSeconds).toBe(8 * 60);
    state.time = DAY + 13.5 * 60;
    expect(selectTimeOfDay(state)).toMatchObject({ day: 2, clock: '13:30', dayFraction: 13.5 / 24 });
  });
});

describe('hunger and thirst', () => {
  it('empties hunger in about 2 days and thirst in about 1.25 days', () => {
    const state = atCamp();
    run(state, {}, 600);
    const hungerDays = 100 / ((100 - state.players[0].hunger) / 600) / DAY;
    const thirstDays = 100 / ((100 - state.players[0].thirst) / 600) / DAY;
    expect(hungerDays).toBeCloseTo(2, 2);
    expect(thirstDays).toBeCloseTo(1.25, 2);
  });

  it('drains at 0.6 of that on Relaxed', () => {
    const standard = atCamp('standard');
    const relaxed = atCamp('relaxed');
    run(standard, {}, 300);
    run(relaxed, {}, 300);
    expect((100 - relaxed.players[0].hunger) / (100 - standard.players[0].hunger)).toBeCloseTo(0.6, 3);
    expect((100 - relaxed.players[0].thirst) / (100 - standard.players[0].thirst)).toBeCloseTo(0.6, 3);
    expect(dispatch(standard, { type: 'set_difficulty', difficulty: 'relaxed' }).ok).toBe(true);
    expect(standard.difficulty).toBe('relaxed');
  });

  it('drains faster under hard paddling', () => {
    const idle = newGame();
    const working = newGame();
    for (const state of [idle, working]) {
      state.canoe.hullTier = 1;
      floatCanoeAt(state, 0, 880);
      state.players[0].hunger = 100;
      state.players[0].thirst = 100;
      state.players[0].energy = 100;
    }
    run(idle, {}, 60);
    run(working, { paddle: 1, powerStroke: true, steer: 0.3 }, 60);
    expect((100 - working.players[0].hunger) / (100 - idle.players[0].hunger)).toBeCloseTo(TUNING.survival.exertionHungerMultiplier, 1);
    expect((100 - working.players[0].thirst) / (100 - idle.players[0].thirst)).toBeCloseTo(TUNING.survival.exertionThirstMultiplier, 1);
  });
});

describe('energy', () => {
  it('comes back at rest and is spent by power strokes', () => {
    const state = newGame();
    state.canoe.hullTier = 1;
    floatCanoeAt(state, 0, 880);
    state.players[0].energy = 50;
    run(state, {}, 20);
    expect(state.players[0].energy).toBeCloseTo(50 + TUNING.survival.restEnergyPerSecond * 20, 0);
    const rested = state.players[0].energy;
    run(state, { paddle: 1, powerStroke: true, steer: 0.3 }, 20);
    expect(state.players[0].energy).toBeCloseTo(rested - TUNING.survival.powerStrokeEnergyPerSecond * 20, 0);
  });

  it('never fails you through effort alone: exertion stops at 5 energy', () => {
    const state = newGame();
    state.canoe.hullTier = 1;
    floatCanoeAt(state, 0, 880);
    state.weather.secondsRemaining = 99999;
    give(state, 'clean_water', 20, 'cargo');
    give(state, 'cooked_fish', 20, 'cargo');
    let lowest = 100;
    for (let minute = 0; minute < 12; minute += 1) {
      run(state, { paddle: 1, powerStroke: true, steer: 0.5 }, 60);
      lowest = Math.min(lowest, state.players[0].energy);
      if (state.players[0].thirst < 50) dispatch(state, { type: 'drink', itemId: 'clean_water' });
      if (state.players[0].hunger < 50) dispatch(state, { type: 'eat', itemId: 'cooked_fish' });
    }
    expect(state.statistics.fails).toBe(0);
    expect(lowest).toBeGreaterThan(4);
    expect(lowest).toBeLessThan(8);
  });

  it('drains in the cold at night unless a fire, a lit lantern or the canopy is near', () => {
    const night = 23 * 60;
    const drift = (prepare: (state: ReturnType<typeof newGame>) => void): number => {
      const state = newGame();
      state.canoe.hullTier = 2;
      floatCanoeAt(state, 0, 880);
      state.time = night;
      state.weather.secondsRemaining = 9999;
      state.players[0].energy = 60;
      prepare(state);
      run(state, { paddle: 0.5 }, 30);
      return state.players[0].energy - 60;
    };
    const exposed = drift(() => undefined);
    const withLanternOff = drift((state) => build(state, 'lantern_mast'));
    const withLantern = drift((state) => {
      build(state, 'lantern_mast');
      expect(dispatch(state, { type: 'toggle_lantern' }).ok).toBe(true);
    });
    const withCanopy = drift((state) => build(state, 'canopy'));
    const cold = TUNING.survival.coldNightEnergyPerSecond * 30;
    expect(withLantern - exposed).toBeCloseTo(cold, 1);
    expect(withCanopy - exposed).toBeCloseTo(cold, 1);
    expect(withLanternOff).toBeCloseTo(exposed, 6);
    expect(dispatch(newGame(), { type: 'toggle_lantern' })).toMatchObject({ ok: false, missing: { attachments: ['lantern_mast'] } });
    const byTheFire = atCamp();
    byTheFire.time = night;
    byTheFire.players[0].energy = 60;
    run(byTheFire, {}, 30);
    expect(selectMeters(byTheFire).sheltered).toBe(true);
    expect(byTheFire.players[0].energy).toBeCloseTo(60 + (TUNING.survival.restEnergyPerSecond + TUNING.survival.fireWarmthEnergyPerSecond) * 30, 0);
  });

  it('is capped and drained when hunger or thirst hits 0, down to a fail', () => {
    const state = atCamp();
    state.players[0].thirst = 0;
    run(state, {}, 1);
    expect(state.players[0].energy).toBeLessThanOrEqual(TUNING.survival.starvingEnergyCap);
    expect(selectMeters(state).energyCap).toBe(40);
    const events = run(state, {}, 210);
    expect(events.some((event) => event.type === 'exhausted')).toBe(true);
    expect(state.statistics.fails).toBe(1);
  });

  it('warns once as a meter drops under 25', () => {
    const state = atCamp();
    state.players[0].hunger = 25.2;
    const events = run(state, {}, 60);
    expect(events.filter((event) => event.type === 'meter_low')).toEqual([{ type: 'meter_low', meter: 'hunger', playerId: 0 }]);
    expect(selectMeters(state).low.hunger).toBe(true);
  });
});

describe('eating and drinking', () => {
  it('restores what the item says and uses it up', () => {
    const state = atCamp();
    state.players[0].hunger = 40;
    state.players[0].thirst = 40;
    give(state, 'cooked_fish', 2);
    give(state, 'clean_water', 1);
    expect(dispatch(state, { type: 'eat', itemId: 'cooked_fish' }).ok).toBe(true);
    expect(state.players[0].hunger).toBe(68);
    expect(countIn(state.players[0].backpack, 'cooked_fish')).toBe(1);
    expect(dispatch(state, { type: 'drink', itemId: 'clean_water' }).ok).toBe(true);
    expect(state.players[0].thirst).toBe(82);
    expect(dispatch(state, { type: 'drink', itemId: 'clean_water' })).toMatchObject({ ok: false, reason: 'item_not_held' });
    expect(dispatch(state, { type: 'drink', itemId: 'cooked_fish' })).toMatchObject({ ok: false, reason: 'not_drinkable' });
    expect(dispatch(state, { type: 'eat', itemId: 'stone' })).toMatchObject({ ok: false, reason: 'not_edible' });
  });

  it('makes dirty water cost energy, and scoops it only at the water', () => {
    const state = atCamp();
    expect(dispatch(state, { type: 'fill_water', count: 2 })).toMatchObject({ ok: false, reason: 'no_water_in_reach' });
    standOn(state, 'home_knoll');
    expect(dispatch(state, { type: 'fill_water', count: 2 })).toMatchObject({ ok: true, gained: [{ itemId: 'dirty_water', count: 2 }] });
    state.players[0].thirst = 50;
    state.players[0].energy = 80;
    expect(dispatch(state, { type: 'drink', itemId: 'dirty_water' }).ok).toBe(true);
    expect(state.players[0].thirst).toBe(65);
    expect(state.players[0].energy).toBe(68);
  });
});

describe('sleep', () => {
  it('needs a bed and tiredness or dusk', () => {
    const state = atCamp();
    expect(dispatch(state, { type: 'sleep' })).toMatchObject({ ok: false, reason: 'not_tired' });
    expect(selectTimeOfDay(state).sleepBlocked).toBe('not_tired');
    teleport(state, 'home_knoll', 30, 1170);
    state.time = 23 * 60;
    expect(dispatch(state, { type: 'sleep' })).toMatchObject({ ok: false, reason: 'no_bed_in_reach' });
    teleportToBed(state, 'home_knoll');
    state.time = 8 * 60;
    state.players[0].energy = 45;
    expect(dispatch(state, { type: 'sleep' }).ok).toBe(true);
  });

  it('skips to 06:00, refills energy, drains meters at half rate and asks for an autosave', () => {
    const state = atCamp();
    state.time = 21 * 60; // 21:00, 9 hours before dawn
    state.players[0].energy = 30;
    state.events = [];
    expect(dispatch(state, { type: 'sleep' }).ok).toBe(true);
    expect(selectTimeOfDay(state)).toMatchObject({ day: 2, clock: '06:00' });
    expect(state.players[0].energy).toBe(100);
    const slept = 9 * 60;
    expect(state.players[0].hunger).toBeCloseTo(100 - TUNING.survival.hungerPerSecond * 0.5 * slept, 6);
    expect(state.players[0].thirst).toBeCloseTo(100 - TUNING.survival.thirstPerSecond * 0.5 * slept, 6);
    expect(state.playedSeconds).toBe(0);
    expect(state.events).toContainEqual({ type: 'slept', hours: 9, islandId: 'home_knoll', playerId: 0 });
    expect(state.events).toContainEqual({ type: 'autosave_requested', reason: 'sleeping' });
  });

  it('works aboard a beached canoe with the canopy, not afloat and not without it', () => {
    const state = newGame();
    state.canoe.hullTier = 2;
    standOn(state, 'cabin_roofs');
    state.time = 23 * 60;
    expect(dispatch(state, { type: 'sleep' })).toMatchObject({ ok: false, reason: 'no_bed_in_reach' });
    build(state, 'canopy');
    expect(dispatch(state, { type: 'sleep' }).ok).toBe(true);
    floatCanoeAt(state, 0, 880);
    state.time = 23 * 60;
    expect(dispatch(state, { type: 'sleep' })).toMatchObject({ ok: false, reason: 'no_bed_in_reach' });
  });
});
