import { describe, expect, it } from 'vitest';
import { ISLANDS_BY_ID, NPCS, spotPosition } from '../src/data/index.ts';
import type { NpcId } from '../src/data/index.ts';
import { dispatch, selectDialogue, selectInteractable } from '../src/sim/index.ts';
import type { GameState } from '../src/sim/index.ts';
import { countIn, give, newGame, run, standOn, teleport } from './support.ts';

function beside(state: GameState, npcId: NpcId): void {
  const npc = NPCS[npcId];
  standOn(state, npc.islandId);
  const position = spotPosition(ISLANDS_BY_ID[npc.islandId], npc.spot);
  teleport(state, npc.islandId, position.x + 1.5, position.z);
}

describe('talking to survivors', () => {
  it('needs you to be beside them', () => {
    const state = newGame();
    standOn(state, 'steeple_rock');
    expect(dispatch(state, { type: 'talk', npcId: 'wren' })).toMatchObject({ ok: false, reason: 'npc_out_of_reach' });
    beside(state, 'wren');
    expect(selectInteractable(state)).toMatchObject({ kind: 'npc', npcId: 'wren', prompt: 'Talk to Wren', command: { type: 'talk', npcId: 'wren' } });
    expect(dispatch(state, { type: 'talk', npcId: 'wren' }).ok).toBe(true);
    expect(selectDialogue(state)).toMatchObject({ npcId: 'wren', name: 'Wren' });
    expect(selectInteractable(state)).toBeNull();
  });

  it('has Wren teach sailcloth and hand over cloth, once', () => {
    const state = newGame();
    beside(state, 'wren');
    dispatch(state, { type: 'talk', npcId: 'wren' });
    const first = selectDialogue(state)!;
    expect(first.options).toHaveLength(1);
    expect(dispatch(state, { type: 'choose_dialogue_option', optionIndex: 0 }).ok).toBe(true);
    expect(state.flags.wren_taught_sailcloth).toBe(true);
    expect(countIn(state.player.backpack, 'cloth')).toBe(4);
    expect(selectDialogue(state)!.text).toContain('flat seam');
    dispatch(state, { type: 'choose_dialogue_option', optionIndex: 0 }); // to the hub
    const hub = selectDialogue(state)!;
    const leave = hub.options.find((option) => option.text.startsWith('Fair winds'))!;
    expect(dispatch(state, { type: 'choose_dialogue_option', optionIndex: leave.index }).ok).toBe(true);
    expect(selectDialogue(state)).toBeNull();
    // Second visit opens on the hub: no second gift.
    dispatch(state, { type: 'talk', npcId: 'wren' });
    expect(selectDialogue(state)!.text).toContain('Six bells');
    expect(countIn(state.player.backpack, 'cloth')).toBe(4);
  });

  it('has Tink give the wrench', () => {
    const state = newGame();
    beside(state, 'tink');
    dispatch(state, { type: 'talk', npcId: 'tink' });
    dispatch(state, { type: 'choose_dialogue_option', optionIndex: 0 });
    expect(state.player.tools).toContain('wrench');
    expect(state.flags.tink_gave_wrench).toBe(true);
  });

  it('shows only the options whose conditions hold, and runs quests through them', () => {
    const state = newGame();
    beside(state, 'odile');
    dispatch(state, { type: 'talk', npcId: 'odile' });
    dispatch(state, { type: 'choose_dialogue_option', optionIndex: 0 }); // meet: apples
    expect(countIn(state.player.backpack, 'apple')).toBe(4);
    dispatch(state, { type: 'choose_dialogue_option', optionIndex: 0 }); // to the hub
    const texts = (): string[] => selectDialogue(state)!.options.map((option) => option.text);
    expect(texts()).toContain('Can I help with the orchard?');
    expect(texts()).not.toContain('I brought your apples.');
    expect(texts()).not.toContain('Those empty jars on the sill?'); // locked until Windfall is done

    const offer = selectDialogue(state)!.options.find((option) => option.text === 'Can I help with the orchard?')!;
    dispatch(state, { type: 'choose_dialogue_option', optionIndex: offer.index });
    dispatch(state, { type: 'choose_dialogue_option', optionIndex: 0 }); // accept
    expect(state.quests.odile_windfall.status).toBe('active');
    expect(texts()).not.toContain('Can I help with the orchard?');

    give(state, 'apple', 2); // now six
    dispatch(state, { type: 'end_dialogue' });
    dispatch(state, { type: 'talk', npcId: 'odile' });
    const handIn = selectDialogue(state)!.options.find((option) => option.text === 'I brought your apples.')!;
    expect(dispatch(state, { type: 'choose_dialogue_option', optionIndex: handIn.index }).ok).toBe(true);
    expect(state.quests.odile_windfall.status).toBe('completed');
    expect(countIn(state.player.backpack, 'apple')).toBe(0);
    expect(countIn(state.player.backpack, 'seeds')).toBe(4);
    dispatch(state, { type: 'choose_dialogue_option', optionIndex: 0 });
    expect(texts()).toContain('Those empty jars on the sill?');
  });

  it('holds you still while it is open, and blocks other commands', () => {
    const state = newGame();
    beside(state, 'wren');
    give(state, 'berries', 1);
    dispatch(state, { type: 'talk', npcId: 'wren' });
    const before = { ...state.player.position };
    const events = run(state, { moveX: 1, run: true }, 2);
    expect(state.player.position).toEqual(before);
    expect(dispatch(state, { type: 'eat', itemId: 'berries' })).toMatchObject({ ok: false, reason: 'in_dialogue' });
    expect(dispatch(state, { type: 'choose_dialogue_option', optionIndex: 9 })).toMatchObject({ ok: false, reason: 'invalid_option' });
    expect(dispatch(state, { type: 'end_dialogue' }).ok).toBe(true);
    expect(dispatch(state, { type: 'end_dialogue' })).toMatchObject({ ok: false, reason: 'no_dialogue_open' });
    expect(dispatch(state, { type: 'choose_dialogue_option', optionIndex: 0 })).toMatchObject({ ok: false, reason: 'no_dialogue_open' });
    expect(events.every((event) => event.type !== 'dialogue_closed')).toBe(true);
    run(state, { moveX: 1 }, 1);
    expect(state.player.position.x).toBeGreaterThan(before.x + 2);
  });

  it('counts a conversation toward "meet" objectives', () => {
    const state = newGame();
    state.quests.bail_out.status = 'completed';
    state.quests.the_bellkeeper.status = 'active';
    beside(state, 'wren');
    dispatch(state, { type: 'talk', npcId: 'wren' });
    expect(state.quests.the_bellkeeper.progress.slice(0, 2)).toEqual([1, 1]);
  });
});
