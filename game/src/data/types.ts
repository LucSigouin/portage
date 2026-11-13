/**
 * Shared data types for every table in `src/data/`.
 *
 * Conventions used by the whole game:
 * - Metres and seconds. Y is up. The water rest level is y = 0.
 * - North is -z, east is +x.
 * - A heading or bearing is in radians, 0 = north (-z), growing clockwise seen
 *   from above (toward +x east). Forward vector = (sin heading, 0, -cos heading).
 *   For Three.js: `object.rotation.y = -heading`.
 */

export type ItemId =
  // raw
  | 'driftwood' | 'log' | 'birch_bark' | 'spruce_gum' | 'fiber' | 'stone' | 'clay'
  | 'scrap_metal' | 'nails' | 'wire' | 'cloth' | 'rope' | 'glass_jar' | 'tin_can'
  | 'seeds' | 'copper_coil' | 'battery' | 'steel_cable'
  // unique finds
  | 'hatchet_head' | 'saw_blade' | 'lens' | 'lodestone' | 'radio_crystal'
  // raw food and water
  | 'berries' | 'apple' | 'cattail_root' | 'mushroom' | 'raw_fish' | 'dirty_water'
  // refined
  | 'plank' | 'pitch' | 'charcoal' | 'sailcloth' | 'metal_sheet' | 'hardware'
  | 'clean_water' | 'cooked_fish' | 'roast_roots' | 'stew'
  // stock food
  | 'smoked_fish' | 'jam' | 'dried_apple'
  // tools
  | ToolId
  // quest items
  | 'beacon_bearing' | 'bellows' | 'signal_flag' | 'carved_figurehead';

export type ToolId =
  | 'bailing_can' | 'stone_knife' | 'hatchet' | 'pry_bar' | 'saw' | 'hammer'
  | 'fishing_rod' | 'wrench';

/**
 * - `raw`, `food`, `refined`, `stock`: stackable, take a backpack or cargo slot.
 * - `tool`: lives on the tool belt, takes no slot, is never lost.
 * - `unique`, `quest`: key items, take no slot, are never lost.
 */
export type ItemCategory = 'raw' | 'unique' | 'food' | 'refined' | 'stock' | 'tool' | 'quest';

export interface ItemAmount {
  itemId: ItemId;
  count: number;
}

export interface EdibleEffect {
  hunger: number;
  thirst: number;
  energy: number;
}

export interface ItemDefinition {
  id: ItemId;
  name: string;
  description: string;
  iconId: string;
  category: ItemCategory;
  /** Present when the item can be eaten or drunk. */
  edible: EdibleEffect | null;
  /** True for drinks: the `drink` command takes these, `eat` takes the rest. */
  isDrink: boolean;
}

export type StationId = 'hands' | 'fire' | 'bench' | 'smoker' | 'forge';

export interface StationDefinition {
  id: StationId;
  name: string;
  description: string;
  iconId: string;
}

export type FlagId =
  | 'wren_taught_sailcloth'
  | 'wren_gave_cloth'
  | 'tink_gave_wrench'
  | 'odile_gave_welcome'
  | 'beacon_lit';

export type RecipeId =
  | 'stone_knife' | 'rope' | 'hatchet' | 'fishing_rod'
  | 'pitch' | 'charcoal' | 'charcoal_from_driftwood' | 'clean_water' | 'cooked_fish'
  | 'roast_roots' | 'stew' | 'jam'
  | 'saw' | 'hammer' | 'plank' | 'sailcloth'
  | 'smoked_fish' | 'dried_apple'
  | 'metal_sheet' | 'hardware';

export interface RecipeDefinition {
  id: RecipeId;
  name: string;
  description: string;
  iconId: string;
  station: StationId;
  /** Tools that must be on the belt. They are not consumed. */
  tools: ToolId[];
  inputs: ItemAmount[];
  output: ItemAmount;
  /** The recipe is unknown until this flag is set (taught by a survivor). */
  requiresFlag: FlagId | null;
}

/** Position and Euler rotation (XYZ order, radians) in canoe space. */
export interface Transform {
  position: [number, number, number];
  rotation: [number, number, number];
}

export interface HullDimensions {
  /** Bow to stern, metres. */
  length: number;
  /** Widest point, metres. */
  beam: number;
  /** Keel to gunwale, metres. */
  depth: number;
  /** Keel below the waterline when floating level, metres. */
  draft: number;
}

export type HullTierId = 'leaky_canoe' | 'patched_canoe' | 'ribbed_canoe' | 'long_canoe';

export interface HullTierDefinition {
  tier: 0 | 1 | 2 | 3;
  id: HullTierId;
  name: string;
  description: string;
  iconId: string;
  /** Cost to upgrade INTO this tier. Empty for tier 0. */
  cost: ItemAmount[];
  tools: ToolId[];
  cargoSlots: number;
  /** Water level points per second gained while afloat. */
  leakPerSecond: number;
  /** Multiplies paddling speed. */
  speedMultiplier: number;
  dimensions: HullDimensions;
  /** Mount points this hull offers. */
  mountIds: MountId[];
}

export type MountId =
  | 'mid_aft_hull' | 'stern_quarter_frame' | 'mid_forward_slab' | 'starboard_gunwale'
  | 'port_float' | 'starboard_float' | 'port_deck_forward' | 'port_deck_aft'
  | 'starboard_deck_forward' | 'starboard_deck_aft' | 'mast_step' | 'stern_post'
  | 'bow_pole' | 'cockpit_hoops' | 'cockpit_table' | 'bow_crane' | 'stern_shack'
  | 'stern_rail' | 'bow_stem';

export type AttachmentId =
  | 'cargo_rack' | 'rain_catcher' | 'firebox' | 'fishing_rig' | 'outrigger_port'
  | 'outrigger_starboard' | 'workbench' | 'smoker' | 'planter' | 'forge' | 'mast_sail'
  | 'rudder' | 'lantern_mast' | 'canopy' | 'map_table' | 'winch' | 'radio' | 'flag'
  | 'figurehead';

/** Which end of the hull a mount follows when the hull gets longer. */
export type MountAnchor = 'bow' | 'centre' | 'stern';

export interface AttachmentDefinition {
  id: AttachmentId;
  name: string;
  description: string;
  iconId: string;
  mountId: MountId;
  anchor: MountAnchor;
  /**
   * Local transform in canoe space on the reference hull (tier 2, 4.9 m).
   * Canoe space: origin at the hull centre on the waterline, bow toward -z,
   * starboard +x, up +y. For longer hulls use `attachmentTransformForHull`.
   */
  transform: Transform;
  minimumHullTier: 0 | 1 | 2 | 3;
  requiresAttachments: AttachmentId[];
  cost: ItemAmount[];
  tools: ToolId[];
  cosmetic: boolean;
  stabilityBonus: number;
  cargoSlotsBonus: number;
  /** Crafting station this attachment provides aboard. */
  station: StationId | null;
}

export type RegionId = 'shallows' | 'reach' | 'narrows' | 'fog';

export interface RegionDefinition {
  id: RegionId;
  name: string;
  description: string;
  iconId: string;
  /** Regions are bands across the valley. This one spans northEdgeZ < z <= southEdgeZ. */
  northEdgeZ: number;
  southEdgeZ: number;
  roughness: number;
  /** Steady water current, metres per second. */
  current: { x: number; z: number };
  /** True when the fog wall guards this region. */
  fogWall: boolean;
}

export type IslandId =
  | 'home_knoll' | 'cabin_roofs' | 'birch_islet' | 'orchard_hill' | 'the_boathouse'
  | 'steeple_rock' | 'silo_twins' | 'pylon_line' | 'scrapyard_bar' | 'heron_marsh'
  | 'truss_bridge' | 'quarry_face' | 'fire_tower_ridge' | 'dam_crest'
  | 'the_beacon';

/**
 * A spot on an island in island-local units: `along` is a fraction of radiusX
 * on the island's long axis, `across` a fraction of radiusZ. (0, -1) is the
 * north shore of an unrotated island. `along² + across² = 1` is the shoreline.
 */
export interface IslandSpot {
  along: number;
  across: number;
}

export type LandmarkKind =
  | 'lean_to' | 'campfire' | 'stump_bench' | 'cabin_roof' | 'birch_grove' | 'orchard_rows'
  | 'farmhouse' | 'boathouse' | 'dock' | 'steeple' | 'silo' | 'pylon' | 'scrap_stack'
  | 'crane_arm' | 'reed_bed' | 'truss_span' | 'quarry_cut' | 'fire_tower' | 'dam_wall'
  | 'gatehouse' | 'radio_tower' | 'keeper_hut' | 'bedroll' | 'forge_hearth';

export interface LandmarkDefinition {
  kind: LandmarkKind;
  spot: IslandSpot;
  /** Bearing the landmark faces, radians. */
  bearing: number;
}

export interface CampDefinition {
  spot: IslandSpot;
  stations: StationId[];
  /** Sleeping here sets the respawn point. */
  sleep: boolean;
}

export interface IslandDefinition {
  id: IslandId;
  name: string;
  description: string;
  iconId: string;
  regionId: RegionId;
  center: { x: number; z: number };
  radiusX: number;
  radiusZ: number;
  /** Bearing of the island's long axis away from east-west, radians. */
  rotation: number;
  peakHeight: number;
  /** Direction from the centre to the landing beach. Normalised on load. */
  landing: IslandSpot;
  camp: CampDefinition | null;
  landmarks: LandmarkDefinition[];
}

export type NodeTypeId =
  | 'driftwood_pile' | 'cattail_stand' | 'berry_bush' | 'apple_tree' | 'mushroom_log'
  | 'birch' | 'spruce' | 'stone_outcrop' | 'clay_bank' | 'crate' | 'attic' | 'shed'
  | 'junk_heap' | 'boat_wreck' | 'machinery' | 'rain_barrel' | 'garden_bed'
  | 'fishing_spot' | 'wreck_buoy' | 'message_bottle' | 'cache' | 'beacon_lamp';

export type LootTableId = string;

export interface LootEntry {
  itemId: ItemId;
  minimum: number;
  maximum: number;
}

export interface LootTable {
  id: LootTableId;
  /** Always granted. */
  guaranteed: LootEntry[];
  /** Number of weighted picks from the pool. */
  rolls: number;
  pool: (LootEntry & { weight: number })[];
}

export interface NodeActionDefinition {
  /** Verb for the prompt, for example "Chop". */
  verb: string;
  tool: ToolId | null;
  /** The canoe needs this attachment (the winch). */
  attachment: AttachmentId | null;
  /** Only allowed once every other objective of this quest is done. */
  questGate: QuestId | null;
  /** Seconds the interact input must be held. */
  seconds: number;
  energyCost: number;
  lootTableId: LootTableId;
  /**
   * Days until the action is available again: the same for every action that refills, `TUNING.nodes.refillSeconds`
   * in days (`data/nodes.ts`). null = never: a bottle, a cache, a sunken locker, the Beacon lamp.
   */
  respawnDays: number | null;
}

export interface NodeTypeDefinition {
  id: NodeTypeId;
  name: string;
  description: string;
  iconId: string;
  /** `foot`: scavenged on foot. `canoe`: reached from the canoe. */
  reach: 'foot' | 'canoe';
  actions: NodeActionDefinition[];
}

export type NodeId = string;

/** A placed scavenge node, fully resolved (name, icon, actions, world position). */
export interface NodeDefinition {
  id: NodeId;
  typeId: NodeTypeId;
  name: string;
  description: string;
  iconId: string;
  islandId: IslandId;
  position: { x: number; z: number };
  reach: 'foot' | 'canoe';
  actions: NodeActionDefinition[];
  /** Set on message bottles. */
  bottleId: BottleId | null;
}

export type BottleId =
  | 'bottle_01' | 'bottle_02' | 'bottle_03' | 'bottle_04' | 'bottle_05'
  | 'bottle_06' | 'bottle_07' | 'bottle_08' | 'bottle_09' | 'bottle_10';

export interface BottleDefinition {
  id: BottleId;
  name: string;
  text: string;
  iconId: string;
}

export type NpcId = 'odile' | 'wren' | 'tink';

export type QuestId =
  // main line, in order
  | 'bail_out' | 'first_haul' | 'stop_the_leak' | 'something_to_eat' | 'a_proper_edge'
  | 'ribs_and_rails' | 'steady_now' | 'the_bellkeeper' | 'catch_the_wind' | 'voices'
  | 'through_the_narrows' | 'the_beacon'
  // side quests
  | 'odile_windfall' | 'odile_something_sweet' | 'odile_garden_afloat'
  | 'wren_bell_rope' | 'tink_hot_work' | 'tink_heavy_lifting'
  | 'ten_bottles' | 'full_rack' | 'every_last_one';

export type QuestStatus = 'locked' | 'available' | 'active' | 'ready' | 'completed';

/**
 * What an ingredient gets made into. A `have_item` step that names one is also
 * done once that exists: making it uses the ingredient up (some ingredients,
 * like the hatchet head, are found once and never again), so "hold the
 * ingredient" can stop being true for good.
 */
export type MadeInto = { toolId: ToolId } | { attachmentId: AttachmentId };

/**
 * One step of a quest. A step counts as done once what it asks for has been
 * achieved, whenever that happened, even before the quest was given. The
 * exceptions are `deliver` and nothing else: a hand-over is checked live.
 */
export type ObjectiveDefinition = { text: string } & (
  | { type: 'bail'; waterAtMost: number }
  | { type: 'land'; islandId: IslandId }
  | { type: 'have_item'; itemId: ItemId; count: number; madeInto?: MadeInto }
  | { type: 'have_tool'; toolId: ToolId }
  /** Craft `count` of any of these items while the quest is active. */
  | { type: 'craft'; itemIds: ItemId[]; count: number }
  | { type: 'hull'; tier: 1 | 2 | 3 }
  | { type: 'attachment'; attachmentId: AttachmentId }
  | { type: 'sleep' }
  | { type: 'enter_region'; regionId: RegionId }
  | { type: 'talk'; npcId: NpcId }
  /** Use a specific unique node (take the bearing, light the Beacon). */
  | { type: 'node'; nodeId: NodeId }
  /** Stock food and clean water sitting in the canoe cargo. */
  | { type: 'stock'; stockFood: number; cleanWater: number }
  /** Hand over items at turn-in. Checked live, consumed on turn-in. */
  | { type: 'deliver'; itemId: ItemId; count: number }
  | { type: 'bottles'; count: number }
  | { type: 'smoke'; count: number }
  | { type: 'caches'; count: number }
);

export interface QuestRewards {
  items: ItemAmount[];
  flags: FlagId[];
}

export interface QuestDefinition {
  id: QuestId;
  name: string;
  description: string;
  iconId: string;
  kind: 'main' | 'side';
  /** 1 to 12 on the main line, 0 for side quests. */
  order: number;
  /** Survivor who offers and receives the quest, or null. */
  giver: NpcId | null;
  /** Quests that must be completed before this one unlocks. */
  requiresQuests: QuestId[];
  /** Starts active without being accepted (main line and the collection quests). */
  autoStart: boolean;
  /** Completes by itself when the objectives are met. Otherwise turn in at the giver. */
  autoComplete: boolean;
  /** Kept out of the quest log until the first progress. */
  hiddenUntilProgress: boolean;
  objectives: ObjectiveDefinition[];
  rewards: QuestRewards;
}

export interface DialogueCondition {
  flags?: FlagId[];
  notFlags?: FlagId[];
  quests?: { questId: QuestId; statuses: QuestStatus[] }[];
}

export type DialogueEffect =
  | { type: 'set_flag'; flag: FlagId }
  | { type: 'give_items'; items: ItemAmount[] }
  | { type: 'accept_quest'; questId: QuestId }
  | { type: 'turn_in_quest'; questId: QuestId };

export interface DialogueOption {
  text: string;
  /** Node to go to. null closes the dialogue. */
  next: string | null;
  condition?: DialogueCondition;
  effects?: DialogueEffect[];
}

export interface DialogueNode {
  id: string;
  text: string;
  options: DialogueOption[];
}

export interface NpcDefinition {
  id: NpcId;
  name: string;
  description: string;
  iconId: string;
  islandId: IslandId;
  spot: IslandSpot;
  /** Where a conversation opens. The first entry whose condition holds wins. */
  entries: { condition?: DialogueCondition; nodeId: string }[];
  nodes: Record<string, DialogueNode>;
}

export type WeatherKind = 'clear' | 'fog' | 'rain' | 'storm';

export interface WeatherDefinition {
  id: WeatherKind;
  name: string;
  description: string;
  iconId: string;
  /** Relative chance when the next weather is rolled. */
  weight: number;
  minimumSeconds: number;
  maximumSeconds: number;
  minimumWind: number;
  maximumWind: number;
  /** Fills the rain catcher. */
  rain: boolean;
  /** Added to water roughness at full strength. */
  roughnessBonus: number;
  /** Visibility hint for rendering, metres. */
  visibility: number;
}

export type Difficulty = 'relaxed' | 'standard';
