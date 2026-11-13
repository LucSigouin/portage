/**
 * The lobby's canoe picture, the parts that can be checked without a graphics chip: it is the game's own canoe
 * built from the saved state, the camera holds all of it in the frame, the pen is the game's pen for a canoe that
 * size, and the look's shared uniforms come back from the draw exactly as they went in.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { previewSubject, starterSubject } from '../../src/client/preview.ts';
import { ATTACHMENT_IDS } from '../../src/data/index.ts';
import { GU } from '../../src/look/b2/palette.js';
import { heroPen } from '../../src/look/b2/post.js';
import { SKETCH_VIEW, frameSubject, keepUniforms, pinUniform, sketchCanoe, sketchLight, sketchPen } from '../../src/look/canoe-sketch.ts';
import { CanoeView } from '../../src/look/canoe.ts';
import { crewOf } from '../../src/look/crew.ts';
import { SAVE_KEY_PREFIX, createSaveStore } from '../../src/save/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import { applyLight } from '../../src/viewer/light.ts';
import { FakeStorage, newGame } from '../support.ts';

const fixtures = import.meta.glob<string>('../fixtures/save-*.json', { eager: true, query: '?raw', import: 'default' });

/** The state the lobby would draw for a save text. */
function subjectState(text: string): GameState {
  const storage = new FakeStorage();
  storage.setItem(`${SAVE_KEY_PREFIX}0`, text);
  const store = createSaveStore(storage);
  return previewSubject(store.list(), store.latestSlot(), (slot) => store.load(slot))!.state;
}

/** The state the lobby would draw for a canoe made here. */
function stateWith(hullTier: number, attachments: string[], flags: { sail?: boolean; lantern?: boolean } = {}): GameState {
  const state = newGame(7);
  state.canoe.hullTier = hullTier;
  state.canoe.attachments = attachments as GameState['canoe']['attachments'];
  state.canoe.sailRaised = flags.sail ?? false;
  state.canoe.lanternLit = flags.lantern ?? false;
  const storage = new FakeStorage();
  const store = createSaveStore(storage);
  store.save(0, state);
  return previewSubject(store.list(), store.latestSlot(), (slot) => store.load(slot))!.state;
}

type Inside = { tier: number; attachments: THREE.Group; tiers: Map<number, { group: THREE.Group }> };

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

/** The four canoes of the rubric: the starter, hull 1 with its mends, a mid-game canoe, a canoe with everything built. */
const CANOES: [string, () => GameState][] = [
  ['the starter canoe', () => starterSubject().state],
  ['hull 1 with its mends (a live save, 30 minutes in)', () => subjectState(fixtures['../fixtures/save-live-seed3-min030.json']!)],
  ['a mid-game canoe', () => stateWith(2, ['outrigger_port', 'workbench', 'mast_sail', 'rudder', 'cargo_rack'])],
  ['a full canoe, everything built, sail up', () => stateWith(3, [...ATTACHMENT_IDS], { sail: true, lantern: true })],
];

describe('the picture is the game\'s own canoe, built from the saved state', () => {
  for (const [what, make] of CANOES) {
    it(`${what}: the same hull and the same attachments as the game's canoe view makes for that state`, () => {
      const state = make();
      const sketch = sketchCanoe(state);
      const game = new CanoeView();
      game.sync(state, crewOf(state), 0, 0, true, true);
      const [mine, theirs] = [sketch as unknown as Inside, game as unknown as Inside];
      expect(mine.tier).toBe(state.canoe.hullTier);
      expect(mine.tier).toBe(theirs.tier);
      expect(mine.attachments.children).toHaveLength(state.canoe.attachments.length);
      // Vertex for vertex what the game draws: nothing of the canoe is drawn here a second way.
      const count = (root: THREE.Object3D): number => pointsOf(root).length;
      expect(count(sketch.group)).toBe(count(game.group));
      expect(count(sketch.group)).toBeGreaterThan(1_000);
      expect(new THREE.Box3().setFromObject(sketch.group).getSize(new THREE.Vector3()).toArray())
        .toEqual(new THREE.Box3().setFromObject(game.group).getSize(new THREE.Vector3()).toArray());
      sketch.dispose();
      game.dispose();
    });
  }

  it('every attachment the game has is in the full canoe, each at its own mount', () => {
    const state = stateWith(3, [...ATTACHMENT_IDS], { sail: true, lantern: true });
    const sketch = sketchCanoe(state);
    const holders = (sketch as unknown as Inside).attachments.children;
    expect(holders).toHaveLength(ATTACHMENT_IDS.length);
    for (const holder of holders) expect(pointsOf(holder).length).toBeGreaterThan(0);
    sketch.dispose();
  });

  it('the patched hull carries its mends, and the leaky one does not', () => {
    const meshes = (state: GameState): number => {
      const sketch = sketchCanoe(state);
      const inside = sketch as unknown as Inside;
      const count = inside.tiers.get(inside.tier)!.group.children.length;
      sketch.dispose();
      return count;
    };
    // The hull, the kit and the bilge; the patched one adds its bark laps and its sheets.
    expect(meshes(stateWith(1, [])) - meshes(stateWith(0, []))).toBe(2);
  });

  it('nobody is in the picture: the canoe group holds no figure, and the paddle is left across the gunwales', () => {
    const sketch = sketchCanoe(stateWith(2, ['mast_sail']));
    expect(sketch.figures().map((figure) => figure.seat)).toEqual([null]);
    expect(sketch.figures()[0].paddle).toBe('canoe');
    let inGroup = false;
    sketch.group.traverse((object) => { if (object === sketch.figureOf(0)) inGroup = true; });
    expect(inGroup).toBe(false);
    sketch.dispose();
  });
});

describe('the camera holds the whole canoe', () => {
  for (const [what, make] of CANOES) {
    for (const [width, height] of [[341, 256], [243, 182], [682, 512]] as const) {
      it(`${what} in a frame of ${width} by ${height}: all of it inside the margin, standing on the bottom of it, middled, and filling the frame one way`, () => {
        const sketch = sketchCanoe(make());
        const camera = new THREE.PerspectiveCamera(SKETCH_VIEW.lens, width / height, 0.05, 200);
        const distance = frameSubject(camera, sketch.group);
        expect(distance).toBeGreaterThan(1);
        const reach = 1 - 2 * SKETCH_VIEW.margin;
        let [left, right, low, high] = [Infinity, -Infinity, Infinity, -Infinity];
        for (const point of pointsOf(sketch.group)) {
          const seen = point.clone().project(camera);
          expect(seen.z).toBeGreaterThan(-1);
          expect(seen.z).toBeLessThan(1);
          left = Math.min(left, seen.x);
          right = Math.max(right, seen.x);
          low = Math.min(low, seen.y);
          high = Math.max(high, seen.y);
        }
        // Inside the margin all round.
        expect(left).toBeGreaterThanOrEqual(-reach - 1e-6);
        expect(right).toBeLessThanOrEqual(reach + 1e-6);
        expect(high).toBeLessThanOrEqual(reach + 1e-6);
        // Standing on the bottom margin, and in the middle from side to side.
        expect(low).toBeCloseTo(-reach, 5);
        expect(left + right).toBeCloseTo(0, 2);
        // As big as the frame allows: it touches the margin across, or from bottom to top.
        expect(Math.max((right - left) / 2, (high - low) / 2)).toBeGreaterThan(reach * 0.97);
        sketch.dispose();
      });
    }
  }

  it('with nothing to look at it still makes a camera that can draw', () => {
    const camera = new THREE.PerspectiveCamera(SKETCH_VIEW.lens, 1.33, 0.05, 200);
    expect(frameSubject(camera, new THREE.Group())).toBe(6);
    expect(Number.isFinite(camera.position.length())).toBe(true);
    expect(camera.near).toBeLessThan(camera.far);
  });
});

describe('the sun is on the side the picture shows', () => {
  it('as high as the hour has it, and round on the camera\'s side of the canoe, a little toward the bow', () => {
    applyLight('day');
    const noon = GU.uLightDir.value.clone();
    const light = sketchLight(noon);
    expect(light.length()).toBeCloseTo(1, 10);
    // The hour's own height.
    expect(light.y).toBeCloseTo(noon.clone().normalize().y, 10);
    expect(light.y).toBeGreaterThan(0.3);
    // The camera stands 62 degrees round from astern; the sun is within 45 degrees of it, on the same side of the keel.
    const radians = Math.PI / 180;
    const camera = new THREE.Vector3(Math.sin(SKETCH_VIEW.yaw * radians), 0, Math.cos(SKETCH_VIEW.yaw * radians));
    const flat = new THREE.Vector3(light.x, 0, light.z).normalize();
    expect(flat.dot(camera)).toBeGreaterThan(Math.cos(45 * radians));
    expect(flat.x).toBeGreaterThan(0.7);
    // The side of the hull the camera sees faces +x: the sun is in front of it, not behind.
    expect(light.dot(new THREE.Vector3(1, 0, 0))).toBeGreaterThan(0.5);
    // A low sun stays low.
    expect(sketchLight(new THREE.Vector3(0, 0.2, -1)).y).toBeCloseTo(new THREE.Vector3(0, 0.2, -1).normalize().y, 10);
  });
});

describe('the pen is the game\'s pen for a canoe that size', () => {
  it('follows the game\'s own rule for a small hero, by how much world the window would take in at that scale', () => {
    // A canoe drawn 256 pixels high taking in 3.4 m, on a 1080-pixel window: as if the window took in 14.3 m. Full pen.
    expect(sketchPen(3.4, 256, 1080)).toBe(heroPen((3.4 / 256) * 1080));
    expect(sketchPen(3.4, 256, 1080)).toBe(1);
    // The same picture a quarter the size: the window would take in 57 m, and the pen thins as it does in the game.
    expect(sketchPen(3.4, 64, 1080)).toBe(heroPen(57.375));
    expect(sketchPen(3.4, 64, 1080)).toBeLessThan(0.5);
    expect(sketchPen(3.4, 64, 1080)).toBeGreaterThanOrEqual(0.3);
    expect(Number.isFinite(sketchPen(3.4, 0, 1080))).toBe(true);
  });
});

describe('the look\'s shared uniforms come back as they went in', () => {
  /** Every uniform's value, as something that can be compared. */
  const reading = (): string => JSON.stringify(Object.entries(GU).map(([name, uniform]) => {
    const value = (uniform as { value: unknown }).value as { isTexture?: boolean; uuid?: string };
    return [name, value?.isTexture ? `texture ${value.uuid}` : value];
  }));

  it('after the light, the pen scale, the time and a lamp were all changed', () => {
    // A stormy night, as a game behind the lobby might have it.
    GU.uLight.value.setRGB(0.21, 0.24, 0.33);
    GU.uLightDir.value.set(0.3, 0.2, -0.9).normalize();
    GU.uDark.value = 0.85;
    GU.uWet.value = 0.7;
    GU.uRain.value = 1;
    GU.uTime.value = 1234.5;
    GU.uSc.value = 1.333;
    GU.uPxK.value = 0.0007;
    GU.uHatch.value = 0.6;
    GU.uLamp.value[2].set(4, 5, 6, 7);
    const before = reading();
    const objects = Object.values(GU).map((uniform) => (uniform as { value: unknown }).value);
    const restore = keepUniforms(GU as unknown as Record<string, { value: unknown }>);

    // What the draw does to them.
    applyLight('day');
    GU.uHatch.value = 1;
    GU.uOvercast.value = 0;
    GU.uStars.value = 0;
    GU.uSc.value = 0.2;
    GU.uPxK.value = 0.004;
    GU.uPass.value = 1;
    GU.uLamp.value[2].set(0, 0, 0, 0);
    expect(reading()).not.toBe(before);

    restore();
    expect(reading()).toBe(before);
    // The same objects, not copies: the shaders hold on to them.
    expect(Object.values(GU).map((uniform) => (uniform as { value: unknown }).value).every((value, index) => value === objects[index] || typeof value === 'number')).toBe(true);
    expect(GU.uLamp.value[2].toArray()).toEqual([4, 5, 6, 7]);
    expect(GU.uTime.value).toBe(1234.5);
  });

  it('a held uniform ignores every write until it is let go, then is a plain value again', () => {
    const uniform = { value: 0.5 };
    const letGo = pinUniform(uniform, 1.25);
    expect(uniform.value).toBe(1.25);
    uniform.value = 0.17;
    expect(uniform.value).toBe(1.25);
    letGo(0.5);
    expect(uniform.value).toBe(0.5);
    uniform.value = 0.9;
    expect(uniform.value).toBe(0.9);
    expect(Object.getOwnPropertyDescriptor(uniform, 'value')).toMatchObject({ writable: true, enumerable: true });
    expect(JSON.stringify(uniform)).toBe('{"value":0.9}');
  });
});
