/**
 * Starting and stopping, from Luc's note "the rowing animation is really buggy". On every press and release the
 * two hands swapped places in one frame (21 and 37 cm), the resting paddle always lay blade to the left, so a paddle
 * working on the right swung through the hull on its way down, and a crewmate rested with crossed arms.
 * Now the hands slide to their hold, the paddle rests on the side it works on and is lifted over the gunwale, the
 * first stroke from rest reaches forward before it pulls, and a quick press again goes on where the stroke was.
 * Run with the real rules and the keys' own inputs, a frame for every rules step (60 a second).
 */
import { describe, expect, it } from 'vitest';
import { hullOf, inside, membersOf, onOpenWater, play } from './paddler-frames.ts';
import type { Frame, Held } from './paddler-frames.ts';

/** The furthest a point may travel in one frame at 60 frames a second, metres: a hand or an elbow, the grip, the paddle's tip. */
const STEP = { joint: 0.07, grip: 0.065, tip: 0.14 };
const FPS = 60;
const JOINTS = ['handL', 'handR', 'elbowL', 'elbowR'] as const;
const W: Held = { paddle: 1 };
const between = (time: number, from: number, to: number): boolean => time >= from && time < to;
/** Press, release, press again mid-stroke, release, tap fast, hold through a change of side, release. */
const fidget = (time: number): Held =>
  (between(time, 0.5, 2) || between(time, 2.3, 4) || (between(time, 5, 7) && Math.floor(time / 0.12) % 2 === 0) || between(time, 7.5, 13) ? W : {});

describe('laying the paddle down and taking it up', () => {
  for (const [tier, crew] of [[0, 1], [0, 2], [3, 1], [3, 4]] as const) {
    const who = `hull tier ${tier}, ${crew === 1 ? 'alone' : `a crew of ${crew}`}`;

    it(`${who}: pressing, releasing, pressing again mid-stroke and tapping fast, no hand, elbow or paddle jumps`, () => {
      const { state, view } = onOpenWater(tier, crew);
      const worst = { joint: 0, grip: 0, tip: 0 };
      const where = { joint: '', grip: '', tip: '' };
      const note = (kind: keyof typeof worst, step: number, name: string, frame: Frame): void => {
        if (step > worst[kind]) [worst[kind], where[kind]] = [step, `${name} of seat ${frame.member.seat} at ${frame.time.toFixed(3)} s, effort ${frame.member.effort.toFixed(2)}, stroke ${frame.phase.toFixed(2)}`];
      };
      play(view, state, FPS, 15, fidget, (frame, before) => {
        if (!before) return;
        for (const name of JOINTS) note('joint', frame.own[name].distanceTo(before.own[name]), name, frame);
        note('grip', frame.own.grip.distanceTo(before.own.grip), 'grip', frame);
        note('tip', frame.own.tip.distanceTo(before.own.tip), 'tip', frame);
      });
      expect(worst.joint, where.joint).toBeLessThan(STEP.joint);
      expect(worst.grip, where.grip).toBeLessThan(STEP.grip);
      expect(worst.tip, where.tip).toBeLessThan(STEP.tip);
    });

    it(`${who}: the paddle goes down and comes up over the gunwale, never through the hull's side, and the hands keep hold`, () => {
      const { state, view } = onOpenWater(tier, crew);
      const hull = hullOf(tier);
      let [over, offShaft] = [Infinity, 0];
      let where = '';
      play(view, state, FPS, 15, fidget, (frame) => {
        if (frame.member.effort >= 0.999) return;
        const margin = Math.min(hull.crossing(frame.hull.grip, frame.hull.blade, 0.018), hull.crossing(frame.hull.blade, frame.hull.tip, 0.03));
        if (margin < over) [over, where] = [margin, `seat ${frame.member.seat} at ${frame.time.toFixed(3)} s, effort ${frame.member.effort.toFixed(2)}, stroke ${frame.phase.toFixed(2)}`];
        for (const hand of ['handL', 'handR'] as const) {
          const relative = frame.own[hand].clone().sub(frame.own.grip);
          offShaft = Math.max(offShaft, relative.addScaledVector(frame.axis, -relative.dot(frame.axis)).length());
        }
      });
      expect(over, where).toBeGreaterThanOrEqual(0);
      // Changing sides, the hands pass each other one on each side of the shaft: a mitt's width from its middle at most.
      expect(offShaft, 'a hand off the shaft').toBeLessThan(0.062);
    });
  }

  for (const crew of [1, 2, 4]) {
    it(`a crew of ${crew} at rest: each holds the paddle with arms uncrossed, its blade out on the side it works on, before the first stroke and after the last`, () => {
      const { state, view } = onOpenWater(crew === 4 ? 3 : 0, crew);
      const atRest = (when: string): void => {
        const sides: number[] = [];
        play(view, state, 60, 0.1, () => ({}), (frame) => {
          const told = `${when}, seat ${frame.member.seat}`;
          expect(frame.member.effort, told).toBe(0);
          expect(frame.own.handL.x, `${told}: the left hand`).toBeGreaterThan(0.1);
          expect(frame.own.handR.x, `${told}: the right hand`).toBeLessThan(-0.1);
          expect(frame.own.blade.x * frame.member.side, `${told}: the blade`).toBeGreaterThan(0.5);
          expect(Math.abs(frame.own.blade.y - frame.own.grip.y), `${told}: lying level`).toBeLessThan(0.05);
          if (frame.time < 0.03) sides[frame.member.figure.root.position.z] = frame.member.side;
        });
        // Along the hull, neighbours rest their blades on opposite sides.
        const alongHull = membersOf(view).sort((one, other) => one.figure.root.position.z - other.figure.root.position.z).map((member) => member.side);
        for (let index = 1; index < alongHull.length; index += 1) expect(alongHull[index], when).toBe(-alongHull[index - 1]);
      };
      atRest('before the first stroke');
      // Long enough to change sides where there is room, then down again.
      play(view, state, 60, 7, () => W, () => {});
      play(view, state, 60, 3, () => ({}), () => {});
      atRest('after the last');
    });
  }

  it('with no key held the paddler is still: not a hair moves once the paddle is down', () => {
    const { state, view } = onOpenWater(0, 1);
    let moved = 0;
    let frames = 0;
    play(view, state, FPS, 6, (time) => (time < 2.2 ? W : {}), (frame, before) => {
      if (frame.time < 4 || !before) return;
      frames += 1;
      for (const name of [...JOINTS, 'grip', 'blade', 'tip', 'shoulderL', 'shoulderR'] as const) moved = Math.max(moved, frame.own[name].distanceTo(before.own[name]));
      expect(frame.member.effort).toBe(0);
    });
    expect(frames).toBeGreaterThan(100);
    expect(moved).toBe(0);
  });

  it('from rest the first stroke reaches forward before it pulls: the blade first goes in ahead of the knees', () => {
    for (const tier of [0, 3]) {
      const { state, view } = onOpenWater(tier, 1);
      let firstWet: Frame | null = null;
      let pressed = 0;
      play(view, state, FPS, 3, (time) => { if (time >= 1 && !pressed) pressed = time; return time >= 1 ? W : {}; }, (frame) => {
        if (!firstWet && frame.hull.blade.y < 0) firstWet = frame;
      });
      expect(firstWet, `tier ${tier}`).not.toBeNull();
      const wet = firstWet as unknown as Frame;
      expect(wet.own.blade.z, `tier ${tier}: where the blade first goes in, ahead of the paddler`).toBeGreaterThan(0.5);
      expect(wet.time - pressed, `tier ${tier}: how long after the press`).toBeLessThan(0.8);
    }
  });

  it('a quick release and press goes on with the stroke where it was: the clock is never set back', () => {
    const { state, view } = onOpenWater(0, 1);
    let last = -1;
    let furthest = 0;
    let where = '';
    play(view, state, FPS, 9, (time) => (between(time, 0.2, 3) || between(time, 3.25, 5) || (between(time, 5, 7) && Math.floor(time / 0.15) % 2 === 0) || time >= 7 ? W : {}), (frame) => {
      if (last >= 0 && frame.time > 0.5 && frame.member.cross === 1) {
        const moved = Math.abs(((frame.phase - last + 1.5) % 1) - 0.5);
        if (moved > furthest) [furthest, where] = [moved, `at ${frame.time.toFixed(3)} s`];
      }
      last = frame.phase;
    });
    // 0.78 strokes a second at 60 frames a second is 0.013 a frame.
    expect(furthest, where).toBeLessThan(0.0135);
    expect(inside(view).strokes).toBeGreaterThan(4);
  });
});
