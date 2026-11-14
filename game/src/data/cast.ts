/**
 * The cast: the four people a player can be. A player picks one when they start a new game or join a
 * crew, and the pick is kept on the player (`PlayerState.character`).
 *
 * The rules never read it: who you are changes the drawing and nothing else. The look draws each one
 * (`look/cast.ts`), and the lobby shows them on the pick screen (`interface/cast.ts`).
 *
 * The ids are kept in saves and sent on the wire: never rename one. The names and lines are only words.
 */
export const CHARACTER_IDS = ['voyageur', 'trapper', 'angler', 'scout'] as const;

export type CharacterId = (typeof CHARACTER_IDS)[number];

export interface CastEntry {
  id: CharacterId;
  /** What the pick screen calls them. */
  name: string;
  /** One line under the name. */
  line: string;
}

export const CAST: Readonly<Record<CharacterId, CastEntry>> = {
  voyageur: { id: 'voyageur', name: 'The Voyageur', line: 'Wool coat, toque and scarf. Paddles all day.' },
  trapper: { id: 'trapper', name: 'The Trapper', line: 'Fur hat and a full beard. Knows the woods.' },
  angler: { id: 'angler', name: 'The Angler', line: 'Oilskin and a rain hat. Never far from the water.' },
  scout: { id: 'scout', name: 'The Scout', line: 'Hood, cape and a map case. First up every hill.' },
};

/** True for one of the four ids, and for nothing else (not `constructor`, not a number). */
export function isCharacterId(value: unknown): value is CharacterId {
  return typeof value === 'string' && (CHARACTER_IDS as readonly string[]).includes(value);
}

/**
 * Who a player is drawn as: their own pick, or one by seat when there is none (a save from before the
 * pick screen, a stand-in nobody picked for). Seat 0 without a pick is the voyageur: the lone paddler
 * the game always drew. Read a player's character through this, never raw.
 */
export function characterOf(player: { id: number; character?: unknown }): CharacterId {
  if (isCharacterId(player.character)) return player.character;
  const count = CHARACTER_IDS.length;
  return CHARACTER_IDS[((Math.trunc(player.id) % count) + count) % count] ?? 'voyageur';
}
