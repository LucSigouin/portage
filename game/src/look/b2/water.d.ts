import type { Camera, IUniform, Mesh, Texture, Vector2, Vector4, WebGLRenderer } from 'three';

/** How many islands the water shader knows the ground of at once. */
export const SHORE_ISLANDS: number;

export interface Water {
  mesh: Mesh;
  uniforms: {
    uDrift: IUniform<Vector2>;
    /** Per island: centre x, centre z, 1 / radius x, 1 / radius z. */
    uIsleA: IUniform<Vector4[]>;
    /** Per island: cos, sin of its rotation, peak height (-1: unused), reach. */
    uIsleB: IUniform<Vector4[]>;
    /** Valley half width at `uValleyZ`, its change per metre of z, south shore z, north shore z. */
    uValley: IUniform<Vector4>;
    uValleyZ: IUniform<number>;
    /** Seabed depth, shelf width in radii, valley wall slope, bump height. */
    uGround: IUniform<Vector4>;
    uReflect: IUniform<number>;
  } & Record<string, IUniform>;
  /** Metres between vertices where the waves are drawn. */
  setDetail(cellSize: number): void;
  readonly cell: number;
  /** A white brush ring on the water: a paddle dip, a splash. */
  ring(x: number, z: number, strength?: number, size?: number): void;
  /** Lay the wake. Bow position, heading as a unit vector, speed. */
  update(
    seconds: number, bowX: number, bowZ: number, forwardX: number, forwardZ: number, speed: number,
    driftX?: number, driftZ?: number, halfBeam?: number,
  ): void;
  follow(camera: Camera, x: number, z: number): void;
  renderWake(renderer: WebGLRenderer): void;
  dispose(): void;
}
export function createWater(reflection: Texture, resolution: Vector2): Water;
