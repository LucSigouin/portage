import type {
  CampDefinition, IslandDefinition, IslandId, IslandSpot, LandmarkDefinition, LandmarkKind,
  RegionDefinition, RegionId, StationId,
} from './types.ts';

/**
 * Regions are bands across the valley, ordered south to north. Roughness is
 * the gate: water floods the canoe in proportion to roughness minus stability.
 */
export const REGIONS: RegionDefinition[] = [
  {
    id: 'shallows', name: 'The Shallows',
    description: 'Sheltered water over drowned fields. Home.',
    iconId: 'region_shallows', northEdgeZ: 450, southEdgeZ: 1500,
    roughness: 1, current: { x: 0, z: 0 }, fogWall: false,
  },
  {
    id: 'reach', name: 'The Reach',
    description: 'Open water with a long fetch. Chop that fills an unsteady hull.',
    iconId: 'region_reach', northEdgeZ: -350, southEdgeZ: 450,
    roughness: 2, current: { x: 0, z: 0 }, fogWall: false,
  },
  {
    id: 'narrows', name: 'The Narrows',
    description: 'The valley pinches and the water runs. Standing waves and a steady current.',
    iconId: 'region_narrows', northEdgeZ: -950, southEdgeZ: -350,
    roughness: 3, current: { x: 0, z: 0.6 }, fogWall: false,
  },
  {
    id: 'fog', name: 'The Fog',
    description: 'A grey wall past the dam. Without a light and a signal, every heading leads back out.',
    iconId: 'region_fog', northEdgeZ: -1500, southEdgeZ: -950,
    roughness: 3, current: { x: 0, z: 0 }, fogWall: true,
  },
];

export const REGION_IDS: RegionId[] = REGIONS.map((region) => region.id);

export const REGIONS_BY_ID: Record<RegionId, RegionDefinition> = Object.fromEntries(
  REGIONS.map((region) => [region.id, region]),
) as Record<RegionId, RegionDefinition>;

/**
 * Half-width of the flooded valley floor at each z, as control points the
 * terrain interpolates between (smoothstep). Beyond it the valley wall rises.
 */
export const VALLEY_HALF_WIDTH: { z: number; halfWidth: number }[] = [
  { z: -1500, halfWidth: 800 },
  { z: -1020, halfWidth: 800 },
  { z: -900, halfWidth: 520 },
  { z: -420, halfWidth: 520 },
  { z: -300, halfWidth: 1100 },
  { z: 1500, halfWidth: 1100 },
];

/** The lake ends at these shores; the valley wall rises beyond them. */
export const VALLEY_SOUTH_SHORE_Z = 1400;
export const VALLEY_NORTH_SHORE_Z = -1450;

const spot = (along: number, across: number): IslandSpot => ({ along, across });

const landmark = (kind: LandmarkKind, along: number, across: number, bearing = 0): LandmarkDefinition => ({
  kind, spot: spot(along, across), bearing,
});

const camp = (along: number, across: number, stations: StationId[]): CampDefinition => ({
  spot: spot(along, across), stations, sleep: true,
});

function island(
  id: IslandId,
  name: string,
  regionId: RegionId,
  centerX: number,
  centerZ: number,
  radiusX: number,
  radiusZ: number,
  peakHeight: number,
  landing: IslandSpot,
  description: string,
  extras: { rotation?: number; camp?: CampDefinition; landmarks?: LandmarkDefinition[] } = {},
): IslandDefinition {
  const length = Math.hypot(landing.along, landing.across);
  return {
    id, name, description, iconId: `island_${id}`, regionId,
    center: { x: centerX, z: centerZ }, radiusX, radiusZ,
    rotation: extras.rotation ?? 0, peakHeight,
    landing: { along: landing.along / length, across: landing.across / length },
    camp: extras.camp ?? null,
    landmarks: extras.landmarks ?? [],
  };
}

/** Fixed valley layout. Everyone gets the same islands. */
export const ISLANDS: IslandDefinition[] = [
  // The Shallows
  island('home_knoll', 'Home Knoll', 'shallows', 0, 1150, 58, 46, 7, spot(0, -1),
    'A granite knoll with a lean-to, a fire ring and a stump to work on.',
    {
      camp: camp(0.05, -0.5, ['fire', 'bench']),
      landmarks: [landmark('lean_to', -0.12, -0.42), landmark('campfire', 0.05, -0.5), landmark('stump_bench', 0.2, -0.45)],
    }),
  island('cabin_roofs', 'Cabin Roofs', 'shallows', -330, 985, 46, 36, 3.2, spot(1, 0.15),
    'Three cottage roofs on a drowned rise. The attics stayed dry.',
    { landmarks: [landmark('cabin_roof', -0.3, -0.2, 0.3), landmark('cabin_roof', 0.1, 0.25, 1.2), landmark('cabin_roof', 0.35, -0.3, 2.4)] }),
  island('birch_islet', 'Birch Islet', 'shallows', 300, 1010, 42, 40, 5, spot(-1, 0.1),
    'A round islet crowded with white birch.',
    { landmarks: [landmark('birch_grove', 0, 0)] }),
  island('orchard_hill', 'Orchard Hill', 'shallows', -250, 705, 72, 56, 10, spot(0.75, 0.66),
    'The top rows of an apple orchard, and the farmhouse Odile will not leave.',
    {
      camp: camp(0.3, 0.3, ['fire']),
      landmarks: [landmark('farmhouse', 0.1, 0.05, 2.2), landmark('orchard_rows', -0.3, -0.1), landmark('campfire', 0.3, 0.3), landmark('bedroll', 0.36, 0.24)],
    }),
  island('the_boathouse', 'The Boathouse', 'shallows', 330, 690, 52, 36, 3, spot(-1, 0),
    'A marina roof and a row of sheds. Tools, if the locks give.',
    { landmarks: [landmark('boathouse', 0.1, 0, 1.57), landmark('dock', -0.6, 0.3, 1.57)] }),
  // The Reach
  island('steeple_rock', 'Steeple Rock', 'reach', 40, 250, 46, 46, 9, spot(0, 1),
    'The church hill. The steeple still stands, and Wren still rings the hours.',
    {
      camp: camp(0.1, 0.45, ['fire']),
      landmarks: [landmark('steeple', 0, 0), landmark('campfire', 0.1, 0.45), landmark('bedroll', 0.2, 0.4)],
    }),
  island('silo_twins', 'Silo Twins', 'reach', -420, 170, 62, 36, 4, spot(1, 0),
    'Two grain silos on a gravel pad, with the farm’s machinery rusting between them.',
    { landmarks: [landmark('silo', -0.35, 0), landmark('silo', 0.2, -0.1)] }),
  island('pylon_line', 'Pylon Line', 'reach', 430, 60, 95, 26, 4, spot(-1, 0),
    'A ridge of footings where the hydro line crossed. Three pylons lean but hold.',
    { rotation: 0.5, landmarks: [landmark('pylon', -0.55, 0), landmark('pylon', 0, 0), landmark('pylon', 0.55, 0)] }),
  island('scrapyard_bar', 'Scrapyard Bar', 'reach', -300, -170, 82, 40, 3, spot(1, 0),
    'A gravel bar heaped with wrecks. Tink sorts it, one bolt at a time.',
    {
      camp: camp(0.35, 0.1, ['fire', 'forge']),
      landmarks: [landmark('scrap_stack', -0.3, 0.1), landmark('crane_arm', -0.55, -0.2), landmark('forge_hearth', 0.35, 0.1), landmark('bedroll', 0.42, 0.2)],
    }),
  island('heron_marsh', 'Heron Marsh', 'reach', 260, -215, 76, 60, 2.2, spot(-1, 0),
    'Low ground thick with cattails. Herons stand in the shallows and do not move.',
    { landmarks: [landmark('reed_bed', -0.3, 0.3), landmark('reed_bed', 0.3, -0.2)] }),
  // The Narrows
  island('truss_bridge', 'Truss Bridge', 'narrows', 0, -440, 17, 160, 4.5, spot(0, 1),
    'A railway bridge deck, its south end still in the Reach. Wrecks lie under its piers.',
    { landmarks: [landmark('truss_span', 0, -0.5), landmark('truss_span', 0, 0), landmark('truss_span', 0, 0.5)] }),
  island('quarry_face', 'Quarry Face', 'narrows', -300, -650, 100, 38, 30, spot(1, 0),
    'A cut granite wall, sheer on two sides. Walk the spine, not the face.',
    { landmarks: [landmark('quarry_cut', -0.2, 0.5, 3.14)] }),
  island('fire_tower_ridge', 'Fire Tower Ridge', 'narrows', 310, -735, 95, 48, 26, spot(-1, 0),
    'A long ridge with a lookout tower. From the top you can take a bearing on the Beacon.',
    {
      camp: camp(-0.5, 0, ['fire']),
      landmarks: [landmark('fire_tower', 0.05, 0), landmark('campfire', -0.5, 0), landmark('bedroll', -0.45, 0.12)],
    }),
  island('dam_crest', 'Dam Crest', 'narrows', -40, -905, 150, 15, 5, spot(-1, 0),
    'The top of the hydro dam. The Fog starts on its far side.',
    { landmarks: [landmark('dam_wall', 0, 0, 1.57), landmark('gatehouse', 0.5, 0)] }),
  // The Fog
  island('the_beacon', 'The Beacon', 'fog', 0, -1260, 150, 110, 30, spot(0, 1),
    'High Ridge. A radio tower stands dark on the summit, waiting to be lit.',
    {
      camp: camp(0, 0.55, ['fire']),
      landmarks: [landmark('radio_tower', 0, 0), landmark('keeper_hut', 0.08, 0.5), landmark('campfire', 0, 0.55)],
    }),
];

export const ISLAND_IDS: IslandId[] = ISLANDS.map((definition) => definition.id);

export const ISLANDS_BY_ID: Record<IslandId, IslandDefinition> = Object.fromEntries(
  ISLANDS.map((definition) => [definition.id, definition]),
) as Record<IslandId, IslandDefinition>;

/** World position of an island-local spot. */
export function spotPosition(definition: IslandDefinition, islandSpot: IslandSpot): { x: number; z: number } {
  const localX = islandSpot.along * definition.radiusX;
  const localZ = islandSpot.across * definition.radiusZ;
  const cosine = Math.cos(definition.rotation);
  const sine = Math.sin(definition.rotation);
  return {
    x: definition.center.x + localX * cosine - localZ * sine,
    z: definition.center.z + localX * sine + localZ * cosine,
  };
}

/** Where a new game starts: afloat, north of Home Knoll, bow toward it. */
export const START = {
  islandId: 'home_knoll' as IslandId,
  canoe: { x: 12, z: 1040, heading: Math.PI },
};

/**
 * Wave components. The water surface is
 *
 *   height(x, z, t) = roughness * sum_i amplitude_i *
 *       sin(wavenumber_i * (directionX_i * x + directionZ_i * z) - angularFrequency_i * t + phase_i)
 *
 * A GLSL shader reproduces the surface exactly from these numbers.
 * `amplitude` is metres per point of roughness.
 */
export interface WaveComponent {
  directionX: number;
  directionZ: number;
  /** Radians per metre. */
  wavenumber: number;
  /** Radians per second. */
  angularFrequency: number;
  amplitude: number;
  phase: number;
}

function wave(bearingDegrees: number, wavelength: number, amplitude: number, phase: number): WaveComponent {
  const bearing = (bearingDegrees * Math.PI) / 180;
  const wavenumber = (2 * Math.PI) / wavelength;
  return {
    directionX: Math.sin(bearing),
    directionZ: -Math.cos(bearing),
    wavenumber,
    angularFrequency: Math.sqrt(9.81 * wavenumber),
    amplitude,
    phase,
  };
}

export const WAVE_TABLE: readonly WaveComponent[] = [
  wave(168, 41, 0.085, 0.0),
  wave(203, 23, 0.05, 1.7),
  wave(131, 13, 0.028, 3.9),
  wave(236, 7.5, 0.014, 5.2),
];
