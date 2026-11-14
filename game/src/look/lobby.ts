/**
 * The lobby's canoe holds still (Luc, Round 4: the canoe behind the menu is his own, "as calm as today").
 *
 * Two pieces of a canoe move with the look's paint time: a raised sail breathes and a flag waves
 * (`canoe/rig-parts.ts`). The scene's own canoe had neither. A saved canoe may have both, and behind the menu
 * nothing new may move: so in the lobby the canoe's pieces are drawn at one fixed moment.
 */
import type { StageName } from '../client/contracts.ts';

/** The paint time the canoe's own pieces are drawn at: the look's, but in the lobby always the same moment. */
export function canoePieceTime(stage: StageName, paintTime: number): number {
  return stage === 'lobby' ? 0 : paintTime;
}
