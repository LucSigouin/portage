/**
 * Real key presses and mouse input against the running game, headless.
 * Proves the DOM glue, the input layer, the session and the rules engine
 * are wired end to end. Needs the dev server on http://localhost:5220.
 *
 * Run: npm --prefix /Users/ls/Claude-Workspace/personal/portage/e2e test
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

interface Snapshot {
  screen: string;
  mode: string;
  x: number;
  z: number;
  playerX: number;
  playerZ: number;
  heading: number;
  speed: number;
  waterLevel: number;
  beached: boolean;
  panels: string[];
  paused: boolean;
  paddle: number;
  cameraYaw: number;
  cameraDistance: number;
  paddleKeys: string[];
}

/** Read the game through the handle `main.ts` leaves on the window. */
async function read(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const { app, session } = (window as unknown as { portage: { app: any; session: any } }).portage;
    const game = session.game;
    return {
      screen: session.screen,
      mode: game ? game.players[0].mode : 'none',
      x: game ? game.canoe.position.x : 0,
      z: game ? game.canoe.position.z : 0,
      playerX: game ? game.players[0].position.x : 0,
      playerZ: game ? game.players[0].position.z : 0,
      heading: game ? game.canoe.heading : 0,
      speed: game ? game.canoe.speed : 0,
      waterLevel: game ? game.canoe.waterLevel : 0,
      beached: game ? game.canoe.beached : false,
      panels: [...session.panels.stack],
      paused: session.paused,
      paddle: session.lastInput.paddle,
      cameraYaw: app.camera.yaw,
      cameraDistance: app.camera.distance,
      paddleKeys: [...session.settings.controls.keyBindings.paddle],
    };
  });
}

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

async function hold(page: Page, code: string, milliseconds: number): Promise<void> {
  await page.keyboard.down(code);
  await page.waitForTimeout(milliseconds);
  await page.keyboard.up(code);
}

/** Smallest signed turn from one bearing to another: headings wrap at +-PI. */
function turn(from: number, to: number): number {
  let difference = (to - from) % (2 * Math.PI);
  if (difference > Math.PI) difference -= 2 * Math.PI;
  if (difference <= -Math.PI) difference += 2 * Math.PI;
  return difference;
}

async function tap(page: Page, code: string): Promise<void> {
  await page.keyboard.press(code);
  await page.waitForTimeout(150);
}

test('W paddles, D steers to starboard, R bails', async ({ page }) => {
  const problems = await open(page, '?at=quest1');
  const start = await read(page);
  expect(start).toMatchObject({ screen: 'game', mode: 'canoe', beached: false });
  expect(start.waterLevel).toBeGreaterThan(55);

  await hold(page, 'KeyW', 2500);
  const paddled = await read(page);
  expect(Math.hypot(paddled.x - start.x, paddled.z - start.z)).toBeGreaterThan(2);
  expect(Math.abs(turn(start.heading, paddled.heading))).toBeLessThan(0.05);

  await page.keyboard.down('KeyW');
  await hold(page, 'KeyD', 1500);
  const turned = await read(page);
  expect(turned.paddle).toBe(1);
  expect(turned.speed).toBeGreaterThan(1);
  expect(turn(paddled.heading, turned.heading)).toBeGreaterThan(0.3); // clockwise: to starboard
  await page.keyboard.up('KeyW');

  // The arrow keys are the second binding.
  await hold(page, 'ArrowLeft', 1000);
  expect(turn(turned.heading, (await read(page)).heading)).toBeLessThan(-0.1); // back to port

  const before = (await read(page)).waterLevel;
  await hold(page, 'KeyR', 3000);
  const bailed = await read(page);
  expect(bailed.waterLevel).toBeLessThan(before - 4);
  expect(problems).toEqual([]);
});

test('F lands at the beach, WASD walks, F boards again', async ({ page }) => {
  await open(page, '?at=quest1&speed=4');
  // Straight ahead is Home Knoll's beach, about 60 m off. At 4x that is a few seconds of paddling.
  await page.keyboard.down('KeyW');
  await expect.poll(async () => (await read(page)).beached, { timeout: 30_000 }).toBe(true);
  await page.keyboard.up('KeyW');
  await expect(page.locator('.iw-prompt')).toContainText('Land');
  await expect(page.locator('.iw-prompt .iw-key')).toHaveText('F'); // the prompt names the bound key

  await tap(page, 'KeyE'); // the old key does nothing now
  expect((await read(page)).mode).toBe('canoe');
  await tap(page, 'KeyF');
  const ashore = await read(page);
  expect(ashore.mode).toBe('foot');
  await expect(page.locator('.iw-toasts')).toContainText('Ashore on Home Knoll');

  await hold(page, 'KeyW', 800);
  const walked = await read(page);
  expect(Math.hypot(walked.playerX - ashore.playerX, walked.playerZ - ashore.playerZ)).toBeGreaterThan(3);
  expect(walked.x).toBeCloseTo(ashore.x, 3); // the canoe stayed on the beach

  // Walk back to the hull and board.
  await hold(page, 'KeyS', 800);
  await expect(page.locator('.iw-prompt')).toContainText('Board the canoe');
  await tap(page, 'KeyF');
  expect((await read(page)).mode).toBe('canoe');
});

test('one press of F scavenges a node: no holding, and holding does not repeat it', async ({ page }) => {
  await open(page, '?shot=island&live=1');
  // Stand the player at a driftwood pile on the island they are on.
  const nodeName = await page.evaluate(async () => {
    const { session } = (window as unknown as { portage: { session: any } }).portage;
    const data = await import('/src/data/index.ts');
    const sim = await import('/src/sim/index.ts');
    const game = session.game;
    const player = game.players[0];
    for (const entry of data.NODES_BY_ISLAND[player.islandId]) {
      if (entry.reach !== 'foot') continue;
      const x = entry.position.x + 0.5;
      player.position = { x, y: sim.terrainHeight(x, entry.position.z), z: entry.position.z };
      const target = sim.selectInteractable(game);
      if (target?.kind === 'node' && target.available) return target.name as string;
    }
    throw new Error('no node on this island can be scavenged bare-handed');
  });
  const harvested = async (): Promise<number> => page.evaluate(() =>
    (window as unknown as { portage: { session: any } }).portage.session.game.statistics.nodesHarvested);
  const before = await harvested();
  await expect(page.locator('.iw-prompt')).toContainText(nodeName);
  await expect(page.locator('.iw-prompt .iw-key')).toHaveText('F');
  await expect(page.locator('.iw-prompt')).not.toContainText(/hold/i);

  // Down and held for a second: it scavenges once, on the press.
  await page.keyboard.down('KeyF');
  await expect.poll(harvested, { timeout: 2000 }).toBe(before + 1);
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyF');
  expect(await harvested()).toBeLessThanOrEqual(before + 1);
  await expect(page.locator('.iw-toasts')).toContainText('+');
});

test('with a crew of three, the keys drive the local player and the others ride along', async ({ page }) => {
  const problems = await open(page, '?crew=3');
  const crew = async (): Promise<{ modes: string[]; seats: (number | null)[]; x: number[] }> => page.evaluate(() => {
    const game = (window as unknown as { portage: { session: any } }).portage.session.game;
    return {
      modes: game.players.map((player: any) => player.mode),
      seats: game.players.map((player: any) => player.seat),
      x: game.players.map((player: any) => player.position.x),
    };
  });
  expect(await crew()).toMatchObject({ modes: ['canoe', 'canoe', 'canoe'], seats: [0, 1, 2] });
  await hold(page, 'KeyW', 2000);
  const moved = await read(page);
  expect(moved.speed).toBeGreaterThan(0.5);
  // Everyone aboard rides along with the canoe.
  const riding = await crew();
  expect(riding.x[1]).toBeCloseTo(riding.x[0], 3);
  expect(riding.x[2]).toBeCloseTo(riding.x[0], 3);
  expect(problems).toEqual([]);
});

test('every panel key opens its panel and pauses; Esc closes, then pauses', async ({ page }) => {
  await open(page, '?at=quest1');
  for (const [code, panel] of [['Tab', 'inventory'], ['KeyC', 'crafting'], ['KeyJ', 'quest_log'], ['KeyM', 'map']] as const) {
    await tap(page, code);
    expect(await read(page)).toMatchObject({ panels: [panel], paused: true });
    await expect(page.locator(`.iw-panel-${panel}`)).toBeVisible();
    await tap(page, code); // the same key closes it
    expect((await read(page)).panels).toEqual([]);
  }

  // One panel replaces another.
  await tap(page, 'Tab');
  await tap(page, 'KeyM');
  expect((await read(page)).panels).toEqual(['map']);
  await tap(page, 'Escape');
  expect(await read(page)).toMatchObject({ panels: [], paused: false });

  // The boat's menu opens afloat too (its stations work on the water). The builder in it says the canoe must be beached.
  await tap(page, 'KeyB');
  expect((await read(page)).panels).toEqual(['canoe_builder']);
  await expect(page.locator('.iw-panel-canoe_builder .iw-blocked')).toContainText('Beach the canoe to work on it.');
  await tap(page, 'KeyB');
  expect(await read(page)).toMatchObject({ panels: [], paused: false });

  // Esc with nothing open is the pause menu; the game stops while it is up.
  await tap(page, 'Escape');
  expect(await read(page)).toMatchObject({ panels: ['pause'], paused: true });
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  // Under the pause menu the panel keys are dead: nothing opens, and nothing is said or sounded about it.
  await page.evaluate(() => {
    const scope = window as unknown as { portage: { session: any }; heard: string[] };
    scope.heard = [];
    scope.portage.session.subscribe((signal: any) => {
      if (signal.type === 'notice') scope.heard.push(`notice: ${signal.text}`);
      if (signal.type === 'interface_sound') scope.heard.push(`sound: ${signal.sound}`);
    });
  });
  const toastsBefore = await page.locator('.iw-toast').allTextContents();
  for (const code of ['Tab', 'KeyC', 'KeyB', 'KeyJ', 'KeyM']) await tap(page, code);
  expect((await read(page)).panels).toEqual(['pause']);
  expect(await page.evaluate(() => (window as unknown as { heard: string[] }).heard)).toEqual([]);
  // No new toast: read at once, since a toast would fade if the check waited for it.
  for (const text of await page.locator('.iw-toast').allTextContents()) expect(toastsBefore).toContain(text);
  const frozen = await read(page);
  await hold(page, 'KeyW', 1000);
  expect((await read(page)).z).toBe(frozen.z);
  await page.getByRole('button', { name: 'Resume' }).click();
  expect(await read(page)).toMatchObject({ panels: [], paused: false });
});

test('the canoe builder opens on B once the canoe is on the beach', async ({ page }) => {
  await open(page, '?shot=island&live=1');
  expect(await read(page)).toMatchObject({ mode: 'foot', beached: true });
  await tap(page, 'KeyB');
  expect((await read(page)).panels).toEqual(['canoe_builder']);
  await expect(page.locator('.iw-panel-canoe_builder')).toContainText('Hull: Patched canoe');
});

test('a key rebound in the settings drives the canoe, and survives a reload', async ({ page }) => {
  await open(page, '');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Controls' }).click();
  const paddleRow = page.locator('.iw-bindings tr', { hasText: 'Paddle' }).first();
  await paddleRow.getByRole('button', { name: 'W', exact: true }).click();
  await expect(page.locator('.iw-notice')).toContainText('Press a key for Paddle');
  await tap(page, 'KeyI');
  await expect(page.locator('.iw-notice')).toContainText('Paddle is now I.');
  await expect(paddleRow.getByRole('button', { name: 'I', exact: true })).toBeVisible();
  expect((await read(page)).paddleKeys).toEqual(['KeyI', 'ArrowUp']);

  // A second rebind onto a key another action owns reports the conflict.
  const bailRow = page.locator('.iw-bindings tr', { hasText: 'Bail (hold)' });
  await bailRow.getByRole('button', { name: 'R', exact: true }).click();
  await tap(page, 'KeyL');
  await expect(page.locator('.iw-notice')).toContainText('Bail (hold) is now L. Lantern lost that key.');

  await page.reload();
  await page.waitForFunction(() => (window as unknown as { portage?: unknown }).portage !== undefined);
  expect((await read(page)).paddleKeys).toEqual(['KeyI', 'ArrowUp']);

  await page.getByRole('button', { name: 'New Game' }).click();
  await page.getByRole('button', { name: 'New game here' }).first().click();
  // The pick screen: start as whoever is marked.
  await page.locator('.iw-panel-character_select .cs-start').click();
  await page.waitForTimeout(300);
  expect((await read(page)).screen).toBe('game');
  const start = await read(page);
  await hold(page, 'KeyW', 1500); // W no longer paddles
  expect(Math.abs((await read(page)).speed)).toBeLessThan(0.2);
  await hold(page, 'KeyI', 2000);
  const moved = await read(page);
  expect(moved.speed).toBeGreaterThan(1);
  expect(Math.hypot(moved.x - start.x, moved.z - start.z)).toBeGreaterThan(1.5);
});

test('losing focus lets go of every key', async ({ page }) => {
  await open(page, '?at=quest1');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  expect((await read(page)).paddle).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(400);
  expect((await read(page)).paddle).toBe(0);
  await page.keyboard.up('KeyW');
});

test('dragging the mouse orbits the camera and the wheel zooms', async ({ page }) => {
  await open(page, '?at=quest1');
  const before = await read(page);
  await page.mouse.move(640, 500);
  await page.mouse.down();
  await page.mouse.move(840, 500, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const dragged = await read(page);
  expect(Math.abs(dragged.cameraYaw - before.cameraYaw)).toBeGreaterThan(0.5);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(200);
  expect((await read(page)).cameraDistance).toBeGreaterThan(dragged.cameraDistance * 1.3);
});

test('a new game from the lobby is saved, and Continue brings it back', async ({ page }) => {
  await open(page, '');
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await page.getByRole('button', { name: 'New Game' }).click();
  await page.getByRole('button', { name: 'New game here' }).nth(1).click();
  // The pick screen: start as whoever is marked.
  await page.locator('.iw-panel-character_select .cs-start').click();
  await hold(page, 'KeyR', 2500);
  const played = await read(page);
  expect(played.waterLevel).toBeLessThan(57);
  await tap(page, 'Escape');
  await page.getByRole('button', { name: 'Save and quit to the lobby' }).click();
  await page.getByRole('button', { name: 'Save and quit', exact: true }).click();
  expect((await read(page)).screen).toBe('lobby');

  await page.reload();
  await page.waitForFunction(() => (window as unknown as { portage?: unknown }).portage !== undefined);
  await page.getByRole('button', { name: 'Continue' }).click();
  const resumed = await read(page);
  expect(resumed.screen).toBe('game');
  expect(resumed.waterLevel).toBeCloseTo(played.waterLevel, 0);
});
