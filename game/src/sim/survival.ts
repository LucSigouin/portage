import type { IslandId, ItemAmount } from '../data/types.ts';
import { TUNING } from '../data/tuning.ts';
import { WEATHER } from '../data/weather.ts';
import { beachCanoe, settleCanoe } from './canoe.ts';
import { clearSpot, disembarkSpot, shoreSpotBeside } from './interact.ts';
import {
  addToStacks, atCanoe, campInReach, cargoSlots, connectedPlayers, emit, freeSeat, hasAttachment, playersAboard,
} from './inventory.ts';
import { notifySlept, updateQuests } from './quests.ts';
import type { FailCause, GameState, ItemStack, PlayerState } from './types.ts';
import { islandAt, islandLanding, landingBerth, regionAt, terrainHeight } from './world.ts';
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

/** True when a fire, a lit lantern or the canopy keeps the cold off this player. */
export function isSheltered(state: GameState, player: PlayerState): boolean {
  if (campInReach(player)) return true;
  if (!atCanoe(state, player)) return false;
  return hasAttachment(state, 'canopy') || hasAttachment(state, 'firebox')
    || (hasAttachment(state, 'lantern_mast') && state.canoe.lanternLit);
}

function warnWhenLow(state: GameState, player: PlayerState, meter: 'hunger' | 'thirst' | 'energy', before: number, after: number): void {
  const threshold = TUNING.survival.lowMeterWarning;
  if (before > threshold && after <= threshold) emit(state, { type: 'meter_low', meter }, player);
}

/** Drain and restore one player's three meters for one fixed step. */
export function updateSurvival(state: GameState, player: PlayerState, input: { moving: boolean }, deltaSeconds: number): void {
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
    else energyRate -= player.bailing ? tuning.bailEnergyPerSecond : tuning.powerStrokeEnergyPerSecond;
  } else {
    energyRate += input.moving ? tuning.lightActivityEnergyPerSecond : tuning.restEnergyPerSecond;
  }
  const sheltered = isSheltered(state, player);
  if (sheltered && campInReach(player)) energyRate += tuning.fireWarmthEnergyPerSecond;
  if (!sheltered) {
    if (isNight(state.time)) energyRate -= tuning.coldNightEnergyPerSecond * scale;
    energyRate -= tuning.stormEnergyPerSecond * scale * state.weather.stormLevel;
  }
  const starving = player.hunger <= 0 || player.thirst <= 0;
  if (starving) energyRate = Math.min(energyRate, 0) - tuning.starvingEnergyPerSecond * scale;
  let energy = player.energy + energyRate * deltaSeconds;
  if (starving) energy = Math.min(energy, tuning.starvingEnergyCap);
  player.energy = Math.max(0, Math.min(100, energy));

  warnWhenLow(state, player, 'hunger', hungerBefore, player.hunger);
  warnWhenLow(state, player, 'thirst', thirstBefore, player.thirst);
  warnWhenLow(state, player, 'energy', energyBefore, player.energy);
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

/**
 * Jump the world clock, keeping weather and passive attachments running.
 * `sleepers` are the players whose hunger and thirst drain through it.
 */
function skipTime(state: GameState, seconds: number, drainMultiplier: number, sleepers: readonly PlayerState[]): void {
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
  for (const player of sleepers) {
    player.hunger = Math.max(0, player.hunger - TUNING.survival.hungerPerSecond * scale * drainMultiplier * seconds);
    player.thirst = Math.max(0, player.thirst - TUNING.survival.thirstPerSecond * scale * drainMultiplier * seconds);
  }
}

export type SleepBlock = 'no_bed_in_reach' | 'not_tired';

/** Why this player cannot sleep here and now, or null. */
export function sleepBlocked(state: GameState, player: PlayerState): SleepBlock | null {
  const aboardBed = atCanoe(state, player) && state.canoe.beached && hasAttachment(state, 'canopy');
  const camp = campInReach(player);
  if (!aboardBed && !camp?.camp?.sleep) return 'no_bed_in_reach';
  const hour = hourOfDay(state.time);
  const bedtime = hour >= TUNING.time.sleepFromHour || hour < TUNING.time.dawnHour;
  if (!bedtime && player.energy > TUNING.time.sleepWhenEnergyAtMost) return 'not_tired';
  return null;
}

/**
 * A player lies down. The night only skips once the whole crew is asleep:
 * then everyone sleeps until dawn, energy refills, the respawn camp is set
 * and the clock jumps. Returns the hours slept, or 0 while still waiting.
 */
export function sleep(state: GameState, player: PlayerState): number {
  player.asleep = true;
  return skipNightIfCrewAsleep(state, player);
}

/**
 * Skip to dawn if everyone who is not away is asleep (and someone is). The
 * night never waits for an away player, and passes them by: their meters
 * stand still. `actor` is the one whose lying down, or leaving, settled it.
 * Returns the hours slept, or 0.
 */
export function skipNightIfCrewAsleep(state: GameState, actor: PlayerState): number {
  const sleepers = connectedPlayers(state);
  if (sleepers.length === 0 || !sleepers.every((member) => member.asleep)) return 0;

  for (const member of sleepers) {
    const camp = campInReach(member);
    if (camp?.camp?.sleep) state.respawnCampIslandId = camp.id;
  }
  const seconds = secondsUntilDawn(state.time);
  skipTime(state, seconds, TUNING.survival.sleepDrainMultiplier, sleepers);
  const hours = seconds / hourSeconds;
  for (const member of sleepers) {
    const starving = member.hunger <= 0 || member.thirst <= 0;
    member.energy = starving ? TUNING.survival.starvingEnergyCap : 100;
    member.asleep = false;
    emit(state, { type: 'slept', hours, islandId: member.islandId }, member);
  }
  emit(state, { type: 'autosave_requested', reason: 'sleeping' });
  notifySlept(state);
  updateQuests(state, actor);
  return hours;
}

/**
 * Where a fail puts a player: the last camp slept at (Home Knoll by
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

/** Take half of every stack. Returns what went, one entry per item. */
function loseHalf(stacks: ItemStack[]): ItemAmount[] {
  const lost: ItemAmount[] = [];
  for (const stack of stacks) {
    const loss = Math.floor(stack.count / 2);
    if (loss > 0) {
      stack.count -= loss;
      const existing = lost.find((entry) => entry.itemId === stack.itemId);
      if (existing) existing.count += loss;
      else lost.push({ itemId: stack.itemId, count: loss });
    }
  }
  return lost;
}

/** A failed player comes round: meters at 50, out of any talk or bed. */
function comeRound(player: PlayerState): void {
  player.hunger = TUNING.survival.failMeterValue;
  player.thirst = TUNING.survival.failMeterValue;
  player.energy = TUNING.survival.failMeterValue;
  player.exerting = false;
  player.running = false;
  player.paddling = false;
  player.bailing = false;
  player.asleep = false;
  player.dialogue = null;
}

function standAt(player: PlayerState, spot: { x: number; z: number }): void {
  player.mode = 'foot';
  player.seat = null;
  player.position.x = spot.x;
  player.position.z = spot.z;
  player.position.y = terrainHeight(spot.x, spot.z);
  player.islandId = islandAt(spot.x, spot.z);
}

/**
 * The canoe is lost and washes ashore with `victims`: they wake at the
 * respawn point with the canoe beached beside them, six hours later, meters
 * at 50, half of every cargo stack gone. Tools, attachments and key items
 * are untouched, and so is anyone not among the victims.
 */
function washAshore(state: GameState, cause: FailCause, victims: readonly PlayerState[]): void {
  const canoe = state.canoe;
  const respawn = respawnPoint(state);
  const lost = loseHalf(canoe.cargo);

  skipTime(state, TUNING.time.failSkipHours * hourSeconds, 0, []);
  for (const victim of victims) comeRound(victim);

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
  for (const victim of victims) {
    if (spot) {
      standAt(victim, clearSpot(state, victim, spot));
    } else {
      if (victim.mode !== 'canoe') victim.seat = freeSeat(state);
      victim.mode = 'canoe';
      victim.position.x = canoe.position.x;
      victim.position.y = canoe.position.y;
      victim.position.z = canoe.position.z;
      victim.islandId = null;
    }
    victim.regionId = regionAt(victim.position.x, victim.position.z).id;
  }
  state.statistics.fails += 1;
  for (const victim of victims) emit(state, { type: 'washed_ashore', cause, islandId: respawn.islandId, lost }, victim);
  updateQuests(state);
}

/** The canoe went under: everyone aboard washes ashore with it. An away player stays in their seat and rides along. */
export function applyCapsize(state: GameState): void {
  emit(state, { type: 'capsized' });
  washAshore(state, 'capsized', playersAboard(state).filter((player) => player.connected));
}

/**
 * A player ran out of energy. In a crew they fail alone: they wake on foot at
 * the respawn point with meters at 50 and half of every backpack stack gone,
 * while the canoe, the cargo, the clock and the others carry on.
 *
 * Two cases take the canoe along, as a capsize would: a crew of one (the solo
 * rule), and the last player aboard a canoe that is afloat, which would
 * otherwise drift off empty and strand the rest. Away players do not count
 * in either: the only one still playing is alone.
 */
export function applyExhaustion(state: GameState, player: PlayerState): void {
  emit(state, { type: 'exhausted' }, player);
  const present = connectedPlayers(state);
  const lastAboardAfloat = player.mode === 'canoe' && !state.canoe.beached
    && present.filter((member) => member.mode === 'canoe').length === 1;
  if (present.length <= 1 || lastAboardAfloat) {
    washAshore(state, 'exhausted', [player]);
    return;
  }
  const respawn = respawnPoint(state);
  const lost = loseHalf(player.backpack);
  comeRound(player);
  const spot = shoreSpotBeside(respawn.x, respawn.z, respawn.heading) ?? islandLanding(respawn.islandId).shore;
  standAt(player, clearSpot(state, player, spot));
  player.regionId = regionAt(player.position.x, player.position.z).id;
  state.statistics.fails += 1;
  emit(state, { type: 'washed_ashore', cause: 'exhausted', islandId: respawn.islandId, lost }, player);
  updateQuests(state, player);
}
