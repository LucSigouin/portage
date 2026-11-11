import type { IslandId, ItemAmount } from '../data/types.ts';
import { TUNING } from '../data/tuning.ts';
import { WEATHER } from '../data/weather.ts';
import { beachCanoe, settleCanoe } from './canoe.ts';
import { disembarkSpot } from './interact.ts';
import {
  addToStacks, atCanoe, campInReach, cargoSlots, emit, hasAttachment,
} from './inventory.ts';
import { notifySlept, updateQuests } from './quests.ts';
import type { FailCause, GameState } from './types.ts';
import { islandAt, landingBerth, regionAt, terrainHeight } from './world.ts';
import { updateWeather } from './weather.ts';

const { daySeconds, hourSeconds } = TUNING.time;

/** Hour of the day, 0 to 24. */
export function hourOfDay(time: number): number {
  return (((time % daySeconds) + daySeconds) % daySeconds) / hourSeconds;
}

export function isNight(time: number): boolean {
  const hour = hourOfDay(time);
  return hour >= TUNING.time.nightStartHour || hour < TUNING.time.dawnHour;
}

/** Seconds until the next dawn. */
export function secondsUntilDawn(time: number): number {
  const hour = hourOfDay(time);
  const hours = hour < TUNING.time.dawnHour ? TUNING.time.dawnHour - hour : 24 - hour + TUNING.time.dawnHour;
  return hours * hourSeconds;
}

/** True when a fire, a lit lantern or the canopy keeps the cold off. */
export function isSheltered(state: GameState): boolean {
  if (campInReach(state)) return true;
  if (!atCanoe(state)) return false;
  return hasAttachment(state, 'canopy') || hasAttachment(state, 'firebox')
    || (hasAttachment(state, 'lantern_mast') && state.canoe.lanternLit);
}

function warnWhenLow(state: GameState, meter: 'hunger' | 'thirst' | 'energy', before: number, after: number): void {
  const threshold = TUNING.survival.lowMeterWarning;
  if (before > threshold && after <= threshold) emit(state, { type: 'meter_low', meter });
}

/** Drain and restore the three meters for one fixed step. */
export function updateSurvival(state: GameState, input: { moving: boolean }, deltaSeconds: number): void {
  const player = state.player;
  const tuning = TUNING.survival;
  const scale = TUNING.difficultyDrainScale[state.difficulty];
  const hungerBefore = player.hunger;
  const thirstBefore = player.thirst;
  const energyBefore = player.energy;

  player.hunger = Math.max(0, player.hunger
    - tuning.hungerPerSecond * scale * (player.exerting ? tuning.exertionHungerMultiplier : 1) * deltaSeconds);
  player.thirst = Math.max(0, player.thirst
    - tuning.thirstPerSecond * scale * (player.exerting ? tuning.exertionThirstMultiplier : 1) * deltaSeconds);

  let energyRate = 0;
  if (player.exerting) {
    if (player.mode === 'foot') energyRate -= tuning.runEnergyPerSecond;
    else energyRate -= state.canoe.bailing ? tuning.bailEnergyPerSecond : tuning.powerStrokeEnergyPerSecond;
  } else {
    energyRate += input.moving || player.harvest ? tuning.lightActivityEnergyPerSecond : tuning.restEnergyPerSecond;
  }
  const sheltered = isSheltered(state);
  if (sheltered && campInReach(state)) energyRate += tuning.fireWarmthEnergyPerSecond;
  if (!sheltered) {
    if (isNight(state.time)) energyRate -= tuning.coldNightEnergyPerSecond * scale;
    energyRate -= tuning.stormEnergyPerSecond * scale * state.weather.stormLevel;
  }
  const starving = player.hunger <= 0 || player.thirst <= 0;
  if (starving) energyRate = Math.min(energyRate, 0) - tuning.starvingEnergyPerSecond * scale;
  let energy = player.energy + energyRate * deltaSeconds;
  if (starving) energy = Math.min(energy, tuning.starvingEnergyCap);
  player.energy = Math.max(0, Math.min(100, energy));

  warnWhenLow(state, 'hunger', hungerBefore, player.hunger);
  warnWhenLow(state, 'thirst', thirstBefore, player.thirst);
  warnWhenLow(state, 'energy', energyBefore, player.energy);
}

function addToCargo(state: GameState, itemId: ItemAmount['itemId'], count: number): number {
  const leftover = addToStacks(state.canoe.cargo, cargoSlots(state), itemId, count);
  if (leftover < count) emit(state, { type: 'item_gained', itemId, count: count - leftover, container: 'cargo' });
  return count - leftover;
}

/**
 * Attachments that work by themselves: the rain catcher, the fishing rig and
 * the planter. Runs every step and through sleep.
 */
export function updatePassiveAttachments(state: GameState, deltaSeconds: number, timeBefore: number): void {
  const canoe = state.canoe;
  if (hasAttachment(state, 'rain_catcher') && WEATHER[state.weather.kind].rain) {
    canoe.rainProgress = Math.min(1, canoe.rainProgress + deltaSeconds / TUNING.canoe.rainCatcherSecondsPerWater);
    if (canoe.rainProgress >= 1 && addToCargo(state, 'clean_water', 1) > 0) {
      canoe.rainProgress = 0;
      emit(state, { type: 'rain_collected' });
    }
  }
  if (hasAttachment(state, 'fishing_rig') && canoe.beached) {
    canoe.fishProgress = Math.min(1, canoe.fishProgress + deltaSeconds / TUNING.canoe.fishingRigSecondsPerFish);
    if (canoe.fishProgress >= 1 && addToCargo(state, 'raw_fish', 1) > 0) {
      canoe.fishProgress = 0;
      emit(state, { type: 'fish_caught' });
    }
  }
  if (hasAttachment(state, 'planter')) {
    const dawnOffset = TUNING.time.dawnHour * hourSeconds;
    const dawnsBefore = Math.floor((timeBefore - dawnOffset) / daySeconds);
    const dawnsNow = Math.floor((state.time - dawnOffset) / daySeconds);
    if (dawnsNow > dawnsBefore) {
      const gathered = addToCargo(state, 'berries', TUNING.canoe.planterBerries)
        + addToCargo(state, 'cattail_root', TUNING.canoe.planterRoots);
      if (gathered > 0) emit(state, { type: 'planter_harvested' });
    }
  }
}

/** Jump the world clock, keeping weather and passive attachments running. */
function skipTime(state: GameState, seconds: number, drainMultiplier: number): void {
  const scale = TUNING.difficultyDrainScale[state.difficulty];
  let remaining = seconds;
  while (remaining > 1e-9) {
    const chunk = Math.min(1, remaining);
    const timeBefore = state.time;
    state.time += chunk;
    updateWeather(state, chunk);
    updatePassiveAttachments(state, chunk, timeBefore);
    remaining -= chunk;
  }
  state.player.hunger = Math.max(0, state.player.hunger - TUNING.survival.hungerPerSecond * scale * drainMultiplier * seconds);
  state.player.thirst = Math.max(0, state.player.thirst - TUNING.survival.thirstPerSecond * scale * drainMultiplier * seconds);
}

export type SleepBlock = 'no_bed_in_reach' | 'not_tired';

/** Why the player cannot sleep here and now, or null. */
export function sleepBlocked(state: GameState): SleepBlock | null {
  const aboardBed = atCanoe(state) && state.canoe.beached && hasAttachment(state, 'canopy');
  const camp = campInReach(state);
  if (!aboardBed && !camp?.camp?.sleep) return 'no_bed_in_reach';
  const hour = hourOfDay(state.time);
  const bedtime = hour >= TUNING.time.sleepFromHour || hour < TUNING.time.dawnHour;
  if (!bedtime && state.player.energy > TUNING.time.sleepWhenEnergyAtMost) return 'not_tired';
  return null;
}

/** Sleep until dawn: refill energy, set the respawn camp, skip the clock. */
export function sleep(state: GameState): number {
  const camp = campInReach(state);
  if (camp?.camp?.sleep) state.respawnCampIslandId = camp.id;
  const seconds = secondsUntilDawn(state.time);
  skipTime(state, seconds, TUNING.survival.sleepDrainMultiplier);
  const starving = state.player.hunger <= 0 || state.player.thirst <= 0;
  state.player.energy = starving ? TUNING.survival.starvingEnergyCap : 100;
  state.player.harvest = null;
  const hours = seconds / hourSeconds;
  emit(state, { type: 'slept', hours, islandId: state.player.islandId });
  emit(state, { type: 'autosave_requested', reason: 'sleeping' });
  notifySlept(state);
  updateQuests(state);
  return hours;
}

/**
 * Where a fail puts the player: the last camp slept at (Home Knoll by
 * default), or with the canopy wherever the canoe was last beached.
 */
export function respawnPoint(state: GameState): { islandId: IslandId; x: number; z: number; heading: number; mobile: boolean } {
  if (hasAttachment(state, 'canopy')) {
    const { x, z, heading, islandId } = state.canoe.lastBeached;
    return { islandId, x, z, heading, mobile: true };
  }
  const islandId = state.respawnCampIslandId;
  return { islandId, ...landingBerth(islandId, state.canoe.hullTier), mobile: false };
}

/**
 * Fail: wake at the respawn point, canoe beached beside you, six hours later,
 * meters at 50, half of every cargo stack gone. Tools, attachments and key
 * items are untouched.
 */
export function applyFail(state: GameState, cause: FailCause): void {
  emit(state, { type: cause });
  const player = state.player;
  const canoe = state.canoe;
  const respawn = respawnPoint(state);

  const lost: ItemAmount[] = [];
  for (const stack of canoe.cargo) {
    const loss = Math.floor(stack.count / 2);
    if (loss > 0) {
      stack.count -= loss;
      const existing = lost.find((entry) => entry.itemId === stack.itemId);
      if (existing) existing.count += loss;
      else lost.push({ itemId: stack.itemId, count: loss });
    }
  }

  skipTime(state, TUNING.time.failSkipHours * hourSeconds, 0);
  player.hunger = TUNING.survival.failMeterValue;
  player.thirst = TUNING.survival.failMeterValue;
  player.energy = TUNING.survival.failMeterValue;
  player.harvest = null;
  player.exerting = false;
  player.running = false;
  state.dialogue = null;

  canoe.position.x = respawn.x;
  canoe.position.z = respawn.z;
  canoe.heading = respawn.heading;
  canoe.speed = 0;
  canoe.waterLevel = 0;
  canoe.sailRaised = false;
  canoe.bailing = false;
  canoe.lostInFog = false;
  canoe.takingWater = false;
  canoe.swampWarned = false;
  canoe.beached = false;
  beachCanoe(state);
  canoe.position.y = terrainHeight(canoe.position.x, canoe.position.z);
  settleCanoe(state, 1);

  const spot = disembarkSpot(state);
  if (spot) {
    player.mode = 'foot';
    player.position.x = spot.x;
    player.position.z = spot.z;
    player.position.y = terrainHeight(spot.x, spot.z);
    player.islandId = islandAt(spot.x, spot.z);
  } else {
    player.mode = 'canoe';
    player.position.x = canoe.position.x;
    player.position.y = canoe.position.y;
    player.position.z = canoe.position.z;
    player.islandId = null;
  }
  player.regionId = regionAt(player.position.x, player.position.z).id;
  state.statistics.fails += 1;
  emit(state, { type: 'washed_ashore', cause, islandId: respawn.islandId, lost });
  updateQuests(state);
}
