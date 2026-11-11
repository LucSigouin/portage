/**
 * A fake AudioContext for the audio tests. It makes no sound. It records the
 * graph (who is connected to whom), which sources are running, and every
 * parameter's automation, and it can work out what a parameter's value will be
 * at any time, so a test can ask "where is this gain heading".
 *
 * The clock only moves when a test calls `advance`.
 */

type AutomationEvent =
  | { kind: 'set'; time: number; value: number }
  | { kind: 'linear'; time: number; value: number }
  | { kind: 'exponential'; time: number; value: number }
  | { kind: 'target'; time: number; value: number; timeConstant: number };

export class FakeAudioParam {
  /** The value set directly, used until the first automation event. */
  value: number;
  readonly events: AutomationEvent[] = [];
  /** Nodes modulating this parameter. */
  readonly inputs = new Set<FakeAudioNode>();

  constructor(initial: number) {
    this.value = initial;
  }

  private insert(event: AutomationEvent): this {
    if (!Number.isFinite(event.time) || !Number.isFinite(event.value)) {
      throw new TypeError(`Non-finite automation: ${JSON.stringify(event)}`);
    }
    let index = this.events.length;
    while (index > 0 && this.events[index - 1].time > event.time) index -= 1;
    this.events.splice(index, 0, event);
    return this;
  }

  setValueAtTime(value: number, time: number): this {
    return this.insert({ kind: 'set', time, value });
  }

  linearRampToValueAtTime(value: number, time: number): this {
    return this.insert({ kind: 'linear', time, value });
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    if (value <= 0) throw new RangeError('exponentialRampToValueAtTime needs a positive value');
    return this.insert({ kind: 'exponential', time, value });
  }

  setTargetAtTime(value: number, time: number, timeConstant: number): this {
    if (!(timeConstant > 0)) throw new RangeError('setTargetAtTime needs a positive time constant');
    return this.insert({ kind: 'target', time, value, timeConstant });
  }

  /** Drop every event at or after `time`. One already under way keeps going. */
  cancelScheduledValues(time: number): this {
    for (let index = this.events.length - 1; index >= 0; index -= 1) {
      if (this.events[index].time >= time) this.events.splice(index, 1);
    }
    return this;
  }

  /** The value the automation gives at `time`. */
  valueAtTime(time: number): number {
    let value = this.value;
    let previousTime = 0;
    for (let index = 0; index < this.events.length; index += 1) {
      const event = this.events[index];
      const next = this.events[index + 1];
      if (event.kind === 'set') {
        if (event.time > time) return value;
        value = event.value;
        previousTime = event.time;
      } else if (event.kind === 'linear' || event.kind === 'exponential') {
        if (time < event.time) {
          if (time <= previousTime) return value;
          const share = (time - previousTime) / (event.time - previousTime);
          if (event.kind === 'linear') return value + (event.value - value) * share;
          return value > 0 ? value * (event.value / value) ** share : value;
        }
        value = event.value;
        previousTime = event.time;
      } else {
        if (event.time > time) return value;
        const end = next ? Math.min(time, next.time) : time;
        value = event.value + (value - event.value) * Math.exp(-(end - event.time) / event.timeConstant);
        previousTime = end;
        if (!next || next.time > time) return value;
      }
    }
    return value;
  }

  /** Where the automation ends up once everything scheduled has played out. */
  settledValue(): number {
    return this.valueAtTime(Number.MAX_SAFE_INTEGER);
  }
}

export class FakeAudioNode {
  readonly context: FakeAudioContext;
  readonly kind: string;
  readonly outputs = new Set<FakeAudioNode | FakeAudioParam>();
  readonly inputs = new Set<FakeAudioNode>();

  constructor(context: FakeAudioContext, kind: string) {
    this.context = context;
    this.kind = kind;
    context.nodes.push(this);
  }

  connect(destination: FakeAudioNode | FakeAudioParam): FakeAudioNode | FakeAudioParam {
    if (!(destination instanceof FakeAudioNode) && !(destination instanceof FakeAudioParam)) {
      throw new TypeError('connect needs a node or a parameter');
    }
    this.outputs.add(destination);
    destination.inputs.add(this);
    return destination;
  }

  disconnect(): void {
    for (const destination of this.outputs) destination.inputs.delete(this);
    this.outputs.clear();
  }
}

export class FakeGainNode extends FakeAudioNode {
  readonly gain = new FakeAudioParam(1);

  constructor(context: FakeAudioContext) {
    super(context, 'gain');
  }
}

export class FakeSourceNode extends FakeAudioNode {
  startTime: number | null = null;
  stopTime = Number.POSITIVE_INFINITY;

  start(when = 0): void {
    if (this.startTime !== null) throw new Error('InvalidStateError: source already started');
    this.startTime = Math.max(when, this.context.currentTime);
  }

  stop(when = 0): void {
    if (this.startTime === null) throw new Error('InvalidStateError: source never started');
    this.stopTime = Math.min(this.stopTime, Math.max(when, this.context.currentTime));
  }

  /** Started and not yet stopped at `time`. */
  playingAt(time: number): boolean {
    return this.startTime !== null && this.stopTime > time;
  }
}

export class FakeOscillatorNode extends FakeSourceNode {
  type = 'sine';
  readonly frequency = new FakeAudioParam(440);
  readonly detune = new FakeAudioParam(0);

  constructor(context: FakeAudioContext) {
    super(context, 'oscillator');
  }
}

export class FakeBufferSourceNode extends FakeSourceNode {
  buffer: FakeAudioBuffer | null = null;
  loop = false;
  readonly playbackRate = new FakeAudioParam(1);

  constructor(context: FakeAudioContext) {
    super(context, 'bufferSource');
  }
}

export class FakeBiquadFilterNode extends FakeAudioNode {
  type = 'lowpass';
  readonly frequency = new FakeAudioParam(350);
  readonly detune = new FakeAudioParam(0);
  readonly Q = new FakeAudioParam(1);
  readonly gain = new FakeAudioParam(0);

  constructor(context: FakeAudioContext) {
    super(context, 'biquadFilter');
  }
}

export class FakeStereoPannerNode extends FakeAudioNode {
  readonly pan = new FakeAudioParam(0);

  constructor(context: FakeAudioContext) {
    super(context, 'stereoPanner');
  }
}

export class FakeCompressorNode extends FakeAudioNode {
  readonly threshold = new FakeAudioParam(-24);
  readonly knee = new FakeAudioParam(30);
  readonly ratio = new FakeAudioParam(12);
  readonly attack = new FakeAudioParam(0.003);
  readonly release = new FakeAudioParam(0.25);

  constructor(context: FakeAudioContext) {
    super(context, 'compressor');
  }
}

export class FakeConvolverNode extends FakeAudioNode {
  buffer: FakeAudioBuffer | null = null;
  normalize = true;

  constructor(context: FakeAudioContext) {
    super(context, 'convolver');
  }
}

export class FakeWaveShaperNode extends FakeAudioNode {
  curve: Float32Array | null = null;
  oversample = 'none';

  constructor(context: FakeAudioContext) {
    super(context, 'waveShaper');
  }
}

export class FakeAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private readonly channels: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel];
  }
}

export class FakeAudioContext {
  currentTime = 0;
  readonly sampleRate: number;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  readonly nodes: FakeAudioNode[] = [];
  readonly destination: FakeAudioNode;
  resumeCalls = 0;
  suspendCalls = 0;
  closeCalls = 0;

  /** A low sample rate keeps the generated noise and reverb buffers small. */
  constructor(sampleRate = 8000) {
    this.sampleRate = sampleRate;
    this.destination = new FakeAudioNode(this, 'destination');
  }

  resume(): Promise<void> {
    this.resumeCalls += 1;
    if (this.state !== 'closed') this.state = 'running';
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.suspendCalls += 1;
    if (this.state !== 'closed') this.state = 'suspended';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    this.state = 'closed';
    return Promise.resolve();
  }

  createGain(): FakeGainNode {
    return new FakeGainNode(this);
  }

  createOscillator(): FakeOscillatorNode {
    return new FakeOscillatorNode(this);
  }

  createBufferSource(): FakeBufferSourceNode {
    return new FakeBufferSourceNode(this);
  }

  createBiquadFilter(): FakeBiquadFilterNode {
    return new FakeBiquadFilterNode(this);
  }

  createStereoPanner(): FakeStereoPannerNode {
    return new FakeStereoPannerNode(this);
  }

  createDynamicsCompressor(): FakeCompressorNode {
    return new FakeCompressorNode(this);
  }

  createConvolver(): FakeConvolverNode {
    return new FakeConvolverNode(this);
  }

  createWaveShaper(): FakeWaveShaperNode {
    return new FakeWaveShaperNode(this);
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): FakeAudioBuffer {
    return new FakeAudioBuffer(numberOfChannels, length, sampleRate);
  }

  // --- Helpers for tests -----------------------------------------------------------

  /** Move the clock forward. */
  advance(seconds: number): void {
    this.currentTime += seconds;
  }

  /** Every live connection, node to node or node to parameter. */
  connectionCount(): number {
    return this.nodes.reduce((total, node) => total + node.outputs.size, 0);
  }

  /** Sources that are started and not yet stopped at `time`. */
  playingSources(time = this.currentTime): FakeSourceNode[] {
    return this.nodes.filter((node): node is FakeSourceNode => node instanceof FakeSourceNode && node.playingAt(time));
  }

  /** As a real AudioContext, for `createAudioEngine({ contextFactory })`. */
  asAudioContext(): AudioContext {
    return this as unknown as AudioContext;
  }
}

/** The fake behind a node the engine handed back. */
export function fakeGain(node: GainNode): FakeGainNode {
  return node as unknown as FakeGainNode;
}

export function fakeParam(parameter: AudioParam): FakeAudioParam {
  return parameter as unknown as FakeAudioParam;
}

/** Nodes connected straight into `node`. */
export function inputsOf(node: AudioNode): FakeAudioNode[] {
  return [...(node as unknown as FakeAudioNode).inputs];
}
