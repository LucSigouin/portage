import type { WeatherDefinition, WeatherKind } from './types.ts';

/**
 * Weather kinds. A storm adds its roughness bonus to every region, easing in
 * and out over `TUNING.weather.stormRampSeconds`. Storms are never rolled
 * before the first outrigger is built.
 */
export const WEATHER: Record<WeatherKind, WeatherDefinition> = {
  clear: {
    id: 'clear', name: 'Clear', description: 'High cloud and a steady breeze.', iconId: 'weather_clear',
    weight: 5, minimumSeconds: 300, maximumSeconds: 600, minimumWind: 2, maximumWind: 4,
    rain: false, roughnessBonus: 0, visibility: 2500,
  },
  fog: {
    id: 'fog', name: 'Fog', description: 'Low mist on still water. Islands come out of it late.', iconId: 'weather_fog',
    weight: 1.5, minimumSeconds: 240, maximumSeconds: 420, minimumWind: 0.5, maximumWind: 1.5,
    rain: false, roughnessBonus: 0, visibility: 220,
  },
  rain: {
    id: 'rain', name: 'Rain', description: 'Steady rain. Fills the catcher, and the canoe if it has no canopy.', iconId: 'weather_rain',
    weight: 2.5, minimumSeconds: 240, maximumSeconds: 480, minimumWind: 4, maximumWind: 6,
    rain: true, roughnessBonus: 0, visibility: 900,
  },
  storm: {
    id: 'storm', name: 'Storm', description: 'Hard wind and breaking water. Get ashore.', iconId: 'weather_storm',
    weight: 1, minimumSeconds: 180, maximumSeconds: 300, minimumWind: 8, maximumWind: 10,
    rain: true, roughnessBonus: 1, visibility: 500,
  },
};

export const WEATHER_KINDS: WeatherKind[] = ['clear', 'fog', 'rain', 'storm'];
