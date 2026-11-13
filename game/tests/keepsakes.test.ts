/**
 * Luc's list, line 6: "1 time items should be buildable somehow if lost or completed before the quest."
 *
 * - Every item a player can find or be given only once is listed, read from the tables and pinned here.
 * - None of them can be dropped or lost in a fail, and each is spent only into a tool or an attachment.
 * - If one is gone all the same, it can be had again where it came from: its cache fills again, its giver gives it
 *   again. Nothing comes twice while the crew still holds it or what it was made into.
 * - A craft made before its quest is given counts toward that quest ("Cook pitch 0 / 2", review finding 14).
 */
import { describe, expect, it } from 'vitest';
import {
  ATTACHMENTS, HULL_TIERS, ISLANDS_BY_ID, ITEMS, LOOT_TABLES, MAIN_QUESTS, NODES, NODES_BY_ID, NPCS, QUEST_LIST, RECIPES, spotPosition,
} from '../src/data/index.ts';
import type { ItemId, NpcId, QuestId, ToolId } from '../src/data/index.ts';
import { dispatch, drainEvents, selectQuestLog } from '../src/sim/index.ts';
import type { GameState } from '../src/sim/index.ts';
import { ONE_TIME_ITEMS, keepsakeHeld, productsOf } from '../src/sim/keepsakes.ts';
import { give, newGame, run, standOn, teleport, teleportToCamp, teleportToNode } from './support.ts';

const isTool = (itemId: ItemId): boolean => ITEMS[itemId].category === 'tool';

/** Is the item itself with the crew: on the belt or among the key items. */
const holds = (state: GameState, itemId: ItemId): boolean =>
  isTool(itemId) ? state.tools.includes(itemId as ToolId) : (state.keyItems[itemId] ?? 0) > 0;

/** Take a one-time item away: what a lost item would look like. */
function lose(state: GameState, itemId: ItemId): void {
  if (isTool(itemId)) state.tools = state.tools.filter((toolId) => toolId !== itemId);
  else delete state.keyItems[itemId];
}

/** The cache nodes that give an item once, as [node id, action index]. */
function cachesOf(itemId: ItemId): [string, number][] {
  return NODES.flatMap((node) => node.actions
    .map((action, index) => [action, index] as const)
    .filter(([action]) => action.respawnDays === null && LOOT_TABLES[action.lootTableId].guaranteed.some((entry) => entry.itemId === itemId))
    .map(([, index]): [string, number] => [node.id, index]));
}

/** The survivors who hand an item over once: quest rewards with a giver, and gifts in a talk. */
function giftsOf(itemId: ItemId): { npcId: NpcId; questId: QuestId | null; flag: string | null }[] {
  const gifts: { npcId: NpcId; questId: QuestId | null; flag: string | null }[] = [];
  for (const quest of QUEST_LIST) {
    if (quest.giver && quest.rewards.items.some((reward) => reward.itemId === itemId)) gifts.push({ npcId: quest.giver, questId: quest.id, flag: null });
  }
  for (const npc of Object.values(NPCS)) {
    for (const node of Object.values(npc.nodes)) {
      for (const option of node.options) {
        const gives = option.effects?.some((effect) => effect.type === 'give_items' && effect.items.some((entry) => entry.itemId === itemId));
        const flag = option.effects?.find((effect) => effect.type === 'set_flag');
        if (gives) gifts.push({ npcId: npc.id, questId: null, flag: flag?.type === 'set_flag' ? flag.flag : null });
      }
    }
  }
  return gifts;
}

/** The main line up to the quest before `questId`, its steps all done, so the next tick hands `questId` over. */
function handOverMainQuest(state: GameState, questId: QuestId): void {
  const target = MAIN_QUESTS.find((quest) => quest.id === questId)!;
  for (const quest of MAIN_QUESTS) if (quest.order < target.order - 1) state.quests[quest.id].status = 'completed';
  const previous = MAIN_QUESTS.find((quest) => quest.order === target.order - 1)!;
  state.quests[previous.id].status = 'active';
  state.quests[previous.id].progress = previous.objectives.map(() => 99);
}

function standBeside(state: GameState, npcId: NpcId): void {
  const npc = NPCS[npcId];
  const spot = spotPosition(ISLANDS_BY_ID[npc.islandId], npc.spot);
  teleport(state, npc.islandId, spot.x + 0.4, spot.z);
}

describe('one-time items', () => {
  it('lists every item a player can find or be given only once', () => {
    expect([...ONE_TIME_ITEMS].sort()).toEqual([
      'beacon_bearing', 'bellows', 'carved_figurehead', 'hatchet_head', 'lens', 'lodestone', 'pry_bar', 'radio_crystal',
      'saw_blade', 'signal_flag', 'wrench',
    ]);
    // Each one has a place it came from: a cache, or a survivor.
    for (const itemId of ONE_TIME_ITEMS) expect(cachesOf(itemId).length + giftsOf(itemId).length, itemId).toBeGreaterThan(0);
  });

  it('cannot drop one, lose one in a fail, or hand one over: they are the crew\'s for good', () => {
    for (const itemId of ONE_TIME_ITEMS) {
      const state = newGame(7);
      give(state, itemId);
      // Refused, and told why: a tool stays on the belt, a key item with the crew.
      expect(dispatch(state, { type: 'discard', from: 'backpack', itemId, count: 1 }), itemId)
        .toMatchObject({ ok: false, reason: ITEMS[itemId].category === 'tool' ? 'tool_kept' : 'key_item_kept' });
      // A capsize: half of every cargo stack goes, the crew's tools and key items do not.
      state.canoe.waterLevel = 100;
      run(state, {}, 0.2);
      expect(state.statistics.fails, itemId).toBe(1);
      expect(holds(state, itemId), `${itemId} after a capsize`).toBe(true);
      // No quest takes one away: a hand-over would.
      for (const quest of QUEST_LIST) {
        for (const objective of quest.objectives) {
          if (objective.type === 'deliver') expect(objective.itemId, `${quest.id} takes ${itemId}`).not.toBe(itemId);
        }
      }
    }
  });

  it('is spent only into a tool or an attachment, and those are never lost', () => {
    for (const itemId of ONE_TIME_ITEMS) {
      for (const recipe of Object.values(RECIPES)) {
        if (recipe.inputs.some((input) => input.itemId === itemId)) expect(ITEMS[recipe.output.itemId].category, `${recipe.id} uses ${itemId}`).toBe('tool');
      }
      for (const tier of HULL_TIERS) expect(tier.cost.some((cost) => cost.itemId === itemId), `hull ${tier.tier} uses ${itemId}`).toBe(false);
      const products = productsOf(itemId);
      for (const attachmentId of products.attachments) expect(ATTACHMENTS[attachmentId].cost.some((cost) => cost.itemId === itemId)).toBe(true);
    }
    // The hatchet head is in the hatchet: built, it counts as held, and its cache stays empty.
    const state = newGame(7);
    state.tools.push('hatchet');
    expect(keepsakeHeld(state, 'hatchet_head')).toBe(true);
  });
});

describe('a one-time item that is gone all the same', () => {
  const caches = ONE_TIME_ITEMS.flatMap((itemId) => cachesOf(itemId).map(([nodeId, actionIndex]) => ({ itemId, nodeId, actionIndex })));
  const gifts = ONE_TIME_ITEMS.flatMap((itemId) => giftsOf(itemId).map((gift) => ({ itemId, ...gift })));

  it('covers every one of them, by its cache or by its giver', () => {
    expect(new Set([...caches.map((cache) => cache.itemId), ...gifts.map((gift) => gift.itemId)])).toEqual(new Set(ONE_TIME_ITEMS));
  });

  it.each(caches.map((cache) => [`${cache.itemId} from ${cache.nodeId}`, cache] as const))('%s: the cache fills again, and only then', (_name, { itemId, nodeId, actionIndex }) => {
    const state = newGame(7);
    const node = NODES_BY_ID[nodeId];
    const action = node.actions[actionIndex];
    if (action.tool && action.tool !== itemId) give(state, action.tool);
    if (action.questGate) state.quests[action.questGate].status = 'active';
    // Found once: the cache is used up for good while the find is with the crew.
    teleportToNode(state, nodeId);
    expect(dispatch(state, { type: 'scavenge' }).ok, 'the first search').toBe(true);
    expect(holds(state, itemId)).toBe(true);
    run(state, {}, 1);
    expect(state.nodes[nodeId].readyAt[actionIndex], 'empty while it is held').toBeNull();
    // Gone: it fills again, and the same search gives it back.
    lose(state, itemId);
    run(state, {}, 1);
    expect(state.nodes[nodeId].readyAt[actionIndex], 'filled again').not.toBeNull();
    teleportToNode(state, nodeId);
    expect(dispatch(state, { type: 'scavenge' }).ok, 'the second search').toBe(true);
    expect(holds(state, itemId), 'had again').toBe(true);
    run(state, {}, 1);
    expect(state.nodes[nodeId].readyAt[actionIndex], 'empty again').toBeNull();
  });

  it.each(gifts.map((gift) => [`${gift.itemId} from ${gift.npcId}`, gift] as const))('%s: the giver gives it again at the next word, and only then', (_name, { itemId, npcId, questId, flag }) => {
    const state = newGame(7);
    standOn(state, NPCS[npcId].islandId);
    if (questId) state.quests[questId].status = 'completed';
    if (flag) state.flags[flag as keyof typeof state.flags] = true;
    // Given and still held: talking gives nothing more.
    give(state, itemId);
    standBeside(state, npcId);
    expect(dispatch(state, { type: 'talk', npcId }).ok).toBe(true);
    dispatch(state, { type: 'end_dialogue' });
    expect(isTool(itemId) ? state.tools.filter((toolId) => toolId === itemId).length : state.keyItems[itemId]).toBe(1);
    // Gone: the next word hands it over again.
    lose(state, itemId);
    drainEvents(state);
    expect(dispatch(state, { type: 'talk', npcId }).ok).toBe(true);
    expect(holds(state, itemId), 'had again').toBe(true);
    expect(drainEvents(state).some((event) => event.type === 'item_gained' && event.itemId === itemId)).toBe(true);
  });

  it('never refills a cache or repeats a gift that was never had', () => {
    const state = newGame(7);
    run(state, {}, 1);
    for (const cache of caches) expect(state.nodes[cache.nodeId], cache.nodeId).toBeUndefined();
    standOn(state, 'scrapyard_bar');
    standBeside(state, 'tink');
    dispatch(state, { type: 'talk', npcId: 'tink' });
    expect(state.keyItems.bellows ?? 0).toBe(0);
    expect(state.keyItems.carved_figurehead ?? 0).toBe(0);
  });
});

describe('a craft made before its quest is given', () => {
  it('counts toward that quest: pitch cooked early ticks "Cook pitch" (review finding 14)', () => {
    const state = newGame(7);
    standOn(state, 'home_knoll');
    teleportToCamp(state, 'home_knoll');
    give(state, 'spruce_gum', 4);
    give(state, 'driftwood', 2);
    // Still on "Bail out": "Stop the leak" is two quests away.
    expect(state.quests.stop_the_leak.status).toBe('locked');
    expect(dispatch(state, { type: 'craft', recipeId: 'pitch', count: 2 }).ok).toBe(true);
    handOverMainQuest(state, 'stop_the_leak');
    run(state, {}, 0.4);
    expect(state.quests.stop_the_leak.status).toBe('active');
    const cook = state.quests.stop_the_leak.progress[2];
    expect(cook, 'Cook pitch 2 / 2').toBe(2);
    const entry = selectQuestLog(state).find((quest) => quest.questId === 'stop_the_leak')!;
    expect(entry.objectives[2].done).toBe(true);
  });
});
