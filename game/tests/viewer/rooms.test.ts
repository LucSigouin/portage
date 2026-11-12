/**
 * The workshop's top bar: on the dev server it links to the dev server's tools; a published copy stands
 * alone beside the live game.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('the top bar', () => {
  it('on the dev server links to the sound lab, the readout and the game at this site\'s root', async () => {
    const { ROOMS, SCREENS, TOOLS } = await import('../../src/viewer/rooms.ts');
    expect(ROOMS[0]!.href).toBe('/viewer.html');
    expect(TOOLS.map((tool) => tool.href)).toEqual(['/audio-lab.html', '/?perf=1']);
    expect(SCREENS.length).toBeGreaterThan(10);
    expect(SCREENS.every((screen) => screen.href.startsWith('/?shot='))).toBe(true);
  });

  it('as a published copy is its own front page, drops the dev-only tools, and opens screens in the live game', async () => {
    vi.stubEnv('VITE_PORTAGE_GAME', '/portage/');
    vi.resetModules();
    const { ROOMS, SCREENS, TOOLS } = await import('../../src/viewer/rooms.ts');
    expect(ROOMS[0]!.href).toBe('./');
    expect(TOOLS).toEqual([]);
    expect(SCREENS.length).toBeGreaterThan(10);
    expect(SCREENS.every((screen) => screen.href.startsWith('/portage/?shot='))).toBe(true);
  });
});
