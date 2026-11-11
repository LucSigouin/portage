import type { DialogueCondition, DialogueEffect, DialogueOption, ItemAmount, NpcId } from '../data/types.ts';
import { NPCS } from '../data/dialogue.ts';
import { ITEMS, isStackable } from '../data/items.ts';
import { QUESTS } from '../data/quests.ts';
import { TUNING } from '../data/tuning.ts';
import { ISLANDS_BY_ID, spotPosition } from '../data/world.ts';
import { beachCanoe } from './canoe.ts';
import { buildAttachment, craft, failure, success, upgradeHull } from './crafting.ts';
import { disembarkSpot, distanceToHull } from './interact.ts';
import {
  addToStacks, cargoAccessible, countAccessible, countInStacks, emit, emptyMissing, grantItems, hasAttachment,
  hasTool, removeFromStacks, slotsOf, spendItems, stacksOf,
} from './inventory.ts';
import { acceptQuest, notifyTalked, turnInQuest, updateQuests } from './quests.ts';
import { sleep, sleepBlocked } from './survival.ts';
import type { Command, CommandResult, Container, GameState } from './types.ts';
import { islandAt, regionAt, terrainHeight } from './world.ts';

const otherContainer = (container: Container): Container => (container === 'backpack' ? 'cargo' : 'backpack');

function conditionHolds(state: GameState, condition: DialogueCondition | undefined): boolean {
  if (!condition) return true;
  if (condition.flags?.some((flag) => !state.flags[flag])) return false;
  if (condition.notFlags?.some((flag) => state.flags[flag])) return false;
  if (condition.quests?.some(({ questId, statuses }) => !statuses.includes(state.quests[questId].status))) return false;
  return true;
}

/** The dialogue options on offer right now, in order. Indexes match `choose_dialogue_option`. */
export function visibleDialogueOptions(state: GameState): DialogueOption[] {
  if (!state.dialogue) return [];
  const node = NPCS[state.dialogue.npcId].nodes[state.dialogue.nodeId];
  return node.options.filter((option) => conditionHolds(state, option.condition));
}

function npcInReach(state: GameState, npcId: NpcId): boolean {
  if (state.dialogue?.npcId === npcId) return true;
  const npc = NPCS[npcId];
  if (state.player.mode !== 'foot' || state.player.islandId !== npc.islandId) return false;
  const position = spotPosition(ISLANDS_BY_ID[npc.islandId], npc.spot);
  return Math.hypot(position.x - state.player.position.x, position.z - state.player.position.z) <= TUNING.foot.npcRange;
}

function applyDialogueEffect(state: GameState, effect: DialogueEffect): void {
  switch (effect.type) {
    case 'set_flag':
      state.flags[effect.flag] = true;
      break;
    case 'give_items': {
      const leftover = grantItems(state, effect.items);
      if (leftover.length > 0) {
        state.pendingRewards.push(...leftover);
        emit(state, { type: 'rewards_pending' });
      }
      break;
    }
    case 'accept_quest':
      acceptQuest(state, effect.questId);
      break;
    case 'turn_in_quest':
      turnInQuest(state, effect.questId);
      break;
  }
}

function closeDialogue(state: GameState): void {
  if (!state.dialogue) return;
  emit(state, { type: 'dialogue_closed', npcId: state.dialogue.npcId });
  state.dialogue = null;
}

/** True when open water is within a couple of steps. */
function waterInReach(state: GameState): boolean {
  if (state.player.mode === 'canoe') return true;
  const { x, z } = state.player.position;
  for (let step = 0; step < 8; step += 1) {
    const angle = (step / 8) * 2 * Math.PI;
    if (terrainHeight(x + Math.sin(angle) * 2.5, z - Math.cos(angle) * 2.5) < -0.1) return true;
  }
  return terrainHeight(x, z) < 0;
}

function moveStacks(state: GameState, from: Container, itemId: ItemAmount['itemId'], count: number): number {
  const to = otherContainer(from);
  const available = Math.min(count, countInStacks(stacksOf(state, from), itemId));
  if (available <= 0) return 0;
  const leftover = addToStacks(stacksOf(state, to), slotsOf(state, to), itemId, available);
  const moved = available - leftover;
  removeFromStacks(stacksOf(state, from), itemId, moved);
  return moved;
}

function consume(state: GameState, itemId: ItemAmount['itemId'], asDrink: boolean): CommandResult {
  const definition = ITEMS[itemId];
  if (!definition) return failure('unknown_id');
  if (!definition.edible || definition.isDrink !== asDrink) return failure(asDrink ? 'not_drinkable' : 'not_edible');
  if (countAccessible(state, itemId) < 1) return failure('item_not_held');
  spendItems(state, [{ itemId, count: 1 }]);
  const player = state.player;
  player.hunger = Math.min(100, player.hunger + definition.edible.hunger);
  player.thirst = Math.min(100, player.thirst + definition.edible.thirst);
  player.energy = Math.max(1, Math.min(100, player.energy + definition.edible.energy));
  emit(state, asDrink ? { type: 'drank', itemId } : { type: 'ate', itemId });
  return success([], [{ itemId, count: 1 }]);
}

/** Commands that still work while a conversation is open. */
const DIALOGUE_COMMANDS: Command['type'][] = [
  'choose_dialogue_option', 'end_dialogue', 'track_quest', 'set_difficulty', 'accept_quest', 'turn_in_quest',
];

/**
 * Run one discrete player command. Always returns a typed result: on failure
 * a machine-readable reason, and what is missing when that applies.
 */
export function dispatch(state: GameState, command: Command): CommandResult {
  if (state.dialogue && !DIALOGUE_COMMANDS.includes(command.type)) return failure('in_dialogue');
  const player = state.player;
  const canoe = state.canoe;

  switch (command.type) {
    case 'craft':
      return craft(state, command.recipeId, command.count ?? 1);
    case 'upgrade_hull':
      return upgradeHull(state);
    case 'build_attachment':
      return buildAttachment(state, command.attachmentId);

    case 'stow_backpack': {
      if (!cargoAccessible(state)) return failure('not_at_canoe');
      const moved: ItemAmount[] = [];
      for (const stack of player.backpack.map((entry) => ({ ...entry }))) {
        const count = moveStacks(state, 'backpack', stack.itemId, stack.count);
        if (count > 0) moved.push({ itemId: stack.itemId, count });
      }
      if (moved.length === 0 && player.backpack.length > 0) return failure('inventory_full');
      updateQuests(state);
      return success(moved);
    }
    case 'transfer': {
      if (!ITEMS[command.itemId] || !isStackable(command.itemId)) return failure('unknown_id');
      if (!Number.isInteger(command.count) || command.count < 1) return failure('invalid_amount');
      if (!cargoAccessible(state)) return failure('not_at_canoe');
      if (countInStacks(stacksOf(state, command.from), command.itemId) < 1) return failure('item_not_held');
      const count = moveStacks(state, command.from, command.itemId, command.count);
      if (count === 0) return failure('inventory_full');
      updateQuests(state);
      return success([{ itemId: command.itemId, count }]);
    }
    case 'discard': {
      if (!ITEMS[command.itemId] || !isStackable(command.itemId)) return failure('unknown_id');
      if (!Number.isInteger(command.count) || command.count < 1) return failure('invalid_amount');
      if (command.from === 'cargo' && !cargoAccessible(state)) return failure('not_at_canoe');
      const count = removeFromStacks(stacksOf(state, command.from), command.itemId, command.count);
      if (count === 0) return failure('item_not_held');
      emit(state, { type: 'item_lost', itemId: command.itemId, count });
      return success([], [{ itemId: command.itemId, count }]);
    }

    case 'eat':
      return consume(state, command.itemId, false);
    case 'drink':
      return consume(state, command.itemId, true);
    case 'fill_water': {
      if (!Number.isInteger(command.count) || command.count < 1) return failure('invalid_amount');
      if (!hasTool(state, 'bailing_can')) {
        const missing = emptyMissing();
        missing.tools.push('bailing_can');
        return failure('missing_requirements', missing);
      }
      if (!waterInReach(state)) return failure('no_water_in_reach');
      const leftover = grantItems(state, [{ itemId: 'dirty_water', count: command.count }]);
      const filled = command.count - (leftover[0]?.count ?? 0);
      if (filled === 0) return failure('inventory_full');
      return success([{ itemId: 'dirty_water', count: filled }]);
    }
    case 'sleep': {
      const blocked = sleepBlocked(state);
      if (blocked) return failure(blocked);
      sleep(state);
      return success();
    }

    case 'board': {
      if (player.mode === 'canoe') return failure('already_aboard');
      if (distanceToHull(state, player.position.x, player.position.z) > TUNING.canoe.boardRange) return failure('not_at_canoe');
      player.mode = 'canoe';
      player.islandId = null;
      player.harvest = null;
      player.position.x = canoe.position.x;
      player.position.y = canoe.position.y;
      player.position.z = canoe.position.z;
      player.heading = canoe.heading;
      emit(state, { type: 'boarded' });
      return success();
    }
    case 'disembark': {
      if (player.mode !== 'canoe') return failure('not_aboard');
      const spot = disembarkSpot(state);
      if (!spot) return failure('no_shore_in_reach');
      beachCanoe(state);
      canoe.sailRaised = false;
      canoe.bailing = false;
      player.mode = 'foot';
      player.exerting = false;
      player.position.x = spot.x;
      player.position.z = spot.z;
      player.position.y = terrainHeight(spot.x, spot.z);
      player.islandId = islandAt(spot.x, spot.z);
      player.regionId = regionAt(spot.x, spot.z).id;
      emit(state, { type: 'landed', islandId: player.islandId });
      emit(state, { type: 'autosave_requested', reason: 'landing' });
      updateQuests(state);
      return success();
    }

    case 'talk': {
      const npc = NPCS[command.npcId];
      if (!npc) return failure('unknown_id');
      if (!npcInReach(state, command.npcId)) return failure('npc_out_of_reach');
      const entry = npc.entries.find((candidate) => conditionHolds(state, candidate.condition));
      if (!entry) return failure('npc_out_of_reach');
      state.dialogue = { npcId: command.npcId, nodeId: entry.nodeId };
      player.harvest = null;
      emit(state, { type: 'dialogue_opened', npcId: command.npcId });
      notifyTalked(state, command.npcId);
      updateQuests(state);
      return success();
    }
    case 'choose_dialogue_option': {
      if (!state.dialogue) return failure('no_dialogue_open');
      const option = visibleDialogueOptions(state)[command.optionIndex];
      if (!option) return failure('invalid_option');
      for (const effect of option.effects ?? []) applyDialogueEffect(state, effect);
      if (option.next === null) closeDialogue(state);
      else state.dialogue.nodeId = option.next;
      updateQuests(state);
      return success();
    }
    case 'end_dialogue':
      if (!state.dialogue) return failure('no_dialogue_open');
      closeDialogue(state);
      return success();

    case 'accept_quest': {
      const definition = QUESTS[command.questId];
      if (!definition) return failure('unknown_id');
      if (state.quests[command.questId].status !== 'available') return failure('quest_not_available');
      if (definition.giver && !npcInReach(state, definition.giver)) return failure('npc_out_of_reach');
      acceptQuest(state, command.questId);
      return success();
    }
    case 'turn_in_quest': {
      const definition = QUESTS[command.questId];
      if (!definition) return failure('unknown_id');
      if (definition.giver && !npcInReach(state, definition.giver)) return failure('npc_out_of_reach');
      return turnInQuest(state, command.questId) ? success(definition.rewards.items) : failure('quest_not_ready');
    }
    case 'track_quest':
      if (command.questId !== null && !QUESTS[command.questId]) return failure('unknown_id');
      state.trackedQuestId = command.questId;
      return success();

    case 'toggle_lantern': {
      if (!hasAttachment(state, 'lantern_mast')) {
        const missing = emptyMissing();
        missing.attachments.push('lantern_mast');
        return failure('missing_requirements', missing);
      }
      canoe.lanternLit = !canoe.lanternLit;
      emit(state, { type: 'lantern_toggled', lit: canoe.lanternLit });
      return success();
    }
    case 'select_tool':
      if (command.toolId !== null && !hasTool(state, command.toolId)) return failure('tool_not_owned');
      player.selectedTool = command.toolId;
      return success();
    case 'set_sail': {
      if (!hasAttachment(state, 'mast_sail')) {
        const missing = emptyMissing();
        missing.attachments.push('mast_sail');
        return failure('missing_requirements', missing);
      }
      if (player.mode !== 'canoe') return failure('not_aboard');
      if (canoe.sailRaised !== command.raised) {
        canoe.sailRaised = command.raised;
        emit(state, { type: 'sail_changed', raised: command.raised });
      }
      return success();
    }

    case 'claim_rewards': {
      if (state.pendingRewards.length === 0) return failure('nothing_to_claim');
      const before = state.pendingRewards.reduce((sum, stack) => sum + stack.count, 0);
      const pending = state.pendingRewards;
      state.pendingRewards = grantItems(state, pending);
      const after = state.pendingRewards.reduce((sum, stack) => sum + stack.count, 0);
      if (after === before) return failure('inventory_full');
      updateQuests(state);
      return success();
    }
    case 'set_difficulty':
      if (!(command.difficulty in TUNING.difficultyDrainScale)) return failure('unknown_id');
      state.difficulty = command.difficulty;
      return success();
  }
}
