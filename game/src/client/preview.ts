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

// The three below serve any still picture drawn once into a frame on the page. The lobby's canoe sketch is gone (r4-lobby);
// the pick screen's four figures (`interface/cast-host.ts`) still size, place and time their pictures with them.
/**
 * The picture's size in real pixels, for a frame of `cssWidth` by `cssHeight` CSS pixels on a screen of
 * `devicePixelRatio`: whole pixels, never wider or taller than the frame, so one picture pixel is one screen pixel.
 * The frame's size is cut to whole CSS pixels first, then to whole screen pixels.
 * Null when the frame is too small to draw in.
 */
export function sketchPixels(cssWidth: number, cssHeight: number, devicePixelRatio: number): { width: number; height: number } | null {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  // Whole CSS pixels first: on a 2x or 3x screen the picture is then a whole number of them wide, which every
  // browser places on whole screen pixels however it rounds.
  const width = Math.floor(Math.floor(cssWidth + 1e-6) * ratio + 1e-6);
  const height = Math.floor(Math.floor(cssHeight + 1e-6) * ratio + 1e-6);
  if (!(width >= MINIMUM_SKETCH_PIXELS && height >= MINIMUM_SKETCH_PIXELS)) return null;
  return { width: Math.min(width, MAXIMUM_SKETCH_PIXELS), height: Math.min(height, MAXIMUM_SKETCH_PIXELS) };
}

/** Under this many pixels a side there is nothing to see; over the other, a frame that size is a mistake. */
export const MINIMUM_SKETCH_PIXELS = 24;
export const MAXIMUM_SKETCH_PIXELS = 2048;

/**
 * How far to nudge a picture so its corner lands on a whole screen pixel: `at` is where it is, in CSS pixels.
 * A picture that starts between two screen pixels is smeared over both.
 */
export function pixelNudge(at: number, devicePixelRatio: number): number {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.round(at * ratio) / ratio - at;
}

/** The picture is never drawn before this frame of the page's life: the first frame times the chip (`look/quality.ts`), and nothing may be in its way. */
export const FIRST_DRAW_FRAME = 3;
/** A window being dragged to a new size gets its new picture once it has held still this long, milliseconds. */
export const SETTLE_MILLISECONDS = 250;

/** The picture on the page: what it shows and its size in real pixels. */
export interface DrawnPicture {
  key: string;
  width: number;
  height: number;
}

/**
 * Whether to draw the picture now. Each picture is drawn once: again only for another canoe (at once) or
 * another size (once the size has held still). A canoe that could not be drawn (`failedKey`) is not tried again.
 */
export function drawDue(input: {
  /** Frames of the page's life so far, this one included. */
  frame: number;
  /** The canoe to show, or null for none. */
  wantedKey: string | null;
  /** The size to show it at, or null when the frame is not on the page. */
  size: { width: number; height: number } | null;
  drawn: DrawnPicture | null;
  failedKey: string | null;
  /** When the size last changed, and now: milliseconds on one clock. */
  sizeChangedAt: number;
  now: number;
}): boolean {
  const { wantedKey, size, drawn } = input;
  if (wantedKey === null || size === null || input.frame < FIRST_DRAW_FRAME || input.failedKey === wantedKey) return false;
  if (drawn === null || drawn.key !== wantedKey) return true;
  if (drawn.width === size.width && drawn.height === size.height) return false;
  return input.now - input.sizeChangedAt >= SETTLE_MILLISECONDS;
}
