/**
 * What grows on each island, for the rules: the same mix the look picks (`look/presets.ts`, `floraFor`), read from
 * the island's data and never its name. The rules need it because trees and rocks are solid (Luc's list, line 1):
 * `sim/scatter.ts` places them from this mix, and the look draws the same placements from its own. A test holds
 * the two mixes equal on every island (`tests/look/solids.test.ts`), so a tree the look draws is a tree you bump into.
 */
import type { IslandDefinition, LandmarkKind } from './types.ts';

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

/** The kinds of ground, as the look names them (`look/presets.ts`, `PresetId`). */
export type FloraPresetId = 'knoll' | 'gravel' | 'marsh' | 'granite' | 'ridge' | 'works' | 'valley';

/** The flora of each kind of ground: the numbers of `PRESETS[...].flora` in `look/presets.ts`. */
export const FLORA_PRESETS: Record<FloraPresetId, FloraMix> = {
  knoll: { treesPerHectare: 70, spruce: 0.55, pine: 0.12, birch: 0.33, scrubPerHectare: 40, bouldersPerShore: 4, reedsPerShore: 5, sedgePerShore: 9 },
  gravel: { treesPerHectare: 14, spruce: 0.5, pine: 0, birch: 0.5, scrubPerHectare: 30, bouldersPerShore: 8, reedsPerShore: 2, sedgePerShore: 6 },
  marsh: { treesPerHectare: 7, spruce: 0.4, pine: 0, birch: 0.6, scrubPerHectare: 50, bouldersPerShore: 1, reedsPerShore: 22, sedgePerShore: 16 },
  granite: { treesPerHectare: 55, spruce: 0.7, pine: 0.3, birch: 0, scrubPerHectare: 15, bouldersPerShore: 12, reedsPerShore: 0, sedgePerShore: 3 },
  ridge: { treesPerHectare: 78, spruce: 0.92, pine: 0.08, birch: 0, scrubPerHectare: 10, bouldersPerShore: 7, reedsPerShore: 0.5, sedgePerShore: 4 },
  works: { treesPerHectare: 0, spruce: 1, pine: 0, birch: 0, scrubPerHectare: 4, bouldersPerShore: 2, reedsPerShore: 0, sedgePerShore: 2 },
  valley: { treesPerHectare: 0, spruce: 1, pine: 0, birch: 0, scrubPerHectare: 0, bouldersPerShore: 0, reedsPerShore: 0, sedgePerShore: 0 },
};

const has = (island: IslandDefinition, ...kinds: LandmarkKind[]): boolean =>
  island.landmarks.some((landmark) => kinds.includes(landmark.kind));

/** The kind of ground of an island, from its data alone: `presetIdFor` in `look/presets.ts`. */
export function floraPresetFor(island: IslandDefinition): FloraPresetId {
  if (has(island, 'dam_wall', 'truss_span')) return 'works';
  if (has(island, 'reed_bed') || island.peakHeight < 2.6) return 'marsh';
  if (island.peakHeight >= 20) return island.regionId === 'fog' ? 'ridge' : 'granite';
  if (island.regionId === 'reach' && island.peakHeight <= 4.5) return 'gravel';
  return 'knoll';
}

/** The flora of an island: its ground's mix, bent by what stands there. `floraFor` in `look/presets.ts`. */
export function floraMixFor(island: IslandDefinition): FloraMix {
  const mix = { ...FLORA_PRESETS[floraPresetFor(island)] };
  if (has(island, 'birch_grove')) Object.assign(mix, { birch: 1, spruce: 0.04, pine: 0, treesPerHectare: mix.treesPerHectare * 1.5 });
  if (has(island, 'orchard_rows', 'scrap_stack', 'silo')) mix.treesPerHectare *= 0.5;
  if (has(island, 'steeple')) mix.treesPerHectare *= 0.65;
  if (has(island, 'cabin_roof')) Object.assign(mix, { treesPerHectare: mix.treesPerHectare * 0.4, spruce: 0.25, pine: 0.15, birch: 0.6 });
  if (has(island, 'boathouse')) Object.assign(mix, { treesPerHectare: mix.treesPerHectare * 0.45, spruce: 0.25, pine: 0.6, birch: 0.15 });
  if (has(island, 'pylon')) mix.treesPerHectare *= 0.3;
  if (has(island, 'quarry_cut')) mix.treesPerHectare *= 0.55;
  if (has(island, 'fire_tower')) Object.assign(mix, { spruce: 0.45, pine: 0.55 });
  return mix;
}
