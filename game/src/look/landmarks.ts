/**
 * Landmarks: the big things that name an island. Each kind is one mesh in
 * B2's hand, built round the origin (ground at y = 0, front toward -z) and
 * placed by the island table. These are simple on purpose: step 2 dresses
 * them. To replace one, call `registerLandmark(kind, build)` before the
 * world view mounts.
 */
import * as THREE from 'three';
import type { LandmarkKind } from '../data/index.ts';
import { KIND } from './b2/detail.js';
import { birch, cabinRoof, pylon, steeple } from './b2/flora.js';
import { Builder, THIN } from './b2/geo.js';
import type { Triple } from './b2/geo.js';
import { PAL } from './b2/palette.js';
import { seededRandom } from './scatter.ts';

export type LandmarkBuilder = (builder: Builder) => void;

const IRON = PAL.iron;
const CONCRETE = '#bcb9b0';
const PEN = { id: THIN, flat: true, kind: KIND.PLAIN } as const;
const EMBER = { glow: 1, flat: true, kind: KIND.PLAIN } as const;

/** A gable roof: two shingled slopes and a ridge board. Ridge along z. */
function gableRoof(builder: Builder, width: number, depth: number, eaves: number, rise: number, tone: string): void {
  const slope = Math.hypot(width / 2, rise);
  const angle = Math.atan2(rise, width / 2);
  for (const side of [-1, 1]) {
    builder.box(slope + 0.3, 0.12, depth + 0.5, tone, { pos: [side * (width / 4), eaves + rise / 2, 0], rot: [0, 0, -side * angle], kind: KIND.SHINGLE, axis: 2 });
  }
  builder.box(0.3, 0.1, depth + 0.6, PAL.rustDark, { pos: [0, eaves + rise + 0.04, 0] });
}

/** A campfire: a ring of stones, crossed logs, one ember. */
function fireRing(builder: Builder): void {
  for (let index = 0; index < 7; index += 1) {
    const angle = (index / 7) * Math.PI * 2;
    builder.sphere(0.13, index % 2 ? '#b3aaa0' : '#a59f9b', { pos: [Math.cos(angle) * 0.42, 0.06, Math.sin(angle) * 0.42], scale: [1.2, 0.7, 1], kind: KIND.STONE }, 6);
  }
  for (const [angle, tone] of [[0.3, PAL.woodDark], [1.5, PAL.bark], [2.6, PAL.woodDark]] as const) {
    builder.beam([Math.cos(angle) * 0.36, 0.05, Math.sin(angle) * 0.36], [-Math.cos(angle) * 0.2, 0.3, -Math.sin(angle) * 0.2], 0.05, tone, { kind: KIND.BARK }, 6);
  }
  builder.cone(0.13, 0.3, '#f0a04a', { pos: [0, 0.2, 0], ...EMBER }, 6);
}

/** A lattice mast: four legs, rings and one diagonal a bay, all bare pen lines. */
function lattice(builder: Builder, height: number, foot: number, top: number, bays: number, tone: string, radius = 0.09): void {
  const leg = (sideX: number, sideZ: number, y: number): Triple => {
    const half = foot + (top - foot) * (y / height);
    return [sideX * half, y, sideZ * half];
  };
  for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) builder.beam(leg(sideX, sideZ, 0), leg(sideX, sideZ, height), radius, tone, PEN, 4);
  for (let bay = 0; bay <= bays; bay += 1) {
    const y = (bay / bays) * height;
    builder.beam(leg(-1, -1, y), leg(1, -1, y), radius * 0.7, tone, PEN, 4);
    builder.beam(leg(-1, 1, y), leg(1, 1, y), radius * 0.7, tone, PEN, 4);
    builder.beam(leg(-1, -1, y), leg(-1, 1, y), radius * 0.7, tone, PEN, 4);
    builder.beam(leg(1, -1, y), leg(1, 1, y), radius * 0.7, tone, PEN, 4);
    if (bay === bays) break;
    const next = ((bay + 1) / bays) * height;
    const turn = bay % 2 ? 1 : -1;
    for (const side of [-1, 1]) {
      builder.beam(leg(-turn, side, y), leg(turn, side, next), radius * 0.55, tone, PEN, 4);
      builder.beam(leg(side, -turn, y), leg(side, turn, next), radius * 0.55, tone, PEN, 4);
    }
  }
}

const BUILDERS: Record<LandmarkKind, LandmarkBuilder> = {
  lean_to: (builder) => {
    for (const side of [-1, 1]) builder.beam([side * 1.2, 0, -0.9], [side * 1.2, 1.6, -0.9], 0.06, PAL.bark, { kind: KIND.BARK }, 6);
    builder.beam([-1.4, 1.58, -0.9], [1.4, 1.58, -0.9], 0.055, PAL.woodDark, {}, 6);
    for (let index = 0; index < 7; index += 1) {
      const x = -1.2 + index * 0.4;
      builder.plank([x, 1.6, -0.9], [x, 0.05, 1], 0.38, 0.05, index % 2 ? '#8a6f55' : '#7c644d', { kind: KIND.BARK });
    }
    builder.box(1.9, 0.12, 0.8, PAL.canvasSage, { pos: [0, 0.08, 0.2], kind: KIND.CLOTH });
  },
  campfire: fireRing,
  stump_bench: (builder) => {
    builder.cyl(0.4, 0.46, 0.55, PAL.bark, { pos: [0, 0.275, 0], kind: KIND.BARK }, 10);
    builder.cyl(0.39, 0.39, 0.03, PAL.woodLight, { pos: [0, 0.56, 0], kind: KIND.WOOD }, 10);
    builder.beam([0.1, 0.58, 0], [0.34, 0.95, 0.08], 0.02, PAL.wood, {}, 5);
    builder.box(0.05, 0.16, 0.1, IRON, { pos: [0.12, 0.62, 0.01], rot: [0, 0, 0.5] });
  },
  cabin_roof: cabinRoof,
  birch_grove: (builder) => {
    const random = seededRandom(52);
    for (let index = 0; index < 9; index += 1) {
      const angle = (index / 9) * Math.PI * 2 + random();
      const reach = 1.5 + random() * 5;
      birch(builder, Math.cos(angle) * reach, 0, Math.sin(angle) * reach, 5.6 + random() * 1.8, random);
    }
  },
  orchard_rows: (builder) => {
    for (const rowZ of [-2.6, 2.6]) {
      for (let index = 0; index < 4; index += 1) {
        const x = -5.2 + index * 3.5;
        builder.beam([x, 0, rowZ], [x + 0.15, 1.5, rowZ], 0.11, PAL.bark, { r2: 0.07, kind: KIND.BARK }, 6);
        builder.sphere(1.15, index % 2 ? PAL.sageDeep : '#7d9a72', { pos: [x + 0.15, 2.2, rowZ], scale: [1.2, 0.85, 1.1], kind: KIND.LEAF }, 9);
        builder.sphere(0.75, PAL.sage, { pos: [x - 0.5, 2.6, rowZ + 0.4], scale: [1.1, 0.8, 1], kind: KIND.LEAF }, 8);
      }
    }
    // A sagging rail fence down one side.
    for (let index = 0; index < 5; index += 1) builder.box(0.1, 0.9, 0.1, PAL.driftwood, { pos: [-6.8 + index * 3.4, 0.45, -4.3], kind: KIND.DRIFT });
    builder.beam([-6.8, 0.7, -4.3], [6.8, 0.62, -4.3], 0.035, PAL.driftwood, { kind: KIND.DRIFT }, 5);
  },
  farmhouse: (builder) => {
    builder.box(8, 3.4, 7, '#e3dcc8', { pos: [0, 1.7, 0], kind: KIND.SIDING, seed: 0.5 });
    gableRoof(builder, 8.6, 7, 3.4, 2.1, '#8f7d6b');
    builder.box(1, 2, 0.12, '#6f5a47', { pos: [-1.6, 1, -3.52], kind: KIND.WOOD });
    for (const x of [0.6, 2.6]) {
      builder.box(1, 1.1, 0.1, '#4c5560', { pos: [x, 1.9, -3.52], flat: true, kind: KIND.PLAIN });
      builder.box(1.2, 0.12, 0.14, PAL.cream, { pos: [x, 1.3, -3.54], kind: KIND.PAINT });
    }
    builder.box(0.8, 2.2, 0.8, '#a9624d', { pos: [2.6, 5.2, 1], kind: KIND.STONE });
    builder.box(8.2, 0.25, 1.6, PAL.driftwood, { pos: [0, 0.2, -4.2], kind: KIND.DRIFT });
  },
  boathouse: (builder) => {
    builder.box(10, 3, 7, '#7f97a3', { pos: [0, 1.5, 0], kind: KIND.SIDING, seed: 0.6 });
    gableRoof(builder, 10.6, 7, 3, 1.3, PAL.tin);
    builder.box(3.6, 2.4, 0.12, '#3d4048', { pos: [0, 1.2, -3.52], flat: true, kind: KIND.PLAIN });
    builder.box(3.9, 0.16, 0.16, PAL.cream, { pos: [0, 2.5, -3.54], kind: KIND.PAINT });
    builder.stencil('BOATS', [1.2, 2.72, -3.56], [-1, 0, 0], [0, 1, 0], 0.4, '#efe6cf');
    builder.torus(0.34, 0.08, '#d2553d', { pos: [3.6, 1.7, -3.56], kind: KIND.PAINT }, 12);
  },
  dock: (builder) => {
    for (let index = 0; index < 10; index += 1) {
      builder.box(0.76, 0.07, 2, index % 2 ? PAL.driftwood : '#c4bbab', { pos: [-3.6 + index * 0.8, 0.42, 0], rot: [0, (index % 3 - 1) * 0.02, 0], kind: KIND.DRIFT, axis: 2 });
    }
    for (const x of [-3.8, -1.3, 1.3, 3.8]) for (const z of [-0.95, 0.95]) builder.cyl(0.09, 0.11, 2.2, PAL.woodDark, { pos: [x, -0.4, z], kind: KIND.BARK }, 6);
    builder.torus(0.16, 0.035, '#d9c79b', { pos: [3.7, 0.5, 0.7], rot: [Math.PI / 2, 0, 0], kind: KIND.ROPE }, 10);
  },
  steeple,
  silo: (builder) => {
    builder.cyl(3, 3, 11, PAL.tin, { pos: [0, 5.5, 0], kind: KIND.METAL }, 16);
    for (const y of [1.4, 4.2, 7, 9.8]) builder.cyl(3.04, 3.04, 0.14, '#8d9496', { pos: [0, y, 0], kind: KIND.METAL }, 16);
    builder.cone(3.1, 2, '#9aa3a4', { pos: [0, 12, 0], kind: KIND.METAL }, 16);
    builder.beam([0.3, 0, -3.02], [0.3, 11, -3.02], 0.03, IRON, PEN, 4);
    builder.beam([-0.3, 0, -3.02], [-0.3, 11, -3.02], 0.03, IRON, PEN, 4);
    for (let rung = 1; rung < 22; rung += 1) builder.beam([-0.3, rung * 0.5, -3.02], [0.3, rung * 0.5, -3.02], 0.02, IRON, PEN, 4);
    builder.box(1.2, 0.5, 0.06, PAL.rust, { pos: [0, 6, -3.03], kind: KIND.PAINT });
  },
  pylon: (builder) => {
    // The footings are drowned: the tower leans a little, but holds.
    builder.base = new THREE.Matrix4().makeRotationZ(0.04);
    pylon(builder);
    builder.base = null;
  },
  scrap_stack: (builder) => {
    const tones = [PAL.rust, PAL.rustDark, '#8f9aa0', PAL.rustLight, '#6b7a84'];
    const boxes: [number, number, number, number, number, number, number][] = [
      [-1.4, 0.6, -0.6, 3, 1.2, 1.7, 0.1], [1.5, 0.55, 0.4, 2.6, 1.1, 1.6, -0.25], [-0.2, 1.75, 0, 2.8, 1.1, 1.6, 0.4],
      [1.9, 1.5, -1.2, 1.4, 0.8, 1.2, 0.8], [-2.2, 1.45, 1, 1.2, 0.5, 2, -0.5],
    ];
    boxes.forEach(([x, y, z, width, height, depth, turn], index) => {
      builder.box(width, height, depth, tones[index % tones.length], { pos: [x, y, z], rot: [0.04 * index, turn, 0.06], kind: KIND.METAL });
    });
    builder.box(2.4, 0.06, 1.3, PAL.tin, { pos: [0.4, 2.36, 0.2], rot: [0.1, 0.5, 0.12], kind: KIND.METAL });
    for (const [x, z] of [[-2.7, -1.6], [2.9, 1.4]]) builder.torus(0.42, 0.16, '#3a3b44', { pos: [x, 0.42, z], rot: [0.2, 0.3, 0], kind: KIND.PLAIN }, 12);
    builder.beam([0.3, 2.3, 0.2], [1.4, 3.6, -0.4], 0.05, IRON, {}, 5);
  },
  crane_arm: (builder) => {
    lattice(builder, 8, 0.5, 0.32, 6, '#c79a34', 0.06);
    builder.beam([0, 7.8, 0], [0, 6.6, -5.2], 0.09, '#c79a34', { kind: KIND.METAL }, 5);
    builder.beam([0, 8.4, 0], [0, 6.6, -5.2], 0.03, IRON, PEN, 4);
    builder.beam([0, 6.6, -5.2], [0, 3.2, -5.2], 0.02, IRON, PEN, 4);
    builder.torus(0.16, 0.04, IRON, { pos: [0, 3.05, -5.2], kind: KIND.METAL }, 8);
    builder.box(1.1, 0.5, 1.1, CONCRETE, { pos: [0, 0.25, 0], kind: KIND.STONE });
  },
  reed_bed: (builder) => {
    const random = seededRandom(61);
    for (let index = 0; index < 90; index += 1) {
      const x = (random() - 0.5) * 9;
      const z = (random() - 0.5) * 6;
      const height = 1.1 + random() * 0.9;
      builder.cone(0.035, height, index % 3 ? '#8c9c68' : '#a3a56c', {
        pos: [x, height * 0.45, z], rot: [0.25 * (random() - 0.5), 0, 0.25 * (random() - 0.5) - 0.08], id: THIN, glow: 0.45, flat: true, kind: KIND.PLAIN,
      }, 4);
      if (index % 4 === 0) builder.cyl(0.04, 0.04, 0.22, '#6b4f3a', { pos: [x - 0.03, height * 0.86, z], id: THIN, glow: 0.3, flat: true, kind: KIND.PLAIN }, 5);
    }
  },
  truss_span: (builder) => {
    builder.box(5, 0.5, 44, '#8a8f93', { pos: [0, 0.25, 0], kind: KIND.METAL, axis: 2 });
    for (const railX of [-0.72, 0.72]) builder.box(0.08, 0.14, 44, IRON, { pos: [railX, 0.57, 0], kind: KIND.METAL, axis: 2 });
    for (let tie = -21; tie <= 21; tie += 2) builder.box(2.4, 0.1, 0.24, PAL.woodDark, { pos: [0, 0.53, tie], flat: true });
    const steel = '#5b666d';
    for (const side of [-1, 1]) {
      const x = side * 2.7;
      builder.beam([x, 0.5, -22], [x, 0.5, 22], 0.16, steel, { kind: KIND.METAL }, 5);
      builder.beam([x, 5, -16.5], [x, 5, 16.5], 0.16, steel, { kind: KIND.METAL }, 5);
      for (let panel = -4; panel <= 4; panel += 1) {
        const z = panel * 5.5;
        if (Math.abs(panel) < 4) builder.beam([x, 0.5, z], [x, 5, z], 0.1, steel, PEN, 4);
        if (panel < 4) {
          const up = panel >= 0;
          const high = Math.abs(panel + (up ? 1 : 0)) >= 4 ? 0.5 : 5;
          const low = Math.abs(panel + (up ? 0 : 1)) >= 4 ? 0.5 : 5;
          builder.beam([x, up ? 0.5 : low, z], [x, up ? high : 0.5, z + 5.5], 0.09, steel, PEN, 4);
        }
      }
    }
    for (const z of [-16.5, -5.5, 5.5, 16.5]) builder.beam([-2.7, 5, z], [2.7, 5, z], 0.1, steel, PEN, 4);
  },
  quarry_cut: (builder) => {
    const tones = ['#b6ada3', '#c9aca0', '#a9a29b'];
    for (let tier = 0; tier < 3; tier += 1) {
      for (let block = 0; block < 4 - tier; block += 1) {
        builder.box(3.3, 2.6, 3.6 - tier * 0.5, tones[(tier + block) % 3], {
          pos: [-5.2 + tier * 1.7 + block * 3.45, 1.3 + tier * 2.6, 0.3 * tier], rot: [0, (block % 2 ? 0.03 : -0.02), 0], kind: KIND.STONE,
        });
      }
    }
    builder.beam([5.8, 0, -1], [4.4, 8.6, -1], 0.12, PAL.woodDark, {}, 6);
    builder.beam([4.4, 8.6, -1], [1.2, 6.2, -1], 0.03, IRON, PEN, 4);
    builder.box(0.9, 0.7, 0.9, PAL.rust, { pos: [5.6, 0.35, -2.2], kind: KIND.METAL });
  },
  fire_tower: (builder) => {
    lattice(builder, 13, 1.5, 1.1, 5, '#7a5a40', 0.1);
    builder.box(3, 0.16, 3, PAL.wood, { pos: [0, 13.1, 0] });
    builder.box(2.6, 2, 2.6, '#8a6f55', { pos: [0, 14.2, 0], kind: KIND.SIDING, seed: 0.35 });
    for (const [x, z, turn] of [[0, -1.32, 0], [0, 1.32, 0], [-1.32, 0, Math.PI / 2], [1.32, 0, Math.PI / 2]]) {
      builder.box(1.8, 0.8, 0.06, '#4c5560', { pos: [x, 14.5, z], rot: [0, turn, 0], flat: true, kind: KIND.PLAIN });
    }
    builder.cone(2.4, 1.3, '#8f7d6b', { pos: [0, 15.85, 0], rot: [0, Math.PI / 4, 0], kind: KIND.SHINGLE }, 4);
    for (let flight = 0; flight < 5; flight += 1) {
      const side = flight % 2 ? 1 : -1;
      builder.plank([-side * 1.2, flight * 2.6, -1.75], [side * 1.2, (flight + 1) * 2.6, -1.75], 0.5, 0.06, PAL.woodLight, { id: THIN, flat: true });
    }
  },
  dam_wall: (builder) => {
    builder.box(5, 2.2, 60, CONCRETE, { pos: [0, 1.1, 0], kind: KIND.STONE });
    builder.box(5.6, 0.3, 60.4, '#cbc7bc', { pos: [0, 2.35, 0], kind: KIND.STONE });
    for (let pier = -27; pier <= 27; pier += 6) {
      builder.box(1.2, 5, 1.6, '#aeaba2', { pos: [3.1, 0, pier], kind: KIND.STONE });
      builder.box(0.08, 1, 0.08, IRON, { pos: [-2.6, 3, pier], flat: true });
    }
    builder.beam([-2.6, 3.5, -30], [-2.6, 3.5, 30], 0.035, IRON, PEN, 4);
    builder.beam([-2.6, 3, -30], [-2.6, 3, 30], 0.03, IRON, PEN, 4);
  },
  gatehouse: (builder) => {
    builder.box(5, 3.6, 5, CONCRETE, { pos: [0, 1.8, 0], kind: KIND.STONE });
    builder.box(5.6, 0.4, 5.6, '#a9a69d', { pos: [0, 3.8, 0], kind: KIND.STONE });
    builder.box(1.1, 2.1, 0.12, '#55656f', { pos: [0, 1.05, -2.52], kind: KIND.METAL });
    for (const x of [-1.6, 1.6]) builder.box(0.5, 1.2, 0.1, '#3d4048', { pos: [x, 2.3, -2.52], flat: true, kind: KIND.PLAIN });
    builder.torus(0.6, 0.07, PAL.rust, { pos: [0, 4.9, 0], rot: [Math.PI / 2, 0, 0], kind: KIND.METAL }, 14);
    builder.cyl(0.07, 0.07, 1.2, IRON, { pos: [0, 4.4, 0], kind: KIND.METAL }, 6);
  },
  radio_tower: (builder) => {
    lattice(builder, 30, 1.5, 0.35, 12, '#a8503e', 0.09);
    for (const y of [10, 20]) builder.box(1.9 - y * 0.04, 0.5, 1.9 - y * 0.04, PAL.cream, { pos: [0, y, 0], kind: KIND.PAINT });
    for (const [x, z] of [[14, 0], [-7, 12], [-7, -12]]) builder.beam([0, 24, 0], [x, 0, z], 0.03, '#5d666c', PEN, 4);
    builder.cyl(0.5, 0.6, 1, PAL.tin, { pos: [0, 30.5, 0], kind: KIND.METAL }, 8);
    builder.cone(0.7, 0.5, IRON, { pos: [0, 31.9, 0], kind: KIND.METAL }, 8);
  },
  keeper_hut: (builder) => {
    builder.box(4, 2.3, 4, '#8a6f55', { pos: [0, 1.15, 0], kind: KIND.SIDING, seed: 0.3 });
    gableRoof(builder, 4.6, 4, 2.3, 1.2, '#857362');
    builder.box(0.9, 1.8, 0.1, '#6f5a47', { pos: [-0.8, 0.9, -2.02], kind: KIND.WOOD });
    builder.box(0.8, 0.7, 0.08, PAL.glow, { pos: [0.9, 1.4, -2.02], glow: 0.6, flat: true, kind: KIND.PLAIN });
    builder.cyl(0.11, 0.11, 1.3, PAL.rust, { pos: [1.2, 3.3, 0.8], kind: KIND.METAL }, 8);
    builder.cone(0.2, 0.16, PAL.rustDark, { pos: [1.2, 4, 0.8], kind: KIND.METAL }, 8);
  },
  bedroll: (builder) => {
    builder.box(0.8, 0.07, 1.8, PAL.slate, { pos: [0, 0.05, 0], rot: [0, 0.1, 0], kind: KIND.CLOTH });
    builder.cyl(0.14, 0.14, 0.76, PAL.cream, { pos: [0, 0.16, -0.72], rot: [0, 0.1, Math.PI / 2], kind: KIND.CLOTH }, 9);
    for (const x of [-0.2, 0.2]) builder.cyl(0.146, 0.146, 0.05, PAL.rust, { pos: [x, 0.16, -0.72 - x * 0.1], rot: [0, 0.1, Math.PI / 2], kind: KIND.PLAIN }, 9);
  },
  forge_hearth: (builder) => {
    builder.box(1.5, 0.7, 1.5, '#a59f9b', { pos: [0, 0.35, 0], kind: KIND.STONE });
    builder.box(1.1, 0.14, 1.1, '#3a3c45', { pos: [0, 0.75, 0], kind: KIND.METAL });
    builder.box(0.5, 0.08, 0.5, '#f0a04a', { pos: [0, 0.84, 0], ...EMBER });
    builder.cone(0.85, 0.8, IRON, { pos: [0, 1.9, 0], rot: [0, Math.PI / 4, 0], kind: KIND.METAL }, 4);
    builder.cyl(0.13, 0.13, 1.5, '#5c5f6a', { pos: [0, 2.9, 0], kind: KIND.METAL }, 8);
    // The anvil on its block.
    builder.cyl(0.24, 0.27, 0.5, PAL.bark, { pos: [1.35, 0.25, -0.3], kind: KIND.BARK }, 8);
    builder.box(0.5, 0.16, 0.2, IRON, { pos: [1.35, 0.6, -0.3], kind: KIND.METAL });
    builder.cone(0.09, 0.3, IRON, { pos: [1.72, 0.6, -0.3], rot: [0, 0, -Math.PI / 2], kind: KIND.METAL }, 6);
  },
};

/** How tall each landmark stands, metres. The Beacon's lamp and the marks use it. */
export const LANDMARK_HEIGHT: Partial<Record<LandmarkKind, number>> = { radio_tower: 32.2, steeple: 22, fire_tower: 16.5, pylon: 28, silo: 13 };

/** Replace how a landmark is drawn. Step 2 calls this with dressed meshes. */
export function registerLandmark(kind: LandmarkKind, build: LandmarkBuilder): void {
  BUILDERS[kind] = build;
  geometries.delete(kind);
}

const geometries = new Map<LandmarkKind, THREE.BufferGeometry>();

/** The shared geometry of a landmark kind. */
export function landmarkGeometry(kind: LandmarkKind): THREE.BufferGeometry {
  let geometry = geometries.get(kind);
  if (!geometry) {
    const builder = new Builder(1200 + Object.keys(BUILDERS).indexOf(kind));
    BUILDERS[kind](builder);
    geometry = builder.geometry();
    geometries.set(kind, geometry);
  }
  return geometry;
}

export function disposeLandmarks(): void {
  for (const geometry of geometries.values()) geometry.dispose();
  geometries.clear();
}

export const LANDMARK_KINDS = Object.keys(BUILDERS) as LandmarkKind[];
export { fireRing };
