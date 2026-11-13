/**
 * The crew's chart: which parts of the valley anyone in the crew has seen.
 *
 * Fog of war for the map and the minimap. The valley is cut into a grid of
 * square cells (`FOG`). A cell is seen once a crewmate has stood or paddled
 * within sight of its middle, and stays seen: nothing ever fogs it again. The
 * grid is the crew's, not a player's: one record for everyone, run by the host
 * and saved with the game.
 *
 * It is packed six cells to a character of the base64 alphabet, in
 * `GameState.seen` (`SEEN_LENGTH` characters, under a kilobyte). A step that
 * sees nothing new reads a handful of characters and writes nothing, so the
 * host only sends it to the guests when it grows.
 */
import { ISLANDS } from '../data/world.ts';
import type { IslandId } from '../data/types.ts';
import type { GameState } from './types.ts';

/**
 * The grid. It covers the lake (x from -1100 to 1100, z from -1450 to 1400)
 * and a sight's width of shore round it. North is -z.
 *
 * - `cellMetres`: 40 m a side. A tenth of the way between two islands, and
 *   coarse enough that the whole valley packs into under a kilobyte.
 * - `sightMetres`: 220 m. Under the 260 m at which an island is discovered
 *   (`TUNING.world.discoverRange`), so the fog never opens over a piece of an
 *   island that has no name yet: a cell's far corner is at most 248 m away.
 */
export const FOG = {
  minimumX: -1360,
  minimumZ: -1720,
  cellMetres: 40,
  columns: 68,
  rows: 86,
  sightMetres: 220,
} as const;

/** Cells in the grid. */
export const SEEN_CELLS = FOG.columns * FOG.rows;
/** Characters in `GameState.seen`: six cells each. */
export const SEEN_LENGTH = Math.ceil(SEEN_CELLS / 6);

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** The six bits a character holds, by its code. 0 for anything that is not in the alphabet. */
const VALUES = new Uint8Array(128);
for (let index = 0; index < ALPHABET.length; index += 1) VALUES[ALPHABET.charCodeAt(index)] = index;

const valueAt = (seen: string, position: number): number => {
  const code = seen.charCodeAt(position);
  return code < 128 ? VALUES[code]! : 0;
};

/** Nothing seen. */
export function emptySeen(): string {
  return ALPHABET[0]!.repeat(SEEN_LENGTH);
}

/** Everything seen: what the map table's chart shows. */
export function fullSeen(): string {
  const whole = SEEN_CELLS % 6 === 0 ? 63 : (1 << (SEEN_CELLS % 6)) - 1;
  return ALPHABET[63]!.repeat(SEEN_LENGTH - 1) + ALPHABET[whole]!;
}

/** True once the cell at `column`, `row` has been seen. Off the grid is never seen. */
export function cellSeen(seen: string, column: number, row: number): boolean {
  if (column < 0 || row < 0 || column >= FOG.columns || row >= FOG.rows) return false;
  const cell = row * FOG.columns + column;
  return ((valueAt(seen, Math.floor(cell / 6)) >> (cell % 6)) & 1) === 1;
}

/** The cell a world point falls in. May be off the grid. */
export function cellOf(x: number, z: number): { column: number; row: number } {
  return { column: Math.floor((x - FOG.minimumX) / FOG.cellMetres), row: Math.floor((z - FOG.minimumZ) / FOG.cellMetres) };
}

/** True once the crew has seen the world point `x`, `z`. */
export function seenAt(seen: string, x: number, z: number): boolean {
  const { column, row } = cellOf(x, z);
  return cellSeen(seen, column, row);
}

/** How many cells have been seen. */
export function seenCount(seen: string): number {
  let count = 0;
  for (let cell = 0; cell < SEEN_CELLS; cell += 1) {
    if ((valueAt(seen, Math.floor(cell / 6)) >> (cell % 6)) & 1) count += 1;
  }
  return count;
}

/**
 * `seen` with every cell whose middle is within `radius` of `x`, `z` marked
 * seen, except where `blocked` says no. The same string when nothing new was
 * seen. A string of the wrong length (a hand-edited save) comes back the
 * right length.
 */
export function revealCircle(
  seen: string, x: number, z: number, radius: number, blocked: ((x: number, z: number) => boolean) | null = null,
): string {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !(radius > 0)) return seen;
  const size = FOG.cellMetres;
  const firstColumn = Math.max(0, Math.floor((x - radius - FOG.minimumX) / size));
  const lastColumn = Math.min(FOG.columns - 1, Math.floor((x + radius - FOG.minimumX) / size));
  const firstRow = Math.max(0, Math.floor((z - radius - FOG.minimumZ) / size));
  const lastRow = Math.min(FOG.rows - 1, Math.floor((z + radius - FOG.minimumZ) / size));
  let values: number[] | null = seen.length === SEEN_LENGTH ? null : unpack(seen);
  for (let row = firstRow; row <= lastRow; row += 1) {
    const middleZ = FOG.minimumZ + (row + 0.5) * size;
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const middleX = FOG.minimumX + (column + 0.5) * size;
      if ((middleX - x) ** 2 + (middleZ - z) ** 2 > radius * radius) continue;
      const cell = row * FOG.columns + column;
      const position = Math.floor(cell / 6);
      const bit = 1 << (cell % 6);
      const value = values ? values[position]! : valueAt(seen, position);
      if (value & bit) continue;
      if (blocked?.(middleX, middleZ)) continue;
      values ??= unpack(seen);
      values[position] = value | bit;
    }
  }
  return values ? pack(values) : seen;
}

function unpack(seen: string): number[] {
  const values = new Array<number>(SEEN_LENGTH);
  for (let position = 0; position < SEEN_LENGTH; position += 1) values[position] = position < seen.length ? valueAt(seen, position) : 0;
  // Bits past the last cell mean nothing: keep them clear, so two records of the same sight are the same string.
  if (SEEN_CELLS % 6 !== 0) values[SEEN_LENGTH - 1]! &= (1 << (SEEN_CELLS % 6)) - 1;
  return values;
}

function pack(values: number[]): string {
  let text = '';
  for (const value of values) text += ALPHABET[value & 63];
  return text;
}

/** A record with only what can be seen from `x`, `z`: the start of a new game. */
export function seenAround(x: number, z: number): string {
  return revealCircle(emptySeen(), x, z, FOG.sightMetres);
}

/** The ground an island stands on, and a cell round it: what is charted once the island is found. */
const islandReach = (islandId: IslandId): { x: number; z: number; radius: number } | null => {
  const island = ISLANDS.find((candidate) => candidate.id === islandId);
  return island ? { ...island.center, radius: Math.max(island.radiusX, island.radiusZ) + FOG.cellMetres } : null;
};

/**
 * Mark what can be seen from `x`, `z` as seen, for the whole crew, and chart every island the crew has found.
 * An island is found from further off than the sight reaches (`TUNING.world.discoverRange`, from its middle):
 * once it has a name it is on the map whole, the water round it still in the fog. Cheap when nothing is new.
 */
export function revealAround(state: GameState, x: number, z: number): void {
  let seen = revealCircle(typeof state.seen === 'string' ? state.seen : emptySeen(), x, z, FOG.sightMetres);
  for (const islandId of state.discoveredIslands) {
    const reach = islandReach(islandId);
    if (reach) seen = revealCircle(seen, reach.x, reach.z, reach.radius);
  }
  if (seen !== state.seen) state.seen = seen;
}

/**
 * A chart for a game saved before the crew kept one (save version 3 and
 * older): the islands it knew, the waters round them and between them in the
 * order they were found (the route the crew took, near enough), and the
 * sight from where everyone and the canoe stand. Never a piece of an island it
 * had not found: its cells stay in the fog.
 */
export function chartKnownWaters(
  discovered: readonly IslandId[], places: readonly { x: number; z: number }[],
): string {
  const known = new Set(discovered);
  const unknown = ISLANDS.filter((island) => !known.has(island.id));
  const blocked = (x: number, z: number): boolean => unknown.some((island) =>
    Math.hypot(x - island.center.x, z - island.center.z) <= Math.max(island.radiusX, island.radiusZ) + FOG.cellMetres);
  let seen = emptySeen();
  const route = discovered.map((islandId) => ISLANDS.find((island) => island.id === islandId)).filter((island) => island !== undefined);
  route.forEach((island, index) => {
    seen = revealCircle(seen, island.center.x, island.center.z, Math.max(island.radiusX, island.radiusZ) + FOG.sightMetres, blocked);
    const previous = route[index - 1];
    if (!previous) return;
    // The way from the island before: a band a sight wide, walked out in half cells.
    const length = Math.hypot(island.center.x - previous.center.x, island.center.z - previous.center.z);
    const steps = Math.max(1, Math.ceil(length / (FOG.cellMetres / 2)));
    for (let stepIndex = 1; stepIndex < steps; stepIndex += 1) {
      const share = stepIndex / steps;
      seen = revealCircle(seen, previous.center.x + (island.center.x - previous.center.x) * share,
        previous.center.z + (island.center.z - previous.center.z) * share, FOG.sightMetres, blocked);
    }
  });
  for (const place of places) seen = revealCircle(seen, place.x, place.z, FOG.sightMetres, blocked);
  return seen;
}
