/**
 * The frame loop: `requestAnimationFrame`, a clamp on long frames, and the
 * frame-rate cap from the settings. The clock is injected, so tests drive it
 * with a fake.
 *
 * ## Pacing
 *
 * The rules step 60 times a second and a drawn frame shows the latest step.
 * So a frame should stand for whole rules steps, the same number every time,
 * and real time must not leak in through timestamps that wobble.
 *
 * - The loop measures the screen: the gap between display frames (`ScreenMeter`).
 * - The gap frames are due at is the screen's or the cap's, whichever is longer.
 * - When that gap is whole rules steps (a 60 cap on any screen of 60 Hz or
 *   more, any cap on a 60 or 30 Hz screen, a 30 cap anywhere), frames keep
 *   that beat: time owed builds up display frame by display frame, and each
 *   time a beat's worth is owed one frame runs and takes exactly that beat.
 *   The rest stays owed. A 60 cap so draws 60 frames a second on a 75, 90,
 *   120, 144 or 165 Hz screen, each with exactly one rules step, on the
 *   display frame nearest its beat. A screen that runs a hair off 60 gets one
 *   doubled or skipped frame when a whole beat has built up, never a flutter.
 * - A cap that is slower than the screen but not whole steps (90 on 144 Hz)
 *   keeps its own beat the same way.
 * - Otherwise (no cap on a 75 or 144 Hz screen, a 50 Hz screen) every display
 *   frame is a frame and gets the real time since the last one.
 * - Every frame is told the gap it was meant to have (`dueSeconds`).
 */
import { TUNING } from '../data/index.ts';

export interface LoopClock {
  /** `window.requestAnimationFrame`. The callback gets a timestamp in milliseconds. */
  requestFrame(callback: (timestampMilliseconds: number) => void): number;
  cancelFrame(handle: number): void;
  /** A high-resolution clock in milliseconds, for timing the work in a frame. */
  now(): number;
}

export interface FrameStats {
  /** Frames per second, averaged over the last second or so. */
  framesPerSecond: number;
  /** Average milliseconds from one frame to the next. */
  frameMilliseconds: number;
  /** Average milliseconds of work inside a frame. */
  workMilliseconds: number;
}

export interface FrameLoopOptions {
  clock: LoopClock;
  /**
   * Runs one frame. `frameSeconds` is the time the frame stands for, clamped: whole beats when frames
   * keep a beat, the real time since the last frame otherwise. `dueSeconds` is the gap the frame was
   * meant to have: what the screen and the cap allow.
   */
  frame: (frameSeconds: number, dueSeconds: number) => void;
  /** Frames per second to hold to. 0 = every display frame. Read each frame. */
  frameRateCap: () => number;
  /** Longest frame handed on, seconds. A tab coming back from the background does not jump the game. */
  maximumFrameSeconds?: number;
  /** One rules step, seconds. Frames stand for whole steps wherever the screen and the cap allow. */
  stepSeconds?: number;
}

export interface FrameLoop {
  start(): void;
  stop(): void;
  readonly running: boolean;
  readonly stats: FrameStats;
  /** The screen's own gap between display frames, milliseconds, as measured. 0 until it is known. */
  readonly screenMilliseconds: number;
}

/**
 * Display frames arrive a touch early or late. A frame within this many
 * milliseconds of being due runs now, so a 60 fps cap on a 60 Hz display
 * does not drop to 30. A cap within this much of the screen's own gap is the
 * screen's pace, and a gap within this much of whole rules steps is whole steps.
 */
export const FRAME_DUE_TOLERANCE_MILLISECONDS = 2;

/**
 * Display frames the loop only watches when it first starts, before it runs a frame. Nothing is
 * drawn in them, so their gaps are the screen's own even on a chip too slow to keep up with it.
 */
export const SCREEN_WATCH_FRAMES = 10;

/** Display-frame gaps the screen's rate is read from: about a second's worth. */
const SCREEN_WINDOW = 60;

/** A gap this long is not a display frame: the tab was hidden or the page stalled. */
const SCREEN_LONGEST_GAP_MILLISECONDS = 250;

/**
 * Measures the screen: the gap between display frames, in milliseconds.
 *
 * A busy frame makes a longer gap (the display frames it missed), never a
 * shorter one. So the reading is taken from the short end of the last
 * second's gaps: the gap a quarter of the way up, averaged with the gaps
 * close to it (browsers round timestamps, so a 144 Hz screen reads 6, 7, 7).
 *
 * The first reading comes from display frames in which nothing was drawn
 * (`watching`). After that the reading may get shorter at any time (a faster
 * screen, or a first reading taken while the page was busy) and may be
 * refined by a tenth, but never grows further: gaps that grow mean a busy
 * chip, not a slower screen.
 */
export class ScreenMeter {
  /** The screen's gap, milliseconds. 0 until the first reading. */
  milliseconds = 0;
  private readonly gaps = new Float64Array(SCREEN_WINDOW);
  private readonly sorted = new Float64Array(SCREEN_WINDOW);
  private count = 0;
  private next = 0;
  private watched = 0;
  /** The shortest reading so far: the mark later readings are held against. */
  private anchor = 0;

  /** True until enough undrawn display frames have gone by for a first reading. */
  get watching(): boolean {
    return this.anchor === 0;
  }

  /** One display frame came `gap` milliseconds after the last. */
  note(gap: number): void {
    // Not a display frame: a stall, a hidden tab, or two callbacks in one frame.
    if (!(gap >= 1) || gap > SCREEN_LONGEST_GAP_MILLISECONDS) return;
    this.gaps[this.next] = gap;
    this.next = (this.next + 1) % SCREEN_WINDOW;
    this.count = Math.min(this.count + 1, SCREEN_WINDOW);
    if (this.anchor === 0) {
      this.watched += 1;
      if (this.watched < SCREEN_WATCH_FRAMES) return;
      this.anchor = this.read();
      this.milliseconds = this.anchor;
      return;
    }
    const reading = this.read();
    if (reading < this.anchor * 0.9) this.anchor = reading;
    if (reading <= this.anchor * 1.1) this.milliseconds = reading;
  }

  /** The short end of the gaps on hand: the one a quarter of the way up, averaged with those close to it. */
  private read(): number {
    const sorted = this.sorted.subarray(0, this.count);
    sorted.set(this.gaps.subarray(0, this.count));
    sorted.sort();
    const quarter = sorted[Math.floor(this.count / 4)]!;
    const reach = Math.max(quarter * 0.2, 1.05);
    let total = 0;
    let near = 0;
    for (const gap of sorted) {
      if (Math.abs(gap - quarter) > reach) continue;
      total += gap;
      near += 1;
    }
    return total / near;
  }
}

/**
 * Milliseconds the loop holds in hand from the start. Frames that take two or three beats (a slow
 * chip) are counted by rounding the time owed down to whole beats; with nothing in hand a steady
 * run of them would sit exactly on that edge and wobble between two counts.
 */
const OWED_AT_REST = FRAME_DUE_TOLERANCE_MILLISECONDS;

const STATS_WINDOW = 30;

export function createFrameLoop(options: FrameLoopOptions): FrameLoop {
  const { clock, frame } = options;
  const maximumFrameSeconds = options.maximumFrameSeconds ?? TUNING.maximumFrameSeconds;
  const stepSeconds = options.stepSeconds ?? TUNING.fixedStep;
  const stepGap = stepSeconds * 1000;
  const screen = new ScreenMeter();
  let handle: number | null = null;
  /** When the last display frame came. */
  let lastDisplayAt: number | null = null;
  /** When the last frame ran. */
  let lastFrameAt: number | null = null;
  /**
   * Real milliseconds that have gone by and no frame has taken yet. It starts a touch in hand
   * (`OWED_AT_REST`) and stays between a hair early and one beat late.
   */
  let owed = OWED_AT_REST;
  let intervalTotal = 0;
  let workTotal = 0;
  let samples = 0;
  const stats: FrameStats = { framesPerSecond: 0, frameMilliseconds: 0, workMilliseconds: 0 };

  const tick = (timestamp: number): void => {
    handle = clock.requestFrame(tick);
    if (lastDisplayAt === null) {
      // The first display frame only starts the clock.
      lastDisplayAt = timestamp;
      return;
    }
    const gap = Math.max(timestamp - lastDisplayAt, 0);
    lastDisplayAt = timestamp;
    const watching = screen.watching;
    screen.note(gap);
    // Still learning the screen's rate: nothing runs, and the time spent watching is not a frame.
    if (watching) return;
    owed += gap;

    const cap = options.frameRateCap();
    const capGap = cap > 0 ? 1000 / cap : 0;
    const due = Math.max(capGap, screen.milliseconds);
    // The beat frames keep, if any: whole rules steps when the due gap is that, else the cap's own gap when the cap is what holds frames back.
    const steps = Math.round(due / stepGap);
    let beat = 0;
    let beatSeconds = 0;
    if (steps >= 1 && Math.abs(due - steps * stepGap) <= FRAME_DUE_TOLERANCE_MILLISECONDS) {
      beat = steps * stepGap;
      beatSeconds = steps * stepSeconds;
    } else if (cap > 0 && capGap > screen.milliseconds + FRAME_DUE_TOLERANCE_MILLISECONDS) {
      beat = capGap;
      beatSeconds = 1 / cap;
    }
    let frameSeconds: number;
    if (beat > 0) {
      // A frame runs when a beat is owed and takes the whole beats owed, so every frame stands for
      // the same time whichever display frame it lands on. The rest stays owed. A frame runs a
      // hair early but is only doubled a whole beat late: that slack is what stops a screen a
      // hair off the beat from fluttering between skipped and doubled frames.
      if (owed < beat - FRAME_DUE_TOLERANCE_MILLISECONDS) return;
      const beats = Math.max(1, Math.floor(owed / beat + 1e-6));
      owed -= beats * beat;
      frameSeconds = beats * beatSeconds;
    } else {
      // No beat to keep: every display frame is a frame, with the real time since the last.
      frameSeconds = Math.max(owed - OWED_AT_REST, 0) / 1000;
      owed = OWED_AT_REST;
    }
    if (frameSeconds > maximumFrameSeconds) {
      frameSeconds = maximumFrameSeconds;
      owed = OWED_AT_REST;
    }
    const dueSeconds = beat > 0 ? beatSeconds : due / 1000;
    const interval = timestamp - (lastFrameAt ?? timestamp - gap);
    lastFrameAt = timestamp;

    const startedAt = clock.now();
    frame(frameSeconds, dueSeconds);
    workTotal += clock.now() - startedAt;
    intervalTotal += interval;
    samples += 1;
    if (samples >= STATS_WINDOW) {
      stats.frameMilliseconds = intervalTotal / samples;
      stats.framesPerSecond = stats.frameMilliseconds > 0 ? 1000 / stats.frameMilliseconds : 0;
      stats.workMilliseconds = workTotal / samples;
      intervalTotal = 0;
      workTotal = 0;
      samples = 0;
    }
  };

  return {
    start(): void {
      if (handle !== null) return;
      // The time spent stopped is not a frame. The screen's rate, once known, is kept.
      lastDisplayAt = null;
      lastFrameAt = null;
      owed = OWED_AT_REST;
      handle = clock.requestFrame(tick);
    },
    stop(): void {
      if (handle === null) return;
      clock.cancelFrame(handle);
      handle = null;
    },
    get running(): boolean {
      return handle !== null;
    },
    stats,
    get screenMilliseconds(): number {
      return screen.milliseconds;
    },
  };
}
