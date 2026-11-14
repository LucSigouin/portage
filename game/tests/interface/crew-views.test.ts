/**
 * The crew lobby's two cards as the Ink & Wash interface draws them, without
 * a DOM: every word of the model is on the card, every control sends the
 * model's intent, and the lines to type on are marked for the interface.
 * Also where the cards may open, and the parameters of an invite link.
 */
import { describe, expect, it } from 'vitest';
import type { CrewView } from '../../src/client/crewlobby.ts';
import { parseDebugParameters } from '../../src/client/debug/parameters.ts';
import { PANEL_RULES, createPanelState, reducePanels } from '../../src/client/panels.ts';
import type { PanelAction, PanelState } from '../../src/client/panels.ts';
import { buildCrewHostPanel, buildCrewJoinPanel, buildLobbyModel, buildPausePanel } from '../../src/client/viewmodels/index.ts';
import type { PanelModel } from '../../src/client/viewmodels/index.ts';
import { collectIntents, collectText } from '../../src/interface/dom.ts';
import type { ViewNode } from '../../src/interface/dom.ts';
import { lobbyView, panelView } from '../../src/interface/views.ts';

const frame = (title: string) => ({ title, close: { label: 'Close', intent: { type: 'close_panel' as const }, enabled: true, note: null } });

const crewView = (change: { host?: Partial<CrewView['host']>; join?: Partial<CrewView['join']> } & Partial<Pick<CrewView, 'name' | 'code' | 'inGame'>> = {}): CrewView => ({
  name: change.name ?? 'Luc',
  code: change.code ?? '',
  inGame: change.inGame ?? false,
  host: { phase: 'idle', code: '', link: '', guests: 0, failure: null, copied: false, ...change.host },
  join: { phase: 'idle', problem: null, leave: null, hostHere: true, ...change.join },
});

const OPEN = { phase: 'open', code: 'FHJK3M', link: 'https://sigouin.net/portage/?invite=FHJK3M', guests: 2 } as const;

function find(nodes: ViewNode[], test: (node: ViewNode) => boolean, into: ViewNode[] = []): ViewNode[] {
  for (const node of nodes) {
    if (test(node)) into.push(node);
    find(node.children, test, into);
  }
  return into;
}

const hostCard = (crew: CrewView): ViewNode[] =>
  panelView({ ...frame('Host a crew'), ...buildCrewHostPanel(crew, [], null) } as PanelModel);
const joinCard = (crew: CrewView): ViewNode[] =>
  panelView({ ...frame('Join a crew'), ...buildCrewJoinPanel(crew) } as PanelModel);

describe('the host\'s room card', () => {
  it('shows the code to read aloud, the link to send and a button that copies it', () => {
    const card = hostCard(crewView({ host: OPEN }));
    const text = collectText(card);
    for (const words of ['Host a crew', 'Crew code', 'FHJ-K3M', 'Invite link', 'Copy link', '2 friends are in the room.', 'Stop hosting', 'Continue', 'New Game', 'Close']) {
      expect(text).toContain(words);
    }
    const link = find(card, (node) => 'data-copy-source' in node.attributes);
    expect(link).toHaveLength(1);
    expect(link[0]!.attributes).toMatchObject({ value: 'https://sigouin.net/portage/?invite=FHJK3M', readonly: true });
    const copy = find(card, (node) => 'data-copy' in node.attributes);
    expect(copy).toHaveLength(1);
    expect(copy[0]!.attributes['data-copy']).toBe('https://sigouin.net/portage/?invite=FHJK3M');
    expect(copy[0]!.intent).toEqual({ type: 'crew_copied' });
    expect(collectIntents(card)).toEqual([
      { type: 'crew_copied' }, { type: 'crew_stop_hosting' }, { type: 'continue_game' }, { type: 'open_panel', panel: 'save_slots' }, { type: 'close_panel' },
    ]);
    expect(collectText(hostCard(crewView({ host: { ...OPEN, copied: true } })))).toContain('Copied');
  });

  it('has one line to type on, twelve letters long, and one button Enter presses', () => {
    const card = hostCard(crewView({ name: 'Luc' }));
    const fields = find(card, (node) => 'data-field' in node.attributes);
    expect(fields.map((field) => field.attributes)).toEqual([expect.objectContaining({ 'data-field': 'name', value: 'Luc', maxlength: 12, disabled: false, type: 'text' })]);
    const primary = find(card, (node) => 'data-primary' in node.attributes);
    expect(primary.map((button) => button.intent)).toEqual([{ type: 'crew_open_room' }]);
    // With the room open the name is settled.
    expect(find(hostCard(crewView({ host: OPEN })), (node) => 'data-field' in node.attributes)[0]!.attributes.disabled).toBe(true);
  });

  it('says how the line is doing in a place that is always there, and never in a way that moves', () => {
    for (const crew of [crewView(), crewView({ host: { phase: 'connecting' } }), crewView({ host: OPEN }),
      crewView({ host: { ...OPEN, phase: 'reconnecting' } }), crewView({ host: { phase: 'failed', failure: 'unreachable' } })]) {
      const status = find(hostCard(crew), (node) => node.attributes.role === 'status');
      expect(status).toHaveLength(1);
      expect(status[0]!.classes).toMatch(/\biw-crew-status\b/);
    }
    expect(collectText(hostCard(crewView({ host: { phase: 'connecting' } })))).toContain('Connecting to the relay…');
    expect(collectText(hostCard(crewView({ host: { ...OPEN, phase: 'reconnecting' } })))).toContain('The line to the relay dropped. Trying again…');
    const failed = hostCard(crewView({ host: { phase: 'failed', failure: 'unreachable' } }));
    expect(collectText(failed)).toContain('The relay cannot be reached. Check your connection and try again.');
    expect(collectText(failed)).toContain('Try again');
  });

  it('in a game offers no game to start, only the room', () => {
    const card = hostCard(crewView({ host: OPEN, inGame: true }));
    expect(collectIntents(card)).toEqual([{ type: 'crew_copied' }, { type: 'crew_stop_hosting' }, { type: 'close_panel' }]);
  });
});

describe('the join card', () => {
  it('has a line for the code and a line for the name, and Join', () => {
    const card = joinCard(crewView({ code: 'FHJ-K3M', name: 'Sam' }));
    const fields = find(card, (node) => 'data-field' in node.attributes);
    expect(fields.map((field) => [field.attributes['data-field'], field.attributes.value, field.attributes.maxlength])).toEqual([['code', 'FHJ-K3M', 9], ['name', 'Sam', 12]]);
    expect(collectIntents(card)).toEqual([{ type: 'crew_join' }, { type: 'close_panel' }]);
    expect(find(card, (node) => 'data-primary' in node.attributes).map((button) => button.intent)).toEqual([{ type: 'crew_join' }]);
  });

  it('has plain words for every state', () => {
    const words: [Partial<CrewView['join']>, string][] = [
      [{ phase: 'connecting' }, 'Connecting to the relay…'],
      [{ phase: 'waiting' }, 'Found the crew. Waiting for the host to start the game…'],
      [{ phase: 'waiting', hostHere: false }, 'Found the room. The host is not there right now. Waiting…'],
      [{ phase: 'reconnecting' }, 'The line dropped. Trying again…'],
      [{ phase: 'failed', problem: 'full' }, 'That crew is full.'],
      [{ phase: 'failed', problem: 'no-room' }, 'No crew with that code. Check it with whoever sent it.'],
      [{ phase: 'failed', problem: 'host-left' }, 'The host left.'],
      [{ phase: 'failed', problem: 'unreachable' }, 'The relay cannot be reached. Check your connection and try again.'],
      [{ phase: 'failed', problem: 'idle' }, 'That room sat empty too long and was closed.'],
      [{ phase: 'failed', problem: 'bad-code' }, 'That is not a crew code. A code is six letters and digits, like FHJ-K3M.'],
      [{ phase: 'failed', problem: 'no-name' }, 'Type a name first.'],
      [{ phase: 'failed', leave: 'full' }, 'That crew is full.'],
      [{ phase: 'failed', leave: 'closed' }, 'The host closed the game.'],
      [{ phase: 'failed', leave: 'version' }, 'The host runs another version of the game. Reload the page, both of you.'],
    ];
    for (const [join, sentence] of words) {
      const status = find(joinCard(crewView({ join })), (node) => node.attributes.role === 'status');
      expect(collectText(status), JSON.stringify(join)).toBe(sentence);
    }
    // While it is busy the lines cannot be typed on, and Cancel is there.
    const busy = joinCard(crewView({ join: { phase: 'waiting' } }));
    expect(find(busy, (node) => 'data-field' in node.attributes).map((field) => field.attributes.disabled)).toEqual([true, true]);
    expect(collectIntents(busy)).toEqual([{ type: 'crew_cancel_join' }, { type: 'crew_join' }, { type: 'close_panel' }]);
  });
});

describe('the lobby and the pause menu', () => {
  it('have crew entries only when there is a crew lobby', () => {
    const labels = (nodes: ViewNode[]): string[] => find(nodes, (node) => node.classes.includes('iw-mi')).map((node) => collectText([node.children[0]!]));
    expect(labels(lobbyView(buildLobbyModel([], null)))).toEqual(['Continue', 'New Game', 'Settings', 'How to Play', 'Credits']);
    expect(labels(lobbyView(buildLobbyModel([], null, null)))).toEqual(['Continue', 'New Game', 'Settings', 'How to Play', 'Credits']);
    expect(labels(lobbyView(buildLobbyModel([], null, crewView())))).toEqual(['Continue', 'New Game', 'Host a crew', 'Join a crew', 'Settings', 'How to Play', 'Credits']);
    const pause = (crew: CrewView | null): string[] => buildPausePanel('Quest 1', crew).buttons.map((button) => button.label);
    expect(pause(null)).toEqual(['Resume', 'Settings', 'How to Play', 'Save and quit to the lobby']);
    expect(pause(crewView())).toEqual(['Resume', 'Host a crew', 'Settings', 'How to Play', 'Save and quit to the lobby']);
    expect(pause(crewView({ host: OPEN }))).toEqual(['Resume', 'Crew room', 'Settings', 'How to Play', 'Save and quit to the lobby']);
    // A guest has no room of their own to show, and no game of their own to save: they leave.
    expect(buildPausePanel('Quest 1', crewView({ join: { phase: 'playing' } }), true).buttons.map((button) => button.label))
      .toEqual(['Resume', 'Settings', 'How to Play', 'Leave the crew']);
  });
});

describe('where the crew cards open', () => {
  const play = (state: PanelState, actions: PanelAction[]): PanelState =>
    actions.reduce((current, action) => reducePanels(current, action, { canoeBeached: false }).state, state);

  it('in the lobby, both; in a game, the host\'s card under the pause menu and the join card nowhere', () => {
    expect(play(createPanelState('lobby'), [{ type: 'open', panel: 'crew_host' }]).stack).toEqual(['crew_host']);
    expect(play(createPanelState('lobby'), [{ type: 'open', panel: 'crew_join' }]).stack).toEqual(['crew_join']);
    expect(play(createPanelState('game'), [{ type: 'open', panel: 'crew_host' }]).stack).toEqual([]);
    expect(play(createPanelState('game'), [{ type: 'escape' }, { type: 'open', panel: 'crew_host' }]).stack).toEqual(['pause', 'crew_host']);
    expect(play(createPanelState('game'), [{ type: 'escape' }, { type: 'open', panel: 'crew_join' }]).stack).toEqual(['pause']);
    expect(PANEL_RULES.crew_host.group).toBe('menu');
    expect(PANEL_RULES.crew_join.group).toBe('menu');
  });

  it('lets the host pick a save slot from the room card, and Esc steps back out one card at a time', () => {
    const picking = play(createPanelState('lobby'), [{ type: 'open', panel: 'crew_host' }, { type: 'open', panel: 'save_slots' }]);
    expect(picking.stack).toEqual(['crew_host', 'save_slots']);
    expect(play(picking, [{ type: 'escape' }]).stack).toEqual(['crew_host']);
    expect(play(picking, [{ type: 'escape' }, { type: 'escape' }]).stack).toEqual([]);
  });
});

describe('an invite link', () => {
  it('carries a room code and nothing else: no sandbox, the player\'s own saves in place', () => {
    expect(parseDebugParameters('?invite=FHJK3M')).toMatchObject({ invite: 'FHJK3M', sandbox: false, host: null, join: null });
    expect(parseDebugParameters('?invite=fhj-k3m').invite).toBe('fhj-k3m');
    for (const query of ['', '?invite=', '?invite=FHJ', '?invite=<script>', '?invite=FHJK3M%20OR%201', '?invite=FHJK3MFHJK3M']) {
      expect(parseDebugParameters(query).invite, query).toBeNull();
    }
  });
});
