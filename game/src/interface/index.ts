/**
 * The game's menus and HUD. `src/main.ts` calls `createGameInterface()` and nothing else from here.
 *
 * Until the Ink & Wash interface (B2) lands in this folder, it hands back the greybox.
 */
import type { GameInterface } from '../client/contracts.ts';
import { GreyboxInterface } from '../client/greybox/interface.ts';

export function createGameInterface(): GameInterface {
  return new GreyboxInterface();
}
