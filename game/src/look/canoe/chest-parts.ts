/**
 * The three chests: more room for cargo, each dearer than the last.
 *
 * Inside the hull there is no room left: the crew, the cargo rack, the mast and the map table have it all. So
 * the first two stand on the outrigger decks, each in the gap between that deck's two stations, and the third
 * lies across the thwart of the long hull, the only hull with room between its two kneelers.
 *
 * They are told apart by what they are made of, which is what shows from astern: bare planks under a rope, tin
 * with a rounded lid and red bands, blue paint bound in iron.
 */
import {
  BOLT, BRASS, IRON, KIND, LEATHER, PAL, ROPE, SOOT, STEEL,
  hullOf, line, only, partBuilder,
} from './kit.ts';
import type { AttachmentBuilder, Triple } from './kit.ts';

/** The plank chest: length athwart, depth fore and aft, height of its sides. */
export const PLANK_CHEST = { length: 0.56, depth: 0.36, height: 0.26 };
/** The tin trunk: width athwart, length fore and aft, height of its sides, and how high its lid rounds over them. */
export const TIN_TRUNK = { width: 0.36, length: 0.4, height: 0.2, crown: 0.1 };
/** The sea chest: length athwart, depth fore and aft, height of its sides, and how far aft of the thwart its own bearer lies. */
export const SEA_CHEST = { length: 0.72, depth: 0.28, height: 0.2, bearer: 0.21 };
/** Where the hull's own thwart is, along the hull (b2/canoe.js lays it a hand forward of the middle). */
const THWART = -0.1;

/**
 * The plank chest, on the port deck between the workbench and the smoker: bare boards on two skids, rope
 * handles, a tarp folded on its lid and a rope over the lot down to two rings in the deck.
 */
export const plankChestPart: AttachmentBuilder = (context) => {
  const b = partBuilder(context, 131);
  const [x, y, z] = context.mount;
  const { length, depth, height } = PLANK_CHEST;
  const base = y + 0.03;
  const top = base + height;
  const [fore, aft] = [z - depth / 2, z + depth / 2];
  for (const side of [-1, 1]) b.box(0.05, 0.03, depth + 0.05, PAL.woodDark, { pos: [x + side * 0.2, y + 0.015, z] });
  // the dark inside, so no gap between two boards shows the deck through it
  b.box(length - 0.03, height - 0.02, depth - 0.03, PAL.woodDark, { pos: [x, base + height / 2, z], flat: true });
  // three boards a side, no two the same tone
  const tones = [PAL.wood, PAL.woodLight, '#bfa27a', '#a98658', '#c9ad80', PAL.wood];
  const board = height / 3;
  for (let course = 0; course < 3; course += 1) {
    const at = base + (course + 0.5) * board;
    for (const [end, shift] of [[fore, 0], [aft, 1]] as const) {
      b.box(length, board - 0.006, 0.022, tones[(course + shift) % tones.length], { pos: [x, at, end], kind: KIND.WOOD, axis: 0 });
    }
    for (const [side, shift] of [[-1, 2], [1, 3]] as const) {
      b.box(0.022, board - 0.006, depth - 0.044, tones[(course + shift) % tones.length], { pos: [x + side * (length / 2 - 0.011), at, z], kind: KIND.WOOD, axis: 2 });
    }
  }
  // a post in each corner, nailed through every board
  for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) {
    b.box(0.04, height + 0.004, 0.04, PAL.woodDark, { pos: [x + sideX * (length / 2 - 0.008), base + height / 2, z + sideZ * (depth / 2 - 0.008)] });
    if (sideZ > 0) for (let course = 0; course < 3; course += 1) b.tack(x + sideX * (length / 2 - 0.06), base + (course + 0.5) * board, aft + 0.012, 0.008);
  }
  // the lid: four boards under two battens
  const lid = top + 0.017;
  for (let plank = 0; plank < 4; plank += 1) {
    const width = (depth + 0.04) / 4;
    b.box(length + 0.04, 0.03, width - 0.005, tones[(plank * 2 + 1) % tones.length], { pos: [x, lid, fore - 0.02 + (plank + 0.5) * width], kind: KIND.WOOD, axis: 0 });
  }
  for (const side of [-1, 1]) {
    b.box(0.05, 0.016, depth + 0.04, PAL.woodDark, { pos: [x + side * 0.19, lid + 0.023, z] });
    for (const end of [-0.13, 0, 0.13]) b.tack(x + side * 0.19, lid + 0.032, z + end, 0.008);
  }
  // an iron hasp and its staple on the aft face, and what is in it, stencilled
  b.box(0.045, 0.085, 0.012, IRON, { pos: [x + 0.19, top - 0.02, aft + 0.016], kind: KIND.METAL });
  b.torus(0.016, 0.006, STEEL, { pos: [x + 0.19, top - 0.05, aft + 0.026], rot: [0, Math.PI / 2, 0], kind: KIND.METAL }, 8);
  b.stencil('STORES', [x - 0.22, base + 0.095, aft + 0.014], [1, 0, 0], [0, 1, 0], 0.055, '#4a3a2c');
  // a rope handle at each end, through two holes
  for (const side of [-1, 1]) {
    const end = x + side * (length / 2 + 0.004);
    for (const hole of [-0.07, 0.07]) b.tack(end, base + 0.18, z + hole, 0.012, BOLT);
    line(b, [[end, base + 0.18, z - 0.07], [end + side * 0.04, base + 0.12, z - 0.04], [end + side * 0.045, base + 0.1, z], [end + side * 0.04, base + 0.12, z + 0.04], [end, base + 0.18, z + 0.07]], 0.011);
  }
  // a tarp folded on the lid, and the rope that holds the chest down
  b.box(0.2, 0.03, depth - 0.07, PAL.canvasSage, { pos: [x - 0.02, lid + 0.03, z], kind: KIND.CLOTH });
  b.box(0.204, 0.012, 0.03, PAL.rust, { pos: [x - 0.02, lid + 0.041, z - 0.07], kind: KIND.CLOTH });
  const hold = x - 0.02;
  const over = lid + 0.058;
  const rope: Triple[] = [
    [hold, y + 0.02, fore - 0.07], [hold, top + 0.01, fore - 0.035], [hold, over, fore + 0.02], [hold, over, aft - 0.02], [hold, top + 0.01, aft + 0.035], [hold, y + 0.02, aft + 0.07],
  ];
  line(b, rope, 0.011);
  for (const end of [fore - 0.07, aft + 0.07]) {
    b.box(0.06, 0.012, 0.06, IRON, { pos: [hold, y + 0.006, end], kind: KIND.METAL });
    b.torus(0.02, 0.007, STEEL, { pos: [hold, y + 0.032, end], rot: [0, Math.PI / 2, 0], kind: KIND.METAL }, 8);
  }
  return only(b.mesh());
};

/**
 * The tin trunk, on the starboard deck between the planter and the forge: sheathed in tin, its lid rounded to
 * shed the rain, two red bands round it, brass clasps on the side the crew reaches it from. It lies fore and
 * aft, low enough for the fishing rods to pass over it.
 */
export const tinTrunkPart: AttachmentBuilder = (context) => {
  const b = partBuilder(context, 133);
  const [x, y, z] = context.mount;
  const inboard = -(Math.sign(x) || 1);
  const { width, length, height, crown } = TIN_TRUNK;
  const base = y + 0.025;
  const top = base + height;
  const aft = z + length / 2;
  const round = { rot: [Math.PI / 2, 0, 0] as Triple, scale: [1, 1, crown / (width / 2)] as Triple };
  for (const end of [-0.13, 0.13]) b.box(width + 0.03, 0.025, 0.05, PAL.woodDark, { pos: [x, y + 0.0125, z + end] });
  b.box(width, height, length, PAL.tin, { pos: [x, base + height / 2, z], kind: KIND.METAL, axis: 1 });
  b.cyl(width / 2, width / 2, length, PAL.tin, { pos: [x, top, z], kind: KIND.METAL, ...round }, 14);
  // the rolled edge where the lid shuts, and a wired edge round the foot
  b.box(width + 0.014, 0.016, length + 0.014, STEEL, { pos: [x, top - 0.004, z], kind: KIND.METAL });
  b.box(width + 0.01, 0.014, length + 0.01, STEEL, { pos: [x, base + 0.007, z], kind: KIND.METAL });
  // two bands of red paint, round the sides and over the lid
  for (const end of [-0.115, 0.115]) {
    b.box(width + 0.008, height - 0.03, 0.045, PAL.rust, { pos: [x, base + height / 2, z + end], kind: KIND.PAINT, axis: 1 });
    b.cyl(width / 2 + 0.004, width / 2 + 0.004, 0.045, PAL.rust, { pos: [x, top, z + end], kind: KIND.PAINT, ...round }, 14);
  }
  // rivets down the corners of the aft end, a drop handle on it, the maker's number
  for (const side of [-1, 1]) for (const rise of [0.03, 0.08, 0.13, 0.18]) b.tack(x + side * (width / 2 - 0.018), base + rise - 0.005, aft + 0.002, 0.007, '#6f7678');
  b.box(0.13, 0.03, 0.008, STEEL, { pos: [x, base + 0.15, aft + 0.004], kind: KIND.METAL });
  for (const side of [-1, 1]) b.tack(x + side * 0.05, base + 0.15, aft + 0.009, 0.008, BOLT);
  line(b, [[x - 0.045, base + 0.15, aft + 0.012], [x - 0.04, base + 0.105, aft + 0.02], [x + 0.04, base + 0.105, aft + 0.02], [x + 0.045, base + 0.15, aft + 0.012]], 0.007, LEATHER);
  b.stencil('No 2', [x - 0.07, base + 0.03, aft + 0.004], [1, 0, 0], [0, 1, 0], 0.045, '#4a3a2c');
  // two brass clasps and a lock plate on the inboard side
  const face = x + inboard * (width / 2 + 0.005);
  for (const end of [-0.115, 0.115]) {
    b.box(0.012, 0.06, 0.03, BRASS, { pos: [face, top - 0.012, z + end], kind: KIND.METAL });
    b.tack(face + inboard * 0.006, top - 0.03, z + end, 0.006, BOLT);
  }
  b.box(0.01, 0.05, 0.05, BRASS, { pos: [face, top - 0.045, z], kind: KIND.METAL });
  b.box(0.012, 0.016, 0.008, SOOT, { pos: [face + inboard * 0.002, top - 0.05, z], flat: true, kind: KIND.PLAIN });
  // a leather strap buckled over the lid between the bands
  const strap: Triple[] = [];
  for (let step = 0; step <= 8; step += 1) {
    const angle = (step / 8) * Math.PI;
    strap.push([x + Math.cos(angle) * (width / 2 + 0.008), top + Math.sin(angle) * (crown + 0.008), z]);
  }
  b.tube(strap, 0.011, LEATHER, { steps: 16, kind: KIND.PLAIN }, 5);
  b.box(0.03, 0.01, 0.036, BRASS, { pos: [x + inboard * 0.05, top + crown + 0.012, z], kind: KIND.METAL });
  return only(b.mesh());
};

/**
 * The sea chest, across the thwart of the long hull: painted blue, bound with two iron straps, a brass lock,
 * rope handles, her name on the lid. Its forward half rests on the hull's own thwart and its aft half on a
 * bearer it brings with it, so nothing stands on the floor, where the cargo rack keeps its stack.
 */
export const seaChestPart: AttachmentBuilder = (context) => {
  const b = partBuilder(context, 137);
  const hull = hullOf(context);
  const [, , z] = context.mount;
  const { length, depth, height } = SEA_CHEST;
  const rail = hull.gunwale(THWART);
  const [fore, aft] = [z - depth / 2, z + depth / 2];
  const bearer = THWART + SEA_CHEST.bearer;
  // the bearer: a second thwart let in between the rails, and four chocks to sit the chest level on the two
  b.box(hull.halfBeam(bearer) * 2 - 0.03, 0.024, 0.06, PAL.wood, { pos: [0, rail - 0.017, bearer], kind: KIND.WOOD, axis: 0 });
  for (const side of [-1, 1]) {
    b.bolt(side * (hull.halfBeam(bearer) - 0.05), rail - 0.004, bearer, BOLT, 0.014);
    for (const under of [THWART, bearer]) b.box(0.07, 0.018, 0.055, PAL.woodDark, { pos: [side * 0.26, rail + 0.004, under] });
  }
  const base = rail + 0.013;
  const top = base + height;
  b.box(length + 0.02, 0.035, depth + 0.02, PAL.woodDark, { pos: [0, base + 0.0175, z] });
  b.box(length, height, depth, PAL.barrelBlue, { pos: [0, base + height / 2, z], kind: KIND.PAINT, axis: 0 });
  const lid = top + 0.0225;
  const lidTop = top + 0.045;
  b.box(length + 0.03, 0.045, depth + 0.03, '#476579', { pos: [0, lid, z], kind: KIND.PAINT, axis: 0 });
  b.box(length + 0.034, 0.008, depth + 0.034, PAL.cream, { pos: [0, top + 0.004, z], kind: KIND.PAINT, axis: 0 });
  // two iron straps, over the lid and down both faces, bolted
  for (const side of [-1, 1]) {
    const at = side * 0.23;
    b.box(0.04, 0.008, depth + 0.044, IRON, { pos: [at, lidTop + 0.004, z], kind: KIND.METAL });
    for (const [end, out] of [[fore, -1], [aft, 1]] as const) {
      b.box(0.04, height + 0.04, 0.008, IRON, { pos: [at, base + height / 2 + 0.024, end + out * 0.019], kind: KIND.METAL });
      for (const rise of [0.05, 0.13]) b.tack(at, base + rise, end + out * 0.024, 0.008, STEEL);
    }
    for (const end of [-0.08, 0.08]) b.tack(at, lidTop + 0.009, z + end, 0.008, STEEL);
    // an iron corner at each end of the foot
    for (const end of [fore, aft]) b.box(0.035, 0.07, 0.035, IRON, { pos: [side * (length / 2), base + 0.035, end], kind: KIND.METAL });
  }
  // the lock on the aft face: a brass plate, the keyhole, the hasp down from the lid
  b.box(0.08, 0.085, 0.008, BRASS, { pos: [0, top - 0.06, aft + 0.004], kind: KIND.METAL });
  b.box(0.014, 0.026, 0.006, SOOT, { pos: [0, top - 0.068, aft + 0.008], flat: true, kind: KIND.PLAIN });
  b.box(0.03, 0.07, 0.008, IRON, { pos: [0, top + 0.002, aft + 0.02], kind: KIND.METAL });
  for (const side of [-1, 1]) b.tack(side * 0.028, top - 0.028, aft + 0.009, 0.006, BOLT);
  // a rope handle at each end, rove through a wooden cleat
  for (const side of [-1, 1]) {
    const end = side * (length / 2);
    b.box(0.022, 0.05, 0.13, PAL.woodDark, { pos: [end + side * 0.011, base + 0.13, z] });
    for (const hole of [-0.045, 0.045]) b.tack(end + side * 0.024, base + 0.13, z + hole, 0.008, BOLT);
    line(b, [[end + side * 0.02, base + 0.12, z - 0.045], [end + side * 0.034, base + 0.075, z - 0.03], [end + side * 0.036, base + 0.06, z], [end + side * 0.034, base + 0.075, z + 0.03], [end + side * 0.02, base + 0.12, z + 0.045]], 0.01);
  }
  // her name on the lid, read from astern, and a heaving line coiled beside it
  b.stencil('OTTER', [-0.135, lidTop + 0.004, z + 0.035], [1, 0, 0], [0, 0, -1], 0.07, PAL.cream);
  for (let turn = 0; turn < 2; turn += 1) b.torus(0.045 - turn * 0.013, 0.011, ROPE, { pos: [0.305, lidTop + 0.012 + turn * 0.012, z], rot: [Math.PI / 2, 0, 0.3 * turn], kind: KIND.ROPE }, 12);
  return only(b.mesh());
};
