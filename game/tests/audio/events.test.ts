import { describe, expect, it } from 'vitest';
import { NODE_TYPES, STATIONS } from '../../src/data/index.ts';
import type { NodeTypeId, StationId } from '../../src/data/index.ts';
import type { GameEvent, GameEventType } from '../../src/sim/index.ts';
import {
  CUES, CUE_NAMES, EVENT_CUES, SCAVENGE_STYLE, SILENT_EVENTS, resolveEventCue, scavengeRequest,
} from '../../src/audio/cues.ts';
import type { CueName } from '../../src/audio/cues.ts';
import { inputsOf } from './fake-audio-context.ts';
import { ALL_EVENTS, SAMPLE_EVENTS, createRig, newGame, nodeOfType } from './support.ts';

const EVENT_TYPES = Object.keys(SAMPLE_EVENTS) as GameEventType[];
const cueOf = (event: GameEvent): CueName | null => resolveEventCue(event, { state: null })?.cue ?? null;

describe('event cues', () => {
  it('maps every event type, and nothing else', () => {
    // SAMPLE_EVENTS is compiler-checked against the event union; the table must match it key for key.
    expect(Object.keys(EVENT_CUES).sort()).toEqual([...EVENT_TYPES].sort());
    expect(EVENT_TYPES.length).toBe(43);
  });

  it('gives every event a known cue or a deliberate silence', () => {
    for (const event of ALL_EVENTS) {
      const cue = cueOf(event);
      if (cue === null) expect(SILENT_EVENTS).toContain(event.type);
      else expect(CUE_NAMES).toContain(cue);
    }
  });

  it('keeps silent only the three bookkeeping events', () => {
    expect([...SILENT_EVENTS].sort()).toEqual(['autosave_requested', 'rewards_pending', 'weather_changed']);
  });

  it('plays a voice on the effects bus for every event that has a cue', async () => {
    const { context, engine, nodes } = await createRig();
    for (const event of ALL_EVENTS) {
      const cue = cueOf(event);
      // Long enough for the previous cue to ring out and for any minimum interval to pass.
      context.advance(12);
      engine.inspector.tick();
      expect(inputsOf(nodes.inputs.effects)).toHaveLength(0);
      const before = cue ? engine.inspector.voicesStarted(cue) : 0;
      const sourcesBefore = context.playingSources(context.currentTime + 0.01).length;
      engine.handleEvents([event]);
      if (cue === null) {
        expect(inputsOf(nodes.inputs.effects), event.type).toHaveLength(0);
      } else {
        expect(engine.inspector.voicesStarted(cue), event.type).toBe(before + 1);
        expect(inputsOf(nodes.inputs.effects), event.type).toHaveLength(1);
        expect(context.playingSources(context.currentTime + 0.01).length, event.type).toBeGreaterThan(sourcesBefore);
      }
    }
    engine.dispose();
  });

  it('picks the variant from the event', () => {
    expect(cueOf({ type: 'item_gained', itemId: 'driftwood', count: 1, container: 'cargo' })).toBe('item_gained');
    expect(cueOf({ type: 'item_gained', itemId: 'hatchet', count: 1, container: 'belt' })).toBe('item_gained_special');
    expect(cueOf({ type: 'item_gained', itemId: 'lens', count: 1, container: 'key_items' })).toBe('item_gained_special');
    expect(cueOf({ type: 'lantern_toggled', lit: true })).toBe('lantern_lit');
    expect(cueOf({ type: 'lantern_toggled', lit: false })).toBe('lantern_out');
    expect(cueOf({ type: 'sail_changed', raised: true })).toBe('sail_raised');
    expect(cueOf({ type: 'sail_changed', raised: false })).toBe('sail_lowered');
    expect(cueOf({ type: 'meter_low', meter: 'hunger' })).toBe('meter_hunger');
    expect(cueOf({ type: 'meter_low', meter: 'thirst' })).toBe('meter_thirst');
    expect(cueOf({ type: 'meter_low', meter: 'energy' })).toBe('meter_energy');
    expect(cueOf({ type: 'game_completed' })).toBe('beacon_lit');
  });

  it('picks the crafting cue from the recipe station', () => {
    const byStation: Record<StationId, CueName> = {
      hands: 'craft_hands', fire: 'craft_fire', bench: 'craft_bench', smoker: 'craft_smoker', forge: 'craft_forge',
    };
    const recipes = { hands: 'rope', fire: 'pitch', bench: 'plank', smoker: 'smoked_fish', forge: 'hardware' } as const;
    for (const station of Object.keys(STATIONS) as StationId[]) {
      expect(cueOf({ type: 'crafted', recipeId: recipes[station], count: 1 }), station).toBe(byStation[station]);
    }
  });

  it('gives every node type a scavenging sound, and chops when the hatchet is used', () => {
    for (const typeId of Object.keys(NODE_TYPES) as NodeTypeId[]) {
      expect(SCAVENGE_STYLE[typeId], typeId).toBeDefined();
      expect(scavengeRequest(nodeOfType(typeId), 0), typeId).not.toBeNull();
    }
    const kinds = new Set(Object.values(SCAVENGE_STYLE).map((style) => style.kind));
    expect([...kinds].sort()).toEqual(['chop', 'pick', 'pry', 'rummage', 'splash']);

    const spruce = nodeOfType('spruce');
    expect(scavengeRequest(spruce, 0)?.cue).toBe('scavenge_pick');
    expect(scavengeRequest(spruce, 1)?.cue).toBe('scavenge_chop');
    // With the state in hand, the event knows which action is being held.
    const state = newGame();
    state.players[0].harvest = { nodeId: spruce, actionIndex: 1, progress: 0 };
    expect(resolveEventCue({ type: 'harvest_started', nodeId: spruce }, { state })?.cue).toBe('scavenge_chop');
    expect(scavengeRequest('no.such.node', 0)).toBeNull();
  });

  it('can play every cue, each one finite and with something to hear', async () => {
    const { context, engine } = await createRig();
    for (const cue of CUE_NAMES) {
      context.advance(12);
      engine.inspector.tick();
      const sourcesBefore = context.playingSources(context.currentTime + 0.01).length;
      expect(engine.inspector.playCue({ cue }), cue).toBe(true);
      expect(context.playingSources(context.currentTime + 0.01).length, cue).toBeGreaterThan(sourcesBefore);
      expect(CUES[cue].priority, cue).toBeGreaterThanOrEqual(1);
      expect(CUES[cue].priority, cue).toBeLessThanOrEqual(5);
    }
    // Every cue ends: nothing is left sounding a minute later.
    context.advance(60);
    expect(engine.inspector.voiceCount('effects')).toBe(0);
    engine.dispose();
  });

  it('drops events before unlock without throwing', () => {
    expect(() => resolveEventCue(SAMPLE_EVENTS.capsized, { state: null })).not.toThrow();
  });
});
