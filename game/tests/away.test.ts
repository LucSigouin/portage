/**
 * Players who come and go: an away player keeps everything and holds nobody
 * up. Solo is covered by the rest of the suite and by the six bot fingerprints.
 */
import { describe, expect, it } from 'vitest';
import { ISLANDS_BY_ID, TUNING } from '../src/data/index.ts';
import type { IslandId } from '../src/data/index.ts';
import { deserialize, serialize } from '../src/save/index.ts';
import { countHeld } from '../src/sim/inventory.ts';
import {
  FIXED_STEP, MAXIMUM_NAME_LENGTH, NEUTRAL_INPUT, STATE_VERSION, cleanPlayerName, connectedPlayers, dispatch, drainEvents,
  setConnected, setPlayerName, step, terrainHeight,
} from '../src/sim/index.ts';
import type { GameEvent, GameState, PlayerState, StepInput } from '../src/sim/index.ts';
import { bedSide, floatCanoeAt, newGame, standOn } from './support.ts';

const DAY = TUNING.time.daySeconds;
const HOUR = TUNING.time.hourSeconds;

function runCrew(state: GameState, inputs: Partial<StepInput>[], seconds: number): GameEvent[] {
  const full = inputs.map((input) => ({ ...NEUTRAL_INPUT, ...input }));
  const events: GameEvent[] = [];
  for (let index = 0; index < Math.round(seconds / FIXED_STEP); index += 1) {
    step(state, full, FIXED_STEP);
    events.push(...drainEvents(state));
  }
  return events;
}

function putAshore(player: PlayerState, islandId: IslandId, x: number, z: number): void {
  player.mode = 'foot';
  player.seat = null;
  player.islandId = islandId;
  player.position = { x, y: terrainHeight(x, z), z };
}

/** The canoe beached at Home Knoll, everyone fed and rested in a row by the lean-to. */
function crewAtCamp(crew: number): GameState {
  const state = newGame(7, { crew });
  standOn(state, 'home_knoll');
  state.players.forEach((player, index) => {
    const spot = bedSide('home_knoll', index);
    putAshore(player, 'home_knoll', spot.x, spot.z);
    Object.assign(player, { hunger: 100, thirst: 100, energy: 100 });
  });
  drainEvents(state);
  return state;
}

/** A crew afloat on calm water south of Home Knoll, in a tight dry hull, under a sky that holds. */
function crewAfloat(crew: number): GameState {
  const state = newGame(7, { crew });
  state.canoe.hullTier = 1;
  floatCanoeAt(state, 200, 1300, 0);
  for (const player of state.players) player.position = { ...state.canoe.position };
  state.weather.secondsRemaining = 99999;
  drainEvents(state);
  return state;
}

const vitals = (player: PlayerState) => ({ hunger: player.hunger, thirst: player.thirst, energy: player.energy });

describe('a player who is away', () => {
  it('starts connected, with no name, and the state version says so', () => {
    const state = newGame(7, { crew: 3 });
    expect(STATE_VERSION).toBe(3);
    expect(state.players.map((player) => [player.connected, player.name])).toEqual([[true, ''], [true, ''], [true, '']]);
    expect(connectedPlayers(state)).toHaveLength(3);
  });

  it('keeps their seat, their backpack and their place, and gets the same player back', () => {
    const state = crewAfloat(3);
    state.players[1].backpack.push({ itemId: 'driftwood', count: 4 });
    state.players[1].selectedTool = 'bailing_can';
    const before = JSON.parse(JSON.stringify(state.players[1])) as PlayerState;
    expect(setConnected(state, 1, false)).toBe(true);
    runCrew(state, [{ paddle: 1 }, { paddle: 1 }, {}], 120);
    expect(state.players).toHaveLength(3);
    expect(state.players[1]).toMatchObject({
      id: 1, seat: before.seat, mode: 'canoe', backpack: before.backpack, selectedTool: 'bailing_can', connected: false,
    });
    // They ride along in their seat: the canoe moved, and so did they.
    expect(state.canoe.position.z).toBeLessThan(1290);
    expect(state.players[1].position).toEqual(state.canoe.position);
    expect(setConnected(state, 1, true)).toBe(true);
    expect(state.players[1]).toMatchObject({ id: 1, seat: before.seat, backpack: before.backpack, connected: true });
    // Nothing changes when nothing changes, and nobody is made up.
    expect(setConnected(state, 1, true)).toBe(false);
    expect(setConnected(state, 9, false)).toBe(false);
  });

  it('holds still whatever input arrives for them, and paddles nothing', () => {
    const state = crewAfloat(2);
    setConnected(state, 0, false);
    setConnected(state, 1, false);
    const start = { ...state.canoe.position };
    runCrew(state, [{ paddle: 1, steer: 1 }, { paddle: 1 }], 30);
    expect(state.canoe.position.x).toBe(start.x);
    expect(state.canoe.position.z).toBe(start.z);
    expect(state.players.map((player) => player.paddling)).toEqual([false, false]);
  });

  it('has meters that stand still while the others drain, and cannot fail', () => {
    const state = crewAtCamp(4);
    // Player 2 is starving and spent: a connected player would fail on the next step. Player 3 is middling.
    Object.assign(state.players[2], { hunger: 0, thirst: 0, energy: 0 });
    Object.assign(state.players[3], { hunger: 61, thirst: 62, energy: 63 });
    setConnected(state, 2, false);
    setConnected(state, 3, false);
    const present = vitals(state.players[1]);
    // Thirty minutes: long past the 25 it took an idle stand-in to starve.
    const events = runCrew(state, [], 30 * 60);
    expect(vitals(state.players[2])).toEqual({ hunger: 0, thirst: 0, energy: 0 });
    expect(vitals(state.players[3])).toEqual({ hunger: 61, thirst: 62, energy: 63 });
    expect(state.players[1].hunger).toBeLessThan(present.hunger);
    expect(state.players[1].thirst).toBeLessThan(present.thirst);
    const theirs = events.filter((event) => event.playerId === 2 || event.playerId === 3);
    expect(theirs.filter((event) => event.type === 'exhausted' || event.type === 'washed_ashore' || event.type === 'meter_low')).toEqual([]);
    expect(state.players.slice(2).map((player) => [player.mode, player.islandId])).toEqual([['foot', 'home_knoll'], ['foot', 'home_knoll']]);
    expect(state.statistics.fails).toBe(0);
  });

  it('is not acted for: every command sent as them is refused', () => {
    const state = crewAtCamp(2);
    state.players[1].backpack.push({ itemId: 'berries', count: 2 });
    setConnected(state, 1, false);
    const before = JSON.stringify(state);
    expect(dispatch(state, { type: 'eat', itemId: 'berries' }, 1)).toEqual({ ok: false, reason: 'player_away', missing: null });
    expect(dispatch(state, { type: 'board' }, 1)).toMatchObject({ ok: false, reason: 'player_away' });
    expect(dispatch(state, { type: 'set_difficulty', difficulty: 'relaxed' }, 1)).toMatchObject({ ok: false, reason: 'player_away' });
    expect(JSON.stringify(state)).toBe(before);
  });

  it('lets go of the paddle, a bed and a talk when they leave, and tells the crew', () => {
    const state = crewAtCamp(3);
    state.time = 21 * HOUR;
    dispatch(state, { type: 'sleep' }, 1);
    expect(state.players[1].asleep).toBe(true);
    drainEvents(state);
    setConnected(state, 1, false);
    expect(state.players[1]).toMatchObject({ asleep: false, dialogue: null, paddling: false, bailing: false, connected: false });
    setConnected(state, 1, true);
    expect(drainEvents(state)).toEqual([
      { type: 'crew_changed', who: 1, change: 'away' },
      { type: 'crew_changed', who: 1, change: 'back' },
    ]);
    setConnected(state, 2, false, true);
    expect(drainEvents(state)).toEqual([]);
  });
});

describe('the night with someone away', () => {
  function bedtime(crew: number): GameState {
    const state = crewAtCamp(crew);
    state.time = 21 * HOUR;
    for (const player of state.players) player.energy = 30;
    return state;
  }

  it('skips once every connected player is asleep, and passes the away one by', () => {
    const state = bedtime(3);
    setConnected(state, 1, false, true);
    const away = vitals(state.players[1]);
    expect(dispatch(state, { type: 'sleep' }, 0).ok).toBe(true);
    expect(state.time).toBe(21 * HOUR); // player 2 is still up
    expect(dispatch(state, { type: 'sleep' }, 2).ok).toBe(true);
    expect(state.time).toBe(DAY + 6 * HOUR);
    expect(state.players.map((player) => player.energy)).toEqual([100, 30, 100]);
    expect(vitals(state.players[1])).toEqual(away);
    expect(state.players.every((player) => !player.asleep)).toBe(true);
    const events = drainEvents(state);
    expect(events.filter((event) => event.type === 'slept').map((event) => event.playerId)).toEqual([0, 2]);
  });

  it('skips the moment the last one still up goes away', () => {
    const state = bedtime(3);
    dispatch(state, { type: 'sleep' }, 0);
    dispatch(state, { type: 'sleep' }, 2);
    expect(state.time).toBe(21 * HOUR);
    setConnected(state, 1, false);
    expect(state.time).toBe(DAY + 6 * HOUR);
    expect(state.players.map((player) => player.energy)).toEqual([100, 30, 100]);
  });

  it('does not skip for an empty crew: nobody asleep, nobody left', () => {
    const state = bedtime(2);
    setConnected(state, 0, false);
    setConnected(state, 1, false);
    expect(state.time).toBe(21 * HOUR);
  });

  it('still waits for everyone when nobody is away', () => {
    const state = bedtime(2);
    dispatch(state, { type: 'sleep' }, 0);
    expect(state.time).toBe(21 * HOUR);
    dispatch(state, { type: 'sleep' }, 1);
    expect(state.time).toBe(DAY + 6 * HOUR);
  });
});

describe('fails with someone away', () => {
  it('a capsize takes the connected players aboard and leaves the away one in their seat, untouched', () => {
    const state = crewAfloat(3);
    Object.assign(state.players[2], { hunger: 12, thirst: 13, energy: 14 });
    state.players[2].backpack.push({ itemId: 'driftwood', count: 6 });
    setConnected(state, 2, false, true);
    const seat = state.players[2].seat;
    state.canoe.waterLevel = TUNING.canoe.capsizeLevel;
    const events = runCrew(state, [], FIXED_STEP);
    expect(events.filter((event) => event.type === 'washed_ashore').map((event) => event.playerId)).toEqual([0, 1]);
    expect(state.players.map((player) => player.mode)).toEqual(['foot', 'foot', 'canoe']);
    expect(state.players[2]).toMatchObject({ seat, hunger: 12, thirst: 13, energy: 14, backpack: [{ itemId: 'driftwood', count: 6 }] });
    // They went where the canoe went.
    runCrew(state, [], FIXED_STEP);
    expect(state.players[2].position.x).toBeCloseTo(state.canoe.position.x, 6);
    expect(state.players[2].position.z).toBeCloseTo(state.canoe.position.z, 6);
    expect(state.canoe.beached).toBe(true);
  });

  it('a canoe with only away players aboard waits where it is: no drift, no leak, no capsize', () => {
    const state = crewAfloat(2);
    putAshore(state.players[0], 'home_knoll', ISLANDS_BY_ID.home_knoll.center.x, ISLANDS_BY_ID.home_knoll.center.z);
    state.canoe.hullTier = 0; // the leaky hull
    state.canoe.speed = 2;
    state.canoe.waterLevel = 40;
    state.weather.windSpeed = 9;
    setConnected(state, 1, false, true);
    const start = { x: state.canoe.position.x, z: state.canoe.position.z };
    const events = runCrew(state, [], 20 * 60);
    expect(state.canoe.position.x).toBe(start.x);
    expect(state.canoe.position.z).toBe(start.z);
    expect(state.canoe.waterLevel).toBe(40);
    expect(events.some((event) => event.type === 'capsized' || event.type === 'washed_ashore')).toBe(false);
    expect(state.players[1]).toMatchObject({ mode: 'canoe', connected: false });
    // Back at the paddle, it is a canoe again.
    setConnected(state, 1, true, true);
    runCrew(state, [{}, { paddle: 1 }], 10);
    expect(state.canoe.position.z).not.toBe(start.z);
    expect(state.canoe.waterLevel).toBeGreaterThan(40);
  });

  it('the only one still playing fails by the solo rule, even ashore: the canoe comes along, the clock jumps', () => {
    const state = crewAtCamp(3);
    setConnected(state, 1, false, true);
    setConnected(state, 2, false, true);
    state.canoe.cargo.push({ itemId: 'driftwood', count: 10 });
    const time = state.time;
    // Starving, so the step cannot rest the energy back up.
    Object.assign(state.players[0], { hunger: 0, thirst: 0, energy: 0 });
    const events = runCrew(state, [], FIXED_STEP);
    expect(events).toContainEqual(expect.objectContaining({ type: 'washed_ashore', cause: 'exhausted', playerId: 0 }));
    // The solo rule: six hours gone and half the cargo. Failing alone in a crew would touch neither.
    expect(state.time).toBeCloseTo(time + FIXED_STEP + TUNING.time.failSkipHours * HOUR, 6);
    expect(state.canoe.cargo).toEqual([{ itemId: 'driftwood', count: 5 }]);
    // The away ones did not move and did not pay.
    expect(state.players.slice(1).map((player) => [player.mode, player.islandId, player.energy])).toEqual([
      ['foot', 'home_knoll', 100], ['foot', 'home_knoll', 100],
    ]);
  });

  it('the last connected player aboard takes the canoe along, whoever away sits beside them', () => {
    const state = crewAfloat(3);
    putAshore(state.players[2], 'home_knoll', ISLANDS_BY_ID.home_knoll.center.x, ISLANDS_BY_ID.home_knoll.center.z);
    setConnected(state, 1, false, true); // away, in the bow seat
    Object.assign(state.players[0], { hunger: 0, thirst: 0, energy: 0 });
    const events = runCrew(state, [], FIXED_STEP);
    expect(events).toContainEqual(expect.objectContaining({ type: 'washed_ashore', cause: 'exhausted', playerId: 0 }));
    // Not left adrift with nobody at the paddle: it is on the beach where player 0 woke.
    expect(state.canoe.beached).toBe(true);
    expect(state.players[1]).toMatchObject({ mode: 'canoe', connected: false, energy: 90 });
    // The one ashore is where they were, and did not fail.
    expect(state.players[2]).toMatchObject({ mode: 'foot', islandId: 'home_knoll' });
    expect(state.statistics.fails).toBe(1);
  });
});

describe('what an away player owns', () => {
  it('does not count for the crew and is never drawn on', () => {
    const state = crewAtCamp(2);
    state.players[0].backpack.push({ itemId: 'driftwood', count: 2 });
    state.players[1].backpack.push({ itemId: 'driftwood', count: 5 });
    expect(countHeld(state, 'driftwood')).toBe(7);
    setConnected(state, 1, false, true);
    expect(countHeld(state, 'driftwood')).toBe(2);
    setConnected(state, 1, true, true);
    expect(countHeld(state, 'driftwood')).toBe(7);
    expect(state.players[1].backpack).toEqual([{ itemId: 'driftwood', count: 5 }]);
  });
});

describe('names', () => {
  it('are cut to twelve letters and cleaned', () => {
    expect(MAXIMUM_NAME_LENGTH).toBe(12);
    expect(cleanPlayerName('Luc')).toBe('Luc');
    expect(cleanPlayerName('  Maximilienne-Josephine  ')).toBe('Maximilienne');
    expect(cleanPlayerName('a\u0000b\n\tc')).toBe('a b c');
    expect(cleanPlayerName('Zoë \u{1F6F6}\u{1F6F6}\u{1F6F6}\u{1F6F6}\u{1F6F6}\u{1F6F6}\u{1F6F6}\u{1F6F6}\u{1F6F6}\u{1F6F6}')).toBe('Zoë \u{1F6F6}\u{1F6F6}\u{1F6F6}\u{1F6F6}\u{1F6F6}\u{1F6F6}\u{1F6F6}\u{1F6F6}');
    for (const junk of [undefined, null, 7, {}, ['x']]) expect(cleanPlayerName(junk)).toBe('');
    expect(cleanPlayerName('           ')).toBe('');
  });

  it('go on the player and nowhere else', () => {
    const state = newGame(7, { crew: 2 });
    setPlayerName(state, 1, 'Sam the Paddler');
    expect(state.players.map((player) => player.name)).toEqual(['', 'Sam the Padd']);
    setPlayerName(state, 5, 'Nobody');
    expect(state.players).toHaveLength(2);
  });
});

describe('saves', () => {
  it('a version 2 save loads with everyone present and unnamed', () => {
    const state = newGame(7, { crew: 2 });
    const old = JSON.parse(serialize(state, 5)) as { version: number; state: { players: Record<string, unknown>[] } };
    old.version = 2;
    for (const player of old.state.players) {
      delete player.name;
      delete player.connected;
    }
    const loaded = deserialize(JSON.stringify(old));
    expect(loaded).toMatchObject({ ok: true, migratedFrom: 2 });
    if (!loaded.ok) return;
    expect(loaded.state.players.map((player) => [player.name, player.connected])).toEqual([['', true], ['', true]]);
    expect(loaded.state.version).toBe(3);
  });

  it('an away player is still away, and still there, after a save and a load', () => {
    const state = newGame(7, { crew: 3 });
    setPlayerName(state, 2, 'Sam');
    setConnected(state, 2, false, true);
    const loaded = deserialize(serialize(state, 5));
    expect(loaded.ok && loaded.state.players.map((player) => [player.id, player.name, player.connected])).toEqual([
      [0, '', true], [1, '', true], [2, 'Sam', false],
    ]);
  });
});
