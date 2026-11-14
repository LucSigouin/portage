/**
 * Luc, from the live game: "arms flailing in the air when switching sides". The change of side was a paddle thrown
 * straight up over the head inside two frames, held there, and still in the air at the next catch.
 * Now it is carried across the bow, low: read from the figures the canoe view poses, at 120 frames a second.
 */
import { describe, expect, it } from 'vitest';
import { afloat, film, hullOf, inside, membersOf } from './paddler-frames.ts';
import type { Frame } from './paddler-frames.ts';

/** The chin of a seated figure, above its seat: nothing of a paddle or a hand belongs higher in a change of sides. */
const CHIN = 0.74;
/** The furthest a point may travel in one frame at 120 frames a second, metres: a hand or an elbow, the grip, the paddle's tip. */
const STEP = { joint: 0.05, grip: 0.035, tip: 0.08 };
const JOINTS = ['handL', 'handR', 'elbowL', 'elbowR'] as const;

/** Every frame of a run, and the runs of frames in which a paddle is being carried across. */
function watch(tier: number, crew: number, fps = 120, seconds = 14, attachments: string[] = [], drive?: (time: number, state: ReturnType<typeof afloat>['state']) => void) {
  const { state, view } = afloat(tier, crew, attachments);
  const frames: { frame: Frame; before: Frame | null; cross: number; side: number }[] = [];
  film(view, state, fps, seconds, (frame, before) => frames.push({ frame, before, cross: frame.member.cross, side: frame.member.side }), drive && ((time) => drive(time, state)));
  const changes = frames.filter((entry, index) => entry.cross < 1 && frames.slice(0, index).reverse().find((earlier) => earlier.frame.member === entry.frame.member)?.cross === 1).length;
  return { state, view, frames, changes };
}

describe('a change of sides is the paddle carried low across the bow', () => {
  for (const [tier, crew] of [[0, 1], [1, 1], [2, 1], [3, 1], [0, 2], [3, 2]] as const) {
    const who = `hull tier ${tier}, ${crew === 1 ? 'alone' : 'a crew of two'}`;

    it(`${who}: the paddler changes sides, and no hand and no part of the paddle goes above the chin`, () => {
      const { frames, changes } = watch(tier, crew);
      expect(changes, 'changes of side in 14 s').toBeGreaterThanOrEqual(2 * crew);
      let highest = -Infinity;
      let where = '';
      for (const { frame, cross } of frames.filter((entry) => entry.cross < 1)) {
        for (const name of ['handL', 'handR', 'grip', 'blade', 'tip'] as const) {
          if (frame.own[name].y > highest) [highest, where] = [frame.own[name].y, `${name} at ${frame.time.toFixed(2)} s, ${(cross * 100).toFixed(0)}% across`];
        }
      }
      expect(highest, where).toBeLessThan(CHIN);
    });

    it(`${who}: half way across the paddle lies level, pointing ahead, with both hands at the lap`, () => {
      const { frames } = watch(tier, crew);
      const middle = frames.filter((entry) => entry.cross > 0.47 && entry.cross < 0.53);
      expect(middle.length).toBeGreaterThan(0);
      for (const { frame } of middle) {
        expect(frame.axis.z, 'pointing ahead').toBeGreaterThan(0.98);
        expect(Math.abs(frame.axis.y), 'level').toBeLessThan(0.08);
        for (const name of ['handL', 'handR'] as const) {
          expect(frame.own[name].y, `${name} height`).toBeLessThan(frame.member.carry + 0.14);
          expect(Math.abs(frame.own[name].x), `${name} off the middle`).toBeLessThan(0.12);
          expect(frame.own[name].z, `${name} ahead`).toBeLessThan(0.75);
        }
      }
    });

    it(`${who}: nothing moves further in one frame than a body can, across every stroke and change`, () => {
      const { frames } = watch(tier, crew);
      const worst = { joint: 0, grip: 0, tip: 0 };
      const where = { joint: '', grip: '', tip: '' };
      const note = (kind: keyof typeof worst, step: number, name: string, frame: Frame): void => {
        if (step > worst[kind]) [worst[kind], where[kind]] = [step, `${name} at ${frame.time.toFixed(3)} s, stroke ${frame.phase.toFixed(2)}, ${(frame.member.cross * 100).toFixed(0)}% across`];
      };
      for (const { frame, before } of frames) {
        if (!before) continue;
        for (const name of JOINTS) note('joint', frame.own[name].distanceTo(before.own[name]), name, frame);
        note('grip', frame.own.grip.distanceTo(before.own.grip), 'grip', frame);
        note('tip', frame.own.tip.distanceTo(before.own.tip), 'tip', frame);
      }
      expect(worst.joint, where.joint).toBeLessThan(STEP.joint);
      expect(worst.grip, where.grip).toBeLessThan(STEP.grip);
      expect(worst.tip, where.tip).toBeLessThan(STEP.tip);
    });

    it(`${who}: carried across, the paddle clears the gunwales and the paddler, and the hands keep hold`, () => {
      const { frames } = watch(tier, crew);
      const hull = hullOf(tier);
      let [overGunwale, fromBody, offShaft, mitts] = [Infinity, Infinity, 0, Infinity];
      let where = '';
      for (const { frame, cross } of frames.filter((entry) => entry.cross < 1)) {
        const margin = Math.min(hull.crossing(frame.hull.grip, frame.hull.blade, 0.018), hull.crossing(frame.hull.blade, frame.hull.tip, 0.03),
          hull.crossing(frame.hull.elbowL, frame.hull.handL, 0.05), hull.crossing(frame.hull.elbowR, frame.hull.handR, 0.05));
        if (margin < overGunwale) [overGunwale, where] = [margin, `${frame.time.toFixed(2)} s, ${(cross * 100).toFixed(0)}% across`];
        fromBody = Math.min(fromBody, frame.bodyGap);
        // The hands pass each other on the shaft, one on each side of it: a mitt's own width from its middle line at most.
        for (const hand of ['handL', 'handR'] as const) {
          const relative = frame.own[hand].clone().sub(frame.own.grip);
          offShaft = Math.max(offShaft, relative.addScaledVector(frame.axis, -relative.dot(frame.axis)).length());
        }
        mitts = Math.min(mitts, frame.own.handL.distanceTo(frame.own.handR));
      }
      expect(overGunwale, where).toBeGreaterThanOrEqual(0);
      expect(fromBody, 'the paddle through the paddler').toBeGreaterThan(0.17);
      expect(offShaft, 'a hand off the shaft').toBeLessThan(0.062);
      expect(mitts, 'one mitt through the other').toBeGreaterThan(0.085);
    });

    it(`${who}: the blade is back in the water at the first catch after a change`, () => {
      const { frames } = watch(tier, crew);
      let catches = 0;
      frames.forEach(({ frame, cross }, index) => {
        if (cross < 1) return;
        const earlier = frames.slice(Math.max(0, index - 300), index).filter((entry) => entry.frame.member === frame.member);
        const justChanged = earlier.some((entry) => entry.cross < 1);
        if (justChanged && frame.phase > 0.04 && frame.phase < 0.1) {
          catches += 1;
          expect(frame.hull.blade.y, `blade at ${frame.time.toFixed(2)} s, stroke ${frame.phase.toFixed(2)}`).toBeLessThan(0);
        }
      });
      expect(catches).toBeGreaterThan(0);
    });
  }

  it('takes the same time at 30, 60 and 144 frames a second, and the stroke waits for it', () => {
    const spans = [30, 60, 144].map((fps) => {
      const { frames } = watch(0, 1, fps, 8);
      const crossing = frames.filter((entry) => entry.cross < 1);
      const first = crossing[0].frame.time;
      const run = crossing.filter((entry) => entry.frame.time < first + 2);
      // The stroke clock stands still while the paddle is carried across.
      for (const entry of run) expect(entry.frame.phase, `${fps} fps`).toBeCloseTo(run[0].frame.phase, 6);
      return (run.length + 1) / fps;
    });
    for (const span of spans) expect(Math.abs(span - spans[1])).toBeLessThan(2 / 30);
    expect(spans[1]).toBeGreaterThan(0.6);
  });

  it('called back half way (the canoe turns the other way), the paddle comes back the way it went, with no jump', () => {
    // Turning sets the side at once and the paddler follows at the next recovery. Half way across, the canoe turns back.
    const { state, view } = afloat(0, 1);
    let turning = -0.5;
    let calledBack = false;
    let reversals = 0;
    let last = 1;
    let side = membersOf(view)[0].side;
    film(view, state, 120, 12, (frame, before) => {
      const { cross } = frame.member;
      if (cross < 1 && cross > 0.45 && !calledBack) {
        turning = -turning;
        calledBack = true;
      }
      // Turned back: the side it is going to changes while it is still on its way.
      if (frame.member.side !== side && last < 1) reversals += 1;
      [last, side] = [cross, frame.member.side];
      if (!before) return;
      for (const name of JOINTS) expect(frame.own[name].distanceTo(before.own[name]), `${name} at ${frame.time.toFixed(3)} s`).toBeLessThan(STEP.joint);
      expect(frame.own.tip.distanceTo(before.own.tip), `tip at ${frame.time.toFixed(3)} s`).toBeLessThan(STEP.tip);
    }, () => { state.canoe.heading += turning / 120; });
    expect(calledBack).toBe(true);
    expect(reversals, 'the change turned back').toBe(1);
  });
});

describe('short of room to carry a paddle across, the crew keeps its sides', () => {
  for (const crew of [3, 4]) {
    it(`a crew of ${crew} sits too close: nobody changes sides, going straight or turning, and neighbours paddle on opposite sides`, () => {
      for (const tier of [0, 3]) {
        const { state, view } = afloat(tier, crew);
        const first = new Map(membersOf(view).map((member) => [member, member.side]));
        film(view, state, 60, 15, (frame) => {
          expect(frame.member.side, `tier ${tier} seat ${frame.member.seat} at ${frame.time.toFixed(2)} s`).toBe(first.get(frame.member));
          expect(frame.member.cross).toBe(1);
        }, (time) => { state.canoe.heading += (time < 7 ? 0.5 : -0.5) / 60; });
        const alongHull = membersOf(view).sort((one, other) => one.figure.root.position.z - other.figure.root.position.z).map((member) => member.side);
        for (let index = 1; index < alongHull.length; index += 1) expect(alongHull[index]).toBe(-alongHull[index - 1]);
      }
    });
  }

  it('a mast, a canopy or a forge standing ahead of a lone paddler: they keep their side', () => {
    for (const fitting of ['mast_sail', 'canopy', 'forge']) {
      const { state, view } = afloat(3, 1, [fitting]);
      film(view, state, 60, 12, (frame) => expect(frame.member.cross, fitting).toBe(1));
      expect(inside(view).strokes, fitting).toBeGreaterThan(6);
    }
  });

  it('over a low chest the paddle is carried higher, clear of it, and still below the chin', () => {
    const { state, view } = afloat(0, 1, ['sea_chest']);
    let carried = 0;
    film(view, state, 60, 12, (frame) => {
      if (frame.member.cross < 1) carried = Math.max(carried, frame.member.carry);
    });
    expect(carried).toBeGreaterThan(0.44);
    expect(carried).toBeLessThanOrEqual(0.6);
  });
});
