/**
 * The game's 3D look. `src/main.ts` calls `createWorldView()` and nothing else from here.
 *
 * Until the Ink & Wash look (B2) lands in this folder, it hands back the greybox.
 */
import type { WorldView } from '../client/contracts.ts';
import { GreyboxWorldView } from '../client/greybox/world-view.ts';

export function createWorldView(): WorldView {
  return new GreyboxWorldView();
}
