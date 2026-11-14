/** A sample of the pen: today's, or one of the fuller ones (see pens.js). */
export type PenName = 'today' | 'full' | 'bold' | 'near';

/** The samples by name, in the order they are shown. */
export const PEN_NAMES: readonly PenName[];
export const DEFAULT_PEN: PenName;

/**
 * A fuller pen's settings. `width`: against the middle of today's line. `weight`: the one weight it keeps (0 to 1).
 * `seam`: the ink of a seam inside a thing (today .64). `from`, `to`: metres from the eye, the full pen up to `from`
 * and today's past `to`; null for the full pen everywhere.
 */
export interface PenSample { width: number; weight: number; seam: number; from: number | null; to: number | null }
/** Today's pen has no settings: null. */
export const PENS: Record<PenName, PenSample | null>;

/** The sample an address parameter names (a name, or a letter a to d). Anything else, or nothing: today's pen. */
export function penFrom(text: string | null | undefined): PenName;
/** What the pen's shader is compiled with for a sample. Today's pen: an empty object. */
export function penDefines(name: PenName): Record<string, string | number>;
/** How far a sample's ink can lie from its edge, against today's pen. 1 or under: it fits the pen's probe and the hero windows' margin. */
export function penReach(name: PenName): number;
