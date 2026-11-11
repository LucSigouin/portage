import type { ItemAmount, NodeDefinition, NodeId, NpcId } from '../data/types.ts';
import { NPCS, NPC_IDS } from '../data/dialogue.ts';
import { ITEMS } from '../data/items.ts';
import { LOOT_TABLES, NODES, NODES_BY_ID, NODES_BY_ISLAND } from '../data/nodes.ts';
import { TUNING } from '../data/tuning.ts';
import { ISLANDS_BY_ID, spotPosition } from '../data/world.ts';
import {
  campInReach, emit, emptyMissing, grantItems, hasAttachment, hasMissing, hasTool,
} from './inventory.ts';
import { questGateOpen, updateQuests } from './quests.ts';
import { nextRandom, randomInteger } from './random.ts';
import { findStandingSpot } from './world.ts';
import type { Command, GameState, Missing, NodeState } from './types.ts';

const CANOE_NODES = NODES.filter((definition) => definition.reach === 'canoe');

/** Index used for "pick up what was left behind". */
export const PICK_UP_ACTION = -1;
const PICK_UP_SECONDS = 0.5;

/**
 * The thing the interact key would act on right now.
 * - `node`: hold the interact input (`StepInput.interactHeld`) for `holdSeconds`.
 * - everything else: dispatch `command` on key press.
 */
export type Interactable =
  | {
    kind: 'node';
    nodeId: NodeId;
    name: string;
    prompt: string;
    /** Action index in the node definition, or -1 to pick up leftovers. */
    actionIndex: number;
    holdSeconds: number;
    /** 0 to 1, how far the current hold has got. */
    progress: number;
    /** False when a tool, attachment or quest step is missing. */
    available: boolean;
    missing: Missing | null;
    distance: number;
  }
  | { kind: 'npc'; npcId: NpcId; name: string; prompt: string; command: Command; distance: number }
  | { kind: 'board'; name: string; prompt: string; command: Command; distance: number }
  | { kind: 'land'; name: string; prompt: string; command: Command; distance: number }
  | { kind: 'bed'; name: string; prompt: string; command: Command; distance: number };

export function actionReady(state: GameState, nodeId: NodeId, actionIndex: number): boolean {
  const nodeState = state.nodes[nodeId];
  if (!nodeState) return true;
  const readyAt = nodeState.readyAt[actionIndex];
  return readyAt !== null && readyAt <= state.time;
}

/** What a node action still needs: tool, attachment or quest progress. */
function actionMissing(state: GameState, definition: NodeDefinition, actionIndex: number): Missing {
  const action = definition.actions[actionIndex];
  const missing = emptyMissing();
  if (action.tool && !hasTool(state, action.tool)) missing.tools.push(action.tool);
  if (action.attachment && !hasAttachment(state, action.attachment)) missing.attachments.push(action.attachment);
  return missing;
}

function actionAllowed(state: GameState, definition: NodeDefinition, actionIndex: number): boolean {
  const action = definition.actions[actionIndex];
  if (action.questGate && !questGateOpen(state, action.questGate, definition.id)) return false;
  return !hasMissing(actionMissing(state, definition, actionIndex));
}

/**
 * Which action the interact key would run on a node, or null when the node
 * has nothing to offer. Order: leftovers, then the action matching the
 * selected tool, then the first action the player can do, then the first one
 * still available (reported with what it is missing).
 */
export function chooseNodeAction(state: GameState, definition: NodeDefinition): { actionIndex: number; allowed: boolean } | null {
  const nodeState = state.nodes[definition.id];
  if (nodeState && nodeState.leftover.length > 0) return { actionIndex: PICK_UP_ACTION, allowed: true };
  const ready = definition.actions.map((_, index) => index).filter((index) => actionReady(state, definition.id, index));
  if (ready.length === 0) return null;
  const selectedTool = state.player.selectedTool;
  const selected = ready.find((index) => selectedTool !== null && definition.actions[index].tool === selectedTool
    && actionAllowed(state, definition, index));
  if (selected !== undefined) return { actionIndex: selected, allowed: true };
  const allowed = ready.find((index) => actionAllowed(state, definition, index));
  if (allowed !== undefined) return { actionIndex: allowed, allowed: true };
  return { actionIndex: ready[0], allowed: false };
}

function nodeInteractable(state: GameState, definition: NodeDefinition, distance: number): Interactable | null {
  const choice = chooseNodeAction(state, definition);
  if (!choice) return null;
  const harvest = state.player.harvest;
  const holding = harvest !== null && harvest.nodeId === definition.id && harvest.actionIndex === choice.actionIndex;
  if (choice.actionIndex === PICK_UP_ACTION) {
    return {
      kind: 'node', nodeId: definition.id, name: definition.name, prompt: `Pick up from ${definition.name}`,
      actionIndex: PICK_UP_ACTION, holdSeconds: PICK_UP_SECONDS,
      progress: holding ? harvest.progress / PICK_UP_SECONDS : 0, available: true, missing: null, distance,
    };
  }
  const action = definition.actions[choice.actionIndex];
  const missing = actionMissing(state, definition, choice.actionIndex);
  let prompt = `${action.verb}: ${definition.name}`;
  if (!choice.allowed) {
    if (missing.tools.length > 0) prompt = `${definition.name} needs ${ITEMS[missing.tools[0]].name.toLowerCase()}`;
    else if (missing.attachments.length > 0) prompt = `${definition.name} needs the ${missing.attachments[0].replace(/_/g, ' ')}`;
    else prompt = `${definition.name}: not yet`;
  }
  return {
    kind: 'node', nodeId: definition.id, name: definition.name, prompt,
    actionIndex: choice.actionIndex, holdSeconds: action.seconds,
    progress: holding ? harvest.progress / action.seconds : 0,
    available: choice.allowed, missing: hasMissing(missing) ? missing : null, distance,
  };
}

/** Distance from a point to the canoe's centreline (bow to stern). */
export function distanceToHull(state: GameState, x: number, z: number): number {
  const canoe = state.canoe;
  const forwardX = Math.sin(canoe.heading);
  const forwardZ = -Math.cos(canoe.heading);
  const offsetX = x - canoe.position.x;
  const offsetZ = z - canoe.position.z;
  const half = 2.4;
  const alongHull = Math.max(-half, Math.min(half, offsetX * forwardX + offsetZ * forwardZ));
  return Math.hypot(offsetX - forwardX * alongHull, offsetZ - forwardZ * alongHull);
}

/** Where the player would step ashore from the canoe, or null. */
export function disembarkSpot(state: GameState): { x: number; z: number } | null {
  const canoe = state.canoe;
  const forwardX = Math.sin(canoe.heading);
  const forwardZ = -Math.cos(canoe.heading);
  const reach = TUNING.canoe.disembarkReach;
  for (const alongHull of [2.2, 0, -2.2]) {
    const spot = findStandingSpot(canoe.position.x + forwardX * alongHull, canoe.position.z + forwardZ * alongHull, reach);
    if (spot) return spot;
  }
  return null;
}

/** The nearest thing the interact key would act on, or null. */
export function findInteractable(state: GameState): Interactable | null {
  if (state.dialogue) return null;
  const player = state.player;
  let best: Interactable | null = null;
  const consider = (candidate: Interactable | null): void => {
    if (candidate && (!best || candidate.distance < best.distance)) best = candidate;
  };

  if (player.mode === 'canoe') {
    for (const definition of CANOE_NODES) {
      const distance = Math.hypot(definition.position.x - state.canoe.position.x, definition.position.z - state.canoe.position.z);
      if (distance <= TUNING.foot.canoeNodeRange) consider(nodeInteractable(state, definition, distance));
    }
    if (!best && disembarkSpot(state)) {
      best = { kind: 'land', name: 'Shore', prompt: 'Land', command: { type: 'disembark' }, distance: 0 };
    }
    return best;
  }

  if (player.islandId) {
    for (const definition of NODES_BY_ISLAND[player.islandId]) {
      if (definition.reach !== 'foot') continue;
      const distance = Math.hypot(definition.position.x - player.position.x, definition.position.z - player.position.z);
      if (distance <= TUNING.foot.nodeRange) consider(nodeInteractable(state, definition, distance));
    }
    for (const npcId of NPC_IDS) {
      const npc = NPCS[npcId];
      if (npc.islandId !== player.islandId) continue;
      const position = spotPosition(ISLANDS_BY_ID[npc.islandId], npc.spot);
      const distance = Math.hypot(position.x - player.position.x, position.z - player.position.z);
      if (distance <= TUNING.foot.npcRange) {
        consider({ kind: 'npc', npcId, name: npc.name, prompt: `Talk to ${npc.name}`, command: { type: 'talk', npcId }, distance });
      }
    }
    const camp = campInReach(state);
    if (camp?.camp?.sleep) {
      const position = spotPosition(camp, camp.camp.spot);
      const distance = Math.hypot(position.x - player.position.x, position.z - player.position.z);
      if (distance <= TUNING.foot.nodeRange) {
        consider({ kind: 'bed', name: 'Camp', prompt: 'Sleep until morning', command: { type: 'sleep' }, distance });
      }
    }
  }
  const hullDistance = distanceToHull(state, player.position.x, player.position.z);
  if (hullDistance <= TUNING.canoe.boardRange) {
    consider({ kind: 'board', name: 'Canoe', prompt: 'Board the canoe', command: { type: 'board' }, distance: hullDistance });
  }
  return best;
}

function rollLoot(state: GameState, lootTableId: string): ItemAmount[] {
  const table = LOOT_TABLES[lootTableId];
  const totals = new Map<ItemAmount['itemId'], number>();
  const add = (itemId: ItemAmount['itemId'], count: number): void => {
    if (count > 0) totals.set(itemId, (totals.get(itemId) ?? 0) + count);
  };
  for (const entry of table.guaranteed) add(entry.itemId, randomInteger(state, entry.minimum, entry.maximum));
  const totalWeight = table.pool.reduce((sum, entry) => sum + entry.weight, 0);
  for (let roll = 0; roll < table.rolls && totalWeight > 0; roll += 1) {
    let pick = nextRandom(state) * totalWeight;
    for (const entry of table.pool) {
      pick -= entry.weight;
      if (pick < 0) {
        add(entry.itemId, randomInteger(state, entry.minimum, entry.maximum));
        break;
      }
    }
  }
  return [...totals].map(([itemId, count]) => ({ itemId, count }));
}

function nodeStateFor(state: GameState, definition: NodeDefinition): NodeState {
  let nodeState = state.nodes[definition.id];
  if (!nodeState) {
    nodeState = { readyAt: definition.actions.map(() => 0), leftover: [] };
    state.nodes[definition.id] = nodeState;
  }
  return nodeState;
}

function completeHarvest(state: GameState, definition: NodeDefinition, actionIndex: number): void {
  const nodeState = nodeStateFor(state, definition);
  if (actionIndex === PICK_UP_ACTION) {
    nodeState.leftover = grantItems(state, nodeState.leftover);
    return;
  }
  const action = definition.actions[actionIndex];
  const leftover = grantItems(state, rollLoot(state, action.lootTableId));
  for (const stack of leftover) {
    nodeState.leftover.push(stack);
    emit(state, { type: 'item_left_behind', nodeId: definition.id, itemId: stack.itemId, count: stack.count });
  }
  nodeState.readyAt[actionIndex] = action.respawnDays === null
    ? null
    : state.time + action.respawnDays * TUNING.time.daySeconds;
  state.player.energy = Math.max(0, state.player.energy - action.energyCost);
  state.statistics.nodesHarvested += 1;
  emit(state, { type: 'node_depleted', nodeId: definition.id });
  if (definition.bottleId && !state.bottlesFound.includes(definition.bottleId)) {
    state.bottlesFound.push(definition.bottleId);
    emit(state, { type: 'bottle_found', bottleId: definition.bottleId });
  }
  if (definition.typeId === 'wreck_buoy') {
    state.statistics.cachesHauled += 1;
    emit(state, { type: 'cache_hauled', nodeId: definition.id });
  }
  updateQuests(state);
}

/** Advance (or drop) the scavenge hold. Called every fixed step. */
export function updateHarvest(state: GameState, interactHeld: boolean, deltaSeconds: number): void {
  const player = state.player;
  const pressed = interactHeld && !player.interactWasHeld;
  player.interactWasHeld = interactHeld;
  if (!interactHeld || state.dialogue) {
    player.harvest = null;
    return;
  }
  const target = findInteractable(state);
  if (!target || target.kind !== 'node') {
    player.harvest = null;
    return;
  }
  if (!target.available) {
    player.harvest = null;
    if (pressed && target.missing) emit(state, { type: 'harvest_blocked', nodeId: target.nodeId, missing: target.missing });
    return;
  }
  const definition = NODES_BY_ID[target.nodeId];
  if (target.actionIndex !== PICK_UP_ACTION) {
    const energyCost = definition.actions[target.actionIndex].energyCost;
    if (energyCost > 0 && player.energy < TUNING.survival.minimumEnergyToExert + energyCost) {
      player.harvest = null;
      return;
    }
  }
  if (!player.harvest || player.harvest.nodeId !== target.nodeId || player.harvest.actionIndex !== target.actionIndex) {
    player.harvest = { nodeId: target.nodeId, actionIndex: target.actionIndex, progress: 0 };
    emit(state, { type: 'harvest_started', nodeId: target.nodeId });
  }
  player.harvest.progress += deltaSeconds;
  if (player.harvest.progress >= target.holdSeconds - 1e-9) {
    const actionIndex = player.harvest.actionIndex;
    player.harvest = null;
    completeHarvest(state, definition, actionIndex);
  }
}
