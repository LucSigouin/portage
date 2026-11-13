/**
 * What the patched hull wears that the leaky one does not. Two things, both hung by `CanoeView` on tier 1 only:
 *
 * - `buildMends`: birch bark folded over the rails and laid over the bow deck, every piece run round with black
 *   pitch and whipped down with cord. Small, and where the paddling camera looks.
 * - `buildSheets`: sheets of bark along both sides of the hull and over the planking inside, each run round with
 *   a fat line of pitch, and two old seams payed with pitch from end to end. Big: this is what reads from 9 m.
 *
 * The hull's own drawing (b2/canoe.js) patches the planking low on the sides, mostly under the waterline.
 * Authored in the hull's own space: bow toward +z, keel at y = 0.
 */
import * as THREE from 'three';
import type { HullShape } from '../b2/canoe.js';
import { nextId } from '../b2/geo.js';
import { Builder, KIND, THIN } from './kit.ts';
import type { Triple } from './kit.ts';

// The patched hull's own bark, pitch and cord (b2/canoe.js).
const BARK = '#ece5d2';
const PITCH = '#2e2b2d';
const CORD = '#d9c79b';

/**
 * Where a lap of bark is folded over a rail: the side (+1 is +x), where along the hull, how long. None lies where
 * the lone paddler's blade crosses the rail, nor on the splinted stretch of the -x rail.
 */
export const BARK_LAPS: readonly (readonly [side: -1 | 1, z: number, length: number])[] = [
  [1, -0.42, 0.36], [1, 0.82, 0.4], [-1, -0.3, 0.4], [-1, 1.22, 0.36],
];

export function buildMends(shape: HullShape): THREE.Mesh {
  const b = new Builder(29);
  for (const [side, z, length] of BARK_LAPS) {
    const rail = (at: number): Triple => [side * shape.halfBeamAt(at), shape.sheerAt(at), at];
    const [x, y] = rail(z);
    // the lap turns and rises with the rail it lies on
    const yaw = Math.atan2(rail(z + 0.1)[0] - rail(z - 0.1)[0], 0.2);
    const rise = -Math.atan2(rail(z + 0.1)[1] - rail(z - 0.1)[1], 0.2);
    const rot: Triple = [rise, yaw, 0];
    const id = b.box(0.1, 0.01, length, BARK, { pos: [x - side * 0.004, y + 0.037, z], rot, kind: KIND.BIRCH });
    b.box(0.01, 0.12, length - 0.03, BARK, { pos: [x + side * 0.041, y - 0.024, z], rot, id, kind: KIND.BIRCH });
    b.box(0.01, 0.065, length - 0.03, BARK, { pos: [x - side * 0.049, y + 0.004, z], rot, id, kind: KIND.BIRCH });
    for (const end of [-1, 1]) {
      const edge = rail(z + end * (length / 2));
      b.box(0.106, 0.008, 0.02, PITCH, { pos: [edge[0] - side * 0.004, edge[1] + 0.041, edge[2]], rot, id: THIN, flat: true, kind: KIND.PLAIN });
      const tie = rail(z + end * (length / 2 - 0.085));
      b.torus(0.049, 0.008, CORD, { pos: [tie[0], tie[1] + 0.006, tie[2]], rot: [0, yaw, 0], id: 0.71, kind: KIND.ROPE }, 8);
    }
  }
  // a sheet of bark over the +x half of the bow deck, pitched down along its three edges
  const sheet: THREE.Vector3[][] = [];
  const lift = 0.009;
  for (const share of [0.8, 0.86, 0.92]) {
    const z = share * shape.HL;
    const [half, y] = [shape.halfBeamAt(z), shape.sheerAt(z) + 0.012];
    sheet.push([new THREE.Vector3(0.02, y + 0.02 + lift, z), new THREE.Vector3(half - 0.035, y + lift + 0.004, z)]);
  }
  const sheetId = nextId();
  b.grid(sheet, () => BARK, () => sheetId, { kind: () => KIND.BIRCH });
  const run = (from: THREE.Vector3, to: THREE.Vector3): void => {
    b.beam([from.x, from.y + 0.004, from.z], [to.x, to.y + 0.004, to.z], 0.011, PITCH, { id: THIN, flat: true, kind: KIND.PLAIN }, 5);
  };
  run(sheet[0][0], sheet[2][0]);
  run(sheet[0][0], sheet[0][1]);
  run(sheet[2][0], sheet[2][1]);
  return b.mesh();
}

// --- The sheets: what tells the patched hull from the leaky one at a glance -------------------------------------
//
// From 9 m the laps on the rails are a few pixels. So the mend is also drawn big: sheets of pale birch bark laid
// along both sides of the hull and over the planking inside, every sheet run round with a fat line of black pitch,
// and two of the old seams payed with pitch from end to end. The bow keeps its old paint and her name.

/** The hull's own strake edges from sheer to keel, and its stations (b2/canoe.js lofts the planking on these): a sheet laid on them lies flat on the planks. */
const STRAKES = [1, 0.93, 0.82, 0.68, 0.52, 0.36, 0.18, 0] as const;
const STATIONS = 36;
/** The planking's own thickness inside (b2/canoe.js). */
const PLANKING = 0.024;
/** A sheet stands this far off the planks it lies on, and its pitch this far off the sheet. */
const SHEET_LIFT = 0.006;
const PITCH_LIFT = 0.004;
/** Bark from a second tree: a little greyer, so two sheets side by side are two sheets. */
const BARK_GREY = '#e2dac6';

/** One sheet of bark: the side (+1 is +x), the stations it runs between (0 the stern, 36 the bow), the strake edges it runs between (1 under the sheer strake, 7 the keel). */
export interface BarkSheet { side: -1 | 1; from: number; to: number; top: number; bottom: number }

/**
 * The sheets on the outside, from under the sheer strake to below the waterline: one on each quarter, where the
 * paddling camera looks, a pair amidships and one forward, with the old paint showing between them. The joins are
 * not opposite each other. They stop short of her name on both bows.
 */
export const SIDE_SHEETS: readonly BarkSheet[] = [
  { side: -1, from: 3, to: 7, top: 1, bottom: 5 }, { side: -1, from: 9, to: 15, top: 1, bottom: 5 }, { side: -1, from: 15, to: 20, top: 1, bottom: 5 }, { side: -1, from: 22, to: 26, top: 1, bottom: 5 },
  { side: 1, from: 3, to: 8, top: 1, bottom: 5 }, { side: 1, from: 10, to: 16, top: 1, bottom: 5 }, { side: 1, from: 16, to: 21, top: 1, bottom: 5 }, { side: 1, from: 23, to: 26, top: 1, bottom: 5 },
];

/** The sheets inside: up the walls and over the floor to the keel, from behind the stern seat to the foot of the bow deck. */
export const INSIDE_SHEETS: readonly BarkSheet[] = [
  { side: -1, from: 5, to: 11, top: 1, bottom: 7 }, { side: -1, from: 11, to: 17, top: 1, bottom: 7 }, { side: -1, from: 17, to: 22, top: 1, bottom: 7 },
  { side: -1, from: 22, to: 27, top: 1, bottom: 7 }, { side: -1, from: 27, to: 31, top: 1, bottom: 7 },
  { side: 1, from: 5, to: 9, top: 1, bottom: 7 }, { side: 1, from: 9, to: 15, top: 1, bottom: 7 }, { side: 1, from: 15, to: 20, top: 1, bottom: 7 },
  { side: 1, from: 20, to: 25, top: 1, bottom: 7 }, { side: 1, from: 25, to: 31, top: 1, bottom: 7 },
];

/** The old seams payed with pitch on both sides: the strake edge each follows, and the stations it runs between. */
export const PITCHED_SEAMS: readonly (readonly [edge: number, from: number, to: number])[] = [[1, 2, 34], [3, 2, 34]];

/** `part`: only what lies outside the planking, or only what lies inside it. Left out, both: what the canoe wears. */
export function buildSheets(shape: HullShape, part: 'both' | 'outside' | 'inside' = 'both'): THREE.Mesh {
  const b = new Builder(31);
  const floor = shape.HULL.floor;
  /** A point on the hull's skin at a station and a strake edge. `inset` is metres in from the outside: under 0 stands off the hull, over the planking's own lies inside it. */
  const skin = (station: number, edge: number, side: number, inset: number): THREE.Vector3 => {
    const point = shape.hullPoint(-0.992 + (1.984 * station) / STATIONS, side * STRAKES[edge], inset, new THREE.Vector3());
    // Inside, the planking you see stops at the floor (b2/canoe.js): so does what lies on it.
    if (inset > 0.01 && point.y < floor) point.y = floor + (inset - PLANKING);
    return point;
  };
  const pitch = (points: THREE.Vector3[], radius: number): void => {
    b.tube(points.map((point) => point.toArray() as Triple), radius, PITCH, { id: THIN, flat: true, kind: KIND.PLAIN, steps: points.length * 3 }, 5);
  };
  const lay = (sheet: BarkSheet, index: number, inset: number, pitchInset: number, radius: number, axis: 0 | 1 | 2): void => {
    const { side, from, to, top, bottom } = sheet;
    const stations = Array.from({ length: to - from + 1 }, (_, step) => from + step);
    const edges = Array.from({ length: bottom - top + 1 }, (_, step) => top + step);
    const id = nextId();
    const colour = index % 2 ? BARK_GREY : BARK;
    b.grid(stations.map((station) => edges.map((edge) => skin(station, edge, side, inset))), () => colour, () => id, { kind: () => KIND.BIRCH, axis });
    // pitch run round the sheet: along its top and bottom, and fatter up both ends, where two sheets lap
    for (const edge of [top, bottom]) pitch(stations.map((station) => skin(station, edge, side, pitchInset)), radius * 0.75);
    for (const station of [from, to]) pitch(edges.map((edge) => skin(station, edge, side, pitchInset)), radius);
  };
  // Outside the bark's marks run along the hull; inside they run across it, like the planks they cover.
  if (part !== 'inside') SIDE_SHEETS.forEach((sheet, index) => lay(sheet, index, -SHEET_LIFT, -SHEET_LIFT - PITCH_LIFT, 0.024, 1));
  if (part !== 'outside') INSIDE_SHEETS.forEach((sheet, index) => lay(sheet, index, PLANKING + SHEET_LIFT, PLANKING + SHEET_LIFT + PITCH_LIFT, 0.02, 2));
  for (const side of part === 'inside' ? [] : [-1, 1]) {
    for (const [edge, from, to] of PITCHED_SEAMS) {
      const run: THREE.Vector3[] = [];
      for (let station = from; station <= to; station += 1) run.push(skin(station, edge, side, -PITCH_LIFT));
      pitch(run, 0.014);
    }
  }
  return b.mesh();
}
