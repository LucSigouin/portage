/**
 * Prints where every scavenge spot's drawing stands at body height, as a grid, with the rules' circles
 * (`NODE_SOLIDS` in `src/data/footprints.ts`) laid over it: `#` drawn and inside a circle, `!` drawn and outside
 * every circle, `o` inside a circle with nothing drawn, `+` the spot's own middle. Run from `game/`:
 *   node --experimental-strip-types tests/look/node-outline-print.ts [type] [low] [high]
 */
import { FOOTPRINT_BAND, NODE_SOLIDS } from '../../src/data/footprints.ts';
import type { NodeTypeId } from '../../src/data/index.ts';
import { NODE_TYPE_IDS } from '../../src/look/nodes.ts';
import { nodeOutline } from './node-outline.ts';

// No Node typings are installed in this project (see `vite.config.ts`): the arguments are read off the global.
const args = ((globalThis as unknown as { process?: { argv: string[] } }).process?.argv ?? []).slice(2);
const only = args[0] && args[0] !== 'all' ? args[0] : null;
const low = args[1] ? Number(args[1]) : FOOTPRINT_BAND.low;
const high = args[2] ? Number(args[2]) : FOOTPRINT_BAND.high;
const cell = 0.1;

for (const typeId of NODE_TYPE_IDS as NodeTypeId[]) {
  if (only && typeId !== only) continue;
  const points = nodeOutline(typeId, low, high);
  const circles = NODE_SOLIDS[typeId];
  if (points.length === 0 && circles.length === 0) {
    console.log(`${typeId}: nothing between ${low} and ${high} m, and no circle\n`);
    continue;
  }
  const xs = [...points.map((point) => point.x), ...circles.flatMap(([x, , radius]) => [x - radius, x + radius]), 0];
  const zs = [...points.map((point) => point.z), ...circles.flatMap(([, z, radius]) => [z - radius, z + radius]), 0];
  const left = Math.floor(Math.min(...xs) / cell);
  const right = Math.floor(Math.max(...xs) / cell);
  const top = Math.floor(Math.min(...zs) / cell);
  const bottom = Math.floor(Math.max(...zs) / cell);
  const drawn = new Set(points.map((point) => `${Math.floor(point.x / cell)},${Math.floor(point.z / cell)}`));
  const inside = (x: number, z: number): boolean => circles.some(([circleX, circleZ, radius]) => Math.hypot(x - circleX, z - circleZ) <= radius);
  const worst = points.reduce((most, point) => Math.max(most, circles.length === 0 ? Infinity : Math.min(...circles.map(([x, z, radius]) => Math.hypot(point.x - x, point.z - z) - radius))), -Infinity);
  console.log(`${typeId}: x from ${(left * cell).toFixed(1)}, z from ${(top * cell).toFixed(1)}, ${cell} m a cell, ${points.length} points, farthest outside a circle ${worst.toFixed(2)} m`);
  for (let row = top; row <= bottom; row += 1) {
    let line = '';
    for (let column = left; column <= right; column += 1) {
      const isDrawn = drawn.has(`${column},${row}`);
      const isInside = inside((column + 0.5) * cell, (row + 0.5) * cell);
      line += column === 0 && row === 0 && !isDrawn ? '+' : isDrawn ? (isInside ? '#' : '!') : isInside ? 'o' : '.';
    }
    console.log(`  ${line}`);
  }
  console.log('');
}
