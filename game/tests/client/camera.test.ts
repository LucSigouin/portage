import { describe, expect, it } from 'vitest';
import {
  CAMERA_TUNING, ChaseCamera, MAXIMUM_PITCH, MINIMUM_PITCH, RECENTRE_DELAY_SECONDS, SURFACE_CLEARANCE, easeBearing,
  liftAboveSurface, lobbyCameraPose, orbitPosition, subjectFromState, surfaceFromState,
} from '../../src/client/camera.ts';
import type { CameraOptions, CameraSubject, CameraSurface } from '../../src/client/camera.ts';
import type { CameraInput } from '../../src/client/input.ts';
import { terrainHeight } from '../../src/sim/index.ts';
import { newGame, standOn } from '../support.ts';

const FLAT: CameraSurface = { ground: () => -6, water: () => 0 };
const OPTIONS: CameraOptions = { fieldOfView: 60, autoCentre: true, reduceMotion: false };
const STILL: CameraInput = { yawDelta: 0, pitchDelta: 0, zoomDelta: 0, dragging: false };
const FRAME = 1 / 60;

const canoe = (overrides: Partial<CameraSubject> = {}): CameraSubject => ({
  mode: 'canoe', position: { x: 100, y: 0, z: 200 }, heading: 0, moving: false, ...overrides,
});

/** Run the camera for a while with one input. */
function run(camera: ChaseCamera, subject: CameraSubject, seconds: number, input = STILL, options = OPTIONS, surface = FLAT) {
  let pose = camera.update(subject, input, options, surface, FRAME);
  for (let elapsed = FRAME; elapsed < seconds; elapsed += FRAME) pose = camera.update(subject, input, options, surface, FRAME);
  return pose;
}

describe('camera maths', () => {
  it('puts the camera behind the bearing it looks along, in the game convention', () => {
    const focus = { x: 0, y: 1, z: 0 };
    // Looking north (-z): the camera sits to the south (+z), above the focus.
    const north = orbitPosition(focus, 0, 0.5, 10);
    expect(north.x).toBeCloseTo(0);
    expect(north.z).toBeCloseTo(10 * Math.cos(0.5));
    expect(north.y).toBeCloseTo(1 + 10 * Math.sin(0.5));
    // Looking east (+x): the camera sits to the west.
    const east = orbitPosition(focus, Math.PI / 2, 0, 10);
    expect(east.x).toBeCloseTo(-10);
    expect(east.z).toBeCloseTo(0);
    // Always exactly `distance` from the focus.
    expect(Math.hypot(north.x, north.y - 1, north.z)).toBeCloseTo(10);
  });

  it('eases a bearing the short way round', () => {
    expect(easeBearing(3, -3, 1)).toBeCloseTo(3 + (2 * Math.PI - 6)); // across the +-PI seam, not back through 0
    expect(easeBearing(0, 1, 0.25)).toBeCloseTo(0.25);
    expect(easeBearing(0, 1, 5)).toBeCloseTo(1); // share is clamped
  });

  it('lifts a camera that is under the ground or the water, and leaves a clear one alone', () => {
    const focus = { x: 0, y: 2, z: 0 };
    const hill: CameraSurface = { ground: (_x, z) => (z > 5 ? 8 : 0), water: () => 0 };
    const lifted = liftAboveSurface({ x: 0, y: 3, z: 10 }, focus, hill);
    expect(lifted.y).toBeGreaterThanOrEqual(8 + SURFACE_CLEARANCE - 1e-9);
    expect(lifted).toMatchObject({ x: 0, z: 10 });

    const swell: CameraSurface = { ground: () => -6, water: () => 1.5 };
    expect(liftAboveSurface({ x: 0, y: 0.2, z: 10 }, focus, swell).y).toBeGreaterThanOrEqual(1.5 + SURFACE_CLEARANCE - 1e-9);

    const clear = { x: 0, y: 6, z: 10 };
    expect(liftAboveSurface(clear, focus, FLAT)).toEqual(clear);
  });

  it('keeps the line of sight over a ridge between the camera and the subject', () => {
    const focus = { x: 0, y: 2, z: 0 };
    // A ridge half way; the camera's own spot is low and clear.
    const ridge: CameraSurface = { ground: (_x, z) => (z > 4 && z < 6 ? 5 : 0), water: () => 0 };
    const lifted = liftAboveSurface({ x: 0, y: 3, z: 10 }, focus, ridge);
    const sightLineAtRidge = focus.y + (lifted.y - focus.y) * 0.5;
    expect(sightLineAtRidge).toBeGreaterThanOrEqual(5 + SURFACE_CLEARANCE - 1e-9);
  });
});

describe('the chase camera', () => {
  it('starts straight behind the canoe, looking along its heading', () => {
    const camera = new ChaseCamera();
    const subject = canoe({ heading: Math.PI / 2 }); // pointing east
    const pose = camera.update(subject, STILL, OPTIONS, FLAT, FRAME);
    expect(camera.yaw).toBeCloseTo(Math.PI / 2);
    expect(pose.position.x).toBeLessThan(subject.position.x - 5); // west of the canoe
    expect(pose.position.z).toBeCloseTo(subject.position.z, 3);
    expect(pose.position.y).toBeGreaterThan(pose.target.y);
    expect(pose.target).toMatchObject({ x: 100, z: 200 });
    expect(pose.target.y).toBeCloseTo(CAMERA_TUNING.canoe.focusHeight);
    expect(pose.fieldOfView).toBe(60);
  });

  it('orbits with the mouse and clamps the pitch', () => {
    const camera = new ChaseCamera();
    camera.update(canoe(), STILL, OPTIONS, FLAT, FRAME);
    camera.update(canoe(), { ...STILL, yawDelta: 0.4, dragging: true }, OPTIONS, FLAT, FRAME);
    expect(camera.yaw).toBeCloseTo(0.4);
    camera.update(canoe(), { ...STILL, pitchDelta: 5, dragging: true }, OPTIONS, FLAT, FRAME);
    expect(camera.pitch).toBe(MAXIMUM_PITCH);
    camera.update(canoe(), { ...STILL, pitchDelta: -5, dragging: true }, OPTIONS, FLAT, FRAME);
    expect(camera.pitch).toBe(MINIMUM_PITCH);
  });

  it('zooms with the wheel inside the limits of the mode', () => {
    const camera = new ChaseCamera();
    camera.update(canoe(), STILL, OPTIONS, FLAT, FRAME);
    expect(camera.distance).toBe(CAMERA_TUNING.canoe.defaultDistance);
    camera.update(canoe(), { ...STILL, zoomDelta: 0.2 }, OPTIONS, FLAT, FRAME);
    expect(camera.distance).toBeCloseTo(CAMERA_TUNING.canoe.defaultDistance * Math.exp(0.2));
    camera.update(canoe(), { ...STILL, zoomDelta: 10 }, OPTIONS, FLAT, FRAME);
    expect(camera.distance).toBe(CAMERA_TUNING.canoe.maximumDistance);
    camera.update(canoe(), { ...STILL, zoomDelta: -10 }, OPTIONS, FLAT, FRAME);
    expect(camera.distance).toBe(CAMERA_TUNING.canoe.minimumDistance);
  });

  it('swings back behind the heading once the mouse is left alone, but only while moving', () => {
    const camera = new ChaseCamera();
    const moving = canoe({ moving: true });
    camera.update(moving, STILL, OPTIONS, FLAT, FRAME);
    camera.update(moving, { ...STILL, yawDelta: 1.5, dragging: true }, OPTIONS, FLAT, FRAME);
    // Just after the drag: holds where the player put it.
    run(camera, moving, RECENTRE_DELAY_SECONDS * 0.5);
    expect(camera.yaw).toBeCloseTo(1.5);
    // Left alone: comes back behind the canoe.
    run(camera, moving, 6);
    expect(Math.abs(camera.yaw)).toBeLessThan(0.02);

    // Standing still, it stays put.
    const parked = new ChaseCamera();
    parked.update(canoe(), STILL, OPTIONS, FLAT, FRAME);
    parked.update(canoe(), { ...STILL, yawDelta: 1.5, dragging: true }, OPTIONS, FLAT, FRAME);
    run(parked, canoe(), 6);
    expect(parked.yaw).toBeCloseTo(1.5);
  });

  it('never recentres with the setting off, or while the button is held', () => {
    const off = new ChaseCamera();
    const moving = canoe({ moving: true });
    off.update(moving, STILL, OPTIONS, FLAT, FRAME);
    off.update(moving, { ...STILL, yawDelta: 1 }, OPTIONS, FLAT, FRAME);
    run(off, moving, 6, STILL, { ...OPTIONS, autoCentre: false });
    expect(off.yaw).toBeCloseTo(1);

    const held = new ChaseCamera();
    held.update(moving, STILL, OPTIONS, FLAT, FRAME);
    held.update(moving, { ...STILL, yawDelta: 1, dragging: true }, OPTIONS, FLAT, FRAME);
    run(held, moving, 6, { ...STILL, dragging: true });
    expect(held.yaw).toBeCloseTo(1);
  });

  it('recentres more slowly with reduced motion', () => {
    const yawAfter = (reduceMotion: boolean): number => {
      const camera = new ChaseCamera();
      const moving = canoe({ moving: true });
      camera.update(moving, STILL, OPTIONS, FLAT, FRAME);
      camera.update(moving, { ...STILL, yawDelta: 1.5 }, OPTIONS, FLAT, FRAME);
      run(camera, moving, RECENTRE_DELAY_SECONDS + 1, STILL, { ...OPTIONS, reduceMotion });
      return camera.yaw;
    };
    expect(yawAfter(true)).toBeGreaterThan(yawAfter(false) + 0.2);
  });

  it('never swings round on foot, whichever way the figure walks and for however long: only the mouse turns it', () => {
    for (const autoCentre of [true, false]) {
      const camera = new ChaseCamera();
      const away: CameraSubject = { mode: 'foot', position: { x: 0, y: 3, z: 0 }, heading: 0, moving: true };
      camera.update(away, STILL, { ...OPTIONS, autoCentre }, FLAT, FRAME);
      for (const heading of [Math.PI, 1.2, -1.2, Math.PI / 2, 0.3]) {
        run(camera, { ...away, heading }, 6, STILL, { ...OPTIONS, autoCentre });
        expect(camera.yaw).toBe(0);
      }
      // The mouse turns it, and it stays where the mouse left it.
      camera.update(away, { ...STILL, yawDelta: 0.7, dragging: true }, { ...OPTIONS, autoCentre }, FLAT, FRAME);
      run(camera, { ...away, heading: -2 }, 6, STILL, { ...OPTIONS, autoCentre });
      expect(camera.yaw).toBeCloseTo(0.7, 12);
    }
  });

  it('on foot the view stops on the frame the figure stops: no glide after it, and no motion while it stands', () => {
    const camera = new ChaseCamera();
    const subject: CameraSubject = { mode: 'foot', position: { x: 0, y: 3, z: 0 }, heading: 0, moving: false };
    camera.update(subject, STILL, OPTIONS, FLAT, FRAME);
    let pose = camera.update(subject, STILL, OPTIONS, FLAT, FRAME);
    // Walk north at 2.6 m/s for a second, the ground rising under the figure.
    for (let frame = 1; frame <= 60; frame += 1) {
      const moved = { ...subject, moving: true, position: { x: 0, y: 3 + frame * 0.01, z: -frame * 2.6 * FRAME } };
      pose = camera.update(moved, STILL, OPTIONS, FLAT, FRAME);
      // The look-at point is on the figure every frame, not trailing it.
      expect(pose.target).toEqual({ x: 0, y: 3 + frame * 0.01 + CAMERA_TUNING.foot.focusHeight, z: -frame * 2.6 * FRAME });
    }
    const stopped = { ...subject, position: { x: 0, y: 3.6, z: -2.6 } };
    const first = JSON.stringify(camera.update(stopped, STILL, OPTIONS, FLAT, FRAME));
    for (let frame = 0; frame < 60; frame += 1) expect(JSON.stringify(camera.update(stopped, STILL, OPTIONS, FLAT, FRAME))).toBe(first);
  });

  it('stepping ashore glides to the figure and then stays on it, even while the player runs off', () => {
    const camera = new ChaseCamera();
    camera.update(canoe(), STILL, OPTIONS, FLAT, FRAME);
    run(camera, canoe(), 1);
    let frames = 0;
    let pose = camera.update(canoe(), STILL, OPTIONS, FLAT, FRAME);
    for (; frames < 120; frames += 1) {
      const position = { x: 103 + frames * 4.4 * FRAME, y: 1, z: 201 };
      pose = camera.update({ mode: 'foot', position, heading: Math.PI / 2, moving: true }, STILL, OPTIONS, FLAT, FRAME);
      if (pose.target.x === position.x && pose.target.z === position.z) break;
    }
    expect(frames).toBeGreaterThan(5);
    expect(frames).toBeLessThan(60);
    // From then on it is on the figure every frame.
    for (let more = frames + 1; more < frames + 60; more += 1) {
      const position = { x: 103 + more * 4.4 * FRAME, y: 1, z: 201 };
      pose = camera.update({ mode: 'foot', position, heading: Math.PI / 2, moving: true }, STILL, OPTIONS, FLAT, FRAME);
      expect(pose.target).toEqual({ x: position.x, y: 1 + CAMERA_TUNING.foot.focusHeight, z: 201 });
    }
  });

  it('ignores the wave bob with reduced motion', () => {
    const bobbing = (reduceMotion: boolean): number => {
      const camera = new ChaseCamera();
      let lowest = Infinity;
      let highest = -Infinity;
      for (let step = 0; step < 240; step += 1) {
        const subject = canoe({ position: { x: 100, y: 0.5 * Math.sin(step * 0.1), z: 200 } });
        const pose = camera.update(subject, STILL, { ...OPTIONS, reduceMotion }, FLAT, FRAME);
        if (step > 30) {
          lowest = Math.min(lowest, pose.target.y);
          highest = Math.max(highest, pose.target.y);
        }
      }
      return highest - lowest;
    };
    expect(bobbing(true)).toBeCloseTo(0, 6);
    expect(bobbing(false)).toBeGreaterThan(0.05);
  });

  it('takes the on-foot framing when the player steps ashore, keeping the view direction', () => {
    const camera = new ChaseCamera();
    camera.update(canoe({ heading: 1 }), { ...STILL, zoomDelta: 1 }, OPTIONS, FLAT, FRAME);
    expect(camera.distance).toBeGreaterThan(CAMERA_TUNING.foot.maximumDistance);
    const ashore: CameraSubject = { mode: 'foot', position: { x: 101, y: 1, z: 201 }, heading: 2, moving: false };
    camera.update(ashore, STILL, OPTIONS, FLAT, FRAME);
    expect(camera.distance).toBe(CAMERA_TUNING.foot.defaultDistance);
    expect(camera.yaw).toBeCloseTo(1);
    // The look-at point settles at head height above the ground the player stands on.
    expect(run(camera, ashore, 2).target.y).toBeCloseTo(1 + CAMERA_TUNING.foot.focusHeight, 2);
  });

  it('snaps to a subject that was moved far away instead of gliding across the lake', () => {
    const camera = new ChaseCamera();
    camera.update(canoe(), STILL, OPTIONS, FLAT, FRAME);
    const pose = camera.update(canoe({ position: { x: -900, y: 0, z: 1100 } }), STILL, OPTIONS, FLAT, FRAME);
    expect(pose.target.x).toBeCloseTo(-900);
    expect(pose.target.z).toBeCloseTo(1100);
  });

  it('stays above the real terrain and water all the way round an island', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    const surface = surfaceFromState(state);
    const camera = new ChaseCamera();
    const subject = subjectFromState(state, { moveX: 0, moveY: 0 });
    expect(subject.mode).toBe('foot');
    for (let step = 0; step < 120; step += 1) {
      // Orbit a full turn at the lowest pitch and the longest reach.
      const pose = camera.update(subject, { yawDelta: 0.06, pitchDelta: -1, zoomDelta: 1, dragging: true }, OPTIONS, surface, FRAME);
      const floor = Math.max(terrainHeight(pose.position.x, pose.position.z), surface.water(pose.position.x, pose.position.z));
      expect(pose.position.y, `step ${step}`).toBeGreaterThanOrEqual(floor + SURFACE_CLEARANCE - 1e-6);
    }
  });

  it('reads walking from the input on foot and speed from the canoe', () => {
    const state = newGame();
    expect(subjectFromState(state, { moveX: 0, moveY: 0 }).moving).toBe(false);
    state.canoe.speed = 2;
    expect(subjectFromState(state, { moveX: 0, moveY: 0 })).toMatchObject({ mode: 'canoe', moving: true });
    standOn(state, 'home_knoll');
    expect(subjectFromState(state, { moveX: 0, moveY: 0 }).moving).toBe(false);
    expect(subjectFromState(state, { moveX: 0, moveY: 1 }).moving).toBe(true);
  });
});

describe('the lobby camera', () => {
  it('circles the canoe slowly, and holds still with reduced motion', () => {
    const subject = { x: 12, y: 0, z: 1040 };
    const first = lobbyCameraPose(subject, 0, OPTIONS, FLAT);
    const later = lobbyCameraPose(subject, 20, OPTIONS, FLAT);
    expect(Math.hypot(later.position.x - first.position.x, later.position.z - first.position.z)).toBeGreaterThan(5);
    expect(later.target).toMatchObject({ x: 12, z: 1040 });
    const still = { ...OPTIONS, reduceMotion: true };
    expect(lobbyCameraPose(subject, 20, still, FLAT)).toEqual(lobbyCameraPose(subject, 0, still, FLAT));
  });
});
