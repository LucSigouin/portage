import type { IslandDefinition, ItemAmount, ItemId, ToolId } from '../data/types.ts';
import { ATTACHMENTS, HULL_TIERS } from '../data/canoe.ts';
import { ITEMS, isStackable } from '../data/items.ts';
import { TUNING } from '../data/tuning.ts';
import { ISLANDS_BY_ID, spotPosition } from '../data/world.ts';
import { MAXIMUM_PLAYERS } from './types.ts';
import type { Container, GameEvent, GameState, ItemStack, Missing, PlayerId, PlayerState } from './types.ts';

/**
 * Queue an event for the client. Pass the player who caused or suffered it,
 * so each screen can tell its own events from the rest of the crew's. The
 * oldest are dropped if nobody drains.
 */
export function emit(state: GameState, event: GameEvent, player?: PlayerState): void {
  state.events.push(player ? { ...event, playerId: player.id } : event);
  if (state.events.length > TUNING.events.maximumQueued) state.events.shift();
}

/** The player with this id. Falls back to the first player, so a stale id never throws. */
export function playerOf(state: GameState, playerId: PlayerId = 0): PlayerState {
  return state.players.find((player) => player.id === playerId) ?? state.players[0];
}

/** The events one player's screen should hear: their own, and the crew-wide ones. */
export function eventsFor(events: readonly GameEvent[], playerId: PlayerId): GameEvent[] {
  return events.filter((event) => event.playerId === undefined || event.playerId === playerId);
}

/** Everyone in the canoe, in id order. */
export function playersAboard(state: GameState): PlayerState[] {
  return state.players.filter((player) => player.mode === 'canoe');
}

/** Everyone who is not away, in id order. */
export function connectedPlayers(state: GameState): PlayerState[] {
  return state.players.filter((player) => player.connected);
}

/** The lowest free seat in the canoe. */
export function freeSeat(state: GameState): number {
  for (let seat = 0; seat < MAXIMUM_PLAYERS; seat += 1) {
    if (!state.players.some((player) => player.seat === seat)) return seat;
  }
  return 0;
}

export function emptyMissing(): Missing {
  return { items: [], tools: [], station: null, hullTier: null, attachments: [], flag: null };
}

export function hasMissing(missing: Missing): boolean {
  return missing.items.length > 0 || missing.tools.length > 0 || missing.station !== null
    || missing.hullTier !== null || missing.attachments.length > 0 || missing.flag !== null;
}

export function countInStacks(stacks: ItemStack[], itemId: ItemId): number {
  let total = 0;
  for (const stack of stacks) if (stack.itemId === itemId) total += stack.count;
  return total;
}

/** Add to stacks, topping up existing stacks first. Returns what did not fit. */
export function addToStacks(stacks: ItemStack[], slots: number, itemId: ItemId, count: number): number {
  let remaining = count;
  const stackSize = TUNING.inventory.stackSize;
  for (const stack of stacks) {
    if (remaining <= 0) break;
    if (stack.itemId !== itemId || stack.count >= stackSize) continue;
    const moved = Math.min(stackSize - stack.count, remaining);
    stack.count += moved;
    remaining -= moved;
  }
  while (remaining > 0 && stacks.length < slots) {
    const moved = Math.min(stackSize, remaining);
    stacks.push({ itemId, count: moved });
    remaining -= moved;
  }
  return remaining;
}

/** Remove from stacks, smallest stacks first. Returns how many were removed. */
export function removeFromStacks(stacks: ItemStack[], itemId: ItemId, count: number): number {
  let remaining = count;
  const matching = stacks.filter((stack) => stack.itemId === itemId).sort((first, second) => first.count - second.count);
  for (const stack of matching) {
    if (remaining <= 0) break;
    const moved = Math.min(stack.count, remaining);
    stack.count -= moved;
    remaining -= moved;
  }
  for (let index = stacks.length - 1; index >= 0; index -= 1) {
    if (stacks[index].count <= 0) stacks.splice(index, 1);
  }
  return count - remaining;
}

export function hasAttachment(state: GameState, attachmentId: keyof typeof ATTACHMENTS): boolean {
  return state.canoe.attachments.includes(attachmentId);
}

/** True when the crew has the tool. Every player may use it. */
export function hasTool(state: GameState, toolId: ToolId): boolean {
  return state.tools.includes(toolId);
}

/** Cargo slots of the current hull plus attachment bonuses. */
export function cargoSlots(state: GameState): number {
  let slots = HULL_TIERS[state.canoe.hullTier].cargoSlots;
  for (const attachmentId of state.canoe.attachments) slots += ATTACHMENTS[attachmentId].cargoSlotsBonus;
  return slots;
}

export function slotsOf(state: GameState, container: Container): number {
  return container === 'backpack' ? TUNING.inventory.backpackSlots : cargoSlots(state);
}

export function stacksOf(state: GameState, player: PlayerState, container: Container): ItemStack[] {
  return container === 'backpack' ? player.backpack : state.canoe.cargo;
}

export function distanceToCanoe(state: GameState, player: PlayerState): number {
  return Math.hypot(player.position.x - state.canoe.position.x, player.position.z - state.canoe.position.z);
}

/** The island whose camp the player is standing in, or null. */
export function campInReach(player: PlayerState): IslandDefinition | null {
  if (player.mode !== 'foot' || !player.islandId) return null;
  const definition = ISLANDS_BY_ID[player.islandId];
  if (!definition.camp) return null;
  const position = spotPosition(definition, definition.camp.spot);
  const distance = Math.hypot(player.position.x - position.x, player.position.z - position.z);
  return distance <= TUNING.foot.campRange ? definition : null;
}

/** True when aboard or standing close enough to use what is on the canoe. */
export function atCanoe(state: GameState, player: PlayerState): boolean {
  return player.mode === 'canoe' || distanceToCanoe(state, player) <= TUNING.canoe.accessRange;
}

/**
 * True when cargo can be reached: aboard, beside the canoe, or at a camp on
 * the island where the canoe is beached.
 */
export function cargoAccessible(state: GameState, player: PlayerState): boolean {
  if (atCanoe(state, player)) return true;
  const camp = campInReach(player);
  return camp !== null && state.canoe.beached && state.canoe.lastBeached.islandId === camp.id;
}

/**
 * Everything the crew owns of an item: the tool belt, the key items, every
 * backpack and the cargo. Quests count this, so anyone's haul counts.
 */
export function countHeld(state: GameState, itemId: ItemId): number {
  const category = ITEMS[itemId].category;
  if (category === 'tool') return hasTool(state, itemId as ToolId) ? 1 : 0;
  if (!isStackable(itemId)) return state.keyItems[itemId] ?? 0;
  let total = countInStacks(state.canoe.cargo, itemId);
  // An away player's backpack is theirs to come back to: it does not count and is never drawn on.
  for (const player of connectedPlayers(state)) total += countInStacks(player.backpack, itemId);
  return total;
}

/** What one player can use right now: the crew's tools, the key items, their backpack and the cargo in reach. */
export function countAccessible(state: GameState, player: PlayerState, itemId: ItemId): number {
  if (ITEMS[itemId].category === 'tool') return hasTool(state, itemId as ToolId) ? 1 : 0;
  if (!isStackable(itemId)) return state.keyItems[itemId] ?? 0;
  const inBackpack = countInStacks(player.backpack, itemId);
  return cargoAccessible(state, player) ? inBackpack + countInStacks(state.canoe.cargo, itemId) : inBackpack;
}

/** Containers in the order new items go into them. */
function containerOrder(state: GameState, player: PlayerState): Container[] {
  if (player.mode === 'canoe') return ['cargo', 'backpack'];
  return cargoAccessible(state, player) ? ['backpack', 'cargo'] : ['backpack'];
}

/**
 * Give items to a player. Tools go on the crew's belt, key items to the crew's
 * key items, the rest into their backpack and the cargo (cargo first when
 * aboard). Returns the stacks that did not fit.
 */
export function grantItems(state: GameState, player: PlayerState, items: ItemAmount[]): ItemStack[] {
  const leftover: ItemStack[] = [];
  for (const { itemId, count } of items) {
    if (count <= 0) continue;
    const category = ITEMS[itemId].category;
    if (category === 'tool') {
      if (!hasTool(state, itemId as ToolId)) {
        state.tools.push(itemId as ToolId);
        emit(state, { type: 'item_gained', itemId, count: 1, container: 'belt' }, player);
      }
      continue;
    }
    if (!isStackable(itemId)) {
      state.keyItems[itemId] = (state.keyItems[itemId] ?? 0) + count;
      emit(state, { type: 'item_gained', itemId, count, container: 'key_items' }, player);
      continue;
    }
    let remaining = count;
    for (const container of containerOrder(state, player)) {
      if (remaining <= 0) break;
      const after = addToStacks(stacksOf(state, player, container), slotsOf(state, container), itemId, remaining);
      if (after < remaining) emit(state, { type: 'item_gained', itemId, count: remaining - after, container }, player);
      remaining = after;
    }
    if (remaining > 0) leftover.push({ itemId, count: remaining });
  }
  return leftover;
}

/** Remove items the player can reach. Assumes the caller checked the counts. */
export function spendItems(state: GameState, player: PlayerState, items: ItemAmount[]): void {
  for (const { itemId, count } of items) {
    if (!isStackable(itemId)) {
      if (ITEMS[itemId].category === 'tool') continue;
      const remaining = (state.keyItems[itemId] ?? 0) - count;
      if (remaining > 0) state.keyItems[itemId] = remaining;
      else delete state.keyItems[itemId];
      continue;
    }
    const fromBackpack = removeFromStacks(player.backpack, itemId, count);
    if (fromBackpack < count) removeFromStacks(state.canoe.cargo, itemId, count - fromBackpack);
  }
}

/** Items short of a cost, counting only what the player can reach right now. */
export function itemsShort(state: GameState, player: PlayerState, cost: ItemAmount[], times = 1): ItemAmount[] {
  const short: ItemAmount[] = [];
  for (const { itemId, count } of cost) {
    const needed = count * times - countAccessible(state, player, itemId);
    if (needed > 0) short.push({ itemId, count: needed });
  }
  return short;
}

/**
 * Spend and gain in one go, or do nothing. Fails (returns false) when the
 * gained stacks would not fit once the spent ones are gone.
 */
export function exchangeItems(state: GameState, player: PlayerState, spend: ItemAmount[], gain: ItemAmount[]): boolean {
  const backpackBefore = player.backpack.map((stack) => ({ ...stack }));
  const cargoBefore = state.canoe.cargo.map((stack) => ({ ...stack }));
  const keyItemsBefore = { ...state.keyItems };
  const eventsBefore = state.events.length;
  spendItems(state, player, spend);
  const leftover = grantItems(state, player, gain);
  if (leftover.length === 0) return true;
  player.backpack = backpackBefore;
  state.canoe.cargo = cargoBefore;
  state.keyItems = keyItemsBefore;
  state.events.length = eventsBefore;
  return false;
}
