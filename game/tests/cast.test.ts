/**
 * Who a player is, in the rules and in the save: the pick is a word on the player and nothing more.
 * It is set through one door, no rule reads it, a new game sets none, and every save from before it loads as it was.
 */
import { describe, expect, it } from 'vitest';
import { CHARACTER_IDS, characterOf } from '../src/data/index.ts';
import { SAVE_VERSION, deserialize, serialize } from '../src/save/index.ts';
import { STATE_VERSION, hashState, setPlayerCharacter } from '../src/sim/index.ts';
import type { GameState } from '../src/sim/index.ts';
import { newGame, run } from './support.ts';

const simulation = import.meta.glob('../src/sim/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const fixtures = import.meta.glob<string>('./fixtures/save-*.json', { eager: true, query: '?raw', import: 'default' });

/** Source with comments and string literals removed, so prose cannot trip the check. */
const code = (source: string): string => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '')
  .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
  .replace(/`(?:[^`\\]|\\.)*`/g, '``');

describe('the pick lives on the player', () => {
  it('goes on the one player named, and is one of the four or nothing', () => {
    const state = newGame(7, { crew: 3 });
    for (const character of CHARACTER_IDS) {
      setPlayerCharacter(state, 1, character);
      expect(state.players.map((player) => player.character)).toEqual([undefined, character, undefined]);
    }
    // Anything else changes nothing: the last good pick stands.
    for (const junk of ['wizard', 'constructor', '__proto__', '', 'Voyageur', 0, 3, null, undefined, {}, ['trapper'], true]) {
      setPlayerCharacter(state, 1, junk);
      expect(state.players[1]!.character, String(junk)).toBe('scout');
      setPlayerCharacter(state, 2, junk);
      expect('character' in state.players[2]!, String(junk)).toBe(false);
    }
    // No such player: nobody is made, nobody is changed.
    setPlayerCharacter(state, 9, 'angler');
    expect(state.players.map((player) => player.character)).toEqual([undefined, 'scout', undefined]);
  });

  it('a new game sets none: every player is drawn by seat, as before the screen', () => {
    const state = newGame(7, { crew: 4 });
    for (const player of state.players) expect('character' in player).toBe(false);
    expect(state.players.map((player) => characterOf(player))).toEqual([...CHARACTER_IDS]);
  });

  it('no rule reads it: the same game plays the same whoever the players are', () => {
    const plain = newGame(11, { crew: 2 });
    const picked = newGame(11, { crew: 2 });
    setPlayerCharacter(picked, 0, 'angler');
    setPlayerCharacter(picked, 1, 'scout');
    const without = (state: GameState): GameState => ({ ...state, players: state.players.map(({ character: _character, ...player }) => player) });
    for (const state of [plain, picked]) run(state, { paddle: 1, steer: 0.3, bail: true }, 20);
    expect(picked.players.map((player) => player.character)).toEqual(['angler', 'scout']);
    expect(hashState(without(picked))).toBe(hashState(plain));
    expect(without(picked)).toEqual(plain);
  });

  it('nothing in the rules names the field but the door that sets it', () => {
    expect(Object.keys(simulation).length).toBeGreaterThanOrEqual(14);
    const readers = Object.entries(simulation)
      .filter(([path]) => !path.endsWith('/sim/types.ts') && !path.endsWith('/sim/index.ts'))
      .flatMap(([path, source]) => code(source).split('\n')
        .filter((line) => /\bcharacter\b|\bcharacterOf\b/.test(line))
        .map((line) => `${path.replace('../src/sim/', '')}: ${line.trim()}`));
    expect(readers).toEqual([
      'step.ts: export function setPlayerCharacter(state: GameState, playerId: PlayerId, character: unknown): void {',
      'step.ts: if (player && isCharacterId(character)) player.character = character;',
    ]);
  });
});

describe('the save keeps the pick', () => {
  it('is still version 4, and a pick comes back from a save as it went in', () => {
    expect(STATE_VERSION).toBe(4);
    expect(SAVE_VERSION).toBe(4);
    const state = newGame(7, { crew: 3 });
    setPlayerCharacter(state, 0, 'trapper');
    setPlayerCharacter(state, 2, 'angler');
    const loaded = deserialize(serialize(state, 5));
    expect(loaded.ok && loaded.migratedFrom).toBeNull();
    if (!loaded.ok) return;
    expect(loaded.state.players.map((player) => player.character)).toEqual(['trapper', undefined, 'angler']);
    expect('character' in loaded.state.players[1]!).toBe(false);
    expect(loaded.state).toEqual({ ...state, events: [] });
  });

  it('a pick this build does not know is dropped, and the save loads', () => {
    for (const junk of ['wizard', 'constructor', '', 7, null, { id: 'trapper' }, ['angler']]) {
      const state = newGame(7, { crew: 2 });
      setPlayerCharacter(state, 1, 'scout');
      const saved = JSON.parse(serialize(state, 5)) as { state: { players: Record<string, unknown>[] } };
      saved.state.players[0]!.character = junk;
      const loaded = deserialize(JSON.stringify(saved));
      expect(loaded.ok, JSON.stringify(junk)).toBe(true);
      if (!loaded.ok) continue;
      // The bad one is gone, not replaced; the good one beside it stands; nothing else changed.
      expect('character' in loaded.state.players[0]!, JSON.stringify(junk)).toBe(false);
      expect(loaded.state.players[1]!.character).toBe('scout');
      expect(loaded.state).toEqual({ ...state, events: [] });
      expect(characterOf(loaded.state.players[0]!)).toBe('voyageur');
    }
  });

  it('every save from before the screen loads with nobody picked for', () => {
    const names = Object.keys(fixtures).sort();
    expect(names).toEqual([
      './fixtures/save-live-seed3-min008.json', './fixtures/save-live-seed3-min030.json', './fixtures/save-live-seed7-min100.json',
      './fixtures/save-v1-afloat.json', './fixtures/save-v1-ashore.json', './fixtures/save-v1-endgame.json', './fixtures/save-v3-ashore.json',
    ]);
    for (const name of names) {
      const loaded = deserialize(fixtures[name]!);
      expect(loaded.ok, name).toBe(true);
      if (!loaded.ok) continue;
      for (const player of loaded.state.players) expect('character' in player, name).toBe(false);
      // Seat 0 with no pick is the lone paddler the game always drew.
      expect(characterOf(loaded.state.players[0]!), name).toBe('voyageur');
      // And what it loads as is what today's build saves and loads again, to the letter.
      const again = deserialize(serialize(loaded.state, 5));
      expect(again.ok && again.state, name).toEqual({ ...loaded.state, events: [] });
    }
  });
});
