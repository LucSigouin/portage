/** The in-game panels: inventory, crafting, canoe builder, quest log, map and dialogue. */
import {
  ATTACHMENTS, HULL_TIERS, ISLANDS, ITEMS, NPCS, QUESTS, RECIPE_IDS, RECIPES, REGIONS, STATIONS, STOCK_FOOD_IDS,
  VALLEY_NORTH_SHORE_Z, VALLEY_SOUTH_SHORE_Z, isStackable,
} from '../../data/index.ts';
import type { AttachmentId, ItemAmount, ItemId, StationId } from '../../data/index.ts';
import {
  MAXIMUM_TRACKED, selectActiveQuests, selectBuildOptions, selectCanoeStats, selectCraftableRecipes, selectDialogue,
  selectInventory, selectMap, selectQuestLog, valleyHalfWidth,
} from '../../sim/index.ts';
import { pingColour, standingPings } from '../../sim/index.ts';
import type { Command, GameState, InventoryView, ItemStack, Missing, PlayerId, QuestView, RecipeAvailability } from '../../sim/index.ts';
import type { InterfaceIntent } from '../intents.ts';
import type { BoatTabId } from '../panels.ts';
import { boatStationOf, boatStationsHint, buildBoatTabs, buildCraftElsewhere, stationAbout } from './stations.ts';
import { DEFAULT_KEY_BINDINGS } from '../../settings/index.ts';
import type { KeyBindings } from '../../settings/index.ts';
import { FLAG_SOURCES, capitalise, cardinalName, countedName, distanceText, itemName, needsText, primaryKey } from './format.ts';
import { crewElsewhere, crewName, crewTag, objectiveRows } from './hud.ts';
import { CHART, lakeSeenShare, seenCells, valleyChart } from './chart.ts';
import type {
  BuildRowModel, ButtonModel, CostRowModel, MapIslandModel, MapMarkerModel, MapMarkModel, NeedChipModel, PanelModel,
  QuestRowModel, RecipeRowModel,
} from './types.ts';

type PanelBody<Id extends PanelModel['id']> = Omit<Extract<PanelModel, { id: Id }>, 'title' | 'close'>;

const command = (value: Command): InterfaceIntent => ({ type: 'command', command: value });

const button = (label: string, intent: InterfaceIntent, enabled = true, note: string | null = null): ButtonModel => ({
  label, intent, enabled, note,
});

/** How many of an item the player can use right now: backpack, plus cargo when it is in reach. */
function countInReach(inventory: InventoryView, state: GameState, itemId: ItemId): number {
  if (ITEMS[itemId].category === 'tool') return inventory.tools.includes(itemId as never) ? 1 : 0;
  if (!isStackable(itemId)) return state.keyItems[itemId] ?? 0;
  const count = (stacks: ItemStack[]): number =>
    stacks.filter((stack) => stack.itemId === itemId).reduce((sum, stack) => sum + stack.count, 0);
  return count(inventory.backpack) + (inventory.cargoAccessible ? count(inventory.cargo) : 0);
}

function costRows(costs: readonly ItemAmount[], inventory: InventoryView, state: GameState): CostRowModel[] {
  return costs.map(({ itemId, count }) => {
    const have = countInReach(inventory, state, itemId);
    return { itemId, name: itemName(itemId), have, need: count, enough: have >= count };
  });
}

/**
 * What is missing that no item chip shows, as chips: the hull, another part, a survivor's word, and the station when
 * `withStation` (the crafting panel leaves it out: the station's own heading says it is not in reach).
 */
export function needChips(missing: Missing | null, withStation: boolean): NeedChipModel[] {
  if (!missing) return [];
  const chips: NeedChipModel[] = [];
  if (withStation && missing.station) chips.push({ kind: 'station', name: STATIONS[missing.station].name });
  if (missing.hullTier !== null) chips.push({ kind: 'hull', name: HULL_TIERS[missing.hullTier].name });
  for (const attachmentId of missing.attachments) chips.push({ kind: 'attachment', name: ATTACHMENTS[attachmentId].name });
  if (missing.flag) chips.push({ kind: 'person', name: capitalise(FLAG_SOURCES[missing.flag]) });
  return chips;
}

/** What the crew's open quests still ask to be made, built or fitted, each with "For <quest name>". */
export interface QuestWants {
  items: Map<ItemId, string>;
  attachments: Map<AttachmentId, string>;
  hullTiers: Map<number, string>;
}

/**
 * What the open quests still ask for, for the red ! in the crafting panel and the canoe builder (Luc's bugfix list,
 * line 19). Only quests the crew has been given and not finished ("active"), and only their steps not yet done. A quest
 * not yet open, one ready to hand in, one done, and a step already done ask for nothing. Quests are the crew's
 * (`state.quests` is shared): every crewmate sees the same marks.
 */
export function questWants(state: GameState): QuestWants {
  const wants: QuestWants = { items: new Map(), attachments: new Map(), hullTiers: new Map() };
  const want = <Key>(into: Map<Key, string>, key: Key, text: string): void => {
    if (!into.has(key)) into.set(key, text);
  };
  for (const quest of selectActiveQuests(state)) {
    if (quest.status !== 'active') continue;
    const text = `For ${quest.name}`;
    QUESTS[quest.questId].objectives.forEach((objective, index) => {
      if (quest.objectives[index]?.done) return;
      switch (objective.type) {
        case 'have_item':
        case 'deliver':
          want(wants.items, objective.itemId, text);
          break;
        case 'have_tool':
          want(wants.items, objective.toolId as ItemId, text);
          break;
        case 'craft':
          for (const itemId of objective.itemIds) want(wants.items, itemId, text);
          break;
        case 'stock':
          for (const itemId of [...STOCK_FOOD_IDS, 'clean_water' as ItemId]) want(wants.items, itemId, text);
          break;
        case 'smoke':
          for (const recipeId of RECIPE_IDS) if (RECIPES[recipeId].station === 'smoker') want(wants.items, RECIPES[recipeId].output.itemId, text);
          break;
        case 'hull':
          want(wants.hullTiers, objective.tier, text);
          break;
        case 'attachment':
          want(wants.attachments, objective.attachmentId, text);
          break;
        default:
      }
    });
  }
  return wants;
}

// --- Inventory -----------------------------------------------------------------

// The inventory panel has its own module.
export { buildInventoryPanel } from './inventory.ts';

// --- Crafting ------------------------------------------------------------------

const STATION_ORDER: readonly StationId[] = ['hands', 'fire', 'bench', 'smoker', 'forge'];

/**
 * Where dirty water comes from, for a recipe that is short of it. It grows nowhere and no node gives it: it is
 * scooped with the bailing can, standing at the water or aboard, and the button for that is in the inventory.
 * (A button on the recipe's own row would be refused at a camp fire: the fire is inland, and scooping needs the water.)
 */
const scoopText = (bindings: KeyBindings): string => `Scoop it at the water, from the inventory (${primaryKey(bindings, 'inventory')}).`;

/** One recipe's row, for the crafting panel and for a station's menu on the boat. */
function recipeRow(
  entry: RecipeAvailability, inventory: InventoryView, state: GameState, wants: QuestWants, bindings: KeyBindings,
): RecipeRowModel {
  const recipe = RECIPES[entry.recipeId];
  const missingText = entry.known ? needsText(entry.missing) : 'A survivor teaches this';
  return {
    recipeId: recipe.id,
    itemId: entry.known ? recipe.output.itemId : null,
    name: entry.known ? recipe.name : 'Unknown recipe',
    description: entry.known ? recipe.description : '',
    outputText: entry.known ? countedName(recipe.output.itemId, recipe.output.count) : '',
    known: entry.known,
    inputs: entry.known ? [
      ...costRows(recipe.inputs, inventory, state),
      ...recipe.tools.map((toolId) => ({
        itemId: toolId, name: `${itemName(toolId)} (tool)`, have: inventory.tools.includes(toolId) ? 1 : 0, need: 1,
        enough: inventory.tools.includes(toolId),
      })),
    ] : [],
    missingText,
    needs: entry.known ? needChips(entry.missing, false) : [],
    questText: entry.known ? wants.items.get(recipe.output.itemId) ?? '' : '',
    sourceText: entry.known && entry.missing.items.some((item) => item.itemId === 'dirty_water') ? scoopText(bindings) : '',
    craft: button('Make', command({ type: 'craft', recipeId: recipe.id, count: 1 }), entry.craftable, missingText || null),
    craftAll: entry.maximumCount > 1
      ? button(`Make ${entry.maximumCount}`, command({ type: 'craft', recipeId: recipe.id, count: entry.maximumCount }))
      : null,
  };
}

/**
 * The crafting panel lists what can be made here and nothing else (Luc's list, Round 3: "dont show the items that
 * need workbench, fire forge"). A station out of reach has no section and its recipes no rows. A recipe that only
 * lacks materials stays. What an open quest needs from a station that is not here gets one line (`elsewhere`).
 * `bindings` are the keys as they are bound now, for the words that name one.
 */
export function buildCraftingPanel(state: GameState, playerId: PlayerId = 0, bindings: KeyBindings = DEFAULT_KEY_BINDINGS): PanelBody<'crafting'> {
  const inventory = selectInventory(state, playerId);
  const availability = selectCraftableRecipes(state, playerId);
  const wants = questWants(state);
  return {
    id: 'crafting',
    stations: STATION_ORDER.filter((stationId) => inventory.stations.includes(stationId)).map((stationId) => ({
      name: STATIONS[stationId].name,
      recipes: availability
        .filter((entry) => RECIPES[entry.recipeId].station === stationId)
        .map((entry) => recipeRow(entry, inventory, state, wants, bindings)),
    })),
    elsewhere: buildCraftElsewhere(state, inventory.stations, STATION_ORDER, wants),
  };
}

// --- Canoe builder ---------------------------------------------------------------

const BUILD_BLOCKED_TEXT = {
  canoe_not_beached: 'Beach the canoe to work on it.',
  not_at_canoe: 'Walk to the canoe to work on it.',
} as const;

function buildRow(
  id: BuildRowModel['id'],
  name: string,
  description: string,
  costs: readonly ItemAmount[],
  built: boolean,
  buildable: boolean,
  missing: Missing,
  intent: InterfaceIntent,
  blockedText: string,
  state: GameState,
  inventory: InventoryView,
  questText: string,
): BuildRowModel {
  const missingText = built ? '' : needsText(missing);
  return {
    id, name, description, built,
    costs: built ? [] : costRows(costs, inventory, state),
    missingText,
    needs: built ? [] : needChips(missing, true),
    questText: built ? '' : questText,
    build: built ? null : button('Build', intent, buildable, missingText || blockedText || null),
  };
}

/** The menu of the station a boat tab stands for: its recipes and nothing else. Null for the canoe builder's own tab. */
function boatStation(
  state: GameState, playerId: PlayerId, tab: BoatTabId, inventory: InventoryView, wants: QuestWants, bindings: KeyBindings,
): PanelBody<'canoe_builder'>['station'] {
  const entry = boatStationOf(state, playerId, tab);
  if (!entry) return null;
  const name = ATTACHMENTS[entry.attachmentId].name;
  return {
    attachmentId: entry.attachmentId,
    name,
    about: stationAbout(entry.station),
    // The canoe left, or the player walked off, with this menu open: it says so and lists nothing it cannot make.
    blockedText: entry.inReach ? '' : `Walk to the canoe to use the ${name.toLowerCase()}.`,
    recipes: entry.inReach
      ? selectCraftableRecipes(state, playerId).filter((recipe) => RECIPES[recipe.recipeId].station === entry.station)
        .map((recipe) => recipeRow(recipe, inventory, state, wants, bindings))
      : [],
  };
}

/**
 * The boat's panel (key B). `tab` is the menu it shows: the canoe builder, or a station built on the canoe (then
 * `station` carries that station's recipes, and the panel takes the station's name). A tab that is no station built
 * on this canoe shows the canoe builder.
 */
export function buildCanoeBuilderPanel(
  state: GameState, playerId: PlayerId = 0, tab: BoatTabId = 'builder', bindings: KeyBindings = DEFAULT_KEY_BINDINGS,
): PanelBody<'canoe_builder'> & { title?: string } {
  const options = selectBuildOptions(state, playerId);
  const inventory = selectInventory(state, playerId);
  const stats = selectCanoeStats(state);
  const blockedText = options.blockedReason ? BUILD_BLOCKED_TEXT[options.blockedReason] : '';
  const nextHull = options.hull ? HULL_TIERS[options.hull.tier] : null;
  const wants = questWants(state);
  const station = boatStation(state, playerId, tab, inventory, wants, bindings);
  return {
    id: 'canoe_builder',
    ...(station ? { title: station.name } : {}),
    tabs: buildBoatTabs(state, playerId, station ? station.attachmentId : 'builder', wants),
    station,
    stationsHint: boatStationsHint(state, playerId),
    blockedText,
    statLines: [
      `${stats.hullName} (hull ${stats.hullTier} of ${HULL_TIERS.length - 1})`,
      `Stability ${stats.stability}: safe in roughness ${stats.stability} or less`,
      `Cargo ${stats.cargoUsed} / ${stats.cargoSlots} stacks`,
      `Paddle ${stats.paddleSpeed.toFixed(1)} m/s, power stroke ${stats.powerStrokeSpeed.toFixed(1)} m/s${stats.hasSail ? `, sail up to ${stats.sailMaximumSpeed} m/s` : ''}`,
      stats.leakPerSecond > 0 ? 'Leaks while afloat' : 'Hull is tight',
      stats.canCrossFog ? 'Fitted for the Fog' : 'Cannot cross the Fog yet',
    ],
    hull: options.hull && nextHull
      ? buildRow('hull', `Hull: ${nextHull.name}`, nextHull.description,
        [...nextHull.cost, ...nextHull.tools.map((toolId) => ({ itemId: toolId as ItemId, count: 1 }))],
        false, options.hull.buildable, options.hull.missing, command({ type: 'upgrade_hull' }), blockedText, state, inventory,
        wants.hullTiers.get(options.hull.tier) ?? '')
      : null,
    attachments: options.attachments.map((entry) => {
      const definition = ATTACHMENTS[entry.attachmentId];
      return buildRow(entry.attachmentId, definition.name, definition.description,
        [...definition.cost, ...definition.tools.map((toolId) => ({ itemId: toolId as ItemId, count: 1 }))],
        entry.built, entry.buildable, entry.missing,
        command({ type: 'build_attachment', attachmentId: entry.attachmentId }), blockedText, state, inventory,
        wants.attachments.get(entry.attachmentId) ?? '');
    }),
  };
}

// --- Quest log -------------------------------------------------------------------

const STATUS_TEXT: Record<QuestView['status'], string> = {
  locked: 'Locked', available: 'On offer', active: 'Active', ready: 'Ready to hand in', completed: 'Done',
};

/** The note on a Track button the card has no room for. */
export const TRACKING_FULL_NOTE = `${MAXIMUM_TRACKED} on the card`;

function questRow(quest: QuestView, cardFull: boolean): QuestRowModel {
  const giver = quest.giver ? NPCS[quest.giver].name : null;
  const trackable = quest.status === 'active' || quest.status === 'ready';
  return {
    questId: quest.questId,
    name: quest.name,
    description: quest.description,
    kind: quest.kind,
    statusText: STATUS_TEXT[quest.status],
    done: quest.status === 'completed',
    tracked: quest.tracked,
    giverText: giver ? (quest.status === 'available' ? `Ask ${giver}` : `For ${giver}`) : '',
    objectives: objectiveRows(quest),
    // What is still to come. A finished quest has paid out, so its row lists nothing.
    rewards: quest.status === 'completed' ? []
      : QUESTS[quest.questId].rewards.items.map(({ itemId, count }) => ({ itemId, name: itemName(itemId), count })),
    // On the card: a press takes it off. Off it: a press puts it on, while the card has room.
    track: !trackable ? null
      : quest.tracked ? button('Untrack', command({ type: 'track_quest', questId: quest.questId, tracked: false }))
      : button('Track', command({ type: 'track_quest', questId: quest.questId }), !cardFull, cardFull ? TRACKING_FULL_NOTE : null),
  };
}

/** The quest log of one player: the quests are the crew's, the Track buttons this player's own. */
export function buildQuestLogPanel(state: GameState, playerId: PlayerId = 0): PanelBody<'quest_log'> {
  const log = selectQuestLog(state, playerId);
  const cardFull = log.filter((quest) => quest.tracked && (quest.status === 'active' || quest.status === 'ready')).length >= MAXIMUM_TRACKED;
  const rows = log.map((quest) => questRow(quest, cardFull));
  const open = (row: QuestRowModel): boolean => !row.done;
  return {
    id: 'quest_log',
    groups: [
      { heading: 'Main line', quests: rows.filter((row) => row.kind === 'main' && open(row)) },
      { heading: 'Side quests', quests: rows.filter((row) => row.kind === 'side' && open(row)) },
      { heading: 'Done', quests: rows.filter((row) => row.done) },
    ].filter((group) => group.quests.length > 0),
  };
}

// --- Map -------------------------------------------------------------------------

/** The chart's square in world metres, north up: the round chart (`CHART`) is drawn inside it, touching its sides. */
export const MAP_BOUNDS = {
  minimumX: CHART.centerX - CHART.radius, maximumX: CHART.centerX + CHART.radius,
  minimumZ: CHART.centerZ - CHART.radius, maximumZ: CHART.centerZ + CHART.radius,
} as const;

const mapLeft = (x: number): number => (x - MAP_BOUNDS.minimumX) / (MAP_BOUNDS.maximumX - MAP_BOUNDS.minimumX);
const mapTop = (z: number): number => (z - MAP_BOUNDS.minimumZ) / (MAP_BOUNDS.maximumZ - MAP_BOUNDS.minimumZ);

/** True once anyone in the crew has seen a cell of the lake between these two edges (north, south). */
function waterSeen(cells: Uint8Array, northZ: number, southZ: number): boolean {
  const { fog, lakeCells } = valleyChart();
  for (let row = 0; row < fog.rows; row += 1) {
    const z = fog.minimumZ + (row + 0.5) * fog.cellMetres;
    if (z < northZ || z >= southZ) continue;
    for (let column = 0; column < fog.columns; column += 1) {
      const cell = row * fog.columns + column;
      if (lakeCells[cell] && cells[cell]) return true;
    }
  }
  return false;
}

/**
 * The map of one player: the round chart with the crew's fog over it (drawn by the interface from the
 * `chart` beside the model), the names of the islands found, the waters, and the marks: the player, the canoe,
 * the camp, the survivors, the open quests' places, the crewmates.
 */
export function buildMapPanel(state: GameState, playerId: PlayerId = 0): PanelBody<'map'> {
  const map = selectMap(state, playerId);
  const width = MAP_BOUNDS.maximumX - MAP_BOUNDS.minimumX;
  const height = MAP_BOUNDS.maximumZ - MAP_BOUNDS.minimumZ;
  const cells = seenCells(map.seen);
  const islands: MapIslandModel[] = map.islands.filter((island) => island.discovered).map((island) => ({
    islandId: island.islandId,
    name: island.name,
    left: mapLeft(island.position.x),
    top: mapTop(island.position.z),
    width: (Math.max(island.radiusX, island.radiusZ) * 2) / width,
    height: (Math.max(island.radiusX, island.radiusZ) * 2) / height,
    rotationDegrees: Math.round((island.rotation * 180) / Math.PI),
    bearingText: island.bearing !== null && island.distance !== null
      ? `${cardinalName(island.bearing)}, ${distanceText(island.distance)}`
      : '',
  }));
  const markers: MapMarkerModel[] = map.markers.map((marker) => ({
    kind: marker.kind, label: marker.label, left: mapLeft(marker.position.x), top: mapTop(marker.position.z),
  }));
  // Crewmates who are somewhere else, each at their own place and in their own colour.
  for (const { player } of crewElsewhere(state, playerId)) {
    markers.push({
      kind: 'crew', left: mapLeft(player.position.x), top: mapTop(player.position.z),
      ...crewTag(player), crewIndex: state.players.indexOf(player),
    });
  }
  return {
    id: 'map',
    fullChart: map.fullChart,
    summary: map.fullChart
      ? 'Full chart from the map table, with bearings'
      : `${islands.length} of ${ISLANDS.length} islands charted, ${Math.floor(lakeSeenShare(cells) * 100)}% of the lake seen`,
    regions: REGIONS.map((region) => {
      // The band, inside the lake: the valley ends at its north and south shores.
      const northZ = Math.max(region.northEdgeZ, VALLEY_NORTH_SHORE_Z);
      const southZ = Math.min(region.southEdgeZ, VALLEY_SOUTH_SHORE_Z);
      // The name is written in the west margin, a third of the way down the band: on the valley's side where it
      // is wide, clear of the islands, and inside the round chart where it narrows.
      const labelZ = northZ + (southZ - northZ) / 3;
      const rimX = CHART.centerX - Math.sqrt(Math.max(0, CHART.radius ** 2 - (labelZ - CHART.centerZ) ** 2)) + 50;
      const labelX = Math.max(rimX, Math.min(-valleyHalfWidth(labelZ) - 150, CHART.centerX - 1380));
      return {
        name: region.name,
        top: mapTop(northZ),
        height: (southZ - northZ) / height,
        roughness: region.roughness,
        labelLeft: mapLeft(labelX),
        labelTop: mapTop(labelZ),
        seen: map.fullChart || waterSeen(cells, northZ, southZ),
      };
    }),
    islands,
    markers,
    marks: mapMarks(state, playerId),
    markHint: MAP_MARK_HINT,
  };
}

/** The line on the map panel that says the chart takes clicks (the master review, finding 4). */
export const MAP_MARK_HINT = 'Click the map to mark a spot for the crew. Click a mark to take it down.';

/** The marks standing, in player order, each named for the one who reads the map: "Your mark", "Sam's mark". */
export function mapMarks(state: GameState, playerId: PlayerId = 0): MapMarkModel[] {
  return standingPings(state).map((ping) => ({
    playerId: ping.playerId,
    label: ping.playerId === playerId ? 'Your mark' : `${crewName(state, ping.playerId)}'s mark`,
    color: pingColour(ping.playerId),
  }));
}

// --- Dialogue --------------------------------------------------------------------

export function buildDialoguePanel(state: GameState, playerId: PlayerId = 0): PanelBody<'dialogue'> | null {
  const dialogue = selectDialogue(state, playerId);
  if (!dialogue) return null;
  return {
    id: 'dialogue',
    speaker: dialogue.name,
    text: dialogue.text,
    options: dialogue.options.map((option) =>
      button(option.text, command({ type: 'choose_dialogue_option', optionIndex: option.index }))),
  };
}
