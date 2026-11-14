/**
 * The URL switches for proving the game in a browser nobody can type into:
 *
 * - `?bot=1&speed=8`: the headless bot plays the live session.
 * - `?at=quest7`: fast-forward a game to the start of a main quest, then hand over.
 * - `?shot=<name>`: stage a fixed state for a screenshot. Add `&live=1` to let it run.
 *   `?shot=cast` is the pick screen, as a new game in slot 1 meets it.
 * - `?crew=N` (2 to 4): a new game with N-1 extra players sitting idle beside the local one, to see
 *   the look and the HUD with a crew. Adds the same idle crew to `?at=`, `?shot=` and `?bot=1`.
 * - `&fps=1`: show the frame-rate readout. `&seed=<n>` picks the game's seed.
 * - `?host=ROOM`: start a game that other tabs of this site can join. `&name=...` names the host.
 * - `?join=ROOM&name=...`: join it, from another tab or window on the same computer.
 *   A tester's door (a channel between tabs, no server), not the lobby's.
 *
 * And one that is not for testing: `?invite=CODE` is the link a host sends. It opens the lobby's
 * join panel with the code filled in. It touches nothing else: the player's own saves stay as they are.
 */
export const SHOT_NAMES = [
  'lobby', 'cast', 'settings', 'play', 'island', 'inventory', 'crafting', 'builder', 'quests', 'map', 'dialogue', 'pause',
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
  /** Players in the game, 1 to 4. Above 1 the extra ones are idle stand-ins. */
  crew: number;
  /** The room to host for other tabs, or null. Letters, digits, `_` and `-`, 32 at most. */
  host: string | null;
  /** The room to join as a guest, or null. Ignored when `host` is set. */
  join: string | null;
  /** The name to play under in a shared game. Cut to 12 letters by the rules. */
  name: string;
  /** The room code of an invite link, or null. Checked for shape only: the relay says whether there is such a room. */
  invite: string | null;
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
  const crew = Math.max(1, Math.min(4, whole('crew') ?? 1));
  const room = (name: string): string | null => {
    const text = values.get(name);
    return text !== null && /^[A-Za-z0-9_-]{1,32}$/.test(text) ? text : null;
  };
  const host = room('host');
  const join = host === null ? room('join') : null;
  return {
    bot, speed, atQuest, shot,
    live: flag('live'),
    showFrameRate: flag('fps'),
    seed: whole('seed'),
    crew,
    host,
    join,
    name: (values.get('name') ?? '').slice(0, 40),
    invite: /^[A-Za-z0-9-]{6,9}$/.test(values.get('invite') ?? '') ? values.get('invite') : null,
    sandbox: bot || atQuest !== null || shot !== null || crew > 1 || host !== null || join !== null,
  };
}
