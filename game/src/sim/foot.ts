import { TUNING } from '../data/tuning.ts';
import type { GameState, PlayerState, StepInput } from './types.ts';
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

/**
 * One fixed step of one player on foot. The keys are relative to their camera bearing: W goes the way the camera
 * looks. The figure turns toward the way the keys point at `TUNING.foot.turnRate` and always walks the way it faces;
 * its speed eases toward the walk or the run (`acceleration`, `braking`), and eases out when the keys come up.
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
  let speed = gait !== undefined && gait.x === x && gait.z === z ? Math.max(0, Math.min(gait.speed, foot.runSpeed)) : 0;
  if (!pressing && speed === 0) return;

  // Turn toward the keys, at most the turn rate, then ease the speed toward what the keys ask at this heading.
  let heading = player.heading;
  let target = 0;
  if (pressing) {
    // Camera-relative to world: forward is the camera bearing, right is 90 degrees clockwise of it.
    const sine = Math.sin(input.cameraYaw);
    const cosine = Math.cos(input.cameraYaw);
    const wanted = Math.atan2(moveY * sine + moveX * cosine, moveY * cosine - moveX * sine);
    const offBy = bearingDifference(wanted, heading);
    const turn = foot.turnRate * deltaSeconds;
    heading = Math.abs(offBy) <= turn ? wanted : bearingDifference(heading + Math.sign(offBy) * turn, 0);
    target = (player.running ? foot.runSpeed : foot.walkSpeed) * Math.min(1, length) * turningShare(bearingDifference(wanted, heading));
  }
  speed = speed < target ? Math.min(target, speed + foot.acceleration * deltaSeconds) : Math.max(target, speed - foot.braking * deltaSeconds);
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
