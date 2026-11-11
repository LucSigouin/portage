import { describe, expect, it } from 'vitest';
import { TUNING, WEATHER, WEATHER_KINDS } from '../src/data/index.ts';
import { selectCanoeStats, selectWeather } from '../src/sim/index.ts';
import type { GameEvent, GameState } from '../src/sim/index.ts';
import { updateWeather } from '../src/sim/weather.ts';
import { build, countIn, newGame, run, standOn } from './support.ts';

/** Run only the weather for a number of seconds and collect what it emitted. */
function forecast(state: GameState, seconds: number): { kinds: string[]; events: GameEvent[] } {
  const kinds: string[] = [];
  state.events = [];
  for (let second = 0; second < seconds; second += 1) updateWeather(state, 1);
  for (const event of state.events) if (event.type === 'weather_changed') kinds.push(event.kind);
  return { kinds, events: state.events };
}

describe('weather', () => {
  it('has the four kinds of the brief, and only the storm adds roughness', () => {
    expect(WEATHER_KINDS).toEqual(['clear', 'fog', 'rain', 'storm']);
    expect(WEATHER_KINDS.map((kind) => WEATHER[kind].roughnessBonus)).toEqual([0, 0, 0, 1]);
    expect(WEATHER_KINDS.filter((kind) => WEATHER[kind].rain)).toEqual(['rain', 'storm']);
  });

  it('never storms before the first outrigger, on any seed', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const state = newGame(seed);
      const { kinds } = forecast(state, 6 * TUNING.time.daySeconds);
      expect(kinds.length).toBeGreaterThan(15);
      expect(kinds).not.toContain('storm');
    }
  });

  it('storms once an outrigger is built, never back to back', () => {
    let storms = 0;
    for (let seed = 1; seed <= 6; seed += 1) {
      const state = newGame(seed);
      build(state, 'outrigger_port');
      const { kinds } = forecast(state, 10 * TUNING.time.daySeconds);
      storms += kinds.filter((kind) => kind === 'storm').length;
      const positions = kinds.map((kind, index) => (kind === 'storm' ? index : -1)).filter((index) => index >= 0);
      for (let index = 1; index < positions.length; index += 1) {
        expect(positions[index] - positions[index - 1]).toBeGreaterThan(TUNING.weather.changesBetweenStorms);
      }
      for (let index = 1; index < kinds.length; index += 1) expect(kinds[index]).not.toBe(kinds[index - 1]);
    }
    expect(storms).toBeGreaterThan(6);
  });

  it('shows what is coming and warns 90 seconds before a storm', () => {
    const state = newGame(3);
    build(state, 'outrigger_port');
    state.weather.nextKind = 'storm';
    state.weather.nextSeconds = 200;
    state.weather.secondsRemaining = 120;
    expect(selectWeather(state)).toMatchObject({ kind: 'clear', nextKind: 'storm', secondsUntilChange: 120 });
    const early = forecast(state, 25);
    expect(early.events.some((event) => event.type === 'storm_warning')).toBe(false);
    const late = forecast(state, 10);
    expect(late.events.filter((event) => event.type === 'storm_warning')).toHaveLength(1);
    const arrival = forecast(state, 90);
    expect(arrival.kinds).toEqual(['storm']);
  });

  it('eases a storm in over 45 seconds, adds 1 roughness at full strength, and eases it out', () => {
    const state = newGame(3);
    build(state, 'outrigger_port');
    state.weather.nextKind = 'storm';
    state.weather.nextSeconds = 200;
    state.weather.secondsRemaining = 1;
    forecast(state, 1);
    expect(state.weather.kind).toBe('storm');
    expect(state.weather.stormLevel).toBeLessThan(0.05);
    forecast(state, 22);
    expect(state.weather.stormLevel).toBeCloseTo(0.5, 1);
    forecast(state, 30);
    expect(state.weather.stormLevel).toBe(1);
    expect(selectCanoeStats(state).roughnessHere).toBe(2); // the Shallows, 1 + 1
    expect(state.weather.windTarget).toBeGreaterThanOrEqual(8);
    forecast(state, 148 + 20);
    expect(state.weather.kind).not.toBe('storm');
    expect(state.weather.stormLevel).toBeGreaterThan(0.4);
    forecast(state, 30);
    expect(state.weather.stormLevel).toBe(0);
  });

  it('eases the wind instead of snapping it', () => {
    const state = newGame(5);
    state.weather.windSpeed = 1;
    state.weather.windTarget = 9;
    state.weather.secondsRemaining = 9999;
    forecast(state, 10);
    expect(state.weather.windSpeed).toBeCloseTo(1 + TUNING.weather.windEasePerSecond * 10, 6);
  });
});

describe('weather and attachments', () => {
  it('turns rain into clean water with the rain catcher', () => {
    const state = newGame(4);
    state.canoe.hullTier = 2;
    standOn(state, 'home_knoll');
    build(state, 'rain_catcher');
    state.weather.kind = 'rain';
    state.weather.secondsRemaining = 9999;
    const events = run(state, {}, TUNING.canoe.rainCatcherSecondsPerWater * 3 + 1);
    expect(countIn(state.canoe.cargo, 'clean_water')).toBe(3);
    expect(events.filter((event) => event.type === 'rain_collected')).toHaveLength(3);
    state.weather.kind = 'clear';
    run(state, {}, 120);
    expect(countIn(state.canoe.cargo, 'clean_water')).toBe(3);
  });

  it('fishes with the rig while beached and plants berries and roots each morning', () => {
    const state = newGame(4);
    state.canoe.hullTier = 2;
    standOn(state, 'home_knoll');
    build(state, 'fishing_rig', 'planter');
    run(state, {}, TUNING.canoe.fishingRigSecondsPerFish * 2 + 1);
    expect(countIn(state.canoe.cargo, 'raw_fish')).toBe(2);
    state.time = 2 * TUNING.time.daySeconds + 6 * 60 - 5; // five seconds before dawn
    const events = run(state, {}, 10);
    expect(events.some((event) => event.type === 'planter_harvested')).toBe(true);
    expect(countIn(state.canoe.cargo, 'berries')).toBe(TUNING.canoe.planterBerries);
    expect(countIn(state.canoe.cargo, 'cattail_root')).toBe(TUNING.canoe.planterRoots);
  });
});
