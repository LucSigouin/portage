/**
 * The frame loop: `requestAnimationFrame`, a clamp on long frames, and the
 * frame-rate cap from the settings. The clock is injected, so tests drive it
 * with a fake.
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
  /** Runs one frame. `frameSeconds` is real time since the last one, clamped. */
  frame: (frameSeconds: number) => void;
  /** Frames per second to hold to. 0 = every display frame. Read each frame. */
  frameRateCap: () => number;
  /** Longest frame handed on, seconds. A tab coming back from the background does not jump the game. */
  maximumFrameSeconds?: number;
}

export interface FrameLoop {
  start(): void;
  stop(): void;
  readonly running: boolean;
  readonly stats: FrameStats;
}

/**
 * Display frames arrive a touch early or late. A frame within this many
 * milliseconds of being due runs now, so a 60 fps cap on a 60 Hz display
 * does not drop to 30.
 */
export const FRAME_DUE_TOLERANCE_MILLISECONDS = 2;

const STATS_WINDOW = 30;

export function createFrameLoop(options: FrameLoopOptions): FrameLoop {
  const { clock, frame } = options;
  const maximumFrameSeconds = options.maximumFrameSeconds ?? TUNING.maximumFrameSeconds;
  let handle: number | null = null;
  let lastFrameAt: number | null = null;
  let intervalTotal = 0;
  let workTotal = 0;
  let samples = 0;
  const stats: FrameStats = { framesPerSecond: 0, frameMilliseconds: 0, workMilliseconds: 0 };

  const tick = (timestamp: number): void => {
    handle = clock.requestFrame(tick);
    if (lastFrameAt === null) {
      // The first display frame only starts the clock.
      lastFrameAt = timestamp;
      return;
    }
    const elapsed = timestamp - lastFrameAt;
    const cap = options.frameRateCap();
    if (cap > 0 && elapsed < 1000 / cap - FRAME_DUE_TOLERANCE_MILLISECONDS) return;
    lastFrameAt = timestamp;

    const startedAt = clock.now();
    frame(Math.min(Math.max(elapsed, 0) / 1000, maximumFrameSeconds));
    workTotal += clock.now() - startedAt;
    intervalTotal += elapsed;
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
      lastFrameAt = null;
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
  };
}
