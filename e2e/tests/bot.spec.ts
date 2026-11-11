/**
 * The headless bot playing the live browser session from New Game to the
 * Beacon, through the session's own input and command path. Saves a
 * screenshot at the end of quests 1, 3, 6, 9, 11 and 12 and records the
 * frame rate along the way. Needs the dev server on http://localhost:5220.
 *
 * Set PORTAGE_BOT_SPEED to change the replay speed (default 32).
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const BASE = process.env.PORTAGE_URL ?? 'http://localhost:5220';
const SHOTS = '/Users/ls/Claude-Workspace/personal/scratch/portage/client';
const SPEED = Number(process.env.PORTAGE_BOT_SPEED ?? 32);

test.use({
  viewport: { width: 1600, height: 900 },
  launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
});
test.setTimeout(900_000);

interface Progress {
  questsDone: number;
  beaconLit: boolean;
  fails: number;
  playedMinutes: number;
  framesPerSecond: number;
  workMilliseconds: number;
  botStatus: string;
  hullTier: number;
  attachments: number;
  panels: string[];
}

async function progress(page: Page): Promise<Progress> {
  return page.evaluate(() => {
    const { app, session } = (window as unknown as { portage: { app: any; session: any } }).portage;
    const game = session.game;
    const debug = app.lastModel?.debug;
    return {
      questsDone: Object.values(game.quests as Record<string, { status: string }>).filter((quest) => quest.status === 'completed').length,
      beaconLit: game.flags.beacon_lit === true,
      fails: game.statistics.fails,
      playedMinutes: game.playedSeconds / 60,
      framesPerSecond: debug?.framesPerSecond ?? 0,
      workMilliseconds: debug?.workMilliseconds ?? 0,
      botStatus: debug?.lines?.[0] ?? '',
      hullTier: game.canoe.hullTier,
      attachments: game.canoe.attachments.length,
      panels: [...session.panels.stack],
    };
  });
}

const mainQuestsDone = (page: Page): Promise<number> => page.evaluate(() => {
  const { session } = (window as unknown as { portage: { session: any } }).portage;
  const order = ['bail_out', 'first_haul', 'stop_the_leak', 'something_to_eat', 'a_proper_edge', 'ribs_and_rails', 'steady_now',
    'the_bellkeeper', 'catch_the_wind', 'voices', 'through_the_narrows', 'the_beacon'];
  return order.filter((questId) => session.game.quests[questId].status === 'completed').length;
});

test('the bot plays the live session to the Beacon', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

  await page.goto(`${BASE}/?bot=1&speed=${SPEED}&fps=1`);
  await page.waitForFunction(() => (window as unknown as { portage?: { session: { game: unknown } } }).portage?.session.game != null);

  const rates: number[] = [];
  const work: number[] = [];
  const log: string[] = [];
  for (const target of [1, 3, 6, 9, 11, 12]) {
    await expect.poll(async () => {
      const now = await progress(page);
      if (now.framesPerSecond > 0) {
        rates.push(now.framesPerSecond);
        work.push(now.workMilliseconds);
      }
      return mainQuestsDone(page);
    }, { timeout: 600_000, intervals: [1000] }).toBeGreaterThanOrEqual(target);
    await page.waitForTimeout(400);
    const now = await progress(page);
    log.push(`quest ${target} done at ${now.playedMinutes.toFixed(1)} min: hull ${now.hullTier}, ${now.attachments} attachments, `
      + `${now.fails} fails, ${now.framesPerSecond} fps, ${now.workMilliseconds} ms work`);
    await page.screenshot({ path: `${SHOTS}/bot-quest-${String(target).padStart(2, '0')}.png` });
  }

  const end = await progress(page);
  console.log(log.join('\n'));
  console.log(`replay speed x${SPEED}; fps samples ${rates.length}: lowest ${Math.min(...rates)}, `
    + `median ${[...rates].sort((first, second) => first - second)[Math.floor(rates.length / 2)]}; `
    + `work per frame highest ${Math.max(...work)} ms`);
  console.log(`end: ${end.botStatus} | ${end.playedMinutes.toFixed(1)} min played | panels ${end.panels.join(',')}`);

  expect(end.beaconLit).toBe(true);
  expect(end.fails).toBe(0);
  expect(end.hullTier).toBe(3);
  expect(end.panels).toEqual(['credits']); // the credits came up when the Beacon was lit
  expect(end.playedMinutes).toBeGreaterThan(80);
  // Other pages share this Mac's graphics chip while the test runs, so one slow sample proves nothing.
  // The slowest 5% may dip below 50. Nothing may fall below 30.
  const slowestFirst = [...rates].sort((first, second) => first - second);
  expect(slowestFirst[Math.floor(slowestFirst.length * 0.05)]).toBeGreaterThanOrEqual(50);
  expect(slowestFirst[0]).toBeGreaterThanOrEqual(30);
  expect(problems).toEqual([]);
});
