// Geometry builder: merges primitives into one mesh with per-piece colour + ink id.
// Every piece gets its own id, so the ink pass draws a line wherever two pieces meet.
import * as THREE from 'three';
import { inkMaterial } from './palette.js';
import { KIND, DIRECTIONAL, kindOf } from './detail.js';

// Pieces with this id are never outlined: ropes, wires, rods — they are already a pen line.
// (Ink ids are 11-bit: the ink buffer is half-float, and n / 2048 is exact in it. 2003 ids, against B2's 239.)
export const THIN = 2040 / 2048;

let idCounter = 0;
export function nextId() {
  idCounter++;
  return (((idCounter * 53) % 2003) + 16) / 2048;
}

// Small deterministic RNG so every build of the scene is identical.
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _m = new THREE.Matrix4();
const _dp = new THREE.Vector3();
const _dq = new THREE.Quaternion();
const _ds = new THREE.Vector3();
const _bb = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _c = new THREE.Color();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// 3x5 stencil letters, rows top to bottom
const FONT = {
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'], 2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'], 4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '010', '010', '010'], 8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
  A: ['010', '101', '111', '101', '101'], B: ['110', '101', '110', '101', '110'], C: ['011', '100', '100', '100', '011'],
  D: ['110', '101', '101', '101', '110'], E: ['111', '100', '110', '100', '111'], F: ['111', '100', '110', '100', '100'],
  G: ['011', '100', '101', '101', '011'], H: ['101', '101', '111', '101', '101'], I: ['111', '010', '010', '010', '111'],
  K: ['101', '101', '110', '101', '101'], L: ['100', '100', '100', '100', '111'], M: ['101', '111', '111', '101', '101'], N: ['110', '101', '101', '101', '101'],
  O: ['111', '101', '101', '101', '111'], P: ['110', '101', '110', '100', '100'], R: ['110', '101', '110', '101', '101'],
  S: ['011', '100', '010', '001', '110'], T: ['111', '010', '010', '010', '010'], U: ['101', '101', '101', '101', '111'],
  V: ['101', '101', '101', '101', '010'], W: ['101', '101', '111', '111', '101'], X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'], '-': ['000', '000', '111', '000', '000'], '.': ['000', '000', '000', '000', '010'],
};

const cache = new Map();
function cached(key, make) {
  let g = cache.get(key);
  if (!g) {
    g = make();
    if (g.index) g = g.toNonIndexed();
    cache.set(key, g);
  }
  return g;
}

export class Builder {
  constructor(seed = 1) {
    this.p = [];
    this.n = [];
    this.c = [];
    this.i = [];
    this.t = [];
    this.rand = rng(seed);
    this.seedRand = rng(seed * 7919 + 13); // its own stream, so piece seeds never disturb the layout rolls
    this.base = null; // optional Matrix4 applied to everything added
    this.root = null; // optional Matrix4 applied after it, grids included: moves a whole B2 piece onto its mount
    this.kind = null; // optional default material kind for everything added (see detail.js)
  }

  // o: { pos, rot, scale, matrix, id, glow, flat (no colour jitter), kind, axis (0|1|2: which local axis the grain runs along), seed }
  // Each piece also carries its own local frame in metres (aTex), so the pen marks drawn inside it ride with it.
  add(geom, color, o = {}) {
    const g = geom.index ? geom.toNonIndexed() : geom;
    if (o.matrix) _m.copy(o.matrix);
    else {
      const pos = o.pos || [0, 0, 0];
      const rot = o.rot || [0, 0, 0];
      const sc = o.scale ?? 1;
      _e.set(rot[0], rot[1], rot[2], o.order || 'XYZ');
      _q.setFromEuler(_e);
      _p.set(pos[0], pos[1], pos[2]);
      if (typeof sc === 'number') _s.set(sc, sc, sc);
      else _s.set(sc[0], sc[1], sc[2]);
      _m.compose(_p, _q, _s);
    }
    _m.decompose(_dp, _dq, _ds); // local metres = geometry coordinates x the piece's own scale
    if (this.base) _m.premultiply(this.base);
    if (this.root) _m.premultiply(this.root);
    _nm.getNormalMatrix(_m);
    const flip = _m.determinant() < 0;
    const P = g.attributes.position;
    const N = g.attributes.normal;
    const TX = g.attributes.tex; // tubes and rings bring their own (along, around) frame
    const id = o.id ?? nextId();
    const glow = o.glow || 0;
    const kind = o.kind ?? this.kind ?? kindOf(color);
    const seed = o.seed ?? this.seedRand();
    let axis = 0;
    if (!TX && DIRECTIONAL.has(kind)) {
      if (o.axis != null) axis = o.axis;
      else {
        if (!g.boundingBox) g.computeBoundingBox();
        g.boundingBox.getSize(_bb).multiply(_ds);
        const ex = Math.abs(_bb.x);
        const ey = Math.abs(_bb.y);
        const ez = Math.abs(_bb.z);
        axis = ey >= ex && ey >= ez ? 1 : ez >= ex ? 2 : 0;
      }
    }
    _c.set(color);
    if (!o.flat) {
      const j = 1 + (this.rand() - 0.5) * 0.07;
      _c.r = Math.min(1, _c.r * j);
      _c.g = Math.min(1, _c.g * j);
      _c.b = Math.min(1, _c.b * j);
    }
    for (let t = 0; t < P.count; t += 3) {
      for (let k = 0; k < 3; k++) {
        const v = t + (flip ? 2 - k : k);
        _a.fromBufferAttribute(P, v).applyMatrix4(_m);
        _b.fromBufferAttribute(N, v).applyMatrix3(_nm).normalize();
        if (TX) this.t.push(TX.getX(v), TX.getY(v), TX.getZ(v), seed);
        else this.t.push(P.getX(v) * _ds.x, P.getY(v) * _ds.y, P.getZ(v) * _ds.z, seed);
        this.p.push(_a.x, _a.y, _a.z);
        this.n.push(_b.x, _b.y, _b.z);
        this.c.push(_c.r, _c.g, _c.b);
        this.i.push(id, glow, kind, axis);
      }
    }
    return id;
  }

  box(w, h, d, color, o = {}) {
    return this.add(cached('box', () => new THREE.BoxGeometry(1, 1, 1)), color, { ...o, scale: [w, h, d] });
  }

  cyl(rTop, rBot, h, color, o = {}, seg = 10) {
    const g = cached(`cyl${rTop.toFixed(3)}_${rBot.toFixed(3)}_${h.toFixed(3)}_${seg}`, () => new THREE.CylinderGeometry(rTop, rBot, h, seg));
    return this.add(g, color, o);
  }

  cone(r, h, color, o = {}, seg = 10) {
    const g = cached(`cone${r.toFixed(3)}_${h.toFixed(3)}_${seg}`, () => new THREE.ConeGeometry(r, h, seg));
    return this.add(g, color, o);
  }

  sphere(r, color, o = {}, seg = 10) {
    const g = cached(`sph${seg}`, () => new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg * 0.7))));
    const sc = o.scale ?? 1;
    const s3 = typeof sc === 'number' ? [r * sc, r * sc, r * sc] : [r * sc[0], r * sc[1], r * sc[2]];
    return this.add(g, color, { ...o, scale: s3 });
  }

  torus(r, tube, color, o = {}, seg = 14) {
    const g = cached(`tor${r.toFixed(3)}_${tube.toFixed(3)}_${seg}`, () => alongAround(new THREE.TorusGeometry(r, tube, 6, seg), Math.PI * 2 * r, Math.PI * 2 * tube));
    return this.add(g, color, o);
  }

  // straight round bar from a to b (arrays), radius r (optionally tapered to r2)
  beam(a, b, r, color, o = {}, seg = 6) {
    const r2 = o.r2 ?? r;
    const g = cached(`beam${(r2 / r).toFixed(3)}_${seg}`, () => new THREE.CylinderGeometry(r2 / r, 1, 1, seg));
    _a.set(a[0], a[1], a[2]);
    _b.set(b[0], b[1], b[2]);
    const len = _a.distanceTo(_b);
    const m = new THREE.Matrix4();
    const dir = _b.clone().sub(_a).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
    m.compose(_a.clone().add(_b).multiplyScalar(0.5), q, new THREE.Vector3(r, len, r));
    return this.add(g, color, { ...o, matrix: m });
  }

  // flat board from a to b: width w (sideways), thickness t
  plank(a, b, w, t, color, o = {}) {
    _a.set(a[0], a[1], a[2]);
    _b.set(b[0], b[1], b[2]);
    const len = _a.distanceTo(_b);
    const dir = _b.clone().sub(_a).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
    if (o.twist) q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, o.twist));
    const m = new THREE.Matrix4().compose(_a.clone().add(_b).multiplyScalar(0.5), q, new THREE.Vector3(w, len, t));
    return this.add(cached('box', () => new THREE.BoxGeometry(1, 1, 1)), color, { ...o, matrix: m });
  }

  // smooth tube through points (arrays)
  tube(points, r, color, o = {}, seg = 6) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    const g = alongAround(new THREE.TubeGeometry(curve, o.steps || points.length * 4, r, seg, false), curve.getLength(), Math.PI * 2 * r);
    return this.add(g, color, o);
  }

  // smooth surface through a 2D array of Vector3; colour and id are chosen per cell
  // colorFn(i, j) -> colour or null (hole); idFn(i, j) -> id
  // o: { kind: number | (i, j) => number, axis (default 2: marks run along z), seed,
  //      tex: (vi, vj, i, j) => [x, y, z, w] | null  — a cell's own frame (stitched patches) }
  grid(P, colorFn, idFn, o = {}) {
    const gridSeed = o.seed ?? this.seedRand();
    const ni = P.length;
    const nj = P[0].length;
    const Nn = [];
    const di = new THREE.Vector3();
    const dj = new THREE.Vector3();
    let last = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < ni; i++) {
      Nn.push([]);
      for (let j = 0; j < nj; j++) {
        di.subVectors(P[Math.min(i + 1, ni - 1)][j], P[Math.max(i - 1, 0)][j]);
        dj.subVectors(P[i][Math.min(j + 1, nj - 1)], P[i][Math.max(j - 1, 0)]);
        const n = new THREE.Vector3().crossVectors(di, dj);
        if (n.lengthSq() < 1e-14) n.copy(last);
        else last = n.normalize();
        Nn[i].push(n);
      }
    }
    for (let i = 0; i < ni - 1; i++) {
      for (let j = 0; j < nj - 1; j++) {
        const color = colorFn(i, j);
        if (color == null) continue;
        const id = idFn(i, j);
        const kind = typeof o.kind === 'function' ? o.kind(i, j) : o.kind ?? this.kind ?? kindOf(color);
        _c.set(color);
        const jt = 1 + (this.rand() - 0.5) * 0.05;
        const quad = [
          [i, j],
          [i + 1, j],
          [i, j + 1],
          [i + 1, j],
          [i + 1, j + 1],
          [i, j + 1],
        ];
        for (const [a, b2] of quad) {
          const p = P[a][b2];
          const n = Nn[a][b2];
          const tx = o.tex ? o.tex(a, b2, i, j) : null;
          if (this.root) {
            _a.copy(p).applyMatrix4(this.root);
            _b.copy(n).transformDirection(this.root);
            this.p.push(_a.x, _a.y, _a.z);
            this.n.push(_b.x, _b.y, _b.z);
          } else {
            this.p.push(p.x, p.y, p.z);
            this.n.push(n.x, n.y, n.z);
          }
          this.c.push(Math.min(1, _c.r * jt), Math.min(1, _c.g * jt), Math.min(1, _c.b * jt));
          if (tx) {
            this.t.push(tx[0], tx[1], tx[2], tx[3]);
            this.i.push(id, 0, kind, 0);
          } else {
            this.t.push(p.x, p.y, p.z, gridSeed);
            this.i.push(id, 0, kind, DIRECTIONAL.has(kind) ? o.axis ?? 2 : 0);
          }
        }
      }
    }
  }

  // dark bolt head on a pale washer: the "bolted-on" tell
  bolt(x, y, z, color = '#33343c', r = 0.022, axis = 'y') {
    const rot = axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0];
    const id = this.cyl(r, r, 0.03, color, { pos: [x, y, z], rot, flat: true, kind: KIND.PLAIN }, 6);
    this.cyl(r * 1.75, r * 1.75, 0.012, '#8d9496', { pos: [x, y, z], rot, flat: true, kind: KIND.PLAIN, id }, 8);
    return id;
  }

  // small nail or tack head, drawn as a bare pen dot (never outlined)
  tack(x, y, z, r = 0.011, color = '#3a3b44') {
    return this.sphere(r, color, { pos: [x, y, z], scale: [1, 0.6, 1], id: THIN, flat: true, kind: KIND.PLAIN }, 6);
  }

  // Stencilled mark: blocky 3x5 letters painted flat on a surface.
  // origin: bottom-left corner; right, up: unit vectors lying in the surface; h: letter height in metres
  stencil(text, origin, right, up, h, color = '#3d3a3a') {
    const R = new THREE.Vector3(...right).normalize();
    const U = new THREE.Vector3(...up).normalize();
    const N = new THREE.Vector3().crossVectors(R, U).normalize();
    const p = h / 5;
    const box = cached('box', () => new THREE.BoxGeometry(1, 1, 1));
    const basis = new THREE.Matrix4();
    let col = 0;
    for (const ch of text.toUpperCase()) {
      const rows = FONT[ch];
      if (rows) {
        for (let r = 0; r < 5; r++) {
          for (let c = 0; c < 3; c++) {
            if (rows[r][c] !== '1') continue;
            const x = (col + c + 0.5) * p;
            const y = (4 - r + 0.5) * p;
            basis.makeBasis(R.clone().multiplyScalar(p * 1.04), U.clone().multiplyScalar(p * 1.04), N.clone().multiplyScalar(0.006));
            basis.setPosition(origin[0] + R.x * x + U.x * y, origin[1] + R.y * x + U.y * y, origin[2] + R.z * x + U.z * y);
            this.add(box, color, { matrix: basis, id: THIN, flat: true, kind: KIND.PLAIN });
          }
        }
      }
      col += ch === ' ' ? 2 : 4;
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(this.i, 4));
    g.setAttribute('aTex', new THREE.Float32BufferAttribute(this.t, 4));
    g.computeBoundingSphere();
    return g;
  }

  mesh(material = inkMaterial) {
    return new THREE.Mesh(this.geometry(), material);
  }
}

// Tubes and rings: a local frame of (metres along, metres around), read from the geometry's own uv.
function alongAround(g, length, girth) {
  const uv = g.attributes.uv;
  const tex = new Float32Array(uv.count * 3);
  for (let k = 0; k < uv.count; k++) {
    tex[k * 3] = uv.getX(k) * length;
    tex[k * 3 + 1] = uv.getY(k) * girth;
  }
  g.setAttribute('tex', new THREE.BufferAttribute(tex, 3));
  return g;
}

// Single animated piece (limb, puff…) as its own mesh with the ink material.
let pieceCount = 0;
export function piece(geom, color, glow = 0, id = nextId(), kind = KIND.PLAIN) {
  const g = geom.index ? geom.toNonIndexed() : geom.clone();
  const n = g.attributes.position.count;
  const c = new THREE.Color(color);
  const col = new Float32Array(n * 3);
  const info = new Float32Array(n * 4);
  const tex = new Float32Array(n * 4);
  const P = g.attributes.position;
  const seed = ((++pieceCount * 0.618034) % 1) + 0.01;
  for (let k = 0; k < n; k++) {
    col[k * 3] = c.r;
    col[k * 3 + 1] = c.g;
    col[k * 3 + 2] = c.b;
    info[k * 4] = id;
    info[k * 4 + 1] = glow;
    info[k * 4 + 2] = kind;
    info[k * 4 + 3] = DIRECTIONAL.has(kind) ? 1 : 0;
    tex[k * 4] = P.getX(k);
    tex[k * 4 + 1] = P.getY(k);
    tex[k * 4 + 2] = P.getZ(k);
    tex[k * 4 + 3] = seed;
  }
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
  g.setAttribute('aTex', new THREE.BufferAttribute(tex, 4));
  return new THREE.Mesh(g, inkMaterial);
}

// Cloth: a small animated sheet (sail, pennant). fn(u, v, out) gives the point; call update() each frame.
// cellColor(i, j) and cellId(i, j) paint panels, seams and patches.
// o: { size: [metres along u, metres along v], kind, patch: (i, j) => [i0, j0, i1, j1] | null }
// The pen marks are laid out on the flat sheet (u, v in metres), so they ride with the cloth as it moves.
export function cloth(nu, nv, cellColor, cellId, o = {}) {
  const cells = nu * nv;
  const pos = new Float32Array(cells * 18);
  const nor = new Float32Array(cells * 18);
  const col = new Float32Array(cells * 18);
  const info = new Float32Array(cells * 24);
  const tex = new Float32Array(cells * 24);
  const c = new THREE.Color();
  const [SU, SV] = o.size || [1, 1];
  const du = SU / nu;
  const dv = SV / nv;
  const CORNER = [0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1];
  const seed = ((++pieceCount * 0.618034) % 1) + 0.01;
  let k = 0;
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      c.set(cellColor(i, j));
      const id = cellId(i, j);
      const pt = o.patch ? o.patch(i, j) : null;
      for (let q = 0; q < 6; q++) {
        const vi = i + CORNER[q * 2];
        const vj = j + CORNER[q * 2 + 1];
        col[k * 3] = c.r;
        col[k * 3 + 1] = c.g;
        col[k * 3 + 2] = c.b;
        info[k * 4] = id;
        if (pt) {
          info[k * 4 + 2] = KIND.PATCH;
          tex[k * 4] = (vi - pt[0]) * du;
          tex[k * 4 + 1] = (vj - pt[1]) * dv;
          tex[k * 4 + 2] = (pt[2] - pt[0]) * du;
          tex[k * 4 + 3] = (pt[3] - pt[1]) * dv;
        } else {
          info[k * 4 + 2] = o.kind ?? KIND.CLOTH;
          tex[k * 4] = vi * du;
          tex[k * 4 + 1] = vj * dv;
          tex[k * 4 + 3] = seed;
        }
        k++;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
  g.setAttribute('aTex', new THREE.BufferAttribute(tex, 4));
  const mesh = new THREE.Mesh(g, inkMaterial);
  mesh.frustumCulled = false;
  const P = [];
  const Nn = [];
  for (let i = 0; i <= nu; i++) {
    P.push([]);
    Nn.push([]);
    for (let j = 0; j <= nv; j++) {
      P[i].push(new THREE.Vector3());
      Nn[i].push(new THREE.Vector3());
    }
  }
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const ORDER = [0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1];
  mesh.userData.update = (fn) => {
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) fn(i / nu, j / nv, P[i][j]);
    for (let i = 0; i <= nu; i++) {
      for (let j = 0; j <= nv; j++) {
        a.subVectors(P[Math.min(i + 1, nu)][j], P[Math.max(i - 1, 0)][j]);
        b.subVectors(P[i][Math.min(j + 1, nv)], P[i][Math.max(j - 1, 0)]);
        Nn[i][j].crossVectors(a, b).normalize();
      }
    }
    let o = 0;
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        for (let q = 0; q < 6; q++) {
          const p = P[i + ORDER[q * 2]][j + ORDER[q * 2 + 1]];
          const n = Nn[i + ORDER[q * 2]][j + ORDER[q * 2 + 1]];
          pos[o] = p.x;
          pos[o + 1] = p.y;
          pos[o + 2] = p.z;
          nor[o] = n.x;
          nor[o + 1] = n.y;
          nor[o + 2] = n.z;
          o += 3;
        }
      }
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
  };
  return mesh;
}

// Orient a unit-height (Y) mesh so it spans a -> b.
const _d = new THREE.Vector3();
export function setSpan(mesh, a, b, radius = 1) {
  _d.subVectors(b, a);
  const len = _d.length();
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, _d.normalize());
  mesh.scale.set(radius, len, radius);
}
