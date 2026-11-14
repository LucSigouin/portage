/**
 * The cast, drawn once: the pictures the pick screen shows, one standing figure per character.
 *
 * This file is the seam between two jobs. The pick screen (`interface/cast-host.ts`) calls
 * `drawCastSketches` and lays the canvases on its cards. The look fills in the drawing here, with the
 * game's own figures and the game's own pen, the way `look/canoe-sketch.ts` draws the lobby's canoe.
 *
 * The signature below is frozen. When no picture can be made this returns null, and the screen shows
 * its cards with words only.
 *
 * How it draws (the rules at the top of `canoe-sketch.ts` hold here too):
 * - One 3D context for the whole call. All four figures are built, the camera is set once to hold the four of
 *   them standing on one spot (`castFrame`), and each one asked for is drawn alone through the game's frame
 *   pipeline, on black and on white, which makes one see-through picture (`seeThrough`). So every card is at one
 *   scale with the feet on one line, whoever is asked for and in whatever order.
 * - Everything made is disposed of and the context given back before it returns. The look's shared uniforms are
 *   kept and put back, whatever happens. The figures' material is the game's own and is left alone.
 * - The line is full and even (Luc: "make the outline of the character full not drawn"): it does not wander
 *   (the pen's `uWobble` is 0 for the draw) and it is one weight all round (`evenPen`). Neither changes the pen.
 */
import * as THREE from 'three';
import { CHARACTER_IDS } from '../data/cast.ts';
import type { CharacterId } from '../data/cast.ts';
import { createCrew } from './b2/canoe.js';
import type { Crew as Figure } from './b2/canoe.js';
import { GU } from './b2/palette.js';
import { createPost } from './b2/post.js';
import type { Post } from './b2/post.js';
import { SKETCH_HOUR, frameSubject, keepUniforms, pinUniform, seeThrough, sketchDaylight, sketchLight, sketchPen } from './canoe-sketch.ts';
import { outfitOf } from './crew.ts';
import { paletteAt } from './daylight.ts';

export interface CastSketchRequest {
  /** Who to draw, in the order the pictures come back. */
  characters: readonly CharacterId[];
  /** The seat whose colour each figure wears on its headgear (`CREW_MARKS`), 0 to 3. The coat is the figure's own. */
  seat: number;
  /** The size of each picture, in real pixels. All the pictures are the same size. */
  pixelWidth: number;
  pixelHeight: number;
  /** The height in real pixels of the window the pictures are shown in: the pen is the one the game uses there. */
  sheetHeight: number;
}

/**
 * One see-through canvas per character, in the order asked, each exactly `pixelWidth` by `pixelHeight`.
 * Every figure is drawn at the same scale with its feet on the same line, so the tall one is taller on
 * its card. Null when no picture can be made (no 3D context, a size of nothing).
 */
export function drawCastSketches(request: CastSketchRequest): HTMLCanvasElement[] | null {
  const width = Math.floor(request.pixelWidth);
  const height = Math.floor(request.pixelHeight);
  if (!(width > 0 && height > 0)) return null;
  const restore = keepUniforms(GU as unknown as Record<string, { value: unknown }>);
  const penScale = GU.uSc.value as number;
  let unpin: ((after: number) => void) | null = null;
  let uneven: (() => void) | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  let post: Post | null = null;
  let cast: Map<CharacterId, Figure> | null = null;
  try {
    // The figures and the one camera first: they need no graphics chip.
    cast = standingCast(request.seat);
    const camera = new THREE.PerspectiveCamera(CAST_VIEW.lens, width / height, 0.05, 200);
    const metres = castFrame(camera, [...cast.values()]);
    const scene = new THREE.Scene();
    scene.add(camera);
    for (const figure of cast.values()) scene.add(figure.root);

    // Noon on a clear, dry, windless day, whatever the game behind the screen is doing, the sun on the side shown.
    sketchDaylight();
    GU.uLightDir.value.copy(sketchLight(new THREE.Vector3(...paletteAt(SKETCH_HOUR, 0, 0).lightDirection), CAST_VIEW));
    // The pen's scale is the one of a window `sheetHeight` high, and its weight is one all round.
    unpin = pinUniform(GU.uSc, request.sheetHeight / 1080);
    uneven = evenPen(CAST_PEN.weight);

    // The same chip as the game's own context. preserveDrawingBuffer: each frame is read back after it is drawn.
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    renderer.autoClear = false;
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    post = createPost(renderer, camera);
    // The game's own switches for a still picture (as the lobby's canoe): no line boil, no paper frame, no wash, no grain.
    post.pen.uBoil.value = 0;
    post.uniforms.uFrame.value = -0.5;
    post.uniforms.uPaperLeft.value = 0;
    post.uniforms.uWash.value = 0;
    post.uniforms.uGrain.value = 0;
    post.setSize(width, height, 0.25, 2, width, height, 1);
    // The game's pen for a figure this size on that window, with no wander.
    post.pen.uWobble.value = CAST_PEN.wobble;
    post.pen.uLineW.value *= sketchPen(metres, height, request.sheetHeight) * CAST_PEN.width;

    const water = new THREE.Mesh();
    const pictures: HTMLCanvasElement[] = [];
    for (const character of request.characters) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return null;
      for (const [id, figure] of cast) figure.root.visible = id === character;
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
      // A frame with nothing on it is not a picture of anyone.
      if (inked === 0) return null;
      context.putImageData(picture, 0, 0);
      pictures.push(canvas);
    }
    return pictures;
  } catch (error) {
    console.info('Portage: the cast has no pictures, they could not be drawn.', error);
    return null;
  } finally {
    uneven?.();
    unpin?.(penScale);
    restore();
    if (cast) for (const figure of cast.values()) disposeFigure(figure);
    post?.dispose();
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
    }
  }
}

/**
 * Where a card's picture is taken from: from the front and a little to the figure's left (degrees round from
 * straight ahead of it), nearly level, through a long lens. `light`: the sun stands this many degrees further
 * round, so the side of the figure the picture shows is the lit one.
 */
export const CAST_VIEW = { yaw: 24, pitch: 5, lens: 20, margin: 0.05, light: 38 } as const;

/**
 * The line of the cards. `wobble`: pixels a line may sit off the true edge (the game's pen: 1.5). `weight`: where
 * the pen stands between its thinnest and driest (0) and its heaviest and wettest (1), all round. `width`: against
 * the game's pen at that weight.
 */
export const CAST_PEN = { wobble: 0, weight: 1, width: 0.8 } as const;

/**
 * The pen's weight on a surface comes from one number the ink buffer carries for it (`aux.b` in b2/post.js: noise
 * that sits on the object, so in the game a line swells and thins along its length). This is the number that
 * gives the weight asked for: the pen reads `weight = .5 + .5 * sin((value - .5) * 8 + 2)`.
 */
export function penValueFor(weight: number): number {
  return 0.5 + (Math.asin(2 * Math.min(1, Math.max(0, weight)) - 1) - 2) / 8;
}

/**
 * Give a uniform another value for as long as `when` says so: whoever reads it then gets `held`, and whoever
 * writes it writes the real one. The function it returns lets go, the real value in place.
 */
export function holdWhile<Value>(uniform: { value: Value }, held: Value, when: () => boolean): () => void {
  let real = uniform.value;
  Object.defineProperty(uniform, 'value', { get: () => (when() ? held : real), set: (next: Value) => { real = next; }, configurable: true, enumerable: true });
  return () => {
    Object.defineProperty(uniform, 'value', { value: real, writable: true, configurable: true, enumerable: true });
  };
}

/**
 * One weight of line all round: while the ink buffer is drawn (`uPass` 1) the look's noise is one flat value, so
 * every surface carries the same number for the pen and every line is as heavy as the next. The colours, drawn in
 * the other passes, keep the real noise. The function it returns puts the noise back and frees the flat one.
 */
export function evenPen(weight: number): () => void {
  const level = Math.round(penValueFor(weight) * 255);
  const flat = new THREE.DataTexture(new Uint8Array([level, level, level, level]), 1, 1, THREE.RGBAFormat);
  flat.needsUpdate = true;
  const release = holdWhile(GU.tNoise as { value: THREE.Texture }, flat, () => GU.uPass.value === 1);
  return () => {
    release();
    flat.dispose();
  };
}

/** Every point of a figure as it stands, in the world. */
function pointsOf(figure: Figure, visit: (point: THREE.Vector3) => void): void {
  const point = new THREE.Vector3();
  figure.root.updateMatrixWorld(true);
  figure.root.traverseVisible((object) => {
    const positions = (object as THREE.Mesh).geometry?.getAttribute?.('position');
    if (!positions) return;
    for (let index = 0; index < positions.count; index += 1) visit(point.fromBufferAttribute(positions, index).applyMatrix4(object.matrixWorld));
  });
}

/** One of the cast standing still at the origin in their own coat and a seat's headgear, facing +z, the soles of the boots at y = 0. */
export function standingFigure(character: CharacterId, seat: number): Figure {
  const figure = createCrew(outfitOf(Math.round(seat) || 0), character);
  figure.stand(0);
  let lowest = Infinity;
  pointsOf(figure, (point) => { lowest = Math.min(lowest, point.y); });
  if (Number.isFinite(lowest)) figure.root.position.y -= lowest;
  figure.root.updateMatrixWorld(true);
  return figure;
}

/** All four of the cast, each standing on the same spot. */
export function standingCast(seat: number): Map<CharacterId, Figure> {
  return new Map(CHARACTER_IDS.map((id) => [id, standingFigure(id, seat)]));
}

/**
 * Stand the camera where it holds all of `figures` at once, each on the same spot: so one camera draws every card,
 * the tall one taller on its card and all their feet on the bottom margin (each figure is set down a few
 * millimetres to that line). Returns the metres of world the picture takes in from top to bottom where the figures stand.
 */
export function castFrame(camera: THREE.PerspectiveCamera, figures: readonly Figure[]): number {
  const all = new THREE.Group();
  const homes = figures.map((figure) => figure.root.parent);
  const shown = figures.map((figure) => figure.root.visible);
  for (const figure of figures) {
    figure.root.visible = true;
    all.add(figure.root);
  }
  // The feet on one line as the camera sees them: a short boot's toe is drawn a hair higher than a long one's
  // (the camera looks a little down), so each figure is set down by what its lowest point stands above the lowest
  // of all, and the frame is taken again. Three rounds leave less than a thousandth of a pixel.
  let metres = 0;
  for (let round = 0; round < 4; round += 1) {
    metres = 2 * frameSubject(camera, all, CAST_VIEW) * Math.tan((camera.fov * Math.PI) / 360);
    if (round === 3) break;
    const lows = figures.map((figure) => {
      let low = Infinity;
      pointsOf(figure, (point) => { low = Math.min(low, point.project(camera).y); });
      return low;
    });
    const line = Math.min(...lows);
    figures.forEach((figure, index) => {
      if (Number.isFinite(lows[index])) figure.root.position.y -= ((lows[index] - line) * metres) / 2 / Math.cos((CAST_VIEW.pitch * Math.PI) / 180);
      figure.root.updateMatrixWorld(true);
    });
  }
  figures.forEach((figure, index) => {
    figure.root.visible = shown[index];
    if (homes[index]) homes[index]!.add(figure.root);
    else all.remove(figure.root);
  });
  return metres;
}

/** Free a figure's drawings. Its material is the look's own shared one and stays. */
export function disposeFigure(figure: Figure): void {
  figure.root.removeFromParent();
  figure.root.traverse((object) => (object as THREE.Mesh).geometry?.dispose());
}
