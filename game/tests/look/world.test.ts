/**
 * The drawn valley, checked without a graphics card:
 *
 * - every landmark kind and every node type has a real drawing, not a stand-in;
 * - every node type has parts that go when it is used up, and node meshes wear the material that hides them;
 * - one-of-a-kind landmarks are fitted to the rules' own ground (the dam along its crest, the dock down to the water);
 * - the dressing follows the island table: wires where pylons stand, a wreck by every wreck buoy, fog round the Fog;
 * - all 15 islands have their own outline from the water;
 * - far islands are cheap: trees, landmarks and ground each drop to a coarser drawing with distance, and come back;
 * - a cottage's roof stands on its walls, high enough to carry the outline, the attic's cupola clears its ridge,
 *   and what the rules put under it can be seen from outside;
 * - the scrap stack is cars: each has glass under a roof, wheels with hubs, lamps at both ends.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ISLANDS, ISLANDS_BY_ID, NODES_BY_ISLAND, NODE_TYPES, REGIONS_BY_ID, spotPosition } from '../../src/data/index.ts';
import type { IslandDefinition, LandmarkDefinition, LandmarkKind, NodeTypeId } from '../../src/data/index.ts';
import { terrainHeight } from '../../src/sim/index.ts';
import { PAL, inkMaterial } from '../../src/look/b2/palette.js';
import { LANDMARK_HEIGHT, LANDMARK_KINDS, landmarkFarGeometry, landmarkGeometry } from '../../src/look/landmarks.ts';
import { ATTIC_HEIGHT, NODE_TYPE_IDS, nodeGeometry } from '../../src/look/nodes.ts';
import { floraFor } from '../../src/look/presets.ts';
import { buildIslandProps, instancedMesh, treeWatcher } from '../../src/look/props.ts';
import { hashText, scatterIsland, seededRandom } from '../../src/look/scatter.ts';
import { buildIslandTerrain, islandWatcher } from '../../src/look/terrain.ts';
import { CLOSE_DRESSING, FINE_GROUND, FINE_LANDMARKS, FINE_TREES, clearDistance, noteEye } from '../../src/look/world/distance.ts';
import { FOG_HEAPS, dressIsland, fogBanks, fogNormal } from '../../src/look/world/dressing.ts';
import { DAY, NIGHT } from '../../src/look/daylight.ts';
import { LANDMARK_SUNK, TONE, siteOf } from '../../src/look/world/kit.ts';
import { CAR } from '../../src/look/world/reach.ts';
import { COTTAGE_RIDGE } from '../../src/look/world/shallows.ts';
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

describe('the cottages', () => {
  const cottages = ISLANDS.flatMap((island) => island.landmarks.filter((landmark) => landmark.kind === 'cabin_roof').map((landmark) => ({ island, landmark })));
  /** The node the rules put on a cottage's own spot, if any. */
  const under = (island: IslandDefinition, landmark: LandmarkDefinition): NodeTypeId | null => {
    const spot = spotPosition(island, landmark.spot);
    return (NODES_BY_ISLAND[island.id] ?? []).find((node) => Math.hypot(node.position.x - spot.x, node.position.z - spot.z) < 0.5)?.typeId ?? null;
  };

  it('stand on what shows of their walls, the ridge twice as high as a roof lying on the ground', () => {
    // A roof on the ground (as it was) had its ridge 1.7 m up: lost against 7 m spruce from the water.
    expect(COTTAGE_RIDGE).toBeGreaterThan(3.5);
    const positions = landmarkGeometry('cabin_roof').getAttribute('position');
    const ridge = Array.from({ length: positions.count }, (_, index) => new THREE.Vector3().fromBufferAttribute(positions, index))
      .filter((point) => Math.abs(point.x) < 0.6 && Math.abs(point.z) < 2.5 && Math.abs(point.y - LANDMARK_SUNK - COTTAGE_RIDGE) < 0.25);
    expect(ridge.length, 'the drawing has its ridge there').toBeGreaterThan(3);
    // Walls: something drawn under the eaves all the way into the ground, on both long sides.
    for (const side of [-1, 1]) {
      const wall = Array.from({ length: positions.count }, (_, index) => new THREE.Vector3().fromBufferAttribute(positions, index))
        .filter((point) => point.x * side > 2.2 && point.x * side < 3.2 && point.y < -1);
      expect(wall.length, `wall ${side}`).toBeGreaterThan(3);
    }
  });

  it('let the attic\'s cupola stand through the ridge, windows and all', () => {
    expect(cottages.filter(({ island, landmark }) => under(island, landmark) === 'attic').length).toBeGreaterThan(0);
    // The cupola's windows: their sills are 0.96 m under its eaves (nodes.ts).
    expect(ATTIC_HEIGHT - 0.96).toBeGreaterThan(COTTAGE_RIDGE);
    nodeGeometry('attic').computeBoundingBox();
    expect(nodeGeometry('attic').boundingBox!.max.y).toBeGreaterThan(COTTAGE_RIDGE + 1.5);
  });

  it('show the cache the rules put under a roof: from both sides and the south, where the eye follows a walker from', () => {
    const withCache = cottages.filter(({ island, landmark }) => under(island, landmark) === 'cache');
    expect(withCache.length).toBeGreaterThan(0);
    const cottage = new THREE.Mesh(landmarkGeometry('cabin_roof'), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    cottage.updateMatrixWorld();
    // The chest stands on the ground at the landmark's own spot: 0.1 m above its origin. Its lid is 0.7 m up.
    const reach = 8.5;
    const seenFrom = (x: number, z: number, pitch: number, height: number): boolean => {
      const chest = new THREE.Vector3(0, LANDMARK_SUNK + height, 0);
      const eye = chest.clone().add(new THREE.Vector3(x * Math.cos(pitch), Math.sin(pitch), z * Math.cos(pitch)).multiplyScalar(reach));
      const ray = new THREE.Raycaster(eye, chest.clone().sub(eye).normalize(), 0, reach - 0.05);
      return ray.intersectObject(cottage).length === 0;
    };
    // The eye follows a walker from 0.34 radians up by default (client/camera.ts) and 0.42 in the staged island view:
    // the lid shows from a little under the one to a little over the other, the body from 0.42.
    for (const pitch of [0.26, 0.34, 0.42, 0.46]) {
      expect(seenFrom(1, 0, pitch, 0.65), `the lid from the east, ${pitch} up`).toBe(true);
      expect(seenFrom(-1, 0, pitch, 0.65), `the lid from the west, ${pitch} up`).toBe(true);
      expect(seenFrom(0, 1, pitch, 0.65), `the lid from the south, ${pitch} up`).toBe(true);
    }
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1]]) expect(seenFrom(x, z, 0.42, 0.25), `the body from ${x}, ${z}`).toBe(true);
  });
});

describe('the scrap stack', () => {
  /** How many vertices of a drawing wear a colour (a piece keeps its wash on every vertex). */
  const wearing = (geometry: THREE.BufferGeometry, tone: string): number => {
    const colours = geometry.getAttribute('aColor');
    const wanted = new THREE.Color(tone);
    let count = 0;
    for (let index = 0; index < colours.count; index += 1) {
      if (Math.abs(colours.getX(index) - wanted.r) < 0.004 && Math.abs(colours.getY(index) - wanted.g) < 0.004 && Math.abs(colours.getZ(index) - wanted.b) < 0.004) count += 1;
    }
    return count;
  };

  it('is cars, not slabs: glass under a roof, wheels with hubs, lamps at both ends, on each of the five and the pickup', () => {
    const stack = landmarkGeometry('scrap_stack');
    // A box is 36 vertices, a hub 96. Glass: one band a car, two on the pickup's cab.
    expect(wearing(stack, TONE.glassDark)).toBeGreaterThanOrEqual(7 * 36);
    // Head lamps: two a car and two on the pickup. Tail lamps: two a car.
    expect(wearing(stack, PAL.cream)).toBeGreaterThanOrEqual(12 * 36);
    expect(wearing(stack, TONE.towerRed)).toBeGreaterThanOrEqual(10 * 36);
    // A hub in every wheel: two a car, two on the pickup.
    expect(wearing(stack, PAL.tin)).toBeGreaterThanOrEqual(12 * 96);
    // From far off the glass is still there on every car.
    expect(wearing(landmarkFarGeometry('scrap_stack'), TONE.glassDark)).toBeGreaterThanOrEqual(5 * 36);
    // And a car is a car's shape: twice as long as it is tall would be a slab.
    expect(CAR.length / CAR.height).toBeLessThan(5);
    expect(CAR.height).toBeGreaterThan(0.85);
  });
});

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

describe('the fog wall', () => {
  const beacon = ISLANDS_BY_ID.the_beacon;
  const dam = ISLANDS_BY_ID.dam_crest;
  const tower = spotPosition(beacon, beacon.landmarks.find((landmark) => landmark.kind === 'radio_tower')!.spot);
  const foot = terrainHeight(tower.x, tower.z);
  const head = foot + LANDMARK_HEIGHT.radio_tower!;
  // The banks as the Beacon's dressing really lays them: read back from the instances it made. Each heap is an ellipsoid.
  const dressing = dressIsland(beacon);
  const drawn = dressing.always.children.find((child) => (child as THREE.InstancedMesh).isInstancedMesh && (child as THREE.InstancedMesh).count === dressing.counts.fog_heap) as THREE.InstancedMesh;
  const banks = Array.from({ length: drawn.count }, (_, index) => {
    const matrix = new THREE.Matrix4();
    drawn.getMatrixAt(index, matrix);
    const [place, turn, size] = [new THREE.Vector3(), new THREE.Quaternion(), new THREE.Vector3()];
    matrix.decompose(place, turn, size);
    return { x: place.x, y: place.y, z: place.z, scale: size.x };
  });
  /** True when nothing of the fog lies on the line from `eye` to `mark`. */
  const clear = (eye: THREE.Vector3, mark: THREE.Vector3): boolean => {
    for (const bank of banks) {
      for (const heap of FOG_HEAPS) {
        // In the heap's own space it is the unit sphere: does the line from the eye to the mark cross it?
        const into = (point: THREE.Vector3): THREE.Vector3 => new THREE.Vector3(
          (point.x - bank.x - heap.at[0] * bank.scale) / (heap.reach[0] * bank.scale),
          (point.y - bank.y - heap.at[1] * bank.scale) / (heap.reach[1] * bank.scale),
          (point.z - bank.z - heap.at[2] * bank.scale) / (heap.reach[2] * bank.scale),
        );
        const [from, to] = [into(eye), into(mark)];
        const along = to.clone().sub(from);
        const nearest = Math.max(0, Math.min(1, -from.dot(along) / along.lengthSq()));
        if (from.clone().addScaledVector(along, nearest).lengthSq() < 1) return false;
      }
    }
    return true;
  };
  // Where a walker's eye is on the dam: along its crest, 2.5 m over the ground.
  const eyes = [-0.6, -0.2, 0.3, 0.6].map((along) => {
    const spot = spotPosition(dam, { along, across: 0 });
    return new THREE.Vector3(spot.x, terrainHeight(spot.x, spot.z) + 2.5, spot.z);
  });

  it('is laid by one rule, two rows along the region\'s edge and bigger banks behind', () => {
    const ruled = fogBanks(REGIONS_BY_ID.fog.southEdgeZ, seededRandom(hashText('fog')));
    expect(banks.length).toBe(ruled.length);
    expect(banks.length).toBeGreaterThan(40);
    const edge = REGIONS_BY_ID.fog.southEdgeZ;
    expect(banks.filter((bank) => bank.z > edge - 60).length).toBeGreaterThan(15);
  });

  it('leaves the head of the Beacon\'s tower standing over it from the dam, lamp and top third', () => {
    for (const eye of eyes) {
      expect(clear(eye, new THREE.Vector3(tower.x, head + 1.2, tower.z)), `the lamp from ${eye.x.toFixed(0)}`).toBe(true);
      expect(clear(eye, new THREE.Vector3(tower.x, head - LANDMARK_HEIGHT.radio_tower! / 3, tower.z)), `a third down the tower from ${eye.x.toFixed(0)}`).toBe(true);
    }
  });

  it('is still a wall: from the dam it hides the Beacon\'s shore and the foot of its hill', () => {
    const shore = spotPosition(beacon, beacon.landing);
    for (const eye of eyes) {
      expect(clear(eye, new THREE.Vector3(shore.x, 1, shore.z)), `the landing from ${eye.x.toFixed(0)}`).toBe(false);
      expect(clear(eye, new THREE.Vector3(tower.x, foot * 0.4, tower.z + beacon.radiusZ * 0.6)), `the hill's foot from ${eye.x.toFixed(0)}`).toBe(false);
    }
  });
});

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
