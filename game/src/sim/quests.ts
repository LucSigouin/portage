import type { ItemId, MadeInto, NodeId, NpcId, ObjectiveDefinition, QuestId } from '../data/types.ts';
import { STOCK_FOOD_IDS } from '../data/items.ts';
import { MAIN_QUESTS, QUESTS, QUEST_LIST } from '../data/quests.ts';
import { connectedPlayers, countHeld, countInStacks, emit, grantItems, removeFromStacks } from './inventory.ts';
import { afterQuestAccepted, afterQuestCompleted } from './tracking.ts';
import type { GameState, PlayerState, QuestState } from './types.ts';

/** The count at which an objective is done. */
export function objectiveRequired(objective: ObjectiveDefinition): number {
  switch (objective.type) {
    case 'have_item':
    case 'craft':
    case 'deliver':
    case 'bottles':
    case 'smoke':
    case 'caches':
      return objective.count;
    case 'stock':
      return objective.stockFood + objective.cleanWater;
    default:
      return 1;
  }
}

/** True once a node's first action has been used up for good. */
export function nodeUsed(state: GameState, nodeId: NodeId): boolean {
  const nodeState = state.nodes[nodeId];
  return nodeState !== undefined && nodeState.readyAt[0] === null;
}

/** True once the tool is on the belt or the attachment is on the canoe. Neither is ever lost. */
function madeIntoExists(state: GameState, madeInto: MadeInto): boolean {
  return 'toolId' in madeInto ? state.tools.includes(madeInto.toolId) : state.canoe.attachments.includes(madeInto.attachmentId);
}

/**
 * Progress of an objective read straight from the state, or null for
 * objectives that only advance through events (craft, sleep, talk). Quests
 * are the crew's: any player standing there, holding it or wearing it counts.
 */
function measuredProgress(state: GameState, objective: ObjectiveDefinition): number | null {
  switch (objective.type) {
    case 'bail':
      return state.canoe.waterLevel <= objective.waterAtMost ? 1 : 0;
    case 'land':
      return state.players.some((player) => player.mode === 'foot' && player.islandId === objective.islandId) ? 1 : 0;
    case 'have_item':
      // An ingredient that has been made into the thing counts as found, even though it is gone.
      if (objective.madeInto && madeIntoExists(state, objective.madeInto)) return objective.count;
      return Math.min(objective.count, countHeld(state, objective.itemId));
    case 'deliver':
      return Math.min(objective.count, countHeld(state, objective.itemId));
    case 'have_tool':
      return state.tools.includes(objective.toolId) ? 1 : 0;
    case 'hull':
      return state.canoe.hullTier >= objective.tier ? 1 : 0;
    case 'attachment':
      return state.canoe.attachments.includes(objective.attachmentId) ? 1 : 0;
    case 'enter_region':
      return state.players.some((player) => player.regionId === objective.regionId) ? 1 : 0;
    case 'node':
      return nodeUsed(state, objective.nodeId) ? 1 : 0;
    case 'stock': {
      let stockFood = 0;
      for (const itemId of STOCK_FOOD_IDS) stockFood += countInStacks(state.canoe.cargo, itemId);
      return Math.min(objective.stockFood, stockFood)
        + Math.min(objective.cleanWater, countInStacks(state.canoe.cargo, 'clean_water'));
    }
    case 'bottles':
      return Math.min(objective.count, state.bottlesFound.length);
    case 'smoke':
      return Math.min(objective.count, state.statistics.smokedCount);
    case 'caches':
      return Math.min(objective.count, state.statistics.cachesHauled);
    case 'craft':
    case 'sleep':
    case 'talk':
      return null;
  }
}

export function createQuestStates(): Record<QuestId, QuestState> {
  const quests = {} as Record<QuestId, QuestState>;
  for (const definition of QUEST_LIST) {
    let status: QuestState['status'];
    if (definition.kind === 'main') status = definition.order === 1 ? 'active' : 'locked';
    else if (definition.autoStart) status = 'active';
    else status = definition.requiresQuests.length === 0 ? 'available' : 'locked';
    quests[definition.id] = { status, progress: definition.objectives.map(() => 0) };
  }
  return quests;
}

export function objectivesDone(state: GameState, questId: QuestId): boolean {
  const definition = QUESTS[questId];
  const progress = state.quests[questId].progress;
  return definition.objectives.every((objective, index) => progress[index] >= objectiveRequired(objective));
}

/**
 * True when a quest-gated node action may be used: the quest is active and
 * every other objective is done.
 */
export function questGateOpen(state: GameState, questId: QuestId, nodeId: NodeId): boolean {
  if (state.quests[questId].status !== 'active') return false;
  const definition = QUESTS[questId];
  const progress = state.quests[questId].progress;
  return definition.objectives.every((objective, index) =>
    (objective.type === 'node' && objective.nodeId === nodeId) || progress[index] >= objectiveRequired(objective));
}

/** True while a quest is open: given to the crew and not yet handed in. */
const isOpen = (questState: QuestState): boolean => questState.status === 'active' || questState.status === 'ready';

/**
 * Whether a step is remembered before its quest is given. Everything is, a craft too: pitch cooked before "Stop
 * the leak" opens counts toward "Cook pitch" (Luc's list, line 6; review finding 14). Two kinds of step belong to
 * the quest's own time: a hand-over (checked live, when the quest asks) and sleep ("sleep at the lean-to"), which
 * can be done again any night, so it can never strand a quest.
 */
const countsBeforeGiven = (objective: ObjectiveDefinition): boolean =>
  objective.type !== 'deliver' && objective.type !== 'sleep';

function setProgress(state: GameState, questId: QuestId, index: number, value: number): void {
  const questState = state.quests[questId];
  if (questState.progress[index] === value) return;
  const advanced = value > questState.progress[index];
  questState.progress[index] = value;
  // A quest the crew has not been given yet remembers in silence. It tells them when it is given.
  if (advanced && isOpen(questState)) {
    emit(state, {
      type: 'quest_advanced', questId, objectiveIndex: index, progress: value,
      required: objectiveRequired(QUESTS[questId].objectives[index]),
    });
  }
}

/**
 * A quest has just been given: say which steps it already carries (done
 * before it was given), so the quest log and the toasts show them ticked.
 */
function announceCarriedProgress(state: GameState, questId: QuestId): void {
  const definition = QUESTS[questId];
  definition.objectives.forEach((objective, index) => {
    const progress = state.quests[questId].progress[index];
    if (progress > 0) {
      emit(state, { type: 'quest_advanced', questId, objectiveIndex: index, progress, required: objectiveRequired(objective) });
    }
  });
}

/**
 * Who a quest pays when nobody in particular finished it (the tick found it
 * done): the first player aboard, or the first player.
 */
function defaultActor(state: GameState): PlayerState {
  const present = connectedPlayers(state);
  return present.find((player) => player.mode === 'canoe') ?? present[0] ?? state.players[0];
}

function completeQuest(state: GameState, questId: QuestId, actor: PlayerState): void {
  const definition = QUESTS[questId];
  state.quests[questId].status = 'completed';
  for (const objective of definition.objectives) {
    if (objective.type !== 'deliver') continue;
    // The delivery comes out of the actor's backpack, then the cargo, then the rest of the crew's backpacks.
    let remaining = objective.count - removeFromStacks(actor.backpack, objective.itemId, objective.count);
    if (remaining > 0) remaining -= removeFromStacks(state.canoe.cargo, objective.itemId, remaining);
    for (const player of connectedPlayers(state)) {
      if (remaining > 0 && player !== actor) remaining -= removeFromStacks(player.backpack, objective.itemId, remaining);
    }
    emit(state, { type: 'item_lost', itemId: objective.itemId, count: objective.count });
  }
  for (const flag of definition.rewards.flags) state.flags[flag] = true;
  const leftover = grantItems(state, actor, definition.rewards.items);
  if (leftover.length > 0) {
    state.pendingRewards.push(...leftover);
    emit(state, { type: 'rewards_pending' });
  }
  emit(state, { type: 'quest_completed', questId });
  if (definition.kind === 'main') {
    const next = MAIN_QUESTS.find((candidate) => candidate.order === definition.order + 1);
    if (next) {
      state.quests[next.id].status = 'active';
      emit(state, { type: 'quest_started', questId: next.id });
      announceCarriedProgress(state, next.id);
    } else {
      emit(state, { type: 'game_completed' });
    }
  }
  afterQuestCompleted(state, questId);
}

/**
 * Re-read every quest from the state: unlock, advance, ready and complete.
 * `actor` is the player whose action called for it; a quest that completes
 * here pays them.
 */
export function updateQuests(state: GameState, actor: PlayerState = defaultActor(state)): void {
  // A completion can unlock or finish the next quest, so loop until settled.
  for (let pass = 0; pass < QUEST_LIST.length; pass += 1) {
    let changed = false;
    for (const definition of QUEST_LIST) {
      const questState = state.quests[definition.id];
      if (questState.status === 'completed') continue;
      if (questState.status === 'locked' && definition.kind === 'side'
        && definition.requiresQuests.every((required) => state.quests[required].status === 'completed')) {
        questState.status = 'available';
        changed = true;
      }
      // The one rule: every quest that is not finished keeps its own record from the first moment of the game,
      // whether or not it has been given yet. A step done early is already ticked when the quest arrives.
      // The exceptions are in `countsBeforeGiven`.
      definition.objectives.forEach((objective, index) => {
        if (!isOpen(questState) && !countsBeforeGiven(objective)) return;
        const measured = measuredProgress(state, objective);
        if (measured === null) return;
        // Deliveries are checked live. Everything else latches.
        const value = objective.type === 'deliver' ? measured : Math.max(questState.progress[index], measured);
        setProgress(state, definition.id, index, value);
      });
      if (!isOpen(questState)) continue;
      const done = objectivesDone(state, definition.id);
      if (done && definition.autoComplete) {
        completeQuest(state, definition.id, actor);
        changed = true;
      } else if (done && questState.status === 'active') {
        questState.status = 'ready';
        emit(state, { type: 'quest_ready', questId: definition.id });
      } else if (!done && questState.status === 'ready') {
        questState.status = 'active';
      }
    }
    if (!changed) break;
  }
}

function advanceEventObjectives(state: GameState, matches: (objective: ObjectiveDefinition) => boolean, amount: number): void {
  for (const definition of QUEST_LIST) {
    const questState = state.quests[definition.id];
    if (questState.status === 'completed') continue;
    definition.objectives.forEach((objective, index) => {
      if (!matches(objective)) return;
      if (!isOpen(questState) && !countsBeforeGiven(objective)) return;
      setProgress(state, definition.id, index, Math.min(objectiveRequired(objective), questState.progress[index] + amount));
    });
  }
}

export function notifyCrafted(state: GameState, itemId: ItemId, count: number): void {
  advanceEventObjectives(state, (objective) => objective.type === 'craft' && objective.itemIds.includes(itemId), count);
}

export function notifySlept(state: GameState): void {
  advanceEventObjectives(state, (objective) => objective.type === 'sleep', 1);
}

export function notifyTalked(state: GameState, npcId: NpcId): void {
  advanceEventObjectives(state, (objective) => objective.type === 'talk' && objective.npcId === npcId, 1);
}

/** Accept an offered side quest. Returns false when it is not on offer. */
export function acceptQuest(state: GameState, questId: QuestId, actor: PlayerState): boolean {
  if (state.quests[questId].status !== 'available') return false;
  state.quests[questId].status = 'active';
  afterQuestAccepted(actor, questId);
  emit(state, { type: 'quest_started', questId });
  announceCarriedProgress(state, questId);
  updateQuests(state, actor);
  return true;
}

/** Hand in a ready quest. Returns false when its objectives are not all met. */
export function turnInQuest(state: GameState, questId: QuestId, actor: PlayerState): boolean {
  updateQuests(state, actor);
  if (state.quests[questId].status !== 'ready') return false;
  completeQuest(state, questId, actor);
  updateQuests(state, actor);
  return true;
}
