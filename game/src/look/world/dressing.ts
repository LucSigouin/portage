/**
 * What makes each island its own place, beyond its landmarks: the hydro wires
 * between the pylons, the track along the bridge, the wrecks under the buoys,
 * crags on the steep ground and skerries off it, drowned snags, the marsh's
 * herons, the lone pine over the camp, and the fog wall.
 *
 * Every rule reads the island's data (its landmarks, height, region and
 * nodes), never its name, and stands things on the rules' own ground.
 * terrain.ts hangs the result on the island's ground mesh: `always` is drawn
 * whenever the island is, `close` only from near by.
 */
import * as THREE from 'three';
import { NODES_BY_ISLAND, REGIONS_BY_ID, START, VALLEY_NORTH_SHORE_Z, spotPosition } from '../../data/index.ts';
import type { IslandDefinition, LandmarkDefinition } from '../../data/index.ts';
import { terrainHeight, valleyHalfWidth } from '../../sim/index.ts';
import { KIND } from '../b2/detail.js';
import { snag, whitePine } from '../b2/flora.js';
import { Builder } from '../b2/geo.js';
import type { Triple } from '../b2/geo.js';
import { PAL } from '../b2/palette.js';
import { DAY, DUSK, NIGHT } from '../daylight.ts';
import type { Direction } from '../daylight.ts';
import { presetIdFor } from '../presets.ts';
import { instancedMesh } from '../props.ts';
import type { InstanceTransform } from '../props.ts';
import { hashText, keepOutCircles, seededRandom, shoreLength } from '../scatter.ts';
import { LANDMARK_SUNK, PEN, TONE } from './kit.ts';

export interface Dressing {
  always: THREE.Group;
  close: THREE.Group;
  /** How many of each thing were placed: for the tests and the guide. */
  counts: Record<string, number>;
}

/** Where a pylon's wires hang, in its own frame: height, and reach along the arm. The earth wire runs from the peak. */
const WIRE_POINTS: readonly [number, number][] = [[17.7, 6.2], [17.7, -6.2], [23.2, 4.4], [23.2, -4.4], [28.1, 0]];
/** How far the pylon leans, radians (landmarks: the same number). */
const PYLON_LEAN = 0.04;
const WIRE_SAG = 3.4;

const library = new Map<string, THREE.BufferGeometry>();
function shape(key: string, seed: number, draw: (builder: Builder) => void, finish: (geometry: THREE.BufferGeometry) => THREE.BufferGeometry = (geometry) => geometry): THREE.BufferGeometry {
  let geometry = library.get(key);
  if (!geometry) {
    const builder = new Builder(seed);
    draw(builder);
    geometry = finish(builder.geometry());
    library.set(key, geometry);
  }
  return geometry;
}

export function disposeDressing(): void {
  for (const geometry of library.values()) geometry.dispose();
  library.clear();
}

/** A crag: a few frost-split blocks leaning on each other. `variant` 0 has moss on its head. */
function crag(builder: Builder, variant: number, tones: readonly string[]): void {
  const random = seededRandom(400 + variant);
  for (let block = 0; block < 3 + variant; block += 1) {
    const width = 1.7 + random() * 1.6;
    const height = 1.4 + random() * 1.7;
    const depth = 1.4 + random() * 1.3;
    const x = (random() - 0.5) * 2.8;
    const z = (random() - 0.5) * 2.2;
    builder.box(width, height, depth, tones[block % tones.length], {
      pos: [x, height / 2 - 0.5 + (block % 2) * 0.3, z], rot: [(random() - 0.5) * 0.4, random() * 3, (random() - 0.5) * 0.4], kind: KIND.STONE,
    });
    if (variant === 0 && block === 0) builder.box(width * 0.7, 0.08, depth * 0.7, PAL.moss, { pos: [x, height - 0.16, z], rot: [0, 0.4, 0], kind: KIND.PLAIN });
  }
}

/** A grey heron, standing: it does not move. */
function heron(builder: Builder): void {
  const grey = '#8fa0aa';
  for (const x of [-0.05, 0.05]) builder.beam([x, -0.5, 0.02], [x, 0.6, 0], 0.013, '#6f6a55', PEN, 4);
  builder.sphere(0.2, grey, { pos: [0, 0.74, 0.05], scale: [0.75, 0.85, 1.75], rot: [0.35, 0, 0], kind: KIND.PLAIN }, 8);
  builder.box(0.05, 0.2, 0.42, PAL.slate, { pos: [0.13, 0.72, 0.16], rot: [0.35, 0, 0], kind: KIND.PLAIN });
  builder.tube([[0, 0.84, -0.2], [0, 1.02, -0.3], [0, 1.18, -0.22], [0, 1.3, -0.26]], 0.034, '#dfe3df', { steps: 8, flat: true, kind: KIND.PLAIN }, 5);
  builder.sphere(0.06, '#e6e8e2', { pos: [0, 1.32, -0.29], scale: [0.8, 0.8, 1.5], flat: true, kind: KIND.PLAIN }, 6);
  builder.cone(0.022, 0.24, PAL.ochre, { pos: [0, 1.31, -0.47], rot: [-Math.PI / 2, 0, 0], flat: true, kind: KIND.PLAIN }, 5);
  builder.beam([0, 1.36, -0.27], [0, 1.3, -0.08], 0.012, PAL.ink, PEN, 4);
}

/** The top of a sunken wreck, breaking the surface. Three kinds: a tug, a launch, a houseboat. */
function wreck(builder: Builder, kind: number): void {
  if (kind === 0) {
    builder.cyl(0.55, 0.62, 2.8, TONE.tyre, { pos: [0, 0.9, 0], rot: [0.12, 0, 0.22], kind: KIND.METAL }, 10);
    builder.cyl(0.57, 0.6, 0.45, PAL.rust, { pos: [-0.2, 1.75, 0.1], rot: [0.12, 0, 0.22], kind: KIND.PAINT }, 10);
    builder.box(2.6, 0.7, 2.2, '#b9b3a2', { pos: [-2.1, -0.05, 0.3], rot: [0.1, 0, 0.2], kind: KIND.PAINT });
    builder.box(2.9, 0.14, 2.5, PAL.rustDark, { pos: [-2.17, 0.33, 0.34], rot: [0.1, 0, 0.2], kind: KIND.PAINT });
    builder.box(2.62, 0.3, 1.6, TONE.glassDark, { pos: [-2.12, 0.07, 0.3], rot: [0.1, 0, 0.2], flat: true, kind: KIND.PLAIN });
    builder.beam([1.9, -1, 0], [2.7, 4.4, 0.4], 0.06, PAL.woodDark, PEN, 5);
    builder.beam([1.7, 3.2, 0.3], [3.2, 3.5, 0.3], 0.03, PAL.woodDark, PEN, 4);
  } else if (kind === 1) {
    builder.sphere(1, PAL.cream, { pos: [0, -0.1, 0], scale: [0.95, 0.75, 3], rot: [-0.55, 0.2, 0.15], kind: KIND.PAINT }, 10);
    builder.box(0.1, 0.16, 3.4, PAL.rustDark, { pos: [0.1, 0.7, -0.7], rot: [-0.55, 0.2, 0.15], kind: KIND.PAINT });
    builder.box(1.5, 0.5, 0.08, TONE.glassDark, { pos: [0.1, 0.3, 1.2], rot: [-0.9, 0.2, 0.15], flat: true, kind: KIND.PLAIN });
    for (const x of [-0.7, 0.7]) builder.beam([x, 0.2, -1.6], [x * 0.5, 1.5, -2.5], 0.02, PAL.iron, PEN, 4);
  } else {
    builder.box(3.4, 1.1, 5.2, TONE.boatBlue, { pos: [0, -0.2, 0], rot: [0.06, 0, 0.16], kind: KIND.SIDING });
    builder.box(3.9, 0.14, 5.7, PAL.tin, { pos: [-0.08, 0.42, 0], rot: [0.06, 0, 0.16], kind: KIND.METAL });
    builder.cyl(0.11, 0.11, 1.2, PAL.rust, { pos: [0.8, 1, -1.4], rot: [0.06, 0, 0.16], kind: KIND.METAL }, 7);
    for (const z of [-1.5, 0.3, 2]) builder.box(0.08, 0.5, 0.9, TONE.glassDark, { pos: [1.68, 0.12, z], rot: [0.06, 0, 0.16], flat: true, kind: KIND.PLAIN });
    for (const z of [-2.7, 2.7]) builder.beam([-1.8, 0.2, z], [-1.95, 1.2, z], 0.025, PAL.iron, PEN, 4);
    builder.beam([-1.95, 1.2, -2.7], [-1.95, 1.2, 2.7], 0.02, PAL.iron, PEN, 4);
  }
}

/**
 * The one normal every fog heap wears. The wash has three tones, picked by the light on the normal, and a
 * face seen from behind is shaded by the normal turned round. A paddler crosses the wall, so a heap is seen
 * from inside too, and with its own normals the inside would be the shadow tone: dark fog. This normal lies
 * square to the light by day and by night, so both sides take the middle tone, the plain wash. At dusk the
 * outside stays plain and the inside goes to shade.
 */
export function fogNormal(): THREE.Vector3 {
  const shade = (light: Direction): THREE.Vector3 => new THREE.Vector3(light[0] * 0.8, light[1] * 0.8 + 0.2, light[2] * 0.8);
  const normal = new THREE.Vector3().crossVectors(shade(DAY.lightDirection), shade(NIGHT.lightDirection)).normalize();
  return normal.dot(shade(DUSK.lightDirection)) < 0 ? normal.negate() : normal;
}

function flatten(geometry: THREE.BufferGeometry, normal: THREE.Vector3): THREE.BufferGeometry {
  const normals = geometry.getAttribute('normal');
  for (let index = 0; index < normals.count; index += 1) normals.setXYZ(index, normal.x, normal.y, normal.z);
  return geometry;
}

/**
 * The three soft heaps of one bank of fog, before the instance's scale: where each one's middle is, and how far it
 * reaches each way. Fog lies low on the water: a bank is four times as broad as it is tall.
 */
export const FOG_HEAPS: readonly { at: Triple; reach: Triple }[] = [
  { at: [0, 0.1, 0], reach: [1.7, 0.38, 1.1] },
  { at: [1.35, 0.05, 0.25], reach: [1.05, 0.27, 0.75] },
  { at: [-1.3, 0.06, -0.2], reach: [1.2, 0.27, 0.8] },
];

/** A bank of fog: three soft heaps, one wash, no pen line. One unit is a metre before the instance's scale. */
function fogHeap(builder: Builder): void {
  const wash = { id: PEN.id, flat: true, kind: KIND.PLAIN } as const;
  for (const heap of FOG_HEAPS) builder.sphere(1, TONE.fog, { pos: heap.at, scale: heap.reach, ...wash }, 8);
}

/**
 * Where the banks of a fogged region lie, and how big each is. The wall: two rows along the region's edge, from
 * valley wall to valley wall, low enough that from the dam's crest the head of the Beacon's tower stands over
 * them, and high enough to hide the island's shore. Then it closes in behind: bigger banks far off, along both
 * valley walls and the far shore. Never turned: a turned heap would turn its normal out of the plain tone.
 */
export function fogBanks(southEdgeZ: number, random: () => number): InstanceTransform[] {
  const front = southEdgeZ - 32;
  const transforms: InstanceTransform[] = [];
  const heap = (x: number, z: number, size: number, lift: number): void => {
    transforms.push({ x, y: lift, z, yaw: 0, scale: size * (0.85 + random() * 0.3) });
  };
  for (const [row, size, spacing] of [[0, 30, 62], [1, 40, 96]] as const) {
    const z = front - row * 62;
    const half = valleyHalfWidth(z) + 30;
    for (let x = -half; x <= half; x += spacing) heap(x + (random() - 0.5) * spacing * 0.4, z + (random() - 0.5) * 14, size, -2 + row);
  }
  for (let z = front - 190; z > VALLEY_NORTH_SHORE_Z + 60; z -= 120) {
    for (const side of [-1, 1]) heap(side * (valleyHalfWidth(z) - 70 + random() * 30), z + (random() - 0.5) * 30, 60, -1);
  }
  for (let x = -valleyHalfWidth(VALLEY_NORTH_SHORE_Z) + 90; x < valleyHalfWidth(VALLEY_NORTH_SHORE_Z) - 60; x += 130) heap(x + (random() - 0.5) * 30, VALLEY_NORTH_SHORE_Z + 55 + random() * 20, 60, -1);
  return transforms;
}

const worldPoint = (island: IslandDefinition, landmark: LandmarkDefinition, x: number, y: number, z: number): Triple => {
  const spot = spotPosition(island, landmark.spot);
  const turn = -(landmark.bearing + island.rotation);
  const cosine = Math.cos(turn);
  const sine = Math.sin(turn);
  return [spot.x + x * cosine + z * sine, Math.max(0, terrainHeight(spot.x, spot.z)) - LANDMARK_SUNK + y, spot.z - x * sine + z * cosine];
};

/** A wire hung between two points, with `sag` metres of belly. */
function wire(builder: Builder, from: Triple, to: Triple, sag: number, radius = 0.035): void {
  const steps = 8;
  let before = from;
  for (let step = 1; step <= steps; step += 1) {
    const share = step / steps;
    const point: Triple = [
      from[0] + (to[0] - from[0]) * share,
      from[1] + (to[1] - from[1]) * share - sag * 4 * share * (1 - share),
      from[2] + (to[2] - from[2]) * share,
    ];
    builder.beam(before, point, radius, '#59656d', PEN, 4);
    before = point;
  }
}

/** The hydro line: five wires from pylon to pylon, and at each end two that droop away into the flood. */
function hydroLine(island: IslandDefinition, pylons: LandmarkDefinition[]): THREE.Mesh {
  const builder = new Builder(2400);
  const hang = (pylon: LandmarkDefinition, [height, reach]: readonly [number, number]): Triple => worldPoint(island, pylon, -PYLON_LEAN * height, height, reach);
  const line = [...pylons].sort((first, second) => first.spot.along - second.spot.along);
  for (let index = 0; index + 1 < line.length; index += 1) {
    for (const point of WIRE_POINTS) wire(builder, hang(line[index], point), hang(line[index + 1], point), WIRE_SAG);
  }
  for (const [end, away] of [[line[0], -1], [line[line.length - 1], 1]] as const) {
    for (const point of [WIRE_POINTS[1], WIRE_POINTS[2]]) {
      const from = hang(end, point);
      const reach = 46 + point[0];
      const drowned = worldPoint(island, end, away * reach, 0, point[1] * 1.4);
      wire(builder, from, [drowned[0], -0.6, drowned[2]], 4.5);
    }
  }
  return builder.mesh();
}

/** The railway along the bridge: two rails on the rules' ground from end to end, and the sleepers under them. */
function track(island: IslandDefinition): { rails: THREE.Mesh; sleepers: THREE.Mesh } {
  const rails = new Builder(2410);
  const sleepers = new Builder(2411);
  const long = island.radiusZ >= island.radiusX;
  const half = (long ? island.radiusZ : island.radiusX) * 0.9;
  const at = (along: number, side: number): Triple => {
    const point = spotPosition(island, long ? { along: side / island.radiusX, across: along / island.radiusZ } : { along: along / island.radiusX, across: side / island.radiusZ });
    return [point.x, terrainHeight(point.x, point.z), point.z];
  };
  const lift = (point: Triple, by: number): Triple => [point[0], point[1] + by, point[2]];
  for (let along = -half; along < half; along += 8) {
    for (const side of [-0.75, 0.75]) rails.beam(lift(at(along, side), 0.2), lift(at(Math.min(half, along + 8), side), 0.2), 0.07, '#6b5a50', { kind: KIND.METAL, flat: true, id: PEN.id }, 4);
  }
  for (let along = -half, index = 0; along <= half; along += 2.4, index += 1) {
    sleepers.plank(lift(at(along, -1.25), 0.08), lift(at(along, 1.25), 0.08), 0.26, 0.14, index % 3 ? PAL.woodDark : '#6a5444', { kind: KIND.WOOD });
  }
  // The buffer stop where the line gives out at the north end.
  const stop = at(-half, 0);
  rails.box(2.4, 0.3, 0.3, PAL.rust, { pos: lift(stop, 1), kind: KIND.METAL });
  for (const side of [-0.75, 0.75]) rails.beam(lift(at(-half, side), 0), lift(at(-half, side), 1), 0.07, PAL.rust, { kind: KIND.METAL }, 5);
  return { rails: rails.mesh(), sleepers: sleepers.mesh() };
}

const group = (): THREE.Group => {
  const made = new THREE.Group();
  made.matrixAutoUpdate = false;
  return made;
};

/** Everything that dresses one island. Same island in, same dressing out. */
export function dressIsland(island: IslandDefinition): Dressing {
  const always = group();
  const close = group();
  const counts: Record<string, number> = {};
  const random = seededRandom(hashText(`${island.id}.dressing`));
  const seed = hashText(island.id);
  const circles = keepOutCircles(island);
  const clear = (x: number, z: number, margin: number): boolean => !circles.some((circle) => Math.hypot(circle.x - x, circle.z - z) < circle.radius + margin);
  const has = (kind: LandmarkDefinition['kind']): boolean => island.landmarks.some((landmark) => landmark.kind === kind);
  const region = REGIONS_BY_ID[island.regionId];
  const preset = presetIdFor(island);
  const ring = (count: number, nearest: number, farthest: number, accept: (x: number, z: number, height: number) => boolean, make: (x: number, z: number, height: number) => InstanceTransform): InstanceTransform[] => {
    const placed: InstanceTransform[] = [];
    for (let index = 0; index < count; index += 1) {
      const angle = ((index + random()) / count) * Math.PI * 2;
      const reach = nearest + random() * (farthest - nearest);
      const point = spotPosition(island, { along: Math.cos(angle) * reach, across: Math.sin(angle) * reach });
      const height = terrainHeight(point.x, point.z);
      const made = make(point.x, point.z, height);
      if (accept(point.x, point.z, height)) placed.push(made);
    }
    return placed;
  };
  const add = (target: THREE.Group, name: string, geometry: THREE.BufferGeometry, transforms: InstanceTransform[], salt: number): void => {
    counts[name] = (counts[name] ?? 0) + transforms.length;
    if (transforms.length > 0) target.add(instancedMesh(geometry, transforms, seed + salt));
  };

  // Steep ground is rocky: crags on the slopes of any high island.
  if (island.peakHeight >= 20) {
    const tones = preset === 'ridge' ? ['#a7a6a6', '#b4a9a6', '#8f9092'] : ['#b3aba3', '#c3a79c', '#a59f9b'];
    for (let variant = 0; variant < 3; variant += 1) {
      const transforms = ring(Math.round(shoreLength(island) / 75), 0.4, 0.92, (x, z, height) => height > 2 && clear(x, z, 3),
        (x, z, height) => ({ x, y: height - 0.3, z, yaw: random() * 6.28, scale: 0.9 + random() * 0.9 }));
      add(always, 'crag', shape(`crag.${preset}.${variant}`, 2420 + variant, (builder) => crag(builder, variant, tones)), transforms, 11 + variant);
    }
  }
  // Rough water breaks on rock: skerries stand off every island of rock where the roughness is 3.
  if (region.roughness >= 3 && preset !== 'works') {
    const tones = preset === 'ridge' ? ['#a7a6a6', '#8f9092'] : ['#b3aba3', '#a59f9b'];
    const transforms = ring(Math.round(shoreLength(island) / 55), 1.04, 1.13, (x, z) => clear(x, z, 7),
      (x, z, height) => ({ x, y: Math.max(height, -1.1) - 0.2, z, yaw: random() * 6.28, scale: 0.7 + random() * 0.7 }));
    add(always, 'skerry', shape(`crag.${preset}.skerry`, 2424, (builder) => crag(builder, 1, tones)), transforms, 21);
  }
  // Drowned trees stand dead in the shallows round wet ground and in the Fog.
  if (preset === 'marsh' || region.fogWall) {
    for (let variant = 0; variant < 2; variant += 1) {
      const transforms = ring(Math.round(shoreLength(island) / (region.fogWall ? 60 : 55)), 1.03, 1.11, (x, z) => clear(x, z, 6),
        (x, z) => ({ x, y: 0, z, yaw: random() * 6.28, scale: 0.8 + random() * 0.5 }));
      add(always, 'snag', shape(`snag.${variant}`, 2430 + variant, (builder) => snag(builder, 0, 0, 5 + variant * 2.2, seededRandom(88 + variant))), transforms, 31 + variant);
    }
  }
  // Herons stand in the shallows off a reed bed, and do not move.
  if (has('reed_bed')) {
    const transforms = ring(7, 1.012, 1.04, (x, z, height) => height < 0 && height > -0.4 && clear(x, z, 6),
      (x, z) => ({ x, y: 0, z, yaw: random() * 6.28, scale: 1 }));
    add(close, 'heron', shape('heron', 2440, heron), transforms, 41);
  }
  // The island a game starts on is marked by one great pine over the camp.
  if (island.id === START.islandId) {
    const top = spotPosition(island, { along: 0.02, across: 0.05 });
    add(always, 'signal_pine', shape('signal_pine', 2450, (builder) => whitePine(builder, 0, 0, 0, 15, seededRandom(5))),
      [{ x: top.x, y: terrainHeight(top.x, top.z), z: top.z, yaw: 0.4, scale: 1.7 }], 51);
  }
  // Wires between the pylons.
  const pylons = island.landmarks.filter((landmark) => landmark.kind === 'pylon');
  if (pylons.length >= 2) {
    always.add(hydroLine(island, pylons));
    counts.wire_span = pylons.length - 1;
  }
  // The track along the bridge.
  if (has('truss_span')) {
    const laid = track(island);
    always.add(laid.rails);
    close.add(laid.sleepers);
    counts.track = 1;
  }
  // A wreck shows beside every buoy that marks one.
  const buoys = (NODES_BY_ISLAND[island.id] ?? []).filter((node) => node.typeId === 'wreck_buoy');
  buoys.forEach((buoy, index) => {
    const away = Math.atan2(buoy.position.z - island.center.z, buoy.position.x - island.center.x) + 0.6;
    const kind = hashText(buoy.id) % 3;
    add(always, 'wreck', shape(`wreck.${kind}`, 2460 + kind, (builder) => wreck(builder, kind)),
      [{ x: buoy.position.x + Math.cos(away) * 6.5, y: -0.25, z: buoy.position.z + Math.sin(away) * 6.5, yaw: (hashText(buoy.id) % 628) / 100, scale: 1 }], 61 + index);
  });
  // The fog wall along the edge of a fogged region, and the banks that close in behind it.
  if (region.fogWall) {
    add(always, 'fog_heap', shape('fog_heap', 2470, fogHeap, (geometry) => flatten(geometry, fogNormal())), fogBanks(region.southEdgeZ, random), 71);
  }
  return { always, close, counts };
}
