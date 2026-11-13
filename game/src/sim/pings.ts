/**
 * Pings: a spot a player marked on the map, for the crew to go and look at.
 *
 * Each player has one. A new one takes the place of their old one. It stands
 * until it is replaced, until anyone in the crew clears it, or until a
 * crewmate gets there (`PING.reachMetres`). The world shows it as a column
 * of light in the pinger's colour (`src/look/pings.ts`), the map and the
 * minimap as a mark (`src/interface/chart.ts`).
 *
 * The pings are the crew's: the host keeps them in `GameState.pings`, guests
 * get them with the rest of the state, and a guest who joins late sees the
 * ones standing. The field is optional: it is absent until the first ping,
 * so a game nobody pings in, and every save from before, is unchanged.
 */
import { connectedPlayers } from './inventory.ts';
import type { CommandResult, GameState, PlayerId, PlayerState } from './types.ts';

/**
 * - `centerX`, `centerZ`, `radius`: where a ping may stand. The round chart of the map panel
 *   (`CHART` in `src/client/viewmodels/chart.ts`; a test holds the two together).
 * - `reachMetres`: a crewmate this near has got there, and the ping goes out.
 * - `restSteps`: steps between two pings of one player. One second: a beam never jumps about faster.
 */
export const PING = {
  centerX: 0,
  centerZ: -25,
  radius: 1650,
  reachMetres: 15,
  restSteps: 60,
} as const;

export interface Ping {
  /** Whose it is. One entry per player at most. */
  playerId: PlayerId;
  /** Where, whole world metres. */
  x: number;
  z: number;
  /** The step it was set on. A player's next ping waits `PING.restSteps` from here. */
  tick: number;
  /** False once it was cleared or reached. Kept all the same, so clearing does not get round the wait. */
  standing: boolean;
  /**
   * Who was already within reach when it was set, and has not left since. They do not count as getting
   * there: a ping set where someone stands is not gone at once.
   */
  inside: PlayerId[];
}

const refusal = (reason: 'off_the_map' | 'ping_too_soon'): CommandResult => ({ ok: false, reason, missing: null });
const done = (): CommandResult => ({ ok: true, gained: [], spent: [] });

const isWholeId = (value: unknown): value is PlayerId => typeof value === 'number' && Number.isInteger(value) && value >= 0;

function isPing(value: unknown): value is Ping {
  if (typeof value !== 'object' || value === null) return false;
  const ping = value as Record<string, unknown>;
  return isWholeId(ping.playerId) && typeof ping.x === 'number' && Number.isFinite(ping.x)
    && typeof ping.z === 'number' && Number.isFinite(ping.z) && typeof ping.tick === 'number' && Number.isFinite(ping.tick)
    && typeof ping.standing === 'boolean' && Array.isArray(ping.inside);
}

/** Every entry the state keeps, standing or not. Whatever a hand-edited save holds, only well-formed ones come back. */
function entries(state: GameState): Ping[] {
  const pings: unknown = state.pings;
  return Array.isArray(pings) ? pings.filter(isPing) : [];
}

/** True when `x`, `z` is a spot a ping may stand on: on the round chart. */
export function pingInBounds(x: number, z: number): boolean {
  return Number.isFinite(x) && Number.isFinite(z) && Math.hypot(x - PING.centerX, z - PING.centerZ) <= PING.radius;
}

/**
 * The pings standing right now, in player order. `state.pings` is only ever replaced, never changed in place:
 * while it is the same list, this is the same answer, so whoever draws them can keep theirs.
 */
export function standingPings(state: GameState): Ping[] {
  if (state.pings === undefined) return [];
  return entries(state).filter((ping) => ping.standing).sort((first, second) => first.playerId - second.playerId);
}

const within = (player: PlayerState, ping: Ping): boolean =>
  Math.hypot(player.position.x - ping.x, player.position.z - ping.z) <= PING.reachMetres;

/** The players who are here and within reach of a ping. */
const playersAt = (state: GameState, ping: Ping): PlayerId[] =>
  connectedPlayers(state).filter((player) => within(player, ping)).map((player) => player.id);

/**
 * Mark a spot for the crew. The spot is rounded to a whole metre. Refused off the chart, and within a second
 * of this player's last ping. Their old ping, if any, is gone.
 */
export function placePing(state: GameState, player: PlayerState, x: number, z: number): CommandResult {
  if (!pingInBounds(x, z)) return refusal('off_the_map');
  const spot = { x: Math.round(x), z: Math.round(z) };
  // Rounding may step over the rim by a hair: the spot that is kept is the one that is checked.
  if (!pingInBounds(spot.x, spot.z)) return refusal('off_the_map');
  const kept = entries(state);
  const old = kept.find((ping) => ping.playerId === player.id);
  const since = old ? state.tick - old.tick : PING.restSteps;
  // (a ping from a later step than now is a hand-edited save: it holds nobody back)
  if (since >= 0 && since < PING.restSteps) return refusal('ping_too_soon');
  const ping: Ping = { playerId: player.id, ...spot, tick: state.tick, standing: true, inside: [] };
  ping.inside = playersAt(state, ping);
  state.pings = [...kept.filter((entry) => entry.playerId !== player.id), ping].sort((first, second) => first.playerId - second.playerId);
  return done();
}

/** Take a ping down: your own or a crewmate's. Clearing one that is not standing is no fault: it is gone either way. */
export function clearPing(state: GameState, ownerId: PlayerId): CommandResult {
  const kept = entries(state);
  if (kept.some((ping) => ping.playerId === ownerId && ping.standing)) {
    state.pings = kept.map((ping) => (ping.playerId === ownerId ? { ...ping, standing: false, inside: [] } : ping));
  }
  return done();
}

/**
 * A few times a second: a ping a crewmate has got to goes out. Whoever stood there when it was set counts once
 * they have left and come back. Writes nothing when nothing changed, so a standing ping costs the wire nothing.
 */
export function updatePings(state: GameState): void {
  if (state.pings === undefined) return;
  const kept = entries(state);
  let changed = kept.length !== (state.pings as unknown[]).length;
  const next = kept.map((ping) => {
    if (!ping.standing) return ping;
    const here = playersAt(state, ping);
    if (here.some((playerId) => !ping.inside.includes(playerId))) {
      changed = true;
      return { ...ping, standing: false, inside: [] };
    }
    const inside = ping.inside.filter((playerId) => here.includes(playerId));
    if (inside.length === ping.inside.length) return ping;
    changed = true;
    return { ...ping, inside };
  });
  if (changed) state.pings = next;
}
