/**
 * The lab's self-test: render sounds through an OfflineAudioContext and
 * measure them. Offline rendering needs no user gesture, runs faster than real
 * time and gives the exact peak of every sample, which a live meter cannot.
 *
 * The context has four channels. The engine's stereo output lands in channels
 * 0 and 1; a tap on the master bus, before the limiter, is routed to channels
 * 2 and 3. One render gives both the level the limiter was handed and the
 * level that left it.
 */
import { createDefaultSettings } from '../../settings/index.ts';
import type { GameEvent } from '../../sim/index.ts';
import { createEngineCore } from '../engine.ts';
import type { AudioScene, AudioVolumes } from '../engine.ts';
import { SOFT_CLIP_CEILING } from '../graph.ts';
import { INTERFACE_SOUND_NAMES } from '../interface-sounds.ts';
import { LAB_SOUNDS, LAYER_ROWS, MUSIC_ROWS, WORLD_PRESETS, cueSeconds } from './catalogue.ts';

export type Core = ReturnType<typeof createEngineCore>;

export const SELF_TEST_SAMPLE_RATE = 44100;
const SELF_TEST_SEED = 20261110;
/** How often the offline render stops to let the engine schedule, seconds. */
const DRIVE_STEP = 0.05;
/** Room left after a cue for the reverb to finish. */
const TAIL_SECONDS = 2.8;
/**
 * Silence rendered before anything plays. A browser's compressor dips for the
 * first few milliseconds after a context starts; in the game the context has
 * been running long before any cue, so the test must not start on that dip.
 */
const PREROLL_SECONDS = 0.25;

export interface Measurement {
  /** Largest sample that left the engine, 0 to 1. */
  outputPeak: number;
  /** Largest sample on the master bus, before the limiter. */
  masterPeak: number;
  /** Root-mean-square of the output over the measured window. */
  outputRms: number;
  /** Seconds until the output last rose above -66 dBFS. */
  soundingSeconds: number;
}

export interface SelfTestRow {
  section: 'One-shots' | 'Interface' | 'Continuous layers' | 'Music' | 'Worst case';
  label: string;
  /** What the row was rendered at. */
  volumes: 'default' | 'full';
  measurement: Measurement | null;
  /** Why there is no measurement. */
  failure: string | null;
  verdict: 'ok' | 'quiet' | 'silent' | 'hot' | 'failed';
  note: string;
}

export const DEFAULT_VOLUMES: AudioVolumes = { ...createDefaultSettings().audio };
const FULL_VOLUMES: AudioVolumes = { master: 1, music: 1, effects: 1, ambience: 1 };

/** Decibels relative to full scale. */
export function toDecibels(level: number): number {
  return level > 0 ? 20 * Math.log10(level) : Number.NEGATIVE_INFINITY;
}

export function formatDecibels(level: number): string {
  const decibels = toDecibels(level);
  return Number.isFinite(decibels) ? decibels.toFixed(1) : '-inf';
}

interface RenderPlan {
  seconds: number;
  volumes: AudioVolumes;
  scene: AudioScene;
  /** Runs once, after the pre-roll. */
  prepare(engine: Core): void;
  /** Runs every `DRIVE_STEP` of rendered time, like a frame. */
  drive?(engine: Core, time: number): void;
  /** Ignore everything before this, so a bed is measured once it has settled. */
  measureFrom?: number;
}

export function offlineRenderingAvailable(): boolean {
  return typeof OfflineAudioContext === 'function';
}

async function render(plan: RenderPlan): Promise<Measurement> {
  const seconds = plan.seconds + PREROLL_SECONDS;
  const frames = Math.ceil(seconds * SELF_TEST_SAMPLE_RATE);
  const context = new OfflineAudioContext(4, frames, SELF_TEST_SAMPLE_RATE);
  const engine = createEngineCore({
    contextFactory: () => context as unknown as AudioContext, seed: SELF_TEST_SEED, autoTick: false,
    followPageVisibility: false,
  });
  engine.setVolumes(plan.volumes);
  engine.setScene(plan.scene);
  await engine.unlock();
  const nodes = engine.inspector.nodes();
  if (!nodes) throw new Error('The engine did not build on the offline context');

  const splitter = context.createChannelSplitter(2);
  const merger = context.createChannelMerger(4);
  nodes.master.connect(splitter);
  splitter.connect(merger, 0, 2);
  splitter.connect(merger, 1, 3);
  merger.connect(context.destination);

  void context.suspend(PREROLL_SECONDS).then(() => {
    plan.prepare(engine);
    void context.resume();
  });
  const { drive } = plan;
  if (drive) {
    for (let time = DRIVE_STEP; time < plan.seconds - DRIVE_STEP; time += DRIVE_STEP) {
      void context.suspend(PREROLL_SECONDS + time).then(() => {
        drive(engine, time);
        engine.inspector.tick();
        void context.resume();
      });
    }
  }
  const rendered = await context.startRendering();
  engine.dispose();
  merger.disconnect();
  splitter.disconnect();

  const first = Math.min(frames, Math.floor((PREROLL_SECONDS + (plan.measureFrom ?? 0)) * SELF_TEST_SAMPLE_RATE));
  let outputPeak = 0;
  let masterPeak = 0;
  let sumOfSquares = 0;
  let lastSounding = 0;
  const channels = [0, 1, 2, 3].map((channel) => rendered.getChannelData(channel));
  for (let index = first; index < frames; index += 1) {
    const left = Math.abs(channels[0][index]);
    const right = Math.abs(channels[1][index]);
    const loudest = left > right ? left : right;
    if (loudest > outputPeak) outputPeak = loudest;
    if (loudest > 0.0005) lastSounding = index;
    sumOfSquares += (left * left + right * right) / 2;
    const tapLeft = Math.abs(channels[2][index]);
    const tapRight = Math.abs(channels[3][index]);
    if (tapLeft > masterPeak) masterPeak = tapLeft;
    if (tapRight > masterPeak) masterPeak = tapRight;
  }
  return {
    outputPeak, masterPeak,
    outputRms: Math.sqrt(sumOfSquares / Math.max(1, frames - first)),
    soundingSeconds: Math.max(0, lastSounding / SELF_TEST_SAMPLE_RATE - PREROLL_SECONDS),
  };
}

/** Only one bus up, the others closed, so a row measures one thing. */
const only = (bus: 'music' | 'effects' | 'ambience', volumes: AudioVolumes): AudioVolumes => ({
  master: volumes.master,
  music: bus === 'music' ? volumes.music : 0,
  effects: bus === 'effects' ? volumes.effects : 0,
  ambience: bus === 'ambience' ? volumes.ambience : 0,
});

interface PlannedRow {
  section: SelfTestRow['section'];
  label: string;
  volumes: 'default' | 'full';
  plan: RenderPlan;
  /** A bed or a piece of music: judged on steady level, not on a single peak. */
  sustained: boolean;
}

const burstEvents: GameEvent[] = LAB_SOUNDS.flatMap((sound) => (sound.event ? [sound.event] : []));

function planRows(): PlannedRow[] {
  const rows: PlannedRow[] = [];

  for (const sound of LAB_SOUNDS) {
    rows.push({
      section: 'One-shots', label: `${sound.group}: ${sound.label}`, volumes: 'default', sustained: false,
      plan: {
        seconds: cueSeconds(sound.request) + TAIL_SECONDS, volumes: only('effects', DEFAULT_VOLUMES), scene: 'game',
        prepare(engine) {
          if (sound.event) engine.handleEvents([sound.event]);
          else engine.inspector.playCue(sound.request);
        },
      },
    });
  }

  for (const sound of INTERFACE_SOUND_NAMES) {
    rows.push({
      section: 'Interface', label: sound, volumes: 'default', sustained: false,
      plan: {
        seconds: 1.5, volumes: only('effects', DEFAULT_VOLUMES), scene: 'paused',
        prepare: (engine) => engine.playInterface(sound),
      },
    });
  }

  for (const row of LAYER_ROWS) {
    rows.push({
      section: 'Continuous layers', label: row.label, volumes: 'default', sustained: true,
      plan: {
        seconds: row.seconds, scene: 'game', measureFrom: 4,
        // Foley (strokes, footsteps, bailing) is on the effects bus: keep it in.
        volumes: { ...DEFAULT_VOLUMES, music: 0 },
        prepare: (engine) => engine.inspector.applyLayerInputs(row.inputs, 0),
        drive: (engine) => engine.inspector.applyLayerInputs(row.inputs, DRIVE_STEP),
      },
    });
  }

  for (const row of MUSIC_ROWS) {
    rows.push({
      section: 'Music', label: row.label, volumes: 'default', sustained: true,
      plan: {
        seconds: row.seconds, scene: row.scene, volumes: only('music', DEFAULT_VOLUMES),
        prepare(engine) {
          if (row.inputs) engine.inspector.applyLayerInputs(row.inputs, 0);
          if (row.finale) engine.handleEvents([{ type: 'game_completed' }]);
        },
        // Music needs ticking but no new inputs: an empty drive gives it the ticks.
        drive: () => undefined,
      },
    });
  }

  const storm = WORLD_PRESETS.find((preset) => preset.label === 'Storm in the Narrows') ?? WORLD_PRESETS[0];
  for (const volumes of ['default', 'full'] as const) {
    rows.push({
      section: 'Worst case', volumes, sustained: true,
      label: 'Storm, power strokes, finale, every event every 1.5 s, menu clicks',
      plan: {
        seconds: 24, scene: 'game', volumes: volumes === 'full' ? FULL_VOLUMES : DEFAULT_VOLUMES,
        prepare(engine) {
          engine.inspector.applyLayerInputs(storm.inputs, 0);
          engine.handleEvents(burstEvents);
        },
        drive(engine, time) {
          engine.inspector.applyLayerInputs(storm.inputs, DRIVE_STEP);
          const step = Math.round(time / DRIVE_STEP);
          if (step % 30 === 0) engine.handleEvents(burstEvents);
          if (step % 4 === 0) engine.playInterface(step % 8 === 0 ? 'click' : 'error');
        },
      },
    });
  }
  return rows;
}

/** Output must stay under this to be called clean (-1 dBFS). */
const HOT_PEAK = 10 ** (-1 / 20);

function judge(planned: PlannedRow, measurement: Measurement): Pick<SelfTestRow, 'verdict' | 'note'> {
  if (planned.section === 'Worst case') {
    // Meant to overload the mix: it passes when the output still cannot pass the soft clipper's ceiling.
    const held = measurement.outputPeak <= SOFT_CLIP_CEILING + 0.001;
    return {
      verdict: held ? 'ok' : 'hot',
      note: `limiter fed ${formatDecibels(measurement.masterPeak)} dBFS, output held to ${formatDecibels(measurement.outputPeak)}`,
    };
  }
  if (measurement.outputPeak >= HOT_PEAK) return { verdict: 'hot', note: 'output within 1 dB of full scale' };
  if (measurement.outputPeak < 0.0005) return { verdict: 'silent', note: 'nothing above -66 dBFS' };
  const quietBelow = planned.sustained ? toDecibels(measurement.outputRms) < -60 : toDecibels(measurement.outputPeak) < -40;
  if (quietBelow) return { verdict: 'quiet', note: 'may be too faint to hear' };
  // At full volume the master is 7.8 dB hotter than at the default settings.
  const atFull = planned.volumes === 'full' ? measurement.masterPeak : measurement.masterPeak * (1 / 0.64 / 0.64);
  return { verdict: 'ok', note: atFull > 0.7 ? 'reaches the limiter with every slider at full' : '' };
}

/** Renders running at once. Each offline context renders on its own thread. */
const CONCURRENT_RENDERS = 4;

async function measureRow(row: PlannedRow): Promise<SelfTestRow> {
  try {
    const measurement = await render(row.plan);
    return {
      section: row.section, label: row.label, volumes: row.volumes, measurement, failure: null,
      ...judge(row, measurement),
    };
  } catch (error) {
    return {
      section: row.section, label: row.label, volumes: row.volumes, measurement: null,
      failure: error instanceof Error ? error.message : String(error), verdict: 'failed', note: '',
    };
  }
}

/**
 * Render every row. `onRow` is called in table order as rows finish, so the
 * page can fill its table while the test runs.
 */
export async function runSelfTest(onRow: (row: SelfTestRow, done: number, total: number) => void): Promise<SelfTestRow[]> {
  const planned = planRows();
  const results: (SelfTestRow | undefined)[] = new Array<SelfTestRow | undefined>(planned.length);
  let nextToStart = 0;
  let nextToReport = 0;
  const worker = async (): Promise<void> => {
    while (nextToStart < planned.length) {
      const index = nextToStart;
      nextToStart += 1;
      results[index] = await measureRow(planned[index]);
      for (let row = results[nextToReport]; row !== undefined; row = results[nextToReport]) {
        nextToReport += 1;
        onRow(row, nextToReport, planned.length);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENT_RENDERS }, worker));
  return results.filter((row): row is SelfTestRow => row !== undefined);
}
