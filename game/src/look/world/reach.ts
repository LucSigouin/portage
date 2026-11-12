/**
 * The Reach's landmarks: the church (steeple and broken nave), the grain
 * silos, the hydro pylons, the scrapyard's stack and crane, Tink's forge,
 * and the marsh's reed beds.
 */
import * as THREE from 'three';
import type { LandmarkKind } from '../../data/index.ts';
import { KIND } from '../b2/detail.js';
import { pylon, steeple } from '../b2/flora.js';
import type { Builder, Triple } from '../b2/geo.js';
import { PAL } from '../b2/palette.js';
import { seededRandom } from '../scatter.ts';
import { EMBER, PEN, TONE, gable, gableEnd, ladder, moved, pane } from './kit.ts';
import type { LandmarkBuilder } from './kit.ts';

/** A lattice boom between two points: four chords, a ring and a diagonal every bay. Bare pen lines. */
export function boom(builder: Builder, from: Triple, to: Triple, halfFrom: number, halfTo: number, bays: number, tone: string, radius = 0.06): void {
  const start = new THREE.Vector3(...from);
  const axis = new THREE.Vector3(...to).sub(start);
  const side = new THREE.Vector3(1, 0, 0);
  if (Math.abs(axis.clone().normalize().x) > 0.9) side.set(0, 0, 1);
  const up = new THREE.Vector3().crossVectors(axis, side).normalize();
  side.crossVectors(up, axis).normalize();
  const corner = (bay: number, a: number, b: number): Triple => {
    const share = bay / bays;
    const half = halfFrom + (halfTo - halfFrom) * share;
    const point = start.clone().addScaledVector(axis, share).addScaledVector(side, a * half).addScaledVector(up, b * half);
    return [point.x, point.y, point.z];
  };
  for (let bay = 0; bay <= bays; bay += 1) {
    builder.beam(corner(bay, -1, -1), corner(bay, 1, -1), radius * 0.6, tone, PEN, 4);
    builder.beam(corner(bay, -1, 1), corner(bay, 1, 1), radius * 0.6, tone, PEN, 4);
    builder.beam(corner(bay, -1, -1), corner(bay, -1, 1), radius * 0.6, tone, PEN, 4);
    builder.beam(corner(bay, 1, -1), corner(bay, 1, 1), radius * 0.6, tone, PEN, 4);
    if (bay === bays) break;
    const turn = bay % 2 ? 1 : -1;
    for (const a of [-1, 1]) for (const b of [-1, 1]) builder.beam(corner(bay, a, b), corner(bay + 1, a, b), radius, tone, PEN, 4);
    for (const face of [-1, 1]) {
      builder.beam(corner(bay, -turn, face), corner(bay + 1, turn, face), radius * 0.5, tone, PEN, 4);
      builder.beam(corner(bay, face, -turn), corner(bay + 1, face, turn), radius * 0.5, tone, PEN, 4);
    }
  }
}

/** How long a wrecked car is, how high it stands from sill to roof, and how far apart two are stacked, metres. */
export const CAR = { length: 4.1, height: 0.89, stacked: 0.93 } as const;

/**
 * A wrecked car for the stack, squashed but still a car from the shore: a body, a band of dark glass between
 * pillars under a dented roof, two wheels a side with their hubs, bumpers, lamps, and a door the pen draws round.
 * Its origin is the middle of the body. `door` is the door's colour, when it came off another car.
 */
function wreckedCar(builder: Builder, x: number, y: number, z: number, turn: number, tilt: number, tone: string, detail: boolean, door = tone): void {
  moved(builder, new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(tilt, turn, tilt * 0.6)).setPosition(x, y, z), () => {
    builder.box(CAR.length, 0.5, 1.75, tone, { pos: [0, 0, 0], kind: KIND.METAL });
    // The cab: glass all round, the roof pressed down on it a little askew.
    builder.box(1.9, 0.3, 1.56, TONE.glassDark, { pos: [-0.3, 0.4, 0], flat: true, kind: KIND.PLAIN });
    builder.box(2, 0.09, 1.66, tone, { pos: [-0.3, 0.595, 0], rot: [0, 0, 0.03], kind: KIND.METAL });
    for (const end of [-1.35, 1.3]) {
      builder.cyl(0.32, 0.32, 1.8, TONE.tyre, { pos: [end, -0.1, 0], rot: [Math.PI / 2, 0, 0], kind: KIND.PLAIN }, detail ? 10 : 6);
      if (detail) builder.cyl(0.14, 0.14, 1.84, PAL.tin, { pos: [end, -0.1, 0], rot: [Math.PI / 2, 0, 0], flat: true, kind: KIND.PLAIN }, 8);
    }
    if (!detail) return;
    for (const pillar of [-1.22, -0.35, 0.62]) builder.box(0.1, 0.32, 1.62, tone, { pos: [pillar, 0.4, 0], rot: [0, 0, pillar > 0 ? -0.35 : pillar < -1 ? 0.25 : 0], kind: KIND.METAL });
    builder.box(0.95, 0.38, 1.77, door, { pos: [-0.82, 0.02, 0], kind: KIND.METAL });
    for (const end of [-1, 1]) {
      builder.box(0.08, 0.14, 1.8, PAL.tin, { pos: [end * 2.07, -0.1, 0], kind: KIND.METAL });
      for (const side of [-1, 1]) builder.box(0.05, 0.13, 0.26, end > 0 ? PAL.cream : TONE.towerRed, { pos: [end * 2.06, 0.1, side * 0.58], flat: true, kind: KIND.PLAIN });
    }
  });
}

export const REACH: Partial<Record<LandmarkKind, LandmarkBuilder>> = {
  /**
   * The church: B2's steeple on the crown of the hill, and behind it the nave,
   * its roof stove in where the rules put the way into the attic.
   */
  steeple: (builder, detail) => {
    steeple(builder, true);
    const roof = '#7d8b92';
    const wall = { kind: KIND.SIDING, seed: 0.9 } as const;
    for (const side of [-1, 1]) builder.box(0.25, 4.2, 12.8, TONE.whitewash, { pos: [side * 2.95, 0.9, -8.6], ...wall, axis: 2 });
    builder.box(6.15, 4.2, 0.25, TONE.whitewash, { pos: [0, 0.9, -14.9], ...wall });
    gableEnd(builder, 6.15, 3, 2.6, -14.9, TONE.whitewash, { kind: KIND.SIDING, courses: detail ? 5 : 2 });
    gable(builder, 6.15, 1.3, 3, 2.6, roof, { centre: [0, -2.85], overhang: 0.25, ridge: '#66757c' });
    gable(builder, 6.15, 7.4, 3, 2.6, roof, { centre: [0, -11.3], overhang: 0.25, ridge: '#66757c' });
    builder.box(1.5, 2.5, 0.12, TONE.door, { pos: [0, 1.2, 2.24], kind: KIND.WOOD });
    if (!detail) return;
    // Where the roof came down: bare rafters, a ridge pole, shakes hanging off the edge.
    for (const z of [-4.3, -5.5, -6.7]) {
      for (const side of [-1, 1]) builder.beam([side * 3.05, 3, z], [0, 5.6, z], 0.07, PAL.woodDark, { kind: KIND.WOOD }, 5);
    }
    builder.beam([0, 5.58, -3.5], [0, 5.5, -7.6], 0.08, PAL.woodDark, { kind: KIND.WOOD }, 5);
    builder.box(1.6, 0.08, 0.9, roof, { pos: [-2.3, 3.5, -7], rot: [0.3, 0.2, 0.9], kind: KIND.SHINGLE });
    builder.box(1.2, 0.08, 0.8, '#6f7d84', { pos: [2.5, 2.2, -4.1], rot: [-0.4, 0.5, -1.2], kind: KIND.SHINGLE });
    for (const side of [-1, 1]) {
      for (const z of [-5.2, -9, -12.6]) {
        pane(builder, [side * 3.09, 1.75, z], 0.85, 1.8, (side * Math.PI) / 2);
        builder.cyl(0.425, 0.425, 0.09, TONE.glass, { pos: [side * 3.09, 2.65, z], rot: [0, 0, Math.PI / 2], flat: true, kind: KIND.PLAIN }, 10);
      }
      builder.box(0.3, 4.2, 0.3, TONE.trim, { pos: [side * 2.95, 0.9, -14.9], kind: KIND.PAINT });
    }
    builder.box(0.07, 2.5, 0.14, '#5a4838', { pos: [0, 1.2, 2.26], flat: true });
    builder.box(1.8, 0.14, 0.2, TONE.trim, { pos: [0, 2.52, 2.26], kind: KIND.PAINT });
    for (const step of [0, 1]) builder.box(2.4 + step * 0.6, 0.2, 0.5, '#a59f9b', { pos: [0, -0.05 - step * 0.2, 2.6 + step * 0.5], kind: KIND.STONE });
    // The churchyard: a few stones, leaning.
    const random = seededRandom(77);
    for (const [x, z] of [[4.6, 1.5], [5.6, -0.4], [6.3, 2.2], [-4.8, 0.8], [-5.7, 2.6], [4.9, 3.6]]) {
      builder.box(0.5, 0.95, 0.13, random() > 0.5 ? '#b3aaa0' : '#a59f9b', { pos: [x, 0.2, z], rot: [(random() - 0.5) * 0.3, 0.2, (random() - 0.5) * 0.25], kind: KIND.STONE });
    }
  },

  /** A grain bin: ribbed tin, a cone roof with its fill cap, a caged ladder, a chute, rust under every seam. */
  silo: (builder, detail) => {
    builder.cyl(3.15, 3.25, 0.7, TONE.concrete, { pos: [0, 0.1, 0], kind: KIND.STONE }, 16);
    builder.cyl(3, 3, 10.8, PAL.tin, { pos: [0, 5.8, 0], kind: KIND.METAL }, 16);
    builder.cone(3.2, 2.1, '#9aa3a4', { pos: [0, 12.25, 0], kind: KIND.METAL }, 16);
    builder.cyl(0.45, 0.5, 0.5, TONE.steelPale, { pos: [0, 13.4, 0], kind: KIND.METAL }, 8);
    if (!detail) return;
    for (let ring = 0; ring < 9; ring += 1) builder.cyl(3.03, 3.03, 0.1, TONE.steelPale, { pos: [0, 1.5 + ring * 1.2, 0], kind: KIND.METAL }, 16);
    ladder(builder, [0, 0.4, -3.1], [0, 11.3, -3.1], [1, 0, 0], 0.55, PAL.iron, 0.42, 0.028);
    for (let hoop = 0; hoop < 6; hoop += 1) builder.torus(0.42, 0.018, PAL.iron, { pos: [0, 3.2 + hoop * 1.5, -3.42], rot: [Math.PI / 2, 0, 0], id: PEN.id, flat: true, kind: KIND.PLAIN }, 8);
    ladder(builder, [0, 11.3, -3.1], [0, 13.2, -0.5], [1, 0, 0], 0.5, PAL.iron, 0.42, 0.022);
    builder.box(1, 1.5, 0.08, TONE.steelPale, { pos: [1.9, 1.4, -2.36], rot: [0, -0.68, 0], kind: KIND.METAL });
    builder.box(1.5, 0.6, 0.06, PAL.cream, { pos: [-1.75, 7.2, -2.47], rot: [0, 0.62, 0], kind: KIND.PAINT });
    builder.stencil('CO-OP', [-0.95, 7.02, -2.94], [-0.81, 0, 0.58], [0, 1, 0], 0.36, PAL.rustDark);
    // The unloading chute, and rust streaks.
    builder.beam([2.3, 10.4, 1.6], [4.6, 2.2, 3.2], 0.22, TONE.steelPale, { kind: KIND.METAL }, 7);
    builder.beam([4.6, 2.2, 3.2], [4.6, 0, 3.2], 0.05, PAL.iron, PEN, 4);
    for (const [angle, top, long] of [[0.4, 9.6, 2.6], [2.2, 8.4, 3.4], [3.6, 10.6, 1.8], [5.1, 6, 2.2]]) {
      builder.box(0.26, long, 0.03, '#b99a86', { pos: [Math.sin(angle) * 3.02, top - long / 2, -Math.cos(angle) * 3.02], rot: [0, Math.PI - angle, 0], flat: true, kind: KIND.PLAIN });
    }
  },

  /** A hydro pylon: B2's own, turned so its arms cross the line, on four drowned footings, leaning but holding. */
  pylon: (builder, detail) => {
    moved(builder, new THREE.Matrix4().makeRotationZ(0.04).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)), () => {
      pylon(builder);
      for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) builder.box(1.1, 1.1, 1.1, TONE.concrete, { pos: [sideX * 2.92, 0.1, sideZ * 2.92], kind: KIND.STONE });
      if (!detail) return;
      builder.box(0.7, 0.5, 0.04, PAL.ochre, { pos: [2.6, 2.6, 0], rot: [0, Math.PI / 2, 0.09], kind: KIND.PAINT });
      builder.stencil('KEEP OFF', [2.63, 2.5, 0.32], [0, 0, -1], [0, 1, 0], 0.1, PAL.ink);
      ladder(builder, [-2.65, 0.6, -2.65], [-1.55, 12.5, -1.55], [0.707, 0, -0.707], 0.4, '#59656d', 0.5, 0.02);
    });
  },

  /**
   * The yard's stack: wrecked cars three high and two high, nose to tail, a pickup thrown on the short pile,
   * tyres, a loose hood. The rules' junk heap stands in the gap between the piles.
   */
  scrap_stack: (builder, detail) => {
    const rest = 0.36;
    const tall = [[PAL.rust, PAL.rust], ['#6b7a84', '#b9b3a2'], ['#b08a4a', '#b08a4a']];
    const short = [['#b9b3a2', '#b9b3a2'], [PAL.slate, PAL.rustLight]];
    tall.forEach(([tone, door], level) => wreckedCar(builder, -0.4 + (level % 2) * 0.3, rest + level * CAR.stacked, -1.5, (level % 2) * Math.PI + 0.04 * (level - 1), 0.02 * (level % 3 - 1), tone, detail, door));
    short.forEach(([tone, door], level) => wreckedCar(builder, 0.5 - (level % 2) * 0.35, rest + level * CAR.stacked, 1.2, (1 - level % 2) * Math.PI + 0.05 * (1 - level), 0.02 * (level % 2), tone, detail, door));
    // The pickup: a cab and a bed, nose down off the short pile.
    moved(builder, new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.1, 0.25, -0.3)).setPosition(1, rest + 2 * CAR.stacked + 0.42, 1.25), () => {
      builder.box(4.4, 0.7, 1.8, '#7a8f7c', { pos: [0, 0, 0], kind: KIND.METAL });
      builder.box(1.5, 0.75, 1.7, '#7a8f7c', { pos: [0.4, 0.7, 0], kind: KIND.METAL });
      for (const end of [-1.35, 1.5]) builder.cyl(0.4, 0.4, 1.86, TONE.tyre, { pos: [end, -0.3, 0], rot: [Math.PI / 2, 0, 0], kind: KIND.PLAIN }, detail ? 10 : 6);
      if (!detail) return;
      builder.box(1.52, 0.4, 1.5, TONE.glassDark, { pos: [0.4, 0.8, 0], flat: true, kind: KIND.PLAIN });
      builder.box(1.1, 0.42, 1.74, TONE.glassDark, { pos: [0.4, 0.78, 0], flat: true, kind: KIND.PLAIN });
      builder.box(1.9, 0.3, 1.5, '#55655a', { pos: [-1.15, 0.36, 0], flat: true, kind: KIND.PLAIN });
      for (const end of [-1.35, 1.5]) builder.cyl(0.17, 0.17, 1.9, PAL.tin, { pos: [end, -0.3, 0], rot: [Math.PI / 2, 0, 0], flat: true, kind: KIND.PLAIN }, 8);
      builder.box(0.08, 0.16, 1.84, PAL.tin, { pos: [2.22, -0.18, 0], kind: KIND.METAL });
      for (const side of [-1, 1]) builder.box(0.05, 0.16, 0.3, PAL.cream, { pos: [2.21, 0.12, side * 0.6], flat: true, kind: KIND.PLAIN });
    });
    for (let tyre = 0; tyre < (detail ? 5 : 3); tyre += 1) {
      builder.torus(0.42, 0.17, TONE.tyre, { pos: [3.4 + (tyre % 2) * 0.12, 0.17 + tyre * 0.33, -1.9 + (tyre % 3) * 0.08], rot: [Math.PI / 2, 0, 0], kind: KIND.PLAIN }, 10);
    }
    if (!detail) return;
    builder.torus(0.42, 0.17, TONE.tyre, { pos: [3.9, 0.42, -0.6], rot: [0.2, 0.5, 0], kind: KIND.PLAIN }, 10);
    builder.box(1.5, 0.05, 1.3, PAL.ochre, { pos: [-3.3, 0.5, 0.6], rot: [0.5, 0.4, 1.1], kind: KIND.METAL });
    builder.box(1.1, 0.9, 0.06, PAL.slate, { pos: [3.2, 0.5, 1.9], rot: [-0.25, 0.9, 0], kind: KIND.METAL });
    builder.beam([-1.6, 3.1, -1.4], [-2.4, 4.3, -1.9], 0.04, PAL.iron, { kind: KIND.METAL }, 5);
    builder.beam([-3.1, 0, -2.2], [-2.7, 1.9, -1.9], 0.06, PAL.rust, { kind: KIND.METAL }, 5);
  },

  /** The yard crane: a yellow cab on a concrete footing, a lattice boom, and the magnet still holding a door. */
  crane_arm: (builder, detail) => {
    const yellow = TONE.craneYellow;
    const tip: Triple = [0, 14, -10];
    builder.box(2.6, 1.3, 2.6, TONE.concrete, { pos: [0, 0.25, 0], kind: KIND.STONE });
    builder.cyl(0.9, 0.9, 0.3, PAL.iron, { pos: [0, 1.05, 0], kind: KIND.METAL }, 12);
    builder.box(2, 1.8, 3, yellow, { pos: [0, 2.1, 0.3], kind: KIND.METAL });
    builder.box(1.9, 1.1, 0.9, PAL.iron, { pos: [0, 1.85, 2.2], kind: KIND.METAL });
    boom(builder, [0, 2.4, -1], tip, 0.42, 0.16, detail ? 9 : 5, yellow, 0.07);
    builder.beam([0, 3, 1.2], [0, 5.4, 1.4], 0.07, yellow, PEN, 4);
    builder.beam([0, 5.4, 1.4], tip, 0.025, PAL.iron, PEN, 4);
    builder.beam(tip, [0, 6.3, -10], 0.02, PAL.iron, PEN, 4);
    builder.cyl(0.75, 0.75, 0.32, PAL.iron, { pos: [0, 6.14, -10], kind: KIND.METAL }, 12);
    builder.box(1.15, 0.06, 0.95, PAL.rust, { pos: [0.15, 5.9, -10.05], rot: [0.12, 0.4, 0.2], kind: KIND.METAL });
    if (!detail) return;
    pane(builder, [-0.45, 2.45, -1.21], 0.9, 0.8, Math.PI, { frame: PAL.iron, bars: false });
    pane(builder, [-1.01, 2.45, -0.4], 1, 0.8, -Math.PI / 2, { frame: PAL.iron, bars: false });
    builder.stencil('T-4', [1.02, 1.7, 0.9], [0, 0, -1], [0, 1, 0], 0.3, PAL.ink);
    builder.beam([0, 5.4, 1.4], [0, 3, -0.9], 0.03, PAL.iron, PEN, 4);
    builder.cyl(0.16, 0.16, 0.5, PAL.iron, { pos: [0, 14, -10], rot: [0, 0, Math.PI / 2], kind: KIND.METAL }, 8);
    for (const x of [-0.35, 0.35]) builder.beam([x, 6.3, -10], [0, 7, -10], 0.012, PAL.iron, PEN, 4);
    for (const [x, long] of [[0.7, 0.9], [-0.4, 0.5]]) builder.box(0.3, long, 0.02, PAL.rustLight, { pos: [x, 2.9 - long / 2, -1.215], flat: true, kind: KIND.PLAIN });
    ladder(builder, [1.03, 0.9, 1.2], [1.03, 3, 1.2], [0, 0, 1], 0.4, PAL.iron, 0.35, 0.02);
  },

  /** Tink's forge: a stone hearth and its stack under a tin roof on four posts, bellows, the anvil on its block, a quench barrel. */
  forge_hearth: (builder, detail) => {
    for (const [x, z, height] of [[-1.7, -1.5, 2.5], [1.7, -1.5, 2.5], [-1.7, 1.5, 2.1], [1.7, 1.5, 2.1]]) {
      builder.beam([x, -0.3, z], [x, height, z], 0.07, PAL.woodDark, { kind: KIND.BARK }, 6);
    }
    builder.box(4, 0.06, 3.7, PAL.tin, { pos: [0, 2.36, 0], rot: [-0.133, 0, 0], kind: KIND.METAL, axis: 2 });
    builder.box(1.6, 0.85, 1.1, '#a59f9b', { pos: [0, 0.42, 0.9], kind: KIND.STONE });
    builder.box(0.62, 3.6, 0.62, '#9c9692', { pos: [0, 2.4, 1.15], kind: KIND.STONE });
    builder.box(0.78, 0.12, 0.78, '#8d8886', { pos: [0, 4.25, 1.15], kind: KIND.STONE });
    builder.box(1.2, 0.1, 0.7, '#3a3c45', { pos: [0, 0.88, 0.8], kind: KIND.METAL });
    builder.box(0.55, 0.08, 0.4, '#f0a04a', { pos: [0, 0.95, 0.8], ...EMBER });
    // The anvil on its block.
    builder.cyl(0.26, 0.3, 0.55, PAL.bark, { pos: [0.1, 0.27, -0.6], kind: KIND.BARK }, 8);
    builder.box(0.55, 0.17, 0.22, PAL.iron, { pos: [0.1, 0.64, -0.6], kind: KIND.METAL });
    builder.cone(0.1, 0.34, PAL.iron, { pos: [0.52, 0.65, -0.6], rot: [0, 0, -Math.PI / 2], kind: KIND.METAL }, 6);
    if (!detail) return;
    builder.box(0.3, 0.1, 0.16, PAL.iron, { pos: [0.1, 0.53, -0.6], kind: KIND.METAL });
    // Bellows, a quench barrel, tongs and a hammer on the rail, bar stock against a post.
    builder.box(0.9, 0.12, 0.6, TONE.board, { pos: [-1.15, 0.95, 0.85], rot: [0, 0, 0.12], kind: KIND.WOOD });
    builder.box(0.9, 0.12, 0.6, TONE.boardDark, { pos: [-1.15, 0.72, 0.85], rot: [0, 0, -0.1], kind: KIND.WOOD });
    builder.box(0.8, 0.14, 0.5, '#5d4b42', { pos: [-1.2, 0.83, 0.85], flat: true, kind: KIND.CLOTH });
    builder.beam([-0.72, 0.84, 0.85], [-0.3, 0.9, 0.82], 0.04, PAL.iron, { r2: 0.02, kind: KIND.METAL }, 5);
    builder.cyl(0.33, 0.29, 0.75, PAL.wood, { pos: [1.2, 0.37, 0.2], kind: KIND.WOOD }, 10);
    for (const y of [0.18, 0.6]) builder.cyl(0.335, 0.335, 0.05, PAL.iron, { pos: [1.2, y, 0.2], kind: KIND.METAL }, 10);
    builder.cyl(0.29, 0.29, 0.02, '#86a5b3', { pos: [1.2, 0.72, 0.2], flat: true, kind: KIND.PLAIN }, 10);
    builder.beam([-1.7, 1.3, -1.5], [1.7, 1.3, -1.5], 0.03, PAL.woodDark, { kind: KIND.WOOD }, 5);
    for (const x of [-1, -0.75]) builder.beam([x, 1.3, -1.52], [x + 0.04, 0.65, -1.52], 0.012, PAL.iron, PEN, 4);
    builder.beam([-0.3, 1.3, -1.52], [-0.3, 0.85, -1.52], 0.014, PAL.wood, PEN, 4);
    builder.box(0.16, 0.1, 0.08, PAL.iron, { pos: [-0.3, 0.83, -1.52], kind: KIND.METAL });
    for (const lean of [0, 0.08, 0.16]) builder.beam([1.5 + lean, 0, -1.2 + lean], [1.72, 2, -1.45], 0.016, PAL.rust, PEN, 4);
    builder.beam([0, 4.3, 1.15], [-0.5, 5.2, 1.15], 0.05, TONE.smoke, { id: PEN.id, flat: true, kind: KIND.PLAIN, glow: 0.3, r2: 0.09 }, 5);
  },

  /** A bed of cattails: tall blades and brown heads, thick enough to hide a heron. */
  reed_bed: (builder, detail) => {
    const random = seededRandom(61);
    const blades = detail ? 150 : 50;
    for (let index = 0; index < blades; index += 1) {
      const angle = random() * Math.PI * 2;
      const reach = Math.sqrt(random());
      const x = Math.cos(angle) * reach * 5.4;
      const z = Math.sin(angle) * reach * 3.8;
      const height = 1.3 + random() * 1.1;
      builder.cone(detail ? 0.05 : 0.08, height + 0.4, index % 3 ? TONE.reed : TONE.reedPale, {
        pos: [x, height * 0.5 - 0.4, z], rot: [0.28 * (random() - 0.5), 0, 0.28 * (random() - 0.5) - 0.08], id: PEN.id, glow: 0.45, flat: true, kind: KIND.PLAIN,
      }, 4);
      if (index % 3 === 0) builder.cyl(0.05, 0.05, 0.26, TONE.cattail, { pos: [x - 0.03, height * 0.9, z], id: PEN.id, glow: 0.3, flat: true, kind: KIND.PLAIN }, 5);
    }
  },
};
