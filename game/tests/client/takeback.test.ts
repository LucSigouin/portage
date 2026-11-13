/**
 * A dropped stack's way back, on the screen (the master review of round 3, finding 2): the note that says what
 * went offers to take it back, by a button and by a key, on a host's screen and on a guest's. And Q with the
 * inventory open and the pointer off every tile is the auto-paddle's key again.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/client/app.ts';
import type { App } from '../../src/client/app.ts';
import { createSilentAudio } from '../../src/client/contracts.ts';
import type { GameInterface, InterfaceIntent, InterfaceModel, PanelModel, ToastModel, WorldView } from '../../src/client/contracts.ts';
import { TAKE_BACK_KEY_CODE, TOAST_SECONDS, ToastQueue, toastsFromEvents } from '../../src/client/viewmodels/index.ts';
import { itemDetailKey, quickIntent } from '../../src/interface/inventoryview.ts';
import { toastKeyIntent } from '../../src/interface/takeback.ts';
import { createLoopbackPair } from '../../src/net/index.ts';
import type { HostLink } from '../../src/net/index.ts';
import { FIXED_STEP, TAKE_BACK, drainEvents } from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import { FakeStorage, countIn, floatCanoeAt, give, newGame, standOn } from '../support.ts';

interface Client {
  app: App;
  models: InterfaceModel[];
  notes(): ToastModel[];
  toasts(): string[];
  /** The note with these words, as last drawn. */
  note(text: string): ToastModel | undefined;
  /** The drop key with the pointer on a tile, as the interface sends it. */
  drop(key: string): InterfaceIntent | null;
  /** A key press that reaches the interface first: a note that offers the key takes it, as in `interface.ts`. */
  key(keyCode: string): boolean;
}

function client(): Client {
  const models: InterfaceModel[] = [];
  const worldView: WorldView = {
    mount: () => {}, resize: () => {}, applyGraphicsSettings: () => {}, showStage: () => {}, sync: () => {}, handleEvents: () => {},
    render: () => {}, dispose: () => {},
  };
  const gameInterface: GameInterface = { mount: () => {}, update: (model) => void models.push(model), dispose: () => {} };
  const app = createApp({ worldView, gameInterface, audio: createSilentAudio(), storage: new FakeStorage(), now: () => 5000, randomSeed: () => 42 });
  const notes = (): ToastModel[] => models.at(-1)!.toasts;
  return {
    app, models, notes,
    toasts: () => notes().map((toast) => toast.text),
    note: (text) => notes().find((toast) => toast.text === text),
    drop: (key) => {
      const panel: PanelModel | null = models.at(-1)!.panel;
      const intent = quickIntent(panel, key, 'drop');
      if (intent) app.session.handleIntent(intent);
      return intent;
    },
    key: (keyCode) => {
      const intent = toastKeyIntent(notes(), keyCode);
      if (intent) app.session.handleIntent(intent);
      else {
        app.session.keyDown(keyCode);
        app.session.keyUp(keyCode);
      }
      return intent !== null;
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

const frames = (made: Client, seconds: number): void => {
  for (let frame = 0; frame < Math.round(seconds / FIXED_STEP); frame += 1) made.app.frame(FIXED_STEP);
};

describe('the note of a dropped stack offers to take it back', () => {
  it('by a button and by Z, and the rules honour it a second longer than the note stands', () => {
    expect(TAKE_BACK_KEY_CODE).toBe('KeyZ');
    expect(TAKE_BACK.seconds).toBeGreaterThan(TOAST_SECONDS.warning);
    const made = ashore((state) => {
      give(state, 'clay', 4);
      give(state, 'stone', 9);
    });
    made.drop(itemDetailKey('backpack', 'stone'));
    made.app.frame(FIXED_STEP);
    expect(countIn(made.game.players[0].backpack, 'stone')).toBe(0);
    expect(made.note('-9 Stone')).toMatchObject({
      tone: 'warning', itemId: 'stone',
      action: { label: 'Take back', keyCode: 'KeyZ', keyLabel: 'Z', intent: { type: 'command', command: { type: 'take_back', drop: 1 } } },
    });
    // Any other key is not the note's.
    expect(toastKeyIntent(made.notes(), 'KeyQ')).toBeNull();
    expect(toastKeyIntent(made.notes(), 'KeyZ')).toEqual({ type: 'command', command: { type: 'take_back', drop: 1 } });
  });

  it('Z puts the stack back where it was: the minus note goes and a plus note comes', () => {
    const made = ashore((state) => {
      give(state, 'clay', 4);
      give(state, 'stone', 9);
      give(state, 'berries', 2);
    });
    made.drop(itemDetailKey('backpack', 'stone'));
    made.app.frame(FIXED_STEP);
    expect(made.key('KeyZ')).toBe(true);
    made.app.frame(FIXED_STEP);
    expect(made.game.players[0].backpack.map((stack) => stack.itemId)).toEqual(['clay', 'stone', 'berries']);
    expect(countIn(made.game.players[0].backpack, 'stone')).toBe(9);
    expect(made.toasts()).toEqual(['+9 Stone']);
    // Nothing offers the key any more: a second Z is no take-back, and brings nothing.
    expect(made.key('KeyZ')).toBe(false);
    made.app.frame(FIXED_STEP);
    expect(countIn(made.game.players[0].backpack, 'stone')).toBe(9);
    expect(made.toasts()).toEqual(['+9 Stone']);
  });

  it('a click on the note\'s button does the same', () => {
    const made = ashore((state) => give(state, 'stone', 9));
    made.drop(itemDetailKey('backpack', 'stone'));
    made.app.frame(FIXED_STEP);
    made.app.session.handleIntent(made.note('-9 Stone')!.action!.intent);
    made.app.frame(FIXED_STEP);
    expect(countIn(made.game.players[0].backpack, 'stone')).toBe(9);
    expect(made.toasts()).toEqual(['+9 Stone']);
  });

  it('each drop has its own note and its own button, and the key is the newest note\'s', () => {
    const made = ashore((state) => {
      give(state, 'stone', 9);
      give(state, 'clay', 4);
    });
    made.drop(itemDetailKey('backpack', 'stone'));
    made.app.frame(FIXED_STEP);
    made.drop(itemDetailKey('backpack', 'clay'));
    made.app.frame(FIXED_STEP);
    expect(made.note('-9 Stone')!.action).toMatchObject({ keyCode: null, keyLabel: '', intent: { command: { type: 'take_back', drop: 1 } } });
    expect(made.note('-4 Clay')!.action).toMatchObject({ keyCode: 'KeyZ', keyLabel: 'Z', intent: { command: { type: 'take_back', drop: 2 } } });
    // Z: the clay. Then the stone's note is the newest, and has the key.
    expect(made.key('KeyZ')).toBe(true);
    made.app.frame(FIXED_STEP);
    expect(countIn(made.game.players[0].backpack, 'clay')).toBe(4);
    expect(made.note('-4 Clay')).toBeUndefined();
    expect(made.note('-9 Stone')!.action).toMatchObject({ keyCode: 'KeyZ', keyLabel: 'Z' });
    expect(made.key('KeyZ')).toBe(true);
    made.app.frame(FIXED_STEP);
    expect(countIn(made.game.players[0].backpack, 'stone')).toBe(9);
  });

  it('two drops of the same words are two notes, each with its own way back', () => {
    const made = ashore((state) => {
      give(state, 'stone', 20);
      give(state, 'stone', 20);
    });
    made.app.session.handleIntent({ type: 'command', command: { type: 'discard', from: 'backpack', itemId: 'stone', count: 5 } });
    made.app.session.handleIntent({ type: 'command', command: { type: 'discard', from: 'backpack', itemId: 'stone', count: 5 } });
    made.app.frame(FIXED_STEP);
    expect(made.toasts()).toEqual(['-5 Stone', '-5 Stone']);
    expect(made.notes().map((note) => note.action?.intent)).toEqual([
      { type: 'command', command: { type: 'take_back', drop: 1 } }, { type: 'command', command: { type: 'take_back', drop: 2 } },
    ]);
    made.key('KeyZ');
    made.app.frame(FIXED_STEP);
    expect(made.toasts()).toEqual(['-5 Stone', '+5 Stone']);
    made.key('KeyZ');
    made.app.frame(FIXED_STEP);
    expect(countIn(made.game.players[0].backpack, 'stone')).toBe(40);
  });

  it('is over when the note goes: after its five seconds Z takes nothing back', () => {
    const made = ashore((state) => give(state, 'stone', 9));
    made.drop(itemDetailKey('backpack', 'stone'));
    frames(made, TOAST_SECONDS.warning - 0.2);
    expect(made.note('-9 Stone')!.action).toBeTruthy();
    frames(made, 0.4);
    expect(made.note('-9 Stone')).toBeUndefined();
    expect(made.key('KeyZ')).toBe(false);
    made.app.frame(FIXED_STEP);
    expect(countIn(made.game.players[0].backpack, 'stone')).toBe(0);
  });

  it('a note still standing loses its button the moment the rules say the time is up', () => {
    const made = ashore((state) => give(state, 'stone', 9));
    made.drop(itemDetailKey('backpack', 'stone'));
    made.app.frame(FIXED_STEP);
    const stale = made.note('-9 Stone')!.action!.intent;
    // The game ran on while the note waited (a crew's game does not stop for a panel).
    made.game.playedSeconds += TAKE_BACK.seconds + 1;
    made.app.frame(FIXED_STEP);
    expect(made.note('-9 Stone')).toBeDefined();
    expect(made.note('-9 Stone')!.action).toBeUndefined();
    expect(made.key('KeyZ')).toBe(false);
    // A press that was already on its way is told so, and brings nothing.
    made.app.session.handleIntent(stale);
    made.app.frame(FIXED_STEP);
    expect(made.toasts()).toContain('Too late. That drop is gone.');
    expect(countIn(made.game.players[0].backpack, 'stone')).toBe(0);
  });

  it('says "No room." when the slot was filled meanwhile, and the offer stands', () => {
    const made = ashore((state) => {
      for (let stack = 0; stack < 7; stack += 1) give(state, 'clay', 20);
      give(state, 'stone', 9);
    });
    made.drop(itemDetailKey('backpack', 'stone'));
    made.app.frame(FIXED_STEP);
    give(made.game, 'berries', 1);
    drainEvents(made.game);
    made.key('KeyZ');
    made.app.frame(FIXED_STEP);
    expect(made.toasts()).toEqual(['-9 Stone', 'No room.']);
    expect(made.note('-9 Stone')!.action).toBeTruthy();
    expect(countIn(made.game.players[0].backpack, 'stone')).toBe(0);
  });

  it('offers nothing on a refused drop, nor on what a capsize took', () => {
    const made = ashore((state) => give(state, 'driftwood', 3));
    made.drop(itemDetailKey('belt', 'bailing_can'));
    made.drop(itemDetailKey('backpack', 'driftwood'));
    made.app.frame(FIXED_STEP);
    expect(made.toasts()).toEqual(['Tools stay on the belt. They are never dropped.', 'A quest still needs that. It stays.']);
    expect(made.notes().every((note) => !note.action)).toBe(true);
    expect(made.key('KeyZ')).toBe(false);
    // A loss the rules did not make a drop of carries no number, and its note no button.
    const queue = new ToastQueue();
    queue.addAll(toastsFromEvents([{ type: 'item_lost', itemId: 'stone', count: 3, playerId: 0 }], made.game));
    expect(queue.models(() => true)).toMatchObject([{ text: '-3 Stone' }]);
    expect(queue.models(() => true)[0]!.action).toBeUndefined();
  });
});

describe('a guest takes a drop back', () => {
  /** A host ashore at Home Knoll with the canoe landed, and a guest standing beside them with the inventory open. */
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
    const sam = game.players[1];
    const luc = game.players[0];
    Object.assign(sam, { mode: 'foot', seat: null, islandId: luc.islandId, position: { ...luc.position } });
    sam.backpack.push({ itemId: 'stone', count: 9 }, { itemId: 'clay', count: 5 }, { itemId: 'berries', count: 2 });
    tick(0.5);
    guest.app.session.handleIntent({ type: 'open_panel', panel: 'inventory' });
    tick(0.2);
    return { host, guest, game, tick };
  }

  it('the host runs it: the stack is back in the guest\'s bag, on the slot it left, and the host\'s screen says nothing', () => {
    const { host, guest, game, tick } = table();
    const sam = game.players[1];
    guest.drop(itemDetailKey('backpack', 'clay'));
    tick(0.5);
    expect(countIn(sam.backpack, 'clay')).toBe(0);
    expect(guest.note('-5 Clay')!.action).toMatchObject({ keyLabel: 'Z', intent: { command: { type: 'take_back', drop: 1 } } });
    expect(host.note('-5 Clay')).toBeUndefined();
    expect(guest.key('KeyZ')).toBe(true);
    tick(0.5);
    expect(sam.backpack).toEqual([{ itemId: 'stone', count: 9 }, { itemId: 'clay', count: 5 }, { itemId: 'berries', count: 2 }]);
    expect(guest.toasts()).toContain('+5 Clay');
    expect(guest.note('-5 Clay')).toBeUndefined();
    expect(host.toasts()).not.toContain('+5 Clay');
  });

  it('too late for a guest: the host says no, the guest is told, nothing comes back', () => {
    const { guest, game, tick } = table();
    const sam = game.players[1];
    guest.drop(itemDetailKey('backpack', 'clay'));
    tick(0.5);
    const intent = guest.note('-5 Clay')!.action!.intent;
    tick(TAKE_BACK.seconds);
    // The note is gone by now, and with it the key.
    expect(guest.note('-5 Clay')).toBeUndefined();
    expect(guest.key('KeyZ')).toBe(false);
    // A guest that sends the old command anyway is refused by the host.
    guest.app.session.handleIntent(intent);
    tick(0.5);
    expect(countIn(sam.backpack, 'clay')).toBe(0);
    expect(guest.toasts()).toContain('Too late. That drop is gone.');
  });

  it('a guest cannot take back the host\'s drop, nor a drop that was never made', () => {
    const { host, guest, game, tick } = table();
    give(game, 'stone', 7);
    drainEvents(game);
    host.app.session.handleIntent({ type: 'command', command: { type: 'discard', from: 'backpack', itemId: 'stone', count: 7 } });
    tick(0.5);
    expect(host.note('-7 Stone')!.action).toBeTruthy();
    expect(guest.note('-7 Stone')).toBeUndefined();
    // The host's drop is number 1 of the host's. The guest has no drop 1, and no drop 40.
    guest.app.session.handleIntent({ type: 'command', command: { type: 'take_back', drop: 1 } });
    guest.app.session.handleIntent({ type: 'command', command: { type: 'take_back', drop: 40 } });
    tick(0.5);
    expect(guest.toasts()).toContain('Nothing to take back.');
    expect(countIn(game.players[1].backpack, 'stone')).toBe(9);
    expect(countIn(game.players[0].backpack, 'stone')).toBe(0);
    // The host still can.
    expect(host.key('KeyZ')).toBe(true);
    tick(0.2);
    expect(countIn(game.players[0].backpack, 'stone')).toBe(7);
  });
});

describe('Q with the inventory open and the pointer off every tile', () => {
  /** Aboard, afloat, in play. */
  function afloat(): Client & { game: GameState } {
    const game = newGame();
    floatCanoeAt(game, 200, 1300, 0);
    give(game, 'stone', 9, 'cargo');
    drainEvents(game);
    const made = client();
    made.app.session.adoptGame(game);
    made.app.frame(FIXED_STEP);
    return { ...made, game };
  }

  it('switches the auto-paddle as it does in play, and says so', () => {
    const made = afloat();
    const { session } = made.app;
    made.key('KeyQ');
    expect(session.input.autoPaddle).toBe(true);
    session.handleIntent({ type: 'open_panel', panel: 'inventory' });
    made.app.frame(FIXED_STEP);
    made.key('KeyQ');
    made.app.frame(FIXED_STEP);
    expect(session.input.autoPaddle).toBe(false);
    expect(session.isOpen('inventory')).toBe(true);
    expect(made.toasts()).toContain('Paddling off.');
    made.key('KeyQ');
    made.app.frame(FIXED_STEP);
    expect(session.input.autoPaddle).toBe(true);
    // A key held down does not flip it over and over.
    session.keyDown('KeyQ', true);
    expect(session.input.autoPaddle).toBe(true);
  });

  it('on a tile it is the drop key and nothing else: the stack goes, the paddle stays as it was', () => {
    const made = afloat();
    const { session } = made.app;
    made.key('KeyQ');
    session.handleIntent({ type: 'open_panel', panel: 'inventory' });
    made.app.frame(FIXED_STEP);
    // The interface keeps the key when the pointer is on a tile: the session sees the drop, never the key.
    made.drop(itemDetailKey('cargo', 'stone'));
    made.app.frame(FIXED_STEP);
    expect(countIn(made.game.canoe.cargo, 'stone')).toBe(0);
    expect(session.input.autoPaddle).toBe(true);
    // Z brings it back, Q off the tile stops the paddle: the two keys no longer cross.
    made.key('KeyZ');
    made.key('KeyQ');
    made.app.frame(FIXED_STEP);
    expect(countIn(made.game.canoe.cargo, 'stone')).toBe(9);
    expect(session.input.autoPaddle).toBe(false);
  });

  it('does nothing ashore, and nothing in any other panel', () => {
    const ashoreGame = ashore();
    ashoreGame.key('KeyQ');
    expect(ashoreGame.app.session.input.autoPaddle).toBe(false);
    const made = afloat();
    const { session } = made.app;
    for (const panel of ['map', 'quest_log', 'crafting'] as const) {
      session.handleIntent({ type: 'open_panel', panel });
      made.key('KeyQ');
      expect(session.input.autoPaddle, panel).toBe(false);
      session.handleIntent({ type: 'close_panel' });
    }
  });
});
