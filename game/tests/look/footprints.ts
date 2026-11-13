/**
 * Measures a landmark's footprint from its drawing: what stands at body height (`FOOTPRINT_BAND` above the ground
 * under it), on the rules' grid. The rules keep the result as data (`src/data/footprints.ts`); the look test holds
 * the two equal, and `footprints-print.ts` prints fresh data when a drawing changes.
 *
 * - Every triangle of the drawing is sampled every `SAMPLE_SPACING` metres. A sample counts when it is between
 *   `FOOTPRINT_BAND.low` and `FOOTPRINT_BAND.high` above the rules' ground at that point, in the landmark's frame
 *   (as `siteAt` gives it: the first placement of the kind in the island table).
 * - Its grid cell is solid. Cells the outside cannot reach (a closed hut, the middle of a fire ring) are solid too.
 */
import * as THREE from 'three';
import { FOOTPRINT_BAND, FOOTPRINT_CELL, FOOTPRINT_LOW } from '../../src/data/footprints.ts';
import type { Footprint } from '../../src/data/footprints.ts';
import { ISLANDS } from '../../src/data/index.ts';
import type { LandmarkKind } from '../../src/data/index.ts';
import { landmarkGeometry } from '../../src/look/landmarks.ts';
import { siteAt } from '../../src/look/world/kit.ts';

const SAMPLE_SPACING = 0.12;

function firstSite(kind: LandmarkKind): ReturnType<typeof siteAt> {
  for (const island of ISLANDS) {
    const landmark = island.landmarks.find((candidate) => candidate.kind === kind);
    if (landmark) return siteAt(island, landmark);
  }
  throw new Error(`no ${kind} in the island table`);
}

/** The footprint of a landmark kind, measured from its drawing with every stroke. */
export function measureFootprint(kind: LandmarkKind): Footprint {
  const geometry = landmarkGeometry(kind);
  const site = firstSite(kind);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  const vertex = (at: number): THREE.Vector3 => new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(at) : at);
  const marked = new Set<string>();
  let minimumColumn = Infinity;
  let maximumColumn = -Infinity;
  let minimumRow = Infinity;
  let maximumRow = -Infinity;
  const low = FOOTPRINT_LOW[kind] ?? FOOTPRINT_BAND.low;
  const mark = (x: number, y: number, z: number): void => {
    const above = y - site.ground(x, z);
    if (above < low || above > FOOTPRINT_BAND.high) return;
    const column = Math.floor(x / FOOTPRINT_CELL);
    const row = Math.floor(z / FOOTPRINT_CELL);
    marked.add(`${column},${row}`);
    minimumColumn = Math.min(minimumColumn, column);
    maximumColumn = Math.max(maximumColumn, column);
    minimumRow = Math.min(minimumRow, row);
    maximumRow = Math.max(maximumRow, row);
  };
  for (let triangle = 0; triangle + 2 < count; triangle += 3) {
    const a = vertex(triangle);
    const b = vertex(triangle + 1);
    const c = vertex(triangle + 2);
    const steps = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / SAMPLE_SPACING));
    for (let i = 0; i <= steps; i += 1) {
      for (let j = 0; i + j <= steps; j += 1) {
        const u = i / steps;
        const v = j / steps;
        mark(a.x + (b.x - a.x) * u + (c.x - a.x) * v, a.y + (b.y - a.y) * u + (c.y - a.y) * v, a.z + (b.z - a.z) * u + (c.z - a.z) * v);
      }
    }
  }
  if (marked.size === 0) return { x: 0, z: 0, rows: [] };
  // One free cell all round, then fill from the outside: what it cannot reach is enclosed, and solid.
  const left = minimumColumn - 1;
  const top = minimumRow - 1;
  const width = maximumColumn - minimumColumn + 3;
  const height = maximumRow - minimumRow + 3;
  const outside = new Uint8Array(width * height);
  const stack = [0];
  outside[0] = 1;
  while (stack.length > 0) {
    const cell = stack.pop()!;
    const column = cell % width;
    const row = Math.floor(cell / width);
    for (const [stepColumn, stepRow] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nextColumn = column + stepColumn;
      const nextRow = row + stepRow;
      if (nextColumn < 0 || nextRow < 0 || nextColumn >= width || nextRow >= height) continue;
      const next = nextRow * width + nextColumn;
      if (outside[next] || marked.has(`${left + nextColumn},${top + nextRow}`)) continue;
      outside[next] = 1;
      stack.push(next);
    }
  }
  const rows: string[] = [];
  for (let row = 1; row < height - 1; row += 1) {
    let line = '';
    for (let column = 1; column < width - 1; column += 1) line += outside[row * width + column] ? '.' : '#';
    rows.push(line);
  }
  return { x: (left + 1) * FOOTPRINT_CELL, z: (top + 1) * FOOTPRINT_CELL, rows };
}
