import type { DialogueCondition, DialogueEffect, DialogueOption, ItemAmount, NpcId } from '../data/types.ts';
import { NPCS } from '../data/dialogue.ts';
import { NODES_BY_ID } from '../data/nodes.ts';
import { ITEMS, isStackable } from '../data/items.ts';
import { QUESTS } from '../data/quests.ts';
import { TUNING } from '../data/tuning.ts';
import { ISLANDS_BY_ID, spotPosition } from '../data/world.ts';
import { beachCanoe } from './canoe.ts';
import { buildAttachment, craft, failure, success, upgradeHull } from './crafting.ts';
import { PICK_UP_ACTION, clearSpot, completeHarvest, disembarkSpot, distanceToHull, findInteractable } from './interact.ts';
import {
  addToStacks, cargoAccessible, countAccessible, countInStacks, emit, emptyMissing, freeSeat, grantItems,
  hasAttachment, hasTool, playerOf, removeFromStacks, slotsOf, spendItems, stacksOf,
} from './inventory.ts';
import { returnLostGifts } from './keepsakes.ts';
import { acceptQuest, notifyTalked, turnInQuest, updateQuests } from './quests.ts';
import { sleep, sleepBlocked } from './survival.ts';
import { setTracked } from './tracking.ts';
import { clearPing, placePing } from './pings.ts';
import type { Command, CommandResult, Container, GameState, PlayerId, PlayerState } from './types.ts';
import { groundHeight, islandAt, regionAt, terrainHeight } from './world.ts';

const otherContainer = (container: Container): Container => (container === 'backpack' ? 'cargo' : 'backpack');

function conditionHolds(state: GameState, condition: DialogueCondition | undefined): boolean {
  if (!condition) return true;
  if (condition.flags?.some((flag) => !state.flags[flag])) return false;
  if (condition.notFlags?.some((flag) => state.flags[flag])) return false;
  if (condition.quests?.some(({ questId, statuses }) => !statuses.includes(state.quests[questId].status))) return false;
  return true;
}

/** The dialogue options on offer to a player right now, in order. Indexes match `choose_dialogue_option`. */
export function visibleDialogueOptions(state: GameState, player: PlayerState): DialogueOption[] {
  if (!player.dialogue) return [];
  const node = NPCS[player.dialogue.npcId].nodes[player.dialogue.nodeId];
  return node.options.filter((option) => conditionHolds(state, option.condition));
}

function npcInReach(player: PlayerState, npcId: NpcId): boolean {
  if (player.dialogue?.npcId === npcId) return true;
  const npc = NPCS[npcId];
  if (player.mode !== 'foot' || player.islandId !== npc.islandId) return false;
  const position = spotPosition(ISLANDS_BY_ID[npc.islandId], npc.spot);
  return Math.hypot(position.x - player.position.x, position.z - player.position.z) <= TUNING.foot.npcRange;
}

function applyDialogueEffect(state: GameState, player: PlayerState, effect: DialogueEffect): void {
  switch (effect.type) {
    case 'set_flag':
      state.flags[effect.flag] = true;
      break;
    case 'give_items': {
      const leftover = grantItems(state, player, effect.items);
      if (leftover.length > 0) {
        state.pendingRewards.push(...leftover);
        emit(state, { type: 'rewards_pending' });
      }
      break;
    }
    case 'accept_quest':
      acceptQuest(state, effect.questId, player);
      break;
    case 'turn_in_quest':
      turnInQuest(state, effect.questId, player);
      break;
  }
}

function closeDialogue(state: GameState, player: PlayerState): void {
  if (!player.dialogue) return;
  emit(state, { type: 'dialogue_closed', npcId: player.dialogue.npcId }, player);
  player.dialogue = null;
}

/** True when open water is within a couple of steps. */
function waterInReach(player: PlayerState): boolean {
  if (player.mode === 'canoe') return true;
  const { x, z } = player.position;
  for (let step = 0; step < 8; step += 1) {
    const angle = (step / 8) * 2 * Math.PI;
    if (terrainHeight(x + Math.sin(angle) * 2.5, z - Math.cos(angle) * 2.5) < -0.1) return true;
  }
  return terrainHeight(x, z) < 0;
}

function moveStacks(state: GameState, player: PlayerState, from: Container, itemId: ItemAmount['itemId'], count: number): number {
  const to = otherContainer(from);
  const available = Math.min(count, countInStacks(stacksOf(state, player, from), itemId));
  if (available <= 0) return 0;
  const leftover = addToStacks(stacksOf(state, player, to), slotsOf(state, to), itemId, available);
  const moved = available - leftover;
  removeFromStacks(stacksOf(state, player, from), itemId, moved);
  return moved;
}

function consume(state: GameState, player: PlayerState, itemId: ItemAmount['itemId'], asDrink: boolean): CommandResult {
  const definition = ITEMS[itemId];
  if (!definition) return failure('unknown_id');
  if (!definition.edible || definition.isDrink !== asDrink) return failure(asDrink ? 'not_drinkable' : 'not_edible');
  if (countAccessible(state, player, itemId) < 1) return failure('item_not_held');
  spendItems(state, player, [{ itemId, count: 1 }]);
  player.hunger = Math.min(100, player.hunger + definition.edible.hunger);
  player.thirst = Math.min(100, player.thirst + definition.edible.thirst);
  player.energy = Math.max(1, Math.min(100, player.energy + definition.edible.energy));
  emit(state, asDrink ? { type: 'drank', itemId } : { type: 'ate', itemId }, player);
  return success([], [{ itemId, count: 1 }]);
}

/** Commands that still work while a conversation is open. */
const DIALOGUE_COMMANDS: Command['type'][] = [
  'choose_dialogue_option', 'end_dialogue', 'track_quest', 'set_difficulty', 'accept_quest', 'turn_in_quest',
];

/** Commands a player lying down can send without getting up. */
const BED_COMMANDS: Command['type'][] = ['sleep', 'wake', 'track_quest', 'set_difficulty'];

/**
 * Run one discrete command for one player (player 0 unless `playerId` says
 * otherwise). Always returns a typed result: on failure a machine-readable
 * reason, and what is missing when that applies.
 */
export function dispatch(state: GameState, command: Command, playerId: PlayerId = 0): CommandResult {
  const player = playerOf(state, playerId);
  // Nobody acts for a player who is away.
  if (!player.connected) return failure('player_away');
  // A mark on the map: it works from a bed and in a talk, and gets nobody up.
  if (command.type === 'ping') return placePing(state, player, command.x, command.z);
  if (command.type === 'clear_ping') return clearPing(state, command.playerId);
  if (player.dialogue && !DIALOGUE_COMMANDS.includes(command.type)) return failure('in_dialogue');
  // Doing anything else gets a waiting sleeper up.
  if (player.asleep && !BED_COMMANDS.includes(command.type)) player.asleep = false;
  const canoe = state.canoe;

  switch (command.type) {
    case 'craft':
      return craft(state, player, command.recipeId, command.count ?? 1);
    case 'upgrade_hull':
      return upgradeHull(state, player);
    case 'build_attachment':
      return buildAttachment(state, player, command.attachmentId);

    case 'stow_backpack': {
      if (!cargoAccessible(state, player)) return failure('not_at_canoe');
      const moved: ItemAmount[] = [];
      for (const stack of player.backpack.map((entry) => ({ ...entry }))) {
        const count = moveStacks(state, player, 'backpack', stack.itemId, stack.count);
        if (count > 0) moved.push({ itemId: stack.itemId, count });
      }
      if (moved.length === 0 && player.backpack.length > 0) return failure('inventory_full');
      updateQuests(state, player);
      return success(moved);
    }
    case 'transfer': {
      if (!ITEMS[command.itemId] || !isStackable(command.itemId)) return failure('unknown_id');
      if (!Number.isInteger(command.count) || command.count < 1) return failure('invalid_amount');
      if (!cargoAccessible(state, player)) return failure('not_at_canoe');
      if (countInStacks(stacksOf(state, player, command.from), command.itemId) < 1) return failure('item_not_held');
      const count = moveStacks(state, player, command.from, command.itemId, command.count);
      if (count === 0) return failure('inventory_full');
      updateQuests(state, player);
      return success([{ itemId: command.itemId, count }]);
    }
    case 'discard': {
      if (!ITEMS[command.itemId] || !isStackable(command.itemId)) return failure('unknown_id');
      if (!Number.isInteger(command.count) || command.count < 1) return failure('invalid_amount');
      if (command.from === 'cargo' && !cargoAccessible(state, player)) return failure('not_at_canoe');
      const count = removeFromStacks(stacksOf(state, player, command.from), command.itemId, command.count);
      if (count === 0) return failure('item_not_held');
      emit(state, { type: 'item_lost', itemId: command.itemId, count }, player);
      return success([], [{ itemId: command.itemId, count }]);
    }

    case 'eat':
      return consume(state, player, command.itemId, false);
    case 'drink':
      return consume(state, player, command.itemId, true);
    case 'fill_water': {
      if (!Number.isInteger(command.count) || command.count < 1) return failure('invalid_amount');
      if (!hasTool(state, 'bailing_can')) {
        const missing = emptyMissing();
        missing.tools.push('bailing_can');
        return failure('missing_requirements', missing);
      }
      if (!waterInReach(player)) return failure('no_water_in_reach');
      const leftover = grantItems(state, player, [{ itemId: 'dirty_water', count: command.count }]);
      const filled = command.count - (leftover[0]?.count ?? 0);
      if (filled === 0) return failure('inventory_full');
      return success([{ itemId: 'dirty_water', count: filled }]);
    }
    case 'scavenge': {
      const target = findInteractable(state, player);
      if (!target || target.kind !== 'node') return failure('nothing_in_reach');
      if (!target.available) {
        if (!target.missing) return failure('quest_not_ready');
        emit(state, { type: 'harvest_blocked', nodeId: target.nodeId, missing: target.missing }, player);
        return failure('missing_requirements', target.missing);
      }
      const definition = NODES_BY_ID[target.nodeId];
      if (target.actionIndex !== PICK_UP_ACTION) {
        // Effort is refused when it would leave too little energy, so it never causes a fail.
        const energyCost = definition.actions[target.actionIndex].energyCost;
        if (energyCost > 0 && player.energy < TUNING.survival.minimumEnergyToExert + energyCost) return failure('too_tired');
      }
      emit(state, { type: 'harvest_started', nodeId: target.nodeId, actionIndex: target.actionIndex }, player);
      return success(completeHarvest(state, player, definition, target.actionIndex));
    }
    case 'sleep': {
      if (player.asleep) return success();
      const blocked = sleepBlocked(state, player);
      if (blocked) return failure(blocked);
      sleep(state, player);
      return success();
    }
    case 'wake':
      player.asleep = false;
      return success();

    case 'board': {
      if (player.mode === 'canoe') return failure('already_aboard');
      if (distanceToHull(state, player.position.x, player.position.z) > TUNING.canoe.boardRange) return failure('not_at_canoe');
      player.seat = freeSeat(state);
      player.mode = 'canoe';
      player.islandId = null;
      player.position.x = canoe.position.x;
      player.position.y = canoe.position.y;
      player.position.z = canoe.position.z;
      player.heading = canoe.heading;
      emit(state, { type: 'boarded' }, player);
      return success();
    }
    case 'disembark': {
      if (player.mode !== 'canoe') return failure('not_aboard');
      const landing = disembarkSpot(state);
      if (!landing) return failure('no_shore_in_reach');
      // Stepping out pulls the canoe up. Anyone still aboard can paddle it off again.
      beachCanoe(state);
      canoe.sailRaised = false;
      canoe.bailing = false;
      player.mode = 'foot';
      player.seat = null;
      player.exerting = false;
      player.paddling = false;
      player.bailing = false;
      const spot = clearSpot(state, player, landing);
      player.position.x = spot.x;
      player.position.z = spot.z;
      player.position.y = groundHeight(spot.x, spot.z);
      player.islandId = islandAt(spot.x, spot.z);
      player.regionId = regionAt(spot.x, spot.z).id;
      emit(state, { type: 'landed', islandId: player.islandId }, player);
      emit(state, { type: 'autosave_requested', reason: 'landing' });
      updateQuests(state, player);
      return success();
    }

    case 'talk': {
      const npc = NPCS[command.npcId];
      if (!npc) return failure('unknown_id');
      if (!npcInReach(player, command.npcId)) return failure('npc_out_of_reach');
      const entry = npc.entries.find((candidate) => conditionHolds(state, candidate.condition));
      if (!entry) return failure('npc_out_of_reach');
      player.dialogue = { npcId: command.npcId, nodeId: entry.nodeId };
      emit(state, { type: 'dialogue_opened', npcId: command.npcId }, player);
      // A one-time gift of theirs that is gone comes back with the word (sim/keepsakes.ts).
      returnLostGifts(state, command.npcId, player);
      notifyTalked(state, command.npcId);
      updateQuests(state, player);
      return success();
    }
    case 'choose_dialogue_option': {
      if (!player.dialogue) return failure('no_dialogue_open');
      const option = visibleDialogueOptions(state, player)[command.optionIndex];
      if (!option) return failure('invalid_option');
      for (const effect of option.effects ?? []) applyDialogueEffect(state, player, effect);
      if (option.next === null) closeDialogue(state, player);
      else player.dialogue.nodeId = option.next;
      updateQuests(state, player);
      return success();
    }
    case 'end_dialogue':
      if (!player.dialogue) return failure('no_dialogue_open');
      closeDialogue(state, player);
      return success();

    case 'accept_quest': {
      const definition = QUESTS[command.questId];
      if (!definition) return failure('unknown_id');
      if (state.quests[command.questId].status !== 'available') return failure('quest_not_available');
      if (definition.giver && !npcInReach(player, definition.giver)) return failure('npc_out_of_reach');
      acceptQuest(state, command.questId, player);
      return success();
    }
    case 'turn_in_quest': {
      const definition = QUESTS[command.questId];
      if (!definition) return failure('unknown_id');
      if (definition.giver && !npcInReach(player, definition.giver)) return failure('npc_out_of_reach');
      return turnInQuest(state, command.questId, player) ? success(definition.rewards.items) : failure('quest_not_ready');
    }
    case 'track_quest': {
      const refused = setTracked(state, player, command.questId, command.tracked ?? true);
      return refused ? failure(refused) : success();
    }

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
      state.pendingRewards = grantItems(state, player, pending);
      const after = state.pendingRewards.reduce((sum, stack) => sum + stack.count, 0);
      if (after === before) return failure('inventory_full');
      updateQuests(state, player);
      return success();
    }
    case 'set_difficulty':
      if (!(command.difficulty in TUNING.difficultyDrainScale)) return failure('unknown_id');
      state.difficulty = command.difficulty;
      return success();
  }
}
