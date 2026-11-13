/**
 * One room of the relay, as plain logic: who is the host, who the guests are,
 * and where each frame goes. No Cloudflare in here, so the same code runs in
 * the Durable Object (`worker.ts`), in this package's tests and in the game's
 * own tests.
 *
 * The relay carries the game's messages and never reads them. What crosses a
 * socket is a frame, always JSON text:
 *
 * | From | Frame | Means |
 * |---|---|---|
 * | guest | `[body, ...]` | Messages for the host. |
 * | relay to host | `[peer, [body, ...]]` | The same, stamped with who sent it. A guest cannot choose that number. |
 * | host | `[[to, [body, ...]], ...]` | Messages for guests. `to` is a guest's number, or `"*"` for all of them. |
 * | relay to guest | `[body, ...]` | The host's messages for this guest. |
 * | host | `{"relay":"bye"}` | The host is closing the room: every guest is let go. |
 * | host | `{"relay":"drop","peer":n}` | The host has let that guest go: its socket is closed. |
 * | relay | `{"relay":"hello", ...}` | To a new socket: its role, its number, who else is here. |
 * | relay to host | `{"relay":"joined","peer":n}`, `{"relay":"left","peer":n}` | A guest's socket came or went. |
 * | relay to guest | `{"relay":"host","here":bool}` | The host's socket came or went. |
 * | relay | `{"relay":"bye","code":n,"reason":"..."}` | The relay is letting this socket go, and why. The close that follows carries the same code. |
 *
 * A room exists while a socket is in it. It keeps nothing once the last one
 * closes, and nothing of the game ever goes to disk: no state, no names, no
 * keys. Names never reach this code at all: they are inside the bodies.
 *
 * One thing must outlive the room's own memory: the idle count (`idle`,
 * `restoreIdle`). Whoever holds the room keeps it and hands it back, because
 * a Durable Object's memory is new every time it wakes.
 */

/** Letters and digits that neither look nor sound alike, read aloud over a call. No vowels: no words by accident. */
export const ROOM_CODE_ALPHABET = 'FHJKLMQRTWXY34679';
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_PATTERN = /^[FHJKLMQRTWXY34679]{6}$/;

/** The subprotocol both ends name. The host adds a second one, `k.<key>`: its key, kept out of the address. */
export const RELAY_PROTOCOL = 'portage-relay.1';
export const HOST_KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/** A canoe seats four: the host and three guests. */
export const MAXIMUM_GUESTS = 3;

export const LIMITS = {
  /** Characters in one frame from a guest. Its biggest message is a few hundred. */
  guestFrameCharacters: 16 * 1024,
  /** Characters in one frame from the host: three whole states and room to grow. */
  hostFrameCharacters: 256 * 1024,
  /** Frames a second, sustained. The game sends about 20 from a guest and 15 to 60 from the host. */
  guestFramesPerSecond: 60,
  hostFramesPerSecond: 240,
  /** A socket may run this many seconds ahead of its rate before it is closed. */
  burstSeconds: 2,
  /** Looks in a row with nothing through the room before it is closed. */
  quietSweeps: 3,
} as const;

/** Why the relay closes a socket. The game turns each into words. */
export const CLOSE = {
  badRequest: 4400,
  /** The host let this guest go. */
  dropped: 4401,
  /** Three guests already. */
  full: 4403,
  /** Nobody has opened a room with that code. */
  noRoom: 4404,
  /** Nothing went through the room for about half an hour. */
  idle: 4408,
  /** The room has a host, or the key is not the one that opened it. */
  taken: 4409,
  /** The host closed the room. */
  hostLeft: 4410,
  tooBig: 4413,
  tooFast: 4429,
} as const;

/** One end of a socket, as the room sees it. */
export interface Wire {
  send(text: string): void;
  close(code: number, reason: string): void;
}

/**
 * What the room knows about one socket. Small and plain, so the Durable
 * Object can pin it to the socket and get the room back after it has slept.
 */
export interface SeatRecord {
  role: 'host' | 'guest';
  /** 0 for the host, 1 and up for guests. */
  peer: number;
  /** The key that opened the room. Never sent to anyone. */
  hostKey: string;
}

interface Seat extends SeatRecord {
  wire: Wire;
  tokens: number;
  refilledAt: number;
}

/** How the idle cap stands. Two small values, and all a room ever asks to have kept for it. */
export interface IdleCount {
  /** Looks in a row that found nothing had gone through the room. */
  quietSweeps: number;
  /** True once a frame has gone through since the last look. */
  sawFrame: boolean;
}

export interface RoomStats {
  /** Frames passed on, and frames thrown away (not JSON, wrong shape, nobody to give them to). */
  relayed: number;
  dropped: number;
}

const control = (relay: string, more: Record<string, unknown> = {}): string => JSON.stringify({ relay, ...more });

export class RoomLogic {
  readonly stats: RoomStats = { relayed: 0, dropped: 0 };
  private readonly seats = new Map<Wire, Seat>();
  private hostKey: string | null = null;
  private nextPeer = 1;
  private sawFrame = false;
  private quietSweeps = 0;

  get empty(): boolean {
    return this.seats.size === 0;
  }

  /** Sockets in the room right now. */
  get size(): number {
    return this.seats.size;
  }

  private get host(): Seat | null {
    for (const seat of this.seats.values()) if (seat.role === 'host') return seat;
    return null;
  }

  private get guests(): Seat[] {
    return [...this.seats.values()].filter((seat) => seat.role === 'guest');
  }

  private seat(wire: Wire, record: SeatRecord, now: number): Seat {
    const rate = record.role === 'host' ? LIMITS.hostFramesPerSecond : LIMITS.guestFramesPerSecond;
    const seat: Seat = { ...record, wire, tokens: rate * LIMITS.burstSeconds, refilledAt: now };
    this.seats.set(wire, seat);
    this.nextPeer = Math.max(this.nextPeer, record.peer + 1);
    return seat;
  }

  /** The idle count as it stands, for whoever holds the room to keep through its sleep. */
  get idle(): IdleCount {
    return { quietSweeps: this.quietSweeps, sawFrame: this.sawFrame };
  }

  /**
   * Put the idle count back after the room slept. Without it every waking
   * starts the count at nothing, and a silent room is never closed.
   */
  restoreIdle(count: IdleCount): void {
    this.quietSweeps = Math.max(0, Math.floor(Number(count.quietSweeps) || 0));
    this.sawFrame = count.sawFrame === true;
  }

  /** Put back a socket the room held before it slept. */
  restore(wire: Wire, record: SeatRecord, now: number): void {
    this.hostKey = record.hostKey;
    this.seat(wire, record, now);
  }

  /**
   * A new socket asks for a place. Returns what to remember about it, or null
   * when it was turned away (it has been closed, with the reason).
   */
  connect(wire: Wire, role: string | null, key: string | null, now: number): SeatRecord | null {
    if (role === 'host') {
      if (key === null || !HOST_KEY_PATTERN.test(key)) return this.refuse(wire, CLOSE.badRequest, 'bad-key');
      // One host a room. Guests waiting for theirs to come back are not handed to a stranger.
      if (this.host !== null || (this.hostKey !== null && this.hostKey !== key)) return this.refuse(wire, CLOSE.taken, 'taken');
      this.hostKey = key;
      const record: SeatRecord = { role: 'host', peer: 0, hostKey: key };
      this.seat(wire, record, now);
      wire.send(control('hello', { role: 'host', peers: this.guests.map((guest) => guest.peer) }));
      for (const guest of this.guests) guest.wire.send(control('host', { here: true }));
      return record;
    }
    if (role === 'guest') {
      if (this.hostKey === null) return this.refuse(wire, CLOSE.noRoom, 'no-room');
      if (this.guests.length >= MAXIMUM_GUESTS) return this.refuse(wire, CLOSE.full, 'full');
      const record: SeatRecord = { role: 'guest', peer: this.nextPeer, hostKey: this.hostKey };
      this.seat(wire, record, now);
      wire.send(control('hello', { role: 'guest', peer: record.peer, host: this.host !== null }));
      this.host?.wire.send(control('joined', { peer: record.peer }));
      return record;
    }
    return this.refuse(wire, CLOSE.badRequest, 'bad-role');
  }

  /**
   * Let a socket go. The reason goes ahead of the close as a frame: a close
   * can take seconds to reach a page, and a frame is there at once.
   */
  private letGo(wire: Wire, code: number, reason: string): void {
    wire.send(control('bye', { code, reason }));
    wire.close(code, reason);
  }

  private refuse(wire: Wire, code: number, reason: string): null {
    this.letGo(wire, code, reason);
    return null;
  }

  /** A frame arrived on a socket. */
  message(wire: Wire, text: string, now: number): void {
    const seat = this.seats.get(wire);
    if (!seat) return;
    const isHost = seat.role === 'host';
    if (text.length > (isHost ? LIMITS.hostFrameCharacters : LIMITS.guestFrameCharacters)) {
      this.drop(seat, CLOSE.tooBig, 'too-big');
      return;
    }
    const rate = isHost ? LIMITS.hostFramesPerSecond : LIMITS.guestFramesPerSecond;
    seat.tokens = Math.min(rate * LIMITS.burstSeconds, seat.tokens + Math.max(0, now - seat.refilledAt) / 1000 * rate);
    seat.refilledAt = now;
    if (seat.tokens < 1) {
      this.drop(seat, CLOSE.tooFast, 'too-fast');
      return;
    }
    seat.tokens -= 1;
    this.sawFrame = true;

    let frame: unknown;
    try {
      frame = JSON.parse(text);
    } catch {
      this.stats.dropped += 1;
      return;
    }
    if (isHost) this.fromHost(frame);
    else this.fromGuest(seat, frame);
  }

  private fromGuest(seat: Seat, frame: unknown): void {
    const host = this.host;
    if (!Array.isArray(frame) || host === null) {
      this.stats.dropped += 1;
      return;
    }
    // The number in front is the relay's word for who sent this. Nothing a guest writes can change it.
    host.wire.send(JSON.stringify([seat.peer, frame]));
    this.stats.relayed += 1;
  }

  private fromHost(frame: unknown): void {
    if (typeof frame === 'object' && frame !== null && !Array.isArray(frame)) {
      const order = frame as { relay?: unknown; peer?: unknown };
      const guest = order.relay === 'drop' ? this.guests.find((seat) => seat.peer === order.peer) : undefined;
      if (order.relay === 'bye') this.closeAll(CLOSE.hostLeft, 'host-left');
      else if (guest) this.drop(guest, CLOSE.dropped, 'dropped');
      else this.stats.dropped += 1;
      return;
    }
    if (!Array.isArray(frame)) {
      this.stats.dropped += 1;
      return;
    }
    const guests = this.guests;
    for (const entry of frame) {
      if (!Array.isArray(entry) || entry.length !== 2 || !Array.isArray(entry[1])) {
        this.stats.dropped += 1;
        continue;
      }
      const [to, bodies] = entry as [unknown, unknown[]];
      const targets = to === '*' ? guests : guests.filter((guest) => guest.peer === to);
      if (targets.length === 0) {
        this.stats.dropped += 1;
        continue;
      }
      const text = JSON.stringify(bodies);
      for (const guest of targets) guest.wire.send(text);
      this.stats.relayed += 1;
    }
  }

  /** Close one socket for breaking a cap, and tell the others it went. */
  private drop(seat: Seat, code: number, reason: string): void {
    this.disconnect(seat.wire);
    this.letGo(seat.wire, code, reason);
  }

  /** A socket closed, by itself or by the relay. */
  disconnect(wire: Wire): void {
    const seat = this.seats.get(wire);
    if (!seat) return;
    this.seats.delete(wire);
    if (seat.role === 'host') {
      for (const guest of this.guests) guest.wire.send(control('host', { here: false }));
    } else {
      this.host?.wire.send(control('left', { peer: seat.peer }));
    }
    if (this.seats.size === 0) this.forget();
  }

  private closeAll(code: number, reason: string): void {
    const seats = [...this.seats.values()];
    this.seats.clear();
    this.forget();
    for (const seat of seats) this.letGo(seat.wire, code, reason);
  }

  private forget(): void {
    this.hostKey = null;
    this.nextPeer = 1;
    this.sawFrame = false;
    this.quietSweeps = 0;
  }

  /**
   * A look at the room, every few minutes. A room nothing has gone through
   * for `LIMITS.quietSweeps` looks in a row is closed. Returns true while the
   * room should be looked at again.
   */
  sweep(): boolean {
    if (this.seats.size === 0) return false;
    if (this.sawFrame) {
      this.sawFrame = false;
      this.quietSweeps = 0;
      return true;
    }
    this.quietSweeps += 1;
    if (this.quietSweeps < LIMITS.quietSweeps) return true;
    this.closeAll(CLOSE.idle, 'idle');
    return false;
  }
}

/** A new room code: six characters of the alphabet, from the numbers given (0 to 1 each). */
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

/** True when `origin` is on the list. An entry may end in `:*` for any port. */
export function originAllowed(origin: string | null, allowed: string): boolean {
  if (origin === null || origin === '') return false;
  return allowed.split(',').map((entry) => entry.trim()).filter(Boolean).some((entry) => {
    if (!entry.endsWith(':*')) return origin === entry;
    const stem = entry.slice(0, -2);
    return origin === stem || (origin.startsWith(`${stem}:`) && /^\d{1,5}$/.test(origin.slice(stem.length + 1)));
  });
}
