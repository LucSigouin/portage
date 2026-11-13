/**
 * How a figure holds itself through a jump. The rules say how far into a jump a player is (`PlayerState.leap`, a
 * count of steps) and how high (`leapHeight`); this turns the count into the figure's own drawing: the legs trailing
 * from the push as it rises, the knees drawn up over the top, the legs reaching down for the ground, and the knees
 * giving and straightening once the feet are down.
 *
 * Everything here comes from the count alone, so every screen draws the same jump, and a figure nobody is jumping
 * with stands exactly as it stood: all four numbers are 0 outside a jump. No clock, nothing that moves by itself.
 */
import { LEAP_AIR_STEPS, LEAP_LAND_STEPS } from '../sim/index.ts';

/** Each 0 to 1. All 0: the figure stands or walks as it always did. */
export interface JumpPose {
  /** The legs trailing behind and the body leaning into it: the push just made. Strongest early in the rise. */
  trail: number;
  /** The knees drawn up under the body: over the top of the jump. */
  tuck: number;
  /** The arms thrown up and forward. */
  arms: number;
  /** The knees bent over planted feet, the hips dropped: the landing. */
  crouch: number;
}

export const NO_JUMP: Readonly<JumpPose> = Object.freeze({ trail: 0, tuck: 0, arms: 0, crouch: 0 });

/** 0 below `from`, 1 above `to`, eased between. */
function ramp(from: number, to: number, value: number): number {
  const share = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return share * share * (3 - 2 * share);
}

/** Up from 0 at `start` to 1 at `top`, and down to 0 again at `end`. */
const bump = (start: number, top: number, end: number, value: number): number => ramp(start, top, value) * (1 - ramp(top, end, value));

/**
 * The pose `steps` into a jump (`Leap.steps`; it may sit between two whole steps). The air is the first
 * `LEAP_AIR_STEPS`, the landing the `LEAP_LAND_STEPS` after them.
 */
export function jumpPose(steps: number): JumpPose {
  if (!(steps > 0) || steps >= LEAP_AIR_STEPS + LEAP_LAND_STEPS) return NO_JUMP;
  if (steps < LEAP_AIR_STEPS) {
    const air = steps / LEAP_AIR_STEPS;
    return {
      trail: bump(0, 0.14, 0.5, air),
      // Drawn up by the top (a little past half way: the rise is the longer half), let down again to meet the ground.
      tuck: bump(0.14, 0.55, 1, air),
      arms: ramp(0, 0.3, air) * (1 - 0.6 * ramp(0.6, 1, air)),
      crouch: 0,
    };
  }
  const landing = (steps - LEAP_AIR_STEPS) / LEAP_LAND_STEPS;
  return { trail: 0, tuck: 0, arms: 0.4 * (1 - ramp(0, 0.5, landing)), crouch: bump(0, 0.4, 1, landing) };
}
