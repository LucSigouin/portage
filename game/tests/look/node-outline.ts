/**
 * Where a scavenge spot's drawing stands at body height, in its own frame: the points the rules' circles
 * (`NODE_SOLIDS` in `src/data/footprints.ts`) are fitted to and held to (`tests/look/node-solids.test.ts`).
 *
 * Only what is there while the spot has something to give, or always: a lid thrown aside once a crate is empty is
 * left out. `node-outline-print.ts` prints every outline as a grid.
 */
import * as THREE from 'three';
import { FOOTPRINT_BAND } from '../../src/data/footprints.ts';
import type { NodeTypeId } from '../../src/data/index.ts';
import { nodeGeometry } from '../../src/look/nodes.ts';

const SAMPLE_SPACING = 0.08;

/** Points on a node's drawing between two heights above its foot, every 8 cm: fresh and lasting parts only. */
export function nodeOutline(typeId: NodeTypeId, low: number = FOOTPRINT_BAND.low, high: number = FOOTPRINT_BAND.high): { x: number; z: number }[] {
  const geometry = nodeGeometry(typeId);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const gone = geometry.getAttribute('aGone') as THREE.BufferAttribute;
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  const at = (corner: number): number => (index ? index.getX(corner) : corner);
  const points: { x: number; z: number }[] = [];
  for (let triangle = 0; triangle + 2 < count; triangle += 3) {
    if (gone.getX(at(triangle)) < 0) continue;
    const a = new THREE.Vector3().fromBufferAttribute(position, at(triangle));
    const b = new THREE.Vector3().fromBufferAttribute(position, at(triangle + 1));
    const c = new THREE.Vector3().fromBufferAttribute(position, at(triangle + 2));
    const steps = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / SAMPLE_SPACING));
    for (let i = 0; i <= steps; i += 1) {
      for (let j = 0; i + j <= steps; j += 1) {
        const y = a.y + ((b.y - a.y) * i + (c.y - a.y) * j) / steps;
        if (y < low || y > high) continue;
        points.push({ x: a.x + ((b.x - a.x) * i + (c.x - a.x) * j) / steps, z: a.z + ((b.z - a.z) * i + (c.z - a.z) * j) / steps });
      }
    }
  }
  return points;
}
