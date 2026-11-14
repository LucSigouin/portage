/**
 * Which canoe the lobby shows: the one of the save played last (Luc's bugfix list, Round 2: "on the loading screen
 * is there a way it can preview your boats look from the last save you played?"; Round 4: it is the canoe that
 * drifts in the scene behind the menu, `backdrop.ts`).
 *
 * - A save that loads: the canoe of the slot played last, as saved. The slot is the one Continue opens.
 * - No save at all, nothing that loads (a broken save), or a canoe that cannot be drawn (a hull this build does
 *   not have): none. The scene keeps the canoe it always had.
 *
 * Reading only: nothing in here writes to a save. No DOM and no drawing.
 */
import { ATTACHMENT_IDS, HULL_TIERS } from '../data/index.ts';
import type { AttachmentId } from '../data/index.ts';
import type { LoadResult } from '../save/index.ts';

/**
 * What of a canoe is its look and nothing else. Everything the look reads off a canoe is either here or is where
 * the canoe is and how it sits (position, heading, tilt, water aboard, beached).
 */
export interface CanoeDress {
  hullTier: number;
  /** In the order they were built, as the game draws them. */
  attachments: AttachmentId[];
  sailRaised: boolean;
  lanternLit: boolean;
  /** How full the rain catcher's pail stands, 0 to 1. */
  rainProgress: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * The look of a saved canoe: the hull, every attachment, the sail up or down, the lantern lit or dark, the pail.
 * Null when it cannot be drawn. An attachment this build does not know is left out, and so is one named twice.
 */
export function savedDress(canoe: unknown): CanoeDress | null {
  if (!isRecord(canoe)) return null;
  const tier = canoe.hullTier;
  if (typeof tier !== 'number' || !Number.isInteger(tier) || tier < 0 || tier >= HULL_TIERS.length) return null;
  if (!Array.isArray(canoe.attachments)) return null;
  const attachments = (canoe.attachments as unknown[]).filter((entry, index, all): entry is AttachmentId =>
    (ATTACHMENT_IDS as unknown[]).includes(entry) && all.indexOf(entry) === index);
  const rain = typeof canoe.rainProgress === 'number' && Number.isFinite(canoe.rainProgress) ? Math.max(0, Math.min(1, canoe.rainProgress)) : 0;
  return { hullTier: tier, attachments, sailRaised: canoe.sailRaised === true, lanternLit: canoe.lanternLit === true, rainProgress: rain };
}

/**
 * The canoe of the save played last. `latestSlot` is the session's (the slot Continue opens, null with no save
 * that loads), `load` reads a slot. Never throws: whatever is wrong with a save, the answer is null.
 */
export function lastPlayedDress(latestSlot: number | null, load: (slot: number) => LoadResult): CanoeDress | null {
  try {
    if (latestSlot === null) return null;
    const loaded = load(latestSlot);
    return loaded.ok ? savedDress(loaded.state.canoe) : null;
  } catch {
    return null;
  }
}
