/** The master review of round 4, finding 9: the interact key reads a bench prompt's station off its own type. */
import { describe, expect, it } from 'vitest';

const fileSystemModule = 'node:fs';
const { readFileSync } = await import(/* @vite-ignore */ fileSystemModule) as { readFileSync(path: URL, encoding: 'utf8'): string };

describe('the input code', () => {
  it('needs no cast to read the station of a bench prompt', () => {
    const source = readFileSync(new URL('../../src/client/input.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/interactable as \{/);
    expect(source).toContain("station: snapshot.interactable.station ?? 'bench'");
  });
});
