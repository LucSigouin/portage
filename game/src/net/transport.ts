/**
 * The wire between one host and one guest. Three things and nothing else:
 * send, receive, close. The host holds one `Transport` per guest; a guest
 * holds one, to the host. A relay, a channel between tabs or the loopback
 * pair below all look the same from here.
 *
 * What an implementation must do:
 *
 * - `send` copies or serialises the message before it returns. The sender
 *   hands over live game objects and changes them straight after.
 * - Messages are plain JSON values. They may arrive late, out of order or not
 *   at all: the sessions cope with all three. They must never arrive changed.
 * - `receive` is called once. `closed` fires at most once, when the other end
 *   is known to be gone. A wire that cannot tell (a channel between tabs)
 *   never calls it: the host also drops a guest it has not heard from.
 * - After `close` nothing is sent and nothing more is delivered.
 */
export interface Transport {
  send(message: unknown): void;
  receive(message: (message: unknown) => void, closed?: () => void): void;
  close(): void;
}

export interface LoopbackConditions {
  /** Seconds every message takes to cross. */
  delay: number;
  /** Extra seconds, 0 to this much, picked per message. More jitter than delay reorders messages. */
  jitter: number;
  /** Share of messages that never arrive, 0 to 1. */
  loss: number;
}

export interface LoopbackStats {
  sent: number;
  delivered: number;
  lost: number;
  /** Bytes of JSON sent, in all and by message `type`. */
  bytes: number;
  byType: Record<string, { count: number; bytes: number }>;
}

export interface LoopbackPair {
  /** The host's end. */
  host: Transport;
  /** The guest's end. */
  guest: Transport;
  /** Change the line. Messages already in flight keep the delay they left with. */
  conditions: LoopbackConditions;
  /** Let this many seconds pass: everything due is delivered, in the order it falls due. */
  advance(seconds: number): void;
  /** Messages still in flight. */
  readonly inFlight: number;
  /** What each end has sent. */
  readonly stats: { host: LoopbackStats; guest: LoopbackStats };
}

/** A small seeded generator, so a lossy line loses the same messages every run. */
function seededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const emptyStats = (): LoopbackStats => ({ sent: 0, delivered: 0, lost: 0, bytes: 0, byType: {} });

/**
 * Two transports joined back to back, for tests: what one sends the other
 * receives, after a delay, with jitter and loss as set. Time only passes in
 * `advance`, so a test is the same every run. Every message crosses as JSON
 * text, exactly as it would on a real wire.
 */
export function createLoopbackPair(conditions: Partial<LoopbackConditions> = {}, seed = 1): LoopbackPair {
  const random = seededRandom(seed);
  const line: LoopbackConditions = { delay: 0, jitter: 0, loss: 0, ...conditions };
  let clock = 0;
  let order = 0;
  interface End {
    onMessage: ((message: unknown) => void) | null;
    onClosed: (() => void) | null;
    closed: boolean;
    stats: LoopbackStats;
  }
  const ends: [End, End] = [
    { onMessage: null, onClosed: null, closed: false, stats: emptyStats() },
    { onMessage: null, onClosed: null, closed: false, stats: emptyStats() },
  ];
  let flights: { due: number; order: number; to: 0 | 1; text: string | null }[] = [];

  const transport = (self: 0 | 1): Transport => {
    const other = (1 - self) as 0 | 1;
    return {
      send(message: unknown): void {
        const end = ends[self];
        if (end.closed) return;
        const text = JSON.stringify(message);
        const type = typeof message === 'object' && message !== null && typeof (message as { type?: unknown }).type === 'string'
          ? (message as { type: string }).type : '?';
        end.stats.sent += 1;
        end.stats.bytes += text.length;
        const tally = end.stats.byType[type] ??= { count: 0, bytes: 0 };
        tally.count += 1;
        tally.bytes += text.length;
        if (random() < line.loss) {
          end.stats.lost += 1;
          return;
        }
        flights.push({ due: clock + line.delay + random() * line.jitter, order: order += 1, to: other, text });
      },
      receive(message, closed): void {
        ends[self].onMessage = message;
        ends[self].onClosed = closed ?? null;
      },
      close(): void {
        const end = ends[self];
        if (end.closed) return;
        end.closed = true;
        // The other end learns of it as a message would arrive: after the delay, never lost.
        flights.push({ due: clock + line.delay, order: order += 1, to: other, text: null });
      },
    };
  };

  return {
    host: transport(0),
    guest: transport(1),
    conditions: line,
    advance(seconds: number): void {
      clock += seconds;
      for (;;) {
        const due = flights.filter((flight) => flight.due <= clock + 1e-12).sort((first, second) => first.due - second.due || first.order - second.order);
        if (due.length === 0) return;
        // Delivering may send more. Whatever that puts in flight is picked up on the next pass.
        flights = flights.filter((flight) => !due.includes(flight));
        for (const flight of due) {
          const end = ends[flight.to];
          if (end.closed) continue;
          if (flight.text === null) {
            end.closed = true;
            end.onClosed?.();
          } else {
            ends[1 - flight.to]!.stats.delivered += 1;
            end.onMessage?.(JSON.parse(flight.text));
          }
        }
      }
    },
    get inFlight(): number {
      return flights.length;
    },
    stats: { host: ends[0].stats, guest: ends[1].stats },
  };
}
