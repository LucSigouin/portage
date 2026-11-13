import type { FlagId, ItemAmount, ItemId, NpcId, ObjectiveDefinition, QuestDefinition, QuestId } from './types.ts';
import { NODE_IDS } from './nodes.ts';

const amount = (itemId: ItemId, count: number): ItemAmount => ({ itemId, count });

function mainQuest(
  order: number,
  id: QuestId,
  name: string,
  description: string,
  objectives: ObjectiveDefinition[],
  rewardItems: ItemAmount[] = [],
  rewardFlags: FlagId[] = [],
): QuestDefinition {
  return {
    id, name, description, iconId: `quest_${id}`, kind: 'main', order, giver: null,
    requiresQuests: [], autoStart: true, autoComplete: true, hiddenUntilProgress: false,
    objectives, rewards: { items: rewardItems, flags: rewardFlags },
  };
}

function sideQuest(
  id: QuestId,
  name: string,
  giver: NpcId | null,
  description: string,
  objectives: ObjectiveDefinition[],
  rewardItems: ItemAmount[],
  requiresQuests: QuestId[] = [],
): QuestDefinition {
  const collection = giver === null;
  return {
    id, name, description, iconId: `quest_${id}`, kind: 'side', order: 0, giver,
    requiresQuests, autoStart: collection, autoComplete: collection, hiddenUntilProgress: collection,
    objectives, rewards: { items: rewardItems, flags: [] },
  };
}

/** The main line, in order. It is also the tutorial. */
export const MAIN_QUESTS: QuestDefinition[] = [
  mainQuest(1, 'bail_out', 'Bail out',
    'The canoe is half full and still filling. Bail it, then get ashore.',
    [
      { type: 'bail', waterAtMost: 10, text: 'Bail the canoe nearly dry' },
      { type: 'land', islandId: 'home_knoll', text: 'Land on Home Knoll' },
    ],
    [amount('berries', 4), amount('clean_water', 2)]),
  mainQuest(2, 'first_haul', 'First haul',
    'Everything starts with an edge. Gather what the knoll offers and make a knife.',
    [
      { type: 'have_item', itemId: 'driftwood', count: 3, text: 'Gather driftwood' },
      { type: 'have_item', itemId: 'fiber', count: 4, text: 'Pull cattail fiber' },
      { type: 'have_tool', toolId: 'stone_knife', text: 'Make a stone knife' },
    ],
    [amount('rope', 1)]),
  mainQuest(3, 'stop_the_leak', 'Stop the leak',
    // Words only (the master review of round 3, finding 5): any birch gives bark, Home Knoll's too, so the card names
    // Birch Islet as the place thick with birch and no longer as the only place.
    'Gum from the spruce, bark from any birch. Birch Islet, across the water, is thick with them. Cook pitch and patch the seams.',
    [
      { type: 'have_item', itemId: 'spruce_gum', count: 4, text: 'Scrape spruce gum' },
      { type: 'have_item', itemId: 'birch_bark', count: 3, text: 'Peel birch bark, plenty on Birch Islet' },
      { type: 'craft', itemIds: ['pitch'], count: 2, text: 'Cook pitch at the campfire' },
      { type: 'hull', tier: 1, text: 'Patch the hull' },
    ],
    [amount('cooked_fish', 1)]),
  mainQuest(4, 'something_to_eat', 'Something to eat',
    'A dry boat is no use to a hungry paddler. Forage, boil water, cook, and sleep.',
    [
      { type: 'have_item', itemId: 'cattail_root', count: 2, text: 'Forage cattail roots' },
      { type: 'craft', itemIds: ['clean_water'], count: 1, text: 'Boil water' },
      { type: 'craft', itemIds: ['roast_roots', 'cooked_fish', 'stew'], count: 1, text: 'Cook a meal' },
      { type: 'sleep', text: 'Sleep at the lean-to' },
    ]),
  mainQuest(5, 'a_proper_edge', 'A proper edge',
    'There is a hatchet head in an attic at Cabin Roofs. Give it a handle.',
    [
      { type: 'have_item', itemId: 'hatchet_head', count: 1, madeInto: { toolId: 'hatchet' }, text: 'Find the hatchet head at Cabin Roofs' },
      { type: 'have_tool', toolId: 'hatchet', text: 'Make the hatchet' },
    ]),
  mainQuest(6, 'ribs_and_rails', 'Ribs and rails',
    'The Boathouse has a pry bar and a saw blade. With planks, the hull can take new ribs.',
    [
      { type: 'have_tool', toolId: 'pry_bar', text: 'Take the pry bar from the Boathouse' },
      { type: 'have_tool', toolId: 'saw', text: 'Find the saw blade and build the saw' },
      { type: 'have_tool', toolId: 'hammer', text: 'Make a hammer' },
      { type: 'hull', tier: 2, text: 'Rib the hull' },
    ],
    [amount('nails', 4)]),
  mainQuest(7, 'steady_now', 'Steady now',
    'The Reach will swamp a bare canoe. Build an outrigger, then cross.',
    [
      { type: 'attachment', attachmentId: 'outrigger_port', text: 'Build the port outrigger' },
      { type: 'enter_region', regionId: 'reach', text: 'Cross into the Reach' },
    ]),
  mainQuest(8, 'the_bellkeeper', 'The bellkeeper',
    'A bell rings from Steeple Rock. Whoever keeps it knows how to sew.',
    [
      { type: 'land', islandId: 'steeple_rock', text: 'Land on Steeple Rock' },
      { type: 'talk', npcId: 'wren', text: 'Meet Wren' },
      { type: 'have_item', itemId: 'sailcloth', count: 2, madeInto: { attachmentId: 'mast_sail' }, text: 'Sew sailcloth' },
    ]),
  mainQuest(9, 'catch_the_wind', 'Catch the wind',
    'Step a mast, hang a rudder, and let the wind work.',
    [
      { type: 'attachment', attachmentId: 'mast_sail', text: 'Build the mast and sail' },
      { type: 'attachment', attachmentId: 'rudder', text: 'Build the rudder' },
    ]),
  mainQuest(10, 'voices', 'Voices',
    'Tink says a radio would hear the Beacon. Coil, battery and wire from the Reach, a crystal from the far end of the Truss Bridge, and a hull long enough to carry it.',
    [
      { type: 'talk', npcId: 'tink', text: 'Meet Tink at Scrapyard Bar' },
      { type: 'have_item', itemId: 'copper_coil', count: 1, madeInto: { attachmentId: 'radio' }, text: 'Strip a copper coil' },
      { type: 'have_item', itemId: 'battery', count: 1, madeInto: { attachmentId: 'radio' }, text: 'Find a battery' },
      { type: 'have_item', itemId: 'radio_crystal', count: 1, madeInto: { attachmentId: 'radio' }, text: 'Find the radio crystal on the Truss Bridge' },
      { type: 'hull', tier: 3, text: 'Build the long hull' },
      { type: 'attachment', attachmentId: 'radio', text: 'Build the radio' },
    ]),
  mainQuest(11, 'through_the_narrows', 'Through the Narrows',
    'A second outrigger for the standing waves, a lantern for the Fog, and a bearing from the fire tower.',
    [
      { type: 'attachment', attachmentId: 'outrigger_starboard', text: 'Build the starboard outrigger' },
      { type: 'attachment', attachmentId: 'lantern_mast', text: 'Build the lantern mast' },
      { type: 'land', islandId: 'fire_tower_ridge', text: 'Land on Fire Tower Ridge' },
      { type: 'have_item', itemId: 'beacon_bearing', count: 1, text: 'Take a bearing from the lookout' },
    ]),
  mainQuest(12, 'the_beacon', 'The Beacon',
    'It is a long climb up High Ridge. Stock the hull, cross the Fog, and light the Beacon.',
    [
      { type: 'stock', stockFood: 6, cleanWater: 6, text: 'Stock 6 stock food and 6 clean water in the cargo' },
      { type: 'land', islandId: 'the_beacon', text: 'Cross the Fog to the Beacon' },
      { type: 'node', nodeId: NODE_IDS.beaconLamp, text: 'Light the Beacon' },
    ],
    [], ['beacon_lit']),
];

export const SIDE_QUESTS: QuestDefinition[] = [
  sideQuest('odile_windfall', 'Windfall', 'odile',
    'Odile cannot reach the high branches any more. Bring her apples.',
    [{ type: 'deliver', itemId: 'apple', count: 6, text: 'Bring Odile 6 apples' }],
    [amount('seeds', 4), amount('glass_jar', 2)]),
  sideQuest('odile_something_sweet', 'Something sweet', 'odile',
    'Odile’s jars are empty. She would like two filled.',
    [{ type: 'deliver', itemId: 'jam', count: 2, text: 'Bring Odile 2 jars of jam' }],
    [amount('glass_jar', 3), amount('cloth', 2)], ['odile_windfall']),
  sideQuest('odile_garden_afloat', 'A garden afloat', 'odile',
    'Odile wants to know her seeds are growing somewhere. Build the planter.',
    [{ type: 'attachment', attachmentId: 'planter', text: 'Build the planter' }],
    [amount('seeds', 4), amount('dried_apple', 2)], ['odile_windfall']),
  sideQuest('wren_bell_rope', 'The bell rope', 'wren',
    'The bell rope has frayed through. Wren needs four good lengths.',
    [{ type: 'deliver', itemId: 'rope', count: 4, text: 'Bring Wren 4 rope' }],
    [amount('signal_flag', 1), amount('cloth', 3)], ['the_bellkeeper']),
  sideQuest('tink_hot_work', 'Hot work', 'tink',
    'Tink will part with her old bellows for fuel and stock.',
    [
      { type: 'deliver', itemId: 'charcoal', count: 4, text: 'Bring Tink 4 charcoal' },
      { type: 'deliver', itemId: 'scrap_metal', count: 6, text: 'Bring Tink 6 scrap metal' },
    ],
    [amount('bellows', 1)]),
  sideQuest('tink_heavy_lifting', 'Heavy lifting', 'tink',
    'Tink wants to see a winch that works. Build one and haul something up.',
    [
      { type: 'attachment', attachmentId: 'winch', text: 'Build the winch' },
      { type: 'caches', count: 1, text: 'Haul up a sunken cache' },
    ],
    [amount('carved_figurehead', 1), amount('hardware', 2)], ['tink_hot_work']),
  sideQuest('ten_bottles', 'Ten bottles', null,
    'Someone has been corking notes and throwing them in. Find all ten.',
    [{ type: 'bottles', count: 10, text: 'Find message bottles' }],
    [amount('smoked_fish', 4), amount('steel_cable', 1)]),
  sideQuest('full_rack', 'A full rack', null,
    'A smoker is only earning its keep when every hook is full.',
    [{ type: 'smoke', count: 8, text: 'Smoke 8 fish or apples' }],
    [amount('charcoal', 6), amount('glass_jar', 2)]),
  sideQuest('every_last_one', 'Every last one', null,
    'Four buoys mark four wrecks. Bring up all of them.',
    [{ type: 'caches', count: 4, text: 'Haul up every sunken cache' }],
    [amount('battery', 1), amount('copper_coil', 1), amount('hardware', 4)]),
];

export const QUEST_LIST: QuestDefinition[] = [...MAIN_QUESTS, ...SIDE_QUESTS];

export const QUESTS: Record<QuestId, QuestDefinition> = Object.fromEntries(
  QUEST_LIST.map((definition) => [definition.id, definition]),
) as Record<QuestId, QuestDefinition>;

export const QUEST_IDS: QuestId[] = QUEST_LIST.map((definition) => definition.id);
