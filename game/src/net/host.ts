/**
 * The host's side of a shared game. The host's browser runs the one true
 * game; this hands it to the guests and takes from them only two things: what
 * each one holds this step, and what each one asks for. No DOM in here.
 *
 * - `accept(transport)`: one more wire. Whoever is on it is nobody until they
 *   `join`; then they are one player, and every later message on that wire is
 *   that player's. Nothing on the wire can name another, and a second `join`
 *   under another key is refused: one wire never holds two seats.
 * - A seat is given back. While the canoe has room a key gets its own player
 *   and a name its old seat. When the canoe is full, a new guest takes the
 *   seat of a player who is away, the one away the longest (`longestAway`).
 *   Nobody who is here loses a seat, and the host never does.
 * - `crewInput(input, playerId)`: the host's own input plus every guest's
 *   latest, indexed by player id, ready for `step`.
 * - `afterFrame(events, seconds)`: call once a frame after stepping and
 *   draining. Sends the frame's events at once, the state about 15 times a
 *   second, and marks away whoever has gone quiet.
 *
 * A guest's command runs between two of the host's frames, through the same
 * `dispatch` the host's own keys use: the moment it arrives, or, for a guest
 * on foot, once the host has walked them to where they were when they asked.
 *
 * A guest on foot is walked through its own numbered steps (`walk.ts`), one
 * for each step of the host: so its own screen can show the same walk at once
 * and be right. The host still takes no position from anyone.
 */
import { addPlayer, dispatch, hashState, setConnected, setPlayerName, cleanPlayerName, NEUTRAL_INPUT } from '../sim/index.ts';
import type { CommandResult, GameEvent, GameState, PlayerId, StepInput } from '../sim/index.ts';
import { PROTOCOL_VERSION, isOtherVersion, readClientMessage } from './messages.ts';
import type { ClientMessage, HostMessage, LeaveReason } from './messages.ts';
import type { Transport } from './transport.ts';
import { WalkTimeline } from './walk.ts';

export interface HostOptions {
  /** The game being shared. The link changes it only through the rules engine. */
  game: GameState;
  /** The player the host's own screen plays. */
  hostPlayerId: PlayerId;
  /** Seconds between state messages. Default 1/15. */
  stateSeconds?: number;
  /** A guest not heard from for this long is marked away. Default 10. */
  silenceSeconds?: number;
  /** A number for this session. Default: a random one. */
  session?: number;
}

export interface HostStats {
  /** Messages thrown away: not a message, a field too many, sent before joining, a command only the host may give, a join under a second key. */
  refused: number;
  /** State messages sent, whole and as changes. */
  statesSent: number;
  fullStatesSent: number;
  commandsRun: number;
}

/** An input older than this is let go of: a guest whose screen froze does not paddle on. */
export const STALE_INPUT_SECONDS = 0.5;
/** Snapshots kept to send changes against. About four seconds at 15 a second. */
const HISTORY = 64;
/** Events kept to send again. */
const EVENT_LOG = 512;
/** Events not confirmed after this long are sent again. */
const EVENT_RESEND_SECONDS = 0.3;
/** Results kept per guest, to answer a command that is sent twice. */
const RESULTS_KEPT = 32;
/** A command waits this long at most for the guest's walk to reach the step it was asked at. */
export const COMMAND_WAIT_SECONDS = 1;

interface Connection {
  transport: Transport;
  /** The one player this wire may act for. Null before `join` and after going away. */
  playerId: PlayerId | null;
  /** The key this wire first joined with. A wire is one guest: it never gets to join under another. */
  key: string | null;
  input: StepInput;
  inputSeq: number;
  inputAt: number;
  /** The newest snapshot the guest has said it holds. */
  have: number;
  /** Events the guest has said it holds. */
  eventsHeld: number;
  eventsSentAt: number;
  /** Which sitting this is: a new number each time this wire is given a player. */
  sitting: number;
  /** The last command run for this guest in this sitting. They count from 1, with no gaps. */
  lastCommandId: number;
  results: Map<number, CommandResult>;
  /** The guest's walk on foot, step by step. */
  walk: WalkTimeline;
  /** Commands taken and not yet run: each waits for the walk to reach the step it was asked at. In order. */
  waiting: { message: Extract<ClientMessage, { type: 'command' }>; since: number }[];
  heardAt: number;
  open: boolean;
}

interface Snapshot {
  id: number;
  step: number;
  hash: string;
  /** The state as sent: the game's own top-level values, read at once by `send`. */
  state: GameState;
  /** Each top-level key as JSON, to tell what changed. */
  parts: Record<string, string>;
}

export class HostLink {
  readonly session: number;
  readonly stats: HostStats = { refused: 0, statesSent: 0, fullStatesSent: 0, commandsRun: 0 };
  private readonly game: GameState;
  private readonly hostPlayerId: PlayerId;
  private readonly stateSeconds: number;
  private readonly silenceSeconds: number;
  private readonly connections: Connection[] = [];
  /** What the room remembers: which player each key is. Never sent to anyone. */
  private readonly keys = new Map<string, PlayerId>();
  /**
   * When each player last went away, as a count of leavings: 1 for the first this host saw, 2 for the next.
   * A player with no number was already away when this host started. Read only for players who are away.
   */
  private readonly leftAt = new Map<PlayerId, number>();
  private leavings = 0;
  private history: Snapshot[] = [];
  private nextSnapshotId = 1;
  private nextSitting = 1;
  private eventLog: { step: number; event: GameEvent }[] = [];
  /** Events sent since the session began. The log holds the last of them. */
  private eventCount = 0;
  private clock = 0;
  private sinceState = 0;
  private closed = false;

  constructor(options: HostOptions) {
    this.game = options.game;
    this.hostPlayerId = options.hostPlayerId;
    this.stateSeconds = options.stateSeconds ?? 1 / 15;
    this.silenceSeconds = options.silenceSeconds ?? 10;
    this.session = options.session ?? Math.floor(Math.random() * 0x7fffffff);
  }

  /** Players with a guest on the wire right now, in no order. */
  get guests(): PlayerId[] {
    return this.connections.filter((connection) => connection.playerId !== null).map((connection) => connection.playerId!);
  }

  /** One more wire. Nobody until they join. */
  accept(transport: Transport): void {
    if (this.closed) {
      transport.close();
      return;
    }
    const connection: Connection = {
      transport, playerId: null, key: null, input: { ...NEUTRAL_INPUT }, inputSeq: -1, inputAt: 0, have: -1, eventsHeld: 0, eventsSentAt: 0,
      sitting: 0, lastCommandId: 0, results: new Map(), walk: new WalkTimeline(this.game.tick), waiting: [],
      heardAt: this.clock, open: true,
    };
    this.connections.push(connection);
    transport.receive(
      (raw) => this.onMessage(connection, raw),
      () => {
        connection.open = false;
        this.goneAway(connection);
        this.forget(connection);
      },
    );
  }

  private send(connection: Connection, message: HostMessage): void {
    if (connection.open) connection.transport.send(message);
  }

  private forget(connection: Connection): void {
    const index = this.connections.indexOf(connection);
    if (index >= 0) this.connections.splice(index, 1);
  }

  /** The guest on this wire is no longer playing. Their player stays, away. */
  private goneAway(connection: Connection): void {
    const playerId = connection.playerId;
    if (playerId === null) return;
    connection.playerId = null;
    connection.input = { ...NEUTRAL_INPUT };
    connection.waiting = [];
    // Someone else may already be playing them on a new wire.
    if (this.connections.some((other) => other !== connection && other.playerId === playerId)) return;
    if (!setConnected(this.game, playerId, false)) return;
    this.leavings += 1;
    this.leftAt.set(playerId, this.leavings);
  }

  private turnAway(connection: Connection, reason: LeaveReason): void {
    this.send(connection, { v: PROTOCOL_VERSION, type: 'leave', reason });
    connection.open = false;
    connection.playerId = null;
    connection.transport.close();
    this.forget(connection);
  }

  private onMessage(connection: Connection, raw: unknown): void {
    if (this.closed || !connection.open) return;
    const message = readClientMessage(raw);
    if (!message) {
      this.stats.refused += 1;
      if (isOtherVersion(raw)) this.turnAway(connection, 'version');
      return;
    }
    connection.heardAt = this.clock;
    if (message.type === 'join') {
      this.join(connection, message.name, message.key);
      return;
    }
    // Before joining, a wire is nobody: it moves no one and asks for nothing.
    if (connection.playerId === null) {
      this.stats.refused += 1;
      return;
    }
    this.fromPlayer(connection, message);
  }

  /** Everything a joined guest may say. Whose it is comes from the wire (`connection.playerId`), never from the message. */
  private fromPlayer(connection: Connection, message: Exclude<ClientMessage, { type: 'join' }>): void {
    switch (message.type) {
      case 'input':
        // An older input that arrives late does not undo a newer one.
        if (message.seq > connection.inputSeq) {
          connection.inputSeq = message.seq;
          connection.input = message.input;
          connection.inputAt = this.clock;
          // The guest could not use the changes it was sent: start it over from a whole state.
          if (message.have === -1) connection.have = -1;
        }
        // The walk is told a few stretches at a time, so one that arrives late or twice still only adds what was missing.
        connection.walk.heard(message.step, message.walk);
        this.heardHolding(connection, message.have, message.events);
        break;
      case 'ping':
        this.heardHolding(connection, message.have, message.events);
        this.send(connection, { v: PROTOCOL_VERSION, type: 'ping', time: message.time });
        break;
      case 'command': {
        const last = connection.lastCommandId;
        if (message.id <= last) {
          // Sent twice: answer again, run nothing.
          const result = connection.results.get(message.id);
          if (result) this.send(connection, { v: PROTOCOL_VERSION, type: 'result', id: message.id, result });
          break;
        }
        // In order, one at a time: a later one waits for the guest to send the earlier one again.
        if (message.id !== last + 1) break;
        connection.lastCommandId = message.id;
        connection.waiting.push({ message, since: this.clock });
        this.runWaiting(connection);
        break;
      }
      case 'leave':
        this.goneAway(connection);
        break;
    }
  }

  private heardHolding(connection: Connection, have: number, events: number): void {
    // Only ever what this host sent: a guest cannot claim a snapshot from the future.
    if (have < this.nextSnapshotId && have > connection.have) connection.have = have;
    if (events <= this.eventCount && events > connection.eventsHeld) connection.eventsHeld = events;
  }

  private onFoot(playerId: PlayerId): boolean {
    return this.game.players.find((player) => player.id === playerId)?.mode === 'foot';
  }

  /**
   * Run the commands whose turn has come, in order. A guest on foot asked from
   * where its own screen had it: the command waits until the host has walked
   * it there (a moment), so what was in reach on its screen is in reach here.
   */
  private runWaiting(connection: Connection): void {
    while (connection.waiting.length > 0 && connection.playerId !== null) {
      const { message, since } = connection.waiting[0]!;
      connection.walk.account(this.game.tick);
      const due = !this.onFoot(connection.playerId) || connection.walk.reached(message.at) || this.clock - since >= COMMAND_WAIT_SECONDS;
      if (!due) return;
      connection.waiting.shift();
      const result = this.run(connection.playerId, message);
      connection.results.set(message.id, result);
      if (connection.results.size > RESULTS_KEPT) connection.results.delete(connection.results.keys().next().value!);
      this.send(connection, { v: PROTOCOL_VERSION, type: 'result', id: message.id, result });
    }
  }

  private run(playerId: PlayerId, message: Extract<ClientMessage, { type: 'command' }>): CommandResult {
    // The difficulty is the host's setting.
    if (message.command.type === 'set_difficulty') {
      this.stats.refused += 1;
      return { ok: false, reason: 'unknown_id', missing: null };
    }
    this.stats.commandsRun += 1;
    try {
      return dispatch(this.game, message.command, playerId);
    } catch {
      return { ok: false, reason: 'unknown_id', missing: null };
    }
  }

  /** Is anyone bound to this player by a key? While the canoe has room, such a player can only be had back with that key. */
  private bound(playerId: PlayerId): boolean {
    return [...this.keys.values()].includes(playerId);
  }

  /**
   * The seat a new guest takes when the canoe is full: the player who has been
   * away the longest. Never one who is here, never the host's.
   *
   * "Longest" is the one who left first, of those this host saw leave. A
   * player who was already away when the host started has been away longer
   * than any of those. The host has no memory of the order such players left
   * in (the saved game does not keep it), so among them the highest seat goes
   * first: seats are handed out in order, so the first friend to have joined
   * the save is the last to lose a seat.
   */
  private longestAway(): { id: PlayerId; connected: boolean } | undefined {
    let longest: { id: PlayerId; connected: boolean } | undefined;
    let longestLeft = 0;
    for (const player of this.game.players) {
      if (player.connected || player.id === this.hostPlayerId) continue;
      const left = this.leftAt.get(player.id) ?? 0;
      if (longest === undefined || left < longestLeft || (left === longestLeft && player.id > longest.id)) {
        longest = player;
        longestLeft = left;
      }
    }
    return longest;
  }

  private join(connection: Connection, rawName: string, key: string): void {
    // One wire, one seat. A wire that asks again under another key would be handed a second player, and a third:
    // every seat in the canoe, each one counted as here for as long as that one wire talks.
    if (connection.key !== null && connection.key !== key) {
      this.stats.refused += 1;
      return;
    }
    connection.key = key;
    const game = this.game;
    const name = cleanPlayerName(rawName);
    let playerId = this.keys.get(key);
    let joined = false;
    if (playerId === undefined || !game.players.some((player) => player.id === playerId)) {
      const free = (player: { id: PlayerId; connected: boolean }): boolean =>
        !player.connected && player.id !== this.hostPlayerId && !this.bound(player.id);
      // Someone who played under this name before the host last started, a new seat, or a stand-in nobody named.
      const returning = name === '' ? undefined : game.players.find((player) => free(player) && player.name === name);
      const room = returning ?? addPlayer(game) ?? game.players.find((player) => free(player) && player.name === '');
      // The canoe is full: the seat of whoever has been away the longest. All four here: no seat.
      const taken = room ?? this.longestAway();
      if (!taken) {
        this.turnAway(connection, 'full');
        return;
      }
      if (!room) {
        // The seat changes hands, as it stands: pack, meters, spot. Whoever held it is a new guest if they come back,
        // so their key is forgotten and their name comes off. The crew is told someone joined, not that someone is back.
        for (const [held, holder] of this.keys) {
          if (holder === taken.id) this.keys.delete(held);
        }
        setPlayerName(game, taken.id, name);
        setConnected(game, taken.id, true, true);
      }
      joined = taken !== returning && taken.connected;
      playerId = taken.id;
      this.keys.set(key, playerId);
    }
    // The same key on a new wire: the old wire is let go.
    for (const other of [...this.connections]) {
      if (other !== connection && other.playerId === playerId) this.turnAway(other, 'replaced');
    }
    if (connection.playerId === null) {
      // A new sitting on this wire: counts start over.
      connection.inputSeq = -1;
      connection.input = { ...NEUTRAL_INPUT };
      connection.have = -1;
      connection.eventsHeld = this.eventCount;
      connection.sitting = this.nextSitting;
      this.nextSitting += 1;
      connection.lastCommandId = 0;
      connection.results.clear();
      connection.walk = new WalkTimeline(game.tick);
      connection.waiting = [];
    }
    connection.playerId = playerId;
    if (name !== '') setPlayerName(game, playerId, name);
    if (joined) game.events.push({ type: 'crew_changed', who: playerId, change: 'joined' });
    else setConnected(game, playerId, true);

    const snapshot = this.snapshot();
    this.send(connection, {
      v: PROTOCOL_VERSION, type: 'welcome', session: this.session, sitting: connection.sitting, playerId, hostId: this.hostPlayerId,
      id: snapshot.id, step: snapshot.step, hash: snapshot.hash, state: snapshot.state, events: this.eventCount,
      walked: connection.walk.walked,
    });
  }

  /** The game as it stands, numbered and kept, so later messages can say what changed since. */
  private snapshot(): Snapshot {
    const state: GameState = { ...this.game, events: [] };
    const parts: Record<string, string> = {};
    for (const [key, value] of Object.entries(state)) parts[key] = JSON.stringify(value);
    const snapshot: Snapshot = { id: this.nextSnapshotId, step: state.tick, hash: hashState(state), state, parts };
    this.nextSnapshotId += 1;
    this.history.push(snapshot);
    if (this.history.length > HISTORY) this.history.shift();
    return snapshot;
  }

  /**
   * The host's own input and every guest's, by player id. A guest aboard holds
   * its latest input, or nothing once it has gone quiet. A guest on foot holds
   * the next step of its own walk, or nothing while that has not arrived.
   */
  crewInput(input: StepInput, playerId: PlayerId): (StepInput | undefined)[] {
    const inputs: (StepInput | undefined)[] = [];
    for (const connection of this.connections) {
      if (connection.playerId === null) continue;
      connection.walk.account(this.game.tick);
      this.runWaiting(connection);
      const step = connection.walk.next(this.onFoot(connection.playerId));
      inputs[connection.playerId] = step !== null ? step
        : this.clock - connection.inputAt > STALE_INPUT_SECONDS ? undefined : connection.input;
    }
    inputs[playerId] = input;
    return inputs;
  }

  /**
   * Once a frame, after the step and the drain. `events` is everything the
   * frame drained: every guest gets all of it, as the host's own screen does.
   */
  afterFrame(events: readonly GameEvent[], frameSeconds: number): void {
    if (this.closed) return;
    this.clock += frameSeconds;

    for (const connection of [...this.connections]) {
      if (connection.playerId !== null && this.clock - connection.heardAt > this.silenceSeconds) this.goneAway(connection);
    }
    // Count the steps just run on each guest's walk, so the state below says how far each was walked.
    for (const connection of this.connections) {
      if (connection.playerId === null) continue;
      connection.walk.account(this.game.tick);
      this.runWaiting(connection);
    }

    if (events.length > 0) {
      const first = this.eventCount;
      const step = this.game.tick;
      for (const event of events) this.eventLog.push({ step, event });
      this.eventCount += events.length;
      if (this.eventLog.length > EVENT_LOG) this.eventLog.splice(0, this.eventLog.length - EVENT_LOG);
      for (const connection of this.connections) {
        if (connection.playerId === null) continue;
        this.send(connection, { v: PROTOCOL_VERSION, type: 'events', first, step, events: [...events] });
        connection.eventsSentAt = this.clock;
      }
    }

    this.sinceState += frameSeconds;
    if (this.sinceState < this.stateSeconds) return;
    this.sinceState %= this.stateSeconds;
    if (!this.connections.some((connection) => connection.playerId !== null)) return;
    const snapshot = this.snapshot();
    for (const connection of this.connections) {
      if (connection.playerId === null) continue;
      this.sendState(connection, snapshot);
      this.sendEventsAgain(connection);
    }
  }

  private sendState(connection: Connection, snapshot: Snapshot): void {
    const base = this.history.find((entry) => entry.id === connection.have && entry.id < snapshot.id) ?? null;
    let changed: Partial<GameState> = snapshot.state;
    if (base) {
      const partial: Record<string, unknown> = {};
      for (const key of Object.keys(snapshot.parts)) {
        if (snapshot.parts[key] !== base.parts[key]) partial[key] = (snapshot.state as unknown as Record<string, unknown>)[key];
      }
      changed = partial as Partial<GameState>;
    } else {
      this.stats.fullStatesSent += 1;
    }
    this.stats.statesSent += 1;
    this.send(connection, {
      v: PROTOCOL_VERSION, type: 'state', id: snapshot.id, step: snapshot.step, hash: snapshot.hash,
      ack: connection.inputSeq, walked: connection.walk.walked, base: base ? base.id : null, changed,
    });
  }

  /** Events the guest has not confirmed, once they have had time to: sent again from where the guest is. */
  private sendEventsAgain(connection: Connection): void {
    if (connection.eventsHeld >= this.eventCount || this.clock - connection.eventsSentAt < EVENT_RESEND_SECONDS) return;
    const logStart = this.eventCount - this.eventLog.length;
    const first = Math.max(connection.eventsHeld, logStart);
    const entries = this.eventLog.slice(first - logStart);
    if (entries.length === 0) return;
    this.send(connection, { v: PROTOCOL_VERSION, type: 'events', first, step: entries[0]!.step, events: entries.map((entry) => entry.event) });
    connection.eventsSentAt = this.clock;
  }

  /** Stop sharing. Every guest is told and marked away; their players stay in the game. */
  close(): void {
    if (this.closed) return;
    for (const connection of [...this.connections]) {
      const playerId = connection.playerId;
      this.turnAway(connection, 'closed');
      if (playerId !== null) setConnected(this.game, playerId, false, true);
    }
    this.closed = true;
  }
}
