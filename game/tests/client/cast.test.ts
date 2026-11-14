/**
 * The pick screen, as whole clients meet it (session, panels, interface model, the relay's own room logic in
 * memory): which doors lead to it and which do not, what Back keeps, what its one button does, and where the
 * pick ends up: on the player, in the save, on the host's screen and every guest's, and marked again next time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/client/app.ts';
import type { App } from '../../src/client/app.ts';
import { createSilentAudio } from '../../src/client/contracts.ts';
import type { ButtonModel, GameInterface, InterfaceModel, PanelModel, WorldView } from '../../src/client/contracts.ts';
import { CrewLobby } from '../../src/client/crewlobby.ts';
import { applyDebugParameters } from '../../src/client/debug/index.ts';
import { SHOT_NAMES, parseDebugParameters } from '../../src/client/debug/parameters.ts';
import type { InterfaceIntent } from '../../src/client/intents.ts';
import { PANEL_RULES } from '../../src/client/panels.ts';
import {
  CAST_NOTE, CAST_PICK_SLOT, buildCastPanel, buildHudModel, buildMapPanel, castStartLabel, chartPings, keepCharacter, keptCharacter, neighbourCharacter,
} from '../../src/client/viewmodels/index.ts';
import { CAST, CHARACTER_IDS, characterOf } from '../../src/data/index.ts';
import type { CharacterId } from '../../src/data/index.ts';
import { readRoomCode } from '../../src/net/relay.ts';
import { SAVE_KEY_PREFIX, deserialize } from '../../src/save/index.ts';
import { createDefaultSettings } from '../../src/settings/index.ts';
import { FIXED_STEP, dispatch, setPlayerCharacter } from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import { FakeStorage, newGame } from '../support.ts';
import { ADDRESS, FakeRelay } from '../net/relay-rig.ts';

const liveSaves = import.meta.glob<string>('../fixtures/save-live-*.json', { eager: true, query: '?raw', import: 'default' });

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

interface Client {
  app: App;
  storage: FakeStorage;
  model(): InterfaceModel;
  panel<Id extends PanelModel['id']>(id: Id): Extract<PanelModel, { id: Id }>;
  send(intent: InterfaceIntent): void;
  press(button: ButtonModel | null | undefined): void;
  type(field: 'name' | 'code', value: string): void;
  /** The ids of the open panels, bottom to top. */
  open(): string[];
  /** The card marked on the pick screen. */
  marked(): CharacterId;
  /** What is in a save slot, or null when it is empty. */
  saved(slot: number): GameState | null;
}

const PAGE = 'https://sigouin.net/portage/';
let browsers = 0;

function client(relay: FakeRelay | null, options: { invite?: string; storage?: FakeStorage } = {}): Client {
  const models: InterfaceModel[] = [];
  const worldView: WorldView = {
    mount: () => {}, resize: () => {}, applyGraphicsSettings: () => {}, showStage: () => {}, sync: () => {}, handleEvents: () => {},
    render: () => {}, dispose: () => {},
  };
  const gameInterface: GameInterface = { mount: () => {}, update: (model) => void models.push(model), dispose: () => {} };
  const storage = options.storage ?? new FakeStorage();
  let seed = 0;
  const app = createApp({ worldView, gameInterface, audio: createSilentAudio(), storage, now: () => 5000, randomSeed: () => (seed += 1) });
  let keys = 0;
  const browser = (browsers += 1);
  app.session.crew = relay ? new CrewLobby({
    session: app.session, address: ADDRESS, pageAddress: PAGE, open: relay.open, storage, invite: options.invite ?? null,
    makeKey: () => `key-${browser}-${(keys += 1).toString().padStart(4, '0')}-0123456789abcdef`,
  }) : null;
  const self: Client = {
    app, storage,
    model: () => {
      app.frame(0);
      return models.at(-1)!;
    },
    panel: (id) => {
      const panel = self.model().panel;
      if (panel?.id !== id) throw new Error(`the open panel is ${panel?.id ?? 'none'}, not ${id}`);
      return panel as Extract<PanelModel, { id: typeof id }>;
    },
    send: (intent) => app.session.handleIntent(intent),
    press: (button) => {
      if (!button) throw new Error('no such button');
      if (!button.enabled) throw new Error(`"${button.label}" is disabled`);
      app.session.handleIntent(button.intent);
    },
    type: (field, value) => app.session.handleIntent({ type: 'crew_field', field, value }),
    open: () => self.model().openPanels,
    marked: () => self.panel('character_select').cards.find((card) => card.marked)!.character,
    saved: (slot) => {
      const loaded = deserialize(storage.getItem(`${SAVE_KEY_PREFIX}${slot}`));
      return loaded.ok ? loaded.state : null;
    },
  };
  return self;
}

/** Frames for every client, with the sockets' timers between them. */
async function run(clients: Client[], seconds: number): Promise<void> {
  for (let frame = 0; frame < Math.round(seconds / FIXED_STEP); frame += 1) {
    await vi.advanceTimersByTimeAsync(FIXED_STEP * 1000);
    for (const each of clients) each.app.frame(FIXED_STEP);
    await Promise.resolve();
  }
}

const lobbyButton = (each: Client, label: string): ButtonModel => each.model().lobby!.buttons.find((button) => button.label === label)!;
const slotButton = (each: Client, slot: number, label: string): ButtonModel =>
  each.panel('save_slots').slots[slot]!.buttons.find((button) => button.label === label)!;
const card = (each: Client, character: CharacterId) => each.panel('character_select').cards.find((entry) => entry.character === character)!;
const picks = (game: GameState): (CharacterId | undefined)[] => game.players.map((player) => player.character);
const guestDials = (relay: FakeRelay): number => relay.dials.filter((dial) => dial.address.includes('role=guest')).length;

/** A host named Luc with an open room, still in the lobby on the room card. */
async function roomOpen(relay: FakeRelay, storage?: FakeStorage): Promise<{ host: Client; code: string }> {
  const host = client(relay, { storage });
  host.press(lobbyButton(host, 'Host a crew'));
  host.type('name', 'Luc');
  host.press(host.panel('crew_host').actions[0]);
  await run([host], 0.2);
  return { host, code: readRoomCode(host.panel('crew_host').room!.code)! };
}

/** That host, in a new game started through the screen as `character`. */
async function hosting(relay: FakeRelay, character: CharacterId = 'voyageur'): Promise<{ host: Client; code: string }> {
  const { host, code } = await roomOpen(relay);
  host.press(host.panel('crew_host').actions.find((action) => action.label === 'New Game'));
  host.press(slotButton(host, 0, 'New game here'));
  host.send(card(host, character).intent);
  host.press(host.panel('character_select').start);
  return { host, code };
}

/** A guest at the join card with the code from an invite link and a name typed, Join pressed: the pick screen is up. */
function atJoinScreen(relay: FakeRelay, code: string, name: string, storage?: FakeStorage): Client {
  const guest = client(relay, { invite: code, storage });
  guest.send({ type: 'open_panel', panel: 'crew_join' });
  guest.type('name', name);
  guest.press(guest.panel('crew_join').join);
  return guest;
}

async function joinAs(relay: FakeRelay, code: string, name: string, character: CharacterId, others: Client[], storage?: FakeStorage): Promise<Client> {
  const guest = atJoinScreen(relay, code, name, storage);
  guest.send({ type: 'cast_mark', character });
  guest.press(guest.panel('character_select').start);
  await run([...others, guest], 1);
  return guest;
}

describe('the doors that lead to the screen', () => {
  it('New Game, an empty slot: the slot, then the screen, then the game starts as the pick', () => {
    const each = client(null);
    each.press(lobbyButton(each, 'New Game'));
    each.press(slotButton(each, 1, 'New game here'));
    // The screen, on top of the save slots. Nothing has started and nothing is saved.
    expect(each.open()).toEqual(['save_slots', 'character_select']);
    expect(each.app.session.screen).toBe('lobby');
    expect(each.app.session.game).toBeNull();
    expect(each.saved(1)).toBeNull();
    const panel = each.panel('character_select');
    expect(panel).toMatchObject({ title: 'Pick who you are', door: 'new_game', subtitle: 'A new game in slot 2', seat: 0 });
    expect(panel.start).toMatchObject({ label: 'Start as The Voyageur', enabled: true });
    each.send(card(each, 'trapper').intent);
    expect(each.panel('character_select').start.label).toBe('Start as The Trapper');
    expect(each.app.session.game).toBeNull();
    each.press(each.panel('character_select').start);
    // The game, in that slot, as the trapper: on the player and in the save written at once.
    const session = each.app.session;
    expect(session.screen).toBe('game');
    expect(session.slot).toBe(1);
    expect(each.open()).toEqual([]);
    expect(session.cast).toBeNull();
    expect(picks(session.game!)).toEqual(['trapper']);
    expect(picks(each.saved(1)!)).toEqual(['trapper']);
    expect(characterOf(session.game!.players[0]!)).toBe('trapper');
  });

  it('New Game, a slot that holds a game: the slot, the confirm as today, then the screen, then the game', () => {
    const each = client(null);
    each.app.session.newGame(0);
    const original = each.saved(0)!.seed;
    each.app.session.quitToLobby();
    each.press(lobbyButton(each, 'New Game'));
    each.press(slotButton(each, 0, 'New game (overwrite)'));
    // The confirm, as today. No screen yet.
    expect(each.open()).toEqual(['save_slots', 'confirm']);
    expect(each.model().confirm).toMatchObject({ title: 'Start over in this slot?', accept: { label: 'Start new game' } });
    // Cancel: back at the slots, no screen, the old game untouched.
    each.press(each.model().confirm!.cancel);
    expect(each.open()).toEqual(['save_slots']);
    expect(each.saved(0)!.seed).toBe(original);
    // Yes: the screen. The old game is still in the slot until the pick.
    each.press(slotButton(each, 0, 'New game (overwrite)'));
    each.press(each.model().confirm!.accept);
    expect(each.open()).toEqual(['save_slots', 'character_select']);
    expect(each.panel('character_select')).toMatchObject({ door: 'new_game', subtitle: 'A new game in slot 1' });
    expect(each.app.session.game).toBeNull();
    expect(each.saved(0)!.seed).toBe(original);
    each.send(card(each, 'scout').intent);
    each.press(each.panel('character_select').start);
    expect(each.app.session.screen).toBe('game');
    expect(each.saved(0)!.seed).not.toBe(original);
    expect(picks(each.saved(0)!)).toEqual(['scout']);
  });

  it('Join a crew, by an invite link or a typed code: name and code as today, Join, then the screen, then the join goes out with the pick', async () => {
    const relay = new FakeRelay();
    const { host, code } = await hosting(relay, 'angler');
    // An invite link fills the code in. A typed code is typed.
    const sam = client(relay, { invite: code });
    sam.send({ type: 'open_panel', panel: 'crew_join' });
    sam.type('name', 'Sam');
    const ann = client(relay);
    ann.press(lobbyButton(ann, 'Join a crew'));
    ann.type('code', `${code.slice(0, 3)} ${code.slice(3)}`.toLowerCase());
    ann.type('name', 'Ann');
    for (const [guest, name, pick] of [[sam, 'Sam', 'trapper'], [ann, 'Ann', 'scout']] as const) {
      guest.press(guest.panel('crew_join').join);
      // The screen, on top of the join card. Nobody has been dialled.
      expect(guest.open()).toEqual(['crew_join', 'character_select']);
      expect(guest.app.session.guest).toBeNull();
      const panel = guest.panel('character_select');
      expect(panel).toMatchObject({ door: 'join', subtitle: `Joining crew ${guest === sam ? `${code.slice(0, 3)}-${code.slice(3)}` : `${code.slice(0, 3)} ${code.slice(3)}`} as ${name}`, seat: 0 });
      expect(panel.start.label).toBe('Join as The Voyageur');
      guest.send(card(guest, pick).intent);
      expect(guest.panel('character_select').start.label).toBe(`Join as ${CAST[pick].name}`);
    }
    expect(guestDials(relay)).toBe(0);
    // The button: back on the join card, which says how the line is doing, and the join is on its way.
    sam.press(sam.panel('character_select').start);
    expect(sam.open()).toEqual(['crew_join']);
    expect(sam.panel('crew_join')).toMatchObject({ status: 'Connecting to the relay…' });
    expect(guestDials(relay)).toBe(1);
    await run([host, sam], 1);
    ann.press(ann.panel('character_select').start);
    await run([host, sam, ann], 1);
    // Everyone sees who everyone is: the host, and each guest of the other.
    for (const each of [host, sam, ann]) {
      expect(each.app.session.screen).toBe('game');
      expect(each.app.session.game!.players.map((player) => [player.name, player.character])).toEqual([['Luc', 'angler'], ['Sam', 'trapper'], ['Ann', 'scout']]);
    }
  });
});

describe('the doors that do not', () => {
  it('Continue and Load: no screen, and the save\'s own character', () => {
    const each = client(null);
    each.app.session.newGame(2, 'scout');
    each.app.session.quitToLobby();
    const seen: string[][] = [];
    each.press(lobbyButton(each, 'Continue'));
    seen.push(each.open());
    expect(each.app.session.screen).toBe('game');
    expect(each.app.session.slot).toBe(2);
    expect(picks(each.app.session.game!)).toEqual(['scout']);
    each.app.session.quitToLobby();
    each.app.session.newGame(0, 'angler');
    each.app.session.quitToLobby();
    each.press(lobbyButton(each, 'New Game'));
    each.press(slotButton(each, 0, 'Load'));
    seen.push(each.open());
    expect(each.app.session.screen).toBe('game');
    expect(picks(each.app.session.game!)).toEqual(['angler']);
    expect(seen).toEqual([[], []]);
    expect(each.app.session.cast).toBeNull();
  });

  it('an old save, from before the screen: no screen, nobody picked for, and `characterOf` decides', () => {
    const names = Object.keys(liveSaves).sort();
    expect(names).toHaveLength(3);
    for (const name of names) {
      const storage = new FakeStorage();
      storage.setItem(`${SAVE_KEY_PREFIX}0`, liveSaves[name]!);
      const each = client(null, { storage });
      each.press(lobbyButton(each, 'Continue'));
      expect(each.app.session.screen, name).toBe('game');
      expect(each.open(), name).toEqual([]);
      const player = each.app.session.game!.players[0]!;
      expect('character' in player, name).toBe(false);
      expect(characterOf(player), name).toBe('voyageur');
      // Saved again, it is still nobody's pick: playing an old save never writes one.
      each.app.session.saveNow();
      expect('character' in each.saved(0)!.players[0]!, name).toBe(false);
    }
  });

  it('Host a crew from the pause menu, in a running game: no screen, and the host is who they were', async () => {
    const relay = new FakeRelay();
    const host = client(relay);
    host.app.session.newGame(0, 'trapper');
    host.send({ type: 'open_panel', panel: 'pause' });
    host.press(host.panel('pause').buttons.find((button) => button.label === 'Host a crew'));
    host.type('name', 'Luc');
    host.press(host.panel('crew_host').actions[0]);
    await run([host], 0.2);
    expect(host.open()).toEqual(['pause', 'crew_host']);
    expect(host.app.session.host).not.toBeNull();
    expect(host.app.session.cast).toBeNull();
    expect(host.app.session.game!.players.map((player) => [player.name, player.character])).toEqual([['Luc', 'trapper']]);
    // And the screen cannot be had in a game at all: not by its panel, not by its intents.
    for (const intent of [{ type: 'open_panel', panel: 'character_select' }, { type: 'new_game', slot: 1 }, { type: 'cast_confirm' }, { type: 'cast_mark', character: 'scout' }] as const) {
      host.send(intent);
    }
    expect(host.open()).toEqual(['pause', 'crew_host']);
    expect(host.app.session.slot).toBe(0);
    expect(picks(host.app.session.game!)).toEqual(['trapper']);
    expect(PANEL_RULES.character_select.parents).toEqual({ lobby: ['root', 'save_slots', 'crew_join'] });
  });

  it('the bot, the staged shots, `?at=` and `?crew=`: no screen, and nobody is picked for', () => {
    const queries = ['?bot=1', '?bot=1&crew=3', '?at=quest3', '?at=quest7&crew=2', '?crew=4', '?host=lake',
      ...SHOT_NAMES.filter((shot) => shot !== 'cast').map((shot) => `?shot=${shot}`), '?shot=play&crew=4'];
    for (const query of queries) {
      const each = client(null);
      applyDebugParameters(each.app, parseDebugParameters(query));
      expect(each.open(), query).not.toContain('character_select');
      expect(each.app.session.cast, query).toBeNull();
      const game = each.app.session.game;
      if (game) for (const player of game.players) expect('character' in player, query).toBe(false);
      // By seat, as before the screen.
      if (game) expect(game.players.map((player) => characterOf(player)), query).toEqual(CHARACTER_IDS.slice(0, game.players.length));
    }
    // The games the staged doors make were looked at: every one of those queries but the lobby's own.
    expect(queries.length).toBeGreaterThan(18);
  });

  it('`?shot=cast` is the screen itself, staged for a picture: over the save slots, slot 1, the first card marked', () => {
    const each = client(null);
    applyDebugParameters(each.app, parseDebugParameters('?shot=cast'));
    expect(each.open()).toEqual(['save_slots', 'character_select']);
    expect(each.app.session.screen).toBe('lobby');
    expect(each.panel('character_select')).toMatchObject({ door: 'new_game', subtitle: 'A new game in slot 1' });
    expect(each.marked()).toBe('voyageur');
    expect(parseDebugParameters('?shot=cast')).toMatchObject({ shot: 'cast', sandbox: true });
  });

  it('no menu line opens it, and its two intents do nothing while it is not up', () => {
    const each = client(new FakeRelay());
    each.send({ type: 'open_panel', panel: 'character_select' });
    expect(each.open()).toEqual([]);
    for (const parent of ['settings', 'how_to_play', 'credits', 'crew_host', 'feedback'] as const) {
      each.send({ type: 'open_panel', panel: parent });
      each.send({ type: 'open_panel', panel: 'character_select' });
      each.send({ type: 'cast_mark', character: 'scout' });
      each.send({ type: 'cast_confirm' });
      expect(each.app.session.cast).toBeNull();
      expect(each.app.session.game).toBeNull();
      each.send({ type: 'close_panel' });
    }
    expect(each.storage.getItem(CAST_PICK_SLOT)).toBeNull();
    expect(lobbyButton(each, 'Continue').enabled).toBe(false);
  });
});

describe('Back, and what was typed', () => {
  it('from a new game: back at the save slots, nothing started, nothing saved, nothing kept', () => {
    const each = client(null);
    each.press(lobbyButton(each, 'New Game'));
    each.press(slotButton(each, 2, 'New game here'));
    each.send(card(each, 'angler').intent);
    const back = each.panel('character_select').close;
    expect(back).toMatchObject({ label: 'Back', intent: { type: 'close_panel' } });
    each.press(back);
    expect(each.open()).toEqual(['save_slots']);
    expect(each.app.session.cast).toBeNull();
    expect(each.app.session.game).toBeNull();
    expect([0, 1, 2].map((slot) => each.saved(slot))).toEqual([null, null, null]);
    expect(each.storage.getItem(CAST_PICK_SLOT)).toBeNull();
    // Esc is Back too, and the screen opens again as it first did: the mark is not left on the angler.
    each.press(slotButton(each, 2, 'New game here'));
    expect(each.marked()).toBe('voyageur');
    each.app.session.keyDown('Escape');
    expect(each.open()).toEqual(['save_slots']);
    expect(each.app.session.game).toBeNull();
  });

  it('from a join: back at the join card with the name and the code still there, and nothing was dialled or sent', async () => {
    const relay = new FakeRelay();
    const { host, code } = await hosting(relay);
    const guest = client(relay);
    guest.press(lobbyButton(guest, 'Join a crew'));
    guest.type('code', code);
    guest.type('name', 'Samuel');
    guest.press(guest.panel('crew_join').join);
    guest.send(card(guest, 'scout').intent);
    guest.press(guest.panel('character_select').close);
    await run([host, guest], 0.5);
    expect(guest.open()).toEqual(['crew_join']);
    const panel = guest.panel('crew_join');
    expect([panel.code.value, panel.name.value, panel.code.enabled, panel.name.enabled, panel.join.enabled, panel.status, panel.cancel])
      .toEqual([code, 'Samuel', true, true, true, '', null]);
    expect(guestDials(relay)).toBe(0);
    expect(guest.app.session.guest).toBeNull();
    expect(host.app.session.game!.players).toHaveLength(1);
    expect(guest.storage.getItem(CAST_PICK_SLOT)).toBeNull();
    // And what is wrong with what was typed is said on the card as today, with no screen.
    guest.type('code', 'ABC');
    guest.press(guest.panel('crew_join').join);
    expect(guest.open()).toEqual(['crew_join']);
    expect(guest.panel('crew_join').status).toBe('That is not a crew code. A code is six letters and digits, like FHJ-K3M.');
    guest.type('code', code);
    guest.type('name', '  ');
    guest.press(guest.panel('crew_join').join);
    expect(guest.open()).toEqual(['crew_join']);
    expect(guest.panel('crew_join').status).toBe('Type a name first.');
    expect(guestDials(relay)).toBe(0);
  });

  it('a join that fails after the pick says so as today, on the join card', async () => {
    const relay = new FakeRelay();
    const { host, code } = await hosting(relay);
    // A code that is no room: found out only once the join goes out.
    const lost = atJoinScreen(relay, 'QRTWXY', 'Sam');
    expect(lost.open()).toEqual(['crew_join', 'character_select']);
    lost.press(lost.panel('character_select').start);
    await run([host, lost], 0.5);
    expect(lost.open()).toEqual(['crew_join']);
    expect(lost.panel('crew_join')).toMatchObject({ status: 'No crew with that code. Check it with whoever sent it.', statusTone: 'danger', join: { enabled: true } });
    // A full canoe.
    const guests: Client[] = [];
    for (const name of ['Ann', 'Bo', 'Cy']) guests.push(await joinAs(relay, code, name, 'trapper', [host, ...guests]));
    const fifth = await joinAs(relay, code, 'Dee', 'scout', [host, ...guests]);
    expect(fifth.open()).toEqual(['crew_join']);
    expect(fifth.panel('crew_join')).toMatchObject({ status: 'That crew is full.', statusTone: 'danger' });
    expect(picks(host.app.session.game!)).toEqual(['voyageur', 'trapper', 'trapper', 'trapper']);
    // The relay down.
    relay.up = false;
    const cut = atJoinScreen(relay, code, 'Eve');
    cut.press(cut.panel('character_select').start);
    await run([cut], 4);
    expect(cut.open()).toEqual(['crew_join']);
    expect(cut.panel('crew_join')).toMatchObject({ status: 'The relay cannot be reached. Check your connection and try again.', statusTone: 'danger' });
  });
});

describe('the pick sticks', () => {
  it('in the save and after a reload: a new browser session on the same storage continues as the same person', () => {
    const storage = new FakeStorage();
    const first = client(null, { storage });
    first.send({ type: 'new_game', slot: 0 });
    first.send(card(first, 'angler').intent);
    first.press(first.panel('character_select').start);
    first.app.session.pageClosing();
    // The page is opened again.
    const again = client(null, { storage });
    again.press(lobbyButton(again, 'Continue'));
    expect(again.open()).toEqual([]);
    expect(picks(again.app.session.game!)).toEqual(['angler']);
  });

  it('the last pick is the one marked next time, at either door, and with none kept it is the first', async () => {
    const storage = new FakeStorage();
    const each = client(null, { storage });
    each.send({ type: 'new_game', slot: 0 });
    expect(each.marked()).toBe('voyageur');
    each.send(card(each, 'scout').intent);
    // Marking keeps nothing: only the button does.
    expect(storage.getItem(CAST_PICK_SLOT)).toBeNull();
    each.press(each.panel('character_select').start);
    expect(storage.getItem(CAST_PICK_SLOT)).toBe('scout');
    each.app.session.quitToLobby();
    each.send({ type: 'new_game', slot: 1 });
    expect(each.marked()).toBe('scout');
    expect(each.panel('character_select').start.label).toBe('Start as The Scout');
    // Another visit, the join door: the same browser, the same mark.
    const relay = new FakeRelay();
    const { code } = await hosting(relay);
    const later = atJoinScreen(relay, code, 'Sam', storage);
    expect(later.marked()).toBe('scout');
    expect(later.panel('character_select').start.label).toBe('Join as The Scout');
    // Something else in the slot (an id from a build to come, a number): the first.
    for (const junk of ['wizard', '', '3', 'constructor']) {
      const odd = new FakeStorage();
      odd.setItem(CAST_PICK_SLOT, junk);
      expect(keptCharacter(odd), junk).toBe('voyageur');
    }
    // A browser that keeps nothing: the pick still goes on the player, and the first is marked next time.
    const sealed = new FakeStorage();
    const blocked = client(null, { storage: sealed });
    blocked.send({ type: 'new_game', slot: 0 });
    blocked.send(card(blocked, 'trapper').intent);
    sealed.failWrites = true;
    blocked.press(blocked.panel('character_select').start);
    expect(picks(blocked.app.session.game!)).toEqual(['trapper']);
    expect(keptCharacter({ getItem: () => { throw new Error('blocked'); }, setItem: () => {} })).toBe('voyageur');
    expect(() => keepCharacter(sealed, 'scout')).not.toThrow();
  });

  it('the host\'s own pick is on its player when it starts the game, hosting or not, and in the first state a guest gets', async () => {
    // Not hosting.
    const solo = client(null);
    solo.send({ type: 'new_game', slot: 0 });
    solo.send(card(solo, 'trapper').intent);
    solo.press(solo.panel('character_select').start);
    expect(picks(solo.app.session.game!)).toEqual(['trapper']);
    expect(solo.app.session.host).toBeNull();
    // Hosting, with a friend already waiting in the room: the friend's first sight of the game has the host as picked.
    const relay = new FakeRelay();
    const { host, code } = await roomOpen(relay);
    const sam = await joinAs(relay, code, 'Sam', 'angler', [host]);
    expect(sam.app.session.screen).toBe('lobby');
    host.press(host.panel('crew_host').actions.find((action) => action.label === 'New Game'));
    host.press(slotButton(host, 0, 'New game here'));
    host.send(card(host, 'scout').intent);
    host.press(host.panel('character_select').start);
    const seen: (CharacterId | undefined)[][] = [];
    for (let frame = 0; frame < 60; frame += 1) {
      await run([host, sam], FIXED_STEP);
      const game = sam.app.session.game;
      if (game) seen.push(picks(game));
    }
    expect(seen.length).toBeGreaterThan(10);
    // Never a state with the host unpicked, and never Sam as anyone but the angler.
    for (const state of seen) expect(state).toEqual(['scout', 'angler']);
    host.app.session.saveNow();
    expect(picks(host.saved(0)!)).toEqual(['scout', 'angler']);
  });

  it('a guest who comes back is who they were, and may come back as someone else', async () => {
    const relay = new FakeRelay();
    const { host, code } = await hosting(relay, 'voyageur');
    const storage = new FakeStorage();
    let sam = await joinAs(relay, code, 'Sam', 'trapper', [host], storage);
    expect(host.app.session.game!.players[1]).toMatchObject({ name: 'Sam', character: 'trapper', connected: true });
    // The window is closed and the link opened again: the trapper is marked, and one press is the trapper again.
    sam.app.session.pageClosing();
    await run([host], 0.5);
    expect(host.app.session.game!.players[1]).toMatchObject({ connected: false, character: 'trapper' });
    sam = atJoinScreen(relay, code, 'Sam', storage);
    expect(sam.marked()).toBe('trapper');
    sam.press(sam.panel('character_select').start);
    await run([host, sam], 1);
    expect(sam.app.session.localPlayerId).toBe(1);
    expect(host.app.session.game!.players[1]).toMatchObject({ name: 'Sam', character: 'trapper', connected: true });
    // And again, as the scout this time: the same seat, the same pack, another figure, on both screens.
    host.app.session.game!.players[1]!.backpack.push({ itemId: 'driftwood', count: 3 });
    sam.app.session.pageClosing();
    await run([host], 0.5);
    sam = await joinAs(relay, code, 'Sam', 'scout', [host], storage);
    expect(sam.app.session.localPlayerId).toBe(1);
    for (const each of [host, sam]) {
      expect(each.app.session.game!.players).toHaveLength(2);
      expect(each.app.session.game!.players[1]).toMatchObject({ name: 'Sam', character: 'scout', backpack: [{ itemId: 'driftwood', count: 3 }] });
    }
  });
});

describe('the screen in words', () => {
  it('four cards in the order of the cast, the words from `CAST`, one marked, one button that names the pick', () => {
    for (const marked of CHARACTER_IDS) {
      for (const door of [{ kind: 'new_game', slot: 2 }, { kind: 'join' }] as const) {
        const panel = buildCastPanel({ door, marked });
        expect(panel.cards.map((entry) => entry.character)).toEqual([...CHARACTER_IDS]);
        expect(panel.cards.map((entry) => [entry.name, entry.line])).toEqual(CHARACTER_IDS.map((id) => [CAST[id].name, CAST[id].line]));
        expect(panel.cards.map((entry) => entry.initial)).toEqual(['V', 'T', 'A', 'S']);
        expect(panel.cards.filter((entry) => entry.marked).map((entry) => entry.character)).toEqual([marked]);
        expect(panel.cards.map((entry) => entry.intent)).toEqual(CHARACTER_IDS.map((character) => ({ type: 'cast_mark', character })));
        expect(panel.start).toEqual({ label: `${door.kind === 'join' ? 'Join' : 'Start'} as ${CAST[marked].name}`, intent: { type: 'cast_confirm' }, enabled: true, note: null });
        expect(panel).toMatchObject({ id: 'character_select', door: door.kind, groupLabel: 'Who you are', note: CAST_NOTE, seat: 0 });
      }
    }
    expect(castStartLabel('new_game', 'trapper')).toBe('Start as The Trapper');
    expect(castStartLabel('join', 'trapper')).toBe('Join as The Trapper');
    expect(buildCastPanel({ door: { kind: 'join' }, marked: 'scout' }).subtitle).toBe('Joining a crew');
  });

  it('a click marks a card and nothing else; a pick that is not one of the four marks nothing', () => {
    const each = client(null);
    each.send({ type: 'new_game', slot: 0 });
    for (const character of ['scout', 'angler', 'angler', 'voyageur'] as const) {
      each.send(card(each, character).intent);
      expect(each.marked()).toBe(character);
      expect(each.open()).toEqual(['character_select']);
      expect(each.app.session.game).toBeNull();
    }
    for (const junk of ['wizard', 'constructor', '', 7, null]) {
      each.send({ type: 'cast_mark', character: junk as CharacterId });
      expect(each.marked()).toBe('voyageur');
    }
  });

  it('Left and Right step the mark round the four', () => {
    expect(CHARACTER_IDS.map((id) => neighbourCharacter(id, 1))).toEqual(['trapper', 'angler', 'scout', 'voyageur']);
    expect(CHARACTER_IDS.map((id) => neighbourCharacter(id, -1))).toEqual(['scout', 'voyageur', 'trapper', 'angler']);
  });
});

describe('what the pick does not touch', () => {
  it('the crew list, the map\'s marks and the pings are by seat colour, whoever anyone is', () => {
    const staged = (): GameState => {
      const game = newGame(7, { crew: 4 });
      game.players.forEach((player, index) => {
        player.name = ['Luc', 'Sam', '', 'Odile'][index]!;
      });
      for (const player of game.players) dispatch(game, { type: 'ping', x: game.canoe.position.x + 5 * player.id, z: game.canoe.position.z }, player.id);
      return game;
    };
    const plain = staged();
    const picked = staged();
    (['scout', 'angler', 'trapper', 'voyageur'] as const).forEach((character, id) => setPlayerCharacter(picked, id, character));
    expect(picks(picked)).toEqual(['scout', 'angler', 'trapper', 'voyageur']);
    for (const playerId of [0, 2]) {
      const hud = (game: GameState) => buildHudModel(game, createDefaultSettings(), 0, playerId, 0, false);
      expect(hud(picked).crew).toEqual(hud(plain).crew);
      expect(hud(picked).crew.map((row) => row.color)).toHaveLength(4);
      expect(hud(picked).compass).toEqual(hud(plain).compass);
      expect(hud(picked).minimap).toEqual(hud(plain).minimap);
      expect(buildMapPanel(picked, playerId)).toEqual(buildMapPanel(plain, playerId));
    }
    expect(chartPings(picked)).toEqual(chartPings(plain));
    expect(chartPings(picked)).toHaveLength(4);
  });
});
