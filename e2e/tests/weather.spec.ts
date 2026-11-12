/**
 * The weather and the night, checked in a real browser on the real graphics card:
 *
 * - calm: paused in a storm at night with the lantern lit, not one pixel changes; playing, the picture's
 *   brightness never jumps from one frame to the next; and with a still camera the land changes only where
 *   a rain stroke is drawn (with the strokes left out, `&rain=0`, not one pixel of it changes);
 * - clear, rain, storm and fog are told apart, afloat: by the sky, the far shore, the water and the rain;
 * - night: the lantern makes the canoe and the water round it plainly brighter, and the canoe still shows
 *   with the lantern dark;
 * - true to the rules: the rain eases in when the rules start it, and holds still when the game is paused;
 *   the sky shows the next weather standing upwind as its time nears;
 * - it holds 55 frames a second in a storm, at night, and in a storm at night, at 1920×1080 on rung 0;
 * - the heroes are drawn at the window's size with the full pen in a storm at night on the ladder's last rung;
 * - the ladder's first rung sheds the weather's fine work and nothing else;
 * - a rain stroke stops at what stands in front of it: none shows through the canoe and its crew, none through the ground.
 *
 * Needs the dev server (PORTAGE_URL, default http://localhost:5221).
 *
 * PORTAGE_LOOK_BREAK adds switches to every address: `&bench=24` fails the frame rate, `&hero=0` the heroes.
 * The other checks are broken in the source: see "Weather and night" in game/LOOK.md.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const BASE = process.env.PORTAGE_URL ?? 'http://localhost:5221';
const BREAK = process.env.PORTAGE_LOOK_BREAK ?? '';

test.use({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
});
test.setTimeout(240_000);

interface Probe {
  canvasWidth: number;
  canvasHeight: number;
  drawingWidth: number;
  drawingHeight: number;
  hero: { windows: { x: number; y: number; w: number; h: number }[]; pixelsPerCanvasPixel: number; inkScale: number; fine: number };
  weather: {
    rain: number; storm: number; veil: number; overcast: number; visibility: number; wind: [number, number]; ahead: number;
    stars: number; lampShare: number; wet: number; strokes: number; fallen: [number, number, number]; pools: number; glows: number;
  };
  rung: number;
  quality: { weather: number; reflection: number; fine: number; ink: number; resolution: number };
  shed: string;
}

/** Strokes in a full storm (RAIN_STROKES in game/src/look/rain.ts). */
const STORM_STROKES = 2400;

/** Run in the page before a staging line: `W(kind, next)` sets the rules' weather, `H(hour)` the rules' clock. */
const STAGE = `
  const W = (kind, next) => { const w = game.weather; w.kind = kind; w.secondsRemaining = 240; w.nextKind = next ?? (kind === 'clear' ? 'rain' : 'clear');
    w.stormLevel = kind === 'storm' ? 1 : 0; w.windSpeed = w.windTarget = { clear: 4, fog: 1.5, rain: 6, storm: 10 }[kind]; };
  const H = (hour) => { game.time = Math.floor(game.time / 1440) * 1440 + hour * 60; };
`;

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    if (!message.text().includes('GL Driver Message')) problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

async function open(page: Page, query: string, settleMilliseconds = 1500): Promise<void> {
  await page.goto(`${BASE}/?${query}${BREAK}`);
  await page.waitForFunction(() => {
    const view = (window as unknown as { portage?: { worldView?: { probe?: () => { drawingWidth: number } } } }).portage?.worldView;
    return view?.probe !== undefined && view.probe().drawingWidth > 0;
  });
  await page.addStyleTag({ content: '#interface { visibility: hidden !important; }' });
  await page.waitForTimeout(settleMilliseconds);
}

const probe = (page: Page): Promise<Probe> =>
  page.evaluate(() => (window as unknown as { portage: { worldView: { probe: () => Probe } } }).portage.worldView.probe());

/** Change the rules' state in the page (`game`, `session` and `view` are in scope, with `W` and `H`). `settle` lands the look on it at once. */
async function stage(page: Page, code: string, settle = true, waitMilliseconds = 700): Promise<void> {
  await page.evaluate(([body, land]) => {
    const { session, worldView } = (window as unknown as { portage: { session: { game: unknown }; worldView: { settle: () => void } } }).portage;
    new Function('game', 'session', 'view', body as string)(session.game, session, worldView);
    if (land) worldView.settle();
  }, [`${STAGE}\n${code}`, settle] as const);
  await page.waitForTimeout(waitMilliseconds);
}

/** What two captures of one size are, pixel against pixel: how many differ, and each one's mean brightness (0 to 255). */
async function compare(page: Page, first: Buffer, second: Buffer): Promise<{ different: number; total: number; brightness: [number, number] }> {
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
    const sums = [0, 0];
    for (let offset = 0; offset < left.data.length; offset += 4) {
      if (left.data[offset] !== right.data[offset] || left.data[offset + 1] !== right.data[offset + 1] || left.data[offset + 2] !== right.data[offset + 2]) different += 1;
      sums[0] += left.data[offset] * 0.3 + left.data[offset + 1] * 0.5 + left.data[offset + 2] * 0.2;
      sums[1] += right.data[offset] * 0.3 + right.data[offset + 1] * 0.5 + right.data[offset + 2] * 0.2;
    }
    const total = left.data.length / 4;
    return { different, total, brightness: [sums[0] / total, sums[1] / total] as [number, number] };
  }, [first.toString('base64'), second.toString('base64')]);
}

/** A capture's mean brightness, how much drawn detail it holds (the mean brightness step between neighbours), and the share of it that is white marks. */
async function measure(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<{ brightness: number; contrast: number; marks: number }> {
  const png = await page.screenshot({ clip });
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const at = (x: number, y: number): number => { const offset = (y * width + x) * 4; return data[offset] * 0.3 + data[offset + 1] * 0.5 + data[offset + 2] * 0.2; };
    let sum = 0;
    let steps = 0;
    for (let y = 0; y < height - 1; y += 1) {
      for (let x = 0; x < width - 1; x += 1) {
        const here = at(x, y);
        sum += here;
        steps += Math.max(Math.abs(at(x + 1, y) - here), Math.abs(at(x, y + 1) - here));
      }
    }
    const total = (width - 1) * (height - 1);
    // White marks: pixels far brighter than the capture's own mean.
    let marks = 0;
    for (let y = 0; y < height - 1; y += 1) for (let x = 0; x < width - 1; x += 1) if (at(x, y) > sum / total + 45) marks += 1;
    return { brightness: sum / total, contrast: steps / total, marks: marks / total };
  }, png.toString('base64'));
}

/**
 * The picture's mean brightness on each of `frames` frames in a row, read from the canvas itself straight after the
 * look draws it (a screenshot would skip frames).
 */
async function brightnessByFrame(page: Page, frames: number): Promise<number[]> {
  return page.evaluate((count) => new Promise<number[]>((resolve) => {
    const canvas = document.querySelector<HTMLCanvasElement>('#world canvas')!;
    const gl = canvas.getContext('webgl2')!;
    const [width, height] = [canvas.width, Math.floor(canvas.height / 2)];
    const pixels = new Uint8Array(width * height * 4);
    const means: number[] = [];
    const frame = (): void => {
      // The middle half of the picture, every pixel.
      gl.readPixels(0, Math.floor(canvas.height / 4), width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let sum = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) sum += pixels[offset] * 0.3 + pixels[offset + 1] * 0.5 + pixels[offset + 2] * 0.2;
      means.push(sum / (width * height));
      if (means.length < count) requestAnimationFrame(frame);
      else resolve(means);
    };
    requestAnimationFrame(frame);
  }), frames);
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

const WHOLE = { x: 0, y: 150, width: 1920, height: 750 };
// Land only, in the staged island view: rock, moss and trees, clear of the sky, the water and the player.
const LAND = { x: 60, y: 600, width: 700, height: 300 };

test('paused in a storm at night with the lantern lit, not one pixel changes', async ({ page }) => {
  const problems = watchConsole(page);
  await open(page, 'shot=night&hold=1');
  await stage(page, "W('storm'); H(23.5);");
  const look = await probe(page);
  expect(look.weather.strokes).toBe(STORM_STROKES);
  expect(look.weather.pools).toBeGreaterThanOrEqual(2);
  expect(look.weather.lampShare).toBe(1);
  const first = await page.screenshot({ clip: WHOLE });
  await page.waitForTimeout(400);
  const second = await page.screenshot({ clip: WHOLE });
  const still = await compare(page, first, second);
  console.log(`paused, storm at night, lantern lit: ${still.different} of ${still.total} pixels changed in 400 ms; ${look.weather.strokes} rain strokes, ${look.weather.pools} lamp pools`);
  expect(still.different).toBe(0);
  expect((await probe(page)).weather.fallen).toEqual(look.weather.fallen);
  expect(problems).toEqual([]);
});

test('playing in a storm at night, the brightness never jumps from one frame to the next', async ({ page }) => {
  const problems = watchConsole(page);
  await open(page, 'shot=night&live=1&hold=1');
  await stage(page, "W('storm'); H(23.5);", true, 1500);
  const means = await brightnessByFrame(page, 120);
  const jumps = means.slice(1).map((mean, index) => Math.abs(mean - means[index]));
  const [worst, spread] = [Math.max(...jumps), Math.max(...means) - Math.min(...means)];
  console.log(`storm at night, 120 frames: mean brightness ${Math.min(...means).toFixed(2)} to ${Math.max(...means).toFixed(2)} of 255; biggest step between two frames ${worst.toFixed(3)}`);
  expect((await probe(page)).weather.strokes).toBe(STORM_STROKES);
  // No flash, no strobe: a frame is never more than a third of one grey level from the last, and two seconds stay within four
  // (the waves roll under the lantern's pool, slowly).
  expect(worst).toBeLessThan(0.35);
  expect(spread).toBeLessThan(4);
  expect(problems).toEqual([]);
});

test('playing, the land changes only where a rain stroke is drawn, and lamp light on it holds still', async ({ page }) => {
  const problems = watchConsole(page);
  const pair = async (): Promise<{ different: number; total: number }> => {
    const first = await page.screenshot({ clip: LAND });
    await page.waitForTimeout(400);
    return compare(page, first, await page.screenshot({ clip: LAND }));
  };
  // A storm with the strokes left out: wet ground, storm light, the lot. Nothing moves.
  await open(page, 'shot=island&live=1&hold=1&rain=0');
  await stage(page, "W('storm'); H(10);");
  const bare = await pair();
  expect((await probe(page)).weather.wet).toBeGreaterThan(0.85);
  // The same with the strokes: something changes, and only a little of the land.
  await open(page, 'shot=island&live=1&hold=1');
  await stage(page, "W('storm'); H(10);");
  const rained = await pair();
  // Night by the camp fire, dry: the fire's light does not flicker.
  await stage(page, "W('clear'); H(23.5);");
  const lit = await pair();
  const night = await probe(page);
  console.log(`land crop, playing: storm without strokes ${bare.different} of ${bare.total} pixels changed in 400 ms; storm with strokes ${rained.different} `
    + `(${((rained.different / rained.total) * 100).toFixed(1)}%); night by the fire ${lit.different} (${night.weather.pools} pools, lamp share ${night.weather.lampShare})`);
  expect(bare.different).toBe(0);
  expect(rained.different).toBeGreaterThan(200);
  expect(rained.different / rained.total).toBeLessThan(0.12);
  expect(night.weather.pools).toBeGreaterThanOrEqual(1);
  expect(lit.different).toBe(0);
  expect(problems).toEqual([]);
});

test('clear, rain, storm and fog are told apart afloat', async ({ page }) => {
  const problems = watchConsole(page);
  await open(page, 'shot=play&live=1&hold=1');
  // The sky over the far shore, the far shore itself, and the water in front of the canoe.
  const [SKY, SHORE, WATER] = [{ x: 200, y: 18, width: 1500, height: 32 }, { x: 200, y: 55, width: 1500, height: 65 }, { x: 200, y: 330, width: 1500, height: 500 }];
  const seen: Record<string, { sky: number; shore: number; water: number; strokes: number }> = {};
  // (shore: how far the far shore's band stands off from the sky above it, in brightness. water: the share of it that is white marks.)
  for (const kind of ['clear', 'rain', 'storm', 'fog']) {
    await stage(page, `W('${kind}'); H(10);`, true, 1200);
    const [sky, shore, water] = [await measure(page, SKY), await measure(page, SHORE), await measure(page, WATER)];
    seen[kind] = { sky: sky.brightness, shore: Math.abs(sky.brightness - shore.brightness), water: water.marks, strokes: (await probe(page)).weather.strokes };
    console.log(`${kind}: sky brightness ${sky.brightness.toFixed(1)}, far shore ${seen[kind].shore.toFixed(1)} off the sky, white marks on the water ${(water.marks * 100).toFixed(2)}%, ${seen[kind].strokes} rain strokes`);
  }
  // Rain: strokes cross the sky, and the sky is greyer than a clear one.
  expect(seen.clear.strokes).toBe(0);
  expect(seen.fog.strokes).toBe(0);
  expect(seen.rain.strokes).toBe(Math.round(STORM_STROKES * 0.6));
  expect(seen.storm.strokes).toBe(STORM_STROKES);
  expect(seen.rain.sky).toBeLessThan(seen.clear.sky - 12);
  // Storm: a darker sky again, and whitecaps. They are the wind's: the same storm with the rules' wind dropped has fewer white marks.
  expect(seen.storm.sky).toBeLessThan(seen.rain.sky - 25);
  await stage(page, "W('storm'); H(10); game.weather.windSpeed = game.weather.windTarget = 2;", true, 1200);
  const lull = await measure(page, WATER);
  console.log(`storm: white marks on the water ${(seen.storm.water * 100).toFixed(2)}% in a 10 m/s wind, ${(lull.marks * 100).toFixed(2)}% at 2 m/s`);
  expect(seen.storm.water).toBeGreaterThan(lull.marks * 1.2);
  // Fog: the far shore goes into the sky, and nothing falls.
  expect(seen.fog.shore).toBeLessThan(seen.clear.shore * 0.7);
  expect(seen.fog.shore).toBeLessThan(2.5);
  expect(problems).toEqual([]);
});

test('at night the lantern makes a clear difference, and the canoe shows without it', async ({ page }) => {
  const problems = watchConsole(page);
  await open(page, 'shot=night&hold=1');
  await stage(page, "W('clear'); H(23.5); game.canoe.lanternLit = true;");
  const lit = await probe(page);
  const hero = lit.hero.windows[0];
  // The canoe and crew (their hero window), and a band of water beside them.
  const canoe = { x: hero.x, y: lit.canvasHeight - hero.y - hero.h, width: hero.w, height: hero.h };
  const water = { x: Math.max(0, canoe.x - 320), y: canoe.y + Math.round(canoe.height * 0.4), width: 300, height: Math.round(canoe.height * 0.5) };
  const far = { x: 1500, y: 300, width: 380, height: 200 };
  const [canoeLit, waterLit, farLit] = [await measure(page, canoe), await measure(page, water), await measure(page, far)];
  await stage(page, 'game.canoe.lanternLit = false;');
  const dark = await probe(page);
  const [canoeDark, waterDark, farDark] = [await measure(page, canoe), await measure(page, water), await measure(page, far)];
  console.log(`night: canoe brightness ${canoeDark.brightness.toFixed(1)} dark, ${canoeLit.brightness.toFixed(1)} lit (×${(canoeLit.brightness / canoeDark.brightness).toFixed(2)}); `
    + `water beside it ${waterDark.brightness.toFixed(1)} dark, ${waterLit.brightness.toFixed(1)} lit (×${(waterLit.brightness / waterDark.brightness).toFixed(2)}); `
    + `far water ${farDark.brightness.toFixed(1)} and ${farLit.brightness.toFixed(1)}; canoe contrast in the dark ${canoeDark.contrast.toFixed(2)}; `
    + `pools ${dark.weather.pools} dark, ${lit.weather.pools} lit; stars ${lit.weather.stars}`);
  expect(lit.weather.pools).toBe(dark.weather.pools + 1);
  expect(lit.weather.stars).toBe(1);
  // The lantern lights the canoe, the crew and the water near it, and nothing far off.
  // (the staged canoe has a firebox aboard, which the rules keep burning: it is not black with the lantern out)
  expect(canoeLit.brightness).toBeGreaterThan(canoeDark.brightness * 1.2);
  expect(waterLit.brightness).toBeGreaterThan(waterDark.brightness * 1.3);
  expect(Math.abs(farLit.brightness - farDark.brightness)).toBeLessThan(1);
  // Without it the canoe is still drawn in the full pen: its lines and washes carry contrast.
  expect(canoeDark.contrast).toBeGreaterThan(4);
  expect(problems).toEqual([]);
});

test('the rain eases in when the rules start it, and holds still while the game is paused', async ({ page }) => {
  const problems = watchConsole(page);
  await open(page, 'shot=play&live=1&hold=1');
  await stage(page, "W('clear'); H(10);");
  expect((await probe(page)).weather.rain).toBe(0);
  // The rules turn to rain: the look follows, a little at a time.
  await stage(page, "W('rain');", false, 1000);
  const easing = await probe(page);
  expect(easing.weather.rain).toBeGreaterThan(0.05);
  expect(easing.weather.rain).toBeLessThan(0.45);
  expect(easing.weather.strokes).toBeGreaterThan(0);
  expect(easing.weather.strokes).toBeLessThan(STORM_STROKES * 0.45);
  // Paused: the rain neither falls nor builds.
  await stage(page, 'session.frozen = true;', false, 300);
  const held = await probe(page);
  await page.waitForTimeout(600);
  const later = await probe(page);
  console.log(`rain a second after the rules start it: level ${easing.weather.rain.toFixed(3)}, ${easing.weather.strokes} strokes; paused: level ${held.weather.rain.toFixed(4)} then ${later.weather.rain.toFixed(4)}, fallen ${held.weather.fallen.map((value) => value.toFixed(3)).join(' ')} then ${later.weather.fallen.map((value) => value.toFixed(3)).join(' ')}`);
  expect(later.weather.rain).toBe(held.weather.rain);
  expect(later.weather.fallen).toEqual(held.weather.fallen);
  expect(problems).toEqual([]);
});

test('the sky shows the next weather standing upwind as its time nears', async ({ page }) => {
  const problems = watchConsole(page);
  await open(page, 'shot=play&hold=1');
  // The wind blows from dead ahead, so upwind is in the picture.
  const SKY = { x: 400, y: 30, width: 1100, height: 60 };
  await stage(page, "W('clear', 'storm'); H(10); game.weather.windDirection = game.canoe.heading + Math.PI; game.weather.secondsRemaining = 240;");
  const before = { look: await probe(page), sky: await measure(page, SKY) };
  await stage(page, 'game.weather.secondsRemaining = 45;');
  const coming = { look: await probe(page), sky: await measure(page, SKY) };
  await stage(page, 'game.weather.secondsRemaining = 5;');
  const near = { look: await probe(page), sky: await measure(page, SKY) };
  console.log(`a storm coming: sky ahead ${before.sky.brightness.toFixed(1)} at 240 s (ahead ${before.look.weather.ahead.toFixed(2)}), `
    + `${coming.sky.brightness.toFixed(1)} at 45 s (${coming.look.weather.ahead.toFixed(2)}), ${near.sky.brightness.toFixed(1)} at 5 s (${near.look.weather.ahead.toFixed(2)})`);
  expect(before.look.weather.ahead).toBe(0);
  expect(coming.look.weather.ahead).toBeGreaterThan(0.2);
  expect(near.look.weather.ahead).toBeGreaterThan(0.9);
  expect(near.sky.brightness).toBeLessThan(before.sky.brightness - 30);
  expect(coming.sky.brightness).toBeLessThanOrEqual(before.sky.brightness);
  expect(problems).toEqual([]);
});

test('holds 55 frames a second in a storm, at night, and in a storm at night, on rung 0', async ({ page }) => {
  const rates: Record<string, number> = {};
  for (const [name, query, code] of [
    ['storm', 'shot=storm&live=1&hold=1', "W('storm'); H(16);"],
    ['night, lantern lit', 'shot=night&live=1&hold=1', "W('clear'); H(23.5);"],
    ['storm at night, lantern lit', 'shot=night&live=1&hold=1', "W('storm'); H(23.5);"],
  ]) {
    await open(page, query, 3000);
    await stage(page, code, true, 1500);
    rates[name] = await medianFrameRate(page, 4);
    const look = await probe(page);
    console.log(`${name}: median ${rates[name].toFixed(1)} fps at ${look.drawingWidth}×${look.drawingHeight}, ladder rung ${look.rung}, ${look.weather.strokes} rain strokes, ${look.weather.pools} lamp pools`);
    expect(look.rung).toBe(0);
    expect(look.quality.weather).toBe(1);
    expect([look.drawingWidth, look.drawingHeight]).toEqual([1920, 1080]);
  }
  for (const rate of Object.values(rates)) expect(rate).toBeGreaterThanOrEqual(55);
});

test('the heroes are drawn at the window\'s size with the full pen in a storm at night, on the last rung', async ({ page }) => {
  const problems = watchConsole(page);
  await open(page, 'shot=night&live=1&rung=9&hold=1');
  await stage(page, "W('storm'); H(23.5);", true, 1200);
  const look = await probe(page);
  console.log(`storm at night, rung ${look.rung}: world ${look.drawingWidth}×${look.drawingHeight}, canvas ${look.canvasWidth}×${look.canvasHeight}, `
    + `${look.hero.windows.length} hero window(s) at ${look.hero.pixelsPerCanvasPixel} pixel a canvas pixel, ink ${look.hero.inkScale}×, fine ${look.hero.fine}`);
  expect(look.rung).toBe(9);
  expect(look.drawingHeight).toBeLessThan(1080);
  expect([look.canvasWidth, look.canvasHeight]).toEqual([1920, 1080]);
  expect(look.hero.windows.length).toBeGreaterThan(0);
  expect(look.hero.pixelsPerCanvasPixel).toBe(1);
  expect(look.hero.inkScale).toBe(2);
  expect(look.hero.fine).toBe(1);
  expect(problems).toEqual([]);
});

/**
 * Of three captures of one held view (with the rain's strokes, without them, and without the heroes either): the share of
 * pixels a stroke plainly marks (more than `step` of 255 on some channel), on the heroes and off them.
 */
async function strokesOn(page: Page, withStrokes: Buffer, without: Buffer, bare: Buffer, step: number): Promise<{ hero: number; heroPixels: number; elsewhere: number }> {
  return page.evaluate(async ([strokesPng, plainPng, barePng, limit]) => {
    const pixelsOf = async (base64: string): Promise<Uint8ClampedArray> => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    };
    const [strokes, plain, empty] = [await pixelsOf(strokesPng as string), await pixelsOf(plainPng as string), await pixelsOf(barePng as string)];
    const counts = { hero: 0, heroMarked: 0, elsewhere: 0, elsewhereMarked: 0 };
    for (let offset = 0; offset < plain.length; offset += 4) {
      const differs = (first: Uint8ClampedArray, second: Uint8ClampedArray, by: number): boolean =>
        Math.abs(first[offset] - second[offset]) > by || Math.abs(first[offset + 1] - second[offset + 1]) > by || Math.abs(first[offset + 2] - second[offset + 2]) > by;
      const hero = differs(plain, empty, 0);
      const marked = differs(strokes, plain, limit as number);
      if (hero) { counts.hero += 1; if (marked) counts.heroMarked += 1; } else { counts.elsewhere += 1; if (marked) counts.elsewhereMarked += 1; }
    }
    return { hero: counts.heroMarked / Math.max(1, counts.hero), heroPixels: counts.hero, elsewhere: counts.elsewhereMarked / Math.max(1, counts.elsewhere) };
  }, [withStrokes.toString('base64'), without.toString('base64'), bare.toString('base64'), step] as const);
}

test('a rain stroke stops at what stands in front of it: the canoe and its crew, and the ground', async ({ page }) => {
  const problems = watchConsole(page);
  await open(page, 'shot=play&hold=1');
  await stage(page, "W('storm'); H(12);");
  expect((await probe(page)).weather.strokes).toBe(STORM_STROKES);
  // The test's own eye. `strokes`, `heroes`: what is drawn. The game is held still throughout, so the three captures differ in that alone.
  const look = (eye: [number, number, number], target: [number, number, number], strokes: boolean, heroes: boolean): Promise<void> =>
    page.evaluate(async ([from, to, rain, crew]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const view = (window as any).portage.worldView;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hold = ((window as any).__look ??= { drawn: view.render.bind(view), pose: null });
      hold.pose = { position: { x: from[0], y: from[1], z: from[2] }, target: { x: to[0], y: to[1], z: to[2] }, fieldOfView: 60 };
      view.render = () => hold.drawn(hold.pose);
      view.marks.scene.visible = false;
      view.rainStrokes = rain;
      view.canoe.group.visible = crew;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }, [eye, target, strokes, heroes] as const);

  // 1. Side on to the canoe from 2.6 m, from low down, so the sky is behind the paddler. A stroke nearer the eye than
  //    2.2 m is not drawn at all (rain.ts), so the strokes that could mark the canoe are nearly all behind it: they must not show.
  const canoe = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { position, heading } = (window as any).portage.session.game.canoe;
    return { x: position.x as number, z: position.z as number, heading: heading as number };
  });
  const eye: [number, number, number] = [canoe.x + Math.cos(canoe.heading) * 2.6, 0.6, canoe.z + Math.sin(canoe.heading) * 2.6];
  const frame = { x: 100, y: 100, width: 1720, height: 880 };
  await look(eye, [canoe.x, 1, canoe.z], true, true);
  const withStrokes = await page.screenshot({ clip: frame });
  await look(eye, [canoe.x, 1, canoe.z], false, true);
  const without = await page.screenshot({ clip: frame });
  await look(eye, [canoe.x, 1, canoe.z], false, false);
  const bare = await page.screenshot({ clip: frame });
  const marked = await strokesOn(page, withStrokes, without, bare, 10);
  console.log(`storm, side on to the canoe from 2.6 m: strokes mark ${(marked.elsewhere * 100).toFixed(2)}% of the view round it, ${(marked.hero * 100).toFixed(3)}% of the canoe and crew (${marked.heroPixels} pixels)`);
  expect(marked.heroPixels, 'the canoe fills a good part of the view').toBeGreaterThan(60_000);
  expect(marked.elsewhere, 'it is raining round the canoe').toBeGreaterThan(0.004);
  expect(marked.hero, 'no rain shows through the canoe').toBeLessThan(marked.elsewhere * 0.2);

  // 2. Looking down at open ground from 1.5 m: everything in the lower half is nearer than 2.2 m, so every stroke
  //    that could show there is under the ground.
  const ground = await page.evaluate(async () => {
    const sim = await import(/* @vite-ignore */ `${'/src/sim/index.ts'}`);
    return [sim.terrainHeight(14, 1163) as number, sim.terrainHeight(14.9, 1163) as number];
  });
  const lower = { x: 300, y: 560, width: 1320, height: 420 };
  await look([14, ground[0] + 1.5, 1163], [14.9, ground[1], 1163], true, true);
  const wet = await page.screenshot({ clip: lower });
  await look([14, ground[0] + 1.5, 1163], [14.9, ground[1], 1163], false, true);
  const dry = await page.screenshot({ clip: lower });
  const through = await strokesOn(page, wet, dry, dry, 10);
  console.log(`storm, looking down at the ground from 1.5 m: strokes mark ${(through.elsewhere * 100).toFixed(3)}% of it`);
  expect(through.elsewhere, 'no rain shows through the ground').toBe(0);
  expect(problems).toEqual([]);
});

test('the ladder\'s first rung sheds the weather\'s fine work and nothing else', async ({ page }) => {
  const problems = watchConsole(page);
  await open(page, 'shot=play&live=1&hold=1');
  await stage(page, "W('storm'); H(10);");
  const full = await probe(page);
  await open(page, 'shot=play&live=1&rung=1&hold=1');
  await stage(page, "W('storm'); H(10);");
  const shed = await probe(page);
  console.log(`storm: rung 0 ${full.weather.strokes} strokes (${full.shed}); rung 1 ${shed.weather.strokes} strokes (${shed.shed})`);
  expect(full.quality.weather).toBe(1);
  expect(shed.quality).toEqual({ ...full.quality, weather: 0 });
  expect(shed.shed).toBe('shed: weather detail off');
  expect(shed.weather.strokes).toBe(STORM_STROKES / 2);
  expect([shed.drawingWidth, shed.drawingHeight]).toEqual([1920, 1080]);
  expect(problems).toEqual([]);
});
