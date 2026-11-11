// The knoll's height field. Pure maths so the mesh, the shore foam bake and prop placement
// all agree on where the granite is.
import { fbm2, smoothstep, lerp } from './util.js';

export const ISLAND = { x: 0, z: -60, half: 34 };

const bump = (dx, dz, radius) => {
  const q = (dx * dx + dz * dz) / (radius * radius);
  return q < 1 ? (1 - q) * (1 - q) : 0;
};

/** Height in metres at island-local (x, z). Water is y = 0. +z faces the player's start. */
export function localH(x, z) {
  let h = -1.75;
  h += 7.4 * bump(x + 2, z + 4, 13.5); // main knoll
  h += 4.0 * bump(x + 11.5, z - 2.5, 8.5); // west shoulder
  h += 2.75 * bump(x - 4.5, z - 7.5, 11); // south landing shelf
  h += 3.1 * bump(x - 10.5, z + 0.5, 6.8); // east point (birches)
  const land = smoothstep(-0.6, 1.6, h);
  h += (fbm2(x * 0.17 + 3.1, z * 0.17 - 1.7) - 0.5) * 2.0 * land;
  h += (fbm2(x * 0.6, z * 0.6, 2) - 0.5) * 0.22 * land;
  // Shield granite steps: rounded ledges above the beach line.
  const stepSize = 0.85;
  const f = h / stepSize;
  const whole = Math.floor(f);
  const ledge = (whole + smoothstep(0.3, 0.9, f - whole)) * stepSize;
  return lerp(h, ledge, 0.82 * smoothstep(0.9, 2.0, h));
}

export const terrainH = (worldX, worldZ) => localH(worldX - ISLAND.x, worldZ - ISLAND.z);

/** World position on the island surface for island-local (x, z). */
export const onIsland = (x, z, lift = 0) => [ISLAND.x + x, Math.max(localH(x, z), 0) + lift, ISLAND.z + z];
