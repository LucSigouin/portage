/**
 * What every bolted-on piece is drawn with. A piece is authored in canoe
 * space (bow toward -z, y = 0 at the waterline, metres), from its mount and
 * the hull it stands on. `partBuilder` then carries it into the mount's own
 * space, which is where canoe.ts hangs it.
 */
import * as THREE from 'three';
import { seatTransformForHull } from '../../sim/index.ts';
import type { CanoeState } from '../../sim/index.ts';
import type { HullShape } from '../b2/canoe.js';
import { KIND, tagColor } from '../b2/detail.js';
import { Builder, THIN } from '../b2/geo.js';
import type { Triple } from '../b2/geo.js';
import { PAL } from '../b2/palette.js';

/** What a builder is told about the hull it bolts onto. Lengths in metres, canoe space. */
export interface AttachmentContext {
  hullTier: number;
  shape: HullShape;
  /** Half the hull's beam amidships. */
  halfBeam: number;
  /** Height of the gunwale amidships. */
  gunwaleY: number;
  /** The mount's position in canoe space. */
  mount: Triple;
  /** The mount's turn (Euler XYZ). Left out, none. */
  rotation?: Triple;
}

export interface AttachmentPiece {
  object: THREE.Object3D;
  /** Called every frame: sails fill, lamps light. `time` is the look's paint time in seconds. */
  update?(canoe: CanoeState, time: number): void;
}

export type AttachmentBuilder = (context: AttachmentContext) => AttachmentPiece;

// Colours the palette has no name for. The art study's own.
export const ROPE = '#dccfa6';
export const RIG = '#62584a';
export const BAMBOO = '#bda263';
export const BOLT = '#2f3038';
export const IRON = PAL.iron;
export const CLAY = '#c7a182';
export const CLAY_DARK = '#a98468';
export const LEATHER = '#8a5f41';
export const COPPER = '#b9744f';
export const BRASS = '#c9a14a';
export const PAPER = '#f1e8d0';
export const CANVAS_LIGHT = '#eee4c9';
export const CANVAS_DARK = '#e3d6b6';
export const SOOT = '#3a3c45';
export const STEEL = '#8d9496';
export const WATER = '#86a5b3';
export const GLASS = '#c3d6d4';
export const EMBER = '#f2a65a';
export const FISH = '#c18259';
export const BERRY = '#c64732';
export const LOON = '#343842';
tagColor(ROPE, KIND.ROPE);
tagColor(BAMBOO, KIND.WOOD);
for (const colour of [RIG, CLAY, CLAY_DARK, LEATHER, GLASS, WATER, EMBER, FISH, BERRY, PAPER]) tagColor(colour, KIND.PLAIN);
for (const colour of [CANVAS_LIGHT, CANVAS_DARK]) tagColor(colour, KIND.CLOTH);
for (const colour of [COPPER, BRASS, STEEL, SOOT]) tagColor(colour, KIND.METAL);

/** The turn and shift that carry canoe space into the mount's own space. */
export function mountSpace(context: AttachmentContext): THREE.Matrix4 {
  const [x, y, z] = context.mount;
  const [rx, ry, rz] = context.rotation ?? [0, 0, 0];
  return new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)).setPosition(x, y, z).invert();
}

/** A builder whose pieces are authored in canoe space and land in the mount's space. */
export function partBuilder(context: AttachmentContext, seed: number): Builder {
  const builder = new Builder(seed);
  builder.root = mountSpace(context);
  return builder;
}

/** What a piece needs to know of the hull it stands on, in canoe space. */
export interface Hull {
  /** Half the beam at this z. */
  halfBeam(z: number): number;
  /** Height of the gunwale at this z. */
  gunwale(z: number): number;
  /** The floor you see inside. */
  floor: number;
  /** The hull's two ends. */
  bow: number;
  stern: number;
  /** Where seat n is, along the hull. */
  seat(seat: number): number;
}

export function hullOf(context: AttachmentContext): Hull {
  const { shape } = context;
  return {
    halfBeam: (z) => shape.halfBeamAt(-z),
    gunwale: (z) => shape.sheerAt(-z) - shape.HULL.draft,
    floor: shape.HULL.floor - shape.HULL.draft,
    bow: -shape.HL * 0.992,
    stern: shape.HL * 0.992,
    seat: (seat) => seatTransformForHull(context.hullTier, seat).position[2],
  };
}

/** Standing rigging and wire: a bare pen line. */
export function rig(builder: Builder, from: Triple, to: Triple, radius = 0.009): void {
  builder.beam(from, to, radius, RIG, { id: THIN, flat: true, kind: KIND.PLAIN }, 4);
}

/** A soft line through points. */
export function line(builder: Builder, points: Triple[], radius = 0.011, colour: string = ROPE): void {
  builder.tube(points, radius, colour, { id: THIN, steps: points.length * 4, kind: KIND.ROPE }, 4);
}

/** An iron foot plate with four bolt heads, lying flat. */
export function plate(builder: Builder, x: number, y: number, z: number, width: number, depth: number): void {
  builder.box(width, 0.022, depth, IRON, { pos: [x, y + 0.011, z], kind: KIND.METAL });
  for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) builder.bolt(x + sideX * (width / 2 - 0.03), y + 0.03, z + sideZ * (depth / 2 - 0.03), BOLT, 0.014);
}

/** Three turns of cord round a spar that runs along x (`axis` 'x') or z. */
export function lashing(builder: Builder, x: number, y: number, z: number, radius: number, axis: 'x' | 'z' = 'x'): void {
  for (const offset of [-0.035, 0, 0.035]) {
    builder.torus(radius, 0.013, ROPE, {
      pos: axis === 'x' ? [x + offset, y, z] : [x, y, z + offset], rot: axis === 'x' ? [0, Math.PI / 2, 0] : [0, 0, 0], id: 0.71, kind: KIND.ROPE,
    }, 8);
  }
}

export const only = (object: THREE.Object3D): AttachmentPiece => ({ object });
export { Builder, KIND, PAL, THIN };
export type { Triple };
