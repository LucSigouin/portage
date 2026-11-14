/**
 * How to Play is up to date and fits its panel, in a real browser, headless (the master review of round 3, finding 6).
 *
 * At 1920x1080 and 1366x768:
 * - the page says what round 3 added, beside the panel each belongs to, with the keys as caps: Shift+click, Q, Z;
 * - no word is cut: no line wider than its column, no section broken across the two columns, the panel inside the screen;
 * - the body scrolls to its end, and the cut mark is there while there is more below and gone at the end;
 * - the new lines cost the page no height: the column they are in is no longer than the other, which did not change;
 * - nothing on the page moves by itself.
 *
 * Needs the dev server on http://localhost:5220, or PORTAGE_URL. With PORTAGE_SHOTS set to a folder, it leaves
 * pictures there.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const BASE = process.env.PORTAGE_URL ?? 'http://localhost:5220';
const SHOTS = process.env.PORTAGE_SHOTS ?? '';
const PANEL = '.iw-panel-how_to_play';

test.use({ viewport: { width: 1920, height: 1080 } });
test.setTimeout(180_000);

const frames = (page: Page, count = 3): Promise<void> => page.evaluate((wanted) => new Promise<void>((resolve) => {
  const step = (left: number): void => void (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
  step(wanted);
}), count);

test('How to Play has the round\'s new lines and fits its panel at 1920x1080 and 1366x768', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if ((message.type() === 'error' || message.type() === 'warning') && !message.text().includes('GL Driver Message')) problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    const where = `${size.width}x${size.height}`;
    await page.setViewportSize(size);
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => (window as any).portage?.app?.lastModel?.lobby);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => (window as any).portage.session.handleIntent({ type: 'open_panel', panel: 'how_to_play' }));
    await page.waitForSelector(PANEL);
    await frames(page, 4);

    const read = () => page.evaluate((selector) => {
      const panel = document.querySelector<HTMLElement>(selector)!;
      const body = panel.querySelector<HTMLElement>('.iw-body')!;
      const box = panel.getBoundingClientRect();
      const bodyBox = body.getBoundingClientRect();
      const sections = [...body.querySelectorAll<HTMLElement>('section')];
      const added = sections.find((section) => section.querySelector('h3')?.textContent === 'Panels and camera')!;
      const words = [...body.querySelectorAll<HTMLElement>('p, dd, dt, h3')];
      const column = (element: Element): number => Math.round(element.getBoundingClientRect().left - bodyBox.left);
      const columns = [...new Set(sections.map(column))].sort((first, second) => first - second);
      return {
        headings: sections.map((section) => section.querySelector('h3')!.textContent),
        addedKeys: [...added.querySelectorAll('dt')].map((keys) => [...keys.querySelectorAll('.iw-key')].map((key) => key.textContent).join('|')),
        addedLabels: [...added.querySelectorAll('dd')].map((label) => label.textContent),
        // The bottom of each column: where its last section ends, against the top of the first.
        columnHeights: columns.map((left) => Math.round(Math.max(...sections.filter((section) => column(section) === left).map((section) => section.getBoundingClientRect().bottom))
          - sections[0]!.getBoundingClientRect().top)),
        // No word cut: nothing wider than its own box, nothing past the body's right edge, no sideways scroll.
        cut: words.filter((element) => element.scrollWidth > element.clientWidth + 1 || element.getBoundingClientRect().right > bodyBox.right + 0.5)
          .map((element) => (element.textContent ?? '').slice(0, 40)),
        sideways: body.scrollWidth - body.clientWidth,
        // Each section whole in one column, in two columns.
        broken: sections.filter((section) => section.getClientRects().length !== 1).map((section) => section.querySelector('h3')!.textContent),
        columns: columns.length,
        addedColumn: columns.indexOf(column(added)),
        panelInside: box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth,
        pageScrolls: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
        below: body.scrollHeight - body.clientHeight - Math.round(body.scrollTop),
        scrollHeight: body.scrollHeight,
        cutMarkHidden: panel.querySelector<HTMLElement>('.iw-cut')!.hidden,
        running: document.getAnimations().filter((animation) => animation.playState === 'running').length,
      };
    }, PANEL);

    const top = await read();
    expect(top.headings, where).toEqual(['The loop', 'In the canoe', 'On foot', 'Panels and camera', 'Staying alive']);
    expect(top.addedKeys, where).toEqual(['Tab', 'Shift+click', 'Q', 'Z', 'C', 'B', 'J', 'M', 'Esc']);
    expect(top.addedLabels, where).toEqual([
      'Inventory', 'A stack to the other side', 'Pointer on a stack: drop it', 'Take a drop back, within 5 s', "Crafting by hand. A camp's fire and bench are on it too",
      'The canoe: its builder (beached), its stations (afloat too)', 'Quest log: track up to three quests', 'Map: a click marks a spot for the crew',
      'Pause, or close a panel',
    ]);
    expect({ cut: top.cut, sideways: top.sideways, broken: top.broken, columns: top.columns, addedColumn: top.addedColumn, panelInside: top.panelInside, pageScrolls: top.pageScrolls, running: top.running }, where)
      .toEqual({ cut: [], sideways: 0, broken: [], columns: 2, addedColumn: 1, panelInside: true, pageScrolls: false, running: 0 });
    // The cut mark says so while there is more below.
    expect(top.cutMarkHidden, where).toBe(top.below <= 0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/howto-${where}-top.png` });

    // The new lines cost no height: their column, the second, is no longer than the first, which this round left alone.
    expect(top.columnHeights[1], `${where}: ${top.columnHeights.join(' and ')}`).toBeLessThanOrEqual(top.columnHeights[0]!);

    // To the end: every line can be reached, and the mark goes.
    await page.evaluate((selector) => {
      const body = document.querySelector<HTMLElement>(`${selector} .iw-body`)!;
      body.scrollTop = body.scrollHeight;
    }, PANEL);
    await frames(page, 4);
    const end = await read();
    expect({ below: end.below, cutMarkHidden: end.cutMarkHidden, cut: end.cut, running: end.running }, where).toEqual({ below: 0, cutMarkHidden: true, cut: [], running: 0 });
    const lastWhole = await page.evaluate((selector) => {
      const body = document.querySelector<HTMLElement>(`${selector} .iw-body`)!.getBoundingClientRect();
      return [...document.querySelectorAll<HTMLElement>(`${selector} section`)].every((section) => section.getBoundingClientRect().bottom <= body.bottom + 0.5);
    }, PANEL);
    expect(lastWhole, where).toBe(true);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/howto-${where}-end.png` });
  }
  expect(problems).toEqual([]);
});
