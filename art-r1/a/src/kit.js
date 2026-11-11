// Geometry kit: stack primitives with colours into one flat-shaded, vertex-coloured mesh.
import * as THREE from 'three';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _up = new THREE.Vector3(0, 1, 0);

export function xf(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(_e.set(rx, ry, rz, 'YXZ')),
    new THREE.Vector3(sx, sy, sz),
  );
}

export class Kit {
  constructor(seed = 1, tone = 0.06) {
    this.p = [];
    this.c = [];
    this.rand = rng(seed);
    this.tone = tone; // per-primitive lightness wobble: the hand-cut look
    this.base = new THREE.Matrix4();
    this.stack = [];
  }
  push(m) { this.stack.push(this.base.clone()); this.base.multiply(m); return this; }
  pop() { this.base.copy(this.stack.pop()); return this; }

  _tone() { return 1 + (this.rand() - 0.5) * 2 * this.tone; }

  // Append a geometry. perFace: every triangle gets its own tone (rock, foliage).
  geo(g, color, m, perFace = false) {
    const ng = g.index ? g.toNonIndexed() : g;
    const pos = ng.attributes.position;
    _m.copy(this.base);
    if (m) _m.multiply(m);
    let t = this._tone();
    for (let i = 0; i < pos.count; i += 3) {
      if (perFace) t = this._tone();
      _c.set(color).multiplyScalar(t);
      for (let k = 0; k < 3; k++) {
        _v.fromBufferAttribute(pos, i + k).applyMatrix4(_m);
        this.p.push(_v.x, _v.y, _v.z);
        this.c.push(_c.r, _c.g, _c.b);
      }
    }
    if (ng !== g) ng.dispose();
    g.dispose();
    return this;
  }
  box(w, h, d, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    return this.geo(new THREE.BoxGeometry(w, h, d), color, xf(x, y, z, rx, ry, rz));
  }
  cyl(rTop, rBot, h, seg, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, perFace = false) {
    return this.geo(new THREE.CylinderGeometry(rTop, rBot, h, seg), color, xf(x, y, z, rx, ry, rz), perFace);
  }
  cone(r, h, seg, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, perFace = false) {
    return this.geo(new THREE.ConeGeometry(r, h, seg), color, xf(x, y, z, rx, ry, rz), perFace);
  }
  ico(r, detail, color, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, perFace = true, ry = 0) {
    return this.geo(new THREE.IcosahedronGeometry(r, detail), color, xf(x, y, z, 0, ry, 0, sx, sy, sz), perFace);
  }
  // Square or round bar between two points.
  beam(ax, ay, az, bx, by, bz, t, color, seg = 0, t2 = t) {
    _a.set(ax, ay, az); _b.set(bx, by, bz);
    const len = _a.distanceTo(_b);
    if (len < 1e-5) return this;
    _v.subVectors(_b, _a).normalize();
    _q.setFromUnitVectors(_up, _v);
    const m = new THREE.Matrix4().compose(_a.clone().add(_b).multiplyScalar(0.5), _q, new THREE.Vector3(1, 1, 1));
    const g = seg ? new THREE.CylinderGeometry(t2 / 2, t / 2, len, seg) : new THREE.BoxGeometry(t, len, t2);
    return this.geo(g, color, m);
  }
  tri(a, b, c, color, both = false) {
    const t = this._tone();
    _c.set(color).multiplyScalar(t);
    const put = (p) => { _v.set(p[0], p[1], p[2]).applyMatrix4(this.base); this.p.push(_v.x, _v.y, _v.z); this.c.push(_c.r, _c.g, _c.b); };
    put(a); put(b); put(c);
    if (both) { put(a); put(c); put(b); }
    return this;
  }
  quad(a, b, c, d, color, both = false) {
    const t = this._tone();
    _c.set(color).multiplyScalar(t);
    const put = (p) => { _v.set(p[0], p[1], p[2]).applyMatrix4(this.base); this.p.push(_v.x, _v.y, _v.z); this.c.push(_c.r, _c.g, _c.b); };
    put(a); put(b); put(c); put(a); put(c); put(d);
    if (both) { put(a); put(c); put(b); put(a); put(d); put(c); }
    return this;
  }
  // Quad wound so its normal points along `out`.
  quadOut(a, b, c, d, out, color) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    return nx * out[0] + ny * out[1] + nz * out[2] >= 0 ? this.quad(a, b, c, d, color) : this.quad(a, d, c, b, color);
  }
  bolt(x, y, z, rx = 0, rz = 0, r = 0.035, color = 0x2a3238) {
    return this.cyl(r, r, 0.05, 6, color, x, y, z, rx, 0, rz);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
  mesh(material, name = '', shadow = true) {
    const m = new THREE.Mesh(this.geometry(), material);
    m.name = name;
    m.castShadow = shadow;
    m.receiveShadow = shadow;
    return m;
  }
}
