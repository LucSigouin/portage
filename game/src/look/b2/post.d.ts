import type { Camera, IUniform, Mesh, PerspectiveCamera, Scene, Texture, Vector2, WebGLRenderer } from 'three';

export interface Post {
  uniforms: Record<string, IUniform>;
  /** The pen's settings: uLineW, uWobble, uBoil (off, always), uBoilTime. */
  pen: Record<string, IUniform<number>>;
  reflection: Texture;
  /** Drawing size in pixels. */
  resolution: Vector2;
  state: { w: number; h: number; inkScale: number; reflScale: number; inkW: number; inkH: number };
  /** reflectionScale: reflection size against the drawing. inkMaximum: most ink texels per pixel, each way. */
  setSize(width: number, height: number, reflectionScale?: number, inkMaximum?: number): void;
  linkWater(drift: IUniform<Vector2>): void;
  /** onPass is called before each scene pass: 2 reflection, 0 colour. */
  render(scene: Scene, camera: PerspectiveCamera, water: Mesh, overlay?: Scene | null, reflect?: boolean, onPass?: ((pass: number) => void) | null): void;
  dispose(): void;
}
export function createPost(renderer: WebGLRenderer, camera: Camera): Post;
