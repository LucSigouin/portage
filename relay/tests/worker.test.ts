/**
 * The real Worker and its Durable Object, run locally by wrangler (workerd),
 * dialled with real WebSockets. Run: npm test
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { DIALS_PER_MINUTE, DIAL_WINDOW_SECONDS, TOO_MANY_DIALS } from '../src/dial.ts';
import { CLOSE, LIMITS, RELAY_PROTOCOL } from '../src/room.ts';
import { awayFromTheMinuteTurn, dial, freshAddress, freshCode, freshLine, knock, pause, startRelay } from './support.ts';
import type { Dialed, Knock, LocalRelay } from './support.ts';

const PORT = 8793;
const QUICK_PORT = 8794;
const SLOW_PORT = 8795;
/** Seconds between looks on the slow relay: longer than the ten seconds after which a quiet Durable Object is put to sleep. */
const SLOW_LOOK_SECONDS = 13;
const HOST_KEY = 'host-key-0123456789';
const OTHER_KEY = 'other-key-0123456789';
/** The names two of the relays are given, as the deploy gives one to each upload: a commit and a time. */
const OLD_BUILD = '1111111-20261113T101010Z';
const NEW_BUILD = '2222222-20261113T111111Z';
const DEPLOY_FOLDER = `${import.meta.dirname}/../../deploy`;

/**
 * Addresses the dial limit's tests dial from: one per test, and new ones every run, so that no count leaks
 * from one test into another or from the last run into this one (the local counter keeps its counts on disk).
 * They are from ranges set aside for tests and examples (198.18.0.0/15, 2001:db8::/32): nobody's real address.
 * Every other test dials from this computer, which the relay never limits.
 */
const LINE = freshLine();
const ADDRESS = {
  early: freshAddress(), script: freshAddress(), loud: freshAddress(), neighbour: freshAddress(), house: freshAddress(),
  six: `${LINE}::1`, sixSameLine: `${LINE}:ffff:ffff:ffff:9`, sixNextLine: `${freshLine()}::1`,
};

/** Dial `dials` times from one address, one after the other and as fast as the relay answers, each to a code nobody opened. */
async function flood(port: number, address: string | undefined, dials: number): Promise<Knock[]> {
  const answers: Knock[] = [];
  for (let count = 0; count < dials; count += 1) answers.push(await knock(port, freshCode(), 'guest', { address }));
  return answers;
}
const letIn = (answers: Knock[]): number => answers.filter((answer) => answer.status === 101).length;
const REFUSED: Knock = { status: 429, words: TOO_MANY_DIALS, retryAfter: String(DIAL_WINDOW_SECONDS) };

/** One address used up its minute before any test began. The last test of this file sees it let in again. */
let early: { letIn: number; refused: number; stillRefused: boolean; at: number };

/** Run one of the deploy's programs, and give its exit code and its words. */
function run(program: string, ...args: string[]): Promise<{ code: number; words: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [`${DEPLOY_FOLDER}/${program}`, ...args], { timeout: 60_000 }, (error, stdout, stderr) => {
      resolve({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : -1, words: `${stdout}${stderr}`.trim() });
    });
  });
}

let relay: LocalRelay;
/** The same Worker with the idle look every second, so the idle cap can be seen in a test. */
let quick: LocalRelay;
/** And with looks further apart than the room's sleep, as they are for real (ten minutes): each look is a new waking. */
let slow: LocalRelay;

before(async () => {
  [relay, quick, slow] = await Promise.all([
    startRelay(PORT),
    startRelay(QUICK_PORT, { IDLE_SWEEP_SECONDS: '1', BUILD: OLD_BUILD }),
    startRelay(SLOW_PORT, { IDLE_SWEEP_SECONDS: String(SLOW_LOOK_SECONDS), BUILD: NEW_BUILD }),
  ]);
  await awayFromTheMinuteTurn(10);
  const answers = await flood(PORT, ADDRESS.early, DIALS_PER_MINUTE + 20);
  const at = Date.now();
  await pause(2000);
  const later = await knock(PORT, freshCode(), 'guest', { address: ADDRESS.early });
  early = { letIn: letIn(answers), refused: answers.length - letIn(answers), stillRefused: later.status === 429, at };
});
after(async () => {
  await Promise.all([relay?.stop(), quick?.stop(), slow?.stop()]);
});

describe('the Worker\'s door', () => {
  it('answers a plain request with words, and nothing else with a socket', async () => {
    const health = await fetch(`http://localhost:${PORT}/health`);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), 'portage relay: ok\nbuild local\n');
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

describe('which build answers', () => {
  it('is the second line of /health, under the same first line as ever', async () => {
    const words = async (port: number): Promise<string> => (await fetch(`http://localhost:${port}/portage/relay/health`)).text();
    assert.equal(await words(PORT), 'portage relay: ok\nbuild local\n');
    assert.equal(await words(QUICK_PORT), `portage relay: ok\nbuild ${OLD_BUILD}\n`);
    assert.equal(await words(SLOW_PORT), `portage relay: ok\nbuild ${NEW_BUILD}\n`);
  });

  it('lets the deploy\'s wait tell the new relay from the old: it passes on the build asked for and on no other', async () => {
    const fresh = await run('wait-relay.mjs', `http://localhost:${SLOW_PORT}/health`, NEW_BUILD, '20');
    assert.equal(fresh.code, 0, fresh.words);
    assert.match(fresh.words, new RegExp(`^relay build: ${NEW_BUILD} answers at .*3 times in a row`));

    // The old relay says "ok" just as well. That was all the deploy used to wait for.
    const stale = await run('wait-relay.mjs', `http://localhost:${QUICK_PORT}/health`, NEW_BUILD, '3');
    assert.equal(stale.code, 1, stale.words);
    assert.match(stale.words, new RegExp(`NOT the new one\\. Wanted build ${NEW_BUILD}\\..* still says: build ${OLD_BUILD}$`));

    // The relay that is live today names no build at all: the first deploy of this code must not take it for the new one.
    const unnamed = createServer((_request, response) => response.end('portage relay: ok\n'));
    await new Promise<void>((resolve) => unnamed.listen(0, '127.0.0.1', resolve));
    try {
      const before = await run('wait-relay.mjs', `http://127.0.0.1:${(unnamed.address() as AddressInfo).port}/health`, NEW_BUILD, '3');
      assert.equal(before.code, 1, before.words);
      assert.match(before.words, /still says: a relay that names no build/);
    } finally {
      unnamed.close();
    }
    // And nothing at all at the address is not the new relay either.
    const nothing = await run('wait-relay.mjs', 'http://127.0.0.1:9/health', NEW_BUILD, '2');
    assert.equal(nothing.code, 1, nothing.words);
  });

  it('lets the deploy\'s smoke test refuse to run against another build, and pass on the right one', async () => {
    const right = await run('smoke-relay.mjs', `ws://localhost:${SLOW_PORT}/portage/relay`, 'http://localhost:5222', '--build', NEW_BUILD);
    assert.equal(right.code, 0, right.words);
    assert.match(right.words, new RegExp(`^relay: ws://localhost:${SLOW_PORT}/portage/relay build ${NEW_BUILD}, room opened in \\d+ ms, .* 3 strangers turned away`));
    const wrong = await run('smoke-relay.mjs', `ws://localhost:${QUICK_PORT}/portage/relay`, 'http://localhost:5222', '--build', NEW_BUILD);
    assert.equal(wrong.code, 1, wrong.words);
    assert.match(wrong.words, new RegExp(`not the build just uploaded\\. Wanted ${NEW_BUILD}, .* says: ${OLD_BUILD}`));
    // With no build asked for it still runs, as deploy/deploy.sh and anyone by hand may use it.
    const any = await run('smoke-relay.mjs', `ws://localhost:${QUICK_PORT}`, 'http://localhost:5222');
    assert.equal(any.code, 0, any.words);
  });
});

describe('the dial limit on the real Worker', () => {
  it('is the number the Worker\'s settings give Cloudflare', () => {
    const settings = readFileSync(`${import.meta.dirname}/../wrangler.jsonc`, 'utf8');
    const found = /"ratelimits":\s*\[\{\s*"name":\s*"DIALS",\s*"namespace_id":\s*"\d+",\s*"simple":\s*\{\s*"limit":\s*(\d+),\s*"period":\s*(\d+)\s*\}/.exec(settings);
    assert.ok(found, 'wrangler.jsonc has no DIALS rate limit');
    assert.deepEqual([Number(found[1]), Number(found[2])], [DIALS_PER_MINUTE, DIAL_WINDOW_SECONDS]);
  });

  it('stops a script that dials fast: thirty dials are let in, and every one after is refused at the door in plain words', async () => {
    await awayFromTheMinuteTurn(15);
    const answers = await flood(PORT, ADDRESS.script, 200);
    assert.equal(letIn(answers), DIALS_PER_MINUTE, `${letIn(answers)} of 200 dials were let in`);
    assert.ok(answers.slice(0, DIALS_PER_MINUTE).every((answer) => answer.status === 101), 'the first thirty are the ones let in');
    for (const answer of answers.slice(DIALS_PER_MINUTE)) assert.deepEqual(answer, REFUSED);
    // Asking to host changes nothing: the count is the address's, whatever it asks for.
    assert.deepEqual(await knock(PORT, freshCode(), 'host', { key: HOST_KEY, address: ADDRESS.script }), REFUSED);
    // What the door turns away for another reason is not counted, and keeps its own answer.
    assert.equal((await knock(PORT, 'ABCDEF', 'guest', { address: ADDRESS.script })).status, 400);
  });

  it('never lets a refused dial reach a room, and stops nobody at another address', async () => {
    await awayFromTheMinuteTurn(15);
    const code = freshCode();
    const host = dial(PORT, code, 'host', { key: HOST_KEY, address: ADDRESS.neighbour });
    await host.until(1);
    assert.equal(letIn(await flood(PORT, ADDRESS.loud, DIALS_PER_MINUTE)), DIALS_PER_MINUTE);

    // Over its limit, the loud address dials the neighbour's room. The handshake is refused: no socket, no frame.
    const refused = dial(PORT, code, 'guest', { address: ADDRESS.loud });
    await assert.rejects(refused.opened);
    assert.equal(refused.frames.length, 0);
    // The neighbour's own friend gets in at once, and is the room's first guest: the refused dial never got there.
    const guest = dial(PORT, code, 'guest', { address: ADDRESS.neighbour });
    await guest.until(1);
    await host.until(2);
    await pause(300);
    assert.deepEqual(guest.frames, [{ relay: 'hello', role: 'guest', peer: 1, host: true }]);
    assert.deepEqual(host.frames, [{ relay: 'hello', role: 'host', peers: [] }, { relay: 'joined', peer: 1 }]);
    host.socket.close();
    guest.socket.close();
  });

  it('does not stop a real crew: four players behind one address join, drop and rejoin, and one reloads ten times, all inside a minute', async () => {
    const began = Date.now();
    const code = freshCode();
    let dials = 0;
    const seat = async (role: 'host' | 'guest'): Promise<Dialed> => {
      dials += 1;
      const player = dial(PORT, code, role, { key: role === 'host' ? HOST_KEY : undefined, address: ADDRESS.house });
      await player.until(1);
      assert.equal((player.frames[0] as { relay?: string }).relay, 'hello', `dial ${dials} from the house was not seated: ${JSON.stringify(player.frames[0])}`);
      return player;
    };
    const crew = async (): Promise<Dialed[]> => [await seat('host'), await seat('guest'), await seat('guest'), await seat('guest')];
    const leave = async (players: Dialed[]): Promise<void> => {
      for (const player of players) player.socket.close();
      await Promise.all(players.map((player) => player.closed));
    };

    // Everyone joins, the line drops for all four, everyone comes back.
    await leave(await crew());
    const players = await crew();
    const host = players[0]!;
    // One of them cannot sit still: ten reloads, each a new dial.
    let restless = players[3]!;
    for (let reload = 0; reload < 10; reload += 1) {
      await leave([restless]);
      restless = await seat('guest');
    }
    assert.equal(dials, 18);

    // And the room they ended up in works: a message each way.
    const heard = host.frames.length;
    restless.send([{ still: 'paddling' }]);
    await host.until(heard + 1);
    assert.deepEqual((host.frames.at(-1) as unknown[])[1], [{ still: 'paddling' }]);
    host.send([['*', [{ type: 'state' }]]]);
    await restless.until(2);
    assert.deepEqual(restless.frames.at(-1), [{ type: 'state' }]);
    assert.ok(Date.now() - began < 60_000, 'all of it inside a minute');
    await leave([host, players[1]!, players[2]!, restless]);
  });

  it('counts an IPv6 address by its first 64 bits, and never limits this computer', async () => {
    await awayFromTheMinuteTurn(15);
    // One line at home is handed 2^64 addresses. They share one count.
    assert.equal(letIn(await flood(PORT, ADDRESS.six, DIALS_PER_MINUTE)), DIALS_PER_MINUTE);
    assert.deepEqual(await knock(PORT, freshCode(), 'guest', { address: ADDRESS.sixSameLine }), REFUSED);
    assert.equal((await knock(PORT, freshCode(), 'guest', { address: ADDRESS.sixNextLine })).status, 101);
    // This computer, as the local Worker reports it and by either of its names: no limit. Every other test here counts on that.
    for (const address of [undefined, '127.0.0.1', '::1']) {
      assert.equal(letIn(await flood(PORT, address, DIALS_PER_MINUTE + 10)), DIALS_PER_MINUTE + 10, `this computer as ${address ?? 'the Worker sees it'}`);
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

  it('is closed on the real timing too: looks further apart than the room\'s sleep, each one a new waking', async () => {
    // Two rooms. Nothing ever goes through the first. One frame goes through the second, early, and then nothing.
    const silent = freshCode();
    const spoke = freshCode();
    const silentHost = dial(SLOW_PORT, silent, 'host', { key: HOST_KEY });
    const spokeHost = dial(SLOW_PORT, spoke, 'host', { key: HOST_KEY });
    await silentHost.until(1);
    await spokeHost.until(1);
    const silentGuest = dial(SLOW_PORT, silent, 'guest');
    const spokeGuest = dial(SLOW_PORT, spoke, 'guest');
    await silentGuest.until(1);
    await spokeGuest.until(1);
    const started = Date.now();
    const since = (): number => (Date.now() - started) / 1000;
    await pause(1000);
    spokeGuest.send([{ said: 'once' }]);
    await spokeHost.until(3);

    // The silent room: closed at the third look. With the count in memory it was still open at 110 s.
    const looks = LIMITS.quietSweeps * SLOW_LOOK_SECONDS;
    assert.deepEqual(await silentHost.letGo((looks + 12) * 1000), { code: CLOSE.idle, reason: 'idle' });
    const silentSeconds = since();
    assert.deepEqual(await silentGuest.letGo(), { code: CLOSE.idle, reason: 'idle' });
    assert.ok(silentSeconds > looks - 3 && silentSeconds < looks + 10, `the silent room closed after ${silentSeconds.toFixed(1)} s, due at ${looks}`);

    // The other room slept after its one frame, and its first look still knew of it: it gets one look more.
    assert.equal(spokeHost.socket.readyState, WebSocket.OPEN, 'the room a frame went through is closed one look later, not with the silent one');
    assert.equal(spokeGuest.socket.readyState, WebSocket.OPEN);
    assert.deepEqual(await spokeHost.letGo((SLOW_LOOK_SECONDS + 12) * 1000), { code: CLOSE.idle, reason: 'idle' });
    const spokeSeconds = since();
    assert.deepEqual(await spokeGuest.letGo(), { code: CLOSE.idle, reason: 'idle' });
    assert.ok(spokeSeconds > silentSeconds + SLOW_LOOK_SECONDS - 4 && spokeSeconds < looks + SLOW_LOOK_SECONDS + 10,
      `the room that spoke once closed after ${spokeSeconds.toFixed(1)} s, the silent one after ${silentSeconds.toFixed(1)} s`);

    // Both codes are nobody's now, and nothing of either room is left to find.
    for (const code of [silent, spoke]) {
      const late = dial(SLOW_PORT, code, 'guest');
      assert.deepEqual(await late.letGo(), { code: CLOSE.noRoom, reason: 'no-room' });
    }
  });
});

describe('the dial limit, a minute later', () => {
  it('lets an address in again once its minute has passed', async () => {
    assert.equal(early.letIn, DIALS_PER_MINUTE, 'before the tests began it was let in thirty times');
    assert.equal(early.refused, 20, 'and refused twenty');
    assert.ok(early.stillRefused, 'and still refused two seconds later');
    const due = early.at + (DIAL_WINDOW_SECONDS + 1) * 1000;
    if (Date.now() < due) await pause(due - Date.now());
    const waited = (Date.now() - early.at) / 1000;
    const back = await knock(PORT, freshCode(), 'guest', { address: ADDRESS.early });
    assert.equal(back.status, 101, `${waited.toFixed(0)} s after it was stopped the address is still refused: ${back.words}`);
  });
});
