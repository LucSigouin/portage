/**
 * The arrival card: a chapter title in the middle of the screen, the first time the crew reaches a place
 * (Luc's bugfix list, Round 3). Built from the rules' `place_reached` events (`sim/places.ts`).
 *
 * This is the one thing in the interface that moves by itself, by Luc's own ask, and it is built to be gentle
 * (`game/LOOK.md`, "The arrival card"):
 *
 * - The words are whole and still from the card's first frame to its last. Only the ink round them moves:
 *   a brush stroke draws itself under the name, then the seal is pressed beside it.
 * - It arrives in `ARRIVAL.arrive` seconds, holds for `ARRIVAL.hold`, and leaves in `ARRIVAL.leave`: the stroke
 *   is lifted from the end it began at, then the card is taken away whole. Nothing loops.
 * - One card at a time. A second place waits its turn, with a breath between the two.
 * - Never over a panel, a conversation or the built view: it waits. A card cut short while its ink was still
 *   being drawn is shown again from the start; one cut short after that has been read, and is gone.
 * - `still`: the card is written whole, stands, and is taken away whole. Not one value changes in between.
 * - `off`: no card.
 *
 * It runs on real time, like the notes: a card is the screen's, not the world's.
 * Everything here is numbers and words. The drawing is `interface/arrival.ts`.
 */
import { PLACES_BY_ID } from '../../data/index.ts';
import type { PlaceId } from '../../data/index.ts';
import type { ArrivalCards } from '../../settings/index.ts';
import type { GameEvent } from '../../sim/index.ts';

/** The words of one card. */
export interface ArrivalWords {
  placeId: PlaceId;
  /** The small words over the name: "The Reach". */
  kicker: string;
  /** The place's name. */
  title: string;
  /** One short line under it. */
  line: string;
}

/** One frame of the card. */
export interface ArrivalModel extends ArrivalWords {
  motion: 'animated' | 'still';
  phase: 'arriving' | 'holding' | 'leaving';
  /** How much of the brush stroke is drawn, from its start: 0 none, 1 all of it. */
  ink: number;
  /** How much of it has been lifted again, from the same end, as the card leaves: 0 none, 1 all of it. */
  lift: number;
  /** The seal's ink: 0 not pressed yet, 1 pressed. */
  seal: number;
}

/** The card's times, in real seconds. */
export const ARRIVAL = {
  /** The brush stroke is drawn from here to here. */
  stroke: [0.1, 1.0],
  /** The seal takes its ink from here to here. */
  seal: [1.0, 1.3],
  /** Everything has arrived by now. The brief's limit is 1.5 s. */
  arrive: 1.3,
  /** The finished card stands this long. */
  hold: 2.0,
  /** The stroke is lifted for this long, then the card is taken away. */
  leave: 0.5,
  /** A still card stands this long, start to end. */
  still: 3.3,
  /** The breath between two cards, and after a panel closes. */
  gap: 0.8,
  /** One frame takes at most this much off the clock: a long frame as the card begins must not eat its ink. */
  frameCap: 0.1,
} as const;

/** How long an animated card is on the screen, start to end. */
export const ARRIVAL_TOTAL = ARRIVAL.arrive + ARRIVAL.hold + ARRIVAL.leave;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const share = (seconds: number, [from, to]: readonly [number, number]): number => clamp01((seconds - from) / (to - from));
/** Quick, then slowing: a brush that is drawn and lifts off. */
const easeOut = (value: number): number => 1 - (1 - value) * (1 - value);
const thousandth = (value: number): number => Math.round(value * 1000) / 1000;

/** The words for a place, or null when there is no such place. */
export function arrivalWords(placeId: PlaceId): ArrivalWords | null {
  const place = PLACES_BY_ID[placeId];
  return place ? { placeId: place.id, kicker: place.kicker, title: place.name, line: place.line } : null;
}

/** The cards a frame's events ask for, in order. */
export function arrivalsFromEvents(events: readonly GameEvent[]): ArrivalWords[] {
  const cards: ArrivalWords[] = [];
  for (const event of events) {
    if (event.type !== 'place_reached') continue;
    const words = arrivalWords(event.placeId);
    if (words) cards.push(words);
  }
  return cards;
}

/** The card `seconds` after it began. Null once it is over. */
export function arrivalFrame(words: ArrivalWords, motion: 'animated' | 'still', seconds: number): ArrivalModel | null {
  if (motion === 'still') {
    return seconds >= ARRIVAL.still ? null : { ...words, motion, phase: 'holding', ink: 1, lift: 0, seal: 1 };
  }
  if (seconds >= ARRIVAL_TOTAL) return null;
  const leaving = seconds - ARRIVAL.arrive - ARRIVAL.hold;
  return {
    ...words,
    motion,
    phase: seconds < ARRIVAL.arrive ? 'arriving' : leaving < 0 ? 'holding' : 'leaving',
    ink: thousandth(easeOut(share(seconds, ARRIVAL.stroke))),
    lift: thousandth(leaving <= 0 ? 0 : easeOut(clamp01(leaving / ARRIVAL.leave))),
    seal: thousandth(share(seconds, ARRIVAL.seal)),
  };
}

/** The cards waiting and the one on the screen. */
export class ArrivalQueue {
  private waiting: ArrivalWords[] = [];
  private showing: { words: ArrivalWords; motion: 'animated' | 'still'; seconds: number } | null = null;
  /** Seconds of free screen still owed before the next card. */
  private rest = 0;
  /** A card held at one moment, for a staged picture. */
  private pinned: ArrivalModel | null = null;

  /** A place was reached. A place already waiting or showing is not added twice. */
  add(words: ArrivalWords): void {
    if (this.showing?.words.placeId === words.placeId || this.waiting.some((entry) => entry.placeId === words.placeId)) return;
    this.waiting.push(words);
  }

  addAll(cards: readonly ArrivalWords[]): void {
    for (const words of cards) this.add(words);
  }

  /** How many cards wait behind the one showing. */
  get pending(): number {
    return this.waiting.length;
  }

  /**
   * One frame. `blocked`: something has the screen (a panel, a conversation, the built view, the lobby), so no card
   * may show. `cards` is the player's setting.
   */
  update(frameSeconds: number, blocked: boolean, cards: ArrivalCards): void {
    if (cards === 'off') {
      this.clear();
      return;
    }
    if (blocked) {
      // Cut short while its ink was being drawn: back to the front, to be shown whole. After that it has been read.
      if (this.showing && this.showing.seconds < ARRIVAL.arrive) this.waiting.unshift(this.showing.words);
      this.showing = null;
      this.rest = ARRIVAL.gap;
      return;
    }
    const seconds = Math.max(0, Math.min(frameSeconds, ARRIVAL.frameCap));
    if (this.showing) {
      this.showing.seconds += seconds;
      if (arrivalFrame(this.showing.words, this.showing.motion, this.showing.seconds) === null) {
        this.showing = null;
        this.rest = ARRIVAL.gap;
      }
      return;
    }
    if (this.rest > 0) {
      this.rest -= seconds;
      return;
    }
    const next = this.waiting.shift();
    // The card begins on this frame with its words whole and no ink yet. The clock starts on the next.
    if (next) this.showing = { words: next, motion: cards, seconds: 0 };
  }

  /** Forget every card: a new game, the lobby. */
  clear(): void {
    this.waiting = [];
    this.showing = null;
    this.rest = 0;
    this.pinned = null;
  }

  /**
   * Hold one card at one moment until `clear()`, whatever else happens. For staged pictures and their tests:
   * `seconds` after the card began, drawn as `motion`.
   */
  pin(placeId: PlaceId, seconds: number, motion: 'animated' | 'still' = 'animated'): void {
    const words = arrivalWords(placeId);
    this.pinned = words ? arrivalFrame(words, motion, seconds) : null;
  }

  /** The card to draw this frame, or null. */
  model(): ArrivalModel | null {
    if (this.pinned) return this.pinned;
    return this.showing ? arrivalFrame(this.showing.words, this.showing.motion, this.showing.seconds) : null;
  }
}
