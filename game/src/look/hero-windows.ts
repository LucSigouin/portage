/**
 * Where the heroes are on the window. The heroes (the crew and the canoe)
 * are drawn apart from the world, at the window's own size, inside one
 * rectangle of the screen per hero: its window. This file works those
 * rectangles out. See "The hero pass" in b2/post.js.
 */
import * as THREE from 'three';

/** A rectangle of the canvas in pixels, measured from the bottom left. */
export interface HeroWindow { x: number; y: number; w: number; h: number }

const box = new THREE.Box3();
const meshBox = new THREE.Box3();
const toHero = new THREE.Matrix4();
const toClip = new THREE.Matrix4();
const corner = new THREE.Vector3();
const corners = Array.from({ length: 8 }, () => new THREE.Vector4());
/** The twelve edges of a box, as pairs of corner numbers (bit 0 x, bit 1 y, bit 2 z). */
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]] as const;

/** The box round everything a hero draws, in the hero's own space. False if it draws nothing. */
function boundsOf(hero: THREE.Object3D): boolean {
  box.makeEmpty();
  toHero.copy(hero.matrixWorld).invert();
  hero.traverseVisible((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    meshBox.copy(mesh.geometry.boundingBox as THREE.Box3).applyMatrix4(toClip.multiplyMatrices(toHero, mesh.matrixWorld));
    box.union(meshBox);
  });
  return !box.isEmpty();
}

/**
 * The rectangle of the canvas a hero covers, `margin` pixels wider all round, or null when it is off the
 * screen. The box is cut at the camera's near plane first, so a hero the camera is inside of still gets
 * the right rectangle. Matrices must be up to date.
 */
export function heroWindow(hero: THREE.Object3D, camera: THREE.Camera, width: number, height: number, margin: number): HeroWindow | null {
  if (!boundsOf(hero)) return null;
  toClip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(hero.matrixWorld);
  corners.forEach((clip, index) => {
    corner.set(index & 1 ? box.max.x : box.min.x, index & 2 ? box.max.y : box.min.y, index & 4 ? box.max.z : box.min.z);
    clip.set(corner.x, corner.y, corner.z, 1).applyMatrix4(toClip);
  });
  let [left, right, bottom, top] = [Infinity, -Infinity, Infinity, -Infinity];
  const reach = (x: number, y: number, w: number): void => {
    left = Math.min(left, x / w);
    right = Math.max(right, x / w);
    bottom = Math.min(bottom, y / w);
    top = Math.max(top, y / w);
  };
  for (const [from, to] of EDGES) {
    const [a, b] = [corners[from], corners[to]];
    // in front of the near plane: z + w > 0
    const [da, db] = [a.z + a.w, b.z + b.w];
    if (da <= 0 && db <= 0) continue;
    for (const [end, other, de, dother] of [[a, b, da, db], [b, a, db, da]] as const) {
      if (de > 0) {
        reach(end.x, end.y, end.w);
      } else {
        const t = de / (de - dother) + 1e-4;
        reach(end.x + (other.x - end.x) * t, end.y + (other.y - end.y) * t, end.w + (other.w - end.w) * t);
      }
    }
  }
  if (left >= 1 || right <= -1 || bottom >= 1 || top <= -1 || left > right) return null;
  const x0 = Math.max(0, Math.floor((left * 0.5 + 0.5) * width) - margin);
  const x1 = Math.min(width, Math.ceil((right * 0.5 + 0.5) * width) + margin);
  const y0 = Math.max(0, Math.floor((bottom * 0.5 + 0.5) * height) - margin);
  const y1 = Math.min(height, Math.ceil((top * 0.5 + 0.5) * height) + margin);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

const overlap = (first: HeroWindow, second: HeroWindow): boolean =>
  first.x < second.x + second.w && second.x < first.x + first.w && first.y < second.y + second.h && second.y < first.y + first.h;

/** One window per hero on screen, with windows that overlap joined, so no pixel is drawn twice. */
export function heroWindows(heroes: readonly THREE.Object3D[], camera: THREE.Camera, width: number, height: number, margin: number): HeroWindow[] {
  const windows: HeroWindow[] = [];
  for (const hero of heroes) {
    let next = heroWindow(hero, camera, width, height, margin);
    while (next) {
      const joined: HeroWindow = next;
      const at = windows.findIndex((other) => overlap(other, joined));
      if (at < 0) break;
      const [other] = windows.splice(at, 1);
      const x = Math.min(other.x, joined.x);
      const y = Math.min(other.y, joined.y);
      next = { x, y, w: Math.max(other.x + other.w, joined.x + joined.w) - x, h: Math.max(other.y + other.h, joined.y + joined.h) - y };
    }
    if (next) windows.push(next);
  }
  return windows;
}

/**
 * Pixels to leave round a hero, at a canvas this tall. Its pen lines and foam reach 7 pixels past its outline
 * at 1080p, and the pen at such a pixel reads the ink buffer 7 pixels further still.
 */
export function heroMargin(canvasHeight: number): number {
  return Math.ceil(14 * (canvasHeight / 1080)) + 2;
}
