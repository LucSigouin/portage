import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../src/sim/index.ts';
import { createAudioGraph, createSeededRandom } from '../../src/audio/graph.ts';
import { INTERFACE_SOUND_NAMES } from '../../src/audio/interface-sounds.ts';
import { STEAL_MARGIN, VOICE_LIMITS, createVoicePool } from '../../src/audio/voices.ts';
import type { BusInput, BusName, VoicePool } from '../../src/audio/voices.ts';
import { FakeAudioContext, inputsOf } from './fake-audio-context.ts';
import { ALL_EVENTS, createRig } from './support.ts';

/** A bare pool on a fake context, with one input node per bus. */
function createPool(): { context: FakeAudioContext; pool: VoicePool; inputs: Record<BusName, BusInput>; nodeCount: () => number } {
  const context = new FakeAudioContext();
  const graph = createAudioGraph(context.asAudioContext(), createSeededRandom(1));
  const input = (): BusInput => ({ dry: graph.gain(1), reverb: graph.gain(1) });
  const inputs: Record<BusName, BusInput> = { music: input(), effects: input(), ambience: input(), interface: input() };
  return { context, pool: createVoicePool(graph, inputs), inputs, nodeCount: () => graph.trackedNodeCount() };
}

const beep = (pool: VoicePool, priority: number, label = 'beep'): boolean => {
  const voice = pool.open({ bus: 'effects', label, priority, reverb: 0.2 });
  voice?.tone({ frequency: 440, gain: 0.2, decay: 1 });
  return voice !== null;
};

describe('voices', () => {
  it('releases a voice and every node it made once it has rung out', async () => {
    const { context, engine, nodes } = await createRig();
    const idleNodes = engine.inspector.trackedNodeCount();
    const idleConnections = context.connectionCount();

    expect(engine.inspector.playCue({ cue: 'quest_completed' })).toBe(true);
    expect(engine.inspector.voiceCount('effects')).toBe(1);
    expect(inputsOf(nodes.inputs.effects)).toHaveLength(1);
    expect(engine.inspector.trackedNodeCount()).toBeGreaterThan(idleNodes + 20);
    expect(context.connectionCount()).toBeGreaterThan(idleConnections);

    // Still sounding half a second in.
    context.advance(0.5);
    expect(engine.inspector.voiceCount('effects')).toBe(1);

    context.advance(10);
    expect(engine.inspector.voiceCount('effects')).toBe(0);
    expect(inputsOf(nodes.inputs.effects)).toHaveLength(0);
    expect(engine.inspector.trackedNodeCount()).toBe(idleNodes);
    expect(context.connectionCount()).toBe(idleConnections);
    engine.dispose();
  });

  it('holds the voice cap under a burst of 200 events', async () => {
    const { context, engine, nodes } = await createRig();
    const burst: GameEvent[] = Array.from({ length: 200 }, (_unused, index) => ALL_EVENTS[index % ALL_EVENTS.length]);
    let mostVoices = 0;
    let mostInputs = 0;
    const measure = (): void => {
      mostVoices = Math.max(mostVoices, engine.inspector.voiceCount('effects'));
      mostInputs = Math.max(mostInputs, inputsOf(nodes.inputs.effects).length);
    };

    // All 200 in one frame.
    engine.handleEvents(burst);
    measure();
    // Then 200 more, five milliseconds apart, so the minimum intervals keep expiring.
    for (const event of burst) {
      context.advance(0.005);
      engine.handleEvents([event]);
      measure();
    }
    // Then a second of frames with 200 events in each.
    for (let frame = 0; frame < 60; frame += 1) {
      context.advance(1 / 60);
      engine.handleEvents(burst);
      measure();
    }

    expect(mostVoices).toBeGreaterThan(10);
    expect(mostVoices).toBeLessThanOrEqual(VOICE_LIMITS.effects);
    // Voices being faded out after a steal still hold nodes for a moment, but only a few.
    expect(mostInputs).toBeLessThanOrEqual(VOICE_LIMITS.effects + STEAL_MARGIN);

    // And it all drains away.
    context.advance(30);
    expect(engine.inspector.voiceCount()).toBe(0);
    expect(inputsOf(nodes.inputs.effects)).toHaveLength(0);
    engine.dispose();
  });

  it('collapses a burst of one event into one sound', async () => {
    const { engine } = await createRig();
    const gained: GameEvent = { type: 'item_gained', itemId: 'driftwood', count: 1, container: 'backpack' };
    engine.handleEvents(Array.from({ length: 200 }, () => gained));
    expect(engine.inspector.voiceCount('effects')).toBe(1);
    expect(engine.inspector.voicesStarted('item_gained')).toBe(1);
    engine.dispose();
  });

  it('caps the pool itself, with no minimum interval to help', () => {
    const { pool, inputs } = createPool();
    let accepted = 0;
    for (let index = 0; index < 200; index += 1) if (beep(pool, 2)) accepted += 1;
    expect(pool.activeCount('effects')).toBe(VOICE_LIMITS.effects);
    expect(inputsOf(inputs.effects.dry).length).toBeLessThanOrEqual(VOICE_LIMITS.effects + STEAL_MARGIN);
    // The first fill, then one steal per slot in the margin; the rest are refused.
    expect(accepted).toBe(VOICE_LIMITS.effects + STEAL_MARGIN);
  });

  it('lets an important voice in when the bus is full, and refuses a lesser one', () => {
    const { pool } = createPool();
    for (let index = 0; index < VOICE_LIMITS.effects; index += 1) expect(beep(pool, 3, 'routine')).toBe(true);
    expect(beep(pool, 1, 'foley')).toBe(false);
    expect(beep(pool, 5, 'capsized')).toBe(true);
    expect(pool.activeLabels('effects')).toContain('capsized');
    expect(pool.activeLabels('effects').filter((label) => label === 'routine')).toHaveLength(VOICE_LIMITS.effects - 1);
    expect(pool.activeCount('effects')).toBe(VOICE_LIMITS.effects);
  });

  it('frees stolen voices within a tenth of a second', () => {
    const { context, pool, inputs, nodeCount } = createPool();
    const idle = nodeCount();
    for (let index = 0; index < VOICE_LIMITS.effects + STEAL_MARGIN; index += 1) beep(pool, 2);
    expect(inputsOf(inputs.effects.dry)).toHaveLength(VOICE_LIMITS.effects + STEAL_MARGIN);
    context.advance(0.1);
    pool.reap();
    expect(inputsOf(inputs.effects.dry)).toHaveLength(VOICE_LIMITS.effects);
    context.advance(5);
    pool.reap();
    expect(pool.activeCount()).toBe(0);
    expect(nodeCount()).toBe(idle);
  });

  it('keeps each bus to its own budget', () => {
    const { pool } = createPool();
    for (const bus of ['music', 'effects', 'ambience', 'interface'] as const) {
      for (let index = 0; index < 60; index += 1) {
        pool.open({ bus, label: bus, priority: 1 })?.tone({ frequency: 300, gain: 0.1, decay: 2 });
      }
      expect(pool.activeCount(bus), bus).toBe(VOICE_LIMITS[bus]);
    }
  });

  it('plays every interface sound on its own bus and frees it', async () => {
    const { context, engine, nodes } = await createRig();
    for (const sound of INTERFACE_SOUND_NAMES) {
      context.advance(1);
      engine.playInterface(sound);
      expect(engine.inspector.voiceLabels('interface'), sound).toEqual([`interface:${sound}`]);
      expect(inputsOf(nodes.inputs.interface), sound).toHaveLength(1);
      expect(inputsOf(nodes.inputs.effects), sound).toHaveLength(0);
    }
    expect(INTERFACE_SOUND_NAMES.sort()).toEqual(['click', 'close', 'error', 'hover', 'open', 'tab']);

    // Dragging across a row of buttons cannot machine-gun the hover sound.
    context.advance(1);
    for (let index = 0; index < 50; index += 1) engine.playInterface('hover');
    expect(engine.inspector.voiceCount('interface')).toBe(1);
    context.advance(2);
    expect(engine.inspector.voiceCount('interface')).toBe(0);
    engine.dispose();
  });
});
