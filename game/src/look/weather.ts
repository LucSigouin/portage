/**
 * The weather as the look draws it. The rules own the weather: its kind, the
 * storm's level, the wind, what comes next and how soon. This turns that into
 * the few numbers the shaders need, and eases them so nothing snaps.
 *
 * Pure numbers. No clock of its own: `easeWeather` is moved by the look's
 * paint time, so a paused game holds every one of them still.
 */
import { TUNING, WEATHER } from '../data/index.ts';
import type { WeatherKind } from '../data/index.ts';
import { bearingVector } from '../sim/index.ts';
import type { WeatherState } from '../sim/index.ts';
import { daylightAt, overcastFor } from './daylight.ts';

/** Clear-day mist never thins past this visibility, metres: B2's look needs air in it. */
export const THINNEST_MIST = 1300;
/** Rain level of steady rain. A full storm is 1. */
export const STEADY_RAIN = 0.6;
/** The fog wall round the Beacon cuts the visibility to this share. */
const FOG_WALL = 0.35;

export interface WeatherLook {
  /** Cloud cover, 0 clear to 1. */
  overcast: number;
  /** How far the eye carries, metres. */
  visibility: number;
  /** 0 dry, `STEADY_RAIN` in rain, up to 1 in a full storm. */
  rain: number;
  /** The rules' storm level, 0 to 1. */
  storm: number;
  /** 0 clear air, 1 in fog weather: the far shore goes, the sky closes. */
  veil: number;
  /** The wind, metres a second, the way it blows toward. */
  windX: number;
  windZ: number;
  /** 0 to 1: how near the next weather is. It stands on the upwind horizon and climbs. */
  ahead: number;
  /** What that weather is, as shares that sum to 1 or less: its cloud is dark (storm), grey (rain), low and pale (fog), or a clearing. */
  aheadStorm: number;
  aheadRain: number;
  aheadFog: number;
  aheadClear: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smooth = (value: number): number => {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
};

/** Rain level for a weather: none, steady, or a storm's. */
export function rainFor(kind: WeatherKind, stormLevel: number): number {
  return WEATHER[kind].rain ? STEADY_RAIN + (1 - STEADY_RAIN) * clamp01(stormLevel) : 0;
}

/** 0 to 1: how near the next weather is. It shows for as long as the rules warn of a storm. */
export function aheadFor(weather: WeatherState): number {
  if (weather.nextKind === weather.kind) return 0;
  return smooth(1 - weather.secondsRemaining / TUNING.weather.stormWarningSeconds);
}

/** Where the weather is headed right now, from the rules' weather alone. */
export function weatherGoals(weather: WeatherState, inFogWall: boolean): WeatherLook {
  const wind = bearingVector(weather.windDirection);
  return {
    overcast: overcastFor(weather.kind, weather.stormLevel),
    visibility: Math.min(THINNEST_MIST, WEATHER[weather.kind].visibility * (inFogWall ? FOG_WALL : 1)),
    rain: rainFor(weather.kind, weather.stormLevel),
    storm: clamp01(weather.stormLevel),
    veil: weather.kind === 'fog' ? 1 : 0,
    windX: wind.x * weather.windSpeed,
    windZ: wind.z * weather.windSpeed,
    ahead: aheadFor(weather),
    aheadStorm: weather.nextKind === 'storm' ? 1 : 0,
    aheadRain: weather.nextKind === 'rain' ? 1 : 0,
    aheadFog: weather.nextKind === 'fog' ? 1 : 0,
    aheadClear: weather.nextKind === 'clear' ? 1 : 0,
  };
}

/** How fast each number closes on its goal, per second. The storm is the rules' own ramp, so it is followed closely. */
const EASE: Record<keyof WeatherLook, number> = {
  overcast: 0.8, visibility: 0.8, rain: 0.35, storm: 4, veil: 0.4, windX: 0.5, windZ: 0.5,
  ahead: 0.8, aheadStorm: 0.8, aheadRain: 0.8, aheadFog: 0.8, aheadClear: 0.8,
};

/** Move `now` toward `goal` by `seconds` of paint time. `snap` lands on it. 0 seconds moves nothing. */
export function easeWeather(now: WeatherLook, goal: WeatherLook, seconds: number, snap: boolean): void {
  for (const key of Object.keys(EASE) as (keyof WeatherLook)[]) {
    now[key] += (goal[key] - now[key]) * (snap ? 1 : 1 - Math.exp(-Math.max(0, seconds) * EASE[key]));
  }
}

/** Stars: out on a clear night, gone by day, behind cloud and in fog. */
export function starsAt(hour: number, look: WeatherLook): number {
  const night = 1 - daylightAt(hour);
  return night * night * clamp01(1 - look.overcast * 1.5) * (1 - look.veil);
}

/** The share of a lamp's light that shows: all of it at night, none in daylight, some under a storm's cloud. */
export function lampShareAt(hour: number, look: WeatherLook): number {
  const daylight = daylightAt(hour);
  return clamp01(1 - daylight + daylight * 0.4 * look.storm);
}

/** Wet ground and wet wood: follows the rain. */
export function wetFor(look: WeatherLook): number {
  return clamp01(look.rain / STEADY_RAIN);
}

/** The rain's fall, metres a second: straight down, pushed along by half the wind. Harder in a storm. */
export function rainVelocity(look: WeatherLook): [number, number, number] {
  return [look.windX * 0.5, -(6.5 + 2.5 * look.storm), look.windZ * 0.5];
}
