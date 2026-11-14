/**
 * The inventory grid in a real browser, headless (Luc's bugfix list, round 3).
 *
 * - the bag and a boat of 40 stacks fit the sheet at 1920x1080 and 1366x768: no page scroll, nothing cut, no mark;
 * - a tool is moved to another number by two clicks, and that number's key then takes it in hand;
 * - Shift+click sends a stack to the boat and back, and opens no menu;
 * - Q with the pointer on a tile drops that stack, refuses a tool with a line, and never switches the auto-paddle;
 * - Q with the pointer on no tile does nothing;
 * - nothing on the sheet moves by itself.
 *
 * Round 4 (Luc: "a info screen on the right", "clicking on it open a small hover menu", "i like the give"):
 *
 * - the info panel on the right shows the tile under the pointer or the keyboard, keeps it when the pointer
 *   leaves, and the grid never moves when it fills;
 * - a click on a tile opens a small menu beside it, on the screen and never over its tile, at every tile; it
 *   closes on a pick, on Escape (the inventory stays), on a click elsewhere and with the inventory;
 * - the keyboard alone opens the menu, walks its lines and gets the tile back;
 * - Give: a host and a guest in one canoe each see a line with the other's name, and each reads their own note.
 *
 * Needs the dev server on http://localhost:5220, or PORTAGE_URL.
 */
import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';

const BASE = process.env.PORTAGE_URL ?? 'http://localhost:5220';

// On the real graphics card, as every other spec that opens a game: the software fallback takes two seconds a
// frame at the top quality on this Mac.
test.use({
  viewport: { width: 1920, height: 1080 },
  launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
});
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
  // The game does not draw on every display frame (it keeps a beat, and watches the screen as the page opens):
  // wait until the sheet shows the boat as it was just filled, not for a count of frames.
  await page.waitForFunction((wanted) => {
    const panel = (window as any).portage.app.lastModel?.panel;
    // The bag too: the staged bag (driftwood first) can still be on the sheet when the boat already has its count.
    // A key pressed then lands on a tile the next draw takes away (the keyboard test's first tile, its menu).
    const bag = (window as any).portage.session.game.players[0].backpack.map((stack: { itemId: string }) => stack.itemId);
    const drawnBag = [...document.querySelectorAll<HTMLElement>('.iw-item-pick[data-detail^="backpack:"]')].map((each) => each.dataset.detail!.split(':')[1]);
    return panel?.id === 'inventory' && panel.cargo.slots.filter((slot: { itemId: string | null }) => slot.itemId !== null).length === wanted
      && document.querySelectorAll('.iw-inv-boat .iw-item-pick').length === wanted
      && JSON.stringify(drawnBag) === JSON.stringify(bag);
  }, boatStacks);
  await frames(page, 2);
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
      const info = document.querySelector('.iw-inv-info')!.getBoundingClientRect();
      return {
        pageScrolls: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
        below: body.scrollHeight - body.clientHeight, sideways: body.scrollWidth - body.clientWidth,
        panelInside: panel.top >= 0 && panel.bottom <= innerHeight && panel.left >= 0 && panel.right <= innerWidth,
        boatTiles: boat.length, bagTiles: bag.length,
        tilesInside: [...boat, ...bag].every((box) => box.top >= body_.top - 0.5 && box.bottom <= body_.bottom + 0.5 && box.left >= body_.left - 0.5 && box.right <= body_.right + 0.5),
        square: [...boat, ...bag].every((box) => Math.abs(box.width - box.height) < 1),
        bagLeftOfBoat: Math.max(...bag.map((box) => box.right)) < Math.min(...boat.map((box) => box.left)),
        // The info panel (round 4): right of the boat's tiles, inside the sheet's body, eight tiles still across.
        infoRightOfBoat: info.left > Math.max(...boat.map((box) => box.right)),
        infoInside: info.top >= body_.top - 0.5 && info.bottom <= body_.bottom + 0.5 && info.right <= body_.right + 0.5,
        boatAcross: boat.filter((box) => Math.abs(box.top - boat[0]!.top) < 1).length,
        cutMarkHidden: document.querySelector<HTMLElement>('.iw-panel-inventory .iw-cut')!.hidden,
        running: document.getAnimations().filter((animation) => animation.playState === 'running').length,
      };
    });
    expect(fit, where).toEqual({
      pageScrolls: false, below: 0, sideways: 0, panelInside: true, boatTiles: 40, bagTiles: 8, tilesInside: true, square: true,
      bagLeftOfBoat: true, infoRightOfBoat: true, infoInside: true, boatAcross: 8, cutMarkHidden: true, running: 0,
    });
    // No pixel of the sheet's contents is over its box (the master review of round 3, finding 11). The review measured
    // the sheet 3 pixels taller than its box at 1920x1080: that is the paper itself, which is drawn a little crooked
    // (`--tilt` on `.iw-paper`), and nothing written on it. Laid level, the sheet is exactly its box; and every
    // tile, word and button ends inside the sheet's own margins.
    const sheet = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('.iw-panel-inventory')!;
      const style = getComputedStyle(panel);
      const box = panel.getBoundingClientRect();
      const inner = {
        bottom: box.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom),
        right: box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
        left: box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
      };
      const contentOver = [...panel.querySelectorAll<HTMLElement>('header *, .iw-body, footer, footer *')].filter((element) => {
        const each = element.getBoundingClientRect();
        return each.height > 0 && (each.bottom > inner.bottom + 0.5 || each.right > inner.right + 0.5 || each.left < inner.left - 0.5);
      }).map((element) => `${element.tagName.toLowerCase()}.${element.className}`);
      const tilt = style.getPropertyValue('--tilt').trim();
      const crooked = { tall: panel.scrollHeight - panel.clientHeight, wide: panel.scrollWidth - panel.clientWidth };
      panel.style.setProperty('--tilt', '0deg');
      const level = { tall: panel.scrollHeight - panel.clientHeight, wide: panel.scrollWidth - panel.clientWidth };
      panel.style.removeProperty('--tilt');
      const footer = panel.querySelector<HTMLElement>('footer')!;
      const hint = panel.querySelector<HTMLElement>('.iw-inv-hint')!;
      return {
        contentOver, level, tilt, crookedTall: crooked.tall,
        // The footer's line of quick presses is whole, on one line, beside the way out.
        hintLines: Math.round(hint.getBoundingClientRect().height / parseFloat(getComputedStyle(hint).lineHeight)),
        hintClear: hint.getBoundingClientRect().right <= footer.querySelector('button')!.getBoundingClientRect().left,
      };
    });
    expect({ contentOver: sheet.contentOver, level: sheet.level, hintLines: sheet.hintLines, hintClear: sheet.hintClear }, where)
      .toEqual({ contentOver: [], level: { tall: 0, wide: 0 }, hintLines: 1, hintClear: true });
    // And the few pixels it measures over are the crooked paper's own: under a hundredth of the sheet.
    expect(sheet.tilt, where).not.toBe('0deg');
    expect(sheet.crookedTall, where).toBeLessThanOrEqual(6);
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
  await page.locator('.iw-tile-menu button', { hasText: 'To 5' }).click();
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

  // Shift+click a bag tile: the whole stack is in the boat, and no menu opened.
  const first = await read<{ itemId: string; count: number }>(page, 'portage.app.lastModel.panel.backpack.slots[0]');
  await page.locator('.iw-inv-pack .iw-item-pick').first().click({ modifiers: ['Shift'] });
  await frames(page);
  expect(await count('player.backpack', first.itemId)).toBe(0);
  expect(await count('game.canoe.cargo', first.itemId)).toBeGreaterThanOrEqual(first.count);
  expect(await page.locator('.iw-tile-menu').count()).toBe(0);
  // Shift+click that stack in the boat: it is back in the bag.
  await page.locator(`.iw-inv-boat .iw-item-pick[data-detail="cargo:${first.itemId}:0"]`).click({ modifiers: ['Shift'] });
  await frames(page);
  expect(await count('player.backpack', first.itemId)).toBeGreaterThanOrEqual(first.count);
  // A plain click only opens the tile's menu, and the same tile clicked again closes it. Nothing opens in the grid.
  await page.locator('.iw-inv-pack .iw-item-pick').first().click();
  await frames(page);
  expect(await page.locator('.iw-tile-menu').count()).toBe(1);
  expect(await page.locator('.iw-tiles .iw-tile-menu, .iw-item-detail').count()).toBe(0);
  await page.locator('.iw-inv-pack .iw-item-pick').first().click();
  await frames(page);
  expect(await page.locator('.iw-tile-menu').count()).toBe(0);

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

// --- Round 4: the info panel, the menu at a tile, Give --------------------------------------------------------------

/** Where the sheet, every tile, every heading, the info panel and the footer are, to the tenth of a pixel. */
const places = (page: Page): Promise<string> => page.evaluate(() => JSON.stringify(
  [...document.querySelectorAll('.iw-panel-inventory, .iw-inv .iw-tile, .iw-inv h3, .iw-inv-info, .iw-panel-inventory footer')].map((each) => {
    const box = each.getBoundingClientRect();
    return [box.left, box.top, box.width, box.height].map((value) => Math.round(value * 10));
  })));

const about = (page: Page): Promise<{ about: string; text: string; below: number; sideways: number }> => page.evaluate(() => {
  const card = document.querySelector<HTMLElement>('.iw-info-card')!;
  return {
    about: card.dataset.about ?? '', text: card.innerText.replace(/\s+/g, ' ').trim(),
    below: Math.round(card.scrollHeight - card.clientHeight), sideways: Math.round(card.scrollWidth - card.clientWidth),
  };
});

interface MenuSeen { for: string; lines: string[]; onScreen: boolean; overTile: boolean; overInfo: boolean; clipped: number; side: string }

/** The open menu as drawn, or null: its tile, its lines ("Stow", "Drop (off) [why]"), and where it stands. */
const menuSeen = (page: Page): Promise<MenuSeen | null> => page.evaluate(() => {
  const menu = document.querySelector<HTMLElement>('.iw-tile-menu');
  if (!menu) return null;
  const box = menu.getBoundingClientRect();
  const tile = [...document.querySelectorAll<HTMLElement>('.iw-item-pick')].find((each) => each.dataset.detail === menu.dataset.for)!.getBoundingClientRect();
  const info = document.querySelector('.iw-inv-info')!.getBoundingClientRect();
  const apart = (other: DOMRect): boolean => box.right <= other.left || box.left >= other.right || box.bottom <= other.top || box.top >= other.bottom;
  return {
    for: menu.dataset.for ?? '',
    lines: [...menu.querySelectorAll('button')].map((button) =>
      `${button.querySelector('.iw-label')!.textContent}${button.disabled ? ' (off)' : ''}${button.querySelector('.iw-note') ? ` [${button.querySelector('.iw-note')!.textContent}]` : ''}`),
    onScreen: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
    overTile: !apart(tile), overInfo: !apart(info),
    clipped: [...menu.querySelectorAll<HTMLElement>('button, .iw-menu-head, .iw-label, .iw-note')].filter((each) => each.scrollWidth > each.clientWidth + 1).length,
    side: box.left >= tile.right ? 'right' : box.right <= tile.left ? 'left' : 'other',
  };
});

const tile = (page: Page, key: string) => page.locator(`.iw-item-pick[data-detail="${key}"]`);

test('the info panel shows the tile under the pointer, keeps it when the pointer leaves, and the grid never moves', async ({ page }) => {
  const problems = watch(page);
  for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    await page.setViewportSize(size);
    await showInventory(page, 40);
    const where = `${size.width}x${size.height}`;
    await page.mouse.move(4, 4);
    await frames(page);
    const before = await places(page);
    // Before any item: one quiet line, and nothing else in the panel.
    expect((await about(page)), where).toMatchObject({ about: '', text: 'Point at an item to read about it.' });
    // Every tile in turn: the panel is about it, nothing on the sheet moved, and the card needs no scroll.
    const keys = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.iw-item-pick')].map((each) => each.dataset.detail!));
    // 40 stacks in the boat, 4 in the bag, 3 tools, and the staged game's key items.
    expect(keys.length, where).toBe(40 + 4 + 3 + await read<number>(page, 'portage.app.lastModel.panel.keyItems.length'));
    for (const key of keys) {
      await tile(page, key).hover();
      await frames(page, 1);
      const shown = await about(page);
      expect(shown, `${where} ${key}`).toMatchObject({ about: key, below: 0, sideways: 0 });
      expect(await places(page), `${where}: the sheet moved when the panel filled for ${key}`).toBe(before);
    }
    // Its words: the name, how many, what it is.
    const first = await read<{ itemId: string; name: string; count: number; description: string }>(page, 'portage.app.lastModel.panel.backpack.slots[0]');
    await tile(page, `backpack:${first.itemId}:0`).hover();
    await frames(page);
    const shown = await about(page);
    expect(shown.text, where).toContain(first.name);
    expect(shown.text, where).toContain(`x${first.count}`);
    expect(shown.text, where).toContain(first.description);
    // The pointer off every tile: the panel keeps the last item. Nothing opened in the grid, and no menu.
    await page.mouse.move(4, 4);
    await frames(page);
    expect(await about(page), where).toEqual(shown);
    expect(await page.locator('.iw-item-detail, .iw-tile-menu').count(), where).toBe(0);
    // A tile has no tooltip of the browser's: the panel says what it is.
    expect(await page.locator('.iw-item-pick[title]').count(), where).toBe(0);
    expect(await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running').length), where).toBe(0);
  }
  expect(problems).toEqual([]);
});

test('a click on a tile opens a small menu beside it, at every tile, and it closes on a pick, Escape, a click elsewhere and with the inventory', async ({ page }) => {
  const problems = watch(page);
  for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    await page.setViewportSize(size);
    await showInventory(page, 40);
    const where = `${size.width}x${size.height}`;
    const before = await places(page);
    const keys = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.iw-item-pick')].map((each) => each.dataset.detail!));
    const sides = new Set<string>();
    for (const key of keys) {
      await tile(page, key).click();
      await frames(page, 1);
      const shown = await menuSeen(page);
      expect(shown, `${where} ${key}`).toMatchObject({ for: key, onScreen: true, overTile: false, overInfo: false, clipped: 0 });
      expect(shown!.lines.length, `${where} ${key}`).toBeGreaterThan(0);
      sides.add(shown!.side);
      // The sheet under it is as it was, and the info panel is about the same tile.
      expect(await places(page), `${where}: the sheet moved when the menu opened at ${key}`).toBe(before);
      expect((await about(page)).about, `${where} ${key}`).toBe(key);
      await tile(page, key).click();
      await frames(page, 1);
      expect(await menuSeen(page), `${where}: the same tile closes its menu, ${key}`).toBeNull();
    }
    // At the grid's right edge it stands left of its tile, everywhere else right of it.
    expect([...sides].sort(), where).toEqual(['left', 'right']);
  }

  // What each kind of item gets. The staged bag holds no food: one is put in for the Eat line.
  await page.evaluate(() => { (window as any).portage.session.game.players[0].backpack[0] = { itemId: 'berries', count: 3 }; });
  await page.waitForFunction(() => document.querySelector('.iw-item-pick[data-detail="backpack:berries:0"]') !== null);
  const linesOf = async (key: string): Promise<string[]> => {
    await tile(page, key).click();
    await frames(page, 1);
    const shown = await menuSeen(page);
    await page.keyboard.press('Escape');
    await frames(page, 1);
    return shown!.lines;
  };
  expect(await linesOf('backpack:berries:0')).toEqual(['Eat', 'Stow', 'Drop']);
  // The staged boat is full of stacks, so stone fits only on the boat's own stone stack. The Stow line says how
  // many still fit there, and Stow moves that many. The number is counted here from the game's state, not read
  // off the line: a stack holds 20, and the bag's stone is more than what fits.
  const stone = await read<{ aboard: number; held: number; free: number }>(page, `({
    aboard: game.canoe.cargo.filter((each) => each.itemId === 'stone').reduce((sum, each) => sum + each.count, 0),
    held: player.backpack.find((each) => each.itemId === 'stone').count,
    free: portage.app.lastModel.panel.cargo.slots.filter((slot) => slot.itemId === null).length,
  })`);
  expect(stone.free).toBe(0);
  expect(stone.aboard).toBeGreaterThan(0);
  expect(stone.aboard).toBeLessThan(20);
  expect(stone.held).toBeGreaterThan(20 - stone.aboard);
  expect(await linesOf('backpack:stone:0')).toEqual([`Stow [Room for ${20 - stone.aboard}]`, 'Drop']);
  const boatKey = await page.evaluate(() => document.querySelector<HTMLElement>('.iw-inv-boat .iw-item-pick')!.dataset.detail!);
  expect((await linesOf(boatKey)).filter((line) => line !== 'Eat' && line !== 'Drink')).toEqual(['Take', 'Drop']);
  expect(await linesOf('belt:hatchet:0')).toEqual(['Hold', 'To 1', 'To 2', 'To 4', 'To 5', 'Drop (off) [Tools stay on the belt. They are never dropped]']);
  // Alone, no line offers a give.
  for (const key of ['backpack:berries:0', boatKey, 'belt:hatchet:0']) expect((await linesOf(key)).some((line) => line.startsWith('Give'))).toBe(false);

  // Escape closed each of those menus and the inventory stayed open.
  expect(await read(page, 'portage.session.isOpen("inventory")')).toBe(true);
  // A click elsewhere on the sheet closes it.
  await tile(page, 'backpack:berries:0').click();
  await frames(page);
  expect(await menuSeen(page)).not.toBeNull();
  await page.locator('.iw-panel-inventory h2').click();
  await frames(page);
  expect(await menuSeen(page)).toBeNull();
  // While a menu is open the info panel stays on its tile, whatever the pointer crosses.
  await tile(page, 'backpack:berries:0').click();
  await tile(page, boatKey).hover();
  await frames(page);
  expect((await about(page)).about).toBe('backpack:berries:0');
  // A refused line does nothing, and the menu stays.
  await tile(page, 'belt:hatchet:0').click();
  await frames(page);
  await page.locator('.iw-tile-menu button', { hasText: 'Drop' }).click({ force: true });
  await frames(page);
  expect((await menuSeen(page))?.for).toBe('belt:hatchet:0');
  expect(await read(page, 'game.tools')).toContain('hatchet');
  // A pick does it and closes the menu.
  await tile(page, 'backpack:berries:0').click();
  await frames(page);
  await page.locator('.iw-tile-menu button', { hasText: 'Eat' }).click();
  await frames(page, 6);
  expect(await menuSeen(page)).toBeNull();
  expect(await read(page, 'player.backpack.find((stack) => stack.itemId === "berries").count')).toBe(2);
  // The inventory closes with a menu open: the menu goes with it, and is not there when it opens again.
  await tile(page, 'backpack:berries:0').click();
  await frames(page);
  await page.keyboard.press('Tab');
  await frames(page, 4);
  expect(await read(page, 'portage.session.isOpen("inventory")')).toBe(false);
  expect(await page.locator('.iw-tile-menu').count()).toBe(0);
  // The pointer off the sheet first: a pointer left over the berries' tile would rightly show them again on opening.
  await page.mouse.move(4, 4);
  await page.keyboard.press('Tab');
  await page.waitForSelector('.iw-panel-inventory');
  await frames(page, 2);
  expect(await menuSeen(page)).toBeNull();
  expect((await about(page)).text).toBe('Point at an item to read about it.');
  expect(await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running').length)).toBe(0);
  expect(problems).toEqual([]);
});

test('the keyboard alone shows a tile in the info panel, opens its menu, walks its lines, and Escape gives the tile back', async ({ page }) => {
  const problems = watch(page);
  await showInventory(page, 8);
  await page.mouse.move(4, 4);
  const held = (): Promise<string> => page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (active?.dataset.detail !== undefined) return active.dataset.detail;
    return active?.closest('.iw-tile-menu') ? `menu:${active.querySelector('.iw-label')?.textContent ?? ''}` : 'elsewhere';
  });
  // An arrow key puts the keyboard on the sheet, then Tab walks it to the first tile of the bag.
  await page.keyboard.press('ArrowDown');
  const where = (): Promise<string> => page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return active?.dataset.detail ?? `${active?.tagName.toLowerCase() ?? 'nothing'}.${String(active?.getAttribute('class') ?? '').split(' ').slice(0, 2).join('.')}`;
  });
  const road: string[] = [await where()];
  for (let press = 0; press < 12 && !(await held()).startsWith('backpack:'); press += 1) {
    await page.keyboard.press('Tab');
    road.push(await where());
  }
  await frames(page);
  const key = await held();
  road.push(await where());
  expect(key.startsWith('backpack:'), `the keyboard's road: ${road.join(' > ')}`).toBe(true);
  expect((await about(page)).about).toBe(key);
  // Enter opens the menu with the keyboard on its first line, and the arrows and Tab walk its lines and nothing else.
  await page.keyboard.press('Enter');
  await frames(page);
  expect((await menuSeen(page))?.for).toBe(key);
  expect(await held()).toBe('menu:Stow');
  await page.keyboard.press('ArrowDown');
  expect(await held()).toBe('menu:Drop');
  await page.keyboard.press('Tab');
  expect(await held()).toBe('menu:Stow');
  await page.keyboard.press('ArrowUp');
  expect(await held()).toBe('menu:Drop');
  // Escape closes the menu alone: the inventory is still open and the keyboard is back on the tile.
  await page.keyboard.press('Escape');
  await frames(page);
  expect(await menuSeen(page)).toBeNull();
  expect(await read(page, 'portage.session.isOpen("inventory")')).toBe(true);
  expect(await held()).toBe(key);
  // Enter, Enter: the first line (Stow) is pressed, the stack is in the boat, and the keyboard is not left nowhere.
  const stack = await read<{ itemId: string; count: number }>(page, 'portage.app.lastModel.panel.backpack.slots[0]');
  await page.keyboard.press('Enter');
  await frames(page);
  await page.keyboard.press('Enter');
  await frames(page, 6);
  expect(await read(page, `player.backpack.filter((each) => each.itemId === '${stack.itemId}').length`)).toBe(0);
  expect(await menuSeen(page)).toBeNull();
  expect(await held()).not.toBe('elsewhere');
  // Escape with no menu open is the session's again: the inventory closes.
  await page.keyboard.press('Escape');
  await frames(page, 4);
  expect(await read(page, 'portage.session.isOpen("inventory")')).toBe(false);
  expect(problems).toEqual([]);
});

/** A host and a guest in one canoe: two pages of one browser, no relay. */
async function crewOfTwo(browser: Browser): Promise<{ host: Page; guest: Page; close(): Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const room = `give-${Date.now().toString(36)}`;
  const inGame = (page: Page): Promise<unknown> => page.waitForFunction(() => (window as any).portage?.session.screen === 'game', undefined, { timeout: 90_000 });
  const host = await context.newPage();
  await host.goto(`${BASE}/?host=${room}&name=Luc`);
  await inGame(host);
  const guest = await context.newPage();
  await guest.goto(`${BASE}/?join=${room}&name=Sam`);
  await inGame(guest);
  await host.waitForFunction(() => {
    const players = (window as any).portage.session.game.players;
    return players.length === 2 && players[1].connected;
  });
  return { host, guest, close: () => context.close() };
}

test('Give: a host and a guest in one canoe each see a line with the other\'s name, and each reads their own note', async ({ browser }) => {
  const { host, guest, close } = await crewOfTwo(browser);
  const problems = [...watch(host), ...watch(guest)];
  const toasts = (page: Page): Promise<string[]> => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.iw-toast')].map((toast) => toast.innerText.replace(/\s+/g, ' ').trim()));
  const bags = (): Promise<string[]> => host.evaluate(() => (window as any).portage.session.game.players.map((each: any) => each.backpack.map((stack: any) => `${stack.itemId} x${stack.count}`).join(', ')));
  // The host's state is the game: both bags are set there.
  await host.evaluate(() => {
    const state = (window as any).portage.session.game;
    state.players[0].backpack = [{ itemId: 'plank', count: 5 }];
    state.players[1].backpack = [{ itemId: 'clay', count: 7 }];
  });

  // The host: Tab, a click on the planks, "Give to Sam" with Sam's toque before the words.
  await host.bringToFront();
  await host.keyboard.press('Tab');
  await host.waitForSelector('.iw-panel-inventory');
  await tile(host, 'backpack:plank:0').click();
  await frames(host);
  expect((await menuSeen(host))!.lines).toEqual(['Stow', 'Give to Sam', 'Drop']);
  expect(await host.locator('.iw-tile-menu .iw-menu-line.iw-give .iw-menu-toque svg').count()).toBe(1);
  await host.locator('.iw-tile-menu button', { hasText: 'Give to Sam' }).click();
  await host.waitForFunction(() => (window as any).portage.session.game.players[1].backpack.some((stack: any) => stack.itemId === 'plank'));
  await frames(host, 6);
  expect(await bags()).toEqual(['', 'clay x7, plank x5']);
  expect(await toasts(host)).toContain('You gave Sam 5 x Plank');
  expect(await menuSeen(host)).toBeNull();

  // The guest reads who it came from, then gives the clay to the host. The host checks it.
  await guest.bringToFront();
  await expect.poll(() => toasts(guest)).toContain('Luc gave you 5 x Plank');
  await guest.keyboard.press('Tab');
  await guest.waitForSelector('.iw-panel-inventory');
  await tile(guest, 'backpack:clay:0').click();
  await frames(guest);
  expect((await menuSeen(guest))!.lines).toEqual(['Stow', 'Give to Luc', 'Drop']);
  await guest.locator('.iw-tile-menu button', { hasText: 'Give to Luc' }).click();
  await host.waitForFunction(() => (window as any).portage.session.game.players[0].backpack.some((stack: any) => stack.itemId === 'clay'));
  expect(await bags()).toEqual(['clay x7', 'plank x5']);
  await expect.poll(() => toasts(guest)).toContain('You gave Luc 7 x Clay');
  await host.bringToFront();
  await expect.poll(() => toasts(host)).toContain('Sam gave you 7 x Clay');

  // The guest's bag full: the host's line is there, off, with its reason.
  await host.evaluate(async () => {
    const state = (window as any).portage.session.game;
    const { ITEM_IDS, isStackable } = await import(/* @vite-ignore */ `${location.origin}/src/data/items.ts`);
    state.players[1].backpack = (ITEM_IDS as string[]).filter((itemId) => isStackable(itemId) && itemId !== 'clay').slice(0, 8).map((itemId) => ({ itemId, count: 1 }));
  });
  await frames(host, 6);
  await tile(host, 'backpack:clay:0').click();
  await frames(host);
  expect((await menuSeen(host))!.lines).toEqual(['Stow', 'Give to Sam (off) [Their backpack is full]', 'Drop']);
  await host.keyboard.press('Escape');

  // The guest leaves: no Give line any more.
  await guest.close({ runBeforeUnload: true });
  await host.waitForFunction(() => !(window as any).portage.session.game.players[1]?.connected, undefined, { timeout: 30_000 });
  await frames(host, 6);
  await tile(host, 'backpack:clay:0').click();
  await frames(host);
  expect((await menuSeen(host))!.lines).toEqual(['Stow', 'Drop']);
  expect(problems).toEqual([]);
  await close();
});
