/**
 * Who draws the game (Round 6: a friend's Chrome had hardware acceleration off and the game ran at a frame a
 * second). A software renderer is known by its name, a real card never is, and no name is no answer.
 */
import { describe, expect, it } from 'vitest';
import { isSoftwareRenderer, readRendererName, rendererNameOfCanvas } from '../../src/look/graphics-card.ts';
import type { RendererNameSource } from '../../src/look/graphics-card.ts';

const SOFTWARE = [
  'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
  'Google SwiftShader',
  'llvmpipe (LLVM 15.0.7, 256 bits)',
  'softpipe',
  'Software Rasterizer',
  'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'Apple Software Renderer',
  'ANGLE (GOOGLE, VULKAN 1.3.0 (SWIFTSHADER DEVICE (SUBZERO) (0X0000C0DE)), SWIFTSHADER DRIVER)',
  'LLVMPIPE (LLVM 17.0.6, 128 bits)',
];
const REAL = [
  'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
  'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'Mesa Intel(R) Xe Graphics',
  'Apple GPU',
  'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
];

describe('a software renderer, by its name', () => {
  it.each(SOFTWARE)('%s is software', (name) => {
    expect(isSoftwareRenderer(name)).toBe(true);
  });
  it.each(REAL)('%s is a real card', (name) => {
    expect(isSoftwareRenderer(name)).toBe(false);
  });
  it('says nothing of a name it does not have', () => {
    for (const none of ['', '   ', null, undefined]) expect(isSoftwareRenderer(none)).toBe(false);
  });
});

/** A 3D context that answers as a browser's does. */
function context(names: { trueName?: unknown; plainName?: unknown; extension?: boolean; throws?: boolean }): RendererNameSource & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    RENDERER: 0x1f01,
    getExtension(name: string): unknown {
      asked.push(name);
      if (names.throws) throw new Error('lost context');
      return names.extension === false ? null : { UNMASKED_RENDERER_WEBGL: 0x9246 };
    },
    getParameter(parameter: number): unknown {
      return parameter === 0x9246 ? names.trueName : parameter === 0x1f01 ? names.plainName : null;
    },
  };
}

describe('the renderer\'s name, from the game\'s own context', () => {
  it('is the true name where the browser tells it', () => {
    const source = context({ trueName: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)', plainName: 'WebKit WebGL' });
    expect(readRendererName(source)).toBe('ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)');
    expect(source.asked).toEqual(['WEBGL_debug_renderer_info']);
  });
  it('falls back to the plain name without the extension, or with an empty true name', () => {
    expect(readRendererName(context({ extension: false, plainName: 'llvmpipe (LLVM 15.0.7, 256 bits)' }))).toBe('llvmpipe (LLVM 15.0.7, 256 bits)');
    expect(readRendererName(context({ trueName: '', plainName: 'Mesa Intel(R) Xe Graphics' }))).toBe('Mesa Intel(R) Xe Graphics');
  });
  it('is null with no context, no name, or a context that throws', () => {
    expect(readRendererName(null)).toBeNull();
    expect(readRendererName(undefined)).toBeNull();
    expect(readRendererName(context({ extension: false, plainName: '' }))).toBeNull();
    expect(readRendererName(context({ trueName: 42, plainName: null }))).toBeNull();
    expect(readRendererName(context({ throws: true, plainName: 'softpipe' }))).toBeNull();
  });
  it('asks the canvas for the context it already has, and never for a new kind after it', () => {
    const kinds: string[] = [];
    const held = context({ trueName: 'Google SwiftShader' });
    const canvas = { getContext: (kind: string) => { kinds.push(kind); return kind === 'webgl2' ? held : null; } } as unknown as HTMLCanvasElement;
    expect(rendererNameOfCanvas(canvas)).toBe('Google SwiftShader');
    expect(kinds).toEqual(['webgl2']);
    expect(rendererNameOfCanvas(null)).toBeNull();
  });
});
