/**
 * Who sits where, for the tests that hold every figure of the cast to what the paddler's figure is held to.
 *
 * - `SAME`: four of one person. Each of the four is in every seat, and next to themselves: a bedroll behind a
 *   bedroll, a brim behind a brim. "four voyageurs" is the crew exactly as the game drew it before there was a cast.
 * - `MIXED`: one of each, turned through the seats, so each one sits next to each other one. Turned 0 is a crew
 *   nobody has picked for: the game's own stand-ins by player number.
 */
import { CHARACTER_IDS } from '../../src/data/index.ts';
import type { CharacterId } from '../../src/data/index.ts';
import type { GameState } from '../../src/sim/index.ts';

export interface Lineup { name: string; cast: readonly CharacterId[] }

export const SAME: readonly Lineup[] = CHARACTER_IDS.map((id) => ({ name: `four ${id}s`, cast: [id, id, id, id] }));

export const MIXED: readonly Lineup[] = [0, 1, 2, 3].map((turn) => ({
  name: `one of each, turned ${turn}`,
  cast: [0, 1, 2, 3].map((player) => CHARACTER_IDS[(player + turn) % CHARACTER_IDS.length]),
}));

/** Every line-up: each of the four in every seat, beside themselves and beside each of the others. */
export const LINEUPS: readonly Lineup[] = [...SAME, ...MIXED];

/** One of each of the four alone: for what a single figure does. */
export const ALONE: readonly Lineup[] = CHARACTER_IDS.map((id) => ({ name: `the ${id}`, cast: [id] }));

/** Give every player of a game their person in the line-up, by player number. */
export function castAs<State extends GameState>(state: State, lineup: Lineup): State {
  state.players.forEach((player, index) => { player.character = lineup.cast[index % lineup.cast.length]; });
  return state;
}
