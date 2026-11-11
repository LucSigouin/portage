/**
 * The Narrows' and the Fog's landmarks: the truss spans, the quarry cut, the
 * fire tower, the dam and its gatehouse, then the radio tower on High Ridge
 * and the keeper's hut under it.
 */
import type { LandmarkKind } from '../../data/index.ts';
import { KIND } from '../b2/detail.js';
import type { Triple } from '../b2/geo.js';
import { PAL } from '../b2/palette.js';
import { PEN, TONE, gable, gableEnd, ladder, lattice, pane, siteOf } from './kit.ts';
import type { LandmarkBuilder } from './kit.ts';
import { boom } from './reach.ts';

const STEEL = '#5b666d';

/** Length of one truss span, metres: the island table sets them 80 m apart. */
export const TRUSS_SPAN = 80;
/** How far the dam's wall runs each way from its middle, metres. */
export const DAM_HALF = 140;

export const NARROWS: Partial<Record<LandmarkKind, LandmarkBuilder>> = {
  /**
   * One span of the railway bridge: a through truss with a curved top chord, on a pier at each end.
   * No floor: the rules' ground is the deck, and world/dressing.ts lays the track on it.
   */
  truss_span: (builder, detail) => {
    const half = TRUSS_SPAN / 2;
    const tops = [1.2, 7, 8.7, 9.7, 10.3, 10.5, 10.3, 9.7, 8.7, 7, 1.2];
    const at = (side: number, joint: number, top: boolean): Triple => [side * 3.3, top ? tops[joint] : 1.2, -half + joint * 8];
    for (const side of [-1, 1]) {
      builder.box(0.45, 0.55, TRUSS_SPAN, STEEL, { pos: [side * 3.3, 1.2, 0], kind: KIND.METAL, axis: 2 });
      for (let joint = 0; joint < 10; joint += 1) {
        builder.beam(at(side, joint, true), at(side, joint + 1, true), 0.24, STEEL, { kind: KIND.METAL }, 5);
        if (joint === 0) continue;
        builder.beam(at(side, joint, false), at(side, joint, true), 0.11, STEEL, PEN, 4);
        const toward = joint < 5 ? joint + 1 : joint - 1;
        if (joint !== 5 && toward > 0 && toward < 10) builder.beam(at(side, joint, true), at(side, toward, false), 0.09, STEEL, PEN, 4);
      }
    }
    for (let joint = 1; joint < 10; joint += 1) {
      builder.beam(at(-1, joint, true), at(1, joint, true), 0.1, STEEL, PEN, 4);
      if (detail && joint < 9) builder.beam(at(joint % 2 ? -1 : 1, joint, true), at(joint % 2 ? 1 : -1, joint + 1, true), 0.06, STEEL, PEN, 4);
    }
    // The piers: one broad, one deep, so two spans meeting on one never share a face.
    builder.box(9.4, 10, 2.6, TONE.concrete, { pos: [0, -4.05, -half + 0.2], kind: KIND.STONE });
    builder.box(8.2, 10, 3.6, TONE.concreteDark, { pos: [0, -4.1, half - 0.2], kind: KIND.STONE });
    if (!detail) return;
    for (const end of [1, 9]) {
      builder.box(6.8, 0.9, 0.25, STEEL, { pos: [0, tops[end] - 0.7, -half + end * 8], kind: KIND.METAL });
      for (const side of [-1, 1]) builder.beam([side * 3.3, tops[end] - 1.1, -half + end * 8], [side * 1.8, tops[end] - 0.3, -half + end * 8], 0.07, STEEL, PEN, 4);
    }
    builder.stencil('BR 14', [1, tops[9] - 0.9, half - 8 + 0.14], [-1, 0, 0], [0, 1, 0], 0.4, PAL.cream);
    for (const side of [-1, 1]) {
      for (let joint = 1; joint < 10; joint += 1) builder.box(0.5, 0.7, 0.7, '#4f5a61', { pos: [side * 3.3, tops[joint] - 0.1, -half + joint * 8], kind: KIND.METAL });
      for (const [z, long] of [[-22, 1.1], [-3, 0.8], [14, 1.4], [29, 0.9]]) builder.box(0.02, long, 1.2, PAL.rustLight, { pos: [side * 3.54, 1.2 - long / 2 + 0.2, z + side * 3], flat: true, kind: KIND.PLAIN });
    }
  },

  /**
   * The quarry's cut: three benches stepped up the rules' own slope, each a sheer face of pale new
   * stone, with drill lines down them, a stiff-leg derrick on the top bench, a cart, and cut blocks at the foot.
   */
  quarry_cut: (builder, detail) => {
    const site = siteOf('quarry_cut');
    const tones = [TONE.cutStone, TONE.cutStonePink, TONE.cutStoneGrey];
    const depth = 6.5;
    const floor: number[][] = [];
    for (let bench = 0; bench < 3; bench += 1) {
      const front = -13 + bench * depth;
      floor.push([]);
      for (let column = 0; column < 6; column += 1) {
        const x = -20 + column * 8;
        const top = site.ground(x, front + depth) + 0.25;
        const foot = Math.min(site.ground(x - 4, front), site.ground(x + 4, front)) - 1.5;
        floor[bench].push(top);
        builder.box(8.06, top - foot, depth + 0.06, tones[(bench + column) % 3], { pos: [x, (top + foot) / 2, front + depth / 2], kind: KIND.STONE });
        if (!detail) continue;
        for (let line = 0; line < 5; line += 1) {
          const lineX = x - 3.2 + line * 1.6;
          builder.beam([lineX, top - 0.3, front - 0.04], [lineX, Math.max(foot + 1.4, top - 4.6 - (line % 2)), front - 0.04], 0.03, '#8d8886', PEN, 4);
        }
      }
    }
    // The derrick: a mast on the top bench, guyed back into the hill, its boom over the face.
    const mastX = 6;
    const mastFoot = floor[2][3];
    const mastTop: Triple = [mastX, mastFoot + 12, 3];
    builder.beam([mastX, mastFoot - 0.2, 3], mastTop, 0.16, PAL.woodDark, { kind: KIND.WOOD }, 6);
    boom(builder, [mastX, mastFoot + 1.2, 2.6], [mastX - 6, mastFoot + 8.5, -9], 0.3, 0.14, detail ? 6 : 3, PAL.woodDark, 0.06);
    builder.beam(mastTop, [mastX - 6, mastFoot + 8.5, -9], 0.025, PAL.iron, PEN, 4);
    for (const [x, z] of [[mastX + 10, 7], [mastX - 8, 9]]) builder.beam(mastTop, [x, site.ground(x, z), z], 0.025, PAL.iron, PEN, 4);
    builder.beam([mastX - 6, mastFoot + 8.5, -9], [mastX - 6, floor[0][2] + 2.2, -9], 0.02, PAL.iron, PEN, 4);
    builder.box(1.5, 1.1, 1.1, TONE.cutStone, { pos: [mastX - 6, floor[0][2] + 1.6, -9], rot: [0, 0.3, 0.05], kind: KIND.STONE });
    // Cut blocks stacked at the foot of the face.
    for (const [x, z, turn, level] of [[-9, -15.5, 0.1, 0], [-7.2, -15.2, -0.15, 0], [-8.2, -15.4, 0.3, 1], [12, -15.6, 0.5, 0], [14.2, -16, -0.2, 0], [-18, -15, 0.2, 0]]) {
      builder.box(1.7, 1.2, 1.3, tones[Math.abs(Math.round(x)) % 3], { pos: [x, site.ground(x, z) + 0.5 + level * 1.2, z], rot: [0, turn, 0], kind: KIND.STONE });
    }
    if (!detail) return;
    // A tip cart on its rails along the middle bench.
    const bench = floor[1][1];
    for (const z of [-5.6, -4.6]) builder.beam([-18, bench + 0.08, z], [-6, bench + 0.08, z], 0.04, PAL.rust, { kind: KIND.METAL }, 4);
    builder.box(1.6, 0.8, 1.3, PAL.rust, { pos: [-11, bench + 0.75, -5.1], rot: [0, 0, 0.06], kind: KIND.METAL });
    for (const x of [-11.5, -10.5]) builder.cyl(0.22, 0.22, 1.2, PAL.iron, { pos: [x, bench + 0.28, -5.1], rot: [Math.PI / 2, 0, 0], kind: KIND.METAL }, 8);
    ladder(builder, [14, floor[0][4] - 0.2, -6.6], [14, floor[1][4] + 0.4, -6.4], [1, 0, 0], 0.5, PAL.woodDark, 0.4, 0.03);
  },

  /** The lookout: a steel lattice tower with stairs up through it, a white cab with glass all round, a red roof. */
  fire_tower: (builder, detail) => {
    const steel = '#66727a';
    const height = 22;
    lattice(builder, height, 2.3, 1.25, detail ? 8 : 4, steel, 0.1);
    for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) builder.box(0.9, 1, 0.9, TONE.concrete, { pos: [sideX * 2.3, 0, sideZ * 2.3], kind: KIND.STONE });
    builder.box(3.8, 0.16, 3.8, PAL.wood, { pos: [0, height + 0.08, 0], kind: KIND.WOOD });
    builder.box(2.7, 2.3, 2.7, TONE.whitewash, { pos: [0, height + 1.3, 0], kind: KIND.SIDING, seed: 0.35 });
    builder.cone(2.5, 1.4, PAL.rust, { pos: [0, height + 3.15, 0], rot: [0, Math.PI / 4, 0], kind: KIND.SHINGLE }, 4);
    for (const [x, z, turn] of [[0, -1.37, Math.PI], [0, 1.37, 0], [-1.37, 0, -Math.PI / 2], [1.37, 0, Math.PI / 2]] as const) {
      pane(builder, [x, height + 1.55, z], 2.1, 0.95, turn, { frame: detail ? TONE.trim : null, bars: false });
    }
    builder.beam([0, height + 3.8, 0], [0, height + 4.5, 0], 0.03, PAL.iron, PEN, 4);
    if (!detail) return;
    for (let flight = 0; flight < 8; flight += 1) {
      const side = flight % 2 ? 1 : -1;
      const low = (flight / 8) * height;
      const high = ((flight + 1) / 8) * height;
      const reach = (y: number): number => (2.3 + (1.25 - 2.3) * (y / height)) * 0.82;
      builder.plank([-side * reach(low), low, -reach(low) * 0.5], [side * reach(high), high, -reach(high) * 0.5], 0.55, 0.05, PAL.woodLight, PEN);
    }
    for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) builder.beam([sideX * 1.85, height, sideZ * 1.85], [sideX * 1.85, height + 1.05, sideZ * 1.85], 0.03, steel, PEN, 4);
    for (const [fromX, fromZ, toX, toZ] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
      builder.beam([fromX * 1.85, height + 1.05, fromZ * 1.85], [toX * 1.85, height + 1.05, toZ * 1.85], 0.025, steel, PEN, 4);
      builder.beam([fromX * 1.85, height + 0.55, fromZ * 1.85], [toX * 1.85, height + 0.55, toZ * 1.85], 0.018, steel, PEN, 4);
    }
    builder.box(0.9, 0.6, 0.05, PAL.cream, { pos: [0, 2.6, -2.2], rot: [0.05, 0, 0], kind: KIND.PAINT });
    builder.stencil('TOWER 9', [0.4, 2.5, -2.24], [-1, 0, 0], [0, 1, 0], 0.16, PAL.rustDark);
  },

  /**
   * The dam's crest, fitted to the rules' ground from end to end: a parapet on each edge, buttresses down the
   * south face, and in the middle the spillway's gate piers under their hoist bridge.
   */
  dam_wall: (builder, detail) => {
    const site = siteOf('dam_wall');
    const crest = (z: number): number => site.ground(0, z);
    const step = detail ? 10 : 20;
    for (let z = -DAM_HALF; z < DAM_HALF; z += step) {
      for (const side of [-1, 1]) {
        builder.plank([side * 4.6, crest(z) + 0.45, z], [side * 4.6, crest(z + step) + 0.45, z + step], 0.5, 1.3, TONE.concrete, { kind: KIND.STONE });
        if (detail) builder.plank([side * 4.6, crest(z) + 1.14, z], [side * 4.6, crest(z + step) + 1.14, z + step - 0.3], 0.72, 0.16, TONE.concretePale, { kind: KIND.STONE });
      }
    }
    for (let z = -DAM_HALF + 10; z <= DAM_HALF - 10; z += 20) {
      if (Math.abs(z) < 36) continue;
      const low = Math.max(site.water - 1.5, site.ground(11.5, z) - 0.6);
      const high = crest(z) + 0.2;
      builder.box(Math.hypot(7, high - low) + 1, 1.8, 2.2, TONE.concreteDark, { pos: [8.2, (high + low) / 2 - 0.4, z], rot: [0, 0, -Math.atan2(high - low, 7)], kind: KIND.STONE });
    }
    // The spillway: seven piers, six gates, the hoist bridge across their heads.
    const deck = crest(0) + 5;
    for (let pier = -3; pier <= 3; pier += 1) {
      const z = pier * 10;
      builder.box(5.4, deck - site.water + 2, 1.5, TONE.concretePale, { pos: [6, (deck + site.water - 2) / 2, z], kind: KIND.STONE });
      if (pier === 3) break;
      builder.box(0.35, 4.6, 8.5, '#6f7d84', { pos: [7.4, crest(z + 5) - 1.9, z + 5], kind: KIND.METAL, axis: 1 });
      builder.box(1.5, 1.3, 2.4, TONE.steelPale, { pos: [6, deck + 0.95, z + 5], kind: KIND.METAL });
    }
    builder.box(2.6, 0.5, 63, TONE.concreteDark, { pos: [6, deck + 0.05, 0], kind: KIND.STONE });
    if (!detail) return;
    for (let gate = -3; gate < 3; gate += 1) {
      const z = gate * 10 + 5;
      builder.torus(0.5, 0.05, PAL.rust, { pos: [6, deck + 2.1, z], rot: [0, Math.PI / 2, 0], kind: KIND.METAL }, 12);
      builder.beam([6, deck + 1.6, z], [6, deck + 2.1, z], 0.05, PAL.iron, PEN, 4);
      for (const [shift, long] of [[-2.5, 2.2], [0.5, 1.4], [2.8, 2.8]]) builder.box(0.02, long, 0.5, PAL.rustLight, { pos: [7.59, crest(z) + 0.2 - long / 2, z + shift], flat: true, kind: KIND.PLAIN });
    }
    for (const side of [-1, 1]) {
      builder.beam([6 + side * 1.2, deck + 1.3, -31], [6 + side * 1.2, deck + 1.3, 31], 0.03, PAL.iron, PEN, 4);
      for (let z = -30; z <= 30; z += 5) builder.beam([6 + side * 1.2, deck + 0.3, z], [6 + side * 1.2, deck + 1.3, z], 0.025, PAL.iron, PEN, 4);
    }
    ladder(builder, [4.2, crest(-31.2), -31.2], [4.9, deck + 0.3, -31.2], [0, 0, 1], 0.5, PAL.iron, 0.35, 0.025);
    // Lamp standards along the north parapet, and a warning at each end of the spillway.
    for (let z = -120; z <= 120; z += 40) {
      builder.beam([-4.6, crest(z) + 1.1, z], [-4.6, crest(z) + 4.6, z], 0.05, PAL.iron, PEN, 4);
      builder.beam([-4.6, crest(z) + 4.6, z], [-3.6, crest(z) + 4.75, z], 0.035, PAL.iron, PEN, 4);
      builder.box(0.5, 0.14, 0.24, PAL.iron, { pos: [-3.4, crest(z) + 4.7, z], kind: KIND.METAL });
    }
    for (const z of [-38, 38]) {
      builder.box(0.06, 0.8, 2.4, PAL.ochre, { pos: [4.3, crest(z) + 1.75, z], kind: KIND.PAINT });
      builder.stencil('DANGER', [4.26, crest(z) + 1.6, z - 0.95], [0, 0, 1], [0, 1, 0], 0.3, PAL.ink);
    }
  },

  /** The gate house: a control cabin up on four concrete legs, glass all round, the hoist wheel on its roof. What it houses stands under it. */
  gatehouse: (builder, detail) => {
    for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) builder.box(0.8, 4.6, 0.8, TONE.concrete, { pos: [sideX * 2.1, 1.5, sideZ * 2.1], kind: KIND.STONE });
    builder.box(5.6, 0.4, 5.6, TONE.concreteDark, { pos: [0, 3.95, 0], kind: KIND.STONE });
    builder.box(4.8, 2.8, 4.8, TONE.concretePale, { pos: [0, 5.55, 0], kind: KIND.STONE });
    builder.box(5.9, 0.3, 5.9, TONE.concreteDark, { pos: [0, 7.1, 0], kind: KIND.STONE });
    for (const [x, z, turn] of [[0, -2.43, Math.PI], [0, 2.43, 0], [-2.43, 0, -Math.PI / 2], [2.43, 0, Math.PI / 2]] as const) {
      pane(builder, [x, 5.9, z], 3.4, 1.1, turn, { frame: detail ? STEEL : null, bars: false });
    }
    builder.torus(0.7, 0.07, PAL.rust, { pos: [0, 8.1, 0], rot: [0, 0.4, 0], kind: KIND.METAL }, 14);
    builder.box(1.2, 0.5, 0.8, TONE.steelPale, { pos: [0, 7.5, 0], rot: [0, 0.4, 0], kind: KIND.METAL });
    if (!detail) return;
    builder.stencil('GATE 1', [1.1, 4.6, -2.44], [-1, 0, 0], [0, 1, 0], 0.4, PAL.rustDark);
    ladder(builder, [1.9, -0.3, -2.95], [1.9, 4.2, -2.95], [1, 0, 0], 0.5, PAL.iron, 0.35, 0.025);
    builder.box(1.2, 0.08, 0.6, PAL.iron, { pos: [1.9, 4.2, -3.1], kind: KIND.METAL });
    builder.box(0.9, 1.9, 0.08, '#55656f', { pos: [1.9, 5.15, -2.44], kind: KIND.METAL });
    for (const x of [-2.1, 2.1]) builder.box(0.02, 1.6, 0.4, PAL.rustLight, { pos: [x * 1.195, 2.6, 2.1], flat: true, kind: KIND.PLAIN });
    for (const side of [-1, 1]) builder.beam([side * 0.5, 7.25, 0.2], [0, 8.1, 0], 0.03, PAL.iron, PEN, 4);
  },

  /**
   * The radio tower: a guyed lattice mast in red and white bands, two decks of aerials, and at its head
   * the lamp house, dark until the Beacon is lit. Its foot is open: the lamp's works stand in it.
   */
  radio_tower: (builder, detail) => {
    const bands = [TONE.towerRed, TONE.towerRed, PAL.cream, PAL.cream];
    lattice(builder, 30, 1.6, 0.45, detail ? 16 : 8, detail ? bands : [TONE.towerRed, PAL.cream], 0.09);
    for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) builder.box(0.9, 1.2, 0.9, TONE.concrete, { pos: [sideX * 1.6, 0, sideZ * 1.6], kind: KIND.STONE });
    const anchors: Triple[] = [[15, -0.6, 0], [-7.5, -0.6, 13], [-7.5, -0.6, -13]];
    for (const anchor of anchors) {
      for (const y of [19, 29]) builder.beam([0, y, 0], anchor, 0.03, '#5d666c', PEN, 4);
      builder.box(1.2, 1.2, 1.2, TONE.concrete, { pos: anchor, kind: KIND.STONE });
    }
    for (const y of [12, 22]) {
      const half = 1.6 + (0.45 - 1.6) * (y / 30) + 0.5;
      builder.box(half * 2, 0.12, half * 2, PAL.iron, { pos: [0, y, 0], kind: KIND.METAL });
    }
    builder.cyl(0.95, 0.95, 0.14, PAL.cream, { pos: [0, 23.4, -1.25], rot: [Math.PI / 2, 0, 0], kind: KIND.PAINT }, 12);
    builder.cyl(0.7, 0.7, 0.14, PAL.cream, { pos: [1.35, 13.3, 0.2], rot: [0, 0, Math.PI / 2], kind: KIND.PAINT }, 12);
    // The lamp house.
    builder.cyl(1.15, 1.15, 0.14, PAL.iron, { pos: [0, 30.05, 0], kind: KIND.METAL }, 10);
    builder.cyl(0.55, 0.6, 1.1, '#aebbb9', { pos: [0, 30.7, 0], flat: true, kind: KIND.PLAIN }, 10);
    builder.cone(0.85, 0.65, PAL.iron, { pos: [0, 31.55, 0], kind: KIND.METAL }, 10);
    builder.beam([0, 31.8, 0], [0, 32.6, 0], 0.03, PAL.iron, PEN, 4);
    if (!detail) return;
    for (let bar = 0; bar < 6; bar += 1) {
      const angle = (bar / 6) * Math.PI * 2;
      builder.beam([Math.cos(angle) * 0.6, 30.12, Math.sin(angle) * 0.6], [Math.cos(angle) * 0.57, 31.25, Math.sin(angle) * 0.57], 0.018, PAL.iron, PEN, 4);
      builder.beam([Math.cos(angle) * 1.1, 30.12, Math.sin(angle) * 1.1], [Math.cos(angle) * 1.1, 30.9, Math.sin(angle) * 1.1], 0.016, PAL.iron, PEN, 4);
    }
    for (const y of [25.5, 27, 28.5]) {
      builder.beam([-1.5, y, 0], [1.5, y, 0], 0.025, PAL.iron, PEN, 4);
      for (const x of [-1.5, 1.5]) builder.beam([x, y - 0.5, 0], [x, y + 0.5, 0], 0.025, PAL.iron, PEN, 4);
    }
    ladder(builder, [0, 0.4, -1.62], [0, 30, -0.47], [1, 0, 0], 0.4, '#5d666c', 0.5, 0.02);
    builder.box(0.8, 0.5, 0.05, PAL.cream, { pos: [0, 2.4, -1.6], rot: [-0.04, 0, 0], kind: KIND.PAINT });
    builder.stencil('CKVB', [0.33, 2.3, -1.64], [-1, 0, 0], [0, 1, 0], 0.2, PAL.rustDark);
  },

  /** The keeper's hut: plank walls on a stone footing let into the slope, a mossed roof, a porch on stilts, one window still lit. */
  keeper_hut: (builder, detail) => {
    builder.box(4.3, 3, 4.3, '#a09a96', { pos: [0, -1.35, 0], kind: KIND.STONE });
    builder.box(4, 2.5, 4, TONE.board, { pos: [0, 1.35, 0], kind: KIND.SIDING, seed: 0.3 });
    gable(builder, 4, 4, 2.6, 1.3, TONE.shingle, { overhang: 0.35 });
    for (const end of [-1.92, 1.92]) gableEnd(builder, 4, 2.6, 1.3, end, TONE.boardDark, { kind: KIND.SIDING, courses: detail ? 3 : 1 });
    pane(builder, [0.9, 1.6, 2.03], 0.85, 0.75, 0, { glass: PAL.glow, glow: 0.6, frame: detail ? TONE.trim : null });
    builder.box(3.2, 0.12, 1.3, PAL.driftwood, { pos: [0, 0.14, 2.65], kind: KIND.DRIFT, axis: 0 });
    for (const x of [-1.5, 1.5]) builder.beam([x, -2.6, 3.2], [x, 0.1, 3.2], 0.07, PAL.woodDark, { kind: KIND.BARK }, 6);
    builder.cyl(0.11, 0.11, 1.4, PAL.rust, { pos: [1.2, 3.6, -0.8], kind: KIND.METAL }, 8);
    builder.cone(0.2, 0.16, PAL.rustDark, { pos: [1.2, 4.38, -0.8], kind: KIND.METAL }, 8);
    if (!detail) return;
    builder.box(0.9, 1.85, 0.1, TONE.door, { pos: [-0.8, 1.05, 2.03], kind: KIND.WOOD });
    builder.box(0.9, 0.05, 1, PAL.moss, { pos: [-1.1, 3.38, 0.6], rot: [0, 0.2, 0.575], kind: KIND.PLAIN });
    builder.box(0.6, 0.05, 0.8, PAL.mossDeep, { pos: [1.3, 3.25, 1], rot: [0, -0.2, -0.575], kind: KIND.PLAIN });
    for (let step = 0; step < 4; step += 1) builder.box(1, 0.08, 0.3, PAL.driftwood, { pos: [-0.8, -0.1 - step * 0.32, 3.45 + step * 0.32], kind: KIND.DRIFT, axis: 0 });
    for (const x of [-1.5, 1.5]) builder.beam([x, 0.2, 3.25], [x, 1.1, 3.25], 0.03, PAL.woodDark, PEN, 4);
    builder.beam([-1.5, 1.1, 3.25], [1.5, 1.1, 3.25], 0.03, PAL.woodDark, PEN, 4);
    // Split wood under the eave, an aerial on the ridge, a lantern by the door.
    for (let log = 0; log < 9; log += 1) builder.beam([-2.12, 0.25 + Math.floor(log / 3) * 0.2, -1.2 + (log % 3) * 0.22], [-2.6, 0.25 + Math.floor(log / 3) * 0.2, -1.2 + (log % 3) * 0.22], 0.1, log % 2 ? PAL.woodLight : PAL.wood, { r2: 0.1, kind: KIND.WOOD }, 6);
    builder.beam([0, 3.9, 1.6], [0, 6.4, 1.6], 0.02, PAL.iron, PEN, 4);
    builder.beam([0, 6.3, 1.6], [0, 3.95, -1.9], 0.008, PAL.iron, PEN, 4);
    builder.cyl(0.07, 0.07, 0.16, PAL.glow, { pos: [-0.15, 1.9, 2.12], glow: 0.7, flat: true, kind: KIND.PLAIN }, 7);
  },
};
