/**
 * Scavenge nodes: the 22 things the player can gather from. Each type is one
 * small mesh in B2's hand, built round the origin with its foot at y = 0.
 * Loot carries a little glow, so it shows through shade and mist; a used-up
 * node is washed out toward the paper (the shader's `aInst.y`).
 *
 * To replace one, call `registerNode(typeId, build)` before the world view mounts.
 */
import * as THREE from 'three';
import type { NodeTypeId } from '../data/index.ts';
import { KIND } from './b2/detail.js';
import { birch, spruce } from './b2/flora.js';
import { Builder, THIN } from './b2/geo.js';
import type { PieceOptions } from './b2/geo.js';
import { PAL } from './b2/palette.js';
import { seededRandom } from './scatter.ts';

export type NodeBuilder = (builder: Builder) => void;

/** A little of the flat colour shows through shade and mist, so loot pops (B2's rule). */
const LOOT = 0.14;
const loot = (options: PieceOptions = {}): PieceOptions => ({ glow: LOOT, ...options });
const IRON = PAL.iron;

const BUILDERS: Record<NodeTypeId, NodeBuilder> = {
  driftwood_pile: (builder) => {
    const tones = ['#ddd5c4', '#e6dfcf', '#cfc7b6', '#dbd3c2'];
    const logs: [number, number, number, number, number, number][] = [
      [-0.85, 0, 0.8, 0.18, 0.15, 0], [-0.65, 0.28, 0.9, -0.18, 0.12, 0], [-0.45, -0.25, 0.65, 0.38, 0.13, 0],
      [-0.9, 0.42, 0.4, 0.1, 0.11, 1], [-0.25, 0.12, 1, 0.48, 0.09, 1], [-0.1, -0.35, -0.55, 0.5, 0.08, 2],
    ];
    logs.forEach(([fromX, fromZ, toX, toZ, radius, layer], index) => {
      const y = radius + layer * 0.17;
      builder.beam([fromX, y, fromZ], [toX, y + (layer ? 0.08 : 0), toZ], radius, tones[index % 4], loot({ r2: radius * 0.7, kind: KIND.DRIFT }), 7);
    });
    builder.beam([0.1, 0.2, 0.05], [0.4, 1.2, -0.1], 0.045, '#e6dfcf', loot({ r2: 0.018, kind: KIND.DRIFT }), 5);
  },
  cattail_stand: (builder) => {
    const random = seededRandom(71);
    for (let index = 0; index < 12; index += 1) {
      const x = (random() - 0.5) * 0.7;
      const z = (random() - 0.5) * 0.7;
      const height = 1.1 + random() * 0.5;
      builder.cone(0.03, height, index % 3 ? '#8c9c68' : '#a3a56c', { pos: [x, height * 0.45, z], rot: [0.2 * (random() - 0.5), 0, 0.2 * (random() - 0.5)], id: THIN, glow: 0.5, flat: true, kind: KIND.PLAIN }, 4);
      if (index % 2 === 0) builder.cyl(0.045, 0.045, 0.24, '#6b4f3a', { pos: [x, height * 0.88, z], id: THIN, glow: 0.4, flat: true, kind: KIND.PLAIN }, 5);
    }
  },
  berry_bush: (builder) => {
    const random = seededRandom(9);
    const blobs = [[0, 0.42, 0, 0.62], [0.5, 0.33, 0.2, 0.45], [-0.48, 0.3, -0.1, 0.48], [0.1, 0.36, -0.45, 0.4], [-0.1, 0.7, 0.1, 0.38]];
    blobs.forEach(([x, y, z, radius], index) => {
      builder.sphere(radius, index % 2 ? PAL.sageDeep : '#7d9a72', { pos: [x, y, z], scale: [1.15, 0.85, 1.05], kind: KIND.LEAF }, 9);
      for (let berry = 0; berry < 6; berry += 1) {
        const angle = random() * 6.28;
        const tilt = 0.25 + random();
        builder.sphere(0.06, '#d8402a', {
          pos: [x + Math.cos(angle) * Math.sin(tilt) * radius * 1.17, y + Math.cos(tilt) * radius * 0.87, z + Math.sin(angle) * Math.sin(tilt) * radius * 1.07],
          id: 0.93, flat: true, kind: KIND.PLAIN, glow: 0.4,
        }, 6);
      }
    });
  },
  apple_tree: (builder) => {
    const random = seededRandom(13);
    builder.beam([0, 0, 0], [0.2, 1.7, 0.1], 0.16, PAL.bark, { r2: 0.1, kind: KIND.BARK }, 7);
    const crowns = [[0.2, 2.5, 0.1, 1.3], [-0.7, 2.2, 0.4, 0.9], [0.9, 2.3, -0.4, 0.95], [0.1, 3.2, -0.1, 0.9]];
    crowns.forEach(([x, y, z, radius], index) => {
      builder.sphere(radius, index % 2 ? '#7d9a72' : PAL.sageDeep, { pos: [x, y, z], scale: [1.15, 0.85, 1.05], kind: KIND.LEAF }, 9);
      for (let apple = 0; apple < 5; apple += 1) {
        const angle = random() * 6.28;
        const tilt = 0.5 + random() * 1.4;
        builder.sphere(0.09, '#c64732', {
          pos: [x + Math.cos(angle) * Math.sin(tilt) * radius * 1.14, y + Math.cos(tilt) * radius * 0.84, z + Math.sin(angle) * Math.sin(tilt) * radius * 1.04],
          id: 0.93, flat: true, kind: KIND.PLAIN, glow: 0.4,
        }, 6);
      }
    });
  },
  mushroom_log: (builder) => {
    builder.beam([-0.65, 0.17, 0], [0.65, 0.19, 0.08], 0.17, '#6f5a47', { r2: 0.15, kind: KIND.BARK }, 8);
    for (const [x, y, z, radius] of [[-0.35, 0.36, 0.05, 0.09], [-0.12, 0.38, -0.06, 0.07], [0.15, 0.37, 0.07, 0.1], [0.4, 0.36, 0, 0.06]]) {
      builder.cyl(0.02, 0.025, 0.1, PAL.cream, loot({ pos: [x, y - 0.05, z], flat: true, kind: KIND.PLAIN }), 5);
      builder.sphere(radius, '#e9c98f', loot({ pos: [x, y, z], scale: [1, 0.55, 1], kind: KIND.PLAIN }), 8);
    }
  },
  birch: (builder) => birch(builder, 0, 0, 0, 5.4, seededRandom(17)),
  spruce: (builder) => spruce(builder, 0, 0, 0, 6.2, seededRandom(19)),
  stone_outcrop: (builder) => {
    for (const [x, z, radius, tone] of [[0, 0, 0.62, '#b9b0a2'], [0.6, 0.3, 0.38, '#c2a79c'], [-0.5, 0.35, 0.34, '#a59f9b'], [0.1, -0.55, 0.3, '#b3aaa0']] as const) {
      builder.sphere(radius, tone, loot({ pos: [x, radius * 0.45, z], scale: [1.2, 0.8, 1], rot: [0.2, x * 2, 0.1], kind: KIND.STONE }), 7);
    }
  },
  clay_bank: (builder) => {
    builder.sphere(0.8, '#c0714a', loot({ pos: [0, 0.1, 0], scale: [1.1, 0.4, 0.8], kind: KIND.SOIL }), 9);
    builder.sphere(0.5, '#b0623f', loot({ pos: [0.45, 0.14, 0.2], scale: [1, 0.4, 0.8], kind: KIND.SOIL }), 8);
    builder.box(0.5, 0.05, 0.3, '#d08a63', loot({ pos: [-0.2, 0.42, -0.05], rot: [0.1, 0.4, 0], kind: KIND.SOIL }));
  },
  crate: (builder) => {
    const width = 0.86;
    const height = 0.62;
    const depth = 0.62;
    const tones = ['#e2a84e', '#eab65b', '#d89b40'];
    builder.base = new THREE.Matrix4().compose(new THREE.Vector3(0, -0.06, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.07, 0, -0.09)), new THREE.Vector3(1, 1, 1));
    builder.kind = KIND.WOOD;
    builder.box(width - 0.06, height - 0.06, depth - 0.06, '#6f5843', { pos: [0, height / 2, 0], flat: true, kind: KIND.PLAIN });
    for (let slat = 0; slat < 3; slat += 1) {
      const y = 0.11 + slat * 0.2;
      builder.box(width, 0.17, 0.035, tones[slat % 3], loot({ pos: [0, y, depth / 2] }));
      builder.box(width, 0.17, 0.035, tones[(slat + 1) % 3], loot({ pos: [0, y, -depth / 2] }));
      builder.box(0.035, 0.17, depth, tones[(slat + 2) % 3], loot({ pos: [width / 2, y, 0] }));
      builder.box(0.035, 0.17, depth, tones[slat % 3], loot({ pos: [-width / 2, y, 0] }));
    }
    for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) builder.box(0.07, height, 0.07, '#c4913f', loot({ pos: [(sideX * width) / 2, height / 2, (sideZ * depth) / 2] }));
    builder.box(width + 0.05, 0.04, depth * 0.5, tones[1], loot({ pos: [0, height + 0.05, -depth * 0.25] }));
    builder.box(width + 0.05, 0.04, depth * 0.5, tones[0], loot({ pos: [0.03, height + 0.11, depth * 0.27], rot: [-0.28, 0.06, 0] }));
    for (const strap of [-0.3, 0.3]) {
      builder.box(0.05, height + 0.02, depth + 0.05, PAL.rust, loot({ pos: [width * strap, height / 2, 0], kind: KIND.METAL }));
      for (const y of [0.12, 0.5]) builder.bolt(width * strap, y, depth / 2 + 0.03, '#33343c', 0.014, 'z');
    }
    builder.stencil('N.7', [width / 2 + 0.022, 0.2, 0.2], [0, 0, -1], [0, 1, 0], 0.085, '#3d3a3a');
    builder.torus(0.09, 0.018, PAL.cream, { pos: [width / 2 + 0.03, 0.47, -0.16], rot: [0, Math.PI / 2, 0], kind: KIND.ROPE }, 10);
    builder.kind = null;
    builder.base = null;
  },
  attic: (builder) => {
    // The peak of a drowned roof, with a broken window to climb in by.
    const angle = Math.atan2(1, 0.9);
    for (const side of [-1, 1]) builder.box(1.4, 0.07, 1.7, side > 0 ? '#9c8974' : '#8f7d6b', { pos: [side * 0.45, 0.5, 0], rot: [0, 0, -side * angle], kind: KIND.SHINGLE, axis: 2 });
    builder.box(0.2, 0.08, 1.8, PAL.rustDark, { pos: [0, 1.02, 0] });
    builder.box(0.5, 0.5, 0.06, PAL.glow, loot({ pos: [0, 0.48, 0.86], glow: 0.35, flat: true, kind: KIND.PLAIN }));
    builder.box(0.6, 0.06, 0.08, PAL.cream, { pos: [0, 0.2, 0.88], kind: KIND.PAINT });
  },
  shed: (builder) => {
    builder.box(2.2, 1.7, 2.2, '#7f97a3', { pos: [0, 0.85, 0], kind: KIND.SIDING, seed: 0.28 });
    builder.box(2.6, 0.1, 2.6, PAL.tin, { pos: [0, 1.82, 0], rot: [0.12, 0, 0], kind: KIND.METAL });
    builder.box(0.8, 1.4, 0.08, '#6f5a47', loot({ pos: [0.2, 0.7, 1.12], rot: [0, 0.35, 0], kind: KIND.WOOD }));
    builder.box(0.12, 0.16, 0.06, PAL.ochre, loot({ pos: [-0.25, 0.8, 1.13], kind: KIND.METAL }));
  },
  junk_heap: (builder) => {
    const tones = [PAL.rust, '#8f9aa0', PAL.rustDark, PAL.ochre];
    for (const [x, y, z, width, height, depth, turn] of [[0, 0.3, 0, 1.3, 0.6, 0.9, 0.2], [0.5, 0.75, 0.2, 0.7, 0.4, 0.6, -0.5], [-0.55, 0.25, 0.4, 0.6, 0.5, 0.5, 0.9]]) {
      builder.box(width, height, depth, tones[Math.round(x * 2 + 2) % 4], loot({ pos: [x, y, z], rot: [0.1, turn, 0.08], kind: KIND.METAL }));
    }
    builder.torus(0.28, 0.1, '#3a3b44', { pos: [-0.3, 0.72, -0.25], rot: [0.9, 0.2, 0], kind: KIND.PLAIN }, 10);
    builder.beam([0.2, 0.5, -0.3], [0.9, 1.3, -0.5], 0.035, IRON, {}, 5);
  },
  boat_wreck: (builder) => {
    // A skiff, keel up.
    builder.sphere(1, '#e3dccb', loot({ pos: [0, 0.05, 0], scale: [0.6, 0.55, 1.6], kind: KIND.PAINT }), 12);
    builder.box(0.07, 0.1, 2.9, PAL.rustDark, { pos: [0, 0.58, 0], kind: KIND.PAINT, axis: 2 });
    builder.box(0.5, 0.4, 0.04, '#3d4048', { pos: [0.3, 0.3, 0.9], rot: [0, 0.5, 0.3], flat: true, kind: KIND.PLAIN });
  },
  machinery: (builder) => {
    builder.box(1.3, 0.8, 0.9, PAL.ochre, loot({ pos: [0, 0.55, 0], kind: KIND.METAL }));
    builder.box(1.5, 0.16, 1.1, IRON, { pos: [0, 0.08, 0], kind: KIND.METAL });
    builder.cyl(0.36, 0.36, 0.14, IRON, { pos: [0.2, 0.7, 0.52], rot: [Math.PI / 2, 0, 0], kind: KIND.METAL }, 12);
    builder.cyl(0.11, 0.11, 0.8, '#5c5f6a', { pos: [-0.4, 1.3, -0.2], kind: KIND.METAL }, 8);
    for (const x of [-0.45, 0.45]) builder.bolt(x, 0.97, 0.3, '#2f3038', 0.03);
    builder.beam([0.55, 0.9, -0.2], [0.95, 1.4, -0.2], 0.03, PAL.rust, {}, 5);
  },
  rain_barrel: (builder) => {
    builder.cyl(0.4, 0.36, 1, PAL.barrelBlue, loot({ pos: [0, 0.5, 0], kind: KIND.METAL }), 12);
    for (const y of [0.2, 0.8]) builder.cyl(0.41, 0.41, 0.06, '#476579', { pos: [0, y, 0], kind: KIND.METAL }, 12);
    builder.cyl(0.35, 0.35, 0.02, '#86a5b3', { pos: [0, 0.97, 0], flat: true, kind: KIND.PLAIN }, 12);
  },
  garden_bed: (builder) => {
    for (const z of [-0.6, 0.6]) builder.box(2, 0.26, 0.05, '#a17d55', { pos: [0, 0.13, z] });
    for (const x of [-1, 1]) builder.box(0.05, 0.26, 1.2, '#96714b', { pos: [x, 0.13, 0] });
    builder.box(1.9, 0.05, 1.1, '#5d4b3f', { pos: [0, 0.2, 0], flat: true, kind: KIND.SOIL });
    for (let sprout = 0; sprout < 8; sprout += 1) {
      builder.cone(0.07, 0.3 + (sprout % 3) * 0.06, sprout % 2 ? PAL.sage : '#7d9a72', loot({ pos: [-0.8 + (sprout % 4) * 0.52, 0.36, sprout < 4 ? -0.28 : 0.28], kind: KIND.LEAF }), 6);
    }
  },
  fishing_spot: (builder) => {
    // Three stakes and a set line, where the fish lie.
    for (const [x, z, height] of [[-0.7, 0.2, 1.3], [0.6, -0.3, 1.1], [0.1, 0.8, 0.9]]) builder.beam([x, -0.5, z], [x + 0.05, height, z], 0.04, PAL.driftwood, { kind: KIND.DRIFT }, 5);
    builder.beam([-0.65, 1.2, 0.2], [0.65, 1, -0.3], 0.008, '#7d7466', { id: THIN, flat: true, kind: KIND.PLAIN }, 4);
    builder.sphere(0.09, PAL.cream, loot({ pos: [0, 0.5, 0.1], kind: KIND.PLAIN }), 8);
    builder.sphere(0.092, PAL.rust, loot({ pos: [0, 0.54, 0.1], scale: [1, 0.6, 1], kind: KIND.PLAIN }), 8);
    builder.beam([0, 1.1, -0.05], [0, 0.56, 0.1], 0.006, '#7d7466', { id: THIN, flat: true, kind: KIND.PLAIN }, 4);
  },
  wreck_buoy: (builder) => {
    builder.sphere(0.45, '#e2742a', loot({ pos: [0, 0.12, 0], scale: [1, 0.85, 1], kind: KIND.PAINT }), 10);
    builder.cyl(0.46, 0.46, 0.1, PAL.cream, { pos: [0, 0.14, 0], kind: KIND.PAINT }, 12);
    builder.beam([0, 0.4, 0], [0.06, 1.3, 0], 0.025, IRON, {}, 5);
    builder.box(0.3, 0.2, 0.02, PAL.rust, loot({ pos: [0.2, 1.18, 0], kind: KIND.CLOTH }));
  },
  message_bottle: (builder) => {
    builder.cyl(0.09, 0.1, 0.3, '#8fc3a0', loot({ pos: [0, 0.12, 0], rot: [0, 0, 1.1], glow: 0.35, kind: KIND.PLAIN }), 8);
    builder.cyl(0.035, 0.05, 0.14, '#8fc3a0', loot({ pos: [0.19, 0.22, 0], rot: [0, 0, 1.1], glow: 0.35, kind: KIND.PLAIN }), 6);
    builder.cyl(0.03, 0.03, 0.05, '#b28b5e', { pos: [0.27, 0.26, 0], rot: [0, 0, 1.1], flat: true, kind: KIND.PLAIN }, 6);
  },
  cache: (builder) => {
    builder.box(0.8, 0.45, 0.55, PAL.ochre, loot({ pos: [0, 0.23, 0], kind: KIND.PAINT }));
    builder.cyl(0.275, 0.275, 0.8, '#c9982f', loot({ pos: [0, 0.45, 0], rot: [0, 0, Math.PI / 2], kind: KIND.PAINT }), 10);
    for (const x of [-0.26, 0.26]) builder.box(0.07, 0.5, 0.58, IRON, { pos: [x, 0.25, 0], kind: KIND.METAL });
    builder.box(0.1, 0.12, 0.04, IRON, { pos: [0, 0.4, 0.29], kind: KIND.METAL });
  },
  beacon_lamp: (builder) => {
    builder.cyl(0.5, 0.6, 0.3, IRON, { pos: [0, 0.15, 0], kind: KIND.METAL }, 10);
    builder.cyl(0.42, 0.42, 0.7, '#cfd8d6', loot({ pos: [0, 0.65, 0], glow: 0.3, kind: KIND.PLAIN }), 10);
    builder.cone(0.6, 0.35, PAL.tin, { pos: [0, 1.17, 0], kind: KIND.METAL }, 10);
    for (let bar = 0; bar < 6; bar += 1) {
      const angle = (bar / 6) * Math.PI * 2;
      builder.beam([Math.cos(angle) * 0.44, 0.3, Math.sin(angle) * 0.44], [Math.cos(angle) * 0.44, 1, Math.sin(angle) * 0.44], 0.015, IRON, { id: THIN, flat: true }, 4);
    }
  },
};

/** How far above its foot each node's loot mark floats, metres. */
export const NODE_MARK_HEIGHT: Record<NodeTypeId, number> = {
  driftwood_pile: 1.5, cattail_stand: 2, berry_bush: 1.5, apple_tree: 4.6, mushroom_log: 0.9, birch: 3.2, spruce: 3.4, stone_outcrop: 1.4,
  clay_bank: 1, crate: 1.2, attic: 1.6, shed: 2.5, junk_heap: 1.7, boat_wreck: 1.2, machinery: 2.1, rain_barrel: 1.5, garden_bed: 1,
  fishing_spot: 1.8, wreck_buoy: 1.9, message_bottle: 0.8, cache: 1.2, beacon_lamp: 1.9,
};

/** Replace how a node type is drawn. */
export function registerNode(typeId: NodeTypeId, build: NodeBuilder): void {
  BUILDERS[typeId] = build;
  geometries.delete(typeId);
}

const geometries = new Map<NodeTypeId, THREE.BufferGeometry>();

/** The shared geometry of a node type. */
export function nodeGeometry(typeId: NodeTypeId): THREE.BufferGeometry {
  let geometry = geometries.get(typeId);
  if (!geometry) {
    const builder = new Builder(1500 + Object.keys(BUILDERS).indexOf(typeId));
    BUILDERS[typeId](builder);
    geometry = builder.geometry();
    geometries.set(typeId, geometry);
  }
  return geometry;
}

export function disposeNodes(): void {
  for (const geometry of geometries.values()) geometry.dispose();
  geometries.clear();
}

export const NODE_TYPE_IDS = Object.keys(BUILDERS) as NodeTypeId[];
