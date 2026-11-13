import type { IslandDefinition, ItemAmount, ItemId, QuestId, ToolId } from '../data/types.ts';
import { ATTACHMENTS, HULL_TIERS } from '../data/canoe.ts';
import { ITEMS, STOCK_FOOD_IDS, TOOL_IDS, isStackable } from '../data/items.ts';
import { QUEST_LIST } from '../data/quests.ts';
import { TUNING } from '../data/tuning.ts';
import { CAMP_LAYOUTS, ISLANDS_BY_ID, spotPosition } from '../data/world.ts';
import { MAXIMUM_PLAYERS } from './types.ts';
import type { Container, FailureReason, GameEvent, GameState, ItemStack, Missing, PlayerId, PlayerState } from './types.ts';

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

/**
 * The island whose camp the player is standing in, or null. A camp is the ground round its fire, and a few
 * steps round everything that stands in it: the bench and the lean-to are further from the fire than the fire reaches.
 */
export function campInReach(player: PlayerState): IslandDefinition | null {
  if (player.mode !== 'foot' || !player.islandId) return null;
  const definition = ISLANDS_BY_ID[player.islandId];
  if (!definition.camp) return null;
  const position = spotPosition(definition, definition.camp.spot);
  const distance = Math.hypot(player.position.x - position.x, player.position.z - position.z);
  if (distance <= TUNING.foot.campRange) return definition;
  const { x, z } = player.position;
  const near = TUNING.foot.campLandmarkRange;
  const atLandmark = CAMP_LAYOUTS[definition.id]?.landmarks.some((landmark) => Math.hypot(x - landmark.x, z - landmark.z) <= near);
  return atLandmark ? definition : null;
}

/**
 * How far the player is from the nearest bed of the camp they stand in, or null when no bed is in reach. A bed is
 * the lean-to, a bedroll or the keeper's hut, and it reaches `campLandmarkRange`. The fire warms and cooks: only a
 * bed sleeps.
 */
export function distanceToBed(player: PlayerState): number | null {
  if (player.mode !== 'foot' || !player.islandId || !ISLANDS_BY_ID[player.islandId].camp?.sleep) return null;
  const layout = CAMP_LAYOUTS[player.islandId];
  if (!layout) return null;
  let nearest: number | null = null;
  for (const bed of layout.beds) {
    const distance = Math.hypot(bed.x - player.position.x, bed.z - player.position.z);
    if (distance <= TUNING.foot.campLandmarkRange && (nearest === null || distance < nearest)) nearest = distance;
  }
  return nearest;
}

/** True when aboard or standing close enough to use what is on the canoe. */
export function atCanoe(state: GameState, player: PlayerState): boolean {
  return player.mode === 'canoe' || distanceToCanoe(state, player) <= TUNING.canoe.accessRange;
}

/**
 * True when the canoe is landed at the island this player stands on: it rests on the ground (it touched the shore,
 * or was pulled up when someone stepped out) and the island it rests at is the player's. Paddling it off ends it.
 * Luc's list, line 17: then its cargo is in reach from anywhere on that island.
 */
export function canoeLandedHere(state: GameState, player: PlayerState): boolean {
  return player.mode === 'foot' && player.islandId !== null && state.canoe.beached
    && state.canoe.lastBeached.islandId === player.islandId;
}

/**
 * True when cargo can be reached: aboard, beside the canoe, or anywhere on the island where the canoe is landed.
 * Stowing, taking, crafting, eating and what does not fit in the backpack all follow it. Stations do not: a bench
 * recipe still needs a bench, cooking a fire, and the canoe's own stations still need the canoe close by.
 */
export function cargoAccessible(state: GameState, player: PlayerState): boolean {
  return atCanoe(state, player) || canoeLandedHere(state, player);
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

/** How many of an item still fit in stacks: what is left of its own stacks, and every free slot. */
export function roomFor(stacks: readonly ItemStack[], slots: number, itemId: ItemId): number {
  const stackSize = TUNING.inventory.stackSize;
  let room = Math.max(0, slots - stacks.length) * stackSize;
  for (const stack of stacks) if (stack.itemId === itemId) room += Math.max(0, stackSize - stack.count);
  return room;
}

// --- The tool belt, in each player's own order ---------------------------------------

/** Slots on a belt: one a tool, so every tool the game has always has a place. */
export const BELT_SLOTS = TOOL_IDS.length;

/** The slots at the front of the belt that the tool keys answer (`tool1` to `tool5`). The rest are spare. */
export const NUMBERED_BELT_SLOTS = 5;

/**
 * The crew's tools as this player has laid them out: `BELT_SLOTS` long, null for an empty slot. The tools are the
 * crew's (`state.tools`), the order is the player's own (`toolSlots`). A tool the player never placed, and so every
 * tool of a player who never moved one, takes the first free slot in the order the crew got them. A saved slot that
 * names a tool the crew does not have, or the same tool twice, reads as empty. Reading never changes the state.
 */
export function beltOf(state: GameState, player: PlayerState): (ToolId | null)[] {
  const belt: (ToolId | null)[] = Array.from({ length: BELT_SLOTS }, () => null);
  const placed = new Set<ToolId>();
  const saved = Array.isArray(player.toolSlots) ? player.toolSlots : [];
  for (let slot = 0; slot < BELT_SLOTS && slot < saved.length; slot += 1) {
    const toolId = saved[slot];
    if (toolId === null || toolId === undefined || placed.has(toolId) || !hasTool(state, toolId)) continue;
    belt[slot] = toolId;
    placed.add(toolId);
  }
  for (const toolId of state.tools) {
    if (placed.has(toolId)) continue;
    const free = belt.indexOf(null);
    if (free < 0) break;
    belt[free] = toolId;
    placed.add(toolId);
  }
  return belt;
}

/**
 * Put a tool on a slot of this player's belt. The tool that was there takes the slot the moved one left, so no
 * tool is ever off the belt. False when the crew does not have the tool or there is no such slot.
 */
export function moveTool(state: GameState, player: PlayerState, toolId: ToolId, slot: number): boolean {
  if (!hasTool(state, toolId) || !Number.isInteger(slot) || slot < 0 || slot >= BELT_SLOTS) return false;
  const belt = beltOf(state, player);
  const from = belt.indexOf(toolId);
  if (from < 0) return false;
  belt[from] = belt[slot];
  belt[slot] = toolId;
  player.toolSlots = belt;
  return true;
}

// --- What may not be dropped -----------------------------------------------------------

/**
 * The open quest that losing `count` of an item would set back, or null. Open is given and not handed in. A quest
 * asks for an item by a "have", a "hand over" or a "stock the canoe" step: when the crew would be left holding
 * fewer than the step asks for, the quest holds the stack. What the crew holds beyond that is free to go.
 */
export function questHolding(state: GameState, itemId: ItemId, count: number): QuestId | null {
  if (!isStackable(itemId)) return null;
  const left = countHeld(state, itemId) - count;
  for (const definition of QUEST_LIST) {
    const status = state.quests[definition.id]?.status;
    if (status !== 'active' && status !== 'ready') continue;
    for (const objective of definition.objectives) {
      if (objective.type === 'have_item' || objective.type === 'deliver') {
        if (objective.itemId !== itemId) continue;
        // Made into the thing it was for: the step is done for good and the rest is spare.
        if (objective.type === 'have_item' && objective.madeInto) {
          const made = 'toolId' in objective.madeInto
            ? hasTool(state, objective.madeInto.toolId) : state.canoe.attachments.includes(objective.madeInto.attachmentId);
          if (made) continue;
        }
        if (left < objective.count) return definition.id;
      } else if (objective.type === 'stock') {
        if (itemId === 'clean_water') {
          if (objective.cleanWater > 0 && left < objective.cleanWater) return definition.id;
        } else if (STOCK_FOOD_IDS.includes(itemId)) {
          let others = 0;
          for (const foodId of STOCK_FOOD_IDS) if (foodId !== itemId) others += countHeld(state, foodId);
          if (objective.stockFood > 0 && others + left < objective.stockFood) return definition.id;
        }
      }
    }
  }
  return null;
}

/**
 * Why `count` of an item may not be dropped, or null when it may. Never a tool, never a key item, never what an
 * open quest of the crew's still asks for (`questHolding`). The interface greys its Drop button by the same rule.
 */
export function discardRefusal(state: GameState, itemId: ItemId, count: number): FailureReason | null {
  if (ITEMS[itemId].category === 'tool') return 'tool_kept';
  if (!isStackable(itemId)) return 'key_item_kept';
  return questHolding(state, itemId, count) !== null ? 'quest_needs_item' : null;
}
