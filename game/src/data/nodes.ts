import type {
  AttachmentId, BottleId, IslandId, ItemId, LootEntry, LootTable, LootTableId, NodeActionDefinition,
  NodeDefinition, NodeTypeDefinition, NodeTypeId, QuestId, ToolId,
} from './types.ts';
import { TUNING } from './tuning.ts';
import { ISLANDS_BY_ID, spotPosition } from './world.ts';

const entry = (itemId: ItemId, minimum: number, maximum = minimum): LootEntry => ({ itemId, minimum, maximum });
const weighted = (itemId: ItemId, minimum: number, maximum: number, weight: number) => ({ itemId, minimum, maximum, weight });

function table(id: LootTableId, guaranteed: LootEntry[], rolls = 0, pool: LootTable['pool'] = []): LootTable {
  return { id, guaranteed, rolls, pool };
}

const LOOT_TABLE_LIST: LootTable[] = [
  table('driftwood_pile', [entry('driftwood', 3, 4)]),
  table('cattail_stand', [entry('fiber', 3, 4), entry('cattail_root', 1, 2)]),
  table('berry_bush', [entry('berries', 4, 6)]),
  table('apple_tree', [entry('apple', 3, 5)]),
  table('mushroom_log', [entry('mushroom', 2, 3)]),
  table('birch_bark', [entry('birch_bark', 2, 3)]),
  table('spruce_gum', [entry('spruce_gum', 2, 3)]),
  table('spruce_logs', [entry('log', 3)]),
  table('stone_outcrop', [entry('stone', 3, 4)]),
  table('clay_bank', [entry('clay', 3, 4)]),
  table('crate', [entry('nails', 3, 5)], 2, [
    weighted('cloth', 1, 2, 3), weighted('rope', 1, 1, 2), weighted('tin_can', 1, 1, 2),
    weighted('glass_jar', 1, 1, 2), weighted('wire', 1, 2, 2), weighted('scrap_metal', 1, 2, 2),
    weighted('seeds', 1, 2, 1),
  ]),
  table('attic', [entry('cloth', 2, 3), entry('nails', 1, 2)], 2, [
    weighted('glass_jar', 1, 1, 3), weighted('tin_can', 1, 1, 2), weighted('rope', 1, 1, 2),
    weighted('seeds', 1, 2, 2), weighted('wire', 1, 1, 1), weighted('cloth', 1, 1, 2),
  ]),
  table('shed', [entry('rope', 1, 2), entry('glass_jar', 1), entry('scrap_metal', 1, 2)], 2, [
    weighted('nails', 2, 3, 3), weighted('wire', 1, 2, 2), weighted('tin_can', 1, 1, 2), weighted('cloth', 1, 1, 1),
  ]),
  table('junk_heap', [entry('scrap_metal', 2, 3), entry('tin_can', 1)], 2, [
    weighted('wire', 1, 2, 3), weighted('nails', 1, 3, 3), weighted('glass_jar', 1, 1, 2), weighted('cloth', 1, 1, 1),
  ]),
  table('boat_wreck', [entry('scrap_metal', 1, 2), entry('rope', 1, 2), entry('nails', 2, 3)], 1, [
    weighted('cloth', 1, 2, 2), weighted('wire', 1, 1, 2), weighted('tin_can', 1, 1, 1),
  ]),
  table('machinery_motor', [entry('copper_coil', 1), entry('wire', 1, 2)]),
  table('machinery_transformer', [entry('copper_coil', 1), entry('wire', 2, 3)]),
  table('machinery_cable_spool', [entry('steel_cable', 1), entry('wire', 1, 2)]),
  table('machinery_generator', [entry('battery', 1)], 1, [weighted('wire', 1, 2, 2), weighted('scrap_metal', 1, 2, 2)]),
  table('machinery_crusher', [entry('steel_cable', 1), entry('scrap_metal', 2, 3)]),
  table('rain_barrel', [entry('clean_water', 2, 3)]),
  table('garden_bed', [entry('seeds', 2, 3), entry('berries', 2, 3)]),
  table('fishing_spot', [entry('raw_fish', 3)]),
  table('message_bottle', []),
  table('beacon_lamp', []),
  // unique caches
  table('cache_hatchet_head', [entry('hatchet_head', 1), entry('cloth', 2), entry('nails', 2)]),
  table('cache_pry_bar', [entry('pry_bar', 1), entry('rope', 2)]),
  table('cache_saw_blade', [entry('saw_blade', 1), entry('nails', 4)]),
  table('cache_lens', [entry('lens', 1), entry('cloth', 2)]),
  table('cache_lodestone', [entry('lodestone', 1)]),
  table('cache_radio_crystal', [entry('radio_crystal', 1), entry('wire', 2)]),
  table('cache_beacon_bearing', [entry('beacon_bearing', 1)]),
  table('wreck_tackle_locker', [entry('steel_cable', 1), entry('hardware', 2), entry('nails', 4)]),
  table('wreck_engine_bay', [entry('battery', 1), entry('copper_coil', 1), entry('wire', 3)]),
  table('wreck_galley', [entry('metal_sheet', 2), entry('glass_jar', 2), entry('jam', 2)]),
  table('wreck_sail_locker', [entry('cloth', 4), entry('rope', 3), entry('hardware', 2)]),
];

export const LOOT_TABLES: Record<LootTableId, LootTable> = Object.fromEntries(
  LOOT_TABLE_LIST.map((definition) => [definition.id, definition]),
);

interface ActionOptions {
  tool?: ToolId;
  attachment?: AttachmentId;
  questGate?: QuestId;
  energyCost?: number;
}

/** An action that comes back after `TUNING.nodes.refillSeconds`, and one that never does. */
const REFILLS = true;
const NEVER = false;
/** Every refilling action's wait, in days: one number for all of them, from the tuning. */
const REFILL_DAYS = TUNING.nodes.refillSeconds / TUNING.time.daySeconds;

function action(
  verb: string,
  seconds: number,
  lootTableId: LootTableId,
  refills: boolean,
  options: ActionOptions = {},
): NodeActionDefinition {
  return {
    verb, seconds, lootTableId, respawnDays: refills ? REFILL_DAYS : null,
    tool: options.tool ?? null,
    attachment: options.attachment ?? null,
    questGate: options.questGate ?? null,
    energyCost: options.energyCost ?? 0,
  };
}

function nodeType(
  id: NodeTypeId,
  name: string,
  description: string,
  actions: NodeActionDefinition[],
  reach: 'foot' | 'canoe' = 'foot',
): NodeTypeDefinition {
  return { id, name, description, iconId: `node_${id}`, reach, actions };
}

const NODE_TYPE_LIST: NodeTypeDefinition[] = [
  nodeType('driftwood_pile', 'Driftwood pile', 'Bleached wood stacked by the last high water.',
    [action('Gather', 2, 'driftwood_pile', REFILLS)]),
  nodeType('cattail_stand', 'Cattail stand', 'Leaves for cord, roots for the fire.',
    [action('Pull', 3, 'cattail_stand', REFILLS)]),
  nodeType('berry_bush', 'Berry bush', 'Low blueberry scrub on the open rock.',
    [action('Pick', 2.5, 'berry_bush', REFILLS)]),
  nodeType('apple_tree', 'Apple tree', 'An orchard tree with its feet in the water.',
    [action('Pick', 3, 'apple_tree', REFILLS)]),
  nodeType('mushroom_log', 'Mushroom log', 'A rotting trunk ringed with brown caps.',
    [action('Pick', 2, 'mushroom_log', REFILLS)]),
  nodeType('birch', 'Birch', 'White bark that peels in sheets. Bring a knife.',
    [action('Peel', 3, 'birch_bark', REFILLS, { tool: 'stone_knife' })]),
  nodeType('spruce', 'Spruce', 'Gum by hand. Logs if you have the hatchet out.',
    [
      action('Scrape gum', 2.5, 'spruce_gum', REFILLS),
      action('Chop', 5, 'spruce_logs', REFILLS, { tool: 'hatchet', energyCost: 5 }),
    ]),
  nodeType('stone_outcrop', 'Stone outcrop', 'Frost-split granite. Loose pieces come away by hand.',
    [action('Break', 3, 'stone_outcrop', REFILLS, { energyCost: 2 })]),
  nodeType('clay_bank', 'Clay bank', 'A grey seam at the waterline.',
    [action('Dig', 3, 'clay_bank', REFILLS, { energyCost: 2 })]),
  nodeType('crate', 'Crate', 'Washed up and nailed shut.',
    [action('Pry open', 3, 'crate', REFILLS, { tool: 'pry_bar' })]),
  nodeType('attic', 'Attic', 'Dry rafters above the waterline.',
    [action('Search', 4, 'attic', REFILLS)]),
  nodeType('shed', 'Shed', 'Shelves of things someone meant to fix.',
    [action('Search', 4, 'shed', REFILLS)]),
  nodeType('junk_heap', 'Junk heap', 'A tangle of whatever the current dropped.',
    [action('Pick over', 3, 'junk_heap', REFILLS)]),
  nodeType('boat_wreck', 'Boat wreck', 'A stove-in hull, good for parts.',
    [action('Strip', 4, 'boat_wreck', REFILLS)]),
  nodeType('machinery', 'Machinery', 'Seized solid, but the parts inside are fine.',
    [action('Strip', 5, 'machinery_motor', REFILLS, { tool: 'wrench', energyCost: 3 })]),
  nodeType('rain_barrel', 'Rain barrel', 'Roof water, clean enough to drink.',
    [action('Fill up', 2, 'rain_barrel', REFILLS)]),
  nodeType('garden_bed', 'Garden bed', 'A raised bed gone wild.',
    [action('Harvest', 3, 'garden_bed', REFILLS)]),
  nodeType('fishing_spot', 'Fishing spot', 'Rings on the water where perch are feeding.',
    [action('Fish', 8, 'fishing_spot', REFILLS, { tool: 'fishing_rod' })]),
  nodeType('wreck_buoy', 'Sunken wreck buoy', 'A faded float tied to something heavy below.',
    [action('Haul up', 8, 'wreck_tackle_locker', NEVER, { attachment: 'winch' })], 'canoe'),
  nodeType('message_bottle', 'Message bottle', 'Green glass, corked, with paper inside.',
    [action('Open', 1, 'message_bottle', NEVER)]),
  nodeType('cache', 'Cache', 'Something put away carefully before the water came.',
    [action('Search', 4, 'cache_hatchet_head', NEVER)]),
  nodeType('beacon_lamp', 'Beacon lamp', 'The great lamp at the foot of the radio tower.',
    [action('Light', 6, 'beacon_lamp', NEVER, { questGate: 'the_beacon' })]),
];

export const NODE_TYPES: Record<NodeTypeId, NodeTypeDefinition> = Object.fromEntries(
  NODE_TYPE_LIST.map((definition) => [definition.id, definition]),
) as Record<NodeTypeId, NodeTypeDefinition>;

interface PlacementOverrides {
  id?: string;
  name?: string;
  description?: string;
  iconId?: string;
  lootTableId?: LootTableId;
  tool?: ToolId | null;
  bottleId?: BottleId;
}

const placed: NodeDefinition[] = [];
const counters: Record<string, number> = {};

function resolve(
  islandId: IslandId,
  typeId: NodeTypeId,
  position: { x: number; z: number },
  overrides: PlacementOverrides,
): void {
  const type = NODE_TYPES[typeId];
  const counterKey = `${islandId}.${typeId}`;
  counters[counterKey] = (counters[counterKey] ?? 0) + 1;
  const actions = type.actions.map((definition, index) => ({
    ...definition,
    lootTableId: index === 0 && overrides.lootTableId ? overrides.lootTableId : definition.lootTableId,
    tool: index === 0 && overrides.tool !== undefined ? overrides.tool : definition.tool,
  }));
  placed.push({
    id: overrides.id ? `${islandId}.${overrides.id}` : `${counterKey}.${counters[counterKey]}`,
    typeId,
    name: overrides.name ?? type.name,
    description: overrides.description ?? type.description,
    iconId: overrides.iconId ?? type.iconId,
    islandId,
    position,
    reach: type.reach,
    actions,
    bottleId: overrides.bottleId ?? null,
  });
}

/** Place a node at an island-local spot (fractions of the island radii). */
function place(islandId: IslandId, typeId: NodeTypeId, along: number, across: number, overrides: PlacementOverrides = {}): void {
  resolve(islandId, typeId, spotPosition(ISLANDS_BY_ID[islandId], { along, across }), overrides);
}

/** Place a node in open water, as an offset in metres from the island centre. */
function placeAfloat(islandId: IslandId, typeId: NodeTypeId, offsetX: number, offsetZ: number, overrides: PlacementOverrides = {}): void {
  const center = ISLANDS_BY_ID[islandId].center;
  resolve(islandId, typeId, { x: center.x + offsetX, z: center.z + offsetZ }, overrides);
}

const bottle = (islandId: IslandId, along: number, across: number, bottleId: BottleId): void =>
  place(islandId, 'message_bottle', along, across, { id: 'bottle', bottleId });

// --- The Shallows -----------------------------------------------------------

place('home_knoll', 'driftwood_pile', -0.5, -0.55);
place('home_knoll', 'driftwood_pile', 0.55, -0.5);
place('home_knoll', 'driftwood_pile', 0.7, 0.2);
place('home_knoll', 'cattail_stand', -0.72, -0.2);
place('home_knoll', 'cattail_stand', -0.65, 0.35);
place('home_knoll', 'stone_outcrop', 0.3, -0.1);
place('home_knoll', 'stone_outcrop', -0.25, 0.1);
place('home_knoll', 'spruce', 0.1, 0.35);
place('home_knoll', 'spruce', -0.2, 0.5);
place('home_knoll', 'spruce', 0.4, 0.5);
place('home_knoll', 'spruce', -0.45, 0.3);
place('home_knoll', 'berry_bush', 0.5, 0.05);
place('home_knoll', 'berry_bush', -0.45, -0.25);
place('home_knoll', 'mushroom_log', 0.0, 0.62);
place('home_knoll', 'clay_bank', 0.75, -0.25);
place('home_knoll', 'rain_barrel', -0.18, -0.3);
place('home_knoll', 'fishing_spot', 0.32, -0.84);
bottle('home_knoll', -0.38, -0.8, 'bottle_01');

place('cabin_roofs', 'cache', -0.3, -0.2, {
  id: 'attic_chest', name: 'Attic chest', lootTableId: 'cache_hatchet_head',
  description: 'A cedar chest under the eaves of the biggest roof.',
});
place('cabin_roofs', 'attic', 0.1, 0.25);
place('cabin_roofs', 'attic', 0.35, -0.3);
place('cabin_roofs', 'junk_heap', -0.55, 0.3);
place('cabin_roofs', 'driftwood_pile', 0.6, 0.35);
place('cabin_roofs', 'crate', -0.1, -0.6);
place('cabin_roofs', 'cattail_stand', -0.7, -0.25);
place('cabin_roofs', 'garden_bed', 0.05, -0.15);
place('cabin_roofs', 'rain_barrel', 0.45, 0.05);
bottle('cabin_roofs', 0.2, 0.82, 'bottle_02');

place('birch_islet', 'birch', -0.35, -0.1);
place('birch_islet', 'birch', -0.05, -0.4);
place('birch_islet', 'birch', 0.1, 0.1);
place('birch_islet', 'birch', -0.2, 0.4);
place('birch_islet', 'spruce', 0.45, -0.2);
place('birch_islet', 'spruce', 0.4, 0.35);
place('birch_islet', 'driftwood_pile', -0.65, 0.3);
place('birch_islet', 'berry_bush', 0.15, -0.65);
place('birch_islet', 'mushroom_log', 0.1, 0.6);
place('birch_islet', 'stone_outcrop', 0.65, 0.05);
place('birch_islet', 'cattail_stand', -0.55, -0.5);
bottle('birch_islet', 0.6, 0.62, 'bottle_03');

place('orchard_hill', 'apple_tree', -0.3, -0.1);
place('orchard_hill', 'apple_tree', -0.45, 0.15);
place('orchard_hill', 'apple_tree', -0.15, 0.25);
place('orchard_hill', 'apple_tree', -0.05, -0.3);
place('orchard_hill', 'berry_bush', 0.45, -0.2);
place('orchard_hill', 'berry_bush', 0.55, 0.1);
place('orchard_hill', 'garden_bed', 0.25, -0.1);
place('orchard_hill', 'garden_bed', 0.3, 0.08);
place('orchard_hill', 'spruce', -0.6, -0.3);
place('orchard_hill', 'spruce', -0.7, 0.05);
place('orchard_hill', 'spruce', -0.55, 0.45);
place('orchard_hill', 'clay_bank', 0.2, 0.7);
place('orchard_hill', 'cattail_stand', 0.6, 0.5);
place('orchard_hill', 'shed', 0.02, 0.12);
place('orchard_hill', 'driftwood_pile', 0.72, 0.3);
bottle('orchard_hill', -0.2, 0.85, 'bottle_04');

place('the_boathouse', 'cache', 0.1, -0.1, {
  id: 'tool_rack', name: 'Tool rack', lootTableId: 'cache_pry_bar',
  description: 'Pegboard in the boathouse office. One tool still hangs there.',
});
place('the_boathouse', 'cache', 0.3, 0.15, {
  id: 'locker', name: 'Steel locker', lootTableId: 'cache_saw_blade', tool: 'pry_bar',
  description: 'A padlocked locker. The pry bar will argue with it.',
});
place('the_boathouse', 'crate', -0.25, 0.3);
place('the_boathouse', 'crate', 0.5, -0.25);
place('the_boathouse', 'shed', -0.1, -0.35);
place('the_boathouse', 'boat_wreck', -0.5, -0.45);
place('the_boathouse', 'boat_wreck', 0.65, 0.3);
place('the_boathouse', 'junk_heap', 0.0, 0.55);
place('the_boathouse', 'cattail_stand', -0.6, 0.45);
place('the_boathouse', 'cattail_stand', 0.35, 0.6);
place('the_boathouse', 'driftwood_pile', -0.7, 0.1);
place('the_boathouse', 'driftwood_pile', 0.75, -0.1);
place('the_boathouse', 'fishing_spot', -0.6, 0.66);
place('the_boathouse', 'clay_bank', 0.2, -0.7);

// --- The Reach --------------------------------------------------------------

place('steeple_rock', 'attic', 0.0, -0.12, {
  name: 'Belfry loft', description: 'Hymn books, choir robes, and a great deal of curtain.',
});
place('steeple_rock', 'spruce', -0.5, -0.2);
place('steeple_rock', 'spruce', 0.5, -0.3);
place('steeple_rock', 'stone_outcrop', -0.4, 0.3);
place('steeple_rock', 'stone_outcrop', 0.3, -0.6);
place('steeple_rock', 'berry_bush', 0.55, 0.2);
place('steeple_rock', 'driftwood_pile', -0.3, 0.7);
place('steeple_rock', 'crate', 0.45, 0.55);
place('steeple_rock', 'rain_barrel', -0.15, 0.25);
place('steeple_rock', 'cattail_stand', -0.65, 0.4);
bottle('steeple_rock', -0.7, -0.5, 'bottle_05');

place('silo_twins', 'machinery', -0.1, 0.25, {
  name: 'Auger motor', lootTableId: 'machinery_motor',
  description: 'The grain auger’s motor, still bolted to its sled.',
});
place('silo_twins', 'machinery', 0.45, 0.2, {
  name: 'Tractor', lootTableId: 'machinery_generator',
  description: 'A tractor up to its axles in gravel. The battery box is dry.',
});
place('silo_twins', 'cache', -0.35, -0.3, {
  id: 'surveyor_case', name: 'Surveyor’s case', lootTableId: 'cache_lens', tool: 'pry_bar',
  description: 'A brass-cornered case, swollen shut.',
});
place('silo_twins', 'junk_heap', 0.05, -0.4);
place('silo_twins', 'junk_heap', -0.6, 0.1);
place('silo_twins', 'crate', 0.6, -0.2);
place('silo_twins', 'crate', -0.35, 0.5);
place('silo_twins', 'garden_bed', 0.25, 0.55);
place('silo_twins', 'driftwood_pile', 0.75, 0.2);
place('silo_twins', 'spruce', 0.1, 0.6);
place('silo_twins', 'spruce', -0.15, -0.65);
bottle('silo_twins', -0.75, -0.4, 'bottle_06');

place('pylon_line', 'machinery', -0.55, 0.15, {
  name: 'Transformer', lootTableId: 'machinery_transformer',
  description: 'A pole transformer on its side. Copper all the way through.',
});
place('pylon_line', 'machinery', 0.0, -0.2, {
  name: 'Cable spool', lootTableId: 'machinery_cable_spool',
  description: 'A line crew’s spool of guy cable, half unwound.',
});
place('pylon_line', 'cache', 0.55, 0.15, {
  id: 'struck_rock', name: 'Lightning-struck rock', lootTableId: 'cache_lodestone',
  description: 'A blackened boulder at the foot of the last pylon. Your knife swings toward it.',
});
place('pylon_line', 'junk_heap', -0.25, -0.1);
place('pylon_line', 'stone_outcrop', 0.3, 0.2);
place('pylon_line', 'driftwood_pile', -0.75, -0.2);
place('pylon_line', 'fishing_spot', 0.82, -0.3);
bottle('pylon_line', 0.8, 0.35, 'bottle_07');

place('scrapyard_bar', 'junk_heap', -0.3, 0.1);
place('scrapyard_bar', 'junk_heap', -0.55, -0.2);
place('scrapyard_bar', 'junk_heap', -0.1, -0.45);
place('scrapyard_bar', 'junk_heap', 0.05, 0.45);
place('scrapyard_bar', 'machinery', -0.45, 0.4, {
  name: 'Generator', lootTableId: 'machinery_generator',
  description: 'A diesel generator Tink has not got round to.',
});
place('scrapyard_bar', 'machinery', -0.7, 0.1, {
  name: 'Winch truck', lootTableId: 'machinery_cable_spool',
  description: 'A tow truck with a full drum of cable.',
});
place('scrapyard_bar', 'crate', 0.15, -0.2);
place('scrapyard_bar', 'crate', 0.6, -0.3);
place('scrapyard_bar', 'boat_wreck', 0.2, 0.7);
place('scrapyard_bar', 'clay_bank', 0.7, 0.3);
place('scrapyard_bar', 'driftwood_pile', 0.55, 0.45);
place('scrapyard_bar', 'spruce', -0.2, 0.25, {
  name: 'Lone spruce', description: 'The one tree on the bar. Tink says she likes the shade.',
});

place('heron_marsh', 'cattail_stand', -0.5, 0.2);
place('heron_marsh', 'cattail_stand', -0.3, -0.35);
place('heron_marsh', 'cattail_stand', 0.1, 0.45);
place('heron_marsh', 'cattail_stand', 0.4, -0.1);
place('heron_marsh', 'cattail_stand', 0.55, 0.4);
place('heron_marsh', 'mushroom_log', -0.1, 0.1);
place('heron_marsh', 'mushroom_log', 0.3, -0.5);
place('heron_marsh', 'berry_bush', -0.15, -0.6);
place('heron_marsh', 'berry_bush', 0.2, 0.15);
place('heron_marsh', 'fishing_spot', -0.75, -0.4);
place('heron_marsh', 'fishing_spot', -0.6, 0.62);
place('heron_marsh', 'clay_bank', 0.7, 0.1);
place('heron_marsh', 'clay_bank', -0.4, 0.6);
place('heron_marsh', 'driftwood_pile', -0.7, 0.05);
place('heron_marsh', 'driftwood_pile', 0.0, -0.3);
place('heron_marsh', 'boat_wreck', 0.6, -0.4);
place('heron_marsh', 'spruce', 0.05, -0.05);
place('heron_marsh', 'spruce', -0.35, 0.3);
bottle('heron_marsh', 0.45, 0.72, 'bottle_08');

// --- The Narrows ------------------------------------------------------------

place('truss_bridge', 'cache', 0.0, -0.72, {
  id: 'signal_hut', name: 'Signal hut', lootTableId: 'cache_radio_crystal', tool: 'pry_bar',
  description: 'The signalman’s hut at the far end of the deck. The door is rusted shut.',
});
place('truss_bridge', 'junk_heap', 0.1, 0.55);
place('truss_bridge', 'junk_heap', -0.1, -0.2);
place('truss_bridge', 'crate', 0.15, 0.2);
place('truss_bridge', 'boat_wreck', -0.15, -0.5);
place('truss_bridge', 'driftwood_pile', -0.1, 0.75);
placeAfloat('truss_bridge', 'wreck_buoy', 70, -40, {
  name: 'Tug wreck buoy', lootTableId: 'wreck_tackle_locker',
  description: 'Marks a tug on the bottom east of the bridge.',
});
placeAfloat('truss_bridge', 'wreck_buoy', -75, -90, {
  name: 'Launch wreck buoy', lootTableId: 'wreck_engine_bay',
  description: 'Marks a motor launch under the west pier.',
});
placeAfloat('truss_bridge', 'wreck_buoy', 60, -150, {
  name: 'Houseboat wreck buoy', lootTableId: 'wreck_galley',
  description: 'Marks a houseboat that went down with its pantry full.',
});

place('quarry_face', 'stone_outcrop', -0.5, 0.0);
place('quarry_face', 'stone_outcrop', -0.2, 0.1);
place('quarry_face', 'stone_outcrop', 0.1, -0.1);
place('quarry_face', 'stone_outcrop', 0.4, 0.1);
place('quarry_face', 'clay_bank', 0.75, -0.15);
place('quarry_face', 'clay_bank', 0.7, 0.25);
place('quarry_face', 'machinery', 0.55, 0.0, {
  name: 'Rock crusher', lootTableId: 'machinery_crusher',
  description: 'The quarry’s crusher, with its haul cable still rigged.',
});
place('quarry_face', 'shed', 0.3, -0.05);
place('quarry_face', 'spruce', -0.35, -0.1);
place('quarry_face', 'spruce', -0.65, 0.1);
place('quarry_face', 'spruce', 0.0, 0.15);
place('quarry_face', 'fishing_spot', 0.8, -0.2);
bottle('quarry_face', 0.85, 0.05, 'bottle_09');

place('fire_tower_ridge', 'cache', 0.05, 0.0, {
  id: 'lookout', name: 'Lookout alidade', lootTableId: 'cache_beacon_bearing',
  description: 'The sighting ring at the top of the tower. Line it up on the dark shape in the Fog.',
});
place('fire_tower_ridge', 'spruce', -0.3, 0.1);
place('fire_tower_ridge', 'spruce', -0.15, -0.15);
place('fire_tower_ridge', 'spruce', 0.25, 0.12);
place('fire_tower_ridge', 'spruce', 0.45, -0.1);
place('fire_tower_ridge', 'spruce', 0.6, 0.1);
place('fire_tower_ridge', 'berry_bush', -0.65, 0.15);
place('fire_tower_ridge', 'berry_bush', -0.4, -0.2);
place('fire_tower_ridge', 'mushroom_log', -0.7, -0.15);
place('fire_tower_ridge', 'mushroom_log', 0.3, -0.15);
place('fire_tower_ridge', 'rain_barrel', -0.1, 0.1);
place('fire_tower_ridge', 'shed', 0.12, 0.14);
place('fire_tower_ridge', 'fishing_spot', -0.86, 0.12);

place('dam_crest', 'machinery', 0.5, 0.0, {
  name: 'Gatehouse generator', lootTableId: 'machinery_generator',
  description: 'The dam’s standby generator, under a fallen roof.',
});
place('dam_crest', 'machinery', 0.3, 0.1, {
  name: 'Sluice motor', lootTableId: 'machinery_motor',
  description: 'The motor that once lifted the sluice gate.',
});
place('dam_crest', 'crate', -0.2, 0.1);
place('dam_crest', 'crate', 0.1, -0.1);
place('dam_crest', 'junk_heap', -0.45, 0.0);
place('dam_crest', 'fishing_spot', -0.7, 0.3);
bottle('dam_crest', 0.75, -0.1, 'bottle_10');
placeAfloat('dam_crest', 'wreck_buoy', 40, 55, {
  name: 'Barge wreck buoy', lootTableId: 'wreck_sail_locker',
  description: 'Marks a work barge pinned against the dam.',
});

// --- The Fog ----------------------------------------------------------------

place('the_beacon', 'beacon_lamp', 0.0, 0.0, { id: 'lamp' });
place('the_beacon', 'spruce', -0.3, 0.4);
place('the_beacon', 'spruce', 0.35, 0.35);
place('the_beacon', 'stone_outcrop', 0.2, 0.2);
place('the_beacon', 'berry_bush', -0.2, 0.62);
place('the_beacon', 'rain_barrel', 0.12, 0.45);

/** Every placed scavenge node in the valley. */
export const NODES: NodeDefinition[] = placed;

export const NODES_BY_ID: Record<string, NodeDefinition> = Object.fromEntries(
  placed.map((definition) => [definition.id, definition]),
);

export const NODES_BY_ISLAND: Record<IslandId, NodeDefinition[]> = Object.fromEntries(
  Object.keys(ISLANDS_BY_ID).map((islandId) => [islandId, placed.filter((definition) => definition.islandId === islandId)]),
) as Record<IslandId, NodeDefinition[]>;

/** Node ids the quests and the bot refer to by name. */
export const NODE_IDS = {
  atticChest: 'cabin_roofs.attic_chest',
  toolRack: 'the_boathouse.tool_rack',
  locker: 'the_boathouse.locker',
  surveyorCase: 'silo_twins.surveyor_case',
  struckRock: 'pylon_line.struck_rock',
  signalHut: 'truss_bridge.signal_hut',
  lookout: 'fire_tower_ridge.lookout',
  beaconLamp: 'the_beacon.lamp',
} as const;
