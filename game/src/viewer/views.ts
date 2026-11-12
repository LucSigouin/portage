/**
 * The fixed views, and where the camera may go. Yaw is degrees round from +z: 0 stands behind a thing that
 * faces -z (the game's canoe faces -z), 180 stands in front of it. Pitch is degrees above the ground.
 */
import * as THREE from 'three';
import type { Subject } from './types.ts';
import { fitDistance } from './stage.ts';
import type { View } from './stage.ts';
import type { ViewName } from './state.ts';

/** The game's paddling camera: 0.36 radians up, behind the canoe. */
export const PADDLE_PITCH = (0.36 * 180) / Math.PI;
export const MINIMUM_PITCH = 1;
export const MAXIMUM_PITCH = 89;

export function viewFor(name: ViewName, subject: Subject, aspect: number, free: View | null): View {
  const fit = subject.object ? fitDistance(subject, aspect) : 1;
  switch (name) {
    case 'front': return { yaw: 180, pitch: 5, distance: fit, aim: 'centre' };
    case 'side': return { yaw: 90, pitch: 5, distance: fit, aim: 'centre' };
    case 'top': return { yaw: 0, pitch: MAXIMUM_PITCH, distance: fit, aim: 'centre' };
    case 'paddle':
      return subject.paddle
        ? { yaw: 0, pitch: PADDLE_PITCH, distance: subject.paddle.distance, aim: 'paddle' }
        : { yaw: 0, pitch: PADDLE_PITCH, distance: fit, aim: 'centre' };
    case 'free': return free ?? { yaw: 215, pitch: 20, distance: fit, aim: 'centre' };
    default: return { yaw: 215, pitch: 20, distance: fit, aim: 'centre' };
  }
}

/** How close and how far the camera may stand, metres. */
export function distanceLimits(subject: Subject): [number, number] {
  const radius = Math.max(0.05, subject.box.getSize(new THREE.Vector3()).length() / 2);
  return [Math.max(0.15, radius * 0.25), radius * 30];
}
