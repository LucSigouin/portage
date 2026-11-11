/**
 * The canoe, checked in a real browser on the real graphics card:
 *
 * - the four hull tiers tell apart from the paddling camera;
 * - each of the 19 attachments draws on the long hull, alone and all together;
 * - the pieces with a state follow it: sail, lantern, canopy;
 * - the fully fitted canoe with a crew of four is still: held, not one pixel changes;
 * - it holds 55 frames a second with everything bolted on and four aboard;
 * - every staged canoe view runs with a clean console.
 *
 * Needs the dev server (PORTAGE_URL, default http://localhost:5221).
 * To prove a check can fail, break what it guards in the source, or set PORTAGE_CANOE_BREAK: see game/LOOK-canoe.md.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const BASE = process.env.PORTAGE_URL ?? 'http://localhost:5221';
/** Switches added to every address, to prove a check can fail: `&boil=1` (stillness), `&bench=24` (frame rate). */
const BREAK = process.env.PORTAGE_CANOE_BREAK ?? '';

const ATTACHMENTS = [
  'cargo_rack', 'rain_catcher', 'firebox', 'fishing_rig', 'outrigger_port', 'outrigger_starboard', 'workbench', 'smoker', 'planter', 'forge',
  'mast_sail', 'rudder', 'lantern_mast', 'canopy', 'map_table', 'winch', 'radio', 'flag', 'figurehead',
];

test.use({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
});
test.setTimeout(240_000);

interface Canoe { hullTier: number; attachments: string[]; sailRaised: boolean; lanternLit: boolean; beached: boolean; waterLevel: number; heading: number }
interface Hooks {
  portage: {
    session: { frozen: boolean; game: { canoe: Canoe } };
    app: { camera: { setOrbit(orbit: { yaw?: number; pitch?: number; distance?: number }): void } };
    worldView: { probe(): { drawingWidth: number; rung: number } };
  };
}

type Clip = { x: number; y: number; width: number; height: number };
/** The paddling camera's view of the canoe, and the staged three-quarter view of it. */
const ASTERN: Clip = { x: 660, y: 330, width: 600, height: 560 };
const QUARTER: Clip = { x: 360, y: 90, width: 1200, height: 900 };

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    if (!message.text().includes('GL Driver Message')) problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

/** Open the staged long canoe, held still, with the interface hidden. */
async function open(page: Page, query = 'shot=upgraded&hold=1'): Promise<void> {
  await page.goto(`${BASE}/?${query}${BREAK}`);
  await page.waitForFunction(() => {
    const hooks = (window as unknown as Partial<Hooks>).portage;
    return hooks?.worldView?.probe !== undefined && hooks.worldView.probe().drawingWidth > 0 && hooks.session?.game !== undefined;
  });
  await page.addStyleTag({ content: '#interface { visibility: hidden !important; }' });
  await page.waitForTimeout(1500);
}

/** Change the canoe the look is drawing, and wait for it to be drawn. */
async function fit(page: Page, change: Partial<Canoe> & { astern?: boolean }): Promise<void> {
  await page.evaluate((wanted) => {
    const { session, app } = (window as unknown as Hooks).portage;
    const { astern, ...canoe } = wanted;
    Object.assign(session.game.canoe, canoe);
    if (astern) app.camera.setOrbit({ yaw: session.game.canoe.heading, pitch: 0.36, distance: 8.5 });
  }, change);
  await page.waitForTimeout(500);
}

/** How many pixels differ between two captures of one size, and how many of the second are lamp-yellow. */
async function compare(page: Page, first: Buffer, second: Buffer): Promise<{ different: number; total: number; lampFirst: number; lampSecond: number }> {
  return page.evaluate(async ([a, b]) => {
    const pixels = async (base64: string): Promise<ImageData> => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height);
    };
    const [one, two] = [await pixels(a), await pixels(b)];
    // the lit lamp's own yellow (#ffd98a), which nothing else on the canoe is as bright as
    const lamp = (data: Uint8ClampedArray, at: number): boolean => data[at] > 238 && data[at + 1] > 196 && data[at + 1] < 236 && data[at + 2] > 100 && data[at + 2] < 170;
    let [different, lampFirst, lampSecond] = [0, 0, 0];
    for (let at = 0; at < one.data.length; at += 4) {
      if (Math.abs(one.data[at] - two.data[at]) + Math.abs(one.data[at + 1] - two.data[at + 1]) + Math.abs(one.data[at + 2] - two.data[at + 2]) > 24) different += 1;
      if (lamp(one.data, at)) lampFirst += 1;
      if (lamp(two.data, at)) lampSecond += 1;
    }
    return { different, total: one.data.length / 4, lampFirst, lampSecond };
  }, [first.toString('base64'), second.toString('base64')]);
}

async function medianFrameRate(page: Page, seconds: number): Promise<number> {
  return page.evaluate((milliseconds) => new Promise<number>((resolve) => {
    const gaps: number[] = [];
    let last = 0;
    const started = performance.now();
    const frame = (now: number): void => {
      if (last > 0) gaps.push(now - last);
      last = now;
      if (now - started < milliseconds) requestAnimationFrame(frame);
      else resolve(1000 / [...gaps].sort((first, second) => first - second)[Math.floor(gaps.length / 2)]);
    };
    requestAnimationFrame(frame);
  }), seconds * 1000);
}

test('the four hull tiers tell apart from the paddling camera', async ({ page }) => {
  const problems = watchConsole(page);
  await open(page);
  const shots: Buffer[] = [];
  for (const tier of [0, 1, 2, 3]) {
    await fit(page, { hullTier: tier, attachments: [], waterLevel: 0, astern: true });
    shots.push(await page.screenshot({ clip: ASTERN }));
  }
  const lines: string[] = [];
  for (let first = 0; first < 4; first += 1) {
    for (let second = first + 1; second < 4; second += 1) {
      const { different } = await compare(page, shots[first], shots[second]);
      lines.push(`${first}/${second}: ${different}`);
      // The canoe covers about 26 000 pixels of this crop. Two tiers must differ over a good part of it:
      // a change of planking, rails and decks, not a few patches.
      expect(different, `tier ${first} against tier ${second}`).toBeGreaterThan(4000);
    }
  }
  console.log(`pixels that differ between hull tiers, astern at 8.5 m: ${lines.join(', ')}`);
  expect(problems).toEqual([]);
});

test('the leaky canoe shows its water at the level the rules give', async ({ page }) => {
  await open(page);
  await fit(page, { hullTier: 0, attachments: [], waterLevel: 0, astern: true });
  const dry = await page.screenshot({ clip: ASTERN });
  await fit(page, { waterLevel: 30 });
  const some = await page.screenshot({ clip: ASTERN });
  await fit(page, { waterLevel: 90 });
  const swamped = await page.screenshot({ clip: ASTERN });
  const [rising, risen] = [await compare(page, dry, some), await compare(page, some, swamped)];
  console.log(`bilge water: ${rising.different} pixels change from dry to 30, ${risen.different} more from 30 to 90`);
  expect(rising.different).toBeGreaterThan(400);
  expect(risen.different).toBeGreaterThan(400);
});

test('each of the 19 attachments draws on the long hull, alone and all together', async ({ page }) => {
  const problems = watchConsole(page);
  await open(page);
  await fit(page, { hullTier: 3, attachments: [], sailRaised: true, lanternLit: true, beached: false });
  const bare = await page.screenshot({ clip: QUARTER });
  const drawn: string[] = [];
  for (const attachment of ATTACHMENTS) {
    await fit(page, { attachments: [attachment] });
    const { different } = await compare(page, bare, await page.screenshot({ clip: QUARTER }));
    drawn.push(`${attachment} ${different}`);
    expect(different, `${attachment}: pixels it adds to the bare hull`).toBeGreaterThan(250);
  }
  await fit(page, { attachments: ATTACHMENTS });
  const all = await compare(page, bare, await page.screenshot({ clip: QUARTER }));
  console.log(`pixels each attachment adds to the bare long hull: ${drawn.join(', ')}; all 19: ${all.different}`);
  expect(all.different).toBeGreaterThan(40_000);
  expect(problems).toEqual([]);
});

test('the sail, the lantern and the canopy follow the canoe\'s state', async ({ page }) => {
  await open(page);
  await fit(page, { hullTier: 3, attachments: ['mast_sail', 'lantern_mast', 'canopy'], sailRaised: true, lanternLit: true, beached: false });
  const base = await page.screenshot({ clip: QUARTER });
  await fit(page, { sailRaised: false });
  const furled = await compare(page, base, await page.screenshot({ clip: QUARTER }));
  await fit(page, { sailRaised: true, lanternLit: false });
  const dark = await compare(page, base, await page.screenshot({ clip: QUARTER }));
  await fit(page, { lanternLit: true, beached: true });
  const covered = await compare(page, base, await page.screenshot({ clip: QUARTER }));
  await fit(page, { beached: false });
  const back = await compare(page, base, await page.screenshot({ clip: QUARTER }));
  console.log(`sail down: ${furled.different} pixels change; lantern out: ${dark.different} change, lamp-yellow ${dark.lampFirst} -> ${dark.lampSecond}; canopy drawn over: ${covered.different}; back to the start: ${back.different}`);
  expect(furled.different).toBeGreaterThan(15_000);
  expect(dark.different).toBeGreaterThan(40);
  expect(dark.lampFirst).toBeGreaterThan(40);
  expect(dark.lampSecond).toBeLessThan(dark.lampFirst / 4);
  expect(covered.different).toBeGreaterThan(3000);
  expect(back.different).toBe(0);
});

test('held still, the fully fitted canoe with a crew of four does not change by one pixel', async ({ page }) => {
  await open(page, 'shot=upgraded&hold=1&crew=4');
  const first = await page.screenshot({ clip: QUARTER });
  await page.waitForTimeout(1200);
  const second = await page.screenshot({ clip: QUARTER });
  const { different, total } = await compare(page, first, second);
  console.log(`fully fitted, crew of four, held: ${different} of ${total} pixels differ over 1.2 s`);
  expect(different).toBe(0);
});

test('holds 55 frames a second fully fitted with a crew of four', async ({ page }) => {
  await page.goto(`${BASE}/?shot=upgraded&live=1&crew=4${BREAK}`);
  await page.waitForFunction(() => (window as unknown as Partial<Hooks>).portage?.worldView?.probe !== undefined);
  await page.waitForTimeout(3500);
  const rate = await medianFrameRate(page, 4);
  const rung = await page.evaluate(() => (window as unknown as Hooks).portage.worldView.probe().rung);
  console.log(`fully fitted, crew of four, live: median ${rate.toFixed(1)} fps, ladder rung ${rung}`);
  expect(rate).toBeGreaterThanOrEqual(55);
  expect(rung).toBe(0);
});

test('every staged canoe view runs with a clean console', async ({ page }) => {
  const problems = watchConsole(page);
  let views = 0;
  for (const crew of [1, 4]) {
    await open(page, `shot=upgraded&hold=1${crew > 1 ? `&crew=${crew}` : ''}`);
    for (const tier of [0, 1, 2, 3]) {
      for (const attachments of [[], tier >= 3 ? ATTACHMENTS : tier === 2 ? ATTACHMENTS.filter((id) => id !== 'winch' && id !== 'radio') : []]) {
        for (const state of [{ sailRaised: true, lanternLit: true, beached: false }, { sailRaised: false, lanternLit: false, beached: true }]) {
          await fit(page, { hullTier: tier, attachments, ...state });
          views += 1;
        }
      }
    }
  }
  console.log(`${views} canoe views, console ${problems.length ? problems.join('; ') : 'clean'}`);
  expect(problems).toEqual([]);
});
