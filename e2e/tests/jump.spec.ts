/**
 * The jump in the running game with the real Space key, headless (Luc's list, Round 3: "character need to jump").
 * The frame loop is stopped and frames of 1/60 s are stepped by hand, as in `walking.spec.ts`, so the numbers are the
 * same on any machine however fast it draws.
 *
 * Run: PORTAGE_URL=http://localhost:5234 npm --prefix <worktree>/e2e test -- jump.spec.ts
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const BASE = process.env.PORTAGE_URL ?? 'http://localhost:5220';

test.use({
  viewport: { width: 960, height: 540 },
  launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
});
test.setTimeout(120_000);

interface Seen {
  x: number;
  y: number;
  z: number;
  /** Metres the figure is drawn above the ground. */
  lift: number;
  /** The jump as the rules have it, or null. */
  leap: { steps: number; held: boolean; again: boolean } | null;
  /** The camera's pose as the look was handed it, as text: equal text, the same picture. */
  pose: string;
  panels: string;
  scrolled: number;
}

async function open(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (message) => {
    if ((message.type() === 'error' || message.type() === 'warning') && !message.text().includes('GL Driver')) problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  await page.goto(`${BASE}/?shot=island&live=1`);
  await page.waitForFunction(() => (window as unknown as { portage?: unknown }).portage !== undefined);
  await page.waitForTimeout(1500);
  await page.evaluate(() => (window as unknown as { portage: { loop: { stop(): void } } }).portage.loop.stop());
  await frames(page, 30);
  return problems;
}

async function frames(page: Page, count: number): Promise<void> {
  await page.evaluate((count) => {
    const { app } = (window as unknown as { portage: { app: { frame(seconds: number, due: number): void } } }).portage;
    for (let index = 0; index < count; index += 1) app.frame(1 / 60, 1 / 60);
  }, count);
}

async function read(page: Page): Promise<Seen> {
  return page.evaluate(() => {
    const { app, session, worldView } = (window as unknown as { portage: { app: any; session: any; worldView: any } }).portage;
    const player = session.game.players[0];
    return {
      x: player.position.x, y: player.position.y, z: player.position.z,
      lift: worldView.canoe.figures().find((figure: { id: number }) => figure.id === 0)?.lift ?? -1,
      leap: player.leap ?? null,
      pose: JSON.stringify(app.lastPose),
      panels: session.panels.stack.join(','),
      scrolled: window.scrollY + document.documentElement.scrollTop,
    };
  });
}

test('Space jumps: off the ground on the next frame, 0.9 m at the top, down after half a second, and the camera does not move', async ({ page }) => {
  const problems = await open(page);
  const start = await read(page);
  expect(start.lift).toBe(0);
  expect(start.leap).toBeNull();
  await page.keyboard.down('Space');
  await frames(page, 1);
  const first = await read(page);
  expect(first.lift).toBeGreaterThan(0.1);
  let top = 0;
  let inAir = 1;
  for (let count = 0; count < 59; count += 1) {
    await frames(page, 1);
    const now = await read(page);
    top = Math.max(top, now.lift);
    if (now.lift > 0) inAir += 1;
    // A standing jump: the figure goes up and down and nowhere else, the state keeps the ground's height, and the
    // camera is handed the very same pose on every frame.
    expect(now.x).toBe(start.x);
    expect(now.z).toBe(start.z);
    expect(now.y).toBe(start.y);
    expect(now.pose).toBe(start.pose);
  }
  expect(top).toBeCloseTo(0.9, 6);
  expect(inAir).toBe(29);
  // The key is still down: one jump, no second one.
  const held = await read(page);
  expect(held.lift).toBe(0);
  await page.keyboard.up('Space');
  await frames(page, 2);
  const after = await read(page);
  expect(after.leap).toBeNull();
  // Space did nothing else: no panel opened, the page did not scroll.
  expect(after.panels).toBe(start.panels);
  expect(after.scrolled).toBe(0);
  expect(problems).toEqual([]);
});

test('no jump with a panel open, and none from a Space still down when it closes', async ({ page }) => {
  const problems = await open(page);
  await page.keyboard.press('KeyM');
  await frames(page, 3);
  expect((await read(page)).panels).toContain('map');
  await page.keyboard.down('Space');
  await frames(page, 20);
  expect((await read(page)).leap).toBeNull();
  // Close the map, Space still down: the game runs again, and still nobody jumps.
  if ((await read(page)).panels.includes('map')) await page.keyboard.press('KeyM');
  await frames(page, 20);
  const closed = await read(page);
  expect(closed.panels).not.toContain('map');
  expect(closed.leap).toBeNull();
  expect(closed.lift).toBe(0);
  await page.keyboard.up('Space');
  // A fresh press jumps.
  await page.keyboard.down('Space');
  await frames(page, 2);
  expect((await read(page)).lift).toBeGreaterThan(0.1);
  await page.keyboard.up('Space');
  expect(problems).toEqual([]);
});

test('a walking jump carries the walk: 1.3 m over the ground in the air, the camera following the ground alone', async ({ page }) => {
  const problems = await open(page);
  await page.evaluate(() => {
    const { app, session } = (window as unknown as { portage: { app: any; session: any } }).portage;
    app.camera.setOrbit({ yaw: 0 });
    session.game.players[0].heading = 0;
  });
  // D walks east of a camera that looks north: the stretch `walking.spec.ts` walks.
  await page.keyboard.down('KeyD');
  await frames(page, 40);
  const from = await read(page);
  await page.keyboard.down('Space');
  await frames(page, 3);
  await page.keyboard.up('Space');
  let top = 0;
  for (let count = 3; count < 30; count += 1) {
    await frames(page, 1);
    const now = await read(page);
    top = Math.max(top, now.lift);
    // The camera's look-at point is on the ground under the figure, 1.5 m up: it has none of the jump in it.
    const pose = JSON.parse(now.pose) as { target: { y: number } };
    expect(pose.target.y).toBeCloseTo(now.y + 1.5, 9);
  }
  const landed = await read(page);
  await page.keyboard.up('KeyD');
  expect(top).toBeCloseTo(0.9, 6);
  expect(landed.lift).toBe(0);
  // Half a second at a walk: 1.3 m over the ground, less only if the ground itself turned the walker aside.
  expect(Math.hypot(landed.x - from.x, landed.z - from.z)).toBeGreaterThan(1.2);
  expect(Math.hypot(landed.x - from.x, landed.z - from.z)).toBeLessThan(1.31);
  expect(problems).toEqual([]);
});

/**
 * The same jump with the game's own loop running: nothing stopped, no frame stepped by hand (the master review of
 * round 3, finding 9). The numbers above are exact because the frames are counted. Here the clock is the real one,
 * so this one checks what a player sees: Space lifts the figure, it comes down by itself in about half a second,
 * a key held does not jump twice, and a second press jumps again.
 */
test('with the game\'s own loop running: Space lifts the figure off the ground and it lands again, once a press', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if ((message.type() === 'error' || message.type() === 'warning') && !message.text().includes('GL Driver')) problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  await page.goto(`${BASE}/?shot=island&live=1`);
  await page.waitForFunction(() => (window as unknown as { portage?: { session?: { game?: unknown } } }).portage?.session?.game !== undefined);
  await page.waitForTimeout(1500);
  // The loop is the game's own: its steps go by with nobody calling `app.frame`.
  const tickBefore = await page.evaluate(() => (window as unknown as { portage: { session: { game: { tick: number } } } }).portage.session.game.tick);
  await page.waitForFunction((before) => (window as unknown as { portage: { session: { game: { tick: number } } } }).portage.session.game.tick > before + 20, tickBefore);

  /** Watch the figure on every display frame for a while: when it left the ground, how high it got, when it was down again. */
  const watch = (milliseconds: number) => page.evaluate((span) => new Promise<{ top: number; up: number | null; down: number | null; jumps: number; frames: number; steps: number }>((resolve) => {
    const { session, worldView } = (window as unknown as { portage: { session: any; worldView: any } }).portage;
    const lift = (): number => worldView.canoe.figures().find((figure: { id: number }) => figure.id === 0)?.lift ?? -1;
    const began = performance.now();
    const firstTick = session.game.tick;
    const seen = { top: 0, up: null as number | null, down: null as number | null, jumps: 0, frames: 0, steps: 0 };
    let inAir = false;
    const look = (): void => {
      const now = performance.now() - began;
      const height = lift();
      seen.frames += 1;
      seen.top = Math.max(seen.top, height);
      if (height > 0 && !inAir) {
        inAir = true;
        seen.jumps += 1;
        seen.up ??= now;
      } else if (height === 0 && inAir) {
        inAir = false;
        seen.down ??= now;
      }
      if (now < span) requestAnimationFrame(look);
      else resolve({ ...seen, steps: session.game.tick - firstTick });
    };
    requestAnimationFrame(look);
  }), milliseconds);

  const state = () => page.evaluate(() => {
    const { session } = (window as unknown as { portage: { session: any } }).portage;
    return { leap: session.game.players[0].leap ?? null, panels: session.panels.stack.join(','), mode: session.game.players[0].mode as string };
  });
  expect(await state()).toEqual({ leap: null, panels: '', mode: 'foot' });

  // Space goes down and stays down for a second and a half: one jump, up and down again, and no second one.
  const watching = watch(1500);
  await page.keyboard.down('Space');
  const held = await watching;
  await page.keyboard.up('Space');
  expect(held.steps, 'the game stepped by itself while it was watched').toBeGreaterThan(30);
  expect(held.up, 'the figure left the ground').not.toBeNull();
  expect(held.up!).toBeLessThan(500);
  // The rules' jump is 0.9 m at the top. A display frame may fall either side of the very top.
  expect(held.top).toBeGreaterThan(0.7);
  expect(held.top).toBeLessThanOrEqual(0.9 + 1e-6);
  expect(held.down, 'and came down by itself').not.toBeNull();
  // In the air about half a second (29 steps of 1/60 s), by the real clock: between a quarter and a whole second.
  expect(held.down! - held.up!).toBeGreaterThan(250);
  expect(held.down! - held.up!).toBeLessThan(1000);
  expect(held.jumps).toBe(1);

  // Let go, press again: a second jump.
  await page.waitForTimeout(200);
  const again = watch(1200);
  await page.keyboard.down('Space');
  await page.waitForTimeout(80);
  await page.keyboard.up('Space');
  const second = await again;
  expect(second.jumps).toBe(1);
  expect(second.top).toBeGreaterThan(0.7);
  expect(second.down).not.toBeNull();
  // Space did nothing else, and the figure is on the ground with no jump left in the rules.
  await page.waitForTimeout(300);
  expect(await state()).toEqual({ leap: null, panels: '', mode: 'foot' });
  expect(await page.evaluate(() => window.scrollY + document.documentElement.scrollTop)).toBe(0);
  expect(problems).toEqual([]);
});
