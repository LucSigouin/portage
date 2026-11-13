/**
 * The arrival card, drawn: a slip of the notebook's paper in the upper middle of the screen, the place's name set
 * like a chapter title, a brush stroke under it and the red seal beside it.
 *
 * The view is pure, like the others (`views.ts`): one frame of the model in, a description of markup out. What
 * moves is told by the model (`client/viewmodels/arrival.ts`) and written here as two styles: how much of the
 * stroke shows, and how much ink the seal has taken. The words are the same nodes in every frame, so they are
 * never touched after the first. `arrival.css` has no transition and no animation in it: the card's clock is the
 * frame's, so it stops when the frames do and a picture of it is the same every time.
 */
import './arrival.css';
import type { ArrivalModel } from '../client/viewmodels/arrival.ts';
import { h } from './dom.ts';
import type { ViewNode } from './dom.ts';
import { SEAL } from './icons.ts';

/** The stroke is drawn in a box this wide and this high (its own units), stretched to the name's width. */
const STROKE_WIDTH = 320;
const STROKE_HEIGHT = 22;
/** Points along each edge of the stroke. */
const STROKE_POINTS = 28;
/** The wet edge of the stroke as it is drawn and lifted: this share of its length goes from ink to none. */
const WET_EDGE = 0.07;

/** A repeatable random number source, 0 to 1 (the paper's, `paper.ts`). */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** A number from a place's id, so each place has a stroke of its own and the same one every time. */
function seedOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * One brush stroke, left to right, as an SVG: laid down heavy, drawn out thinner, lifted off to a dry tail.
 * Its edges waver by the place's own seed. It is one filled outline, roughened by the notebook's ink filter.
 */
export function brushStroke(placeId: string): string {
  const random = seededRandom(seedOf(placeId));
  const middle = STROKE_HEIGHT / 2;
  // A slow bow along the stroke, up or down by the seed, and a little lean.
  const bow = (random() - 0.5) * 3.2;
  const lean = (random() - 0.5) * 2.4;
  const upper: string[] = [];
  const lower: string[] = [];
  for (let index = 0; index <= STROKE_POINTS; index += 1) {
    const along = index / STROKE_POINTS;
    // Heavy where the brush lands (the first tenth), then thinning, then a tail that runs dry.
    const landing = Math.min(1, along / 0.1);
    const body = 1 - 0.55 * along;
    const tail = Math.min(1, (1 - along) / 0.16);
    const half = (0.9 + 4.3 * landing * body) * (0.25 + 0.75 * tail);
    const centre = middle + bow * Math.sin(along * Math.PI) + lean * (along - 0.5);
    const x = (6 + along * (STROKE_WIDTH - 12)).toFixed(1);
    upper.push(`${x} ${(centre - half - random() * 0.9).toFixed(2)}`);
    lower.push(`${x} ${(centre + half + random() * 0.9).toFixed(2)}`);
  }
  const outline = `M${upper.join('L')}L${lower.reverse().join('L')}Z`;
  return `<svg class="iw-arrival-brush" viewBox="0 0 ${STROKE_WIDTH} ${STROKE_HEIGHT}" preserveAspectRatio="none" aria-hidden="true">`
    + `<path d="${outline}" fill="var(--iw-ink)" filter="url(#iw-inkbleed)"/></svg>`;
}

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

/**
 * The style that shows the stroke from `lift` to `ink` of its length, with a wet edge at each end that is moving.
 * All of it: no mask at all, so the finished stroke is the plain drawing. None of it: hidden.
 */
export function strokeStyle(ink: number, lift: number): string {
  if (lift <= 0 && ink >= 1) return '';
  if (ink <= 0 || lift >= 1) return 'visibility:hidden';
  // Each edge runs from none to full ink over `WET_EDGE`, placed so 0 hides the stroke and 1 shows it whole.
  const from = lift <= 0 ? -WET_EDGE : lift * (1 + WET_EDGE) - WET_EDGE;
  const to = ink >= 1 ? 1 : ink * (1 + WET_EDGE) - WET_EDGE;
  const wash = `linear-gradient(90deg,transparent ${percent(from)},#000 ${percent(from + WET_EDGE)},#000 ${percent(to)},transparent ${percent(to + WET_EDGE)})`;
  return `-webkit-mask-image:${wash};mask-image:${wash}`;
}

/** The seal's style: clear until it is pressed, then its own ink. */
export const sealStyle = (seal: number): string => (seal >= 1 ? '' : seal <= 0 ? 'visibility:hidden' : `opacity:${seal.toFixed(3)}`);

/**
 * The card. It takes no click and no key: it is words on the screen, and the game goes on under it.
 * The kicker, the name and the line are written once. Only the stroke's and the seal's `style` change.
 */
export function arrivalView(arrival: ArrivalModel): ViewNode[] {
  return [h('div.iw-arrival-card.iw-paper', { key: arrival.placeId, role: 'status', 'data-place': arrival.placeId, 'data-motion': arrival.motion },
    h('small.iw-arrival-kicker', null, arrival.kicker),
    h('b.iw-arrival-title', null, arrival.title),
    h('i.iw-arrival-stroke', { html: brushStroke(arrival.placeId), style: strokeStyle(arrival.ink, arrival.lift), 'aria-hidden': 'true' }),
    h('span.iw-arrival-line', null, arrival.line),
    h('i.iw-arrival-seal', { html: SEAL, style: sealStyle(arrival.seal), 'aria-hidden': 'true' }))];
}
