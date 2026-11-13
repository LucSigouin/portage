/**
 * The boat's menu (key B) and the stations (Luc's list, Round 3).
 *
 * B opens one panel with a row of icons across its top: the canoe builder, then one for each crafting attachment
 * built on the canoe (the firebox, the workbench, the smoker, the forge). An icon shows that station's own menu:
 * its recipes and nothing else. The menus work wherever the canoe is, afloat too, for anyone aboard or beside it.
 *
 * A crafting list never shows a recipe whose station is out of reach. So that hiding never strands anyone, the
 * crafting panel (key C) keeps one line for each missing station an open quest needs: what the quest wants made
 * there, and where such a station is.
 */
import { ATTACHMENTS, ATTACHMENT_IDS, ISLANDS, ITEMS, RECIPES, RECIPE_IDS, STATIONS } from '../../data/index.ts';
import type { AttachmentId, ItemId, StationId } from '../../data/index.ts';
import { canoeStations, playerOf, selectBuildOptions } from '../../sim/index.ts';
import type { GameState, PlayerId } from '../../sim/index.ts';
import type { InterfaceIntent } from '../intents.ts';
import type { BoatTabId } from '../panels.ts';
import type { RecipeRowModel } from './types.ts';

/** One icon of the row across the top of the boat's menu. */
export interface BoatTabModel {
  tab: BoatTabId;
  /** "Canoe builder", "Firebox", "Workbench". */
  label: string;
  /** What the menu is for, in a few words: the icon's tooltip. */
  about: string;
  selected: boolean;
  /** False for a station out of reach: built, but the player is on foot away from the canoe. */
  enabled: boolean;
  /** Why it cannot be opened ("At the canoe"), or an empty string. */
  note: string;
  /** "For Stop the leak" when an open quest asks for something this menu makes or builds. Drawn as the red !. */
  questText: string;
  intent: InterfaceIntent;
}

/** The menu of one station built on the canoe. */
export interface BoatStationModel {
  attachmentId: AttachmentId;
  /** "Firebox". */
  name: string;
  /** "Fire: cooks, boils and renders." */
  about: string;
  /** Why nothing can be made here right now, or an empty string. Then `recipes` is empty. */
  blockedText: string;
  /** The recipes this station makes. Every one of them can be made here: only materials may be short. */
  recipes: RecipeRowModel[];
}

/** A line of the crafting panel about a station that is not here, and that an open quest needs. */
export interface CraftElsewhereModel {
  stationId: StationId;
  /** "Pitch and clean water need a fire: any camp, or a firebox built on the canoe." */
  text: string;
  /** "For Stop the leak": the red ! before the line. */
  questText: string;
}

/**
 * The menu the boat's panel opens on. On the water the canoe cannot be built on, so it opens on the first station
 * aboard. Beached, or with no station to use, it opens on the canoe builder. Read once, when the panel opens
 * (`panels.ts`): after that only a click changes the menu.
 */
export function boatOpensOn(state: GameState, playerId: PlayerId = 0): BoatTabId {
  if (state.canoe.beached) return 'builder';
  return canoeStations(state, playerOf(state, playerId)).find((entry) => entry.inReach)?.attachmentId ?? 'builder';
}

const STATION_ABOUT: Record<StationId, string> = {
  hands: 'Hands: anything made sitting on a rock',
  fire: 'Fire: cooks, boils and renders',
  bench: 'Bench: sawing and sewing',
  smoker: 'Smoker: food that keeps',
  forge: 'Forge: scrap into parts',
};

const lower = (text: string): string => text.toLowerCase();

/** "a", "a and b", "a, b and c". */
const listOf = (names: string[]): string =>
  (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** What the open quests ask for, by what it is: `questWants` in gamepanels.ts. Passed in, so this file needs no quest rule. */
export interface BoatWants {
  items: ReadonlyMap<ItemId, string>;
  attachments: ReadonlyMap<AttachmentId, string>;
  hullTiers: ReadonlyMap<number, string>;
}

/** The first quest that wants something a station makes, among the recipes the crew knows. */
function stationQuestText(state: GameState, stationId: StationId, wants: BoatWants): string {
  for (const recipeId of RECIPE_IDS) {
    const recipe = RECIPES[recipeId];
    if (recipe.station !== stationId || (recipe.requiresFlag && !state.flags[recipe.requiresFlag])) continue;
    const text = wants.items.get(recipe.output.itemId);
    if (text) return text;
  }
  return '';
}

/** The first quest that wants a hull or a part not yet built. */
function builderQuestText(state: GameState, playerId: PlayerId, wants: BoatWants): string {
  const options = selectBuildOptions(state, playerId);
  const hull = options.hull ? wants.hullTiers.get(options.hull.tier) : undefined;
  if (hull) return hull;
  for (const entry of options.attachments) {
    const text = entry.built ? undefined : wants.attachments.get(entry.attachmentId);
    if (text) return text;
  }
  return '';
}

/**
 * The row of icons: the canoe builder first, then every crafting attachment that is built, in the builder's order.
 * One not yet built has no icon. A built one out of reach keeps its icon, so the row is always the same picture of
 * the boat, and cannot be opened.
 */
export function buildBoatTabs(state: GameState, playerId: PlayerId, selected: BoatTabId, wants: BoatWants): BoatTabModel[] {
  const tab = (id: BoatTabId, label: string, about: string, enabled: boolean, note: string, questText: string): BoatTabModel => ({
    tab: id, label, about, selected: id === selected, enabled, note, questText, intent: { type: 'select_boat_tab', tab: id },
  });
  return [
    tab('builder', 'Canoe builder', 'Build on the canoe', true, '', builderQuestText(state, playerId, wants)),
    ...canoeStations(state, playerOf(state, playerId)).map((entry) => tab(
      entry.attachmentId, ATTACHMENTS[entry.attachmentId].name, STATION_ABOUT[entry.station], entry.inReach,
      entry.inReach ? '' : 'At the canoe', entry.inReach ? stationQuestText(state, entry.station, wants) : '',
    )),
  ];
}

/** The line under the icons while the canoe carries no station: what would put one there. Empty once it carries one. */
export function boatStationsHint(state: GameState, playerId: PlayerId): string {
  if (canoeStations(state, playerOf(state, playerId)).length > 0) return '';
  const names = ATTACHMENT_IDS.filter((attachmentId) => ATTACHMENTS[attachmentId].station !== null)
    .map((attachmentId) => lower(ATTACHMENTS[attachmentId].name));
  return `No station aboard yet. Build a ${names.slice(0, -1).join(', a ')} or a ${names[names.length - 1]}, and it gets its own menu here, to use on the water.`;
}

/** The station a boat tab stands for, when it is one that is built. */
export function boatStationOf(state: GameState, playerId: PlayerId, tab: BoatTabId): { attachmentId: AttachmentId; station: StationId; inReach: boolean } | null {
  return canoeStations(state, playerOf(state, playerId)).find((entry) => entry.attachmentId === tab) ?? null;
}

/** "Fire: cooks, boils and renders". */
export const stationAbout = (stationId: StationId): string => STATION_ABOUT[stationId];

/**
 * Where a kind of station is: the camps that have one, and the part that carries it aboard.
 * "any camp, or a firebox built on the canoe"; "the camp on Home Knoll, or the workbench on the canoe".
 */
export function stationPlaces(state: GameState, stationId: StationId): string {
  const camps = ISLANDS.filter((island) => island.camp?.stations.includes(stationId)).map((island) => island.name);
  const everyCamp = camps.length === ISLANDS.filter((island) => island.camp).length;
  const places: string[] = [];
  if (camps.length > 0) places.push(everyCamp ? 'any camp' : `the camp on ${listOf(camps)}`);
  for (const attachmentId of ATTACHMENT_IDS) {
    if (ATTACHMENTS[attachmentId].station !== stationId) continue;
    const name = lower(ATTACHMENTS[attachmentId].name);
    places.push(state.canoe.attachments.includes(attachmentId) ? `the ${name} on the canoe` : `a ${name} built on the canoe`);
  }
  return places.join(', or ');
}

/** The most names one line carries before it says "and more". */
const ELSEWHERE_NAMES = 4;

/**
 * One line for each station that is out of reach and that an open quest needs: what the quest wants made there, and
 * where such a station is. The recipes themselves are not listed (Luc: "dont show the items that need workbench,
 * fire forge"). `inReach` is what the player can use now; `order` is the order the stations are listed in.
 */
export function buildCraftElsewhere(
  state: GameState, inReach: readonly StationId[], order: readonly StationId[], wants: BoatWants,
): CraftElsewhereModel[] {
  const lines: CraftElsewhereModel[] = [];
  for (const stationId of order) {
    if (inReach.includes(stationId)) continue;
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
    if (names.length === 0) continue;
    const shown = names.length > ELSEWHERE_NAMES ? [...names.slice(0, ELSEWHERE_NAMES - 1), 'more'] : names;
    const made = listOf(shown);
    const article = /^[aeiou]/.test(lower(STATIONS[stationId].name)) ? 'an' : 'a';
    lines.push({
      stationId,
      text: `${made.charAt(0).toUpperCase()}${made.slice(1)} ${names.length === 1 ? 'needs' : 'need'} ${article} ${lower(STATIONS[stationId].name)}: ${stationPlaces(state, stationId)}.`,
      questText,
    });
  }
  return lines;
}
