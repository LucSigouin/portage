/**
 * The tall pieces and the ones at the two ends: mast and sail, rudder,
 * lantern mast, winch, radio, rain catcher, flag and figurehead.
 *
 * Cloth moves, slowly, on the look's one clock. Nothing else here moves,
 * and nothing glows in pulses: a lamp is lit or it is not.
 */
import * as THREE from 'three';
import { cloth } from '../b2/geo.js';
import {
  BAMBOO, BOLT, CANVAS_DARK, CANVAS_LIGHT, COPPER, IRON, KIND, LOON, PAL, ROPE, SOOT, STEEL, THIN, WATER,
  hullOf, line, mountSpace, only, partBuilder, plate, rig,
} from './kit.ts';
import type { AttachmentBuilder, Triple } from './kit.ts';

const lerp = (from: THREE.Vector3, to: THREE.Vector3, share: number, lift = 0): Triple => {
  const point = from.clone().lerp(to, share);
  return [point.x, point.y + lift, point.z];
};

/** The mast and sail: a spruce mast stepped on the keelson, a boom over everyone's heads, a patched lugsail on a gaff. Down, it is furled on the boom. */
export const mastSailPart: AttachmentBuilder = (context) => {
  const hull = hullOf(context);
  const root = mountSpace(context);
  const z = context.mount[2];
  const [top, boom, throat] = [4.35, 1.62, 3.36];
  const tack = new THREE.Vector3(0.03, boom + 0.07, z + 0.09);
  const clew = new THREE.Vector3(0.4, boom + 0.17, z + 2.3);
  const head = new THREE.Vector3(0.02, throat, z + 0.07);
  const peak = new THREE.Vector3(0.3, 4.28, z + 1.4);

  const b = partBuilder(context, 102);
  b.beam([0, hull.floor + 0.02, z], [0, top, z], 0.055, PAL.wood, { r2: 0.032 }, 8);
  const partner = hull.gunwale(z) + 0.03;
  b.box(hull.halfBeam(z) * 2 + 0.1, 0.045, 0.085, PAL.woodDark, { pos: [0, partner, z] });
  b.cyl(0.085, 0.085, 0.07, IRON, { pos: [0, partner + 0.05, z], kind: KIND.METAL }, 8);
  for (const side of [-1, 1]) b.bolt(side * (hull.halfBeam(z) - 0.02), partner + 0.03, z, BOLT, 0.02);
  for (const turn of [0.4, 2.0, 3.6, 5.2]) b.box(0.03, 0.06, 0.045, PAL.woodLight, { pos: [Math.cos(turn) * 0.07, partner + 0.11, z + Math.sin(turn) * 0.07], rot: [0, -turn, 0] });
  b.sphere(0.055, PAL.rust, { pos: [0, top + 0.03, z] }, 8);
  // the boom, on an iron gooseneck, a little longer than the sail's foot
  const boomEnd = lerp(tack, clew, 1.07, -0.07);
  b.beam([0, boom, z + 0.04], boomEnd, 0.036, PAL.woodLight, { r2: 0.026 }, 7);
  b.box(0.15, 0.1, 0.13, IRON, { pos: [0, boom, z + 0.03], kind: KIND.METAL });
  for (const side of [-1, 1]) b.bolt(side * 0.08, boom, z + 0.05, BOLT, 0.015, 'x');
  // the sheet, belayed on the boom's end in a coil
  b.box(0.05, 0.07, 0.05, IRON, { pos: [boomEnd[0], boomEnd[1] - 0.06, boomEnd[2] - 0.08], kind: KIND.METAL });
  for (let turn = 0; turn < 3; turn += 1) b.torus(0.07 - turn * 0.01, 0.011, ROPE, { pos: [boomEnd[0], boomEnd[1] - 0.17 - turn * 0.01, boomEnd[2] - 0.08], rot: [0, 0.3 * turn, 0], kind: KIND.ROPE }, 12);
  // halyard made off on a cleat, shrouds to the rails, a forestay to the bow
  b.box(0.03, 0.14, 0.045, PAL.woodDark, { pos: [0.07, 1.0, z + 0.02] });
  for (let turn = 0; turn < 3; turn += 1) b.torus(0.075 - turn * 0.011, 0.012, ROPE, { pos: [0.095 + turn * 0.011, 0.9 - turn * 0.011, z + 0.02], rot: [0, Math.PI / 2, 0.2 * turn], kind: KIND.ROPE }, 12);
  rig(b, [0.055, 1.02, z + 0.02], [0.04, top - 0.25, z + 0.03], 0.007);
  for (const side of [-1, 1]) rig(b, [0, throat + 0.28, z], [side * hull.halfBeam(z + 0.13), hull.gunwale(z + 0.13) + 0.04, z + 0.13]);
  // the forestay comes down to the stem head, a hand to port of the lantern pole
  const stay = hull.bow * 0.975;
  rig(b, [0, top - 0.22, z], [-0.06, hull.gunwale(stay) + 0.06, stay]);

  // up: the gaff hoisted, the sail set
  const up = partBuilder(context, 122);
  up.beam([0, throat - 0.03, z + 0.03], lerp(head, peak, 1.1, 0.04), 0.03, PAL.woodLight, { r2: 0.022 }, 7);
  up.box(0.13, 0.09, 0.12, IRON, { pos: [0, throat - 0.03, z + 0.02], kind: KIND.METAL });
  for (const corner of [clew, peak]) for (const offset of [-0.03, 0, 0.03]) up.torus(0.042, 0.01, ROPE, { pos: [corner.x + offset * 0.3, corner.y - 0.03, corner.z + offset], rot: [0, 0.3, 0], id: 0.71, kind: KIND.ROPE }, 8);
  for (const y of [2.0, 2.4, 2.8, 3.15]) up.torus(0.075, 0.012, PAL.woodDark, { pos: [0, y, z], rot: [Math.PI / 2, 0, 0], id: 0.72 }, 10);
  const patch = (i: number, j: number): [string, number] | null => {
    if ((i === 2 || i === 3) && (j === 2 || j === 3)) return [PAL.rust, 0.81];
    if ((i === 5 || i === 6) && (j === 6 || j === 7)) return [PAL.canvasSage, 0.83];
    if (i === 1 && (j === 8 || j === 9)) return [PAL.ochre, 0.85];
    if (i === 6 && j === 1) return ['#8fa7b3', 0.87];
    if (i === 4 && j === 10) return [PAL.rustLight, 0.89];
    return null;
  };
  const patchRect: Record<string, [number, number, number, number]> = { 0.81: [2, 2, 4, 4], 0.83: [5, 6, 7, 8], 0.85: [1, 8, 2, 10], 0.87: [6, 1, 7, 2], 0.89: [4, 10, 5, 11] };
  const sail = cloth(
    8, 12,
    (i, j) => patch(i, j)?.[0] ?? (Math.floor(j / 3) % 2 ? CANVAS_DARK : CANVAS_LIGHT),
    (i, j) => patch(i, j)?.[1] ?? 0.2 + Math.floor(j / 3) * 0.02,
    { size: [tack.distanceTo(clew), tack.distanceTo(head)], patch: (i, j) => { const mended = patch(i, j); return mended ? patchRect[String(mended[1])] : null; } },
  );
  const normal = new THREE.Vector3().subVectors(clew, tack).cross(new THREE.Vector3().subVectors(head, tack)).normalize();
  if (normal.x < 0) normal.negate();
  const [foot, gaff] = [new THREE.Vector3(), new THREE.Vector3()];
  // The cloth breathes: one slow swell of the belly, and a luff so small and slow it never reads as a ripple.
  const fill = (time: number): void => {
    const belly = 0.3 + Math.sin(time * 0.5) * 0.035;
    (sail.userData.update as (place: (u: number, v: number, out: THREE.Vector3) => void) => void)((u, v, out) => {
      foot.lerpVectors(tack, clew, u);
      gaff.lerpVectors(head, peak, u);
      out.lerpVectors(foot, gaff, v);
      const swell = Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
      const luff = Math.sin(u * 5 - time * 0.7 + v * 3) * 0.008 * u * (0.4 + 0.6 * v);
      out.addScaledVector(normal, swell * belly + luff).applyMatrix4(root);
    });
  };
  fill(0);
  const raised = new THREE.Group();
  raised.add(up.mesh(), sail);

  // down: the gaff lowered onto the boom, the sail furled between them and tied with gaskets
  const down = partBuilder(context, 123);
  const along = (share: number, lift: number): Triple => lerp(tack, clew, share, lift);
  down.beam([0, boom + 0.27, z + 0.05], along(0.66, 0.2), 0.03, PAL.woodLight, { r2: 0.022 }, 7);
  down.box(0.13, 0.09, 0.12, IRON, { pos: [0, boom + 0.27, z + 0.04], kind: KIND.METAL });
  const lumps = 9;
  for (let lump = 0; lump < lumps; lump += 1) {
    const share = 0.05 + (lump / (lumps - 1)) * 0.86;
    const size = 0.085 + (lump % 3) * 0.012 - share * 0.02;
    down.sphere(size, lump % 2 ? CANVAS_DARK : CANVAS_LIGHT, { pos: along(share, 0.07), scale: [0.9, 0.95, 1.75], kind: KIND.CLOTH }, 8);
  }
  for (const share of [0.12, 0.33, 0.55, 0.77, 0.93]) down.torus(0.1 - share * 0.02, 0.011, ROPE, { pos: along(share, 0.05), id: 0.71, kind: KIND.ROPE }, 10);

  const lowered = down.mesh();
  const group = new THREE.Group();
  group.add(b.mesh(), raised, lowered);
  lowered.visible = false;
  return {
    object: group,
    update: (canoe, time) => {
      raised.visible = canoe.sailRaised;
      lowered.visible = !canoe.sailRaised;
      if (canoe.sailRaised) fill(time);
    },
  };
};

/** The rudder: a blade hung on the stern post, a yoke on its head, and two lines forward to the stern seat. */
export const rudderPart: AttachmentBuilder = (context) => {
  const b = partBuilder(context, 103);
  const hull = hullOf(context);
  const y = context.mount[1];
  const post = hull.stern + 0.05;
  const headY = hull.gunwale(hull.stern) + 0.2;
  b.beam([0, headY, post], [0, y - 0.42, post], 0.03, PAL.woodDark, {}, 6);
  b.box(0.036, 0.9, 0.38, PAL.rust, { pos: [0, y + 0.02, post + 0.2], kind: KIND.PAINT, axis: 1 });
  b.box(0.042, 0.085, 0.385, PAL.cream, { pos: [0, y + 0.3, post + 0.2], kind: KIND.PAINT });
  for (const rise of [0.42, 0.14, -0.14, -0.36]) for (const offset of [0.08, 0.3]) b.tack(0.022, y + rise, post + offset, 0.01);
  b.box(0.046, 0.04, 0.3, IRON, { pos: [0, y - 0.2, post + 0.15], kind: KIND.METAL });
  for (const strap of [y + 0.2, y + 0.5]) {
    b.box(0.066, 0.045, 0.2, IRON, { pos: [0, strap, post - 0.07], kind: KIND.METAL });
    for (const side of [-1, 1]) b.bolt(side * 0.036, strap, post - 0.12, BOLT, 0.016, 'x');
  }
  // the yoke, and the lines that work it
  b.box(0.42, 0.035, 0.055, PAL.woodLight, { pos: [0, headY - 0.03, post], kind: KIND.WOOD, axis: 0 });
  b.cyl(0.04, 0.04, 0.05, IRON, { pos: [0, headY, post], kind: KIND.METAL }, 7);
  const cleat = hull.seat(0) + 0.33;
  for (const side of [-1, 1]) {
    const end: Triple = [side * 0.19, headY - 0.03, post];
    const made: Triple = [side * (hull.halfBeam(cleat) + 0.005), hull.gunwale(cleat) + 0.06, cleat];
    b.torus(0.018, 0.006, IRON, { pos: end, rot: [Math.PI / 2, 0, 0], id: THIN, kind: KIND.PLAIN }, 7);
    line(b, [end, [(end[0] + made[0]) / 2, (end[1] + made[1]) / 2 - 0.04, (end[2] + made[2]) / 2], made], 0.007);
    b.box(0.03, 0.03, 0.1, PAL.woodDark, { pos: [made[0], made[1] - 0.02, made[2]] });
  }
  return only(b.mesh());
};

/** The lantern mast: a pole through the bow deck, an iron crook, and a jar lamp under a tin cap. Lit or dark by the canoe's own state. */
export const lanternMastPart: AttachmentBuilder = (context) => {
  const b = partBuilder(context, 105);
  const hull = hullOf(context);
  const [, y, z] = context.mount;
  const deck = hull.gunwale(z) + 0.02;
  b.beam([0, y, z], [0, 1.52, z], 0.03, PAL.wood, { r2: 0.024 }, 7);
  plate(b, 0, deck, z, 0.17, 0.17);
  b.cyl(0.045, 0.045, 0.05, IRON, { pos: [0, deck + 0.04, z], kind: KIND.METAL }, 8);
  const hook: Triple = [0, 1.72, z - 0.36];
  b.tube([[0, 1.48, z], [0, 1.7, z - 0.03], [0, 1.82, z - 0.18], hook], 0.018, IRON, { steps: 18, kind: KIND.METAL }, 6);
  for (const band of [1.44, 1.5]) b.torus(0.031, 0.008, IRON, { pos: [0, band, z], rot: [Math.PI / 2, 0, 0], kind: KIND.METAL }, 8);
  for (const side of [-1, 1]) rig(b, [0, 1.25, z], [side * hull.halfBeam(z + 0.3), hull.gunwale(z + 0.3) + 0.03, z + 0.3], 0.006);
  const lamp = (lit: boolean): THREE.Mesh => {
    const l = partBuilder(context, 115);
    const [, hy, hz] = hook;
    l.torus(0.03, 0.007, IRON, { pos: [0, hy - 0.035, hz], kind: KIND.METAL }, 8);
    l.cone(0.095, 0.075, PAL.tin, { pos: [0, hy - 0.1, hz], kind: KIND.METAL }, 8);
    l.cyl(0.066, 0.074, 0.17, lit ? PAL.glow : '#8d8672', { pos: [0, hy - 0.225, hz], glow: lit ? 1 : 0, flat: true, kind: KIND.PLAIN }, 8);
    l.cyl(0.085, 0.085, 0.035, IRON, { pos: [0, hy - 0.325, hz], kind: KIND.METAL }, 8);
    for (let bar = 0; bar < 4; bar += 1) {
      const turn = (bar / 4) * Math.PI * 2 + 0.4;
      l.beam([Math.cos(turn) * 0.08, hy - 0.13, hz + Math.sin(turn) * 0.08], [Math.cos(turn) * 0.084, hy - 0.31, hz + Math.sin(turn) * 0.084], 0.006, IRON, { id: THIN, kind: KIND.PLAIN }, 4);
    }
    return l.mesh();
  };
  const [lit, dark] = [lamp(true), lamp(false)];
  const group = new THREE.Group();
  group.add(b.mesh(), lit, dark);
  lit.visible = false;
  return {
    object: group,
    update: (canoe) => {
      lit.visible = canoe.lanternLit;
      dark.visible = !canoe.lanternLit;
    },
  };
};

/** The winch: a samson post on the bow deck, a jib out over the starboard bow, a drum of cable with a crank, and a sea chest on the hook. */
export const winchPart: AttachmentBuilder = (context) => {
  const b = partBuilder(context, 113);
  const hull = hullOf(context);
  const [x, , z] = context.mount;
  const deck = hull.gunwale(z) + 0.02;
  const postZ = z - 0.14;
  b.box(0.3, 0.03, 0.36, IRON, { pos: [x, deck + 0.015, z - 0.1], kind: KIND.METAL });
  for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) b.bolt(x + sideX * 0.12, deck + 0.04, z - 0.1 + sideZ * 0.15, BOLT, 0.018);
  const postTop: Triple = [x, deck + 0.66, postZ];
  b.beam([x, deck, postZ], postTop, 0.045, PAL.woodDark, {}, 7);
  b.cyl(0.052, 0.052, 0.05, IRON, { pos: [x, deck + 0.63, postZ], kind: KIND.METAL }, 8);
  const tip: Triple = [x + 0.74, deck + 1.1, z - 0.62];
  b.beam([x + 0.03, deck + 0.12, postZ - 0.02], tip, 0.036, PAL.woodDark, { r2: 0.026 }, 7);
  b.box(0.1, 0.09, 0.1, IRON, { pos: [x + 0.03, deck + 0.13, postZ - 0.02], kind: KIND.METAL });
  rig(b, postTop, tip, 0.008);
  rig(b, postTop, [-hull.halfBeam(z + 0.02), hull.gunwale(z + 0.02) + 0.03, z + 0.02], 0.008);
  // the drum between two cheeks on the aft face of the post, its crank inboard
  const drum: Triple = [x, deck + 0.33, z + 0.01];
  for (const side of [-1, 1]) b.box(0.03, 0.3, 0.15, PAL.wood, { pos: [x + side * 0.115, deck + 0.18, z] });
  b.cyl(0.075, 0.075, 0.19, STEEL, { pos: drum, rot: [0, 0, Math.PI / 2], kind: KIND.ROPE }, 10);
  for (const side of [-1, 1]) b.cyl(0.115, 0.115, 0.016, IRON, { pos: [x + side * 0.097, drum[1], drum[2]], rot: [0, 0, Math.PI / 2], kind: KIND.METAL }, 10);
  b.beam([x - 0.13, drum[1], drum[2]], [x - 0.19, drum[1], drum[2]], 0.012, IRON, { kind: KIND.METAL }, 5);
  b.beam([x - 0.19, drum[1], drum[2]], [x - 0.19, drum[1] + 0.15, drum[2] + 0.06], 0.012, IRON, { kind: KIND.METAL }, 5);
  b.beam([x - 0.19, drum[1] + 0.15, drum[2] + 0.06], [x - 0.28, drum[1] + 0.15, drum[2] + 0.06], 0.019, PAL.woodLight, {}, 5);
  // cable over the sheave at the jib's head, down to the hook
  b.cyl(0.06, 0.06, 0.04, IRON, { pos: [tip[0], tip[1] - 0.03, tip[2]], rot: [Math.PI / 2, 0, 0.8], kind: KIND.METAL }, 8);
  rig(b, [x, drum[1] + 0.07, drum[2]], [tip[0] - 0.02, tip[1], tip[2]], 0.008);
  const hookY = 0.66;
  rig(b, [tip[0], tip[1] - 0.06, tip[2]], [tip[0], hookY, tip[2]], 0.008);
  b.torus(0.045, 0.013, IRON, { pos: [tip[0], hookY - 0.04, tip[2]], rot: [0, 0.7, 0], kind: KIND.METAL }, 8);
  // the catch: a sea chest out of the flood, slung in rope, weed still on it
  const chest: Triple = [tip[0], 0.3, tip[2]];
  for (const side of [-1, 1]) rig(b, [tip[0], hookY - 0.08, tip[2]], [chest[0] + side * 0.15, chest[1] + 0.1, chest[2]], 0.006);
  const turn = 0.5;
  b.box(0.32, 0.2, 0.2, '#6d5847', { pos: chest, rot: [0.06, turn, 0.05], kind: KIND.WOOD, axis: 0 });
  b.box(0.33, 0.035, 0.21, '#57463a', { pos: [chest[0], chest[1] + 0.11, chest[2]], rot: [0.06, turn, 0.05] });
  for (const band of [-0.1, 0.1]) b.box(0.03, 0.215, 0.215, PAL.tin, { pos: [chest[0] + Math.cos(turn) * band, chest[1] + 0.005, chest[2] - Math.sin(turn) * band], rot: [0.06, turn, 0.05], kind: KIND.METAL });
  b.tube([[chest[0] - 0.12, chest[1] + 0.13, chest[2] + 0.07], [chest[0] - 0.02, chest[1] + 0.14, chest[2] + 0.11], [chest[0] + 0.04, chest[1] + 0.02, chest[2] + 0.13], [chest[0] + 0.02, chest[1] - 0.16, chest[2] + 0.12]], 0.014, PAL.sageDeep, { steps: 10, id: THIN, kind: KIND.PLAIN }, 5);
  return only(b.mesh());
};

/** The radio: a plank shack on the stern deck with the crystal set in its doorway, and a whip aerial with a red lamp that stays lit. */
export const radioPart: AttachmentBuilder = (context) => {
  const b = partBuilder(context, 114);
  const hull = hullOf(context);
  const [x, , z] = context.mount;
  const deck = hull.gunwale(z) + 0.02;
  const centre = x + 0.06;
  const [width, height, depth] = [0.3, 0.32, 0.26];
  b.box(width, height, depth, '#b08a5e', { pos: [centre, deck + height / 2, z + 0.01], kind: KIND.SIDING, seed: 0.08 });
  for (const side of [-1, 1]) b.box(0.03, height, 0.03, PAL.woodDark, { pos: [centre + side * (width / 2), deck + height / 2, z + 0.01 - depth / 2] });
  // the doorway faces the stern seat: the set, its dial and two knobs
  const door = z + 0.01 - depth / 2;
  b.box(0.22, 0.22, 0.014, SOOT, { pos: [centre, deck + 0.17, door - 0.002], flat: true, kind: KIND.PLAIN });
  const set = b.box(0.18, 0.13, 0.03, '#8fa18b', { pos: [centre, deck + 0.15, door - 0.015], kind: KIND.METAL });
  b.cyl(0.035, 0.035, 0.014, PAL.ochre, { pos: [centre - 0.04, deck + 0.16, door - 0.034], rot: [Math.PI / 2, 0, 0], id: set, flat: true, kind: KIND.PLAIN }, 9);
  for (const knob of [0.035, 0.07]) b.cyl(0.012, 0.012, 0.014, PAL.cream, { pos: [centre + knob, deck + 0.13, door - 0.034], rot: [Math.PI / 2, 0, 0], flat: true, kind: KIND.PLAIN }, 6);
  // a tin roof pitched aft, a coil of spare copper on it, the headset on a peg
  const roof = deck + height + 0.03;
  b.box(width + 0.08, 0.018, depth + 0.1, PAL.tin, { pos: [centre, roof, z + 0.01], rot: [0.22, 0, 0], kind: KIND.METAL });
  for (const side of [-1, 1]) for (const end of [-1, 1]) b.tack(centre + side * 0.15, roof + 0.012 - end * 0.035, z + 0.01 + end * 0.14, 0.009, '#6f7678');
  for (let turn = 0; turn < 3; turn += 1) b.torus(0.05, 0.01, COPPER, { pos: [centre - 0.06, roof + 0.03 + turn * 0.016, z - 0.02], rot: [Math.PI / 2 + 0.22, 0, 0], kind: KIND.METAL }, 10);
  b.torus(0.05, 0.007, SOOT, { pos: [centre + width / 2 + 0.012, deck + 0.2, z + 0.03], rot: [0, Math.PI / 2, 0], id: THIN, kind: KIND.PLAIN }, 10);
  for (const cup of [-0.05, 0.05]) b.cyl(0.026, 0.026, 0.02, PAL.ochre, { pos: [centre + width / 2 + 0.016, deck + 0.2, z + 0.03 + cup], rot: [0, 0, Math.PI / 2], flat: true, kind: KIND.PLAIN }, 8);
  // the aerial: a whip with three spreaders, stayed to the rail and the stern, a red lamp at its head
  const foot: Triple = [centre + 0.1, roof - 0.02, z + 0.11];
  const tall = 3.05;
  b.beam(foot, [foot[0], tall, foot[2]], 0.018, '#7b878b', { r2: 0.008, kind: KIND.METAL }, 6);
  for (let ring = 0; ring < 5; ring += 1) b.torus(0.03, 0.008, COPPER, { pos: [foot[0], foot[1] + 0.06 + ring * 0.035, foot[2]], rot: [Math.PI / 2, 0, 0], id: 0.77, kind: KIND.METAL }, 8);
  for (const [rise, half] of [[2.2, 0.34], [2.5, 0.26], [2.8, 0.18]]) {
    b.beam([foot[0], rise, foot[2] - half], [foot[0], rise, foot[2] + half], 0.011, '#7b878b', { kind: KIND.METAL }, 4);
    b.box(0.045, 0.045, 0.045, IRON, { pos: [foot[0], rise, foot[2]], kind: KIND.METAL });
  }
  b.sphere(0.04, '#d2553d', { pos: [foot[0], tall + 0.03, foot[2]], glow: 0.7, flat: true }, 7);
  rig(b, [foot[0], 1.9, foot[2]], [hull.halfBeam(z - 0.04), hull.gunwale(z - 0.04) + 0.03, z - 0.04], 0.005);
  rig(b, [foot[0], 1.9, foot[2]], [0, hull.gunwale(hull.stern) + 0.05, hull.stern - 0.06], 0.005);
  return only(b.mesh());
};

/**
 * The rain catcher: a canvas funnel on a frame over the port stern quarter, draining to a pail on the deck.
 * The water in the pail stands at `rainProgress`: how far along the next clean water is.
 */
export const rainCatcherPart: AttachmentBuilder = (context) => {
  const b = partBuilder(context, 111);
  const hull = hullOf(context);
  const [x, y, z] = context.mount;
  // on the short hulls the frame starts behind the stern paddler's back
  const [z0, z1] = [Math.max(z - 0.22, hull.seat(0) + 0.3), z + 0.3];
  const mid = (z0 + z1) / 2;
  // the frame leans out over the quarter: two long poles off the rail, two short ones off the deck
  const corners: Triple[] = [[x - 0.32, y + 0.3, z0], [x + 0.3, y + 0.14, z0], [x - 0.3, y + 0.34, z1], [x + 0.3, y + 0.18, z1]];
  corners.forEach((corner, index) => {
    const at = corner[2];
    const outboard = index % 2 === 0;
    const foot: Triple = outboard ? [-hull.halfBeam(at), hull.gunwale(at), at] : [x + 0.27, hull.gunwale(at) + 0.03, at];
    b.beam(foot, corner, 0.02, BAMBOO, {}, 6);
    b.box(0.08, 0.045, 0.08, IRON, { pos: [foot[0], foot[1] + 0.012, foot[2]], kind: KIND.METAL });
    b.bolt(foot[0], foot[1] + 0.04, foot[2] + 0.05, BOLT, 0.014);
    for (const turn of [-0.022, 0.022]) b.torus(0.032, 0.008, ROPE, { pos: [corner[0], corner[1] - 0.045 + turn, corner[2]], rot: [Math.PI / 2, 0, 0], id: 0.71, kind: KIND.ROPE }, 8);
  });
  b.beam(corners[0], corners[2], 0.014, BAMBOO, {}, 5);
  b.beam(corners[1], corners[3], 0.014, BAMBOO, {}, 5);
  // the canvas, sagging to a tin spout at its lowest point
  const cells = 8;
  const points: THREE.Vector3[][] = [];
  for (let i = 0; i <= cells; i += 1) {
    points.push([]);
    for (let j = 0; j <= cells; j += 1) {
      const [u, v] = [i / cells, j / cells];
      const point = new THREE.Vector3(...corners[0]).lerp(new THREE.Vector3(...corners[1]), u);
      point.lerp(new THREE.Vector3(...corners[2]).lerp(new THREE.Vector3(...corners[3]), u), v);
      point.y -= 0.25 * Math.pow((1 - (2 * u - 1) ** 2) * (1 - (2 * v - 1) ** 2), 0.8);
      points[i].push(point);
    }
  }
  const middle = (i: number, j: number): boolean => (i === 3 || i === 4) && (j === 3 || j === 4);
  const mend = (i: number, j: number): boolean => (i === 5 || i === 6) && j === 1;
  b.grid(
    points,
    (i, j) => (middle(i, j) ? '#a9822f' : mend(i, j) ? '#e6dcc0' : '#d3a747'),
    (i, j) => (mend(i, j) ? 0.47 : middle(i, j) ? 0.44 : 0.41),
    { kind: (i, j) => (mend(i, j) ? KIND.PATCH : KIND.CLOTH), tex: (vi, vj, i, j) => (mend(i, j) ? [(vi - 5) * 0.08, (vj - 1) * 0.065, 0.16, 0.065] : null) },
  );
  const low = points[4][4];
  const pail: Triple = [x + 0.17, hull.gunwale(mid) + 0.035, mid];
  const pailHeight = 0.22;
  b.tube([[low.x, low.y + 0.01, low.z], [low.x + 0.05, low.y - 0.07, low.z], [pail[0], pail[1] + pailHeight + 0.06, pail[2]]], 0.018, PAL.tin, { steps: 8, kind: KIND.METAL }, 6);
  // the pail is open at the top, so the water in it shows from the paddling camera
  b.add(new THREE.CylinderGeometry(0.085, 0.075, pailHeight, 12, 1, true), PAL.tin, { pos: [pail[0], pail[1] + pailHeight / 2, pail[2]], kind: KIND.METAL });
  b.cyl(0.075, 0.075, 0.012, IRON, { pos: [pail[0], pail[1] + 0.006, pail[2]], kind: KIND.METAL }, 12);
  b.torus(0.086, 0.007, IRON, { pos: [pail[0], pail[1] + pailHeight, pail[2]], rot: [Math.PI / 2, 0, 0], kind: KIND.METAL }, 12);
  const water = partBuilder(context, 131);
  water.cyl(0.072, 0.072, 0.008, WATER, { pos: pail, flat: true, kind: KIND.PLAIN }, 12);
  const level = water.mesh();
  // The mount is tilted, so "up the pail" is not the mount's own y: slide the water along the canoe's up.
  const upward = new THREE.Vector3(0, 1, 0).transformDirection(mountSpace(context));
  const group = new THREE.Group();
  group.add(b.mesh(), level);
  return {
    object: group,
    update: (canoe) => {
      const rise = 0.02 + Math.max(0, Math.min(1, canoe.rainProgress)) * (pailHeight - 0.05);
      level.position.copy(upward).multiplyScalar(rise);
    },
  };
};

/** The flag: Wren's red pennant on a raked staff, carried on an iron bracket off the stern rail. It trails aft and moves slowly. */
export const flagPart: AttachmentBuilder = (context) => {
  const b = partBuilder(context, 124);
  const hull = hullOf(context);
  const root = mountSpace(context);
  const [x, y, z] = context.mount;
  const rail = z - 0.14;
  b.tube([[hull.halfBeam(rail) - 0.02, hull.gunwale(rail) + 0.01, rail], [(hull.halfBeam(rail) + x) / 2, y - 0.05, z - 0.07], [x, y, z]], 0.014, IRON, { steps: 8, kind: KIND.METAL }, 5);
  b.bolt(hull.halfBeam(rail) - 0.02, hull.gunwale(rail) + 0.03, rail, BOLT, 0.014);
  b.cyl(0.028, 0.028, 0.07, IRON, { pos: [x, y + 0.02, z], kind: KIND.METAL }, 7);
  const staffTop: Triple = [x, y + 1.08, z + 0.1];
  b.beam([x, y, z], staffTop, 0.014, PAL.woodDark, {}, 5);
  b.sphere(0.026, PAL.ochre, { pos: [staffTop[0], staffTop[1] + 0.02, staffTop[2]] }, 7);
  for (const tie of [0.06, 0.3]) b.torus(0.018, 0.005, ROPE, { pos: [x, staffTop[1] - tie, staffTop[2] - tie * 0.09], rot: [Math.PI / 2, 0, 0], id: THIN, kind: KIND.PLAIN }, 6);
  // the halyard down the staff to a cleat, a brass collar where the staff was scarfed
  b.box(0.02, 0.07, 0.03, PAL.woodLight, { pos: [x, y + 0.3, z + 0.045] });
  b.beam([x, y + 0.3, z + 0.05], [x, staffTop[1] - 0.04, staffTop[2] + 0.02], 0.004, ROPE, { id: THIN, kind: KIND.PLAIN }, 4);
  b.cyl(0.02, 0.02, 0.05, '#c9a14a', { pos: [x, y + 0.52, z + 0.048], rot: [0.09, 0, 0], kind: KIND.METAL }, 7);
  b.bolt(x, y + 0.02, z - 0.03, BOLT, 0.012, 'z');
  b.box(0.05, 0.02, 0.05, IRON, { pos: [x, y - 0.02, z], kind: KIND.METAL });
  const [fly, hoist] = [0.78, 0.3];
  const pennant = cloth(7, 2, (i) => (i === 0 ? PAL.cream : PAL.rust), (i) => (i === 0 ? 0.905 : 0.9), { size: [fly, hoist] });
  const wave = (time: number): void => {
    (pennant.userData.update as (place: (u: number, v: number, out: THREE.Vector3) => void) => void)((u, v, out) => {
      const tall = hoist * (1 - 0.8 * u);
      const sway = Math.sin(u * 4 - time * 1.1) * 0.04 * u;
      const lift = Math.cos(u * 3 - time * 0.9) * 0.014 * u - u * 0.1;
      out.set(x + sway, staffTop[1] - 0.18 + (v - 0.5) * tall + lift, staffTop[2] - 0.012 + u * fly).applyMatrix4(root);
    });
  };
  wave(0);
  const group = new THREE.Group();
  group.add(b.mesh(), pennant);
  return { object: group, update: (_canoe, time) => wave(time) };
};

/** The figurehead: Tink's cedar loon on the stem, black head and necklace, checkered back, a red eye, the bill leading the way. */
export const figureheadPart: AttachmentBuilder = (context) => {
  const b = partBuilder(context, 125);
  const [, y, z] = context.mount;
  const cedar = '#a8754c';
  // the knee that carries it, strapped to the stem
  b.box(0.06, 0.22, 0.2, cedar, { pos: [0, y + 0.02, z + 0.05], kind: KIND.WOOD, axis: 2 });
  b.box(0.075, 0.035, 0.13, IRON, { pos: [0, y + 0.07, z + 0.09], kind: KIND.METAL });
  for (const side of [-1, 1]) b.bolt(side * 0.04, y + 0.07, z + 0.12, BOLT, 0.014, 'x');
  // body riding ahead of the stem, cedar below and painted above
  b.sphere(1, cedar, { pos: [0, y + 0.07, z - 0.15], scale: [0.1, 0.1, 0.25], kind: KIND.WOOD, axis: 2 }, 10);
  const back = b.sphere(1, LOON, { pos: [0, y + 0.115, z - 0.13], scale: [0.108, 0.085, 0.24], kind: KIND.PAINT }, 10);
  b.sphere(1, PAL.cream, { pos: [0, y + 0.07, z - 0.3], scale: [0.085, 0.095, 0.11], kind: KIND.PAINT }, 9);
  b.cone(0.07, 0.2, LOON, { pos: [0, y + 0.17, z + 0.1], rot: [0.95, 0, 0], scale: [1, 1, 0.5], id: back, kind: KIND.PAINT }, 6);
  // the checkered back
  for (let row = 0; row < 4; row += 1) for (const side of [-1, 1]) for (const across of [0.025, 0.06]) {
    b.box(0.022, 0.012, 0.03, PAL.cream, { pos: [side * across, y + 0.197 - across * 0.45 - Math.abs(row - 1.5) * 0.008, z - 0.26 + row * 0.085 + (across > 0.04 ? 0.03 : 0)], id: back, flat: true, kind: KIND.PLAIN });
  }
  // neck, necklace, head, bill, eye
  const crown: Triple = [0, y + 0.58, z - 0.42];
  const neck = b.tube([[0, y + 0.13, z - 0.29], [0, y + 0.3, z - 0.37], [0, y + 0.45, z - 0.365], crown], 0.048, LOON, { steps: 14, kind: KIND.PAINT }, 8);
  for (const [rise, forward] of [[0.3, -0.37], [0.345, -0.372]]) b.torus(0.05, 0.011, PAL.cream, { pos: [0, y + rise, z + forward], rot: [Math.PI / 2 - 0.2, 0, 0], kind: KIND.PAINT }, 10);
  b.sphere(0.07, '#2a3134', { pos: crown, scale: [0.86, 0.86, 1.15], id: neck, kind: KIND.PAINT }, 10);
  b.cone(0.027, 0.18, '#4a525c', { pos: [0, crown[1] - 0.005, crown[2] - 0.155], rot: [-Math.PI / 2, 0, 0], kind: KIND.PAINT }, 6);
  for (const side of [-1, 1]) b.sphere(0.013, '#c8372b', { pos: [side * 0.052, crown[1] + 0.012, crown[2] - 0.035], flat: true, kind: KIND.PLAIN }, 6);
  return only(b.mesh());
};
