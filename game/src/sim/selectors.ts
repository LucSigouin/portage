/**
 * Read-only views of the state for UI and rendering. Selectors never mutate.
 */
import type {
  AttachmentId, IslandId, ItemId, NpcId, QuestId, QuestStatus, RecipeId, RegionId, StationId, ToolId,
  Transform, WeatherKind,
} from '../data/types.ts';
import { ATTACHMENTS, ATTACHMENT_IDS, HULL_TIERS, attachmentTransformForHull } from '../data/canoe.ts';
import { NPCS, NPC_IDS } from '../data/dialogue.ts';
import { NODES_BY_ID } from '../data/nodes.ts';
import { MAIN_QUESTS, QUESTS, QUEST_LIST } from '../data/quests.ts';
import { RECIPES, RECIPE_IDS } from '../data/recipes.ts';
import { TUNING } from '../data/tuning.ts';
import { WEATHER } from '../data/weather.ts';
import { ISLANDS, ISLANDS_BY_ID, spotPosition } from '../data/world.ts';
import { canCrossFog, canoeStability, floodRate, sailFactor } from './canoe.ts';
import { visibleDialogueOptions } from './commands.ts';
import {
  accessibleStations, attachmentMissing, craftableCount, hullUpgradeMissing, recipeMissing,
} from './crafting.ts';
import { findInteractable } from './interact.ts';
import type { Interactable } from './interact.ts';
import {
  atCanoe, cargoAccessible, cargoSlots, hasAttachment, hasMissing,
} from './inventory.ts';
import { objectiveRequired } from './quests.ts';
import { hourOfDay, isNight, isSheltered, respawnPoint, sleepBlocked } from './survival.ts';
import type { SleepBlock } from './survival.ts';
import type { GameState, ItemStack, Missing } from './types.ts';
import { waterRoughnessAt } from './world.ts';

/** The current interactable and its prompt, or null. */
export function selectInteractable(state: GameState): Interactable | null {
  return findInteractable(state);
}

export interface RecipeAvailability {
  recipeId: RecipeId;
  /** False while a survivor has yet to teach it. */
  known: boolean;
  craftable: boolean;
  /** How many could be made right now. */
  maximumCount: number;
  /** What one craft still needs. Empty lists when craftable. */
  missing: Missing;
}

/** Every recipe with whether it can be made and what it is missing. */
export function selectCraftableRecipes(state: GameState): RecipeAvailability[] {
  return RECIPE_IDS.map((recipeId) => {
    const missing = recipeMissing(state, recipeId);
    const flag = RECIPES[recipeId].requiresFlag;
    return {
      recipeId,
      known: flag === null || state.flags[flag] === true,
      craftable: !hasMissing(missing),
      maximumCount: craftableCount(state, recipeId),
      missing,
    };
  });
}

export interface BuildOptions {
  /** False unless the canoe is beached and the player is at it. */
  canBuildHere: boolean;
  blockedReason: 'canoe_not_beached' | 'not_at_canoe' | null;
  /** The next hull tier, or null at the last tier. */
  hull: { tier: number; buildable: boolean; missing: Missing } | null;
  attachments: {
    attachmentId: AttachmentId;
    built: boolean;
    buildable: boolean;
    missing: Missing;
    /** Where it sits on the current hull, in canoe space. */
    transform: Transform;
  }[];
}

/** The canoe builder panel: the next hull and every attachment. */
export function selectBuildOptions(state: GameState): BuildOptions {
  const blockedReason = !state.canoe.beached ? 'canoe_not_beached' : !atCanoe(state) ? 'not_at_canoe' : null;
  const canBuildHere = blockedReason === null;
  const hullMissing = hullUpgradeMissing(state);
  return {
    canBuildHere,
    blockedReason,
    hull: hullMissing
      ? { tier: state.canoe.hullTier + 1, buildable: canBuildHere && !hasMissing(hullMissing), missing: hullMissing }
      : null,
    attachments: ATTACHMENT_IDS.map((attachmentId) => {
      const built = state.canoe.attachments.includes(attachmentId);
      const missing = attachmentMissing(state, attachmentId);
      return {
        attachmentId, built, missing,
        buildable: canBuildHere && !built && !hasMissing(missing),
        transform: attachmentTransformForHull(attachmentId, Math.max(state.canoe.hullTier, ATTACHMENTS[attachmentId].minimumHullTier)),
      };
    }),
  };
}

export interface CanoeStats {
  hullTier: number;
  hullName: string;
  stability: number;
  /** Water roughness where the canoe is, weather included. */
  roughnessHere: number;
  cargoSlots: number;
  cargoUsed: number;
  paddleSpeed: number;
  powerStrokeSpeed: number;
  sailMaximumSpeed: number;
  hasSail: boolean;
  /** 0 to 1: how well the sail would pull on the current heading. */
  sailFactor: number;
  turnRate: number;
  /** Water level points per second from the hull leak. */
  leakPerSecond: number;
  /** Water level points per second from rough water, right now. */
  floodPerSecond: number;
  bailPerSecond: number;
  canCrossFog: boolean;
  /** Stations the canoe carries. */
  stations: StationId[];
}

export function selectCanoeStats(state: GameState): CanoeStats {
  const hull = HULL_TIERS[state.canoe.hullTier];
  const hasRudder = hasAttachment(state, 'rudder');
  return {
    hullTier: hull.tier,
    hullName: hull.name,
    stability: canoeStability(state),
    roughnessHere: waterRoughnessAt(state.canoe.position.x, state.canoe.position.z, state.weather.stormLevel),
    cargoSlots: cargoSlots(state),
    cargoUsed: state.canoe.cargo.length,
    paddleSpeed: TUNING.canoe.paddleSpeed * hull.speedMultiplier,
    powerStrokeSpeed: TUNING.canoe.powerStrokeSpeed * hull.speedMultiplier,
    sailMaximumSpeed: TUNING.canoe.sailMaximumSpeed,
    hasSail: hasAttachment(state, 'mast_sail'),
    sailFactor: sailFactor(state.canoe.heading, state.weather.windDirection, hasRudder),
    turnRate: hasRudder ? TUNING.canoe.rudderTurnRate : TUNING.canoe.turnRate,
    leakPerSecond: hull.leakPerSecond,
    floodPerSecond: state.canoe.beached ? 0 : floodRate(state),
    bailPerSecond: TUNING.canoe.bailPerSecond,
    canCrossFog: canCrossFog(state),
    stations: state.canoe.attachments
      .map((attachmentId) => ATTACHMENTS[attachmentId].station)
      .filter((station): station is StationId => station !== null),
  };
}

export interface ObjectiveView {
  text: string;
  progress: number;
  required: number;
  done: boolean;
}

export interface QuestView {
  questId: QuestId;
  name: string;
  description: string;
  kind: 'main' | 'side';
  status: QuestStatus;
  giver: NpcId | null;
  tracked: boolean;
  objectives: ObjectiveView[];
}

function questView(state: GameState, questId: QuestId): QuestView {
  const definition = QUESTS[questId];
  const questState = state.quests[questId];
  return {
    questId,
    name: definition.name,
    description: definition.description,
    kind: definition.kind,
    status: questState.status,
    giver: definition.giver,
    tracked: state.trackedQuestId === questId,
    objectives: definition.objectives.map((objective, index) => {
      const required = objectiveRequired(objective);
      const progress = Math.min(required, questState.progress[index]);
      return { text: objective.text, progress, required, done: progress >= required };
    }),
  };
}

function shownInLog(state: GameState, questId: QuestId): boolean {
  const definition = QUESTS[questId];
  const questState = state.quests[questId];
  return !definition.hiddenUntilProgress || questState.status === 'completed' || questState.progress.some((value) => value > 0);
}

/** Active and ready quests with objective progress. The tracked quest comes first. */
export function selectActiveQuests(state: GameState): QuestView[] {
  return QUEST_LIST
    .filter((definition) => {
      const status = state.quests[definition.id].status;
      return (status === 'active' || status === 'ready') && shownInLog(state, definition.id);
    })
    .map((definition) => questView(state, definition.id))
    .sort((first, second) => Number(second.tracked) - Number(first.tracked));
}

/** Everything for the quest log: active, ready, on offer and completed. */
export function selectQuestLog(state: GameState): QuestView[] {
  return QUEST_LIST
    .filter((definition) => state.quests[definition.id].status !== 'locked' && shownInLog(state, definition.id))
    .map((definition) => questView(state, definition.id));
}

export interface MapMarker {
  kind: 'player' | 'canoe' | 'respawn' | 'quest' | 'survivor';
  label: string;
  position: { x: number; z: number };
  islandId: IslandId | null;
  questId: QuestId | null;
}

export interface MapData {
  /** True with the map table: every island is charted, with bearings. */
  fullChart: boolean;
  islands: {
    islandId: IslandId;
    name: string;
    regionId: RegionId;
    position: { x: number; z: number };
    radiusX: number;
    radiusZ: number;
    rotation: number;
    discovered: boolean;
    /** Bearing and distance from the player. Only with the map table. */
    bearing: number | null;
    distance: number | null;
  }[];
  markers: MapMarker[];
}

/** Island a quest objective points at, if it points anywhere. */
function objectiveIsland(state: GameState, questId: QuestId): IslandId | null {
  const definition = QUESTS[questId];
  const progress = state.quests[questId].progress;
  for (let index = 0; index < definition.objectives.length; index += 1) {
    const objective = definition.objectives[index];
    if (progress[index] >= objectiveRequired(objective)) continue;
    if (objective.type === 'land') return objective.islandId;
    if (objective.type === 'talk') return NPCS[objective.npcId].islandId;
    if (objective.type === 'node') return NODES_BY_ID[objective.nodeId].islandId;
  }
  return definition.giver && state.quests[questId].status === 'ready' ? NPCS[definition.giver].islandId : null;
}

/** Discovered islands and markers. The radio shows quest markers on islands not yet seen. */
export function selectMap(state: GameState): MapData {
  const fullChart = hasAttachment(state, 'map_table');
  const hasRadio = hasAttachment(state, 'radio');
  const { x, z } = state.player.position;
  const discovered = (islandId: IslandId): boolean => fullChart || state.discoveredIslands.includes(islandId);
  const markers: MapMarker[] = [
    { kind: 'player', label: 'You', position: { x, z }, islandId: state.player.islandId, questId: null },
  ];
  if (state.player.mode === 'foot') {
    markers.push({
      kind: 'canoe', label: 'Canoe', position: { x: state.canoe.position.x, z: state.canoe.position.z },
      islandId: state.canoe.beached ? state.canoe.lastBeached.islandId : null, questId: null,
    });
  }
  const respawn = respawnPoint(state);
  markers.push({ kind: 'respawn', label: 'Respawn', position: { x: respawn.x, z: respawn.z }, islandId: respawn.islandId, questId: null });
  for (const npcId of NPC_IDS) {
    const npc = NPCS[npcId];
    if (!discovered(npc.islandId)) continue;
    markers.push({
      kind: 'survivor', label: npc.name, position: spotPosition(ISLANDS_BY_ID[npc.islandId], npc.spot),
      islandId: npc.islandId, questId: null,
    });
  }
  for (const quest of selectActiveQuests(state)) {
    const islandId = objectiveIsland(state, quest.questId);
    if (!islandId || !(discovered(islandId) || hasRadio)) continue;
    markers.push({ kind: 'quest', label: quest.name, position: { ...ISLANDS_BY_ID[islandId].center }, islandId, questId: quest.questId });
  }
  return {
    fullChart,
    islands: ISLANDS.map((definition) => ({
      islandId: definition.id,
      name: definition.name,
      regionId: definition.regionId,
      position: { ...definition.center },
      radiusX: definition.radiusX,
      radiusZ: definition.radiusZ,
      rotation: definition.rotation,
      discovered: discovered(definition.id),
      bearing: fullChart ? Math.atan2(definition.center.x - x, -(definition.center.z - z)) : null,
      distance: fullChart ? Math.hypot(definition.center.x - x, definition.center.z - z) : null,
    })),
    markers,
  };
}

export interface RespawnPoint {
  islandId: IslandId;
  islandName: string;
  position: { x: number; z: number };
  /** True with the canopy: the point follows the canoe. */
  mobile: boolean;
}

/** Where a fail would put the player. */
export function selectRespawnPoint(state: GameState): RespawnPoint {
  const respawn = respawnPoint(state);
  return {
    islandId: respawn.islandId,
    islandName: ISLANDS_BY_ID[respawn.islandId].name,
    position: { x: respawn.x, z: respawn.z },
    mobile: respawn.mobile,
  };
}

export interface TimeOfDay {
  /** Day number, starting at 1. */
  day: number;
  /** 0 to 24. */
  hour: number;
  /** "07:30". */
  clock: string;
  isNight: boolean;
  /** 0 at midnight, 0.5 at noon. For the sun and sky. */
  dayFraction: number;
  /** Why sleeping is refused right now, or null when it is allowed. */
  sleepBlocked: SleepBlock | null;
}

export function selectTimeOfDay(state: GameState): TimeOfDay {
  const hour = hourOfDay(state.time);
  const wholeHours = Math.floor(hour);
  const minutes = Math.floor((hour - wholeHours) * 60);
  return {
    day: Math.floor(state.time / TUNING.time.daySeconds) + 1,
    hour,
    clock: `${String(wholeHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
    isNight: isNight(state.time),
    dayFraction: hour / 24,
    sleepBlocked: sleepBlocked(state),
  };
}

export interface WeatherView {
  kind: WeatherKind;
  name: string;
  /** The sky shows what is coming: the next weather and how soon. */
  nextKind: WeatherKind;
  secondsUntilChange: number;
  /** 0 to 1. Storm strength, easing in and out. */
  stormLevel: number;
  /** Bearing the wind blows toward, radians. */
  windDirection: number;
  windSpeed: number;
  raining: boolean;
  visibility: number;
}

export function selectWeather(state: GameState): WeatherView {
  const definition = WEATHER[state.weather.kind];
  return {
    kind: state.weather.kind,
    name: definition.name,
    nextKind: state.weather.nextKind,
    secondsUntilChange: Math.max(0, state.weather.secondsRemaining),
    stormLevel: state.weather.stormLevel,
    windDirection: state.weather.windDirection,
    windSpeed: state.weather.windSpeed,
    raining: definition.rain,
    visibility: definition.visibility,
  };
}

export interface DialogueView {
  npcId: NpcId;
  name: string;
  text: string;
  /** Pass the index to `choose_dialogue_option`. */
  options: { index: number; text: string }[];
}

/** The open conversation, or null. */
export function selectDialogue(state: GameState): DialogueView | null {
  if (!state.dialogue) return null;
  const npc = NPCS[state.dialogue.npcId];
  return {
    npcId: npc.id,
    name: npc.name,
    text: npc.nodes[state.dialogue.nodeId].text,
    options: visibleDialogueOptions(state).map((option, index) => ({ index, text: option.text })),
  };
}

export interface InventoryView {
  backpack: ItemStack[];
  backpackSlots: number;
  cargo: ItemStack[];
  cargoSlots: number;
  /** False when the canoe is out of reach: cargo is shown but cannot be used. */
  cargoAccessible: boolean;
  tools: ToolId[];
  selectedTool: ToolId | null;
  keyItems: { itemId: ItemId; count: number }[];
  pendingRewards: ItemStack[];
  /** Stations in reach right now, hands included. */
  stations: StationId[];
  stackSize: number;
}

export function selectInventory(state: GameState): InventoryView {
  return {
    backpack: state.player.backpack,
    backpackSlots: TUNING.inventory.backpackSlots,
    cargo: state.canoe.cargo,
    cargoSlots: cargoSlots(state),
    cargoAccessible: cargoAccessible(state),
    tools: state.player.tools,
    selectedTool: state.player.selectedTool,
    keyItems: (Object.entries(state.player.keyItems) as [ItemId, number][]).map(([itemId, count]) => ({ itemId, count })),
    pendingRewards: state.pendingRewards,
    stations: accessibleStations(state),
    stackSize: TUNING.inventory.stackSize,
  };
}

export interface Meters {
  hunger: number;
  thirst: number;
  energy: number;
  /** 40 while starving or parched, otherwise 100. */
  energyCap: number;
  /** Canoe water level, 0 to 100. */
  waterLevel: number;
  /** True when a fire, lit lantern or canopy keeps the cold off. */
  sheltered: boolean;
  low: { hunger: boolean; thirst: boolean; energy: boolean; swamping: boolean };
}

export function selectMeters(state: GameState): Meters {
  const { hunger, thirst, energy } = state.player;
  const threshold = TUNING.survival.lowMeterWarning;
  return {
    hunger, thirst, energy,
    energyCap: hunger <= 0 || thirst <= 0 ? TUNING.survival.starvingEnergyCap : 100,
    waterLevel: state.canoe.waterLevel,
    sheltered: isSheltered(state),
    low: {
      hunger: hunger <= threshold,
      thirst: thirst <= threshold,
      energy: energy <= threshold,
      swamping: state.canoe.waterLevel >= TUNING.canoe.swampWarningLevel,
    },
  };
}

/** The main quest in progress, or null once the Beacon is lit. */
export function selectCurrentMainQuest(state: GameState): QuestId | null {
  return MAIN_QUESTS.find((definition) => state.quests[definition.id].status === 'active')?.id ?? null;
}
