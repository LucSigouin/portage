import { TUNING } from '../data/tuning.ts';
import type { GameState, PlayerState, StepInput } from './types.ts';
import { bodyBlocked } from './solids.ts';
import { groundHeight } from './world.ts';

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

/** One fixed step of one player on foot. Movement is relative to their camera bearing. */
export function stepOnFoot(state: GameState, player: PlayerState, input: StepInput, deltaSeconds: number): void {
  let moveX = input.moveX;
  let moveY = input.moveY;
  const length = Math.hypot(moveX, moveY);
  if (length > 1) {
    moveX /= length;
    moveY /= length;
  }
  const moving = length > 0.01;
  player.running = moving && input.run && player.energy >= TUNING.survival.minimumEnergyToExert;
  player.exerting = player.running;
  if (!moving) return;

  // Camera-relative to world: forward is the camera bearing, right is 90 degrees clockwise of it.
  const sine = Math.sin(input.cameraYaw);
  const cosine = Math.cos(input.cameraYaw);
  const worldX = moveY * sine + moveX * cosine;
  const worldZ = -moveY * cosine + moveX * sine;
  const speed = (player.running ? TUNING.foot.runSpeed : TUNING.foot.walkSpeed) * Math.min(1, length);
  const stepX = worldX * speed * deltaSeconds;
  const stepZ = worldZ * speed * deltaSeconds;
  const { x, z } = player.position;

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
  state.statistics.distanceWalked += Math.hypot(nextX - x, nextZ - z);
  player.position.x = nextX;
  player.position.z = nextZ;
  player.position.y = groundHeight(nextX, nextZ);
  player.heading = Math.atan2(worldX, -worldZ);
}
