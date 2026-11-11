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
 * - the whole crew is drawn (a real crew: `?crew=N`), each at their own seat on every hull tier;
 * - each player is drawn doing what their own state says: one paddles while three rest, a drifting canoe
 *   shows nobody paddling, bailing, sleeping and walking follow the player who does them;
 * - a person wears the same clothes whichever player the screen follows;
 * - a far figure reads: zoomed fully out its pen is thinner, its scarf and coat show, and it carries far less
 *   ink than with the full pen. The near views are untouched by it, and it changes smoothly through a zoom;
 * - every staged view runs with a clean console.
 *
 * Needs the dev server (PORTAGE_URL, default http://localhost:5221).
 *
 * PORTAGE_LOOK_BREAK adds switches to every address, to prove each check can fail:
 * `&rung=8` (size), `&boil=1` (steadiness), `&bench=24` (frame rate), `&hero=0` (hero size and sharpness),
 * `&heropen=0` (the far figure). The crew checks are broken in the source: see game/LOOK.md.
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

/** One crew figure, as the look drew it. */
interface Figure {
  id: number;
  seat: number | null;
  position: [number, number, number];
  paddling: number;
  bailing: number;
  asleep: number;
  walking: number;
  kneeling: boolean;
  side: number;
  stride: number;
  coat: string;
  legs: string;
}

/** The parts of the running game the crew tests reach into. */
interface Hooks {
  portage: {
    session: {
      frozen: boolean;
      game: {
        canoe: { hullTier: number; speed: number; waterLevel: number };
        players: { asleep: boolean; position: { x: number; y: number; z: number } }[];
      };
    };
  };
}

/** The coat each player wears, by player id (CREW_MARKS in game/src/data/crew.ts). */
const COATS = ['#d5a542', '#55778f', '#6d866b', '#cd7c5d'];

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
    figures: Figure[];
    pen: number;
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

/**
 * What a capture is made of, as shares of its pixels: pen ink (darker than any wash), the local player's
 * ochre coat and their red scarf.
 */
async function paintShares(page: Page, png: Buffer): Promise<{ ink: number; coat: number; scarf: number }> {
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const count = { ink: 0, coat: 0, scarf: 0 };
    for (let offset = 0; offset < data.length; offset += 4) {
      const [red, green, blue] = [data[offset], data[offset + 1], data[offset + 2]];
      if (red * 0.3 + green * 0.5 + blue * 0.2 < 70) count.ink += 1;
      else if (red > 190 && green > 130 && green < 200 && blue < 110) count.coat += 1;
      else if (red > 170 && green < 120 && blue < 110) count.scarf += 1;
    }
    const total = data.length / 4;
    return { ink: count.ink / total, coat: count.coat / total, scarf: count.scarf / total };
  }, png.toString('base64'));
}

/** Hold the game still without the pause wash, as a staged shot is held. */
const freeze = (page: Page): Promise<void> => page.evaluate(() => { (window as unknown as Hooks).portage.session.frozen = true; });

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

/**
 * Two captures 400 ms apart, taken on one rung of the frame-rate ladder. A ladder step redraws the world on
 * purpose (other pages share this graphics chip, so it can step at any time): that is not a pixel that shimmers.
 * A pair with a step inside it is taken again.
 */
async function stillPair(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<{ first: Buffer; second: Buffer; rungs: string }> {
  const rungs: number[] = [];
  for (let attempt = 0; ; attempt += 1) {
    const changesBefore = (await probe(page)).ladder.changes.length;
    const first = await page.screenshot({ clip });
    await page.waitForTimeout(400);
    const second = await page.screenshot({ clip });
    const look = await probe(page);
    rungs.push(look.rung);
    if (look.ladder.changes.length === changesBefore || attempt >= 4) return { first, second, rungs: rungs.join(' then ') };
  }
}

test('paused, with a still camera, no pixel of the land changes', async ({ page }) => {
  await open(page, 'shot=island', 3000);
  const paused = await page.evaluate(() => (window as unknown as { portage: { session: { paused: boolean } } }).portage.session.paused);
  expect(paused).toBe(true);
  const landPair = await stillPair(page, LAND);
  // The whole-view check judges the painting alone. The HUD's half-clear tape and shadows round one colour step
  // differently from one capture to the next over a live canvas (25 pixels, 1 part in 255). The HUD's own stillness
  // is checked in interface.spec.ts.
  await page.addStyleTag({ content: '#interface { visibility: hidden !important; }' });
  const wholePair = await stillPair(page, { x: 0, y: 150, width: 1920, height: 750 });
  const land = await differingPixels(page, landPair.first, landPair.second);
  const view = await differingPixels(page, wholePair.first, wholePair.second);
  console.log(`paused: land crop ${land.different} of ${land.total} pixels changed in 400 ms (ladder rung ${landPair.rungs}); whole view ${view.different} of ${view.total} (ladder rung ${wholePair.rungs})`);
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

// The whole crew, real players (`?crew=N`). Ashore they stand in a row; one sent a few steps off gets a hero window of their own.
for (const [name, query, crew, stray, windowsAtLeast] of [
  ['ashore, a crew of 4', 'shot=island&crew=4', 4, false, 1],
  ['ashore, a crew of 3 with one a few steps off', 'shot=island&crew=3', 3, true, 2],
  ['afloat, a crew of 4', 'crew=4', 4, false, 1],
] as const) {
  test(`the whole crew is drawn (${name})`, async ({ page }) => {
    const problems = watchConsole(page);
    await open(page, `${query}&rung=8&hold=1`);
    if (stray) {
      await page.evaluate(() => { (window as unknown as Hooks).portage.session.game.players[2].position.x -= 4; });
      await page.waitForTimeout(300);
    }
    const look = await probe(page);
    console.log(`${name}: ${look.hero.crew} figures, hero windows ${look.hero.windows.map((window) => `${window.w}×${window.h}`).join(' ')}`);
    expect(look.hero.crew).toBe(crew);
    expect(look.hero.figures.map((figure) => figure.id)).toEqual([0, 1, 2, 3].slice(0, crew));
    expect(look.hero.windows.length).toBeGreaterThanOrEqual(windowsAtLeast);
    expect(look.hero.pixelsPerCanvasPixel).toBe(1);
    // A live game can log the audio engine's filter warning in a headless browser. That one is not the look's.
    expect(problems.filter((problem) => !problem.includes('BiquadFilter'))).toEqual([]);
  });
}

test('a crew of four sits at their own seats on every hull tier', async ({ page }) => {
  await open(page, 'crew=4&hold=1');
  await freeze(page);
  for (const tier of [0, 1, 2, 3]) {
    await page.evaluate((hullTier) => { (window as unknown as Hooks).portage.session.game.canoe.hullTier = hullTier; }, tier);
    await page.waitForTimeout(250);
    const { figures } = (await probe(page)).hero;
    const along = (seat: number): number => figures.find((figure) => figure.seat === seat)!.position[2];
    console.log(`hull tier ${tier}: seats ${figures.map((figure) => `${figure.seat} at ${figure.position[2].toFixed(2)} m`).join(', ')}`);
    // Player n holds seat n, on the centreline. Along the hull from the stern: seats 0, 2, 3, 1.
    expect(figures.map((figure) => figure.seat)).toEqual([0, 1, 2, 3]);
    for (const figure of figures) expect(figure.position[0]).toBe(0);
    for (const [aft, forward] of [[0, 2], [2, 3], [3, 1]]) expect(along(aft) - along(forward)).toBeGreaterThan(0.6);
    // The two between the seats kneel.
    expect(figures.map((figure) => figure.kneeling)).toEqual([false, false, true, true]);
  }
});

test('one paddles while three rest, and a drifting canoe shows nobody paddling', async ({ page }) => {
  await open(page, 'crew=4&hold=1');
  const speed = (): Promise<number> => page.evaluate(() => (window as unknown as Hooks).portage.session.game.canoe.speed);
  expect((await probe(page)).hero.figures.map((figure) => figure.paddling)).toEqual([0, 0, 0, 0]);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  const working = (await probe(page)).hero.figures.map((figure) => figure.paddling);
  await page.keyboard.up('KeyW');
  // The local player strokes; the three idle crewmates rest their paddles.
  expect(working[0]).toBeGreaterThan(0.95);
  for (const mate of working.slice(1)) expect(mate).toBe(0);
  // Let go: the canoe runs on, and the paddle comes to rest while it still moves.
  await expect.poll(async () => (await probe(page)).hero.figures[0].paddling, { timeout: 4000, intervals: [100] }).toBeLessThan(0.02);
  const drift = await speed();
  console.log(`one paddling: ${working.map((value) => value.toFixed(2)).join(' ')}; at rest again while the canoe still drifts at ${drift.toFixed(2)} m/s`);
  expect(drift).toBeGreaterThan(0.3);
});

test('bailing and sleeping follow the player who does them', async ({ page }) => {
  await open(page, 'crew=4&hold=1');
  await page.evaluate(() => { (window as unknown as Hooks).portage.session.game.canoe.waterLevel = 60; });
  await page.keyboard.down('KeyR');
  await page.waitForTimeout(1500);
  const bailing = (await probe(page)).hero.figures.map((figure) => figure.bailing);
  await page.keyboard.up('KeyR');
  expect(bailing[0]).toBeGreaterThan(0.95);
  for (const mate of bailing.slice(1)) expect(mate).toBe(0);
  await page.evaluate(() => { (window as unknown as Hooks).portage.session.game.players[2].asleep = true; });
  await page.waitForTimeout(1500);
  const asleep = (await probe(page)).hero.figures.map((figure) => figure.asleep);
  console.log(`bailing ${bailing.map((value) => value.toFixed(2)).join(' ')}; asleep ${asleep.map((value) => value.toFixed(2)).join(' ')}`);
  expect(asleep[2]).toBeGreaterThan(0.95);
  for (const index of [0, 1, 3]) expect(asleep[index]).toBe(0);
});

test('ashore, each player walks by their own change in position', async ({ page }) => {
  await open(page, 'at=quest3&crew=4&hold=1');
  expect((await probe(page)).hero.figures.map((figure) => figure.seat)).toEqual([null, null, null, null]);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1200);
  const local = (await probe(page)).hero.figures;
  await page.keyboard.up('KeyW');
  expect(local[0].walking).toBeGreaterThan(0.8);
  expect(local[0].stride).toBeGreaterThan(1);
  for (const mate of local.slice(1)) expect([mate.walking, mate.stride]).toEqual([0, 0]);
  await expect.poll(async () => (await probe(page)).hero.figures[0].walking, { timeout: 4000, intervals: [100] }).toBeLessThan(0.02);
  // A crewmate is moved along, as their own player would move them. They walk; the local player stands.
  // The figures are read while they are still being moved: a walk eases out within a few frames of stopping.
  const mates = await page.evaluate(() => new Promise<Figure[]>((resolve) => {
    const hooks = window as unknown as Hooks & { portage: { worldView: { probe: () => Probe } } };
    const mate = hooks.portage.session.game.players[1];
    let frames = 0;
    const move = (): void => {
      mate.position.x += 0.03;
      frames += 1;
      if (frames < 90) requestAnimationFrame(move);
      else resolve(hooks.portage.worldView.probe().hero.figures);
    };
    requestAnimationFrame(move);
  }));
  console.log(`local walking ${local[0].walking.toFixed(2)} (stride ${local[0].stride.toFixed(1)}); then the mate ${mates[1].walking.toFixed(2)} (stride ${mates[1].stride.toFixed(1)}) while the local stands at ${mates[0].walking.toFixed(2)}`);
  expect(mates[1].walking).toBeGreaterThan(0.8);
  expect(mates[1].stride).toBeGreaterThan(1);
  expect(mates[0].walking).toBeLessThan(0.02);
});

test('a person wears the same clothes whichever player the screen follows', async ({ page }) => {
  await open(page, 'crew=4&hold=1');
  await freeze(page);
  await page.addStyleTag({ content: '#interface { visibility: hidden !important; }' });
  // A new game's camera is still easing in behind the canoe. Wait until the picture holds still.
  let asPlayer0 = await page.screenshot();
  await expect.poll(async () => {
    await page.waitForTimeout(400);
    const again = await page.screenshot();
    const moved = (await differingPixels(page, asPlayer0, again)).different;
    asPlayer0 = again;
    return moved;
  }, { timeout: 20_000, intervals: [100] }).toBe(0);
  const first = await probe(page);
  // The look is told this screen follows player 2 (the dev server hands out the look's own module).
  await page.evaluate(async () => {
    // The very module the page loaded, by the address it was served from (it carries a stamp after an edit).
    const address = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => name.includes('/src/look/crew.ts'));
    const crew = await import(/* @vite-ignore */ address!) as { setLocalPlayerId: (playerId: number) => void };
    crew.setLocalPlayerId(2);
  });
  await page.waitForTimeout(300);
  const second = await probe(page);
  const asPlayer2 = await page.screenshot();
  const changed = await differingPixels(page, asPlayer0, asPlayer2);
  console.log(`a crew of four afloat, screen of player 0 against screen of player 2: ${changed.different} of ${changed.total} pixels differ; coats ${second.hero.figures.map((figure) => figure.coat).join(' ')}`);
  // The look now follows another figure, at another seat.
  expect(second.hero.subject!.y).not.toBe(first.hero.subject!.y);
  // Everyone still wears their own coat, by player id, and the picture is the same one.
  for (const look of [first, second]) expect(look.hero.figures.map((figure) => figure.coat)).toEqual(COATS);
  expect(changed.different).toBe(0);
});

// The far figure (issue 6). Zoomed fully out a player is under a tenth of the window's height: the full pen was a black blob round it.
for (const [width, height] of [[1920, 1080], [5120, 2160]] as const) {
  test(`a far figure reads at ${width}×${height}: thinner pen, less ink, the scarf and coat show`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const shares: Record<string, { ink: number; coat: number; scarf: number }> = {};
    const pen: Record<string, number> = {};
    for (const [name, query, zoomOut] of [['near', '', false], ['far', '', true], ['far, full pen', '&heropen=0', true]] as const) {
      await open(page, `shot=island&rung=8&hold=1${query}`);
      if (zoomOut) await zoomFullyOut(page);
      shares[name] = await paintShares(page, await playerCrop(page));
      pen[name] = (await probe(page)).hero.pen;
    }
    const [near, far, full] = [shares.near, shares.far, shares['far, full pen']];
    console.log(`${width}×${height}, zoomed fully out: pen ${pen.far.toFixed(2)} of its width (near ${pen.near}); ink ${(far.ink * 100).toFixed(1)}% of the figure's crop `
      + `against ${(full.ink * 100).toFixed(1)}% with the full pen and ${(near.ink * 100).toFixed(1)}% near; scarf ${(far.scarf * 100).toFixed(2)}% against ${(full.scarf * 100).toFixed(2)}%; `
      + `coat ${(far.coat * 100).toFixed(1)}% against ${(full.coat * 100).toFixed(1)}%`);
    // At the normal play distance the pen is whole. Fully out it is about half.
    expect(pen.near).toBe(1);
    expect(pen.far).toBeLessThan(0.6);
    expect(pen.far).toBeGreaterThan(0.3);
    // Far less ink round the figure than the full pen leaves, and no more than half again what a near figure carries for its size.
    expect(far.ink).toBeLessThan(full.ink * 0.75);
    expect(far.ink).toBeLessThan(near.ink * 1.5);
    // The scarf and the coat are no longer under the outline.
    expect(far.scarf).toBeGreaterThan(full.scarf * 1.4);
    expect(far.coat).toBeGreaterThan(full.coat * 1.15);
  });
}

test('the thin pen leaves the near views alone', async ({ page }) => {
  // Every staged near view, with the thin pen and with the full pen everywhere: the same picture, pixel for pixel.
  for (const shot of ['island', 'play', 'upgraded']) {
    const captures: Buffer[] = [];
    for (const query of ['', '&heropen=0']) {
      await open(page, `shot=${shot}&hold=1${query}`);
      await page.addStyleTag({ content: '#interface { visibility: hidden !important; }' });
      expect((await probe(page)).hero.pen).toBe(1);
      captures.push(await page.screenshot());
    }
    const changed = await differingPixels(page, captures[0], captures[1]);
    console.log(`shot=${shot}: ${changed.different} of ${changed.total} pixels differ between the thin pen and the full pen`);
    expect(changed.different).toBe(0);
  }
});

test('the pen thins smoothly through a zoom: no pop', async ({ page }) => {
  await open(page, 'shot=island&hold=1');
  await page.mouse.move(960, 540);
  const pens: number[] = [];
  const inks: number[] = [];
  // 40 small turns of the wheel, 3% further out each, from the staged 8 m to the camera's limit.
  for (let step = 0; step < 40; step += 1) {
    const look = await probe(page);
    pens.push(look.hero.pen);
    inks.push((await paintShares(page, await playerCrop(page))).ink * look.hero.subject!.width * look.hero.subject!.height);
    await page.mouse.wheel(0, 30);
    await page.waitForTimeout(80);
  }
  let largestStep = 0;
  let largestInkStep = 0;
  for (let index = 1; index < pens.length; index += 1) {
    // Never back up, never a jump.
    expect(pens[index]).toBeLessThanOrEqual(pens[index - 1]);
    largestStep = Math.max(largestStep, pens[index - 1] - pens[index]);
    largestInkStep = Math.max(largestInkStep, Math.abs(inks[index] - inks[index - 1]) / inks[index - 1]);
  }
  console.log(`zoom: pen ${pens[0]} near, ${pens[pens.length - 1].toFixed(3)} fully out, largest step ${largestStep.toFixed(3)} in one 3% turn; `
    + `ink on the figure changes by at most ${(largestInkStep * 100).toFixed(1)}% from one turn to the next`);
  expect(pens[0]).toBe(1);
  expect(pens[pens.length - 1]).toBeLessThan(0.6);
  // The law's own steepest 3% is 0.087 (LOOK.md); a pen that switched at one distance would step by 0.54.
  expect(largestStep).toBeLessThan(0.1);
  // The picture itself: the ink on the figure never jumps between two turns.
  expect(largestInkStep).toBeLessThan(0.25);
});

test('every staged view runs with a clean console', async ({ page }) => {
  const problems = watchConsole(page);
  for (const shot of SHOTS) {
    await open(page, `shot=${shot}`, 1200);
    expect(problems, `shot=${shot}`).toEqual([]);
  }
  console.log(`${SHOTS.length} views, console clean`);
});
