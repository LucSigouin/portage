/**
 * The performance readout (`?perf=1`), checked with no browser: its arithmetic, its time caps, its words,
 * and that its code can neither send nor store anything and is never part of a normal game's first download.
 */
import { describe, expect, it } from 'vitest';
import { createFrameLoop } from '../../src/client/loop.ts';
import {
  BATCH_FRAMES, cappedFrameMilliseconds, framesPerSecondBySpan, gapsBetween, median, percentile, placeLadderChanges, rungBySpan, spreadOf, timeFrames,
} from '../../src/client/perf/stats.ts';
import { describeBrowser, describeSystem, fitOf, formatReadout, isSoftwareRenderer } from '../../src/client/perf/text.ts';
import type { ReadoutData } from '../../src/client/perf/text.ts';

const sources = import.meta.glob('../../src/client/perf/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const mainSource = (import.meta.glob('../../src/main.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)['../../src/main.ts'];

/** Source with comments and string literals removed, so prose cannot trip the checks. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

/** A chip that takes `frameMilliseconds` a frame: the clock only moves when it is waited for. */
function fakeChip(frameMilliseconds: number, restMilliseconds = 16) {
  let time = 0;
  let pending = 0;
  let drawn = 0;
  return {
    get time() { return time; },
    get drawn() { return drawn; },
    timer: (budgetMilliseconds: number) => ({
      draw: () => { pending += 1; drawn += 1; },
      finish: () => { time += pending * frameMilliseconds; pending = 0; },
      now: () => time,
      rest: async () => { time += restMilliseconds; },
      budgetMilliseconds,
    }),
  };
}

describe('the spread of frame times', () => {
  it('finds the middle, the 95th, the 99th and the worst', () => {
    const times = Array.from({ length: 100 }, (_, index) => index + 1);
    const spread = spreadOf(times);
    expect(spread).toEqual({ count: 100, middle: 50, p95: 95, p99: 99, worst: 100, over33: 67, over50: 50 });
    expect(median([3, 1, 2])).toBe(2);
    expect(percentile([], 0.5)).toBe(0);
    expect(spreadOf([]).worst).toBe(0);
  });

  it('counts a frame over 33 ms and over 50 ms, and not one on the line', () => {
    const spread = spreadOf([16.7, 33, 33.4, 50, 50.1, 120]);
    expect(spread.over33).toBe(4);
    expect(spread.over50).toBe(2);
  });

  it('counts frames a second span by span', () => {
    // 60 a second for two seconds, then 30 a second for two.
    const moments = [
      ...Array.from({ length: 120 }, (_, index) => 1000 + index * (1000 / 60)),
      ...Array.from({ length: 60 }, (_, index) => 3000 + index * (1000 / 30)),
    ];
    expect(framesPerSecondBySpan(moments, 1000, 2000, 3)).toEqual([60, 30, 0]);
    expect(gapsBetween([0, 10, 30])).toEqual([10, 20]);
  });
});

describe('what the frame-rate cap lets through', () => {
  it('agrees with the game\'s own loop on every common screen', () => {
    for (const hertz of [50, 59.94, 60, 75, 90, 100, 120, 144, 165, 240]) {
      const refresh = 1000 / hertz;
      // The real loop, on a fake screen that refreshes exactly on time.
      let callback: ((timestamp: number) => void) | null = null;
      const ran: number[] = [];
      let now = 0;
      const loop = createFrameLoop({
        clock: { requestFrame: (next) => { callback = next; return 1; }, cancelFrame: () => undefined, now: () => now },
        frame: () => void ran.push(now),
        frameRateCap: () => 60,
      });
      loop.start();
      for (let refreshes = 0; refreshes < 2000; refreshes += 1) {
        now = refreshes * refresh;
        (callback as unknown as (timestamp: number) => void)(now);
      }
      const real = median(gapsBetween(ran));
      expect(cappedFrameMilliseconds(refresh, 60), `${hertz} Hz`).toBeCloseTo(real, 6);
    }
  });

  it('is 60 a second on a 60 or 120 Hz screen, and fewer on a 75 or 144 Hz one', () => {
    const allowed = (hertz: number): number => Math.round(1000 / cappedFrameMilliseconds(1000 / hertz, 60) * 10) / 10;
    expect(allowed(60)).toBe(60);
    expect(allowed(120)).toBe(60);
    expect(allowed(75)).toBe(37.5);
    expect(allowed(144)).toBe(48);
    expect(cappedFrameMilliseconds(1000 / 144, 0)).toBeCloseTo(1000 / 144, 9);
    expect(cappedFrameMilliseconds(0, 60)).toBe(0);
  });
});

describe('the honest frame timer', () => {
  it('reports the chip\'s own frame time, whatever the screen', async () => {
    for (const cost of [2, 9.7, 40]) {
      const chip = fakeChip(cost);
      const timed = await timeFrames(chip.timer(2700));
      expect(median(timed.perFrame)).toBeCloseTo(cost, 6);
      expect(timed.frames).toBeGreaterThan(20);
    }
  });

  it('doubles when the work doubles', async () => {
    const once = await timeFrames(fakeChip(9.7).timer(2700));
    const twice = await timeFrames(fakeChip(19.4).timer(2700));
    expect(median(twice.perFrame) / median(once.perFrame)).toBeCloseTo(2, 6);
  });

  it('ends by the clock on every chip, with one frame more at most', async () => {
    for (const cost of [0.5, 9.7, 240, 900, 5000]) {
      const chip = fakeChip(cost);
      const timed = await timeFrames(chip.timer(2700));
      // Slowest case: one warm-up frame, then the frames that start before the deadline.
      expect(chip.time, `${cost} ms a frame`).toBeLessThanOrEqual(2700 + 2 * cost + 16);
      expect(timed.frames).toBeGreaterThanOrEqual(1);
    }
  });

  it('never times more than a batch of 24 at once, and one at a time on a slow chip', async () => {
    const quick = fakeChip(1);
    const timedQuick = await timeFrames(quick.timer(2700));
    expect(timedQuick.frames / timedQuick.perFrame.length).toBeLessThanOrEqual(BATCH_FRAMES);
    expect(timedQuick.frames).toBeGreaterThan(BATCH_FRAMES);
    const slow = fakeChip(400);
    const timedSlow = await timeFrames(slow.timer(2700));
    expect(timedSlow.frames).toBe(timedSlow.perFrame.length);
  });

  it('stops at the frame limit on a chip that is too quick to count', async () => {
    const chip = fakeChip(0.001, 0);
    const timed = await timeFrames({ ...chip.timer(60_000), maximumFrames: 100 });
    expect(timed.frames).toBe(100);
  });
});

describe('the ladder on the clock of the run', () => {
  it('places a change at the frame the ladder stamped it on', () => {
    // 60 frames at 60 a second from t = 1000 ms. The ladder had seen 7 s before; it changed when it had seen 7.5 s.
    const frames = Array.from({ length: 60 }, (_, index) => ({ at: 1000 + index * (1000 / 60), seconds: 1 / 60 }));
    const [placed] = placeLadderChanges([{ at: 7.5, from: 0, to: 3 }], 7, frames, 1000);
    expect(placed.from).toBe(0);
    expect(placed.to).toBe(3);
    expect(placed.seconds).toBeCloseTo(0.5 - 1 / 60, 2);
  });

  it('gives the rung at the end of each span', () => {
    const changes = [{ seconds: 5.2, from: 0, to: 3 }, { seconds: 15.3, from: 3, to: 6 }];
    expect(rungBySpan(0, changes, 2, 10)).toEqual([0, 0, 3, 3, 3, 3, 3, 6, 6, 6]);
    expect(rungBySpan(2, [], 2, 3)).toEqual([2, 2, 2]);
  });
});

const SAMPLE: ReadoutData = {
  build: '0d3a8fd (2026-11-11), built',
  three: '187',
  when: 'Thu Nov 12 2026 07:14:02 GMT-0500',
  tookSeconds: 30.4,
  switches: [],
  environment: {
    chip: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    chipMaker: 'Google Inc. (Intel)',
    softwareDrawing: false,
    browser: 'Google Chrome 142',
    system: 'Windows (version 15.0.0, x86 64-bit)',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    processors: 8,
    memoryGigabytes: 8,
    power: 'on battery',
    windowWidth: 1366, windowHeight: 657, screenWidth: 1366, screenHeight: 768, density: 1,
    canvasWidth: 1366, canvasHeight: 657,
    webgl: {
      version: 'WebGL 2.0 (OpenGL ES 3.0 Chromium)', largestTexture: 16384, largestBuffer: 16384, samples: 16, targetsAtOnce: 8,
      floatTargets: true, halfFloatTargets: true, precisionBits: 23, powerPreference: 'high-performance',
    },
  },
  refresh: { hertz: 60.02, milliseconds: 16.66 },
  capAllows: 60,
  worldWidth: 1366,
  worldHeight: 657,
  watched: {
    seconds: 20, preset: 'High', cap: 60, spanSeconds: 2,
    framesPerSecond: [24, 23, 25, 31, 30, 32, 31, 30, 38, 37],
    rungs: [0, 0, 3, 3, 3, 3, 3, 6, 6, 6],
    average: 30.1,
    changes: [{ seconds: 5.2, from: 0, to: 3 }, { seconds: 15.3, from: 3, to: 6 }],
    endRung: 6,
    shed: 'shed: weather detail off, reflections 67%, fine strokes off, pen anti-aliasing 1×',
    frameTimes: { count: 601, middle: 33.3, p95: 50, p99: 66.7, worst: 116.7, over33: 318, over50: 22 },
    script: { count: 602, middle: 2.4, p95: 4.1, p99: 6, worst: 11.2 , over33: 0, over50: 0 },
    drawCalls: 212,
    triangles: 368689,
  },
  costs: [
    { name: 'Top quality', preset: 'High', rung: 0, milliseconds: 41.2, quickest: 39.8, slowest: 44, frames: 61, worldWidth: 1366, worldHeight: 657 },
    { name: 'Lowest rung', preset: 'High', rung: 9, milliseconds: 19.6, quickest: 19.1, slowest: 21, frames: 130, worldWidth: 983, worldHeight: 473 },
    { name: 'Low preset', preset: 'Low', rung: 0, milliseconds: 12.3, quickest: 12, slowest: 13.5, frames: 205, worldWidth: 1024, worldHeight: 492 },
  ],
  notes: [],
};

/** Every line the brief asks for, by the words it starts with. */
const FIELDS = [
  'PORTAGE PERFORMANCE READOUT', 'Build: ', 'Run: ', 'Graphics chip: ', 'Chip maker: ', 'Drawn by software, not a chip: ', 'Browser: ',
  'Processors: ', 'Window: ', 'Canvas: ', 'Screen refresh: ', 'WebGL: ', 'WebGL limits: ', 'WebGL extras: ',
  'THE GAME BY ITSELF', 'Frames a second, every 2 s: ', 'Ladder rung, every 2 s: ', 'Average: ', 'Ladder: ', 'Time between frames: middle ',
  'Frames over 33 ms: ', "The page's own script in a frame: ", 'One frame: ',
  'HONEST COST OF ONE FRAME', 'Top quality (', 'Lowest rung (', 'Low preset (', 'IN SHORT', 'To hold ', 'By itself the game ran at ', 'Notes: ',
  "Browser's full name: ",
];

describe('the words of the readout', () => {
  const text = formatReadout(SAMPLE);
  const lines = text.split('\n');

  it('has every field, each on a line of its own', () => {
    for (const field of FIELDS) expect(lines.some((line) => line.startsWith(field)), `no line starts with "${field}"`).toBe(true);
    for (const part of ['Memory: 8 GB or more', 'Power: on battery', 'Screen: 1366 x 768', 'Screen density: 1.', 'World drawn at 1366 x 657', '60 Hz, measured',
      '95th 50.0 ms', '99th 66.7 ms', 'worst 117 ms', '318 of 601', 'Over 50 ms: 22', '5.2 s rung 0 to 3', 'Ended on rung 6', 'Most the cap lets through on this screen: 60',
      '0d3a8fd (2026-11-11), built']) {
      expect(text, part).toContain(part);
    }
  });

  it('stays under 60 lines, and says so in plain words', () => {
    expect(lines.length).toBeLessThan(60);
    expect(text).toContain('To hold 60 a second a frame may take 16.7 ms.');
    expect(text).toContain('Top quality: 41.2 ms, too slow. Lowest rung: 19.6 ms, too slow. Low preset: 12.3 ms, fits.');
    expect(text).toContain('By itself the game ran at 30 a second and ended on rung 6.');
    expect(text).toContain('Notes: none.');
  });

  it('says "hidden" for a chip the browser keeps back, and still fits when everything is missing', () => {
    const bare = formatReadout({
      ...SAMPLE,
      environment: { ...SAMPLE.environment, chip: 'hidden', chipMaker: 'hidden', processors: null, memoryGigabytes: null, power: 'not told', webgl: null },
      refresh: null, capAllows: null, watched: null, costs: [],
      notes: ['The readout stopped early: no graphics.', 'The tab was hidden for part of the run.'],
    });
    expect(bare).toContain('Graphics chip: hidden');
    expect(bare).toContain('Processors: not told. Memory: not told. Power: not told.');
    expect(bare).toContain('Screen refresh: could not be measured.');
    expect(bare).toContain('Notes: The readout stopped early: no graphics. The tab was hidden for part of the run.');
    expect(bare.split('\n').length).toBeLessThan(60);
  });

  it('names a test switch, so a test run is never mistaken for a real one', () => {
    expect(formatReadout({ ...SAMPLE, switches: ['bench=2'] })).toContain('test switches: bench=2');
    expect(text).toContain('test switches: none');
  });

  it('calls a frame that only just fits what it is', () => {
    expect(fitOf(10, 16.7)).toBe('fits');
    expect(fitOf(15.5, 16.7)).toBe('only just fits');
    expect(fitOf(16.8, 16.7)).toBe('too slow');
  });

  it('names the browser, the system and a software renderer', () => {
    const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
    expect(describeBrowser(chrome)).toBe('Chrome 142');
    expect(describeBrowser(`${chrome} Edg/142.0.0.0`)).toBe('Edge 142');
    expect(describeBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0')).toBe('Firefox 144');
    expect(describeBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15')).toBe('Safari 26');
    expect(describeBrowser(chrome, [{ brand: 'Not?A_Brand', version: '99' }, { brand: 'Chromium', version: '142' }, { brand: 'Microsoft Edge', version: '142' }])).toBe('Microsoft Edge 142');
    expect(describeBrowser('something else')).toBe('not told');
    expect(describeSystem(chrome)).toBe('Windows');
    expect(describeSystem('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('macOS');
    expect(describeSystem('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Linux');
    expect(isSoftwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)')).toBe(true);
    expect(isSoftwareRenderer('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(true);
    expect(isSoftwareRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(false);
  });
});

describe('the readout keeps to itself', () => {
  it('finds its sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(5);
    expect(mainSource.length).toBeGreaterThan(1000);
  });

  it('has no way to send anything, store anything or run text as code', () => {
    const forbidden: [RegExp, string][] = [
      [/\bfetch\b/, 'fetch'], [/\bXMLHttpRequest\b/, 'XMLHttpRequest'], [/\bsendBeacon\b/, 'sendBeacon'], [/\bWebSocket\b/, 'WebSocket'],
      [/\bEventSource\b/, 'EventSource'], [/\bRTCPeerConnection\b/, 'RTCPeerConnection'], [/\bBroadcastChannel\b/, 'BroadcastChannel'],
      [/\blocalStorage\b/, 'localStorage'], [/\bsessionStorage\b/, 'sessionStorage'], [/\bindexedDB\b/, 'indexedDB'], [/\bcookie\b/, 'cookie'],
      [/\bcaches\b/, 'caches'], [/\beval\b/, 'eval'], [/\bnew Function\b/, 'new Function'], [/\binnerHTML\b/, 'innerHTML'],
      [/\bupdateSettings\b/, 'updateSettings'], [/\bsaveNow\b/, 'saveNow'], [/\bnewGame\b/, 'newGame'],
    ];
    for (const [path, source] of Object.entries(sources)) {
      const stripped = code(source);
      for (const [pattern, name] of forbidden) expect(pattern.test(stripped), `${path} uses ${name}`).toBe(false);
    }
  });

  it('is loaded by main.ts only when asked for, and only into a storage that forgets', () => {
    const stripped = mainSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    // Never a plain import: that would put the readout in every player's first download.
    expect(/^import[^;]*perf\//m.test(stripped)).toBe(false);
    expect(stripped).toMatch(/if \(perf\) void import\('\.\/client\/perf\/readout\.ts'\)/);
    expect(stripped).toMatch(/storage: parameters\.sandbox \|\| perf \? createMemoryStorage\(\) : browserStorage\(\)/);
  });
});
