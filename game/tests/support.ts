/** Shared helpers for the test suite. Tests may set state directly to stage a scene. */
import type { AttachmentId, IslandId, ItemId, ToolId } from '../src/data/index.ts';
import { ISLANDS_BY_ID, NODES_BY_ID, isStackable, spotPosition } from '../src/data/index.ts';
import {
  FIXED_STEP, NEUTRAL_INPUT, createGame, dispatch, drainEvents, landingBerth, step, terrainHeight,
} from '../src/sim/index.ts';
import type { GameEvent, GameOptions, GameState, StepInput } from '../src/sim/index.ts';

export const newGame = (seed = 7, options: GameOptions = {}): GameState => createGame(seed, options);

/** Step with one input for a number of seconds. Returns every event drained on the way. */
export function run(state: GameState, input: Partial<StepInput>, seconds: number): GameEvent[] {
  const events: GameEvent[] = [];
  const steps = Math.round(seconds / FIXED_STEP);
  for (let index = 0; index < steps; index += 1) {
    step(state, { ...NEUTRAL_INPUT, ...input }, FIXED_STEP);
    if (state.events.length > 0) events.push(...drainEvents(state));
  }
  return events;
}

/** One press of the interact key at a node: scavenge it, or pick up what was left. Returns the events it caused. */
export function scavenge(state: GameState, playerId = 0): GameEvent[] {
  dispatch(state, { type: 'scavenge' }, playerId);
  return drainEvents(state);
}

/** Step until the player fails (or time runs out). Stops on the very step it happens. */
export function runUntilFail(state: GameState, input: Partial<StepInput>, maximumSeconds: number): GameEvent[] {
  const events: GameEvent[] = [];
  const fails = state.statistics.fails;
  for (let index = 0; index < maximumSeconds / FIXED_STEP && state.statistics.fails === fails; index += 1) {
    step(state, { ...NEUTRAL_INPUT, ...input }, FIXED_STEP);
    events.push(...drainEvents(state));
  }
  return events;
}

/** Put the canoe afloat at a point, player aboard, hull dry. */
export function floatCanoeAt(state: GameState, x: number, z: number, heading = 0): void {
  state.players[0].mode = 'canoe';
  state.players[0].islandId = null;
  state.canoe.position = { x, y: 0, z };
  state.canoe.heading = heading;
  state.canoe.speed = 0;
  state.canoe.beached = false;
  state.canoe.waterLevel = 0;
  state.players[0].position = { x, y: 0, z };
}

/** Beach the canoe at an island's landing and stand the player beside it. */
export function standOn(state: GameState, islandId: IslandId): void {
  const berth = landingBerth(islandId, state.canoe.hullTier);
  state.canoe.position = { x: berth.x, y: 0, z: berth.z };
  state.canoe.heading = berth.heading;
  state.canoe.speed = 0;
  state.canoe.beached = true;
  state.canoe.waterLevel = 0;
  state.canoe.lastBeached = { ...berth, islandId };
  const bowX = berth.x + Math.sin(berth.heading) * 2.2;
  const bowZ = berth.z - Math.cos(berth.heading) * 2.2;
  state.players[0].mode = 'foot';
  state.players[0].islandId = islandId;
  state.players[0].position = { x: bowX, y: terrainHeight(bowX, bowZ), z: bowZ };
}

/** Move the player on foot to a world point on an island. */
export function teleport(state: GameState, islandId: IslandId, x: number, z: number): void {
  state.players[0].mode = 'foot';
  state.players[0].islandId = islandId;
  state.players[0].position = { x, y: terrainHeight(x, z), z };
}

export function teleportToNode(state: GameState, nodeId: string): void {
  const node = NODES_BY_ID[nodeId];
  teleport(state, node.islandId, node.position.x + 0.5, node.position.z);
}

export function teleportToCamp(state: GameState, islandId: IslandId): void {
  const definition = ISLANDS_BY_ID[islandId];
  const position = spotPosition(definition, definition.camp!.spot);
  teleport(state, islandId, position.x + 1, position.z);
}

/** Hand player 0 items: tools to the crew's belt, key items to key items, the rest to the backpack. */
export function give(state: GameState, itemId: ItemId, count = 1, container: 'backpack' | 'cargo' = 'backpack'): void {
  if (!isStackable(itemId)) {
    if (['bailing_can', 'stone_knife', 'hatchet', 'pry_bar', 'saw', 'hammer', 'fishing_rod', 'wrench'].includes(itemId)) {
      if (!state.tools.includes(itemId as ToolId)) state.tools.push(itemId as ToolId);
    } else {
      state.keyItems[itemId] = (state.keyItems[itemId] ?? 0) + count;
    }
    return;
  }
  const stacks = container === 'backpack' ? state.players[0].backpack : state.canoe.cargo;
  let remaining = count;
  while (remaining > 0) {
    const size = Math.min(20, remaining);
    stacks.push({ itemId, count: size });
    remaining -= size;
  }
}

export function build(state: GameState, ...attachmentIds: AttachmentId[]): void {
  for (const attachmentId of attachmentIds) {
    if (!state.canoe.attachments.includes(attachmentId)) state.canoe.attachments.push(attachmentId);
  }
}

export const countIn = (stacks: { itemId: ItemId; count: number }[], itemId: ItemId): number =>
  stacks.filter((stack) => stack.itemId === itemId).reduce((sum, stack) => sum + stack.count, 0);

/** A `Storage` stand-in for save and settings tests. */
export class FakeStorage {
  readonly entries = new Map<string, string>();
  failWrites = false;

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.entries.set(key, value);
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }
}
