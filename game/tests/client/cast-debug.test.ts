/**
 * `&cast=`: the debug switch that shows any of the cast in a staged view. `&cast=<id>` dresses the local player,
 * `&cast=mix` makes a crew of four with one of each. Away from a browser (here) nobody is changed.
 */
import { describe, expect, it } from 'vitest';
import { parseDebugParameters } from '../../src/client/debug/parameters.ts';
import { addIdleCrew, stageCast } from '../../src/client/debug/staging.ts';
import { CHARACTER_IDS, characterOf } from '../../src/data/index.ts';
import { createGame } from '../../src/sim/index.ts';

describe('&cast= in the address', () => {
  it('each id of the cast is read, mix is read, anything else is nobody', () => {
    for (const id of CHARACTER_IDS) expect(parseDebugParameters(`?shot=island&cast=${id}`).cast).toBe(id);
    expect(parseDebugParameters('?cast=mix').cast).toBe('mix');
    for (const query of ['', '?cast=', '?cast=odile', '?cast=Trapper', '?cast=1', '?crew=4']) expect(parseDebugParameters(query).cast, query).toBeNull();
  });

  it('mix is a crew of four whatever crew says, and an id leaves the crew as asked', () => {
    expect(parseDebugParameters('?cast=mix').crew).toBe(4);
    expect(parseDebugParameters('?cast=mix&crew=2').crew).toBe(4);
    expect(parseDebugParameters('?cast=mix').sandbox).toBe(true);
    expect(parseDebugParameters('?cast=scout').crew).toBe(1);
    expect(parseDebugParameters('?cast=scout&crew=3').crew).toBe(3);
    // An id alone stages nothing, so it is no sandbox: the player's saves are theirs.
    expect(parseDebugParameters('?cast=scout').sandbox).toBe(false);
    expect(parseDebugParameters('?shot=island&cast=scout').sandbox).toBe(true);
  });
});

describe('a staged game dressed by &cast=', () => {
  it('an id: the local player is that one, the others as they were', () => {
    for (const id of CHARACTER_IDS) {
      const state = addIdleCrew(createGame(7), 3, id);
      expect(state.players.map((player) => player.character)).toEqual([id, undefined, undefined]);
      expect(characterOf(state.players[0])).toBe(id);
    }
  });

  it('mix: four players, one of each, in the cast\'s own order', () => {
    const state = addIdleCrew(createGame(7), parseDebugParameters('?cast=mix').crew, 'mix');
    expect(state.players).toHaveLength(4);
    expect(state.players.map((player) => characterOf(player))).toEqual([...CHARACTER_IDS]);
    expect(state.players.map((player) => player.character)).toEqual([...CHARACTER_IDS]);
  });

  it('nobody asked: nobody is changed, here where there is no address and when null is given', () => {
    const plain = addIdleCrew(createGame(7), 4);
    expect(plain.players.map((player) => player.character)).toEqual([undefined, undefined, undefined, undefined]);
    const picked = createGame(7);
    picked.players[0].character = 'angler';
    expect(stageCast(picked, null).players[0].character).toBe('angler');
    expect(addIdleCrew(picked, 2).players.map((player) => player.character)).toEqual(['angler', undefined]);
  });
});
