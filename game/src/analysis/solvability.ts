/**
 * Solvability analysis: a graph search over the data tables, with no
 * simulation. It answers "can this ever be obtained, built or completed?" by
 * growing a set of capabilities until nothing new can be added.
 *
 * It takes the tables as an argument, so a test can hand it a broken copy and
 * prove the checks have teeth.
 */
import type {
  AttachmentDefinition, AttachmentId, FlagId, HullTierDefinition, IslandDefinition, IslandId, ItemAmount,
  ItemId, LootTable, NodeActionDefinition, NodeDefinition, NpcDefinition, ObjectiveDefinition,
  QuestDefinition, QuestId, RecipeDefinition, RecipeId, RegionDefinition, RegionId, StationId,
} from '../data/types.ts';
import {
  ATTACHMENTS, ATTACHMENT_IDS, HULL_TIERS, ISLANDS, ITEM_IDS, LOOT_TABLES, NODES, NPCS, NPC_IDS, QUEST_LIST,
  RECIPES, RECIPE_IDS, REGIONS, STOCK_FOOD_IDS, TUNING,
} from '../data/index.ts';
import { getIslandAccess } from '../bot/navigation.ts';
import type { IslandAccess } from '../bot/navigation.ts';

export interface GameData {
  itemIds: ItemId[];
  recipes: RecipeDefinition[];
  hullTiers: HullTierDefinition[];
  attachments: AttachmentDefinition[];
  regions: RegionDefinition[];
  islands: IslandDefinition[];
  nodes: NodeDefinition[];
  lootTables: Record<string, LootTable>;
  quests: QuestDefinition[];
  npcs: NpcDefinition[];
  /** Least seaworthy canoe that reaches each island, from the real geometry. */
  islandAccess: Record<IslandId, IslandAccess>;
  baseStability: number;
  startingItems: ItemId[];
  /** Scooped straight from the lake with the bailing can (`fill_water`). */
  lakeItems: ItemId[];
  stockFoodIds: ItemId[];
}

/** A deep copy of the live tables, safe to mutate in a test. */
export function loadGameData(): GameData {
  return structuredClone({
    itemIds: ITEM_IDS,
    recipes: RECIPE_IDS.map((recipeId) => RECIPES[recipeId]),
    hullTiers: HULL_TIERS,
    attachments: ATTACHMENT_IDS.map((attachmentId) => ATTACHMENTS[attachmentId]),
    regions: REGIONS,
    islands: ISLANDS,
    nodes: NODES,
    lootTables: LOOT_TABLES,
    quests: QUEST_LIST,
    npcs: NPC_IDS.map((npcId) => NPCS[npcId]),
    islandAccess: getIslandAccess(),
    baseStability: TUNING.canoe.baseStability,
    startingItems: ['bailing_can'] as ItemId[],
    lakeItems: ['dirty_water'] as ItemId[],
    stockFoodIds: STOCK_FOOD_IDS,
  });
}

export interface Reach {
  items: Set<ItemId>;
  recipes: Set<RecipeId>;
  attachments: Set<AttachmentId>;
  hullTier: number;
  islands: Set<IslandId>;
  stations: Set<StationId>;
  flags: Set<FlagId>;
  completedQuests: Set<QuestId>;
  stability: number;
  fogGear: boolean;
}

export interface ReachOptions {
  /** Only islands of these regions may be visited. */
  allowedRegions?: RegionId[];
  /** Main quests after this order cannot complete. */
  lastMainQuest?: number;
}

const has = (reach: Reach, cost: ItemAmount[]): boolean => cost.every((entry) => reach.items.has(entry.itemId));

function actionUsable(data: GameData, reach: Reach, node: NodeDefinition, action: NodeActionDefinition): boolean {
  if (action.tool && !reach.items.has(action.tool)) return false;
  if (action.attachment && !reach.attachments.has(action.attachment)) return false;
  if (action.questGate) {
    const quest = data.quests.find((candidate) => candidate.id === action.questGate)!;
    const earlierDone = data.quests.every((candidate) => candidate.kind !== 'main' || candidate.order >= quest.order
      || reach.completedQuests.has(candidate.id));
    const othersDone = quest.objectives.every((objective) =>
      (objective.type === 'node' && objective.nodeId === node.id) || objectiveSatisfiable(data, reach, objective));
    if (!earlierDone || !othersDone) return false;
  }
  return true;
}

function nodeUsable(data: GameData, reach: Reach, node: NodeDefinition): boolean {
  return reach.islands.has(node.islandId) && node.actions.some((action) => actionUsable(data, reach, node, action));
}

function regionEnterable(reach: Reach, region: RegionDefinition): boolean {
  return region.roughness <= reach.stability && (!region.fogWall || reach.fogGear);
}

/** True when an objective could be met with what `reach` holds. */
export function objectiveSatisfiable(data: GameData, reach: Reach, objective: ObjectiveDefinition): boolean {
  switch (objective.type) {
    case 'bail':
      return true;
    case 'land':
      return reach.islands.has(objective.islandId);
    case 'have_item':
    case 'deliver':
      return reach.items.has(objective.itemId);
    case 'have_tool':
      return reach.items.has(objective.toolId);
    case 'craft':
      return data.recipes.some((recipe) => objective.itemIds.includes(recipe.output.itemId) && reach.recipes.has(recipe.id));
    case 'hull':
      return reach.hullTier >= objective.tier;
    case 'attachment':
      return reach.attachments.has(objective.attachmentId);
    case 'sleep':
      return data.islands.some((island) => island.camp?.sleep && reach.islands.has(island.id));
    case 'enter_region':
      return regionEnterable(reach, data.regions.find((region) => region.id === objective.regionId)!);
    case 'talk':
      return reach.islands.has(data.npcs.find((npc) => npc.id === objective.npcId)!.islandId);
    case 'node': {
      const node = data.nodes.find((candidate) => candidate.id === objective.nodeId);
      return node !== undefined && nodeUsable(data, reach, node);
    }
    case 'stock':
      return reach.items.has('clean_water') && data.stockFoodIds.some((itemId) => reach.items.has(itemId));
    case 'bottles':
      return data.nodes.filter((node) => node.bottleId !== null && nodeUsable(data, reach, node)).length >= objective.count;
    case 'caches':
      return data.nodes.filter((node) => node.typeId === 'wreck_buoy' && nodeUsable(data, reach, node)).length >= objective.count;
    case 'smoke':
      return data.recipes.some((recipe) => recipe.station === 'smoker' && reach.recipes.has(recipe.id));
  }
}

/** Grow the set of everything obtainable until it stops growing. */
export function analyseReach(data: GameData, options: ReachOptions = {}): Reach {
  const reach: Reach = {
    items: new Set(data.startingItems),
    recipes: new Set(),
    attachments: new Set(),
    hullTier: 0,
    islands: new Set(),
    stations: new Set<StationId>(['hands']),
    flags: new Set(),
    completedQuests: new Set(),
    stability: data.baseStability,
    fogGear: false,
  };
  const mainQuests = data.quests.filter((quest) => quest.kind === 'main').sort((first, second) => first.order - second.order);

  for (let pass = 0; pass < 200; pass += 1) {
    const before = [
      reach.items.size, reach.recipes.size, reach.attachments.size, reach.hullTier, reach.islands.size,
      reach.stations.size, reach.flags.size, reach.completedQuests.size,
    ].join(',');

    reach.stability = data.baseStability
      + data.attachments.filter((attachment) => reach.attachments.has(attachment.id))
        .reduce((sum, attachment) => sum + attachment.stabilityBonus, 0);
    reach.fogGear = reach.attachments.has('lantern_mast') && reach.attachments.has('radio');

    for (const island of data.islands) {
      const access = data.islandAccess[island.id];
      if (!access || access.stability > reach.stability || (access.fogGear && !reach.fogGear)) continue;
      if (options.allowedRegions && !options.allowedRegions.includes(island.regionId)) continue;
      reach.islands.add(island.id);
      for (const station of island.camp?.stations ?? []) reach.stations.add(station);
    }
    for (const attachment of data.attachments) {
      if (attachment.station && reach.attachments.has(attachment.id)) reach.stations.add(attachment.station);
    }

    if (reach.items.has('bailing_can')) for (const itemId of data.lakeItems) reach.items.add(itemId);

    for (const node of data.nodes) {
      if (!reach.islands.has(node.islandId)) continue;
      for (const action of node.actions) {
        if (!actionUsable(data, reach, node, action)) continue;
        const table = data.lootTables[action.lootTableId];
        for (const entry of [...table.guaranteed, ...table.pool]) reach.items.add(entry.itemId);
      }
    }

    for (const recipe of data.recipes) {
      if (!reach.stations.has(recipe.station) || (recipe.requiresFlag && !reach.flags.has(recipe.requiresFlag))) continue;
      if (!recipe.tools.every((toolId) => reach.items.has(toolId)) || !has(reach, recipe.inputs)) continue;
      reach.recipes.add(recipe.id);
      reach.items.add(recipe.output.itemId);
    }

    for (let tier = reach.hullTier + 1; tier < data.hullTiers.length; tier += 1) {
      const hull = data.hullTiers[tier];
      if (!hull.tools.every((toolId) => reach.items.has(toolId)) || !has(reach, hull.cost)) break;
      reach.hullTier = tier;
    }

    for (const attachment of data.attachments) {
      if (attachment.minimumHullTier > reach.hullTier) continue;
      if (!attachment.requiresAttachments.every((required) => reach.attachments.has(required))) continue;
      if (!attachment.tools.every((toolId) => reach.items.has(toolId)) || !has(reach, attachment.cost)) continue;
      reach.attachments.add(attachment.id);
    }

    // Survivors: every dialogue effect on a reachable island, as far as the
    // conditions can ever hold. Quest hand-ins are handled with the quests below.
    for (const npc of data.npcs) {
      if (!reach.islands.has(npc.islandId)) continue;
      for (const dialogueNode of Object.values(npc.nodes)) {
        for (const option of dialogueNode.options) {
          if (option.condition?.flags?.some((flag) => !reach.flags.has(flag))) continue;
          for (const effect of option.effects ?? []) {
            if (effect.type === 'set_flag') reach.flags.add(effect.flag);
            if (effect.type === 'give_items') for (const item of effect.items) reach.items.add(item.itemId);
          }
        }
      }
    }

    const complete = (quest: QuestDefinition): void => {
      reach.completedQuests.add(quest.id);
      for (const item of quest.rewards.items) reach.items.add(item.itemId);
      for (const flag of quest.rewards.flags) reach.flags.add(flag);
    };
    for (const quest of mainQuests) {
      if (reach.completedQuests.has(quest.id)) continue;
      if (options.lastMainQuest !== undefined && quest.order > options.lastMainQuest) break;
      if (!quest.objectives.every((objective) => objectiveSatisfiable(data, reach, objective))) break;
      complete(quest);
    }
    for (const quest of data.quests) {
      if (quest.kind !== 'side' || reach.completedQuests.has(quest.id)) continue;
      if (!quest.requiresQuests.every((required) => reach.completedQuests.has(required))) continue;
      if (quest.giver && !reach.islands.has(data.npcs.find((npc) => npc.id === quest.giver)!.islandId)) continue;
      if (quest.objectives.every((objective) => objectiveSatisfiable(data, reach, objective))) complete(quest);
    }

    const after = [
      reach.items.size, reach.recipes.size, reach.attachments.size, reach.hullTier, reach.islands.size,
      reach.stations.size, reach.flags.size, reach.completedQuests.size,
    ].join(',');
    if (after === before) break;
  }
  return reach;
}

/**
 * Items that only come from one-off sources (unique caches, gifts, quest
 * rewards) and are used up by one-off builds: is there enough of each?
 */
function uniqueSupplyProblems(data: GameData): string[] {
  const problems: string[] = [];
  // Anything used as a tool is made once, so its recipe's inputs are a one-off demand.
  const toolIds = new Set<ItemId>([
    ...data.hullTiers.flatMap((hull) => hull.tools),
    ...data.attachments.flatMap((attachment) => attachment.tools),
    ...data.recipes.flatMap((recipe) => recipe.tools),
    ...data.nodes.flatMap((node) => node.actions.flatMap((action) => (action.tool ? [action.tool] : []))),
  ]);
  for (const itemId of data.itemIds) {
    let renewable = data.recipes.some((recipe) => recipe.output.itemId === itemId);
    let supply = 0;
    for (const node of data.nodes) {
      for (const action of node.actions) {
        const table = data.lootTables[action.lootTableId];
        const entry = table.guaranteed.find((candidate) => candidate.itemId === itemId);
        const inPool = table.pool.some((candidate) => candidate.itemId === itemId);
        if (!entry && !inPool) continue;
        if (action.respawnDays !== null) renewable = true;
        else supply += entry?.minimum ?? 0;
      }
    }
    if (renewable) continue;
    for (const npc of data.npcs) {
      for (const dialogueNode of Object.values(npc.nodes)) {
        for (const option of dialogueNode.options) {
          for (const effect of option.effects ?? []) {
            if (effect.type === 'give_items') supply += effect.items.find((item) => item.itemId === itemId)?.count ?? 0;
          }
        }
      }
    }
    for (const quest of data.quests) supply += quest.rewards.items.find((item) => item.itemId === itemId)?.count ?? 0;
    let demand = 0;
    const count = (cost: ItemAmount[]): number => cost.reduce((sum, entry) => sum + (entry.itemId === itemId ? entry.count : 0), 0);
    for (const hull of data.hullTiers) demand += count(hull.cost);
    for (const attachment of data.attachments) demand += count(attachment.cost);
    for (const recipe of data.recipes) if (toolIds.has(recipe.output.itemId)) demand += count(recipe.inputs);
    if (supply < demand) problems.push(`only ${supply} ${itemId} exist in the valley but ${demand} are needed`);
  }
  return problems;
}

/** Every reason the game is not finishable. Empty means solvable. */
export function findSolvabilityProblems(data: GameData): string[] {
  const problems: string[] = [];
  const full = analyseReach(data);

  for (const itemId of data.itemIds) if (!full.items.has(itemId)) problems.push(`item ${itemId} cannot be obtained`);
  for (const recipe of data.recipes) if (!full.recipes.has(recipe.id)) problems.push(`recipe ${recipe.id} cannot be crafted`);
  for (const attachment of data.attachments) {
    if (!full.attachments.has(attachment.id)) problems.push(`attachment ${attachment.id} cannot be built`);
  }
  if (full.hullTier < data.hullTiers.length - 1) problems.push(`hull tier ${full.hullTier + 1} cannot be built`);
  for (const island of data.islands) if (!full.islands.has(island.id)) problems.push(`island ${island.id} cannot be reached`);
  for (const quest of data.quests) {
    if (!full.completedQuests.has(quest.id)) problems.push(`quest ${quest.id} cannot be completed`);
  }

  // Each main quest, in order, with only what is reachable by then.
  const mainQuests = data.quests.filter((quest) => quest.kind === 'main').sort((first, second) => first.order - second.order);
  for (const quest of mainQuests) {
    const byThen = analyseReach(data, { lastMainQuest: quest.order - 1 });
    const earlier = mainQuests.filter((candidate) => candidate.order < quest.order);
    if (!earlier.every((candidate) => byThen.completedQuests.has(candidate.id))) {
      problems.push(`main quest ${quest.order} (${quest.id}) is blocked: an earlier quest cannot be completed`);
      continue;
    }
    quest.objectives.forEach((objective) => {
      if (!objectiveSatisfiable(data, byThen, objective)) {
        problems.push(`main quest ${quest.order} (${quest.id}): "${objective.text}" cannot be done when the quest starts`);
      }
    });
  }

  // No region may need something found only inside or beyond it.
  data.regions.forEach((region, index) => {
    if (index === 0) return;
    const before = analyseReach(data, { allowedRegions: data.regions.slice(0, index).map((earlier) => earlier.id) });
    if (!regionEnterable(before, region)) {
      problems.push(`region ${region.id} needs stability ${region.roughness}${region.fogWall ? ' and fog gear' : ''}`
        + `, but only stability ${before.stability}${before.fogGear ? ' with' : ' without'} fog gear can be had before it`);
    }
  });

  problems.push(...uniqueSupplyProblems(data));
  return problems;
}
