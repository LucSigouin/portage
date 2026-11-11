import { ATTACHMENTS, HULL_TIERS } from '../data/canoe.ts';
import { TUNING } from '../data/tuning.ts';
import { WEATHER } from '../data/weather.ts';
import { emit, hasAttachment } from './inventory.ts';
import type { GameState, StepInput } from './types.ts';
import {
  bearingDifference, currentAt, hullGrounding, nearestIsland, regionAt, terrainHeight, waterRoughnessAt,
  waveGradient, waveHeight,
} from './world.ts';

/** Metres the hull must move off the spot it grounded on before it counts as afloat. */
const LAUNCH_CLEARANCE = 0.75;

const clamp = (value: number, minimum: number, maximum: number): number =>
  value < minimum ? minimum : value > maximum ? maximum : value;

/** Stability: 1 for the bare hull, plus attachment bonuses (the outriggers). */
export function canoeStability(state: GameState): number {
  let stability: number = TUNING.canoe.baseStability;
  for (const attachmentId of state.canoe.attachments) stability += ATTACHMENTS[attachmentId].stabilityBonus;
  return stability;
}

/** True when the canoe carries what the fog wall demands: lantern mast and radio. */
export function canCrossFog(state: GameState): boolean {
  return hasAttachment(state, 'lantern_mast') && hasAttachment(state, 'radio');
}

/**
 * How well the sail pulls on a heading, 0 to 1. Without a rudder it only
 * pulls downwind. With one it holds a reach, and stalls close to the wind.
 */
export function sailFactor(heading: number, windDirection: number, hasRudder: boolean): number {
  const offWind = Math.abs(bearingDifference(heading, windDirection));
  const downwind = Math.max(0, Math.cos(offWind));
  if (!hasRudder) return downwind;
  if (offWind > Math.PI - TUNING.canoe.noGoAngle) return 0;
  return TUNING.canoe.rudderReachShare + (1 - TUNING.canoe.rudderReachShare) * downwind;
}

/** Water coming over the side per second at the canoe's position. */
export function floodRate(state: GameState): number {
  const roughness = waterRoughnessAt(state.canoe.position.x, state.canoe.position.z, state.weather.stormLevel);
  return Math.max(0, roughness - canoeStability(state)) * TUNING.canoe.floodPerSecondPerExcess;
}

/** Mark the canoe as resting on the ground and remember where. */
export function beachCanoe(state: GameState): void {
  const canoe = state.canoe;
  const wasBeached = canoe.beached;
  canoe.beached = true;
  canoe.speed = 0;
  const islandId = nearestIsland(canoe.position.x, canoe.position.z);
  canoe.lastBeached = { x: canoe.position.x, z: canoe.position.z, heading: canoe.heading, islandId };
  if (!wasBeached) emit(state, { type: 'canoe_beached', islandId });
}

/** Settle the hull's height and tilt onto the water or the ground. */
export function settleCanoe(state: GameState, deltaSeconds: number): void {
  const canoe = state.canoe;
  const { x, z } = canoe.position;
  const roughness = waterRoughnessAt(x, z, state.weather.stormLevel);
  const surface = waveHeight(x, z, state.time, roughness);
  const keel = terrainHeight(x, z) + HULL_TIERS[canoe.hullTier].dimensions.draft;
  const blend = Math.min(1, TUNING.canoe.buoyancyResponse * deltaSeconds);
  canoe.position.y += (Math.max(surface, keel) - canoe.position.y) * blend;
  if (canoe.beached) {
    canoe.pitch += (0 - canoe.pitch) * blend;
    canoe.roll += (0 - canoe.roll) * blend;
    return;
  }
  const gradient = waveGradient(x, z, state.time, roughness);
  const forwardX = Math.sin(canoe.heading);
  const forwardZ = -Math.cos(canoe.heading);
  const alongSlope = gradient.x * forwardX + gradient.z * forwardZ;
  const acrossSlope = gradient.x * -forwardZ + gradient.z * forwardX;
  canoe.pitch += (Math.atan(alongSlope) - canoe.pitch) * blend;
  canoe.roll += (Math.atan(acrossSlope) - canoe.roll) * blend;
}

/** One fixed step of the canoe with the player aboard. */
export function stepCanoe(state: GameState, input: StepInput, deltaSeconds: number): void {
  const canoe = state.canoe;
  const player = state.player;
  const tuning = TUNING.canoe;
  const hull = HULL_TIERS[canoe.hullTier];
  const canExert = player.energy >= TUNING.survival.minimumEnergyToExert;

  // Bailing takes both hands.
  canoe.bailing = input.bail && canoe.waterLevel > 0 && canExert;
  if (canoe.bailing) canoe.waterLevel = Math.max(0, canoe.waterLevel - tuning.bailPerSecond * deltaSeconds);

  const paddle = canoe.bailing ? 0 : clamp(input.paddle, -1, 1);
  const powerStroke = input.powerStroke && paddle > 0 && canExert;
  player.exerting = canoe.bailing || powerStroke;
  player.running = false;

  // The fog wall: without a light and a signal every heading bends back out.
  const region = regionAt(canoe.position.x, canoe.position.z);
  const lost = region.fogWall && !canCrossFog(state);
  if (lost && !canoe.lostInFog) emit(state, { type: 'fog_turned_back' });
  canoe.lostInFog = lost;

  // Target speed from paddle and sail.
  let targetSpeed = paddle >= 0
    ? paddle * (powerStroke ? tuning.powerStrokeSpeed : tuning.paddleSpeed) * hull.speedMultiplier
    : paddle * tuning.backPaddleSpeed;
  if (lost) targetSpeed = Math.abs(targetSpeed);
  if (canoe.sailRaised && hasAttachment(state, 'mast_sail')) {
    const factor = sailFactor(canoe.heading, state.weather.windDirection, hasAttachment(state, 'rudder'));
    targetSpeed += factor > 0 ? state.weather.windSpeed * tuning.sailDrivePerWind * factor : -tuning.luffingDragSpeed;
  }
  targetSpeed = clamp(targetSpeed, -tuning.backPaddleSpeed, tuning.sailMaximumSpeed);
  targetSpeed *= 1 - tuning.waterloggedSpeedLoss * (canoe.waterLevel / tuning.capsizeLevel);
  const response = paddle !== 0 || canoe.sailRaised ? tuning.thrustResponse : tuning.coastResponse;
  canoe.speed += (targetSpeed - canoe.speed) * Math.min(1, response * deltaSeconds);

  // Turning.
  const turnRate = hasAttachment(state, 'rudder') ? tuning.rudderTurnRate : tuning.turnRate;
  const turnShare = tuning.turnAtRestShare + (1 - tuning.turnAtRestShare) * Math.min(1, Math.abs(canoe.speed) / tuning.turnFullSpeed);
  let turn = clamp(input.steer, -1, 1) * turnRate * turnShare * deltaSeconds;
  if (lost) {
    const backOut = bearingDifference(Math.PI, canoe.heading);
    turn = clamp(backOut, -tuning.fogTurnRate * deltaSeconds, tuning.fogTurnRate * deltaSeconds);
  }

  // Move, unless the ground is in the way. A grounded hull may still move
  // toward deeper water, so a beached canoe can always back off.
  const groundingBefore = hullGrounding(canoe.position.x, canoe.position.z, canoe.heading, canoe.hullTier);
  let heading = canoe.heading + turn;
  if (heading > Math.PI) heading -= 2 * Math.PI;
  if (heading <= -Math.PI) heading += 2 * Math.PI;
  if (turn !== 0) {
    const groundingTurned = hullGrounding(canoe.position.x, canoe.position.z, heading, canoe.hullTier);
    if (groundingTurned <= 0 || groundingTurned <= groundingBefore) canoe.heading = heading;
  }

  let velocityX = Math.sin(canoe.heading) * canoe.speed;
  let velocityZ = -Math.cos(canoe.heading) * canoe.speed;
  if (!canoe.beached) {
    const current = currentAt(canoe.position.x, canoe.position.z);
    const drift = state.weather.windSpeed * tuning.windDriftShare;
    velocityX += current.x + Math.sin(state.weather.windDirection) * drift;
    velocityZ += current.z - Math.cos(state.weather.windDirection) * drift;
  }
  const nextX = canoe.position.x + velocityX * deltaSeconds;
  const nextZ = canoe.position.z + velocityZ * deltaSeconds;
  const moved = Math.hypot(nextX - canoe.position.x, nextZ - canoe.position.z);
  if (moved > 1e-7) {
    const groundingNow = hullGrounding(canoe.position.x, canoe.position.z, canoe.heading, canoe.hullTier);
    const groundingNext = hullGrounding(nextX, nextZ, canoe.heading, canoe.hullTier);
    if (groundingNext <= 0 || groundingNext < groundingNow - 1e-6) {
      canoe.position.x = nextX;
      canoe.position.z = nextZ;
      state.statistics.distancePaddled += moved;
      // Launched once clear of the spot it grounded on, not on the first inch.
      if (canoe.beached && groundingNext <= 0
        && Math.hypot(nextX - canoe.lastBeached.x, nextZ - canoe.lastBeached.z) > LAUNCH_CLEARANCE) {
        canoe.beached = false;
        emit(state, { type: 'canoe_launched' });
      }
    } else if (Math.abs(canoe.speed) > 0.05 || !canoe.beached) {
      beachCanoe(state);
    } else {
      canoe.speed = 0;
    }
  }

  // Water in the hull: leak, rough water and rain while afloat.
  if (!canoe.beached) {
    const flood = floodRate(state);
    let gain = hull.leakPerSecond + flood;
    if (WEATHER[state.weather.kind].rain && !hasAttachment(state, 'canopy')) gain += tuning.rainPerSecond;
    canoe.waterLevel = Math.min(tuning.capsizeLevel, canoe.waterLevel + gain * deltaSeconds);
    if (flood > 0 && !canoe.takingWater) {
      emit(state, {
        type: 'rough_water',
        roughness: waterRoughnessAt(canoe.position.x, canoe.position.z, state.weather.stormLevel),
        stability: canoeStability(state),
      });
    }
    canoe.takingWater = flood > 0;
  } else {
    canoe.takingWater = false;
  }
  if (canoe.waterLevel >= tuning.swampWarningLevel && !canoe.swampWarned) {
    canoe.swampWarned = true;
    emit(state, { type: 'swamping_warning', waterLevel: canoe.waterLevel });
  } else if (canoe.waterLevel < tuning.swampWarningLevel - 10) {
    canoe.swampWarned = false;
  }

  settleCanoe(state, deltaSeconds);
  player.position.x = canoe.position.x;
  player.position.y = canoe.position.y;
  player.position.z = canoe.position.z;
  player.heading = canoe.heading;
}
