/**
 * A guest's own things: the pack and the three meters. They live in the guest's
 * own browser and go with the guest to any crew (`join.carry`). The host
 * believes what a guest brings: friends only, and editing it is accepted.
 *
 * Not carried: the spot (each host has another world), tools and the belt
 * (the crew's), tracked quests (the crew's), take-backs (the dropper's, here).
 */
import { ITEMS, TUNING } from '../data/index.ts';
import type { ItemId } from '../data/types.ts';
import { STARTING_METERS } from '../sim/index.ts';
import type { ItemStack, PlayerState } from '../sim/index.ts';

/** Bump when the shape of a kept carry changes. A carry of another version is not read. */
export const CARRY_VERSION = 1;

export interface Carry {
  v: number;
  backpack: ItemStack[];
  hunger: number;
  thirst: number;
  energy: number;
  /** The host session (`welcome.session`) that last sent this carry. Absent: no host known. */
  confirmedBy?: number;
}

/** The highest a meter goes. */
const METER_TOP = 100;

/** What a seat holds when it goes to someone who brings nothing: the starting kit and the meters `addPlayer` gives. */
export function freshCarry(): Carry {
  return { v: CARRY_VERSION, backpack: [], ...STARTING_METERS };
}

/** A player's own things, copied: what a guest keeps of the host's record of them, and which host session sent it. */
export function carryOf(player: PlayerState, confirmedBy?: number): Carry {
  return {
    v: CARRY_VERSION,
    backpack: player.backpack.map((stack) => ({ itemId: stack.itemId, count: stack.count })),
    hunger: player.hunger,
    thirst: player.thirst,
    energy: player.energy,
    ...(confirmedBy === undefined ? {} : { confirmedBy }),
  };
}

/** Put a carry on a seat: the pack and the meters, nothing else. */
export function applyCarry(player: PlayerState, carry: Carry): void {
  player.backpack = carry.backpack.map((stack) => ({ itemId: stack.itemId, count: stack.count }));
  player.hunger = carry.hunger;
  player.thirst = carry.thirst;
  player.energy = carry.energy;
}

/**
 * A meter from somebody else's browser: a finite number, held to 0 to 100. A
 * meter at 0, or so near it that the rules already refuse effort (under
 * `minimumEnergyToExert`), comes in at the value a fail wakes a player at, so
 * somebody who left while down does not join only to fail again at once.
 */
function readMeter(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const held = Math.min(METER_TOP, Math.max(0, raw));
  return held < TUNING.survival.minimumEnergyToExert ? TUNING.survival.failMeterValue : held;
}

/**
 * A carry from the wire or from storage, checked field by field. Null when it
 * is not exactly one: another version, a field too many or missing, an item
 * the game does not have, a count that is not a whole number a stack may hold,
 * more stacks than a pack holds. Never throws.
 */
export function readCarry(raw: unknown): Carry | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const fields = ['v', 'backpack', 'hunger', 'thirst', 'energy'];
  const hasConfirmedBy = Object.hasOwn(record, 'confirmedBy');
  if (Object.keys(record).length !== fields.length + (hasConfirmedBy ? 1 : 0) || !fields.every((field) => Object.hasOwn(record, field))) return null;
  if (record.v !== CARRY_VERSION) return null;
  // A host session is a whole number, as `welcome.session` is read.
  const confirmedBy = record.confirmedBy;
  if (hasConfirmedBy && (typeof confirmedBy !== 'number' || !Number.isSafeInteger(confirmedBy) || confirmedBy < 0)) return null;
  const stacks = record.backpack;
  if (!Array.isArray(stacks) || stacks.length > TUNING.inventory.backpackSlots) return null;
  const backpack: ItemStack[] = [];
  for (const stack of stacks) {
    if (typeof stack !== 'object' || stack === null || Array.isArray(stack)) return null;
    const entry = stack as Record<string, unknown>;
    if (Object.keys(entry).length !== 2) return null;
    if (typeof entry.itemId !== 'string' || !Object.hasOwn(ITEMS, entry.itemId)) return null;
    const count = entry.count;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > TUNING.inventory.stackSize) return null;
    backpack.push({ itemId: entry.itemId as ItemId, count });
  }
  const hunger = readMeter(record.hunger);
  const thirst = readMeter(record.thirst);
  const energy = readMeter(record.energy);
  if (hunger === null || thirst === null || energy === null) return null;
  return { v: CARRY_VERSION, backpack, hunger, thirst, energy, ...(hasConfirmedBy ? { confirmedBy: confirmedBy as number } : {}) };
}

/** Where a guest keeps its carry (`client/carrystore.ts`). The link reads it at the door and tells it what the host confirmed. */
export interface CarryKeeper {
  read(): Carry | null;
  note(carry: Carry, clock: number): void;
  flush(): void;
}
