/** The HUD: meters, water gauge, hotbar, quest tracker, compass, prompt and status lines. */
import { ISLANDS_BY_ID, ITEMS, REGIONS_BY_ID, WEATHER } from '../../data/index.ts';
import type { Settings } from '../../settings/index.ts';
import {
  bearingBetween, bearingDifference, selectActiveQuests, selectCanoeStats, selectInteractable, selectMap,
  selectMeters, selectTimeOfDay, selectWeather,
} from '../../sim/index.ts';
import type { GameState, QuestView } from '../../sim/index.ts';
import { bearingDegrees, cardinalName, distanceText, durationText, primaryKey } from './format.ts';
import type {
  CompassMarkModel, CompassModel, HotbarSlotModel, HudModel, MeterModel, ObjectiveRowModel, PromptModel,
  QuestTrackerModel, Tone, WaterGaugeModel,
} from './types.ts';

export const HOTBAR_SLOTS = 5;
const HOTBAR_ACTIONS = ['tool1', 'tool2', 'tool3', 'tool4', 'tool5'] as const;

export function objectiveRows(quest: QuestView): ObjectiveRowModel[] {
  return quest.objectives.map((objective) => ({
    text: objective.text,
    progressText: objective.required > 1 ? `${Math.floor(objective.progress)} / ${objective.required}` : '',
    done: objective.done,
  }));
}

function buildMeters(state: GameState): MeterModel[] {
  const meters = selectMeters(state);
  return [
    { id: 'hunger', label: 'Hunger', value: Math.round(meters.hunger), cap: 100, low: meters.low.hunger, pattern: 'stripes' },
    { id: 'thirst', label: 'Thirst', value: Math.round(meters.thirst), cap: 100, low: meters.low.thirst, pattern: 'waves' },
    { id: 'energy', label: 'Energy', value: Math.round(meters.energy), cap: meters.energyCap, low: meters.low.energy, pattern: 'dots' },
  ];
}

function buildWaterGauge(state: GameState): WaterGaugeModel {
  const meters = selectMeters(state);
  const stats = selectCanoeStats(state);
  const aboard = state.player.mode === 'canoe';
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

function buildHotbar(state: GameState, settings: Settings): HotbarSlotModel[] {
  const { tools, selectedTool } = state.player;
  return HOTBAR_ACTIONS.map((action, index) => {
    const toolId = tools[index] ?? null;
    const selected = toolId !== null && toolId === selectedTool;
    return {
      number: index + 1,
      keyLabel: primaryKey(settings.controls.keyBindings, action),
      toolId,
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

function buildCompass(state: GameState, cameraYaw: number, trackedQuestId: string | null): CompassModel {
  const { x, z } = state.player.position;
  const mark = (id: string, kind: CompassMarkModel['kind'], label: string, bearing: number, distance: number | null): CompassMarkModel => ({
    id, kind, label,
    bearingDegrees: bearingDegrees(bearing),
    relativeDegrees: Math.round((bearingDifference(bearing, cameraYaw) * 180) / Math.PI),
    distanceText: distance === null ? '' : distanceText(distance),
  });
  const marks: CompassMarkModel[] = [
    mark('north', 'cardinal', 'N', 0, null),
    mark('east', 'cardinal', 'E', Math.PI / 2, null),
    mark('south', 'cardinal', 'S', Math.PI, null),
    mark('west', 'cardinal', 'W', -Math.PI / 2, null),
  ];
  for (const marker of selectMap(state).markers) {
    const distance = Math.hypot(marker.position.x - x, marker.position.z - z);
    const bearing = bearingBetween(x, z, marker.position.x, marker.position.z);
    if (marker.kind === 'quest' && marker.questId === trackedQuestId) marks.push(mark('quest', 'quest', marker.label, bearing, distance));
    if (marker.kind === 'canoe') marks.push(mark('canoe', 'canoe', 'Canoe', bearing, distance));
  }
  return { headingDegrees: bearingDegrees(cameraYaw), cardinal: cardinalName(cameraYaw, 8), marks };
}

function buildPrompt(state: GameState, settings: Settings): PromptModel | null {
  const interactable = selectInteractable(state);
  if (!interactable) return null;
  const keyLabel = primaryKey(settings.controls.keyBindings, 'interact');
  if (interactable.kind !== 'node') return { text: interactable.prompt, keyLabel, mode: 'press', progress: 0 };
  if (!interactable.available) return { text: interactable.prompt, keyLabel, mode: 'blocked', progress: 0 };
  return {
    text: interactable.prompt, keyLabel,
    mode: settings.accessibility.scavengeMode === 'toggle' ? 'press' : 'hold',
    progress: Math.max(0, Math.min(1, interactable.progress)),
  };
}

function buildCanoeLines(state: GameState): { text: string; tone: Tone }[] {
  if (state.player.mode !== 'canoe') return [];
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

function buildHint(state: GameState, settings: Settings): string | null {
  if (!settings.gameplay.hints) return null;
  const bindings = settings.controls.keyBindings;
  const meters = selectMeters(state);
  const aboard = state.player.mode === 'canoe';
  if (aboard && !state.canoe.beached && meters.waterLevel >= 40 && !state.canoe.bailing) {
    return `Hold ${primaryKey(bindings, 'bail')} to bail.`;
  }
  if (meters.low.thirst) return `Thirsty. Drink from the inventory (${primaryKey(bindings, 'inventory')}); boil water at a fire first.`;
  if (meters.low.hunger) return `Hungry. Eat from the inventory (${primaryKey(bindings, 'inventory')}).`;
  if (meters.low.energy) return 'Worn out. Stand still to rest, or sleep at a camp.';
  if (!aboard && state.player.backpack.length >= 8) return 'Backpack full. Stow it in the canoe from the inventory.';
  if (state.pendingRewards.length > 0) return `Rewards are waiting. Make room, then claim them in the inventory (${primaryKey(bindings, 'inventory')}).`;
  return null;
}

/** `cameraYaw` is the bearing the camera looks along; the compass turns with it. */
export function buildHudModel(state: GameState, settings: Settings, cameraYaw: number): HudModel {
  const time = selectTimeOfDay(state);
  const weather = selectWeather(state);
  const tracker = buildTracker(state);
  const island = state.player.mode === 'foot' && state.player.islandId ? ISLANDS_BY_ID[state.player.islandId].name : null;
  const nextName = WEATHER[weather.nextKind].name.toLowerCase();
  return {
    meters: buildMeters(state),
    water: buildWaterGauge(state),
    hotbar: buildHotbar(state, settings),
    tracker,
    compass: buildCompass(state, cameraYaw, tracker?.questId ?? null),
    prompt: buildPrompt(state, settings),
    clockText: `Day ${time.day}, ${time.clock}`,
    night: time.isNight,
    weatherText: weather.nextKind === weather.kind
      ? weather.name
      : `${weather.name}, ${nextName} in ${durationText(weather.secondsUntilChange)}`,
    stormWarning: weather.nextKind === 'storm' && weather.kind !== 'storm' && weather.secondsUntilChange <= 90,
    placeText: island ?? REGIONS_BY_ID[state.player.regionId].name,
    canoeLines: buildCanoeLines(state),
    hint: buildHint(state, settings),
  };
}
