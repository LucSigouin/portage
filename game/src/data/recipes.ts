import type { FlagId, ItemAmount, ItemId, RecipeDefinition, RecipeId, StationId, ToolId } from './types.ts';

const amount = (itemId: ItemId, count: number): ItemAmount => ({ itemId, count });

function recipe(
  id: RecipeId,
  name: string,
  station: StationId,
  inputs: ItemAmount[],
  output: ItemAmount,
  description: string,
  tools: ToolId[] = [],
  requiresFlag: FlagId | null = null,
): RecipeDefinition {
  return { id, name, description, iconId: `item_${output.itemId}`, station, tools, inputs, output, requiresFlag };
}

const RECIPE_LIST: RecipeDefinition[] = [
  // hands
  recipe('stone_knife', 'Stone knife', 'hands',
    [amount('stone', 2), amount('driftwood', 1), amount('fiber', 2)], amount('stone_knife', 1),
    'Flake a stone and bind it to a grip.'),
  recipe('rope', 'Rope', 'hands',
    [amount('fiber', 3)], amount('rope', 1),
    'Twist cattail fiber into three-strand cord.'),
  recipe('hatchet', 'Hatchet', 'hands',
    [amount('hatchet_head', 1), amount('driftwood', 1), amount('rope', 1)], amount('hatchet', 1),
    'Whittle a handle and lash the head on.', ['stone_knife']),
  recipe('fishing_rod', 'Fishing rod', 'hands',
    [amount('driftwood', 2), amount('rope', 1), amount('nails', 1)], amount('fishing_rod', 1),
    'A pole, a line, and a nail bent into a hook.', ['stone_knife']),
  // fire
  recipe('pitch', 'Pitch', 'fire',
    [amount('spruce_gum', 2), amount('driftwood', 1)], amount('pitch', 1),
    'Melt spruce gum until it runs black.'),
  recipe('charcoal', 'Charcoal', 'fire',
    [amount('log', 1)], amount('charcoal', 2),
    'Smother a burning log and wait.'),
  recipe('charcoal_from_driftwood', 'Charcoal from driftwood', 'fire',
    [amount('driftwood', 3)], amount('charcoal', 1),
    'Driftwood chars thin, but it chars.'),
  recipe('clean_water', 'Boil water', 'fire',
    [amount('dirty_water', 1)], amount('clean_water', 1),
    'A rolling boil makes flood water safe.'),
  recipe('cooked_fish', 'Cooked fish', 'fire',
    [amount('raw_fish', 1)], amount('cooked_fish', 1),
    'Skewer it, turn it once.'),
  recipe('roast_roots', 'Roast roots', 'fire',
    [amount('cattail_root', 2)], amount('roast_roots', 1),
    'Bury the roots in the coals.'),
  recipe('stew', 'Stew', 'fire',
    [amount('raw_fish', 1), amount('mushroom', 1), amount('cattail_root', 1), amount('clean_water', 1)], amount('stew', 1),
    'Everything in the pot. The best meal on the water.'),
  recipe('jam', 'Jam', 'fire',
    [amount('berries', 4), amount('glass_jar', 1)], amount('jam', 1),
    'Boil berries down and seal the jar.'),
  // bench
  recipe('saw', 'Saw', 'bench',
    [amount('saw_blade', 1), amount('driftwood', 1), amount('nails', 2)], amount('saw', 1),
    'Fit the blade to a frame.', ['stone_knife']),
  recipe('hammer', 'Hammer', 'bench',
    [amount('scrap_metal', 2), amount('driftwood', 1), amount('rope', 1)], amount('hammer', 1),
    'A lump of iron wedged and lashed to a handle.'),
  recipe('plank', 'Plank', 'bench',
    [amount('log', 1)], amount('plank', 2),
    'Rip a log into two boards.', ['saw']),
  recipe('sailcloth', 'Sailcloth', 'bench',
    [amount('cloth', 3), amount('fiber', 2)], amount('sailcloth', 1),
    'Wren’s flat seam, doubled over.', [], 'wren_taught_sailcloth'),
  // smoker
  recipe('smoked_fish', 'Smoked fish', 'smoker',
    [amount('raw_fish', 1), amount('driftwood', 1)], amount('smoked_fish', 1),
    'Low smoke, half a day. Keeps for weeks.'),
  recipe('dried_apple', 'Dried apple', 'smoker',
    [amount('apple', 2), amount('driftwood', 1)], amount('dried_apple', 1),
    'Slice into rings and dry over the smoke.'),
  // forge
  recipe('metal_sheet', 'Metal sheet', 'forge',
    [amount('scrap_metal', 3), amount('charcoal', 1)], amount('metal_sheet', 1),
    'Heat the scrap and beat it flat.'),
  recipe('hardware', 'Hardware', 'forge',
    [amount('scrap_metal', 1), amount('nails', 2), amount('charcoal', 1)], amount('hardware', 2),
    'Bolts and brackets from whatever is left.'),
];

export const RECIPES: Record<RecipeId, RecipeDefinition> = Object.fromEntries(
  RECIPE_LIST.map((definition) => [definition.id, definition]),
) as Record<RecipeId, RecipeDefinition>;

export const RECIPE_IDS: RecipeId[] = RECIPE_LIST.map((definition) => definition.id);
