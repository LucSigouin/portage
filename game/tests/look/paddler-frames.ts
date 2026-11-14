/**
 * The paddlers as the canoe view poses them, read frame by frame with no graphics card: where each hand, elbow and
 * shoulder is, the paddle's grip, blade and tip, in the figure's own space and in the hull's (waterline at y = 0, bow
 * toward +z). For the tests of Luc's note from the live game: "the rowing animation is really buggy".
 */
import * as THREE from 'three';
import { HULL_TIERS } from '../../src/data/index.ts';
import { NEUTRAL_INPUT, addPlayer, createGame, step } from '../../src/sim/index.ts';
import type { GameState, StepInput } from '../../src/sim/index.ts';
import { makeHullShape } from '../../src/look/b2/canoe.js';
import type { Crew as Figure } from '../../src/look/b2/canoe.js';
import { CanoeView } from '../../src/look/canoe.ts';
import { crewOf } from '../../src/look/crew.ts';

/** The blade's middle and the paddle's tip, down the shaft from the grip. */
export const BLADE = 1.19;
export const TIP = 1.485;

export interface Member { figure: Figure; seat: number | null; side: number; cross: number; carry: number; effort: number }
interface Inside { members: Map<number, Member>; phase: number; side: number; strokes: number; astern: boolean }
export const inside = (view: CanoeView): Inside => view as unknown as Inside;
export const membersOf = (view: CanoeView): Member[] => [...inside(view).members.values()].filter((member) => member.seat !== null);

/** A canoe on the water with `crew` aboard, everyone paddling at full effort from the first frame. */
export function afloat(tier: number, crew = 1, attachments: string[] = []): { state: GameState; view: CanoeView } {
  const state = createGame(7, { crew });
  state.canoe.hullTier = tier;
  state.canoe.speed = 3;
  (state.canoe.attachments as string[]).push(...attachments);
  for (const player of state.players) player.paddling = true;
  const view = new CanoeView();
  view.sync(state, crewOf(state), 0, 0, true, true);
  return { state, view };
}

/**
 * A canoe out on open water in clear, still weather, at rest, with `crew` aboard and no key held: for runs with
 * the real rules (`play`).
 */
export function onOpenWater(tier: number, crew = 1, attachments: string[] = []): { state: GameState; view: CanoeView } {
  const state = createGame(7, { crew: 1 });
  Object.assign(state.players[0], { position: { x: -40, y: 0, z: 1085 }, heading: -1.2 });
  Object.assign(state.canoe, { position: { x: -40, y: 0, z: 1085 }, heading: -1.2, speed: 0, beached: false, hullTier: tier });
  Object.assign(state.weather, { kind: 'clear', stormLevel: 0, windSpeed: 0, windTarget: 0 });
  while (state.players.length < crew) addPlayer(state);
  (state.canoe.attachments as string[]).push(...attachments);
  const view = new CanoeView();
  view.sync(state, crewOf(state), 0, 0, true, true);
  return { state, view };
}

export interface Frame {
  member: Member;
  /** Seconds since the run began, and the crew's stroke clock. */
  time: number;
  phase: number;
  /** The same hands and elbows in the trunk's own space: +z out ahead of the chest, +y up the spine. */
  chest: Record<'handL' | 'handR' | 'elbowL' | 'elbowR', THREE.Vector3>;
  /** How far each forearm and hand is from the head and the toque (negative: through them). */
  headGap: { L: number; R: number };
  /** In the figure's own space: +x its left, +y up from its seat, +z ahead. */
  own: Record<'handL' | 'handR' | 'elbowL' | 'elbowR' | 'shoulderL' | 'shoulderR' | 'grip' | 'blade' | 'tip', THREE.Vector3>;
  /** The same points in the hull's space. */
  hull: Frame['own'];
  /** The shaft's direction, grip to blade, in the figure's space. */
  axis: THREE.Vector3;
  /** How far the paddle passes from the middle line of the trunk and head, from 8 cm below the grip to the tip. */
  bodyGap: number;
}

const segmentGap = (p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3): number => {
  let least = Infinity;
  for (let first = 0; first <= 40; first += 1) {
    const a = p1.clone().lerp(q1, first / 40);
    for (let second = 0; second <= 12; second += 1) least = Math.min(least, a.distanceTo(p2.clone().lerp(q2, second / 12)));
  }
  return least;
};

export function frameOf(member: Member, time: number, phase: number): Frame {
  const { L, R, paddle } = member.figure.paddler;
  const axis = new THREE.Vector3(0, -1, 0).applyQuaternion(paddle.quaternion);
  const own = {
    handL: L.H.clone(), handR: R.H.clone(), elbowL: L.E.clone(), elbowR: R.E.clone(), shoulderL: L.S.clone(), shoulderR: R.S.clone(),
    grip: paddle.position.clone(), blade: paddle.position.clone().addScaledVector(axis, BLADE), tip: paddle.position.clone().addScaledVector(axis, TIP),
  };
  member.figure.root.updateMatrix();
  const hull = Object.fromEntries(Object.entries(own).map(([name, point]) => [name, point.clone().applyMatrix4(member.figure.root.matrix)])) as Frame['own'];
  const torso = member.figure.root.children[0];
  torso.updateMatrix();
  const spine = [new THREE.Vector3(0, 0.05, 0), new THREE.Vector3(0, 0.72, 0)].map((point) => point.applyMatrix4(torso.matrix));
  const bodyGap = segmentGap(own.grip.clone().addScaledVector(axis, 0.08), own.tip, spine[0], spine[1]);
  const toTrunk = torso.matrix.clone().invert();
  const chest = Object.fromEntries((['handL', 'handR', 'elbowL', 'elbowR'] as const).map((name) => [name, own[name].clone().applyMatrix4(toTrunk)])) as Frame['chest'];
  // The head is a ball of 13.5 cm and the toque one of 14.3 cm, as the figure is built; a forearm is 5 cm thick, a mitt 6.2 cm.
  const headGapOf = (elbow: THREE.Vector3, hand: THREE.Vector3): number => {
    let least = Infinity;
    for (let step = 0; step <= 10; step += 1) {
      const point = elbow.clone().lerp(hand, step / 10);
      least = Math.min(least, Math.min(point.distanceTo(HEAD) - 0.135, point.distanceTo(TOQUE) - 0.143) - (step === 10 ? 0.062 : 0.05));
    }
    return least;
  };
  const headGap = { L: headGapOf(chest.elbowL, chest.handL), R: headGapOf(chest.elbowR, chest.handR) };
  return { member, time, phase, own, hull, axis, bodyGap, chest, headGap };
}
const HEAD = new THREE.Vector3(0, 0.69, 0.008);
const TOQUE = new THREE.Vector3(0, 0.772, -0.014);

/** What one player holds at a moment of a run: the rules' own input, nothing pressed where left out. */
export type Held = Partial<StepInput>;

/**
 * Run the rules and the view together at `fps` for `seconds`, as the game does: `keys(time, player)` is what each
 * player holds. The view's paint time follows the rules' clock. Every figure's frame goes to `each`; the marks the
 * paddles leave on the water come back, with their times.
 */
export function play(
  view: CanoeView, state: GameState, fps: number, seconds: number, keys: (time: number, player: number) => Held,
  each: (frame: Frame, before: Frame | null) => void, start = 0,
): { time: number; x: number; z: number }[] {
  const last = new Map<Member, Frame>();
  const marks: { time: number; x: number; z: number }[] = [];
  let stateTime = state.time;
  let paint = start;
  for (let frame = 1; frame <= Math.round(fps * seconds); frame += 1) {
    const time = start + frame / fps;
    step(state, state.players.map((_, player) => ({ ...NEUTRAL_INPUT, ...keys(time, player) })), 1 / fps);
    const painted = Math.max(0, Math.min(1 / fps, state.time - stateTime));
    stateTime = state.time;
    paint += painted;
    for (const mark of view.sync(state, crewOf(state), painted, paint, true, false)) marks.push({ time, x: mark.x, z: mark.z });
    for (const member of membersOf(view)) {
      const now = frameOf(member, time, inside(view).phase);
      each(now, last.get(member) ?? null);
      last.set(member, now);
    }
  }
  return marks;
}

/** Run the view's own loop at `fps` for `seconds`, as the game does, and hand every figure's frame to `each`. */
export function film(view: CanoeView, state: GameState, fps: number, seconds: number, each: (frame: Frame, before: Frame | null) => void, drive?: (time: number) => void): void {
  const last = new Map<Member, Frame>();
  for (let step = 1; step <= fps * seconds; step += 1) {
    const time = step / fps;
    drive?.(time);
    view.sync(state, crewOf(state), 1 / fps, time, true, false);
    for (const member of membersOf(view)) {
      const frame = frameOf(member, time, inside(view).phase);
      each(frame, last.get(member) ?? null);
      last.set(member, frame);
    }
  }
}

/** The hull as drawn: its gunwale, and where a run of points passes through its side above the waterline. */
export function hullOf(tier: number) {
  const { dimensions } = HULL_TIERS[tier];
  const shape = makeHullShape(dimensions);
  const gunwale = (z: number): number => shape.sheerAt(z) - dimensions.draft;
  /** How far over the gunwale a run of points crosses the hull's side (negative: through the planking). Infinity: it does not cross. */
  const crossing = (from: THREE.Vector3, to: THREE.Vector3, radius: number): number => {
    let margin = Infinity;
    let before = from;
    for (let step = 1; step <= 30; step += 1) {
      const point = from.clone().lerp(to, step / 30);
      const [outBefore, outPoint] = [Math.abs(before.x) - shape.halfBeamAt(before.z), Math.abs(point.x) - shape.halfBeamAt(point.z)];
      if (Math.sign(outBefore) !== Math.sign(outPoint) && Math.abs(point.z) < dimensions.length / 2) {
        const at = before.clone().lerp(point, outBefore / (outBefore - outPoint));
        if (at.y + radius >= 0) margin = Math.min(margin, at.y - gunwale(at.z) - radius);
      }
      before = point;
    }
    return margin;
  };
  /** Positive: outboard of the hull or above its gunwale by that much, past a radius. Negative: down in the canoe. */
  const clearance = (point: THREE.Vector3, radius: number): number => Math.max(Math.abs(point.x) - shape.halfBeamAt(point.z), point.y - gunwale(point.z)) - radius;
  return { shape, gunwale, crossing, clearance };
}
