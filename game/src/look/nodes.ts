/**
 * Scavenge nodes: the 22 things the player can gather from. Each type is one
 * small mesh in B2's hand, built round the origin with its foot at y = 0,
 * drawn so it can be told from the water before anyone walks up to it.
 *
 * A node has two states in one mesh. Parts drawn inside `stage.fresh(...)`
 * are only there while there is something to take (the berries, the lid, the
 * water in the barrel). Parts inside `stage.spent(...)` only show once it is
 * used up (the open lid, the peeled band). Everything else is always there.
 * The mesh carries this per vertex as `aGone` (1 fresh only, -1 spent only),
 * and world/spent.ts hides the wrong half from the instance's used-up flag.
 * A used-up node is also washed out toward the paper, as before.
 *
 * To replace one, call `registerNode(typeId, build)` before the world view mounts.
 */
import * as THREE from 'three';
import type { NodeTypeId } from '../data/index.ts';
import { KIND } from './b2/detail.js';
import { birch, spruce } from './b2/flora.js';
import { Builder } from './b2/geo.js';
import type { PieceOptions, Triple } from './b2/geo.js';
import { PAL } from './b2/palette.js';
import { seededRandom } from './scatter.ts';
import { PEN, TONE, moved } from './world/kit.ts';

/** Marks the parts of a node that come and go with its loot. */
export interface NodeStage {
  /** Draw parts that are only there while the node has something to give. */
  fresh(draw: () => void): void;
  /** Draw parts that only show once the node is used up. */
  spent(draw: () => void): void;
}

export type NodeBuilder = (builder: Builder, stage: NodeStage) => void;

/** A little of the flat colour shows through shade and mist, so loot pops (B2's rule). */
const LOOT = 0.14;
const loot = (options: PieceOptions = {}): PieceOptions => ({ glow: LOOT, ...options });
const IRON = PAL.iron;
const DOT = { id: 0.93, flat: true, kind: KIND.PLAIN, glow: 0.4 } as const;

/** Dots on a round crown: berries on a bush, apples in a tree. */
function fruit(builder: Builder, random: () => number, centre: Triple, radius: Triple, count: number, size: number, tone: string, lowest = 0.25): void {
  for (let index = 0; index < count; index += 1) {
    const angle = random() * 6.28;
    const tilt = lowest + random() * 1.2;
    builder.sphere(size, tone, {
      pos: [centre[0] + Math.cos(angle) * Math.sin(tilt) * radius[0], centre[1] + Math.cos(tilt) * radius[1], centre[2] + Math.sin(angle) * Math.sin(tilt) * radius[2]], ...DOT,
    }, 6);
  }
}

const BUILDERS: Record<NodeTypeId, NodeBuilder> = {
  /** Bleached logs stacked by the high water. Used up: the one too big to carry, and a few sticks. */
  driftwood_pile: (builder, stage) => {
    builder.beam([-1.2, 0.17, 0.1], [1.25, 0.2, -0.2], 0.19, '#cfc7b6', { r2: 0.13, kind: KIND.DRIFT }, 7);
    builder.beam([0.9, 0.2, -0.2], [1.45, 0.75, -0.55], 0.05, '#cfc7b6', { r2: 0.02, kind: KIND.DRIFT }, 5);
    stage.fresh(() => {
      const tones = ['#ddd5c4', '#e6dfcf', '#d6cebd', '#dbd3c2'];
      const logs: [number, number, number, number, number, number][] = [
        [-0.95, 0.45, 0.85, 0.5, 0.13, 0], [-0.8, -0.5, 0.75, -0.42, 0.12, 0], [-0.6, 0.05, 0.9, 0.2, 0.12, 1],
        [-0.85, 0.3, 0.5, -0.25, 0.1, 1], [-0.35, 0.3, 0.8, -0.1, 0.09, 2], [-0.6, -0.15, 0.3, 0.25, 0.08, 2],
      ];
      logs.forEach(([fromX, fromZ, toX, toZ, radius, layer], index) => {
        const y = 0.3 + layer * 0.2 + radius * 0.3;
        builder.beam([fromX, y, fromZ], [toX, y + 0.05, toZ], radius, tones[index % 4], loot({ r2: radius * 0.7, kind: KIND.DRIFT }), 7);
      });
      builder.beam([0, 0.5, 0.1], [0.35, 1.45, -0.05], 0.045, '#e6dfcf', loot({ r2: 0.018, kind: KIND.DRIFT }), 5);
      builder.beam([0.15, 0.95, 0.03], [0.5, 1.2, 0.2], 0.02, '#e6dfcf', loot({ r2: 0.01, kind: KIND.DRIFT }), 4);
    });
    stage.spent(() => {
      for (const [x, z, turn] of [[-0.3, 0.5, 0.4], [0.4, 0.45, -0.9], [0, -0.5, 1.9]]) builder.beam([x, 0.04, z], [x + Math.cos(turn) * 0.45, 0.05, z + Math.sin(turn) * 0.45], 0.025, '#cfc7b6', { kind: KIND.DRIFT }, 4);
    });
  },

  /** A clump of cattails: tall blades, brown heads. Used up: cut stubble. */
  cattail_stand: (builder, stage) => {
    const random = seededRandom(71);
    const blade = { id: PEN.id, flat: true, kind: KIND.PLAIN } as const;
    for (let index = 0; index < 16; index += 1) {
      const x = (random() - 0.5) * 1;
      const z = (random() - 0.5) * 1;
      const height = 1.3 + random() * 0.7;
      const lean: Triple = [0.24 * (random() - 0.5), 0, 0.24 * (random() - 0.5)];
      builder.cone(0.05, 0.3, index % 3 ? TONE.reed : TONE.reedPale, { pos: [x, 0.13, z], rot: lean, glow: 0.3, ...blade }, 4);
      stage.fresh(() => {
        builder.cone(0.04, height, index % 3 ? TONE.reed : TONE.reedPale, { pos: [x, height * 0.48, z], rot: lean, glow: 0.5, ...blade }, 4);
        if (index % 2 === 0) builder.cyl(0.055, 0.055, 0.28, TONE.cattail, { pos: [x + lean[2] * 0.4, height * 0.9, z - lean[0] * 0.4], glow: 0.4, ...blade }, 6);
      });
    }
  },

  /** Low blueberry scrub on the rock, heavy with berries. Used up: the leaves alone. */
  berry_bush: (builder, stage) => {
    const random = seededRandom(9);
    const blobs = [[0, 0.3, 0, 0.55], [0.55, 0.24, 0.2, 0.42], [-0.5, 0.22, -0.1, 0.45], [0.1, 0.24, -0.5, 0.38], [-0.15, 0.48, 0.15, 0.34]];
    blobs.forEach(([x, y, z, radius], index) => {
      builder.sphere(radius, index % 2 ? '#7f8f63' : '#93a071', { pos: [x, y, z], scale: [1.2, 0.72, 1.1], kind: KIND.LEAF }, 9);
      stage.fresh(() => fruit(builder, random, [x, y, z], [radius * 1.22, radius * 0.74, radius * 1.12], 9, 0.055, '#4a5fa3'));
    });
    builder.beam([0.2, 0.3, 0.1], [0.75, 0.7, 0.35], 0.014, PAL.bark, PEN, 4);
  },

  /** An orchard tree, red with apples. Used up: picked clean. */
  apple_tree: (builder, stage) => {
    const random = seededRandom(13);
    builder.beam([0, -0.2, 0], [0.2, 1.5, 0.1], 0.17, PAL.bark, { r2: 0.11, kind: KIND.BARK }, 7);
    builder.cyl(0.15, 0.18, 0.7, PAL.cream, { pos: [0.05, 0.35, 0.03], flat: true, kind: KIND.PAINT }, 7);
    const crowns = [[0.2, 2.45, 0.1, 1.35], [-0.75, 2.15, 0.4, 0.9], [0.95, 2.25, -0.4, 0.95], [0.1, 3.15, -0.1, 0.9]];
    crowns.forEach(([x, y, z, radius], index) => {
      builder.sphere(radius, index % 2 ? TONE.leaf : PAL.sageDeep, { pos: [x, y, z], scale: [1.15, 0.85, 1.05], kind: KIND.LEAF }, 9);
      stage.fresh(() => fruit(builder, random, [x, y, z], [radius * 1.15, radius * 0.85, radius * 1.05], 7, 0.1, TONE.apple, 0.5));
    });
    stage.fresh(() => {
      for (const [x, z] of [[0.9, 0.7], [-0.6, 0.9], [0.3, -1]]) builder.sphere(0.09, TONE.apple, { pos: [x, 0.07, z], ...DOT }, 6);
    });
  },

  /** A rotting trunk ringed with brown caps. Used up: the log and the stubs. */
  mushroom_log: (builder, stage) => {
    builder.beam([-0.8, 0.2, 0], [0.8, 0.22, 0.1], 0.2, '#6f5a47', { r2: 0.17, kind: KIND.BARK }, 8);
    builder.box(0.7, 0.05, 0.3, PAL.mossDeep, { pos: [0.2, 0.4, 0.04], rot: [0, 0.06, 0], kind: KIND.PLAIN });
    builder.cyl(0.19, 0.19, 0.02, '#8a735c', { pos: [-0.8, 0.2, 0], rot: [0, 0, Math.PI / 2], flat: true, kind: KIND.PLAIN }, 8);
    const caps: [number, number, number, number][] = [[-0.5, 0.42, 0.08, 0.11], [-0.28, 0.44, -0.08, 0.08], [-0.05, 0.36, 0.2, 0.1], [0.3, 0.32, 0.22, 0.12], [0.5, 0.43, -0.03, 0.07], [0.62, 0.3, 0.2, 0.09], [-0.62, 0.3, 0.21, 0.08]];
    for (const [x, y, z, radius] of caps) {
      builder.cyl(0.022, 0.028, 0.08, PAL.cream, { pos: [x, y - 0.03, z], flat: true, kind: KIND.PLAIN }, 5);
      stage.fresh(() => {
        builder.cyl(0.025, 0.03, 0.14, PAL.cream, loot({ pos: [x, y + 0.03, z], flat: true, kind: KIND.PLAIN }), 5);
        builder.sphere(radius, '#b9784a', loot({ pos: [x, y + 0.1, z], scale: [1, 0.55, 1], kind: KIND.PLAIN, glow: 0.25 }), 8);
      });
    }
  },

  /** A white birch, its bark curling off in sheets. Used up: a band peeled to the red inner bark. */
  birch: (builder, stage) => {
    birch(builder, 0, 0, 0, 5.4, seededRandom(17));
    // The trunk leans as it climbs (flora.js): keep the loot on the foot of it, where it stands straight.
    stage.fresh(() => {
      for (const [y, turn] of [[0.9, 0.3], [1.25, 2.4], [1.6, 4.4]]) {
        builder.box(0.26, 0.34, 0.02, PAL.cream, loot({ pos: [Math.cos(turn) * 0.12, y, Math.sin(turn) * 0.12], rot: [0.5, -turn + Math.PI / 2, 0.2], kind: KIND.BIRCH, glow: 0.3 }));
      }
    });
    stage.spent(() => builder.cyl(0.092, 0.095, 0.8, '#b8794e', { pos: [0.01, 1.25, 0.005], flat: true, kind: KIND.PLAIN }, 7));
  },

  /** An old spruce, amber gum beading down its trunk. Used up: scraped scars. */
  spruce: (builder, stage) => {
    spruce(builder, 0, 0, 0, 7.2, seededRandom(19));
    const runs: [number, number, number][] = [[1, 0.4, 0.5], [1.35, 2.6, 0.36], [0.75, 4.3, 0.3], [1.2, 5.4, 0.22]];
    for (const [y, turn, long] of runs) {
      const x = Math.cos(turn) * 0.13;
      const z = Math.sin(turn) * 0.13;
      stage.fresh(() => {
        builder.sphere(0.05, '#e0a43a', { pos: [x, y, z], scale: [1, long * 6, 1], flat: true, kind: KIND.PLAIN, glow: 0.5 }, 6);
        builder.sphere(0.06, '#eab94f', { pos: [x * 1.1, y - long * 0.3, z * 1.1], flat: true, kind: KIND.PLAIN, glow: 0.5 }, 6);
      });
      stage.spent(() => builder.box(0.1, long * 0.9, 0.03, '#c9b08e', { pos: [x * 0.95, y, z * 0.95], rot: [0, -turn + Math.PI / 2, 0], flat: true, kind: KIND.PLAIN }));
    }
  },

  /** Frost-split granite: a hump of bedrock with loose pieces lying on it. Used up: the hump and grit. */
  stone_outcrop: (builder, stage) => {
    builder.sphere(0.9, '#a59f9b', { pos: [0, 0.1, 0], scale: [1.3, 0.55, 1.05], rot: [0.1, 0.4, 0.05], kind: KIND.STONE }, 8);
    builder.box(0.9, 0.5, 0.7, '#9c9692', { pos: [-0.5, 0.25, 0.35], rot: [0.1, 0.5, 0.12], kind: KIND.STONE });
    stage.fresh(() => {
      const pieces: [number, number, number, number, number, string][] = [
        [0.25, 0.72, 0, 0.55, 0.3, '#c9c1b6'], [0.75, 0.42, 0.35, 0.42, 1.2, '#d0b7ab'], [-0.3, 0.68, -0.3, 0.4, 2.2, '#c2bab0'],
        [0.9, 0.16, -0.45, 0.36, 0.7, '#c9c1b6'], [-1, 0.14, -0.3, 0.3, 1.6, '#d0b7ab'], [0.2, 0.18, 0.95, 0.32, 2.9, '#c2bab0'],
      ];
      for (const [x, y, z, size, turn, tone] of pieces) builder.box(size, size * 0.62, size * 0.8, tone, loot({ pos: [x, y, z], rot: [turn * 0.2, turn, 0.25], kind: KIND.STONE }));
    });
    stage.spent(() => {
      for (const [x, z] of [[0.8, 0.4], [-0.9, -0.3], [0.3, 0.95], [0.95, -0.4]]) builder.box(0.12, 0.06, 0.1, '#b3aaa0', { pos: [x, 0.04, z], rot: [0, x * 3, 0], kind: KIND.STONE });
    });
  },

  /** A cut bank with a grey seam of clay in it. Used up: the seam dug out to a dark hollow. */
  clay_bank: (builder, stage) => {
    builder.sphere(1, '#a89a7f', { pos: [0, 0.05, -0.35], scale: [1.35, 0.62, 0.8], kind: KIND.SOIL }, 9);
    builder.box(1.7, 0.1, 0.9, PAL.moss, { pos: [0, 0.62, -0.42], rot: [0.08, 0, 0], kind: KIND.PLAIN });
    stage.fresh(() => {
      builder.box(1.9, 0.5, 0.3, '#9aa5ab', loot({ pos: [0, 0.3, 0.2], rot: [-0.25, 0, 0], kind: KIND.SOIL }));
      for (const [x, z, size] of [[-0.5, 0.62, 0.34], [0.15, 0.7, 0.28], [0.7, 0.58, 0.3]]) builder.sphere(size, '#a7b1b6', loot({ pos: [x, 0.1, z], scale: [1.2, 0.6, 1], kind: KIND.SOIL }), 7);
    });
    stage.spent(() => {
      builder.box(1.5, 0.42, 0.2, '#5f5a55', { pos: [0, 0.27, 0.13], rot: [-0.25, 0, 0], flat: true, kind: KIND.SOIL });
      builder.sphere(0.2, '#9aa5ab', { pos: [0.6, 0.06, 0.6], scale: [1.2, 0.5, 1], kind: KIND.SOIL }, 6);
    });
  },

  /** A washed-up crate, strapped and nailed shut (B2's own). Used up: lid off, empty. */
  crate: (builder, stage) => {
    const width = 0.86;
    const height = 0.62;
    const depth = 0.62;
    const tones = ['#e2a84e', '#eab65b', '#d89b40'];
    moved(builder, new THREE.Matrix4().compose(new THREE.Vector3(0, -0.06, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.07, 0, -0.09)), new THREE.Vector3(1, 1, 1)), () => {
      builder.kind = KIND.WOOD;
      builder.box(width - 0.06, 0.05, depth - 0.06, '#6f5843', { pos: [0, 0.05, 0], flat: true, kind: KIND.PLAIN });
      for (let slat = 0; slat < 3; slat += 1) {
        const y = 0.11 + slat * 0.2;
        builder.box(width, 0.17, 0.035, tones[slat % 3], loot({ pos: [0, y, depth / 2] }));
        builder.box(width, 0.17, 0.035, tones[(slat + 1) % 3], loot({ pos: [0, y, -depth / 2] }));
        builder.box(0.035, 0.17, depth, tones[(slat + 2) % 3], loot({ pos: [width / 2, y, 0] }));
        builder.box(0.035, 0.17, depth, tones[slat % 3], loot({ pos: [-width / 2, y, 0] }));
      }
      for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) builder.box(0.07, height, 0.07, '#c4913f', loot({ pos: [(sideX * width) / 2, height / 2, (sideZ * depth) / 2] }));
      builder.stencil('N.7', [width / 2 + 0.022, 0.2, 0.2], [0, 0, -1], [0, 1, 0], 0.085, '#3d3a3a');
      stage.fresh(() => {
        builder.box(width - 0.06, height - 0.12, depth - 0.06, '#6f5843', { pos: [0, height / 2, 0], flat: true, kind: KIND.PLAIN });
        builder.box(width + 0.05, 0.04, depth * 0.5, tones[1], loot({ pos: [0, height + 0.05, -depth * 0.25] }));
        builder.box(width + 0.05, 0.04, depth * 0.5, tones[0], loot({ pos: [0.03, height + 0.11, depth * 0.27], rot: [-0.28, 0.06, 0] }));
        for (const strap of [-0.3, 0.3]) {
          builder.box(0.05, height + 0.02, depth + 0.05, PAL.rust, loot({ pos: [width * strap, height / 2, 0], kind: KIND.METAL }));
          for (const y of [0.12, 0.5]) builder.bolt(width * strap, y, depth / 2 + 0.03, '#33343c', 0.014, 'z');
        }
        builder.torus(0.09, 0.018, PAL.cream, { pos: [width / 2 + 0.03, 0.47, -0.16], rot: [0, Math.PI / 2, 0], kind: KIND.ROPE }, 10);
      });
      stage.spent(() => {
        builder.box(width + 0.05, 0.04, depth * 0.5, tones[1], { pos: [-0.75, 0.3, 0.05], rot: [0.1, 0.3, 1.15] });
        builder.box(width + 0.05, 0.04, depth * 0.5, tones[0], { pos: [0.2, 0.03, 0.75], rot: [0, 0.5, 0] });
        builder.box(0.05, 0.02, 0.7, PAL.rust, { pos: [0.6, 0.02, 0.4], rot: [0, 0.8, 0], kind: KIND.METAL });
        builder.box(0.5, 0.03, 0.3, '#d9c79b', { pos: [0, 0.09, 0], rot: [0, 0.3, 0], flat: true, kind: KIND.CANE });
      });
      builder.kind = null;
    });
  },

  /**
   * The way into an attic: a little cupola with a window on each face, tall enough to stand through the
   * ridge of the roof the rules put it on. A lamp left burning in it. Used up: dark, a shutter hanging.
   */
  attic: (builder, stage) => {
    builder.box(1.2, 2.9, 1.2, TONE.board, { pos: [0, 1.45, 0], kind: KIND.SIDING, seed: 0.4 });
    builder.cone(1.1, 0.75, TONE.shingleDark, { pos: [0, 3.27, 0], rot: [0, Math.PI / 4, 0], kind: KIND.SHINGLE }, 4);
    builder.box(1.5, 0.08, 1.5, TONE.shingle, { pos: [0, 2.9, 0], kind: KIND.SHINGLE });
    for (const [x, z, turn] of [[0, 0.61, 0], [0, -0.61, Math.PI], [0.61, 0, Math.PI / 2], [-0.61, 0, -Math.PI / 2]] as const) {
      moved(builder, new THREE.Matrix4().makeRotationY(turn).setPosition(x, 2.3, z), () => {
        builder.box(0.72, 0.08, 0.1, PAL.cream, { pos: [0, -0.36, 0.02], kind: KIND.PAINT });
        builder.box(0.72, 0.06, 0.1, PAL.cream, { pos: [0, 0.36, 0.02], kind: KIND.PAINT });
        stage.fresh(() => {
          builder.box(0.6, 0.66, 0.05, PAL.glow, loot({ pos: [0, 0, 0], glow: 0.55, flat: true, kind: KIND.PLAIN }));
          builder.box(0.04, 0.66, 0.07, PAL.cream, { pos: [0, 0, 0.02], kind: KIND.PAINT });
        });
        stage.spent(() => {
          builder.box(0.6, 0.66, 0.05, TONE.glassDark, { pos: [0, 0, 0], flat: true, kind: KIND.PLAIN });
          if (turn === 0) builder.box(0.32, 0.66, 0.04, TONE.boardDark, { pos: [0.5, -0.12, 0.08], rot: [0, 0, -0.35], kind: KIND.WOOD });
        });
      });
    }
  },

  /** A tool shed, door shut on a latch, a box and a coil left outside. Used up: door swung open on the dark. */
  shed: (builder, stage) => {
    builder.box(2.3, 2, 0.12, TONE.boatBlue, { pos: [0, 0.95, -1.09], kind: KIND.SIDING, seed: 0.28 });
    for (const side of [-1, 1]) builder.box(0.12, 2, 2.3, TONE.boatBlue, { pos: [side * 1.09, 0.95, 0], kind: KIND.SIDING, seed: 0.3, axis: 2 });
    builder.box(0.7, 2, 0.12, TONE.boatBlue, { pos: [-0.8, 0.95, 1.09], kind: KIND.SIDING, seed: 0.31 });
    builder.box(0.7, 2, 0.12, TONE.boatBlue, { pos: [0.8, 0.95, 1.09], kind: KIND.SIDING, seed: 0.32 });
    builder.box(0.9, 0.3, 0.12, TONE.boatBlue, { pos: [0, 1.8, 1.09], kind: KIND.SIDING });
    builder.box(2.1, 0.06, 2.1, '#4a4440', { pos: [0, 0.03, 0], flat: true, kind: KIND.PLAIN });
    builder.box(2.7, 0.1, 2.8, PAL.tin, { pos: [0, 2.1, 0], rot: [0.14, 0, 0], kind: KIND.METAL, axis: 2 });
    builder.box(0.5, 0.02, 1.4, PAL.rustLight, { pos: [0.6, 2.16, 0.3], rot: [0.14, 0, 0], flat: true, kind: KIND.PLAIN });
    stage.fresh(() => {
      builder.box(0.9, 1.66, 0.07, TONE.door, loot({ pos: [0, 0.83, 1.12], kind: KIND.WOOD }));
      builder.plank([-0.4, 0.1, 1.17], [0.4, 1.55, 1.17], 0.1, 0.03, '#5a4838', { kind: KIND.WOOD });
      builder.box(0.14, 0.18, 0.06, PAL.ochre, loot({ pos: [0.36, 0.85, 1.17], kind: KIND.METAL, glow: 0.3 }));
      builder.box(0.5, 0.36, 0.4, '#e2a84e', loot({ pos: [1.5, 0.18, 0.7], rot: [0, 0.3, 0], kind: KIND.WOOD }));
      builder.torus(0.2, 0.05, '#d9c79b', loot({ pos: [1.5, 0.42, 0.7], rot: [Math.PI / 2, 0, 0], kind: KIND.ROPE }), 10);
    });
    stage.spent(() => {
      builder.box(0.9, 1.66, 0.07, TONE.door, { pos: [0.75, 0.83, 1.5], rot: [0, 1.25, 0.04], kind: KIND.WOOD });
      builder.box(0.86, 1.6, 0.05, '#2f2d2c', { pos: [0, 0.83, 0.98], flat: true, kind: KIND.PLAIN });
      builder.box(0.9, 0.04, 0.3, '#5a4838', { pos: [0, 1.2, 0.8], kind: KIND.WOOD });
    });
  },

  /** A tangle of what the current dropped: a washer drum, a bedstead, a door, bright bits on top. Used up: the bones of it. */
  junk_heap: (builder, stage) => {
    builder.cyl(0.42, 0.42, 0.7, '#b9b3a2', { pos: [-0.35, 0.36, 0.1], rot: [0.5, 0.3, 1.3], kind: KIND.METAL }, 10);
    builder.cyl(0.3, 0.3, 0.02, '#3d4048', { pos: [-0.66, 0.5, 0.2], rot: [0.5, 0.3, 1.3], flat: true, kind: KIND.PLAIN }, 10);
    for (const z of [-0.5, 0.45]) builder.beam([0.2, 0, z], [0.35, 1.1, z], 0.025, IRON, PEN, 4);
    builder.beam([0.35, 1.1, -0.5], [0.35, 1.1, 0.45], 0.025, IRON, PEN, 4);
    for (const z of [-0.25, 0, 0.22]) builder.beam([0.27, 0.5, z], [0.35, 1.1, z], 0.014, IRON, PEN, 4);
    builder.box(1.3, 0.1, 0.9, PAL.rustDark, { pos: [0.15, 0.08, 0], rot: [0.05, 0.4, 0.04], kind: KIND.METAL });
    stage.fresh(() => {
      builder.box(1, 0.45, 0.7, PAL.rust, loot({ pos: [0.55, 0.33, -0.1], rot: [0.12, 0.2, 0.1], kind: KIND.METAL }));
      builder.box(0.7, 0.05, 1.3, PAL.ochre, loot({ pos: [0.1, 0.75, 0.15], rot: [0.35, 0.7, 0.3], kind: KIND.METAL, glow: 0.25 }));
      builder.torus(0.28, 0.1, TONE.tyre, { pos: [0.75, 0.68, 0.3], rot: [1.1, 0.2, 0.3], kind: KIND.PLAIN }, 10);
      builder.beam([-0.2, 0.6, -0.4], [0.5, 1.5, -0.7], 0.035, IRON, { kind: KIND.METAL }, 5);
      for (const [x, z] of [[-0.9, -0.5], [1.15, 0.6], [-0.2, 0.85]]) builder.cyl(0.06, 0.06, 0.12, PAL.tin, loot({ pos: [x, 0.06, z], rot: [1.2, x, 0], kind: KIND.METAL, glow: 0.3 }), 7);
    });
  },

  /** A skiff stove in on the bank, ribs showing through, its gear still in it. Used up: stripped to the ribs. */
  boat_wreck: (builder, stage) => {
    moved(builder, new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.05, 0, 0.5)).setPosition(0, 0.1, 0), () => {
      const hull = '#e3dccb';
      builder.box(0.14, 0.12, 3.5, PAL.rustDark, { pos: [0, 0, 0], kind: KIND.PAINT, axis: 2 });
      for (let rib = -3; rib <= 3; rib += 1) {
        const half = 0.82 * Math.sqrt(1 - (rib / 4.2) ** 2);
        for (const side of [-1, 1]) builder.beam([0, 0.03, rib * 0.48], [side * half, 0.62, rib * 0.48], 0.03, PAL.woodDark, { kind: KIND.WOOD }, 4);
      }
      // Planking: whole down one side, half gone on the other.
      for (const [side, strakes] of [[-1, 3], [1, 1]] as const) {
        for (let strake = 0; strake < strakes; strake += 1) {
          builder.plank([side * (0.2 + strake * 0.27), 0.05 + strake * 0.22, -1.62], [side * (0.2 + strake * 0.27), 0.05 + strake * 0.22, 1.62], 0.3, 0.03, strake % 2 ? '#d6cebd' : hull, { kind: KIND.PAINT, twist: -side * 0.75 });
        }
      }
      builder.box(1.2, 0.5, 0.05, hull, { pos: [0, 0.36, 1.68], kind: KIND.PAINT });
      builder.beam([0, 0, -1.7], [0, 0.75, -1.95], 0.05, PAL.rustDark, { kind: KIND.PAINT }, 5);
      stage.fresh(() => {
        builder.box(0.3, 0.5, 0.26, '#55656f', loot({ pos: [0, 0.75, 1.85], rot: [0.2, 0, 0], kind: KIND.METAL }));
        builder.beam([0, 0.5, 1.9], [0, -0.1, 2.05], 0.03, IRON, { kind: KIND.METAL }, 5);
        builder.torus(0.2, 0.05, '#d9c79b', loot({ pos: [-0.15, 0.14, 0.3], rot: [Math.PI / 2, 0, 0], kind: KIND.ROPE }), 10);
        builder.box(0.4, 0.22, 0.26, PAL.ochre, loot({ pos: [0.1, 0.17, -0.6], rot: [0, 0.4, 0], kind: KIND.METAL, glow: 0.25 }));
        builder.box(1.1, 0.05, 0.24, PAL.wood, loot({ pos: [0, 0.4, -0.2], kind: KIND.WOOD }));
      });
    });
  },

  /** A seized engine on its skid: housing, flywheel, stack, and copper showing through the open side. Used up: gutted. */
  machinery: (builder, stage) => {
    builder.box(1.7, 0.16, 1.1, IRON, { pos: [0, 0.08, 0], kind: KIND.METAL });
    builder.box(1.3, 0.85, 0.12, PAL.ochre, { pos: [0, 0.6, -0.4], kind: KIND.METAL });
    for (const side of [-1, 1]) builder.box(0.12, 0.85, 0.9, PAL.ochre, { pos: [side * 0.6, 0.6, 0], kind: KIND.METAL });
    builder.box(1.3, 0.1, 0.9, '#c4962f', { pos: [0, 1.06, 0], kind: KIND.METAL });
    builder.cyl(0.4, 0.4, 0.14, IRON, { pos: [-0.74, 0.62, 0], rot: [0, 0, Math.PI / 2], kind: KIND.METAL }, 12);
    builder.cyl(0.1, 0.1, 0.9, '#5c5f6a', { pos: [0.35, 1.5, -0.2], kind: KIND.METAL }, 8);
    builder.cone(0.16, 0.12, '#5c5f6a', { pos: [0.35, 2, -0.2], kind: KIND.METAL }, 8);
    for (const x of [-0.45, 0.45]) builder.bolt(x, 1.12, 0.3, '#2f3038', 0.03);
    builder.box(0.02, 0.5, 0.3, PAL.rustLight, { pos: [0.665, 0.5, 0.1], flat: true, kind: KIND.PLAIN });
    stage.fresh(() => {
      builder.cyl(0.3, 0.3, 0.7, '#c9793f', loot({ pos: [0, 0.6, 0.05], rot: [0, 0, Math.PI / 2], kind: KIND.ROPE, glow: 0.3 }), 10);
      for (const x of [-0.25, 0, 0.25]) builder.torus(0.305, 0.02, '#a85f2e', { pos: [x, 0.6, 0.05], rot: [0, Math.PI / 2, 0], flat: true, kind: KIND.PLAIN }, 10);
      builder.box(0.5, 0.75, 0.06, PAL.ochre, loot({ pos: [-0.38, 0.6, 0.46], kind: KIND.METAL }));
      builder.beam([0.1, 0.3, 0.5], [0.75, 0.1, 0.8], 0.02, '#c9793f', PEN, 4);
    });
    stage.spent(() => {
      builder.box(1, 0.7, 0.05, '#34343a', { pos: [0, 0.6, -0.3], flat: true, kind: KIND.PLAIN });
      builder.box(0.5, 0.75, 0.06, PAL.ochre, { pos: [-0.5, 0.05, 1], rot: [1.5, 0.3, 0], kind: KIND.METAL });
      for (const [x, z] of [[0.5, 0.8], [0.2, 0.95]]) builder.bolt(x, 0.03, z, '#2f3038', 0.03);
    });
  },

  /** A rain barrel under a board spout, brimming. Used up: dry to the bottom. */
  rain_barrel: (builder, stage) => {
    builder.cyl(0.42, 0.37, 1.05, PAL.barrelBlue, loot({ pos: [0, 0.525, 0], kind: KIND.METAL }), 12);
    for (const y of [0.22, 0.84]) builder.cyl(0.43, 0.42, 0.06, '#476579', { pos: [0, y, 0], kind: KIND.METAL }, 12);
    builder.plank([-1.15, 1.75, 0], [-0.2, 1.2, 0], 0.22, 0.03, PAL.driftwood, { kind: KIND.DRIFT });
    builder.beam([-1.1, -0.2, 0.1], [-1.1, 1.72, 0], 0.035, PAL.woodDark, { kind: KIND.BARK }, 5);
    builder.cyl(0.07, 0.06, 0.13, PAL.tin, { pos: [0.6, 0.065, 0.3], kind: KIND.METAL }, 8);
    stage.fresh(() => {
      builder.cyl(0.39, 0.39, 0.02, '#a9c6d2', { pos: [0, 1.02, 0], flat: true, kind: KIND.PLAIN, glow: 0.45 }, 12);
      builder.box(0.3, 0.012, 0.06, PAL.foam, { pos: [0.05, 1.035, -0.1], rot: [0, 0.5, 0], flat: true, kind: KIND.PLAIN, id: PEN.id, glow: 0.6 });
    });
    stage.spent(() => builder.cyl(0.38, 0.38, 0.02, '#2c3a45', { pos: [0, 0.6, 0], flat: true, kind: KIND.PLAIN }, 12));
  },

  /** A raised bed gone wild: rows of greens, red among them. Used up: bare soil, holes, a few stalks. */
  garden_bed: (builder, stage) => {
    for (const z of [-0.65, 0.65]) builder.box(2.2, 0.3, 0.06, '#a17d55', { pos: [0, 0.15, z], kind: KIND.WOOD });
    for (const x of [-1.1, 1.1]) builder.box(0.06, 0.3, 1.3, '#96714b', { pos: [x, 0.15, 0], kind: KIND.WOOD });
    builder.box(2.1, 0.06, 1.2, '#5d4b3f', { pos: [0, 0.22, 0], flat: true, kind: KIND.SOIL });
    builder.beam([-1.1, 0, -0.65], [-1.1, 1.1, -0.65], 0.025, PAL.woodDark, { kind: KIND.WOOD }, 4);
    builder.box(0.3, 0.2, 0.02, PAL.cream, { pos: [-1.1, 0.95, -0.63], kind: KIND.PAINT });
    const random = seededRandom(23);
    for (let plant = 0; plant < 10; plant += 1) {
      const x = -0.85 + (plant % 5) * 0.42;
      const z = plant < 5 ? -0.3 : 0.3;
      stage.fresh(() => {
        builder.sphere(0.17 + random() * 0.05, plant % 2 ? PAL.sage : TONE.leaf, loot({ pos: [x, 0.36, z], scale: [1, 0.8, 1], kind: KIND.LEAF }), 7);
        builder.cone(0.06, 0.34, PAL.sageDeep, loot({ pos: [x + 0.05, 0.52, z], kind: KIND.LEAF }), 5);
        if (plant % 3 === 0) fruit(builder, random, [x, 0.36, z], [0.22, 0.17, 0.22], 4, 0.045, TONE.berry);
      });
      stage.spent(() => {
        builder.cyl(0.09, 0.07, 0.02, '#3f332b', { pos: [x, 0.255, z], flat: true, kind: KIND.PLAIN }, 7);
        if (plant % 4 === 1) builder.beam([x, 0.25, z], [x + 0.04, 0.45, z + 0.03], 0.012, '#8c9c68', PEN, 4);
      });
    }
  },

  /** A fishing place: a rod propped in forked sticks, a creel, the catch strung between two stakes. Used up: a bare string. */
  fishing_spot: (builder, stage) => {
    for (const x of [-0.6, 0.6]) builder.beam([x, -0.3, 0.3], [x, 1.25, 0.3], 0.035, PAL.driftwood, { kind: KIND.DRIFT }, 5);
    builder.beam([-0.6, 1.15, 0.3], [0.6, 1.15, 0.3], 0.008, '#7d7466', PEN, 4);
    for (const [x, tall] of [[-0.2, 0.5], [0.15, 0.75]] as const) {
      builder.beam([x, -0.2, -0.5 - tall * 0.4], [x, tall, -0.5 - tall * 0.4], 0.025, PAL.woodDark, { kind: KIND.BARK }, 5);
      builder.beam([x, tall, -0.5 - tall * 0.4], [x + 0.1, tall + 0.14, -0.5 - tall * 0.4], 0.016, PAL.woodDark, { kind: KIND.BARK }, 4);
    }
    builder.beam([-0.22, 0.42, -0.6], [0.5, 1.75, -2.3], 0.016, PAL.woodLight, { r2: 0.006, kind: KIND.WOOD }, 5);
    builder.beam([0.5, 1.75, -2.3], [0.52, 0.2, -2.6], 0.004, '#7d7466', PEN, 4);
    builder.cyl(0.2, 0.17, 0.26, PAL.wood, { pos: [0.75, 0.13, -0.3], kind: KIND.CANE }, 9);
    builder.cyl(0.21, 0.21, 0.03, PAL.woodDark, { pos: [0.75, 0.275, -0.3], kind: KIND.CANE }, 9);
    stage.fresh(() => {
      for (const [x, long] of [[-0.3, 0.34], [0, 0.42], [0.3, 0.3]]) {
        builder.sphere(0.09, '#b9c4c4', loot({ pos: [x, 1.13 - long / 2, 0.3], scale: [0.55, long * 5.4, 1], kind: KIND.PLAIN, glow: 0.3 }), 7);
        builder.cone(0.07, 0.1, '#8fa0a3', loot({ pos: [x, 1.1 - long - 0.03, 0.3], scale: [0.4, 1, 1], kind: KIND.PLAIN }), 4);
        builder.box(0.02, long * 0.6, 0.12, '#6f8a5d', { pos: [x - 0.035, 1.14 - long / 2, 0.3], flat: true, kind: KIND.PLAIN });
      }
      builder.sphere(0.05, PAL.rust, loot({ pos: [0.52, 0.2, -2.6], kind: KIND.PLAIN, glow: 0.4 }), 6);
    });
  },

  /** A faded float over a wreck: orange and cream, a staff with a rag of flag. Used up: the float alone, its line cut. */
  wreck_buoy: (builder, stage) => {
    builder.sphere(0.48, '#e2742a', loot({ pos: [0, 0.14, 0], scale: [1, 0.85, 1], kind: KIND.PAINT }), 10);
    builder.cyl(0.49, 0.49, 0.1, PAL.cream, { pos: [0, 0.16, 0], kind: KIND.PAINT }, 12);
    builder.beam([0, 0.45, 0], [0.08, 1.7, 0], 0.028, IRON, { kind: KIND.METAL }, 5);
    stage.fresh(() => {
      builder.box(0.42, 0.28, 0.02, PAL.rust, loot({ pos: [0.3, 1.52, 0], rot: [0, 0, -0.08], kind: KIND.CLOTH, glow: 0.3 }));
      builder.sphere(0.08, PAL.ochre, loot({ pos: [0.085, 1.74, 0], kind: KIND.PLAIN, glow: 0.4 }), 6);
      builder.torus(0.14, 0.03, '#d9c79b', { pos: [0, 0.52, 0], rot: [Math.PI / 2, 0, 0], kind: KIND.ROPE }, 8);
    });
    stage.spent(() => builder.beam([0.08, 1.5, 0], [0.2, 1.3, 0.05], 0.01, PAL.rust, PEN, 4));
  },

  /** Green glass, corked, paper inside. Used up: uncorked and empty. */
  message_bottle: (builder, stage) => {
    const glass = '#8fc3a0';
    builder.cyl(0.09, 0.1, 0.3, glass, loot({ pos: [0, 0.12, 0], rot: [0, 0, 1.1], glow: 0.35, kind: KIND.PLAIN }), 8);
    builder.cyl(0.035, 0.05, 0.14, glass, loot({ pos: [0.19, 0.22, 0], rot: [0, 0, 1.1], glow: 0.35, kind: KIND.PLAIN }), 6);
    stage.fresh(() => {
      builder.cyl(0.03, 0.03, 0.05, '#b28b5e', { pos: [0.27, 0.26, 0], rot: [0, 0, 1.1], flat: true, kind: KIND.PLAIN }, 6);
      builder.cyl(0.045, 0.045, 0.2, PAL.cream, { pos: [-0.01, 0.115, 0], rot: [0, 0, 1.1], flat: true, kind: KIND.PLAIN, glow: 0.6, id: PEN.id }, 6);
    });
    stage.spent(() => builder.cyl(0.03, 0.03, 0.05, '#b28b5e', { pos: [0.38, 0.03, 0.12], rot: [1.2, 0, 0.4], flat: true, kind: KIND.PLAIN }, 6));
  },

  /** A footlocker put away carefully: strapped, locked, wrapped in oilcloth. Used up: lid thrown back, empty. */
  cache: (builder, stage) => {
    builder.box(0.9, 0.42, 0.55, PAL.ochre, loot({ pos: [0, 0.21, 0], kind: KIND.PAINT }));
    for (const x of [-0.3, 0.3]) builder.box(0.07, 0.44, 0.58, IRON, { pos: [x, 0.22, 0], kind: KIND.METAL });
    stage.fresh(() => {
      builder.cyl(0.275, 0.275, 0.9, '#c9982f', loot({ pos: [0, 0.42, 0], rot: [0, 0, Math.PI / 2], kind: KIND.PAINT }), 10);
      for (const x of [-0.3, 0.3]) builder.cyl(0.285, 0.285, 0.07, IRON, { pos: [x, 0.42, 0], rot: [0, 0, Math.PI / 2], kind: KIND.METAL }, 10);
      builder.box(0.1, 0.13, 0.04, IRON, { pos: [0, 0.38, 0.29], kind: KIND.METAL });
      builder.box(1.05, 0.03, 0.5, PAL.canvasSage, { pos: [0.02, 0.7, -0.03], rot: [0.12, 0.2, 0.03], kind: KIND.CLOTH });
    });
    stage.spent(() => {
      builder.box(0.9, 0.05, 0.55, '#c9982f', { pos: [0, 0.66, -0.36], rot: [-1.35, 0, 0], kind: KIND.PAINT });
      builder.box(0.8, 0.02, 0.45, '#3a342c', { pos: [0, 0.425, 0], flat: true, kind: KIND.PLAIN });
      builder.box(0.7, 0.03, 0.5, PAL.canvasSage, { pos: [0.7, 0.03, 0.4], rot: [0, 0.6, 0], kind: KIND.CLOTH });
    });
  },

  /** The Beacon's lamp, at the foot of the tower: a great lens in a brass cage on an iron drum, waiting. */
  beacon_lamp: (builder, stage) => {
    builder.cyl(0.55, 0.65, 0.35, IRON, { pos: [0, 0.17, 0], kind: KIND.METAL }, 10);
    builder.cyl(0.42, 0.42, 0.75, '#cfd8d6', loot({ pos: [0, 0.72, 0], glow: 0.3, kind: KIND.PLAIN }), 10);
    for (const y of [0.55, 0.72, 0.9]) builder.torus(0.43, 0.012, '#b28b3e', { pos: [0, y, 0], rot: [Math.PI / 2, 0, 0], flat: true, kind: KIND.PLAIN, id: PEN.id }, 10);
    builder.cone(0.62, 0.36, PAL.tin, { pos: [0, 1.27, 0], kind: KIND.METAL }, 10);
    builder.sphere(0.07, '#b28b3e', { pos: [0, 1.48, 0], kind: KIND.METAL }, 6);
    for (let bar = 0; bar < 6; bar += 1) {
      const angle = (bar / 6) * Math.PI * 2;
      builder.beam([Math.cos(angle) * 0.46, 0.34, Math.sin(angle) * 0.46], [Math.cos(angle) * 0.46, 1.1, Math.sin(angle) * 0.46], 0.016, '#b28b3e', PEN, 4);
    }
    stage.fresh(() => {
      builder.beam([0.55, 0.3, 0], [0.9, 0.3, 0], 0.02, IRON, { kind: KIND.METAL }, 5);
      builder.beam([0.9, 0.3, 0], [0.9, 0.52, 0], 0.025, PAL.wood, loot({ kind: KIND.WOOD }), 5);
    });
  },
};

/** How far above its foot each node's loot mark floats, metres. */
export const NODE_MARK_HEIGHT: Record<NodeTypeId, number> = {
  driftwood_pile: 1.7, cattail_stand: 2.3, berry_bush: 1.2, apple_tree: 4.6, mushroom_log: 1, birch: 3.2, spruce: 3.6, stone_outcrop: 1.5,
  clay_bank: 1.2, crate: 1.2, attic: 3.9, shed: 2.9, junk_heap: 1.9, boat_wreck: 1.6, machinery: 2.4, rain_barrel: 2.1, garden_bed: 1.4,
  fishing_spot: 2.1, wreck_buoy: 2.2, message_bottle: 0.8, cache: 1.2, beacon_lamp: 1.9,
};

/** Replace how a node type is drawn. */
export function registerNode(typeId: NodeTypeId, build: NodeBuilder): void {
  BUILDERS[typeId] = build;
  geometries.get(typeId)?.dispose();
  geometries.delete(typeId);
}

const geometries = new Map<NodeTypeId, THREE.BufferGeometry>();

/** Build a node's mesh, marking each vertex with when it shows (`aGone`: 0 always, 1 fresh only, -1 used up only). */
function build(typeId: NodeTypeId): THREE.BufferGeometry {
  const builder = new Builder(1500 + Object.keys(BUILDERS).indexOf(typeId));
  const vertices = (): number => (builder as unknown as { p: number[] }).p.length / 3;
  const spans: [number, number, number][] = [];
  const mark = (value: number) => (draw: () => void): void => {
    const from = vertices();
    draw();
    spans.push([from, vertices(), value]);
  };
  BUILDERS[typeId](builder, { fresh: mark(1), spent: mark(-1) });
  const geometry = builder.geometry();
  const gone = new Float32Array(geometry.getAttribute('position').count);
  for (const [from, to, value] of spans) gone.fill(value, from, to);
  geometry.setAttribute('aGone', new THREE.BufferAttribute(gone, 1));
  return geometry;
}

/** The shared geometry of a node type. */
export function nodeGeometry(typeId: NodeTypeId): THREE.BufferGeometry {
  let geometry = geometries.get(typeId);
  if (!geometry) {
    geometry = build(typeId);
    geometries.set(typeId, geometry);
  }
  return geometry;
}

export function disposeNodes(): void {
  for (const geometry of geometries.values()) geometry.dispose();
  geometries.clear();
}

export const NODE_TYPE_IDS = Object.keys(BUILDERS) as NodeTypeId[];
