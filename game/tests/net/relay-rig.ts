/**
 * The relay in memory, for tests: the relay's own room logic
 * (`relay/src/room.ts`, the code the Worker runs) behind stand-in sockets
 * that can be slow, lose frames, be cut, or refuse to connect. Time is the
 * test's (vitest's fake timers), so every run is the same.
 */
import { vi } from 'vitest';
import { RoomLogic } from '../../../relay/src/room.ts';
import type { Wire } from '../../../relay/src/room.ts';
import { GuestLink, HostLink } from '../../src/net/index.ts';
import type { CommandOutcome, HostOptions } from '../../src/net/index.ts';
import { RelayGuestWire, RelayHostRoom } from '../../src/net/relay.ts';
import type { OpenSocket, SocketLike } from '../../src/net/relay.ts';
import { FIXED_STEP, NEUTRAL_INPUT, drainEvents, hashState, step } from '../../src/sim/index.ts';
import type { GameEvent, GameState, StepInput } from '../../src/sim/index.ts';
import { calmGame, key } from './rig.ts';

export interface LineConditions {
  /** Seconds each frame takes, each way. */
  delay: number;
  /** Share of the game's frames that never arrive, each way. The relay's own words always do, as on a real socket. */
  loss: number;
}

export interface FakeSocket extends SocketLike {
  role: string;
  code: string;
  /** True until either end closes it or it is cut. */
  alive: boolean;
  /** True once the line under it went dead: what was on its way is lost. */
  cut: boolean;
  /** What the page was told when it closed. */
  closedWith: { code: number; reason: string } | null;
}

/** A small seeded generator, so a lossy line loses the same frames every run. */
function seededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export class FakeRelay {
  /** False: nothing answers. Every dial fails, as when the relay is down or the cable is out. */
  up = true;
  readonly conditions: LineConditions;
  readonly rooms = new Map<string, RoomLogic>();
  readonly sockets: FakeSocket[] = [];
  /** Frames that reached the relay, by who sent them, and frames the line lost. */
  readonly frames = { host: 0, guest: 0, lost: 0 };
  /** Every address dialled and the protocols offered, in order. */
  readonly dials: { address: string; protocols: string[] }[] = [];
  private readonly wires = new Map<FakeSocket, Wire>();
  private readonly random: () => number;

  constructor(conditions: Partial<LineConditions> = {}, seed = 7) {
    this.conditions = { delay: 0.005, loss: 0, ...conditions };
    this.random = seededRandom(seed);
  }

  private later(run: () => void): void {
    setTimeout(run, this.conditions.delay * 1000);
  }

  private lose(frame: string): boolean {
    if (!frame.startsWith('[') || this.random() >= this.conditions.loss) return false;
    this.frames.lost += 1;
    return true;
  }

  readonly open: OpenSocket = (address, protocols) => {
    this.dials.push({ address, protocols });
    const url = new URL(address);
    const code = url.pathname.split('/').pop() ?? '';
    const role = url.searchParams.get('role') ?? '';
    const socket: FakeSocket = {
      role, code, alive: true, cut: false, closedWith: null,
      onopen: null, onmessage: null, onclose: null, onerror: null,
      send: (text) => {
        if (!socket.alive) return;
        this.frames[role === 'host' ? 'host' : 'guest'] += 1;
        if (this.lose(text)) return;
        // What was sent before a close still arrives, as on a real socket. Only a cut line loses it.
        this.later(() => {
          if (!socket.cut) this.rooms.get(code)?.message(wire, text, Date.now());
        });
      },
      close: () => {
        if (!socket.alive) return;
        socket.alive = false;
        this.later(() => this.rooms.get(code)?.disconnect(wire));
      },
    };
    const wire: Wire = {
      send: (text) => {
        if (!socket.alive || this.lose(text)) return;
        this.later(() => {
          if (socket.alive) socket.onmessage?.({ data: text });
        });
      },
      close: (closeCode, reason) => {
        if (!socket.alive) return;
        // The frames already on their way still arrive: only then is the socket dead.
        this.later(() => {
          if (!socket.alive) return;
          socket.alive = false;
          socket.closedWith = { code: closeCode, reason };
          socket.onclose?.({ code: closeCode, reason });
        });
      },
    };
    this.sockets.push(socket);
    this.wires.set(socket, wire);
    this.later(() => {
      if (!socket.alive) return;
      if (!this.up) {
        socket.alive = false;
        socket.onerror?.();
        socket.onclose?.({ code: 1006, reason: '' });
        return;
      }
      let room = this.rooms.get(code);
      if (!room) this.rooms.set(code, room = new RoomLogic());
      const key = protocols.find((entry) => entry.startsWith('k.'))?.slice(2) ?? null;
      room.connect(wire, role, key, Date.now());
      socket.onopen?.();
    });
    return socket;
  };

  /** The line under a socket goes dead: both ends find out at once. */
  cut(socket: FakeSocket): void {
    if (!socket.alive) return;
    socket.alive = false;
    socket.cut = true;
    this.rooms.get(socket.code)?.disconnect(this.wires.get(socket)!);
    socket.onclose?.({ code: 1006, reason: '' });
  }

  /** The live sockets of one role. */
  live(role: 'host' | 'guest'): FakeSocket[] {
    return this.sockets.filter((socket) => socket.alive && socket.role === role);
  }
}

export interface RelaySeat {
  wire: RelayGuestWire;
  link: GuestLink;
  input: Partial<StepInput>;
  events: GameEvent[];
  results: CommandOutcome[];
  /** Times the wire said the way to the host was whole again. */
  backs: number;
}

export interface RelayRig {
  relay: FakeRelay;
  game: GameState;
  host: HostLink;
  room: RelayHostRoom;
  seats: RelaySeat[];
  hostInput: Partial<StepInput>;
  hostEvents: GameEvent[];
  join(name: string, secret?: string): RelaySeat;
  /** Run this many seconds of frames, a sixtieth at a time. */
  run(seconds: number): Promise<void>;
  /** Stop stepping (still sending) until every guest still playing holds the host's state exactly. */
  settle(seconds?: number): Promise<boolean>;
  hostHash(): string;
}

export const CODE = 'FHJK3M';
export const ADDRESS = 'ws://relay.test';
export const HOST_KEY = 'host-key-0123456789';

/** A host sharing a calm game through the relay. Call inside `vi.useFakeTimers()`. */
export function createRelayRig(options: { conditions?: Partial<LineConditions>; game?: GameState; host?: Partial<HostOptions>; relay?: FakeRelay } = {}): RelayRig {
  const relay = options.relay ?? new FakeRelay(options.conditions);
  const game = options.game ?? calmGame();
  const host = new HostLink({ game, hostPlayerId: 0, session: 42, ...options.host });
  const room = new RelayHostRoom({ address: ADDRESS, code: CODE, key: HOST_KEY, open: relay.open });
  room.setAccept((transport) => host.accept(transport));
  const rig: RelayRig = {
    relay, game, host, room,
    seats: [],
    hostInput: {},
    hostEvents: [],
    join(name, secret = key(name)): RelaySeat {
      const wire = new RelayGuestWire({ address: ADDRESS, code: CODE, open: relay.open });
      const seat: RelaySeat = { wire, link: new GuestLink(wire, { name, key: secret }), input: {}, events: [], results: [], backs: 0 };
      wire.onBack = (): void => {
        seat.backs += 1;
        seat.link.knock();
      };
      rig.seats.push(seat);
      return seat;
    },
    hostHash: () => hashState({ ...game, events: [] }),
    async run(seconds): Promise<void> {
      for (let frame = 0; frame < Math.round(seconds / FIXED_STEP); frame += 1) await frameOnce(true);
    },
    async settle(seconds = 10): Promise<boolean> {
      const met = (): boolean => rig.seats.every((seat) => seat.link.status !== 'playing'
        || (seat.link.truth !== null && hashState(seat.link.truth) === rig.hostHash() && seat.link.commandsWaiting === 0));
      for (let frame = 0; frame < Math.round(seconds / FIXED_STEP); frame += 1) {
        await frameOnce(false);
        if (met()) return true;
      }
      return false;
    },
  };

  async function frameOnce(stepping: boolean): Promise<void> {
    // The sockets' timers, then the microtask in which the host's frame leaves.
    await vi.advanceTimersByTimeAsync(FIXED_STEP * 1000);
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
    await Promise.resolve();
  }
  return rig;
}
