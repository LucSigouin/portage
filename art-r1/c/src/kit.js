// Geometry kit: collect primitives per material, then merge so a whole prop is a few draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _matrix = new THREE.Matrix4(), _quat = new THREE.Quaternion(), _euler = new THREE.Euler();
const _scale = new THREE.Vector3(), _pos = new THREE.Vector3(), _dir = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export class Kit {
  constructor() {
    this.bins = new Map();
  }

  /** Add a geometry (optionally transformed) to a material bin. */
  geo(material, geometry, matrix) {
    let g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (matrix) g.applyMatrix4(matrix);
    for (const key of Object.keys(g.attributes)) {
      const keep = key === 'position' || key === 'normal' || key === 'uv' || (key === 'color' && material.vertexColors);
      if (!keep) g.deleteAttribute(key);
    }
    const count = g.attributes.position.count;
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
    if (material.vertexColors && !g.attributes.color) {
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(count * 3).fill(1), 3));
    }
    if (!this.bins.has(material)) this.bins.set(material, []);
    this.bins.get(material).push(g);
    return this;
  }

  at(material, geometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    _matrix.compose(_pos.set(x, y, z), _quat.setFromEuler(_euler.set(rx, ry, rz)), _scale.set(sx, sy, sz));
    return this.geo(material, geometry, _matrix);
  }

  box(material, w, h, d, x, y, z, rx, ry, rz) {
    return this.at(material, new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
  }

  cyl(material, radiusTop, radiusBottom, height, x, y, z, rx, ry, rz, segments = 12) {
    return this.at(material, new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), x, y, z, rx, ry, rz);
  }

  ball(material, radius, x, y, z, sx = 1, sy = 1, sz = 1, segments = 12) {
    const geometry = new THREE.SphereGeometry(radius, segments, Math.max(6, Math.round(segments * 0.7)));
    return this.at(material, geometry, x, y, z, 0, 0, 0, sx, sy, sz);
  }

  /** Round bar from a to b. `radius` at a, `radiusEnd` at b. */
  rod(material, a, b, radius, segments = 7, radiusEnd = radius) {
    _dir.subVectors(b, a);
    const length = _dir.length();
    _matrix.compose(_pos.addVectors(a, b).multiplyScalar(0.5), _quat.setFromUnitVectors(UP, _dir.normalize()), _scale.set(1, 1, 1));
    return this.geo(material, new THREE.CylinderGeometry(radiusEnd, radius, length, segments), _matrix);
  }

  /** Square timber from a to b. */
  bar(material, a, b, width, depth = width) {
    _dir.subVectors(b, a);
    const length = _dir.length();
    _matrix.compose(_pos.addVectors(a, b).multiplyScalar(0.5), _quat.setFromUnitVectors(UP, _dir.normalize()), _scale.set(1, 1, 1));
    return this.geo(material, new THREE.BoxGeometry(width, length, depth), _matrix);
  }

  tube(material, points, radius, segments = 6, divisions = points.length * 5) {
    return this.geo(material, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), divisions, radius, segments, false));
  }

  /** Hex bolt head. axis: 'x' | 'y' | 'z'. */
  bolt(material, x, y, z, axis = 'y', radius = 0.02) {
    const rx = axis === 'z' ? Math.PI / 2 : 0;
    const rz = axis === 'x' ? Math.PI / 2 : 0;
    return this.at(material, new THREE.CylinderGeometry(radius, radius, 0.034, 6), x, y, z, rx, 0, rz);
  }

  build(name = '') {
    const group = new THREE.Group();
    group.name = name;
    for (const [material, list] of this.bins) {
      const mesh = new THREE.Mesh(mergeGeometries(list, false), material);
      mesh.name = `${name}:${material.name || 'part'}`;
      group.add(mesh);
    }
    this.bins.clear();
    return group;
  }
}

/** Triangle-list geometry from flat position (and optional uv) arrays, with smooth normals. */
export function meshFrom(positions, indices, uvs) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs || new Float32Array((positions.length / 3) * 2), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
