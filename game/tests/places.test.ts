/**
 * Reaching a place: the rules tell the crew once, the first time anyone gets there (`sim/places.ts`).
 * First arrival, second arrival, an old save, a crew, a crewmate who is away, two places in one step.
 */
import { describe, expect, it } from 'vitest';
import {
  ISLANDS, ISLANDS_BY_ID, ISLAND_ARRIVAL_METRES, LANDMARK_ARRIVAL_METRES, PLACES, PLACES_BY_ID, islandPlaceId, landmarkPlaceId, shoreDistance,
} from '../src/data/index.ts';
import { deserialize, serialize } from '../src/save/index.ts';
import { drainEvents, placesKnownFromTraces, setConnected, terrainHeight } from '../src/sim/index.ts';
import type { GameEvent, GameState } from '../src/sim/index.ts';
import { floatCanoeAt, newGame, run, standOn, teleport } from './support.ts';

const reached = (events: readonly GameEvent[]): string[] =>
  events.flatMap((event) => (event.type === 'place_reached' ? [event.placeId] : []));

/** A point this many metres off an island's shore, due north of its middle. */
function offShore(islandId: keyof typeof ISLANDS_BY_ID, metres: number): { x: number; z: number } {
  const island = ISLANDS_BY_ID[islandId];
  let z = island.center.z;
  while (shoreDistance(island, island.center.x, z) < metres) z -= 0.5;
  return { x: island.center.x, z };
}

/** Open water in the Shallows, more than 140 m from every shore. */
const OPEN_WATER = { x: 150, z: 900 };

/** Put player 0 afloat at a point, standing still. */
function afloat(state: GameState, point: { x: number; z: number }): void {
  floatCanoeAt(state, point.x, point.z, 0);
  for (const player of state.players) {
    if (player.mode === 'canoe') player.position = { x: point.x, y: 0, z: point.z };
  }
}

describe('the places table', () => {
  it('has a place for every island, with the world table\'s own words', () => {
    for (const island of ISLANDS) {
      const place = PLACES_BY_ID[islandPlaceId(island.id)];
      expect(place, island.id).toBeDefined();
      expect([place.kind, place.name, place.line]).toEqual(['island', island.name, island.description]);
    }
    expect(PLACES.filter((place) => place.kind === 'island')).toHaveLength(ISLANDS.length);
  });

  it('gives a card to five landmarks, each standing on its island, each with a name and one short line', () => {
    const landmarks = PLACES.filter((place) => place.kind === 'landmark');
    expect(landmarks.map((place) => place.id)).toEqual([
      'landmark:orchard_hill:farmhouse', 'landmark:steeple_rock:steeple', 'landmark:scrapyard_bar:forge_hearth',
      'landmark:fire_tower_ridge:fire_tower', 'landmark:the_beacon:radio_tower',
    ]);
    for (const place of landmarks) {
      expect(place.points.length, place.id).toBeGreaterThan(0);
      // On dry ground of its own island.
      for (const point of place.points) expect(terrainHeight(point.x, point.z), place.id).toBeGreaterThan(0);
      expect(place.kicker).toBe(ISLANDS_BY_ID[place.islandId].name);
    }
    for (const place of PLACES) {
      expect(place.name.length, place.id).toBeGreaterThan(2);
      expect(place.line.length, place.id).toBeGreaterThan(10);
      // One line on the card: the longest in the world table is 90 letters.
      expect(place.line.length, place.id).toBeLessThanOrEqual(90);
    }
    expect(new Set(PLACES.map((place) => place.id)).size).toBe(PLACES.length);
    // The two distances the report names.
    expect([ISLAND_ARRIVAL_METRES, LANDMARK_ARRIVAL_METRES]).toEqual([40, 14]);
  });

  it('measures the shore from outside: 0 on the island, the gap along the line to its middle off it', () => {
    const knoll = ISLANDS_BY_ID.home_knoll;
    expect(shoreDistance(knoll, knoll.center.x, knoll.center.z)).toBe(0);
    expect(shoreDistance(knoll, knoll.center.x, knoll.center.z - knoll.radiusZ - 25)).toBeCloseTo(25, 5);
    expect(shoreDistance(knoll, knoll.center.x + knoll.radiusX + 60, knoll.center.z)).toBeCloseTo(60, 5);
    // A turned island (Pylon Line) is measured along its own axes.
    const pylons = ISLANDS_BY_ID.pylon_line;
    const along = { x: Math.cos(pylons.rotation), z: Math.sin(pylons.rotation) };
    expect(shoreDistance(pylons, pylons.center.x + along.x * (pylons.radiusX + 30), pylons.center.z + along.z * (pylons.radiusX + 30))).toBeCloseTo(30, 5);
  });
});

describe('reaching an island', () => {
  it('a new game has reached nowhere, and says nothing at the start: Home Knoll is 64 m off', () => {
    const state = newGame(7);
    expect(state.reachedPlaces).toEqual([]);
    expect(reached(run(state, {}, 1))).toEqual([]);
    expect(state.reachedPlaces).toEqual([]);
  });

  it('first arrival: one event for the whole crew as the canoe comes within 40 m of the shore, and not before', () => {
    const state = newGame(7);
    afloat(state, offShore('cabin_roofs', ISLAND_ARRIVAL_METRES + 6));
    expect(reached(run(state, {}, 0.5))).toEqual([]);
    afloat(state, offShore('cabin_roofs', ISLAND_ARRIVAL_METRES - 2));
    const events = run(state, {}, 0.5).filter((event) => event.type === 'place_reached');
    expect(events).toEqual([{ type: 'place_reached', placeId: 'island:cabin_roofs' }]);
    // Crew-wide: it names no player.
    expect(events[0].playerId).toBeUndefined();
    expect(state.reachedPlaces).toEqual(['island:cabin_roofs']);
  });

  it('second arrival: nothing, however often the crew comes back, and after a save and a load', () => {
    const state = newGame(7);
    afloat(state, offShore('cabin_roofs', 10));
    expect(reached(run(state, {}, 0.5))).toEqual(['island:cabin_roofs']);
    expect(reached(run(state, {}, 2))).toEqual([]);
    afloat(state, OPEN_WATER);
    run(state, {}, 0.5);
    afloat(state, offShore('cabin_roofs', 10));
    expect(reached(run(state, {}, 0.5))).toEqual([]);
    const loaded = deserialize(serialize(state, 1));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.state.reachedPlaces).toEqual(['island:cabin_roofs']);
    expect(reached(run(loaded.state, {}, 0.5))).toEqual([]);
  });

  it('washing up or walking onto an island reaches it too', () => {
    const state = newGame(7);
    standOn(state, 'birch_islet');
    drainEvents(state);
    expect(reached(run(state, {}, 0.5))).toEqual(['island:birch_islet']);
  });

  it('two places in one step: both are noted, one event each, in the table\'s order', () => {
    const state = newGame(7, { crew: 2 });
    afloat(state, offShore('cabin_roofs', 10));
    const mate = state.players[1];
    const islet = offShore('birch_islet', 10);
    mate.mode = 'foot';
    mate.seat = null;
    mate.position = { x: islet.x, y: 0, z: islet.z };
    expect(reached(run(state, {}, 0.5))).toEqual(['island:cabin_roofs', 'island:birch_islet']);
  });
});

describe('reaching a landmark', () => {
  const steeple = PLACES_BY_ID[landmarkPlaceId('steeple_rock', 'steeple')];

  it('on foot within 14 m, once: the island first, the steeple when the walk gets there', () => {
    const state = newGame(7);
    standOn(state, 'steeple_rock');
    drainEvents(state);
    expect(reached(run(state, {}, 0.5))).toEqual(['island:steeple_rock']);
    const point = steeple.points[0];
    teleport(state, 'steeple_rock', point.x + LANDMARK_ARRIVAL_METRES + 3, point.z);
    expect(reached(run(state, {}, 0.5))).toEqual([]);
    teleport(state, 'steeple_rock', point.x + LANDMARK_ARRIVAL_METRES - 1, point.z);
    expect(reached(run(state, {}, 0.5))).toEqual(['landmark:steeple_rock:steeple']);
    teleport(state, 'steeple_rock', point.x + 3, point.z);
    expect(reached(run(state, {}, 0.5))).toEqual([]);
  });

  it('paddling past is not arriving: afloat beside it, nothing', () => {
    const state = newGame(7);
    state.reachedPlaces = ['island:steeple_rock'];
    const point = steeple.points[0];
    // Held in place on the spot itself, still in the canoe.
    for (let beat = 0; beat < 5; beat += 1) {
      afloat(state, point);
      expect(reached(run(state, {}, 0.2))).toEqual([]);
    }
  });
});

describe('a crew', () => {
  it('everyone is told once, when the first crewmate gets there: a guest who walks up later is told nothing', () => {
    const state = newGame(7, { crew: 3 });
    afloat(state, OPEN_WATER);
    const scout = state.players[2];
    const near = offShore('cabin_roofs', 5);
    scout.mode = 'foot';
    scout.seat = null;
    scout.position = { x: near.x, y: 0, z: near.z };
    const events = run(state, {}, 0.5).filter((event) => event.type === 'place_reached');
    expect(events).toEqual([{ type: 'place_reached', placeId: 'island:cabin_roofs' }]);
    // The rest of the crew arrives: the place is known.
    afloat(state, near);
    expect(reached(run(state, {}, 0.5))).toEqual([]);
  });

  it('a crewmate who is away reaches nothing, and does once they are back', () => {
    const state = newGame(7, { crew: 2 });
    afloat(state, OPEN_WATER);
    const mate = state.players[1];
    const near = offShore('cabin_roofs', 5);
    mate.mode = 'foot';
    mate.seat = null;
    mate.position = { x: near.x, y: 0, z: near.z };
    setConnected(state, mate.id, false);
    drainEvents(state);
    expect(reached(run(state, {}, 0.5))).toEqual([]);
    setConnected(state, mate.id, true);
    expect(reached(run(state, {}, 0.5))).toEqual(['island:cabin_roofs']);
  });
});

describe('an old save', () => {
  const fixtures = import.meta.glob<string>('./fixtures/save-*.json', { eager: true, query: '?raw', import: 'default' });
  const load = (name: string): GameState => {
    const loaded = deserialize(fixtures[`./fixtures/${name}.json`]!);
    if (!loaded.ok) throw new Error(`${name}: ${loaded.reason}`);
    return loaded.state;
  };

  it.each(Object.keys(fixtures))('%s has no list of places, and opening it shows no card', (path) => {
    const state = load(path.replace('./fixtures/', '').replace('.json', ''));
    expect(state.reachedPlaces).toBeUndefined();
    drainEvents(state);
    expect(reached(run(state, {}, 3))).toEqual([]);
    // The list is there now, with at least where the crew is.
    expect(Array.isArray(state.reachedPlaces)).toBe(true);
  });

  it('knows every island it left a mark on, and its landmarks: no card for those, ever', () => {
    const state = load('save-live-seed7-min100');
    const known = placesKnownFromTraces(state);
    // The crew stands on Fire Tower Ridge, slept at Scrapyard Bar, and scavenged on eight more islands.
    for (const islandId of ['home_knoll', 'cabin_roofs', 'birch_islet', 'the_boathouse', 'steeple_rock', 'silo_twins', 'scrapyard_bar', 'heron_marsh', 'truss_bridge', 'fire_tower_ridge'] as const) {
      expect(known, islandId).toContain(islandPlaceId(islandId));
    }
    expect(known).toContain('landmark:steeple_rock:steeple');
    expect(known).toContain('landmark:fire_tower_ridge:fire_tower');
    run(state, {}, 0.5);
    drainEvents(state);
    // Back to Steeple Rock, up to the steeple: nothing.
    const steeple = PLACES_BY_ID['landmark:steeple_rock:steeple'].points[0];
    teleport(state, 'steeple_rock', steeple.x + 4, steeple.z);
    expect(reached(run(state, {}, 0.5))).toEqual([]);
  });

  it('still gets the card for a place it has never been: the Beacon, from the 100 minute save', () => {
    const state = load('save-live-seed7-min100');
    run(state, {}, 0.5);
    drainEvents(state);
    expect(state.reachedPlaces).not.toContain('island:the_beacon');
    const beacon = PLACES_BY_ID['landmark:the_beacon:radio_tower'].points[0];
    teleport(state, 'the_beacon', beacon.x + 5, beacon.z);
    expect(reached(run(state, {}, 0.5)).sort()).toEqual(['island:the_beacon', 'landmark:the_beacon:radio_tower']);
  });

  it('a save opened beside an island it never marked does not announce it: the crew is already there', () => {
    const state = load('save-live-seed3-min008');
    delete state.reachedPlaces;
    afloat(state, offShore('orchard_hill', 10));
    drainEvents(state);
    expect(reached(run(state, {}, 1))).toEqual([]);
    expect(state.reachedPlaces).toContain('island:orchard_hill');
  });
});
