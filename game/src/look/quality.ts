/**
 * How much the look draws: the graphics settings set a ceiling, and B2's
 * frame-rate ladder sheds cost below it when frames run long. Cost goes in
 * this order: reflection size, fine strokes and hatching, the pen's
 * anti-aliasing, and only last the resolution.
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

/** Words for the `&fps=1` readout: what was shed, if anything. */
export function shedNote(ceiling: Quality, quality: Quality): string {
  const shed: string[] = [];
  if (quality.reflection < ceiling.reflection) shed.push(`reflections ${Math.round((quality.reflection / ceiling.reflection) * 100)}%`);
  if (quality.fine < ceiling.fine) shed.push('fine strokes off');
  if (quality.ink < ceiling.ink) shed.push(`pen anti-aliasing ${quality.ink}×`);
  if (quality.resolution < 1) shed.push(`resolution ${Math.round(quality.resolution * 100)}%`);
  return shed.length > 0 ? `shed: ${shed.join(', ')}` : 'nothing shed';
}

/**
 * Watches frame times. Two seconds of long frames step one rung down (two if
 * badly behind). It never climbs back by itself: a settings change resets it.
 */
export class FrameLadder {
  rung: number;
  private readonly hold: boolean;
  private slowWindows = 0;
  private frames = 0;
  private windowSeconds = 0;
  private windowFrames = 0;

  constructor(options: { hold?: boolean; startRung?: number } = {}) {
    this.hold = options.hold ?? false;
    this.rung = Math.max(0, Math.min(LADDER.length - 1, options.startRung ?? 0));
  }

  reset(): void {
    this.rung = 0;
    this.slowWindows = 0;
    this.frames = 0;
  }

  /** Call once a frame with the real frame time. Returns true when it stepped down. */
  note(frameSeconds: number): boolean {
    this.frames += 1;
    this.windowSeconds += frameSeconds;
    this.windowFrames += 1;
    if (this.windowSeconds <= 0.5) return false;
    const milliseconds = (this.windowSeconds / this.windowFrames) * 1000;
    this.windowSeconds = 0;
    this.windowFrames = 0;
    // The first three seconds compile shaders and fill buffers: they prove nothing.
    if (this.frames <= 180 || this.hold) return false;
    this.slowWindows = milliseconds > 20.5 ? this.slowWindows + (milliseconds > 30 ? 2 : 1) : 0;
    if (this.slowWindows < 4 || this.rung >= LADDER.length - 1) return false;
    this.rung += 1;
    this.slowWindows = 0;
    return true;
  }
}
