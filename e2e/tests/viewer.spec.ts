/**
 * The asset viewer (/viewer.html), checked in a real browser on the real graphics card:
 *
 * - every entry in the list opens with a clean console and draws something;
 * - a still view changes 0 pixels over a second;
 * - the grid switches, and the three backgrounds switch;
 * - the saved PNG has see-through pixels around the thing, and none of the grid;
 * - a pasted link reopens the same thing and view, pixel for pixel;
 * - the list, the search, the views and the stage answer the keyboard;
 * - a normal game load fetches no viewer code, and the viewer fetches nothing from another site.
 *
 * Needs the dev server (PORTAGE_URL, default http://localhost:5227).
 * To prove a check can fail: PORTAGE_VIEWER_BREAK=boil (a view that drifts by itself) or =leak (the page asks another site).
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const BASE = process.env.PORTAGE_URL ?? 'http://localhost:5227';
const BREAK = process.env.PORTAGE_VIEWER_BREAK ?? '';

test.use({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
});
test.setTimeout(600_000);

interface Probe {
  thing: string;
  options: Record<string, string>;
  view: string;
  free: { yaw: number; pitch: number; distance: number; aim: string } | null;
  background: string;
  grid: boolean;
  light: string;
  frames: number;
  width: number;
  height: number;
  failure: string;
  triangles: number;
  drawCalls: number;
  ids: string[];
}
interface Hooks {
  viewer: { probe(): Probe; open(id: string): void };
}

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if ((message.type() === 'error' || message.type() === 'warning') && !message.text().includes('GL Driver Message')) problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => problems.push(`request failed: ${request.url()}`));
  return problems;
}

const probe = (page: Page): Promise<Probe> => page.evaluate(() => (window as unknown as Hooks).viewer.probe());

async function openViewer(page: Page, search = ''): Promise<void> {
  await page.goto(`${BASE}/viewer.html${search}`, { waitUntil: 'load' });
  await page.waitForFunction(() => (window as unknown as Hooks).viewer?.probe().frames > 0, null, { timeout: 60_000 });
}

/** Run something that should redraw, and wait for the next frame. */
async function andDrawn(page: Page, action: () => Promise<void>): Promise<void> {
  const before = (await probe(page)).frames;
  await action();
  await page.waitForFunction((was) => (window as unknown as Hooks).viewer.probe().frames > was, before, { timeout: 60_000 });
  await page.waitForTimeout(120);
}

/** The stage's pixels as they are on the card (the pipeline's canvas, or the see-through one). */
function stagePixels(page: Page): Promise<{ data: number[]; width: number; height: number }> {
  return page.evaluate(() => {
    const canvases = [...document.querySelectorAll<HTMLCanvasElement>('.vw-stage canvas')].filter((canvas) => !canvas.hidden);
    const canvas = canvases[0];
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const context = copy.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    context.drawImage(canvas, 0, 0);
    return { data: Array.from(context.getImageData(0, 0, copy.width, copy.height).data), width: copy.width, height: copy.height };
  });
}

const differing = (first: number[], second: number[]): number => {
  let count = 0;
  for (let at = 0; at < first.length; at += 4) if (first[at] !== second[at] || first[at + 1] !== second[at + 1] || first[at + 2] !== second[at + 2] || first[at + 3] !== second[at + 3]) count += 1;
  return count;
};

test('every entry opens with a clean console and draws something', async ({ page }) => {
  const problems = watchConsole(page);
  await openViewer(page);
  const ids = (await probe(page)).ids;
  expect(ids.length).toBeGreaterThan(150);
  const bare: string[] = [];
  for (const id of ids) {
    await andDrawn(page, () => page.evaluate((target) => (window as unknown as Hooks).viewer.open(target), id));
    const state = await probe(page);
    expect(state.failure, id).toBe('');
    expect(state.thing).toBe(id);
    if (id.startsWith('icon/')) {
      await expect(page.locator('.vw-flat svg')).toHaveCount(1);
      continue;
    }
    // something is drawn: well over a few hundred pixels differ from the corner's colour
    const picture = await stagePixels(page);
    const corner = picture.data.slice(0, 4);
    let inked = 0;
    for (let at = 0; at < picture.data.length; at += 4) {
      if (Math.abs(picture.data[at] - corner[0]) + Math.abs(picture.data[at + 1] - corner[1]) + Math.abs(picture.data[at + 2] - corner[2]) > 40) inked += 1;
    }
    if (inked < 300) bare.push(`${id}: ${inked}`);
  }
  console.log(`opened ${ids.length} entries`);
  expect(bare).toEqual([]);
  expect(problems).toEqual([]);
});

test('a still view changes 0 pixels over a second', async ({ page }) => {
  const problems = watchConsole(page);
  await openViewer(page, '?thing=hull%2Flong_canoe&crew=3&fitted=all&sail=up&lantern=lit');
  if (BREAK === 'boil') {
    // the break: the view drifts by itself, a hair every 100 ms
    await page.addScriptTag({ content: `window.setInterval(() => document.querySelector('.vw-stage').dispatchEvent(new WheelEvent('wheel', { deltaY: (Math.random() - 0.5) * 6, cancelable: true })), 100);` });
  }
  await page.waitForTimeout(300);
  const first = await stagePixels(page);
  const shotA = await page.locator('.vw-stage').screenshot();
  await page.waitForTimeout(1000);
  const second = await stagePixels(page);
  const shotB = await page.locator('.vw-stage').screenshot();
  console.log(`still view: ${first.width}x${first.height}, differing canvas pixels ${differing(first.data, second.data)}, screenshot bytes equal ${shotA.equals(shotB)}`);
  expect(differing(first.data, second.data)).toBe(0);
  expect(shotA.equals(shotB)).toBe(true);
  // and not a single frame was drawn while it stood still
  const frames = (await probe(page)).frames;
  await page.waitForTimeout(500);
  expect((await probe(page)).frames).toBe(frames);
  expect(problems).toEqual([]);
});

test('the grid and the three backgrounds switch', async ({ page }) => {
  const problems = watchConsole(page);
  await openViewer(page, '?thing=attachment%2Fcargo_rack&mount=hull&tier=2');
  const withGrid = await stagePixels(page);
  await andDrawn(page, () => page.getByRole('button', { name: 'Grid', exact: true }).click());
  expect((await probe(page)).grid).toBe(false);
  const withoutGrid = await stagePixels(page);
  const gridPixels = differing(withGrid.data, withoutGrid.data);
  console.log(`grid on/off: ${gridPixels} pixels differ`);
  expect(gridPixels).toBeGreaterThan(2000);
  await andDrawn(page, () => page.getByRole('button', { name: 'Grid', exact: true }).click());
  expect(differing((await stagePixels(page)).data, withGrid.data)).toBe(0);

  // paper, dark, see-through
  const paper = await stagePixels(page);
  await andDrawn(page, () => page.getByRole('button', { name: 'Dark', exact: true }).click());
  const dark = await stagePixels(page);
  await andDrawn(page, () => page.getByRole('button', { name: 'See-through', exact: true }).click());
  const clear = await stagePixels(page);
  const lightness = (picture: { data: number[] }): number => picture.data[0] + picture.data[1] + picture.data[2];
  console.log(`corner: paper ${lightness(paper)}, dark ${lightness(dark)}, see-through alpha ${clear.data[3]}`);
  expect(lightness(paper)).toBeGreaterThan(600);
  expect(lightness(dark)).toBeLessThan(150);
  expect(clear.data[3]).toBe(0);
  let solid = 0;
  for (let at = 3; at < clear.data.length; at += 4) if (clear.data[at] === 255) solid += 1;
  expect(solid).toBeGreaterThan(500);
  await expect(page.locator('.vw-stage')).toHaveAttribute('data-background', 'checker');
  // night changes the light, and the picture
  await andDrawn(page, () => page.getByRole('button', { name: 'Paper', exact: true }).click());
  await andDrawn(page, () => page.getByRole('button', { name: 'Night', exact: true }).click());
  expect(differing((await stagePixels(page)).data, paper.data)).toBeGreaterThan(5000);
  expect(problems).toEqual([]);
});

test('the saved picture is the thing alone on a see-through background', async ({ page }) => {
  const problems = watchConsole(page);
  await openViewer(page, '?thing=crew%2Fplayer-2&pose=pull');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save picture' }).click()]);
  expect(download.suggestedFilename()).toBe('portage-crew-player-2.png');
  const path = await download.path();
  const base64 = readFileSync(path).toString('base64');
  expect(readFileSync(path).subarray(1, 4).toString()).toBe('PNG');
  const result = await page.evaluate(async (data) => {
    const image = new Image();
    await new Promise<void>((resolve) => {
      image.onload = () => resolve();
      image.src = `data:image/png;base64,${data}`;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    context.drawImage(image, 0, 0);
    const { data: pixels } = context.getImageData(0, 0, image.width, image.height);
    let clear = 0;
    let solid = 0;
    let grey = 0;
    for (let at = 3; at < pixels.length; at += 4) {
      if (pixels[at] === 0) clear += 1;
      else if (pixels[at] === 255) solid += 1;
    }
    // the corners and the four edges' middles are see-through
    const alphaAt = (x: number, y: number): number => pixels[(y * image.width + x) * 4 + 3];
    const edges = [alphaAt(0, 0), alphaAt(image.width - 1, 0), alphaAt(0, image.height - 1), alphaAt(image.width - 1, image.height - 1), alphaAt(image.width >> 1, 0), alphaAt(image.width >> 1, image.height - 1)];
    // the ground grid is not in it: nothing partly see-through runs the width of the picture along the floor
    for (let y = 0; y < image.height; y += 1) {
      let row = 0;
      for (let x = 0; x < image.width; x += 1) if (alphaAt(x, y) > 0) row += 1;
      if (row > image.width * 0.6) grey += 1;
    }
    return { width: image.width, height: image.height, clear, solid, edges, longRows: grey };
  }, base64);
  const total = result.width * result.height;
  console.log(`saved picture ${result.width}x${result.height}: ${(100 * result.clear / total).toFixed(1)}% see-through, ${result.solid} solid pixels, edges ${result.edges.join(',')}, rows across the width ${result.longRows}`);
  expect(result.edges).toEqual([0, 0, 0, 0, 0, 0]);
  expect(result.clear / total).toBeGreaterThan(0.6);
  expect(result.solid).toBeGreaterThan(2000);
  expect(result.longRows).toBe(0);
  expect(problems).toEqual([]);
});

test('an icon saves too, see-through', async ({ page }) => {
  const problems = watchConsole(page);
  await openViewer(page, '?thing=icon%2Fberries');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save picture' }).click()]);
  const base64 = readFileSync(await download.path()).toString('base64');
  const alpha = await page.evaluate(async (data) => {
    const image = new Image();
    await new Promise<void>((resolve) => {
      image.onload = () => resolve();
      image.src = `data:image/png;base64,${data}`;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    context.drawImage(image, 0, 0);
    const { data: pixels } = context.getImageData(0, 0, image.width, image.height);
    let solid = 0;
    for (let at = 3; at < pixels.length; at += 4) if (pixels[at] > 200) solid += 1;
    return { corner: pixels[3], solid, width: image.width };
  }, base64);
  expect(alpha.corner).toBe(0);
  expect(alpha.solid).toBeGreaterThan(5000);
  expect(problems).toEqual([]);
});

test('a pasted link reopens the same thing and view, pixel for pixel', async ({ page, browser }) => {
  const problems = watchConsole(page);
  await openViewer(page, '?thing=hull%2Fribbed_canoe');
  await page.getByLabel('Crew aboard').selectOption('3');
  await page.getByLabel('Rig').selectOption('all');
  const stage = page.locator('.vw-stage');
  const box = (await stage.boundingBox()) as { x: number; y: number; width: number; height: number };
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 - 70, { steps: 8 });
  await page.mouse.up();
  await page.mouse.wheel(0, -260);
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await page.getByRole('button', { name: 'Night', exact: true }).click();
  await page.waitForTimeout(500);
  const here = await probe(page);
  expect(here.view).toBe('free');
  const address = page.url();
  console.log(`address: ${address.replace(BASE, '')}`);
  expect(address).toContain('thing=hull%2Fribbed_canoe');
  expect(address).toContain('crew=3');
  expect(address).toContain('view=free');
  expect(address).toContain('bg=dark');
  const pictureHere = await stagePixels(page);

  const other = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const otherProblems = watchConsole(other);
  await other.goto(address, { waitUntil: 'load' });
  await other.waitForFunction(() => (window as unknown as Hooks).viewer?.probe().frames > 0, null, { timeout: 60_000 });
  await other.waitForTimeout(300);
  const there = await probe(other);
  expect({ ...there, frames: 0 }).toEqual({ ...here, frames: 0 });
  const pictureThere = await stagePixels(other);
  console.log(`pasted link: ${differing(pictureHere.data, pictureThere.data)} of ${pictureHere.data.length / 4} pixels differ`);
  expect(differing(pictureHere.data, pictureThere.data)).toBe(0);
  expect(await other.getByLabel('Crew aboard').inputValue()).toBe('3');
  await other.close();
  expect(otherProblems).toEqual([]);
  expect(problems).toEqual([]);
});

test('the list, the search and the stage answer the keyboard', async ({ page }) => {
  const problems = watchConsole(page);
  await openViewer(page);
  // the search: slash focuses it, a word filters, an arrow goes into the list, enter chooses
  await page.keyboard.press('/');
  await expect(page.locator('.vw-search')).toBeFocused();
  await page.keyboard.type('sail');
  await expect(page.locator('.vw-count')).toContainText('of');
  const shown = await page.locator('.vw-item:not([hidden])').count();
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThan(20);
  await page.keyboard.press('ArrowDown');
  const first = await page.evaluate(() => (document.activeElement as HTMLElement).dataset.id);
  expect(first).toBeTruthy();
  await andDrawn(page, () => page.keyboard.press('Enter'));
  expect((await probe(page)).thing).toBe(first);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  // nothing matches: a message, not a broken list
  await page.locator('.vw-search').fill('zzzzzz');
  await expect(page.locator('.vw-count')).toContainText('0 of');
  await page.locator('.vw-search').fill('');
  // the stage: arrows turn, plus and minus zoom, letters pick the views, zero resets
  await page.locator('.vw-stage').focus();
  const home = await probe(page);
  expect(home.view).toBe('home');
  await andDrawn(page, () => page.keyboard.press('ArrowLeft'));
  const turned = await probe(page);
  expect(turned.view).toBe('free');
  expect(turned.free?.yaw).toBeCloseTo(210, 3);
  await andDrawn(page, () => page.keyboard.press('ArrowUp'));
  expect((await probe(page)).free?.pitch).toBeCloseTo(25, 3);
  const distance = (await probe(page)).free?.distance as number;
  await andDrawn(page, () => page.keyboard.press('+'));
  expect((await probe(page)).free?.distance as number).toBeLessThan(distance);
  for (const [key, view] of [['f', 'front'], ['s', 'side'], ['t', 'top']] as const) {
    await andDrawn(page, () => page.keyboard.press(key));
    expect((await probe(page)).view).toBe(view);
  }
  await andDrawn(page, () => page.keyboard.press('0'));
  expect((await probe(page)).view).toBe('home');
  // the buttons are reachable by Tab and have names
  await page.getByRole('button', { name: 'Front' }).focus();
  await andDrawn(page, () => page.keyboard.press('Enter'));
  expect((await probe(page)).view).toBe('front');
  await andDrawn(page, () => page.getByRole('button', { name: 'Reset' }).click());
  expect((await probe(page)).view).toBe('home');
  // an island and a landmark keep their own distance rules: no console noise on a long zoom out
  await andDrawn(page, () => page.evaluate(() => (window as unknown as Hooks).viewer.open('island/steeple_rock')));
  await page.locator('.vw-stage').focus();
  for (let step = 0; step < 4; step += 1) await andDrawn(page, () => page.keyboard.press('-'));
  expect(problems).toEqual([]);
});

test('a normal game load fetches no viewer code, and the viewer asks no other site for anything', async ({ page }) => {
  const seen: string[] = [];
  page.on('request', (request) => seen.push(request.url()));
  await page.goto(`${BASE}/?shot=upgraded`, { waitUntil: 'load' });
  await page.waitForFunction(() => (window as unknown as { portage?: { session?: { game: unknown } } }).portage?.session?.game !== undefined, null, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  const gameRequests = seen.length;
  const viewerRequests = seen.filter((url) => /viewer/i.test(url));
  console.log(`game load: ${gameRequests} requests, ${viewerRequests.length} mention the viewer`);
  expect(gameRequests).toBeGreaterThan(20);
  expect(viewerRequests).toEqual([]);

  // the control: the viewer's own page does fetch its code, all from this site
  const viewerSeen: string[] = [];
  const viewerPage = await page.context().newPage();
  viewerPage.on('request', (request) => viewerSeen.push(request.url()));
  if (BREAK === 'leak') await viewerPage.addInitScript(() => void fetch('https://example.com/ping', { mode: 'no-cors' }).catch(() => {}));
  await viewerPage.goto(`${BASE}/viewer.html`, { waitUntil: 'load' });
  await viewerPage.waitForFunction(() => (window as unknown as Hooks).viewer?.probe().frames > 0, null, { timeout: 60_000 });
  expect(viewerSeen.some((url) => url.includes('/src/viewer/main.ts'))).toBe(true);
  const away = viewerSeen.filter((url) => !url.startsWith(BASE) && !url.startsWith('data:') && !url.startsWith('blob:'));
  expect(away).toEqual([]);
  const stored = await viewerPage.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }));
  expect(stored).toEqual({ local: 0, session: 0, cookie: '' });
  await viewerPage.close();
});
