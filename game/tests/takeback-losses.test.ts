/**
 * A drop does not dodge a loss (the second review of round 3, new finding 2).
 *
 * A capsize takes half of every cargo stack, and a collapse alone in a crew takes half of that player's backpack.
 * A stack dropped a moment earlier is out of the container, and its take-back used to bring it back whole: twenty,
 * where the capsize leaves ten. Now a loss ends every take-back out of the container it halves, whoever dropped it.
 *
 * Then the neighbours, tried one by one: a night's sleep, a save and a load, and a crewmate who is away. The seat
 * that changes hands and the guest who leaves are tried on the wire, in `net/takeback-seats.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/data/index.ts';
import { deserialize, serialize } from '../src/save/index.ts';
import { FIXED_STEP, NEUTRAL_INPUT, dispatch, drainEvents, setConnected, standingDrop, step, terrainHeight } from '../src/sim/index.ts';
import type { GameEvent, GameState } from '../src/sim/index.ts';
import { bedSide, countIn, floatCanoeAt, give, newGame, standOn, teleportToBed } from './support.ts';

type Dropped = 'stone' | 'clay' | 'driftwood' | 'berries';
const CARGO: Dropped[] = ['stone', 'clay', 'driftwood'];
const HOUR = TUNING.time.hourSeconds;

/** A crew afloat south of Home Knoll in a tight dry hull, under a sky that holds, the first quest behind. */
function afloat(crew = 1): GameState {
  const state = newGame(7, { crew });
  state.quests.bail_out.status = 'completed';
  state.canoe.hullTier = 1;
  floatCanoeAt(state, 200, 1300, 0);
  for (const player of state.players) player.position = { ...state.canoe.position };
  state.weather.secondsRemaining = 99999;
  drainEvents(state);
  return state;
}

/** A crew ashore at Home Knoll, the canoe landed, everyone fed and rested beside the lean-to. */
function ashore(crew = 1): GameState {
  const state = newGame(7, { crew });
  state.quests.bail_out.status = 'completed';
  standOn(state, 'home_knoll');
  state.players.forEach((player, index) => {
    const spot = bedSide('home_knoll', index);
    Object.assign(player, { mode: 'foot', seat: null, islandId: 'home_knoll', hunger: 100, thirst: 100, energy: 100 });
    player.position = { x: spot.x, y: terrainHeight(spot.x, spot.z), z: spot.z };
  });
  drainEvents(state);
  return state;
}

/** One step of the rules for the whole crew, nobody pressing anything. */
function oneStep(state: GameState): GameEvent[] {
  step(state, state.players.map(() => ({ ...NEUTRAL_INPUT })), FIXED_STEP);
  return drainEvents(state);
}

/** The canoe goes under on the next step, as the rules do it. */
function capsize(state: GameState): GameEvent[] {
  state.canoe.waterLevel = TUNING.canoe.capsizeLevel;
  const events = oneStep(state);
  expect(events.map((event) => event.type)).toContain('capsized');
  return events;
}

/** This player has nothing left to give: they collapse on the next step. Starving, so the step cannot rest them. */
function collapse(state: GameState, playerId = 0): GameEvent[] {
  Object.assign(state.players[playerId]!, { hunger: 0, thirst: 0, energy: 0 });
  const events = oneStep(state);
  expect(events).toContainEqual(expect.objectContaining({ type: 'washed_ashore', cause: 'exhausted', playerId }));
  return events;
}

const drop = (state: GameState, itemId: Dropped, count: number, from: 'backpack' | 'cargo', playerId = 0) =>
  dispatch(state, { type: 'discard', from, itemId, count }, playerId);
const takeBack = (state: GameState, dropId: number, playerId = 0) => dispatch(state, { type: 'take_back', drop: dropId }, playerId);
const NOTHING = { ok: false, reason: 'nothing_to_take_back' };

describe('a capsize ends the take-back of what was dropped from the cargo', () => {
  it('the reviewer\'s steps: three cargo stacks dropped, a capsize, three take-backs, and nothing comes back', () => {
    const state = afloat();
    for (const itemId of CARGO) give(state, itemId, 20, 'cargo');
    for (const itemId of CARGO) expect(drop(state, itemId, 20, 'cargo').ok, itemId).toBe(true);
    expect([1, 2, 3].map((dropId) => standingDrop(state, 0, dropId)?.count)).toEqual([20, 20, 20]);

    capsize(state);
    // Ashore beside the beached canoe: the cargo is in reach, so that is not what says no.
    expect(state.players[0].mode).toBe('foot');
    expect(state.canoe.beached).toBe(true);
    for (const dropId of [1, 2, 3]) {
      // The note's button reads this: it goes off the note the moment the canoe goes under.
      expect(standingDrop(state, 0, dropId), String(dropId)).toBeNull();
      expect(takeBack(state, dropId), String(dropId)).toMatchObject(NOTHING);
    }
    expect(state.canoe.cargo).toEqual([]);
  });

  it('never leaves more than the capsize leaves without a drop', () => {
    const left = (useDrop: boolean): number[] => {
      const state = afloat();
      for (const itemId of CARGO) give(state, itemId, 20, 'cargo');
      if (useDrop) for (const itemId of CARGO) drop(state, itemId, 20, 'cargo');
      capsize(state);
      if (useDrop) for (const dropId of [1, 2, 3]) takeBack(state, dropId);
      return CARGO.map((itemId) => countIn(state.canoe.cargo, itemId) + countIn(state.players[0].backpack, itemId));
    };
    const withoutDrop = left(false);
    expect(withoutDrop).toEqual([10, 10, 10]);
    left(true).forEach((count, index) => expect(count, CARGO[index]).toBeLessThanOrEqual(withoutDrop[index]!));
  });

  it('is not got round a piece at a time: six drops of one, and the capsize still takes its half of the rest', () => {
    const state = afloat();
    give(state, 'stone', 20, 'cargo');
    for (let piece = 0; piece < 6; piece += 1) expect(drop(state, 'stone', 1, 'cargo').ok).toBe(true);
    capsize(state);
    for (let dropId = 1; dropId <= 6; dropId += 1) expect(takeBack(state, dropId), String(dropId)).toMatchObject(NOTHING);
    // Fourteen were aboard: seven are left. Twenty aboard would have left ten.
    expect(countIn(state.canoe.cargo, 'stone')).toBe(7);
  });

  it('leaves a stack dropped from the backpack alone: a capsize takes nothing from a backpack', () => {
    const state = afloat();
    give(state, 'driftwood', 9);
    give(state, 'stone', 20, 'cargo');
    expect(drop(state, 'driftwood', 9, 'backpack').ok).toBe(true);
    capsize(state);
    expect(countIn(state.canoe.cargo, 'stone')).toBe(10);
    expect(takeBack(state, 1)).toMatchObject({ ok: true, gained: [{ itemId: 'driftwood', count: 9 }] });
    expect(state.players[0].backpack).toEqual([{ itemId: 'driftwood', count: 9 }]);
    expect(takeBack(state, 1)).toMatchObject(NOTHING);
  });

  it('a drop made after the capsize is a drop like any other', () => {
    const state = afloat();
    give(state, 'stone', 20, 'cargo');
    capsize(state);
    expect(drop(state, 'stone', 10, 'cargo').ok).toBe(true);
    expect(takeBack(state, 1)).toMatchObject({ ok: true, gained: [{ itemId: 'stone', count: 10 }] });
    expect(countIn(state.canoe.cargo, 'stone')).toBe(10);
  });

  it('the same for the one who collapses alone and is washed ashore with the canoe', () => {
    const state = ashore();
    give(state, 'stone', 20, 'cargo');
    expect(drop(state, 'stone', 20, 'cargo').ok).toBe(true);
    const events = collapse(state);
    // The solo rule took the canoe along and half its cargo: here there was none left aboard to take.
    expect(events.find((event) => event.type === 'washed_ashore')).toMatchObject({ lost: [] });
    expect(standingDrop(state, 0, 1)).toBeNull();
    expect(takeBack(state, 1)).toMatchObject(NOTHING);
    expect(countIn(state.canoe.cargo, 'stone')).toBe(0);
  });
});

describe('the cargo is the whole crew\'s, and so is its loss', () => {
  it('a crewmate\'s drop from the cargo ends too, and so does the drop of one who is away and rides along', () => {
    const state = afloat(3);
    for (const itemId of CARGO) give(state, itemId, 20, 'cargo');
    expect(drop(state, 'stone', 20, 'cargo', 1).ok).toBe(true);
    expect(drop(state, 'clay', 20, 'cargo', 2).ok).toBe(true);
    // Player 2 leaves the game in their seat. The capsize does not wash them ashore.
    setConnected(state, 2, false, true);
    const events = capsize(state);
    expect(events.filter((event) => event.type === 'washed_ashore').map((event) => event.playerId)).toEqual([0, 1]);
    expect(state.players.map((player) => player.mode)).toEqual(['foot', 'foot', 'canoe']);

    expect(takeBack(state, 1, 1)).toMatchObject(NOTHING);
    // Back in their seat, in reach of the cargo, within the seconds of their drop.
    setConnected(state, 2, true, true);
    expect(standingDrop(state, 2, 1)).toBeNull();
    expect(takeBack(state, 1, 2)).toMatchObject(NOTHING);
    expect(state.canoe.cargo).toEqual([{ itemId: 'driftwood', count: 10 }]);
  });

  it('a collapse alone in a crew takes half that backpack: their backpack drop ends, and nothing else does', () => {
    const state = ashore(2);
    state.players[0].backpack.push({ itemId: 'clay', count: 8 });
    state.players[1].backpack.push({ itemId: 'stone', count: 20 }, { itemId: 'berries', count: 6 });
    give(state, 'driftwood', 12, 'cargo');
    expect(drop(state, 'stone', 20, 'backpack', 1).ok).toBe(true);
    expect(drop(state, 'driftwood', 12, 'cargo', 1).ok).toBe(true);
    expect(drop(state, 'clay', 8, 'backpack', 0).ok).toBe(true);

    const events = collapse(state, 1);
    // Failing alone: the backpack pays, the canoe and its cargo do not.
    expect(events.find((event) => event.type === 'washed_ashore')).toMatchObject({ lost: [{ itemId: 'berries', count: 3 }] });
    expect(takeBack(state, 1, 1)).toMatchObject(NOTHING);
    expect(countIn(state.players[1].backpack, 'stone')).toBe(0);
    // Their drop from the cargo, which the collapse did not touch, and the crewmate's own backpack drop still stand.
    expect(takeBack(state, 2, 1)).toMatchObject({ ok: true, gained: [{ itemId: 'driftwood', count: 12 }] });
    expect(takeBack(state, 1, 0)).toMatchObject({ ok: true, gained: [{ itemId: 'clay', count: 8 }] });
    expect(countIn(state.canoe.cargo, 'driftwood')).toBe(12);
    expect(countIn(state.players[0].backpack, 'clay')).toBe(8);
  });
});

describe('the neighbours of the capsize', () => {
  it('a night\'s sleep takes nothing, so there is nothing to dodge: the drops come back whole, once', () => {
    const state = ashore();
    teleportToBed(state, 'home_knoll');
    state.time = 21 * HOUR;
    give(state, 'stone', 9);
    give(state, 'clay', 20, 'cargo');
    expect(drop(state, 'stone', 9, 'backpack').ok).toBe(true);
    expect(drop(state, 'clay', 20, 'cargo').ok).toBe(true);
    expect(dispatch(state, { type: 'sleep' })).toMatchObject({ ok: true });
    expect(drainEvents(state).some((event) => event.type === 'slept')).toBe(true);

    expect(takeBack(state, 1)).toMatchObject({ ok: true, gained: [{ itemId: 'stone', count: 9 }] });
    expect(takeBack(state, 2)).toMatchObject({ ok: true, gained: [{ itemId: 'clay', count: 20 }] });
    for (const dropId of [1, 2]) expect(takeBack(state, dropId)).toMatchObject(NOTHING);
    expect(countIn(state.players[0].backpack, 'stone')).toBe(9);
    expect(countIn(state.canoe.cargo, 'clay')).toBe(20);
  });

  it('a save and a load open nothing: before the capsize or after it, the loaded game says no', () => {
    const reload = (state: GameState): GameState => {
      const loaded = deserialize(serialize(state, 1));
      if (!loaded.ok) throw new Error('the save did not load');
      return loaded.state;
    };
    const dropped = (): GameState => {
      const state = afloat();
      give(state, 'stone', 20, 'cargo');
      drop(state, 'stone', 20, 'cargo');
      return state;
    };
    // Saved and loaded between the drop and the capsize.
    const before = reload(dropped());
    expect(standingDrop(before, 0, 1)).toMatchObject({ itemId: 'stone', count: 20 });
    capsize(before);
    expect(takeBack(before, 1)).toMatchObject(NOTHING);
    expect(countIn(before.canoe.cargo, 'stone')).toBe(0);
    // Saved and loaded after the capsize.
    const capsized = dropped();
    capsize(capsized);
    const after = reload(capsized);
    expect(takeBack(after, 1)).toMatchObject(NOTHING);
    expect(countIn(after.canoe.cargo, 'stone')).toBe(0);
  });

  it('a save made right after a drop gives it back once, each time that save is loaded, and never twice', () => {
    const state = ashore();
    give(state, 'stone', 9);
    drop(state, 'stone', 9, 'backpack');
    const saved = serialize(state, 1);
    for (let load = 0; load < 3; load += 1) {
      const loaded = deserialize(saved);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) continue;
      expect(takeBack(loaded.state, 1)).toMatchObject({ ok: true, gained: [{ itemId: 'stone', count: 9 }] });
      expect(takeBack(loaded.state, 1)).toMatchObject(NOTHING);
      expect(countIn(loaded.state.players[0].backpack, 'stone')).toBe(9);
    }
  });
});
