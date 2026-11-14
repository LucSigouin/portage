/**
 * The cast, drawn once: the pictures the pick screen shows, one standing figure per character.
 *
 * This file is the seam between two jobs. The pick screen (`interface/cast-host.ts`) calls
 * `drawCastSketches` and lays the canvases on its cards. The look fills in the drawing here, with the
 * game's own figures and the game's own pen, the way `look/canoe-sketch.ts` draws the lobby's canoe.
 *
 * The signature below is frozen. Until the look's half lands this returns null, and the screen shows
 * its cards with words only.
 */
import type { CharacterId } from '../data/cast.ts';

export interface CastSketchRequest {
  /** Who to draw, in the order the pictures come back. */
  characters: readonly CharacterId[];
  /** The seat whose colour each figure wears (`CREW_MARKS`), 0 to 3. */
  seat: number;
  /** The size of each picture, in real pixels. All the pictures are the same size. */
  pixelWidth: number;
  pixelHeight: number;
  /** The height in real pixels of the window the pictures are shown in: the pen is the one the game uses there. */
  sheetHeight: number;
}

/**
 * One see-through canvas per character, in the order asked, each exactly `pixelWidth` by `pixelHeight`.
 * Every figure is drawn at the same scale with its feet on the same line, so the tall one is taller on
 * its card. Null when no picture can be made (no 3D context, a size of nothing).
 */
export function drawCastSketches(request: CastSketchRequest): HTMLCanvasElement[] | null {
  void request;
  return null;
}
