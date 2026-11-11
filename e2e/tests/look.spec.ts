/**
 * The Ink & Wash look, checked in a real browser on the real graphics card:
 *
 * - it draws the screen's full size at 1920×1080, 2560×1440 and 3840×2160;
 * - paused, with a still camera, not one pixel of the land changes (and none while playing either);
 * - the canoe is drawn at the rules engine's height, on water drawn at the rules engine's height;
 * - it holds 55 frames a second on the water, with the full canoe, on a mid-game island, and zoomed
 *   fully out on an island with the ladder still on rung 0;
 * - the heroes (the crew and the canoe) are drawn at the window's size on the ladder's last rung and
 *   on a 5120×2160 window, and the player is as sharp on the last rung as on the first;
 * - the ladder climbs back after a slow spell, and never changes twice within ten seconds;
 * - the whole crew is drawn;
 * - every staged view runs with a clean console.
 *
 * Needs the dev server (PORTAGE_URL, default http://localhost:5221).
 *
 * PORTAGE_LOOK_BREAK adds switches to every address, to prove each check can fail:
 * `&rung=8` (size), `&boil=1` (steadiness), `&bench=24` (frame rate), `&hero=0` (hero size and sharpness).
 * See game/LOOK.md.
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
  canvasWidth: number;
  canvasHeight: number;
  hero: {
    windows: { x: number; y: number; w: number; h: number }[];
    pixelsPerCanvasPixel: number;
    inkScale: number;
    fine: number;
    crew: number;
    subject: { x: number; y: number; width: number; height: number } | null;
  };
  ladder: { changes: { at: number; from: number; to: number }[]; bestAllowed: number };
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

/** Roll the mouse wheel until the camera is as far out as it goes. */
async function zoomFullyOut(page: Page): Promise<void> {
  const size = page.viewportSize()!;
  await page.mouse.move(size.width / 2, size.height / 2);
  for (let step = 0; step < 30; step += 1) {
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(1200);
}

/**
 * How crisp a capture is: the mean of the strongest tenth of its brightness steps between neighbouring pixels.
 * A pen line on a hero is a step of a hundred or more in one pixel. Stretched from a smaller drawing it is
 * spread over two.
 */
async function edgeStrength(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const brightness = (x: number, y: number): number => {
      const offset = (y * width + x) * 4;
      return data[offset] * 0.3 + data[offset + 1] * 0.5 + data[offset + 2] * 0.2;
    };
    const steps: number[] = [];
    for (let y = 0; y < height - 1; y += 1) {
      for (let x = 0; x < width - 1; x += 1) {
        steps.push(Math.max(Math.abs(brightness(x + 1, y) - brightness(x, y)), Math.abs(brightness(x, y + 1) - brightness(x, y))));
      }
    }
    steps.sort((first, second) => second - first);
    const strongest = steps.slice(0, Math.max(1, Math.floor(steps.length / 10)));
    return strongest.reduce((sum, step) => sum + step, 0) / strongest.length;
  }, png.toString('base64'));
}

/** A capture of the local player's figure, from the look's own account of where it is. */
async function playerCrop(page: Page): Promise<Buffer> {
  const subject = (await probe(page)).hero.subject;
  expect(subject, 'the player is on screen').not.toBeNull();
  const clip = { x: Math.floor(subject!.x), y: Math.floor(subject!.y), width: Math.ceil(subject!.width), height: Math.ceil(subject!.height) };
  await page.addStyleTag({ content: '#interface { visibility: hidden !important; }' });
  return page.screenshot({ clip });
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

test('zoomed fully out on an island it holds 55 frames a second with the ladder on rung 0', async ({ page }) => {
  // The ladder is pinned on rung 0, so this is the full picture's own cost: nothing is shed to make the number.
  await open(page, 'shot=island&live=1&hold=1', 2500);
  await zoomFullyOut(page);
  const rate = await medianFrameRate(page, 6);
  const look = await probe(page);
  console.log(`island, zoomed fully out: median ${rate.toFixed(1)} fps at ${look.drawingWidth}×${look.drawingHeight}, ladder rung ${look.rung}, nothing shed: ${look.quality.fine === 1 && look.quality.ink === 2 && look.quality.resolution === 1}`);
  expect(look.rung).toBe(0);
  expect([look.drawingWidth, look.drawingHeight]).toEqual([1920, 1080]);
  expect(rate).toBeGreaterThanOrEqual(55);
});

// The heroes: the crew and the canoe. Whatever the world is drawn at, they are drawn at the window's own pixels.
for (const [name, width, height, query, zoomOut] of [
  ['on the ladder\'s last rung', 1920, 1080, 'shot=island&live=1&rung=8&hold=1', false],
  ['on the last rung, zoomed fully out', 1920, 1080, 'shot=island&live=1&rung=8&hold=1', true],
  ['on the last rung, afloat', 1920, 1080, 'shot=play&live=1&rung=8&hold=1', false],
  ['at 3840×2160 on the last rung', 3840, 2160, 'shot=island&live=1&rung=8&hold=1', true],
  ['at 5120×2160, past the pixel budget', 5120, 2160, 'shot=island&live=1&hold=1', false],
  ['at 5120×2160 on the last rung, zoomed fully out', 5120, 2160, 'shot=island&live=1&rung=8&hold=1', true],
] as const) {
  test(`the heroes are drawn at the window's size ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await open(page, query);
    if (zoomOut) await zoomFullyOut(page);
    const canvas = await page.evaluate(() => {
      const element = document.querySelector<HTMLCanvasElement>('#world canvas')!;
      return [element.width, element.height];
    });
    const look = await probe(page);
    console.log(`${name}: window ${width}×${height}, canvas ${canvas.join('×')}, world drawn ${look.drawingWidth}×${look.drawingHeight} (rung ${look.rung}), `
      + `hero windows ${look.hero.windows.map((window) => `${window.w}×${window.h}`).join(' ')}, ${look.hero.inkScale} ink texels a pixel, fine strokes ${look.hero.fine}`);
    // The world really is drawn smaller than the window here: that is the case being tested.
    expect(look.drawingWidth).toBeLessThan(width);
    // The canvas is the window's own pixels, and the heroes are drawn into it one pixel for one.
    expect(canvas).toEqual([width, height]);
    expect([look.canvasWidth, look.canvasHeight]).toEqual([width, height]);
    expect(look.hero.windows.length).toBeGreaterThanOrEqual(1);
    expect(look.hero.pixelsPerCanvasPixel).toBe(1);
    // Full pen: the pen's anti-aliasing and the fine strokes, whatever the ladder shed from the world.
    expect(look.hero.inkScale).toBe(2);
    expect(look.hero.fine).toBe(1);
    // The player is inside a hero window, with room for the pen round them.
    const subject = look.hero.subject!;
    const inside = look.hero.windows.some((window) => subject.x >= window.x + 8 && subject.x + subject.width <= window.x + window.w - 8
      && height - subject.y - subject.height >= window.y + 8 && height - subject.y <= window.y + window.h - 8);
    expect(inside).toBe(true);
  });
}

for (const [name, width, height, zoomOut] of [
  ['near', 1920, 1080, false],
  ['zoomed fully out', 1920, 1080, true],
  ['zoomed fully out at 5120×2160', 5120, 2160, true],
] as const) {
  test(`the player is as sharp on the last rung as on the first (${name})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const strength: Record<string, number> = {};
    for (const rung of [0, 8]) {
      await open(page, `shot=island&rung=${rung}&hold=1`);
      if (zoomOut) await zoomFullyOut(page);
      strength[rung] = await edgeStrength(page, await playerCrop(page));
      expect((await probe(page)).rung).toBe(rung);
    }
    console.log(`player crop, ${name}: edge strength ${strength[0].toFixed(1)} on rung 0, ${strength[8].toFixed(1)} on rung 8 (${Math.round((strength[8] / strength[0]) * 100)}%)`);
    expect(strength[0]).toBeGreaterThan(20);
    expect(strength[8]).toBeGreaterThanOrEqual(strength[0] * 0.93);
  });
}

test('the ladder climbs back after a slow spell, and never changes twice within ten seconds', async ({ page }) => {
  // A small window, so the graphics chip is never the reason a frame is long: only the stall is.
  await page.setViewportSize({ width: 960, height: 540 });
  await open(page, 'shot=island&live=1', 4500);
  const stall = (milliseconds: number): Promise<void> =>
    page.evaluate((hold) => (window as unknown as { portage: { worldView: { stall: (hold: number) => void } } }).portage.worldView.stall(hold), milliseconds);
  expect((await probe(page)).rung).toBe(0);
  // A slow spell: every frame held 22 ms, so the game runs at 30 frames a second.
  await stall(22);
  await expect.poll(async () => (await probe(page)).rung, { timeout: 20_000, intervals: [200] }).toBeGreaterThan(0);
  const down = await probe(page);
  // Still slow for five more seconds: the ladder must sit still, not step again.
  await page.waitForTimeout(5000);
  expect((await probe(page)).ladder.changes.length).toBe(down.ladder.changes.length);
  await stall(0);
  await expect.poll(async () => (await probe(page)).rung, { timeout: 60_000, intervals: [500] }).toBe(0);
  const { changes } = (await probe(page)).ladder;
  console.log(`ladder: ${changes.map((change) => `${change.from}>${change.to} at ${change.at.toFixed(1)} s`).join(', ')}`);
  expect(changes[0].to).toBeGreaterThan(changes[0].from);
  for (const change of changes.slice(1)) expect(change.from - change.to).toBe(1);
  for (let index = 1; index < changes.length; index += 1) expect(changes[index].at - changes[index - 1].at).toBeGreaterThanOrEqual(10);
  // It stays there.
  await page.waitForTimeout(3000);
  expect((await probe(page)).ladder.changes.length).toBe(changes.length);
});

for (const [shot, windowsAtLeast] of [['island', 1], ['play', 1]] as const) {
  test(`the whole crew is drawn (${shot}, a made-up crew of four)`, async ({ page }) => {
    const problems = watchConsole(page);
    await open(page, `shot=${shot}&fakecrew=4`);
    const look = await probe(page);
    console.log(`${shot}, crew of four: ${look.hero.crew} figures, hero windows ${look.hero.windows.map((window) => `${window.w}×${window.h}`).join(' ')}`);
    expect(look.hero.crew).toBe(4);
    expect(look.hero.windows.length).toBeGreaterThanOrEqual(windowsAtLeast);
    expect(problems).toEqual([]);
  });
}

test('every staged view runs with a clean console', async ({ page }) => {
  const problems = watchConsole(page);
  for (const shot of SHOTS) {
    await open(page, `shot=${shot}`, 1200);
    expect(problems, `shot=${shot}`).toEqual([]);
  }
  console.log(`${SHOTS.length} views, console clean`);
});
