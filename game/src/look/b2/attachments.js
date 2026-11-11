// Ink & Wash — the bolted-on homestead, moved from art-r1/b2. Each piece is still drawn where B2 drew
// it on B2's own hull (bow = +z, y = 0 at the keel amidships), with its brackets and bolt heads.
// Every builder takes `root`: a Matrix4 that carries the finished piece from there onto its mount in
// the game (attachments.ts works it out from ANCHORS below and the rules engine's mount transform).
// Layout rule: low things on the +x deck, tall things on the -x deck, so a 3/4 view from the
// +x bow quarter reads every piece.
import * as THREE from 'three';
import { Builder, cloth, THIN } from './geo.js';
import { PAL } from './palette.js';
import { KIND, tagColor } from './detail.js';

const HL = 2.8;
const hw = (z) => 0.49 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(z / HL), 2.3)), 0.6);
const sheer = (z) => 0.4 + 0.3 * Math.pow(Math.abs(z / HL), 2.8);
const DK = 0.6; // deck top
const BY = 0.52; // cross-beam centre
const ROPE = '#dccfa6';
const RIG = '#62584a'; // standing rigging, drawn as a bare pen line
const BAMBOO = '#bda263';
const IRON = PAL.iron;
const BOLT = '#2f3038';
const rig = (b, a, c, r = 0.011) => b.beam(a, c, r, RIG, { id: THIN, flat: true, kind: KIND.PLAIN }, 4);
// what these colours are made of, where the hue alone would guess wrong
for (const c of [ROPE, '#d9c79b', '#cdb98a']) tagColor(c, KIND.ROPE);
for (const c of [PAL.canvasSage, '#e9dfc4', '#d3a747', '#a9822f', '#e6dcc0', '#d9cdb0', PAL.rustLight, '#e3d6b6', '#eee4c9', '#8fa7b3']) tagColor(c, KIND.CLOTH);
for (const c of ['#c64732', '#8fa3ad', '#b9744f', '#c18259', '#a86545', PAL.glow, '#d2553d', RIG, '#7d7466']) tagColor(c, KIND.PLAIN);
tagColor('#5d4b3f', KIND.SOIL);
tagColor('#8fa18b', KIND.METAL);
tagColor('#c9914b', KIND.WOOD);

// 1 — outrigger with its deck: two spars lashed over the gunwales, a decked gap, and a float.
// B2 drew the pair as one piece 3 m out. The game builds one a side, 1.9 m out, so this is B2's
// outrigger re-laid in the game's canoe space (bow = -z, y = 0 at the waterline). The mount is the
// float's centre. side: -1 port (hollowed log float), +1 starboard (three fuel drums).
// o: { floatX, halfBeam, gunwaleY, deckY } in metres.
export function outrigger(root, side, o) {
  const b = new Builder(side < 0 ? 101 : 117);
  b.root = root;
  const FXG = o.floatX;
  const BYG = o.deckY - 0.06;
  const inner = o.halfBeam + 0.12;
  const outer = FXG - 0.28;
  const spars = [-0.95, 0.95];
  for (const z of spars) {
    b.beam([-side * (o.halfBeam + 0.1), BYG, z], [side * (FXG + 0.18), BYG, z], 0.05, PAL.woodDark, {}, 7);
    for (const s of [-1, 1]) {
      const gx = s * o.halfBeam;
      b.box(0.1, Math.max(0.03, BYG - o.gunwaleY + 0.02), 0.13, PAL.wood, { pos: [gx, (o.gunwaleY + BYG) / 2 - 0.02, z] });
      for (const dx of [-0.04, 0, 0.04]) b.torus(0.066, 0.015, ROPE, { pos: [gx + dx, BYG, z], rot: [0, Math.PI / 2, 0], id: 0.71 }, 8);
      b.bolt(gx, BYG + 0.055, z, BOLT, 0.024);
    }
    b.beam([side * FXG, BYG, z], [side * FXG, 0.12, z], 0.036, PAL.woodDark, {}, 6);
    b.torus(side < 0 ? 0.225 : 0.305, 0.017, ROPE, { pos: [side * FXG, side < 0 ? 0.02 : 0.06, z], id: 0.71 }, 12);
    for (const q of [-1, 1]) b.beam([side * FXG - 0.06, BYG - 0.07, z + q * 0.045], [side * FXG + 0.06, BYG + 0.07, z - q * 0.045], 0.012, ROPE, { id: 0.71 }, 5);
  }
  const tones = [PAL.wood, PAL.woodLight, '#bfa27a', '#c4b89f', PAL.wood, '#a98658', PAL.woodLight, '#b7a88c', '#c9ad80', PAL.wood];
  const count = Math.max(3, Math.round((outer - inner) / 0.212));
  const pitch = (outer - inner) / count;
  for (let k = 0; k < count; k++) {
    const z0 = -1.2 - b.rand() * 0.07;
    const z1 = 1.2 + b.rand() * 0.08;
    const x = side * (inner + (k + 0.5) * pitch);
    b.box(pitch - 0.012, 0.04, z1 - z0, tones[(k + (side > 0 ? 3 : 0)) % 10], { pos: [x, o.deckY - 0.02, (z0 + z1) / 2], rot: [0, (b.rand() - 0.5) * 0.012, 0] });
    // every plank nailed to every spar
    for (const z of spars) for (const dx of [-0.05, 0.05]) b.tack(x + dx, o.deckY + 0.002, z + (k % 2 ? 0.012 : -0.012), 0.0095);
  }
  b.box(0.055, 0.09, 2.5, PAL.woodDark, { pos: [side * (outer + 0.03), o.deckY - 0.015, 0] });
  for (const z of [-1.0, -0.35, 0.35, 1.0]) b.bolt(side * (outer + 0.03), o.deckY + 0.035, z, BOLT, 0.02);
  if (side < 0) {
    // hollowed log float with tin bands
    b.cyl(0.2, 0.2, 2.6, '#8d6d4d', { pos: [side * FXG, 0.02, 0], rot: [Math.PI / 2, 0, 0] }, 10);
    b.cone(0.2, 0.5, '#8d6d4d', { pos: [side * FXG, 0.02, 1.55], rot: [Math.PI / 2, 0, 0] }, 10);
    b.cone(0.2, 0.5, '#8d6d4d', { pos: [side * FXG, 0.02, -1.55], rot: [-Math.PI / 2, 0, 0] }, 10);
    for (const z of [-0.6, 0.6]) b.cyl(0.208, 0.208, 0.08, PAL.tin, { pos: [side * FXG, 0.02, z], rot: [Math.PI / 2, 0, 0] }, 10);
  } else {
    // three fuel drums end to end
    for (const z of [-1.12, 0, 1.12]) {
      b.cyl(0.27, 0.27, 1.08, PAL.barrelBlue, { pos: [side * FXG, 0.06, z], rot: [Math.PI / 2, 0, 0] }, 12);
      for (const dz of [-0.36, 0.36]) b.cyl(0.28, 0.28, 0.05, '#476579', { pos: [side * FXG, 0.06, z + dz], rot: [Math.PI / 2, 0, 0] }, 12);
    }
    b.stencil('45', [side * FXG + 0.1, 0.0, -1.12 - 0.545], [-1, 0, 0], [0, 1, 0], 0.15, '#e9e2cc');
  }
  return b.mesh();
}

// 2 — mast, boom, gaff and standing rigging (the sail itself is cloth, below)
const MAST_Z = 1.15;
const MAST_TOP = 5.95;
const SAIL = {
  T: new THREE.Vector3(0.03, 2.32, 1.06),
  C: new THREE.Vector3(0.95, 2.46, -1.42),
  H: new THREE.Vector3(0.02, 4.92, 1.08),
  K: new THREE.Vector3(0.66, 5.74, -0.62),
};
export function mast(root) {
  const b = new Builder(102);
  b.root = root;
  const z = MAST_Z;
  b.beam([0, 0.1, z], [0, MAST_TOP, z], 0.06, PAL.wood, { r2: 0.036 }, 8);
  b.box(hw(z) * 2 + 0.14, 0.055, 0.26, PAL.woodDark, { pos: [0, sheer(z) + 0.03, z] });
  b.cyl(0.09, 0.09, 0.09, IRON, { pos: [0, sheer(z) + 0.1, z] }, 8);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.bolt(sx * (hw(z) - 0.02), sheer(z) + 0.065, z + sz * 0.09, BOLT, 0.024);
  b.sphere(0.065, PAL.rust, { pos: [0, MAST_TOP + 0.04, z] }, 8);
  // boom + gaff, each a little longer than the sail edge it carries
  const ext = (p, q, k) => p.clone().lerp(q, k).toArray();
  b.beam([0, SAIL.T.y - 0.04, z - 0.03], ext(SAIL.T, SAIL.C, 1.07).map((v, i) => (i === 1 ? v - 0.05 : v)), 0.038, PAL.woodLight, { r2: 0.028 }, 7);
  b.beam([0, SAIL.H.y - 0.04, z], ext(SAIL.H, SAIL.K, 1.1).map((v, i) => (i === 1 ? v + 0.04 : v)), 0.032, PAL.woodLight, { r2: 0.024 }, 7);
  b.box(0.17, 0.11, 0.15, IRON, { pos: [0, SAIL.T.y - 0.04, z - 0.03] });
  b.box(0.15, 0.1, 0.13, IRON, { pos: [0, SAIL.H.y - 0.04, z] });
  for (const y of [SAIL.T.y - 0.04, SAIL.H.y - 0.04]) for (const sx of [-1, 1]) b.bolt(sx * 0.09, y, z + 0.02, BOLT, 0.016, 'x');
  // the halyard, made off on a cleat and coiled; wedges at the mast partner
  b.box(0.03, 0.16, 0.05, PAL.woodDark, { pos: [0.075, 1.28, z] });
  for (let k = 0; k < 3; k++) b.torus(0.085 - k * 0.012, 0.014, ROPE, { pos: [0.1 + k * 0.012, 1.16 - k * 0.012, z], rot: [0, Math.PI / 2, 0.2 * k] }, 12);
  rig(b, [0.06, 1.3, z], [0.05, MAST_TOP - 0.3, z + 0.03], 0.008);
  for (const a of [0.4, 2.0, 3.6, 5.2]) b.box(0.035, 0.07, 0.05, PAL.woodLight, { pos: [Math.cos(a) * 0.075, sheer(z) + 0.085, z + Math.sin(a) * 0.075], rot: [0, -a, 0] });
  // lashings where boom and gaff meet the sail's corners
  for (const p of [SAIL.C, SAIL.K]) for (const d of [-0.03, 0.0, 0.03]) b.torus(0.045, 0.011, ROPE, { pos: [p.x + d * 0.3, p.y - 0.03, p.z + d], rot: [0, 0.35, 0], id: 0.71 }, 8);
  for (const y of [2.8, 3.3, 3.8, 4.3]) b.torus(0.08, 0.013, PAL.woodDark, { pos: [0, y, z], rot: [Math.PI / 2, 0, 0], id: 0.72 }, 10);
  // shrouds to the beam ends, sheet to a cleat on the deck
  for (const s of [-1, 1]) rig(b, [0, 4.95, z], [s * 0.72, 0.62, z - 0.2]);
  rig(b, [SAIL.C.x, SAIL.C.y - 0.07, SAIL.C.z], [0.4, 0.47, -1.1]);
  b.box(0.1, 0.05, 0.08, IRON, { pos: [0.4, 0.47, -1.1] });
  return b.mesh();
}

// 3 — rudder and tiller hung on the stern
export function rudder(root) {
  const b = new Builder(103);
  b.root = root;
  for (const y of [0.36, 0.62]) {
    b.box(0.07, 0.05, 0.17, IRON, { pos: [0, y, -2.84] });
    b.bolt(0.04, y, -2.78, BOLT, 0.02, 'x');
    b.bolt(-0.04, y, -2.78, BOLT, 0.02, 'x');
  }
  b.beam([0, 1.02, -2.92], [0, -0.1, -2.92], 0.032, PAL.woodDark, {}, 6);
  b.box(0.04, 0.92, 0.42, PAL.rust, { pos: [0, 0.03, -3.12] });
  b.box(0.046, 0.09, 0.43, PAL.cream, { pos: [0, 0.36, -3.12], kind: KIND.PAINT });
  for (const y of [0.52, 0.22, -0.05]) for (const dz of [-0.12, 0.1]) b.tack(0.024, y, -3.12 + dz, 0.011); // rudder blade rivets
  b.torus(0.04, 0.01, ROPE, { pos: [0.02, 1.0, -2.6], rot: [0.1, 0, 0], id: 0.71 }, 8); // tiller lashing
  b.box(0.05, 0.04, 0.32, IRON, { pos: [0, 0.2, -3.06] });
  b.beam([0, 0.99, -2.92], [0.1, 1.04, -2.14], 0.026, PAL.woodLight, { r2: 0.019 }, 6);
  b.sphere(0.038, PAL.woodDark, { pos: [0.1, 1.04, -2.12] }, 7);
  return b.mesh();
}

// 4 — cargo rack over the bow
export function cargoRack(root) {
  const b = new Builder(104);
  b.root = root;
  const z0 = 1.98;
  const z1 = 2.44;
  const y = 0.69;
  for (const z of [z0, z1]) {
    b.box(1.04, 0.06, 0.07, PAL.woodDark, { pos: [0, y - 0.03, z] });
    for (const s of [-1, 1]) {
      const gx = s * hw(z);
      b.box(0.07, y - 0.06 - sheer(z) + 0.04, 0.09, IRON, { pos: [gx, (y - 0.06 + sheer(z)) / 2, z] });
      b.bolt(gx + s * 0.04, sheer(z) + 0.04, z, BOLT, 0.02, 'x');
      b.beam([s * 0.49, y, z], [s * 0.49, y + 0.34, z], 0.022, PAL.woodDark, {}, 5);
    }
  }
  for (let k = 0; k < 5; k++) b.box(0.17, 0.03, z1 - z0 + 0.16, k % 2 ? PAL.wood : PAL.woodLight, { pos: [-0.4 + k * 0.2, y + 0.015, (z0 + z1) / 2] });
  for (const s of [-1, 1]) b.beam([s * 0.49, y + 0.32, z0], [s * 0.49, y + 0.32, z1], 0.02, PAL.woodDark, {}, 5);
  const zc = (z0 + z1) / 2;
  b.box(0.44, 0.32, 0.4, '#c9914b', { pos: [-0.23, y + 0.19, zc], rot: [0, 0.08, 0] });
  b.box(0.46, 0.05, 0.05, PAL.rustDark, { pos: [-0.23, y + 0.2, zc + 0.21], rot: [0, 0.08, 0] });
  b.cyl(0.17, 0.17, 0.4, PAL.barrelBlue, { pos: [0.27, y + 0.23, zc - 0.03] }, 10);
  b.cyl(0.178, 0.178, 0.04, '#476579', { pos: [0.27, y + 0.33, zc - 0.03] }, 10);
  b.cyl(0.1, 0.1, 0.62, PAL.cream, { pos: [-0.05, y + 0.46, zc + 0.02], rot: [0, 0.2, Math.PI / 2] }, 9);
  for (const sx of [-0.18, 0.12]) b.cyl(0.105, 0.105, 0.04, PAL.rust, { pos: [sx, y + 0.46, zc + 0.02 - sx * 0.2], rot: [0, 0.2, Math.PI / 2] }, 9);
  b.tube(
    [
      [-0.5, y, zc - 0.1],
      [-0.43, y + 0.4, zc - 0.08],
      [-0.05, y + 0.6, zc - 0.05],
      [0.42, y + 0.46, zc - 0.07],
      [0.5, y, zc - 0.1],
    ],
    0.012,
    ROPE,
    { steps: 14, id: THIN },
    4
  );
  b.tube(
    [
      [-0.5, y, zc + 0.14],
      [-0.4, y + 0.36, zc + 0.15],
      [-0.2, y + 0.5, zc + 0.12],
      [0.3, y + 0.5, zc + 0.1],
      [0.5, y, zc + 0.14],
    ],
    0.012,
    ROPE,
    { steps: 14, id: THIN },
    4
  );
  b.stencil('TEA', [-0.33, y + 0.05, zc + 0.215], [0.997, 0, -0.08], [0, 1, 0], 0.075, '#4a3a2c');
  for (const z of [z0, z1]) for (const s of [-1, 1]) b.bolt(s * 0.49, y + 0.005, z, BOLT, 0.014);
  return b.mesh();
}

// 5 — lantern mast: a shepherd's crook on the bow deck (the lantern swings separately)
const CROOK = new THREE.Vector3(0, 2.2, 3.1);
export function lanternMast(root) {
  const b = new Builder(105);
  b.root = root;
  const z = 2.56;
  const y = sheer(z) + 0.03;
  b.box(0.17, 0.025, 0.17, IRON, { pos: [0, y, z] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.bolt(sx * 0.06, y + 0.02, z + sz * 0.06, BOLT, 0.016);
  b.tube(
    [
      [0, y, z],
      [0, 1.5, z + 0.02],
      [0, 2.06, z + 0.1],
      [0, 2.3, z + 0.33],
      [0, CROOK.y, CROOK.z],
    ],
    0.024,
    IRON,
    { steps: 20 },
    6
  );
  return b.mesh();
}
// lit: the glass glows; otherwise it is a dull horn pane
export function lantern(root, lit = true) {
  const b = new Builder(115);
  b.root = root;
  b.torus(0.032, 0.008, IRON, { pos: [0, -0.03, 0] }, 8);
  b.cone(0.095, 0.08, PAL.tin, { pos: [0, -0.1, 0] }, 8);
  b.cyl(0.07, 0.078, 0.17, lit ? PAL.glow : '#8d8672', { pos: [0, -0.225, 0], glow: lit ? 1 : 0, flat: true, kind: KIND.PLAIN }, 8);
  b.cyl(0.09, 0.09, 0.035, IRON, { pos: [0, -0.325, 0] }, 8);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    b.beam([Math.cos(a) * 0.084, -0.13, Math.sin(a) * 0.084], [Math.cos(a) * 0.088, -0.31, Math.sin(a) * 0.088], 0.007, IRON, { id: THIN }, 4);
  }
  return b.mesh();
}

// 6 — canopy tent on bent hoops over the hull
export function canopy(root) {
  const b = new Builder(106);
  b.root = root;
  const hoops = [-0.98, -0.15, 0.68];
  const R = 0.67;
  const top = 1.04;
  for (const z of hoops) {
    const pts = [];
    for (let k = 0; k <= 10; k++) {
      const a = (k / 10) * Math.PI;
      pts.push([Math.cos(a) * R, DK + Math.sin(a) * top, z]);
    }
    b.tube(pts, 0.022, BAMBOO, { steps: 22 }, 6);
    for (const s of [-1, 1]) {
      b.box(0.1, 0.055, 0.1, IRON, { pos: [s * R, DK + 0.027, z] });
      b.bolt(s * (R + 0.035), DK + 0.06, z, BOLT, 0.016);
    }
  }
  b.beam([0, DK + top + 0.01, -1.1], [0, DK + top + 0.01, 0.8], 0.022, BAMBOO, {}, 6);
  // canvas: striped, open along the bottom so you can see in
  const P = [];
  const ni = 8;
  const nj = 12;
  for (let i = 0; i <= ni; i++) {
    const z = -1.06 + (1.82 * i) / ni;
    P.push([]);
    for (let j = 0; j <= nj; j++) {
      const a = Math.PI * (0.13 + (0.74 * j) / nj);
      const sag = 1 - 0.035 * Math.abs(Math.sin(((z + 0.98) / 0.83) * Math.PI));
      P[i].push(new THREE.Vector3(Math.cos(a) * (R + 0.03) * sag, DK + Math.sin(a) * (top + 0.03) * sag, z));
    }
  }
  const band = (j) => Math.floor(j / 2);
  const bandId = [0, 1, 2, 3, 4, 5].map((q) => 0.31 + q * 0.03);
  // one stitched patch where the stovepipe once scorched it
  const mend = (i, j) => (i === 5 || i === 6) && (j === 8 || j === 9);
  const DU = 1.82 / ni;
  const DV = 0.168;
  b.grid(
    P,
    (i, j) => (mend(i, j) ? '#d9b98a' : band(j) % 2 ? '#e9dfc4' : PAL.canvasSage),
    (i, j) => (mend(i, j) ? 0.53 : bandId[band(j)]),
    { kind: (i, j) => (mend(i, j) ? KIND.PATCH : KIND.CLOTH), tex: (vi, vj, i, j) => (mend(i, j) ? [(vi - 5) * DU, (vj - 8) * DV, 2 * DU, 2 * DV] : null) }
  );
  // the canvas is laced to the end hoops
  for (const z of [-1.04, 0.74]) for (let k = 1; k < 8; k++) {
    const a = Math.PI * (0.13 + (0.74 * k) / 8);
    b.tack(Math.cos(a) * (R + 0.045), DK + Math.sin(a) * (top + 0.045), z, 0.012, '#5b5146');
  }
  for (const s of [-1, 1]) for (const z of [-1.06, 0.76]) rig(b, [s * 0.62, DK + 0.42, z], [s * 0.95, DK + 0.02, z + Math.sign(z) * 0.12], 0.009);
  // bed inside
  b.box(0.5, 0.08, 1.2, '#d9cdb0', { pos: [0, 0.47, -0.2] });
  b.box(0.36, 0.09, 0.26, PAL.rustLight, { pos: [0, 0.54, 0.22] });
  return b.mesh();
}

// 7 — firebox / cookstove with kettle and stovepipe
const STOVE = [1.3, -0.25];
export function cookstove(root) {
  const b = new Builder(107);
  b.root = root;
  const [x, z] = STOVE;
  b.box(0.76, 0.018, 0.66, PAL.tin, { pos: [x, DK + 0.009, z] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.bolt(x + sx * 0.34, DK + 0.03, z + sz * 0.29, BOLT, 0.02);
    b.box(0.05, 0.14, 0.05, IRON, { pos: [x + sx * 0.21, DK + 0.085, z + sz * 0.16] });
  }
  b.box(0.5, 0.36, 0.4, IRON, { pos: [x, DK + 0.34, z] });
  for (const sx of [-1, 1]) for (const dy of [0.2, 0.34, 0.48]) b.tack(x + sx * 0.2, DK + dy, z + 0.203, 0.012, '#8d9496'); // rivets down the front corners
  for (const dz of [-0.14, 0.14]) for (const dy of [0.22, 0.46]) b.tack(x + 0.253, DK + dy, z + dz, 0.012, '#8d9496');
  b.box(0.58, 0.035, 0.48, '#3a3c45', { pos: [x, DK + 0.535, z] });
  b.box(0.02, 0.2, 0.24, '#5c5f6a', { pos: [x + 0.26, DK + 0.33, z] });
  b.box(0.024, 0.05, 0.17, PAL.glow, { pos: [x + 0.262, DK + 0.3, z], glow: 1, flat: true });
  b.box(0.03, 0.03, 0.06, PAL.tin, { pos: [x + 0.275, DK + 0.4, z + 0.07] });
  // kettle
  b.sphere(0.105, PAL.tin, { pos: [x + 0.1, DK + 0.63, z + 0.06], scale: [1, 0.78, 1] }, 10);
  b.cone(0.032, 0.13, PAL.tin, { pos: [x + 0.21, DK + 0.66, z + 0.06], rot: [0, 0, -1.0] }, 6);
  b.torus(0.075, 0.011, IRON, { pos: [x + 0.1, DK + 0.71, z + 0.06] }, 8);
  // pipe
  b.cyl(0.055, 0.055, 1.38, '#5c5f6a', { pos: [x - 0.16, DK + 0.55 + 0.69, z - 0.11] }, 8);
  b.cyl(0.062, 0.062, 0.05, IRON, { pos: [x - 0.16, DK + 0.98, z - 0.11] }, 8);
  b.cone(0.12, 0.1, IRON, { pos: [x - 0.16, DK + 1.98, z - 0.11] }, 8);
  // firewood, stacked aft of the stove
  for (let k = 0; k < 6; k++) b.cyl(0.05, 0.05, 0.36, k % 2 ? PAL.woodLight : PAL.wood, { pos: [x - 0.1 + (k % 3) * 0.105 + (k > 2 ? 0.05 : 0), DK + 0.055 + (k > 2 ? 0.09 : 0), z + 0.56], rot: [Math.PI / 2, 0, 0] }, 7);
  return b.mesh();
}

// 8 — workbench with vise and tools
export function workbench(root) {
  const b = new Builder(108);
  b.root = root;
  const x = 2.0;
  const z = 1.36;
  const H = 0.8;
  b.box(0.5, 0.06, 1.0, PAL.woodLight, { pos: [x, DK + H, z] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box(0.06, H, 0.06, PAL.wood, { pos: [x + sx * 0.2, DK + H / 2, z + sz * 0.44] });
    b.box(0.11, 0.022, 0.11, IRON, { pos: [x + sx * 0.2, DK + 0.011, z + sz * 0.44] });
    b.bolt(x + sx * 0.245, DK + 0.035, z + sz * 0.44, BOLT, 0.016);
  }
  b.box(0.42, 0.03, 0.9, PAL.wood, { pos: [x, DK + 0.24, z] });
  b.box(0.3, 0.17, 0.24, PAL.rust, { pos: [x, DK + 0.34, z - 0.2] }); // toolbox
  b.box(0.13, 0.022, 0.03, IRON, { pos: [x, DK + 0.44, z - 0.2] });
  b.stencil('TOOLS', [x + 0.154, DK + 0.315, z - 0.105], [0, 0, -1], [0, 1, 0], 0.05, '#efe6cf');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.tack(x + sx * 0.2, DK + H + 0.031, z + sz * 0.44, 0.012);
  // a rope coil hung on the bench leg
  for (let k = 0; k < 2; k++) b.torus(0.075 - k * 0.012, 0.013, ROPE, { pos: [x + 0.245, DK + 0.42, z + 0.44 - k * 0.012], rot: [0, Math.PI / 2, 0.3 * k] }, 12);
  b.cyl(0.09, 0.09, 0.16, PAL.tin, { pos: [x, DK + 0.335, z + 0.24] }, 8); // paint tin
  // apron board, with a saw hung on it
  b.box(0.03, 0.14, 0.94, PAL.wood, { pos: [x + 0.235, DK + H - 0.1, z] });
  b.box(0.012, 0.13, 0.5, PAL.tin, { pos: [x + 0.262, DK + H - 0.28, z - 0.02], rot: [0.12, 0, 0] });
  b.box(0.03, 0.15, 0.13, PAL.woodDark, { pos: [x + 0.262, DK + H - 0.25, z + 0.3], rot: [0.12, 0, 0] });
  // vise on the bow end
  b.box(0.14, 0.11, 0.055, IRON, { pos: [x + 0.12, DK + H + 0.085, z + 0.45] });
  b.box(0.14, 0.11, 0.045, '#5c5f6a', { pos: [x + 0.12, DK + H + 0.085, z + 0.55] });
  b.beam([x + 0.12, DK + H + 0.07, z + 0.4], [x + 0.12, DK + H + 0.07, z + 0.7], 0.014, PAL.tin, {}, 5);
  b.beam([x + 0.03, DK + H + 0.07, z + 0.7], [x + 0.21, DK + H + 0.07, z + 0.7], 0.009, PAL.tin, {}, 4);
  // hammer, a plank being worked, brush tin
  b.beam([x - 0.12, DK + H + 0.05, z - 0.36], [x + 0.14, DK + H + 0.05, z - 0.18], 0.016, PAL.wood, {}, 5);
  b.box(0.06, 0.06, 0.15, IRON, { pos: [x + 0.14, DK + H + 0.055, z - 0.18], rot: [0, 0.9, 0] });
  b.box(0.16, 0.035, 0.6, '#d8c196', { pos: [x - 0.1, DK + H + 0.048, z + 0.1], rot: [0, 0.12, 0] });
  b.cyl(0.05, 0.05, 0.11, PAL.ochre, { pos: [x + 0.13, DK + H + 0.085, z + 0.16] }, 8);
  b.beam([x + 0.13, DK + H + 0.1, z + 0.16], [x + 0.17, DK + H + 0.3, z + 0.19], 0.009, PAL.woodDark, {}, 4);
  b.beam([x + 0.13, DK + H + 0.1, z + 0.16], [x + 0.09, DK + H + 0.28, z + 0.12], 0.009, PAL.woodDark, {}, 4);
  return b.mesh();
}

// 9 — planter boxes along the deck edge
// only: 0, 1 or 2 builds just that box (the game's planter is one box); omit for all three
export function planters(root, only = null) {
  const b = new Builder(109);
  b.root = root;
  const x = 2.54;
  const greens = [PAL.sage, '#7d9a72', PAL.moss, PAL.sageDeep];
  [-0.74, 0.16, 1.06].forEach((z, n) => {
    if (only !== null && n !== only) return;
    const tone = n % 2 ? '#a17d55' : '#96714b';
    b.box(0.03, 0.22, 0.84, tone, { pos: [x - 0.14, DK + 0.11, z] });
    b.box(0.03, 0.22, 0.84, tone, { pos: [x + 0.14, DK + 0.11, z] });
    b.box(0.31, 0.22, 0.03, tone, { pos: [x, DK + 0.11, z - 0.42] });
    b.box(0.31, 0.22, 0.03, tone, { pos: [x, DK + 0.11, z + 0.42] });
    b.box(0.25, 0.03, 0.8, '#5d4b3f', { pos: [x, DK + 0.19, z], flat: true });
    for (const sz of [-0.3, 0.3]) {
      b.box(0.045, 0.13, 0.055, IRON, { pos: [x + 0.16, DK + 0.065, z + sz] });
      b.bolt(x + 0.19, DK + 0.085, z + sz, BOLT, 0.016, 'x');
    }
    if (n === 0) {
      for (let k = 0; k < 5; k++) b.sphere(0.09 + (k % 2) * 0.02, greens[k % 4], { pos: [x + (k % 2 ? 0.04 : -0.04), DK + 0.25, z - 0.3 + k * 0.15], scale: [1.1, 0.7, 1.1] }, 7);
    } else if (n === 1) {
      for (let k = 0; k < 3; k++) {
        const zz = z - 0.26 + k * 0.26;
        b.beam([x, DK + 0.19, zz], [x + 0.01, DK + 0.86, zz + 0.02], 0.01, BAMBOO, {}, 4);
        b.sphere(0.12, greens[k], { pos: [x, DK + 0.45, zz], scale: [1, 1.3, 1] }, 7);
        b.sphere(0.085, greens[(k + 1) % 4], { pos: [x + 0.03, DK + 0.68, zz + 0.02], scale: [1, 1.2, 1] }, 7);
        for (const [ox, oy, oz] of [[0.1, 0.42, 0.05], [-0.08, 0.53, -0.06], [0.08, 0.64, -0.04]]) b.sphere(0.04, '#c64732', { pos: [x + ox, DK + oy, zz + oz], flat: true }, 6);
      }
    } else {
      for (let k = 0; k < 7; k++) b.cone(0.05, 0.22 + (k % 3) * 0.04, greens[(k + 1) % 4], { pos: [x + (k % 2 ? 0.05 : -0.05), DK + 0.3, z - 0.33 + k * 0.11] }, 6);
      for (let k = 0; k < 3; k++) b.sphere(0.034, PAL.ochre, { pos: [x + 0.02, DK + 0.45, z - 0.3 + k * 0.22], flat: true }, 6);
    }
  });
  return b.mesh();
}

// 10 — fishing rig: rod in a holder off the stern quarter, line, bobber, bucket
export function fishingRig(root) {
  const b = new Builder(110);
  b.root = root;
  const x = 2.56;
  const z = -1.12;
  b.box(0.16, 0.022, 0.16, IRON, { pos: [x, DK + 0.011, z] });
  for (const s of [-1, 1]) b.bolt(x + s * 0.055, DK + 0.035, z + s * 0.055, BOLT, 0.016);
  b.beam([x - 0.03, DK, z + 0.02], [x + 0.14, DK + 0.36, z - 0.1], 0.038, IRON, {}, 7);
  const tip = [4.75, 2.45, -2.55];
  b.tube(
    [
      [x, DK + 0.06, z],
      [3.25, 1.85, -1.6],
      [4.05, 2.45, -2.12],
      tip,
    ],
    0.017,
    BAMBOO,
    { steps: 22, id: THIN },
    5
  );
  b.cyl(0.055, 0.055, 0.045, PAL.tin, { pos: [x + 0.21, DK + 0.52, z - 0.15], rot: [0, 0, 1.2] }, 8);
  b.beam(tip, [4.83, 0.16, -2.6], 0.006, '#7d7466', { id: THIN, flat: true }, 4);
  b.sphere(0.06, PAL.cream, { pos: [4.83, 0.13, -2.6] }, 8);
  b.sphere(0.062, PAL.rust, { pos: [4.83, 0.158, -2.6], scale: [1, 0.6, 1] }, 8);
  // bucket with the day's catch
  b.cyl(0.125, 0.105, 0.21, PAL.tin, { pos: [x - 0.32, DK + 0.105, z + 0.12] }, 9);
  b.sphere(0.05, '#8fa3ad', { pos: [x - 0.32, DK + 0.25, z + 0.12], scale: [0.6, 1.5, 1.1], rot: [0.3, 0, 0.2] }, 7);
  return b.mesh();
}

// 11 — rain catcher: tarp funnel on four poles draining to a barrel
const RAIN = [-1.4, 0.6];
export function rainCatcher(root) {
  const b = new Builder(111);
  b.root = root;
  const [cx, cz] = RAIN;
  const tops = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const top = [cx + sx * 0.6, DK + 1.66 - (sz > 0 ? 0.1 : 0), cz + sz * 0.6];
    tops.push(top);
    b.beam([cx + sx * 0.5, DK, cz + sz * 0.5], top, 0.024, BAMBOO, {}, 6);
    b.box(0.1, 0.045, 0.1, IRON, { pos: [cx + sx * 0.5, DK + 0.022, cz + sz * 0.5] });
    b.bolt(cx + sx * 0.54, DK + 0.05, cz + sz * 0.5, BOLT, 0.016);
  }
  const P = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    P.push([]);
    for (let j = 0; j <= n; j++) {
      const u = i / n;
      const v = j / n;
      const a = new THREE.Vector3(...tops[0]).lerp(new THREE.Vector3(...tops[1]), u);
      const c = new THREE.Vector3(...tops[2]).lerp(new THREE.Vector3(...tops[3]), u);
      a.lerp(c, v);
      const k = (1 - (2 * u - 1) ** 2) * (1 - (2 * v - 1) ** 2);
      a.y -= 0.68 * Math.pow(k, 0.8);
      P[i].push(a);
    }
  }
  const mid = (i, j) => (i === 3 || i === 4) && (j === 3 || j === 4);
  const mendT = (i, j) => (i === 5 || i === 6) && j === 1;
  b.grid(
    P,
    (i, j) => (mid(i, j) ? '#a9822f' : mendT(i, j) ? '#e6dcc0' : '#d3a747'),
    (i, j) => (mendT(i, j) ? 0.47 : mid(i, j) ? 0.44 : 0.41),
    { kind: (i, j) => (mendT(i, j) ? KIND.PATCH : KIND.CLOTH), tex: (vi, vj, i, j) => (mendT(i, j) ? [(vi - 5) * 0.15, (vj - 1) * 0.15, 0.3, 0.15] : null) }
  );
  for (const t of tops) for (const d of [-0.025, 0.025]) b.torus(0.036, 0.009, ROPE, { pos: [t[0], t[1] - 0.05 + d, t[2]], rot: [Math.PI / 2, 0, 0], id: 0.71 }, 8); // corner lashings
  b.cyl(0.036, 0.03, 0.36, PAL.tin, { pos: [cx, DK + 0.81, cz] }, 7);
  b.cyl(0.26, 0.26, 0.62, PAL.barrelBlue, { pos: [cx, DK + 0.31, cz] }, 12);
  for (const y of [0.14, 0.48]) b.cyl(0.268, 0.268, 0.045, '#476579', { pos: [cx, DK + y, cz] }, 12);
  b.cyl(0.02, 0.02, 0.1, PAL.tin, { pos: [cx + 0.3, DK + 0.13, cz], rot: [0, 0, Math.PI / 2] }, 6);
  b.box(0.02, 0.07, 0.02, PAL.rust, { pos: [cx + 0.34, DK + 0.17, cz] });
  return b.mesh();
}

// 12 — smoker cabinet with a tin roof; fish drying on a line
const SMOKER = [-2.3, 0.98];
const SMOKER_H = 1.5;
export function smoker(root) {
  const b = new Builder(112);
  b.root = root;
  const [x, z] = SMOKER;
  const H = SMOKER_H;
  b.box(0.52, H, 0.52, '#6d5847', { pos: [x, DK + H / 2 + 0.04, z] });
  const tones = ['#8a6f55', '#7c644d', '#927659', '#84694f'];
  for (let k = 0; k < 4; k++) b.box(0.03, H, 0.13, tones[k], { pos: [x + 0.272, DK + H / 2 + 0.04, z - 0.2 + k * 0.135] });
  for (let k = 0; k < 4; k++) b.box(0.13, H, 0.03, tones[(k + 2) % 4], { pos: [x - 0.2 + k * 0.135, DK + H / 2 + 0.04, z + 0.272] });
  for (const y of [0.34, 1.12]) b.box(0.022, 0.05, 0.11, IRON, { pos: [x + 0.295, DK + y, z - 0.2] }); // hinges
  for (let k = 0; k < 4; k++) for (const y of [0.16, 0.76, 1.4]) {
    b.tack(x + 0.29, DK + y, z - 0.2 + k * 0.135, 0.01);
    b.tack(x - 0.2 + k * 0.135, DK + y, z + 0.29, 0.01);
  }
  b.box(0.03, 0.045, 0.1, PAL.tin, { pos: [x + 0.295, DK + 0.76, z + 0.15] }); // latch
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box(0.1, 0.055, 0.1, IRON, { pos: [x + sx * 0.26, DK + 0.027, z + sz * 0.26] });
    b.bolt(x + sx * 0.3, DK + 0.06, z + sz * 0.26, BOLT, 0.016);
  }
  b.cone(0.52, 0.32, PAL.tin, { pos: [x, DK + H + 0.2, z], rot: [0, Math.PI / 4, 0] }, 4);
  b.cyl(0.045, 0.045, 0.4, IRON, { pos: [x + 0.1, DK + H + 0.42, z + 0.08] }, 7);
  b.cone(0.09, 0.075, IRON, { pos: [x + 0.1, DK + H + 0.65, z + 0.08] }, 7);
  return b.mesh();
}

// 13 — salvage winch: A-frame boom, drum and crank, a road sign on the hook
export function winch(root) {
  const b = new Builder(113);
  b.root = root;
  const tip = [-3.72, 2.75, 2.5];
  const bx = -2.38;
  const bz = 1.56;
  b.box(0.72, 0.03, 0.58, IRON, { pos: [bx, DK + 0.015, bz] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.bolt(bx + sx * 0.32, DK + 0.045, bz + sz * 0.25, BOLT, 0.02);
  b.beam([bx + 0.25, DK, bz - 0.2], tip, 0.042, PAL.woodDark, { r2: 0.03 }, 7);
  b.beam([bx - 0.25, DK, bz + 0.18], tip, 0.042, PAL.woodDark, { r2: 0.03 }, 7);
  b.beam([bx - 0.02, DK + 0.72, bz + 0.16], [bx - 0.28, DK + 0.74, bz + 0.36], 0.024, PAL.woodDark, {}, 5);
  rig(b, tip, [-2.66, DK + 0.02, 0.5]); // back stay
  for (const sx of [-0.2, 0.2]) b.box(0.05, 0.38, 0.2, PAL.wood, { pos: [bx + sx, DK + 0.2, bz - 0.03] });
  b.cyl(0.115, 0.115, 0.34, ROPE, { pos: [bx, DK + 0.34, bz - 0.03], rot: [0, 0, Math.PI / 2] }, 10);
  for (const sx of [-0.17, 0.17]) b.cyl(0.17, 0.17, 0.022, IRON, { pos: [bx + sx, DK + 0.34, bz - 0.03], rot: [0, 0, Math.PI / 2] }, 10);
  b.beam([bx + 0.2, DK + 0.34, bz - 0.03], [bx + 0.3, DK + 0.34, bz - 0.03], 0.015, IRON, {}, 5);
  b.beam([bx + 0.3, DK + 0.34, bz - 0.03], [bx + 0.3, DK + 0.55, bz - 0.12], 0.015, IRON, {}, 5);
  b.beam([bx + 0.3, DK + 0.55, bz - 0.12], [bx + 0.44, DK + 0.55, bz - 0.12], 0.022, PAL.woodLight, {}, 5);
  // cable over the pulley, hook, and the catch
  b.cyl(0.075, 0.075, 0.045, IRON, { pos: [tip[0], tip[1] - 0.04, tip[2]], rot: [Math.PI / 2, 0, 0.6] }, 8);
  rig(b, [bx, DK + 0.45, bz - 0.03], [tip[0] + 0.03, tip[1], tip[2]], 0.01);
  const hy = 1.55;
  rig(b, [tip[0], tip[1] - 0.06, tip[2]], [tip[0], hy, tip[2]], 0.01);
  b.torus(0.055, 0.015, IRON, { pos: [tip[0], hy - 0.05, tip[2]], rot: [0, 0.7, 0] }, 8);
  rig(b, [tip[0], hy - 0.1, tip[2]], [tip[0] - 0.15, hy - 0.32, tip[2] + 0.1], 0.007);
  rig(b, [tip[0], hy - 0.1, tip[2]], [tip[0] + 0.15, hy - 0.32, tip[2] - 0.1], 0.007);
  // salvaged road sign: octagon, cream rim, still on its post
  const m = new THREE.Matrix4().compose(new THREE.Vector3(tip[0], hy - 0.6, tip[2]), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, -0.95, 0.08)), new THREE.Vector3(1, 1, 1));
  b.base = m;
  b.cyl(0.34, 0.34, 0.02, PAL.cream, { pos: [0, 0, 0], rot: [Math.PI / 2, Math.PI / 8, 0] }, 8);
  b.cyl(0.29, 0.29, 0.034, '#b8432f', { pos: [0, 0, 0], rot: [Math.PI / 2, Math.PI / 8, 0] }, 8);
  b.box(0.3, 0.05, 0.04, PAL.cream, { pos: [0, 0, 0] });
  b.cyl(0.03, 0.03, 0.62, PAL.tin, { pos: [0, -0.6, -0.02] }, 6);
  b.base = null;
  return b.mesh();
}

// 14 — radio: whip antenna stepped on the stern deck, the set on a crate by the stove
const ANT = [-0.13, -2.42];
const ANT_TOP = new THREE.Vector3(ANT[0], 4.75, ANT[1]);
// part: 'set' (the crystal set on its crate) or 'mast' (the whip aerial and its stays)
export function radio(root, part) {
  const b = new Builder(part === 'set' ? 114 : 118);
  b.root = root;
  const [x, z] = ANT;
  const y0 = sheer(z) + 0.03;
  if (part === 'mast') {
  b.box(0.15, 0.03, 0.15, IRON, { pos: [x, y0, z] });
  for (const s of [-1, 1]) b.bolt(x + s * 0.05, y0 + 0.025, z - s * 0.05, BOLT, 0.016);
  b.beam([x, y0, z], [x, ANT_TOP.y, z], 0.03, '#7b878b', { r2: 0.016 }, 6);
  for (const [y, half] of [[3.25, 0.74], [3.72, 0.56], [4.19, 0.38]]) {
    b.beam([x, y, z - half], [x, y, z + half], 0.017, '#7b878b', {}, 4);
    b.box(0.07, 0.07, 0.07, IRON, { pos: [x, y, z] });
  }
  b.sphere(0.05, '#d2553d', { pos: [x, ANT_TOP.y + 0.04, z], glow: 0.7, flat: true }, 7);
  for (let k = 0; k < 5; k++) b.torus(0.045, 0.009, PAL.rust, { pos: [x, 2.6 + k * 0.05, z], rot: [Math.PI / 2, 0, 0], id: 0.77 }, 8);
  for (const s of [-1, 1]) rig(b, [x, 3.0, z], [s * hw(-1.95), sheer(-1.95) + 0.02, -1.95], 0.007);
  return b.mesh();
  }
  // the set, on an upturned crate
  const sx = 1.32;
  const sz = 0.78;
  b.box(0.38, 0.3, 0.32, '#b08a5e', { pos: [sx, DK + 0.15, sz] });
  b.box(0.4, 0.03, 0.34, PAL.woodDark, { pos: [sx, DK + 0.16, sz] });
  b.box(0.36, 0.26, 0.24, '#8fa18b', { pos: [sx, DK + 0.44, sz] });
  b.box(0.012, 0.14, 0.11, '#3d4048', { pos: [sx + 0.186, DK + 0.45, sz - 0.05], flat: true });
  b.cyl(0.038, 0.038, 0.018, PAL.ochre, { pos: [sx + 0.188, DK + 0.47, sz + 0.07], rot: [0, 0, Math.PI / 2] }, 8);
  b.cyl(0.02, 0.02, 0.018, PAL.cream, { pos: [sx + 0.188, DK + 0.38, sz + 0.07], rot: [0, 0, Math.PI / 2] }, 6);
  for (const s of [-1, 1]) b.bolt(sx + s * 0.15, DK + 0.02, sz + 0.17, BOLT, 0.016);
  return b.mesh();
}

// Where each piece stands on B2's hull: the point that goes onto the game's mount.
export const ANCHORS = {
  mast: [0, 0.42, MAST_Z],
  rudder: [0, 0.065, -2.8],
  cargoRack: [0, 0.39, 2.21],
  lanternMast: [0, sheer(2.56) + 0.03, 2.56],
  lantern: [-CROOK.x, -CROOK.y, -CROOK.z], // the lamp is drawn hanging from the origin: this hangs it on the crook
  canopy: [0, DK, -0.15],
  cookstove: [STOVE[0], DK, STOVE[1]],
  workbench: [2.0, DK, 1.36],
  planter: [2.54, DK, 0.16],
  fishingRig: [2.56, DK, -1.12],
  rainCatcher: [RAIN[0], DK, RAIN[1]],
  smoker: [SMOKER[0], DK, SMOKER[1]],
  winch: [-2.38, DK, 1.56],
  radioSet: [1.32, DK, 0.78],
  radioMast: [ANT[0], sheer(ANT[1]) + 0.03, ANT[1]],
  pennant: [0, MAST_TOP - 0.2, MAST_Z],
};

// The sail: patched canvas, seams inked between panels. update(t) bellies it. The cloth breathes
// slowly; B2's fast luff ripple is turned well down, because nothing in this game may ripple at speed.
export function createSail(root) {
  const patch = (i, j) => {
    if ((i === 2 || i === 3) && (j === 2 || j === 3)) return [PAL.rust, 0.81];
    if ((i === 5 || i === 6) && (j === 6 || j === 7)) return [PAL.canvasSage, 0.83];
    if (i === 1 && (j === 8 || j === 9)) return [PAL.ochre, 0.85];
    if (i === 6 && j === 1) return ['#8fa7b3', 0.87];
    if (i === 4 && j === 10) return [PAL.rustLight, 0.89];
    return null;
  };
  const NU = 8;
  const NV = 12;
  const PATCH_RECT = { 0.81: [2, 2, 4, 4], 0.83: [5, 6, 7, 8], 0.85: [1, 8, 2, 10], 0.87: [6, 1, 7, 2], 0.89: [4, 10, 5, 11] };
  const mesh = cloth(
    NU,
    NV,
    (i, j) => patch(i, j)?.[0] ?? (Math.floor(j / 3) % 2 ? '#e3d6b6' : '#eee4c9'),
    (i, j) => patch(i, j)?.[1] ?? 0.2 + Math.floor(j / 3) * 0.02,
    { size: [SAIL.T.distanceTo(SAIL.C), SAIL.T.distanceTo(SAIL.H)], patch: (i, j) => (patch(i, j) ? PATCH_RECT[patch(i, j)[1]] : null) }
  );
  const { T, C, H, K } = SAIL;
  const nrm = new THREE.Vector3().subVectors(C, T).cross(new THREE.Vector3().subVectors(H, T)).normalize();
  if (nrm.x < 0) nrm.negate(); // belly toward +x
  const a = new THREE.Vector3();
  const c = new THREE.Vector3();
  return {
    mesh,
    update(t) {
      const belly = 0.34 + Math.sin(t * 0.9) * 0.05;
      mesh.userData.update((u, v, out) => {
        a.lerpVectors(T, C, u);
        c.lerpVectors(H, K, u);
        out.lerpVectors(a, c, v);
        const k = Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
        const luff = Math.sin(u * 7 - t * 1.4 + v * 4) * 0.012 * u * (0.4 + 0.6 * v);
        out.addScaledVector(nrm, k * belly + luff).applyMatrix4(root);
      });
    },
  };
}

// A pennant on a staff, trailing toward -z of B2's hull (astern). The staff foot is ANCHORS.pennant.
export function createPennant(root) {
  const mesh = cloth(6, 2, () => PAL.rust, () => 0.9, { size: [0.9, 0.36] });
  return {
    mesh,
    update(t) {
      mesh.userData.update((u, v, out) => {
        const w = Math.sin(u * 5 - t * 2.6) * 0.04 * u;
        out.set(w, MAST_TOP + 0.16 + (v - 0.5) * 0.36 * (1 - u * 0.9) - u * 0.07 + Math.cos(u * 4 - t * 2) * 0.012 * u, MAST_Z - 0.03 - u * 0.9).applyMatrix4(root);
      });
    },
  };
}
