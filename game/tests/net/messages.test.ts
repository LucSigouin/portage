/** The messages a guest may send, read on the host: exactly what is listed gets through, nothing else. */
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, readClientMessage, readCommand, readHostMessage, readInput } from '../../src/net/index.ts';
import { NEUTRAL_INPUT } from '../../src/sim/index.ts';
import type { Command } from '../../src/sim/index.ts';

const v = PROTOCOL_VERSION;
const KEY = 'key-sam-0123456789';

describe('a guest\'s message', () => {
  it('is read when it is exactly one of the five', () => {
    expect(readClientMessage({ v, type: 'join', name: 'Sam', key: KEY })).toEqual({ v, type: 'join', name: 'Sam', key: KEY });
    expect(readClientMessage({ v, type: 'input', seq: 3, have: -1, events: 0, input: { ...NEUTRAL_INPUT, paddle: 1 }, step: 0, walk: [] }))
      .toMatchObject({ type: 'input', seq: 3, input: { paddle: 1 } });
    expect(readClientMessage({ v, type: 'command', id: 1, command: { type: 'board' }, at: 0 })).toEqual({ v, type: 'command', id: 1, command: { type: 'board' }, at: 0 });
    expect(readClientMessage({ v, type: 'ping', time: 1.5, have: 4, events: 2 })).toEqual({ v, type: 'ping', time: 1.5, have: 4, events: 2 });
    expect(readClientMessage({ v, type: 'leave' })).toEqual({ v, type: 'leave' });
  });

  it('is refused when it names a player: nothing on the wire says who it is for', () => {
    const input = { ...NEUTRAL_INPUT };
    expect(readClientMessage({ v, type: 'input', seq: 1, have: 0, events: 0, input, step: 0, walk: [], playerId: 0 })).toBeNull();
    expect(readClientMessage({ v, type: 'input', seq: 1, have: 0, events: 0, input: { ...input, playerId: 0 }, step: 0, walk: [] })).toBeNull();
    expect(readClientMessage({ v, type: 'command', id: 1, command: { type: 'board' }, at: 0, playerId: 0 })).toBeNull();
    expect(readClientMessage({ v, type: 'command', id: 1, command: { type: 'board', playerId: 0 }, at: 0 })).toBeNull();
    expect(readClientMessage({ v, type: 'command', id: 1, command: { type: 'eat', itemId: 'berries', as: 2 }, at: 0 })).toBeNull();
    expect(readClientMessage({ v, type: 'join', name: 'Sam', key: KEY, playerId: 0 })).toBeNull();
    expect(readClientMessage({ v, type: 'leave', playerId: 1 })).toBeNull();
    expect(readClientMessage({ v, type: 'ping', time: 0, have: 0, events: 0, playerId: 1 })).toBeNull();
  });

  it('is refused when it is one of the host\'s: a guest cannot send state, events, results or a welcome', () => {
    for (const type of ['welcome', 'state', 'events', 'result', 'set_state', '', 'constructor', '__proto__']) {
      expect(readClientMessage({ v, type, id: 1, step: 1, hash: 'x', base: null, changed: { time: 0 }, state: {}, events: [] }), type).toBeNull();
    }
  });

  it('is refused when it is not a message at all, or of another version', () => {
    for (const junk of [null, undefined, 7, 'join', [], [{ v, type: 'leave' }], {}, { type: 'leave' }, { v: v + 1, type: 'leave' }, { v: '1', type: 'leave' }]) {
      expect(readClientMessage(junk)).toBeNull();
    }
  });

  it('is refused when a number is not a number, or a key is not a key', () => {
    const input = { ...NEUTRAL_INPUT };
    for (const seq of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '3', null]) {
      expect(readClientMessage({ v, type: 'input', seq, have: 0, events: 0, input, step: 0, walk: [] })).toBeNull();
    }
    for (const id of [0, -4, 2.5, '1', null, Number.MAX_SAFE_INTEGER + 2]) {
      expect(readClientMessage({ v, type: 'command', id, command: { type: 'board' }, at: 0 })).toBeNull();
    }
    for (const key of ['', 'short', 'has spaces in it!!', 'x'.repeat(65), 7, null]) {
      expect(readClientMessage({ v, type: 'join', name: 'Sam', key })).toBeNull();
    }
    expect(readClientMessage({ v, type: 'join', name: 7, key: KEY })).toBeNull();
    expect(readClientMessage({ v, type: 'join', name: 'x'.repeat(201), key: KEY })).toBeNull();
  });
});

describe('an input from the wire', () => {
  it('is the eight fields and nothing else, with the axes clamped', () => {
    expect(readInput({ ...NEUTRAL_INPUT })).toEqual(NEUTRAL_INPUT);
    expect(readInput({ ...NEUTRAL_INPUT, paddle: 50, steer: -9, moveX: 3, moveY: -3 })).toMatchObject({ paddle: 1, steer: -1, moveX: 1, moveY: -1 });
    const { run: _run, ...short } = { ...NEUTRAL_INPUT };
    expect(readInput(short)).toBeNull();
    expect(readInput({ ...NEUTRAL_INPUT, extra: 1 })).toBeNull();
    expect(readInput({ ...NEUTRAL_INPUT, paddle: Number.NaN })).toBeNull();
    expect(readInput({ ...NEUTRAL_INPUT, paddle: '1' })).toBeNull();
    expect(readInput({ ...NEUTRAL_INPUT, bail: 1 })).toBeNull();
    expect(readInput({ ...NEUTRAL_INPUT, cameraYaw: Number.POSITIVE_INFINITY })).toBeNull();
    expect(readInput({ ...NEUTRAL_INPUT, cameraYaw: 1e9 })).toBeNull();
    expect(readInput(null)).toBeNull();
  });
});

describe('a command from the wire', () => {
  const good: Command[] = [
    { type: 'craft', recipeId: 'stone_knife' }, { type: 'craft', recipeId: 'stone_knife', count: 3 }, { type: 'upgrade_hull' },
    { type: 'build_attachment', attachmentId: 'canopy' }, { type: 'stow_backpack' },
    { type: 'transfer', from: 'backpack', itemId: 'driftwood', count: 2 }, { type: 'discard', from: 'cargo', itemId: 'driftwood', count: 1 },
    { type: 'eat', itemId: 'berries' }, { type: 'drink', itemId: 'clean_water' }, { type: 'fill_water', count: 1 }, { type: 'scavenge' },
    { type: 'sleep' }, { type: 'wake' }, { type: 'board' }, { type: 'disembark' }, { type: 'talk', npcId: 'odile' },
    { type: 'choose_dialogue_option', optionIndex: 0 }, { type: 'end_dialogue' }, { type: 'accept_quest', questId: 'first_haul' },
    { type: 'turn_in_quest', questId: 'first_haul' }, { type: 'track_quest', questId: null }, { type: 'track_quest', questId: 'bail_out' },
    { type: 'toggle_lantern' }, { type: 'select_tool', toolId: 'hatchet' }, { type: 'select_tool', toolId: null },
    { type: 'set_sail', raised: true }, { type: 'claim_rewards' }, { type: 'set_difficulty', difficulty: 'relaxed' },
  ];

  it('reads every command the game has, unchanged', () => {
    for (const command of good) expect(readCommand(JSON.parse(JSON.stringify(command))), command.type).toEqual(command);
    // Every type is covered: the list above has one of each.
    expect(new Set(good.map((command) => command.type)).size).toBe(25);
  });

  it('refuses an id the game does not have, so nothing reaches the rules that could trip them', () => {
    const bad: unknown[] = [
      { type: 'craft', recipeId: 'gold_bar' }, { type: 'craft', recipeId: 'constructor' }, { type: 'craft', recipeId: '__proto__' },
      { type: 'craft', recipeId: 'stone_knife', count: 0 }, { type: 'craft', recipeId: 'stone_knife', count: 1e9 },
      { type: 'build_attachment', attachmentId: 'cannon' }, { type: 'transfer', from: 'pocket', itemId: 'driftwood', count: 1 },
      { type: 'transfer', from: 'backpack', itemId: 'driftwood', count: -1 }, { type: 'discard', from: 'cargo', itemId: 'nothing', count: 1 },
      { type: 'eat', itemId: 'toString' }, { type: 'fill_water', count: 1.5 }, { type: 'talk', npcId: 'nobody' },
      { type: 'choose_dialogue_option', optionIndex: -1 }, { type: 'accept_quest', questId: 'hasOwnProperty' },
      { type: 'track_quest' }, { type: 'select_tool', toolId: 'sword' }, { type: 'set_sail', raised: 'yes' },
      { type: 'set_difficulty', difficulty: 'godmode' }, { type: 'teleport', x: 0, z: 0 }, { type: 'toString' }, { type: 7 }, {},
      null, 'board', ['board'],
    ];
    for (const command of bad) expect(readCommand(command), JSON.stringify(command)).toBeNull();
  });

  it('refuses a field the command does not have', () => {
    for (const command of good) expect(readCommand({ ...command, playerId: 0 }), command.type).toBeNull();
  });
});

describe('a host\'s message, as a guest reads it', () => {
  it('is read when it is one of the host\'s six and of this version', () => {
    const state = { players: [], time: 0 };
    expect(readHostMessage({ v, type: 'welcome', session: 1, sitting: 1, playerId: 1, hostId: 0, id: 1, step: 5, hash: 'ab', state, events: 0, walked: 0 })).not.toBeNull();
    expect(readHostMessage({ v, type: 'state', id: 2, step: 9, hash: 'ab', ack: -1, walked: 0, base: null, changed: state })).not.toBeNull();
    expect(readHostMessage({ v, type: 'state', id: 2, step: 9, hash: 'ab', ack: 4, walked: 7, base: 1, changed: {} })).not.toBeNull();
    expect(readHostMessage({ v, type: 'events', first: 0, step: 9, events: [] })).not.toBeNull();
    expect(readHostMessage({ v, type: 'result', id: 1, result: { ok: true, gained: [], spent: [] } })).not.toBeNull();
    expect(readHostMessage({ v, type: 'ping', time: 2 })).not.toBeNull();
    expect(readHostMessage({ v, type: 'leave', reason: 'full' })).not.toBeNull();
  });

  it('is dropped when it is anything else', () => {
    for (const junk of [null, 5, {}, { v: v + 1, type: 'leave', reason: 'full' }, { v, type: 'leave', reason: 'because' }, { v, type: 'state', id: 'x' },
      { v, type: 'welcome', session: 1, sitting: 1, playerId: 9, hostId: 0, id: 1, step: 1, hash: 'a', state: { players: [] }, events: 0, walked: 0 }, { v, type: 'join', name: 'x', key: 'y' }]) {
      expect(readHostMessage(junk)).toBeNull();
    }
  });
});
