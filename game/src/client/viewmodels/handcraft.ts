/**
 * The crafting panel (key C) lists hand crafts only (Luc, Round 4: "The craft menu with c should only show you what
 * you can craft without the benchs/tools").
 *
 * - A recipe that needs a station is not in C's list. It lives in its station's menu: the boat's menu (key B) for a
 *   station built on the canoe, and a menu of its own for a station of the camp the player stands in (the campfire,
 *   the stump bench, Tink's hearth and forge).
 * - A camp station's menu opens from its card in the row across the top of C, and from the interact key at the
 *   station itself where the rules give a prompt there. C always opens on the hands.
 * - A hand recipe that needs a tool is listed once the crew owns the tool, and hidden before. It has no other menu.
 * - So that hiding never strands anyone, C keeps one line for whatever an open quest needs and this list does not
 *   show, and one line that says where the canoe's stations are.
 */
import { ATTACHMENTS, CAMP_LAYOUTS, ITEMS, RECIPES, RECIPE_IDS, STATIONS } from '../../data/index.ts';
import type { AttachmentId, StationId } from '../../data/index.ts';
import { canoeStations, playerOf, selectInventory } from '../../sim/index.ts';
import type { GameState, PlayerId, RecipeAvailability } from '../../sim/index.ts';
import type { KeyBindings } from '../../settings/index.ts';
import type { InterfaceIntent } from '../intents.ts';
import { itemName, primaryKey } from './format.ts';
import { buildCraftElsewhere, stationAbout } from './stations.ts';
import type { BoatWants, CraftElsewhereModel } from './stations.ts';

/** The menu the crafting panel shows: the hands, or a station of the camp the player stands in. */
export type CraftTabId = StationId;

/** What a card stands for, as it is drawn in the camp: a camp's fire is a campfire, and Tink's is the hearth of her forge. */
export type CraftDoorKind = Exclude<StationId, 'fire'> | 'campfire' | 'hearth';

/** One card of the row across the top of the crafting panel. */
export interface CraftDoorModel {
  tab: CraftTabId;
  kind: CraftDoorKind;
  /** "Hands", "Campfire", "Stump bench". */
  label: string;
  /** What the menu is for, in a few words: the card's tooltip. */
  about: string;
  selected: boolean;
  /** "For Stop the leak" when an open quest asks for something this menu makes. Drawn as the red !. */
  questText: string;
  intent: InterfaceIntent;
}

/** What each is called on its card and on its menu. */
const DOOR_NAME: Record<CraftDoorKind, string> = {
  hands: 'Hands', campfire: 'Campfire', hearth: 'Hearth', bench: 'Stump bench', smoker: 'Smoker', forge: 'Forge',
};

const lower = (text: string): string => text.toLowerCase();
const capital = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** "a", "a and b", "a, b and c". */
const listOf = (names: string[]): string =>
  (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** "Pitch is", "Saw and hammer are": a list, capitalised, with the verb that fits its count. */
const subject = (names: string[], one: string, many: string): string => `${capital(listOf(names))} ${names.length === 1 ? one : many}`;

/** The crafting attachments built on the canoe that the player can use right now. */
const boatStationsInReach = (state: GameState, playerId: PlayerId): { attachmentId: AttachmentId; station: StationId }[] =>
  canoeStations(state, playerOf(state, playerId)).filter((entry) => entry.inReach);

/**
 * The stations of the camp the player stands in, in the camp's own order. Empty away from a camp. Asked of the
 * rules themselves: what they put in reach with nothing built on the canoe is the hands and the camp.
 */
export function campStationsHere(state: GameState, playerId: PlayerId = 0): StationId[] {
  const bare: GameState = { ...state, canoe: { ...state.canoe, attachments: [] } };
  return selectInventory(bare, playerId).stations.filter((stationId) => stationId !== 'hands');
}

/** The menu the crafting panel shows for a tab: the tab itself while its camp station is here, the hands otherwise. */
export function craftTabShown(state: GameState, playerId: PlayerId, tab: CraftTabId | undefined): CraftTabId {
  return tab && tab !== 'hands' && campStationsHere(state, playerId).includes(tab) ? tab : 'hands';
}

/** What a menu's card shows in the camp the player stands in. Only Tink's yard has a hearth for its fire. */
export function craftDoorKind(state: GameState, playerId: PlayerId, tab: CraftTabId): CraftDoorKind {
  if (tab !== 'fire') return tab;
  const islandId = playerOf(state, playerId).islandId;
  const campfire = islandId !== null && CAMP_LAYOUTS[islandId]?.landmarks.some((landmark) => landmark.kind === 'campfire');
  return campfire ? 'campfire' : 'hearth';
}

/** "Campfire", "Stump bench": the name of a menu in the camp the player stands in. */
export const craftTabName = (state: GameState, playerId: PlayerId, tab: CraftTabId): string => DOOR_NAME[craftDoorKind(state, playerId, tab)];

/**
 * The hand recipes C lists: every one whose tools the crew owns. One that only lacks materials stays, and so does
 * one a survivor has not taught yet (it lacks a word, not a tool).
 */
export function handRecipesShown(availability: readonly RecipeAvailability[]): RecipeAvailability[] {
  return availability.filter((entry) => RECIPES[entry.recipeId].station === 'hands' && entry.missing.tools.length === 0);
}

/** What the open quests want made at one station, by name, among the recipes the crew knows, and the first quest's words. */
function wantedAt(state: GameState, stationId: StationId, wants: BoatWants): { names: string[]; questText: string } {
  const names: string[] = [];
  let questText = '';
  for (const recipeId of RECIPE_IDS) {
    const recipe = RECIPES[recipeId];
    if (recipe.station !== stationId || (recipe.requiresFlag && !state.flags[recipe.requiresFlag])) continue;
    const wanted = wants.items.get(recipe.output.itemId);
    if (!wanted) continue;
    if (!questText) questText = wanted;
    const name = lower(ITEMS[recipe.output.itemId].name);
    if (!names.includes(name)) names.push(name);
  }
  return { names, questText };
}

/**
 * The row of cards: the hands first, then each station of the camp the player stands in. Away from a camp there is
 * no row at all: C is the list of hand crafts and nothing else.
 */
export function buildCraftDoors(state: GameState, playerId: PlayerId, shown: CraftTabId, wants: BoatWants): CraftDoorModel[] {
  const stations = campStationsHere(state, playerId);
  if (stations.length === 0) return [];
  const door = (tab: CraftTabId, questText: string): CraftDoorModel => {
    const kind = craftDoorKind(state, playerId, tab);
    return { tab, kind, label: DOOR_NAME[kind], about: stationAbout(tab), selected: tab === shown, questText, intent: { type: 'select_craft_tab', tab } };
  };
  return [door('hands', ''), ...stations.map((stationId) => door(stationId, wantedAt(state, stationId, wants).questText))];
}

/**
 * The lines under the hand crafts, for what an open quest needs and this list does not show:
 * - a hand recipe hidden for want of a tool: "Hatchet needs a stone knife first.";
 * - a station on the canoe, in reach: "Pitch is made at the firebox: the boat's menu (B).";
 * - a station that is not here: "Pitch needs a fire: any camp, or a firebox built on the canoe." (`stations.ts`).
 * A camp station that is here has its card in the row, with the red ! on it, and no line.
 */
export function buildCraftNotes(
  state: GameState, playerId: PlayerId, availability: readonly RecipeAvailability[], order: readonly StationId[],
  wants: BoatWants, bindings: KeyBindings,
): CraftElsewhereModel[] {
  const lines: CraftElsewhereModel[] = [];
  // Hand recipes hidden for a tool: a sentence a tool, all on the hands' one line.
  const byTool = new Map<string, string[]>();
  let toolQuestText = '';
  for (const entry of availability) {
    const recipe = RECIPES[entry.recipeId];
    const wanted = wants.items.get(recipe.output.itemId);
    if (recipe.station !== 'hands' || entry.missing.tools.length === 0 || !wanted) continue;
    if (!toolQuestText) toolQuestText = wanted;
    const tools = listOf(entry.missing.tools.map((toolId) => `a ${lower(itemName(toolId))}`));
    byTool.set(tools, [...(byTool.get(tools) ?? []), lower(ITEMS[recipe.output.itemId].name)]);
  }
  if (byTool.size > 0) {
    lines.push({
      stationId: 'hands',
      text: [...byTool].map(([tools, names]) => `${subject(names, 'needs', 'need')} ${tools} first.`).join(' '),
      questText: toolQuestText,
    });
  }
  const atCamp = campStationsHere(state, playerId);
  const aboard = boatStationsInReach(state, playerId);
  const elsewhere = buildCraftElsewhere(state, selectInventory(state, playerId).stations, order, wants);
  for (const stationId of order) {
    if (stationId === 'hands' || atCamp.includes(stationId)) continue;
    const part = aboard.find((entry) => entry.station === stationId);
    if (!part) {
      lines.push(...elsewhere.filter((entry) => entry.stationId === stationId));
      continue;
    }
    const { names, questText } = wantedAt(state, stationId, wants);
    if (names.length === 0) continue;
    lines.push({
      stationId,
      text: `${subject(names, 'is', 'are')} made at the ${lower(ATTACHMENTS[part.attachmentId].name)}: the boat's menu (${primaryKey(bindings, 'canoeBuilder')}).`,
      questText,
    });
  }
  return lines;
}

/** "a fire, a bench, a smoker or a forge": every kind of station there is. */
const everyStation = (order: readonly StationId[]): string => {
  const names = order.filter((stationId) => stationId !== 'hands').map((stationId) => `a ${lower(STATIONS[stationId].name)}`);
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
};

/**
 * The quiet line under the hand crafts: where the rest is made. `shown` is how many hand recipes the list holds.
 * - With a station on the canoe in reach: "The firebox and the workbench have their own menus on the boat (B)."
 * - With nothing to make by hand it always speaks, and starts "Nothing to make by hand yet."
 * - Otherwise it is empty: a camp's stations have their cards in the row, and the list speaks for itself.
 */
export function craftRestText(
  state: GameState, playerId: PlayerId, shown: number, order: readonly StationId[], bindings: KeyBindings,
): string {
  const ownMenu = (names: string[]): string => subject(names, 'has its own menu', 'have their own menus');
  const camp = campStationsHere(state, playerId).map((stationId) => `the ${lower(craftTabName(state, playerId, stationId))}`);
  const aboard = boatStationsInReach(state, playerId).map((entry) => `the ${lower(ATTACHMENTS[entry.attachmentId].name)}`);
  const parts: string[] = [];
  if (shown === 0) parts.push('Nothing to make by hand yet.');
  if (shown === 0 && camp.length > 0) parts.push(`${ownMenu(camp)}, above.`);
  if (aboard.length > 0) parts.push(`${ownMenu(aboard)} on the boat (${primaryKey(bindings, 'canoeBuilder')}).`);
  if (shown === 0 && camp.length === 0 && aboard.length === 0) {
    parts.push(`The rest is made at ${everyStation(order)}: at a camp, or built on the canoe.`);
  }
  return parts.join(' ');
}

/**
 * Where the interact key at a station leads: the camp station's own menu in the crafting panel, or the menu of the
 * part that carries that station on the canoe. Null when no such station is in reach.
 */
export function stationDoor(
  state: GameState, playerId: PlayerId, stationId: StationId,
): { panel: 'crafting'; tab: CraftTabId } | { panel: 'canoe_builder'; tab: AttachmentId } | null {
  if (campStationsHere(state, playerId).includes(stationId)) return { panel: 'crafting', tab: stationId };
  const part = boatStationsInReach(state, playerId).find((entry) => entry.station === stationId);
  return part ? { panel: 'canoe_builder', tab: part.attachmentId } : null;
}
