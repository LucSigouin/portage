/**
 * The prop library and its instancing. A few variants of each tree, bush,
 * boulder and reed clump are built once with B2's builders, then drawn as
 * instances at the places scatter.ts chose. Each island gets three groups so
 * world-view.ts can cull by distance: `near` (full trees), `far` (a few
 * strokes each) and `detail` (small things only seen close).
 *
 * To add a prop: add its kind to scatter.ts, a builder to `PROP_BUILDERS`, and
 * a rule that places it.
 */
import * as THREE from 'three';
import { KIND } from './b2/detail.js';
import { birch, spruce, whitePine } from './b2/flora.js';
import { Builder, THIN } from './b2/geo.js';
import { PAL, inkMaterial } from './b2/palette.js';
import { VALLEY_NORTH_SHORE_Z, VALLEY_SOUTH_SHORE_Z } from '../data/index.ts';
import { terrainHeight, valleyHalfWidth } from '../sim/index.ts';
import { VARIANTS, seededRandom } from './scatter.ts';
import type { FloraKind, Placement } from './scatter.ts';

type PropBuilder = (builder: Builder, variant: number, random: () => number) => void;

const BLADE = { id: THIN, glow: 0.45, flat: true, kind: KIND.PLAIN } as const;

/** One variant of each kind, built round the origin with its foot at y = 0. */
export const PROP_BUILDERS: Record<FloraKind, PropBuilder> = {
  spruce: (builder, variant, random) => spruce(builder, 0, 0, 0, 5.5 + variant * 1.5, random),
  pine: (builder, variant, random) => whitePine(builder, 0, 0, 0, 11 + variant * 2, random),
  birch: (builder, variant, random) => birch(builder, 0, 0, 0, 5.6 + variant * 0.8, random),
  scrub: (builder, variant, random) => {
    const radius = 0.5 + variant * 0.25 + random() * 0.15;
    builder.sphere(radius, variant ? PAL.sage : PAL.sageDeep, { pos: [0, radius * 0.35, 0], scale: [1.35, 0.7, 1.1], kind: KIND.LEAF }, 8);
    builder.sphere(radius * 0.7, PAL.sage, { pos: [radius * 0.8, radius * 0.25, 0.2], scale: [1.2, 0.7, 1], kind: KIND.LEAF }, 8);
  },
  boulder: (builder, variant, random) => {
    const radius = 0.34 + variant * 0.16;
    const tone = ['#b3aaa0', '#c2a79c', '#a59f9b'][variant];
    builder.sphere(radius, tone, { pos: [0, radius * 0.22, 0], scale: [1.25, 0.72, 1], rot: [random() * 0.4, random() * 3, random() * 0.3], kind: KIND.STONE }, 7);
    if (variant > 0) builder.sphere(radius * 0.5, tone, { pos: [radius * 1.1, radius * 0.1, radius * 0.5], scale: [1.2, 0.7, 1], rot: [0, random() * 3, 0], kind: KIND.STONE }, 6);
  },
  reed: (builder, variant, random) => {
    // A clump standing in the shallows: bare pen strokes, a cattail head on every fourth.
    const blades = 10 + variant * 4;
    for (let index = 0; index < blades; index += 1) {
      const x = (random() - 0.5) * 2.4;
      const z = (random() - 0.5) * 1.5;
      const height = 1 + random() * 0.75;
      builder.cone(0.03, height, index % 3 ? '#8c9c68' : '#a3a56c', {
        pos: [x, height * 0.45, z], rot: [0.28 * (random() - 0.5), 0, 0.28 * (random() - 0.5) - 0.08], ...BLADE,
      }, 4);
      if (index % 4 === 0) builder.cyl(0.035, 0.035, 0.2, '#6b4f3a', { pos: [x - 0.03, height * 0.86, z], id: THIN, glow: 0.3, flat: true, kind: KIND.PLAIN }, 5);
    }
  },
  sedge: (builder, variant, random) => {
    const tone = variant ? '#7f9a70' : '#98a86f';
    for (let index = 0; index < 5; index += 1) {
      const height = 0.24 + random() * 0.3;
      builder.cone(0.03, height, index % 2 ? tone : '#8ba173', {
        pos: [(random() - 0.5) * 0.22, height * 0.45 - 0.04, (random() - 0.5) * 0.22], rot: [0.6 * (random() - 0.5), 0, 0.6 * (random() - 0.5) - 0.08], ...BLADE,
      }, 4);
    }
  },
};

/** Trees far away: a trunk and three or four strokes, one mesh for every variant. */
const FAR_BUILDERS: Partial<Record<FloraKind, (builder: Builder) => void>> = {
  spruce: (builder) => {
    builder.cyl(0.04, 0.13, 7.4, PAL.bark, { pos: [0, 3.7, 0], kind: KIND.BARK }, 5);
    for (let tier = 0; tier < 4; tier += 1) {
      const share = tier / 3;
      builder.cone(1.55 - share * 1.05, 2.5, tier % 2 ? PAL.pineDark : PAL.pine, { pos: [0, 2.4 + share * 4.3, 0], kind: KIND.NEEDLE }, 7);
    }
  },
  pine: (builder) => {
    builder.cyl(0.05, 0.16, 12, PAL.bark, { pos: [-0.4, 6, 0], rot: [0, 0, 0.06], kind: KIND.BARK }, 5);
    for (const [x, y, radius] of [[-1.5, 6.4, 1.7], [0.6, 8, 1.9], [-1.4, 9.6, 1.5], [-0.5, 11.4, 1.1]]) {
      builder.cone(radius, 0.9, y > 9 ? PAL.pine : PAL.pineDark, { pos: [x, y, 0], scale: [1.25, 0.8, 0.9], kind: KIND.NEEDLE }, 7);
    }
  },
  birch: (builder) => {
    builder.cyl(0.06, 0.09, 6, PAL.birch, { pos: [0.2, 3, 0], rot: [0, 0, -0.06], flat: true, kind: KIND.BIRCH }, 5);
    builder.sphere(1.25, PAL.ochre, { pos: [0.5, 5.3, 0.1], scale: [1.25, 0.9, 1.1], kind: KIND.LEAF }, 6);
    builder.sphere(0.95, PAL.ochreLight, { pos: [-0.3, 6.1, -0.2], scale: [1.2, 0.8, 1.1], kind: KIND.LEAF }, 6);
  },
};

let library: Record<FloraKind, THREE.BufferGeometry[]> | null = null;
let farLibrary: Partial<Record<FloraKind, THREE.BufferGeometry>> | null = null;

function propLibrary(): Record<FloraKind, THREE.BufferGeometry[]> {
  if (library) return library;
  const built = {} as Record<FloraKind, THREE.BufferGeometry[]>;
  (Object.keys(PROP_BUILDERS) as FloraKind[]).forEach((kind, kindIndex) => {
    built[kind] = Array.from({ length: VARIANTS[kind] }, (_, variant) => {
      const builder = new Builder(300 + kindIndex * 17 + variant);
      PROP_BUILDERS[kind](builder, variant, seededRandom(9000 + kindIndex * 31 + variant));
      return builder.geometry();
    });
  });
  library = built;
  return built;
}

function farPropLibrary(): Partial<Record<FloraKind, THREE.BufferGeometry>> {
  if (farLibrary) return farLibrary;
  const built: Partial<Record<FloraKind, THREE.BufferGeometry>> = {};
  (Object.keys(FAR_BUILDERS) as FloraKind[]).forEach((kind, index) => {
    const builder = new Builder(700 + index);
    FAR_BUILDERS[kind]?.(builder);
    built[kind] = builder.geometry();
  });
  farLibrary = built;
  return built;
}

export function disposePropLibrary(): void {
  for (const geometries of Object.values(library ?? {})) for (const geometry of geometries) geometry.dispose();
  for (const geometry of Object.values(farLibrary ?? {})) geometry.dispose();
  library = null;
  farLibrary = null;
}

const SHARED_ATTRIBUTES = ['position', 'normal', 'aColor', 'aInfo', 'aTex'];
const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Where one instance goes. */
export interface InstanceTransform { x: number; y: number; z: number; yaw: number; scale: number }

/**
 * Draw one geometry many times. Each instance gets its own ink ids (so two
 * neighbours never merge into one outline) and its own stretch of the wash
 * noise. `spent` in `aInst.y` washes an instance out: nodes.ts uses it for
 * used-up loot.
 */
export function instancedMesh(source: THREE.BufferGeometry, transforms: readonly InstanceTransform[], seed: number): THREE.InstancedMesh {
  // The big vertex buffers are shared; only the per-instance attribute is this mesh's own.
  const geometry = new THREE.BufferGeometry();
  for (const name of SHARED_ATTRIBUTES) geometry.setAttribute(name, source.getAttribute(name));
  geometry.boundingSphere = source.boundingSphere;
  const random = seededRandom(seed);
  const perInstance = new Float32Array(transforms.length * 4);
  const mesh = new THREE.InstancedMesh(geometry, inkMaterial, transforms.length);
  transforms.forEach((transform, index) => {
    position.set(transform.x, transform.y, transform.z);
    quaternion.setFromAxisAngle(UP, transform.yaw);
    scale.setScalar(transform.scale);
    mesh.setMatrixAt(index, matrix.compose(position, quaternion, scale));
    perInstance[index * 4] = 0.02 + random() * 0.96;
    perInstance[index * 4 + 2] = random() * 8;
  });
  geometry.setAttribute('aInst', new THREE.InstancedBufferAttribute(perInstance, 4));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.matrixAutoUpdate = false;
  return mesh;
}

export interface IslandProps {
  /** Full trees. */
  near: THREE.Group;
  /** The same trees as a few strokes each. */
  far: THREE.Group;
  /** Scrub, boulders, reeds and sedge. */
  detail: THREE.Group;
  counts: Record<FloraKind, number>;
}

const TREES: FloraKind[] = ['spruce', 'pine', 'birch'];

/** Turn one island's placements into instanced meshes. */
export function buildIslandProps(placements: readonly Placement[], seed: number): IslandProps {
  const near = new THREE.Group();
  const far = new THREE.Group();
  const detail = new THREE.Group();
  const counts = { spruce: 0, pine: 0, birch: 0, scrub: 0, boulder: 0, reed: 0, sedge: 0 };
  const geometries = propLibrary();
  const farGeometries = farPropLibrary();
  (Object.keys(VARIANTS) as FloraKind[]).forEach((kind, kindIndex) => {
    const ofKind = placements.filter((placement) => placement.kind === kind);
    counts[kind] = ofKind.length;
    if (ofKind.length === 0) return;
    const tree = TREES.includes(kind);
    for (let variant = 0; variant < VARIANTS[kind]; variant += 1) {
      const ofVariant = ofKind.filter((placement) => placement.variant === variant);
      if (ofVariant.length > 0) (tree ? near : detail).add(instancedMesh(geometries[kind][variant], ofVariant, seed + kindIndex * 97 + variant));
    }
    const farGeometry = farGeometries[kind];
    // Far trees are one size of mesh: carry each variant's height in its scale.
    if (tree && farGeometry) {
      far.add(instancedMesh(farGeometry, ofKind.map((placement) => ({ ...placement, scale: placement.scale * (0.8 + placement.variant * 0.16) })), seed + kindIndex * 97 + 50));
    }
  });
  for (const group of [near, far, detail]) group.matrixAutoUpdate = false;
  return { near, far, detail, counts };
}

/**
 * The forest on the valley walls: stands of two-stroke spruce along both
 * shores and the two ends, in chunks so each can be culled. Rules, not hand
 * placement: a tree every few metres, a few rows deep, on the wall's own ground.
 */
export function buildValleyForest(): { mesh: THREE.InstancedMesh; x: number; z: number }[] {
  const builder = new Builder(790);
  builder.cone(1.7, 4.2, PAL.pineDark, { pos: [0, 2.6, 0], kind: KIND.NEEDLE }, 7);
  builder.cone(1.1, 3.6, PAL.pine, { pos: [0, 5.6, 0], kind: KIND.NEEDLE }, 7);
  const geometry = builder.geometry();
  const random = seededRandom(4242);
  const stands: { mesh: THREE.InstancedMesh; x: number; z: number }[] = [];
  const chunk = 320;
  const spacing = 8;
  const add = (pointAt: (along: number, depth: number) => { x: number; z: number }, from: number, to: number, seed: number): void => {
    for (let start = from; start < to; start += chunk) {
      const transforms: InstanceTransform[] = [];
      for (let along = start; along < Math.min(to, start + chunk); along += spacing) {
        for (let row = 0; row < 3; row += 1) {
          const point = pointAt(along + random() * spacing, 5 + row * 16 + random() * 14);
          const height = terrainHeight(point.x, point.z);
          if (height > 1) transforms.push({ x: point.x, y: height - 0.3, z: point.z, yaw: random() * 6.28, scale: 1 + random() * 0.9 });
        }
      }
      if (transforms.length === 0) continue;
      const middle = pointAt(Math.min(to, start + chunk / 2), 30);
      stands.push({ mesh: instancedMesh(geometry, transforms, seed + start), x: middle.x, z: middle.z });
    }
  };
  for (const side of [-1, 1]) add((z, depth) => ({ x: side * (valleyHalfWidth(z) + depth), z }), VALLEY_NORTH_SHORE_Z, VALLEY_SOUTH_SHORE_Z, 5000 + side);
  const halfSouth = valleyHalfWidth(VALLEY_SOUTH_SHORE_Z);
  add((x, depth) => ({ x, z: VALLEY_SOUTH_SHORE_Z + depth }), -halfSouth, halfSouth, 6000);
  const halfNorth = valleyHalfWidth(VALLEY_NORTH_SHORE_Z);
  add((x, depth) => ({ x, z: VALLEY_NORTH_SHORE_Z - depth }), -halfNorth, halfNorth, 7000);
  return stands;
}
