/**
 * The pick screen in a real browser: who you are, one of four, before a new game and before a join.
 *
 * - A new game goes slot, screen, game, and the player is the one picked. Nothing starts before the button.
 * - Back (the button, and Esc) returns to the door, with what was typed still there, and nothing was dialled.
 * - The keys: Left and Right move the mark, Enter starts, Tab walks card, card, card, card, button, Back.
 * - Nothing on the sheet moves, it is whole at both sizes and at every interface size, and a picture arriving
 *   changes no size.
 * - A reload keeps the pick: Continue is the same person, and the next new game has that card marked.
 * - Two browsers: each sees who the other picked. This one needs the relay, as `relay.spec.ts` does.
 *
 * Needs the dev server on http://localhost:5220, or PORTAGE_URL. The last test also needs the local relay
 * (`relay/`, `npm run dev`, port 8791) and a dev server that knows it, exactly as `relay.spec.ts`:
 *   PORTAGE_URL=http://localhost:5222 npm --prefix <worktree>/e2e test -- cast.spec.ts
 * On a server with no crew entries in its menu that test says so and is skipped.
 */
import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';

const BASE = process.env.PORTAGE_URL ?? 'http://localhost:5220';

test.use({
  viewport: { width: 1280, height: 720 },
  // Render on the graphics card: the software fallback runs at about one frame a second.
  launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
});
test.setTimeout(180_000);

const CAST = ['voyageur', 'trapper', 'angler', 'scout'];
const SHEET = '.iw-panel-character_select';
const PICK_SLOT = 'portage.cast.pick';
const CODE_SHOWN = /^[FHJKLMQRTWXY34679]{3}-[FHJKLMQRTWXY34679]{3}$/;

interface Seen {
  screen: string;
  open: string[];
  role: 'host' | 'guest' | 'solo';
  /** Who each player picked to be, in seat order. Null: nobody picked for them. */
  picks: (string | null)[];
  names: string[];
  slot: number | null;
  kept: string | null;
  saves: number;
}

function read(page: Page): Promise<Seen> {
  return page.evaluate((pickSlot) => {
    const { session } = (window as unknown as { portage: { session: any } }).portage;
    const game = session.game;
    return {
      screen: session.screen,
      open: [...session.panels.stack],
      role: session.host ? 'host' : session.guest ? 'guest' : 'solo',
      picks: game ? game.players.map((player: any) => player.character ?? null) : [],
      names: game ? game.players.map((player: any) => player.name) : [],
      slot: session.slot,
      kept: localStorage.getItem(pickSlot),
      saves: Object.keys(localStorage).filter((key) => key.startsWith('portage.save.')).length,
    };
  }, PICK_SLOT);
}

/** The lobby, drawn, with every console error and page error collected. */
async function arrive(page: Page, address = `${BASE}/`): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  await page.goto(address);
  await page.waitForFunction(() => (window as unknown as { portage?: unknown }).portage !== undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.iw-lobby-col .iw-mi').first().waitFor();
  return problems;
}

const inGame = (page: Page): Promise<unknown> =>
  page.waitForFunction(() => (window as unknown as { portage: { session: any } }).portage.session.screen === 'game', undefined, { timeout: 30_000 });

/** The lobby's New Game, then the first empty slot (`nth`): the pick screen is up after it. */
async function toTheScreen(page: Page, nth = 0): Promise<void> {
  await page.getByRole('button', { name: 'New Game' }).click();
  await page.locator('.iw-panel-save_slots').getByRole('button', { name: 'New game here' }).nth(nth).click();
  await expect(page.locator(SHEET)).toBeVisible();
}

const card = (page: Page, character: string) => page.locator(`${SHEET} .cs-card[data-character="${character}"]`);

/**
 * The game draws the interface in its own frame, not in the click: a click or a key shows on the sheet at the
 * game's next frame, and a headless browser asks its question sooner than that. So wait for that frame: the app
 * builds a new model every frame and draws it in the same step, so a new model means the sheet was drawn again.
 */
async function drawn(page: Page): Promise<void> {
  const before = await page.evaluateHandle(() => (window as unknown as { portage: { app: { lastModel: unknown } } }).portage.app.lastModel);
  await page.waitForFunction((model) => (window as unknown as { portage: { app: { lastModel: unknown } } }).portage.app.lastModel !== model, before);
  await before.dispose();
}

/** The card marked, as a screen reader hears it and as it is drawn. They must agree. */
async function marked(page: Page): Promise<string> {
  // The sheet as the game has drawn it since the last click or key (`drawn`), never the frame before.
  await expect(page.locator(SHEET)).toBeVisible();
  await drawn(page);
  const seen = await page.evaluate((sheet) => ({
    checked: [...document.querySelectorAll(`${sheet} [role="radio"][aria-checked="true"]`)].map((each) => (each as HTMLElement).dataset.character),
    drawn: [...document.querySelectorAll(`${sheet} .cs-card.cs-marked`)].map((each) => (each as HTMLElement).dataset.character),
    ticks: [...document.querySelectorAll(`${sheet} .cs-card`)].filter((each) => getComputedStyle(each.querySelector('.cs-tick')!).visibility === 'visible')
      .map((each) => (each as HTMLElement).dataset.character),
  }), SHEET);
  expect(seen.checked).toHaveLength(1);
  expect(seen.drawn).toEqual(seen.checked);
  expect(seen.ticks).toEqual(seen.checked);
  return seen.checked[0]!;
}

/** What has the keyboard: a card's character, or the words on a button. */
const focused = (page: Page): Promise<string> => page.evaluate(() => {
  const element = document.activeElement as HTMLElement | null;
  return element?.dataset.character ?? element?.textContent?.trim() ?? '';
});

/** Where everything on the sheet is, to the hundredth of a pixel. */
const boxes = (page: Page): Promise<Record<string, number[]>> => page.evaluate((sheet) => {
  const out: Record<string, number[]> = {};
  const all = [sheet, `${sheet} .cs-cards`, `${sheet} .cs-note`, `${sheet} .cs-start`, `${sheet} .cs-back`];
  for (const selector of all) {
    const box = document.querySelector(selector)!.getBoundingClientRect();
    out[selector] = [box.left, box.top, box.width, box.height].map((value) => Math.round(value * 100) / 100);
  }
  document.querySelectorAll(`${sheet} .cs-card`).forEach((each, index) => {
    for (const part of ['', '.cs-frame', '.cs-name', '.cs-line']) {
      const box = (part ? each.querySelector(part)! : each).getBoundingClientRect();
      out[`card ${index} ${part}`] = [box.left, box.top, box.width, box.height].map((value) => Math.round(value * 100) / 100);
    }
  });
  return out;
}, SHEET);

/** Run in the page: what is wrong with the sheet's place on the screen. */
function sheetProblems(sheet: string): string[] {
  const problems: string[] = [];
  const page = document.documentElement;
  const rem = parseFloat(getComputedStyle(page).fontSize);
  if (page.scrollWidth > window.innerWidth || page.scrollHeight > window.innerHeight) problems.push(`the page scrolls: ${page.scrollWidth} x ${page.scrollHeight}`);
  const panel = document.querySelector(sheet);
  if (!panel) return ['the sheet is not on the page'];
  const edge = panel.getBoundingClientRect();
  if (edge.left < 0 || edge.top < 0 || edge.right > window.innerWidth || edge.bottom > window.innerHeight) {
    problems.push(`the sheet is off the screen: ${Math.round(edge.left)},${Math.round(edge.top)} to ${Math.round(edge.right)},${Math.round(edge.bottom)}`);
  }
  for (const element of [panel, ...panel.querySelectorAll('*')]) {
    if (element.closest('svg')) continue;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.display === 'inline') continue;
    const name = `${element.tagName.toLowerCase()}.${String(element.getAttribute('class') ?? '').split(' ').slice(0, 2).join('.')}`;
    if (/(auto|scroll)/.test(style.overflowX + style.overflowY) && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)) {
      problems.push(`has a scroll bar: ${name}`);
    }
    if (element.scrollWidth > element.clientWidth + 1 && style.overflowX !== 'visible') problems.push(`cut off sideways: ${name}`);
    const box = element.getBoundingClientRect();
    // The tape stands over the sheet's top edge: 0.5 rem over it and turned 3 or 4 degrees, 0.63 rem in all
    // (`theme.css`). It is drawn in rem like the rest of the sheet, so its allowance is in rem too: 0.7 rem, which
    // is the 14 px of before at 1920x1080 at interface size 1, less on a smaller sheet and more on a larger one.
    const above = element.classList.contains('iw-tape') ? 0.7 * rem : 14;
    if (box.width > 0 && (box.left < edge.left - 1 || box.right > edge.right + 14 || box.top < edge.top - above || box.bottom > edge.bottom + 1)) {
      // (The tick sits on its card's corner, and the tape on the sheet's edge: both inside this allowance.)
      problems.push(`outside the sheet: ${name}`);
    }
  }
  const cards = [...panel.querySelectorAll('.cs-card')].map((each) => each.getBoundingClientRect());
  if (cards.length !== 4) problems.push(`${cards.length} cards`);
  for (const each of cards) {
    if (Math.abs(each.top - cards[0]!.top) > 0.5 || Math.abs(each.height - cards[0]!.height) > 0.5 || Math.abs(each.width - cards[0]!.width) > 0.5) {
      problems.push('the cards are not side by side, all one size');
    }
  }
  return problems;
}

test('a new game: slot, then the screen, then the game starts as the pick', async ({ page }) => {
  const problems = await arrive(page);
  await toTheScreen(page);
  // The sheet: its name, where it leads, four choices in the cast's order, the first one marked.
  await expect(page.locator(`${SHEET} h2`)).toHaveText('Pick who you are');
  await expect(page.locator(`${SHEET} .iw-sub`)).toHaveText('A new game in slot 1');
  const group = page.getByRole('radiogroup', { name: 'Who you are' });
  await expect(group.getByRole('radio')).toHaveCount(4);
  expect(await group.getByRole('radio').evaluateAll((cards) => cards.map((each) => (each as HTMLElement).dataset.character))).toEqual(CAST);
  for (const name of ['The Voyageur', 'The Trapper', 'The Angler', 'The Scout']) await expect(group.getByRole('radio', { name })).toHaveCount(1);
  expect(await marked(page)).toBe('voyageur');
  await expect(page.locator(`${SHEET} .cs-start`)).toHaveText('Start as The Voyageur');
  // Nothing has started, and nothing is saved or kept.
  expect(await read(page)).toMatchObject({ screen: 'lobby', open: ['save_slots', 'character_select'], picks: [], saves: 0, kept: null });

  // A click marks a card. The button names it. Still nothing has started.
  await card(page, 'trapper').click();
  expect(await marked(page)).toBe('trapper');
  await expect(page.locator(`${SHEET} .cs-start`)).toHaveText('Start as The Trapper');
  expect(await read(page)).toMatchObject({ screen: 'lobby', picks: [], saves: 0, kept: null });

  await page.locator(`${SHEET} .cs-start`).click();
  await inGame(page);
  expect(await read(page)).toMatchObject({ screen: 'game', open: [], role: 'solo', picks: ['trapper'], slot: 0, kept: 'trapper' });
  expect(problems).toEqual([]);
});

test('Back and Esc return to the door, with what was typed still there, and nothing was started or dialled', async ({ page }) => {
  const sockets: string[] = [];
  page.on('websocket', (socket) => sockets.push(socket.url()));
  const problems = await arrive(page);

  // From a new game: back at the save slots.
  await toTheScreen(page, 1);
  await card(page, 'scout').click();
  await page.locator(`${SHEET} .cs-back`).click();
  await expect(page.locator(SHEET)).toHaveCount(0);
  await expect(page.locator('.iw-panel-save_slots')).toBeVisible();
  expect(await read(page)).toMatchObject({ screen: 'lobby', open: ['save_slots'], picks: [], saves: 0, kept: null });
  // And again by Esc. The mark was not kept: the first card is marked again.
  await page.locator('.iw-panel-save_slots').getByRole('button', { name: 'New game here' }).first().click();
  expect(await marked(page)).toBe('voyageur');
  await page.keyboard.press('Escape');
  await expect(page.locator(SHEET)).toHaveCount(0);
  expect(await read(page)).toMatchObject({ screen: 'lobby', open: ['save_slots'], saves: 0, kept: null });
  await page.keyboard.press('Escape');

  // From a join: back at the join card, the code and the name still on their lines. (A server with no relay has no such door.)
  const join = page.getByRole('button', { name: 'Join a crew' });
  if (await join.count() > 0) {
    await join.click();
    const joinCard = page.locator('.iw-panel-crew_join');
    await joinCard.getByLabel('Crew code').fill('QRT-WXY');
    await joinCard.getByLabel('Your name').fill('Sam');
    await joinCard.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(page.locator(SHEET)).toBeVisible();
    await expect(page.locator(`${SHEET} .iw-sub`)).toHaveText('Joining crew QRT-WXY as Sam');
    await expect(page.locator(`${SHEET} .cs-start`)).toHaveText('Join as The Voyageur');
    await card(page, 'angler').click();
    await expect(page.locator(`${SHEET} .cs-start`)).toHaveText('Join as The Angler');
    await page.locator(`${SHEET} .cs-back`).click();
    await expect(page.locator(SHEET)).toHaveCount(0);
    await expect(joinCard).toBeVisible();
    await expect(joinCard.getByLabel('Crew code')).toHaveValue('QRT-WXY');
    await expect(joinCard.getByLabel('Your name')).toHaveValue('Sam');
    await expect(joinCard.getByRole('button', { name: 'Join', exact: true })).toBeEnabled();
    expect(await read(page)).toMatchObject({ screen: 'lobby', open: ['crew_join'], role: 'solo', kept: null });
    expect(sockets.filter((address) => address.includes('/room/')), 'nothing is dialled before the pick').toEqual([]);
  }
  expect(problems).toEqual([]);
});

test('the keys: Left and Right move the mark, Tab walks the sheet in order, Enter starts', async ({ page }) => {
  const problems = await arrive(page);
  // To the screen by keyboard alone: down to New Game (with no save, Continue is not a stop), in, and the first slot.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'New Game' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.iw-panel-save_slots').getByRole('button', { name: 'New game here' }).first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator(SHEET)).toBeVisible();
  // The keyboard starts on the marked card.
  await expect(card(page, 'voyageur')).toBeFocused();

  // Right, Right: the mark moves, and the keyboard with it.
  await page.keyboard.press('ArrowRight');
  expect(await marked(page)).toBe('trapper');
  await expect(card(page, 'trapper')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  expect(await marked(page)).toBe('angler');
  // Left three times: back, back, and round the end to the last.
  for (const want of ['trapper', 'voyageur', 'scout']) {
    await page.keyboard.press('ArrowLeft');
    expect(await marked(page)).toBe(want);
    await expect(card(page, want)).toBeFocused();
  }
  await expect(page.locator(`${SHEET} .cs-start`)).toHaveText('Start as The Scout');
  // And Right from the last is the first.
  await page.keyboard.press('ArrowRight');
  expect(await marked(page)).toBe('voyageur');

  // Tab from the first card: card, card, card, the button, Back. Tab moves the keyboard, never the mark.
  const walk: string[] = [await focused(page)];
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press('Tab');
    walk.push(await focused(page));
  }
  expect(walk).toEqual(['voyageur', 'trapper', 'angler', 'scout', 'Start as The Voyageur', 'Back']);
  expect(await marked(page)).toBe('voyageur');
  // Enter on Back is Back's own.
  await page.keyboard.press('Enter');
  await expect(page.locator(SHEET)).toHaveCount(0);
  expect(await read(page)).toMatchObject({ screen: 'lobby', open: ['save_slots'], saves: 0 });

  // In again. Enter on a card that is not the marked one marks it, and a second Enter starts as that one.
  await page.keyboard.press('Enter');
  await expect(card(page, 'voyageur')).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(card(page, 'angler')).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await marked(page)).toBe('angler');
  expect((await read(page)).screen).toBe('lobby');
  await page.keyboard.press('Enter');
  await inGame(page);
  expect(await read(page)).toMatchObject({ picks: ['angler'], kept: 'angler', slot: 0 });
  expect(problems).toEqual([]);
});

test('nothing on the sheet moves, under the pointer or by itself', async ({ page }) => {
  await arrive(page);
  await toTheScreen(page);
  const still = (): Promise<{ running: number; eased: string[] }> => page.evaluate((sheet) => ({
    running: document.getAnimations().filter((animation) => animation.playState === 'running').length,
    // Everything on the sheet that would take time to change. (`all 0s` is the browser's way of saying none.)
    eased: [document.querySelector(sheet)!, ...document.querySelectorAll(`${sheet} *`)].filter((element) => {
      const style = getComputedStyle(element);
      return style.transitionDuration.split(',').some((time) => Number.parseFloat(time) > 0) || style.animationName !== 'none';
    }).map((element) => `${element.tagName.toLowerCase()}.${element.getAttribute('class')}`),
  }), SHEET);
  expect(await still()).toEqual({ running: 0, eased: [] });

  // The pointer over a card that is not marked: its frame's ink changes, and nothing changes place or size.
  const before = await boxes(page);
  const inkBefore = await card(page, 'angler').evaluate((each) => getComputedStyle(each).borderTopColor);
  await card(page, 'angler').hover();
  expect(await still()).toEqual({ running: 0, eased: [] });
  expect(await boxes(page)).toEqual(before);
  expect(await card(page, 'angler').evaluate((each) => getComputedStyle(each).borderTopColor)).not.toBe(inkBefore);
  expect(await card(page, 'angler').evaluate((each) => getComputedStyle(each).transform)).toBe('none');
  // Over the two buttons: they do not lift.
  for (const button of ['.cs-start', '.cs-back']) {
    await page.locator(`${SHEET} ${button}`).hover();
    expect(await still()).toEqual({ running: 0, eased: [] });
    expect(await page.locator(`${SHEET} ${button}`).evaluate((each) => getComputedStyle(each).transform)).toBe('none');
    expect(await boxes(page)).toEqual(before);
  }
  // Marking another card changes ink and the words on the button, and no size.
  await card(page, 'scout').click();
  await page.mouse.move(2, 2);
  const after = await boxes(page);
  for (const [name, box] of Object.entries(before)) {
    if (name.endsWith('.cs-start') || name.endsWith('.cs-back')) continue; // "Start as The Scout" is shorter than "… The Voyageur"
    expect(after[name], name).toEqual(box);
  }
});

for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 800, height: 450 }]) {
  test(`whole at ${size.width}x${size.height}, at every interface size, with no scroll bar`, async ({ page }) => {
    await page.setViewportSize(size);
    await arrive(page, `${BASE}/?shot=cast`);
    await expect(page.locator(SHEET)).toBeVisible();
    for (const scale of [0.75, 1, 1.25, 1.5]) {
      await page.evaluate((uiScale) => {
        const { session } = (window as unknown as { portage: { session: any } }).portage;
        session.updateSettings({ ...session.settings, accessibility: { ...session.settings.accessibility, uiScale } });
      }, scale);
      await page.waitForTimeout(250);
      // A frame of a new size gets its new pictures once the size has held still a quarter of a second
      // (`SETTLE_MILLISECONDS`, the lobby sketch's rule). Until then the old ones lie in the frames, cut to them.
      // Wait for the pictures of this size (the game's own rounding, `sketchPixels`), or for none at all.
      await expect.poll(() => page.evaluate((sheet) => {
        const seen = (window as unknown as { portage: { cast: { report(): { pictures: number; size: { width: number; height: number } | null } } } }).portage.cast.report();
        if (seen.pictures === 0 || seen.size === null) return 'no pictures';
        const box = document.querySelector(`${sheet} .cs-slot`)!.getBoundingClientRect();
        const ratio = window.devicePixelRatio || 1;
        const width = Math.floor(Math.floor(box.width + 1e-6) * ratio + 1e-6);
        const height = Math.floor(Math.floor(box.height + 1e-6) * ratio + 1e-6);
        return seen.size.width === width && seen.size.height === height ? 'pictures of this size' : `pictures of ${seen.size.width}x${seen.size.height} in frames of ${width}x${height}`;
      }, SHEET), { message: `interface size ${scale}: the pictures of the new size`, timeout: 5000 }).toMatch(/^(no pictures|pictures of this size)$/);
      expect(await page.evaluate(sheetProblems, SHEET), `interface size ${scale}`).toEqual([]);
      // Every card's words are drawn inside the card.
      const spills = await page.evaluate((sheet) => [...document.querySelectorAll(`${sheet} .cs-card`)].filter((each) => {
        const edge = each.getBoundingClientRect();
        return [...each.querySelectorAll('.cs-name, .cs-line')].some((words) => {
          const range = document.createRange();
          range.selectNodeContents(words);
          return [...range.getClientRects()].some((box) => box.left < edge.left - 0.5 || box.right > edge.right + 0.5 || box.bottom > edge.bottom + 0.5);
        });
      }).map((each) => (each as HTMLElement).dataset.character), SHEET);
      expect(spills, `interface size ${scale}: words outside their card`).toEqual([]);
    }
  });
}

test('the pictures: asked for once for all four, after the third frame, and a picture arriving moves nothing', async ({ page }) => {
  await arrive(page, `${BASE}/?shot=cast`);
  await expect(page.locator(SHEET)).toBeVisible();
  await page.waitForTimeout(600);
  type Report = { shown: boolean; pictures: number; draws: number; drawnAfterFrame: number; asked: { characters: string[]; seat: number; pixelWidth: number; pixelHeight: number } | null };
  const report = (): Promise<Report> => page.evaluate(() => (window as unknown as { portage: { cast: { report(): Report } } }).portage.cast.report());
  const first = await report();
  // Asked once, for all four in the cast's order, in seat 0's colour, at the frame's own size in real pixels.
  expect(first).toMatchObject({ shown: true, draws: 1, asked: { characters: CAST, seat: 0 } });
  expect(first.drawnAfterFrame).toBeGreaterThanOrEqual(3);
  const frame = await page.locator(`${SHEET} .cs-frame`).first().evaluate((each) => {
    const box = each.querySelector('.cs-slot')!.getBoundingClientRect();
    return { width: Math.round(box.width * devicePixelRatio), height: Math.round(box.height * devicePixelRatio) };
  });
  expect(Math.abs(first.asked!.pixelWidth - frame.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(first.asked!.pixelHeight - frame.height)).toBeLessThanOrEqual(1);
  // With pictures or without, the sheet is whole: a letter stands in each frame that has no picture.
  if (first.pictures === 0) {
    expect(await page.locator(`${SHEET} .cs-initial`).evaluateAll((letters) => letters.map((each) => [each.textContent, getComputedStyle(each).visibility]))).toEqual(
      [['V', 'visible'], ['T', 'visible'], ['A', 'visible'], ['S', 'visible']]);
  }
  // Nothing is asked again while nothing changes size.
  await page.waitForTimeout(1200);
  expect((await report()).draws).toBe(1);

  // A stand-in picture laid in each frame (the game never does this: the handle is for tests and staged shots).
  const before = await boxes(page);
  await page.evaluate(() => {
    (window as unknown as { portage: { cast: { drawWith(draw: (request: any) => HTMLCanvasElement[]): void } } }).portage.cast.drawWith((request) =>
      request.characters.map((_: string, index: number) => {
        const canvas = document.createElement('canvas');
        canvas.width = request.pixelWidth;
        canvas.height = request.pixelHeight;
        const context = canvas.getContext('2d')!;
        context.fillStyle = ['#7a4a2a', '#2f5d50', '#3b5b8c', '#8c6a1f'][index]!;
        context.fillRect(Math.round(canvas.width * 0.3), Math.round(canvas.height * 0.12), Math.round(canvas.width * 0.4), Math.round(canvas.height * 0.88));
        return canvas;
      }));
  });
  await expect.poll(async () => (await report()).pictures).toBe(4);
  expect((await report()).draws).toBe(2);
  expect(await boxes(page)).toEqual(before);
  // Each picture is one pixel a pixel, on whole screen pixels, and the letter under it is hidden.
  const pictures = await page.locator(`${SHEET} .cs-pic`).evaluateAll((canvases) => canvases.map((each) => {
    const canvas = each as HTMLCanvasElement;
    const box = canvas.getBoundingClientRect();
    return {
      onePixelAPixel: Math.abs(box.width * devicePixelRatio - canvas.width) < 0.01 && Math.abs(box.height * devicePixelRatio - canvas.height) < 0.01,
      offWholePixel: Math.max(Math.abs(box.left * devicePixelRatio - Math.round(box.left * devicePixelRatio)), Math.abs(box.top * devicePixelRatio - Math.round(box.top * devicePixelRatio))),
      letter: getComputedStyle(canvas.closest('.cs-frame')!.querySelector('.cs-initial')!).visibility,
    };
  }));
  expect(pictures).toHaveLength(4);
  for (const picture of pictures) {
    expect(picture.onePixelAPixel).toBe(true);
    expect(picture.offWholePixel).toBeLessThan(0.02);
    expect(picture.letter).toBe('hidden');
  }
  // Back and in again: the pictures are kept, and nothing is drawn again.
  await page.keyboard.press('Escape');
  await expect(page.locator(SHEET)).toHaveCount(0);
  await page.locator('.iw-panel-save_slots').getByRole('button', { name: 'New game here' }).first().click();
  await expect.poll(async () => (await report()).pictures).toBe(4);
  expect((await report()).draws).toBe(2);
});

test('a reload keeps the pick: Continue is the same person, and the next new game has that card marked', async ({ page }) => {
  const problems = await arrive(page);
  await toTheScreen(page);
  await card(page, 'scout').click();
  await page.locator(`${SHEET} .cs-start`).click();
  await inGame(page);
  // Out by the pause menu, so the game is saved as a player would save it.
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await page.locator('.iw-panel-pause').getByRole('button', { name: 'Save and quit to the lobby' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Save and quit' }).click();
  await expect.poll(async () => (await read(page)).screen).toBe('lobby');
  expect(await read(page)).toMatchObject({ saves: 1, kept: 'scout' });

  await page.reload();
  await page.waitForFunction(() => (window as unknown as { portage?: unknown }).portage !== undefined);
  await page.locator('.iw-lobby-col .iw-mi').first().waitFor();
  // Continue: no screen, and the same person.
  await page.getByRole('button', { name: 'Continue' }).click();
  await inGame(page);
  expect(await read(page)).toMatchObject({ open: [], picks: ['scout'], slot: 0 });
  await expect(page.locator(SHEET)).toHaveCount(0);

  // After another reload, a new game in the next slot: last time's pick is the one marked.
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { portage?: unknown }).portage !== undefined);
  await page.locator('.iw-lobby-col .iw-mi').first().waitFor();
  await toTheScreen(page);
  await expect(page.locator(`${SHEET} .iw-sub`)).toHaveText('A new game in slot 2');
  expect(await marked(page)).toBe('scout');
  await expect(page.locator(`${SHEET} .cs-start`)).toHaveText('Start as The Scout');
  expect(problems).toEqual([]);
});

test('a slot that holds a game asks to confirm first, then the screen, then the new game', async ({ page }) => {
  await arrive(page);
  await toTheScreen(page);
  await page.locator(`${SHEET} .cs-start`).click();
  await inGame(page);
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await page.locator('.iw-panel-pause').getByRole('button', { name: 'Save and quit to the lobby' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Save and quit' }).click();
  await expect.poll(async () => (await read(page)).screen).toBe('lobby');
  await page.getByRole('button', { name: 'New Game' }).click();
  // The slot holds a game now: its button asks first, as it always has.
  await page.locator('.iw-panel-save_slots').getByRole('button', { name: 'New game (overwrite)' }).click();
  const ask = page.getByRole('alertdialog', { name: 'Start over in this slot?' });
  await expect(ask).toBeVisible();
  await expect(page.locator(SHEET)).toHaveCount(0);
  // No: back at the slots, and no screen.
  await ask.getByRole('button').nth(1).click();
  await expect(ask).toHaveCount(0);
  await expect(page.locator(SHEET)).toHaveCount(0);
  // Yes: the screen. The old game is still in its slot until the button is pressed.
  await page.locator('.iw-panel-save_slots').getByRole('button', { name: 'New game (overwrite)' }).click();
  await ask.getByRole('button', { name: 'Start new game' }).click();
  await expect(page.locator(SHEET)).toBeVisible();
  await expect(page.locator(`${SHEET} .iw-sub`)).toHaveText('A new game in slot 1');
  expect(await read(page)).toMatchObject({ screen: 'lobby', saves: 1, picks: [] });
  // Back from here is the slots again, the old game untouched.
  await page.locator(`${SHEET} .cs-back`).click();
  await expect(page.locator('.iw-panel-save_slots').getByRole('button', { name: 'Load' })).toHaveCount(1);
  await page.locator('.iw-panel-save_slots').getByRole('button', { name: 'New game (overwrite)' }).click();
  await ask.getByRole('button', { name: 'Start new game' }).click();
  await card(page, 'angler').click();
  await page.locator(`${SHEET} .cs-start`).click();
  await inGame(page);
  expect(await read(page)).toMatchObject({ picks: ['angler'], slot: 0 });
});

// --- Two browsers ------------------------------------------------------------------

const profile = (browser: Browser): Promise<BrowserContext> =>
  browser.newContext({ viewport: { width: 800, height: 450 }, permissions: ['clipboard-read', 'clipboard-write'] });

test('two browsers: the host starts as one, the guest joins as another through the screen, and each sees who the other is', async ({ browser }) => {
  const hostContext = await profile(browser);
  const host = await hostContext.newPage();
  const problems = await arrive(host);
  test.skip(await host.getByRole('button', { name: 'Host a crew' }).count() === 0,
    'this server was started with no relay, so it has no crew entries: run this one as relay.spec.ts is run');

  // The host: a room, then a new game from the room card, as The Trapper.
  await host.getByRole('button', { name: 'Host a crew' }).click();
  const room = host.locator('.iw-panel-crew_host');
  await room.getByLabel('Your name').fill('Luc');
  await room.getByRole('button', { name: 'Open a room' }).click();
  await expect(room.locator('.iw-code')).toBeVisible({ timeout: 15_000 });
  const shown = await room.locator('.iw-code').innerText();
  expect(shown).toMatch(CODE_SHOWN);
  await room.getByRole('button', { name: 'New Game' }).click();
  await host.locator('.iw-panel-save_slots').getByRole('button', { name: 'New game here' }).first().click();
  await expect(host.locator(SHEET)).toBeVisible();
  await card(host, 'trapper').click();
  await host.locator(`${SHEET} .cs-start`).click();
  await inGame(host);
  expect(await read(host)).toMatchObject({ role: 'host', picks: ['trapper'], names: ['Luc'] });

  // The guest: the invite link, a name, Enter, then the screen. Nothing is dialled until the pick.
  const guestContext = await profile(browser);
  const guest = await guestContext.newPage();
  const sockets: string[] = [];
  guest.on('websocket', (socket) => sockets.push(socket.url()));
  problems.push(...await arrive(guest, `${BASE}/?invite=${shown.replace('-', '')}`));
  await expect(guest.locator('.iw-panel-crew_join')).toBeVisible();
  await guest.keyboard.type('Sam');
  await guest.keyboard.press('Enter');
  await expect(guest.locator(SHEET)).toBeVisible();
  await expect(guest.locator(`${SHEET} .iw-sub`)).toHaveText(`Joining crew ${shown} as Sam`);
  expect(sockets.filter((address) => address.includes('/room/')), 'nothing is dialled before the pick').toEqual([]);
  expect(await guest.evaluate(sheetProblems, SHEET), 'the sheet at 800x450').toEqual([]);
  await card(guest, 'scout').click();
  await expect(guest.locator(`${SHEET} .cs-start`)).toHaveText('Join as The Scout');
  await guest.locator(`${SHEET} .cs-start`).click();
  await inGame(guest);

  // Each sees both, as who they picked, from the first state on.
  await expect(host.locator('.iw-crew .iw-mate')).toHaveCount(2);
  await expect(guest.locator('.iw-crew .iw-mate')).toHaveCount(2);
  expect(await read(host)).toMatchObject({ role: 'host', picks: ['trapper', 'scout'], names: ['Luc', 'Sam'] });
  expect(await read(guest)).toMatchObject({ role: 'guest', picks: ['trapper', 'scout'], names: ['Luc', 'Sam'], kept: 'scout' });
  expect(sockets.filter((address) => address.includes('/room/'))).toHaveLength(1);

  // The guest closes the window and comes back as someone else: the same seat, the new figure, on both screens.
  await guest.close({ runBeforeUnload: true });
  await expect(host.locator('.iw-crew .iw-mate.iw-away')).toHaveCount(1, { timeout: 25_000 });
  const back = await guestContext.newPage();
  problems.push(...await arrive(back, `${BASE}/?invite=${shown.replace('-', '')}`));
  await expect(back.locator('.iw-panel-crew_join').getByLabel('Your name'), 'the name is remembered').toHaveValue('Sam');
  await back.locator('.iw-panel-crew_join').getByRole('button', { name: 'Join', exact: true }).click();
  await expect(back.locator(SHEET)).toBeVisible();
  // Last time's pick is the one marked.
  expect(await marked(back)).toBe('scout');
  await card(back, 'angler').click();
  await back.locator(`${SHEET} .cs-start`).click();
  await inGame(back);
  await expect(host.locator('.iw-crew .iw-mate.iw-away')).toHaveCount(0);
  await expect.poll(async () => (await read(host)).picks).toEqual(['trapper', 'angler']);
  expect(await read(back)).toMatchObject({ role: 'guest', picks: ['trapper', 'angler'], names: ['Luc', 'Sam'] });
  expect(problems).toEqual([]);
  for (const context of [hostContext, guestContext]) await context.close();
});
