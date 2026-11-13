/**
 * The inventory panel's model and what the session does with its quick presses (Luc's bugfix list, round 3):
 * Shift+click, the drop key, the belt's numbers and the tool keys, on a host's screen and on a guest's.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/client/app.ts';
import type { App } from '../../src/client/app.ts';
import { createSilentAudio } from '../../src/client/contracts.ts';
import type { GameInterface, InterfaceIntent, InterfaceModel, PanelModel, WorldView } from '../../src/client/contracts.ts';
import { buildHudModel, buildInventoryPanel } from '../../src/client/viewmodels/index.ts';
import { partMovedText } from '../../src/client/viewmodels/inventory.ts';
import { DROP_KEY_CODE, itemDetailKey, quickIntent } from '../../src/interface/inventoryview.ts';
import { createLoopbackPair } from '../../src/net/index.ts';
import type { HostLink } from '../../src/net/index.ts';
import { createDefaultSettings } from '../../src/settings/index.ts';

import { FIXED_STEP, beltOf, drainEvents } from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import { FakeStorage, countIn, floatCanoeAt, give, newGame, standOn, teleport } from '../support.ts';

const DEFAULT_SETTINGS = createDefaultSettings();

interface Client {
  app: App;
  models: InterfaceModel[];
  toasts(): string[];
  /** The inventory panel as this screen last drew it. */
  inventory(): Extract<PanelModel, { id: 'inventory' }>;
  /** A quick press on a tile, as the interface sends it. */
  press(key: string, press: 'shift' | 'drop'): InterfaceIntent | null;
}

function client(): Client {
  const models: InterfaceModel[] = [];
  const worldView: WorldView = {
    mount: () => {}, resize: () => {}, applyGraphicsSettings: () => {}, showStage: () => {}, sync: () => {}, handleEvents: () => {},
    render: () => {}, dispose: () => {},
  };
  const gameInterface: GameInterface = { mount: () => {}, update: (model) => void models.push(model), dispose: () => {} };
  const app = createApp({ worldView, gameInterface, audio: createSilentAudio(), storage: new FakeStorage(), now: () => 5000, randomSeed: () => 42 });
  const inventory = (): Extract<PanelModel, { id: 'inventory' }> => {
    const panel = models.at(-1)!.panel;
    if (panel?.id !== 'inventory') throw new Error('the inventory is not open');
    return panel;
  };
  return {
    app, models, inventory,
    toasts: () => models.at(-1)!.toasts.map((toast) => toast.text),
    press: (key, press) => {
      const intent = quickIntent(inventory(), key, press);
      if (intent) app.session.handleIntent(intent);
      return intent;
    },
  };
}

/** A solo game ashore at Home Knoll, beside the landed canoe, with the inventory open. */
function ashore(prepare: (state: GameState) => void = () => {}): Client & { game: GameState } {
  const game = newGame();
  standOn(game, 'home_knoll');
  game.quests.bail_out.status = 'completed';
  game.quests.first_haul.status = 'active';
  prepare(game);
  drainEvents(game);
  const made = client();
  made.app.session.adoptGame(game);
  made.app.session.handleIntent({ type: 'open_panel', panel: 'inventory' });
  made.app.frame(FIXED_STEP);
  return { ...made, game };
}

describe('the inventory panel\'s model', () => {
  it('gives every stack its two quick presses: the whole stack to the other side, and the whole stack dropped', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    give(state, 'berries', 4);
    give(state, 'stone', 6, 'cargo');
    const panel = buildInventoryPanel(state);
    expect(panel.backpack.slots[0]).toMatchObject({
      itemId: 'berries',
      shift: { type: 'command', command: { type: 'transfer', from: 'backpack', itemId: 'berries', count: 4 } },
      drop: { type: 'command', command: { type: 'discard', from: 'backpack', itemId: 'berries', count: 4 } },
    });
    expect(panel.cargo.slots[0]).toMatchObject({
      shift: { type: 'command', command: { type: 'transfer', from: 'cargo', itemId: 'stone', count: 6 } },
      drop: { type: 'command', command: { type: 'discard', from: 'cargo', itemId: 'stone', count: 6 } },
    });
    // An empty slot has neither.
    expect(panel.backpack.slots.at(-1)).toMatchObject({ itemId: null, shift: null, drop: null });
    expect(panel.stow).toMatchObject({ label: 'Stow all in the canoe', enabled: true });
    expect(panel.fillWater).toMatchObject({ label: 'Scoop water', enabled: true });
  });

  it('says on the buttons why a stack will not move or drop: no room, room for part, kept for a quest', () => {
    const state = newGame();
    standOn(state, 'home_knoll');
    state.quests.first_haul.status = 'active';
    for (let stack = 0; stack < 7; stack += 1) give(state, 'stone', 20, 'cargo');
    give(state, 'driftwood', 15, 'cargo');
    give(state, 'driftwood', 12);
    give(state, 'clay', 3);
    const [driftwood, clay] = buildInventoryPanel(state).backpack.slots;
    const named = (slot: typeof driftwood, label: string) => slot.buttons.find((button) => button.label === label)!;
    expect(named(driftwood, 'To cargo')).toMatchObject({ enabled: true, note: 'Room for 5' });
    expect(named(clay, 'To cargo')).toMatchObject({ enabled: false, note: 'The canoe is full' });
    expect(named(clay, 'Drop')).toMatchObject({ enabled: true, note: null });
    // The crew holds 27 driftwood and the quest asks for 3: the backpack's 12 are spare.
    expect(named(driftwood, 'Drop')).toMatchObject({ enabled: true, note: null });
    state.canoe.cargo.pop();
    expect(named(buildInventoryPanel(state).backpack.slots[0], 'Drop')).toMatchObject({ enabled: false, note: 'Kept for First haul' });
  });

  it('numbers the belt by the tool keys as they are bound, and shows a spare slot only while a tool is on it', () => {
    const state = newGame();
    for (const toolId of ['stone_knife', 'hatchet', 'pry_bar', 'saw', 'hammer'] as const) give(state, toolId);
    const panel = buildInventoryPanel(state);
    expect(panel.belt.map((slot) => [slot.keyLabel, slot.toolId])).toEqual([
      ['1', 'bailing_can'], ['2', 'stone_knife'], ['3', 'hatchet'], ['4', 'pry_bar'], ['5', 'saw'], ['', 'hammer'],
    ]);
    // A tool: take it in hand, or send it to any number it is not on. A spare tool can go to all five.
    expect(panel.belt[1].buttons.map((button) => button.label)).toEqual(['Hold', 'To 1', 'To 3', 'To 4', 'To 5']);
    expect(panel.belt[5].buttons.map((button) => button.label)).toEqual(['Hold', 'To 1', 'To 2', 'To 3', 'To 4', 'To 5']);
    expect(panel.belt[5].buttons[2].intent).toEqual({ type: 'command', command: { type: 'move_tool', toolId: 'hammer', slot: 1 } });
    // The drop key on a tool sends a drop the rules refuse, so the player is told why.
    expect(panel.belt[0].drop).toEqual({ type: 'command', command: { type: 'discard', from: 'backpack', itemId: 'bailing_can', count: 1 } });
    // Rebound keys show as they are bound; an unbound one falls back to its number.
    const bindings = { ...DEFAULT_SETTINGS.controls.keyBindings, tool1: ['KeyZ'], tool2: [] };
    expect(buildInventoryPanel(state, 0, bindings).belt.slice(0, 3).map((slot) => slot.keyLabel)).toEqual(['Z', '2', '3']);
    expect(buildInventoryPanel(state, 0, bindings).belt[2].buttons.map((button) => button.label)).toEqual(['Hold', 'To Z', 'To 2', 'To 4', 'To 5']);
    // In hand: the tile says so, and its first button puts the tool away.
    state.players[0].selectedTool = 'hatchet';
    expect(buildInventoryPanel(state).belt[2]).toMatchObject({ selected: true });
    expect(buildInventoryPanel(state).belt[2].buttons[0]).toMatchObject({ label: 'Put away', intent: { type: 'command', command: { type: 'select_tool', toolId: null } } });
  });

  it('says once that only part of a stack went over, and nothing when all of it did', () => {
    const sent = { type: 'transfer', from: 'backpack', itemId: 'driftwood', count: 12 } as const;
    expect(partMovedText(sent, { ok: true, gained: [{ itemId: 'driftwood', count: 5 }], spent: [] }))
      .toBe('The canoe is full: 5 of 12 Driftwood moved, 7 stayed.');
    expect(partMovedText({ ...sent, from: 'cargo' }, { ok: true, gained: [{ itemId: 'driftwood', count: 5 }], spent: [] }))
      .toBe('The backpack is full: 5 of 12 Driftwood moved, 7 stayed.');
    expect(partMovedText(sent, { ok: true, gained: [{ itemId: 'driftwood', count: 12 }], spent: [] })).toBeNull();
    expect(partMovedText(sent, { ok: false, reason: 'inventory_full', missing: null })).toBeNull();
    expect(partMovedText({ type: 'stow_backpack' }, { ok: true, gained: [{ itemId: 'driftwood', count: 5 }], spent: [] })).toBeNull();
  });
});

describe('a tool moved to another number', () => {
  it('shows there on the belt and on the hotbar, and that number\'s key then picks it', () => {
    const made = ashore((state) => give(state, 'hatchet'));
    const { session } = made.app;
    const toThree = made.inventory().belt[1].buttons.find((button) => button.label === 'To 3')!;
    session.handleIntent(toThree.intent);
    made.app.frame(FIXED_STEP);
    expect(made.inventory().belt.map((slot) => slot.toolId)).toEqual(['bailing_can', null, 'hatchet', null, null]);
    expect(made.models.at(-1)!.hud!.hotbar.map((slot) => slot.toolId)).toEqual(['bailing_can', null, 'hatchet', null, null]);
    // Back in play, key 3 takes the hatchet in hand; key 2, where it was, does nothing.
    session.handleIntent({ type: 'close_panel' });
    session.keyDown('Digit2');
    session.keyUp('Digit2');
    expect(made.game.players[0].selectedTool).toBeNull();
    session.keyDown('Digit3');
    session.keyUp('Digit3');
    expect(made.game.players[0].selectedTool).toBe('hatchet');
    made.app.frame(FIXED_STEP);
    expect(made.models.at(-1)!.hud!.hotbar[2]).toMatchObject({ toolId: 'hatchet', selected: true, keyLabel: '3' });
    // The same key again puts it away.
    session.keyDown('Digit3');
    expect(made.game.players[0].selectedTool).toBeNull();
  });
});

describe('Shift+click on a tile', () => {
  it('sends the whole stack to the boat, and from the boat to the bag', () => {
    const made = ashore((state) => {
      give(state, 'stone', 9);
      give(state, 'clay', 4, 'cargo');
    });
    expect(made.press(itemDetailKey('backpack', 'stone'), 'shift')).not.toBeNull();
    expect(countIn(made.game.players[0].backpack, 'stone')).toBe(0);
    expect(countIn(made.game.canoe.cargo, 'stone')).toBe(9);
    made.app.frame(FIXED_STEP);
    expect(made.press(itemDetailKey('cargo', 'clay'), 'shift')).not.toBeNull();
    expect(countIn(made.game.players[0].backpack, 'clay')).toBe(4);
    expect(countIn(made.game.canoe.cargo, 'clay')).toBe(0);
    made.app.frame(FIXED_STEP);
    expect(made.toasts()).toEqual([]);
  });

  it('moves what fits when the other side is full, and says so once', () => {
    const made = ashore((state) => {
      for (let stack = 0; stack < 7; stack += 1) give(state, 'stone', 20, 'cargo');
      give(state, 'clay', 15, 'cargo');
      give(state, 'clay', 12);
    });
    made.press(itemDetailKey('backpack', 'clay'), 'shift');
    made.app.frame(FIXED_STEP);
    expect(countIn(made.game.players[0].backpack, 'clay')).toBe(7);
    expect(countIn(made.game.canoe.cargo, 'clay')).toBe(20);
    expect(made.toasts()).toEqual(['The canoe is full: 5 of 12 Clay moved, 7 stayed.']);
    // Again, with no room left at all: nothing moves, and the line is the plain refusal.
    made.press(itemDetailKey('backpack', 'clay'), 'shift');
    made.app.frame(FIXED_STEP);
    expect(countIn(made.game.players[0].backpack, 'clay')).toBe(7);
    expect(made.toasts()).toEqual(['The canoe is full: 5 of 12 Clay moved, 7 stayed.', 'No room.']);
  });

  it('moves nothing while the cargo is out of reach, and says why', () => {
    const made = ashore((state) => {
      give(state, 'stone', 9);
      give(state, 'clay', 4, 'cargo');
      teleport(state, 'home_knoll', 0, 1150);
      state.canoe.beached = false;
    });
    expect(made.inventory().cargo.accessible).toBe(false);
    made.press(itemDetailKey('backpack', 'stone'), 'shift');
    made.press(itemDetailKey('cargo', 'clay'), 'shift');
    made.app.frame(FIXED_STEP);
    expect(countIn(made.game.players[0].backpack, 'stone')).toBe(9);
    expect(countIn(made.game.canoe.cargo, 'clay')).toBe(4);
    expect(made.toasts()).toEqual(['Go to the canoe first.']);
  });

  it('does nothing on a tool or a key item: they have no other side', () => {
    const made = ashore((state) => give(state, 'lens'));
    expect(made.press(itemDetailKey('belt', 'bailing_can'), 'shift')).toBeNull();
    expect(made.press(itemDetailKey('key', 'lens'), 'shift')).toBeNull();
  });
});

describe('the drop key with the pointer on a tile', () => {
  it('is Q', () => {
    expect(DROP_KEY_CODE).toBe('KeyQ');
  });

  it('drops the whole stack: it is gone, and a note says what went', () => {
    const made = ashore((state) => give(state, 'stone', 9));
    made.press(itemDetailKey('backpack', 'stone'), 'drop');
    made.app.frame(FIXED_STEP);
    expect(countIn(made.game.players[0].backpack, 'stone')).toBe(0);
    expect(countIn(made.game.canoe.cargo, 'stone')).toBe(0);
    expect(made.toasts()).toEqual(['-9 Stone']);
    expect(made.inventory().backpack.slots.every((slot) => slot.itemId === null)).toBe(true);
  });

  it('refuses a tool, a key item and what an open quest still needs, each with a line that says why', () => {
    const made = ashore((state) => {
      give(state, 'lens');
      give(state, 'driftwood', 3);
    });
    made.press(itemDetailKey('belt', 'bailing_can'), 'drop');
    made.press(itemDetailKey('key', 'lens'), 'drop');
    made.press(itemDetailKey('backpack', 'driftwood'), 'drop');
    made.app.frame(FIXED_STEP);
    expect(made.toasts()).toEqual([
      'Tools stay on the belt. They are never dropped.',
      'A key item stays with the crew. It is never dropped.',
      'A quest still needs that. It stays.',
    ]);
    expect(made.game.tools).toContain('bailing_can');
    expect(made.game.keyItems.lens).toBe(1);
    expect(countIn(made.game.players[0].backpack, 'driftwood')).toBe(3);
  });

  it('does not also switch the auto-paddle: with the inventory open Q is not the canoe\'s key', () => {
    const game = newGame();
    floatCanoeAt(game, 200, 1300, 0);
    drainEvents(game);
    const made = client();
    const { session } = made.app;
    session.adoptGame(game);
    // In play, aboard, Q is the auto-paddle: on, then off again.
    session.keyDown('KeyQ');
    session.keyUp('KeyQ');
    expect(session.input.autoPaddle).toBe(true);
    session.keyDown('KeyQ');
    session.keyUp('KeyQ');
    expect(session.input.autoPaddle).toBe(false);
    // With the inventory open the key does nothing to the canoe, whichever way the auto-paddle stood.
    session.handleIntent({ type: 'open_panel', panel: 'inventory' });
    session.keyDown('KeyQ');
    session.keyUp('KeyQ');
    expect(session.input.autoPaddle).toBe(false);
    expect(session.isOpen('inventory')).toBe(true);
    session.handleIntent({ type: 'close_panel' });
    session.keyDown('KeyQ');
    session.keyUp('KeyQ');
    expect(session.input.autoPaddle).toBe(true);
    session.handleIntent({ type: 'open_panel', panel: 'inventory' });
    session.keyDown('KeyQ');
    session.keyUp('KeyQ');
    expect(session.input.autoPaddle).toBe(true);
  });
});

describe('a guest does all of it', () => {
  /** A host ashore at Home Knoll with the canoe landed, and a guest standing beside them, both screens on the inventory. */
  function table(): { host: Client; guest: Client; game: GameState; tick(seconds: number): void } {
    const host = client();
    const guest = client();
    let link: HostLink | null = null;
    host.app.session.playerName = 'Luc';
    host.app.session.onShare = (made) => {
      link = made;
    };
    const game = newGame();
    standOn(game, 'home_knoll');
    game.quests.bail_out.status = 'completed';
    game.quests.first_haul.status = 'active';
    give(game, 'hatchet');
    drainEvents(game);
    host.app.session.adoptGame(game);
    const pair = createLoopbackPair({});
    link!.accept(pair.host);
    guest.app.session.joinGame(pair.guest, { name: 'Sam', key: 'key-sam-0123456789' });
    const tick = (seconds: number): void => {
      for (let frame = 0; frame < Math.round(seconds / FIXED_STEP); frame += 1) {
        pair.advance(FIXED_STEP);
        host.app.frame(FIXED_STEP);
        guest.app.frame(FIXED_STEP);
      }
    };
    tick(1);
    // The guest steps ashore beside the host and is handed a few things.
    const sam = game.players[1];
    const luc = game.players[0];
    Object.assign(sam, { mode: 'foot', seat: null, islandId: luc.islandId, position: { ...luc.position } });
    sam.backpack.push({ itemId: 'stone', count: 9 }, { itemId: 'driftwood', count: 3 }, { itemId: 'clay', count: 5 });
    tick(0.5);
    guest.app.session.handleIntent({ type: 'open_panel', panel: 'inventory' });
    tick(0.2);
    return { host, guest, game, tick };
  }

  it('Shift+click, the drop key, a refused drop and a tool moved, all run by the host and shown on the guest\'s screen', () => {
    const { host, guest, game, tick } = table();
    expect(guest.app.session.localPlayerId).toBe(1);
    const sam = game.players[1];

    // Shift+click: the stone goes to the host's canoe.
    guest.press(itemDetailKey('backpack', 'stone'), 'shift');
    tick(0.5);
    expect(countIn(sam.backpack, 'stone')).toBe(0);
    expect(countIn(game.canoe.cargo, 'stone')).toBe(9);
    expect(guest.inventory().cargo.slots.some((slot) => slot.itemId === 'stone' && slot.count === 9)).toBe(true);
    // And back to the guest's bag.
    guest.press(itemDetailKey('cargo', 'stone'), 'shift');
    tick(0.5);
    expect(countIn(sam.backpack, 'stone')).toBe(9);

    // The drop key: the clay is gone. The driftwood the quest needs stays, and the guest is told why.
    guest.press(itemDetailKey('backpack', 'clay'), 'drop');
    guest.press(itemDetailKey('backpack', 'driftwood'), 'drop');
    guest.press(itemDetailKey('belt', 'hatchet'), 'drop');
    tick(0.5);
    expect(countIn(sam.backpack, 'clay')).toBe(0);
    expect(countIn(sam.backpack, 'driftwood')).toBe(3);
    expect(guest.toasts()).toContain('A quest still needs that. It stays.');
    expect(guest.toasts()).toContain('Tools stay on the belt. They are never dropped.');
    expect(host.toasts()).not.toContain('A quest still needs that. It stays.');

    // The guest moves the hatchet to 4: their own belt and hotbar change, the host's do not.
    const toFour = guest.inventory().belt.find((slot) => slot.toolId === 'hatchet')!.buttons.find((button) => button.label === 'To 4')!;
    guest.app.session.handleIntent(toFour.intent);
    tick(0.5);
    expect(beltOf(game, sam).slice(0, 5)).toEqual(['bailing_can', null, null, 'hatchet', null]);
    expect(beltOf(game, game.players[0]).slice(0, 5)).toEqual(['bailing_can', 'hatchet', null, null, null]);
    expect(guest.inventory().belt.map((slot) => slot.toolId)).toEqual(['bailing_can', null, null, 'hatchet', null]);
    expect(guest.models.at(-1)!.hud!.hotbar.map((slot) => slot.toolId)).toEqual(['bailing_can', null, null, 'hatchet', null]);
    expect(buildHudModel(game, DEFAULT_SETTINGS, 0, 0).hotbar.map((slot) => slot.toolId)).toEqual(['bailing_can', 'hatchet', null, null, null]);
    // Back in play, the guest's key 4 takes it in hand.
    guest.app.session.handleIntent({ type: 'close_panel' });
    tick(0.2);
    guest.app.session.keyDown('Digit4');
    guest.app.session.keyUp('Digit4');
    tick(0.5);
    expect(sam.selectedTool).toBe('hatchet');
    expect(game.players[0].selectedTool).toBeNull();
  });
});
