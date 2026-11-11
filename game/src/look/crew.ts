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
