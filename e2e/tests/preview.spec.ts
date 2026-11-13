/**
 * The lobby's canoe preview in a real browser, headless (Luc's bugfix list, Round 2: "on the loading screen is
 * there a way it can preview your boats look from the last save you played?").
 *
 * - with a save: the lobby shows a picture of that save's canoe and one line under it; with none, the starter
 *   canoe and "Your canoe awaits"; with a broken save, no picture, a clean console and a lobby that works;
 * - it is drawn once, after the page's third frame (the first one times the chip), and never again while the
 *   lobby stands: two looks 0.3 s apart are the same pixels;
 * - it is sharp: one picture pixel on one screen pixel (the picture laid over the page by hand gives the page);
 * - it is cheap: the 3D context it draws in is given back, so one is alive in the lobby and one in the game;
 * - it fits at 1920x1080 and 1366x768, clear of every line of the menu, and on the page an invite link opens;
 * - back from a game with another canoe, the picture is that canoe.
 *
 * Needs the dev server on http://localhost:5220, or PORTAGE_URL.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const BASE = process.env.PORTAGE_URL ?? 'http://localhost:5220';
/** A save from a live build, 100 minutes in: the long canoe with nine attachments. */
const SAVE = readFileSync(new URL('../../game/tests/fixtures/save-live-seed7-min100.json', import.meta.url), 'utf8');
const SAVE_LINE = 'Long canoe, day 6, 1 h 40 min played';

test.use({
  viewport: { width: 1920, height: 1080 },
  launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
});
test.setTimeout(180_000);

interface Report {
  shown: 'save' | 'starter' | null;
  caption: string | null;
  draws: number;
  drawMilliseconds: number;
  drawnAfterFrame: number;
  picture: { key: string; width: number; height: number } | null;
}

/** Open the lobby with `save` in slot 1 (null: no save), counting every 3D context the page makes. */
async function openLobby(page: Page, save: string | null, query = ''): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (message) => {
    if ((message.type() === 'error' || message.type() === 'warning') && !message.text().includes('GL Driver Message')) problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  await page.addInitScript((text) => {
    if (text !== null && window.localStorage.getItem('portage.save.0') === null) window.localStorage.setItem('portage.save.0', text);
    const made: WebGL2RenderingContext[] = [];
    (window as unknown as { contexts: WebGL2RenderingContext[] }).contexts = made;
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      const context = (original as (...parts: unknown[]) => unknown).call(this, type, ...rest);
      if (context && /webgl/.test(type) && !made.includes(context as WebGL2RenderingContext)) made.push(context as WebGL2RenderingContext);
      return context;
    } as typeof original;
  }, save);
  await page.goto(`${BASE}/${query}`);
  await page.waitForFunction(() => (window as unknown as { portage?: { worldView: { probe(): { drawingWidth: number } } } }).portage?.worldView.probe().drawingWidth! > 0, null, { timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  return problems;
}

const report = (page: Page): Promise<Report> =>
  page.evaluate(() => (window as unknown as { portage: { preview: { report(): Report } } }).portage.preview.report());

const contexts = (page: Page): Promise<{ made: number; alive: number }> =>
  page.evaluate(() => {
    const made = (window as unknown as { contexts: WebGL2RenderingContext[] }).contexts;
    return { made: made.length, alive: made.filter((context) => !context.isContextLost()).length };
  });

/** Wait for the picture to be on the page, and say how much of it is drawn on. */
async function pictureOnPage(page: Page): Promise<{ width: number; height: number; inked: number; cssWidth: number; frameWidth: number; frameHeight: number; ratio: number }> {
  await page.waitForSelector('.pv-sketch canvas', { timeout: 30_000 });
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.pv-sketch canvas')!;
    const frame = document.querySelector<HTMLElement>('.pv-sketch')!;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let inked = 0;
    for (let at = 3; at < pixels.length; at += 4) if (pixels[at] > 0) inked += 1;
    return { width: canvas.width, height: canvas.height, inked, cssWidth: canvas.getBoundingClientRect().width, frameWidth: frame.getBoundingClientRect().width, frameHeight: frame.getBoundingClientRect().height, ratio: window.devicePixelRatio };
  });
}

test('with a save the lobby shows that canoe, with its line; drawn once, after the third frame, and its context given back', async ({ page }) => {
  const problems = await openLobby(page, SAVE);
  const picture = await pictureOnPage(page);
  await expect(page.locator('.pv-caption')).toHaveText(SAVE_LINE);
  // As many pixels as the frame has on this screen, shown one to one, and a canoe drawn on them.
  expect(picture.width).toBe(Math.floor(Math.floor(picture.frameWidth) * picture.ratio));
  expect(picture.height).toBe(Math.floor(Math.floor(picture.frameHeight) * picture.ratio));
  expect(picture.cssWidth).toBeCloseTo(picture.width / picture.ratio, 1);
  expect(picture.inked).toBeGreaterThan(5_000);
  expect(picture.inked).toBeLessThan(picture.width * picture.height * 0.6);

  const first = await report(page);
  expect(first).toMatchObject({ shown: 'save', caption: SAVE_LINE, draws: 1 });
  expect(first.drawnAfterFrame).toBeGreaterThanOrEqual(3);
  expect(first.picture).toMatchObject({ width: picture.width, height: picture.height });
  // The chip test ran on the first frame, before any of this.
  const chipTest = await page.evaluate(() => (window as unknown as { portage: { worldView: { probe(): { ladder: { chipTest: unknown } } } } }).portage.worldView.probe().ladder.chipTest);
  expect(chipTest).not.toBeNull();

  // Two contexts were made (the game's, the picture's) and one is alive: the picture's was given back.
  expect(await contexts(page)).toEqual({ made: 2, alive: 1 });

  // Still: the same pixels 0.3 s on and two seconds on, and nothing was drawn again.
  const frame = page.locator('.pv');
  const before = await frame.screenshot();
  await page.waitForTimeout(300);
  expect((await frame.screenshot()).equals(before)).toBe(true);
  await page.waitForTimeout(2_000);
  expect((await frame.screenshot()).equals(before)).toBe(true);
  expect((await report(page)).draws).toBe(1);
  expect(problems).toEqual([]);
});

test('sharp: the picture laid over the bare page by hand gives the page as shown, pixel for pixel', async ({ page }) => {
  await openLobby(page, SAVE);
  await pictureOnPage(page);
  const clip = { x: 0, y: 0, width: 860, height: 1080 };
  const shown = (await page.screenshot({ clip })).toString('base64');
  await page.evaluate(() => { document.querySelector<HTMLElement>('.pv-sketch canvas')!.style.visibility = 'hidden'; });
  const under = (await page.screenshot({ clip })).toString('base64');
  await page.evaluate(() => { document.querySelector<HTMLElement>('.pv-sketch canvas')!.style.visibility = ''; });
  const worst = await page.evaluate(async ([shownData, underData]) => {
    const read = async (data: string): Promise<ImageData> => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
      const sheet = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
      sheet.drawImage(bitmap, 0, 0);
      return sheet.getImageData(0, 0, bitmap.width, bitmap.height);
    };
    const [page1, page0] = [await read(shownData), await read(underData)];
    const canvas = document.querySelector<HTMLCanvasElement>('.pv-sketch canvas')!;
    const own = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    const place = canvas.getBoundingClientRect();
    // Where the browser painted it: the whole pixel nearest, or one beside it (the page's layout is rounded before its transform).
    let best = Infinity;
    for (const down of [-1, 0, 1]) {
      for (const across of [-1, 0, 1]) {
        const [left, top] = [Math.round(place.left) + across, Math.round(place.top) + down];
        let worstHere = 0;
        for (let y = 0; y < own.height; y += 1) {
          for (let x = 0; x < own.width; x += 1) {
            const at = (y * own.width + x) * 4;
            const alpha = own.data[at + 3] / 255;
            if (alpha === 0) continue;
            const on = ((top + y) * page1.width + left + x) * 4;
            for (let channel = 0; channel < 3; channel += 1) {
              worstHere = Math.max(worstHere, Math.abs(page1.data[on + channel] - (own.data[at + channel] * alpha + page0.data[on + channel] * (1 - alpha))));
            }
          }
        }
        best = Math.min(best, worstHere);
      }
    }
    return best;
  }, [shown, under]);
  // A picture smeared between two rows of pixels is off by 70 and more at every line of ink. One to one: rounding only.
  expect(worst).toBeLessThanOrEqual(3);
});

test('no save: the starter canoe and "Your canoe awaits"', async ({ page }) => {
  const problems = await openLobby(page, null);
  const picture = await pictureOnPage(page);
  await expect(page.locator('.pv-caption')).toHaveText('Your canoe awaits');
  expect(picture.inked).toBeGreaterThan(3_000);
  expect(await report(page)).toMatchObject({ shown: 'starter', caption: 'Your canoe awaits', draws: 1 });
  expect(await contexts(page)).toEqual({ made: 2, alive: 1 });
  expect(problems).toEqual([]);
});

for (const [what, text] of [['cut short', SAVE.slice(0, 2_000)], ['not a save', 'not a save at all']] as const) {
  test(`a broken save (${what}): no picture, a clean console, and the lobby works`, async ({ page }) => {
    const problems = await openLobby(page, text);
    await page.waitForTimeout(1_500);
    expect(await page.locator('.pv').count()).toBe(0);
    expect(await page.locator('.iw-lobby canvas').count()).toBe(0);
    expect(await report(page)).toMatchObject({ shown: null, caption: null, draws: 0, picture: null });
    // No second context was ever made.
    expect(await contexts(page)).toEqual({ made: 1, alive: 1 });
    // The lobby works: Continue is off, New Game opens the slots.
    await expect(page.getByRole('button', { name: /^Continue/ })).toBeDisabled();
    await page.getByText('New Game', { exact: true }).click();
    await expect(page.locator('.iw-panel-save_slots')).toBeVisible();
    expect(problems).toEqual([]);
  });
}

for (const [width, height] of [[1920, 1080], [1366, 768]] as const) {
  test(`it fits at ${width}x${height}: on the page, clear of every line of the menu, the title and the tagline`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openLobby(page, SAVE);
    await pictureOnPage(page);
    const layout = await page.evaluate(() => {
      const box = (element: Element): { left: number; top: number; right: number; bottom: number } => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      };
      const canvas = document.querySelector<HTMLCanvasElement>('.pv-sketch canvas')!;
      // The drawn part of the picture, not its empty frame: where there is ink.
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let [left, top, right, bottom] = [canvas.width, canvas.height, 0, 0];
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          if (pixels[(y * canvas.width + x) * 4 + 3] === 0) continue;
          left = Math.min(left, x);
          right = Math.max(right, x + 1);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y + 1);
        }
      }
      const place = canvas.getBoundingClientRect();
      const scale = place.width / canvas.width;
      // The words of each menu line: its label and its note, not the button's padding.
      const words = [...document.querySelectorAll('.iw-mi .iw-label, .iw-mi .iw-n, .iw-tagline, .iw-logo-holder')].map(box);
      return {
        drawing: { left: place.left + left * scale, top: place.top + top * scale, right: place.left + right * scale, bottom: place.top + bottom * scale },
        figure: box(document.querySelector('.pv')!),
        caption: box(document.querySelector('.pv-caption')!),
        words,
        menu: [...document.querySelectorAll('.iw-mi .iw-label')].map((label) => label.textContent),
        scrolls: document.documentElement.scrollWidth > window.innerWidth || document.documentElement.scrollHeight > window.innerHeight,
      };
    });
    expect(layout.menu).toEqual(['Continue', 'New Game', 'Host a crew', 'Join a crew', 'Settings', 'How to Play', 'Credits']);
    // On the page: inside the window, with the line under the picture well clear of the bottom.
    expect(layout.figure.left).toBeGreaterThanOrEqual(0);
    expect(layout.figure.right).toBeLessThanOrEqual(width * 0.4);
    expect(layout.figure.top).toBeGreaterThanOrEqual(0);
    expect(layout.caption.bottom).toBeLessThanOrEqual(height - 8);
    expect(layout.scrolls).toBe(false);
    // Clear of every word of the menu, of the title and of the tagline.
    const overlaps = (a: typeof layout.drawing, b: typeof layout.drawing): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    for (const word of layout.words) {
      expect(overlaps(layout.drawing, word), `the drawing ${JSON.stringify(layout.drawing)} is over ${JSON.stringify(word)}`).toBe(false);
      expect(overlaps(layout.caption, word), `the line ${JSON.stringify(layout.caption)} is over ${JSON.stringify(word)}`).toBe(false);
    }
    // And the line is under the drawing.
    expect(layout.caption.top).toBeGreaterThanOrEqual(layout.drawing.bottom - 1);
  });
}

test('an invite link: the join card opens over the lobby, and the guest\'s own canoe is behind it, dimmed with the menu', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const problems = await openLobby(page, SAVE, '?invite=ABC-234');
  await expect(page.locator('.iw-panel-crew_join')).toBeVisible();
  await pictureOnPage(page);
  await expect(page.locator('.pv-caption')).toHaveText(SAVE_LINE);
  // It is part of the lobby's column, so it is dimmed with it and cannot be pressed.
  expect(await page.evaluate(() => {
    const column = document.querySelector('.iw-lobby-col')!;
    return { inColumn: column.contains(document.querySelector('.pv')), opacity: Number(getComputedStyle(column).opacity), inert: (document.querySelector('.iw-lobby') as HTMLElement).inert };
  })).toEqual({ inColumn: true, opacity: 0.14, inert: true });
  expect(problems).toEqual([]);
});

test('Continue starts as before with one context alive; back from the game with another canoe, the picture is that canoe', async ({ page }) => {
  const problems = await openLobby(page, SAVE);
  await pictureOnPage(page);
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => (window as unknown as { portage: { session: { game: unknown } } }).portage.session.game !== null, null, { timeout: 30_000 });
  await page.waitForTimeout(2_000);
  // In the game: no picture anywhere, nothing drawn again, one context alive.
  expect(await page.locator('.pv').count()).toBe(0);
  expect((await report(page)).draws).toBe(1);
  expect(await contexts(page)).toEqual({ made: 2, alive: 1 });

  // The canoe changes in play (here: by hand, to the patched hull with nothing on it), and the game is quit, which saves it.
  await page.evaluate(() => {
    const session = (window as unknown as { portage: { session: { game: { canoe: { hullTier: number; attachments: string[] } }; quitToLobby(): void } } }).portage.session;
    session.game.canoe.hullTier = 1;
    session.game.canoe.attachments = [];
    session.quitToLobby();
  });
  await expect(page.locator('.pv-caption')).toHaveText(/^Patched canoe, day \d+, .* played$/);
  await page.waitForFunction(() => (window as unknown as { portage: { preview: { report(): { draws: number } } } }).portage.preview.report().draws === 2, null, { timeout: 30_000 });
  await pictureOnPage(page);
  expect(await report(page)).toMatchObject({ shown: 'save', draws: 2 });
  // Three made in all, and still one alive.
  expect(await contexts(page)).toEqual({ made: 3, alive: 1 });
  expect(problems).toEqual([]);
});
