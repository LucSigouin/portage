/**
 * The canoe by itself, drawn once: the picture the lobby shows of the canoe in the save played last.
 *
 * It is the game's own canoe (`CanoeView`, so every hull, mend and attachment is the one the game draws, and
 * anything added to the canoe later is in the picture with no change here) put through the game's own frame
 * pipeline (`createPost`: washes, ink buffer, pen), alone on nothing: no water, no sky, no paper. The frame is
 * drawn on black and on white and the two make one see-through picture (`seeThrough`), which the lobby
 * lays on its own paper. (The asset viewer does the same on its own page. Nothing is shared with it: the game
 * never imports the viewer.)
 *
 * Cheap, and nothing left behind:
 * - It has its own 3D context for the length of one call. Before it returns, everything it made is disposed of
 *   and the context is given back to the browser (`forceContextLoss`): a browser allows a page only a few, and the
 *   game needs its own.
 * - The look's shared uniforms (`GU`: the light, the pen's scale, the time) are the game's. They are kept before
 *   the draw and put back after it, whatever happens, so the game's next frame is drawn as its last was.
 * - Nothing here runs by itself. The caller picks the moment: never before the game's first frame, which times
 *   the chip (`look/quality.ts`).
 *
 * The pen is the game's pen for a canoe of this size on this window, not the pen of a sheet this small: a sheet
 * 190 pixels high would get a pen a sixth as wide (pen widths follow the sheet's height) and no line would show.
 * So the pen's scale is held at the window's for the draw, and thinned as the game thins it on a small hero.
 */
import * as THREE from 'three';
import { WEATHER } from '../data/index.ts';
import type { GameState } from '../sim/index.ts';
import { GU } from './b2/palette.js';
import { createPost, heroPen } from './b2/post.js';
import type { Post } from './b2/post.js';
import { CanoeView } from './canoe.ts';
import { crewOf } from './crew.ts';
import { mistDensity, paletteAt } from './daylight.ts';
import type { Rgb } from './daylight.ts';

export interface SketchRequest {
  /** A state holding the canoe to draw, level at the origin (`client/preview.ts` makes it). */
  state: GameState;
  /** The picture's size, in real pixels. */
  pixelWidth: number;
  pixelHeight: number;
  /** The height in real pixels of the window the picture is shown in: the pen is the one the game uses there. */
  sheetHeight: number;
}

/**
 * Where the picture is taken from: degrees round from astern (90 is abeam), degrees up, and a long lens.
 * `light`: the sun stands this many degrees further round than the camera, so the side of the hull the picture
 * shows is the lit one. (With noon's own bearing the camera looked at the shadowed side: a grey hull where the
 * game, seen from the sunny side, shows warm wood.)
 */
export const SKETCH_VIEW = { yaw: 62, pitch: 17, lens: 26, margin: 0.06, light: 30 } as const;

/**
 * The light of the picture: as high as `sun` stands (the hour's own light, pointing at the sun), turned round to
 * the side the picture is taken from. A still picture on paper has no north: only the sun's height is the hour's.
 */
export function sketchLight(sun: THREE.Vector3, view: { yaw: number; light: number } = SKETCH_VIEW): THREE.Vector3 {
  const height = Math.asin(Math.max(-1, Math.min(1, sun.clone().normalize().y)));
  const round = ((view.yaw + view.light) * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(round) * Math.cos(height), Math.sin(height), Math.cos(round) * Math.cos(height));
}

type Uniform = { value: unknown };
type Copyable = { clone(): Copyable; copy(from: Copyable): unknown; isTexture?: boolean };

const copyable = (value: unknown): value is Copyable =>
  typeof value === 'object' && value !== null && typeof (value as Copyable).clone === 'function'
  && typeof (value as Copyable).copy === 'function' && (value as Copyable).isTexture !== true;

/**
 * Remember every value in a set of uniforms. The function it returns puts them all back: numbers as they were,
 * colours and vectors copied into the same objects (shaders hold on to the objects), anything else by reference.
 */
export function keepUniforms(uniforms: Record<string, Uniform>): () => void {
  const kept = Object.entries(uniforms).map(([name, uniform]) => {
    const value = uniform.value;
    if (Array.isArray(value)) return { name, list: value.map((entry: unknown) => (copyable(entry) ? entry.clone() : entry)) };
    return { name, value: copyable(value) ? value.clone() : value };
  });
  return () => {
    for (const entry of kept) {
      const uniform = uniforms[entry.name];
      if (!uniform) continue;
      if ('list' in entry) {
        const now = uniform.value as unknown[];
        entry.list!.forEach((saved, index) => {
          if (copyable(saved) && copyable(now[index])) (now[index] as Copyable).copy(saved);
          else now[index] = saved;
        });
      } else if (copyable(entry.value) && copyable(uniform.value)) {
        uniform.value.copy(entry.value);
      } else {
        uniform.value = entry.value;
      }
    }
  };
}

/**
 * Hold a uniform at one value: whoever writes it meanwhile is ignored. The frame pipeline sets the pen's scale
 * from the sheet's height at every draw; this is how one draw gets the window's pen on a small sheet.
 * The function it returns lets go: the uniform is a plain value again, the one given as `after`.
 */
export function pinUniform(uniform: Uniform, pinned: number): (after: number) => void {
  Object.defineProperty(uniform, 'value', { get: () => pinned, set: () => {}, configurable: true, enumerable: true });
  return (after) => {
    Object.defineProperty(uniform, 'value', { value: after, writable: true, configurable: true, enumerable: true });
  };
}

/** Every point of everything visible under `root`, in the world. */
function eachPoint(root: THREE.Object3D, visit: (point: THREE.Vector3) => void): void {
  const point = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  root.updateMatrixWorld(true);
  root.traverseVisible((object) => {
    const positions = (object as THREE.Mesh).geometry?.getAttribute?.('position');
    if (!positions) return;
    const instanced = object as THREE.InstancedMesh;
    const copies = instanced.isInstancedMesh ? instanced.count : 1;
    for (let copy = 0; copy < copies; copy += 1) {
      if (instanced.isInstancedMesh) {
        instanced.getMatrixAt(copy, matrix);
        matrix.premultiply(object.matrixWorld);
      } else {
        matrix.copy(object.matrixWorld);
      }
      for (let index = 0; index < positions.count; index += 1) visit(point.fromBufferAttribute(positions, index).applyMatrix4(matrix));
    }
  });
}

/**
 * Stand the camera where `view` says and as near as holds every visible point of `subject` inside the frame, with
 * `view.margin` of the frame's height left clear all round: the drawing in the middle from side to side, and
 * standing on the bottom margin. Returns how far out it stands, metres.
 * The camera's aspect must be set. With nothing to look at it stands 6 m off the origin.
 */
export function frameSubject(
  camera: THREE.PerspectiveCamera, subject: THREE.Object3D, view: { yaw: number; pitch: number; margin: number } = SKETCH_VIEW,
): number {
  const radians = Math.PI / 180;
  const level = view.pitch * radians;
  // From the middle of the thing toward the camera, and the camera's own right and up.
  const out = new THREE.Vector3(Math.sin(view.yaw * radians) * Math.cos(level), Math.sin(level), Math.cos(view.yaw * radians) * Math.cos(level));
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), out).normalize();
  const up = new THREE.Vector3().crossVectors(out, right).normalize();
  const points: THREE.Vector3[] = [];
  eachPoint(subject, (point) => points.push(point.clone()));
  const middle = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
  if (points.length === 0) middle.set(0, 0, 0);
  const tall = Math.tan((camera.fov * radians) / 2) * (1 - 2 * view.margin);
  const wide = tall * camera.aspect;
  const offset = new THREE.Vector3();
  let distance = 6;
  // The distance that holds every point, then the drawing moved to the middle of the frame, then the distance again.
  for (let pass = 0; pass < 3 && points.length > 0; pass += 1) {
    distance = 0.2;
    for (const point of points) {
      offset.subVectors(point, middle);
      const toward = offset.dot(out);
      distance = Math.max(distance, Math.abs(offset.dot(right)) / wide + toward, Math.abs(offset.dot(up)) / tall + toward);
    }
    if (pass === 2) break;
    // Where the drawing's edges fall in the frame from this far out, and the middle of them.
    let [left, rightmost, low, high] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const point of points) {
      offset.subVectors(point, middle);
      const depth = distance - offset.dot(out);
      const across = offset.dot(right) / depth;
      const rise = offset.dot(up) / depth;
      left = Math.min(left, across);
      rightmost = Math.max(rightmost, across);
      low = Math.min(low, rise);
      high = Math.max(high, rise);
    }
    middle.addScaledVector(right, ((left + rightmost) / 2) * distance).addScaledVector(up, ((low + high) / 2) * distance);
  }
  // A drawing lower than its frame stands on the frame's bottom margin, so the line under it stays under it.
  // Raising the camera lowers a near point more than a far one, so the rise is the one the lowest-drawn point allows.
  if (points.length > 0) {
    let rise = Infinity;
    for (const point of points) {
      offset.subVectors(point, middle);
      rise = Math.min(rise, offset.dot(up) + tall * (distance - offset.dot(out)));
    }
    middle.addScaledVector(up, rise);
  }
  camera.position.copy(middle).addScaledVector(out, distance);
  camera.up.set(0, 1, 0);
  camera.lookAt(middle);
  camera.near = Math.max(0.02, distance * 0.05);
  camera.far = Math.max(60, distance * 8);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return distance;
}

/** The hour of the picture: noon. */
export const SKETCH_HOUR = 12;

/**
 * The picture's light, put into the look's shared uniforms: the game's own palette for noon (`syncLight` in
 * world-view.ts does this for the hour being played) under a clear, dry, windless sky, full hatching, no lamps,
 * the clock at nought, and the sun on the picture's side. Whoever calls this puts the uniforms back (`keepUniforms`).
 */
export function sketchDaylight(): void {
  const palette = paletteAt(SKETCH_HOUR, 0, 0);
  const set = (target: THREE.Color, value: Rgb): void => void target.setRGB(value[0], value[1], value[2]);
  set(GU.uLight.value, palette.light);
  set(GU.uShadowTint.value, palette.shadowTint);
  set(GU.uPaper.value, palette.paper);
  set(GU.uFogColor.value, palette.fog);
  set(GU.uSkyTop.value, palette.skyTop);
  set(GU.uSkyLow.value, palette.skyLow);
  set(GU.uFarTint.value, palette.farTint);
  set(GU.uFoam.value, palette.foam);
  GU.uLightDir.value.copy(sketchLight(new THREE.Vector3(...palette.lightDirection)));
  GU.uFogDensity.value = mistDensity(WEATHER.clear.visibility);
  GU.uHatch.value = 1;
  GU.uOvercast.value = 0;
  GU.uStars.value = 0;
  GU.uDark.value = 0;
  GU.uWet.value = 0;
  GU.uRain.value = 0;
  GU.uVeil.value = 0;
  GU.uTime.value = 0;
}

/**
 * One see-through picture from the same frame drawn on black and on white (RGBA, straight alpha, all three the
 * same length). A pixel the canoe covers is the same in both, a pixel it does not cover follows the background,
 * a soft edge lies between: so how far a pixel moves between the two says how much of it is background.
 */
export function seeThrough(onBlack: Uint8ClampedArray, onWhite: Uint8ClampedArray, out: Uint8ClampedArray): void {
  for (let at = 0; at < onBlack.length; at += 4) {
    const spread = (onWhite[at] - onBlack[at] + (onWhite[at + 1] - onBlack[at + 1]) + (onWhite[at + 2] - onBlack[at + 2])) / (3 * 255);
    const alpha = Math.min(1, Math.max(0, 1 - spread));
    if (alpha < 0.004) {
      out[at] = out[at + 1] = out[at + 2] = out[at + 3] = 0;
      continue;
    }
    out[at] = onBlack[at] / alpha;
    out[at + 1] = onBlack[at + 1] / alpha;
    out[at + 2] = onBlack[at + 2] / alpha;
    out[at + 3] = Math.round(alpha * 255);
  }
}

/**
 * The pen's width against the game's full pen, for a drawing `pixelHeight` high that takes in `metres` of world
 * top to bottom, shown in a window `sheetHeight` high: what the game's own pen does to a hero that small
 * (`heroPen` in b2/post.js thins it once the window's height covers more than 16.5 m).
 */
export function sketchPen(metres: number, pixelHeight: number, sheetHeight: number): number {
  return heroPen((metres / Math.max(1, pixelHeight)) * sheetHeight);
}

/** The canoe view of a state, posed once and held still: the game's own, with nobody in it. */
export function sketchCanoe(state: GameState): CanoeView {
  const view = new CanoeView();
  view.sync(state, crewOf(state), 0, 0, true, true);
  return view;
}

/**
 * Draw the canoe of `request.state` once and return it as a see-through picture, a canvas of exactly the size
 * asked for. Null when it cannot be drawn (no 3D context to be had, a canoe the look cannot build): nothing is
 * thrown and nothing is left behind either way.
 */
export function drawCanoeSketch(request: SketchRequest): HTMLCanvasElement | null {
  const width = Math.floor(request.pixelWidth);
  const height = Math.floor(request.pixelHeight);
  if (!(width > 0 && height > 0)) return null;
  const restore = keepUniforms(GU as unknown as Record<string, Uniform>);
  const penScale = GU.uSc.value as number;
  let unpin: ((after: number) => void) | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  let post: Post | null = null;
  let view: CanoeView | null = null;
  try {
    // The same chip as the game's own context. preserveDrawingBuffer: the frame is read back after it is drawn.
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    renderer.autoClear = false;
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    const camera = new THREE.PerspectiveCamera(SKETCH_VIEW.lens, width / height, 0.05, 200);
    post = createPost(renderer, camera);
    // The game's own switches for a still picture: no line boil, no paper frame, no wash, no grain.
    post.pen.uBoil.value = 0;
    post.uniforms.uFrame.value = -0.5;
    post.uniforms.uPaperLeft.value = 0;
    post.uniforms.uWash.value = 0;
    post.uniforms.uGrain.value = 0;
    post.setSize(width, height, 0.25, 2, width, height, 1);

    view = sketchCanoe(request.state);
    const scene = new THREE.Scene();
    scene.add(camera, view.group);
    const distance = frameSubject(camera, view.group);

    // Noon on a clear, dry, windless day, whatever the game behind the lobby is doing, with the sun on the picture's side.
    sketchDaylight();
    const metres = 2 * distance * Math.tan((SKETCH_VIEW.lens * Math.PI) / 360);
    post.pen.uLineW.value *= sketchPen(metres, height, request.sheetHeight);
    unpin = pinUniform(GU.uSc, request.sheetHeight / 1080);

    const reader = document.createElement('canvas');
    reader.width = width;
    reader.height = height;
    const context = reader.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    const water = new THREE.Mesh();
    const frameOn = (clear: number): ImageData => {
      renderer!.setClearColor(clear, 1);
      post!.render(scene, camera, water, null, false, null, null, []);
      context.drawImage(renderer!.domElement, 0, 0);
      return context.getImageData(0, 0, width, height);
    };
    const onBlack = frameOn(0x000000);
    const onWhite = frameOn(0xffffff);
    const picture = new ImageData(width, height);
    seeThrough(onBlack.data, onWhite.data, picture.data);
    let inked = 0;
    for (let at = 3; at < picture.data.length; at += 4) if (picture.data[at] > 0) inked += 1;
    // A frame with nothing on it is not a picture of a canoe.
    if (inked === 0) return null;
    context.putImageData(picture, 0, 0);
    return reader;
  } catch (error) {
    console.info('Portage: the lobby shows no canoe, it could not be drawn.', error);
    return null;
  } finally {
    unpin?.(penScale);
    restore();
    view?.dispose();
    post?.dispose();
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
    }
  }
}
