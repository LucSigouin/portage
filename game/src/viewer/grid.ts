/**
 * The ground grid: thin flat strips lying on y = 0, drawn by the game's own builder in the game's own wash, so
 * they sit in the picture the way a ruled sheet sits under a drawing. Lines fall on whole multiples of the
 * spacing in world metres, and every fifth is bolder.
 */
import * as THREE from 'three';
import { KIND } from '../look/b2/detail.js';
import { Builder, THIN } from '../look/b2/geo.js';

/** Square sizes the grid may take, metres. */
export const SPACINGS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100] as const;

/** The finest spacing that keeps a thing of this size within about twelve squares. */
export function spacingFor(size: number): number {
  return SPACINGS.find((spacing) => size / spacing <= 12) ?? SPACINGS[SPACINGS.length - 1];
}

const MINOR = '#8d8b84';
const MAJOR = '#6c6e78';
/** Squares each side of the middle. */
const REACH = 12;

export interface Grid {
  mesh: THREE.Mesh;
  spacing: number;
  /** The square of the world the grid covers: min x, min z, max x, max z. */
  covers: [number, number, number, number];
}

/** A grid of `spacing` squares centred on the multiple of `spacing` nearest (x, z). */
export function buildGrid(spacing: number, x: number, z: number): Grid {
  const builder = new Builder(4242);
  const middleX = Math.round(x / spacing);
  const middleZ = Math.round(z / spacing);
  const length = REACH * 2 * spacing;
  const thickness = spacing * 0.012;
  const top = -spacing * 0.0006;
  for (let step = -REACH; step <= REACH; step += 1) {
    for (const along of ['z', 'x'] as const) {
      const index = (along === 'z' ? middleX : middleZ) + step;
      const major = index % 5 === 0;
      const width = spacing * (major ? 0.032 : 0.016);
      const [sizeX, sizeZ] = along === 'z' ? [width, length] : [length, width];
      const [centreX, centreZ] = along === 'z' ? [index * spacing, middleZ * spacing] : [middleX * spacing, index * spacing];
      builder.box(sizeX, thickness, sizeZ, major ? MAJOR : MINOR, { pos: [centreX, top - thickness / 2, centreZ], id: THIN, flat: true, kind: KIND.PLAIN });
    }
  }
  const mesh = builder.mesh();
  mesh.frustumCulled = false;
  return { mesh, spacing, covers: [(middleX - REACH) * spacing, (middleZ - REACH) * spacing, (middleX + REACH) * spacing, (middleZ + REACH) * spacing] };
}
