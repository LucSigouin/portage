/**
 * The arrival card as drawn (`interface/arrival.ts`, `arrival.css`): the words are written once and never touched,
 * only the stroke's and the seal's styles change, a still card is one drawing from start to end, and the
 * stylesheet holds no motion of its own.
 */
import { describe, expect, it } from 'vitest';
import { ARRIVAL, ARRIVAL_TOTAL, arrivalFrame, arrivalWords } from '../../src/client/viewmodels/arrival.ts';
import type { ArrivalModel } from '../../src/client/viewmodels/arrival.ts';
import { PLACES } from '../../src/data/index.ts';
import { arrivalView, brushStroke, sealStyle, strokeStyle } from '../../src/interface/arrival.ts';
import { collectIntents, collectText } from '../../src/interface/dom.ts';
import type { ViewNode } from '../../src/interface/dom.ts';

// The project has no Node type definitions, so the file reader is loaded by name at run time.
const fileSystemModule = 'node:fs';
const { readFileSync } = await import(/* @vite-ignore */ fileSystemModule) as { readFileSync: (path: URL, encoding: 'utf8') => string };
const read = (name: string): string => readFileSync(new URL(`../../src/interface/${name}`, import.meta.url), 'utf8');

const STEEPLE = arrivalWords('island:steeple_rock')!;
const at = (seconds: number, motion: 'animated' | 'still' = 'animated'): ArrivalModel => arrivalFrame(STEEPLE, motion, seconds)!;

/** Every frame of a card at 60 a second, as drawn. */
const drawn = (motion: 'animated' | 'still'): ViewNode[][] => {
  const frames: ViewNode[][] = [];
  for (let frame = 0; ; frame += 1) {
    const model = arrivalFrame(STEEPLE, motion, frame / 60);
    if (!model) return frames;
    frames.push(arrivalView(model));
  }
};

const child = (view: ViewNode[], className: string): ViewNode => {
  const found = view[0].children.find((node) => node.classes.split(' ').includes(className));
  if (!found) throw new Error(`no ${className}`);
  return found;
};

describe('the card', () => {
  it('reads like a chapter title: the region, the name, the line, and nothing to press', () => {
    const view = arrivalView(at(2));
    expect(collectText(view)).toBe('The Reach Steeple Rock The church hill. The steeple still stands, and Wren still rings the hours.');
    expect(view[0].classes).toBe('iw-arrival-card iw-paper');
    expect(view[0].attributes).toMatchObject({ role: 'status', 'data-place': 'island:steeple_rock', 'data-motion': 'animated' });
    // It takes no input: no control, no intent, no button anywhere in it.
    expect(collectIntents(view)).toEqual([]);
    const tags = (nodes: ViewNode[]): string[] => nodes.flatMap((node) => [node.tag, ...tags(node.children)]);
    expect(tags(view).filter((tag) => tag === 'button' || tag === 'input' || tag === 'a')).toEqual([]);
  });

  it('writes its words in the first frame and never touches them again: only two styles change', () => {
    const frames = drawn('animated');
    expect(frames.length / 60).toBeCloseTo(ARRIVAL_TOTAL, 1);
    const words = (view: ViewNode[]): string => JSON.stringify(['iw-arrival-kicker', 'iw-arrival-title', 'iw-arrival-line'].map((name) => child(view, name)));
    // With the two moving styles taken out, every frame is the same drawing.
    const rest = (view: ViewNode[]): string => JSON.stringify(view, (key, value: unknown) => (key === 'style' ? undefined : value));
    expect(collectText(frames[0])).toContain('Steeple Rock');
    expect(new Set(frames.map(words)).size).toBe(1);
    expect(new Set(frames.map(rest)).size).toBe(1);
    // The words carry no style at all: nothing slides them, scales them or fades them.
    for (const name of ['iw-arrival-kicker', 'iw-arrival-title', 'iw-arrival-line']) expect(child(frames[0], name).attributes).toEqual({});
    expect(view0Style(frames[0])).toEqual(['visibility:hidden', 'visibility:hidden']);
    // And the styles do change: the stroke through the arrival and the leaving, the seal once.
    expect(new Set(frames.map((view) => child(view, 'iw-arrival-stroke').attributes.style)).size).toBeGreaterThan(60);
    expect(new Set(frames.map((view) => child(view, 'iw-arrival-seal').attributes.style)).size).toBeGreaterThan(10);
  });

  it('holds still for two seconds: the finished card carries no moving style', () => {
    const view = arrivalView(at(ARRIVAL.arrive + 1));
    expect(view0Style(view)).toEqual(['', '']);
    expect(JSON.stringify(view)).toBe(JSON.stringify(arrivalView(at(ARRIVAL.arrive + 0.01))));
  });

  it('Still: one drawing from the frame it appears to the frame it leaves', () => {
    const frames = drawn('still');
    expect(frames.length / 60).toBeCloseTo(ARRIVAL.still, 1);
    expect(new Set(frames.map((view) => JSON.stringify(view))).size).toBe(1);
    expect(view0Style(frames[0])).toEqual(['', '']);
    expect(frames[0][0].attributes['data-motion']).toBe('still');
    expect(collectText(frames[0])).toContain('Steeple Rock');
  });
});

function view0Style(view: ViewNode[]): unknown[] {
  return [child(view, 'iw-arrival-stroke').attributes.style, child(view, 'iw-arrival-seal').attributes.style];
}

describe('the ink', () => {
  it('the stroke shows from the lifted end to the drawn end, with a wet edge only while it moves', () => {
    expect(strokeStyle(0, 0)).toBe('visibility:hidden');
    expect(strokeStyle(1, 0)).toBe('');
    expect(strokeStyle(1, 1)).toBe('visibility:hidden');
    // Half drawn: clear ink from the start, gone past the middle.
    expect(strokeStyle(0.5, 0)).toContain('mask-image:linear-gradient(90deg,transparent -7.0%,#000 0.0%,#000 46.5%,transparent 53.5%)');
    // Half lifted: gone from the start, clear ink to the end.
    expect(strokeStyle(1, 0.5)).toContain('mask-image:linear-gradient(90deg,transparent 46.5%,#000 53.5%,#000 100.0%,transparent 107.0%)');
    // Both prefixes, for an older Safari.
    expect(strokeStyle(0.5, 0).startsWith('-webkit-mask-image:')).toBe(true);
  });

  it('the seal takes its ink where it is: opacity only, never a size or a place', () => {
    expect([sealStyle(0), sealStyle(0.5), sealStyle(1)]).toEqual(['visibility:hidden', 'opacity:0.500', '']);
  });

  it('each place has a stroke of its own, the same every time, drawn in the notebook\'s ink', () => {
    const strokes = PLACES.map((place) => brushStroke(place.id));
    expect(new Set(strokes).size).toBe(PLACES.length);
    expect(brushStroke('island:steeple_rock')).toBe(brushStroke('island:steeple_rock'));
    for (const stroke of strokes) {
      expect(stroke).toContain('fill="var(--iw-ink)"');
      expect(stroke).toContain('filter="url(#iw-inkbleed)"');
      // One closed outline inside its box: no number runs off the paper.
      const numbers = /d="([^"]+)"/.exec(stroke)![1].match(/-?\d+(\.\d+)?/g)!.map(Number);
      for (let index = 0; index < numbers.length; index += 2) {
        expect(numbers[index]).toBeGreaterThanOrEqual(0);
        expect(numbers[index]).toBeLessThanOrEqual(320);
        expect(numbers[index + 1]).toBeGreaterThan(0);
        expect(numbers[index + 1]).toBeLessThan(22);
      }
    }
  });
});

describe('the stylesheet', () => {
  const css = read('arrival.css');
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('has no motion of its own: no transition, no animation, no keyframes', () => {
    expect(rules).not.toMatch(/transition|animation|@keyframes/);
  });

  it('takes no click, stands in the upper middle, and gives way to the built view', () => {
    expect(rules).toMatch(/\.iw-arrival \{[^}]*pointer-events: none;/);
    expect(rules).toMatch(/\.iw-arrival \{[^}]*justify-items: center;[^}]*padding-top: 19vh;/);
    expect(rules).toMatch(/\.iw\.iw-holding \.iw-arrival \{\s*visibility: hidden;/);
  });

  it('uses the game\'s own faces and inks, and fetches nothing', () => {
    expect(rules).not.toMatch(/url\((?!#)/);
    expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rules.match(/font-family: var\(--iw-hand\)/g)).toHaveLength(2);
    // The name is in the notebook's serif, the theme's own: it sets no face.
    expect(/\.iw-arrival-title \{[^}]*\}/.exec(rules)![0]).not.toContain('font-family');
  });

  it('the interface loads it from the card\'s own module, and draws the card as a part of its own', () => {
    expect(read('arrival.ts')).toContain("import './arrival.css';");
    const shell = read('interface.ts');
    expect(shell).toContain("part('arrival', 'iw-arrival', root);");
    expect(shell).toContain("this.draw('arrival', model.arrival ? JSON.stringify(model.arrival) : '', () => arrivalView(model.arrival!));");
  });
});
