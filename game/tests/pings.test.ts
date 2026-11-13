/**
 * Pings in the rules: a spot marked on the map stands until it is replaced, cleared or reached,
 * one a player, inside the chart, no faster than one a second.
 */
import { describe, expect, it } from 'vitest';
import { CHART } from '../src/client/viewmodels/chart.ts';
import { deserialize, serialize } from '../src/save/index.ts';
import { FIXED_STEP, NEUTRAL_INPUT, PING, dispatch, hashState, pingInBounds, setConnected, standingPings, step } from '../src/sim/index.ts';
import type { GameState } from '../src/sim/index.ts';
import { newGame, run } from './support.ts';

const saves = import.meta.glob<string>('./fixtures/save-*.json', { eager: true, query: '?raw', import: 'default' });

/** A crew afloat south of Home Knoll, on water that holds still enough to count steps on. */
function crewGame(crew = 2): GameState {
  const game = newGame(7, { crew });
  game.weather.secondsRemaining = 99999;
  return game;
}

/** Stand a player somewhere, on foot, without walking them there. */
function putAt(game: GameState, playerId: number, x: number, z: number): void {
  Object.assign(game.players[playerId]!, { mode: 'foot', seat: null, position: { x, y: 0, z } });
}

const wait = (game: GameState, seconds: number): void => {
  run(game, {}, seconds);
};

const spots = (game: GameState): [number, number, number][] => standingPings(game).map((ping) => [ping.playerId, ping.x, ping.z]);

describe('a ping', () => {
  it('marks the spot that was asked for, to the metre, and is nobody else\'s', () => {
    const game = crewGame();
    expect(game.pings).toBeUndefined();
    expect(dispatch(game, { type: 'ping', x: 412.4, z: -318.6 }, 1)).toEqual({ ok: true, gained: [], spent: [] });
    expect(spots(game)).toEqual([[1, 412, -319]]);
    expect(game.pings![0]!.tick).toBe(game.tick);
  });

  it('snaps to nothing: an island\'s middle and a spot beside it are two different pings', () => {
    const game = crewGame();
    dispatch(game, { type: 'ping', x: 0, z: 1000 }, 0);
    dispatch(game, { type: 'ping', x: 7, z: 1003 }, 1);
    expect(spots(game)).toEqual([[0, 0, 1000], [1, 7, 1003]]);
  });

  it('may stand under the fog: a spot nobody has seen', () => {
    const game = crewGame();
    expect(dispatch(game, { type: 'ping', x: -900, z: -1200 }, 0).ok).toBe(true);
    expect(spots(game)).toEqual([[0, -900, -1200]]);
  });

  it('is replaced by the same player\'s next one, and leaves a crewmate\'s alone', () => {
    const game = crewGame(3);
    dispatch(game, { type: 'ping', x: 100, z: 100 }, 0);
    dispatch(game, { type: 'ping', x: 200, z: 200 }, 2);
    wait(game, 1.1);
    expect(dispatch(game, { type: 'ping', x: 300, z: 300 }, 0).ok).toBe(true);
    expect(spots(game)).toEqual([[0, 300, 300], [2, 200, 200]]);
    expect(game.pings).toHaveLength(2);
  });

  it('is cleared by its owner, or by a crewmate, and clearing nothing is no fault', () => {
    const game = crewGame(3);
    dispatch(game, { type: 'ping', x: 100, z: 100 }, 0);
    dispatch(game, { type: 'ping', x: 200, z: 200 }, 1);
    expect(dispatch(game, { type: 'clear_ping', playerId: 0 }, 0).ok).toBe(true);
    expect(spots(game)).toEqual([[1, 200, 200]]);
    expect(dispatch(game, { type: 'clear_ping', playerId: 1 }, 2).ok).toBe(true);
    expect(spots(game)).toEqual([]);
    const before = game.pings;
    expect(dispatch(game, { type: 'clear_ping', playerId: 1 }, 2).ok).toBe(true);
    expect(dispatch(game, { type: 'clear_ping', playerId: 3 }, 2).ok).toBe(true);
    expect(game.pings).toBe(before);
  });
});

describe('reaching a ping', () => {
  it('puts it out when a crewmate comes within reach, and not a step sooner', () => {
    const game = crewGame();
    putAt(game, 0, 400, 400);
    putAt(game, 1, 0, 0);
    dispatch(game, { type: 'ping', x: 0, z: 600 }, 0);
    putAt(game, 1, 0, 600 - PING.reachMetres - 1.5);
    wait(game, 0.5);
    expect(spots(game)).toEqual([[0, 0, 600]]);
    putAt(game, 1, 0, 600 - PING.reachMetres + 0.5);
    wait(game, 0.5);
    expect(spots(game)).toEqual([]);
  });

  it('counts the pinger too: a spot you marked and then went to is done', () => {
    const game = crewGame(1);
    putAt(game, 0, 400, 400);
    dispatch(game, { type: 'ping', x: 0, z: 600 }, 0);
    wait(game, 0.5);
    expect(spots(game)).toHaveLength(1);
    putAt(game, 0, 3, 598);
    wait(game, 0.5);
    expect(spots(game)).toEqual([]);
  });

  it('does not count whoever stood there when it was set, until they have left and come back', () => {
    const game = crewGame();
    putAt(game, 0, 0, 600);
    putAt(game, 1, 400, 400);
    dispatch(game, { type: 'ping', x: 4, z: 604 }, 0);
    expect(game.pings![0]!.inside).toEqual([0]);
    wait(game, 1);
    expect(spots(game)).toEqual([[0, 4, 604]]);
    putAt(game, 0, 100, 600);
    wait(game, 0.5);
    expect(game.pings![0]!.inside).toEqual([]);
    expect(spots(game)).toEqual([[0, 4, 604]]);
    putAt(game, 0, 0, 600);
    wait(game, 0.5);
    expect(spots(game)).toEqual([]);
  });

  it('does not count a player who is away', () => {
    const game = crewGame();
    putAt(game, 0, 400, 400);
    putAt(game, 1, 0, 0);
    dispatch(game, { type: 'ping', x: 0, z: 600 }, 0);
    setConnected(game, 1, false);
    putAt(game, 1, 0, 600);
    wait(game, 0.5);
    expect(spots(game)).toEqual([[0, 0, 600]]);
    setConnected(game, 1, true);
    wait(game, 0.5);
    expect(spots(game)).toEqual([]);
  });

  it('writes nothing while a ping just stands: the list is the same list, step after step', () => {
    const game = crewGame();
    putAt(game, 0, 400, 400);
    putAt(game, 1, 300, 300);
    dispatch(game, { type: 'ping', x: 0, z: 600 }, 0);
    const list = game.pings;
    wait(game, 2);
    expect(game.pings).toBe(list);
  });
});

describe('what the host refuses', () => {
  it('a spot off the round chart, and a spot that is not a number', () => {
    const game = crewGame();
    const rim = PING.centerZ - PING.radius;
    expect(dispatch(game, { type: 'ping', x: 0, z: rim - 2 }, 0)).toEqual({ ok: false, reason: 'off_the_map', missing: null });
    expect(dispatch(game, { type: 'ping', x: 1700, z: 0 }, 0)).toMatchObject({ ok: false, reason: 'off_the_map' });
    expect(dispatch(game, { type: 'ping', x: 1200, z: 1200 }, 0)).toMatchObject({ ok: false, reason: 'off_the_map' });
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(dispatch(game, { type: 'ping', x: bad, z: 0 }, 0)).toMatchObject({ ok: false, reason: 'off_the_map' });
      expect(dispatch(game, { type: 'ping', x: 0, z: bad }, 0)).toMatchObject({ ok: false, reason: 'off_the_map' });
    }
    expect(game.pings).toBeUndefined();
    expect(dispatch(game, { type: 'ping', x: 0, z: rim + 1 }, 0).ok).toBe(true);
    expect(pingInBounds(0, rim)).toBe(true);
    expect(pingInBounds(0, rim - 0.01)).toBe(false);
  });

  it('a second ping within a second of the first, and no clearing gets round it', () => {
    const game = crewGame();
    expect(dispatch(game, { type: 'ping', x: 100, z: 100 }, 0).ok).toBe(true);
    for (let steps = 1; steps < PING.restSteps; steps += 1) step(game, NEUTRAL_INPUT, FIXED_STEP);
    expect(dispatch(game, { type: 'ping', x: 200, z: 200 }, 0)).toEqual({ ok: false, reason: 'ping_too_soon', missing: null });
    dispatch(game, { type: 'clear_ping', playerId: 0 }, 0);
    expect(dispatch(game, { type: 'ping', x: 200, z: 200 }, 0)).toMatchObject({ ok: false, reason: 'ping_too_soon' });
    // A crewmate's wait is their own.
    expect(dispatch(game, { type: 'ping', x: 300, z: 300 }, 1).ok).toBe(true);
    step(game, NEUTRAL_INPUT, FIXED_STEP);
    expect(dispatch(game, { type: 'ping', x: 200, z: 200 }, 0).ok).toBe(true);
    expect(spots(game)).toEqual([[0, 200, 200], [1, 300, 300]]);
  });

  it('a ping for a player who is away', () => {
    const game = crewGame();
    setConnected(game, 1, false);
    expect(dispatch(game, { type: 'ping', x: 100, z: 100 }, 1)).toMatchObject({ ok: false, reason: 'player_away' });
    expect(game.pings).toBeUndefined();
  });
});

describe('a ping and the rest of the game', () => {
  it('works from a bed and in a talk, and gets nobody up', () => {
    const game = crewGame();
    game.players[0]!.asleep = true;
    game.players[1]!.dialogue = { npcId: 'tink', nodeId: 'meet' };
    expect(dispatch(game, { type: 'ping', x: 100, z: 100 }, 0).ok).toBe(true);
    expect(dispatch(game, { type: 'ping', x: 200, z: 200 }, 1).ok).toBe(true);
    expect(game.players[0]!.asleep).toBe(true);
    expect(dispatch(game, { type: 'clear_ping', playerId: 1 }, 0).ok).toBe(true);
    expect(game.players[0]!.asleep).toBe(true);
    expect(spots(game)).toEqual([[0, 100, 100]]);
  });

  it('leaves a game nobody pings in exactly as it was: no field, the same fingerprint', () => {
    const plain = crewGame();
    const other = crewGame();
    wait(plain, 3);
    wait(other, 3);
    expect('pings' in plain).toBe(false);
    expect(hashState(other)).toBe(hashState(plain));
    // And the check can fail: one ping, and the fingerprints part.
    dispatch(other, { type: 'ping', x: 100, z: 100 }, 0);
    expect(hashState(other)).not.toBe(hashState(plain));
  });

  it('is plain data, kept by a save and read back standing', () => {
    const game = crewGame();
    putAt(game, 0, 400, 400);
    putAt(game, 1, 300, 300);
    dispatch(game, { type: 'ping', x: 0, z: 600 }, 1);
    const loaded = deserialize(serialize(game, 0));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(spots(loaded.state)).toEqual([[1, 0, 600]]);
    wait(loaded.state, 0.5);
    expect(spots(loaded.state)).toEqual([[1, 0, 600]]);
  });

  it('is not in any save from before: each loads with no ping and plays on', () => {
    expect(Object.keys(saves).length).toBeGreaterThanOrEqual(7);
    for (const [name, text] of Object.entries(saves)) {
      const loaded = deserialize(text);
      expect(loaded.ok, name).toBe(true);
      if (!loaded.ok) continue;
      expect(standingPings(loaded.state), name).toEqual([]);
      wait(loaded.state, 0.5);
      expect('pings' in loaded.state, name).toBe(false);
    }
  });

  it('survives a hand-edited save: what is not a ping is not read, and nothing throws', () => {
    const game = crewGame();
    putAt(game, 0, 400, 400);
    putAt(game, 1, 300, 300);
    const good = { playerId: 1, x: 50, z: 60, tick: 0, standing: true, inside: [] };
    (game as unknown as { pings: unknown }).pings = [null, 7, 'x', { playerId: 'me', x: 1, z: 2 }, { ...good, x: Number.NaN }, good, { ...good, inside: 3 }];
    expect(spots(game)).toEqual([[1, 50, 60]]);
    wait(game, 0.5);
    expect(game.pings).toEqual([good]);
    (game as unknown as { pings: unknown }).pings = 'everywhere';
    expect(standingPings(game)).toEqual([]);
    wait(game, 0.5);
    expect(dispatch(game, { type: 'ping', x: 100, z: 100 }, 0).ok).toBe(true);
    expect(spots(game)).toEqual([[0, 100, 100]]);
  });

  it('may stand anywhere the map panel shows: its bounds are the round chart\'s', () => {
    expect([PING.centerX, PING.centerZ, PING.radius]).toEqual([CHART.centerX, CHART.centerZ, CHART.radius]);
  });
});
