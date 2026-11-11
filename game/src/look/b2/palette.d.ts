import type { Color, DataTexture, IUniform, ShaderMaterial, Vector3, Vector4, Object3D } from 'three';
import type { WAVE_UNIFORMS } from './waves.js';

/** B2's colours, as display values. */
export const PAL: Record<
  | 'paper' | 'paperDeep' | 'ink' | 'inkSoft' | 'mist' | 'skyTop' | 'skyLow' | 'cloud' | 'sun' | 'waterDeep' | 'waterMid'
  | 'waterPale' | 'inkBlue' | 'foam' | 'sage' | 'sageDeep' | 'pine' | 'pineDark' | 'moss' | 'mossDeep' | 'rust' | 'rustLight'
  | 'rustDark' | 'ochre' | 'ochreLight' | 'cream' | 'canvas' | 'canvasSage' | 'granite' | 'granitePink' | 'graniteDark'
  | 'sand' | 'lichen' | 'wood' | 'woodLight' | 'woodDark' | 'driftwood' | 'bark' | 'birch' | 'iron' | 'tin' | 'slate'
  | 'barrelBlue' | 'skin' | 'glow', string>;

export function glsl(hex: string): string;

/** The uniforms every material shares: time, light, mist, pass switches, the time-of-day palette, the water surface. */
export const GU: typeof WAVE_UNIFORMS & {
  uTime: IUniform<number>;
  uLightDir: IUniform<Vector3>;
  uPaper: IUniform<Color>;
  uShadowTint: IUniform<Color>;
  uFogColor: IUniform<Color>;
  uFogDensity: IUniform<number>;
  uFlip: IUniform<number>;
  uPass: IUniform<number>;
  uFine: IUniform<number>;
  uHatch: IUniform<number>;
  uPxK: IUniform<number>;
  uSc: IUniform<number>;
  uLight: IUniform<Color>;
  uSkyTop: IUniform<Color>;
  uSkyLow: IUniform<Color>;
  uCloud: IUniform<Color>;
  uCloudLight: IUniform<Color>;
  uSunColor: IUniform<Color>;
  uSunDir: IUniform<Vector3>;
  uSunGlow: IUniform<number>;
  uFarTint: IUniform<Color>;
  uOvercast: IUniform<number>;
  uWaterDeep: IUniform<Color>;
  uWaterMid: IUniform<Color>;
  uWaterPale: IUniform<Color>;
  uInkBlue: IUniform<Color>;
  uFoam: IUniform<Color>;
  tNoise: IUniform<DataTexture>;
};

export const NOISE: string;

/** The wash-and-pen material for everything built with `Builder`. */
export const inkMaterial: ShaderMaterial;

/** What a terrain preset may change. Colours are hex strings. */
export interface TerrainPreset {
  rockA: string; rockB: string; rockDark: string; lichen: string; mossA: string; mossB: string; sand: string;
  /** Moss grows where the ground is flatter than this (normal.y), above `mossFloor` metres. */
  mossSlope: number; mossFloor: number;
  /** Added to the moss rule: positive spreads the green, negative bares the rock. */
  mossBias: number;
  /** Strength of the drawn grass tufts, 0 to 1. */
  tufts: number;
  /** Metres between bedding lines, and between joints on steep faces. */
  bedSpacing: number; jointSpacing: number;
}
export const TERRAIN_DEFAULTS: TerrainPreset;
export function terrainMaterialFor(preset?: Partial<TerrainPreset>): ShaderMaterial & { uniforms: { uMoss: IUniform<Vector4> } };
/** Put every mesh under `root` in its mirror material ('mirror': it discards below the waterline) or back in its own ('plain'). */
export function wearMaterials(root: Object3D, which: 'mirror' | 'plain'): void;
