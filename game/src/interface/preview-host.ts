/**
 * An empty shell. The still sketch of the canoe beside the lobby's menu is gone (Luc, Round 4: "drop the still"):
 * the canoe of the save played last now drifts in the scene behind the menu (`client/backdrop.ts`).
 *
 * `main.ts` still wraps the interface with this, and `main.ts` was not that job's to change. It hands the interface
 * back as it came and does nothing else. Delete this file and `look/canoe-sketch.ts` together with the two
 * imports, the wrap and the `preview` handle in `main.ts`.
 */
import type { GameInterface } from '../client/contracts.ts';

export function withCanoePreview<Inner extends GameInterface>(
  inner: Inner,
  _unused: { slotSummaries(): unknown; latestSlot(): unknown; load(slot: number): unknown; draw: unknown },
): Inner & { preview: null } {
  return Object.assign(inner, { preview: null });
}
