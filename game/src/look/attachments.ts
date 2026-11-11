/**
 * Canoe attachments. Each id has a builder that returns its mesh in the
 * mount's own space: the origin is the rules engine's mount point
 * (`attachmentTransformForHull`), +y up, and canoe.ts places and turns it.
 *
 * B2 drew fifteen bolted-on pieces for its one hull. Where one maps onto a
 * game attachment it is reused (carried over by `fromB2`). The rest get an
 * in-style placeholder. Step 2 replaces any of them with
 * `registerAttachment(id, build)`, without touching this file's core.
 */
import * as THREE from 'three';
import { ATTACHMENTS } from '../data/index.ts';
import type { AttachmentId } from '../data/index.ts';
import type { CanoeState } from '../sim/index.ts';
import {
  ANCHORS, canopy, cargoRack, cookstove, createPennant, createSail, fishingRig, lantern, lanternMast, mast, outrigger, planters,
  radio, rainCatcher, rudder, smoker, winch, workbench,
} from './b2/attachments.js';
import type { HullShape } from './b2/canoe.js';
import { KIND } from './b2/detail.js';
import { Builder } from './b2/geo.js';
import type { Triple } from './b2/geo.js';
import { PAL } from './b2/palette.js';

/** What a builder is told about the hull it bolts onto. Lengths in metres, canoe space (y = 0 at the waterline). */
export interface AttachmentContext {
  hullTier: number;
  shape: HullShape;
  /** Half the hull's beam amidships. */
  halfBeam: number;
  /** Height of the gunwale amidships. */
  gunwaleY: number;
  /** The mount's position in canoe space. */
  mount: Triple;
}

export interface AttachmentPiece {
  object: THREE.Object3D;
  /** Called every frame: sails fill, lamps light. `time` is the look's paint time in seconds. */
  update?(canoe: CanoeState, time: number): void;
}

export type AttachmentBuilder = (context: AttachmentContext) => AttachmentPiece;

/**
 * Carry a B2 piece onto a mount: `anchor` (a point in B2's hull space, bow
 * toward +z) lands on the mount's origin, turned to face the game's bow (-z).
 */
export function fromB2(anchor: Triple, options: { scale?: number; yaw?: number; lift?: Triple } = {}): THREE.Matrix4 {
  const scale = options.scale ?? 1;
  const lift = options.lift ?? [0, 0, 0];
  return new THREE.Matrix4()
    .makeTranslation(lift[0], lift[1], lift[2])
    .multiply(new THREE.Matrix4().makeRotationY(Math.PI + (options.yaw ?? 0)))
    .multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
    .multiply(new THREE.Matrix4().makeTranslation(-anchor[0], -anchor[1], -anchor[2]));
}

const only = (object: THREE.Object3D): AttachmentPiece => ({ object });

/** Rough size of each attachment (width, height, depth), for placeholders. */
export const ATTACHMENT_SIZES: Record<AttachmentId, Triple> = {
  cargo_rack: [0.7, 0.25, 0.9], rain_catcher: [0.7, 0.5, 0.6], firebox: [0.5, 0.35, 0.5], fishing_rig: [0.8, 0.5, 0.15],
  outrigger_port: [0.4, 0.35, 3.4], outrigger_starboard: [0.4, 0.35, 3.4], workbench: [0.8, 0.45, 0.8], smoker: [0.6, 0.8, 0.6],
  planter: [0.8, 0.3, 0.8], forge: [0.7, 0.6, 0.7], mast_sail: [0.12, 3.4, 0.12], rudder: [0.08, 0.7, 0.5],
  lantern_mast: [0.08, 1.7, 0.08], canopy: [1, 0.7, 1.4], map_table: [0.6, 0.12, 0.45], winch: [0.3, 0.9, 0.5],
  radio: [0.6, 0.7, 0.6], flag: [0.05, 0.9, 0.4], figurehead: [0.2, 0.4, 0.3],
};

/** An in-style stand-in: a bolted plank box with iron straps, the size of the real thing. */
export function placeholderAttachment(attachmentId: AttachmentId, tone: string = PAL.wood): AttachmentPiece {
  const [width, height, depth] = ATTACHMENT_SIZES[attachmentId];
  const builder = new Builder(2000 + Object.keys(ATTACHMENT_SIZES).indexOf(attachmentId));
  builder.box(width, height, depth, tone, { pos: [0, height / 2, 0], kind: KIND.WOOD });
  builder.box(width + 0.03, 0.04, depth + 0.03, PAL.woodDark, { pos: [0, height + 0.02, 0] });
  for (const strap of [-0.3, 0.3]) builder.box(0.045, height + 0.01, depth + 0.02, PAL.iron, { pos: [width * strap, height / 2, 0], kind: KIND.METAL });
  for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) builder.bolt(sideX * (width / 2 - 0.04), height + 0.045, sideZ * (depth / 2 - 0.04), '#2f3038', 0.014);
  return only(builder.mesh());
}

/** Both outriggers share one layout: the float sits at the mount, the deck at the height the deck attachments mount on. */
function outriggerPiece(side: -1 | 1, context: AttachmentContext): AttachmentPiece {
  const root = new THREE.Matrix4().makeTranslation(-context.mount[0], -context.mount[1], -context.mount[2]);
  return only(outrigger(root, side, {
    floatX: Math.abs(context.mount[0]),
    halfBeam: context.halfBeam,
    gunwaleY: context.gunwaleY,
    deckY: ATTACHMENTS.workbench.transform.position[1],
  }));
}

const BUILDERS: Record<AttachmentId, AttachmentBuilder> = {
  cargo_rack: () => only(cargoRack(fromB2(ANCHORS.cargoRack, { scale: 0.86 }))),
  rain_catcher: () => only(rainCatcher(fromB2(ANCHORS.rainCatcher, { scale: 0.55 }))),
  firebox: () => only(cookstove(fromB2(ANCHORS.cookstove, { scale: 0.7 }))),
  fishing_rig: () => only(fishingRig(fromB2(ANCHORS.fishingRig, { scale: 0.6 }))),
  outrigger_port: (context) => outriggerPiece(-1, context),
  outrigger_starboard: (context) => outriggerPiece(1, context),
  workbench: () => only(workbench(fromB2(ANCHORS.workbench, { scale: 0.8 }))),
  smoker: () => only(smoker(fromB2(ANCHORS.smoker, { scale: 0.7 }))),
  planter: () => only(planters(fromB2(ANCHORS.planter), 1)),
  forge: () => placeholderAttachment('forge', '#8d8886'),
  mast_sail: () => {
    const root = fromB2(ANCHORS.mast, { scale: 0.62 });
    const group = new THREE.Group();
    const sail = createSail(root);
    group.add(mast(root), sail.mesh);
    return {
      object: group,
      update: (canoe, time) => {
        sail.mesh.visible = canoe.sailRaised;
        if (canoe.sailRaised) sail.update(time);
      },
    };
  },
  rudder: () => only(rudder(fromB2(ANCHORS.rudder, { scale: 0.9 }))),
  lantern_mast: () => {
    const root = fromB2(ANCHORS.lanternMast, { scale: 0.8 });
    const lampRoot = root.clone().multiply(new THREE.Matrix4().makeTranslation(-ANCHORS.lantern[0], -ANCHORS.lantern[1], -ANCHORS.lantern[2]));
    const group = new THREE.Group();
    const lit = lantern(lampRoot, true);
    const dark = lantern(lampRoot, false);
    group.add(lanternMast(root), lit, dark);
    return {
      object: group,
      update: (canoe) => {
        lit.visible = canoe.lanternLit;
        dark.visible = !canoe.lanternLit;
      },
    };
  },
  canopy: (context) => {
    const scale = 0.78;
    const group = new THREE.Group();
    group.add(canopy(fromB2(ANCHORS.canopy, { scale })));
    // B2's hoops stood on a deck. Here they stand on the gunwales: six short legs carry them down.
    const legs = new Builder(2100);
    const drop = context.gunwaleY - context.mount[1];
    for (const z of [-0.98, -0.15, 0.68]) {
      for (const side of [-1, 1]) legs.beam([side * 0.67 * scale, 0.03, -(z + 0.15) * scale], [side * context.halfBeam, drop, -(z + 0.15) * scale], 0.02, '#bda263', { kind: KIND.WOOD }, 5);
    }
    group.add(legs.mesh());
    return only(group);
  },
  map_table: () => placeholderAttachment('map_table', PAL.woodLight),
  winch: () => only(winch(fromB2(ANCHORS.winch, { scale: 0.75 }))),
  radio: () => {
    const group = new THREE.Group();
    group.add(radio(fromB2(ANCHORS.radioSet), 'set'), radio(fromB2(ANCHORS.radioMast, { scale: 0.55, lift: [-0.32, 0, 0.2] }), 'mast'));
    return only(group);
  },
  flag: () => {
    const staffHeight = 1.05;
    const group = new THREE.Group();
    const staff = new Builder(2101);
    staff.beam([0, 0, 0], [0, staffHeight, 0], 0.016, PAL.woodDark, {}, 5);
    staff.sphere(0.03, PAL.rust, { pos: [0, staffHeight + 0.02, 0] }, 7);
    const pennant = createPennant(fromB2(ANCHORS.pennant, { scale: 0.6, lift: [0, staffHeight - 0.2, 0] }));
    group.add(staff.mesh(), pennant.mesh);
    return { object: group, update: (_canoe, time) => pennant.update(time) };
  },
  figurehead: () => placeholderAttachment('figurehead', '#b28b5e'),
};

/** Replace how an attachment is drawn. Step 2 calls this with bespoke meshes. */
export function registerAttachment(attachmentId: AttachmentId, build: AttachmentBuilder): void {
  BUILDERS[attachmentId] = build;
}

export function buildAttachment(attachmentId: AttachmentId, context: AttachmentContext): AttachmentPiece {
  return BUILDERS[attachmentId](context);
}

/** Attachments that still draw as a placeholder box. */
export const PLACEHOLDER_ATTACHMENTS: AttachmentId[] = ['forge', 'map_table', 'figurehead'];
