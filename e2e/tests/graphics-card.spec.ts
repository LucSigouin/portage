/**
 * The graphics card note in a real browser, headless (Round 6: a friend's Chrome had hardware acceleration off,
 * the game ran at a frame a second, and nothing told him).
 *
 * - `&card=soft`: the note is on the main menu, and on the join card an invite link opens. Its words are whole, it
 *   has no button, it lies inside the window, it covers no menu entry and no button of the card, nothing scrolls,
 *   and it does not move.
 * - `&card=real`: no note on either.
 * - no switch: no note in this driven browser, though it may well draw in software, and none in a staged shot.
 *
 * At 1920x1080 and 1366x768. Needs the dev server on http://localhost:5220, or PORTAGE_URL.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const BASE = process.env.PORTAGE_URL ?? 'http://localhost:5220';
const SIZES: [number, number][] = [[1920, 1080], [1366, 768]];
const NOTE = '.iw-card-note';
const JOIN_CARD = '.iw-panel-crew_join';
const TITLE = 'This browser is drawing without the graphics card.';
/** A code of the right shape. No room has it: the card opens all the same, and nothing here presses Join. */
const INVITE = 'ABCDEF';

test.setTimeout(120_000);

/**
 * To the main menu, as `lobby.spec` and `relay.spec` get there: the game builds its world before it draws the menu,
 * and in a headless browser that takes far longer than an `expect`'s five seconds. So wait for the menu's first
 * entry with room to spare, and for the fonts (the note's lines are measured).
 */
async function arrive(page: Page, query: string): Promise<void> {
  await page.goto(`${BASE}/${query}`);
  await page.locator('.iw-lobby-col .iw-mi').first().waitFor({ timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  // Two frames: the note is worked out at the first one.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

interface Lay {
  box: { left: number; top: number; right: number; bottom: number };
  window: { width: number; height: number };
  pageScrolls: boolean;
  scrolling: string[];
  covered: string[];
  moving: string;
}

/** Where the visible note lies, what it covers of `over` (a selector of things to press), and what scrolls. */
async function lay(page: Page, over: string): Promise<Lay> {
  return page.evaluate(({ noteSelector, overSelector }) => {
    const note = Array.from(document.querySelectorAll<HTMLElement>(noteSelector)).find((element) => element.getClientRects().length > 0)!;
    const box = note.getBoundingClientRect();
    const covered = Array.from(document.querySelectorAll<HTMLElement>(overSelector)).filter((element) => {
      const other = element.getBoundingClientRect();
      return other.width > 0 && other.left < box.right && other.right > box.left && other.top < box.bottom && other.bottom > box.top;
    }).map((element) => element.textContent?.trim().slice(0, 30) ?? element.tagName);
    const scrolling = Array.from(document.querySelectorAll<HTMLElement>('.iw *')).filter((element) => {
      const style = getComputedStyle(element);
      return /(auto|scroll)/.test(style.overflowX + style.overflowY)
        && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1);
    }).map((element) => element.className);
    const style = getComputedStyle(note);
    const root = document.documentElement;
    return {
      box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
      window: { width: innerWidth, height: innerHeight },
      pageScrolls: root.scrollWidth > innerWidth || root.scrollHeight > innerHeight,
      scrolling,
      covered,
      moving: `${style.animationName}|${style.transitionDuration}`,
    };
  }, { noteSelector: NOTE, overSelector: over });
}

function expectWellLaid(found: Lay, where: string): void {
  expect(found.box.left, `${where}: inside the window on the left`).toBeGreaterThanOrEqual(0);
  expect(found.box.top, `${where}: inside the window at the top`).toBeGreaterThanOrEqual(0);
  expect(found.box.right, `${where}: inside the window on the right`).toBeLessThanOrEqual(found.window.width);
  expect(found.box.bottom, `${where}: inside the window at the bottom`).toBeLessThanOrEqual(found.window.height);
  expect(found.pageScrolls, `${where}: the page does not scroll`).toBe(false);
  expect(found.scrolling, `${where}: nothing scrolls`).toEqual([]);
  expect(found.covered, `${where}: the note covers nothing to press`).toEqual([]);
  expect(found.moving, `${where}: the note does not move`).toBe('none|0s');
}

for (const [width, height] of SIZES) {
  test(`card=soft: the note is on the main menu and on the join card, ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });

    // The main menu.
    await arrive(page, '?card=soft');
    const onMenu = page.locator(`.iw-lobby > ${NOTE}`);
    await expect(onMenu).toBeVisible();
    await expect(onMenu).toContainText(TITLE);
    await expect(onMenu).toContainText('The game will be very slow until that is turned on.');
    await expect(onMenu).toContainText('Use graphics acceleration when available');
    await expect(onMenu.locator('button, a')).toHaveCount(0);
    await expect(page.locator(NOTE)).toHaveCount(1);
    expectWellLaid(await lay(page, '.iw-lobby-col .iw-mi, .iw-lobby-col h1'), 'the main menu');
    // It is a note, not a wall: the menu still works under it.
    await page.getByRole('button', { name: 'New Game' }).click();
    await expect(page.locator('.iw-panel-save_slots')).toBeVisible();
    await expect(page.locator(`${NOTE}:visible`), 'no note behind a card that is not the join card').toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(onMenu).toBeVisible();

    // The join card, as a friend with an invite link meets it. The dev server has a relay setting (`/relay`), so
    // the card must open: a card that is not there is a failure, never a skipped check.
    await arrive(page, `?card=soft&invite=${INVITE}`);
    const joinCard = page.locator(JOIN_CARD);
    await expect(joinCard, 'an invite link opens the join card').toBeVisible();
    const onCard = joinCard.locator(NOTE);
    await expect(onCard).toBeVisible();
    await expect(onCard).toContainText(TITLE);
    await expect(page.locator(`${NOTE}:visible`), 'one note on screen: the menu\'s steps back behind the card').toHaveCount(1);
    expectWellLaid(await lay(page, `${JOIN_CARD} button, ${JOIN_CARD} input`), 'the join card');
    const card = await joinCard.boundingBox();
    expect(card!.y, 'the card is whole in the window').toBeGreaterThanOrEqual(0);
    expect(card!.y + card!.height).toBeLessThanOrEqual(height);
    await expect(joinCard.getByRole('button', { name: 'Join', exact: true })).toBeVisible();
  });

  test(`card=real: no note anywhere, ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await arrive(page, '?card=real');
    await expect(page.locator(NOTE)).toHaveCount(0);
    await arrive(page, `?card=real&invite=${INVITE}`);
    await expect(page.locator(JOIN_CARD), 'the join card is open, so its note would show').toBeVisible();
    await expect(page.locator(NOTE)).toHaveCount(0);
  });
}

test('no switch: a driven browser and a staged shot get no note', async ({ page }) => {
  await arrive(page, '');
  await expect(page.locator(NOTE)).toHaveCount(0);
  await arrive(page, `?invite=${INVITE}`);
  await expect(page.locator(JOIN_CARD), 'the join card is open, so its note would show').toBeVisible();
  await expect(page.locator(NOTE)).toHaveCount(0);
  await arrive(page, '?shot=lobby');
  await expect(page.locator(NOTE)).toHaveCount(0);
  // And a staged shot can still be made to show it.
  await arrive(page, '?shot=lobby&card=soft');
  await expect(page.locator(`.iw-lobby > ${NOTE}`)).toBeVisible();
});
