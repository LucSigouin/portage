/**
 * The weather and the lights, as numbers: every one of them comes from the
 * rules' state, eases without a clock of its own, and stands still when the
 * paint time does.
 */
import { describe, expect, it } from 'vitest';
import { ISLANDS, TUNING, WAVE_TABLE, WEATHER, WEATHER_KINDS } from '../../src/data/index.ts';
import { createDefaultSettings } from '../../src/settings/index.ts';
import { createGame } from '../../src/sim/index.ts';
import type { WeatherState } from '../../src/sim/index.ts';
import { WAVE_CHOP } from '../../src/look/b2/waves.js';
import { bankColourAt, paletteAt, rainInkAt } from '../../src/look/daylight.ts';
import { CAMP_FIRES, LAMP_KINDS, LAMP_SLOTS, beaconPoint, lampsOf, poolLamps } from '../../src/look/lamps.ts';
import { LADDER, qualityAt, qualityCeiling } from '../../src/look/quality.ts';
import { RAIN_BOX, advanceRain, strokeLength } from '../../src/look/rain.ts';
import {
  STEADY_RAIN, aheadFor, easeWeather, lampShareAt, rainFor, rainVelocity, starsAt, weatherGoals, wetFor,
} from '../../src/look/weather.ts';

const weather = (changes: Partial<WeatherState> = {}): WeatherState => ({
  kind: 'clear', secondsRemaining: 300, nextKind: 'rain', nextSeconds: 300, stormLevel: 0, windDirection: 0, windSpeed: 3, windTarget: 3,
  stormWarned: false, changesSinceStorm: 0, ...changes,
});
const brightness = (colour: readonly [number, number, number]): number => colour[0] * 0.3 + colour[1] * 0.5 + colour[2] * 0.2;

describe('the weather the look draws', () => {
  it('rains only when the rules say so, and harder as the storm builds', () => {
    for (const kind of WEATHER_KINDS) expect(rainFor(kind, 0) > 0).toBe(WEATHER[kind].rain);
    expect(rainFor('rain', 0)).toBe(STEADY_RAIN);
    expect(rainFor('storm', 0.5)).toBeGreaterThan(rainFor('storm', 0));
    expect(rainFor('storm', 1)).toBe(1);
    expect(weatherGoals(weather({ kind: 'storm', stormLevel: 0.4 }), false).storm).toBe(0.4);
  });

  it('closes the air in fog and keeps the Beacon\'s fog wall as it was', () => {
    expect(weatherGoals(weather({ kind: 'fog' }), false).veil).toBe(1);
    for (const kind of ['clear', 'rain', 'storm'] as const) expect(weatherGoals(weather({ kind }), false).veil).toBe(0);
    expect(weatherGoals(weather({ kind: 'fog' }), false).visibility).toBe(WEATHER.fog.visibility);
    // The fog wall: 35% of the weather's visibility, as before this round.
    expect(weatherGoals(weather(), true).visibility).toBeCloseTo(WEATHER.clear.visibility * 0.35, 6);
    expect(weatherGoals(weather(), true).veil).toBe(0);
  });

  it('blows the way the rules\' wind blows, at its speed', () => {
    const east = weatherGoals(weather({ windDirection: Math.PI / 2, windSpeed: 8 }), false);
    expect(east.windX).toBeCloseTo(8, 6);
    expect(east.windZ).toBeCloseTo(0, 6);
    const fall = rainVelocity({ ...east, storm: 1 });
    expect(fall[0]).toBeGreaterThan(0);
    expect(fall[1]).toBeLessThan(0);
    // A stroke moves a small part of its own length in a frame: it slides, it never jumps.
    expect((Math.hypot(...fall) / 60) / strokeLength(1)).toBeLessThan(0.15);
    expect((Math.hypot(...rainVelocity({ ...east, storm: 0 })) / 60) / strokeLength(0)).toBeLessThan(0.15);
  });

  it('shows what is coming only when it differs, and nearer as its time comes', () => {
    const warning = TUNING.weather.stormWarningSeconds;
    expect(aheadFor(weather({ nextKind: 'clear' }))).toBe(0);
    expect(aheadFor(weather({ nextKind: 'storm', secondsRemaining: warning + 1 }))).toBe(0);
    const far = aheadFor(weather({ nextKind: 'storm', secondsRemaining: warning * 0.8 }));
    const near = aheadFor(weather({ nextKind: 'storm', secondsRemaining: warning * 0.2 }));
    expect(far).toBeGreaterThan(0);
    expect(near).toBeGreaterThan(far);
    expect(aheadFor(weather({ nextKind: 'storm', secondsRemaining: 0 }))).toBe(1);
    const goal = weatherGoals(weather({ nextKind: 'storm', secondsRemaining: 10 }), false);
    expect([goal.aheadStorm, goal.aheadRain, goal.aheadFog, goal.aheadClear]).toEqual([1, 0, 0, 0]);
    // A storm's bank is darker than rain's, and a clearing is lighter than either.
    const [storm, rain, clear] = [bankColourAt(12, 1, 0, 0, 0), bankColourAt(12, 0, 1, 0, 0), bankColourAt(12, 0, 0, 0, 1)].map(brightness);
    expect(storm).toBeLessThan(rain - 0.1);
    expect(clear).toBeGreaterThan(rain + 0.1);
  });

  it('eases toward the rules\' weather, and does not move while the paint time stands still', () => {
    const now = weatherGoals(weather(), false);
    const goal = weatherGoals(weather({ kind: 'storm', stormLevel: 1, windSpeed: 10, windDirection: 2 }), false);
    const before = { ...now };
    easeWeather(now, goal, 0, false);
    expect(now).toEqual(before);
    easeWeather(now, goal, 1 / 60, false);
    expect(now.rain).toBeGreaterThan(0);
    expect(now.rain).toBeLessThan(0.02);
    for (let frame = 0; frame < 60 * 40; frame += 1) easeWeather(now, goal, 1 / 60, false);
    expect(now.rain).toBeCloseTo(1, 3);
    easeWeather(before, goal, 0, true);
    expect(before).toEqual(goal);
  });

  it('brings out the stars on a clear night only, and the lamps by night and under a storm', () => {
    const clear = weatherGoals(weather(), false);
    const storm = weatherGoals(weather({ kind: 'storm', stormLevel: 1 }), false);
    const fog = weatherGoals(weather({ kind: 'fog' }), false);
    expect(starsAt(0, clear)).toBe(1);
    expect(starsAt(12, clear)).toBe(0);
    expect(starsAt(0, storm)).toBe(0);
    expect(starsAt(0, fog)).toBe(0);
    expect(lampShareAt(12, clear)).toBe(0);
    expect(lampShareAt(0, clear)).toBe(1);
    expect(lampShareAt(12, storm)).toBeGreaterThan(0.3);
    expect(lampShareAt(12, storm)).toBeLessThan(0.5);
    expect(wetFor(clear)).toBe(0);
    expect(wetFor(weatherGoals(weather({ kind: 'rain' }), false))).toBe(1);
  });

  it('keeps the rain inside its box, and a paused game holds it still', () => {
    const shift: [number, number, number] = [1, 2, 3];
    advanceRain(shift, [3, -8, 2], 0);
    expect(shift).toEqual([1, 2, 3]);
    for (let frame = 0; frame < 6000; frame += 1) advanceRain(shift, [3, -8, 2], 1 / 60);
    shift.forEach((value, axis) => {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(RAIN_BOX[axis]);
    });
  });

  it('darkens the sky and the water in a storm, and keeps the foam bright', () => {
    const [grey, storm] = [paletteAt(12, 0.9, 0), paletteAt(12, 0.9, 1)];
    for (const key of ['skyTop', 'skyLow', 'cloud', 'waterDeep', 'waterMid', 'light'] as const) expect(brightness(storm[key])).toBeLessThan(brightness(grey[key]) - 0.05);
    expect(storm.foam).toEqual(grey.foam);
    expect(paletteAt(12, 0, 0)).toEqual(paletteAt(12, 0));
    // The rain's pen is dark on a grey day and pale at night, where dark ink would not show.
    expect(brightness(rainInkAt(12, 0.65, 0).ink)).toBeLessThan(0.3);
    expect(brightness(rainInkAt(0, 0.65, 0).ink)).toBeGreaterThan(brightness(paletteAt(0, 0.65).waterMid) + 0.15);
  });

  it('measures crests against the rules\' own wave table: its chop, every wave but the longest', () => {
    // The longest wave has the smallest wavenumber, and it is the table's first.
    expect(WAVE_TABLE[0].wavenumber).toBe(Math.min(...WAVE_TABLE.map((wave) => wave.wavenumber)));
    expect(WAVE_CHOP).toBeCloseTo(WAVE_TABLE.slice(1).reduce((sum, wave) => sum + wave.amplitude, 0), 6);
  });
});

describe('the lights', () => {
  const state = createGame(7);
  const aboard = { lantern: [0, 1.5, 0] as const, firebox: [0, 0.4, 1] as const };
  const burning = (lamps: ReturnType<typeof lampsOf>): string[] => lamps.filter((lamp) => lamp.strength > 0).map((lamp) => `${lamp.reach}`);

  it('lights the lantern by the canoe\'s own flag, and only with the mast fitted', () => {
    const fitted = { ...state, canoe: { ...state.canoe, attachments: ['lantern_mast' as const], lanternLit: false } };
    expect(lampsOf(fitted, aboard)[0].strength).toBe(0);
    expect(lampsOf({ ...fitted, canoe: { ...fitted.canoe, lanternLit: true } }, aboard)[0].strength).toBe(1);
    expect(lampsOf({ ...fitted, canoe: { ...fitted.canoe, lanternLit: true, attachments: [] } }, aboard)[0].strength).toBe(0);
    expect(lampsOf({ ...fitted, canoe: { ...fitted.canoe, lanternLit: true } }, { ...aboard, lantern: null })[0].strength).toBe(0);
  });

  it('burns the firebox whenever it is fitted, the Beacon by its flag, and a fire at every camp', () => {
    expect(lampsOf(state, aboard)[1].strength).toBe(0);
    expect(lampsOf({ ...state, canoe: { ...state.canoe, attachments: ['firebox'] } }, aboard)[1].strength).toBe(1);
    expect(lampsOf(state, aboard)[2].strength).toBe(0);
    const lit = lampsOf({ ...state, flags: { ...state.flags, beacon_lit: true } }, aboard);
    expect(lit[2].strength).toBe(1);
    expect(lit[2].position).toEqual(beaconPoint());
    expect(CAMP_FIRES.length).toBe(ISLANDS.filter((island) => island.camp).length);
    expect(burning(lampsOf(state, aboard))).toEqual(CAMP_FIRES.map(() => `${LAMP_KINDS.campfire.reach}`));
  });

  it('throws four pools at most: the canoe\'s two, the Beacon, and the nearest camp fire', () => {
    const lamps = lampsOf(state, aboard);
    const home = CAMP_FIRES.find((fire) => Math.abs(fire[0] - 2.9) < 1 && Math.abs(fire[2] - 1127) < 1)!;
    expect(home).toBeDefined();
    const pools = poolLamps(lamps, 0, 1150);
    expect(pools.length).toBe(LAMP_SLOTS);
    expect(pools[3].position).toEqual(home);
    expect(poolLamps(lamps, 0, -1200)[3].position).not.toEqual(home);
    // The lantern reaches furthest of what the crew carries: it is the one that makes a night easy.
    expect(LAMP_KINDS.lantern.reach).toBeGreaterThan(LAMP_KINDS.firebox.reach * 3);
  });
});

describe('the ladder and the weather', () => {
  it('sheds the weather\'s fine work on its first rung, and nothing else of the world there', () => {
    const ceiling = qualityCeiling(createDefaultSettings().graphics);
    expect(Object.keys(LADDER[1])).toEqual(['weather']);
    expect(qualityAt(ceiling, 1)).toEqual({ ...ceiling, weather: 0 });
    for (let rung = 2; rung < LADDER.length; rung += 1) expect(qualityAt(ceiling, rung).weather).toBe(0);
  });
});
