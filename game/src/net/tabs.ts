/**
 * A wire between tabs of the same site, on the browser's own channel
 * (`BroadcastChannel`). No server: two windows on one computer can play
 * together. A developer's and tester's door, behind `?host=ROOM` and
 * `?join=ROOM&name=...`. It is not the real one:
 *
 * - It is a party line. Every tab of the site hears every message in the
 *   room, a guest's key included. Fine on one computer, never over a network.
 * - It cannot tell when a tab closes. A guest says `leave` as its page goes;
 *   failing that, the host marks it away once it has been quiet for a while.
 * - Two hosts in one room would both answer. Open one.
 */
import type { Transport } from './transport.ts';

/** The part of `BroadcastChannel` this uses. Tests pass a stand-in. */
export interface ChannelLike {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

/** Letters a room name may hold. */
export const ROOM_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

const HOST = 'host';

interface Envelope {
  from: string;
  to: string;
  body: unknown;
}

const isEnvelope = (value: unknown): value is Envelope =>
  typeof value === 'object' && value !== null
  && typeof (value as Envelope).from === 'string' && typeof (value as Envelope).to === 'string' && 'body' in value;

const openChannel = (room: string): ChannelLike => new BroadcastChannel(`portage.crew.${room}`) as unknown as ChannelLike;

/**
 * Host a room. `accept` is called with one transport for each guest tab, the
 * first time that tab speaks. Close the room to stop hearing them.
 */
export function hostTabRoom(room: string, accept: (transport: Transport) => void, open: (room: string) => ChannelLike = openChannel): { close(): void } {
  const channel = open(room);
  const wires = new Map<string, (message: unknown) => void>();
  channel.onmessage = (event): void => {
    const envelope = event.data;
    if (!isEnvelope(envelope) || envelope.to !== HOST || envelope.from === HOST) return;
    const guest = envelope.from;
    if (!wires.has(guest)) {
      let handler: (message: unknown) => void = () => {};
      wires.set(guest, (message) => handler(message));
      accept({
        send: (message) => {
          if (wires.has(guest)) channel.postMessage({ from: HOST, to: guest, body: message } satisfies Envelope);
        },
        receive: (message) => {
          handler = message;
        },
        // The host let this guest go. If the tab speaks again it is a new guest.
        close: () => void wires.delete(guest),
      });
    }
    wires.get(guest)?.(envelope.body);
  };
  return {
    close(): void {
      wires.clear();
      channel.onmessage = null;
      channel.close();
    },
  };
}

/** Join a room as a guest. `guestId` names this tab on the channel: any string no other tab in the room uses. */
export function joinTabRoom(room: string, guestId: string, open: (room: string) => ChannelLike = openChannel): Transport {
  const channel = open(room);
  let closed = false;
  return {
    send(message: unknown): void {
      if (!closed) channel.postMessage({ from: guestId, to: HOST, body: message } satisfies Envelope);
    },
    receive(message): void {
      channel.onmessage = (event): void => {
        const envelope = event.data;
        if (!closed && isEnvelope(envelope) && envelope.to === guestId && envelope.from === HOST) message(envelope.body);
      };
    },
    close(): void {
      if (closed) return;
      closed = true;
      channel.onmessage = null;
      channel.close();
    },
  };
}
