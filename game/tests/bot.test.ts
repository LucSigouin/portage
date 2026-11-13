import { describe, expect, it } from 'vitest';
import { MAIN_QUESTS, TUNING } from '../src/data/index.ts';
import { BOT_SEED, CAREFUL, CARELESS, HUMAN_TIME_FACTOR, createBotDriver, formatReport, runBot } from '../src/bot/bot.ts';
import type { BotReport } from '../src/bot/bot.ts';
import { FIXED_STEP, createGame, drainEvents, step } from '../src/sim/index.ts';

const SEED = BOT_SEED;

function expectCleanRun(report: BotReport): void {
  expect(report.stoppedBecause).toBeNull();
  expect(report.completed).toBe(true);
  expect(report.state.flags.beacon_lit).toBe(true);
  expect(report.fails).toBe(0);
  expect(report.quests.map((quest) => quest.questId)).toEqual(MAIN_QUESTS.map((quest) => quest.id));
  for (const quest of report.quests) {
    expect(quest.fails, quest.name).toBe(0);
    expect(quest.lowestHunger, `${quest.name} hunger`).toBeGreaterThan(0);
    expect(quest.lowestThirst, `${quest.name} thirst`).toBeGreaterThan(0);
    expect(quest.lowestEnergy, `${quest.name} energy`).toBeGreaterThan(0);
    expect(quest.highestWaterLevel, `${quest.name} water`).toBeLessThan(100);
  }
  const times = report.quests.map((quest) => quest.completedAtSeconds);
  expect([...times].sort((first, second) => first - second)).toEqual(times); // quests finish in order
}

describe('the headless bot', () => {
  // The floor was 90 until the paddle speeds were raised (2026-11-12, Luc's call): crossings are shorter,
  // and so is a run.
  it('plays the main line to the Beacon on Standard without a single fail, in 65 to 180 minutes', () => {
    const report = runBot({ seed: SEED, difficulty: 'standard' });
    console.log(`\n${formatReport(report)}\n`);
    expectCleanRun(report);
    const minutes = report.totalSeconds / 60;
    expect(minutes).toBeGreaterThanOrEqual(65);
    expect(minutes).toBeLessThanOrEqual(180);
    // It really built the canoe up: both outriggers, sail, rudder, radio, lantern, long hull.
    expect(report.state.canoe.hullTier).toBe(3);
    for (const attachmentId of ['outrigger_port', 'outrigger_starboard', 'mast_sail', 'rudder', 'radio', 'lantern_mast'] as const) {
      expect(report.state.canoe.attachments, attachmentId).toContain(attachmentId);
    }
    expect(report.distancePaddled).toBeGreaterThan(5000);
    expect(HUMAN_TIME_FACTOR).toBeGreaterThan(1);
  });

  it('does it on other seeds too: different loot and weather, same result', () => {
    const minutes: number[] = [];
    for (const seed of [1, 2, 7, 20, 33]) {
      const report = runBot({ seed });
      expectCleanRun(report);
      minutes.push(report.totalSeconds / 60);
    }
    console.log(`other seeds, minutes of play: ${minutes.map((value) => value.toFixed(1)).join(', ')}`);
    // Weather moves a single run by a quarter of an hour either way; the average holds the target.
    const mean = minutes.reduce((sum, value) => sum + value, 0) / minutes.length;
    expect(mean).toBeGreaterThanOrEqual(65);
    expect(mean).toBeLessThanOrEqual(180);
    for (const value of minutes) {
      expect(value).toBeGreaterThan(55);
      expect(value).toBeLessThan(180);
    }
  });

  it('finishes on Relaxed as well', () => {
    expectCleanRun(runBot({ seed: SEED, difficulty: 'relaxed' }));
  });

  it('is repeatable: the same seed plays the same game', () => {
    const first = runBot({ seed: 5, untilQuest: 'steady_now' });
    const second = runBot({ seed: 5, untilQuest: 'steady_now' });
    expect(first.totalSeconds).toBe(second.totalSeconds);
    expect(first.state).toEqual(second.state);
  });
});

describe('a careless player', () => {
  it('is the same bot with worse habits, and the careful bot is the default', () => {
    expect(runBot({ seed: 5, untilQuest: 'stop_the_leak' }).state).toEqual(runBot({ seed: 5, untilQuest: 'stop_the_leak', habits: CAREFUL }).state);
    // Slow to eat and drink, late to bail, quick to spend energy, and given to lapses.
    expect(CARELESS.eatBelow).toBeLessThanOrEqual(TUNING.survival.lowMeterWarning);
    expect(CARELESS.drinkBelow).toBeLessThanOrEqual(TUNING.survival.lowMeterWarning);
    expect(CARELESS.bailAt).toBeGreaterThan(TUNING.canoe.swampWarningLevel);
    expect(CARELESS.bailUntil).toBeGreaterThan(CAREFUL.bailUntil);
    expect(CARELESS.powerUntil).toBeLessThan(TUNING.survival.lowMeterWarning);
    expect(CARELESS.hesitation).toBeGreaterThan(0);
    expect(CARELESS.detourEvery).toBeGreaterThan(0);
    expect(CARELESS.wanderEvery).toBeGreaterThan(0);
    expect(CARELESS.wasteEvery).toBeGreaterThan(0);
    expect(CARELESS.ignoresForecast).toBe(true);
  });

  it('still lights the Beacon on all six seeds: slower, under the warnings, failing now and then but never stuck', () => {
    const lines: string[] = [];
    let fails = 0;
    for (const seed of [BOT_SEED, 1, 2, 7, 20, 33]) {
      const report = runBot({ seed, habits: CARELESS, maximumSeconds: 6 * 3600 });
      expect(report.stoppedBecause, `seed ${seed}`).toBeNull();
      expect(report.completed, `seed ${seed}`).toBe(true);
      expect(report.quests.map((quest) => quest.questId)).toEqual(MAIN_QUESTS.map((quest) => quest.id));
      const minutes = report.totalSeconds / 60;
      const lowestEnergy = Math.min(...report.quests.map((quest) => quest.lowestEnergy));
      const lowestFed = Math.min(...report.quests.map((quest) => Math.min(quest.lowestHunger, quest.lowestThirst)));
      lines.push(`seed ${seed}: ${minutes.toFixed(1)} min, ${report.fails} fails, lowest energy ${lowestEnergy.toFixed(0)}, lowest hunger or thirst ${lowestFed.toFixed(0)}`);
      // It really played carelessly: its meters went under the warning line, where the careful bot's never go.
      expect(lowestEnergy, `seed ${seed} energy`).toBeLessThan(TUNING.survival.lowMeterWarning);
      expect(lowestFed, `seed ${seed} hunger and thirst`).toBeLessThan(TUNING.survival.lowMeterWarning);
      // It pays in time, not in a wall: under five hours, and a fail is an accident, not a habit.
      // Its runs swing with the weather it blunders into. Over thirty seeds it failed 0.6 to 0.8
      // times a run, 4 at the very worst, so the lines below are drawn well clear of that.
      expect(minutes, `seed ${seed} minutes`).toBeGreaterThan(70);
      expect(minutes, `seed ${seed} minutes`).toBeLessThan(300);
      expect(report.fails, `seed ${seed} fails`).toBeLessThanOrEqual(6);
      fails += report.fails;
    }
    console.log(`careless bot:\n${lines.join('\n')}`);
    expect(fails).toBeLessThanOrEqual(15);
  });

  it('is repeatable too: its lapses come from its own dice, seeded by the game', () => {
    const first = runBot({ seed: 5, untilQuest: 'a_proper_edge', habits: CARELESS });
    const second = runBot({ seed: 5, untilQuest: 'a_proper_edge', habits: CARELESS });
    expect(first.state).toEqual(second.state);
    expect(first.state).not.toEqual(runBot({ seed: 5, untilQuest: 'a_proper_edge' }).state);
  });
});

describe('the bot after a fail', () => {
  it('picks itself up: capsized mid-crossing, it wakes ashore, plans again and finishes the quest', () => {
    const state = createGame(BOT_SEED);
    const lines: string[] = [];
    // The first crossing: to Cabin Roofs for the hatchet head (bark no longer needs one: Home Knoll's birches give it).
    const driver = createBotDriver(state, { untilQuest: 'a_proper_edge', log: (line) => lines.push(line) });
    let swamped = false;
    for (let input = driver.next(); input !== null; input = driver.next()) {
      step(state, input, FIXED_STEP);
      drainEvents(state);
      // Out on the water between the islands, with the hull patched: fill it to the brim, once.
      if (!swamped && state.quests.a_proper_edge.status === 'active' && !state.canoe.beached
        && state.players[0].mode === 'canoe' && state.canoe.position.x < -120) {
        // Over the brim, so the can it is about to pick up cannot save it.
        state.canoe.waterLevel = TUNING.canoe.capsizeLevel + 5;
        swamped = true;
      }
      if (state.playedSeconds > 3600) break;
    }
    expect(swamped).toBe(true);
    expect(state.statistics.fails).toBe(1);
    expect(lines.some((line) => line.includes('washed ashore: picking up again'))).toBe(true);
    expect(driver.stoppedBecause).toBeNull();
    expect(state.quests.a_proper_edge.status).toBe('completed');
    expect(state.tools).toContain('hatchet');
  });
});

describe('the bot and the wild trees', () => {
  // Every tree and stone is a spot now (Luc's bugfix list, round 2), and the bot gathers from them as a player
  // would: Home Knoll's own birches give the bark, so the first crossing is for the hatchet head, not the bark.
  it('peels and scrapes the trees by its own camp for the leak, and never goes to Birch Islet for it', () => {
    const state = createGame(BOT_SEED);
    const driver = createBotDriver(state, { untilQuest: 'stop_the_leak' });
    const wild: string[] = [];
    const landedOn = new Set<string>();
    for (let input = driver.next(); input !== null; input = driver.next()) {
      step(state, input, FIXED_STEP);
      for (const event of drainEvents(state)) {
        if (event.type === 'node_depleted' && /\.(scatter|dressing)\./.test(event.nodeId)) wild.push(event.nodeId);
        if (event.type === 'landed' && event.islandId) landedOn.add(event.islandId);
      }
    }
    expect(driver.stoppedBecause).toBeNull();
    expect(state.quests.stop_the_leak.status).toBe('completed');
    expect(wild.length).toBeGreaterThan(0);
    expect(wild.every((nodeId) => nodeId.startsWith('home_knoll.'))).toBe(true);
    expect([...landedOn]).toEqual(['home_knoll']);
  });
});
