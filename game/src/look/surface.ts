/**
 * The numbers the shaders need to know where the water and the ground are,
 * packed from the rules engine's own tables. Pure, so the tests can check the
 * packing against `waveHeight` and `terrainHeight` without a graphics card.
 *
 * `mirrorWaveSum` and `mirrorGround` repeat the shaders' arithmetic line for
 * line (waves.js `waveSum`, water.js `groundAt`). Keep the three in step.
 */
import { ISLANDS, REGIONS, TUNING, VALLEY_NORTH_SHORE_Z, VALLEY_SOUTH_SHORE_Z, WAVE_TABLE } from '../data/index.ts';
import type { IslandDefinition } from '../data/index.ts';
import { valleyHalfWidth } from '../sim/index.ts';

export type Vector4Tuple = [number, number, number, number];

/** Per wave: wavenumber × directionX, wavenumber × directionZ, amplitude, phase at `time`. */
export function waveUniforms(time: number): Vector4Tuple[] {
  // The phase is wrapped here, in double precision, so hours of play lose nothing in the shader's floats.
  return WAVE_TABLE.map((component) => [
    component.wavenumber * component.directionX,
    component.wavenumber * component.directionZ,
    component.amplitude,
    (component.phase - component.angularFrequency * time) % (Math.PI * 2),
  ]);
}

/** Per roughness band: north edge z, south edge z, roughness, roughness of the band to its south (-1: none). */
export function regionUniforms(): Vector4Tuple[] {
  return REGIONS.map((region, index) => [region.northEdgeZ, region.southEdgeZ, region.roughness, index > 0 ? REGIONS[index - 1].roughness : -1]);
}

export interface ShoreUniforms {
  /** Per island: centre x, centre z, 1 / radius x, 1 / radius z. */
  isleA: Vector4Tuple[];
  /** Per island: cos, sin of its rotation, peak height (-1: unused), reach. */
  isleB: Vector4Tuple[];
  /** Valley half width at `valleyZ`, its change per metre of z, south shore z, north shore z. */
  valley: Vector4Tuple;
  valleyZ: number;
}

/** Seabed depth, shelf width in radii, valley wall slope, bump height. */
export const GROUND_UNIFORM: Vector4Tuple = [TUNING.world.seabedDepth, TUNING.world.shelfWidth, TUNING.world.valleyWallSlope, TUNING.world.bumpHeight];

const reachOf = (island: IslandDefinition): number => Math.max(island.radiusX, island.radiusZ) * (1 + TUNING.world.shelfWidth);

/** The ground the water shader knows round a point: the `count` nearest islands and the valley's shore there. */
export function shoreUniforms(x: number, z: number, count: number): ShoreUniforms {
  const nearest = ISLANDS
    .map((island) => ({ island, gap: Math.hypot(island.center.x - x, island.center.z - z) - reachOf(island) }))
    .sort((first, second) => first.gap - second.gap);
  const isleA: Vector4Tuple[] = [];
  const isleB: Vector4Tuple[] = [];
  for (let index = 0; index < count; index += 1) {
    const island = nearest[index]?.island;
    isleA.push(island ? [island.center.x, island.center.z, 1 / island.radiusX, 1 / island.radiusZ] : [0, 0, 1, 1]);
    isleB.push(island ? [Math.cos(island.rotation), Math.sin(island.rotation), island.peakHeight, reachOf(island)] : [1, 0, -1, 0]);
  }
  return {
    isleA,
    isleB,
    valley: [valleyHalfWidth(z), (valleyHalfWidth(z + 5) - valleyHalfWidth(z - 5)) / 10, VALLEY_SOUTH_SHORE_Z, VALLEY_NORTH_SHORE_Z],
    valleyZ: z,
  };
}

const smooth01 = (value: number): number => {
  const share = Math.max(0, Math.min(1, value));
  return share * share * (3 - 2 * share);
};

/** waves.js `waveSum`, in JavaScript: the surface the shader draws from these uniforms. */
export function mirrorWaveSum(waves: Vector4Tuple[], regions: Vector4Tuple[], regionBlend: number, storm: number, x: number, z: number): number {
  let region = z > 0 ? regions[0] : regions[regions.length - 1];
  for (const candidate of regions) if (z > candidate[0] && z <= candidate[1]) region = candidate;
  let roughness = region[2];
  if (region[3] >= 0 && region[3] < region[2]) roughness = region[3] + (region[2] - region[3]) * smooth01((region[1] - z) / regionBlend);
  let height = 0;
  for (const wave of waves) height += wave[2] * Math.sin(wave[0] * x + wave[1] * z + wave[3]);
  return (roughness + storm) * height;
}

/** water.js `groundAt`, in JavaScript: the ground the water shader sees from these uniforms. */
export function mirrorGround(shore: ShoreUniforms, ground: Vector4Tuple, x: number, z: number): number {
  const [seabedDepth, shelfWidth, wallSlope, bumpHeight] = ground;
  const shoreDistance = Math.max(Math.abs(x) - (shore.valley[0] + shore.valley[1] * (z - shore.valleyZ)), z - shore.valley[2], shore.valley[3] - z);
  let height = Math.max(-seabedDepth, shoreDistance * wallSlope);
  const outer = 1 + shelfWidth;
  shore.isleA.forEach((isleA, index) => {
    const isleB = shore.isleB[index];
    const offsetX = x - isleA[0];
    const offsetZ = z - isleA[1];
    if (isleB[2] < 0 || Math.abs(offsetX) > isleB[3] || Math.abs(offsetZ) > isleB[3]) return;
    const along = (offsetX * isleB[0] + offsetZ * isleB[1]) * isleA[2];
    const across = (-offsetX * isleB[1] + offsetZ * isleB[0]) * isleA[3];
    const distanceSquared = along * along + across * across;
    if (distanceSquared >= outer * outer) return;
    const islandHeight = distanceSquared <= 1
      ? (1 - distanceSquared) * (isleB[2] + bumpHeight * Math.sin(x * 0.21 + z * 0.13) * Math.sin(z * 0.17 - x * 0.09))
      : -seabedDepth * smooth01((Math.sqrt(distanceSquared) - 1) / shelfWidth);
    height = Math.max(height, islandHeight);
  });
  return height;
}
