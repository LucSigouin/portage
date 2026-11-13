/**
 * The performance readout (`?perf=1`), checked in a real browser on the real graphics card:
 *
 * - one link: it starts by itself, shows its progress, and ends on the text, a Copy button and "Send this to Luc.";
 * - it finishes inside a minute, also with the chip made 24 times slower (`&bench=24`);
 * - the text has every field, in under 60 lines, and says what was really drawn;
 * - Copy puts the text on the clipboard, and selects it when the clipboard is refused;
 * - nothing leaves the page, nothing is stored, and the player's own settings and saves are as they were;
 * - the console is clean;
 * - a normal game, without the switch, loads none of it;
 * - doubling the work (`&bench=2`) about doubles the honest frame cost, and that cost is the chip's time, not the script's.
 *
 * Two ways to run it:
 *   PORTAGE_URL=http://localhost:5224 npx playwright test tests/perf.spec.ts        the dev server
 *   PORTAGE_PERF_DIST=<built folder> npx playwright test tests/perf.spec.ts         a build, served from disk under
 *     sigouin.net's security policy (read from PORTAGE_PERF_HEADERS, default the site's own `_headers`), as deploy/smoke.mjs does.
 *
 * PORTAGE_PERF_SHOTS=<folder> saves a picture of the run and of the finished sheet.
 * PORTAGE_PERF_TOP_MS=5-16 also holds the top-quality cost at 1920×1080 to that range (this Mac: LOOK.md says about 10 ms).
 *
 * To see each check fail, break what it guards: see the table in the readout's report.
 */
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const DIST = process.env.PORTAGE_PERF_DIST ?? '';
const HEADERS = process.env.PORTAGE_PERF_HEADERS ?? '/Users/ls/Claude-Workspace/personal/sigouin-net/site/_headers';
const BASE = DIST ? 'https://portage.test/portage/' : `${process.env.PORTAGE_URL ?? 'http://localhost:5224'}/`;
const SHOTS = process.env.PORTAGE_PERF_SHOTS ?? '';
const TOP_RANGE = (process.env.PORTAGE_PERF_TOP_MS ?? '').split('-').map(Number);
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
/** A run may take this long, from opening the address to the finished sheet. */
const LIMIT_SECONDS = 60;

test.use({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
});
test.setTimeout(240_000);

/** Every line the readout must have, by the words it starts with. */
const FIELDS = [
  'PORTAGE PERFORMANCE READOUT', 'Build: ', 'Run: ', 'Graphics chip: ', 'Chip maker: ', 'Drawn by software, not a chip: ', 'Browser: ',
  'Processors: ', 'Window: ', 'Canvas: ', 'Screen refresh: ', 'WebGL: ', 'WebGL limits: ', 'WebGL extras: ',
  'THE GAME BY ITSELF', 'Frames a second, every 2 s: ', 'Ladder rung, every 2 s: ', 'Average: ', 'Ladder: ', 'Time between frames: middle ',
  'Frames over 33 ms: ', "The page's own script in a frame: ", 'One frame: ',
  'HONEST COST OF ONE FRAME', 'Top quality (', 'Lowest rung (', 'Low preset (', 'IN SHORT', 'To hold ', 'By itself the game ran at ', 'Notes: ',
  "Browser's full name: ",
];

interface Cost { name: string; rung: number; milliseconds: number; quickest: number; worldWidth: number; worldHeight: number; frames: number }
interface Readout {
  done: boolean;
  text: string;
  data: {
    tookSeconds: number;
    environment: { chip: string; canvasWidth: number; canvasHeight: number; windowWidth: number; windowHeight: number };
    refresh: { hertz: number } | null;
    watched: { average: number; cap: number; preset: string; framesPerSecond: number[]; rungs: number[]; frameTimes: { count: number } } | null;
    costs: Cost[];
    notes: string[];
  };
}

interface Watch {
  problems: string[];
  requests: { url: string; method: string; type: string; at: number }[];
  sockets: string[];
}

/** In build mode: serve the build from disk under a made-up origin with the live site's security headers. */
async function serveBuild(page: Page): Promise<void> {
  if (!DIST) return;
  const policy = readFileSync(HEADERS, 'utf8').split('\n').find((line) => line.trim().startsWith('Content-Security-Policy:'))!
    .trim().slice('Content-Security-Policy:'.length).trim();
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://portage.test' || !url.pathname.startsWith('/portage/')) return route.abort();
    const file = join(DIST, url.pathname.slice('/portage/'.length) || 'index.html');
    if (!existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({
      status: 200, body: readFileSync(file),
      headers: { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-security-policy': policy, 'x-content-type-options': 'nosniff' },
    });
  });
}

/** Everything the page says and asks for, from now on. */
function watch(page: Page): Watch {
  const seen: Watch = { problems: [], requests: [], sockets: [] };
  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    if (!message.text().includes('GL Driver Message')) seen.problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => seen.problems.push(`pageerror: ${error.message}`));
  page.on('request', (request) => seen.requests.push({ url: request.url(), method: request.method(), type: request.resourceType(), at: Date.now() }));
  page.on('websocket', (socket) => seen.sockets.push(socket.url()));
  return seen;
}

const readout = (page: Page): Promise<Readout> => page.evaluate(() => (window as unknown as { portagePerf: Readout }).portagePerf);

/** Open the readout and wait for the finished sheet. Returns it, and the seconds it took from opening the address. */
async function run(page: Page, switches = ''): Promise<{ result: Readout; seconds: number }> {
  const began = Date.now();
  await page.goto(`${BASE}?perf=1${switches}`);
  await page.waitForFunction(() => (window as unknown as { portagePerf?: { done: boolean } }).portagePerf?.done === true, null, { timeout: 150_000 });
  const seconds = (Date.now() - began) / 1000;
  return { result: await readout(page), seconds };
}

/** All of the page's storage, as one string. */
const storageOf = (page: Page): Promise<string> => page.evaluate(async () => JSON.stringify({
  local: Object.entries(window.localStorage).sort(),
  session: Object.entries(window.sessionStorage).sort(),
  databases: (await window.indexedDB.databases()).map((database) => database.name),
  cookies: document.cookie,
  caches: await window.caches.keys(),
}));

const costOf = (result: Readout, name: string): Cost => result.data.costs.find((cost) => cost.name === name)!;

test('one link: it runs by itself, reports everything, copies, sends nothing and stores nothing', async ({ page, context }) => {
  await serveBuild(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  const seen = watch(page);

  // A normal game first: without the switch none of the readout is loaded, and nothing of it runs.
  await page.goto(BASE);
  await page.waitForFunction(() => (window as unknown as { portage?: { loop?: { running: boolean } } }).portage?.loop?.running === true);
  await page.waitForTimeout(1500);
  const normal = seen.requests.map((request) => request.url);
  expect(normal.length).toBeGreaterThan(0);
  expect(normal.filter((url) => /\/perf\/|readout|staging|\/bot\/|debug-|debug\/index/i.test(new URL(url).pathname))).toEqual([]);
  expect(await page.evaluate(() => 'portagePerf' in window)).toBe(false);
  expect(await page.locator('.pf-root').count()).toBe(0);

  // The player's own things: settings that are not the defaults, and a save.
  await page.evaluate(() => {
    window.localStorage.setItem('portage.settings', JSON.stringify({
      version: 2, graphics: { qualityPreset: 'low', renderScale: 0.75, shadows: 'off', waterDetail: 'low', fieldOfView: 60, fpsCap: 30, showFps: false },
    }));
    window.localStorage.setItem('portage.save.0', 'a save that must not be touched');
    window.sessionStorage.setItem('portage.test', 'kept');
  });
  const storedBefore = await storageOf(page);
  expect(storedBefore).toContain('"fpsCap\\":30');

  // The one link.
  const firstRequest = seen.requests.length;
  const began = Date.now();
  await page.goto(`${BASE}?perf=1`);
  // It says how far along it is, in plain words, and counts up.
  const line = page.locator('.pf-card .pf-line');
  await expect(line).toHaveText(/^Measuring, \d+ of 30 seconds$/, { timeout: 15_000 });
  const counted: number[] = [];
  const counting = setInterval(() => {
    void line.textContent({ timeout: 500 }).then((text) => {
      const match = /^Measuring, (\d+) of 30 seconds$/.exec(text ?? '');
      if (match) counted.push(Number(match[1]));
    }).catch(() => undefined);
  }, 500);
  await page.waitForTimeout(12_000);
  const measuringAt = Date.now();
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `measuring-${page.viewportSize()!.width}x${page.viewportSize()!.height}.png`) });
  await page.waitForFunction(() => (window as unknown as { portagePerf?: { done: boolean } }).portagePerf?.done === true, null, { timeout: 150_000 });
  clearInterval(counting);
  const tookSeconds = (Date.now() - began) / 1000;
  const result = await readout(page);
  const text = result.text;
  const lines = text.split('\n');
  console.log(`finished ${tookSeconds.toFixed(1)} s after the address was opened (the readout says ${result.data.tookSeconds.toFixed(1)} s); progress seen: ${[...new Set(counted)].join(' ')}`);
  console.log(text);

  // Inside its time limit, and the count only went up.
  expect(tookSeconds).toBeLessThan(LIMIT_SECONDS);
  expect(result.data.tookSeconds).toBeGreaterThan(20);
  expect(new Set(counted).size).toBeGreaterThanOrEqual(8);
  expect(counted).toEqual([...counted].sort((first, second) => first - second));

  // It ends on the text, a Copy button and one line.
  const area = page.locator('textarea.pf-text');
  await expect(area).toBeVisible();
  expect(await area.inputValue()).toBe(text);
  await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeVisible();
  await expect(page.getByText('Send this to Luc.', { exact: true })).toBeVisible();
  await expect(page.locator('.pf-card')).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `finished-${page.viewportSize()!.width}x${page.viewportSize()!.height}.png`) });

  // Every field, under 60 lines.
  for (const field of FIELDS) expect(lines.some((entry) => entry.startsWith(field)), `no line starts with "${field}"`).toBe(true);
  expect(lines.length).toBeLessThan(60);
  expect(text).toContain('test switches: none');
  expect(text).toMatch(/Notes: none\.$/m);
  expect(text).not.toMatch(/NaN|undefined|Infinity|null/);

  // What it says is what was drawn: the window's size, the default settings (not the player's Low and 30), the three qualities.
  const { data } = result;
  expect(data.environment.chip).toMatch(/Apple|ANGLE|hidden/);
  expect([data.environment.windowWidth, data.environment.windowHeight]).toEqual([1920, 1080]);
  expect([data.environment.canvasWidth, data.environment.canvasHeight]).toEqual([1920, 1080]);
  expect(data.refresh!.hertz).toBeGreaterThan(20);
  expect(data.watched!.preset).toBe('High');
  expect(data.watched!.cap).toBe(60);
  expect(text).toContain('THE GAME BY ITSELF (default settings: High preset, cap 60 a second, 20 seconds)');
  expect(data.watched!.framesPerSecond).toHaveLength(10);
  expect(data.watched!.rungs).toHaveLength(10);
  expect(data.watched!.average).toBeGreaterThan(40);
  expect(data.watched!.frameTimes.count).toBeGreaterThan(800);
  const [top, last, low] = ['Top quality', 'Lowest rung', 'Low preset'].map((name) => costOf(result, name));
  expect([top.rung, top.worldWidth, top.worldHeight]).toEqual([0, 1920, 1080]);
  // The ladder's last rung: the world at half size.
  expect([last.rung, last.worldWidth, last.worldHeight]).toEqual([11, 960, 540]);
  expect([low.rung, low.worldWidth, low.worldHeight]).toEqual([0, 1440, 810]);
  for (const cost of [top, last, low]) {
    expect(cost.milliseconds).toBeGreaterThan(0.5);
    expect(cost.milliseconds).toBeLessThan(100);
    expect(cost.frames).toBeGreaterThan(20);
  }
  if (TOP_RANGE.length === 2) {
    expect(top.milliseconds).toBeGreaterThanOrEqual(TOP_RANGE[0]);
    expect(top.milliseconds).toBeLessThanOrEqual(TOP_RANGE[1]);
  }

  // Copy works.
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.locator('.pf-note')).toHaveText('Copied. Paste it into a message.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);

  // And when the browser refuses the clipboard, the text is left selected with the keys to press.
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: () => Promise.reject(new Error('refused')) });
    document.execCommand = () => false;
    document.querySelector<HTMLTextAreaElement>('textarea.pf-text')!.setSelectionRange(0, 0);
  });
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.locator('.pf-note')).toHaveText('The text is selected. Press Ctrl+C (Cmd+C on a Mac) to copy it.');
  expect(await area.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd, document.activeElement === element])).toEqual([0, text.length, true]);

  // Nothing left the page: the game's own files from its own address, and nothing else. No request at all once it was measuring.
  const asked = seen.requests.slice(firstRequest);
  const origin = new URL(BASE).origin;
  expect(asked.filter((request) => new URL(request.url).origin !== origin).map((request) => request.url)).toEqual([]);
  expect(asked.filter((request) => request.method !== 'GET' || !['document', 'script', 'stylesheet', 'font', 'image'].includes(request.type))
    .map((request) => `${request.method} ${request.type} ${request.url}`)).toEqual([]);
  expect(asked.filter((request) => new URL(request.url).search !== '' && request.type !== 'document' && DIST !== '').map((request) => request.url)).toEqual([]);
  expect(asked.filter((request) => request.at > measuringAt).map((request) => request.url)).toEqual([]);
  // The dev server keeps one socket of its own, for reloading. A build has none.
  expect(seen.sockets.filter((url) => DIST !== '' || new URL(url).host !== new URL(BASE).host)).toEqual([]);

  // Nothing was stored, and the player's settings and save are as they were.
  expect(await storageOf(page)).toBe(storedBefore);

  expect(seen.problems).toEqual([]);
});

test('the time caps hold on a slow chip: 24 times the work, still inside a minute', async ({ page }) => {
  await serveBuild(page);
  const seen = watch(page);
  const { result, seconds } = await run(page, '&bench=24');
  const top = costOf(result, 'Top quality');
  console.log(`bench=24: finished ${seconds.toFixed(1)} s after the address was opened; top quality ${top.milliseconds.toFixed(0)} ms a frame (${top.frames} frames), `
    + `${result.data.watched!.average.toFixed(1)} frames a second by itself`);
  expect(seconds).toBeLessThan(LIMIT_SECONDS);
  // It really was slow: a top-quality frame took over a tenth of a second.
  expect(top.milliseconds).toBeGreaterThan(100);
  // By itself the game still fell far short of 60. (Under 10 before the ladder learned to start low on a slow chip; about 16 since.)
  expect(result.data.watched!.average).toBeLessThan(30);
  expect(result.data.costs).toHaveLength(3);
  expect(result.text).toContain('test switches: bench=24');
  expect(result.text.split('\n').length).toBeLessThan(60);
  await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeVisible();
  expect(seen.problems).toEqual([]);
});

test.describe('true numbers', () => {
  // The chip is not always ours. Measured on this Mac with no other test running: the same plain run read 5.2 ms a
  // frame with the chip to itself and 12.3 to 13.2 ms a few minutes earlier, when another program was on it. That
  // program takes about half for minutes at a time, and its bursts push the middle batch up by a fifth to a half.
  // One plain run against one doubled run, 30 seconds apart, then reads 2.0 on a quiet chip and 2.0 to 3.1 on a
  // shared one. It is not a cold start: the first run in a new browser reads within a tenth of the next plain one. So:
  //  - each run is read by its quickest batch, the chip at its least disturbed (the sheet prints it: "batches A to B");
  //  - the runs go plain, doubled, plain, doubled, and each doubled run is set against the plain runs beside it;
  //  - the middle of those three ratios is judged. One change on the chip spoils one ratio, never the middle.
  // No retries: a red here is two spoiled ratios out of three, or a real fault.
  test('doubling the work about doubles the honest frame cost', async ({ page }) => {
    await serveBuild(page);
    const runs: { top: Cost; last: Cost }[] = [];
    for (const switches of ['', '&bench=2', '', '&bench=2']) {
      const { result } = await run(page, switches);
      runs.push({ top: costOf(result, 'Top quality'), last: costOf(result, 'Lowest rung') });
    }
    // The same two pictures four times: top quality on the whole window, and the last rung at half that size.
    for (const { top, last } of runs) {
      expect([top.rung, top.worldWidth, top.worldHeight]).toEqual([0, 1920, 1080]);
      expect([last.rung, last.worldWidth, last.worldHeight]).toEqual([11, 960, 540]);
    }
    const [once, twice, onceAgain, twiceAgain] = runs.map(({ top }) => top.quickest);
    const ratios = [twice / once, twice / onceAgain, twiceAgain / onceAgain];
    const middle = [...ratios].sort((first, second) => first - second)[1];
    const smaller = runs.map(({ top, last }) => top.quickest / last.quickest);
    console.log(`top quality, quickest batch (middle batch): ${runs.map(({ top }, index) => `${index % 2 === 0 ? 'plain' : 'doubled'} ${top.quickest.toFixed(1)} (${top.milliseconds.toFixed(1)}) ms`).join(', ')}. `
      + `Doubled against plain: ${ratios.map((ratio) => ratio.toFixed(2)).join(', ')} times, middle ${middle.toFixed(2)}. `
      + `Top quality against the last rung: ${smaller.map((ratio) => ratio.toFixed(2)).join(', ')} times`);
    // It is the chip's time, not the script's. A timer that does not wait for the chip reads the script's time in its
    // quickest batch: the same at any size (and 1.6 to 2.1 times with the draws doubled, which the check below lets by).
    // The last rung makes the same draw calls on a quarter of the pixels: honest, top quality costs 2 to 3 times that.
    // The second lowest of the four is judged, so one run that straddles a change on the chip is forgiven.
    expect([...smaller].sort((first, second) => first - second)[1]).toBeGreaterThan(1.5);
    expect(middle).toBeGreaterThan(1.6);
    expect(middle).toBeLessThan(2.5);
  });
});
