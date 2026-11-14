/**
 * Backing, from Luc's note "the rowing animation is really buggy". The look read the stroke's direction from the
 * canoe's speed alone and mirrored the stroke's clock when it changed: holding S at speed showed 0.9 s more of
 * forward strokes, then the whole pose jumped (the blade 73 cm, the tip 95 cm, in one frame). The same on W again.
 * Now the direction is read from where the crew is driving the speed, so the stroke turns with the key, and the
 * clock simply runs the other way: nothing jumps. Run with the real rules, a frame for every rules step (60 a second).
 */
import { describe, expect, it } from 'vitest';
import { STROKE_PULL } from '../../src/look/b2/canoe.js';
import { inside, onOpenWater, play } from './paddler-frames.ts';
import type { Frame, Held } from './paddler-frames.ts';

/** The furthest a point may travel in one frame at 60 frames a second, metres. */
const STEP = { joint: 0.07, grip: 0.065, tip: 0.14 };
const FPS = 60;
const JOINTS = ['handL', 'handR', 'elbowL', 'elbowR'] as const;
const between = (time: number, from: number, to: number): boolean => time >= from && time < to;
/** W for three seconds, S for four, W again. */
const there = (time: number): Held => ({ paddle: between(time, 3, 7) ? -1 : 1 });

describe('backing', () => {
  for (const [tier, crew] of [[0, 1], [0, 2], [3, 1]] as const) {
    it(`hull tier ${tier}, ${crew === 1 ? 'alone' : 'a crew of two'}: W, then S, then W again, and nothing jumps when the stroke turns`, () => {
      const { state, view } = onOpenWater(tier, crew);
      const worst = { joint: 0, grip: 0, tip: 0 };
      const where = { joint: '', grip: '', tip: '' };
      const note = (kind: keyof typeof worst, step: number, name: string, frame: Frame): void => {
        if (step > worst[kind]) [worst[kind], where[kind]] = [step, `${name} at ${frame.time.toFixed(3)} s, stroke ${frame.phase.toFixed(2)}`];
      };
      let turns = 0;
      let astern = false;
      play(view, state, FPS, 11, there, (frame, before) => {
        if (inside(view).astern !== astern) [astern, turns] = [inside(view).astern, turns + 1];
        if (!before) return;
        for (const name of JOINTS) note('joint', frame.own[name].distanceTo(before.own[name]), name, frame);
        note('grip', frame.own.grip.distanceTo(before.own.grip), 'grip', frame);
        note('tip', frame.own.tip.distanceTo(before.own.tip), 'tip', frame);
      });
      expect(turns, 'the stroke turned to back strokes and to forward ones again').toBe(2);
      expect(worst.joint, where.joint).toBeLessThan(STEP.joint);
      expect(worst.grip, where.grip).toBeLessThan(STEP.grip);
      expect(worst.tip, where.tip).toBeLessThan(STEP.tip);
    });
  }

  it('the stroke turns with the key, not with the canoe: back strokes a quarter second after S while it still runs ahead, forward ones as soon after W', () => {
    const { state, view } = onOpenWater(0, 1);
    const seen: { time: number; astern: boolean; speed: number }[] = [];
    play(view, state, FPS, 11, there, (frame) => seen.push({ time: frame.time, astern: inside(view).astern, speed: state.canoe.speed }));
    const at = (time: number) => seen.find((entry) => entry.time >= time)!;
    expect(at(2.9).astern).toBe(false);
    expect(at(3.25).astern, 'a quarter second after S').toBe(true);
    expect(at(3.25).speed, 'the canoe still runs ahead').toBeGreaterThan(1);
    expect(at(6.9).astern).toBe(true);
    expect(at(6.9).speed, 'by now it goes astern').toBeLessThan(-1);
    expect(at(7.25).astern, 'a quarter second after W').toBe(false);
    expect(at(7.25).speed, 'the canoe still goes astern').toBeLessThan(-0.2);
    // And it stays so: no flicker while a key is held.
    for (const entry of seen) {
      if (between(entry.time, 3.25, 7)) expect(entry.astern, `at ${entry.time.toFixed(2)} s`).toBe(true);
      if (entry.time < 3 || entry.time > 7.25) expect(entry.astern, `at ${entry.time.toFixed(2)} s`).toBe(false);
    }
  });

  it('a back stroke is the stroke the other way round: the blade goes in behind the hip and is pushed toward the bow', () => {
    for (const tier of [0, 3]) {
      const { state, view } = onOpenWater(tier, 1);
      let [toStern, entries, lastWet] = [0, 0, false];
      const wentIn: number[] = [];
      play(view, state, FPS, 9, () => ({ paddle: -1 }), (frame, before) => {
        const wet = frame.hull.blade.y < 0;
        // Once the paddle is fully at work, and not while it changes sides.
        if (frame.time > 2 && frame.member.cross === 1 && before && before.member === frame.member) {
          if (wet && !lastWet) { entries += 1; wentIn.push(frame.own.blade.z); }
          if (wet && before.hull.blade.y < 0) toStern = Math.max(toStern, before.own.blade.z - frame.own.blade.z);
        }
        lastWet = wet;
      });
      expect(inside(view).astern, `tier ${tier}`).toBe(true);
      expect(entries, `tier ${tier}: back strokes`).toBeGreaterThan(3);
      for (const z of wentIn) expect(z, `tier ${tier}: where the blade goes in`).toBeLessThan(0);
      expect(toStern, `tier ${tier}: the wet blade moving toward the stern`).toBeLessThan(0.004);
    }
  });

  it('the stroke clock runs backwards astern, through the same poses, and the paddle still marks the water', () => {
    const ahead = onOpenWater(0, 1);
    const forward: number[] = [];
    const marksAhead = play(ahead.view, ahead.state, FPS, 4, () => ({ paddle: 1 }), (frame) => forward.push(frame.phase));
    const back = onOpenWater(0, 1);
    const backward: number[] = [];
    const marksAstern = play(back.view, back.state, FPS, 4, () => ({ paddle: -1 }), (frame) => backward.push(frame.phase));
    let [up, down] = [0, 0];
    for (let index = 1; index < forward.length; index += 1) {
      if ((((forward[index] - forward[index - 1]) % 1) + 1) % 1 < 0.5 && forward[index] !== forward[index - 1]) up += 1;
      if ((((backward[index - 1] - backward[index]) % 1) + 1) % 1 < 0.5 && backward[index] !== backward[index - 1]) down += 1;
    }
    expect(up).toBeGreaterThan(150);
    expect(down).toBeGreaterThan(150);
    // Three marks a stroke (the catch, the middle of the pull, the exit), either way round.
    expect(marksAhead.length).toBeGreaterThanOrEqual(6);
    expect(marksAstern.length).toBeGreaterThanOrEqual(6);
    expect(STROKE_PULL).toBeGreaterThan(0.5);
  });

  it('a canoe stopped dead with W held (run aground) shows no back stroke, and drifting back with no key turns nothing', () => {
    const { state, view } = onOpenWater(0, 1);
    let flipped = '';
    play(view, state, FPS, 8, (time) => {
      // The rules stop a grounded canoe dead on every step.
      if (between(time, 3, 5)) state.canoe.speed = 0;
      return { paddle: time < 6 ? 1 : 0 };
    }, (frame) => {
      // Past six seconds nobody paddles and something carries the canoe astern.
      if (frame.time > 6) state.canoe.speed = -0.8;
      if (inside(view).astern && !flipped) flipped = `at ${frame.time.toFixed(2)} s`;
    });
    expect(flipped).toBe('');
  });
});
