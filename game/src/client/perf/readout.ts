/**
 * The performance readout, `?perf=1`: one link a player opens, waits half a
 * minute, and pastes the text back, so we learn what their computer does with
 * the game. `main.ts` asks for it only when the switch is there. It rides in
 * the debug chunk (`client/debug/index.ts`), which a normal game never loads.
 *
 * It plays one staged view, the same for everyone, with nobody at the keys:
 *
 * 1. the screen's refresh rate, from its own frame calls with nothing drawn;
 * 2. the honest cost of one frame, held still: top quality, the ladder's last
 *    rung, the Low preset. Frames back to back, each waited for (LOOK.md,
 *    "What a frame costs");
 * 3. the game by itself, default settings, on its own frame loop for twenty
 *    seconds: frames a second, the ladder, the spread of frame times.
 *
 * Every stage ends by the clock, so a slow chip draws fewer frames and the
 * run is no longer. Nothing is sent and nothing is stored: `main.ts` gives
 * the session a storage that forgets, and no setting is changed.
 */
import { REVISION } from 'three';
import { BOT_SEED } from '../../bot/bot.ts';
import { LADDER } from '../../look/quality.ts';
import type { LookProbe } from '../../look/world-view.ts';
import { NEUTRAL_INPUT } from '../../sim/index.ts';
import type { StepInput } from '../../sim/index.ts';
import { applyQualityPreset, createDefaultSettings } from '../../settings/index.ts';
import type { App } from '../app.ts';
import type { FrameInfo, WorldView } from '../contracts.ts';
import { stageShot } from '../debug/staging.ts';
import { createFrameLoop } from '../loop.ts';
import type { FrameLoop } from '../loop.ts';
import { readEnvironment } from './environment.ts';
import { createReadoutPanel } from './panel.ts';
import { cappedFrameMilliseconds, framesPerSecondBySpan, gapsBetween, median, placeLadderChanges, rungBySpan, spreadOf, timeFrames } from './stats.ts';
import type { LoopFrame } from './stats.ts';
import { formatReadout } from './text.ts';
import type { FrameCost, ReadoutData, WatchedRun } from './text.ts';

/** The build this is, stamped by `vite.config.ts`: commit, its date, and whether it is a dev server or a build. */
declare const __PORTAGE_BUILD__: string | undefined;

/** The plan, in seconds. It adds up to the "of 30 seconds" on the card. */
const REFRESH_SECONDS = 0.8;
const COST_SECONDS = 2.7;
const RUN_IN_SECONDS = 1;
const WATCH_SECONDS = 20;
const SPAN_SECONDS = 2;
const PLAN_SECONDS = Math.round(REFRESH_SECONDS + 3 * COST_SECONDS + RUN_IN_SECONDS + WATCH_SECONDS);
/** Whatever happens, the measuring stops here: each stage gets what is left. */
const HARD_LIMIT_SECONDS = 52;

/** The look's own switches that change the numbers. Named in the text so a test run is never mistaken for a real one. */
const LOOK_SWITCHES = ['bench', 'benchpass', 'stall', 'rung', 'hold', 'hero', 'look'];

/** The world view's test hooks, when it is the Ink & Wash one. */
interface Probed {
  probe?(): LookProbe;
  renderStats?(): { drawCalls: number; triangles: number };
}

export interface ReadoutResult {
  done: boolean;
  text: string;
  data: ReadoutData | null;
}

const seconds = (milliseconds: number): number => milliseconds / 1000;

/** One screen refresh, or a tenth of a second if the tab is hidden and none comes. */
const nextRefresh = (): Promise<number> => new Promise((resolve) => {
  const timer = window.setTimeout(() => resolve(performance.now()), 100);
  window.requestAnimationFrame((timestamp) => {
    window.clearTimeout(timer);
    resolve(timestamp);
  });
});

/** The screen's refresh, from its own frame calls while nothing is drawn. */
async function measureRefresh(milliseconds: number): Promise<{ hertz: number; milliseconds: number } | null> {
  const moments: number[] = [];
  const until = performance.now() + milliseconds;
  while (performance.now() < until) moments.push(await nextRefresh());
  // The first gap follows whatever the page was doing before.
  const gaps = gapsBetween(moments).slice(1);
  if (gaps.length < 5) return null;
  const middle = median(gaps);
  return middle > 0 ? { hertz: 1000 / middle, milliseconds: middle } : null;
}

export async function runPerfReadout(app: App, worldView: WorldView, gameLoop: FrameLoop | null): Promise<ReadoutResult> {
  const result: ReadoutResult = { done: false, text: '', data: null };
  (window as unknown as { portagePerf: ReadoutResult }).portagePerf = result;

  const startedAt = performance.now();
  const hardLimit = startedAt + HARD_LIMIT_SECONDS * 1000;
  const session = app.session;
  const look = worldView as WorldView & Probed;
  const defaults = createDefaultSettings();
  const notes: string[] = [];
  const panel = createReadoutPanel();
  // From here the readout runs the frames. The game's own loop rests.
  gameLoop?.stop();

  // The card counts the plan's seconds, not the clock's: a stage that ends early moves it on.
  let planned = 0;
  let stageStartedAt = startedAt;
  let stageSeconds = 0;
  const showProgress = (): void => {
    const within = Math.min(stageSeconds, seconds(performance.now() - stageStartedAt));
    panel.progress(`Measuring, ${Math.min(PLAN_SECONDS, Math.floor(planned + within))} of ${PLAN_SECONDS} seconds`);
  };
  const beginStage = (length: number): number => {
    planned += stageSeconds;
    stageSeconds = length;
    stageStartedAt = performance.now();
    showProgress();
    // What this stage may really take: its share, or what the hard limit leaves.
    return Math.max(0, Math.min(length * 1000, hardLimit - stageStartedAt));
  };
  const progressTimer = window.setInterval(showProgress, 250);

  // A hidden tab gets no frames and a resized one changes the work: either spoils the numbers.
  let hidden = document.hidden;
  const sawHidden = (): void => {
    hidden ||= document.hidden;
  };
  document.addEventListener('visibilitychange', sawHidden);
  const sizeAtStart = `${window.innerWidth} x ${window.innerHeight}`;

  // The game's own canvas and graphics context: asking again hands back the same one.
  const canvas = document.querySelector<HTMLCanvasElement>('#world canvas');
  const gl = canvas?.getContext('webgl2') ?? null;
  const pixel = new Uint8Array(4);
  const finish = (): void => gl?.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  if (!gl) notes.push('The graphics context could not be reached, so no frame was waited for: the honest costs are script time only.');

  const data: ReadoutData = {
    build: typeof __PORTAGE_BUILD__ === 'string' ? __PORTAGE_BUILD__ : 'unknown',
    three: REVISION,
    when: new Date().toString().replace(/ \(.*\)$/, ''),
    tookSeconds: 0,
    switches: LOOK_SWITCHES.flatMap((name) => {
      const value = new URLSearchParams(window.location.search).get(name);
      return value === null ? [] : [`${name}=${value}`];
    }),
    environment: await readEnvironment(gl),
    refresh: null,
    capAllows: null,
    worldWidth: 0,
    worldHeight: 0,
    watched: null,
    costs: [],
    notes,
  };

  try {
    // --- 1. The screen ----------------------------------------------------------
    data.refresh = await measureRefresh(beginStage(REFRESH_SECONDS));

    // --- The staged view: afloat off Home Knoll, a clear morning, held still --------
    const shot = stageShot('play', BOT_SEED);
    if (!shot.state) throw new Error('the staged view has no game');
    const state = shot.state;
    session.adoptGame(state);
    session.frozen = true;
    // One frame snaps the camera behind the canoe.
    app.frame(0);
    const still = (): void => app.frame(0);
    // A change of graphics settings starts the ladder over. Two changes land back on the defaults, on rung 0.
    const startLadderOver = (): void => {
      worldView.applyGraphicsSettings({ ...defaults.graphics, showFps: !defaults.graphics.showFps });
      worldView.applyGraphicsSettings(defaults.graphics);
    };

    // --- 2. The honest cost of one frame ------------------------------------------
    const cost = async (name: string, preset: string): Promise<void> => {
      const timed = await timeFrames({ draw: still, finish, now: () => performance.now(), rest: async () => void await nextRefresh(), budgetMilliseconds: beginStage(COST_SECONDS) });
      const drawn = look.probe?.();
      const made: FrameCost = {
        name, preset,
        rung: drawn?.rung ?? 0,
        milliseconds: median(timed.perFrame),
        quickest: Math.min(...timed.perFrame),
        slowest: Math.max(...timed.perFrame),
        frames: timed.frames,
        worldWidth: drawn?.drawingWidth ?? 0,
        worldHeight: drawn?.drawingHeight ?? 0,
      };
      data.costs.push(made);
    };

    startLadderOver();
    await cost('Top quality', 'High');
    data.worldWidth = data.costs[0].worldWidth;
    data.worldHeight = data.costs[0].worldHeight;
    const frameStats = look.renderStats?.() ?? null;

    // The ladder's last rung. The ladder only moves on the frame times it is told, so it is told slow ones,
    // with nothing drawn, until it has stepped all the way down. Then the settings change that follows starts it over.
    if (look.probe) {
      const slow: FrameInfo = { frameSeconds: 0.1, simulatedSeconds: 0, elapsedSeconds: 0, paused: true, panelOpen: false, trackedQuestTarget: null };
      const lastRung = LADDER.length - 1;
      const giveUpAt = performance.now() + 1500;
      for (let told = 1; look.probe().rung < lastRung && told <= 200 && performance.now() < giveUpAt; told += 1) {
        for (let frame = 0; frame < 20; frame += 1) worldView.sync(state, slow);
      }
      if (look.probe().rung < lastRung) notes.push(`The ladder would not go below rung ${look.probe().rung}.`);
    }
    await cost('Lowest rung', 'High');

    worldView.applyGraphicsSettings(applyQualityPreset(defaults, 'low').graphics);
    await cost('Low preset', 'Low');

    // --- 3. The game by itself ------------------------------------------------------
    startLadderOver();
    const before = look.probe?.() ?? null;
    // Somebody has to paddle: a steady stroke with the paddle held a little over, so the canoe goes round in a wide
    // circle and the view sweeps the island, the far shore and the open water. The same strokes for everyone.
    const stroke: StepInput = { ...NEUTRAL_INPUT, paddle: 1, steer: 0.35 };
    session.frozen = false;
    session.attachDriver({ next: () => stroke });

    const runInMilliseconds = beginStage(RUN_IN_SECONDS + WATCH_SECONDS) * (RUN_IN_SECONDS / (RUN_IN_SECONDS + WATCH_SECONDS));
    const watchMilliseconds = Math.max(0, Math.min(WATCH_SECONDS * 1000, hardLimit - performance.now() - runInMilliseconds));
    const frames: (LoopFrame & { script: number })[] = [];
    let screenAsked = performance.now();
    const beganAt = screenAsked;
    const watchFrom = beganAt + runInMilliseconds;
    const watchUntil = watchFrom + watchMilliseconds;
    await new Promise<void>((resolve) => {
      // The game's own loop, with its own cap, over the game's own frame. Only the note-taking is added.
      const loop = createFrameLoop({
        clock: {
          requestFrame: (callback) => window.requestAnimationFrame((timestamp) => {
            screenAsked = timestamp;
            callback(timestamp);
          }),
          cancelFrame: (handle) => window.cancelAnimationFrame(handle),
          now: () => performance.now(),
        },
        frame: (frameSeconds) => {
          const began = performance.now();
          app.frame(frameSeconds);
          frames.push({ at: screenAsked, seconds: frameSeconds, script: performance.now() - began });
          if (screenAsked >= watchUntil) end();
        },
        frameRateCap: () => session.settings.graphics.fpsCap,
      });
      // A hidden tab gets no frames at all: the clock ends the stage then.
      const timer = window.setTimeout(() => end(), runInMilliseconds + watchMilliseconds + 1500);
      const end = (): void => {
        window.clearTimeout(timer);
        loop.stop();
        resolve();
      };
      loop.start();
    });
    session.attachDriver(null);
    session.frozen = true;

    const after = look.probe?.() ?? null;
    const watchedFrames = frames.filter((frame) => frame.at >= watchFrom && frame.at <= watchUntil + 1000);
    const moments = watchedFrames.map((frame) => frame.at);
    const spans = Math.max(1, Math.round(seconds(watchMilliseconds) / SPAN_SECONDS));
    const fresh = after && before ? after.ladder.changes.slice(before.ladder.changes.length) : [];
    const changes = placeLadderChanges(fresh, before?.ladder.seconds ?? 0, frames, watchFrom);
    const cap = session.settings.graphics.fpsCap;
    const watched: WatchedRun = {
      seconds: seconds(watchMilliseconds),
      preset: 'High',
      cap,
      spanSeconds: SPAN_SECONDS,
      framesPerSecond: framesPerSecondBySpan(moments, watchFrom, SPAN_SECONDS * 1000, spans),
      rungs: rungBySpan(before?.rung ?? 0, changes, SPAN_SECONDS, spans),
      average: moments.length > 1 ? (moments.length - 1) / seconds(moments[moments.length - 1] - moments[0]) : 0,
      changes,
      endRung: after?.rung ?? 0,
      shed: after?.shed ?? 'not told',
      frameTimes: spreadOf(gapsBetween(moments)),
      script: spreadOf(watchedFrames.map((frame) => frame.script)),
      drawCalls: frameStats?.drawCalls ?? null,
      triangles: frameStats?.triangles ?? null,
    };
    data.watched = watched;
    if (data.refresh) data.capAllows = 1000 / cappedFrameMilliseconds(data.refresh.milliseconds, cap);
    if (JSON.stringify(session.settings.graphics) !== JSON.stringify(defaults.graphics)) notes.push('The settings were not the defaults.');
    if (watchMilliseconds < WATCH_SECONDS * 1000 - 1) notes.push('The run was cut short to stay under a minute.');
  } catch (error) {
    notes.push(`The readout stopped early: ${error instanceof Error ? error.message : String(error)}.`);
  }

  window.clearInterval(progressTimer);
  document.removeEventListener('visibilitychange', sawHidden);
  sawHidden();
  if (hidden) notes.push('The tab was hidden for part of the run: the numbers cannot be trusted. Run it again and keep the window in front.');
  if (`${window.innerWidth} x ${window.innerHeight}` !== sizeAtStart) notes.push(`The window changed size during the run (it began at ${sizeAtStart}).`);
  if (data.environment.softwareDrawing) notes.push('The browser is drawing in software. Its graphics acceleration is off, or it has blocked this chip.');
  if (data.switches.length > 0) notes.push('Test switches were on: this is not a plain run.');

  data.tookSeconds = seconds(performance.now() - startedAt);
  result.text = formatReadout(data);
  result.data = data;
  result.done = true;
  panel.finish(result.text, `Done in ${Math.round(data.tookSeconds)} seconds.`);
  return result;
}
