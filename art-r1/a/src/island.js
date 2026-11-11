// The knoll, everything on it, and the drowned landmarks beyond.
import * as THREE from 'three';
import { PAL, flatMat, glowMat } from './palette.js';
import { Kit, rng } from './kit.js';

export const ISLE = { x: 4, z: -66 };
const COVE_A = Math.atan2(1, -0.08); // the landing beach faces the start
const SKERRIES = [{ x: -22, z: -45, r: 3.6, h: 1.7 }, { x: 30, z: -79, r: 2.8, h: 1.2 }, { x: -25, z: -86, r: 4.2, h: 2.3 }];
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const hash = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
function noise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return (hash(ix, iz) * (1 - u) + hash(ix + 1, iz) * u) * (1 - v) + (hash(ix, iz + 1) * (1 - u) + hash(ix + 1, iz + 1) * u) * v;
}
const outline = (a) => 19 + 3.2 * Math.sin(a * 2 + 0.9) + 2.0 * Math.sin(a * 3 + 2.2) + 1.1 * Math.sin(a * 5 + 0.4);
function coveAt(a) { let da = Math.abs(a - COVE_A); if (da > Math.PI) da = 2 * Math.PI - da; return 1 - smooth(0.34, 0.8, da); }

export function groundHeight(x, z) {
  const dx = x - ISLE.x, dz = z - ISLE.z;
  const a = Math.atan2(dz, dx), r = Math.hypot(dx, dz);
  const t = 1 - r / outline(a), cove = coveAt(a);
  let h;
  if (t > 0) {
    const cliff = 7.4 * Math.pow(t, 0.6);
    const beach = 5.6 * Math.pow(t, 1.7) + 0.9 * t;
    h = cliff * (1 - cove) + beach * cove;
    h += (noise(x * 0.22 + 3, z * 0.22) - 0.5) * 2.2 * Math.min(t * 4, 1) * (1 - cove * 0.75);
    const ledge = Math.round(h / 1.5) * 1.5; // granite steps
    h += (ledge - h) * 0.62 * (1 - cove) * smooth(0.5, 1.6, h);
  } else {
    h = t * (8.5 - 2.6 * cove);
  }
  for (const s of SKERRIES) h = Math.max(h, s.h * (1 - Math.hypot(x - s.x, z - s.z) / s.r));
  return h;
}
// Point at island angle a, `off` metres outside (+) or inside (-) the shoreline.
function shore(a, off) { const r = outline(a) + off; return new THREE.Vector3(ISLE.x + Math.cos(a) * r, 0, ISLE.z + Math.sin(a) * r); }
const onGround = (v) => { v.y = groundHeight(v.x, v.z); return v; };

// ---- where things are (main.js + the HUD read these)
const coveDir = new THREE.Vector3(Math.cos(COVE_A), 0, Math.sin(COVE_A)); // points out to open water
export const SPOTS = {
  coveDir,
  landing: shore(COVE_A, 1.15), // canoe centre when beached
  landingYaw: Math.atan2(coveDir.x, coveDir.z), // bow up the beach (forward = -Z rotated by yaw)
  crate: onGround(shore(COVE_A - 0.24, -3.9)),
  stand: onGround(shore(COVE_A - 0.12, -3.0)),
  driftwood: onGround(shore(COVE_A + 0.27, -1.7)),
  bush: onGround(shore(COVE_A - 0.42, -5.6)),
  cabin: shore(COVE_A - 0.86, 5.5),
  steeple: new THREE.Vector3(128, 0, -224),
  pylons: [0, 1, 2, 3].map((i) => new THREE.Vector3(165 + 75 * i, 0, -262 - 55 * i)),
  silos: new THREE.Vector3(-78, 0, -292),
};
const CABIN_YAW = 0.5;
const SNAGS = [[-9, -42.5, 5.5], [-15.5, -47, 4], [24.5, -52, 6.5], [29, -60, 4.2], [-19, -74, 5], [12, -38, 3.4], [-34, -30, 6], [46, -24, 5], [58, -70, 6.5], [-52, -66, 5.2], [38, -100, 5]];

// ---- ground height baked for the water shader (depth bands + shoreline foam)
export const GROUND_RECT = new THREE.Vector4(ISLE.x - 60, ISLE.z - 60, 120, 120);
export function bakeGround() {
  const W = 256, data = new Uint16Array(W * W);
  const cc = Math.cos(CABIN_YAW), cs = Math.sin(CABIN_YAW), cab = SPOTS.cabin;
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    const x = GROUND_RECT.x + ((i + 0.5) / W) * GROUND_RECT.z, z = GROUND_RECT.y + ((j + 0.5) / W) * GROUND_RECT.w;
    let h = groundHeight(x, z);
    const dx = x - cab.x, dz = z - cab.z, lx = dx * cc - dz * cs, lz = dx * cs + dz * cc; // drowned cabin footprint
    h = Math.max(h, Math.min(1, (Math.min(3.3 - Math.abs(lx), 2.7 - Math.abs(lz))) * 1.6));
    for (const s of SNAGS) h = Math.max(h, 0.5 - Math.hypot(x - s[0], z - s[1]) * 0.9);
    data[j * W + i] = THREE.DataUtils.toHalfFloat(Math.max(Math.min(h, 12), -12));
  }
  const tex = new THREE.DataTexture(data, W, W, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function terrain() {
  const k = new Kit(101, 0.07);
  const C = 1.25, n = 60, half = (n * C) / 2, rand = rng(5);
  const P = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = ISLE.x - half + i * C + (rand() - 0.5) * C * 0.6, z = ISLE.z - half + j * C + (rand() - 0.5) * C * 0.6;
    P.push([x, groundHeight(x, z), z]);
  }
  const face = (a, b, c) => {
    if (a[1] < -0.9 && b[1] < -0.9 && c[1] < -0.9) return;
    const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3, cz = (a[2] + b[2] + c[2]) / 3;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1; ny = Math.abs(ny / nl);
    const cove = coveAt(Math.atan2(cz - ISLE.z, cx - ISLE.x));
    const n1 = noise(cx * 0.35 + 9, cz * 0.35), n2 = noise(cx * 0.9, cz * 0.9 + 4);
    let col;
    if (cy < 0.28) col = cove > 0.4 ? PAL.sandDark : PAL.wetRock;
    else if (cove > 0.4 && cy < 1.7 && ny > 0.78) col = n2 > 0.72 ? PAL.sandDark : PAL.sand;
    else if (ny < 0.74) col = n1 > 0.62 ? PAL.graniteDark : n1 < 0.3 ? PAL.graniteGrey : PAL.granite;
    else if (cy > 2.3 && ny > 0.84) col = n1 > 0.6 ? PAL.grassGold : n1 < 0.34 ? PAL.mossDark : PAL.moss;
    else col = n2 > 0.74 ? PAL.lichen : n1 > 0.5 ? PAL.graniteLight : PAL.granite;
    k.tri(a, c, b, col);
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = P[j * (n + 1) + i], b = P[j * (n + 1) + i + 1], c = P[(j + 1) * (n + 1) + i], d = P[(j + 1) * (n + 1) + i + 1];
    if ((i + j) & 1) { face(a, b, c); face(b, d, c); } else { face(a, b, d); face(a, d, c); }
  }
  return k.mesh(flatMat, 'terrain');
}

function spruce(k, x, y, z, H, r) {
  k.cyl(0.12, 0.2, H * 0.34, 5, PAL.trunk, x, y + H * 0.15, z);
  const tiers = 4 + (r() > 0.5 ? 1 : 0);
  for (let i = 0; i < tiers; i++) {
    const f = i / (tiers - 1);
    const rad = (1.75 - f * 1.25) * (0.85 + r() * 0.3) * (H / 7);
    const h = H * (0.34 - f * 0.08);
    k.cone(rad, h, 6, [PAL.spruce, PAL.spruceLight, PAL.spruceDark][i % 3], x + (r() - 0.5) * 0.25, y + H * (0.3 + f * 0.56), z + (r() - 0.5) * 0.25, (r() - 0.5) * 0.12, r() * 6, (r() - 0.5) * 0.12, true);
  }
}
// Wind-flagged pine: the Shield silhouette.
function flagPine(k, x, y, z, H, lean) {
  const tx = x + lean * H * 0.16;
  k.beam(x, y - 0.2, z, tx, y + H, z + 0.3, 0.42, PAL.trunk, 6, 0.16);
  const pads = [[0.52, 2.6], [0.68, 2.9], [0.82, 2.3], [0.95, 1.5]];
  pads.forEach(([f, w], i) => {
    const px = x + (tx - x) * f, py = y + H * f;
    k.beam(px, py - 0.3, z + 0.3 * f, px + lean * w * 0.5, py, z + 0.3 * f, 0.12, PAL.trunk, 5, 0.06);
    k.ico(1, 1, i & 1 ? PAL.spruce : PAL.spruceDark, px + lean * w * 0.62, py + 0.12, z + 0.3 * f + (i - 1.5) * 0.25, w * 0.78, 0.4, w * 0.5, true, i * 0.5);
    k.ico(1, 0, PAL.spruceLight, px + lean * w * 0.5, py + 0.4, z + 0.3 * f, w * 0.45, 0.24, w * 0.34, true, i);
  });
}
function birch(k, x, y, z, H, r) {
  const lx = (r() - 0.5) * 0.9, lz = (r() - 0.5) * 0.9;
  k.beam(x, y - 0.2, z, x + lx, y + H, z + lz, 0.26, PAL.birchBark, 5, 0.1);
  for (let i = 0; i < 4; i++) { const f = 0.14 + i * 0.17 + r() * 0.05; k.cyl(0.115 - f * 0.04, 0.12 - f * 0.04, 0.07, 5, PAL.birchMark, x + lx * f, y + H * f, z + lz * f); }
  for (let i = 0; i < 4; i++) {
    const f = 0.62 + i * 0.12, rad = 1.25 - i * 0.2;
    k.ico(rad, i < 2 ? 1 : 0, i & 1 ? PAL.birchLeafDeep : PAL.birchLeaf, x + lx * f + (r() - 0.5) * 1.3, y + H * f + (r() - 0.5) * 0.4, z + lz * f + (r() - 0.5) * 1.3, 1, 0.72, 1, true, r() * 3);
  }
}
function snag(k, x, z, H, r) {
  const lx = (r() - 0.5) * 0.7, lz = (r() - 0.5) * 0.7;
  k.beam(x, -1.2, z, x + lx, H, z + lz, 0.42, PAL.snag, 5, 0.12);
  for (let i = 0; i < 3; i++) {
    const f = 0.45 + i * 0.17, a = r() * 6.28, len = 0.8 + r() * 0.9;
    k.beam(x + lx * f, H * f, z + lz * f, x + lx * f + Math.cos(a) * len, H * f + 0.5 + r() * 0.4, z + lz * f + Math.sin(a) * len, 0.11, PAL.snag, 4, 0.04);
  }
}

function flora() {
  const k = new Kit(102, 0.08), r = rng(77);
  const placed = [];
  const clear = (x, z, d) => placed.every((p) => Math.hypot(p[0] - x, p[1] - z) > d) && [SPOTS.crate, SPOTS.bush, SPOTS.stand, SPOTS.driftwood].every((p) => Math.hypot(p.x - x, p.z - z) > 3.2);
  const hero = onGround(new THREE.Vector3(ISLE.x + 2.5, 0, ISLE.z - 1));
  flagPine(k, hero.x, hero.y, hero.z, 10.5, 1); placed.push([hero.x, hero.z]);
  const hero2 = onGround(new THREE.Vector3(ISLE.x - 8.5, 0, ISLE.z + 3.5));
  flagPine(k, hero2.x, hero2.y, hero2.z, 8, 1); placed.push([hero2.x, hero2.z]);
  let tries = 0, spr = 0, bir = 0;
  while (tries++ < 900 && (spr < 15 || bir < 7)) {
    const x = ISLE.x + (r() - 0.5) * 40, z = ISLE.z + (r() - 0.5) * 40, y = groundHeight(x, z);
    const slope = Math.abs(groundHeight(x + 0.8, z) - y) + Math.abs(groundHeight(x, z + 0.8) - y);
    if (slope > 1.1) continue;
    const cove = coveAt(Math.atan2(z - ISLE.z, x - ISLE.x));
    if (bir < 7 && y > 1.0 && y < 4.6 && clear(x, z, 3.0) && (cove > 0.2 || r() < 0.3)) { birch(k, x, y, z, 5 + r() * 1.8, r); placed.push([x, z]); bir++; }
    else if (spr < 15 && y > 2.2 && cove < 0.75 && clear(x, z, 2.6)) { spruce(k, x, y, z, 5.5 + r() * 3.2, r); placed.push([x, z]); spr++; }
  }
  // boulders along the waterline, low scrub on top
  for (let i = 0; i < 26; i++) {
    const a = r() * 6.283, p = shore(a, -0.6 + r() * 2.4), s = 0.45 + r() * 0.9;
    if (coveAt(a) > 0.5 && r() < 0.75) continue;
    k.ico(s, 0, [PAL.granite, PAL.graniteDark, PAL.graniteGrey, PAL.graniteLight][i % 4], p.x, groundHeight(p.x, p.z) + s * 0.25, p.z, 1.2, 0.7, 1, true, r() * 6);
  }
  for (let i = 0; i < 14; i++) {
    const x = ISLE.x + (r() - 0.5) * 30, z = ISLE.z + (r() - 0.5) * 30, y = groundHeight(x, z);
    if (y < 1.6 || !clear(x, z, 1.6)) continue;
    k.ico(0.5 + r() * 0.35, 0, i % 3 ? PAL.mossDark : PAL.grassGold, x, y + 0.2, z, 1.25, 0.6, 1.1, true, r() * 6);
  }
  for (const s of SNAGS) snag(k, s[0], s[1], s[2], r);
  return k.mesh(flatMat, 'flora');
}

// --- lootables: saturated, chunky, each under a bobbing blaze diamond
function driftwood(k, p) {
  const r = rng(31);
  for (let i = 0; i < 9; i++) {
    const a = (r() - 0.5) * 1.5 + (i % 2 ? 1.3 : 0), len = 1.5 + r() * 1.5, lay = Math.floor(i / 4);
    const x = p.x + (r() - 0.5) * 1.5, z = p.z + (r() - 0.5) * 1.1, y = p.y + 0.14 + lay * 0.22;
    const dx = Math.cos(a) * len * 0.5, dz = Math.sin(a) * len * 0.5, t = (r() - 0.5) * 0.25;
    k.beam(x - dx, y - t, z - dz, x + dx, y + t + lay * 0.1, z + dz, 0.26 + r() * 0.1, i % 3 ? PAL.driftwood : PAL.driftwoodDark, 5, 0.16);
  }
  k.beam(p.x - 0.3, p.y + 0.2, p.z + 0.2, p.x + 0.5, p.y + 1.25, p.z - 0.3, 0.2, PAL.driftwood, 5, 0.07); // one upright fork
  k.beam(p.x + 0.2, p.y + 0.85, p.z - 0.1, p.x - 0.25, p.y + 1.2, p.z + 0.1, 0.1, PAL.driftwood, 4, 0.04);
}
function crate(k, p) {
  const s = 1.0, y = p.y + s / 2 - 0.04;
  k.push(new THREE.Matrix4().makeRotationY(0.5).setPosition(p.x, y, p.z));
  k.box(s, s, s, 0xe9c184, 0, 0, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.1, s + 0.04, 0.1, PAL.wood, sx * (s / 2 - 0.03), 0, sz * (s / 2 - 0.03));
  for (const sy of [-1, 1]) for (const d of [0, 1]) for (const sd of [-1, 1]) {
    k.box(d ? 0.08 : s + 0.04, 0.09, d ? s + 0.04 : 0.08, PAL.wood, d ? sd * (s / 2 - 0.02) : 0, sy * (s / 2 - 0.03), d ? 0 : sd * (s / 2 - 0.02));
  }
  k.box(s + 0.08, 0.07, s + 0.08, PAL.cream, 0.05, s / 2 + 0.03, 0.03, 0, 0.14, 0.05); // lid knocked ajar
  // stencilled blaze diamond on two faces
  const q = 0.27, o = s / 2 + 0.006;
  k.quad([0, q, o], [-q, 0, o], [0, -q, o], [q, 0, o], PAL.blaze);
  k.quad([-o, q, 0], [-o, 0, -q], [-o, -q, 0], [-o, 0, q], PAL.blaze);
  k.beam(-s / 2, s / 2 + 0.08, 0.1, -s / 2 - 0.3, -s / 2 + 0.05, 0.3, 0.035, PAL.rope);
  k.pop();
}
function berryBush(k, p) {
  const r = rng(53);
  const blobs = [[0, 0.5, 0, 0.75], [0.6, 0.38, 0.2, 0.55], [-0.55, 0.4, -0.1, 0.6], [0.1, 0.42, -0.55, 0.5], [0, 0.85, 0.1, 0.45]];
  blobs.forEach(([x, y, z, s], i) => k.ico(s, 1, i & 1 ? PAL.moss : PAL.mossDark, p.x + x, p.y + y, p.z + z, 1, 0.82, 1, true, i));
  for (let i = 0; i < 22; i++) {
    const b = blobs[i % blobs.length], a = r() * 6.283, e = 0.15 + r() * 1.1;
    const rr = b[3] * 0.98;
    k.ico(0.1, 0, i % 4 ? PAL.berry : PAL.berryLight, p.x + b[0] + Math.cos(a) * Math.sin(e) * rr, p.y + b[1] + Math.cos(e) * rr * 0.82, p.z + b[2] + Math.sin(a) * Math.sin(e) * rr, 1, 1, 1, false);
  }
}
function cabinRoof() {
  const k = new Kit(104, 0.07), r = rng(9);
  const L = 3.2, W = 2.6, eave = 0.5, ridge = 2.75;
  // log walls just breaking the surface
  for (const sz of [-1, 1]) for (let i = 0; i < 2; i++) k.cyl(0.2, 0.2, L * 2 + 0.5, 6, i ? PAL.woodDark : PAL.trunk, 0, 0.08 + i * 0.36, sz * (W - 0.15), 0, 0, Math.PI / 2);
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 2; i++) k.cyl(0.2, 0.2, W * 2 + 0.4, 6, i ? PAL.trunk : PAL.woodDark, sx * (L - 0.15), -0.1 + i * 0.36, 0, Math.PI / 2);
    k.tri([sx * L, eave, -W], [sx * L, eave, W], [sx * L, ridge, 0], PAL.woodGrey, true); // gable
    k.box(0.06, 0.5, 0.5, PAL.pineDark, sx * (L + 0.02), eave + 0.75, 0);
    k.box(0.08, 0.08, 0.62, PAL.cream, sx * (L + 0.03), eave + 1.02, 0);
    k.box(0.08, 0.08, 0.62, PAL.cream, sx * (L + 0.03), eave + 0.48, 0);
  }
  // shingle courses, weathered, a few gone
  const rows = 5, cols = 7, slope = Math.atan2(ridge - eave, W), run = Math.hypot(ridge - eave, W) + 0.35;
  const tones = [PAL.woodGrey, PAL.driftwoodDark, PAL.woodDark, PAL.woodGrey, PAL.mossDark, PAL.wood];
  for (const sz of [-1, 1]) for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    if (r() < 0.07 && j > 0) continue;
    const f = (j + 0.5) / rows, d = -0.35 + f * run;
    const x = -L - 0.2 + ((i + 0.5) / cols) * (L * 2 + 0.4);
    const y = eave + Math.sin(slope) * d + 0.07 + j * 0.012, z = sz * (W - Math.cos(slope) * d);
    k.box((L * 2 + 0.4) / cols - 0.03, 0.09, run / rows + 0.1, tones[Math.floor(r() * tones.length)], x, y, z, sz * slope, 0, 0);
  }
  k.box(L * 2 + 0.6, 0.12, 0.3, PAL.woodDark, 0, ridge + 0.1, 0);
  // fieldstone chimney, tin stovepipe
  for (let i = 0; i < 5; i++) k.box(0.9 - i * 0.04, 0.5, 0.8 - i * 0.04, i & 1 ? PAL.graniteGrey : PAL.graniteDark, L - 1.0, 1.3 + i * 0.5, 0.9, 0, (r() - 0.5) * 0.15, 0);
  k.box(1.0, 0.12, 0.9, PAL.graniteLight, L - 1.0, 3.72, 0.9);
  k.cyl(0.11, 0.11, 0.9, 6, PAL.tin, -L + 1.3, ridge - 0.1, -0.9); k.cone(0.2, 0.14, 6, PAL.iron, -L + 1.3, ridge + 0.42, -0.9);
  const m = k.mesh(flatMat, 'cabin-roof');
  m.position.copy(SPOTS.cabin).setY(-0.42);
  m.rotation.set(0.05, CABIN_YAW, -0.09, 'YXZ');
  return m;
}

function blaze() {
  const g = new THREE.OctahedronGeometry(0.24, 0);
  g.scale(1, 1.45, 1);
  const k = new Kit(1, 0);
  const ng = g.index ? g.toNonIndexed() : g, pos = ng.attributes.position;
  for (let i = 0; i < pos.count; i += 3) {
    const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3, x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const c = y > 0 ? (x > 0 ? 0xffd45a : PAL.blaze) : (x > 0 ? PAL.blaze : PAL.blazeDark);
    k.tri([pos.getX(i), pos.getY(i), pos.getZ(i)], [pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1)], [pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2)], c);
  }
  return k.geometry();
}

// ---- drowned landmarks
function steeple() {
  const k = new Kit(105, 0.05);
  const white = 0xf3ead8, slate = 0x4a4660;
  k.box(6.2, 8.4, 6.2, white, 0, 3.6, 0);
  k.box(6.6, 0.5, 6.6, PAL.creamDark, 0, 7.9, 0);
  for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2; k.box(2.2, 3.2, 0.3, slate, Math.sin(a) * 3.05, 4.6, Math.cos(a) * 3.05, 0, a, 0); }
  k.cone(4.5, 14, 4, slate, 0, 15.1, 0, 0, Math.PI / 4, 0, true);
  k.box(0.3, 2.6, 0.3, white, 0, 23, 0); k.box(1.5, 0.3, 0.3, white, 0, 23.4, 0);
  // the nave roof: only the top of its pitch clears the water
  const L = 17, R = 4.6, E = 5.2;
  k.quad([-3.1, -1.2, E], [-3.1, R, 0], [-3.1 - L, R, 0], [-3.1 - L, -1.2, E], 0x6a6686, true);
  k.quad([-3.1, -1.2, -E], [-3.1 - L, -1.2, -E], [-3.1 - L, R, 0], [-3.1, R, 0], slate, true);
  k.tri([-3.1 - L, -1.2, E], [-3.1 - L, R, 0], [-3.1 - L, -1.2, -E], white, true);
  k.box(L + 0.6, 0.35, 0.5, PAL.creamDark, -3.1 - L / 2, R + 0.1, 0);
  const m = k.mesh(flatMat, 'steeple');
  m.position.copy(SPOTS.steeple).setY(-0.6);
  m.rotation.set(0, 0.5, 0.045);
  m.scale.setScalar(1.25);
  return m;
}
function pylons() {
  const k = new Kit(106, 0.04), col = 0x3a5560;
  const P = SPOTS.pylons, dir = new THREE.Vector3().subVectors(P[1], P[0]).normalize(), yaw = Math.atan2(dir.x, dir.z);
  const armPts = [];
  P.forEach((p, n) => {
    k.push(new THREE.Matrix4().makeRotationY(yaw).setPosition(p.x, n === 2 ? -1.5 : 0, p.z).multiply(new THREE.Matrix4().makeRotationZ(n === 2 ? 0.06 : 0)));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      k.beam(sx * 4, -2, sz * 4, sx * 1.3, 19, sz * 1.3, 0.55, col);
      k.beam(sx * 1.3, 19, sz * 1.3, sx * 0.5, 30, sz * 0.5, 0.45, col);
    }
    for (const sz of [-1, 1]) { k.beam(-3.4, 3, sz * 3.4, 2.1, 12, sz * 2.1, 0.3, col); k.beam(3.4, 3, sz * 3.4, -2.1, 12, sz * 2.1, 0.3, col); }
    for (const sx of [-1, 1]) { k.beam(sx * 3.4, 3, -3.4, sx * 2.1, 12, 2.1, 0.3, col); k.beam(sx * 2.1, 12, -2.1, sx * 1.4, 19, 1.4, 0.3, col); }
    for (const [y, w] of [[20, 9.5], [25.5, 6.5]]) {
      k.beam(-w, y, 0, w, y, 0, 0.55, col);
      k.beam(-w, y, 0, 0, y + 2.6, 0, 0.3, col); k.beam(w, y, 0, 0, y + 2.6, 0, 0.3, col);
      for (const sx of [-1, 1]) k.box(0.3, 1.4, 0.3, PAL.cream, sx * (w - 0.3), y - 0.8, 0);
    }
    k.pop();
    const rx = Math.cos(yaw), rz = -Math.sin(yaw), yo = n === 2 ? -1.5 : 0;
    armPts.push([[p.x - rx * 9.2, 18.5 + yo, p.z - rz * 9.2], [p.x + rx * 9.2, 18.5 + yo, p.z + rz * 9.2], [p.x, 30 + yo, p.z]]);
  });
  for (let n = 0; n < armPts.length - 1; n++) for (let w = 0; w < 3; w++) {
    const a = armPts[n][w], b = armPts[n + 1][w], S = 7;
    for (let i = 0; i < S; i++) {
      const f0 = i / S, f1 = (i + 1) / S, sag = (f) => 5.5 * Math.sin(Math.PI * f);
      k.beam(a[0] + (b[0] - a[0]) * f0, a[1] + (b[1] - a[1]) * f0 - sag(f0), a[2] + (b[2] - a[2]) * f0, a[0] + (b[0] - a[0]) * f1, a[1] + (b[1] - a[1]) * f1 - sag(f1), a[2] + (b[2] - a[2]) * f1, 0.22, 0x2f4650);
    }
  }
  return k.mesh(flatMat, 'pylons', false);
}
function silos() {
  const k = new Kit(107, 0.05);
  k.cyl(5, 5, 18, 10, 0xd9cdb8, 0, 8, 0); k.cone(5.3, 3.2, 10, PAL.tin, 0, 18.6, 0);
  k.cyl(4.2, 4.2, 13, 10, 0xc8b79c, 10.5, 5.5, 2); k.cone(4.5, 2.8, 10, PAL.rust, 10.5, 13.4, 2);
  for (const y of [4, 9, 14]) k.cyl(5.08, 5.08, 0.5, 10, PAL.rust, 0, y, 0);
  k.beam(0, 19.5, 0, 10.5, 14, 2, 0.8, PAL.iron);
  const m = k.mesh(flatMat, 'silos', false);
  m.position.copy(SPOTS.silos).setY(-1);
  m.rotation.z = -0.03;
  return m;
}

export function createIsland(scene) {
  const g = new THREE.Group();
  g.name = 'island';
  g.add(terrain(), flora(), cabinRoof());
  const loot = new Kit(103, 0.06);
  driftwood(loot, SPOTS.driftwood);
  crate(loot, SPOTS.crate);
  berryBush(loot, SPOTS.bush);
  g.add(loot.mesh(flatMat, 'loot'));
  const blazeGeo = blaze();
  const blazes = [[SPOTS.driftwood, 2.1], [SPOTS.crate, 1.75], [SPOTS.bush, 2.0]].map(([p, h], i) => {
    const m = new THREE.Mesh(blazeGeo, glowMat);
    m.position.set(p.x, p.y + h, p.z);
    m.userData = { y: p.y + h, i };
    g.add(m);
    return m;
  });
  g.add(steeple(), pylons(), silos());
  scene.add(g);
  const rings = [
    new THREE.Vector3(SPOTS.steeple.x, SPOTS.steeple.z, 5.2),
    ...SPOTS.pylons.map((p) => new THREE.Vector3(p.x, p.z, 5.4)),
    new THREE.Vector3(SPOTS.silos.x, SPOTS.silos.z, 5.1),
    new THREE.Vector3(SPOTS.silos.x + 10.5, SPOTS.silos.z + 2, 4.3),
  ];
  return {
    group: g,
    rings,
    // blazes hold their size on screen so loot reads from across the water
    update(t, camera) {
      for (const b of blazes) {
        const k = Math.min(Math.max(b.position.distanceTo(camera.position) / 16, 1), 3.4);
        b.scale.setScalar(k);
        b.position.y = b.userData.y + (k - 1) * 0.35 + Math.sin(t * 2.2 + b.userData.i * 1.7) * 0.12 * k;
        b.rotation.y = t * 1.4 + b.userData.i;
      }
    },
  };
}
