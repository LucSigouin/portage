/**
 * The boat's menu and the stations, with real keys and real clicks (Luc's list, Round 3):
 * B opens one panel with an icon for the canoe builder and one for each station built on the canoe, each icon
 * shows that station's own menu, the menus craft on open water, and a crafting list never shows a recipe whose
 * station is out of reach. Needs the dev server on http://localhost:5220.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const BASE = process.env.PORTAGE_URL ?? 'http://localhost:5220';

test.use({
  viewport: { width: 1280, height: 720 },
  launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
});
test.setTimeout(120_000);

async function open(page: Page, query: string): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  await page.goto(`${BASE}/${query}`);
  await page.waitForFunction(() => (window as unknown as { portage?: { app?: { lastModel?: unknown } } }).portage?.app?.lastModel != null);
  await page.waitForTimeout(500);
  return problems;
}

async function tap(page: Page, code: string): Promise<void> {
  await page.keyboard.press(code);
  await page.waitForTimeout(200);
}

interface Seen {
  panels: string[];
  boatTab: string;
  beached: boolean;
  mode: string;
  pitch: number;
}

async function read(page: Page): Promise<Seen> {
  return page.evaluate(() => {
    const { session } = (window as unknown as { portage: { session: any } }).portage;
    const game = session.game;
    const count = (stacks: { itemId: string; count: number }[]): number =>
      stacks.filter((stack) => stack.itemId === 'pitch').reduce((sum, stack) => sum + stack.count, 0);
    return {
      panels: [...session.panels.stack], boatTab: session.panels.boatTab, beached: game.canoe.beached, mode: game.players[0].mode,
      pitch: count(game.canoe.cargo) + count(game.players[0].backpack),
    };
  });
}

/** Put stacks in the canoe's cargo, as a haul would. */
async function stock(page: Page, items: [string, number][]): Promise<void> {
  await page.evaluate((stacks) => {
    const { session } = (window as unknown as { portage: { session: any } }).portage;
    for (const [itemId, count] of stacks) session.game.canoe.cargo.push({ itemId, count });
  }, items);
}

const card = (page: Page, tab: string) => page.locator(`.iw-boat-tab[data-boat-tab="${tab}"]`);
/** The cards' names. A card may also carry a red ! for a quest: the name is its label alone. */
const cards = (page: Page) => page.locator('.iw-boat-tab .iw-label');
const entries = (page: Page) => page.locator('.iw-panel-canoe_builder .iw-entry');
const title = (page: Page) => page.locator('.iw-panel-canoe_builder h2');

test('B on open water opens the boat\'s menu on the first station, each icon shows its own menu, and Make crafts afloat', async ({ page }) => {
  const problems = await open(page, '?shot=upgraded&live=1');
  expect(await read(page)).toMatchObject({ mode: 'canoe', beached: false, panels: [] });
  await stock(page, [['spruce_gum', 4], ['driftwood', 6]]);
  await tap(page, 'KeyB');
  expect(await read(page)).toMatchObject({ panels: ['canoe_builder'], boatTab: 'firebox' });
  // The canoe builder, then the four stations, in the builder's order. The firebox is the one open.
  await expect(cards(page)).toHaveText(['Canoe builder', 'Firebox', 'Workbench', 'Smoker', 'Forge']);
  await expect(page.locator('.iw-boat-tab.iw-on .iw-label')).toHaveText(['Firebox']);
  await expect(title(page)).toHaveText('Firebox');
  await expect(entries(page)).toHaveCount(8);
  // Each icon shows its own station's recipes and nothing else. The row keeps its place: nothing jumps.
  const row = await page.locator('.iw-boat-tabs').boundingBox();
  for (const [tab, name, recipes] of [['workbench', 'Workbench', 4], ['smoker', 'Smoker', 2], ['forge', 'Forge', 2]] as const) {
    await card(page, tab).click();
    await expect(title(page)).toHaveText(name);
    await expect(entries(page)).toHaveCount(recipes);
    await expect(page.locator('.iw-panel-canoe_builder .iw-stats')).toHaveCount(0);
    const now = await page.locator('.iw-boat-tabs').boundingBox();
    expect(Math.abs(now!.y - row!.y), `${tab}: the row of icons moved`).toBeLessThan(1);
    expect(Math.abs(now!.x - row!.x), `${tab}: the row of icons moved`).toBeLessThan(1);
  }
  // The canoe builder is one of the icons. Afloat it lists every part and says why nothing can be built.
  await card(page, 'builder').click();
  await expect(title(page)).toHaveText('Canoe builder');
  await expect(page.locator('.iw-panel-canoe_builder .iw-blocked')).toHaveText('Beach the canoe to work on it.');
  await expect(page.locator('.iw-panel-canoe_builder .iw-stats')).toBeVisible();
  // Back at the firebox, Make cooks pitch on the water.
  await card(page, 'firebox').click();
  const before = (await read(page)).pitch;
  await entries(page).filter({ hasText: 'Melt spruce gum' }).getByRole('button', { name: 'Make', exact: true }).click();
  await expect.poll(async () => (await read(page)).pitch).toBe(before + 1);
  expect(await read(page)).toMatchObject({ beached: false, mode: 'canoe', panels: ['canoe_builder'], boatTab: 'firebox' });
  // B closes it, and the game goes on.
  await tap(page, 'KeyB');
  expect((await read(page)).panels).toEqual([]);
  expect(problems).toEqual([]);
});

test('a canoe with no station shows the canoe builder alone, and says what would add a menu', async ({ page }) => {
  await open(page, '?shot=play&live=1');
  await tap(page, 'KeyB');
  expect(await read(page)).toMatchObject({ panels: ['canoe_builder'], boatTab: 'builder', beached: false });
  await expect(cards(page)).toHaveText(['Canoe builder']);
  await expect(page.locator('.iw-boat-hint')).toContainText('No station aboard yet.');
  await expect(page.locator('.iw-panel-canoe_builder .iw-blocked')).toHaveText('Beach the canoe to work on it.');
});

test('C lists only what can be made here: no station out of reach, no recipe that needs one', async ({ page }) => {
  // Afloat with no station aboard: hands, and nothing else.
  await open(page, '?shot=play&live=1');
  await tap(page, 'KeyC');
  expect((await read(page)).panels).toEqual(['crafting']);
  await expect(page.locator('.iw-panel-crafting .iw-body section:not(.iw-elsewhere) > h3')).toHaveText(['Hands']);
  await expect(page.locator('.iw-panel-crafting')).not.toContainText('not in reach');
  await expect(page.locator('.iw-panel-crafting .iw-entry')).toHaveCount(4);
  // At Home Knoll's camp: hands, the fire and the stump bench. The smoker and the forge are not here, and not listed.
  await open(page, '?shot=crafting');
  await expect(page.locator('.iw-panel-crafting .iw-body section:not(.iw-elsewhere) > h3')).toHaveText(['Hands', 'Fire', 'Bench']);
  await expect(page.locator('.iw-panel-crafting')).not.toContainText('not in reach');
  await expect(page.locator('.iw-panel-crafting')).not.toContainText('Smoked fish');
  await expect(page.locator('.iw-panel-crafting')).not.toContainText('Metal sheet');
  // Afloat with all four aboard, everything is here.
  await open(page, '?shot=upgraded&live=1');
  await tap(page, 'KeyC');
  await expect(page.locator('.iw-panel-crafting .iw-body section:not(.iw-elsewhere) > h3')).toHaveText(['Hands', 'Fire', 'Bench', 'Smoker', 'Forge']);
  await expect(page.locator('.iw-panel-crafting .iw-entry')).toHaveCount(20);
});
