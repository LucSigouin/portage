/**
 * The stage: one thing alone, drawn by the game's own frame pipeline (`createPost` in look/b2/post.js): washes
 * in 4x multisampling, the ink buffer, the pen, the paper. The game's world view is not used, because it draws
 * the whole valley; this draws a scene of one subject and an optional grid, and nothing else. No sky, no water.
 *
 * It draws only when asked (a turn, a zoom, a new thing). It has no clock: the shared time is held at 0,
 * so a still view is the same pixels every time.
 */
import * as THREE from 'three';
import { GU } from '../look/b2/palette.js';
import { createPost } from '../look/b2/post.js';
import type { Post } from '../look/b2/post.js';
import { PIXEL_BUDGET } from '../look/quality.ts';
import { buildGrid, spacingFor } from './grid.ts';
import type { Grid } from './grid.ts';
import { applyLight, paperOf } from './light.ts';
import type { Light } from './light.ts';
import { matte } from './matte.ts';
import type { Subject } from './types.ts';

export type Background = 'paper' | 'checker' | 'dark';

/** Where the camera is: degrees round from +z (0 is behind a thing that faces -z), degrees up, metres out. */
export interface View {
  yaw: number;
  pitch: number;
  distance: number;
  /** What the camera looks at: the middle of the thing, or (for a canoe) the point the game's paddling camera looks at. */
  aim: 'centre' | 'paddle';
}

export interface DrawOptions {
  view: View;
  background: Background;
  grid: boolean;
  light: Light;
}

const DARK = 0x1c1e26;
const FIELD_OF_VIEW = 60;
const RADIANS = Math.PI / 180;

/** How far out a camera must stand to see a whole subject. */
export function fitDistance(subject: Subject, aspect: number): number {
  const size = subject.box.getSize(new THREE.Vector3());
  const radius = Math.max(0.05, size.length() / 2);
  const vertical = (FIELD_OF_VIEW * RADIANS) / 2;
  const horizontal = Math.atan(Math.tan(vertical) * aspect);
  return (radius / Math.sin(Math.min(vertical, horizontal))) * 1.12;
}

export class Stage {
  /** What the pipeline draws to. Shown for the paper and dark backgrounds. */
  readonly canvas: HTMLCanvasElement;
  /** The see-through frame, shown over a checker for the checker background. */
  readonly seeThrough: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly post: Post;
  private readonly camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW, 16 / 9, 0.05, 2000);
  private readonly scene = new THREE.Scene();
  private readonly water = new THREE.Mesh();
  private readonly reader: HTMLCanvasElement = document.createElement('canvas');
  private grid: Grid | null = null;
  private subject: Subject | null = null;
  private pixelWidth = 0;
  private pixelHeight = 0;

  constructor() {
    // preserveDrawingBuffer: the frame stays readable for the see-through copy and the saved picture.
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0xe0e2d8, 1);
    this.renderer.domElement.style.display = 'block';
    this.canvas = this.renderer.domElement;
    this.seeThrough = document.createElement('canvas');
    this.post = createPost(this.renderer, this.camera);
    // The game's own switches for a still picture: no line boil, no paper frame, no wash.
    this.post.pen.uBoil.value = 0;
    this.post.uniforms.uFrame.value = -0.5;
    this.post.uniforms.uPaperLeft.value = 0;
    this.post.uniforms.uWash.value = 0;
    this.scene.add(this.camera);
  }

  get width(): number {
    return this.pixelWidth;
  }

  get height(): number {
    return this.pixelHeight;
  }

  /** Match the host's size. Pixels follow the screen's ratio, within the game's own pixel budget. */
  resize(cssWidth: number, cssHeight: number, deviceRatio: number): void {
    const width = Math.max(1, Math.floor(cssWidth));
    const height = Math.max(1, Math.floor(cssHeight));
    const ratio = Math.min(deviceRatio, 2, Math.sqrt(PIXEL_BUDGET / (width * height)));
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    const drawn = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.pixelWidth = drawn.x;
    this.pixelHeight = drawn.y;
    this.post.setSize(drawn.x, drawn.y, 0.25, 2, drawn.x, drawn.y, 1);
    this.seeThrough.width = drawn.x;
    this.seeThrough.height = drawn.y;
    this.seeThrough.style.width = `${width}px`;
    this.seeThrough.style.height = `${height}px`;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  get aspect(): number {
    return this.camera.aspect;
  }

  setSubject(subject: Subject | null): void {
    if (this.subject?.object) this.scene.remove(this.subject.object);
    this.subject = subject;
    if (subject?.object) this.scene.add(subject.object);
  }

  /** Put the camera, the light and the grid where the options say. */
  private prepare(options: DrawOptions, withGrid: boolean): void {
    const subject = this.subject;
    if (!subject) return;
    applyLight(options.light);
    const centre = subject.box.getCenter(new THREE.Vector3());
    const size = subject.box.getSize(new THREE.Vector3());
    const { yaw, pitch, distance } = options.view;
    const focus = options.view.aim === 'paddle' && subject.paddle ? new THREE.Vector3(...subject.paddle.focus) : centre;
    const level = pitch * RADIANS;
    this.camera.position.set(
      focus.x + distance * Math.sin(yaw * RADIANS) * Math.cos(level),
      focus.y + distance * Math.sin(level),
      focus.z + distance * Math.cos(yaw * RADIANS) * Math.cos(level),
    );
    this.camera.lookAt(focus);
    // Depth precision follows the size of the thing: a hull and an island need different near planes.
    const reach = Math.max(size.length(), 0.5);
    this.camera.near = Math.max(0.02, Math.min(reach * 0.004, distance * 0.05));
    this.camera.far = Math.max(60, (distance + reach) * 6);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);

    // The grid: sized to the thing, snapped to whole metres of the world. Rebuilt only when its square or its place changes.
    const spacing = spacingFor(Math.max(size.x, size.z, 0.01));
    if (withGrid && options.grid) {
      const wanted = this.grid;
      const stale = !wanted || wanted.spacing !== spacing || Math.abs(centre.x - (wanted.covers[0] + wanted.covers[2]) / 2) > spacing * 4 || Math.abs(centre.z - (wanted.covers[1] + wanted.covers[3]) / 2) > spacing * 4;
      if (stale) {
        this.dropGrid();
        this.grid = buildGrid(spacing, centre.x, centre.z);
        this.scene.add(this.grid.mesh);
      }
    }
    if (this.grid) this.grid.mesh.visible = withGrid && options.grid;
    subject.watch?.(this.camera.position);
  }

  private dropGrid(): void {
    if (!this.grid) return;
    this.scene.remove(this.grid.mesh);
    this.grid.mesh.geometry.dispose();
    this.grid = null;
  }

  /** Size of one grid square in metres, for the page to say. Null with no grid. */
  gridSpacing(): number | null {
    return this.grid && this.grid.mesh.visible ? this.grid.spacing : null;
  }

  private pass(clear: THREE.ColorRepresentation, grain: number): void {
    this.renderer.setClearColor(clear, 1);
    this.post.uniforms.uGrain.value = grain;
    this.post.render(this.scene, this.camera, this.water, null, false, null, null, []);
  }

  /** Draw the frame for the paper and dark backgrounds. For the checker, the see-through frame goes on `seeThrough`. */
  draw(options: DrawOptions): void {
    if (!this.subject?.object) return;
    this.prepare(options, true);
    if (options.background === 'checker') {
      this.seeThroughFrame();
      return;
    }
    if (options.background === 'dark') this.pass(DARK, 0.25);
    else this.pass(paperOf(), 0.6);
  }

  /** The thing on black, then on white, turned into one frame with a real alpha. */
  private seeThroughFrame(): ImageData {
    const { pixelWidth: width, pixelHeight: height } = this;
    const reader = this.reader;
    reader.width = width;
    reader.height = height;
    const context = reader.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    this.pass(0x000000, 0);
    context.drawImage(this.canvas, 0, 0);
    const onBlack = context.getImageData(0, 0, width, height);
    this.pass(0xffffff, 0);
    context.drawImage(this.canvas, 0, 0);
    const onWhite = context.getImageData(0, 0, width, height);
    const out = new ImageData(width, height);
    matte(onBlack.data, onWhite.data, out.data);
    const target = this.seeThrough.getContext('2d') as CanvasRenderingContext2D;
    target.putImageData(out, 0, 0);
    return out;
  }

  /** The thing alone on a see-through background: no grid, no paper. A canvas the same size as the stage. */
  capture(options: DrawOptions): HTMLCanvasElement {
    this.prepare(options, false);
    this.seeThroughFrame();
    const copy = document.createElement('canvas');
    copy.width = this.pixelWidth;
    copy.height = this.pixelHeight;
    (copy.getContext('2d') as CanvasRenderingContext2D).drawImage(this.seeThrough, 0, 0);
    return copy;
  }

  dispose(): void {
    this.dropGrid();
    this.post.dispose();
    this.renderer.dispose();
  }
}

export { GU };
