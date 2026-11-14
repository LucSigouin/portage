/**
 * Give in the inventory's menu (Luc, round 4: "i like the give"): the line the menu shows for a crewmate in reach,
 * and what a press on it does on a host's screen and on a guest's. The rules themselves: `tests/give.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/client/app.ts';
import type { App } from '../../src/client/app.ts';
import { createSilentAudio } from '../../src/client/contracts.ts';
import type { ButtonModel, GameInterface, InterfaceModel, PanelModel, WorldView } from '../../src/client/contracts.ts';
import { buildInventoryPanel } from '../../src/client/viewmodels/index.ts';
import { crewMark } from '../../src/client/viewmodels/hud.ts';
import { TUNING } from '../../src/data/index.ts';
import { createLoopbackPair } from '../../src/net/index.ts';
import type { HostLink } from '../../src/net/index.ts';
import { FIXED_STEP, drainEvents, setConnected, setPlayerName } from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import { FakeStorage, countIn, give, newGame, standOn } from '../support.ts';

type Inventory = Extract<PanelModel, { id: 'inventory' }>;
const labels = (buttons: ButtonModel[]): string[] => buttons.map((button) => button.label);
const giveLines = (buttons: ButtonModel[]): ButtonModel[] => buttons.filter((button) => button.intent.type === 'command' && button.intent.command.type === 'give');

/** A crew ashore on Home Knoll by the landed canoe, a step and a half apart, named, nobody holding anything. */
function crew(names: string[]): GameState {
  const state = newGame(7, { crew: names.length });
  standOn(state, 'home_knoll');
  state.quests.bail_out.status = 'completed';
  const spot = { ...state.players[0].position };
  state.players.forEach((player, index) => {
    setPlayerName(state, player.id, names[index]!);
    Object.assign(player, { mode: 'foot', seat: null, islandId: 'home_knoll', position: { ...spot, x: spot.x + index * 1.5 }, backpack: [] });
  });
  state.canoe.cargo = [];
  drainEvents(state);
  return state;
}

describe('the menu\'s Give line', () => {
  it('is one line for each crewmate in reach, in the crew\'s order, with their name and their colour', () => {
    const state = crew(['Luc', 'Sam', 'Ada']);
    give(state, 'plank', 5);
    const [plank] = buildInventoryPanel(state, 0).backpack.slots;
    expect(labels(plank!.buttons)).toEqual(['Stow', 'Give to Sam', 'Give to Ada', 'Drop']);
    const lines = giveLines(plank!.buttons);
    expect(lines.map((line) => line.intent)).toEqual([
      { type: 'command', command: { type: 'give', to: 1, itemId: 'plank', count: 5 } },
      { type: 'command', command: { type: 'give', to: 2, itemId: 'plank', count: 5 } },
    ]);
    expect(lines.map((line) => line.color)).toEqual([crewMark(1).color, crewMark(2).color]);
    expect(lines.every((line) => line.enabled && line.note === null)).toBe(true);
    // No other line carries a colour.
    expect(plank!.buttons.filter((button) => button.color !== undefined)).toEqual(lines);
    // Each player reads the others: Sam's menu names Luc and Ada, never Sam.
    give(state, 'clay', 2);
    state.players[1].backpack.push({ itemId: 'clay', count: 2 });
    expect(labels(buildInventoryPanel(state, 1).backpack.slots[0]!.buttons)).toEqual(['Stow', 'Give to Luc', 'Give to Ada', 'Drop']);
  });

  it('falls back to the crewmate\'s mark when they gave no name', () => {
    const state = crew(['Luc', '']);
    give(state, 'plank', 5);
    expect(labels(buildInventoryPanel(state, 0).backpack.slots[0]!.buttons)).toEqual(['Stow', `Give to ${crewMark(1).label}`, 'Drop']);
  });

  it('is not there alone, nor with nobody close: too far, another island, one aboard and one ashore, a crewmate who left', () => {
    const solo = newGame();
    standOn(solo, 'home_knoll');
    give(solo, 'plank', 5);
    expect(labels(buildInventoryPanel(solo, 0).backpack.slots[0]!.buttons)).toEqual(['Stow', 'Drop']);

    const linesFor = (change: (state: GameState) => void): string[] => {
      const state = crew(['Luc', 'Sam']);
      give(state, 'plank', 5);
      change(state);
      return labels(giveLines(buildInventoryPanel(state, 0).backpack.slots[0]!.buttons));
    };
    expect(linesFor(() => {})).toEqual(['Give to Sam']);
    // Just inside the reach, and a hand's width past it.
    expect(linesFor((state) => { state.players[1].position.x = state.players[0].position.x + TUNING.foot.giveRange - 0.01; })).toEqual(['Give to Sam']);
    expect(linesFor((state) => { state.players[1].position.x = state.players[0].position.x + TUNING.foot.giveRange + 0.01; })).toEqual([]);
    expect(linesFor((state) => { state.players[1].islandId = 'birch_islet'; })).toEqual([]);
    expect(linesFor((state) => { Object.assign(state.players[1], { mode: 'canoe', seat: 0 }); })).toEqual([]);
    expect(linesFor((state) => { setConnected(state, 1, false); })).toEqual([]);
    // Both aboard: in reach, wherever the canoe is.
    expect(linesFor((state) => { for (const player of state.players) Object.assign(player, { mode: 'canoe', seat: player.id }); })).toEqual(['Give to Sam']);
  });

  it('is on a stack in the backpack only: not in the canoe, not on a tool, not on a key item', () => {
    const state = crew(['Luc', 'Sam']);
    give(state, 'plank', 5);
    give(state, 'clay', 3, 'cargo');
    give(state, 'hatchet');
    give(state, 'lens');
    const panel = buildInventoryPanel(state, 0);
    expect(giveLines(panel.backpack.slots[0]!.buttons)).toHaveLength(1);
    expect(labels(panel.cargo.slots[0]!.buttons)).toEqual(['Take', 'Drop']);
    for (const slot of panel.belt) expect(giveLines(slot.buttons)).toEqual([]);
    for (const item of panel.keyItems) expect(labels(item.buttons)).toEqual(['Drop']);
  });

  it('says when their backpack is full, and how much fits when only a part does', () => {
    const state = crew(['Luc', 'Sam']);
    give(state, 'clay', 12);
    const sam = state.players[1];
    const line = (): ButtonModel => giveLines(buildInventoryPanel(state, 0).backpack.slots[0]!.buttons)[0]!;
    expect(line()).toMatchObject({ label: 'Give to Sam', enabled: true, note: null });
    // Seven full stacks of something else and 15 clay: room for 5 more clay.
    for (let stack = 0; stack < TUNING.inventory.backpackSlots - 1; stack += 1) sam.backpack.push({ itemId: 'stone', count: TUNING.inventory.stackSize });
    sam.backpack.push({ itemId: 'clay', count: TUNING.inventory.stackSize - 5 });
    expect(line()).toMatchObject({ enabled: true, note: 'Room for 5' });
    // The whole stack is still what is asked: the rules give the part that fits.
    expect(line().intent).toEqual({ type: 'command', command: { type: 'give', to: 1, itemId: 'clay', count: 12 } });
    sam.backpack.at(-1)!.count = TUNING.inventory.stackSize;
    expect(line()).toMatchObject({ enabled: false, note: 'Their backpack is full' });
  });
});

// --- On two screens ----------------------------------------------------------------------

interface Client {
  app: App;
  models: InterfaceModel[];
  toasts(): string[];
  inventory(): Inventory;
  /** Press a line of the menu at the backpack's first tile of this item, as a click on it does. */
  pick(itemId: string, label: string): ButtonModel;
}

function client(): Client {
  const models: InterfaceModel[] = [];
  const worldView: WorldView = {
    mount: () => {}, resize: () => {}, applyGraphicsSettings: () => {}, showStage: () => {}, sync: () => {}, handleEvents: () => {},
    render: () => {}, dispose: () => {},
  };
  const gameInterface: GameInterface = { mount: () => {}, update: (model) => void models.push(model), dispose: () => {} };
  const app = createApp({ worldView, gameInterface, audio: createSilentAudio(), storage: new FakeStorage(), now: () => 5000, randomSeed: () => 42 });
  const inventory = (): Inventory => {
    const panel = models.at(-1)!.panel;
    if (panel?.id !== 'inventory') throw new Error('the inventory is not open');
    return panel;
  };
  return {
    app, models, inventory,
    // The notes about a give, and the refusals: not who joined, nor what the walk charted.
    toasts: () => models.at(-1)!.toasts.map((toast) => toast.text).filter((text) => !/joined the crew|^Charted/.test(text)),
    pick: (itemId, label) => {
      const line = inventory().backpack.slots.find((slot) => slot.itemId === itemId)!.buttons.find((button) => button.label === label);
      if (!line) throw new Error(`no line "${label}" on ${itemId}: ${labels(inventory().backpack.slots.find((slot) => slot.itemId === itemId)!.buttons).join(', ')}`);
      if (line.enabled) app.session.handleIntent(line.intent);
      return line;
    },
  };
}

/** Luc hosts ashore at Home Knoll, Sam has joined and stands beside him, both screens on the inventory. */
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
  game.weather.secondsRemaining = 99999;
  game.players[0].backpack = [];
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
  const [luc, sam] = game.players;
  Object.assign(sam!, { mode: 'foot', seat: null, islandId: luc!.islandId, position: { ...luc!.position, x: luc!.position.x + 1 }, backpack: [] });
  tick(0.5);
  host.app.session.handleIntent({ type: 'open_panel', panel: 'inventory' });
  guest.app.session.handleIntent({ type: 'open_panel', panel: 'inventory' });
  tick(0.2);
  return { host, guest, game, tick };
}

describe('give, on the host\'s screen and on the guest\'s', () => {
  it('the host picks "Give to Sam": the planks change bags and each reads their own note', () => {
    const { host, guest, game, tick } = table();
    game.players[0].backpack.push({ itemId: 'plank', count: 5 });
    tick(0.2);
    expect(labels(host.inventory().backpack.slots[0]!.buttons)).toEqual(['Stow', 'Give to Sam', 'Drop']);
    host.pick('plank', 'Give to Sam');
    tick(0.5);
    expect(game.players.map((player) => countIn(player.backpack, 'plank'))).toEqual([0, 5]);
    expect(host.toasts()).toEqual(['You gave Sam 5 x Plank']);
    expect(guest.toasts()).toEqual(['Luc gave you 5 x Plank']);
    // Both sheets show it: gone from the host's bag, in the guest's.
    expect(host.inventory().backpack.slots.every((slot) => slot.itemId === null)).toBe(true);
    expect(guest.inventory().backpack.slots[0]).toMatchObject({ itemId: 'plank', count: 5 });
    // Nothing to take back: the note is not a drop's.
    expect(host.models.at(-1)!.toasts.find((toast) => toast.text.startsWith('You gave'))!.action ?? null).toBeNull();
  });

  it('a guest picks "Give to Luc": the host checks it, and the same two notes are read the other way round', () => {
    const { host, guest, game, tick } = table();
    game.players[1].backpack.push({ itemId: 'clay', count: 7 });
    tick(0.3);
    expect(labels(guest.inventory().backpack.slots[0]!.buttons)).toEqual(['Stow', 'Give to Luc', 'Drop']);
    guest.pick('clay', 'Give to Luc');
    tick(0.5);
    expect(game.players.map((player) => countIn(player.backpack, 'clay'))).toEqual([7, 0]);
    expect(guest.toasts()).toEqual(['You gave Luc 7 x Clay']);
    expect(host.toasts()).toEqual(['Sam gave you 7 x Clay']);
  });

  it('when only a part fits, the giver is also told how many stayed', () => {
    const { host, guest, game, tick } = table();
    const [luc, sam] = game.players;
    luc!.backpack.push({ itemId: 'clay', count: 12 });
    for (let stack = 0; stack < TUNING.inventory.backpackSlots - 1; stack += 1) sam!.backpack.push({ itemId: 'stone', count: TUNING.inventory.stackSize });
    sam!.backpack.push({ itemId: 'clay', count: TUNING.inventory.stackSize - 5 });
    tick(0.3);
    expect(host.pick('clay', 'Give to Sam')).toMatchObject({ enabled: true, note: 'Room for 5' });
    tick(0.5);
    expect([countIn(luc!.backpack, 'clay'), countIn(sam!.backpack, 'clay')]).toEqual([7, TUNING.inventory.stackSize]);
    expect(host.toasts().sort()).toEqual(['Their backpack is full: 5 of 12 Clay given, 7 stayed.', 'You gave Sam 5 x Clay']);
    expect(guest.toasts()).toEqual(['Luc gave you 5 x Clay']);
    // Now it is full: the line is off, and says why.
    expect(host.pick('clay', 'Give to Sam')).toMatchObject({ enabled: false, note: 'Their backpack is full' });
  });

  it('the guest walks off: the line is gone, and a give sent from a menu still open is refused with the reason', () => {
    const { host, game, tick } = table();
    game.players[0].backpack.push({ itemId: 'plank', count: 5 });
    tick(0.2);
    const stale = host.inventory().backpack.slots[0]!.buttons.find((button) => button.label === 'Give to Sam')!;
    game.players[1].position.x += 40;
    tick(0.3);
    expect(labels(host.inventory().backpack.slots[0]!.buttons)).toEqual(['Stow', 'Drop']);
    host.app.session.handleIntent(stale.intent);
    tick(0.3);
    expect(game.players.map((player) => countIn(player.backpack, 'plank'))).toEqual([5, 0]);
    expect(host.toasts()).toEqual(['Too far apart. Stand close together, or both sit in the canoe.']);
  });
});
