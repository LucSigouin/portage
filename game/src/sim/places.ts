/**
 * Reaching a place (`data/places.ts`): the first time anyone in the crew gets to an island or one of the landmarks
 * with a card, the rules note it in `state.reachedPlaces` and send one `place_reached` event to the whole crew.
 * Never twice for one place in one save.
 *
 * - An island: a crewmate within `ISLAND_ARRIVAL_METRES` of its shore, afloat or on foot.
 * - A landmark: a crewmate on foot within `LANDMARK_ARRIVAL_METRES` of it.
 * - A crewmate who is away reaches nothing.
 *
 * A save from before this existed has no `reachedPlaces`. The first look at it works out what that crew already
 * knows from the marks it left (`placesKnownFromTraces`) and sends no event: nobody is told about a place they
 * have been to.
 *
 * It draws no random number and moves nothing: the game plays out the same with it or without.
 */
import { NODES_BY_ID } from '../data/nodes.ts';
import { ISLAND_ARRIVAL_METRES, LANDMARK_ARRIVAL_METRES, PLACES, shoreDistance } from '../data/places.ts';
import type { PlaceDefinition, PlaceId } from '../data/places.ts';
import type { IslandId } from '../data/types.ts';
import { ISLANDS_BY_ID } from '../data/world.ts';
import type { GameEvent, GameState, PlayerState } from './types.ts';

/** True when this player is at the place right now. */
export function isAtPlace(place: PlaceDefinition, player: PlayerState): boolean {
  const { x, z } = player.position;
  if (place.kind === 'island') return shoreDistance(ISLANDS_BY_ID[place.islandId], x, z) <= ISLAND_ARRIVAL_METRES;
  if (player.mode !== 'foot') return false;
  return place.points.some((point) => Math.hypot(point.x - x, point.z - z) <= LANDMARK_ARRIVAL_METRES);
}

/**
 * What an old save's crew already knows: every place on an island where it left a mark. A mark is a spot that was
 * scavenged there, the canoe's last beach, the camp slept at, or a crewmate standing on it. And any place a
 * crewmate is at as the save is opened: you are not told you have arrived where you already are.
 */
export function placesKnownFromTraces(state: GameState): PlaceId[] {
  const visited = new Set<IslandId>([state.canoe.lastBeached.islandId, state.respawnCampIslandId]);
  for (const nodeId of Object.keys(state.nodes)) {
    const node = NODES_BY_ID[nodeId];
    if (node) visited.add(node.islandId);
  }
  for (const player of state.players) {
    if (player.mode === 'foot' && player.islandId !== null) visited.add(player.islandId);
  }
  return PLACES
    .filter((place) => visited.has(place.islandId) || state.players.some((player) => isAtPlace(place, player)))
    .map((place) => place.id);
}

/** Note every place the crew has just reached, and tell the crew. Cheap: run a few times a second. */
export function updatePlaces(state: GameState): void {
  if (state.reachedPlaces === undefined) {
    state.reachedPlaces = placesKnownFromTraces(state);
    return;
  }
  const reached = state.reachedPlaces;
  if (reached.length >= PLACES.length) return;
  for (const place of PLACES) {
    if (reached.includes(place.id)) continue;
    if (!state.players.some((player) => player.connected && isAtPlace(place, player))) continue;
    reached.push(place.id);
    // The crew's news: it carries no player, so every screen hears it.
    const event: GameEvent = { type: 'place_reached', placeId: place.id };
    state.events.push(event);
  }
}
