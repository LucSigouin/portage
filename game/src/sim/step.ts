import type { Difficulty } from '../data/types.ts';
import { TUNING } from '../data/tuning.ts';
import { ISLANDS, START } from '../data/world.ts';
import type { CrewMember } from './canoe.ts';
import { stepOnFoot } from './foot.ts';
import { connectedPlayers, emit, freeSeat, playerOf } from './inventory.ts';
import { refillLostFinds } from './keepsakes.ts';
import { createQuestStates, updateQuests } from './quests.ts';
import { seedToRandomState } from './random.ts';
import { applyCapsize, applyExhaustion, skipNightIfCrewAsleep, updatePassiveAttachments, updateSurvival } from './survival.ts';
import { MAXIMUM_NAME_LENGTH, MAXIMUM_PLAYERS, STATE_VERSION } from './types.ts';
import type { CrewInput, GameEvent, GameOptions, GameState, PlayerId, PlayerState, StepInput } from './types.ts';
import { settleCanoe, stepCanoe } from './canoe.ts';
import { createWeather, rollNextWeather, updateWeather } from './weather.ts';
import { islandAt, landingBerth, regionAt, waterRoughnessAt, waveHeight } from './world.ts';

/** The fixed simulation step, seconds. */
export const FIXED_STEP: number = TUNING.fixedStep;

/** An input with nothing pressed. Spread it and override what is held. */
export const NEUTRAL_INPUT: Readonly<StepInput> = Object.freeze({
  paddle: 0, steer: 0, powerStroke: false, bail: false,
  moveX: 0, moveY: 0, run: false, cameraYaw: 0,
});

/**
 * Put one more player in the canoe, in the lowest free seat, with the
 * starting kit. Returns them, or null when the crew is already four.
 */
export function addPlayer(state: GameState): PlayerState | null {
  if (state.players.length >= MAXIMUM_PLAYERS) return null;
  let id = 0;
  while (state.players.some((player) => player.id === id)) id += 1;
  const canoe = state.canoe;
  const player: PlayerState = {
    id,
    name: '',
    connected: true,
    mode: 'canoe',
    seat: freeSeat(state),
    position: { ...canoe.position },
    heading: canoe.heading,
    hunger: 80,
    thirst: 75,
    energy: 90,
    backpack: [],
    selectedTool: null,
    islandId: null,
    regionId: regionAt(canoe.position.x, canoe.position.z).id,
    running: false,
    exerting: false,
    paddling: false,
    bailing: false,
    asleep: false,
    dialogue: null,
  };
  state.players.push(player);
  state.players.sort((first, second) => first.id - second.id);
  return player;
}

/**
 * A name as the game keeps it: no control characters, single spaces, at most
 * `MAXIMUM_NAME_LENGTH` letters. Anything may come in; this is what goes on the player.
 */
export function cleanPlayerName(name: unknown): string {
  if (typeof name !== 'string') return '';
  const tidy = name.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202f\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(tidy).slice(0, MAXIMUM_NAME_LENGTH).join('').trim();
}

/** Give a player a name (cleaned and cut to length). Empty goes back to the crew mark's label. */
export function setPlayerName(state: GameState, playerId: PlayerId, name: unknown): void {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (player) player.name = cleanPlayerName(name);
}

/**
 * Mark a player away or back. Going away lets go of everything they held (the
 * paddle, a talk, a bed) and keeps the rest: seat or spot, backpack, meters.
 * If the ones left are all asleep, the night skips now. Tells the crew, unless
 * `quiet`. Returns false when there is no such player or nothing changed.
 */
export function setConnected(state: GameState, playerId: PlayerId, connected: boolean, quiet = false): boolean {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player || player.connected === connected) return false;
  player.connected = connected;
  player.paddling = false;
  player.bailing = false;
  player.exerting = false;
  player.running = false;
  player.asleep = false;
  player.dialogue = null;
  if (!quiet) emit(state, { type: 'crew_changed', who: player.id, change: connected ? 'back' : 'away' });
  if (!connected) skipNightIfCrewAsleep(state, playerOf(state, connectedPlayers(state)[0]?.id ?? player.id));
  return true;
}

/**
 * Start a new game. The valley is the same for everyone; the seed decides
 * loot rolls and weather. Standard difficulty and a crew of one unless
 * `options` says otherwise.
 */
export function createGame(seed: number, options: GameOptions = {}): GameState {
  const difficulty: Difficulty = options.difficulty ?? 'standard';
  const start = START.canoe;
  const berth = landingBerth(START.islandId, 0);
  const state: GameState = {
    version: STATE_VERSION,
    seed,
    randomState: seedToRandomState(seed),
    difficulty,
    tick: 0,
    stepAccumulator: 0,
    time: TUNING.time.startHour * TUNING.time.hourSeconds,
    playedSeconds: 0,
    players: [],
    canoe: {
      position: { x: start.x, y: 0, z: start.z },
      heading: start.heading,
      speed: 0,
      pitch: 0,
      roll: 0,
      waterLevel: TUNING.canoe.startWaterLevel,
      hullTier: 0,
      attachments: [],
      cargo: [],
      beached: false,
      lastBeached: { ...berth, islandId: START.islandId },
      sailRaised: false,
      lanternLit: false,
      bailing: false,
      lostInFog: false,
      takingWater: false,
      swampWarned: false,
      rainProgress: 0,
      fishProgress: 0,
    },
    weather: createWeather(),
    nodes: {},
    quests: createQuestStates(),
    trackedQuestId: 'bail_out',
    tools: ['bailing_can'],
    keyItems: {},
    flags: {},
    discoveredIslands: [START.islandId],
    bottlesFound: [],
    respawnCampIslandId: START.islandId,
    pendingRewards: [],
    statistics: {
      fails: 0, itemsCrafted: 0, nodesHarvested: 0, smokedCount: 0, cachesHauled: 0,
      distancePaddled: 0, distanceWalked: 0,
    },
    events: [],
  };
  rollNextWeather(state);
  state.canoe.position.y = waveHeight(start.x, start.z, state.time, waterRoughnessAt(start.x, start.z, 0));
  const crew = Math.max(1, Math.min(MAXIMUM_PLAYERS, Math.floor(options.crew ?? 1)));
  for (let count = 0; count < crew; count += 1) addPlayer(state);
  emit(state, { type: 'quest_started', questId: 'bail_out' });
  return state;
}

/** One player's region, island underfoot and island discovery. Cheap, run a few times a second. */
function updateSurroundings(state: GameState, player: PlayerState): void {
  const regionId = regionAt(player.position.x, player.position.z).id;
  if (regionId !== player.regionId) {
    player.regionId = regionId;
    emit(state, { type: 'region_entered', regionId }, player);
  }
  if (player.mode === 'foot') player.islandId = islandAt(player.position.x, player.position.z);
  if (state.discoveredIslands.length < ISLANDS.length) {
    for (const definition of ISLANDS) {
      if (state.discoveredIslands.includes(definition.id)) continue;
      const distance = Math.hypot(definition.center.x - player.position.x, definition.center.z - player.position.z);
      if (distance <= TUNING.world.discoverRange + Math.max(definition.radiusX, definition.radiusZ)) {
        state.discoveredIslands.push(definition.id);
        emit(state, { type: 'island_discovered', islandId: definition.id });
      }
    }
  }
}

/**
 * One fixed step. `inputs` is indexed by player id. Players are stepped in
 * id order, so the same inputs always give the same state.
 */
function fixedStep(state: GameState, inputs: readonly (StepInput | undefined)[]): void {
  const deltaSeconds = FIXED_STEP;
  const timeBefore = state.time;
  state.tick += 1;
  state.time += deltaSeconds;
  state.playedSeconds += deltaSeconds;
  updateWeather(state, deltaSeconds);

  // A conversation or a bed holds a player still. So does being away.
  const crew: CrewMember[] = state.players.map((player) => ({
    player,
    input: player.dialogue || player.asleep || !player.connected ? NEUTRAL_INPUT : inputs[player.id] ?? NEUTRAL_INPUT,
  }));
  // The canoe is shared: it moves once, for everyone aboard.
  const aboard = crew.filter((member) => member.player.mode === 'canoe');
  if (aboard.some((member) => member.player.connected)) {
    stepCanoe(state, aboard, deltaSeconds);
  } else if (aboard.length > 0) {
    // Only away players aboard: the canoe waits where it is. No drift, no leak, nothing to capsize.
    state.canoe.speed = 0;
    state.canoe.bailing = false;
    state.canoe.takingWater = false;
    settleCanoe(state, deltaSeconds);
    for (const { player } of aboard) {
      player.position.x = state.canoe.position.x;
      player.position.y = state.canoe.position.y;
      player.position.z = state.canoe.position.z;
      player.heading = state.canoe.heading;
    }
  }
  for (const { player, input } of crew) {
    // An away player's meters stand still.
    if (!player.connected) continue;
    let moving: boolean;
    if (player.mode === 'canoe') {
      moving = input.paddle !== 0;
    } else {
      stepOnFoot(state, player, input, deltaSeconds);
      moving = Math.hypot(input.moveX, input.moveY) > 0.01;
    }
    updateSurvival(state, player, { moving }, deltaSeconds);
  }
  updatePassiveAttachments(state, deltaSeconds, timeBefore);
  if (state.tick % 10 === 0) {
    for (const player of state.players) updateSurroundings(state, player);
    refillLostFinds(state);
    updateQuests(state);
  }

  // A capsize takes everyone aboard. A player out of energy fails alone.
  // An away player cannot fail: a capsize leaves them in their seat, and their energy stands still.
  const present = connectedPlayers(state);
  if (state.canoe.waterLevel >= TUNING.canoe.capsizeLevel && present.some((player) => player.mode === 'canoe')) applyCapsize(state);
  for (const player of present) {
    if (player.energy <= 0) applyExhaustion(state, player);
  }
}

/**
 * Advance the simulation by a frame. `input` is one player's intent (player
 * 0) or the crew's, indexed by player id. `deltaSeconds` is real frame time;
 * the simulation runs whole fixed steps of 1/60 s out of it and keeps the
 * rest in `state.stepAccumulator`. Mutates and returns `state`.
 */
export function step(state: GameState, input: CrewInput, deltaSeconds: number): GameState {
  if (!(deltaSeconds > 0)) return state;
  const inputs: readonly (StepInput | undefined)[] = Array.isArray(input) ? input : [input as StepInput];
  state.stepAccumulator += Math.min(deltaSeconds, TUNING.maximumFrameSeconds);
  while (state.stepAccumulator >= FIXED_STEP - 1e-9) {
    fixedStep(state, inputs);
    state.stepAccumulator -= FIXED_STEP;
  }
  if (state.stepAccumulator < 0) state.stepAccumulator = 0;
  return state;
}

/** Take every queued event and empty the queue. Call once per frame. */
export function drainEvents(state: GameState): GameEvent[] {
  const events = state.events;
  state.events = [];
  return events;
}

/**
 * A short, stable fingerprint of the whole state (FNV-1a over its JSON). Two
 * runs with the same seed and inputs give the same hash.
 */
export function hashState(state: GameState): string {
  const text = JSON.stringify(state);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
