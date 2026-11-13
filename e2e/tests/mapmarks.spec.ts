/**
 * The map's marks can be found, in a real browser, headless (the master review of round 3, finding 4).
 *
 * - the map panel says in one line that a click marks a spot and a click on a mark takes it down;
 * - with a crew of four, four marks and the longest names the game allows, the legend has a row a mark, and the
 *   whole panel still fits at 1920x1080 and 1366x768: no scroll, no cut mark, no clipped word;
 * - a click on the chart puts "Your mark" in the legend, and a click on the mark takes the row away;
 * - nothing on the panel moves by itself.
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

const HINT = 'Click the map to mark a spot for the crew. Click a mark to take it down.';
/** Twelve letters each, the most a name may have, and wide ones. */
const NAMES = ['Wilhelmina M', 'Maximilian W', 'Gwendolyn Mm', 'Bartholomew'];

/** The map of a crew of four, open, with every player's mark standing on it. */
async function showMap(page: Page, marks: number): Promise<void> {
  await page.goto(`${BASE}/?shot=play&live=1&crew=4`);
  await page.waitForFunction(() => (window as any).portage?.app?.lastModel?.hud !== null && (window as any).portage?.session?.game);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(({ names, count }) => {
    const state = (window as any).portage.session.game;
    state.players.forEach((player: { name: string }, index: number) => {
      player.name = names[index] ?? player.name;
    });
    // One mark a player, spread over the lake south of the chart's middle, away from where anyone is.
    state.pings = Array.from({ length: count }, (_, playerId) => ({
      playerId, x: -500 + playerId * 330, z: 300 - playerId * 60, tick: state.tick, standing: true, inside: [],
    }));
  }, { names: NAMES, count: marks });
  await page.keyboard.press('KeyM');
  await page.waitForFunction((count) => document.querySelectorAll('.iw-panel-map .iw-legend-mark').length === count, marks);
  await frames(page, 3);
}

test('the map says how to mark a spot, and four marks with their legend fit at 1920x1080 and 1366x768', async ({ page }) => {
  const problems = watch(page);
  for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    const where = `${size.width}x${size.height}`;
    await page.setViewportSize(size);
    await showMap(page, 4);
    const seen = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('.iw-panel-map')!;
      const body = panel.querySelector<HTMLElement>('.iw-body')!;
      const hint = panel.querySelector<HTMLElement>('.iw-map-hint')!;
      const close = panel.querySelector<HTMLElement>('footer button')!;
      const rows = [...panel.querySelectorAll<HTMLElement>('.iw-legend li')];
      const box = panel.getBoundingClientRect();
      const bodyBox = body.getBoundingClientRect();
      const hintBox = hint.getBoundingClientRect();
      const closeBox = close.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(hint).lineHeight);
      return {
        hint: (hint.textContent ?? '').trim(),
        hintLines: Math.round(hintBox.height / lineHeight),
        hintClearOfClose: hintBox.right <= closeBox.left,
        hintInside: hintBox.left >= box.left && hintBox.bottom <= box.bottom,
        marks: [...panel.querySelectorAll('.iw-legend-mark')].map((row) => (row.textContent ?? '').trim()),
        glints: [...panel.querySelectorAll('.iw-legend-mark svg path')].map((path) => path.getAttribute('fill')),
        // Every legend row whole: inside the body, on one line, no word cut.
        rowsInside: rows.every((row) => {
          const each = row.getBoundingClientRect();
          return each.top >= bodyBox.top - 0.5 && each.bottom <= bodyBox.bottom + 0.5 && each.right <= bodyBox.right + 0.5;
        }),
        rowsCut: rows.filter((row) => row.scrollWidth > row.clientWidth + 1 || [...row.querySelectorAll('span')].some((span) => span.scrollWidth > span.clientWidth + 1))
          .map((row) => (row.textContent ?? '').trim()),
        rowsOneLine: rows.every((row) => row.getBoundingClientRect().height < 2 * parseFloat(getComputedStyle(row).fontSize) * 1.25),
        below: body.scrollHeight - body.clientHeight, sideways: body.scrollWidth - body.clientWidth,
        cutMarkHidden: panel.querySelector<HTMLElement>('.iw-cut')!.hidden,
        panelInside: box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth,
        pageScrolls: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
        running: document.getAnimations().filter((animation) => animation.playState === 'running').length,
      };
    });
    expect(seen, where).toEqual({
      hint: HINT, hintLines: 1, hintClearOfClose: true, hintInside: true,
      marks: ['Your mark', `${NAMES[1]}'s mark`, `${NAMES[2]}'s mark`, `${NAMES[3]}'s mark`],
      glints: [expect.stringMatching(/^#[0-9a-f]{6}$/i), expect.stringMatching(/^#[0-9a-f]{6}$/i), expect.stringMatching(/^#[0-9a-f]{6}$/i), expect.stringMatching(/^#[0-9a-f]{6}$/i)],
      rowsInside: true, rowsCut: [], rowsOneLine: true, below: 0, sideways: 0, cutMarkHidden: true, panelInside: true, pageScrolls: false, running: 0,
    });
    expect(new Set(seen.glints).size, where).toBe(4);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/map-four-marks-${where}.png` });
  }
  expect(problems).toEqual([]);
});

test('a click on the chart puts "Your mark" in the legend, and a click on the mark takes the row away', async ({ page }) => {
  const problems = watch(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await showMap(page, 0);
  expect(await page.locator('.iw-panel-map .iw-map-hint').textContent()).toBe(HINT);
  const chart = (await page.locator('.iw-panel-map .iw-chart-canvas').boundingBox())!;
  // A spot up and left of the middle: open paper, nobody there.
  const spot = { x: chart.x + chart.width * 0.36, y: chart.y + chart.height * 0.34 };
  await page.mouse.click(spot.x, spot.y);
  await page.waitForFunction(() => document.querySelectorAll('.iw-panel-map .iw-legend-mark').length === 1);
  expect(await page.locator('.iw-panel-map .iw-legend-mark').textContent()).toBe('Your mark');
  expect(await page.evaluate(() => (window as any).portage.session.game.pings.filter((ping: { standing: boolean }) => ping.standing).length)).toBe(1);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/map-your-mark-1366x768.png` });
  // The same spot again: the click is on the mark, and it comes down.
  await page.mouse.click(spot.x, spot.y);
  await page.waitForFunction(() => document.querySelectorAll('.iw-panel-map .iw-legend-mark').length === 0);
  expect(await page.evaluate(() => (window as any).portage.session.game.pings.filter((ping: { standing: boolean }) => ping.standing).length)).toBe(0);
  expect(await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running').length)).toBe(0);
  expect(problems).toEqual([]);
});
