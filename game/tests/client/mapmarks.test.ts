/**
 * The map's marks can be found (the master review of round 3, finding 4): the map panel says in one line that a
 * click marks a spot, its legend has a row for each mark standing, and the rest of the crew gets a note, with no
 * sound, when someone marks one.
 */
import { describe, expect, it } from 'vitest';
import { EVENT_CUES } from '../../src/audio/cues.ts';
import { createApp } from '../../src/client/app.ts';
import type { App } from '../../src/client/app.ts';
import { createSilentAudio } from '../../src/client/contracts.ts';
import type { GameInterface, InterfaceModel, PanelModel, WorldView } from '../../src/client/contracts.ts';
import { MAP_MARK_HINT, buildInterfaceModel, buildMapPanel, mapMarks, toastsForPlayer, toastsFromEvents } from '../../src/client/viewmodels/index.ts';
import { createPanelState, reducePanels } from '../../src/client/panels.ts';
import type { ViewNode } from '../../src/interface/dom.ts';
import { collectText } from '../../src/interface/dom.ts';
import { glintIcon } from '../../src/interface/mapmarks.ts';
import { panelView } from '../../src/interface/views.ts';
import { createLoopbackPair } from '../../src/net/index.ts';
import type { HostLink } from '../../src/net/index.ts';
import { createDefaultSettings } from '../../src/settings/index.ts';
import { FIXED_STEP, dispatch, drainEvents, pingColour, setPlayerName } from '../../src/sim/index.ts';
import type { GameState } from '../../src/sim/index.ts';
import { FakeStorage, newGame } from '../support.ts';

const fileSystemModule = 'node:fs';
const { readFileSync } = await import(/* @vite-ignore */ fileSystemModule) as { readFileSync(path: URL, encoding: 'utf8'): string };
/** A style file of this fix round, with its comments taken out: what is left is what the browser reads. */
const rules = (name: string): string => readFileSync(new URL(`../../src/interface/${name}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** A crew of four afloat, named, on water that holds still. */
function crewGame(crew = 4): GameState {
  const game = newGame(7, { crew });
  game.weather.secondsRemaining = 99999;
  for (const [id, name] of ['Luc', 'Sam', 'Odile', 'Max'].slice(0, crew).entries()) setPlayerName(game, id, name);
  drainEvents(game);
  return game;
}

const find = (nodes: ViewNode[], test: (node: ViewNode) => boolean): ViewNode[] =>
  nodes.flatMap((node) => [...(test(node) ? [node] : []), ...find(node.children, test)]);
const withClass = (nodes: ViewNode[], className: string): ViewNode[] => find(nodes, (node) => node.classes.split(' ').includes(className));

/** The map panel as the interface gets it, for one player of a game. */
function mapPanel(game: GameState, playerId = 0): Extract<PanelModel, { id: 'map' }> {
  const panels = reducePanels(createPanelState('game'), { type: 'open', panel: 'map' }, { canoeBeached: false, boatOpensOn: 'builder' }).state;
  const model = buildInterfaceModel({
    panels, settings: createDefaultSettings(), game, playerId, hostId: 0, hostQuiet: false, paused: false, cameraYaw: 0, toasts: [],
    slots: [], latestSlot: null, currentSlot: null, now: 0, capture: null, bindingNotice: '', progressText: '', crew: null, feedback: null,
    built: null, arrival: null, debug: null,
  } as unknown as Parameters<typeof buildInterfaceModel>[0]);
  if (model.panel?.id !== 'map') throw new Error('the map is not open');
  return model.panel;
}

describe('marking a spot tells the rest of the crew', () => {
  it('with one event for the whole crew, that says who', () => {
    const game = crewGame(2);
    expect(dispatch(game, { type: 'ping', x: 120, z: 900 }, 1).ok).toBe(true);
    expect(drainEvents(game)).toEqual([{ type: 'spot_marked', who: 1 }]);
    // A refused mark, and a mark taken down, tell nobody anything.
    expect(dispatch(game, { type: 'ping', x: 99999, z: 0 }, 0).ok).toBe(false);
    expect(dispatch(game, { type: 'ping', x: 130, z: 900 }, 1)).toMatchObject({ ok: false, reason: 'ping_too_soon' });
    expect(dispatch(game, { type: 'clear_ping', playerId: 1 }, 0).ok).toBe(true);
    expect(drainEvents(game)).toEqual([]);
  });

  it('by a note in the game\'s usual words, to everyone but the one who marked it', () => {
    const game = crewGame(3);
    dispatch(game, { type: 'ping', x: 120, z: 900 }, 1);
    const events = drainEvents(game);
    expect(toastsForPlayer(events, game, 0)).toEqual([{ text: 'Sam marked a spot on the map', tone: 'info', said: ['Sam'] }]);
    expect(toastsForPlayer(events, game, 2)).toEqual([{ text: 'Sam marked a spot on the map', tone: 'info', said: ['Sam'] }]);
    expect(toastsForPlayer(events, game, 1)).toEqual([]);
    // A crewmate with no name is told by their mark's label, as everywhere else.
    setPlayerName(game, 1, '');
    expect(toastsFromEvents(events, game, 0)[0]!.text).toMatch(/^.+ marked a spot on the map$/);
    expect(toastsFromEvents(events, game, 0)[0]!.text).not.toMatch(/^ /);
  });

  it('says nothing to a player alone: their own mark is on their own map', () => {
    const game = crewGame(1);
    dispatch(game, { type: 'ping', x: 120, z: 900 });
    expect(toastsForPlayer(drainEvents(game), game, 0)).toEqual([]);
  });

  it('with no sound', () => {
    expect(EVENT_CUES.spot_marked).toBeNull();
  });
});

describe('the map panel says its marks', () => {
  it('in one line: a click marks a spot for the crew, a click on a mark takes it down', () => {
    const panel = buildMapPanel(crewGame(1));
    expect(panel.markHint).toBe('Click the map to mark a spot for the crew. Click a mark to take it down.');
    expect(panel.markHint).toBe(MAP_MARK_HINT);
    expect(panel.marks).toEqual([]);
  });

  it('with a legend row for each mark standing: whose it is, and that player\'s colour', () => {
    const game = crewGame(4);
    for (const playerId of [2, 0, 3, 1]) dispatch(game, { type: 'ping', x: 100 + playerId * 40, z: 900 }, playerId);
    // In player order, named for the one who reads the map.
    expect(mapMarks(game, 0)).toEqual([
      { playerId: 0, label: 'Your mark', color: pingColour(0) }, { playerId: 1, label: 'Sam\'s mark', color: pingColour(1) },
      { playerId: 2, label: 'Odile\'s mark', color: pingColour(2) }, { playerId: 3, label: 'Max\'s mark', color: pingColour(3) },
    ]);
    expect(mapMarks(game, 2).map((mark) => mark.label)).toEqual(['Luc\'s mark', 'Sam\'s mark', 'Your mark', 'Max\'s mark']);
    expect(new Set(mapMarks(game, 0).map((mark) => mark.color)).size).toBe(4);
    // A mark taken down, or reached, has no row.
    dispatch(game, { type: 'clear_ping', playerId: 1 }, 0);
    expect(buildMapPanel(game, 0).marks!.map((mark) => mark.label)).toEqual(['Your mark', 'Odile\'s mark', 'Max\'s mark']);
  });

  it('draws the line in the footer and the rows in the legend, each with the glint in its colour', () => {
    const game = crewGame(4);
    for (const playerId of [0, 1, 2, 3]) dispatch(game, { type: 'ping', x: 100 + playerId * 40, z: 900 }, playerId);
    const views = panelView(mapPanel(game, 0));
    const footer = find(views, (node) => node.tag === 'footer');
    expect(collectText(withClass(footer, 'iw-map-hint'))).toBe(MAP_MARK_HINT);
    const rows = withClass(views, 'iw-legend-mark');
    expect(rows.map((row) => collectText([row]))).toEqual(['Your mark', 'Sam\'s mark', 'Odile\'s mark', 'Max\'s mark']);
    rows.forEach((row, playerId) => {
      const drawing = find([row], (node) => node.html !== null)[0]!;
      expect(drawing.html).toBe(glintIcon(pingColour(playerId)));
      expect(drawing.html).toContain(`fill="${pingColour(playerId)}"`);
    });
    // They come after the other rows of the legend, inside it.
    const legend = withClass(views, 'iw-legend')[0]!;
    expect(legend.children.slice(-4)).toEqual(rows);
    // With no mark standing there is the line, and no row.
    const bare = panelView(mapPanel(crewGame(2), 0));
    expect(withClass(bare, 'iw-legend-mark')).toEqual([]);
    expect(collectText(withClass(bare, 'iw-map-hint'))).toBe(MAP_MARK_HINT);
  });

  it('writes only a plain colour into the drawing, and nothing of it moves', () => {
    expect(glintIcon('#c0392b')).toContain('fill="#c0392b"');
    expect(glintIcon('red" onload="x')).toContain('fill="none"');
    // Neither the map's new rules nor the drop note's (finding 2) have a transition or an animation.
    for (const name of ['mapmarks.css', 'takeback.css']) {
      expect(rules(name).length, name).toBeGreaterThan(100);
      expect(rules(name), name).not.toMatch(/transition|animation|@keyframes/);
    }
  });
});

describe('a crew over the line', () => {
  interface Client { app: App; models: InterfaceModel[]; toasts(): string[] }
  function client(): Client {
    const models: InterfaceModel[] = [];
    const worldView: WorldView = {
      mount: () => {}, resize: () => {}, applyGraphicsSettings: () => {}, showStage: () => {}, sync: () => {}, handleEvents: () => {},
      render: () => {}, dispose: () => {},
    };
    const gameInterface: GameInterface = { mount: () => {}, update: (model) => void models.push(model), dispose: () => {} };
    const app = createApp({ worldView, gameInterface, audio: createSilentAudio(), storage: new FakeStorage(), now: () => 5000, randomSeed: () => 42 });
    return { app, models, toasts: () => models.at(-1)!.toasts.map((toast) => toast.text) };
  }

  it('the host marks a spot: the guest reads "Luc marked a spot on the map" and has the row; the host has no note', () => {
    const host = client();
    const guest = client();
    let link: HostLink | null = null;
    host.app.session.playerName = 'Luc';
    host.app.session.onShare = (made) => {
      link = made;
    };
    const game = newGame();
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
    host.app.session.handleIntent({ type: 'command', command: { type: 'ping', x: 150, z: 1000 } });
    tick(0.5);
    expect(guest.toasts()).toContain('Luc marked a spot on the map');
    expect(host.toasts()).not.toContain('Luc marked a spot on the map');
    // The guest marks one too: the host is told, the guest is not.
    guest.app.session.handleIntent({ type: 'command', command: { type: 'ping', x: 250, z: 1000 } });
    tick(0.5);
    expect(host.toasts()).toContain('Sam marked a spot on the map');
    expect(guest.toasts()).not.toContain('Sam marked a spot on the map');
    // Each map's legend names both marks, from its own reader's side.
    guest.app.session.handleIntent({ type: 'open_panel', panel: 'map' });
    host.app.session.handleIntent({ type: 'open_panel', panel: 'map' });
    tick(0.2);
    const marks = (each: Client): string[] => {
      const panel = each.models.at(-1)!.panel;
      return panel?.id === 'map' ? panel.marks!.map((mark) => mark.label) : [];
    };
    expect(marks(host)).toEqual(['Your mark', 'Sam\'s mark']);
    expect(marks(guest)).toEqual(['Luc\'s mark', 'Your mark']);
  });
});
