/**
 * Give: hand a stack from your backpack to a crewmate standing close (Luc, round 4: "i like the give").
 *
 * Before this nothing passed from one player to another except through the canoe's cargo. `give` is one command,
 * run by the host like every other, so a guest gives and receives the same way the host does.
 *
 * - Only from the giver's own backpack, only to another player of the crew who is not away, and only when the two
 *   are close: both aboard the canoe, or both on foot on the same island within `TUNING.foot.giveRange` metres.
 * - Never a tool and never a key item: those are the whole crew's already.
 * - The part that fits goes over, as with Shift+click to the canoe: the other backpack tops up its own stacks
 *   first, then fills its free slots. With no room at all the give is refused.
 * - Never more than the giver holds. A give that asks for more than is there now (the stack was eaten from, moved
 *   or dropped between the click and the host's answer) is refused whole and nothing moves.
 * - Nothing is made or lost: what leaves one backpack is what lands in the other, to the piece.
 *
 * Both players are told by the game's usual notes. The giver's is an `item_lost` that names who it went to
 * (`givenTo`), the other's an `item_gained` that names who it came from (`givenBy`): no new kind of event, so no
 * new sound.
 */
import type { ItemId } from '../data/types.ts';
import { ITEMS, isStackable } from '../data/items.ts';
import { TUNING } from '../data/tuning.ts';
import { failure, success } from './crafting.ts';
import { addToStacks, countInStacks, emit, removeFromStacks, roomFor } from './inventory.ts';
import { updateQuests } from './quests.ts';
import type { CommandResult, FailureReason, GameState, PlayerId, PlayerState } from './types.ts';

/** True when two players are close enough to hand something over: both aboard, or a few steps apart on one island. */
export function withinGiveReach(giver: PlayerState, other: PlayerState): boolean {
  if (giver.mode === 'canoe' || other.mode === 'canoe') return giver.mode === other.mode;
  if (giver.islandId !== other.islandId) return false;
  return Math.hypot(giver.position.x - other.position.x, giver.position.z - other.position.z) <= TUNING.foot.giveRange;
}

/** The crewmates this player could give to right now: everyone else who is not away and is close, in id order. */
export function crewInGiveReach(state: GameState, giver: PlayerState): PlayerState[] {
  return state.players.filter((other) => other.id !== giver.id && other.connected && withinGiveReach(giver, other));
}

/** How many of an item still fit in a player's backpack. */
export function giveRoom(player: PlayerState, itemId: ItemId): number {
  return roomFor(player.backpack, TUNING.inventory.backpackSlots, itemId);
}

/** Why this give is refused before anything is counted, or null: the item, the amount, and who it is for. */
function refusal(state: GameState, giver: PlayerState, to: PlayerId, itemId: ItemId, count: number): FailureReason | null {
  if (!Object.hasOwn(ITEMS, itemId)) return 'unknown_id';
  if (ITEMS[itemId].category === 'tool') return 'tool_is_shared';
  if (!isStackable(itemId)) return 'key_item_is_shared';
  if (!Number.isInteger(count) || count < 1) return 'invalid_amount';
  if (to === giver.id) return 'give_to_self';
  // By the number itself, never `playerOf`: that falls back to the first player, and a made-up number is nobody.
  const other = state.players.find((player) => player.id === to);
  if (!other) return 'no_such_crewmate';
  if (!other.connected) return 'crewmate_away';
  if (!withinGiveReach(giver, other)) return 'crewmate_too_far';
  return null;
}

/** The `give` command: `count` of an item from this player's backpack to the crewmate `to`, or the part that fits. */
export function give(state: GameState, giver: PlayerState, to: PlayerId, itemId: ItemId, count: number): CommandResult {
  const refused = refusal(state, giver, to, itemId, count);
  if (refused) return failure(refused);
  const other = state.players.find((player) => player.id === to)!;
  const held = countInStacks(giver.backpack, itemId);
  if (held < 1) return failure('item_not_held');
  if (held < count) return failure('stack_changed');
  if (giveRoom(other, itemId) < 1) return failure('crewmate_bag_full');
  // Into the other backpack first, then out of this one by exactly what went in: nothing is made, nothing is lost.
  const given = count - addToStacks(other.backpack, TUNING.inventory.backpackSlots, itemId, count);
  removeFromStacks(giver.backpack, itemId, given);
  emit(state, { type: 'item_lost', itemId, count: given, givenTo: other.id }, giver);
  emit(state, { type: 'item_gained', itemId, count: given, container: 'backpack', givenBy: giver.id }, other);
  updateQuests(state, other);
  return success([], [{ itemId, count: given }]);
}
