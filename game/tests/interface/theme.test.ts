/**
 * The theme's promises, read straight from the stylesheet: every ink that
 * carries words passes WCAG AA on the paper it is written on, nothing loops,
 * and nothing is fetched from another site.
 */
import { describe, expect, it } from 'vitest';

// The project has no Node type definitions, so the file reader is loaded by name at run time.
const fileSystemModule = 'node:fs';
const { readFileSync, existsSync } = await import(/* @vite-ignore */ fileSystemModule) as {
  readFileSync: (path: URL, encoding: 'utf8') => string;
  existsSync: (path: URL) => boolean;
};
const sourceAddress = (name: string): URL => new URL(`../../src/interface/${name}`, import.meta.url);
const read = (name: string): string => readFileSync(sourceAddress(name), 'utf8');
const theme = read('theme.css');
const fonts = read('fonts.css');

function token(name: string): string {
  const match = new RegExp(`--iw-${name}:\\s*(#[0-9a-fA-F]{6});`).exec(theme);
  if (!match) throw new Error(`theme.css has no colour --iw-${name}`);
  return match[1]!;
}

function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(first: string, second: string): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((one, other) => other - one) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe('the Ink & Wash theme', () => {
  // Each ink, and every ground it is written on.
  const pairs: [ink: string, ground: string][] = [
    ['ink', 'paper'], ['ink', 'paper-deep'], ['ink', 'paper-bright'], ['ink', 'chart'], ['ink', 'ochre'],
    ['ink-soft', 'paper'], ['ink-soft', 'paper-deep'], ['ink-soft', 'paper-bright'],
    ['rust-deep', 'paper'], ['rust-deep', 'paper-bright'], ['ochre-deep', 'paper'], ['sage-deep', 'paper'],
    ['paper', 'rust-fill'],
  ];

  it.each(pairs)('%s on %s passes WCAG AA for body text (4.5 to 1)', (ink, ground) => {
    expect(contrast(token(ink), token(ground))).toBeGreaterThanOrEqual(4.5);
  });

  it('the focus ring stands out from the paper (3 to 1)', () => {
    expect(contrast(token('rust-deep'), token('paper'))).toBeGreaterThanOrEqual(3);
    expect(theme).toMatch(/\.iw :focus-visible,\s*\.iw\.iw-by-keys :focus \{\s*outline: 0\.15rem solid var\(--iw-rust-deep\)/);
  });

  it('never dims words: no opacity on anything but washes, an away crewmate\'s toque and meters, the dimmed lobby and unseen inputs', () => {
    const dimmed = [...theme.matchAll(/([^{}]+)\{[^{}]*?\bopacity:\s*([\d.]+)/g)]
      .map((match) => ({ selector: match[1]!.trim().split('\n').pop()!.trim(), opacity: Number(match[2]) }))
      .filter((rule) => rule.opacity < 1)
      .map((rule) => rule.selector);
    expect(dimmed.sort()).toEqual([
      '.iw-bar i', '.iw-ico .iw-wash', '.iw-lobby.iw-dim .iw-lobby-col', '.iw-lobby::after', '.iw-logo-row .iw-seal-holder',
      '.iw-tg input', '.iw-tk', '.iw-tk.iw-big', '.iw-mate.iw-away .iw-mate-meters',
    ].sort());
  });

  it('has no animation that runs by itself: no keyframes, no animation property', () => {
    expect(theme).not.toMatch(/@keyframes/);
    expect(theme).not.toMatch(/\banimation(-name)?\s*:/);
    // Transitions answer the pointer or a key, and each is short.
    const durations = [...theme.matchAll(/transition:[^;]*?([\d.]+)s/g)].map((match) => Number(match[1]));
    expect(durations.length).toBeGreaterThan(0);
    for (const seconds of durations) expect(seconds).toBeLessThanOrEqual(0.25);
  });

  it('has the five short transitions that answer the pointer or a key, and no other', () => {
    // A menu line's mark and underline, a button's lift on hover, a tick box's tick. Anything new that slides,
    // fades or turns would be added here, on purpose, or fail. (The last rule turns them all off for reduced motion.)
    const rules = [...theme.matchAll(/([^{}]+)\{[^{}]*?\btransition:\s*([^;]+);/g)]
      .map((match) => `${match[1]!.trim().split('\n').pop()!.trim()} → ${match[2]!.trim()}`);
    expect(rules).toEqual([
      '.iw .iw-mi → transform 0.18s ease',
      '.iw-mi::before → transform 0.2s ease',
      '.iw-mi::after → transform 0.25s ease',
      '.iw .iw-btn → transform 0.15s',
      '.iw-tg .iw-tick → stroke-dashoffset 0.22s ease',
      '.iw *::after → none !important',
    ]);
  });

  it('the pen wobble is a fixed filter: one seed each, nothing animated', () => {
    const icons = read('icons.ts');
    expect(icons).not.toMatch(/<animate|<set |dur=/);
    expect((icons.match(/feTurbulence/g) ?? []).length).toBe((icons.match(/seed="\d+"/g) ?? []).length);
  });

  it('fetches nothing from another site', () => {
    for (const sheet of [theme, fonts]) {
      expect(sheet).not.toMatch(/https?:\/\//);
      expect(sheet).not.toMatch(/@import/);
    }
    const faces = [...fonts.matchAll(/url\('([^']+)'\)/g)].map((match) => match[1]!);
    expect(faces.length).toBe(4);
    for (const face of faces) {
      expect(face.startsWith('./fonts/')).toBe(true);
      expect(existsSync(sourceAddress(face.slice(2)))).toBe(true);
    }
  });
});
