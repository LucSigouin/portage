/**
 * Light survival, held to numbers. These are the promises the balance pass measured: a start that
 * forgives, meters that leave room, a fail that is a setback and not a spiral, and no recipe that
 * is worse than its own ingredients.
 */
import { describe, expect, it } from 'vitest';
import { HULL_TIERS, ITEMS, RECIPES, TUNING } from '../src/data/index.ts';
import type { Difficulty, ItemId } from '../src/data/index.ts';
import { createBotDriver } from '../src/bot/bot.ts';
import { FIXED_STEP, NEUTRAL_INPUT, createGame, dispatch, drainEvents, step } from '../src/sim/index.ts';
import type { GameState, StepInput } from '../src/sim/index.ts';

/** Seconds of play until the next fail with this input held, or null if none comes in time. */
function secondsToFail(state: GameState, input: StepInput, withinSeconds: number): number | null {
  const fails = state.statistics.fails;
  const start = state.playedSeconds;
  for (let tick = 0; tick < withinSeconds / FIXED_STEP; tick += 1) {
    step(state, input, FIXED_STEP);
    state.events = [];
    if (state.statistics.fails > fails) return state.playedSeconds - start;
  }
  return null;
}

/** A new game played properly through the first quest: bailed, landed on Home Knoll, reward in hand. */
function landed(difficulty: Difficulty): GameState {
  const state = createGame(3, { difficulty });
  const driver = createBotDriver(state, { untilQuest: 'bail_out' });
  for (let input = driver.next(); input !== null; input = driver.next()) {
    step(state, input, FIXED_STEP);
    drainEvents(state);
  }
  expect(state.quests.bail_out.status).toBe('completed');
  return state;
}

describe('a start that forgives', () => {
  it('gives a new player who touches nothing two and a half minutes before the canoe goes under', () => {
    for (const difficulty of ['standard', 'relaxed'] as const) {
      const state = createGame(3, { difficulty });
      const seconds = secondsToFail(state, NEUTRAL_INPUT, 600);
      expect(seconds, difficulty).not.toBeNull();
      expect(seconds!, difficulty).toBeGreaterThanOrEqual(150);
      // It is the leak that does it, by the numbers in the tables.
      expect(seconds!).toBeCloseTo((TUNING.canoe.capsizeLevel - TUNING.canoe.startWaterLevel) / HULL_TIERS[0].leakPerSecond, 0);
    }
  });

  it('lets a new player paddle straight in without bailing at all', () => {
    const state = createGame(3);
    for (let tick = 0; tick < 120 / FIXED_STEP && !state.canoe.beached; tick += 1) step(state, { ...NEUTRAL_INPUT, paddle: 1 }, FIXED_STEP);
    expect(state.canoe.beached).toBe(true);
    expect(state.statistics.fails).toBe(0);
    expect(state.canoe.waterLevel).toBeLessThan(TUNING.canoe.swampWarningLevel + 5);
  });

  it('gives a player who lands and then does nothing at all twenty minutes on Standard, forty on Relaxed', () => {
    const standard = secondsToFail(landed('standard'), NEUTRAL_INPUT, 2 * 3600);
    const relaxed = secondsToFail(landed('relaxed'), NEUTRAL_INPUT, 2 * 3600);
    expect(standard!).toBeGreaterThan(20 * 60);
    expect(relaxed!).toBeGreaterThan(40 * 60);
  });

  it('stretches that to three quarters of an hour for one who only eats and drinks the first quest\'s reward', () => {
    const state = landed('standard');
    const player = state.players[0];
    let seconds: number | null = null;
    for (let tick = 0; tick < 2 * 3600 / FIXED_STEP && seconds === null; tick += 1) {
      step(state, NEUTRAL_INPUT, FIXED_STEP);
      state.events = [];
      if (player.thirst < TUNING.survival.lowMeterWarning) dispatch(state, { type: 'drink', itemId: 'clean_water' });
      if (player.hunger < TUNING.survival.lowMeterWarning) dispatch(state, { type: 'eat', itemId: 'berries' });
      if (state.statistics.fails > 0) seconds = state.playedSeconds;
    }
    expect(seconds!).toBeGreaterThan(45 * 60);
  });
});

describe('a fail is a setback, not a spiral', () => {
  it('sets the meters back to half, and leaves a quarter of an hour before the next even for a player who does nothing', () => {
    const state = landed('standard');
    state.players[0].backpack = [];
    state.canoe.cargo = [];
    expect(secondsToFail(state, NEUTRAL_INPUT, 2 * 3600)).not.toBeNull();
    const player = state.players[0];
    expect([player.hunger, player.thirst, player.energy]).toEqual([50, 50, 50]);
    expect(player.mode).toBe('foot');
    expect(state.canoe.beached).toBe(true);
    const next = secondsToFail(state, NEUTRAL_INPUT, 2 * 3600);
    expect(next!).toBeGreaterThan(15 * 60);
  });

  it('can always be climbed out of with nothing but the bailing can: flood water, drunk raw, buys time', () => {
    const state = landed('standard');
    state.players[0].backpack = [];
    state.canoe.cargo = [];
    secondsToFail(state, NEUTRAL_INPUT, 2 * 3600); // the first fail, empty-handed
    const player = state.players[0];
    const idle = secondsToFail(JSON.parse(JSON.stringify(state)) as GameState, NEUTRAL_INPUT, 2 * 3600)!;
    let seconds: number | null = null;
    const fails = state.statistics.fails;
    const start = state.playedSeconds;
    for (let tick = 0; tick < 2 * 3600 / FIXED_STEP && seconds === null; tick += 1) {
      step(state, NEUTRAL_INPUT, FIXED_STEP);
      state.events = [];
      // The canoe lies beside a player who has just failed, so the water is in reach.
      if (player.thirst <= 1 && player.energy > 13 && dispatch(state, { type: 'fill_water', count: 1 }).ok) dispatch(state, { type: 'drink', itemId: 'dirty_water' });
      if (state.statistics.fails > fails) seconds = state.playedSeconds - start;
    }
    expect(seconds === null || seconds > idle + 5 * 60).toBe(true);
  });
});

describe('nothing is worse cooked than raw', () => {
  const value = (itemId: ItemId): { hunger: number; thirst: number; energy: number } => ITEMS[itemId].edible ?? { hunger: 0, thirst: 0, energy: 0 };

  it('makes a stew at least as good as its ingredients eaten the best other way', () => {
    // The fish cooked on its own, the mushroom as it is, the root as half a roast, the water drunk.
    const apart = {
      hunger: value('cooked_fish').hunger + value('mushroom').hunger + value('roast_roots').hunger / RECIPES.roast_roots.inputs[0].count,
      thirst: value('cooked_fish').thirst + value('clean_water').thirst,
    };
    expect(RECIPES.stew.inputs.map((input) => input.itemId).sort()).toEqual(['cattail_root', 'clean_water', 'mushroom', 'raw_fish']);
    const stew = value('stew');
    expect(stew.hunger).toBeGreaterThanOrEqual(apart.hunger);
    expect(stew.thirst).toBeGreaterThanOrEqual(apart.thirst - 2);
    expect(stew.energy).toBeGreaterThan(0);
  });

  it('never loses food value at the fire or the smoker', () => {
    for (const recipe of Object.values(RECIPES)) {
      const made = ITEMS[recipe.output.itemId].edible;
      if (!made || recipe.output.itemId === 'stew') continue;
      const before = recipe.inputs.reduce((sum, input) => sum + value(input.itemId).hunger * input.count, 0);
      expect(made.hunger * recipe.output.count, recipe.id).toBeGreaterThanOrEqual(before);
    }
  });
});
