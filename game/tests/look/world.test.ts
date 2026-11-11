/**
 * The drawn valley, checked without a graphics card:
 *
 * - every landmark kind and every node type has a real drawing, not a stand-in;
 * - every node type has parts that go when it is used up, and node meshes wear the material that hides them;
 * - one-of-a-kind landmarks are fitted to the rules' own ground (the dam along its crest, the dock down to the water);
 * - the dressing follows the island table: wires where pylons stand, a wreck by every wreck buoy, fog round the Fog;
 * - all 15 islands have their own outline from the water;
 * - far islands are cheap: trees, landmarks and ground each drop to a coarser drawing with distance, and come back.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ISLANDS, ISLANDS_BY_ID, NODES_BY_ISLAND, NODE_TYPES, spotPosition } from '../../src/data/index.ts';
import type { IslandDefinition, LandmarkDefinition, LandmarkKind, NodeTypeId } from '../../src/data/index.ts';
import { terrainHeight } from '../../src/sim/index.ts';
import { inkMaterial } from '../../src/look/b2/palette.js';
import { LANDMARK_KINDS, landmarkFarGeometry, landmarkGeometry } from '../../src/look/landmarks.ts';
import { NODE_TYPE_IDS, nodeGeometry } from '../../src/look/nodes.ts';
import { floraFor } from '../../src/look/presets.ts';
import { buildIslandProps, instancedMesh, treeWatcher } from '../../src/look/props.ts';
import { scatterIsland } from '../../src/look/scatter.ts';
import { buildIslandTerrain, islandWatcher } from '../../src/look/terrain.ts';
import { CLOSE_DRESSING, FINE_GROUND, FINE_LANDMARKS, FINE_TREES, clearDistance, noteEye } from '../../src/look/world/distance.ts';
import { dressIsland, fogNormal } from '../../src/look/world/dressing.ts';
import { DAY, NIGHT } from '../../src/look/daylight.ts';
import { LANDMARK_SUNK, siteOf } from '../../src/look/world/kit.ts';
import { nodeMaterial, withSpentSwitch } from '../../src/look/world/spent.ts';

const triangles = (geometry: THREE.BufferGeometry): number => (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3;

/** Every vertex of a landmark where the world view puts it: sunk 0.1 m, turned by its bearing and the island's turn. */
function placed(island: IslandDefinition, landmark: LandmarkDefinition): { local: THREE.Vector3; world: THREE.Vector3 }[] {
  const spot = spotPosition(island, landmark.spot);
  const matrix = new THREE.Matrix4().makeRotationY(-(landmark.bearing + island.rotation)).setPosition(spot.x, Math.max(0, terrainHeight(spot.x, spot.z)) - LANDMARK_SUNK, spot.z);
  const positions = landmarkGeometry(landmark.kind).getAttribute('position');
  return Array.from({ length: positions.count }, (_, index) => {
    const local = new THREE.Vector3().fromBufferAttribute(positions, index);
    return { local, world: local.clone().applyMatrix4(matrix) };
  });
}

describe('landmarks', () => {
  /** Triangles of the simplest real drawing (the bedroll). The old stand-ins for the big kinds had 60 to 300. */
  const LEAST = 150;

  it('draws every landmark kind the island table names, with every stroke and as a far outline', () => {
    const named = new Set<LandmarkKind>(ISLANDS.flatMap((island) => island.landmarks.map((landmark) => landmark.kind)));
    expect([...named].sort()).toEqual([...LANDMARK_KINDS].sort());
    for (const kind of LANDMARK_KINDS) {
      const full = landmarkGeometry(kind);
      const far = landmarkFarGeometry(kind);
      expect(triangles(full), kind).toBeGreaterThanOrEqual(LEAST);
      expect(triangles(far), `${kind} far`).toBeGreaterThan(20);
      expect(triangles(far), `${kind} far`).toBeLessThanOrEqual(triangles(full));
      // The far outline is the same thing: as tall, within a metre and a half or a tenth (an aerial may go).
      full.computeBoundingBox();
      far.computeBoundingBox();
      const size = full.boundingBox!.getSize(new THREE.Vector3());
      const farSize = far.boundingBox!.getSize(new THREE.Vector3());
      expect(Math.abs(size.y - farSize.y), `${kind} height`).toBeLessThan(Math.max(1.5, size.y * 0.1));
      expect(far.userData.full).toBe(full);
    }
    // The far versions are worth having: under half the triangles over the whole set.
    const sum = (pick: (kind: LandmarkKind) => THREE.BufferGeometry): number => LANDMARK_KINDS.reduce((total, kind) => total + triangles(pick(kind)), 0);
    expect(sum(landmarkFarGeometry)).toBeLessThan(sum(landmarkGeometry) * 0.5);
  });

  it('fits the dam to the rules\' crest from end to end, and nowhere else', () => {
    const island = ISLANDS_BY_ID.dam_crest;
    const dam = island.landmarks.find((landmark) => landmark.kind === 'dam_wall')!;
    const parapet = placed(island, dam).filter(({ local }) => Math.abs(Math.abs(local.x) - 4.6) < 0.4 && Math.abs(local.z) > 40);
    expect(parapet.length).toBeGreaterThan(500);
    for (const { world } of parapet) {
      const above = world.y - terrainHeight(world.x, world.z);
      expect(above).toBeGreaterThan(-1.2);
      expect(above).toBeLessThan(2.4);
    }
    // It runs the length of the island, not the 60 m of the stand-in.
    const along = parapet.map(({ world }) => world.x);
    expect(Math.max(...along) - Math.min(...along)).toBeGreaterThan(island.radiusX * 1.8);
  });

  it('runs the dock from its place in the yard down the rules\' bank and out over the water', () => {
    const island = ISLANDS_BY_ID.the_boathouse;
    const dock = island.landmarks.find((landmark) => landmark.kind === 'dock')!;
    const deck = placed(island, dock).filter(({ local }) => Math.abs(local.x) > 0.9 && Math.abs(local.x) < 1.02 && local.z > -1.4);
    // The top of the dock's boards (their edges, and the posts beside them) in every 2 m of its length.
    const tops = new Map<number, { y: number; ground: number }>();
    for (const { local, world } of deck) {
      const stretch = Math.floor(local.z / 2);
      if (world.y > (tops.get(stretch)?.y ?? -Infinity)) tops.set(stretch, { y: world.y, ground: terrainHeight(world.x, world.z) });
    }
    const ashore = [...tops.values()].filter((top) => top.ground > 0.3);
    const afloat = [...tops.values()].filter((top) => top.ground < -0.3);
    expect(ashore.length).toBeGreaterThanOrEqual(6);
    expect(afloat.length).toBeGreaterThanOrEqual(4);
    // Ashore it lies on the rules' ground. Over the water it stands clear of it.
    for (const top of ashore) expect(top.y - top.ground).toBeGreaterThan(0.25), expect(top.y - top.ground).toBeLessThan(0.6);
    for (const top of afloat) expect(top.y).toBeGreaterThan(0.5), expect(top.y).toBeLessThan(1.7);
  });

  it('tells a one-of-a-kind landmark the ground it will stand on', () => {
    for (const kind of ['dock', 'dam_wall', 'quarry_cut', 'orchard_rows', 'birch_grove'] as const) {
      const island = ISLANDS.find((entry) => entry.landmarks.some((landmark) => landmark.kind === kind))!;
      const landmark = island.landmarks.find((entry) => entry.kind === kind)!;
      const site = siteOf(kind);
      expect(site.island).toBe(island);
      expect(site.ground(0, 0)).toBeCloseTo(LANDMARK_SUNK, 6);
      // A point 7 m to its right and 4 m behind it, worked out the world view's way.
      const spot = spotPosition(island, landmark.spot);
      const turn = -(landmark.bearing + island.rotation);
      const world = new THREE.Vector3(7, 0, 4).applyMatrix4(new THREE.Matrix4().makeRotationY(turn)).add(new THREE.Vector3(spot.x, 0, spot.z));
      expect(site.ground(7, 4)).toBeCloseTo(terrainHeight(world.x, world.z) - (Math.max(0, terrainHeight(spot.x, spot.z)) - LANDMARK_SUNK), 6);
    }
  });
});

describe('scavenge nodes', () => {
  it('draws every node type, each with parts that go when it is used up', () => {
    expect([...NODE_TYPE_IDS].sort()).toEqual((Object.keys(NODE_TYPES) as NodeTypeId[]).sort());
    for (const typeId of NODE_TYPE_IDS) {
      const geometry = nodeGeometry(typeId);
      const gone = geometry.getAttribute('aGone');
      expect(gone, typeId).toBeDefined();
      expect(gone.count).toBe(geometry.getAttribute('position').count);
      const count = (value: number): number => Array.from({ length: gone.count }, (_, index) => gone.getX(index)).filter((entry) => entry === value).length;
      // Something is left when it is used up, and something has gone.
      expect(count(0), `${typeId} always`).toBeGreaterThan(30);
      expect(count(1), `${typeId} fresh`).toBeGreaterThanOrEqual(12);
      expect(count(0) + count(1) + count(-1)).toBe(gone.count);
      expect(triangles(geometry), typeId).toBeGreaterThanOrEqual(60);
    }
  });

  it('wears the material that hides the wrong half, and nothing else does', () => {
    const node = instancedMesh(nodeGeometry('crate'), [{ x: 0, y: 0, z: 0, yaw: 0, scale: 1 }], 1);
    expect(node.material).toBe(nodeMaterial());
    expect(node.geometry.getAttribute('aGone')).toBe(nodeGeometry('crate').getAttribute('aGone'));
    const material = nodeMaterial();
    expect(material.vertexShader).toContain('aGone * (aInst.y - .5) > 0.');
    expect(material.uniforms).toBe(inkMaterial.uniforms);
    expect(material.fragmentShader).toBe(inkMaterial.fragmentShader);
    expect((material.userData.mirror as THREE.ShaderMaterial).defines.MIRROR).toBe(1);
    expect(() => withSpentSwitch('void main(){}')).toThrow();
    const tree = instancedMesh(landmarkGeometry('silo'), [{ x: 0, y: 0, z: 0, yaw: 0, scale: 1 }], 1);
    expect(tree.material).toBe(inkMaterial);
  });
});

describe('dressing', () => {
  const counts = Object.fromEntries(ISLANDS.map((island) => [island.id, dressIsland(island).counts]));

  it('follows the island table', () => {
    expect(counts.pylon_line.wire_span).toBe(2);
    expect(counts.truss_bridge.track).toBe(1);
    expect(counts.home_knoll.signal_pine).toBe(1);
    expect(counts.heron_marsh.heron).toBeGreaterThanOrEqual(3);
    expect(counts.heron_marsh.snag).toBeGreaterThan(6);
    expect(counts.the_beacon.fog_heap).toBeGreaterThan(40);
    for (const island of ISLANDS) {
      const buoys = (NODES_BY_ISLAND[island.id] ?? []).filter((node) => node.typeId === 'wreck_buoy').length;
      expect(counts[island.id].wreck ?? 0, island.id).toBe(buoys);
      expect(counts[island.id].crag ?? 0, island.id).toBe(island.peakHeight >= 20 ? counts[island.id].crag : 0);
      if (island.peakHeight >= 20) expect(counts[island.id].crag).toBeGreaterThan(8);
      // Nothing an island's data does not call for.
      if (island.regionId !== 'fog') expect(counts[island.id].fog_heap).toBeUndefined();
      if (!island.landmarks.some((landmark) => landmark.kind === 'pylon')) expect(counts[island.id].wire_span).toBeUndefined();
      if (!island.landmarks.some((landmark) => landmark.kind === 'reed_bed')) expect(counts[island.id].heron).toBeUndefined();
    }
    expect(counts.the_beacon.snag).toBeGreaterThan(10);
    expect(counts.quarry_face.skerry).toBeGreaterThan(3);
    expect(counts.dam_crest.skerry).toBeUndefined();
  });

  it('hangs the wires from the pylons and drops their ends into the water', () => {
    const island = ISLANDS_BY_ID.pylon_line;
    const wires = dressIsland(island).always.children.find((child) => child instanceof THREE.Mesh && !(child instanceof THREE.InstancedMesh)) as THREE.Mesh;
    const box = new THREE.Box3().setFromBufferAttribute(wires.geometry.getAttribute('position') as THREE.BufferAttribute);
    const spots = island.landmarks.map((landmark) => spotPosition(island, landmark.spot));
    const ground = Math.max(...spots.map((spot) => terrainHeight(spot.x, spot.z)));
    expect(box.max.y).toBeGreaterThan(ground + 26);
    expect(box.max.y).toBeLessThan(ground + 29);
    expect(box.min.y).toBeLessThan(0);
    for (const spot of spots) expect(box.containsPoint(new THREE.Vector3(spot.x, 10, spot.z))).toBe(true);
  });

  it('gives the fog one normal that takes the plain tone by day and by night, from outside and from inside', () => {
    const normal = fogNormal();
    for (const light of [DAY.lightDirection, NIGHT.lightDirection]) {
      const lit = (normal.x * light[0] + normal.y * light[1] + normal.z * light[2]) * 0.8 + normal.y * 0.2;
      expect(Math.abs(lit)).toBeLessThan(0.02);
    }
  });
});

/** The skyline of an island seen broadside from the water: the highest thing in each 8 m of its width, metres. */
function skyline(island: IslandDefinition): number[] {
  const bins = new Array<number>(48).fill(0);
  const cosine = Math.cos(island.rotation);
  const sine = Math.sin(island.rotation);
  const long = island.radiusX >= island.radiusZ;
  const note = (x: number, y: number, z: number): void => {
    const dx = x - island.center.x;
    const dz = z - island.center.z;
    const across = long ? dx * cosine + dz * sine : -dx * sine + dz * cosine;
    const bin = Math.floor(across / 8) + 24;
    if (bin >= 0 && bin < 48) bins[bin] = Math.max(bins[bin], y);
  };
  for (let along = -1; along <= 1; along += 0.02) for (let across = -1; across <= 1; across += 0.02) {
    const point = spotPosition(island, { along, across });
    note(point.x, terrainHeight(point.x, point.z), point.z);
  }
  const TREE: Record<string, [number, number]> = { spruce: [5.5, 1.5], pine: [11, 2], birch: [5.6, 0.8] };
  for (const placement of scatterIsland(island, floraFor(island))) {
    const tree = TREE[placement.kind];
    if (tree) note(placement.x, placement.y + (tree[0] + placement.variant * tree[1]) * placement.scale, placement.z);
  }
  for (const landmark of island.landmarks) for (const { world } of placed(island, landmark)) note(world.x, world.y, world.z);
  dressIsland(island).always.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const positions = object.geometry.getAttribute('position');
    const matrix = new THREE.Matrix4();
    const point = new THREE.Vector3();
    for (let instance = 0; instance < (object instanceof THREE.InstancedMesh ? object.count : 1); instance += 1) {
      if (object instanceof THREE.InstancedMesh) object.getMatrixAt(instance, matrix);
      // Fog is not land: the wall belongs to the region, not to the island's own outline.
      if (object instanceof THREE.InstancedMesh && matrix.getMaxScaleOnAxis() > 20) continue;
      for (let index = 0; index < positions.count; index += 7) {
        point.fromBufferAttribute(positions, index).applyMatrix4(matrix);
        note(point.x, point.y, point.z);
      }
    }
  });
  return bins;
}

describe('the 15 islands', () => {
  it('each has its own outline from the water', () => {
    const lines = ISLANDS.map((island) => skyline(island));
    const gaps: { gap: number; pair: string }[] = [];
    for (let first = 0; first < ISLANDS.length; first += 1) {
      for (let second = first + 1; second < ISLANDS.length; second += 1) {
        // Metres between the two skylines, averaged over the width where either island stands.
        const land = lines[first].map((height, bin) => height > 0 || lines[second][bin] > 0);
        const gap = lines[first].reduce((total, height, bin) => total + Math.abs(height - lines[second][bin]), 0) / land.filter(Boolean).length;
        gaps.push({ gap, pair: `${ISLANDS[first].id} and ${ISLANDS[second].id}` });
      }
    }
    gaps.sort((first, second) => first.gap - second.gap);
    console.log(`closest outlines: ${gaps.slice(0, 4).map((entry) => `${entry.pair} ${entry.gap.toFixed(1)} m`).join('; ')}`);
    expect(gaps[0].gap).toBeGreaterThan(OUTLINE_GAP);
  });
});
/** The least two islands' skylines may differ, metres, averaged across their width. */
const OUTLINE_GAP = 2;

describe('detail by distance', () => {
  it('draws the same trees with about half the triangles past the middle distance, and brings them back', () => {
    clearDistance();
    const island = ISLANDS_BY_ID.home_knoll;
    const props = buildIslandProps(scatterIsland(island, floraFor(island)), 1);
    const trees = props.near.children as THREE.InstancedMesh[];
    const drawn = (): number => trees.reduce((total, tree) => total + triangles(tree.geometry) * tree.count, 0);
    const watch = treeWatcher(trees, island.center, Math.max(island.radiusX, island.radiusZ));
    const at = (metres: number): void => watch(new THREE.Vector3(island.center.x + Math.max(island.radiusX, island.radiusZ) + metres, 3, island.center.z));
    at(50);
    const fine = drawn();
    at(FINE_TREES[1] + 5);
    const coarse = drawn();
    expect(coarse).toBeLessThan(fine * 0.62);
    expect(coarse).toBeGreaterThan(fine * 0.3);
    // Between the two edges nothing changes, whichever way the eye is going: no flicker at the line.
    at(FINE_TREES[0] + 5);
    expect(drawn()).toBe(coarse);
    at(FINE_TREES[0] - 5);
    expect(drawn()).toBe(fine);
    at(FINE_TREES[1] - 5);
    expect(drawn()).toBe(fine);
    for (const tree of trees) {
      const detail = tree.userData.detail as { fine: THREE.BufferGeometry; coarse: THREE.BufferGeometry };
      // The same tree: one set of instances, the same height and spread.
      expect(detail.coarse.getAttribute('aInst')).toBe(detail.fine.getAttribute('aInst'));
      const size = (geometry: THREE.BufferGeometry): THREE.Vector3 => new THREE.Box3().setFromBufferAttribute(geometry.getAttribute('position') as THREE.BufferAttribute).getSize(new THREE.Vector3());
      expect(size(detail.coarse).y).toBeCloseTo(size(detail.fine).y, 0);
      expect(Math.abs(size(detail.coarse).x - size(detail.fine).x)).toBeLessThan(0.6);
    }
  });

  it('gives a far island coarse ground, outline landmarks and no small dressing, through the eye the ground reports', () => {
    clearDistance();
    const island = ISLANDS_BY_ID.pylon_line;
    const group = new THREE.Group();
    const ground = buildIslandTerrain(island);
    const pylon = new THREE.Mesh(landmarkGeometry('pylon'), inkMaterial);
    const steepleRock = new THREE.Mesh(landmarkGeometry('steeple'), inkMaterial);
    group.add(ground, pylon, steepleRock);
    const close = ground.children[1];
    const detail = ground.userData.detail as { fine: THREE.BufferGeometry; coarse: THREE.BufferGeometry };
    expect(triangles(detail.coarse)).toBeLessThan(triangles(detail.fine) * 0.3);
    const reach = Math.max(island.radiusX, island.radiusZ);
    const eyeAt = (metres: number): THREE.Vector3 => new THREE.Vector3(island.center.x, 3, island.center.z + reach + metres);
    // The world view never tells us where the eye is: the ground mesh does, as it is drawn.
    const camera = new THREE.PerspectiveCamera();
    const drawGround = (metres: number): void => {
      camera.position.copy(eyeAt(metres));
      ground.onBeforeRender(null as never, null as never, camera, ground.geometry, ground.material as THREE.Material, null as never);
    };
    drawGround(900);
    expect(ground.geometry).toBe(detail.coarse);
    expect(pylon.geometry).toBe(landmarkFarGeometry('pylon'));
    expect(steepleRock.geometry).toBe(landmarkFarGeometry('steeple'));
    expect(close.visible).toBe(false);
    drawGround(60);
    expect(ground.geometry).toBe(detail.fine);
    expect(pylon.geometry).toBe(landmarkGeometry('pylon'));
    expect(close.visible).toBe(true);
    // Each range has a gap between on and off.
    for (const range of [FINE_GROUND, FINE_LANDMARKS, CLOSE_DRESSING, FINE_TREES]) expect(range[1] - range[0]).toBeGreaterThanOrEqual(25);
    // A still eye changes nothing: the watchers do not even run.
    let runs = 0;
    const watch = islandWatcher(island, ground, close);
    const counted = (eye: THREE.Vector3): void => {
      runs += 1;
      watch(eye);
    };
    clearDistance();
    const moving = new THREE.Vector3(0, 0, 0);
    noteEye(moving);
    counted(moving);
    expect(runs).toBe(1);
    noteEye(moving.clone().add(new THREE.Vector3(0.3, 0, 0)));
    expect(runs).toBe(1);
    clearDistance();
  });
});
