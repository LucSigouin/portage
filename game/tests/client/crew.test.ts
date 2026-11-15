/** The client with a crew: the session plays one local player, and everything it shows is theirs. */
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/client/app.ts';
import type { App } from '../../src/client/app.ts';
import { subjectFromState } from '../../src/client/camera.ts';
import { createSilentAudio } from '../../src/client/contracts.ts';
import type { AudioEngine, GameInterface, InterfaceModel, WorldView } from '../../src/client/contracts.ts';
import { applyDebugParameters } from '../../src/client/debug/index.ts';
import { parseDebugParameters } from '../../src/client/debug/parameters.ts';
import { addIdleCrew } from '../../src/client/debug/staging.ts';
import { Session } from '../../src/client/session.ts';
import { buildHudModel, buildInterfaceModel, buildInventoryPanel } from '../../src/client/viewmodels/index.ts';
import { ISLANDS_BY_ID, spotPosition } from '../../src/data/index.ts';
import { crewOf, setLocalPlayerId } from '../../src/look/crew.ts';
import { SAVE_KEY_PREFIX, deserialize } from '../../src/save/index.ts';
import { createDefaultSettings } from '../../src/settings/index.ts';
import { FIXED_STEP, NEUTRAL_INPUT, createGame, terrainHeight } from '../../src/sim/index.ts';
import type { GameEvent, GameState, PlayerId } from '../../src/sim/index.ts';
import { createPanelState } from '../../src/client/panels.ts';
import { FakeStorage, newGame, standOn } from '../support.ts';

/** The canoe beached at Home Knoll, the whole crew standing in a row by the fire. */
function ashore(state: GameState): GameState {
  standOn(state, 'home_knoll');
  const camp = spotPosition(ISLANDS_BY_ID.home_knoll, ISLANDS_BY_ID.home_knoll.camp!.spot);
  state.players.forEach((player, index) => {
    const x = camp.x + 1 + index * 0.9;
    player.mode = 'foot';
    player.seat = null;
    player.islandId = 'home_knoll';
    player.position = { x, y: terrainHeight(x, camp.z), z: camp.z };
  });
  state.events = [];
  return state;
}

function sessionWith(crew: number, localPlayerId: PlayerId): Session {
  const session = new Session({ storage: new FakeStorage(), now: () => 1000, randomSeed: () => 7 });
  session.localPlayerId = localPlayerId;
  session.adoptGame(ashore(newGame(7, { crew })));
  return session;
}

const frames = (session: Session, seconds: number): void => {
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += FIXED_STEP) session.advance(FIXED_STEP, 0);
};

describe('the session plays one local player', () => {
  it('is player 0 unless told otherwise, in a crew of one unless told otherwise', () => {
    const session = new Session({ storage: new FakeStorage(), randomSeed: () => 7 });
    expect(session.localPlayerId).toBe(0);
    expect(session.crewSize).toBe(1);
    session.newGame(0);
    expect(session.game!.players).toHaveLength(1);
  });

  it('drives the local player with the keys and nobody else', () => {
    for (const local of [0, 2]) {
      const session = sessionWith(3, local);
      const before = session.game!.players.map((player) => ({ ...player.position }));
      session.keyDown('KeyD');
      frames(session, 1);
      session.keyUp('KeyD');
      session.game!.players.forEach((player, index) => {
        if (index === local) expect(player.position.x, `local ${local}`).toBeGreaterThan(before[index].x + 2);
        else expect(player.position, `local ${local}, player ${index}`).toEqual(before[index]);
      });
    }
  });

  it('sends commands as the local player and reads the keys against their state', () => {
    const session = sessionWith(2, 1);
    const [first, second] = session.game!.players;
    second.backpack.push({ itemId: 'berries', count: 2 });
    second.hunger = 30;
    first.hunger = 30;
    expect(session.dispatch({ type: 'eat', itemId: 'berries' }).ok).toBe(true);
    expect(second.hunger).toBeGreaterThan(30);
    expect(first.hunger).toBe(30);
    // The snapshot the keys resolve against is the local player's: on foot, with the crew's belt.
    session.game!.tools.push('hatchet');
    first.mode = 'canoe';
    // The keys read the local player's own belt: the crew's tools, slot by slot.
    expect(session.inputSnapshot()).toMatchObject({ mode: 'foot', tools: ['bailing_can', 'hatchet', null, null, null, null, null, null] });
    session.keyDown('Digit2');
    expect(second.selectedTool).toBe('hatchet');
    expect(first.selectedTool).toBeNull();
  });

  it('opens the conversation panel for the local player\'s talk only', () => {
    const session = sessionWith(2, 1);
    session.game!.players[0].dialogue = { npcId: 'odile', nodeId: 'start' };
    frames(session, 0.1);
    expect(session.isOpen('dialogue')).toBe(false);
    session.game!.players[1].dialogue = { npcId: 'odile', nodeId: 'start' };
    frames(session, 0.1);
    expect(session.isOpen('dialogue')).toBe(true);
  });

  it('lets the bot drive player 0 whoever the local player is', () => {
    const session = sessionWith(2, 1);
    const before = session.game!.players.map((player) => ({ ...player.position }));
    let steps = 0;
    session.attachDriver({ next: () => ((steps += 1) > 60 ? null : { ...NEUTRAL_INPUT, moveX: 1 }) });
    frames(session, 1.5);
    expect(session.game!.players[0].position.x).toBeGreaterThan(before[0].x + 2);
    expect(session.game!.players[1].position).toEqual(before[1]);
  });

  it('starts new games with the crew size it was given, and saves and reloads them whole', () => {
    const storage = new FakeStorage();
    const session = new Session({ storage, now: () => 1000, randomSeed: () => 7 });
    session.crewSize = 4;
    expect(session.newGame(1)).toBe(true);
    expect(session.game!.players.map((player) => player.seat)).toEqual([0, 1, 2, 3]);
    session.keyDown('KeyW');
    frames(session, 2);
    session.quitToLobby();
    const saved = deserialize(storage.getItem(`${SAVE_KEY_PREFIX}1`));
    expect(saved.ok && saved.state.players).toHaveLength(4);
    expect(session.loadGame(1)).toBe(true);
    expect(session.game!.players).toHaveLength(4);
    expect(session.game!.players.every((player) => player.mode === 'canoe')).toBe(true);
  });
});

describe('view-models are the local player\'s', () => {
  const settings = createDefaultSettings();

  it('builds the HUD and the panels for the player asked for', () => {
    const state = ashore(newGame(7, { crew: 3 }));
    const [first, , third] = state.players;
    first.hunger = 90;
    third.hunger = 12;
    state.tools.push('hatchet');
    third.selectedTool = 'hatchet';
    third.backpack.push({ itemId: 'berries', count: 3 });
    const mine = buildHudModel(state, settings, 0);
    const theirs = buildHudModel(state, settings, 0, 2);
    expect(mine.meters[0]).toMatchObject({ id: 'hunger', value: 90, low: false });
    expect(theirs.meters[0]).toMatchObject({ id: 'hunger', value: 12, low: true });
    // The hotbar and the inventory belt show the crew's tools to everyone; the tool in hand is each player's own.
    for (const playerId of [0, 1, 2]) {
      expect(buildHudModel(state, settings, 0, playerId).hotbar.map((slot) => slot.toolId), `hotbar ${playerId}`)
        .toEqual(['bailing_can', 'hatchet', null, null, null]);
      expect(buildInventoryPanel(state, playerId).belt.map((slot) => slot.toolId), `belt ${playerId}`).toEqual(['bailing_can', 'hatchet', null, null, null]);
    }
    expect(mine.hotbar[1]).toMatchObject({ toolId: 'hatchet', selected: false });
    expect(theirs.hotbar[1]).toMatchObject({ toolId: 'hatchet', selected: true });
    expect(buildInventoryPanel(state, 0).belt.map((slot) => slot.selected)).toEqual([false, false, false, false, false]);
    expect(buildInventoryPanel(state, 2).belt.map((slot) => slot.selected)).toEqual([false, true, false, false, false]);
    expect(buildInventoryPanel(state).backpack.label).toContain('Backpack 0 /');
    expect(buildInventoryPanel(state, 2).backpack.label).toContain('Backpack 1 /');
    const model = buildInterfaceModel({
      panels: createPanelState('game'), settings, game: state, playerId: 2, paused: false, cameraYaw: 0, toasts: [],
      slots: [], latestSlot: null, currentSlot: null, now: 0, capture: null, bindingNotice: '', progressText: '', debug: null,
    });
    expect(model.hud!.meters[0].value).toBe(12);
  });

  it('follows the local player with the camera: the canoe while they are aboard, themselves ashore', () => {
    const state = ashore(newGame(7, { crew: 2 }));
    state.players[0].mode = 'canoe';
    expect(subjectFromState(state, NEUTRAL_INPUT, 0)).toMatchObject({ mode: 'canoe', position: state.canoe.position });
    expect(subjectFromState(state, NEUTRAL_INPUT, 1)).toMatchObject({ mode: 'foot', position: state.players[1].position });
  });
});

describe('the look reads the crew through crewOf', () => {
  afterEach(() => setLocalPlayerId(0));

  it('gives the local player and the others, following the local id it was told', () => {
    const state = createGame(7, { crew: 3 });
    expect(crewOf(state).local).toBe(state.players[0]);
    expect(crewOf(state).others).toEqual([state.players[1], state.players[2]]);
    setLocalPlayerId(2);
    expect(crewOf(state).local).toBe(state.players[2]);
    expect(crewOf(state).others).toEqual([state.players[0], state.players[1]]);
    // Alone, there are no others. An id nobody has falls back to player 0.
    setLocalPlayerId(3);
    const solo = createGame(7);
    expect(crewOf(solo)).toEqual({ local: solo.players[0], others: [] });
  });
});

describe('one frame with a crew', () => {
  function appWith(): { app: App; audioEvents: GameEvent[][]; worldEvents: GameEvent[][]; audioPlayers: (PlayerId | undefined)[]; models: InterfaceModel[] } {
    const audioEvents: GameEvent[][] = [];
    const worldEvents: GameEvent[][] = [];
    const audioPlayers: (PlayerId | undefined)[] = [];
    const models: InterfaceModel[] = [];
    const worldView: WorldView = {
      mount: () => {}, resize: () => {}, applyGraphicsSettings: () => {}, showStage: () => {}, sync: () => {},
      handleEvents: (events) => void worldEvents.push([...events]),
      render: () => {}, dispose: () => {},
    };
    const gameInterface: GameInterface = { mount: () => {}, update: (model) => void models.push(model), dispose: () => {} };
    const audio: AudioEngine = {
      ...createSilentAudio(),
      handleEvents: (events) => void audioEvents.push([...events]),
      update: (_state, _seconds, playerId) => void audioPlayers.push(playerId),
    };
    const app = createApp({ worldView, gameInterface, audio, storage: new FakeStorage(), now: () => 5000, randomSeed: () => 42 });
    return { app, audioEvents, worldEvents, audioPlayers, models };
  }

  it('gives the sound and the toasts the local player\'s events, and the world everyone\'s', () => {
    const { app, audioEvents, worldEvents, audioPlayers, models } = appWith();
    const state = ashore(newGame(7, { crew: 2 }));
    app.session.adoptGame(state);
    app.frame(FIXED_STEP);
    // Player 1 (not local) eats and goes hungry in this step; player 0 does nothing.
    state.players[1].hunger = 25.0003;
    state.events.push({ type: 'ate', itemId: 'berries', playerId: 1 }, { type: 'quest_ready', questId: 'first_haul' });
    app.frame(FIXED_STEP);
    const world = worldEvents.at(-1)!;
    const sound = audioEvents.at(-1)!;
    expect(world.map((event) => event.type)).toEqual(expect.arrayContaining(['ate', 'quest_ready', 'meter_low']));
    expect(sound.map((event) => event.type)).toContain('quest_ready');
    expect(sound.some((event) => event.playerId === 1)).toBe(false);
    expect(audioPlayers.at(-1)).toBe(0);
    const toasts = models.at(-1)!.toasts.map((toast) => toast.text).join(' | ');
    expect(toasts).not.toMatch(/hungr/i);
    // Seen from player 1's screen, the same frame tells them.
    const other = appWith();
    const twin = ashore(newGame(7, { crew: 2 }));
    other.app.session.localPlayerId = 1;
    other.app.session.adoptGame(twin);
    twin.players[1].hunger = 25.0003;
    other.app.frame(FIXED_STEP);
    expect(other.audioEvents.flat().some((event) => event.type === 'meter_low' && event.playerId === 1)).toBe(true);
    expect(other.audioPlayers.at(-1)).toBe(1);
    expect(other.models.at(-1)!.hud!.meters[0].value).toBe(25);
  });
});

describe('?crew=N', () => {
  it('reads a crew of 1 to 4 and plays in the sandbox when there is a crew', () => {
    expect(parseDebugParameters('')).toMatchObject({ crew: 1, sandbox: false });
    expect(parseDebugParameters('?crew=1')).toMatchObject({ crew: 1, sandbox: false });
    expect(parseDebugParameters('?crew=3')).toMatchObject({ crew: 3, sandbox: true });
    expect(parseDebugParameters('?crew=9')).toMatchObject({ crew: 4, sandbox: true });
    expect(parseDebugParameters('?crew=0')).toMatchObject({ crew: 1, sandbox: false });
    expect(parseDebugParameters('?crew=two')).toMatchObject({ crew: 1 });
  });

  function staged(query: string): App {
    const worldView: WorldView = {
      mount: () => {}, resize: () => {}, applyGraphicsSettings: () => {}, showStage: () => {}, sync: () => {},
      handleEvents: () => {}, render: () => {}, dispose: () => {},
    };
    const gameInterface: GameInterface = { mount: () => {}, update: () => {}, dispose: () => {} };
    const app = createApp({ worldView, gameInterface, audio: createSilentAudio(), storage: new FakeStorage(), randomSeed: () => 42 });
    applyDebugParameters(app, parseDebugParameters(query));
    return app;
  }

  it('starts a new game with the extra players sitting idle in the canoe beside the local one', () => {
    const game = staged('?crew=4').session.game!;
    expect(game.players.map((player) => player.id)).toEqual([0, 1, 2, 3]);
    expect(game.players.map((player) => player.seat)).toEqual([0, 1, 2, 3]);
    expect(game.players.every((player) => player.mode === 'canoe')).toBe(true);
    expect(game.quests.bail_out.status).toBe('active');
    // One player: the lobby, as ever.
    expect(staged('?crew=1').session.game).toBeNull();
    expect(staged('').session.game).toBeNull();
  });

  it('idles: the extra players never move, and the local one plays as usual', () => {
    const app = staged('?crew=3');
    const game = app.session.game!;
    app.session.keyDown('KeyW');
    for (let index = 0; index < 300; index += 1) app.frame(FIXED_STEP);
    expect(game.statistics.distancePaddled).toBeGreaterThan(3);
    for (const player of game.players) expect(player.position).toEqual(game.canoe.position);
    expect(game.players.slice(1).every((player) => !player.exerting && !player.bailing)).toBe(true);
  });

  it('stands the idle crew beside the local player in a shot staged ashore, each on their own spot', () => {
    const game = staged('?shot=island&crew=4').session.game!;
    expect(game.players).toHaveLength(4);
    const lead = game.players[0];
    expect(lead.mode).toBe('foot');
    for (const extra of game.players.slice(1)) {
      expect(extra).toMatchObject({ mode: 'foot', seat: null, islandId: lead.islandId });
      expect(Math.hypot(extra.position.x - lead.position.x, extra.position.z - lead.position.z)).toBeLessThan(4);
    }
    for (const first of game.players) {
      for (const second of game.players) {
        if (first.id < second.id) expect(Math.hypot(first.position.x - second.position.x, first.position.z - second.position.z)).toBeGreaterThan(0.5);
      }
    }
    expect(staged('?shot=play&crew=2').session.game!.players.map((player) => player.mode)).toEqual(['canoe', 'canoe']);
  });

  it('never grows a crew past what was asked, and leaves a solo game alone', () => {
    const state = newGame(7);
    expect(addIdleCrew(state, 1).players).toHaveLength(1);
    expect(addIdleCrew(state, 3).players).toHaveLength(3);
    expect(addIdleCrew(state, 2).players).toHaveLength(3);
    expect(addIdleCrew(state, 9).players).toHaveLength(4);
  });
});

describe('the host\'s list of crewmates', () => {
  it('names everyone but the host, here or away, each with a button that asks to take them out; a guest gets none', async () => {
    const { buildCrewHostPanel } = await import('../../src/client/viewmodels/crew.ts');
    const { newGame } = await import('../support.ts');
    const game = newGame(7, { crew: 3 });
    game.players[1]!.name = 'Sam';
    game.players[2]!.connected = false;
    const crew = {
      name: 'Luc', code: '', inGame: true,
      host: { phase: 'open' as const, code: 'FHJK3M', link: 'https://example.test/?crew=FHJK3M', guests: 1, failure: null, copied: false },
      join: { phase: 'idle' as const, problem: null, leave: null, hostHere: true },
    };
    const roster = buildCrewHostPanel(crew, [], null, game, 0, false).roster;
    expect(roster.map((mate) => [mate.playerId, mate.name, mate.here, mate.remove.intent])).toEqual([
      [1, 'Sam', true, { type: 'crew_remove', playerId: 1 }],
      [2, expect.any(String), false, { type: 'crew_remove', playerId: 2 }],
    ]);
    expect(buildCrewHostPanel(crew, [], null, game, 1, true).roster).toEqual([]);
    expect(buildCrewHostPanel({ ...crew, inGame: false }, [], null, game, 0, false).roster).toEqual([]);
  });
});
