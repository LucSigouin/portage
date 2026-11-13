/** Wording shared by every view model: names, key labels, "needs 3 more plank". */
import { ATTACHMENTS, HULL_TIERS, ITEMS, STATIONS, TUNING } from '../../data/index.ts';
import type { FlagId, ItemId } from '../../data/index.ts';
import type { KeyBindings, InputAction } from '../../settings/index.ts';
import type { FailureReason, Missing } from '../../sim/index.ts';
import type { RefusalReason } from '../panels.ts';

export const itemName = (itemId: ItemId): string => ITEMS[itemId].name;

/** "3 x Plank". */
export const countedName = (itemId: ItemId, count: number): string => `${count} x ${itemName(itemId)}`;

export const FLAG_SOURCES: Record<FlagId, string> = {
  wren_taught_sailcloth: 'Wren to teach you',
  wren_gave_cloth: 'a word with Wren',
  tink_gave_wrench: 'a word with Tink',
  odile_gave_welcome: 'a word with Odile',
  beacon_lit: 'the Beacon lit',
};

/** Each thing still missing, as a short phrase: "3 more plank", "hammer", "the bench". */
export function missingParts(missing: Missing | null): string[] {
  if (!missing) return [];
  const parts: string[] = [];
  for (const { itemId, count } of missing.items) parts.push(`${count} more ${itemName(itemId).toLowerCase()}`);
  for (const toolId of missing.tools) parts.push(itemName(toolId).toLowerCase());
  if (missing.station) parts.push(missing.station === 'hands' ? 'free hands' : `the ${STATIONS[missing.station].name.toLowerCase()}`);
  if (missing.hullTier !== null) parts.push(`the ${HULL_TIERS[missing.hullTier].name.toLowerCase()}`);
  for (const attachmentId of missing.attachments) parts.push(`the ${ATTACHMENTS[attachmentId].name.toLowerCase()}`);
  if (missing.flag) parts.push(FLAG_SOURCES[missing.flag]);
  return parts;
}

/** "Needs 3 more plank, hammer", or an empty string when nothing is missing. */
export function needsText(missing: Missing | null): string {
  const parts = missingParts(missing);
  return parts.length > 0 ? `Needs ${parts.join(', ')}` : '';
}

/** An hour of the day as the clock shows it: 7 is "07:00", 6.5 is "06:30". */
export function hourText(hour: number): string {
  const minutes = Math.round(hour * 60);
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** The hour a bed takes anyone from, as the clock shows it. Read from the rules' own table, never typed in. */
export const SLEEP_FROM_TEXT = hourText(TUNING.time.sleepFromHour);

const FAILURE_TEXT: Record<FailureReason, string> = {
  unknown_id: 'That is not a thing.',
  recipe_locked: 'You have not learned that yet.',
  missing_requirements: 'Something is missing.',
  inventory_full: 'No room.',
  hull_at_maximum: 'The hull is as good as it gets.',
  already_built: 'Already built.',
  canoe_not_beached: 'Beach the canoe first.',
  not_at_canoe: 'Go to the canoe first.',
  not_aboard: 'You need to be aboard.',
  already_aboard: 'You are already aboard.',
  no_shore_in_reach: 'No shore in reach.',
  item_not_held: 'You do not have that.',
  not_edible: 'You cannot eat that.',
  not_drinkable: 'You cannot drink that.',
  no_water_in_reach: 'No water in reach.',
  no_bed_in_reach: 'Nowhere to sleep here.',
  not_tired: `Not tired yet. Sleep after ${SLEEP_FROM_TEXT}, or when worn out.`,
  npc_out_of_reach: 'Nobody close enough to talk to.',
  no_dialogue_open: 'Nobody is talking.',
  invalid_option: 'That is not an option.',
  in_dialogue: 'Finish the conversation first.',
  quest_not_available: 'That quest is not on offer.',
  quest_not_ready: 'Not finished yet.',
  too_tired: 'Too tired for that. Rest first.',
  nothing_in_reach: 'Nothing to do here.',
  tool_not_owned: 'You do not have that tool.',
  nothing_to_claim: 'Nothing waiting.',
  player_away: 'That player is away.',
  invalid_amount: 'That is not an amount.',
};

/** Why a command failed, as one sentence. Names what is missing when the engine says. */
export function failureText(reason: FailureReason, missing: Missing | null): string {
  return (reason === 'missing_requirements' || reason === 'recipe_locked') && missing
    ? `${needsText(missing)}.`
    : FAILURE_TEXT[reason];
}

const REFUSAL_TEXT: Record<RefusalReason, string> = {
  not_available_here: 'Not available here.',
  menu_open: 'Close the menu first.',
  in_dialogue: 'Finish the conversation first.',
  canoe_not_beached: 'Beach the canoe to work on it.',
};

export const refusalText = (reason: RefusalReason): string => REFUSAL_TEXT[reason];

const KEY_NAMES: Record<string, string> = {
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt', AltRight: 'Right Alt', MetaLeft: 'Left Cmd', MetaRight: 'Right Cmd',
  Escape: 'Esc', Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', CapsLock: 'Caps Lock',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: '\'', Comma: ',', Period: '.', Slash: '/',
};

/** A `KeyboardEvent.code` as a person would say it: "KeyW" is "W". */
export function keyLabel(keyCode: string): string {
  if (KEY_NAMES[keyCode]) return KEY_NAMES[keyCode];
  if (keyCode.startsWith('Key')) return keyCode.slice(3);
  if (keyCode.startsWith('Digit')) return keyCode.slice(5);
  if (keyCode.startsWith('Numpad')) return `Num ${keyCode.slice(6)}`;
  return keyCode;
}

/** The keys bound to an action: "W / Up", or "unbound". */
export function actionKeys(bindings: KeyBindings, action: InputAction): string {
  const keys = bindings[action].map(keyLabel);
  return keys.length > 0 ? keys.join(' / ') : 'unbound';
}

/** The first key bound to an action, for prompts. */
export const primaryKey = (bindings: KeyBindings, action: InputAction): string =>
  (bindings[action].length > 0 ? keyLabel(bindings[action][0]) : 'unbound');

/** "1 h 12 min", "4 min", "under a minute". */
export function durationText(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return 'under a minute';
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

/** "420 m" or "1.2 km". */
export function distanceText(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres / 10) * 10} m`;
}

const CARDINALS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** Radians to whole degrees, 0 to 359. */
export function bearingDegrees(bearing: number): number {
  const degrees = Math.round((bearing * 180) / Math.PI) % 360;
  return degrees < 0 ? degrees + 360 : degrees;
}

/** A bearing in radians as a compass point. `points` is 8 or 16. */
export function cardinalName(bearing: number, points: 8 | 16 = 16): string {
  const step = 16 / points;
  const index = Math.round(bearingDegrees(bearing) / (360 / points)) % points;
  return CARDINALS[index * step];
}

export const capitalise = (text: string): string => (text.length > 0 ? text[0].toUpperCase() + text.slice(1) : text);
