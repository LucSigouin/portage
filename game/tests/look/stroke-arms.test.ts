/**
 * Luc, from the live game: "arms go backwards". Through the whole pull the hand on the grip sat beside the ear,
 * behind the middle of the chest, drawn back a quarter metre as the blade went back, with its arm through the neck:
 * the reverse of what a paddler's top arm does. Now it works out ahead of the chin and pushes forward and down
 * while the lower hand draws back to the hip. Read from the figures the canoe view poses, at every seat of every hull.
 */
import { describe, expect, it } from 'vitest';
import { HULL_TIERS } from '../../src/data/index.ts';
import { STROKE_PULL } from '../../src/look/b2/canoe.js';
import { crewOf } from '../../src/look/crew.ts';
import { afloat, film, frameOf, inside, membersOf } from './paddler-frames.ts';
import type { Frame } from './paddler-frames.ts';

/** One stroke of everyone aboard, every hundredth of it, at full effort. */
function strokeOf(tier: number, crew: number): Frame[] {
  const { state, view } = afloat(tier, crew);
  const frames: Frame[] = [];
  for (let step = 0; step < 100; step += 1) {
    inside(view).phase = step / 100;
    view.sync(state, crewOf(state), 0, 0, true, false);
    for (const member of membersOf(view)) frames.push(frameOf(member, 0, step / 100));
  }
  return frames;
}
/** The hand on the grip is the one across from the paddle's side; the other holds the shaft lower down. */
const top = (frame: Frame): 'R' | 'L' => (frame.member.side >= 0 ? 'R' : 'L');
const low = (frame: Frame): 'R' | 'L' => (frame.member.side >= 0 ? 'L' : 'R');
const told = (frame: Frame): string => `seat ${frame.member.seat} at stroke ${frame.phase.toFixed(2)}`;

describe('the arms paddle the way arms do', () => {
  for (let tier = 0; tier < HULL_TIERS.length; tier += 1) {
    it(`hull tier ${tier}: both hands work out ahead of the chest, never back beside the head or behind the back`, () => {
      let nearest = Infinity;
      let where = '';
      for (const frame of strokeOf(tier, 4)) {
        for (const hand of ['handL', 'handR'] as const) {
          if (frame.chest[hand].z < nearest) [nearest, where] = [frame.chest[hand].z, `${hand} ${told(frame)}`];
        }
      }
      // It was 14 cm behind the middle of the chest.
      expect(nearest, where).toBeGreaterThan(0.1);
    });

    it(`hull tier ${tier}: no forearm and no hand passes through the head`, () => {
      let least = Infinity;
      let where = '';
      for (const frame of strokeOf(tier, 4)) {
        for (const side of ['L', 'R'] as const) {
          if (frame.headGap[side] < least) [least, where] = [frame.headGap[side], `${side} arm ${told(frame)}`];
        }
      }
      // It was 6 cm inside it.
      expect(least, where).toBeGreaterThanOrEqual(0);
    });

    it(`hull tier ${tier}: the elbow of the arm on the grip bends forward, out ahead of the chest`, () => {
      let nearest = Infinity;
      let where = '';
      for (const frame of strokeOf(tier, 4)) {
        const elbow = frame.chest[`elbow${top(frame)}`];
        if (elbow.z < nearest) [nearest, where] = [elbow.z, told(frame)];
      }
      // It was 4 to 16 cm behind the middle of the chest, inside the coat.
      expect(nearest, where).toBeGreaterThan(0.12);
    });

    it(`hull tier ${tier}: through the pull the top hand pushes forward and down while the lower hand draws back, as far as the hip`, () => {
      const frames = strokeOf(tier, 4);
      for (const member of new Set(frames.map((frame) => frame.member))) {
        const pull = frames.filter((frame) => frame.member === member && frame.phase < STROKE_PULL);
        const [caught, out] = [pull[0], pull[pull.length - 1]];
        const who = `seat ${member.seat}`;
        // The top hand, against the chest it pushes away from, and in the canoe: it never comes back toward the paddler.
        expect(out.chest[`hand${top(out)}`].z - caught.chest[`hand${top(caught)}`].z, `${who}: pushed away from the chest`).toBeGreaterThan(0.08);
        for (const frame of pull) expect(frame.own.grip.z, `${who}: the grip at stroke ${frame.phase.toFixed(2)}`).toBeGreaterThan(caught.own.grip.z - 0.01);
        expect(caught.own.grip.y - out.own.grip.y, `${who}: and down`).toBeGreaterThan(0.03);
        // The lower hand goes back the whole pull, and stops level with the hip.
        const lower = pull.map((frame) => frame.own[`hand${low(frame)}`].z);
        for (let index = 1; index < lower.length; index += 1) expect(lower[index], `${who}: the lower hand at stroke ${pull[index].phase.toFixed(2)}`).toBeLessThan(lower[index - 1] + 0.001);
        expect(lower[0] - lower[lower.length - 1], `${who}: the lower hand's draw`).toBeGreaterThan(0.25);
        expect(lower[lower.length - 1], `${who}: behind the hip`).toBeGreaterThan(0);
      }
    });
  }

  it('the same holds on real frames, through changes of side: alone and with a crew of two', () => {
    for (const crew of [1, 2]) {
      const { state, view } = afloat(0, crew);
      let [ahead, clear, changing] = [Infinity, Infinity, 0];
      let where = '';
      film(view, state, 60, 14, (frame) => {
        ahead = Math.min(ahead, frame.chest.handL.z, frame.chest.handR.z);
        if (Math.min(frame.headGap.L, frame.headGap.R) < clear) [clear, where] = [Math.min(frame.headGap.L, frame.headGap.R), `seat ${frame.member.seat} at ${frame.time.toFixed(2)} s, stroke ${frame.phase.toFixed(2)}, ${(frame.member.cross * 100).toFixed(0)}% across`];
        if (frame.member.cross < 1) changing += 1;
      });
      expect(changing, `crew of ${crew}: frames changing sides`).toBeGreaterThan(50);
      expect(ahead, `crew of ${crew}: a hand back by the body`).toBeGreaterThan(0.1);
      expect(clear, `crew of ${crew}: an arm through the head, ${where}`).toBeGreaterThanOrEqual(0);
    }
  });
});
