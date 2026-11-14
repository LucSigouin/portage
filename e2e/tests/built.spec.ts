/**
 * The built view, in a real browser on the real graphics card. Building from the canoe builder steps the panel
 * aside and holds one still, framed view of the canoe with the new piece on it, then gives the screen back.
 *
 * - a build cuts to the view: the panel, the HUD and the notes are put away, a slip names the piece, the whole
 *   canoe is in the frame, and it lasts about two seconds;
 * - nothing in it moves by itself: two captures 0.3 s apart are the same, pixel for pixel, and the camera pose
 *   is one pose from the first frame to the last;
 * - the screen comes back as it was: the panel where it was scrolled to, the notes, and the camera pose to the digit;
 * - any key ends it at once and does nothing else; so does a click;
 * - a build draws no puff of smoke;
 * - in a crew, the one who did not build keeps their screen, even with the builder open: the piece appears, a note says so, nothing else.
 *
 * Needs the dev server (PORTAGE_URL, default http://localhost:5221).
 * To prove a check can fail, break the line it guards: the list is in scratch/portage/fix-canoe/tools/break-sets.py.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const BASE = process.env.PORTAGE_URL ?? 'http://localhost:5221';

test.use({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
});
test.setTimeout(180_000);

interface Pose { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number }; fieldOfView: number }
interface Seen {
  built: { piece: Record<string, unknown>; secondsLeft: number } | null;
  panels: string;
  paused: boolean;
  pose: Pose;
  attachments: string[];
  hullTier: number;
  /** What is on the screen: the builder panel, the HUD, the notes, the slip. */
  panelShown: boolean;
  hudShown: boolean;
  notesShown: boolean;
  notes: string[];
  slip: string | null;
  /** How far down the builder's list is scrolled. */
  scrolled: number;
  /** The canoe's place on the window, as shares of its width and height: left, right, top, bottom. Null when it is off screen. */
  canoe: { left: number; right: number; top: number; bottom: number } | null;
  puffs: number;
}

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    if (!message.text().includes('GL Driver Message')) problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

function see(page: Page): Promise<Seen> {
  return page.evaluate(() => {
    const { session, app, worldView } = (window as unknown as { portage: any }).portage;
    const shown = (selector: string): boolean => {
      const element = document.querySelector<HTMLElement>(selector);
      return element !== null && element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible';
    };
    const probe = worldView.probe();
    // The canoe is the biggest of the heroes' windows (canvas pixels, from the bottom left).
    const windows = [...probe.hero.windows].sort((first: any, second: any) => second.w * second.h - first.w * first.h);
    const canoe = windows[0] ? {
      left: windows[0].x / probe.canvasWidth, right: (windows[0].x + windows[0].w) / probe.canvasWidth,
      top: 1 - (windows[0].y + windows[0].h) / probe.canvasHeight, bottom: 1 - windows[0].y / probe.canvasHeight,
    } : null;
    return {
      built: session.builtView ? { piece: { ...session.builtView.piece }, secondsLeft: session.builtView.secondsLeft } : null,
      panels: session.panels.stack.join(','), paused: session.paused, pose: JSON.parse(JSON.stringify(app.lastPose)),
      attachments: [...session.game.canoe.attachments], hullTier: session.game.canoe.hullTier,
      panelShown: shown('.iw-panel-canoe_builder'), hudShown: shown('.iw-vitals'), notesShown: shown('.iw-toast'),
      notes: [...document.querySelectorAll('.iw-toast')].map((note) => note.textContent ?? ''),
      slip: shown('.iw-shown-slip') ? [...document.querySelectorAll('.iw-shown-slip > *')].map((line) => line.textContent).join(' | ') : null,
      scrolled: document.querySelector('.iw-panel-canoe_builder .iw-body')?.scrollTop ?? 0,
      canoe, puffs: probe.puffs,
    };
  });
}

/** The staged builder: the ribbed canoe beached on Home Knoll, the panel open, with enough aboard for a cargo rack and more. Live, as in play. */
async function openBuilder(page: Page): Promise<void> {
  await page.goto(`${BASE}/?shot=builder&live=1`);
  await page.waitForFunction(() => {
    const hooks = (window as unknown as { portage?: any }).portage;
    return hooks?.worldView?.probe !== undefined && hooks.worldView.probe().drawingWidth > 0 && hooks.session?.game;
  });
  await expect(page.locator('.iw-panel-canoe_builder')).toBeVisible();
  await page.waitForTimeout(1200);
}

/** The Build buttons that can be pressed, top to bottom. */
const buildButtons = (page: Page) => page.locator('.iw-panel-canoe_builder .iw-entry button:not([disabled])');

/** Press a Build button with the pointer and wait for the view to begin. Returns what was built. */
async function build(page: Page, index = 0): Promise<string> {
  const before = (await see(page)).attachments;
  await buildButtons(page).nth(index).click();
  // The session begins the view on the press; the screen follows on the next frame.
  await expect.poll(async () => {
    const now = await see(page);
    return now.built !== null && now.slip !== null;
  }, { message: 'the built view begins', timeout: 3000, intervals: [16] }).toBe(true);
  const made = (await see(page)).attachments.filter((id) => !before.includes(id));
  expect(made.length).toBe(1);
  return made[0];
}

async function differingPixels(page: Page, first: Buffer, second: Buffer): Promise<number> {
  return page.evaluate(async ([a, b]) => {
    const pixels = async (base64: string): Promise<ImageData> => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height);
    };
    const [one, two] = [await pixels(a), await pixels(b)];
    let different = 0;
    for (let at = 0; at < one.data.length; at += 4) {
      if (one.data[at] !== two.data[at] || one.data[at + 1] !== two.data[at + 1] || one.data[at + 2] !== two.data[at + 2]) different += 1;
    }
    return different;
  }, [first.toString('base64'), second.toString('base64')]);
}

test('a build cuts to a still, framed view of the canoe with the new piece, then gives the screen back as it was', async ({ page }) => {
  const problems = watchConsole(page);
  await openBuilder(page);
  // Scroll the long list a little, to see that it is given back where it was.
  await page.locator('.iw-panel-canoe_builder .iw-body').evaluate((body) => { body.scrollTop = 60; });
  // And turn the camera the player's own way: that is the view to come back to.
  await page.evaluate(() => {
    const { app, session } = (window as unknown as { portage: any }).portage;
    app.camera.setOrbit({ yaw: session.game.canoe.heading + 0.9, pitch: 0.5, distance: 7 });
  });
  await page.waitForTimeout(400);
  const before = await see(page);
  expect(before.built).toBeNull();
  expect(before.panelShown).toBe(true);
  expect(before.scrolled).toBe(60);
  // Since round 4 the screen-edge cards (the vitals among them) stand aside while a sheet is open (`interface/edgecards.ts`).
  expect(before.hudShown, 'the vitals stand aside behind the open builder').toBe(false);

  const began = Date.now();
  const made = await build(page);
  const during = await see(page);
  // The panel has stepped aside: it is still open, and the game is still frozen behind it, but it is not on the screen.
  expect(during.built?.piece).toEqual({ kind: 'attachment', attachmentId: made });
  expect(during.panels).toBe('canoe_builder');
  expect(during.paused).toBe(true);
  expect(during.panelShown, 'the builder panel is off the screen').toBe(false);
  expect(during.hudShown, 'the HUD is off the screen').toBe(false);
  expect(during.notesShown, 'the notes are off the screen').toBe(false);
  // A slip names the piece.
  expect(during.slip).toMatch(/^Built \| .+ \| .+ \| Any key$/);
  // A cut to another pose, through the view's own lens.
  expect(during.pose).not.toEqual(before.pose);
  expect(during.pose.fieldOfView).toBe(34);
  // Framed: the whole canoe is inside the frame, clear of its edges and of the slip, and fills over a third of its
  // width (the player standing at the bow is in the picture too, head to foot).
  expect(during.canoe, 'the canoe is on the screen').not.toBeNull();
  const canoe = during.canoe!;
  console.log(`built ${made}: canoe from ${(canoe.left * 100).toFixed(1)}% to ${(canoe.right * 100).toFixed(1)}% across and ${(canoe.top * 100).toFixed(1)}% to ${(canoe.bottom * 100).toFixed(1)}% down`);
  expect(canoe.left).toBeGreaterThan(0.03);
  expect(canoe.right).toBeLessThan(0.97);
  expect(canoe.top).toBeGreaterThan(0.04);
  expect(canoe.bottom).toBeLessThan(0.76);
  expect(canoe.right - canoe.left, 'the share of the frame the canoe fills, side to side').toBeGreaterThan(0.36);

  // Nothing moves by itself: 0.3 s apart, the same picture and the same pose.
  const first = await page.screenshot();
  await page.waitForTimeout(300);
  const second = await page.screenshot();
  const still = await see(page);
  expect(still.built, `still held 0.3 s on (${Date.now() - began} ms after the press, two pictures taken)`).not.toBeNull();
  expect(still.pose).toEqual(during.pose);
  const moved = await differingPixels(page, first, second);
  expect(moved, 'pixels that changed in 0.3 s of the held view').toBe(0);

  // About two seconds, then the screen is given back.
  await expect.poll(async () => (await see(page)).built, { message: 'the view ends by itself', timeout: 5000, intervals: [16] }).toBeNull();
  const lasted = (Date.now() - began) / 1000;
  expect(lasted).toBeGreaterThan(1.7);
  expect(lasted).toBeLessThan(3);
  const after = await see(page);
  expect(after.panels).toBe('canoe_builder');
  expect(after.panelShown).toBe(true);
  expect(after.hudShown, 'the HUD as it was before the build').toBe(before.hudShown);
  expect(after.slip).toBeNull();
  expect(after.scrolled, 'the list is where it was scrolled to').toBe(60);
  // A cut back to the very pose the player left.
  expect(after.pose).toEqual(before.pose);
  // The build's note waited: it is on the screen now.
  expect(after.notes.some((note) => note.startsWith('Built: '))).toBe(true);
  console.log(`built ${made}: held ${lasted.toFixed(2)} s, ${moved} pixels moved in 0.3 s, canoe from ${(canoe.left * 100).toFixed(0)}% to ${(canoe.right * 100).toFixed(0)}% across and ${(canoe.top * 100).toFixed(0)}% to ${(canoe.bottom * 100).toFixed(0)}% down`);
  expect(problems).toEqual([]);
});

test('any key gives the screen back at once and does nothing else, and so does a click', async ({ page }) => {
  for (const key of ['Escape', 'Space', 'KeyB']) {
    // A fresh canoe each time: a build spends what the next one needs.
    await openBuilder(page);
    const began = Date.now();
    const made = await build(page);
    await page.waitForTimeout(250);
    await page.keyboard.press(key);
    await expect.poll(async () => (await see(page)).built, { message: `${key} ends the view`, timeout: 1000, intervals: [16] }).toBeNull();
    expect((Date.now() - began) / 1000, `${key}: ended early`).toBeLessThan(1.5);
    await page.waitForTimeout(150);
    const after = await see(page);
    // The key did nothing else: Esc did not close the panel, B did not toggle it, Space pressed no button.
    expect(after.panels, key).toBe('canoe_builder');
    expect(after.panelShown, key).toBe(true);
    expect(after.attachments.at(-1), key).toBe(made);
  }
  // A click anywhere, here over where the Build buttons are.
  await openBuilder(page);
  const place = await buildButtons(page).nth(1).boundingBox();
  const made = await build(page);
  await page.waitForTimeout(250);
  await page.mouse.click(place ? place.x + place.width / 2 : 960, place ? place.y + place.height / 2 : 400);
  await expect.poll(async () => (await see(page)).built, { message: 'a click ends the view', timeout: 1000, intervals: [16] }).toBeNull();
  await page.waitForTimeout(300);
  const after = await see(page);
  expect(after.panelShown).toBe(true);
  // The click went to the view, not through it to the button underneath.
  expect(after.attachments.at(-1)).toBe(made);
  expect(after.built).toBeNull();
  // And the next Esc is the panel's again.
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await see(page)).panels).toBe('');
});

test('a build draws no puff of smoke over the hull', async ({ page }) => {
  await openBuilder(page);
  await build(page);
  let most = (await see(page)).puffs;
  await page.keyboard.press('Space');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await see(page)).panels).toBe('');
  // The game runs again: a puff held back by the panel would rise now.
  for (let look = 0; look < 12; look += 1) {
    await page.waitForTimeout(50);
    most = Math.max(most, (await see(page)).puffs);
  }
  expect(most).toBe(0);
});

test('in a crew, the one who did not build keeps their screen: the piece, a note, and nothing else', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const room = `built-${Date.now().toString(36)}`;
  const inGame = (page: Page): Promise<unknown> => page.waitForFunction(() => (window as unknown as { portage?: any }).portage?.session.screen === 'game', undefined, { timeout: 30000 });
  const host = await context.newPage();
  await host.goto(`${BASE}/?host=${room}&name=Luc`);
  await inGame(host);
  const guest = await context.newPage();
  await guest.goto(`${BASE}/?join=${room}&name=Sam`);
  await inGame(guest);
  // Beach the canoe on Home Knoll with the bark and the pitch aboard, and stand both of them at its bow.
  await host.evaluate(async () => {
    const sim = await import('/src/sim/index.ts' as string);
    const data = await import('/src/data/index.ts' as string);
    const game = (window as unknown as { portage: any }).portage.session.game;
    const berth = sim.landingBerth('home_knoll', game.canoe.hullTier);
    Object.assign(game.canoe, { position: { x: berth.x, y: 0, z: berth.z }, heading: berth.heading, speed: 0, beached: true, waterLevel: 0, lastBeached: { ...berth, islandId: 'home_knoll' } });
    game.players.forEach((player: any, index: number) => {
      const x = berth.x + Math.sin(berth.heading) * 2.2 + Math.cos(berth.heading) * (index - 0.5) * 1.4;
      const z = berth.z - Math.cos(berth.heading) * 2.2 + Math.sin(berth.heading) * (index - 0.5) * 1.4;
      Object.assign(player, { mode: 'foot', seat: null, islandId: 'home_knoll', heading: berth.heading, position: { x, y: sim.terrainHeight(x, z), z } });
    });
    for (const { itemId, count } of data.HULL_TIERS[1].cost) game.canoe.cargo.push({ itemId, count });
  });
  await expect.poll(async () => (await see(guest)).notes.length === 0 && (await guest.evaluate(() => (window as unknown as { portage: any }).portage.session.game.canoe.beached)), { timeout: 15000 }).toBe(true);
  // The guest has the canoe builder open too: the likeliest screen to be taken by mistake.
  await guest.keyboard.press('KeyB');
  await expect(guest.locator('.iw-panel-canoe_builder')).toBeVisible();
  await guest.waitForTimeout(800);
  const before = await see(guest);
  // Since round 4 the screen-edge cards (the vitals among them) stand aside while a sheet is open (`interface/edgecards.ts`).
  expect(before.hudShown, 'the guest\'s vitals stand aside behind the open builder').toBe(false);

  // The host builds from the panel, and is shown it.
  await host.keyboard.press('KeyB');
  await expect(host.locator('.iw-panel-canoe_builder')).toBeVisible();
  await buildButtons(host).first().click();
  await expect.poll(async () => (await see(host)).built?.piece, { timeout: 3000, intervals: [16] }).toEqual({ kind: 'hull', tier: 1 });
  await expect.poll(async () => (await see(host)).slip ?? '', { timeout: 3000, intervals: [16] }).toMatch(/^Hull rebuilt \| Patched canoe \| /);

  // The guest sees the hull change and reads the note. Their screen is theirs: no view, no slip, their own panel
  // still up (it now reads "Patched canoe"), the HUD and the camera as they were.
  await expect.poll(async () => (await see(guest)).hullTier, { timeout: 5000 }).toBe(1);
  await expect.poll(async () => (await see(guest)).notes, { timeout: 5000 }).toContain('Hull rebuilt: Patched canoe');
  await expect(guest.locator('.iw-panel-canoe_builder .iw-stats')).toContainText('Patched canoe');
  for (let look = 0; look < 12; look += 1) {
    const now = await see(guest);
    expect(now.built, 'the guest is not shown the built view').toBeNull();
    expect(now.slip).toBeNull();
    expect(now.panelShown).toBe(true);
    expect(now.hudShown, 'the guest\'s HUD as it was').toBe(before.hudShown);
    expect(now.pose.fieldOfView).toBe(before.pose.fieldOfView);
    expect(now.puffs).toBe(0);
    await guest.waitForTimeout(100);
  }
  await context.close();
});
