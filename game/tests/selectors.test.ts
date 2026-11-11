import { describe, expect, it } from 'vitest';
import { ISLANDS, TUNING } from '../src/data/index.ts';
import {
  selectCanoeStats, selectInventory, selectMap, selectMeters, selectRespawnPoint, selectWeather,
} from '../src/sim/index.ts';
import { build, floatCanoeAt, give, newGame, run, standOn } from './support.ts';

describe('canoe stats', () => {
  it('reports the hull as it is', () => {
    const state = newGame();
    expect(selectCanoeStats(state)).toMatchObject({
      hullTier: 0, hullName: 'Leaky canoe', stability: 1, roughnessHere: 1, cargoSlots: 8, cargoUsed: 0,
      paddleSpeed: 2.2, powerStrokeSpeed: 3.2, sailMaximumSpeed: 5, hasSail: false, leakPerSecond: 0.4,
      floodPerSecond: 0, bailPerSecond: 3, canCrossFog: false, stations: [],
    });
    state.canoe.hullTier = 3;
    build(state, 'outrigger_port', 'outrigger_starboard', 'cargo_rack', 'firebox', 'workbench', 'mast_sail', 'rudder', 'lantern_mast', 'radio');
    give(state, 'plank', 30, 'cargo');
    expect(selectCanoeStats(state)).toMatchObject({
      hullTier: 3, hullName: 'Long canoe', stability: 3, cargoSlots: 22, cargoUsed: 2, hasSail: true,
      leakPerSecond: 0, canCrossFog: true, stations: ['fire', 'bench'], turnRate: TUNING.canoe.rudderTurnRate,
    });
  });
});

describe('map', () => {
  it('starts with Home Knoll and discovers islands as you come near', () => {
    const state = newGame();
    const map = selectMap(state);
    expect(map.fullChart).toBe(false);
    expect(map.islands).toHaveLength(ISLANDS.length);
    expect(map.islands.filter((island) => island.discovered).map((island) => island.islandId)).toEqual(['home_knoll']);
    expect(map.islands[0].bearing).toBeNull();
    state.canoe.hullTier = 1;
    floatCanoeAt(state, 150, 1000);
    const events = run(state, { paddle: 1 }, 1);
    expect(events).toContainEqual({ type: 'island_discovered', islandId: 'birch_islet' });
    expect(selectMap(state).islands.find((island) => island.islandId === 'birch_islet')!.discovered).toBe(true);
    expect(selectMap(state).islands.find((island) => island.islandId === 'steeple_rock')!.discovered).toBe(false);
  });

  it('marks the player, the canoe when ashore, the respawn point and quest targets', () => {
    const state = newGame();
    const afloat = selectMap(state).markers.map((marker) => marker.kind);
    expect(afloat).toContain('player');
    expect(afloat).toContain('respawn');
    expect(afloat).not.toContain('canoe');
    expect(selectMap(state).markers.find((marker) => marker.kind === 'quest')).toMatchObject({ islandId: 'home_knoll', questId: 'bail_out' });
    standOn(state, 'home_knoll');
    expect(selectMap(state).markers.find((marker) => marker.kind === 'canoe')).toMatchObject({ islandId: 'home_knoll' });
  });

  it('shows quest markers on unseen islands only with the radio, and the whole chart with the map table', () => {
    const state = newGame();
    state.quests.bail_out.status = 'completed';
    state.quests.the_bellkeeper.status = 'active';
    state.trackedQuestId = 'the_bellkeeper';
    const questMarkers = () => selectMap(state).markers.filter((marker) => marker.kind === 'quest').map((marker) => marker.islandId);
    expect(questMarkers()).not.toContain('steeple_rock');
    build(state, 'radio');
    expect(questMarkers()).toContain('steeple_rock');
    expect(selectMap(state).markers.some((marker) => marker.kind === 'survivor')).toBe(false);
    build(state, 'map_table');
    const chart = selectMap(state);
    expect(chart.fullChart).toBe(true);
    expect(chart.islands.every((island) => island.discovered)).toBe(true);
    expect(chart.markers.filter((marker) => marker.kind === 'survivor').map((marker) => marker.label)).toEqual(['Odile', 'Wren', 'Tink']);
    const steeple = chart.islands.find((island) => island.islandId === 'steeple_rock')!;
    expect(steeple.distance).toBeCloseTo(Math.hypot(40 - state.player.position.x, 250 - state.player.position.z), 6);
    expect(Math.abs(steeple.bearing!)).toBeLessThan(0.1); // almost due north of the start
  });
});

describe('hud', () => {
  it('reports meters, shelter and warnings', () => {
    const state = newGame();
    state.canoe.waterLevel = 75;
    state.player.thirst = 10;
    expect(selectMeters(state)).toMatchObject({
      hunger: 80, thirst: 10, energy: 90, energyCap: 100, waterLevel: 75, sheltered: false,
      low: { hunger: false, thirst: true, energy: false, swamping: true },
    });
  });

  it('reports inventory, respawn and weather', () => {
    const state = newGame();
    give(state, 'driftwood', 3);
    expect(selectInventory(state)).toMatchObject({
      backpack: [{ itemId: 'driftwood', count: 3 }], backpackSlots: 8, cargoSlots: 8, cargoAccessible: true,
      tools: ['bailing_can'], selectedTool: null, stations: ['hands'], stackSize: 20,
    });
    expect(selectRespawnPoint(state)).toMatchObject({ islandId: 'home_knoll', mobile: false });
    expect(selectWeather(state)).toMatchObject({ kind: 'clear', name: 'Clear', raining: false, stormLevel: 0 });
    expect(selectWeather(state).secondsUntilChange).toBe(TUNING.weather.firstWeatherSeconds);
  });
});
