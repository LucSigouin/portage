/**
 * The pick screen as the Ink & Wash interface draws it, without a DOM: four choices in a group, one of them
 * marked by more than colour, one button that starts and Back, in the order the keyboard walks them. Then the
 * screen's keys, and its stylesheet read as text: nothing on this sheet moves.
 */
import { describe, expect, it } from 'vitest';
import { buildCastPanel } from '../../src/client/viewmodels/index.ts';
import type { CastView, PanelModel } from '../../src/client/viewmodels/index.ts';
import { CAST, CHARACTER_IDS } from '../../src/data/index.ts';
import type { CharacterId } from '../../src/data/index.ts';
import { castKeyAction } from '../../src/interface/cast.ts';
import { collectIntents, collectText } from '../../src/interface/dom.ts';
import type { ViewNode } from '../../src/interface/dom.ts';
import { panelView } from '../../src/interface/views.ts';

// The project has no Node type definitions, so the file reader is loaded by name at run time.
const fileSystemModule = 'node:fs';
const { readFileSync } = await import(/* @vite-ignore */ fileSystemModule) as { readFileSync: (path: URL, encoding: 'utf8') => string };
const sheet = readFileSync(new URL('../../src/interface/cast.css', import.meta.url), 'utf8');
/** The stylesheet without its comments: the comments say "transition" and "animation" in plain words. */
const rules = sheet.replace(/\/\*[\s\S]*?\*\//g, '');

type CastPanel = Extract<PanelModel, { id: 'character_select' }>;

const panelOf = (marked: CharacterId, door: CastView['door'] = { kind: 'new_game', slot: 1 }): CastPanel => ({
  title: 'Pick who you are',
  close: { label: 'Back', intent: { type: 'close_panel' }, enabled: true, note: null },
  ...buildCastPanel({ door, marked }),
});

function find(nodes: ViewNode[], test: (node: ViewNode) => boolean, into: ViewNode[] = []): ViewNode[] {
  for (const node of nodes) {
    if (test(node)) into.push(node);
    find(node.children, test, into);
  }
  return into;
}
const has = (node: ViewNode, name: string): boolean => node.classes.split(' ').includes(name);
const cardsOf = (view: ViewNode[]): ViewNode[] => find(view, (node) => has(node, 'cs-card'));

/** The declarations of the rule whose selector is exactly `selector`. */
function declarations(selector: string): string {
  const block = rules.split('}').map((rule) => rule.split('{')).find(([head]) => head!.trim() === selector);
  if (!block) throw new Error(`cast.css has no rule ${selector}`);
  return block[1]!.trim();
}

describe('the pick screen, drawn', () => {
  it('is a sheet with a name, and every word of the model is on it', () => {
    const panel = panelOf('trapper');
    const view = panelView(panel);
    expect(view).toHaveLength(1);
    expect(view[0]!.attributes).toMatchObject({ role: 'dialog', 'aria-label': 'Pick who you are' });
    expect(has(view[0]!, 'iw-panel')).toBe(true);
    const text = collectText(view);
    for (const words of ['Pick who you are', 'A new game in slot 2', panel.note, 'Start as The Trapper', 'Back']) expect(text).toContain(words);
    for (const id of CHARACTER_IDS) {
      expect(text).toContain(CAST[id].name);
      expect(text).toContain(CAST[id].line);
    }
  });

  it('is a group of four choices, in the cast\'s order, and says which one is marked', () => {
    const view = panelView(panelOf('angler'));
    const groups = find(view, (node) => node.attributes.role === 'radiogroup');
    expect(groups).toHaveLength(1);
    expect(groups[0]!.attributes['aria-label']).toBe('Who you are');
    // The four choices are the group's own children and nothing else is in it.
    const cards = groups[0]!.children;
    expect(cards.map((card) => card.attributes['data-character'])).toEqual([...CHARACTER_IDS]);
    for (const card of cards) {
      expect(card.tag).toBe('button');
      expect(card.attributes).toMatchObject({ role: 'radio', type: 'button' });
    }
    expect(cards.map((card) => card.attributes['aria-checked'])).toEqual(['false', 'false', 'true', 'false']);
  });

  it('marks one card by more than colour: its own class for the full frame, and a tick', () => {
    for (const marked of CHARACTER_IDS) {
      const cards = cardsOf(panelView(panelOf(marked)));
      expect(cards.filter((card) => has(card, 'cs-marked')).map((card) => card.attributes['data-character'])).toEqual([marked]);
      // The tick is on every card, so marking one changes no size. The stylesheet shows it on the marked one only.
      for (const card of cards) expect(find([card], (node) => has(node, 'cs-tick'))).toHaveLength(1);
    }
    expect(declarations('.cs-tick')).toContain('visibility: hidden');
    expect(declarations('.cs-card.cs-marked .cs-tick')).toBe('visibility: visible;');
    expect(declarations('.iw .cs-card.cs-marked')).toMatch(/border-style: solid;[\s\S]*border-color: var\(--iw-ink\);/);
    expect(declarations('.iw .cs-card')).toContain('dashed');
  });

  it('leaves each card a frame for its picture: a letter in it, and an empty place for the picture', () => {
    const cards = cardsOf(panelView(panelOf('voyageur')));
    expect(cards.map((card) => collectText(find([card], (node) => has(node, 'cs-initial'))))).toEqual(['V', 'T', 'A', 'S']);
    for (const card of cards) {
      const frames = find([card], (node) => has(node, 'cs-frame'));
      expect(frames).toHaveLength(1);
      // The picture is the host's to lay in. The view leaves the place empty, and says nothing of it to a screen reader.
      const slots = find(frames, (node) => has(node, 'cs-slot'));
      expect(slots).toHaveLength(1);
      expect(slots[0]!.children).toEqual([]);
      expect(slots[0]!.attributes['aria-hidden']).toBe('true');
      expect(find(frames, (node) => has(node, 'cs-initial'))[0]!.attributes['aria-hidden']).toBe('true');
      // A card reads as its name, then its line.
      const words = card.children.filter((child) => !has(child, 'cs-frame') && !has(child, 'cs-tick'));
      expect(words.map((child) => child.classes)).toEqual(['cs-name', 'cs-line']);
    }
  });

  it('is walked card, card, card, card, the button that starts, Back: and each sends the model\'s own intent', () => {
    const panel = panelOf('scout', { kind: 'join' });
    const view = panelView(panel);
    const stops = find(view, (node) => node.tag === 'button');
    expect(stops.map((stop) => stop.attributes['data-character'] ?? stop.classes)).toEqual([
      'voyageur', 'trapper', 'angler', 'scout', 'iw-btn iw-go cs-start', 'iw-btn cs-back',
    ]);
    // Nothing takes itself out of the walk or jumps the queue.
    for (const stop of stops) {
      expect(stop.attributes.tabindex).toBeUndefined();
      expect(stop.attributes.disabled ?? false).toBe(false);
    }
    expect(collectIntents(view)).toEqual([...panel.cards.map((card) => card.intent), panel.start.intent, panel.close.intent]);
    expect(collectIntents(view)).toEqual([
      { type: 'cast_mark', character: 'voyageur' }, { type: 'cast_mark', character: 'trapper' },
      { type: 'cast_mark', character: 'angler' }, { type: 'cast_mark', character: 'scout' },
      { type: 'cast_confirm' }, { type: 'close_panel' },
    ]);
    // Enter presses the one button marked for it, and it names the pick.
    const primary = find(view, (node) => 'data-primary' in node.attributes);
    expect(primary).toHaveLength(1);
    expect(primary[0]!.intent).toEqual({ type: 'cast_confirm' });
    expect(collectText(primary)).toBe('Join as The Scout');
  });
});

describe('the pick screen\'s keys', () => {
  const marks = (marked: CharacterId, code: string) => castKeyAction(panelOf(marked), code, null);

  it('Right and Left move the mark one card, and send that card\'s own intent', () => {
    expect(marks('voyageur', 'ArrowRight')).toEqual({ type: 'mark', character: 'trapper', intent: { type: 'cast_mark', character: 'trapper' } });
    expect(marks('trapper', 'ArrowRight')).toMatchObject({ type: 'mark', character: 'angler' });
    expect(marks('angler', 'ArrowLeft')).toEqual({ type: 'mark', character: 'trapper', intent: { type: 'cast_mark', character: 'trapper' } });
    // Wherever the keyboard is: on a card, on a button, on nothing.
    expect(castKeyAction(panelOf('trapper'), 'ArrowRight', { on: 'button' })).toMatchObject({ type: 'mark', character: 'angler' });
    expect(castKeyAction(panelOf('trapper'), 'ArrowLeft', { on: 'card', character: 'scout' })).toMatchObject({ type: 'mark', character: 'voyageur' });
  });

  it('goes round the ends', () => {
    expect(marks('scout', 'ArrowRight')).toMatchObject({ type: 'mark', character: 'voyageur' });
    expect(marks('voyageur', 'ArrowLeft')).toMatchObject({ type: 'mark', character: 'scout' });
  });

  it('Enter presses the one button, from nowhere and from the marked card', () => {
    expect(castKeyAction(panelOf('angler'), 'Enter', null)).toEqual({ type: 'press' });
    expect(castKeyAction(panelOf('angler'), 'NumpadEnter', null)).toEqual({ type: 'press' });
    expect(castKeyAction(panelOf('angler'), 'Enter', { on: 'card', character: 'angler' })).toEqual({ type: 'press' });
  });

  it('Enter on Back is Back\'s, and on a card that is not the marked one it marks that card', () => {
    // Null: the screen leaves the key alone, and the button under the keyboard takes its own press.
    expect(castKeyAction(panelOf('angler'), 'Enter', { on: 'button' })).toBeNull();
    expect(castKeyAction(panelOf('angler'), 'Enter', { on: 'card', character: 'scout' })).toBeNull();
  });

  it('a key held down does nothing: one press, one step, and a held Enter starts nothing', () => {
    expect(castKeyAction(panelOf('angler'), 'ArrowRight', null, true)).toEqual({ type: 'none' });
    expect(castKeyAction(panelOf('angler'), 'ArrowLeft', { on: 'card', character: 'angler' }, true)).toEqual({ type: 'none' });
    expect(castKeyAction(panelOf('angler'), 'Enter', null, true)).toEqual({ type: 'none' });
    expect(castKeyAction(panelOf('angler'), 'Enter', { on: 'card', character: 'angler' }, true)).toEqual({ type: 'none' });
  });

  it('leaves every other key alone: Tab walks, Esc goes back, Up and Down and letters are not the screen\'s', () => {
    for (const code of ['Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'Space', 'KeyA', 'KeyD', 'Digit1']) {
      expect(castKeyAction(panelOf('angler'), code, null)).toBeNull();
      expect(castKeyAction(panelOf('angler'), code, { on: 'card', character: 'angler' })).toBeNull();
    }
  });
});

describe('the pick screen\'s stylesheet', () => {
  it('moves nothing: no transition but "none", no animation, no keyframes', () => {
    const transitions = [...rules.matchAll(/transition[a-z-]*\s*:\s*([^;}]+)/g)].map((match) => match[1]!.trim());
    expect(transitions).toEqual(['none']);
    expect(rules).not.toMatch(/animation/);
    expect(rules).not.toMatch(/@keyframes/);
    expect(rules).not.toMatch(/opacity/);
    // The only word on transforms is the one that stops the paper buttons' lift.
    expect([...rules.matchAll(/transform\s*:\s*([^;}]+)/g)].map((match) => match[1]!.trim())).toEqual(['none']);
  });

  it('changes one thing under the pointer: the frame\'s ink, at once', () => {
    const hovers = rules.split('}').map((rule) => rule.split('{')).filter(([head]) => head!.includes(':hover'))
      .map(([head, body]) => [head!.trim(), body!.trim()]);
    expect(hovers).toEqual([
      ['.iw .cs-card:hover', 'border-color: var(--iw-ink-soft);'],
      ['.iw .cs .iw-btn:enabled:hover', 'transform: none;'],
    ]);
    // The sheet's two buttons stand still: the lift the paper buttons have elsewhere is off here.
    expect(declarations('.iw .cs .iw-btn')).toBe('transition: none;');
  });

  it('keeps its shape at every size: no size in pixels, and a frame as tall with a picture as without', () => {
    expect(rules).not.toMatch(/\d\s*px\b/);
    const frame = declarations('.cs-frame');
    expect(frame).toMatch(/(^|\s)height: \d+(\.\d+)?rem;/);
    expect(frame).toContain('overflow: hidden');
    // The letter and the picture's place lie over the frame's own box: neither can push it.
    for (const selector of ['.cs-initial', '.cs-slot', '.cs-pic']) expect(declarations(selector)).toContain('position: absolute');
    // A frame with its picture hides the letter and keeps its room.
    expect(declarations('.cs-frame[data-pictured] .cs-initial')).toBe('visibility: hidden;');
    // A card's frame is as thick marked as not, and the line keeps room for three lines.
    expect(declarations('.iw .cs-card.cs-marked')).not.toMatch(/border(-width)?:/);
    expect(declarations('.cs-line')).toMatch(/min-height: \d+(\.\d+)?rem;/);
  });

  it('is four cards side by side', () => {
    expect(declarations('.cs-cards')).toContain('grid-template-columns: repeat(4, minmax(0, 1fr));');
  });
});
