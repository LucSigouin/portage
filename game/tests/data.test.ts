import { describe, expect, it } from 'vitest';
import {
  ATTACHMENTS, ATTACHMENT_IDS, BOTTLES, BOTTLE_IDS, HULL_TIERS, ISLANDS, ITEMS, ITEM_IDS, LOOT_TABLES,
  MAIN_QUESTS, NODES, NODE_TYPES, NPCS, NPC_IDS, QUESTS, QUEST_LIST, RECIPES, RECIPE_IDS, REGIONS,
  SIDE_QUESTS, STATIONS, STOCK_FOOD_IDS, TOOL_IDS, WEATHER, WEATHER_KINDS, attachmentTransformForHull,
} from '../src/data/index.ts';
import type { ItemId, StationId } from '../src/data/index.ts';

const described = (entry: { id: string; name: string; description: string; iconId: string }): void => {
  expect(entry.id, 'id').toMatch(/^[a-z0-9_.]+$/);
  expect(entry.name.length, `${entry.id} name`).toBeGreaterThan(1);
  expect(entry.description.length, `${entry.id} description`).toBeGreaterThan(8);
  expect(entry.description, `${entry.id} one line`).not.toContain('\n');
  expect(entry.iconId, `${entry.id} icon`).toMatch(/^[a-z0-9_]+$/);
};

describe('every table entry is presentable', () => {
  it('gives items, recipes, hulls, attachments, regions, islands, nodes, quests, survivors and weather an id, name, description and icon', () => {
    const everything = [
      ...ITEM_IDS.map((id) => ITEMS[id]), ...RECIPE_IDS.map((id) => RECIPES[id]), ...HULL_TIERS,
      ...ATTACHMENT_IDS.map((id) => ATTACHMENTS[id]), ...REGIONS, ...ISLANDS, ...Object.values(NODE_TYPES), ...NODES,
      ...QUEST_LIST, ...NPC_IDS.map((id) => NPCS[id]), ...WEATHER_KINDS.map((id) => WEATHER[id]), ...Object.values(STATIONS),
    ];
    expect(everything.length).toBeGreaterThan(300);
    for (const entry of everything) described(entry);
  });

  it('has no duplicate ids', () => {
    for (const ids of [ITEM_IDS, RECIPE_IDS, ATTACHMENT_IDS, NODES.map((node) => node.id), QUEST_LIST.map((quest) => quest.id), ISLANDS.map((island) => island.id)]) {
      expect(new Set<string>(ids).size).toBe(ids.length);
    }
  });
});

describe('items and recipes', () => {
  it('contains every item the brief lists', () => {
    const brief = `driftwood log birch_bark spruce_gum fiber stone clay scrap_metal nails wire cloth rope glass_jar tin_can
      seeds copper_coil battery steel_cable hatchet_head saw_blade pry_bar wrench lens lodestone radio_crystal berries
      apple cattail_root mushroom raw_fish dirty_water plank pitch charcoal sailcloth metal_sheet hardware clean_water
      cooked_fish roast_roots stew smoked_fish jam dried_apple bailing_can stone_knife hatchet saw hammer fishing_rod`
      .split(/\s+/).filter(Boolean);
    for (const itemId of brief) expect(ITEMS[itemId as ItemId], itemId).toBeDefined();
    expect(STOCK_FOOD_IDS.sort()).toEqual(['dried_apple', 'jam', 'smoked_fish']);
    expect([...TOOL_IDS].sort()).toEqual(['bailing_can', 'fishing_rod', 'hammer', 'hatchet', 'pry_bar', 'saw', 'stone_knife', 'wrench']);
  });

  it('makes each thing at the station the brief gives it', () => {
    const made: Record<StationId, string[]> = { hands: [], fire: [], bench: [], smoker: [], forge: [] };
    for (const recipeId of RECIPE_IDS) made[RECIPES[recipeId].station].push(RECIPES[recipeId].output.itemId);
    expect(new Set(made.hands)).toEqual(new Set(['stone_knife', 'rope', 'hatchet', 'fishing_rod']));
    expect(new Set(made.fire)).toEqual(new Set(['pitch', 'charcoal', 'clean_water', 'cooked_fish', 'roast_roots', 'stew', 'jam']));
    expect(new Set(made.bench)).toEqual(new Set(['saw', 'hammer', 'plank', 'sailcloth']));
    expect(new Set(made.smoker)).toEqual(new Set(['smoked_fish', 'dried_apple']));
    expect(new Set(made.forge)).toEqual(new Set(['metal_sheet', 'hardware']));
  });

  it('only refers to items and tools that exist, with positive counts', () => {
    const checkCost = (cost: { itemId: ItemId; count: number }[], label: string): void => {
      for (const entry of cost) {
        expect(ITEMS[entry.itemId], `${label} ${entry.itemId}`).toBeDefined();
        expect(entry.count, label).toBeGreaterThan(0);
      }
    };
    for (const recipeId of RECIPE_IDS) {
      const recipe = RECIPES[recipeId];
      checkCost([...recipe.inputs, recipe.output], recipeId);
      for (const toolId of recipe.tools) expect(TOOL_IDS).toContain(toolId);
    }
    for (const hull of HULL_TIERS) checkCost(hull.cost, hull.id);
    for (const attachmentId of ATTACHMENT_IDS) checkCost(ATTACHMENTS[attachmentId].cost, attachmentId);
    for (const table of Object.values(LOOT_TABLES)) {
      for (const entry of [...table.guaranteed, ...table.pool]) {
        expect(ITEMS[entry.itemId], `${table.id} ${entry.itemId}`).toBeDefined();
        expect(entry.minimum).toBeGreaterThan(0);
        expect(entry.maximum).toBeGreaterThanOrEqual(entry.minimum);
      }
      expect(table.rolls === 0 || table.pool.length > 0, table.id).toBe(true);
    }
    for (const node of NODES) for (const action of node.actions) expect(LOOT_TABLES[action.lootTableId], node.id).toBeDefined();
  });

  it('makes stock food the best food per piece', () => {
    const cooked = Math.max(...(['cooked_fish', 'roast_roots'] as ItemId[]).map((id) => ITEMS[id].edible!.hunger));
    for (const itemId of STOCK_FOOD_IDS) expect(ITEMS[itemId].edible!.hunger).toBeGreaterThan(cooked);
  });
});

describe('the canoe', () => {
  it('has the four hull tiers of the brief', () => {
    expect(HULL_TIERS.map((hull) => hull.cargoSlots)).toEqual([8, 8, 12, 16]);
    expect(HULL_TIERS.map((hull) => hull.leakPerSecond > 0)).toEqual([true, false, false, false]);
    expect(HULL_TIERS[3].speedMultiplier).toBeGreaterThan(HULL_TIERS[2].speedMultiplier);
    expect(HULL_TIERS[3].dimensions.length).toBeGreaterThan(HULL_TIERS[2].dimensions.length);
    // The long hull alone offers the winch's crane, the radio's shack and the sea chest's thwart.
    expect(HULL_TIERS[3].mountIds.length - HULL_TIERS[2].mountIds.length).toBe(3);
    expect(HULL_TIERS[2].tools).toContain('hammer');
    for (const hull of HULL_TIERS) {
      const { length, beam, depth, draft } = hull.dimensions;
      expect(length).toBeGreaterThan(4);
      expect(beam).toBeGreaterThan(0.5);
      expect(draft).toBeLessThan(depth);
    }
  });

  it('gives each of the 22 attachments its own mount on a hull that offers it', () => {
    expect(ATTACHMENT_IDS).toHaveLength(22);
    const mounts = ATTACHMENT_IDS.map((id) => ATTACHMENTS[id].mountId);
    expect(new Set(mounts).size).toBe(22);
    for (const attachmentId of ATTACHMENT_IDS) {
      const attachment = ATTACHMENTS[attachmentId];
      expect(HULL_TIERS[attachment.minimumHullTier].mountIds, attachmentId).toContain(attachment.mountId);
      expect(attachment.minimumHullTier, attachmentId).toBeGreaterThanOrEqual(2);
    }
    expect(ATTACHMENTS.winch.minimumHullTier).toBe(3);
    expect(ATTACHMENTS.radio.minimumHullTier).toBe(3);
    expect(ATTACHMENTS.outrigger_port.stabilityBonus).toBe(1);
    expect(ATTACHMENTS.outrigger_starboard.stabilityBonus).toBe(1);
    expect(ATTACHMENTS.cargo_rack.cargoSlotsBonus).toBe(6);
    expect(ATTACHMENTS.flag.cosmetic && ATTACHMENTS.figurehead.cosmetic).toBe(true);
  });

  it('places attachments inside the hull or on the outrigger decks, none on top of another', () => {
    for (const tier of [2, 3]) {
      const hull = HULL_TIERS[tier];
      const placed = ATTACHMENT_IDS.filter((id) => ATTACHMENTS[id].minimumHullTier <= tier)
        .map((id) => ({ id, position: attachmentTransformForHull(id, tier).position }));
      for (const { id, position: [x, y, z] } of placed) {
        expect(Math.abs(z), `${id} on tier ${tier}`).toBeLessThanOrEqual(hull.dimensions.length / 2 + 0.11);
        expect(Math.abs(x), id).toBeLessThanOrEqual(2);
        expect(y, id).toBeGreaterThan(-0.3);
        expect(y, id).toBeLessThan(1.2);
      }
      for (let first = 0; first < placed.length; first += 1) {
        for (let second = first + 1; second < placed.length; second += 1) {
          const [ax, ay, az] = placed[first].position;
          const [bx, by, bz] = placed[second].position;
          expect(Math.hypot(ax - bx, ay - by, az - bz), `${placed[first].id} / ${placed[second].id}`).toBeGreaterThan(0.25);
        }
      }
    }
  });

  it('slides bow and stern mounts with the ends of a longer hull', () => {
    const growth = (HULL_TIERS[3].dimensions.length - HULL_TIERS[2].dimensions.length) / 2;
    expect(attachmentTransformForHull('lantern_mast', 3).position[2]).toBeCloseTo(ATTACHMENTS.lantern_mast.transform.position[2] - growth, 9);
    expect(attachmentTransformForHull('rudder', 3).position[2]).toBeCloseTo(ATTACHMENTS.rudder.transform.position[2] + growth, 9);
    expect(attachmentTransformForHull('firebox', 3).position).toEqual(ATTACHMENTS.firebox.transform.position);
    expect(ATTACHMENTS.outrigger_port.transform.position[0]).toBe(-ATTACHMENTS.outrigger_starboard.transform.position[0]);
    // Port deck attachments sit to port, starboard deck ones to starboard.
    expect(ATTACHMENTS.workbench.transform.position[0]).toBeLessThan(0);
    expect(ATTACHMENTS.smoker.transform.position[0]).toBeLessThan(0);
    expect(ATTACHMENTS.planter.transform.position[0]).toBeGreaterThan(0);
    expect(ATTACHMENTS.forge.transform.position[0]).toBeGreaterThan(0);
    expect(ATTACHMENTS.workbench.requiresAttachments).toEqual(['outrigger_port']);
    expect(ATTACHMENTS.forge.requiresAttachments).toEqual(['outrigger_starboard']);
  });
});

describe('quests, survivors and bottles', () => {
  it('has a main line of 12 in order and about 8 side quests', () => {
    expect(MAIN_QUESTS.map((quest) => quest.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(SIDE_QUESTS.length).toBeGreaterThanOrEqual(7);
    expect(SIDE_QUESTS.length).toBeLessThanOrEqual(9);
    for (const quest of QUEST_LIST) {
      expect(quest.objectives.length, quest.id).toBeGreaterThan(0);
      for (const objective of quest.objectives) expect(objective.text.length, quest.id).toBeGreaterThan(3);
      for (const required of quest.requiresQuests) expect(QUESTS[required], quest.id).toBeDefined();
      if (quest.giver) expect(NPCS[quest.giver], quest.id).toBeDefined();
    }
    for (const giver of NPC_IDS) expect(SIDE_QUESTS.some((quest) => quest.giver === giver), giver).toBe(true);
  });

  it('points quest objectives at things that exist', () => {
    const nodeIds = new Set(NODES.map((node) => node.id));
    for (const quest of QUEST_LIST) {
      for (const objective of quest.objectives) {
        if (objective.type === 'node') expect(nodeIds.has(objective.nodeId), objective.nodeId).toBe(true);
        if (objective.type === 'land') expect(ISLANDS.some((island) => island.id === objective.islandId)).toBe(true);
        if (objective.type === 'attachment') expect(ATTACHMENTS[objective.attachmentId]).toBeDefined();
        if (objective.type === 'craft') for (const itemId of objective.itemIds) expect(ITEMS[itemId]).toBeDefined();
      }
    }
  });

  it('places each of the ten message bottles exactly once, on ten different islands', () => {
    expect(BOTTLE_IDS).toHaveLength(10);
    const bottleNodes = NODES.filter((node) => node.bottleId !== null);
    expect(bottleNodes.map((node) => node.bottleId).sort()).toEqual([...BOTTLE_IDS].sort());
    expect(new Set(bottleNodes.map((node) => node.islandId)).size).toBe(10);
    for (const bottleId of BOTTLE_IDS) expect(BOTTLES[bottleId].text.length).toBeGreaterThan(60);
  });

  it('has three survivors whose dialogue graphs are sound', () => {
    expect(NPC_IDS).toEqual(['odile', 'wren', 'tink']);
    for (const npcId of NPC_IDS) {
      const npc = NPCS[npcId];
      expect(ISLANDS.some((island) => island.id === npc.islandId)).toBe(true);
      // The last entry is the fallback: it has no condition.
      expect(npc.entries[npc.entries.length - 1].condition, npcId).toBeUndefined();
      const reachable = new Set<string>(npc.entries.map((entry) => entry.nodeId));
      const queue = [...reachable];
      let canEnd = false;
      while (queue.length > 0) {
        const node = npc.nodes[queue.pop()!];
        expect(node, npcId).toBeDefined();
        expect(node.options.length, `${npcId}.${node.id}`).toBeGreaterThan(0);
        // Every node has at least one option with no condition, so no dead ends.
        expect(node.options.some((option) => option.condition === undefined), `${npcId}.${node.id}`).toBe(true);
        for (const option of node.options) {
          if (option.next === null) canEnd = true;
          else if (!reachable.has(option.next)) {
            expect(npc.nodes[option.next], `${npcId}.${node.id} -> ${option.next}`).toBeDefined();
            reachable.add(option.next);
            queue.push(option.next);
          }
          for (const effect of option.effects ?? []) {
            if (effect.type === 'accept_quest' || effect.type === 'turn_in_quest') expect(QUESTS[effect.questId].giver).toBe(npcId);
          }
        }
      }
      expect(canEnd, npcId).toBe(true);
      expect([...reachable].sort(), npcId).toEqual(Object.keys(npc.nodes).sort());
    }
  });
});
