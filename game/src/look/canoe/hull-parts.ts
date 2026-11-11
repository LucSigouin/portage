/**
 * The pieces that live inside the hull or on its rails amidships: cargo
 * rack, firebox, map table, fishing rig and canopy. Each is laid out round
 * the crew: the seats come from the rules, and a piece takes the room
 * between two of them.
 */
import * as THREE from 'three';
import {
  BAMBOO, BOLT, BRASS, CLAY, EMBER, GLASS, IRON, KIND, PAL, PAPER, RIG, ROPE, SOOT, STEEL, THIN,
  hullOf, line, only, partBuilder, rig,
} from './kit.ts';
import type { AttachmentBuilder, Triple } from './kit.ts';

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

/** The cargo rack: slatted shelves low along both sides, and a lashed stack behind the thwart. The middle stays clear to kneel in. */
export const cargoRackPart: AttachmentBuilder = (context) => {
  const b = partBuilder(context, 104);
  const hull = hullOf(context);
  const [, y, z] = context.mount;
  // the shelves stop short of the stern paddler's feet
  const [z0, z1] = [z - 0.5, Math.min(z + 0.5, hull.seat(0) - 0.72)];
  /** A place along the shelves: 0 at their forward end, 1 at their aft end. */
  const along = (share: number): number => z0 + (z1 - z0) * share;
  for (const side of [-1, 1]) {
    const outer = (at: number): number => hull.halfBeam(at) - 0.07;
    for (const [inset, tone] of [[0.1, PAL.woodLight], [0.035, PAL.wood]] as const) {
      b.plank([side * (outer(z0) - inset), y, z0], [side * (outer(z1) - inset), y, z1], 0.06, 0.016, tone, { kind: KIND.WOOD });
    }
    for (const at of [z0 + 0.08, z, z1 - 0.08]) {
      b.box(0.14, 0.022, 0.04, PAL.woodDark, { pos: [side * (outer(at) - 0.065), y - 0.018, at] });
      b.tack(side * (outer(at) - 0.06), y + 0.01, at, 0.008);
    }
  }
  // port shelf, all of it under the paddling hand: a folded blanket, two tins, a flat crate
  const port = (at: number): number => -(hull.halfBeam(at) - 0.135);
  b.box(0.1, 0.045, 0.3, PAL.cream, { pos: [port(along(0.24)), y + 0.031, along(0.24)], kind: KIND.CLOTH });
  for (const strap of [-0.09, 0.09]) b.box(0.104, 0.049, 0.035, PAL.rust, { pos: [port(along(0.24)), y + 0.031, along(0.24) + strap], kind: KIND.CLOTH });
  for (const [share, colour] of [[0.55, PAL.tin], [0.66, PAL.ochre]] as const) b.cyl(0.04, 0.04, 0.06, colour, { pos: [port(along(share)), y + 0.04, along(share)], kind: KIND.METAL }, 8);
  b.box(0.11, 0.08, 0.18, '#c9914b', { pos: [port(along(0.87)), y + 0.05, along(0.87)], kind: KIND.WOOD, axis: 2 });
  b.box(0.115, 0.02, 0.185, PAL.rustDark, { pos: [port(along(0.87)), y + 0.07, along(0.87)] });
  // starboard shelf lies low, under the bailing arm: a folded tarp, a flat coil, a bundle of stakes
  const starboard = (at: number): number => hull.halfBeam(at) - 0.135;
  b.box(0.12, 0.05, 0.26, PAL.canvasSage, { pos: [starboard(along(0.22)), y + 0.035, along(0.22)], kind: KIND.CLOTH });
  b.box(0.125, 0.012, 0.03, PAL.woodDark, { pos: [starboard(along(0.22)), y + 0.062, along(0.22)] });
  for (const [radius, lift] of [[0.05, 0.02], [0.036, 0.036]] as const) b.torus(radius, 0.014, ROPE, { pos: [starboard(along(0.55)), y + lift, along(0.55)], rot: [Math.PI / 2, 0, 0], kind: KIND.ROPE }, 12);
  for (let stake = 0; stake < 3; stake += 1) b.beam([starboard(along(0.68)) - 0.03 + stake * 0.03, y + 0.03, along(0.68)], [starboard(along(0.96)) - 0.03 + stake * 0.03, y + 0.03, along(0.96)], 0.013, BAMBOO, {}, 5);
  // the stack behind the thwart, as deep as the room before the first kneeler's knees
  const depth = clamp(hull.seat(2) - 0.36 + 0.06 - 0.14, 0.14, 0.2);
  const stack = -0.04 + depth / 2;
  const crateTop = hull.floor + 0.17;
  b.box(0.34, 0.17, depth, '#c9914b', { pos: [-0.07, hull.floor + 0.085, stack], kind: KIND.WOOD, axis: 0 });
  b.box(0.35, 0.03, depth + 0.01, PAL.rustDark, { pos: [-0.07, hull.floor + 0.125, stack] });
  b.stencil('TEA', [-0.19, hull.floor + 0.04, stack + depth / 2 + 0.006], [1, 0, 0], [0, 1, 0], 0.07, '#4a3a2c');
  b.cyl(0.075, 0.075, 0.17, PAL.barrelBlue, { pos: [0.2, hull.floor + 0.085, stack], kind: KIND.METAL }, 10);
  b.cyl(0.08, 0.08, 0.03, '#476579', { pos: [0.2, hull.floor + 0.13, stack], kind: KIND.METAL }, 10);
  line(b, [[-0.26, hull.floor + 0.02, stack], [-0.25, crateTop + 0.012, stack], [0.1, crateTop + 0.012, stack], [0.2, crateTop + 0.014, stack], [0.3, hull.floor + 0.02, stack]], 0.009);
  return only(b.mesh());
};

/** The firebox: a clay-lined iron box on a stone slab, a pot on top, the draught glowing aft. */
export const fireboxPart: AttachmentBuilder = (context) => {
  const b = partBuilder(context, 107);
  const [, y, z] = context.mount;
  // the slab takes the room between the bow paddler's back and the kneeler's knees: a hand and a half
  const centre = z - 0.105;
  b.box(0.58, 0.05, 0.11, PAL.granite, { pos: [0, y - 0.025, centre], kind: KIND.STONE });
  for (const side of [-1, 1]) b.box(0.1, 0.04, 0.1, PAL.graniteDark, { pos: [side * 0.33, y - 0.03, centre], rot: [0, side * 0.15, 0], kind: KIND.STONE });
  const box = b.box(0.48, 0.085, 0.09, IRON, { pos: [0, y + 0.0425, centre], kind: KIND.METAL });
  b.box(0.51, 0.018, 0.1, CLAY, { pos: [0, y + 0.092, centre], kind: KIND.PLAIN });
  for (const side of [-1, 1]) for (const rise of [0.02, 0.062]) b.tack(side * 0.225, y + rise, centre + 0.047, 0.009, STEEL);
  // draught slots on the aft face, the fire door to port
  for (const slot of [-0.16, -0.08, 0, 0.08, 0.16]) b.box(0.045, 0.05, 0.012, EMBER, { pos: [slot, y + 0.04, centre + 0.046], glow: 1, flat: true, id: box });
  b.box(0.012, 0.06, 0.07, SOOT, { pos: [-0.242, y + 0.043, centre], flat: true, kind: KIND.PLAIN });
  b.box(0.014, 0.03, 0.05, PAL.glow, { pos: [-0.244, y + 0.04, centre], glow: 1, flat: true });
  // the pot, its lid and bail
  b.cyl(0.055, 0.048, 0.075, PAL.tin, { pos: [0.13, y + 0.138, centre], kind: KIND.METAL }, 10);
  b.cyl(0.058, 0.058, 0.012, IRON, { pos: [0.13, y + 0.18, centre], kind: KIND.METAL }, 10);
  b.sphere(0.013, PAL.woodDark, { pos: [0.13, y + 0.194, centre] }, 6);
  b.torus(0.055, 0.005, IRON, { pos: [0.13, y + 0.17, centre], rot: [0, 0, 0], id: THIN, kind: KIND.PLAIN }, 10);
  for (const side of [-1, 1]) b.torus(0.03, 0.006, STEEL, { pos: [side * 0.248, y + 0.055, centre], rot: [0, Math.PI / 2, 0], kind: KIND.METAL }, 8);
  // the kettle beside it
  const kettle = b.sphere(0.05, PAL.tin, { pos: [-0.11, y + 0.14, centre], scale: [1, 0.8, 0.9], kind: KIND.METAL }, 9);
  b.cone(0.016, 0.07, PAL.tin, { pos: [-0.175, y + 0.155, centre], rot: [0, 0, 1.0], id: kettle, kind: KIND.METAL }, 6);
  b.torus(0.036, 0.006, IRON, { pos: [-0.11, y + 0.185, centre], id: THIN, kind: KIND.PLAIN }, 8);
  // a poker laid on the slab
  b.beam([-0.27, y + 0.012, centre - 0.045], [0.27, y + 0.012, centre - 0.05], 0.007, IRON, { id: THIN, kind: KIND.PLAIN }, 4);
  return only(b.mesh());
};

/** The map table: a chart board across the rails, the lens on its arm, the lodestone hung over a bearing ring. */
export const mapTablePart: AttachmentBuilder = (context) => {
  const b = partBuilder(context, 116);
  const hull = hullOf(context);
  const [, y] = context.mount;
  // it sits between the kneeler's back and the stern paddler's knees
  // On the short hulls there is not room for both: the stern paddler, who is always aboard, comes first.
  const end = hull.seat(0) - 0.64;
  const from = Math.min(Math.max(hull.seat(2) + 0.25, end - 0.34), end - 0.24);
  const depth = end - from;
  const z = from + depth / 2;
  const half = hull.halfBeam(z) + 0.03;
  b.box(half * 2, 0.028, depth, PAL.woodLight, { pos: [0, y, z], kind: KIND.WOOD, axis: 0 });
  for (const side of [-1, 1]) {
    b.box(0.05, 0.06, depth - 0.04, PAL.woodDark, { pos: [side * (half - 0.07), y - 0.042, z] });
    b.bolt(side * (half - 0.05), y + 0.02, z - depth / 2 + 0.05, BOLT, 0.016);
    b.bolt(side * (half - 0.05), y + 0.02, z + depth / 2 - 0.05, BOLT, 0.016);
    b.box(0.02, 0.03, depth, PAL.wood, { pos: [side * (half - 0.01), y + 0.026, z] });
  }
  b.box(half * 2, 0.03, 0.02, PAL.wood, { pos: [0, y + 0.026, z - depth / 2 + 0.01] });
  // the chart: paper, a coast inked on it, islands in wash, the course in red
  const top = y + 0.017;
  const [chartWidth, chartDepth] = [Math.min(0.56, half * 2 - 0.3), depth - 0.08];
  const chart = b.box(chartWidth, 0.006, chartDepth, PAPER, { pos: [-0.04, top, z + 0.01], rot: [0, 0.05, 0], flat: true });
  const on = (u: number, v: number): Triple => [-0.04 + (u - 0.5) * chartWidth, top + 0.006, z + 0.01 + (v - 0.5) * chartDepth];
  b.tube([on(0.04, 0.3), on(0.2, 0.18), on(0.36, 0.34), on(0.5, 0.2), on(0.68, 0.3), on(0.94, 0.14)], 0.004, PAL.inkSoft, { id: THIN, flat: true, kind: KIND.PLAIN, steps: 20 }, 4);
  for (const [u, v, radius] of [[0.25, 0.62, 0.028], [0.52, 0.72, 0.02], [0.72, 0.56, 0.034], [0.86, 0.8, 0.016]]) {
    b.cyl(radius, radius, 0.003, PAL.sage, { pos: on(u, v), id: chart, flat: true, kind: KIND.PLAIN }, 8);
  }
  for (const [u0, v0, u1, v1] of [[0.12, 0.82, 0.22, 0.72], [0.3, 0.66, 0.42, 0.58], [0.5, 0.54, 0.62, 0.46], [0.7, 0.42, 0.8, 0.34]]) {
    b.beam(on(u0, v0), on(u1, v1), 0.004, PAL.rust, { id: THIN, flat: true, kind: KIND.PLAIN }, 4);
  }
  b.sphere(0.012, PAL.rust, { pos: on(0.84, 0.3), flat: true, kind: KIND.PLAIN }, 6);
  // the lens on a jointed brass arm, over the chart
  const foot: Triple = [half - 0.13, y + 0.014, z + depth / 2 - 0.06];
  b.cyl(0.022, 0.026, 0.02, BRASS, { pos: foot, kind: KIND.METAL }, 8);
  const elbow: Triple = [foot[0] - 0.02, foot[1] + 0.13, foot[2] - 0.02];
  const eye: Triple = [foot[0] - 0.2, foot[1] + 0.1, foot[2] - 0.1];
  b.beam(foot, elbow, 0.007, BRASS, { kind: KIND.METAL }, 5);
  b.beam(elbow, [eye[0] + 0.05, eye[1], eye[2] + 0.02], 0.007, BRASS, { kind: KIND.METAL }, 5);
  b.sphere(0.012, BRASS, { pos: elbow, kind: KIND.METAL }, 6);
  b.torus(0.052, 0.009, BRASS, { pos: eye, rot: [Math.PI / 2, 0, 0], kind: KIND.METAL }, 12);
  b.cyl(0.046, 0.046, 0.005, GLASS, { pos: eye, glow: 0.25, flat: true }, 12);
  // the lodestone on a thread from a little gallows, over a ring of bearings
  const post: Triple = [-(half - 0.14), y + 0.014, z - depth / 2 + 0.07];
  b.beam(post, [post[0], post[1] + 0.17, post[2]], 0.009, PAL.woodDark, {}, 5);
  b.beam([post[0], post[1] + 0.165, post[2]], [post[0] + 0.09, post[1] + 0.165, post[2] + 0.04], 0.007, PAL.woodDark, {}, 5);
  const stone: Triple = [post[0] + 0.09, post[1] + 0.045, post[2] + 0.04];
  rig(b, [stone[0], post[1] + 0.165, stone[2]], [stone[0], stone[1] + 0.02, stone[2]], 0.003);
  const lode = b.sphere(0.024, '#3d3f47', { pos: stone, scale: [0.8, 0.9, 1.8], rot: [0, 0.5, 0], kind: KIND.STONE }, 7);
  b.sphere(0.012, PAL.rust, { pos: [stone[0] - 0.02, stone[1], stone[2] - 0.036], id: lode, flat: true, kind: KIND.PLAIN }, 5);
  b.torus(0.06, 0.004, PAL.inkSoft, { pos: [stone[0], y + 0.016, stone[2]], rot: [Math.PI / 2, 0, 0], id: THIN, flat: true, kind: KIND.PLAIN }, 14);
  // dividers left open on the chart
  const hinge = on(0.6, 0.86);
  for (const leg of [-0.035, 0.035]) b.beam([hinge[0], hinge[1] + 0.004, hinge[2]], [hinge[0] + leg, hinge[1] + 0.004, hinge[2] - 0.09], 0.004, STEEL, { id: THIN, flat: true, kind: KIND.PLAIN }, 4);
  return only(b.mesh());
};

/** The fishing rig: two set lines on the starboard rail, each a cane rod with a bell at its tip and a float on the water. */
export const fishingRigPart: AttachmentBuilder = (context) => {
  const b = partBuilder(context, 110);
  const hull = hullOf(context);
  const [, , z] = context.mount;
  const rail = hull.halfBeam(z - 0.05);
  const railY = hull.gunwale(z - 0.05);
  // the rods stand forward of the mount, clear of the kneeler's stroke
  const [fore, aft] = [z - 0.28, z - 0.08];
  b.box(0.09, 0.03, aft - fore + 0.16, PAL.wood, { pos: [rail + 0.01, railY + 0.05, (fore + aft) / 2], kind: KIND.WOOD, axis: 2 });
  for (const at of [fore - 0.05, aft + 0.05]) b.bolt(rail + 0.01, railY + 0.07, at, BOLT, 0.016);
  const set = (at: number, tipZ: number, reach: number): void => {
    // an iron socket raked outboard, the cane in it
    b.beam([rail, railY + 0.05, at], [rail + 0.09, railY + 0.21, at + (tipZ - at) * 0.05], 0.026, IRON, { kind: KIND.METAL }, 7);
    const tip: Triple = [rail + reach, railY + 1.22, tipZ];
    b.tube([[rail + 0.04, railY + 0.12, at], [rail + reach * 0.42, railY + 0.74, at + (tipZ - at) * 0.4], [rail + reach * 0.8, railY + 1.12, at + (tipZ - at) * 0.8], tip], 0.014, BAMBOO, { steps: 20, id: THIN }, 5);
    // a tin reel by the socket, a bell at the tip, the line down to its float
    b.cyl(0.045, 0.045, 0.035, PAL.tin, { pos: [rail + 0.15, railY + 0.3, at + 0.03], rot: [Math.PI / 2, 0, 0], kind: KIND.METAL }, 8);
    b.cone(0.026, 0.04, BRASS, { pos: [tip[0] - 0.02, tip[1] - 0.045, tip[2]], kind: KIND.METAL }, 7);
    const float: Triple = [tip[0] + 0.06, 0.03, tipZ];
    b.beam(tip, [float[0], float[1] + 0.06, float[2]], 0.005, RIG, { id: THIN, flat: true, kind: KIND.PLAIN }, 4);
    const cork = b.sphere(0.05, PAL.cream, { pos: float, flat: true, kind: KIND.PLAIN }, 8);
    b.sphere(0.052, PAL.rust, { pos: [float[0], float[1] + 0.024, float[2]], scale: [1, 0.6, 1], id: cork, flat: true, kind: KIND.PLAIN }, 8);
  };
  set(fore, z - 0.44, 2.02);
  set(aft, z - 0.06, 2.1);
  // the bait tin on the board
  b.cyl(0.035, 0.035, 0.05, PAL.ochre, { pos: [rail + 0.01, railY + 0.09, (fore + aft) / 2], kind: KIND.METAL }, 8);
  return only(b.mesh());
};

/**
 * The canopy: two bent hoops over the cockpit, one each side of the stern paddler's stroke, with a ridge and
 * two purlins between them. Under way the canvas is rolled forward onto the first hoop, so whoever steers can
 * see and be seen. Beached, it is drawn over the cockpit: somewhere dry to sleep.
 */
export const canopyPart: AttachmentBuilder = (context) => {
  const hull = hullOf(context);
  const top = context.mount[1] + 1.0;
  const hoops = [Math.min((hull.seat(2) + 0.22 + hull.seat(0) - 0.62) / 2, hull.seat(0) - 0.76), hull.seat(0) + 0.31];
  const at = (z: number, angle: number, swell = 0): Triple => {
    const base = hull.gunwale(z) + 0.02;
    return [Math.cos(angle) * (hull.halfBeam(z) + 0.012 + swell), base + Math.sin(angle) * (top - base + swell), z];
  };
  const frame = partBuilder(context, 106);
  for (const z of hoops) {
    const points: Triple[] = [];
    for (let step = 0; step <= 12; step += 1) points.push(at(z, (step / 12) * Math.PI));
    frame.tube(points, 0.02, BAMBOO, { steps: 26 }, 6);
    for (const side of [0, Math.PI]) {
      const foot = at(z, side);
      frame.box(0.09, 0.06, 0.09, IRON, { pos: [foot[0], foot[1], z], kind: KIND.METAL });
      frame.bolt(foot[0] + Math.cos(side) * 0.05, foot[1] + 0.01, z, BOLT, 0.015, 'x');
    }
  }
  const ridge = top + 0.022;
  frame.beam([0, ridge, hoops[0] - 0.07], [0, ridge, hoops[1] + 0.07], 0.018, BAMBOO, {}, 6);
  for (const angle of [Math.PI * 0.25, Math.PI * 0.75]) frame.beam(at(hoops[0], angle, 0.02), at(hoops[1], angle, 0.02), 0.012, BAMBOO, {}, 5);
  for (const z of hoops) frame.torus(0.03, 0.009, ROPE, { pos: [0, ridge - 0.01, z], id: 0.71, kind: KIND.ROPE }, 8);

  // drawn over: striped canvas, open along the bottom, laced to both hoops
  const closed = partBuilder(context, 126);
  const [cellsZ, cellsAcross] = [6, 12];
  const [z0, z1] = [hoops[0] - 0.04, hoops[1] + 0.04];
  const points: THREE.Vector3[][] = [];
  for (let i = 0; i <= cellsZ; i += 1) {
    const z = z0 + ((z1 - z0) * i) / cellsZ;
    const sag = 0.025 - 0.03 * Math.sin((i / cellsZ) * Math.PI);
    points.push([]);
    for (let j = 0; j <= cellsAcross; j += 1) points[i].push(new THREE.Vector3(...at(z, Math.PI * (0.14 + (0.72 * j) / cellsAcross), sag)));
  }
  const band = (j: number): number => Math.floor(j / 2);
  const mend = (i: number, j: number): boolean => i === 2 && (j === 8 || j === 9);
  const cellZ = (z1 - z0) / cellsZ;
  closed.grid(
    points,
    (i, j) => (mend(i, j) ? '#d9b98a' : band(j) % 2 ? '#e9dfc4' : PAL.canvasSage),
    (i, j) => (mend(i, j) ? 0.53 : 0.31 + band(j) * 0.03),
    { kind: (i, j) => (mend(i, j) ? KIND.PATCH : KIND.CLOTH), tex: (vi, vj, i, j) => (mend(i, j) ? [(vi - 2) * cellZ, (vj - 8) * 0.14, cellZ, 0.28] : null) },
  );
  for (const z of [z0 + 0.02, z1 - 0.02]) for (let lace = 1; lace < 8; lace += 1) {
    const point = at(z, Math.PI * (0.14 + (0.72 * lace) / 8), 0.04);
    closed.tack(point[0], point[1], point[2], 0.011, '#5b5146');
  }

  // rolled forward: the same canvas in a fat roll along the first hoop, tied in four places
  const rolled = partBuilder(context, 127);
  const rollZ = hoops[0] - 0.075;
  const segments = 8;
  for (let segment = 0; segment < segments; segment += 1) {
    const arc: Triple[] = [];
    for (let step = 0; step <= 3; step += 1) {
      const angle = Math.PI * (0.16 + (0.68 * (segment + step / 3)) / segments);
      arc.push(at(rollZ, angle, 0.05));
    }
    rolled.tube(arc, 0.055, segment % 2 ? '#e9dfc4' : PAL.canvasSage, { steps: 6, kind: KIND.CLOTH }, 7);
  }
  for (const share of [0.12, 0.38, 0.62, 0.88]) {
    const angle = Math.PI * (0.16 + 0.68 * share);
    rolled.torus(0.062, 0.009, ROPE, { pos: at(rollZ, angle, 0.05), rot: [0, Math.PI / 2, angle + Math.PI / 2], order: 'ZYX', id: 0.71, kind: KIND.ROPE }, 9);
  }
  // the loose ends of the ties
  for (const side of [0.2, 0.8]) {
    const knot = at(rollZ, Math.PI * side, 0.05);
    line(rolled, [knot, [knot[0], knot[1] - 0.12, knot[2] - 0.03], [knot[0] * 1.02, knot[1] - 0.2, knot[2] - 0.02]], 0.006);
  }

  const group = new THREE.Group();
  const [closedMesh, rolledMesh] = [closed.mesh(), rolled.mesh()];
  group.add(frame.mesh(), closedMesh, rolledMesh);
  closedMesh.visible = false;
  return {
    object: group,
    update: (canoe) => {
      closedMesh.visible = canoe.beached;
      rolledMesh.visible = !canoe.beached;
    },
  };
};
