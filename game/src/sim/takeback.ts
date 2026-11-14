/**
 * A dropped stack's way back (the master review of round 3, finding 2).
 *
 * A drop is one press with no "are you sure" (Luc's words: "hover+q to drop"), so the rules keep a short record of
 * it, and for a few seconds the player who dropped it may ask for it back with `take_back`.
 *
 * - The record is the rules' own. A screen names a drop by its number and nothing else, so nobody, host or guest,
 *   can ask for an item or a count that was not dropped, and no drop comes back twice.
 * - The stack goes back where it was: the same container, its own stacks topped up first, and a stack that was
 *   emptied is put back on the slot it stood on.
 * - All of it or none. With no room for the whole stack the answer is "No room." and the offer stands until its
 *   time is up, so the player may make room and ask again.
 * - The clock is the game's own (`playedSeconds`). Alone with a panel open the game stands still and so does the
 *   offer: there the note on the screen, which runs on real time, is what ends it.
 *
 * - A drop does not dodge a loss (the second review of round 3, new finding 2). A capsize takes half of every cargo
 *   stack, and a collapse alone in a crew half of that player's backpack. What was dropped a moment earlier is not
 *   there to lose its half, so the loss ends every take-back out of that container: it stays dropped
 *   (`endTakeBacksFrom`).
 * - A drop is its dropper's own. A seat that goes to someone new comes with nothing to take back (`endTakeBacksOf`).
 *
 * Each player has their own record (`PlayerState.drops`). It is absent until that player's first drop, and in
 * every save from before it existed.
 */
import type { ItemId } from '../data/types.ts';
import { TUNING } from '../data/tuning.ts';
import { failure, success } from './crafting.ts';
import { cargoAccessible, emit, playerOf, roomFor, slotsOf, stacksOf } from './inventory.ts';
import { updateQuests } from './quests.ts';
import type { CommandResult, Container, GameState, ItemStack, PlayerId, PlayerState } from './types.ts';

export const TAKE_BACK = {
  /** Game seconds a drop may be taken back for. A second longer than its note stands, for a guest's line. */
  seconds: 6,
  /** Drops remembered per player. A note stack holds no more. */
  kept: 6,
} as const;

/** One drop that may still be taken back. */
export interface DropRecord {
  /** This player's drops count from 1. */
  id: number;
  itemId: ItemId;
  count: number;
  from: Container;
  /** The slot the first emptied stack stood on, or -1 when the drop emptied none. */
  slot: number;
  /** `playedSeconds` at the drop. */
  at: number;
}

/** A player's drops: the number of the last one, and the ones that may still come back, oldest first. */
export interface DropLedger {
  last: number;
  open: DropRecord[];
}

const standing = (state: GameState, record: DropRecord): boolean =>
  state.playedSeconds - record.at <= TAKE_BACK.seconds && state.playedSeconds >= record.at;

/**
 * Take `count` of an item out of a container as a drop, and remember it. Returns the drop's number and how many
 * went, or null when the container held none. The caller has already checked that the item may be dropped.
 */
export function dropFromStacks(
  state: GameState, player: PlayerState, from: Container, itemId: ItemId, count: number,
): { id: number; count: number } | null {
  const stacks = stacksOf(state, player, from);
  const before = stacks.map((stack, slot) => ({ stack, slot }));
  // Smallest stacks first, as every other spend (`removeFromStacks`), but here the emptied slots are noted.
  let remaining = count;
  for (const { stack } of before.filter((entry) => entry.stack.itemId === itemId).sort((first, second) => first.stack.count - second.stack.count)) {
    if (remaining <= 0) break;
    const moved = Math.min(stack.count, remaining);
    stack.count -= moved;
    remaining -= moved;
  }
  const dropped = count - remaining;
  if (dropped <= 0) return null;
  const emptied = before.find((entry) => entry.stack.count <= 0);
  for (let index = stacks.length - 1; index >= 0; index -= 1) {
    if (stacks[index].count <= 0) stacks.splice(index, 1);
  }
  const ledger: DropLedger = player.drops ?? { last: 0, open: [] };
  ledger.last += 1;
  ledger.open = ledger.open.filter((record) => standing(state, record));
  ledger.open.push({ id: ledger.last, itemId, count: dropped, from, slot: emptied ? emptied.slot : -1, at: state.playedSeconds });
  if (ledger.open.length > TAKE_BACK.kept) ledger.open.splice(0, ledger.open.length - TAKE_BACK.kept);
  player.drops = ledger;
  return { id: ledger.last, count: dropped };
}

/** Put a stack back: its own stacks are topped up first, and what is left stands on `slot` again. */
function putBack(stacks: ItemStack[], itemId: ItemId, count: number, slot: number): void {
  const stackSize = TUNING.inventory.stackSize;
  let remaining = count;
  for (const stack of stacks) {
    if (remaining <= 0) break;
    if (stack.itemId !== itemId || stack.count >= stackSize) continue;
    const moved = Math.min(stackSize - stack.count, remaining);
    stack.count += moved;
    remaining -= moved;
  }
  let at = slot < 0 ? stacks.length : Math.min(slot, stacks.length);
  while (remaining > 0) {
    const moved = Math.min(stackSize, remaining);
    stacks.splice(at, 0, { itemId, count: moved });
    remaining -= moved;
    at += 1;
  }
}

/**
 * The drop numbered `dropId` of this player, while it may still be taken back. Null once it is back, too old,
 * pushed out by newer drops, or was never made. Reading changes nothing.
 */
export function standingDrop(state: GameState, playerId: PlayerId, dropId: number): DropRecord | null {
  const record = playerOf(state, playerId).drops?.open.find((entry) => entry.id === dropId);
  return record && standing(state, record) ? record : null;
}

/** The `take_back` command: this player's drop `dropId` goes back where it was, whole, or nothing moves. */
export function takeBack(state: GameState, player: PlayerState, dropId: number): CommandResult {
  const ledger = player.drops;
  const record = ledger?.open.find((entry) => entry.id === dropId);
  // No such drop of this player's: it is back already, it was cleared away long since, or it was never made.
  if (!ledger || !record) return failure('nothing_to_take_back');
  if (!standing(state, record)) {
    ledger.open = ledger.open.filter((entry) => entry !== record);
    return failure('take_back_too_late');
  }
  if (record.from === 'cargo' && !cargoAccessible(state, player)) return failure('not_at_canoe');
  const stacks = stacksOf(state, player, record.from);
  if (roomFor(stacks, slotsOf(state, record.from), record.itemId) < record.count) return failure('inventory_full');
  ledger.open = ledger.open.filter((entry) => entry !== record);
  putBack(stacks, record.itemId, record.count, record.slot);
  emit(state, { type: 'item_gained', itemId: record.itemId, count: record.count, container: record.from, dropId: record.id }, player);
  updateQuests(state, player);
  return success([{ itemId: record.itemId, count: record.count }]);
}

/**
 * A loss has just taken half of every stack in `stacks` (the cargo, or one player's backpack): every take-back out
 * of that container ends. The cargo is the whole crew's, so each player's drops out of it end, also those of a
 * player who is away and was not washed ashore. Drops out of any other container stand as they were.
 */
export function endTakeBacksFrom(state: GameState, stacks: ItemStack[]): void {
  for (const player of state.players) {
    const ledger = player.drops;
    if (ledger) ledger.open = ledger.open.filter((record) => stacksOf(state, player, record.from) !== stacks);
  }
}

/** This player's seat goes to someone new: nothing the one before them dropped may be taken back. The count goes on. */
export function endTakeBacksOf(state: GameState, playerId: PlayerId): void {
  const ledger = state.players.find((player) => player.id === playerId)?.drops;
  if (ledger) ledger.open = [];
}
