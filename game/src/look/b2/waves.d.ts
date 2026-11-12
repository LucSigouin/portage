import type { IUniform, Vector4 } from 'three';

export const WAVE_COUNT: number;
export const REGION_COUNT: number;
/** The most the wave sum reaches per point of roughness, metres: the amplitudes of the rules' `WAVE_TABLE`, added up. */
export const WAVE_AMPLITUDE: number;
export const WAVE_UNIFORMS: {
  uWave: IUniform<Vector4[]>;
  uRegion: IUniform<Vector4[]>;
  uWaveArea: IUniform<Vector4>;
  uRegionBlend: IUniform<number>;
  uStorm: IUniform<number>;
};
/** GLSL: `waterRoughness(z)`, `waveSum(xz)` (the rules engine's surface) and `waveSurface(xz)` (as drawn). */
export const WAVES: string;
