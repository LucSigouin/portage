/**
 * Voices: short-lived sounds (one-shots, music notes, ambience grains) built
 * from a few oscillators and noise bursts. The pool caps how many play at once
 * on each bus, steals the least important voice when it must, and frees every
 * node once a voice has rung out.
 */
import type { AudioGraph, NoiseColor } from './graph.ts';
import { scheduleEnvelope } from './graph.ts';

export type BusName = 'music' | 'effects' | 'ambience' | 'interface';

/** Where a bus takes sound in: straight to the mix, and into the reverb. */
export interface BusInput {
  dry: AudioNode;
  reverb: AudioNode;
}

/** Most voices allowed to sound at once, per bus. */
export const VOICE_LIMITS: Record<BusName, number> = { music: 28, effects: 20, ambience: 18, interface: 6 };

/** Voices being faded out after a steal still hold nodes; at most this many per bus. */
export const STEAL_MARGIN = 4;

const STEAL_FADE_SECONDS = 0.05;

export interface VoiceOptions {
  bus: BusName;
  /** Shown in the lab and used by the tests. */
  label: string;
  /** Higher wins when the bus is full. */
  priority: number;
  /** Overall level of the voice. */
  gain?: number;
  /** -1 left to +1 right. */
  pan?: number;
  /** 0 to 1: how much of the voice goes to the reverb. */
  reverb?: number;
  /** Seconds from now until the voice starts. */
  delay?: number;
}

export interface FilterOptions {
  type: BiquadFilterType;
  frequency: number;
  /** Frequency the filter sweeps to over the life of the sound. */
  sweepTo?: number;
  sweepSeconds?: number;
  quality?: number;
}

interface EnvelopeOptions {
  /** Seconds after the voice starts. */
  at?: number;
  /** Peak level. */
  gain: number;
  attack?: number;
  hold?: number;
  /** Seconds to fall 60 dB. */
  decay: number;
  pan?: number;
}

export interface ToneOptions extends EnvelopeOptions {
  type?: OscillatorType;
  frequency: number;
  /** Glide to this frequency over `glideSeconds` (default: the whole sound). */
  glideTo?: number;
  glideSeconds?: number;
  /** A longer pitch path: frequency reached at each time after the tone starts. */
  contour?: readonly { time: number; frequency: number }[];
  /** Cents. */
  detune?: number;
  vibrato?: { rate: number; depth: number; delay?: number };
  filter?: FilterOptions;
}

export interface NoiseOptions extends EnvelopeOptions {
  color?: NoiseColor;
  filter: FilterOptions;
  /** A second filter in series, for a tighter band. */
  secondFilter?: FilterOptions;
  playbackRate?: number;
}

export interface BellOptions extends EnvelopeOptions {
  frequency: number;
  /** Modulator frequency as a multiple of the carrier. */
  ratio: number;
  /** Modulation depth as a multiple of the carrier frequency. */
  index: number;
  /** Seconds for the modulation to die away (default: a third of the decay). */
  indexDecay?: number;
}

/** Handed to a sound recipe. Times are relative to the start of the voice. */
export interface VoiceBuilder {
  /** Context time the voice starts at. */
  readonly start: number;
  readonly random: () => number;
  tone(options: ToneOptions): void;
  noise(options: NoiseOptions): void;
  /** Two-operator frequency modulation: bells, glass, struck metal. */
  bell(options: BellOptions): void;
  /** Seconds from the start of the voice to the end of its last sound so far. */
  length(): number;
}

interface Voice {
  bus: BusName;
  label: string;
  priority: number;
  start: number;
  end: number;
  retiring: boolean;
  output: GainNode;
  nodes: AudioNode[];
}

export interface VoicePool {
  /** Start a voice, or null when the bus is full of more important ones. */
  open(options: VoiceOptions): VoiceBuilder | null;
  /** Free every voice that has finished. */
  reap(): void;
  /** Voices sounding on a bus, or on every bus. */
  activeCount(bus?: BusName): number;
  /** Labels of the voices sounding, oldest first. */
  activeLabels(bus?: BusName): string[];
  /** How many voices with this label have been started since the pool was made. */
  startedCount(label: string): number;
  /** Fade out and free every voice on a bus (all buses when omitted). */
  silence(bus?: BusName, fadeSeconds?: number): void;
}

export function createVoicePool(graph: AudioGraph, inputs: Record<BusName, BusInput>): VoicePool {
  let voices: Voice[] = [];
  const started = new Map<string, number>();

  const free = (voice: Voice): void => graph.release(voice.nodes);

  const reap = (): void => {
    const now = graph.now();
    const finished = voices.filter((voice) => voice.end <= now);
    if (finished.length === 0) return;
    for (const voice of finished) free(voice);
    voices = voices.filter((voice) => voice.end > now);
  };

  const retire = (voice: Voice, fadeSeconds = STEAL_FADE_SECONDS): void => {
    const now = graph.now();
    voice.retiring = true;
    voice.output.gain.cancelScheduledValues(now);
    voice.output.gain.setTargetAtTime(0, now, fadeSeconds / 4);
    voice.end = Math.min(voice.end, now + fadeSeconds);
  };

  const makeRoom = (bus: BusName, priority: number): boolean => {
    const onBus = voices.filter((voice) => voice.bus === bus);
    const sounding = onBus.filter((voice) => !voice.retiring);
    if (sounding.length < VOICE_LIMITS[bus]) return true;
    if (onBus.length - sounding.length >= STEAL_MARGIN) return false;
    // Least important first; among equals the oldest goes.
    const victim = sounding.reduce((lowest, voice) => (voice.priority < lowest.priority ? voice : lowest));
    if (victim.priority > priority) return false;
    retire(victim);
    return true;
  };

  const open = (options: VoiceOptions): VoiceBuilder | null => {
    reap();
    if (!makeRoom(options.bus, options.priority)) return null;

    const start = graph.now() + Math.max(0, options.delay ?? 0) + 0.004;
    const output = graph.gain(options.gain ?? 1);
    const voice: Voice = {
      bus: options.bus, label: options.label, priority: options.priority,
      start, end: start + 0.05, retiring: false, output, nodes: [output],
    };
    let tail: AudioNode = output;
    if (options.pan !== undefined && options.pan !== 0) {
      const panner = graph.panner(options.pan);
      graph.connect(output, panner);
      voice.nodes.push(panner);
      tail = panner;
    }
    graph.connect(tail, inputs[options.bus].dry);
    if (options.reverb !== undefined && options.reverb > 0) {
      const send = graph.gain(options.reverb);
      graph.connect(tail, send);
      graph.connect(send, inputs[options.bus].reverb);
      voice.nodes.push(send);
    }
    voices.push(voice);
    started.set(voice.label, (started.get(voice.label) ?? 0) + 1);

    /** Envelope gain, optional panner, into the voice. Returns the envelope node. */
    const envelope = (settings: EnvelopeOptions, begin: number): { node: GainNode; end: number } => {
      const node = graph.gain(0);
      voice.nodes.push(node);
      const end = scheduleEnvelope(
        node.gain, begin, settings.gain, settings.attack ?? 0.004, settings.hold ?? 0, settings.decay,
      );
      if (settings.pan !== undefined && settings.pan !== 0) {
        const panner = graph.panner(settings.pan);
        voice.nodes.push(panner);
        graph.connect(node, panner);
        graph.connect(panner, output);
      } else {
        graph.connect(node, output);
      }
      voice.end = Math.max(voice.end, end + 0.03);
      return { node, end };
    };

    const makeFilter = (settings: FilterOptions, begin: number, lifetime: number): BiquadFilterNode => {
      const filter = graph.filter(settings.type, settings.frequency, settings.quality ?? 0.707);
      voice.nodes.push(filter);
      if (settings.sweepTo !== undefined) {
        filter.frequency.setValueAtTime(settings.frequency, begin);
        filter.frequency.exponentialRampToValueAtTime(
          Math.max(settings.sweepTo, 10), begin + (settings.sweepSeconds ?? lifetime),
        );
      }
      return filter;
    };

    const run = (source: AudioScheduledSourceNode, begin: number, end: number): void => {
      source.start(begin);
      source.stop(end + 0.02);
    };

    return {
      start,
      random: graph.random,

      tone(settings: ToneOptions): void {
        const begin = start + (settings.at ?? 0);
        const lifetime = (settings.attack ?? 0.004) + (settings.hold ?? 0) + settings.decay;
        const oscillator = graph.oscillator(settings.type ?? 'sine', settings.frequency);
        voice.nodes.push(oscillator);
        if (settings.detune !== undefined) oscillator.detune.value = settings.detune;
        if (settings.contour !== undefined) {
          oscillator.frequency.setValueAtTime(settings.frequency, begin);
          for (const point of settings.contour) {
            oscillator.frequency.exponentialRampToValueAtTime(Math.max(point.frequency, 10), begin + point.time);
          }
        } else if (settings.glideTo !== undefined) {
          oscillator.frequency.setValueAtTime(settings.frequency, begin);
          oscillator.frequency.exponentialRampToValueAtTime(
            Math.max(settings.glideTo, 10), begin + (settings.glideSeconds ?? lifetime),
          );
        }
        const shaped = envelope(settings, begin);
        if (settings.vibrato !== undefined) {
          const wobble = graph.oscillator('sine', settings.vibrato.rate);
          const depth = graph.gain(0);
          voice.nodes.push(wobble, depth);
          const wobbleStart = begin + (settings.vibrato.delay ?? 0);
          depth.gain.setValueAtTime(0, wobbleStart);
          depth.gain.linearRampToValueAtTime(settings.vibrato.depth, wobbleStart + 0.25);
          graph.connect(wobble, depth);
          graph.connect(depth, oscillator.frequency);
          run(wobble, begin, shaped.end);
        }
        if (settings.filter !== undefined) {
          const filter = makeFilter(settings.filter, begin, lifetime);
          graph.connect(oscillator, filter);
          graph.connect(filter, shaped.node);
        } else {
          graph.connect(oscillator, shaped.node);
        }
        run(oscillator, begin, shaped.end);
      },

      noise(settings: NoiseOptions): void {
        const begin = start + (settings.at ?? 0);
        const lifetime = (settings.attack ?? 0.004) + (settings.hold ?? 0) + settings.decay;
        const color = settings.color ?? 'white';
        const source = graph.noise(color, settings.playbackRate ?? 1);
        voice.nodes.push(source);
        const shaped = envelope(settings, begin);
        const filter = makeFilter(settings.filter, begin, lifetime);
        graph.connect(source, filter);
        if (settings.secondFilter !== undefined) {
          const second = makeFilter(settings.secondFilter, begin, lifetime);
          graph.connect(filter, second);
          graph.connect(second, shaped.node);
        } else {
          graph.connect(filter, shaped.node);
        }
        source.start(begin, graph.noiseOffset(color));
        source.stop(shaped.end + 0.02);
      },

      bell(settings: BellOptions): void {
        const begin = start + (settings.at ?? 0);
        const carrier = graph.oscillator('sine', settings.frequency);
        const modulator = graph.oscillator('sine', settings.frequency * settings.ratio);
        const depth = graph.gain(0);
        voice.nodes.push(carrier, modulator, depth);
        const peakDepth = settings.index * settings.frequency;
        depth.gain.setValueAtTime(peakDepth, begin);
        depth.gain.exponentialRampToValueAtTime(
          Math.max(peakDepth * 0.02, 0.01), begin + (settings.indexDecay ?? settings.decay / 3),
        );
        const shaped = envelope(settings, begin);
        graph.connect(modulator, depth);
        graph.connect(depth, carrier.frequency);
        graph.connect(carrier, shaped.node);
        run(modulator, begin, shaped.end);
        run(carrier, begin, shaped.end);
      },

      length: () => voice.end - start,
    };
  };

  return {
    open,
    reap,
    activeCount: (bus?: BusName): number =>
      voices.filter((voice) => !voice.retiring && (bus === undefined || voice.bus === bus)).length,
    activeLabels: (bus?: BusName): string[] =>
      voices.filter((voice) => !voice.retiring && (bus === undefined || voice.bus === bus)).map((voice) => voice.label),
    startedCount: (label: string): number => started.get(label) ?? 0,
    silence(bus?: BusName, fadeSeconds?: number): void {
      for (const voice of voices) {
        if (!voice.retiring && (bus === undefined || voice.bus === bus)) retire(voice, fadeSeconds);
      }
    },
  };
}
