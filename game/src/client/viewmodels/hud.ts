/** The HUD: meters, water gauge, hotbar, quest tracker, compass, prompt and status lines. */
import { ISLANDS_BY_ID, ITEMS, REGIONS_BY_ID, WEATHER } from '../../data/index.ts';
import { CREW_MARKS } from '../../data/crew.ts';
import type { Settings } from '../../settings/index.ts';
import {
  bearingBetween, bearingDifference, playerOf, selectActiveQuests, selectCanoeStats, selectInteractable, selectMap,
  selectMeters, selectTimeOfDay, selectWeather,
} from '../../sim/index.ts';
import type { GameState, PlayerId, PlayerState, QuestView } from '../../sim/index.ts';
import { bearingDegrees, cardinalName, distanceText, durationText, primaryKey } from './format.ts';
import type {
  CompassMarkModel, CompassModel, CrewRowModel, HotbarSlotModel, HudModel, MeterModel, ObjectiveRowModel, PromptModel,
  QuestTrackerModel, Tone, WaterGaugeModel,
} from './types.ts';

export const HOTBAR_SLOTS = 5;

/** Degrees to two decimals: fine enough for the compass to glide, coarse enough to sit still. */
const hundredths = (degrees: number): number => Math.round(degrees * 100) / 100;
const HOTBAR_ACTIONS = ['tool1', 'tool2', 'tool3', 'tool4', 'tool5'] as const;

export function objectiveRows(quest: QuestView): ObjectiveRowModel[] {
  return quest.objectives.map((objective) => ({
    text: objective.text,
    progressText: objective.required > 1 ? `${Math.floor(objective.progress)} / ${objective.required}` : '',
    done: objective.done,
  }));
}

function buildMeters(state: GameState, playerId: PlayerId): MeterModel[] {
  const meters = selectMeters(state, playerId);
  return [
    { id: 'hunger', label: 'Hunger', value: Math.round(meters.hunger), cap: 100, low: meters.low.hunger, pattern: 'stripes' },
    { id: 'thirst', label: 'Thirst', value: Math.round(meters.thirst), cap: 100, low: meters.low.thirst, pattern: 'waves' },
    { id: 'energy', label: 'Energy', value: Math.round(meters.energy), cap: meters.energyCap, low: meters.low.energy, pattern: 'dots' },
  ];
}

/**
 * A crewmate this close is with you: no distance beside their name and no mark of their own on the
 * compass or the map. Further off they get both. The whole canoe is well inside it.
 */
export const CREW_WITH_YOU_METRES = 10;

/** How a crew member is told apart: their label and toque colour, by player id. */
export function crewMark(playerId: PlayerId): { label: string; color: string } {
  const mark = CREW_MARKS[playerId] ?? CREW_MARKS[0]!;
  return { label: mark.label, color: mark.toque };
}

/** The crewmates of `playerId` who are somewhere else, each with the distance and bearing to them. */
export function crewElsewhere(state: GameState, playerId: PlayerId): { player: PlayerState; distance: number; bearing: number }[] {
  const viewer = playerOf(state, playerId);
  const elsewhere: { player: PlayerState; distance: number; bearing: number }[] = [];
  for (const player of state.players) {
    if (player.id === viewer.id) continue;
    const distance = Math.hypot(player.position.x - viewer.position.x, player.position.z - viewer.position.z);
    if (distance < CREW_WITH_YOU_METRES) continue;
    elsewhere.push({ player, distance, bearing: bearingBetween(viewer.position.x, viewer.position.z, player.position.x, player.position.z) });
  }
  return elsewhere;
}

/** "Aboard", "Ashore · Home Knoll", "Asleep · Home Knoll": where one player is, from their own state. */
function crewPlace(player: PlayerState): Pick<CrewRowModel, 'where' | 'placeText'> {
  const island = player.mode === 'foot' && player.islandId ? ISLANDS_BY_ID[player.islandId].name : null;
  const where = player.asleep ? 'asleep' : player.mode === 'canoe' ? 'aboard' : 'ashore';
  const word = { asleep: 'Asleep', aboard: 'Aboard', ashore: 'Ashore' }[where];
  return { where, placeText: island ? `${word} · ${island}` : player.asleep && player.mode === 'canoe' ? 'Asleep · aboard' : word };
}

/** The crew list: one row a player, in player order. Empty when playing alone. */
function buildCrew(state: GameState, playerId: PlayerId): CrewRowModel[] {
  if (state.players.length < 2) return [];
  const viewer = playerOf(state, playerId);
  const elsewhere = crewElsewhere(state, playerId);
  return state.players.map((player) => {
    const meters = buildMeters(state, player.id);
    const away = elsewhere.find((entry) => entry.player.id === player.id);
    return {
      playerId: player.id,
      ...crewMark(player.id),
      you: player.id === viewer.id,
      ...crewPlace(player),
      distanceText: away ? distanceText(away.distance) : '',
      meters,
      lowText: meters.some((meter) => meter.low)
        ? `low ${meters.filter((meter) => meter.low).map((meter) => meter.label.toLowerCase()).join(', ')}`
        : '',
    };
  });
}

function buildWaterGauge(state: GameState, playerId: PlayerId): WaterGaugeModel {
  const meters = selectMeters(state, playerId);
  const stats = selectCanoeStats(state);
  const aboard = playerOf(state, playerId).mode === 'canoe';
  const gain = stats.leakPerSecond + stats.floodPerSecond;
  const afloat = aboard && !state.canoe.beached;
  const rate = (afloat ? gain : 0) - (state.canoe.bailing ? stats.bailPerSecond : 0);
  const trend = rate > 0.05 ? 'rising' : rate < -0.05 ? 'falling' : 'steady';
  let label = 'Dry';
  if (state.canoe.bailing) label = 'Bailing';
  else if (afloat && state.canoe.takingWater) label = 'Taking on water';
  else if (afloat && stats.leakPerSecond > 0) label = 'Leaking';
  else if (meters.waterLevel >= 1) label = 'Water aboard';
  return {
    visible: aboard || meters.waterLevel >= 1,
    value: Math.round(meters.waterLevel),
    warning: meters.low.swamping,
    trend,
    label,
  };
}

function buildHotbar(state: GameState, settings: Settings, playerId: PlayerId): HotbarSlotModel[] {
  // The crew's tools, the same for everyone; the tool in hand is this player's own.
  const tools = state.tools;
  const { selectedTool } = playerOf(state, playerId);
  return HOTBAR_ACTIONS.map((action, index) => {
    const toolId = tools[index] ?? null;
    const selected = toolId !== null && toolId === selectedTool;
    return {
      number: index + 1,
      keyLabel: primaryKey(settings.controls.keyBindings, action),
      toolId,
      itemId: toolId,
      name: toolId ? ITEMS[toolId].name : '',
      selected,
      intent: toolId ? { type: 'command', command: { type: 'select_tool', toolId: selected ? null : toolId } } : null,
    };
  });
}

function buildTracker(state: GameState): QuestTrackerModel | null {
  // `selectActiveQuests` puts the tracked quest first; with nothing tracked, show the first active one.
  const quest = selectActiveQuests(state)[0];
  if (!quest) return null;
  return {
    questId: quest.questId, name: quest.name, kind: quest.kind, ready: quest.status === 'ready',
    objectives: objectiveRows(quest),
  };
}

function buildCompass(state: GameState, cameraYaw: number, trackedQuestId: string | null, playerId: PlayerId): CompassModel {
  const { x, z } = playerOf(state, playerId).position;
  const mark = (id: string, kind: CompassMarkModel['kind'], label: string, bearing: number, distance: number | null): CompassMarkModel => ({
    id, kind, label,
    bearingDegrees: bearingDegrees(bearing),
    relativeDegrees: hundredths((bearingDifference(bearing, cameraYaw) * 180) / Math.PI),
    distanceText: distance === null ? '' : distanceText(distance),
  });
  const marks: CompassMarkModel[] = [
    mark('north', 'cardinal', 'N', 0, null),
    mark('east', 'cardinal', 'E', Math.PI / 2, null),
    mark('south', 'cardinal', 'S', Math.PI, null),
    mark('west', 'cardinal', 'W', -Math.PI / 2, null),
  ];
  for (const marker of selectMap(state, playerId).markers) {
    const distance = Math.hypot(marker.position.x - x, marker.position.z - z);
    const bearing = bearingBetween(x, z, marker.position.x, marker.position.z);
    if (marker.kind === 'quest' && marker.questId === trackedQuestId) marks.push(mark('quest', 'quest', marker.label, bearing, distance));
    if (marker.kind === 'canoe') marks.push(mark('canoe', 'canoe', 'Canoe', bearing, distance));
  }
  // A crewmate somewhere else: a mark in their colour at their bearing, to find them by.
  for (const { player, distance, bearing } of crewElsewhere(state, playerId)) {
    const { label, color } = crewMark(player.id);
    marks.push({ ...mark(`crew-${player.id}`, 'crew', label, bearing, distance), color, crewIndex: state.players.indexOf(player) });
  }
  const heading = hundredths((cameraYaw * 180) / Math.PI) % 360;
  return { headingDegrees: heading < 0 ? heading + 360 : heading, cardinal: cardinalName(cameraYaw, 8), marks };
}

function buildPrompt(state: GameState, settings: Settings, playerId: PlayerId): PromptModel | null {
  const interactable = selectInteractable(state, playerId);
  if (!interactable) return null;
  const keyLabel = primaryKey(settings.controls.keyBindings, 'interact');
  const blocked = interactable.kind === 'node' && !interactable.available;
  return { text: interactable.prompt, keyLabel, mode: blocked ? 'blocked' : 'press' };
}

function buildCanoeLines(state: GameState, playerId: PlayerId): { text: string; tone: Tone }[] {
  if (playerOf(state, playerId).mode !== 'canoe') return [];
  const stats = selectCanoeStats(state);
  const canoe = state.canoe;
  const lines: { text: string; tone: Tone }[] = [];
  lines.push({ text: canoe.beached ? 'Beached' : `${Math.abs(canoe.speed).toFixed(1)} m/s`, tone: 'info' });
  if (stats.hasSail) {
    lines.push({
      text: canoe.sailRaised ? `Sail up, drawing ${Math.round(stats.sailFactor * 100)}%` : 'Sail down',
      tone: canoe.sailRaised && stats.sailFactor < 0.05 ? 'warning' : 'info',
    });
  }
  if (canoe.attachments.includes('lantern_mast')) lines.push({ text: canoe.lanternLit ? 'Lantern lit' : 'Lantern out', tone: 'info' });
  if (!canoe.beached && stats.roughnessHere > stats.stability + 0.01) {
    lines.push({
      text: `Rough water ${stats.roughnessHere.toFixed(1)}, stability ${stats.stability}`,
      tone: 'danger',
    });
  }
  if (canoe.lostInFog) lines.push({ text: 'Lost in the fog: turning back', tone: 'warning' });
  return lines;
}

function buildHint(state: GameState, settings: Settings, playerId: PlayerId): string | null {
  if (!settings.gameplay.hints) return null;
  const bindings = settings.controls.keyBindings;
  const meters = selectMeters(state, playerId);
  const player = playerOf(state, playerId);
  const aboard = player.mode === 'canoe';
  if (aboard && !state.canoe.beached && meters.waterLevel >= 40 && !player.bailing) {
    return `Hold ${primaryKey(bindings, 'bail')} to bail.`;
  }
  if (meters.low.thirst) return `Thirsty. Drink from the inventory (${primaryKey(bindings, 'inventory')}); boil water at a fire first.`;
  if (meters.low.hunger) return `Hungry. Eat from the inventory (${primaryKey(bindings, 'inventory')}).`;
  if (meters.low.energy) return 'Worn out. Stand still to rest, or sleep at a camp.';
  if (!aboard && player.backpack.length >= 8) return 'Backpack full. Stow it in the canoe from the inventory.';
  if (state.pendingRewards.length > 0) return `Rewards are waiting. Make room, then claim them in the inventory (${primaryKey(bindings, 'inventory')}).`;
  return null;
}

/**
 * The HUD of one player (`playerId`, player 0 by default). `cameraYaw` is the
 * bearing the camera looks along; the compass turns with it.
 */
export function buildHudModel(state: GameState, settings: Settings, cameraYaw: number, playerId: PlayerId = 0): HudModel {
  const player = playerOf(state, playerId);
  const time = selectTimeOfDay(state, playerId);
  const weather = selectWeather(state);
  const tracker = buildTracker(state);
  const island = player.mode === 'foot' && player.islandId ? ISLANDS_BY_ID[player.islandId].name : null;
  const nextName = WEATHER[weather.nextKind].name.toLowerCase();
  return {
    crew: buildCrew(state, playerId),
    meters: buildMeters(state, playerId),
    water: buildWaterGauge(state, playerId),
    hotbar: buildHotbar(state, settings, playerId),
    tracker,
    compass: buildCompass(state, cameraYaw, tracker?.questId ?? null, playerId),
    prompt: buildPrompt(state, settings, playerId),
    clockText: `Day ${time.day}, ${time.clock}`,
    night: time.isNight,
    weatherText: weather.nextKind === weather.kind
      ? weather.name
      : `${weather.name}, ${nextName} in ${durationText(weather.secondsUntilChange)}`,
    stormWarning: weather.nextKind === 'storm' && weather.kind !== 'storm' && weather.secondsUntilChange <= 90,
    placeText: island ?? REGIONS_BY_ID[player.regionId].name,
    canoeLines: buildCanoeLines(state, playerId),
    hint: buildHint(state, settings, playerId),
  };
}
