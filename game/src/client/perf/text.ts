/**
 * The words of the performance readout: one block of plain text, short
 * enough to paste into a message. Pure: numbers in, text out.
 */
import type { Spread, TimedChange } from './stats.ts';

/** What the browser tells any page about the computer. `null` and 'hidden' mean it did not say. */
export interface Environment {
  /** The graphics chip's own name, or 'hidden' when the browser keeps it back. */
  chip: string;
  chipMaker: string;
  /** True when the name is a software renderer: the browser is not using a graphics chip at all. */
  softwareDrawing: boolean;
  browser: string;
  system: string;
  userAgent: string;
  processors: number | null;
  memoryGigabytes: number | null;
  /** 'plugged in', 'on battery' or 'not told'. */
  power: string;
  windowWidth: number;
  windowHeight: number;
  screenWidth: number;
  screenHeight: number;
  density: number;
  /** The canvas's real drawing size, in pixels. */
  canvasWidth: number;
  canvasHeight: number;
  webgl: {
    version: string;
    largestTexture: number;
    largestBuffer: number;
    samples: number;
    targetsAtOnce: number;
    floatTargets: boolean;
    halfFloatTargets: boolean;
    /** Bits of precision of a high-precision number in a pixel shader. */
    precisionBits: number;
    /** What the page asked for and got: 'high-performance' is the fast chip on a computer with two. */
    powerPreference: string;
  } | null;
}

/** The honest cost of one frame at one quality. */
export interface FrameCost {
  /** 'Top quality', 'Lowest rung', 'Low preset'. */
  name: string;
  /** The quality preset it was drawn with: 'High' or 'Low'. */
  preset: string;
  /** The rung it was really drawn on. */
  rung: number;
  /** Milliseconds a frame: the middle batch, then the quickest and the slowest. A wide gap means something else was using the chip. */
  milliseconds: number;
  quickest: number;
  slowest: number;
  frames: number;
  worldWidth: number;
  worldHeight: number;
}

/** The game left to itself, default settings. */
export interface WatchedRun {
  seconds: number;
  preset: string;
  /** The frame-rate cap in the default settings. 0 = none. */
  cap: number;
  /** Frames a second and the ladder rung, one per span. */
  spanSeconds: number;
  framesPerSecond: number[];
  rungs: number[];
  average: number;
  changes: TimedChange[];
  endRung: number;
  /** What the last rung had shed, in the look's own words. */
  shed: string;
  /** Time from one frame to the next. */
  frameTimes: Spread;
  /** The page's own script in each frame. */
  script: Spread;
  drawCalls: number | null;
  triangles: number | null;
}

export interface ReadoutData {
  build: string;
  three: string;
  /** Local date and time of the run. */
  when: string;
  tookSeconds: number;
  /** Debug switches on the address that change the numbers (`bench=2`). */
  switches: string[];
  environment: Environment;
  /** The screen's refresh, measured. */
  refresh: { hertz: number; milliseconds: number } | null;
  /** The most frames a second the cap lets through on this screen. */
  capAllows: number | null;
  worldWidth: number;
  worldHeight: number;
  watched: WatchedRun | null;
  costs: FrameCost[];
  notes: string[];
}

const one = (value: number): string => (value >= 100 ? String(Math.round(value)) : value.toFixed(1));
const whole = (value: number): string => String(Math.round(value));
const yesNo = (value: boolean): string => (value ? 'yes' : 'no');
const told = (value: number | null, unit = ''): string => (value === null ? 'not told' : `${value}${unit}`);
const millions = (value: number): string => (value >= 1e6 ? `${(value / 1e6).toFixed(2)} million` : whole(value));

/** How a frame cost sits against the time a frame may take. */
export function fitOf(milliseconds: number, allowed: number): string {
  if (milliseconds <= allowed * 0.85) return 'fits';
  return milliseconds <= allowed ? 'only just fits' : 'too slow';
}

function ladderWords(run: WatchedRun): string {
  if (run.changes.length === 0) return `Ladder: stayed on rung ${run.endRung}, ${run.shed}.`;
  const moves = run.changes.map((change) => `${one(change.seconds)} s rung ${change.from} to ${change.to}`).join(', ');
  return `Ladder: ${moves}. Ended on rung ${run.endRung}, ${run.shed}.`;
}

/** The whole readout. Under 60 lines whatever the numbers. */
export function formatReadout(data: ReadoutData): string {
  const { environment: computer, watched, costs } = data;
  const lines: string[] = [];
  lines.push('PORTAGE PERFORMANCE READOUT');
  lines.push(`Build: ${data.build}, three.js ${data.three}`);
  lines.push(`Run: ${data.when}, took ${whole(data.tookSeconds)} s, test switches: ${data.switches.length > 0 ? data.switches.join(' ') : 'none'}`);

  lines.push('', 'THIS COMPUTER');
  lines.push(`Graphics chip: ${computer.chip}`);
  lines.push(`Chip maker: ${computer.chipMaker}`);
  lines.push(`Drawn by software, not a chip: ${yesNo(computer.softwareDrawing)}`);
  lines.push(`Browser: ${computer.browser} on ${computer.system}`);
  lines.push(`Processors: ${told(computer.processors)}. Memory: ${computer.memoryGigabytes === null ? 'not told' : `${computer.memoryGigabytes} GB${computer.memoryGigabytes >= 8 ? ' or more' : ''}`}. Power: ${computer.power}.`);
  lines.push(`Window: ${computer.windowWidth} x ${computer.windowHeight}. Screen: ${computer.screenWidth} x ${computer.screenHeight}. Screen density: ${Math.round(computer.density * 100) / 100}.`);
  lines.push(`Canvas: ${computer.canvasWidth} x ${computer.canvasHeight} real pixels. World drawn at ${data.worldWidth} x ${data.worldHeight}.`);
  lines.push(data.refresh
    ? `Screen refresh: ${whole(data.refresh.hertz)} Hz, measured (${one(data.refresh.milliseconds)} ms apart).`
    : 'Screen refresh: could not be measured.');
  if (computer.webgl) {
    const limits = computer.webgl;
    lines.push(`WebGL: ${limits.version}`);
    lines.push(`WebGL limits: largest texture ${limits.largestTexture}, largest buffer ${limits.largestBuffer}, samples ${limits.samples}, targets at once ${limits.targetsAtOnce}.`);
    lines.push(`WebGL extras: float targets ${yesNo(limits.floatTargets)}, half-float targets ${yesNo(limits.halfFloatTargets)}, shader precision ${limits.precisionBits} bits, power asked for: ${limits.powerPreference}.`);
  } else {
    lines.push('WebGL: the graphics context could not be read.');
  }

  lines.push('');
  if (watched) {
    const times = watched.frameTimes;
    lines.push(`THE GAME BY ITSELF (default settings: ${watched.preset} preset, cap ${watched.cap > 0 ? `${watched.cap} a second` : 'off'}, ${whole(watched.seconds)} seconds)`);
    lines.push(`Frames a second, every ${watched.spanSeconds} s: ${watched.framesPerSecond.map(whole).join(' ')}`);
    lines.push(`Ladder rung, every ${watched.spanSeconds} s: ${watched.rungs.join(' ')}`);
    lines.push(`Average: ${one(watched.average)} frames a second.${data.capAllows === null ? '' : ` Most the cap lets through on this screen: ${whole(data.capAllows)}.`}`);
    lines.push(ladderWords(watched));
    lines.push(`Time between frames: middle ${one(times.middle)} ms, 95th ${one(times.p95)} ms, 99th ${one(times.p99)} ms, worst ${one(times.worst)} ms.`);
    lines.push(`Frames over 33 ms: ${times.over33} of ${times.count}. Over 50 ms: ${times.over50}.`);
    lines.push(`The page's own script in a frame: middle ${one(watched.script.middle)} ms, 95th ${one(watched.script.p95)} ms, worst ${one(watched.script.worst)} ms.`);
    if (watched.drawCalls !== null && watched.triangles !== null) lines.push(`One frame: ${watched.drawCalls} draw calls, ${millions(watched.triangles)} triangles.`);
  } else {
    lines.push('THE GAME BY ITSELF', 'Not measured: see the notes.');
  }

  lines.push('', 'HONEST COST OF ONE FRAME (frames drawn back to back and waited for, not held to the screen)');
  if (costs.length === 0) lines.push('Not measured: see the notes.');
  for (const cost of costs) {
    lines.push(`${cost.name} (${cost.preset}, rung ${cost.rung}): ${one(cost.milliseconds)} ms a frame (batches ${one(cost.quickest)} to ${one(cost.slowest)}), `
      + `up to ${whole(1000 / cost.milliseconds)} a second. ${cost.frames} frames. World ${cost.worldWidth} x ${cost.worldHeight}.`);
  }

  // What a frame may take: the cap's share of a second, or the screen's own refresh when that is slower.
  const cap = watched?.cap ?? 60;
  const allowed = Math.max(cap > 0 ? 1000 / cap : 0, data.refresh?.milliseconds ?? 0);
  lines.push('', 'IN SHORT');
  if (allowed > 0) {
    lines.push(`To hold ${whole(1000 / allowed)} a second a frame may take ${one(allowed)} ms.`);
    if (costs.length > 0) lines.push(`${costs.map((cost) => `${cost.name}: ${one(cost.milliseconds)} ms, ${fitOf(cost.milliseconds, allowed)}`).join('. ')}.`);
  }
  if (watched) lines.push(`By itself the game ran at ${whole(watched.average)} a second and ended on rung ${watched.endRung}.`);

  lines.push('', `Notes: ${data.notes.length > 0 ? data.notes.join(' ') : 'none.'}`);
  lines.push(`Browser's full name: ${computer.userAgent}`);
  return lines.join('\n');
}

/** A browser's name and version from what it says about itself. `brands` is `navigator.userAgentData.brands`, where there is one. */
export function describeBrowser(userAgent: string, brands: readonly { brand: string; version: string }[] = []): string {
  const real = brands.filter((entry) => !/not.?a.?brand/i.test(entry.brand));
  const named = real.find((entry) => entry.brand !== 'Chromium') ?? real[0];
  if (named) return `${named.brand} ${named.version}`;
  const rules: [RegExp, string][] = [
    [/Edg(?:e|A|iOS)?\/([\d.]+)/, 'Edge'],
    [/OPR\/([\d.]+)/, 'Opera'],
    [/Firefox\/([\d.]+)/, 'Firefox'],
    [/FxiOS\/([\d.]+)/, 'Firefox'],
    [/CriOS\/([\d.]+)/, 'Chrome'],
    [/Chrome\/([\d.]+)/, 'Chrome'],
    [/Version\/([\d.]+).*Safari\//, 'Safari'],
  ];
  for (const [pattern, name] of rules) {
    const match = pattern.exec(userAgent);
    if (match) return `${name} ${match[1].split('.')[0]}`;
  }
  return 'not told';
}

/** The system from the same line. Windows 10 and 11 say the same thing here. */
export function describeSystem(userAgent: string): string {
  if (/Windows NT/.test(userAgent)) return 'Windows';
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'iOS';
  if (/Android/.test(userAgent)) return 'Android';
  if (/CrOS/.test(userAgent)) return 'ChromeOS';
  if (/Mac OS X|Macintosh/.test(userAgent)) return 'macOS';
  if (/Linux|X11/.test(userAgent)) return 'Linux';
  return 'not told';
}

/** True for the names browsers give their software renderers. */
export const isSoftwareRenderer = (name: string): boolean => /swiftshader|llvmpipe|softpipe|software|basic render|warp/i.test(name);
