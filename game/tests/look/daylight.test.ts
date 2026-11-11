/**
 * The time-of-day palette: day is B2 exactly and holds still, night and dusk
 * are their own palettes, and nothing jumps between them.
 */
import { describe, expect, it } from 'vitest';
import { DAY, DUSK, NIGHT, daylightAt, hex, mistDensity, overcastFor, paletteAt } from '../../src/look/daylight.ts';
import type { Palette, Rgb } from '../../src/look/daylight.ts';

const COLOURS = ['light', 'shadowTint', 'paper', 'fog', 'skyTop', 'skyLow', 'cloud', 'cloudLight', 'sun', 'farTint', 'waterDeep', 'waterMid', 'waterPale', 'inkBlue', 'foam'] as const;
const brightness = (colour: Rgb): number => colour[0] * 0.3 + colour[1] * 0.5 + colour[2] * 0.2;

describe('time-of-day palette', () => {
  it('is B2, number for number, at noon under a clear sky', () => {
    expect(paletteAt(12, 0)).toEqual(DAY);
    // B2's constants, from art-r1/b2/src/palette.js.
    expect(DAY.fog).toEqual(hex('#e0e2d8'));
    expect(DAY.shadowTint).toEqual(hex('#8e97b6'));
    expect(DAY.waterDeep).toEqual(hex('#587b90'));
    expect(DAY.light).toEqual([1, 1, 1]);
  });

  it('holds flat through the day, so nothing drifts while you play', () => {
    for (const hour of [7, 8.5, 11, 15, 19.5]) expect(paletteAt(hour, 0)).toEqual(DAY);
  });

  it('is the night palette at midnight and darker than the day', () => {
    expect(paletteAt(0, 0)).toEqual(NIGHT);
    expect(paletteAt(23.5, 0)).toEqual(NIGHT);
    expect(brightness(NIGHT.light)).toBeLessThan(0.5 * brightness(DAY.light));
    expect(brightness(NIGHT.skyTop)).toBeLessThan(0.3 * brightness(DAY.skyTop));
    // Readable: the lit wash keeps a fair share of its colour.
    expect(brightness(NIGHT.light)).toBeGreaterThan(0.3);
  });

  it('warms toward dusk at the middle of dawn and of dusk', () => {
    const dawn = paletteAt(6, 0);
    const dusk = paletteAt(20.75, 0);
    for (const palette of [dawn, dusk]) expect(palette.skyLow[0] - palette.skyLow[2]).toBeGreaterThan(DAY.skyLow[0] - DAY.skyLow[2]);
    expect(DUSK.light[0]).toBeGreaterThan(DUSK.light[2]);
  });

  it('never jumps: a minute of game time moves no colour by more than 3%', () => {
    let previous: Palette = paletteAt(0, 0);
    for (let minute = 1; minute <= 24 * 60; minute += 1) {
      const palette = paletteAt(minute / 60, 0);
      for (const key of COLOURS) for (let channel = 0; channel < 3; channel += 1) expect(Math.abs(palette[key][channel] - previous[key][channel])).toBeLessThan(0.03);
      previous = palette;
    }
  });

  it('keeps every colour in range and every direction a unit vector, in any weather', () => {
    for (let hour = 0; hour < 24; hour += 0.5) {
      for (const cover of [0, 0.5, 1]) {
        const palette = paletteAt(hour, cover);
        for (const key of COLOURS) for (const channel of palette[key]) expect(channel).toBeGreaterThanOrEqual(0), expect(channel).toBeLessThanOrEqual(1);
        expect(Math.hypot(...palette.lightDirection)).toBeCloseTo(1, 6);
        expect(palette.lightDirection[1]).toBeGreaterThan(0.2);
      }
    }
  });

  it('greys the day under cloud and hides the sun', () => {
    const clear = paletteAt(12, 0);
    const storm = paletteAt(12, overcastFor('storm', 1));
    expect(storm.sunGlow).toBeLessThan(0.2);
    expect(brightness(storm.light)).toBeLessThan(brightness(clear.light));
    expect(overcastFor('clear', 0)).toBe(0);
  });

  it('follows the rules engine: night by 22:00, day by 07:00', () => {
    expect(daylightAt(22)).toBe(0);
    expect(daylightAt(5)).toBe(0);
    expect(daylightAt(7)).toBe(1);
    expect(daylightAt(19.5)).toBe(1);
  });

  it('thickens the mist as visibility falls', () => {
    expect(mistDensity(220)).toBeGreaterThan(mistDensity(900));
    // 90% hidden at the visibility distance.
    expect(1 - Math.exp(-900 * mistDensity(900))).toBeCloseTo(0.9, 6);
  });
});
