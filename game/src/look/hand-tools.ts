/**
 * The tools a player carries ashore, drawn to be held in the right hand (Luc's list, item 16: "when we have the
 * tool in our hand that's what the character has in their hand"). One drawing per tool in the rules' list, each
 * told from the others at play distance by its outline: the knife's flaked stone, the hatchet's head, the bar's
 * hook, the saw's long blade, the hammer's T, the rod's height and its float, the spanner's jaws, the can.
 *
 * A tool's own space: the origin is where the fist closes on it, +y runs from the grip to the working end, +z is the
 * way its edge or face looks. Drawn a little larger than life, as the figure's head is.
 *
 * Every piece carries an ink id from a fixed set, never `nextId()`: a tool is built the first time it is shown, and
 * taking ids from the shared counter then would change the ids of whatever is built after it. The set lies outside
 * the counter's range (ids are n / 2048, the counter gives n from 16 to 2018, the pen leaves 2037 and up for THIN
 * and the sky): no tool can share an id with the mitt that holds it, and so lose its line there.
 */
import * as THREE from 'three';
import type { ToolId } from '../data/index.ts';
import { KIND } from './b2/detail.js';
import { Builder, THIN } from './b2/geo.js';
import { PAL } from './b2/palette.js';

/** How a tool is carried: the angle its grip-to-head line rises over the horizontal, ahead of the figure. */
export const TOOL_CARRY: Record<ToolId, number> = {
  bailing_can: 0.15, stone_knife: 0.35, hatchet: 0.55, pry_bar: 0.55, saw: 0.3, hammer: 0.55, fishing_rod: 1.05, wrench: 0.45,
};

const ROPE = '#cdb98a';
const FLINT = '#8d8f8c';
const FLINT_DARK = '#6c6e6c';
const STEEL = '#9aa2a6';
const CORK = '#b88f5c';
/** The ink ids the tools draw with, as n of n / 2048: past the shared counter's 2018, short of THIN's 2040 (and the pen's 3 either side of it), then under its 16. */
const TOOL_IDS: readonly number[] = [
  ...Array.from({ length: 2036 - 2019 + 1 }, (_, index) => 2019 + index),
  ...Array.from({ length: 15 - 6 + 1 }, (_, index) => 6 + index),
];
/** The most ink ids one drawing uses: the fishing rod's five. */
const PARTS = 5;

type Drawing = (builder: Builder, id: (part: number) => number) => void;

const DRAWINGS: Record<ToolId, Drawing> = {
  // A tin with a wire bail, held by the bail.
  bailing_can: (b, id) => {
    b.cyl(0.075, 0.07, 0.14, PAL.tin, { pos: [0, 0.1, 0.05], rot: [Math.PI / 2, 0, 0], id: id(0), kind: KIND.METAL }, 10);
    b.torus(0.072, 0.008, PAL.tin, { pos: [0, 0.1, 0.12], id: id(1), kind: KIND.METAL }, 10);
    b.beam([0, 0, 0], [0.07, 0.1, 0.0], 0.006, PAL.iron, { id: THIN }, 4);
    b.beam([0, 0, 0], [-0.07, 0.1, 0.0], 0.006, PAL.iron, { id: THIN }, 4);
  },
  // A leaf of knapped stone lashed into a short wooden handle.
  stone_knife: (b, id) => {
    b.cyl(0.022, 0.02, 0.15, PAL.wood, { pos: [0, 0.03, 0], id: id(0), kind: KIND.WOOD }, 7);
    for (const y of [0.09, 0.115]) b.torus(0.024, 0.007, ROPE, { pos: [0, y, 0], rot: [Math.PI / 2, 0, 0], id: id(1), kind: KIND.ROPE }, 8);
    b.sphere(1, FLINT, { pos: [0, 0.23, 0.006], scale: [0.012, 0.13, 0.04], id: id(2), kind: KIND.STONE }, 10);
    b.sphere(1, FLINT_DARK, { pos: [0, 0.22, -0.012], scale: [0.013, 0.1, 0.022], id: id(2), kind: KIND.STONE }, 8);
  },
  // A short haft and an iron head, its bright edge forward.
  hatchet: (b, id) => {
    b.beam([0, -0.08, 0], [0, 0.44, -0.01], 0.021, PAL.woodLight, { id: id(0), kind: KIND.WOOD, r2: 0.018 }, 7);
    b.box(0.05, 0.075, 0.14, PAL.iron, { pos: [0, 0.4, 0.035], id: id(1), kind: KIND.METAL });
    b.box(0.03, 0.11, 0.035, STEEL, { pos: [0, 0.4, 0.115], id: id(2), kind: KIND.METAL });
    b.box(0.045, 0.05, 0.05, PAL.iron, { pos: [0, 0.4, -0.05], id: id(1), kind: KIND.METAL });
  },
  // A long iron bar: a hooked, split claw at the top, a flat chisel end below the fist.
  pry_bar: (b, id) => {
    b.beam([0, -0.14, 0], [0, 0.5, 0], 0.017, PAL.iron, { id: id(0), kind: KIND.METAL }, 6);
    b.tube([[0, 0.5, 0], [0, 0.58, 0.02], [0, 0.61, 0.08], [0, 0.58, 0.13]], 0.016, PAL.iron, { id: id(0), kind: KIND.METAL, steps: 8 }, 6);
    b.box(0.03, 0.04, 0.012, PAL.rust, { pos: [0, 0.565, 0.135], rot: [0.5, 0, 0], id: id(1), kind: KIND.METAL });
    b.box(0.036, 0.06, 0.012, PAL.iron, { pos: [0, -0.16, 0.008], rot: [0.25, 0, 0], id: id(0), kind: KIND.METAL });
    b.box(0.022, 0.08, 0.022, PAL.rust, { pos: [0, 0.22, 0], id: id(2), kind: KIND.METAL });
  },
  // A rip saw: a closed wooden handle and a long tapering blade, teeth down the front edge.
  saw: (b, id) => {
    b.box(0.03, 0.13, 0.075, PAL.wood, { pos: [0, 0.02, -0.01], id: id(0), kind: KIND.WOOD });
    b.box(0.032, 0.05, 0.03, PAL.woodDark, { pos: [0, 0.03, -0.01], id: id(1), kind: KIND.WOOD });
    const blade = b.box(0.006, 0.46, 0.1, STEEL, { pos: [0, 0.31, 0.035], id: id(2), kind: KIND.METAL });
    for (let tooth = 0; tooth < 9; tooth += 1) {
      b.cone(0.012, 0.02, PAL.iron, { pos: [0, 0.12 + tooth * 0.045, 0.092], rot: [Math.PI / 2, 0, 0], id: blade, kind: KIND.METAL }, 3);
    }
    b.box(0.008, 0.46, 0.012, PAL.iron, { pos: [0, 0.31, -0.014], id: id(3), kind: KIND.METAL });
  },
  // A wooden handle and an iron head across it, claw behind.
  hammer: (b, id) => {
    b.beam([0, -0.07, 0], [0, 0.32, 0], 0.019, PAL.woodLight, { id: id(0), kind: KIND.WOOD }, 7);
    b.box(0.05, 0.055, 0.1, PAL.iron, { pos: [0, 0.33, 0.03], id: id(1), kind: KIND.METAL });
    b.cyl(0.032, 0.032, 0.03, STEEL, { pos: [0, 0.33, 0.09], rot: [Math.PI / 2, 0, 0], id: id(2), kind: KIND.METAL }, 8);
    b.box(0.04, 0.03, 0.09, PAL.iron, { pos: [0, 0.345, -0.06], rot: [-0.45, 0, 0], id: id(1), kind: KIND.METAL });
  },
  // A tall springy pole with a cork grip, the line hanging from its tip to a red-capped float.
  fishing_rod: (b, id) => {
    b.cyl(0.024, 0.024, 0.16, CORK, { pos: [0, 0.02, 0], id: id(0), kind: KIND.PLAIN }, 7);
    b.beam([0, -0.08, 0], [0, 1.32, 0], 0.014, PAL.woodLight, { id: id(1), kind: KIND.WOOD, r2: 0.006 }, 6);
    b.torus(0.022, 0.008, PAL.iron, { pos: [0, 0.18, 0.02], id: id(2), kind: KIND.METAL }, 8);
    b.beam([0, 1.32, 0], [0, 1.02, 0.3], 0.004, PAL.ink, { id: THIN }, 3);
    b.sphere(0.03, PAL.cream, { pos: [0, 0.99, 0.31], id: id(3), kind: KIND.PLAIN }, 8);
    b.sphere(0.02, PAL.rust, { pos: [0, 1.015, 0.31], scale: [1, 0.8, 1], id: id(4), kind: KIND.PLAIN }, 8);
  },
  // Tink's spanner: a flat iron bar, an open jaw at the top and a ring below the fist.
  wrench: (b, id) => {
    b.box(0.014, 0.3, 0.035, PAL.iron, { pos: [0, 0.12, 0], id: id(0), kind: KIND.METAL });
    for (const side of [-1, 1]) b.box(0.016, 0.07, 0.022, PAL.iron, { pos: [0, 0.3, side * 0.035], rot: [side * -0.25, 0, 0], id: id(0), kind: KIND.METAL });
    b.box(0.016, 0.02, 0.07, PAL.iron, { pos: [0, 0.27, 0], id: id(0), kind: KIND.METAL });
    b.torus(0.03, 0.01, PAL.iron, { pos: [0, -0.05, 0], rot: [0, Math.PI / 2, 0], id: id(1), kind: KIND.METAL }, 10);
    b.box(0.016, 0.06, 0.036, PAL.rust, { pos: [0, 0.1, 0], id: id(2), kind: KIND.METAL });
  },
};

const TOOL_ORDER: ToolId[] = ['bailing_can', 'stone_knife', 'hatchet', 'pry_bar', 'saw', 'hammer', 'fishing_rod', 'wrench'];

/**
 * The drawing of a tool as held: a mesh in the tool's own space. `owner` (a player id) gives each crewmate's copy
 * ink ids of its own, so two players' tools side by side are still two outlines.
 */
export function buildHandTool(toolId: ToolId, owner = 0): THREE.Mesh {
  const builder = new Builder(41 + TOOL_ORDER.indexOf(toolId));
  // One tool is in a hand at a time: each crewmate's tools share that crewmate's five ids, apart from everyone else's.
  const id = (part: number): number => TOOL_IDS[(owner * PARTS + Math.min(part, PARTS - 1)) % TOOL_IDS.length] / 2048;
  DRAWINGS[toolId](builder, id);
  const mesh = builder.mesh();
  mesh.name = `tool:${toolId}`;
  return mesh;
}

/** Every tool the look can put in a hand. */
export const HAND_TOOLS: readonly ToolId[] = TOOL_ORDER;

/** The ink ids a crewmate's tools draw with, for tests: none of them is ever the shared counter's. */
export const toolInkIds = (owner: number): number[] => Array.from({ length: PARTS }, (_, part) => TOOL_IDS[(owner * PARTS + part) % TOOL_IDS.length] / 2048);
