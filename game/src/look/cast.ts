/**
 * The cast: the four people a player can be (`data/cast.ts`), drawn on the paddler's own rig.
 *
 * - The voyageur is the paddler the game has always drawn: `createPaddler`'s own drawing, piece for piece. Only its
 *   coat and trousers are turned to the voyageur's own colours where a seat's differ (in seat 1 they do not).
 * - The trapper, the angler and the scout are that same rig redrawn (`createPaddler` in `b2/canoe.js` calls
 *   `dressAs` once the figure is made): the torso's mesh gets another drawing (body, head, headgear and what is
 *   carried), and each limb's mesh another thickness and colour. The joints, the limb lengths, the poses and the
 *   number of meshes are the paddler's, so every pose the paddler has, each of them has.
 *
 * Told apart by outline before colour, the way the three survivors are (`characters.ts`):
 * - trapper: broad and heavy. A fur hat with ear flaps, a full beard, a short thick jacket, a bedroll across the back.
 * - angler: tall and lean. A rain hat with a long back brim, an oilskin coat to the knee, tall boots, a creel at the hip.
 * - scout: small and quick. A pointed hood and a short cape, a fringe and a braid, a map case slung across the back.
 *
 * What is whose colour (`CAST_COATS`, `castOutfit`): the coat and the trousers are the character's own, the same in
 * every seat; only the headgear takes the seat's toque colour (`CREW_MARKS`). So four people read as four at a
 * glance, the HUD's colour still finds a player by their head, and two friends who pick the same person are still two.
 * Each coat is the one its character's player number wore before the four had coats of their own, so a crew of
 * four in its first picks looks as it always has, and the voyageur in seat 1 is the paddler to the pixel.
 *
 * Two things differ from the paddler in build, and neither is in a pose:
 * - `torso.scale` (`CAST_BUILD[id].scale`): the pose reads the shoulders through the torso's own matrix, so a
 *   taller, a broader or a smaller torso carries its shoulders with it. Each drawing below is written in the
 *   figure's real metres from the hips; the builder takes the scale back out.
 * - the limbs' thickness, drawn into each limb's own unit mesh (the pose spans a unit cylinder between two joints).
 *
 * A figure faces +z, as the paddler does. Nothing here moves: no cloth swings, no braid sways.
 */
import * as THREE from 'three';
import { isCharacterId } from '../data/cast.ts';
import type { CharacterId } from '../data/cast.ts';
import { KIND } from './b2/detail.js';
import { Builder, nextId } from './b2/geo.js';
import type { Triple } from './b2/geo.js';
import { PAL } from './b2/palette.js';

/** What a seat wears (`CREW_MARKS`): the colours a figure is dressed in. */
export interface CastOutfit { coat: string; toque: string; legs: string }

/** A character's own clothes, the same in every seat. */
export interface CastCoat { coat: string; legs: string }

/**
 * What each of the four wears, from the game's palette: an ochre wool coat (the paddler's own), a blue jacket, a
 * sage-green oilskin, a terracotta tunic and cape. Each is the coat and trousers of the player number that stood for
 * that character (`characterOf`), so a first crew of four looks as it always has. Four hues of one value range, told apart by day and at dusk.
 */
export const CAST_COATS: Readonly<Record<CharacterId, CastCoat>> = {
  voyageur: { coat: PAL.ochre, legs: '#57697b' },
  trapper: { coat: PAL.barrelBlue, legs: PAL.bark },
  angler: { coat: PAL.sageDeep, legs: PAL.iron },
  scout: { coat: PAL.rustLight, legs: '#57697b' },
};

/** What a character wears in a seat: their own coat and trousers, the seat's headgear. */
export function castOutfit(character: CharacterId, seat: CastOutfit): CastOutfit {
  return { ...CAST_COATS[character], toque: seat.toque };
}

/** The meshes of one arm and one leg, as `createPaddler` makes them. */
export interface CastLimbs {
  upper: THREE.Mesh; fore: THREE.Mesh; elbow: THREE.Mesh; mitt: THREE.Mesh;
  thigh: THREE.Mesh; shin: THREE.Mesh; knee: THREE.Mesh; boot: THREE.Mesh;
}

/** The paddler's figure, handed over to be redrawn: the torso's group (its one mesh is the body and head) and both sides' limbs. */
export interface CastRig { torso: THREE.Group; L: CastLimbs; R: CastLimbs }

/** A stiff thing a figure carries or wears, as a capsule in the figure's real metres from its hips (the torso's space). */
export interface CastSolid { name: string; from: Triple; to: Triple; radius: number }

export interface CastBuild {
  /** The torso against the paddler's, each way: it carries the shoulders with it. */
  scale: Triple;
  /** The top of the headgear above the hips, metres. The hips stand 0.8 m off the ground. */
  top: number;
  /** Arms and legs against the paddler's thickness. */
  arm: number;
  leg: number;
  /** What sticks out of this one: the things most likely to pass through a hull, a paddle or a crewmate. */
  solids: readonly CastSolid[];
}

const FUR = '#6b5443';
const FUR_PALE = '#8f7860';
const BEARD = '#75604f';
const BLANKET = '#d9ceb2';
const LEATHER = '#8a5f41';
const LEATHER_DARK = '#4a3a30';
const BRASS = '#c9a14a';
const WICKER = '#b08a5e';
const WICKER_DARK = '#8d6d4d';
const RUBBER = '#3f3a36';
const GREY_HAIR = '#cfcbc0';
const RED_HAIR = '#a5562e';
const MITT = '#454d5c';
const SKIN_RUDDY = '#dba98a';
const SKIN_TAN = '#c89f7c';
const SKIN_FAIR = '#f0d2b4';

/** How each of the four is built. The voyageur's numbers are the paddler's own. */
export const CAST_BUILD: Readonly<Record<CharacterId, CastBuild>> = {
  voyageur: { scale: [1, 1, 1], top: 0.955, arm: 1, leg: 1, solids: [] },
  trapper: {
    scale: [1.07, 1.05, 1.1], top: 0.951, arm: 1.18, leg: 1.12,
    solids: [
      { name: 'bedroll', from: [-0.319, 0.481, -0.236], to: [0.319, 0.519, -0.236], radius: 0.048 },
      { name: 'beard', from: [0, 0.612, 0.085], to: [0, 0.637, 0.085], radius: 0.095 },
      { name: 'fur hat', from: [0, 0.822, 0], to: [0, 0.875, 0], radius: 0.2 },
    ],
  },
  angler: {
    scale: [0.94, 1.1, 0.94], top: 0.991, arm: 0.88, leg: 0.85,
    solids: [
      { name: 'back brim', from: [0, 0.835, -0.05], to: [0, 0.787, -0.225], radius: 0.014 },
      { name: 'back brim, left', from: [0.165, 0.835, -0.05], to: [0.1, 0.795, -0.2], radius: 0.014 },
      { name: 'back brim, right', from: [-0.165, 0.835, -0.05], to: [-0.1, 0.795, -0.2], radius: 0.014 },
      { name: 'creel', from: [0.05, 0.27, -0.163], to: [0.15, 0.27, -0.163], radius: 0.055 },
    ],
  },
  scout: {
    scale: [0.86, 1, 0.88], top: 0.866, arm: 0.86, leg: 0.85,
    solids: [
      { name: 'map case', from: [-0.167, 0.31, -0.19], to: [0.167, 0.37, -0.19], radius: 0.04 },
      { name: 'hood point', from: [0, 0.725, -0.075], to: [0, 0.835, -0.15], radius: 0.035 },
      { name: 'cape, back hem', from: [-0.1, 0.185, -0.19], to: [0.1, 0.185, -0.19], radius: 0.015 },
    ],
  },
};

const HALF_TURN = Math.PI / 2;

/** The ink id a limb's mesh was made with: its redrawn pieces keep it, so a sleeve is still one outline with its elbow. */
const inkOf = (mesh: THREE.Mesh): number => mesh.geometry.getAttribute('aInfo').getX(0);

/** Draw a mesh again: `draw` fills a builder, and its geometry takes the old one's place. */
function redraw(mesh: THREE.Mesh, seed: number, draw: (builder: Builder) => void): void {
  const builder = new Builder(seed);
  draw(builder);
  mesh.geometry.dispose();
  mesh.geometry = builder.geometry();
}

/** A limb's rod, in the unit space the pose spans between two joints: `near` at the first joint, `far` at the second. */
const rod = (b: Builder, near: number, colour: string, id: number, far = near, kind: number = KIND.PLAIN): number =>
  b.cyl(far, near, 1, colour, { id, flat: true, kind: kind as never }, 8);

/** A joint's ball, or a mitt, in its own unit space. */
const ball = (b: Builder, radius: number, colour: string, id: number): number => b.sphere(radius, colour, { id, flat: true, kind: KIND.PLAIN }, 8);

/** A skin head with two ink eyes looking down +z. Returns its ink id, so a nose or a cheek can join it. */
function face(b: Builder, y: number, z: number, radius: number, skin: string, scale: Triple = [1, 1, 1], eyes = 0.052): number {
  const id = b.sphere(radius, skin, { pos: [0, y, z], scale, flat: true, kind: KIND.PLAIN }, 12);
  for (const side of [-eyes, eyes]) b.sphere(0.02, PAL.ink, { pos: [side, y - 0.015, z + radius * scale[2] - 0.007], id, flat: true, kind: KIND.PLAIN }, 6);
  return id;
}

/**
 * A strap slung over one shoulder and under the other arm: a flattened loop round the body. `lean` tips its top
 * toward the figure's right shoulder (negative: the left), `depth` is how far it stands off the spine, front and back.
 */
function strap(b: Builder, y: number, radius: number, lean: number, depth: number, colour: string): void {
  b.torus(radius, 0.014, colour, { pos: [0, y, 0], rot: [0, HALF_TURN, lean], order: 'ZYX', scale: [depth / radius, 1, 1], kind: KIND.PLAIN }, 18);
}

/**
 * Arms and legs of one thickness and the seat's colours: sleeves in the coat's, trousers in the legs'.
 * `elbow`: the elbow's own thickness, where a heavy arm must still pass what the paddler's does.
 */
function plainLimbs(rig: CastRig, seed: number, outfit: CastOutfit, arm: number, leg: number, mitt: { size: number; colour: string }, elbow = arm): void {
  [rig.L, rig.R].forEach((side, index) => {
    const at = seed + index * 10;
    const sleeve = inkOf(side.upper);
    const trouser = inkOf(side.thigh);
    redraw(side.upper, at, (b) => rod(b, arm, outfit.coat, sleeve, elbow));
    redraw(side.fore, at + 1, (b) => rod(b, elbow, outfit.coat, sleeve, arm * 0.94));
    redraw(side.elbow, at + 2, (b) => ball(b, elbow, outfit.coat, sleeve));
    redraw(side.mitt, at + 3, (b) => ball(b, mitt.size, mitt.colour, inkOf(side.mitt)));
    redraw(side.thigh, at + 4, (b) => rod(b, leg, outfit.legs, trouser));
    redraw(side.shin, at + 5, (b) => rod(b, leg, outfit.legs, trouser, leg * 0.94));
    redraw(side.knee, at + 6, (b) => ball(b, leg, outfit.legs, trouser));
  });
}

/** A builder for a torso drawn in the figure's real metres: the torso's own scale is taken back out of every piece. */
function torsoBuilder(rig: CastRig, seed: number, scale: Triple): Builder {
  rig.torso.scale.set(...scale);
  const builder = new Builder(seed);
  builder.root = new THREE.Matrix4().makeScale(1 / scale[0], 1 / scale[1], 1 / scale[2]);
  builder.kind = KIND.CLOTH;
  return builder;
}

function finishTorso(rig: CastRig, builder: Builder): void {
  const mesh = rig.torso.children[0] as THREE.Mesh;
  mesh.geometry.dispose();
  mesh.geometry = builder.geometry();
}

/** Broad and heavy, knows the woods: a fur hat with ear flaps, a full beard, a short thick jacket, a bedroll across the back. */
function trapper(rig: CastRig, outfit: CastOutfit): void {
  const b = torsoBuilder(rig, 61, CAST_BUILD.trapper.scale);
  // the jacket: short and thick over a deep chest and belly, a fur hem, three toggles down the front. It is no
  // deeper behind than the paddler's coat: a kneeler in the next seat lays a paddle across there.
  const jacket = b.sphere(0.2, outfit.coat, { pos: [0, 0.27, 0.04], scale: [1.06, 1.25, 1.1], flat: true }, 12);
  b.cyl(0.176, 0.178, 0.16, outfit.coat, { pos: [0, 0.08, 0], id: jacket, flat: true }, 10);
  b.sphere(0.2, outfit.coat, { pos: [0, 0.482, 0], scale: [1.56, 0.56, 1], id: jacket, flat: true }, 10);
  b.torus(0.168, 0.022, FUR, { pos: [0, 0.045, 0], rot: [HALF_TURN, 0, 0], kind: KIND.PLAIN }, 12);
  for (const y of [0.2, 0.28, 0.36]) {
    b.box(0.075, 0.02, 0.014, LEATHER_DARK, { pos: [0, y, 0.04 + 0.22 * Math.sqrt(1 - ((y - 0.27) / 0.25) ** 2) + 0.002], id: jacket, flat: true, kind: KIND.PLAIN });
  }
  // a fur collar up to the ears
  b.torus(0.115, 0.055, FUR, { pos: [0, 0.587, -0.005], rot: [HALF_TURN, 0, 0], kind: KIND.PLAIN }, 12);
  // a big ruddy head, a round nose, a full beard and a moustache over it
  const head = face(b, 0.747, 0.012, 0.142, SKIN_RUDDY);
  b.sphere(0.03, '#cf9478', { pos: [0, 0.734, 0.156], id: head, flat: true, kind: KIND.PLAIN }, 6);
  const beard = b.sphere(0.13, BEARD, { pos: [0, 0.624, 0.085], scale: [1, 0.77, 0.72], flat: true, kind: KIND.PLAIN }, 10);
  b.sphere(0.06, FUR_PALE, { pos: [0, 0.687, 0.152], scale: [1.6, 0.45, 0.5], id: beard, flat: true, kind: KIND.PLAIN }, 8);
  // the fur hat: a cloth crown in the seat's colour, a thick fur band rolled up round it, a flap down over each ear
  b.sphere(0.16, outfit.toque, { pos: [0, 0.855, -0.002], scale: [1.03, 0.6, 1.03], flat: true }, 12);
  const band = b.torus(0.162, 0.046, FUR, { pos: [0, 0.822, -0.002], rot: [HALF_TURN + 0.08, 0, 0], kind: KIND.PLAIN }, 14);
  for (const side of [-1, 1]) b.sphere(1, FUR, { pos: [side * 0.19, 0.7, -0.01], scale: [0.05, 0.14, 0.085], id: band, flat: true, kind: KIND.PLAIN }, 8);
  // the bedroll across the shoulder blades, a blanket rolled tight, two straps round it, hung from a strap over the
  // right shoulder. It lies close: a fully fitted canoe leaves under 30 cm behind a seat, and today's stroke
  // folds the upper hand's elbow in behind the shoulder blade, so it is no thicker than the gap between the two.
  const roll: Triple = [0, 0, HALF_TURN + 0.06];
  b.cyl(0.048, 0.048, 0.64, BLANKET, { pos: [0, 0.5, -0.236], rot: roll }, 10);
  for (const along of [-0.19, 0.19]) {
    b.cyl(0.054, 0.054, 0.04, PAL.rustDark, { pos: [along * Math.cos(0.06), 0.5 + along * Math.sin(0.06), -0.236], rot: roll, kind: KIND.PLAIN }, 10);
  }
  strap(b, 0.29, 0.275, 0.55, 0.2, LEATHER_DARK);
  finishTorso(rig, b);

  const { arm, leg } = CAST_BUILD.trapper;
  // heavy arms, but the elbow is the paddler's own: on a fully fitted canoe a kneeler's elbow passes the map table by a hair
  plainLimbs(rig, 600, outfit, arm, leg, { size: 1.1, colour: LEATHER_DARK }, 1);
  // heavy boots with a fur top
  [rig.L, rig.R].forEach((side, index) => redraw(side.boot, 608 + index * 10, (boots) => {
    boots.box(0.12, 0.095, 0.21, '#4a3a30', { id: inkOf(side.boot), flat: true, kind: KIND.PLAIN });
    boots.box(0.13, 0.045, 0.14, FUR, { pos: [0, 0.062, -0.03], flat: true, kind: KIND.PLAIN });
  }));
}

/** Tall and lean, never far from the water: a rain hat with a long back brim, an oilskin coat to the knee, tall boots, a creel at the hip. */
function angler(rig: CastRig, outfit: CastOutfit): void {
  const b = torsoBuilder(rig, 62, CAST_BUILD.angler.scale);
  // the oilskin: narrow, a storm flap and three clasps, the collar turned up
  const coat = b.cyl(0.118, 0.165, 0.52, outfit.coat, { pos: [0, 0.26, 0], flat: true }, 10);
  b.sphere(0.15, outfit.coat, { pos: [0, 0.5, 0], scale: [1.34, 0.5, 0.9], id: coat, flat: true }, 10);
  b.box(0.012, 0.44, 0.01, PAL.ink, { pos: [0.03, 0.27, 0.146], rot: [0.09, 0, 0], id: coat, flat: true, kind: KIND.PLAIN });
  for (const y of [0.16, 0.28, 0.4]) b.box(0.04, 0.022, 0.012, BRASS, { pos: [0.012, y, 0.171 - y * 0.09], id: coat, flat: true, kind: KIND.PLAIN });
  b.cyl(0.085, 0.105, 0.13, outfit.coat, { pos: [0, 0.615, 0], flat: true }, 10);
  // a long weathered face on a long neck, a grey moustache that droops past the mouth
  // (the moustache is one soft shape in the face's own ink: two small rods, each with its own line, read as a blot)
  const head = face(b, 0.8, 0.01, 0.122, SKIN_TAN, [0.94, 1.08, 0.96], 0.047);
  b.sphere(0.055, GREY_HAIR, { pos: [0, 0.742, 0.112], scale: [1.5, 0.42, 0.5], id: head, flat: true, kind: KIND.PLAIN }, 8);
  // the rain hat, all of it the seat's colour: a round crown, the brim short and turned up in front, longer and low
  // behind (24 cm from the middle of the head: more would reach the canopy's hoop behind a kneeler)
  const hat = b.sphere(0.13, outfit.toque, { pos: [0, 0.895, -0.005], scale: [1, 0.74, 1], flat: true }, 12);
  b.cyl(0.17, 0.178, 0.02, outfit.toque, { pos: [0, 0.835, -0.05], rot: [-0.26, 0, 0], scale: [1, 1, 1.1], id: hat, flat: true }, 16);
  b.torus(0.131, 0.012, PAL.ink, { pos: [0, 0.853, -0.02], rot: [HALF_TURN - 0.26, 0, 0], id: hat, flat: true, kind: KIND.PLAIN }, 12);
  // the creel: a small wicker basket on the left hip, carried high and close at the small of the back (a kneeler
  // behind lays a paddle across at hip height), a lid, a peg, on a strap over the right shoulder
  const turn: Triple = [0, 0.2, 0];
  b.box(0.17, 0.095, 0.085, WICKER, { pos: [0.1, 0.26, -0.165], rot: turn, kind: KIND.CANE });
  b.box(0.18, 0.024, 0.095, WICKER_DARK, { pos: [0.1, 0.318, -0.165], rot: turn, kind: KIND.CANE });
  b.sphere(0.015, PAL.woodLight, { pos: [0.09, 0.298, -0.212], flat: true, kind: KIND.PLAIN }, 6);
  strap(b, 0.37, 0.215, 0.52, 0.15, LEATHER);
  finishTorso(rig, b);

  const { arm, leg } = CAST_BUILD.angler;
  plainLimbs(rig, 620, outfit, arm, leg, { size: 0.94, colour: MITT });
  [rig.L, rig.R].forEach((side, index) => {
    const at = 627 + index * 10;
    const trouser = inkOf(side.thigh);
    const boot = inkOf(side.boot);
    // the coat's skirt hangs on each thigh, to just above the knee and a little wider there: one outline with the
    // coat. It stops short of the knee so a kneeler's hem stays off the floor.
    redraw(side.thigh, at, (limb) => {
      rod(limb, leg, outfit.legs, trouser);
      limb.cyl(1.36, 1.1, 0.82, outfit.coat, { pos: [0, -0.09, 0], id: coat, flat: true, kind: KIND.CLOTH }, 10);
    });
    // tall boots: the shin, the knee and the foot are one boot
    redraw(side.shin, at + 1, (limb) => rod(limb, 1.1, RUBBER, boot, 1.04));
    redraw(side.knee, at + 2, (limb) => ball(limb, 0.95, RUBBER, boot));
    redraw(side.boot, at + 3, (limb) => limb.box(0.1, 0.09, 0.21, RUBBER, { id: boot, flat: true, kind: KIND.PLAIN }));
  });
}

/** Small and quick, first up every hill: a pointed hood and a short cape, a fringe and a braid, a map case slung across the back. */
function scout(rig: CastRig, outfit: CastOutfit): void {
  const b = torsoBuilder(rig, 63, CAST_BUILD.scout.scale);
  // a short narrow tunic and a belt with a pouch
  const tunic = b.cyl(0.1, 0.145, 0.42, outfit.coat, { pos: [0, 0.21, 0], flat: true }, 10);
  b.sphere(0.125, outfit.coat, { pos: [0, 0.428, 0], scale: [1.42, 0.5, 0.9], id: tunic, flat: true }, 10);
  b.torus(0.13, 0.016, LEATHER_DARK, { pos: [0, 0.14, 0], rot: [HALF_TURN, 0, 0], kind: KIND.PLAIN }, 12);
  b.box(0.07, 0.08, 0.045, LEATHER, { pos: [-0.085, 0.11, 0.12], rot: [0, -0.35, 0], kind: KIND.PLAIN });
  // the cape, the scout's own colour (the hood above it is the seat's): over the shoulders, short at the front and the sides, a point down the back
  const rings = 16;
  const cape: THREE.Vector3[][] = [[], [], [], []];
  for (let step = 0; step <= rings; step += 1) {
    const angle = (step / rings) * Math.PI * 2;
    const [across, ahead] = [Math.sin(angle), Math.cos(angle)];
    const back = Math.max(0, -ahead) ** 1.5;
    const front = Math.max(0, ahead);
    cape[0].push(new THREE.Vector3(across * 0.08, 0.5, ahead * 0.075));
    cape[1].push(new THREE.Vector3(across * 0.15, 0.48, ahead * 0.11));
    cape[2].push(new THREE.Vector3(across * 0.212, 0.435, ahead * (0.14 + 0.02 * back)));
    cape[3].push(new THREE.Vector3(across * 0.25, 0.325 + 0.04 * front - 0.155 * back, ahead * (0.155 + 0.045 * back)));
  }
  const cloak = nextId();
  b.grid(cape, () => outfit.coat, () => cloak, { kind: KIND.CLOTH });
  b.sphere(0.022, BRASS, { pos: [0, 0.47, 0.118], flat: true, kind: KIND.PLAIN }, 6);
  // a small fair face, a red fringe
  face(b, 0.645, 0.01, 0.125, SKIN_FAIR, [1, 1, 1], 0.05);
  const hair = b.sphere(0.06, RED_HAIR, { pos: [0, 0.719, 0.112], scale: [1.55, 0.5, 0.5], flat: true, kind: KIND.PLAIN }, 8);
  // the hood, up, its point standing up and back: it shows from the front
  b.sphere(0.15, outfit.toque, { pos: [0, 0.675, -0.045], scale: [1, 1, 0.95], id: cloak, flat: true }, 12);
  b.cone(0.085, 0.22, outfit.toque, { pos: [0, 0.775, -0.11], rot: [-0.6, 0, 0], id: cloak, flat: true }, 9);
  // a braid out of the side of the hood, down the front of the left shoulder, close to the body, tied with a ribbon
  b.tube([[0.118, 0.61, 0.005], [0.14, 0.53, 0.055], [0.132, 0.455, 0.1]], 0.023, RED_HAIR, { id: hair, flat: true, kind: KIND.ROPE, steps: 8 }, 6);
  b.sphere(0.028, PAL.rust, { pos: [0.131, 0.437, 0.106], flat: true, kind: KIND.PLAIN }, 7);
  // the map case: a leather tube slung low across the back, capped at both ends, lying on the cape under the
  // shoulder blades. Higher, today's stroke folds the upper hand's elbow into it; further out, it reaches the
  // gear behind a kneeler on a fully fitted canoe.
  const lean = HALF_TURN + 0.18;
  const tilt: Triple = [0, 0, lean];
  const [dx, dy] = [-Math.sin(lean), Math.cos(lean)];
  b.cyl(0.035, 0.035, 0.34, LEATHER, { pos: [0, 0.34, -0.19], rot: tilt, kind: KIND.PLAIN }, 9);
  for (const end of [-1, 1]) {
    b.cyl(0.04, 0.04, 0.04, LEATHER_DARK, { pos: [dx * end * 0.155, 0.34 + dy * end * 0.155, -0.19], rot: tilt, kind: KIND.PLAIN }, 9);
  }
  strap(b, 0.325, 0.206, 0.68, 0.158, LEATHER_DARK);
  finishTorso(rig, b);

  const { arm, leg } = CAST_BUILD.scout;
  plainLimbs(rig, 640, outfit, arm, leg, { size: 0.9, colour: '#6f5a4c' });
  [rig.L, rig.R].forEach((side, index) => redraw(side.boot, 648 + index * 10, (boots) => {
    boots.box(0.09, 0.08, 0.19, '#6b4a35', { id: inkOf(side.boot), flat: true, kind: KIND.PLAIN });
  }));
}

/** Every vertex of `mesh` in colour `from` takes colour `to`. */
function recolour(mesh: THREE.Mesh, from: string, to: string): void {
  const [was, now] = [new THREE.Color(from), new THREE.Color(to)];
  const colours = mesh.geometry.getAttribute('aColor');
  for (let index = 0; index < colours.count; index += 1) {
    if (Math.abs(colours.getX(index) - was.r) + Math.abs(colours.getY(index) - was.g) + Math.abs(colours.getZ(index) - was.b) < 1e-4) colours.setXYZ(index, now.r, now.g, now.b);
  }
  colours.needsUpdate = true;
}

/**
 * The voyageur keeps `createPaddler`'s drawing, only its coat and trousers turned from the seat's colours to the
 * voyageur's own. In seat 1 they are the same colours, so nothing is touched at all.
 */
function voyageur(rig: CastRig, seat: CastOutfit): void {
  const own = CAST_COATS.voyageur;
  const meshes = [rig.torso.children[0] as THREE.Mesh, ...[rig.L, rig.R].flatMap((side) => Object.values(side).filter((value): value is THREE.Mesh => value instanceof THREE.Mesh))];
  for (const [from, to] of [[seat.coat, own.coat], [seat.legs, own.legs]] as const) {
    if (from !== to) for (const mesh of meshes) recolour(mesh, from, to);
  }
}

const DRESS: Record<Exclude<CharacterId, 'voyageur'>, (rig: CastRig, outfit: CastOutfit) => void> = { trapper, angler, scout };

/**
 * Redraw the paddler's figure as one of the cast, in their own coat and the seat's headgear (`outfit` is the
 * seat's colours). The voyageur, and anything that is not one of the four, is `createPaddler`'s own drawing
 * in the voyageur's coat.
 */
export function dressAs(character: unknown, rig: CastRig, outfit: CastOutfit): void {
  const who = isCharacterId(character) ? character : 'voyageur';
  if (who === 'voyageur') voyageur(rig, outfit);
  else DRESS[who](rig, castOutfit(who, outfit));
}
