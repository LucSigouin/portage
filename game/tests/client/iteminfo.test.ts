/**
 * What the inventory's info panel says an item is for (Luc, round 4: "when you hover of a item it shows the
 * details"). Every line is read from the game's own tables, so each check here is made against a table too.
 */
import { describe, expect, it } from 'vitest';
import { buildInventoryPanel } from '../../src/client/viewmodels/index.ts';
import { INFO_NAMES_SHOWN, itemInfo, questLines } from '../../src/client/viewmodels/iteminfo.ts';
import { ATTACHMENTS, ATTACHMENT_IDS, HULL_TIERS, ITEMS, ITEM_IDS, LOOT_TABLES, NODE_TYPES, RECIPES, RECIPE_IDS, WILD_KINDS } from '../../src/data/index.ts';
import type { ItemId } from '../../src/data/index.ts';
import { give, newGame, standOn } from '../support.ts';

const lineOf = (itemId: ItemId, lead: string): string | undefined => itemInfo(itemId).uses.find((line) => line.lead === lead)?.text;
const leadsOf = (itemId: ItemId): string[] => itemInfo(itemId).uses.map((line) => line.lead);

describe('what an item is', () => {
  it('names the kind of every item in plain words', () => {
    const known = ['Drink', 'Food', 'Key item', 'Made by the crew', 'Quest item', 'Raw material', 'Stock food', 'Tool'];
    expect([...new Set(ITEM_IDS.map((itemId) => itemInfo(itemId).kind))].sort()).toEqual(known);
    expect(itemInfo('berries').kind).toBe('Food');
    expect(itemInfo('hatchet').kind).toBe('Tool');
    expect(itemInfo('driftwood').kind).toBe('Raw material');
    expect(itemInfo('plank').kind).toBe('Made by the crew');
    expect(itemInfo('lens').kind).toBe('Key item');
    expect(itemInfo('bellows').kind).toBe('Quest item');
    // Food that keeps says so. Anything else that can be eaten or drunk is food or drink, whatever its table
    // calls it: boiled water is made by the crew, and is a drink first.
    expect(itemInfo('jam').kind).toBe('Stock food');
    expect(itemInfo('clean_water').kind).toBe('Drink');
    expect(itemInfo('dirty_water').kind).toBe('Drink');
    expect(itemInfo('stew').kind).toBe('Food');
    for (const itemId of ITEM_IDS) {
      const item = ITEMS[itemId];
      if (item.category === 'stock') expect(itemInfo(itemId).kind, itemId).toBe('Stock food');
      else if (item.edible) expect(itemInfo(itemId).kind, itemId).toBe(item.isDrink ? 'Drink' : 'Food');
      else expect(['Food', 'Drink'], itemId).not.toContain(itemInfo(itemId).kind);
    }
  });

  it('is worked out once an item: the same lines every time', () => {
    expect(itemInfo('plank')).toBe(itemInfo('plank'));
  });
});

describe('what an item is for, read from the tables', () => {
  it('says what eating or drinking it does, with the table\'s own numbers', () => {
    const berries = ITEMS.berries.edible!;
    expect(lineOf('berries', 'Eat it')).toBe(`Hunger +${berries.hunger}, thirst +${berries.thirst}`);
    const water = ITEMS.clean_water.edible!;
    expect(lineOf('clean_water', 'Drink it')).toContain(`hirst +${water.thirst}`);
    // What is no food has no such line.
    expect(leadsOf('plank')).not.toContain('Eat it');
    expect(leadsOf('plank')).not.toContain('Drink it');
    // A loss shows its sign: nothing is hidden about dirty water.
    for (const itemId of ITEM_IDS) {
      const edible = ITEMS[itemId].edible;
      if (!edible) continue;
      const text = lineOf(itemId, ITEMS[itemId].isDrink ? 'Drink it' : 'Eat it')!;
      for (const [name, value] of [['hunger', edible.hunger], ['thirst', edible.thirst], ['energy', edible.energy]] as const) {
        if (value !== 0) expect(text.toLowerCase(), itemId).toContain(`${name} ${value > 0 ? '+' : '-'}${Math.abs(value)}`);
        else expect(text.toLowerCase(), itemId).not.toContain(name);
      }
    }
  });

  it('says where it is found: every kind of spot whose loot can hold it', () => {
    const spots = [...Object.values(NODE_TYPES), ...Object.values(WILD_KINDS)];
    const giving = (itemId: ItemId): string[] => [...new Set(spots.filter((kind) => kind.actions.some((action) => {
      const loot = LOOT_TABLES[action.lootTableId]!;
      return [...loot.guaranteed, ...loot.pool].some((entry) => entry.itemId === itemId);
    })).map((kind) => kind.name))];
    expect(giving('berries').length).toBeGreaterThan(0);
    expect(lineOf('berries', 'Found at')).toBe(giving('berries').join(', '));
    let found = 0;
    for (const itemId of ITEM_IDS) {
      const names = giving(itemId);
      const text = lineOf(itemId, 'Found at');
      if (names.length === 0) expect(text, itemId).toBeUndefined();
      else {
        found += 1;
        expect(text!.startsWith(names.slice(0, INFO_NAMES_SHOWN).join(', ')), itemId).toBe(true);
      }
    }
    expect(found).toBeGreaterThan(10);
    // What is only ever made has no such line.
    expect(lineOf('pitch', 'Found at')).toBeUndefined();
  });

  it('says what a tool works on, verb by verb', () => {
    expect(lineOf('hatchet', 'Chop')).toBe('Spruce, Pine');
    for (const kind of [...Object.values(NODE_TYPES), ...Object.values(WILD_KINDS)]) {
      for (const action of kind.actions) {
        if (action.tool) expect(lineOf(action.tool, action.verb), `${action.tool} ${action.verb}`).toBeDefined();
      }
    }
  });

  it('says what it is made from and where, what it makes, and what it builds', () => {
    const recipe = RECIPE_IDS.map((recipeId) => RECIPES[recipeId]).find((candidate) => candidate.output.itemId === 'pitch')!;
    const inputs = recipe.inputs.map((entry) => `${entry.count} x ${ITEMS[entry.itemId].name}`).join(', ');
    expect(lineOf('pitch', 'Made from')).toBe(`${inputs}, at the fire`);
    expect(lineOf('hatchet', 'Made from')).toMatch(/, by hand$/);
    // Every recipe's input says it makes the output, every build's cost says it builds the piece.
    for (const recipeId of RECIPE_IDS) {
      const made = ITEMS[RECIPES[recipeId].output.itemId].name;
      for (const input of RECIPES[recipeId].inputs) {
        const makes = lineOf(input.itemId, 'Makes')!;
        expect(makes.includes(made) || / and \d+ more$/.test(makes), `${input.itemId} makes ${made}`).toBe(true);
      }
    }
    for (const piece of [...HULL_TIERS, ...ATTACHMENT_IDS.map((attachmentId) => ATTACHMENTS[attachmentId])]) {
      for (const cost of piece.cost) {
        const builds = lineOf(cost.itemId, 'Builds')!;
        expect(builds.includes(piece.name) || / and \d+ more$/.test(builds), `${cost.itemId} builds ${piece.name}`).toBe(true);
      }
    }
    expect(lineOf('hatchet', 'Needed to build')).toContain('Mast and sail');
  });

  it('keeps every line short: a few names, then how many more', () => {
    let capped = 0;
    for (const itemId of ITEM_IDS) {
      for (const line of itemInfo(itemId).uses) {
        expect(line.lead.length, `${itemId} ${line.lead}`).toBeGreaterThan(0);
        expect(line.text.length, `${itemId} ${line.lead}`).toBeGreaterThan(0);
        if (line.lead === 'Made from' || line.lead === 'Eat it' || line.lead === 'Drink it') continue;
        const more = / and (\d+) more$/.exec(line.text);
        const names = line.text.replace(/ and \d+ more$/, '').split(', ');
        expect(names.length, `${itemId} ${line.lead}`).toBeLessThanOrEqual(INFO_NAMES_SHOWN);
        if (more) {
          capped += 1;
          expect(names.length).toBe(INFO_NAMES_SHOWN);
          expect(Number(more[1])).toBeGreaterThan(0);
        }
      }
      // A card of at most eight lines: it fits the panel without a scroll.
      expect(itemInfo(itemId).uses.length, itemId).toBeLessThanOrEqual(8);
    }
    expect(INFO_NAMES_SHOWN).toBe(4);
    expect(capped, 'some item makes or builds more than four things').toBeGreaterThan(0);
  });
});

describe('what the crew\'s quests ask of it', () => {
  it('lists an open quest\'s step that asks for the item, and not a quest that is not open', () => {
    const state = newGame();
    expect(state.quests.first_haul.status).not.toBe('active');
    expect(questLines(state, 'driftwood')).toEqual([]);
    state.quests.first_haul.status = 'active';
    expect(questLines(state, 'driftwood')).toEqual([{ lead: 'Quest', text: 'First haul. Gather driftwood' }]);
    expect(questLines(state, 'fiber')).toEqual([{ lead: 'Quest', text: 'First haul. Pull cattail fiber' }]);
    // A tool a step asks for, and nothing for an item no step names.
    expect(questLines(state, 'stone_knife')).toEqual([{ lead: 'Quest', text: 'First haul. Make a stone knife' }]);
    expect(questLines(state, 'clay')).toEqual([]);
    state.quests.first_haul.status = 'completed';
    expect(questLines(state, 'driftwood')).toEqual([]);
  });

  it('is the first thing the panel says of that item, before what never changes', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    state.quests.first_haul.status = 'active';
    give(state, 'driftwood', 2);
    give(state, 'clay', 2, 'cargo');
    const panel = buildInventoryPanel(state);
    expect(panel.info.driftwood!.uses[0]).toEqual({ lead: 'Quest', text: 'First haul. Gather driftwood' });
    expect(panel.info.driftwood!.uses.slice(1)).toEqual(itemInfo('driftwood').uses);
    expect(panel.info.driftwood!.kind).toBe(itemInfo('driftwood').kind);
    // No open quest asks for clay: the panel's lines are the fixed ones, the very same object.
    expect(panel.info.clay).toBe(itemInfo('clay'));
  });
});

describe('the info the inventory panel carries', () => {
  it('is there for every item on the sheet and for nothing else: the belt, the bag, the key items, the boat', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    give(state, 'berries', 3);
    give(state, 'stone', 30); // two stacks, one entry
    give(state, 'clay', 2, 'cargo');
    give(state, 'hatchet');
    give(state, 'lens');
    const panel = buildInventoryPanel(state);
    expect(Object.keys(panel.info).sort()).toEqual(['bailing_can', 'berries', 'clay', 'hatchet', 'lens', 'stone']);
    for (const [itemId, info] of Object.entries(panel.info)) {
      expect(info!.kind, itemId).toBe(itemInfo(itemId as ItemId).kind);
    }
  });
});
