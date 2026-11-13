/**
 * One-time items (Luc's list, line 6): what a player can find or be given once only. A cache's find (the hatchet
 * head, the saw blade, the pry bar, the lens, the lodestone, the radio crystal, the Beacon's bearing) and a
 * survivor's gift (Tink's wrench and bellows, Wren's flag, Tink's figurehead).
 *
 * None of them can be dropped or lost in a fail: tools and key items are the crew's for good. Each is spent only
 * into a tool or an attachment, and those are never lost either, so a quest that asks for the find counts what it
 * was made into (`madeInto`). Should one be gone all the same (a save from a build that lost it, a rule that
 * changes later), it can be had again where it came from, for the same trip: its cache fills again, and its giver
 * hands it over again at the next word.
 *
 * Read from the tables, so a new cache or gift is covered with no work here. A test pins the list.
 */
import type { AttachmentId, FlagId, ItemId, LootTableId, NodeId, NpcId, ToolId } from '../data/types.ts';
import { ATTACHMENT_IDS, ATTACHMENTS } from '../data/canoe.ts';
import { NPCS, NPC_IDS } from '../data/dialogue.ts';
import { ITEMS, ITEM_IDS, isStackable } from '../data/items.ts';
import { LOOT_TABLES, NODES } from '../data/nodes.ts';
import { QUEST_LIST } from '../data/quests.ts';
import { RECIPES } from '../data/recipes.ts';
import { emit, grantItems } from './inventory.ts';
import type { GameState, PlayerState } from './types.ts';

/** Where an item comes from, as the tables say. */
interface Sources {
  /** A node action that grows back, or a recipe: the item can be had again and again. */
  repeatable: boolean;
  /** Node actions that give it once, as [node, action index]. */
  caches: [NodeId, number][];
  /** Survivors who hand it over once: as a quest reward, or in a talk that sets a flag. */
  gifts: { npcId: NpcId; questId: string | null; flag: FlagId | null }[];
}

const guaranteedBy = (lootTableId: LootTableId): ItemId[] => LOOT_TABLES[lootTableId].guaranteed.map((entry) => entry.itemId);

function readSources(): Map<ItemId, Sources> {
  const sources = new Map<ItemId, Sources>();
  const of = (itemId: ItemId): Sources => {
    let entry = sources.get(itemId);
    if (!entry) {
      entry = { repeatable: false, caches: [], gifts: [] };
      sources.set(itemId, entry);
    }
    return entry;
  };
  for (const node of NODES) {
    node.actions.forEach((action, index) => {
      const table = LOOT_TABLES[action.lootTableId];
      for (const itemId of guaranteedBy(action.lootTableId)) {
        if (action.respawnDays === null) of(itemId).caches.push([node.id, index]);
        else of(itemId).repeatable = true;
      }
      if (action.respawnDays !== null) for (const entry of table.pool) of(entry.itemId).repeatable = true;
    });
  }
  for (const recipe of Object.values(RECIPES)) of(recipe.output.itemId).repeatable = true;
  for (const quest of QUEST_LIST) {
    for (const reward of quest.rewards.items) {
      if (quest.giver) of(reward.itemId).gifts.push({ npcId: quest.giver, questId: quest.id, flag: null });
    }
  }
  for (const npcId of NPC_IDS) {
    for (const node of Object.values(NPCS[npcId].nodes)) {
      for (const option of node.options) {
        const flag = option.effects?.find((effect) => effect.type === 'set_flag');
        for (const effect of option.effects ?? []) {
          if (effect.type !== 'give_items') continue;
          for (const item of effect.items) {
            of(item.itemId).gifts.push({ npcId, questId: null, flag: flag?.type === 'set_flag' ? flag.flag : null });
          }
        }
      }
    }
  }
  return sources;
}

const SOURCES = readSources();

/**
 * Every item a player can find or be given only once: nothing that grows back gives it and no recipe makes it.
 * Stackable things are left out on purpose: every one of them grows back somewhere.
 */
export const ONE_TIME_ITEMS: readonly ItemId[] = ITEM_IDS.filter((itemId) => {
  const source = SOURCES.get(itemId);
  return source !== undefined && !source.repeatable && (source.caches.length > 0 || source.gifts.length > 0) && !isStackable(itemId);
});

/** What a one-time item is spent into: tools a recipe makes from it, attachments built with it. Never lost. */
export function productsOf(itemId: ItemId): { tools: ToolId[]; attachments: AttachmentId[] } {
  const tools = Object.values(RECIPES)
    .filter((recipe) => recipe.inputs.some((input) => input.itemId === itemId) && ITEMS[recipe.output.itemId].category === 'tool')
    .map((recipe) => recipe.output.itemId as ToolId);
  const attachments = ATTACHMENT_IDS.filter((attachmentId) => ATTACHMENTS[attachmentId].cost.some((cost) => cost.itemId === itemId));
  return { tools, attachments };
}

const PRODUCTS = new Map(ONE_TIME_ITEMS.map((itemId) => [itemId, productsOf(itemId)]));

/** True when the crew holds a one-time item, or what it was made into. */
export function keepsakeHeld(state: GameState, itemId: ItemId): boolean {
  if (ITEMS[itemId].category === 'tool' ? state.tools.includes(itemId as ToolId) : (state.keyItems[itemId] ?? 0) > 0) return true;
  const products = PRODUCTS.get(itemId);
  if (!products) return false;
  return products.tools.some((toolId) => state.tools.includes(toolId))
    || products.attachments.some((attachmentId) => state.canoe.attachments.includes(attachmentId));
}

/** The caches that give a one-time item, with the items they give: checked a few times a second. */
const CACHES: { nodeId: NodeId; actionIndex: number; finds: ItemId[] }[] = (() => {
  const caches: { nodeId: NodeId; actionIndex: number; finds: ItemId[] }[] = [];
  for (const itemId of ONE_TIME_ITEMS) {
    for (const [nodeId, actionIndex] of SOURCES.get(itemId)!.caches) {
      const known = caches.find((cache) => cache.nodeId === nodeId && cache.actionIndex === actionIndex);
      if (known) known.finds.push(itemId);
      else caches.push({ nodeId, actionIndex, finds: [itemId] });
    }
  }
  return caches;
})();

/**
 * A used-up cache whose one-time find is gone (not held, not made into anything) fills again: it is ready now.
 * Run with the quests' tick. Nothing happens while the find or its product is with the crew.
 */
export function refillLostFinds(state: GameState): void {
  for (const cache of CACHES) {
    const nodeState = state.nodes[cache.nodeId];
    if (!nodeState || nodeState.readyAt[cache.actionIndex] !== null) continue;
    if (cache.finds.every((itemId) => keepsakeHeld(state, itemId))) continue;
    nodeState.readyAt[cache.actionIndex] = state.time;
  }
}

/**
 * Talking to a survivor: a one-time gift of theirs that was given and is gone comes back. Given means its quest is
 * done, or the talk that hands it over has set its flag. Returns what came back.
 */
export function returnLostGifts(state: GameState, npcId: NpcId, player: PlayerState): ItemId[] {
  const returned: ItemId[] = [];
  for (const itemId of ONE_TIME_ITEMS) {
    const given = SOURCES.get(itemId)!.gifts.some((gift) => gift.npcId === npcId
      && ((gift.questId !== null && state.quests[gift.questId as keyof typeof state.quests]?.status === 'completed')
        || (gift.flag !== null && state.flags[gift.flag] === true)));
    if (!given || keepsakeHeld(state, itemId)) continue;
    const leftover = grantItems(state, player, [{ itemId, count: 1 }]);
    if (leftover.length > 0) {
      state.pendingRewards.push(...leftover);
      emit(state, { type: 'rewards_pending' });
    }
    returned.push(itemId);
  }
  return returned;
}
