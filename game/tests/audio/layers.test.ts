import { describe, expect, it } from 'vitest';
import { ISLANDS_BY_ID, REGIONS_BY_ID, spotPosition } from '../../src/data/index.ts';
import type { RegionId } from '../../src/data/index.ts';
import { FIXED_STEP, NEUTRAL_INPUT, step, terrainHeight } from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import {
  LAYER_NAMES, LOBBY_INPUTS, birdActivity, computeLayerLevels, createDeriveMemory, deriveLayerInputs, fogCutoff,
  loonActivity, nightShare,
} from '../../src/audio/layers.ts';
import type { LayerInputs, LayerName } from '../../src/audio/layers.ts';
import { fakeGain, fakeParam } from './fake-audio-context.ts';
import type { Rig } from './support.ts';
import { createRig, newGame, nodeOfType } from './support.ts';

const CALM: LayerInputs = { ...LOBBY_INPUTS, roughness: 1, windSpeed: 2, hour: 12, openWater: 0.5 };
const level = (inputs: Partial<LayerInputs>, name: LayerName): number => computeLayerLevels({ ...CALM, ...inputs })[name];

/** Where a layer's gain ends up once the glide has finished. */
const settledLayer = (rig: Rig, name: LayerName): number => fakeGain(rig.nodes.layers[name]).gain.settledValue();

/** Deep water in a region, well clear of every island. */
function openWaterIn(regionId: RegionId): { x: number; z: number } {
  const region = REGIONS_BY_ID[regionId];
  for (let z = region.southEdgeZ - 120; z > region.northEdgeZ + 120; z -= 40) {
    for (let x = -400; x <= 400; x += 40) {
      const deep = [[0, 0], [150, 0], [-150, 0], [0, 150], [0, -150]]
        .every(([offsetX, offsetZ]) => terrainHeight(x + offsetX, z + offsetZ) < -4);
      if (deep) return { x, z };
    }
  }
  throw new Error(`No open water found in ${regionId}`);
}

/** Put the canoe afloat with the player aboard and a dry hull. */
function floatAt(state: GameState, regionId: RegionId): void {
  const { x, z } = openWaterIn(regionId);
  state.players[0].mode = 'canoe';
  state.players[0].islandId = null;
  state.players[0].regionId = regionId;
  state.players[0].position = { x, y: 0, z };
  state.canoe.position = { x, y: 0, z };
  state.canoe.heading = 0;
  state.canoe.speed = 0;
  state.canoe.beached = false;
  state.canoe.waterLevel = 0;
}

/** Stand the player at the Home Knoll camp, canoe left where it is. */
function standAtCamp(state: GameState): void {
  const island = ISLANDS_BY_ID.home_knoll;
  if (!island.camp) throw new Error('Home Knoll has no camp');
  const camp = spotPosition(island, island.camp.spot);
  state.players[0].mode = 'foot';
  state.players[0].islandId = 'home_knoll';
  state.players[0].position = { x: camp.x, y: terrainHeight(camp.x, camp.z), z: camp.z };
}

/** Run frames of the real simulation with the engine listening. */
function play(rig: Rig, state: GameState, seconds: number, input: Partial<typeof NEUTRAL_INPUT> = {}): void {
  for (let frame = 0; frame < seconds / FIXED_STEP; frame += 1) {
    step(state, { ...NEUTRAL_INPUT, ...input }, FIXED_STEP);
    state.events.length = 0;
    rig.context.advance(FIXED_STEP);
    rig.engine.update(state, FIXED_STEP);
  }
}

/** Let fake time pass with fixed inputs, ticking like the game would. */
function listen(rig: Rig, inputs: LayerInputs, seconds: number): void {
  for (let frame = 0; frame < seconds * 20; frame += 1) {
    rig.context.advance(0.05);
    rig.engine.inspector.applyLayerInputs(inputs, 0.05);
    rig.engine.inspector.tick();
  }
}

describe('layer levels', () => {
  it('rougher water is louder', () => {
    expect(level({ roughness: 3 }, 'water')).toBeGreaterThan(level({ roughness: 1 }, 'water'));
    expect(level({ roughness: 4 }, 'water')).toBeGreaterThan(level({ roughness: 3 }, 'water'));
    // And quieter from up the hill than from the canoe.
    expect(level({ aboard: false, onFoot: true, heightAboveWater: 8 }, 'water')).toBeLessThan(level({}, 'water'));
  });

  it('follows wind, rain, storm, speed, hull water and fire in the right direction', () => {
    expect(level({ windSpeed: 9 }, 'wind')).toBeGreaterThan(level({ windSpeed: 3 }, 'wind'));
    expect(level({ windSpeed: 0 }, 'wind')).toBe(0);
    expect(level({ windSpeed: 6, openWater: 0 }, 'pines')).toBeGreaterThan(level({ windSpeed: 6, openWater: 1 }, 'pines'));
    expect(level({ rain: 0 }, 'rain')).toBe(0);
    expect(level({ rain: 1 }, 'rain')).toBeGreaterThan(level({ rain: 0.5 }, 'rain'));
    expect(level({ stormLevel: 0 }, 'storm')).toBe(0);
    expect(level({ stormLevel: 1 }, 'storm')).toBeGreaterThan(level({ stormLevel: 0.4 }, 'storm'));
    expect(level({ canoeSpeed: 0 }, 'wash')).toBe(0);
    expect(level({ canoeSpeed: 3.2 }, 'wash')).toBeGreaterThan(level({ canoeSpeed: 1 }, 'wash'));
    expect(level({ canoeSpeed: -1.2 }, 'wash')).toBeGreaterThan(0);
    expect(level({ canoeSpeed: 3, aboard: false }, 'wash')).toBe(0);
    expect(level({ hullWater: 0 }, 'slosh')).toBe(0);
    expect(level({ hullWater: 0.9 }, 'slosh')).toBeGreaterThan(level({ hullWater: 0.3 }, 'slosh'));
    expect(level({ hullWater: 0.9, nearCanoe: false }, 'slosh')).toBe(0);
    expect(level({ nearFire: false }, 'fire')).toBe(0);
    expect(level({ nearFire: true }, 'fire')).toBeGreaterThan(0);
    expect(level({ fog: 1 }, 'hush')).toBeGreaterThan(level({ fog: 0 }, 'hush'));
  });

  it('keeps crickets for dry nights near land', () => {
    expect(level({ hour: 12 }, 'crickets')).toBe(0);
    expect(level({ hour: 1 }, 'crickets')).toBeGreaterThan(0);
    expect(level({ hour: 23 }, 'crickets')).toBeGreaterThan(0);
    expect(level({ hour: 1, rain: 1 }, 'crickets')).toBe(0);
    expect(level({ hour: 1, openWater: 0 }, 'crickets')).toBeGreaterThan(level({ hour: 1, openWater: 1 }, 'crickets'));
    expect(nightShare(0)).toBe(1);
    expect(nightShare(12)).toBe(0);
  });

  it('has birds by day and loons at dusk and night over open water', () => {
    const day = { ...CALM, hour: 12, openWater: 0 };
    const dawn = { ...CALM, hour: 6.5, openWater: 0 };
    const night = { ...CALM, hour: 1, openWater: 1 };
    const dusk = { ...CALM, hour: 20.5, openWater: 1 };
    expect(birdActivity(day)).toBeGreaterThan(0.5);
    expect(birdActivity(dawn)).toBeGreaterThan(birdActivity(day));
    expect(birdActivity(night)).toBe(0);
    expect(birdActivity({ ...day, rain: 1 })).toBeLessThan(birdActivity(day));
    expect(birdActivity({ ...day, stormLevel: 1 })).toBe(0);
    expect(loonActivity(night)).toBeGreaterThan(0.9);
    expect(loonActivity(dusk)).toBeGreaterThan(0.5);
    // By day a loon is the odd one out.
    expect(loonActivity({ ...day, openWater: 1 })).toBeLessThan(0.1);
    expect(loonActivity({ ...night, openWater: 0 })).toBeLessThan(loonActivity(night));
    expect(loonActivity({ ...night, stormLevel: 1 })).toBe(0);
  });

  it('closes the ambience down in fog', () => {
    expect(fogCutoff(0)).toBeCloseTo(16000, 0);
    expect(fogCutoff(1)).toBeCloseTo(2400, 0);
    expect(fogCutoff(0.5)).toBeLessThan(fogCutoff(0.2));
  });
});

describe('layers on the graph', () => {
  it('moves each bed toward its level, and back to silence', async () => {
    const rig = await createRig();
    const loud: LayerInputs = {
      ...CALM, roughness: 3.5, windSpeed: 10, rain: 1, stormLevel: 1, canoeSpeed: 3, hullWater: 0.8, nearFire: true,
      hour: 1, fog: 1, openWater: 0, weatherKind: 'storm',
    };
    rig.engine.inspector.applyLayerInputs(loud, 0.016);
    const expected = computeLayerLevels(loud);
    for (const name of LAYER_NAMES) {
      expect(settledLayer(rig, name), name).toBeCloseTo(expected[name], 5);
      // A glide, never a jump.
      expect(fakeGain(rig.nodes.layers[name]).gain.valueAtTime(rig.context.currentTime), name).toBeLessThan(0.01);
    }
    expect(settledLayer(rig, 'water')).toBeGreaterThan(computeLayerLevels(CALM).water);

    const quiet: LayerInputs = {
      ...CALM, roughness: 0, windSpeed: 0, hour: 12, aboard: false, nearCanoe: false, onFoot: true, heightAboveWater: 30,
    };
    rig.context.advance(1);
    rig.engine.inspector.applyLayerInputs(quiet, 0.016);
    for (const name of ['wind', 'rain', 'storm', 'wash', 'slosh', 'fire', 'crickets', 'hush', 'pines'] as const) {
      expect(settledLayer(rig, name), name).toBeCloseTo(0, 5);
    }
    rig.engine.dispose();
  });

  it('muffles the ambience bus in fog and opens it again', async () => {
    const rig = await createRig();
    const cutoff = fakeParam(rig.nodes.ambienceTone.frequency);
    rig.engine.inspector.applyLayerInputs({ ...CALM, fog: 1 }, 0.016);
    expect(cutoff.settledValue()).toBeCloseTo(2400, 0);
    rig.context.advance(1);
    rig.engine.inspector.applyLayerInputs({ ...CALM, fog: 0 }, 0.016);
    expect(cutoff.settledValue()).toBeCloseTo(16000, 0);
    rig.engine.dispose();
  });

  it('scatters the right grains for the hour and the weather', async () => {
    const started = async (inputs: LayerInputs, seconds: number): Promise<(label: string) => number> => {
      const rig = await createRig(11);
      listen(rig, inputs, seconds);
      const { voicesStarted } = rig.engine.inspector;
      const counts = new Map(['bird', 'loon', 'thunder', 'crackle', 'wavelet', 'glop'].map((label) => [label, voicesStarted(label)]));
      rig.engine.dispose();
      return (label) => counts.get(label) ?? 0;
    };

    const noon = await started({ ...CALM, hour: 12, openWater: 0 }, 120);
    expect(noon('bird')).toBeGreaterThanOrEqual(8);
    expect(noon('thunder')).toBe(0);
    expect(noon('crackle')).toBe(0);
    expect(noon('wavelet')).toBeGreaterThan(40);

    const night = await started({ ...CALM, hour: 1, openWater: 1 }, 300);
    expect(night('bird')).toBe(0);
    expect(night('loon')).toBeGreaterThanOrEqual(2);
    expect(night('loon')).toBeLessThanOrEqual(12);

    const storm = await started({ ...CALM, hour: 12, stormLevel: 1, rain: 1, roughness: 4, weatherKind: 'storm' }, 120);
    expect(storm('thunder')).toBeGreaterThanOrEqual(3);
    expect(storm('bird')).toBe(0);
    expect(storm('wavelet')).toBeGreaterThan(noon('wavelet'));

    const fireside = await started({ ...CALM, nearFire: true, hullWater: 0.7 }, 10);
    expect(fireside('crackle')).toBeGreaterThan(40);
    expect(fireside('glop')).toBeGreaterThan(2);
  });
});

describe('layers from the game state', () => {
  it('reads the starting state: aboard, afloat, a hull full of water', () => {
    const state = newGame();
    const inputs = deriveLayerInputs(state, createDeriveMemory(), FIXED_STEP);
    expect(inputs.aboard).toBe(true);
    expect(inputs.onFoot).toBe(false);
    expect(inputs.regionId).toBe('shallows');
    expect(inputs.hullWater).toBeCloseTo(state.canoe.waterLevel / 100, 5);
    expect(inputs.hullWater).toBeGreaterThan(0.3);
    expect(inputs.roughness).toBeCloseTo(1, 1);
    expect(inputs.hour).toBeCloseTo(7, 1);
    expect(inputs.paddling).toBe('none');
    expect(inputs.rain).toBe(0);
  });

  it('gets louder water in a rougher region and in a storm', async () => {
    const rig = await createRig();
    const state = newGame();
    floatAt(state, 'shallows');
    rig.engine.update(state, FIXED_STEP);
    const shallows = settledLayer(rig, 'water');
    floatAt(state, 'narrows');
    rig.engine.update(state, FIXED_STEP);
    const narrows = settledLayer(rig, 'water');
    expect(narrows).toBeGreaterThan(shallows);

    state.weather.kind = 'storm';
    state.weather.stormLevel = 1;
    state.weather.windSpeed = 11;
    rig.engine.update(state, FIXED_STEP);
    expect(settledLayer(rig, 'water')).toBeGreaterThan(narrows);
    expect(settledLayer(rig, 'storm')).toBeGreaterThan(0.4);
    expect(settledLayer(rig, 'rain')).toBeGreaterThan(0.9);
    expect(settledLayer(rig, 'wind')).toBeGreaterThan(0.8);
    rig.engine.dispose();
  });

  it('follows the weather: wind, rain, fog', () => {
    const state = newGame();
    floatAt(state, 'reach');
    const memory = createDeriveMemory();
    state.weather.kind = 'clear';
    state.weather.windSpeed = 3;
    const clear = deriveLayerInputs(state, memory, FIXED_STEP);
    expect(clear.rain).toBe(0);
    expect(clear.fog).toBe(0);
    expect(clear.windSpeed).toBe(3);
    expect(clear.roughness).toBeCloseTo(2, 1);
    state.weather.kind = 'rain';
    expect(deriveLayerInputs(state, memory, FIXED_STEP).rain).toBeGreaterThan(0.5);
    state.weather.kind = 'fog';
    expect(deriveLayerInputs(state, memory, FIXED_STEP).fog).toBe(1);
    // The Fog region is foggy whatever the sky says.
    state.weather.kind = 'clear';
    floatAt(state, 'fog');
    expect(deriveLayerInputs(state, memory, FIXED_STEP).fog).toBeGreaterThan(0.5);
  });

  it('hears the hull fill and empty', async () => {
    const rig = await createRig();
    const state = newGame();
    floatAt(state, 'shallows');
    rig.engine.update(state, FIXED_STEP);
    expect(settledLayer(rig, 'slosh')).toBe(0);
    state.canoe.waterLevel = 40;
    rig.engine.update(state, FIXED_STEP);
    const half = settledLayer(rig, 'slosh');
    state.canoe.waterLevel = 90;
    rig.engine.update(state, FIXED_STEP);
    expect(half).toBeGreaterThan(0);
    expect(settledLayer(rig, 'slosh')).toBeGreaterThan(half);
    rig.engine.dispose();
  });

  it('tells a paddled canoe from a coasting one, and plays strokes only while paddled', async () => {
    const rig = await createRig();
    const state = newGame();
    floatAt(state, 'shallows');
    const { voicesStarted } = rig.engine.inspector;

    play(rig, state, 1);
    expect(voicesStarted('paddle')).toBe(0);
    expect(settledLayer(rig, 'wash')).toBeCloseTo(0, 2);

    play(rig, state, 6, { paddle: 1 });
    expect(state.canoe.speed).toBeGreaterThan(1.5);
    const strokes = voicesStarted('paddle');
    // About one stroke every 1.25 seconds.
    expect(strokes).toBeGreaterThanOrEqual(3);
    expect(strokes).toBeLessThanOrEqual(7);
    const paddlingWash = settledLayer(rig, 'wash');
    expect(paddlingWash).toBeGreaterThan(0.2);

    // Let go: the hull coasts, the wash fades with the speed, and the strokes stop.
    play(rig, state, 1);
    const afterLettingGo = voicesStarted('paddle');
    play(rig, state, 6);
    expect(voicesStarted('paddle')).toBe(afterLettingGo);
    expect(settledLayer(rig, 'wash')).toBeLessThan(paddlingWash * 0.3);

    // A power stroke is flagged by the state itself and comes faster.
    state.players[0].energy = 100;
    play(rig, state, 6, { paddle: 1, powerStroke: true });
    expect(voicesStarted('paddle') - afterLettingGo).toBeGreaterThanOrEqual(5);
    rig.engine.dispose();
  });

  it('plays the bailing can while the canoe is being bailed', async () => {
    const rig = await createRig();
    const state = newGame();
    floatAt(state, 'shallows');
    state.canoe.waterLevel = 80;
    const { voicesStarted } = rig.engine.inspector;
    play(rig, state, 2);
    expect(voicesStarted('bail')).toBe(0);
    play(rig, state, 4, { bail: true });
    expect(state.canoe.waterLevel).toBeLessThan(80);
    expect(voicesStarted('bail')).toBeGreaterThanOrEqual(4);
    expect(voicesStarted('bail')).toBeLessThanOrEqual(5);
    const whenStopped = voicesStarted('bail');
    play(rig, state, 3);
    expect(voicesStarted('bail')).toBe(whenStopped);
    rig.engine.dispose();
  });

  it('crackles when a fire is in reach, at the camp or by the firebox', async () => {
    const rig = await createRig();
    const state = newGame();
    floatAt(state, 'reach');
    rig.engine.update(state, 1);
    expect(settledLayer(rig, 'fire')).toBe(0);

    state.canoe.attachments.push('firebox');
    rig.engine.update(state, 1);
    expect(settledLayer(rig, 'fire')).toBeGreaterThan(0);

    state.canoe.attachments.length = 0;
    rig.engine.update(state, 1);
    expect(settledLayer(rig, 'fire')).toBe(0);

    standAtCamp(state);
    rig.engine.update(state, 1);
    expect(settledLayer(rig, 'fire')).toBeGreaterThan(0);
    rig.engine.dispose();
  });

  it('has crickets at night and none at noon', async () => {
    const rig = await createRig();
    const state = newGame();
    standAtCamp(state);
    state.weather.kind = 'clear';
    state.time = 12 * 60;
    rig.engine.update(state, 1);
    expect(settledLayer(rig, 'crickets')).toBe(0);
    state.time = 23.5 * 60;
    rig.engine.update(state, 1);
    expect(settledLayer(rig, 'crickets')).toBeGreaterThan(0);
    rig.engine.dispose();
  });

  it('plays footsteps on foot, faster at a run, and none standing still', async () => {
    const rig = await createRig();
    const state = newGame();
    standAtCamp(state);
    const { voicesStarted } = rig.engine.inspector;
    const walk = (seconds: number, speed: number): number => {
      const before = voicesStarted('footstep');
      for (let frame = 0; frame < seconds * 60; frame += 1) {
        // The state carries no input: the engine sees only the position move, tick by tick.
        state.tick += 1;
        state.players[0].position.x += speed * FIXED_STEP;
        rig.context.advance(FIXED_STEP);
        rig.engine.update(state, FIXED_STEP);
      }
      return voicesStarted('footstep') - before;
    };

    expect(walk(2, 0)).toBe(0);
    const walking = walk(3, 2.6);
    expect(walking).toBeGreaterThanOrEqual(8);
    expect(walking).toBeLessThanOrEqual(12);
    const running = walk(3, 4.4);
    expect(running).toBeGreaterThan(walking);
    expect(walk(2, 0)).toBe(0);

    // Being moved by the game (a respawn) is not a walk.
    state.tick += 1;
    state.players[0].position.x += 400;
    rig.engine.update(state, FIXED_STEP);
    expect(walk(1, 0)).toBe(0);

    // No footsteps in the canoe.
    floatAt(state, 'shallows');
    expect(walk(2, 2.6)).toBe(0);
    rig.engine.dispose();
  });

  it('plays one hit for a one-press scavenge, and no rhythm after it', async () => {
    const rig = await createRig();
    const state = newGame();
    standAtCamp(state);
    const spruce = nodeOfType('spruce');
    const { voicesStarted } = rig.engine.inspector;
    const wait = (seconds: number): void => {
      for (let frame = 0; frame < seconds * 60; frame += 1) {
        state.tick += 1;
        rig.context.advance(FIXED_STEP);
        rig.engine.update(state, FIXED_STEP);
      }
    };

    rig.engine.update(state, FIXED_STEP);
    rig.engine.handleEvents([{ type: 'harvest_started', nodeId: spruce, actionIndex: 1, playerId: 0 }]);
    expect(voicesStarted('scavenge_chop')).toBe(1);
    // Nothing is held any more, so nothing keeps time: the one chop is all there is.
    wait(5);
    expect(voicesStarted('scavenge_chop')).toBe(1);
    rig.engine.dispose();
  });
});
