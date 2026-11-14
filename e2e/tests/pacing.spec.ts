/**
 * Pacing in the real game, headless: how evenly it draws on screens that are not 60 Hz,
 * and that the sound engine's start does not land on the first key press in play.
 *
 * A headless browser runs at 60 Hz. Other rates are made up: the page's
 * `requestAnimationFrame` is replaced by a screen that hands out display frames of the
 * chosen rate, each stamped as that screen would stamp it. A screen faster than 60 Hz
 * gets several display frames inside one real one.
 *
 * The made-up screen keeps its own clock: every real frame moves it on by one sixtieth of a
 * second, however long the real frame took. The game is the real one (session, rules, camera,
 * look, the real graphics chip), but a machine busy with other work cannot stall the made-up
 * screen, so what is counted is the pacing and not the machine. "A second" below is a second
 * of the made-up screen. One test runs on the browser's own display and judges only the
 * frames that came on time.
 *
 * Needs the dev server (PORTAGE_URL, default http://localhost:5220).
 * Run: npm --prefix e2e test -- tests/pacing.spec.ts
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const BASE = process.env.PORTAGE_URL ?? 'http://localhost:5220';

test.use({
  viewport: { width: 1280, height: 720 },
  // Render on the graphics card: the software fallback runs at about one frame a second.
  launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
});
test.setTimeout(120_000);

/** Replace the page's display with a made-up one of `rate` frames a second, on its own clock. Runs before the game loads. */
function madeUpScreen(rate: number): void {
  const real = window.requestAnimationFrame.bind(window);
  const period = 1000 / rate;
  let queue: FrameRequestCallback[] = [];
  /** The made-up screen's clock, milliseconds, and the stamp of its last display frame. */
  let clock = 0;
  let screenTime = 0;
  const scope = window as unknown as { madeUpMilliseconds: () => number };
  scope.madeUpMilliseconds = () => clock;
  window.requestAnimationFrame = (callback) => {
    queue.push(callback);
    return queue.length;
  };
  window.cancelAnimationFrame = () => {
    queue = [];
  };
  const pump = (): void => {
    real(pump);
    clock += 1000 / 60;
    // Every display frame of the made-up screen that falls inside this real one.
    while (screenTime + period <= clock + 0.01) {
      screenTime += period;
      const due = queue;
      queue = [];
      for (const callback of due) callback(screenTime);
    }
  };
  real(pump);
}

interface Pacing {
  /** Frames drawn a second (of the made-up screen's clock, when there is one). */
  drawn: number;
  /** Drawn frames that stood for something other than whole sixtieths of a second. */
  offBeat: number;
  /** Drawn frames that carried a different number of rules steps than the sixtieths they stood for. */
  wrongSteps: number;
  /** Frames drawn a second by the real clock: whether the machine kept up. */
  realDrawn: number;
  /** Share of drawn frames by the rules steps they carried, 0 to 1. */
  steps: Record<string, number>;
  /** Drawn frames in which the canoe moved and the camera did not, or the other way round. */
  apart: number;
  /** Drawn frames in which both moved. */
  together: number;
  /** Every `dueSeconds` the look was told, in milliseconds, rounded to a tenth. */
  due: number[];
  /** Every `frameSeconds` the look was told, in milliseconds, rounded to a tenth, with how often. */
  frameMilliseconds: Record<string, number>;
  /** The screen's gap as the loop measured it, milliseconds. */
  screenMilliseconds: number;
  frames: number;
}

/** Open the staged afloat view, running, on a screen of `rate` Hz (0 = the browser's own 60 Hz), and start paddling. */
async function openAfloat(page: Page, rate: number, cap = 60): Promise<void> {
  if (rate > 0) await page.addInitScript(madeUpScreen, rate);
  await page.goto(`${BASE}/?shot=play&live=1`);
  await page.waitForFunction(() => (window as unknown as { portage?: { session: { screen: string } } }).portage?.session.screen === 'game');
  await page.evaluate((fpsCap) => {
    const { session } = (window as unknown as { portage: { session: any } }).portage;
    if (session.settings.graphics.fpsCap !== fpsCap) {
      session.updateSettings({ ...session.settings, graphics: { ...session.settings.graphics, fpsCap } });
    }
  }, cap);
  await page.locator('#world').click({ position: { x: 640, y: 300 } });
  await page.keyboard.down('KeyW');
  // The first frames compile shaders and the sound engine starts on the first key here: let both pass.
  await page.waitForTimeout(3000);
}

/** Watch the frames the look is handed for `seconds`, and sum them up. */
async function watch(page: Page, seconds: number): Promise<Pacing> {
  await page.evaluate(() => {
    const scope = window as unknown as { portage: { worldView: any }; pacing: any };
    const view = scope.portage.worldView;
    const madeUp = (window as unknown as { madeUpMilliseconds?: () => number }).madeUpMilliseconds;
    const clock = (): number => (madeUp ? madeUp() : performance.now());
    const record = { rows: [] as number[][], info: null as any, state: null as any, last: null as any, since: clock(), clock, sinceReal: performance.now() };
    scope.pacing = record;
    const sync = view.sync.bind(view);
    const render = view.render.bind(view);
    view.sync = (state: any, frame: any) => {
      record.state = state;
      record.info = frame;
      sync(state, frame);
    };
    view.render = (pose: any) => {
      const state = record.state;
      const { x, z } = state.canoe.position;
      const last = record.last;
      if (last) {
        record.rows.push([
          state.tick - last.tick,
          Math.hypot(x - last.x, z - last.z),
          Math.hypot(pose.target.x - last.tx, pose.target.y - last.ty, pose.target.z - last.tz),
          record.info.dueSeconds ?? -1,
          record.info.frameSeconds,
        ]);
      }
      record.last = { tick: state.tick, x, z, tx: pose.target.x, ty: pose.target.y, tz: pose.target.z };
      render(pose);
    };
  });
  await page.waitForTimeout(seconds * 1000);
  return page.evaluate(() => {
    const scope = window as unknown as { portage: { loop: any }; pacing: { rows: number[][]; since: number; sinceReal: number; clock: () => number } };
    const { rows, since, sinceReal, clock } = scope.pacing;
    const elapsed = (clock() - since) / 1000;
    let offBeat = 0;
    let wrongSteps = 0;
    const steps: Record<string, number> = {};
    const frameMilliseconds: Record<string, number> = {};
    const due = new Set<number>();
    let apart = 0;
    let together = 0;
    for (const [count, canoe, camera, dueSeconds, frameSeconds] of rows as [number, number, number, number, number][]) {
      const sixtieths = frameSeconds * 60;
      if (Math.abs(sixtieths - Math.round(sixtieths)) > 1e-6) offBeat += 1;
      if (count !== Math.round(sixtieths)) wrongSteps += 1;
      steps[count] = (steps[count] ?? 0) + 1 / rows.length;
      const key = (Math.round(frameSeconds * 10000) / 10).toFixed(1);
      frameMilliseconds[key] = (frameMilliseconds[key] ?? 0) + 1;
      due.add(Math.round(dueSeconds * 10000) / 10);
      const canoeMoved = canoe > 1e-9;
      const cameraMoved = camera > 1e-9;
      if (canoeMoved !== cameraMoved) apart += 1;
      else if (canoeMoved) together += 1;
    }
    return {
      drawn: rows.length / elapsed, steps, apart, together, due: [...due], frameMilliseconds,
      offBeat, wrongSteps, realDrawn: rows.length / ((performance.now() - sinceReal) / 1000),
      screenMilliseconds: scope.portage.loop.screenMilliseconds ?? 0, frames: rows.length,
    };
  });
}

const tell = (rate: number | string, cap: number, pacing: Pacing): void => {
  const steps = Object.entries(pacing.steps).map(([count, share]) => `${count}: ${Math.round(share * 100)}%`).join(', ');
  console.log(`pacing ${rate} Hz, cap ${cap === 0 ? 'off' : cap}: drawn ${pacing.drawn.toFixed(1)} a second, rules steps per drawn frame {${steps}}, `
    + `one moved without the other in ${pacing.apart} of ${pacing.frames} frames, due ${pacing.due.join('/')} ms, screen read as ${pacing.screenMilliseconds.toFixed(2)} ms`);
};

for (const rate of [30, 60, 75, 90, 144]) {
  const expected = Math.min(60, rate);
  test(`a made-up ${rate} Hz screen on the default cap draws ${expected} even frames a second`, async ({ page }) => {
    await openAfloat(page, rate);
    const pacing = await watch(page, 6);
    tell(rate, 60, pacing);
    // Never fewer frames than the lower of 60 and the screen's rate, and no more.
    expect(pacing.drawn).toBeGreaterThan(expected * 0.97);
    expect(pacing.drawn).toBeLessThan(expected * 1.03);
    // The same number of rules steps in every drawn frame; the canoe and the camera move in every one, together.
    expect(pacing.steps[60 / expected]).toBeCloseTo(1, 9);
    expect(pacing.apart).toBe(0);
    expect(pacing.together).toBe(pacing.frames);
    // The look is told the gap the frame was meant to have, and each frame stands for exactly that.
    expect(pacing.due).toEqual([Math.round(10000 / expected) / 10]);
    expect(Object.keys(pacing.frameMilliseconds)).toEqual([(Math.round(10000 / expected) / 10).toFixed(1)]);
    expect(Math.abs(pacing.screenMilliseconds - 1000 / rate)).toBeLessThan(0.05);
  });
}

test('the browser\'s own 60 Hz display: every frame is whole sixtieths with as many rules steps, and one each when the machine keeps up', async ({ page }) => {
  await openAfloat(page, 0);
  const pacing = await watch(page, 8);
  tell('real 60', 60, pacing);
  // Exact, however busy the machine: the screen is read as 60 Hz, every frame is told one sixtieth, stands for
  // whole sixtieths and carries exactly that many rules steps, none is empty, and the canoe and the camera move together.
  expect(Math.abs(pacing.screenMilliseconds - 1000 / 60)).toBeLessThan(0.5);
  expect(pacing.due).toEqual([16.7]);
  expect(pacing.offBeat).toBe(0);
  expect(pacing.wrongSteps).toBe(0);
  expect(pacing.steps[0] ?? 0).toBe(0);
  expect(pacing.apart).toBe(0);
  expect(pacing.frames).toBeGreaterThan(120);
  // The machine is shared. A real frame that runs long rightly carries more than one step, so "one step in
  // every frame" can only be judged when the machine kept up. The made-up 60 Hz screen above judges it always.
  const keptUp = pacing.realDrawn > 57;
  console.log(`  the machine ${keptUp ? 'kept up' : 'did NOT keep up, so the one-step count is not judged here'}: ${pacing.realDrawn.toFixed(1)} frames a second by the real clock`);
  if (keptUp) expect(pacing.steps[1]).toBeGreaterThan(0.98);
});

test('with the cap off on a made-up 144 Hz screen, a frame with no rules step moves neither the canoe nor the camera', async ({ page }) => {
  await openAfloat(page, 144, 0);
  const pacing = await watch(page, 5);
  tell(144, 0, pacing);
  expect(pacing.drawn).toBeGreaterThan(144 * 0.97);
  expect(pacing.drawn).toBeLessThan(144 * 1.03);
  // 60 rules steps among 144 frames: more than half the frames carry none, and those must not move.
  expect(pacing.steps[0]).toBeGreaterThan(0.55);
  expect(pacing.steps[1]).toBeGreaterThan(0.39);
  expect(pacing.apart).toBe(0);
  expect(pacing.due).toEqual([6.9]);
});

test('the sound engine starts on the first click in the lobby, so the first key press in play costs no long frame', async ({ page }) => {
  // Note when the sound engine is built, and every gap between display frames.
  await page.addInitScript(() => {
    const scope = window as unknown as { soundBuiltAt: number | null; gaps: [number, number][]; AudioContext: typeof AudioContext };
    scope.soundBuiltAt = null;
    scope.gaps = [];
    const Real = scope.AudioContext;
    scope.AudioContext = class extends Real {
      constructor(options?: AudioContextOptions) {
        super(options);
        scope.soundBuiltAt ??= performance.now();
      }
    };
    let last = 0;
    const tick = (now: number): void => {
      if (last > 0) scope.gaps.push([now, now - last]);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto(`${BASE}/`);
  await page.waitForFunction(() => (window as unknown as { portage?: unknown }).portage !== undefined);
  await page.waitForTimeout(1500);
  const built = (): Promise<number | null> => page.evaluate(() => (window as unknown as { soundBuiltAt: number | null }).soundBuiltAt);
  expect(await built()).toBeNull();

  // The first click anywhere, on a lobby button, starts it.
  await page.getByRole('button', { name: 'New Game' }).click();
  expect(await built()).not.toBeNull();
  await page.getByRole('button', { name: 'New game here' }).first().click();
  // The pick screen: start as whoever is marked.
  await page.locator('.iw-panel-character_select .cs-start').click();
  await page.waitForFunction(() => (window as unknown as { portage: { session: { screen: string } } }).portage.session.screen === 'game');
  const inPlayAt = await page.evaluate(() => performance.now());
  expect(await built()).toBeLessThan(inPlayAt);

  // Play settles, then the first key press of the game.
  await page.waitForTimeout(4000);
  const pressedAt = await page.evaluate(() => performance.now());
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyW');
  const longest = await page.evaluate((from) => {
    const gaps = (window as unknown as { gaps: [number, number][] }).gaps;
    return Math.max(...gaps.filter(([at]) => at >= from - 50 && at <= from + 1000).map(([, gap]) => gap));
  }, pressedAt);
  const lobbyClick = await page.evaluate((until) => {
    const gaps = (window as unknown as { gaps: [number, number][] }).gaps;
    return Math.max(...gaps.filter(([at]) => at <= until).map(([, gap]) => gap));
  }, inPlayAt);
  // What the machine does by itself: the longest frame in the two seconds before the press.
  const idle = await page.evaluate((from) => {
    const gaps = (window as unknown as { gaps: [number, number][] }).gaps;
    return Math.max(...gaps.filter(([at]) => at >= from - 2000 && at < from - 50).map(([, gap]) => gap));
  }, pressedAt);
  console.log(`first key press in play: longest frame ${longest.toFixed(1)} ms (the two seconds before it: ${idle.toFixed(1)} ms; before play, lobby clicks included: ${lobbyClick.toFixed(1)} ms)`);
  // Where the engine started is the check above, and it is exact. This is the backstop: starting the engine on the
  // key press cost 370 to 670 ms in a fresh browser. A shared machine alone makes long frames, so the bar moves with it.
  expect(longest).toBeLessThan(Math.max(250, idle * 2));
});
