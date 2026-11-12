import type { EdibleEffect, ItemCategory, ItemDefinition, ItemId, StationDefinition, StationId, ToolId } from './types.ts';

function item(
  id: ItemId,
  name: string,
  category: ItemCategory,
  description: string,
  edible: EdibleEffect | null = null,
  isDrink = false,
): ItemDefinition {
  return { id, name, description, iconId: `item_${id}`, category, edible, isDrink };
}

const food = (hunger: number, thirst = 0, energy = 0): EdibleEffect => ({ hunger, thirst, energy });

const ITEM_LIST: ItemDefinition[] = [
  // raw
  item('driftwood', 'Driftwood', 'raw', 'Grey, dry, and everywhere. Handles, fuel, shims.'),
  item('log', 'Spruce log', 'raw', 'A straight length of spruce, ready for the saw.'),
  item('birch_bark', 'Birch bark', 'raw', 'Peels off in sheets. Waterproof once pitched down.'),
  item('spruce_gum', 'Spruce gum', 'raw', 'Sticky resin scraped from a wounded spruce.'),
  item('fiber', 'Cattail fiber', 'raw', 'Tough leaves that twist into cord.'),
  item('stone', 'Stone', 'raw', 'A fist of Shield granite with one good edge.'),
  item('clay', 'Clay', 'raw', 'Grey bank clay. Lines a firebox, seals a smoker.'),
  item('scrap_metal', 'Scrap metal', 'raw', 'Bent roofing, hinges, pipe. The forge sorts it out.'),
  item('nails', 'Nails', 'raw', 'Pulled straight enough to use again.'),
  item('wire', 'Wire', 'raw', 'Copper strand in cracked insulation.'),
  item('cloth', 'Cloth', 'raw', 'Curtains, sheets, a coat lining. Dry is what counts.'),
  item('rope', 'Rope', 'raw', 'Three-strand cord. Lashes anything to anything.'),
  item('glass_jar', 'Glass jar', 'raw', 'A canning jar with its lid. Rarer than you would think.'),
  item('tin_can', 'Tin can', 'raw', 'Empty, clean enough, and it holds a flame.'),
  item('seeds', 'Seeds', 'raw', 'A paper twist of garden seed.'),
  item('copper_coil', 'Copper coil', 'raw', 'A motor winding, unwound just enough to tune.'),
  item('battery', 'Battery', 'raw', 'Heavy, sealed, and still holding a charge.'),
  item('steel_cable', 'Steel cable', 'raw', 'Braided line that will not stretch or snap.'),
  // unique finds
  item('hatchet_head', 'Hatchet head', 'unique', 'Rust on the cheeks, steel underneath. Needs a handle.'),
  item('saw_blade', 'Saw blade', 'unique', 'A rip-saw blade wrapped in oilcloth.'),
  item('lens', 'Lens', 'unique', 'A surveyor’s glass, clear as lake ice.'),
  item('lodestone', 'Lodestone', 'unique', 'A dark stone that tugs at nails. It knows north.'),
  item('radio_crystal', 'Radio crystal', 'unique', 'A sliver of galena in a brass cup.'),
  // raw food and water
  item('berries', 'Berries', 'food', 'Tart and blue. A handful takes the edge off.', food(5, 2)),
  item('apple', 'Apple', 'food', 'Small, hard, sweet at the core.', food(8, 3)),
  item('cattail_root', 'Cattail root', 'food', 'Starchy and stringy raw. Better roasted.', food(4)),
  item('mushroom', 'Mushroom', 'food', 'A brown cap from a rotting log. The safe kind.', food(5)),
  item('raw_fish', 'Raw fish', 'food', 'A perch, still cold. Cook it.', food(6, 0, -4)),
  item('dirty_water', 'Dirty water', 'food', 'Flood water. Boil it, or pay for it later.', food(0, 15, -12), true),
  // refined
  item('plank', 'Plank', 'refined', 'Sawn spruce board. Ribs, decks, rails.'),
  item('pitch', 'Pitch', 'refined', 'Cooked gum. Black, hot, and watertight when it sets.'),
  item('charcoal', 'Charcoal', 'refined', 'Burns hotter and cleaner than wood.'),
  item('sailcloth', 'Sailcloth', 'refined', 'Cloth doubled and stitched to hold a wind.'),
  item('metal_sheet', 'Metal sheet', 'refined', 'Scrap hammered flat at the forge.'),
  item('hardware', 'Hardware', 'refined', 'Bolts, brackets and pins, forged to fit.'),
  item('clean_water', 'Clean water', 'refined', 'Boiled or fallen from the sky. Safe to drink.', food(0, 40), true),
  item('cooked_fish', 'Cooked fish', 'refined', 'Crisp skin, white flakes. A proper meal.', food(28, 2)),
  item('roast_roots', 'Roast roots', 'refined', 'Cattail roots baked soft in the coals.', food(20)),
  item('stew', 'Stew', 'refined', 'Fish, roots and mushroom in one pot. Fills you twice.', food(45, 40, 5)),
  // stock food
  item('smoked_fish', 'Smoked fish', 'stock', 'Keeps for the long crossing. Tastes of the smoker.', food(40, 0)),
  item('jam', 'Jam', 'stock', 'Berries boiled down and sealed in a jar.', food(35, 5)),
  item('dried_apple', 'Dried apple', 'stock', 'Leathery rings that travel well.', food(30, 0)),
  // tools
  item('bailing_can', 'Bailing can', 'tool', 'A coffee can with a wire handle. Bails the canoe and scoops water.'),
  item('stone_knife', 'Stone knife', 'tool', 'A flaked edge on a driftwood grip. Cuts bark and cord.'),
  item('hatchet', 'Hatchet', 'tool', 'Fells a spruce in a dozen strokes.'),
  item('pry_bar', 'Pry bar', 'tool', 'Opens crates, lockers and anything nailed shut.'),
  item('saw', 'Saw', 'tool', 'Turns logs into planks at a bench.'),
  item('hammer', 'Hammer', 'tool', 'Drives nails. Nothing gets bolted on without it.'),
  item('fishing_rod', 'Fishing rod', 'tool', 'A springy pole, a line and a bent-nail hook.'),
  item('wrench', 'Wrench', 'tool', 'Tink’s spare. Strips machinery down to the useful parts.'),
  // quest items
  item('beacon_bearing', 'Beacon bearing', 'quest', 'The compass line from the fire tower to the Beacon.'),
  item('bellows', 'Bellows', 'quest', 'Tink’s old forge bellows, patched and tight.'),
  item('signal_flag', 'Signal flag', 'quest', 'Wren’s red pennant, sewn from the steeple banner.'),
  item('carved_figurehead', 'Carved figurehead', 'quest', 'A loon with its neck stretched, cut from cedar by Tink.'),
];

export const ITEMS: Record<ItemId, ItemDefinition> = Object.fromEntries(
  ITEM_LIST.map((definition) => [definition.id, definition]),
) as Record<ItemId, ItemDefinition>;

export const ITEM_IDS: ItemId[] = ITEM_LIST.map((definition) => definition.id);

export const TOOL_IDS: ToolId[] = [
  'bailing_can', 'stone_knife', 'hatchet', 'pry_bar', 'saw', 'hammer', 'fishing_rod', 'wrench',
];

export const STOCK_FOOD_IDS: ItemId[] = ITEM_LIST
  .filter((definition) => definition.category === 'stock')
  .map((definition) => definition.id);

/** True for items that sit in a backpack or cargo slot. */
export function isStackable(itemId: ItemId): boolean {
  const category = ITEMS[itemId].category;
  return category !== 'tool' && category !== 'unique' && category !== 'quest';
}

export const STATIONS: Record<StationId, StationDefinition> = {
  hands: { id: 'hands', name: 'Hands', description: 'Anything you can make sitting on a rock.', iconId: 'station_hands' },
  fire: { id: 'fire', name: 'Fire', description: 'A campfire or the firebox aboard. Cooks, boils and renders.', iconId: 'station_fire' },
  bench: { id: 'bench', name: 'Bench', description: 'The stump bench or the workbench aboard. Sawing and sewing.', iconId: 'station_bench' },
  smoker: { id: 'smoker', name: 'Smoker', description: 'A clay smoke box on the port deck. Makes food that keeps.', iconId: 'station_smoker' },
  forge: { id: 'forge', name: 'Forge', description: 'Tink’s hearth or the forge aboard. Turns scrap into parts.', iconId: 'station_forge' },
};
