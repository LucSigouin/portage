// The pen's samples (round 4). Luc's note from the live game: "the outline should be full and not kinda drawn on".
//
// Today's pen draws a line by hand: along one edge it swells and thins (2.4 to 1), it wanders up to a pixel and a
// half off the edge it follows, and where a thing stands on the ground its edge is a grey seam, not a line. These
// samples are a fuller pen: the line sits on the true edge, keeps one weight along it, and closes at the ground.
//
// Luc picked C (`bold`): with no switch the game draws with it, everywhere (the world, the crew, the canoe, the
// pick screen's cards). One switch picks another: the address parameter `?pen=<name>` (client/debug/parameters.ts),
// or `setPen(name)` on the look's world view. `?pen=today` is the old pen, to the letter: the samples are
// `#ifdef PEN_FULL` blocks in the pen's shader (post.js), and today's pen is drawn with none of them defined
// (tests/look/pens.test.ts holds the text that is left against the text before round 4).

/** The samples by name, in the order they are shown. The letters a to d are read too. */
export const PEN_NAMES = ['today', 'full', 'bold', 'near'];
// Luc's pick (round 4, 2026-11-14): "full border on the outline i think it was C". C is the game's pen.
export const DEFAULT_PEN = 'bold';

// width: the line's width against the middle of today's (today's runs from .52 to 1.26 of it along one edge).
// weight: the one weight the line keeps, 0 to 1 on today's scale. .5 is the middle: full ink, as today's is there.
// seam: the ink of a seam inside a thing (a sleeve over a coat, one log on the next). Today's is .64.
// from, to: metres from the eye. The full pen up to `from`, today's pen past `to`, eased between. Null: full everywhere.
export const PENS = {
  // A: today's pen. No setting: nothing is defined and the shader is the one it always was.
  today: null,
  // B: a full line. One even width, on the edge, closed at the ground. As heavy as today's line is on the whole.
  full: { width: 1, weight: 0.5, seam: 0.64, from: null, to: null },
  // C: full and bolder. Over half as wide again (as wide as today's line is at its fattest), and the seams inside a
  // thing darker with it.
  bold: { width: 1.6, weight: 0.5, seam: 0.8, from: null, to: null },
  // D: full near, today's pen far off. What is near is the canoe, the crew and what can be reached and used.
  near: { width: 1, weight: 0.5, seam: 0.64, from: 22, to: 60 },
};

const LETTERS = { a: 'today', b: 'full', c: 'bold', d: 'near' };

/** The sample an address parameter names: a name or its letter, in any case. Anything else, or nothing: the game's pen (C). */
export function penFrom(text) {
  const word = typeof text === 'string' ? text.trim().toLowerCase() : '';
  if (PEN_NAMES.includes(word)) return word;
  return Object.hasOwn(LETTERS, word) ? LETTERS[word] : DEFAULT_PEN;
}

const glsl = (number) => (Number.isInteger(number) ? `${number}.` : String(number));

/** What the pen's shader is compiled with for a sample. Today's pen: nothing at all. */
export function penDefines(name) {
  const pen = Object.hasOwn(PENS, name) ? PENS[name] : null;
  if (!pen) return {};
  return {
    PEN_FULL: 1,
    PEN_WIDTH: glsl(pen.width),
    PEN_WEIGHT: glsl(pen.weight),
    PEN_SEAM: glsl(pen.seam),
    // no easing: the full pen at every distance (the far plane is 2000 m)
    PEN_FROM: glsl(pen.from ?? 1e6),
    PEN_TO: glsl(pen.to ?? 2e6),
  };
}

// How far a pen's ink can lie from the edge it draws, in pixels at 1080p, on a thing near the eye (post.js: the
// line's half-width is uLineW 1.3 x 1.3 near x (.52 + .74 weight); today's line also wanders uWobble 1.5 off its edge).
const HALF_WIDTH = 1.3 * 1.3;
const TODAY_REACH = HALF_WIDTH * (0.52 + 0.74) + 1.5;

/**
 * How far a sample's ink can lie from its edge, against today's pen (1). The pen's own probe and the hero windows'
 * margin were sized for today's pen, which swells and wanders. A sample at 1 or under reaches no further, so its
 * line is found wherever today's is, and a figure's line is never cut at its window's edge.
 */
export function penReach(name) {
  const pen = PENS[name];
  if (!pen) return 1;
  const own = HALF_WIDTH * (0.52 + 0.74 * pen.weight) * pen.width;
  // where a sample eases back to today's pen, today's reach counts too
  return Math.max(own, pen.from === null ? 0 : TODAY_REACH) / TODAY_REACH;
}
