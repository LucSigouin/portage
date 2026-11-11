/**
 * Region presets: what the ground looks like and what grows on it. An island
 * gets its preset from its data (landmarks, peak height, region), never by
 * name, so a new island in `data/world.ts` is dressed with no work here.
 *
 * To add a preset: add an id, an entry in `PRESETS`, and a rule in `presetIdFor`.
 */
import type { IslandDefinition, LandmarkKind } from '../data/index.ts';
import type { TerrainPreset } from './b2/palette.js';

export type PresetId = 'knoll' | 'gravel' | 'marsh' | 'granite' | 'ridge' | 'works' | 'valley';

/** What grows. Densities are per hectare of dry land; shore counts are per 100 m of shoreline. */
export interface FloraMix {
  treesPerHectare: number;
  /** Shares of the trees. They need not add to 1. */
  spruce: number;
  pine: number;
  birch: number;
  scrubPerHectare: number;
  bouldersPerShore: number;
  reedsPerShore: number;
  sedgePerShore: number;
}

export interface RegionPreset {
  terrain: Partial<TerrainPreset>;
  flora: FloraMix;
  /** Metres of sand round the landing. */
  beachRadius: number;
}

export const PRESETS: Record<PresetId, RegionPreset> = {
  /** B2's island: granite, moss on the flats, mixed wood. The Shallows. */
  knoll: {
    // The rules engine's islands are smooth domes, flatter than B2's ledged knoll: left alone the moss rule would cover them.
    terrain: { mossBias: -0.16 },
    flora: { treesPerHectare: 70, spruce: 0.6, pine: 0.12, birch: 0.28, scrubPerHectare: 40, bouldersPerShore: 5, reedsPerShore: 3, sedgePerShore: 9 },
    beachRadius: 12,
  },
  /** Low gravel bars and pads in the Reach: pale stone, thin green, few trees. */
  gravel: {
    terrain: { rockA: '#bab3a5', rockB: '#c5b6a1', sand: '#d9ccac', mossBias: -0.22, tufts: 0.6, bedSpacing: 2 },
    flora: { treesPerHectare: 14, spruce: 0.5, pine: 0, birch: 0.5, scrubPerHectare: 30, bouldersPerShore: 8, reedsPerShore: 2, sedgePerShore: 6 },
    beachRadius: 16,
  },
  /** Wet low ground: green to the waterline, reeds all round. */
  marsh: {
    terrain: { mossA: '#9aa873', mossB: '#7f9163', mossBias: 0.2, mossFloor: 0.35, sand: '#cfc6a3' },
    flora: { treesPerHectare: 10, spruce: 0.4, pine: 0, birch: 0.6, scrubPerHectare: 50, bouldersPerShore: 1, reedsPerShore: 14, sedgePerShore: 14 },
    beachRadius: 10,
  },
  /** High bare rock in the Narrows: wide ledges, moss only on the tops, spruce and pine. */
  granite: {
    terrain: { rockA: '#b3aba3', rockB: '#c3a79c', mossSlope: 0.9, mossBias: -0.16, bedSpacing: 1.6, jointSpacing: 1.4 },
    flora: { treesPerHectare: 55, spruce: 0.7, pine: 0.3, birch: 0, scrubPerHectare: 15, bouldersPerShore: 9, reedsPerShore: 0.5, sedgePerShore: 4 },
    beachRadius: 12,
  },
  /** The high ground in the Fog: cold stone, dark green, close spruce. */
  ridge: {
    terrain: { rockA: '#a7a6a6', rockB: '#b4a9a6', rockDark: '#7d7c80', mossA: '#8f9c78', mossB: '#6f8266', mossBias: -0.08 },
    flora: { treesPerHectare: 60, spruce: 0.85, pine: 0.15, birch: 0, scrubPerHectare: 10, bouldersPerShore: 7, reedsPerShore: 0.5, sedgePerShore: 4 },
    beachRadius: 14,
  },
  /** Built things standing in the flood (the dam, the bridge): poured stone, no green. */
  works: {
    terrain: { rockA: '#bdbab1', rockB: '#c7c2b6', rockDark: '#9a9892', lichen: '#b9b08a', mossBias: -1, tufts: 0, bedSpacing: 2.4, jointSpacing: 3, sand: '#cfc8b4' },
    flora: { treesPerHectare: 3, spruce: 1, pine: 0, birch: 0, scrubPerHectare: 10, bouldersPerShore: 2, reedsPerShore: 0, sedgePerShore: 2 },
    beachRadius: 10,
  },
  /** The valley walls: forest as one green wash, rock only where it is steep. */
  valley: {
    terrain: { mossA: '#7f977c', mossB: '#5f7a68', mossSlope: 0.55, mossFloor: 1.5, mossBias: 0.12, tufts: 0 },
    flora: { treesPerHectare: 0, spruce: 1, pine: 0, birch: 0, scrubPerHectare: 0, bouldersPerShore: 0, reedsPerShore: 0, sedgePerShore: 0 },
    beachRadius: 0,
  },
};

const has = (island: IslandDefinition, ...kinds: LandmarkKind[]): boolean =>
  island.landmarks.some((landmark) => kinds.includes(landmark.kind));

/** The preset for an island, from its data alone. */
export function presetIdFor(island: IslandDefinition): PresetId {
  if (has(island, 'dam_wall', 'truss_span')) return 'works';
  if (has(island, 'reed_bed') || island.peakHeight < 2.6) return 'marsh';
  if (island.peakHeight >= 20) return island.regionId === 'fog' ? 'ridge' : 'granite';
  if (island.regionId === 'reach' && island.peakHeight <= 4.5) return 'gravel';
  return 'knoll';
}

/** The flora for an island: its preset's mix, bent by what the data says stands there. */
export function floraFor(island: IslandDefinition): FloraMix {
  const mix = { ...PRESETS[presetIdFor(island)].flora };
  if (has(island, 'birch_grove')) {
    mix.birch = 3;
    mix.treesPerHectare *= 1.3;
  }
  // Orchards and yards were cleared ground.
  if (has(island, 'orchard_rows', 'scrap_stack', 'silo')) mix.treesPerHectare *= 0.5;
  return mix;
}
