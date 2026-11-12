import type { WeatherKind } from '../data/types.ts';
import { TUNING } from '../data/tuning.ts';
import { WEATHER, WEATHER_KINDS } from '../data/weather.ts';
import { emit } from './inventory.ts';
import { nextRandom, randomBetween } from './random.ts';
import type { GameState, WeatherState } from './types.ts';
import { bearingDifference } from './world.ts';

/** Storms are never rolled before the first outrigger is built. */
function stormsAllowed(state: GameState): boolean {
  return state.canoe.attachments.includes('outrigger_port') || state.canoe.attachments.includes('outrigger_starboard');
}

function rollKind(state: GameState, after: WeatherKind): WeatherKind {
  const stormDue = stormsAllowed(state) && state.weather.changesSinceStorm >= TUNING.weather.changesBetweenStorms;
  const candidates = WEATHER_KINDS.filter((kind) => kind !== after && (kind !== 'storm' || stormDue));
  const totalWeight = candidates.reduce((sum, kind) => sum + WEATHER[kind].weight, 0);
  let pick = nextRandom(state) * totalWeight;
  for (const kind of candidates) {
    pick -= WEATHER[kind].weight;
    if (pick < 0) return kind;
  }
  return candidates[candidates.length - 1];
}

export function createWeather(): WeatherState {
  return {
    kind: 'clear',
    secondsRemaining: TUNING.weather.firstWeatherSeconds,
    nextKind: 'clear',
    nextSeconds: 0,
    stormLevel: 0,
    windDirection: Math.PI * 0.75,
    windTurn: 0,
    windSpeed: 3,
    windTarget: 3,
    stormWarned: false,
    changesSinceStorm: TUNING.weather.changesBetweenStorms,
  };
}

/** Roll the weather that follows the current one. */
export function rollNextWeather(state: GameState): void {
  const weather = state.weather;
  weather.nextKind = rollKind(state, weather.kind);
  const definition = WEATHER[weather.nextKind];
  weather.nextSeconds = randomBetween(state, definition.minimumSeconds, definition.maximumSeconds);
  weather.stormWarned = false;
}

/** Advance the weather clock, wind and storm level. */
export function updateWeather(state: GameState, deltaSeconds: number): void {
  const weather = state.weather;
  weather.secondsRemaining -= deltaSeconds;
  if (weather.nextKind === 'storm' && !weather.stormWarned && weather.secondsRemaining <= TUNING.weather.stormWarningSeconds) {
    weather.stormWarned = true;
    emit(state, { type: 'storm_warning', secondsUntilStorm: Math.max(0, weather.secondsRemaining) });
  }
  if (weather.secondsRemaining <= 0) {
    // A storm that was forecast before the first outrigger existed stays cancelled.
    weather.kind = weather.nextKind === 'storm' && !stormsAllowed(state) ? 'clear' : weather.nextKind;
    weather.changesSinceStorm = weather.kind === 'storm' ? 0 : weather.changesSinceStorm + 1;
    weather.secondsRemaining += weather.nextSeconds;
    const definition = WEATHER[weather.kind];
    weather.windTarget = randomBetween(state, definition.minimumWind, definition.maximumWind);
    // The new bearing is rolled as before. The wind swings round to it instead of jumping.
    weather.windTurn = bearingDifference(randomBetween(state, -Math.PI, Math.PI), weather.windDirection);
    emit(state, { type: 'weather_changed', kind: weather.kind });
    rollNextWeather(state);
  }
  const stormTarget = WEATHER[weather.kind].roughnessBonus;
  const stormStep = deltaSeconds / TUNING.weather.stormRampSeconds;
  if (weather.stormLevel < stormTarget) weather.stormLevel = Math.min(stormTarget, weather.stormLevel + stormStep);
  else if (weather.stormLevel > stormTarget) weather.stormLevel = Math.max(stormTarget, weather.stormLevel - stormStep);
  const windStep = TUNING.weather.windEasePerSecond * deltaSeconds;
  if (weather.windSpeed < weather.windTarget) weather.windSpeed = Math.min(weather.windTarget, weather.windSpeed + windStep);
  else if (weather.windSpeed > weather.windTarget) weather.windSpeed = Math.max(weather.windTarget, weather.windSpeed - windStep);
  const turnLeft = weather.windTurn ?? 0;
  if (turnLeft !== 0) {
    const turn = Math.sign(turnLeft) * Math.min(Math.abs(turnLeft), TUNING.weather.windTurnPerSecond * deltaSeconds);
    weather.windDirection = bearingDifference(weather.windDirection + turn, 0);
    weather.windTurn = turnLeft - turn;
  }
}
