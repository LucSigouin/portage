// Ink & Wash — the island and everything standing in the flood:
// granite knoll, pines, birch, drowned cabin roof, driftwood, crate, berry bush, snags,
// and the far landmarks (church steeple, hydro pylons).
import * as THREE from 'three';
import { Builder, rng, THIN } from './geo.js';
import { PAL, terrainMaterial } from './palette.js';
import { KIND } from './detail.js';

export const ISLAND = { x: -5, z: 82 };
const SX = 78;
const SZ = 66;
const BEACH = { x: 3, z: -12.4 }; // island-local

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let fx = x - xi;
  let fy = y - yi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm(x, y) {
  return (vnoise(x, y) * 0.5 + vnoise(x * 2.03 + 17.3, y * 2.03 + 17.3) * 0.25 + vnoise(x * 4.1 + 31, y * 4.1 + 31) * 0.125) / 0.875;
}
const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const smax = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
};

function beachFactor(dx, dz) {
  return sstep(8.5, 4, Math.hypot(dx - BEACH.x, dz - BEACH.z));
}

// Height of the knoll in island-local metres. Glacier-rounded domes cut into granite ledges.
function heightLocal(dx, dz) {
  const dome = (ox, oz, rx, rz, H) => {
    const u = (dx - ox) / rx;
    const v = (dz - oz) / rz;
    return H * (1 - (u * u + v * v));
  };
  let h = smax(dome(0, 0, 17, 12, 5.6), dome(12, 2.5, 9, 8, 3.6), 1.5);
  h = smax(h, dome(-11, -2.5, 8, 6.5, 2.9), 1.2);
  h += (fbm(dx * 0.15 + 4, dz * 0.15) - 0.5) * 2.2 + (fbm(dx * 0.5 + 9, dz * 0.5) - 0.5) * 0.5;
  const raw = h;
  if (h > 0.2) {
    const step = 1.25;
    const hs = Math.max(0, (h - 0.2) / step + (vnoise(dx * 0.2, dz * 0.2) - 0.5) * 0.5);
    const f = hs - Math.floor(hs);
    const e = f < 0.6 ? f * 0.3 : 0.18 + sstep(0.6, 1, f) * 0.82;
    const terr = 0.2 + (Math.floor(hs) + e) * step;
    h += (terr - h) * 0.85;
  }
  const bf = beachFactor(dx, dz);
  const beach = raw > 0 ? raw * 0.2 : raw * 0.45;
  h += (beach - h) * bf;
  return Math.max(-3, h);
}

export function islandHeight(x, z) {
  return heightLocal(x - ISLAND.x, z - ISLAND.z);
}

// first dry point walking in from open water (toward +z) at local dx
function shoreZ(dx) {
  for (let dz = -26; dz < 0; dz += 0.05) if (heightLocal(dx, dz) > 0.02) return dz;
  return 0;
}

function boughGeo(r, h, n, rand, lx = 0, lz = 0) {
  const pos = [0, h, 0];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rand() * 0.3;
    const rr = r * 0.5 * (0.85 + rand() * 0.3);
    pos.push(Math.cos(a) * rr + lx * 0.4, h * 0.42, Math.sin(a) * rr + lz * 0.4);
  }
  for (let k = 0; k < n; k++) {
    const a = ((k + 0.5) / n) * Math.PI * 2 + rand() * 0.3;
    const rr = r * (k % 2 ? 1.18 : 0.66) * (0.86 + rand() * 0.3);
    pos.push(Math.cos(a) * rr + lx, (k % 2 ? -0.2 : 0.12) * h + (rand() - 0.5) * h * 0.18, Math.sin(a) * rr + lz);
  }
  const idx = [];
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    idx.push(0, 1 + k, 1 + k1);
    idx.push(1 + k, 1 + n + k, 1 + k1);
    idx.push(1 + k1, 1 + n + k, 1 + n + k1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const WIND = -1; // boughs, flags and smoke lean toward -x

function spruce(b, x, y, z, H, rand) {
  b.cyl(0.03, 0.1 + H * 0.007, H, PAL.bark, { pos: [x, y + H / 2, z], kind: KIND.BARK }, 6);
  const k = Math.round(6 + H * 0.35);
  const y0 = H * 0.2;
  const R = 0.85 + H * 0.085;
  const lean = (rand() - 0.5) * 0.5;
  for (let i = 0; i < k; i++) {
    const f = i / (k - 1);
    const r = R * Math.pow(1 - f, 0.8) + 0.16;
    const hh = ((H - y0) / k) * 2.0;
    const yy = y + y0 + f * (H - y0) * 0.98 - hh * 0.35;
    const colr = [PAL.pine, PAL.pineDark, PAL.pine, '#567264'][i % 4];
    b.add(boughGeo(r, hh, 12 + (i % 2), rand, WIND * 0.14 * r, 0), colr, { pos: [x + lean * f, yy, z], rot: [0, rand() * 6.28, 0], kind: KIND.NEEDLE });
  }
}

function whitePine(b, x, y, z, H, rand) {
  const lx = WIND * (0.7 + rand() * 0.5);
  const pt = (f) => [x + lx * f * f, y - 0.4 + (H + 0.4) * f, z + Math.sin(f * 3) * 0.15];
  let prev = pt(0);
  for (let i = 1; i <= 6; i++) {
    const p = pt(i / 6);
    b.beam(prev, p, 0.16 - (i - 1) * 0.022, PAL.bark, { r2: 0.16 - i * 0.022, id: 0.07, kind: KIND.BARK }, 7);
    prev = p;
  }
  // dead stubs low on the trunk
  for (let i = 0; i < 3; i++) {
    const p = pt(0.2 + i * 0.09);
    const s = i % 2 ? 1 : -1;
    b.beam(p, [p[0] + s * (0.5 + rand() * 0.5), p[1] + 0.25, p[2] + (rand() - 0.5) * 0.6], 0.035, PAL.bark, { r2: 0.012, id: 0.07, kind: KIND.BARK }, 5);
  }
  const tone = [PAL.pineDark, PAL.pine, '#567264', PAL.pine];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const f = 0.42 + (i / n) * 0.56;
    const p = pt(f);
    const taper = 1 - (i / n) * 0.62;
    const s = i % 2 ? 1 : -1; // alternate sides, but the wind wins
    const reach = (1.1 + rand() * 0.8) * taper;
    const cx = p[0] + s * reach * 0.55 + WIND * (0.35 + rand() * 0.5) * taper;
    const cz = p[2] + (rand() - 0.5) * 1.2 * taper;
    const r = (1.25 + rand() * 0.6) * taper + 0.25;
    b.beam(p, [cx, p[1] + 0.12, cz], 0.04, PAL.bark, { r2: 0.015, id: 0.07, kind: KIND.BARK }, 5);
    b.add(boughGeo(r, 0.62, 9, rand, WIND * 0.3 * r, 0), tone[i % 4], { pos: [cx, p[1] - 0.12, cz], rot: [(rand() - 0.5) * 0.25, rand() * 6.28, (rand() - 0.5) * 0.25], scale: [1.25, 0.8, 0.9], kind: KIND.NEEDLE });
  }
  const top = pt(1);
  b.add(boughGeo(0.75, 1.1, 8, rand, WIND * 0.25, 0), PAL.pine, { pos: [top[0], top[1] - 0.45, top[2]], kind: KIND.NEEDLE });
}

function birch(b, x, y, z, H, rand) {
  const lx = (rand() - 0.5) * 1.4;
  const lz = (rand() - 0.5) * 0.9;
  const pt = (f) => [x + lx * f * f, y - 0.3 + (H + 0.3) * f, z + lz * f];
  const pts = [pt(0), pt(0.35), pt(0.7), pt(1)];
  const tid = b.tube(pts, 0.085, PAL.birch, { steps: 10, flat: true, kind: KIND.BIRCH }, 6);
  for (let i = 0; i < 6; i++) {
    const p = pt(0.07 + i * 0.12 + rand() * 0.04);
    b.cyl(0.091, 0.091, 0.035 + rand() * 0.03, '#4c4741', { pos: p, id: tid, flat: true, kind: KIND.PLAIN }, 6);
  }
  const leaf = [PAL.ochre, PAL.ochreLight, '#c9ac45', PAL.ochre, '#dcb95a', PAL.ochreLight, '#bfa94c'];
  for (let i = 0; i < 7; i++) {
    const f = 0.62 + (i / 7) * 0.42;
    const p = pt(f);
    const a = rand() * 6.28;
    const rr = 0.35 + rand() * 0.75;
    const r = 0.62 + rand() * 0.5;
    b.sphere(r, leaf[i], { pos: [p[0] + Math.cos(a) * rr, p[1] + (rand() - 0.3) * 0.5, p[2] + Math.sin(a) * rr], scale: [1.25, 0.8, 1.1], rot: [0, rand() * 3, 0], kind: KIND.LEAF }, 9);
  }
  // a couple of bare twigs
  const m = pt(0.6);
  b.beam(m, [m[0] + 0.7, m[1] + 0.8, m[2] + 0.2], 0.03, PAL.birch, { r2: 0.012, id: tid, kind: KIND.BIRCH }, 5);
  b.beam(m, [m[0] - 0.6, m[1] + 0.9, m[2] - 0.3], 0.03, PAL.birch, { r2: 0.012, id: tid, kind: KIND.BIRCH }, 5);
}

function snag(b, x, z, H, rand) {
  const tx = (rand() - 0.5) * 0.9;
  const tz = (rand() - 0.5) * 0.7;
  const id = b.beam([x, -1.5, z], [x + tx, H, z + tz], 0.17, '#aba69c', { r2: 0.05, kind: KIND.DRIFT }, 7);
  for (let i = 0; i < 3; i++) {
    const f = 0.45 + rand() * 0.45;
    const p = [x + tx * f, -1.5 + (H + 1.5) * f, z + tz * f];
    const a = rand() * 6.28;
    const l = 0.5 + rand() * 0.9;
    b.beam(p, [p[0] + Math.cos(a) * l, p[1] + l * 0.55, p[2] + Math.sin(a) * l], 0.045, '#aba69c', { r2: 0.015, id, kind: KIND.DRIFT }, 5);
  }
}

function buildTerrain() {
  const nx = 170;
  const nz = 144;
  const count = (nx + 1) * (nz + 1);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const info = new Float32Array(count * 2);
  let k = 0;
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const dx = (i / nx - 0.5) * SX;
      const dz = (j / nz - 0.5) * SZ;
      pos[k * 3] = ISLAND.x + dx;
      pos[k * 3 + 1] = heightLocal(dx, dz);
      pos[k * 3 + 2] = ISLAND.z + dz;
      col[k * 3] = beachFactor(dx, dz);
      k++;
    }
  }
  const idx = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      // skip cells that are entirely deep underwater
      if (pos[a * 3 + 1] < -2.5 && pos[b * 3 + 1] < -2.5 && pos[c * 3 + 1] < -2.5 && pos[d * 3 + 1] < -2.5) continue;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aInfo', new THREE.BufferAttribute(info, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, terrainMaterial);
  mesh.renderOrder = 3; // after the trees and props that stand on it, so the costly ground is not painted under them
  return mesh;
}

function buildCabin(wx, wz) {
  const b = new Builder(41);
  b.base = new THREE.Matrix4().compose(
    new THREE.Vector3(wx, -0.62, wz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, 0.75, 0.1, 'YXZ')),
    new THREE.Vector3(1, 1, 1)
  );
  const ang = Math.atan2(2.3, 2.5);
  const slope = Math.hypot(2.5, 2.3);
  const shingle = ['#8f7d6b', '#9c8974', '#7f6f62', '#94806c', '#857362'];
  for (const sd of [-1, 1]) {
    // dark underlay so missing shingles read as holes
    b.box(slope, 0.05, 5.3, '#4a413a', { pos: [sd * 1.25 + sd * 0.05, 1.05 - 0.07, 0], rot: [0, 0, -sd * ang], flat: true });
    for (let c = 0; c < 6; c++) {
      const s0 = c / 6;
      const s1 = (c + 1) / 6 + 0.035;
      const sm = (s0 + s1) / 2;
      const w = (s1 - s0) * slope;
      const x = sd * 2.5 * (1 - sm);
      const y = -0.1 + 2.3 * sm + 0.03 + (c % 2) * 0.012;
      const split = (c + (sd > 0 ? 1 : 0)) % 3 === 1;
      if (!split) {
        b.box(w, 0.06, 5.5 + (c % 2) * 0.12, shingle[(c + (sd > 0 ? 2 : 0)) % 5], { pos: [x, y, 0], rot: [0, 0, -sd * ang], kind: KIND.SHINGLE });
      } else {
        const cuts = [-2.75, -1.3, -0.2, 1.1, 2.75];
        for (let q = 0; q < 4; q++) {
          if (q === (sd > 0 ? 1 : 2) && c > 1) continue; // missing shingle
          const z0 = cuts[q] + 0.02;
          const z1 = cuts[q + 1] - 0.02;
          b.box(w, 0.06, z1 - z0, shingle[(c + q) % 5], { pos: [x, y, (z0 + z1) / 2], rot: [0, (q % 2 ? 0.02 : -0.015), -sd * ang], kind: KIND.SHINGLE, axis: 2 });
        }
      }
    }
    // moss creeping over the shakes
    b.box(0.7, 0.05, 1.1, PAL.moss, { pos: [sd * 0.75, 1.62, sd * 1.4], rot: [0, 0.2, -sd * ang] });
    b.box(0.5, 0.05, 0.7, PAL.mossDeep, { pos: [sd * 1.5, 0.95, -sd * 1.9], rot: [0, -0.3, -sd * ang] });
  }
  b.box(0.34, 0.09, 5.7, PAL.rustDark, { pos: [0, 2.26, 0] });
  // gable ends: stacked boards with a small attic window
  for (const ez of [-2.62, 2.62]) {
    const tones = ['#8a6f55', '#7c644d', '#927659'];
    let q = 0;
    for (let y = -0.35; y < 2.0; y += 0.27) {
      const hw = 2.3 * (1 - (y + 0.22) / 2.3);
      if (hw < 0.12) break;
      b.box(hw * 2, 0.25, 0.14, tones[q++ % 3], { pos: [0, y + 0.125, ez] });
    }
    b.box(0.62, 0.62, 0.06, PAL.cream, { pos: [0, 0.95, ez + Math.sign(ez) * 0.08], kind: KIND.PAINT });
    b.box(0.46, 0.46, 0.08, '#3d4048', { pos: [0, 0.95, ez + Math.sign(ez) * 0.1], flat: true, kind: KIND.PLAIN });
    b.box(0.05, 0.46, 0.1, PAL.cream, { pos: [0, 0.95, ez + Math.sign(ez) * 0.11], kind: KIND.PAINT });
    b.box(0.46, 0.05, 0.1, PAL.cream, { pos: [0, 0.95, ez + Math.sign(ez) * 0.11], kind: KIND.PAINT });
    // barge boards down the rakes, and a nail in every board end
    for (const sd of [-1, 1]) b.plank([sd * 2.42, -0.2, ez + Math.sign(ez) * 0.1], [sd * 0.05, 2.2, ez + Math.sign(ez) * 0.1], 0.16, 0.05, '#6f5a47', {});
  }
  // stovepipe
  b.cyl(0.1, 0.1, 1.1, PAL.rust, { pos: [1.05, 1.85, 0.9] }, 8);
  b.cone(0.2, 0.16, PAL.rustDark, { pos: [1.05, 2.5, 0.9] }, 8);
  return b.mesh();
}

function buildLandmarks() {
  const b = new Builder(77);
  // --- church steeple, nave ridge barely above the water ---
  {
    const x = 58;
    const z = 205;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.5, 0.02)), new THREE.Vector3(1, 1, 1));
    b.base = m;
    const WALL = { kind: KIND.SIDING, seed: 0.9 }; // clapboard courses, wide enough to read from the canoe
    b.box(4.4, 9, 4.4, '#ebe4d2', { pos: [0, 2.2, 0], ...WALL });
    b.box(5.0, 0.4, 5.0, '#d9d0bb', { pos: [0, 6.9, 0], kind: KIND.PLAIN });
    // corner boards and a tall arched window on each face
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.42, 9, 0.42, '#d6ccb4', { pos: [sx * 2.06, 2.2, sz * 2.06], kind: KIND.PLAIN });
    for (const [dx, dz, ry] of [[0, 2.22, 0], [0, -2.22, 0], [2.22, 0, Math.PI / 2], [-2.22, 0, Math.PI / 2]]) {
      b.box(1.0, 2.5, 0.1, '#4c5560', { pos: [dx, 3.4, dz], rot: [0, ry, 0], flat: true, kind: KIND.PLAIN });
      b.cyl(0.5, 0.5, 0.1, '#4c5560', { pos: [dx, 4.65, dz], rot: [Math.PI / 2, 0, ry], order: 'ZYX', flat: true, kind: KIND.PLAIN }, 10);
      b.box(1.3, 0.16, 0.16, '#d9d0bb', { pos: [dx, 2.1, dz], rot: [0, ry, 0], kind: KIND.PLAIN });
    }
    // belfry with dark louvres
    b.box(3.8, 3.2, 3.8, '#ebe4d2', { pos: [0, 8.7, 0], ...WALL });
    for (const [dx, dz, ry] of [[0, 1.93, 0], [0, -1.93, 0], [1.93, 0, Math.PI / 2], [-1.93, 0, Math.PI / 2]]) {
      b.box(1.5, 2.1, 0.12, '#4c5560', { pos: [dx, 8.7, dz], rot: [0, ry, 0], flat: true, kind: KIND.PLAIN });
      for (const y of [8.0, 8.5, 9.0, 9.5]) b.box(1.5, 0.12, 0.16, '#cfc6b0', { pos: [dx, y, dz], rot: [0, ry, 0], id: THIN, flat: true, kind: KIND.PLAIN });
    }
    b.box(4.6, 0.4, 4.6, '#d9d0bb', { pos: [0, 10.5, 0], kind: KIND.PLAIN });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cone(0.38, 1.7, PAL.slate, { pos: [sx * 1.95, 11.5, sz * 1.95], kind: KIND.PLAIN }, 4);
    b.cone(3.0, 9.5, PAL.slate, { pos: [0, 15.4, 0], rot: [0, Math.PI / 8, 0], kind: KIND.SIDING, seed: 1.15 }, 8);
    b.box(0.2, 2.2, 0.2, PAL.iron, { pos: [0, 21, 0] });
    b.box(1.1, 0.2, 0.2, PAL.iron, { pos: [0, 21.3, 0] });
    // nave roof
    for (const sd of [-1, 1]) b.box(5.2, 0.3, 16, '#7d8b92', { pos: [sd * 1.9, 0.2, -11], rot: [0, 0, -sd * 0.72] });
    b.base = null;
  }
  // --- hydro pylons marching into the mist ---
  const P = [
    [-95, 140],
    [-110, 222],
    [-125, 304],
    [-140, 386],
  ];
  // Lattice steel is drawn as bare pen lines (never outlined): at this distance an outline round every
  // member would clot into a blot. Multisampling keeps each member a clean thin stroke.
  const steel = '#59656d';
  const yaw = Math.atan2(P[1][0] - P[0][0], P[1][1] - P[0][1]);
  const armEnds = [];
  P.forEach(([x, z], pi) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, pi === 1 ? 0.04 : 0)), new THREE.Vector3(1, 1, 1));
    b.base = m;
    const M = { id: THIN, flat: true, kind: KIND.PLAIN };
    const leg = (s, t, y) => {
      const f = (y + 3) / 29;
      const w = 3.2 + (0.7 - 3.2) * f;
      return [s * w, y, t * w];
    };
    const R = 0.15;
    for (const s of [-1, 1]) for (const t of [-1, 1]) b.beam(leg(s, t, -3), leg(s, t, 26), R, steel, M, 4);
    const levels = [1, 4, 7, 10, 13, 15.8, 18.5, 20.8, 23, 26];
    for (let l = 0; l < levels.length; l++) {
      const y = levels[l];
      b.beam(leg(-1, -1, y), leg(1, -1, y), R * 0.7, steel, M, 4);
      b.beam(leg(-1, 1, y), leg(1, 1, y), R * 0.7, steel, M, 4);
      b.beam(leg(-1, -1, y), leg(-1, 1, y), R * 0.7, steel, M, 4);
      b.beam(leg(1, -1, y), leg(1, 1, y), R * 0.7, steel, M, 4);
      if (l < levels.length - 1) {
        const y2 = levels[l + 1];
        // one diagonal per bay on every face, alternating: the zig-zag of a real tower
        const q = l % 2 ? 1 : -1;
        for (const t of [-1, 1]) {
          b.beam(leg(-q, t, y), leg(q, t, y2), R * 0.55, steel, M, 4);
          b.beam(leg(t, -q, y), leg(t, q, y2), R * 0.55, steel, M, 4);
        }
      }
    }
    const ends = [];
    for (const [y, half] of [[19, 6.2], [24.5, 4.4]]) {
      b.beam([-half, y, 0], [half, y, 0], R, steel, M, 4);
      b.beam([-half, y, 0], [0, y + 1.6, 0], R * 0.7, steel, M, 4);
      b.beam([half, y, 0], [0, y + 1.6, 0], R * 0.7, steel, M, 4);
      for (const q of [0.33, 0.66]) for (const s of [-1, 1]) b.beam([s * half * q, y, 0], [s * half * q, y + 1.6 * (1 - q), 0], R * 0.5, steel, M, 4);
      for (const s of [-1, 1]) {
        // insulator string: a row of beads
        for (let k = 0; k < 4; k++) b.sphere(0.2, '#8fa2a8', { pos: [s * half, y - 0.25 - k * 0.27, 0], scale: [1, 0.6, 1], id: THIN, flat: true, kind: KIND.PLAIN }, 6);
        ends.push(new THREE.Vector3(s * half, y - 1.1, 0).applyMatrix4(m));
      }
    }
    b.beam([0, 26, 0], [0, 28.2, 0], R * 0.6, steel, M, 4); // earth-wire peak
    armEnds.push(ends);
    b.base = null;
  });
  for (let i = 0; i < armEnds.length - 1; i++) {
    for (let w = 0; w < 4; w++) {
      const a = armEnds[i][w];
      const c = armEnds[i + 1][w];
      const pts = [];
      for (let s = 0; s <= 8; s++) {
        const f = s / 8;
        pts.push([a.x + (c.x - a.x) * f, a.y + (c.y - a.y) * f - Math.sin(f * Math.PI) * 4.5, a.z + (c.z - a.z) * f]);
      }
      b.tube(pts, 0.09, '#5d666c', { steps: 16, id: THIN, flat: true, kind: KIND.PLAIN }, 4);
    }
  }
  return b.mesh();
}

export function createIsland() {
  const group = new THREE.Group();
  group.add(buildTerrain());

  const L = (dx, dz) => [ISLAND.x + dx, heightLocal(dx, dz), ISLAND.z + dz];

  // ---- trees ----
  const rand = rng(2024);
  const trees = new Builder(7);
  const placed = [];
  const tryPlace = (n, test, minD, plant) => {
    let guard = 0;
    let done = 0;
    while (done < n && guard++ < 4000) {
      const dx = (rand() - 0.5) * 44;
      const dz = (rand() - 0.5) * 30;
      const h = heightLocal(dx, dz);
      if (!test(dx, dz, h)) continue;
      if (placed.some((p) => Math.hypot(p[0] - dx, p[1] - dz) < minD)) continue;
      placed.push([dx, dz]);
      plant(ISLAND.x + dx, h, ISLAND.z + dz);
      done++;
    }
  };
  tryPlace(3, (dx, dz, h) => h > 3.6 && Math.abs(dx) < 9 && dz > -4, 5, (x, y, z) => whitePine(trees, x, y, z, 11 + rand() * 2.5, rand));
  tryPlace(12, (dx, dz, h) => h > 1.5 && beachFactor(dx, dz) < 0.05, 3.1, (x, y, z) => spruce(trees, x, y, z, 5.5 + rand() * 4.5, rand));
  tryPlace(4, (dx, dz, h) => h > 0.7 && h < 2.6 && dz < -3 && beachFactor(dx, dz) < 0.35 && Math.abs(dx - BEACH.x) < 16, 3.4, (x, y, z) => birch(trees, x, y, z, 5.6 + rand() * 1.6, rand));
  // low scrub
  tryPlace(9, (dx, dz, h) => h > 0.6 && h < 4 && beachFactor(dx, dz) < 0.3, 2.2, (x, y, z) => {
    const r = 0.5 + rand() * 0.5;
    trees.sphere(r, rand() > 0.5 ? PAL.sage : PAL.sageDeep, { pos: [x, y + r * 0.35, z], scale: [1.35, 0.7, 1.1], kind: KIND.LEAF }, 8);
    trees.sphere(r * 0.7, PAL.sage, { pos: [x + r * 0.8, y + r * 0.25, z + 0.2], scale: [1.2, 0.7, 1.0], kind: KIND.LEAF }, 8);
  });
  // the flooded forest: dead snags and drowned spruce tops
  for (const [dx, dz, H] of [[-22, -13, 4.6], [-16, -19, 3.2], [25, -11, 5.2], [29, -3, 3.6], [21, -18, 2.6], [-27, 3, 4.0]]) snag(trees, ISLAND.x + dx, ISLAND.z + dz, H, rand);
  for (const [dx, dz] of [[24, -15], [-24, -8], [31, 6]]) spruce(trees, ISLAND.x + dx, -4.6, ISLAND.z + dz, 8, rand);
  group.add(trees.mesh());

  // ---- cabin roof ----
  const cabinPos = [ISLAND.x - 22, ISLAND.z - 9];
  group.add(buildCabin(cabinPos[0], cabinPos[1]));

  // ---- lootables on the landing beach ----
  const sz = shoreZ(BEACH.x);
  const props = new Builder(19);

  // driftwood pile at the waterline
  const dwC = [BEACH.x + 4.4, shoreZ(BEACH.x + 4.4) + 0.5];
  const logs = [
    [-1.7, 0.0, 1.6, 0.35, 0.15, 0],
    [-1.3, 0.55, 1.8, -0.35, 0.12, 0],
    [-0.9, -0.5, 1.3, 0.75, 0.13, 0],
    [0.3, -1.0, 0.5, 1.2, 0.1, 1],
    [-1.9, 0.95, 0.7, 0.2, 0.11, 1],
    [-0.5, 0.25, 2.0, 0.95, 0.09, 1],
    [-0.2, -0.7, -1.1, 1.0, 0.08, 2],
  ];
  const dwTone = ['#ddd5c4', '#e6dfcf', '#cfc7b6', '#dbd3c2']; // a shade paler than B: loot has to read from the canoe
  const LOOT = 0.14; // a little of the flat colour shows through shade and mist, so loot pops
  logs.forEach(([ax, az, bx, bz, r, layer], i) => {
    const a = L(dwC[0] + ax, dwC[1] + az);
    const c = L(dwC[0] + bx, dwC[1] + bz);
    const y = Math.max(a[1], c[1], 0.02);
    a[1] = y + r + layer * 0.17 - 0.03;
    c[1] = y + r + layer * 0.17 + (layer ? 0.08 : 0);
    props.beam(a, c, r, dwTone[i % 4], { r2: r * 0.7, kind: KIND.DRIFT, glow: LOOT }, 7);
    if (i < 2) props.sphere(r * 1.5, dwTone[(i + 1) % 4], { pos: a, scale: [1, 0.9, 1.1], kind: KIND.DRIFT, glow: LOOT }, 7); // root wad
    // a broken branch stub or two on each log
    if (i < 5) {
      const f = 0.3 + (i % 3) * 0.2;
      const p = [a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f + r * 0.6, a[2] + (c[2] - a[2]) * f];
      props.beam(p, [p[0] + 0.1 - (i % 2) * 0.22, p[1] + 0.2, p[2] + 0.08], r * 0.3, dwTone[(i + 2) % 4], { r2: r * 0.12, kind: KIND.DRIFT, glow: LOOT }, 5);
    }
  });
  // one bleached branch standing up out of the pile
  {
    const a = L(dwC[0] + 0.2, dwC[1] + 0.1);
    props.beam([a[0], a[1] + 0.2, a[2]], [a[0] + 0.5, a[1] + 1.5, a[2] - 0.2], 0.05, '#e6dfcf', { r2: 0.02, kind: KIND.DRIFT, glow: LOOT }, 5);
    props.beam([a[0] + 0.3, a[1] + 1.0, a[2] - 0.12], [a[0] + 0.85, a[1] + 1.3, a[2] + 0.1], 0.03, '#e6dfcf', { r2: 0.012, kind: KIND.DRIFT, glow: LOOT }, 5);
    props.beam([a[0] + 0.18, a[1] + 0.65, a[2] - 0.07], [a[0] - 0.25, a[1] + 1.0, a[2] - 0.2], 0.025, '#e6dfcf', { r2: 0.01, kind: KIND.DRIFT, glow: LOOT }, 5);
  }
  const driftPos = new THREE.Vector3(...L(dwC[0], dwC[1])).setY(0.7);

  // crate, half sunk in the sand
  const crC = [BEACH.x - 1.4, sz + 2.6];
  const cg = L(crC[0], crC[1]);
  props.base = new THREE.Matrix4().compose(new THREE.Vector3(cg[0], cg[1] - 0.06, cg[2]), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.07, 0.5, -0.09)), new THREE.Vector3(1, 1, 1));
  {
    const W = 0.86;
    const H = 0.62;
    const D = 0.62;
    const tone = ['#e2a84e', '#eab65b', '#d89b40']; // warmer and brighter than B
    props.kind = KIND.WOOD;
    props.box(W - 0.06, H - 0.06, D - 0.06, '#6f5843', { pos: [0, H / 2, 0], flat: true, kind: KIND.PLAIN }); // dark inside between slats
    for (let r = 0; r < 3; r++) {
      const y = 0.11 + r * 0.2;
      props.box(W, 0.17, 0.035, tone[r % 3], { pos: [0, y, D / 2], glow: LOOT });
      props.box(W, 0.17, 0.035, tone[(r + 1) % 3], { pos: [0, y, -D / 2], glow: LOOT });
      props.box(0.035, 0.17, D, tone[(r + 2) % 3], { pos: [W / 2, y, 0], glow: LOOT });
      props.box(0.035, 0.17, D, tone[r % 3], { pos: [-W / 2, y, 0], glow: LOOT });
      // two nails in every slat end
      for (const sx of [-1, 1]) for (const dy of [-0.045, 0.045]) {
        props.tack((sx * W) / 2 - sx * 0.035, y + dy, D / 2 + 0.02, 0.009);
        props.tack(W / 2 + 0.02, y + dy, (sx * D) / 2 - sx * 0.035, 0.009);
      }
    }
    for (const sx of [-1, 1]) for (const s2 of [-1, 1]) props.box(0.07, H, 0.07, '#c4913f', { pos: [(sx * W) / 2, H / 2, (s2 * D) / 2], glow: LOOT });
    // lid, pried up at one corner
    props.box(W + 0.05, 0.04, D * 0.5, tone[1], { pos: [0, H + 0.05, -D * 0.25], rot: [0.0, 0, 0], glow: LOOT });
    props.box(W + 0.05, 0.04, D * 0.5, tone[0], { pos: [0.03, H + 0.11, D * 0.27], rot: [-0.28, 0.06, 0], glow: LOOT });
    // iron straps, bolted, and stencilled marks
    for (const sx of [-0.3, 0.3]) {
      props.box(0.05, H + 0.02, D + 0.05, PAL.rust, { pos: [W * sx, H / 2, 0], kind: KIND.METAL, glow: LOOT });
      for (const y of [0.12, 0.5]) props.bolt(W * sx, y, D / 2 + 0.03, '#33343c', 0.014, 'z');
    }
    props.box(0.2, 0.2, 0.01, '#3d3a3a', { pos: [0, 0.31, D / 2 + 0.022], rot: [0, 0, Math.PI / 4], flat: true, id: THIN, kind: KIND.PLAIN });
    props.box(0.1, 0.1, 0.012, tone[1], { pos: [0, 0.31, D / 2 + 0.024], rot: [0, 0, Math.PI / 4], flat: true, id: THIN, kind: KIND.PLAIN });
    props.stencil('N.7', [W / 2 + 0.022, 0.2, 0.2], [0, 0, -1], [0, 1, 0], 0.085, '#3d3a3a');
    // rope handle
    props.torus(0.09, 0.018, PAL.cream, { pos: [W / 2 + 0.03, 0.47, -0.16], rot: [0, Math.PI / 2, 0], kind: KIND.ROPE }, 10);
  }
  props.kind = null;
  props.base = null;
  const cratePos = new THREE.Vector3(cg[0], cg[1] + 0.75, cg[2]);

  // berry bush
  const bbC = [BEACH.x - 3.3, sz + 3.5];
  const bg = L(bbC[0], bbC[1]);
  {
    const blobs = [
      [0, 0.42, 0, 0.62],
      [0.5, 0.33, 0.2, 0.45],
      [-0.48, 0.3, -0.1, 0.48],
      [0.1, 0.36, -0.45, 0.4],
      [-0.1, 0.7, 0.1, 0.38],
    ];
    const br = rng(9);
    blobs.forEach(([x, y, z, r], i) => {
      props.sphere(r, i % 2 ? PAL.sageDeep : '#7d9a72', { pos: [bg[0] + x, bg[1] + y, bg[2] + z], scale: [1.15, 0.85, 1.05], kind: KIND.LEAF }, 9);
      for (let q = 0; q < 6; q++) {
        const a = br() * 6.28;
        const e = 0.25 + br() * 1.0;
        const rr = r * 1.02;
        props.sphere(0.06, '#d8402a', { pos: [bg[0] + x + Math.cos(a) * Math.sin(e) * rr * 1.15, bg[1] + y + Math.cos(e) * rr * 0.85, bg[2] + z + Math.sin(a) * Math.sin(e) * rr * 1.05], id: 0.93, flat: true, kind: KIND.PLAIN, glow: 0.4 }, 6);
      }
    });
  }
  const berryPos = new THREE.Vector3(bg[0], bg[1] + 1.15, bg[2]);
  {
    const pr = rng(31);
    for (let i = 0; i < 16; i++) {
      const dx = BEACH.x - 5 + pr() * 10;
      const dz = sz + 0.3 + pr() * 4.2;
      const g = L(dx, dz);
      if (g[1] < 0.03 || g[1] > 0.8) continue;
      const r = 0.06 + pr() * 0.1;
      props.sphere(r, pr() > 0.5 ? '#b9b3aa' : '#cdbfb0', { pos: [g[0], g[1] + r * 0.2, g[2]], scale: [1.3, 0.55, 1], rot: [0, pr() * 3, 0], kind: KIND.STONE }, 7);
    }
    for (let i = 0; i < 9; i++) {
      const dx = BEACH.x - 5.5 + pr() * 11;
      const dz = sz + 2.4 + pr() * 2.6;
      const g = L(dx, dz);
      if (g[1] < 0.25) continue;
      const tid = THIN;
      for (let q = 0; q < 4; q++) props.cone(0.035, 0.28 + pr() * 0.2, q % 2 ? '#7f9a70' : '#93a676', { pos: [g[0] + (pr() - 0.5) * 0.16, g[1] + 0.13, g[2] + (pr() - 0.5) * 0.16], rot: [(pr() - 0.5) * 0.5, 0, (pr() - 0.5) * 0.5], id: tid, glow: 0.5, flat: true, kind: KIND.PLAIN }, 5);
    }
    // footprints from the bow to where the paddler stands
    const a = L(BEACH.x + 1.5, sz + 0.5);
    const c = L(BEACH.x - 0.1, sz + 2.0);
    for (let i = 0; i < 6; i++) {
      const f = i / 6;
      const sd = i % 2 ? 0.11 : -0.11;
      const x = a[0] + (c[0] - a[0]) * f + sd * 0.7;
      const z = a[2] + (c[2] - a[2]) * f + sd * 0.7;
      const y = islandHeight(x, z);
      props.sphere(1, '#c9b78e', { pos: [x, y + 0.004, z], scale: [0.055, 0.008, 0.12], rot: [0, -0.8, 0], id: 0.52, flat: true, kind: KIND.PLAIN }, 7);
    }
  }
  group.add(props.mesh());

  // ---- shore dressing: boulders at the waterline, reeds in the shallows, sedge on the moss ----
  {
    const d = new Builder(63);
    const dr = rng(404);
    const blade = (x, y, z, h, lean, tone) => d.cone(0.03, h, tone, { pos: [x, y + h * 0.45, z], rot: [lean * (dr() - 0.5), 0, lean * (dr() - 0.5) + WIND * 0.08], id: THIN, glow: 0.45, flat: true, kind: KIND.PLAIN }, 4);
    // boulders: walk the shoreline, drop one where the bank is steep enough to have shed it
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * Math.PI * 2 + dr() * 0.1;
      let rr = 4;
      while (rr < 42 && heightLocal(Math.cos(a) * rr, Math.sin(a) * rr * 0.72) > 0.05) rr += 0.25;
      const dx = Math.cos(a) * (rr - 0.3 + dr() * 0.9);
      const dz = Math.sin(a) * (rr - 0.3 + dr() * 0.9) * 0.72;
      if (beachFactor(dx, dz) > 0.02 || dr() < 0.3) continue;
      const r = 0.28 + dr() * 0.5;
      const tone = ['#b3aaa0', '#c2a79c', '#a59f9b', '#b9b0a2'][k % 4];
      d.sphere(r, tone, { pos: [ISLAND.x + dx, Math.max(-0.1, heightLocal(dx, dz)) + r * 0.22, ISLAND.z + dz], scale: [1.25, 0.72, 1], rot: [dr() * 0.4, dr() * 3, dr() * 0.3], kind: KIND.STONE }, 7);
      if (dr() < 0.5) d.sphere(r * 0.5, tone, { pos: [ISLAND.x + dx + r * 1.1, Math.max(-0.1, heightLocal(dx + r, dz)) + r * 0.1, ISLAND.z + dz + r * 0.5], scale: [1.2, 0.7, 1], rot: [0, dr() * 3, 0], kind: KIND.STONE }, 6);
    }
    // reeds: clumps standing in the shallows either side of the landing
    for (const [cx, cz, n] of [[-7.5, -15.2, 14], [-11.5, -12.6, 10], [11.5, -13.4, 12], [15, -10.2, 9], [-17, -6.5, 8], [19.5, -5.5, 8], [9.2, -15.8, 7]]) {
      for (let q = 0; q < n; q++) {
        const dx = cx + (dr() - 0.5) * 2.6;
        const dz = cz + (dr() - 0.5) * 1.6;
        const g = heightLocal(dx, dz);
        if (g > 0.25 || g < -0.9) continue;
        const h = 0.75 + dr() * 0.75;
        blade(ISLAND.x + dx, Math.min(0, g) - 0.1, ISLAND.z + dz, h, 0.28, q % 3 ? '#8c9c68' : '#a3a56c');
        if (q % 4 === 0) d.cyl(0.035, 0.035, 0.2, '#6b4f3a', { pos: [ISLAND.x + dx + WIND * 0.03, Math.min(0, g) - 0.1 + h * 0.86, ISLAND.z + dz], id: THIN, glow: 0.3, flat: true, kind: KIND.PLAIN }, 5); // cattail head
      }
    }
    // sedge and grass where moss meets rock
    for (let k = 0; k < 260; k++) {
      const dx = (dr() - 0.5) * 50;
      const dz = (dr() - 0.5) * 34;
      const g = heightLocal(dx, dz);
      if (g < 0.35 || beachFactor(dx, dz) > 0.5) continue;
      const sl = Math.abs(heightLocal(dx + 0.4, dz) - g) + Math.abs(heightLocal(dx, dz + 0.4) - g);
      if (sl > 0.5) continue;
      const tone = dr() > 0.5 ? '#7f9a70' : '#98a86f';
      for (let q = 0; q < 4; q++) blade(ISLAND.x + dx + (dr() - 0.5) * 0.22, g - 0.04, ISLAND.z + dz + (dr() - 0.5) * 0.22, 0.24 + dr() * 0.3, 0.6, q % 2 ? tone : '#8ba173');
    }
    group.add(d.mesh());
  }

  group.add(buildLandmarks());

  // a few ravens over the knoll: pen ticks in the sky
  const birds = new THREE.Group();
  {
    const bb = new Builder(55);
    const br = rng(77);
    for (let i = 0; i < 6; i++) {
      const x = (br() - 0.5) * 26;
      const y = (br() - 0.5) * 7;
      const z = (br() - 0.5) * 18;
      const s = 0.8 + br() * 0.5;
      const lift = 0.2 + br() * 0.3;
      for (const sd of [-1, 1]) {
        bb.plank([x, y, z], [x + sd * 0.55 * s, y + lift * s, z - 0.12 * s], 0.3 * s, 0.03, '#3d3f47', { id: THIN, glow: 0.85, flat: true, kind: KIND.PLAIN });
        bb.plank([x + sd * 0.55 * s, y + lift * s, z - 0.12 * s], [x + sd * 1.0 * s, y + lift * 0.5 * s, z - 0.3 * s], 0.2 * s, 0.03, '#3d3f47', { id: THIN, glow: 0.85, flat: true, kind: KIND.PLAIN });
      }
    }
    birds.add(bb.mesh());
  }
  group.add(birds);

  // ---- shore map for the water shader (height, with drowned things stamped in) ----
  const TW = 256;
  const TH = 216;
  const hmap = new Float32Array(TW * TH);
  const data = new Uint8Array(TW * TH * 4); // r: height, g/b: its slope along x and z (lets the water size its foam lines)
  const cabM = new THREE.Matrix4().makeRotationY(-0.75);
  const v = new THREE.Vector3();
  const snagSpots = [[-22, -13], [-16, -19], [25, -11], [29, -3], [21, -18], [-27, 3], [24, -15], [-24, -8], [31, 6]];
  for (let j = 0; j < TH; j++) {
    for (let i = 0; i < TW; i++) {
      const dx = ((i + 0.5) / TW - 0.5) * SX;
      const dz = ((j + 0.5) / TH - 0.5) * SZ;
      let h = heightLocal(dx, dz);
      v.set(dx - (cabinPos[0] - ISLAND.x), 0, dz - (cabinPos[1] - ISLAND.z)).applyMatrix4(cabM);
      const cab = Math.max(Math.abs(v.x) - 2.2, Math.abs(v.z) - 2.7);
      if (cab < 1.6) h = Math.max(h, -cab * 0.9);
      for (const [sx, sz2] of snagSpots) {
        const dd = Math.hypot(dx - sx, dz - sz2);
        if (dd < 1.4) h = Math.max(h, 0.1 - dd * 0.9);
      }
      hmap[j * TW + i] = Math.min(1, Math.max(-3, h));
    }
  }
  for (let j = 0; j < TH; j++) {
    for (let i = 0; i < TW; i++) {
      const at = (ii, jj) => hmap[Math.min(TH - 1, Math.max(0, jj)) * TW + Math.min(TW - 1, Math.max(0, ii))];
      const gx = (at(i + 1, j) - at(i - 1, j)) / ((2 * SX) / TW);
      const gz = (at(i, j + 1) - at(i, j - 1)) / ((2 * SZ) / TH);
      const o = (j * TW + i) * 4;
      data[o] = Math.round(((hmap[j * TW + i] + 3) / 4) * 255);
      data[o + 1] = Math.round(Math.min(1, Math.max(0, gx / 4 + 0.5)) * 255);
      data[o + 2] = Math.round(Math.min(1, Math.max(0, gz / 4 + 0.5)) * 255);
      data[o + 3] = 255;
    }
  }
  const shore = new THREE.DataTexture(data, TW, TH, THREE.RGBAFormat);
  shore.minFilter = THREE.LinearFilter;
  shore.magFilter = THREE.LinearFilter;
  shore.unpackAlignment = 1;
  shore.needsUpdate = true;

  // where the canoe is hauled up and where the paddler stands
  const landing = {
    canoe: new THREE.Vector3(ISLAND.x + BEACH.x + 2.1, 0, ISLAND.z + sz - 1.35),
    canoeHeading: -0.42,
    stand: new THREE.Vector3(...L(BEACH.x - 0.1, sz + 2.3)),
    standYaw: Math.PI + 0.75,
    approach: new THREE.Vector3(ISLAND.x + BEACH.x, 0, ISLAND.z + sz - 4),
  };

  return {
    group,
    update(t) {
      // slow circuit over the island
      const a = t * 0.045 + 0.9;
      birds.position.set(ISLAND.x + 14 + Math.cos(a) * 46, 24 + Math.sin(a * 2.3) * 2.5, ISLAND.z + 6 + Math.sin(a) * 34);
      birds.rotation.y = -a;
    },
    shore: { texture: shore, cx: ISLAND.x, cz: ISLAND.z, sx: SX, sz: SZ },
    landing,
    loot: [
      { key: 'crate', label: 'crate', pos: cratePos },
      { key: 'driftwood', label: 'driftwood', pos: driftPos },
      { key: 'berries', label: 'berries', pos: berryPos },
    ],
    waypoint: { label: 'Birch Knoll', pos: new THREE.Vector3(ISLAND.x + 1, 16.5, ISLAND.z) },
  };
}
