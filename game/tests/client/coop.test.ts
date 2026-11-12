/**
 * Two whole clients, a host and a guest, joined by a loopback wire: the
 * guest's keys, panels, HUD, toasts and sound work as a solo session's do,
 * and the game they show is the host's.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/client/app.ts';
import type { App } from '../../src/client/app.ts';
import { createSilentAudio } from '../../src/client/contracts.ts';
import type { AudioEngine, GameInterface, InterfaceModel, WorldView } from '../../src/client/contracts.ts';
import type { SessionSignal } from '../../src/client/session.ts';
import { SAVE_KEY_PREFIX, deserialize } from '../../src/save/index.ts';
import { HOST_QUIET_SECONDS, createLoopbackPair } from '../../src/net/index.ts';
import type { HostLink, LoopbackConditions, LoopbackPair } from '../../src/net/index.ts';
import { FIXED_STEP, dispatch, drainEvents, hashState } from '../../src/sim/index.ts';
import type { GameEvent, GameState } from '../../src/sim/index.ts';
import { FakeStorage, countIn, floatCanoeAt, newGame } from '../support.ts';

interface Client {
  app: App;
  /** What this browser keeps: its saves and its settings. */
  storage: FakeStorage;
  models: InterfaceModel[];
  /** The state the look was last handed. */
  drawn: GameState[];
  worldEvents: GameEvent[];
  audioEvents: GameEvent[];
  signals: SessionSignal[];
  toasts(): string[];
}

function client(): Client {
  const models: InterfaceModel[] = [];
  const drawn: GameState[] = [];
  const worldEvents: GameEvent[] = [];
  const audioEvents: GameEvent[] = [];
  const signals: SessionSignal[] = [];
  const worldView: WorldView = {
    mount: () => {}, resize: () => {}, applyGraphicsSettings: () => {}, showStage: () => {},
    sync: (state) => void drawn.push(state),
    handleEvents: (events) => void worldEvents.push(...events),
    render: () => {}, dispose: () => {},
  };
  const gameInterface: GameInterface = { mount: () => {}, update: (model) => void models.push(model), dispose: () => {} };
  const audio: AudioEngine = { ...createSilentAudio(), handleEvents: (events) => void audioEvents.push(...events) };
  const storage = new FakeStorage();
  const app = createApp({ worldView, gameInterface, audio, storage, now: () => 5000, randomSeed: () => 42 });
  app.session.subscribe((signal) => void signals.push(signal));
  return { app, storage, models, drawn, worldEvents, audioEvents, signals, toasts: () => models.at(-1)!.toasts.map((toast) => toast.text) };
}

/** A tight dry hull on calm water, the first quest behind the crew. */
function calmGame(): GameState {
  const game = newGame(7);
  game.canoe.hullTier = 1;
  floatCanoeAt(game, 200, 1300, 0);
  game.weather.secondsRemaining = 99999;
  game.quests.bail_out.status = 'completed';
  game.quests.first_haul.status = 'active';
  drainEvents(game);
  return game;
}

const KEY = 'key-sam-0123456789';

interface Table {
  host: Client;
  guest: Client;
  link: HostLink;
  pair: LoopbackPair;
  game: GameState;
  tick(seconds: number): void;
}

/** A host sharing a game and a guest who has asked to join it. */
function table(conditions: Partial<LoopbackConditions> = {}): Table {
  const host = client();
  const guest = client();
  let link: HostLink | null = null;
  host.app.session.playerName = 'Luc';
  host.app.session.onShare = (made) => {
    link = made;
  };
  const game = calmGame();
  host.app.session.adoptGame(game);
  const pair = createLoopbackPair(conditions);
  link!.accept(pair.host);
  guest.app.session.joinGame(pair.guest, { name: 'Sam', key: KEY });
  return {
    host, guest, link: link!, pair, game,
    tick(seconds: number): void {
      for (let frame = 0; frame < Math.round(seconds / FIXED_STEP); frame += 1) {
        pair.advance(FIXED_STEP);
        host.app.frame(FIXED_STEP);
        guest.app.frame(FIXED_STEP);
      }
    },
  };
}

describe('a guest joins a host', () => {
  it('waits in the lobby, then lands in the host\'s canoe as its own player', () => {
    const { host, guest, game, tick } = table({ delay: 0.2 });
    guest.app.frame(FIXED_STEP);
    expect(guest.app.session.screen).toBe('lobby');
    expect(guest.app.session.game).toBeNull();
    tick(1);
    const session = guest.app.session;
    expect(session.screen).toBe('game');
    expect(session.localPlayerId).toBe(1);
    expect(session.hostId).toBe(0);
    expect(guest.signals.filter((signal) => signal.type === 'game_started')).toHaveLength(1);
    expect(game.players.map((player) => [player.name, player.mode, player.seat, player.connected])).toEqual([
      ['Luc', 'canoe', 0, true], ['Sam', 'canoe', 1, true],
    ]);
    // The host's screen says who joined; the guest is not told about themselves.
    expect(host.toasts()).toContain('Sam joined the crew');
    expect(guest.toasts()).not.toContain('Sam joined the crew');
    expect(host.app.session.hostId).toBe(0);
  });

  it('shows both screens the same crew: who is you, who hosts', () => {
    const { host, guest, tick } = table();
    tick(1);
    const onGuest = guest.models.at(-1)!.hud!.crew.map((row) => [row.label, row.you, row.host, row.away]);
    const onHost = host.models.at(-1)!.hud!.crew.map((row) => [row.label, row.you, row.host, row.away]);
    expect(onGuest).toEqual([['Luc', false, true, false], ['Sam', true, false, false]]);
    expect(onHost).toEqual([['Luc', true, true, false], ['Sam', false, false, false]]);
  });

  it('draws the host\'s game on the guest\'s screen: never the host\'s own object, never stepped by the guest', () => {
    const { host, guest, game, tick } = table();
    tick(2);
    const shown = guest.drawn.at(-1)!;
    expect(shown).not.toBe(game);
    expect(shown.seed).toBe(game.seed);
    expect(guest.app.session.game).toBe(shown);
    expect(host.drawn.at(-1)).toBe(game);
    // A beat behind the host, and catching up.
    expect(shown.playedSeconds).toBeGreaterThan(game.playedSeconds - 0.5);
    expect(shown.playedSeconds).toBeLessThanOrEqual(game.playedSeconds);
    expect(guest.app.session.guest!.mismatches).toBe(0);
  });
});

describe('a guest plays', () => {
  it('paddles with its own keys: the host\'s canoe moves, and both screens see it', () => {
    const { host, guest, game, tick } = table();
    tick(1);
    const start = game.canoe.position.z;
    guest.app.session.keyDown('KeyW');
    tick(4);
    expect(game.players[1].paddling).toBe(true);
    expect(game.players[0].paddling).toBe(false);
    expect(game.canoe.position.z).toBeLessThan(start - 2);
    expect(guest.drawn.at(-1)!.canoe.position.z).toBeLessThan(start - 2);
    expect(host.drawn.at(-1)!.players[1]!.paddling).toBe(true);
    guest.app.session.keyUp('KeyW');
    tick(1);
    expect(game.players[1].paddling).toBe(false);
  });

  it('sees the host move: the host paddles and the guest\'s view follows', () => {
    const { host, guest, game, tick } = table();
    tick(1);
    const start = guest.drawn.at(-1)!.canoe.position.z;
    host.app.session.keyDown('KeyW');
    tick(4);
    expect(game.players[0].paddling).toBe(true);
    expect(guest.drawn.at(-1)!.canoe.position.z).toBeLessThan(start - 2);
    expect(guest.drawn.at(-1)!.players[0]!.paddling).toBe(true);
  });

  it('sends its commands to the host, as itself, and hears a refusal in words', () => {
    const { host, guest, game, tick } = table();
    tick(1);
    game.players[0].backpack.push({ itemId: 'berries', count: 2 });
    guest.app.session.handleIntent({ type: 'command', command: { type: 'eat', itemId: 'berries' } });
    tick(0.5);
    // The host has berries. The guest does not: the host's are not the guest's to eat.
    expect(countIn(game.players[0].backpack, 'berries')).toBe(2);
    expect(guest.toasts()).toContain('You do not have that.');
    expect(host.toasts()).not.toContain('You do not have that.');
    game.players[1].backpack.push({ itemId: 'berries', count: 2 });
    game.players[1].hunger = 40;
    guest.app.session.handleIntent({ type: 'command', command: { type: 'eat', itemId: 'berries' } });
    tick(0.5);
    expect(countIn(game.players[1].backpack, 'berries')).toBe(1);
    expect(game.players[1].hunger).toBeGreaterThan(40);
    expect(guest.models.at(-1)!.hud!.meters[0]!.value).toBeGreaterThan(40);
  });

  it('a tool one makes is the other\'s too, and both are told who made it', () => {
    const { host, guest, game, tick } = table();
    tick(1);
    game.players[1].backpack.push({ itemId: 'stone', count: 2 }, { itemId: 'driftwood', count: 1 }, { itemId: 'fiber', count: 2 });
    guest.app.session.handleIntent({ type: 'command', command: { type: 'craft', recipeId: 'stone_knife' } });
    tick(0.5);
    expect(game.tools).toContain('stone_knife');
    expect(host.toasts()).toContain('Sam made a new tool: Stone knife');
    expect(guest.toasts()).toContain('You made a new tool: Stone knife');
    // The host takes it in hand; the guest sees it in the host's hand and on its own belt.
    expect(host.app.session.dispatch({ type: 'select_tool', toolId: 'stone_knife' }).ok).toBe(true);
    tick(0.5);
    expect(guest.app.session.game!.players[0]!.selectedTool).toBe('stone_knife');
    expect(guest.models.at(-1)!.hud!.hotbar.some((slot) => slot.itemId === 'stone_knife')).toBe(true);
  });

  it('hears the frame\'s events as a solo screen does: its own to the sound, everyone\'s to the world', () => {
    const { guest, game, tick } = table();
    tick(1);
    guest.worldEvents.length = 0;
    guest.audioEvents.length = 0;
    game.events.push({ type: 'ate', itemId: 'berries', playerId: 0 }, { type: 'ate', itemId: 'berries', playerId: 1 }, { type: 'quest_ready', questId: 'first_haul' });
    tick(0.5);
    expect(guest.worldEvents.map((event) => [event.type, event.playerId])).toEqual([['ate', 0], ['ate', 1], ['quest_ready', undefined]]);
    expect(guest.audioEvents.map((event) => [event.type, event.playerId])).toEqual([['ate', 1], ['quest_ready', undefined]]);
  });

  it('cannot change the game by itself: its own settings and its own copy stay its own', () => {
    const { guest, game, tick } = table();
    tick(1);
    const session = guest.app.session;
    session.updateSettings({ ...session.settings, gameplay: { ...session.settings.gameplay, difficulty: 'relaxed' } });
    // Not even its own copy: the setting is for the guest's own games.
    expect(session.game!.difficulty).toBe('standard');
    session.game!.tools.push('hatchet');
    session.game!.players[0]!.hunger = 1;
    tick(1);
    expect(game.difficulty).toBe('standard');
    expect(game.tools).toEqual(['bailing_can']);
    expect(game.players[0].hunger).toBeGreaterThan(50);
    expect(session.saveNow()).toBe(false);
  });
});

describe('nothing pauses a shared game', () => {
  it('the host\'s panels and the guest\'s open over a game that keeps running; alone again, the host\'s pause it', () => {
    const { host, guest, game, tick } = table();
    tick(1);
    host.app.session.handleIntent({ type: 'open_panel', panel: 'inventory' });
    guest.app.session.handleIntent({ type: 'open_panel', panel: 'map' });
    expect(host.app.session.paused).toBe(false);
    expect(guest.app.session.paused).toBe(false);
    const played = game.playedSeconds;
    tick(2);
    expect(game.playedSeconds).toBeCloseTo(played + 2, 6);
    // The guest goes: the host is alone, and the open panel pauses the game as it always did.
    guest.app.session.quitToLobby();
    tick(0.5);
    expect(host.app.session.paused).toBe(true);
    const held = game.playedSeconds;
    tick(1);
    expect(game.playedSeconds).toBe(held);
  });
});

describe('leaving and coming back', () => {
  it('tells a guest whose line has stalled, for as long as it has, and once when the crew is back', () => {
    const { host, guest, pair, game, tick } = table();
    tick(1);
    const hud = () => guest.models.at(-1)!.hud!;
    const QUIET = 'No word from the host. Waiting…';
    expect(hud().lineNote).toBeNull();
    // The note is not a tip: it shows with the hints setting off.
    guest.app.session.updateSettings({ ...guest.app.session.settings, gameplay: { ...guest.app.session.settings.gameplay, hints: false } });

    // The line stalls. The socket stays open and nothing crosses it, either way.
    pair.conditions.loss = 1;
    tick(HOST_QUIET_SECONDS - 0.2);
    expect(hud().lineNote, 'a hiccup shorter than the wait says nothing').toBeNull();
    tick(0.4);
    expect(hud().lineNote).toBe(QUIET);
    expect(guest.app.session.screen).toBe('game');
    // It stands. A toast would be gone by now (the longest lasts seven seconds), and the host has marked Sam away.
    tick(10);
    expect(hud().lineNote).toBe(QUIET);
    expect(game.players[1]!.connected).toBe(false);
    expect(guest.toasts()).not.toContain('Back with the crew.');
    // The host's own screen never carries it.
    expect(host.models.at(-1)!.hud!.lineNote).toBeNull();

    // The line clears: the note goes, and the guest is told once.
    pair.conditions.loss = 0;
    tick(1);
    expect(hud().lineNote).toBeNull();
    expect(guest.toasts()).toContain('Back with the crew.');
    expect(guest.signals.filter((signal) => signal.type === 'notice' && signal.text === 'Back with the crew.')).toHaveLength(1);
    expect(game.players[1]!.connected).toBe(true);
    // And a line that is fine says nothing more.
    tick(8);
    expect(hud().lineNote).toBeNull();
    expect(guest.signals.filter((signal) => signal.type === 'notice' && signal.text === 'Back with the crew.')).toHaveLength(1);
  });

  it('a guest\'s pause menu says what quitting is for a guest: leave the crew, the seat is kept. The host\'s still saves', () => {
    const { host, guest, game, tick } = table();
    tick(1);
    const menu = (who: Client): { quit: string; confirm: { title: string; message: string; accept: string } } => {
      who.app.session.handleIntent({ type: 'open_panel', panel: 'pause' });
      who.app.frame(FIXED_STEP);
      const panel = who.models.at(-1)!.panel!;
      if (panel.id !== 'pause') throw new Error('expected the pause menu');
      const quit = panel.buttons.at(-1)!;
      who.app.session.handleIntent(quit.intent);
      who.app.frame(FIXED_STEP);
      const confirm = who.models.at(-1)!.confirm!;
      return { quit: quit.label, confirm: { title: confirm.title, message: confirm.message, accept: confirm.accept.label } };
    };
    expect(menu(guest)).toEqual({ quit: 'Leave the crew', confirm: { title: 'Leave the crew?', message: 'Your seat is kept.', accept: 'Leave the crew' } });
    expect(menu(host)).toEqual({ quit: 'Save and quit to the lobby', confirm: { title: 'Quit to the lobby?', message: 'The game is saved first.', accept: 'Save and quit' } });
    // The words are true. The guest leaves, and the seat is kept: the same key gets the same player back.
    guest.app.session.handleIntent({ type: 'answer_confirm', accepted: true });
    tick(0.5);
    expect(guest.app.session.screen).toBe('lobby');
    expect(game.players[1]).toMatchObject({ name: 'Sam', connected: false });
    const pair = createLoopbackPair();
    host.app.session.host!.accept(pair.host);
    guest.app.session.joinGame(pair.guest, { name: 'Sam', key: KEY });
    for (let frame = 0; frame < 60; frame += 1) {
      pair.advance(FIXED_STEP);
      host.app.frame(FIXED_STEP);
      guest.app.frame(FIXED_STEP);
    }
    expect(guest.app.session.localPlayerId).toBe(1);
    expect(game.players).toHaveLength(2);
    expect(game.players[1]).toMatchObject({ name: 'Sam', connected: true });
  });

  it('a tool a guest makes is saved at once, by the host: the guest\'s own browser saves nothing', () => {
    const host = client();
    const guest = client();
    let link: HostLink | null = null;
    host.app.session.onShare = (made) => {
      link = made;
    };
    // A real game in a slot of the host's, with no timer: only the moments that ask for a save make one.
    host.app.session.updateSettings({ ...host.app.session.settings, gameplay: { ...host.app.session.settings.gameplay, autosaveIntervalSeconds: 0 } });
    host.app.session.newGame(0);
    const pair = createLoopbackPair();
    link!.accept(pair.host);
    guest.app.session.joinGame(pair.guest, { name: 'Sam', key: KEY });
    const tick = (seconds: number): void => {
      for (let frame = 0; frame < Math.round(seconds / FIXED_STEP); frame += 1) {
        pair.advance(FIXED_STEP);
        host.app.frame(FIXED_STEP);
        guest.app.frame(FIXED_STEP);
      }
    };
    tick(1);
    expect(guest.app.session.localPlayerId).toBe(1);
    const saves = (who: Client): string[] => who.signals.flatMap((signal) => (signal.type === 'saved' ? [signal.reason] : []));
    const saveKeys = (who: Client): string[] => [...who.storage.entries.keys()].filter((key) => key.startsWith(SAVE_KEY_PREFIX));
    const savedTools = (): string[] => {
      const result = deserialize(host.storage.getItem(`${SAVE_KEY_PREFIX}0`));
      if (!result.ok) throw new Error(result.reason);
      return result.state.tools;
    };
    expect(saves(host)).toEqual(['manual']);
    expect(savedTools()).toEqual(['bailing_can']);

    // Sam makes the crew's knife.
    host.app.session.game!.players[1]!.backpack.push({ itemId: 'stone', count: 2 }, { itemId: 'driftwood', count: 1 }, { itemId: 'fiber', count: 2 });
    tick(0.3);
    guest.app.session.dispatch({ type: 'craft', recipeId: 'stone_knife', count: 1 });
    tick(1);
    expect(host.app.session.game!.tools).toEqual(['bailing_can', 'stone_knife']);
    expect(saves(host)).toEqual(['manual', 'tool']);
    expect(savedTools()).toEqual(['bailing_can', 'stone_knife']);
    // These saves are quiet: the knife has its own notes, and nothing more is stacked on them.
    expect(host.toasts()).toContain('Sam made a new tool: Stone knife');
    expect(host.toasts()).not.toContain('Game saved');

    // The guest saw the same events and saved nothing, then or ever: no slot, no write, no signal.
    expect(guest.toasts()).toContain('You made a new tool: Stone knife');
    expect(saves(guest)).toEqual([]);
    expect(saveKeys(guest)).toEqual([]);
    expect(guest.app.session.saveNow()).toBe(false);
    guest.app.session.pageClosing();
    expect(saveKeys(guest)).toEqual([]);
    expect(saveKeys(host)).toEqual([`${SAVE_KEY_PREFIX}0`]);
  });

  it('a guest who quits is back in the lobby with nothing kept, and shows as away on the host', () => {
    const { host, guest, game, tick } = table();
    tick(1);
    game.players[1].backpack.push({ itemId: 'driftwood', count: 3 });
    guest.app.session.quitToLobby();
    expect(guest.app.session.screen).toBe('lobby');
    expect(guest.app.session.game).toBeNull();
    expect(guest.app.session.guest).toBeNull();
    expect(guest.app.session.localPlayerId).toBe(0);
    tick(0.5);
    expect(game.players[1]).toMatchObject({ connected: false, name: 'Sam', backpack: [{ itemId: 'driftwood', count: 3 }] });
    expect(host.toasts()).toContain('Sam is away');
    expect(host.models.at(-1)!.hud!.crew.map((row) => [row.label, row.away])).toEqual([['Luc', false], ['Sam', true]]);
  });

  it('the same key on a new screen gets the same player back, with what they had', () => {
    const { host, guest, game, link, tick } = table();
    tick(1);
    game.players[1].backpack.push({ itemId: 'driftwood', count: 3 });
    guest.app.session.quitToLobby();
    tick(0.5);
    const again = client();
    const pair = createLoopbackPair();
    link.accept(pair.host);
    again.app.session.joinGame(pair.guest, { name: 'Sam', key: KEY });
    for (let frame = 0; frame < 60; frame += 1) {
      pair.advance(FIXED_STEP);
      host.app.frame(FIXED_STEP);
      again.app.frame(FIXED_STEP);
    }
    expect(again.app.session.localPlayerId).toBe(1);
    expect(game.players).toHaveLength(2);
    expect(game.players[1]).toMatchObject({ connected: true, backpack: [{ itemId: 'driftwood', count: 3 }] });
    expect(host.toasts()).toContain('Sam is back');
    expect(again.models.at(-1)!.hud!.crew.map((row) => row.away)).toEqual([false, false]);
  });

  it('when the host quits, the guest is told and goes back to the lobby; the host\'s save keeps the guest, away', () => {
    const { host, guest, game, tick } = table();
    tick(1);
    host.app.session.quitToLobby();
    tick(0.5);
    expect(guest.app.session.screen).toBe('lobby');
    expect(guest.app.session.game).toBeNull();
    expect(guest.toasts()).toContain('The host closed the game.');
    expect(game.players.map((player) => player.connected)).toEqual([true, false]);
    expect(host.app.session.host).toBeNull();
    expect(host.app.session.hostId).toBeNull();
  });

  it('a session that shares nothing has no link and no host: solo is as it was', () => {
    const solo = client();
    solo.app.session.adoptGame(calmGame());
    solo.app.frame(FIXED_STEP);
    expect(solo.app.session.host).toBeNull();
    expect(solo.app.session.guest).toBeNull();
    expect(solo.app.session.hostId).toBeNull();
    expect(solo.models.at(-1)!.hud!.crew).toEqual([]);
  });

  it('host and guest end on the same fingerprint over a bad line, whole clients and all', () => {
    const { host, guest, game, pair, tick } = table({ delay: 0.1, jitter: 0.08, loss: 0.15 });
    tick(2);
    guest.app.session.keyDown('KeyW');
    host.app.session.keyDown('KeyD');
    tick(20);
    guest.app.session.keyUp('KeyW');
    host.app.session.keyUp('KeyD');
    expect(guest.app.session.guest!.mismatches).toBe(0);
    // Let the messages settle: the host holds still (the debug freeze), still sending.
    host.app.session.frozen = true;
    tick(3);
    expect(pair.stats.host.lost).toBeGreaterThan(20);
    expect(hashState(guest.app.session.guest!.truth!)).toBe(hashState({ ...game, events: [] }));
    expect(dispatch(game, { type: 'toggle_lantern' }, 1)).toBeDefined();
  });
});
