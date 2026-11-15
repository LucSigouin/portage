/**
 * A guest carries their own pack: they leave one crew, join another host's
 * game, and their things come with them; back at the first host, what they
 * gained elsewhere comes too, and a gift that first host gave them as they
 * closed is kept. Two hosts and one guest, pages of one
 * browser over the browser's own channel between tabs. Needs the dev server.
 *
 * Run: PORTAGE_URL=http://localhost:5222 npm --prefix <worktree>/e2e test -- carry.spec.ts --global-timeout=300000
 */
import { expect as baseExpect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

const BASE = process.env.PORTAGE_URL ?? 'http://localhost:5220';

test.use({
  viewport: { width: 1280, height: 720 },
  launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
});
test.setTimeout(180_000);
// A state crosses two tabs and a frame or two of each: on a busy machine that is more than the default five seconds.
const expect = baseExpect.configure({ timeout: 15_000 });

/**
 * Close a window the way a person does: the page is left first, so `pagehide`
 * fires and the game says goodbye. A bare `page.close()` in a test may end the
 * page before that event runs.
 */
async function leave(page: Page): Promise<void> {
  await page.goto('about:blank');
  await page.close();
}

async function open(context: BrowserContext, query: string, problems: string[]): Promise<Page> {
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`${query} console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`${query} pageerror: ${error.message}`));
  await page.goto(`${BASE}/${query}`);
  await page.waitForFunction(() => (window as unknown as { portage?: unknown }).portage !== undefined);
  await page.waitForFunction(() => (window as unknown as { portage: { session: any } }).portage.session.screen === 'game', undefined, { timeout: 30_000 });
  return page;
}

/** How much driftwood a player carries in this window's game. */
function driftwoodOf(page: Page, playerId: number): Promise<number> {
  return page.evaluate((id) => {
    const game = (window as unknown as { portage: { session: any } }).portage.session.game;
    const player = game?.players.find((entry: any) => entry.id === id);
    return player ? player.backpack.filter((stack: any) => stack.itemId === 'driftwood').reduce((sum: number, stack: any) => sum + stack.count, 0) : -1;
  }, playerId);
}

const localId = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { portage: { session: any } }).portage.session.localPlayerId);

test('leave and come back with your pack: a guest\'s things go with them to another crew', async ({ context }) => {
  const problems: string[] = [];
  const stamp = Date.now().toString(36);
  const first = await open(context, `?host=carry-a-${stamp}&name=Luc`, problems);
  let guest = await open(context, `?join=carry-a-${stamp}&name=Sam`, problems);
  expect(await localId(guest)).toBe(1);
  // The host gives Sam six driftwood, and Sam's window hears of it.
  await first.evaluate(() => {
    const game = (window as unknown as { portage: { session: any } }).portage.session.game;
    game.players[1].backpack.push({ itemId: 'driftwood', count: 6 });
  });
  await expect.poll(() => driftwoodOf(guest, 1)).toBe(6);
  // Sam closes the window: the leave writes the carry at once.
  await leave(guest);
  await expect.poll(() => first.evaluate(() => (window as unknown as { portage: { session: any } }).portage.session.game.players[1].connected)).toBe(false);

  // Another host, another world. Sam joins it from the same browser and brings the six.
  const second = await open(context, `?host=carry-b-${stamp}&name=Ann`, problems);
  expect(await driftwoodOf(second, 1)).toBe(-1);
  guest = await open(context, `?join=carry-b-${stamp}&name=Sam`, problems);
  const samThere = await localId(guest);
  await expect.poll(() => driftwoodOf(second, samThere)).toBe(6);
  await expect.poll(() => driftwoodOf(guest, samThere)).toBe(6);

  // A newcomer under another name brings nothing of Sam's.
  const kim = await open(context, `?join=carry-b-${stamp}&name=Kim`, problems);
  const kimThere = await localId(kim);
  expect(kimThere).not.toBe(samThere);
  expect(await driftwoodOf(second, kimThere)).toBe(0);

  // Sam gains three at the second host, hears of it, and leaves.
  await second.evaluate((id) => {
    const game = (window as unknown as { portage: { session: any } }).portage.session.game;
    game.players.find((entry: any) => entry.id === id).backpack.push({ itemId: 'driftwood', count: 3 });
  }, samThere);
  await expect.poll(() => driftwoodOf(guest, samThere)).toBe(9);
  await leave(guest);

  // Back to the first host, which has run all along and still holds six on Sam's seat: the nine Sam brings win.
  expect(await driftwoodOf(first, 1)).toBe(6);
  guest = await open(context, `?join=carry-a-${stamp}&name=Sam`, problems);
  expect(await localId(guest)).toBe(1);
  await expect.poll(() => driftwoodOf(first, 1)).toBe(9);
  await expect.poll(() => driftwoodOf(guest, 1)).toBe(9);

  // The same host again, with a gift Sam may not hear of: the window closes in the same moment. Sam's carry is
  // one this host sent, so the seat is the newer copy and stands. The fault this pins laid the older carry over it.
  // (If the state reaches Sam before the close, the carry says eleven too and the check passes either way.)
  await first.evaluate(() => {
    const game = (window as unknown as { portage: { session: any } }).portage.session.game;
    game.players[1].backpack.push({ itemId: 'driftwood', count: 2 });
  });
  await leave(guest);
  await expect.poll(() => first.evaluate(() => (window as unknown as { portage: { session: any } }).portage.session.game.players[1].connected)).toBe(false);
  guest = await open(context, `?join=carry-a-${stamp}&name=Sam`, problems);
  expect(await localId(guest)).toBe(1);
  await expect.poll(() => driftwoodOf(guest, 1)).toBe(11);
  expect(await driftwoodOf(first, 1)).toBe(11);
  expect(problems).toEqual([]);
});
