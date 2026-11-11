import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAudioEngine } from '../../src/audio/index.ts';
import type { AudioEngine } from '../../src/audio/index.ts';
import { createEngineCore } from '../../src/audio/engine.ts';
import { FakeAudioContext } from './fake-audio-context.ts';
import { ALL_EVENTS, createRig, newGame } from './support.ts';

/** Call everything the interface offers. */
function exercise(engine: AudioEngine): void {
  const state = newGame();
  engine.setVolumes({ master: 0.5, music: 0.5, effects: 0.5, ambience: 0.5 });
  engine.setScene('game');
  engine.handleEvents(ALL_EVENTS);
  engine.update(state, 1 / 60);
  for (const sound of ['hover', 'click', 'open', 'close', 'error', 'tab'] as const) engine.playInterface(sound);
  engine.setScene('paused');
  engine.setScene('credits');
  engine.setScene('lobby');
  engine.suspend();
  engine.resume();
}

/** The least of a page the engine needs: a hidden flag and one event. */
function stubDocument(): { document: { hidden: boolean }; fire: () => void; listenerCount: () => number } {
  const listeners = new Set<() => void>();
  const document = {
    hidden: false,
    addEventListener(type: string, listener: () => void): void {
      if (type === 'visibilitychange') listeners.add(listener);
    },
    removeEventListener(type: string, listener: () => void): void {
      if (type === 'visibilitychange') listeners.delete(listener);
    },
  };
  vi.stubGlobal('document', document);
  return { document, fire: () => listeners.forEach((listener) => listener()), listenerCount: () => listeners.size };
}

/** Let the engine's own promises settle. */
const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('lifecycle', () => {
  it('ships exactly the frozen interface', () => {
    const engine = createAudioEngine();
    expect(Object.keys(engine).sort()).toEqual([
      'dispose', 'handleEvents', 'playInterface', 'resume', 'setScene', 'setVolumes', 'suspend', 'unlock', 'update',
    ]);
    for (const method of Object.values(engine)) expect(typeof method).toBe('function');
    expect(engine.unlock()).toBeInstanceOf(Promise);
    engine.dispose();
  });

  it('does nothing and throws nothing before unlock', () => {
    const factory = vi.fn(() => new FakeAudioContext().asAudioContext());
    const engine = createAudioEngine({ contextFactory: factory });
    expect(() => exercise(engine)).not.toThrow();
    // No audio resource is made until a gesture asks for it.
    expect(factory).not.toHaveBeenCalled();
    expect(() => engine.dispose()).not.toThrow();
  });

  it('does nothing and throws nothing where WebAudio is missing', async () => {
    expect((globalThis as { AudioContext?: unknown }).AudioContext).toBeUndefined();
    const engine = createAudioEngine();
    await expect(engine.unlock()).resolves.toBeUndefined();
    expect(() => exercise(engine)).not.toThrow();
    await expect(engine.unlock()).resolves.toBeUndefined();
    expect(() => engine.dispose()).not.toThrow();
  });

  it('stays silent when the context cannot be made', async () => {
    const engine = createEngineCore({
      contextFactory: () => {
        throw new Error('NotSupportedError');
      },
    });
    await expect(engine.unlock()).resolves.toBeUndefined();
    expect(engine.inspector.nodes()).toBeNull();
    expect(() => exercise(engine)).not.toThrow();
    engine.dispose();
  });

  it('uses the browser AudioContext when there is one', async () => {
    const made: FakeAudioContext[] = [];
    vi.stubGlobal('AudioContext', function FakeConstructor() {
      const context = new FakeAudioContext();
      made.push(context);
      return context;
    });
    const engine = createAudioEngine();
    await engine.unlock();
    expect(made).toHaveLength(1);
    expect(made[0].state).toBe('running');
    expect(made[0].connectionCount()).toBeGreaterThan(50);
    engine.dispose();
    expect(made[0].connectionCount()).toBe(0);
  });

  it('builds once however often unlock is called, and resumes each time', async () => {
    const context = new FakeAudioContext();
    const factory = vi.fn(() => context.asAudioContext());
    const engine = createEngineCore({ contextFactory: factory, autoTick: false, followPageVisibility: false });
    await engine.unlock();
    const nodesAfterFirst = context.nodes.length;
    expect(context.state).toBe('running');
    await engine.unlock();
    await engine.unlock();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(context.nodes.length).toBe(nodesAfterFirst);

    // The browser suspended it behind our back: the next gesture brings it back.
    context.state = 'suspended';
    await engine.unlock();
    expect(context.state).toBe('running');
    engine.dispose();
  });

  it('works through every method once unlocked', async () => {
    const { context, engine } = await createRig();
    expect(() => exercise(engine)).not.toThrow();
    await settle();
    expect(context.state).toBe('running');
    expect(engine.inspector.voiceCount()).toBeGreaterThan(0);
    engine.dispose();
  });

  it('suspends and resumes on request', async () => {
    const { context, engine } = await createRig();
    engine.suspend();
    await settle();
    expect(context.state).toBe('suspended');
    // A gesture does not override an explicit suspend.
    await engine.unlock();
    expect(context.state).toBe('suspended');
    engine.resume();
    await settle();
    expect(context.state).toBe('running');
    engine.dispose();
  });

  it('suspends while the page is hidden', async () => {
    const page = stubDocument();
    const context = new FakeAudioContext();
    const engine = createEngineCore({ contextFactory: () => context.asAudioContext(), autoTick: false });
    await engine.unlock();
    expect(page.listenerCount()).toBe(1);
    expect(context.state).toBe('running');

    page.document.hidden = true;
    page.fire();
    await settle();
    expect(context.state).toBe('suspended');

    // Coming back to the page resumes, unless the game suspended it as well.
    engine.suspend();
    page.document.hidden = false;
    page.fire();
    await settle();
    expect(context.state).toBe('suspended');
    engine.resume();
    await settle();
    expect(context.state).toBe('running');

    engine.dispose();
    expect(page.listenerCount()).toBe(0);
  });

  it('does not start sounding on a page that is already hidden', async () => {
    const page = stubDocument();
    page.document.hidden = true;
    const context = new FakeAudioContext();
    const engine = createEngineCore({ contextFactory: () => context.asAudioContext(), autoTick: false });
    await engine.unlock();
    expect(context.state).toBe('suspended');
    engine.dispose();
  });

  it('keeps the lobby going from its own timer when no frame calls update', async () => {
    vi.useFakeTimers();
    const context = new FakeAudioContext();
    const engine = createEngineCore({ contextFactory: () => context.asAudioContext(), followPageVisibility: false, seed: 5 });
    await engine.unlock();
    expect(vi.getTimerCount()).toBe(1);
    for (let index = 0; index < 100; index += 1) {
      context.advance(0.2);
      vi.advanceTimersByTime(200);
    }
    expect(engine.inspector.voicesStarted('pad')).toBeGreaterThanOrEqual(1);
    expect(engine.inspector.voicesStarted('wavelet')).toBeGreaterThan(5);

    // Suspended: the timer idles instead of piling up work.
    engine.suspend();
    await settle();
    const padsWhenSuspended = engine.inspector.voicesStarted('pad');
    const waveletsWhenSuspended = engine.inspector.voicesStarted('wavelet');
    for (let index = 0; index < 100; index += 1) vi.advanceTimersByTime(200);
    expect(engine.inspector.voicesStarted('pad')).toBe(padsWhenSuspended);
    expect(engine.inspector.voicesStarted('wavelet')).toBe(waveletsWhenSuspended);

    engine.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('dispose leaves no node connected, no source running, and the context closed', async () => {
    const { context, engine } = await createRig();
    const state = newGame();
    engine.setScene('game');
    engine.handleEvents(ALL_EVENTS);
    for (let frame = 0; frame < 600; frame += 1) {
      context.advance(1 / 60);
      engine.update(state, 1 / 60);
    }
    engine.playInterface('click');
    expect(context.connectionCount()).toBeGreaterThan(100);
    expect(context.playingSources().length).toBeGreaterThan(20);

    engine.dispose();
    expect(context.connectionCount()).toBe(0);
    for (const node of context.nodes) {
      expect(node.outputs.size).toBe(0);
      expect(node.inputs.size).toBe(0);
    }
    expect(context.playingSources(context.currentTime + 0.001)).toHaveLength(0);
    expect(context.state).toBe('closed');
    expect(context.closeCalls).toBe(1);
    expect(engine.inspector.trackedNodeCount()).toBe(0);
    expect(engine.inspector.nodes()).toBeNull();
  });

  it('stays silent after dispose, and does not come back', async () => {
    const { context, engine } = await createRig();
    engine.dispose();
    const nodeCount = context.nodes.length;
    expect(() => exercise(engine)).not.toThrow();
    await engine.unlock();
    expect(() => engine.dispose()).not.toThrow();
    expect(context.nodes.length).toBe(nodeCount);
    expect(context.connectionCount()).toBe(0);
    expect(context.closeCalls).toBe(1);
    expect(context.resumeCalls).toBe(1);
  });
});
