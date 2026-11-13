/**
 * The two outriggers and the four stations that stand on their decks:
 * workbench and smoker to port, planter and forge to starboard.
 *
 * The layout comes from the crew. Paddles and arms sweep the water beside
 * every seat, so each spar crosses a gunwale in a gap between two paddlers,
 * and the deck starts a paddle's width out from the hull: a well of open
 * water runs between hull and deck.
 */
import { ATTACHMENTS } from '../../data/index.ts';
import { seatTransformForHull } from '../../sim/index.ts';
import {
  BAMBOO, BERRY, BOLT, BRASS, CLAY, CLAY_DARK, EMBER, FISH, IRON, KIND, LEATHER, PAL, RIG, ROPE, SOOT, STEEL, THIN, WATER,
  hullOf, lashing, line, only, partBuilder, plate,
} from './kit.ts';
import type { AttachmentBuilder, AttachmentContext, Triple } from './kit.ts';

/**
 * The deck: how far it runs fore and aft of the mount, the well between hull and deck, the nearest its inner edge
 * comes to the centreline, and the float's share of the outer edge.
 */
export const DECK = { halfLength: 1.0, well: 0.31, inner: 0.835, kerb: 0.28 };

/**
 * Where a deck's inner edge is, out from the centreline. A paddle's width out from the hull, and never nearer than
 * `DECK.inner`: a kneeler's paddle laid across the gunwales has to lie between the two decks, on the narrow hull too.
 */
export const deckInner = (halfBeam: number): number => Math.max(halfBeam + DECK.well, DECK.inner);

/** Where an outrigger's aft spar crosses the gunwale: between the aft kneeler's back and the stern paddler's reach. */
function aftSpar(hullTier: number): number {
  const seat = (number: number): number => seatTransformForHull(hullTier, number).position[2];
  return (seat(2) + 0.22 + seat(0) - 0.77) / 2;
}

/** How far a deck runs along the hull, in canoe space: its forward edge, and its aft one, which reaches the aft spar. */
export function deckSpan(hullTier: number): { forward: number; aft: number } {
  return { forward: -DECK.halfLength, aft: Math.max(DECK.halfLength, aftSpar(hullTier) + 0.07) };
}

/** Where an outrigger's two spars cross the gunwale: each in a gap between two paddlers. */
export function sparStations(context: AttachmentContext, side: -1 | 1): { forward: number; aft: number } {
  const hull = hullOf(context);
  // The forward one crosses the whole hull beside the thwart; port's and starboard's lie side by side.
  const forward = (hull.seat(3) + 0.22 + hull.seat(2) - 0.63) / 2 - 0.045 + side * 0.055;
  return { forward, aft: aftSpar(context.hullTier) };
}

/** Both sides' spars along the hull, in canoe space: the forward pair's two places (port's and starboard's), and the aft one. */
export function sparsAlong(hullTier: number): number[] {
  const seat = (number: number): number => seatTransformForHull(hullTier, number).position[2];
  const forward = (seat(3) + 0.22 + seat(2) - 0.63) / 2 - 0.045;
  return [forward - 0.055, forward + 0.055, aftSpar(hullTier)];
}

export function outriggerPart(side: -1 | 1): AttachmentBuilder {
  return (context) => {
    const b = partBuilder(context, side < 0 ? 101 : 117);
    const hull = hullOf(context);
    const floatX = Math.abs(context.mount[0]);
    const deckY = ATTACHMENTS.workbench.transform.position[1];
    const sparY = deckY - 0.08;
    const inner = deckInner(context.halfBeam);
    const outer = floatX - DECK.kerb;
    const { forward, aft } = sparStations(context, side);
    const floatY = side < 0 ? 0.02 : 0.06;
    const floatRadius = side < 0 ? 0.2 : 0.27;
    const floatZ = 0.15;

    // the two spars, lashed down where they cross the rail
    const crossing = (z: number, railSide: number): void => {
      const x = railSide * hull.halfBeam(z);
      b.box(0.11, 0.08, 0.15, PAL.wood, { pos: [x, hull.gunwale(z) + 0.005, z] });
      lashing(b, x, sparY, z, 0.064);
      b.bolt(x, sparY + 0.05, z, BOLT, 0.022);
    };
    b.beam([-side * (hull.halfBeam(forward) + 0.08), sparY, forward], [side * (floatX + 0.14), sparY, forward], 0.045, PAL.woodDark, {}, 7);
    crossing(forward, 1);
    crossing(forward, -1);
    b.beam([side * (hull.halfBeam(aft) - 0.05), sparY, aft], [side * (floatX + 0.14), sparY, aft], 0.045, PAL.woodDark, {}, 7);
    crossing(aft, side);
    for (const z of [forward, aft]) {
      // a post down to the float, cross-lashed, and a strop round the float
      b.beam([side * floatX, sparY, z], [side * floatX, floatY + floatRadius * 0.5, z], 0.036, PAL.woodDark, {}, 6);
      for (const turn of [-1, 1]) b.beam([side * floatX - 0.06, sparY - 0.07, z + turn * 0.045], [side * floatX + 0.06, sparY + 0.07, z - turn * 0.045], 0.012, ROPE, { id: 0.71, kind: KIND.ROPE }, 5);
      b.torus(floatRadius + 0.028, 0.017, ROPE, { pos: [side * floatX, floatY, z], id: 0.71, kind: KIND.ROPE }, 12);
    }

    // two stringers ride on the spars and carry the deck planks, which run athwart
    const end = deckSpan(context.hullTier).aft;
    for (const x of [inner + 0.035, outer - 0.035]) b.beam([side * x, sparY, -DECK.halfLength], [side * x, sparY, end], 0.034, PAL.wood, {}, 6);
    const tones = [PAL.wood, PAL.woodLight, '#bfa27a', '#c4b89f', PAL.wood, '#a98658', PAL.woodLight, '#b7a88c', '#c9ad80', PAL.wood];
    const count = 10;
    const pitch = (DECK.halfLength * 2) / count;
    for (let plank = 0; plank < count; plank += 1) {
      const z = -DECK.halfLength + (plank + 0.5) * pitch;
      const x0 = inner - 0.02 - b.rand() * 0.03;
      const x1 = outer + 0.01;
      b.box(x1 - x0, 0.035, pitch - 0.012, tones[(plank + (side > 0 ? 3 : 0)) % tones.length], {
        pos: [side * ((x0 + x1) / 2), deckY - 0.0175, z], rot: [0, (b.rand() - 0.5) * 0.012, 0], kind: KIND.WOOD, axis: 0,
      });
      for (const x of [inner + 0.035, outer - 0.035]) for (const offset of [-0.05, 0.05]) b.tack(side * x, deckY + 0.002, z + offset, 0.009);
    }
    b.box(0.05, 0.085, DECK.halfLength * 2 + 0.04, PAL.woodDark, { pos: [side * (outer + 0.035), deckY - 0.012, 0] });
    for (const z of [-0.8, -0.27, 0.27, 0.8]) b.bolt(side * (outer + 0.035), deckY + 0.034, z, BOLT, 0.018);

    if (side < 0) {
      // port: a hollowed log, banded in tin
      const log = '#8d6d4d';
      b.cyl(floatRadius, floatRadius, 2.6, log, { pos: [side * floatX, floatY, floatZ], rot: [Math.PI / 2, 0, 0], kind: KIND.BARK }, 10);
      b.cone(floatRadius, 0.5, log, { pos: [side * floatX, floatY, floatZ + 1.55], rot: [Math.PI / 2, 0, 0], kind: KIND.BARK }, 10);
      b.cone(floatRadius, 0.5, log, { pos: [side * floatX, floatY, floatZ - 1.55], rot: [-Math.PI / 2, 0, 0], kind: KIND.BARK }, 10);
      for (const z of [-0.75, 0.75]) b.cyl(floatRadius + 0.008, floatRadius + 0.008, 0.08, PAL.tin, { pos: [side * floatX, floatY, floatZ + z], rot: [Math.PI / 2, 0, 0], kind: KIND.METAL }, 10);
    } else {
      // starboard: three fuel drums end to end
      for (const z of [-1.12, 0, 1.12]) {
        b.cyl(floatRadius, floatRadius, 1.08, PAL.barrelBlue, { pos: [side * floatX, floatY, floatZ + z], rot: [Math.PI / 2, 0, 0], kind: KIND.METAL }, 12);
        for (const rim of [-0.36, 0.36]) b.cyl(floatRadius + 0.01, floatRadius + 0.01, 0.05, '#476579', { pos: [side * floatX, floatY, floatZ + z + rim], rot: [Math.PI / 2, 0, 0], kind: KIND.METAL }, 12);
      }
      b.stencil('45', [side * floatX + 0.1, 0, floatZ + 1.12 + 0.545], [-1, 0, 0], [0, 1, 0], 0.15, '#e9e2cc');
    }
    return only(b.mesh());
  };
}

/** A station's own frame: its centre on the deck, the deck's height, and which way is outboard. */
function station(context: AttachmentContext): { x: number; y: number; z: number; out: number } {
  const [x, y, z] = context.mount;
  return { x, y, z, out: Math.sign(x) || 1 };
}

/** The workbench: vice, tool board, a plank half planed, the toolbox on the shelf under it. */
export const workbenchPart: AttachmentBuilder = (context) => {
  const b = partBuilder(context, 108);
  const { x, y, z, out } = station(context);
  const top = y + 0.62;
  b.box(0.44, 0.05, 0.68, PAL.woodLight, { pos: [x, top, z], kind: KIND.WOOD, axis: 2 });
  for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) {
    b.box(0.055, 0.6, 0.055, PAL.wood, { pos: [x + sideX * 0.18, y + 0.3, z + sideZ * 0.29] });
    plate(b, x + sideX * 0.18, y, z + sideZ * 0.29, 0.1, 0.1);
    b.tack(x + sideX * 0.18, top + 0.026, z + sideZ * 0.29, 0.011);
  }
  b.box(0.38, 0.025, 0.6, PAL.wood, { pos: [x, y + 0.2, z] });
  // toolbox on the shelf, a paint tin beside it
  b.box(0.26, 0.15, 0.22, PAL.rust, { pos: [x, y + 0.29, z + 0.13], kind: KIND.PAINT });
  b.box(0.12, 0.02, 0.03, IRON, { pos: [x, y + 0.375, z + 0.13] });
  b.stencil('TOOLS', [x - 0.1, y + 0.265, z + 0.242], [1, 0, 0], [0, 1, 0], 0.05, '#efe6cf');
  b.cyl(0.07, 0.07, 0.13, PAL.tin, { pos: [x, y + 0.28, z - 0.17], kind: KIND.METAL }, 8);
  // the tool board stands along the outboard edge: saw, mallet, chisels
  const board = x + out * 0.21;
  b.box(0.022, 0.3, 0.62, PAL.wood, { pos: [board, top + 0.175, z], kind: KIND.WOOD, axis: 2 });
  const face = board - out * 0.02;
  b.box(0.012, 0.11, 0.3, PAL.tin, { pos: [face, top + 0.2, z + 0.1], rot: [0.1, 0, 0], kind: KIND.METAL });
  b.box(0.03, 0.12, 0.1, PAL.woodDark, { pos: [face, top + 0.2, z + 0.28], rot: [0.1, 0, 0] });
  b.beam([face, top + 0.08, z - 0.12], [face, top + 0.28, z - 0.12], 0.012, PAL.woodDark, {}, 5);
  b.box(0.05, 0.07, 0.11, PAL.woodLight, { pos: [face, top + 0.28, z - 0.12] });
  for (const chisel of [-0.22, -0.27]) {
    b.beam([face, top + 0.2, z + chisel], [face, top + 0.3, z + chisel], 0.012, PAL.ochre, {}, 5);
    b.beam([face, top + 0.08, z + chisel], [face, top + 0.2, z + chisel], 0.006, STEEL, { kind: KIND.METAL }, 4);
  }
  // the board's back, which is all that shows from outboard: two battens, a bow saw on its pegs, a coil of line
  const back = board + out * 0.018;
  for (const rise of [0.06, 0.29]) b.box(0.016, 0.034, 0.62, PAL.woodDark, { pos: [back - out * 0.004, top + rise, z] });
  const bow: Triple[] = [[back, top + 0.1, z - 0.25], [back, top + 0.235, z - 0.2], [back, top + 0.235, z + 0.02], [back, top + 0.1, z + 0.07]];
  for (let span = 0; span < 3; span += 1) b.beam(bow[span], bow[span + 1], 0.011, PAL.woodLight, {}, 5);
  b.beam([back, top + 0.11, z - 0.245], [back, top + 0.11, z + 0.065], 0.005, STEEL, { id: THIN, flat: true, kind: KIND.PLAIN }, 4);
  for (const peg of [-0.2, 0.02]) b.tack(back + out * 0.006, top + 0.25, z + peg, 0.011);
  for (let turn = 0; turn < 2; turn += 1) b.torus(0.062 - turn * 0.014, 0.011, ROPE, { pos: [back + out * (0.004 + turn * 0.008), top + 0.155, z + 0.2], rot: [0, Math.PI / 2, 0.3 * turn], kind: KIND.ROPE }, 12);
  b.tack(back + out * 0.012, top + 0.215, z + 0.2, 0.011);
  // vice on the forward end
  b.box(0.13, 0.1, 0.05, IRON, { pos: [x - out * 0.08, top + 0.075, z - 0.3], kind: KIND.METAL });
  b.box(0.13, 0.1, 0.04, '#5c5f6a', { pos: [x - out * 0.08, top + 0.075, z - 0.39], kind: KIND.METAL });
  b.beam([x - out * 0.08, top + 0.06, z - 0.27], [x - out * 0.08, top + 0.06, z - 0.5], 0.013, PAL.tin, { kind: KIND.METAL }, 5);
  b.beam([x - out * 0.16, top + 0.06, z - 0.5], [x, top + 0.06, z - 0.5], 0.008, PAL.tin, { kind: KIND.METAL }, 4);
  // a plank being worked, with curls of shaving, and the plane left on it
  b.box(0.15, 0.03, 0.56, '#d8c196', { pos: [x - out * 0.08, top + 0.04, z + 0.04], rot: [0, 0.1, 0], kind: KIND.WOOD, axis: 2 });
  b.box(0.06, 0.055, 0.17, PAL.woodDark, { pos: [x - out * 0.08, top + 0.083, z + 0.12], rot: [0, 0.1, 0] });
  b.box(0.02, 0.05, 0.03, PAL.woodLight, { pos: [x - out * 0.08, top + 0.13, z + 0.16], rot: [0.4, 0.1, 0] });
  for (const curl of [-0.1, -0.02]) b.torus(0.018, 0.005, '#e9d9b0', { pos: [x - out * 0.1, top + 0.07, z + curl], rot: [0, 1, 0.4], id: THIN, kind: KIND.PLAIN }, 7);
  // a coil of rope on the leg
  for (let turn = 0; turn < 2; turn += 1) b.torus(0.07 - turn * 0.012, 0.012, ROPE, { pos: [x - out * 0.215, y + 0.4, z + 0.29 - turn * 0.01], rot: [0, Math.PI / 2, 0.3 * turn], kind: KIND.ROPE }, 12);
  return only(b.mesh());
};

/** The smoker: a clay box on a stone footing, fish hung in the door and on the rack beside it. */
export const smokerPart: AttachmentBuilder = (context) => {
  const b = partBuilder(context, 112);
  const { x, y, z, out } = station(context);
  const fish = (fx: number, fy: number, fz: number, turn: number): void => {
    const id = b.sphere(0.075, FISH, { pos: [fx, fy, fz], scale: [0.26, 1, 0.62], rot: [0, turn, 0], flat: true }, 7);
    b.cone(0.035, 0.05, FISH, { pos: [fx, fy - 0.095, fz], scale: [0.4, 1, 1], rot: [0, turn, 0], id, flat: true }, 5);
  };
  // stone footing, two courses
  b.box(0.52, 0.07, 0.52, PAL.granite, { pos: [x, y + 0.035, z], kind: KIND.STONE });
  b.box(0.46, 0.07, 0.46, PAL.graniteDark, { pos: [x, y + 0.105, z], rot: [0, 0.05, 0], kind: KIND.STONE });
  // the clay box, daubed in two lifts, narrowing to the lid
  b.cyl(0.275, 0.3, 0.36, CLAY_DARK, { pos: [x, y + 0.32, z], rot: [0, Math.PI / 4, 0], kind: KIND.PLAIN }, 4);
  b.cyl(0.25, 0.275, 0.4, CLAY, { pos: [x, y + 0.7, z], rot: [0, Math.PI / 4, 0], kind: KIND.PLAIN }, 4);
  // fire mouth low on the aft face, the smoke door above it with fish on a rod
  b.box(0.16, 0.09, 0.03, SOOT, { pos: [x, y + 0.2, z + 0.205], flat: true, kind: KIND.PLAIN });
  b.box(0.11, 0.035, 0.034, EMBER, { pos: [x, y + 0.185, z + 0.206], glow: 1, flat: true });
  b.box(0.24, 0.34, 0.03, SOOT, { pos: [x, y + 0.66, z + 0.178], flat: true, kind: KIND.PLAIN });
  b.beam([x - 0.13, y + 0.8, z + 0.2], [x + 0.13, y + 0.8, z + 0.2], 0.009, BAMBOO, {}, 4);
  for (const offset of [-0.075, 0, 0.075]) fish(x + offset, y + 0.7, z + 0.2, 0);
  // plank door swung open on the inboard side
  b.box(0.03, 0.36, 0.24, PAL.wood, { pos: [x - out * 0.15, y + 0.66, z + 0.3], rot: [0, out * 0.5, 0], kind: KIND.WOOD, axis: 1 });
  // tin hat with a smoke hole
  b.cone(0.4, 0.2, PAL.tin, { pos: [x, y + 1.0, z], rot: [0, Math.PI / 4, 0], kind: KIND.METAL }, 4);
  b.cyl(0.04, 0.04, 0.2, IRON, { pos: [x, y + 1.14, z], kind: KIND.METAL }, 7);
  b.cone(0.08, 0.06, IRON, { pos: [x, y + 1.27, z], kind: KIND.METAL }, 7);
  // drying rack outboard: two poles, a rod, the day's fish
  const rack = x + out * 0.36;
  for (const end of [-0.24, 0.24]) {
    b.beam([rack, y, z + end], [rack, y + 0.98, z + end * 1.08], 0.02, BAMBOO, {}, 5);
    plate(b, rack, y, z + end, 0.08, 0.08);
  }
  b.beam([rack, y + 0.92, z - 0.3], [rack, y + 0.92, z + 0.3], 0.013, BAMBOO, {}, 5);
  for (const offset of [-0.18, -0.06, 0.06, 0.18]) {
    fish(rack, y + 0.8, z + offset, Math.PI / 2);
    b.beam([rack, y + 0.92, z + offset], [rack, y + 0.87, z + offset], 0.004, ROPE, { id: THIN, kind: KIND.PLAIN }, 4);
  }
  return only(b.mesh());
};

/** The planter: a box of earth with berry canes, root tops and a bean frame, and the can to water it. */
export const planterPart: AttachmentBuilder = (context) => {
  const b = partBuilder(context, 109);
  const { x, y, z, out } = station(context);
  const greens = [PAL.sage, '#7d9a72', PAL.moss, PAL.sageDeep];
  const tone = '#96714b';
  const [width, depth, height] = [0.46, 0.72, 0.22];
  for (const sideX of [-1, 1]) b.box(0.03, height, depth, tone, { pos: [x + sideX * (width / 2 - 0.015), y + height / 2, z], kind: KIND.WOOD, axis: 2 });
  for (const sideZ of [-1, 1]) b.box(width, height, 0.03, '#a17d55', { pos: [x, y + height / 2, z + sideZ * (depth / 2 - 0.015)], kind: KIND.WOOD, axis: 0 });
  b.box(width - 0.06, 0.03, depth - 0.06, '#5d4b3f', { pos: [x, y + height - 0.03, z], flat: true, kind: KIND.SOIL });
  for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) {
    b.box(0.05, height * 0.7, 0.05, IRON, { pos: [x + sideX * (width / 2), y + height * 0.4, z + sideZ * (depth / 2)], kind: KIND.METAL });
    b.bolt(x + sideX * (width / 2 + 0.028), y + height * 0.5, z + sideZ * (depth / 2), BOLT, 0.014, 'x');
  }
  const soil = y + height - 0.015;
  // berry canes at the forward end
  for (let cane = 0; cane < 3; cane += 1) {
    const [cx, cz] = [x + (cane - 1) * 0.12, z - 0.24 + (cane % 2) * 0.07];
    b.sphere(0.1, greens[cane], { pos: [cx, soil + 0.13, cz], scale: [1, 1.15, 1], kind: KIND.LEAF }, 7);
    b.sphere(0.075, greens[(cane + 1) % 4], { pos: [cx + 0.02, soil + 0.27, cz + 0.02], kind: KIND.LEAF }, 7);
    for (const [ox, oy, oz] of [[0.085, 0.12, 0.04], [-0.07, 0.2, -0.05], [0.05, 0.3, -0.05], [-0.03, 0.09, 0.09]]) {
      b.sphere(0.03, BERRY, { pos: [cx + ox, soil + oy, cz + oz], flat: true }, 6);
    }
  }
  // a row of root tops amidships, two roots showing their shoulders
  for (let top = 0; top < 6; top += 1) {
    const [cx, cz] = [x - 0.15 + top * 0.06, z + 0.02 + (top % 2) * 0.05];
    b.cone(0.04, 0.17 + (top % 3) * 0.03, greens[(top + 1) % 4], { pos: [cx, soil + 0.09, cz], kind: KIND.LEAF }, 6);
  }
  for (const root of [-0.09, 0.09]) b.sphere(0.03, PAL.ochre, { pos: [x + root, soil + 0.012, z + 0.1], flat: true }, 6);
  // a bean frame at the aft end: three canes tied at the top, a vine up them
  const apex: [number, number, number] = [x, soil + 0.72, z + 0.24];
  for (const [fx, fz] of [[-0.13, 0.15], [0.13, 0.15], [0, 0.32]]) b.beam([x + fx, soil, z + fz], apex, 0.009, BAMBOO, {}, 4);
  b.torus(0.02, 0.007, ROPE, { pos: apex, rot: [Math.PI / 2, 0, 0], id: 0.71, kind: KIND.ROPE }, 7);
  for (let leaf = 0; leaf < 5; leaf += 1) {
    const rise = 0.1 + leaf * 0.12;
    const swing = leaf * 2.1;
    const reach = 0.1 * (1 - rise / 0.8);
    b.sphere(0.055, greens[leaf % 4], { pos: [x + Math.cos(swing) * reach, soil + rise, z + 0.22 + Math.sin(swing) * reach], scale: [1, 0.8, 1], kind: KIND.LEAF }, 6);
  }
  // the watering can, on the deck at the inboard corner
  const can: [number, number, number] = [x - out * 0.14, y + 0.07, z + depth / 2 + 0.11];
  b.cyl(0.06, 0.065, 0.14, PAL.tin, { pos: can, kind: KIND.METAL }, 8);
  b.beam([can[0], can[1] + 0.02, can[2]], [can[0] + out * 0.16, can[1] + 0.1, can[2]], 0.014, PAL.tin, { kind: KIND.METAL }, 5);
  b.torus(0.045, 0.008, IRON, { pos: [can[0], can[1] + 0.09, can[2]], rot: [0, 0, 0], kind: KIND.METAL }, 8);
  return only(b.mesh());
};

/** The forge: a stone hearth under a tin hood, Tink's bellows, the anvil on its stump. */
export const forgePart: AttachmentBuilder = (context) => {
  const b = partBuilder(context, 119);
  const { x, y, z, out } = station(context);
  const hearth = z + 0.13;
  const rim = y + 0.46;
  // the hearth: two courses of stone, a clay lip, the coal bed
  b.box(0.46, 0.22, 0.46, PAL.granite, { pos: [x, y + 0.11, hearth], kind: KIND.STONE });
  b.box(0.42, 0.2, 0.42, PAL.graniteDark, { pos: [x, y + 0.32, hearth], rot: [0, 0.04, 0], kind: KIND.STONE });
  b.box(0.46, 0.05, 0.46, CLAY, { pos: [x, rim - 0.025, hearth], kind: KIND.PLAIN });
  b.box(0.32, 0.03, 0.32, SOOT, { pos: [x, rim + 0.005, hearth], flat: true, kind: KIND.PLAIN });
  b.sphere(0.07, PAL.glow, { pos: [x, rim + 0.02, hearth], scale: [1, 0.45, 1], glow: 1, flat: true }, 7);
  for (const [ox, oz] of [[0.09, 0.05], [-0.08, 0.07], [0.03, -0.1], [-0.09, -0.06], [0.1, -0.06]]) {
    b.sphere(0.035, EMBER, { pos: [x + ox, rim + 0.02, hearth + oz], scale: [1, 0.6, 1], glow: 0.9, flat: true }, 6);
  }
  b.box(0.14, 0.1, 0.02, SOOT, { pos: [x, y + 0.14, hearth - 0.232], flat: true, kind: KIND.PLAIN }); // ash door
  // tin hood on four iron legs, and a short flue
  for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) b.beam([x + sideX * 0.2, rim, hearth + sideZ * 0.2], [x + sideX * 0.24, rim + 0.42, hearth + sideZ * 0.24], 0.012, IRON, { kind: KIND.METAL }, 4);
  b.cone(0.38, 0.26, PAL.tin, { pos: [x, rim + 0.54, hearth], rot: [0, Math.PI / 4, 0], kind: KIND.METAL }, 4);
  b.cyl(0.055, 0.055, 0.3, '#5c5f6a', { pos: [x, rim + 0.78, hearth], kind: KIND.METAL }, 8);
  b.cone(0.1, 0.07, IRON, { pos: [x, rim + 0.96, hearth], kind: KIND.METAL }, 8);
  for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) b.tack(x + sideX * 0.17, rim + 0.45, hearth + sideZ * 0.17, 0.01, '#6f7678');
  // the bellows, outboard: two boards, a leather bag between them, the nozzle let into the hearth, a lever to pump it
  const bx = x + out * 0.4;
  const by = y + 0.36;
  b.box(0.05, 0.36, 0.05, PAL.wood, { pos: [bx + out * 0.07, y + 0.18, hearth] });
  plate(b, bx + out * 0.07, y, hearth, 0.1, 0.1);
  b.box(0.3, 0.02, 0.2, PAL.woodDark, { pos: [bx, by - 0.055, hearth], rot: [0, 0, out * 0.12] });
  b.box(0.3, 0.02, 0.2, PAL.woodDark, { pos: [bx, by + 0.085, hearth], rot: [0, 0, -out * 0.2] });
  for (let fold = 0; fold < 3; fold += 1) b.sphere(0.1, LEATHER, { pos: [bx + out * 0.02, by - 0.02 + fold * 0.037, hearth], scale: [1.25, 0.28, 0.95], kind: KIND.PLAIN }, 8);
  b.cone(0.035, 0.16, IRON, { pos: [bx - out * 0.19, by - 0.02, hearth], rot: [0, 0, out * (Math.PI / 2)], kind: KIND.METAL }, 6);
  b.beam([bx + out * 0.13, by + 0.1, hearth], [bx + out * 0.2, by + 0.36, hearth - 0.05], 0.014, PAL.woodLight, {}, 5);
  for (const tackZ of [-0.07, 0, 0.07]) b.tack(bx + out * 0.12, by + 0.1, hearth + tackZ, 0.008, BRASS);
  // the anvil on a stump, forward of the hearth; a hammer on it, tongs in the fire, a quench pail
  const stump = z - 0.26;
  b.cyl(0.085, 0.1, 0.34, '#8d6d4d', { pos: [x, y + 0.17, stump], kind: KIND.BARK }, 9);
  b.cyl(0.1, 0.1, 0.015, PAL.woodLight, { pos: [x, y + 0.345, stump], kind: KIND.PLAIN }, 9);
  const anvil = b.box(0.07, 0.035, 0.13, IRON, { pos: [x, y + 0.37, stump], kind: KIND.METAL });
  b.box(0.045, 0.05, 0.08, IRON, { pos: [x, y + 0.41, stump], id: anvil, kind: KIND.METAL });
  b.box(0.08, 0.04, 0.2, IRON, { pos: [x, y + 0.455, stump + 0.01], id: anvil, kind: KIND.METAL });
  b.cone(0.03, 0.1, IRON, { pos: [x, y + 0.455, stump - 0.135], rot: [-Math.PI / 2, 0, 0], id: anvil, kind: KIND.METAL }, 6);
  b.beam([x - 0.05, y + 0.49, stump + 0.08], [x + 0.12, y + 0.49, stump - 0.04], 0.011, PAL.woodLight, {}, 5);
  b.box(0.04, 0.04, 0.09, STEEL, { pos: [x - 0.05, y + 0.49, stump + 0.08], rot: [0, 0.95, 0], kind: KIND.METAL });
  for (const jaw of [-0.012, 0.012]) b.beam([x - out * 0.02 + jaw, rim + 0.03, hearth - 0.04], [x - out * 0.3 + jaw * 3, rim + 0.1, hearth - 0.28], 0.007, IRON, { id: THIN, kind: KIND.PLAIN }, 4);
  const pail: [number, number, number] = [x - out * 0.17, y + 0.08, stump - 0.02];
  b.cyl(0.07, 0.06, 0.16, PAL.tin, { pos: pail, kind: KIND.METAL }, 9);
  b.cyl(0.062, 0.062, 0.01, WATER, { pos: [pail[0], pail[1] + 0.07, pail[2]], flat: true }, 9);
  line(b, [[pail[0] - 0.07, pail[1] + 0.07, pail[2]], [pail[0], pail[1] + 0.15, pail[2]], [pail[0] + 0.07, pail[1] + 0.07, pail[2]]], 0.005, RIG);
  return only(b.mesh());
};
