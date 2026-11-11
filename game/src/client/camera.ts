/**
 * The camera: a chase camera behind the canoe, a follow camera on foot, and a
 * slow orbit for the lobby. The client owns it and hands the world view a
 * plain pose every frame. No Three.js and no DOM in here.
 *
 * Angles use the game's bearing convention: `yaw` is the bearing the camera
 * looks along (0 = north, clockwise), so it goes straight into
 * `StepInput.cameraYaw`. `pitch` is the camera's elevation above the subject.
 */
import { bearingDifference, playerOf, terrainHeight, waterRoughnessAt, waveHeight } from '../sim/index.ts';
import type { GameState, PlayerId, StepInput, Vector3 } from '../sim/index.ts';
import type { CameraInput } from './input.ts';

/** Where the camera is, what it looks at, and its vertical field of view in degrees. */
export interface CameraPose {
  position: Vector3;
  target: Vector3;
  fieldOfView: number;
}

/** What the camera follows. */
export interface CameraSubject {
  mode: 'canoe' | 'foot';
  position: Vector3;
  /** Bearing the canoe points or the player faces. */
  heading: number;
  /** True while the subject is travelling. Auto-recentre only acts then. */
  moving: boolean;
}

export interface CameraOptions {
  /** Vertical field of view, degrees. */
  fieldOfView: number;
  /** Swing back behind the heading when the mouse is left alone. */
  autoCentre: boolean;
  /** Accessibility: no wave bob, slower recentring. */
  reduceMotion: boolean;
}

/** Heights the camera must stay above. Injected so tests can use flat ground. */
export interface CameraSurface {
  ground(x: number, z: number): number;
  water(x: number, z: number): number;
}

interface ModeTuning {
  /** Height of the look-at point above the subject, metres. */
  focusHeight: number;
  defaultDistance: number;
  minimumDistance: number;
  maximumDistance: number;
  defaultPitch: number;
  /** Auto-recentre rate, per second. */
  recentreRate: number;
}

export const CAMERA_TUNING: Readonly<Record<'canoe' | 'foot', ModeTuning>> = {
  canoe: { focusHeight: 1.1, defaultDistance: 8.5, minimumDistance: 4, maximumDistance: 28, defaultPitch: 0.36, recentreRate: 1.6 },
  foot: { focusHeight: 1.5, defaultDistance: 6, minimumDistance: 2.5, maximumDistance: 18, defaultPitch: 0.34, recentreRate: 0.9 },
};

export const MINIMUM_PITCH = 0.06;
export const MAXIMUM_PITCH = 1.35;
/** The camera stays this far above the ground and the water, metres. */
export const SURFACE_CLEARANCE = 0.35;
/** Seconds the mouse must be left alone before the camera recentres. */
export const RECENTRE_DELAY_SECONDS = 1.2;
/** A subject that moves further than this in one frame was teleported: snap, do not glide. */
const SNAP_DISTANCE = 15;
/** On foot, do not swing round when the player walks toward the camera. */
const FOOT_RECENTRE_LIMIT = 2.2;

const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));

/** Camera position on the orbit sphere around `focus`. */
export function orbitPosition(focus: Vector3, yaw: number, pitch: number, distance: number): Vector3 {
  const horizontal = distance * Math.cos(pitch);
  return {
    x: focus.x - Math.sin(yaw) * horizontal,
    y: focus.y + distance * Math.sin(pitch),
    z: focus.z + Math.cos(yaw) * horizontal,
  };
}

/**
 * Lift a camera position so it, and its line of sight to the focus, clear
 * the ground and the water. Only `y` changes.
 */
export function liftAboveSurface(position: Vector3, focus: Vector3, surface: CameraSurface, clearance = SURFACE_CLEARANCE): Vector3 {
  let y = position.y;
  for (const share of [0.25, 0.5, 0.75, 1]) {
    const x = focus.x + (position.x - focus.x) * share;
    const z = focus.z + (position.z - focus.z) * share;
    const floor = Math.max(surface.ground(x, z), surface.water(x, z)) + clearance;
    const sightLine = focus.y + (y - focus.y) * share;
    if (sightLine < floor) y = focus.y + (floor - focus.y) / share;
  }
  return { x: position.x, y, z: position.z };
}

/** Move a bearing toward another by an eased share, the short way round. */
export function easeBearing(current: number, target: number, share: number): number {
  return current + bearingDifference(target, current) * clamp(share, 0, 1);
}

/** The surface the live game uses: the shared terrain and wave functions. */
export function surfaceFromState(state: GameState): CameraSurface {
  return {
    ground: terrainHeight,
    water: (x, z) => waveHeight(x, z, state.time, waterRoughnessAt(x, z, state.weather.stormLevel)),
  };
}

/**
 * What the camera follows in a game state: the player with `playerId`, or
 * the canoe when they are aboard. `input` is the intent the last step ran with: on foot the state carries no speed, so walking is read from it.
 */
export function subjectFromState(state: GameState, input: Pick<StepInput, 'moveX' | 'moveY'>, playerId: PlayerId = 0): CameraSubject {
  const player = playerOf(state, playerId);
  if (player.mode === 'canoe') {
    return {
      mode: 'canoe', position: state.canoe.position, heading: state.canoe.heading,
      moving: Math.abs(state.canoe.speed) > 0.3,
    };
  }
  return {
    mode: 'foot', position: player.position, heading: player.heading,
    moving: Math.hypot(input.moveX, input.moveY) > 0.01,
  };
}

export class ChaseCamera {
  /** Bearing the camera looks along. Feed it to `StepInput.cameraYaw`. */
  yaw = 0;
  pitch = CAMERA_TUNING.canoe.defaultPitch;
  distance = CAMERA_TUNING.canoe.defaultDistance;
  private mode: 'canoe' | 'foot' | null = null;
  private focus: Vector3 = { x: 0, y: 0, z: 0 };
  private secondsSinceOrbit = Infinity;

  /** Jump straight behind the subject: a new game, a load, a respawn. */
  snapBehind(subject: CameraSubject): void {
    const tuning = CAMERA_TUNING[subject.mode];
    this.mode = subject.mode;
    this.yaw = subject.heading;
    this.pitch = tuning.defaultPitch;
    this.distance = tuning.defaultDistance;
    this.focus = { x: subject.position.x, y: subject.position.y + tuning.focusHeight, z: subject.position.z };
    this.secondsSinceOrbit = Infinity;
  }

  /** Place the camera by hand, for staged shots. */
  setOrbit(orbit: { yaw?: number; pitch?: number; distance?: number }): void {
    if (orbit.yaw !== undefined) this.yaw = orbit.yaw;
    if (orbit.pitch !== undefined) this.pitch = clamp(orbit.pitch, MINIMUM_PITCH, MAXIMUM_PITCH);
    if (orbit.distance !== undefined) this.distance = orbit.distance;
    this.secondsSinceOrbit = 0;
  }

  update(
    subject: CameraSubject,
    input: CameraInput,
    options: CameraOptions,
    surface: CameraSurface,
    frameSeconds: number,
  ): CameraPose {
    const tuning = CAMERA_TUNING[subject.mode];
    if (this.mode === null) this.snapBehind(subject);
    if (this.mode !== subject.mode) {
      // Boarding or stepping ashore: keep the view direction, take the new mode's framing.
      this.mode = subject.mode;
      this.distance = tuning.defaultDistance;
    }

    // Orbit and zoom from the mouse.
    const orbiting = input.dragging || input.yawDelta !== 0 || input.pitchDelta !== 0;
    this.yaw += input.yawDelta;
    this.pitch = clamp(this.pitch + input.pitchDelta, MINIMUM_PITCH, MAXIMUM_PITCH);
    this.distance = clamp(this.distance * Math.exp(input.zoomDelta), tuning.minimumDistance, tuning.maximumDistance);
    this.secondsSinceOrbit = orbiting ? 0 : this.secondsSinceOrbit + frameSeconds;

    // Swing back behind the heading once the mouse has been left alone.
    if (options.autoCentre && subject.moving && this.secondsSinceOrbit >= RECENTRE_DELAY_SECONDS) {
      const offset = bearingDifference(subject.heading, this.yaw);
      if (subject.mode === 'canoe' || Math.abs(offset) <= FOOT_RECENTRE_LIMIT) {
        const rate = tuning.recentreRate * (options.reduceMotion ? 0.5 : 1);
        this.yaw = easeBearing(this.yaw, subject.heading, 1 - Math.exp(-rate * frameSeconds));
      }
    }
    // Keep the bearing small so it never loses precision.
    this.yaw = bearingDifference(this.yaw, 0);

    // The look-at point trails the subject a little; with reduced motion it ignores the wave bob.
    const restingHeight = subject.mode === 'canoe' && options.reduceMotion ? 0 : subject.position.y;
    const goal = { x: subject.position.x, y: restingHeight + tuning.focusHeight, z: subject.position.z };
    const jump = Math.hypot(goal.x - this.focus.x, goal.z - this.focus.z);
    if (jump > SNAP_DISTANCE) {
      this.focus = goal;
    } else {
      const follow = 1 - Math.exp(-12 * frameSeconds);
      const bob = 1 - Math.exp(-(subject.mode === 'canoe' ? 3 : 8) * frameSeconds);
      this.focus = {
        x: this.focus.x + (goal.x - this.focus.x) * follow,
        y: this.focus.y + (goal.y - this.focus.y) * bob,
        z: this.focus.z + (goal.z - this.focus.z) * follow,
      };
    }

    const position = liftAboveSurface(orbitPosition(this.focus, this.yaw, this.pitch, this.distance), this.focus, surface);
    return { position, target: { ...this.focus }, fieldOfView: options.fieldOfView };
  }
}

/** The lobby backdrop: a slow circle around the canoe. */
export function lobbyCameraPose(
  subject: Vector3,
  elapsedSeconds: number,
  options: CameraOptions,
  surface: CameraSurface,
): CameraPose {
  const focus = { x: subject.x, y: 1.2, z: subject.z };
  const yaw = 0.6 + (options.reduceMotion ? 0 : elapsedSeconds * 0.05);
  const position = liftAboveSurface(orbitPosition(focus, yaw, 0.24, 13), focus, surface);
  return { position, target: focus, fieldOfView: options.fieldOfView };
}
