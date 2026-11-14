/**
 * Luc's list, items 2 and 9: "canoe rowing arms go into canoe" and "the arm animation on rowing goes backwards".
 * Read from the figures the canoe view poses, with no graphics card, at every seat of every hull:
 * - the hands stay on the paddle, and the hands and forearms are never down in the canoe;
 * - nothing crosses the hull's side where it shows, between the waterline and the gunwale: not an arm, the shaft or
 *   the blade, changing sides included (below the waterline the water hides the outside and the floor the inside);
 * - the stroke pulls the canoe forward: the blade goes in ahead, moves only toward the stern while in the water,
 *   and comes out behind, then is carried forward clear of the water, quicker than it was pulled;
 * - going astern the stroke's clock runs backwards: the blade goes in behind and is pushed toward the bow.
 *
 * All of it for each of the cast (`look/cast.ts`): four of one person in the four seats, and one of each.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HULL_TIERS } from '../../src/data/index.ts';
import { createGame } from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import { makeHullShape } from '../../src/look/b2/canoe.js';
import type { Crew as Figure } from '../../src/look/b2/canoe.js';
import { CanoeView } from '../../src/look/canoe.ts';
import { crewOf } from '../../src/look/crew.ts';
import { ALONE, MIXED, SAME, castAs } from './cast-lineups.ts';
import type { Lineup } from './cast-lineups.ts';

const BLADE = 1.19;
const TIP = 1.485;

interface Member { figure: Figure; seat: number }
const membersOf = (view: CanoeView): Map<number, Member> => (view as unknown as { members: Map<number, Member> }).members;
const setPhase = (view: CanoeView, phase: number): void => { (view as unknown as { phase: number }).phase = phase; };

function crewPaddling(lineup: Lineup, tier: number, crew = 4, astern = false, decks = false): { state: GameState; view: CanoeView } {
  const state = castAs(createGame(7, { crew }), lineup);
  state.canoe.hullTier = tier;
  if (astern) state.canoe.speed = -1;
  if (decks) state.canoe.attachments.push('outrigger_port', 'outrigger_starboard');
  for (const player of state.players) player.paddling = true;
  const view = new CanoeView();
  view.sync(state, crewOf(state), 0, 0, true, true);
  return { state, view };
}

/** Where each paddler's hands, arms and paddle are, in the hull's own space (waterline at y = 0, bow toward +z). */
function poseOf(member: Member) {
  const { L, R, paddle } = member.figure.paddler;
  const toHull = member.figure.root.matrix;
  const axis = new THREE.Vector3(0, -1, 0).applyQuaternion(paddle.quaternion);
  const inHull = (point: THREE.Vector3): THREE.Vector3 => point.clone().applyMatrix4(toHull);
  const down = (along: number): THREE.Vector3 => inHull(paddle.position.clone().addScaledVector(axis, along));
  /** How far a hand is from the paddle's shaft line. */
  const offShaft = (hand: THREE.Vector3): number => {
    const relative = hand.clone().sub(paddle.position);
    return relative.addScaledVector(axis, -relative.dot(axis)).length();
  };
  return { L, R, axis, inHull, down, offShaft };
}

/** Every frame of a phase sweep (one stroke in 100 steps), then 15 s of real frames, so the paddles change sides. */
function everyFrame(view: CanoeView, state: GameState, each: (member: Member, phase: number) => void): void {
  for (let step = 0; step < 100; step += 1) {
    setPhase(view, step / 100);
    view.sync(state, crewOf(state), 0, 0, true, false);
    for (const member of membersOf(view).values()) each(member, step / 100);
  }
  for (let frame = 0; frame < 60 * 15; frame += 1) {
    view.sync(state, crewOf(state), 1 / 60, frame / 60, true, false);
    for (const member of membersOf(view).values()) each(member, (view as unknown as { phase: number }).phase);
  }
}

/** The hull as drawn: inside it is within the planking and under the gunwale. */
function hullOf(tier: number) {
  const { dimensions } = HULL_TIERS[tier];
  const shape = makeHullShape(dimensions);
  const gunwale = (z: number): number => shape.sheerAt(z) - dimensions.draft;
  /** Positive: outboard or above the gunwale by that much, past a radius. Negative: down in the canoe. */
  const clearance = (point: THREE.Vector3, radius: number): number =>
    Math.max(Math.abs(point.x) - shape.halfBeamAt(point.z), point.y - gunwale(point.z)) - radius;
  /** Where a run of points passes through the hull's side above the waterline: how far over the gunwale (negative: under it). */
  const crossing = (points: THREE.Vector3[], radius: number): number => {
    let margin = Infinity;
    for (let index = 1; index < points.length; index += 1) {
      const [from, to] = [points[index - 1], points[index]];
      const outFrom = Math.abs(from.x) - shape.halfBeamAt(from.z);
      const outTo = Math.abs(to.x) - shape.halfBeamAt(to.z);
      if (Math.sign(outFrom) === Math.sign(outTo)) continue;
      const at = from.clone().lerp(to, outFrom / (outFrom - outTo));
      if (at.y + radius < 0) continue;
      margin = Math.min(margin, at.y - gunwale(at.z) - radius);
    }
    return margin;
  };
  return { clearance, crossing };
}

const run = (from: THREE.Vector3, to: THREE.Vector3, steps: number): THREE.Vector3[] =>
  Array.from({ length: steps + 1 }, (_, step) => from.clone().lerp(to, step / steps));

// Each of the four in every seat, and one of each side by side.
for (const lineup of [...SAME, MIXED[0]]) {
describe(`${lineup.name}: the paddler\'s hands and arms`, () => {
  for (let tier = 0; tier < HULL_TIERS.length; tier += 1) {
    it(`stay on the paddle, and out of the canoe, at every seat of hull tier ${tier}: paddling and changing sides`, () => {
      const { state, view } = crewPaddling(lineup, tier);
      const hull = hullOf(tier);
      let offShaft = 0;
      let lowest = Infinity;
      let where = '';
      everyFrame(view, state, (member, phase) => {
        const pose = poseOf(member);
        for (const [name, side] of [['left', pose.L], ['right', pose.R]] as const) {
          offShaft = Math.max(offShaft, pose.offShaft(side.H));
          // The hand, and the forearm from its middle to the wrist.
          for (const [part, point, radius] of [['hand', side.H, 0.062], ['forearm', side.E.clone().lerp(side.H, 0.5), 0.05], ['wrist', side.E.clone().lerp(side.H, 0.8), 0.05]] as const) {
            const clear = hull.clearance(pose.inHull(point), radius);
            if (clear < lowest) [lowest, where] = [clear, `seat ${member.seat} ${name} ${part} at phase ${phase.toFixed(2)}`];
          }
        }
      });
      expect(offShaft, 'a hand off the shaft').toBeLessThan(0.01);
      expect(lowest, where).toBeGreaterThanOrEqual(0);
    });
  }
});

describe(`${lineup.name}: nothing crosses the hull\'s side where it shows`, () => {
  for (let tier = 0; tier < HULL_TIERS.length; tier += 1) {
    it(`on hull tier ${tier}: no arm, shaft or blade passes through it between the waterline and the gunwale`, () => {
      const { state, view } = crewPaddling(lineup, tier);
      const hull = hullOf(tier);
      let lowest = Infinity;
      let where = '';
      everyFrame(view, state, (member, phase) => {
        const pose = poseOf(member);
        const runs: [string, THREE.Vector3[], number][] = [
          ['shaft', run(pose.down(0), pose.down(0.9), 30), 0.018],
          ['blade', run(pose.down(0.9), pose.down(TIP), 12), 0.03],
        ];
        for (const side of [pose.L, pose.R]) {
          runs.push(['upper arm', run(pose.inHull(side.S), pose.inHull(side.E), 12), 0.058]);
          runs.push(['forearm', run(pose.inHull(side.E), pose.inHull(side.H), 12), 0.05]);
        }
        for (const [part, points, radius] of runs) {
          const margin = hull.crossing(points, radius);
          if (margin < lowest) [lowest, where] = [margin, `seat ${member.seat} ${part} at phase ${phase.toFixed(2)}`];
        }
      });
      expect(lowest, where).toBeGreaterThanOrEqual(0);
    });
  }

  it('with both outriggers fitted, the kneelers in the narrow well come within a centimetre and a half, and the rest are clear', () => {
    // A kneeler between deck and hull has 24 cm of well on the long hull. Below the gunwale by up to 1.5 cm is what
    // the drawing cannot avoid there (it was 13 cm before the stroke was redrawn); the bow and stern paddlers stay clear.
    for (const tier of [2, 3]) {
      const { state, view } = crewPaddling(lineup, tier, 4, false, true);
      const hull = hullOf(tier);
      const lowest = { kneelers: Infinity, others: Infinity };
      let offShaft = 0;
      everyFrame(view, state, (member) => {
        const pose = poseOf(member);
        offShaft = Math.max(offShaft, pose.offShaft(pose.L.H), pose.offShaft(pose.R.H));
        const margin = Math.min(hull.crossing(run(pose.down(0), pose.down(0.9), 30), 0.018), hull.crossing(run(pose.down(0.9), pose.down(TIP), 12), 0.03),
          ...[pose.L, pose.R].map((side) => hull.crossing(run(pose.inHull(side.E), pose.inHull(side.H), 12), 0.05)));
        const group = member.seat >= 2 ? 'kneelers' : 'others';
        lowest[group] = Math.min(lowest[group], margin);
      });
      expect(lowest.others, `tier ${tier}`).toBeGreaterThanOrEqual(0);
      expect(lowest.kneelers, `tier ${tier}`).toBeGreaterThan(-0.015);
      // Starting to change sides there, a hand can be up to 3.5 cm short of the shaft for a frame or two.
      expect(offShaft, `tier ${tier}`).toBeLessThan(0.035);
    }
  });
});
}

// The stroke is drawn for the voyageur's shoulders. A hand its arm cannot reach rides up the shaft toward the grip
// (`pose` in b2/canoe.js): only as far as it must, so that arm is at full stretch, and never past 3 cm.
describe('each of the cast holds the paddle where the voyageur holds it, unless an arm is too short to', () => {
  /** An arm at full stretch, shoulder to hand (upper arm 0.28, forearm 0.27, 2 mm short of dead straight). */
  const STRETCHED = 0.548;
  /** Each hand, left then right: how far down the shaft from the grip it is, and how far it is from its shoulder. */
  const holds = (member: Member): { along: number; arm: number }[] => {
    const { L, R, paddle } = member.figure.paddler;
    const axis = new THREE.Vector3(0, -1, 0).applyQuaternion(paddle.quaternion);
    return [L, R].map((side) => ({ along: side.H.clone().sub(paddle.position).dot(axis), arm: side.S.distanceTo(side.H) }));
  };
  for (const lineup of SAME.filter((same) => same.cast[0] !== 'voyageur')) {
    it(`${lineup.name}: a hand is higher up the shaft than the voyageur's only with its arm at full stretch, and by 3 cm at the most, in any seat of any hull`, () => {
      let apart = 0;
      let where = '';
      let slack = 0;
      let slackWhere = '';
      let rides = 0;
      for (let tier = 0; tier < HULL_TIERS.length; tier += 1) {
        const theirs = crewPaddling(lineup, tier);
        const voyageurs = crewPaddling({ name: 'four voyageurs', cast: ['voyageur'] }, tier);
        const compare = (phase: number): void => {
          for (const [id, member] of membersOf(theirs.view)) {
            const [mine, same] = [holds(member), holds(membersOf(voyageurs.view).get(id) as Member)];
            for (const hand of [0, 1]) {
              const at = `hull ${tier}, seat ${member.seat}, ${hand ? 'right' : 'left'} hand at phase ${phase.toFixed(2)}`;
              const off = Math.abs(mine[hand].along - same[hand].along);
              if (off > apart) [apart, where] = [off, at];
              if (off < 0.001) continue;
              rides += 1;
              // Whoever holds higher (nearer the grip) does so because that arm reaches no further.
              const higher = mine[hand].along < same[hand].along ? mine[hand] : same[hand];
              if (STRETCHED - higher.arm > slack) [slack, slackWhere] = [STRETCHED - higher.arm, at];
            }
          }
        };
        for (let step = 0; step < 100; step += 1) {
          for (const crew of [theirs, voyageurs]) {
            setPhase(crew.view, step / 100);
            crew.view.sync(crew.state, crewOf(crew.state), 0, 0, true, false);
          }
          compare(step / 100);
        }
        for (let frame = 0; frame < 60 * 15; frame += 1) {
          for (const crew of [theirs, voyageurs]) crew.view.sync(crew.state, crewOf(crew.state), 1 / 60, frame / 60, true, false);
          compare((theirs.view as unknown as { phase: number }).phase);
        }
      }
      console.log(`STROKE hold: ${lineup.name} hold the shaft within ${(apart * 1000).toFixed(1)} mm of the voyageurs (${where}), ${rides} hand-frames apart, the higher arm ${(slack * 1000).toFixed(2)} mm short of full stretch at the most`);
      expect(apart, where).toBeLessThan(0.03);
      expect(slack, `an arm that rode up with reach to spare: ${slackWhere}`).toBeLessThan(0.0005);
      // The rule is at work here: a kneeler's lower hand, as the blade swings forward.
      expect(rides).toBeGreaterThan(0);
    });
  }
});

for (const lineup of ALONE) {
describe(`${lineup.name}: the stroke pulls the canoe forward`, () => {
  /** One stroke of the stern paddler: the blade's middle and its tip, in the hull's own space, every hundredth. */
  function strokeOf(tier: number, astern: boolean): { blade: THREE.Vector3; tip: THREE.Vector3 }[] {
    const { state, view } = crewPaddling(lineup, tier, 1, astern);
    const member = [...membersOf(view).values()][0];
    const frames: { blade: THREE.Vector3; tip: THREE.Vector3 }[] = [];
    for (let step = 0; step < 100; step += 1) {
      setPhase(view, step / 100);
      view.sync(state, crewOf(state), 0, 0, true, false);
      const pose = poseOf(member);
      frames.push({ blade: pose.down(BLADE), tip: pose.down(TIP) });
    }
    return frames;
  }

  for (let tier = 0; tier < HULL_TIERS.length; tier += 1) {
    it(`on hull tier ${tier}: in the water the blade only moves toward the stern, from ahead of the paddler to behind`, () => {
      const frames = strokeOf(tier, false);
      const wet = frames.map((frame, index) => ({ ...frame, index })).filter((frame) => frame.blade.y < 0);
      let forward = 0;
      for (let index = 1; index < frames.length; index += 1) {
        if (frames[index].blade.y < 0 && frames[index - 1].blade.y < 0) forward = Math.max(forward, frames[index].blade.z - frames[index - 1].blade.z);
      }
      // Bow is +z in the hull's space: toward the stern is -z.
      expect(forward).toBeLessThan(0.005);
      const zs = wet.map((frame) => frame.blade.z);
      expect(Math.max(...zs) - Math.min(...zs), 'the length of the pull').toBeGreaterThan(0.7);
    });
  }

  it('the blade is pulled through the water for most of the stroke, and carried forward clear of it, quicker', () => {
    for (let tier = 0; tier < HULL_TIERS.length; tier += 1) {
      const frames = strokeOf(tier, false);
      const wet = frames.filter((frame) => frame.blade.y < 0).length / frames.length;
      const clear = frames.filter((frame) => frame.tip.y > 0).length / frames.length;
      expect(wet, `tier ${tier}`).toBeGreaterThan(0.6);
      expect(clear, `tier ${tier}`).toBeGreaterThan(0.12);
    }
  });

  it('going astern the stroke runs the other way round: the clock counts down and the wet blade is pushed toward the bow', () => {
    // The key's own turn (S while the canoe still runs ahead) is tested with the real rules in stroke-astern.test.ts.
    for (let tier = 0; tier < HULL_TIERS.length; tier += 1) {
      const { state, view } = crewPaddling(lineup, tier, 1, true);
      const member = [...membersOf(view).values()][0];
      const phaseOf = (): number => (view as unknown as { phase: number }).phase;
      let [toStern, down, wetFrames] = [0, 0, 0];
      let before: THREE.Vector3 | null = null;
      let last = phaseOf();
      for (let frame = 1; frame <= 240; frame += 1) {
        view.sync(state, crewOf(state), 1 / 60, frame / 60, true, false);
        const blade = poseOf(member).down(BLADE);
        if (before && blade.y < 0 && before.y < 0) {
          wetFrames += 1;
          toStern = Math.max(toStern, before.z - blade.z);
        }
        if ((((last - phaseOf()) % 1) + 1) % 1 < 0.5 && last !== phaseOf()) down += 1;
        [before, last] = [blade, phaseOf()];
      }
      // Of 240 frames: the clock waits 0.9 s while the paddle changes sides.
      expect(down, `tier ${tier}: frames the clock ran backwards`).toBeGreaterThan(150);
      expect(wetFrames, `tier ${tier}`).toBeGreaterThan(60);
      expect(toStern, `tier ${tier}`).toBeLessThan(0.005);
    }
  });

  it('a game handed over with the canoe going astern shows back strokes from its first frame, and one going ahead does not', () => {
    const astern = (view: CanoeView): boolean => (view as unknown as { astern: boolean }).astern;
    expect(astern(crewPaddling(lineup, 0, 1).view)).toBe(false);
    expect(astern(crewPaddling(lineup, 0, 1, true).view)).toBe(true);
  });
});
}
