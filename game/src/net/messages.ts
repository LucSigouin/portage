/**
 * The messages between a guest and the host. Each is a plain JSON object with
 * a version (`v`) and a `type`.
 *
 * Nothing a guest sends says which player it is for. The host gives each
 * connection one player when it joins, and every later message on that
 * connection is that player's and nobody else's. A message that tries to say
 * otherwise, or carries anything the list below does not name, is refused
 * whole (`readClientMessage` returns null).
 *
 * | From | Type | Says |
 * |---|---|---|
 * | guest | `join` | I am `name`. `key` is my secret for this room: the same key gets the same player back. |
 * | host | `welcome` | You are player `playerId`. Here is the whole state, snapshot `id`. Commands count from 1 in this `sitting`. |
 * | guest | `input` | What I hold this step (`StepInput`), numbered `seq`. Also what I have: snapshot `have`, `events` so far. And my walking: I have taken `step` steps of 1/60 s, and `walk` is what I held on the last few stretches of them. |
 * | guest | `command` | Do this for me (`Command`), numbered `id`, once you have walked me through my step `at`. Sent again until its result comes. |
 * | host | `result` | What command `id` did (`CommandResult`). |
 * | host | `state` | Snapshot `id` at step `step`: the top-level keys that changed since snapshot `base` (all of them when `base` is null), and the fingerprint of the whole. `ack` is the last `input.seq` the host had; `walked` is how many of this guest's steps the host has walked. |
 * | host | `events` | The events numbered from `first`, as they happen. Sent again until the guest has them. |
 * | guest | `ping` | Still here, and what I have. The host sends it straight back. |
 * | both | `leave` | Going, or (from the host) why you cannot stay. |
 */
import { ATTACHMENTS, ITEMS, NPCS, QUESTS, RECIPES, TOOL_IDS } from '../data/index.ts';
import type { Command, CommandResult, GameEvent, GameState, PlayerId, StepInput } from '../sim/index.ts';
import { WALK_RUNS_SENT, readWalkRun } from './walk.ts';
import type { WireRun } from './walk.ts';

/**
 * Bump when a message changes shape. Host and guest must match.
 * 2: a guest's walking is numbered by step (`input.step`, `input.walk`, `command.at`, `state.walked`, `welcome.walked`).
 * 3: the state is save version 4 (the crew's chart, each player's quest card), and `track_quest` may say `tracked`.
 * 4: the jump key (`input.input.jump`, and 2 added to the keys of a stretch in `input.walk`).
 * 5: a guest may send `ping` and `clear_ping` (an older host would drop them unanswered, and the guest's next commands with them).
 * 6: a guest may send `take_back`, for the same reason.
 * 7: a guest may send `give` (a stack handed to a crewmate close by), for the same reason.
 */
export const PROTOCOL_VERSION = 7;

export interface JoinMessage { v: number; type: 'join'; name: string; key: string }
export interface InputMessage {
  v: number; type: 'input'; seq: number; have: number; events: number; input: StepInput;
  /** Steps of 1/60 s this guest has taken in this sitting. `walk` says what it held on them. */
  step: number;
  /** The last few stretches of those steps, oldest first: where each began and what was held on foot. */
  walk: WireRun[];
}
export interface CommandMessage {
  v: number; type: 'command'; id: number; command: Command;
  /** The guest had taken this many steps when it asked: the host runs the command once it has walked the guest that far. */
  at: number;
}
export interface PingMessage { v: number; type: 'ping'; time: number; have: number; events: number }
export interface GuestLeaveMessage { v: number; type: 'leave' }

/** What a guest may send. */
export type ClientMessage = JoinMessage | InputMessage | CommandMessage | PingMessage | GuestLeaveMessage;

/**
 * Why the host lets a guest go.
 * - `full`: four players already, and no free seat to take over.
 * - `version`: the guest speaks another `PROTOCOL_VERSION`.
 * - `replaced`: the same key joined on another connection.
 * - `closed`: the host stopped sharing the game.
 */
export type LeaveReason = 'full' | 'version' | 'replaced' | 'closed';

export interface WelcomeMessage {
  v: number;
  type: 'welcome';
  /** One number per host session. A new one means a new game on the host: forget everything. */
  session: number;
  /** One number per sitting: each time a wire is given a player. A new one means commands count from 1 again. */
  sitting: number;
  playerId: PlayerId;
  hostId: PlayerId;
  /** The snapshot this state is. */
  id: number;
  step: number;
  hash: string;
  state: GameState;
  /** Events the host had sent before this: the next one is numbered this. */
  events: number;
  /** How many of this guest's steps the host has walked. 0 at the start of a sitting. */
  walked: number;
}
export interface StateMessage {
  v: number;
  type: 'state';
  id: number;
  step: number;
  /** `hashState` of the whole state this message makes. */
  hash: string;
  /** The last `input.seq` the host had from this guest. */
  ack: number;
  /** How many of this guest's steps (`input.step`) the host had walked when it took this snapshot. */
  walked: number;
  /** The snapshot `changed` is against. Null: `changed` is the whole state. */
  base: number | null;
  changed: Partial<GameState>;
}
export interface EventsMessage { v: number; type: 'events'; first: number; step: number; events: GameEvent[] }
export interface ResultMessage { v: number; type: 'result'; id: number; result: CommandResult }
export interface PongMessage { v: number; type: 'ping'; time: number }
export interface HostLeaveMessage { v: number; type: 'leave'; reason: LeaveReason }

/** What the host may send. */
export type HostMessage = WelcomeMessage | StateMessage | EventsMessage | ResultMessage | PongMessage | HostLeaveMessage;

// --- Reading what a guest sent ---------------------------------------------------
// Everything below runs on the host against text from somebody else's browser.
// It never throws and never lets through a field it does not name.

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** True when `value` has exactly these keys: all of `required`, any of `optional`, nothing else. */
function hasOnly(value: Raw, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => required.includes(key) || optional.includes(key));
}

const isWhole = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;

const isAxis = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const clampAxis = (value: number): number => Math.max(-1, Math.min(1, value));

/** A key of one of the data tables, and not something inherited (`constructor`, `__proto__`). */
const isIdOf = (table: object, value: unknown): boolean => typeof value === 'string' && Object.hasOwn(table, value);

const COUNT_LIMIT = 9999;
const INPUT_KEYS = ['paddle', 'steer', 'powerStroke', 'bail', 'moveX', 'moveY', 'run', 'cameraYaw'] as const;

/** A `StepInput` from the wire: the eight fields and nothing else, axes clamped to -1..1. Null when it is anything else. */
export function readInput(raw: unknown): StepInput | null {
  if (!isRecord(raw) || !hasOnly(raw, INPUT_KEYS, ['jump'])) return null;
  if (raw.jump !== undefined && typeof raw.jump !== 'boolean') return null;
  const { paddle, steer, powerStroke, bail, moveX, moveY, run, cameraYaw } = raw;
  if (!isAxis(paddle) || !isAxis(steer) || !isAxis(moveX) || !isAxis(moveY) || !isAxis(cameraYaw)) return null;
  if (typeof powerStroke !== 'boolean' || typeof bail !== 'boolean' || typeof run !== 'boolean') return null;
  if (Math.abs(cameraYaw) > 1e6) return null;
  return {
    paddle: clampAxis(paddle), steer: clampAxis(steer), powerStroke, bail,
    moveX: clampAxis(moveX), moveY: clampAxis(moveY), run, cameraYaw,
    ...(raw.jump === true ? { jump: true } : {}),
  };
}

const bare = <Type extends Command['type']>(type: Type) => (raw: Raw): Command | null =>
  (hasOnly(raw, ['type']) ? { type } as Command : null);

/**
 * One reader per command. Typed over the command union, so a new command does
 * not compile until it has a reader here: nothing gets to `dispatch` unread.
 */
const COMMAND_READERS: { [Type in Command['type']]: (raw: Raw) => Command | null } = {
  craft: (raw) => {
    if (!hasOnly(raw, ['type', 'recipeId'], ['count']) || !isIdOf(RECIPES, raw.recipeId)) return null;
    if (raw.count !== undefined && !isWhole(raw.count, 1, COUNT_LIMIT)) return null;
    return { type: 'craft', recipeId: raw.recipeId, ...(raw.count === undefined ? {} : { count: raw.count }) } as Command;
  },
  upgrade_hull: bare('upgrade_hull'),
  build_attachment: (raw) => (hasOnly(raw, ['type', 'attachmentId']) && isIdOf(ATTACHMENTS, raw.attachmentId)
    ? { type: 'build_attachment', attachmentId: raw.attachmentId } as Command : null),
  stow_backpack: bare('stow_backpack'),
  transfer: (raw) => readMove(raw, 'transfer'),
  discard: (raw) => readMove(raw, 'discard'),
  // Only the drop's number: what comes back, and how many, is the host's own record (`src/sim/takeback.ts`).
  take_back: (raw) => (hasOnly(raw, ['type', 'drop']) && isWhole(raw.drop, 1, Number.MAX_SAFE_INTEGER) ? { type: 'take_back', drop: raw.drop } : null),
  // A crewmate by number, an item and a count: who is close, what is held and what fits is the host's to say (`src/sim/give.ts`).
  give: (raw) => (hasOnly(raw, ['type', 'to', 'itemId', 'count']) && isWhole(raw.to, 0, 3) && isIdOf(ITEMS, raw.itemId) && isWhole(raw.count, 1, COUNT_LIMIT)
    ? { type: 'give', to: raw.to, itemId: raw.itemId, count: raw.count } as Command : null),
  eat: (raw) => (hasOnly(raw, ['type', 'itemId']) && isIdOf(ITEMS, raw.itemId) ? { type: 'eat', itemId: raw.itemId } as Command : null),
  drink: (raw) => (hasOnly(raw, ['type', 'itemId']) && isIdOf(ITEMS, raw.itemId) ? { type: 'drink', itemId: raw.itemId } as Command : null),
  fill_water: (raw) => (hasOnly(raw, ['type', 'count']) && isWhole(raw.count, 1, COUNT_LIMIT) ? { type: 'fill_water', count: raw.count } : null),
  scavenge: bare('scavenge'),
  sleep: bare('sleep'),
  wake: bare('wake'),
  board: bare('board'),
  disembark: bare('disembark'),
  talk: (raw) => (hasOnly(raw, ['type', 'npcId']) && isIdOf(NPCS, raw.npcId) ? { type: 'talk', npcId: raw.npcId } as Command : null),
  choose_dialogue_option: (raw) => (hasOnly(raw, ['type', 'optionIndex']) && isWhole(raw.optionIndex, 0, 99)
    ? { type: 'choose_dialogue_option', optionIndex: raw.optionIndex } : null),
  end_dialogue: bare('end_dialogue'),
  accept_quest: (raw) => (hasOnly(raw, ['type', 'questId']) && isIdOf(QUESTS, raw.questId) ? { type: 'accept_quest', questId: raw.questId } as Command : null),
  turn_in_quest: (raw) => (hasOnly(raw, ['type', 'questId']) && isIdOf(QUESTS, raw.questId) ? { type: 'turn_in_quest', questId: raw.questId } as Command : null),
  track_quest: (raw) => (hasOnly(raw, ['type', 'questId'], ['tracked']) && (raw.questId === null || isIdOf(QUESTS, raw.questId))
    && (raw.tracked === undefined || typeof raw.tracked === 'boolean')
    ? { type: 'track_quest', questId: raw.questId, ...(raw.tracked === undefined ? {} : { tracked: raw.tracked }) } as Command : null),
  toggle_lantern: bare('toggle_lantern'),
  select_tool: (raw) => (hasOnly(raw, ['type', 'toolId']) && (raw.toolId === null || (TOOL_IDS as unknown[]).includes(raw.toolId))
    ? { type: 'select_tool', toolId: raw.toolId } as Command : null),
  move_tool: (raw) => (hasOnly(raw, ['type', 'toolId', 'slot']) && (TOOL_IDS as unknown[]).includes(raw.toolId) && isWhole(raw.slot, 0, TOOL_IDS.length - 1)
    ? { type: 'move_tool', toolId: raw.toolId, slot: raw.slot } as Command : null),
  set_sail: (raw) => (hasOnly(raw, ['type', 'raised']) && typeof raw.raised === 'boolean' ? { type: 'set_sail', raised: raw.raised } : null),
  claim_rewards: bare('claim_rewards'),
  set_difficulty: (raw) => (hasOnly(raw, ['type', 'difficulty']) && (raw.difficulty === 'relaxed' || raw.difficulty === 'standard')
    ? { type: 'set_difficulty', difficulty: raw.difficulty } : null),
  // Any finite spot may be asked for: the rules say whether it is on the chart (`src/sim/pings.ts`).
  ping: (raw) => (hasOnly(raw, ['type', 'x', 'z']) && isAxis(raw.x) && isAxis(raw.z) ? { type: 'ping', x: raw.x, z: raw.z } : null),
  clear_ping: (raw) => (hasOnly(raw, ['type', 'playerId']) && isWhole(raw.playerId, 0, 3) ? { type: 'clear_ping', playerId: raw.playerId } : null),
};

/**
 * Every command a guest may send: the keys of the reader table itself. A test reads its list of commands from
 * here, so a new command with no example on the wire fails it (the master review of round 3, finding 9).
 */
export const COMMAND_TYPES = Object.keys(COMMAND_READERS) as Command['type'][];

function readMove(raw: Raw, type: 'transfer' | 'discard'): Command | null {
  if (!hasOnly(raw, ['type', 'from', 'itemId', 'count'])) return null;
  if (raw.from !== 'backpack' && raw.from !== 'cargo') return null;
  if (!isIdOf(ITEMS, raw.itemId) || !isWhole(raw.count, 1, COUNT_LIMIT)) return null;
  return { type, from: raw.from, itemId: raw.itemId, count: raw.count } as Command;
}

/** A `Command` from the wire: a known type, its own fields and nothing else, every id one the game has. Null otherwise. */
export function readCommand(raw: unknown): Command | null {
  if (!isRecord(raw) || typeof raw.type !== 'string' || !Object.hasOwn(COMMAND_READERS, raw.type)) return null;
  return COMMAND_READERS[raw.type as Command['type']](raw);
}

/** Letters a guest's key may hold, and how many. Long enough not to guess, short enough to log. */
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** True when `raw` is a message of another protocol version: worth a `leave` saying so. */
export function isOtherVersion(raw: unknown): boolean {
  return isRecord(raw) && typeof raw.v === 'number' && raw.v !== PROTOCOL_VERSION;
}

/**
 * A guest's message, checked field by field. Null when it is not exactly one
 * of the five a guest may send: wrong version, unknown type, a missing or
 * extra field (a `playerId`, say), a number that is not one.
 */
export function readClientMessage(raw: unknown): ClientMessage | null {
  if (!isRecord(raw) || raw.v !== PROTOCOL_VERSION) return null;
  const v = PROTOCOL_VERSION;
  switch (raw.type) {
    case 'join':
      if (!hasOnly(raw, ['v', 'type', 'name', 'key'])) return null;
      if (typeof raw.name !== 'string' || raw.name.length > 200) return null;
      if (typeof raw.key !== 'string' || !KEY_PATTERN.test(raw.key)) return null;
      return { v, type: 'join', name: raw.name, key: raw.key };
    case 'input': {
      if (!hasOnly(raw, ['v', 'type', 'seq', 'have', 'events', 'input', 'step', 'walk'])) return null;
      const input = readInput(raw.input);
      if (!input || !isWhole(raw.seq, 0, Number.MAX_SAFE_INTEGER)) return null;
      if (!isWhole(raw.have, -1, Number.MAX_SAFE_INTEGER) || !isWhole(raw.events, 0, Number.MAX_SAFE_INTEGER)) return null;
      if (!isWhole(raw.step, 0, Number.MAX_SAFE_INTEGER) || !Array.isArray(raw.walk) || raw.walk.length > WALK_RUNS_SENT) return null;
      const walk: WireRun[] = [];
      for (const entry of raw.walk) {
        const run = readWalkRun(entry);
        // Each stretch begins after the one before it, and before the step the guest says it is on.
        if (!run || run[0] >= raw.step || (walk.length > 0 && run[0] <= walk.at(-1)![0])) return null;
        walk.push(run);
      }
      return { v, type: 'input', seq: raw.seq, have: raw.have, events: raw.events, input, step: raw.step, walk };
    }
    case 'command': {
      if (!hasOnly(raw, ['v', 'type', 'id', 'command', 'at'])) return null;
      const command = readCommand(raw.command);
      if (!command || !isWhole(raw.id, 1, Number.MAX_SAFE_INTEGER) || !isWhole(raw.at, 0, Number.MAX_SAFE_INTEGER)) return null;
      return { v, type: 'command', id: raw.id, command, at: raw.at };
    }
    case 'ping':
      if (!hasOnly(raw, ['v', 'type', 'time', 'have', 'events'])) return null;
      if (typeof raw.time !== 'number' || !Number.isFinite(raw.time)) return null;
      if (!isWhole(raw.have, -1, Number.MAX_SAFE_INTEGER) || !isWhole(raw.events, 0, Number.MAX_SAFE_INTEGER)) return null;
      return { v, type: 'ping', time: raw.time, have: raw.have, events: raw.events };
    case 'leave':
      return hasOnly(raw, ['v', 'type']) ? { v, type: 'leave' } : null;
    default:
      return null;
  }
}

/**
 * The host's message, as a guest reads it. The guest takes the host's word
 * for the game, so this only checks that the message is one it can use: the
 * right version, a known type, the numbers it steers by.
 */
export function readHostMessage(raw: unknown): HostMessage | null {
  if (!isRecord(raw) || raw.v !== PROTOCOL_VERSION) return null;
  const whole = (value: unknown): boolean => isWhole(value, 0, Number.MAX_SAFE_INTEGER);
  switch (raw.type) {
    case 'welcome':
      return whole(raw.session) && whole(raw.sitting) && isWhole(raw.playerId, 0, 3) && isWhole(raw.hostId, 0, 3) && whole(raw.id) && whole(raw.step)
        && typeof raw.hash === 'string' && isRecord(raw.state) && Array.isArray(raw.state.players) && whole(raw.events) && whole(raw.walked)
        ? raw as unknown as WelcomeMessage : null;
    case 'state':
      return whole(raw.id) && whole(raw.step) && typeof raw.hash === 'string' && isWhole(raw.ack, -1, Number.MAX_SAFE_INTEGER)
        && (raw.base === null || whole(raw.base)) && isRecord(raw.changed) && whole(raw.walked)
        ? raw as unknown as StateMessage : null;
    case 'events':
      return whole(raw.first) && whole(raw.step) && Array.isArray(raw.events) ? raw as unknown as EventsMessage : null;
    case 'result':
      return whole(raw.id) && isRecord(raw.result) && typeof raw.result.ok === 'boolean' ? raw as unknown as ResultMessage : null;
    case 'ping':
      return typeof raw.time === 'number' ? raw as unknown as PongMessage : null;
    case 'leave':
      return raw.reason === 'full' || raw.reason === 'version' || raw.reason === 'replaced' || raw.reason === 'closed'
        ? raw as unknown as HostLeaveMessage : null;
    default:
      return null;
  }
}
