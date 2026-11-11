/**
 * Detail by distance, for the things the world view does not cull itself:
 * the trees between near and far, a landmark's strokes, an island's small
 * dressing. The world view is not ours to change, so the eye's place is read
 * from the meshes it draws: every ground mesh reports the camera as it is
 * drawn (`eyeHook`), and when the eye has moved a metre the watchers run.
 *
 * A switch takes effect on the next pass, never mid-pass, and every range has
 * a gap between on and off: with a still camera nothing ever changes.
 */
import * as THREE from 'three';

export type Watcher = (eye: THREE.Vector3) => void;

const watchers = new Set<Watcher>();
const last = new THREE.Vector3(Infinity, 0, 0);

/** Run `watcher` whenever the eye has moved. The first run comes with the next frame drawn. */
export function watchDistance(watcher: Watcher): void {
  watchers.add(watcher);
  last.set(Infinity, 0, 0);
}

/** Tell the watchers where the eye is. Cheap when it has not moved a metre. */
export function noteEye(eye: THREE.Vector3): void {
  if (eye.distanceToSquared(last) < 1) return;
  last.copy(eye);
  for (const watcher of watchers) watcher(eye);
}

/** Make a mesh report the camera each time it is drawn. */
export function eyeHook(mesh: THREE.Mesh): void {
  mesh.onBeforeRender = (_renderer, _scene, camera) => noteEye(camera.position);
}

export function clearDistance(): void {
  watchers.clear();
  last.set(Infinity, 0, 0);
}

/** On inside `range[0]`, off outside `range[1]`: the gap between keeps a switch from flickering at its edge. */
export const within = (shown: boolean, distance: number, range: readonly [number, number]): boolean => distance < (shown ? range[1] : range[0]);

/** Full trees inside this, the same trees with half the triangles outside it, metres from the shoreline. */
export const FINE_TREES = [250, 280] as const;
/** A landmark's every stroke inside this, its outline alone outside it. */
export const FINE_LANDMARKS = [340, 380] as const;
/** An island's small dressing (sleepers, herons) is drawn inside this. */
export const CLOSE_DRESSING = [300, 340] as const;
/** An island's ground on its fine grid inside this, its coarse grid outside it. */
export const FINE_GROUND = [420, 470] as const;
