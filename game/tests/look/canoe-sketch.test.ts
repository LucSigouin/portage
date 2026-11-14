/**
 * The helpers of a still picture drawn once on nothing (`look/canoe-sketch.ts`): its light, the see-through
 * picture, its pen, and the look's shared uniforms kept and put back. The lobby's canoe sketch they were written
 * for is gone (Round 4); the pick screen's four figures draw with them. These tests are main's, word for word.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GU } from '../../src/look/b2/palette.js';
import { heroPen } from '../../src/look/b2/post.js';
import {
  SKETCH_HOUR, SKETCH_VIEW, keepUniforms, pinUniform, seeThrough, sketchDaylight, sketchLight, sketchPen,
} from '../../src/look/canoe-sketch.ts';
import { paletteAt } from '../../src/look/daylight.ts';

describe('the sun is on the side the picture shows', () => {
  it('as high as the hour has it, and round on the camera\'s side of the canoe, a little toward the bow', () => {
    const noon = new THREE.Vector3(...paletteAt(SKETCH_HOUR, 0, 0).lightDirection);
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

  it('the picture\'s light is the game\'s own noon, clear and dry, with that sun, whatever the uniforms held before', () => {
    const clock = GU.uTime.value;
    const restore = keepUniforms(GU as unknown as Record<string, { value: unknown }>);
    GU.uLight.value.setRGB(0.1, 0.1, 0.3);
    GU.uPaper.value.setRGB(0.2, 0.2, 0.4);
    GU.uDark.value = 1;
    GU.uWet.value = 1;
    GU.uRain.value = 1;
    GU.uVeil.value = 1;
    GU.uTime.value = 99;
    GU.uHatch.value = 0;
    sketchDaylight();
    const palette = paletteAt(12, 0, 0);
    expect(SKETCH_HOUR).toBe(12);
    expect(GU.uLight.value.toArray()).toEqual(new THREE.Color().setRGB(...palette.light).toArray());
    expect(GU.uPaper.value.toArray()).toEqual(new THREE.Color().setRGB(...palette.paper).toArray());
    expect(GU.uShadowTint.value.toArray()).toEqual(new THREE.Color().setRGB(...palette.shadowTint).toArray());
    expect(GU.uLightDir.value.toArray()).toEqual(sketchLight(new THREE.Vector3(...palette.lightDirection)).toArray());
    expect([GU.uDark.value, GU.uWet.value, GU.uRain.value, GU.uVeil.value, GU.uTime.value, GU.uStars.value, GU.uOvercast.value]).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(GU.uHatch.value).toBe(1);
    restore();
    expect(GU.uTime.value).toBe(clock);
  });
});

describe('one see-through picture from a frame on black and the same frame on white', () => {
  it('what the canoe covers keeps its colour, what it does not is clear, and a soft edge is part of each', () => {
    //                                  covered            bare paper        half an edge of (200, 100, 50)
    const onBlack = new Uint8ClampedArray([180, 90, 40, 255, 0, 0, 0, 255, 100, 50, 25, 255]);
    const onWhite = new Uint8ClampedArray([180, 90, 40, 255, 255, 255, 255, 255, 228, 178, 153, 255]);
    const out = new Uint8ClampedArray(12);
    seeThrough(onBlack, onWhite, out);
    expect([...out.slice(0, 4)]).toEqual([180, 90, 40, 255]);
    expect([...out.slice(4, 8)]).toEqual([0, 0, 0, 0]);
    expect(out[11]).toBeGreaterThanOrEqual(126);
    expect(out[11]).toBeLessThanOrEqual(129);
    for (const [channel, colour] of [[8, 200], [9, 100], [10, 50]] as const) expect(Math.abs(out[channel] - colour)).toBeLessThanOrEqual(3);
    // The faintest trace (a quarter of a hundredth) is paper too: no speck of full colour at one part in 255.
    const trace = new Uint8ClampedArray(4);
    seeThrough(new Uint8ClampedArray([1, 0, 0, 255]), new Uint8ClampedArray([255, 255, 254, 255]), trace);
    expect([...trace]).toEqual([0, 0, 0, 0]);
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
    sketchDaylight();
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
