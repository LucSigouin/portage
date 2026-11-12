/**
 * Day or night for the stage: the game's own time-of-day palette, copied into the shared uniforms the way
 * the world view does it (`syncLight` in look/world-view.ts), on a clear sky and with no weather. Nothing
 * here changes with time: the light is one fixed hour.
 */
import * as THREE from 'three';
import { WEATHER } from '../data/index.ts';
import { GU } from '../look/b2/palette.js';
import { mistDensity, paletteAt } from '../look/daylight.ts';
import type { Rgb } from '../look/daylight.ts';

export type Light = 'day' | 'night';

/** Noon, and the middle of the night (the rules' night is 22:00 to 05:00). */
export const HOUR: Record<Light, number> = { day: 12, night: 1 };

const setColour = (target: THREE.Color, value: Rgb): void => void target.setRGB(value[0], value[1], value[2]);

export function applyLight(light: Light): void {
  const hour = HOUR[light];
  const palette = paletteAt(hour, 0, 0);
  setColour(GU.uLight.value, palette.light);
  setColour(GU.uShadowTint.value, palette.shadowTint);
  setColour(GU.uPaper.value, palette.paper);
  setColour(GU.uFogColor.value, palette.fog);
  setColour(GU.uSkyTop.value, palette.skyTop);
  setColour(GU.uSkyLow.value, palette.skyLow);
  setColour(GU.uFarTint.value, palette.farTint);
  setColour(GU.uFoam.value, palette.foam);
  GU.uLightDir.value.set(...palette.lightDirection);
  GU.uFogDensity.value = mistDensity(WEATHER.clear.visibility);
  // Lamps and the weather's shader branches are off: a still, dry, windless clear sky.
  GU.uDark.value = light === 'night' ? 1 : 0;
  GU.uWet.value = 0;
  GU.uRain.value = 0;
  GU.uVeil.value = 0;
  GU.uTime.value = 0;
}

/** The paper colour of the light, as a hex string: what the stage clears to. */
export function paperOf(): THREE.Color {
  return GU.uPaper.value.clone();
}
