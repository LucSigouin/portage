/**
 * What the patched hull wears that the leaky one does not, where it shows from the paddling camera: birch bark
 * folded over the rails and laid over the bow deck, every piece run round with black pitch and whipped down with
 * cord. The hull's own drawing (b2/canoe.js) patches the planking, low on the sides: from astern that is hidden,
 * and the two old hulls read as one. Authored in the hull's own space: bow toward +z, keel at y = 0.
 */
import * as THREE from 'three';
import type { HullShape } from '../b2/canoe.js';
import { nextId } from '../b2/geo.js';
import { Builder, KIND, THIN } from './kit.ts';
import type { Triple } from './kit.ts';

// The patched hull's own bark, pitch and cord (b2/canoe.js).
const BARK = '#ece5d2';
const PITCH = '#2e2b2d';
const CORD = '#d9c79b';

/**
 * Where a lap of bark is folded over a rail: the side (+1 is +x), where along the hull, how long. None lies where
 * the lone paddler's blade crosses the rail, nor on the splinted stretch of the -x rail.
 */
export const BARK_LAPS: readonly (readonly [side: -1 | 1, z: number, length: number])[] = [
  [1, -0.42, 0.36], [1, 0.82, 0.4], [-1, -0.3, 0.4], [-1, 1.22, 0.36],
];

export function buildMends(shape: HullShape): THREE.Mesh {
  const b = new Builder(29);
  for (const [side, z, length] of BARK_LAPS) {
    const rail = (at: number): Triple => [side * shape.halfBeamAt(at), shape.sheerAt(at), at];
    const [x, y] = rail(z);
    // the lap turns and rises with the rail it lies on
    const yaw = Math.atan2(rail(z + 0.1)[0] - rail(z - 0.1)[0], 0.2);
    const rise = -Math.atan2(rail(z + 0.1)[1] - rail(z - 0.1)[1], 0.2);
    const rot: Triple = [rise, yaw, 0];
    const id = b.box(0.1, 0.01, length, BARK, { pos: [x - side * 0.004, y + 0.037, z], rot, kind: KIND.BIRCH });
    b.box(0.01, 0.12, length - 0.03, BARK, { pos: [x + side * 0.041, y - 0.024, z], rot, id, kind: KIND.BIRCH });
    b.box(0.01, 0.065, length - 0.03, BARK, { pos: [x - side * 0.049, y + 0.004, z], rot, id, kind: KIND.BIRCH });
    for (const end of [-1, 1]) {
      const edge = rail(z + end * (length / 2));
      b.box(0.106, 0.008, 0.02, PITCH, { pos: [edge[0] - side * 0.004, edge[1] + 0.041, edge[2]], rot, id: THIN, flat: true, kind: KIND.PLAIN });
      const tie = rail(z + end * (length / 2 - 0.085));
      b.torus(0.049, 0.008, CORD, { pos: [tie[0], tie[1] + 0.006, tie[2]], rot: [0, yaw, 0], id: 0.71, kind: KIND.ROPE }, 8);
    }
  }
  // a sheet of bark over the +x half of the bow deck, pitched down along its three edges
  const sheet: THREE.Vector3[][] = [];
  const lift = 0.009;
  for (const share of [0.8, 0.86, 0.92]) {
    const z = share * shape.HL;
    const [half, y] = [shape.halfBeamAt(z), shape.sheerAt(z) + 0.012];
    sheet.push([new THREE.Vector3(0.02, y + 0.02 + lift, z), new THREE.Vector3(half - 0.035, y + lift + 0.004, z)]);
  }
  const sheetId = nextId();
  b.grid(sheet, () => BARK, () => sheetId, { kind: () => KIND.BIRCH });
  const run = (from: THREE.Vector3, to: THREE.Vector3): void => {
    b.beam([from.x, from.y + 0.004, from.z], [to.x, to.y + 0.004, to.z], 0.011, PITCH, { id: THIN, flat: true, kind: KIND.PLAIN }, 5);
  };
  run(sheet[0][0], sheet[2][0]);
  run(sheet[0][0], sheet[0][1]);
  run(sheet[2][0], sheet[2][1]);
  return b.mesh();
}
