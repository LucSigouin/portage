/**
 * A guest carries their own pack: they leave one crew, join another host's
 * game, and their things come with them; back at the first host, what they
 * gained elsewhere comes too, and a gift that first host gave them as they
 * closed is kept.
 *
 * The road players take: each host in a browser profile of its own opens a
 * room from the lobby, Sam opens the invite link, types his name and picks,
 * and every message crosses the relay. Sam keeps one profile throughout, so
 * his `localStorage` (where the carry is kept) lasts from crew to crew. The
 * developer's `?host=` and `?join=` rooms would not do: they are a sandbox
 * whose storage forgets, so nothing could be carried there.
 *
 * Needs the dev server and the local relay (`relay/`, `npm run dev`, port 8791):
 *   PORTAGE_URL=http://localhost:5222 npm --prefix <worktree>/e2e test -- carry.spec.ts --global-timeout=300000
 */
import { expect as baseExpect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';

const BASE = process.env.PORTAGE_URL ?? 'http://localhost:5220';
const SMALL = { width: 800, height: 450 };

test.use({
  viewport: SMALL,
  // Render on the graphics card: the software fallback runs at about one frame a second.
  launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
});
test.setTimeout(300_000);
// A state crosses the relay and a frame or two of each window: on a busy machine that is more than the default five seconds.
const expect = baseExpect.configure({ timeout: 15_000 });

const profile = (browser: Browser): Promise<BrowserContext> => browser.newContext({ viewport: SMALL });

/** A page at the address, with its errors gathered, once the lobby a player would see is drawn. */
async function arrive(context: BrowserContext, address: string, problems: string[], who: string): Promise<Page> {
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`${who} console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`${who} pageerror: ${error.message}`));
  await page.goto(address);
  await page.waitForFunction(() => (window as unknown as { portage?: unknown }).portage !== undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.iw-lobby-col .iw-mi').first().waitFor();
  return page;
}

const inGame = (page: Page): Promise<unknown> =>
  page.waitForFunction(() => (window as unknown as { portage: { session: any } }).portage.session.screen === 'game', undefined, { timeout: 30_000 });

/** Host a crew by the lobby's own entries and start a new game in it. Returns the code to join by. */
async function hostCrew(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Host a crew' }).click();
  const card = page.locator('.iw-panel-crew_host');
  await expect(card).toBeVisible();
  await card.getByLabel('Your name').fill(name);
  await card.getByRole('button', { name: 'Open a room' }).click();
  await expect(card.locator('.iw-code')).toBeVisible();
  const code = (await card.locator('.iw-code').innerText()).replace('-', '');
  await card.getByRole('button', { name: 'New Game' }).click();
  await page.locator('.iw-panel-save_slots').getByRole('button', { name: 'New game here' }).first().click();
  await page.locator('.iw-panel-character_select .cs-start').click();
  await inGame(page);
  return code;
}

/** Open the invite link in this profile, type the name, pick, and be in the canoe. */
async function joinByLink(context: BrowserContext, code: string, name: string, problems: string[]): Promise<Page> {
  const page = await arrive(context, `${BASE}/?invite=${code}`, problems, name);
  const card = page.locator('.iw-panel-crew_join');
  await expect(card).toBeVisible();
  await card.getByLabel('Your name').fill(name);
  await card.getByRole('button', { name: 'Join', exact: true }).click();
  await page.locator('.iw-panel-character_select .cs-start').click();
  await inGame(page);
  return page;
}

/**
 * Close a window the way a person does: the page is left first, so `pagehide`
 * fires and the game says goodbye. A bare `page.close()` in a test may end the
 * page before that event runs.
 */
async function leave(page: Page): Promise<void> {
  await page.goto('about:blank');
  await page.close();
}

/** How much driftwood a player carries in this window's game. -1 when there is no such player. */
function driftwoodOf(page: Page, playerId: number): Promise<number> {
  return page.evaluate((id) => {
    const game = (window as unknown as { portage: { session: any } }).portage.session.game;
    const player = game?.players.find((entry: any) => entry.id === id);
    return player ? player.backpack.filter((stack: any) => stack.itemId === 'driftwood').reduce((sum: number, stack: any) => sum + stack.count, 0) : -1;
  }, playerId);
}

/** The host puts driftwood in a player's pack. */
function give(page: Page, playerId: number, count: number): Promise<void> {
  return page.evaluate(([id, more]) => {
    const game = (window as unknown as { portage: { session: any } }).portage.session.game;
    game.players.find((entry: any) => entry.id === id).backpack.push({ itemId: 'driftwood', count: more });
  }, [playerId, count] as const);
}

const localId = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { portage: { session: any } }).portage.session.localPlayerId);

const connected = (page: Page, playerId: number): Promise<boolean> =>
  page.evaluate((id) => (window as unknown as { portage: { session: any } }).portage.session.game.players.find((entry: any) => entry.id === id).connected, playerId);

test('leave and come back with your pack: a guest\'s things go with them to another crew', async ({ browser }) => {
  const problems: string[] = [];
  const contexts: BrowserContext[] = [];
  const open = async (): Promise<BrowserContext> => {
    const context = await profile(browser);
    contexts.push(context);
    return context;
  };
  const samProfile = await open();

  // --- Host A, Sam joins by the link and is given six driftwood -----------------------
  const first = await arrive(await open(), `${BASE}/`, problems, 'host A');
  const codeA = await hostCrew(first, 'Luc');
  let sam = await joinByLink(samProfile, codeA, 'Sam', problems);
  const samAtA = await localId(sam);
  // One first, then five: the five come inside the carry's five-second write window, so only
  // the leave's own write can put the six in Sam's browser. (On a slow machine the window may
  // pass first and the six be written anyway: then this leg cannot see a missing leave write.)
  await give(first, samAtA, 1);
  await expect.poll(() => driftwoodOf(sam, samAtA)).toBe(1);
  await give(first, samAtA, 5);
  await expect.poll(() => driftwoodOf(sam, samAtA)).toBe(6);
  // Sam closes the window: the leave writes the carry into his browser at once.
  await leave(sam);
  await expect.poll(() => connected(first, samAtA)).toBe(false);

  // --- Host B, another crew and another world: Sam brings the six -------------------------
  const second = await arrive(await open(), `${BASE}/`, problems, 'host B');
  const codeB = await hostCrew(second, 'Ann');
  expect(codeB).not.toBe(codeA);
  sam = await joinByLink(samProfile, codeB, 'Sam', problems);
  // What his browser kept as he left A.
  const kept = await sam.evaluate(() => localStorage.getItem('portage.crew.carry.Sam'));
  expect(kept, 'the carry slot in Sam\'s browser').not.toBeNull();
  const keptDriftwood = (JSON.parse(kept!).backpack as { itemId: string; count: number }[])
    .filter((stack) => stack.itemId === 'driftwood').reduce((sum, stack) => sum + stack.count, 0);
  expect(keptDriftwood).toBe(6);
  const samAtB = await localId(sam);
  await expect.poll(() => driftwoodOf(second, samAtB)).toBe(6);
  await expect.poll(() => driftwoodOf(sam, samAtB)).toBe(6);

  // --- A newcomer under another name, in a browser of their own, brings nothing of Sam's ------
  const kim = await joinByLink(await open(), codeB, 'Kim', problems);
  const kimAtB = await localId(kim);
  expect(kimAtB).not.toBe(samAtB);
  expect(await driftwoodOf(second, kimAtB)).toBe(0);
  await leave(kim);

  // --- Sam gains three at B, hears of it, and leaves --------------------------------------
  await give(second, samAtB, 3);
  await expect.poll(() => driftwoodOf(sam, samAtB)).toBe(9);
  await leave(sam);
  await expect.poll(() => connected(second, samAtB)).toBe(false);

  // --- Back to A, which ran all along and still holds six on Sam's seat: the nine he brings win ---
  expect(await driftwoodOf(first, samAtA)).toBe(6);
  sam = await joinByLink(samProfile, codeA, 'Sam', problems);
  expect(await localId(sam), 'Sam is back on his own seat').toBe(samAtA);
  await expect.poll(() => driftwoodOf(first, samAtA)).toBe(9);
  await expect.poll(() => driftwoodOf(sam, samAtA)).toBe(9);

  // --- A gift Sam may not hear of: the window closes in the same moment. ---------------------
  // Sam's carry is one this host sent, so the seat is the newer copy and stands. The fault this
  // pins laid the older carry over it. (If the state reaches Sam before the close, the carry says
  // eleven too and the check passes either way.)
  await give(first, samAtA, 2);
  await leave(sam);
  await expect.poll(() => connected(first, samAtA)).toBe(false);
  sam = await joinByLink(samProfile, codeA, 'Sam', problems);
  expect(await localId(sam)).toBe(samAtA);
  await expect.poll(() => driftwoodOf(sam, samAtA)).toBe(11);
  expect(await driftwoodOf(first, samAtA)).toBe(11);

  expect(problems).toEqual([]);
  for (const context of contexts) await context.close();
});
