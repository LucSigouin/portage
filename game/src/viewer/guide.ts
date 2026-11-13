/**
 * The guide: for every item, where to find it and what it is used for; for every scavenge spot, what it gives and
 * where it is; for every canoe piece, what it costs and what it does. All of it is read from the game's own tables
 * (`src/data/`) when the viewer starts, so a change to a table changes the guide with it. Nothing here is written
 * per item.
 *
 * Three facts live in the game's code rather than its tables: the gear a new game starts with, the water the
 * bailing can scoops from the lake, and what the rain catcher, fishing rig and planter add by themselves. They are
 * named once below, and `tests/viewer/guide.test.ts` holds each one against the running simulation.
 */
import {
  ATTACHMENTS, ATTACHMENT_IDS, HULL_TIERS, ISLANDS, ISLANDS_BY_ID, ITEMS, LOOT_TABLES, NODES, NODE_TYPES,
  NPCS, NPC_IDS, QUEST_LIST, RECIPES, RECIPE_IDS, REGIONS_BY_ID, STATIONS, STOCK_FOOD_IDS, TUNING,
} from '../data/index.ts';
import type {
  AttachmentDefinition, AttachmentId, FlagId, HullTierDefinition, IslandId, ItemAmount, ItemId, NodeActionDefinition,
  NodeDefinition, NodeTypeId, ObjectiveDefinition, QuestDefinition, RecipeDefinition, StationId, ToolId,
} from '../data/index.ts';

// --- The three facts from the game's code -------------------------------------------------------------------------------

/** What a new game puts on the tool belt (`createGame` in `src/sim/step.ts`). */
export const STARTING_GEAR: readonly ItemId[] = ['bailing_can'];
/** What the bailing can scoops from the lake anywhere (`fill_water` in `src/sim/commands.ts`). */
export const LAKE_WATER: { tool: ToolId; itemId: ItemId } = { tool: 'bailing_can', itemId: 'dirty_water' };
/** Attachments that add to the cargo by themselves (`updatePassiveAttachments` in `src/sim/survival.ts`). */
export const ABOARD: readonly { attachmentId: AttachmentId; itemId: ItemId; count: number; when: string }[] = [
  { attachmentId: 'rain_catcher', itemId: 'clean_water', count: 1, when: `every ${TUNING.canoe.rainCatcherSecondsPerWater} s of rain` },
  { attachmentId: 'fishing_rig', itemId: 'raw_fish', count: 1, when: `every ${TUNING.canoe.fishingRigSecondsPerFish} s while beached or asleep` },
  { attachmentId: 'planter', itemId: 'berries', count: TUNING.canoe.planterBerries, when: 'each dawn' },
  { attachmentId: 'planter', itemId: 'cattail_root', count: TUNING.canoe.planterRoots, when: 'each dawn' },
];

// --- What a guide is ----------------------------------------------------------------------------------------------------

/** A thing of the game a line names, so a test can prove it is real. */
export type GuideRef =
  | { kind: 'node'; id: NodeTypeId }
  | { kind: 'placed'; id: string }
  | { kind: 'island'; id: IslandId }
  | { kind: 'recipe'; id: string }
  | { kind: 'hull'; id: string }
  | { kind: 'attachment'; id: AttachmentId }
  | { kind: 'quest'; id: string }
  | { kind: 'npc'; id: string }
  | { kind: 'item'; id: ItemId }
  | { kind: 'station'; id: StationId }
  | { kind: 'start' }
  | { kind: 'lake' };

/** One line of the guide: a short lead in bold, then the rest. */
export interface GuideLine {
  lead: string;
  text: string;
  refs: GuideRef[];
  /** False when this way gives the item once only (a cache, a gift, a reward). */
  again: boolean;
}

export interface GuideSection {
  title: string;
  lines: GuideLine[];
  /** Said when there are no lines. */
  empty?: string;
}

export interface ItemGuide {
  itemId: ItemId;
  where: GuideLine[];
  usedFor: GuideLine[];
  /** True when every way to get it gives it once only. */
  onceOnly: boolean;
}

// --- Words ----------------------------------------------------------------------------------------------------------------

const itemName = (itemId: ItemId): string => ITEMS[itemId].name;
const lower = (text: string): string => text.replace(/^./, (letter) => letter.toLowerCase());
const range = (minimum: number, maximum: number): string => (minimum === maximum ? String(minimum) : `${minimum} to ${maximum}`);
const listOf = (words: string[]): string => (words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);
const amounts = (list: ItemAmount[], joiner = ', '): string => list.map((entry) => `${entry.count} ${lower(itemName(entry.itemId))}`).join(joiner);
const toolWords = (tools: ToolId[]): string => listOf(tools.map((tool) => `the ${lower(itemName(tool))}`));
const unique = <T>(list: T[]): T[] => [...new Set(list)];

/** Game seconds as a wait a player reads: "48 min", "1 h 36 min". */
export function waitWords(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** How long a used spot takes to come back, read from its action and the game's day. Null: never. */
export function refillSeconds(action: NodeActionDefinition): number | null {
  return action.respawnDays === null ? null : action.respawnDays * TUNING.time.daySeconds;
}

const refillWords = (action: NodeActionDefinition): string => {
  const seconds = refillSeconds(action);
  return seconds === null ? 'Once only.' : `Refills in ${waitWords(seconds)}.`;
};

/** "Home Knoll and Birch Islet (Shallows); Steeple Rock (Reach)". Islands in table order, grouped by region. */
function islandWords(islandIds: IslandId[]): string {
  const wanted = new Set(islandIds);
  const byRegion = new Map<string, string[]>();
  for (const island of ISLANDS) {
    if (!wanted.has(island.id)) continue;
    const region = REGIONS_BY_ID[island.regionId].name.replace(/^The /, '');
    byRegion.set(region, [...(byRegion.get(region) ?? []), island.name]);
  }
  return [...byRegion].map(([region, names]) => `${listOf(names)} (${region})`).join('; ');
}

/** Where a station stands: camps on islands, and the attachment that carries it aboard. */
export function stationWords(stationId: StationId): string {
  if (stationId === 'hands') return 'by hand, anywhere';
  const camps = ISLANDS.filter((island) => island.camp?.stations.includes(stationId)).map((island) => island.id);
  const aboard = ATTACHMENT_IDS.filter((attachmentId) => ATTACHMENTS[attachmentId].station === stationId).map((attachmentId) => ATTACHMENTS[attachmentId].name);
  const places = [...(camps.length > 0 ? [`camps on ${islandWords(camps)}`] : []), ...aboard.map((name) => `the ${lower(name)} aboard`)];
  return `at a ${lower(STATIONS[stationId].name)}: ${places.length > 0 ? places.join('; or ') : 'none built yet'}`;
}

/** The survivor whose words set a flag (Wren teaches sailcloth). */
function teacherOf(flag: FlagId): string | null {
  for (const npcId of NPC_IDS) {
    for (const node of Object.values(NPCS[npcId].nodes)) {
      if (node.options.some((option) => option.effects?.some((effect) => effect.type === 'set_flag' && effect.flag === flag))) return NPCS[npcId].name;
    }
  }
  return null;
}

const questWords = (quest: QuestDefinition): string =>
  quest.kind === 'main' ? `main quest ${quest.order}` : quest.giver ? `${NPCS[quest.giver].name}’s side quest` : 'a side quest';

// --- Scavenge spots, grouped ------------------------------------------------------------------------------------------------

/**
 * Every placed spot's every action, grouped where the game would say the same thing twice: the same kind of spot, the
 * same name, the same action, tool and loot. A spot that never refills stays on its own (it is one place).
 */
export interface SpotGroup {
  typeId: NodeTypeId;
  /** The names the spots go by, the plain kind first when one is plain. */
  names: string[];
  action: NodeActionDefinition;
  nodes: NodeDefinition[];
}

let spotGroups: SpotGroup[] | null = null;
export function spots(): SpotGroup[] {
  if (spotGroups) return spotGroups;
  const groups = new Map<string, SpotGroup>();
  for (const node of NODES) {
    node.actions.forEach((action, index) => {
      const key = action.respawnDays === null
        ? `${node.id}|${index}`
        : [node.typeId, index, action.tool, action.attachment, action.questGate, action.lootTableId, action.respawnDays].join('|');
      const group = groups.get(key);
      if (group) {
        group.nodes.push(node);
        if (!group.names.includes(node.name)) group.names.push(node.name);
      } else groups.set(key, { typeId: node.typeId, names: [node.name], action, nodes: [node] });
    });
  }
  spotGroups = [...groups.values()];
  for (const group of spotGroups) {
    const plain = NODE_TYPES[group.typeId].name;
    if (group.names.includes(plain)) group.names = [plain, ...group.names.filter((name) => name !== plain)];
  }
  return spotGroups;
}

/** What one action needs, in words: "with the hatchet", "from the canoe, with the winch". */
function needsWords(group: SpotGroup): string {
  const { action } = group;
  const parts: string[] = [];
  if (NODE_TYPES[group.typeId].reach === 'canoe') parts.push('from the canoe');
  if (action.tool) parts.push(`with ${toolWords([action.tool])}`);
  if (action.attachment) parts.push(`with the ${lower(ATTACHMENTS[action.attachment].name)} fitted`);
  return parts.join(', ');
}

const gateWords = (group: SpotGroup): string => {
  const gate = group.action.questGate;
  if (!gate) return '';
  const quest = QUEST_LIST.find((candidate) => candidate.id === gate);
  return quest ? ` Only once the rest of ${quest.name} is done.` : '';
};

const spotName = (group: SpotGroup): string => listOf(group.names);

const placeWords = (group: SpotGroup): string => {
  const islands = unique(group.nodes.map((node) => node.islandId));
  const afloat = NODE_TYPES[group.typeId].reach === 'canoe';
  return `${afloat ? 'Off' : 'On'} ${islandWords(islands)}.`;
};

/** The items one action gives: "always 3 spruce log", "sometimes 1 to 2 cloth". */
function lootWords(lootTableId: string): string {
  const table = LOOT_TABLES[lootTableId];
  if (!table) return 'nothing';
  const always = table.guaranteed.map((entry) => `${range(entry.minimum, entry.maximum)} ${lower(itemName(entry.itemId))}`);
  const sometimes = table.pool.map((entry) => lower(itemName(entry.itemId)));
  const parts = [...(always.length > 0 ? [listOf(always)] : [])];
  if (sometimes.length > 0) parts.push(`${table.rolls === 1 ? 'one' : table.rolls} more from ${listOf(unique(sometimes))}`);
  return parts.length > 0 ? parts.join(', plus ') : 'nothing to carry';
}

// --- Items ------------------------------------------------------------------------------------------------------------------

/**
 * Where an item comes from, the steadiest way first: the start, the lake, making it, the canoe's own gear, spots
 * that always give it, spots that sometimes do, then what comes once (a cache, a gift, a quest's reward).
 */
function whereLines(itemId: ItemId): GuideLine[] {
  const lines: GuideLine[] = [];
  const always: GuideLine[] = [];
  const sometimes: GuideLine[] = [];
  const once: GuideLine[] = [];
  if (STARTING_GEAR.includes(itemId)) lines.push({ lead: 'Starting gear', text: 'You have it from the start.', refs: [{ kind: 'start' }], again: false });
  if (LAKE_WATER.itemId === itemId) {
    lines.push({ lead: 'Lake water', text: `Scoop it anywhere on the water with ${toolWords([LAKE_WATER.tool])}.`, refs: [{ kind: 'lake' }, { kind: 'item', id: LAKE_WATER.tool }], again: true });
  }

  for (const recipeId of RECIPE_IDS) {
    const recipe = RECIPES[recipeId];
    if (recipe.output.itemId !== itemId) continue;
    const teacher = recipe.requiresFlag ? teacherOf(recipe.requiresFlag) : null;
    const tools = recipe.tools.length > 0 ? ` Needs ${toolWords(recipe.tools)}.` : '';
    const taught = recipe.requiresFlag ? ` ${teacher ? `${teacher} teaches it first.` : 'Has to be learned first.'}` : '';
    lines.push({
      lead: `Make it${recipe.name === itemName(itemId) ? '' : `: ${recipe.name}`}`,
      text: `${amounts(recipe.inputs, ' + ')} make ${recipe.output.count}, ${stationWords(recipe.station)}.${tools}${taught}`,
      refs: [{ kind: 'recipe', id: recipe.id }, { kind: 'station', id: recipe.station }, ...recipe.inputs.map((entry): GuideRef => ({ kind: 'item', id: entry.itemId }))],
      again: true,
    });
  }

  for (const source of ABOARD) {
    if (source.itemId !== itemId) continue;
    lines.push({
      lead: ATTACHMENTS[source.attachmentId].name,
      text: `Fitted to the canoe, it adds ${source.count} to the cargo ${source.when}.`,
      refs: [{ kind: 'attachment', id: source.attachmentId }],
      again: true,
    });
  }

  for (const group of spots()) {
    const table = LOOT_TABLES[group.action.lootTableId];
    if (!table) continue;
    const sure = table.guaranteed.find((entry) => entry.itemId === itemId);
    const maybe = table.pool.find((entry) => entry.itemId === itemId);
    if (!sure && !maybe) continue;
    const gives = sure ? `Always ${range(sure.minimum, sure.maximum)}` : `Sometimes ${range(maybe!.minimum, maybe!.maximum)}`;
    const needs = needsWords(group);
    const refs: GuideRef[] = [
      { kind: 'node', id: group.typeId },
      ...group.nodes.map((node): GuideRef => ({ kind: 'placed', id: node.id })),
      ...unique(group.nodes.map((node) => node.islandId)).map((id): GuideRef => ({ kind: 'island', id })),
      ...(group.action.tool ? [{ kind: 'item', id: group.action.tool } as GuideRef] : []),
    ];
    const again = group.action.respawnDays !== null;
    (again ? (sure ? always : sometimes) : once).push({
      lead: spotName(group),
      text: `${group.action.verb}${needs ? ` ${needs}` : ''}. ${gives}. ${placeWords(group)} ${refillWords(group.action)}${gateWords(group)}`,
      refs,
      again,
    });
  }
  lines.push(...always, ...sometimes, ...once);

  for (const npcId of NPC_IDS) {
    const npc = NPCS[npcId];
    for (const node of Object.values(npc.nodes)) {
      for (const option of node.options) {
        const effects = option.effects ?? [];
        for (const effect of effects) {
          if (effect.type !== 'give_items') continue;
          const given = effect.items.find((entry) => entry.itemId === itemId);
          if (!given) continue;
          const once = effects.some((other) => other.type === 'set_flag');
          lines.push({
            lead: `${npc.name} gives it`,
            text: `${given.count}, when you talk to ${npc.name} on ${ISLANDS_BY_ID[npc.islandId].name}.${once ? ' Once only.' : ''}`,
            refs: [{ kind: 'npc', id: npcId }, { kind: 'island', id: npc.islandId }],
            again: !once,
          });
        }
      }
    }
  }

  for (const quest of QUEST_LIST) {
    const reward = quest.rewards.items.find((entry) => entry.itemId === itemId);
    if (!reward) continue;
    lines.push({
      lead: 'Quest reward',
      text: `${reward.count} for finishing ${quest.name} (${questWords(quest)}).`,
      refs: [{ kind: 'quest', id: quest.id }],
      again: false,
    });
  }
  return lines;
}

/** What a quest step asks of this item, or null. */
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

const buildLine = (lead: string, refs: GuideRef[], cost: ItemAmount[], tools: ToolId[], itemId: ItemId, what: string): GuideLine | null => {
  const taken = cost.find((entry) => entry.itemId === itemId);
  const tool = tools.includes(itemId as ToolId);
  if (!taken && !tool) return null;
  const parts = [...(taken ? [`takes ${taken.count}`] : []), ...(tool ? ['the tool for it'] : [])];
  return { lead, text: `${parts.join(', and is ')}, to build ${what}.`.replace(/^./, (letter) => letter.toUpperCase()), refs, again: true };
};

function usedForLines(itemId: ItemId): GuideLine[] {
  const lines: GuideLine[] = [];
  const item = ITEMS[itemId];
  if (item.edible) {
    const { hunger, thirst, energy } = item.edible;
    const effect = [['hunger', hunger], ['thirst', thirst], ['energy', energy]]
      .filter(([, value]) => value !== 0)
      .map(([name, value]) => `${name} ${Number(value) > 0 ? '+' : '−'}${Math.abs(Number(value))}`);
    lines.push({ lead: item.isDrink ? 'Drink it' : 'Eat it', text: `${effect.join(', ')}.`.replace(/^./, (letter) => letter.toUpperCase()), refs: [{ kind: 'item', id: itemId }], again: true });
  }
  if (LAKE_WATER.tool === itemId) {
    lines.push({ lead: 'Lake water', text: `Scoops ${lower(itemName(LAKE_WATER.itemId))} from the lake, anywhere.`, refs: [{ kind: 'lake' }, { kind: 'item', id: LAKE_WATER.itemId }], again: true });
  }
  for (const group of spots()) {
    if (group.action.tool !== itemId) continue;
    // one line per kind of spot and action, however many places and names it has
    const lead = NODE_TYPES[group.typeId].name;
    const text = `Lets you ${lower(group.action.verb)} it.`;
    const known = lines.find((line) => line.lead === lead && line.text === text);
    if (!known) lines.push({ lead, text, refs: [{ kind: 'node', id: group.typeId }], again: true });
  }
  for (const recipeId of RECIPE_IDS) {
    const recipe: RecipeDefinition = RECIPES[recipeId];
    const taken = recipe.inputs.find((entry) => entry.itemId === itemId);
    const tool = recipe.tools.includes(itemId as ToolId);
    if (!taken && !tool) continue;
    const parts = [...(taken ? [`takes ${taken.count}`] : []), ...(tool ? ['the tool for it'] : [])];
    lines.push({
      lead: recipe.name,
      text: `${parts.join(', and is ')}, ${stationWords(recipe.station).replace(/:.*/, '')}.`.replace(/^./, (letter) => letter.toUpperCase()),
      refs: [{ kind: 'recipe', id: recipe.id }, { kind: 'item', id: recipe.output.itemId }],
      again: true,
    });
  }
  for (const hull of HULL_TIERS) {
    const line = buildLine(hull.name, [{ kind: 'hull', id: hull.id }], hull.cost, hull.tools, itemId, `this hull (tier ${hull.tier})`);
    if (line) lines.push(line);
  }
  for (const attachmentId of ATTACHMENT_IDS) {
    const attachment = ATTACHMENTS[attachmentId];
    const line = buildLine(attachment.name, [{ kind: 'attachment', id: attachmentId }], attachment.cost, attachment.tools, itemId, 'it on the canoe');
    if (line) lines.push(line);
  }
  for (const quest of QUEST_LIST) {
    for (const objective of quest.objectives) {
      if (!asks(objective, itemId)) continue;
      lines.push({ lead: quest.name, text: `${objective.text} (${questWords(quest)}).`, refs: [{ kind: 'quest', id: quest.id }], again: false });
    }
  }
  return lines;
}

const itemGuides = new Map<ItemId, ItemGuide>();
export function itemGuide(itemId: ItemId): ItemGuide {
  const known = itemGuides.get(itemId);
  if (known) return known;
  const where = whereLines(itemId);
  const guide: ItemGuide = { itemId, where, usedFor: usedForLines(itemId), onceOnly: where.length > 0 && where.every((line) => !line.again) };
  itemGuides.set(itemId, guide);
  return guide;
}

/** Forget what was worked out, so the next call reads the tables again. For tests. */
export function resetGuide(): void {
  itemGuides.clear();
  spotGroups = null;
}

export function itemSections(itemId: ItemId): GuideSection[] {
  const guide = itemGuide(itemId);
  const kept = ['tool', 'unique', 'quest'].includes(ITEMS[itemId].category);
  const note: GuideLine = { lead: 'Found once only', text: kept ? 'It takes no slot and is never lost.' : 'Every way above gives it one time.', refs: [], again: false };
  const where = guide.onceOnly ? [...guide.where, note] : guide.where;
  return [
    { title: 'Where to find it', lines: where, empty: 'Nowhere in the tables yet.' },
    { title: 'Used for', lines: guide.usedFor, empty: 'Nothing yet: no recipe, build or quest asks for it.' },
  ];
}

// --- Scavenge spots -----------------------------------------------------------------------------------------------------

export function nodeSections(typeId: NodeTypeId): GuideSection[] {
  // Spots met once each (ten bottles) read as one line when they are named and filled alike.
  const merged = new Map<string, SpotGroup>();
  for (const group of spots().filter((candidate) => candidate.typeId === typeId)) {
    const { action } = group;
    const key = [spotName(group), action.verb, action.tool, action.attachment, action.questGate, action.lootTableId, action.respawnDays].join('|');
    const known = merged.get(key);
    if (known) known.nodes = [...known.nodes, ...group.nodes];
    else merged.set(key, { ...group, nodes: [...group.nodes] });
  }
  const gives = [...merged.values()].map((group): GuideLine => {
    const needs = needsWords(group);
    const each = group.action.respawnDays === null && group.nodes.length > 1 ? ' Each one once only.' : ` ${refillWords(group.action)}`;
    return {
      lead: spotName(group),
      text: `${group.action.verb}${needs ? ` ${needs}` : ''}. Gives ${lootWords(group.action.lootTableId)}. ${placeWords(group)}${each}${gateWords(group)}`,
      refs: [{ kind: 'node', id: typeId }, ...unique(group.nodes.map((node) => node.islandId)).map((id): GuideRef => ({ kind: 'island', id }))],
      again: group.action.respawnDays !== null,
    };
  });
  const placed = NODES.filter((node) => node.typeId === typeId);
  const ids = new Set(placed.map((node) => node.id));
  // the quest steps that count these spots: by name, every bottle, every hauled wreck (as `src/sim/quests.ts` counts them)
  const asked = askedBy((objective) => (objective.type === 'node' && ids.has(objective.nodeId))
    || (objective.type === 'bottles' && placed.some((node) => node.bottleId !== null))
    || (objective.type === 'caches' && typeId === 'wreck_buoy'));
  return [
    { title: placed.length === 1 ? 'The one spot' : `Gives, in ${placed.length} spots`, lines: gives, empty: 'Placed on no island yet.' },
    ...(asked.length > 0 ? [{ title: 'Quests that count it', lines: asked }] : []),
  ];
}

// --- Canoe pieces -------------------------------------------------------------------------------------------------------

function costLines(cost: ItemAmount[], tools: ToolId[]): GuideLine[] {
  const lines: GuideLine[] = [];
  if (cost.length > 0) lines.push({ lead: 'Takes', text: `${amounts(cost)}.`, refs: cost.map((entry): GuideRef => ({ kind: 'item', id: entry.itemId })), again: true });
  if (tools.length > 0) lines.push({ lead: 'Tools', text: `${toolWords(tools).replace(/^./, (letter) => letter.toUpperCase())}.`, refs: tools.map((tool): GuideRef => ({ kind: 'item', id: tool })), again: true });
  return lines;
}

function askedBy(test: (objective: ObjectiveDefinition) => boolean): GuideLine[] {
  return QUEST_LIST.flatMap((quest) => quest.objectives.filter(test).map((objective): GuideLine => ({
    lead: quest.name, text: `${objective.text} (${questWords(quest)}).`, refs: [{ kind: 'quest', id: quest.id }], again: false,
  })));
}

export function hullSections(hull: HullTierDefinition): GuideSection[] {
  const before = HULL_TIERS.find((candidate) => candidate.tier === hull.tier - 1);
  const does: GuideLine[] = [
    { lead: 'Cargo', text: `${hull.cargoSlots} slots.`, refs: [], again: true },
    { lead: 'Leaks', text: hull.leakPerSecond > 0 ? `${hull.leakPerSecond} water a second: keep bailing.` : 'Not at all.', refs: [], again: true },
    { lead: 'Speed', text: hull.speedMultiplier === 1 ? 'Normal paddling speed.' : `${hull.speedMultiplier} times paddling speed.`, refs: [], again: true },
    { lead: 'Mounts', text: hull.mountIds.length > 0 ? `${hull.mountIds.length} places to bolt attachments on.` : 'None: nothing bolts on.', refs: [], again: true },
  ];
  return [
    {
      title: 'Costs',
      lines: hull.tier === 0 ? [{ lead: 'Nothing', text: 'You start in it.', refs: [{ kind: 'start' }], again: false }]
        : [...(before ? [{ lead: 'From', text: `the ${lower(before.name)}.`, refs: [{ kind: 'hull', id: before.id } as GuideRef], again: true }] : []), ...costLines(hull.cost, hull.tools)],
    },
    { title: 'Does', lines: [...does, ...askedBy((objective) => objective.type === 'hull' && objective.tier === hull.tier)] },
  ];
}

export function attachmentSections(attachment: AttachmentDefinition): GuideSection[] {
  const needs: GuideLine[] = [];
  const hull = HULL_TIERS.find((candidate) => candidate.tier === attachment.minimumHullTier);
  if (hull && attachment.minimumHullTier > 0) needs.push({ lead: 'Hull', text: `The ${lower(hull.name)} or better.`, refs: [{ kind: 'hull', id: hull.id }], again: true });
  if (attachment.requiresAttachments.length > 0) {
    needs.push({
      lead: 'First',
      text: `${listOf(attachment.requiresAttachments.map((attachmentId) => `the ${lower(ATTACHMENTS[attachmentId].name)}`))}.`.replace(/^./, (letter) => letter.toUpperCase()),
      refs: attachment.requiresAttachments.map((attachmentId): GuideRef => ({ kind: 'attachment', id: attachmentId })),
      again: true,
    });
  }
  const does: GuideLine[] = [];
  if (attachment.cargoSlotsBonus > 0) does.push({ lead: 'Cargo', text: `${attachment.cargoSlotsBonus} more slots.`, refs: [], again: true });
  if (attachment.stabilityBonus > 0) does.push({ lead: 'Steadier', text: `Stability +${attachment.stabilityBonus}: rougher water before she swamps.`, refs: [], again: true });
  if (attachment.station) does.push({ lead: `A ${lower(STATIONS[attachment.station].name)} aboard`, text: STATIONS[attachment.station].description, refs: [{ kind: 'station', id: attachment.station }], again: true });
  for (const source of ABOARD.filter((candidate) => candidate.attachmentId === attachment.id)) {
    does.push({ lead: 'Adds', text: `${source.count} ${lower(itemName(source.itemId))} to the cargo ${source.when}.`, refs: [{ kind: 'item', id: source.itemId }], again: true });
  }
  for (const group of spots().filter((candidate) => candidate.action.attachment === attachment.id)) {
    if (does.some((line) => line.refs.some((ref) => ref.kind === 'node' && ref.id === group.typeId))) continue;
    does.push({ lead: 'Opens', text: `${NODE_TYPES[group.typeId].name}: ${lower(group.action.verb)}.`, refs: [{ kind: 'node', id: group.typeId }], again: true });
  }
  if (attachment.cosmetic) does.push({ lead: 'Looks', text: 'Only how the canoe looks.', refs: [], again: true });
  does.push(...askedBy((objective) => objective.type === 'attachment' && objective.attachmentId === attachment.id));
  return [
    { title: 'Costs', lines: [...costLines(attachment.cost, attachment.tools), ...needs] },
    { title: 'Does', lines: does, empty: 'What its line above says.' },
  ];
}
