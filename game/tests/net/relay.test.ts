/**
 * The wire through the relay: a host and its guests on sockets, with the
 * relay's own room logic between them. A good line, a slow and lossy one,
 * lines that drop and come back, and a relay that says no. No network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as relayRoom from '../../../relay/src/room.ts';
import {
  FIRST_TRIES, HOST_GRACE_SECONDS, RECONNECT_SECONDS, RELAY_PROTOCOL, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ROOM_CODE_PATTERN,
  RelayGuestWire, RelayHostRoom, makeRoomCode, readRoomCode, resolveRelayAddress, showRoomCode,
} from '../../src/net/relay.ts';
import type { OpenSocket, RelayFailure } from '../../src/net/relay.ts';
import { PROTOCOL_VERSION } from '../../src/net/index.ts';
import type { Transport } from '../../src/net/index.ts';
import { hashState } from '../../src/sim/index.ts';
import { key } from './rig.ts';
import { ADDRESS, CODE, FakeRelay, HOST_KEY, createRelayRig } from './relay-rig.ts';
import type { FakeSocket } from './relay-rig.ts';

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

const seconds = (count: number): Promise<unknown> => vi.advanceTimersByTimeAsync(count * 1000);

describe('the game and the relay', () => {
  it('use the same words: the protocol name, the room codes and the reasons', () => {
    expect(RELAY_PROTOCOL).toBe(relayRoom.RELAY_PROTOCOL);
    expect(ROOM_CODE_ALPHABET).toBe(relayRoom.ROOM_CODE_ALPHABET);
    expect(ROOM_CODE_LENGTH).toBe(relayRoom.ROOM_CODE_LENGTH);
    expect(ROOM_CODE_PATTERN.source).toBe(relayRoom.ROOM_CODE_PATTERN.source);
    expect(makeRoomCode(() => 0.37)).toBe(relayRoom.makeRoomCode(() => 0.37));
    for (const typed of ['fhj-k3m', ' FHJ K3M ', 'ABCDEF', 'FHJK3', '']) expect(readRoomCode(typed)).toBe(relayRoom.readRoomCode(typed));
  });

  it('turn each of the relay\'s reasons into the game\'s', async () => {
    // Every reason the relay can close a socket with, and what a guest dialling for the first time makes of it.
    const expected: Record<keyof typeof relayRoom.CLOSE, RelayFailure> = {
      badRequest: 'refused', dropped: 'refused', full: 'full', noRoom: 'no-room', idle: 'idle', taken: 'taken', hostLeft: 'host-left',
      tooBig: 'refused', tooFast: 'refused',
    };
    for (const [name, code] of Object.entries(relayRoom.CLOSE)) {
      const wire = new RelayGuestWire({
        address: ADDRESS, code: CODE,
        open: () => {
          const socket = { send: () => {}, close: () => {}, onopen: null, onmessage: null, onclose: null as ((event: { code: number; reason: string }) => void) | null, onerror: null };
          setTimeout(() => socket.onclose?.({ code, reason: name }), 1);
          return socket;
        },
      });
      await seconds(0.01);
      expect([name, wire.phase, wire.failure]).toEqual([name, 'closed', expected[name as keyof typeof relayRoom.CLOSE]]);
    }
  });

  it('shows a code in two threes, and reads the relay\'s address from the one setting', () => {
    expect(showRoomCode('FHJK3M')).toBe('FHJ-K3M');
    expect(resolveRelayAddress('wss://relay.example/portage/', 'https://sigouin.net')).toBe('wss://relay.example/portage');
    expect(resolveRelayAddress('ws://localhost:8791', 'http://localhost:5222')).toBe('ws://localhost:8791');
    // A path is on the page's own host, so the site's security policy needs no change.
    expect(resolveRelayAddress('/portage/relay', 'https://sigouin.net')).toBe('wss://sigouin.net/portage/relay');
    expect(resolveRelayAddress('/relay', 'http://localhost:5222')).toBe('ws://localhost:5222/relay');
    // Nothing set, or nothing usable: no relay.
    for (const setting of ['', '   ', 'https://sigouin.net/relay', 'relay', 'javascript:alert(1)']) {
      expect(resolveRelayAddress(setting, 'https://sigouin.net')).toBeNull();
    }
  });
});

describe('a game through the relay', () => {
  it('seats three guests, each their own player, and ends everyone on the host\'s fingerprint', async () => {
    const rig = createRelayRig();
    const seats = ['Ann', 'Bo', 'Cy'].map((name) => rig.join(name));
    await rig.run(1);
    expect(seats.map((seat) => [seat.link.status, seat.link.playerId])).toEqual([['playing', 1], ['playing', 2], ['playing', 3]]);
    expect(rig.game.players.map((player) => [player.name, player.connected])).toEqual([['', true], ['Ann', true], ['Bo', true], ['Cy', true]]);
    expect([...rig.room.guests].sort()).toEqual([1, 2, 3]);

    const before = { ...rig.game.canoe.position };
    rig.hostInput = { paddle: 1 };
    seats[1]!.input = { paddle: 1, steer: 0.3 };
    await rig.run(5);
    expect(rig.game.players[2]!.paddling).toBe(true);
    expect(Math.hypot(rig.game.canoe.position.x - before.x, rig.game.canoe.position.z - before.z)).toBeGreaterThan(3);
    // A guest asks for something, and the host does it for that guest alone.
    seats[2]!.link.sendCommand({ type: 'select_tool', toolId: 'bailing_can' });
    await rig.run(1);
    expect(rig.game.players.map((player) => player.selectedTool)).toEqual([null, null, null, 'bailing_can']);
    expect(seats[2]!.results.map((outcome) => outcome.result.ok)).toEqual([true]);

    expect(await rig.settle()).toBe(true);
    for (const seat of seats) {
      expect(hashState(seat.link.truth!)).toBe(rig.hostHash());
      expect(seat.link.mismatches).toBe(0);
    }
    expect(rig.host.stats.refused).toBe(0);
  });

  it('on a slow and lossy line (0.12 s each way, one frame in five lost) three guests still end on the host\'s fingerprint', async () => {
    const rig = createRelayRig({ conditions: { delay: 0.12, loss: 0.2 } });
    const seats = ['Ann', 'Bo', 'Cy'].map((name) => rig.join(name));
    await rig.run(3);
    expect(seats.map((seat) => seat.link.status)).toEqual(['playing', 'playing', 'playing']);
    for (const player of rig.game.players) player.backpack.push({ itemId: 'berries', count: 12 });
    // Forty seconds of everyone doing something different, with commands thrown in.
    for (let second = 0; second < 40; second += 1) {
      rig.hostInput = { paddle: second % 7 < 5 ? 1 : 0, steer: Math.sin(second) };
      seats.forEach((seat, index) => {
        seat.input = { paddle: (second + index) % 4 === 0 ? -1 : 1, steer: Math.cos(second * (index + 1)), bail: second % 11 === index };
        if (second % 9 === index * 2) seat.link.sendCommand({ type: 'eat', itemId: 'berries' });
        if (second % 13 === index) seat.link.sendCommand({ type: 'select_tool', toolId: second % 2 ? 'bailing_can' : null });
      });
      await rig.run(1);
    }
    expect(rig.relay.frames.lost).toBeGreaterThan(300);
    expect(seats.map((seat) => seat.link.mismatches)).toEqual([0, 0, 0]);
    // Every command got its answer, once. (An answer lost on the line comes again, and may then come after the next one's.)
    for (const seat of seats) {
      expect(seat.results.map((outcome) => outcome.id).sort((first, second) => first - second)).toEqual(seat.results.map((_, index) => index + 1));
    }
    expect(await rig.settle(20)).toBe(true);
    for (const seat of seats) expect(hashState(seat.link.truth!)).toBe(rig.hostHash());
    // And what the guests ate, the host's game ate.
    // (On a line this bad the joins land in any order: each guest is whichever player the host made it.)
    expect(seats.map((seat) => rig.game.players[seat.link.playerId]!.backpack.find((stack) => stack.itemId === 'berries')?.count ?? 0))
      .toEqual(seats.map((seat) => 12 - seat.results.filter((outcome) => outcome.command.type === 'eat' && outcome.result.ok).length));
    expect(new Set(seats.map((seat) => seat.link.playerId))).toEqual(new Set([1, 2, 3]));
  });

  it('puts everything the host says in a frame into one socket frame, and thins a guest\'s to forty a second', async () => {
    const rig = createRelayRig();
    const seats = ['Ann', 'Bo', 'Cy'].map((name) => rig.join(name));
    await rig.run(2);
    const before = { ...rig.relay.frames };
    rig.hostInput = { paddle: 1 };
    // Every guest's input changes every frame, as when the camera is dragged on a fast screen.
    let turn = 0;
    for (let frame = 0; frame < 600; frame += 1) {
      for (const seat of seats) seat.input = { paddle: 1, cameraYaw: turn += 0.001 };
      await rig.run(1 / 60);
    }
    const hostFrames = (rig.relay.frames.host - before.host) / 10;
    const guestFrames = (rig.relay.frames.guest - before.guest) / 10 / 3;
    // Fifteen states a second for three guests leave as fifteen frames, not forty-five. Pongs ride along.
    expect(hostFrames).toBeGreaterThan(14);
    expect(hostFrames).toBeLessThan(21);
    expect(guestFrames).toBeGreaterThan(25);
    expect(guestFrames).toBeLessThanOrEqual(41);
    // Thinned, not lost: the host has the newest input of each.
    await rig.run(0.2);
    expect(rig.host.stats.refused).toBe(0);
    expect(await rig.settle()).toBe(true);
  });

  it('keeps a guest who dials before the game starts waiting, and seats them when it does', async () => {
    const relay = new FakeRelay();
    const room = new RelayHostRoom({ address: ADDRESS, code: CODE, key: HOST_KEY, open: relay.open });
    await seconds(0.1);
    const rig = createRelayRig({ relay });
    rig.room.close();
    await seconds(0.1);
    // `room` is the lobby's: open, with no game yet.
    const wire = new RelayGuestWire({ address: ADDRESS, code: CODE, open: relay.open });
    const transports: Transport[] = [];
    await seconds(2);
    expect(wire.phase).toBe('open');
    expect(wire.hostHere).toBe(true);
    expect([...room.guests]).toEqual([1]);
    wire.send({ asking: 1 });
    await seconds(0.5);
    expect(transports).toHaveLength(0);
    // The game starts: the next thing the guest says finds someone listening.
    const heard: unknown[] = [];
    room.setAccept((transport) => {
      transports.push(transport);
      transport.receive((message) => void heard.push(message));
    });
    wire.send({ asking: 2 });
    await seconds(0.5);
    expect(transports).toHaveLength(1);
    expect(heard).toEqual([{ asking: 2 }]);
  });
});

describe('the wire itself', () => {
  it('carries every message, in order and unchanged, each way, and what was sent is what was said at the time', async () => {
    const relay = new FakeRelay();
    const room = new RelayHostRoom({ address: ADDRESS, code: CODE, key: HOST_KEY, open: relay.open });
    const toGuest: Transport[] = [];
    const heardByHost: unknown[] = [];
    room.setAccept((transport) => {
      toGuest.push(transport);
      transport.receive((message) => void heardByHost.push(message));
    });
    const wire = new RelayGuestWire({ address: ADDRESS, code: CODE, open: relay.open });
    const heardByGuest: unknown[] = [];
    wire.receive((message) => void heardByGuest.push(message));
    await seconds(0.1);

    // Three from the guest in one breath: one socket frame, three messages for the host.
    const live = { n: 1, list: [1, 2, 3], text: 'héron "quoted" \\ 🛶' };
    const framesBefore = relay.frames.guest;
    wire.send(live);
    live.n = 99;
    wire.send({ n: 2 });
    wire.send({ n: 3, nested: { deep: [null, true, 1.5] } });
    await seconds(0.1);
    expect(heardByHost).toEqual([{ n: 1, list: [1, 2, 3], text: 'héron "quoted" \\ 🛶' }, { n: 2 }, { n: 3, nested: { deep: [null, true, 1.5] } }]);
    expect(relay.frames.guest - framesBefore).toBe(1);

    // And three back from the host, changed after sending: the guest hears what was said, not what it became.
    const state = { step: 1, players: [{ x: 1 }] };
    const hostFramesBefore = relay.frames.host;
    toGuest[0]!.send(state);
    state.step = 2;
    state.players[0]!.x = 50;
    toGuest[0]!.send(state);
    toGuest[0]!.send({ last: true });
    await seconds(0.1);
    expect(heardByGuest).toEqual([{ step: 1, players: [{ x: 1 }] }, { step: 2, players: [{ x: 50 }] }, { last: true }]);
    expect(relay.frames.host - hostFramesBefore).toBe(1);
  });

  it('sends nothing on a socket that has begun to close: a browser does not throw there, it writes an error on the console', async () => {
    // A stand-in that does as a browser's socket does between the start of its close and the page hearing of it.
    const complaints: string[] = [];
    const relay = new FakeRelay();
    const made: (FakeSocket & { readyState: number })[] = [];
    const open: OpenSocket = (address, protocols) => {
      const socket = Object.assign(relay.open(address, protocols) as FakeSocket, { readyState: 1 });
      const send = socket.send;
      socket.send = (text): void => {
        if (socket.readyState === 1) send(text);
        else complaints.push('WebSocket is already in CLOSING or CLOSED state.');
      };
      made.push(socket);
      return socket;
    };
    const room = new RelayHostRoom({ address: ADDRESS, code: CODE, key: HOST_KEY, open: relay.open });
    const heardByHost: unknown[] = [];
    room.setAccept((transport) => transport.receive((message) => void heardByHost.push(message)));
    const wire = new RelayGuestWire({ address: ADDRESS, code: CODE, open });
    await seconds(0.1);
    wire.send({ n: 1 });
    await seconds(0.1);
    expect(heardByHost).toEqual([{ n: 1 }]);

    // The close has begun (the wifi blinked, or the relay is letting go) and the page has not been told yet.
    made[0]!.readyState = 2;
    const framesBefore = relay.frames.guest;
    wire.send({ n: 2 });
    await seconds(0.1);
    expect(complaints).toEqual([]);
    expect(relay.frames.guest).toBe(framesBefore);
    expect(heardByHost).toEqual([{ n: 1 }]);
  });

  it('closes the socket of a window that does not leave by itself when the host lets it go', async () => {
    const rig = createRelayRig();
    await rig.run(0.2);
    // A window that joins and then stops listening: it will not close its own socket when told to leave.
    const stuck = rig.relay.open(`${ADDRESS}/room/${CODE}?role=guest`, [RELAY_PROTOCOL]) as FakeSocket;
    await rig.run(0.1);
    stuck.send(JSON.stringify([{ v: PROTOCOL_VERSION, type: 'join', name: 'Sam', key: key('Sam'), character: 'voyageur' }]));
    await rig.run(0.5);
    expect(rig.game.players[1]).toMatchObject({ name: 'Sam', connected: true });
    expect(rig.relay.rooms.get(CODE)!.size).toBe(2);
    // The same player arrives from another window. The host gives it the seat and lets the first go.
    const second = rig.join('Sam', key('Sam'));
    await rig.run(1);
    expect([second.link.status, second.link.playerId]).toEqual(['playing', 1]);
    expect(stuck.alive, 'the relay closed the socket the host let go').toBe(false);
    expect(stuck.closedWith).toEqual({ code: 4401, reason: 'dropped' });
    expect(rig.relay.rooms.get(CODE)!.size).toBe(2);
    expect([...rig.room.guests]).toEqual([2]);
  });
});

describe('a line that drops', () => {
  it('brings a guest back by itself as the same player, with their seat, their things and their place', async () => {
    const rig = createRelayRig();
    const sam = rig.join('Sam');
    const bo = rig.join('Bo');
    await rig.run(1);
    rig.game.players[1]!.backpack.push({ itemId: 'driftwood', count: 3 });
    rig.hostInput = { paddle: 1 };
    await rig.run(2);
    const seat = rig.game.players[1]!.seat;
    expect(sam.link.playerId).toBe(1);

    rig.relay.cut(rig.relay.live('guest')[0]!);
    await rig.run(0.1);
    expect(sam.wire.phase).toBe('reconnecting');
    expect(rig.game.players[1]!.connected).toBe(false);
    expect(rig.hostEvents).toContainEqual({ type: 'crew_changed', who: 1, change: 'away' });
    await rig.run(1.5);
    // Back, with nobody asked to do anything.
    expect(sam.wire.phase).toBe('open');
    expect(sam.backs).toBe(1);
    expect(sam.link.status).toBe('playing');
    expect(sam.link.playerId).toBe(1);
    expect(rig.game.players).toHaveLength(3);
    expect(rig.game.players[1]).toMatchObject({ name: 'Sam', connected: true, seat });
    expect(rig.game.players[1]!.backpack).toContainEqual({ itemId: 'driftwood', count: 3 });
    expect(rig.hostEvents).toContainEqual({ type: 'crew_changed', who: 1, change: 'back' });
    // The other guest never noticed.
    expect(bo.link.status).toBe('playing');
    expect(bo.backs).toBe(0);
    // And it still plays.
    sam.input = { paddle: 1 };
    await rig.run(0.5);
    expect(rig.game.players[1]!.paddling).toBe(true);
    expect(await rig.settle()).toBe(true);
    expect(hashState(sam.link.truth!)).toBe(rig.hostHash());
  });

  it('holds the guests while the host\'s line is down, and goes on when it is back', async () => {
    const rig = createRelayRig();
    const seats = ['Ann', 'Bo'].map((name) => rig.join(name));
    await rig.run(2);
    rig.relay.up = false;
    rig.relay.cut(rig.relay.live('host')[0]!);
    await rig.run(0.1);
    expect(rig.room.phase).toBe('reconnecting');
    expect(seats.map((seat) => seat.wire.hostHere)).toEqual([false, false]);
    const guestFramesWhileAway = rig.relay.frames.guest;
    await rig.run(1);
    // The guests say nothing into a room with no host: nothing is paid for frames nobody hears.
    expect(rig.relay.frames.guest).toBe(guestFramesWhileAway);
    rig.relay.up = true;
    await rig.run(1.5);
    expect(rig.room.phase).toBe('open');
    expect(seats.map((seat) => [seat.wire.hostHere, seat.backs, seat.link.status])).toEqual([[true, 1, 'playing'], [true, 1, 'playing']]);
    expect(rig.game.players.map((player) => player.connected)).toEqual([true, true, true]);
    expect(rig.game.players).toHaveLength(3);
    rig.hostInput = { paddle: 1 };
    await rig.run(2);
    expect(await rig.settle()).toBe(true);
    for (const seat of seats) expect(hashState(seat.link.truth!)).toBe(rig.hostHash());
  });

  it('lets the guests go, in words, when the host does not come back', async () => {
    const rig = createRelayRig();
    const sam = rig.join('Sam');
    await rig.run(1);
    rig.relay.up = false;
    rig.relay.cut(rig.relay.live('host')[0]!);
    await rig.run(1);
    expect(sam.wire.phase).toBe('open');
    expect(sam.wire.hostHere).toBe(false);
    await seconds(HOST_GRACE_SECONDS);
    expect(sam.wire.phase).toBe('closed');
    expect(sam.wire.failure).toBe('host-left');
    expect(sam.link.status).toBe('closed');
    // And the host, whose relay never answered again, is told so too.
    await seconds(RECONNECT_SECONDS);
    expect(rig.room.phase).toBe('closed');
    expect(rig.room.failure).toBe('unreachable');
  });

  it('gives up on a guest\'s line that stays down, and marks them away on the host', async () => {
    const rig = createRelayRig();
    const sam = rig.join('Sam');
    await rig.run(1);
    rig.relay.up = false;
    rig.relay.cut(rig.relay.live('guest')[0]!);
    await rig.run(RECONNECT_SECONDS + 5);
    expect(sam.wire.phase).toBe('closed');
    expect(sam.wire.failure).toBe('unreachable');
    expect(sam.link.status).toBe('closed');
    expect(rig.game.players[1]).toMatchObject({ name: 'Sam', connected: false });
    expect(rig.relay.dials.length).toBeLessThan(30);
  });
});

describe('a relay that says no', () => {
  it('cannot be reached: a few tries, then the reason', async () => {
    const relay = new FakeRelay();
    relay.up = false;
    let ended = 0;
    const wire = new RelayGuestWire({ address: ADDRESS, code: CODE, open: relay.open });
    wire.receive(() => {}, () => { ended += 1; });
    expect(wire.phase).toBe('connecting');
    await seconds(5);
    expect([wire.phase, wire.failure, ended]).toEqual(['closed', 'unreachable', 1]);
    expect(relay.dials).toHaveLength(FIRST_TRIES);
    const room = new RelayHostRoom({ address: ADDRESS, code: CODE, key: HOST_KEY, open: relay.open });
    await seconds(5);
    expect([room.phase, room.failure]).toEqual(['closed', 'unreachable']);
    await seconds(60);
    expect(relay.dials).toHaveLength(FIRST_TRIES * 2);
  });

  it('never answers at all: a dial that hangs is given up on too', async () => {
    const dials: string[] = [];
    const wire = new RelayGuestWire({
      address: ADDRESS, code: CODE,
      open: (address) => {
        dials.push(address);
        return { send: () => {}, close: () => {}, onopen: null, onmessage: null, onclose: null, onerror: null };
      },
    });
    await seconds(30);
    expect([wire.phase, wire.failure]).toEqual(['closed', 'unreachable']);
    expect(dials).toEqual(Array.from({ length: FIRST_TRIES }, () => `${ADDRESS}/room/${CODE}?role=guest`));
  });

  it('has no room with that code, or the room is full, or has a host: each said at once, with no second try', async () => {
    const relay = new FakeRelay();
    const lost = new RelayGuestWire({ address: ADDRESS, code: CODE, open: relay.open });
    await seconds(0.1);
    expect([lost.phase, lost.failure]).toEqual(['closed', 'no-room']);
    expect(relay.dials).toHaveLength(1);

    const rig = createRelayRig({ relay });
    for (const name of ['Ann', 'Bo', 'Cy']) rig.join(name);
    await rig.run(1);
    const fifth = rig.join('Dee');
    await rig.run(1);
    expect([fifth.wire.phase, fifth.wire.failure, fifth.link.status]).toEqual(['closed', 'full', 'closed']);
    expect(rig.game.players).toHaveLength(4);

    const dialsBefore = relay.dials.length;
    const second = new RelayHostRoom({ address: ADDRESS, code: CODE, key: 'another-key-0123456789', open: relay.open });
    await rig.run(1);
    expect([second.phase, second.failure]).toEqual(['closed', 'taken']);
    expect(relay.dials.length).toBe(dialsBefore + 1);
  });

  it('carries the host\'s key in the handshake and never in the address', async () => {
    const rig = createRelayRig();
    rig.join('Sam');
    await rig.run(0.5);
    expect(rig.relay.dials).toEqual([
      { address: `${ADDRESS}/room/${CODE}?role=host`, protocols: [RELAY_PROTOCOL, `k.${HOST_KEY}`] },
      { address: `${ADDRESS}/room/${CODE}?role=guest`, protocols: [RELAY_PROTOCOL] },
    ]);
    expect(rig.relay.dials.some((dial) => dial.address.includes(HOST_KEY) || dial.address.includes(key('Sam')))).toBe(false);
  });
});

describe('the host letting go', () => {
  it('closes the room: every guest is told the host left, and the code is nobody\'s', async () => {
    const rig = createRelayRig();
    const seats = ['Ann', 'Bo'].map((name) => rig.join(name));
    await rig.run(1);
    rig.room.close();
    await rig.run(0.5);
    expect(rig.room.phase).toBe('closed');
    expect(rig.room.failure).toBeNull();
    expect(seats.map((seat) => [seat.wire.phase, seat.wire.failure, seat.link.status])).toEqual([['closed', 'host-left', 'closed'], ['closed', 'host-left', 'closed']]);
    expect(rig.relay.rooms.get(CODE)!.empty).toBe(true);
    const late = new RelayGuestWire({ address: ADDRESS, code: CODE, open: rig.relay.open });
    await seconds(0.1);
    expect(late.failure).toBe('no-room');
  });

  it('stops sharing: each guest hears why from the host, then the relay drops their socket', async () => {
    const rig = createRelayRig();
    const sam = rig.join('Sam');
    await rig.run(1);
    rig.host.close();
    await rig.run(0.5);
    expect([sam.link.status, sam.link.leaveReason]).toEqual(['closed', 'closed']);
    expect(rig.relay.live('guest')).toHaveLength(0);
    expect(rig.relay.rooms.get(CODE)!.size).toBe(1);
    expect(rig.room.phase).toBe('open');
  });

  it('gives a player who joins from a second window their seat, and lets the first window go', async () => {
    const rig = createRelayRig();
    const first = rig.join('Sam', key('Sam'));
    await rig.run(1);
    const second = rig.join('Sam', key('Sam'));
    await rig.run(1);
    expect([first.link.status, first.link.leaveReason]).toEqual(['closed', 'replaced']);
    expect([second.link.status, second.link.playerId]).toEqual(['playing', 1]);
    expect(rig.game.players).toHaveLength(2);
    expect(rig.relay.live('guest')).toHaveLength(1);
    expect([...rig.room.guests]).toEqual([2]);
  });

  it('a guest who leaves says so and frees their place at once', async () => {
    const rig = createRelayRig();
    const sam = rig.join('Sam');
    await rig.run(1);
    sam.link.close();
    await rig.run(0.2);
    expect(sam.wire.phase).toBe('closed');
    expect(sam.wire.failure).toBeNull();
    expect(rig.game.players[1]).toMatchObject({ name: 'Sam', connected: false });
    expect([...rig.room.guests]).toEqual([]);
  });
});
