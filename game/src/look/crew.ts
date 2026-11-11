import { CREW_MARKS } from '../data/index.ts';
import type { CrewMark } from '../data/index.ts';
import type { GameState, PlayerState } from '../sim/types.ts';

/**
 * The people the look draws. `local` is the player this screen follows: the camera, the prompts and
 * the marks are about them. `others` are the rest of the crew. Every other file in the look reads
 * players through `crewOf`, never through the game state directly, so the shape of the players can
 * change in one place.
 */
export interface Crew {
  local: PlayerState;
  others: readonly PlayerState[];
}

let localPlayerId = 0;

/** Tell the look which player this screen follows. Player 0 until told otherwise. */
export function setLocalPlayerId(playerId: number): void {
  localPlayerId = playerId;
}

export function crewOf(state: GameState): Crew {
  const local = state.players.find((player) => player.id === localPlayerId) ?? state.players[0];
  return { local, others: state.players.filter((player) => player !== local) };
}

/**
 * What a player wears: their own row of the crew marks, by player id. So the one in the blue coat is the
 * same person on every screen, whoever that screen follows.
 */
export function outfitOf(playerId: number): CrewMark {
  return CREW_MARKS[((playerId % CREW_MARKS.length) + CREW_MARKS.length) % CREW_MARKS.length];
}
