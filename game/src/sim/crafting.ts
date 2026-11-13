import type { AttachmentId, ItemAmount, RecipeId, StationId, ToolId } from '../data/types.ts';
import { ATTACHMENTS, ATTACHMENT_IDS, HULL_TIERS } from '../data/canoe.ts';
import { RECIPES } from '../data/recipes.ts';
import {
  atCanoe, campInReach, emit, emptyMissing, exchangeItems, hasMissing, hasTool, itemsShort, spendItems,
} from './inventory.ts';
import { notifyCrafted, updateQuests } from './quests.ts';
import type { CommandResult, GameState, Missing, PlayerState } from './types.ts';

export const success = (gained: ItemAmount[] = [], spent: ItemAmount[] = []): CommandResult => ({ ok: true, gained, spent });

export const failure = (reason: Extract<CommandResult, { ok: false }>['reason'], missing: Missing | null = null): CommandResult =>
  ({ ok: false, reason, missing });

/** Crafting stations in reach: hands, the camp you stand in, and the canoe's attachments. */
export function accessibleStations(state: GameState, player: PlayerState): StationId[] {
  const stations: StationId[] = ['hands'];
  const camp = campInReach(player);
  if (camp?.camp) {
    for (const station of camp.camp.stations) if (!stations.includes(station)) stations.push(station);
  }
  if (atCanoe(state, player)) {
    for (const attachmentId of state.canoe.attachments) {
      const station = ATTACHMENTS[attachmentId].station;
      if (station && !stations.includes(station)) stations.push(station);
    }
  }
  return stations;
}

/** A crafting attachment built on the canoe, and whether one player can use it right now. */
export interface CanoeStation {
  attachmentId: AttachmentId;
  station: StationId;
  /** True aboard, afloat or beached, and on foot beside the canoe. */
  inReach: boolean;
}

/**
 * The crafting attachments built on the canoe, in the builder's order: the firebox, the workbench, the smoker, the
 * forge. The boat's menu shows one icon each (Luc's list, Round 3). They follow the canoe: a player aboard uses them
 * anywhere on the water.
 */
export function canoeStations(state: GameState, player: PlayerState): CanoeStation[] {
  const inReach = atCanoe(state, player);
  const stations: CanoeStation[] = [];
  for (const attachmentId of ATTACHMENT_IDS) {
    const station = ATTACHMENTS[attachmentId].station;
    if (station && state.canoe.attachments.includes(attachmentId)) stations.push({ attachmentId, station, inReach });
  }
  return stations;
}

function toolsShort(state: GameState, tools: ToolId[]): ToolId[] {
  return tools.filter((toolId) => !hasTool(state, toolId));
}

/** What crafting a recipe `times` over still needs. Empty when it can be made. */
export function recipeMissing(state: GameState, player: PlayerState, recipeId: RecipeId, times = 1): Missing {
  const recipe = RECIPES[recipeId];
  const missing = emptyMissing();
  if (recipe.requiresFlag && !state.flags[recipe.requiresFlag]) missing.flag = recipe.requiresFlag;
  if (!accessibleStations(state, player).includes(recipe.station)) missing.station = recipe.station;
  missing.tools = toolsShort(state, recipe.tools);
  missing.items = itemsShort(state, player, recipe.inputs, times);
  return missing;
}

/** How many times a recipe can be made from what is in reach. */
export function craftableCount(state: GameState, player: PlayerState, recipeId: RecipeId): number {
  const blocked = recipeMissing(state, player, recipeId, 0);
  if (hasMissing(blocked)) return 0;
  let count = 0;
  while (count < 99 && itemsShort(state, player, RECIPES[recipeId].inputs, count + 1).length === 0) count += 1;
  return count;
}

export function craft(state: GameState, player: PlayerState, recipeId: RecipeId, times: number): CommandResult {
  const recipe = RECIPES[recipeId];
  if (!recipe) return failure('unknown_id');
  if (!Number.isInteger(times) || times < 1) return failure('invalid_amount');
  const missing = recipeMissing(state, player, recipeId, times);
  if (missing.flag) return failure('recipe_locked', missing);
  if (hasMissing(missing)) return failure('missing_requirements', missing);
  const spent = recipe.inputs.map((input) => ({ itemId: input.itemId, count: input.count * times }));
  const gained = [{ itemId: recipe.output.itemId, count: recipe.output.count * times }];
  if (!exchangeItems(state, player, spent, gained)) return failure('inventory_full');
  state.statistics.itemsCrafted += gained[0].count;
  if (recipe.station === 'smoker') state.statistics.smokedCount += gained[0].count;
  emit(state, { type: 'crafted', recipeId, count: times }, player);
  notifyCrafted(state, recipe.output.itemId, gained[0].count);
  updateQuests(state, player);
  return success(gained, spent);
}

/** Why the canoe cannot be worked on right now, or null. */
function builderBlocked(state: GameState, player: PlayerState): CommandResult | null {
  if (!state.canoe.beached) return failure('canoe_not_beached');
  if (!atCanoe(state, player)) return failure('not_at_canoe');
  return null;
}

/** What the next hull tier still needs, or null at the last tier. */
export function hullUpgradeMissing(state: GameState, player: PlayerState): Missing | null {
  const next = HULL_TIERS[state.canoe.hullTier + 1];
  if (!next) return null;
  const missing = emptyMissing();
  missing.tools = toolsShort(state, next.tools);
  missing.items = itemsShort(state, player, next.cost);
  return missing;
}

export function upgradeHull(state: GameState, player: PlayerState): CommandResult {
  const next = HULL_TIERS[state.canoe.hullTier + 1];
  if (!next) return failure('hull_at_maximum');
  const blocked = builderBlocked(state, player);
  if (blocked) return blocked;
  const missing = hullUpgradeMissing(state, player)!;
  if (hasMissing(missing)) return failure('missing_requirements', missing);
  spendItems(state, player, next.cost);
  state.canoe.hullTier = next.tier;
  emit(state, { type: 'hull_upgraded', tier: next.tier });
  updateQuests(state, player);
  return success([], next.cost);
}

/** What building an attachment still needs. Empty when it can be built. */
export function attachmentMissing(state: GameState, player: PlayerState, attachmentId: AttachmentId): Missing {
  const definition = ATTACHMENTS[attachmentId];
  const missing = emptyMissing();
  if (state.canoe.hullTier < definition.minimumHullTier) missing.hullTier = definition.minimumHullTier;
  missing.attachments = definition.requiresAttachments.filter((required) => !state.canoe.attachments.includes(required));
  missing.tools = toolsShort(state, definition.tools);
  missing.items = itemsShort(state, player, definition.cost);
  return missing;
}

export function buildAttachment(state: GameState, player: PlayerState, attachmentId: AttachmentId): CommandResult {
  const definition = ATTACHMENTS[attachmentId];
  if (!definition) return failure('unknown_id');
  if (state.canoe.attachments.includes(attachmentId)) return failure('already_built');
  const blocked = builderBlocked(state, player);
  if (blocked) return blocked;
  const missing = attachmentMissing(state, player, attachmentId);
  if (hasMissing(missing)) return failure('missing_requirements', missing);
  spendItems(state, player, definition.cost);
  state.canoe.attachments.push(attachmentId);
  emit(state, { type: 'attachment_built', attachmentId });
  updateQuests(state, player);
  return success([], definition.cost);
}
