/**
 * The real Worker and its Durable Object, run locally by wrangler (workerd),
 * dialled with real WebSockets. Run: npm test
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { CLOSE, LIMITS, RELAY_PROTOCOL } from '../src/room.ts';
import { dial, freshCode, pause, startRelay } from './support.ts';
import type { LocalRelay } from './support.ts';

const PORT = 8793;
const QUICK_PORT = 8794;
const HOST_KEY = 'host-key-0123456789';
const OTHER_KEY = 'other-key-0123456789';

let relay: LocalRelay;
/** The same Worker with the idle look every second, so the idle cap can be seen in a test. */
let quick: LocalRelay;

before(async () => {
  [relay, quick] = await Promise.all([startRelay(PORT), startRelay(QUICK_PORT, { IDLE_SWEEP_SECONDS: '1' })]);
});
after(async () => {
  await Promise.all([relay?.stop(), quick?.stop()]);
});

describe('the Worker\'s door', () => {
  it('answers a plain request with words, and nothing else with a socket', async () => {
    const health = await fetch(`http://localhost:${PORT}/health`);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), 'portage relay: ok\n');
    assert.equal((await fetch(`http://localhost:${PORT}/room/FHJKLM?role=host`)).status, 426);
    assert.equal((await fetch(`http://localhost:${PORT}/`)).status, 404);
    assert.equal((await fetch(`http://localhost:${PORT}/rooms`)).status, 404);
  });

  it('turns away a page from somewhere else, a connection that names no page, a bad code and another protocol', async () => {
    const refused = [
      dial(PORT, freshCode(), 'host', { key: HOST_KEY, origin: 'https://evil.example' }),
      dial(PORT, freshCode(), 'host', { key: HOST_KEY, origin: 'https://sigouin.net.evil.example' }),
      dial(PORT, freshCode(), 'host', { key: HOST_KEY, origin: null }),
      dial(PORT, 'ABCDEF', 'host', { key: HOST_KEY }),
      dial(PORT, 'fhjklm', 'host', { key: HOST_KEY }),
      dial(PORT, freshCode(), 'host', { protocols: ['some-other-protocol'] }),
    ];
    for (const socket of refused) {
      await assert.rejects(socket.opened);
      assert.equal(socket.frames.length, 0);
    }
  });

  it('lets in the site itself and this computer', async () => {
    for (const origin of ['https://sigouin.net', 'http://localhost:5222', 'http://127.0.0.1:5230']) {
      const host = dial(PORT, freshCode(), 'host', { key: HOST_KEY, origin });
      await host.opened;
      assert.equal(host.socket.protocol, RELAY_PROTOCOL);
      host.socket.close();
      await host.closed;
    }
  });
});

describe('a room on the real Worker', () => {
  it('carries the host\'s messages to one guest or all, and each guest\'s to the host alone', async () => {
    const code = freshCode();
    const host = dial(PORT, code, 'host', { key: HOST_KEY });
    await host.until(1);
    const ann = dial(PORT, code, 'guest');
    await ann.until(1);
    const bo = dial(PORT, code, 'guest');
    await bo.until(1);
    await host.until(3);
    assert.deepEqual(host.frames, [{ relay: 'hello', role: 'host', peers: [] }, { relay: 'joined', peer: 1 }, { relay: 'joined', peer: 2 }]);
    assert.deepEqual(ann.frames, [{ relay: 'hello', role: 'guest', peer: 1, host: true }]);
    assert.deepEqual(bo.frames, [{ relay: 'hello', role: 'guest', peer: 2, host: true }]);

    host.send([[2, [{ type: 'state', n: 1 }]], ['*', [{ type: 'events' }]]]);
    await ann.until(2);
    await bo.until(3);
    assert.deepEqual(ann.frames.slice(1), [[{ type: 'events' }]]);
    assert.deepEqual(bo.frames.slice(1), [[{ type: 'state', n: 1 }], [{ type: 'events' }]]);

    ann.send([{ type: 'join', key: 'ann-secret' }]);
    bo.send([{ type: 'input' }]);
    await host.until(5);
    assert.deepEqual(new Set(host.frames.slice(3).map((frame) => JSON.stringify(frame))), new Set([
      JSON.stringify([1, [{ type: 'join', key: 'ann-secret' }]]), JSON.stringify([2, [{ type: 'input' }]]),
    ]));
    await pause(200);
    assert.equal(ann.frames.length, 2, 'a guest never hears another guest');
    assert.equal(bo.frames.length, 3);
    for (const socket of [host, ann, bo]) socket.socket.close();
  });

  it('answers under any path, so it can sit on a route of the site', async () => {
    const code = freshCode();
    const host = dial(PORT, code, 'host', { key: HOST_KEY, path: '/portage/relay' });
    await host.until(1);
    const guest = dial(PORT, code, 'guest');
    await guest.until(1);
    assert.deepEqual(guest.frames, [{ relay: 'hello', role: 'guest', peer: 1, host: true }]);
    host.socket.close();
    guest.socket.close();
  });

  it('turns away a fourth guest, a second host and a guest with a code nobody opened, each with its reason', async () => {
    const code = freshCode();
    const host = dial(PORT, code, 'host', { key: HOST_KEY });
    await host.until(1);
    const guests = [];
    for (let index = 0; index < 3; index += 1) {
      const guest = dial(PORT, code, 'guest');
      await guest.until(1);
      guests.push(guest);
    }

    const fourth = dial(PORT, code, 'guest');
    assert.deepEqual(await fourth.letGo(), { code: CLOSE.full, reason: 'full' });
    const second = dial(PORT, code, 'host', { key: OTHER_KEY });
    assert.deepEqual(await second.letGo(), { code: CLOSE.taken, reason: 'taken' });
    const lost = dial(PORT, freshCode(), 'guest');
    assert.deepEqual(await lost.letGo(), { code: CLOSE.noRoom, reason: 'no-room' });
    const keyless = dial(PORT, freshCode(), 'host');
    assert.equal((await keyless.letGo()).code, CLOSE.badRequest);

    // One guest leaves: the seat is free again.
    guests[0]!.socket.close();
    await host.until(5);
    assert.deepEqual(host.frames.at(-1), { relay: 'left', peer: 1 });
    const next = dial(PORT, code, 'guest');
    await next.until(1);
    assert.deepEqual(next.frames, [{ relay: 'hello', role: 'guest', peer: 4, host: true }]);
    for (const socket of [host, next, guests[1]!, guests[2]!]) socket.socket.close();
  });

  it('closes a guest that sends too much or too fast, and the room goes on', async () => {
    const code = freshCode();
    const host = dial(PORT, code, 'host', { key: HOST_KEY });
    await host.until(1);
    const big = dial(PORT, code, 'guest');
    await big.until(1);
    big.send(['x'.repeat(LIMITS.guestFrameCharacters)]);
    assert.deepEqual(await big.letGo(), { code: CLOSE.tooBig, reason: 'too-big' });

    const fast = dial(PORT, code, 'guest');
    await fast.until(1);
    for (let frame = 0; frame < 600; frame += 1) fast.send([frame]);
    assert.deepEqual(await fast.letGo(), { code: CLOSE.tooFast, reason: 'too-fast' });
    const through = host.frames.filter((frame) => Array.isArray(frame) && frame[0] === 2).length;
    assert.ok(through >= 100 && through <= 200, `${through} frames of the flood got through`);

    const steady = dial(PORT, code, 'guest');
    await steady.until(1);
    steady.send([{ still: 'working' }]);
    await host.until(host.frames.length + 1);
    assert.deepEqual(host.frames.at(-1), [3, [{ still: 'working' }]]);
    host.socket.close();
    steady.socket.close();
  });

  it('gives the room back to a host that drops and returns with its key, and to nobody else', async () => {
    const code = freshCode();
    const host = dial(PORT, code, 'host', { key: HOST_KEY });
    await host.until(1);
    const guest = dial(PORT, code, 'guest');
    await guest.until(1);
    host.socket.close();
    await guest.until(2);
    assert.deepEqual(guest.frames.at(-1), { relay: 'host', here: false });

    const stranger = dial(PORT, code, 'host', { key: OTHER_KEY });
    assert.deepEqual(await stranger.letGo(), { code: CLOSE.taken, reason: 'taken' });
    const back = dial(PORT, code, 'host', { key: HOST_KEY });
    await back.until(1);
    assert.deepEqual(back.frames, [{ relay: 'hello', role: 'host', peers: [1] }]);
    await guest.until(3);
    assert.deepEqual(guest.frames.at(-1), { relay: 'host', here: true });

    // The host says goodbye: the guest is let go with the reason, and the code is nobody's.
    back.send({ relay: 'bye' });
    assert.deepEqual(await guest.letGo(), { code: CLOSE.hostLeft, reason: 'host-left' });
    assert.equal((await back.letGo()).code, CLOSE.hostLeft);
    const late = dial(PORT, code, 'guest');
    assert.deepEqual(await late.letGo(), { code: CLOSE.noRoom, reason: 'no-room' });
  });

  it('sleeps when nobody talks and wakes with the room whole: the numbers, the host\'s key, the way through', async () => {
    const code = freshCode();
    const host = dial(PORT, code, 'host', { key: HOST_KEY });
    await host.until(1);
    const guest = dial(PORT, code, 'guest');
    await guest.until(1);
    host.socket.close();
    await guest.until(2);
    // Longer than the ten seconds after which a quiet Durable Object is put to sleep.
    await pause(12_500);
    const stranger = dial(PORT, code, 'host', { key: OTHER_KEY });
    assert.deepEqual(await stranger.letGo(), { code: CLOSE.taken, reason: 'taken' }, 'the key that opened the room is still the only one');
    const back = dial(PORT, code, 'host', { key: HOST_KEY });
    await back.until(1);
    assert.deepEqual(back.frames, [{ relay: 'hello', role: 'host', peers: [1] }]);
    guest.send([{ after: 'sleep' }]);
    await back.until(2);
    assert.deepEqual(back.frames.at(-1), [1, [{ after: 'sleep' }]]);
    const second = dial(PORT, code, 'guest');
    await second.until(1);
    assert.deepEqual(second.frames, [{ relay: 'hello', role: 'guest', peer: 2, host: true }]);
    for (const socket of [back, guest, second]) socket.socket.close();
  });
});

describe('an idle room on the real Worker', () => {
  it('is closed once nothing has gone through it for three looks, while a room in use stays open', async () => {
    const quiet = freshCode();
    const busy = freshCode();
    const quietHost = dial(QUICK_PORT, quiet, 'host', { key: HOST_KEY });
    const busyHost = dial(QUICK_PORT, busy, 'host', { key: HOST_KEY });
    await quietHost.until(1);
    await busyHost.until(1);
    const quietGuest = dial(QUICK_PORT, quiet, 'guest');
    const busyGuest = dial(QUICK_PORT, busy, 'guest');
    await quietGuest.until(1);
    await busyGuest.until(1);
    const started = Date.now();
    const talk = setInterval(() => busyGuest.send([{ still: 'here' }]), 300);
    try {
      assert.deepEqual(await quietHost.letGo(), { code: CLOSE.idle, reason: 'idle' });
      assert.deepEqual(await quietGuest.letGo(), { code: CLOSE.idle, reason: 'idle' });
      const seconds = (Date.now() - started) / 1000;
      assert.ok(seconds > 2 && seconds < 6, `closed after ${seconds.toFixed(1)} s`);
      // And the close itself follows, with the same code.
      assert.equal((await quietHost.closed).code, CLOSE.idle);
      await pause(2500);
      assert.equal(busyHost.socket.readyState, WebSocket.OPEN);
      assert.equal(busyGuest.socket.readyState, WebSocket.OPEN);
    } finally {
      clearInterval(talk);
    }
    // The closed code is nobody's now.
    const late = dial(QUICK_PORT, quiet, 'guest');
    assert.deepEqual(await late.letGo(), { code: CLOSE.noRoom, reason: 'no-room' });
    busyHost.socket.close();
    busyGuest.socket.close();
  });
});
