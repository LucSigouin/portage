/**
 * Low-level WebAudio plumbing: node creation that is tracked so it can be torn
 * down, generated noise buffers, the generated reverb impulse, and envelope
 * helpers. Nothing in here knows about the game.
 */

export type NoiseColor = 'white' | 'pink' | 'brown';

/** Root-mean-square level every noise buffer is normalised to. */
export const NOISE_LEVEL = 0.25;

const NOISE_SECONDS: Record<NoiseColor, number> = { white: 3, pink: 5, brown: 5 };
const LOOP_CROSSFADE_SAMPLES = 2048;

/** Small deterministic generator (mulberry32). Returns numbers in [0, 1). */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Equal-tempered frequency of a MIDI note number (69 = A4 = 440 Hz). */
export function noteFrequency(midiNote: number): number {
  return 440 * 2 ** ((midiNote - 69) / 12);
}

export const clamp = (value: number, minimum: number, maximum: number): number =>
  value < minimum ? minimum : value > maximum ? maximum : value;

/** 0 below `from`, 1 above `to`, smooth in between. */
export function smoothStep(from: number, to: number, value: number): number {
  const share = clamp((value - from) / (to - from), 0, 1);
  return share * share * (3 - 2 * share);
}

/** Fill one loopable channel of noise, normalised to `NOISE_LEVEL`. */
function fillNoise(color: NoiseColor, samples: Float32Array, random: () => number): void {
  const length = samples.length;
  const raw = new Float32Array(length + LOOP_CROSSFADE_SAMPLES);
  // Pink: Paul Kellet's economy filter. Brown: a leaky integrator.
  let pinkLow = 0;
  let pinkMiddle = 0;
  let pinkHigh = 0;
  let brown = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const white = random() * 2 - 1;
    if (color === 'white') {
      raw[index] = white;
    } else if (color === 'pink') {
      pinkLow = 0.99765 * pinkLow + white * 0.099046;
      pinkMiddle = 0.963 * pinkMiddle + white * 0.2965164;
      pinkHigh = 0.57 * pinkHigh + white * 1.0526913;
      raw[index] = pinkLow + pinkMiddle + pinkHigh + white * 0.1848;
    } else {
      brown = 0.995 * brown + white * 0.1;
      raw[index] = brown;
    }
  }
  // Fold the extra tail over the head so the loop point is seamless.
  for (let index = 0; index < length; index += 1) {
    if (index < LOOP_CROSSFADE_SAMPLES) {
      const share = index / LOOP_CROSSFADE_SAMPLES;
      samples[index] = raw[index] * Math.sqrt(share) + raw[length + index] * Math.sqrt(1 - share);
    } else {
      samples[index] = raw[index];
    }
  }
  let sumOfSquares = 0;
  for (let index = 0; index < length; index += 1) sumOfSquares += samples[index] * samples[index];
  const scale = NOISE_LEVEL / Math.sqrt(sumOfSquares / length || 1);
  for (let index = 0; index < length; index += 1) samples[index] = clamp(samples[index] * scale, -1, 1);
}

/**
 * A small generated room: decaying stereo noise that darkens as it fades, with
 * a few early reflections. No impulse files.
 */
export function createReverbImpulse(context: BaseAudioContext, seconds: number, random: () => number): AudioBuffer {
  const sampleRate = context.sampleRate;
  const length = Math.max(1, Math.floor(seconds * sampleRate));
  const impulse = context.createBuffer(2, length, sampleRate);
  const preDelaySamples = Math.floor(0.012 * sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const samples = impulse.getChannelData(channel);
    let lowPassed = 0;
    for (let index = preDelaySamples; index < length; index += 1) {
      const time = (index - preDelaySamples) / sampleRate;
      // -60 dB at the end of the tail.
      const decay = Math.exp((-6.9 * time) / seconds);
      // The tail loses its top end as it decays, like air and soft banks do.
      const smoothing = 0.25 + 0.6 * Math.min(1, time / (seconds * 0.6));
      lowPassed += (1 - smoothing) * ((random() * 2 - 1) - lowPassed);
      const fadeIn = Math.min(1, time / 0.004);
      samples[index] = lowPassed * decay * fadeIn;
    }
    // Early reflections: a handful of discrete taps in the first 70 ms.
    for (let tap = 0; tap < 6; tap += 1) {
      const position = preDelaySamples + Math.floor((0.006 + random() * 0.064) * sampleRate);
      if (position < length) samples[position] += (random() > 0.5 ? 1 : -1) * (0.5 - tap * 0.06);
    }
  }
  return impulse;
}

/**
 * Curve for the last-resort soft clipper: straight up to 0.7, then bending
 * over so the output can never pass `SOFT_CLIP_CEILING`.
 */
export const SOFT_CLIP_KNEE = 0.7;
export const SOFT_CLIP_CEILING = SOFT_CLIP_KNEE + (1 - SOFT_CLIP_KNEE) * Math.tanh(1);

export function softClip(input: number): number {
  const magnitude = Math.abs(input);
  if (magnitude <= SOFT_CLIP_KNEE) return input;
  const range = 1 - SOFT_CLIP_KNEE;
  const shaped = SOFT_CLIP_KNEE + range * Math.tanh((Math.min(magnitude, 1) - SOFT_CLIP_KNEE) / range);
  return Math.sign(input) * shaped;
}

export function createSoftClipCurve(points = 2049): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  for (let index = 0; index < points; index += 1) curve[index] = softClip((index / (points - 1)) * 2 - 1);
  return curve;
}

/**
 * Attack, optional hold, then a decay that is a straight line in decibels down
 * to -60 dB and lands on exact silence. Returns the time the envelope ends.
 */
export function scheduleEnvelope(
  parameter: AudioParam, start: number, peak: number, attack: number, hold: number, decay: number,
): number {
  const level = Math.max(peak, 1e-5);
  const attackEnd = start + Math.max(attack, 0.0005);
  const decayStart = attackEnd + Math.max(hold, 0);
  const decayEnd = decayStart + Math.max(decay, 0.005);
  parameter.setValueAtTime(0, start);
  parameter.linearRampToValueAtTime(level, attackEnd);
  if (hold > 0) parameter.setValueAtTime(level, decayStart);
  parameter.exponentialRampToValueAtTime(level * 0.001, decayEnd);
  parameter.linearRampToValueAtTime(0, decayEnd + 0.012);
  return decayEnd + 0.012;
}

/**
 * A parameter that glides to each new target instead of jumping. Repeated
 * calls with the same target schedule nothing.
 */
export interface SmoothedParameter {
  set(target: number, timeConstant?: number): void;
  readonly target: number;
}

export function createSmoothedParameter(
  context: BaseAudioContext, parameter: AudioParam, initial: number, defaultTimeConstant: number,
): SmoothedParameter {
  let current = initial;
  parameter.value = initial;
  return {
    set(target: number, timeConstant = defaultTimeConstant): void {
      if (!Number.isFinite(target) || Math.abs(target - current) < 1e-5) return;
      current = target;
      parameter.setTargetAtTime(target, context.currentTime, Math.max(timeConstant, 0.001));
    },
    get target(): number {
      return current;
    },
  };
}

/** Every node the engine makes goes through here so `dispose` can find it. */
export interface AudioGraph {
  readonly context: AudioContext;
  /** Seeded generator for every random choice the engine makes. */
  readonly random: () => number;
  now(): number;
  gain(value?: number): GainNode;
  /** An oscillator, not yet started. */
  oscillator(type: OscillatorType, frequency: number): OscillatorNode;
  /** A looping noise source, not yet started. */
  noise(color: NoiseColor, playbackRate?: number): AudioBufferSourceNode;
  /** A random offset into a noise buffer, so two sources never line up. */
  noiseOffset(color: NoiseColor): number;
  filter(type: BiquadFilterType, frequency: number, quality?: number): BiquadFilterNode;
  /** A stereo panner, or a plain gain where the browser has none. */
  panner(pan: number): AudioNode;
  compressor(): DynamicsCompressorNode;
  convolver(buffer: AudioBuffer): ConvolverNode;
  shaper(curve: Float32Array<ArrayBuffer>): WaveShaperNode;
  connect(source: AudioNode, destination: AudioNode | AudioParam): void;
  /** Stop, disconnect and forget these nodes. */
  release(nodes: readonly AudioNode[]): void;
  /** Stop and disconnect everything that is left. */
  dispose(): void;
  trackedNodeCount(): number;
}

function isScheduledSource(node: AudioNode): node is AudioScheduledSourceNode {
  return typeof (node as Partial<AudioScheduledSourceNode>).stop === 'function';
}

export function createAudioGraph(context: AudioContext, random: () => number): AudioGraph {
  const tracked = new Set<AudioNode>();
  const noiseBuffers: Partial<Record<NoiseColor, AudioBuffer>> = {};
  // The buffers are filled from a fixed seed: the same noise in every session.
  const noiseRandom = createSeededRandom(0x51ed270b);

  const track = <NodeType extends AudioNode>(node: NodeType): NodeType => {
    tracked.add(node);
    return node;
  };

  const noiseBuffer = (color: NoiseColor): AudioBuffer => {
    let buffer = noiseBuffers[color];
    if (!buffer) {
      buffer = context.createBuffer(1, Math.floor(NOISE_SECONDS[color] * context.sampleRate), context.sampleRate);
      fillNoise(color, buffer.getChannelData(0), noiseRandom);
      noiseBuffers[color] = buffer;
    }
    return buffer;
  };

  const silence = (node: AudioNode): void => {
    if (isScheduledSource(node)) {
      try {
        node.stop();
      } catch {
        // Never started, or already stopped: nothing to stop.
      }
    }
    try {
      node.disconnect();
    } catch {
      // Already disconnected.
    }
  };

  return {
    context,
    random,
    now: () => context.currentTime,
    gain(value = 1): GainNode {
      const node = track(context.createGain());
      node.gain.value = value;
      return node;
    },
    oscillator(type: OscillatorType, frequency: number): OscillatorNode {
      const node = track(context.createOscillator());
      node.type = type;
      node.frequency.value = frequency;
      return node;
    },
    noise(color: NoiseColor, playbackRate = 1): AudioBufferSourceNode {
      const node = track(context.createBufferSource());
      node.buffer = noiseBuffer(color);
      node.loop = true;
      node.playbackRate.value = playbackRate;
      return node;
    },
    noiseOffset: (color: NoiseColor): number => random() * (NOISE_SECONDS[color] - 0.1),
    filter(type: BiquadFilterType, frequency: number, quality = 0.707): BiquadFilterNode {
      const node = track(context.createBiquadFilter());
      node.type = type;
      node.frequency.value = frequency;
      node.Q.value = quality;
      return node;
    },
    panner(pan: number): AudioNode {
      if (typeof context.createStereoPanner !== 'function') return track(context.createGain());
      const node = track(context.createStereoPanner());
      node.pan.value = clamp(pan, -1, 1);
      return node;
    },
    compressor: () => track(context.createDynamicsCompressor()),
    convolver(buffer: AudioBuffer): ConvolverNode {
      const node = track(context.createConvolver());
      node.buffer = buffer;
      return node;
    },
    shaper(curve: Float32Array<ArrayBuffer>): WaveShaperNode {
      const node = track(context.createWaveShaper());
      node.curve = curve;
      return node;
    },
    connect(source: AudioNode, destination: AudioNode | AudioParam): void {
      // The two overloads of `connect` do not accept a union; the call is the same.
      source.connect(destination as AudioNode);
    },
    release(nodes: readonly AudioNode[]): void {
      for (const node of nodes) {
        silence(node);
        tracked.delete(node);
      }
    },
    dispose(): void {
      for (const node of tracked) silence(node);
      tracked.clear();
    },
    trackedNodeCount: () => tracked.size,
  };
}
