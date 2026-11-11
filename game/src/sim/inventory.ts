import type { IslandDefinition, ItemAmount, ItemId, ToolId } from '../data/types.ts';
import { ATTACHMENTS, HULL_TIERS } from '../data/canoe.ts';
import { ITEMS, isStackable } from '../data/items.ts';
import { TUNING } from '../data/tuning.ts';
import { ISLANDS_BY_ID, spotPosition } from '../data/world.ts';
import type { Container, GameEvent, GameState, ItemStack, Missing } from './types.ts';

/** Queue an event for the client. The oldest are dropped if nobody drains. */
export function emit(state: GameState, event: GameEvent): void {
  state.events.push(event);
  if (state.events.length > TUNING.events.maximumQueued) state.events.shift();
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

export function hasTool(state: GameState, toolId: ToolId): boolean {
  return state.player.tools.includes(toolId);
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

export function stacksOf(state: GameState, container: Container): ItemStack[] {
  return container === 'backpack' ? state.player.backpack : state.canoe.cargo;
}

export function distanceToCanoe(state: GameState): number {
  return Math.hypot(state.player.position.x - state.canoe.position.x, state.player.position.z - state.canoe.position.z);
}

/** The island whose camp the player is standing in, or null. */
export function campInReach(state: GameState): IslandDefinition | null {
  if (state.player.mode !== 'foot' || !state.player.islandId) return null;
  const definition = ISLANDS_BY_ID[state.player.islandId];
  if (!definition.camp) return null;
  const position = spotPosition(definition, definition.camp.spot);
  const distance = Math.hypot(state.player.position.x - position.x, state.player.position.z - position.z);
  return distance <= TUNING.foot.campRange ? definition : null;
}

/** True when aboard or standing close enough to use what is on the canoe. */
export function atCanoe(state: GameState): boolean {
  return state.player.mode === 'canoe' || distanceToCanoe(state) <= TUNING.canoe.accessRange;
}

/**
 * True when cargo can be reached: aboard, beside the canoe, or at a camp on
 * the island where the canoe is beached.
 */
export function cargoAccessible(state: GameState): boolean {
  if (atCanoe(state)) return true;
  const camp = campInReach(state);
  return camp !== null && state.canoe.beached && state.canoe.lastBeached.islandId === camp.id;
}

/** Everything the player owns of an item: belt, key items, backpack and cargo. */
export function countHeld(state: GameState, itemId: ItemId): number {
  const category = ITEMS[itemId].category;
  if (category === 'tool') return state.player.tools.includes(itemId as ToolId) ? 1 : 0;
  if (!isStackable(itemId)) return state.player.keyItems[itemId] ?? 0;
  return countInStacks(state.player.backpack, itemId) + countInStacks(state.canoe.cargo, itemId);
}

/** What the player can use right now: as `countHeld`, minus unreachable cargo. */
export function countAccessible(state: GameState, itemId: ItemId): number {
  if (!isStackable(itemId)) return countHeld(state, itemId);
  const inBackpack = countInStacks(state.player.backpack, itemId);
  return cargoAccessible(state) ? inBackpack + countInStacks(state.canoe.cargo, itemId) : inBackpack;
}

/** Containers in the order new items go into them. */
function containerOrder(state: GameState): Container[] {
  if (state.player.mode === 'canoe') return ['cargo', 'backpack'];
  return cargoAccessible(state) ? ['backpack', 'cargo'] : ['backpack'];
}

/**
 * Give items to the player. Tools go on the belt, key items into key items,
 * the rest into the backpack and cargo (cargo first when aboard). Returns the
 * stacks that did not fit.
 */
export function grantItems(state: GameState, items: ItemAmount[]): ItemStack[] {
  const leftover: ItemStack[] = [];
  for (const { itemId, count } of items) {
    if (count <= 0) continue;
    const category = ITEMS[itemId].category;
    if (category === 'tool') {
      if (!state.player.tools.includes(itemId as ToolId)) {
        state.player.tools.push(itemId as ToolId);
        emit(state, { type: 'item_gained', itemId, count: 1, container: 'belt' });
      }
      continue;
    }
    if (!isStackable(itemId)) {
      state.player.keyItems[itemId] = (state.player.keyItems[itemId] ?? 0) + count;
      emit(state, { type: 'item_gained', itemId, count, container: 'key_items' });
      continue;
    }
    let remaining = count;
    for (const container of containerOrder(state)) {
      if (remaining <= 0) break;
      const after = addToStacks(stacksOf(state, container), slotsOf(state, container), itemId, remaining);
      if (after < remaining) emit(state, { type: 'item_gained', itemId, count: remaining - after, container });
      remaining = after;
    }
    if (remaining > 0) leftover.push({ itemId, count: remaining });
  }
  return leftover;
}

/** Remove items the player can reach. Assumes the caller checked the counts. */
export function spendItems(state: GameState, items: ItemAmount[]): void {
  for (const { itemId, count } of items) {
    if (!isStackable(itemId)) {
      if (ITEMS[itemId].category === 'tool') continue;
      const remaining = (state.player.keyItems[itemId] ?? 0) - count;
      if (remaining > 0) state.player.keyItems[itemId] = remaining;
      else delete state.player.keyItems[itemId];
      continue;
    }
    const fromBackpack = removeFromStacks(state.player.backpack, itemId, count);
    if (fromBackpack < count) removeFromStacks(state.canoe.cargo, itemId, count - fromBackpack);
  }
}

/** Items short of a cost, counting only what can be reached right now. */
export function itemsShort(state: GameState, cost: ItemAmount[], times = 1): ItemAmount[] {
  const short: ItemAmount[] = [];
  for (const { itemId, count } of cost) {
    const needed = count * times - countAccessible(state, itemId);
    if (needed > 0) short.push({ itemId, count: needed });
  }
  return short;
}

/**
 * Spend and gain in one go, or do nothing. Fails (returns false) when the
 * gained stacks would not fit once the spent ones are gone.
 */
export function exchangeItems(state: GameState, spend: ItemAmount[], gain: ItemAmount[]): boolean {
  const backpackBefore = state.player.backpack.map((stack) => ({ ...stack }));
  const cargoBefore = state.canoe.cargo.map((stack) => ({ ...stack }));
  const keyItemsBefore = { ...state.player.keyItems };
  const eventsBefore = state.events.length;
  spendItems(state, spend);
  const leftover = grantItems(state, gain);
  if (leftover.length === 0) return true;
  state.player.backpack = backpackBefore;
  state.canoe.cargo = cargoBefore;
  state.player.keyItems = keyItemsBefore;
  state.events.length = eventsBefore;
  return false;
}
