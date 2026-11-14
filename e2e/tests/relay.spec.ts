/**
 * Friends join by a link, through the relay. Separate browser profiles (not
 * tabs of one, so the browser's own channel between tabs cannot carry
 * anything) host and join by clicking the lobby's entries. Every message
 * crosses the real Worker, run locally by wrangler.
 *
 * Needs the dev server and the local relay (`relay/`, `npm run dev`, port 8791):
 *   PORTAGE_URL=http://localhost:5222 npm --prefix <worktree>/e2e test -- relay.spec.ts --global-timeout=540000
 *
 * Optional, each with its own server (see `relay/README.md`):
 *   PORTAGE_BARE_URL   a build made with no relay setting, served by `vite preview`
 *   PORTAGE_BUILT_URL  a build made with PORTAGE_RELAY=/relay, served by `vite preview`
 *   PORTAGE_HEADERS    the live site's `_headers` file, for its security policy
 *   RELAY_SHOTS        a folder for pictures at 1920x1080
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';

const BASE = process.env.PORTAGE_URL ?? 'http://localhost:5220';
const BARE = process.env.PORTAGE_BARE_URL ?? '';
const BUILT = process.env.PORTAGE_BUILT_URL ?? '';
const HEADERS = process.env.PORTAGE_HEADERS ?? '';
const SHOTS = process.env.RELAY_SHOTS ?? '';

test.use({
  viewport: { width: 1280, height: 720 },
  // Render on the graphics card: the software fallback runs at about one frame a second.
  launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
});
test.setTimeout(240_000);

const CODE_SHOWN = /^[FHJKLMQRTWXY34679]{3}-[FHJKLMQRTWXY34679]{3}$/;
const SMALL = { width: 800, height: 450 };

interface PlayerView { id: number; name: string; connected: boolean; mode: string; seat: number | null; x: number; z: number; paddling: boolean; driftwood: number }
interface Snapshot {
  screen: string;
  role: 'host' | 'guest' | 'solo';
  localPlayerId: number;
  canoeX: number;
  canoeZ: number;
  players: PlayerView[];
  mismatches: number;
  /** How the crew lobby sees its lines. */
  hosting: string;
  joining: string;
}

function read(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const { session } = (window as unknown as { portage: { session: any } }).portage;
    const game = session.game;
    const crew = session.crew ? session.crew.view() : null;
    return {
      screen: session.screen,
      role: session.host ? 'host' : session.guest ? 'guest' : 'solo',
      localPlayerId: session.localPlayerId,
      canoeX: game ? game.canoe.position.x : 0,
      canoeZ: game ? game.canoe.position.z : 0,
      players: game ? game.players.map((player: any) => ({
        id: player.id, name: player.name, connected: player.connected, mode: player.mode, seat: player.seat,
        x: player.position.x, z: player.position.z, paddling: player.paddling,
        driftwood: player.backpack.filter((stack: any) => stack.itemId === 'driftwood').reduce((sum: number, stack: any) => sum + stack.count, 0),
      })) : [],
      mismatches: session.guest ? session.guest.mismatches : 0,
      hosting: crew ? crew.host.phase : 'none',
      joining: crew ? crew.join.phase : 'none',
    };
  });
}

/** The crew list as drawn: a row a player, with its name and its one tag. */
function crewRows(page: Page): Promise<{ name: string; tag: string; away: boolean }[]> {
  return page.evaluate(() => [...document.querySelectorAll('.iw-crew .iw-mate')].map((row) => ({
    name: row.querySelector('.iw-mate-name')!.firstChild!.textContent ?? '',
    tag: row.querySelector('.iw-mate-name .iw-kind')?.textContent ?? '',
    away: row.classList.contains('iw-away'),
  })));
}

/** Run a script in the page with `portage` and `sim` (the rules engine) in reach. Dev server only. */
function stage(page: Page, body: string): Promise<unknown> {
  return page.evaluate(`(async () => {
    const sim = await import('/src/sim/index.ts');
    const portage = window.portage;
    ${body}
  })()`);
}

interface Seat {
  page: Page;
  /** Every WebSocket address the page dialled. */
  sockets: string[];
  /** Frames the page has sent to the relay, and their characters. */
  sent: { frames: number; characters: number };
}

/** A page in a profile of its own, at the lobby. */
async function arrive(context: BrowserContext, address: string, problems: string[], who: string): Promise<Seat> {
  const page = await context.newPage();
  const sockets: string[] = [];
  const sent = { frames: 0, characters: 0 };
  page.on('websocket', (socket) => {
    sockets.push(socket.url());
    if (!socket.url().includes('/room/')) return;
    socket.on('framesent', (frame) => {
      sent.frames += 1;
      sent.characters += String(frame.payload).length;
    });
  });
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`${who} console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`${who} pageerror: ${error.message}`));
  await page.goto(address);
  await page.waitForFunction(() => (window as unknown as { portage?: unknown }).portage !== undefined);
  await page.evaluate(() => document.fonts.ready);
  // The page's handle is there one frame before the lobby is drawn. A key sent in between lands on nothing:
  // wait for the menu a player would see (an invite link's card is drawn, and given the caret, in the same frame).
  await page.locator('.iw-lobby-col .iw-mi').first().waitFor();
  return { page, sockets, sent };
}

const inGame = (page: Page): Promise<unknown> =>
  page.waitForFunction(() => (window as unknown as { portage: { session: any } }).portage.session.screen === 'game', undefined, { timeout: 30_000 });

async function hold(page: Page, key: string, milliseconds: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(milliseconds);
  await page.keyboard.up(key);
}

/** Host a crew by the lobby's own entries: a name, "Open a room", then a new game from the room card. Returns the code as shown. */
async function hostByClicks(page: Page, name: string, startGame = true): Promise<string> {
  await page.getByRole('button', { name: 'Host a crew' }).click();
  const card = page.locator('.iw-panel-crew_host');
  await expect(card).toBeVisible();
  await card.getByLabel('Your name').fill(name);
  await card.getByRole('button', { name: 'Open a room' }).click();
  await expect(card.locator('.iw-code')).toBeVisible({ timeout: 15_000 });
  const shown = await card.locator('.iw-code').innerText();
  expect(shown).toMatch(CODE_SHOWN);
  if (startGame) {
    await card.getByRole('button', { name: 'New Game' }).click();
    await page.locator('.iw-panel-save_slots').getByRole('button', { name: 'New game here' }).first().click();
    await pick(page);
    await inGame(page);
  }
  return shown;
}

/** The pick screen, after a new game's slot or after Join: press its one button, as whoever is marked. */
async function pick(page: Page): Promise<void> {
  await page.locator('.iw-panel-character_select .cs-start').click();
}

/** Join by the lobby's own entries: "Join a crew", the code, a name, "Join", and then who you are. */
async function joinByClicks(page: Page, code: string, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Join a crew' }).click();
  const card = page.locator('.iw-panel-crew_join');
  await expect(card).toBeVisible();
  await card.getByLabel('Crew code').fill(code);
  await card.getByLabel('Your name').fill(name);
  await card.getByRole('button', { name: 'Join', exact: true }).click();
  await pick(page);
}

const profile = (browser: Browser, viewport = { width: 1280, height: 720 }): Promise<BrowserContext> =>
  browser.newContext({ viewport, permissions: ['clipboard-read', 'clipboard-write'] });

test('friends join by a link: host, copy, open, name, in the canoe; they move, drop, return; four fill it and a fifth is refused', async ({ browser }) => {
  const problems: string[] = [];
  const contexts: BrowserContext[] = [];
  const open = async (viewport?: { width: number; height: number }): Promise<BrowserContext> => {
    const context = await profile(browser, viewport);
    contexts.push(context);
    return context;
  };

  // (Five windows are open by the end. Small ones: this computer has stalled under less.)
  // --- The host clicks "Host a crew" and copies the link -----------------------------
  const hostContext = await open(SMALL);
  const host = await arrive(hostContext, `${BASE}/`, problems, 'host');
  await expect(host.page.getByRole('button', { name: 'Host a crew' })).toBeVisible();
  const shown = await hostByClicks(host.page, 'Luc', false);
  const code = shown.replace('-', '');
  const card = host.page.locator('.iw-panel-crew_host');
  await expect(card.locator('.iw-crew-status')).toHaveText('The room is open. Nobody has come in yet.');
  await card.getByRole('button', { name: 'Copy link' }).click();
  await expect(card.getByRole('button', { name: 'Copied' })).toBeVisible();
  const link = await host.page.evaluate(() => navigator.clipboard.readText());
  expect(link, 'the link on the clipboard').toBe(`${BASE}/?invite=${code}`);
  await expect(card.locator('#iw-invite-link')).toHaveValue(link);
  // The game to share is started from the room card.
  await card.getByRole('button', { name: 'New Game' }).click();
  await host.page.locator('.iw-panel-save_slots').getByRole('button', { name: 'New game here' }).first().click();
  await pick(host.page);
  await inGame(host.page);
  expect(await read(host.page)).toMatchObject({ role: 'host', hosting: 'open' });
  expect(host.sockets.filter((address) => address.includes('/room/')), 'the host dialled the relay once, for its room').toEqual([
    `${BASE.replace(/^http/, 'ws')}/relay/room/${code}?role=host`,
  ]);

  // --- A second profile opens the link, types a name, and is in the canoe ---------------
  const samContext = await open(SMALL);
  let sam = await arrive(samContext, link, problems, 'sam');
  const joinCard = sam.page.locator('.iw-panel-crew_join');
  await expect(joinCard).toBeVisible();
  await expect(joinCard.getByLabel('Crew code')).toHaveValue(shown);
  await expect(joinCard.getByLabel('Your name'), 'the caret is on the empty line').toBeFocused();
  await sam.page.keyboard.type('Sam');
  await sam.page.keyboard.press('Enter');
  // The pick screen. Nothing was dialled for the room yet: the join goes out with the pick. Enter again joins.
  await expect(sam.page.locator('.iw-panel-character_select')).toBeVisible();
  expect(sam.sockets.filter((address) => address.includes('/room/')), 'nothing is dialled before the pick').toEqual([]);
  await sam.page.keyboard.press('Enter');
  await inGame(sam.page);
  await expect(host.page.locator('.iw-crew .iw-mate')).toHaveCount(2);
  await expect(sam.page.locator('.iw-crew .iw-mate')).toHaveCount(2);
  expect(await crewRows(host.page)).toEqual([{ name: 'Luc', tag: 'you', away: false }, { name: 'Sam', tag: '', away: false }]);
  expect(await crewRows(sam.page)).toEqual([{ name: 'Luc', tag: 'host', away: false }, { name: 'Sam', tag: 'you', away: false }]);
  await expect(host.page.locator('.iw-toast', { hasText: 'Sam joined the crew' })).toBeVisible();
  expect(await read(sam.page)).toMatchObject({ role: 'guest', localPlayerId: 1, joining: 'playing' });
  expect(sam.sockets.filter((address) => address.includes('/room/'))).toEqual([`${BASE.replace(/^http/, 'ws')}/relay/room/${code}?role=guest`]);
  // Two profiles share nothing: the guest's browser holds none of the host's saves.
  expect(await sam.page.evaluate(() => Object.keys(localStorage).filter((key) => key.includes('save')))).toEqual([]);

  // --- Each sees the other move -------------------------------------------------------------
  const afloat = await read(host.page);
  await hold(host.page, 'w', 2500);
  await host.page.waitForTimeout(400);
  let onHost = await read(host.page);
  let onSam = await read(sam.page);
  const hostPaddled = Math.hypot(onHost.canoeX - afloat.canoeX, onHost.canoeZ - afloat.canoeZ);
  expect(hostPaddled, 'the host paddles and the canoe moves').toBeGreaterThan(1);
  expect(Math.hypot(onSam.canoeX - afloat.canoeX, onSam.canoeZ - afloat.canoeZ), 'the guest sees the canoe the host paddled').toBeGreaterThan(hostPaddled * 0.7);
  await sam.page.keyboard.down('w');
  await expect.poll(async () => (await read(host.page)).players[1]!.paddling, { message: 'the host sees the guest paddle' }).toBe(true);
  await sam.page.waitForTimeout(2000);
  await sam.page.keyboard.up('w');
  await expect.poll(async () => (await read(host.page)).players[1]!.paddling).toBe(false);
  const afterSam = await read(host.page);
  expect(Math.hypot(afterSam.canoeX - onHost.canoeX, afterSam.canoeZ - onHost.canoeZ), 'the guest paddles and the host\'s canoe moves').toBeGreaterThan(1);

  // --- The guest's line drops, and comes back by itself: same seat, same things ---------------
  await stage(host.page, 'portage.session.game.players[1].backpack.push({ itemId: "driftwood", count: 3 });');
  const before = (await read(host.page)).players[1]!;
  expect(before).toMatchObject({ name: 'Sam', driftwood: 3, connected: true });
  // The socket dies under the game, as when the wifi blinks.
  await sam.page.evaluate(() => (window as unknown as { portage: { session: any } }).portage.session.crew.wire.socket.close());
  await expect(sam.page.locator('.iw-toast', { hasText: 'The line dropped. Trying again.' })).toBeVisible();
  await expect(host.page.locator('.iw-toast', { hasText: 'Sam is away' })).toBeVisible();
  await expect(sam.page.locator('.iw-toast', { hasText: 'Back with the crew.' })).toBeVisible({ timeout: 20_000 });
  await expect(host.page.locator('.iw-toast', { hasText: 'Sam is back' })).toBeVisible();
  await expect(host.page.locator('.iw-crew .iw-mate.iw-away')).toHaveCount(0);
  onHost = await read(host.page);
  expect(onHost.players).toHaveLength(2);
  expect(onHost.players[1]).toMatchObject({ name: 'Sam', connected: true, driftwood: 3, seat: before.seat, mode: before.mode });
  expect(await read(sam.page)).toMatchObject({ role: 'guest', localPlayerId: 1, screen: 'game' });
  expect(sam.sockets.filter((address) => address.includes('/room/')), 'the guest dialled again').toHaveLength(2);

  // --- The guest's line stalls: the socket stays open and nothing crosses it -------------------
  const backToast = sam.page.locator('.iw-toast', { hasText: 'Back with the crew.' });
  await expect(backToast, 'the note from the drop above has gone').toHaveCount(0, { timeout: 15_000 });
  const lineNote = sam.page.locator('.iw-line-note');
  await expect(lineNote).toHaveCount(0);
  await samContext.setOffline(true);
  await expect(lineNote, 'a standing note says the host is unheard').toHaveText('No word from the host. Waiting…', { timeout: 8000 });
  // It stands, and it stands still: four seconds on it is there, on the same spot.
  const noteBox = await lineNote.boundingBox();
  await sam.page.waitForTimeout(4000);
  await expect(lineNote).toHaveText('No word from the host. Waiting…');
  expect(await lineNote.boundingBox()).toEqual(noteBox);
  expect(await lineNote.evaluate((element) => getComputedStyle(element).animationName + '|' + getComputedStyle(element).transitionDuration)).toBe('none|0s');
  if (SHOTS) await sam.page.screenshot({ path: `${SHOTS}/line-stalled.png` });
  await samContext.setOffline(false);
  await expect(lineNote, 'the note goes when the host is heard again').toHaveCount(0, { timeout: 30_000 });
  await expect(backToast).toBeVisible();
  await expect(host.page.locator('.iw-crew .iw-mate.iw-away')).toHaveCount(0, { timeout: 15_000 });
  expect((await read(host.page)).players[1]).toMatchObject({ name: 'Sam', connected: true, driftwood: 3 });

  // --- The guest closes the window and opens the link again: the same player ------------------
  await sam.page.close({ runBeforeUnload: true });
  await expect(host.page.locator('.iw-crew .iw-mate.iw-away'), 'the guest shows as away').toHaveCount(1, { timeout: 25_000 });
  expect((await read(host.page)).players[1]).toMatchObject({ name: 'Sam', connected: false, driftwood: 3 });
  sam = await arrive(samContext, link, problems, 'sam');
  await expect(sam.page.locator('.iw-panel-crew_join').getByLabel('Your name'), 'the name is remembered').toHaveValue('Sam');
  await sam.page.locator('.iw-panel-crew_join').getByRole('button', { name: 'Join', exact: true }).click();
  await pick(sam.page);
  await inGame(sam.page);
  await expect(host.page.locator('.iw-crew .iw-mate.iw-away')).toHaveCount(0);
  onHost = await read(host.page);
  expect(onHost.players).toHaveLength(2);
  expect(onHost.players[1]).toMatchObject({ name: 'Sam', connected: true, driftwood: 3, seat: before.seat });
  expect((await read(sam.page)).localPlayerId).toBe(1);

  // --- A third and a fourth join by typing the code ---------------------------------------------
  const ann = await arrive(await open(SMALL), `${BASE}/`, problems, 'ann');
  await joinByClicks(ann.page, shown.toLowerCase(), 'Ann');
  await inGame(ann.page);
  const bo = await arrive(await open(SMALL), `${BASE}/`, problems, 'bo');
  await joinByClicks(bo.page, code, 'Bo');
  await inGame(bo.page);
  await expect(host.page.locator('.iw-crew .iw-mate')).toHaveCount(4);
  expect((await crewRows(host.page)).map((row) => row.name)).toEqual(['Luc', 'Sam', 'Ann', 'Bo']);
  expect((await crewRows(bo.page)).map((row) => [row.name, row.tag])).toEqual([['Luc', 'host'], ['Sam', ''], ['Ann', ''], ['Bo', 'you']]);
  expect((await read(host.page)).players.map((player) => [player.name, player.connected, player.seat])).toEqual([
    ['Luc', true, 0], ['Sam', true, 1], ['Ann', true, 2], ['Bo', true, 3],
  ]);
  // The host's room card counts them.
  await host.page.keyboard.press('Escape');
  await host.page.getByRole('button', { name: 'Crew room' }).click();
  await expect(host.page.locator('.iw-panel-crew_host .iw-crew-status')).toHaveText('3 friends are in the room.');
  await expect(host.page.locator('.iw-panel-crew_host .iw-code')).toHaveText(shown);
  await host.page.keyboard.press('Escape');
  await host.page.keyboard.press('Escape');

  // --- What four players send through the relay, counted on the real sockets --------------------------
  // Everyone paddles for six seconds. The relay is billed by the frame it receives, so this is the number that matters.
  const seats = [host, sam, ann, bo];
  for (const seat of seats) await seat.page.keyboard.down('w');
  await host.page.waitForTimeout(500);
  const counted = seats.map((seat) => ({ ...seat.sent }));
  await host.page.waitForTimeout(6000);
  const rates = seats.map((seat, index) => ({
    frames: (seat.sent.frames - counted[index]!.frames) / 6,
    characters: (seat.sent.characters - counted[index]!.characters) / 6,
  }));
  for (const seat of seats) await seat.page.keyboard.up('w');
  console.log(`relay frames a second with four paddling: host ${rates[0]!.frames.toFixed(1)} (${(rates[0]!.characters / 1024).toFixed(1)} KB/s), `
    + `guests ${rates.slice(1).map((rate) => rate.frames.toFixed(1)).join(', ')} (${(rates[1]!.characters / 1024).toFixed(2)} KB/s each); `
    + `all four ${rates.reduce((sum, rate) => sum + rate.frames, 0).toFixed(1)}`);
  // The host's fifteen states a second for three guests leave as about fifteen frames, not forty-five.
  expect(rates[0]!.frames, 'host frames a second').toBeGreaterThan(10);
  expect(rates[0]!.frames, 'host frames a second').toBeLessThan(30);
  for (const rate of rates.slice(1)) {
    expect(rate.frames, 'guest frames a second').toBeGreaterThan(5);
    expect(rate.frames, 'guest frames a second').toBeLessThanOrEqual(42);
  }

  // --- A fifth is refused, in words ------------------------------------------------------------------
  const dee = await arrive(await open(SMALL), `${BASE}/`, problems, 'dee');
  await joinByClicks(dee.page, code, 'Dee');
  await expect(dee.page.locator('.iw-panel-crew_join .iw-crew-status')).toHaveText('That crew is full.', { timeout: 15_000 });
  expect(await read(dee.page)).toMatchObject({ screen: 'lobby', role: 'solo', joining: 'failed' });
  expect((await read(host.page)).players).toHaveLength(4);

  // --- All four hold the same game, fingerprint for fingerprint ---------------------------------------
  for (const guest of [sam, ann, bo]) expect((await read(guest.page)).mismatches).toBe(0);
  await host.page.evaluate(() => {
    (window as unknown as { portage: { session: any } }).portage.session.frozen = true;
  });
  const hostHash = await stage(host.page, 'await new Promise((done) => setTimeout(done, 600)); return sim.hashState({ ...portage.session.game, events: [] });');
  for (const guest of [sam, ann, bo]) {
    await expect.poll(() => stage(guest.page, 'return sim.hashState(portage.session.guest.truth);'), { message: 'a guest holds the host\'s game exactly' }).toBe(hostHash);
  }
  await host.page.evaluate(() => {
    (window as unknown as { portage: { session: any } }).portage.session.frozen = false;
  });
  expect(problems).toEqual([]);

  // --- The host leaves: every guest is told, and is back in their own lobby ----------------------------
  await host.page.close({ runBeforeUnload: true });
  for (const guest of [sam, ann, bo]) {
    await expect(guest.page.locator('.iw-toast', { hasText: /The host (closed the game|left)\./ })).toBeVisible({ timeout: 60_000 });
    expect((await read(guest.page)).screen).toBe('lobby');
  }
  for (const context of contexts) await context.close();
});

test('by keyboard alone: host a crew, open the room, and reach every control on its card', async ({ browser }) => {
  const context = await profile(browser, SMALL);
  const player = await arrive(context, `${BASE}/`, [], 'player');
  const page = player.page;
  // Down the lobby menu to "Host a crew" (past New Game: with no save yet, Continue is not a stop), and in.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Host a crew' })).toBeFocused();
  await page.keyboard.press('Enter');
  const card = page.locator('.iw-panel-crew_host');
  await expect(card).toBeVisible();
  // The caret is on the name line. Typing goes there and nowhere else; Enter opens the room.
  await expect(card.getByLabel('Your name')).toBeFocused();
  await page.keyboard.type('Luc wasd');
  await expect(card.getByLabel('Your name')).toHaveValue('Luc wasd');
  await page.keyboard.press('Enter');
  await expect(card.locator('.iw-code')).toBeVisible({ timeout: 15_000 });
  expect(await read(page)).toMatchObject({ screen: 'lobby', hosting: 'open' });
  // The name line is switched off now. The keyboard is not stuck on it: it is on the first control that works.
  const focusedOn = (): Promise<string> => page.evaluate(() => new Promise<string>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const focused = document.activeElement as HTMLElement;
      resolve(focused === document.body ? 'nothing' : focused.id || (focused.querySelector('.iw-label')?.textContent ?? focused.textContent ?? '').trim());
    }));
  }));
  // It is on the way out of the card, where a stray Enter undoes nothing.
  expect(await focusedOn()).toBe('Close');
  // Tab walks the card: the link, Copy, Stop hosting, New Game, and round to Close again. (The settled name and the empty Continue are passed over.)
  const stops: string[] = [];
  for (let press = 0; press < 5; press += 1) {
    await page.keyboard.press('Tab');
    stops.push(await focusedOn());
  }
  expect(stops).toEqual(['iw-invite-link', 'Copy link', 'Stop hosting', 'New Game', 'Close']);
  expect(await page.evaluate(() => document.querySelector('.iw')!.classList.contains('iw-by-keys')), 'the focus mark is shown').toBe(true);
  // Esc backs out, and the room stays open behind the lobby.
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Host a crew' }).locator('.iw-n')).toHaveText(/^Room .{3}-.{3} is open$/);
  await context.close();
});

test('a code nobody opened, a code that is not one, and no name each get their sentence', async ({ browser }) => {
  const context = await profile(browser, SMALL);
  const guest = await arrive(context, `${BASE}/`, [], 'guest');
  await joinByClicks(guest.page, 'QRT-WXY', 'Sam');
  const status = guest.page.locator('.iw-panel-crew_join .iw-crew-status');
  await expect(status).toHaveText('No crew with that code. Check it with whoever sent it.', { timeout: 15_000 });
  expect(guest.sockets.filter((address) => address.includes('/room/QRTWXY'))).toHaveLength(1);
  const card = guest.page.locator('.iw-panel-crew_join');
  await card.getByLabel('Crew code').fill('HELLO');
  await card.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(status).toHaveText('That is not a crew code. A code is six letters and digits, like FHJ-K3M.');
  await card.getByLabel('Crew code').fill('QRT-WXY');
  await card.getByLabel('Your name').fill('');
  await card.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(status).toHaveText('Type a name first.');
  // Neither of those dialled anything.
  expect(guest.sockets.filter((address) => address.includes('/room/'))).toHaveLength(1);
  // A name is twelve letters at most, however much is typed.
  await card.getByLabel('Your name').fill('');
  await card.getByLabel('Your name').pressSequentially('Bartholomew the Third');
  await expect(card.getByLabel('Your name')).toHaveValue('Bartholomew ');
  expect((await read(guest.page)).screen).toBe('lobby');
  await context.close();
});

test('a relay that cannot be reached is said so, to a guest and to a host', async ({ browser }) => {
  const context = await profile(browser, SMALL);
  // Every dial to the relay goes to a port nothing listens on, as when the relay is down.
  await context.addInitScript(() => {
    const Real = window.WebSocket;
    window.WebSocket = class extends Real {
      constructor(address: string | URL, protocols?: string | string[]) {
        super(String(address).includes('/relay/') ? 'ws://127.0.0.1:9/' : address, protocols);
      }
    } as typeof WebSocket;
  });
  const guest = await arrive(context, `${BASE}/`, [], 'guest');
  await joinByClicks(guest.page, 'QRT-WXY', 'Sam');
  const status = guest.page.locator('.iw-panel-crew_join .iw-crew-status');
  await expect(status).toHaveText('Connecting to the relay…');
  await expect(status).toHaveText('The relay cannot be reached. Check your connection and try again.', { timeout: 30_000 });
  await expect(guest.page.locator('.iw-panel-crew_join').getByRole('button', { name: 'Join', exact: true })).toBeEnabled();
  await guest.page.keyboard.press('Escape');

  await guest.page.getByRole('button', { name: 'Host a crew' }).click();
  const card = guest.page.locator('.iw-panel-crew_host');
  await card.getByRole('button', { name: 'Open a room' }).click();
  await expect(card.locator('.iw-crew-status')).toHaveText('The relay cannot be reached. Check your connection and try again.', { timeout: 30_000 });
  await expect(card.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(card.locator('.iw-code')).toHaveCount(0);
  // A solo game still starts: the relay being down costs nothing but the crew.
  await guest.page.keyboard.press('Escape');
  await guest.page.getByRole('button', { name: 'New Game' }).click();
  await guest.page.locator('.iw-panel-save_slots').getByRole('button', { name: 'New game here' }).first().click();
  await pick(guest.page);
  await inGame(guest.page);
  expect(await read(guest.page)).toMatchObject({ role: 'solo', hosting: 'failed' });
  await context.close();
});

test('pictures of the crew lobby at 1920x1080', async ({ browser }) => {
  test.skip(SHOTS === '', 'RELAY_SHOTS names no folder');
  const big = { width: 1920, height: 1080 };
  const problems: string[] = [];
  const hostContext = await profile(browser, big);
  const host = await arrive(hostContext, `${BASE}/`, problems, 'host');
  await host.page.screenshot({ path: `${SHOTS}/1-lobby.png` });
  await host.page.getByRole('button', { name: 'Host a crew' }).click();
  await host.page.locator('.iw-panel-crew_host').getByLabel('Your name').fill('Luc');
  await host.page.screenshot({ path: `${SHOTS}/2-host-before.png` });
  await host.page.locator('.iw-panel-crew_host').getByRole('button', { name: 'Open a room' }).click();
  await expect(host.page.locator('.iw-code')).toBeVisible({ timeout: 15_000 });
  const shown = await host.page.locator('.iw-code').innerText();
  await host.page.locator('.iw-panel-crew_host').getByRole('button', { name: 'Copy link' }).click();
  await expect(host.page.locator('.iw-panel-crew_host').getByRole('button', { name: 'Copied' })).toBeVisible();
  await host.page.screenshot({ path: `${SHOTS}/3-host-room-open.png` });

  const guestContext = await profile(browser, big);
  const guest = await arrive(guestContext, `${BASE}/?invite=${shown.replace('-', '')}`, problems, 'guest');
  await guest.page.keyboard.type('Sam');
  await guest.page.screenshot({ path: `${SHOTS}/4-join-from-link.png` });
  await guest.page.keyboard.press('Enter');
  await expect(guest.page.locator('.iw-panel-character_select')).toBeVisible();
  await guest.page.screenshot({ path: `${SHOTS}/4b-pick-who-you-are.png` });
  await pick(guest.page);
  await expect(guest.page.locator('.iw-panel-crew_join .iw-crew-status')).toHaveText('Found the crew. Waiting for the host to start the game…');
  await guest.page.screenshot({ path: `${SHOTS}/5-join-waiting.png` });
  await expect(host.page.locator('.iw-panel-crew_host .iw-crew-status')).toHaveText('One friend is in the room.');
  await host.page.screenshot({ path: `${SHOTS}/6-host-one-friend.png` });

  await host.page.locator('.iw-panel-crew_host').getByRole('button', { name: 'New Game' }).click();
  await host.page.locator('.iw-panel-save_slots').getByRole('button', { name: 'New game here' }).first().click();
  await pick(host.page);
  await inGame(host.page);
  await inGame(guest.page);
  await expect(guest.page.locator('.iw-crew .iw-mate')).toHaveCount(2);
  await guest.page.waitForTimeout(1500);
  await host.page.screenshot({ path: `${SHOTS}/7-in-the-canoe-host.png` });
  await guest.page.screenshot({ path: `${SHOTS}/8-in-the-canoe-guest.png` });
  await host.page.keyboard.press('Escape');
  await host.page.screenshot({ path: `${SHOTS}/9-pause-with-crew-room.png` });
  await host.page.getByRole('button', { name: 'Crew room' }).click();
  await host.page.screenshot({ path: `${SHOTS}/10-room-card-in-game.png` });
  expect(problems).toEqual([]);
  // Two windows this size are as many as this computer draws at once: a third stalled it for twenty seconds.
  // The game in hand is closed before the last picture's window opens.
  for (const context of [hostContext, guestContext]) await context.close();

  const lostContext = await profile(browser, big);
  const lost = await arrive(lostContext, `${BASE}/`, [], 'lost');
  await joinByClicks(lost.page, 'QRT-WXY', 'Dee');
  await expect(lost.page.locator('.iw-panel-crew_join .iw-crew-status')).toHaveText('No crew with that code. Check it with whoever sent it.', { timeout: 15_000 });
  await lost.page.screenshot({ path: `${SHOTS}/11-no-such-room.png` });
  await lostContext.close();
});

test('a build made with no relay has no crew entries, opens no socket, and ignores an invite link', async ({ browser }) => {
  test.skip(BARE === '', 'PORTAGE_BARE_URL names no server');
  const context = await profile(browser);
  // Count every socket the page tries to make, by any route.
  await context.addInitScript(() => {
    const made: string[] = [];
    (window as unknown as { socketsMade: string[] }).socketsMade = made;
    const Real = window.WebSocket;
    window.WebSocket = class extends Real {
      constructor(address: string | URL, protocols?: string | string[]) {
        made.push(String(address));
        super(address, protocols);
      }
    } as typeof WebSocket;
  });
  const problems: string[] = [];
  const player = await arrive(context, `${BARE}/?invite=FHJK3M`, problems, 'player');
  // It is a built game being looked at, not a dev server that happens to sit on that port.
  expect(await player.page.locator('script[src*="/assets/"]').count(), 'a built page').toBeGreaterThan(0);
  await expect(player.page.locator('.iw-lobby-col .iw-mi')).toHaveCount(6);
  expect(await player.page.locator('.iw-lobby-col .iw-mi .iw-label').allInnerTexts()).toEqual(['Continue', 'New Game', 'Settings', 'Full screen', 'How to Play', 'Feedback', 'Credits']);
  await expect(player.page.locator('.iw-panel')).toHaveCount(0);
  // (The build drops the crew lobby whole: the session does not even keep a place for one.)
  expect(await player.page.evaluate(() => (window as unknown as { portage: { session: any } }).portage.session.crew ?? null)).toBeNull();
  // Asked for by hand, the crew cards still do not open.
  await player.page.evaluate(() => {
    const { session } = (window as unknown as { portage: { session: any } }).portage;
    session.handleIntent({ type: 'open_panel', panel: 'crew_host' });
    session.handleIntent({ type: 'crew_open_room' });
    session.handleIntent({ type: 'crew_join' });
  });
  await player.page.waitForTimeout(500);
  await expect(player.page.locator('.iw-panel')).toHaveCount(0);
  // A solo game plays, with the pause menu it always had.
  await player.page.getByRole('button', { name: 'New Game' }).click();
  await player.page.locator('.iw-panel-save_slots').getByRole('button', { name: 'New game here' }).first().click();
  await pick(player.page);
  await inGame(player.page);
  await player.page.keyboard.press('Escape');
  // (The menu is drawn on the frame after the key: look until it is there.)
  await expect(player.page.locator('.iw-panel-pause .iw-mi .iw-label')).toHaveText(['Resume', 'Settings', 'Full screen', 'How to Play', 'Feedback', 'Save and quit to the lobby']);
  expect(await player.page.evaluate(() => (window as unknown as { socketsMade: string[] }).socketsMade), 'sockets the page made').toEqual([]);
  expect(player.sockets).toEqual([]);
  expect(problems).toEqual([]);
  await context.close();
});

test('under the live site\'s security policy, a relay on the site\'s own host works with no change to the policy', async ({ browser }) => {
  test.skip(BUILT === '' || HEADERS === '', 'PORTAGE_BUILT_URL and PORTAGE_HEADERS are not both set');
  const policy = readFileSync(HEADERS, 'utf8').split('\n').find((line) => line.trim().startsWith('Content-Security-Policy:'))!
    .trim().slice('Content-Security-Policy:'.length).trim();
  expect(policy).toContain("connect-src 'self' blob:");

  /**
   * A profile whose pages are served the built game under `withPolicy`. The
   * policy is put on the page as it passes through the test, which makes the
   * browser lose track of where the page came from and treat this computer
   * as a private network it must ask about. The permission answers that; it
   * has nothing to do with the policy, and a public site never meets it.
   */
  const under = async (withPolicy: string): Promise<BrowserContext> => {
    const context = await browser.newContext({ viewport: SMALL, permissions: ['clipboard-read', 'clipboard-write', 'local-network-access'] });
    await context.route(`${BUILT}/**`, async (route) => {
      if (route.request().resourceType() !== 'document') return route.continue();
      const response = await route.fetch();
      return route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': withPolicy } });
    });
    return context;
  };

  const problems: string[] = [];
  const hostContext = await under(policy);
  const host = await arrive(hostContext, `${BUILT}/`, problems, 'host');
  expect(await host.page.evaluate(() => document.querySelectorAll('script[src]').length)).toBeGreaterThan(0);
  const shown = await hostByClicks(host.page, 'Luc');
  const guestContext = await under(policy);
  const guest = await arrive(guestContext, `${BUILT}/?invite=${shown.replace('-', '')}`, problems, 'guest');
  await guest.page.keyboard.type('Sam');
  await guest.page.keyboard.press('Enter');
  await pick(guest.page);
  await inGame(guest.page);
  await expect(host.page.locator('.iw-crew .iw-mate')).toHaveCount(2);
  expect(await read(guest.page)).toMatchObject({ role: 'guest', localPlayerId: 1 });
  expect(host.sockets.filter((address) => address.includes('/room/'))).toEqual([`${BUILT.replace(/^http/, 'ws')}/relay/room/${shown.replace('-', '')}?role=host`]);
  expect(problems, 'no policy violation, no error').toEqual([]);

  // The same policy without 'self' in connect-src: the socket is stopped, and the lobby says the relay cannot be reached.
  const blocked: string[] = [];
  const blockedContext = await under(policy.replace("connect-src 'self' blob:", 'connect-src blob:'));
  const stopped = await arrive(blockedContext, `${BUILT}/`, blocked, 'stopped');
  await stopped.page.getByRole('button', { name: 'Host a crew' }).click();
  await stopped.page.locator('.iw-panel-crew_host').getByRole('button', { name: 'Open a room' }).click();
  await expect(stopped.page.locator('.iw-panel-crew_host .iw-crew-status')).toHaveText('The relay cannot be reached. Check your connection and try again.', { timeout: 30_000 });
  expect(blocked.some((line) => /Content Security Policy|connect-src/.test(line)), 'the browser says the policy stopped it').toBe(true);
  for (const context of [hostContext, guestContext, blockedContext]) await context.close();
});
