/**
 * The canoe behind the main menu in a real browser, headless (Luc, Round 4: "the video portion where its floating
 * around can you put it there?", and of the still sketch beside the menu: "drop the still").
 *
 * - with a save: the scene behind the menu wears that save's canoe, and the canoe is whole in the painted part of
 *   the sheet all round the camera's circle, at 1920x1080 and 1366x768;
 * - with no save, or a broken one: the scene's own canoe, a clean console, and the text in the slot left alone;
 * - reading the save for the scene never writes to it;
 * - the still sketch is gone: nothing of it on the page, and one 3D context where there were two;
 * - the lobby's words stay on the lobby's page, the Feedback line's side words too.
 *
 * Needs the dev server on http://localhost:5220, or PORTAGE_URL.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const BASE = process.env.PORTAGE_URL ?? 'http://localhost:5220';
/** A save from a live build, 100 minutes in: the long canoe with nine attachments, its lantern lit. */
const LIVE = readFileSync(new URL('../../game/tests/fixtures/save-live-seed7-min100.json', import.meta.url), 'utf8');
const SIZES: [number, number][] = [[1920, 1080], [1366, 768]];

test.use({
  viewport: { width: 1920, height: 1080 },
  launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
});
test.setTimeout(180_000);

interface Seen {
  hullTier: number;
  attachments: number;
  sailRaised: boolean;
  lanternLit: boolean;
  saved: boolean;
  reads: number;
  measures: number;
  figures: number;
  sketch: number;
  contexts: number;
  pageEdge: number;
  lines: { words: string; right: number }[];
  storage: string[];
}

interface Round { turns: number; inside: boolean; box: Record<'left' | 'right' | 'top' | 'bottom', number>; painted: Record<'left' | 'right' | 'top' | 'bottom', number> }

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Open the lobby with `save` in slot 1 (null: no save), counting every 3D context the page makes. Returns what the console complained of. */
async function openLobby(page: Page, save: string | null): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (message) => {
    if ((message.type() === 'error' || message.type() === 'warning') && !message.text().includes('GL Driver Message')) problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  await page.addInitScript((text) => {
    if (text !== null && window.localStorage.getItem('portage.save.0') === null) window.localStorage.setItem('portage.save.0', text);
    const made: unknown[] = [];
    (window as any).contexts = made;
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      const context = (original as (...parts: unknown[]) => unknown).call(this, type, ...rest);
      if (context && /webgl/.test(type) && !made.includes(context)) made.push(context);
      return context;
    } as typeof original;
  }, save);
  await page.goto(BASE);
  await page.waitForFunction(() => (window as any).portage?.worldView?.probe?.().drawingWidth > 0, null, { timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('.iw-lobby-col .iw-mi');
  return problems;
}

/** What the lobby shows, read off the page. */
const see = (page: Page): Promise<Seen> => page.evaluate(() => {
  const portage = (window as any).portage;
  const canoe = portage.session.backdrop.canoe;
  const lobby = document.querySelector('.iw-lobby')!;
  return {
    hullTier: canoe.hullTier, attachments: canoe.attachments.length, sailRaised: canoe.sailRaised, lanternLit: canoe.lanternLit,
    saved: portage.session.backdropCanoe.dress !== null, reads: portage.session.backdropCanoe.reads, measures: portage.app.lobbyCanoe.measures,
    figures: portage.worldView.probe().hero.figures.length,
    sketch: document.querySelectorAll('[class*="preview"], [class*="pv-"], .iw-lobby canvas').length,
    contexts: (window as any).contexts.length,
    // The torn edge of the lobby's page comes no further left than 81% of the page's width (as `interface.spec.ts` holds it).
    pageEdge: Number.parseFloat(getComputedStyle(lobby, '::before').width) * 0.81,
    lines: [...document.querySelectorAll<HTMLElement>('.iw-lobby-col .iw-mi')].map((line) => {
      const range = document.createRange();
      range.selectNodeContents(line);
      return { words: line.innerText.replace(/\s+/g, ' ').trim(), right: Math.max(...[...range.getClientRects()].map((box) => box.right)) };
    }),
    storage: Object.keys(localStorage).filter((key) => key.startsWith('portage.save')).sort().map((key) => `${key}:${localStorage.getItem(key)!.length}`),
  };
});

/**
 * One full circle of the lobby's camera and a little more, in the page: frames of a quarter second run back to
 * back, and on each one the eight corners of the canoe's box (as the look drew it) through the look's own camera.
 * The box of all of them, as shares of the window, beside the painted part of the sheet (`look/b2/post.js`: the
 * left 0.4 of the width is bare paper and its torn edge reaches 0.145 of the height further in, the other three
 * edges stop 0.066 of the height short).
 */
const circle = (page: Page): Promise<Round> => page.evaluate(() => {
  const { app, worldView, session } = (window as any).portage;
  const view = worldView.canoe;
  const box = view.bounds();
  const Vector = box.min.constructor;
  const seen = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  const from = session.backdrop.playedSeconds;
  for (let frame = 0; frame < 520; frame += 1) {
    app.frame(0.25);
    view.group.updateMatrixWorld(true);
    worldView.camera.updateMatrixWorld(true);
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const at = new Vector(x, y, z).applyMatrix4(view.group.matrixWorld).project(worldView.camera);
      seen.left = Math.min(seen.left, (at.x + 1) / 2);
      seen.right = Math.max(seen.right, (at.x + 1) / 2);
      seen.top = Math.min(seen.top, (1 - at.y) / 2);
      seen.bottom = Math.max(seen.bottom, (1 - at.y) / 2);
    }
  }
  const aspect = worldView.viewAspect();
  const painted = { left: 0.4 + 0.145 / aspect, right: 1 - 0.066 / aspect, top: 0.066, bottom: 1 - 0.066 };
  return {
    turns: ((session.backdrop.playedSeconds - from) * 0.05) / (2 * Math.PI), box: seen, painted,
    inside: seen.left > painted.left && seen.right < painted.right && seen.top > painted.top && seen.bottom < painted.bottom,
  };
});

/** The fullest canoe there is, as a save: the long hull, everything built, the sail up, the lantern lit. Made by the game's own code. */
const fullestSave = (page: Page): Promise<string> => page.evaluate(async () => {
  const sim = await import('/src/sim/index.ts' as string);
  const store = await import('/src/save/index.ts' as string);
  const data = await import('/src/data/index.ts' as string);
  const state = sim.createGame(7);
  Object.assign(state.canoe, { hullTier: 3, attachments: [...data.ATTACHMENT_IDS], sailRaised: true, lanternLit: true, rainProgress: 0.5 });
  return store.serialize(state, Date.now());
});

for (const [width, height] of SIZES) {
  test(`the canoe of the save played last drifts behind the menu, whole in the painting all round the circle (${width}x${height})`, async ({ browser }) => {
    // The fullest canoe is made in a page of its own, then stands in slot 1 of a fresh one.
    const maker = await browser.newPage();
    await maker.goto(BASE);
    const full = await fullestSave(maker);
    await maker.close();

    for (const [what, save, built, sail] of [['a save from a live build', LIVE, 9, false], ['the fullest canoe', full, 22, true]] as [string, string, number, boolean][]) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      const problems = await openLobby(page, save);
      const seen = await see(page);
      expect(seen, what).toMatchObject({ hullTier: 3, attachments: built, sailRaised: sail, lanternLit: true, saved: true });
      // Nobody aboard, as before; nothing of the sketch; one 3D context.
      expect(seen.figures, what).toBe(0);
      expect(seen.sketch, what).toBe(0);
      expect(seen.contexts, what).toBe(1);
      // The menu's words stay on the lobby's page, and the Feedback line has its side words.
      expect(seen.lines.map((line) => line.words), what).toContain('Feedback A bug, an idea, anything');
      for (const line of seen.lines) expect(line.right, `${what}: "${line.words}"`).toBeLessThanOrEqual(seen.pageEdge);

      const round = await circle(page);
      expect(round.turns, what).toBeGreaterThan(1);
      expect(round.inside, `${what}: its box ${JSON.stringify(round.box)} in the painting ${JSON.stringify(round.painted)}`).toBe(true);

      const after = await see(page);
      // Measured once, read once, and the save is the text it was.
      expect(after.measures, what).toBe(1);
      expect(after.reads, what).toBe(1);
      expect(after.storage, what).toEqual([`portage.save.0:${save.length}`]);
      expect(await page.evaluate(() => localStorage.getItem('portage.save.0')), what).toBe(save);
      expect(problems, what).toEqual([]);
      await context.close();
    }
  });
}

test('no save, and a broken save: the scene\'s own canoe, a clean console, and the broken text left alone', async ({ browser }) => {
  const BROKEN = 'not a save at all {"version":4';
  for (const [what, save] of [['no save', null], ['a broken save', BROKEN]] as [string, string | null][]) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();
    const problems = await openLobby(page, save);
    const seen = await see(page);
    // The patched hull, bare: the canoe the scene always had.
    expect(seen, what).toMatchObject({ hullTier: 1, attachments: 0, sailRaised: false, lanternLit: false, saved: false, figures: 0, sketch: 0, contexts: 1 });
    const round = await circle(page);
    expect(round.inside, `${what}: its box ${JSON.stringify(round.box)} in the painting ${JSON.stringify(round.painted)}`).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('portage.save.0')), what).toBe(save);
    expect(problems, what).toEqual([]);
    await context.close();
  }
});
