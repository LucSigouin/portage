/**
 * Coming and going on one screen: the stand-ins of `?crew=N` are away, the
 * pause rule follows who is playing, and the crew list says who is away and
 * who hosts.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/client/app.ts';
import type { App } from '../../src/client/app.ts';
import { createSilentAudio } from '../../src/client/contracts.ts';
import type { GameInterface, WorldView } from '../../src/client/contracts.ts';
import { applyDebugParameters } from '../../src/client/debug/index.ts';
import { parseDebugParameters } from '../../src/client/debug/parameters.ts';
import { Session } from '../../src/client/session.ts';
import { buildHudModel, buildInterfaceModel, toastsForPlayer } from '../../src/client/viewmodels/index.ts';
import { createPanelState } from '../../src/client/panels.ts';
import { CREW_MARKS, TUNING } from '../../src/data/index.ts';
import { collectText } from '../../src/interface/dom.ts';
import type { ViewNode } from '../../src/interface/dom.ts';
import { crewView } from '../../src/interface/views.ts';
import { createDefaultSettings } from '../../src/settings/index.ts';
import { FIXED_STEP, connectedPlayers, setConnected, setPlayerName, terrainHeight } from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import { FakeStorage, bedSide, newGame, standOn } from '../support.ts';

const settings = createDefaultSettings();
const HOUR = TUNING.time.hourSeconds;

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

/** The canoe beached at Home Knoll, the whole crew in a row by the lean-to. */
function ashore(state: GameState): GameState {
  standOn(state, 'home_knoll');
  state.players.forEach((player, index) => {
    const { x, z } = bedSide('home_knoll', index);
    Object.assign(player, { mode: 'foot', seat: null, islandId: 'home_knoll', position: { x, y: terrainHeight(x, z), z } });
  });
  state.events = [];
  return state;
}

function sessionWith(state: GameState): Session {
  const session = new Session({ storage: new FakeStorage(), now: () => 1000, randomSeed: () => 7 });
  session.adoptGame(state);
  return session;
}

const frames = (session: Session, seconds: number): void => {
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += FIXED_STEP) session.advance(FIXED_STEP, 0);
};

function all(nodes: ViewNode[], into: ViewNode[] = []): ViewNode[] {
  for (const node of nodes) {
    into.push(node);
    all(node.children, into);
  }
  return into;
}
const withClass = (nodes: ViewNode[], name: string): ViewNode[] => all(nodes).filter((node) => node.classes.split(' ').includes(name));

describe('the stand-ins of ?crew=N are away', () => {
  it('marks every extra player away and leaves the local one playing', () => {
    for (const query of ['?crew=4', '?shot=island&crew=4', '?at=quest3&crew=3', '?shot=play&crew=2']) {
      const game = staged(query).session.game!;
      expect(game.players.map((player) => player.connected), query).toEqual(game.players.map((player) => player.id === 0));
    }
  });

  it('never starves them: forty minutes on, their meters have not moved and nobody failed', () => {
    const app = staged('?crew=3');
    const game = app.session.game!;
    const before = game.players.slice(1).map((player) => [player.hunger, player.thirst, player.energy]);
    game.canoe.hullTier = 1;
    game.canoe.waterLevel = 0;
    // Keep the local player alive and the hull dry: this is about the stand-ins.
    for (let minute = 0; minute < 40; minute += 1) {
      Object.assign(game.players[0], { hunger: 100, thirst: 100, energy: 100 });
      game.canoe.waterLevel = 0;
      for (let index = 0; index < 600; index += 1) app.session.advance(0.1, 0);
    }
    expect(game.playedSeconds).toBeGreaterThan(39 * 60);
    expect(game.players.slice(1).map((player) => [player.hunger, player.thirst, player.energy])).toEqual(before);
    expect(game.statistics.fails).toBe(0);
  });

  it('never holds up the night: the local player sleeps and it is morning', () => {
    const app = staged('?crew=4');
    const game = ashore(app.session.game!);
    game.time = 21 * HOUR;
    expect(app.session.dispatch({ type: 'sleep' }).ok).toBe(true);
    expect(game.time).toBe(TUNING.time.daySeconds + 6 * HOUR);
  });

  it('gives a new game from the lobby the same away stand-ins, and a loaded save too', () => {
    const storage = new FakeStorage();
    const session = new Session({ storage, now: () => 1000, randomSeed: () => 7 });
    session.crewSize = 3;
    session.newGame(0);
    expect(session.game!.players.map((player) => player.connected)).toEqual([true, false, false]);
    // A save written by a shared game, where everyone was playing: loaded alone, the others are away.
    for (const player of session.game!.players) player.connected = true;
    session.quitToLobby();
    session.loadGame(0);
    expect(session.game!.players).toHaveLength(3);
    expect(session.game!.players.map((player) => player.connected)).toEqual([true, false, false]);
  });
});

describe('what pauses the game', () => {
  it('alone, every full panel and a hidden tab pause it, exactly as before', () => {
    const session = sessionWith(ashore(newGame(7)));
    expect(session.crewed).toBe(false);
    for (const panel of ['inventory', 'map', 'pause', 'quest_log', 'crafting'] as const) {
      session.handleIntent({ type: 'open_panel', panel });
      expect(session.paused, panel).toBe(true);
      const played = session.game!.playedSeconds;
      frames(session, 1);
      expect(session.game!.playedSeconds, panel).toBe(played);
      session.handleIntent({ type: 'resume' });
      expect(session.paused, panel).toBe(false);
    }
    session.setHidden(true);
    expect(session.paused).toBe(true);
  });

  it('with away stand-ins it still pauses: they are not playing', () => {
    const session = staged('?crew=4').session;
    expect(session.crewed).toBe(false);
    session.handleIntent({ type: 'open_panel', panel: 'inventory' });
    expect(session.paused).toBe(true);
    const played = session.game!.playedSeconds;
    frames(session, 1);
    expect(session.game!.playedSeconds).toBe(played);
  });

  it('with two or more playing nothing pauses it: panels open over a world that keeps running', () => {
    const session = sessionWith(ashore(newGame(7, { crew: 2 })));
    expect(session.crewed).toBe(true);
    for (const panel of ['inventory', 'map', 'pause', 'quest_log', 'crafting'] as const) {
      session.handleIntent({ type: 'open_panel', panel });
      expect(session.isOpen(panel), panel).toBe(true);
      expect(session.paused, panel).toBe(false);
      const played = session.game!.playedSeconds;
      frames(session, 1);
      expect(session.game!.playedSeconds, panel).toBeCloseTo(played + 1, 6);
      // The keys do not walk the player about behind the panel.
      expect(session.inputSnapshot(), panel).toBeNull();
      session.handleIntent({ type: 'resume' });
    }
    session.setHidden(true);
    expect(session.paused).toBe(false);
    // The debug freeze still holds a staged shot still.
    session.frozen = true;
    expect(session.paused).toBe(true);
  });

  it('goes back to pausing the moment the other player is away, and stops again when they return', () => {
    const session = sessionWith(ashore(newGame(7, { crew: 2 })));
    session.handleIntent({ type: 'open_panel', panel: 'inventory' });
    expect(session.paused).toBe(false);
    setConnected(session.game!, 1, false);
    expect(session.paused).toBe(true);
    setConnected(session.game!, 1, true);
    expect(session.paused).toBe(false);
  });
});

describe('the crew list with someone away, a host and names', () => {
  function crew(): GameState {
    const state = ashore(newGame(7, { crew: 4 }));
    setPlayerName(state, 1, 'Sam');
    setPlayerName(state, 3, 'Maximilienne');
    setConnected(state, 2, false, true);
    return state;
  }

  it('shows a name where there is one and the crew mark where there is none', () => {
    const rows = buildHudModel(crew(), settings, 0, 0).crew;
    expect(rows.map((row) => row.label)).toEqual([CREW_MARKS[0]!.label, 'Sam', CREW_MARKS[2]!.label, 'Maximilienne']);
    // The colour stays the mark's, whatever the name.
    expect(rows.map((row) => row.color)).toEqual(CREW_MARKS.map((mark) => mark.toque));
  });

  it('marks who is away, and keeps where they are and their meters', () => {
    const state = crew();
    Object.assign(state.players[2], { hunger: 44, thirst: 55, energy: 66 });
    const rows = buildHudModel(state, settings, 0, 0).crew;
    expect(rows.map((row) => row.away)).toEqual([false, false, true, false]);
    expect(rows[2]).toMatchObject({ where: 'ashore', placeText: 'Ashore · Home Knoll' });
    expect(rows[2]!.meters.map((meter) => meter.value)).toEqual([44, 55, 66]);
  });

  it('says who hosts only when told, on whichever screen reads it', () => {
    const state = crew();
    expect(buildHudModel(state, settings, 0, 0).crew.every((row) => !row.host)).toBe(true);
    expect(buildHudModel(state, settings, 0, 1, 0).crew.map((row) => row.host)).toEqual([true, false, false, false]);
    expect(buildHudModel(state, settings, 0, 0, 3).crew.map((row) => row.host)).toEqual([false, false, false, true]);
    const model = buildInterfaceModel({
      panels: createPanelState('game'), settings, game: state, playerId: 1, hostId: 0, paused: false, cameraYaw: 0, toasts: [],
      slots: [], latestSlot: null, currentSlot: null, now: 0, capture: null, bindingNotice: '', progressText: '', debug: null,
    });
    expect(model.hud!.crew.map((row) => [row.you, row.host])).toEqual([[false, true], [true, false], [false, false], [false, false]]);
  });

  it('draws one tag a row: you, else away, else host', () => {
    const state = crew();
    const rows = withClass([crewView(buildHudModel(state, settings, 0, 1, 0).crew, false)], 'iw-mate');
    const tags = rows.map((row) => collectText(withClass([row], 'iw-kind')));
    expect(tags).toEqual(['host', 'you', 'away', '']);
    expect(rows.map((row) => row.classes.split(' ').includes('iw-away'))).toEqual([false, false, true, false]);
    expect(collectText([rows[1]!])).toContain('Sam');
    expect(collectText([rows[3]!])).toContain('Maximilienne');
    // Your own screen never tags you twice, even when you host.
    const own = withClass([crewView(buildHudModel(state, settings, 0, 0, 0).crew, false)], 'iw-mate');
    expect(collectText(withClass([own[0]!], 'iw-kind'))).toBe('you');
  });

  it('tells the crew who left and who came back, by name, and not the one it is about', () => {
    const state = crew();
    const events = [
      { type: 'crew_changed' as const, who: 1, change: 'away' as const },
      { type: 'crew_changed' as const, who: 2, change: 'back' as const },
      { type: 'crew_changed' as const, who: 3, change: 'joined' as const },
    ];
    expect(toastsForPlayer(events, state, 0).map((toast) => toast.text)).toEqual([
      'Sam is away', `${CREW_MARKS[2]!.label} is back`, 'Maximilienne joined the crew',
    ]);
    expect(toastsForPlayer(events, state, 1).map((toast) => toast.text)).toEqual([
      `${CREW_MARKS[2]!.label} is back`, 'Maximilienne joined the crew',
    ]);
  });

  it('names the finder of a new tool by their own name', () => {
    const state = crew();
    const found = [{ type: 'item_gained' as const, itemId: 'hatchet' as const, count: 1, container: 'belt' as const, playerId: 1 }];
    expect(toastsForPlayer(found, state, 0)[0]!.text).toBe('Sam found a new tool: Hatchet');
  });

  it('counts only those playing as the crew that is here', () => {
    const state = crew();
    expect(connectedPlayers(state).map((player) => player.id)).toEqual([0, 1, 3]);
  });
});
