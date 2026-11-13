/**
 * The valley as a round chart: what the map panel (M) and the minimap draw.
 *
 * The chart is worked out once, from the rules' own ground (`terrainHeight`), so every island's outline and the
 * lake's shores are the real ones: the line where the ground meets the water, traced on a grid of samples
 * (marching squares). It never changes during a game. The fog over it is the crew's chart in the state
 * (`state.seen`), handed to the interface unpacked one byte a cell (`seenCells`).
 */
import { REGIONS } from '../../data/index.ts';
import { FOG, cellSeen, pingColour, standingPings, terrainHeight, valleyHalfWidth } from '../../sim/index.ts';
import type { GameState, PlayerId } from '../../sim/index.ts';

/** The round chart: a circle over the valley, north up. It holds the whole lake but the far corners of the Shallows. */
export const CHART = { centerX: 0, centerZ: -25, radius: 1650 } as const;

/** Metres between two samples of the ground. Five or six to the smallest island's width. */
export const CHART_SAMPLE_METRES = 8;

/** Lines drawn under the water round every shore, like an old chart's soundings: metres below the surface. */
export const DEPTH_LINES = [1.2, 3] as const;

export interface ChartGeometry {
  /** The square the samples cover: its west and north edges and its side, metres. The circle sits inside it. */
  minimumX: number;
  minimumZ: number;
  sideMetres: number;
  /** Samples per side, and metres between two of them. */
  samples: number;
  sampleMetres: number;
  /** The ground height at every sample, metres (negative under water), row by row from the north-west corner. */
  heights: Float32Array;
  /** Where the ground meets the water, as segments: x1, z1, x2, z2 for each, metres. */
  shore: Float32Array;
  /** The depth lines (`DEPTH_LINES`), as segments like the shore. */
  depths: Float32Array;
  /** Where one region of water meets the next, across the lake: z, and the lake's width there. */
  regionEdges: { z: number; minimumX: number; maximumX: number }[];
  /** The fog grid, as the rules keep it (`FOG`). */
  fog: { minimumX: number; minimumZ: number; cellMetres: number; columns: number; rows: number };
  /** One byte a fog cell: 1 where its middle is on the lake, the water the crew can travel. */
  lakeCells: Uint8Array;
}

/**
 * The pieces of the line where `values` crosses `level`, by marching squares, as segments x1, z1, x2, z2 in
 * metres. `values` is `samples` by `samples`, row by row from (`minimumX`, `minimumZ`), `step` metres apart.
 * A cell whose corners alternate (a saddle) is split by the value at its middle.
 */
export function contourSegments(
  values: Float32Array, samples: number, minimumX: number, minimumZ: number, step: number, level: number,
): Float32Array {
  const out: number[] = [];
  const at = (column: number, row: number): number => values[row * samples + column]! - level;
  // Where the line crosses between two corners, as a share of the way from the first.
  const cross = (first: number, second: number): number => (first === second ? 0.5 : first / (first - second));
  for (let row = 0; row < samples - 1; row += 1) {
    for (let column = 0; column < samples - 1; column += 1) {
      const northWest = at(column, row);
      const northEast = at(column + 1, row);
      const southEast = at(column + 1, row + 1);
      const southWest = at(column, row + 1);
      const index = (northWest > 0 ? 8 : 0) | (northEast > 0 ? 4 : 0) | (southEast > 0 ? 2 : 0) | (southWest > 0 ? 1 : 0);
      if (index === 0 || index === 15) continue;
      const x = minimumX + column * step;
      const z = minimumZ + row * step;
      // The four edges' crossing points: north, east, south, west.
      const north = (): [number, number] => [x + cross(northWest, northEast) * step, z];
      const east = (): [number, number] => [x + step, z + cross(northEast, southEast) * step];
      const south = (): [number, number] => [x + cross(southWest, southEast) * step, z + step];
      const west = (): [number, number] => [x, z + cross(northWest, southWest) * step];
      const segment = (first: [number, number], second: [number, number]): void => {
        out.push(first[0], first[1], second[0], second[1]);
      };
      const middleHigh = (northWest + northEast + southEast + southWest) / 4 > 0;
      switch (index) {
        case 1: case 14: segment(west(), south()); break;
        case 2: case 13: segment(south(), east()); break;
        case 3: case 12: segment(west(), east()); break;
        case 4: case 11: segment(north(), east()); break;
        case 6: case 9: segment(north(), south()); break;
        case 7: case 8: segment(west(), north()); break;
        case 5:
          // North-east and south-west high.
          if (middleHigh) { segment(west(), north()); segment(south(), east()); } else { segment(north(), east()); segment(west(), south()); }
          break;
        case 10:
          // North-west and south-east high.
          if (middleHigh) { segment(north(), east()); segment(west(), south()); } else { segment(west(), north()); segment(south(), east()); }
          break;
        default:
      }
    }
  }
  return Float32Array.from(out);
}

let chart: ChartGeometry | null = null;

/** The valley's chart. Worked out on first use (some tens of milliseconds) and kept. */
export function valleyChart(): ChartGeometry {
  if (chart) return chart;
  const sideMetres = CHART.radius * 2;
  const samples = Math.ceil(sideMetres / CHART_SAMPLE_METRES) + 1;
  const minimumX = CHART.centerX - CHART.radius;
  const minimumZ = CHART.centerZ - CHART.radius;
  const heights = new Float32Array(samples * samples);
  for (let row = 0; row < samples; row += 1) {
    const z = minimumZ + row * CHART_SAMPLE_METRES;
    for (let column = 0; column < samples; column += 1) {
      heights[row * samples + column] = terrainHeight(minimumX + column * CHART_SAMPLE_METRES, z);
    }
  }
  const contour = (level: number): Float32Array => contourSegments(heights, samples, minimumX, minimumZ, CHART_SAMPLE_METRES, level);
  const depthParts = DEPTH_LINES.map((depth) => contour(-depth));
  const depths = new Float32Array(depthParts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of depthParts) {
    depths.set(part, offset);
    offset += part.length;
  }
  const lakeCells = new Uint8Array(FOG.columns * FOG.rows);
  for (let row = 0; row < FOG.rows; row += 1) {
    for (let column = 0; column < FOG.columns; column += 1) {
      const x = FOG.minimumX + (column + 0.5) * FOG.cellMetres;
      const z = FOG.minimumZ + (row + 0.5) * FOG.cellMetres;
      lakeCells[row * FOG.columns + column] = terrainHeight(x, z) < 0 ? 1 : 0;
    }
  }
  // The regions are ordered south to north; each one's north edge is where the next begins.
  const regionEdges = REGIONS.slice(0, -1).map((region) => {
    const halfWidth = valleyHalfWidth(region.northEdgeZ);
    return { z: region.northEdgeZ, minimumX: -halfWidth, maximumX: halfWidth };
  });
  chart = {
    minimumX, minimumZ, sideMetres, samples, sampleMetres: CHART_SAMPLE_METRES, heights,
    shore: contour(0), depths, regionEdges,
    fog: { minimumX: FOG.minimumX, minimumZ: FOG.minimumZ, cellMetres: FOG.cellMetres, columns: FOG.columns, rows: FOG.rows },
    lakeCells,
  };
  return chart;
}

let lastSeen: string | null = null;
let lastCells = new Uint8Array(FOG.columns * FOG.rows);

/**
 * The crew's chart unpacked, one byte a fog cell, 1 where it has been seen. The same array comes back while the
 * record is the same string, so whoever draws it can tell at a glance that nothing new was seen.
 */
export function seenCells(seen: string): Uint8Array {
  if (seen === lastSeen) return lastCells;
  const cells = new Uint8Array(FOG.columns * FOG.rows);
  for (let row = 0; row < FOG.rows; row += 1) {
    for (let column = 0; column < FOG.columns; column += 1) cells[row * FOG.columns + column] = cellSeen(seen, column, row) ? 1 : 0;
  }
  lastSeen = seen;
  lastCells = cells;
  return cells;
}

/** The share of the lake the crew has seen, 0 to 1. */
export function lakeSeenShare(cells: Uint8Array): number {
  const lake = valleyChart().lakeCells;
  let total = 0;
  let seen = 0;
  for (let cell = 0; cell < lake.length; cell += 1) {
    if (!lake[cell]) continue;
    total += 1;
    if (cells[cell]) seen += 1;
  }
  return total > 0 ? seen / total : 0;
}

// --- Pings ---------------------------------------------------------------------------------

/** A spot a crewmate marked for the crew: a mark on the map and the minimap, in that player's colour. */
export interface ChartPingModel {
  playerId: PlayerId;
  /** Where, in world metres. */
  x: number;
  z: number;
  /** The player's toque colour, `#rrggbb`: the colour the crew list and the compass know them by. */
  color: string;
}

let lastPings: unknown = null;
let lastPingModels: ChartPingModel[] = [];
const NO_PINGS: ChartPingModel[] = [];

/**
 * The pings standing, for the chart. The same array comes back while the state's list is the same one
 * (the rules replace it, they never change it in place), so whoever draws it can tell that nothing changed.
 */
export function chartPings(state: GameState): ChartPingModel[] {
  const source: unknown = state.pings;
  if (source === undefined) return NO_PINGS;
  if (source === lastPings) return lastPingModels;
  lastPings = source;
  lastPingModels = standingPings(state).map((ping) => ({
    playerId: ping.playerId, x: ping.x, z: ping.z, color: pingColour(ping.playerId),
  }));
  return lastPingModels;
}
