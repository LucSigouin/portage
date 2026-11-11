/**
 * The water and the ground the shaders see, against the rules engine. These
 * mirror the shader arithmetic in JavaScript from the packed uniforms; the
 * browser test reads the real thing back from the graphics card.
 */
import { describe, expect, it } from 'vitest';
import { ISLANDS, TUNING } from '../../src/data/index.ts';
import { terrainHeight, waterRoughnessAt, waveHeight } from '../../src/sim/index.ts';
import { GROUND_UNIFORM, mirrorGround, mirrorWaveSum, regionUniforms, shoreUniforms, waveUniforms } from '../../src/look/surface.ts';
import { seededRandom } from '../../src/look/scatter.ts';

describe('water surface uniforms', () => {
  it('give the rules engine\'s wave height everywhere, at any time, in any storm', () => {
    const random = seededRandom(7);
    const regions = regionUniforms();
    for (let sample = 0; sample < 4000; sample += 1) {
      const x = (random() - 0.5) * 2200;
      const z = (random() - 0.5) * 3000;
      const time = random() * 40 * 1440;
      const storm = sample % 3 === 0 ? random() : 0;
      const drawn = mirrorWaveSum(waveUniforms(time), regions, TUNING.world.regionBlendMetres, storm, x, z);
      expect(drawn).toBeCloseTo(waveHeight(x, z, time, waterRoughnessAt(x, z, storm)), 9);
    }
  });

  it('keep each phase small, so the shader\'s floats lose nothing after days of play', () => {
    for (const wave of waveUniforms(60 * 1440)) expect(Math.abs(wave[3])).toBeLessThanOrEqual(Math.PI * 2);
  });
});

describe('shore uniforms', () => {
  it('give the rules engine\'s ground round every island', () => {
    const random = seededRandom(11);
    for (const island of ISLANDS) {
      for (let sample = 0; sample < 300; sample += 1) {
        // Points on and just off the island, seen by a player standing near it.
        const angle = random() * Math.PI * 2;
        const reach = random() * 1.7;
        const x = island.center.x + Math.cos(angle) * reach * island.radiusX;
        const z = island.center.z + Math.sin(angle) * reach * island.radiusZ;
        const shore = shoreUniforms(island.center.x + (random() - 0.5) * 60, island.center.z + (random() - 0.5) * 60, 4);
        expect(mirrorGround(shore, GROUND_UNIFORM, x, z)).toBeCloseTo(terrainHeight(x, z), 6);
      }
    }
  });

  it('give the valley wall\'s shore near the player', () => {
    for (const z of [-1200, -700, 0, 900]) {
      const shore = shoreUniforms(0, z, 4);
      for (const side of [-1, 1]) {
        const x = side * (shore.valley[0] + 3);
        expect(mirrorGround(shore, GROUND_UNIFORM, x, z)).toBeCloseTo(terrainHeight(x, z), 6);
      }
    }
  });
});
