/**
 * How far what a figure of the cast wears and carries (`CAST_BUILD[id].solids`: a bedroll, a creel, a brim, a map
 * case) stays from everything that moves near it: the same figure's own forearms, hands, legs and paddle, and the
 * arms, legs, paddle, body and solids of everyone else aboard. Everything is a capsule (a rod with round ends), so
 * the distance between two of them is exact: no boxes full of air.
 */
import * as THREE from 'three';
import type { Crew as Figure } from '../../src/look/b2/canoe.js';
import { CAST_BUILD } from '../../src/look/cast.ts';
import type { CharacterId } from '../../src/data/index.ts';

export interface Capsule { name: string; from: THREE.Vector3; to: THREE.Vector3; radius: number }

/** The shortest distance between two segments (Ericson, "Real-Time Collision Detection", 5.1.9). */
export function segmentDistance(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3): number {
  const d1 = q1.clone().sub(p1);
  const d2 = q2.clone().sub(p2);
  const r = p1.clone().sub(p2);
  const [a, e, f] = [d1.dot(d1), d2.dot(d2), d2.dot(r)];
  let s = 0;
  let t = 0;
  if (a <= 1e-12 && e <= 1e-12) return r.length();
  if (a <= 1e-12) {
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = d1.dot(r);
    if (e <= 1e-12) {
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = d1.dot(d2);
      const denominator = a * e - b * b;
      s = denominator > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / denominator)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  return p1.clone().addScaledVector(d1, s).distanceTo(p2.clone().addScaledVector(d2, t));
}

/** Positive: that much air between the two. Negative: one is that far into the other. */
export const clearance = (one: Capsule, other: Capsule): number => segmentDistance(one.from, one.to, other.from, other.to) - one.radius - other.radius;

export interface Parts {
  /** What this one wears and carries that sticks out. */
  solids: Capsule[];
  /** Forearms, hands, legs and feet: what a figure may bring against its own solids. */
  reach: Capsule[];
  /** Upper arms: only held against other people's solids (they begin under the figure's own cape or coat). */
  upper: Capsule[];
  /** The paddle: the shaft and the blade. Empty when the paddle is not in the hands. */
  paddle: Capsule[];
  /** The body's own bulk: hips to shoulders, and the head. */
  body: Capsule[];
}

/** One figure as capsules, in the world. Matrices must be up to date (`updateMatrixWorld`). */
export function partsOf(figure: Figure, character: CharacterId): Parts {
  const build = CAST_BUILD[character];
  const root = figure.root;
  const torso = root.children[0];
  const world = (point: THREE.Vector3): THREE.Vector3 => point.clone().applyMatrix4(root.matrixWorld);
  const [sx, sy, sz] = build.scale;
  const inTorso = new THREE.Matrix4().copy(torso.matrixWorld).multiply(new THREE.Matrix4().makeScale(1 / sx, 1 / sy, 1 / sz));
  const worn = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z).applyMatrix4(inTorso);
  const solids = build.solids.map((solid) => ({ name: `${character}'s ${solid.name}`, from: worn(...solid.from), to: worn(...solid.to), radius: solid.radius }));
  const reach: Capsule[] = [];
  const upper: Capsule[] = [];
  for (const [name, side] of [['left', figure.paddler.L], ['right', figure.paddler.R]] as const) {
    upper.push({ name: `${name} upper arm`, from: world(side.S.clone().lerp(side.E, 0.5)), to: world(side.E), radius: 0.058 * build.arm });
    reach.push({ name: `${name} forearm`, from: world(side.E), to: world(side.H), radius: 0.05 * build.arm });
    reach.push({ name: `${name} hand`, from: world(side.H), to: world(side.H), radius: 0.062 });
    reach.push({ name: `${name} thigh`, from: world(side.thigh.position.clone().lerp(side.knee.position, 0.5)), to: world(side.knee.position), radius: 0.075 * build.leg });
    reach.push({ name: `${name} shin`, from: world(side.knee.position), to: world(side.boot.position), radius: 0.062 * build.leg });
    reach.push({ name: `${name} boot`, from: world(side.boot.position), to: world(side.boot.position), radius: 0.09 });
  }
  const paddle: Capsule[] = [];
  const blade = figure.paddler.paddle;
  if (blade.parent === root && blade.visible) {
    const axis = new THREE.Vector3(0, -1, 0).applyQuaternion(blade.quaternion);
    const down = (along: number): THREE.Vector3 => world(blade.position.clone().addScaledVector(axis, along));
    paddle.push({ name: 'paddle shaft', from: down(0), to: down(0.9), radius: 0.018 });
    paddle.push({ name: 'paddle blade', from: down(0.9), to: down(1.485), radius: 0.03 });
  }
  const body: Capsule[] = [
    { name: 'body', from: worn(0, 0.1, 0), to: worn(0, 0.43 * sy, 0), radius: 0.15 },
    { name: 'head', from: worn(0, 0.69 * sy, 0), to: worn(0, 0.69 * sy, 0), radius: 0.13 },
  ];
  return { solids, reach, upper, paddle, body };
}

export interface Nearest { clearance: number; what: string }

/**
 * The tightest place among a crew right now: each figure's solids against its own reach and paddle, and against
 * every other figure's reach, upper arms, paddle, body and solids. `skip` leaves pairs out by name.
 */
export function tightest(crew: { parts: Parts; label: string }[], into: Map<string, Nearest>, when: string, skip: (solid: string, other: string) => boolean = () => false): void {
  const note = (solid: Capsule, other: Capsule, whose: string, whoseOther: string): void => {
    if (skip(solid.name, other.name)) return;
    const air = clearance(solid, other);
    const key = `${solid.name} / ${whoseOther === whose ? 'own' : 'a crewmate\'s'} ${other.name}`;
    const before = into.get(key);
    if (!before || air < before.clearance) into.set(key, { clearance: air, what: `${whose} against ${whoseOther}, ${when}` });
  };
  for (const one of crew) {
    for (const solid of one.parts.solids) {
      for (const other of [...one.parts.reach, ...one.parts.paddle]) note(solid, other, one.label, one.label);
      for (const mate of crew) {
        if (mate === one) continue;
        for (const other of [...mate.parts.reach, ...mate.parts.upper, ...mate.parts.paddle, ...mate.parts.body, ...mate.parts.solids]) note(solid, other, one.label, mate.label);
      }
    }
  }
}
