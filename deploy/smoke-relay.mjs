// Dials the relay the way the game does and checks that a crew can meet in a room.
//
//   node deploy/smoke-relay.mjs <relay address> <the page's origin> [--build <name>] [--limit] [--address <address>]
//   node deploy/smoke-relay.mjs wss://sigouin.net/portage/relay https://sigouin.net --build 78b15bf-20261113T140000Z --limit
//
// It opens one room under a random code, passes a message each way, closes the room, and checks that a page
// from somewhere else is turned away. It leaves nothing behind: a room is gone when its last socket closes.
//
// --build <name>     The relay must be this build (the second line of /health), at the start and at the end.
//                    Without it, an old relay passes just as well as the new one.
// --limit            Also dial in a loop, as a script would, until the relay's door refuses (the dial limit),
//                    then wait until it lets this address in again. At most 150 dials, each to a code nobody
//                    opened, and up to 90 s of waiting. This is the one place the limit is seen on Cloudflare itself.
// --address <a>      Only for a relay on this computer (ws://): the address to dial as. The local relay never
//                    limits this computer, so --limit needs it there. Cloudflare sets the address itself.
import { randomBytes } from 'node:crypto';
import { request as plainRequest } from 'node:http';
import { request as secureRequest } from 'node:https';

const args = process.argv.slice(2);
const [relay, origin] = args;
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] ?? '' : null);
const wantBuild = option('--build');
const tryLimit = args.includes('--limit');
const address = option('--address');
if (!relay || !origin || !/^wss?:\/\//.test(relay) || wantBuild === '' || address === '' || (address !== null && relay.startsWith('wss://'))) {
  console.error('usage: node smoke-relay.mjs <ws:// or wss:// relay address> <origin of the game page> [--build <name>] [--limit] [--address <address, ws:// only>]');
  process.exit(2);
}
/** Sent only to a relay on this computer, which believes it. */
const addressHeader = address === null ? {} : { 'CF-Connecting-IP': address };

const PROTOCOL = 'portage-relay.1';
const ALPHABET = 'FHJKLMQRTWXY34679';
const pick = (letters, count) => Array.from({ length: count }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
const WAIT = 15_000;

const fail = (words) => {
  console.error(`relay smoke FAILED: ${words}`);
  process.exit(1);
};

/** One socket, with everything it hears kept in order. */
function dial(code, role, { key, from = origin } = {}) {
  const protocols = [PROTOCOL, ...(key ? [`k.${key}`] : [])];
  const headers = { ...(from === null ? {} : { Origin: from }), ...addressHeader };
  const socket = new WebSocket(`${relay}/room/${code}?role=${role}`, { protocols, headers });
  const frames = [];
  const waiting = [];
  let closed = null;
  socket.addEventListener('message', (event) => {
    frames.push(String(event.data));
    for (const check of waiting.splice(0)) check();
  });
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(true));
    socket.addEventListener('error', () => reject(new Error('refused')));
    socket.addEventListener('close', () => reject(new Error('closed before it opened')));
  });
  opened.catch(() => {});
  const ended = new Promise((resolve) => socket.addEventListener('close', (event) => { closed = event.code; resolve(event.code); }));
  // The code the relay lets this socket go with. The relay says it in a "bye" frame first, as the game reads it:
  // the close itself can take seconds to arrive, and through a relay on this computer its code is sometimes lost.
  const gone = new Promise((resolve) => {
    socket.addEventListener('message', (event) => {
      try {
        const frame = JSON.parse(String(event.data));
        if (frame?.relay === 'bye' && typeof frame.code === 'number') resolve(frame.code);
      } catch { /* not a frame of the relay's */ }
    });
    socket.addEventListener('close', (event) => resolve(event.code));
  });
  /** The first frame, from `start` on, that `test` accepts. */
  const hear = (test, what, start = 0) => new Promise((resolve) => {
    const timer = setTimeout(() => fail(`${role} never heard ${what}. It heard: ${frames.join(' ') || 'nothing'}${closed === null ? '' : ` (closed ${closed})`}`), WAIT);
    const check = () => {
      const found = frames.slice(start).find((text) => { try { return test(JSON.parse(text)); } catch { return false; } });
      if (found === undefined) { waiting.push(check); return; }
      clearTimeout(timer);
      resolve(JSON.parse(found));
    };
    check();
  });
  return { socket, frames, opened, ended, gone, hear };
}

const within = (promise, what) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out: ${what}`)), WAIT)),
]);

// 1. The door: words for a plain request, and no room without a socket.
const door = relay.replace(/^ws/, 'http');
const health = await fetch(`${door}/health`, { cache: 'no-store' }).catch((error) => fail(`nothing answers at ${door}/health (${error.cause?.code ?? error.message})`));
const healthLines = (await health.text()).split('\n').map((line) => line.trim());
if (health.status !== 200 || healthLines[0] !== 'portage relay: ok') fail(`${door}/health answered ${health.status}: ${healthLines.join(' / ').slice(0, 80)}`);
// The second line names the build. An old relay says the first line just as well.
const buildOf = (lines) => /^build (\S+)$/.exec(lines[1] ?? '')?.[1] ?? null;
const build = buildOf(healthLines);
if (wantBuild !== null && build !== wantBuild) fail(`this is not the build just uploaded. Wanted ${wantBuild}, ${door}/health says: ${build ?? 'no build at all (a relay from before builds were named)'}`);
const plain = await fetch(`${door}/room/${pick(ALPHABET, 6)}?role=host`, { cache: 'no-store' });
if (plain.status !== 426) fail(`a plain request for a room answered ${plain.status}, not 426`);

// 2. A room: the host, then a guest, and a message each way.
const code = pick(ALPHABET, 6);
const key = pick('abcdefghijklmnopqrstuvwxyz0123456789', 24);
const began = Date.now();
const host = dial(code, 'host', { key });
await within(host.opened, 'the host\'s socket opening').catch((error) => fail(`the host could not open a room: ${error.message}`));
if (host.socket.protocol !== PROTOCOL) fail(`the relay answered in protocol "${host.socket.protocol}"`);
await host.hear((frame) => frame.relay === 'hello' && frame.role === 'host', 'its hello');
const opened = Date.now() - began;

const guest = dial(code, 'guest');
await within(guest.opened, 'the guest\'s socket opening').catch((error) => fail(`the guest could not join: ${error.message}`));
const hello = await guest.hear((frame) => frame.relay === 'hello' && frame.role === 'guest', 'its hello');
if (hello.host !== true) fail('the guest was not told the host is here');
await host.hear((frame) => frame.relay === 'joined' && frame.peer === hello.peer, 'that a guest joined');

const word = `smoke-${pick(ALPHABET, 8)}`;
const sent = Date.now();
guest.socket.send(JSON.stringify([word]));
await host.hear((frame) => Array.isArray(frame) && frame[0] === hello.peer && Array.isArray(frame[1]) && frame[1][0] === word, 'the guest\'s message, stamped with its number');
host.socket.send(JSON.stringify([['*', [`${word}-back`]]]));
await guest.hear((frame) => Array.isArray(frame) && frame[0] === `${word}-back`, 'the host\'s answer');
const roundTrip = Date.now() - sent;

// 3. A stranger cannot take the host's place: a second host with another key is turned away.
// (That one guest never hears another is proven in relay/tests/room.test.ts, not here.)
const thief = dial(code, 'host', { key: pick('abcdefghijklmnopqrstuvwxyz0123456789', 24) });
const thiefEnd = await within(thief.gone, 'the second host being turned away');
if (thiefEnd === 1000 || thief.frames.some((text) => text.includes('"hello"'))) fail(`a second host with another key was let in (close ${thiefEnd})`);
thief.socket.close();

// 4. The host closes the room: the guest is let go with the reason.
host.socket.send(JSON.stringify({ relay: 'bye' }));
const guestEnd = await within(guest.gone, 'the guest being let go');
if (guestEnd !== 4410) fail(`the guest was let go with ${guestEnd}, not 4410 (host left)`);
guest.socket.close();
await within(host.gone, 'the host being let go');
host.socket.close();

// 5. A page from somewhere else is turned away. So is this computer, on the live relay.
const strangers = ['https://evil.example', `${origin}.evil.example`, null];
if (relay.startsWith('wss://')) strangers.push('http://localhost:5220');
for (const from of strangers) {
  const stranger = dial(pick(ALPHABET, 6), 'host', { key, from });
  const got = await within(stranger.opened.then(() => 'opened', () => 'refused'), `the answer to ${from}`);
  if (got !== 'refused' || stranger.frames.length > 0) {
    stranger.socket.close();
    fail(`a connection from ${from ?? 'no page at all'} was let in`);
  }
}

// 6. The dial limit: a script that dials in a loop is stopped at the door, and the address is let in again later.
/** One dial written by hand, so the status and the words of a refusal can be read. A socket the relay takes is dropped at once. */
function knock() {
  const target = new URL(`${door}/room/${pick(ALPHABET, 6)}?role=guest`);
  const send = target.protocol === 'https:' ? secureRequest : plainRequest;
  return new Promise((resolve) => {
    const dialing = send(target, {
      timeout: WAIT,
      headers: {
        Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
        'Sec-WebSocket-Protocol': PROTOCOL, Origin: origin, ...addressHeader,
      },
    });
    dialing.on('upgrade', (answer, socket) => { socket.destroy(); resolve({ status: answer.statusCode, words: '' }); });
    dialing.on('response', (answer) => {
      let words = '';
      answer.on('data', (chunk) => { words += chunk; });
      answer.on('end', () => resolve({ status: answer.statusCode, words: words.trim().slice(0, 80) }));
    });
    dialing.on('timeout', () => dialing.destroy(new Error('no answer')));
    dialing.on('error', (error) => resolve({ status: 0, words: error.message }));
    dialing.end();
  });
}
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

let limitWords = 'the dial limit was not tried';
if (tryLimit) {
  const MOST = 150;
  let refusal = null;
  let dials = 0;
  while (refusal === null && dials < MOST) {
    dials += 1;
    const answer = await knock();
    if (answer.status !== 101) refusal = answer;
  }
  if (refusal === null) fail(`${MOST} dials in a row from one address were all let in: the dial limit does not work on this relay`);
  const ours = refusal.status === 429 && refusal.words.startsWith('too many dials');
  // A rate rule of Cloudflare's own, in front of the Worker, answers 429 too, in its own words.
  if (refusal.status !== 429) fail(`dial ${dials} of the loop was answered ${refusal.status}: ${refusal.words || 'no words'}. A refusal for dialling too often is a 429.`);
  const stopped = Date.now();
  for (;;) {
    await pause(5000);
    const answer = await knock();
    if (answer.status === 101) break;
    if (Date.now() - stopped > 90_000) fail(`this address is still refused ${Math.round((Date.now() - stopped) / 1000)} s after the loop was stopped (${answer.status}: ${answer.words}). The limit should let up within a minute.`);
  }
  limitWords = `a loop of dials was stopped at dial ${dials} ${ours ? 'by the relay\'s door' : `by a rule in front of the relay ("${refusal.words}"), so the relay's own limit was not reached`}`
    + ` and let in again ${Math.round((Date.now() - stopped) / 1000)} s later`;
}

// The same build must still answer: the old relay and the new one can both be out there for a moment after an upload.
if (wantBuild !== null) {
  const again = await fetch(`${door}/health`, { cache: 'no-store' }).then((answer) => answer.text(), () => '');
  const now = buildOf(again.split('\n').map((line) => line.trim()));
  if (now !== wantBuild) fail(`the build changed under the test. It began on ${wantBuild} and ended on ${now ?? 'a relay that names no build'}`);
}

console.log(`relay: ${relay} build ${build ?? 'not named'}, room opened in ${opened} ms, a message there and back in ${roundTrip} ms, ${strangers.length} strangers turned away, ${limitWords}`);
process.exit(0);
