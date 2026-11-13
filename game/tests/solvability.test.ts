import { describe, expect, it } from 'vitest';
import { ITEM_IDS, MAIN_QUESTS, NODE_IDS, RECIPE_IDS } from '../src/data/index.ts';
import { getIslandAccess } from '../src/bot/navigation.ts';
import { analyseReach, findSolvabilityProblems, loadGameData } from '../src/analysis/solvability.ts';

describe('the valley, from its real geometry', () => {
  it('needs stability 1 in the Shallows, 2 in the Reach, 3 in the Narrows, and fog gear for the Beacon', () => {
    const access = getIslandAccess();
    const need = (islandId: keyof typeof access) => [access[islandId].stability, access[islandId].fogGear];
    for (const islandId of ['home_knoll', 'cabin_roofs', 'birch_islet', 'orchard_hill', 'the_boathouse'] as const) expect(need(islandId), islandId).toEqual([1, false]);
    for (const islandId of ['steeple_rock', 'silo_twins', 'pylon_line', 'scrapyard_bar', 'heron_marsh'] as const) expect(need(islandId), islandId).toEqual([2, false]);
    for (const islandId of ['quarry_face', 'fire_tower_ridge', 'dam_crest'] as const) expect(need(islandId), islandId).toEqual([3, false]);
    expect(need('the_beacon')).toEqual([3, true]);
    // The bridge is a Narrows island you can land on from the Reach.
    expect(need('truss_bridge')).toEqual([2, false]);
  });
});

describe('solvability', () => {
  const data = loadGameData();

  it('finds no problem in the shipped tables', () => {
    expect(findSolvabilityProblems(data)).toEqual([]);
  });

  it('can obtain every item, craft every recipe, build every attachment and hull, reach every island', () => {
    const reach = analyseReach(data);
    expect([...reach.items].sort()).toEqual([...ITEM_IDS].sort());
    expect([...reach.recipes].sort()).toEqual([...RECIPE_IDS].sort());
    expect(reach.attachments.size).toBe(22);
    expect(reach.hullTier).toBe(3);
    expect(reach.islands.size).toBe(15);
    expect(reach.stations).toEqual(new Set(['hands', 'fire', 'bench', 'forge', 'smoker']));
    expect(reach.completedQuests.size).toBe(data.quests.length);
    expect(reach.stability).toBe(3);
    expect(reach.fogGear).toBe(true);
  });

  it('completes the main line in order with only what is reachable by then', () => {
    for (const quest of MAIN_QUESTS) {
      const byThen = analyseReach(data, { lastMainQuest: quest.order - 1 });
      // Nothing after this quest has completed yet...
      expect(MAIN_QUESTS.filter((later) => later.order >= quest.order && byThen.completedQuests.has(later.id))).toEqual([]);
      // ...and one more step of the line completes exactly this quest.
      const after = analyseReach(data, { lastMainQuest: quest.order });
      expect(after.completedQuests.has(quest.id), quest.id).toBe(true);
    }
  });

  it('gates each region with gear found before it', () => {
    const shallowsOnly = analyseReach(data, { allowedRegions: ['shallows'] });
    expect(shallowsOnly.stability).toBeGreaterThanOrEqual(2);
    expect(shallowsOnly.attachments.has('outrigger_port')).toBe(true);
    expect(shallowsOnly.fogGear).toBe(false);
    expect(shallowsOnly.items.has('wrench')).toBe(false); // Tink is in the Reach
    const beforeNarrows = analyseReach(data, { allowedRegions: ['shallows', 'reach'] });
    expect(beforeNarrows.stability).toBe(3);
    expect(beforeNarrows.attachments.has('radio')).toBe(false); // the crystal is on the bridge
    const beforeFog = analyseReach(data, { allowedRegions: ['shallows', 'reach', 'narrows'] });
    expect(beforeFog.fogGear).toBe(true);
    expect(beforeFog.islands.has('the_beacon')).toBe(false);
  });

  it('cannot reach the Reach on a bare canoe', () => {
    const noOutriggers = loadGameData();
    noOutriggers.attachments = noOutriggers.attachments.filter((attachment) => !attachment.id.startsWith('outrigger'));
    const reach = analyseReach(noOutriggers);
    expect(reach.stability).toBe(1);
    expect(reach.islands.has('steeple_rock')).toBe(false);
    expect(reach.completedQuests.has('steady_now')).toBe(false);
  });
});

describe('the analysis has teeth: broken tables are caught', () => {
  it('catches a recipe the main line needs going missing', () => {
    const broken = loadGameData();
    broken.recipes = broken.recipes.filter((recipe) => recipe.id !== 'plank');
    const problems = findSolvabilityProblems(broken);
    expect(problems).toContain('item plank cannot be obtained');
    expect(problems).toContain('hull tier 2 cannot be built');
    expect(problems).toContain('main quest 6 (ribs_and_rails): "Rib the hull" cannot be done when the quest starts');
    expect(problems).toContain('quest the_beacon cannot be completed');
  });

  it('catches outriggers that add no stability', () => {
    const broken = loadGameData();
    for (const attachment of broken.attachments) attachment.stabilityBonus = 0;
    const problems = findSolvabilityProblems(broken);
    expect(problems).toContain('main quest 7 (steady_now): "Cross into the Reach" cannot be done when the quest starts');
    expect(problems).toContain('region reach needs stability 2, but only stability 1 without fog gear can be had before it');
    expect(problems).toContain('island steeple_rock cannot be reached');
  });

  it('catches a region that needs something found only beyond it', () => {
    const broken = loadGameData();
    // Move the radio crystal to the Beacon: the Fog would need a radio built from a part inside the Fog.
    const hut = broken.nodes.find((node) => node.id === NODE_IDS.signalHut)!;
    hut.islandId = 'the_beacon';
    const problems = findSolvabilityProblems(broken);
    expect(problems).toContain('item radio_crystal cannot be obtained');
    expect(problems).toContain('region fog needs stability 3 and fog gear, but only stability 3 without fog gear can be had before it');
    expect(problems).toContain('island the_beacon cannot be reached');
  });

  it('catches a tool gate with no tool, a station with no home, and a unique find in short supply', () => {
    const noKnife = loadGameData();
    noKnife.recipes = noKnife.recipes.filter((recipe) => recipe.id !== 'stone_knife');
    expect(findSolvabilityProblems(noKnife)).toContain('item birch_bark cannot be obtained');

    const noForge = loadGameData();
    for (const island of noForge.islands) if (island.camp) island.camp.stations = island.camp.stations.filter((station) => station !== 'forge');
    const forgeProblems = findSolvabilityProblems(noForge);
    expect(forgeProblems).toContain('recipe hardware cannot be crafted');
    expect(forgeProblems).toContain('hull tier 3 cannot be built');

    const greedy = loadGameData();
    greedy.attachments.find((attachment) => attachment.id === 'map_table')!.cost.push({ itemId: 'lens', count: 1 });
    expect(findSolvabilityProblems(greedy)).toContain('only 1 lens exist in the valley but 2 are needed');

    const taught = loadGameData();
    for (const npc of taught.npcs) {
      for (const node of Object.values(npc.nodes)) {
        for (const option of node.options) option.effects = option.effects?.filter((effect) => effect.type !== 'set_flag');
      }
    }
    expect(findSolvabilityProblems(taught)).toContain('recipe sailcloth cannot be crafted');
  });
});
