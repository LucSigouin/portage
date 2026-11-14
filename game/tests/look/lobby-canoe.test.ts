/**
 * The canoe behind the main menu, the parts that need the look's own canoe (Luc, Round 4): it is framed whole in
 * the painted part of the sheet for every hull, all round the slow circle and all through the drift; and its
 * sail and its flag hold still.
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { lobbyCameraPose, surfaceFromState } from '../../src/client/camera.ts';
import type { CameraPose, CameraSurface } from '../../src/client/camera.ts';
import type { CanoeBounds } from '../../src/client/contracts.ts';
import { LOBBY_DISTANCE, LOBBY_FURTHEST, lobbyFraming } from '../../src/client/lobbyframe.ts';
import { BACKDROP_RESET_SECONDS, Session } from '../../src/client/session.ts';
import { ATTACHMENT_IDS, HULL_TIERS } from '../../src/data/index.ts';
import { CanoeView } from '../../src/look/canoe.ts';
import { crewOf } from '../../src/look/crew.ts';
import { canoePieceTime } from '../../src/look/lobby.ts';
import type { GameState } from '../../src/sim/index.ts';
import { FakeStorage, newGame } from '../support.ts';

/** The two windows the brief names. */
const SIZES: [number, number][] = [[1920, 1080], [1366, 768]];
/** The lens setting: its default, and the two ends of its slider. */
const LENSES = [60, 45, 100];

/**
 * The painted part of the lobby's sheet, as shares of the window, read off the shader (`look/b2/post.js`, the
 * lines under "bare paper around the painting"): the left 0.4 of the width is bare, and the torn edge reaches at
 * most (0.03 + 0.115) of the height further in. The other three edges stop the painting 0.03 of the height in,
 * roughened by at most 0.036 more.
 */
function painted(aspect: number): { left: number; right: number; top: number; bottom: number } {
  return { left: 0.4 + 0.145 / aspect, right: 1 - 0.066 / aspect, top: 0.066, bottom: 1 - 0.066 };
}

/** The canoe the scene would show for this save, drawn the way the lobby draws it: nobody shown, its pieces at the lobby's fixed moment. */
function lobbyCanoe(hullTier: number, attachments: string[], sail: boolean): { view: CanoeView; state: GameState } {
  const state = newGame(7);
  state.canoe.hullTier = hullTier;
  state.canoe.attachments = attachments as GameState['canoe']['attachments'];
  state.canoe.sailRaised = sail;
  state.canoe.lanternLit = sail;
  const view = new CanoeView();
  view.sync(state, crewOf(state), 0, canoePieceTime('lobby', 12.5), false, true);
  return { view, state };
}

/** What the look hands the camera: `canoeBounds()` in `look/world-view.ts`. */
function boundsOf(view: CanoeView, aspect: number): CanoeBounds {
  const box = view.bounds();
  return { min: { x: box.min.x, y: box.min.y, z: box.min.z }, max: { x: box.max.x, y: box.max.y, z: box.max.z }, aspect };
}

/** Where the scene's canoe is, every 2.5 s of the 600 s before it is staged afresh, and the water and ground then. */
interface Moment { seconds: number; position: THREE.Vector3; rotation: THREE.Euler; surface: CameraSurface }
const moments: Moment[] = [];

beforeAll(() => {
  const session = new Session({ storage: new FakeStorage() });
  for (let frame = 0; session.backdrop.playedSeconds < BACKDROP_RESET_SECONDS - 0.5; frame += 1) {
    if (frame % 10 === 0) {
      const { canoe, time, weather } = session.backdrop;
      moments.push({
        seconds: session.backdrop.playedSeconds,
        position: new THREE.Vector3(canoe.position.x, canoe.position.y, canoe.position.z),
        // As the look turns the canoe (`CanoeView.sync`).
        rotation: new THREE.Euler(canoe.pitch, -canoe.heading, -canoe.roll),
        surface: surfaceFromState({ time, weather: { stormLevel: weather.stormLevel } } as GameState),
      });
    }
    session.advance(0.25, 0);
  }
});

/** A point of the canoe on the window, as shares of its width and height (0, 0 is the top left). */
function onWindow(point: THREE.Vector3, camera: THREE.PerspectiveCamera): { x: number; y: number } {
  const seen = point.clone().project(camera);
  return { x: (seen.x + 1) / 2, y: (1 - seen.y) / 2 };
}

/** The look's camera for a pose (`render` in `look/world-view.ts`). */
function cameraFor(pose: CameraPose, aspect: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(pose.fieldOfView, aspect, 0.1, 4000);
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
  camera.updateMatrixWorld();
  return camera;
}

/** The eight corners of a canoe's box, in canoe space. */
function cornersOf(bounds: CanoeBounds): THREE.Vector3[] {
  const corners: THREE.Vector3[] = [];
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) corners.push(new THREE.Vector3(x, y, z));
  return corners;
}

/** How much of the window a canoe takes, at its widest and its narrowest, over every moment of the drift and the circle. */
function sweep(bounds: CanoeBounds, lens: number): { left: number; right: number; top: number; bottom: number; widest: number; distance: number } {
  const options = { fieldOfView: lens, autoCentre: true, reduceMotion: false };
  const corners = cornersOf(bounds);
  const placed = new THREE.Matrix4();
  const framing = lobbyFraming(bounds, lens);
  const seen = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity, widest: 0, distance: framing.distance };
  for (const moment of moments) {
    const pose = lobbyCameraPose(moment.position, moment.seconds, options, moment.surface, framing);
    const camera = cameraFor(pose, bounds.aspect);
    placed.makeRotationFromEuler(moment.rotation).setPosition(moment.position);
    let [left, right] = [Infinity, -Infinity];
    for (const corner of corners) {
      const at = onWindow(corner.clone().applyMatrix4(placed), camera);
      left = Math.min(left, at.x);
      right = Math.max(right, at.x);
      seen.top = Math.min(seen.top, at.y);
      seen.bottom = Math.max(seen.bottom, at.y);
    }
    seen.left = Math.min(seen.left, left);
    seen.right = Math.max(seen.right, right);
    seen.widest = Math.max(seen.widest, right - left);
  }
  return seen;
}

describe('the drift the test frames is the lobby\'s own', () => {
  it('240 moments over the 600 s, and the circle goes round more than four times in them', () => {
    expect(moments).toHaveLength(240);
    expect(moments.at(-1)!.seconds * 0.05 / (2 * Math.PI)).toBeGreaterThan(4);
    const [first, last] = [moments[0]!, moments.at(-1)!];
    expect(first.position.distanceTo(last.position)).toBeGreaterThan(15);
  });
});

describe('framed for every canoe: whole in the painted part of the sheet, right of the bare paper', () => {
  for (const hull of HULL_TIERS) {
    it(`the ${hull.name.toLowerCase()}, bare and with everything built and its sail up: at 1920x1080 and 1366x768, at every lens, all round the circle, all through the drift`, () => {
      for (const [what, attachments, sail] of [['bare', [], false], ['full', [...ATTACHMENT_IDS], true]] as [string, string[], boolean][]) {
        const { view } = lobbyCanoe(hull.tier, attachments, sail);
        for (const [width, height] of SIZES) {
          const aspect = width / height;
          const sheet = painted(aspect);
          const bounds = boundsOf(view, aspect);
          for (const lens of LENSES) {
            const seen = sweep(bounds, lens);
            const where = `${hull.name} ${what} at ${width}x${height}, lens ${lens}`;
            expect(seen.left, `${where}: its left end`).toBeGreaterThan(sheet.left);
            expect(seen.right, `${where}: its right end`).toBeLessThan(sheet.right);
            expect(seen.top, `${where}: its top`).toBeGreaterThan(sheet.top);
            expect(seen.bottom, `${where}: its waterline`).toBeLessThan(sheet.bottom);
            // Whole, and not a speck: the circle is the 13 m it always was, or it stands off only because the canoe, broadside, fills the painting.
            if (seen.distance > LOBBY_DISTANCE) expect(seen.widest / (sheet.right - sheet.left), `${where}: its size`).toBeGreaterThan(0.6);
            expect(seen.distance, `${where}: its distance`).toBeGreaterThanOrEqual(LOBBY_DISTANCE);
            expect(seen.distance, `${where}: its distance`).toBeLessThan(25);
          }
        }
        view.dispose();
      }
    });
  }

  it('the box is the drawing: every vertex of the fullest canoe is inside the painted part too', () => {
    const { view } = lobbyCanoe(3, [...ATTACHMENT_IDS], true);
    const points: THREE.Vector3[] = [];
    view.group.position.set(0, 0, 0);
    view.group.rotation.set(0, 0, 0);
    view.group.updateMatrixWorld(true);
    view.group.traverseVisible((object) => {
      const positions = (object as THREE.Mesh).geometry?.getAttribute?.('position');
      if (!positions) return;
      for (let index = 0; index < positions.count; index += 1) points.push(new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(object.matrixWorld));
    });
    expect(points.length).toBeGreaterThan(10_000);
    const placed = new THREE.Matrix4();
    for (const [width, height] of SIZES) {
      const aspect = width / height;
      const sheet = painted(aspect);
      const bounds = boundsOf(view, aspect);
      // Eight moments, an eighth of the circle apart or so.
      for (const moment of moments.filter((_, index) => index % 30 === 0)) {
        const camera = cameraFor(lobbyCameraPose(moment.position, moment.seconds, { fieldOfView: 60, autoCentre: true, reduceMotion: false }, moment.surface, lobbyFraming(bounds, 60)), aspect);
        placed.makeRotationFromEuler(moment.rotation).setPosition(moment.position);
        let [left, right, top, bottom] = [Infinity, -Infinity, Infinity, -Infinity];
        for (const point of points) {
          const at = onWindow(point.clone().applyMatrix4(placed), camera);
          left = Math.min(left, at.x);
          right = Math.max(right, at.x);
          top = Math.min(top, at.y);
          bottom = Math.max(bottom, at.y);
        }
        expect(left).toBeGreaterThan(sheet.left);
        expect(right).toBeLessThan(sheet.right);
        expect(top).toBeGreaterThan(sheet.top);
        expect(bottom).toBeLessThan(sheet.bottom);
      }
    }
    view.dispose();
  });
});

describe('the circle keeps its distance by the canoe\'s size', () => {
  const at = (hullTier: number, attachments: string[], sail: boolean, lens: number, aspect = 16 / 9): { distance: number; turn: number } => {
    const { view } = lobbyCanoe(hullTier, attachments, sail);
    const framing = lobbyFraming(boundsOf(view, aspect), lens);
    view.dispose();
    return framing;
  };

  it('never nearer than it always was, 13 m: at the default lens on a wide window that holds every bare hull, and every hull but the long one with everything built', () => {
    for (const hull of HULL_TIERS) {
      expect(at(hull.tier, [], false, 60).distance).toBe(LOBBY_DISTANCE);
      const full = at(hull.tier, [...ATTACHMENT_IDS], true, 60).distance;
      if (hull.tier < 3) expect(full).toBe(LOBBY_DISTANCE);
      else {
        // The long hull with both floats, the rudder and the figurehead is 7.8 m by 4.9 m: a metre further off.
        expect(full).toBeGreaterThan(13.5);
        expect(full).toBeLessThan(14.5);
      }
    }
    expect(LOBBY_DISTANCE).toBe(13);
  });

  it('a longer lens or a narrower window stands further off, and further for the big canoe than for the small one', () => {
    const [small, big] = [at(0, [], false, 45), at(3, [...ATTACHMENT_IDS], true, 45)];
    expect(big.distance).toBeGreaterThan(small.distance);
    expect(big.distance).toBeGreaterThan(LOBBY_DISTANCE);
    const narrow = at(3, [...ATTACHMENT_IDS], true, 60, 4 / 3);
    expect(narrow.distance).toBeGreaterThan(LOBBY_DISTANCE);
    expect(narrow.distance).toBeLessThan(LOBBY_FURTHEST);
  });

  it('the camera looks left of the canoe, so the canoe sits in the painting and not in the middle of the window', () => {
    for (const hull of HULL_TIERS) {
      const framing = at(hull.tier, [], false, 60);
      expect(framing.turn).toBeGreaterThan(0.25);
      expect(framing.turn).toBeLessThan(0.5);
    }
  });
});

describe('the same slow circle', () => {
  it('with a canoe to frame, the camera stands where it always stood: only where it looks has changed', () => {
    const { view } = lobbyCanoe(1, [], false);
    const bounds = boundsOf(view, 16 / 9);
    const options = { fieldOfView: 60, autoCentre: true, reduceMotion: false };
    for (const moment of moments.filter((_, index) => index % 20 === 0)) {
      const today = lobbyCameraPose(moment.position, moment.seconds, options, moment.surface);
      const framed = lobbyCameraPose(moment.position, moment.seconds, options, moment.surface, lobbyFraming(bounds, 60));
      expect(framed.position).toEqual(today.position);
      expect(framed.target.y).toBe(today.target.y);
      expect(framed.target).not.toEqual(today.target);
      // It looks as far off as the canoe is.
      const reach = (pose: CameraPose): number => Math.hypot(pose.target.x - pose.position.x, pose.target.z - pose.position.z);
      expect(reach(framed)).toBeCloseTo(reach(today), 9);
    }
    view.dispose();
  });

  it('with reduced motion it holds still, framed', () => {
    const { view } = lobbyCanoe(3, [...ATTACHMENT_IDS], true);
    const bounds = boundsOf(view, 16 / 9);
    const still = { fieldOfView: 60, autoCentre: true, reduceMotion: true };
    const moment = moments[0]!;
    const framing = lobbyFraming(bounds, 60);
    expect(framing.turn).toBeGreaterThan(0);
    expect(lobbyCameraPose(moment.position, 250, still, moment.surface, framing)).toEqual(lobbyCameraPose(moment.position, 0, still, moment.surface, framing));
    view.dispose();
  });
});

describe('nothing new moves behind the menu', () => {
  /** Every vertex of the canoe as drawn at a paint time, one number after another. */
  function drawnAt(view: CanoeView, state: GameState, time: number): number[] {
    view.sync(state, crewOf(state), 1 / 60, time, false, false);
    const numbers: number[] = [];
    view.group.traverseVisible((object) => {
      const positions = (object as THREE.Mesh).geometry?.getAttribute?.('position');
      if (positions) numbers.push(...(positions.array as Float32Array));
    });
    return numbers;
  }

  it('the lobby draws the canoe\'s pieces at one fixed moment, the game at the look\'s own time', () => {
    expect(canoePieceTime('lobby', 0)).toBe(canoePieceTime('lobby', 3600));
    expect(canoePieceTime('game', 41.5)).toBe(41.5);
    expect(canoePieceTime('credits', 41.5)).toBe(41.5);
  });

  it('a raised sail and a flag are the same vertices a minute later in the lobby, and not in the game', () => {
    const { view, state } = lobbyCanoe(3, [...ATTACHMENT_IDS], true);
    const lobby = [drawnAt(view, state, canoePieceTime('lobby', 5)), drawnAt(view, state, canoePieceTime('lobby', 65))];
    expect(lobby[0]!.length).toBeGreaterThan(30_000);
    expect(lobby[1]).toEqual(lobby[0]);
    const game = [drawnAt(view, state, canoePieceTime('game', 5)), drawnAt(view, state, canoePieceTime('game', 65))];
    expect(game[1]).not.toEqual(game[0]);
    view.dispose();
  });
});
