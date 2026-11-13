// Dials the relay the way the game does and checks that a crew can meet in a room.
//
//   node deploy/smoke-relay.mjs <relay address> <the page's origin>
//   node deploy/smoke-relay.mjs wss://sigouin.net/portage/relay https://sigouin.net
//
// It opens one room under a random code, passes a message each way, closes the room, and checks that a page
// from somewhere else is turned away. It leaves nothing behind: a room is gone when its last socket closes.
const [relay, origin] = process.argv.slice(2);
if (!relay || !origin || !/^wss?:\/\//.test(relay)) {
  console.error('usage: node smoke-relay.mjs <ws:// or wss:// relay address> <origin of the game page>');
  process.exit(2);
}

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
  const headers = from === null ? {} : { Origin: from };
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
  return { socket, frames, opened, ended, hear };
}

const within = (promise, what) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out: ${what}`)), WAIT)),
]);

// 1. The door: words for a plain request, and no room without a socket.
const door = relay.replace(/^ws/, 'http');
const health = await fetch(`${door}/health`, { cache: 'no-store' }).catch((error) => fail(`nothing answers at ${door}/health (${error.cause?.code ?? error.message})`));
const healthWords = (await health.text()).trim();
if (health.status !== 200 || healthWords !== 'portage relay: ok') fail(`${door}/health answered ${health.status}: ${healthWords.slice(0, 80)}`);
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
const thiefEnd = await within(thief.ended, 'the second host being turned away');
if (thiefEnd === 1000 || thief.frames.some((text) => text.includes('"hello"'))) fail(`a second host with another key was let in (close ${thiefEnd})`);

// 4. The host closes the room: the guest is let go with the reason.
host.socket.send(JSON.stringify({ relay: 'bye' }));
const guestEnd = await within(guest.ended, 'the guest being let go');
if (guestEnd !== 4410) fail(`the guest was closed with ${guestEnd}, not 4410 (host left)`);
host.socket.close();
await within(host.ended, 'the host closing');

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

console.log(`relay: ${relay} room opened in ${opened} ms, a message there and back in ${roundTrip} ms, ${strangers.length} strangers turned away`);
process.exit(0);
