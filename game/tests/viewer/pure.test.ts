/**
 * The viewer's pure parts: the address, the see-through maths, the grid's squares, the fixed views, and the rule that
 * the live game carries none of it.
 */
import { describe, expect, it } from 'vitest';
import { spacingFor, SPACINGS } from '../../src/viewer/grid.ts';
import { matte } from '../../src/viewer/matte.ts';
import { fromQuery, toQuery } from '../../src/viewer/state.ts';
import type { ViewerState } from '../../src/viewer/state.ts';

const fileSystemModule = 'node:fs';
const { readdirSync, readFileSync, statSync } = (await import(/* @vite-ignore */ fileSystemModule)) as {
  readdirSync(path: string): string[];
  readFileSync(path: string, encoding: 'utf8'): string;
  statSync(path: string): { isDirectory(): boolean };
};
const join = (...parts: string[]): string => parts.join('/').replace(/\/+/g, '/');
const relative = (from: string, to: string): string => to.slice(from.length + 1);
const GAME = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/\/$/, '');

const base: ViewerState = { thing: 'hull/long_canoe', options: { crew: '2', fitted: 'all' }, view: 'home', free: null, background: 'paper', grid: true, light: 'day' };

describe('the address', () => {
  it('round-trips the thing, the answers, the view, the ground, the background and the light', () => {
    const states: ViewerState[] = [
      base,
      { ...base, view: 'paddle' },
      { ...base, view: 'free', free: { yaw: 133.4, pitch: 41.2, distance: 7.125, aim: 'paddle' }, background: 'checker', grid: false, light: 'night' },
      { ...base, thing: 'island/home_knoll', options: {}, view: 'top', background: 'dark' },
    ];
    const defaults = { crew: '1', fitted: 'bare' };
    for (const state of states) {
      const back = fromQuery(`?${toQuery(state, state.thing === base.thing ? defaults : {})}`, 'x/y');
      expect(back, JSON.stringify(state)).toEqual(state);
    }
  });

  it('leaves defaults out, and falls back to them on nonsense', () => {
    expect(toQuery({ ...base, options: {} }, {})).toBe('thing=hull%2Flong_canoe');
    const odd = fromQuery('?thing=&view=sideways&yaw=abc&bg=neon&grid=0&light=dusk', 'first/one');
    expect(odd).toMatchObject({ thing: 'first/one', view: 'home', free: null, background: 'paper', grid: false, light: 'day' });
  });
});

describe('see-through', () => {
  it('a pixel covered fully keeps its colour, one not covered goes clear, a half-covered one is half', () => {
    // 3 pixels: solid red; nothing (the background shows through: black frame is black, white frame is white); a half-covering one.
    const black = new Uint8ClampedArray([200, 30, 20, 255, 0, 0, 0, 255, 100, 15, 10, 255]);
    const white = new Uint8ClampedArray([200, 30, 20, 255, 255, 255, 255, 255, 227, 142, 137, 255]);
    const out = new Uint8ClampedArray(12);
    matte(black, white, out);
    expect([...out.slice(0, 4)]).toEqual([200, 30, 20, 255]);
    expect(out[7]).toBe(0);
    expect(out[11]).toBeGreaterThan(120);
    expect(out[11]).toBeLessThan(135);
    expect(out[8]).toBeGreaterThan(190); // the colour is undone from the half cover: 100 / 0.5
    expect(out[8]).toBeLessThan(210);
  });
});

describe('the grid', () => {
  it('picks the finest square that keeps a thing within twelve of them', () => {
    expect(spacingFor(0.3)).toBe(0.05);
    expect(spacingFor(5)).toBe(0.5);
    expect(spacingFor(12)).toBe(1);
    expect(spacingFor(300)).toBe(25);
    expect(spacingFor(1e6)).toBe(SPACINGS[SPACINGS.length - 1]);
  });
});

/** Every file under a folder, as paths from `game/`. */
function filesUnder(folder: string): string[] {
  return readdirSync(folder).flatMap((name: string) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe('the live game carries none of it', () => {
  const root = GAME;
  it('nothing in the game imports the viewer, and index.html and the config never name it', () => {
    const offenders = filesUnder(join(root, 'src'))
      .filter((path) => !relative(join(root, 'src'), path).startsWith('viewer'))
      .filter((path) => /\.(ts|js|html|css)$/.test(path))
      .filter((path) => /from\s+['"][^'"]*viewer[^'"]*['"]|import\(\s*['"][^'"]*viewer/.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
    expect(readFileSync(join(root, 'index.html'), 'utf8')).not.toMatch(/viewer/i);
    expect(readFileSync(join(root, 'vite.config.ts'), 'utf8')).not.toMatch(/viewer/i);
  });

  it('the viewer is its own page, and the audio lab is kept apart the same way (neither is a build input)', () => {
    expect(readFileSync(join(root, 'viewer.html'), 'utf8')).toContain('/src/viewer/main.ts');
    expect(readFileSync(join(root, 'vite.config.ts'), 'utf8')).not.toMatch(/rollupOptions|audio-lab/);
  });
});
