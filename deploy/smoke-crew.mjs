// Two browsers share a canoe through the relay, by the lobby's own buttons.
//
//   node deploy/smoke-crew.mjs https://sigouin.net/portage/
//
// One browser hosts a crew and copies the invite link. A second, with nothing in common with the first, opens
// the link and types a name. Each must then see the other paddle. Both are headless and small, and both are
// closed at the end: the room is gone with them, and no save of Luc's is touched (each profile is new).
import { chromium } from '/Users/ls/Claude-Workspace/personal/portage/e2e/node_modules/@playwright/test/index.mjs';

const [base] = process.argv.slice(2);
if (!base || !/^https?:\/\/.+\/$/.test(base)) {
  console.error('usage: node smoke-crew.mjs <address of the game, ending in a slash>');
  process.exit(2);
}
const SMALL = { width: 800, height: 450 };
const CODE_SHOWN = /^[FHJKLMQRTWXY34679]{3}-[FHJKLMQRTWXY34679]{3}$/;
const problems = [];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

async function arrive(address, who) {
  const context = await browser.newContext({ viewport: SMALL, deviceScaleFactor: 1, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const sockets = [];
  page.on('websocket', (socket) => sockets.push(socket.url()));
  page.on('console', (message) => { if (message.type() === 'error') problems.push(`${who} console error: ${message.text()}`); });
  page.on('pageerror', (error) => problems.push(`${who} pageerror: ${error.message}`));
  await page.goto(address);
  await page.waitForFunction(() => window.portage !== undefined, null, { timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.iw-lobby-col .iw-mi').first().waitFor({ timeout: 30_000 });
  return { page, sockets };
}
const inGame = (page) => page.waitForFunction(() => window.portage.session.screen === 'game', null, { timeout: 30_000 });
const read = (page) => page.evaluate(() => {
  const { session } = window.portage;
  const game = session.game;
  return {
    role: session.host ? 'host' : session.guest ? 'guest' : 'solo',
    x: game.canoe.position.x,
    z: game.canoe.position.z,
    players: game.players.map((player) => ({ name: player.name, connected: player.connected, paddling: player.paddling })),
    mismatches: session.guest ? session.guest.mismatches : 0,
  };
});
const apart = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
async function until(what, test, milliseconds = 15_000) {
  const end = Date.now() + milliseconds;
  for (;;) {
    if (await test()) return;
    if (Date.now() > end) throw new Error(`never happened: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
const must = (truth, words) => { if (!truth) throw new Error(words); };

let line = '';
let failure = '';
try {
  // --- The host opens a room and copies the link ---------------------------------------
  const host = await arrive(base, 'host');
  await host.page.getByRole('button', { name: 'Host a crew' }).click({ timeout: 10_000 });
  const card = host.page.locator('.iw-panel-crew_host');
  await card.getByLabel('Your name').fill('Host');
  await card.getByRole('button', { name: 'Open a room' }).click();
  await card.locator('.iw-code').waitFor({ timeout: 20_000 });
  const shown = await card.locator('.iw-code').innerText();
  must(CODE_SHOWN.test(shown), `the room card shows "${shown}", not a crew code`);
  const code = shown.replace('-', '');
  await card.getByRole('button', { name: 'Copy link' }).click();
  await card.getByRole('button', { name: 'Copied' }).waitFor({ timeout: 5000 });
  const link = await host.page.evaluate(() => navigator.clipboard.readText());
  must(link === `${base}?invite=${code}`, `the copied link is ${link}, not ${base}?invite=${code}`);
  await card.getByRole('button', { name: 'New Game' }).click();
  await host.page.locator('.iw-panel-save_slots').getByRole('button', { name: 'New game here' }).first().click();
  await inGame(host.page);
  must((await read(host.page)).role === 'host', 'the first browser is not the host');

  // --- A second browser opens the link, types a name, and is in the canoe --------------
  const began = Date.now();
  const guest = await arrive(link, 'guest');
  const joinCard = guest.page.locator('.iw-panel-crew_join');
  await joinCard.waitFor({ timeout: 10_000 });
  must(await joinCard.getByLabel('Crew code').inputValue() === shown, 'the link did not fill in the crew code');
  await guest.page.keyboard.type('Guest');
  await guest.page.keyboard.press('Enter');
  await inGame(guest.page);
  const joined = (Date.now() - began) / 1000;
  await until('two in the crew list, on both screens', async () =>
    await host.page.locator('.iw-crew .iw-mate').count() === 2 && await guest.page.locator('.iw-crew .iw-mate').count() === 2);
  must((await read(guest.page)).role === 'guest', 'the second browser is not a guest');
  const names = (await read(host.page)).players.map((player) => player.name).join(', ');
  must(names === 'Host, Guest', `the host's crew is "${names}"`);

  // --- Each sees the other paddle -----------------------------------------------------------
  const afloat = await read(host.page);
  await host.page.keyboard.down('w');
  await host.page.waitForTimeout(2500);
  await host.page.keyboard.up('w');
  await host.page.waitForTimeout(600);
  const onHost = await read(host.page);
  const onGuest = await read(guest.page);
  const hostPaddled = apart(onHost, afloat);
  const guestSaw = apart(onGuest, afloat);
  must(hostPaddled > 1, `the host paddled and the canoe moved ${hostPaddled.toFixed(1)} m`);
  must(guestSaw > hostPaddled * 0.7, `the host paddled ${hostPaddled.toFixed(1)} m and the guest saw ${guestSaw.toFixed(1)} m`);
  await guest.page.keyboard.down('w');
  await until('the host sees the guest paddle', async () => (await read(host.page)).players[1].paddling === true);
  await guest.page.waitForTimeout(2000);
  await guest.page.keyboard.up('w');
  await until('the host sees the guest stop', async () => (await read(host.page)).players[1].paddling === false);
  const guestPaddled = apart(await read(host.page), onHost);
  must(guestPaddled > 1, `the guest paddled and the host's canoe moved ${guestPaddled.toFixed(1)} m`);

  // --- Both went through the relay, each once, and nothing went wrong on the way ---------------
  const scheme = base.startsWith('https') ? 'wss://' : 'ws://';
  const rooms = (seat) => seat.sockets.filter((address) => address.includes('/room/'));
  must(rooms(host).length === 1 && rooms(host)[0].startsWith(scheme) && rooms(host)[0].endsWith(`/room/${code}?role=host`), `the host dialled ${rooms(host).join(' ') || 'nothing'}`);
  must(rooms(guest).length === 1 && rooms(guest)[0].startsWith(scheme) && rooms(guest)[0].endsWith(`/room/${code}?role=guest`), `the guest dialled ${rooms(guest).join(' ') || 'nothing'}`);
  const mismatches = (await read(guest.page)).mismatches;
  must(mismatches === 0, `the guest's game fell out of step with the host's ${mismatches} times`);
  line = `crew: a guest joined by the link in ${joined.toFixed(1)} s through ${rooms(host)[0].replace(/\/room\/.*$/, '')}; the host paddled ${hostPaddled.toFixed(1)} m and the guest saw ${guestSaw.toFixed(1)} m; the guest paddled ${guestPaddled.toFixed(1)} m; console problems ${problems.length}`;
} catch (error) {
  failure = error.message.split('\n')[0];
}
await browser.close();
if (line) console.log(line);
for (const problem of problems.slice(0, 5)) console.log(`  ${problem.slice(0, 220)}`);
if (failure) console.log(`  ${failure}`);
const ok = failure === '' && problems.length === 0;
console.log(ok ? 'CREW SMOKE PASS' : 'CREW SMOKE FAIL');
process.exit(ok ? 0 : 1);
