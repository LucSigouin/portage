import { describe, expect, it } from 'vitest';
import { MAIN_QUESTS } from '../src/data/index.ts';
import { BOT_SEED, HUMAN_TIME_FACTOR, formatReport, runBot } from '../src/bot/bot.ts';
import type { BotReport } from '../src/bot/bot.ts';

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
  it('plays the main line to the Beacon on Standard without a single fail, in 90 to 180 minutes', () => {
    const report = runBot({ seed: SEED, difficulty: 'standard' });
    console.log(`\n${formatReport(report)}\n`);
    expectCleanRun(report);
    const minutes = report.totalSeconds / 60;
    expect(minutes).toBeGreaterThanOrEqual(90);
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
    expect(mean).toBeGreaterThanOrEqual(90);
    expect(mean).toBeLessThanOrEqual(180);
    for (const value of minutes) {
      expect(value).toBeGreaterThan(80);
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
