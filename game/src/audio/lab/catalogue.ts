/**
 * Everything the lab page can play: one entry per one-shot (through a real
 * game event wherever one exists), the world presets, and the self-test rows.
 */
import { NODES } from '../../data/index.ts';
import type { NodeTypeId, RegionId } from '../../data/index.ts';
import type { GameEvent } from '../../sim/index.ts';
import { CUES, resolveEventCue, scavengeRequest } from '../cues.ts';
import type { CueRequest } from '../cues.ts';
import { createSeededRandom } from '../graph.ts';
import { LOBBY_INPUTS } from '../layers.ts';
import type { LayerInputs } from '../layers.ts';
import type { VoiceBuilder } from '../voices.ts';

/** Id of the first placed node of a type. */
export function nodeOfType(typeId: NodeTypeId): string {
  const node = NODES.find((candidate) => candidate.typeId === typeId);
  if (!node) throw new Error(`No node of type ${typeId} is placed`);
  return node.id;
}

export interface LabSound {
  group: string;
  label: string;
  /** The game event that triggers it, when there is one. */
  event: GameEvent | null;
  /** What the event resolves to, or the cue played directly. */
  request: CueRequest;
}

const NO_MISSING = { items: [], tools: [], station: null, hullTier: null, attachments: [], flag: null };

function fromEvent(group: string, label: string, event: GameEvent): LabSound {
  const request = resolveEventCue(event, { state: null });
  if (!request) throw new Error(`${event.type} is silent: it cannot be a lab sound`);
  return { group, label, event, request };
}

function direct(group: string, label: string, request: CueRequest | null): LabSound {
  if (!request) throw new Error(`No cue for ${label}`);
  return { group, label, event: null, request };
}

const harvest = (label: string, typeId: NodeTypeId): LabSound =>
  fromEvent('Scavenging', label, { type: 'harvest_started', nodeId: nodeOfType(typeId) });

const REGION_NAMES: Record<RegionId, string> = {
  shallows: 'The Shallows', reach: 'The Reach', narrows: 'The Narrows', fog: 'The Fog',
};

export const LAB_SOUNDS: LabSound[] = [
  fromEvent('Items', 'Item gained', { type: 'item_gained', itemId: 'driftwood', count: 1, container: 'backpack' }),
  fromEvent('Items', 'Tool or key item gained', { type: 'item_gained', itemId: 'hatchet', count: 1, container: 'belt' }),
  fromEvent('Items', 'Item lost', { type: 'item_lost', itemId: 'driftwood', count: 1 }),
  fromEvent('Items', 'Left behind, no room', {
    type: 'item_left_behind', nodeId: nodeOfType('driftwood_pile'), itemId: 'driftwood', count: 1,
  }),

  direct('Scavenging', 'Chop: spruce with the hatchet', scavengeRequest(nodeOfType('spruce'), 1)),
  harvest('Chop: stone outcrop', 'stone_outcrop'),
  harvest('Pry: crate', 'crate'),
  harvest('Pry: machinery', 'machinery'),
  harvest('Pry: birch bark', 'birch'),
  harvest('Rummage: driftwood', 'driftwood_pile'),
  harvest('Rummage: junk heap', 'junk_heap'),
  harvest('Rummage: clay bank', 'clay_bank'),
  harvest('Pick: berries', 'berry_bush'),
  harvest('Pick: spruce gum', 'spruce'),
  harvest('Splash: fishing spot', 'fishing_spot'),
  fromEvent('Scavenging', 'Blocked, tool missing', {
    type: 'harvest_blocked', nodeId: nodeOfType('crate'), missing: NO_MISSING,
  }),
  fromEvent('Scavenging', 'Node depleted', { type: 'node_depleted', nodeId: nodeOfType('berry_bush') }),

  fromEvent('Crafting', 'Craft by hand', { type: 'crafted', recipeId: 'rope', count: 1 }),
  fromEvent('Crafting', 'Craft at the fire', { type: 'crafted', recipeId: 'pitch', count: 1 }),
  fromEvent('Crafting', 'Craft at the bench', { type: 'crafted', recipeId: 'plank', count: 1 }),
  fromEvent('Crafting', 'Craft in the smoker', { type: 'crafted', recipeId: 'smoked_fish', count: 1 }),
  fromEvent('Crafting', 'Craft at the forge', { type: 'crafted', recipeId: 'hardware', count: 1 }),

  fromEvent('Survival', 'Eat', { type: 'ate', itemId: 'berries' }),
  fromEvent('Survival', 'Drink', { type: 'drank', itemId: 'clean_water' }),
  direct('Survival', 'Bail, one scoop', { cue: 'bail' }),
  fromEvent('Survival', 'Hunger low', { type: 'meter_low', meter: 'hunger' }),
  fromEvent('Survival', 'Thirst low', { type: 'meter_low', meter: 'thirst' }),
  fromEvent('Survival', 'Energy low', { type: 'meter_low', meter: 'energy' }),

  fromEvent('Building', 'Attachment built', { type: 'attachment_built', attachmentId: 'outrigger_port' }),
  fromEvent('Building', 'Hull upgraded', { type: 'hull_upgraded', tier: 2 }),

  fromEvent('Quests', 'Quest started', { type: 'quest_started', questId: 'first_haul' }),
  fromEvent('Quests', 'Quest advanced', {
    type: 'quest_advanced', questId: 'first_haul', objectiveIndex: 0, progress: 1, required: 3,
  }),
  fromEvent('Quests', 'Quest ready to turn in', { type: 'quest_ready', questId: 'odile_windfall' }),
  fromEvent('Quests', 'Quest completed', { type: 'quest_completed', questId: 'first_haul' }),

  fromEvent('Finds', 'Bottle found', { type: 'bottle_found', bottleId: 'bottle_01' }),
  fromEvent('Finds', 'Cache hauled', { type: 'cache_hauled', nodeId: nodeOfType('wreck_buoy') }),
  fromEvent('Finds', 'Fish caught', { type: 'fish_caught' }),
  fromEvent('Finds', 'Rain collected', { type: 'rain_collected' }),
  fromEvent('Finds', 'Planter harvested', { type: 'planter_harvested' }),

  fromEvent('Weather and water', 'Storm warning', { type: 'storm_warning', secondsUntilStorm: 90 }),
  fromEvent('Weather and water', 'Rough water', { type: 'rough_water', roughness: 2, stability: 1 }),
  fromEvent('Weather and water', 'Swamping warning', { type: 'swamping_warning', waterLevel: 70 }),

  fromEvent('Failing', 'Capsized', { type: 'capsized' }),
  fromEvent('Failing', 'Exhausted', { type: 'exhausted' }),
  fromEvent('Failing', 'Washed ashore', { type: 'washed_ashore', cause: 'capsized', islandId: 'home_knoll', lost: [] }),

  fromEvent('Canoe and shore', 'Beached', { type: 'canoe_beached', islandId: 'home_knoll' }),
  fromEvent('Canoe and shore', 'Launched', { type: 'canoe_launched' }),
  fromEvent('Canoe and shore', 'Boarded', { type: 'boarded' }),
  fromEvent('Canoe and shore', 'Landed', { type: 'landed', islandId: 'home_knoll' }),
  fromEvent('Canoe and shore', 'Slept', { type: 'slept', hours: 8, islandId: 'home_knoll' }),
  fromEvent('Canoe and shore', 'Lantern lit', { type: 'lantern_toggled', lit: true }),
  fromEvent('Canoe and shore', 'Lantern out', { type: 'lantern_toggled', lit: false }),
  fromEvent('Canoe and shore', 'Sail raised', { type: 'sail_changed', raised: true }),
  fromEvent('Canoe and shore', 'Sail lowered', { type: 'sail_changed', raised: false }),

  ...(Object.keys(REGION_NAMES) as RegionId[]).map((regionId) =>
    fromEvent('Places', `Entered ${REGION_NAMES[regionId]}`, { type: 'region_entered', regionId })),
  fromEvent('Places', 'Island discovered', { type: 'island_discovered', islandId: 'steeple_rock' }),
  fromEvent('Places', 'Turned back by the fog', { type: 'fog_turned_back' }),

  fromEvent('Talking', 'Dialogue opened', { type: 'dialogue_opened', npcId: 'wren' }),
  fromEvent('Talking', 'Dialogue closed', { type: 'dialogue_closed', npcId: 'wren' }),

  fromEvent('The Beacon', 'Beacon lit (cue and finale)', { type: 'game_completed' }),
];

/** Seconds from the start of a cue to the end of its last partial, reverb not counted. */
export function cueSeconds(request: CueRequest): number {
  let end = 0;
  const span = (options: { at?: number; attack?: number; hold?: number; decay: number }): void => {
    end = Math.max(end, (options.at ?? 0) + (options.attack ?? 0.004) + (options.hold ?? 0) + options.decay);
  };
  const recorder: VoiceBuilder = {
    start: 0, random: createSeededRandom(1), tone: span, noise: span, bell: span, length: () => end,
  };
  CUES[request.cue].play(recorder, request);
  return end;
}

// --- World presets ---------------------------------------------------------------

export interface WorldPreset {
  label: string;
  inputs: LayerInputs;
}

const BASE: LayerInputs = { ...LOBBY_INPUTS, hour: 10, windSpeed: 3, openWater: 0.3 };

export const WORLD_PRESETS: WorldPreset[] = [
  { label: 'Calm morning', inputs: { ...BASE, hour: 7, windSpeed: 2.5, openWater: 0.1 } },
  {
    label: 'Paddling the Reach',
    inputs: {
      ...BASE, regionId: 'reach', roughness: 2, windSpeed: 4, canoeSpeed: 2.2, paddling: 'paddle', openWater: 0.9,
      hour: 14, hullWater: 0.15,
    },
  },
  {
    label: 'Storm in the Narrows',
    inputs: {
      ...BASE, regionId: 'narrows', weatherKind: 'storm', roughness: 4, windSpeed: 11, rain: 1, stormLevel: 1,
      canoeSpeed: 3, paddling: 'power', openWater: 0.8, hour: 16, hullWater: 0.6,
    },
  },
  {
    label: 'Night by the fire',
    inputs: {
      ...BASE, hour: 23.5, windSpeed: 1.5, aboard: false, onFoot: true, nearFire: true, openWater: 0,
      heightAboveWater: 2, nearCanoe: false,
    },
  },
  {
    label: 'Fog at dawn',
    inputs: { ...BASE, regionId: 'fog', weatherKind: 'fog', fog: 1, hour: 6, windSpeed: 1, roughness: 3, openWater: 1 },
  },
  { label: 'Dusk on open water', inputs: { ...BASE, regionId: 'reach', roughness: 2, hour: 20.5, windSpeed: 2, openWater: 1 } },
  {
    label: 'Walking in the rain',
    inputs: {
      ...BASE, weatherKind: 'rain', rain: 0.65, windSpeed: 5, aboard: false, onFoot: true, footSpeed: 2.6, openWater: 0,
      heightAboveWater: 3, nearCanoe: false, hour: 15,
    },
  },
];

/**
 * As quiet as the world gets: ashore, high up, no wind, far from the trees.
 * Self-test rows add one thing to it. A trace of the water bed and the odd
 * distant bird remain, which is why those rows are judged on their RMS.
 */
const STILL: LayerInputs = {
  ...BASE, roughness: 0, windSpeed: 0, aboard: false, onFoot: true, nearCanoe: false, heightAboveWater: 30,
  openWater: 1, hour: 12,
};
const AFLOAT: LayerInputs = { ...STILL, aboard: true, onFoot: false, nearCanoe: true, heightAboveWater: 0 };

export interface LayerRow {
  label: string;
  inputs: LayerInputs;
  seconds: number;
}

/** Each continuous layer on its own, then the presets, for the self-test. */
export const LAYER_ROWS: LayerRow[] = [
  { label: 'Water lapping, roughness 1', inputs: { ...AFLOAT, roughness: 1 }, seconds: 16 },
  { label: 'Water lapping, roughness 4', inputs: { ...AFLOAT, roughness: 4 }, seconds: 16 },
  { label: 'Wind, 4 m/s', inputs: { ...STILL, windSpeed: 4 }, seconds: 16 },
  { label: 'Wind, 12 m/s', inputs: { ...STILL, windSpeed: 12 }, seconds: 16 },
  { label: 'Wind in the pines, 8 m/s near land', inputs: { ...STILL, windSpeed: 8, openWater: 0 }, seconds: 16 },
  { label: 'Rain, steady', inputs: { ...STILL, rain: 0.65, weatherKind: 'rain' }, seconds: 16 },
  { label: 'Storm bed and thunder', inputs: { ...STILL, stormLevel: 1, weatherKind: 'storm' }, seconds: 30 },
  { label: 'Hull wash and paddle strokes, 2.2 m/s', inputs: { ...AFLOAT, canoeSpeed: 2.2, paddling: 'paddle' }, seconds: 16 },
  { label: 'Hull wash and power strokes, 3.2 m/s', inputs: { ...AFLOAT, canoeSpeed: 3.2, paddling: 'power' }, seconds: 16 },
  { label: 'Slosh, hull 90% full', inputs: { ...AFLOAT, hullWater: 0.9 }, seconds: 16 },
  { label: 'Bailing', inputs: { ...AFLOAT, hullWater: 0.5, bailing: true }, seconds: 12 },
  { label: 'Fire in reach', inputs: { ...STILL, nearFire: true }, seconds: 16 },
  { label: 'Crickets, night', inputs: { ...STILL, hour: 1, openWater: 0 }, seconds: 16 },
  { label: 'Day birds, dawn', inputs: { ...STILL, hour: 6.5, openWater: 0 }, seconds: 30 },
  { label: 'Loons, night on open water', inputs: { ...AFLOAT, hour: 1, openWater: 1 }, seconds: 45 },
  { label: 'Fog hush', inputs: { ...STILL, fog: 1, weatherKind: 'fog' }, seconds: 16 },
  { label: 'Footsteps, walking', inputs: { ...STILL, footSpeed: 2.6 }, seconds: 10 },
  { label: 'Footsteps, running', inputs: { ...STILL, footSpeed: 4.4 }, seconds: 10 },
  { label: 'Footsteps, wading', inputs: { ...STILL, footSpeed: 2.6, wading: true, heightAboveWater: 0 }, seconds: 10 },
  ...WORLD_PRESETS.map((preset) => ({ label: `Scene: ${preset.label}`, inputs: preset.inputs, seconds: 30 })),
];

export interface MusicRow {
  label: string;
  scene: 'lobby' | 'game' | 'credits';
  inputs: LayerInputs | null;
  finale: boolean;
  seconds: number;
}

export const MUSIC_ROWS: MusicRow[] = [
  { label: 'Lobby theme', scene: 'lobby', inputs: null, finale: false, seconds: 60 },
  { label: 'Shallows, day, clear', scene: 'game', inputs: { ...BASE, regionId: 'shallows', hour: 12 }, finale: false, seconds: 60 },
  {
    label: 'Reach, dusk, rain', scene: 'game', finale: false, seconds: 60,
    inputs: { ...BASE, regionId: 'reach', hour: 20, weatherKind: 'rain' },
  },
  { label: 'Narrows, night, clear', scene: 'game', inputs: { ...BASE, regionId: 'narrows', hour: 1 }, finale: false, seconds: 60 },
  {
    label: 'Fog, dawn, fog', scene: 'game', finale: false, seconds: 60,
    inputs: { ...BASE, regionId: 'fog', hour: 6, weatherKind: 'fog', fog: 1 },
  },
  {
    label: 'Reach, day, storm (thinned)', scene: 'game', finale: false, seconds: 60,
    inputs: { ...BASE, regionId: 'reach', hour: 12, weatherKind: 'storm', stormLevel: 1 },
  },
  { label: 'Credits', scene: 'credits', inputs: null, finale: false, seconds: 60 },
  { label: 'Finale (the Beacon)', scene: 'game', inputs: { ...BASE, regionId: 'fog', hour: 21 }, finale: true, seconds: 30 },
];
