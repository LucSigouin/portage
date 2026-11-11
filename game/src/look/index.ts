/**
 * The game's 3D look. `src/main.ts` calls `createWorldView()` and nothing else from here.
 *
 * It is the Ink & Wash look Luc picked (B2), moved from `art-r1/b2` into this
 * folder. `?look=greybox` brings the plain placeholder back, to compare
 * against. Step 2 adds meshes through the registries exported below. See LOOK.md.
 */
import type { WorldView } from '../client/contracts.ts';
import { GreyboxWorldView } from '../client/greybox/world-view.ts';
import { InkWashWorldView } from './world-view.ts';

export { registerAttachment } from './attachments.ts';
export { registerCharacter } from './characters.ts';
export { registerLandmark } from './landmarks.ts';
export { registerNode } from './nodes.ts';

export function createWorldView(): WorldView {
  const greybox = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('look') === 'greybox';
  return greybox ? new GreyboxWorldView() : new InkWashWorldView();
}
