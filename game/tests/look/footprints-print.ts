/**
 * Prints `LANDMARK_FOOTPRINTS` for `src/data/footprints.ts`, measured from the drawings. Run from `game/`:
 *   node --experimental-strip-types tests/look/footprints-print.ts
 */
import { WALK_ON_LANDMARKS } from '../../src/data/footprints.ts';
import { ISLANDS } from '../../src/data/index.ts';
import type { LandmarkKind } from '../../src/data/index.ts';
import { measureFootprint } from './footprints.ts';

const kinds = [...new Set(ISLANDS.flatMap((island) => island.landmarks.map((landmark) => landmark.kind)))]
  .filter((kind) => !WALK_ON_LANDMARKS.includes(kind))
  .sort() as LandmarkKind[];
const lines = ['export const LANDMARK_FOOTPRINTS: Partial<Record<LandmarkKind, Footprint>> = {'];
for (const kind of kinds) {
  const footprint = measureFootprint(kind);
  lines.push(`  ${kind}: {`, `    x: ${footprint.x}, z: ${footprint.z},`, '    rows: [');
  for (const row of footprint.rows) lines.push(`      '${row}',`);
  lines.push('    ],', '  },');
}
lines.push('};');
console.log(lines.join('\n'));
