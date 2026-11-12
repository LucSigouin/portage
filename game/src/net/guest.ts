/**
 * The guest's side of a shared game. It runs no rules that count: it sends
 * what its player holds and what its player asks for, and shows what the host
 * says the game is. No DOM in here.
 *
 * - `truth`: the newest state the host sent, exactly (its fingerprint is checked).
 * - `view()`: the state to draw. A beat behind the truth, with the canoe, the
 *   players and the clock moved smoothly between the two states it sits
 *   between, so fifteen states a second draw as sixty frames.
 * - `sendInput(input)`, `sendCommand(command)`, `takeEvents()`, `takeResults()`:
 *   what a solo session does with the rules engine, done over the wire.
 * - `update(seconds)`: call once a frame. Runs the clock, the resends and the pings.
 */
import { hashState } from '../sim/index.ts';
import type { Command, CommandResult, GameEvent, GameState, PlayerId, PlayerState, StepInput } from '../sim/index.ts';
import { PROTOCOL_VERSION, readHostMessage } from './messages.ts';
import type { ClientMessage, LeaveReason } from './messages.ts';
import type { Transport } from './transport.ts';

export interface GuestOptions {
  /** The name to play under. The host cuts it to 12 letters. */
  name: string;
  /** This guest's secret for the room: 8 to 64 letters, digits, `_` or `-`. The same key gets the same player back. */
  key: string;
  /** How far behind the newest state the view runs, in steps of 1/60 s. Default 6 (a tenth of a second). */
  delaySteps?: number;
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
const PING_SECONDS = 1;
/** No word from the host for this long: ask to join again. */
export const HOST_SILENCE_SECONDS = 3;
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
}

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
    return { ...player, position: place(before.position, player.position), heading: turnToward(before.heading, player.heading, share) };
  });
  return {
    ...to,
    canoe,
    players,
    time: Math.abs(to.time - from.time) <= SNAP_CLOCK_SECONDS ? mix(from.time, to.time) : to.time,
    playedSeconds: mix(from.playedSeconds, to.playedSeconds),
  };
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
  private nextCommandId = 1;
  private pending: { id: number; command: Command; quiet: boolean; sentAt: number }[] = [];
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
    this.delaySteps = options.delaySteps ?? 6;
    transport.receive((raw) => this.onMessage(raw), () => this.end('closed', 'closed'));
    this.sendJoin();
  }

  private send(message: ClientMessage): void {
    if (this.status !== 'closed' && this.status !== 'refused') this.transport.send(message);
  }

  private sendJoin(): void {
    this.joinSentAt = this.clock;
    this.send({ v: PROTOCOL_VERSION, type: 'join', name: this.name, key: this.key });
  }

  private end(status: 'closed' | 'refused', reason: LeaveReason): void {
    if (this.status === 'closed' || this.status === 'refused') return;
    this.status = status;
    this.leaveReason = reason;
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
        }
        this.playerId = message.playerId;
        this.hostId = message.hostId;
        this.nextEvent = Math.max(this.nextEvent, message.events);
        if (message.id > (this.held.at(-1)?.id ?? -1)) this.hold({ id: message.id, step: message.step, state: message.state }, message.hash);
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
        this.hold({ id: message.id, step: message.step, state }, message.hash);
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
  private hold(entry: Held, hash: string): void {
    if (hashState(entry.state) !== hash) {
      this.mismatches += 1;
      this.needWhole = true;
      return;
    }
    this.needWhole = false;
    this.held.push(entry);
    if (this.held.length > HISTORY) this.held.shift();
  }

  /** Once a frame: run the clock, send again what was not answered, keep the host knowing this guest is here. */
  update(frameSeconds: number): void {
    if (this.status === 'closed' || this.status === 'refused') return;
    this.clock += frameSeconds;
    if (this.status === 'joining' || !this.hostHeard) {
      if (this.clock - this.joinSentAt >= JOIN_RESEND_SECONDS) this.sendJoin();
    }
    if (this.status !== 'playing') return;

    for (const entry of this.pending) {
      if (this.clock - entry.sentAt < COMMAND_RESEND_SECONDS) continue;
      entry.sentAt = this.clock;
      this.send({ v: PROTOCOL_VERSION, type: 'command', id: entry.id, command: entry.command });
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

  /** What this guest's player holds this frame. Sent when it changes, and a few times a second while it does not. */
  sendInput(input: StepInput): void {
    if (this.status !== 'playing') return;
    const text = JSON.stringify(input);
    if (text === this.inputSent && this.clock - this.inputSentAt < INPUT_RESEND_SECONDS) return;
    this.inputSent = text;
    this.inputSentAt = this.clock;
    this.inputSeq += 1;
    this.send({ v: PROTOCOL_VERSION, type: 'input', seq: this.inputSeq, have: this.have, events: this.nextEvent, input });
  }

  /** Ask the host to run a command for this guest's player. The answer comes through `takeResults`. Returns its number. */
  sendCommand(command: Command, quiet = false): number {
    const id = this.nextCommandId;
    this.nextCommandId += 1;
    if (this.status !== 'playing') return id;
    this.pending.push({ id, command, quiet, sentAt: this.clock });
    this.send({ v: PROTOCOL_VERSION, type: 'command', id, command });
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
   * The state to draw this frame, or null before the welcome. The same object
   * as `truth` when the view has caught up with it; otherwise a new one each call.
   */
  view(): GameState | null {
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
    this.status = 'closed';
    this.transport.close();
  }
}
