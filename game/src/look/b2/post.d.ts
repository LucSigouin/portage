import type { Camera, IUniform, Mesh, Object3D, PerspectiveCamera, Scene, Texture, Vector2, WebGLRenderer } from 'three';
import type { PenName } from './pens.js';

/** A rectangle of the canvas in pixels, from the bottom left. */
export interface PostWindow { x: number; y: number; w: number; h: number }

export interface Post {
  uniforms: Record<string, IUniform>;
  /** The pen's settings: uLineW, uWobble, uBoil (off, always), uBoilTime. Shared by the world's pen and the heroes'. */
  pen: Record<string, IUniform<number>>;
  /** 1 thins the pen on small heroes (see `heroPen`). 0 keeps the full pen on every hero. */
  heroPen: IUniform<number>;
  reflection: Texture;
  /** The world's drawing size in pixels. */
  resolution: Vector2;
  /** w, h: the world's drawing. sheetW, sheetH: the canvas. hero*: the hero buffers and the last frame's windows. */
  state: {
    w: number; h: number; inkScale: number; reflScale: number; inkW: number; inkH: number;
    sheetW: number; sheetH: number; fine: number;
    heroRoomW: number; heroRoomH: number; heroInkScale: number; heroWindows: PostWindow[]; heroFine: number;
    /** Pixels of hero colour buffer drawn for the last hero window of the last frame. 0 when none was. */
    heroDrawnW: number; heroDrawnH: number;
    /** The pen's sample both pens are drawn with. The one `createPost` was given (`DEFAULT_PEN`, 'calm-hull', unless asked), then the last `setPen`. */
    pen: PenName;
  };
  /**
   * `?bench=N` draws every pass N times, `&benchpass=<name>` only that pass (reflection, colour, ink, composite, hero).
   * `discard`: every pass keeps the mirror's materials, as it was before: to measure what shading each pixel once saves.
   */
  bench: { draws: number; pass: string; discard: boolean };
  /** `?hullwater=1`: `keep` leaves the world's water inside the hull, painted over the floor, as it was. Only to prove the floor check can fail. */
  hullWater: { keep: boolean };
  /** Draw with one of the pen's samples (`pens.js`, `?pen=`), or with today's pen again. Both pens take it: the world's and the heroes'. */
  setPen(name: PenName): void;
  /**
   * width, height: the world's drawing size. reflectionScale: reflection size against the drawing.
   * inkMaximum: most ink texels per pixel, each way. sheetWidth, sheetHeight: the canvas. fine: the world's fine strokes.
   */
  setSize(width: number, height: number, reflectionScale?: number, inkMaximum?: number, sheetWidth?: number, sheetHeight?: number, fine?: number): void;
  linkWater(drift: IUniform<Vector2>): void;
  /**
   * onPass is called before each scene pass: 2 reflection, 0 colour.
   * heroes: the group (a child of the scene) drawn apart at the canvas's size, inside heroWindows. Null leaves it in the world.
   */
  render(
    scene: Scene, camera: PerspectiveCamera, water: Mesh, overlay?: Scene | Scene[] | null, reflect?: boolean,
    onPass?: ((pass: number) => void) | null, heroes?: Object3D | null, heroWindows?: PostWindow[],
  ): void;
  dispose(): void;
}
/** `pen`: the pen's sample both pens start with. The game's own (`DEFAULT_PEN`, 'calm-hull') unless asked. */
export function createPost(renderer: WebGLRenderer, camera: Camera, pen?: PenName): Post;

/**
 * The pen on a small hero. `start`: metres of world across the window's height at the hero's depth, up to which
 * the pen is full. `fall`: how fast it thins past that. `floor`: the share of its width it never goes under.
 */
export const HERO_PEN: { start: number; fall: number; floor: number };
/** The crew's render layer: every mesh of a figure is on it, and the hero pass marks their texels so the pen draws a figure's edge as a contour. */
export const CREW_LAYER: number;
/** The share of its full width the pen keeps on a hero, where the window's height covers `span` metres of world. */
export function heroPen(span: number, numbers?: { start: number; fall: number; floor: number }): number;
