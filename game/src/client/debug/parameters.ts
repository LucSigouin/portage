/**
 * The URL switches for proving the game in a browser nobody can type into:
 *
 * - `?bot=1&speed=8`: the headless bot plays the live session.
 * - `?at=quest7`: fast-forward a game to the start of a main quest, then hand over.
 * - `?shot=<name>`: stage a fixed state for a screenshot. Add `&live=1` to let it run.
 * - `&fps=1`: show the frame-rate readout. `&seed=<n>` picks the game's seed.
 */
export const SHOT_NAMES = [
  'lobby', 'settings', 'play', 'island', 'inventory', 'crafting', 'builder', 'quests', 'map', 'dialogue', 'pause',
  'storm', 'night', 'upgraded', 'beacon',
] as const;

export type ShotName = typeof SHOT_NAMES[number];

export interface DebugParameters {
  bot: boolean;
  /** Simulated seconds per real second. 1 to 64. */
  speed: number;
  /** Main quest number to start at, 1 to 12, or null. */
  atQuest: number | null;
  shot: ShotName | null;
  /** Let a staged shot run instead of holding it still. */
  live: boolean;
  showFrameRate: boolean;
  seed: number | null;
  /** True when a switch replaces the normal game: saves stay untouched. */
  sandbox: boolean;
}

/** Parse a query string such as `?bot=1&speed=8`. Unknown or malformed values are ignored. */
export function parseDebugParameters(query: string): DebugParameters {
  const values = new URLSearchParams(query);
  const flag = (name: string): boolean => values.get(name) === '1' || values.get(name) === 'true';
  const whole = (name: string): number | null => {
    const text = values.get(name);
    return text !== null && /^\d+$/.test(text) ? Number(text) : null;
  };
  const speedText = values.get('speed');
  const speed = speedText !== null && Number.isFinite(Number(speedText)) ? Math.max(1, Math.min(64, Number(speedText))) : 1;
  const questMatch = /^(?:quest)?(\d+)$/.exec(values.get('at') ?? '');
  const quest = questMatch ? Number(questMatch[1]) : null;
  const atQuest = quest !== null && quest >= 1 && quest <= 12 ? quest : null;
  const shotText = values.get('shot');
  const shot = SHOT_NAMES.find((name) => name === shotText) ?? null;
  const bot = flag('bot');
  return {
    bot, speed, atQuest, shot,
    live: flag('live'),
    showFrameRate: flag('fps'),
    seed: whole('seed'),
    sandbox: bot || atQuest !== null || shot !== null,
  };
}
