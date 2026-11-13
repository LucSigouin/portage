/**
 * Two windows on one computer play one game: a host (`?host=ROOM`) and a
 * guest (`?join=ROOM&name=...`), two pages of one browser, talking over the
 * browser's own channel between tabs. No server. Needs the dev server.
 *
 * Run: PORTAGE_URL=http://localhost:5222 npm --prefix <worktree>/e2e test -- coop.spec.ts --global-timeout=300000
 */
import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

const BASE = process.env.PORTAGE_URL ?? 'http://localhost:5220';

test.use({
  viewport: { width: 1280, height: 720 },
  // Render on the graphics card: the software fallback runs at about one frame a second.
  launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
});
test.setTimeout(180_000);

interface PlayerView { id: number; name: string; connected: boolean; mode: string; x: number; z: number; paddling: boolean; tool: string | null; driftwood: number }
interface Snapshot {
  screen: string;
  role: 'host' | 'guest' | 'solo';
  localPlayerId: number;
  hostId: number | null;
  paused: boolean;
  step: number;
  playedSeconds: number;
  canoeX: number;
  canoeZ: number;
  tools: string[];
  players: PlayerView[];
  mismatches: number;
}

/** Read one window's game through the handle `main.ts` leaves on it. */
function read(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const { session } = (window as unknown as { portage: { session: any } }).portage;
    const game = session.game;
    return {
      screen: session.screen,
      role: session.host ? 'host' : session.guest ? 'guest' : 'solo',
      localPlayerId: session.localPlayerId,
      hostId: session.hostId,
      paused: session.paused,
      step: game ? game.tick : -1,
      playedSeconds: game ? game.playedSeconds : 0,
      canoeX: game ? game.canoe.position.x : 0,
      canoeZ: game ? game.canoe.position.z : 0,
      tools: game ? [...game.tools] : [],
      players: game ? game.players.map((player: any) => ({
        id: player.id, name: player.name, connected: player.connected, mode: player.mode, x: player.position.x, z: player.position.z,
        paddling: player.paddling, tool: player.selectedTool,
        driftwood: player.backpack.filter((stack: any) => stack.itemId === 'driftwood').reduce((sum: number, stack: any) => sum + stack.count, 0),
      })) : [],
      mismatches: session.guest ? session.guest.mismatches : 0,
    };
  });
}

/** The crew list as drawn: a row a player, with its name and its one tag. */
function crewRows(page: Page): Promise<{ name: string; tag: string; away: boolean; you: boolean }[]> {
  return page.evaluate(() => [...document.querySelectorAll('.iw-crew .iw-mate')].map((row) => ({
    name: row.querySelector('.iw-mate-name')!.firstChild!.textContent ?? '',
    tag: row.querySelector('.iw-mate-name .iw-kind')?.textContent ?? '',
    away: row.classList.contains('iw-away'),
    you: row.classList.contains('iw-you'),
  })));
}

/** Run a script in the page with `portage`, `sim` (the rules engine) and `data` (the tables) in reach. */
function stage(page: Page, body: string): Promise<unknown> {
  return page.evaluate(`(async () => {
    const sim = await import('/src/sim/index.ts');
    const data = await import('/src/data/index.ts');
    const portage = window.portage;
    ${body}
  })()`);
}

async function open(context: BrowserContext, query: string, problems: string[]): Promise<Page> {
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`${query} console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`${query} pageerror: ${error.message}`));
  await page.goto(`${BASE}/${query}`);
  await page.waitForFunction(() => (window as unknown as { portage?: unknown }).portage !== undefined);
  return page;
}

const inGame = (page: Page): Promise<unknown> =>
  page.waitForFunction(() => (window as unknown as { portage: { session: any } }).portage.session.screen === 'game', undefined, { timeout: 30_000 });

/** Hold a key in one window for a while. */
async function hold(page: Page, key: string, milliseconds: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(milliseconds);
  await page.keyboard.up(key);
}

/**
 * Both players ashore on Home Knoll, the canoe pulled up at the landing. Run on the host: it owns the game.
 * They stand a few steps south-east of the fire, on open ground. The fire ring is solid, like the trees: a spot
 * beside it would have a walk stop short against it, whichever way the camera happened to look.
 */
const PUT_CREW_ASHORE = `
  const game = portage.session.game;
  const island = data.ISLANDS_BY_ID.home_knoll;
  const berth = sim.landingBerth('home_knoll', game.canoe.hullTier);
  Object.assign(game.canoe, { position: { x: berth.x, y: 0, z: berth.z }, heading: berth.heading, speed: 0, beached: true, waterLevel: 0 });
  game.canoe.lastBeached = { ...berth, islandId: 'home_knoll' };
  const camp = data.spotPosition(island, island.camp.spot);
  game.players.forEach((player, index) => {
    const x = camp.x + 3 + index * 1.2;
    const z = camp.z + 3;
    Object.assign(player, { mode: 'foot', seat: null, islandId: 'home_knoll', position: { x, y: sim.terrainHeight(x, z), z } });
  });
`;

test('two windows play one game: join, move, share a tool, leave, come back', async ({ context }) => {
  const problems: string[] = [];
  const room = `spec-${Date.now().toString(36)}`;
  const host = await open(context, `?host=${room}&name=Luc`, problems);
  await inGame(host);
  expect((await read(host)).role).toBe('host');
  // Alone, the host has no crew list.
  expect(await crewRows(host)).toEqual([]);

  // --- The guest appears in the host's crew list ---------------------------------
  let guest = await open(context, `?join=${room}&name=Sam`, problems);
  await inGame(guest);
  await expect(host.locator('.iw-crew .iw-mate')).toHaveCount(2);
  await expect(guest.locator('.iw-crew .iw-mate')).toHaveCount(2);
  expect(await crewRows(host)).toEqual([
    { name: 'Luc', tag: 'you', away: false, you: true },
    { name: 'Sam', tag: '', away: false, you: false },
  ]);
  expect(await crewRows(guest)).toEqual([
    { name: 'Luc', tag: 'host', away: false, you: false },
    { name: 'Sam', tag: 'you', away: false, you: true },
  ]);
  await expect(host.locator('.iw-toast', { hasText: 'Sam joined the crew' })).toBeVisible();
  let onGuest = await read(guest);
  expect(onGuest).toMatchObject({ role: 'guest', localPlayerId: 1, hostId: 0 });
  expect(onGuest.players.map((player) => [player.name, player.mode, player.connected])).toEqual([['Luc', 'canoe', true], ['Sam', 'canoe', true]]);

  // --- Each sees the other move: in the canoe ---------------------------------------
  const afloat = await read(host);
  await hold(host, 'w', 2500);
  await host.waitForTimeout(400);
  let onHost = await read(host);
  onGuest = await read(guest);
  const hostPaddled = Math.hypot(onHost.canoeX - afloat.canoeX, onHost.canoeZ - afloat.canoeZ);
  expect(hostPaddled, 'the host paddles and the canoe moves').toBeGreaterThan(1);
  expect(Math.hypot(onGuest.canoeX - afloat.canoeX, onGuest.canoeZ - afloat.canoeZ), 'the guest sees the canoe the host paddled').toBeGreaterThan(hostPaddled * 0.7);

  await guest.keyboard.down('w');
  await expect.poll(async () => (await read(host)).players[1]!.paddling, { message: 'the host sees the guest paddle' }).toBe(true);
  await guest.waitForTimeout(2000);
  await guest.keyboard.up('w');
  await expect.poll(async () => (await read(host)).players[1]!.paddling).toBe(false);
  const afterGuest = await read(host);
  expect(Math.hypot(afterGuest.canoeX - onHost.canoeX, afterGuest.canoeZ - onHost.canoeZ), 'the guest paddles and the host\'s canoe moves').toBeGreaterThan(1);
  expect(afterGuest.players[0]!.paddling).toBe(false);

  // --- Each sees the other move: on foot ----------------------------------------------
  await stage(host, PUT_CREW_ASHORE);
  await host.waitForTimeout(500);
  const ashore = await read(host);
  await hold(guest, 'd', 1500);
  await guest.waitForTimeout(400);
  onHost = await read(host);
  const guestWalked = Math.hypot(onHost.players[1]!.x - ashore.players[1]!.x, onHost.players[1]!.z - ashore.players[1]!.z);
  expect(guestWalked, 'the guest walks and the host sees it').toBeGreaterThan(1);
  expect(Math.hypot(onHost.players[0]!.x - ashore.players[0]!.x, onHost.players[0]!.z - ashore.players[0]!.z), 'the guest\'s keys move only the guest').toBeLessThan(0.01);
  await hold(host, 'd', 1500);
  await host.waitForTimeout(400);
  onGuest = await read(guest);
  expect(Math.hypot(onGuest.players[0]!.x - ashore.players[0]!.x, onGuest.players[0]!.z - ashore.players[0]!.z), 'the host walks and the guest sees it').toBeGreaterThan(1);

  // --- A tool one makes works for the other ---------------------------------------------
  // The fishing rod needs a knife. The host has the parts and no knife: refused.
  await stage(host, `
    const game = portage.session.game;
    game.players[0].backpack.push({ itemId: 'driftwood', count: 2 }, { itemId: 'rope', count: 1 }, { itemId: 'nails', count: 1 });
    game.players[1].backpack.push({ itemId: 'stone', count: 2 }, { itemId: 'driftwood', count: 4 }, { itemId: 'fiber', count: 2 });
  `);
  const refused = await host.evaluate(() => (window as unknown as { portage: { session: any } }).portage.session.dispatch({ type: 'craft', recipeId: 'fishing_rod' }, true));
  expect(refused).toMatchObject({ ok: false, reason: 'missing_requirements', missing: { tools: ['stone_knife'] } });
  // The guest makes the knife, in its own window.
  await guest.evaluate(() => (window as unknown as { portage: { session: any } }).portage.session.handleIntent({ type: 'command', command: { type: 'craft', recipeId: 'stone_knife' } }));
  await expect(host.locator('.iw-toast', { hasText: 'Sam made a new tool: Stone knife' })).toBeVisible();
  await expect(guest.locator('.iw-toast', { hasText: 'You made a new tool: Stone knife' })).toBeVisible();
  expect((await read(host)).tools).toContain('stone_knife');
  // Now the host's rod gets made, with the guest's knife.
  const made = await host.evaluate(() => (window as unknown as { portage: { session: any } }).portage.session.dispatch({ type: 'craft', recipeId: 'fishing_rod' }, true));
  expect(made).toMatchObject({ ok: true });
  await expect.poll(async () => (await read(guest)).tools, { message: 'the guest has the rod the host made' }).toEqual(expect.arrayContaining(['stone_knife', 'fishing_rod']));

  // --- With two playing, nothing pauses the game -----------------------------------------
  await host.evaluate(() => (window as unknown as { portage: { session: any } }).portage.session.handleIntent({ type: 'open_panel', panel: 'inventory' }));
  await expect(host.locator('.iw-panel-inventory')).toBeVisible();
  const openAt = await read(host);
  expect(openAt.paused).toBe(false);
  await host.waitForTimeout(1000);
  expect((await read(host)).playedSeconds, 'the world runs on behind the host\'s panel').toBeGreaterThan(openAt.playedSeconds + 0.5);
  await host.evaluate(() => (window as unknown as { portage: { session: any } }).portage.session.handleIntent({ type: 'resume' }));

  // --- The guest shows the host's game, fingerprint for fingerprint ------------------------
  expect((await read(guest)).mismatches).toBe(0);
  await host.evaluate(() => {
    (window as unknown as { portage: { session: any } }).portage.session.frozen = true;
  });
  const hostHash = await stage(host, 'await new Promise((done) => setTimeout(done, 600)); return sim.hashState({ ...portage.session.game, events: [] });');
  await expect.poll(() => stage(guest, 'return sim.hashState(portage.session.guest.truth);'), { message: 'host and guest fingerprints agree once messages settle' }).toBe(hostHash);
  await host.evaluate(() => {
    (window as unknown as { portage: { session: any } }).portage.session.frozen = false;
  });

  // --- The guest closes its window and shows as away ---------------------------------------
  const before = (await read(host)).players[1]!;
  expect(before.driftwood).toBe(3);
  await guest.close({ runBeforeUnload: true });
  await expect(host.locator('.iw-crew .iw-mate.iw-away'), 'the guest shows as away').toHaveCount(1, { timeout: 25_000 });
  expect(await crewRows(host)).toEqual([
    { name: 'Luc', tag: 'you', away: false, you: true },
    { name: 'Sam', tag: 'away', away: true, you: false },
  ]);
  await expect(host.locator('.iw-toast', { hasText: 'Sam is away' })).toBeVisible();
  let gone = await read(host);
  expect(gone.players).toHaveLength(2);
  expect(gone.players[1]).toMatchObject({ connected: false, name: 'Sam', driftwood: 3 });
  // Alone again, the host's panels pause the game as they always did.
  await host.evaluate(() => (window as unknown as { portage: { session: any } }).portage.session.handleIntent({ type: 'open_panel', panel: 'inventory' }));
  expect((await read(host)).paused).toBe(true);
  await host.evaluate(() => (window as unknown as { portage: { session: any } }).portage.session.handleIntent({ type: 'resume' }));
  await host.waitForTimeout(500);
  gone = await read(host);
  expect(Math.hypot(gone.players[1]!.x - before.x, gone.players[1]!.z - before.z), 'the away player stands where they were left').toBeLessThan(0.01);

  // --- And returns: the same player, with what they had --------------------------------------
  guest = await open(context, `?join=${room}&name=Sam`, problems);
  await inGame(guest);
  await expect(host.locator('.iw-crew .iw-mate.iw-away')).toHaveCount(0);
  await expect(host.locator('.iw-crew .iw-mate')).toHaveCount(2);
  await expect(host.locator('.iw-toast', { hasText: 'Sam is back' })).toBeVisible();
  onGuest = await read(guest);
  expect(onGuest).toMatchObject({ role: 'guest', localPlayerId: 1 });
  const back = (await read(host)).players;
  expect(back).toHaveLength(2);
  expect(back[1]).toMatchObject({ connected: true, name: 'Sam', driftwood: 3, mode: 'foot' });
  expect(await crewRows(guest)).toEqual([
    { name: 'Luc', tag: 'host', away: false, you: false },
    { name: 'Sam', tag: 'you', away: false, you: true },
  ]);
  // Still theirs to play: the returned guest walks.
  await hold(guest, 'a', 1200);
  await expect.poll(async () => {
    const now = (await read(host)).players[1]!;
    return Math.hypot(now.x - back[1]!.x, now.z - back[1]!.z);
  }, { message: 'the returned guest walks again' }).toBeGreaterThan(0.5);

  expect(problems).toEqual([]);
});

test('a host whose tab is hidden keeps the game going for its guest', async ({ context }) => {
  const problems: string[] = [];
  const room = `spec-hidden-${Date.now().toString(36)}`;
  const host = await open(context, `?host=${room}&name=Luc`, problems);
  await inGame(host);
  const guest = await open(context, `?join=${room}&name=Sam`, problems);
  await inGame(guest);
  await expect(host.locator('.iw-crew .iw-mate')).toHaveCount(2);

  // What a hidden tab is: no display frames, and the page says it is hidden. (Headless pages are never hidden by themselves.)
  await host.evaluate(() => {
    const portage = (window as unknown as { portage: { loop: { stop(): void }; followVisibility(): void } }).portage;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    portage.loop.stop();
    portage.followVisibility();
  });
  const hiddenAt = await read(host);
  const guestAt = await read(guest);
  await host.waitForTimeout(3000);
  const later = await read(host);
  expect(later.playedSeconds - hiddenAt.playedSeconds, 'the hidden host steps on').toBeGreaterThan(2);
  expect(later.playedSeconds - hiddenAt.playedSeconds, 'at the game\'s own pace').toBeLessThan(4);
  expect((await read(guest)).step - guestAt.step, 'and its guest keeps getting states').toBeGreaterThan(120);
  // The guest still plays while the host is hidden.
  await guest.keyboard.down('w');
  await expect.poll(async () => (await read(host)).players[1]!.paddling).toBe(true);
  await guest.keyboard.up('w');

  // Back in view: display frames again, and only those.
  await host.evaluate(() => {
    const portage = (window as unknown as { portage: { loop: { start(): void }; followVisibility(): void } }).portage;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    portage.followVisibility();
    portage.loop.start();
  });
  const shownAt = await read(host);
  await host.waitForTimeout(2000);
  const shown = await read(host);
  expect(shown.playedSeconds - shownAt.playedSeconds).toBeGreaterThan(1);
  expect(shown.playedSeconds - shownAt.playedSeconds, 'not stepped twice over').toBeLessThan(2.6);
  expect((await read(guest)).mismatches).toBe(0);
  expect(problems).toEqual([]);
});

test('a guest\'s own walking is on its screen within a frame or two of the key, and ends where the host has it', async ({ context }) => {
  const problems: string[] = [];
  const room = `spec-walk-${Date.now().toString(36)}`;
  const host = await open(context, `?host=${room}&name=Luc`, problems);
  await inGame(host);
  const guest = await open(context, `?join=${room}&name=Sam`, problems);
  await inGame(guest);
  await expect(host.locator('.iw-crew .iw-mate')).toHaveCount(2);
  await stage(host, PUT_CREW_ASHORE);
  await expect.poll(async () => (await read(guest)).players[1]!.mode, { message: 'the guest sees itself ashore' }).toBe('foot');
  await guest.waitForTimeout(600);

  // Watch the guest's own figure and its camera frame by frame, from inside the page, while W goes down.
  await guest.evaluate(() => {
    const portage = (window as unknown as { portage: { session: any; app: any } }).portage;
    const log: { held: boolean; x: number; z: number; aimX: number; aimZ: number; eased: number }[] = [];
    (window as unknown as { walkLog: unknown }).walkLog = log;
    const watch = (): void => {
      const session = portage.session;
      const me = session.game.players[session.localPlayerId];
      log.push({
        held: session.input.isHeld('moveForward'), x: me.position.x, z: me.position.z,
        aimX: portage.app.lastPose.target.x, aimZ: portage.app.lastPose.target.z, eased: session.guest.walk.eased,
      });
      if (log.length < 600) requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  await guest.waitForTimeout(200);
  await hold(guest, 'KeyW', 700);
  await guest.waitForTimeout(700);
  const log = await guest.evaluate(() => (window as unknown as { walkLog: { held: boolean; x: number; z: number; aimX: number; aimZ: number; eased: number }[] }).walkLog);
  const pressed = log.findIndex((entry) => entry.held);
  expect(pressed, 'the key was seen').toBeGreaterThan(0);
  const still = log[pressed - 1]!;
  const moved = log.findIndex((entry, index) => index >= pressed && Math.hypot(entry.x - still.x, entry.z - still.z) > 1e-6);
  const aimed = log.findIndex((entry, index) => index >= pressed && Math.hypot(entry.aimX - still.aimX, entry.aimZ - still.aimZ) > 1e-6);
  // The watcher may run just before or just after the game's own frame: so at most the frame after the key, never the view's beat (six or more).
  expect(moved - pressed, 'frames from the key to the figure moving').toBeLessThanOrEqual(2);
  expect(aimed - pressed, 'frames from the key to the camera moving').toBeLessThanOrEqual(2);
  // Nothing was put right on the way: the host walked the same steps.
  expect(Math.max(...log.map((entry) => entry.eased)), 'the largest one-frame correction, metres').toBeLessThanOrEqual(0.03);

  // Stopped: the guest's figure is where the host has the guest's player, and they agree on the game.
  const onGuest = (await read(guest)).players[1]!;
  const onHost = (await read(host)).players[1]!;
  expect(Math.hypot(onGuest.x - onHost.x, onGuest.z - onHost.z)).toBeLessThan(0.01);
  expect(Math.hypot(onHost.x - still.x, onHost.z - still.z), 'the host walked the guest').toBeGreaterThan(1);
  expect((await read(guest)).mismatches).toBe(0);
  expect(problems).toEqual([]);
});
