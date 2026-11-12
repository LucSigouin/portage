/**
 * The performance readout's arithmetic. No DOM, no graphics and no clock of
 * its own: every time comes in as a number, so the tests run it with fakes.
 */
import { FRAME_DUE_TOLERANCE_MILLISECONDS } from '../loop.ts';

/** The value below which `share` (0 to 1) of an ascending list falls. Nearest rank. 0 for an empty list. */
export function percentile(ascending: readonly number[], share: number): number {
  if (ascending.length === 0) return 0;
  const rank = Math.ceil(share * ascending.length);
  return ascending[Math.max(0, Math.min(ascending.length - 1, rank - 1))];
}

export const median = (values: readonly number[]): number => percentile([...values].sort((first, second) => first - second), 0.5);

/** How a list of frame times is spread. Milliseconds. */
export interface Spread {
  count: number;
  middle: number;
  p95: number;
  p99: number;
  worst: number;
  /** Frames longer than 33 ms (under 30 a second) and longer than 50 ms (under 20 a second). */
  over33: number;
  over50: number;
}

export function spreadOf(milliseconds: readonly number[]): Spread {
  const ascending = [...milliseconds].sort((first, second) => first - second);
  return {
    count: ascending.length,
    middle: percentile(ascending, 0.5),
    p95: percentile(ascending, 0.95),
    p99: percentile(ascending, 0.99),
    worst: ascending.length > 0 ? ascending[ascending.length - 1] : 0,
    over33: ascending.filter((value) => value > 33).length,
    over50: ascending.filter((value) => value > 50).length,
  };
}

/** The gaps between moments in a row. */
export function gapsBetween(moments: readonly number[]): number[] {
  const gaps: number[] = [];
  for (let index = 1; index < moments.length; index += 1) gaps.push(moments[index] - moments[index - 1]);
  return gaps;
}

/** Frames a second in each of `count` spans of `spanMilliseconds`, counted from `startAt`. */
export function framesPerSecondBySpan(frameMoments: readonly number[], startAt: number, spanMilliseconds: number, count: number): number[] {
  const frames = new Array<number>(count).fill(0);
  for (const moment of frameMoments) {
    const span = Math.floor((moment - startAt) / spanMilliseconds);
    if (span >= 0 && span < count) frames[span] += 1;
  }
  return frames.map((total) => total / (spanMilliseconds / 1000));
}

/**
 * The time between two frames the game's own loop lets through on a screen
 * that refreshes every `refreshMilliseconds`, with the frame-rate cap at
 * `cap` a second (0 = none). The loop's rule, from `client/loop.ts`: a screen
 * refresh is skipped while less than a cap's worth of time has passed, give
 * or take the tolerance. So a 60 cap on a 144 Hz screen runs every third
 * refresh: 48 frames a second, not 60.
 */
export function cappedFrameMilliseconds(refreshMilliseconds: number, cap: number): number {
  if (!(refreshMilliseconds > 0)) return 0;
  if (cap <= 0) return refreshMilliseconds;
  let refreshes = 1;
  while (refreshes * refreshMilliseconds < 1000 / cap - FRAME_DUE_TOLERANCE_MILLISECONDS) refreshes += 1;
  return refreshes * refreshMilliseconds;
}

export interface TimedFrames {
  /** Milliseconds a frame, one figure per batch: the batch's time, to the moment the graphics chip had finished it, over its frames. */
  perFrame: number[];
  /** Frames drawn and timed, all batches together. */
  frames: number;
}

export interface FrameTimer {
  /** Draw one whole frame. */
  draw(): void;
  /** Wait until the graphics chip has finished everything drawn so far (read one pixel back). */
  finish(): void;
  now(): number;
  /** Hand the browser a moment, so the page stays alive and the progress line is painted. */
  rest(): Promise<void>;
  /** The stage ends by the clock, never by a frame count: a slow chip draws fewer frames, not a longer stage. */
  budgetMilliseconds: number;
  /** Only to bound the work on a very fast chip. */
  maximumFrames?: number;
}

/** A batch is this many frames at most (LOOK.md's own count), and about this long. */
export const BATCH_FRAMES = 24;
const BATCH_MILLISECONDS = 150;

/**
 * The honest cost of a frame: frames drawn back to back, then waited for.
 * A screen holds a fast chip to its refresh rate, so counting frames a second
 * says nothing about one that could go faster. See LOOK.md, "What a frame costs".
 *
 * It runs for `budgetMilliseconds` and then one frame more at most. The first
 * frames after a change build buffers: up to two are drawn and thrown away,
 * the second only if the first was quick. Then one frame alone, which says how
 * many fit in a batch: 24 on a quick chip, down to one at a time on a slow one,
 * and never more than the time left.
 */
export async function timeFrames(timer: FrameTimer): Promise<TimedFrames> {
  const { draw, finish, now, rest } = timer;
  const maximumFrames = timer.maximumFrames ?? 4000;
  const startedAt = now();
  const deadline = startedAt + timer.budgetMilliseconds;
  for (let warm = 0; warm < 2 && now() - startedAt < timer.budgetMilliseconds * 0.25; warm += 1) {
    draw();
    finish();
  }
  await rest();
  const timed: TimedFrames = { perFrame: [], frames: 0 };
  let batch = 1;
  do {
    const before = now();
    for (let frame = 0; frame < batch; frame += 1) draw();
    finish();
    const each = (now() - before) / batch;
    timed.perFrame.push(each);
    timed.frames += batch;
    await rest();
    const fitting = Math.floor(Math.min(BATCH_MILLISECONDS, deadline - now()) / Math.max(each, 0.01));
    batch = Math.max(1, Math.min(BATCH_FRAMES, fitting, maximumFrames - timed.frames));
  } while (now() < deadline && timed.frames < maximumFrames);
  return timed;
}

/** One frame the game's loop ran: when the screen asked for it, and the frame time the loop handed the game (seconds). */
export interface LoopFrame {
  at: number;
  seconds: number;
}

/** A ladder change, placed on the clock of the watched run. */
export interface TimedChange {
  /** Seconds after `startAt`. */
  seconds: number;
  from: number;
  to: number;
}

/**
 * When each ladder change happened, on the page's clock. The ladder stamps a
 * change with the seconds of frames it has seen, so the frames are added up
 * the way it adds them until that count is reached.
 *
 * `ladderSecondsAtFirstFrame`: what the ladder had seen before `frames[0]`.
 */
export function placeLadderChanges(
  changes: readonly { at: number; from: number; to: number }[],
  ladderSecondsAtFirstFrame: number,
  frames: readonly LoopFrame[],
  startAt: number,
): TimedChange[] {
  const placed: TimedChange[] = [];
  let seen = ladderSecondsAtFirstFrame;
  let index = 0;
  for (const change of changes) {
    while (index < frames.length && seen + frames[index].seconds < change.at - 1e-6) {
      seen += frames[index].seconds;
      index += 1;
    }
    const moment = frames[Math.min(index, frames.length - 1)]?.at ?? startAt;
    placed.push({ seconds: (moment - startAt) / 1000, from: change.from, to: change.to });
  }
  return placed;
}

/** The rung at the end of each span, from the rung at the start and the changes since. */
export function rungBySpan(startRung: number, changes: readonly TimedChange[], spanSeconds: number, count: number): number[] {
  const rungs: number[] = [];
  for (let span = 0; span < count; span += 1) {
    let rung = startRung;
    for (const change of changes) if (change.seconds <= (span + 1) * spanSeconds) rung = change.to;
    rungs.push(rung);
  }
  return rungs;
}
