/**
 * What the browser tells any page about the computer. Read once, sent
 * nowhere: it only goes into the text the player copies.
 */
import { describeBrowser, describeSystem, isSoftwareRenderer } from './text.ts';
import type { Environment } from './text.ts';

type Gl = WebGL2RenderingContext | WebGLRenderingContext;

/** The parts of `navigator` that only some browsers have. */
interface NavigatorExtras {
  deviceMemory?: number;
  userAgentData?: {
    brands?: { brand: string; version: string }[];
    platform?: string;
    getHighEntropyValues?(hints: string[]): Promise<{ platformVersion?: string; architecture?: string; bitness?: string }>;
  };
  getBattery?(): Promise<{ charging: boolean }>;
}

/** `promise`, or `fallback` if it has not answered in half a second. Nothing here may hold the readout up. */
function soon<Value>(promise: Promise<Value> | undefined, fallback: Value): Promise<Value> {
  if (!promise) return Promise.resolve(fallback);
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<Value>((resolve) => window.setTimeout(() => resolve(fallback), 500)),
  ]);
}

function readWebgl(gl: Gl): Environment['webgl'] {
  const second = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  return {
    version: String(gl.getParameter(gl.VERSION)),
    largestTexture: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
    largestBuffer: Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)),
    samples: second ? Number(gl.getParameter(gl.MAX_SAMPLES)) : 0,
    targetsAtOnce: second ? Number(gl.getParameter(gl.MAX_DRAW_BUFFERS)) : 1,
    floatTargets: gl.getExtension('EXT_color_buffer_float') !== null,
    halfFloatTargets: gl.getExtension('EXT_color_buffer_half_float') !== null || second,
    precisionBits: precision?.precision ?? 0,
    powerPreference: gl.getContextAttributes()?.powerPreference ?? 'not told',
  };
}

/** The chip's own name. Some browsers keep it back: then it is 'hidden', with the public name beside it when there is one. */
function readChip(gl: Gl | null): { chip: string; chipMaker: string } {
  if (!gl) return { chip: 'hidden', chipMaker: 'hidden' };
  const publicName = String(gl.getParameter(gl.RENDERER) ?? '');
  const publicMaker = String(gl.getParameter(gl.VENDOR) ?? '');
  const names = gl.getExtension('WEBGL_debug_renderer_info');
  const chip = names ? String(gl.getParameter(names.UNMASKED_RENDERER_WEBGL) ?? '') : '';
  const maker = names ? String(gl.getParameter(names.UNMASKED_VENDOR_WEBGL) ?? '') : '';
  const beside = (name: string): string => (name ? `hidden (the browser only says: ${name})` : 'hidden');
  return { chip: chip || beside(publicName), chipMaker: maker || beside(publicMaker) };
}

/** Read everything. `gl` is the game's own graphics context, so the chip named is the one the game draws on. */
export async function readEnvironment(gl: Gl | null): Promise<Environment> {
  const extras = navigator as Navigator & NavigatorExtras;
  const agentData = extras.userAgentData;
  const [battery, platform] = await Promise.all([
    soon(extras.getBattery?.call(navigator), null),
    soon(agentData?.getHighEntropyValues?.call(agentData, ['platformVersion', 'architecture', 'bitness']), null),
  ]);
  const { chip, chipMaker } = readChip(gl);
  const systemName = agentData?.platform || describeSystem(navigator.userAgent);
  const systemDetail = [
    platform?.platformVersion ? `version ${platform.platformVersion}` : '',
    platform?.architecture ? `${platform.architecture}${platform.bitness ? ` ${platform.bitness}-bit` : ''}` : '',
  ].filter((part) => part !== '').join(', ');
  return {
    chip,
    chipMaker,
    softwareDrawing: isSoftwareRenderer(chip),
    browser: describeBrowser(navigator.userAgent, agentData?.brands),
    system: systemDetail ? `${systemName} (${systemDetail})` : systemName,
    userAgent: navigator.userAgent,
    processors: navigator.hardwareConcurrency || null,
    memoryGigabytes: extras.deviceMemory ?? null,
    power: battery === null ? 'not told' : battery.charging ? 'plugged in' : 'on battery',
    windowWidth: window.innerWidth,
    windowHeight: window.innerHeight,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    density: window.devicePixelRatio || 1,
    canvasWidth: gl?.drawingBufferWidth ?? 0,
    canvasHeight: gl?.drawingBufferHeight ?? 0,
    webgl: gl && !gl.isContextLost() ? readWebgl(gl) : null,
  };
}
