/**
 * Every key reads as its key (the second review of round 3, new finding 1).
 *
 * The game's hand writes three signs the way it writes another: its Z is its 2 with a flatter top, its I is its 1,
 * one bare stroke, and at the size of a key cap its 5 is its S. A friend read the take-back key as "2", pressed 2,
 * and nothing came back.
 *
 * The hand stays. Where a key is named, those signs are drawn here in code, in the same pen: the weight, the round
 * ends and the lean of the hand, but printed the careful way a person prints a sign that must not be misread. The Z
 * has three straight strokes and two sharp corners, the I has its two bars, the 5 a flat top and a square shoulder.
 *
 * - The sign itself stays in the markup, in the hand, and keeps its place: the drawn strokes stand over it on the
 *   same writing line and its own ink is left out. A screen reader and a test still read "Z".
 * - Every other capital and digit was checked in a picture at both screen sizes and reads as itself.
 * - Only where a key is named: a key cap (`keyFace`), and a sentence in the hand that names a key (`keyedText`).
 *   A word is left alone ("Zebra", "Shift+click").
 * - Written once and whole: nothing here moves (`keycaps.css` has no transition and no animation).
 */
import './keycaps.css';
import { h } from './dom.ts';
import type { ViewChild, ViewNode } from './dom.ts';

/**
 * A sign on a 70 by 80 grid. One unit is a hundredth of the font size and the bottom edge is the writing line, so
 * the numbers are the hand's own: its capitals stand 74 high, its pen is 9 wide, 13 in bold (`keycaps.css`).
 */
const strokes = (path: string): string => `<svg viewBox="0 0 70 80" aria-hidden="true"><path d="${path}"/></svg>`;

/** The signs the hand writes like another sign, as pen strokes. Every other letter and digit is the hand's own. */
export const DRAWN_KEY_SIGNS: Readonly<Record<string, string>> = {
  // Top bar, one straight stroke down to the left, bottom bar. No hook and no wave: that is the hand's 2.
  Z: strokes('M23 12.5H60L12 73H50'),
  // A stem between two bars. The bare stem is the hand's 1.
  I: strokes('M26 12.5H54M40 12.5 30 73M16 73H44'),
  // A flat top, a straight neck, a square shoulder into the bowl. One unbroken curve is the hand's S.
  5: strokes('M57 12.5H29L24 40C35 32 55 34 55 52C55 68 34 78 14 69'),
};

/** One drawn sign: the sign itself, holding its place unseen, and the pen strokes over it. */
const drawnSign = (sign: string): ViewNode => h('span.iw-kd', { 'data-drawn': sign },
  h('span.iw-kd-said', null, sign),
  h('i.iw-kd-pen', { 'aria-hidden': 'true', html: DRAWN_KEY_SIGNS[sign]! }));

/**
 * What stands on a key cap: the label, with a lone Z, I or 5 drawn. A word ("Tab", "Left Shift") is the hand's own.
 * A number pad key is a word and a sign ("Num 5"): the word stays and the sign is drawn, or it reads "Num S".
 */
export function keyFace(label: string): ViewChild {
  if (Object.hasOwn(DRAWN_KEY_SIGNS, label)) return drawnSign(label);
  const sign = label.slice(-1);
  // One piece: a cap sets its pieces one under the other.
  return label.length > 2 && label.at(-2) === ' ' && Object.hasOwn(DRAWN_KEY_SIGNS, sign) ? h('span', null, label.slice(0, -1), drawnSign(sign)) : label;
}

/** A lone Z or I: no letter, digit, apostrophe, plus or hyphen on either side. */
const KEY_LETTER = /(?<![A-Za-z0-9'’+-])([ZI])(?![A-Za-z0-9'’+-])/;
/** Someone's own words, in quotation marks, closed or running to the end of the line. */
const QUOTED = /("[^"]*"?|“[^”]*”?)/;

/**
 * A sentence in the hand that names keys ("Hold Z to bail.", "Paddling on. Q, W or Z to stop."): the same words,
 * with each lone Z or I drawn. The words and their order do not change. A digit is left to the hand: in a sentence
 * a number is nearly always a count ("5 stone"), read beside its word. So is whatever stands in quotation marks:
 * a letter out of a bottle says "I am putting one of these in every morning", and that I is no key.
 */
export function keyedText(text: string, said: readonly string[] = []): ViewChild {
  if (!text.includes('Z') && !text.includes('I')) return text;
  // What a player typed (a crewmate's name, `said`) is someone's own words too: a crewmate named "I" gets no key box.
  const typed = said.filter((words) => words !== '').map((words) => words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const own = typed.length === 0 ? QUOTED : new RegExp(`(${QUOTED.source.slice(1, -1)}|(?<![A-Za-z0-9])(?:${typed.join('|')})(?![A-Za-z0-9]))`);
  const pieces: (string | ViewNode)[] = [];
  let drew = false;
  const say = (words: string): void => {
    if (words === '') return;
    if (typeof pieces.at(-1) === 'string') pieces[pieces.length - 1] += words;
    else pieces.push(words);
  };
  // `split` with one group: said, quoted, said, quoted, said. And within what is said: words, letter, words.
  text.split(own).forEach((passage, place) => {
    if (place % 2 === 1) return say(passage);
    passage.split(KEY_LETTER).forEach((part, index) => {
      if (index % 2 === 0) return say(part);
      pieces.push(drawnSign(part));
      drew = true;
    });
  });
  return drew ? pieces : text;
}
