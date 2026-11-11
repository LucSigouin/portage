// Ink & Wash — things that grow and things the flood left, moved from art-r1/b2's island.js.
// Each builder adds its pieces to a Builder at the place it is given. props.ts builds a few variants
// of each at the origin and instances them over every island; landmarks.ts places the big ones.
import * as THREE from 'three';
import { THIN } from './geo.js';
import { PAL } from './palette.js';
import { KIND } from './detail.js';

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

export function spruce(b, x, y, z, H, rand) {
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

export function whitePine(b, x, y, z, H, rand) {
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

export function birch(b, x, y, z, H, rand) {
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

export function snag(b, x, z, H, rand) {
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

// A drowned cottage roof, sunk and tilted. Built round the origin; b.root places it.
export function cabinRoof(b) {
  b.base = new THREE.Matrix4().compose(
    new THREE.Vector3(0, -0.5, 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, 0, 0.1, 'YXZ')),
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
  b.base = null;
}


// The church steeple, nave ridge barely above the water. Built round the origin; b.root places it.
export function steeple(b) {
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
}

// A hydro pylon. Lattice steel is drawn as bare pen lines (never outlined): at a distance an outline
// round every member would clot into a blot. Built round the origin; b.root places it.
export function pylon(b) {
  const steel = '#59656d';
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
  for (const [y, half] of [[19, 6.2], [24.5, 4.4]]) {
    b.beam([-half, y, 0], [half, y, 0], R, steel, M, 4);
    b.beam([-half, y, 0], [0, y + 1.6, 0], R * 0.7, steel, M, 4);
    b.beam([half, y, 0], [0, y + 1.6, 0], R * 0.7, steel, M, 4);
    for (const q of [0.33, 0.66]) for (const s of [-1, 1]) b.beam([s * half * q, y, 0], [s * half * q, y + 1.6 * (1 - q), 0], R * 0.5, steel, M, 4);
    for (const s of [-1, 1]) {
      // insulator string: a row of beads
      for (let k = 0; k < 4; k++) b.sphere(0.2, '#8fa2a8', { pos: [s * half, y - 0.25 - k * 0.27, 0], scale: [1, 0.6, 1], id: THIN, flat: true, kind: KIND.PLAIN }, 6);
    }
  }
  b.beam([0, 26, 0], [0, 28.2, 0], R * 0.6, steel, M, 4); // earth-wire peak
}
