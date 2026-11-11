/**
 * Exact "does this box touch that mesh" for the canoe tests: every triangle
 * of a piece against a limb's box, by the separating-axis test. A bounding
 * box round a canopy or an outrigger holds the whole cockpit, so boxes
 * against boxes would say everyone is inside everything.
 */
import * as THREE from 'three';

/** A mesh's triangles in world space: nine numbers each, and each one's own box (six numbers) for a quick first look. */
export interface Triangles { corners: Float32Array; boxes: Float32Array; count: number }

/** Every triangle drawn under `root` right now (hidden meshes left out), in world space. Matrices must be up to date. */
export function trianglesOf(root: THREE.Object3D): Triangles {
  const corners: number[] = [];
  const point = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverseVisible((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    const total = index ? index.count : position.count;
    for (let vertex = 0; vertex < total; vertex += 1) {
      point.fromBufferAttribute(position, index ? index.getX(vertex) : vertex).applyMatrix4(mesh.matrixWorld);
      corners.push(point.x, point.y, point.z);
    }
  });
  const count = Math.floor(corners.length / 9);
  const boxes = new Float32Array(count * 6);
  for (let triangle = 0; triangle < count; triangle += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const [a, b, c] = [corners[triangle * 9 + axis], corners[triangle * 9 + 3 + axis], corners[triangle * 9 + 6 + axis]];
      boxes[triangle * 6 + axis] = Math.min(a, b, c);
      boxes[triangle * 6 + 3 + axis] = Math.max(a, b, c);
    }
  }
  return { corners: Float32Array.from(corners), boxes, count };
}

const [v0, v1, v2] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const [e0, e1, e2] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const centre = new THREE.Vector3();
const half = new THREE.Vector3();
const axis = new THREE.Vector3();
const UNITS = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];

/** True when the triangle (already moved so the box's centre is the origin) and the box are apart along this axis. */
function apart(): boolean {
  const [p0, p1, p2] = [v0.dot(axis), v1.dot(axis), v2.dot(axis)];
  const reach = half.x * Math.abs(axis.x) + half.y * Math.abs(axis.y) + half.z * Math.abs(axis.z);
  return Math.min(p0, p1, p2) > reach || Math.max(p0, p1, p2) < -reach;
}

/** Does the box touch any of the triangles? */
export function boxTouchesTriangle(box: THREE.Box3, triangles: Triangles): boolean {
  box.getCenter(centre);
  half.subVectors(box.max, centre);
  const { corners, boxes } = triangles;
  for (let triangle = 0; triangle < triangles.count; triangle += 1) {
    const at = triangle * 6;
    if (boxes[at] > box.max.x || boxes[at + 3] < box.min.x || boxes[at + 1] > box.max.y || boxes[at + 4] < box.min.y || boxes[at + 2] > box.max.z || boxes[at + 5] < box.min.z) continue;
    const from = triangle * 9;
    v0.set(corners[from], corners[from + 1], corners[from + 2]).sub(centre);
    v1.set(corners[from + 3], corners[from + 4], corners[from + 5]).sub(centre);
    v2.set(corners[from + 6], corners[from + 7], corners[from + 8]).sub(centre);
    e0.subVectors(v1, v0);
    e1.subVectors(v2, v1);
    e2.subVectors(v0, v2);
    let separated = false;
    // The triangle's own boxes already overlap the box on x, y and z: nine edge-cross axes and the face normal remain.
    for (const edge of [e0, e1, e2]) {
      for (const unit of UNITS) {
        axis.crossVectors(unit, edge);
        if (axis.lengthSq() > 1e-12 && apart()) {
          separated = true;
          break;
        }
      }
      if (separated) break;
    }
    if (!separated) {
      axis.crossVectors(e0, e1);
      if (axis.lengthSq() < 1e-14 || !apart()) return true;
    }
  }
  return false;
}

/**
 * A mesh as a row of small boxes in world space: its own box cut into slabs along its longest side, each slab
 * shrunk to the vertices in it. One box round a paddle held at a slant, or round a whole torso, is mostly air.
 */
export function slabsOf(mesh: THREE.Mesh, thickness = 0.1): THREE.Box3[] {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const whole = mesh.geometry.boundingBox as THREE.Box3;
  const scale = new THREE.Vector3().setFromMatrixScale(mesh.matrixWorld);
  const size = whole.getSize(new THREE.Vector3()).multiply(scale);
  const long = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
  const count = Math.max(1, Math.ceil(size[long] / thickness));
  const step = (whole.max[long] - whole.min[long]) / count;
  const slabs = Array.from({ length: count }, () => new THREE.Box3());
  const position = mesh.geometry.getAttribute('position');
  const point = new THREE.Vector3();
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    point.fromBufferAttribute(position, vertex);
    const slab = Math.min(count - 1, Math.max(0, Math.floor((point[long] - whole.min[long]) / step)));
    slabs[slab].expandByPoint(point);
  }
  return slabs.map((slab, index) => {
    // A slab no vertex falls in (the middle of a plain cylinder) takes the mesh's full cross-section.
    const box = slab.isEmpty() ? whole.clone() : slab;
    box.min[long] = whole.min[long] + index * step;
    box.max[long] = whole.min[long] + (index + 1) * step;
    return box.applyMatrix4(mesh.matrixWorld);
  });
}
