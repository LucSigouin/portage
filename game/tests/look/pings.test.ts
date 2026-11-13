/**
 * The column of light on a ping, as numbers, with no graphics card: one for each ping standing, in its
 * player's colour, wide enough to find from across the lake, never drowned by the mist, and still.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CREW_MARKS, ISLANDS_BY_ID, WEATHER } from '../../src/data/index.ts';
import { mistDensity } from '../../src/look/daylight.ts';
import { BEAM, PingBeams, beamColour, beamHalfWidth, beamThroughMist, beamsOf, brightness, colourOf } from '../../src/look/pings.ts';
import source from '../../src/look/pings.ts?raw';
import { dispatch, terrainHeight } from '../../src/sim/index.ts';
import { newGame, run } from '../support.ts';

const hex = (colour: readonly [number, number, number]): string =>
  `#${colour.map((share) => Math.round(share * 255).toString(16).padStart(2, '0')).join('')}`;

/** The shader text alone: comments stripped, so prose cannot trip a check. */
const code = source.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('the beams', () => {
  it('stand one on each ping, in the colour of the player who set it', () => {
    const game = newGame(7, { crew: 4 });
    expect(beamsOf(game)).toEqual([]);
    game.players.forEach((player, index) => dispatch(game, { type: 'ping', x: 300 + index * 100, z: -500 }, player.id));
    const beams = beamsOf(game);
    expect(beams.map((beam) => [beam.playerId, beam.x, beam.z])).toEqual([[0, 300, -500], [1, 400, -500], [2, 500, -500], [3, 600, -500]]);
    expect(beams.map((beam) => beam.colour)).toEqual(CREW_MARKS.map((mark) => beamColour(mark.toque)));
    expect(new Set(beams.map((beam) => hex(beam.colour))).size).toBe(4);
  });

  it('keep the hue of the player\'s toque, and are never too pale to show against a day sky', () => {
    for (const mark of CREW_MARKS) {
      const own = colourOf(mark.toque);
      const drawn = beamColour(mark.toque);
      expect(brightness(drawn), mark.label).toBeLessThanOrEqual(BEAM.deepest + 1e-9);
      // The same hue: every channel deepened by the same share, and a colour already deep enough left as it is.
      const share = drawn[0] / own[0];
      expect(share, mark.label).toBeLessThanOrEqual(1);
      for (const channel of [1, 2]) expect(drawn[channel]! / own[channel]!, mark.label).toBeCloseTo(share, 9);
      if (brightness(own) <= BEAM.deepest) expect(hex(drawn), mark.label).toBe(mark.toque);
    }
    // The cream toque is the pale one: it is deepened. The rust one is not.
    expect(hex(beamColour(CREW_MARKS[2]!.toque))).not.toBe(CREW_MARKS[2]!.toque);
    expect(hex(beamColour(CREW_MARKS[0]!.toque))).toBe(CREW_MARKS[0]!.toque);
  });

  it('have their foot on the water out on the lake, and on the ground on an island', () => {
    const game = newGame(7, { crew: 2 });
    const knoll = ISLANDS_BY_ID.home_knoll.center;
    dispatch(game, { type: 'ping', x: 200, z: 1300 }, 0);
    dispatch(game, { type: 'ping', x: knoll.x, z: knoll.z }, 1);
    const [afloat, ashore] = beamsOf(game);
    expect(terrainHeight(200, 1300)).toBeLessThan(0);
    expect(afloat!.y).toBe(0);
    expect(ashore!.y).toBeGreaterThan(0.5);
    expect(ashore!.y).toBe(terrainHeight(Math.round(knoll.x), Math.round(knoll.z)));
  });

  it('are gone with the ping: cleared, or reached', () => {
    const game = newGame(7, { crew: 2 });
    dispatch(game, { type: 'ping', x: 300, z: -500 }, 0);
    dispatch(game, { type: 'ping', x: -300, z: -500 }, 1);
    dispatch(game, { type: 'clear_ping', playerId: 0 }, 1);
    expect(beamsOf(game).map((beam) => beam.playerId)).toEqual([1]);
    Object.assign(game.players[0]!, { mode: 'foot', seat: null, position: { x: -300, y: 0, z: -495 } });
    run(game, {}, 0.5);
    expect(beamsOf(game)).toEqual([]);
  });

  it('read a colour as written, and take anything else for white', () => {
    expect(colourOf('#ff8000')).toEqual([1, 128 / 255, 0]);
    expect(colourOf('#6b8396').map((share) => Math.round(share * 255))).toEqual([0x6b, 0x83, 0x96]);
    expect(colourOf('red')).toEqual([1, 1, 1]);
  });
});

describe('seen from afar', () => {
  /** Pixels a metre covers at `distance`, on a 1080-pixel-high window with the game's 60 degree lens. */
  const pixelsPerMetre = (distance: number): number => 1080 / (2 * Math.tan(Math.PI / 6)) / distance;

  it('is its own width up close and never under seven pixels across, however far', () => {
    expect(beamHalfWidth(50)).toBe(BEAM.halfWidth);
    expect(beamHalfWidth(300)).toBe(BEAM.halfWidth);
    for (const distance of [500, 1000, 2000, 3300]) {
      expect(beamHalfWidth(distance) * 2 * pixelsPerMetre(distance), `${distance} m`).toBeGreaterThanOrEqual(7);
      // And not a wall either: under a dozen.
      expect(beamHalfWidth(distance) * 2 * pixelsPerMetre(distance), `${distance} m`).toBeLessThan(12);
    }
  });

  it('stands taller than the highest ground of any island, and from across the lake still fills a hand of the view', () => {
    const peaks = Object.values(ISLANDS_BY_ID).map((island) => terrainHeight(island.center.x, island.center.z));
    expect(BEAM.height).toBeGreaterThan(Math.max(...peaks) * 2);
    expect(BEAM.height * pixelsPerMetre(3000)).toBeGreaterThan(40);
  });

  it('keeps most of its strength through any mist the weather has', () => {
    expect(beamThroughMist(0, 0.0025)).toBe(1);
    for (const kind of ['clear', 'rain', 'storm', 'fog'] as const) {
      const density = mistDensity(WEATHER[kind].visibility);
      expect(beamThroughMist(3000, density), kind).toBeGreaterThanOrEqual(BEAM.mistFloor);
      expect(beamThroughMist(300, density), kind).toBeGreaterThan(beamThroughMist(3000, density));
    }
    expect(BEAM.mistFloor).toBeGreaterThanOrEqual(0.5);
  });

  it('is drawn inside the camera\'s reach when it stands past it, so it is never cut off', () => {
    // The world view's camera sees 1700 m (`world-view.ts`). The lake is 2850 m long.
    expect(BEAM.drawWithin).toBeLessThan(1700);
    expect(code).toContain('if (range > WITHIN) view.xyz *= WITHIN / range;');
  });

  it('draws with the numbers written here: the shader and the tests read one table', () => {
    expect(code).toContain('const float HEIGHT = ${BEAM.height.toFixed(1)}');
    expect(code).toContain('const float MIN_ANGLE = ${BEAM.minimumAngle.toFixed(5)}');
    expect(code).toContain('const float FLOOR = ${BEAM.mistFloor.toFixed(3)}');
    expect(code).toContain('max(HALF * (1. + .35 * uVeil), dist * MIN_ANGLE)');
  });
});

describe('still', () => {
  it('reads no clock: nothing in the beam can pulse, shimmer, rise or fade', () => {
    for (const clock of ['uTime', 'paintTime', 'paintSeconds', 'elapsed', 'performance', 'Date', 'requestAnimationFrame', 'setTimeout', 'setInterval']) {
      expect(code.includes(clock), clock).toBe(false);
    }
    // What it does read: where it stands, where the eye is, the night and the mist.
    const uniforms = [...code.matchAll(/\bu[A-Z][A-Za-z]+\b/g)].map((match) => match[0]);
    expect([...new Set(uniforms)].sort()).toEqual(['uDark', 'uFogDensity', 'uPass', 'uVeil']);
  });

  it('is written to the graphics card when a ping changes, and not on any other frame', () => {
    const beams = new PingBeams();
    const feet = beams.mesh.geometry.getAttribute('aFoot') as THREE.InstancedBufferAttribute;
    const game = newGame(7, { crew: 2 });
    beams.sync(game);
    expect(beams.mesh.visible).toBe(false);
    expect(beams.mesh.count).toBe(0);
    dispatch(game, { type: 'ping', x: 300, z: -500 }, 1);
    beams.sync(game);
    expect(beams.mesh.visible).toBe(true);
    expect(beams.mesh.count).toBe(1);
    expect([feet.getX(0), feet.getY(0), feet.getZ(0)]).toEqual([300, 0, -500]);
    const written = feet.version;
    for (let frame = 0; frame < 120; frame += 1) {
      run(game, { paddle: 1 }, 1 / 60);
      beams.sync(game);
    }
    expect(feet.version).toBe(written);
    dispatch(game, { type: 'clear_ping', playerId: 1 }, 0);
    beams.sync(game);
    expect(feet.version).toBeGreaterThan(written);
    expect(beams.mesh.visible).toBe(false);
    expect(beams.beams).toEqual([]);
    beams.dispose();
  });

  it('is a wash of light, not a thing: see-through, hiding nothing, and never in the pen\'s buffer', () => {
    const beams = new PingBeams();
    const material = beams.mesh.material as THREE.ShaderMaterial;
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(true);
    expect(code).toContain('if (uPass == 1) { gl_Position = vec4(2., 2., 2., 1.); return; }');
    beams.dispose();
  });
});
