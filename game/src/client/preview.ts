/**
 * The lobby's canoe preview, the part that decides: which canoe the lobby shows and what it says under it
 * (Luc's bugfix list, Round 2: "on the loading screen is there a way it can preview your boats look from the
 * last save you played?").
 *
 * - A save that loads: the canoe of the slot played last, as saved. The slot is the one Continue opens.
 * - No save at all: the leaky canoe a new game starts with, and "Your canoe awaits".
 * - Nothing that loads, but something stored (a broken save): no picture.
 * - A save whose canoe cannot be drawn (a hull this build does not have): no picture.
 *
 * No DOM and no drawing in here. `interface/preview-host.ts` puts the picture on the page and
 * `look/canoe-sketch.ts` draws it, once.
 */
import { ATTACHMENT_IDS, HULL_TIERS } from '../data/index.ts';
import type { AttachmentId } from '../data/index.ts';
import { TUNING } from '../data/tuning.ts';
import type { LoadResult, SlotSummary } from '../save/index.ts';
import { createGame } from '../sim/index.ts';
import type { CanoeState, GameState } from '../sim/index.ts';
import { durationText } from './viewmodels/format.ts';

/** What the lobby view draws: a frame for the picture and one line under it. */
export interface LobbyPreviewModel {
  /** `save`: the canoe of the save played last. `starter`: no save yet, the canoe a new game begins with. */
  kind: 'save' | 'starter';
  /** The one line under the picture. */
  caption: string;
  /** What the picture shows, for someone who cannot see it. */
  label: string;
}

/** A canoe to draw, with its words. */
export interface PreviewSubject {
  kind: 'save' | 'starter';
  /** The slot the canoe was read from. Null for the starter canoe. */
  slot: number | null;
  /** A state holding that canoe and nothing else worth drawing: level, dry, at the origin, nobody aboard. */
  state: GameState;
  caption: string;
  label: string;
  /** Changes when the picture would: the whole canoe as posed. Anything a later build adds to the canoe is in it. */
  key: string;
}

/** What the lobby says under the canoe a new game starts with. */
export const STARTER_CAPTION = 'Your canoe awaits';

/** The seed the starter canoe's game is made on. Any seed gives the same canoe. */
const STARTER_SEED = 7;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * The saved canoe, posed for its picture: level, dry, at the origin, pointing north. Everything else is as
 * saved: the hull, every attachment, the sail up or down, the lantern lit or dark, beached or afloat.
 * Null when it cannot be drawn. An attachment this build does not know is left out, and so is one named twice.
 */
export function posedCanoe(canoe: unknown): CanoeState | null {
  if (!isRecord(canoe)) return null;
  const tier = canoe.hullTier;
  if (typeof tier !== 'number' || !Number.isInteger(tier) || tier < 0 || tier >= HULL_TIERS.length) return null;
  if (!Array.isArray(canoe.attachments)) return null;
  // In the order they were built, as the game draws them.
  const attachments = (canoe.attachments as unknown[]).filter((entry, index, all): entry is AttachmentId =>
    (ATTACHMENT_IDS as unknown[]).includes(entry) && all.indexOf(entry) === index);
  const rain = typeof canoe.rainProgress === 'number' && Number.isFinite(canoe.rainProgress) ? Math.max(0, Math.min(1, canoe.rainProgress)) : 0;
  return {
    ...(canoe as unknown as CanoeState),
    position: { x: 0, y: 0, z: 0 },
    heading: 0,
    speed: 0,
    pitch: 0,
    roll: 0,
    waterLevel: 0,
    hullTier: tier,
    attachments,
    sailRaised: canoe.sailRaised === true,
    lanternLit: canoe.lanternLit === true,
    beached: canoe.beached === true,
    rainProgress: rain,
  };
}

/** A state that holds `canoe` and one person, ashore and out of the picture. The canoe view reads nothing else. */
function stateAround(canoe: CanoeState): GameState {
  const state = createGame(STARTER_SEED);
  state.canoe = canoe;
  const player = state.players[0];
  player.mode = 'foot';
  player.seat = null;
  player.paddling = false;
  player.bailing = false;
  player.asleep = false;
  state.players = [player];
  return state;
}

/** "Patched canoe, day 3, 1 h 12 min played". */
export function previewCaption(hullTier: number, time: number, playedSeconds: number): string {
  const day = Math.floor(time / TUNING.time.daySeconds) + 1;
  return `${HULL_TIERS[hullTier].name}, day ${day}, ${durationText(playedSeconds)} played`;
}

/** The canoe a new game starts with. */
export function starterSubject(): PreviewSubject {
  const canoe = posedCanoe(createGame(STARTER_SEED).canoe)!;
  return {
    kind: 'starter', slot: null, state: stateAround(canoe), caption: STARTER_CAPTION,
    label: `The ${HULL_TIERS[canoe.hullTier].name.toLowerCase()} a new game starts with`, key: `starter|${JSON.stringify(canoe)}`,
  };
}

/**
 * What the lobby shows. `summaries` and `latestSlot` are the session's (`slotSummaries`, `latestSlot`: the slot
 * Continue opens), `load` reads a slot. Never throws: whatever is wrong with a save, the answer is null.
 */
export function previewSubject(
  summaries: readonly SlotSummary[], latestSlot: number | null, load: (slot: number) => LoadResult,
): PreviewSubject | null {
  try {
    if (latestSlot === null) {
      // Something is stored and none of it loads: a broken save gets no picture. Nothing stored: the starter canoe.
      return summaries.some((summary) => !summary.empty) ? null : starterSubject();
    }
    const loaded = load(latestSlot);
    if (!loaded.ok) return null;
    const canoe = posedCanoe(loaded.state.canoe);
    if (!canoe) return null;
    const time = typeof loaded.state.time === 'number' && Number.isFinite(loaded.state.time) ? loaded.state.time : 0;
    const played = typeof loaded.state.playedSeconds === 'number' && Number.isFinite(loaded.state.playedSeconds) ? loaded.state.playedSeconds : 0;
    const caption = previewCaption(canoe.hullTier, time, played);
    return {
      kind: 'save', slot: latestSlot, state: stateAround(canoe), caption,
      label: `Your canoe in slot ${latestSlot + 1}: ${caption}`, key: `save|${JSON.stringify(canoe)}`,
    };
  } catch {
    return null;
  }
}

/** The model of a subject: what the lobby view needs, and no more. */
export function previewModel(subject: PreviewSubject): LobbyPreviewModel {
  return { kind: subject.kind, caption: subject.caption, label: subject.label };
}

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
