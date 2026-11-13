import { TUNING } from '../data/tuning.ts';
import type { GameState, Leap, PlayerState, StepInput } from './types.ts';
import { bodyBlocked } from './solids.ts';
import { bearingDifference, groundHeight } from './world.ts';

/**
 * True when a step from one ground point to another is allowed: not deeper
 * than the wading limit, and not a climb steeper than the slope limit.
 */
export function canWalk(fromX: number, fromZ: number, toX: number, toZ: number): boolean {
  const toHeight = groundHeight(toX, toZ);
  if (toHeight < -TUNING.foot.wadeDepth) return false;
  const distance = Math.hypot(toX - fromX, toZ - fromZ);
  if (distance < 1e-9) return true;
  const rise = toHeight - groundHeight(fromX, fromZ);
  return rise / distance <= TUNING.foot.slopeLimit;
}

/** Turns tried when a step runs into something solid, smallest first, each to the right and then the left. */
const SLIDE_TURNS = [15, 30, 45, 60, 75].map((degrees) => (degrees * Math.PI) / 180);

/**
 * A step turned off a solid and shortened to what is left of it along the new way (the cosine of the turn): the
 * walker slides round a trunk or along a wall, slower the more head-on they push, and stops dead only when they
 * push straight into it. Always the same turn for the same place and push, so a guest's screen agrees with the host.
 */
function slideAlong(stepX: number, stepZ: number, free: (toX: number, toZ: number) => boolean, x: number, z: number): { x: number; z: number } | null {
  for (const turn of SLIDE_TURNS) {
    const keep = Math.cos(turn);
    for (const side of [1, -1]) {
      const cosine = Math.cos(turn * side);
      const sine = Math.sin(turn * side);
      const toX = x + (stepX * cosine - stepZ * sine) * keep;
      const toZ = z + (stepX * sine + stepZ * cosine) * keep;
      if (free(toX, toZ)) return { x: toX, z: toZ };
    }
  }
  return null;
}

/**
 * The share of full speed a walker keeps while turning: all of it up to 60 degrees off the way the keys point (a
 * diagonal, a camera being turned), half at a right angle, none past 120 degrees, where the figure turns on the
 * spot before it sets off. So an about-face is a pivot, not a wide loop.
 */
function turningShare(offBy: number): number {
  return Math.max(0, Math.min(1, Math.cos(offBy) + 0.5));
}

const stepsIn = (seconds: number): number => Math.max(1, Math.round(seconds / TUNING.fixedStep));
/** Steps a jump rises, steps it falls, and the two together: the steps the feet are off the ground. */
export const LEAP_RISE_STEPS = stepsIn(TUNING.foot.jumpRiseSeconds);
export const LEAP_FALL_STEPS = stepsIn(TUNING.foot.jumpFallSeconds);
export const LEAP_AIR_STEPS = LEAP_RISE_STEPS + LEAP_FALL_STEPS;
/** Steps the knees give and straighten after the landing. A `Leap` counts up to the air and these, then it is over. */
export const LEAP_LAND_STEPS = stepsIn(TUNING.foot.jumpLandSeconds);
const LEAP_DONE_STEPS = LEAP_AIR_STEPS + LEAP_LAND_STEPS;
/** The key pressed again with this many steps of the fall left, or fewer, jumps again on landing. */
const LEAP_BUFFER_STEPS = stepsIn(TUNING.foot.jumpBufferSeconds);
/**
 * The longest a jump goes on changing a player after every key is up: a press at the last moment of a fall, the
 * landing, the jump it asked for and the knees after it. A guest's walk is followed this much longer (`net/walk.ts`).
 */
export const LEAP_COAST_STEPS = LEAP_BUFFER_STEPS + 1 + LEAP_DONE_STEPS;

/** True while the feet are off the ground. */
export function airborne(leap: Pick<Leap, 'steps'> | undefined): boolean {
  return leap !== undefined && leap.steps > 0 && leap.steps < LEAP_AIR_STEPS;
}

/**
 * How high the feet are above the ground, metres: up on one half of a parabola, down on a steeper one. `steps` may
 * sit between two whole steps (a guest's view between two states).
 */
export function leapHeight(leap: Pick<Leap, 'steps'> | undefined): number {
  if (!airborne(leap)) return 0;
  const steps = leap!.steps;
  const off = steps <= LEAP_RISE_STEPS ? 1 - steps / LEAP_RISE_STEPS : (steps - LEAP_RISE_STEPS) / LEAP_FALL_STEPS;
  return TUNING.foot.jumpHeight * (1 - off * off);
}

/**
 * A jump between two states, `share` of the way from the older to the newer, for a view placed between them. A jump
 * that ended in between runs out to its end; one that began anew in between is shown as the newer state has it.
 */
export function blendLeap(before: Leap | undefined, after: Leap | undefined, share: number): Leap | undefined {
  if (!before || before.steps <= 0 || before.steps >= LEAP_DONE_STEPS) {
    return after && after.steps > 0 && after.steps < LEAP_DONE_STEPS ? { ...after, steps: after.steps * share } : after;
  }
  const to = after ? after.steps : LEAP_DONE_STEPS;
  if (to < before.steps) return after;
  const steps = before.steps + (to - before.steps) * share;
  return after ? { ...after, steps } : steps < LEAP_DONE_STEPS ? { ...before, steps } : undefined;
}

/**
 * One step of a player's jump. A press on the ground takes off on this very step; one press is one jump, and the key
 * has to come up before the next. A press late in the fall (`jumpBufferSeconds`) is kept and jumps again on landing.
 * A jump carries on only from where the last step left the player (`carried`), as a walk does: anyone put somewhere
 * else is on the ground. Returns true when the feet are off the ground after this step. Never changes a `Leap` in
 * place: a guest's guess shares the truth's.
 */
function stepLeap(player: PlayerState, pressed: boolean, carried: boolean): boolean {
  const leap = player.leap;
  if (leap === undefined && !pressed) return false;
  let steps = carried ? leap?.steps ?? 0 : 0;
  let again = carried && (leap?.again ?? false);
  const fresh = pressed && !(leap?.held ?? false);
  if (steps > 0 && steps < LEAP_AIR_STEPS) {
    steps += 1;
    if (fresh && LEAP_AIR_STEPS - steps <= LEAP_BUFFER_STEPS) again = true;
  } else if (fresh || again) {
    steps = 1;
    again = false;
  } else if (steps >= LEAP_AIR_STEPS && steps < LEAP_DONE_STEPS) {
    steps += 1;
  }
  if (!pressed && (steps === 0 || steps >= LEAP_DONE_STEPS)) delete player.leap;
  else player.leap = { steps, held: pressed, again };
  return steps > 0 && steps < LEAP_AIR_STEPS;
}

/**
 * One fixed step of one player on foot. The keys are relative to their camera bearing: W goes the way the camera
 * looks. The figure turns toward the way the keys point at `TUNING.foot.turnRate` and always walks the way it faces;
 * its speed eases toward the walk or the run (`acceleration`, `braking`), and eases out when the keys come up.
 *
 * A jump (`input.jump`, `PlayerState.leap`) changes how the figure is carried, never where it may go: in the air it
 * keeps the speed it took off with (it can gain a little, it cannot brake) and turns at a share of the turn rate, and
 * every step is still a walker's step over the ground below: the same slopes, the same water, the same solids. So a
 * jump clears no tree, rock, wall, ledge or shore. `position.y` stays the ground's height.
 */
export function stepOnFoot(state: GameState, player: PlayerState, input: StepInput, deltaSeconds: number): void {
  const foot = TUNING.foot;
  // Nothing heard from this player for this step: they stay exactly as they are.
  if (input.hold) {
    player.running = false;
    player.exerting = false;
    return;
  }
  let moveX = input.moveX;
  let moveY = input.moveY;
  const length = Math.hypot(moveX, moveY);
  if (length > 1) {
    moveX /= length;
    moveY /= length;
  }
  const pressing = length > 0.01;
  player.running = pressing && input.run && player.energy >= TUNING.survival.minimumEnergyToExert;
  player.exerting = player.running;

  const { x, z } = player.position;
  // A walk carries on only from where the last step left the player. Anyone put somewhere else (a landing, a fail,
  // a load, a teleport in a test) starts from a stand: no lurch from a speed they had before.
  const gait = player.gait;
  const carried = gait !== undefined && gait.x === x && gait.z === z;
  let speed = carried ? Math.max(0, Math.min(gait.speed, foot.runSpeed)) : 0;
  const flying = stepLeap(player, input.jump === true, carried);
  if (!pressing && speed === 0 && player.leap === undefined) return;

  // Turn toward the keys, at most the turn rate, then ease the speed toward what the keys ask at this heading.
  let heading = player.heading;
  let target = 0;
  if (pressing) {
    // Camera-relative to world: forward is the camera bearing, right is 90 degrees clockwise of it.
    const sine = Math.sin(input.cameraYaw);
    const cosine = Math.cos(input.cameraYaw);
    const wanted = Math.atan2(moveY * sine + moveX * cosine, moveY * cosine - moveX * sine);
    const offBy = bearingDifference(wanted, heading);
    const turn = foot.turnRate * (flying ? foot.jumpAirControl : 1) * deltaSeconds;
    heading = Math.abs(offBy) <= turn ? wanted : bearingDifference(heading + Math.sign(offBy) * turn, 0);
    target = (player.running ? foot.runSpeed : foot.walkSpeed) * Math.min(1, length) * turningShare(bearingDifference(wanted, heading));
  }
  // In the air the speed at take-off is kept: it can gain a little toward what the keys ask, it cannot brake.
  if (flying) speed = Math.max(speed, Math.min(target, speed + foot.acceleration * foot.jumpAirControl * deltaSeconds));
  else speed = speed < target ? Math.min(target, speed + foot.acceleration * deltaSeconds) : Math.max(target, speed - foot.braking * deltaSeconds);
  player.heading = heading;
  player.gait = { speed, x, z };
  if (speed === 0) return;

  const stepX = Math.sin(heading) * speed * deltaSeconds;
  const stepZ = -Math.cos(heading) * speed * deltaSeconds;

  // Trees, rocks and landmarks hold a walker (Luc's list, line 1). One already in one (put there by a landing, a
  // fail or an old save) is not held by it: they walk out, and from then on it holds them.
  const held = !bodyBlocked(x, z);
  const free = (toX: number, toZ: number): boolean => canWalk(x, z, toX, toZ) && (!held || !bodyBlocked(toX, toZ));

  // Try the full step. Into a solid: slide along it, the smallest turn first. Then along either axis.
  let nextX = x;
  let nextZ = z;
  if (free(x + stepX, z + stepZ)) {
    nextX = x + stepX;
    nextZ = z + stepZ;
  } else {
    const slide = held && bodyBlocked(x + stepX, z + stepZ) ? slideAlong(stepX, stepZ, free, x, z) : null;
    if (slide) {
      nextX = slide.x;
      nextZ = slide.z;
    } else if (Math.abs(stepX) > 1e-9 && free(x + stepX, z)) {
      nextX = x + stepX;
    } else if (Math.abs(stepZ) > 1e-9 && free(x, z + stepZ)) {
      nextZ = z + stepZ;
    }
  }
  if (nextX === x && nextZ === z) return;
  state.statistics.distanceWalked += Math.hypot(nextX - x, nextZ - z);
  player.position.x = nextX;
  player.position.z = nextZ;
  player.position.y = groundHeight(nextX, nextZ);
  player.gait = { speed, x: nextX, z: nextZ };
}
