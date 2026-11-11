import { describe, expect, it } from 'vitest';

const simulation = import.meta.glob('../src/sim/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const data = import.meta.glob('../src/data/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Source with comments and string literals removed, so prose cannot trip the checks. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

const FORBIDDEN: [RegExp, string][] = [
  [/\bMath\.random\b/, 'Math.random'],
  [/\bDate\b/, 'Date'],
  [/\bperformance\b/, 'performance'],
  [/\bdocument\b/, 'document'],
  [/\bwindow\b/, 'window'],
  [/\bnavigator\b/, 'navigator'],
  [/\blocalStorage\b/, 'localStorage'],
  [/\brequestAnimationFrame\b/, 'requestAnimationFrame'],
  [/\bsetTimeout\b|\bsetInterval\b/, 'timers'],
  [/\bfetch\b/, 'fetch'],
];

describe('the simulation is pure', () => {
  it('finds the sources', () => {
    expect(Object.keys(simulation).length).toBeGreaterThanOrEqual(14);
    expect(Object.keys(data).length).toBeGreaterThanOrEqual(10);
  });

  it('uses no clock, no Math.random, no DOM', () => {
    for (const [path, source] of Object.entries({ ...simulation, ...data })) {
      const stripped = code(source);
      for (const [pattern, name] of FORBIDDEN) expect(pattern.test(stripped), `${path} uses ${name}`).toBe(false);
    }
  });

  it('imports nothing but itself and the data tables', () => {
    for (const [path, source] of Object.entries(simulation)) {
      for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
        expect(match[1], `${path} imports ${match[1]}`).toMatch(/^(\.\/|\.\.\/data\/)[a-z]+\.ts$/);
      }
    }
    for (const [path, source] of Object.entries(data)) {
      for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
        expect(match[1], `${path} imports ${match[1]}`).toMatch(/^\.\/[a-z]+\.ts$/);
      }
    }
  });

  it('exposes one public entry point with doc comments', () => {
    const index = simulation['../src/sim/index.ts'];
    expect(index).toContain('export { createGame, step, drainEvents, hashState');
    expect(index).toContain('export { dispatch }');
    expect(index.split('\n').filter((line) => line.startsWith(' *')).length).toBeGreaterThan(50);
  });
});
