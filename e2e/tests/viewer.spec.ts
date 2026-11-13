/**
 * The asset viewer (/viewer.html), checked in a real browser on the real graphics card:
 *
 * - every entry in the list opens with a clean console and draws something;
 * - a still view changes 0 pixels over a second;
 * - the grid switches, and the three backgrounds switch;
 * - the saved PNG has see-through pixels around the thing, and none of the grid;
 * - a pasted link reopens the same thing and view, pixel for pixel;
 * - the list, the search, the views and the stage answer the keyboard;
 * - every item says where to find it and what it is for, and the guide fits a phone;
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
  await settled(page);
}

/** The page draws a few frames while it loads (its first size, then its real one). Wait until the count has held for a moment. */
async function settled(page: Page): Promise<void> {
  let last = -1;
  for (let tries = 0; tries < 40; tries += 1) {
    const frames = (await probe(page)).frames;
    if (frames === last) return;
    last = frames;
    await page.waitForTimeout(350);
  }
}

/** Run something that should redraw, and wait for the next frame. */
async function andDrawn(page: Page, action: () => Promise<void>): Promise<void> {
  const before = (await probe(page)).frames;
  await action();
  await page.waitForFunction((was) => (window as unknown as Hooks).viewer.probe().frames > was, before, { timeout: 60_000 });
  await page.waitForTimeout(120);
}

interface Picture {
  width: number;
  height: number;
  corner: number[];
  /** Pixels that differ from the corner's colour by a clear margin. */
  inked: number;
  /** Pixels with alpha 255. */
  solid: number;
  /** Pixels with any alpha. */
  covered: number;
}

/** Keep the stage's pixels in the page under `name` (the pipeline's canvas, or the see-through one) and say what is in them. */
function takePicture(page: Page, name: string): Promise<Picture> {
  return page.evaluate((key) => {
    const store = ((window as unknown as { shots?: Record<string, Uint8ClampedArray> }).shots ??= {});
    const canvas = [...document.querySelectorAll<HTMLCanvasElement>('.vw-stage canvas')].filter((candidate) => !candidate.hidden)[0];
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const context = copy.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    context.drawImage(canvas, 0, 0);
    const { data } = context.getImageData(0, 0, copy.width, copy.height);
    store[key] = data;
    const corner = [data[0], data[1], data[2], data[3]];
    let inked = 0;
    let solid = 0;
    let covered = 0;
    for (let at = 0; at < data.length; at += 4) {
      if (data[at + 3] > 0) covered += 1;
      if (Math.abs(data[at] - corner[0]) + Math.abs(data[at + 1] - corner[1]) + Math.abs(data[at + 2] - corner[2]) > 40) inked += 1;
      if (data[at + 3] === 255) solid += 1;
    }
    return { width: copy.width, height: copy.height, corner, inked, solid, covered };
  }, name);
}

/** How many pixels differ between two pictures kept in a page. */
function differing(page: Page, first: string, second: string): Promise<number> {
  return page.evaluate(([one, two]) => {
    const store = (window as unknown as { shots: Record<string, Uint8ClampedArray> }).shots;
    const a = store[one];
    const b = store[two];
    if (a.length !== b.length) return a.length;
    let count = 0;
    for (let at = 0; at < a.length; at += 4) if (a[at] !== b[at] || a[at + 1] !== b[at + 1] || a[at + 2] !== b[at + 2] || a[at + 3] !== b[at + 3]) count += 1;
    return count;
  }, [first, second]);
}

/** A page's picture as a string, to carry to another page. */
const digest = (page: Page, name: string): Promise<string> =>
  page.evaluate((key) => {
    const data = (window as unknown as { shots: Record<string, Uint8ClampedArray> }).shots[key];
    let hash = 2166136261;
    for (let at = 0; at < data.length; at += 1) hash = Math.imul(hash ^ data[at], 16777619) >>> 0;
    return `${data.length}:${hash}`;
  }, name);

test('every entry opens with a clean console and draws something', async ({ page }) => {
  const problems = watchConsole(page);
  // the grid is off, so what is counted is the thing and nothing else
  await openViewer(page, '?grid=0');
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
    const picture = await takePicture(page, 'entry');
    if (picture.inked < 300) bare.push(`${id}: ${picture.inked}`);
  }
  console.log(`opened ${ids.length} entries`);
  expect(bare).toEqual([]);
  expect(problems).toEqual([]);
});

test('every item says where to find it and what it is for, and the guide fits a phone', async ({ page }) => {
  const problems = watchConsole(page);
  await openViewer(page, '?thing=icon/pitch');
  const items = (await probe(page)).ids.filter((id) => id.startsWith('icon/'));
  expect(items.length).toBeGreaterThan(40);
  const thin: string[] = [];
  for (const id of items) {
    await page.evaluate((target) => (window as unknown as Hooks).viewer.open(target), id);
    const parts = await page.locator('.vw-guide-part').evaluateAll((sections) => sections.map((section) => ({
      title: section.querySelector('h3')?.textContent ?? '',
      lines: section.querySelectorAll('li').length,
    })));
    const where = parts.find((part) => part.title === 'Where to find it');
    const usedFor = parts.find((part) => part.title === 'Used for');
    if (!where || where.lines === 0 || !usedFor || usedFor.lines === 0) thin.push(`${id}: ${JSON.stringify(parts)}`);
  }
  expect(thin).toEqual([]);
  // a phone: the guide is on the page and the page does not scroll sideways
  await page.setViewportSize({ width: 390, height: 844 });
  await openViewer(page, '?thing=icon/nails');
  await expect(page.locator('.vw-guide li').first()).toBeVisible();
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(wide).toBeLessThanOrEqual(390);
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
  const first = await takePicture(page, 'first');
  const shotA = await page.locator('.vw-stage').screenshot();
  await page.waitForTimeout(1000);
  const second = await takePicture(page, 'second');
  const shotB = await page.locator('.vw-stage').screenshot();
  const moved = await differing(page, 'first', 'second');
  console.log(`still view: ${first.width}x${first.height}, differing canvas pixels ${moved}, screenshot bytes equal ${shotA.equals(shotB)}`);
  expect(moved).toBe(0);
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
  await takePicture(page, 'withGrid');
  await andDrawn(page, () => page.getByRole('button', { name: 'Grid', exact: true }).click());
  expect((await probe(page)).grid).toBe(false);
  await takePicture(page, 'withoutGrid');
  const gridPixels = await differing(page, 'withGrid', 'withoutGrid');
  console.log(`grid on/off: ${gridPixels} pixels differ`);
  expect(gridPixels).toBeGreaterThan(2000);
  await andDrawn(page, () => page.getByRole('button', { name: 'Grid', exact: true }).click());
  await takePicture(page, 'again');
  expect(await differing(page, 'again', 'withGrid')).toBe(0);

  // paper, dark, see-through
  const paper = await takePicture(page, 'paper');
  await andDrawn(page, () => page.getByRole('button', { name: 'Dark', exact: true }).click());
  const dark = await takePicture(page, 'dark');
  await andDrawn(page, () => page.getByRole('button', { name: 'See-through', exact: true }).click());
  const clear = await takePicture(page, 'clear');
  const lightness = (picture: Picture): number => picture.corner[0] + picture.corner[1] + picture.corner[2];
  console.log(`corner: paper ${lightness(paper)}, dark ${lightness(dark)}, see-through alpha ${clear.corner[3]}`);
  expect(lightness(paper)).toBeGreaterThan(600);
  expect(lightness(dark)).toBeLessThan(150);
  expect(clear.corner[3]).toBe(0);
  expect(clear.solid).toBeGreaterThan(500);
  await expect(page.locator('.vw-stage')).toHaveAttribute('data-background', 'checker');
  // night changes the light, and the picture
  await andDrawn(page, () => page.getByRole('button', { name: 'Paper', exact: true }).click());
  await andDrawn(page, () => page.getByRole('button', { name: 'Night', exact: true }).click());
  await takePicture(page, 'night');
  expect(await differing(page, 'night', 'paper')).toBeGreaterThan(5000);
  expect(problems).toEqual([]);
});

test('the saved picture is the thing alone on a see-through background', async ({ page }) => {
  const problems = watchConsole(page);
  // the thing alone on the stage, see-through, grid off: what the picture should hold
  await openViewer(page, '?thing=crew%2Fplayer-2&pose=pull&bg=checker&grid=0');
  const alone = await takePicture(page, 'alone');
  // then the grid goes on, and the picture is saved: the grid is not in it
  await andDrawn(page, () => page.getByRole('button', { name: 'Grid', exact: true }).click());
  const withGrid = await takePicture(page, 'withGridOn');
  expect(withGrid.covered).toBeGreaterThan(alone.covered * 1.3);
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
    for (let at = 3; at < pixels.length; at += 4) if (pixels[at] > 0) grey += 1;
    return { width: image.width, height: image.height, clear, solid, edges, covered: grey };
  }, base64);
  const total = result.width * result.height;
  console.log(`saved picture ${result.width}x${result.height}: ${(100 * result.clear / total).toFixed(1)}% see-through, ${result.solid} solid pixels, edges ${result.edges.join(',')}, covered ${result.covered} against ${alone.covered} alone, ${withGrid.covered} with the grid on screen`);
  expect(result.edges).toEqual([0, 0, 0, 0, 0, 0]);
  expect(result.clear / total).toBeGreaterThan(0.6);
  expect(result.solid).toBeGreaterThan(2000);
  expect(Math.abs(result.covered - alone.covered) / alone.covered).toBeLessThan(0.02);
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
  await takePicture(page, 'here');
  const pictureHere = await digest(page, 'here');

  const other = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const otherProblems = watchConsole(other);
  await other.goto(address, { waitUntil: 'load' });
  await other.waitForFunction(() => (window as unknown as Hooks).viewer?.probe().frames > 0, null, { timeout: 60_000 });
  await settled(other);
  const there = await probe(other);
  expect({ ...there, frames: 0 }).toEqual({ ...here, frames: 0 });
  await takePicture(other, 'there');
  const pictureThere = await digest(other, 'there');
  console.log(`pasted link: picture ${pictureHere} against ${pictureThere}`);
  expect(pictureThere).toBe(pictureHere);
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
