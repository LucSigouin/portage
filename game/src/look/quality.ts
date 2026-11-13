/**
 * How much the look draws: the graphics settings set a ceiling, and B2's
 * frame-rate ladder sheds cost below it when frames run long. Cost goes in
 * this order: the weather's fine work, reflection size, fine strokes and
 * hatching, the pen's anti-aliasing, and only last the resolution, down to
 * half size and no further.
 *
 * All of that is the world's. The heroes (the crew and the canoe) are drawn
 * apart, at the window's full size with every stroke, on every rung.
 */
import type { Settings } from '../settings/index.ts';

export interface Quality {
  /** The weather's fine work: rain rings on the water, whitecaps, every rain stroke. 1 on, 0 shed (half the strokes stay). */
  weather: number;
  /** Reflection size against the drawing, each way. 0 skips the mirrored pass. */
  reflection: number;
  /** Fine strokes and hatching: 1 on, 0 off. */
  fine: number;
  /** Most ink-buffer texels per pixel, each way. 2 gives the pen four samples a pixel. */
  ink: number;
  /** Share of the full drawing size, each way. */
  resolution: number;
}

/** The drawing never exceeds this many pixels at render scale 1: 3840×2160. */
export const PIXEL_BUDGET = 8.3e6;

/** The canvas, and so the heroes, never exceed this many pixels: 7680×4320. Below it they are the window's full size. */
export const WINDOW_PIXEL_LIMIT = 3.4e7;

/**
 * The ladder never draws the world under this share of its full size, each way: at 40% the land's pen lines break
 * into dots. Only the player's own render scale can go lower.
 */
export const WORLD_FLOOR = 0.5;

/** Each rung lowers one thing. Rung 0 sheds nothing. */
export const LADDER: readonly Partial<Quality>[] = [
  {},
  { weather: 0 },
  { reflection: 0.6 },
  { reflection: 0.5 },
  { fine: 0 },
  { ink: 1.5 },
  { ink: 1 },
  { resolution: 0.9 },
  { resolution: 0.8 },
  { resolution: 0.72 },
  { resolution: 0.6 },
  { resolution: WORLD_FLOOR },
];

const REFLECTION_BY_WATER_DETAIL = { low: 0, medium: 0.5, high: 0.75 } as const;
const INK_BY_PRESET = { low: 1, medium: 1.5, high: 2, ultra: 2 } as const;
/** Hatching in the shadow tone: the look's only shadows. */
export const HATCH_BY_SHADOWS = { off: 0, low: 0.6, high: 1 } as const;
/** Metres between water vertices where the waves are drawn. */
export const WATER_CELL_BY_DETAIL = { low: 2, medium: 1.5, high: 1 } as const;

/** The most the settings allow. */
export function qualityCeiling(graphics: Settings['graphics']): Quality {
  return {
    weather: 1,
    reflection: graphics.qualityPreset === 'ultra' && graphics.waterDetail === 'high' ? 1 : REFLECTION_BY_WATER_DETAIL[graphics.waterDetail],
    fine: graphics.qualityPreset === 'low' ? 0 : 1,
    ink: INK_BY_PRESET[graphics.qualityPreset],
    resolution: 1,
  };
}

/** The ceiling with the first `rung` rungs of the ladder applied. A rung never raises anything. */
export function qualityAt(ceiling: Quality, rung: number): Quality {
  const quality = { ...ceiling };
  for (let index = 1; index <= Math.min(rung, LADDER.length - 1); index += 1) {
    const step = LADDER[index];
    for (const key of Object.keys(step) as (keyof Quality)[]) quality[key] = Math.min(quality[key], step[key] ?? quality[key]);
  }
  return quality;
}

/**
 * Renderer pixel ratio. At render scale 1 the drawing is the screen's full
 * size: 1:1 on a 1x screen up to 3840×2160, and above 1x on a dense screen
 * while it stays inside the pixel budget. `resolution` is the ladder's share:
 * with the render scale it never takes the world under `WORLD_FLOOR`.
 */
export function drawingPixelRatio(width: number, height: number, devicePixelRatio: number, renderScale: number, resolution: number): number {
  const area = Math.max(1, width * height);
  const full = Math.min(devicePixelRatio, 2, Math.sqrt(PIXEL_BUDGET / area));
  const hardCap = Math.sqrt((2 * PIXEL_BUDGET) / area);
  return Math.max(0.25, Math.min(hardCap, Math.max(full * renderScale * resolution, full * Math.min(renderScale, WORLD_FLOOR))));
}

/**
 * The canvas's pixel ratio: the window's own pixels (up to 2x on a dense screen). The heroes are drawn at this
 * size whatever the world is drawn at. Neither the render scale nor the ladder touches it.
 */
export function windowPixelRatio(width: number, height: number, devicePixelRatio: number): number {
  return Math.max(0.25, Math.min(devicePixelRatio, 2, Math.sqrt(WINDOW_PIXEL_LIMIT / Math.max(1, width * height))));
}

/** Words for the `&fps=1` readout: what was shed, if anything. */
export function shedNote(ceiling: Quality, quality: Quality): string {
  const shed: string[] = [];
  if (quality.weather < ceiling.weather) shed.push('weather detail off');
  if (quality.reflection < ceiling.reflection) shed.push(`reflections ${Math.round((quality.reflection / ceiling.reflection) * 100)}%`);
  if (quality.fine < ceiling.fine) shed.push('fine strokes off');
  if (quality.ink < ceiling.ink) shed.push(`pen anti-aliasing ${quality.ink}×`);
  if (quality.resolution < 1) shed.push(`resolution ${Math.round(quality.resolution * 100)}%`);
  return shed.length > 0 ? `shed: ${shed.join(', ')}` : 'nothing shed';
}


/** The first seconds compile shaders and fill buffers: they prove nothing. Seconds, not frames, so a slow chip waits no longer than a quick one. */
export const WARM_UP_SECONDS = 3;
/** While the ladder is still finding its level, a step down may follow a step down after this many seconds. */
export const DOWN_AGAIN_SECONDS = 2;
/** Finding its level lasts this long at most. A chip whose frames are never good for ten seconds running must not keep stepping every two. */
export const FINDING_SECONDS = 30;
/** Every other pair of changes is at least this many seconds apart. */
export const LADDER_REST_SECONDS = 10;
/** Seconds of good frames before it tries the rung above. */
export const CLIMB_AFTER_SECONDS = 10;
/** A rung that ran long this many times is out for the session. One that was climbed to and then ran long is out at once. */
export const FAILS_ALLOWED = 2;
/** A rung the chip test turned down is asked about again after a minute of good frames, then after five. Then it is out for the session. */
export const ASK_AGAIN_SECONDS: readonly number[] = [60, 300];
/** When the rung above takes under this share of what fits, there is more than one rung of room: the chip is timed from the top. */
export const ROOM_SHARE = 0.6;
/**
 * Half a second of frames is long when they come this much further apart than they were meant to: one frame in
 * twenty shown twice. On a 60 Hz screen that is 17.5 ms, under 57 a second.
 */
export const LONG_SHARE = 1.05;
/** The ladder sheds nothing to draw more than 60 a second: on a faster screen a frame is still on time at 16.7 ms. */
export const QUICKEST_DUE_SECONDS = 1 / 60;
/** A rung fits when its frame, drawn back to back, takes no more than this share of the gap: the rest is the browser's. */
export const FIT_SHARE = 0.9;
/** The chip test at load may take this long, milliseconds. A chip too slow to finish it starts on the last rung. */
export const CHIP_TEST_MILLISECONDS = 500;
/** Frames drawn and thrown away before a rung is timed: the first frame on new buffers pays for making them. */
export const WARM_UP_FRAMES = 1;
/**
 * The same before the chip test's first timing, when the first frame has just compiled every shader: the frame
 * after it still runs long. Measured on this Mac at 1920×1080: with one frame left out, the first timing read a
 * tenth or more over the next on most loads, on this chip and on one made 8 times slower (51.8 ms against 41.3).
 * With two it agrees (41.2 against 41.3). A third bought nothing.
 */
export const FIRST_WARM_UP_FRAMES = 2;
/** A clamped frame (the loop hands on 0.25 s at most) is a stall: a hidden tab, a compile. It says nothing about the frame rate. */
const STALL_SECONDS = 0.25;

/** The gap a frame is judged against, seconds: what the screen and the cap allow, but never under a 60th. */
export function judgedGap(dueSeconds: number | undefined): number {
  return Math.max(dueSeconds ?? QUICKEST_DUE_SECONDS, QUICKEST_DUE_SECONDS);
}

/** The longest a frame may take, drawn back to back, for its rung to fit: milliseconds. */
export function fitMilliseconds(dueSeconds: number | undefined): number {
  return judgedGap(dueSeconds) * 1000 * FIT_SHARE;
}

/**
 * The same for rung 0, where nothing is shed: the longest frame the ladder itself still calls on time
 * (17.5 ms on a 60 Hz screen). A machine at the line keeps every pixel, and play decides. The margin in
 * `fitMilliseconds` is for the rungs under it, where a wrong guess costs a visible change later.
 */
export function topFitMilliseconds(dueSeconds: number | undefined): number {
  return judgedGap(dueSeconds) * 1000 * LONG_SHARE;
}

/**
 * The honest cost of a frame, milliseconds. `warmUps` frames are drawn first and left out, each one waited for
 * (`finish` waits for the chip). Then the frame is drawn twice back to back, the chip waited for, and the time halved.
 * `warmed` is called once the warm-up is over: the caller's clock starts there.
 * `again`: given the timing, whether to time it a second time and keep the quicker.
 */
export function frameMilliseconds(
  draw: () => void, finish: () => void, now: () => number, warmUps: number,
  again: (milliseconds: number) => boolean = () => false, warmed: () => void = () => {},
): number {
  for (let frame = 0; frame < warmUps; frame += 1) {
    draw();
    finish();
  }
  warmed();
  const timed = (): number => {
    const from = now();
    draw();
    draw();
    finish();
    return (now() - from) / 2;
  };
  const first = timed();
  return again(first) ? Math.min(first, timed()) : first;
}

/**
 * The rung to start on: the best one whose frame fits, found by timing as few rungs as it can.
 * `measure(rung)` gives that rung's frame in milliseconds. A rung further down is taken to cost no more.
 * It looks from `top` down to just above `floor`, and answers `floor` when nothing above it fits: the last rung
 * is where a chip ends up whether it fits or not, so it is never timed.
 * When time runs out (`giveUp`) it keeps the best rung seen to fit, or `floor` if none was.
 * `topFits`: what fits on rung 0 (`topFitMilliseconds`), when that is more than `fits`.
 */
export function fittingRung(
  measure: (rung: number) => number, fits: number, giveUp: () => boolean = () => false, floor = LADDER.length - 1, top = 0, topFits = fits,
): number {
  if (top >= floor || measure(top) <= (top === 0 ? topFits : fits)) return Math.min(top, floor);
  let found = floor;
  let [from, to] = [top + 1, floor - 1];
  while (from <= to && !giveUp()) {
    const middle = Math.floor((from + to) / 2);
    if (measure(middle) <= fits) {
      found = middle;
      to = middle - 1;
    } else {
      from = middle + 1;
    }
  }
  return found;
}

/**
 * The answer to a ladder that asks about the rung above (`asked`): the rung to climb to, or null when `asked`
 * does not fit. Mostly that is `asked` itself. When `asked` fits with room to spare, the chip was busy the last
 * time it was timed: then the best rung that fits now (no higher than `top`) is found, and the ladder goes there
 * in one change instead of one rung every ten seconds.
 */
export function climbTo(
  asked: number, top: number, measure: (rung: number) => number, fits: number, giveUp: () => boolean = () => false, topFits = fits,
): number | null {
  const cost = measure(asked);
  if (cost > (asked === 0 ? topFits : fits)) return null;
  if (cost > fits * ROOM_SHARE || asked <= top) return asked;
  return fittingRung(measure, fits, giveUp, asked, top, topFits);
}

export interface LadderChange {
  /** Seconds of frames the ladder had seen when it changed. */
  at: number;
  from: number;
  to: number;
}

/**
 * Watches frame times and moves the world's quality one change at a time.
 *
 * - A frame is judged against the gap it was meant to have (`dueSeconds`), so a 30 Hz screen is not a slow chip.
 * - Down: two seconds of long frames step one rung down (two rungs under 29 a second on a 60 Hz screen, three under 20).
 * - Finding its level: at the start, after a settings change and when a game begins, steps down may follow each
 *   other two seconds apart. That ends at the first ten seconds of good frames, or after thirty seconds, whichever
 *   comes first. From then on every change is ten seconds from the last.
 * - Up: ten seconds of good frames step one rung back up. With `ask` set it asks first (`asking`, `answer`): the
 *   world view times the rung above and the ladder only climbs to a rung that fits. A rung turned down is asked
 *   about twice more (after one minute, then five), then left alone.
 * - Never pumping: a rung that was climbed to and then runs long is out for the session, and so is one that ran
 *   long twice. So a player sees a rung tried and dropped once at most. A failed climb goes back to the rung it
 *   left in one change, and after a failed climb of several rungs every later climb is one rung.
 *
 * A settings change resets it.
 */
export class FrameLadder {
  rung: number;
  /** Every change this session, oldest first. */
  readonly changes: LadderChange[] = [];
  private readonly hold: boolean;
  private readonly ask: boolean;
  /** The best rung still allowed: every rung above it is out for the session. */
  private best = 0;
  private fails: number[] = LADDER.map(() => 0);
  private refusals: number[] = LADDER.map(() => 0);
  private clock = 0;
  private warmUntil = WARM_UP_SECONDS;
  private lastChange = Number.NEGATIVE_INFINITY;
  private lastWentUp = false;
  /** The rung the last climb left: it held for ten seconds, so a climb that fails falls no further than this. */
  private cameFrom = 0;
  /** Still finding its level: no rung has held for ten seconds since the start, the last reset or the last `find()`. */
  private finding = true;
  private findingUntil = FINDING_SECONDS;
  /** A climb of more than one rung is allowed. Not after one has failed: the chip test was wrong about the room, so it is one rung at a time from then on. */
  private jumps = true;
  private wanted: number | null = null;
  private skipFrame = false;
  private slowWindows = 0;
  private slowest = 0;
  private goodSeconds = 0;
  private windowSeconds = 0;
  private windowDue = 0;

  constructor(options: { hold?: boolean; startRung?: number; ask?: boolean } = {}) {
    this.hold = options.hold ?? false;
    this.ask = options.ask ?? false;
    this.rung = Math.max(0, Math.min(LADDER.length - 1, options.startRung ?? 0));
  }

  /** The best rung the ladder may still climb to this session. */
  get bestAllowed(): number {
    return this.best;
  }

  /** Seconds of frames the ladder has seen: the clock its changes are stamped with. */
  get seconds(): number {
    return this.clock;
  }

  /** The rung the ladder would climb to if the chip has room for it, or null. Time that rung, then `answer`. */
  get asking(): number | null {
    return this.wanted;
  }

  /** Start over from rung 0 with every rung allowed again. A pinned ladder (`&hold=1`) stays where it is. */
  reset(): void {
    if (this.hold) return;
    this.rung = 0;
    this.best = 0;
    this.fails = LADDER.map(() => 0);
    this.refusals = LADDER.map(() => 0);
    this.lastChange = Number.NEGATIVE_INFINITY;
    this.lastWentUp = false;
    this.jumps = true;
    this.warmUntil = this.clock + WARM_UP_SECONDS;
    this.find();
  }

  /** The chip test's verdict: start on this rung. Not a change: nothing has been shown yet. */
  startOn(rung: number): void {
    if (!this.hold) this.rung = Math.max(0, Math.min(LADDER.length - 1, rung));
  }

  /** The work has changed (a game begins): find the level again, with quick steps down allowed. */
  find(): void {
    this.finding = true;
    this.findingUntil = this.clock + FINDING_SECONDS;
    this.wanted = null;
    this.slowWindows = 0;
    this.slowest = 0;
    this.goodSeconds = 0;
  }

  private move(rung: number): boolean {
    this.changes.push({ at: this.clock, from: this.rung, to: rung });
    this.lastWentUp = rung < this.rung;
    this.cameFrom = this.rung;
    this.rung = rung;
    this.lastChange = this.clock;
    this.wanted = null;
    this.slowWindows = 0;
    this.slowest = 0;
    this.goodSeconds = 0;
    return true;
  }

  /**
   * The answer to `asking`: the rung to climb to (the one asked about, or a better one that fits: see `climbTo`),
   * or null when the one asked about does not fit. Turned down, the ladder asks again after a minute of good
   * frames, then after five, then leaves that rung alone for the session. Returns true when the rung changed.
   */
  answer(rung: number | null): boolean {
    const asked = this.wanted;
    if (asked === null) return false;
    this.wanted = null;
    // The frame that held the timing was long for that reason alone.
    this.skipFrame = true;
    this.windowSeconds = 0;
    this.windowDue = 0;
    if (rung !== null) return this.move(Math.max(this.best, this.jumps ? Math.min(asked, rung) : asked));
    this.refusals[asked] += 1;
    if (this.refusals[asked] > ASK_AGAIN_SECONDS.length) this.best = Math.max(this.best, asked + 1);
    this.goodSeconds = 0;
    return false;
  }

  /**
   * Call once a frame with the real frame time and the gap the frame was meant to have (a 60th when not told).
   * Returns true when the rung changed.
   */
  note(frameSeconds: number, dueSeconds?: number): boolean {
    this.clock += Math.min(frameSeconds, STALL_SECONDS);
    if (frameSeconds >= STALL_SECONDS) return false;
    if (this.skipFrame) {
      this.skipFrame = false;
      return false;
    }
    this.windowSeconds += frameSeconds;
    this.windowDue += judgedGap(dueSeconds);
    if (this.windowSeconds <= 0.5) return false;
    const span = this.windowSeconds;
    // How far apart the frames came, against how far apart they were meant to: 1 is on time.
    const lateness = span / this.windowDue;
    this.windowSeconds = 0;
    this.windowDue = 0;
    if (this.clock <= this.warmUntil || this.hold) return false;
    if (this.clock > this.findingUntil) this.finding = false;
    if (lateness > LONG_SHARE) {
      this.slowWindows += lateness > 1.8 ? 2 : 1;
      this.slowest = Math.max(this.slowest, lateness);
      this.goodSeconds = 0;
      this.wanted = null;
    } else {
      this.slowWindows = 0;
      this.slowest = 0;
      this.goodSeconds += span;
      if (this.goodSeconds >= CLIMB_AFTER_SECONDS) this.finding = false;
    }
    const rested = this.clock - this.lastChange;
    const last = LADDER.length - 1;
    if (this.slowWindows >= 4 && this.rung < last) {
      if (rested < (this.finding && !this.lastWentUp ? DOWN_AGAIN_SECONDS : LADDER_REST_SECONDS)) return false;
      // A rung that runs long straight after the climb to it has had its one try.
      const climbFailed = this.lastWentUp;
      this.fails[this.rung] += 1;
      if (climbFailed || this.fails[this.rung] >= FAILS_ALLOWED) this.best = Math.max(this.best, this.rung + 1);
      // A climb that failed goes straight back to the rung that held, in one change, however far the climb was.
      if (climbFailed) {
        if (this.cameFrom - this.rung > 1) this.jumps = false;
        return this.move(this.cameFrom);
      }
      // Further in one change when badly behind.
      const drop = this.slowest > 3 ? 3 : this.slowest > 2.04 ? 2 : 1;
      return this.move(Math.min(last, this.rung + drop));
    }
    if (this.rung > this.best && rested >= LADDER_REST_SECONDS
      && this.goodSeconds >= (ASK_AGAIN_SECONDS[this.refusals[this.rung - 1] - 1] ?? CLIMB_AFTER_SECONDS)) {
      if (!this.ask) return this.move(this.rung - 1);
      this.wanted = this.rung - 1;
    }
    return false;
  }
}
