/**
 * Places: what the crew can arrive at. Every island, and the few landmarks that are somebody's home or a tower
 * to climb. The first time the crew reaches one, every screen shows its arrival card once (Luc's bugfix list,
 * Round 3: "nice animations in the middle of the screen when getting to a new POI").
 *
 * An island's words are the world table's own: its name, and its description as the line under it. A landmark has
 * no name in the world table, so its words are written here.
 *
 * The rules decide when a place is reached (`sim/places.ts`). The card is the client's (`client/viewmodels/arrival.ts`).
 */
import type { IslandDefinition, IslandId, LandmarkKind } from './types.ts';
import { ISLANDS, ISLANDS_BY_ID, REGIONS_BY_ID, spotPosition } from './world.ts';

/** `island:<island id>`, or `landmark:<island id>:<landmark kind>`. */
export type PlaceId = string;

export interface PlaceDefinition {
  id: PlaceId;
  kind: 'island' | 'landmark';
  islandId: IslandId;
  /** The small words over the name: an island's region, a landmark's island. */
  kicker: string;
  name: string;
  /** One short line under the name. */
  line: string;
  /** A landmark: where it stands, in world metres (a kind that stands in several spots counts as reached at any). Empty for an island. */
  points: { x: number; z: number }[];
}

/** An island is reached when a crewmate comes this near its shore, afloat or on foot. Metres. */
export const ISLAND_ARRIVAL_METRES = 40;
/** A landmark is reached when a crewmate walks this near it. Metres. On foot only: paddling past is not arriving. */
export const LANDMARK_ARRIVAL_METRES = 14;

/** The landmarks with a card of their own: three survivors' homes, and the two towers the last quests climb to. */
const LANDMARK_WORDS: readonly { islandId: IslandId; kind: LandmarkKind; name: string; line: string }[] = [
  { islandId: 'orchard_hill', kind: 'farmhouse', name: 'The Farmhouse', line: 'Odile kept the orchard for fifty years. She will not leave it.' },
  { islandId: 'steeple_rock', kind: 'steeple', name: 'The Steeple', line: 'Wren rings the hours from it, so the valley still has a clock.' },
  { islandId: 'scrapyard_bar', kind: 'forge_hearth', name: 'Tink’s Hearth', line: 'A forge among the wrecks, and a use for every bolt.' },
  { islandId: 'fire_tower_ridge', kind: 'fire_tower', name: 'The Fire Tower', line: 'Climb it for a bearing on the Beacon.' },
  { islandId: 'the_beacon', kind: 'radio_tower', name: 'The Radio Tower', line: 'Dark on the summit, waiting to be lit.' },
];

export const islandPlaceId = (islandId: IslandId): PlaceId => `island:${islandId}`;
export const landmarkPlaceId = (islandId: IslandId, kind: LandmarkKind): PlaceId => `landmark:${islandId}:${kind}`;

/** Every place, islands first in the world table's order, then the landmarks. */
export const PLACES: readonly PlaceDefinition[] = [
  ...ISLANDS.map((definition): PlaceDefinition => ({
    id: islandPlaceId(definition.id), kind: 'island', islandId: definition.id,
    kicker: REGIONS_BY_ID[definition.regionId].name, name: definition.name, line: definition.description, points: [],
  })),
  ...LANDMARK_WORDS.map((words): PlaceDefinition => {
    const island = ISLANDS_BY_ID[words.islandId];
    return {
      id: landmarkPlaceId(words.islandId, words.kind), kind: 'landmark', islandId: words.islandId,
      kicker: island.name, name: words.name, line: words.line,
      points: island.landmarks.filter((entry) => entry.kind === words.kind).map((entry) => spotPosition(island, entry.spot)),
    };
  }),
];

export const PLACES_BY_ID: Readonly<Record<PlaceId, PlaceDefinition>> = Object.fromEntries(PLACES.map((place) => [place.id, place]));

/**
 * How far a point is from an island's shore, in metres, measured along the line to the island's middle.
 * 0 on the island. (The shore is the island's ellipse, the one `terrainHeight` rises from.)
 */
export function shoreDistance(definition: IslandDefinition, x: number, z: number): number {
  const offsetX = x - definition.center.x;
  const offsetZ = z - definition.center.z;
  const cosine = Math.cos(definition.rotation);
  const sine = Math.sin(definition.rotation);
  const along = (offsetX * cosine + offsetZ * sine) / definition.radiusX;
  const across = (-offsetX * sine + offsetZ * cosine) / definition.radiusZ;
  // 1 is the shoreline: the point is this many times as far out as the shore is, on its own line.
  const share = Math.hypot(along, across);
  return share <= 1 ? 0 : Math.hypot(offsetX, offsetZ) * (1 - 1 / share);
}
