/**
 * How much the look draws: the graphics settings set a ceiling, and B2's
 * frame-rate ladder sheds cost below it when frames run long. Cost goes in
 * this order: reflection size, fine strokes and hatching, the pen's
 * anti-aliasing, and only last the resolution.
 *
 * All of that is the world's. The heroes (the crew and the canoe) are drawn
 * apart, at the window's full size with every stroke, on every rung.
 */
import type { Settings } from '../settings/index.ts';

export interface Quality {
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

/** Each rung lowers one thing. Rung 0 sheds nothing. */
export const LADDER: readonly Partial<Quality>[] = [
  {},
  { reflection: 0.6 },
  { reflection: 0.5 },
  { fine: 0 },
  { ink: 1.5 },
  { ink: 1 },
  { resolution: 0.9 },
  { resolution: 0.8 },
  { resolution: 0.72 },
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
 * while it stays inside the pixel budget.
 */
export function drawingPixelRatio(width: number, height: number, devicePixelRatio: number, renderScale: number, resolution: number): number {
  const area = Math.max(1, width * height);
  const full = Math.min(devicePixelRatio, 2, Math.sqrt(PIXEL_BUDGET / area));
  const hardCap = Math.sqrt((2 * PIXEL_BUDGET) / area);
  return Math.max(0.25, Math.min(hardCap, full * renderScale * resolution));
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
  if (quality.reflection < ceiling.reflection) shed.push(`reflections ${Math.round((quality.reflection / ceiling.reflection) * 100)}%`);
  if (quality.fine < ceiling.fine) shed.push('fine strokes off');
  if (quality.ink < ceiling.ink) shed.push(`pen anti-aliasing ${quality.ink}×`);
  if (quality.resolution < 1) shed.push(`resolution ${Math.round(quality.resolution * 100)}%`);
  return shed.length > 0 ? `shed: ${shed.join(', ')}` : 'nothing shed';
}

/** The ladder changes at most once in this many seconds, up or down. */
export const LADDER_REST_SECONDS = 10;
/** Seconds of good frames before it tries the rung above. */
export const CLIMB_AFTER_SECONDS = 10;
/** A rung that ran long this many times is out for the session. */
export const FAILS_ALLOWED = 2;
/** A frame is long past this many milliseconds (under 49 a second). */
const LONG_FRAME = 20.5;

export interface LadderChange {
  /** Seconds of frames the ladder had seen when it changed. */
  at: number;
  from: number;
  to: number;
}

/**
 * Watches frame times and moves the world's quality one change at a time.
 *
 * - Down: two seconds of long frames step one rung down (two rungs under 29 frames a second, three under 20).
 * - Up: ten seconds of good frames step one rung back up.
 * - Never pumping: at most one change every ten seconds, and a rung that ran long twice is left alone for
 *   the session. So a rung that cannot hold is tried twice at most, ten seconds apart, and then never again.
 *
 * A settings change resets it.
 */
export class FrameLadder {
  rung: number;
  /** Every change this session, oldest first. */
  readonly changes: LadderChange[] = [];
  private readonly hold: boolean;
  /** The best rung still allowed: every rung above it ran long twice. */
  private best = 0;
  private fails: number[] = LADDER.map(() => 0);
  private clock = 0;
  private lastChange = Number.NEGATIVE_INFINITY;
  private slowWindows = 0;
  private slowest = 0;
  private goodSeconds = 0;
  private frames = 0;
  private windowSeconds = 0;
  private windowFrames = 0;

  constructor(options: { hold?: boolean; startRung?: number } = {}) {
    this.hold = options.hold ?? false;
    this.rung = Math.max(0, Math.min(LADDER.length - 1, options.startRung ?? 0));
  }

  /** The best rung the ladder may still climb to this session. */
  get bestAllowed(): number {
    return this.best;
  }

  /** Start over from rung 0 with every rung allowed again. A pinned ladder (`&hold=1`) stays where it is. */
  reset(): void {
    if (this.hold) return;
    this.rung = 0;
    this.best = 0;
    this.fails = LADDER.map(() => 0);
    this.lastChange = Number.NEGATIVE_INFINITY;
    this.slowWindows = 0;
    this.slowest = 0;
    this.goodSeconds = 0;
    this.frames = 0;
  }

  private move(rung: number): boolean {
    this.changes.push({ at: this.clock, from: this.rung, to: rung });
    this.rung = rung;
    this.lastChange = this.clock;
    this.slowWindows = 0;
    this.slowest = 0;
    this.goodSeconds = 0;
    return true;
  }

  /** Call once a frame with the real frame time. Returns true when the rung changed. */
  note(frameSeconds: number): boolean {
    // A stall (the tab was hidden, a shader compiled) says nothing about the frame rate.
    if (frameSeconds > 0.25) return false;
    this.frames += 1;
    this.clock += frameSeconds;
    this.windowSeconds += frameSeconds;
    this.windowFrames += 1;
    if (this.windowSeconds <= 0.5) return false;
    const span = this.windowSeconds;
    const milliseconds = (span / this.windowFrames) * 1000;
    this.windowSeconds = 0;
    this.windowFrames = 0;
    // The first three seconds compile shaders and fill buffers: they prove nothing.
    if (this.frames <= 180 || this.hold) return false;
    if (milliseconds > LONG_FRAME) {
      this.slowWindows += milliseconds > 30 ? 2 : 1;
      this.slowest = Math.max(this.slowest, milliseconds);
      this.goodSeconds = 0;
    } else {
      this.slowWindows = 0;
      this.slowest = 0;
      this.goodSeconds += span;
    }
    if (this.clock - this.lastChange < LADDER_REST_SECONDS) return false;
    const last = LADDER.length - 1;
    if (this.slowWindows >= 4 && this.rung < last) {
      this.fails[this.rung] += 1;
      if (this.fails[this.rung] >= FAILS_ALLOWED) this.best = Math.max(this.best, this.rung + 1);
      return this.move(Math.min(last, this.rung + (this.slowest > 50 ? 3 : this.slowest > 34 ? 2 : 1)));
    }
    if (this.goodSeconds >= CLIMB_AFTER_SECONDS && this.rung > this.best) return this.move(this.rung - 1);
    return false;
  }
}
