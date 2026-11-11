/**
 * The game's menus and HUD. `src/main.ts` calls `createGameInterface()` and nothing else from here.
 *
 * It is the Ink & Wash interface from the approved B2 art study, drawn from the game's real data:
 * - `interface.ts`: the `GameInterface`. Mounts the parts, routes clicks and keys, draws each frame.
 * - `views.ts`: one pure view per screen, card and panel. No DOM, no state, no rules.
 * - `dom.ts`: the small differ that changes only what changed.
 * - `icons.ts`, `paper.ts`, `theme.css`, `fonts.css`: the hand. Everything is drawn in code or served from this site.
 */
import type { GameInterface } from '../client/contracts.ts';
import { InkInterface } from './interface.ts';

export function createGameInterface(): GameInterface {
  return new InkInterface();
}
