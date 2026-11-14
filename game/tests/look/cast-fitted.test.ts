/**
 * The cast on the fully fitted long canoe: every attachment aboard, a crew of four, each of the four people in
 * every seat. Nobody's body, clothes or what they carry is inside a piece, at rest, paddling, laying the paddle
 * down and taking it up, bailing or asleep.
 *
 * `attachments.test.ts` holds the paddler to this with boxes cut from each mesh (`slabsOf`). A broad figure with
 * a roll across its back, leaning into a stroke, makes boxes that are mostly air, so here the measure is the
 * figure's own surface: points sown over every triangle, 2 cm apart, each a small cube against every triangle
 * of every piece. It is the stricter of the two for a point that truly is inside, and it finds no air.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ATTACHMENTS, ATTACHMENT_IDS, CHARACTER_IDS } from '../../src/data/index.ts';
import type { AttachmentId, CharacterId } from '../../src/data/index.ts';
import { createGame } from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import type { Crew as Figure } from '../../src/look/b2/canoe.js';
import { CanoeView } from '../../src/look/canoe.ts';
import { crewOf } from '../../src/look/crew.ts';
import { boxTouchesTriangle, trianglesOf } from './canoe-geometry.ts';
import type { Triangles } from './canoe-geometry.ts';

const SPACING = 0.02;
const POSES = ['rest', 'paddle', 'stopstart', 'bail', 'sleep'] as const;
type Pose = (typeof POSES)[number];

/** The long hull with every attachment and a crew of four of one character, level at the origin. */
function fitted(who: CharacterId): GameState {
  const state = createGame(7, { crew: 4 });
  for (const player of state.players) player.character = who;
  state.canoe.hullTier = 3;
  state.canoe.attachments = ATTACHMENT_IDS.filter((attachmentId) => ATTACHMENTS[attachmentId].minimumHullTier <= 3);
  Object.assign(state.canoe, { position: { x: 0, y: 0, z: 0 }, heading: 0, pitch: 0, roll: 0, beached: false, sailRaised: true });
  return state;
}

/** Points sown over a mesh's surface, in its own space: every triangle's corners, and its inside at `SPACING`. */
function sown(mesh: THREE.Mesh): Float32Array {
  const position = mesh.geometry.getAttribute('position');
  const index = mesh.geometry.getIndex();
  const total = index ? index.count : position.count;
  const scale = new THREE.Vector3().setFromMatrixScale(mesh.matrixWorld);
  const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const points: number[] = [];
  for (let vertex = 0; vertex + 2 < total; vertex += 3) {
    a.fromBufferAttribute(position, index ? index.getX(vertex) : vertex);
    b.fromBufferAttribute(position, index ? index.getX(vertex + 1) : vertex + 1);
    c.fromBufferAttribute(position, index ? index.getX(vertex + 2) : vertex + 2);
    const longest = Math.max(a.clone().sub(b).multiply(scale).length(), b.clone().sub(c).multiply(scale).length(), c.clone().sub(a).multiply(scale).length());
    const steps = Math.max(1, Math.ceil(longest / SPACING));
    for (let i = 0; i <= steps; i += 1) for (let j = 0; j <= steps - i; j += 1) {
      const [u, v] = [i / steps, j / steps];
      points.push(a.x + (b.x - a.x) * u + (c.x - a.x) * v, a.y + (b.y - a.y) * u + (c.y - a.y) * v, a.z + (b.z - a.z) * u + (c.z - a.z) * v);
    }
  }
  return Float32Array.from(points);
}

/** The triangles of `all` whose own boxes reach into `box`. */
function near(all: Triangles, box: THREE.Box3): Triangles {
  const keep: number[] = [];
  for (let triangle = 0; triangle < all.count; triangle += 1) {
    const at = triangle * 6;
    if (all.boxes[at] > box.max.x || all.boxes[at + 3] < box.min.x || all.boxes[at + 1] > box.max.y || all.boxes[at + 4] < box.min.y || all.boxes[at + 2] > box.max.z || all.boxes[at + 5] < box.min.z) continue;
    keep.push(triangle);
  }
  const corners = new Float32Array(keep.length * 9);
  const boxes = new Float32Array(keep.length * 6);
  keep.forEach((triangle, slot) => {
    corners.set(all.corners.subarray(triangle * 9, triangle * 9 + 9), slot * 9);
    boxes.set(all.boxes.subarray(triangle * 6, triangle * 6 + 6), slot * 6);
  });
  return { corners, boxes, count: keep.length };
}

/** Which mesh of a figure this is: the torso (body, head and what is carried) or a limb. */
function nameOf(figure: Figure, mesh: THREE.Mesh): string {
  for (const [side, limbs] of [['left', figure.paddler.L], ['right', figure.paddler.R]] as const) {
    for (const [key, value] of Object.entries(limbs)) if (value === mesh) return `${side} ${key}`;
  }
  return 'torso';
}

/** Every place a crew of four of `who` is inside a piece, as `pose: seat N's part in piece`, each once. */
function inside(who: CharacterId, poses: readonly Pose[] = POSES): string[] {
  const found = new Map<string, string>();
  const cube = new THREE.Box3();
  const around = new THREE.Box3();
  const point = new THREE.Vector3();
  const half = new THREE.Vector3(SPACING / 2, SPACING / 2, SPACING / 2);
  for (const pose of poses) {
    const state = fitted(who);
    for (const player of state.players) Object.assign(player, { paddling: pose === 'paddle' || pose === 'stopstart', bailing: pose === 'bail', asleep: pose === 'sleep' });
    const view = new CanoeView();
    view.sync(state, crewOf(state), 0, 0, true, true);
    view.group.updateMatrixWorld(true);
    const holders = (view as unknown as { attachments: THREE.Group }).attachments.children;
    const parts = holders.map((holder, index) => ({ id: state.canoe.attachments[index] as AttachmentId, triangles: trianglesOf(holder), box: new THREE.Box3().setFromObject(holder, true) }));
    const members = (view as unknown as { members: Map<number, { figure: Figure }> }).members;
    const points = new Map<THREE.Mesh, Float32Array>();
    // Long enough for the paddles to change sides twice (the times `attachments.test.ts` uses).
    const seconds = pose === 'paddle' ? 9 : pose === 'stopstart' ? 5.2 : pose === 'bail' ? 2.6 : 0.4;
    for (let time = 0; time < seconds; time += 1 / 10) {
      if (pose === 'stopstart') for (const player of state.players) player.paddling = Math.floor(time / 1.3) % 2 === 0;
      view.sync(state, crewOf(state), 1 / 10, time, true, false);
      view.group.updateMatrixWorld(true);
      for (const player of state.players) {
        const figure = members.get(player.id)!.figure;
        figure.root.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh || !mesh.visible || mesh === figure.paddler.paddle) return;
          if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
          const reach = mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld).expandByScalar(SPACING);
          for (const part of parts) {
            const key = `${pose}: seat ${player.seat}'s ${nameOf(figure, mesh)} in ${part.id}`;
            if (found.has(key) || !reach.intersectsBox(part.box)) continue;
            const close = near(part.triangles, reach);
            if (close.count === 0) continue;
            if (!points.has(mesh)) points.set(mesh, sown(mesh));
            const own = points.get(mesh)!;
            // where those triangles are, all together: a point outside it touches none of them
            around.makeEmpty();
            for (let triangle = 0; triangle < close.count; triangle += 1) {
              around.expandByPoint(point.fromArray(close.boxes, triangle * 6)).expandByPoint(point.fromArray(close.boxes, triangle * 6 + 3));
            }
            around.expandByScalar(SPACING);
            for (let at = 0; at < own.length; at += 3) {
              point.set(own[at], own[at + 1], own[at + 2]).applyMatrix4(mesh.matrixWorld);
              if (!around.containsPoint(point)) continue;
              cube.min.subVectors(point, half);
              cube.max.addVectors(point, half);
              if (boxTouchesTriangle(cube, close)) {
                found.set(key, `${key} at ${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)}`);
                break;
              }
            }
          }
        });
      }
    }
    view.dispose();
  }
  return [...found.values()].sort();
}

/**
 * What today's paddler does, by this measure: laying the paddle down, the aft kneeler's elbow is drawn back into
 * the map table behind them (the stroke's "arms going backwards", being redrawn). Nobody of the cast may add to it.
 * When the stroke no longer does it, this list can go.
 */
const PADDLER_TODAY = ['stopstart: seat 2\'s right elbow in map_table'];

describe('the cast on the fully fitted long canoe', () => {
  for (const who of CHARACTER_IDS) {
    it(`four of the ${who}: nobody in any seat is inside a piece, at rest, paddling, starting and stopping, bailing or asleep (but for what today's paddler's elbow does)`, () => {
      const found = inside(who);
      console.log(`CAST fitted, ${who}: ${found.length === 0 ? 'inside nothing' : found.join('; ')}`);
      expect(found.map((hit) => hit.replace(/ at .*$/, '')).filter((hit) => !PADDLER_TODAY.includes(hit)), found.join('; ')).toEqual([]);
    }, 240_000);
  }
});
