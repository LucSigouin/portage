/**
 * The three survivors, each their own drawn figure in the paddler's
 * storybook proportions (a big head, mitten hands, block boots), and each
 * told apart at a distance by silhouette before colour:
 *
 * - Odile kept the orchard for fifty years: small and a little stooped, a wide straw hat,
 *   a long skirt and apron, a basket of apples on her arm, a stick cut from an apple bough.
 * - Wren rings the hours from the steeple: the tall one, a long slate coat and a red scarf,
 *   a coil of bell rope over one shoulder, a hand bell held out.
 * - Tink sorts the scrapyard one bolt at a time: the broad one, rust overalls under a leather
 *   apron, goggles pushed up, a wrench as long as an arm, a pack frame of salvage.
 *
 * A figure faces -z with its feet at the origin. `registerCharacter` swaps one out.
 */
import * as THREE from 'three';
import type { NpcId } from '../data/index.ts';
import { KIND } from './b2/detail.js';
import { Builder, THIN } from './b2/geo.js';
import type { Triple } from './b2/geo.js';
import { PAL } from './b2/palette.js';

export type CharacterBuilder = (builder: Builder) => void;

const ROPE = '#dccfa6';
const BRASS = '#c9a14a';
const STEEL = '#8d9496';
const LEATHER = '#8a5f41';
const STRAW = '#dcc98f';
const COPPER = '#b9744f';
const BOOT = '#5a4538';
const MITT = '#454d5c';

/** The head all three share: skin, two ink eyes looking down -z. Returns its ink id, so hair and hats can join it. */
function head(b: Builder, y: number, z = 0, radius = 0.135): number {
  const id = b.sphere(radius, PAL.skin, { pos: [0, y, z - 0.008], flat: true, kind: KIND.PLAIN }, 12);
  for (const side of [-0.052, 0.052]) b.sphere(0.02, PAL.ink, { pos: [side, y - 0.015, z - radius + 0.007], id, flat: true, kind: KIND.PLAIN }, 6);
  return id;
}

/** An arm in two pieces, shoulder to elbow to a mitten. */
function arm(b: Builder, shoulder: Triple, elbow: Triple, hand: Triple, colour: string, coat: number, mitt: string = MITT): void {
  b.beam(shoulder, elbow, 0.056, colour, { id: coat, flat: true, kind: KIND.CLOTH }, 7);
  b.beam(elbow, hand, 0.05, colour, { id: coat, flat: true, kind: KIND.CLOTH }, 7);
  b.sphere(0.058, mitt, { pos: hand, flat: true, kind: KIND.CLOTH }, 7);
}

/** Two trouser legs and block boots. */
function legs(b: Builder, colour: string, hip: number, spread: number, boot: string = BOOT, radius = 0.07): void {
  for (const side of [-1, 1]) {
    b.beam([side * spread * 0.85, hip, 0], [side * spread, 0.1, 0], radius, colour, { r2: radius * 0.86, flat: true, kind: KIND.CLOTH }, 7);
    b.box(0.1, 0.09, 0.21, boot, { pos: [side * spread, 0.05, -0.04], kind: KIND.PLAIN });
  }
}

function odile(b: Builder): void {
  const stoop = -0.05; // her shoulders are carried a little forward
  // long skirt to the ankles, boots just showing
  for (const side of [-1, 1]) b.box(0.09, 0.07, 0.19, BOOT, { pos: [side * 0.08, 0.035, -0.05], kind: KIND.PLAIN });
  const skirt = b.cyl(0.17, 0.27, 0.78, '#7b6453', { pos: [0, 0.46, 0], flat: true, kind: KIND.CLOTH }, 12);
  b.torus(0.265, 0.014, '#5f4c40', { pos: [0, 0.09, 0], rot: [Math.PI / 2, 0, 0], id: skirt, kind: KIND.CLOTH }, 14);
  // apron with a pocket, tied behind
  b.box(0.24, 0.52, 0.02, PAL.cream, { pos: [0, 0.56, -0.215], rot: [0.11, 0, 0], kind: KIND.CLOTH });
  b.box(0.1, 0.09, 0.02, '#e3d7b9', { pos: [0.05, 0.5, -0.24], rot: [0.11, 0, 0], kind: KIND.CLOTH });
  b.torus(0.175, 0.014, PAL.cream, { pos: [0, 0.85, 0], rot: [Math.PI / 2, 0, 0], kind: KIND.CLOTH }, 12);
  // cardigan, buttoned, a shawl collar
  const coat = b.cyl(0.13, 0.18, 0.42, PAL.sage, { pos: [0, 1.04, stoop * 0.5], rot: [-0.1, 0, 0], flat: true, kind: KIND.CLOTH }, 10);
  b.sphere(0.15, PAL.sage, { pos: [0, 1.24, stoop], scale: [1.3, 0.5, 0.95], id: coat, flat: true, kind: KIND.CLOTH }, 10);
  for (const y of [0.95, 1.05, 1.15]) b.sphere(0.013, PAL.cream, { pos: [0, y, stoop * 0.5 - 0.16 - (y - 1.05) * 0.1], id: coat, flat: true, kind: KIND.PLAIN }, 6);
  b.torus(0.105, 0.04, PAL.sageDeep, { pos: [0, 1.3, stoop], rot: [Math.PI / 2 - 0.2, 0, 0], kind: KIND.CLOTH }, 10);
  // head, grey bun, wire spectacles
  const headY = 1.46;
  head(b, headY, stoop - 0.03);
  b.sphere(0.137, '#cfcbc0', { pos: [0, headY + 0.03, stoop + 0.01], scale: [1, 0.9, 1], flat: true, kind: KIND.PLAIN }, 10);
  b.sphere(0.065, '#cfcbc0', { pos: [0, headY + 0.02, stoop + 0.14], flat: true, kind: KIND.PLAIN }, 8);
  for (const side of [-0.052, 0.052]) b.torus(0.03, 0.005, PAL.ink, { pos: [side, headY - 0.015, stoop - 0.166], id: THIN, flat: true, kind: KIND.PLAIN }, 9);
  // the straw hat: a wide brim, a low crown, a rust ribbon
  b.cyl(0.3, 0.31, 0.018, STRAW, { pos: [0, headY + 0.1, stoop - 0.01], rot: [-0.08, 0, 0], kind: KIND.CANE }, 16);
  b.cyl(0.115, 0.135, 0.1, STRAW, { pos: [0, headY + 0.155, stoop - 0.005], rot: [-0.08, 0, 0], kind: KIND.CANE }, 12);
  b.torus(0.136, 0.016, PAL.rust, { pos: [0, headY + 0.125, stoop - 0.007], rot: [Math.PI / 2 - 0.08, 0, 0], kind: KIND.CLOTH }, 12);
  // her right hand on a stick cut from an apple bough
  const grip: Triple = [-0.3, 0.86, -0.17];
  arm(b, [-0.19, 1.22, stoop], [-0.27, 1.02, stoop - 0.04], grip, PAL.sage, coat, PAL.skin);
  b.tube([[-0.31, 0.93, -0.15], [-0.3, 0.6, -0.19], [-0.33, 0.3, -0.2], [-0.32, 0, -0.23]], 0.016, '#7a5a40', { steps: 10, kind: KIND.BARK }, 6);
  b.beam([-0.31, 0.93, -0.15], [-0.36, 1.0, -0.1], 0.013, '#7a5a40', { kind: KIND.BARK }, 5);
  // the basket on her left arm, heaped with apples
  const basket: Triple = [0.33, 0.83, -0.1];
  arm(b, [0.19, 1.22, stoop], [0.3, 1.04, stoop - 0.02], [0.31, 1.0, -0.12], PAL.sage, coat, PAL.skin);
  b.cyl(0.14, 0.105, 0.14, '#b08a5e', { pos: basket, kind: KIND.CANE }, 10);
  b.torus(0.142, 0.012, '#8d6d4d', { pos: [basket[0], basket[1] + 0.07, basket[2]], rot: [Math.PI / 2, 0, 0], kind: KIND.CANE }, 12);
  b.torus(0.13, 0.011, '#8d6d4d', { pos: [basket[0], basket[1] + 0.09, basket[2]], rot: [0, Math.PI / 2, 0], kind: KIND.CANE }, 12);
  const apples = ['#c64732', '#b5553a', '#a4ad7a', '#c64732', '#d5a542', '#b5553a'];
  apples.forEach((colour, index) => {
    const turn = index * 1.1;
    const out = index === 0 ? 0 : 0.07;
    b.sphere(0.042, colour, { pos: [basket[0] + Math.cos(turn) * out, basket[1] + 0.09 + (index === 0 ? 0.035 : 0), basket[2] + Math.sin(turn) * out], flat: true, kind: KIND.PLAIN }, 7);
  });
}

function wren(b: Builder): void {
  legs(b, '#3f4654', 0.98, 0.085, '#3a3632', 0.062);
  // the long coat: skirts to the knee, a belt, two rows of brass buttons
  const coat = b.cyl(0.125, 0.185, 0.62, PAL.slate, { pos: [0, 1.22, 0], flat: true, kind: KIND.CLOTH }, 10);
  b.cyl(0.19, 0.225, 0.42, PAL.slate, { pos: [0, 0.72, 0], id: coat, flat: true, kind: KIND.CLOTH }, 10);
  b.sphere(0.15, PAL.slate, { pos: [0, 1.52, 0], scale: [1.32, 0.5, 0.92], id: coat, flat: true, kind: KIND.CLOTH }, 10);
  b.torus(0.184, 0.018, '#3a3632', { pos: [0, 0.94, 0], rot: [Math.PI / 2, 0, 0], kind: KIND.PLAIN }, 12);
  b.box(0.05, 0.05, 0.02, BRASS, { pos: [0, 0.94, -0.19], kind: KIND.METAL });
  for (const side of [-0.045, 0.045]) for (const y of [1.08, 1.2, 1.32, 1.44]) b.sphere(0.014, BRASS, { pos: [side, y, -0.165 + (y - 1.08) * 0.07], id: coat, flat: true, kind: KIND.PLAIN }, 6);
  b.box(0.008, 0.4, 0.008, '#4f6272', { pos: [0, 0.72, -0.212], rot: [0.08, 0, 0], id: coat, flat: true, kind: KIND.PLAIN }); // where the skirts part
  // the scarf, one end thrown back over the shoulder
  b.torus(0.1, 0.04, PAL.rust, { pos: [0, 1.6, 0], rot: [Math.PI / 2, 0, 0], kind: KIND.CLOTH }, 10);
  b.box(0.075, 0.34, 0.03, PAL.rust, { pos: [0.09, 1.42, 0.15], rot: [-0.2, 0, -0.1], kind: KIND.CLOTH });
  for (const fringe of [-0.025, 0, 0.025]) b.beam([0.105 + fringe, 1.26, 0.185], [0.108 + fringe, 1.21, 0.195], 0.005, PAL.rustDark, { id: THIN, kind: KIND.PLAIN }, 4);
  // head, a knitted watch cap pulled down, the brim rolled
  const headY = 1.76;
  head(b, headY, 0, 0.128);
  b.sphere(0.136, '#3f4654', { pos: [0, headY + 0.075, 0.012], scale: [1, 0.78, 1], flat: true, kind: KIND.CLOTH }, 12);
  b.torus(0.13, 0.03, '#566170', { pos: [0, headY + 0.06, 0.01], rot: [Math.PI / 2 - 0.14, 0, 0], kind: KIND.CLOTH }, 12);
  // a coil of bell rope worn over the left shoulder, across the chest
  for (let turn = 0; turn < 3; turn += 1) {
    b.torus(0.25 - turn * 0.016, 0.027, ROPE, { pos: [0.02 + turn * 0.012, 1.24, 0.005], rot: [0.1, Math.PI / 2 - 0.35, 0.62 + turn * 0.03], order: 'ZYX', kind: KIND.ROPE }, 16);
  }
  // the hand bell, held out in the right hand
  const hand: Triple = [-0.36, 1.2, -0.26];
  arm(b, [-0.2, 1.5, 0], [-0.31, 1.3, -0.08], hand, PAL.slate, coat);
  b.beam([hand[0], hand[1] + 0.05, hand[2]], [hand[0], hand[1] - 0.07, hand[2]], 0.014, '#7a5a40', {}, 5);
  b.cone(0.1, 0.15, BRASS, { pos: [hand[0], hand[1] - 0.14, hand[2]], kind: KIND.METAL }, 10);
  b.torus(0.099, 0.012, '#a9822f', { pos: [hand[0], hand[1] - 0.215, hand[2]], rot: [Math.PI / 2, 0, 0], kind: KIND.METAL }, 10);
  b.sphere(0.02, '#3a3632', { pos: [hand[0], hand[1] - 0.235, hand[2]], flat: true, kind: KIND.PLAIN }, 6);
  // the left hand rests on the rope; the steeple key hangs from the belt
  arm(b, [0.2, 1.5, 0], [0.28, 1.27, -0.03], [0.2, 1.1, -0.15], PAL.slate, coat);
  b.torus(0.03, 0.006, '#4b4d57', { pos: [0.15, 0.89, -0.17], rot: [0, 0.3, 0], id: THIN, kind: KIND.PLAIN }, 8);
  b.beam([0.15, 0.86, -0.17], [0.155, 0.72, -0.19], 0.008, '#4b4d57', { kind: KIND.METAL }, 4);
  b.box(0.035, 0.03, 0.008, '#4b4d57', { pos: [0.165, 0.73, -0.19], kind: KIND.METAL });
}

function tink(b: Builder): void {
  legs(b, PAL.rust, 0.72, 0.12, '#3f3a36', 0.086);
  for (const side of [-1, 1]) b.box(0.1, 0.09, 0.02, PAL.ochre, { pos: [side * 0.125, 0.42, -0.08], rot: [0.05, 0, 0], kind: KIND.CLOTH }); // knee patches
  // overalls: broad in the body, a bib and braces
  const suit = b.cyl(0.185, 0.215, 0.5, PAL.rust, { pos: [0, 0.95, 0], flat: true, kind: KIND.CLOTH }, 10);
  b.sphere(0.2, PAL.rust, { pos: [0, 1.2, 0], scale: [1.32, 0.5, 0.95], id: suit, flat: true, kind: KIND.CLOTH }, 10);
  // the leather apron, scorched at the hem, a pocket of small tools
  b.box(0.3, 0.6, 0.02, LEATHER, { pos: [0, 0.83, -0.215], rot: [0.04, 0, 0], kind: KIND.PLAIN });
  b.box(0.3, 0.05, 0.022, '#5d4433', { pos: [0, 0.55, -0.228], rot: [0.04, 0, 0], kind: KIND.PLAIN });
  b.box(0.13, 0.09, 0.02, '#74503a', { pos: [-0.04, 1.0, -0.232], kind: KIND.PLAIN });
  for (const [tool, colour] of [[-0.075, STEEL], [-0.04, PAL.ochre], [-0.005, STEEL]] as const) b.beam([tool, 1.03, -0.245], [tool, 1.12, -0.245], 0.008, colour, { kind: KIND.METAL }, 4);
  for (const side of [-1, 1]) b.beam([side * 0.12, 1.12, -0.2], [side * 0.15, 1.27, -0.02], 0.014, LEATHER, { kind: KIND.PLAIN }, 4);
  // the tool belt: a hammer in its loop, a pouch, a ring of bolts
  b.torus(0.212, 0.022, '#5d4433', { pos: [0, 0.78, 0], rot: [Math.PI / 2, 0, 0], kind: KIND.PLAIN }, 14);
  b.box(0.09, 0.1, 0.05, '#74503a', { pos: [0.2, 0.72, -0.07], rot: [0, 0.35, 0], kind: KIND.PLAIN });
  b.beam([-0.225, 0.8, -0.02], [-0.235, 0.55, -0.03], 0.012, PAL.woodLight, {}, 5);
  b.box(0.04, 0.05, 0.1, STEEL, { pos: [-0.225, 0.82, -0.02], kind: KIND.METAL });
  // a kerchief at the neck
  b.torus(0.11, 0.036, PAL.ochre, { pos: [0, 1.28, 0], rot: [Math.PI / 2, 0, 0], kind: KIND.CLOTH }, 10);
  // head: a shock of hair, goggles pushed up on the brow
  const headY = 1.44;
  const face = head(b, headY, 0, 0.14);
  b.sphere(0.146, '#5d4b42', { pos: [0, headY + 0.045, 0.02], scale: [1, 0.86, 1], flat: true, kind: KIND.PLAIN }, 10);
  for (const [x, lift, lean] of [[-0.07, 0.15, 0.4], [0, 0.17, 0], [0.07, 0.15, -0.4]]) b.cone(0.04, 0.1, '#5d4b42', { pos: [x, headY + lift, 0.01], rot: [0, 0, lean], flat: true, kind: KIND.PLAIN }, 5);
  b.torus(0.142, 0.012, '#3a3632', { pos: [0, headY + 0.075, 0], rot: [Math.PI / 2 - 0.25, 0, 0], kind: KIND.PLAIN }, 12);
  for (const side of [-0.058, 0.058]) {
    b.cyl(0.042, 0.042, 0.04, BRASS, { pos: [side, headY + 0.09, -0.125], rot: [Math.PI / 2 - 0.3, 0, 0], kind: KIND.METAL }, 9);
    b.cyl(0.03, 0.03, 0.044, '#2f3a40', { pos: [side, headY + 0.091, -0.13], rot: [Math.PI / 2 - 0.3, 0, 0], flat: true, kind: KIND.PLAIN }, 9);
  }
  b.sphere(0.02, '#3a3632', { pos: [0.1, headY - 0.03, -0.1], scale: [1.4, 0.6, 0.4], id: face, flat: true, kind: KIND.PLAIN }, 6); // a smudge of soot
  // the right hand holds a wrench as long as an arm, head up
  const hand: Triple = [-0.34, 0.86, -0.14];
  arm(b, [-0.25, 1.2, 0], [-0.34, 1.02, -0.04], hand, PAL.rust, suit, LEATHER);
  const jaw: Triple = [-0.37, 1.42, -0.2];
  b.beam([-0.335, 0.72, -0.13], jaw, 0.02, STEEL, { kind: KIND.METAL }, 6);
  const wrench = b.box(0.05, 0.1, 0.13, STEEL, { pos: jaw, rot: [0.12, 0, 0.07], kind: KIND.METAL });
  b.box(0.05, 0.05, 0.05, STEEL, { pos: [jaw[0] + 0.003, jaw[1] + 0.07, jaw[2] - 0.045], rot: [0.12, 0, 0.07], id: wrench, kind: KIND.METAL });
  b.box(0.05, 0.05, 0.04, STEEL, { pos: [jaw[0] + 0.003, jaw[1] + 0.07, jaw[2] + 0.05], rot: [0.12, 0, 0.07], id: wrench, kind: KIND.METAL });
  // the left hand hooked in the belt
  arm(b, [0.25, 1.2, 0], [0.36, 1.0, 0.03], [0.26, 0.82, -0.09], PAL.rust, suit, LEATHER);
  // a pack frame of salvage on the back: a coil of copper wire, a length of pipe, a whip of aerial
  for (const side of [-1, 1]) b.beam([side * 0.13, 0.78, 0.22], [side * 0.14, 1.5, 0.24], 0.014, PAL.woodDark, {}, 5);
  for (const y of [0.86, 1.14, 1.42]) b.beam([-0.15, y, 0.23], [0.15, y, 0.23], 0.012, PAL.woodDark, {}, 5);
  b.box(0.26, 0.26, 0.13, PAL.canvasSage, { pos: [0, 1.0, 0.3], kind: KIND.CLOTH });
  for (let turn = 0; turn < 3; turn += 1) b.torus(0.1, 0.014, COPPER, { pos: [0, 1.3, 0.27 + turn * 0.022], kind: KIND.METAL }, 12);
  b.beam([0.11, 0.9, 0.36], [0.16, 1.7, 0.33], 0.022, '#5c5f6a', { kind: KIND.METAL }, 6);
  b.beam([-0.12, 1.4, 0.3], [-0.16, 2.0, 0.34], 0.006, STEEL, { id: THIN, kind: KIND.PLAIN }, 4);
  b.sphere(0.018, '#d2553d', { pos: [-0.16, 2.0, 0.34], flat: true, kind: KIND.PLAIN }, 6);
}

const BUILDERS: Record<NpcId, CharacterBuilder> = { odile, wren, tink };

/** Replace how a survivor is drawn. */
export function registerCharacter(npcId: NpcId, build: CharacterBuilder): void {
  BUILDERS[npcId] = build;
}

/** A survivor's mesh, facing -z with its feet at the origin. */
export function buildCharacter(npcId: NpcId): THREE.Mesh {
  const builder = new Builder(1800 + Object.keys(BUILDERS).indexOf(npcId));
  BUILDERS[npcId](builder);
  return builder.mesh();
}
