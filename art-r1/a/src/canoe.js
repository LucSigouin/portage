// The canoe: one patched red hull, a paddler, and fifteen bolted-on attachments.
// Local frame: forward is -Z, starboard is +X, the waterline is y = 0.
import * as THREE from 'three';
import { PAL, flatMat, flatMatDouble, glowMat } from './palette.js';
import { Kit } from './kit.js';

const N = 14;
const HL = 2.6; // half length at the keel
const ST = Array.from({ length: N + 1 }, (_, i) => Math.sin(((-1 + (2 * i) / N) * Math.PI) / 2)); // stations, packed toward the stems
const hb = (s) => 0.58 * Math.pow(Math.max(1 - Math.pow(Math.abs(s), 2.2), 0), 0.62); // half beam
const gy = (s) => 0.3 + 0.4 * Math.pow(Math.abs(s), 3.2); // gunwale height: the sheer sweeps up at both ends
const ky = (s) => -0.22 + 0.32 * Math.pow(Math.abs(s), 5); // keel height
const FX = [0, 0.64, 0.96, 1.0];
const FY = [0, 0.12, 0.5, 1.0];
const LIFT = [0.045, 0.035, 0.012, 0];
const RECURVE = 0.22;

// Hull cross-section point: j = 0 keel .. 3 gunwale. inner = the skin you see from the seat.
function sec(s, j, side, inner = false) {
  const b = hb(s), g = gy(s), k = ky(s);
  let x = side * b * FX[j];
  let y = k + (g - k) * FY[j];
  let z = s * HL + Math.sign(s) * RECURVE * Math.pow(Math.abs(s), 20) * Math.pow(FY[j], 1.5); // recurved stems
  if (inner) { x *= 0.89; y += LIFT[j]; z *= 0.965; }
  return [x, y, z];
}
// Point on the outer skin between the chine (f = 0) and the gunwale (f = 1), nudged outward.
function skin(s, f, side, lift = 0.016) {
  const jf = 1 + f * 2, j0 = Math.min(Math.floor(jf), 2), t = jf - j0;
  const a = sec(s, j0, side), b = sec(s, j0 + 1, side);
  return [a[0] + (b[0] - a[0]) * t + side * lift, a[1] + (b[1] - a[1]) * t - lift * 0.3, a[2] + (b[2] - a[2]) * t];
}

function buildHull() {
  const k = new Kit(7, 0.045);
  for (let i = 0; i < N; i++) {
    const s0 = ST[i], s1 = ST[i + 1];
    for (const side of [-1, 1]) {
      for (let j = 0; j < 3; j++) {
        const red = j === 0 ? PAL.canoeRedDeep : k.rand() < 0.2 ? PAL.canoeRedFaded : PAL.canoeRed;
        k.quadOut(sec(s0, j, side), sec(s1, j, side), sec(s1, j + 1, side), sec(s0, j + 1, side), [side, j === 0 ? -2.5 : -0.3, 0], red);
        k.quadOut(sec(s0, j, side, true), sec(s1, j, side, true), sec(s1, j + 1, side, true), sec(s0, j + 1, side, true),
          [-side, j === 0 ? 2.5 : 0.4, 0], j === 0 ? PAL.canoeRedDeep : PAL.canoeRedFaded);
      }
      const o0 = sec(s0, 3, side), o1 = sec(s1, 3, side), i0 = sec(s0, 3, side, true), i1 = sec(s1, 3, side, true);
      k.quadOut(o0, o1, i1, i0, [0, 1, 0], PAL.wood);
      k.beam(o0[0], o0[1] + 0.008, o0[2], o1[0], o1[1] + 0.008, o1[2], 0.08, PAL.wood);
    }
    // ribs
    if (i > 1 && i < N - 1) for (const side of [-1, 1]) for (let j = 0; j < 3; j++) {
      const a = sec(s0, j, side, true), b = sec(s0, j + 1, side, true);
      k.beam(a[0], a[1] + 0.01, a[2], b[0] - side * 0.01, b[1], b[2], 0.04, PAL.wood);
    }
  }
  for (const e of [-1, 1]) {
    const s = e * ST[N - 3], b = hb(s), g = gy(s) + 0.014, tip = sec(e, 3, 1), heel = sec(e, 0, 1);
    k.tri([-b, g, s * HL], [b, g, s * HL], [0, tip[1] + 0.02, tip[2]], PAL.woodDark, true); // deck plate
    k.box(b * 1.7, 0.04, 0.07, PAL.woodLight, 0, g + 0.01, s * HL); // carry handle
    k.beam(0, heel[1] - 0.03, heel[2], 0, tip[1] + 0.06, tip[2], 0.07, PAL.woodDark); // stem
    k.bolt(0, gy(0.93) + 0.03, e * (HL - 0.2), 0, 0, 0.03, PAL.tin);
  }
  for (const ry of [0.65, -0.65]) k.box(0.34, 0.014, 0.075, PAL.tin, 0, 0.607, 2.3, -0.26, ry, 0); // tape cross on the stern deck
  // yoke, thwart, two seats
  for (const z of [-0.16, 0.62]) { const s = z / HL; k.box(hb(s) * 1.92, 0.04, 0.1, PAL.woodDark, 0, gy(s) - 0.03, z); }
  for (const z of [-1.4, 1.3]) {
    const s = z / HL, w = hb(s) * 1.84, y = gy(s) - 0.12;
    k.box(w, 0.045, 0.36, PAL.wood, 0, y, z);
    k.box(w * 0.7, 0.05, 0.25, PAL.creamDark, 0, y + 0.004, z);
    for (const sx of [-1, 1]) k.box(0.03, 0.12, 0.03, PAL.iron, sx * w * 0.47, y + 0.06, z);
  }
  // patches: the canoe has history
  const patch = (s0, s1, f0, f1, side, color, lift) => k.quadOut(skin(s0, f0, side, lift), skin(s1, f0, side, lift), skin(s1, f1, side, lift), skin(s0, f1, side, lift), [side, -0.2, 0], color);
  const nails = (s0, s1, f0, f1, side) => { for (const s of [s0 + 0.012, s1 - 0.012]) for (const f of [f0 + 0.05, f1 - 0.05]) patch(s - 0.006, s + 0.006, f - 0.03, f + 0.03, side, PAL.iron, 0.024); };
  patch(0.24, 0.36, 0.5, 0.95, -1, PAL.birchBark); nails(0.24, 0.36, 0.5, 0.95, -1);
  patch(0.46, 0.58, 0.62, 0.8, -1, PAL.tin); patch(0.505, 0.535, 0.48, 0.96, -1, PAL.tin, 0.02);
  patch(-0.36, -0.25, 0.42, 0.9, -1, PAL.woodLight); nails(-0.36, -0.25, 0.42, 0.9, -1);
  patch(-0.6, -0.5, 0.55, 0.78, -1, PAL.tin);
  patch(0.47, 0.59, 0.5, 0.92, 1, PAL.birchBark); nails(0.47, 0.59, 0.5, 0.92, 1);
  patch(0.25, 0.36, 0.6, 0.78, 1, PAL.tin); patch(0.29, 0.32, 0.46, 0.94, 1, PAL.tin, 0.02);
  patch(-0.42, -0.31, 0.45, 0.92, 1, PAL.pineLight); nails(-0.42, -0.31, 0.45, 0.92, 1);
  return k.mesh(flatMat, 'hull');
}

// What the starter canoe carries: a puddle, a bailing can, a bedroll.
function buildStarterKit() {
  const k = new Kit(21);
  const y = -0.085;
  for (let i = 0; i < N; i++) {
    const s0 = ST[i], s1 = ST[i + 1];
    if (Math.abs(s0) > 0.65 || Math.abs(s1) > 0.65) continue;
    const w0 = hb(s0) * 0.62, w1 = hb(s1) * 0.62;
    k.quad([-w0, y, s0 * HL], [w0, y, s0 * HL], [w1, y, s1 * HL], [-w1, y, s1 * HL], i & 1 ? 0x5fd8c6 : 0x49c4b6, true);
  }
  k.cyl(0.075, 0.075, 0.15, 7, PAL.tin, 0.14, -0.05, 0.25, 0.5, 0.6, 1.3); // bailing can
  k.cyl(0.15, 0.15, 0.62, 7, PAL.tarp, 0, 0.06, -1.95, 0, 0, Math.PI / 2); // bedroll in the bow
  for (const x of [-0.17, 0.17]) k.cyl(0.158, 0.158, 0.05, 7, PAL.rope, x, 0.06, -1.95, 0, 0, Math.PI / 2);
  k.box(0.36, 0.26, 0.3, 0x7d8a4e, -0.04, 0.02, -0.72, 0, 0.2, 0); // pack
  k.box(0.38, 0.05, 0.32, 0x66733f, -0.04, 0.16, -0.72, 0, 0.2, 0);
  return k.mesh(flatMat, 'starter-kit');
}

// ---------------------------------------------------------------- attachments
const BY = 0.58; // crossbeam height
const DECK = 0.685; // deck top
const BEAM_Z = [-1.55, 0.35, 2.2];

function outriggers() {
  const k = new Kit(11);
  for (const z of BEAM_Z) {
    k.beam(-2.78, BY, z, 2.78, BY, z, 0.15, PAL.driftwood, 6);
    const s = z / HL, g = gy(s), b = hb(s);
    for (const side of [-1, 1]) {
      k.box(0.15, BY - g - 0.03, 0.22, PAL.woodDark, side * b, (BY + g) / 2 - 0.03, z); // riser block on the gunwale
      k.box(0.22, 0.05, 0.3, PAL.iron, side * b, g + 0.03, z); // strap plate
      k.bolt(side * b, g + 0.06, z - 0.11); k.bolt(side * b, g + 0.06, z + 0.11);
      k.box(0.05, 0.2, 0.26, PAL.iron, side * (b + 0.1), BY - 0.02, z); // u-bolt
      k.cyl(0.095, 0.095, 0.16, 6, PAL.rope, side * (b + 0.32), BY, z, 0, 0, Math.PI / 2); // lashing
      k.cyl(0.095, 0.095, 0.16, 6, PAL.rope, side * 2.5, BY, z, 0, 0, Math.PI / 2);
      k.box(0.12, 0.34, 0.12, PAL.wood, side * 2.5, BY - 0.2, z); // strut down to the float
    }
  }
  // port float: salvaged drums. starboard float: a painted log pontoon.
  const drumCol = [PAL.drum, PAL.cream, PAL.drum, PAL.rust];
  for (let i = 0; i < 4; i++) {
    const z = -1.72 + i * 1.2;
    k.cyl(0.33, 0.33, 1.08, 8, drumCol[i], -2.5, 0.05, z, Math.PI / 2);
    for (const dz of [-0.3, 0.3]) k.cyl(0.345, 0.345, 0.05, 8, PAL.iron, -2.5, 0.05, z + dz, Math.PI / 2);
  }
  k.beam(-2.5, 0.42, -2.35, -2.5, 0.42, 2.5, 0.11, PAL.wood, 6);
  k.cyl(0.31, 0.31, 4.1, 7, PAL.pineLight, 2.5, 0.04, 0.2, Math.PI / 2);
  k.cyl(0.318, 0.318, 0.5, 7, PAL.cream, 2.5, 0.04, -0.9, Math.PI / 2);
  k.cyl(0.318, 0.318, 0.5, 7, PAL.cream, 2.5, 0.04, 1.3, Math.PI / 2);
  k.cone(0.31, 0.8, 7, PAL.cream, 2.5, 0.04, -2.25, -Math.PI / 2);
  k.cone(0.31, 0.8, 7, PAL.cream, 2.5, 0.04, 2.65, Math.PI / 2);
  // plank decks, nailed to the beams, with a gap left beside the hull for the paddle
  const woods = [PAL.wood, PAL.woodLight, PAL.woodGrey, PAL.woodDark, PAL.driftwood, PAL.woodLight, PAL.wood, PAL.woodGrey];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 8; i++) {
      const x = side * (1.31 + i * 0.178);
      const len = 4.25 + k.rand() * 0.3, zc = 0.32 + (k.rand() - 0.5) * 0.16;
      let c = woods[(i + (side > 0 ? 3 : 0)) % 8];
      if (side < 0 && i === 5) c = PAL.pineLight;
      if (side > 0 && i === 2) c = PAL.cream;
      k.box(0.165, 0.04, len, c, x, DECK - 0.02, zc);
      for (const z of BEAM_Z) k.box(0.035, 0.012, 0.035, PAL.iron, x, DECK + 0.004, z);
    }
    k.beam(side * 2.68, DECK + 0.03, -1.85, side * 2.68, DECK + 0.03, 2.5, 0.08, PAL.woodDark);
  }
  return k.mesh(flatMat, 'outriggers');
}

const MAST_Z = -0.6;
const MAST_TOP = 5.65;
const SAIL_A = -0.55; // boom swings out to port
function mastAndSail(anim) {
  const g = new THREE.Group();
  g.name = 'mast-sail';
  const k = new Kit(12);
  const gm = gy(MAST_Z / HL);
  k.box(1.14, 0.07, 0.34, PAL.woodDark, 0, gm + 0.035, MAST_Z); // mast partner plank
  for (const sx of [-1, 1]) { k.bolt(sx * 0.46, gm + 0.08, MAST_Z - 0.1); k.bolt(sx * 0.46, gm + 0.08, MAST_Z + 0.1); }
  k.cyl(0.15, 0.15, 0.12, 8, PAL.iron, 0, gm + 0.12, MAST_Z);
  k.cyl(0.05, 0.09, MAST_TOP - 0.1, 7, PAL.woodLight, 0, (MAST_TOP + 0.1) / 2, MAST_Z);
  k.cyl(0.075, 0.075, 0.1, 7, PAL.iron, 0, 4.72, MAST_Z);
  k.ico(0.085, 0, PAL.blaze, 0, MAST_TOP + 0.05, MAST_Z);
  const ex = Math.sin(SAIL_A), ez = Math.cos(SAIL_A);
  const P = (a, y) => [ex * a, y, MAST_Z + ez * a];
  const boomA = P(-0.7, 1.5), boomB = P(2.45, 1.42), yardA = P(-1.0, 4.05), yardB = P(2.05, 5.5);
  k.beam(...boomA, ...boomB, 0.085, PAL.wood, 6);
  k.beam(...yardA, ...yardB, 0.075, PAL.wood, 6);
  k.cyl(0.1, 0.1, 0.12, 6, PAL.rope, 0, 1.49, MAST_Z);
  k.cyl(0.1, 0.1, 0.12, 6, PAL.rope, 0, 4.52, MAST_Z);
  // standing rigging
  k.beam(0, 5.3, MAST_Z, 0, gy(1) + 0.08, -HL + 0.05, 0.028, PAL.iron);
  k.beam(0, 4.7, MAST_Z, -2.6, BY + 0.08, -1.55, 0.028, PAL.iron);
  k.beam(0, 4.7, MAST_Z, 2.6, BY + 0.08, -1.55, 0.028, PAL.iron);
  k.beam(...boomB, 0.2, 0.75, 2.05, 0.022, PAL.rope); // sheet
  g.add(k.mesh(flatMat, 'mast'));

  // sail: a patched lug sail that breathes
  const U = 5, V = 6;
  const tack = [-0.55, 1.56], clew = [2.3, 1.5], throat = [-0.85, 4.12], peak = [1.9, 5.42];
  const patchCol = { '1,3': PAL.tarp, '3,1': PAL.pineLight, '2,4': PAL.creamDark, '0,1': PAL.woodLight, '4,4': PAL.canoeRedFaded };
  const count = U * V * 6;
  const pos = new Float32Array(count * 3), colr = new Float32Array(count * 3);
  const c = new THREE.Color();
  let ci = 0;
  for (let v = 0; v < V; v++) for (let u = 0; u < U; u++) {
    c.set(patchCol[u + ',' + v] ?? (u & 1 ? PAL.canvas : PAL.canvasShade)).multiplyScalar(0.96 + ((u * 7 + v * 3) % 5) * 0.02);
    for (let q = 0; q < 6; q++) { c.toArray(colr, ci); ci += 3; }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  const pt = (u, v, belly, out) => {
    const fu = u / U, fv = v / V;
    const a = (tack[0] * (1 - fu) + clew[0] * fu) * (1 - fv) + (throat[0] * (1 - fu) + peak[0] * fu) * fv;
    const y = (tack[1] * (1 - fu) + clew[1] * fu) * (1 - fv) + (throat[1] * (1 - fu) + peak[1] * fu) * fv;
    const bl = belly * Math.sin(Math.PI * fu) * Math.pow(Math.sin(Math.PI * fv), 0.8);
    out[0] = ex * a + ez * bl; out[1] = y; out[2] = MAST_Z + ez * a - ex * bl;
  };
  const a = [0, 0, 0], b = [0, 0, 0], cc = [0, 0, 0], d = [0, 0, 0];
  const fill = (belly) => {
    let i = 0;
    for (let v = 0; v < V; v++) for (let u = 0; u < U; u++) {
      pt(u, v, belly, a); pt(u + 1, v, belly, b); pt(u + 1, v + 1, belly, cc); pt(u, v + 1, belly, d);
      for (const p of [a, b, cc, a, cc, d]) { pos[i++] = p[0]; pos[i++] = p[1]; pos[i++] = p[2]; }
    }
    geo.attributes.position.needsUpdate = true;
  };
  fill(0.42);
  geo.computeVertexNormals();
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0.6, 3.4, 0), 3.2);
  const sail = new THREE.Mesh(geo, flatMatDouble);
  sail.castShadow = true;
  sail.name = 'sail';
  g.add(sail);
  anim.push((t) => fill(0.42 + 0.07 * Math.sin(t * 1.3) + 0.03 * Math.sin(t * 3.1)));
  return g;
}

function rudder(anim) {
  const g = new THREE.Group();
  g.name = 'rudder';
  const k = new Kit(13);
  const gs = gy(1);
  for (const [y, z] of [[0.1, HL + 0.07], [gs - 0.1, HL + 0.2]]) {
    k.box(0.16, 0.07, 0.2, PAL.iron, 0, y, z);
    k.bolt(0.085, y, z - 0.05, 0, Math.PI / 2); k.bolt(-0.085, y, z - 0.05, 0, Math.PI / 2);
  }
  g.add(k.mesh(flatMat, 'rudder-mount'));
  const m = new Kit(14);
  m.box(0.075, 1.32, 0.13, PAL.wood, 0, 0.22, 0.1);
  m.box(0.055, 0.6, 0.56, PAL.pineLight, 0, -0.16, 0.42);
  m.box(0.06, 0.12, 0.565, PAL.cream, 0, 0.02, 0.42);
  m.beam(0, 0.86, 0.1, 0, 0.74, -0.92, 0.06, PAL.woodLight);
  m.ico(0.06, 0, PAL.canoeRed, 0, 0.73, -0.95);
  m.bolt(0.045, 0.5, 0.1, 0, Math.PI / 2); m.bolt(0.045, 0.1, 0.1, 0, Math.PI / 2);
  const blade = m.mesh(flatMat, 'rudder-blade');
  blade.position.set(0, 0, HL + 0.2);
  g.add(blade);
  anim.push((t, dt, st) => { blade.rotation.y += ((st.turn || 0) * 0.5 + Math.sin(t * 0.8) * 0.05 - blade.rotation.y) * Math.min(dt * 6, 1); });
  return g;
}

function cargoRack() {
  const k = new Kit(15);
  const x0 = 1.72, x1 = 2.56, z0 = -1.05, z1 = 0.05, top = DECK + 1.2, shelf = DECK + 0.66;
  for (const x of [x0, x1]) for (const z of [z0, z1]) { k.box(0.07, 1.2, 0.07, PAL.woodDark, x, DECK + 0.6, z); k.bolt(x, DECK + 0.02, z + 0.07); }
  for (const z of [z0, z1]) { k.box(x1 - x0 + 0.1, 0.06, 0.06, PAL.wood, (x0 + x1) / 2, top, z); k.box(x1 - x0 + 0.1, 0.05, 0.06, PAL.wood, (x0 + x1) / 2, shelf - 0.04, z); }
  for (let i = 0; i < 4; i++) k.box(0.19, 0.03, z1 - z0 + 0.1, i & 1 ? PAL.woodLight : PAL.woodGrey, x0 + 0.1 + i * 0.215, shelf, (z0 + z1) / 2);
  // lower tier
  k.cyl(0.25, 0.25, 0.56, 8, PAL.wood, 2.0, DECK + 0.28, -0.74);
  for (const y of [0.12, 0.44]) k.cyl(0.262, 0.262, 0.05, 8, PAL.iron, 2.0, DECK + y, -0.74);
  k.box(0.46, 0.4, 0.42, PAL.woodLight, 2.3, DECK + 0.2, -0.22);
  k.box(0.48, 0.06, 0.44, PAL.woodDark, 2.3, DECK + 0.4, -0.22);
  k.ico(0.26, 1, PAL.canvas, 1.92, DECK + 0.17, -0.2, 1, 0.66, 0.9);
  // upper tier
  k.cyl(0.13, 0.13, 0.7, 7, PAL.tarp, 2.14, shelf + 0.15, -0.8, 0, 0, Math.PI / 2);
  k.box(0.36, 0.3, 0.34, 0x7d8a4e, 1.96, shelf + 0.17, -0.3);
  k.box(0.2, 0.34, 0.12, PAL.canoeRedDeep, 2.4, shelf + 0.19, -0.3); // jerrycan
  k.box(0.06, 0.05, 0.06, PAL.iron, 2.4, shelf + 0.38, -0.3);
  k.cyl(0.14, 0.14, 0.06, 8, PAL.rope, 2.3, top + 0.06, -0.75, 0.1);
  // lashings
  k.beam(x0, top, z1, x1, shelf, z1 + 0.02, 0.025, PAL.rope);
  k.beam(x1, top, z1, x0, shelf, z1 + 0.02, 0.025, PAL.rope);
  k.beam(x0, top, z0, x1, shelf, z0 - 0.02, 0.025, PAL.rope);
  return k.mesh(flatMat, 'cargo-rack');
}

function rainCatcher() {
  const k = new Kit(16);
  const cx = 1.95, cz = 1.86, h = 0.56, top = DECK + 1.6, low = DECK + 0.98;
  const cs = [[cx - h, cz - h], [cx + h, cz - h], [cx + h, cz + h], [cx - h, cz + h]];
  for (const [x, z] of cs) { k.box(0.06, 1.6, 0.06, PAL.wood, x, DECK + 0.8, z); k.bolt(x + 0.05, DECK + 0.03, z); }
  for (let i = 0; i < 4; i++) {
    const a = cs[i], b = cs[(i + 1) % 4];
    k.tri([a[0], top, a[1]], [b[0], top, b[1]], [cx, low, cz], i & 1 ? PAL.tarp : 0xcf7a2e, true);
    k.beam(a[0], top, a[1], b[0], top, b[1], 0.03, PAL.rope);
  }
  k.cyl(0.03, 0.03, 0.3, 5, PAL.tin, cx, low - 0.12, cz); // spout
  k.cyl(0.3, 0.27, 0.66, 8, PAL.barrelBlue, cx, DECK + 0.33, cz);
  for (const y of [0.14, 0.52]) k.cyl(0.31, 0.31, 0.05, 8, PAL.iron, cx, DECK + y, cz);
  k.cyl(0.26, 0.26, 0.02, 8, 0x6fe0d0, cx, DECK + 0.64, cz);
  return k.mesh(flatMat, 'rain-catcher');
}

const STOVE = { x: -2.18, z: -1.32 };
function stove(anim) {
  const g = new THREE.Group();
  g.name = 'stove';
  const k = new Kit(17);
  const { x, z } = STOVE;
  k.box(0.86, 0.025, 0.86, PAL.tin, x, DECK + 0.012, z);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { k.box(0.06, 0.16, 0.06, PAL.iron, x + sx * 0.22, DECK + 0.1, z + sz * 0.18); k.bolt(x + sx * 0.38, DECK + 0.03, z + sz * 0.38, 0, 0, 0.03, PAL.iron); }
  k.box(0.58, 0.42, 0.46, PAL.iron, x, DECK + 0.39, z);
  k.box(0.64, 0.04, 0.52, PAL.ironLight, x, DECK + 0.62, z);
  k.cyl(0.075, 0.075, 1.3, 7, PAL.ironLight, x + 0.16, DECK + 1.29, z - 0.06);
  k.cyl(0.09, 0.09, 0.07, 7, PAL.iron, x + 0.16, DECK + 0.9, z - 0.06);
  k.cone(0.17, 0.14, 7, PAL.iron, x + 0.16, DECK + 2.05, z - 0.06);
  k.cyl(0.12, 0.13, 0.18, 7, PAL.tin, x - 0.14, DECK + 0.73, z + 0.04); // kettle
  k.cone(0.12, 0.08, 7, PAL.tin, x - 0.14, DECK + 0.86, z + 0.04);
  k.beam(x - 0.14, DECK + 0.78, z + 0.04, x - 0.34, DECK + 0.84, z + 0.04, 0.03, PAL.tin);
  for (let i = 0; i < 6; i++) { // firewood
    const row = i < 3 ? 0 : 1;
    k.cyl(0.075, 0.075, 0.42, 6, i & 1 ? PAL.birchBark : PAL.wood, x + 0.5, DECK + 0.08 + row * 0.14, z + 0.5 + ((i % 3) - 1) * 0.16 + row * 0.08, 0, 0, Math.PI / 2);
  }
  g.add(k.mesh(flatMat, 'stove-body'));
  const f = new Kit(18, 0.02);
  f.box(0.02, 0.2, 0.26, 0xffa63d, x - 0.295, DECK + 0.37, z);
  f.box(0.012, 0.1, 0.14, 0xfff0a8, x - 0.3, DECK + 0.35, z);
  f.box(0.3, 0.05, 0.02, 0xffa63d, x, DECK + 0.3, z + 0.235);
  f.box(0.3, 0.05, 0.02, 0xffa63d, x, DECK + 0.3, z - 0.235);
  g.add(f.mesh(glowMat, 'stove-glow', false));
  g.add(smoke(anim, x + 0.16, DECK + 2.15, z - 0.06, 7, 0.13));
  return g;
}

function smoke(anim, x, y, z, n, size) {
  const k = new Kit(19, 0.07);
  k.ico(1, 0, 0xfff1dc);
  const geo = k.geometry();
  const g = new THREE.Group();
  const puffs = [];
  for (let i = 0; i < n; i++) { const m = new THREE.Mesh(geo, glowMat); puffs.push(m); g.add(m); }
  anim.push((t) => {
    for (let i = 0; i < n; i++) {
      const f = (t * 0.22 + i / n) % 1;
      const s = size * (0.35 + f * 1.5) * Math.sin(Math.min(f * 5, 1) * 1.57) * (1 - f * f * f);
      puffs[i].position.set(x + f * f * 0.7 + Math.sin(i * 2.4 + t) * 0.05, y + f * 1.6, z + f * 0.55 + Math.cos(i * 1.7) * 0.06);
      puffs[i].scale.setScalar(Math.max(s, 0.0001));
      puffs[i].rotation.set(i, t * 0.4 + i, 0);
    }
  });
  return g;
}

function workbench() {
  const k = new Kit(20);
  const x = -1.56, z = 0.02, top = DECK + 0.74;
  k.box(0.52, 0.07, 1.24, PAL.woodLight, x, top, z);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { k.box(0.07, 0.72, 0.07, PAL.woodDark, x + sx * 0.2, DECK + 0.36, z + sz * 0.54); k.bolt(x + sx * 0.2 - 0.06, DECK + 0.03, z + sz * 0.54); }
  k.box(0.46, 0.04, 1.1, PAL.woodGrey, x, DECK + 0.2, z);
  k.box(0.34, 0.2, 0.42, PAL.pineLight, x, DECK + 0.32, z - 0.2); // toolbox
  k.box(0.36, 0.04, 0.44, PAL.pine, x, DECK + 0.43, z - 0.2);
  k.box(0.1, 0.04, 0.2, PAL.tin, x, DECK + 0.46, z - 0.2);
  // tool board on the hull side, tools face outward
  const bx = x + 0.27;
  k.box(0.05, 0.6, 1.24, PAL.woodDark, bx, top + 0.33, z);
  k.box(0.07, 1.38, 0.07, PAL.wood, bx, DECK + 0.69, z - 0.6); k.box(0.07, 1.38, 0.07, PAL.wood, bx, DECK + 0.69, z + 0.6);
  const fx = bx - 0.04;
  k.quad([fx, top + 0.56, z - 0.5], [fx, top + 0.56, z - 0.05], [fx, top + 0.42, z - 0.05], [fx, top + 0.3, z - 0.5], PAL.tin, true); // saw blade
  k.box(0.05, 0.16, 0.12, PAL.wood, fx, top + 0.46, z - 0.52);
  k.box(0.04, 0.4, 0.05, PAL.woodLight, fx, top + 0.3, z + 0.18); // hammer
  k.box(0.07, 0.09, 0.2, PAL.iron, fx, top + 0.52, z + 0.18);
  k.box(0.035, 0.38, 0.045, PAL.tin, fx, top + 0.3, z + 0.4, 0.3); // wrench
  k.box(0.045, 0.09, 0.1, PAL.tin, fx, top + 0.5, z + 0.46, 0.3);
  // vise, plank on the go, mug
  k.box(0.16, 0.14, 0.2, PAL.iron, x - 0.1, top + 0.1, z + 0.46);
  k.box(0.2, 0.05, 0.06, PAL.ironLight, x - 0.1, top + 0.19, z + 0.4);
  k.beam(x - 0.1, top + 0.1, z + 0.56, x - 0.1, top + 0.1, z + 0.74, 0.03, PAL.tin, 5);
  k.box(0.14, 0.035, 0.8, PAL.birchBark, x - 0.08, top + 0.055, z - 0.12, 0, 0.12);
  k.cyl(0.045, 0.04, 0.09, 6, PAL.canoeRedFaded, x + 0.1, top + 0.08, z + 0.1);
  return k.mesh(flatMat, 'workbench');
}

function tent() {
  const k = new Kit(22, 0.035);
  const xa = -2.6, xb = -1.3, xm = (xa + xb) / 2, z0 = 1.02, z1 = 2.46, ridge = DECK + 1.2;
  const n = 6, dz = (z1 - z0) / n;
  for (let i = 0; i < n; i++) {
    const c = i & 1 ? PAL.pineLight : PAL.canvas;
    const za = z0 + i * dz, zb = za + dz;
    k.quad([xa, DECK, za], [xa, DECK, zb], [xm, ridge, zb], [xm, ridge, za], c, true);
    k.quad([xb, DECK, zb], [xb, DECK, za], [xm, ridge, za], [xm, ridge, zb], c, true);
  }
  k.tri([xa, DECK, z1], [xb, DECK, z1], [xm, ridge, z1], PAL.canvasShade, true); // back wall
  k.tri([xa, DECK, z0 + 0.03], [xb, DECK, z0 + 0.03], [xm, ridge - 0.04, z0 + 0.03], PAL.pineDark, true); // dark doorway
  k.tri([xa, DECK, z0], [xa + 0.34, DECK, z0], [xm, ridge, z0], PAL.canvas, true); // tied-back flaps
  k.tri([xb, DECK, z0], [xb - 0.34, DECK, z0], [xm, ridge, z0], PAL.canvas, true);
  k.beam(xm, ridge + 0.02, z0 - 0.22, xm, ridge + 0.02, z1 + 0.18, 0.06, PAL.wood, 6);
  for (const z of [z0 - 0.04, z1 + 0.04]) { k.beam(xa - 0.04, DECK, z, xm, ridge + 0.1, z, 0.05, PAL.wood); k.beam(xb + 0.04, DECK, z, xm, ridge + 0.1, z, 0.05, PAL.wood); }
  for (const x of [xa, xb]) for (const z of [z0, z1]) k.bolt(x, DECK + 0.03, z, 0, 0, 0.04);
  k.cyl(0.12, 0.12, 0.6, 7, PAL.tarp, xm + 0.1, DECK + 0.12, z0 + 0.3, 0, 0, Math.PI / 2); // bedroll
  return k.mesh(flatMat, 'tent');
}

function antenna(anim) {
  const g = new THREE.Group();
  g.name = 'antenna';
  const k = new Kit(23);
  const x = -2.52, z = 0.02, top = DECK + 4.3;
  k.box(0.36, 0.26, 0.3, PAL.pine, x + 0.02, DECK + 0.13, z + 0.32); // radio set
  k.box(0.02, 0.14, 0.2, PAL.cream, x + 0.21, DECK + 0.15, z + 0.32);
  k.box(0.14, 0.05, 0.14, PAL.iron, x, DECK + 0.03, z); k.bolt(x + 0.1, DECK + 0.03, z + 0.1, 0, 0, 0.03, PAL.tin);
  k.cyl(0.025, 0.045, top - DECK, 6, PAL.tin, x, (top + DECK) / 2, z);
  for (let i = 0; i < 4; i++) k.box(0.03, 0.03, 1.15 - i * 0.2, PAL.tin, x, top - 0.2 - i * 0.38, z);
  k.box(0.03, 0.03, 0.5, PAL.canoeRed, x, top - 0.02, z);
  k.beam(x, top - 0.9, z, x + 0.1, DECK + 0.04, z - 0.75, 0.018, PAL.iron);
  k.beam(x, top - 0.9, z, x + 0.1, DECK + 0.04, z + 0.85, 0.018, PAL.iron);
  g.add(k.mesh(flatMat, 'antenna-mast'));
  const b = new Kit(24, 0);
  b.ico(0.045, 0, 0xff7a3d, x, top + 0.06, z);
  b.box(0.02, 0.03, 0.04, 0xffd27a, x + 0.225, DECK + 0.2, z + 0.26);
  const blink = b.mesh(glowMat, 'antenna-light', false);
  g.add(blink);
  anim.push((t) => { blink.visible = (t % 1.6) < 1.0; });
  return g;
}

function fishing(anim) {
  const g = new THREE.Group();
  g.name = 'fishing-rig';
  const k = new Kit(25);
  const bobs = [];
  for (const [z, reach, lift] of [[1.3, 2.5, 1.5], [2.25, 2.1, 1.25]]) {
    const bx = -2.66, tipX = bx - reach, tipY = DECK + lift, tipZ = z + 0.35;
    k.box(0.1, 0.22, 0.1, PAL.iron, bx, DECK + 0.1, z); k.bolt(bx + 0.07, DECK + 0.05, z, 0, Math.PI / 2);
    const mx = bx - reach * 0.55, my = DECK + lift * 0.72, mz = z + 0.15;
    k.beam(bx, DECK + 0.08, z, mx, my, mz, 0.045, PAL.woodDark, 5, 0.03);
    k.beam(mx, my, mz, tipX, tipY, tipZ, 0.03, PAL.woodLight, 5, 0.014);
    k.cyl(0.05, 0.05, 0.05, 7, PAL.tin, bx - 0.2, DECK + 0.33, z + 0.07, 0, 0, Math.PI / 2); // reel
    k.beam(tipX, tipY, tipZ, tipX - 0.15, 0.05, tipZ + 0.2, 0.012, PAL.cream);
    const bk = new Kit(26, 0);
    bk.ico(0.075, 0, PAL.cream, 0, 0.045, 0, 1, 0.8, 1);
    bk.ico(0.076, 0, PAL.canoeRed, 0, -0.01, 0, 1, 0.7, 1);
    bk.cyl(0.008, 0.008, 0.14, 4, PAL.iron, 0, 0.12, 0);
    const bob = bk.mesh(flatMat, 'bobber');
    bob.position.set(tipX - 0.15, 0.02, tipZ + 0.2);
    bobs.push(bob);
    g.add(bob);
  }
  g.add(k.mesh(flatMat, 'rods'));
  anim.push((t) => bobs.forEach((b, i) => { b.position.y = 0.02 + Math.sin(t * 2.3 + i * 2) * 0.03; b.rotation.z = Math.sin(t * 1.7 + i) * 0.25; }));
  return g;
}

function winch() {
  const k = new Kit(27);
  const ax = 2.25, ay = DECK + 1.75, az = -2.75;
  k.beam(1.9, DECK, -1.72, ax, ay, az, 0.09, PAL.wood);
  k.beam(2.6, DECK, -1.72, ax, ay, az, 0.09, PAL.wood);
  k.beam(ax, DECK, -0.98, ax, ay - 0.05, az + 0.05, 0.06, PAL.woodDark);
  for (const x of [1.9, 2.6]) { k.box(0.16, 0.05, 0.16, PAL.iron, x, DECK + 0.025, -1.72); k.bolt(x, DECK + 0.06, -1.66); }
  k.box(0.14, 0.05, 0.14, PAL.iron, ax, DECK + 0.025, -0.98);
  k.cyl(0.11, 0.11, 0.07, 8, PAL.iron, ax, ay, az, 0, 0, Math.PI / 2); // pulley
  // drum + crank
  for (const x of [1.98, 2.52]) k.box(0.05, 0.4, 0.3, PAL.iron, x, DECK + 0.2, -1.38);
  k.cyl(0.14, 0.14, 0.5, 8, PAL.rope, ax, DECK + 0.26, -1.38, 0, 0, Math.PI / 2);
  k.beam(2.52, DECK + 0.26, -1.38, 2.7, DECK + 0.26, -1.38, 0.04, PAL.iron, 5);
  k.beam(2.7, DECK + 0.26, -1.38, 2.7, DECK + 0.5, -1.32, 0.04, PAL.iron, 5);
  k.beam(2.7, DECK + 0.5, -1.32, 2.86, DECK + 0.5, -1.32, 0.05, PAL.canoeRed, 5);
  // cable up over the pulley, down to the catch
  k.beam(ax, DECK + 0.4, -1.4, ax, ay + 0.08, az + 0.05, 0.022, PAL.rope);
  k.beam(ax, ay - 0.05, az - 0.06, ax, 0.92, az - 0.06, 0.022, PAL.rope);
  k.box(0.05, 0.14, 0.05, PAL.iron, ax, 0.86, az - 0.06);
  for (const s of [-1, 1]) k.beam(ax, 0.8, az - 0.06, ax + s * 0.22, 0.56, az - 0.06, 0.02, PAL.rope);
  k.box(0.5, 0.36, 0.44, PAL.woodGrey, ax, 0.38, az - 0.06, 0.06, 0.3, 0.05); // salvaged crate, dripping
  k.box(0.52, 0.06, 0.46, PAL.woodDark, ax, 0.57, az - 0.06, 0.06, 0.3, 0.05);
  k.box(0.1, 0.24, 0.02, PAL.mossDark, ax + 0.12, 0.26, az - 0.3, 0, 0.3);
  return k.mesh(flatMat, 'winch');
}

function smoker(anim) {
  const g = new THREE.Group();
  g.name = 'smoker';
  const k = new Kit(28);
  const x = 2.28, z = 0.58;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.06, 0.16, 0.06, PAL.iron, x + sx * 0.2, DECK + 0.08, z + sz * 0.2);
  k.box(0.52, 1.1, 0.52, PAL.woodDark, x, DECK + 0.7, z);
  k.box(0.03, 0.9, 0.38, PAL.wood, x - 0.265, DECK + 0.7, z); // door, facing the hull
  k.box(0.035, 0.07, 0.05, PAL.tin, x - 0.28, DECK + 0.72, z + 0.13);
  for (const y of [0.4, 1.0]) k.box(0.04, 0.06, 0.1, PAL.iron, x - 0.275, DECK + y, z - 0.19);
  k.box(0.66, 0.05, 0.66, PAL.tin, x, DECK + 1.3, z, 0, 0, 0.16);
  k.cyl(0.05, 0.05, 0.34, 6, PAL.ironLight, x + 0.12, DECK + 1.5, z);
  k.cone(0.1, 0.08, 6, PAL.iron, x + 0.12, DECK + 1.7, z);
  // drying rack: fish on a line
  const rz = 1.08, y = DECK + 1.22;
  for (const px of [1.72, 2.56]) { k.box(0.06, 1.25, 0.06, PAL.wood, px, DECK + 0.62, rz); k.bolt(px, DECK + 0.03, rz + 0.06); }
  k.beam(1.66, y, rz, 2.62, y, rz, 0.03, PAL.rope);
  for (let i = 0; i < 4; i++) {
    const fx = 1.86 + i * 0.19, c = i & 1 ? 0xf08a6c : PAL.tin;
    k.beam(fx, y, rz, fx, y - 0.08, rz, 0.012, PAL.rope);
    k.quad([fx, y - 0.08, rz], [fx + 0.06, y - 0.2, rz], [fx, y - 0.36, rz], [fx - 0.06, y - 0.2, rz], c, true);
    k.tri([fx, y - 0.33, rz], [fx + 0.06, y - 0.45, rz], [fx - 0.06, y - 0.45, rz], c, true);
  }
  g.add(k.mesh(flatMat, 'smoker-body'));
  g.add(smoke(anim, x + 0.12, DECK + 1.76, z, 4, 0.12));
  return g;
}

function planters() {
  const k = new Kit(29);
  for (const [z0, z1] of [[-1.56, -0.52], [-0.3, 0.74]]) {
    const zc = (z0 + z1) / 2, len = z1 - z0, x = 1.42;
    k.box(0.34, 0.26, len, PAL.wood, x, DECK + 0.13, zc);
    k.box(0.38, 0.05, len + 0.04, PAL.woodDark, x, DECK + 0.25, zc);
    k.box(0.27, 0.03, len - 0.08, PAL.soil, x, DECK + 0.28, zc);
    for (const z of [z0 + 0.06, z1 - 0.06]) k.bolt(x - 0.18, DECK + 0.1, z, 0, Math.PI / 2);
    const n = 5;
    for (let i = 0; i < n; i++) {
      const z = z0 + 0.14 + (i * (len - 0.28)) / (n - 1), r = k.rand();
      if (r < 0.45) { // leafy tuft
        k.cone(0.1, 0.3, 5, PAL.moss, x, DECK + 0.43, z, 0, r * 6, 0, true);
        k.cone(0.07, 0.22, 5, PAL.spruceLight, x + 0.06, DECK + 0.39, z + 0.05, 0.3, r * 3, 0.3, true);
      } else if (r < 0.75) { // squash
        k.ico(0.085, 0, PAL.drum, x - 0.02, DECK + 0.34, z, 1, 0.75, 1);
        k.cone(0.09, 0.16, 5, PAL.mossDark, x + 0.07, DECK + 0.36, z, 0, 0, -0.5, true);
      } else { // bean pole
        k.box(0.02, 0.62, 0.02, PAL.woodLight, x, DECK + 0.58, z);
        for (let j = 0; j < 4; j++) k.ico(0.06, 0, j & 1 ? PAL.moss : PAL.spruceLight, x + (j & 1 ? 0.04 : -0.04), DECK + 0.4 + j * 0.13, z, 1, 0.8, 1);
      }
    }
  }
  return k.mesh(flatMat, 'planters');
}

const LANTERN = new THREE.Vector3(0, 1.5, -3.02);
function lanternMast(anim) {
  const g = new THREE.Group();
  g.name = 'lantern-mast';
  const k = new Kit(30);
  const gb = gy(1);
  k.box(0.2, 0.05, 0.3, PAL.iron, 0, gb - 0.02, -2.3); k.bolt(0.06, gb + 0.02, -2.2, 0, 0, 0.03, PAL.tin); k.bolt(-0.06, gb + 0.02, -2.2, 0, 0, 0.03, PAL.tin);
  k.beam(0, gb - 0.06, -2.32, 0, 1.62, -2.72, 0.07, PAL.wood, 6);
  k.beam(0, 1.62, -2.72, 0, 1.92, -2.98, 0.055, PAL.wood, 6);
  k.beam(0, 1.92, -2.98, 0, 1.86, -3.06, 0.04, PAL.iron, 5);
  k.cyl(0.085, 0.085, 0.09, 6, PAL.rope, 0, 1.0, -2.57, -0.34);
  g.add(k.mesh(flatMat, 'lantern-post'));
  const swing = new THREE.Group();
  swing.position.set(0, 1.86, -3.04);
  const l = new Kit(31);
  l.beam(0, 0, 0, 0, -0.14, 0, 0.015, PAL.iron);
  l.cone(0.11, 0.09, 6, PAL.iron, 0, -0.17, 0);
  l.cyl(0.1, 0.1, 0.03, 6, PAL.iron, 0, -0.44, 0);
  for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2 + 0.78; l.box(0.014, 0.24, 0.014, PAL.iron, Math.cos(a) * 0.085, -0.32, Math.sin(a) * 0.085); }
  swing.add(l.mesh(flatMat, 'lantern-frame'));
  const gl = new Kit(32, 0.04);
  gl.cyl(0.07, 0.07, 0.2, 6, 0xffd27a, 0, -0.32, 0);
  gl.cyl(0.035, 0.035, 0.12, 5, 0xfff6c8, 0, -0.32, 0);
  swing.add(gl.mesh(glowMat, 'lantern-glass', false));
  const light = new THREE.PointLight(0xffb45e, 5, 7, 1.6);
  light.position.set(0, -0.32, 0);
  swing.add(light);
  g.add(swing);
  anim.push((t) => { swing.rotation.x = Math.sin(t * 1.9) * 0.14; swing.rotation.z = Math.sin(t * 1.3 + 1) * 0.1; });
  return g;
}

// Bunting, a homestead flag and a masthead pennant, all on one flapping mesh.
function flags(anim) {
  const g = new THREE.Group();
  g.name = 'flags';
  const k = new Kit(33);
  const staffTop = [0, 2.05, HL + 0.06];
  k.beam(0, gy(1) - 0.02, HL - 0.14, ...staffTop, 0.045, PAL.wood, 5);
  k.box(0.12, 0.05, 0.16, PAL.iron, 0, gy(1) + 0.04, HL - 0.14);
  g.add(k.mesh(flatMat, 'flag-staff'));

  const pos = [], colr = [], base = [], wgt = [], dir = [];
  const c = new THREE.Color();
  const tri = (pts, color, ws, d) => {
    c.set(color);
    pts.forEach((p, i) => { pos.push(p[0], p[1], p[2]); base.push(p[0], p[1], p[2]); colr.push(c.r, c.g, c.b); wgt.push(ws[i]); dir.push(d[0], d[1], d[2]); });
  };
  const line = (a, b, n, sag, cols, thick) => {
    const P = (f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f - sag * Math.sin(Math.PI * f), a[2] + (b[2] - a[2]) * f];
    const seg = n * 2 + 1;
    for (let i = 0; i < seg; i++) {
      const p = P(i / seg), q = P((i + 1) / seg);
      tri([p, q, [q[0], q[1] - thick, q[2]]], PAL.rope, [0, 0, 0], [1, 0, 0]);
      tri([p, [q[0], q[1] - thick, q[2]], [p[0], p[1] - thick, p[2]]], PAL.rope, [0, 0, 0], [1, 0, 0]);
      if (i & 1) {
        const mid = P((i + 0.5) / seg);
        tri([p, q, [mid[0], mid[1] - 0.5, mid[2]]], cols[((i - 1) / 2) % cols.length], [0, 0, 1], [1, 0, 0]);
      }
    }
  };
  const mastTop = [0, MAST_TOP - 0.25, MAST_Z];
  const buntCols = [PAL.cream, PAL.blaze, PAL.pineLight, PAL.canoeRed, PAL.cream, PAL.tarp];
  line(mastTop, staffTop, 7, 0.5, buntCols, 0.025);
  line(mastTop, [0, 1.92, -2.98], 5, 0.35, buntCols, 0.025);
  // homestead flag on the stern staff: pine field, cream blaze diamond
  const fy = 1.98, fz = HL + 0.07, fw = 0.72, fh = 0.44;
  const fl = (u, v) => [0, fy - v * fh, fz + u * fw];
  for (let u = 0; u < 3; u++) {
    const u0 = u / 3, u1 = (u + 1) / 3;
    tri([fl(u0, 0), fl(u1, 0), fl(u1, 1)], PAL.pineLight, [u0, u1, u1], [1, 0, 0]);
    tri([fl(u0, 0), fl(u1, 1), fl(u0, 1)], PAL.pineLight, [u0, u1, u0], [1, 0, 0]);
  }
  for (const sx of [-0.004, 0.004]) {
    tri([[sx, fy - fh * 0.5, fz + fw * 0.3], [sx, fy - fh * 0.2, fz + fw * 0.5], [sx, fy - fh * 0.5, fz + fw * 0.7]], PAL.cream, [0.3, 0.5, 0.7], [1, 0, 0]);
    tri([[sx, fy - fh * 0.5, fz + fw * 0.3], [sx, fy - fh * 0.5, fz + fw * 0.7], [sx, fy - fh * 0.8, fz + fw * 0.5]], PAL.cream, [0.3, 0.7, 0.5], [1, 0, 0]);
  }
  // masthead pennant
  const py = MAST_TOP - 0.02, pz = MAST_Z;
  tri([[0, py, pz], [0, py - 0.14, pz + 0.55], [0, py - 0.32, pz]], PAL.canoeRed, [0, 0.55, 0], [1, 0, 0]);
  tri([[0, py - 0.02, pz + 0.3], [0, py - 0.16, pz + 1.15], [0, py - 0.26, pz + 0.3]], PAL.canoeRed, [0.3, 1.15, 0.3], [1, 0, 0]);

  const geo = new THREE.BufferGeometry();
  const pa = new THREE.BufferAttribute(new Float32Array(pos), 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', pa);
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  geo.computeVertexNormals();
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3, 0), 4.5);
  const m = new THREE.Mesh(geo, flatMatDouble);
  m.castShadow = true;
  m.name = 'bunting';
  g.add(m);
  anim.push((t) => {
    const a = pa.array;
    for (let i = 0; i < wgt.length; i++) {
      const w = wgt[i];
      if (!w) continue;
      const ph = base[i * 3 + 2] * 2.1 + base[i * 3 + 1] * 1.3;
      a[i * 3] = base[i * 3] + (Math.sin(t * 5.2 + ph) * 0.11 + Math.sin(t * 8.1 + ph * 1.7) * 0.04 + 0.06) * w;
    }
    pa.needsUpdate = true;
  });
  return g;
}

function hullCargo() {
  const k = new Kit(34);
  k.ico(0.24, 1, PAL.canvas, -0.1, 0.0, -0.75, 1, 0.7, 1.1);
  k.ico(0.22, 1, PAL.canvasShade, 0.14, 0.02, -1.0, 1, 0.7, 1);
  k.box(0.42, 0.3, 0.36, PAL.woodLight, 0, 0.0, 0.22, 0, 0.15);
  k.box(0.44, 0.05, 0.38, PAL.woodDark, 0, 0.16, 0.22, 0, 0.15);
  k.cyl(0.13, 0.13, 0.58, 7, PAL.tarp, 0, 0.08, -1.95, 0, 0, Math.PI / 2);
  return k.mesh(flatMat, 'hull-cargo');
}

// ---------------------------------------------------------------- paddler
const SEAT = new THREE.Vector3(0, gy(0.5) - 0.095, 1.3);
const PADDLE_LEN = 1.66;

function buildPaddler() {
  const g = new THREE.Group();
  g.name = 'paddler';
  const sit = new Kit(40);
  sit.box(0.42, 0.18, 0.28, PAL.pants, 0, 0.09, 0);
  for (const x of [-0.115, 0.115]) {
    sit.box(0.17, 0.16, 0.44, PAL.pants, x, 0.09, -0.26);
    sit.box(0.15, 0.36, 0.16, PAL.pants, x, -0.1, -0.45);
    sit.box(0.17, 0.11, 0.28, PAL.boots, x, -0.3, -0.5);
  }
  const legsSit = sit.mesh(flatMat, 'legs-sit');
  const st = new Kit(41);
  st.box(0.42, 0.2, 0.28, PAL.pants, 0, 0.62, 0);
  for (const x of [-0.115, 0.115]) { st.box(0.17, 0.5, 0.2, PAL.pants, x, 0.33, 0); st.box(0.18, 0.12, 0.3, PAL.boots, x, 0.06, -0.04); }
  const legsStand = st.mesh(flatMat, 'legs-stand');
  legsStand.visible = false;

  const torso = new THREE.Group();
  const t = new Kit(42, 0.03);
  t.box(0.48, 0.52, 0.3, PAL.sweater, 0, 0.36, 0);
  t.box(0.49, 0.07, 0.31, PAL.pineLight, 0, 0.4, 0);
  t.box(0.49, 0.035, 0.31, PAL.canoeRed, 0, 0.31, 0);
  t.box(0.34, 0.1, 0.34, PAL.toque, 0, 0.64, 0); // scarf
  t.box(0.1, 0.26, 0.05, PAL.toque, 0.1, 0.5, 0.17);
  t.ico(0.215, 1, PAL.skin, 0, 0.86, 0, 1, 1.02, 1, false);
  t.box(0.3, 0.16, 0.1, PAL.hair, 0, 0.82, 0.16);
  t.cyl(0.19, 0.225, 0.2, 7, PAL.toque, 0, 1.02, 0);
  t.cyl(0.235, 0.235, 0.075, 7, PAL.cream, 0, 0.93, 0);
  t.ico(0.075, 0, PAL.cream, 0, 1.16, 0);
  for (const x of [-0.08, 0.08]) t.box(0.035, 0.045, 0.02, 0x2a211c, x, 0.87, -0.205);
  torso.add(t.mesh(flatMat, 'torso'));

  const ak = new Kit(43, 0.02);
  ak.box(0.14, 0.86, 0.14, PAL.sweater, 0, -0.43, 0);
  ak.box(0.145, 0.06, 0.145, PAL.pineLight, 0, -0.82, 0);
  ak.box(0.12, 0.14, 0.12, PAL.skin, 0, -0.93, 0);
  const armGeo = ak.geometry();
  const arms = [new THREE.Mesh(armGeo, flatMat), new THREE.Mesh(armGeo, flatMat)];
  arms.forEach((a) => { a.castShadow = true; });

  const pk = new Kit(44, 0.03);
  pk.cyl(0.024, 0.024, 1.14, 6, PAL.woodLight, 0, -0.57, 0);
  pk.box(0.13, 0.045, 0.045, PAL.wood, 0, 0, 0);
  pk.box(0.18, 0.52, 0.028, PAL.woodLight, 0, -1.4, 0);
  pk.box(0.184, 0.15, 0.032, PAL.canoeRed, 0, -1.585, 0);
  pk.cyl(0.03, 0.03, 0.1, 6, PAL.tin, 0, -0.46, 0);
  const paddle = pk.mesh(flatMat, 'paddle');

  g.add(legsSit, legsStand, torso, arms[0], arms[1], paddle);
  const down = new THREE.Vector3(0, -1, 0);
  const T = new THREE.Vector3(), B = new THREE.Vector3(), D = new THREE.Vector3(), H = new THREE.Vector3(), S = new THREE.Vector3();
  const aim = (obj, from, to, stretch) => {
    D.subVectors(to, from);
    const len = D.length();
    obj.position.copy(from);
    obj.quaternion.setFromUnitVectors(down, D.normalize());
    if (stretch) obj.scale.set(1, len / 1.0, 1);
  };
  let standing = false;
  let side = -1;
  const api = {
    group: g,
    setStanding(v) { standing = v; legsSit.visible = !v; legsStand.visible = v; torso.position.y = v ? 0.66 : 0.12; },
    // phase 0..1 through one stroke, effort 0 (resting) .. 1 (digging in), wantSide -1 port / +1 starboard
    update(t, phase, effort, wantSide) {
      const baseY = torso.position.y;
      if (standing) {
        torso.rotation.set(0, 0, 0);
        const breathe = Math.sin(t * 1.6) * 0.01;
        torso.position.y = 0.66 + breathe;
        T.set(0.36, 0.0, -0.06); B.set(0.38, PADDLE_LEN, -0.02); // paddle planted like a walking staff, blade up
        aim(paddle, T, B, false);
        aim(arms[0], S.set(0.27, baseY + 0.56, 0), H.set(0.37, 1.02, -0.05), true);
        aim(arms[1], S.set(-0.27, baseY + 0.56, 0), H.set(-0.31, baseY + 0.02, 0.02), true);
        return;
      }
      if (effort < 0.15 || phase < 0.04) side = wantSide;
      const power = phase < 0.5;
      const u = power ? phase / 0.5 : (phase - 0.5) / 0.5;
      const e = u * u * (3 - 2 * u);
      const bz = power ? -0.78 + 1.36 * e : 0.58 - 1.36 * e;
      const lift = power ? 0 : Math.sin(Math.PI * u);
      // stroke pose
      B.set(side * (0.74 + 0.22 * lift), -0.62 + 0.66 * lift, bz);
      T.set(-side * 0.1 + side * 0.12 * lift, 0.8 + 0.05 * Math.sin(phase * 6.283), -0.3 + bz * 0.34);
      // rest pose: paddle across the gunwales
      const r = 1 - effort;
      T.lerp(S.set(-side * 0.42, 0.36, -0.36), r);
      B.lerp(S.set(side * 1.1, 0.4, -0.42), r);
      D.subVectors(B, T).normalize();
      aim(paddle, T, B, false);
      torso.rotation.set(0.1 + 0.12 * effort * (power ? 1 - e : e), side * (0.5 - (power ? e : 1 - e)) * 0.3 * effort, 0);
      H.copy(T).addScaledVector(D, 0.04);
      aim(arms[side > 0 ? 1 : 0], S.set(-side * 0.27, baseY + 0.54, -0.03), H, true);
      H.copy(T).addScaledVector(D, 0.74);
      aim(arms[side > 0 ? 0 : 1], S.set(side * 0.27, baseY + 0.54, -0.03), H, true);
    },
    bladeTip(out) { return out.copy(B); },
    get side() { return side; },
  };
  api.setStanding(false);
  return api;
}

// ---------------------------------------------------------------- assembly
export const ATTACHMENTS = ['outriggers', 'mast-sail', 'rudder', 'cargo-rack', 'rain-catcher', 'stove', 'workbench', 'tent', 'antenna', 'fishing-rig', 'winch', 'smoker', 'planters', 'lantern-mast', 'flags'];

export function createCanoe() {
  const root = new THREE.Group(); // position + heading
  const tilt = new THREE.Group(); // bob, pitch, roll
  root.add(tilt);
  root.name = 'canoe';
  tilt.add(buildHull());
  const starter = buildStarterKit();
  tilt.add(starter);

  const anim = [];
  const upgrades = new THREE.Group();
  upgrades.name = 'upgrades';
  upgrades.add(outriggers(), mastAndSail(anim), rudder(anim), cargoRack(), rainCatcher(), stove(anim), workbench(), tent(), antenna(anim),
    fishing(anim), winch(), smoker(anim), planters(), lanternMast(anim), flags(anim), hullCargo());
  upgrades.traverse((o) => { if (o.isMesh && o.material !== glowMat) o.castShadow = true; });
  upgrades.visible = false;
  tilt.add(upgrades);

  const paddler = buildPaddler();
  paddler.group.position.copy(SEAT);
  tilt.add(paddler.group);

  let mode = 'starter';
  return {
    root, tilt, paddler, upgrades,
    seat: SEAT,
    lantern: LANTERN,
    get mode() { return mode; },
    setMode(m) { mode = m; upgrades.visible = m === 'upgraded'; starter.visible = m !== 'upgraded'; },
    // st: { turn } ; runs every moving part
    update(t, dt, st) { if (mode === 'upgraded') for (const f of anim) f(t, dt, st); },
    // water needs to know where hulls sit: [x offset, half length, half width, cut hole?]
    floats: [[-2.5, 2.45, 0.34], [2.5, 2.5, 0.31]],
  };
}
