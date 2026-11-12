/** The wire between tabs: one channel a room, each guest tab its own transport on the host. A stand-in channel, no browser. */
import { describe, expect, it } from 'vitest';
import { parseDebugParameters } from '../../src/client/debug/parameters.ts';
import { GuestLink, HostLink, hostTabRoom, joinTabRoom } from '../../src/net/index.ts';
import type { ChannelLike, Transport } from '../../src/net/index.ts';
import { FIXED_STEP, hashState } from '../../src/sim/index.ts';
import { calmGame, key } from './rig.ts';

/** What `BroadcastChannel` does: a message posted on one channel reaches every other channel of the same name, as a copy. */
function hub(): { open: (room: string) => ChannelLike; posted: { room: string; data: unknown }[] } {
  const channels: (ChannelLike & { room: string; open: boolean })[] = [];
  const posted: { room: string; data: unknown }[] = [];
  return {
    posted,
    open(room: string): ChannelLike {
      const channel = {
        room,
        open: true,
        onmessage: null as ChannelLike['onmessage'],
        postMessage(message: unknown): void {
          if (!channel.open) throw new Error('posted on a closed channel');
          posted.push({ room, data: message });
          for (const other of [...channels]) {
            if (other !== channel && other.open && other.room === room) other.onmessage?.({ data: structuredClone(message) });
          }
        },
        close(): void {
          channel.open = false;
        },
      };
      channels.push(channel);
      return channel;
    },
  };
}

describe('a room between tabs', () => {
  it('gives the host one transport a guest tab, and carries each tab\'s messages to and from it alone', () => {
    const { open } = hub();
    const wires: Transport[] = [];
    const heardByHost: unknown[][] = [];
    hostTabRoom('lake', (transport) => {
      const index = wires.push(transport) - 1;
      heardByHost.push([]);
      transport.receive((message) => void heardByHost[index]!.push(message));
    }, open);
    const ann = joinTabRoom('lake', 'tab-ann', open);
    const bo = joinTabRoom('lake', 'tab-bo', open);
    const heardByAnn: unknown[] = [];
    const heardByBo: unknown[] = [];
    ann.receive((message) => void heardByAnn.push(message));
    bo.receive((message) => void heardByBo.push(message));

    ann.send({ n: 1 });
    bo.send({ n: 2 });
    ann.send({ n: 3 });
    expect(wires).toHaveLength(2);
    expect(heardByHost).toEqual([[{ n: 1 }, { n: 3 }], [{ n: 2 }]]);
    wires[0]!.send({ to: 'ann' });
    wires[1]!.send({ to: 'bo' });
    expect(heardByAnn).toEqual([{ to: 'ann' }]);
    expect(heardByBo).toEqual([{ to: 'bo' }]);
  });

  it('keeps rooms apart', () => {
    const { open } = hub();
    let guests = 0;
    hostTabRoom('lake', () => void (guests += 1), open);
    joinTabRoom('pond', 'tab-ann', open).send({ n: 1 });
    expect(guests).toBe(0);
  });

  it('hands over a copy: what the host changes after sending does not change what arrived', () => {
    const { open } = hub();
    let wire: Transport | null = null;
    hostTabRoom('lake', (transport) => {
      wire = transport;
    }, open);
    const ann = joinTabRoom('lake', 'tab-ann', open);
    const heard: { value: number }[] = [];
    ann.receive((message) => void heard.push(message as { value: number }));
    ann.send({});
    const live = { value: 1 };
    wire!.send(live);
    live.value = 2;
    expect(heard).toEqual([{ value: 1 }]);
  });

  it('sends and hears nothing once closed, and a tab the host let go is a new guest if it speaks again', () => {
    const { open, posted } = hub();
    const wires: Transport[] = [];
    const room = hostTabRoom('lake', (transport) => void wires.push(transport), open);
    const ann = joinTabRoom('lake', 'tab-ann', open);
    const heard: unknown[] = [];
    ann.receive((message) => void heard.push(message));
    ann.send({ n: 1 });
    wires[0]!.close();
    wires[0]!.send({ late: true });
    expect(heard).toEqual([]);
    ann.send({ n: 2 });
    expect(wires).toHaveLength(2);
    ann.close();
    const count = posted.length;
    ann.send({ n: 3 });
    expect(posted).toHaveLength(count);
    room.close();
    joinTabRoom('lake', 'tab-bo', open).send({ n: 4 });
    expect(wires).toHaveLength(2);
  });

  it('carries a whole game: a host and two guest tabs end on one fingerprint, and a tab that returns gets its player back', () => {
    const { open } = hub();
    const game = calmGame();
    const host = new HostLink({ game, hostPlayerId: 0, session: 7 });
    hostTabRoom('lake', (transport) => host.accept(transport), open);
    const ann = new GuestLink(joinTabRoom('lake', 'tab-ann', open), { name: 'Ann', key: key('Ann') });
    const bo = new GuestLink(joinTabRoom('lake', 'tab-bo', open), { name: 'Bo', key: key('Bo') });
    const frames = (guests: GuestLink[], count: number): void => {
      for (let frame = 0; frame < count; frame += 1) {
        host.afterFrame([], FIXED_STEP);
        for (const guest of guests) guest.update(FIXED_STEP);
      }
    };
    frames([ann, bo], 30);
    expect([ann.playerId, bo.playerId]).toEqual([1, 2]);
    expect(hashState(ann.truth!)).toBe(hashState({ ...game, events: [] }));
    expect(hashState(bo.truth!)).toBe(hashState({ ...game, events: [] }));
    // Ann's tab closes. A new tab, a new name on the channel, the same key.
    ann.close();
    frames([bo], 5);
    expect(game.players[1].connected).toBe(false);
    const back = new GuestLink(joinTabRoom('lake', 'tab-ann-2', open), { name: 'Ann', key: key('Ann') });
    frames([bo, back], 30);
    expect(back.playerId).toBe(1);
    expect(game.players.map((player) => player.connected)).toEqual([true, true, true]);
    expect(game.players).toHaveLength(3);
  });
});

describe('?host= and ?join=', () => {
  it('reads a room and a name, and plays in the sandbox', () => {
    expect(parseDebugParameters('')).toMatchObject({ host: null, join: null, name: '', sandbox: false });
    expect(parseDebugParameters('?host=lake')).toMatchObject({ host: 'lake', join: null, sandbox: true });
    expect(parseDebugParameters('?join=lake&name=Sam')).toMatchObject({ host: null, join: 'lake', name: 'Sam', sandbox: true });
    expect(parseDebugParameters('?host=lake&name=Luc&at=quest3')).toMatchObject({ host: 'lake', name: 'Luc', atQuest: 3 });
  });

  it('takes one or the other, and only a plain room name', () => {
    expect(parseDebugParameters('?host=lake&join=pond')).toMatchObject({ host: 'lake', join: null });
    for (const bad of ['', 'two words', 'a/b', 'x'.repeat(33), '<script>']) {
      expect(parseDebugParameters(`?host=${encodeURIComponent(bad)}`)).toMatchObject({ host: null, sandbox: false });
      expect(parseDebugParameters(`?join=${encodeURIComponent(bad)}`)).toMatchObject({ join: null, sandbox: false });
    }
  });
});
