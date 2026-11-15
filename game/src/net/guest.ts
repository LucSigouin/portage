/**
 * The guest's side of a shared game. It runs no rules that count: it sends
 * what its player holds and what its player asks for, and shows what the host
 * says the game is. No DOM in here.
 *
 * - `truth`: the newest state the host sent, exactly (its fingerprint is checked).
 * - `view()`: the state to draw. A beat behind the truth, with the canoe, the
 *   players and the clock moved smoothly between the two states it sits
 *   between, so fifteen states a second draw as sixty frames. One thing in it
 *   is not behind: this guest's own player on foot, drawn where its own keys
 *   have walked it (`walk.ts`). That is a layer over the view: `truth` and the
 *   fingerprints never see it.
 * - `sendInput(input)`, `sendCommand(command)`, `takeEvents()`, `takeResults()`:
 *   what a solo session does with the rules engine, done over the wire.
 * - `update(seconds)`: call once a frame. Runs the clock, the resends and the pings.
 */
import { CHARACTER_IDS } from '../data/index.ts';
import type { CharacterId } from '../data/index.ts';
import { airborne, blendLeap, hashState } from '../sim/index.ts';
import type { Command, CommandResult, GameEvent, GameState, PlayerId, PlayerState, StepInput } from '../sim/index.ts';
import { carryOf } from './carry.ts';
import type { CarryKeeper } from './carry.ts';
import { PROTOCOL_VERSION, readHostMessage } from './messages.ts';
import type { ClientMessage, LeaveReason } from './messages.ts';
import type { Transport } from './transport.ts';
import { WALK_AHEAD_STEPS, WalkPredictor } from './walk.ts';
import type { WalkShown } from './walk.ts';

export interface GuestOptions {
  /** The name to play under. The host cuts it to 12 letters. */
  name: string;
  /** This guest's secret for the room: 8 to 64 letters, digits, `_` or `-`. The same key gets the same player back. */
  key: string;
  /**
   * Who this guest picked to be (the pick screen). The lobby's join always says. Left out (a test, a tool): the
   * first of the cast, since a join must name one.
   */
  character?: CharacterId;
  /** Where this guest keeps its own pack and meters between crews. Left out: nothing is brought or kept. */
  carry?: CarryKeeper;
  /** How far behind the newest state the view runs, in steps of 1/60 s. Default 6 (a tenth of a second). */
  delaySteps?: number;
  /**
   * Draw this guest's own walking at once, ahead of the host's answer. Default
   * true. False draws the guest's own player a beat behind like everyone else
   * (the walk is still sent: the host walks the guest by it either way).
   */
  predictWalk?: boolean;
}

/**
 * - `joining`: asking, no answer yet.
 * - `playing`: welcomed, states arriving.
 * - `refused`: the host said no (`leaveReason`).
 * - `closed`: over: the host let this guest go, or this guest left.
 */
export type GuestStatus = 'joining' | 'playing' | 'refused' | 'closed';

export interface CommandOutcome {
  id: number;
  command: Command;
  result: CommandResult;
  /** As passed to `sendCommand`: a refusal should not be shown. */
  quiet: boolean;
}

const STEPS_PER_SECOND = 60;
/** Truth snapshots kept, to rebuild a state from the one its changes are against. */
const HISTORY = 64;
const JOIN_RESEND_SECONDS = 0.5;
const COMMAND_RESEND_SECONDS = 0.25;
/** While nothing changes, the input still goes out this often: it is also the guest's "still here". */
const INPUT_RESEND_SECONDS = 0.05;
/**
 * While walking, and while only the camera bearing changes, the input goes out this often: 30 a second. A lost one
 * then holds the host's walking up by a thirtieth of a second, not a twentieth.
 */
const INPUT_TURN_SECONDS = 1 / 30 - 0.002;
/** A key going down or up is sent at once, and again on this many frames after: on a line that loses one in five, one in 125 is late. */
const KEY_CHANGE_REPEATS = 2;
const PING_SECONDS = 1;
/** Commands after which the host holds the player still or takes them aboard: the guest's own walk stops with the asking. */
const HOLDING_COMMANDS: ReadonlySet<Command['type']> = new Set(['talk', 'sleep', 'board']);
/** The walk waits this long at most for the answer to such a command, and this long after a yes for the state that shows it. */
const HOLD_ANSWER_SECONDS = 3;
const HOLD_SHOWN_SECONDS = 1;
/** No word from the host for this long: ask to join again. */
export const HOST_SILENCE_SECONDS = 3;
/**
 * No word from the host for this long and the guest's screen says so. It is the wait after which the guest's own
 * walking stops (`WALK_AHEAD_STEPS`, a second and a half): the figure stands, and the words say why. States come
 * fifteen a second, so this is over twenty of them missing, not a hiccup.
 */
export const HOST_QUIET_SECONDS = WALK_AHEAD_STEPS / STEPS_PER_SECOND;
/** The view snaps instead of sliding when it is this many steps off (a join, a long stall). */
const SNAP_STEPS = 45;
/** Something that moved further than this between two states was put there, not moved: do not slide it across the lake. */
const SNAP_METRES = 12;
/** The clock jumped (a night slept through, a capsize): show the new time, do not sweep the sun round. */
const SNAP_CLOCK_SECONDS = 5;

interface Held {
  id: number;
  step: number;
  state: GameState;
  /** How many of this guest's own steps the host had walked. */
  walked: number;
}

/** Everything a player holds but the camera bearing, as text: a change here is a key going down or up. */
const keysOf = (input: StepInput): string =>
  `${input.paddle},${input.steer},${input.powerStroke},${input.bail},${input.moveX},${input.moveY},${input.run}${input.jump ? ',jump' : ''}`;

/** The short way round from one bearing to another, taken `share` of the way. */
function turnToward(from: number, to: number, share: number): number {
  return from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * share;
}

/**
 * The state `share` of the way from `from` to `to`: the newer state's facts
 * (who holds what, which quest), with the canoe, the players and the clock
 * placed between the two. Something that jumped is shown where it landed.
 */
export function blendStates(from: GameState, to: GameState, share: number): GameState {
  const mix = (first: number, second: number): number => first + (second - first) * share;
  const close = (first: { x: number; z: number }, second: { x: number; z: number }): boolean =>
    Math.hypot(second.x - first.x, second.z - first.z) <= SNAP_METRES;
  const place = (first: { x: number; y: number; z: number }, second: { x: number; y: number; z: number }) =>
    ({ x: mix(first.x, second.x), y: mix(first.y, second.y), z: mix(first.z, second.z) });

  const canoe = close(from.canoe.position, to.canoe.position) ? {
    ...to.canoe,
    position: place(from.canoe.position, to.canoe.position),
    heading: turnToward(from.canoe.heading, to.canoe.heading, share),
    pitch: mix(from.canoe.pitch, to.canoe.pitch),
    roll: mix(from.canoe.roll, to.canoe.roll),
    speed: mix(from.canoe.speed, to.canoe.speed),
  } : to.canoe;
  const players = to.players.map((player): PlayerState => {
    const before = from.players.find((candidate) => candidate.id === player.id);
    if (!before || before.mode !== player.mode || !close(before.position, player.position)) return player;
    const placed: PlayerState = { ...player, position: place(before.position, player.position), heading: turnToward(before.heading, player.heading, share) };
    // A jump is placed between the two states as well, so a crewmate rises and falls as smoothly as they walk.
    const leap = blendLeap(before.leap, player.leap, share);
    if (leap) placed.leap = leap;
    else delete placed.leap;
    return placed;
  });
  return {
    ...to,
    canoe,
    players,
    time: Math.abs(to.time - from.time) <= SNAP_CLOCK_SECONDS ? mix(from.time, to.time) : to.time,
    playedSeconds: mix(from.playedSeconds, to.playedSeconds),
  };
}

/** This guest's own player as its own walk has it: the place, the facing, the run and the jump. */
function ownFigure(me: PlayerState, shown: WalkShown): PlayerState {
  const figure: PlayerState = { ...me, position: shown.position, heading: shown.heading, running: shown.running, exerting: shown.exerting };
  if (shown.leap) figure.leap = shown.leap;
  else delete figure.leap;
  return figure;
}

export class GuestLink {
  status: GuestStatus = 'joining';
  /** Why the host let this guest go. Null while it has not. */
  leaveReason: LeaveReason | null = null;
  /** The player this guest plays. Only meaningful once `playing`. */
  playerId: PlayerId = 0;
  hostId: PlayerId = 0;
  /** States thrown away because their fingerprint did not match what the host said. Stays 0 on a sound wire. */
  mismatches = 0;
  /** Seconds a ping took to come back, or null before the first. */
  roundTripSeconds: number | null = null;
  /** The last `input.seq` the host said it had. */
  inputAcked = -1;

  private readonly transport: Transport;
  private readonly name: string;
  private readonly key: string;
  private readonly character: CharacterId;
  private readonly carryKeeper: CarryKeeper | null;
  private readonly delaySteps: number;
  private session: number | null = null;
  private sitting: number | null = null;
  private held: Held[] = [];
  /** The step the view shows, in steps of 1/60 s. Runs on, a beat behind the newest state. */
  private displayStep = 0;
  private clock = 0;
  private heardAt = 0;
  private joinSentAt = -Infinity;
  private pingSentAt = 0;
  private inputSeq = 0;
  private inputSentAt = -Infinity;
  private inputSent = '';
  private keysSent = '';
  /** The step count the last input message carried. */
  private stepSent = 0;
  /** Send the next input at once: a command just went, and the host runs it once it knows the walk up to it. */
  private inputDue = false;
  /** Frames left on which the input is sent again whatever it holds: a key just changed. */
  private repeats = 0;
  private frameSeconds = 0;
  private readonly predictWalk: boolean;
  /** This guest's own walking: its numbered steps, and where they put its figure. */
  readonly walk = new WalkPredictor();
  /**
   * A command that will hold the player still was asked: no walking from the
   * step it was asked at, until the host says no, or says yes and shows it.
   */
  private hold: { id: number; at: number; since: number; answered: { clock: number; truthId: number } | null } | null = null;
  /** The view without this guest's own walk, worked out once a frame. */
  private base: GameState | null = null;
  private nextCommandId = 1;
  private pending: { id: number; command: Command; quiet: boolean; sentAt: number; at: number }[] = [];
  private outcomes: CommandOutcome[] = [];
  /** Events numbered below this have arrived. */
  private nextEvent = 0;
  private events: { step: number; event: GameEvent }[] = [];
  /** Ask for a whole state: a set of changes did not add up. */
  private needWhole = false;

  constructor(transport: Transport, options: GuestOptions) {
    this.transport = transport;
    this.name = options.name;
    this.key = options.key;
    this.character = options.character ?? CHARACTER_IDS[0];
    this.carryKeeper = options.carry ?? null;
    this.delaySteps = options.delaySteps ?? 6;
    this.predictWalk = options.predictWalk ?? true;
    transport.receive((raw) => this.onMessage(raw), () => this.end('closed', 'closed'));
    this.sendJoin();
  }

  private send(message: ClientMessage): void {
    if (this.status !== 'closed' && this.status !== 'refused') this.transport.send(message);
  }

  private sendJoin(): void {
    this.joinSentAt = this.clock;
    // The guest's own things, as kept, on the way in. Asking again once this host has seated it (a knock, a line
    // back): none, since the host's seat is newer than anything this guest holds, and sending ours would undo its last steps.
    const carry = this.truth ? null : this.carryKeeper?.read() ?? null;
    this.send({ v: PROTOCOL_VERSION, type: 'join', name: this.name, key: this.key, character: this.character, ...(carry ? { carry } : {}) });
  }

  private end(status: 'closed' | 'refused', reason: LeaveReason): void {
    if (this.status === 'closed' || this.status === 'refused') return;
    this.status = status;
    this.leaveReason = reason;
    // Another tab took this seat: that tab keeps the carry from here on.
    if (reason !== 'replaced') this.carryKeeper?.flush();
    this.transport.close();
  }

  /** The newest state the host sent, exactly. Null before the welcome. */
  get truth(): GameState | null {
    return this.held.at(-1)?.state ?? null;
  }

  /** The step of `truth`, or -1. */
  get truthStep(): number {
    return this.held.at(-1)?.step ?? -1;
  }

  /** The snapshot number this guest holds, as it tells the host. -1: send the whole state. */
  private get have(): number {
    return this.needWhole ? -1 : this.held.at(-1)?.id ?? -1;
  }

  /** True while the host is talking: false when it has gone quiet and this guest is asking to join again. */
  get hostHeard(): boolean {
    return this.clock - this.heardAt <= HOST_SILENCE_SECONDS;
  }

  /** True while a seated guest has had no word from the host for `HOST_QUIET_SECONDS`: the line has stalled, open or not. */
  get hostQuiet(): boolean {
    return this.status === 'playing' && this.clock - this.heardAt > HOST_QUIET_SECONDS;
  }

  private onMessage(raw: unknown): void {
    if (this.status === 'closed' || this.status === 'refused') return;
    const message = readHostMessage(raw);
    if (!message) return;
    this.heardAt = this.clock;
    switch (message.type) {
      case 'welcome': {
        if (message.session !== this.session) {
          // A new game on the host: nothing held from before means anything.
          this.session = message.session;
          this.held = [];
          this.events = [];
          this.nextEvent = message.events;
          this.sitting = null;
          this.displayStep = message.step;
        }
        if (message.sitting !== this.sitting) {
          // A new sitting: commands count from 1 again. What was asked before the gap is not asked again.
          this.sitting = message.sitting;
          this.pending = [];
          this.nextCommandId = 1;
          // And steps count from 0 again.
          this.walk.reset();
          this.hold = null;
          this.stepSent = 0;
        }
        this.playerId = message.playerId;
        this.hostId = message.hostId;
        this.nextEvent = Math.max(this.nextEvent, message.events);
        if (message.id > (this.held.at(-1)?.id ?? -1)) {
          this.keep({ id: message.id, step: message.step, state: message.state, walked: message.walked }, message.hash);
        }
        this.status = 'playing';
        break;
      }
      case 'state': {
        if (this.status !== 'playing') return;
        this.inputAcked = Math.max(this.inputAcked, message.ack);
        // Late, or twice: the truth only moves forward.
        if (message.id <= (this.held.at(-1)?.id ?? -1)) return;
        let state: GameState;
        if (message.base === null) {
          state = message.changed as GameState;
        } else {
          const base = this.held.find((entry) => entry.id === message.base);
          // Changes against a state this guest no longer holds: the host will hear what it does hold and send those.
          if (!base) return;
          state = { ...base.state, ...message.changed };
        }
        this.keep({ id: message.id, step: message.step, state, walked: message.walked }, message.hash);
        break;
      }
      case 'events': {
        // A gap means an earlier lot is still on its way, or lost: the host sends from where this guest is.
        if (message.first > this.nextEvent) return;
        const fresh = message.events.slice(this.nextEvent - message.first);
        for (const event of fresh) this.events.push({ step: message.step, event });
        this.nextEvent += fresh.length;
        break;
      }
      case 'result': {
        const index = this.pending.findIndex((entry) => entry.id === message.id);
        if (index < 0) return;
        const [entry] = this.pending.splice(index, 1);
        this.outcomes.push({ id: entry!.id, command: entry!.command, result: message.result, quiet: entry!.quiet });
        if (this.hold?.id === entry!.id) {
          // No: walk on. Yes: stand until a newer state shows what it did.
          this.hold = message.result.ok
            ? { ...this.hold, answered: { clock: this.clock, truthId: this.held.at(-1)?.id ?? -1 } } : null;
        }
        break;
      }
      case 'ping':
        this.roundTripSeconds = Math.max(0, this.clock - message.time);
        break;
      case 'leave':
        this.end(this.status === 'joining' && (message.reason === 'full' || message.reason === 'version') ? 'refused' : 'closed', message.reason);
        break;
    }
  }

  /** Keep a state as the truth, if it is the state the host says it is. */
  private keep(entry: Held, hash: string): void {
    if (hashState(entry.state) !== hash) {
      this.mismatches += 1;
      this.needWhole = true;
      return;
    }
    this.needWhole = false;
    this.held.push(entry);
    if (this.held.length > HISTORY) this.held.shift();
    this.base = null;
    // Only what the host confirmed is kept as this guest's own things.
    const me = this.carryKeeper ? entry.state.players.find((player) => player.id === this.playerId) : undefined;
    if (me) this.carryKeeper!.note(carryOf(me, this.session ?? undefined), this.clock);
  }

  /** True while this guest's walk must stand: a command that holds the player was asked and is not settled. */
  private get walkHeld(): boolean {
    const hold = this.hold;
    if (!hold) return false;
    const newest = this.held.at(-1);
    const settled = hold.answered === null
      ? this.clock - hold.since > HOLD_ANSWER_SECONDS || !this.pending.some((entry) => entry.id === hold.id)
      : this.clock - hold.answered.clock > HOLD_SHOWN_SECONDS
        || (newest !== undefined && newest.id > hold.answered.truthId && newest.walked >= hold.at);
    if (settled) this.hold = null;
    return !settled;
  }

  /**
   * Ask to join again, now. Harmless while still seated; the way back in at
   * once for a guest whose screen was hidden long enough to be marked away.
   */
  knock(): void {
    if (this.status === 'playing') this.sendJoin();
  }

  /** Once a frame: run the clock, send again what was not answered, keep the host knowing this guest is here. */
  update(frameSeconds: number): void {
    if (this.status === 'closed' || this.status === 'refused') return;
    this.clock += frameSeconds;
    this.frameSeconds = frameSeconds;
    this.base = null;
    if (this.status === 'joining' || !this.hostHeard) {
      if (this.clock - this.joinSentAt >= JOIN_RESEND_SECONDS) this.sendJoin();
    }
    if (this.status !== 'playing') return;

    for (const entry of this.pending) {
      if (this.clock - entry.sentAt < COMMAND_RESEND_SECONDS) continue;
      entry.sentAt = this.clock;
      this.send({ v: PROTOCOL_VERSION, type: 'command', id: entry.id, command: entry.command, at: entry.at });
    }
    if (this.clock - this.pingSentAt >= PING_SECONDS) {
      this.pingSentAt = this.clock;
      this.send({ v: PROTOCOL_VERSION, type: 'ping', time: this.clock, have: this.have, events: this.nextEvent });
    }

    // The view runs on at one step a step, a beat behind the newest state, and eases out any drift.
    const newest = this.truthStep;
    const target = newest - this.delaySteps;
    this.displayStep += frameSeconds * STEPS_PER_SECOND;
    const off = target - this.displayStep;
    if (Math.abs(off) > SNAP_STEPS) this.displayStep = target;
    else this.displayStep += off * Math.min(1, frameSeconds * 1.5);
    this.displayStep = Math.min(this.displayStep, newest);
  }

  /**
   * What this guest's player holds this frame. Call once a frame, after
   * `update`. Takes the frame's steps of this guest's own walk (so `view()`
   * shows them at once), and sends the input: at once when a key changes (and
   * on the two frames after), 30 times a second while walking or while the
   * camera turns or the figure is in the air, and 20 times a second while nothing does.
   */
  sendInput(input: StepInput): void {
    if (this.status !== 'playing') return;
    const truth = this.held.at(-1);
    if (truth) this.walk.advance(this.frameSeconds, input, !this.walkHeld, truth.state, this.playerId, truth.walked);
    this.frameSeconds = 0;

    const text = JSON.stringify(input);
    const keys = keysOf(input);
    const since = this.clock - this.inputSentAt;
    // In the air counts as walking: the host is walking this guest through the jump, and should not have to wait for it.
    const walking = Math.hypot(input.moveX, input.moveY) > 0.01 || airborne(this.walk.shown?.leap);
    const changed = walking || text !== this.inputSent || this.walk.changedSince(this.stepSent);
    const keyChanged = keys !== this.keysSent;
    const repeat = this.repeats > 0;
    if (repeat) this.repeats -= 1;
    if (keyChanged) this.repeats = KEY_CHANGE_REPEATS;
    const send = this.inputDue || keyChanged || repeat || (changed && since >= INPUT_TURN_SECONDS) || since >= INPUT_RESEND_SECONDS;
    if (!send) return;
    this.inputDue = false;
    this.inputSent = text;
    this.keysSent = keys;
    this.inputSentAt = this.clock;
    this.stepSent = this.walk.step;
    this.inputSeq += 1;
    this.send({
      v: PROTOCOL_VERSION, type: 'input', seq: this.inputSeq, have: this.have, events: this.nextEvent, input,
      step: this.walk.step, walk: this.walk.wireRuns(),
    });
  }

  /** Ask the host to run a command for this guest's player. The answer comes through `takeResults`. Returns its number. */
  sendCommand(command: Command, quiet = false): number {
    const id = this.nextCommandId;
    this.nextCommandId += 1;
    if (this.status !== 'playing') return id;
    const at = this.walk.step;
    this.pending.push({ id, command, quiet, sentAt: this.clock, at });
    if (HOLDING_COMMANDS.has(command.type) && !this.hold) this.hold = { id, at, since: this.clock, answered: null };
    this.inputDue = true;
    this.send({ v: PROTOCOL_VERSION, type: 'command', id, command, at });
    return id;
  }

  /** Commands sent and not yet answered. */
  get commandsWaiting(): number {
    return this.pending.length;
  }

  /** The answers that came since the last call, oldest first. */
  takeResults(): CommandOutcome[] {
    const outcomes = this.outcomes;
    this.outcomes = [];
    return outcomes;
  }

  /**
   * The state to draw this frame, or null before the welcome: the view a beat
   * behind, with this guest's own player on foot drawn where its own walk has
   * it. While that player is aboard (or `predictWalk` is off) it is the view
   * as it is: the same object as `truth` when the view has caught up with it.
   */
  view(): GameState | null {
    const base = this.base ??= this.behind();
    const shown = this.walk.shown;
    if (!base || !shown || !this.predictWalk) return base;
    const me = base.players.find((player) => player.id === this.playerId);
    // Drawn aboard until the view itself shows the landing, and on the spot it left until the view shows the boarding.
    if (!me || me.mode !== 'foot') return base;
    return {
      ...base,
      players: base.players.map((player) => (player === me
        ? ownFigure(me, shown) : player)),
    };
  }

  /** The view a beat behind the truth, everything in it placed between the two states it sits between. */
  private behind(): GameState | null {
    const newest = this.held.at(-1);
    if (!newest) return null;
    if (this.displayStep >= newest.step) return newest.state;
    for (let index = this.held.length - 1; index > 0; index -= 1) {
      const from = this.held[index - 1]!;
      const to = this.held[index]!;
      if (this.displayStep < from.step) continue;
      if (to.step === from.step) return to.state;
      return blendStates(from.state, to.state, (this.displayStep - from.step) / (to.step - from.step));
    }
    return this.held[0]!.state;
  }

  /**
   * The events to show this frame, in the host's order: those the view has
   * reached, so a splash is not heard before the canoe gets there.
   */
  takeEvents(): GameEvent[] {
    const reached = this.displayStep + 1;
    let count = 0;
    while (count < this.events.length && this.events[count]!.step <= reached) count += 1;
    return this.events.splice(0, count).map((entry) => entry.event);
  }

  /** Leave the game: tell the host and close the wire. */
  close(): void {
    if (this.status === 'closed' || this.status === 'refused') return;
    this.send({ v: PROTOCOL_VERSION, type: 'leave' });
    this.carryKeeper?.flush();
    this.status = 'closed';
    this.transport.close();
  }
}
