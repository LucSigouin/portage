/**
 * A dropped stack's way back, in a real browser, headless (the master review of round 3, finding 2).
 *
 * - Q with the pointer on a tile drops the stack, and its note carries a button and a key cap: "Z Take back";
 * - the note stands over the open inventory, whole, at 1920x1080 and 1366x768, and nothing on it moves;
 * - Z puts the stack back on its slot, and so does a click on the button; the minus note goes at once;
 * - when the note has gone, Z does nothing;
 * - aboard with the inventory open, Q off every tile switches the auto-paddle; Q on a tile still only drops.
 *
 * Needs the dev server on http://localhost:5220, or PORTAGE_URL. With PORTAGE_SHOTS set to a folder, it leaves
 * pictures there.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const BASE = process.env.PORTAGE_URL ?? 'http://localhost:5220';
const SHOTS = process.env.PORTAGE_SHOTS ?? '';

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

const read = <T>(page: Page, expression: string): Promise<T> => page.evaluate(
  (body) => new Function('portage', 'game', 'player', `return (${body});`)(
    (window as any).portage, (window as any).portage.session.game, (window as any).portage.session.game.players[0],
  ) as never, expression,
) as Promise<T>;

const toasts = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...document.querySelectorAll('.iw-toast > span')].map((toast) => (toast.textContent ?? '').trim()));

const shoot = async (page: Page, name: string): Promise<void> => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

const BAG = [{ itemId: 'clay', count: 4 }, { itemId: 'stone', count: 9 }, { itemId: 'charcoal', count: 2 }];

/** The staged inventory, live, with a bag of three stacks no quest asks for. */
async function showInventory(page: Page): Promise<void> {
  await page.goto(`${BASE}/?shot=inventory&live=1`);
  await page.waitForFunction(() => (window as any).portage?.app?.lastModel?.panel?.id === 'inventory');
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate((bag) => {
    const state = (window as any).portage.session.game;
    state.pendingRewards = [];
    state.players[0].backpack = bag.map((stack) => ({ ...stack }));
  }, BAG);
  await page.waitForFunction(() => document.querySelectorAll('.iw-inv-pack .iw-item-pick').length === 3);
  await frames(page, 2);
}

const dropStone = async (page: Page): Promise<void> => {
  await page.locator('.iw-inv-pack .iw-item-pick[data-detail="backpack:stone:0"]').hover();
  await page.keyboard.press('KeyQ');
  await page.waitForFunction(() => document.querySelector('.iw-toast-offer') !== null);
};

test('the note of a dropped stack offers Z and a button, over the open inventory, at both sizes; each puts the stack back on its slot', async ({ page }) => {
  const problems = watch(page);
  for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    const where = `${size.width}x${size.height}`;
    await page.setViewportSize(size);
    await showInventory(page);
    await dropStone(page);
    expect(await read(page, 'player.backpack'), where).toEqual([BAG[0], BAG[2]]);
    expect(await toasts(page), where).toContain('-9 Stone');
    const note = await page.evaluate(() => {
      const offer = document.querySelector<HTMLElement>('.iw-toast-offer')!;
      const button = offer.querySelector<HTMLElement>('.iw-toast-act')!;
      const box = button.getBoundingClientRect();
      const whole = offer.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return {
        words: (button.textContent ?? '').trim(), keyCap: button.querySelector('kbd')?.textContent ?? '',
        onTop: top !== null && button.contains(top),
        inside: whole.left >= 0 && whole.right <= innerWidth && whole.top >= 0 && whole.bottom <= innerHeight,
        oneLine: whole.height < 2.6 * parseFloat(getComputedStyle(offer).fontSize) * 1.25,
        cut: button.scrollWidth > button.clientWidth + 1 || offer.scrollWidth > offer.clientWidth + 1,
        // The note covers no tile and no button of the sheet's.
        overSheet: [...document.querySelectorAll('.iw-panel-inventory .iw-tile, .iw-panel-inventory button')].some((element) => {
          const other = element.getBoundingClientRect();
          return other.left < whole.right && other.right > whole.left && other.top < whole.bottom && other.bottom > whole.top;
        }),
        running: document.getAnimations().filter((animation) => animation.playState === 'running').length,
        transition: getComputedStyle(button).transitionDuration, animation: getComputedStyle(button).animationName,
        pageScrolls: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
      };
    });
    expect(note, where).toEqual({
      words: 'ZTake back', keyCap: 'Z', onTop: true, inside: true, oneLine: true, cut: false, overSheet: false, running: 0,
      transition: '0s', animation: 'none', pageScrolls: false,
    });
    await shoot(page, `drop-note-${where}`);

    // Z: the stone is back on the slot it left. The minus note is gone, a plus note stands.
    await page.mouse.move(4, 4);
    await page.keyboard.press('KeyZ');
    await page.waitForFunction(() => (window as any).portage.session.game.players[0].backpack.length === 3);
    await frames(page, 3);
    expect(await read(page, 'player.backpack'), where).toEqual(BAG);
    expect(await toasts(page), where).toContain('+9 Stone');
    expect(await toasts(page), where).not.toContain('-9 Stone');
    expect(await page.locator('.iw-toast-offer').count(), where).toBe(0);
    expect(await read(page, 'portage.session.isOpen("inventory")'), where).toBe(true);
    await shoot(page, `drop-taken-back-${where}`);

    // Again, by a click on the note's button.
    await dropStone(page);
    await page.locator('.iw-toast-act').click();
    await page.waitForFunction(() => (window as any).portage.session.game.players[0].backpack.length === 3);
    await frames(page, 3);
    expect(await read(page, 'player.backpack'), where).toEqual(BAG);
    expect(await page.locator('.iw-toast-offer').count(), where).toBe(0);
  }
  expect(problems).toEqual([]);
});

test('when the note has gone, Z does nothing; and Z with no note is nobody\'s key', async ({ page }) => {
  const problems = watch(page);
  await showInventory(page);
  // No note yet: Z is not a game key, and nothing happens.
  await page.keyboard.press('KeyZ');
  await frames(page, 3);
  expect(await read(page, 'player.backpack')).toEqual(BAG);
  await dropStone(page);
  await page.waitForFunction(() => document.querySelector('.iw-toast-offer') === null, null, { timeout: 15_000 });
  expect(await toasts(page)).not.toContain('-9 Stone');
  await page.keyboard.press('KeyZ');
  await frames(page, 6);
  expect(await read(page, 'player.backpack')).toEqual([BAG[0], BAG[2]]);
  expect(await read(page, 'portage.session.isOpen("inventory")')).toBe(true);
  expect(problems).toEqual([]);
});

test('aboard with the inventory open, Q off every tile switches the auto-paddle, and Q on a tile only drops', async ({ page }) => {
  const problems = watch(page);
  await page.goto(`${BASE}/?shot=play&live=1`);
  await page.waitForFunction(() => (window as any).portage?.app?.lastModel?.hud !== null && (window as any).portage?.session?.game);
  await page.evaluate(() => document.fonts.ready);
  expect(await read(page, 'player.mode')).toBe('canoe');
  await page.evaluate(() => {
    (window as any).portage.session.game.canoe.cargo = [{ itemId: 'stone', count: 9 }, { itemId: 'clay', count: 4 }];
  });
  await page.mouse.move(4, 4);
  // In play: Q starts the paddle.
  await page.keyboard.press('KeyQ');
  await frames(page);
  expect(await read(page, 'portage.session.input.autoPaddle')).toBe(true);
  // Tab: the inventory. The pointer is on no tile: Q stops the paddle, and the inventory stays.
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => document.querySelectorAll('.iw-inv-boat .iw-item-pick').length === 2);
  await page.keyboard.press('KeyQ');
  await frames(page, 4);
  expect(await read(page, 'portage.session.input.autoPaddle')).toBe(false);
  expect(await read(page, 'portage.session.isOpen("inventory")')).toBe(true);
  expect(await toasts(page)).toContain('Paddling off.');
  expect(await read(page, 'game.canoe.cargo.length')).toBe(2);
  await shoot(page, 'aboard-q-off-a-tile');
  // And starts it again.
  await page.keyboard.press('KeyQ');
  await frames(page, 4);
  expect(await read(page, 'portage.session.input.autoPaddle')).toBe(true);
  // On a tile, Q is the drop key and nothing else: the stack goes, the paddle is as it was.
  await page.locator('.iw-inv-boat .iw-item-pick[data-detail="cargo:stone:0"]').hover();
  await page.keyboard.press('KeyQ');
  await page.waitForFunction(() => document.querySelector('.iw-toast-offer') !== null);
  expect(await read(page, 'game.canoe.cargo')).toEqual([{ itemId: 'clay', count: 4 }]);
  expect(await read(page, 'portage.session.input.autoPaddle')).toBe(true);
  // Z brings it back to the cargo, on its slot.
  await page.keyboard.press('KeyZ');
  await page.waitForFunction(() => (window as any).portage.session.game.canoe.cargo.length === 2);
  expect(await read(page, 'game.canoe.cargo')).toEqual([{ itemId: 'stone', count: 9 }, { itemId: 'clay', count: 4 }]);
  expect(await read(page, 'portage.session.input.autoPaddle')).toBe(true);
  expect(await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running').length)).toBe(0);
  expect(problems).toEqual([]);
});
