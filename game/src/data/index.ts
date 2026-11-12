/** Typed data tables. Read-only: the simulation never mutates them. */
export * from './types.ts';
export { TUNING } from './tuning.ts';
export { ITEMS, ITEM_IDS, TOOL_IDS, STOCK_FOOD_IDS, STATIONS, isStackable } from './items.ts';
export { RECIPES, RECIPE_IDS } from './recipes.ts';
export { HULL_TIERS, ATTACHMENTS, ATTACHMENT_IDS, REFERENCE_HULL_TIER, attachmentTransformForHull } from './canoe.ts';
export {
  REGIONS, REGION_IDS, REGIONS_BY_ID, ISLANDS, ISLAND_IDS, ISLANDS_BY_ID, START, WAVE_TABLE,
  VALLEY_HALF_WIDTH, VALLEY_SOUTH_SHORE_Z, VALLEY_NORTH_SHORE_Z, QUARRY_BENCHES, spotPosition,
} from './world.ts';
export type { WaveComponent } from './world.ts';
export { NODES, NODES_BY_ID, NODES_BY_ISLAND, NODE_TYPES, NODE_IDS, LOOT_TABLES } from './nodes.ts';
export { QUESTS, QUEST_IDS, QUEST_LIST, MAIN_QUESTS, SIDE_QUESTS } from './quests.ts';
export { NPCS, NPC_IDS } from './dialogue.ts';
export { BOTTLES, BOTTLE_IDS } from './bottles.ts';
export { CREW_MARKS } from './crew.ts';
export type { CrewMark } from './crew.ts';
export { WEATHER, WEATHER_KINDS } from './weather.ts';
