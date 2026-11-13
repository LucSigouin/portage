/**
 * The viewer's guide against the game's own tables. Every item has somewhere to come from, every line names
 * things that exist, and every way the tables give or take an item shows up on its page. The three facts the guide
 * takes from the game's code (starting gear, lake water, what the canoe's gear adds by itself) are held against
 * the running simulation, so a change there turns this red too.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  ATTACHMENTS, ATTACHMENT_IDS, HULL_TIERS, ISLANDS_BY_ID, ITEMS, ITEM_IDS, LOOT_TABLES, NODES, NODES_BY_ID, NODE_TYPES,
  NPCS, NPC_IDS, QUESTS, QUEST_LIST, RECIPES, RECIPE_IDS, STATIONS, TUNING, WILD_KINDS,
} from '../../src/data/index.ts';
import type { IslandId, ItemId, WildKind } from '../../src/data/index.ts';
import { wildIndex } from '../../src/sim/gathering.ts';
import { loadGameData } from '../../src/analysis/solvability.ts';
import { createGame } from '../../src/sim/step.ts';
import { dispatch } from '../../src/sim/commands.ts';
import { updatePassiveAttachments } from '../../src/sim/survival.ts';
import { catalogue } from '../../src/viewer/catalogue.ts';
import {
  ABOARD, LAKE_WATER, STARTING_GEAR, attachmentSections, hullSections, itemGuide, itemSections, nodeSections,
  refillSeconds, resetGuide, spots, waitWords,
} from '../../src/viewer/guide.ts';
import type { GuideLine, GuideRef } from '../../src/viewer/guide.ts';

const refsOf = (lines: GuideLine[]): GuideRef[] => lines.flatMap((line) => line.refs);
const names = (lines: GuideLine[], kind: GuideRef['kind'], id: string): boolean =>
  refsOf(lines).some((ref) => ref.kind === kind && 'id' in ref && ref.id === id);

/** True when the ref is a thing the game's tables hold. */
function real(ref: GuideRef): boolean {
  switch (ref.kind) {
    case 'node': return ref.id in NODE_TYPES;
    case 'placed': return ref.id in NODES_BY_ID;
    case 'wild': return ref.id in WILD_KINDS;
    case 'island': return ref.id in ISLANDS_BY_ID;
    case 'recipe': return ref.id in RECIPES;
    case 'hull': return HULL_TIERS.some((hull) => hull.id === ref.id);
    case 'attachment': return ref.id in ATTACHMENTS;
    case 'quest': return ref.id in QUESTS;
    case 'npc': return ref.id in NPCS;
    case 'item': return ref.id in ITEMS;
    case 'station': return ref.id in STATIONS;
    case 'start': case 'lake': return true;
    default: return false;
  }
}

afterEach(() => resetGuide());

describe('every item has a guide', () => {
  it('every item has at least one place to come from', () => {
    const missing = ITEM_IDS.filter((itemId) => itemGuide(itemId).where.length === 0);
    expect(missing).toEqual([]);
  });

  it('every item has at least one use', () => {
    const missing = ITEM_IDS.filter((itemId) => itemGuide(itemId).usedFor.length === 0);
    expect(missing).toEqual([]);
  });

  it('every line names only things the game has, and every "where" names its source', () => {
    for (const itemId of ITEM_IDS) {
      const guide = itemGuide(itemId);
      for (const line of [...guide.where, ...guide.usedFor]) {
        expect(line.lead.length, `${itemId}: ${line.text}`).toBeGreaterThan(0);
        for (const ref of line.refs) expect(real(ref), `${itemId}: ${JSON.stringify(ref)}`).toBe(true);
      }
      for (const line of [...guide.where, ...guide.usedFor]) expect(line.refs.length, `${itemId}: ${line.lead}`).toBeGreaterThan(0);
    }
    const others = [
      ...Object.keys(NODE_TYPES).flatMap((typeId) => nodeSections(typeId as keyof typeof NODE_TYPES)),
      ...HULL_TIERS.flatMap((hull) => hullSections(hull)),
      ...ATTACHMENT_IDS.flatMap((attachmentId) => attachmentSections(ATTACHMENTS[attachmentId])),
    ];
    for (const ref of others.flatMap((section) => refsOf(section.lines))) expect(real(ref), JSON.stringify(ref)).toBe(true);
  });

  it('the viewer gives a guide to every item icon, scavenge node, hull and attachment', () => {
    const guided = catalogue().filter((entry) => ['icon', 'node', 'hull', 'attachment'].includes(entry.group));
    expect(guided.length).toBe(ITEM_IDS.length + Object.keys(NODE_TYPES).length + HULL_TIERS.length + ATTACHMENT_IDS.length);
    for (const entry of guided) {
      expect(entry.guide, entry.id).toBeDefined();
      expect(entry.guide!().length, entry.id).toBeGreaterThan(0);
    }
    for (const itemId of ITEM_IDS) expect(itemSections(itemId).map((section) => section.title)).toEqual(['Where to find it', 'Used for']);
  });
});

describe('every way the tables give or take an item is on its page', () => {
  it('every placed spot that gives an item is in that item\'s "where"', () => {
    for (const node of NODES) {
      for (const action of node.actions) {
        const table = LOOT_TABLES[action.lootTableId];
        for (const entry of [...table.guaranteed, ...table.pool]) {
          expect(names(itemGuide(entry.itemId).where, 'placed', node.id), `${node.id} gives ${entry.itemId}`).toBe(true);
        }
      }
    }
  });

  it('every wild tree and stone that gives an item is in that item\'s "where", on exactly the islands it stands on', () => {
    const standsOn = new Map<WildKind, Set<IslandId>>();
    for (const wild of wildIndex().nodes) standsOn.set(wild.kind, (standsOn.get(wild.kind) ?? new Set<IslandId>()).add(wild.definition.islandId));
    const named = new Set<ItemId>();
    for (const kind of Object.keys(WILD_KINDS) as WildKind[]) {
      for (const action of WILD_KINDS[kind].actions) {
        const table = LOOT_TABLES[action.lootTableId];
        for (const entry of [...table.guaranteed, ...table.pool]) {
          const line = itemGuide(entry.itemId).where.find((candidate) => candidate.text.startsWith(action.verb)
            && candidate.refs.some((ref) => ref.kind === 'wild' && ref.id === kind));
          expect(line, `${kind} gives ${entry.itemId}`).toBeDefined();
          const islands = line!.refs.flatMap((ref) => (ref.kind === 'island' ? [ref.id] : []));
          expect(new Set(islands), `${kind}: ${line!.text}`).toEqual(standsOn.get(kind));
          for (const islandId of islands) expect(line!.text).toContain(ISLANDS_BY_ID[islandId].name);
          expect(line!.again).toBe(action.respawnDays !== null);
          named.add(entry.itemId);
        }
      }
    }
    // and no item names a wild thing that does not give it
    for (const itemId of ITEM_IDS) {
      for (const line of itemGuide(itemId).where) {
        for (const ref of line.refs) {
          if (ref.kind !== 'wild') continue;
          const gives = WILD_KINDS[ref.id].actions.some((action) => [...LOOT_TABLES[action.lootTableId].guaranteed, ...LOOT_TABLES[action.lootTableId].pool]
            .some((entry) => entry.itemId === itemId));
          expect(gives, `${itemId} names ${ref.id}`).toBe(true);
        }
      }
    }
    console.log(`items whose guide names a wild source: ${named.size} (${[...named].join(', ')})`);
    expect(named.size).toBeGreaterThan(0);
  });

  it('names the wild sources a player would find by looking: three checked by hand', () => {
    const line = (itemId: ItemId, lead: string): GuideLine | undefined => itemGuide(itemId).where.find((candidate) => candidate.lead === lead);
    // Home Knoll's own birches peel, so bark is no longer Birch Islet's alone.
    const bark = line('birch_bark', 'Any birch');
    expect(bark?.text).toMatch(/^Peel with the stone knife\. Always 2 to 3\./);
    expect(bark?.text).toContain('Home Knoll');
    expect(bark?.text).toContain('most on Birch Islet');
    // A pine gives logs with the hatchet, and no gum; none grow on Birch Islet.
    const pine = line('log', 'Any pine');
    expect(pine?.text).toMatch(/^Chop with the hatchet\. Always 3\./);
    expect(pine?.text).not.toContain('Birch Islet');
    expect(line('spruce_gum', 'Any pine')).toBeUndefined();
    // Crags stand on the high ground only.
    const crag = line('stone', 'Any crag');
    expect(crag?.refs.flatMap((ref) => (ref.kind === 'island' ? [ref.id] : []))).toEqual(['quarry_face', 'fire_tower_ridge', 'the_beacon']);
  });

  it('a spot\'s own page names the wild ones of its kind, and a tool\'s page every wild kind it works', () => {
    for (const kind of Object.keys(WILD_KINDS) as WildKind[]) {
      const { typeId, name, actions } = WILD_KINDS[kind];
      const wild = nodeSections(typeId).find((section) => section.title === 'And in the wild');
      expect(wild && names(wild.lines, 'wild', kind), `${typeId} page names ${kind}`).toBe(true);
      for (const action of actions) {
        if (action.tool) expect(itemGuide(action.tool).usedFor.some((candidate) => candidate.lead === name), `${action.tool} works ${kind}`).toBe(true);
      }
    }
  });

  it('every recipe is in its output\'s "where" and in every input\'s and tool\'s "used for"', () => {
    for (const recipeId of RECIPE_IDS) {
      const recipe = RECIPES[recipeId];
      expect(names(itemGuide(recipe.output.itemId).where, 'recipe', recipeId), recipeId).toBe(true);
      for (const itemId of [...recipe.inputs.map((entry) => entry.itemId), ...recipe.tools]) {
        expect(names(itemGuide(itemId).usedFor, 'recipe', recipeId), `${recipeId} uses ${itemId}`).toBe(true);
      }
    }
  });

  it('every hull and attachment is in the "used for" of what it costs and the tools it needs', () => {
    for (const hull of HULL_TIERS) {
      for (const itemId of [...hull.cost.map((entry) => entry.itemId), ...hull.tools]) expect(names(itemGuide(itemId).usedFor, 'hull', hull.id), `${hull.id} uses ${itemId}`).toBe(true);
    }
    for (const attachmentId of ATTACHMENT_IDS) {
      const attachment = ATTACHMENTS[attachmentId];
      for (const itemId of [...attachment.cost.map((entry) => entry.itemId), ...attachment.tools]) {
        expect(names(itemGuide(itemId).usedFor, 'attachment', attachmentId), `${attachmentId} uses ${itemId}`).toBe(true);
      }
    }
  });

  it('every quest reward and every survivor\'s gift is in the item\'s "where"', () => {
    for (const quest of QUEST_LIST) {
      for (const reward of quest.rewards.items) expect(names(itemGuide(reward.itemId).where, 'quest', quest.id), `${quest.id} gives ${reward.itemId}`).toBe(true);
    }
    for (const npcId of NPC_IDS) {
      for (const node of Object.values(NPCS[npcId].nodes)) {
        for (const effect of node.options.flatMap((option) => option.effects ?? [])) {
          if (effect.type !== 'give_items') continue;
          for (const given of effect.items) expect(names(itemGuide(given.itemId).where, 'npc', npcId), `${npcId} gives ${given.itemId}`).toBe(true);
        }
      }
    }
  });

  it('every quest step that asks for an item is in its "used for"', () => {
    for (const quest of QUEST_LIST) {
      for (const objective of quest.objectives) {
        const asked: ItemId[] = objective.type === 'have_item' || objective.type === 'deliver' ? [objective.itemId]
          : objective.type === 'have_tool' ? [objective.toolId]
            : objective.type === 'craft' ? objective.itemIds : [];
        for (const itemId of asked) expect(names(itemGuide(itemId).usedFor, 'quest', quest.id), `${quest.id} asks for ${itemId}`).toBe(true);
      }
    }
  });

  it('every tool that a spot needs says so in its "used for"', () => {
    for (const node of NODES) {
      for (const action of node.actions) {
        if (action.tool) expect(names(itemGuide(action.tool).usedFor, 'node', node.typeId), `${node.id} needs ${action.tool}`).toBe(true);
      }
    }
  });
});

describe('the guide reads the tables when it is made', () => {
  it('says how long each spot takes to refill, from its action and the game\'s day', () => {
    const spruce = NODES.find((node) => node.typeId === 'spruce')!;
    const seconds = spruce.actions[0].respawnDays! * TUNING.time.daySeconds;
    expect(refillSeconds(spruce.actions[0])).toBe(seconds);
    const line = itemGuide('spruce_gum').where.find((candidate) => candidate.lead.startsWith('Spruce'))!;
    expect(line.text).toContain(`Refills in ${waitWords(seconds)}.`);
    for (const group of spots()) {
      const wait = refillSeconds(group.action);
      const text = nodeSections(group.typeId)[0].lines.map((candidate) => candidate.text).join(' ');
      expect(text).toContain(wait === null ? 'nce only' : `Refills in ${waitWords(wait)}.`);
    }
  });

  it('a changed refill changes the guide (it is read, never written in)', () => {
    const actions = NODES.filter((node) => node.typeId === 'spruce').map((node) => node.actions[0]);
    const before = actions.map((action) => action.respawnDays);
    try {
      for (const action of actions) action.respawnDays = 600 / TUNING.time.daySeconds;
      resetGuide();
      const line = itemGuide('spruce_gum').where.find((candidate) => candidate.lead.startsWith('Spruce'))!;
      expect(line.text).toContain('Refills in 10 min.');
    } finally {
      actions.forEach((action, index) => { action.respawnDays = before[index]; });
    }
  });

  it('marks what is found once only, and nothing that can be found again', () => {
    expect(itemGuide('hatchet_head').onceOnly).toBe(true);
    expect(itemGuide('lens').onceOnly).toBe(true);
    expect(itemGuide('nails').onceOnly).toBe(false);
    expect(itemGuide('jam').onceOnly).toBe(false);
    for (const itemId of ITEM_IDS) {
      const guide = itemGuide(itemId);
      const renewable = guide.where.some((line) => line.again);
      expect(guide.onceOnly, itemId).toBe(!renewable);
    }
  });

  it('words a wait in minutes, then hours', () => {
    expect(waitWords(600)).toBe('10 min');
    expect(waitWords(2880)).toBe('48 min');
    expect(waitWords(5760)).toBe('1 h 36 min');
    expect(waitWords(7200)).toBe('2 h');
    expect(waitWords(30)).toBe('30 s');
  });
});

describe('the three facts from the game\'s code match the game', () => {
  it('the starting gear is what a new game puts on the belt, and nothing else starts in a pack', () => {
    const state = createGame(1);
    expect([...STARTING_GEAR].sort()).toEqual([...state.tools, ...Object.keys(state.keyItems), ...state.players.flatMap((player) => player.backpack.map((stack) => stack.itemId)), ...state.canoe.cargo.map((stack) => stack.itemId)].sort());
    expect([...STARTING_GEAR].sort()).toEqual([...loadGameData().startingItems].sort());
  });

  it('the lake gives what the bailing can scoops', () => {
    expect([LAKE_WATER.itemId]).toEqual(loadGameData().lakeItems);
    const state = createGame(1);
    const player = state.players[0];
    expect(dispatch(state, { type: 'fill_water', count: 1 }).ok).toBe(true);
    // afloat it lands in the backpack, or the cargo when the pack is full
    expect([...player.backpack, ...state.canoe.cargo].some((stack) => stack.itemId === LAKE_WATER.itemId)).toBe(true);
    state.tools = state.tools.filter((tool) => tool !== LAKE_WATER.tool);
    expect(dispatch(state, { type: 'fill_water', count: 1 }).ok).toBe(false);
  });

  it('the canoe\'s gear adds what the guide says, and nothing it leaves out', () => {
    const state = createGame(1);
    state.canoe.attachments = [...new Set(ABOARD.map((source) => source.attachmentId))];
    state.canoe.beached = true;
    state.weather.kind = 'rain';
    const before = state.time;
    const longest = Math.max(TUNING.canoe.rainCatcherSecondsPerWater, TUNING.canoe.fishingRigSecondsPerFish);
    state.time = before + TUNING.time.daySeconds;
    updatePassiveAttachments(state, longest + 1, before);
    const gained = Object.fromEntries(state.canoe.cargo.map((stack) => [stack.itemId, stack.count]));
    const said: Record<string, number> = {};
    for (const source of ABOARD) said[source.itemId] = (said[source.itemId] ?? 0) + source.count;
    expect(gained).toEqual(said);
  });
});
