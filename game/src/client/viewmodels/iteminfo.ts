/**
 * What the inventory's info panel says an item is for (Luc, round 4: "when you hover of a item it shows the details").
 *
 * Every line is read from the game's own tables (`src/data/`), so a change to a recipe or a build changes the
 * panel with it. Nothing here is written per item. The lines are short on purpose: the panel is a narrow column.
 *
 * - `itemInfo` is what never changes during a game: what kind of thing it is, the spots that give it, what eating
 *   it does, what a tool works on, what it is made from, and what it makes or builds. Worked out once per item and kept.
 * - `questLines` is what the crew's open quests ask of it right now.
 */
import {
  ATTACHMENTS, ATTACHMENT_IDS, HULL_TIERS, ITEMS, LOOT_TABLES, NODE_TYPES, QUEST_LIST, RECIPES, RECIPE_IDS, STATIONS, STOCK_FOOD_IDS, WILD_KINDS,
} from '../../data/index.ts';
import type { ItemAmount, ItemCategory, ItemId, ObjectiveDefinition, ToolId } from '../../data/index.ts';
import type { GameState } from '../../sim/index.ts';
import type { InfoLineModel, ItemInfoModel } from './types.ts';

/** The most names one line lists before it says how many more there are. */
export const INFO_NAMES_SHOWN = 4;

const KIND_WORDS: Record<ItemCategory, string> = {
  raw: 'Raw material', refined: 'Made by the crew', food: 'Food', stock: 'Stock food', tool: 'Tool', unique: 'Key item', quest: 'Quest item',
};

const unique = (names: string[]): string[] => [...new Set(names)];

/** "Plank, Paddle and 3 more". */
function listed(names: string[]): string {
  const all = unique(names);
  if (all.length <= INFO_NAMES_SHOWN) return all.join(', ');
  return `${all.slice(0, INFO_NAMES_SHOWN).join(', ')} and ${all.length - INFO_NAMES_SHOWN} more`;
}

const signed = (value: number): string => `${value > 0 ? '+' : '-'}${Math.abs(value)}`;

const amounts = (list: readonly ItemAmount[]): string => list.map((entry) => `${entry.count} x ${ITEMS[entry.itemId].name}`).join(', ');

const line = (lead: string, text: string): InfoLineModel => ({ lead, text });

function build(itemId: ItemId): ItemInfoModel {
  const item = ITEMS[itemId];
  const uses: InfoLineModel[] = [];
  const spots = [...Object.values(NODE_TYPES), ...Object.values(WILD_KINDS)];

  // Where it comes from: every kind of spot, tree and stone whose loot can hold it.
  const found: string[] = [];
  for (const kind of spots) {
    const gives = kind.actions.some((action) => {
      const loot = LOOT_TABLES[action.lootTableId];
      return loot !== undefined && [...loot.guaranteed, ...loot.pool].some((entry) => entry.itemId === itemId);
    });
    if (gives) found.push(kind.name);
  }
  if (found.length > 0) uses.push(line('Found at', listed(found)));

  if (item.edible) {
    const effect = ([['hunger', item.edible.hunger], ['thirst', item.edible.thirst], ['energy', item.edible.energy]] as const)
      .filter(([, value]) => value !== 0).map(([name, value]) => `${name} ${signed(value)}`).join(', ');
    uses.push(line(item.isDrink ? 'Drink it' : 'Eat it', effect.replace(/^./, (letter) => letter.toUpperCase())));
  }

  // A tool: what it works on, verb by verb ("Chop: Spruce, Pine").
  const worksOn = new Map<string, string[]>();
  for (const kind of spots) {
    for (const action of kind.actions) {
      if (action.tool === itemId) worksOn.set(action.verb, [...(worksOn.get(action.verb) ?? []), kind.name]);
    }
  }
  for (const [verb, names] of worksOn) uses.push(line(verb, listed(names)));

  const made = RECIPE_IDS.map((recipeId) => RECIPES[recipeId]).find((recipe) => recipe.output.itemId === itemId);
  if (made) {
    const where = made.station === 'hands' ? 'by hand' : `at the ${STATIONS[made.station].name.toLowerCase()}`;
    uses.push(line('Made from', `${amounts(made.inputs)}, ${where}`));
  }

  const makes: string[] = [];
  const toolFor: string[] = [];
  for (const recipeId of RECIPE_IDS) {
    const recipe = RECIPES[recipeId];
    if (recipe.inputs.some((entry) => entry.itemId === itemId)) makes.push(ITEMS[recipe.output.itemId].name);
    if (recipe.tools.includes(itemId as ToolId)) toolFor.push(ITEMS[recipe.output.itemId].name);
  }
  if (makes.length > 0) uses.push(line('Makes', listed(makes)));
  if (toolFor.length > 0) uses.push(line('Needed to make', listed(toolFor)));

  const builds: string[] = [];
  const toolToBuild: string[] = [];
  for (const piece of [...HULL_TIERS, ...ATTACHMENT_IDS.map((attachmentId) => ATTACHMENTS[attachmentId])]) {
    if (piece.cost.some((entry) => entry.itemId === itemId)) builds.push(piece.name);
    if (piece.tools.includes(itemId as ToolId)) toolToBuild.push(piece.name);
  }
  if (builds.length > 0) uses.push(line('Builds', listed(builds)));
  if (toolToBuild.length > 0) uses.push(line('Needed to build', listed(toolToBuild)));

  // Food that keeps says so (the crew stocks it for the long crossing). Anything else that is eaten or drunk is
  // food or drink, whatever its table calls it: boiled water is "made by the crew" and is a drink first.
  const eaten = item.category !== 'stock' && item.edible !== null;
  return { kind: eaten ? (item.isDrink ? 'Drink' : 'Food') : KIND_WORDS[item.category], uses };
}

const known = new Map<ItemId, ItemInfoModel>();

/** What an item is and what it is for, from the tables. The same object every time: it is never changed. */
export function itemInfo(itemId: ItemId): ItemInfoModel {
  let info = known.get(itemId);
  if (!info) {
    info = build(itemId);
    known.set(itemId, info);
  }
  return info;
}

/** True when a quest step asks for this item: to have it, hand it over, make it, or stock the canoe with it. */
function asks(objective: ObjectiveDefinition, itemId: ItemId): boolean {
  switch (objective.type) {
    case 'have_item':
    case 'deliver':
      return objective.itemId === itemId;
    case 'have_tool':
      return objective.toolId === itemId;
    case 'craft':
      return objective.itemIds.includes(itemId);
    case 'stock':
      return (objective.stockFood > 0 && STOCK_FOOD_IDS.includes(itemId)) || (objective.cleanWater > 0 && itemId === 'clean_water');
    default:
      return false;
  }
}

/** The crew's open quests (given and not handed in) that ask for an item, one line a step. */
export function questLines(state: GameState, itemId: ItemId): InfoLineModel[] {
  const lines: InfoLineModel[] = [];
  for (const quest of QUEST_LIST) {
    const status = state.quests[quest.id]?.status;
    if (status !== 'active' && status !== 'ready') continue;
    for (const objective of quest.objectives) {
      if (asks(objective, itemId)) lines.push(line('Quest', `${quest.name}. ${objective.text}`));
    }
  }
  return lines;
}
