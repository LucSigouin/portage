/**
 * The Shallows' landmarks: the Home Knoll camp (lean-to, campfire, stump
 * bench), the cabin roofs, the birch grove, the orchard and its farmhouse,
 * the boathouse and its dock, and the bedroll every survivor's camp has.
 */
import type { LandmarkKind } from '../../data/index.ts';
import { KIND } from '../b2/detail.js';
import { birch, cabinRoof } from '../b2/flora.js';
import type { Builder, Triple } from '../b2/geo.js';
import { PAL } from '../b2/palette.js';
import { seededRandom } from '../scatter.ts';
import { EMBER, PEN, TONE, gable, gableEnd, ladder, moved, pane, siteOf, smoke, turnY } from './kit.ts';
import type { LandmarkBuilder } from './kit.ts';

/** A campfire's heart: a ring of stones, crossed logs, one ember. */
export function fireRing(builder: Builder): void {
  for (let index = 0; index < 9; index += 1) {
    const angle = (index / 9) * Math.PI * 2;
    builder.sphere(0.13 + (index % 3) * 0.02, index % 2 ? '#b3aaa0' : '#a59f9b', { pos: [Math.cos(angle) * 0.5, 0.06, Math.sin(angle) * 0.5], scale: [1.2, 0.7, 1], rot: [0, angle, 0], kind: KIND.STONE }, 6);
  }
  for (const [angle, tone] of [[0.3, PAL.woodDark], [1.5, PAL.bark], [2.6, PAL.woodDark]] as const) {
    builder.beam([Math.cos(angle) * 0.4, 0.06, Math.sin(angle) * 0.4], [-Math.cos(angle) * 0.22, 0.32, -Math.sin(angle) * 0.22], 0.055, tone, { kind: KIND.BARK }, 6);
  }
  builder.cone(0.14, 0.32, '#f0a04a', { pos: [0, 0.22, 0], ...EMBER }, 6);
}

/** One orchard tree: a short limed trunk, a low round crown, apples in it. */
function orchardTree(builder: Builder, x: number, y: number, z: number, size: number, random: () => number, detail: boolean): void {
  const lean = (random() - 0.5) * 0.4;
  const fork: Triple = [x + lean * 0.5, y + 1.25 * size, z];
  builder.beam([x, y - 0.4, z], fork, 0.17 * size, PAL.bark, { r2: 0.12 * size, kind: KIND.BARK }, 7);
  const tones = [PAL.sageDeep, TONE.leaf];
  const crown: Triple = [x + lean, y + 2.45 * size, z + (random() - 0.5) * 0.3];
  const radius = 1.5 * size;
  builder.sphere(radius, tones[Math.floor(random() * 2)], { pos: crown, scale: [1.25, 0.78, 1.15], rot: [0, random() * 3, 0], kind: KIND.LEAF }, detail ? 9 : 6);
  if (!detail) return;
  builder.cyl(0.15 * size, 0.18 * size, 0.7, PAL.cream, { pos: [x + lean * 0.12, y + 0.3, z], flat: true, kind: KIND.PAINT }, 7);
  for (const side of [-1, 1]) {
    const tip: Triple = [crown[0] + side * 0.9 * size, crown[1] - 0.25 * size, crown[2] + side * 0.3];
    builder.beam(fork, tip, 0.08 * size, PAL.bark, { r2: 0.04, kind: KIND.BARK }, 5);
    builder.sphere(radius * 0.62, tones[side > 0 ? 0 : 1], { pos: [tip[0] + side * 0.2, tip[1] + 0.5 * size, tip[2]], scale: [1.2, 0.8, 1.1], kind: KIND.LEAF }, 8);
  }
  for (let apple = 0; apple < 8; apple += 1) {
    const angle = random() * 6.28;
    const tilt = 0.9 + random() * 1.1;
    builder.sphere(0.1, TONE.apple, {
      pos: [crown[0] + Math.cos(angle) * Math.sin(tilt) * radius * 1.24, crown[1] + Math.cos(tilt) * radius * 0.77, crown[2] + Math.sin(angle) * Math.sin(tilt) * radius * 1.14],
      id: 0.93, flat: true, kind: KIND.PLAIN, glow: 0.4,
    }, 6);
  }
}

export const SHALLOWS: Partial<Record<LandmarkKind, LandmarkBuilder>> = {
  /** A pole lean-to under bark slabs and a patch of tarp, open to the north, with a bed of boughs inside. */
  lean_to: (builder, detail) => {
    const roofAt = (z: number): number => 1.95 - (z + 1.1) * 0.727;
    for (const side of [-1, 1]) {
      builder.beam([side * 1.55, -0.3, -1.1], [side * 1.55, 2.05, -1.1], 0.07, PAL.bark, { kind: KIND.BARK }, 6);
      if (detail) builder.beam([side * 1.55, 1.9, -1.1], [side * 1.75, 2.3, -1.2], 0.035, PAL.bark, { kind: KIND.BARK }, 5);
    }
    builder.beam([-1.9, 1.9, -1.1], [1.9, 1.93, -1.1], 0.06, PAL.woodDark, { kind: KIND.BARK }, 6);
    const slabs = [TONE.board, TONE.boardDark, '#927659', TONE.boardDark, TONE.board, '#7a614b'];
    slabs.forEach((tone, index) => {
      const x = -1.45 + index * 0.58;
      builder.plank([x, 1.98, -1.25], [x, 0.04, 1.55], 0.56, 0.05, tone, { kind: KIND.BARK });
    });
    builder.box(1.5, 0.03, 1.7, PAL.canvasSage, { pos: [-0.75, 1.22, 0.02], rot: [0.628, 0, 0], kind: KIND.CLOTH });
    if (!detail) return;
    // Spruce boughs laid over the foot of the roof, and stakes closing the sides.
    builder.box(3.5, 0.07, 0.9, PAL.pineDark, { pos: [0.1, 0.42, 1.12], rot: [0.628, 0, 0], kind: KIND.NEEDLE });
    builder.box(1.6, 0.07, 0.6, PAL.pine, { pos: [0.9, 0.86, 0.5], rot: [0.628, 0.05, 0], kind: KIND.NEEDLE });
    for (const side of [-1, 1]) for (let stake = 0; stake < 4; stake += 1) {
      const z = -0.6 + stake * 0.55;
      builder.beam([side * 1.6, -0.2, z], [side * 1.58, roofAt(z) - 0.04, z], 0.035, stake % 2 ? PAL.bark : PAL.woodDark, { kind: KIND.BARK }, 5);
    }
    for (const x of [-1, -0.5, 0, 0.5, 1]) builder.beam([x, 1.9, -1.1], [x, 0.03, 1.5], 0.03, PAL.bark, PEN, 4);
    // The bed: boughs, a blanket, a rolled coat for a pillow.
    builder.box(2.3, 0.14, 0.95, PAL.pineDark, { pos: [0, 0.07, 0.15], kind: KIND.NEEDLE });
    builder.box(1.9, 0.07, 0.8, PAL.rust, { pos: [0.1, 0.18, 0.15], rot: [0, 0.03, 0], kind: KIND.CLOTH });
    builder.cyl(0.11, 0.11, 0.55, PAL.cream, { pos: [-0.95, 0.24, 0.15], rot: [Math.PI / 2, 0, 0], kind: KIND.CLOTH }, 8);
    // A pack against the post, a paddle, a lantern on the ridge pole.
    builder.box(0.42, 0.52, 0.3, PAL.ochre, { pos: [1.2, 0.26, -0.7], rot: [0, 0.3, 0.08], kind: KIND.CLOTH });
    builder.box(0.44, 0.1, 0.32, PAL.woodDark, { pos: [1.2, 0.5, -0.7], rot: [0, 0.3, 0.08], kind: KIND.CLOTH });
    builder.beam([-1.85, 0, -1.45], [-1.66, 1.75, -1.2], 0.022, PAL.woodLight, { kind: KIND.WOOD }, 5);
    builder.box(0.16, 0.5, 0.03, PAL.woodLight, { pos: [-1.63, 1.98, -1.17], rot: [0.14, 0, -0.1], kind: KIND.WOOD });
    builder.beam([0.55, 1.88, -1.1], [0.55, 1.62, -1.1], 0.008, PAL.iron, PEN, 4);
    builder.cyl(0.07, 0.07, 0.16, PAL.glow, { pos: [0.55, 1.52, -1.1], glow: 0.7, flat: true, kind: KIND.PLAIN }, 7);
    builder.cone(0.1, 0.07, PAL.iron, { pos: [0.55, 1.635, -1.1], kind: KIND.METAL }, 7);
  },

  /** The fire: the ring, a pot on a tripod, split wood, a log to sit on, and a wisp of smoke. */
  campfire: (builder, detail) => {
    fireRing(builder);
    smoke(builder, 0, 0.45, 0);
    if (!detail) return;
    for (let leg = 0; leg < 3; leg += 1) {
      const angle = (leg / 3) * Math.PI * 2 + 0.5;
      builder.beam([Math.cos(angle) * 0.8, 0, Math.sin(angle) * 0.8], [Math.cos(angle) * 0.03, 1.55, Math.sin(angle) * 0.03], 0.025, PAL.woodDark, { kind: KIND.BARK }, 5);
    }
    builder.beam([0, 1.5, 0], [0, 0.95, 0], 0.008, PAL.iron, PEN, 4);
    builder.cyl(0.17, 0.13, 0.22, PAL.iron, { pos: [0, 0.83, 0], kind: KIND.METAL }, 9);
    builder.torus(0.17, 0.012, PAL.iron, { pos: [0, 0.95, 0], rot: [0, 0.4, 0], kind: KIND.METAL }, 8);
    const split = [PAL.woodLight, PAL.wood, '#c9a877', PAL.wood, PAL.woodLight];
    split.forEach((tone, index) => {
      const row = index < 3 ? 0 : 1;
      const x = 1.25 + (index - (row ? 3.5 : 1)) * 0.2;
      builder.beam([x, 0.09 + row * 0.17, -0.25], [x + 0.03, 0.09 + row * 0.17, 0.35], 0.09, tone, { r2: 0.085, kind: KIND.WOOD }, 6);
    });
    builder.beam([-1.35, 0.17, -0.7], [-0.95, 0.17, 0.95], 0.17, PAL.bark, { r2: 0.15, kind: KIND.BARK }, 8);
  },

  /** The workbench: a slab on two stumps with tools on it, and a chopping stump with the hatchet left in it. */
  stump_bench: (builder, detail) => {
    for (const x of [-0.7, 0.7]) builder.cyl(0.24, 0.3, 0.74, PAL.bark, { pos: [x, 0.37, 0], kind: KIND.BARK }, 9);
    builder.box(2, 0.1, 0.62, PAL.woodLight, { pos: [0, 0.79, 0], rot: [0, 0.02, 0], kind: KIND.WOOD });
    builder.cyl(0.36, 0.44, 0.5, PAL.bark, { pos: [1.75, 0.25, 0.5], kind: KIND.BARK }, 10);
    builder.cyl(0.35, 0.35, 0.03, PAL.woodLight, { pos: [1.75, 0.51, 0.5], kind: KIND.WOOD }, 10);
    if (!detail) return;
    builder.cyl(0.2, 0.2, 0.01, PAL.wood, { pos: [1.75, 0.53, 0.5], flat: true, kind: KIND.PLAIN }, 10);
    builder.beam([1.78, 0.56, 0.5], [2.05, 0.98, 0.56], 0.02, PAL.wood, { kind: KIND.WOOD }, 5);
    builder.box(0.05, 0.17, 0.11, PAL.iron, { pos: [1.8, 0.6, 0.5], rot: [0, 0, 0.55], kind: KIND.METAL });
    // On the bench: a mallet, a tin of nails, a coil of cord, a board being worked.
    builder.cyl(0.06, 0.06, 0.2, PAL.wood, { pos: [-0.55, 0.9, 0.05], rot: [0, 0.4, Math.PI / 2], kind: KIND.WOOD }, 7);
    builder.beam([-0.55, 0.9, 0.05], [-0.33, 0.87, 0.26], 0.016, PAL.woodDark, { kind: KIND.WOOD }, 5);
    builder.cyl(0.06, 0.06, 0.12, PAL.tin, { pos: [0.1, 0.9, -0.15], kind: KIND.METAL }, 8);
    builder.torus(0.11, 0.03, '#d9c79b', { pos: [0.62, 0.87, 0.08], rot: [Math.PI / 2, 0, 0], kind: KIND.ROPE }, 10);
    builder.box(0.9, 0.03, 0.14, PAL.wood, { pos: [-0.1, 0.86, 0.2], rot: [0, -0.3, 0], kind: KIND.WOOD });
    for (const [x, z] of [[0.3, 0.6], [-0.2, 0.75], [0.6, 0.85]]) builder.box(0.16, 0.012, 0.05, PAL.woodLight, { pos: [x, 0.01, z], rot: [0, x * 4, 0], flat: true, kind: KIND.PLAIN });
  },

  /** A cottage roof left by the water: B2's own, grounded in silt, with a stone chimney and what the flood left against it. */
  cabin_roof: (builder, detail) => {
    cabinRoof(builder, !detail);
    builder.box(0.7, 3, 0.6, '#a59f9b', { pos: [-1.2, 0.9, -2.3], rot: [0.03, 0, -0.05], kind: KIND.STONE });
    builder.box(0.84, 0.12, 0.74, '#8d8886', { pos: [-1.27, 2.45, -2.34], rot: [0.03, 0, -0.05], kind: KIND.STONE });
    if (!detail) return;
    // Silt banked against the eaves, a drift log, an aerial gone crooked.
    builder.sphere(1, '#b9ad94', { pos: [2.5, -0.12, -0.6], scale: [1.1, 0.36, 2.6], kind: KIND.SOIL }, 8);
    builder.sphere(1, '#b0a48c', { pos: [-2.6, -0.1, 1.1], scale: [0.9, 0.3, 1.9], kind: KIND.SOIL }, 8);
    builder.beam([2.3, 0.22, -2.6], [3.3, 0.14, 1.6], 0.14, PAL.driftwood, { r2: 0.09, kind: KIND.DRIFT }, 7);
    builder.beam([0.2, 1.7, -1.9], [0.32, 3.5, -1.95], 0.025, PAL.iron, PEN, 4);
    for (const [y, half] of [[3.4, 0.5], [3.15, 0.38], [2.9, 0.26]]) builder.beam([0.31 - half, y, -1.95], [0.31 + half, y + 0.04, -1.95], 0.014, PAL.iron, PEN, 4);
  },

  /** A stand of white birch on the crown of the islet, each on the rules' own ground, with one long down. */
  birch_grove: (builder, detail) => {
    const site = siteOf('birch_grove');
    const random = seededRandom(52);
    for (let index = 0; index < 11; index += 1) {
      const angle = (index / 11) * Math.PI * 2 + random();
      const reach = 1.6 + random() * 6.2;
      const x = Math.cos(angle) * reach;
      const z = Math.sin(angle) * reach;
      birch(builder, x, site.ground(x, z), z, 6.2 + random() * 2.6, random, !detail);
    }
    if (!detail) return;
    const lie = site.ground(2.5, -1) + 0.1;
    const id = builder.beam([0.4, lie, -2.4], [4.6, lie + 0.05, 0.6], 0.1, PAL.birch, { r2: 0.07, flat: true, kind: KIND.BIRCH }, 6);
    for (const share of [0.2, 0.45, 0.7]) builder.cyl(0.105, 0.105, 0.05, '#4c4741', { pos: [0.4 + 4.2 * share, lie + 0.02, -2.4 + 3 * share], rot: [0, -0.95, Math.PI / 2], id, flat: true, kind: KIND.PLAIN }, 6);
  },

  /** Three rows of apple trees down the slope, limed trunks, a rail fence along the low side, a picking ladder. */
  orchard_rows: (builder, detail) => {
    const site = siteOf('orchard_rows');
    const random = seededRandom(31);
    for (const rowZ of [-4.7, 0, 4.7]) {
      for (let index = 0; index < 4; index += 1) {
        const x = -6.9 + index * 4.6 + (random() - 0.5) * 0.6;
        const z = rowZ + (random() - 0.5) * 0.6;
        orchardTree(builder, x, site.ground(x, z), z, 0.86 + random() * 0.26, random, detail);
      }
    }
    // The fence runs along the side the ground falls to.
    const low = site.ground(0, -8.6) < site.ground(0, 8.6) ? -8.6 : 8.6;
    const posts: Triple[] = [];
    for (let post = 0; post <= 6; post += 1) {
      const x = -9 + post * 3;
      posts.push([x, site.ground(x, low), low]);
    }
    posts.forEach(([x, y, z], post) => {
      builder.box(0.12, 1.1, 0.12, PAL.driftwood, { pos: [x, y + 0.45, z], rot: [0, 0, (post % 3 - 1) * 0.05], kind: KIND.DRIFT });
      const next = posts[post + 1];
      if (!next || post === 4) return;
      builder.beam([x, y + 0.82, z], [next[0], next[1] + 0.78, next[2]], 0.04, PAL.driftwood, { kind: KIND.DRIFT }, 5);
      if (detail) builder.beam([x, y + 0.42, z], [next[0], next[1] + (post === 1 ? 0.1 : 0.4), next[2]], 0.04, '#c4bbab', { kind: KIND.DRIFT }, 5);
    });
    if (!detail) return;
    const foot = site.ground(-2.9, 1.3);
    ladder(builder, [-2.9, foot, 1.3], [-2.4, foot + 2.5, 0.35], [0.9, 0, 0.45], 0.42, PAL.woodLight, 0.36, 0.022);
    builder.cyl(0.26, 0.2, 0.3, PAL.wood, { pos: [-3.5, foot + 0.15, 1.9], kind: KIND.CANE }, 9);
    for (const [x, z] of [[-3.5, 1.9], [-3.4, 1.95], [-3.58, 1.84]]) builder.sphere(0.09, TONE.apple, { pos: [x, foot + 0.33, z], id: 0.93, flat: true, kind: KIND.PLAIN, glow: 0.4 }, 6);
  },

  /** Odile's farmhouse: two storeys of white clapboard on a stone footing, a steep roof, a porch, a kitchen wing, a brick chimney. */
  farmhouse: (builder, detail) => {
    const roof = '#66756f';
    builder.box(7.9, 1.5, 6.3, '#a59f9b', { pos: [0, -0.55, 0], kind: KIND.STONE });
    builder.box(7.6, 5.3, 6, TONE.whitewash, { pos: [0, 2.75, 0], kind: KIND.SIDING, seed: 0.5 });
    moved(builder, turnY(Math.PI / 2), () => {
      gable(builder, 6, 7.6, 5.4, 2.7, roof, { overhang: 0.4, ridge: '#4f5d58' });
      for (const end of [-3.72, 3.72]) gableEnd(builder, 6, 5.4, 2.7, end, TONE.whitewash, { kind: KIND.SIDING, courses: detail ? 5 : 2 });
    });
    // The kitchen wing behind, one storey.
    builder.box(4, 3.6, 4.4, TONE.whitewash, { pos: [1.3, 0.9, 5.1], kind: KIND.SIDING, seed: 0.7 });
    gable(builder, 4, 4.4, 2.7, 1.5, roof, { centre: [1.3, 5.1], ridge: '#4f5d58' });
    gableEnd(builder, 4, 2.7, 1.5, 7.24, TONE.whitewash, { x: 1.3, kind: KIND.SIDING, courses: detail ? 3 : 1 });
    builder.box(0.85, 3.3, 0.85, TONE.brick, { pos: [2.5, 7.6, 0.3], kind: KIND.STONE });
    builder.box(1, 0.16, 1, '#8b5140', { pos: [2.5, 9.3, 0.3], kind: KIND.STONE });
    // The porch along the front.
    builder.box(5.4, 0.2, 1.9, PAL.driftwood, { pos: [-0.6, 0.12, -3.95], kind: KIND.DRIFT, axis: 0 });
    builder.box(5.8, 0.1, 2.2, roof, { pos: [-0.6, 2.86, -4], rot: [0.2, 0, 0], kind: KIND.SHINGLE, axis: 2 });
    for (const x of [-3.2, -0.6, 2]) builder.box(0.14, 2.6, 0.14, TONE.trim, { pos: [x, 1.45, -4.8], kind: KIND.PAINT });
    if (!detail) return;
    for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) builder.box(0.22, 5.3, 0.22, TONE.trim, { pos: [sideX * 3.75, 2.75, sideZ * 2.95], kind: KIND.PAINT });
    builder.box(1, 2.1, 0.1, TONE.door, { pos: [-1.7, 1.25, -3.03], kind: KIND.WOOD });
    builder.box(1.2, 0.12, 0.14, TONE.trim, { pos: [-1.7, 2.36, -3.04], kind: KIND.PAINT });
    const shutter = (x: number, y: number, z: number, turn: number): void => {
      pane(builder, [x, y, z], 0.9, 1.3, turn);
      moved(builder, turnY(turn, x, y, z), () => {
        for (const side of [-1, 1]) builder.box(0.3, 1.3, 0.06, PAL.pineDark, { pos: [side * 0.64, 0, 0.02], rot: [0, 0, side * (x > 2 && y < 3 ? 0.12 : 0)], kind: KIND.PAINT });
      });
    };
    for (const x of [0.5, 2.5]) shutter(x, 1.9, -3.04, Math.PI);
    for (const x of [-2.4, 0, 2.4]) shutter(x, 4.4, -3.04, Math.PI);
    for (const z of [-1.3, 1.3]) {
      shutter(-3.84, 4.4, z, -Math.PI / 2);
      shutter(-3.84, 1.9, z, -Math.PI / 2);
    }
    pane(builder, [-3.76, 7, 0], 0.7, 0.9, -Math.PI / 2);
    pane(builder, [3.76, 7, 0], 0.7, 0.9, Math.PI / 2);
    pane(builder, [3.84, 4.4, -1.2], 0.9, 1.3, Math.PI / 2);
    pane(builder, [3.34, 1.7, 5.1], 0.9, 1.1, Math.PI / 2);
    for (const step of [0, 1]) builder.box(1.6, 0.18, 0.4, PAL.driftwood, { pos: [-1.7, -0.1 + step * 0.01, -5.1 - step * 0.4], kind: KIND.DRIFT });
    builder.beam([-3.72, 8.2, 0], [-3.72, 9.3, 0], 0.02, PAL.iron, PEN, 4);
    // A rocker on the porch.
    builder.box(0.5, 0.06, 0.5, PAL.wood, { pos: [1.2, 0.62, -4], rot: [0.1, 0.5, 0], kind: KIND.CANE });
    builder.box(0.5, 0.7, 0.05, PAL.wood, { pos: [1.32, 0.98, -3.8], rot: [0.25, 0.5, 0], kind: KIND.CANE });
    for (const side of [-1, 1]) builder.beam([1.2 + side * 0.24, 0.26, -4.3], [1.25 + side * 0.24, 0.26, -3.65], 0.02, PAL.woodDark, { kind: KIND.WOOD }, 4);
  },

  /** The marina's boathouse: blue board walls on a timber footing, a tin roof with a vent, boat doors to the dock side, one stood open. */
  boathouse: (builder, detail) => {
    const site = siteOf('boathouse');
    const wall = { kind: KIND.SIDING, seed: 0.6 } as const;
    builder.box(11, 4.5, 0.22, TONE.boatBlue, { pos: [0, 0.85, -3.64], ...wall });
    for (const side of [-1, 1]) builder.box(0.22, 4.5, 7.5, TONE.boatBlue, { pos: [side * 5.39, 0.85, 0], ...wall, axis: 2 });
    builder.box(7.6, 4.5, 0.22, TONE.boatBlue, { pos: [1.7, 0.85, 3.64], ...wall });
    builder.box(3.2, 0.75, 0.22, TONE.boatBlue, { pos: [-3.6, 2.73, 3.64], ...wall });
    builder.box(10.7, 0.2, 7.2, PAL.woodDark, { pos: [0, 0, 0], kind: KIND.WOOD, axis: 0 });
    builder.box(11.3, 1.3, 7.8, '#6f6359', { pos: [0, -0.75, 0], kind: KIND.WOOD, axis: 0 });
    moved(builder, turnY(Math.PI / 2), () => {
      gable(builder, 7.5, 11, 3.1, 1.7, PAL.tin, { kind: KIND.METAL, overhang: 0.45, ridge: TONE.steelPale });
      for (const end of [-5.39, 5.39]) gableEnd(builder, 7.5, 3.1, 1.7, end, TONE.boatBlue, { kind: KIND.SIDING, courses: detail ? 4 : 2 });
    });
    builder.box(1.1, 0.8, 1.1, TONE.boatBlue, { pos: [0, 5.05, 0], kind: KIND.SIDING });
    builder.cone(0.95, 0.6, PAL.tin, { pos: [0, 5.75, 0], rot: [0, Math.PI / 4, 0], kind: KIND.METAL }, 4);
    for (const x of [0.5, 3.6]) builder.box(2.6, 2.6, 0.1, TONE.whitewash, { pos: [x, 1.3, 3.78], kind: KIND.PAINT });
    if (!detail) return;
    for (const x of [0.5, 3.6]) {
      builder.plank([x - 1.2, 0.1, 3.85], [x + 1.2, 2.5, 3.85], 0.14, 0.04, TONE.trim, { kind: KIND.PAINT });
      builder.plank([x + 1.2, 0.1, 3.85], [x - 1.2, 2.5, 3.85], 0.14, 0.04, TONE.trim, { kind: KIND.PAINT });
      builder.box(0.06, 2.6, 0.12, '#7d8d95', { pos: [x, 1.3, 3.8], flat: true });
    }
    // The open door, its sign, a life ring, rust creeping down the tin.
    builder.box(1.5, 2.6, 0.1, TONE.whitewash, { pos: [-1.75, 1.3, 4.5], rot: [0, 1.2, 0], kind: KIND.PAINT });
    builder.box(2.7, 0.8, 0.06, PAL.cream, { pos: [2.05, 3.25, 3.78], kind: KIND.PAINT });
    builder.stencil('BOATS', [1.05, 3, 3.83], [1, 0, 0], [0, 1, 0], 0.5, PAL.rustDark);
    builder.torus(0.34, 0.08, '#d2553d', { pos: [-0.95, 1.8, 3.8], kind: KIND.PAINT }, 12);
    for (const [x, z, long] of [[-3.2, 1.2, 1.8], [2.4, 2, 1.2], [-0.6, -1.6, 1.5]]) {
      builder.box(0.7, 0.02, long, PAL.rustLight, { pos: [x, 4.82 - Math.abs(z) * 0.453, z], rot: [Math.sign(z) * 0.425, 0, 0], flat: true, kind: KIND.PLAIN });
    }
    for (const x of [-3.5, 0, 3.5]) pane(builder, [x, 2.2, -3.77], 1, 0.8, Math.PI, { glass: TONE.glassDark });
    // The slip: two rails from the open door down the bank, and the cradle left on them.
    const railAt = (x: number, z: number): Triple => [x, Math.max(site.ground(x, z), site.water - 0.4) + 0.1, z];
    for (const x of [-4.2, -3]) {
      for (let z = 3.8; z < 15.8; z += 3) builder.beam(railAt(x, z), railAt(x, z + 3), 0.045, PAL.rust, { kind: KIND.METAL }, 5);
    }
    for (let z = 4.4; z < 15.8; z += 1.4) {
      const tie = railAt(-3.6, z);
      builder.box(1.9, 0.1, 0.2, PAL.woodDark, { pos: [tie[0], tie[1] - 0.08, tie[2]], kind: KIND.WOOD, axis: 0 });
    }
    const cradle = railAt(-3.6, 7.2);
    builder.box(1.5, 0.12, 1.9, PAL.wood, { pos: [cradle[0], cradle[1] + 0.2, cradle[2]], kind: KIND.WOOD });
    for (const side of [-1, 1]) builder.box(0.1, 0.55, 1.7, PAL.woodDark, { pos: [cradle[0] + side * 0.62, cradle[1] + 0.5, cradle[2]], rot: [0, 0, side * 0.35], kind: KIND.WOOD });
    // Two canoes on the rack at the gable end.
    for (const z of [-1.6, 1.6]) {
      builder.beam([-6.3, -0.3, z], [-6.3, 2.1, z], 0.07, PAL.woodDark, { kind: KIND.BARK }, 6);
      for (const y of [0.9, 1.75]) builder.beam([-5.5, y, z], [-7.05, y, z], 0.045, PAL.woodDark, { kind: KIND.BARK }, 5);
    }
    builder.sphere(1, PAL.rust, { pos: [-6.5, 1.12, 0], scale: [0.4, 0.22, 2.4], kind: KIND.PAINT }, 10);
    builder.sphere(1, PAL.ochre, { pos: [-6.5, 1.97, 0.1], scale: [0.4, 0.22, 2.3], kind: KIND.PAINT }, 10);
  },

  /** The dock: a boardwalk from the yard down the bank on the rules' own ground, then a pier out over the water to a T-head. */
  dock: (builder, detail) => {
    const site = siteOf('dock');
    let shore = 30;
    for (let z = 0; z < 60; z += 0.5) {
      if (site.ground(0, z) < site.water) {
        shore = z;
        break;
      }
    }
    const end = Math.ceil(shore) + 10;
    const deckAt = (z: number): number => Math.max(site.ground(0, z) + 0.3, site.water + 0.6);
    const tones = [PAL.driftwood, '#c4bbab', '#d6cebf', '#bdb4a4'];
    const board = detail ? 0.5 : 2.5;
    for (let z = -1.5, index = 0; z < end; z += board, index += 1) {
      builder.plank([0, deckAt(z), z], [0, deckAt(z + board), z + board - (detail ? 0.03 : 0)], 1.9 + (detail ? (index % 3) * 0.05 : 0), 0.07, tones[index % 4], { kind: KIND.DRIFT, axis: 0 });
    }
    builder.box(5.6, 0.08, 1.9, tones[0], { pos: [0, deckAt(end) , end + 0.9], kind: KIND.DRIFT, axis: 0 });
    for (let z = 0; z <= end; z += 2.5) {
      const afloat = z > shore - 1;
      const foot = afloat ? site.water - 2 : site.ground(0, z) - 0.6;
      for (const side of [-1, 1]) builder.beam([side * 0.9, foot, z], [side * 0.9, deckAt(z) + (afloat && z % 5 === 0 ? 0.75 : -0.02), z], 0.085, PAL.woodDark, { kind: KIND.BARK }, 6);
    }
    for (const x of [-2.6, 2.6]) for (const z of [end + 0.1, end + 1.7]) builder.beam([x, site.water - 2, z], [x, deckAt(end) + 0.9, z], 0.1, PAL.woodDark, { kind: KIND.BARK }, 6);
    if (!detail) return;
    for (const side of [-1, 1]) {
      builder.beam([side * 0.92, deckAt(shore) - 0.12, shore - 2], [side * 0.92, deckAt(end) - 0.12, end], 0.05, '#a39a8a', { kind: KIND.DRIFT }, 5);
    }
    const head = deckAt(end);
    builder.torus(0.17, 0.035, '#d9c79b', { pos: [2.2, head + 0.07, end + 1.3], rot: [Math.PI / 2, 0, 0], kind: KIND.ROPE }, 10);
    for (const x of [-1.6, 0.4]) builder.torus(0.3, 0.11, TONE.tyre, { pos: [x, head - 0.28, end + 1.9], kind: KIND.PLAIN }, 10);
    ladder(builder, [-2.82, site.water - 0.8, end + 0.9], [-2.82, head + 0.5, end + 0.9], [0, 0, 1], 0.45, PAL.iron, 0.3, 0.02);
    builder.box(0.5, 0.36, 0.34, PAL.rust, { pos: [1.5, head + 0.22, end + 0.5], rot: [0, 0.3, 0], kind: KIND.METAL });
    builder.beam([1.5, head + 0.4, end + 0.5], [1.5, head + 0.52, end + 0.5], 0.1, PAL.rust, { r2: 0.1, id: PEN.id, flat: true }, 6);
    // A gas pump's sign post, where the marina sold fuel.
    builder.beam([-0.75, deckAt(shore - 3), shore - 3], [-0.75, deckAt(shore - 3) + 2.4, shore - 3], 0.05, PAL.iron, { kind: KIND.METAL }, 5);
    builder.box(0.9, 0.55, 0.05, PAL.cream, { pos: [-0.75, deckAt(shore - 3) + 2.15, shore - 3], rot: [0, Math.PI / 2, 0], kind: KIND.PAINT });
    builder.stencil('GAS', [-0.72, deckAt(shore - 3) + 2, shore - 2.7], [0, 0, -1], [0, 1, 0], 0.3, PAL.rustDark);
  },

  /** A survivor's bed: a ground sheet, a rolled blanket, boots and a mug beside it. */
  bedroll: (builder, detail) => {
    builder.box(0.85, 0.06, 1.9, PAL.slate, { pos: [0, 0.04, 0], rot: [0, 0.1, 0], kind: KIND.CLOTH });
    builder.box(0.78, 0.07, 1.1, PAL.rustLight, { pos: [0.03, 0.1, 0.32], rot: [0, 0.12, 0], kind: KIND.CLOTH });
    builder.cyl(0.14, 0.14, 0.76, PAL.cream, { pos: [0, 0.17, -0.74], rot: [0, 0.1, Math.PI / 2], kind: KIND.CLOTH }, 9);
    if (!detail) return;
    for (const x of [-0.2, 0.2]) builder.cyl(0.146, 0.146, 0.05, PAL.rust, { pos: [x, 0.17, -0.74 - x * 0.1], rot: [0, 0.1, Math.PI / 2], kind: KIND.PLAIN }, 9);
    for (const x of [0.62, 0.8]) {
      builder.box(0.11, 0.24, 0.13, PAL.bark, { pos: [x, 0.12, 0.7], rot: [0, 0.3, 0], kind: KIND.CLOTH });
      builder.box(0.11, 0.09, 0.2, PAL.bark, { pos: [x + 0.02, 0.045, 0.78], rot: [0, 0.3, 0], kind: KIND.CLOTH });
    }
    builder.cyl(0.05, 0.045, 0.1, PAL.tin, { pos: [0.66, 0.05, -0.2], kind: KIND.METAL }, 8);
  },
};
