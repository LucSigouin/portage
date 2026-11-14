/**
 * Luc, from the live game: "you can still walk through some things, like the fishing, the water container". The
 * scavenge spots that are hard and stand above the shin are solid now, as circles the rules keep (`NODE_SOLIDS` in
 * `src/data/footprints.ts`). The rules cannot read the look, so these tests hold the circles to what is drawn: a
 * barrel you can see is a barrel you bump into, where it is drawn and turned the way it is drawn.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FOOTPRINT_BAND, NODE_SOLIDS } from '../../src/data/footprints.ts';
import { NODES, TUNING } from '../../src/data/index.ts';
import type { NodeTypeId } from '../../src/data/index.ts';
import { hashText as rulesHash, nodeSolids, nodeYaw, terrainHeight } from '../../src/sim/index.ts';
import { NODE_TYPE_IDS, nodeGeometry } from '../../src/look/nodes.ts';
import { instancedMesh } from '../../src/look/props.ts';
import { hashText as lookHash } from '../../src/look/scatter.ts';
import worldViewSource from '../../src/look/world-view.ts?raw';
import { nodeOutline } from './node-outline.ts';

/** A drawn point this far outside every circle could be walked through in plain sight: a walker's own half-width. */
const MARGIN = TUNING.foot.bodyRadius;

/** Walked through on purpose: plants a walker pushes through, a bottle lying flat, a buoy afloat. Luc's call. */
const WALKED_THROUGH: readonly NodeTypeId[] = ['cattail_stand', 'berry_bush', 'wreck_buoy', 'message_bottle'];

/** Trees are solid by the trunk, as the wild ones are: the crown and the boughs are overhead. The trunk is what stands this near the middle, up to this height. */
const TREES: readonly NodeTypeId[] = ['apple_tree', 'birch', 'spruce'];
const TRUNK = { reach: 0.6, high: 1 } as const;

/** Small things left out by name, by starting the band above them. Each is only there while the spot is full. */
const STEPPED_OVER: Partial<Record<NodeTypeId, { low: number; what: string }>> = {
  shed: { low: 0.5, what: 'the box and the coil of rope left beside the door, 0.36 to 0.47 m high' },
};

/** What a spot's drawing has standing in a walker's way, in its own frame. */
function standing(typeId: NodeTypeId): { x: number; z: number }[] {
  if (TREES.includes(typeId)) return nodeOutline(typeId, FOOTPRINT_BAND.low, TRUNK.high).filter((point) => Math.hypot(point.x, point.z) <= TRUNK.reach);
  return nodeOutline(typeId, STEPPED_OVER[typeId]?.low ?? FOOTPRINT_BAND.low, FOOTPRINT_BAND.high);
}

const solidTypes = NODE_TYPE_IDS.filter((typeId) => NODE_SOLIDS[typeId].length > 0);

describe('the rules hold every hard scavenge spot by circles fitted to its drawing', () => {
  it('has a line for every kind of spot, and walks through only the soft, the flat and the floating', () => {
    expect(Object.keys(NODE_SOLIDS).sort()).toEqual([...NODE_TYPE_IDS].sort());
    expect(NODE_TYPE_IDS.filter((typeId) => NODE_SOLIDS[typeId].length === 0).sort()).toEqual([...WALKED_THROUGH].sort());
    // The bottle lies under the shin: nothing of it is in a walker's way at all.
    expect(nodeOutline('message_bottle')).toHaveLength(0);
  });

  it.each(solidTypes)('%s: everything drawn at body height is in a circle, or within a body\'s half-width of one', (typeId) => {
    const points = standing(typeId);
    expect(points.length, 'has something at body height').toBeGreaterThan(50);
    let worst = -Infinity;
    for (const point of points) {
      worst = Math.max(worst, Math.min(...NODE_SOLIDS[typeId].map(([x, z, radius]) => Math.hypot(point.x - x, point.z - z) - radius)));
    }
    expect(worst, 'the farthest any drawn point stands outside the circles, metres').toBeLessThan(MARGIN);
  });

  it.each(solidTypes)('%s: every circle has something drawn in it', (typeId) => {
    const points = standing(typeId);
    for (const [x, z, radius] of NODE_SOLIDS[typeId]) {
      expect(points.some((point) => Math.hypot(point.x - x, point.z - z) <= radius), `circle at ${x}, ${z}`).toBe(true);
    }
  });

  it.each(solidTypes)('%s: no circle is much wider than what it holds', (typeId) => {
    // The whole set reaches no farther from the spot's middle than the drawing does, a body's half-width to spare.
    // (A tree's circle takes in its low boughs, as a wild spruce's does: for a tree, the whole drawing at body height.)
    const drawn = Math.max(...(TREES.includes(typeId) ? nodeOutline(typeId) : standing(typeId)).map((point) => Math.hypot(point.x, point.z)));
    const held = Math.max(...NODE_SOLIDS[typeId].map(([x, z, radius]) => Math.hypot(x, z) + radius));
    expect(held).toBeLessThan(drawn + MARGIN);
  });
});

describe('the rules stand each spot\'s circles where the look draws the spot', () => {
  it('turns a spot by the look\'s own rule', () => {
    // The look turns each spot inside `buildIsland`, where no test can call it: its line is read from the file.
    expect(worldViewSource).toContain('yaw: (hashText(node.id) % 628) / 100,');
    for (const node of NODES) {
      expect(rulesHash(node.id)).toBe(lookHash(node.id));
      expect(nodeYaw(node.id)).toBe((lookHash(node.id) % 628) / 100);
    }
  });

  it.each(solidTypes)('%s: the first one placed has its drawing inside its circles, in the world', (typeId) => {
    const node = NODES.find((candidate) => candidate.typeId === typeId && candidate.reach === 'foot')!;
    expect(node, 'one is placed').toBeDefined();
    // The instance as the world view makes it: the look's own matrix.
    const mesh = instancedMesh(nodeGeometry(typeId), [{
      x: node.position.x, y: Math.max(0, terrainHeight(node.position.x, node.position.z)), z: node.position.z, yaw: (lookHash(node.id) % 628) / 100, scale: 1,
    }], 1);
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(0, matrix);
    const circles = nodeSolids(node);
    expect(circles).toHaveLength(NODE_SOLIDS[typeId].length);
    let worst = -Infinity;
    for (const point of standing(typeId)) {
      const world = new THREE.Vector3(point.x, 0, point.z).applyMatrix4(matrix);
      worst = Math.max(worst, Math.min(...circles.map((circle) => Math.hypot(world.x - circle.x, world.z - circle.z) - circle.radius)));
    }
    expect(worst).toBeLessThan(MARGIN);
  });

  it('leaves a spot reached from the canoe alone: it is afloat', () => {
    for (const node of NODES.filter((candidate) => candidate.reach === 'canoe')) expect(nodeSolids(node), node.id).toEqual([]);
  });
});
