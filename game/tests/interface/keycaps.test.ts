/**
 * Every key reads as its key (the second review of round 3, new finding 1: the take-back's Z read as a 2).
 *
 * The hand writes Z like its 2, I like its 1, and at a key cap's size 5 like its S. Wherever a key is named, those
 * signs are drawn in code (`interface/keycaps.ts`). These tests hold every place a key is named to that, and hold
 * the sign itself in the markup, so a screen reader and the browser specs still read "Z".
 */
import { describe, expect, it } from 'vitest';
import type { PanelModel, ToastModel } from '../../src/client/contracts.ts';
import { buildHowToPlayPanel, buildHudModel, buildInventoryPanel } from '../../src/client/viewmodels/index.ts';
import { buildSettingsPanel } from '../../src/client/viewmodels/settings.ts';
import { takeBackAction } from '../../src/client/viewmodels/takeback.ts';
import { BOTTLES, TOOL_IDS } from '../../src/data/index.ts';
import { createDefaultSettings } from '../../src/settings/index.ts';
import { collectText } from '../../src/interface/dom.ts';
import type { ViewChild, ViewNode } from '../../src/interface/dom.ts';
import { h } from '../../src/interface/dom.ts';
import { QUICK_PRESS_HINT } from '../../src/interface/inventoryview.ts';
import { DRAWN_KEY_SIGNS, keyFace, keyedText } from '../../src/interface/keycaps.ts';
import { toastActionView } from '../../src/interface/takeback.ts';
import { hintView, hotbarView, panelView, promptView, toastsView } from '../../src/interface/views.ts';
import { give, newGame, standOn } from '../support.ts';

const fileSystemModule = 'node:fs';
const { readFileSync } = await import(/* @vite-ignore */ fileSystemModule) as { readFileSync(path: URL, encoding: 'utf8'): string };
/** A style sheet's rules, without its comments. */
const sheet = (name: string): string => readFileSync(new URL(`../../src/interface/${name}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** The declarations of the rule whose selector is exactly `selector`. */
const rule = (css: string, selector: string): string => {
  const found = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((match) => match[1]!.split(',').map((part) => part.trim()).includes(selector));
  return found.map((match) => match[2]!).join('\n');
};

const find = (nodes: ViewNode[], test: (node: ViewNode) => boolean): ViewNode[] =>
  nodes.flatMap((node) => [...(test(node) ? [node] : []), ...find(node.children, test)]);
const has = (node: ViewNode, className: string): boolean => node.classes.split(' ').includes(className);
const withClass = (nodes: ViewNode[], className: string): ViewNode[] => find(nodes, (node) => has(node, className));
/** The signs drawn in a tree, in order. */
const drawn = (nodes: ViewNode[]): string[] => withClass(nodes, 'iw-kd').map((node) => String(node.attributes['data-drawn']));
/** The words of a tree as a person reads them: the pieces joined as they stand, with no space put between. */
const words = (nodes: ViewNode[]): string => nodes.map((node) => (node.tag === '#text' ? node.text : words(node.children))).join('');
const wrap = (child: ViewChild): ViewNode[] => [h('p', null, child)];
/** The pen's commands, in order: "MHLH". */
const commands = (sign: string): string => (/ d="([^"]*)"/.exec(DRAWN_KEY_SIGNS[sign]!)![1]!.match(/[A-Za-z]/g) ?? []).join('');

const CLOSE: PanelModel['close'] = { label: 'Close', intent: { type: 'close_panel' }, enabled: true, note: null };

const CAPITALS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const DIGITS = '0123456789'.split('');
const DRAWN = ['5', 'I', 'Z'];

describe('a key cap', () => {
  it('draws the three signs the hand writes like another sign, and no other letter or digit', () => {
    // Checked in pictures at both screen sizes, all 26 and the ten digits: `r4-small/shots/after/`.
    expect(Object.keys(DRAWN_KEY_SIGNS).sort()).toEqual(DRAWN);
    for (const label of [...CAPITALS, ...DIGITS]) {
      expect(drawn(wrap(keyFace(label))), label).toEqual(DRAWN.includes(label) ? [label] : []);
    }
  });

  it('keeps the sign itself in the markup, once, under the pen strokes', () => {
    for (const sign of DRAWN) {
      const cap = wrap(keyFace(sign));
      expect(words(cap)).toBe(sign);
      expect(collectText(cap)).toBe(sign);
      expect(withClass(cap, 'iw-kd-said').map((node) => words([node]))).toEqual([sign]);
      const pen = withClass(cap, 'iw-kd-pen');
      expect(pen).toHaveLength(1);
      expect(pen[0]!.html).toContain('<svg');
      expect(pen[0]!.html).toContain('<path');
      expect(pen[0]!.attributes['aria-hidden']).toBe('true');
      // The strokes carry no text of their own: nothing is read twice.
      expect(pen[0]!.html).not.toMatch(/<text|<title/);
    }
  });

  it('leaves a word in the hand: only a lone sign is drawn', () => {
    const labels = ['Tab', 'Esc', 'Space', 'Shift+click', 'Left Shift', 'Num 4', 'F5', '55', 'unbound', 'none', 'Z ', ' Z', 'ZZ', 'z', 'i', '',
      // Not a sign of ours, whatever an object happens to carry.
      'constructor', 'toString', '__proto__'];
    for (const label of labels) expect(keyFace(label), label).toBe(label);
  });

  it('a number pad key keeps its word and has its sign drawn: "Num 5" must not read "Num S"', () => {
    const cap = wrap(keyFace('Num 5'));
    expect(words(cap)).toBe('Num 5');
    expect(drawn(cap)).toEqual(['5']);
    expect(drawn(wrap(keyFace('Num 1')))).toEqual([]);
  });

  it('prints each sign the careful way: what makes it the other sign is not in it', () => {
    // The Z: a bar, one straight stroke, a bar. No curve: a hook or a wave is what makes the hand's Z a 2.
    expect(commands('Z')).toBe('MHLH');
    // The I: two bars and a stem. The bare stem is the hand's 1.
    expect(commands('I')).toBe('MHMMH');
    // The 5: a flat top and a straight neck before the bowl. One unbroken curve is the hand's S.
    expect(commands('5')).toMatch(/^MHLC+$/);
    // Every sign is written on the same grid, so one pen and one writing line serve them all.
    for (const sign of DRAWN) expect(DRAWN_KEY_SIGNS[sign], sign).toContain('viewBox="0 0 70 80"');
  });
});

describe('every place a key is named', () => {
  it('the take-back note: its key cap is a drawn Z, and the button still says "Z" and "Take back"', () => {
    // The note's own action, as the client builds it for the newest drop.
    const action = takeBackAction(1, true);
    expect(action.keyLabel).toBe('Z');
    const button = [toastActionView(action)];
    const cap = find(button, (node) => node.tag === 'kbd');
    expect(cap).toHaveLength(1);
    expect(drawn(cap)).toEqual(['Z']);
    expect(words(cap)).toBe('Z');
    expect(words(button)).toBe('ZTake back');
    expect(button[0]!.attributes['aria-label']).toBe('Take back (Z)');
    // An older note has the button and no key: nothing is drawn on it.
    expect(drawn([toastActionView(takeBackAction(1, false))])).toEqual([]);
  });

  it('How to Play: the take-back cap and the fifth tool\'s cap are drawn, and so is any key bound to Z or I', () => {
    const settings = createDefaultSettings();
    const page = (): ViewNode[] => panelView({ title: 'How to Play', close: CLOSE, ...buildHowToPlayPanel(settings) });
    const caps = withClass(page(), 'iw-key');
    expect(caps.map((cap) => words([cap]))).toContain('Z');
    // Down the page: "Tools 1 to 5", then "Take a drop back".
    expect(drawn(page())).toEqual(['5', 'Z']);
    for (const cap of caps) expect(drawn([cap]), words([cap])).toEqual(DRAWN.includes(words([cap])) ? [words([cap])] : []);
    settings.controls.keyBindings.bail = ['KeyI'];
    settings.controls.keyBindings.jump = ['KeyZ', 'Space'];
    expect(drawn(page()).sort()).toEqual(['5', 'I', 'Z', 'Z']);
  });

  it('the prompt and the tool belt', () => {
    expect(drawn(promptView({ text: 'Board the canoe', keyLabel: 'Z', mode: 'press' }))).toEqual(['Z']);
    expect(drawn(promptView({ text: 'Board the canoe', keyLabel: 'F', mode: 'press' }))).toEqual([]);
    const slot = { number: 1, keyLabel: 'I', toolId: null, itemId: null, name: '', selected: false, intent: null };
    const belt = hotbarView([slot, { ...slot, number: 2, keyLabel: '2' }, { ...slot, number: 5, keyLabel: '5' }]);
    expect(drawn(belt)).toEqual(['I', '5']);
    expect(words(belt)).toBe('I25');
  });

  it('the tool belt: a slot that holds a tool has its number drawn too', () => {
    const state = newGame();
    for (const tool of TOOL_IDS) give(state, tool);
    const belt = hotbarView(buildHudModel(state, createDefaultSettings(), 0).hotbar);
    const held = find(belt, (node) => node.tag === 'button');
    expect(held).toHaveLength(5);
    expect(held.map((slot) => drawn([slot]))).toEqual([[], [], [], [], ['5']]);
    expect(held.map((slot) => words(withClass([slot], 'iw-n')))).toEqual(['1', '2', '3', '4', '5']);
  });

  it('the settings: a key bound to Z or I is drawn on its cap, and in the note that says so', () => {
    const settings = createDefaultSettings();
    const page = (notice: string): ViewNode[] => panelView({ title: 'Settings', close: CLOSE, ...buildSettingsPanel(settings, 'controls', null, notice, 'Version test') });
    // Out of the box the fifth tool's key is the only such sign.
    expect(drawn(page(''))).toEqual(['5']);
    settings.controls.keyBindings.bail = ['KeyZ'];
    settings.controls.keyBindings.lantern = ['KeyL', 'KeyI'];
    const caps = withClass(page(''), 'iw-bind');
    expect(caps.filter((cap) => drawn([cap]).length > 0).map((cap) => words([cap])).sort()).toEqual(DRAWN);
    for (const cap of caps) expect(drawn([cap]), words([cap])).toEqual(DRAWN.includes(words([cap])) ? [words([cap])] : []);
    // An empty slot says "none": a word, in the hand.
    expect(caps.some((cap) => words([cap]) === 'none')).toBe(true);
    const notice = withClass(page('Bail is now Z.'), 'iw-notice');
    expect(words(notice)).toBe('Bail is now Z.');
    expect(drawn(notice)).toEqual(['Z']);
  });

  it('the inventory\'s footer: the Z of the take-back is drawn, and the line says the same words', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    const panel: PanelModel = { title: 'Inventory', close: CLOSE, ...buildInventoryPanel(state) };
    const hint = withClass(panelView(panel), 'iw-inv-hint');
    expect(hint).toHaveLength(1);
    expect(words(hint)).toBe(QUICK_PRESS_HINT);
    expect(drawn(hint)).toEqual(['Z']);
  });

  it('a tip and a note in the hand that name a key', () => {
    expect(drawn(hintView('Hold Z to bail.'))).toEqual(['Z']);
    expect(words(hintView('Board (I), then hold Z to bail.'))).toBe('Board (I), then hold Z to bail.');
    expect(drawn(hintView('Board (I), then hold Z to bail.'))).toEqual(['I', 'Z']);
    const toast: ToastModel = { id: 7, text: 'Paddling on. Q, Z or S to stop.', tone: 'info', itemId: null, life: 1 };
    expect(drawn(toastsView([toast]))).toEqual(['Z']);
    expect(words(toastsView([toast]))).toBe('Paddling on. Q, Z or S to stop.');
  });
});

describe('a sentence that names keys', () => {
  it('draws a lone Z or I and leaves every word alone', () => {
    const sentences: [string, string[]][] = [
      ['Hold Z to bail.', ['Z']],
      ['Z takes a drop back while its note stands.', ['Z']],
      ['Drink from the inventory (I); boil water at a fire first.', ['I']],
      ['Q, W or Z to stop.', ['Z']],
      ['Bail is now Z', ['Z']],
      ['Zebra mussels on the hull.', []],
      ['A PIZZA oven. INK. ZIP.', []],
      ['Shift+Z and Z+click are words, like Left-I.', []],
      ["I'm told it's Z's turn.", []],
      ['', []],
    ];
    for (const [sentence, letters] of sentences) {
      const view = wrap(keyedText(sentence));
      expect(drawn(view), sentence).toEqual(letters);
      expect(words(view), sentence).toBe(sentence);
    }
  });

  it('leaves what stands in quotation marks to the hand: a letter out of a bottle names no key', () => {
    // The note of a bottle found, as the client words it: the bottle's name, its count, then the letter in quotation marks.
    for (const bottle of Object.values(BOTTLES)) {
      const note = `${bottle.name} (3 of 10): "${bottle.text}"`;
      expect(keyedText(note), bottle.name).toBe(note);
      const toast: ToastModel = { id: 1, text: note, tone: 'good', itemId: null, life: 1 };
      expect(drawn(toastsView([toast])), bottle.name).toEqual([]);
    }
    // At least one of those letters says "I": the rule is not idle.
    expect(Object.values(BOTTLES).some((bottle) => /(^|[^A-Za-z])I[^A-Za-z']/.test(bottle.text))).toBe(true);
    const sentences: [string, string[]][] = [
      ['"I went into the Fog four times."', []],
      ['Press Z. The note said "I held the bow dead north" and no more.', ['Z']],
      ['The note said "Z marks it." Hold I to bail.', ['I']],
      ['\u201cI am going to paddle toward it.\u201d Hold Z.', ['Z']],
      // A mark that is never closed: the rest of the line is the quote.
      ['Hold Z. "I did not, once', ['Z']],
    ];
    for (const [sentence, letters] of sentences) {
      const view = wrap(keyedText(sentence));
      expect(drawn(view), sentence).toEqual(letters);
      expect(words(view), sentence).toBe(sentence);
    }
  });

  it('leaves a digit to the hand: in a sentence a number is a count', () => {
    for (const sentence of ['Tools 1 to 5', '-5 Stone', '+5 Stone', '5 stone left', 'Bail is now 5.', 'Day 5']) {
      expect(keyedText(sentence), sentence).toBe(sentence);
    }
  });

  it('hands back the very string when it names no such key: nothing is rebuilt for nothing', () => {
    expect(keyedText('Hold F to bail.')).toBe('Hold F to bail.');
    expect(keyedText('Zebra')).toBe('Zebra');
  });
});

describe('the look rules', () => {
  it('nothing about a drawn sign or the take-back cap moves', () => {
    for (const name of ['keycaps.css', 'takeback.css']) {
      expect(sheet(name), name).not.toMatch(/transition|animation|@keyframes|transform/);
    }
  });

  it('the sign keeps its place, its own ink is left out, and the pen stands on its writing line', () => {
    const css = sheet('keycaps.css');
    expect(rule(css, '.iw-kd-said')).toMatch(/color:\s*transparent/);
    // One cell for the sign and the pen, set on the same line: the strokes cannot sit high or low at any size.
    expect(rule(css, '.iw-kd')).toMatch(/display:\s*inline-grid/);
    expect(rule(css, '.iw-kd')).toMatch(/align-items:\s*baseline/);
    expect(rule(css, '.iw-kd-said')).toMatch(/grid-area:\s*1\s*\/\s*1/);
    expect(rule(css, '.iw-kd-pen')).toMatch(/grid-area:\s*1\s*\/\s*1/);
    // The pen takes no room: a cap and a line are as wide as before.
    expect(rule(css, '.iw-kd-pen')).toMatch(/width:\s*0;[\s\S]*height:\s*0;/);
    // The pen follows the words' own ink, so a pressed or a refused cap keeps its colour.
    expect(rule(css, '.iw-kd-pen svg')).toMatch(/stroke:\s*currentColor/);
    // Never hidden by a clip or a 1 px box: the layout spec would read that as a cut word.
    expect(css).not.toMatch(/overflow:\s*hidden|clip-path|font-size:\s*0/);
  });

  it('a cap is written with the heavy pen and a sentence with the light one', () => {
    const css = sheet('keycaps.css');
    const light = Number(/--iw-kd-pen:\s*([\d.]+)/.exec(rule(css, '.iw-kd'))![1]);
    for (const cap of ['.iw-key .iw-kd', '.iw-toast-key .iw-kd', '.iw-n .iw-kd']) {
      const heavy = Number(/--iw-kd-pen:\s*([\d.]+)/.exec(rule(css, cap))![1]);
      expect(heavy, cap).toBeGreaterThan(light);
    }
    expect(rule(css, '.iw-kd-pen svg')).toMatch(/stroke-width:\s*var\(--iw-kd-pen\)/);
    // The take-back cap is as heavy as every other key cap.
    expect(rule(sheet('takeback.css'), '.iw-toast-key')).toMatch(/font-weight:\s*700/);
  });
});
