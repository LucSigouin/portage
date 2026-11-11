/**
 * Staged states for `?shot=` and `?at=`. Each starts from a real game the
 * bot played to some quest (a fraction of a second, headless), then places
 * the player and the canoe by hand so the same picture comes up every time.
 *
 * This is the one place client code writes to a `GameState` directly. It is
 * a staging tool for screenshots, the same way the test helpers stage a scene.
 */
import { BOT_SEED, runBot } from '../../bot/bot.ts';
import {
  ATTACHMENT_IDS, ISLANDS_BY_ID, MAIN_QUESTS, NODES_BY_ISLAND, NPCS, TUNING, WEATHER, isStackable, spotPosition,
} from '../../data/index.ts';
import type { IslandId, ItemId, QuestId, WeatherKind } from '../../data/index.ts';
import {
  FIXED_STEP, NEUTRAL_INPUT, addPlayer, createGame, dispatch, drainEvents, landingBerth, step, terrainHeight,
} from '../../sim/index.ts';
import type { GameState, StepInput } from '../../sim/index.ts';
import type { OpenablePanelId } from '../intents.ts';
import type { ShotName } from './parameters.ts';

export interface StagedShot {
  /** The game to show, or null for the lobby. */
  state: GameState | null;
  /** A panel to open on top. */
  panel: OpenablePanelId | null;
  /** Where to put the camera. Offsets are added to the "straight behind" pose. */
  camera: { yawOffset?: number; pitch?: number; distance?: number } | null;
}

/** A real game, played by the bot until a quest is done. Null plays nothing. */
export function gameAfterQuest(seed: number, questId: QuestId | null): GameState {
  if (questId === null) {
    const state = createGame(seed);
    drainEvents(state);
    return state;
  }
  const report = runBot({ seed, untilQuest: questId });
  drainEvents(report.state);
  return report.state;
}

/**
 * Fill a staged game up to `crew` players. The extra ones are idle stand-ins
 * beside player 0: in the canoe when player 0 is aboard, standing in a row
 * next to them when they are ashore.
 */
export function addIdleCrew(state: GameState, crew: number): GameState {
  const lead = state.players[0];
  while (state.players.length < crew) {
    const extra = addPlayer(state);
    if (!extra) break;
    if (lead.mode !== 'foot') continue;
    // A step to the lead's right for each one, wherever the ground allows.
    const side = lead.heading + Math.PI / 2;
    const reach = 0.9 * (state.players.length - 1);
    const x = lead.position.x + Math.sin(side) * reach;
    const z = lead.position.z - Math.cos(side) * reach;
    const dry = terrainHeight(x, z) >= 0;
    extra.mode = 'foot';
    extra.seat = null;
    extra.islandId = lead.islandId;
    extra.heading = lead.heading;
    extra.position = dry ? { x, y: terrainHeight(x, z), z } : { ...lead.position };
  }
  return state;
}

/** The game at the start of main quest `number` (1 to 12). */
export function gameAtQuest(seed: number, number: number): GameState {
  const previous = MAIN_QUESTS.find((quest) => quest.order === number - 1);
  return gameAfterQuest(seed, previous ? previous.id : null);
}

function teleport(state: GameState, islandId: IslandId, x: number, z: number): void {
  state.players[0].mode = 'foot';
  state.players[0].islandId = islandId;
  state.players[0].position = { x, y: terrainHeight(x, z), z };
}

/** Beach the canoe on an island's landing and stand the player at its bow. */
function beachAt(state: GameState, islandId: IslandId): void {
  const berth = landingBerth(islandId, state.canoe.hullTier);
  state.canoe.position = { x: berth.x, y: 0, z: berth.z };
  state.canoe.heading = berth.heading;
  state.canoe.speed = 0;
  state.canoe.beached = true;
  state.canoe.sailRaised = false;
  state.canoe.waterLevel = 0;
  state.canoe.lastBeached = { ...berth, islandId };
  teleport(state, islandId, berth.x + Math.sin(berth.heading) * 2.2, berth.z - Math.cos(berth.heading) * 2.2);
  state.players[0].heading = berth.heading;
  if (!state.discoveredIslands.includes(islandId)) state.discoveredIslands.push(islandId);
}

/** Put the canoe afloat with the player aboard. */
function floatAt(state: GameState, x: number, z: number, heading: number): void {
  state.players[0].mode = 'canoe';
  state.players[0].islandId = null;
  state.players[0].position = { x, y: 0, z };
  state.players[0].heading = heading;
  state.canoe.position = { x, y: 0, z };
  state.canoe.heading = heading;
  state.canoe.speed = 0;
  state.canoe.beached = false;
}

function give(state: GameState, itemId: ItemId, count: number, container: 'backpack' | 'cargo'): void {
  if (!isStackable(itemId)) return;
  const stacks = container === 'backpack' ? state.players[0].backpack : state.canoe.cargo;
  const existing = stacks.find((stack) => stack.itemId === itemId);
  if (existing) existing.count = Math.min(TUNING.inventory.stackSize, existing.count + count);
  else stacks.push({ itemId, count });
}

function setClock(state: GameState, hour: number): void {
  const day = Math.floor(state.time / TUNING.time.daySeconds);
  state.time = day * TUNING.time.daySeconds + hour * TUNING.time.hourSeconds;
}

function setWeather(state: GameState, kind: WeatherKind): void {
  const weather = state.weather;
  weather.kind = kind;
  weather.secondsRemaining = 240;
  weather.nextKind = kind === 'clear' ? 'rain' : 'clear';
  weather.stormLevel = kind === 'storm' ? 1 : 0;
  weather.windSpeed = WEATHER[kind].maximumWind;
  weather.windTarget = WEATHER[kind].maximumWind;
}

/** Let the staged scene settle for a moment, then forget the events. */
function settle(state: GameState, seconds: number, input: Partial<StepInput> = {}): void {
  for (let tick = 0; tick < seconds / FIXED_STEP; tick += 1) step(state, { ...NEUTRAL_INPUT, ...input }, FIXED_STEP);
  drainEvents(state);
}

const game = (state: GameState, panel: OpenablePanelId | null = null, camera: StagedShot['camera'] = null): StagedShot => ({
  state, panel, camera,
});

/** Build the state for a named shot. The same name and seed always give the same state. */
export function stageShot(name: ShotName, seed: number = BOT_SEED): StagedShot {
  switch (name) {
    case 'lobby':
      return { state: null, panel: null, camera: null };
    case 'settings':
      return { state: null, panel: 'settings', camera: null };
    case 'play': {
      const state = gameAfterQuest(seed, 'stop_the_leak');
      floatAt(state, -40, 1085, -1.2);
      setClock(state, 10);
      setWeather(state, 'clear');
      settle(state, 4, { paddle: 1 });
      return game(state);
    }
    case 'island': {
      const state = gameAfterQuest(seed, 'first_haul');
      beachAt(state, 'home_knoll');
      setClock(state, 11);
      setWeather(state, 'clear');
      const node = NODES_BY_ISLAND.home_knoll.find((definition) => definition.reach === 'foot' && !state.nodes[definition.id]);
      if (node) teleport(state, 'home_knoll', node.position.x + 1.2, node.position.z + 0.6);
      settle(state, 0.2);
      return game(state, null, { pitch: 0.42, distance: 8 });
    }
    case 'inventory': {
      const state = gameAfterQuest(seed, 'a_proper_edge');
      beachAt(state, 'home_knoll');
      give(state, 'berries', 6, 'backpack');
      give(state, 'clean_water', 2, 'backpack');
      give(state, 'driftwood', 5, 'cargo');
      return game(state, 'inventory');
    }
    case 'crafting': {
      const state = gameAfterQuest(seed, 'a_proper_edge');
      beachAt(state, 'home_knoll');
      const camp = spotPosition(ISLANDS_BY_ID.home_knoll, ISLANDS_BY_ID.home_knoll.camp!.spot);
      teleport(state, 'home_knoll', camp.x + 1.5, camp.z);
      give(state, 'fiber', 6, 'backpack');
      give(state, 'driftwood', 6, 'backpack');
      give(state, 'dirty_water', 2, 'backpack');
      return game(state, 'crafting');
    }
    case 'builder': {
      const state = gameAfterQuest(seed, 'ribs_and_rails');
      beachAt(state, 'home_knoll');
      give(state, 'log', 2, 'cargo');
      give(state, 'plank', 4, 'cargo');
      give(state, 'rope', 2, 'cargo');
      give(state, 'nails', 4, 'cargo');
      return game(state, 'canoe_builder');
    }
    case 'quests': {
      const state = gameAfterQuest(seed, 'the_bellkeeper');
      beachAt(state, 'steeple_rock');
      return game(state, 'quest_log');
    }
    case 'map': {
      const state = gameAfterQuest(seed, 'the_bellkeeper');
      beachAt(state, 'steeple_rock');
      return game(state, 'map');
    }
    case 'dialogue': {
      const state = gameAfterQuest(seed, 'ribs_and_rails');
      beachAt(state, 'orchard_hill');
      setClock(state, 15);
      setWeather(state, 'clear');
      const odile = spotPosition(ISLANDS_BY_ID.orchard_hill, NPCS.odile.spot);
      teleport(state, 'orchard_hill', odile.x + 1.6, odile.z + 1);
      state.players[0].heading = Math.atan2(-1.6, 1);
      dispatch(state, { type: 'talk', npcId: 'odile' });
      drainEvents(state);
      return game(state, null, { pitch: 0.3, distance: 5.5 });
    }
    case 'pause': {
      const state = gameAfterQuest(seed, 'something_to_eat');
      beachAt(state, 'home_knoll');
      return game(state, 'pause');
    }
    case 'storm': {
      const state = gameAfterQuest(seed, 'catch_the_wind');
      floatAt(state, 130, 340, 0.5);
      state.canoe.waterLevel = 20;
      setClock(state, 16);
      setWeather(state, 'storm');
      dispatch(state, { type: 'set_sail', raised: true });
      settle(state, 3, { paddle: 1 });
      return game(state, null, { yawOffset: 0.5, pitch: 0.3, distance: 10 });
    }
    case 'night': {
      const state = gameAfterQuest(seed, 'through_the_narrows');
      floatAt(state, 70, 330, -0.4);
      setWeather(state, 'clear');
      setClock(state, 23.5);
      if (!state.canoe.lanternLit) dispatch(state, { type: 'toggle_lantern' });
      settle(state, 3, { paddle: 1 });
      return game(state, null, { yawOffset: 0.6, pitch: 0.3, distance: 9 });
    }
    case 'upgraded': {
      const state = gameAfterQuest(seed, 'the_beacon');
      state.canoe.hullTier = 3;
      for (const attachmentId of ATTACHMENT_IDS) {
        if (!state.canoe.attachments.includes(attachmentId)) state.canoe.attachments.push(attachmentId);
      }
      floatAt(state, 95, 345, 0.3);
      state.canoe.waterLevel = 0;
      setClock(state, 12);
      setWeather(state, 'clear');
      dispatch(state, { type: 'set_sail', raised: true });
      if (!state.canoe.lanternLit) dispatch(state, { type: 'toggle_lantern' });
      settle(state, 2);
      return game(state, null, { yawOffset: 2.45, pitch: 0.34, distance: 10.5 });
    }
    case 'beacon': {
      const state = gameAfterQuest(seed, 'the_beacon');
      // Afloat off the landing at dusk, looking up at the lit tower.
      floatAt(state, 0, -1085, 0);
      state.canoe.waterLevel = 0;
      setClock(state, 21.2);
      setWeather(state, 'clear');
      if (!state.canoe.lanternLit) dispatch(state, { type: 'toggle_lantern' });
      settle(state, 1);
      return game(state, null, { pitch: 0.07, distance: 9 });
    }
  }
}
