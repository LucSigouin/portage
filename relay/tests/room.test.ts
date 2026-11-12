/** The room's logic by itself: fake sockets, no network. Run: npm test */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CLOSE, LIMITS, MAXIMUM_GUESTS, ROOM_CODE_ALPHABET, ROOM_CODE_PATTERN, RoomLogic, makeRoomCode, originAllowed, readRoomCode,
} from '../src/room.ts';
import type { IdleCount, SeatRecord, Wire } from '../src/room.ts';

interface FakeWire extends Wire {
  frames: unknown[];
  closed: { code: number; reason: string } | null;
}

function fakeWire(): FakeWire {
  const wire: FakeWire = {
    frames: [],
    closed: null,
    send: (text) => void wire.frames.push(JSON.parse(text)),
    close: (code, reason) => {
      wire.closed = { code, reason };
    },
  };
  return wire;
}

const HOST_KEY = 'host-key-0123456789';
const OTHER_KEY = 'other-key-0123456789';

function openRoom(guests = 0): { room: RoomLogic; host: FakeWire; guests: FakeWire[]; records: SeatRecord[] } {
  const room = new RoomLogic();
  const host = fakeWire();
  const records = [room.connect(host, 'host', HOST_KEY, 0)!];
  const seated: FakeWire[] = [];
  for (let index = 0; index < guests; index += 1) {
    const guest = fakeWire();
    records.push(room.connect(guest, 'guest', null, 0)!);
    seated.push(guest);
  }
  return { room, host, guests: seated, records };
}

describe('a room', () => {
  it('is opened by a host, and tells each socket who it is and who else is here', () => {
    const { host, guests } = openRoom(2);
    assert.deepEqual(host.frames, [
      { relay: 'hello', role: 'host', peers: [] },
      { relay: 'joined', peer: 1 },
      { relay: 'joined', peer: 2 },
    ]);
    assert.deepEqual(guests[0]!.frames, [{ relay: 'hello', role: 'guest', peer: 1, host: true }]);
    assert.deepEqual(guests[1]!.frames, [{ relay: 'hello', role: 'guest', peer: 2, host: true }]);
  });

  it('passes the host\'s messages to one guest or to all, and a guest\'s to the host alone, stamped with its number', () => {
    const { room, host, guests } = openRoom(3);
    for (const wire of [host, ...guests]) wire.frames.length = 0;
    room.message(host, JSON.stringify([[2, [{ type: 'state', n: 1 }]], ['*', [{ type: 'events' }, { type: 'more' }]]]), 10);
    assert.deepEqual(guests[0]!.frames, [[{ type: 'events' }, { type: 'more' }]]);
    assert.deepEqual(guests[1]!.frames, [[{ type: 'state', n: 1 }], [{ type: 'events' }, { type: 'more' }]]);
    assert.deepEqual(guests[2]!.frames, [[{ type: 'events' }, { type: 'more' }]]);
    assert.deepEqual(host.frames, []);

    room.message(guests[1]!, JSON.stringify([{ type: 'input', key: 'secret' }]), 20);
    assert.deepEqual(host.frames, [[2, [{ type: 'input', key: 'secret' }]]]);
    // Not one byte of it went to the other guests.
    assert.equal(guests[0]!.frames.length, 1);
    assert.equal(guests[2]!.frames.length, 1);
    assert.deepEqual(room.stats, { relayed: 3, dropped: 0 });
  });

  it('stamps the sender itself: nothing a guest writes changes who the host is told it came from', () => {
    const { room, host, guests } = openRoom(2);
    host.frames.length = 0;
    // A guest dressing its frame up as the host's, as another guest's, and as a control frame.
    room.message(guests[0]!, JSON.stringify([[2, [{ type: 'input' }]]]), 1);
    room.message(guests[0]!, JSON.stringify([2, [{ type: 'input' }]]), 2);
    room.message(guests[0]!, JSON.stringify({ relay: 'bye' }), 3);
    room.message(guests[0]!, '[1],[2,[{"type":"input"}]', 4);
    for (const frame of host.frames) assert.equal((frame as unknown[])[0], 1, 'every frame the host got is stamped 1');
    assert.equal(host.frames.length, 2);
    assert.equal(guests[1]!.frames.length, 1, 'the other guest heard nothing');
    assert.equal(host.closed, null);
    assert.equal(guests[1]!.closed, null);
    assert.equal(room.stats.dropped, 2);
  });

  it('throws away what is not a frame, and goes on', () => {
    const { room, host, guests } = openRoom(1);
    guests[0]!.frames.length = 0;
    room.message(host, 'not json', 1);
    room.message(host, JSON.stringify('text'), 2);
    room.message(host, JSON.stringify([[1, 'not a list']]), 3);
    room.message(host, JSON.stringify([[9, [{}]]]), 4);
    room.message(host, JSON.stringify({ relay: 'unknown' }), 5);
    assert.deepEqual(guests[0]!.frames, []);
    assert.equal(room.stats.dropped, 5);
    room.message(host, JSON.stringify([[1, [{ ok: true }]]]), 6);
    assert.deepEqual(guests[0]!.frames, [[{ ok: true }]]);
  });
});

describe('the caps', () => {
  it('seats three guests and turns a fourth away, with the reason', () => {
    const { room, host } = openRoom(MAXIMUM_GUESTS);
    const fifth = fakeWire();
    assert.equal(room.connect(fifth, 'guest', null, 0), null);
    assert.deepEqual(fifth.closed, { code: CLOSE.full, reason: 'full' });
    assert.equal(room.size, 4);
    assert.equal(host.frames.filter((frame) => (frame as { relay?: string }).relay === 'joined').length, 3);
  });

  it('has one host: a second is turned away, whatever key it holds', () => {
    const { room } = openRoom();
    for (const key of [OTHER_KEY, HOST_KEY]) {
      const second = fakeWire();
      assert.equal(room.connect(second, 'host', key, 0), null);
      assert.deepEqual(second.closed, { code: CLOSE.taken, reason: 'taken' });
    }
  });

  it('has no room for a guest until a host opens one', () => {
    const room = new RoomLogic();
    const guest = fakeWire();
    assert.equal(room.connect(guest, 'guest', null, 0), null);
    assert.deepEqual(guest.closed, { code: CLOSE.noRoom, reason: 'no-room' });
    assert.equal(room.empty, true);
  });

  it('refuses a role it does not know and a host key that is not one', () => {
    const room = new RoomLogic();
    const stranger = fakeWire();
    assert.equal(room.connect(stranger, 'admin', HOST_KEY, 0), null);
    assert.equal(stranger.closed?.code, CLOSE.badRequest);
    for (const key of [null, 'short', 'has spaces in it, and more']) {
      const host = fakeWire();
      assert.equal(room.connect(host, 'host', key, 0), null);
      assert.equal(host.closed?.code, CLOSE.badRequest);
    }
    assert.equal(room.empty, true);
  });

  it('closes a socket that sends a frame too big, and tells the host the guest went', () => {
    const { room, host, guests } = openRoom(1);
    host.frames.length = 0;
    room.message(guests[0]!, JSON.stringify(['x'.repeat(LIMITS.guestFrameCharacters)]), 1);
    assert.deepEqual(guests[0]!.closed, { code: CLOSE.tooBig, reason: 'too-big' });
    assert.deepEqual(host.frames, [{ relay: 'left', peer: 1 }]);
    // The host may send more than a guest may.
    room.message(host, JSON.stringify([['*', ['x'.repeat(LIMITS.guestFrameCharacters)]]]), 2);
    assert.equal(host.closed, null);
    room.message(host, JSON.stringify([['*', ['x'.repeat(LIMITS.hostFrameCharacters)]]]), 3);
    assert.deepEqual(host.closed, { code: CLOSE.tooBig, reason: 'too-big' });
  });

  it('closes a guest that sends faster than the game ever does, and leaves one at the game\'s pace alone', () => {
    const { room, host, guests } = openRoom(2);
    host.frames.length = 0;
    // Twenty frames a second for a minute: the game's own pace.
    for (let frame = 0; frame < 20 * 60; frame += 1) room.message(guests[0]!, '[1]', frame * 50);
    assert.equal(guests[0]!.closed, null);
    assert.equal(host.frames.length, 1200);
    // A flood: a thousand frames in one second.
    for (let frame = 0; frame < 1000; frame += 1) room.message(guests[1]!, '[1]', 60_000 + frame);
    assert.deepEqual(guests[1]!.closed, { code: CLOSE.tooFast, reason: 'too-fast' });
    const allowed = LIMITS.guestFramesPerSecond * LIMITS.burstSeconds + LIMITS.guestFramesPerSecond;
    assert.ok(host.frames.length - 1200 <= allowed + 1, `the flood got ${host.frames.length - 1200} frames through, at most ${allowed + 1}`);
    assert.deepEqual(host.frames.at(-1), { relay: 'left', peer: 2 });
  });
});

describe('coming and going', () => {
  it('tells the guests when the host drops, keeps the room for it, and gives it back only for the same key', () => {
    const { room, host, guests } = openRoom(2);
    for (const guest of guests) guest.frames.length = 0;
    room.disconnect(host);
    for (const guest of guests) assert.deepEqual(guest.frames, [{ relay: 'host', here: false }]);
    // Meanwhile a guest's frames have nobody to go to.
    room.message(guests[0]!, '[1]', 1);
    assert.equal(room.stats.dropped, 1);

    const stranger = fakeWire();
    assert.equal(room.connect(stranger, 'host', OTHER_KEY, 2), null);
    assert.deepEqual(stranger.closed, { code: CLOSE.taken, reason: 'taken' });

    const back = fakeWire();
    assert.notEqual(room.connect(back, 'host', HOST_KEY, 3), null);
    assert.deepEqual(back.frames, [{ relay: 'hello', role: 'host', peers: [1, 2] }]);
    for (const guest of guests) assert.deepEqual(guest.frames.at(-1), { relay: 'host', here: true });
    room.message(guests[1]!, '[7]', 4);
    assert.deepEqual(back.frames.at(-1), [2, [7]]);
  });

  it('lets a guest in while the host is away, and says the host is not here', () => {
    const { room, host } = openRoom(1);
    room.disconnect(host);
    const late = fakeWire();
    assert.notEqual(room.connect(late, 'guest', null, 1), null);
    assert.deepEqual(late.frames, [{ relay: 'hello', role: 'guest', peer: 2, host: false }]);
  });

  it('tells the host when a guest leaves, and gives the next guest a new number', () => {
    const { room, host, guests } = openRoom(2);
    host.frames.length = 0;
    room.disconnect(guests[0]!);
    assert.deepEqual(host.frames, [{ relay: 'left', peer: 1 }]);
    const next = fakeWire();
    room.connect(next, 'guest', null, 1);
    assert.deepEqual(next.frames, [{ relay: 'hello', role: 'guest', peer: 3, host: true }]);
  });

  it('closes the socket of a guest the host lets go, and no other', () => {
    const { room, host, guests } = openRoom(2);
    host.frames.length = 0;
    room.message(host, JSON.stringify({ relay: 'drop', peer: 1 }), 1);
    assert.deepEqual(guests[0]!.closed, { code: CLOSE.dropped, reason: 'dropped' });
    assert.deepEqual(guests[0]!.frames.at(-1), { relay: 'bye', code: CLOSE.dropped, reason: 'dropped' });
    assert.equal(guests[1]!.closed, null);
    assert.deepEqual(host.frames, [{ relay: 'left', peer: 1 }]);
    // A guest cannot drop anyone: from a guest the same words are thrown away.
    room.message(guests[1]!, JSON.stringify({ relay: 'drop', peer: 0 }), 2);
    assert.equal(host.closed, null);
    assert.equal(room.size, 2);
  });

  it('lets every guest go when the host says bye, and keeps nothing', () => {
    const { room, host, guests } = openRoom(2);
    room.message(host, JSON.stringify({ relay: 'bye' }), 1);
    for (const wire of [host, ...guests]) assert.deepEqual(wire.closed, { code: CLOSE.hostLeft, reason: 'host-left' });
    assert.equal(room.empty, true);
    const guest = fakeWire();
    room.connect(guest, 'guest', null, 2);
    assert.equal(guest.closed?.code, CLOSE.noRoom);
  });

  it('forgets everything once the last socket closes: the code is anyone\'s again', () => {
    const { room, host, guests } = openRoom(1);
    room.disconnect(host);
    room.disconnect(guests[0]!);
    assert.equal(room.empty, true);
    const guest = fakeWire();
    room.connect(guest, 'guest', null, 1);
    assert.equal(guest.closed?.code, CLOSE.noRoom);
    const newHost = fakeWire();
    assert.notEqual(room.connect(newHost, 'host', OTHER_KEY, 2), null);
    const first = fakeWire();
    room.connect(first, 'guest', null, 3);
    assert.deepEqual(first.frames, [{ relay: 'hello', role: 'guest', peer: 1, host: true }]);
  });

  it('comes back from what each socket carries: the same host key, the same numbers', () => {
    const { records, guests } = openRoom(2);
    // The host dropped, then the room slept: only the two guests' records are left.
    const woken = new RoomLogic();
    const wires = [fakeWire(), fakeWire()];
    woken.restore(wires[0]!, records[1]!, 100);
    woken.restore(wires[1]!, records[2]!, 100);
    assert.equal(guests.length, 2);
    const stranger = fakeWire();
    assert.equal(woken.connect(stranger, 'host', OTHER_KEY, 101), null);
    assert.equal(stranger.closed?.code, CLOSE.taken);
    const host = fakeWire();
    assert.notEqual(woken.connect(host, 'host', HOST_KEY, 102), null);
    assert.deepEqual(host.frames, [{ relay: 'hello', role: 'host', peers: [1, 2] }]);
    const third = fakeWire();
    woken.connect(third, 'guest', null, 103);
    assert.deepEqual(third.frames, [{ relay: 'hello', role: 'guest', peer: 3, host: true }]);
    woken.message(wires[1]!, '[5]', 104);
    assert.deepEqual(host.frames.at(-1), [2, [5]]);
  });
});

describe('an idle room', () => {
  it('is closed after three looks with nothing through it, and not while frames pass', () => {
    const { room, host, guests } = openRoom(1);
    // The hellos do not count: only frames from a socket do.
    assert.equal(room.sweep(), true);
    assert.equal(room.sweep(), true);
    room.message(guests[0]!, '[1]', 1);
    assert.equal(room.sweep(), true, 'a frame went through: the count starts over');
    assert.equal(room.sweep(), true);
    assert.equal(room.sweep(), true);
    assert.equal(host.closed, null);
    assert.equal(room.sweep(), false);
    assert.deepEqual(host.closed, { code: CLOSE.idle, reason: 'idle' });
    assert.deepEqual(guests[0]!.closed, { code: CLOSE.idle, reason: 'idle' });
    assert.equal(room.empty, true);
  });

  it('keeps its count through a sleep only if the count is handed back: on memory alone a silent room is never closed', () => {
    const { records } = openRoom(1);
    // What a Durable Object does at a look, when it slept since the last one: a new room, built from its sockets' records.
    const wake = (kept: IdleCount | null): { room: RoomLogic; wires: FakeWire[] } => {
      const room = new RoomLogic();
      const wires = [fakeWire(), fakeWire()];
      room.restore(wires[0]!, records[0]!, 0);
      room.restore(wires[1]!, records[1]!, 0);
      if (kept) room.restoreIdle(kept);
      return { room, wires };
    };
    // On memory alone every look is the first: ten looks, and the silent room is still open.
    for (let look = 0; look < 10; look += 1) {
      const { room, wires } = wake(null);
      assert.equal(room.sweep(), true);
      assert.equal(wires[0]!.closed, null);
    }
    // With the count kept and handed back, the third look closes it.
    let kept: IdleCount = { quietSweeps: 0, sawFrame: false };
    for (let look = 1; look < LIMITS.quietSweeps; look += 1) {
      const { room, wires } = wake(kept);
      assert.equal(room.sweep(), true);
      assert.equal(wires[0]!.closed, null);
      kept = room.idle;
      assert.deepEqual(kept, { quietSweeps: look, sawFrame: false });
    }
    const last = wake(kept);
    assert.equal(last.room.sweep(), false);
    assert.deepEqual(last.wires.map((wire) => wire.closed), [{ code: CLOSE.idle, reason: 'idle' }, { code: CLOSE.idle, reason: 'idle' }]);
  });

  it('remembers through a sleep that a frame went by: the look after it starts the count over', () => {
    const { room, guests, records } = openRoom(1);
    room.sweep();
    room.sweep();
    assert.deepEqual(room.idle, { quietSweeps: 2, sawFrame: false });
    room.message(guests[0]!, '[1]', 1);
    assert.deepEqual(room.idle, { quietSweeps: 2, sawFrame: true });
    // The room sleeps and wakes for its look with the count it was keeping.
    const woken = new RoomLogic();
    const wires = [fakeWire(), fakeWire()];
    woken.restore(wires[0]!, records[0]!, 0);
    woken.restore(wires[1]!, records[1]!, 0);
    woken.restoreIdle(room.idle);
    assert.equal(woken.sweep(), true);
    assert.deepEqual(woken.idle, { quietSweeps: 0, sawFrame: false });
    assert.equal(wires[0]!.closed, null);
    // A count that is not a count is read as none.
    woken.restoreIdle({ quietSweeps: Number.NaN, sawFrame: 'yes' } as unknown as IdleCount);
    assert.deepEqual(woken.idle, { quietSweeps: 0, sawFrame: false });
  });

  it('with nobody in it needs no more looks', () => {
    assert.equal(new RoomLogic().sweep(), false);
  });
});

describe('room codes', () => {
  it('are six characters that neither look nor sound alike', () => {
    assert.equal(ROOM_CODE_ALPHABET.length, new Set(ROOM_CODE_ALPHABET).size);
    for (const confusable of '0O1IB8S5Z2AEUCDGPVN') assert.equal(ROOM_CODE_ALPHABET.includes(confusable), false, confusable);
    let seed = 12345;
    const draw = (): number => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000;
    const codes = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      const code = makeRoomCode(draw);
      assert.match(code, ROOM_CODE_PATTERN);
      codes.add(code);
    }
    assert.ok(codes.size > 190);
    assert.match(makeRoomCode(() => 0.999999999), ROOM_CODE_PATTERN);
    // Guessing one live room among 17^6 codes: over 24 million.
    assert.ok(ROOM_CODE_ALPHABET.length ** 6 > 24_000_000);
  });

  it('are read however they were typed: small letters, a dash, spaces', () => {
    assert.equal(readRoomCode('fhj-k3m'), 'FHJK3M');
    assert.equal(readRoomCode(' FHJ K3M '), 'FHJK3M');
    assert.equal(readRoomCode('FHJK3'), null);
    assert.equal(readRoomCode('FHJK3MM'), null);
    assert.equal(readRoomCode('ABCDEF'), null);
    assert.equal(readRoomCode(''), null);
  });
});

describe('where a connection comes from', () => {
  const allowed = 'https://sigouin.net,http://localhost:*,http://127.0.0.1:*';
  it('lets in the site and this computer, on any port', () => {
    for (const origin of ['https://sigouin.net', 'http://localhost:5222', 'http://localhost', 'http://127.0.0.1:5230']) {
      assert.equal(originAllowed(origin, allowed), true, origin);
    }
  });
  it('turns away everything else, and a connection that does not say', () => {
    for (const origin of [
      null, '', 'null', 'https://evil.example', 'http://sigouin.net', 'https://sigouin.net.evil.example', 'https://evil-sigouin.net',
      'http://localhost.evil.example', 'http://localhost:5222.evil.example', 'http://localhost:evil', 'https://localhost:5222',
    ]) {
      assert.equal(originAllowed(origin, allowed), false, String(origin));
    }
  });
});
