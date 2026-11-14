/**
 * Three of Luc's list in the running game, with real keys, headless: a tree stops you (line 1), Q paddles on its
 * own (line 14), and F at the stump bench opens the crafting panel (line 21). Each leaves pictures for the report.
 *
 * Run: PORTAGE_URL=http://localhost:5223 RULES_SHOTS=<folder> npm --prefix <worktree>/e2e test -- rules.spec.ts
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const BASE = process.env.PORTAGE_URL ?? 'http://localhost:5220';
const SHOTS = process.env.RULES_SHOTS ?? 'test-results/rules';

test.use({
  viewport: { width: 1280, height: 720 },
  launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
});
test.setTimeout(120_000);

async function open(page: Page, query: string): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  await page.goto(`${BASE}/${query}`);
  await page.waitForFunction(() => (window as unknown as { portage?: unknown }).portage !== undefined);
  await page.waitForTimeout(500);
  return problems;
}

interface Seen {
  mode: string;
  x: number;
  z: number;
  speed: number;
  canoeX: number;
  canoeZ: number;
  panels: string[];
  paddle: number;
}

async function read(page: Page): Promise<Seen> {
  return page.evaluate(() => {
    const { session } = (window as unknown as { portage: { session: any } }).portage;
    const player = session.game.players[0];
    return {
      mode: player.mode, x: player.position.x, z: player.position.z, speed: session.game.canoe.speed,
      canoeX: session.game.canoe.position.x, canoeZ: session.game.canoe.position.z, panels: [...session.panels.stack],
      paddle: session.lastInput.paddle,
    };
  });
}

/** Stand the player on Home Knoll at a point, facing a bearing, with the camera behind them. */
async function standAt(page: Page, x: number, z: number, bearing: number): Promise<void> {
  await page.evaluate(([standX, standZ, facing]) => {
    const { app, session } = (window as unknown as { portage: { app: any; session: any } }).portage;
    const player = session.game.players[0];
    Object.assign(player, { mode: 'foot', seat: null, islandId: 'home_knoll', heading: facing });
    player.position.x = standX;
    player.position.z = standZ;
    app.camera.yaw = facing;
  }, [x, z, bearing] as const);
  await page.waitForTimeout(400);
}

test('line 1: walking into a tree stops you at its trunk, and you slide off it', async ({ page }) => {
  const problems = await open(page, '?shot=island&live=1');
  // A lone spruce on Home Knoll (trunk and low boughs 0.64 m round), from three and a half metres west of it.
  const tree = { x: 3.03, z: 1143.56, radius: 0.64 };
  await standAt(page, tree.x - 3.5, tree.z, Math.PI / 2);
  await page.screenshot({ path: `${SHOTS}/fix1-1-before.png` });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  const against = await read(page);
  await page.screenshot({ path: `${SHOTS}/fix1-2-against-the-trunk.png` });
  await page.keyboard.up('KeyW');
  // Stopped at the trunk, never in it.
  expect(Math.hypot(against.x - tree.x, against.z - tree.z)).toBeGreaterThanOrEqual(tree.radius + 0.3 - 1e-6);
  expect(against.x).toBeLessThan(tree.x);
  expect(against.x).toBeGreaterThan(tree.x - 3.5 + 1.5);
  // A step to the side and on: it slides round the trunk and past.
  await standAt(page, tree.x - 3.5, tree.z + 0.3, Math.PI / 2);
  await page.keyboard.down('KeyW');
  // Long enough for the camera behind the walker to clear the boughs too.
  await page.waitForTimeout(4500);
  await page.keyboard.up('KeyW');
  const past = await read(page);
  await page.screenshot({ path: `${SHOTS}/fix1-3-slid-past.png` });
  expect(past.x).toBeGreaterThan(tree.x + 1);
  expect(problems).toEqual([]);
});

test('line 14: Q paddles on its own, and Q, W or S stops it', async ({ page }) => {
  const problems = await open(page, '?at=quest1');
  const start = await read(page);
  expect(start.mode).toBe('canoe');
  // The note is a toast, and the paddle stroke is what the keys send this frame.
  await page.keyboard.press('KeyQ');
  await expect(page.locator('.iw-toasts')).toContainText('Paddling on. Q, W or S to stop.');
  await page.waitForTimeout(2500);
  const going = await read(page);
  await page.screenshot({ path: `${SHOTS}/fix14-1-paddling-on.png` });
  expect(going.paddle).toBe(1);
  expect(going.speed).toBeGreaterThan(1);
  expect(Math.hypot(going.canoeX - start.canoeX, going.canoeZ - start.canoeZ)).toBeGreaterThan(2);
  await page.keyboard.press('KeyQ');
  await expect(page.locator('.iw-toasts')).toContainText('Paddling off.');
  await expect.poll(async () => (await read(page)).paddle).toBe(0);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SHOTS}/fix14-2-paddling-off.png` });
  expect((await read(page)).speed).toBeLessThan(going.speed);
  // On again: S stops it, and so does W.
  await page.keyboard.press('KeyQ');
  await expect.poll(async () => (await read(page)).paddle).toBe(1);
  await page.keyboard.press('KeyS');
  await expect.poll(async () => (await read(page)).paddle).toBe(0);
  await page.keyboard.press('KeyQ');
  await expect.poll(async () => (await read(page)).paddle).toBe(1);
  await page.keyboard.press('KeyW');
  await expect.poll(async () => (await read(page)).paddle).toBe(0);
  expect(problems).toEqual([]);
});

test('line 21: F at the stump bench says "Use the bench" and opens the stump bench\'s own menu', async ({ page }) => {
  const problems = await open(page, '?shot=island&live=1');
  // Just south of Home Knoll's stump bench, facing it.
  await standAt(page, 11.6, 1131.1, 0);
  await expect(page.locator('.iw-prompt')).toContainText('Use the bench');
  await expect(page.locator('.iw-prompt .iw-key')).toHaveText('F');
  await page.screenshot({ path: `${SHOTS}/fix21-1-prompt.png` });
  await page.keyboard.press('KeyF');
  await expect.poll(async () => (await read(page)).panels).toContain('crafting');
  // Round 4: the crafting key lists hand crafts only, so the bench's key opens the bench's menu, not the hands'.
  await expect(page.locator('.iw-panel-crafting h2')).toHaveText('Stump bench');
  await expect(page.locator('.iw-panel-crafting .iw-craft-door.iw-on')).toHaveText('Stump bench');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/fix21-2-crafting-open.png` });
  expect(problems).toEqual([]);
});
