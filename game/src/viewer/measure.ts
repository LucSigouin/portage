/**
 * How big a built thing is and what it costs to draw: its box in metres, its triangles and its draw calls. Only
 * what is visible counts, and a scavenge node counts only the half its state shows (its `aGone` marks).
 */
import * as THREE from 'three';

export interface Measure {
  box: THREE.Box3;
  triangles: number;
  drawCalls: number;
}

const corner = new THREE.Vector3();
const point = new THREE.Vector3();
const instance = new THREE.Matrix4();
const place = new THREE.Matrix4();

function expandByBox(box: THREE.Box3, local: THREE.Box3, matrix: THREE.Matrix4): void {
  for (let index = 0; index < 8; index += 1) {
    corner.set(index & 1 ? local.max.x : local.min.x, index & 2 ? local.max.y : local.min.y, index & 4 ? local.max.z : local.min.z).applyMatrix4(matrix);
    box.expandByPoint(corner);
  }
}

/** The vertices a node's state hides: `aGone` is 1 for a part that is only there fresh, -1 for one only there used up. */
function hiddenBy(mesh: THREE.Mesh): ((vertex: number) => boolean) | null {
  const gone = mesh.geometry.getAttribute('aInst') && mesh.geometry.getAttribute('aGone');
  if (!gone) return null;
  const used = (mesh.geometry.getAttribute('aInst') as THREE.BufferAttribute).getY(0) > 0.5;
  return (vertex) => gone.getX(vertex) * (used ? 1 : -1) > 0;
}

export function measure(root: THREE.Object3D): Measure {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  let triangles = 0;
  let drawCalls = 0;
  root.traverseVisible((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry;
    const positions = geometry.getAttribute('position');
    if (!positions) return;
    const instanced = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh) : null;
    const copies = instanced ? instanced.count : 1;
    drawCalls += 1;
    const hidden = hiddenBy(mesh);
    const index = geometry.index;
    const corners = index ? index.count : positions.count;
    let drawn = corners / 3;
    if (hidden) {
      drawn = 0;
      for (let at = 0; at < corners; at += 3) {
        const [first, second, third] = [0, 1, 2].map((step) => (index ? index.getX(at + step) : at + step));
        if (!hidden(first) && !hidden(second) && !hidden(third)) drawn += 1;
      }
    }
    triangles += drawn * copies;
    if (instanced) {
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      for (let copy = 0; copy < copies; copy += 1) {
        instanced.getMatrixAt(copy, instance);
        expandByBox(box, geometry.boundingBox as THREE.Box3, place.multiplyMatrices(mesh.matrixWorld, instance));
      }
    } else {
      // Exact: every vertex, in the world. A turned limb's own box would say it is bigger than it is.
      for (let vertex = 0; vertex < positions.count; vertex += 1) {
        if (hidden?.(vertex)) continue;
        box.expandByPoint(point.fromBufferAttribute(positions, vertex).applyMatrix4(mesh.matrixWorld));
      }
    }
  });
  return { box, triangles: Math.round(triangles), drawCalls };
}
