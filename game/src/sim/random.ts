/**
 * Seeded random numbers (mulberry32). The generator state lives in GameState,
 * so the same seed and the same inputs always give the same game.
 */

interface RandomSource {
  randomState: number;
}

/** Turn any seed into a well-mixed starting state. */
export function seedToRandomState(seed: number): number {
  let mixed = (Math.floor(seed) ^ 0x9e3779b9) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x85ebca6b) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35) >>> 0;
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

/** Next number in [0, 1). Advances the source. */
export function nextRandom(source: RandomSource): number {
  source.randomState = (source.randomState + 0x6d2b79f5) >>> 0;
  let mixed = source.randomState;
  mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
}

/** Number in [minimum, maximum). */
export function randomBetween(source: RandomSource, minimum: number, maximum: number): number {
  return minimum + (maximum - minimum) * nextRandom(source);
}

/** Whole number in [minimum, maximum], both ends included. */
export function randomInteger(source: RandomSource, minimum: number, maximum: number): number {
  return minimum + Math.floor(nextRandom(source) * (maximum - minimum + 1));
}
