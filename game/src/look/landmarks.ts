/**
 * Landmarks: the big things that name an island. Each kind is one mesh in
 * B2's hand, built round the origin (ground at y = 0, front toward -z) and
 * placed by the island table. The drawings live in `world/` by region:
 * `shallows.ts`, `reach.ts`, `narrows.ts` (which also holds the Fog's).
 *
 * Every kind is built twice: with every stroke, and as its outline alone for
 * far off. `world/distance.ts` swaps a landmark between the two.
 * To replace one, call `registerLandmark(kind, build)` before the world view mounts.
 */
import * as THREE from 'three';
import type { IslandDefinition, LandmarkDefinition, LandmarkKind } from '../data/index.ts';
import { Builder } from './b2/geo.js';
import { onSite, siteAt } from './world/kit.ts';
import type { LandmarkBuilder } from './world/kit.ts';
import { NARROWS } from './world/narrows.ts';
import { REACH } from './world/reach.ts';
import { SHALLOWS, fireRing } from './world/shallows.ts';

export type { LandmarkBuilder } from './world/kit.ts';

const BUILDERS = { ...SHALLOWS, ...REACH, ...NARROWS } as Record<LandmarkKind, LandmarkBuilder>;

/** How tall each landmark stands, metres. The Beacon's light hangs 1.2 m above the radio tower's: in its lamp house. */
export const LANDMARK_HEIGHT: Partial<Record<LandmarkKind, number>> = { radio_tower: 29.5, steeple: 22, fire_tower: 26.5, pylon: 28, silo: 13.6, crane_arm: 14 };

/** Replace how a landmark is drawn. `build` is called twice: with `detail` true for the near mesh, false for the far one. */
export function registerLandmark(kind: LandmarkKind, build: LandmarkBuilder): void {
  BUILDERS[kind] = build;
  const built = geometries.get(kind);
  if (built) {
    (built.userData.far as THREE.BufferGeometry).dispose();
    built.dispose();
  }
  geometries.delete(kind);
}

const geometries = new Map<LandmarkKind, THREE.BufferGeometry>();

function build(kind: LandmarkKind, detail: boolean): THREE.BufferGeometry {
  const builder = new Builder(1200 + Object.keys(BUILDERS).indexOf(kind));
  BUILDERS[kind](builder, detail);
  return builder.geometry();
}

/**
 * The shared geometry of a landmark kind, with every stroke. Its far version
 * (the outline only) rides on it as `userData.far`, and points back with
 * `userData.full`.
 */
export function landmarkGeometry(kind: LandmarkKind): THREE.BufferGeometry {
  let geometry = geometries.get(kind);
  if (!geometry) {
    geometry = build(kind, true);
    const far = build(kind, false);
    geometry.userData = { landmark: kind, far };
    far.userData = { landmark: kind, full: geometry };
    geometries.set(kind, geometry);
  }
  return geometry;
}

/**
 * Kinds the island table has several times that are still drawn to fit each one's own ground. A truss span's
 * deck is the rules' ground, which falls away toward the bridge's ends: a level span stood on a tall pier at one
 * end and sat on the rail at the other.
 */
export const FITTED_KINDS: ReadonlySet<LandmarkKind> = new Set<LandmarkKind>(['truss_span']);

const fitted = new Map<LandmarkDefinition, THREE.BufferGeometry>();

/**
 * The drawing of one landmark of the island table. For most kinds it is the kind's shared geometry. For a fitted
 * kind it is that landmark's own, built on its own site, with its own far outline. The world view hands every
 * landmark the shared one: the island's watcher (terrain.ts) swaps these in the first time it runs.
 */
export function landmarkGeometryAt(island: IslandDefinition, landmark: LandmarkDefinition): THREE.BufferGeometry {
  if (!FITTED_KINDS.has(landmark.kind)) return landmarkGeometry(landmark.kind);
  let geometry = fitted.get(landmark);
  if (!geometry) {
    const [full, far] = onSite(landmark.kind, siteAt(island, landmark), () => [build(landmark.kind, true), build(landmark.kind, false)]);
    full.userData = { landmark: landmark.kind, far };
    far.userData = { landmark: landmark.kind, full };
    fitted.set(landmark, full);
    geometry = full;
  }
  return geometry;
}

/** The far version of a landmark kind: its outline, a fraction of the triangles. */
export function landmarkFarGeometry(kind: LandmarkKind): THREE.BufferGeometry {
  return landmarkGeometry(kind).userData.far as THREE.BufferGeometry;
}

export function disposeLandmarks(): void {
  for (const geometry of geometries.values()) {
    (geometry.userData.far as THREE.BufferGeometry).dispose();
    geometry.dispose();
  }
  geometries.clear();
  for (const geometry of fitted.values()) {
    (geometry.userData.far as THREE.BufferGeometry).dispose();
    geometry.dispose();
  }
  fitted.clear();
}

export const LANDMARK_KINDS = Object.keys(BUILDERS) as LandmarkKind[];
export { fireRing };
