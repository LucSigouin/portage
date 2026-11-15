/**
 * Is this browser drawing the game without the graphics card?
 *
 * A browser with hardware acceleration turned off still gives a 3D context: it draws it in software, on the
 * processor, and the game runs at a frame or two a second. The context says who draws it, in its renderer's name.
 * A friend of Luc's on a gaming PC had just that, and nothing in the game told him (Round 6).
 *
 * Unknown is not software: a browser that hides the name, or gives none, gets no warning.
 */

/** What a software renderer calls itself, in small letters. A name holding any of these is drawn on the processor. */
export const SOFTWARE_RENDERER_NAMES: readonly string[] = [
  // Chrome and Edge with acceleration off: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) ...), SwiftShader driver)"
  'swiftshader',
  // Mesa's two software drivers, on Linux: "llvmpipe (LLVM 15.0.7, 256 bits)"
  'llvmpipe',
  'softpipe',
  'software rasterizer',
  // Windows with no working driver: "ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)"
  'microsoft basic render driver',
  'apple software renderer',
];

/** True when the renderer's name is a software one. False for a real card, and for a name that is empty or missing. */
export function isSoftwareRenderer(rendererName: string | null | undefined): boolean {
  if (typeof rendererName !== 'string') return false;
  const name = rendererName.toLowerCase();
  return SOFTWARE_RENDERER_NAMES.some((software) => name.includes(software));
}

/** The part of a 3D context this reads. */
export interface RendererNameSource {
  readonly RENDERER: number;
  getExtension(name: string): unknown;
  getParameter(parameter: number): unknown;
}

/**
 * The renderer's name, as the context gives it: the true one where the browser tells it
 * (`WEBGL_debug_renderer_info`), else the plain one. Null when there is no context, no name, or the context throws.
 */
export function readRendererName(context: RendererNameSource | null | undefined): string | null {
  if (!context) return null;
  try {
    const unmasked = context.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL?: number } | null;
    const trueName = unmasked && typeof unmasked.UNMASKED_RENDERER_WEBGL === 'number' ? context.getParameter(unmasked.UNMASKED_RENDERER_WEBGL) : null;
    if (typeof trueName === 'string' && trueName.trim() !== '') return trueName;
    const plainName = context.getParameter(context.RENDERER);
    return typeof plainName === 'string' && plainName.trim() !== '' ? plainName : null;
  } catch {
    return null;
  }
}

/**
 * The renderer's name of the game's own picture. It asks the canvas for the context it already has (a canvas hands
 * back the same one every time), so no second context is ever made. Null when there is no canvas yet.
 */
export function rendererNameOfCanvas(canvas: HTMLCanvasElement | null | undefined): string | null {
  if (!canvas) return null;
  try {
    return readRendererName((canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as RendererNameSource | null);
  } catch {
    return null;
  }
}
