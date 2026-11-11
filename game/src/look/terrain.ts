/**
 * The ground: one mesh per island and one for the valley walls, every vertex
 * at the rules engine's `terrainHeight`. B2's terrain shader draws the rock,
 * moss and sand on it from the island's region preset.
 *
 * An island's ground also carries its dressing (world/dressing.ts) as children,
 * and watches the eye for it: the small dressing and the landmarks' strokes are
 * only drawn from near by (world/distance.ts).
 */
import * as THREE from 'three';
import { TUNING, VALLEY_NORTH_SHORE_Z, VALLEY_SOUTH_SHORE_Z, spotPosition } from '../data/index.ts';
import type { IslandDefinition } from '../data/index.ts';
import { terrainHeight, valleyHalfWidth } from '../sim/index.ts';
import { terrainMaterialFor } from './b2/palette.js';
import { PRESETS, presetIdFor } from './presets.ts';
import type { PresetId } from './presets.ts';
import { CLOSE_DRESSING, FINE_GROUND, FINE_LANDMARKS, clearDistance, eyeHook, watchDistance, within } from './world/distance.ts';
import type { Watcher } from './world/distance.ts';
import { disposeDressing, dressIsland } from './world/dressing.ts';

/** Metres between terrain vertices on an island. The sim's ground is smooth: the detail is drawn by the shader. */
const ISLAND_CELL = 3;
/** The same from far off, where a 3 m cell is a pixel or two. */
const FAR_ISLAND_CELL = 7;
/** Ground deeper than this is under opaque water and is not built. */
const DEEPEST_DRAWN = -1.6;
/** Islands are meshed this far past their shoreline, in radii: where the shelf passes `DEEPEST_DRAWN`. */
const SHELF_DRAWN = 0.24;

const materials = new Map<PresetId, THREE.ShaderMaterial>();

export function terrainMaterial(presetId: PresetId): THREE.ShaderMaterial {
  let material = materials.get(presetId);
  if (!material) {
    material = terrainMaterialFor(PRESETS[presetId].terrain);
    materials.set(presetId, material);
  }
  return material;
}

export function disposeTerrainMaterials(): void {
  for (const material of materials.values()) material.dispose();
  materials.clear();
  clearDistance();
  disposeDressing();
}

/**
 * What an island does as the eye moves: shows its small dressing only from near by, and gives each
 * landmark standing on it (the ground mesh's siblings) every stroke from near by, its outline from far off.
 */
export function islandWatcher(island: IslandDefinition, ground: THREE.Object3D, close: THREE.Object3D): Watcher {
  const reach = Math.max(island.radiusX, island.radiusZ);
  let fine = true;
  let fineGround = true;
  return (eye) => {
    const distance = Math.max(0, Math.hypot(island.center.x - eye.x, island.center.z - eye.z) - reach);
    close.visible = within(close.visible, distance, CLOSE_DRESSING);
    fineGround = within(fineGround, distance, FINE_GROUND);
    const detail = ground.userData.detail as { fine: THREE.BufferGeometry; coarse: THREE.BufferGeometry } | undefined;
    if (detail && ground instanceof THREE.Mesh) ground.geometry = fineGround ? detail.fine : detail.coarse;
    fine = within(fine, distance, FINE_LANDMARKS);
    for (const sibling of ground.parent?.children ?? []) {
      if (!(sibling instanceof THREE.Mesh)) continue;
      const { far, full } = sibling.geometry.userData as { far?: THREE.BufferGeometry; full?: THREE.BufferGeometry };
      if (fine && full) sibling.geometry = full;
      else if (!fine && far) sibling.geometry = far;
    }
  };
}

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const share = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return share * share * (3 - 2 * share);
};

/**
 * A height field over a grid of (x, z) points. `beachAt` gives the share of
 * sand (0 to 1) the terrain shader reads from the vertex colour.
 */
function heightField(
  countU: number,
  countV: number,
  pointAt: (indexU: number, indexV: number) => { x: number; z: number },
  beachAt: (x: number, z: number) => number,
  material: THREE.Material,
): THREE.Mesh {
  const row = countU + 1;
  const total = row * (countV + 1);
  const positions = new Float32Array(total * 3);
  const colours = new Float32Array(total * 3);
  for (let indexV = 0, vertex = 0; indexV <= countV; indexV += 1) {
    for (let indexU = 0; indexU <= countU; indexU += 1, vertex += 1) {
      const { x, z } = pointAt(indexU, indexV);
      positions[vertex * 3] = x;
      positions[vertex * 3 + 1] = terrainHeight(x, z);
      positions[vertex * 3 + 2] = z;
      colours[vertex * 3] = beachAt(x, z);
    }
  }
  const indices: number[] = [];
  for (let indexV = 0; indexV < countV; indexV += 1) {
    for (let indexU = 0; indexU < countU; indexU += 1) {
      const corner = indexV * row + indexU;
      const right = corner + 1;
      const below = corner + row;
      const across = below + 1;
      const deep = (vertex: number): boolean => positions[vertex * 3 + 1] < DEEPEST_DRAWN;
      if (deep(corner) && deep(right) && deep(below) && deep(across)) continue;
      indices.push(corner, below, right, right, below, across);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.matrixAutoUpdate = false;
  // After the trees and props that stand on it, so the costly ground is not painted under them.
  mesh.renderOrder = 3;
  return mesh;
}

/** One island's ground at a cell size, with sand round its landing. */
function islandGround(island: IslandDefinition, cell: number): THREE.Mesh {
  const presetId = presetIdFor(island);
  const reach = 1 + Math.min(SHELF_DRAWN, TUNING.world.shelfWidth);
  const extentU = island.radiusX * reach;
  const extentV = island.radiusZ * reach;
  const countU = Math.min(220, Math.ceil((extentU * 2) / cell));
  const countV = Math.min(220, Math.ceil((extentV * 2) / cell));
  const cosine = Math.cos(island.rotation);
  const sine = Math.sin(island.rotation);
  const landing = spotPosition(island, island.landing);
  const beachRadius = PRESETS[presetId].beachRadius;
  return heightField(
    countU,
    countV,
    (indexU, indexV) => {
      const along = -extentU + (indexU / countU) * extentU * 2;
      const across = -extentV + (indexV / countV) * extentV * 2;
      return { x: island.center.x + along * cosine - across * sine, z: island.center.z + along * sine + across * cosine };
    },
    (x, z) => smoothstep(beachRadius, beachRadius * 0.45, Math.hypot(x - landing.x, z - landing.z)),
    terrainMaterial(presetId),
  );
}

/**
 * One island's ground. It carries a coarse copy of itself for far off (`userData.detail`), its dressing
 * as children, and it watches the eye for all three.
 */
export function buildIslandTerrain(island: IslandDefinition): THREE.Mesh {
  const ground = islandGround(island, ISLAND_CELL);
  ground.userData.detail = { fine: ground.geometry, coarse: islandGround(island, FAR_ISLAND_CELL).geometry };
  const dressing = dressIsland(island);
  ground.add(dressing.always, dressing.close);
  ground.userData.dressing = dressing.counts;
  eyeHook(ground);
  watchDistance(islandWatcher(island, ground, dressing.close));
  return ground;
}

/**
 * The valley walls that close the lake. Strips that follow each shoreline:
 * fine at the water, coarse up the slope. The seabed is never drawn.
 */
export function buildValleyTerrain(): THREE.Group {
  const group = new THREE.Group();
  const material = terrainMaterial('valley');
  const noBeach = (): number => 0;
  // Distance past the shoreline, metres. Negative is under water.
  // The walls are drawn to the height of their forest. Above that, B2's painted ridges carry on into the mist.
  const offsets = [-4, 0, 4, 12, 30, 62];
  const beyond = offsets[offsets.length - 1];
  const rowLength = 30;
  const rows = Math.ceil((VALLEY_SOUTH_SHORE_Z - VALLEY_NORTH_SHORE_Z) / rowLength);
  for (const side of [-1, 1]) {
    group.add(heightField(offsets.length - 1, rows, (indexU, indexV) => {
      const z = VALLEY_NORTH_SHORE_Z + (indexV / rows) * (VALLEY_SOUTH_SHORE_Z - VALLEY_NORTH_SHORE_Z);
      // Wind the west wall the other way round, so both walls face up.
      const offset = offsets[side > 0 ? indexU : offsets.length - 1 - indexU];
      return { x: side * (valleyHalfWidth(z) + offset), z };
    }, noBeach, material));
  }
  const columns = 64;
  for (const [shoreZ, direction] of [[VALLEY_SOUTH_SHORE_Z, 1], [VALLEY_NORTH_SHORE_Z, -1]] as const) {
    const halfWidth = valleyHalfWidth(shoreZ) + beyond;
    group.add(heightField(columns, offsets.length - 1, (indexU, indexV) => {
      const offset = offsets[direction > 0 ? indexV : offsets.length - 1 - indexV];
      return { x: -halfWidth + (indexU / columns) * halfWidth * 2, z: shoreZ + direction * offset };
    }, noBeach, material));
  }
  for (const strip of group.children) eyeHook(strip as THREE.Mesh);
  group.matrixAutoUpdate = false;
  return group;
}
