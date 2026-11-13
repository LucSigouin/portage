/** Shared set-up for the audio tests. */
import { NODES } from '../../src/data/index.ts';
import type { NodeTypeId } from '../../src/data/index.ts';
import { createGame } from '../../src/sim/index.ts';
import type { GameEvent, GameEventType, GameState } from '../../src/sim/index.ts';
import { createEngineCore } from '../../src/audio/engine.ts';
import type { EngineNodes } from '../../src/audio/engine.ts';
import { FakeAudioContext } from './fake-audio-context.ts';

export type Core = ReturnType<typeof createEngineCore>;

export interface Rig {
  context: FakeAudioContext;
  engine: Core;
  nodes: EngineNodes;
}

/** An unlocked engine on a fake context, with no timer and no page to watch. */
export async function createRig(seed = 7): Promise<Rig> {
  const context = new FakeAudioContext();
  const engine = createEngineCore({
    contextFactory: () => context.asAudioContext(), seed, autoTick: false, followPageVisibility: false,
  });
  await engine.unlock();
  const nodes = engine.inspector.nodes();
  if (!nodes) throw new Error('The engine did not build its graph');
  return { context, engine, nodes };
}

export function newGame(): GameState {
  return createGame(20261110);
}

/** Id of the first placed node of a type. */
export function nodeOfType(typeId: NodeTypeId): string {
  const node = NODES.find((candidate) => candidate.typeId === typeId);
  if (!node) throw new Error(`No node of type ${typeId} is placed`);
  return node.id;
}

const NO_MISSING = { items: [], tools: [], station: null, hullTier: null, attachments: [], flag: null };

/**
 * One real example of every event. Typed as a Record over the event union, so
 * this file stops compiling when the rules engine gains an event.
 */
export const SAMPLE_EVENTS: { [Type in GameEventType]: Extract<GameEvent, { type: Type }> } = {
  item_gained: { type: 'item_gained', itemId: 'driftwood', count: 2, container: 'backpack' },
  item_lost: { type: 'item_lost', itemId: 'driftwood', count: 1 },
  item_left_behind: { type: 'item_left_behind', nodeId: nodeOfType('driftwood_pile'), itemId: 'driftwood', count: 1 },
  crafted: { type: 'crafted', recipeId: 'plank', count: 1 },
  ate: { type: 'ate', itemId: 'berries' },
  drank: { type: 'drank', itemId: 'clean_water' },
  harvest_started: { type: 'harvest_started', nodeId: nodeOfType('spruce') },
  harvest_blocked: { type: 'harvest_blocked', nodeId: nodeOfType('crate'), missing: NO_MISSING },
  node_depleted: { type: 'node_depleted', nodeId: nodeOfType('berry_bush') },
  bottle_found: { type: 'bottle_found', bottleId: 'bottle_01' },
  cache_hauled: { type: 'cache_hauled', nodeId: nodeOfType('wreck_buoy') },
  quest_started: { type: 'quest_started', questId: 'first_haul' },
  quest_advanced: { type: 'quest_advanced', questId: 'first_haul', objectiveIndex: 0, progress: 1, required: 3 },
  quest_ready: { type: 'quest_ready', questId: 'odile_windfall' },
  quest_completed: { type: 'quest_completed', questId: 'first_haul' },
  hull_upgraded: { type: 'hull_upgraded', tier: 1 },
  attachment_built: { type: 'attachment_built', attachmentId: 'outrigger_port' },
  weather_changed: { type: 'weather_changed', kind: 'rain' },
  storm_warning: { type: 'storm_warning', secondsUntilStorm: 90 },
  rough_water: { type: 'rough_water', roughness: 2, stability: 1 },
  swamping_warning: { type: 'swamping_warning', waterLevel: 70 },
  capsized: { type: 'capsized' },
  exhausted: { type: 'exhausted' },
  washed_ashore: { type: 'washed_ashore', cause: 'capsized', islandId: 'home_knoll', lost: [] },
  canoe_beached: { type: 'canoe_beached', islandId: 'home_knoll' },
  canoe_launched: { type: 'canoe_launched' },
  boarded: { type: 'boarded' },
  landed: { type: 'landed', islandId: 'home_knoll' },
  slept: { type: 'slept', hours: 8, islandId: 'home_knoll' },
  region_entered: { type: 'region_entered', regionId: 'reach' },
  island_discovered: { type: 'island_discovered', islandId: 'steeple_rock' },
  place_reached: { type: 'place_reached', placeId: 'island:steeple_rock' },
  fog_turned_back: { type: 'fog_turned_back' },
  meter_low: { type: 'meter_low', meter: 'thirst' },
  dialogue_opened: { type: 'dialogue_opened', npcId: 'wren' },
  dialogue_closed: { type: 'dialogue_closed', npcId: 'wren' },
  lantern_toggled: { type: 'lantern_toggled', lit: true },
  sail_changed: { type: 'sail_changed', raised: true },
  rain_collected: { type: 'rain_collected' },
  fish_caught: { type: 'fish_caught' },
  planter_harvested: { type: 'planter_harvested' },
  rewards_pending: { type: 'rewards_pending' },
  autosave_requested: { type: 'autosave_requested', reason: 'landing' },
  game_completed: { type: 'game_completed' },
  crew_changed: { type: 'crew_changed', who: 1, change: 'away' },
  spot_marked: { type: 'spot_marked', who: 1 },
};

export const ALL_EVENTS: GameEvent[] = Object.values(SAMPLE_EVENTS);
