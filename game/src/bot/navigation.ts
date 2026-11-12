/**
 * Route finding for the headless bot and the solvability analysis: a coarse
 * grid over the water for the canoe, and a fine grid over one island for
 * walking. Both read the same terrain and region functions the game uses.
 */
import type { IslandId } from '../data/types.ts';
import { TUNING } from '../data/tuning.ts';
import { ISLANDS, ISLANDS_BY_ID, REGIONS, START } from '../data/world.ts';
import { groundHeight, islandLanding, regionAt, terrainHeight } from '../sim/index.ts';

export interface Point {
  x: number;
  z: number;
}

/** Smallest-first queue of (priority, value) pairs. */
class MinimumQueue {
  private readonly priorities: number[] = [];
  private readonly values: number[] = [];

  get size(): number {
    return this.values.length;
  }

  push(priority: number, value: number): void {
    let index = this.values.length;
    this.priorities.push(priority);
    this.values.push(value);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.priorities[parent] <= priority) break;
      this.priorities[index] = this.priorities[parent];
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.priorities[index] = priority;
    this.values[index] = value;
  }

  pop(): number {
    const top = this.values[0];
    const priority = this.priorities.pop()!;
    const value = this.values.pop()!;
    const length = this.values.length;
    if (length > 0) {
      let index = 0;
      for (;;) {
        let child = index * 2 + 1;
        if (child >= length) break;
        if (child + 1 < length && this.priorities[child + 1] < this.priorities[child]) child += 1;
        if (this.priorities[child] >= priority) break;
        this.priorities[index] = this.priorities[child];
        this.values[index] = this.values[child];
        index = child;
      }
      this.priorities[index] = priority;
      this.values[index] = value;
    }
    return top;
  }
}

const NEIGHBOURS = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
] as const;

/**
 * A* over a grid. `canStep(from, to)` says whether a move between two
 * neighbouring cells is allowed. Returns cell indexes from start to goal.
 */
function searchGrid(
  width: number,
  height: number,
  start: number,
  goal: number,
  canStep: (from: number, to: number) => boolean,
): number[] | null {
  const cost = new Float64Array(width * height).fill(Infinity);
  const cameFrom = new Int32Array(width * height).fill(-1);
  const queue = new MinimumQueue();
  const goalColumn = goal % width;
  const goalRow = Math.floor(goal / width);
  cost[start] = 0;
  queue.push(0, start);
  while (queue.size > 0) {
    const current = queue.pop();
    if (current === goal) {
      const path = [goal];
      let cell = goal;
      while (cameFrom[cell] !== -1) {
        cell = cameFrom[cell];
        path.push(cell);
      }
      return path.reverse();
    }
    const column = current % width;
    const row = Math.floor(current / width);
    for (const [stepColumn, stepRow] of NEIGHBOURS) {
      const nextColumn = column + stepColumn;
      const nextRow = row + stepRow;
      if (nextColumn < 0 || nextRow < 0 || nextColumn >= width || nextRow >= height) continue;
      const next = nextRow * width + nextColumn;
      if (!canStep(current, next)) continue;
      // No cutting corners: a diagonal needs both of its sides open.
      if (stepColumn !== 0 && stepRow !== 0
        && (!canStep(current, row * width + nextColumn) || !canStep(current, nextRow * width + column))) continue;
      const nextCost = cost[current] + (stepColumn !== 0 && stepRow !== 0 ? Math.SQRT2 : 1);
      if (nextCost >= cost[next]) continue;
      cost[next] = nextCost;
      cameFrom[next] = current;
      queue.push(nextCost + Math.hypot(nextColumn - goalColumn, nextRow - goalRow), next);
    }
  }
  return null;
}

// --- Water ------------------------------------------------------------------

const WATER_CELL = 25;
const WATER_SIZE = Math.round((TUNING.world.halfExtent * 2) / WATER_CELL);
const WATER_CLEARANCE = 12;

interface WaterGrid {
  /** 1 where the canoe can float with room to spare. */
  open: Uint8Array;
  /** Region roughness of each cell. */
  roughness: Uint8Array;
  /** 1 where the fog wall applies. */
  fog: Uint8Array;
}

let waterGrid: WaterGrid | null = null;

const waterCellCentre = (index: number): Point => ({
  x: -TUNING.world.halfExtent + ((index % WATER_SIZE) + 0.5) * WATER_CELL,
  z: -TUNING.world.halfExtent + (Math.floor(index / WATER_SIZE) + 0.5) * WATER_CELL,
});

function waterCellAt(point: Point): number {
  const column = Math.max(0, Math.min(WATER_SIZE - 1, Math.floor((point.x + TUNING.world.halfExtent) / WATER_CELL)));
  const row = Math.max(0, Math.min(WATER_SIZE - 1, Math.floor((point.z + TUNING.world.halfExtent) / WATER_CELL)));
  return row * WATER_SIZE + column;
}

function buildWaterGrid(): WaterGrid {
  const count = WATER_SIZE * WATER_SIZE;
  const grid: WaterGrid = { open: new Uint8Array(count), roughness: new Uint8Array(count), fog: new Uint8Array(count) };
  for (let index = 0; index < count; index += 1) {
    const centre = waterCellCentre(index);
    const region = regionAt(centre.x, centre.z);
    grid.roughness[index] = region.roughness;
    grid.fog[index] = region.fogWall ? 1 : 0;
    let open = terrainHeight(centre.x, centre.z) < -1.5;
    for (let step = 0; open && step < 8; step += 1) {
      const angle = (step / 8) * 2 * Math.PI;
      open = terrainHeight(centre.x + Math.sin(angle) * WATER_CLEARANCE, centre.z - Math.cos(angle) * WATER_CLEARANCE) < -0.8;
    }
    grid.open[index] = open ? 1 : 0;
  }
  return grid;
}

function getWaterGrid(): WaterGrid {
  waterGrid ??= buildWaterGrid();
  return waterGrid;
}

/** What a canoe can cross: its stability and whether it can pass the fog wall. */
export interface Seaworthiness {
  stability: number;
  fogGear: boolean;
}

function cellAllowed(grid: WaterGrid, index: number, limits: Seaworthiness): boolean {
  return grid.open[index] === 1 && grid.roughness[index] <= limits.stability && (grid.fog[index] === 0 || limits.fogGear);
}

/** Nearest open, allowed water cell to a point, or -1. */
function nearestWaterCell(grid: WaterGrid, point: Point, limits: Seaworthiness): number {
  const origin = waterCellAt(point);
  if (cellAllowed(grid, origin, limits)) return origin;
  const column = origin % WATER_SIZE;
  const row = Math.floor(origin / WATER_SIZE);
  let best = -1;
  let bestDistance = Infinity;
  for (let ring = 1; ring <= 6 && best === -1; ring += 1) {
    for (let stepRow = -ring; stepRow <= ring; stepRow += 1) {
      for (let stepColumn = -ring; stepColumn <= ring; stepColumn += 1) {
        if (Math.max(Math.abs(stepRow), Math.abs(stepColumn)) !== ring) continue;
        const nextColumn = column + stepColumn;
        const nextRow = row + stepRow;
        if (nextColumn < 0 || nextRow < 0 || nextColumn >= WATER_SIZE || nextRow >= WATER_SIZE) continue;
        const index = nextRow * WATER_SIZE + nextColumn;
        if (!cellAllowed(grid, index, limits)) continue;
        const centre = waterCellCentre(index);
        const distance = Math.hypot(centre.x - point.x, centre.z - point.z);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      }
    }
  }
  return best;
}

/** True when a straight run between two points stays in deep, allowed water. */
export function clearWater(from: Point, to: Point, limits: Seaworthiness): boolean {
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.max(1, Math.ceil(distance / 6));
  for (let step = 0; step <= steps; step += 1) {
    const x = from.x + ((to.x - from.x) * step) / steps;
    const z = from.z + ((to.z - from.z) * step) / steps;
    if (terrainHeight(x, z) > -1.2) return false;
    const region = regionAt(x, z);
    if (region.roughness > limits.stability || (region.fogWall && !limits.fogGear)) return false;
  }
  return true;
}

/**
 * A canoe route between two points through water the canoe can handle, as a
 * short list of waypoints ending at `to`. null when there is no way through.
 */
export function findWaterPath(from: Point, to: Point, limits: Seaworthiness): Point[] | null {
  const grid = getWaterGrid();
  const start = nearestWaterCell(grid, from, limits);
  const goal = nearestWaterCell(grid, to, limits);
  if (start === -1 || goal === -1) return null;
  const cells = searchGrid(WATER_SIZE, WATER_SIZE, start, goal, (_, next) => cellAllowed(grid, next, limits));
  if (!cells) return null;
  const points = [...cells.map(waterCellCentre), to];
  // Pull the route tight: skip every waypoint that can be bypassed in a straight run.
  // The first cell centre stays, so a canoe leaving a beach heads for open water first.
  const route: Point[] = [points[0]];
  let anchor = points[0];
  let index = 1;
  while (index < points.length) {
    let furthest = index;
    for (let candidate = points.length - 1; candidate > index; candidate -= 1) {
      if (clearWater(anchor, points[candidate], limits)) {
        furthest = candidate;
        break;
      }
    }
    route.push(points[furthest]);
    anchor = points[furthest];
    index = furthest + 1;
  }
  return route;
}

/** Length of a route starting at `from`, metres. */
export function routeLength(from: Point, route: Point[]): number {
  let length = 0;
  let previous = from;
  for (const point of route) {
    length += Math.hypot(point.x - previous.x, point.z - previous.z);
    previous = point;
  }
  return length;
}

export interface IslandAccess {
  /** Lowest stability that reaches the island's landing from Home Knoll. */
  stability: number;
  /** True when the only way there crosses the fog wall. */
  fogGear: boolean;
}

let islandAccess: Record<IslandId, IslandAccess> | null = null;

/**
 * For every island: the least seaworthy canoe that can still reach its
 * landing from Home Knoll. Worked out from the real terrain and region bands
 * by flood-filling the water grid at each stability level.
 */
export function getIslandAccess(): Record<IslandId, IslandAccess> {
  if (islandAccess) return islandAccess;
  const grid = getWaterGrid();
  const result = {} as Record<IslandId, IslandAccess>;
  const maximumRoughness = Math.max(...REGIONS.map((region) => region.roughness));
  const levels: Seaworthiness[] = [];
  for (let stability = 1; stability <= maximumRoughness; stability += 1) levels.push({ stability, fogGear: false });
  for (let stability = 1; stability <= maximumRoughness; stability += 1) levels.push({ stability, fogGear: true });
  levels.sort((first, second) => Number(first.fogGear) - Number(second.fogGear) || first.stability - second.stability);
  const home = islandLanding(START.islandId).approach;
  for (const limits of levels) {
    const start = nearestWaterCell(grid, home, limits);
    if (start === -1) continue;
    const reached = new Uint8Array(WATER_SIZE * WATER_SIZE);
    const stack = [start];
    reached[start] = 1;
    while (stack.length > 0) {
      const current = stack.pop()!;
      const column = current % WATER_SIZE;
      const row = Math.floor(current / WATER_SIZE);
      for (const [stepColumn, stepRow] of NEIGHBOURS.slice(0, 4)) {
        const nextColumn = column + stepColumn;
        const nextRow = row + stepRow;
        if (nextColumn < 0 || nextRow < 0 || nextColumn >= WATER_SIZE || nextRow >= WATER_SIZE) continue;
        const next = nextRow * WATER_SIZE + nextColumn;
        if (reached[next] === 1 || !cellAllowed(grid, next, limits)) continue;
        reached[next] = 1;
        stack.push(next);
      }
    }
    for (const definition of ISLANDS) {
      if (result[definition.id]) continue;
      const approach = islandLanding(definition.id).approach;
      const region = regionAt(approach.x, approach.z);
      if (region.roughness > limits.stability || (region.fogWall && !limits.fogGear)) continue;
      const cell = nearestWaterCell(grid, approach, limits);
      if (cell !== -1 && reached[cell] === 1) result[definition.id] = { ...limits };
    }
  }
  islandAccess = result;
  return result;
}

/** True when a canoe with these limits can reach an island's landing. */
export function canReachIsland(islandId: IslandId, limits: Seaworthiness): boolean {
  const access = getIslandAccess()[islandId];
  return access !== undefined && access.stability <= limits.stability && (!access.fogGear || limits.fogGear);
}

// --- Land -------------------------------------------------------------------

const LAND_CELL = 2;
const LAND_STANDING_DEPTH = -0.45;
const slopeLimit = TUNING.foot.slopeLimit * 0.92;

/** True when a walker can go straight from one point to another. */
export function clearGround(from: Point, to: Point): boolean {
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.max(1, Math.ceil(distance / 0.5));
  let previousHeight = groundHeight(from.x, from.z);
  const stepLength = distance / steps;
  for (let step = 1; step <= steps; step += 1) {
    const height = groundHeight(from.x + ((to.x - from.x) * step) / steps, from.z + ((to.z - from.z) * step) / steps);
    if (height < LAND_STANDING_DEPTH) return false;
    if (stepLength > 1e-6 && (height - previousHeight) / stepLength > slopeLimit) return false;
    previousHeight = height;
  }
  return true;
}

/**
 * A walking route across one island, as waypoints ending at `to`. Tries the
 * straight line first, then searches a 2 m grid over the island.
 */
export function findFootPath(islandId: IslandId, from: Point, to: Point): Point[] | null {
  if (clearGround(from, to)) return [to];
  const definition = ISLANDS_BY_ID[islandId];
  const reach = Math.max(definition.radiusX, definition.radiusZ) * 1.2 + 6;
  const originX = definition.center.x - reach;
  const originZ = definition.center.z - reach;
  const size = Math.ceil((reach * 2) / LAND_CELL);
  const centre = (index: number): Point => ({
    x: originX + ((index % size) + 0.5) * LAND_CELL,
    z: originZ + (Math.floor(index / size) + 0.5) * LAND_CELL,
  });
  const heights = new Float64Array(size * size);
  for (let index = 0; index < size * size; index += 1) {
    const point = centre(index);
    heights[index] = groundHeight(point.x, point.z);
  }
  const cellAt = (point: Point): number => {
    const column = Math.max(0, Math.min(size - 1, Math.floor((point.x - originX) / LAND_CELL)));
    const row = Math.max(0, Math.min(size - 1, Math.floor((point.z - originZ) / LAND_CELL)));
    return row * size + column;
  };
  const canStep = (current: number, next: number): boolean => {
    if (heights[next] < LAND_STANDING_DEPTH) return false;
    const diagonal = current % size !== next % size && Math.floor(current / size) !== Math.floor(next / size);
    const run = diagonal ? LAND_CELL * Math.SQRT2 : LAND_CELL;
    return (heights[next] - heights[current]) / run <= slopeLimit;
  };
  const cells = searchGrid(size, size, cellAt(from), cellAt(to), canStep);
  if (!cells) return null;
  const points = [...cells.slice(1).map(centre), to];
  const route: Point[] = [];
  let anchor = from;
  let index = 0;
  while (index < points.length) {
    let furthest = index;
    for (let candidate = points.length - 1; candidate > index; candidate -= 1) {
      if (clearGround(anchor, points[candidate])) {
        furthest = candidate;
        break;
      }
    }
    route.push(points[furthest]);
    anchor = points[furthest];
    index = furthest + 1;
  }
  return route;
}
