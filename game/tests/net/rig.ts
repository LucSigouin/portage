/** A host and its guests on loopback wires, stepped a frame at a time. No network, no clock but the test's. */
import { GuestLink, HostLink, createLoopbackPair } from '../../src/net/index.ts';
import type { CommandOutcome, GuestOptions, HostOptions, LoopbackConditions, LoopbackPair } from '../../src/net/index.ts';
import { FIXED_STEP, NEUTRAL_INPUT, drainEvents, hashState, step } from '../../src/sim/index.ts';
import type { GameEvent, GameState, StepInput } from '../../src/sim/index.ts';
import { floatCanoeAt, newGame } from '../support.ts';

export interface Seat {
  pair: LoopbackPair;
  link: GuestLink;
  /** What this guest holds, sent every frame. */
  input: Partial<StepInput>;
  /** Every event the guest's screen was handed, in order. */
  events: GameEvent[];
  results: CommandOutcome[];
}

export interface Rig {
  game: GameState;
  host: HostLink;
  seats: Seat[];
  /** What the host itself holds. */
  hostInput: Partial<StepInput>;
  /** Every event the host drained, in order. */
  hostEvents: GameEvent[];
  /** Seat a guest. Give the same key to get the same player back. */
  join(name: string, key?: string, conditions?: Partial<LoopbackConditions>, guest?: Partial<GuestOptions>): Seat;
  /** Run this many seconds of frames: wires, then the host's step, then each guest. */
  run(seconds: number): void;
  /** Run this many seconds of frames with the host's game standing still: it steps nothing, and still sends and listens. */
  stand(seconds: number): void;
  /**
   * Let the messages settle: the host stops stepping (it still sends) until every
   * guest still playing holds the host's state exactly, fingerprint for fingerprint.
   * Returns false if they have not met after `seconds`.
   */
  settle(seconds?: number): boolean;
  /** The host's fingerprint right now. */
  hostHash(): string;
}

export const key = (name: string): string => `key-${name}-0123456789`;

/** A tight dry hull on calm water south of Home Knoll, under a sky that holds. */
export function calmGame(crew = 1): GameState {
  const game = newGame(7, { crew });
  game.canoe.hullTier = 1;
  floatCanoeAt(game, 200, 1300, 0);
  for (const player of game.players) player.position = { ...game.canoe.position };
  game.weather.secondsRemaining = 99999;
  drainEvents(game);
  return game;
}

export function createRig(options: { game?: GameState; conditions?: Partial<LoopbackConditions>; host?: Partial<HostOptions> } = {}): Rig {
  const game = options.game ?? calmGame();
  const host = new HostLink({ game, hostPlayerId: 0, session: 42, ...options.host });
  const rig: Rig = {
    game,
    host,
    seats: [],
    hostInput: {},
    hostEvents: [],
    join(name, secret = key(name), conditions = options.conditions ?? {}, guest = {}): Seat {
      const pair = createLoopbackPair(conditions, rig.seats.length + 11);
      host.accept(pair.host);
      const seat: Seat = { pair, link: new GuestLink(pair.guest, { name, key: secret, ...guest }), input: {}, events: [], results: [] };
      rig.seats.push(seat);
      return seat;
    },
    hostHash: () => hashState({ ...game, events: [] }),
    run(seconds: number): void {
      for (let frame = 0; frame < Math.round(seconds / FIXED_STEP); frame += 1) frameOnce(true);
    },
    stand(seconds: number): void {
      for (let frame = 0; frame < Math.round(seconds / FIXED_STEP); frame += 1) frameOnce(false);
    },
    settle(seconds = 10): boolean {
      const met = (): boolean => rig.seats.every((seat) => seat.link.status !== 'playing'
        || (seat.link.truth !== null && hashState(seat.link.truth) === rig.hostHash() && seat.link.commandsWaiting === 0));
      for (let frame = 0; frame < Math.round(seconds / FIXED_STEP); frame += 1) {
        frameOnce(false);
        if (met()) return true;
      }
      return false;
    },
  };

  function frameOnce(stepping: boolean): void {
    for (const seat of rig.seats) seat.pair.advance(FIXED_STEP);
    if (stepping) step(game, host.crewInput({ ...NEUTRAL_INPUT, ...rig.hostInput }, 0), FIXED_STEP);
    const events = drainEvents(game);
    rig.hostEvents.push(...events);
    host.afterFrame(events, FIXED_STEP);
    for (const seat of rig.seats) {
      seat.link.update(FIXED_STEP);
      seat.link.sendInput({ ...NEUTRAL_INPUT, ...seat.input });
      seat.events.push(...seat.link.takeEvents());
      seat.results.push(...seat.link.takeResults());
    }
  }
  return rig;
}
