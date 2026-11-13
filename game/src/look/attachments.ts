/**
 * Canoe attachments. Each id has a builder that returns its mesh in the
 * mount's own space: the origin is the rules engine's mount point
 * (`attachmentTransformForHull`), +y up, and canoe.ts places and turns it.
 *
 * All twenty-two are drawn for this game's hulls, in `canoe/`: see
 * LOOK-canoe.md. `registerAttachment(id, build)` swaps one out.
 */
import type { AttachmentId } from '../data/index.ts';
import { plankChestPart, seaChestPart, tinTrunkPart } from './canoe/chest-parts.ts';
import { forgePart, outriggerPart, planterPart, smokerPart, workbenchPart } from './canoe/deck-parts.ts';
import { canopyPart, cargoRackPart, fireboxPart, fishingRigPart, mapTablePart } from './canoe/hull-parts.ts';
import type { AttachmentBuilder, AttachmentContext, AttachmentPiece } from './canoe/kit.ts';
import { figureheadPart, flagPart, lanternMastPart, mastSailPart, radioPart, rainCatcherPart, rudderPart, winchPart } from './canoe/rig-parts.ts';

export type { AttachmentBuilder, AttachmentContext, AttachmentPiece };

const BUILDERS: Record<AttachmentId, AttachmentBuilder> = {
  cargo_rack: cargoRackPart,
  rain_catcher: rainCatcherPart,
  firebox: fireboxPart,
  fishing_rig: fishingRigPart,
  outrigger_port: outriggerPart(-1),
  outrigger_starboard: outriggerPart(1),
  workbench: workbenchPart,
  smoker: smokerPart,
  planter: planterPart,
  forge: forgePart,
  mast_sail: mastSailPart,
  rudder: rudderPart,
  lantern_mast: lanternMastPart,
  canopy: canopyPart,
  map_table: mapTablePart,
  winch: winchPart,
  radio: radioPart,
  flag: flagPart,
  figurehead: figureheadPart,
  plank_chest: plankChestPart,
  tin_trunk: tinTrunkPart,
  sea_chest: seaChestPart,
};

/** Replace how an attachment is drawn. */
export function registerAttachment(attachmentId: AttachmentId, build: AttachmentBuilder): void {
  BUILDERS[attachmentId] = build;
}

export function buildAttachment(attachmentId: AttachmentId, context: AttachmentContext): AttachmentPiece {
  return BUILDERS[attachmentId](context);
}

/** Attachments that still draw as a placeholder box. None: every one has its own drawing. */
export const PLACEHOLDER_ATTACHMENTS: AttachmentId[] = [];
