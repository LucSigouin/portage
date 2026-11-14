/**
 * Luc, from the live game: "also the fire you cant interact with it?", then in chat: "f at fire should open cooking
 * yes". The rules say where the prompt shows and which station it is; the screen opens the panel (tests/client).
 * A fire is solid, so the prompt is met from its ring of stones, not from its middle.
 */
import { describe, expect, it } from 'vitest';
import { CAMP_LAYOUTS, ISLANDS, RECIPES, RECIPE_IDS, TUNING } from '../src/data/index.ts';
import type { IslandId } from '../src/data/index.ts';
import {
  FIXED_STEP, NEUTRAL_INPUT, approachTo, bodyBlocked, drainEvents, selectCraftableRecipes, selectInteractable, selectInventory, step, terrainHeight,
} from '../src/sim/index.ts';
import type { GameState } from '../src/sim/index.ts';
import { newGame, standOn, teleport } from './support.ts';

/** Every camp fire of the valley: the ring of stones, and Tink's hearth, which is his forge. */
const FIRES = ISLANDS.flatMap((island) => (CAMP_LAYOUTS[island.id]?.landmarks ?? [])
  .filter((landmark) => landmark.kind === 'campfire' || landmark.kind === 'forge_hearth')
  .map((landmark) => ({ islandId: island.id, kind: landmark.kind, x: landmark.x, z: landmark.z })));
const CAMPFIRES = FIRES.filter((fire) => fire.kind === 'campfire');

function at(islandId: IslandId, x: number, z: number): GameState {
  const state = newGame(7);
  standOn(state, islandId);
  teleport(state, islandId, x, z);
  state.weather.secondsRemaining = 99999;
  drainEvents(state);
  return state;
}

/** Clear ground on a ring round a point, a sixteenth of a turn apart. */
function ring(x: number, z: number, radius: number): { x: number; z: number }[] {
  return Array.from({ length: 16 }, (_, turn) => ({ x: x + Math.sin((turn * Math.PI) / 8) * radius, z: z - Math.cos((turn * Math.PI) / 8) * radius }))
    .filter((point) => !bodyBlocked(point.x, point.z));
}

describe('"F Cook at the fire"', () => {
  it('there is a fire in every camp: five rings of stones and one forge hearth', () => {
    expect(CAMPFIRES.map((fire) => fire.islandId).sort()).toEqual(['fire_tower_ridge', 'home_knoll', 'orchard_hill', 'steeple_rock', 'the_beacon']);
    expect(FIRES.filter((fire) => fire.kind === 'forge_hearth').map((fire) => fire.islandId)).toEqual(['scrapyard_bar']);
    // No camp without one: wherever the rules cook, there is a fire to press F at.
    for (const island of ISLANDS) if (island.camp) expect(FIRES.some((fire) => fire.islandId === island.id), island.id).toBe(true);
  });

  it.each(CAMPFIRES)('$islandId: shows all round the fire, from its stones out, and the fire\'s recipes are in reach there', (fire) => {
    let asked = 0;
    for (const radius of [1.5, 2, 2.5, 3]) {
      for (const point of ring(fire.x, fire.z, radius)) {
        const state = at(fire.islandId, point.x, point.z);
        expect(selectInteractable(state), `${radius} m out`).toMatchObject({ kind: 'bench', name: 'Campfire', prompt: 'Cook at the fire', station: 'fire' });
        expect(selectInventory(state).stations).toContain('fire');
        asked += 1;
      }
    }
    expect(asked).toBeGreaterThan(40);
  });

  it('is what a walker gets who walks straight into the fire and is stopped by it', () => {
    const fire = CAMPFIRES.find((entry) => entry.islandId === 'home_knoll')!;
    const state = at('home_knoll', fire.x + 6, fire.z);
    expect(selectInteractable(state)?.prompt ?? null).not.toBe('Cook at the fire');
    for (let count = 0; count < 6 * 60; count += 1) step(state, { ...NEUTRAL_INPUT, moveY: 1, cameraYaw: -Math.PI / 2 }, FIXED_STEP);
    const player = state.players[0].position;
    expect(bodyBlocked(player.x, player.z)).toBe(false);
    // Held at the fire's edge: its stones and the logs laid by them.
    expect(player.x - fire.x).toBeGreaterThan(0.5);
    expect(player.x - fire.x).toBeLessThan(3);
    expect(selectInteractable(state)).toMatchObject({ kind: 'bench', prompt: 'Cook at the fire', station: 'fire', distance: expect.any(Number) });
    // The panel the key opens can cook there: every fire recipe is listed for this player.
    const listed = selectCraftableRecipes(state).map((entry) => entry.recipeId);
    for (const recipeId of RECIPE_IDS.filter((id) => RECIPES[id].station === 'fire')) expect(listed).toContain(recipeId);
  });

  it('does not show a step past its reach', () => {
    for (const fire of CAMPFIRES) {
      const edge = approachTo(fire.x, fire.z).depth;
      for (const point of ring(fire.x, fire.z, edge + TUNING.foot.benchRange + 0.3)) {
        expect(selectInteractable(at(fire.islandId, point.x, point.z))?.prompt ?? null, fire.islandId).not.toBe('Cook at the fire');
      }
    }
  });

  it('says "Use the forge" at Tink\'s hearth, which is his fire and his forge', () => {
    const hearth = FIRES.find((fire) => fire.kind === 'forge_hearth')!;
    const stand = approachTo(hearth.x, hearth.z);
    const state = at(hearth.islandId, stand.x, stand.z);
    expect(selectInteractable(state)).toMatchObject({ kind: 'bench', name: 'Forge', prompt: 'Use the forge', station: 'forge' });
    expect(selectInventory(state).stations).toEqual(expect.arrayContaining(['fire', 'forge']));
  });

  it('leaves the stump its own words, and a bed its own: the nearer thing is the one offered', () => {
    const stump = CAMP_LAYOUTS.home_knoll!.landmarks.find((landmark) => landmark.kind === 'stump_bench')!;
    expect(selectInteractable(at('home_knoll', stump.x + 1.5, stump.z))).toMatchObject({ kind: 'bench', prompt: 'Use the bench', station: 'bench' });
    for (const islandId of ['orchard_hill', 'steeple_rock', 'fire_tower_ridge'] as const) {
      const bed = CAMP_LAYOUTS[islandId]!.beds[0];
      expect(selectInteractable(at(islandId, bed.x, bed.z)), islandId).toMatchObject({ kind: 'bed', prompt: 'Sleep until morning' });
    }
  });

  it('is not offered from the canoe, nor to someone talking or asleep', () => {
    const fire = CAMPFIRES.find((entry) => entry.islandId === 'home_knoll')!;
    const stand = approachTo(fire.x, fire.z);
    const state = at('home_knoll', stand.x, stand.z);
    expect(selectInteractable(state)?.prompt).toBe('Cook at the fire');
    state.players[0].asleep = true;
    expect(selectInteractable(state)?.prompt).not.toBe('Cook at the fire');
    state.players[0].asleep = false;
    Object.assign(state.players[0], { mode: 'canoe', seat: 0, islandId: null, position: { x: stand.x, y: terrainHeight(stand.x, stand.z), z: stand.z } });
    expect(selectInteractable(state)?.prompt ?? null).not.toBe('Cook at the fire');
  });
});
