/**
 * Scatter and presets: seeded, chosen by data, on the rules engine's ground,
 * and clear of everything the game needs.
 */
import { describe, expect, it } from 'vitest';
import { ISLANDS, ISLANDS_BY_ID } from '../../src/data/index.ts';
import { terrainHeight } from '../../src/sim/index.ts';
import { PRESETS, floraFor, presetIdFor } from '../../src/look/presets.ts';
import { VARIANTS, keepOutCircles, scatterIsland } from '../../src/look/scatter.ts';

const TREES = ['spruce', 'pine', 'birch'];

describe('region presets', () => {
  it('picks a preset for every island from its data', () => {
    const chosen = Object.fromEntries(ISLANDS.map((island) => [island.id, presetIdFor(island)]));
    expect(chosen).toMatchObject({
      home_knoll: 'knoll', heron_marsh: 'marsh', scrapyard_bar: 'gravel', quarry_face: 'granite', the_beacon: 'ridge',
      dam_crest: 'works', truss_bridge: 'works',
    });
    for (const island of ISLANDS) expect(PRESETS[chosen[island.id]]).toBeDefined();
  });

  it('bends the flora by what stands on the island', () => {
    expect(floraFor(ISLANDS_BY_ID.birch_islet).birch).toBeGreaterThan(floraFor(ISLANDS_BY_ID.home_knoll).birch);
  });
});

describe('scatter', () => {
  it('gives the same placements every time', () => {
    for (const island of ISLANDS.slice(0, 4)) expect(scatterIsland(island, floraFor(island))).toEqual(scatterIsland(island, floraFor(island)));
  });

  it('stands every tree on dry ground, at the rules engine\'s height, clear of what the game needs', () => {
    let trees = 0;
    for (const island of ISLANDS) {
      const circles = keepOutCircles(island);
      for (const placement of scatterIsland(island, floraFor(island))) {
        expect(placement.y).toBe(terrainHeight(placement.x, placement.z));
        expect(placement.variant).toBeLessThan(VARIANTS[placement.kind]);
        if (!TREES.includes(placement.kind)) continue;
        trees += 1;
        expect(placement.y).toBeGreaterThan(0.5);
        for (const circle of circles) expect(Math.hypot(circle.x - placement.x, circle.z - placement.z)).toBeGreaterThanOrEqual(circle.radius);
      }
    }
    // Enough to read as a boreal valley, few enough to hold the frame rate.
    expect(trees).toBeGreaterThan(400);
    expect(trees).toBeLessThan(1600);
  });

  it('keeps reeds in the shallows and boulders at the waterline', () => {
    const island = ISLANDS_BY_ID.heron_marsh;
    const placements = scatterIsland(island, floraFor(island));
    const reeds = placements.filter((placement) => placement.kind === 'reed');
    expect(reeds.length).toBeGreaterThan(10);
    for (const reed of reeds) expect(reed.y).toBeGreaterThanOrEqual(-0.9), expect(reed.y).toBeLessThanOrEqual(0.2);
    for (const boulder of placements.filter((placement) => placement.kind === 'boulder')) expect(Math.abs(boulder.y)).toBeLessThan(1);
  });
});
