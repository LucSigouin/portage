/**
 * When the island names are shown (Luc's bugfix list, line 4): while the player is aboard, and while
 * they stand at the water's edge. Inland, at a camp or among the trees, they are not.
 *
 * "At the water's edge" is open water within `SHORE_METRES` of the player. Every camp stands 23 m or
 * more from the water (Home Knoll's fire 23 m, its lean-to 26.5 m, the Beacon's hut 55 m), and every
 * landing is on it, so a player walking up from the canoe keeps the names for the first dozen steps and
 * loses them before the camp.
 *
 * It reads the rules' ground (`terrainHeight`) and nothing else. It keeps no state: standing still gives
 * the same answer every frame, and nothing changes unless the player moves.
 */
import { playerOf, terrainHeight } from '../../sim/index.ts';
import type { GameState, PlayerId, PlayerState } from '../../sim/index.ts';

/** How far open water may be for a player on foot to be at the shore, in metres. */
export const SHORE_METRES = 12;

/** Ground this far under the surface is open water, the same depth the rules' scoop asks for. */
const OPEN_WATER = -0.1;
/** Directions tried round the player, and the rings tried in each, out to `SHORE_METRES`. */
const DIRECTIONS = 16;
const RINGS = [3, 6, 9, SHORE_METRES];

/** True when open water lies within `SHORE_METRES` of this point. */
export function waterWithin(x: number, z: number, metres: number = SHORE_METRES): boolean {
  if (terrainHeight(x, z) < OPEN_WATER) return true;
  for (const ring of RINGS) {
    if (ring > metres) break;
    for (let index = 0; index < DIRECTIONS; index += 1) {
      const angle = (index / DIRECTIONS) * 2 * Math.PI;
      if (terrainHeight(x + Math.sin(angle) * ring, z - Math.cos(angle) * ring) < OPEN_WATER) return true;
    }
  }
  return false;
}

/** Aboard, or on foot within `SHORE_METRES` of open water. */
export function atTheShore(player: PlayerState): boolean {
  return player.mode === 'canoe' || waterWithin(player.position.x, player.position.z);
}

/** Whether this player's screen names the islands. */
export function islandNamesShown(state: GameState, playerId: PlayerId = 0): boolean {
  return atTheShore(playerOf(state, playerId));
}
