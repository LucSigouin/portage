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

export function crewOf(state: GameState): Crew {
  return { local: state.player, others: [] };
}
