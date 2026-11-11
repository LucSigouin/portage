/**
 * The Ink & Wash look, checked in a real browser on the real graphics card:
 *
 * - it draws the screen's full size at 1920×1080, 2560×1440 and 3840×2160;
 * - paused, with a still camera, not one pixel of the land changes (and none while playing either);
 * - the canoe is drawn at the rules engine's height, on water drawn at the rules engine's height;
 * - it holds 55 frames a second on the water, with the full canoe, and on a mid-game island;
 * - every staged view runs with a clean console.
 *
 * Needs the dev server (PORTAGE_URL, default http://localhost:5221).
 *
 * PORTAGE_LOOK_BREAK adds switches to every address, to prove each check can fail:
 * `&rung=8` (size), `&boil=1` (steadiness), `&bench=24` (frame rate). See game/LOOK.md.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const BASE = process.env.PORTAGE_URL ?? 'http://localhost:5221';
const BREAK = process.env.PORTAGE_LOOK_BREAK ?? '';
const SHOTS = ['lobby', 'settings', 'play', 'island', 'inventory', 'crafting', 'builder', 'quests', 'map', 'dialogue', 'pause', 'storm', 'night', 'upgraded', 'beacon'];

test.use({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
});
test.setTimeout(240_000);

interface Probe {
  drawingWidth: number;
  drawingHeight: number;
  rung: number;
  quality: { reflection: number; fine: number; ink: number; resolution: number };
  lineBoil: number;
  canoeDrawnHeight: number;
  canoeSimHeight: number;
  waterDrawnAtCanoe: number;
  waterSimAtCanoe: number;
}

/** Console errors, warnings and page errors. The graphics driver's own performance chatter is not a page fault. */
function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    if (!message.text().includes('GL Driver Message')) problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

/** Open a view and wait until the look has drawn a few frames of it. */
async function open(page: Page, query: string, settleMilliseconds = 1500): Promise<void> {
  await page.goto(`${BASE}/?${query}${BREAK}`);
  await page.waitForFunction(() => {
    const view = (window as unknown as { portage?: { worldView?: { probe?: () => { drawingWidth: number } } } }).portage?.worldView;
    return view?.probe !== undefined && view.probe().drawingWidth > 0;
  });
  await page.waitForTimeout(settleMilliseconds);
}

const probe = (page: Page): Promise<Probe> =>
  page.evaluate(() => (window as unknown as { portage: { worldView: { probe: () => Probe } } }).portage.worldView.probe());

/** Count the pixels that differ between two PNG captures of the same size. */
async function differingPixels(page: Page, first: Buffer, second: Buffer): Promise<{ different: number; total: number }> {
  return page.evaluate(async ([firstPng, secondPng]) => {
    const pixelsOf = async (base64: string): Promise<ImageData> => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height);
    };
    const [left, right] = [await pixelsOf(firstPng), await pixelsOf(secondPng)];
    let different = 0;
    for (let offset = 0; offset < left.data.length; offset += 4) {
      if (left.data[offset] !== right.data[offset] || left.data[offset + 1] !== right.data[offset + 1] || left.data[offset + 2] !== right.data[offset + 2]) different += 1;
    }
    return { different, total: left.data.length / 4 };
  }, [first.toString('base64'), second.toString('base64')]);
}

/** Median frames a second over a few seconds of real frames. */
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

for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) {
  test(`draws the screen's full size at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await open(page, 'shot=play');
    const canvas = await page.evaluate(() => {
      const element = document.querySelector<HTMLCanvasElement>('#world canvas')!;
      return { width: element.width, height: element.height, window: [window.innerWidth, window.innerHeight], ratio: window.devicePixelRatio };
    });
    const look = await probe(page);
    console.log(`${width}×${height}: canvas ${canvas.width}×${canvas.height}, window ${canvas.window.join('×')}, pixel ratio ${canvas.ratio}, rung ${look.rung}`);
    expect(canvas.ratio).toBe(1);
    expect(canvas.window).toEqual([width, height]);
    expect([canvas.width, canvas.height]).toEqual([width, height]);
    expect([look.drawingWidth, look.drawingHeight]).toEqual([width, height]);
    expect(look.quality.resolution).toBe(1);
  });
}

// Land only, in the staged island view: rock, moss and trees, clear of the sky, the water, the player and the HUD.
const LAND = { x: 60, y: 600, width: 700, height: 300 };

test('paused, with a still camera, no pixel of the land changes', async ({ page }) => {
  await open(page, 'shot=island', 3000);
  const paused = await page.evaluate(() => (window as unknown as { portage: { session: { paused: boolean } } }).portage.session.paused);
  expect(paused).toBe(true);
  const first = await page.screenshot({ clip: LAND });
  await page.waitForTimeout(400);
  const second = await page.screenshot({ clip: LAND });
  // The whole-view check judges the painting alone. The HUD's half-clear tape and shadows round one colour step
  // differently from one capture to the next over a live canvas (25 pixels, 1 part in 255). The HUD's own stillness
  // is checked in interface.spec.ts.
  await page.addStyleTag({ content: '#interface { visibility: hidden !important; }' });
  const rungBefore = (await probe(page)).rung;
  const whole = await page.screenshot({ clip: { x: 0, y: 150, width: 1920, height: 750 } });
  await page.waitForTimeout(400);
  const wholeAgain = await page.screenshot({ clip: { x: 0, y: 150, width: 1920, height: 750 } });
  const rungAfter = (await probe(page)).rung;
  const land = await differingPixels(page, first, second);
  const view = await differingPixels(page, whole, wholeAgain);
  console.log(`paused: land crop ${land.different} of ${land.total} pixels changed in 400 ms; whole view ${view.different} of ${view.total}; ladder rung ${rungBefore} then ${rungAfter}`);
  expect((await probe(page)).lineBoil).toBe(0);
  expect(land.total).toBe(LAND.width * LAND.height);
  expect(land.different).toBe(0);
  // Paused, the water, the sky and the canoe hold still too.
  expect(view.different).toBe(0);
});

test('while playing, with a still camera, no pixel of the land changes', async ({ page }) => {
  await open(page, 'shot=island&live=1', 3000);
  const first = await page.screenshot({ clip: LAND });
  await page.waitForTimeout(400);
  const second = await page.screenshot({ clip: LAND });
  const land = await differingPixels(page, first, second);
  console.log(`playing: land crop ${land.different} of ${land.total} pixels changed in 400 ms`);
  expect(land.different).toBe(0);
});

for (const shot of ['play', 'storm']) {
  test(`the canoe sits on the drawn water (${shot})`, async ({ page }) => {
    await open(page, `shot=${shot}`);
    const look = await probe(page);
    console.log(`${shot}: canoe drawn ${look.canoeDrawnHeight.toFixed(4)} m, rules engine ${look.canoeSimHeight.toFixed(4)} m; `
      + `water at the canoe drawn ${look.waterDrawnAtCanoe.toFixed(4)} m, rules engine ${look.waterSimAtCanoe.toFixed(4)} m`);
    // The hull is drawn where the rules engine floats it.
    expect(Math.abs(look.canoeDrawnHeight - look.canoeSimHeight)).toBeLessThan(0.0001);
    // The water under it is drawn at the rules engine's wave height, read back from the graphics card.
    expect(Number.isFinite(look.waterDrawnAtCanoe)).toBe(true);
    expect(Math.abs(look.waterDrawnAtCanoe - look.waterSimAtCanoe)).toBeLessThan(0.01);
    // So the hull sits on the drawn water as closely as the rules engine floats it (its buoyancy trails the wave a little).
    expect(Math.abs(look.canoeDrawnHeight - look.waterDrawnAtCanoe)).toBeLessThan(Math.abs(look.canoeSimHeight - look.waterSimAtCanoe) + 0.01);
  });
}

test('holds 55 frames a second on the water, with the full canoe, and on a mid-game island', async ({ page }) => {
  const rates: Record<string, number> = {};
  for (const [name, query] of [['play', 'shot=play&live=1'], ['upgraded', 'shot=upgraded&live=1'], ['mid-game island', 'at=quest7']]) {
    await open(page, query, 3500);
    rates[name] = await medianFrameRate(page, 4);
    const look = await probe(page);
    console.log(`${name}: median ${rates[name].toFixed(1)} fps at ${look.drawingWidth}×${look.drawingHeight}, ladder rung ${look.rung}`);
  }
  for (const rate of Object.values(rates)) expect(rate).toBeGreaterThanOrEqual(55);
});

test('every staged view runs with a clean console', async ({ page }) => {
  const problems = watchConsole(page);
  for (const shot of SHOTS) {
    await open(page, `shot=${shot}`, 1200);
    expect(problems, `shot=${shot}`).toEqual([]);
  }
  console.log(`${SHOTS.length} views, console clean`);
});
