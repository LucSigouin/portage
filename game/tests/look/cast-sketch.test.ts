/**
 * The pick screen's pictures, the parts that can be checked without a graphics chip: each picture is the game's own
 * figure standing still, one camera holds all four at one scale with their feet on one line at every card size,
 * the sun is on the side shown, the line is held to one weight with no change to the pen, and the look's shared
 * uniforms come back from a call exactly as they went in.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CHARACTER_IDS, CREW_MARKS } from '../../src/data/index.ts';
import type { CharacterId } from '../../src/data/index.ts';
import { createCrew } from '../../src/look/b2/canoe.js';
import type { Crew as Figure } from '../../src/look/b2/canoe.js';
import { GU } from '../../src/look/b2/palette.js';
import { SKETCH_HOUR, sketchLight } from '../../src/look/canoe-sketch.ts';
import {
  CAST_PEN, CAST_VIEW, castFrame, disposeFigure, drawCastSketches, evenPen, holdWhile, penValueFor, standingCast, standingFigure,
} from '../../src/look/cast-sketch.ts';
import { paletteAt } from '../../src/look/daylight.ts';

const sources = import.meta.glob<string>('../../src/look/b2/{post,palette}.js', { eager: true, query: '?raw', import: 'default' });

/** Every vertex of everything visible, in the world. */
function pointsOf(root: THREE.Object3D): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  root.updateMatrixWorld(true);
  root.traverseVisible((object) => {
    const positions = (object as THREE.Mesh).geometry?.getAttribute?.('position');
    if (!positions) return;
    for (let index = 0; index < positions.count; index += 1) points.push(new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(object.matrixWorld));
  });
  return points;
}

/** Where a figure falls on a card: the edges of its drawing, each from -1 to 1 of the frame. */
function onCard(figure: Figure, camera: THREE.PerspectiveCamera): { left: number; right: number; low: number; high: number; inFront: boolean } {
  let [left, right, low, high] = [Infinity, -Infinity, Infinity, -Infinity];
  let inFront = true;
  for (const point of pointsOf(figure.root)) {
    const seen = point.clone().project(camera);
    if (!(seen.z > -1 && seen.z < 1)) inFront = false;
    left = Math.min(left, seen.x);
    right = Math.max(right, seen.x);
    low = Math.min(low, seen.y);
    high = Math.max(high, seen.y);
  }
  return { left, right, low, high, inFront };
}

/** The card sizes the screen may ask for, smallest to largest, and two shapes it does not use today. */
const CARDS = [[120, 180], [240, 360], [480, 720], [200, 200], [300, 180]] as const;

describe('each picture is the game\'s own figure, standing still', () => {
  for (const who of CHARACTER_IDS) {
    it(`the ${who}: the figure the canoe view makes, in the seat's colours, the soles on the line, the paddle left behind`, () => {
      for (let seat = 0; seat < CREW_MARKS.length; seat += 1) {
        const figure = standingFigure(who, seat);
        const game = createCrew(CREW_MARKS[seat], who);
        game.stand(0);
        // Vertex for vertex and colour for colour what the game draws ashore: nothing is drawn here a second way.
        const mine = pointsOf(figure.root);
        const theirs = pointsOf(game.root);
        expect(mine.length).toBe(theirs.length);
        expect(mine.length).toBeGreaterThan(1_000);
        const drop = theirs[0].y - mine[0].y;
        for (let index = 0; index < mine.length; index += 97) {
          expect(mine[index].x).toBeCloseTo(theirs[index].x, 9);
          expect(mine[index].y + drop).toBeCloseTo(theirs[index].y, 9);
          expect(mine[index].z).toBeCloseTo(theirs[index].z, 9);
        }
        const colours = (one: Figure): number[] => {
          const all: number[] = [];
          one.root.traverseVisible((object) => {
            const colour = (object as THREE.Mesh).geometry?.getAttribute?.('aColor');
            if (colour) for (let index = 0; index < colour.count; index += 53) all.push(colour.getX(index), colour.getY(index), colour.getZ(index));
          });
          return all;
        };
        expect(colours(figure)).toEqual(colours(game));
        expect(colours(figure).length).toBeGreaterThan(60);
        // The soles stand on the line, and nothing is below it.
        expect(Math.min(...mine.map((point) => point.y))).toBeCloseTo(0, 9);
        // Still and upright: the head is over the feet.
        const top = mine.reduce((best, point) => (point.y > best.y ? point : best));
        expect(Math.hypot(top.x, top.z)).toBeLessThan(0.3);
        expect(figure.paddler.paddle.visible).toBe(false);
        disposeFigure(figure);
        disposeFigure(game);
      }
    });
  }

  it('a seat past the last wraps round, as the crew\'s colours do', () => {
    const colourOf = (figure: Figure): number[] => {
      const colour = ((figure.root.children[0] as THREE.Group).children[0] as THREE.Mesh).geometry.getAttribute('aColor');
      return [colour.getX(0), colour.getY(0), colour.getZ(0)];
    };
    expect(colourOf(standingFigure('trapper', 5))).toEqual(colourOf(standingFigure('trapper', 1)));
    expect(colourOf(standingFigure('trapper', 1))).not.toEqual(colourOf(standingFigure('trapper', 0)));
  });
});

describe('one camera for all four: one scale, the feet on one line, everything inside', () => {
  for (const [width, height] of CARDS) {
    it(`a card of ${width} by ${height}: each whole figure with what it carries is inside the margin, and all four stand on the bottom of it`, () => {
      const cast = standingCast(0);
      const camera = new THREE.PerspectiveCamera(CAST_VIEW.lens, width / height, 0.05, 200);
      const metres = castFrame(camera, [...cast.values()]);
      expect(metres).toBeGreaterThan(1.8);
      expect(metres).toBeLessThan(4);
      const reach = 1 - 2 * CAST_VIEW.margin;
      const placed = new Map<CharacterId, ReturnType<typeof onCard>>();
      for (const [who, figure] of cast) placed.set(who, onCard(figure, camera));
      for (const [who, at] of placed) {
        expect(at.inFront, who).toBe(true);
        expect(at.left, who).toBeGreaterThanOrEqual(-reach - 1e-6);
        expect(at.right, who).toBeLessThanOrEqual(reach + 1e-6);
        expect(at.high, who).toBeLessThanOrEqual(reach + 1e-6);
        expect(at.low, who).toBeGreaterThanOrEqual(-reach - 1e-6);
        // The feet on one line: within one pixel of the bottom margin on the largest card (720 high: 2 / 720).
        expect(at.low, who).toBeLessThan(-reach + 2 / 720);
      }
      // One scale: the tall one is taller on its card, and the four fill the card one way.
      const tall = (who: CharacterId): number => placed.get(who)!.high - placed.get(who)!.low;
      expect(tall('angler')).toBeGreaterThan(tall('voyageur'));
      expect(tall('voyageur')).toBeGreaterThan(tall('scout') + 0.05);
      const widest = Math.max(...[...placed.values()].map((at) => Math.max(at.right, -at.left)));
      const highest = Math.max(...[...placed.values()].map((at) => at.high));
      expect(Math.max(widest, highest)).toBeGreaterThan(reach * 0.97);
      // The same metres to a pixel for each: a pair of points one metre apart at the figures' place, seen by this one camera.
      expect((2 / metres) * (height / 2)).toBeGreaterThan(height / 4);
      for (const figure of cast.values()) disposeFigure(figure);
    });
  }

  it('the frame does not depend on who is asked for or in what order, and leaves each figure where it was', () => {
    const cast = standingCast(2);
    const scene = new THREE.Scene();
    for (const figure of cast.values()) scene.add(figure.root);
    cast.get('scout')!.root.visible = false;
    const one = new THREE.PerspectiveCamera(CAST_VIEW.lens, 2 / 3, 0.05, 200);
    const other = new THREE.PerspectiveCamera(CAST_VIEW.lens, 2 / 3, 0.05, 200);
    const metres = castFrame(one, [...cast.values()]);
    expect(castFrame(other, [...cast.values()].reverse())).toBeCloseTo(metres, 6);
    expect(other.position.distanceTo(one.position)).toBeLessThan(1e-6);
    for (const figure of cast.values()) expect(figure.root.parent).toBe(scene);
    expect([...cast.values()].map((figure) => figure.root.visible)).toEqual([true, true, true, false]);
    // A figure with no home goes back to none.
    const loose = standingFigure('angler', 0);
    castFrame(one, [loose]);
    expect(loose.root.parent).toBeNull();
  });

  it('seen from the front and a little to one side, nearly level, and lit from the side shown', () => {
    const cast = standingCast(0);
    const camera = new THREE.PerspectiveCamera(CAST_VIEW.lens, 2 / 3, 0.05, 200);
    castFrame(camera, [...cast.values()]);
    const from = camera.position.clone().normalize();
    // In front of the figures (they face +z), on their left hand, between 10 and 40 degrees round.
    expect(from.z).toBeGreaterThan(Math.cos((40 * Math.PI) / 180));
    expect(from.x).toBeGreaterThan(Math.sin((10 * Math.PI) / 180) * 0.9);
    expect(Math.abs(camera.position.y - 0.9)).toBeLessThan(1.2);
    // The sun: as high as noon has it, on the camera's side of the figure and in front of it.
    const light = sketchLight(new THREE.Vector3(...paletteAt(SKETCH_HOUR, 0, 0).lightDirection), CAST_VIEW);
    expect(light.z).toBeGreaterThan(0.2);
    expect(light.x).toBeGreaterThan(0.2);
    expect(new THREE.Vector3(light.x, 0, light.z).normalize().dot(new THREE.Vector3(from.x, 0, from.z).normalize())).toBeGreaterThan(Math.cos((45 * Math.PI) / 180));
  });
});

describe('the line of the cards: no wander, one weight', () => {
  /** The pen's own reading of the number a surface carries for it (b2/post.js, the pen). */
  const weightOf = (value: number): number => {
    const carried = value * 0.45;
    const s = ((carried * 2) % 1) / 0.9 - 0.5;
    return 0.5 + 0.5 * Math.sin(s * 8 + 2);
  };

  it('the pen still reads a surface\'s weight the way this file answers it', () => {
    // If either line of the pen or the ink buffer changes, the cards' line may no longer be even: look at the pictures again.
    const pen = sources['../../src/look/b2/post.js']!;
    const ink = sources['../../src/look/b2/palette.js']!;
    expect(pen).toContain('float s = fract(sv * 2.) / .9 - .5;');
    expect(pen).toContain('float weight = .5 + .5 * sin(s * 8. + 2.);');
    expect(pen).toContain('vec2 wob = vec2(sin(s * 5.), sin(s * 7.3 + 1.1)) * wobR;');
    expect(ink).toContain('float wv = mix(vnoise(wq * f0 + 7.), vnoise(wq * f0 * .5 + 7.), lw - l0);');
    expect(ink).toContain('nearWater * .5 + wv * .45');
  });

  it('the value asked of the noise gives the weight asked for, and the cards ask for the heaviest with no wander', () => {
    for (const weight of [0, 0.25, 0.5, 0.75, 1]) {
      const value = penValueFor(weight);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      expect(weightOf(value)).toBeCloseTo(weight, 9);
    }
    expect(CAST_PEN.wobble).toBe(0);
    expect(CAST_PEN.weight).toBe(1);
    // As one byte of a texture, the weight is still the heaviest to a hundredth.
    expect(weightOf(Math.round(penValueFor(CAST_PEN.weight) * 255) / 255)).toBeGreaterThan(0.99);
  });

  it('the noise is flat only while the ink buffer is drawn, and the game\'s own noise is back afterwards', () => {
    const noise = GU.tNoise.value as THREE.Texture;
    const pass = GU.uPass.value;
    const release = evenPen(1);
    GU.uPass.value = 0;
    expect(GU.tNoise.value).toBe(noise);
    GU.uPass.value = 2;
    expect(GU.tNoise.value).toBe(noise);
    GU.uPass.value = 1;
    const flat = GU.tNoise.value as THREE.DataTexture;
    expect(flat).not.toBe(noise);
    expect([flat.image.width, flat.image.height]).toEqual([1, 1]);
    expect(weightOf((flat.image.data as Uint8Array)[0] / 255)).toBeGreaterThan(0.99);
    release();
    expect(GU.tNoise.value).toBe(noise);
    expect(Object.getOwnPropertyDescriptor(GU.tNoise, 'value')).toMatchObject({ writable: true, enumerable: true });
    GU.uPass.value = pass;
  });

  it('a uniform held for a while: read as the held value only then, written through to the real one', () => {
    const uniform = { value: 3 };
    let on = false;
    const release = holdWhile(uniform, 7, () => on);
    expect(uniform.value).toBe(3);
    on = true;
    expect(uniform.value).toBe(7);
    uniform.value = 4;
    expect(uniform.value).toBe(7);
    on = false;
    expect(uniform.value).toBe(4);
    on = true;
    release();
    expect(uniform.value).toBe(4);
    expect(JSON.stringify(uniform)).toBe('{"value":4}');
  });
});

describe('a call that cannot draw leaves nothing behind', () => {
  /** Every uniform's value, as something that can be compared. */
  const reading = (): string => JSON.stringify(Object.entries(GU).map(([name, uniform]) => {
    const value = (uniform as { value: unknown }).value as { isTexture?: boolean; uuid?: string };
    return [name, value?.isTexture ? `texture ${value.uuid}` : value];
  }));

  it('no size, no picture: null, with nothing touched', () => {
    const before = reading();
    expect(drawCastSketches({ characters: CHARACTER_IDS, seat: 0, pixelWidth: 0, pixelHeight: 360, sheetHeight: 1080 })).toBeNull();
    expect(drawCastSketches({ characters: CHARACTER_IDS, seat: 0, pixelWidth: 240, pixelHeight: Number.NaN, sheetHeight: 1080 })).toBeNull();
    expect(reading()).toBe(before);
  });

  it('no 3D context (as here, with no browser): null, nothing thrown, and every shared uniform as it was', () => {
    GU.uLight.value.setRGB(0.21, 0.24, 0.33);
    GU.uLightDir.value.set(0.3, 0.2, -0.9).normalize();
    GU.uDark.value = 0.85;
    GU.uTime.value = 1234.5;
    GU.uSc.value = 1.333;
    GU.uPxK.value = 0.0007;
    const before = reading();
    const noise = GU.tNoise.value;
    expect(drawCastSketches({ characters: ['scout', 'voyageur'], seat: 3, pixelWidth: 240, pixelHeight: 360, sheetHeight: 1080 })).toBeNull();
    expect(reading()).toBe(before);
    expect(GU.tNoise.value).toBe(noise);
    expect(Object.getOwnPropertyDescriptor(GU.uSc, 'value')).toMatchObject({ writable: true, value: 1.333 });
    expect(Object.getOwnPropertyDescriptor(GU.tNoise, 'value')).toMatchObject({ writable: true });
  });
});
