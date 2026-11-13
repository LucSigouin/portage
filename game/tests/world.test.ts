import { describe, expect, it } from 'vitest';
import {
  ISLANDS, ISLANDS_BY_ID, NODES, NODE_IDS, NODES_BY_ID, NPCS, NPC_IDS, REGIONS, TUNING, WAVE_TABLE, spotPosition,
} from '../src/data/index.ts';
import { findFootPath, walkGoal } from '../src/bot/navigation.ts';
import {
  baseRoughnessAt, currentAt, hullGrounding, islandAt, islandLanding, landingBerth, regionAt, terrainHeight,
  valleyHalfWidth, waterRoughnessAt, waveGradient, waveHeight, waveNormal,
} from '../src/sim/index.ts';

describe('water surface', () => {
  it('is exactly the documented sum over the exported wave table', () => {
    // The formula a GLSL shader would run, written out independently.
    const shader = (x: number, z: number, time: number, roughness: number): number => {
      let sum = 0;
      for (const wave of WAVE_TABLE) {
        sum += wave.amplitude * Math.sin(wave.wavenumber * (wave.directionX * x + wave.directionZ * z)
          - wave.angularFrequency * time + wave.phase);
      }
      return roughness * sum;
    };
    for (const [x, z, time, roughness] of [[0, 0, 0, 1], [123.4, -567.8, 91.2, 2], [-900, 1200, 5000.5, 3.4]]) {
      expect(waveHeight(x, z, time, roughness)).toBe(shader(x, z, time, roughness));
    }
  });

  it('is built from a few unit-direction waves with deep-water speeds', () => {
    expect(WAVE_TABLE.length).toBeGreaterThanOrEqual(3);
    expect(WAVE_TABLE.length).toBeLessThanOrEqual(6);
    for (const wave of WAVE_TABLE) {
      expect(Math.hypot(wave.directionX, wave.directionZ)).toBeCloseTo(1, 12);
      expect(wave.angularFrequency).toBeCloseTo(Math.sqrt(9.81 * wave.wavenumber), 12);
    }
  });

  it('scales with roughness and is flat at roughness 0', () => {
    expect(waveHeight(40, 70, 12, 0)).toBe(0);
    expect(waveHeight(40, 70, 12, 3)).toBeCloseTo(3 * waveHeight(40, 70, 12, 1), 12);
    const peak = WAVE_TABLE.reduce((sum, wave) => sum + wave.amplitude, 0);
    for (let sample = 0; sample < 200; sample += 1) {
      expect(Math.abs(waveHeight(sample * 3.7, sample * -1.9, sample * 0.61, 3))).toBeLessThanOrEqual(3 * peak + 1e-9);
    }
  });

  it('has a normal that matches the slope of the height', () => {
    const [x, z, time, roughness] = [31.5, -12.25, 44.4, 2.5];
    const epsilon = 1e-4;
    const slopeX = (waveHeight(x + epsilon, z, time, roughness) - waveHeight(x - epsilon, z, time, roughness)) / (2 * epsilon);
    const slopeZ = (waveHeight(x, z + epsilon, time, roughness) - waveHeight(x, z - epsilon, time, roughness)) / (2 * epsilon);
    const gradient = waveGradient(x, z, time, roughness);
    expect(gradient.x).toBeCloseTo(slopeX, 6);
    expect(gradient.z).toBeCloseTo(slopeZ, 6);
    const normal = waveNormal(x, z, time, roughness);
    expect(Math.hypot(normal.x, normal.y, normal.z)).toBeCloseTo(1, 12);
    expect(normal.y).toBeGreaterThan(0.9);
    expect(normal.x / normal.y).toBeCloseTo(-slopeX, 6);
    expect(normal.z / normal.y).toBeCloseTo(-slopeZ, 6);
  });
});

describe('regions', () => {
  it('are the four bands of the brief with roughness 1, 2, 3, 3', () => {
    expect(REGIONS.map((region) => [region.id, region.roughness])).toEqual([
      ['shallows', 1], ['reach', 2], ['narrows', 3], ['fog', 3],
    ]);
    expect(REGIONS.filter((region) => region.fogWall).map((region) => region.id)).toEqual(['fog']);
    expect(regionAt(0, 1150).id).toBe('shallows');
    expect(regionAt(0, 0).id).toBe('reach');
    expect(regionAt(0, -700).id).toBe('narrows');
    expect(regionAt(0, -1200).id).toBe('fog');
  });

  it('puts every island in the region the table says, apart from the bridge that spans two', () => {
    for (const island of ISLANDS) {
      if (island.id === 'truss_bridge') continue;
      expect(regionAt(island.center.x, island.center.z).id, island.id).toBe(island.regionId);
      const landing = islandLanding(island.id);
      expect(regionAt(landing.approach.x, landing.approach.z).id, `${island.id} landing`).toBe(island.regionId);
    }
  });

  it('ramps roughness up only on the rough side of a boundary', () => {
    const edge = REGIONS[1].southEdgeZ;
    expect(baseRoughnessAt(0, edge + 1)).toBe(1);
    expect(baseRoughnessAt(0, edge)).toBeCloseTo(1, 6);
    const partWay = baseRoughnessAt(0, edge - TUNING.world.regionBlendMetres / 2);
    expect(partWay).toBeGreaterThan(1.3);
    expect(partWay).toBeLessThan(1.7);
    expect(baseRoughnessAt(0, edge - TUNING.world.regionBlendMetres - 1)).toBe(2);
    // Never above the rougher region, never below the calmer one.
    for (let z = 1400; z > -1400; z -= 7) {
      const roughness = baseRoughnessAt(0, z);
      expect(roughness).toBeGreaterThanOrEqual(1);
      expect(roughness).toBeLessThanOrEqual(3);
    }
  });

  it('adds the storm level to roughness everywhere', () => {
    expect(waterRoughnessAt(0, 1100, 0)).toBe(1);
    expect(waterRoughnessAt(0, 1100, 1)).toBe(2);
    expect(waterRoughnessAt(0, 0, 0.5)).toBe(2.5);
  });

  it('runs a current only in the Narrows', () => {
    expect(currentAt(0, 1100)).toEqual({ x: 0, z: 0 });
    expect(currentAt(0, 0)).toEqual({ x: 0, z: 0 });
    expect(currentAt(0, -1200)).toEqual({ x: 0, z: 0 });
    const current = currentAt(150, -650);
    expect(current.z).toBeCloseTo(0.6, 6);
    expect(current.x).toBe(0);
  });
});

describe('terrain', () => {
  it('raises every island above the water and drops to the seabed between them', () => {
    for (const island of ISLANDS) {
      expect(terrainHeight(island.center.x, island.center.z), island.id).toBeGreaterThan(island.peakHeight * 0.9);
    }
    expect(terrainHeight(0, 900)).toBe(-TUNING.world.seabedDepth);
    expect(terrainHeight(150, 500)).toBe(-TUNING.world.seabedDepth);
  });

  it('has fifteen islands, none overlapping, all inside the valley', () => {
    expect(ISLANDS).toHaveLength(15);
    for (const island of ISLANDS) {
      const reach = Math.max(island.radiusX, island.radiusZ);
      expect(Math.abs(island.center.x) + reach, island.id).toBeLessThan(valleyHalfWidth(island.center.z));
      for (const other of ISLANDS) {
        if (other === island) continue;
        // Somewhere on the line between two islands the water is seabed deep.
        let deepest = 0;
        for (let step = 0; step <= 200; step += 1) {
          const share = step / 200;
          deepest = Math.min(deepest, terrainHeight(
            island.center.x + (other.center.x - island.center.x) * share,
            island.center.z + (other.center.z - island.center.z) * share,
          ));
        }
        expect(deepest, `${island.id} / ${other.id}`).toBeLessThan(-5);
      }
    }
  });

  it('closes the lake with valley walls too steep to climb', () => {
    for (const z of [1200, 300, -600, -1200]) {
      const shore = valleyHalfWidth(z);
      expect(terrainHeight(shore - 30, z)).toBeLessThan(-1);
      expect(terrainHeight(shore + 10, z)).toBeGreaterThan(5);
      const slope = (terrainHeight(shore + 6, z) - terrainHeight(shore + 5, z)) / 1;
      expect(slope).toBeGreaterThan(TUNING.foot.slopeLimit);
    }
    expect(valleyHalfWidth(-650)).toBeLessThan(valleyHalfWidth(0) / 2);
    expect(terrainHeight(0, 1420)).toBeGreaterThan(0);
    expect(terrainHeight(0, -1470)).toBeGreaterThan(0);
  });

  it('gives every island a landing: shore at the waterline, deep water off it, a free berth', () => {
    for (const island of ISLANDS) {
      const landing = islandLanding(island.id);
      expect(Math.abs(terrainHeight(landing.shore.x, landing.shore.z)), island.id).toBeLessThan(0.05);
      expect(terrainHeight(landing.approach.x, landing.approach.z), island.id).toBeLessThan(-3);
      for (const tier of [0, 3]) {
        const berth = landingBerth(island.id, tier);
        expect(hullGrounding(berth.x, berth.z, berth.heading, tier), island.id).toBeLessThanOrEqual(0);
        expect(Math.hypot(berth.x - landing.shore.x, berth.z - landing.shore.z), island.id).toBeLessThan(25);
      }
    }
  });
});

describe('node placement', () => {
  const footNodes = NODES.filter((node) => node.reach === 'foot');

  it('puts every foot node on dry ground and every buoy in open water', () => {
    for (const node of footNodes) {
      expect(terrainHeight(node.position.x, node.position.z), node.id).toBeGreaterThan(0.2);
      expect(islandAt(node.position.x, node.position.z), node.id).toBe(node.islandId);
    }
    const buoys = NODES.filter((node) => node.reach === 'canoe');
    expect(buoys).toHaveLength(4);
    for (const buoy of buoys) expect(terrainHeight(buoy.position.x, buoy.position.z), buoy.id).toBeLessThan(-3);
  });

  it('keeps nodes far enough apart to tell which one you mean', () => {
    for (const island of ISLANDS) {
      const nodes = footNodes.filter((node) => node.islandId === island.id);
      for (let first = 0; first < nodes.length; first += 1) {
        for (let second = first + 1; second < nodes.length; second += 1) {
          const gap = Math.hypot(nodes[first].position.x - nodes[second].position.x, nodes[first].position.z - nodes[second].position.z);
          expect(gap, `${nodes[first].id} / ${nodes[second].id}`).toBeGreaterThan(3);
        }
      }
    }
  });

  it('lets you walk from the landing to every node, camp and survivor', () => {
    for (const island of ISLANDS) {
      const shore = islandLanding(island.id).shore;
      const targets = footNodes.filter((node) => node.islandId === island.id).map((node) => ({ label: node.id, ...node.position }));
      if (island.camp) targets.push({ label: `${island.id} camp`, ...spotPosition(island, island.camp.spot) });
      for (const npcId of NPC_IDS) {
        if (NPCS[npcId].islandId === island.id) targets.push({ label: npcId, ...spotPosition(island, NPCS[npcId].spot) });
      }
      for (const target of targets) {
        // Where the rules let you stand to use it: the fire and the landmarks are solid (Luc's list, line 1).
        expect(findFootPath(island.id, shore, walkGoal(target, TUNING.foot.nodeRange).target), target.label).not.toBeNull();
      }
    }
  });

  it('lands the Truss Bridge in the Reach and puts its signal hut in the Narrows', () => {
    const landing = islandLanding('truss_bridge');
    expect(regionAt(landing.approach.x, landing.approach.z).id).toBe('reach');
    expect(baseRoughnessAt(landing.approach.x, landing.approach.z)).toBe(2);
    const hut = NODES_BY_ID[NODE_IDS.signalHut];
    expect(regionAt(hut.position.x, hut.position.z).id).toBe('narrows');
    expect(ISLANDS_BY_ID.truss_bridge.regionId).toBe('narrows');
  });
});
