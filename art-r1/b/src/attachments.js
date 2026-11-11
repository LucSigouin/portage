// Ink & Wash — the bolted-on homestead. Each attachment is its own mesh, built in canoe-local
// space (bow = +z, y = 0 at the keel amidships), with visible brackets and bolt heads.
// Layout rule: low things on the +x deck, tall things on the -x deck, so a 3/4 view from the
// +x bow quarter reads every piece.
import * as THREE from 'three';
import { Builder, cloth, piece, THIN } from './geo.js';
import { PAL } from './palette.js';

const HL = 2.8;
const hw = (z) => 0.49 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(z / HL), 2.3)), 0.6);
const sheer = (z) => 0.4 + 0.3 * Math.pow(Math.abs(z / HL), 2.8);
const DK = 0.6; // deck top
const BY = 0.52; // cross-beam centre
const DXI = 0.62; // deck inner edge
const DXO = 2.74; // deck outer edge
const FX = 3.02; // float centreline
const BEAMS = [1.84, 0.36, -1.12];
const ROPE = '#dccfa6';
const RIG = '#62584a'; // standing rigging, drawn as a bare pen line
const BAMBOO = '#bda263';
const IRON = PAL.iron;
const BOLT = '#2f3038';
const rig = (b, a, c, r = 0.011) => b.beam(a, c, r, RIG, { id: THIN, flat: true }, 4);

function tri(b, p0, p1, p2, color) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...p0, ...p1, ...p2], 3));
  g.computeVertexNormals();
  return b.add(g, color, {});
}

// 1 — outriggers with decks: three cross-beams lashed over the gunwales, a log float and a drum float
function outriggers() {
  const b = new Builder(101);
  for (const z of BEAMS) {
    b.beam([-3.2, BY, z], [3.2, BY, z], 0.05, PAL.woodDark, {}, 7);
    for (const s of [-1, 1]) {
      const gx = s * hw(z);
      const gy = sheer(z);
      b.box(0.1, BY - gy + 0.02, 0.13, PAL.wood, { pos: [gx, (gy + BY) / 2 - 0.02, z] });
      for (const dx of [-0.04, 0, 0.04]) b.torus(0.066, 0.015, ROPE, { pos: [gx + dx, BY, z], rot: [0, Math.PI / 2, 0], id: 0.71 }, 8);
      b.bolt(gx, BY + 0.055, z, BOLT, 0.024);
      b.beam([s * FX, BY, z], [s * FX, 0.26, z], 0.036, PAL.woodDark, {}, 6);
      b.torus(s > 0 ? 0.225 : 0.305, 0.017, ROPE, { pos: [s * FX, s > 0 ? 0.13 : 0.17, z], id: 0.71 }, 12);
    }
  }
  const tones = [PAL.wood, PAL.woodLight, '#bfa27a', '#c4b89f', PAL.wood, '#a98658', PAL.woodLight, '#b7a88c', '#c9ad80', PAL.wood];
  for (const s of [-1, 1]) {
    for (let k = 0; k < 10; k++) {
      const z0 = -1.22 - b.rand() * 0.07;
      const z1 = 1.94 + b.rand() * 0.08;
      b.box(0.2, 0.04, z1 - z0, tones[(k + (s > 0 ? 3 : 0)) % 10], { pos: [s * (DXI + 0.105 + k * 0.212), DK - 0.02, (z0 + z1) / 2], rot: [0, (b.rand() - 0.5) * 0.012, 0] });
    }
    b.box(0.055, 0.09, 3.26, PAL.woodDark, { pos: [s * (DXO + 0.03), DK - 0.015, 0.36] });
    for (const z of [-1.0, -0.3, 0.4, 1.1, 1.75]) b.bolt(s * (DXO + 0.03), DK + 0.035, z, BOLT, 0.02);
  }
  // +x: hollowed log float with tin bands
  b.cyl(0.21, 0.21, 4.0, '#8d6d4d', { pos: [FX, 0.13, 0.36], rot: [Math.PI / 2, 0, 0] }, 10);
  b.cone(0.21, 0.6, '#8d6d4d', { pos: [FX, 0.13, 0.36 + 2.3], rot: [Math.PI / 2, 0, 0] }, 10);
  b.cone(0.21, 0.6, '#8d6d4d', { pos: [FX, 0.13, 0.36 - 2.3], rot: [-Math.PI / 2, 0, 0] }, 10);
  for (const z of [-0.5, 1.2]) b.cyl(0.218, 0.218, 0.08, PAL.tin, { pos: [FX, 0.13, z], rot: [Math.PI / 2, 0, 0] }, 10);
  // -x: three fuel drums end to end
  for (const z of [-0.84, 0.36, 1.56]) {
    b.cyl(0.29, 0.29, 1.15, PAL.barrelBlue, { pos: [-FX, 0.17, z], rot: [Math.PI / 2, 0, 0] }, 12);
    for (const dz of [-0.38, 0.38]) b.cyl(0.3, 0.3, 0.05, '#476579', { pos: [-FX, 0.17, z + dz], rot: [Math.PI / 2, 0, 0] }, 12);
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
function mast() {
  const b = new Builder(102);
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
  for (const y of [2.8, 3.3, 3.8, 4.3]) b.torus(0.08, 0.013, PAL.woodDark, { pos: [0, y, z], rot: [Math.PI / 2, 0, 0], id: 0.72 }, 10);
  // shrouds to the beam ends, sheet to a cleat on the deck
  for (const s of [-1, 1]) rig(b, [0, 4.95, z], [s * 3.05, 0.57, BEAMS[0]]);
  rig(b, [SAIL.C.x, SAIL.C.y - 0.07, SAIL.C.z], [0.78, DK + 0.03, -1.1]);
  b.box(0.1, 0.05, 0.08, IRON, { pos: [0.78, DK + 0.03, -1.1] });
  return b.mesh();
}

// 3 — rudder and tiller hung on the stern
function rudder() {
  const b = new Builder(103);
  for (const y of [0.36, 0.62]) {
    b.box(0.07, 0.05, 0.17, IRON, { pos: [0, y, -2.84] });
    b.bolt(0.04, y, -2.78, BOLT, 0.02, 'x');
    b.bolt(-0.04, y, -2.78, BOLT, 0.02, 'x');
  }
  b.beam([0, 1.02, -2.92], [0, -0.1, -2.92], 0.032, PAL.woodDark, {}, 6);
  b.box(0.04, 0.92, 0.42, PAL.rust, { pos: [0, 0.03, -3.12] });
  b.box(0.046, 0.09, 0.43, PAL.cream, { pos: [0, 0.36, -3.12] });
  b.box(0.05, 0.04, 0.32, IRON, { pos: [0, 0.2, -3.06] });
  b.beam([0, 0.99, -2.92], [0.1, 1.04, -2.14], 0.026, PAL.woodLight, { r2: 0.019 }, 6);
  b.sphere(0.038, PAL.woodDark, { pos: [0.1, 1.04, -2.12] }, 7);
  return b.mesh();
}

// 4 — cargo rack over the bow
function cargoRack() {
  const b = new Builder(104);
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
  return b.mesh();
}

// 5 — lantern mast: a shepherd's crook on the bow deck (the lantern swings separately)
const CROOK = new THREE.Vector3(0, 2.2, 3.1);
function lanternMast() {
  const b = new Builder(105);
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
function lantern() {
  const b = new Builder(115);
  b.torus(0.032, 0.008, IRON, { pos: [0, -0.03, 0] }, 8);
  b.cone(0.095, 0.08, PAL.tin, { pos: [0, -0.1, 0] }, 8);
  b.cyl(0.07, 0.078, 0.17, PAL.glow, { pos: [0, -0.225, 0], glow: 1, flat: true }, 8);
  b.cyl(0.09, 0.09, 0.035, IRON, { pos: [0, -0.325, 0] }, 8);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    b.beam([Math.cos(a) * 0.084, -0.13, Math.sin(a) * 0.084], [Math.cos(a) * 0.088, -0.31, Math.sin(a) * 0.088], 0.007, IRON, { id: THIN }, 4);
  }
  return b.mesh();
}

// 6 — canopy tent on bent hoops over the hull
function canopy() {
  const b = new Builder(106);
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
  b.grid(P, (i, j) => (band(j) % 2 ? '#e9dfc4' : PAL.canvasSage), (i, j) => bandId[band(j)]);
  for (const s of [-1, 1]) for (const z of [-1.06, 0.76]) rig(b, [s * 0.62, DK + 0.42, z], [s * 0.95, DK + 0.02, z + Math.sign(z) * 0.12], 0.009);
  // bed inside
  b.box(0.5, 0.08, 1.2, '#d9cdb0', { pos: [0, 0.47, -0.2] });
  b.box(0.36, 0.09, 0.26, PAL.rustLight, { pos: [0, 0.54, 0.22] });
  return b.mesh();
}

// 7 — firebox / cookstove with kettle and stovepipe
const STOVE = [1.3, -0.25];
const STOVE_TOP = new THREE.Vector3(STOVE[0] - 0.16, DK + 2.0, STOVE[1] - 0.11);
function cookstove() {
  const b = new Builder(107);
  const [x, z] = STOVE;
  b.box(0.76, 0.018, 0.66, PAL.tin, { pos: [x, DK + 0.009, z] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.bolt(x + sx * 0.34, DK + 0.03, z + sz * 0.29, BOLT, 0.02);
    b.box(0.05, 0.14, 0.05, IRON, { pos: [x + sx * 0.21, DK + 0.085, z + sz * 0.16] });
  }
  b.box(0.5, 0.36, 0.4, IRON, { pos: [x, DK + 0.34, z] });
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
function workbench() {
  const b = new Builder(108);
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
function planters() {
  const b = new Builder(109);
  const x = 2.54;
  const greens = [PAL.sage, '#7d9a72', PAL.moss, PAL.sageDeep];
  [-0.74, 0.16, 1.06].forEach((z, n) => {
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
function fishingRig() {
  const b = new Builder(110);
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
function rainCatcher() {
  const b = new Builder(111);
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
  b.grid(
    P,
    (i, j) => (mid(i, j) ? '#a9822f' : i === 5 && j === 1 ? '#e6dcc0' : '#d3a747'),
    (i, j) => (i === 5 && j === 1 ? 0.47 : mid(i, j) ? 0.44 : 0.41)
  );
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
const SMOKER_TOP = new THREE.Vector3(SMOKER[0] + 0.1, DK + SMOKER_H + 0.7, SMOKER[1] + 0.08);
function smoker() {
  const b = new Builder(112);
  const [x, z] = SMOKER;
  const H = SMOKER_H;
  b.box(0.52, H, 0.52, '#6d5847', { pos: [x, DK + H / 2 + 0.04, z] });
  const tones = ['#8a6f55', '#7c644d', '#927659', '#84694f'];
  for (let k = 0; k < 4; k++) b.box(0.03, H, 0.13, tones[k], { pos: [x + 0.272, DK + H / 2 + 0.04, z - 0.2 + k * 0.135] });
  for (let k = 0; k < 4; k++) b.box(0.13, H, 0.03, tones[(k + 2) % 4], { pos: [x - 0.2 + k * 0.135, DK + H / 2 + 0.04, z + 0.272] });
  for (const y of [0.34, 1.12]) b.box(0.022, 0.05, 0.11, IRON, { pos: [x + 0.295, DK + y, z - 0.2] }); // hinges
  b.box(0.03, 0.045, 0.1, PAL.tin, { pos: [x + 0.295, DK + 0.76, z + 0.15] }); // latch
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box(0.1, 0.055, 0.1, IRON, { pos: [x + sx * 0.26, DK + 0.027, z + sz * 0.26] });
    b.bolt(x + sx * 0.3, DK + 0.06, z + sz * 0.26, BOLT, 0.016);
  }
  b.cone(0.52, 0.32, PAL.tin, { pos: [x, DK + H + 0.2, z], rot: [0, Math.PI / 4, 0] }, 4);
  b.cyl(0.045, 0.045, 0.4, IRON, { pos: [x + 0.1, DK + H + 0.42, z + 0.08] }, 7);
  b.cone(0.09, 0.075, IRON, { pos: [x + 0.1, DK + H + 0.65, z + 0.08] }, 7);
  // drying line to the rain-catcher pole, three fish on it
  const a = [x + 0.27, DK + H + 0.02, z + 0.27];
  const c = [RAIN[0] - 0.6, DK + 1.52, RAIN[1] + 0.6];
  rig(b, a, c, 0.008);
  for (let k = 0; k < 3; k++) {
    const f = 0.22 + k * 0.26;
    const p = [a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f - 0.14, a[2] + (c[2] - a[2]) * f];
    b.sphere(1, k % 2 ? '#b9744f' : '#c18259', { pos: p, scale: [0.032, 0.12, 0.06], rot: [0, 0.6, 0] }, 7);
    b.cone(0.045, 0.075, '#a86545', { pos: [p[0], p[1] - 0.14, p[2]], scale: [0.5, 1, 1], rot: [0, 0.6, 0] }, 5);
  }
  return b.mesh();
}

// 13 — salvage winch: A-frame boom, drum and crank, a road sign on the hook
function winch() {
  const b = new Builder(113);
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
function radio() {
  const b = new Builder(114);
  const [x, z] = ANT;
  const y0 = sheer(z) + 0.03;
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
  // aerial lead from the set to the whip
  b.tube(
    [
      [sx - 0.1, DK + 0.57, sz],
      [0.72, 1.5, 0.3],
      [0.2, 1.7, -0.9],
      [0.05, 1.45, -1.9],
      [x, 1.6, z],
    ],
    0.007,
    RIG,
    { steps: 16, id: THIN, flat: true },
    4
  );
  return b.mesh();
}

// 15 — flags: bunting from the masthead to the antenna and to the lantern crook
function bunting() {
  const b = new Builder(116);
  const colors = [PAL.rust, PAL.ochre, PAL.cream, PAL.slate, PAL.sage, PAL.rustLight, PAL.ochreLight];
  const lines = [
    { a: [0, MAST_TOP - 0.02, MAST_Z], c: ANT_TOP.toArray(), sag: 0.5, n: 13, side: -1 },
    { a: [0, MAST_TOP - 0.02, MAST_Z], c: [CROOK.x, CROOK.y + 0.12, CROOK.z - 0.2], sag: 0.34, n: 10, side: 1 },
  ];
  let q = 0;
  for (const { a, c, sag, n, side } of lines) {
    const pt = (f) => [a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f - Math.sin(f * Math.PI) * sag, a[2] + (c[2] - a[2]) * f];
    const pts = [];
    for (let k = 0; k <= 12; k++) pts.push(pt(k / 12));
    b.tube(pts, 0.008, RIG, { steps: 24, id: THIN, flat: true }, 4);
    for (let k = 0; k < n; k++) {
      const f0 = (k + 0.2) / n;
      const f1 = (k + 0.86) / n;
      const p0 = pt(f0);
      const p1 = pt(f1);
      const m = pt((f0 + f1) / 2);
      const flut = (b.rand() - 0.5) * 0.14;
      // flags hang down and trail a little toward the stern
      tri(b, p0, p1, [m[0] + flut, m[1] - 0.36, m[2] - 0.1 * side + flut * 0.5], colors[q++ % colors.length]);
    }
  }
  return b.mesh();
}

export function buildAttachments() {
  const group = new THREE.Group();
  const add = (name, mesh) => {
    mesh.name = name;
    group.add(mesh);
    return mesh;
  };
  add('outriggers', outriggers());
  add('mast', mast());
  add('rudder', rudder());
  add('cargo-rack', cargoRack());
  add('lantern-mast', lanternMast());
  const lamp = add('lantern', lantern());
  lamp.position.copy(CROOK);
  add('canopy', canopy());
  add('cookstove', cookstove());
  add('workbench', workbench());
  add('planters', planters());
  add('fishing-rig', fishingRig());
  add('rain-catcher', rainCatcher());
  add('smoker', smoker());
  add('winch', winch());
  add('radio', radio());
  add('flags', bunting());

  // sail: patched canvas, seams inked between panels
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
  const sail = cloth(
    NU,
    NV,
    (i, j) => patch(i, j)?.[0] ?? (Math.floor(j / 3) % 2 ? '#e3d6b6' : '#eee4c9'),
    (i, j) => patch(i, j)?.[1] ?? 0.2 + Math.floor(j / 3) * 0.02
  );
  add('sail', sail);
  const { T, C, H, K } = SAIL;
  const nrm = new THREE.Vector3().subVectors(C, T).cross(new THREE.Vector3().subVectors(H, T)).normalize();
  if (nrm.x < 0) nrm.negate(); // belly toward +x
  const a = new THREE.Vector3();
  const c = new THREE.Vector3();

  const pennant = cloth(6, 2, () => PAL.rust, () => 0.9);
  add('pennant', pennant);

  // smoke: little inked puffs from both chimneys
  const puffGeo = new THREE.SphereGeometry(1, 8, 6);
  const puffs = [];
  for (const [origin, n, size] of [[STOVE_TOP, 5, 0.9], [SMOKER_TOP, 4, 0.7]]) {
    for (let k = 0; k < n; k++) {
      const m = piece(puffGeo, k % 2 ? '#c3cbcd' : '#b5bfc3');
      group.add(m);
      puffs.push({ m, origin, off: k / n, size, seed: k * 1.7 + origin.x });
    }
  }

  return {
    group,
    update(dt, t) {
      if (!group.visible) return;
      const belly = 0.34 + Math.sin(t * 0.9) * 0.05;
      sail.userData.update((u, v, out) => {
        a.lerpVectors(T, C, u);
        c.lerpVectors(H, K, u);
        out.lerpVectors(a, c, v);
        const k = Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
        const luff = Math.sin(u * 7 - t * 4.2 + v * 4) * 0.035 * u * (0.4 + 0.6 * v);
        out.addScaledVector(nrm, k * belly + luff);
      });
      pennant.userData.update((u, v, out) => {
        const w = Math.sin(u * 5 - t * 8) * 0.07 * u;
        out.set(w, MAST_TOP + 0.16 + (v - 0.5) * 0.36 * (1 - u * 0.9) - u * 0.07 + Math.cos(u * 4 - t * 6) * 0.02 * u, MAST_Z - 0.03 - u * 0.9);
      });
      lamp.rotation.set(Math.sin(t * 1.7) * 0.12, 0, Math.sin(t * 1.3 + 1) * 0.1);
      for (const p of puffs) {
        const k = (t * 0.2 + p.off) % 1;
        const s = (0.06 + k * 0.26) * Math.sin(Math.min(1, k * 1.25) * Math.PI) ** 0.6 * p.size;
        p.m.position.set(p.origin.x + Math.sin(t * 0.8 + p.seed) * 0.09 * k, p.origin.y + k * 1.5 + Math.sin(p.seed * 3) * 0.1 * k, p.origin.z - k * 1.5 + Math.cos(t * 0.7 + p.seed) * 0.08 * k);
        p.m.scale.set(s, s * 0.9, s * 1.15);
      }
    },
  };
}
