/**
 * The engine itself: the mix, and the wiring between the game and the sound.
 * `src/audio/index.ts` is the public face; read the overview there first.
 *
 * Signal flow:
 *
 *   music voices     -> duck -> scene trim -> music volume    \
 *   effects voices   ->         scene trim -> effects volume   \
 *   interface voices ->                    -> effects volume    +-> master volume -> limiter -> soft clip -> out
 *   ambience voices  -> fog low-pass -> scene trim -> ambience /
 *   and beds                                          volume  /
 *
 * Every stage exists twice, once on the dry path and once on the path into
 * the shared reverb, so a volume slider, a scene change or a duck turns the
 * reverb tail down with the sound that made it.
 */
import { createDefaultSettings } from '../settings/index.ts';
import { playerOf } from '../sim/index.ts';
import type { GameEvent, GameState, PlayerId } from '../sim/index.ts';
import { CUES, resolveEventCue } from './cues.ts';
import type { CueName, CueRequest } from './cues.ts';
import type { AudioGraph } from './graph.ts';
import {
  clamp, createAudioGraph, createReverbImpulse, createSeededRandom, createSmoothedParameter, createSoftClipCurve,
} from './graph.ts';
import { INTERFACE_SOUNDS } from './interface-sounds.ts';
import type { InterfaceSound } from './interface-sounds.ts';
import { CREDITS_INPUTS, LOBBY_INPUTS, createDeriveMemory, createLayers, deriveLayerInputs } from './layers.ts';
import type { LayerInputs, LayerName, Layers } from './layers.ts';
import { createMusic } from './music.ts';
import type { Music } from './music.ts';
import { createVoicePool } from './voices.ts';
import type { BusInput, BusName, VoicePool } from './voices.ts';

export type AudioScene = 'lobby' | 'game' | 'paused' | 'credits';

/** The same four fields as `settings.audio`, each 0 to 1. */
export interface AudioVolumes {
  master: number;
  music: number;
  effects: number;
  ambience: number;
}

export interface AudioEngine {
  unlock(): Promise<void>;
  setVolumes(volumes: AudioVolumes): void;
  handleEvents(events: readonly GameEvent[]): void;
  /** `playerId` is the player this screen follows: the sound is theirs. Player 0 by default. */
  update(state: GameState, frameSeconds: number, playerId?: PlayerId): void;
  playInterface(sound: InterfaceSound): void;
  setScene(scene: AudioScene): void;
  suspend(): void;
  resume(): void;
  dispose(): void;
}

export interface AudioEngineOptions {
  /** Make the context yourself (tests, offline rendering). Default: the browser's AudioContext. */
  contextFactory?: () => AudioContext;
}

/** Extra switches for the lab and the tests. Not part of the public API. */
export interface EngineCoreOptions extends AudioEngineOptions {
  /** Seed for every random choice. Default: the clock. */
  seed?: number;
  /** Run the housekeeping timer. Off for offline rendering, which ticks by hand. */
  autoTick?: boolean;
  /** Suspend while the page is hidden. */
  followPageVisibility?: boolean;
}

type MixBus = 'music' | 'effects' | 'ambience';

/** A slider position to a gain. Squared, so the middle of the slider sounds like half. */
export function volumeToGain(volume: number): number {
  const share = clamp(volume, 0, 1);
  return share * share;
}

/** How each scene balances the buses. Interface sounds are never trimmed. */
export const SCENE_MIX: Record<AudioScene, Record<MixBus, number>> = {
  lobby: { music: 1, effects: 1, ambience: 0.6 },
  game: { music: 0.85, effects: 1, ambience: 1 },
  paused: { music: 0.55, effects: 0.2, ambience: 0.3 },
  credits: { music: 1, effects: 0.6, ambience: 0.4 },
};

/**
 * Fixed trim where voices enter each bus, set from the lab's self-test so
 * that at the default settings a calm scene sits near -28 dBFS RMS, a phrase
 * of music peaks near -18, routine one-shots near -20 and important ones near
 * -12, leaving the limiter idle until a storm at full volume.
 */
export const BUS_CALIBRATION: Record<BusName, number> = { music: 2, effects: 1.4, interface: 1.4, ambience: 1.4 };

/** Music level while a conversation is open. */
export const DIALOGUE_DUCK = 0.45;

/** Seconds a slider or scene change takes to settle (time constant). */
const VOLUME_SMOOTHING = 0.05;
const SCENE_SMOOTHING = 0.35;
const REVERB_SECONDS = 2.4;
const REVERB_RETURN = 0.8;
/** How far ahead grains and notes are scheduled from a frame, and from the timer. */
const FRAME_LOOKAHEAD = 0.12;
const TIMER_LOOKAHEAD = 0.5;
const TIMER_MILLISECONDS = 200;

/** One gain on the dry path and its twin on the reverb path. */
interface Stage {
  dry: GainNode;
  wet: GainNode;
  target: number;
}

/** Nodes the lab and the tests may look at. */
export interface EngineNodes {
  master: GainNode;
  limiter: DynamicsCompressorNode;
  /** The last node before the destination. */
  output: AudioNode;
  /** Volume gain of each bus. */
  buses: Record<MixBus, GainNode>;
  /** Scene trim of each bus. */
  trims: Record<MixBus, GainNode>;
  /** Where voices on each bus enter the mix. */
  inputs: Record<BusName, GainNode>;
  musicDuck: GainNode;
  ambienceTone: BiquadFilterNode;
  layers: Record<LayerName, GainNode>;
}

export interface EngineInspector {
  context(): AudioContext | null;
  nodes(): EngineNodes | null;
  /** Free finished voices and schedule grains and notes. The frame and the timer both call this. */
  tick(lookahead?: number): void;
  /** Drive the layers and the music mood directly, as `update` does from a GameState. */
  applyLayerInputs(inputs: LayerInputs, frameSeconds: number): void;
  playCue(request: CueRequest): boolean;
  voiceCount(bus?: BusName): number;
  voiceLabels(bus?: BusName): string[];
  /** How many voices with this label have started since unlock. */
  voicesStarted(label: string): number;
  musicState(): string;
  layerLevels(): Record<LayerName, number> | null;
  trackedNodeCount(): number;
}

interface Running {
  context: AudioContext;
  graph: AudioGraph;
  pool: VoicePool;
  layers: Layers;
  music: Music;
  nodes: EngineNodes;
  master: Stage;
  volumes: Record<MixBus, Stage>;
  trims: Record<MixBus, Stage>;
  duck: Stage;
}

function browserContextFactory(): (() => AudioContext) | null {
  const scope = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Constructor = scope.AudioContext ?? scope.webkitAudioContext;
  return Constructor ? () => new Constructor({ latencyHint: 'interactive' }) : null;
}

const sanitizeVolume = (value: number, fallback: number): number =>
  (Number.isFinite(value) ? clamp(value, 0, 1) : fallback);

export function createEngineCore(options: EngineCoreOptions = {}): AudioEngine & { readonly inspector: EngineInspector } {
  const random = createSeededRandom(options.seed ?? ((Date.now() ^ 0x9e3779b9) >>> 0));
  const followPageVisibility = options.followPageVisibility !== false && typeof document !== 'undefined';

  let volumes: AudioVolumes = { ...createDefaultSettings().audio };
  let scene: AudioScene = 'lobby';
  let running: Running | null = null;
  let disposed = false;
  let userSuspended = false;
  let pageHidden = followPageVisibility && document.hidden === true;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastState: GameState | null = null;
  let dialogueOpen = false;
  let duckDepth = 0;
  let duckUntil = 0;
  const deriveMemory = createDeriveMemory();
  const lastCueAt: Partial<Record<CueName, number>> = {};
  const lastInterfaceAt: Partial<Record<InterfaceSound, number>> = {};

  // --- Building the graph ----------------------------------------------------------

  const build = (context: AudioContext): Running => {
    const graph = createAudioGraph(context, random);
    const chain = (...nodes: AudioNode[]): void => {
      for (let index = 1; index < nodes.length; index += 1) graph.connect(nodes[index - 1], nodes[index]);
    };
    const stage = (value: number): Stage => ({ dry: graph.gain(value), wet: graph.gain(value), target: value });

    // Master: volume, a gentle limiter, then a soft clipper that cannot be passed.
    const masterGain = graph.gain(volumeToGain(volumes.master));
    const limiter = graph.compressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    const output = graph.shaper(createSoftClipCurve());
    chain(masterGain, limiter, output, context.destination);
    const master: Stage = { dry: masterGain, wet: masterGain, target: volumeToGain(volumes.master) };

    // One small generated room, shared by every bus.
    const reverbInput = graph.gain(1);
    const reverb = graph.convolver(createReverbImpulse(context, REVERB_SECONDS, createSeededRandom(0x2f6e2b1)));
    const reverbReturn = graph.gain(REVERB_RETURN);
    chain(reverbInput, reverb, reverbReturn, masterGain);

    const mix = SCENE_MIX[scene];
    const busVolumes: Record<MixBus, Stage> = {
      music: stage(volumeToGain(volumes.music)),
      effects: stage(volumeToGain(volumes.effects)),
      ambience: stage(volumeToGain(volumes.ambience)),
    };
    const trims: Record<MixBus, Stage> = {
      music: stage(mix.music), effects: stage(mix.effects), ambience: stage(mix.ambience),
    };
    const duck = stage(1);
    const input = (bus: BusName): { dry: GainNode; reverb: GainNode } => ({
      dry: graph.gain(BUS_CALIBRATION[bus]), reverb: graph.gain(BUS_CALIBRATION[bus]),
    });
    const musicInput = input('music');
    const effectsInput = input('effects');
    const interfaceInput = input('interface');
    const ambienceInput = input('ambience');
    const ambienceTone = graph.filter('lowpass', 16000, 0.5);

    chain(musicInput.dry, duck.dry, trims.music.dry, busVolumes.music.dry, masterGain);
    chain(musicInput.reverb, duck.wet, trims.music.wet, busVolumes.music.wet, reverbInput);
    chain(effectsInput.dry, trims.effects.dry, busVolumes.effects.dry, masterGain);
    chain(effectsInput.reverb, trims.effects.wet, busVolumes.effects.wet, reverbInput);
    // Interface sounds ride the effects volume but skip the scene trim: menus stay audible when paused.
    chain(interfaceInput.dry, busVolumes.effects.dry);
    chain(interfaceInput.reverb, busVolumes.effects.wet);
    chain(ambienceInput.dry, ambienceTone, trims.ambience.dry, busVolumes.ambience.dry, masterGain);
    chain(ambienceInput.reverb, trims.ambience.wet, busVolumes.ambience.wet, reverbInput);

    const busInputs: Record<BusName, BusInput> = {
      music: musicInput, effects: effectsInput, interface: interfaceInput, ambience: ambienceInput,
    };
    const pool = createVoicePool(graph, busInputs);
    const layers = createLayers(
      graph, pool, ambienceInput.dry, createSmoothedParameter(context, ambienceTone.frequency, 16000, 1.2),
      (request) => {
        playCue(request);
      },
    );
    const music = createMusic(graph, pool);

    return {
      context, graph, pool, layers, music, master, volumes: busVolumes, trims, duck,
      nodes: {
        master: masterGain, limiter, output,
        buses: { music: busVolumes.music.dry, effects: busVolumes.effects.dry, ambience: busVolumes.ambience.dry },
        trims: { music: trims.music.dry, effects: trims.effects.dry, ambience: trims.ambience.dry },
        inputs: {
          music: musicInput.dry, effects: effectsInput.dry, interface: interfaceInput.dry, ambience: ambienceInput.dry,
        },
        musicDuck: duck.dry, ambienceTone, layers: layers.gains,
      },
    };
  };

  // --- Mix -------------------------------------------------------------------------

  /** Glide both halves of a stage to a new gain. */
  const glide = (active: Running, target: Stage, value: number, timeConstant: number): void => {
    if (Math.abs(value - target.target) < 1e-5) return;
    target.target = value;
    const now = active.graph.now();
    target.dry.gain.setTargetAtTime(value, now, timeConstant);
    if (target.wet !== target.dry) target.wet.gain.setTargetAtTime(value, now, timeConstant);
  };

  const applyVolumes = (active: Running): void => {
    glide(active, active.master, volumeToGain(volumes.master), VOLUME_SMOOTHING);
    glide(active, active.volumes.music, volumeToGain(volumes.music), VOLUME_SMOOTHING);
    glide(active, active.volumes.effects, volumeToGain(volumes.effects), VOLUME_SMOOTHING);
    glide(active, active.volumes.ambience, volumeToGain(volumes.ambience), VOLUME_SMOOTHING);
  };

  const applyScene = (active: Running): void => {
    const mix = SCENE_MIX[scene];
    glide(active, active.trims.music, mix.music, SCENE_SMOOTHING);
    glide(active, active.trims.effects, mix.effects, SCENE_SMOOTHING);
    glide(active, active.trims.ambience, mix.ambience, SCENE_SMOOTHING);
    // Pausing keeps whatever music was playing.
    if (scene !== 'paused') active.music.setMode(scene);
    // The lobby and the credits have no game state to follow: give them a calm one.
    if (scene === 'lobby') applyLayerInputs(active, LOBBY_INPUTS, 0);
    if (scene === 'credits') applyLayerInputs(active, CREDITS_INPUTS, 0);
  };

  /** Re-aim the music duck: down for a conversation or an important cue, then back. */
  const applyDuck = (active: Running): void => {
    const now = active.graph.now();
    const floor = dialogueOpen ? DIALOGUE_DUCK : 1;
    const ducked = now < duckUntil;
    const level = ducked ? Math.min(floor, 1 - duckDepth) : floor;
    for (const parameter of [active.duck.dry.gain, active.duck.wet.gain]) {
      parameter.cancelScheduledValues(now);
      parameter.setTargetAtTime(level, now, 0.08);
      if (ducked) parameter.setTargetAtTime(floor, duckUntil, 0.6);
    }
    active.duck.target = level;
  };

  const duckMusic = (active: Running, depth: number, seconds: number): void => {
    const now = active.graph.now();
    duckDepth = now < duckUntil ? Math.max(duckDepth, depth) : depth;
    duckUntil = Math.max(duckUntil, now + seconds);
    applyDuck(active);
  };

  const setDialogueOpen = (active: Running, open: boolean): void => {
    if (open === dialogueOpen) return;
    dialogueOpen = open;
    applyDuck(active);
  };

  // --- Sounds ----------------------------------------------------------------------

  function playCue(request: CueRequest): boolean {
    if (!running) return false;
    const definition = CUES[request.cue];
    const now = running.graph.now();
    const last = lastCueAt[request.cue];
    if (last !== undefined && now - last < definition.minimumInterval) return false;
    const voice = running.pool.open({
      bus: 'effects', label: request.cue, priority: definition.priority, gain: definition.gain ?? 1,
      reverb: definition.reverb,
    });
    if (!voice) return false;
    lastCueAt[request.cue] = now;
    definition.play(voice, request);
    if (definition.duck) duckMusic(running, definition.duck.depth, definition.duck.seconds);
    return true;
  }

  function applyLayerInputs(active: Running, inputs: LayerInputs, frameSeconds: number): void {
    active.layers.update(inputs, frameSeconds);
    active.music.setContext({
      regionId: inputs.regionId, hour: inputs.hour, weatherKind: inputs.weatherKind, stormLevel: inputs.stormLevel,
    });
  }

  const tick = (lookahead: number): void => {
    if (!running) return;
    running.pool.reap();
    running.layers.schedule(lookahead);
    running.music.advance(lookahead + 0.4);
  };

  // --- Running, suspended, hidden ----------------------------------------------------

  const syncContextState = async (): Promise<void> => {
    if (!running) return;
    const { context } = running;
    const shouldRun = !userSuspended && !pageHidden;
    try {
      if (shouldRun && context.state !== 'running') await context.resume();
      else if (!shouldRun && context.state === 'running') await context.suspend();
    } catch {
      // An offline or closed context refuses: nothing to do about it.
    }
  };

  const onVisibilityChange = (): void => {
    pageHidden = document.hidden === true;
    void syncContextState();
  };

  const startHousekeeping = (): void => {
    if (followPageVisibility) document.addEventListener('visibilitychange', onVisibilityChange);
    if (options.autoTick === false) return;
    // Keeps grains and music going where no frame calls `update`: the lobby, the credits.
    timer = setInterval(() => {
      if (running?.context.state === 'running') tick(TIMER_LOOKAHEAD);
    }, TIMER_MILLISECONDS);
    (timer as { unref?: () => void }).unref?.();
  };

  const stopHousekeeping = (): void => {
    if (followPageVisibility) document.removeEventListener('visibilitychange', onVisibilityChange);
    if (timer !== null) clearInterval(timer);
    timer = null;
  };

  // --- The public engine -----------------------------------------------------------

  return {
    async unlock(): Promise<void> {
      if (disposed) return;
      if (!running) {
        const factory = options.contextFactory ?? browserContextFactory();
        if (!factory) return;
        let context: AudioContext | null = null;
        try {
          context = factory();
          running = build(context);
        } catch {
          // No usable WebAudio: stay silent rather than break the game.
          running = null;
          try {
            void context?.close();
          } catch {
            // Nothing was opened.
          }
          return;
        }
        applyScene(running);
        startHousekeeping();
      }
      await syncContextState();
    },

    setVolumes(next: AudioVolumes): void {
      volumes = {
        master: sanitizeVolume(next.master, volumes.master),
        music: sanitizeVolume(next.music, volumes.music),
        effects: sanitizeVolume(next.effects, volumes.effects),
        ambience: sanitizeVolume(next.ambience, volumes.ambience),
      };
      if (running) applyVolumes(running);
    },

    handleEvents(events: readonly GameEvent[]): void {
      if (!running) return;
      for (const event of events) {
        if (event.type === 'dialogue_opened') setDialogueOpen(running, true);
        else if (event.type === 'dialogue_closed') setDialogueOpen(running, false);
        else if (event.type === 'game_completed') running.music.playFinale();
        const request = resolveEventCue(event, { state: lastState });
        if (request) playCue(request);
      }
    },

    update(state: GameState, frameSeconds: number, playerId: PlayerId = 0): void {
      if (!running) return;
      lastState = state;
      const seconds = Number.isFinite(frameSeconds) ? clamp(frameSeconds, 0, 0.25) : 0;
      applyLayerInputs(running, deriveLayerInputs(state, deriveMemory, seconds, playerId), seconds);
      setDialogueOpen(running, playerOf(state, playerId).dialogue !== null);
      tick(FRAME_LOOKAHEAD);
    },

    playInterface(sound: InterfaceSound): void {
      if (!running) return;
      const definition = INTERFACE_SOUNDS[sound];
      if (!definition) return;
      const now = running.graph.now();
      const last = lastInterfaceAt[sound];
      if (last !== undefined && now - last < definition.minimumInterval) return;
      const voice = running.pool.open({ bus: 'interface', label: `interface:${sound}`, priority: 3 });
      if (!voice) return;
      lastInterfaceAt[sound] = now;
      definition.play(voice);
    },

    setScene(next: AudioScene): void {
      if (!(next in SCENE_MIX) || next === scene) return;
      scene = next;
      if (running) applyScene(running);
    },

    suspend(): void {
      userSuspended = true;
      void syncContextState();
    },

    resume(): void {
      userSuspended = false;
      void syncContextState();
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      stopHousekeeping();
      if (!running) return;
      const { graph, context } = running;
      running = null;
      lastState = null;
      graph.dispose();
      try {
        void context.close?.()?.catch(() => undefined);
      } catch {
        // Already closed, or an offline context with nothing to close.
      }
    },

    inspector: {
      context: () => running?.context ?? null,
      nodes: () => running?.nodes ?? null,
      tick: (lookahead = FRAME_LOOKAHEAD) => tick(lookahead),
      applyLayerInputs(inputs: LayerInputs, frameSeconds: number): void {
        if (running) applyLayerInputs(running, inputs, frameSeconds);
      },
      playCue,
      voiceCount(bus?: BusName): number {
        running?.pool.reap();
        return running?.pool.activeCount(bus) ?? 0;
      },
      voiceLabels: (bus?: BusName) => running?.pool.activeLabels(bus) ?? [],
      voicesStarted: (label: string) => running?.pool.startedCount(label) ?? 0,
      musicState: () => running?.music.describe() ?? 'silent',
      layerLevels: () => running?.layers.levels() ?? null,
      trackedNodeCount: () => running?.graph.trackedNodeCount() ?? 0,
    },
  };
}
