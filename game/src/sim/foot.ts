import { TUNING } from '../data/tuning.ts';
import type { GameState, StepInput } from './types.ts';
import { terrainHeight } from './world.ts';

/**
 * True when a step from one ground point to another is allowed: not deeper
 * than the wading limit, and not a climb steeper than the slope limit.
 */
export function canWalk(fromX: number, fromZ: number, toX: number, toZ: number): boolean {
  const toHeight = terrainHeight(toX, toZ);
  if (toHeight < -TUNING.foot.wadeDepth) return false;
  const distance = Math.hypot(toX - fromX, toZ - fromZ);
  if (distance < 1e-9) return true;
  const rise = toHeight - terrainHeight(fromX, fromZ);
  return rise / distance <= TUNING.foot.slopeLimit;
}

/** One fixed step on foot. Movement is relative to the camera bearing. */
export function stepOnFoot(state: GameState, input: StepInput, deltaSeconds: number): void {
  const player = state.player;
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

  // Try the full step, then slide along either axis.
  let nextX = x;
  let nextZ = z;
  if (canWalk(x, z, x + stepX, z + stepZ)) {
    nextX = x + stepX;
    nextZ = z + stepZ;
  } else if (Math.abs(stepX) > 1e-9 && canWalk(x, z, x + stepX, z)) {
    nextX = x + stepX;
  } else if (Math.abs(stepZ) > 1e-9 && canWalk(x, z, x, z + stepZ)) {
    nextZ = z + stepZ;
  }
  state.statistics.distanceWalked += Math.hypot(nextX - x, nextZ - z);
  player.position.x = nextX;
  player.position.z = nextZ;
  player.position.y = terrainHeight(nextX, nextZ);
  player.heading = Math.atan2(worldX, -worldZ);
}
