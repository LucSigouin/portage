/**
 * The note that says this browser is drawing without the graphics card (`look/graphics-card.ts`), on the two
 * screens where a player decides to start: the main menu, and the join card a friend lands on from an invite link.
 *
 * When it shows:
 * - `&card=soft` in the address: always. `&card=real`: never. (For a picture and a test.)
 * - Otherwise only when the renderer's name is a software one, and never in a staged shot (`?shot=`) nor in a
 *   browser a test drives (`navigator.webdriver`): the test browsers on Luc's Mac draw in software themselves,
 *   and their pictures are pinned.
 * - A name that is missing or unknown: no note. Say nothing when you cannot tell.
 *
 * It is a note, not a wall: no button, nothing to close, the player can still start.
 */
import { isSoftwareRenderer } from '../../look/graphics-card.ts';
import type { InterfaceModel } from './types.ts';

export interface GraphicsCardNoteModel {
  title: string;
  lines: string[];
}

export interface GraphicsCardFacts {
  /** Who draws the game's picture, from its own 3D context. Null when the browser does not say. */
  rendererName: string | null;
  /** `navigator.userAgent`: picks whose settings the note names. */
  userAgent: string;
  /** The address's `&card=` switch: 'soft' forces the note on, 'real' forces it off, null leaves it to the name. */
  forced: 'soft' | 'real' | null;
  /** True in a staged shot (`?shot=<name>`). */
  staged: boolean;
  /** True in a browser driven by a test (`navigator.webdriver`). */
  driven: boolean;
}

export const GRAPHICS_CARD_TITLE = 'This browser is drawing without the graphics card.';
export const GRAPHICS_CARD_SLOW_LINE = 'The game will be very slow until that is turned on.';
const CHROMIUM_STEPS = 'Settings, System, turn on "Use graphics acceleration when available", then restart the browser.';
export const GRAPHICS_CARD_CHROME_LINE = `Chrome: ${CHROMIUM_STEPS}`;
export const GRAPHICS_CARD_EDGE_LINE = `Edge: ${CHROMIUM_STEPS}`;
export const GRAPHICS_CARD_FIREFOX_LINE = 'Firefox: Settings, General, Performance, turn on "Use hardware acceleration when available", then restart the browser.';
export const GRAPHICS_CARD_OTHER_LINE = 'Other browsers: look for hardware or graphics acceleration in the settings.';

/** Which browser this surely is, by its own name for itself. Null for every other one, and for one that wears Chrome's name. */
export function browserFamily(userAgent: string): 'chrome' | 'edge' | 'firefox' | null {
  if (/\bEdg(?:e|A|iOS)?\//.test(userAgent)) return 'edge';
  if (/\bFirefox\//.test(userAgent)) return 'firefox';
  // Opera, Brave, Vivaldi, Samsung's and others are built on Chrome and say "Chrome" too: not surely Chrome.
  if (/\bChrome\//.test(userAgent) && !/\b(?:OPR|Opera|Vivaldi|Brave|SamsungBrowser|YaBrowser|DuckDuckGo)\b/.test(userAgent)) return 'chrome';
  return null;
}

/** The fix, in the words of the browser's own settings. An unsure browser gets Chrome's line and a line for the rest. */
export function graphicsCardFixLines(userAgent: string): string[] {
  switch (browserFamily(userAgent)) {
    case 'chrome': return [GRAPHICS_CARD_CHROME_LINE];
    case 'edge': return [GRAPHICS_CARD_EDGE_LINE];
    case 'firefox': return [GRAPHICS_CARD_FIREFOX_LINE];
    default: return [GRAPHICS_CARD_CHROME_LINE, GRAPHICS_CARD_OTHER_LINE];
  }
}

/** The note, or null when there is nothing to say. Worked out once, at the start. */
export function buildGraphicsCardNote(facts: GraphicsCardFacts): GraphicsCardNoteModel | null {
  if (facts.forced === 'real') return null;
  if (facts.forced !== 'soft') {
    if (facts.staged || facts.driven) return null;
    if (!isSoftwareRenderer(facts.rendererName)) return null;
  }
  return { title: GRAPHICS_CARD_TITLE, lines: [GRAPHICS_CARD_SLOW_LINE, ...graphicsCardFixLines(facts.userAgent)] };
}

/**
 * A frame of the interface with the note on the main menu and on the join card, where either is on screen.
 * With no note the frame is handed back as it came: the very same object.
 */
export function withGraphicsCardNote(model: InterfaceModel, note: GraphicsCardNoteModel | null): InterfaceModel {
  if (!note) return model;
  const onJoinCard = model.panel?.id === 'crew_join';
  if (!model.lobby && !onJoinCard) return model;
  return {
    ...model,
    lobby: model.lobby ? { ...model.lobby, graphicsCard: note } : model.lobby,
    panel: model.panel?.id === 'crew_join' ? { ...model.panel, graphicsCard: note } : model.panel,
  };
}
