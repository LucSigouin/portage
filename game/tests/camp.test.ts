/**
 * A camp's reach, over the tables: wherever a camp's own things stand, you are in that camp. The bench and the
 * lean-to on Home Knoll stand further from the fire than the fire's own reach, and a player standing at either
 * was told no.
 */
import { describe, expect, it } from 'vitest';
import { CAMP_LAYOUTS, ISLANDS, ISLANDS_BY_ID, TUNING, spotPosition } from '../src/data/index.ts';
import type { IslandId, LandmarkKind } from '../src/data/index.ts';
import { dispatch, drainEvents, selectInteractable, selectInventory } from '../src/sim/index.ts';
import type { GameState } from '../src/sim/index.ts';
import { campInReach } from '../src/sim/inventory.ts';
import { newGame, standOn, teleport } from './support.ts';

const HOUR = TUNING.time.hourSeconds;

/**
 * What counts as standing in a camp, measured and not read off a list: any landmark this close to the camp's fire.
 * The furthest today is the keeper's hut at the Beacon, 13 m out; the nearest thing that is not camp (a farmhouse,
 * a steeple) is 20 m out.
 */
const CAMP_NEIGHBOURHOOD_METRES = 16;

const campIslands = ISLANDS.filter((island) => island.camp);

/** Every landmark that stands by a camp's fire, with where it is. */
function landmarksByTheFire(): { islandId: IslandId; kind: LandmarkKind; x: number; z: number; fromFire: number }[] {
  const found: { islandId: IslandId; kind: LandmarkKind; x: number; z: number; fromFire: number }[] = [];
  for (const island of campIslands) {
    const fire = spotPosition(island, island.camp!.spot);
    for (const landmark of island.landmarks) {
      const { x, z } = spotPosition(island, landmark.spot);
      const fromFire = Math.hypot(x - fire.x, z - fire.z);
      if (fromFire <= CAMP_NEIGHBOURHOOD_METRES) found.push({ islandId: island.id, kind: landmark.kind, x, z, fromFire });
    }
  }
  return found;
}

function standingAt(islandId: IslandId, x: number, z: number): GameState {
  const state = newGame();
  standOn(state, islandId);
  teleport(state, islandId, x, z);
  drainEvents(state);
  return state;
}

const landmarkOf = (islandId: IslandId, kind: LandmarkKind): { x: number; z: number } => {
  const island = ISLANDS_BY_ID[islandId];
  return spotPosition(island, island.landmarks.find((landmark) => landmark.kind === kind)!.spot);
};

describe('a camp\'s reach', () => {
  it('holds every landmark of every camp: standing at any of them is standing in that camp', () => {
    const landmarks = landmarksByTheFire();
    // The walk is not empty: six camps, and the two the review stood at are among what it finds.
    expect(campIslands).toHaveLength(6);
    expect(landmarks.length).toBeGreaterThanOrEqual(13);
    expect(landmarks.map((landmark) => `${landmark.islandId} ${landmark.kind}`)).toEqual(expect.arrayContaining([
      'home_knoll lean_to', 'home_knoll stump_bench', 'home_knoll campfire', 'the_beacon keeper_hut',
    ]));
    // Some of them stand past the fire's own reach, or this proves nothing.
    expect(landmarks.filter((landmark) => landmark.fromFire > TUNING.foot.campRange).length).toBeGreaterThanOrEqual(3);

    const outside = landmarks
      .filter((landmark) => campInReach(standingAt(landmark.islandId, landmark.x, landmark.z).players[0])?.id !== landmark.islandId)
      .map((landmark) => `${landmark.islandId} ${landmark.kind}, ${landmark.fromFire.toFixed(1)} m from the fire`);
    expect(outside).toEqual([]);
  });

  it('holds a step to every side of each of them too, not the one point it stands on', () => {
    for (const landmark of landmarksByTheFire()) {
      for (const [stepX, stepZ] of [[2, 0], [-2, 0], [0, 2], [0, -2]] as const) {
        const state = standingAt(landmark.islandId, landmark.x + stepX, landmark.z + stepZ);
        expect(campInReach(state.players[0])?.id, `${landmark.islandId} ${landmark.kind} +(${stepX}, ${stepZ})`).toBe(landmark.islandId);
      }
    }
  });

  it('lists every one of them in the camp\'s own layout', () => {
    for (const landmark of landmarksByTheFire()) {
      const listed = CAMP_LAYOUTS[landmark.islandId]!.landmarks.some((entry) => entry.kind === landmark.kind && entry.x === landmark.x && entry.z === landmark.z);
      expect(listed, `${landmark.islandId} ${landmark.kind}`).toBe(true);
    }
  });

  it('does not swallow the island: the farmhouse, the steeple and the far shore are not the camp', () => {
    const farmhouse = landmarkOf('orchard_hill', 'farmhouse');
    expect(campInReach(standingAt('orchard_hill', farmhouse.x, farmhouse.z).players[0])).toBeNull();
    const steeple = landmarkOf('steeple_rock', 'steeple');
    expect(campInReach(standingAt('steeple_rock', steeple.x, steeple.z).players[0])).toBeNull();
    expect(campInReach(standingAt('home_knoll', 30, 1170).players[0])).toBeNull();
    // Past the lean-to, on the side away from the fire: a step beyond its own reach is out.
    const leanTo = landmarkOf('home_knoll', 'lean_to');
    const beyond = TUNING.foot.campLandmarkRange + 0.5;
    expect(campInReach(standingAt('home_knoll', leanTo.x - beyond, leanTo.z).players[0])).toBeNull();
    expect(campInReach(standingAt('home_knoll', leanTo.x - beyond + 1, leanTo.z).players[0])?.id).toBe('home_knoll');
  });
});

describe('standing where the quests send you', () => {
  it('at the stump bench the bench is in reach, and so is the cargo of the canoe on the beach', () => {
    const bench = landmarkOf('home_knoll', 'stump_bench');
    const state = standingAt('home_knoll', bench.x, bench.z);
    const inventory = selectInventory(state);
    expect(inventory.stations).toContain('bench');
    expect(inventory.stations).toContain('fire');
    expect(inventory.cargoAccessible).toBe(true);
  });

  it('in the lean-to after dark the interact key sleeps, and the night passes', () => {
    const leanTo = landmarkOf('home_knoll', 'lean_to');
    const state = standingAt('home_knoll', leanTo.x, leanTo.z);
    state.time = 21 * HOUR;
    expect(selectInteractable(state)).toMatchObject({ kind: 'bed', prompt: 'Sleep until morning', command: { type: 'sleep' } });
    // A step inside the opening, where the review stood, is the same.
    teleport(state, 'home_knoll', leanTo.x + 1.2, leanTo.z - 1.5);
    expect(selectInteractable(state)).toMatchObject({ kind: 'bed', command: { type: 'sleep' } });
    expect(dispatch(state, { type: 'sleep' })).toMatchObject({ ok: true });
    expect(state.time).toBe(TUNING.time.daySeconds + TUNING.time.dawnHour * HOUR);
    expect(drainEvents(state).some((event) => event.type === 'slept')).toBe(true);
    expect(state.respawnCampIslandId).toBe('home_knoll');
  });

  it('offers a bed at every camp\'s bed, and still beside every fire', () => {
    for (const island of campIslands) {
      const layout = CAMP_LAYOUTS[island.id]!;
      for (const spot of [layout.fire, ...layout.beds]) {
        const state = standingAt(island.id, spot.x + 1, spot.z);
        state.time = 21 * HOUR;
        expect(selectInteractable(state), `${island.id} at ${spot.x.toFixed(0)}, ${spot.z.toFixed(0)}`).toMatchObject({ kind: 'bed' });
        expect(dispatch(state, { type: 'sleep' }).ok).toBe(true);
      }
    }
  });

  it('offers no bed between the fire and the bench: only at the fire and at the bed', () => {
    const bench = landmarkOf('home_knoll', 'stump_bench');
    const state = standingAt('home_knoll', bench.x, bench.z);
    state.time = 21 * HOUR;
    expect(selectInteractable(state)).toBeNull();
  });
});
