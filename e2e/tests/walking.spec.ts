/**
 * How walking feels, in the running game with real keys, headless (Luc's list, line 11: "the character movement on
 * land needs complete rework"). The frame loop is stopped and frames of 1/60 s are stepped by hand, so the numbers
 * are the same on any machine however fast it draws.
 *
 * Run: PORTAGE_URL=http://localhost:5223 npm --prefix <worktree>/e2e test -- walking.spec.ts
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const BASE = process.env.PORTAGE_URL ?? 'http://localhost:5220';
const WALK_STEP = 2.6 / 60;

test.use({
  viewport: { width: 960, height: 540 },
  launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
});
test.setTimeout(120_000);

interface Seen {
  x: number;
  z: number;
  heading: number;
  yaw: number;
  /** The camera's pose as the look was handed it, as text: equal text, the same picture. */
  pose: string;
}

/** Ashore on Home Knoll, the frame loop taken away from the browser: from here a frame happens only when asked for. */
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
    const { app, session } = (window as unknown as { portage: { app: any; session: any } }).portage;
    const player = session.game.players[0];
    return { x: player.position.x, z: player.position.z, heading: player.heading, yaw: app.camera.yaw, pose: JSON.stringify(app.lastPose) };
  });
}

/** The camera looks north, as the mouse would put it, and the figure faces north too. */
async function faceNorth(page: Page): Promise<void> {
  await page.evaluate(() => {
    const { app, session } = (window as unknown as { portage: { app: any; session: any } }).portage;
    app.camera.setOrbit({ yaw: 0 });
    session.game.players[0].heading = 0;
  });
  await frames(page, 2);
}

const gap = (first: Seen, second: Seen): number => Math.hypot(second.x - first.x, second.z - first.z);

test('W eases in and out: a little on the first frame, a full walk after 0.15 s, standing still within 0.1 s of letting go', async ({ page }) => {
  const problems = await open(page);
  await faceNorth(page);
  const start = await read(page);
  await page.keyboard.down('KeyW');
  await frames(page, 1);
  const first = await read(page);
  expect(gap(start, first)).toBeGreaterThan(0);
  expect(gap(start, first)).toBeLessThan(WALK_STEP * 0.2);
  await frames(page, 9);
  const going = await read(page);
  await frames(page, 1);
  expect(gap(going, await read(page))).toBeCloseTo(WALK_STEP, 6);
  await page.keyboard.up('KeyW');
  await frames(page, 6);
  const stopped = await read(page);
  expect(gap(going, stopped)).toBeGreaterThan(WALK_STEP);
  // Stood still: the figure and the camera do not move again, frame after frame.
  for (let count = 0; count < 18; count += 1) {
    await frames(page, 1);
    const now = await read(page);
    expect(gap(stopped, now)).toBe(0);
    expect(now.pose).toBe(stopped.pose);
  }
  expect(problems).toEqual([]);
});

test('holding D walks to the right of the camera: the camera does not turn by itself, however long', async ({ page }) => {
  const problems = await open(page);
  await faceNorth(page);
  const start = await read(page);
  await page.keyboard.down('KeyD');
  // Longer than the old swing-back delay (1.2 s), which turned the camera and with it the way D walks.
  await frames(page, 150);
  const held = await read(page);
  await page.keyboard.up('KeyD');
  expect(held.yaw).toBe(start.yaw);
  // Facing east the whole way: the way D means while the camera looks north.
  expect(held.heading).toBeCloseTo(Math.PI / 2, 9);
  expect(held.x - start.x).toBeGreaterThan(3);
  expect(problems).toEqual([]);
});

test('standing still ashore, nothing moves: the camera and the figure are the same two frames 0.3 s apart', async ({ page }) => {
  const problems = await open(page);
  await frames(page, 60);
  const first = await read(page);
  await frames(page, 18);
  const second = await read(page);
  expect(second).toEqual(first);
  expect(problems).toEqual([]);
});
