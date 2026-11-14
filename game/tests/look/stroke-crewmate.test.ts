/**
 * Luc, from the live game: "arms flailing in the air when switching sides". Since r4-rowing a change of side is the
 * paddle carried level across the bow, pointing ahead. With a crew aboard that points it at the back of whoever sits
 * ahead: it must never reach them. Read from the figures the canoe view poses, at 60 frames a second.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { afloat, film } from './paddler-frames.ts';
import type { Frame } from './paddler-frames.ts';

/** A seated figure's trunk and head as a line: from its seat to the top of its toque, through the middle of the shoulders. */
const SEAT_BELOW_SHOULDERS = 0.45;
const TOQUE_ABOVE_SHOULDERS = 0.32;
/** The least room between a carried paddle's middle line and a crewmate's: half a trunk (0.135 m) and half a blade (0.07 m). */
const CLEAR = 0.21;

/** The least distance between two segments, sampled. */
function gap(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3): number {
  let least = Infinity;
  for (let first = 0; first <= 40; first += 1) {
    const a = p1.clone().lerp(q1, first / 40);
    for (let second = 0; second <= 16; second += 1) least = Math.min(least, a.distanceTo(p2.clone().lerp(q2, second / 16)));
  }
  return least;
}

/** Twenty seconds of paddling: how many frames a paddle was being carried across, and the nearest one came to a crewmate. */
function nearest(tier: number, crew: number): { carried: number; least: number; where: string } {
  const { state, view } = afloat(tier, crew);
  // `cross` is kept beside its frame: the member is the view's own and goes on changing.
  const byTime = new Map<number, { frame: Frame; cross: number }[]>();
  film(view, state, 60, 20, (frame) => {
    const frames = byTime.get(frame.time) ?? [];
    frames.push({ frame, cross: frame.member.cross });
    byTime.set(frame.time, frames);
  });
  let [carried, least, where] = [0, Infinity, ''];
  for (const frames of byTime.values()) {
    for (const { frame, cross } of frames) {
      if (cross >= 1) continue;
      carried += 1;
      for (const { frame: other } of frames) {
        if (other === frame) continue;
        const shoulders = other.hull.shoulderL.clone().add(other.hull.shoulderR).multiplyScalar(0.5);
        const seat = shoulders.clone().setY(shoulders.y - SEAT_BELOW_SHOULDERS);
        const toque = shoulders.clone().setY(shoulders.y + TOQUE_ABOVE_SHOULDERS);
        const room = gap(frame.hull.grip, frame.hull.tip, seat, toque);
        if (room < least) [least, where] = [room, `seat ${frame.member.seat} toward seat ${other.member.seat} at ${frame.time.toFixed(2)} s`];
      }
    }
  }
  return { carried, least, where };
}

describe('a paddle carried across the bow never reaches a crewmate', () => {
  for (const tier of [0, 1, 2, 3]) {
    it(`hull tier ${tier}, a crew of two: both change sides, and each paddle stays clear of the other paddler`, () => {
      const { carried, least, where } = nearest(tier, 2);
      // Both paddlers change sides, every third stroke: the carry is on the film.
      expect(carried, 'frames with a paddle carried across').toBeGreaterThan(60);
      expect(least, where).toBeGreaterThan(CLEAR);
    });
  }

  for (const crew of [3, 4]) {
    it(`a crew of ${crew}, every hull: whoever does carry a paddle across stays clear of everyone aboard`, () => {
      for (const tier of [0, 1, 2, 3]) {
        const { least, where } = nearest(tier, crew);
        expect(least, `tier ${tier}: ${where}`).toBeGreaterThan(CLEAR);
      }
    });
  }
});
