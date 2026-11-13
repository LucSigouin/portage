/**
 * Island names only at the shore or aboard (Luc's bugfix list, line 4): the rule the look follows,
 * and the flag the HUD model carries for it.
 */
import { describe, expect, it } from 'vitest';
import { SHORE_METRES, atTheShore, buildHudModel, islandNamesShown, waterWithin } from '../../src/client/viewmodels/index.ts';
import { CAMP_LAYOUTS, ISLANDS, ISLANDS_BY_ID } from '../../src/data/index.ts';
import { createDefaultSettings } from '../../src/settings/index.ts';
import { islandLanding, terrainHeight } from '../../src/sim/index.ts';
import type { IslandId } from '../../src/data/index.ts';
import { floatCanoeAt, newGame, standOn, teleport, teleportToCamp } from '../support.ts';

/** Metres from (x, z) to the nearest open water, to half a metre, searched finely. */
function metresToWater(x: number, z: number): number {
  for (let radius = 0; radius <= 120; radius += 0.5) {
    for (let index = 0; index < 64; index += 1) {
      const angle = (index / 64) * 2 * Math.PI;
      if (terrainHeight(x + Math.sin(angle) * radius, z - Math.cos(angle) * radius) < -0.1) return radius;
    }
  }
  return Infinity;
}

describe('island names: aboard and at the shore, not inland', () => {
  it('names the islands aboard, afloat or beached', () => {
    const state = newGame();
    floatCanoeAt(state, -40, 1085);
    expect(islandNamesShown(state)).toBe(true);
    expect(buildHudModel(state, createDefaultSettings(), 0).islandNames).toBe(true);
    // Aboard is aboard, wherever the numbers put the seat: the rule does not ask the ground.
    teleportToCamp(state, 'home_knoll');
    state.players[0].mode = 'canoe';
    expect(islandNamesShown(state)).toBe(true);
  });

  it('names them just off the canoe at every landing, and not at any camp', () => {
    for (const island of ISLANDS) {
      const state = newGame();
      standOn(state, island.id);
      expect(islandNamesShown(state), `${island.id}: off the canoe`).toBe(true);
    }
    const camps = Object.keys(CAMP_LAYOUTS) as IslandId[];
    expect(camps.length).toBeGreaterThan(3);
    for (const islandId of camps) {
      const state = newGame();
      teleportToCamp(state, islandId);
      expect(islandNamesShown(state), `${islandId}: at the camp`).toBe(false);
      expect(buildHudModel(state, createDefaultSettings(), 0).islandNames, `${islandId}: the HUD model`).toBe(false);
    }
  });

  it('draws the line at 12 m from open water, walking inland from the landing', () => {
    expect(SHORE_METRES).toBe(12);
    const state = newGame();
    const { shore } = islandLanding('home_knoll');
    const centre = ISLANDS_BY_ID.home_knoll.center;
    const length = Math.hypot(centre.x - shore.x, centre.z - shore.z);
    let lastShown = -1;
    let firstHidden = -1;
    for (let along = 0; along <= length; along += 0.5) {
      const x = shore.x + ((centre.x - shore.x) * along) / length;
      const z = shore.z + ((centre.z - shore.z) * along) / length;
      teleport(state, 'home_knoll', x, z);
      const shown = islandNamesShown(state);
      if (shown) lastShown = metresToWater(x, z);
      else if (firstHidden < 0) firstHidden = metresToWater(x, z);
      // The coarse check agrees with the fine one everywhere a step or two either side of the line.
      const distance = metresToWater(x, z);
      if (distance <= SHORE_METRES - 1.5) expect(shown, `${distance} m from water`).toBe(true);
      if (distance >= SHORE_METRES + 0.5) expect(shown, `${distance} m from water`).toBe(false);
    }
    expect(lastShown).toBeGreaterThan(SHORE_METRES - 1.5);
    expect(firstHidden).toBeGreaterThanOrEqual(SHORE_METRES);
  });

  it('is the player\'s own: a crewmate inland and one at the water each get their own answer', () => {
    const state = newGame(7, { crew: 2 });
    teleportToCamp(state, 'home_knoll');
    const { shore } = islandLanding('home_knoll');
    Object.assign(state.players[1]!, { mode: 'foot', islandId: 'home_knoll', position: { x: shore.x, y: 0, z: shore.z } });
    expect(islandNamesShown(state, 0)).toBe(false);
    expect(islandNamesShown(state, 1)).toBe(true);
    expect(atTheShore(state.players[1]!)).toBe(true);
    expect(waterWithin(shore.x, shore.z, 3)).toBe(true);
  });
});
