/**
 * The inventory grid in a real browser, headless (Luc's bugfix list, round 3).
 *
 * - the bag and a boat of 40 stacks fit the sheet at 1920x1080 and 1366x768: no page scroll, nothing cut, no mark;
 * - a tool is moved to another number by two clicks, and that number's key then takes it in hand;
 * - Shift+click sends a stack to the boat and back, and opens no strip;
 * - Q with the pointer on a tile drops that stack, refuses a tool with a line, and never switches the auto-paddle;
 * - Q with the pointer on no tile does nothing;
 * - nothing on the sheet moves by itself.
 *
 * Needs the dev server on http://localhost:5220, or PORTAGE_URL.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const BASE = process.env.PORTAGE_URL ?? 'http://localhost:5220';

test.use({ viewport: { width: 1920, height: 1080 } });
test.setTimeout(300_000);

function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    if (!message.text().includes('GL Driver Message')) problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

const frames = (page: Page, count = 3): Promise<void> => page.evaluate((wanted) => new Promise<void>((resolve) => {
  const step = (left: number): void => void (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
  step(wanted);
}), count);

/** Read something from the running game: an expression with `portage`, `game` and `player` in hand. */
const read = <T>(page: Page, expression: string): Promise<T> => page.evaluate(
  (body) => new Function('portage', 'game', 'player', `return (${body});`)(
    (window as any).portage, (window as any).portage.session.game, (window as any).portage.session.game.players[0],
  ) as never, expression,
) as Promise<T>;

/**
 * The staged inventory, live, with the bag and the boat filled for the test. `boatStacks` above what the hull
 * holds raises the hull's own count for this page only (three more chests are another builder's job).
 */
async function showInventory(page: Page, boatStacks: number): Promise<void> {
  await page.goto(`${BASE}/?shot=inventory&live=1`);
  await page.waitForFunction(() => (window as any).portage?.app?.lastModel?.panel?.id === 'inventory');
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async (wanted) => {
    const state = (window as any).portage.session.game;
    const player = state.players[0];
    const { ITEMS, ITEM_IDS, isStackable } = await import(/* @vite-ignore */ `${location.origin}/src/data/items.ts`);
    const canoe = await import(/* @vite-ignore */ `${location.origin}/src/data/canoe.ts`);
    // Nothing a quest asks for: every stack here may be dropped.
    const held = new Set(['driftwood', 'fiber', 'spruce_gum', 'birch_bark', 'cattail_root', 'apple', 'sailcloth']);
    const items = (ITEM_IDS as string[]).filter((itemId) => isStackable(itemId) && ITEMS[itemId].category !== 'stock' && !held.has(itemId) && itemId !== 'clean_water');
    const stacks = (count: number, from: number): { itemId: string; count: number }[] =>
      Array.from({ length: count }, (_, index) => ({ itemId: items[(from + index) % items.length]!, count: ((index * 7 + 3) % 19) + 1 }));
    state.pendingRewards = [];
    state.canoe.hullTier = 3;
    if (!state.canoe.attachments.includes('cargo_rack')) state.canoe.attachments.push('cargo_rack');
    const bonus = state.canoe.attachments.reduce((sum: number, id: string) => sum + canoe.ATTACHMENTS[id].cargoSlotsBonus, 0);
    canoe.HULL_TIERS[3].cargoSlots = Math.max(wanted, 22) - bonus;
    state.tools = ['bailing_can', 'stone_knife', 'hatchet'];
    delete player.toolSlots;
    player.selectedTool = null;
    player.backpack = stacks(4, 0);
    state.canoe.cargo = stacks(wanted, 4);
  }, boatStacks);
  await frames(page, 4);
}

test('the bag and a boat of 40 stacks fit the sheet at 1920x1080 and 1366x768, and nothing on it moves', async ({ page }) => {
  const problems = watch(page);
  for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    await page.setViewportSize(size);
    await showInventory(page, 40);
    const where = `${size.width}x${size.height}`;
    const fit = await page.evaluate(() => {
      const body = document.querySelector<HTMLElement>('.iw-panel-inventory .iw-body')!;
      const panel = document.querySelector('.iw-panel-inventory')!.getBoundingClientRect();
      const boat = [...document.querySelectorAll('.iw-inv-boat .iw-tile')].map((tile) => tile.getBoundingClientRect());
      const bag = [...document.querySelectorAll('.iw-inv-pack .iw-tile')].map((tile) => tile.getBoundingClientRect());
      const body_ = body.getBoundingClientRect();
      return {
        pageScrolls: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
        below: body.scrollHeight - body.clientHeight, sideways: body.scrollWidth - body.clientWidth,
        panelInside: panel.top >= 0 && panel.bottom <= innerHeight && panel.left >= 0 && panel.right <= innerWidth,
        boatTiles: boat.length, bagTiles: bag.length,
        tilesInside: [...boat, ...bag].every((box) => box.top >= body_.top - 0.5 && box.bottom <= body_.bottom + 0.5 && box.left >= body_.left - 0.5 && box.right <= body_.right + 0.5),
        square: [...boat, ...bag].every((box) => Math.abs(box.width - box.height) < 1),
        bagLeftOfBoat: Math.max(...bag.map((box) => box.right)) < Math.min(...boat.map((box) => box.left)),
        cutMarkHidden: document.querySelector<HTMLElement>('.iw-panel-inventory .iw-cut')!.hidden,
        running: document.getAnimations().filter((animation) => animation.playState === 'running').length,
      };
    });
    expect(fit, where).toEqual({
      pageScrolls: false, below: 0, sideways: 0, panelInside: true, boatTiles: 40, bagTiles: 8, tilesInside: true, square: true,
      bagLeftOfBoat: true, cutMarkHidden: true, running: 0,
    });
    // The tool belt is the top right of the sheet: above the boat's tiles and right of the two drawn buttons.
    const top = await page.evaluate(() => {
      const box = (selector: string): DOMRect => document.querySelector(selector)!.getBoundingClientRect();
      return {
        beltAboveBoat: box('.iw-belt-tiles').bottom <= box('.iw-inv-boat').top + 1,
        beltRightOfButtons: box('.iw-belt-tiles').left > box('.iw-pack-actions').right,
        buttonsAboveBag: box('.iw-pack-actions').bottom <= box('.iw-inv-pack').top + 1,
        labels: [...document.querySelectorAll('.iw-icon-btn')].map((button) => button.getAttribute('aria-label')),
      };
    });
    expect(top, where).toEqual({
      beltAboveBoat: true, beltRightOfButtons: true, buttonsAboveBag: true,
      labels: ['Stow all in the canoe', 'Scoop water. Dirty water. Boil it at a fire before drinking.'],
    });
  }
  // The hover label of a drawn button: written whole while the pointer is on it, gone when it leaves.
  const tip = (): Promise<string> => page.evaluate(() => getComputedStyle(document.querySelector('.iw-icon-btn[data-action="stow"]')!, '::after').display);
  expect(await tip()).toBe('none');
  await page.hover('.iw-icon-btn[data-action="stow"]');
  expect(await tip()).toBe('block');
  await page.mouse.move(4, 4);
  expect(await tip()).toBe('none');
  expect(problems).toEqual([]);
});

test('a tool goes to another number by two clicks, and that number\'s key then takes it in hand', async ({ page }) => {
  const problems = watch(page);
  await showInventory(page, 8);
  const belt = (): Promise<(string | null)[]> => read(page, 'portage.app.lastModel.panel.belt.map((slot) => slot.toolId)');
  expect(await belt()).toEqual(['bailing_can', 'stone_knife', 'hatchet', null, null]);
  await page.locator('.iw-item-pick[data-detail="belt:hatchet:0"]').click();
  await page.locator('.iw-belt-tiles .iw-item-detail button', { hasText: 'To 5' }).click();
  await frames(page);
  expect(await belt()).toEqual(['bailing_can', 'stone_knife', null, null, 'hatchet']);
  expect(await read(page, 'portage.app.lastModel.hud.hotbar.map((slot) => slot.toolId)')).toEqual(['bailing_can', 'stone_knife', null, null, 'hatchet']);
  // Back in play: key 3, where it was, picks nothing; key 5 takes it in hand.
  await page.keyboard.press('Tab');
  await frames(page);
  expect(await read(page, 'portage.session.isOpen("inventory")')).toBe(false);
  await page.keyboard.press('Digit3');
  await frames(page);
  expect(await read(page, 'player.selectedTool')).toBeNull();
  await page.keyboard.press('Digit5');
  await frames(page);
  expect(await read(page, 'player.selectedTool')).toBe('hatchet');
  expect(problems).toEqual([]);
});

test('Shift+click sends a stack to the boat and back; Q on a tile drops it, refuses a tool, and leaves the auto-paddle alone', async ({ page }) => {
  const problems = watch(page);
  await showInventory(page, 3);
  const count = (where: string, itemId: string): Promise<number> =>
    read(page, `(${where}).filter((stack) => stack.itemId === '${itemId}').reduce((sum, stack) => sum + stack.count, 0)`);
  const toasts = (): Promise<string[]> => page.evaluate(() => [...document.querySelectorAll('.iw-toast')].map((toast) => (toast.textContent ?? '').trim()));
  expect(await read(page, 'portage.app.lastModel.panel.cargo.accessible')).toBe(true);

  // Shift+click a bag tile: the whole stack is in the boat, and no strip opened.
  const first = await read<{ itemId: string; count: number }>(page, 'portage.app.lastModel.panel.backpack.slots[0]');
  await page.locator('.iw-inv-pack .iw-item-pick').first().click({ modifiers: ['Shift'] });
  await frames(page);
  expect(await count('player.backpack', first.itemId)).toBe(0);
  expect(await count('game.canoe.cargo', first.itemId)).toBeGreaterThanOrEqual(first.count);
  expect(await page.locator('.iw-item-detail').count()).toBe(0);
  // Shift+click that stack in the boat: it is back in the bag.
  await page.locator(`.iw-inv-boat .iw-item-pick[data-detail="cargo:${first.itemId}:0"]`).click({ modifiers: ['Shift'] });
  await frames(page);
  expect(await count('player.backpack', first.itemId)).toBeGreaterThanOrEqual(first.count);
  // A plain click still only opens the strip.
  await page.locator('.iw-inv-pack .iw-item-pick').first().click();
  await frames(page);
  expect(await page.locator('.iw-item-detail').count()).toBe(1);
  await page.locator('.iw-inv-pack .iw-item-pick').first().click();

  // Q with the pointer on a bag tile: that stack is gone, a note says so, the inventory stays open.
  const target = await read<{ itemId: string; count: number }>(page, 'portage.app.lastModel.panel.backpack.slots[1]');
  const had = await count('player.backpack', target.itemId);
  await page.locator(`.iw-inv-pack .iw-item-pick[data-detail="backpack:${target.itemId}:0"]`).hover();
  await page.keyboard.press('KeyQ');
  await frames(page, 6);
  expect(await count('player.backpack', target.itemId)).toBe(had - target.count);
  expect((await toasts()).some((text) => text.startsWith(`-${target.count} `))).toBe(true);
  expect(await read(page, 'portage.session.isOpen("inventory")')).toBe(true);
  // Q with the pointer on a tool: it stays, and a line says why.
  await page.locator('.iw-item-pick[data-detail="belt:hatchet:0"]').hover();
  await page.keyboard.press('KeyQ');
  await frames(page, 6);
  expect(await read(page, 'game.tools')).toContain('hatchet');
  expect(await toasts()).toContain('Tools stay on the belt. They are never dropped.');
  // Q with the pointer on no tile: nothing is dropped.
  await page.mouse.move(4, 4);
  const stacks = await read<number>(page, 'player.backpack.length');
  await page.keyboard.press('KeyQ');
  await frames(page, 6);
  expect(await read(page, 'player.backpack.length')).toBe(stacks);
  // And none of those presses switched the auto-paddle.
  expect(await read(page, 'portage.session.input.autoPaddle')).toBe(false);
  expect(await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running').length)).toBe(0);
  expect(problems).toEqual([]);
});
