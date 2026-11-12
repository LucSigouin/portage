/**
 * The time-of-day palette. Three hand-picked palettes (day, dusk, night) and
 * an overcast one, blended by the hour and the weather. Day is B2's misty
 * morning, number for number, and holds flat from 07:00 to 19:30 so nothing
 * on screen drifts while you play through the day.
 *
 * Pure numbers: world-view.ts copies the result into the shared uniforms.
 */

export type Rgb = readonly [number, number, number];
export type Direction = readonly [number, number, number];

export interface Palette {
  /** Multiplies every lit wash. */
  light: Rgb;
  /** Multiplies the shadow tone. */
  shadowTint: Rgb;
  /** The highlight tone is mixed toward this. */
  paper: Rgb;
  /** Mist colour. */
  fog: Rgb;
  skyTop: Rgb;
  skyLow: Rgb;
  cloud: Rgb;
  cloudLight: Rgb;
  /** Sun, or moon. */
  sun: Rgb;
  /** Multiplies the far ridges painted into the sky. */
  farTint: Rgb;
  waterDeep: Rgb;
  waterMid: Rgb;
  waterPale: Rgb;
  /** Dark ripple strokes. */
  inkBlue: Rgb;
  /** White ripple strokes and foam. */
  foam: Rgb;
  /** Strength of the sun's glow in the sky. */
  sunGlow: number;
  /** Direction the shading light comes from. */
  lightDirection: Direction;
  /** Where the sun or moon is painted. */
  sunDirection: Direction;
}

type ColourKey = { [Key in keyof Palette]: Palette[Key] extends Rgb ? Key : never }[keyof Palette];

export function hex(colour: string): Rgb {
  const value = Number.parseInt(colour.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function unit(x: number, y: number, z: number): Direction {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

/** The pen's ink (B2's `PAL.ink`). */
const INK = hex('#2a2b33');

/** B2 exactly: `art-r1/b2/src/palette.js` and `sky.js`. */
export const DAY: Palette = {
  light: [1, 1, 1],
  shadowTint: hex('#8e97b6'),
  paper: hex('#f3ebd9'),
  fog: hex('#e0e2d8'),
  skyTop: hex('#c6d0cf'),
  skyLow: hex('#eee7d6'),
  cloud: hex('#b4c0c4'),
  cloudLight: hex('#f3ebd9'),
  sun: hex('#fbf3dc'),
  farTint: [1, 1, 1],
  waterDeep: hex('#587b90'),
  waterMid: hex('#7f9eab'),
  waterPale: hex('#b7c9c9'),
  inkBlue: hex('#36566b'),
  foam: hex('#fcf9f0'),
  sunGlow: 1,
  lightDirection: unit(-0.52, 0.74, -0.42),
  sunDirection: unit(0.35, 0.115, 0.93),
};

/** Dawn and dusk: a low warm light from the west, peach mist, violet shade. */
export const DUSK: Palette = {
  light: [1, 0.86, 0.72],
  shadowTint: hex('#8380ab'),
  paper: hex('#f7e0bf'),
  fog: hex('#e6cdb6'),
  skyTop: hex('#b6b6cb'),
  skyLow: hex('#f4cfa6'),
  cloud: hex('#c79d92'),
  cloudLight: hex('#f9e4c2'),
  sun: hex('#fee3b0'),
  farTint: [0.95, 0.83, 0.83],
  waterDeep: hex('#5b6f8f'),
  waterMid: hex('#9c98a6'),
  waterPale: hex('#e5c4a8'),
  inkBlue: hex('#3b4a6c'),
  foam: hex('#fcefdc'),
  sunGlow: 1.35,
  lightDirection: unit(-0.78, 0.36, 0.18),
  sunDirection: unit(-0.86, 0.08, -0.2),
};

/** Night: a dim blue moonlight. Dark, but every shape still reads. Lantern light is step 3. */
export const NIGHT: Palette = {
  light: [0.38, 0.45, 0.62],
  shadowTint: hex('#6a74a0'),
  paper: hex('#7f90b8'),
  fog: hex('#262f47'),
  skyTop: hex('#1a2238'),
  skyLow: hex('#333f5c'),
  cloud: hex('#2a334e'),
  cloudLight: hex('#4c5a7b'),
  sun: hex('#dde5f2'),
  farTint: [0.2, 0.25, 0.37],
  waterDeep: hex('#141d33'),
  waterMid: hex('#23314d'),
  waterPale: hex('#3e4e70'),
  inkBlue: hex('#0d1322'),
  foam: hex('#aab8d4'),
  sunGlow: 0.8,
  lightDirection: unit(0.3, 0.78, -0.42),
  sunDirection: unit(0.32, 0.42, -0.62),
};

/** Rain, storm and fog pull the day toward this. At night it is scaled down with the light. */
const OVERCAST: Pick<Palette, 'skyTop' | 'skyLow' | 'cloud' | 'fog' | 'waterDeep' | 'waterMid' | 'waterPale'> = {
  skyTop: hex('#a4adb0'),
  skyLow: hex('#c6c9c3'),
  cloud: hex('#8b969b'),
  fog: hex('#c3c8c5'),
  waterDeep: hex('#4d6676'),
  waterMid: hex('#72878f'),
  waterPale: hex('#a1aeae'),
};

/** A storm pulls the overcast sky down to this: slate cloud, lead water. The foam stays bright, so the whitecaps show. */
const STORM: typeof OVERCAST = {
  skyTop: hex('#59646d'),
  skyLow: hex('#8d979b'),
  cloud: hex('#48535c'),
  fog: hex('#7d898e'),
  waterDeep: hex('#33485a'),
  waterMid: hex('#54707c'),
  waterPale: hex('#7d9197'),
};

const COLOUR_KEYS: ColourKey[] = [
  'light', 'shadowTint', 'paper', 'fog', 'skyTop', 'skyLow', 'cloud', 'cloudLight', 'sun', 'farTint', 'waterDeep', 'waterMid',
  'waterPale', 'inkBlue', 'foam',
];

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smooth = (value: number): number => {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
};
// (1 - t) * a + t * b lands exactly on a at 0 and on b at 1.
const mix = (from: number, to: number, share: number): number => (1 - share) * from + share * to;
const mixRgb = (from: Rgb, to: Rgb, share: number): Rgb => [mix(from[0], to[0], share), mix(from[1], to[1], share), mix(from[2], to[2], share)];
// At either end the direction is returned as it is: normalising again would nudge it by a rounding error.
const mixDirection = (from: Direction, to: Direction, share: number): Direction =>
  share <= 0 ? from : share >= 1 ? to : unit(mix(from[0], to[0], share), mix(from[1], to[1], share), mix(from[2], to[2], share));

/** 0 at night, 1 by day. Up from 05:00 to 07:00, down from 19:30 to 22:00 (the rules engine's night starts at 22:00). */
export function daylightAt(hour: number): number {
  return Math.min(smooth((hour - 5) / 2), smooth((22 - hour) / 2.5));
}

/** 0 by day and by night, 1 at the middle of dawn and of dusk. */
export function twilightAt(hour: number): number {
  const daylight = daylightAt(hour);
  return 4 * daylight * (1 - daylight);
}

/**
 * The palette for an hour of the day (0 to 24), a cloud cover (0 clear to 1) and a storm level (0 to 1).
 * `paletteAt(12, 0)` is `DAY`, exactly.
 */
export function paletteAt(hour: number, overcast: number, storm = 0): Palette {
  const daylight = daylightAt(hour);
  const twilight = twilightAt(hour) * 0.85;
  const cover = clamp01(overcast);
  const blend = <Key extends keyof Palette>(key: Key, mixer: (from: Palette[Key], to: Palette[Key], share: number) => Palette[Key]): Palette[Key] =>
    mixer(mixer(NIGHT[key], DAY[key], daylight), DUSK[key], twilight);

  const palette = {
    sunGlow: blend('sunGlow', mix) * (1 - cover),
    lightDirection: blend('lightDirection', mixDirection),
    sunDirection: blend('sunDirection', mixDirection),
  } as { -readonly [Key in keyof Palette]: Palette[Key] };
  for (const key of COLOUR_KEYS) palette[key] = blend(key, mixRgb);

  if (cover > 0) {
    // Cloud flattens the light and greys the sky and the water. It keeps the night dark.
    const dim = mix(0.3, 1, daylight);
    for (const key of Object.keys(OVERCAST) as (keyof typeof OVERCAST)[]) {
      const grey = OVERCAST[key];
      palette[key] = mixRgb(palette[key], [grey[0] * dim, grey[1] * dim, grey[2] * dim], cover * 0.85);
    }
    palette.light = mixRgb(palette.light, [palette.light[0] * 0.84, palette.light[1] * 0.86, palette.light[2] * 0.9], cover);
    palette.shadowTint = mixRgb(palette.shadowTint, [0.72, 0.74, 0.8], cover * 0.5);
  }
  const trouble = clamp01(storm);
  if (trouble > 0) {
    // A storm darkens what the cloud had only greyed, and takes a quarter of the light. It keeps the night dark too.
    const dim = mix(0.3, 1, daylight);
    for (const key of Object.keys(STORM) as (keyof typeof STORM)[]) {
      const slate = STORM[key];
      palette[key] = mixRgb(palette[key], [slate[0] * dim, slate[1] * dim, slate[2] * dim], trouble * 0.9);
    }
    palette.light = mixRgb(palette.light, [palette.light[0] * 0.74, palette.light[1] * 0.78, palette.light[2] * 0.86], trouble);
    palette.farTint = mixRgb(palette.farTint, [palette.farTint[0] * 0.6, palette.farTint[1] * 0.63, palette.farTint[2] * 0.68], trouble);
  }
  return palette;
}

/**
 * The rain's pen: its colour and how strongly it is laid on. Dark blue ink on a grey day. At night dark ink would
 * not show, so the strokes go pale, as the night's own highlights are.
 */
export function rainInkAt(hour: number, overcast: number, storm: number): { ink: Rgb; strength: number } {
  const palette = paletteAt(hour, overcast, storm);
  const night = 1 - daylightAt(hour);
  return { ink: mixRgb(mixRgb(INK, palette.inkBlue, 0.35), palette.foam, 0.7 * night), strength: mix(0.55, 0.36, night) };
}

/**
 * The colour of the next weather's cloud as it stands on the horizon, from how much of it is storm, rain, fog
 * and clearing (shares that sum to 1 or less): slate, grey, the fog's own pale tone, or the clear sky's light.
 */
export function bankColourAt(hour: number, storm: number, rain: number, fog: number, clear: number): Rgb {
  const total = Math.max(1e-6, storm + rain + fog + clear);
  const parts: [number, Rgb][] = [
    [storm, paletteAt(hour, 0.9, 1).cloud], [rain, paletteAt(hour, 0.65).cloud], [fog, paletteAt(hour, 0.5).fog], [clear, paletteAt(hour, 0).skyLow],
  ];
  return parts.reduce<Rgb>((sum, [share, colour]) => [sum[0] + (colour[0] * share) / total, sum[1] + (colour[1] * share) / total, sum[2] + (colour[2] * share) / total], [0, 0, 0]);
}

/** Cloud cover per weather, 0 clear to 1. A storm scales with its level. */
export function overcastFor(kind: 'clear' | 'fog' | 'rain' | 'storm', stormLevel: number): number {
  if (kind === 'storm') return Math.max(0.5, 0.9 * stormLevel);
  return { clear: 0, fog: 0.5, rain: 0.65 }[kind];
}

/** Mist density for a visibility in metres: the mist hides 90% of a shape at that distance. B2's 0.0025 is about 920 m. */
export function mistDensity(visibilityMetres: number): number {
  return Math.log(10) / Math.max(40, visibilityMetres);
}
