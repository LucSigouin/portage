import type { IUniform, Vector4 } from 'three';

export const WAVE_COUNT: number;
export const REGION_COUNT: number;
/** The most the chop reaches per point of roughness, metres: the amplitudes of the rules' `WAVE_TABLE` added up, without its longest wave. */
export const WAVE_CHOP: number;
export const WAVE_UNIFORMS: {
  uWave: IUniform<Vector4[]>;
  uRegion: IUniform<Vector4[]>;
  uWaveArea: IUniform<Vector4>;
  uRegionBlend: IUniform<number>;
  uStorm: IUniform<number>;
};
/** GLSL: `waterRoughness(z)`, `waveSum(xz)` (the rules engine's surface) and `waveSurface(xz)` (as drawn). */
export const WAVES: string;
