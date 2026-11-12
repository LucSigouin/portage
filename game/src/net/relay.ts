/**
 * The wire through the relay: a WebSocket to a small server on the internet
 * that passes frames between one host and its guests (`relay/` at the top of
 * the repository). This is the door friends on other computers come through.
 *
 * - `RelayHostRoom`: the host's one socket. It hands the host's link a
 *   `Transport` for each guest, as the channel between tabs does.
 * - `RelayGuestWire`: a guest's socket, as a `Transport` to the host.
 *
 * Both come back by themselves when the line drops: the socket is dialled
 * again, the guest asks to join again with the same key, and gets the same
 * player. The game's messages cope with what was lost in between.
 *
 * Frames (JSON text). The relay stamps who a guest's frame is from; nothing a
 * guest sends can change that.
 *
 * | From | Frame |
 * |---|---|
 * | guest | `[body, ...]` |
 * | relay to host | `[peer, [body, ...]]` |
 * | host | `[[peer, [body, ...]], ...]`, one socket frame however many guests |
 * | relay to guest | `[body, ...]` |
 * | relay | `{"relay": "hello" | "joined" | "left" | "host" | "bye", ...}` |
 * | host | `{"relay": "drop", "peer": n}`, `{"relay": "bye"}` |
 *
 * No DOM in here: the socket is handed in, so tests run it on a stand-in.
 */
import type { Transport } from './transport.ts';

/** The part of `WebSocket` this uses. */
export interface SocketLike {
  send(text: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: (() => void) | null;
}

export type OpenSocket = (address: string, protocols: string[]) => SocketLike;

/** The same words as `relay/src/room.ts`. A test holds the two together. */
export const RELAY_PROTOCOL = 'portage-relay.1';
export const ROOM_CODE_ALPHABET = 'FHJKLMQRTWXY34679';
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_PATTERN = /^[FHJKLMQRTWXY34679]{6}$/;

/**
 * Why a line is closed for good.
 * - `unreachable`: the relay did not answer.
 * - `no-room`: nobody has opened a room with that code.
 * - `full`: three guests are in the room already.
 * - `taken`: someone else hosts under that code.
 * - `host-left`: the host closed the room, or dropped and did not come back.
 * - `idle`: nothing went through the room for about half an hour.
 * - `refused`: the relay or the host let this socket go.
 */
export type RelayFailure = 'unreachable' | 'no-room' | 'full' | 'taken' | 'host-left' | 'idle' | 'refused';

/**
 * - `connecting`: dialling for the first time.
 * - `open`: in the room.
 * - `reconnecting`: the line dropped after it was open, and is being dialled again.
 * - `closed`: over. `failure` says why, or is null when this end closed it.
 */
export type RelayPhase = 'connecting' | 'open' | 'reconnecting' | 'closed';

const CLOSE_REASONS: Readonly<Record<number, RelayFailure>> = {
  4400: 'refused', 4401: 'refused', 4403: 'full', 4404: 'no-room', 4408: 'idle', 4409: 'taken', 4410: 'host-left', 4413: 'refused', 4429: 'refused',
};
/** Said once, these are the end: dialling again would not help. */
const FINAL: readonly RelayFailure[] = ['host-left', 'idle'];

/** Dials before the first answer. A relay that never answers is given up on in about two seconds. */
export const FIRST_TRIES = 3;
const FIRST_RETRY_SECONDS = 0.6;
/** A dial that has not opened after this long is dropped and tried again. */
const DIAL_SECONDS = 6;
/** A line that was open is dialled again for this long. */
export const RECONNECT_SECONDS = 45;
const RETRY_SECONDS = [0.25, 0.5, 1, 2, 3];
/** A guest waits this long for a host that dropped. */
export const HOST_GRACE_SECONDS = 45;
/** A guest's messages leave at most this often, however fast its screen runs: about 40 frames a second. */
const GUEST_FLUSH_SECONDS = 0.025;
/** Messages a guest keeps while the line is down. The newest are the ones that matter. */
const OUTBOX = 64;

export interface RelayLineOptions {
  /** The relay, as `ws://` or `wss://`, with no slash at the end. */
  address: string;
  code: string;
  open: OpenSocket;
  /** Called whenever `phase`, `failure` or who is in the room changes. */
  onChange?: () => void;
}

/** One socket to the relay, dialled again when it drops. */
abstract class RelayLine {
  phase: RelayPhase = 'connecting';
  failure: RelayFailure | null = null;
  protected readonly options: RelayLineOptions;
  private socket: SocketLike | null = null;
  /** True once the relay has said hello on the socket in hand. */
  private greeted = false;
  private wasOpen = false;
  private tries = 0;
  private downAt = 0;
  private lastRefusal: RelayFailure | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  protected constructor(options: RelayLineOptions) {
    this.options = options;
  }

  protected abstract role(): 'host' | 'guest';
  protected abstract protocols(): string[];
  protected abstract onControl(frame: Record<string, unknown>): void;
  protected abstract onData(frame: unknown[]): void;
  /** The socket is in the room. `again` is true when it had been before and dropped. */
  protected abstract onOpen(again: boolean): void;
  /** The line is closed for good. */
  protected abstract onEnd(): void;

  protected changed(): void {
    this.options.onChange?.();
  }

  /** True when a frame can go out right now. */
  protected get ready(): boolean {
    return this.greeted && this.socket !== null;
  }

  protected write(text: string): void {
    if (!this.ready) return;
    try {
      this.socket!.send(text);
    } catch {
      // The socket died under the frame. Its close follows.
    }
  }

  protected dial(): void {
    this.clearTimer();
    this.greeted = false;
    this.tries += 1;
    let socket: SocketLike;
    try {
      socket = this.options.open(`${this.options.address}/room/${this.options.code}?role=${this.role()}`, this.protocols());
    } catch {
      this.lost(null);
      return;
    }
    this.socket = socket;
    const current = (): boolean => this.socket === socket;
    socket.onmessage = (event): void => {
      if (current() && typeof event.data === 'string') this.onFrame(event.data);
    };
    socket.onclose = (event): void => {
      if (current()) this.lost(CLOSE_REASONS[event.code] ?? null);
    };
    socket.onerror = (): void => {
      if (current()) this.lost(null);
    };
    // A dial that hangs is no better than one that fails.
    this.timer = setTimeout(() => {
      if (current() && !this.greeted) this.lost(null);
    }, DIAL_SECONDS * 1000);
  }

  private onFrame(text: string): void {
    let frame: unknown;
    try {
      frame = JSON.parse(text);
    } catch {
      return;
    }
    if (Array.isArray(frame)) {
      if (this.greeted) this.onData(frame);
      return;
    }
    if (typeof frame !== 'object' || frame === null) return;
    const control = frame as Record<string, unknown>;
    if (control.relay === 'hello') {
      const again = this.wasOpen;
      this.clearTimer();
      this.greeted = true;
      this.wasOpen = true;
      this.tries = 0;
      this.lastRefusal = null;
      this.phase = 'open';
      this.onControl(control);
      this.onOpen(again);
      this.changed();
    } else if (control.relay === 'bye') {
      // The reason comes ahead of the close, which can take seconds to arrive.
      this.lost(CLOSE_REASONS[typeof control.code === 'number' ? control.code : 0] ?? 'refused');
    } else if (this.greeted) {
      this.onControl(control);
    }
  }

  /** The socket in hand is gone. `refusal` is the relay's reason, when it gave one. */
  private lost(refusal: RelayFailure | null): void {
    if (this.phase === 'closed') return;
    this.dropSocket();
    if (refusal !== null) this.lastRefusal = refusal;
    const now = Date.now();
    if (!this.wasOpen) {
      // Never in the room: the relay's word is the answer, and silence is tried a few times.
      if (refusal !== null) this.end(refusal);
      else if (this.tries >= FIRST_TRIES) this.end('unreachable');
      else this.timer = setTimeout(() => this.dial(), FIRST_RETRY_SECONDS * 1000);
      return;
    }
    if (refusal !== null && FINAL.includes(refusal)) {
      this.end(refusal);
      return;
    }
    if (this.phase !== 'reconnecting') {
      this.phase = 'reconnecting';
      this.downAt = now;
      this.tries = 0;
      this.changed();
    }
    // A refusal on the way back (the room looks full of our own old socket, the host is not back yet) is tried again.
    if (now - this.downAt > RECONNECT_SECONDS * 1000) {
      this.end(this.lastRefusal ?? 'unreachable');
      return;
    }
    const wait = RETRY_SECONDS[Math.min(this.tries, RETRY_SECONDS.length - 1)]!;
    this.timer = setTimeout(() => this.dial(), wait * 1000);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private dropSocket(): void {
    this.clearTimer();
    const socket = this.socket;
    this.socket = null;
    this.greeted = false;
    if (!socket) return;
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    try {
      socket.close();
    } catch {
      // Already closed.
    }
  }

  /** Closed for good, by the relay or the line. */
  protected end(failure: RelayFailure): void {
    if (this.phase === 'closed') return;
    this.dropSocket();
    this.phase = 'closed';
    this.failure = failure;
    this.onEnd();
    this.changed();
  }

  /** Closed by this end. Nothing more is sent or delivered, and nobody is told it failed. */
  protected shut(): void {
    if (this.phase === 'closed') return;
    this.dropSocket();
    this.phase = 'closed';
    this.changed();
  }
}

// --- The host's end --------------------------------------------------------------

export interface RelayHostOptions extends RelayLineOptions {
  /** This host's secret for the room: 16 to 64 letters, digits, `_` or `-`. Only the same key gets the room back after a drop. */
  key: string;
}

interface PeerWire {
  transport: Transport;
  deliver(message: unknown): void;
  /** The guest's socket is gone. */
  gone(): void;
}

export class RelayHostRoom extends RelayLine {
  /** Guests' sockets in the room right now: the relay's numbers for them. */
  readonly guests = new Set<number>();
  private readonly key: string;
  private accept: ((transport: Transport) => void) | null = null;
  private readonly wires = new Map<number, PeerWire>();
  private outbox = new Map<number, string[]>();
  private flushQueued = false;

  constructor(options: RelayHostOptions) {
    super(options);
    this.key = options.key;
    this.dial();
  }

  get code(): string {
    return this.options.code;
  }

  protected role(): 'host' {
    return 'host';
  }

  protected protocols(): string[] {
    // The key rides in the handshake's protocol list, not in the address, which servers tend to write down.
    return [RELAY_PROTOCOL, `k.${this.key}`];
  }

  /**
   * Who takes the guests: called with a transport for each guest, the first
   * time it speaks. Null while no game is being shared: guests wait, asking.
   */
  setAccept(accept: ((transport: Transport) => void) | null): void {
    this.accept = accept;
  }

  protected onOpen(): void {}

  protected onControl(frame: Record<string, unknown>): void {
    const peer = typeof frame.peer === 'number' ? frame.peer : -1;
    if (frame.relay === 'hello') {
      // Back after a drop: the relay says who is still here. Whoever is not, left while this end was away.
      const here = new Set(Array.isArray(frame.peers) ? frame.peers.filter((entry): entry is number => typeof entry === 'number') : []);
      this.guests.clear();
      for (const entry of here) this.guests.add(entry);
      for (const [number, wire] of [...this.wires]) {
        if (!here.has(number)) wire.gone();
      }
    } else if (frame.relay === 'joined') {
      this.guests.add(peer);
      this.changed();
    } else if (frame.relay === 'left') {
      this.guests.delete(peer);
      this.wires.get(peer)?.gone();
      this.changed();
    }
  }

  protected onData(frame: unknown[]): void {
    const [peer, bodies] = frame;
    if (typeof peer !== 'number' || !Array.isArray(bodies)) return;
    let wire = this.wires.get(peer);
    if (!wire) {
      if (!this.accept) return;
      wire = this.wireFor(peer);
      this.wires.set(peer, wire);
      this.accept(wire.transport);
    }
    for (const body of bodies) wire.deliver(body);
  }

  private wireFor(peer: number): PeerWire {
    let onMessage: (message: unknown) => void = () => {};
    let onClosed: (() => void) | null = null;
    let open = true;
    const forget = (): void => {
      open = false;
      if (this.wires.get(peer) === wire) this.wires.delete(peer);
    };
    const wire: PeerWire = {
      transport: {
        send: (message) => {
          if (!open) return;
          // Serialised now: the host changes the game straight after.
          const text = JSON.stringify(message);
          const queue = this.outbox.get(peer);
          if (queue) queue.push(text);
          else this.outbox.set(peer, [text]);
          this.queueFlush();
        },
        receive: (message, closed) => {
          onMessage = message;
          onClosed = closed ?? null;
        },
        // The host let this guest go: what it was told goes out first, then the relay drops its socket.
        close: () => {
          if (!open) return;
          forget();
          this.flush();
          this.write(JSON.stringify({ relay: 'drop', peer }));
        },
      },
      deliver: (message) => {
        if (open) onMessage(message);
      },
      gone: () => {
        if (!open) return;
        forget();
        this.outbox.delete(peer);
        onClosed?.();
      },
    };
    return wire;
  }

  private queueFlush(): void {
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => this.flush());
  }

  /** Everything the host said this frame, to every guest, as one socket frame. */
  private flush(): void {
    this.flushQueued = false;
    if (this.outbox.size === 0) return;
    const outbox = this.outbox;
    this.outbox = new Map();
    // While the line is down the frames are let go: the next state says it all again.
    if (!this.ready) return;
    const entries: string[] = [];
    for (const [peer, texts] of outbox) entries.push(`[${peer},[${texts.join(',')}]]`);
    this.write(`[${entries.join(',')}]`);
  }

  protected onEnd(): void {
    for (const wire of [...this.wires.values()]) wire.gone();
    this.guests.clear();
  }

  /** Close the room: every guest still in it is let go by the relay. */
  close(): void {
    this.flush();
    this.write(JSON.stringify({ relay: 'bye' }));
    for (const wire of [...this.wires.values()]) wire.gone();
    this.guests.clear();
    this.shut();
  }
}

// --- A guest's end ----------------------------------------------------------------

export class RelayGuestWire extends RelayLine implements Transport {
  /** False while the host's own socket is down: the guest waits for it. */
  hostHere = false;
  /** Called when the way to the host is whole again after a drop: the moment to ask to join again. */
  onBack: (() => void) | null = null;
  private onMessage: ((message: unknown) => void) | null = null;
  private onClosed: (() => void) | null = null;
  private outbox: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushedAt = -Infinity;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private seated = false;

  constructor(options: RelayLineOptions) {
    super(options);
    this.dial();
  }

  protected role(): 'guest' {
    return 'guest';
  }

  protected protocols(): string[] {
    return [RELAY_PROTOCOL];
  }

  protected onOpen(again: boolean): void {
    this.queueFlush();
    if (again && this.hostHere) this.onBack?.();
  }

  protected onControl(frame: Record<string, unknown>): void {
    if (frame.relay === 'hello') this.hostIs(frame.host === true);
    else if (frame.relay === 'host') {
      this.hostIs(frame.here === true);
      this.changed();
    }
  }

  private hostIs(here: boolean): void {
    const back = here && !this.hostHere && this.seated;
    this.hostHere = here;
    if (this.graceTimer !== null) clearTimeout(this.graceTimer);
    this.graceTimer = null;
    if (!here) {
      this.graceTimer = setTimeout(() => this.end('host-left'), HOST_GRACE_SECONDS * 1000);
    } else {
      this.seated = true;
      this.queueFlush();
      if (back) this.onBack?.();
    }
  }

  protected onData(frame: unknown[]): void {
    for (const body of frame) this.onMessage?.(body);
  }

  send(message: unknown): void {
    if (this.phase === 'closed') return;
    this.outbox.push(JSON.stringify(message));
    if (this.outbox.length > OUTBOX) this.outbox.splice(0, this.outbox.length - OUTBOX);
    this.queueFlush();
  }

  private queueFlush(): void {
    if (this.flushTimer !== null || this.outbox.length === 0) return;
    const wait = Math.max(0, GUEST_FLUSH_SECONDS * 1000 - (Date.now() - this.flushedAt));
    this.flushTimer = setTimeout(() => this.flush(), wait);
  }

  private flush(): void {
    this.flushTimer = null;
    // Kept while the line or the host is away, and sent in one frame when they are back.
    if (!this.ready || !this.hostHere || this.outbox.length === 0) return;
    this.flushedAt = Date.now();
    this.write(`[${this.outbox.join(',')}]`);
    this.outbox = [];
  }

  receive(message: (message: unknown) => void, closed?: () => void): void {
    this.onMessage = message;
    this.onClosed = closed ?? null;
  }

  private stopTimers(): void {
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    if (this.graceTimer !== null) clearTimeout(this.graceTimer);
    this.flushTimer = this.graceTimer = null;
  }

  protected onEnd(): void {
    this.stopTimers();
    this.outbox = [];
    this.onClosed?.();
  }

  close(): void {
    // What was said last (a goodbye to the host) still goes out.
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.flush();
    this.stopTimers();
    this.shut();
  }
}

/** A new room code, from numbers between 0 and 1. */
export function makeRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    code += ROOM_CODE_ALPHABET[Math.min(ROOM_CODE_ALPHABET.length - 1, Math.floor(random() * ROOM_CODE_ALPHABET.length))];
  }
  return code;
}

/** What someone typed or pasted, as a room code: spaces and dashes dropped, capitals. Null when it is not one. */
export function readRoomCode(text: string): string | null {
  const code = text.replace(/[\s-]/g, '').toUpperCase();
  return ROOM_CODE_PATTERN.test(code) ? code : null;
}

/** A room code as it is shown and read aloud: "FHJ-K3M". */
export function showRoomCode(code: string): string {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

/**
 * The relay's address from the one setting. A full `ws://` or `wss://`
 * address is used as it is; a path (`/portage/relay`) is on the page's own
 * host, so the site's security policy needs no change. Null when the setting
 * is empty or not an address: then there is no relay, and no crew menu.
 */
export function resolveRelayAddress(setting: string, pageOrigin: string): string | null {
  const text = setting.trim().replace(/\/+$/, '');
  if (/^wss?:\/\/[^/]+/.test(text)) return text;
  if (text.startsWith('/') && /^https?:\/\//.test(pageOrigin)) return `${pageOrigin.replace(/^http/, 'ws')}${text}`;
  return null;
}
