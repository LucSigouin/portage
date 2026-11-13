import type { ItemAmount, LandmarkKind, NodeDefinition, NodeId, NpcId } from '../data/types.ts';
import { ATTACHMENTS, attachmentTransformForHull } from '../data/canoe.ts';
import { NPCS, NPC_IDS } from '../data/dialogue.ts';
import { ITEMS } from '../data/items.ts';
import { LOOT_TABLES, NODES, NODES_BY_ISLAND } from '../data/nodes.ts';
import { TUNING } from '../data/tuning.ts';
import { CAMP_LAYOUTS, ISLANDS_BY_ID, spotPosition } from '../data/world.ts';
import {
  distanceToBed, emit, emptyMissing, grantItems, hasAttachment, hasMissing, hasTool,
} from './inventory.ts';
import { questGateOpen, updateQuests } from './quests.ts';
import { nextRandom, randomInteger } from './random.ts';
import { approachTo, bodyBlocked, freeSpotNear } from './solids.ts';
import { findStandingSpot, terrainHeight } from './world.ts';
import type { Command, GameState, Missing, NodeState, PlayerState } from './types.ts';

const CANOE_NODES = NODES.filter((definition) => definition.reach === 'canoe');

/** Index used for "pick up what was left behind". */
export const PICK_UP_ACTION = -1;

/**
 * The thing the interact key would act on right now. One press dispatches
 * the `command` it carries: scavenge a node, talk, board, land, sleep.
 */
export type Interactable =
  | {
    kind: 'node';
    nodeId: NodeId;
    name: string;
    prompt: string;
    /** Action index in the node definition, or -1 to pick up leftovers. */
    actionIndex: number;
    /** False when a tool, attachment or quest step is missing. */
    available: boolean;
    missing: Missing | null;
    command: Command;
    distance: number;
  }
  | { kind: 'npc'; npcId: NpcId; name: string; prompt: string; command: Command; distance: number }
  | { kind: 'board'; name: string; prompt: string; command: Command; distance: number }
  | { kind: 'land'; name: string; prompt: string; command: Command; distance: number }
  | { kind: 'bed'; name: string; prompt: string; command: Command; distance: number }
  /**
   * A bench to work at: the stump bench in a camp, or the workbench on the canoe. No command: the interact key opens
   * the crafting panel, as the crafting key does (Luc's list, line 21). The panel is the screen's, not the rules'.
   */
  | { kind: 'bench'; name: string; prompt: string; distance: number };

/** The camp landmarks that are a bench to work at. */
const BENCH_KINDS: readonly LandmarkKind[] = ['stump_bench'];

/** Where the workbench stands on the canoe now, in world metres: its mount, turned with the hull. */
export function workbenchPosition(state: GameState): { x: number; z: number } {
  const canoe = state.canoe;
  const [x, , z] = attachmentTransformForHull('workbench', Math.max(canoe.hullTier, ATTACHMENTS.workbench.minimumHullTier)).position;
  // Canoe space: starboard is +x, the bow is -z.
  const forwardX = Math.sin(canoe.heading);
  const forwardZ = -Math.cos(canoe.heading);
  return { x: canoe.position.x + forwardX * -z - forwardZ * x, z: canoe.position.z + forwardZ * -z + forwardX * x };
}

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
export function chooseNodeAction(
  state: GameState,
  player: PlayerState,
  definition: NodeDefinition,
): { actionIndex: number; allowed: boolean } | null {
  const nodeState = state.nodes[definition.id];
  if (nodeState && nodeState.leftover.length > 0) return { actionIndex: PICK_UP_ACTION, allowed: true };
  const ready = definition.actions.map((_, index) => index).filter((index) => actionReady(state, definition.id, index));
  if (ready.length === 0) return null;
  const selectedTool = player.selectedTool;
  const selected = ready.find((index) => selectedTool !== null && definition.actions[index].tool === selectedTool
    && actionAllowed(state, definition, index));
  if (selected !== undefined) return { actionIndex: selected, allowed: true };
  const allowed = ready.find((index) => actionAllowed(state, definition, index));
  if (allowed !== undefined) return { actionIndex: allowed, allowed: true };
  return { actionIndex: ready[0], allowed: false };
}

function nodeInteractable(state: GameState, player: PlayerState, definition: NodeDefinition, distance: number): Interactable | null {
  const choice = chooseNodeAction(state, player, definition);
  if (!choice) return null;
  const command: Command = { type: 'scavenge' };
  if (choice.actionIndex === PICK_UP_ACTION) {
    return {
      kind: 'node', nodeId: definition.id, name: definition.name, prompt: `Pick up from ${definition.name}`,
      actionIndex: PICK_UP_ACTION, available: true, missing: null, command, distance,
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
    actionIndex: choice.actionIndex,
    available: choice.allowed, missing: hasMissing(missing) ? missing : null, command, distance,
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

/** Where someone would step ashore from a hull lying at this point and heading, or null. */
export function shoreSpotBeside(x: number, z: number, heading: number): { x: number; z: number } | null {
  const forwardX = Math.sin(heading);
  const forwardZ = -Math.cos(heading);
  const reach = TUNING.canoe.disembarkReach;
  for (const alongHull of [2.2, 0, -2.2]) {
    const spot = findStandingSpot(x + forwardX * alongHull, z + forwardZ * alongHull, reach);
    if (spot) return spot;
  }
  return null;
}

/** Where a player would step ashore from the canoe, or null. */
export function disembarkSpot(state: GameState): { x: number; z: number } | null {
  return shoreSpotBeside(state.canoe.position.x, state.canoe.position.z, state.canoe.heading);
}

/** Largest distance at which two people on foot count as standing on the same spot, metres. */
const ELBOW_ROOM = 0.6;

/**
 * A spot beside `spot` that no other player is standing on, so a crew stepping
 * ashore does not pile onto one point. Alone, or with the spot free, it is `spot`.
 */
export function clearSpot(state: GameState, player: PlayerState, spot: { x: number; z: number }): { x: number; z: number } {
  const crowded = (x: number, z: number): boolean => state.players.some((other) => other !== player && other.mode === 'foot'
    && Math.hypot(other.position.x - x, other.position.z - z) < ELBOW_ROOM);
  // Never inside a tree, a rock or a landmark: the nearest clear ground, where there is any.
  const clear = bodyBlocked(spot.x, spot.z) ? freeSpotNear(spot.x, spot.z, CLEAR_REACH) ?? spot : spot;
  if (!crowded(clear.x, clear.z)) return clear;
  for (let step = 0; step < 8; step += 1) {
    const angle = state.canoe.heading + (step / 8) * 2 * Math.PI;
    const x = clear.x + Math.sin(angle) * 0.9;
    const z = clear.z - Math.cos(angle) * 0.9;
    if (terrainHeight(x, z) >= -TUNING.foot.disembarkDepth && !crowded(x, z) && !bodyBlocked(x, z)) return { x, z };
  }
  return clear;
}

/** How far a landing or a waking looks for clear ground round a spot in a solid, metres. */
const CLEAR_REACH = 4;

/** The nearest thing the interact key would act on for this player, or null. */
export function findInteractable(state: GameState, player: PlayerState): Interactable | null {
  if (player.dialogue) return null;
  if (player.asleep) {
    return { kind: 'bed', name: 'Camp', prompt: 'Get up (waiting for the crew to sleep)', command: { type: 'wake' }, distance: 0 };
  }
  let best: Interactable | null = null;
  const consider = (candidate: Interactable | null): void => {
    if (candidate && (!best || candidate.distance < best.distance)) best = candidate;
  };

  if (player.mode === 'canoe') {
    for (const definition of CANOE_NODES) {
      const distance = Math.hypot(definition.position.x - state.canoe.position.x, definition.position.z - state.canoe.position.z);
      if (distance <= TUNING.foot.canoeNodeRange) consider(nodeInteractable(state, player, definition, distance));
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
      // A spot inside a landmark (an attic in a roof, the lamp at the tower's foot) is reached from its edge.
      const depth = approachTo(definition.position.x, definition.position.z).depth;
      if (distance <= TUNING.foot.nodeRange + depth) consider(nodeInteractable(state, player, definition, distance - depth));
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
    // A bench: F opens the crafting panel. Only where the camp has the bench station.
    if (ISLANDS_BY_ID[player.islandId].camp?.stations.includes('bench')) {
      for (const landmark of CAMP_LAYOUTS[player.islandId]?.landmarks ?? []) {
        if (!BENCH_KINDS.includes(landmark.kind)) continue;
        const distance = Math.hypot(landmark.x - player.position.x, landmark.z - player.position.z);
        if (distance <= TUNING.foot.benchRange) consider({ kind: 'bench', name: 'Stump bench', prompt: 'Use the bench', distance });
      }
    }
    // Only a bed sleeps: the lean-to, a bedroll, the keeper's hut. The fire warms and cooks.
    const bed = distanceToBed(player);
    if (bed !== null) consider({ kind: 'bed', name: 'Camp', prompt: 'Sleep until morning', command: { type: 'sleep' }, distance: bed });
  }
  if (hasAttachment(state, 'workbench')) {
    const bench = workbenchPosition(state);
    const distance = Math.hypot(bench.x - player.position.x, bench.z - player.position.z);
    if (distance <= TUNING.foot.workbenchRange) consider({ kind: 'bench', name: 'Workbench', prompt: 'Use the bench', distance });
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

/** `items` less what is in `leftover`: what actually reached the player. */
function taken(items: ItemAmount[], leftover: ItemAmount[]): ItemAmount[] {
  return items
    .map(({ itemId, count }) => ({ itemId, count: count - leftover.filter((stack) => stack.itemId === itemId).reduce((sum, stack) => sum + stack.count, 0) }))
    .filter((stack) => stack.count > 0);
}

/**
 * Scavenge a node action, or pick up what an earlier one left behind. It
 * happens at once: the loot is rolled and handed over, the energy is spent
 * and the action goes on its respawn clock. Returns what the player got.
 * The caller has checked the tool, the quest gate and the energy.
 */
export function completeHarvest(state: GameState, player: PlayerState, definition: NodeDefinition, actionIndex: number): ItemAmount[] {
  const nodeState = nodeStateFor(state, definition);
  if (actionIndex === PICK_UP_ACTION) {
    const waiting = nodeState.leftover;
    nodeState.leftover = grantItems(state, player, waiting);
    return taken(waiting, nodeState.leftover);
  }
  const action = definition.actions[actionIndex];
  const loot = rollLoot(state, action.lootTableId);
  const leftover = grantItems(state, player, loot);
  for (const stack of leftover) {
    nodeState.leftover.push(stack);
    emit(state, { type: 'item_left_behind', nodeId: definition.id, itemId: stack.itemId, count: stack.count }, player);
  }
  // One wait for every action that refills (Luc, 2026-11-13: ten minutes); a never stays empty for good.
  nodeState.readyAt[actionIndex] = action.respawnDays === null ? null : state.time + TUNING.nodes.refillSeconds;
  player.energy = Math.max(0, player.energy - action.energyCost);
  state.statistics.nodesHarvested += 1;
  emit(state, { type: 'node_depleted', nodeId: definition.id }, player);
  if (definition.bottleId && !state.bottlesFound.includes(definition.bottleId)) {
    state.bottlesFound.push(definition.bottleId);
    emit(state, { type: 'bottle_found', bottleId: definition.bottleId });
  }
  if (definition.typeId === 'wreck_buoy') {
    state.statistics.cachesHauled += 1;
    emit(state, { type: 'cache_hauled', nodeId: definition.id });
  }
  updateQuests(state, player);
  return taken(loot, leftover);
}
